"""신호가 깨질 때 나가는 것이 fixed K42보다 나은가. **로드맵 Phase 3 · PR #18.**

사전등록 전문은 `runs/signal-invalidation-exit/README.md`이고 **결과 전에** 커밋했다.

## 묻는 것

    이미 살아남은 J126 + SMA200 신규진입 gate + K42 + S5 구조에서, 보유 중
    entry hypothesis가 깨졌을 때 즉시 나가는 것이 fixed K42보다 after-cost
    portfolio economics를 개선하는가?

**청산은 진입 가설의 반증이어야 한다.** PR #16이 승격한 가설이 "시장이 SMA200 위이고 이
종목은 RS126 상위다"이므로 자연스러운 반증은 시장이 SMA200 아래로 내려가는 것이다.
**새 숫자가 하나도 없다.**

## 처치는 `exit_mode` 하나다

`MARKET_TREND_BREAK` 예약은 **loop가 그날 종가에** 찍고 실제 청산은 다음 세션 시초의 기존
pending-exit 경로가 한다. 오늘 시장 정보를 포지션의 장중 처리보다 앞으로 끌어오지 않는다.

**전일 pending entry는 사후 취소하지 않는다** — 취소하면 exit 처치가 entry execution까지
바꿔 처치가 둘이 된다.

## 판정과 진단을 갈라 놓는다

`ΔS = ΔB + ΔG` 분해와 최종 경제 게이트는 **PR #16의 헬퍼를 그대로 부른다** — 복제하면
두 실험의 정의가 갈린다.

**`MARKET_TREND_BREAK`를 "정의상 실제 단축"으로 읽지 않는다.** 예약된 신호는 넷으로
갈린다 — 정상 체결 · untradeable 지연 체결 · `DELISTED_EXIT` 선점 · `UNRESOLVED_EXIT`
선점. 뒤 둘은 폐지·미해결 처리가 청산가와 시점을 정한 것이라 fill로도 단축으로도 세지
않는다.

    python3 selftest/signal_invalidation_run.py plan
    python3 selftest/signal_invalidation_run.py run jt-j126-k42-sma200 LAST_CLOSE
    python3 selftest/signal_invalidation_run.py report
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
from backtest.holdout import holdout_metadata  # noqa: E402
from backtest.loop import (  # noqa: E402
    BacktestConfig,
    MarketBreakEvent,
    Trade,
    run_backtest,
)
from backtest.metrics import compute_metrics  # noqa: E402
from backtest.modes import LAST_CLOSE_EXIT, UNRESOLVED_EXIT_PRICES  # noqa: E402
from backtest.positions import MARKET_TREND_BREAK  # noqa: E402
from core import CORES  # noqa: E402
from selftest.k_lifetime_run import reference_closes, regime_detail  # noqa: E402
# **PR #16의 분해·게이트를 그대로 쓴다.** 복제하면 두 실험의 정의가 갈린다.
from selftest.market_gate_run import (  # noqa: E402
    BUY_AND_HOLD,
    MATCHED,
    decompose,
    final_gate,
)
from selftest.momentum_run import research_window  # noqa: E402
from selftest.real_run import INDEX_NAMES, RUNS_DIR, SOURCE_VERSION  # noqa: E402
from selftest.slot_capacity_run import capacity_diagnostics  # noqa: E402

EXPERIMENT = "signal-invalidation-exit"

CONTROL = "jt-j126-k42-sma200"
CHALLENGER = "jt-j126-k42-sma200-exit"
ARMS = (CONTROL, CHALLENGER)
LABELS = {CONTROL: "fixed K42", CHALLENGER: "신호 반증 청산"}
SLUGS = {CONTROL: "control", CHALLENGER: "exit"}

# 폐지·미해결 청산. **market break 예약을 선점한다**(loop 1단계가 먼저다).
DELISTED_EXIT = "DELISTED_EXIT"
UNRESOLVED_EXIT = "UNRESOLVED_EXIT"
TERMINAL_REASONS = (DELISTED_EXIT, UNRESOLVED_EXIT)

# §9.2 사전등록 component label. 결과를 보고 바꾸지 않는다.
LABEL_PROMOTE_AND_GATE = "PROMOTE_EXIT_AND_GATE_PASS"
LABEL_PROMOTE = "PROMOTE_EXIT"
LABEL_RISK_ONLY = "RISK_ONLY"
LABEL_FAIL = "FAIL"
COMPONENT_LABELS = (
    LABEL_PROMOTE_AND_GATE,
    LABEL_PROMOTE,
    LABEL_RISK_ONLY,
    LABEL_FAIL,
)
# alpha stack에 올라가는 label은 둘이다.
PROMOTES = frozenset({LABEL_PROMOTE_AND_GATE, LABEL_PROMOTE})

# B가 "control이 이미 통과하던 것을 깨지 않았는가"를 볼 때 쓰는 항목.
CONTROL_KEPT = ("gap", "expectancy_r", "profit_factor", "max_drawdown")


def run_id_for(core: str, scenario: str) -> str:
    return f"{SLUGS[core]}-{scenario.lower()}"


def out_dir() -> Path:
    path = RUNS_DIR / EXPERIMENT
    path.mkdir(parents=True, exist_ok=True)
    return path


def planned() -> list[tuple[str, str]]:
    return [(core, scenario) for core in ARMS for scenario in UNRESOLVED_EXIT_PRICES]


# ---------------------------------------------------------------- 실행


def stage_run(connection, core_key: str, scenario: str) -> int:
    core = CORES[core_key]
    start, end, holdout_start = research_window(connection)
    config = BacktestConfig(
        source_version=SOURCE_VERSION,
        start=start,
        end=end,
        index_names=INDEX_NAMES,
        **core.run_kwargs(),
        unresolved_exit_price=scenario,
    )
    run_id = run_id_for(core_key, scenario)
    print(f"# {run_id} · {LABELS[core_key]}")
    print(f"  {core.summary}")
    print(f"  구간 {start} ~ {end} (홀드아웃 {holdout_start}부터는 보지 않는다)")

    # **신호와 체결을 갈라 센다.** 예약된 market break는 폐지·미해결에 선점될 수 있다.
    events: list[MarketBreakEvent] = []
    result = run_backtest(connection, config, break_observer=events.append)
    metrics = compute_metrics(result)
    closes = reference_closes(connection)
    max_hold = core.policy.parameters.max_hold_sessions

    payload = {
        "run_id": run_id,
        "experiment": EXPERIMENT,
        "core": core_key,
        "arm": LABELS[core_key],
        "scenario": scenario,
        "exit_mode": core.exit_mode,
        "regime_mode": core.regime_mode,
        "policy_signature": core.signature,
        "max_hold_sessions": max_hold,
        "window": [start, end],
        "holdout": holdout_metadata(consumed=False),
        "metrics": {
            key: getattr(metrics, key)
            for key in (
                "trade_count", "expectancy_r", "profit_factor", "win_rate",
                "total_return", "cagr", "max_drawdown", "sharpe", "sortino",
                "calmar", "avg_exposure", "turnover", "fees_paid",
                "avg_hold_sessions",
            )
        },
        "benchmark": [
            {"label": row.label, "total_return": row.total_return}
            for row in benchmark_table(result.equity_curve, closes)
        ],
        "capacity": capacity_diagnostics(result, core.policy),
        "regime_detail": regime_detail(result, closes),
        "skip_counts": result.skip_counts,
        "exit_counts": result.exit_counts,
        "sessions": len(result.equity_curve),
        "mechanism": mechanism(
            events,
            result.trades,
            [point.trade_date for point in result.equity_curve],
            max_hold,
        ),
        "terminal_exits": {
            reason: result.exit_counts.get(reason, 0) for reason in TERMINAL_REASONS
        },
    }
    path = out_dir() / f"{run_id}.json"
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    matched = payload["benchmark"][MATCHED]["total_return"]
    outcome = payload["mechanism"]
    print(f"  거래 {metrics.trade_count:,} · 총수익 {metrics.total_return:.2%}"
          f" · 기대값 {metrics.expectancy_r:.3f} · Sharpe {metrics.sharpe:.2f}"
          f" · MDD {metrics.max_drawdown:.1%}")
    print(f"  노출 {metrics.avg_exposure:.2%} · 격차 {metrics.total_return - matched:+.2%}")
    print(f"  {MARKET_TREND_BREAK} 표시 {outcome['market_break_signals_scheduled']:,}"
          f" · 체결 {outcome['market_break_fills']:,}"
          f" (단축 {outcome['actual_k42_shortening']:,}"
          f" · 지연 {outcome['untradeable_delayed_fills']:,}"
          f" · 선점 {outcome['market_break_signals_terminally_preempted']:,})")
    print(f"  → {path.name}")
    return 0


def mechanism(
    events: list[MarketBreakEvent],
    trades: tuple[Trade, ...],
    sessions: list[str],
    max_hold: int,
) -> dict:
    """표시된 신호 하나하나의 **최종** outcome을 넷으로 가른다(사전등록 §8).

    **`MARKET_TREND_BREAK` 건수를 단축 건수로 읽지 않는다.** 표시는 그 순간 `MAX_HOLD`가
    아직 예약되지 않았다는 것만 뜻한다.

    - 표시→체결이 **한 세션**이면 정상 체결이다. 예약된 청산은 다음 세션 시초에 나가므로
      그보다 늦었다는 것은 **그 세션에 바가 없어 `EXIT_PENDING_UNTRADEABLE`를 거쳤다**는
      뜻이다. 그래서 지연 판정에 별도 표식이 필요 없다.
    - `DELISTED_EXIT`·`UNRESOLVED_EXIT`로 끝난 것은 **선점**이다. 청산가와 시점을 정한
      것이 market break가 아니므로 fill로도 `actual K42 shortening`으로도 세지 않는다.
    - `actual K42 shortening`은 **체결 시점** `sessions_held < max_hold`인 것만이다.
      거래정지가 끼면 표시가 일렀어도 체결이 원래 deadline 뒤로 밀린다.
    """
    index = {trade_date: position for position, trade_date in enumerate(sessions)}
    closed = {(trade.symbol, trade.entry_date): trade for trade in trades}

    outcomes = {
        "normal_fills": 0,
        "untradeable_delayed_fills": 0,
        "delisted_preempted": 0,
        "unresolved_preempted": 0,
        # 구간이 끝날 때까지 안 닫힌 포지션. 항등식이 닫히려면 이 칸이 있어야 한다.
        "still_open_at_window_end": 0,
    }
    shortening: list[int] = []
    remaining: list[int] = []
    delays: list[int] = []

    for event in events:
        remaining.append(max_hold - event.sessions_held)
        trade = closed.get((event.symbol, event.entry_date))
        if trade is None:
            outcomes["still_open_at_window_end"] += 1
            continue
        if trade.exit_reason == DELISTED_EXIT:
            outcomes["delisted_preempted"] += 1
            continue
        if trade.exit_reason == UNRESOLVED_EXIT:
            outcomes["unresolved_preempted"] += 1
            continue
        if trade.exit_reason != MARKET_TREND_BREAK:
            # 사전등록이 넷만 열어 뒀다. 다섯째가 나오면 진단이 조용히 틀리는 대신 멈춘다.
            raise AssertionError(
                f"예약된 market break가 {trade.exit_reason}으로 끝났습니다:"
                f" {event.symbol} {event.entry_date}"
            )
        delay = index[trade.exit_date] - index[event.signal_date]
        delays.append(delay)
        if delay <= 1:
            outcomes["normal_fills"] += 1
        else:
            outcomes["untradeable_delayed_fills"] += 1
        if trade.sessions_held < max_hold:
            shortening.append(max_hold - trade.sessions_held)

    fills = outcomes["normal_fills"] + outcomes["untradeable_delayed_fills"]
    preempted = outcomes["delisted_preempted"] + outcomes["unresolved_preempted"]
    return {
        "market_break_signals_scheduled": len(events),
        "market_break_fills": fills,
        "actual_k42_shortening": len(shortening),
        "untradeable_delayed_fills": outcomes["untradeable_delayed_fills"],
        "market_break_signals_terminally_preempted": preempted,
        "outcomes": outcomes,
        # 항등식이 실제로 닫히는지 값으로 남긴다. 사전등록 §8의 마지막 식이다.
        "identity_residual": len(events)
        - (fills + preempted + outcomes["still_open_at_window_end"]),
        "sessions_remaining_at_signal": _describe(remaining),
        "signal_to_fill_delay": _describe(delays),
        "shortening_sessions": _describe(shortening),
    }


def _describe(values: list[int | float]) -> dict:
    if not values:
        return {"count": 0, "mean": None, "median": None, "min": None, "max": None}
    return {
        "count": len(values),
        "mean": statistics.fmean(values),
        "median": statistics.median(values),
        "min": min(values),
        "max": max(values),
    }


# ---------------------------------------------------------------- 판정


def risk_directions(control: dict, gated: dict) -> dict:
    """§9.2 C가 보는 네 항목. 각각 개선됐는가."""
    left, right = control["metrics"], gated["metrics"]

    def better(key: str, lower_is_better: bool = False) -> bool | None:
        a, b = left.get(key), right.get(key)
        if a is None or b is None:
            return None
        return b < a if lower_is_better else b > a

    return {
        "sharpe_up": better("sharpe"),
        "max_drawdown_down": better("max_drawdown", lower_is_better=True),
        "sortino_up": better("sortino"),
        "calmar_up": better("calmar"),
    }


def control_kept(control: dict, challenger: dict) -> dict:
    """control이 이미 통과하던 항목을 challenger가 깨지 않았는가.

    **control이 애초에 통과하지 못한 항목은 깰 것이 없다** — `True`로 둔다.
    """
    left, right = final_gate(control), final_gate(challenger)
    rows = {row["name"]: row["pass"] for row in left["rows"]}
    after = {row["name"]: row["pass"] for row in right["rows"]}
    return {
        name: (True if not rows.get(name) else bool(after.get(name)))
        for name in CONTROL_KEPT
    }


def classify_component(
    delta: dict, gate_pass: bool, sharpe_ok: bool, kept: dict, risk: dict
) -> str:
    """§9.2의 A~D. **결과를 본 뒤 바꾸지 않는다**(테스트가 잠근다).

    **`CURRENT_ECONOMIC_GATE_PASS`는 A의 조건 중 하나일 뿐 단독 승격 사유가 아니다.**
    게이트를 통과했는데 `ΔS`나 `ΔG`가 악화됐으면 그 통과는 control이 이미 하던 일이지
    이 청산이 한 일이 아니다.
    """
    ds, dg = delta.get("delta_S"), delta.get("delta_G")
    if ds is None or dg is None:
        return LABEL_FAIL
    marginal = ds > 0 and dg > 0
    if marginal and gate_pass:
        return LABEL_PROMOTE_AND_GATE
    if marginal and sharpe_ok and all(kept.values()):
        return LABEL_PROMOTE
    if any(value is True for value in risk.values()):
        return LABEL_RISK_ONLY
    return LABEL_FAIL


def treatment(label: str) -> str:
    return {
        LABEL_PROMOTE_AND_GATE: "**signal exit를 유지한다.** 최종 전략 자격과 fixed K42"
        " 대비 marginal 기여가 **함께** 확인됐다.",
        LABEL_PROMOTE: "**signal exit를 유지한다.** 최종 게이트는 아직 미달이지만 fixed"
        " K42 대비 marginal 기여가 확인됐고 control이 통과하던 것을 깨지 않았다.",
        LABEL_RISK_ONLY: "**alpha stack에 넣지 않는다.** marginal 조건을 만족하지 못했다."
        " risk-overlay 후보 메모만 남긴다.",
        LABEL_FAIL: "**fixed K42를 유지한다.**",
    }[label]


# ---------------------------------------------------------------- 보고서


def load_runs() -> dict[str, dict]:
    return {
        path.stem: json.loads(path.read_text(encoding="utf-8"))
        for path in sorted(out_dir().glob("*.json"))
    }


def _pct(value, digits: int = 2) -> str:
    return "—" if value is None else f"{value * 100:+.{digits}f}%"


def _share(value, digits: int = 1) -> str:
    return "—" if value is None else f"{value * 100:.{digits}f}%"


def _num(value, digits: int = 3) -> str:
    return "—" if value is None else f"{value:.{digits}f}"


def _money(value) -> str:
    return "—" if value is None else f"${value:,.0f}"


def _delta(left, right):
    return (right - left) if (left is not None and right is not None) else None


def _mark(value) -> str:
    return "—" if value is None else ("**예**" if value else "아니오")


def stage_report(_connection) -> int:
    runs = load_runs()
    missing = [run_id_for(*job) for job in planned() if run_id_for(*job) not in runs]
    control = runs.get(run_id_for(CONTROL, LAST_CLOSE_EXIT))
    challenger = runs.get(run_id_for(CHALLENGER, LAST_CLOSE_EXIT))

    lines = [
        "# PR #18 — Signal Invalidation Exit",
        "",
        "**물은 것:** 이미 살아남은 `J126 + SMA200 신규진입 gate + K42 + S5` 구조에서, 보유 중"
        " entry hypothesis가 깨졌을 때 즉시 나가는 것이 fixed K42보다 after-cost portfolio"
        " economics를 **개선하는가**.",
        "",
        "**청산은 진입 가설의 반증이다.** PR #16이 승격한 가설이 \"시장이 SMA200 위이고 이"
        " 종목은 RS126 상위다\"이므로 반증은 시장이 SMA200 아래로 내려가는 것이다."
        " **새 숫자가 하나도 없다.**",
        "",
        "**처치는 `exit_mode` 하나다.** 파라미터·한도·프로필·진입 모드·레짐 모드·비용·"
        "슬롯이 전부 같다. 예약은 loop가 그날 **종가**에 찍고 실제 청산은 다음 세션 시초의"
        " 기존 pending-exit 경로가 한다 — **오늘 시장 정보를 포지션의 장중 처리보다 앞으로"
        " 끌어오지 않는다.** 전일 pending entry는 **사후 취소하지 않는다.**",
        "",
        "**개발 표본이다.** 이 구간은 PR #9~#17에서 반복 사용됐고 OOS 검증이 아니다.",
        "",
    ]
    if missing:
        lines += [f"**아직 없는 실행 {len(missing)}개:** {', '.join(missing)}", ""]
    if not control or not challenger:
        return _write(lines + ["**LAST_CLOSE 두 팔이 모두 있어야 판정할 수 있다.**", ""])

    lines += _reproduction(control)
    lines += _decomposition(control, challenger)
    lines += _secondary(control, challenger)
    lines += _mechanism(control, challenger)
    lines += _scenario(runs)
    lines += _regime(control, challenger)
    lines += _verdict(control, challenger)
    return _write(lines)


def _write(lines: list[str]) -> int:
    path = out_dir() / "results.md"
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("\n".join(lines))
    print(f"\n보고서: {RUNS_DIR.name}/{EXPERIMENT}/{path.name}")
    return 0


def _reproduction(control: dict) -> list[str]:
    expected = [
        ("거래", "445", "trade_count", lambda v: f"{v:,}"),
        ("기대값R", "0.343", "expectancy_r", _num),
        ("총수익", "+47.84%", "total_return", _pct),
        ("PF", "1.47", "profit_factor", lambda v: _num(v, 2)),
        ("Sharpe", "0.46", "sharpe", lambda v: _num(v, 2)),
        ("MDD", "12.0%", "max_drawdown", _share),
        ("평균 노출", "16.4%", "avg_exposure", _share),
    ]
    gap = (
        control["metrics"]["total_return"]
        - control["benchmark"][MATCHED]["total_return"]
    )
    lines = ["## 1. control 재현 (PR #16 gated LAST_CLOSE)", "",
             "**drift가 있으면 treatment를 해석하지 않는다.**", "",
             "|항목|기대|이번|", "|---|---|---|"]
    for label, want, key, fmt in expected:
        lines.append(f"|{label}|{want}|**{fmt(control['metrics'][key])}**|")
    lines.append(f"|격차 `G`|+4.99%|**{_pct(gap)}**|")
    holdout = control["holdout"]
    lines += ["",
              f"구간 {control['window'][0]} ~ {control['window'][1]} ·"
              f" `HOLDOUT_CONSUMED = {str(holdout['HOLDOUT_CONSUMED']).lower()}`", ""]
    return lines


def _decomposition(control: dict, challenger: dict) -> list[str]:
    delta = decompose(control, challenger)
    return ["## 2. Primary — ΔS = ΔB + ΔG (LAST_CLOSE)", "",
            "**PR #16의 분해 헬퍼를 그대로 부른다.** 복제하면 두 실험의 정의가 갈린다.", "",
            "|값|fixed K42|신호 반증 청산|**Δ**|", "|---|---|---|---|",
            f"|`S` 비용 후 전략 총수익|{_pct(delta['S_control'])}|{_pct(delta['S_gate'])}"
            f"|**{_pct(delta['delta_S'])}**|",
            f"|`B` 노출 일치 SPY|{_pct(delta['B_control'])}|{_pct(delta['B_gate'])}"
            f"|**{_pct(delta['delta_B'])}**|",
            f"|`G = S − B` 격차|{_pct(delta['G_control'])}|{_pct(delta['G_gate'])}"
            f"|**{_pct(delta['delta_G'])}**|",
            "",
            f"항등식: {_pct(delta['delta_S'])} = {_pct(delta['delta_B'])}"
            f" + {_pct(delta['delta_G'])}"
            f" (잔차 {delta['identity_residual'] * 100:+.10f}%p)",
            "",
            "### `F` / `T` 보조 분해 (새 criterion 아님)", "",
            "**`ΔB`를 타이밍 그 자체로 읽지 않기 위한 것**이고 PR #16에서 쓰던 정의 그대로다.",
            "",
            "|값|fixed K42|신호 반증 청산|Δ|", "|---|---|---|---|",
            f"|`F` 평균 노출 고정|{_pct(delta['F_control'])}|{_pct(delta['F_gate'])}"
            f"|{_pct(delta['delta_F'])}|",
            f"|`T = B − F` 타이밍|{_pct(delta['T_control'])}|{_pct(delta['T_gate'])}"
            f"|{_pct(delta['delta_T'])}|",
            ""]


def _secondary(control: dict, challenger: dict) -> list[str]:
    left, right = control["metrics"], challenger["metrics"]
    lines = ["## 3. 사전등록 secondary", "", "|지표|fixed K42|신호 반증 청산|Δ|",
             "|---|---|---|---|"]
    for label, key, fmt in (
        ("총수익", "total_return", _pct),
        ("CAGR", "cagr", lambda v: _pct(v, 2)),
        ("Sharpe", "sharpe", lambda v: _num(v, 2)),
        ("Sortino", "sortino", lambda v: _num(v, 2)),
        ("Calmar", "calmar", lambda v: _num(v, 2)),
        ("MDD", "max_drawdown", _share),
        ("기대값R", "expectancy_r", _num),
        ("PF", "profit_factor", lambda v: _num(v, 2)),
        ("승률", "win_rate", _share),
        ("평균 노출", "avg_exposure", _share),
        ("회전", "turnover", lambda v: _num(v, 2)),
        ("평균 보유", "avg_hold_sessions", lambda v: _num(v, 1)),
    ):
        lines.append(
            f"|{label}|{fmt(left[key])}|{fmt(right[key])}"
            f"|**{fmt(_delta(left[key], right[key]))}**|"
        )
    lines.append(
        f"|거래 수|{left['trade_count']:,}|{right['trade_count']:,}"
        f"|**{right['trade_count'] - left['trade_count']:+,}**|"
    )
    lines.append(
        f"|진입 수|{control['capacity']['entries']:,}"
        f"|{challenger['capacity']['entries']:,}"
        f"|**{challenger['capacity']['entries'] - control['capacity']['entries']:+,}**|"
    )
    lines.append(
        f"|비용|{_money(left['fees_paid'])}|{_money(right['fees_paid'])}"
        f"|**{_money(_delta(left['fees_paid'], right['fees_paid']))}**|"
    )
    lines += ["", "### 100% SPY 매수보유 (opportunity-cost reference)", "",
              "**promotion criterion으로 쓰지 않는다.**", "",
              "|기준|총수익|", "|---|---|",
              f"|100% SPY 매수보유|{_pct(control['benchmark'][BUY_AND_HOLD]['total_return'])}|",
              ""]
    return lines


def _mechanism(control: dict, challenger: dict) -> list[str]:
    mechanism = challenger["mechanism"]
    outcomes = mechanism["outcomes"]
    max_hold = challenger["max_hold_sessions"]
    terminal = challenger["terminal_exits"]
    control_terminal = control["terminal_exits"]

    lines = ["## 4. Mechanism — 신호와 체결을 갈라 센다", "",
             "**`MARKET_TREND_BREAK`를 \"정의상 실제 단축\"으로 읽지 않는다.** 예약은 그"
             " 순간 `MAX_HOLD`가 없었다는 것만 뜻하고, 거래정지·미체결·폐지로 체결이 원래"
             f" K{max_hold} deadline 뒤로 밀릴 수 있다.", "",
             "|지표|값|", "|---|---|",
             f"|`market_break_signals_scheduled`|**{mechanism['market_break_signals_scheduled']:,}**|",
             f"|`MARKET_TREND_BREAK` fills|**{mechanism['market_break_fills']:,}**|",
             f"|**`actual K{max_hold} shortening`** (체결 시 `sessions_held < {max_hold}`)"
             f"|**{mechanism['actual_k42_shortening']:,}**|",
             f"|`market_break_signals_terminally_preempted`"
             f"|{mechanism['market_break_signals_terminally_preempted']:,}|",
             ""]

    lines += ["### 예약된 신호의 최종 outcome — 넷", "",
              "**3·4는 fill로도 `actual K42 shortening`으로도 세지 않는다.**", "",
              "|outcome|건수|", "|---|---|",
              f"|**1** 정상 `MARKET_TREND_BREAK` 체결|{outcomes['normal_fills']:,}|",
              f"|**2** untradeable 지연 체결|{outcomes['untradeable_delayed_fills']:,}|",
              f"|**3** `DELISTED_EXIT` 선점|{outcomes['delisted_preempted']:,}|",
              f"|**4** `UNRESOLVED_EXIT` 선점|{outcomes['unresolved_preempted']:,}|",
              f"|(구간 끝까지 미청산)|{outcomes['still_open_at_window_end']:,}|",
              "",
              f"항등식 잔차 **{mechanism['identity_residual']}**"
              " (`scheduled = 정상 + 지연 + DELISTED + UNRESOLVED + 미청산`)", ""]

    for label, key, unit in (
        (f"표시 시점 K{max_hold}까지 남은 세션", "sessions_remaining_at_signal",
         f"`{max_hold} − sessions_held`"),
        ("표시→체결 지연 세션", "signal_to_fill_delay", "체결 세션 − 표시 세션"),
        (f"단축 세션", "shortening_sessions", f"`{max_hold} − sessions_held`(체결 시)"),
    ):
        row = mechanism[key]
        lines += [f"**{label}** ({unit})", "", "|값|결과|", "|---|---|",
                  f"|건수|{row['count']:,}|",
                  f"|평균 / 중앙|{_num(row['mean'], 1)} / {_num(row['median'], 1)}|",
                  f"|최소 / 최대|{row['min']} / {row['max']}|", ""]

    lines += ["### 폐지·미해결 선점", "",
              "**loop 1단계에서 폐지 판정이 `run_session`보다 먼저**이고 `_terminal_fill`이"
              " 최종 사유를 덮는다. 예약된 market break는 그 자리에서 선점된다 —"
              " **fill로도 단축으로도 세지 않는다.**", "",
              "|사유|fixed K42|신호 반증 청산|", "|---|---|---|"]
    for reason in TERMINAL_REASONS:
        lines.append(
            f"|`{reason}`|{control_terminal.get(reason, 0):,}"
            f"|{terminal.get(reason, 0):,}|"
        )
    lines += ["",
              "**선점 건수는 control 대비 감소분으로 읽는다** — challenger에서 그 종목이"
              " market break로 먼저 나갔으면 폐지 청산 자체가 사라진다.", ""]

    lines += ["### exit reason 분포", "", "|사유|fixed K42|신호 반증 청산|",
              "|---|---|---|"]
    reasons = sorted(set(control["exit_counts"]) | set(challenger["exit_counts"]))
    for reason in reasons:
        lines.append(
            f"|`{reason}`|{control['exit_counts'].get(reason, 0):,}"
            f"|{challenger['exit_counts'].get(reason, 0):,}|"
        )
    lines.append("")
    return lines


def _scenario(runs: dict) -> list[str]:
    lines = ["## 5. 폐지 가정 민감도 (secondary)", "",
             "**main 판정은 `LAST_CLOSE`다.** `ZERO`는 promotion criterion이 아니다.", "",
             "|시나리오|fixed K42 총수익|신호 반증 총수익|Δ|fixed 기대값|반증 기대값|",
             "|---|---|---|---|---|---|"]
    for scenario in UNRESOLVED_EXIT_PRICES:
        left = runs.get(run_id_for(CONTROL, scenario))
        right = runs.get(run_id_for(CHALLENGER, scenario))
        if not left or not right:
            continue
        a, b = left["metrics"], right["metrics"]
        lines.append(
            f"|{scenario}|{_pct(a['total_return'])}|{_pct(b['total_return'])}"
            f"|**{_pct(_delta(a['total_return'], b['total_return']))}**"
            f"|{_num(a['expectancy_r'])}|{_num(b['expectancy_r'])}|"
        )
    lines.append("")
    return lines


def _regime(control: dict, challenger: dict) -> list[str]:
    lines = ["## 6. 레짐별 (진입 시점 라벨)", "",
             "**레짐별 격차는 그 상태의 세션만 따로 복리한 값이라 레짐 간에 더해지지"
             " 않는다.** 전체 격차의 귀속으로 쓰지 않는다.", "",
             "|상태|fixed K42 전략|반증 청산 전략|fixed 격차|반증 격차|",
             "|---|---|---|---|---|"]
    detail = {
        key: {row["regime"]: row for row in run["regime_detail"]}
        for key, run in (("c", control), ("x", challenger))
    }
    for state in sorted(detail["c"]):
        left, right = detail["c"].get(state), detail["x"].get(state)
        if not left or not right:
            continue
        lines.append(
            f"|{state}|{_pct(left['strategy_return'])}|{_pct(right['strategy_return'])}"
            f"|{_pct(left['gap'])}|{_pct(right['gap'])}|"
        )
    lines.append("")
    return lines


def _verdict(control: dict, challenger: dict) -> list[str]:
    delta = decompose(control, challenger)
    gate = final_gate(challenger)
    control_gate = final_gate(control)
    risk = risk_directions(control, challenger)
    kept = control_kept(control, challenger)
    sharpe_ok = challenger["metrics"]["sharpe"] >= control["metrics"]["sharpe"]
    label = classify_component(delta, gate["pass"], sharpe_ok, kept, risk)

    lines = ["## 7. 사전등록 판정", "",
             "### 7.1 `CURRENT_ECONOMIC_GATE_PASS` (별도 flag)", "",
             "**최종 전략 자격을 재는 flag이지 component 승격 조건이 아니다.** 로드맵 §4의"
             " 최종 경제 게이트와 같은 값이다.", "",
             "|조건|fixed K42|신호 반증 청산|", "|---|---|---|"]
    for left, right in zip(control_gate["rows"], gate["rows"]):
        lines.append(
            f"|{left['label']}|{'**통과**' if left['pass'] else '미달'}"
            f"|{'**통과**' if right['pass'] else '미달'}|"
        )
    lines += [f"|**전체**|{'**통과**' if control_gate['pass'] else '**미달**'}"
              f"|{'**통과**' if gate['pass'] else '**미달**'}|", ""]

    lines += ["### 7.2 component verdict", "", "|조건|값|", "|---|---|",
              f"|`ΔS`|**{_pct(delta['delta_S'])}**|",
              f"|`ΔG`|**{_pct(delta['delta_G'])}**|",
              f"|`ΔB`|{_pct(delta['delta_B'])}|",
              f"|`Sharpe_ch >= Sharpe_ctl`|{_mark(sharpe_ok)}"
              f" ({_num(control['metrics']['sharpe'], 2)} →"
              f" {_num(challenger['metrics']['sharpe'], 2)})|",
              "",
              "**control이 이미 통과하던 것을 깨지 않았는가**", "",
              "|항목|유지|", "|---|---|"]
    for name, ok in kept.items():
        lines.append(f"|`{name}`|{_mark(ok)}|")
    lines += ["", "**위험 방향** (C가 본다)", "", "|항목|개선|", "|---|---|"]
    for name, ok in risk.items():
        lines.append(f"|`{name}`|{_mark(ok)}|")

    lines += ["", f"### label — **{label}**", "", treatment(label), ""]
    if gate["pass"] and label not in PROMOTES:
        lines += ["> **게이트를 통과했지만 승격이 아니다.** `ΔS` 또는 `ΔG`가 악화됐으므로"
                  " 게이트를 넘은 것은 **control이 이미 하던 일이지 이 청산이 한 일이"
                  " 아니다.** 이번 질문은 fixed K42 대비 marginal improvement다.", ""]
    if label not in PROMOTES:
        lines += ["**사용자 검토 없이 다음 대안을 열지 않는다** — confirmation days ·"
                  " buffer · alternate SMA · ATR threshold를 시도하지 않는다.", ""]

    lines += ["## 8. Limitations", "",
              "- **개발 표본이다.** 이 구간은 PR #9~#17에서 반복 사용됐고 OOS 검증이 아니다",
              "- **인과를 증명하지 않는다** — 한 구간의 한 처치를 잰 것이다",
              "- **`ΔS = ΔB + ΔG`의 잔차 0은 정의의 결과다** — 분해가 맞다는 증거이지"
              " 발견이 아니다",
              "- **`LAST_CLOSE`가 main이고 `ZERO`는 secondary다** — 두 층을 섞지 않았다",
              "- **`MARKET_TREND_BREAK` 건수를 단축 건수로 읽지 않았다** — 폐지·미해결"
              " 선점과 untradeable 지연을 따로 셌다",
              ""]
    return lines


# ---------------------------------------------------------------- CLI


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="stage", required=True)
    sub.add_parser("plan")
    runner = sub.add_parser("run")
    runner.add_argument("core", choices=list(ARMS))
    runner.add_argument("scenario", choices=sorted(UNRESOLVED_EXIT_PRICES))
    sub.add_parser("report")
    arguments = parser.parse_args()

    if arguments.stage == "plan":
        for core, scenario in planned():
            print(f"run {core} {scenario}")
        return 0

    connection = store.connect()
    try:
        if arguments.stage == "run":
            return stage_run(connection, arguments.core, arguments.scenario)
        return stage_report(connection)
    finally:
        connection.close()


if __name__ == "__main__":
    sys.exit(main())
