"""설계 7.3의 시장 상태.

시장 상태는 다음 날 방향을 맞히는 예측기가 아니라 위험 예산 조절기다. 그래서 판정은
세 상태와 그 상태가 허용하는 익스포저 상한만 돌려주고 종목 선택에는 관여하지 않는다.
"""

from __future__ import annotations

from dataclasses import dataclass

from .data import PointInTimeSnapshot
from .features import MIN_HISTORY, SMA_SLOW, FeatureUnavailable, realized_vol, sma

GREEN_MAX_VOL = 0.30
RED_MAX_VOL = 0.35
GREEN_MAX_DRAWDOWN = 0.05
RED_MIN_DRAWDOWN = 0.08
BELOW_SMA_RED_STREAK = 3

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


def classify_regime(snapshot: PointInTimeSnapshot, drawdown: float) -> Regime:
    """`drawdown`은 고점 대비 하락폭의 양수 비율이다(0.06이면 -6%).

    계좌 상태는 백테스터 원장이 준다. 이 함수는 계좌를 조회하지 않는다.
    """
    if drawdown < 0:
        raise ValueError("drawdown은 고점 대비 하락폭의 양수 비율입니다.")

    bars = snapshot.bars(snapshot.reference_symbol, MIN_HISTORY)
    needed = SMA_SLOW + BELOW_SMA_RED_STREAK - 1
    if len(bars) < needed:
        raise FeatureUnavailable(
            "SHORT_HISTORY",
            f"시장 상태 판정에 {snapshot.reference_symbol} 바가 {len(bars)}개뿐입니다"
            f" (최소 {needed}개)",
        )

    closes = [bar.adj_close for bar in bars]
    # 최근 날부터 거슬러 올라가며 SMA200 아래에 있던 연속 일수를 센다.
    streak = 0
    for offset in range(BELOW_SMA_RED_STREAK):
        window = closes[: len(closes) - offset]
        if window[-1] < sma(window, SMA_SLOW):
            streak += 1
        else:
            break
    above_sma200 = streak == 0
    vol = realized_vol(closes)

    reasons: list[str] = []
    if streak >= BELOW_SMA_RED_STREAK:
        reasons.append(f"SPY_BELOW_SMA200_{streak}D")
    if vol >= RED_MAX_VOL:
        reasons.append("VOL_GE_35")
    if drawdown >= RED_MIN_DRAWDOWN:
        reasons.append("DD_GE_8")

    if reasons:
        state = "RED"
    else:
        if not above_sma200:
            reasons.append("SPY_BELOW_SMA200")
        if vol >= GREEN_MAX_VOL:
            reasons.append("VOL_GE_30")
        if drawdown >= GREEN_MAX_DRAWDOWN:
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
