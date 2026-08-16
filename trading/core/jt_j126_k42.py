"""`jt-j126-k42` — `jt-k42`에서 **형성기간만** J=63 → 126으로 바꾼 challenger.

PR #12(`runs/signal-j-study/`)가 신호 층에서 J를 사다리로 열었고, 살아남은 challenger는
J126 하나였다. ALL primary(TOP5 +42)가 J63 +0.48%에서 J126 +1.03%였고 두 유니버스·여섯
지평·common anchor·비중첩 위상에서 반복적으로 J63 이상이었다.

이 코어는 그 신호 우위가 **슬롯·수량·비용·청산이 붙은 포트폴리오 층에서도 수익으로
번역되는가**를 묻기 위한 것이다. **번역된다는 가정이 아니다** — PR #10이 K에서, PR #11이
슬롯에서 각각 "신호 층 우위가 자동으로 번역되지 않는다"를 이미 보였다.

## 다른 것은 `rs_lookback` 하나다

`jt-k42`와 비교해 바뀐 것이 그것뿐이어야 J126에 귀속할 수 있다. K=42 · skip=5 · 슬롯 5 ·
TOP5 · 거래당 위험 0.25% · 총 계획 위험 1.25% · 최대 노출 60% · 비용 · 체결 · 레짐 ·
폐지 처리가 전부 같고, `test_j126.py`가 dataclass 수준에서 그것을 잠근다.

## 필드 이름이 `rs63_5`인 것은 유산이다

`Features.rs63_5`는 J=63을 전제로 붙은 이름이고, 이 코어에서는 그 자리에 실제로
`relative_strength(..., lookback=126, skip=5)` 값이 들어간다. **이름 때문에 연구 정의를
새로 구현하지 않는다** — 값이 맞는지는 테스트가 확인한다. 이번 PR의 목적은 J126 번역
실험이지 피처 이름 정리가 아니다.
"""

from __future__ import annotations

from backtest.modes import FIXED_HOLD_EXITS, MARKET_REGIME, RS_ONLY_ENTRY

from .definition import CoreDefinition
from .jt import jt_policy
from .jt_k42 import HOLD_SESSIONS

# PR #12에서 살아남은 challenger. 사다리를 여기서 다시 열지 않는다 —
# J21·J42는 신호 층에서 무작위 분포 안이었고 J189는 NDX100 재현이 약했다.
FORMATION_SESSIONS = 126

JT_J126_K42 = CoreDefinition(
    name="jt-j126-k42",
    policy=jt_policy(
        "research-jt-j126-k42",
        f"JT J={FORMATION_SESSIONS}/skip=5, K={HOLD_SESSIONS}세션 만기 청산만."
        " RS-only 진입, 낙폭 게이트 해제",
        max_hold_sessions=HOLD_SESSIONS,
        rs_lookback=FORMATION_SESSIONS,
    ),
    entry_mode=RS_ONLY_ENTRY,
    regime_mode=MARKET_REGIME,
    require_earnings_calendar=False,
    exit_mode=FIXED_HOLD_EXITS,
    summary=(
        f"RS(J={FORMATION_SESSIONS}, skip=5) 상위 진입 ·"
        f" {HOLD_SESSIONS}세션 만기 청산만"
    ),
)
