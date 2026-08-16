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
|`jt-{,random-}k{42,84}-s{10,20}`|RS-only / 무작위|같은 K, 슬롯만 나눔 (`jt_slots.py`)|
|`jt-j126-k42`|RS-only (J=126)|`jt-k42`에서 `rs_lookback`만 바꾼 challenger|
|`jt-j126-k42-sma200`|RS-only (J=126)|`jt-j126-k42`에서 **`regime_mode`만** 바꾼 시장 게이트 challenger|

`core1`은 동결된 기준선이다(`core1.py` 참고). 나머지는 J/K 실험용 연구 코어이고 낙폭
게이트가 해제돼 있어 **PAPER·LIVE에 쓰지 않는다.** K=21/42와 대조군은 2026-08-14,
K=63/84와 그 대조군은 2026-08-15 신호 수명 실험에서 왔다. `-s10`·`-s20`은 같은 날
슬롯 용량 실험에서 왔고 **총 계획 위험을 고정한 채 슬롯 수와 거래당 위험을 한 묶음으로
바꾼다** — 처치가 단위라 여덟 칸이 `jt_slots.py` 한 파일에 있다. `-s5` 칸은 규칙이
`jt-k42`·`jt-k84`와 정확히 같아서 따로 만들지 않았다.
"""

from __future__ import annotations

from .core1 import CORE1, PAPER_CORE_V1
from .definition import CoreDefinition
from .jt_core_exit import JT_CORE_EXIT
from .jt_j126_k42 import JT_J126_K42
from .jt_j126_k42_sma200 import JT_J126_K42_SMA200
from .jt_k21 import JT_K21
from .jt_k42 import JT_K42
from .jt_k63 import JT_K63
from .jt_k84 import JT_K84
from .jt_random_k42 import JT_RANDOM_K42
from .jt_random_k63 import JT_RANDOM_K63
from .jt_random_k84 import JT_RANDOM_K84
from .jt_slots import SLOT_CORES

CORES: dict[str, CoreDefinition] = {
    core.name: core
    for core in (
        CORE1,
        JT_K21,
        JT_K42,
        JT_K63,
        JT_K84,
        JT_CORE_EXIT,
        JT_J126_K42,
        JT_J126_K42_SMA200,
        JT_RANDOM_K42,
        JT_RANDOM_K63,
        JT_RANDOM_K84,
        *SLOT_CORES,
    )
}

__all__ = [
    "CORE1",
    "CORES",
    "JT_CORE_EXIT",
    "JT_J126_K42",
    "JT_J126_K42_SMA200",
    "JT_K21",
    "JT_K42",
    "JT_K63",
    "JT_K84",
    "JT_RANDOM_K42",
    "JT_RANDOM_K63",
    "JT_RANDOM_K84",
    "PAPER_CORE_V1",
    "SLOT_CORES",
    "CoreDefinition",
]
