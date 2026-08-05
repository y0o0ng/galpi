"""설계 9.1 포지션 크기와 9.1.1 최소수량 예외.

$$FinalShares=\\min(SharesByRisk, SharesByCapital, LiquidityCap)\\times LLMGateFactor$$

수량은 항상 정수다. 9.1.1이 소수점 주문을 금지했고, 백테스터도 실행과 같은 정수 수량을
써야 한다. 이 모듈은 계좌 상태를 읽기만 하고 원장을 바꾸지 않는다.

이 단계에서 집행하지 **않는** 한도는 다음이다. 20.1이 리스크 엔진을 별도 단계로 두었고,
아직 주문을 낼 수 있는 경로가 없어 미집행이 위험을 만들지 않는다.

- 9.2 동시 보유 5종목, 섹터 최대 비중, 계획된 총 손절 위험, 60일 상관 쌍 합산
- 9.2 일일·주간 손실과 고점 대비 낙폭에 따른 수량 축소·진입 중단·HALT

가격과 계좌는 모두 USD 기준이다. 9.4에 따라 환율은 예측하지 않고, 원화 환산과 환전
비용은 성과 보고 단계에서 분리해 다룬다.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from .candidates import Candidate, Skip
from .regime import Regime

ATR_STOP_MULTIPLE = 2.0  # 7.5 초기 손절: Entry - 2.0 × ATR14
ENTRY_CHASE_ATR = 0.25  # 10.1 최대 추격: 신호 종가 + 0.25 ATR

# 9.2 종목당 최대 비중(초기 자동운용). 9.1의 SharesByCapital이 쓰는 유일한 9.2 값이다.
MAX_POSITION_WEIGHT = 0.12

# 9.1의 LiquidityCap에는 설계에 수치가 없다. 20일 중앙값 달러거래대금의 1%로 정했다.
# 현재 계좌 규모에서는 한 번도 구속하지 않는다. 7.2의 유동성 하한이 5천만 달러이므로
# 이 상한은 50만 달러이고, 종목당 비중 상한이 먼저 걸린다. 계좌가 커질 때를 위한 값이다.
LIQUIDITY_CAP_FRACTION = 0.01

# 수량 계산의 나눗셈에서 생기는 1e-16 수준의 오차로 한 주가 깎이는 것을 막는다.
# 1e-9주는 경제적 의미가 없다.
SHARE_EPSILON = 1e-9


class SizingError(Exception):
    """입력이 크기 계산의 전제를 만족하지 못할 때 올린다."""


@dataclass(frozen=True)
class RiskProfile:
    """9.1 단계별 위험 프로필.

    지금은 `PAPER_VALIDATION` 하나만 정의한다. 다른 프로필은 그 단계에 도달할 때
    추가한다. 없는 값이 가장 안전하다.
    """

    name: str
    risk_per_trade: float
    max_exposure: float

    @property
    def min_qty_risk_cap(self) -> float:
        """9.1.1: 계좌의 0.5%, 단 해당 프로필 계획 위험의 2배를 상한으로 한다."""
        return min(0.005, 2 * self.risk_per_trade)


PAPER_VALIDATION = RiskProfile(
    name="PAPER_VALIDATION", risk_per_trade=0.0025, max_exposure=0.60
)


@dataclass(frozen=True)
class OpenPosition:
    """크기 계산이 보는 보유 포지션. 원장의 정본이 아니라 읽기 모델이다."""

    symbol: str
    shares: int
    market_price: float

    @property
    def market_value(self) -> float:
        return self.shares * self.market_price


@dataclass(frozen=True)
class AccountState:
    equity: float
    cash: float
    positions: tuple[OpenPosition, ...] = ()

    @property
    def exposure_value(self) -> float:
        return sum(position.market_value for position in self.positions)

    @property
    def exposure_fraction(self) -> float:
        return self.exposure_value / self.equity


@dataclass(frozen=True)
class Caps:
    """각 상한이 허용한 수량. 어느 제약이 구속했는지 감사에 남긴다."""

    by_risk: int
    by_capital: int
    by_liquidity: int
    by_exposure: int


@dataclass(frozen=True)
class SizedIntent:
    symbol: str
    shares: int
    original_shares: int  # 19.3 감사 필드: Gate 적용 전 수량
    planned_entry: float
    initial_stop: float
    stop_distance: float
    planned_risk: float
    planned_risk_fraction: float
    min_qty_exception: bool
    effective_risk_ratio: float
    binding_constraint: str


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


def _reject(symbol: str, reason: str, detail: str, caps: Caps | None = None) -> SizingResult:
    return SizingResult(
        symbol=symbol, intent=None, rejection=Skip(symbol, reason, detail), caps=caps
    )


def size_candidate(
    candidate: Candidate,
    account: AccountState,
    regime: Regime,
    *,
    profile: RiskProfile = PAPER_VALIDATION,
    gate_factor: float = 1.0,
) -> SizingResult:
    """후보 하나의 수량을 계산한다. 진입하지 않을 이유는 사유와 함께 돌려준다.

    `gate_factor`는 9.1의 `LLMGateFactor`다. Intelligence Plane이 아직 없으므로
    기본값은 1.0이고, `REDUCE` 판정을 흉내내는 값은 테스트와 A/B가 쓴다.
    """
    if account.equity <= 0:
        raise SizingError("계좌 자산이 0 이하입니다.")
    if not 0.0 <= gate_factor <= 1.0:
        # Gate는 Core보다 수량을 늘릴 수 없다(8.1·14.5).
        raise SizingError(f"gate_factor는 0~1이어야 합니다: {gate_factor}")

    stop_distance = ATR_STOP_MULTIPLE * candidate.atr14
    if stop_distance <= 0:
        return _reject(candidate.symbol, "INVALID_STOP_DISTANCE", "ATR가 0입니다")

    # 실제 체결가는 다음 장에서 정해진다. 그 전에 정할 수 있는 것은 10.1이 허용한
    # 지정가 상한이고, 그 최악의 가격으로 자본 제약을 계산하면 과다 배분이 없다.
    planned_entry = candidate.reference_close + ENTRY_CHASE_ATR * candidate.atr14
    initial_stop = planned_entry - stop_distance

    risk_budget = account.equity * profile.risk_per_trade
    capital_allowance = min(account.cash, MAX_POSITION_WEIGHT * account.equity)
    liquidity_allowance = (
        LIQUIDITY_CAP_FRACTION * candidate.features.dollar_volume_median20
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
    )

    # 9.1.1 최소수량 예외. 계산 수량이 1주 미만이면 암묵적 가격 필터가 되므로,
    # 실효 위험이 명시된 상한 안이면 1주만 허용한다. 2주 이상으로의 상향은 금지다.
    min_qty_exception = False
    if caps.by_risk >= 1:
        base_shares = caps.by_risk
    else:
        single_share_risk = stop_distance / account.equity
        if single_share_risk > profile.min_qty_risk_cap:
            return _reject(
                candidate.symbol,
                "MIN_QTY_RISK_EXCEEDED",
                f"1주 위험 {single_share_risk:.4%} > 상한 {profile.min_qty_risk_cap:.4%}",
                caps,
            )
        base_shares = 1
        min_qty_exception = True

    if min_qty_exception and gate_factor < 1.0:
        # 0.75주·0.5주는 존재하지 않으므로 REDUCE는 미진입으로 처리한다(9.1.1).
        return _reject(
            candidate.symbol,
            "MIN_QTY_REDUCE_IMPOSSIBLE",
            f"최소수량 예외 포지션에 gate_factor {gate_factor}",
            caps,
        )

    limits = (
        ("RISK", base_shares),
        ("CAPITAL", caps.by_capital),
        ("LIQUIDITY", caps.by_liquidity),
        ("EXPOSURE", caps.by_exposure),
    )
    binding_constraint, original_shares = min(limits, key=lambda item: item[1])
    if min_qty_exception and binding_constraint == "RISK":
        binding_constraint = "MIN_QTY_EXCEPTION"

    if original_shares < 1:
        return _reject(
            candidate.symbol,
            f"{binding_constraint}_ALLOWS_NO_SHARES",
            f"{binding_constraint} 상한이 0주입니다",
            caps,
        )

    shares = _floor_shares(original_shares * gate_factor)
    if shares < 1:
        return _reject(
            candidate.symbol,
            "GATE_REDUCED_TO_ZERO",
            f"{original_shares}주 × {gate_factor} < 1주",
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
            planned_entry=planned_entry,
            initial_stop=initial_stop,
            stop_distance=stop_distance,
            planned_risk=planned_risk,
            planned_risk_fraction=planned_risk_fraction,
            min_qty_exception=min_qty_exception,
            # 9.1.1 감사: 계획 위험 대비 실효 위험 비율.
            effective_risk_ratio=planned_risk_fraction / profile.risk_per_trade,
            binding_constraint=binding_constraint,
        ),
        rejection=None,
        caps=caps,
    )
