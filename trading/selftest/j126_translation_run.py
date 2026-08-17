"""J126의 신호 우위가 실제 포트폴리오 수익으로 번역되는가. **J63 vs J126 둘만 본다.**

PR #12(`runs/signal-j-study/`)가 신호 층에서 J 사다리를 열었고 challenger를 J126 하나로
줄였다. 이 실험은 그 우위가 **슬롯·수량·비용·청산·체결이 붙은 포트폴리오 층에서도
after-cost·benchmark-relative 우위로 번역되는가**만 묻는다.

**새 J 탐색이 아니다. 파라미터 최적화도 아니다.** 사다리를 포트폴리오 층에서 다시 열지
않는다 — J21·J42는 신호 층에서 무작위 분포 안이었고, J189는 NDX100 재현이 약하고 사다리
경계값이라 올리지 않았다.

## 신호 층과 포트폴리오 층은 같은 명제가 아니다

- **신호 층**(PR #12): J126의 TOP5 forward 초과수익이 J63보다 강했다.
- **포트폴리오 층**(이번): 실제 슬롯·위험·비용·체결 아래에서 수익으로 번역되는가.

PR #10은 K에서, PR #11은 슬롯에서 각각 "신호 층 우위가 자동 번역되지 않는다"를 보였다.
**번역된다는 가정에서 출발하지 않는다.**

## 고정한 것

J 외에는 PR #10의 K42 기준선과 같다 — K=42 · skip=5 · 슬롯 5 · TOP5 · RS-only 진입 ·
거래당 sizing 단위 0.25% · 총 계획 위험 한도 1.25% · 최대 노출 60% · 종목당 비중 · 섹터·상관 한도 ·
하루 진입 상한 · `MARKET` 레짐 · 만기 청산 · 체결 · 비용 · 폐지 처리 · 유니버스 · 필터.

**유일한 전략 차이는 `rs_lookback` 63 → 126이다.** `test_j126.py`가 dataclass 수준에서
잠근다.

## 무작위 대조군은 J별로 복제하지 않는다

`RANDOM` 랭킹은 J 신호를 아예 쓰지 않는다. 그래서 `random-j63`·`random-j126` 같은 서로
다른 대조군을 만드는 척하지 않고, 기존 `jt-random-k42`를 그대로 재사용해 **J63과 J126을
같은 10시드 분포와** 견준다. **시드 10개는 formal p-value가 아니다.**

## 사전 고정한 primary endpoint

    exposure_matched_gap = 전략 총수익 − 노출 일치 SPY 총수익
    Δprimary = gap(J126) − gap(J63)

J가 바뀌면 후보 churn과 자리 점유가 달라져 평균 노출도 조금 달라진다. raw 수익만 보면
신호 품질과 노출 차이를 섞어 읽게 되므로 격차를 먼저 본다.

## 사전 판정 기준 A~J — 결과를 본 뒤 바꾸지 않는다

- **A.** J126의 노출 일치 격차가 J63보다 개선되는가
- **B.** J126 총수익도 J63보다 개선되는가
- **C.** 그 개선이 단순 노출 증가 없이 나타나는가
- **D.** 공통 무작위 대조군 대비 상대 위치도 J126에서 개선되는가
- **E.** LAST_CLOSE와 ZERO에서 총수익 순위가 유지되는가
- **F.** 거래 수·회전·비용 차이가 결과를 어떻게 동반하는가
- **G.** 연도별 결과가 한두 특수 연도에 과도하게 의존하지 않는가
- **H.** 레짐별로 완전히 반대되는 구조가 있는가
- **I.** J63 기준선이 정확히 재현되는가
- **J.** 신호 층 challenger였던 J126이 포트폴리오 층에서도 challenger 자격을 유지하는가

## 사전 해석 규칙

|경우|관측|읽는 법|
|---|---|---|
|1|격차·총수익 모두 개선 · 노출 증가 탓이 아님 · 무작위 대비도 개선 · 폐지 순위 유지|신호 우위가 번역됐다. **개발 기준선 승격 근거**(실전 승인 아님)|
|2|격차 또는 총수익 개선 없음|PR #10과 같은 번역 실패. **J63 유지**|
|3|총수익만 높고 격차는 그대로|노출·시장 참여 변화. 번역 성공으로 판정하지 않는다|
|4|회전·비용이 크게 줄어 after-cost만 좋아짐|낮은 churn의 이점은 관찰되나 순수 랭킹 개선으로 과장하지 않는다|
|5|LAST_CLOSE 우세인데 ZERO에서 순위 역전|폐지 가정에 민감. **승격 보류**|
|6|평균은 좋은데 한두 해·한 레짐이 사실상 전부 설명|challenger 근거는 남지만 기준선 교체 근거는 약화|

**애매하면 J63을 유지한다.** 신호 연구에서 좋아 보였다는 이유로 포트폴리오 결과를 무시하고
승격시키지 않는다.

## 개발 표본이다

이 구간은 PR #9~#12에서 반복 사용됐다. 결과를 "OOS 검증"이라고 부르지 않는다. 기준선
변경은 **"앞으로 무엇을 기준점으로 삼을 것인가"**의 결정이지 실전 투입 승인이 아니다.

    python3 selftest/j126_translation_run.py plan
    python3 selftest/j126_translation_run.py run jt-j126-k42 LAST_CLOSE
    python3 selftest/j126_translation_run.py report
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
from backtest.benchmark import benchmark_table  # noqa: E402
from backtest.control import RandomStats  # noqa: E402
from backtest.loop import BacktestConfig, run_backtest  # noqa: E402
from backtest.metrics import compute_metrics  # noqa: E402
from backtest.modes import LAST_CLOSE_EXIT, UNRESOLVED_EXIT_PRICES  # noqa: E402
from backtest.report import judgment_json, judgment_payload  # noqa: E402
from backtest.validation import evaluate_gate  # noqa: E402
from core import CORES  # noqa: E402
from selftest.k_lifetime_run import reference_closes, regime_detail  # noqa: E402
from selftest.momentum_run import research_window  # noqa: E402
from selftest.real_run import INDEX_NAMES, RUNS_DIR, SOURCE_VERSION  # noqa: E402
from selftest.slot_capacity_run import capacity_diagnostics  # noqa: E402

EXPERIMENT = "j126-portfolio-translation"

# 비교 대상은 정확히 둘이다. 사다리를 포트폴리오 층에서 다시 열지 않는다.
BASELINE = "jt-k42"
CHALLENGER = "jt-j126-k42"
SIGNALS = (BASELINE, CHALLENGER)
# **J별로 복제하지 않는다.** RANDOM 랭킹은 J를 쓰지 않으므로 하나를 공유한다.
CONTROL = "jt-random-k42"
RANDOM_SEEDS = tuple(range(10))

LABELS = {BASELINE: "J63", CHALLENGER: "J126"}


def run_id_for(core: str, scenario: str, seed: int) -> str:
    suffix = f"-seed{seed:02d}" if CORES[core].entry_mode == "RANDOM" else ""
    return f"{core}{suffix}-{scenario.lower()}"


def out_dir() -> Path:
    path = RUNS_DIR / EXPERIMENT
    path.mkdir(parents=True, exist_ok=True)
    return path


def planned() -> list[tuple[str, str, int]]:
    """RS 4개 + 공통 무작위 10개 = 14개."""
    jobs = [(core, scenario, 0)
            for core in SIGNALS for scenario in UNRESOLVED_EXIT_PRICES]
    jobs += [(CONTROL, LAST_CLOSE_EXIT, seed) for seed in RANDOM_SEEDS]
    return jobs


def stage_run(connection, core_key: str, scenario: str, seed: int) -> int:
    core = CORES[core_key]
    start, end, holdout_start = research_window(connection)
    config = BacktestConfig(
        source_version=SOURCE_VERSION,
        start=start,
        end=end,
        index_names=INDEX_NAMES,
        **core.run_kwargs(),
        unresolved_exit_price=scenario,
        random_seed=seed,
    )
    run_id = run_id_for(core_key, scenario, seed)
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
    payload["core"] = core_key
    payload["seed"] = seed
    payload["rs_lookback"] = core.policy.parameters.rs_lookback
    payload["rs_skip"] = core.policy.parameters.rs_skip
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
    payload["capacity"] = capacity_diagnostics(result, core.policy)
    payload["regime_detail"] = regime_detail(result, closes)

    path = out_dir() / f"{run_id}.json"
    path.write_text(judgment_json(payload), encoding="utf-8")

    matched = payload["benchmark"][0]
    print(f"  거래 {metrics.trade_count:,} · 기대값 {metrics.expectancy_r}"
          f" · 총수익 {metrics.total_return:.2%}")
    print(f"  노출 {metrics.avg_exposure:.2%} · 회전 {metrics.turnover:.2f}"
          f" · 비용 ${metrics.fees_paid:,.0f}")
    print(f"  노출 일치 SPY {matched['total_return']:.2%}"
          f" · 격차 {metrics.total_return - matched['total_return']:+.2%}")
    print(f"  → {path.name}")
    return 0


def load_runs() -> dict[str, dict]:
    return {
        path.stem: json.loads(path.read_text(encoding="utf-8"))
        for path in sorted(out_dir().glob("*.json"))
    }


def _pct(value, digits: int = 1) -> str:
    return "—" if value is None else f"{value * 100:+.{digits}f}%"


def _share(value, digits: int = 1) -> str:
    return "—" if value is None else f"{value * 100:.{digits}f}%"


def _num(value, digits: int = 3) -> str:
    return "—" if value is None else f"{value:.{digits}f}"


def gap_of(run: dict):
    if not run or not run.get("benchmark"):
        return None
    return run["metrics"]["total_return"] - run["benchmark"][0]["total_return"]


def stage_report(_connection) -> int:
    runs = load_runs()
    missing = [run_id_for(*job) for job in planned() if run_id_for(*job) not in runs]
    signal = {
        core: runs.get(run_id_for(core, LAST_CLOSE_EXIT, 0)) for core in SIGNALS
    }
    control = [
        runs[run_id_for(CONTROL, LAST_CLOSE_EXIT, seed)]
        for seed in RANDOM_SEEDS
        if run_id_for(CONTROL, LAST_CLOSE_EXIT, seed) in runs
    ]

    lines = [
        "# J126 포트폴리오 번역 — J63 vs J126",
        "",
        "**물은 것 하나:** PR #12에서 확인한 J126의 신호 층 우위가 현재 K42/S5 모멘텀"
        " 포트폴리오에서 benchmark-relative after-cost 우위로 번역되는가.",
        "",
        "**유일한 전략 차이는 `rs_lookback` 63 → 126이다.** K=42 · skip=5 · 슬롯 5 ·"
        " TOP5 · 위험·비용·체결·청산·레짐·폐지 처리가 전부 같다. 판정 기준 A~J와 해석"
        " 규칙 1~6은 러너 docstring에 미리 적어뒀다.",
        "",
        "**개발 표본이다.** 이 구간은 PR #9~#12에서 반복 사용됐고 결과를 OOS 검증이라고"
        " 부르지 않는다.",
        "",
    ]
    if missing:
        lines += [f"**아직 없는 실행 {len(missing)}개:** {', '.join(missing)}", ""]

    lines += ["## 1. J63 재현 (LAST_CLOSE)", "",
              "**새 결과를 해석하기 전에 기준선이 재현돼야 한다.**", "",
              "|항목|PR #10/#11|이번|",
              "|---|---|---|"]
    baseline = signal[BASELINE]
    if baseline:
        m, b = baseline["metrics"], baseline["benchmark"][0]
        expected = [
            ("거래", "514", f"{m['trade_count']:,}"),
            ("기대값R", "0.229", _num(m["expectancy_r"])),
            ("PF", "1.29", _num(m["profit_factor"], 2)),
            ("총수익", "+35.4%", _pct(m["total_return"])),
            ("MDD", "9.4%", _share(m["max_drawdown"])),
            ("평균 노출", "17.9%", _share(m["avg_exposure"])),
            ("노출 일치 격차", "-12.7%p", _pct(gap_of(baseline))),
            ("평균 보유", "41.6", _num(m["avg_hold_sessions"], 1)),
        ]
        for label, want, got in expected:
            lines.append(f"|{label}|{want}|**{got}**|")

    lines += ["", "## 2. 주 결과 — J63 vs J126 (LAST_CLOSE)", "",
              "|지표|J63|J126|**delta**|",
              "|---|---|---|---|"]
    if all(signal.values()):
        a, c = signal[BASELINE], signal[CHALLENGER]
        ma, mc = a["metrics"], c["metrics"]
        rows = [
            ("**노출 일치 격차 (primary)**", gap_of(a), gap_of(c), _pct),
            ("총수익", ma["total_return"], mc["total_return"], _pct),
            ("CAGR", ma["cagr"], mc["cagr"], lambda v: _pct(v, 2)),
            ("노출 일치 SPY", a["benchmark"][0]["total_return"],
             c["benchmark"][0]["total_return"], _pct),
            ("평균 노출", ma["avg_exposure"], mc["avg_exposure"], _share),
            ("MDD", ma["max_drawdown"], mc["max_drawdown"], _share),
            ("Sharpe", ma["sharpe"], mc["sharpe"], lambda v: _num(v, 2)),
            ("Sortino", ma["sortino"], mc["sortino"], lambda v: _num(v, 2)),
            ("기대값R", ma["expectancy_r"], mc["expectancy_r"], _num),
            ("PF", ma["profit_factor"], mc["profit_factor"], lambda v: _num(v, 2)),
            ("승률", ma["win_rate"], mc["win_rate"], _share),
            ("회전", ma["turnover"], mc["turnover"], lambda v: _num(v, 2)),
            ("평균 보유", ma["avg_hold_sessions"], mc["avg_hold_sessions"],
             lambda v: _num(v, 1)),
        ]
        for label, left, right, fmt in rows:
            delta = (right - left) if (left is not None and right is not None) else None
            lines.append(f"|{label}|{fmt(left)}|{fmt(right)}|**{fmt(delta)}**|")
        lines.append(
            f"|거래 수|{ma['trade_count']:,}|{mc['trade_count']:,}"
            f"|**{mc['trade_count'] - ma['trade_count']:+,}**|"
        )
        lines.append(
            f"|비용|${ma['fees_paid']:,.0f}|${mc['fees_paid']:,.0f}"
            f"|**${mc['fees_paid'] - ma['fees_paid']:+,.0f}**|"
        )
        fee_a = ma["fees_paid"] / ma["trade_count"] if ma["trade_count"] else None
        fee_c = mc["fees_paid"] / mc["trade_count"] if mc["trade_count"] else None
        lines.append(
            f"|거래당 비용|${fee_a:,.2f}|${fee_c:,.2f}|**${fee_c - fee_a:+,.2f}**|"
        )

    lines += ["", "## 3. 공통 무작위 대조군 (K42 · 시드 10 · LAST_CLOSE)", "",
              "**J별로 복제하지 않았다.** `RANDOM` 랭킹은 J를 쓰지 않으므로 `jt-random-k42`"
              " 하나를 두 신호가 공유한다. **시드 10개는 formal p-value가 아니다.**", ""]
    if control:
        returns = RandomStats.of(run["metrics"]["total_return"] for run in control)
        gaps = RandomStats.of(gap_of(run) for run in control)
        lines += ["|무작위 분포|최소|중앙|최대|평균|표준편차|",
                  "|---|---|---|---|---|---|",
                  f"|총수익|{_pct(returns.minimum)}|{_pct(returns.median)}"
                  f"|{_pct(returns.maximum)}|{_pct(returns.mean)}"
                  f"|{returns.stdev * 100:.1f}%|",
                  f"|노출 일치 격차|{_pct(gaps.minimum)}|{_pct(gaps.median)}"
                  f"|{_pct(gaps.maximum)}|{_pct(gaps.mean)}|{gaps.stdev * 100:.1f}%|",
                  "",
                  "|신호|총수익|무작위 이김|노출 일치 격차|무작위 이김|",
                  "|---|---|---|---|---|"]
        for core in SIGNALS:
            run = signal[core]
            if not run:
                continue
            value, gap = run["metrics"]["total_return"], gap_of(run)
            lines.append(
                f"|**{LABELS[core]}**|{_pct(value)}"
                f"|{returns.beaten_by(value)}/{returns.count}"
                f"|{_pct(gap)}|{gaps.beaten_by(gap)}/{gaps.count}|"
            )

    lines += ["", "## 4. 처리량·용량 진단 (primary 아님)", "",
              "**J126의 낮은 후보 churn이 실제 처리량을 어떻게 바꾸는가.** 거래 수나 회전을"
              " 억지로 맞추지 않았다 — 그러면 J126이라는 신호 자체를 훼손한다.", "",
              "|지표|J63|J126|",
              "|---|---|---|"]
    if all(signal.values()):
        ca, cc = signal[BASELINE]["capacity"], signal[CHALLENGER]["capacity"]
        for label, key, fmt in (
            ("평균 점유", "avg_open_positions", lambda v: _num(v, 2)),
            ("점유율", "slot_utilization", _share),
            ("만석 세션", "sessions_at_full_capacity", lambda v: f"{v:,}"),
            ("만석 비율", "fraction_sessions_at_full_capacity", _share),
            ("진입/년", "entries_per_year", lambda v: _num(v, 1)),
        ):
            lines.append(f"|{label}|{fmt(ca[key])}|{fmt(cc[key])}|")
        for reason in ("MAX_POSITIONS_REACHED", "ALREADY_HELD", "DAILY_ENTRY_CAP"):
            left = ca["portfolio_stage_skips"].get(reason, 0)
            right = cc["portfolio_stage_skips"].get(reason, 0)
            lines.append(f"|`{reason}`|{left:,}|{right:,}|")

    lines += ["", "## 5. 폐지 가정 민감도", "",
              "**총수익 순위와 기대값 순위를 한 문장으로 합치지 않는다.** PR #10에서"
              " 기대값이 이 가정에 민감했다.", "",
              "|시나리오|J63 총수익|J126 총수익|순위|J63 기대값|J126 기대값|순위|",
              "|---|---|---|---|---|---|---|"]
    for scenario in UNRESOLVED_EXIT_PRICES:
        a = runs.get(run_id_for(BASELINE, scenario, 0))
        c = runs.get(run_id_for(CHALLENGER, scenario, 0))
        if not a or not c:
            continue
        ra, rc = a["metrics"]["total_return"], c["metrics"]["total_return"]
        ea, ec = a["metrics"]["expectancy_r"], c["metrics"]["expectancy_r"]
        lines.append(
            f"|{scenario}|{_pct(ra)}|{_pct(rc)}"
            f"|{'J126 우세' if rc > ra else 'J63 우세'}"
            f"|{_num(ea)}|{_num(ec)}"
            f"|{'J126 우세' if ec > ea else 'J63 우세'}|"
        )

    lines += ["", "## 6. 연도별 총수익", "",
              "|연도|J63|J126|delta|", "|---|---|---|---|"]
    years: dict[str, dict[str, float]] = {}
    for core in SIGNALS:
        for row in (signal[core] or {}).get("period_performance", []):
            years.setdefault(row["label"], {})[core] = row["total_return"]
    deltas = []
    for year in sorted(years):
        left = years[year].get(BASELINE)
        right = years[year].get(CHALLENGER)
        delta = (right - left) if (left is not None and right is not None) else None
        if delta is not None and year != "2007":
            deltas.append((delta, year))
        lines.append(f"|{year}|{_pct(left)}|{_pct(right)}|{_pct(delta)}|")
    if deltas:
        wins = sum(1 for delta, _ in deltas if delta > 0)
        best = max(deltas)
        worst = min(deltas)
        lines += ["",
                  f"J126이 높은 해 **{wins}/{len(deltas)}** · delta 중앙"
                  f" **{_pct(statistics.median(d for d, _ in deltas))}** ·"
                  f" 최대 **{best[1]} {_pct(best[0])}** ·"
                  f" 최소 **{worst[1]} {_pct(worst[0])}**"]

    lines += ["", "## 7. 레짐별 (진입 시점 라벨 · 게이트 없음)", "",
              "**레짐별 격차는 그 상태의 세션만 따로 복리한 값이라 레짐 간에 더해지지"
              " 않는다.** \"전체 개선의 몇 %가 어디서 왔다\"로 쓰지 않는다. 읽을 수 있는"
              " 것은 어디서 상대적 차이가 크게 관찰되는가뿐이다.", "",
              "|상태|J63 전략|J63 격차|J126 전략|J126 격차|격차 delta|",
              "|---|---|---|---|---|---|"]
    if all(signal.values()):
        detail = {
            core: {row["regime"]: row for row in signal[core]["regime_detail"]}
            for core in SIGNALS
        }
        for state in sorted(detail[BASELINE]):
            left = detail[BASELINE].get(state)
            right = detail[CHALLENGER].get(state)
            if not left or not right:
                continue
            lines.append(
                f"|{state}|{_pct(left['strategy_return'])}|{_pct(left['gap'])}"
                f"|{_pct(right['strategy_return'])}|{_pct(right['gap'])}"
                f"|{_pct(right['gap'] - left['gap'])}|"
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
    runner.add_argument("core", choices=[*SIGNALS, CONTROL])
    runner.add_argument("scenario", choices=sorted(UNRESOLVED_EXIT_PRICES))
    runner.add_argument("--seed", type=int, default=0)
    sub.add_parser("plan")
    sub.add_parser("report")
    arguments = parser.parse_args()

    if arguments.stage == "plan":
        for core, scenario, seed in planned():
            print(f"{core} {scenario} {seed}")
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
