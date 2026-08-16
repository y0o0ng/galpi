"""`jt-j126-k42-sma200-exit` — `jt-j126-k42-sma200`에서 **청산만** 바꾼 challenger.

PR #16이 `SPY > SMA200` 신규진입 게이트를 승격시켰다(`ECONOMICS_AND_RELATIVE_IMPROVED`,
경우 2). 그 진입 가설은 하나다.

> 시장이 SMA200 위이고, 이 종목은 RS126 상위다.

**청산은 그 가설의 반증이어야 한다.** 자연스러운 반증은 시장이 SMA200 아래로 내려가는
것이고, **새 숫자가 하나도 없다** — 이미 승격된 조건의 거울상이다.

## 예전 CORE exit를 되살리는 것이 아니다

`runs/jt-jk/`가 이미 반증했다 — `jt-core-exit`(RS-only + CORE exits 전부)는 총수익
**-23.07%** · 기대값 -0.075다. 손절·트레일링·시간손절·실적 청산은 여전히 **없다.**
`SIGNAL_INVALIDATION`은 `FIXED_HOLD`(K세션 만기)에 시장 반증 하나를 더한 것뿐이다.

## 다른 것은 `exit_mode` 하나다

`jt-j126-k42-sma200`과 비교해 파라미터·한도·프로필·진입 모드·레짐 모드가 전부 같고
`exit_mode`만 다르다. `test_signal_invalidation.py`가 dataclass 비교로 잠근다.

**정책 인스턴스를 공유하지는 않는다.** 공유하면 서명까지 같아지는데
`record_holdout_run`이 그 서명으로 홀드아웃 소모를 세므로 control과 challenger가 같은
행으로 덮어써진다(로드맵 §7 C3-1). 그래서 `policy_id`만 다르게 둔다.

## 예약은 코어가 아니라 loop가 찍는다

`schedule_market_break`는 시장을 보지 않는다. 판정은 loop가 그날 **종가**에 하고 — 그때가
시장 종가를 알 수 있는 가장 이른 시점이다 — 실제 청산은 다음 세션 시초의 기존
pending-exit 경로가 한다. **오늘 시장 정보를 포지션의 장중 처리보다 앞으로 끌어오지
않는다.**
"""

from __future__ import annotations

from backtest.modes import SIGNAL_INVALIDATION_EXITS

from .definition import CoreDefinition
from .jt import jt_policy
from .jt_j126_k42 import FORMATION_SESSIONS
from .jt_j126_k42_sma200 import JT_J126_K42_SMA200
from .jt_k42 import HOLD_SESSIONS

JT_J126_K42_SMA200_EXIT = CoreDefinition(
    name="jt-j126-k42-sma200-exit",
    # **파라미터 변경은 control과 글자 그대로 같다.** 서명만 갈리도록 `policy_id`만 다르다.
    policy=jt_policy(
        "research-jt-j126-k42-sma200-exit",
        f"JT J={FORMATION_SESSIONS}/skip=5, K={HOLD_SESSIONS}세션 만기 + 시장 신호 반증"
        " 청산. RS-only 진입, 낙폭 게이트 해제, SPY > SMA200일 때만 신규진입",
        max_hold_sessions=HOLD_SESSIONS,
        rs_lookback=FORMATION_SESSIONS,
    ),
    entry_mode=JT_J126_K42_SMA200.entry_mode,
    regime_mode=JT_J126_K42_SMA200.regime_mode,
    require_earnings_calendar=JT_J126_K42_SMA200.require_earnings_calendar,
    require_sector=JT_J126_K42_SMA200.require_sector,
    # 규칙에서 유일한 차이.
    exit_mode=SIGNAL_INVALIDATION_EXITS,
    summary=f"{JT_J126_K42_SMA200.summary} · SPY <= SMA200이면 다음 시초 청산",
)
