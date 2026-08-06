"""설계 9.2 하드 한도. Decision Governor의 결정론적 부분이다.

9.2 표에는 한도마다 **조치** 열이 있고 그 열을 그대로 따른다. 축소로 지나갈 수 있는
한도를 거부로 만들면 필요 이상으로 거래를 잃고, 거부해야 하는 한도를 축소로 만들면
한도를 넘긴 상태로 진입한다.

|한도|조치|여기서 하는 일|
|---|---|---|
|종목당 최대 비중 12%|주문 거부|`sizing`의 자본 상한이라 넘는 수량은 애초에 계산되지 않는다|
|동시 보유 5종목|추가 후보 대기|`MAX_POSITIONS_REACHED`로 거부|
|섹터 최대 비중 25%|같은 섹터 후보 건너뜀|수량 확정 후 초과하면 `SECTOR_WEIGHT_EXCEEDED`로 거부|
|계획된 총 손절 위험 1.25%|신규 진입 금지|수량 확정 후 초과하면 `TOTAL_PLANNED_RISK_EXCEEDED`로 거부|
|60일 상관 0.75 쌍 합산 25%|수량 축소|상한을 계산해 `sizing`에 넘김|
|일일 손실 -1.0%|당일 신규 주문 중단|계좌 게이트에서 전면 차단|
|주간 손실 -2.5%|다음 주 위험 예산 50%|위험 예산 배수 0.5|
|낙폭 -5%|수량 50%|수량 배수 0.5|
|낙폭 -7%|신규 진입 중단|계좌 게이트에서 전면 차단|
|낙폭 -10%|HALT|계좌 게이트에서 차단하고 `halt` 표시|

여기서 정한 것이 두 개 있다.

- **이미 보유한 종목은 재진입하지 않는다**(`ALREADY_HELD`). 설계에 물타기·추가매수
  규칙이 없고 진입 규칙은 신규 포지션을 전제한다. 종목당 비중 12%가 남아 있어도
  추가하지 않는다.
- **섹터를 모르면 진입하지 않는다**(`SECTOR_UNKNOWN`). 판정할 수 없는 한도는 지킬 수
  없다. 종목 분류가 없는 데이터로 엔진만 돌릴 때는 `require_sector=False`로 끄지만
  PAPER·LIVE는 켜고 돌린다.
"""

from __future__ import annotations

from dataclasses import dataclass

from .candidates import Candidate
from .data import PointInTimeSnapshot
from .features import CORRELATION_WINDOW, FeatureUnavailable, correlation
from .policy import DEFAULT_PAPER_POLICY, PolicyVersion
from .regime import Regime
from .sizing import (
    AccountState,
    OpenPosition,
    SizingResult,
    planned_entry_price,
    reject,
    size_candidate,
)


@dataclass(frozen=True)
class CorrelatedPeer:
    """상관 한도가 걸리는 보유 포지션. `coefficient`가 None이면 판정 불가다."""

    symbol: str
    market_value: float
    coefficient: float | None


@dataclass(frozen=True)
class AccountGate:
    """계좌 전체에 걸리는 9.2 조치. 후보마다가 아니라 하루에 한 번 계산한다."""

    blocked: bool
    halt: bool
    risk_budget_factor: float
    quantity_factor: float
    reasons: tuple[str, ...]


def account_gate(
    account: AccountState, policy: PolicyVersion = DEFAULT_PAPER_POLICY
) -> AccountGate:
    """일일·주간 손실과 낙폭에 따른 차단·축소를 판정한다."""
    limits = policy.limits
    reasons: list[str] = []
    blocked = False
    halt = False
    risk_budget_factor = 1.0
    quantity_factor = 1.0

    if account.daily_pnl_fraction <= -limits.daily_loss_limit:
        blocked = True
        reasons.append("DAILY_LOSS_LIMIT")
    if account.prior_week_pnl_fraction <= -limits.weekly_loss_limit:
        # 9.2는 "다음 주 위험 예산 50%"다. 이번 주가 아니라 직전 주 성적을 본다.
        risk_budget_factor = limits.weekly_risk_budget_factor
        reasons.append("WEEKLY_LOSS_BUDGET_CUT")

    drawdown = account.drawdown
    if drawdown >= limits.drawdown_killswitch:
        blocked = halt = True
        reasons.append("DRAWDOWN_KILLSWITCH")
    elif drawdown >= limits.drawdown_halt:
        blocked = halt = True
        reasons.append("DRAWDOWN_HALT")
    elif drawdown >= limits.drawdown_block_entries:
        blocked = True
        reasons.append("DRAWDOWN_BLOCK_ENTRIES")
    elif drawdown >= limits.drawdown_quantity_cut:
        quantity_factor = limits.drawdown_quantity_factor
        reasons.append("DRAWDOWN_QUANTITY_CUT")

    if not reasons:
        reasons.append("ALL_CLEAR")
    return AccountGate(
        blocked=blocked,
        halt=halt,
        risk_budget_factor=risk_budget_factor,
        quantity_factor=quantity_factor,
        reasons=tuple(reasons),
    )


def correlated_peers(
    snapshot: PointInTimeSnapshot,
    symbol: str,
    positions: tuple[OpenPosition, ...],
    threshold: float,
) -> tuple[CorrelatedPeer, ...]:
    """60일 로그수익률 상관이 문턱 이상인 보유 포지션.

    상관을 계산할 수 없으면(이력 부족·거래일 불일치) 상관으로 본다. 판정 불가를
    무상관으로 처리하면 한도를 조용히 비활성화하는 쪽이라 안전한 방향이 아니다.
    """
    own_bars = snapshot.bars(symbol, CORRELATION_WINDOW + 1)
    own_dates = [bar.trade_date for bar in own_bars]
    own_closes = [bar.adj_close for bar in own_bars]

    found: list[CorrelatedPeer] = []
    for position in positions:
        peer_bars = snapshot.bars(position.symbol, CORRELATION_WINDOW + 1)
        peer_dates = [bar.trade_date for bar in peer_bars]
        coefficient: float | None = None
        if len(own_dates) == CORRELATION_WINDOW + 1 and peer_dates == own_dates:
            try:
                coefficient = correlation(
                    own_closes, [bar.adj_close for bar in peer_bars]
                )
            except FeatureUnavailable:
                coefficient = None
        if coefficient is None or coefficient >= threshold:
            found.append(
                CorrelatedPeer(
                    symbol=position.symbol,
                    market_value=position.market_value,
                    coefficient=coefficient,
                )
            )
    return tuple(found)


def evaluate_candidate(
    candidate: Candidate,
    account: AccountState,
    regime: Regime,
    snapshot: PointInTimeSnapshot,
    *,
    policy: PolicyVersion = DEFAULT_PAPER_POLICY,
    gate: AccountGate | None = None,
    gate_factor: float = 1.0,
    require_sector: bool = True,
) -> SizingResult:
    """9.2를 적용한 뒤 수량을 계산한다. 18장의 `risk_engine.size_candidate`다.

    `gate`를 넘기지 않으면 여기서 계산한다. 하루 여러 후보를 볼 때는 loop가 한 번
    계산해 넘긴다.
    """
    limits = policy.limits
    resolved_gate = gate if gate is not None else account_gate(account, policy)
    if resolved_gate.blocked:
        return reject(
            candidate.symbol,
            resolved_gate.reasons[0],
            "계좌 게이트가 신규 진입을 막았습니다: " + ", ".join(resolved_gate.reasons),
        )

    if account.holds(candidate.symbol):
        return reject(candidate.symbol, "ALREADY_HELD", "이미 보유한 종목입니다")

    if len(account.positions) >= limits.max_positions:
        return reject(
            candidate.symbol,
            "MAX_POSITIONS_REACHED",
            f"동시 보유 {len(account.positions)}종목 >= 상한 {limits.max_positions}종목",
        )

    sector = snapshot.sector(candidate.symbol)
    if sector is None and require_sector:
        return reject(
            candidate.symbol, "SECTOR_UNKNOWN", "종목 분류가 없어 섹터 한도를 판정할 수 없습니다"
        )

    planned_entry = planned_entry_price(candidate)
    extra_caps: list[tuple[str, int]] = []
    peers = correlated_peers(
        snapshot, candidate.symbol, account.positions, limits.correlation_threshold
    )
    if peers:
        # "쌍 합산 25%"이므로 가장 큰 상관 포지션 하나와의 합이 상한을 넘지 않게 한다.
        tightest = max(peer.market_value for peer in peers)
        allowance = limits.max_correlated_pair_weight * account.equity - tightest
        extra_caps.append(
            ("CORRELATION", max(0, int((allowance + 1e-9) // planned_entry)))
        )

    result = size_candidate(
        candidate,
        account,
        regime,
        policy=policy,
        gate_factor=gate_factor,
        risk_budget_factor=resolved_gate.risk_budget_factor,
        quantity_factor=resolved_gate.quantity_factor,
        extra_caps=tuple(extra_caps),
    )
    if not result:
        return result

    intent = result.intent
    position_value = intent.shares * planned_entry

    sector_value = account.sector_value(sector) + position_value
    sector_cap = limits.max_sector_weight * account.equity
    if sector is not None and sector_value > sector_cap:
        return reject(
            candidate.symbol,
            "SECTOR_WEIGHT_EXCEEDED",
            f"{sector} 비중 {sector_value / account.equity:.2%}"
            f" > 상한 {limits.max_sector_weight:.2%}",
            result.caps,
        )

    planned_total_risk = account.open_risk + intent.planned_risk
    total_risk_cap = limits.max_total_planned_risk * account.equity
    if planned_total_risk > total_risk_cap:
        return reject(
            candidate.symbol,
            "TOTAL_PLANNED_RISK_EXCEEDED",
            f"계획된 총 손절 위험 {planned_total_risk / account.equity:.4%}"
            f" > 상한 {limits.max_total_planned_risk:.4%}",
            result.caps,
        )

    return result
