"""`jt-random-k42` — 대조군. **`jt-k42`에서 랭킹만 무작위로 바꾼 것이다.**

유니버스도 게이트도 수량도 비용도 청산도 K=42도 같다. 다른 것은 상위 5개를 고르는 점수
하나뿐이라, 두 코어의 차이가 곧 **RS 랭킹의 기여**다.

**대조군이 없으면 `jt-k42`의 +0.229R을 읽을 수 없다.** 그 값이 모멘텀 때문인지, 아니면
"유동성 있는 대형주를 42세션 들고 있으면 원래 그 정도"인지 구별이 안 된다. 무작위 선택도
같은 값을 내면 랭킹은 아무 일도 하지 않은 것이다.

**시드 하나는 표본 하나다.** 무작위 선택 한 번은 운이 좋을 수도 나쁠 수도 있으므로 여러
시드로 돌려 분포를 보고, `jt-k42`가 그 분포의 어디에 있는지를 본다. 시드는 규칙이 아니라
실행 조건이라 코어가 아니라 `BacktestConfig.random_seed`에 있다.
"""

from __future__ import annotations

from backtest.modes import FIXED_HOLD_EXITS, MARKET_REGIME, RANDOM_ENTRY

from .definition import CoreDefinition
from .jt import jt_policy
from .jt_k42 import HOLD_SESSIONS

JT_RANDOM_K42 = CoreDefinition(
    name="jt-random-k42",
    policy=jt_policy(
        "research-jt-random-k42",
        "무작위 선택 대조군. K=42 만기 청산만, 낙폭 게이트 해제",
        max_hold_sessions=HOLD_SESSIONS,
    ),
    entry_mode=RANDOM_ENTRY,
    regime_mode=MARKET_REGIME,
    exit_mode=FIXED_HOLD_EXITS,
    require_earnings_calendar=False,
    summary=f"무작위 진입 · {HOLD_SESSIONS}세션 만기 청산만 (jt-k42의 대조군)",
)
