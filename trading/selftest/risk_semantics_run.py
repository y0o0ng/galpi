"""2ATR는 실제 손절선인가 volatility position scale인가. **로드맵 Phase 4 · PR #19.**

사전등록 전문은 `runs/risk-semantics/README.md`이고 **결과 전에** 커밋했다.

## 묻는 것

    현재 `J126 + SMA200 신규진입 gate + fixed K42` 전략에서 sizing에 사용하는
    2ATR를 실제 hard stop으로 집행해야 하는가, 아니면 이것은 손절 위험이
    아니라 단순한 volatility-based position scale인가?

**alpha 실험이 아니다.** 결론은 둘뿐이다 — `STOP_DEFINED_RISK`(A) 또는
`VOLATILITY_SCALED_POSITION`(B). 세 번째 구조를 만들지 않는다.

## 처치는 `exit_mode` 하나다

`FIXED_HOLD_HARD_STOP`은 `FIXED_HOLD`에 **초기 손절 하나만** 더한 것이고 장중 검사는
`position.initial_stop`만 읽는다. 체결은 기존 `try_stop_exit`이 한다 — 시초가가 손절가
아래면 `GAP_FILL`, 장중 저가가 닿으면 `STOP_FILL`이다.

## "0.25% 위험"을 최대손실이라고 부르지 않는다

hard stop이 생겨도 overnight gap·비용 때문에 실현 손실이 planned stop risk를 넘을 수
있다. 그래서 이 러너는 **초과 건수와 비율을 값으로** 낸다(§8). 그리고 control의
`expectancy_r`는 2ATR가 집행되지 않으므로 **2ATR volatility-unit return**이지 실제
stop-defined risk multiple이 아니다(§7).

## 진단용 sizing 계산기를 만들지 않는다

planned stop risk는 엔진이 진입 시점에 쓴 값을 `entry_observer`의 `SizedIntent`에서 그대로
읽는다(`shares × stop_distance`). 그것이 `_OpenTrade.risk_dollars`와 같은 값이고,
`ratio = −return_r`과 일치하는지 잔차로 확인한다. 복제하면 그 복제본이 엔진과 갈린다.

    python3 selftest/risk_semantics_run.py plan
    python3 selftest/risk_semantics_run.py run jt-j126-k42-sma200 LAST_CLOSE
    python3 selftest/risk_semantics_run.py report
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
from backtest.loop import BacktestConfig, EntryEvent, Trade, run_backtest  # noqa: E402
from backtest.metrics import compute_metrics  # noqa: E402
from backtest.modes import (  # noqa: E402
    HARD_STOP_EXITS as HARD_STOP_MODE,
    LAST_CLOSE_EXIT,
    UNRESOLVED_EXIT_PRICES,
)
from core import CORES  # noqa: E402
from selftest.k_lifetime_run import reference_closes, regime_detail  # noqa: E402
# **PR #16의 분해·게이트와 PR #18의 kept 판정을 그대로 쓴다.** 복제하면 정의가 갈린다.
from selftest.market_gate_run import (  # noqa: E402
    BUY_AND_HOLD,
    MATCHED,
    decompose,
    final_gate,
)
from selftest.momentum_run import research_window  # noqa: E402
from selftest.real_run import INDEX_NAMES, RUNS_DIR, SOURCE_VERSION  # noqa: E402
from selftest.signal_invalidation_run import CONTROL_KEPT, control_kept  # noqa: E402
from selftest.slot_capacity_run import capacity_diagnostics  # noqa: E402

EXPERIMENT = "risk-semantics"
# PR #18이 **같은 control 코어·같은 구간**으로 낸 산출물. 새 청산 모드를 더하고 문서
# 표현을 고친 뒤에도 control이 그대로인지 대조하는 데 쓴다(사전등록 §15·§14).
PRIOR_EXPERIMENT = "signal-invalidation-exit"

CONTROL = "jt-j126-k42-sma200"
CHALLENGER = "jt-j126-k42-sma200-stop"
ARMS = (CONTROL, CHALLENGER)
LABELS = {CONTROL: "fixed K42", CHALLENGER: "2ATR 초기 손절"}
SLUGS = {CONTROL: "control", CHALLENGER: "stop"}

# 이 실험이 세는 청산 사유. `INITIAL_STOP`은 challenger에만 나오고 control에서는 0이어야
# 한다 — 나오면 처치가 새는 것이다.
INITIAL_STOP = "INITIAL_STOP"
STOP_FILL = "STOP_FILL"
GAP_FILL = "GAP_FILL"
STOP_FILL_REASONS = (STOP_FILL, GAP_FILL)
EXIT_REASONS_REPORTED = (
    INITIAL_STOP,
    "MAX_HOLD",
    "DELISTED_EXIT",
    "UNRESOLVED_EXIT",
)

# §13 사전등록 verdict. **둘뿐이고 결과를 본 뒤 중간 label을 만들지 않는다.**
LABEL_STOP_DEFINED = "STOP_DEFINED_RISK"
LABEL_VOLATILITY_SCALED = "VOLATILITY_SCALED_POSITION"
VERDICTS = (LABEL_STOP_DEFINED, LABEL_VOLATILITY_SCALED)
PROMOTES = frozenset({LABEL_STOP_DEFINED})

# §13 A의 여덟 조건. 순서와 문구를 결과 전에 박았다.
CONDITION_LABELS = (
    ("gap_positive", "1. challenger 격차 `G > 0`"),
    ("total_return_positive", "2. challenger 비용 후 총수익 > 0"),
    ("control_minimums_kept", "3. control이 이미 통과하던 경제 최소조건을 깨지 않음"),
    ("profit_factor_ok", "4. `PF ≥ 1.15`"),
    ("max_drawdown_ok", "5. `MDD ≤ 15%`"),
    ("sharpe_not_worse", "6. `Sharpe_ch ≥ Sharpe_ctl`"),
    ("max_drawdown_not_worse", "7. `MDD_ch ≤ MDD_ctl`"),
    ("hard_stop_binding", "8. hard stop이 한 번 이상 binding"),
)

# 실현 손실이 planned stop risk를 넘었는지 가르는 배수. **문턱이 아니라 정의다** —
# 1R은 계획한 손절 위험 그 자체이고, 그것을 넘은 것이 gap-through·비용의 몫이다.
EXCEEDANCE_MULTIPLE = 1.0

# planned stop risk를 `−return_r`과 대조할 때 허용하는 상대 오차. 부동소수 잡음만 흡수한다.
RATIO_REL_TOL = 1e-9


def run_id_for(core: str, scenario: str) -> str:
    return f"{SLUGS[core]}-{scenario.lower()}"


def out_dir() -> Path:
    path = RUNS_DIR / EXPERIMENT
    path.mkdir(parents=True, exist_ok=True)
    return path


def planned() -> list[tuple[str, str]]:
    return [(core, scenario) for core in ARMS for scenario in UNRESOLVED_EXIT_PRICES]


# ---------------------------------------------------------------- 실행


def planned_stop_risk(events: list[EntryEvent]) -> dict[tuple[str, str], float]:
    """체결된 진입마다 엔진이 쓴 계획 손절 위험. `(종목, 진입일) → 달러`.

    **다시 계산하지 않는다.** `SizedIntent.stop_distance`는 진입 시점 ATR로 만든 손절폭
    이고 `shares`는 실제 체결 수량이라, 곱이 loop의 `_OpenTrade.risk_dollars`와 같은
    값이다. 그 값이 `Trade.return_r`의 분모이므로 두 경로가 일치하는지 §8이 잔차로 본다.
    """
    table: dict[tuple[str, str], float] = {}
    for event in events:
        if event.fill is None:
            continue
        key = (event.fill.symbol, event.fill.trade_date)
        table[key] = event.fill.shares * event.intent.stop_distance
    return table


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

    # **관찰자는 읽기 전용이다.** 계획 손절 위험은 진입 자리에서만 살아 있다.
    events: list[EntryEvent] = []
    result = run_backtest(connection, config, entry_observer=events.append)
    metrics = compute_metrics(result)
    closes = reference_closes(connection)

    payload = {
        "run_id": run_id,
        "experiment": EXPERIMENT,
        "core": core_key,
        "arm": LABELS[core_key],
        "scenario": scenario,
        "exit_mode": core.exit_mode,
        "regime_mode": core.regime_mode,
        "policy_signature": core.signature,
        "max_hold_sessions": core.policy.parameters.max_hold_sessions,
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
        "fill_counts": result.fill_counts,
        "sessions": len(result.equity_curve),
        "stop_mechanism": stop_mechanism(
            planned_stop_risk(events), result.trades
        ),
    }
    path = out_dir() / f"{run_id}.json"
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    matched = payload["benchmark"][MATCHED]["total_return"]
    stop = payload["stop_mechanism"]
    print(f"  거래 {metrics.trade_count:,} · 총수익 {metrics.total_return:.2%}"
          f" · 기대값 {metrics.expectancy_r:.3f} · Sharpe {metrics.sharpe:.2f}"
          f" · MDD {metrics.max_drawdown:.1%}")
    print(f"  노출 {metrics.avg_exposure:.2%} · 격차 {metrics.total_return - matched:+.2%}")
    print(f"  {INITIAL_STOP} {stop['initial_stop_exits']:,}"
          f" ({STOP_FILL} {stop['fill_reasons'][STOP_FILL]:,}"
          f" · {GAP_FILL} {stop['fill_reasons'][GAP_FILL]:,})"
          f" · 계획 초과 {stop['exceedance']['count']:,}")
    print(f"  → {path.name}")
    return 0


def stop_mechanism(
    planned_risk: dict[tuple[str, str], float], trades: tuple[Trade, ...]
) -> dict:
    """초기 손절 청산이 실제로 무엇을 했는가(사전등록 §8·§9).

    **`INITIAL_STOP` 청산만 본다.** `MAX_HOLD`·폐지·미해결은 이 처치가 정한 청산이
    아니다.

    세 분포를 낸다 — 계획 손절 위험(달러) · 실현 순손실(달러) · 그 비(`realized /
    planned`). 마지막 값은 정의상 `−return_r`과 같아야 하고, **다르면 조용히 넘어가지
    않고 멈춘다** — planned risk를 다시 계산하는 경로가 엔진과 갈렸다는 뜻이기 때문이다.
    """
    stops = [trade for trade in trades if trade.exit_reason == INITIAL_STOP]
    fill_reasons = {
        reason: sum(1 for trade in stops if trade.exit_fill_reason == reason)
        for reason in STOP_FILL_REASONS
    }
    other = [
        trade.exit_fill_reason
        for trade in stops
        if trade.exit_fill_reason not in STOP_FILL_REASONS
    ]
    if other:
        # 손절 체결은 `try_stop_exit`의 둘뿐이다. 셋째가 나오면 체결 경로가 하나 더 생긴
        # 것이므로 진단이 조용히 그것을 삼키는 대신 멈춘다.
        raise AssertionError(f"모르는 손절 체결 사유입니다: {sorted(set(other))}")

    planned: list[float] = []
    realized: list[float] = []
    ratios: list[float] = []
    by_fill: dict[str, list[float]] = {reason: [] for reason in STOP_FILL_REASONS}
    exceeded: list[Trade] = []
    for trade in stops:
        key = (trade.symbol, trade.entry_date)
        if key not in planned_risk:
            raise AssertionError(f"진입 관찰이 없는 손절 청산입니다: {key}")
        budget = planned_risk[key]
        loss = -trade.pnl
        ratio = loss / budget
        # 엔진의 `return_r`은 같은 분모를 쓴다. 두 경로가 갈리면 여기서 멈춘다.
        if abs(ratio - (-trade.return_r)) > RATIO_REL_TOL * max(1.0, abs(ratio)):
            raise AssertionError(
                f"계획 손절 위험이 엔진과 다릅니다: {key}"
                f" ratio {ratio} vs -return_r {-trade.return_r}"
            )
        planned.append(budget)
        realized.append(loss)
        ratios.append(ratio)
        by_fill[trade.exit_fill_reason].append(ratio)
        if ratio > EXCEEDANCE_MULTIPLE:
            exceeded.append(trade)

    return {
        "initial_stop_exits": len(stops),
        "closed_trades": len(trades),
        "share_of_closed_trades": (len(stops) / len(trades)) if trades else 0.0,
        "fill_reasons": fill_reasons,
        "planned_stop_risk_dollars": _describe(planned),
        "realized_net_loss_dollars": _describe(realized),
        "realized_over_planned": _describe(ratios),
        # 사전등록 §8이 요구한 `STOP_FILL`/`GAP_FILL` 구분. **초과 건수만 가르면 두 경로가
        # 얼마나 다른지 안 보인다** — 손절가 체결은 비용만큼만 넘지만 갭 체결은 그렇지 않다.
        "realized_over_planned_by_fill": {
            reason: _describe(values) for reason, values in by_fill.items()
        },
        "sessions_held_before_stop": _describe(
            [float(trade.sessions_held) for trade in stops]
        ),
        # 진입 당일 손절. 일봉 모델은 그 저가가 우리 체결보다 앞선 시각이었는지 알 수
        # 없어서 실제보다 자주 걸릴 수 있다 — `positions.py`가 명시한 보수적 편향이고
        # 이번 PR에서 바꾸지 않은 계약이라 건수를 남긴다.
        "entry_session_stops": sum(
            1 for trade in stops if trade.sessions_held <= 1
        ),
        "exceedance": {
            "count": len(exceeded),
            "share_of_stop_exits": (len(exceeded) / len(stops)) if stops else 0.0,
            "by_fill_reason": {
                reason: sum(
                    1 for trade in exceeded if trade.exit_fill_reason == reason
                )
                for reason in STOP_FILL_REASONS
            },
            "worst_ratio": max(ratios) if ratios else None,
        },
    }


def _percentile(values: list[float], fraction: float) -> float:
    """정렬된 표본의 nearest-rank 백분위. **보간하지 않는다.**

    손절 건수가 두 자릿수일 수 있어서 보간값은 있지도 않은 정밀도를 주장하게 된다.
    실제 관측 하나를 그대로 돌려준다.
    """
    ordered = sorted(values)
    rank = max(1, min(len(ordered), int(-(-len(ordered) * fraction // 1))))
    return ordered[rank - 1]


def _describe(values: list[float]) -> dict:
    if not values:
        return {
            "count": 0, "mean": None, "median": None,
            "p90": None, "p95": None, "max": None,
        }
    return {
        "count": len(values),
        "mean": statistics.fmean(values),
        "median": statistics.median(values),
        "p90": _percentile(values, 0.90),
        "p95": _percentile(values, 0.95),
        "max": max(values),
    }


# ---------------------------------------------------------------- 판정


def conditions(control: dict, challenger: dict) -> dict:
    """§13 A의 여덟 조건을 각각 참·거짓으로. **결과를 본 뒤 문턱을 바꾸지 않는다.**"""
    gate = {row["name"]: row["pass"] for row in final_gate(challenger)["rows"]}
    left, right = control["metrics"], challenger["metrics"]
    return {
        "gap_positive": gate["gap"],
        "total_return_positive": gate["total_return"],
        "control_minimums_kept": all(control_kept(control, challenger).values()),
        "profit_factor_ok": gate["profit_factor"],
        "max_drawdown_ok": gate["max_drawdown"],
        "sharpe_not_worse": (right["sharpe"] or 0) >= (left["sharpe"] or 0),
        "max_drawdown_not_worse": right["max_drawdown"] <= left["max_drawdown"],
        "hard_stop_binding": challenger["stop_mechanism"]["initial_stop_exits"] >= 1,
    }


def classify(checks: dict) -> str:
    """A는 여덟 조건 전부, 아니면 B다. **중간 label이 없다**(사전등록 §13)."""
    missing = [name for name, _ in CONDITION_LABELS if name not in checks]
    if missing:
        raise AssertionError(f"조건이 빠졌습니다: {missing}")
    if all(bool(checks[name]) for name, _ in CONDITION_LABELS):
        return LABEL_STOP_DEFINED
    return LABEL_VOLATILITY_SCALED


def treatment(label: str) -> str:
    return {
        LABEL_STOP_DEFINED: "**2ATR를 실제 initial hard stop으로 집행한다.**"
        " `J126 + SMA200 gate + 2ATR initial hard stop + K42`를 이후 전략 후보로"
        " 유지하고, 0.25%를 **`planned stop-risk budget`**이라고 부를 수 있다."
        " **단 \"maximum loss\"라고는 하지 않는다** — gap-through와 비용 때문에 실현"
        " 손실이 1R을 넘을 수 있다.",
        LABEL_VOLATILITY_SCALED: "**hard stop을 쓰지 않고 fixed K42를 유지한다.**"
        " hard-stop challenger는 연구 기록·재현용으로만 남기고 strategy stack에 넣지"
        " 않는다. 2ATR 기반 sizing은 유지하되 **이것을 actual loss risk라고 부르지"
        " 않는다** — 0.25%는 volatility sizing budget이다. **1.5 / 2.5 / 3ATR 재탐색 ·"
        " trailing stop 대안 · stop confirmation을 열지 않는다.**",
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
        "# PR #19 — Risk Semantics",
        "",
        "## 1. 질문",
        "",
        "> **현재 `J126 + SMA200 신규진입 gate + fixed K42` 전략에서 sizing에 사용하는"
        " `2ATR`를 실제 hard stop으로 집행해야 하는가, 아니면 이것은 손절 위험이 아니라"
        " 단순한 volatility-based position scale인가?**",
        "",
        "**alpha를 개선하려는 실험이 아니다.** 현재 `FIXED_HOLD`는 K42 만기만 집행하므로"
        " `2ATR`는 실제 청산 boundary가 아니고, 그래서 \"거래당 위험 0.25%\" ·"
        " `planned risk` · `open risk` · `R`은 전략의 실제 최대손실 위험으로 읽으면"
        " **틀리다.** 이 PR은 그 모순을 해결한다.",
        "",
        "**가능한 결론은 정확히 둘이다** — `STOP_DEFINED_RISK`(A) 또는"
        " `VOLATILITY_SCALED_POSITION`(B). 세 번째 구조를 만들지 않는다.",
        "",
        "**개발 표본이다.** 이 구간은 PR #9~#18에서 반복 사용됐고 OOS 검증이 아니다.",
        "",
    ]
    if missing:
        lines += [f"**아직 없는 실행 {len(missing)}개:** {', '.join(missing)}", ""]
    if not control or not challenger:
        return _write(lines + ["**LAST_CLOSE 두 팔이 모두 있어야 판정할 수 있다.**", ""])

    lines += _reproduction(control)
    lines += _unchanged_control(runs)
    lines += _semantics(challenger)
    lines += _decomposition(control, challenger)
    lines += _secondary(control, challenger)
    lines += _mechanism(challenger)
    lines += _exceedance(challenger)
    lines += _exits(control, challenger)
    lines += _scenario(runs)
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
        ("기대값 (2ATR-unit)", "0.343", "expectancy_r", _num),
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
    lines = ["## 2. prereg checksum · 3. control 재현 (PR #16 gated LAST_CLOSE)", "",
             "**drift가 있으면 challenger를 해석하지 말고 원인부터 찾는다.**", "",
             "|항목|사전등록 기대|이번|", "|---|---|---|"]
    for label, want, key, fmt in expected:
        lines.append(f"|{label}|{want}|**{fmt(control['metrics'][key])}**|")
    lines.append(f"|격차 `G`|+4.99%|**{_pct(gap)}**|")
    holdout = control["holdout"]
    lines += ["",
              f"구간 {control['window'][0]} ~ {control['window'][1]} ·"
              f" `HOLDOUT_CONSUMED = {str(holdout['HOLDOUT_CONSUMED']).lower()}`"
              f" (`HOLDOUT_START = {holdout['HOLDOUT_START']}`)",
              "",
              f"control의 `INITIAL_STOP` 청산 수 **"
              f"{control['stop_mechanism']['initial_stop_exits']}건** — 0이어야 한다."
              " 0이 아니면 처치가 control로 샌 것이다.", ""]
    return lines


def prior_control(scenario: str) -> dict | None:
    """PR #18이 같은 control 코어·같은 구간으로 낸 산출물. 없으면 None이다."""
    path = RUNS_DIR / PRIOR_EXPERIMENT / f"control-{scenario.lower()}.json"
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


# 두 PR의 control이 같은지 볼 때 대조하는 값. 실행 조건이 같으면 전부 같아야 한다.
UNCHANGED_KEYS = (
    "trade_count", "total_return", "expectancy_r", "profit_factor",
    "sharpe", "max_drawdown", "avg_exposure", "fees_paid",
)


def _unchanged_control(runs: dict) -> list[str]:
    """**새 모드를 더하고 문서를 고친 뒤에도 control이 그대로인가.**

    사전등록 §15는 기존 `FIXED_HOLD` 결과 불변을, §14는 semantic cleanup이 행동을 바꾸지
    않을 것을 요구한다. 두 요구를 **같은 코어의 이전 PR 산출물과 값으로** 대조해 확인한다 —
    `control-zero`는 정리 **뒤에** 돌았으므로 이 대조가 그 부분을 덮는다.
    """
    lines = ["## 3.1 control 불변 — PR #18 산출물과 값 대조", "",
             "**새 청산 모드를 더하고(§15) 문서 표현을 고친 뒤에도(§14) control이 그대로여야"
             " 한다.** 같은 코어 `jt-j126-k42-sma200`을 같은 구간으로 돌린 PR #18의 산출물과"
             " 대조한다.", ""]
    any_row = False
    for scenario in UNRESOLVED_EXIT_PRICES:
        current = runs.get(run_id_for(CONTROL, scenario))
        earlier = prior_control(scenario)
        if not current or not earlier:
            continue
        any_row = True
        diffs = [
            key
            for key in UNCHANGED_KEYS
            if current["metrics"].get(key) != earlier["metrics"].get(key)
        ]
        lines += [f"**{scenario}** — "
                  + ("**여덟 값 전부 일치**" if not diffs
                     else "**차이 있음: " + ", ".join(f"`{k}`" for k in diffs) + "**"),
                  "", "|지표|PR #18|이번|", "|---|---|---|"]
        for key in UNCHANGED_KEYS:
            before, after = earlier["metrics"].get(key), current["metrics"].get(key)
            mark = "" if before == after else " ⚠"
            lines.append(f"|`{key}`|{before!r}|{after!r}{mark}|")
        lines.append("")
    if not any_row:
        lines += ["PR #18 산출물이 없어 대조하지 못했다.", ""]
        return lines
    lines += ["**`control-zero`는 semantic cleanup 뒤에 돌았다.** 그 값이 정리 전 PR #18과"
              " 같다는 것이 \"이름만 고쳤고 행동은 안 바꿨다\"의 실행 증거다. 값 비교는"
              " 부동소수 표현 그대로(`repr`) 한다 — 반올림해서 보면 미세한 drift가 숨는다.",
              ""]
    return lines


def _semantics(challenger: dict) -> list[str]:
    return ["## 4. treatment exact semantics", "",
            f"|항목|control|challenger|", "|---|---|---|",
            f"|`exit_mode`|`FIXED_HOLD`|**`{challenger['exit_mode']}`**|",
            f"|`regime_mode`|`TREND_GATE`|`{challenger['regime_mode']}`|",
            "|손절가|없음|`entry fill − 2 × 진입 시점 ATR14` (`initial_stop`)|",
            "|추적손절·시간손절·실적 청산|없음|**없음**|",
            "|만기|K42|K42 (그대로)|",
            "",
            "**장중 검사는 `position.initial_stop`만 읽는다.** `stop_price`는 최고 종가가"
            " 진입가 +1 ATR을 넘으면 추적손절로 바뀌므로 그것을 읽으면 처치가 둘이 된다.",
            "",
            "**체결 모델은 기존 `try_stop_exit`이다** — 시초가가 손절가 아래면 실제"
            " 시초가에 `GAP_FILL`, 장중 저가가 닿으면 손절가에 `STOP_FILL`이다. 새 stop"
            " fill engine을 만들지 않았다. 진입 당일 손절 검사도 기존 일봉 모델의"
            " **보수적 편향 계약** 그대로다.",
            "",
            "**`policy_id`만 다르고 행동 규칙은 `exit_mode` 하나만 다르다.** 서명을 갈라"
            " 두는 이유는 `record_holdout_run`이 서명으로 홀드아웃 소모를 세기 때문이다"
            "(로드맵 §7 C3-1).", ""]


def _decomposition(control: dict, challenger: dict) -> list[str]:
    delta = decompose(control, challenger)
    return ["## 5. Primary — `S`/`B`/`G` + Δ 분해 (LAST_CLOSE)", "",
            "**PR #16의 분해 헬퍼를 그대로 부른다.** 복제하면 두 실험의 정의가 갈린다.", "",
            "|값|fixed K42|2ATR 초기 손절|**Δ**|", "|---|---|---|---|",
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
            "**잔차가 0인 것은 `G ≡ S − B`라는 정의의 결과이지 발견이 아니다.**", "",
            "### `F` / `T` 보조 분해 (새 criterion 아님)", "",
            "|값|fixed K42|2ATR 초기 손절|Δ|", "|---|---|---|---|",
            f"|`F` 평균 노출 고정|{_pct(delta['F_control'])}|{_pct(delta['F_gate'])}"
            f"|{_pct(delta['delta_F'])}|",
            f"|`T = B − F` 타이밍|{_pct(delta['T_control'])}|{_pct(delta['T_gate'])}"
            f"|{_pct(delta['delta_T'])}|",
            "",
            "**risk semantics 연구라는 이유로 portfolio economics를 무시하지 않는다.**", ""]


def _secondary(control: dict, challenger: dict) -> list[str]:
    left, right = control["metrics"], challenger["metrics"]
    lines = ["## 6. Secondary economics", "", "|지표|fixed K42|2ATR 초기 손절|Δ|",
             "|---|---|---|---|"]
    for label, key, fmt in (
        ("총수익", "total_return", _pct),
        ("CAGR", "cagr", lambda v: _pct(v, 2)),
        ("Sharpe", "sharpe", lambda v: _num(v, 2)),
        ("Sortino", "sortino", lambda v: _num(v, 2)),
        ("Calmar", "calmar", lambda v: _num(v, 2)),
        ("MDD", "max_drawdown", _share),
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
    matched = [
        run["benchmark"][MATCHED]["total_return"] for run in (control, challenger)
    ]
    gaps = [
        run["metrics"]["total_return"] - value
        for run, value in zip((control, challenger), matched)
    ]
    lines.append(
        f"|노출 일치 격차 `G`|{_pct(gaps[0])}|{_pct(gaps[1])}"
        f"|**{_pct(gaps[1] - gaps[0])}**|"
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

    lines += ["", "### R 단위의 의미는 두 팔에서 다르다 (사전등록 §7)", "",
              "|arm|`2ATR`의 실제 역할|기대값|부르는 이름|", "|---|---|---|---|",
              f"|fixed K42|집행되지 않는다. 수량 단위일 뿐|{_num(left['expectancy_r'])}"
              "|**legacy R-unit** / **2ATR volatility-unit return**|",
              f"|2ATR 초기 손절|실제 initial stop distance|{_num(right['expectancy_r'])}"
              "|**planned-stop-risk R**|",
              "",
              "**control의 기대값을 \"실제 stop-defined risk multiple\"이라고 부르지"
              " 않는다.** 그리고 challenger에서도 **\"maximum-loss R\"이라고 부르지"
              " 않는다** — §8이 보여주듯 실현 손실이 1R을 넘을 수 있다.", "",
              "### 100% SPY 매수보유 (opportunity-cost reference)", "",
              "**promotion criterion으로 쓰지 않는다.**", "",
              "|기준|총수익|", "|---|---|",
              f"|100% SPY 매수보유|{_pct(control['benchmark'][BUY_AND_HOLD]['total_return'])}|",
              ""]
    return lines


def _distribution(title: str, unit: str, row: dict, fmt) -> list[str]:
    return [f"**{title}** ({unit})", "", "|값|결과|", "|---|---|",
            f"|건수|{row['count']:,}|",
            f"|평균|{fmt(row['mean'])}|",
            f"|중앙|{fmt(row['median'])}|",
            f"|p90|{fmt(row['p90'])}|",
            f"|p95|{fmt(row['p95'])}|",
            f"|최대|{fmt(row['max'])}|", ""]


def _mechanism(challenger: dict) -> list[str]:
    stop = challenger["stop_mechanism"]
    max_hold = challenger["max_hold_sessions"]
    lines = ["## 7. Hard-stop mechanism — 처치가 실제로 binding인가", "",
             "**이 표는 promotion threshold가 아니다**(§9 조건 8의 \"한 번 이상\"만"
             " 판정에 들어간다). 처치가 작동했는지 확인하는 mechanism diagnostic이다.", "",
             "|지표|값|", "|---|---|",
             f"|`{INITIAL_STOP}` exit count|**{stop['initial_stop_exits']:,}**|",
             f"|closed trades|{stop['closed_trades']:,}|",
             f"|손절이 차지하는 비율|**{_share(stop['share_of_closed_trades'])}**|",
             f"|`{STOP_FILL}`|{stop['fill_reasons'][STOP_FILL]:,}|",
             f"|`{GAP_FILL}`|{stop['fill_reasons'][GAP_FILL]:,}|",
             ""]
    lines += _distribution(
        f"손절까지 보유한 세션 (K{max_hold} 만기 전에 잘린 길이)",
        "sessions", stop["sessions_held_before_stop"], lambda v: _num(v, 1),
    )
    lines += [f"그중 **진입 당일 손절 {stop['entry_session_stops']:,}건**"
              f" (손절의 {_share(stop['entry_session_stops'] / stop['initial_stop_exits']) if stop['initial_stop_exits'] else '—'})."
              " 일봉 모델은 그 저가가 우리 체결보다 앞선 시각이었는지 알 수 없어 실제보다"
              " 자주 걸릴 수 있다 — **기존 코드가 명시한 보수적 편향이고 이번 PR에서"
              " 바꾸지 않은 계약이다.**", "",
              "**슬롯을 일찍 비운 결과는 진입 수 변화로 §6에 있다.** 조기 청산이 다음"
              " 후보를 들여보내므로 **두 팔의 entry set이 갈린다** — §11의 해석 규칙을"
              " 함께 읽는다.", ""]
    return lines


def _exceedance(challenger: dict) -> list[str]:
    stop = challenger["stop_mechanism"]
    exceed = stop["exceedance"]
    lines = ["## 8. gap-through / planned-stop-risk 초과", "",
             "**hard stop이 생겨도 실현 손실이 planned stop risk를 넘을 수 있다** —"
             " overnight gap · 수수료 · 제세금 때문이다. **이것은 오류가 아니다.**"
             " 그래서 A가 살아남더라도 0.25%를 `planned stop risk`라고 부르고"
             " **`guaranteed max loss`라고 부르지 않는다.**", ""]
    lines += _distribution(
        "planned stop risk", "달러 = `수량 × 2 × 진입 시점 ATR14`",
        stop["planned_stop_risk_dollars"], _money,
    )
    lines += _distribution(
        "실현 순손실", "달러 = `−pnl`, 비용 포함. 음수는 손절가에서 이익으로 끝난 것",
        stop["realized_net_loss_dollars"], _money,
    )
    lines += _distribution(
        "실현 손실 / planned stop risk", "배수 = `−return_r`",
        stop["realized_over_planned"], lambda v: _num(v, 3),
    )
    lines += ["**초과 건수** (`실현 손실 > planned stop risk`)", "",
              "|항목|값|", "|---|---|",
              f"|건수|**{exceed['count']:,}**|",
              f"|손절 청산 대비 비율|**{_share(exceed['share_of_stop_exits'])}**|",
              f"|그중 `{STOP_FILL}`|{exceed['by_fill_reason'][STOP_FILL]:,}|",
              f"|그중 `{GAP_FILL}`|{exceed['by_fill_reason'][GAP_FILL]:,}|",
              f"|최악 배수|{_num(exceed['worst_ratio'], 3)}|",
              "",
              "### 체결 경로별 배수 — 두 경로는 다른 이유로 1R을 넘는다", "",
              "**`STOP_FILL`이 1R을 넘는 것은 갭이 아니라 산술이다.** 손절가에서 정확히"
              " 체결돼도 주당 총손실은 `2ATR`이고 그 **위에** 매도 슬리피지·수수료·"
              " 제세금과 진입 쪽 비용이 얹힌다. planned stop risk는 `수량 × 2ATR`로"
              " 비용을 포함하지 않으므로 **비용이 있는 한 손절 체결의 배수는 구조적으로"
              " 1을 넘는다.** `GAP_FILL`은 거기에 시초가와 손절가의 거리가 더해진다.",
              "",
              "|체결|건수|평균|중앙|p90|p95|최대|", "|---|---|---|---|---|---|---|"]
    for reason in STOP_FILL_REASONS:
        row = stop["realized_over_planned_by_fill"][reason]
        lines.append(
            f"|`{reason}`|{row['count']:,}|{_num(row['mean'], 3)}"
            f"|{_num(row['median'], 3)}|{_num(row['p90'], 3)}"
            f"|{_num(row['p95'], 3)}|{_num(row['max'], 3)}|"
        )
    lines += ["",
              "**이것이 §4를 값으로 뒷받침한다** — hard stop을 실제로 집행해도 0.25%는"
              " 실현 최대손실의 상한이 아니다. 허용되는 표현은 `planned stop risk`다.",
              "",
              "**`planned stop risk`는 다시 계산하지 않았다** — 엔진이 진입 시점에 쓴"
              " `SizedIntent.stop_distance × shares`를 관찰자로 읽었고, 그것이"
              " `Trade.return_r`의 분모와 같은지 항목마다 대조했다(다르면 실행이 멈춘다).",
              ""]
    return lines


def _exits(control: dict, challenger: dict) -> list[str]:
    lines = ["## 9. exit reason 분포", "", "|사유|fixed K42|2ATR 초기 손절|",
             "|---|---|---|"]
    reasons = sorted(
        set(control["exit_counts"]) | set(challenger["exit_counts"]),
        key=lambda name: (
            EXIT_REASONS_REPORTED.index(name)
            if name in EXIT_REASONS_REPORTED
            else len(EXIT_REASONS_REPORTED)
        ),
    )
    for reason in reasons:
        lines.append(
            f"|`{reason}`|{control['exit_counts'].get(reason, 0):,}"
            f"|{challenger['exit_counts'].get(reason, 0):,}|"
        )
    lines += ["",
              "**`DELISTED_EXIT`·`UNRESOLVED_EXIT`는 청산 규칙이 아니라 데이터 계층의"
              " 종료 처리다.** 두 팔 모두에 있고 처치와 무관하다 — 다만 조기 손절이"
              " 포트폴리오 경로를 바꾸므로 건수는 갈릴 수 있다.", ""]
    return lines


def _scenario(runs: dict) -> list[str]:
    lines = ["## 10. ZERO 민감도 (secondary)", "",
             "**primary 판정은 `LAST_CLOSE`다.** ZERO 결과 때문에 A/B 판정을 뒤집지"
             " 않는다. 다만 계좌가 구조적으로 붕괴하는 경우는 명확히 적는다.", "",
             "|시나리오|fixed K42 총수익|손절 총수익|Δ|fixed 기대값|손절 기대값|"
             "fixed MDD|손절 MDD|",
             "|---|---|---|---|---|---|---|---|"]
    for scenario in UNRESOLVED_EXIT_PRICES:
        left = runs.get(run_id_for(CONTROL, scenario))
        right = runs.get(run_id_for(CHALLENGER, scenario))
        if not left or not right:
            continue
        a, b = left["metrics"], right["metrics"]
        lines.append(
            f"|{scenario}|{_pct(a['total_return'])}|{_pct(b['total_return'])}"
            f"|**{_pct(_delta(a['total_return'], b['total_return']))}**"
            f"|{_num(a['expectancy_r'])}|{_num(b['expectancy_r'])}"
            f"|{_share(a['max_drawdown'])}|{_share(b['max_drawdown'])}|"
        )
    lines.append("")
    return lines


def _verdict(control: dict, challenger: dict) -> list[str]:
    checks = conditions(control, challenger)
    label = classify(checks)
    left, right = control["metrics"], challenger["metrics"]
    stop = challenger["stop_mechanism"]

    kept = control_kept(control, challenger)
    broken = [name for name, ok in kept.items() if not ok]

    lines = ["## 11. 사전등록 verdict", "",
             "**A는 여덟 조건 전부를 요구하고, 하나라도 실패하면 B다.** 결과를 본 뒤"
             " 중간 label을 만들지 않는다.", "",
             "|조건|만족|값|", "|---|---|---|"]
    detail = {
        "gap_positive": _pct(
            right["total_return"] - challenger["benchmark"][MATCHED]["total_return"]
        ),
        "total_return_positive": _pct(right["total_return"]),
        "control_minimums_kept": (
            "전부 유지" if not broken
            else "깨진 항목 " + ", ".join(f"`{name}`" for name in broken)
        ) + f" (본 항목 {', '.join(f'`{name}`' for name in CONTROL_KEPT)})",
        "profit_factor_ok": _num(right["profit_factor"], 2),
        "max_drawdown_ok": _share(right["max_drawdown"]),
        "sharpe_not_worse": f"{_num(left['sharpe'], 2)} → {_num(right['sharpe'], 2)}",
        "max_drawdown_not_worse": f"{_share(left['max_drawdown'])} →"
        f" {_share(right['max_drawdown'])}",
        "hard_stop_binding": f"{stop['initial_stop_exits']:,}건",
    }
    for name, text in CONDITION_LABELS:
        lines.append(f"|{text}|{_mark(checks[name])}|{detail[name]}|")

    lines += ["", f"### verdict — **{label}**", "", treatment(label), ""]
    if label not in PROMOTES:
        failed = [text for name, text in CONDITION_LABELS if not checks[name]]
        lines += ["**실패한 조건**", ""]
        lines += [f"- {text}" for text in failed]
        lines += ["", "**결과가 나쁘다고 다른 stop을 시도하지 않는다.** 사전등록 §16의"
                  " 금지 목록이고 결과를 보고 확장하지 않는다.", ""]

    lines += _consequence(label)
    lines += ["## 13. Limitations", "",
              "- **개발 표본이다.** 이 구간은 PR #9~#18에서 반복 사용됐고 OOS 검증이 아니다",
              "- **두 팔의 entry set이 다르다.** hard stop이 슬롯을 일찍 비워 challenger가"
              " control이 사지 않은 종목에 진입한다. 이 결과를 **\"같은 거래를 stop만 다르게"
              " 청산한 결과\"라고 설명하지 않는다** — 잰 것은 **portfolio path 전체의"
              " 차이**다. trade-by-trade matched attribution을 억지로 만들지 않았다",
              "- **인과를 증명하지 않는다** — 한 구간의 한 처치를 잰 것이다",
              "- **`ΔS = ΔB + ΔG`의 잔차 0은 정의의 결과다** — 발견이 아니다",
              "- **`LAST_CLOSE`가 primary이고 `ZERO`는 secondary다** — 두 층을 섞지 않았다",
              "- **연구 코어는 `require_earnings_calendar=False`라**"
              " `EARNINGS_GATE_DISABLED` blocker가 항상 붙는다(로드맵 §7 C5). 이 PR의"
              " 판정은 그 게이트와 다른 층이다",
              "- **잰 것은 2ATR 하나다.** 다른 배수에서 무엇이 일어나는지 재지 않았고,"
              " 재지 않은 것을 근거로 다른 배수를 열지도 않는다",
              ""]
    return lines


def _consequence(label: str) -> list[str]:
    if label in PROMOTES:
        return ["## 12. semantic consequence", "",
                "**0.25%를 `planned stop-risk budget`이라고 부를 수 있다.** 2ATR가 실제"
                " initial stop distance이므로 `planned_risk`·`open_risk`·`R`이 행동에"
                " 대응하는 이름이 됐다.", "",
                "**그래도 다음 표현은 쓰지 않는다.**", "",
                "```",
                "guaranteed max loss = 0.25%",
                "maximum loss is capped at 0.25%",
                "```",
                "",
                "§8이 보여주듯 gap-through와 비용 때문에 실현 손실이 planned stop risk를"
                " 넘을 수 있다. 허용되는 표현은 `planned stop risk` ·"
                " `intended stop risk`다.", ""]
    return ["## 12. semantic consequence", "",
            "**B이므로 semantic cleanup을 한다**(사전등록 §14). 목표는 다음 거짓 표현을"
            " 없애는 것 하나다.", "",
            "> \"0.25%가 실제 거래당 최대손실 위험이다\"", "",
            "### 12.1 범위는 코어가 아니라 `exit_mode`가 정한다", "",
            "**\"JT 코어는 손절을 집행하지 않는다\"로 일반화하지 않는다.** `jt_policy`를"
            " 쓰는 코어 중에도 `jt-core-exit`은 `CORE_EXITS`라 초기·추적·시간·실적 청산을"
            " 실제로 집행한다.", "",
            "|`exit_mode`|집행되는 손절|`risk_per_trade = 0.25%`의 뜻|",
            "|---|---|---|",
            "|`CORE` (`core1` · `jt-core-exit`)|초기 2ATR · 추적 · 시간 · 실적"
            "|**planned stop risk**|",
            f"|`{HARD_STOP_MODE}` (`{CHALLENGER}`)|초기 2ATR만|planned stop risk|",
            "|`FIXED_HOLD` · `SIGNAL_INVALIDATION`|**없음**"
            "|**volatility sizing budget**|",
            "",
            f"**현재 살아남은 strategy candidate `{CONTROL}`는 마지막 칸이다.**"
            " 거기서 `2ATR`는 실제 stop boundary가 아니라 position scale 단위다."
            " `paper-core-v1`·`jt-core-exit`을 설명할 때의 \"계획 stop risk\"는 그대로"
            " 맞는 표현이므로 지우지 않는다.", "",
            "### 12.2 `FIXED_HOLD` 계열의 위험 회계는 legacy volatility-budget accounting이다",
            "",
            "집행되는 손절이 없어도 공유 아키텍처에는 이 이름들이 그대로 남아 있다.", "",
            "```",
            "planned_risk · planned_risk_fraction · open_risk · risk_dollars",
            "max_total_planned_risk · TOTAL_PLANNED_RISK_EXCEEDED · return_r",
            "```",
            "",
            "**`FIXED_HOLD` 계열에서 이 값들을 \"실제 stop-defined loss risk\"로 읽지"
            " 않는다.** `2ATR` 기반 position scale과 그 합의 portfolio budget을 나타내는"
            " **legacy volatility-budget accounting**이고, 집행되는 손절선도 최대손실"
            " 한도도 뜻하지 않는다. `TOTAL_PLANNED_RISK_EXCEEDED`도 \"손실 한도를"
            " 넘었다\"가 아니라 \"volatility budget 합계가 한도에 닿았다\"로 읽는다 —"
            " **control에서 이 사유는 실제 결과를 구속하지 않았다**(§9의 skip 사유에"
            " 나타나지 않는다).", "",
            "### 12.3 바꾸지 않은 것", "",
            "**이름은 이번 PR에서 바꾸지 않았다.** `paper-core-v1`·DB 스키마·배포된"
            " 산출물·과거 보고서가 같은 field를 공유하므로 rename은 별도 PR의"
            " compatibility plan이다. `risk.py`의 행동도 `max_total_planned_risk` 계산도"
            " 그대로다 — 바꾼 것은 **읽는 법**뿐이다. 이미 배포된 실행 산출물도 소급"
            " 수정하지 않는다.", "",
            "**중요한 것은 하나다** — PAPER 후보 전략 설명에서 **실제 집행되지 않는 stop을"
            " 실제 loss cap처럼 부르지 않는 것.**", ""]


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
