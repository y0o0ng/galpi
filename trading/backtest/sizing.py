"""설계 9.1 포지션 크기와 9.1.1 최소수량 예외.

$$FinalShares=\\min(SharesByRisk, SharesByCapital, LiquidityCap)\\times LLMGateFactor$$

수량은 항상 정수다. 9.1.1이 소수점 주문을 금지했고, 백테스터도 실행과 같은 정수 수량을
써야 한다. 이 모듈은 계좌 상태를 읽기만 하고 원장을 바꾸지 않는다.

한도 값은 이 모듈에 없다. 전부 `PolicyVersion`에서 온다(9.2: "어느 구성요소도 런타임에
상향할 수 없다"). 포트폴리오 한도에서 나온 추가 상한과 배수는 `risk.py`가 계산해
`extra_caps`·배수 인자로 넘긴다.

가격과 계좌는 모두 USD 기준이다. 9.4에 따라 환율은 예측하지 않고, 원화 환산과 환전
비용은 성과 보고 단계에서 분리해 다룬다.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from .candidates import Candidate, Skip
from .policy import PolicyVersion, StrategyParameters
from core.core1 import PAPER_CORE_V1
from .regime import Regime

# 수량 계산의 나눗셈에서 생기는 1e-16 수준의 오차로 한 주가 깎이는 것을 막는다.
# 1e-9주는 경제적 의미가 없다.
SHARE_EPSILON = 1e-9


class SizingError(Exception):
    """입력이 크기 계산의 전제를 만족하지 못할 때 올린다."""


@dataclass(frozen=True)
class OpenPosition:
    """크기 계산이 보는 보유 포지션. 원장의 정본이 아니라 읽기 모델이다."""

    symbol: str
    shares: int
    market_price: float
    entry_price: float
    stop_price: float
    sector: str | None = None

    @property
    def market_value(self) -> float:
        return self.shares * self.market_price

    @property
    def open_risk(self) -> float:
        """9.2의 "계획된 손절 위험"이 이 포지션에서 아직 쓰고 있는 금액.

        `수량 × max(0, min(현재가, 진입가) - 손절가)`다. 세 경우를 한 식으로 덮는다.

        - 주가가 올랐지만 추적손절이 아직 따라오지 않았다: 진입 시 계획한 위험 그대로다.
          현재가로 재면 계획보다 커져서, 상승장에서 스스로 신규 진입을 막는다. 9.2의
          한도 1.25%가 5종목 × 0.25%와 정확히 맞물리는 것은 이 한도가 진입 시점 계획
          위험의 합이라는 뜻이다.
        - 주가가 손절가 쪽으로 내려왔다: 남은 손실이 더 작으므로 그만큼만 센다.
        - 추적손절이 진입가 위로 올라갔다: 0이다. 더 이상 계획 위험을 쓰지 않는다.

        손절가가 진입가 아래인 승자의 **실제** 위험 금액은 이 값보다 크다. 그쪽은 낙폭
        한도와 일일 손실 한도가 따로 본다.
        """
        return self.shares * max(
            min(self.market_price, self.entry_price) - self.stop_price, 0.0
        )


@dataclass(frozen=True)
class AccountState:
    equity: float
    cash: float
    positions: tuple[OpenPosition, ...] = ()
    # 고점 대비 하락폭의 양수 비율. 0.06이면 -6%다.
    drawdown: float = 0.0
    # 손익 비율. 손실이면 음수다. 주간 손실은 9.2가 "다음 주" 예산을 깎으므로
    # 이번 주가 아니라 직전 주의 값을 본다.
    daily_pnl_fraction: float = 0.0
    prior_week_pnl_fraction: float = 0.0

    @property
    def exposure_value(self) -> float:
        return sum(position.market_value for position in self.positions)

    @property
    def exposure_fraction(self) -> float:
        return self.exposure_value / self.equity

    @property
    def open_risk(self) -> float:
        return sum(position.open_risk for position in self.positions)

    @property
    def open_risk_fraction(self) -> float:
        return self.open_risk / self.equity

    def sector_value(self, sector: str | None) -> float:
        if sector is None:
            return 0.0
        return sum(
            position.market_value
            for position in self.positions
            if position.sector == sector
        )

    def holds(self, symbol: str) -> bool:
        return any(position.symbol == symbol for position in self.positions)


@dataclass(frozen=True)
class Caps:
    """각 상한이 허용한 수량. 어느 제약이 구속했는지 감사에 남긴다."""

    by_risk: int
    by_capital: int
    by_liquidity: int
    by_exposure: int
    extra: tuple[tuple[str, int], ...] = ()


@dataclass(frozen=True)
class SizedIntent:
    symbol: str
    shares: int
    original_shares: int  # 19.3 감사 필드: 축소 전 수량
    # 신호 종가와 ATR는 집행이 갭 취소를 판정할 때 쓴다(10.1).
    reference_close: float
    atr14: float
    planned_entry: float
    initial_stop: float
    stop_distance: float
    planned_risk: float
    planned_risk_fraction: float
    min_qty_exception: bool
    effective_risk_ratio: float
    binding_constraint: str
    reduction_factor: float


@dataclass(frozen=True)
class SizingResult:
    symbol: str
    intent: SizedIntent | None
    rejection: Skip | None
    caps: Caps | None

    def __bool__(self) -> bool:
        """18장 의사코드의 `if not base_intent: continue`를 그대로 쓸 수 있게 한다."""
        return self.intent is not None


def _floor_shares(value: float) -> int:
    if value <= 0:
        return 0
    return int(math.floor(value + SHARE_EPSILON))


def planned_entry_price(
    candidate: Candidate, parameters: StrategyParameters
) -> float:
    """10.1이 허용하는 최악의 진입가. 자본·비중 계산은 모두 이 가격으로 한다."""
    return candidate.reference_close + parameters.entry_chase_atr * candidate.atr14


def reject(symbol: str, reason: str, detail: str, caps: Caps | None = None) -> SizingResult:
    return SizingResult(
        symbol=symbol, intent=None, rejection=Skip(symbol, reason, detail), caps=caps
    )


def size_candidate(
    candidate: Candidate,
    account: AccountState,
    regime: Regime,
    *,
    policy: PolicyVersion = PAPER_CORE_V1,
    gate_factor: float = 1.0,
    risk_budget_factor: float = 1.0,
    quantity_factor: float = 1.0,
    extra_caps: tuple[tuple[str, int], ...] = (),
) -> SizingResult:
    """후보 하나의 수량을 계산한다. 진입하지 않을 이유는 사유와 함께 돌려준다.

    `gate_factor`는 9.1의 `LLMGateFactor`다. Intelligence Plane이 아직 없으므로
    기본값은 1.0이고, `REDUCE` 판정을 흉내내는 값은 테스트와 A/B가 쓴다.
    `risk_budget_factor`·`quantity_factor`는 9.2의 주간 손실·낙폭 축소이고
    `extra_caps`는 섹터·상관 같은 포트폴리오 상한이다. 모두 `risk.py`가 계산한다.
    """
    profile = policy.profile
    if account.equity <= 0:
        raise SizingError("계좌 자산이 0 이하입니다.")
    for name, factor in (
        ("gate_factor", gate_factor),
        ("risk_budget_factor", risk_budget_factor),
        ("quantity_factor", quantity_factor),
    ):
        if not 0.0 <= factor <= 1.0:
            # 어떤 축소 계수도 Core보다 수량을 늘릴 수 없다(5장 권한 모델·8.1).
            raise SizingError(f"{name}는 0~1이어야 합니다: {factor}")

    parameters = policy.parameters
    stop_distance = parameters.stop_atr_multiple * candidate.atr14
    if stop_distance <= 0:
        return reject(candidate.symbol, "INVALID_STOP_DISTANCE", "ATR가 0입니다")

    # 실제 체결가는 다음 장에서 정해진다. 그 전에 정할 수 있는 것은 10.1이 허용한
    # 지정가 상한이고, 그 최악의 가격으로 자본 제약을 계산하면 과다 배분이 없다.
    planned_entry = planned_entry_price(candidate, parameters)
    initial_stop = planned_entry - stop_distance

    risk_budget = account.equity * profile.risk_per_trade * risk_budget_factor
    capital_allowance = min(
        account.cash, policy.limits.max_position_weight * account.equity
    )
    liquidity_allowance = (
        policy.limits.liquidity_cap_fraction * candidate.features.dollar_volume_median20
    )
    exposure_allowance = (
        min(profile.max_exposure, regime.max_exposure) * account.equity
        - account.exposure_value
    )

    caps = Caps(
        by_risk=_floor_shares(risk_budget / stop_distance),
        by_capital=_floor_shares(capital_allowance / planned_entry),
        by_liquidity=_floor_shares(liquidity_allowance / planned_entry),
        by_exposure=_floor_shares(exposure_allowance / planned_entry),
        extra=tuple(extra_caps),
    )

    # 9.1.1 최소수량 예외. 계산 수량이 1주 미만이면 암묵적 가격 필터가 되므로,
    # 실효 위험이 명시된 상한 안이면 1주만 허용한다. 2주 이상으로의 상향은 금지다.
    min_qty_exception = False
    if caps.by_risk >= 1:
        base_shares = caps.by_risk
    else:
        single_share_risk = stop_distance / account.equity
        if single_share_risk > profile.min_qty_risk_cap:
            return reject(
                candidate.symbol,
                "MIN_QTY_RISK_EXCEEDED",
                f"1주 위험 {single_share_risk:.4%} > 상한 {profile.min_qty_risk_cap:.4%}",
                caps,
            )
        base_shares = 1
        min_qty_exception = True

    reduction_factor = gate_factor * quantity_factor
    if min_qty_exception and reduction_factor < 1.0:
        # 0.75주·0.5주는 존재하지 않으므로 축소는 미진입으로 처리한다(9.1.1).
        return reject(
            candidate.symbol,
            "MIN_QTY_REDUCE_IMPOSSIBLE",
            f"최소수량 예외 포지션에 축소 계수 {reduction_factor}"
            f" (gate {gate_factor} × 수량 {quantity_factor})",
            caps,
        )

    limits = [
        ("RISK", base_shares),
        ("CAPITAL", caps.by_capital),
        ("LIQUIDITY", caps.by_liquidity),
        ("EXPOSURE", caps.by_exposure),
        *caps.extra,
    ]
    binding_constraint, original_shares = min(limits, key=lambda item: item[1])
    if min_qty_exception and binding_constraint == "RISK":
        binding_constraint = "MIN_QTY_EXCEPTION"

    if original_shares < 1:
        return reject(
            candidate.symbol,
            f"{binding_constraint}_ALLOWS_NO_SHARES",
            f"{binding_constraint} 상한이 0주입니다",
            caps,
        )

    shares = _floor_shares(original_shares * reduction_factor)
    if shares < 1:
        return reject(
            candidate.symbol,
            "REDUCED_TO_ZERO",
            f"{original_shares}주 × {reduction_factor} < 1주"
            f" (gate {gate_factor} × 수량 {quantity_factor})",
            caps,
        )

    planned_risk = shares * stop_distance
    planned_risk_fraction = planned_risk / account.equity
    return SizingResult(
        symbol=candidate.symbol,
        intent=SizedIntent(
            symbol=candidate.symbol,
            shares=shares,
            original_shares=original_shares,
            reference_close=candidate.reference_close,
            atr14=candidate.atr14,
            planned_entry=planned_entry,
            initial_stop=initial_stop,
            stop_distance=stop_distance,
            planned_risk=planned_risk,
            planned_risk_fraction=planned_risk_fraction,
            min_qty_exception=min_qty_exception,
            # 9.1.1 감사: 계획 위험 대비 실효 위험 비율.
            effective_risk_ratio=planned_risk_fraction / profile.risk_per_trade,
            binding_constraint=binding_constraint,
            reduction_factor=reduction_factor,
        ),
        rejection=None,
        caps=caps,
    )
