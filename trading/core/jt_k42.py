"""`jt-k42` — RS 상위를 사서 **42세션 뒤 무조건** 판다.

논문의 K=2개월 자리다. `jt-k21`과 다른 것은 `max_hold_sessions` 하나뿐이라 두 코어의 차이가
곧 보유기간의 기여다.

K가 길면 자리가 늦게 비어 신규 진입이 줄어든다. 거래 수 감소는 규칙이 막은 것이 아니라
**포트폴리오가 차 있어서**이므로, 진입 깔때기의 `MAX_POSITIONS_REACHED`를 함께 본다.
"""

from __future__ import annotations

from backtest.modes import MARKET_REGIME, FIXED_HOLD_EXITS, RS_ONLY_ENTRY

from .definition import CoreDefinition
from .jt import jt_policy

HOLD_SESSIONS = 42

JT_K42 = CoreDefinition(
    name="jt-k42",
    policy=jt_policy(
        "research-jt-k42",
        "JT J=63/skip=5, K=42세션 만기 청산만. RS-only 진입, 낙폭 게이트 해제",
        max_hold_sessions=HOLD_SESSIONS,
    ),
    entry_mode=RS_ONLY_ENTRY,
    regime_mode=MARKET_REGIME,
    # 진입 게이트를 껐으므로 실적 캘린더를 진입 조건으로 요구하지 않는다.
    require_earnings_calendar=False,
    exit_mode=FIXED_HOLD_EXITS,
    summary=f"RS 상위 진입 · {HOLD_SESSIONS}세션 만기 청산만",
)
