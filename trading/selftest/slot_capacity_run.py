"""5개 슬롯이 긴 K의 병목이었는가. **총 계획 위험을 고정한 채 슬롯만 나눈다.**

PR #10(`runs/jt-k-lifetime/`)에서 K=84가 K=42보다 나빴다. 거래가 514 → 262로 반토막 나고
`MAX_POSITIONS_REACHED`가 12,243 → 16,030으로 늘어서, **5개 슬롯이 오래 점유되어 새 RS
신호를 받아들이지 못한다**는 가설이 생겼다. 그건 아직 가설이지 증거가 아니다.

이 실험이 묻는 것은 하나다.

> 총 계획 위험이 같은 상태에서 포트폴리오 용량을 더 많은 작은 포지션으로 나누면
> 긴 RS 신호 수명의 포트폴리오 변환 실패가 완화되는가. 그리고 그 회복이 단순
> 분산 효과가 아니라 RS 랭킹에서 오는가.

**"몇 슬롯이 최적인가"는 이번 질문이 아니다.** 사다리는 S5/S10/S20에서 끝나고 결과를 보고
S15·S30을 덧붙이지 않는다.

## 처치는 하나다

슬롯만 늘리고 거래당 위험을 그대로 두면 총 위험이 늘어 용량 실험이 아니라 레버리지
실험이 된다. `core/jt_slots.py`가 `max_positions × risk_per_trade = 0.0125`을 묶어서
지킨다. 다만 **계획 위험을 100% 쓰는 것은 아니므로 실현된 위험 사용률도 같이 잰다.**

## 상호작용을 본다 — 단순 비교로는 못 가른다

`S10 > S5`만 보면 그것은 슬롯을 늘린 일반 분산 효과일 수 있다. 궁금한 것은 **긴 K가
슬롯 증가에서 특별히 더 큰 도움을 받는가**다.

    slot_gain_K(S)      = M(K, S) - M(K, S5)
    rescue_interaction  = slot_gain_K84(S) - slot_gain_K42(S)

총수익과 노출 일치 격차 둘에서 먼저 본다. 무작위 대조군에서도 같은 상호작용 분포를 만들어
**RS의 rescue가 무작위에서도 흔한 일인지** 확인한다.

## 대조군은 점수 층에서 짝지어져 있다

`random_score(seed, as_of, symbol)`는 sha256 해시라 RNG 상태를 들고 다니지 않는다. 그래서
**같은 시드는 칸이 달라도 (날짜, 종목)에 같은 점수를 준다** — 후보 순위가 칸마다 동일하고,
실현된 진입만 자리 사정으로 갈린다. 짝지음은 점수 층까지이고 실현 진입까지가 아니다.

## 미리 정한 판정 기준 — 결과를 본 뒤 바꾸지 않는다

- **A.** S10 또는 S20에서 K84 성과가 K84,S5보다 개선되는가
- **B.** 그 개선이 노출 일치 SPY 격차에서도 나타나는가
- **C.** K84의 slot gain이 K42의 slot gain보다 큰가 (`rescue_interaction > 0`)
- **D.** 그 상호작용이 무작위에서도 비슷한가, 아니면 RS에서 더 강한가
- **E.** `MAX_POSITIONS_REACHED`와 만석 세션 비율이 슬롯 증가와 함께 실제로 줄어드는가
- **F.** 슬롯 병목이 풀린 뒤 다른 하드 한도가 새 병목으로 등장하는가
- **G.** 결론이 한두 해·특정 레짐·폐지 가정 하나에 과도하게 의존하는가

## 미리 정한 해석 규칙

|경우|관측|읽는 법|
|---|---|---|
|1|K84가 뚜렷이 회복 · K42보다 slot gain 큼 · 무작위보다 RS가 강함 · 격차도 개선|5슬롯 용량이 실제 병목이었다는 증거|
|2|K42·K84가 비슷하게 좋아지고 무작위도 같은 정도|주로 분산·일반 용량 효과. RS 특유의 rescue 근거는 약하다|
|3|`MAX_POSITIONS_REACHED`는 크게 주는데 K84의 벤치마크 상대 성과는 회복 안 됨|점유는 있었지만 K84 저성과를 설명하지 못한다. 가설 약화·기각|
|4|슬롯을 늘려도 `MAX_POSITIONS_REACHED`가 잘 안 줄거나 다른 한도가 즉시 대신 걸림|병목이 슬롯 수가 아니라 더 넓은 처리량 제약에 있다|
|5|raw 수익은 좋아지는데 노출 일치 격차는 그대로|노출·분산 효과이지 신호 변환 개선이 아니다|

    python3 selftest/slot_capacity_run.py plan
    python3 selftest/slot_capacity_run.py run jt-k84-s10 LAST_CLOSE
    python3 selftest/slot_capacity_run.py report
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
from backtest.features import TRADING_DAYS_PER_YEAR  # noqa: E402
from backtest.loop import BacktestConfig, run_backtest  # noqa: E402
from backtest.metrics import compute_metrics  # noqa: E402
from backtest.modes import LAST_CLOSE_EXIT, UNRESOLVED_EXIT_PRICES  # noqa: E402
from backtest.report import judgment_json, judgment_payload  # noqa: E402
from backtest.validation import evaluate_gate  # noqa: E402
from core import CORES  # noqa: E402
from core.jt_slots import RISK_BUDGET, SLOT_HOLDS, SLOT_LADDER  # noqa: E402
from selftest.k_lifetime_run import reference_closes, regime_detail  # noqa: E402
from selftest.momentum_run import research_window  # noqa: E402
from selftest.real_run import (  # noqa: E402
    INDEX_NAMES,
    RUNS_DIR,
    SOURCE_VERSION,
)

EXPERIMENT = "jt-slot-capacity"
RANDOM_SEEDS = tuple(range(10))
BASE_SLOTS = 5

# **포트폴리오 층에서 걸린 사유.** 유니버스·랭킹 단계에서 걸린 것(`BELOW_TOP_N` 등)과
# 나누는 이유는, 슬롯을 늘렸을 때 무엇이 대신 병목이 되는지가 이쪽에서만 보이기 때문이다.
# 이름은 전부 엔진이 쓰는 문자열 그대로다. 새로 만들지 않는다.
PORTFOLIO_STAGE_REASONS = (
    "MAX_POSITIONS_REACHED",
    "ALREADY_HELD",
    "DAILY_ENTRY_CAP",
    "DAILY_LOSS_LIMIT",
    "TOTAL_PLANNED_RISK_EXCEEDED",
    "SECTOR_WEIGHT_EXCEEDED",
    "SECTOR_UNKNOWN",
    "CORRELATION",
    "MIN_QTY_RISK_EXCEEDED",
    "MIN_QTY_REDUCE_IMPOSSIBLE",
    "MIN_QTY_EXCEPTION",
    "GAP_LIMIT",
    "NO_FILL",
    "NO_EXECUTION_BAR",
    "CORPORATE_ACTION",
)


def core_name(hold: int, slots: int, *, random: bool) -> str:
    """격자 한 칸의 코어 이름. **S5는 PR #10 코어를 그대로 쓴다.**"""
    prefix = "jt-random" if random else "jt-k"
    if slots == BASE_SLOTS:
        return f"jt-random-k{hold}" if random else f"jt-k{hold}"
    return f"{'jt-random-k' if random else 'jt-k'}{hold}-s{slots}"


def run_id_for(core: str, scenario: str, seed: int) -> str:
    suffix = f"-seed{seed:02d}" if CORES[core].entry_mode == "RANDOM" else ""
    return f"{core}{suffix}-{scenario.lower()}"


def out_dir() -> Path:
    path = RUNS_DIR / EXPERIMENT
    path.mkdir(parents=True, exist_ok=True)
    return path


def planned() -> list[tuple[str, str, int]]:
    """`(코어, 시나리오, 시드)` 전부. RS 12개 + 무작위 60개.

    **S5 칸도 다시 돌린다.** 규칙은 PR #10과 같지만 그 사이 엔진이 한 필드를 더 기록하게
    바뀌었다. 같은 값이 나오는지 확인하는 것이 재현 점검이고, 복사해 오면 그 확인이 없다.
    """
    jobs: list[tuple[str, str, int]] = []
    for hold in SLOT_HOLDS:
        for slots in SLOT_LADDER:
            for scenario in UNRESOLVED_EXIT_PRICES:
                jobs.append((core_name(hold, slots, random=False), scenario, 0))
    for hold in SLOT_HOLDS:
        for slots in SLOT_LADDER:
            for seed in RANDOM_SEEDS:
                jobs.append(
                    (core_name(hold, slots, random=True), LAST_CLOSE_EXIT, seed)
                )
    return jobs


def capacity_diagnostics(result, policy) -> dict:
    """슬롯 병목을 직접 재는 값들. **수익표만으로는 가설을 검증할 수 없다.**"""
    curve = result.equity_curve
    slots = policy.limits.max_positions
    budget = policy.limits.max_total_planned_risk
    open_counts = [point.open_positions for point in curve]
    risk_used = [point.open_risk_fraction / budget for point in curve if budget > 0]
    full = sum(1 for count in open_counts if count >= slots)
    sessions = len(curve)

    skips = result.skip_counts
    portfolio_stage = {
        reason: skips[reason] for reason in PORTFOLIO_STAGE_REASONS if reason in skips
    }
    # **후보 기회는 파생값이다.** 후보가 된 뒤 진입으로 끝났거나 포트폴리오 층 사유로
    # 걸린 건수의 합으로 본다. 엔진이 따로 세지 않아서 여기서 만든다.
    entries = len(result.trades) + len(result.open_positions)
    opportunities = entries + sum(portfolio_stage.values())

    def quantile(values: list[float], fraction: float) -> float | None:
        if not values:
            return None
        ordered = sorted(values)
        index = min(len(ordered) - 1, int(fraction * (len(ordered) - 1)))
        return ordered[index]

    return {
        "max_positions": slots,
        "risk_per_trade": policy.profile.risk_per_trade,
        "max_total_planned_risk": budget,
        "risk_budget_product": slots * policy.profile.risk_per_trade,
        "sessions": sessions,
        "entries": entries,
        "entries_per_year": entries / (sessions / TRADING_DAYS_PER_YEAR)
        if sessions
        else None,
        "avg_open_positions": statistics.fmean(open_counts) if open_counts else None,
        "slot_utilization": (statistics.fmean(open_counts) / slots)
        if open_counts and slots
        else None,
        "sessions_at_full_capacity": full,
        "fraction_sessions_at_full_capacity": full / sessions if sessions else None,
        "max_positions_reached": skips.get("MAX_POSITIONS_REACHED", 0),
        "max_positions_reached_per_opportunity": (
            skips.get("MAX_POSITIONS_REACHED", 0) / opportunities
            if opportunities
            else None
        ),
        "candidate_opportunities": opportunities,
        "avg_planned_risk_utilization": statistics.fmean(risk_used)
        if risk_used
        else None,
        "p95_planned_risk_utilization": quantile(risk_used, 0.95),
        "peak_planned_risk_utilization": max(risk_used) if risk_used else None,
        "portfolio_stage_skips": portfolio_stage,
    }


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
    payload["max_hold_sessions"] = core.policy.parameters.max_hold_sessions
    payload["slots"] = core.policy.limits.max_positions
    payload["capacity"] = capacity_diagnostics(result, core.policy)
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

    cap = payload["capacity"]
    matched = payload["benchmark"][0]
    print(f"  거래 {metrics.trade_count:,} · 기대값 {metrics.expectancy_r}"
          f" · 총수익 {metrics.total_return:.2%}")
    print(f"  노출 {metrics.avg_exposure:.2%} · 격차"
          f" {metrics.total_return - matched['total_return']:+.2%}")
    print(f"  슬롯 {cap['max_positions']} · 평균 점유 {cap['avg_open_positions']:.2f}"
          f" ({cap['slot_utilization']:.1%}) · 만석 {cap['fraction_sessions_at_full_capacity']:.1%}"
          f" · MAX_POSITIONS_REACHED {cap['max_positions_reached']:,}")
    print(f"  위험 사용률 평균 {cap['avg_planned_risk_utilization']:.1%}"
          f" · p95 {cap['p95_planned_risk_utilization']:.1%}")
    print(f"  → {path.name}")
    return 0


def load_runs() -> dict[str, dict]:
    return {
        path.stem: json.loads(path.read_text(encoding="utf-8"))
        for path in sorted(out_dir().glob("*.json"))
    }


def _pct(value: float | None, digits: int = 1) -> str:
    return "—" if value is None else f"{value * 100:+.{digits}f}%"


def _share(value: float | None, digits: int = 1) -> str:
    return "—" if value is None else f"{value * 100:.{digits}f}%"


def _num(value: float | None, digits: int = 3) -> str:
    return "—" if value is None else f"{value:.{digits}f}"


def gap_of(run: dict) -> float | None:
    if not run.get("benchmark"):
        return None
    return run["metrics"]["total_return"] - run["benchmark"][0]["total_return"]


def total_return_of(run: dict) -> float | None:
    return run["metrics"]["total_return"]


METRICS = (("총수익", total_return_of), ("노출 일치 격차", gap_of))


def read_as(gain42: float, gain84: float, rescue: float) -> str:
    """`rescue_interaction` 한 줄을 어떻게 읽어야 하는가.

    **차이값은 두 팔이 모두 나빠질 때도 양수가 된다.** K84가 좋아져서가 아니라 K42가 더
    크게 나빠지기만 해도 그렇다. 부호만 보고 "긴 K가 구제됐다"로 읽는 것을 막으려고
    두 팔의 부호를 함께 판정해 표에 찍는다.
    """
    if rescue <= 0:
        return "악화"
    if gain84 > 0:
        return "회복"
    return "덜 나빠짐"


def rs_run(runs: dict, hold: int, slots: int, scenario: str = LAST_CLOSE_EXIT):
    return runs.get(run_id_for(core_name(hold, slots, random=False), scenario, 0))


def random_runs(runs: dict, hold: int, slots: int) -> dict[int, dict]:
    name = core_name(hold, slots, random=True)
    found = {}
    for seed in RANDOM_SEEDS:
        run = runs.get(run_id_for(name, LAST_CLOSE_EXIT, seed))
        if run:
            found[seed] = run
    return found


def stage_report(_connection) -> int:
    runs = load_runs()
    missing = [run_id_for(*job) for job in planned() if run_id_for(*job) not in runs]
    lines = [
        "# 슬롯 용량 실험 — 5슬롯이 긴 K의 병목이었는가",
        "",
        "**물은 것:** 총 계획 위험(1.25%)을 고정한 채 포트폴리오 용량을 더 많은 작은"
        " 포지션으로 나누면, PR #10에서 본 긴 RS 신호 수명의 포트폴리오 변환 실패가"
        " 완화되는가. 그리고 그 회복이 단순 분산이 아니라 RS 랭킹에서 오는가.",
        "",
        f"처치는 `max_positions × risk_per_trade = {RISK_BUDGET}` 하나다."
        " 판정 기준 A~G와 해석 규칙 1~5는 러너 docstring에 미리 적어뒀다."
        " **\"몇 슬롯이 최적인가\"는 이번 질문이 아니다.**",
        "",
    ]
    if missing:
        lines += [f"**아직 없는 실행 {len(missing)}개:** {', '.join(missing[:8])}"
                  + (" …" if len(missing) > 8 else ""), ""]

    lines += ["## 1. RS 주요 결과 (LAST_CLOSE)", "",
              "|K|슬롯|거래|승률|기대값R|PF|총수익|CAGR|MDD|Sharpe|Sortino|노출|회전|비용|평균보유|**격차**|",
              "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|"]
    for hold in SLOT_HOLDS:
        for slots in SLOT_LADDER:
            run = rs_run(runs, hold, slots)
            if not run:
                continue
            m = run["metrics"]
            lines.append(
                f"|{hold}|**{slots}**|{m['trade_count']:,}|{_share(m['win_rate'])}"
                f"|{_num(m['expectancy_r'])}|{_num(m['profit_factor'], 2)}"
                f"|{_pct(m['total_return'])}|{_pct(m['cagr'], 2)}"
                f"|{_share(m['max_drawdown'])}|{_num(m['sharpe'], 2)}"
                f"|{_num(m['sortino'], 2)}|{_share(m['avg_exposure'])}"
                f"|{_num(m['turnover'], 2)}|${m['fees_paid']:,.0f}"
                f"|{_num(m['avg_hold_sessions'], 1)}|**{_pct(gap_of(run))}**|"
            )

    lines += ["", "## 2. 용량 진단 — 병목이 실제로 풀렸는가", "",
              "**수익표만으로는 가설을 검증할 수 없다.** 슬롯이 병목이었다면 슬롯을"
              " 늘렸을 때 만석 세션과 `MAX_POSITIONS_REACHED`가 실제로 줄어야 한다"
              "(기준 E).", "",
              "|K|슬롯|거래당 위험|평균 점유|점유율|만석 세션|MAX_POSITIONS_REACHED|기회당|위험 사용률 평균|p95|최대|",
              "|---|---|---|---|---|---|---|---|---|---|---|"]
    for hold in SLOT_HOLDS:
        for slots in SLOT_LADDER:
            run = rs_run(runs, hold, slots)
            if not run:
                continue
            c = run["capacity"]
            lines.append(
                f"|{hold}|**{slots}**|{c['risk_per_trade'] * 100:.4f}%"
                f"|{_num(c['avg_open_positions'], 2)}|{_share(c['slot_utilization'])}"
                f"|{_share(c['fraction_sessions_at_full_capacity'])}"
                f"|{c['max_positions_reached']:,}"
                f"|{_share(c['max_positions_reached_per_opportunity'])}"
                f"|{_share(c['avg_planned_risk_utilization'])}"
                f"|{_share(c['p95_planned_risk_utilization'])}"
                f"|{_share(c['peak_planned_risk_utilization'])}|"
            )

    lines += ["", "### 포트폴리오 층에서 걸린 사유 (기준 F — 무엇이 대신 병목이 되는가)", "",
              "유니버스·랭킹 단계 사유(`BELOW_TOP_N` 등)는 뺐다. 이름은 엔진이 쓰는"
              " 문자열 그대로다.", ""]
    seen_reasons: list[str] = []
    for hold in SLOT_HOLDS:
        for slots in SLOT_LADDER:
            run = rs_run(runs, hold, slots)
            if run:
                for reason in run["capacity"]["portfolio_stage_skips"]:
                    if reason not in seen_reasons:
                        seen_reasons.append(reason)
    lines += ["|K|슬롯|" + "|".join(seen_reasons) + "|",
              "|---|---|" + "---|" * len(seen_reasons)]
    for hold in SLOT_HOLDS:
        for slots in SLOT_LADDER:
            run = rs_run(runs, hold, slots)
            if not run:
                continue
            skips = run["capacity"]["portfolio_stage_skips"]
            cells = [f"{skips.get(reason, 0):,}" for reason in seen_reasons]
            lines.append(f"|{hold}|**{slots}**|" + "|".join(cells) + "|")

    lines += ["", "## 3. Rescue interaction — 긴 K가 특별히 더 도움받는가", "",
              "`slot_gain_K(S) = M(K,S) − M(K,S5)`이고"
              " `rescue_interaction(S) = slot_gain_K84(S) − slot_gain_K42(S)`다"
              "(기준 C).", "",
              "**차이값 하나만 보면 안 된다.** 이 지표는 두 팔이 **모두 나빠질 때도**"
              " 양수가 된다 — K84가 회복해서가 아니라 K42가 더 크게 나빠지기만 해도"
              " 그렇다. 그래서 부호만 보고 \"긴 K가 구제됐다\"로 읽으면 틀린다."
              " 아래 `읽는 법` 열이 두 팔의 부호를 같이 찍는다.", "",
              "|읽는 법|뜻|",
              "|---|---|",
              "|**회복**|K84 gain > 0이고 rescue > 0. 긴 K가 실제로 좋아졌다|",
              "|**덜 나빠짐**|두 gain이 모두 ≤ 0인데 rescue > 0. 구제가 아니다|",
              "|악화|rescue ≤ 0. 긴 K가 슬롯에서 덜 도움받았다|",
              ""]
    for label, getter in METRICS:
        lines += [f"**{label}**", "",
                  "|슬롯|K42 값|K42 gain|K84 값|K84 gain|**rescue**|**읽는 법**|무작위 rescue 중앙|무작위 분포에서|",
                  "|---|---|---|---|---|---|---|---|---|"]
        base42, base84 = rs_run(runs, 42, BASE_SLOTS), rs_run(runs, 84, BASE_SLOTS)
        for slots in SLOT_LADDER:
            if slots == BASE_SLOTS or not base42 or not base84:
                continue
            cell42, cell84 = rs_run(runs, 42, slots), rs_run(runs, 84, slots)
            if not cell42 or not cell84:
                continue
            gain42 = getter(cell42) - getter(base42)
            gain84 = getter(cell84) - getter(base84)
            rescue = gain84 - gain42
            # 같은 시드로 네 칸이 다 있을 때만 무작위 rescue를 만든다.
            control = []
            for seed in RANDOM_SEEDS:
                cells = [
                    random_runs(runs, hold, size).get(seed)
                    for hold in (42, 84)
                    for size in (BASE_SLOTS, slots)
                ]
                if all(cells):
                    r42b, r42s, r84b, r84s = cells
                    control.append(
                        (getter(r84s) - getter(r84b)) - (getter(r42s) - getter(r42b))
                    )
            stats = RandomStats.of(control)
            beaten = f"{stats.beaten_by(rescue)}/{stats.count}" if stats else "—"
            median = _pct(stats.median) if stats else "—"
            lines.append(
                f"|**{slots}**|{_pct(getter(cell42))}|{_pct(gain42)}"
                f"|{_pct(getter(cell84))}|{_pct(gain84)}|**{_pct(rescue)}**"
                f"|**{read_as(gain42, gain84, rescue)}**|{median}|{beaten}|"
            )
        lines.append("")

    lines += ["## 4. 같은 K·S의 무작위 대조군 (LAST_CLOSE, 시드 10)", "",
              "|K|슬롯|무작위 최소|중앙|최대|평균|표준편차|**RS**|이김|",
              "|---|---|---|---|---|---|---|---|---|"]
    for hold in SLOT_HOLDS:
        for slots in SLOT_LADDER:
            rs, control = rs_run(runs, hold, slots), random_runs(runs, hold, slots)
            stats = RandomStats.of(
                total_return_of(run) for run in control.values()
            )
            if not rs or stats is None:
                continue
            actual = total_return_of(rs)
            lines.append(
                f"|{hold}|**{slots}**|{_pct(stats.minimum)}|{_pct(stats.median)}"
                f"|{_pct(stats.maximum)}|{_pct(stats.mean)}"
                f"|{'—' if stats.stdev is None else f'{stats.stdev * 100:.1f}%'}"
                f"|**{_pct(actual)}**|{stats.beaten_by(actual)}/{stats.count}|"
            )

    lines += ["", "## 5. 레짐별 (진입 시점 라벨 · 게이트는 넣지 않았다)", "",
              "**레짐별 격차를 전체 격차의 귀속으로 읽지 않는다.** 각 값은 그 상태의"
              " 세션만 골라 따로 복리한 `전략 − 노출일치`라서 레짐 간에 더해지지 않는다."
              " 여기서 읽을 수 있는 것은 \"어디서 가장 크게 벌어졌나\"이지 \"손실의 몇 %가"
              " 어디서 났나\"가 아니다.", ""]
    for hold in SLOT_HOLDS:
        lines += [f"**K={hold} · 노출 일치 대비 격차**", "",
                  "|상태|" + "|".join(f"S{s}" for s in SLOT_LADDER) + "|",
                  "|---|" + "---|" * len(SLOT_LADDER)]
        states: list[str] = []
        for slots in SLOT_LADDER:
            run = rs_run(runs, hold, slots)
            for row in (run or {}).get("regime_detail", []):
                if row["regime"] not in states:
                    states.append(row["regime"])
        for state in sorted(states):
            cells = []
            for slots in SLOT_LADDER:
                run = rs_run(runs, hold, slots)
                row = next(
                    (r for r in (run or {}).get("regime_detail", [])
                     if r["regime"] == state),
                    None,
                )
                cells.append(_pct(row["gap"]) if row else "—")
            lines.append(f"|{state}|" + "|".join(cells) + "|")
        lines.append("")

    lines += ["## 6. 연도별 총수익", "",
              "|연도|" + "|".join(f"K{h} S{s}" for h in SLOT_HOLDS for s in SLOT_LADDER)
              + "|",
              "|---|" + "---|" * (len(SLOT_HOLDS) * len(SLOT_LADDER))]
    years: dict[str, dict[tuple[int, int], dict]] = {}
    for hold in SLOT_HOLDS:
        for slots in SLOT_LADDER:
            run = rs_run(runs, hold, slots)
            for row in (run or {}).get("period_performance", []):
                years.setdefault(row["label"], {})[(hold, slots)] = row
    for year in sorted(years):
        cells = [
            _pct(years[year].get((h, s), {}).get("total_return"))
            for h in SLOT_HOLDS
            for s in SLOT_LADDER
        ]
        lines.append(f"|{year}|" + "|".join(cells) + "|")

    lines += ["", "## 7. 폐지 가정 민감도 (LAST_CLOSE vs ZERO)", "",
              "**총수익 결론과 기대값 결론을 나눠 적는다.** PR #10에서 기대값이 ZERO에"
              " 민감했다.", "",
              "|K|슬롯|LAST_CLOSE 총수익|ZERO 총수익|차이|LAST_CLOSE 기대값|ZERO 기대값|",
              "|---|---|---|---|---|---|---|"]
    for hold in SLOT_HOLDS:
        for slots in SLOT_LADDER:
            last, zero = rs_run(runs, hold, slots), rs_run(runs, hold, slots, "ZERO")
            if not last or not zero:
                continue
            lines.append(
                f"|{hold}|**{slots}**|{_pct(last['metrics']['total_return'])}"
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
        for core_key, scenario, seed in planned():
            print(f"{core_key} {scenario} {seed}")
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
