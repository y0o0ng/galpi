"""`jt-k84` — RS 상위를 사서 **84세션 뒤 무조건** 판다.

신호 연구가 잰 가장 긴 지평이 +84세션이다. **그 끝까지 들고 가면 어떻게 되는지**를 보는
자리이고, 신호 연구가 답을 준 범위의 경계라 이보다 더 늘리지 않는다.

**K를 늘리면 자리가 늦게 비어 신규 진입이 줄고 비용도 준다.** 그래서 좋아져도 그것이
신호 때문인지 덜 사서인지 구별해야 하고, 같은 K의 무작위 대조군(`jt-random-k84`)이
그 구별을 한다.
"""

from __future__ import annotations

from backtest.modes import FIXED_HOLD_EXITS, MARKET_REGIME, RS_ONLY_ENTRY

from .definition import CoreDefinition
from .jt import jt_policy

HOLD_SESSIONS = 84

JT_K84 = CoreDefinition(
    name="jt-k84",
    policy=jt_policy(
        "research-jt-k84",
        "JT J=63/skip=5, K=84세션 만기 청산만. RS-only 진입, 낙폭 게이트 해제",
        max_hold_sessions=HOLD_SESSIONS,
    ),
    entry_mode=RS_ONLY_ENTRY,
    regime_mode=MARKET_REGIME,
    require_earnings_calendar=False,
    exit_mode=FIXED_HOLD_EXITS,
    summary=f"RS 상위 진입 · {HOLD_SESSIONS}세션 만기 청산만",
)
