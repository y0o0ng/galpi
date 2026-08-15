"""신호 수명이 포트폴리오 수익으로 이어지는가. **K=42·63·84를 같은 자리에서 견준다.**

`runs/signal-rs63/`은 RS63,5의 초과수익이 +84세션까지 감쇠하지 않는다고 쟀다. 그건
**선택 층**의 성질이다. 이 실험은 그 수명이 슬롯·수량·비용·청산이 붙은 **포트폴리오
층**에서도 값이 되는지 묻는다. PR #8의 J/K 실험(`runs/jt-jk/`)을 그대로 잇는다.

## 무엇을 고정했나

J=63·skip=5·RS63,5 랭킹·유니버스·TOP5·수량·슬롯·비용·진입 역학·`MARKET` 레짐·만기 청산
구조·폐지 처리를 전부 PR #8과 같게 둔다. **바꾼 것은 `max_hold_sessions` 하나다.** 새
지표·필터·레짐 게이트·손절 규칙을 넣지 않는다. 특히 BULL-only 게이트는 넣지 않고 레짐은
성과 분해용 라벨로만 쓴다.

## 대조군이 질문의 절반이다

K를 늘리면 무작위 선택도 같이 좋아질 수 있다 — 오래 들고 있으면 시장 표류를 더 받고,
자리가 늦게 비어 회전과 비용이 준다. 그래서 K마다 **같은 K의 무작위 대조군**을 시드
10개로 돌린다. 묻는 것은 둘이고 서로 다르다.

1. 보유기간을 늘렸더니 **모두** 좋아졌는가
2. RS가 무작위보다 **더** 좋아졌는가

## 미리 정한 판정 기준 — 결과를 본 뒤 바꾸지 않는다

- **A.** K63 또는 K84가 K42보다 after-cost 성과에서 개선되는가
- **B.** 그 개선이 노출 일치 SPY 대비 격차에서도 나타나는가
- **C.** 같은 K의 무작위 대조군보다 RS가 우위인가
- **D.** 개선이 특정 한두 해나 특정 레짐에만 의존하지 않는가
- **E.** LAST_CLOSE / ZERO 민감도에서도 전략 간 순위가 유지되는가

## 미리 정한 해석 규칙

|경우|관측|읽는 법|
|---|---|---|
|1|K63/84가 K42보다 낫고 무작위보다 우위이며 벤치마크 격차도 개선|신호 수명이 포트폴리오 edge로 이어진다|
|2|K63/84가 낫지만 무작위도 같은 정도로 낫다|보유기간 효과이고 RS의 추가 가치는 약하다|
|3|신호 연구는 +84까지 edge였는데 포트폴리오는 악화|신호는 있으나 수량·슬롯·비용·청산이 변환하지 못한다|
|4|BULL에서만 반복적으로 좋고 나머지에서 악화|레짐 조건부 모멘텀을 별도 실험으로 승격|

## 홀드아웃과 산출물

구간은 `momentum_run.research_window`가 정한다 — `backtest/holdout.py`의 `HOLDOUT_START`
전에서 끊고 워크포워드를 돌리지 않으며 `record_holdout_run`을 부르지 않는다.

**DB에 저장하지 않고 실행마다 JSON 하나를 쓴다.** 36개 실행을 병렬로 돌리는데 같은
SQLite에 동시에 쓸 이유가 없고, 판정의 정본은 어차피 저장소에 커밋되는 산출물이다.

    python3 selftest/k_lifetime_run.py run jt-k63 LAST_CLOSE
    python3 selftest/k_lifetime_run.py run jt-random-k63 LAST_CLOSE --seed 3
    python3 selftest/k_lifetime_run.py plan     # 돌릴 목록만 출력한다
    python3 selftest/k_lifetime_run.py report   # 쌓인 JSON으로 보고서를 만든다
"""

from __future__ import annotations

import argparse
import json
import statistics
import sys
from pathlib import Path

TRADING_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TRADING_ROOT))

from backtest import store  # noqa: E402
from backtest.benchmark import benchmark_table, exposure_matched  # noqa: E402
from backtest.control import RandomStats  # noqa: E402
from backtest.loop import BacktestConfig, run_backtest  # noqa: E402
from backtest.metrics import compute_metrics  # noqa: E402
from backtest.modes import LAST_CLOSE_EXIT, UNRESOLVED_EXIT_PRICES  # noqa: E402
from backtest.report import (  # noqa: E402
    judgment_json,
    judgment_markdown,
    judgment_payload,
)
from backtest.validation import evaluate_gate  # noqa: E402
from core import CORES  # noqa: E402
from selftest.momentum_run import research_window  # noqa: E402
from selftest.real_run import (  # noqa: E402
    INDEX_NAMES,
    REFERENCE_SYMBOL,
    RUNS_DIR,
    SOURCE_VERSION,
)

EXPERIMENT = "jt-k-lifetime"
# K=42는 PR #8의 재현 기준점이라 반드시 함께 돈다. 새 값만 돌리면 엔진·홀드아웃 정책이
# 그 사이 바뀌었는지 알 수 없다.
HOLDS = (42, 63, 84)
RANDOM_SEEDS = tuple(range(10))


def rs_core(hold: int) -> str:
    return f"jt-k{hold}"


def random_core(hold: int) -> str:
    return f"jt-random-k{hold}"


def run_id_for(core_name: str, scenario: str, seed: int) -> str:
    suffix = f"-seed{seed:02d}" if CORES[core_name].entry_mode == "RANDOM" else ""
    return f"{core_name}{suffix}-{scenario.lower()}"


def out_dir() -> Path:
    path = RUNS_DIR / EXPERIMENT
    path.mkdir(parents=True, exist_ok=True)
    return path


def planned() -> list[tuple[str, str, int]]:
    """`(코어, 시나리오, 시드)` 전부.

    **RS만 두 시나리오를 돈다.** 폐지 가정은 전략 간 순위를 흔드는지 보려는 것이고 그
    순위는 RS끼리의 것이다. 무작위까지 두 벌 돌리면 실행이 30개 더 늘고, PR #8에서 이미
    `RX` 한 건이 그 시나리오를 지배한다는 답이 나왔다.
    """
    jobs: list[tuple[str, str, int]] = []
    for hold in HOLDS:
        for scenario in UNRESOLVED_EXIT_PRICES:
            jobs.append((rs_core(hold), scenario, 0))
    for hold in HOLDS:
        for seed in RANDOM_SEEDS:
            jobs.append((random_core(hold), LAST_CLOSE_EXIT, seed))
    return jobs


def reference_closes(connection) -> dict[str, float]:
    return {
        row["trade_date"]: row["adj_close"]
        for row in connection.execute(
            "SELECT trade_date, adj_close FROM bars_daily"
            " WHERE symbol = ? AND source_version = ?",
            (REFERENCE_SYMBOL, SOURCE_VERSION),
        )
    }


def regime_detail(result, closes: dict[str, float]) -> list[dict]:
    """레짐별 전략 수익·노출 일치 벤치마크·기대값.

    **첫 세션은 양쪽 다 뺀다.** 노출 일치 수익률은 전날 비중이 오늘 움직임을 버는 구조라
    전이(transition)마다 하나씩 나오고 곡선의 점보다 하나 적다. 같은 자리를 짝지어야
    격차가 같은 날들을 견주는 값이 된다.

    **수익률과 기대값은 같은 거래를 보지 않는다.** 수익률은 그 상태로 지낸 날들의 것이고
    기대값은 그 상태에서 **진입한** 거래의 것이다. 포지션은 레짐 경계를 넘어 들고 간다.
    """
    curve = result.equity_curve
    if len(curve) < 2:
        return []
    matched = exposure_matched(curve, closes)
    grouped: dict[str, dict[str, list[float]]] = {}
    previous = curve[0].equity
    for index in range(1, len(curve)):
        point = curve[index]
        session_return = point.equity / previous - 1 if previous > 0 else 0.0
        previous = point.equity
        bucket = grouped.setdefault(
            point.market_regime, {"strategy": [], "benchmark": []}
        )
        bucket["strategy"].append(session_return)
        bucket["benchmark"].append(matched[index - 1])

    regime_on = {point.trade_date: point.market_regime for point in curve}
    trades_by_regime: dict[str, list] = {}
    for trade in result.trades:
        state = regime_on.get(trade.entry_date, "UNKNOWN")
        trades_by_regime.setdefault(state, []).append(trade)

    def compound(values: list[float]) -> float:
        equity = 1.0
        for value in values:
            equity *= 1 + value
        return equity - 1

    rows = []
    for state in sorted(grouped):
        trades = trades_by_regime.get(state, [])
        wins = [trade.pnl for trade in trades if trade.pnl > 0]
        losses = [-trade.pnl for trade in trades if trade.pnl < 0]
        strategy = compound(grouped[state]["strategy"])
        benchmark = compound(grouped[state]["benchmark"])
        rows.append(
            {
                "regime": state,
                "sessions": len(grouped[state]["strategy"]),
                "trade_count": len(trades),
                "expectancy_r": statistics.fmean(t.return_r for t in trades)
                if trades
                else None,
                "profit_factor": sum(wins) / sum(losses) if losses else None,
                "strategy_return": strategy,
                "benchmark_return": benchmark,
                "gap": strategy - benchmark,
            }
        )
    return rows


def stage_run(connection, core_name: str, scenario: str, seed: int) -> int:
    core = CORES[core_name]
    start, end, holdout_start = research_window(connection)
    config = BacktestConfig(
        source_version=SOURCE_VERSION,
        start=start,
        end=end,
        index_names=INDEX_NAMES,
        # 규칙은 코어 파일이 정한다. 러너는 구간·시나리오·시드만 얹는다.
        **core.run_kwargs(),
        unresolved_exit_price=scenario,
        random_seed=seed,
    )
    run_id = run_id_for(core_name, scenario, seed)
    print(f"# {run_id}")
    print(f"  {core.summary}")
    print(f"  구간 {start} ~ {end} (홀드아웃 {holdout_start}부터는 보지 않는다)")

    result = run_backtest(connection, config)
    metrics = compute_metrics(result)
    gate = evaluate_gate(result, metrics, survivorship_biased=False)
    closes = reference_closes(connection)

    payload = judgment_payload(result, metrics, gate)
    payload["run_id"] = run_id
    payload["experiment"] = EXPERIMENT
    payload["core"] = core_name
    payload["seed"] = seed
    payload["max_hold_sessions"] = core.policy.parameters.max_hold_sessions
    payload["benchmark"] = [
        {
            "label": row.label,
            "total_return": row.total_return,
            "cagr": row.cagr,
            "max_drawdown": row.max_drawdown,
            "sharpe": row.sharpe,
        }
        for row in benchmark_table(result.equity_curve, closes)
    ]
    payload["regime_detail"] = regime_detail(result, closes)

    path = out_dir() / f"{run_id}.json"
    path.write_text(judgment_json(payload), encoding="utf-8")
    # RS 실행만 마크다운을 남긴다. 무작위 시드 30개까지 남기면 폴더가 대조군 파일로 덮여
    # 비교 세트를 읽을 수 없다. 시드별 숫자는 JSON과 보고서 분포표에 있다.
    if core.entry_mode != "RANDOM":
        (out_dir() / f"{run_id}.md").write_text(
            judgment_markdown(result, metrics, gate, run_id=run_id), encoding="utf-8"
        )

    matched = payload["benchmark"][0]
    print(f"  거래 {metrics.trade_count:,} · 기대값 {metrics.expectancy_r}"
          f" · PF {metrics.profit_factor}")
    print(f"  총수익 {metrics.total_return:.2%} · MDD {metrics.max_drawdown:.2%}"
          f" · 노출 {metrics.avg_exposure:.2%} · 회전 {metrics.turnover:.2f}배/년")
    print(f"  노출 일치 SPY {matched['total_return']:.2%}"
          f" · 격차 {metrics.total_return - matched['total_return']:+.2%}")
    print(f"  → {path.name}")
    return 0


def load_runs() -> dict[str, dict]:
    return {
        path.stem: json.loads(path.read_text(encoding="utf-8"))
        for path in sorted(out_dir().glob("*.json"))
    }


def _pct(value: float | None, digits: int = 1) -> str:
    return "—" if value is None else f"{value * 100:+.{digits}f}%"


def _num(value: float | None, digits: int = 3) -> str:
    return "—" if value is None else f"{value:.{digits}f}"


def gap_of(run: dict) -> float | None:
    """전략 총수익 − 노출 일치 SPY 총수익."""
    if not run.get("benchmark"):
        return None
    return run["metrics"]["total_return"] - run["benchmark"][0]["total_return"]


def stage_report(_connection) -> int:
    runs = load_runs()
    missing = [
        run_id_for(*job) for job in planned() if run_id_for(*job) not in runs
    ]
    lines = [
        "# K 신호 수명 실험 — RS vs 무작위, K=42/63/84",
        "",
        "**물은 것:** `runs/signal-rs63/`이 잰 RS63,5의 긴 신호 수명이 실제 포트폴리오에서"
        " K=63/84 개선으로 이어지는가. 그리고 그 개선이 오래 보유해서가 아니라 **RS 랭킹**"
        "에서 오는가.",
        "",
        f"바꾼 것은 `max_hold_sessions` 하나다. 무작위 대조군은 K마다 따로 두고 시드"
        f" {len(RANDOM_SEEDS)}개를 돌린다. 판정 기준 A~E와 해석 규칙은 러너 docstring에"
        " 미리 적어뒀다.",
        "",
    ]
    if missing:
        lines += [f"**아직 없는 실행 {len(missing)}개:** {', '.join(missing)}", ""]

    lines += ["## 1. RS K42/63/84 (LAST_CLOSE)", "",
              "|K|거래|승률|기대값R|PF|총수익|CAGR|MDD|Sharpe|Sortino|노출|회전|비용|평균보유|",
              "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|"]
    for hold in HOLDS:
        run = runs.get(run_id_for(rs_core(hold), LAST_CLOSE_EXIT, 0))
        if not run:
            continue
        m = run["metrics"]
        lines.append(
            f"|**{hold}**|{m['trade_count']:,}|{_pct(m['win_rate'], 1)}"
            f"|{_num(m['expectancy_r'])}|{_num(m['profit_factor'], 2)}"
            f"|{_pct(m['total_return'])}|{_pct(m['cagr'], 2)}"
            f"|{_pct(m['max_drawdown'])}|{_num(m['sharpe'], 2)}"
            f"|{_num(m['sortino'], 2)}|{_pct(m['avg_exposure'])}"
            f"|{_num(m['turnover'], 2)}|${m['fees_paid']:,.0f}"
            f"|{_num(m['avg_hold_sessions'], 1)}|"
        )

    lines += ["", "## 2. 노출 일치 SPY 대비", "",
              "**전략과 같은 비율만큼 SPY를 들고 있었다면.** 비용을 내지 않고 그날의 전략"
              " 노출을 미리 아는 것으로 치므로 실행 불가능하고 일부러 후하게 잡은 상대다.",
              "",
              "|K|전략 총수익|노출 일치 SPY|격차|평균 노출 고정|100% 보유|",
              "|---|---|---|---|---|---|"]
    for hold in HOLDS:
        run = runs.get(run_id_for(rs_core(hold), LAST_CLOSE_EXIT, 0))
        if not run or not run.get("benchmark"):
            continue
        bench = run["benchmark"]
        lines.append(
            f"|**{hold}**|{_pct(run['metrics']['total_return'])}"
            f"|{_pct(bench[0]['total_return'])}|**{_pct(gap_of(run))}**"
            f"|{_pct(bench[1]['total_return'])}|{_pct(bench[2]['total_return'])}|"
        )

    lines += ["", "## 3. RS 대 같은 K의 무작위 대조군", "",
              "**핵심 표다.** 보유기간을 늘렸더니 모두 좋아졌는가와 RS가 더 좋아졌는가를"
              " 가른다. 무작위도 같이 좋아지면 그것은 신호 수명이 아니라 장기 보유·시장"
              " 표류·비용 감소 효과다.", ""]
    for label, key in (
        ("총수익", lambda run: run["metrics"]["total_return"]),
        ("기대값R", lambda run: run["metrics"]["expectancy_r"]),
        ("노출 일치 격차", gap_of),
    ):
        lines += [f"**{label}**", "",
                  "|K|무작위 최소|중앙|최대|평균|표준편차|**RS**|이김|",
                  "|---|---|---|---|---|---|---|---|"]
        for hold in HOLDS:
            rs = runs.get(run_id_for(rs_core(hold), LAST_CLOSE_EXIT, 0))
            values = [
                key(runs[run_id_for(random_core(hold), LAST_CLOSE_EXIT, seed)])
                for seed in RANDOM_SEEDS
                if run_id_for(random_core(hold), LAST_CLOSE_EXIT, seed) in runs
            ]
            stats = RandomStats.of(value for value in values if value is not None)
            if not rs or stats is None:
                continue
            actual = key(rs)
            show = _num if label == "기대값R" else _pct
            deviation = "—" if stats.stdev is None else (
                f"{stats.stdev:.3f}" if label == "기대값R" else f"{stats.stdev * 100:.1f}%"
            )
            lines.append(
                f"|**{hold}**|{show(stats.minimum)}|{show(stats.median)}"
                f"|{show(stats.maximum)}|{show(stats.mean)}|{deviation}"
                f"|**{show(actual)}**|{stats.beaten_by(actual)}/{stats.count}|"
            )
        lines.append("")

    lines += ["## 4. 무작위 대조군 시드별", "",
              "|K|" + "|".join(f"s{seed:02d}" for seed in RANDOM_SEEDS) + "|",
              "|---|" + "---|" * len(RANDOM_SEEDS)]
    for hold in HOLDS:
        cells = []
        for seed in RANDOM_SEEDS:
            run = runs.get(run_id_for(random_core(hold), LAST_CLOSE_EXIT, seed))
            cells.append(_pct(run["metrics"]["total_return"], 0) if run else "—")
        lines.append(f"|**{hold}**|" + "|".join(cells) + "|")

    lines += ["", "## 5. 레짐별 (진입 시점 라벨 · 게이트는 넣지 않았다)", ""]
    for hold in HOLDS:
        run = runs.get(run_id_for(rs_core(hold), LAST_CLOSE_EXIT, 0))
        if not run or not run.get("regime_detail"):
            continue
        lines += [f"**K={hold}**", "",
                  "|상태|세션|거래|기대값R|PF|전략 수익|노출 일치|격차|",
                  "|---|---|---|---|---|---|---|---|"]
        for row in run["regime_detail"]:
            lines.append(
                f"|{row['regime']}|{row['sessions']:,}|{row['trade_count']:,}"
                f"|{_num(row['expectancy_r'])}|{_num(row['profit_factor'], 2)}"
                f"|{_pct(row['strategy_return'])}|{_pct(row['benchmark_return'])}"
                f"|{_pct(row['gap'])}|"
            )
        lines.append("")

    lines += ["## 6. 연도별", "",
              "|연도|" + "|".join(f"K{hold} 수익" for hold in HOLDS)
              + "|" + "|".join(f"K{hold} 거래" for hold in HOLDS) + "|",
              "|---|" + "---|" * (2 * len(HOLDS))]
    years: dict[str, dict[int, dict]] = {}
    for hold in HOLDS:
        run = runs.get(run_id_for(rs_core(hold), LAST_CLOSE_EXIT, 0))
        for row in (run or {}).get("period_performance", []):
            years.setdefault(row["label"], {})[hold] = row
    for year in sorted(years):
        returns = [_pct(years[year].get(h, {}).get("total_return")) for h in HOLDS]
        counts = [str(years[year].get(h, {}).get("trade_count", "—")) for h in HOLDS]
        lines.append(f"|{year}|" + "|".join(returns + counts) + "|")

    lines += ["", "## 7. 폐지 가정 민감도 (LAST_CLOSE vs ZERO)", "",
              "거래를 멈춘 종목의 청산가를 마지막 종가로 볼 것인가 0으로 볼 것인가."
              " **결론의 순위가 이 가정에 따라 바뀌면 그 결론은 가정의 것이다.**", "",
              "|K|LAST_CLOSE 총수익|ZERO 총수익|차이|LAST_CLOSE 기대값|ZERO 기대값|",
              "|---|---|---|---|---|---|"]
    for hold in HOLDS:
        last = runs.get(run_id_for(rs_core(hold), LAST_CLOSE_EXIT, 0))
        zero = runs.get(run_id_for(rs_core(hold), "ZERO", 0))
        if not last or not zero:
            continue
        lines.append(
            f"|**{hold}**|{_pct(last['metrics']['total_return'])}"
            f"|{_pct(zero['metrics']['total_return'])}"
            f"|{_pct(zero['metrics']['total_return'] - last['metrics']['total_return'])}"
            f"|{_num(last['metrics']['expectancy_r'])}"
            f"|{_num(zero['metrics']['expectancy_r'])}|"
        )

    lines.append("")
    path = out_dir() / "results.md"
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("\n".join(lines))
    print(f"\n보고서: {RUNS_DIR.name}/{EXPERIMENT}/{path.name}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="stage", required=True)
    runner = sub.add_parser("run")
    runner.add_argument("core", choices=sorted(CORES))
    runner.add_argument("scenario", choices=sorted(UNRESOLVED_EXIT_PRICES))
    runner.add_argument("--seed", type=int, default=0)
    sub.add_parser("plan")
    sub.add_parser("report")
    arguments = parser.parse_args()

    if arguments.stage == "plan":
        for core_name, scenario, seed in planned():
            print(f"{core_name} {scenario} {seed}")
        return 0

    connection = store.connect()
    try:
        if arguments.stage == "run":
            return stage_run(
                connection, arguments.core, arguments.scenario, arguments.seed
            )
        return stage_report(connection)
    finally:
        connection.close()


if __name__ == "__main__":
    sys.exit(main())
