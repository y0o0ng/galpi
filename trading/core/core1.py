"""`paper-core-v1` — 동결된 기준선 코어.

2026-08-10 15년 실데이터 14.7 판정(`FAIL`, blocker 없음)을 낸 규칙이고, 이후 모든 변형이
견주는 기준이다. **비교의 기준이 움직이면 ablation이 성립하지 않으므로** 값을 고치지
않는다. `tests/test_policy.py`의 `FreezeTest`가 policy_id·strategy_version·서명을 못
박는다.

변형은 이 정책을 고치지 말고 `parameter_variant`나 새 코어 파일로 만든다. 기준선을 정말
옮기려면 그 상수와 근거를 함께 고치고, **옛 서명으로 낸 보고서는 더 이상 비교 대상이
아니게 된다는 것**을 알고 한다.

`note`는 서명이 덮지 않는다(`canonical_text` 참고). 여기 적힌 설명을 고쳐도 서명은 같다.
"""

from __future__ import annotations

from backtest.modes import CORE_ENTRY, CORE_EXITS, CORE_REGIME
from backtest.policy import (
    DEFAULT_PARAMETERS,
    PAPER_VALIDATION,
    HardLimits,
    PolicyVersion,
)

from .definition import CoreDefinition

PAPER_CORE_V1 = PolicyVersion(
    policy_id="paper-core-v1",
    profile=PAPER_VALIDATION,
    limits=HardLimits(),
    parameters=DEFAULT_PARAMETERS,
    note="9.1 PAPER_VALIDATION 프로필, 9.2 초기 자동운용 한도, 7.2~7.5 기본 지표 파라미터",
)

CORE1 = CoreDefinition(
    name="core1",
    policy=PAPER_CORE_V1,
    entry_mode=CORE_ENTRY,
    regime_mode=CORE_REGIME,
    require_earnings_calendar=True,
    exit_mode=CORE_EXITS,
    summary="7.4 진입 게이트 전부 · 7.5 청산 전부 · 점수 0.6 RS + 0.4 추세품질",
)
