"""J/K 실험 코어를 15년 적재분으로 돌린다. **판정이 아니라 학습이 목적이다.**

규칙은 여기 없다 — `core/`의 코어 파일이 정본이다(`core/jt.py`가 셋의 공통 근거,
`core/jt_k21.py`·`jt_k42.py`·`jt_core_exit.py`가 각각의 차이). 이 스크립트는 **어떤
구간에서 어떻게 돌리고 무엇을 남기는지**만 정한다.

## 홀드아웃을 보지 않는다

`real_run.py`의 `run`은 홀드아웃을 fold 마지막에 넣고 `record_holdout_run`으로 관측을
기록한다. 규칙 조합을 바꿀 때마다 새 관측 1회가 되므로 **이대로 세 번 돌리면 그 구간은
표본 밖이 아니게 된다.** 그래서 구간을 홀드아웃 시작 전날에서 끊고, 워크포워드를 돌리지
않고, `record_holdout_run`을 부르지 않는다.

**경계는 코어마다 같아야 한다.** K가 다르면 `plan_walk_forward`의 최소 구간 조건도 달라
지므로, 경계는 각 코어의 정책이 아니라 **동결된 `core1`으로 한 번 계산한다.** 홀드아웃은
정책이 아니라 달력 위의 한 구간이다.

## 판정은 `UNDETERMINED`가 맞다

워크포워드·비용 스트레스·인접 파라미터를 넘기지 않으므로 blocker 셋이 붙는다. 홀드아웃을
안 본 실행이 "통과"로 읽히지 않게 하는 것이 그 blocker들의 일이다. 시간축 안정성은
fold 대신 보고서의 **연도별 성과표**로 본다.

    python3 selftest/momentum_run.py jt-k21
    python3 selftest/momentum_run.py all
"""

from __future__ import annotations

import argparse
import sys
from dataclasses import dataclass
from pathlib import Path

TRADING_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TRADING_ROOT))

from backtest import store  # noqa: E402
from backtest.loop import BacktestConfig, run_backtest, save_run  # noqa: E402
from backtest.metrics import compute_metrics  # noqa: E402
from backtest.modes import LAST_CLOSE_EXIT, UNRESOLVED_EXIT_PRICES  # noqa: E402
from backtest.report import (  # noqa: E402
    judgment_json,
    judgment_markdown,
    judgment_payload,
)
from backtest.validation import evaluate_gate, plan_walk_forward  # noqa: E402
from core import CORES, CoreDefinition  # noqa: E402
from core.core1 import PAPER_CORE_V1  # noqa: E402
from selftest.real_run import (  # noqa: E402
    BARS_START,
    FOLD_SESSIONS,
    HOLDOUT_SESSIONS,
    INDEX_NAMES,
    REFERENCE_SYMBOL,
    RUNS_DIR,
    SOURCE_VERSION,
)

# **산출물은 실험 폴더에 모은다.** 비교 세트를 통째로 읽어야 뜻이 생기기 때문이다.
# 무작위 대조군은 시드 20개 파일이 J/K 런을 덮어버려서 따로 둔다 — 묻는 것도 다르다.
# J/K는 "K를 바꾸면 무엇이 달라지나", 대조군은 "랭킹이 무작위보다 나은가"다.
EXPERIMENT = "jt-jk"
RANDOM_EXPERIMENT = "jt-random"


def experiment_for(core: "CoreDefinition") -> str:
    return RANDOM_EXPERIMENT if core.entry_mode == "RANDOM" else EXPERIMENT

# 이 실험이 돌리는 코어. `core1`은 기준선이라 여기서 돌리지 않는다 — 2026-08-10
# 판정이 이미 있고, 그것을 다시 돌리면 홀드아웃 관측을 한 번 더 쓰게 된다.
CORE_NAMES = ("jt-k21", "jt-k42", "jt-core-exit")
# 무작위 대조군은 시드마다 한 번씩 돌린다. 시드 하나는 표본 하나라 분포가 안 된다.
RANDOM_CORE = "jt-random-k42"
RANDOM_SEEDS = tuple(range(10))


def research_window(connection) -> tuple[str, str, str]:
    """`(시작, 끝, 홀드아웃 시작)`. 끝은 홀드아웃 시작 직전 세션이다."""
    baseline = PAPER_CORE_V1.parameters
    plan = plan_walk_forward(
        connection,
        SOURCE_VERSION,
        parameters=baseline,
        fold_sessions=FOLD_SESSIONS,
        holdout_sessions=HOLDOUT_SESSIONS,
        start=BARS_START,
        reference_symbol=REFERENCE_SYMBOL,
    )
    sessions = [
        row["trade_date"]
        for row in connection.execute(
            "SELECT trade_date FROM bars_daily"
            " WHERE symbol = ? AND source_version = ? AND trade_date >= ?"
            " ORDER BY trade_date",
            (REFERENCE_SYMBOL, SOURCE_VERSION, BARS_START),
        )
    ]
    holdout_start = plan.holdout.start
    return (
        sessions[baseline.min_history_sessions],
        sessions[sessions.index(holdout_start) - 1],
        holdout_start,
    )


def run_core(
    connection, core: CoreDefinition, scenario: str, seed: int = 0
) -> int:
    start, end, holdout_start = research_window(connection)
    config = BacktestConfig(
        source_version=SOURCE_VERSION,
        start=start,
        end=end,
        index_names=INDEX_NAMES,
        # 규칙은 코어 파일이 정한다. 러너는 구간·적재분·시나리오만 얹는다.
        **core.run_kwargs(),
        unresolved_exit_price=scenario,
        random_seed=seed,
    )
    suffix = f"-seed{seed:02d}" if core.entry_mode == "RANDOM" else ""
    run_id = f"{core.name}{suffix}-{scenario.lower()}-{start}-{end}"
    print(f"# {run_id}")
    print(f"  {core.summary}")
    print(f"  구간 {start} ~ {end} (홀드아웃 {holdout_start}부터는 보지 않는다)")
    print(f"  정책 {core.policy.policy_id} · 진입 {core.entry_mode}"
          f" · 청산 {core.exit_mode} · 레짐 {core.regime_mode}"
          f" · 미해결 {scenario}")

    result = run_backtest(connection, config)
    save_run(connection, result, run_id, survivorship_biased=False)
    metrics = compute_metrics(result)
    gate = evaluate_gate(result, metrics, survivorship_biased=False)

    out = RUNS_DIR / experiment_for(core)
    out.mkdir(parents=True, exist_ok=True)
    (out / f"{run_id}.md").write_text(
        judgment_markdown(result, metrics, gate, run_id=run_id), encoding="utf-8"
    )
    (out / f"{run_id}.json").write_text(
        judgment_json(judgment_payload(result, metrics, gate)), encoding="utf-8"
    )

    print(f"  거래 {metrics.trade_count:,}건 · 기대값 {metrics.expectancy_r}"
          f" · PF {metrics.profit_factor}")
    print(f"  총수익률 {metrics.total_return:.2%} · 최대낙폭 {metrics.max_drawdown:.2%}"
          f" · 평균 익스포저 {metrics.avg_exposure:.2%}")
    print(f"  판정 {gate.verdict} (blocker {', '.join(gate.blockers)})")
    print(f"  보고서: {RUNS_DIR.name}/{experiment_for(core)}/{run_id}.md\n")
    return 0


def stage_bench(connection) -> int:
    """저장된 실행을 노출 일치 벤치마크와 견준다. 새 백테스트를 돌리지 않는다."""
    from backtest.benchmark import benchmark_table

    start, end, _ = research_window(connection)
    closes = {
        row["trade_date"]: row["adj_close"]
        for row in connection.execute(
            "SELECT trade_date, adj_close FROM bars_daily"
            " WHERE symbol = ? AND source_version = ?",
            (REFERENCE_SYMBOL, SOURCE_VERSION),
        )
    }
    lines = [
        "# 노출 일치 벤치마크",
        "",
        f"구간 {start} ~ {end} · 기준 {REFERENCE_SYMBOL} · 적재분 `{SOURCE_VERSION}`",
        "",
        "**전략과 같은 비율만큼 지수를 들고 있었다면 얼마였나.** 노출이 같으므로 남는"
        " 차이는 무엇을 샀는가뿐이다. 벤치마크는 거래 비용을 내지 않고 그날의 전략 노출을"
        " 미리 아는 것으로 치므로 **실행 불가능하고 일부러 후하게 잡은 상대**다.",
        "",
        "|실행|총수익|CAGR|MDD|Sharpe|",
        "|---|---|---|---|---|",
    ]
    for name in CORE_NAMES:
        run_id = f"{name}-last_close-{start}-{end}"
        curve = [
            row
            for row in connection.execute(
                "SELECT trade_date, equity, exposure FROM backtest_equity"
                " WHERE run_id = ? ORDER BY trade_date",
                (run_id,),
            )
        ]
        if not curve:
            continue
        points = [
            _CurvePoint(row["trade_date"], row["equity"], row["exposure"])
            for row in curve
        ]
        final = points[-1].equity / 100_000.0 - 1
        lines.append(f"|**{name}**|{final * 100:+.1f}%|—|—|—|")
        for row in benchmark_table(points, closes):
            sharpe = "—" if row.sharpe is None else f"{row.sharpe:.2f}"
            cagr = "—" if row.cagr is None else f"{row.cagr * 100:.2f}%"
            lines.append(
                f"|└ {row.label}|{row.total_return * 100:+.1f}%|{cagr}"
                f"|{row.max_drawdown * 100:.1f}%|{sharpe}|"
            )
    out = RUNS_DIR / EXPERIMENT
    out.mkdir(parents=True, exist_ok=True)
    path = out / "benchmark-exposure-matched.md"
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("\n".join(lines))
    print(f"\n보고서: {RUNS_DIR.name}/{EXPERIMENT}/{path.name}")
    return 0


@dataclass(frozen=True)
class _CurvePoint:
    """`benchmark`가 요구하는 최소 인터페이스. DB 행을 그대로 넘기지 않는다."""

    trade_date: str
    equity: float
    exposure: float


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("core", choices=[*CORE_NAMES, RANDOM_CORE, "all", "bench"])
    arguments = parser.parse_args()
    connection = store.connect()
    try:
        if arguments.core == "bench":
            return stage_bench(connection)
        if arguments.core == RANDOM_CORE:
            # 대조군은 시드만 바꿔 여러 번 돈다. 미해결 시나리오는 `RX` 한 건이
            # 지배하고 그 답이 이미 나왔으므로 `LAST_CLOSE` 하나로 둔다.
            for seed in RANDOM_SEEDS:
                status = run_core(
                    connection, CORES[RANDOM_CORE], LAST_CLOSE_EXIT, seed
                )
                if status != 0:
                    return status
            return 0
        names = CORE_NAMES if arguments.core == "all" else (arguments.core,)
        for name in names:
            for scenario in UNRESOLVED_EXIT_PRICES:
                status = run_core(connection, CORES[name], scenario)
                if status != 0:
                    return status
    finally:
        connection.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
