"""설계 7.3의 시장 상태.

시장 상태는 다음 날 방향을 맞히는 예측기가 아니라 위험 예산 조절기다. 그래서 판정은
세 상태와 그 상태가 허용하는 익스포저 상한만 돌려주고 종목 선택에는 관여하지 않는다.
"""

from __future__ import annotations

from dataclasses import dataclass

from .data import PointInTimeSnapshot
from .features import FeatureUnavailable, realized_vol, sma
from .policy import StrategyParameters

# 7.3 표의 상태 정의다. 상태마다 무엇이 허용되는지는 지표 파라미터가 아니라 상태의 뜻이다.
MAX_EXPOSURE = {"GREEN": 1.00, "YELLOW": 0.50, "RED": 0.25}
NEW_ENTRIES = {"GREEN": "allow", "YELLOW": "top_only", "RED": "blocked"}


@dataclass(frozen=True)
class Regime:
    state: str
    max_exposure: float
    new_entries: str
    above_sma200: bool
    below_sma200_streak: int
    realized_vol20: float
    drawdown: float
    reasons: tuple[str, ...]


def classify_regime(
    snapshot: PointInTimeSnapshot, drawdown: float, parameters: StrategyParameters
) -> Regime:
    """`drawdown`은 고점 대비 하락폭의 양수 비율이다(0.06이면 -6%).

    계좌 상태는 백테스터 원장이 준다. 이 함수는 계좌를 조회하지 않는다.
    """
    if drawdown < 0:
        raise ValueError("drawdown은 고점 대비 하락폭의 양수 비율입니다.")

    bars = snapshot.bars(snapshot.reference_symbol, parameters.min_history_sessions)
    needed = parameters.sma_slow + parameters.below_sma_red_streak - 1
    if len(bars) < needed:
        raise FeatureUnavailable(
            "SHORT_HISTORY",
            f"시장 상태 판정에 {snapshot.reference_symbol} 바가 {len(bars)}개뿐입니다"
            f" (최소 {needed}개)",
        )

    closes = [bar.adj_close for bar in bars]
    # 최근 날부터 거슬러 올라가며 SMA200 아래에 있던 연속 일수를 센다.
    streak = 0
    for offset in range(parameters.below_sma_red_streak):
        window = closes[: len(closes) - offset]
        if window[-1] < sma(window, parameters.sma_slow):
            streak += 1
        else:
            break
    above_sma200 = streak == 0
    vol = realized_vol(closes, parameters.vol_window)

    reasons: list[str] = []
    if streak >= parameters.below_sma_red_streak:
        reasons.append(f"SPY_BELOW_SMA200_{streak}D")
    if vol >= parameters.red_max_vol:
        reasons.append("VOL_GE_35")
    if drawdown >= parameters.red_min_drawdown:
        reasons.append("DD_GE_8")

    if reasons:
        state = "RED"
    else:
        if not above_sma200:
            reasons.append("SPY_BELOW_SMA200")
        if vol >= parameters.green_max_vol:
            reasons.append("VOL_GE_30")
        if drawdown >= parameters.green_max_drawdown:
            reasons.append("DD_GE_5")
        state = "YELLOW" if reasons else "GREEN"
        if not reasons:
            reasons.append("ALL_CLEAR")

    return Regime(
        state=state,
        max_exposure=MAX_EXPOSURE[state],
        new_entries=NEW_ENTRIES[state],
        above_sma200=above_sma200,
        below_sma200_streak=streak,
        realized_vol20=vol,
        drawdown=drawdown,
        reasons=tuple(reasons),
    )
