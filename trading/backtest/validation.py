"""설계 14.4의 검증 절차와 14.7의 판정.

이 모듈의 요점은 지표 계산이 아니라 **판정 불가를 코드가 강제하는 것**이다. 생존편향
데이터로 낸 숫자, 실적·섹터 게이트를 끄고 낸 숫자, 표본 밖 확인이 없는 숫자가 "14.7
통과"로 읽히면 백테스트를 하는 이유가 없어진다. 조건이 하나라도 빠지면 개별 지표가
아무리 좋아도 전체 판정은 `UNDETERMINED`다.

## 규칙이 동결된 전략에서 워크포워드가 뜻하는 것

14.4의 2단계가 "Core 규칙 동결"이므로 파라미터를 구간마다 적합시키는 통상적인
워크포워드가 아니다. 여기서 롤링 워크포워드가 하는 일은 두 가지다.

1. **홀드아웃 규율.** 14.3은 "최신 완결 구간은 최종 홀드아웃"이라고 한다. 홀드아웃은 한
   번만 보는 것이 전부이고, 여러 번 보면 그냥 표본 안 구간이 된다. 막을 수는 없으니
   **몇 번 봤는지 세어 판정에 반영한다**(`holdout_runs`).
2. **시간축 안정성.** 같은 동결 규칙을 연속된 구간마다 돌려 어느 구간에서 무너지지
   않는지 본다. 규칙을 맞춘 적이 없어도 규칙을 **고른** 사람의 선택 편향은 남는다.

**각 fold는 초기 자본에서 새로 시작한다.** 앞 fold의 운이 뒤로 복리되지 않아 구간끼리
비교할 수 있다. 대신 낙폭·CAGR처럼 곡선 전체가 필요한 지표는 전 구간 연속 실행에서
따로 낸다. 그래서 `evaluate_gate`는 측정치(`metrics`)와 워크포워드 보고서를 함께 받는다.

## 여기서 정한 수치

설계가 문턱을 주지 않은 것들이다.

- 인접값 붕괴: 최악 인접값 / 중심값이 최소 0.5(붕괴 없음)·목표 0.8(plateau)
- fold 안정성: 기대값이 양수인 fold 비율이 최소 0.6·목표 0.8
"""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass, replace

from .costs import Stress
from .loop import BacktestConfig, BacktestResult, run_backtest
from .metrics import Metrics, compute_metrics
from .policy import PolicyVersion, StrategyParameters

# 9.1.1: 최소수량 예외가 전체 진입의 이 비율을 지속 초과하면 위험 프로필을 재검토한다.
MIN_QTY_EXCEPTION_REVIEW_SHARE = 0.40

PASS = "PASS"
TARGET = "TARGET"
FAIL = "FAIL"
UNDETERMINED = "UNDETERMINED"

HOLDOUT_NAME = "holdout"


@dataclass(frozen=True)
class Fold:
    """워크포워드 한 구간. 거래 구간이고 warmup은 이 앞의 바가 담당한다."""

    name: str
    start: str
    end: str
    is_holdout: bool = False


@dataclass(frozen=True)
class WalkForwardPlan:
    folds: tuple[Fold, ...]
    warmup_sessions: int
    unused_sessions: int  # fold 크기로 나눠떨어지지 않아 남은 세션 수

    @property
    def holdout(self) -> Fold:
        return self.folds[-1]

    @property
    def test_folds(self) -> tuple[Fold, ...]:
        return tuple(fold for fold in self.folds if not fold.is_holdout)


class ValidationError(Exception):
    """검증 구간을 만들 수 없을 때 올린다."""


def plan_walk_forward(
    connection: sqlite3.Connection,
    source_version: str,
    *,
    parameters: StrategyParameters,
    fold_sessions: int,
    holdout_sessions: int,
    start: str | None = None,
    end: str | None = None,
    reference_symbol: str = "SPY",
) -> WalkForwardPlan:
    """기준 심볼의 세션을 warmup · 연속 fold · 홀드아웃으로 나눈다.

    warmup·최대 보유기간을 정책에서 직접 읽는다. 호출자가 따로 넘기면 정책과 어긋난
    숫자로 구간을 나눌 수 있다.

    앞의 `min_history_sessions`는 거래하지 않는다. 피처가 그만큼의 이력을 요구하므로
    그 구간에서 시작하면 첫 fold가 통째로 `SHORT_HISTORY`가 된다.

    **fold와 홀드아웃은 각각 최대 보유기간의 두 배 이상이어야 한다.** 구간이 짧으면 보유가
    구간 끝을 넘는 거래가 통째로 잘려서, 빠르게 청산된 거래만 표본에 들어오는 편향이
    생긴다. 최대 보유 40세션에 구간 40세션이면 최대보유 청산이 단 한 건도 세어지지 않고,
    거래를 한 건도 청산하지 못하는 홀드아웃은 홀드아웃이 아니다. 두 배라는 수치는 내가
    정했다. 최소 조건은 "한 배보다 크다"이지만 그 경계에서는 구간 첫날에 진입한 거래만
    청산된다.

    fold 크기로 나눠떨어지지 않는 나머지는 버리고 `unused_sessions`에 남긴다. 마지막
    fold를 늘리거나 줄이면 구간마다 표본 크기가 달라져 비교가 어려워진다.
    """
    min_history_sessions = parameters.min_history_sessions
    minimum_segment = 2 * parameters.max_hold_sessions
    for label, length in (("fold", fold_sessions), ("홀드아웃", holdout_sessions)):
        if length < minimum_segment:
            raise ValidationError(
                f"{label} {length}세션은 최대 보유 {parameters.max_hold_sessions}세션의"
                " 두 배보다 짧습니다. 보유가 구간을 넘는 거래가 잘려 빠른 청산만 표본에"
                " 들어옵니다."
            )
    rows = connection.execute(
        "SELECT trade_date FROM bars_daily"
        " WHERE symbol = ? AND source_version = ?"
        "   AND (? IS NULL OR trade_date >= ?) AND (? IS NULL OR trade_date <= ?)"
        " ORDER BY trade_date",
        (reference_symbol, source_version, start, start, end, end),
    ).fetchall()
    sessions = [row["trade_date"] for row in rows]
    tradeable = sessions[min_history_sessions:]
    needed = fold_sessions + holdout_sessions
    if len(tradeable) < needed:
        raise ValidationError(
            f"거래 가능 세션이 {len(tradeable)}개뿐입니다"
            f" (warmup {min_history_sessions} 이후 최소 {needed}개 필요)"
        )

    holdout_dates = tradeable[-holdout_sessions:]
    remaining = tradeable[:-holdout_sessions]
    fold_count = len(remaining) // fold_sessions
    folds = []
    for index in range(fold_count):
        chunk = remaining[index * fold_sessions : (index + 1) * fold_sessions]
        folds.append(Fold(f"fold-{index + 1:02d}", chunk[0], chunk[-1]))
    folds.append(Fold(HOLDOUT_NAME, holdout_dates[0], holdout_dates[-1], is_holdout=True))
    return WalkForwardPlan(
        folds=tuple(folds),
        warmup_sessions=min_history_sessions,
        unused_sessions=len(remaining) - fold_count * fold_sessions,
    )


@dataclass(frozen=True)
class WalkForwardReport:
    plan: WalkForwardPlan
    fold_metrics: tuple[tuple[Fold, Metrics], ...]
    # 홀드아웃 구간을 지금까지 몇 번 실행했는가. None이면 세지 않았다.
    holdout_run_count: int | None = None

    @property
    def oos_trade_count(self) -> int:
        """표본 밖 거래 수. 규칙이 동결이므로 모든 fold가 표본 밖이다."""
        return sum(metrics.trade_count for _, metrics in self.fold_metrics)

    @property
    def holdout_metrics(self) -> Metrics | None:
        for fold, metrics in self.fold_metrics:
            if fold.is_holdout:
                return metrics
        return None

    @property
    def expectancies(self) -> tuple[float | None, ...]:
        return tuple(metrics.expectancy_r for _, metrics in self.fold_metrics)

    @property
    def positive_fold_share(self) -> float | None:
        """기대값이 양수인 fold 비율. 거래가 없는 fold는 분모에서 뺀다."""
        values = [value for value in self.expectancies if value is not None]
        if not values:
            return None
        return sum(1 for value in values if value > 0) / len(values)

    @property
    def worst_fold_expectancy_r(self) -> float | None:
        values = [value for value in self.expectancies if value is not None]
        return min(values) if values else None


def run_walk_forward(
    connection: sqlite3.Connection,
    config: BacktestConfig,
    plan: WalkForwardPlan,
    *,
    holdout_run_count: int | None = None,
) -> WalkForwardReport:
    """fold마다 초기 자본에서 새로 실행한다."""
    measured = []
    for fold in plan.folds:
        fold_config = replace(config, start=fold.start, end=fold.end)
        measured.append((fold, compute_metrics(run_backtest(connection, fold_config))))
    return WalkForwardReport(
        plan=plan,
        fold_metrics=tuple(measured),
        holdout_run_count=holdout_run_count,
    )


def record_holdout_run(
    connection: sqlite3.Connection,
    run_id: str,
    fold: Fold,
    policy: PolicyVersion,
    source_version: str,
    metrics: Metrics,
) -> int:
    """홀드아웃 실행을 남기고 지금까지의 실행 횟수를 돌려준다.

    홀드아웃을 여러 번 보는 것을 코드가 막을 수는 없다. 대신 **몇 번 봤는지 세어**
    보고에 드러낸다.

    **소모하는 것은 "다시 출력"이 아니라 "다른 규칙으로 다시 보기"다.** 그래서 호출자는
    `run_id`에 정책 서명을 넣는다. 같은 정책을 다시 돌리면 같은 행을 덮어써 1회로 남고
    (새로 뽑는 정보가 없다), 파라미터를 바꾸면 새 행이 되어 2회가 되며 `HOLDOUT_REUSED`가
    붙는다. 구간 단위로 세는 것은 그대로다 — 정책이 달라도 같은 구간을 본 것은 맞다.
    """
    with connection:
        connection.execute(
            "INSERT OR REPLACE INTO holdout_runs"
            " (run_id, policy_signature, source_version, start_date, end_date,"
            "  trade_count, expectancy_r)"
            " VALUES (?, ?, ?, ?, ?, ?, ?)",
            (
                run_id,
                policy.signature,
                source_version,
                fold.start,
                fold.end,
                metrics.trade_count,
                metrics.expectancy_r,
            ),
        )
    return holdout_run_count(connection, source_version, fold)


def holdout_run_count(
    connection: sqlite3.Connection, source_version: str, fold: Fold
) -> int:
    row = connection.execute(
        "SELECT COUNT(*) AS n FROM holdout_runs"
        " WHERE source_version = ? AND start_date = ? AND end_date = ?",
        (source_version, fold.start, fold.end),
    ).fetchone()
    return row["n"]


@dataclass(frozen=True)
class GateRow:
    name: str
    value: float | int | None
    minimum: float | None
    target: float | None
    higher_is_better: bool
    verdict: str
    note: str = ""


@dataclass(frozen=True)
class GateReport:
    """14.7 판정. `verdict`가 `UNDETERMINED`면 개별 지표를 성과 근거로 쓸 수 없다."""

    verdict: str
    rows: tuple[GateRow, ...]
    blockers: tuple[str, ...]

    def row(self, name: str) -> GateRow:
        for row in self.rows:
            if row.name == name:
                return row
        raise KeyError(name)


def _judge(
    name: str,
    value: float | int | None,
    minimum: float | None,
    target: float | None,
    *,
    higher_is_better: bool = True,
    note: str = "",
) -> GateRow:
    if value is None:
        verdict = UNDETERMINED
    elif higher_is_better:
        verdict = TARGET if target is not None and value >= target else (
            PASS if minimum is not None and value >= minimum else FAIL
        )
    else:
        verdict = TARGET if target is not None and value <= target else (
            PASS if minimum is not None and value <= minimum else FAIL
        )
    return GateRow(
        name=name,
        value=value,
        minimum=minimum,
        target=target,
        higher_is_better=higher_is_better,
        verdict=verdict,
        note=note,
    )


def evaluate_gate(
    result: BacktestResult,
    metrics: Metrics,
    *,
    survivorship_biased: bool,
    walk_forward: WalkForwardReport | None = None,
    stressed: Metrics | None = None,
    neighbourhood: NeighbourhoodReport | None = None,
) -> GateReport:
    """14.7의 표를 채우고 판정한다.

    조건이 빠지면 개별 지표가 아무리 좋아도 전체 판정은 `UNDETERMINED`다. `blockers`에
    무엇이 빠졌는지 남긴다. 숫자를 지우지는 않는다. 엔진 검증에는 그 숫자가 필요하고,
    판정에 쓸 수 없다는 사실만 분명하면 된다.
    """
    config = result.config
    blockers: list[str] = []
    if survivorship_biased:
        blockers.append("SURVIVORSHIP_BIASED")
    if walk_forward is None:
        blockers.append("NO_WALK_FORWARD")
    elif walk_forward.holdout_run_count is not None and walk_forward.holdout_run_count > 1:
        # 홀드아웃을 두 번 이상 본 순간 그 구간은 표본 밖이 아니다.
        blockers.append("HOLDOUT_REUSED")
    if not config.require_earnings_calendar:
        blockers.append("EARNINGS_GATE_DISABLED")
    if not config.require_sector:
        blockers.append("SECTOR_LIMIT_DISABLED")
    if stressed is None:
        blockers.append("COST_STRESS_MISSING")
    if neighbourhood is None:
        blockers.append("PARAMETER_NEIGHBOURHOOD_NOT_RUN")

    rows = [
        _judge(
            "trade_count",
            metrics.trade_count if walk_forward is None else walk_forward.oos_trade_count,
            200,
            400,
            note="워크포워드 보고서가 있으면 fold 전체의 표본 밖 거래 수를 센다",
        ),
        _judge("expectancy_r", metrics.expectancy_r, 0.0, 0.20),
        _judge("sharpe", metrics.sharpe, 0.6, 0.9, note="무위험수익률 0이라 상한으로 읽는다"),
        _judge("sortino", metrics.sortino, 0.9, 1.3, note="무위험수익률 0이라 상한으로 읽는다"),
        _judge(
            "max_drawdown",
            metrics.max_drawdown,
            0.15,
            0.10,
            higher_is_better=False,
        ),
        _judge("profit_factor", metrics.profit_factor, 1.15, 1.35),
        _judge("calmar", metrics.calmar, 0.6, 1.0),
        _judge(
            "cost_stress_breakeven",
            None
            if stressed is None
            else stressed.final_equity / stressed.initial_equity,
            1.0,
            None,
            note="비용 2배에서 손익분기 이상(14.7). 목표는 양의 CAGR",
        ),
        _judge(
            "cost_stress_cagr",
            None if stressed is None else stressed.cagr,
            None,
            0.0,
            note="비용 2배에서도 CAGR > 0이면 희망 기준",
        ),
        _judge(
            "parameter_neighbourhood",
            None if neighbourhood is None else neighbourhood.collapse_ratio,
            0.5,
            0.8,
            note="최악 인접값 / 중심값. 최소 0.5(붕괴 없음)·목표 0.8(plateau)은 내가 정한 수치다",
        ),
        _judge(
            "fold_stability",
            None if walk_forward is None else walk_forward.positive_fold_share,
            0.6,
            0.8,
            note="기대값이 양수인 fold 비율. 최소 0.6·목표 0.8은 내가 정한 수치다",
        ),
        _judge(
            "min_qty_exception_share",
            metrics.min_qty_exception_share,
            MIN_QTY_EXCEPTION_REVIEW_SHARE,
            None,
            higher_is_better=False,
            note="9.1.1: 이 비율을 지속 초과하면 위험 프로필을 REVIEW로 올린다",
        ),
    ]

    if blockers:
        verdict = UNDETERMINED
    elif any(row.verdict == FAIL for row in rows):
        verdict = FAIL
    elif any(row.verdict == UNDETERMINED for row in rows):
        verdict = UNDETERMINED
    else:
        verdict = PASS
    return GateReport(verdict=verdict, rows=tuple(rows), blockers=tuple(blockers))


def stress_config(result: BacktestResult, factor: float = 2.0) -> BacktestConfig:
    """21.2의 "비용 2배·3배 스트레스" 실행 설정. 비용만 바꾸고 나머지는 그대로 둔다."""
    return replace(
        result.config, costs=result.config.costs.stressed(Stress.uniform(factor))
    )


def parameter_variant(config: BacktestConfig, **changes) -> BacktestConfig:
    """지표 파라미터만 바꾼 실행 설정(21.2의 인접값 안정성).

    정책 id에 변경 내용을 남기므로 서명이 달라진다. 어떤 파라미터로 낸 실행인지 결과
    기록에서 되찾을 수 있어야 한다.
    """
    parameters = replace(config.policy.parameters, **changes)
    suffix = ",".join(f"{key}={value}" for key, value in sorted(changes.items()))
    policy = replace(
        config.policy,
        parameters=parameters,
        policy_id=f"{config.policy.policy_id}[{suffix}]",
    )
    return replace(config, policy=policy)


@dataclass(frozen=True)
class NeighbourhoodReport:
    """한 파라미터의 인접값 안정성.

    설계는 "붕괴 없음"과 "넓은 plateau"라고만 하고 수치를 주지 않는다. 여기서는 중심값
    대비 최악 인접값의 비율(`collapse_ratio`)을 지표로 쓰고, 게이트에서 최소 0.5·목표
    0.8로 판정한다. 그 두 숫자는 내가 정했다.
    """

    field: str
    metric_name: str
    center_value: object
    center_metric: float | None
    neighbours: tuple[tuple[object, float | None], ...]

    @property
    def collapse_ratio(self) -> float | None:
        """최악 인접값 / 중심값. 중심값이 0 이하면 비율에 뜻이 없어 None이다."""
        if self.center_metric is None or self.center_metric <= 0:
            return None
        values = [value for _, value in self.neighbours if value is not None]
        if len(values) != len(self.neighbours) or not values:
            return None
        return min(values) / self.center_metric


def neighbourhood_report(
    field: str,
    center: Metrics,
    neighbours: dict[object, Metrics],
    *,
    center_value: object = None,
    metric_name: str = "expectancy_r",
) -> NeighbourhoodReport:
    """중심 실행과 인접값 실행들의 지표를 모아 붕괴 여부를 볼 수 있게 만든다."""
    return NeighbourhoodReport(
        field=field,
        metric_name=metric_name,
        center_value=center_value,
        center_metric=getattr(center, metric_name),
        neighbours=tuple(
            (value, getattr(metrics, metric_name))
            for value, metrics in sorted(neighbours.items(), key=lambda item: str(item[0]))
        ),
    )
