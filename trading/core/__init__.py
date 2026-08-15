"""실험 코어 등록부. 코어 하나가 파일 하나다.

**한 벌의 규칙을 한 곳에서 읽을 수 있어야 실험을 견줄 수 있다.** 정책 서명은 파라미터와
한도만 덮고 진입·청산 모드는 서명 밖이라, 코어를 파일로 남기지 않으면 "이 숫자는 어떤
규칙으로 냈나"가 실행 스크립트 안에 흩어진다.

|코어|진입|청산|
|---|---|---|
|`core1`|7.4 게이트 전부 · 점수 0.6 RS + 0.4 추세|7.5 전부 (최대보유 40)|
|`jt-k21`|RS-only|21세션 만기만|
|`jt-k42`|RS-only|42세션 만기만|
|`jt-core-exit`|RS-only|7.5 전부 (최대보유 40)|
|`jt-random-k42`|무작위 (jt-k42 대조군)|42세션 만기만|
|`jt-k63`|RS-only|63세션 만기만|
|`jt-k84`|RS-only|84세션 만기만|
|`jt-random-k63`|무작위 (jt-k63 대조군)|63세션 만기만|
|`jt-random-k84`|무작위 (jt-k84 대조군)|84세션 만기만|

`core1`은 동결된 기준선이다(`core1.py` 참고). 나머지는 J/K 실험용 연구 코어이고 낙폭
게이트가 해제돼 있어 **PAPER·LIVE에 쓰지 않는다.** K=21/42와 대조군은 2026-08-14,
K=63/84와 그 대조군은 2026-08-15 신호 수명 실험에서 왔다.
"""

from __future__ import annotations

from .core1 import CORE1, PAPER_CORE_V1
from .definition import CoreDefinition
from .jt_core_exit import JT_CORE_EXIT
from .jt_k21 import JT_K21
from .jt_k42 import JT_K42
from .jt_k63 import JT_K63
from .jt_k84 import JT_K84
from .jt_random_k42 import JT_RANDOM_K42
from .jt_random_k63 import JT_RANDOM_K63
from .jt_random_k84 import JT_RANDOM_K84

CORES: dict[str, CoreDefinition] = {
    core.name: core
    for core in (
        CORE1,
        JT_K21,
        JT_K42,
        JT_K63,
        JT_K84,
        JT_CORE_EXIT,
        JT_RANDOM_K42,
        JT_RANDOM_K63,
        JT_RANDOM_K84,
    )
}

__all__ = [
    "CORE1",
    "CORES",
    "JT_CORE_EXIT",
    "JT_K21",
    "JT_K42",
    "JT_K63",
    "JT_K84",
    "JT_RANDOM_K42",
    "JT_RANDOM_K63",
    "JT_RANDOM_K84",
    "PAPER_CORE_V1",
    "CoreDefinition",
]
