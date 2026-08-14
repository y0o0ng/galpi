"""코어 하나의 정의.

**코어는 "한 벌의 규칙"이다** — 서명된 정책(파라미터·한도·프로필)에 서명 밖의 실행 모드
(진입·청산)를 더한 것. 백테스트 하나를 재현하는 데 필요한 규칙이 전부 여기 모인다.

정책 서명만으로는 부족하다. `entry_mode`·`exit_mode`가 서명 밖이라 같은 서명으로 전혀
다른 규칙이 돌 수 있기 때문이다. 그래서 코어를 파일 하나로 남기고, 실행 보고서는 정책
서명과 두 모드를 함께 찍는다.
"""

from __future__ import annotations

from dataclasses import dataclass

from backtest.modes import CORE_REGIME, ENTRY_MODES, EXIT_MODES, REGIME_MODES
from backtest.policy import PolicyError, PolicyVersion


# 코어가 정하는 규칙 필드. **여기 없는 것은 규칙이 아니다.**
#
# `BacktestConfig`에 규칙처럼 보이는 값을 새로 넣으면 이 목록도 같이 늘려야 하고, 그때
# "이건 코어가 정하는 규칙인가, 실행이 정하는 조건인가"를 한 번 답하게 된다. 구간·적재분·
# 민감도 시나리오는 규칙이 아니라 실행 조건이라 여기 없다.
RULE_FIELDS = (
    "policy",
    "entry_mode",
    "exit_mode",
    "regime_mode",
    "require_earnings_calendar",
    "require_sector",
)


@dataclass(frozen=True)
class CoreDefinition:
    name: str
    policy: PolicyVersion
    entry_mode: str
    exit_mode: str
    summary: str
    regime_mode: str = CORE_REGIME
    # 실적 캘린더를 진입 조건으로 요구하는가. 진입 게이트를 끈 코어가 이것을 참으로 두면
    # 보고서가 "실적 캘린더 요구: 예"라고 거짓말한다.
    require_earnings_calendar: bool = True
    require_sector: bool = True

    def run_kwargs(self) -> dict:
        """`BacktestConfig`에 그대로 넘길 규칙 설정.

        **모든 러너가 이 하나를 통해 설정을 받는다.** 러너마다 따로 조립하면 새 실험이
        조용히 다른 엔진 설정으로 돌고, 그러면 결과를 견줄 수 없다.
        """
        return {field: getattr(self, field) for field in RULE_FIELDS}

    def __post_init__(self) -> None:
        if self.entry_mode not in ENTRY_MODES:
            raise PolicyError(f"모르는 진입 모드입니다: {self.entry_mode}")
        if self.exit_mode not in EXIT_MODES:
            raise PolicyError(f"모르는 청산 모드입니다: {self.exit_mode}")
        if self.regime_mode not in REGIME_MODES:
            raise PolicyError(f"모르는 레짐 모드입니다: {self.regime_mode}")

    @property
    def signature(self) -> str:
        return self.policy.signature
