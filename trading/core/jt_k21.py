"""`jt-k21` — RS 상위를 사서 **21세션 뒤 무조건** 판다.

논문의 K=1개월 자리다. 청산이 만기 하나뿐이라 손절·추적손절·시간손절·실적 청산이 전부
없다. 보유기간의 기여를 재려면 K만 달라야 하기 때문이다 — 손절이 살아 있으면 "K일 보유"가
아니라 "손절 아니면 K일"이라 `jt-core-exit`과 견줄 때 무엇이 차이를 만들었는지 귀속할 수
없다.

**손절가가 없어지는 것은 아니다.** `stop_price`는 9.2의 열린 위험 회계에 계속 쓰이고
수량도 여전히 `R/2ATR`이다. 세 코어의 R 단위가 같아야 기대값을 나란히 볼 수 있다.
"""

from __future__ import annotations

from backtest.modes import MARKET_REGIME, FIXED_HOLD_EXITS, RS_ONLY_ENTRY

from .definition import CoreDefinition
from .jt import jt_policy

HOLD_SESSIONS = 21

JT_K21 = CoreDefinition(
    name="jt-k21",
    policy=jt_policy(
        "research-jt-k21",
        "JT J=63/skip=5, K=21세션 만기 청산만. RS-only 진입, 낙폭 게이트 해제",
        max_hold_sessions=HOLD_SESSIONS,
    ),
    entry_mode=RS_ONLY_ENTRY,
    regime_mode=MARKET_REGIME,
    # 진입 게이트를 껐으므로 실적 캘린더를 진입 조건으로 요구하지 않는다.
    require_earnings_calendar=False,
    exit_mode=FIXED_HOLD_EXITS,
    summary=f"RS 상위 진입 · {HOLD_SESSIONS}세션 만기 청산만",
)
