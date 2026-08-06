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

SIGNATURE_SCHEME = "sha256"

# 전략 규칙의 버전. 설계 문서 버전을 따른다. 규칙이 바뀌면 이 값도 바뀌어야 하고,
# 이 값은 `feature_hash`·`signal_id`·정책 서명에 모두 들어간다.
STRATEGY_VERSION = "core-v2.3"


class PolicyError(Exception):
    """정책이 없거나 저장된 값이 서명과 다를 때 올린다."""


@dataclass(frozen=True)
class StrategyParameters:
    """설계 7.2~7.5·10.1의 지표 파라미터.

    1.4는 "전략 버전과 지표 파라미터"를 사용자 승인 항목으로 둔다. 그래서 이 값들은
    모듈 상수가 아니라 서명된 정책의 일부다. 모듈 상수로 두면 두 가지가 불가능하다.
    14.4·21.2의 인접값 안정성 검증(18/20/22일)을 한 실행에서 여러 번 돌릴 수 없고,
    어떤 파라미터로 낸 결과인지 정책 서명이 덮지 못한다.

    **함수에 넘기는 것을 잊으면 조용히 기본값이 먹지 않도록** 계산 함수들에서 window
    기본값을 모두 걷어냈다. 파라미터 없이는 피처를 계산할 수 없다.
    """

    # 7.4 종목 점수
    rs_lookback: int = 63
    rs_skip: int = 5
    trend_window: int = 60
    score_weight_rs: float = 0.60
    score_weight_trend: float = 0.40
    # 7.5 ATR와 손절
    atr_window: int = 14
    stop_atr_multiple: float = 2.0
    trailing_atr_multiple: float = 3.0
    trailing_activation_atr: float = 1.0
    time_stop_sessions: int = 20
    max_hold_sessions: int = 40
    # 0이면 7.5의 문자 그대로 "발표 전 거래일"이다. 미래 휴장일을 모르는 동안은 1로 둔다.
    earnings_exit_sessions: int = 1
    # 7.2 유니버스와 7.4 진입 게이트
    sma_fast: int = 50
    sma_slow: int = 200
    breakout_window: int = 20
    min_close: float = 10.0
    min_dollar_volume: float = 50_000_000.0
    dollar_volume_window: int = 20
    min_history_sessions: int = 252
    earnings_min_sessions: int = 4
    max_candidates: int = 5
    # 유니버스는 500종목대다. 이보다 작으면 횡단면이 아니라 데이터 사고다.
    min_score_population: int = 30
    # 7.3 시장 상태
    vol_window: int = 20
    green_max_vol: float = 0.30
    red_max_vol: float = 0.35
    green_max_drawdown: float = 0.05
    red_min_drawdown: float = 0.08
    below_sma_red_streak: int = 3
    # 9.2 상관 한도가 보는 창
    correlation_window: int = 60
    # 10.1 진입
    entry_chase_atr: float = 0.25
    gap_cancel_atr: float = 1.0
    max_daily_entries_green: int = 2
    max_daily_entries_yellow: int = 1

    def __post_init__(self) -> None:
        if abs(self.score_weight_rs + self.score_weight_trend - 1.0) > 1e-9:
            raise PolicyError("종목 점수의 가중치 합은 1이어야 합니다.")
        if self.rs_skip >= self.rs_lookback:
            raise PolicyError("rs_skip은 rs_lookback보다 작아야 합니다.")
        if self.sma_fast >= self.sma_slow:
            raise PolicyError("sma_fast는 sma_slow보다 작아야 합니다.")
        if self.time_stop_sessions > self.max_hold_sessions:
            raise PolicyError("시간손절이 최대 보유기간보다 늦을 수 없습니다.")
        # 이 부등식이 "손절가는 내려가지 않는다"를 보장한다. 활성화 순간의 추적손절가는
        # `진입가 + (활성화 - 추적) × ATR`이고 초기 손절가는 `진입가 - 손절배수 × ATR`이다.
        if (
            self.trailing_atr_multiple - self.trailing_activation_atr
            > self.stop_atr_multiple + 1e-12
        ):
            raise PolicyError(
                "추적손절 활성화 순간에 손절가가 내려갑니다:"
                f" {self.trailing_atr_multiple} - {self.trailing_activation_atr}"
                f" > {self.stop_atr_multiple}"
            )
        needed = max(
            self.sma_slow,
            self.rs_lookback + 1,
            self.trend_window,
            self.atr_window + 1,
            self.vol_window + 1,
            self.breakout_window + 1,
            self.correlation_window + 1,
        )
        if self.min_history_sessions < needed:
            raise PolicyError(
                f"최소 이력 {self.min_history_sessions}세션으로는 모든 창을 채울 수 없습니다"
                f" (최소 {needed}세션 필요)"
            )

    def max_daily_entries(self, regime_state: str) -> int:
        """7.3의 신규 진입 열과 10.1의 "하루 진입 최대 2종목"을 합친 값."""
        if regime_state == "GREEN":
            return self.max_daily_entries_green
        if regime_state == "YELLOW":
            return self.max_daily_entries_yellow
        return 0


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
    parameters: StrategyParameters = field(default_factory=StrategyParameters)
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
                "parameters": asdict(self.parameters),
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

DEFAULT_PARAMETERS = StrategyParameters()

DEFAULT_PAPER_POLICY = PolicyVersion(
    policy_id="paper-core-v1",
    profile=PAPER_VALIDATION,
    limits=HardLimits(),
    parameters=DEFAULT_PARAMETERS,
    note="9.1 PAPER_VALIDATION 프로필, 9.2 초기 자동운용 한도, 7.2~7.5 기본 지표 파라미터",
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
            "  parameters, signature, approved_by, note, active)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)",
            (
                policy.policy_id,
                policy.broker_mode,
                policy.strategy_version,
                policy.profile.name,
                json.dumps(asdict(policy.profile), sort_keys=True),
                json.dumps(asdict(policy.limits), sort_keys=True),
                json.dumps(asdict(policy.parameters), sort_keys=True),
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
        parameters=StrategyParameters(**json.loads(row["parameters"])),
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
