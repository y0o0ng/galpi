"""`jt-j126-k42-sma200` — `jt-j126-k42`에서 **시장 게이트만** 켠 challenger.

PR #15(`runs/market-condition-signal/`)가 신호 층에서 `SPY > SMA200` 구간에 RS 알파가 더
강하다는 것을 confirmatory re-cut으로 확인했고 `PROMOTE_TO_PR16`을 냈다. 이 코어는 그
게이트를 **실제 신규진입 규칙으로** 넣었을 때 포트폴리오 경제성이 어떻게 바뀌는지 재기
위한 것이다.

## 이것은 "나쁜 거래 제거"가 아니다

PR #15의 측정값이 그렇게 읽히지 않게 막는다.

|J|UP excess|DOWN excess|
|---|---|---|
|J63|+1.111%|**-1.640%**|
|**J126**|+1.188%|**+0.507%**|

**J63은 DOWN에서 alpha가 음수로 반전되지만 J126은 양수가 남는다.** 그래서 이 코어는
**신호 층에서 이미 양수인 구간을 통째로 포기하는** 처치다. 묻는 것은 "더 약하지만 여전히
양의 alpha를 가진 구간을 버렸을 때 전체가 좋아지는가"이지 "나쁜 거래를 걸러내는가"가
아니다.

## 다른 것은 `regime_mode` 하나다

`jt-j126-k42`와 **파라미터·한도·프로필이 전부 같고** 바뀐 것은 `regime_mode`뿐이다.
`test_market_gate.py`가 dataclass 비교로 그것을 잠근다.

**정책 인스턴스를 공유하지는 않는다.** 공유하면 서명까지 같아지는데, 저장소는 "코어 하나에
서명 하나"를 불변식으로 잡고 있고(`test_core.py`) `record_holdout_run`이 그 서명으로 홀드아웃
소모를 센다. 서명을 공유하면 control과 challenger가 같은 행으로 덮어써져 **계수기가 둘을
구분하지 못한다** — 로드맵 §7 C3-1이 적어둔 구멍이 그것이다. 그래서 `policy_id`만 다르게
둔다.

`regime_mode`는 정책 서명 **밖**의 실행 설정이라(`modes.py`) 동결된 `paper-core-v1`의
서명에 영향이 없다.

## 게이트가 하는 일과 하지 않는 일

`gate_new_entries`가 `SPY <= SMA200`에서 `new_entries`를 `blocked`로 바꾼다. 그것뿐이다.

- **익스포저 상한을 안 바꾼다** — `max_exposure`는 `MARKET`과 같은 1.0이고 실제 상한은
  프로필 60%가 잡는다
- **상태 이름을 안 바꾼다** — 레짐별 성과표를 `MARKET` 실행과 그대로 견줄 수 있다
- **청산을 안 바꾼다** — 게이트가 닫혀도 보유 포지션은 K42 만기까지 간다. 그래야 진입
  타이밍 효과만 잰다
- **계좌를 안 본다** — 낙폭이 들어가면 손실 → 방어 → 진입 없음 → 자산 정지의 고리가 닫힌다
"""

from __future__ import annotations

from backtest.modes import TREND_GATE_REGIME

from .definition import CoreDefinition
from .jt import jt_policy
from .jt_j126_k42 import FORMATION_SESSIONS, JT_J126_K42
from .jt_k42 import HOLD_SESSIONS

JT_J126_K42_SMA200 = CoreDefinition(
    name="jt-j126-k42-sma200",
    # **파라미터 변경은 `jt-j126-k42`와 글자 그대로 같다.** 서명만 갈리도록 `policy_id`만
    # 다르고, 값이 정말 같은지는 테스트가 dataclass 비교로 확인한다.
    policy=jt_policy(
        "research-jt-j126-k42-sma200",
        f"JT J={FORMATION_SESSIONS}/skip=5, K={HOLD_SESSIONS}세션 만기 청산만."
        " RS-only 진입, 낙폭 게이트 해제, SPY > SMA200일 때만 신규진입",
        max_hold_sessions=HOLD_SESSIONS,
        rs_lookback=FORMATION_SESSIONS,
    ),
    entry_mode=JT_J126_K42.entry_mode,
    exit_mode=JT_J126_K42.exit_mode,
    require_earnings_calendar=JT_J126_K42.require_earnings_calendar,
    require_sector=JT_J126_K42.require_sector,
    # 규칙에서 유일한 차이.
    regime_mode=TREND_GATE_REGIME,
    summary=f"{JT_J126_K42.summary} · SPY > SMA200일 때만 신규진입",
)
