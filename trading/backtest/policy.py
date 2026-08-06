"""설계 1.4·9.1·9.2의 PolicyVersion.

> 위 한도는 `PolicyVersion`에 서명되어 저장된다. 에이전트·Governor·브로커 어댑터
> 어느 구성요소도 런타임에 상향할 수 없다. (9.2)

그 문장을 구조로 지키는 방법은 세 가지다.

1. `RiskProfile`·`HardLimits`·`PolicyVersion`은 모두 frozen이다. 런타임 대입이 예외다.
2. 한도는 비교에만 쓰고 어디서도 다시 계산해 덮지 않는다. 계산은 정책에서 파생된
   상한을 만들 때만 하고, 그 결과는 항상 원래 한도보다 작거나 같다.
3. 저장된 정책은 불러올 때마다 서명을 검증한다. 값이 바뀌었으면 기동을 거부한다.

**서명의 한계를 분명히 해둔다.** 여기서 만드는 `signature`는 사용자 키로 만든 위조 방지
서명이 아니라 내용 digest다. DB를 직접 고칠 수 있는 사람은 막지 못하고, 실수로 바뀐
값과 코드-DB 불일치를 잡는다. 진짜 서명은 사용자 키가 필요하고 15.1.1의 LIVE 승격
단계에서 `policy_live_*`와 함께 다룬다.
"""

from __future__ import annotations

import hashlib
import json
import sqlite3
from dataclasses import asdict, dataclass, field

from .features import STRATEGY_VERSION

SIGNATURE_SCHEME = "sha256"


class PolicyError(Exception):
    """정책이 없거나 저장된 값이 서명과 다를 때 올린다."""


@dataclass(frozen=True)
class RiskProfile:
    """9.1 단계별 위험 프로필.

    지금은 `PAPER_VALIDATION` 하나만 정의한다. LIVE 프로필은 그 단계에 도달할 때
    추가한다. 없는 값이 가장 안전하다.
    """

    name: str
    risk_per_trade: float
    max_exposure: float

    @property
    def min_qty_risk_cap(self) -> float:
        """9.1.1: 계좌의 0.5%, 단 해당 프로필 계획 위험의 2배를 상한으로 한다."""
        return min(0.005, 2 * self.risk_per_trade)


@dataclass(frozen=True)
class HardLimits:
    """9.2 하드 한도의 초기 자동운용 열.

    손실·낙폭은 모두 크기(양수 비율)로 적는다. `daily_loss_limit=0.010`은 -1.0%다.
    성숙 프로필 상한 열은 그 프로필로 승격할 때 별도 인스턴스로 추가한다.
    """

    max_position_weight: float = 0.12
    max_positions: int = 5
    max_sector_weight: float = 0.25
    max_total_planned_risk: float = 0.0125
    correlation_threshold: float = 0.75
    max_correlated_pair_weight: float = 0.25
    daily_loss_limit: float = 0.010
    weekly_loss_limit: float = 0.025
    weekly_risk_budget_factor: float = 0.50
    drawdown_quantity_cut: float = 0.05
    drawdown_quantity_factor: float = 0.50
    drawdown_block_entries: float = 0.07
    drawdown_halt: float = 0.10
    # 19.2 자동 킬스위치. HALT보다 깊은 낙폭이라 복구 절차가 다르므로 사유를 구분한다.
    drawdown_killswitch: float = 0.12
    # 9.1의 LiquidityCap에는 설계에 수치가 없다. 20일 중앙값 달러거래대금의 1%로 정했다.
    # 7.2의 유동성 하한이 5천만 달러이므로 이 상한은 50만 달러이고, 현재 계좌 규모에서는
    # 종목당 비중이 항상 먼저 걸려 한 번도 구속하지 않는다. 계좌가 커질 때를 위한 값이다.
    liquidity_cap_fraction: float = 0.01


@dataclass(frozen=True)
class PolicyVersion:
    """사용자가 승인한 헌법 한 벌. 활성 정책은 broker_mode마다 하나다."""

    policy_id: str
    profile: RiskProfile
    limits: HardLimits = field(default_factory=HardLimits)
    broker_mode: str = "PAPER"
    strategy_version: str = STRATEGY_VERSION
    approved_by: str = "user"
    note: str = ""

    def __post_init__(self) -> None:
        if self.broker_mode != "PAPER":
            # 실전 경로는 이 저장소에 구현하지 않는다(1.3·20.0 1단계).
            raise PolicyError(f"이 저장소는 PAPER 정책만 다룹니다: {self.broker_mode}")

    @property
    def canonical_text(self) -> str:
        """서명이 덮는 범위. 숫자와 승인자까지고 `note`는 뺀다."""
        return json.dumps(
            {
                "policy_id": self.policy_id,
                "broker_mode": self.broker_mode,
                "strategy_version": self.strategy_version,
                "approved_by": self.approved_by,
                "profile": asdict(self.profile),
                "limits": asdict(self.limits),
            },
            sort_keys=True,
            separators=(",", ":"),
            ensure_ascii=False,
        )

    @property
    def signature(self) -> str:
        digest = hashlib.sha256(self.canonical_text.encode("utf-8")).hexdigest()
        return f"{SIGNATURE_SCHEME}:{digest}"


PAPER_VALIDATION = RiskProfile(
    name="PAPER_VALIDATION", risk_per_trade=0.0025, max_exposure=0.60
)

DEFAULT_PAPER_POLICY = PolicyVersion(
    policy_id="paper-core-v1",
    profile=PAPER_VALIDATION,
    limits=HardLimits(),
    note="9.1 PAPER_VALIDATION 프로필과 9.2 초기 자동운용 한도",
)


def activate_policy(connection: sqlite3.Connection, policy: PolicyVersion) -> str:
    """정책을 저장하고 활성으로 만든다. 같은 broker_mode의 이전 정책은 폐기한다."""
    with connection:
        connection.execute(
            "UPDATE policy_versions SET active = 0"
            " WHERE broker_mode = ? AND policy_id != ?",
            (policy.broker_mode, policy.policy_id),
        )
        connection.execute(
            "INSERT OR REPLACE INTO policy_versions"
            " (policy_id, broker_mode, strategy_version, risk_profile, profile, limits,"
            "  signature, approved_by, note, active)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)",
            (
                policy.policy_id,
                policy.broker_mode,
                policy.strategy_version,
                policy.profile.name,
                json.dumps(asdict(policy.profile), sort_keys=True),
                json.dumps(asdict(policy.limits), sort_keys=True),
                policy.signature,
                policy.approved_by,
                policy.note,
            ),
        )
    return policy.signature


def load_active_policy(
    connection: sqlite3.Connection, broker_mode: str = "PAPER"
) -> PolicyVersion:
    """활성 정책을 불러오고 서명을 검증한다. 값이 바뀌었으면 거부한다."""
    row = connection.execute(
        "SELECT * FROM policy_versions WHERE broker_mode = ? AND active = 1",
        (broker_mode,),
    ).fetchone()
    if row is None:
        raise PolicyError(f"활성 정책이 없습니다: {broker_mode}")

    policy = PolicyVersion(
        policy_id=row["policy_id"],
        profile=RiskProfile(**json.loads(row["profile"])),
        limits=HardLimits(**json.loads(row["limits"])),
        broker_mode=row["broker_mode"],
        strategy_version=row["strategy_version"],
        approved_by=row["approved_by"],
        note=row["note"] or "",
    )
    if policy.signature != row["signature"]:
        raise PolicyError(
            f"저장된 정책의 서명이 맞지 않습니다: {policy.policy_id}."
            " 한도가 승인 이후에 바뀌었습니다."
        )
    return policy
