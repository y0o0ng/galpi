"""`jt-random-k63` — 대조군. **`jt-k63`에서 랭킹만 무작위로 바꾼 것이다.**

유니버스도 게이트도 수량도 비용도 청산도 K= 같다. 다른 것은 상위 5개를 고르는 점수
하나뿐이라, 두 코어의 차이가 곧 **그 K에서 RS 랭킹의 기여**다.

**K마다 대조군이 따로 있어야 한다.** K를 늘리면 무작위 선택도 같이 좋아질 수 있다 —
오래 들고 있으면 시장 표류를 더 받고 회전이 줄어 비용도 준다. 같은 K의 무작위와 견주지
않으면 "보유기간이 좋아진 것"과 "랭킹이 좋아진 것"을 가를 수 없다.
"""

from __future__ import annotations

from backtest.modes import FIXED_HOLD_EXITS, MARKET_REGIME, RANDOM_ENTRY

from .definition import CoreDefinition
from .jt import jt_policy
from .jt_k63 import HOLD_SESSIONS

JT_RANDOM_K63 = CoreDefinition(
    name="jt-random-k63",
    policy=jt_policy(
        "research-jt-random-k63",
        "무작위 선택 대조군. K=63 만기 청산만, 낙폭 게이트 해제",
        max_hold_sessions=HOLD_SESSIONS,
    ),
    entry_mode=RANDOM_ENTRY,
    regime_mode=MARKET_REGIME,
    exit_mode=FIXED_HOLD_EXITS,
    require_earnings_calendar=False,
    summary=f"무작위 진입 · {HOLD_SESSIONS}세션 만기 청산만 (jt-k 대조군)",
)
