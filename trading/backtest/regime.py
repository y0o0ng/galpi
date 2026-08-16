"""설계 7.3의 시장 상태.

시장 상태는 다음 날 방향을 맞히는 예측기가 아니라 위험 예산 조절기다. 그래서 판정은
세 상태와 그 상태가 허용하는 익스포저 상한만 돌려주고 종목 선택에는 관여하지 않는다.

## 분류기가 둘이다

`classify_regime`이 7.3의 GREEN/YELLOW/RED이고 **동결된 core-1이 쓰는 정본**이다. 여기를
고치면 서명은 그대로인 채 기준선의 동작만 바뀌어서 아무도 못 잡는다. 그래서 연구용
분류기는 함수를 따로 둔다.

`classify_market_regime`은 **계좌를 보지 않고 시장만 라벨링한다.** 2026-08-10 기준선과
2026-08-14 J/K 첫 실행이 둘 다 같은 이유로 죽었다 — 계좌 낙폭이 상태에 들어가 있으면
손실 → 방어 상태 → 진입 없음 → 자산 정지 → 낙폭 영구 고정의 고리가 닫힌다. 계좌를 빼면
그 고리가 성립하지 않는다.

라벨은 추세 2×2와 변동성 2칸의 곱이다.

|추세|정의|
|---|---|
|`BULL`|종가 > SMA50, 종가 > SMA200|
|`CORRECTION`|종가 ≤ SMA50, 종가 > SMA200|
|`RECOVERY`|종가 > SMA50, 종가 ≤ SMA200|
|`BEAR`|종가 ≤ SMA50, 종가 ≤ SMA200|

**`MARKET`은 아무것도 막지 않는다.** `new_entries`가 항상 `allow`이고 익스포저 상한이
1.0이라(실제 상한은 프로필 60%가 잡는다) 레짐이 진입 조건에 관여하지 않는다. 기여는
막아서가 아니라 **레짐별 성과표로 사후에** 읽는다 — 막아버리면 그 구간에 표본이 없어서
막은 것이 잘한 일이었는지 영영 모른다.
"""

from __future__ import annotations

from dataclasses import dataclass, replace

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
    # `MARKET` 분류기만 채운다. 두 축을 따로 들고 있어야 레짐별 성과를 축별로도 접을 수
    # 있고, 라벨 문자열을 다시 쪼개 읽는 코드를 만들지 않는다.
    trend: str | None = None
    volatility: str | None = None


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


# 추세 2×2. 이름은 종가가 두 이동평균의 어느 쪽에 있는지로만 정해진다.
TRENDS = ("BULL", "CORRECTION", "RECOVERY", "BEAR")
HIGH_VOL = "HIGH_VOL"
LOW_VOL = "LOW_VOL"


def market_trend(close: float, sma_fast: float, sma_slow: float) -> str:
    if close > sma_slow:
        return "BULL" if close > sma_fast else "CORRECTION"
    return "RECOVERY" if close > sma_fast else "BEAR"


def classify_market_regime(
    snapshot: PointInTimeSnapshot, parameters: StrategyParameters
) -> Regime:
    """시장만 보고 라벨을 붙인다. **계좌를 인자로 받지 않는다.**

    받지 않는 것이 요점이다. 낙폭을 인자로 두면 언젠가 누가 넘기고, 그 순간 손실이
    진입을 막고 진입이 없어 손실이 회복되지 않는 고리가 다시 닫힌다.

    변동성 문턱은 `green_max_vol`을 쓴다. 새 필드를 만들면 `canonical_text`가 바뀌어
    동결된 core-1의 서명이 깨지기 때문이고, 그 필드가 정책 안의 유일한 변동성 문턱이다.
    이 모드에서 그 값의 뜻은 "이 위는 high vol"이다.
    """
    bars = snapshot.bars(snapshot.reference_symbol, parameters.min_history_sessions)
    if len(bars) < parameters.sma_slow:
        raise FeatureUnavailable(
            "SHORT_HISTORY",
            f"시장 상태 판정에 {snapshot.reference_symbol} 바가 {len(bars)}개뿐입니다"
            f" (최소 {parameters.sma_slow}개)",
        )

    closes = [bar.adj_close for bar in bars]
    close = closes[-1]
    sma_fast = sma(closes, parameters.sma_fast)
    sma_slow = sma(closes, parameters.sma_slow)
    vol = realized_vol(closes, parameters.vol_window)

    trend = market_trend(close, sma_fast, sma_slow)
    volatility = HIGH_VOL if vol >= parameters.green_max_vol else LOW_VOL

    return Regime(
        state=f"{trend}/{volatility}",
        # 레짐은 아무것도 막지 않는다. 실제 상한은 프로필의 60%가 잡는다.
        max_exposure=1.0,
        new_entries="allow",
        above_sma200=close > sma_slow,
        below_sma200_streak=0,
        realized_vol20=vol,
        # 계좌를 보지 않는다는 사실을 값으로도 남긴다.
        drawdown=0.0,
        reasons=(trend, volatility),
        trend=trend,
        volatility=volatility,
    )


# `SPY <= SMA200`에서 신규 진입을 막았다는 표식. 상태 이름에 섞지 않고 사유로만 남긴다 —
# 이름을 바꾸면 레짐별 성과표가 `MARKET` 실행과 견줄 수 없게 된다.
TREND_GATE_BLOCKED = "SPY_BELOW_SMA200_GATE"


def gate_new_entries(regime: Regime) -> Regime:
    """`SPY <= SMA200`이면 **신규 진입만** 막는다. PR #16의 처치가 이 함수 하나다.

    **바꾸는 것이 `new_entries` 하나뿐인 것이 요점이다.** 익스포저 상한(`max_exposure`)도
    상태 이름도 그대로 두므로 `MARKET` 실행과 레짐별 성과표를 그대로 견줄 수 있고, 두 실행의
    차이를 진입 타이밍 하나에 귀속할 수 있다.

    **청산은 건드리지 않는다.** 게이트가 닫혀도 보유 포지션은 `positions.run_session`이
    그대로 굴려 K세션 만기까지 간다. 청산까지 바꾸면 진입 효과와 청산 효과가 섞인다.

    **계좌를 인자로 받지 않는다.** 낙폭이 들어가면 손실 → 방어 → 진입 없음 → 자산 정지 →
    낙폭 영구 고정의 고리가 닫힌다(7.3의 자기 잠금).
    """
    if regime.above_sma200:
        return regime
    return replace(
        regime,
        new_entries="blocked",
        reasons=regime.reasons + (TREND_GATE_BLOCKED,),
    )
