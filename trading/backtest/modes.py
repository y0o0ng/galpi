"""진입·청산 모드 이름.

**정책 서명 밖의 실행 설정이다.** `StrategyParameters`에 넣으면 `canonical_text`가 바뀌어
동결된 `paper-core-v1`의 서명까지 달라지고, 그 서명으로 낸 2026-08-10 기준선 보고서가
비교 대상에서 빠진다. 대신 `BacktestConfig`가 들고 실행 보고서가 값을 찍는다.

**여기 따로 둔 이유는 순환 import다.** `core/`의 코어 정의가 모드 이름을 쓰고, 그 코어를
`candidates`·`loop`가 기본 정책으로 다시 가져온다. 이름이 `candidates`에 있으면
`candidates → core → candidates`가 된다. 아무것도 import하지 않는 이 모듈이 그 고리를 끊는다.
"""

from __future__ import annotations

# 7.4 진입 게이트를 다 보는 `CORE`와, 게이트 없이 유니버스 안 RS 상위만 사는 `RS_ONLY`.
CORE_ENTRY = "CORE"
RS_ONLY_ENTRY = "RS_ONLY"
# 대조군. 유니버스와 게이트는 `RS_ONLY`와 같고 **점수만 무작위**다. 랭킹이 실제로
# 무언가를 하는지 재려면 랭킹만 없앤 실행이 있어야 한다.
RANDOM_ENTRY = "RANDOM"
ENTRY_MODES = (CORE_ENTRY, RS_ONLY_ENTRY, RANDOM_ENTRY)

# 7.5 청산을 다 보는 `CORE`와, K세션 만기 하나만 남기는 `FIXED_HOLD`.
CORE_EXITS = "CORE"
FIXED_HOLD_EXITS = "FIXED_HOLD"
# `FIXED_HOLD`에 **시장 신호 반증 청산** 하나를 더한 것. K세션 만기는 그대로이고 손절·
# 트레일링·시간손절·실적 청산은 여전히 없다. 시장 판정은 포지션이 아니라 loop가 하므로
# (그날 종가를 장중 처리보다 앞에 끌어오면 look-ahead다) 예약만 loop가 찍는다(PR #18).
SIGNAL_INVALIDATION_EXITS = "SIGNAL_INVALIDATION"
# `FIXED_HOLD`에 **초기 손절 하나만** 더한 것. 이름이 `HARD_STOP`이 아니라
# `FIXED_HOLD_HARD_STOP`인 이유는 K세션 만기가 그대로 살아 있기 때문이다. 추적손절·
# 시간손절·실적 청산은 여전히 없고, 장중 검사는 진입 시점에 고정된 `initial_stop`만
# 읽는다 — `stop_price`는 +1 ATR 뒤 추적손절로 변하므로 그것을 쓰면 처치가 둘이 된다(PR #19).
HARD_STOP_EXITS = "FIXED_HOLD_HARD_STOP"
EXIT_MODES = (
    CORE_EXITS,
    FIXED_HOLD_EXITS,
    SIGNAL_INVALIDATION_EXITS,
    HARD_STOP_EXITS,
)

# 7.3의 GREEN/YELLOW/RED를 내는 `CORE`와, 시장만 보고 라벨을 붙이는 `MARKET`.
CORE_REGIME = "CORE"
MARKET_REGIME = "MARKET"
# `MARKET`과 같은 라벨을 붙이되 `SPY <= SMA200`에서 **신규 진입만** 막는다. 익스포저
# 상한도 청산도 건드리지 않으므로 `MARKET`과의 차이가 정확히 하나다(PR #16 Phase 1).
TREND_GATE_REGIME = "TREND_GATE"
REGIME_MODES = (CORE_REGIME, MARKET_REGIME, TREND_GATE_REGIME)

# 정체불명 계열의 청산가 경계조건. 회수 100%와 0%다.
LAST_CLOSE_EXIT = "LAST_CLOSE"
ZERO_EXIT = "ZERO"
UNRESOLVED_EXIT_PRICES = (LAST_CLOSE_EXIT, ZERO_EXIT)
