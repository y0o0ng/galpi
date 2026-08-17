"""`jt-j126-k42-sma200-stop` — `jt-j126-k42-sma200`에서 **청산만** 바꾼 challenger.

로드맵 Phase 4 · PR #19. 묻는 것은 alpha가 아니라 **의미**다.

    현재 sizing에 쓰는 2ATR를 실제 initial hard stop으로 집행할 것인가,
    아니면 그것은 손절 위험이 아니라 volatility-based position scale인가?

현재 `FIXED_HOLD`는 K42 만기만 집행하므로 **2ATR는 실제 청산 boundary가 아니다.** PR #14의
실측 exit 분포가 `MAX_HOLD` 505 · `DELISTED_EXIT` 8 · `UNRESOLVED_EXIT` 1로 손절 청산이
0건이었다. 그래서 "거래당 위험 0.25%"는 엄밀히 틀린 표현이고, 이 코어는 그 표현을 참으로
만드는 쪽을 실제로 재본다.

## 허용되는 청산은 정확히 둘이다

`FIXED_HOLD_HARD_STOP`은 `FIXED_HOLD`에 **초기 손절 하나만** 더한 것이다.

|살아 있는 것|꺼져 있는 것|
|---|---|
|`INITIAL_STOP` (진입 체결가 − 2 × 진입 시점 ATR14)|추적손절·추적 활성화|
|`MAX_HOLD` (K42)|시간손절|
||실적 청산|
||market trend break (PR #18)|

**예전 CORE exit를 통째로 켜는 것이 아니다.** `runs/jt-jk/`가 그 묶음을 이미 반증했다 —
`jt-core-exit`(RS-only + CORE exits 전부)는 총수익 **-23.07%**다. 그것은 손절·트레일링·
20일 시간손절·실적 청산이 **한 묶음**인 결과라 2ATR 손절 단독의 효과가 아니었고(로드맵
§7 C6), 이 코어가 그 단독 효과를 처음 잰다.

## 다른 것은 `exit_mode` 하나다

`jt-j126-k42-sma200`과 비교해 파라미터·한도·프로필·진입 모드·레짐 모드가 전부 같고
`exit_mode`만 다르다. `test_risk_semantics.py`가 dataclass 비교로 잠근다.

**정책 인스턴스를 공유하지는 않는다.** 공유하면 서명까지 같아지는데
`record_holdout_run`이 그 서명으로 홀드아웃 소모를 세므로 control과 challenger가 같은
행으로 덮어써진다(로드맵 §7 C3-1). 그래서 `policy_id`만 다르게 둔다.

## 손절가는 `initial_stop`이지 `stop_price`가 아니다

`Position.stop_price`는 최고 종가가 진입가 +1 ATR을 넘으면 추적손절로 바뀐다. 그것을
읽으면 처치가 둘이 된다. 모드별 손절가 선택은 `positions._active_stop` 한 곳에 있다.
"""

from __future__ import annotations

from backtest.modes import HARD_STOP_EXITS

from .definition import CoreDefinition
from .jt import jt_policy
from .jt_j126_k42 import FORMATION_SESSIONS
from .jt_j126_k42_sma200 import JT_J126_K42_SMA200
from .jt_k42 import HOLD_SESSIONS

JT_J126_K42_SMA200_STOP = CoreDefinition(
    name="jt-j126-k42-sma200-stop",
    # **파라미터 변경은 control과 글자 그대로 같다.** 서명만 갈리도록 `policy_id`만 다르다.
    policy=jt_policy(
        "research-jt-j126-k42-sma200-stop",
        f"JT J={FORMATION_SESSIONS}/skip=5, K={HOLD_SESSIONS}세션 만기 + 2ATR 초기 손절."
        " RS-only 진입, 낙폭 게이트 해제, SPY > SMA200일 때만 신규진입",
        max_hold_sessions=HOLD_SESSIONS,
        rs_lookback=FORMATION_SESSIONS,
    ),
    entry_mode=JT_J126_K42_SMA200.entry_mode,
    regime_mode=JT_J126_K42_SMA200.regime_mode,
    require_earnings_calendar=JT_J126_K42_SMA200.require_earnings_calendar,
    require_sector=JT_J126_K42_SMA200.require_sector,
    # 규칙에서 유일한 차이.
    exit_mode=HARD_STOP_EXITS,
    summary=f"{JT_J126_K42_SMA200.summary} · 2ATR 초기 손절 집행",
)
