"""`jt-k63` — RS 상위를 사서 **63세션 뒤 무조건** 판다.

`jt-k42`와 다른 것은 `max_hold_sessions` 하나뿐이다. 신호 연구(`runs/signal-rs63/`)가
RS63,5의 초과수익이 +84세션까지 감쇠하지 않는다고 재서, 그 수명이 포트폴리오에서도
값이 되는지 묻는 자리다.

**K를 늘리면 자리가 늦게 비어 신규 진입이 줄고 비용도 준다.** 그래서 좋아져도 그것이
신호 때문인지 덜 사서인지 구별해야 하고, 같은 K의 무작위 대조군(`jt-random-k63`)이
그 구별을 한다.
"""

from __future__ import annotations

from backtest.modes import FIXED_HOLD_EXITS, MARKET_REGIME, RS_ONLY_ENTRY

from .definition import CoreDefinition
from .jt import jt_policy

HOLD_SESSIONS = 63

JT_K63 = CoreDefinition(
    name="jt-k63",
    policy=jt_policy(
        "research-jt-k63",
        "JT J=63/skip=5, K=63세션 만기 청산만. RS-only 진입, 낙폭 게이트 해제",
        max_hold_sessions=HOLD_SESSIONS,
    ),
    entry_mode=RS_ONLY_ENTRY,
    regime_mode=MARKET_REGIME,
    require_earnings_calendar=False,
    exit_mode=FIXED_HOLD_EXITS,
    summary=f"RS 상위 진입 · {HOLD_SESSIONS}세션 만기 청산만",
)
