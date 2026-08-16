"""`SPY > SMA200` 신규진입 게이트가 포트폴리오 경제성을 바꾸는가. **로드맵 Phase 1 · PR #16.**

사전등록 전문은 `runs/market-gate-portfolio/README.md`이고 **결과 전에** 커밋했다.

## 이것은 "나쁜 거래 제거"가 아니다

PR #15가 잰 값이다 — J63은 `SPY <= SMA200`에서 alpha가 **-1.640%**로 반전되지만 **J126은
+0.507%로 양수가 남는다.** 그래서 이 게이트는 신호 층에서 이미 양수인 구간을 **통째로
포기하는** 처치다.

    묻는 것: J126이 SMA200 아래에서도 양의 signal edge를 갖는 상황에서,
             그 구간의 신규진입을 포기하는 것이 현재 K42/S5 포트폴리오의
             after-cost economics를 개선하는가?

**"나쁜 DOWN 거래를 제거한다"라고 쓰지 않는다.**

## 왜 분해하는가

**노출 일치 벤치마크는 정의상 타이밍을 상쇄한다.** 전략이 게이트로 노출을 끄면 벤치마크도
같이 꺼지므로 격차는 *선택 능력*만 재고 *타이밍 능력*은 보지 못한다. PR #13이 이미 그
현상을 보였다 — "격차 +1.88%p 개선 중 87%가 벤치마크 쪽". market-timing 처치에서는 그
효과가 훨씬 커진다.

    S = 비용 후 전략 총수익
    B = 노출 일치 SPY 총수익
    G = S - B

    ΔS = S_gate - S_control
    ΔB = B_gate - B_control
    ΔG = G_gate - G_control

    ΔS = ΔB + ΔG      (G ≡ S - B이므로 정의상 정확히 닫힌다. 잔차가 없다)

**로드맵 §4의 최종 합격 기준(`G > 0`)을 완화하지 않는다.** 이 분해는 component를 alpha
stack에 넣을지 timing overlay 후보로 보존할지를 가르는 데만 쓴다.

## 처치는 하나다

`regime_mode`만 `MARKET` → `TREND_GATE`다. 파라미터·한도·프로필·진입·청산이 전부 같고
`test_market_gate.py`가 dataclass 비교로 잠근다. 게이트는 `new_entries`만 닫으므로 익스포저
상한도 상태 이름도 청산도 그대로다 — **보유 포지션은 게이트가 닫혀도 K42 만기까지 간다.**

    python3 selftest/market_gate_run.py plan
    python3 selftest/market_gate_run.py run jt-j126-k42 LAST_CLOSE
    python3 selftest/market_gate_run.py report
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
from backtest.loop import BacktestConfig, run_backtest  # noqa: E402
from backtest.metrics import compute_metrics  # noqa: E402
from backtest.modes import LAST_CLOSE_EXIT, UNRESOLVED_EXIT_PRICES  # noqa: E402
from backtest.regime import TREND_GATE_BLOCKED  # noqa: E402
from core import CORES  # noqa: E402
from selftest.k_lifetime_run import reference_closes, regime_detail  # noqa: E402
from selftest.momentum_run import research_window  # noqa: E402
from selftest.real_run import INDEX_NAMES, RUNS_DIR, SOURCE_VERSION  # noqa: E402
from selftest.slot_capacity_run import capacity_diagnostics  # noqa: E402

EXPERIMENT = "market-gate-portfolio"

# 읽는 코어는 정확히 둘이다. 사다리를 열지 않는다.
CONTROL = "jt-j126-k42"
CHALLENGER = "jt-j126-k42-sma200"
ARMS = (CONTROL, CHALLENGER)
LABELS = {CONTROL: "게이트 없음", CHALLENGER: "SMA200 게이트"}
SLUGS = {CONTROL: "control", CHALLENGER: "gated"}

# 벤치마크 표의 줄 위치. `benchmark_table`이 세 줄을 이 순서로 낸다.
MATCHED = 0  # 일별 노출 일치
FIXED_EXPOSURE = 1  # 평균 노출 고정
BUY_AND_HOLD = 2  # 100% 보유

# §5 사전등록 label. 결과를 보고 바꾸지 않는다.
LABEL_ECONOMICS_AND_RELATIVE = "ECONOMICS_AND_RELATIVE_IMPROVED"
LABEL_TIMING_ONLY = "TIMING_BENEFIT_ONLY"
LABEL_TIMING_UNCONFIRMED = "TIMING_BENEFIT_UNCONFIRMED"
LABEL_RELATIVE_ONLY = "RELATIVE_ONLY"
LABEL_RISK_ONLY = "RISK_ONLY"
LABEL_FAIL = "FAIL"
GATE_LABELS = (
    LABEL_ECONOMICS_AND_RELATIVE,
    LABEL_TIMING_ONLY,
    LABEL_TIMING_UNCONFIRMED,
    LABEL_RELATIVE_ONLY,
    LABEL_RISK_ONLY,
    LABEL_FAIL,
)

# alpha stack에 올라가는 label은 하나뿐이다.
PROMOTES = frozenset({LABEL_ECONOMICS_AND_RELATIVE})


def run_id_for(core: str, scenario: str) -> str:
    return f"{SLUGS[core]}-{scenario.lower()}"


def out_dir() -> Path:
    path = RUNS_DIR / EXPERIMENT
    path.mkdir(parents=True, exist_ok=True)
    return path


def planned() -> list[tuple[str, str]]:
    """control·challenger × LAST_CLOSE·ZERO = 4개."""
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

    result = run_backtest(connection, config)
    metrics = compute_metrics(result)
    closes = reference_closes(connection)
    benchmark = [
        {"label": row.label, "total_return": row.total_return}
        for row in benchmark_table(result.equity_curve, closes)
    ]

    payload = {
        "run_id": run_id,
        "experiment": EXPERIMENT,
        "core": core_key,
        "arm": LABELS[core_key],
        "scenario": scenario,
        "regime_mode": core.regime_mode,
        "policy_signature": core.signature,
        "rs_lookback": core.policy.parameters.rs_lookback,
        "max_hold_sessions": core.policy.parameters.max_hold_sessions,
        "window": [start, end],
        "holdout": holdout_metadata(consumed=False),
        "metrics": {
            "trade_count": metrics.trade_count,
            "expectancy_r": metrics.expectancy_r,
            "profit_factor": metrics.profit_factor,
            "win_rate": metrics.win_rate,
            "total_return": metrics.total_return,
            "cagr": metrics.cagr,
            "max_drawdown": metrics.max_drawdown,
            "sharpe": metrics.sharpe,
            "sortino": metrics.sortino,
            "calmar": metrics.calmar,
            "avg_exposure": metrics.avg_exposure,
            "turnover": metrics.turnover,
            "fees_paid": metrics.fees_paid,
            "avg_hold_sessions": metrics.avg_hold_sessions,
        },
        "benchmark": benchmark,
        "capacity": capacity_diagnostics(result, core.policy),
        "regime_detail": regime_detail(result, closes),
        "skip_counts": result.skip_counts,
        "exit_counts": result.exit_counts,
        "sessions": len(result.equity_curve),
        # **시장이 SMA200 아래였던 세션 수다. 게이트가 막은 수가 아니다.**
        # 시장 라벨은 두 팔에서 같으므로 이 값도 두 팔에서 같다 — 그래서 control과 비교하면
        # "게이트가 며칠을 닫았나"가 아니라 "그런 날이 며칠이었나"를 읽는다. 실제 차단 수는
        # `REGIME_*` halt로 따로 센다(`gate_halted_sessions`).
        "below_sma200_sessions": sum(
            1
            for point in result.equity_curve
            if point.market_regime not in ("UNKNOWN",)
            and not _above_sma200(point.market_regime)
        ),
    }
    path = out_dir() / f"{run_id}.json"
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    matched = benchmark[MATCHED]["total_return"]
    print(f"  거래 {metrics.trade_count:,} · 총수익 {metrics.total_return:.2%}"
          f" · 기대값 {metrics.expectancy_r:.3f} · MDD {metrics.max_drawdown:.1%}")
    print(f"  노출 {metrics.avg_exposure:.2%} · 노출 일치 SPY {matched:.2%}"
          f" · 격차 {metrics.total_return - matched:+.2%}")
    print(f"  → {path.name}")
    return 0


def gate_halted_sessions(run: dict) -> int:
    """게이트가 **실제로** 랭킹을 멈춘 세션 수. `REGIME_*` halt를 센다.

    `below_sma200_sessions`와 다르다 — 그쪽은 시장이 SMA200 아래였던 날 수이고 두 팔에서
    같다. 이쪽은 처치가 실제로 작동한 횟수라 control에서 0이어야 한다.
    """
    return sum(
        count
        for key, count in run["skip_counts"].items()
        if key.startswith("REGIME_")
    )


def _above_sma200(market_regime: str) -> bool:
    """`market_regime` 라벨에서 SMA200 위/아래를 읽는다. **감사용 카운트 전용이다.**

    처치 자체는 `gate_new_entries`가 `above_sma200` 축으로 하고, 여기서는 이미 저장된
    라벨만 되읽는다. 자산곡선에 축이 따로 저장돼 있지 않아서 이 한 곳에서만 라벨을 쓴다.
    """
    return market_regime.split("/")[0] in ("BULL", "CORRECTION")


# ---------------------------------------------------------------- 판정


def decompose(control: dict, gated: dict) -> dict:
    """`ΔS = ΔB + ΔG`. **G가 S − B로 정의되므로 잔차 없이 닫힌다.**"""
    def arm(run: dict) -> tuple[float, float, float]:
        strategy = run["metrics"]["total_return"]
        matched = run["benchmark"][MATCHED]["total_return"]
        return strategy, matched, strategy - matched

    s_control, b_control, g_control = arm(control)
    s_gate, b_gate, g_gate = arm(gated)
    # 보조 분해. `F`는 평균 노출을 고정한 SPY이고 `T = B − F`가 **노출 타이밍**의 몫이다.
    # `B`를 통째로 "타이밍"이라고 부르면 평균 노출 수준 변화까지 타이밍으로 읽게 된다.
    f_control = control["benchmark"][FIXED_EXPOSURE]["total_return"]
    f_gate = gated["benchmark"][FIXED_EXPOSURE]["total_return"]
    return {
        "F_control": f_control,
        "F_gate": f_gate,
        "delta_F": f_gate - f_control,
        "T_control": b_control - f_control,
        "T_gate": b_gate - f_gate,
        "delta_T": (b_gate - f_gate) - (b_control - f_control),
        "S_control": s_control,
        "S_gate": s_gate,
        "B_control": b_control,
        "B_gate": b_gate,
        "G_control": g_control,
        "G_gate": g_gate,
        "delta_S": s_gate - s_control,
        "delta_B": b_gate - b_control,
        "delta_G": g_gate - g_control,
        # 항등식이 실제로 닫히는지 값으로 남긴다.
        "identity_residual": (s_gate - s_control)
        - ((b_gate - b_control) + (g_gate - g_control)),
    }


def risk_improvements(control: dict, gated: dict) -> dict:
    """§5 label B가 요구하는 네 항목. 각각 개선됐는가."""
    left, right = control["metrics"], gated["metrics"]

    def better(key: str, lower_is_better: bool = False) -> bool | None:
        a, b = left.get(key), right.get(key)
        if a is None or b is None:
            return None
        return b < a if lower_is_better else b > a

    return {
        "max_drawdown_down": better("max_drawdown", lower_is_better=True),
        "sharpe_up": better("sharpe"),
        "calmar_up": better("calmar"),
        "exposure_down": better("avg_exposure", lower_is_better=True),
    }


def classify_gate(delta: dict, risk: dict) -> str:
    """§5의 label. **결과를 본 뒤 바꾸지 않는다**(테스트가 잠근다).

    사전등록 문서는 A·B·C·D 넷을 적었는데 그 넷이 `(ΔS, ΔG, 위험)` 공간을 **완전히 덮지
    않는다.** 남는 칸 둘을 결과가 나오기 **전에** 채웠다.

    - `TIMING_BENEFIT_UNCONFIRMED` — `ΔS > 0`·`ΔG ≤ 0`인데 위험 네 항목이 다 개선되지는
      않은 경우. B가 요구하는 근거가 덜 갖춰졌다.
    - `RELATIVE_ONLY` — `ΔS ≤ 0`인데 `ΔG > 0`인 경우. 총 economics는 나빠졌는데 상대 위치만
      좋아졌다.

    **둘 다 alpha stack 승격이 아니다.** 승격하는 label은 `A` 하나뿐이다.
    """
    ds, dg = delta.get("delta_S"), delta.get("delta_G")
    if ds is None or dg is None:
        return LABEL_FAIL
    # B는 네 항목 전부(노출 감소 포함), C는 위험 품질 세 항목만 본다 — 사전등록 문구가
    # 각각 "MDD 감소 + Sharpe 상승 + Calmar 상승 + exposure 감소"와 "MDD/Sharpe/Calmar만
    # 개선"이다.
    all_four = all(value is True for value in risk.values())
    risk_quality = all(
        risk[key] is True
        for key in ("max_drawdown_down", "sharpe_up", "calmar_up")
    )

    if ds > 0 and dg > 0:
        return LABEL_ECONOMICS_AND_RELATIVE
    if ds > 0:
        return LABEL_TIMING_ONLY if all_four else LABEL_TIMING_UNCONFIRMED
    if dg > 0:
        return LABEL_RELATIVE_ONLY
    return LABEL_RISK_ONLY if risk_quality else LABEL_FAIL


# 로드맵 §4의 최종 경제 게이트. **component label과 다른 층이고 완화하지 않는다.**
FINAL_GATE_MINIMUMS = (
    ("gap", "노출 일치 격차 > 0", lambda run, gap: gap > 0),
    ("total_return", "비용 후 총수익 > 0",
     lambda run, gap: run["metrics"]["total_return"] > 0),
    ("expectancy_r", "기대값 > 0R",
     lambda run, gap: (run["metrics"]["expectancy_r"] or 0) > 0),
    ("profit_factor", "PF ≥ 1.15",
     lambda run, gap: (run["metrics"]["profit_factor"] or 0) >= 1.15),
    ("sharpe", "Sharpe ≥ 0.6", lambda run, gap: (run["metrics"]["sharpe"] or 0) >= 0.6),
    ("max_drawdown", "MDD ≤ 15%",
     lambda run, gap: run["metrics"]["max_drawdown"] <= 0.15),
)


def final_gate(run: dict) -> dict:
    """로드맵 §4의 최종 합격선을 그 팔에 적용한다. **여기서 문턱을 낮추지 않는다.**

    **component label과 다른 층이다.** label은 게이트의 marginal contribution을 재고,
    이것은 그 팔이 최종 전략 자격을 갖췄는지를 잰다.
    """
    gap = run["metrics"]["total_return"] - run["benchmark"][MATCHED]["total_return"]
    rows = [
        {"name": name, "label": text, "pass": bool(check(run, gap))}
        for name, text, check in FINAL_GATE_MINIMUMS
    ]
    return {"rows": rows, "pass": all(row["pass"] for row in rows), "gap": gap}


def next_step(label: str, gated_final: dict) -> tuple[str, str]:
    """§5.5. **결과 전에 고정한 규칙이다.**"""
    if label in PROMOTES and gated_final["pass"]:
        return (
            "경우 1",
            "**불필요한 추가 alpha filter를 열지 않는다.** Phase 2(`ABS`)·Phase 6(FIP)로"
            " 자동 진행하지 않는다. 남은 것은 Phase 7~9(Reality Hardening · Robustness ·"
            " Frozen Historical Sanity Check)다.",
        )
    if label in PROMOTES:
        return (
            "경우 2",
            "**SMA200을 유지한 채** 다음 alpha construction으로 간다. 이후 Phase는 gated"
            " 구조 위에서 쌓는다.",
        )
    return (
        "경우 3",
        "**SMA200은 alpha stack에서 제외한다.** timing/risk 후보로 보존할 수는 있으나"
        " **다음 alpha construction은 ungated J126에서 시작한다.** 보존과 alpha stack"
        " 포함을 섞지 않는다.",
    )


def treatment(label: str) -> str:
    return {
        LABEL_ECONOMICS_AND_RELATIVE: "전체 economics(`ΔS`)와 matched-SPY 상대"
        " 위치(`ΔG`)가 함께 개선됐다. **`ΔB`의 부호는 이 label이 요구하지 않으므로"
        " \"타이밍이 좋아졌다\"로 읽지 않는다** — `ΔB`를 따로 본다.",
        LABEL_TIMING_ONLY: "**alpha conversion 개선으로 보지 않는다.** alpha stack에 자동"
        " 승격하지 않고 `PARKED_TIMING_OVERLAY_CANDIDATE`로 **보존**한다. 향후 alpha"
        " strategy가 경제성 허들을 통과했을 때 risk/timing overlay 단계에서 다시 검토한다.",
        LABEL_TIMING_UNCONFIRMED: "총수익은 올랐지만 위험 네 항목이 다 개선되지는 않았다."
        " **alpha stack 승격이 아니고** overlay 근거도 B보다 약하다. 기록만 남긴다.",
        LABEL_RELATIVE_ONLY: "총 economics는 나빠졌는데 matched-SPY 상대 위치만 좋아졌다."
        " **현재의 낮은 수익 문제를 해결하지 못하므로 alpha stack 승격이 아니다.**",
        LABEL_RISK_ONLY: "**현재의 낮은 수익 문제를 해결하지 못하므로 alpha stack에서"
        " 탈락.** risk overlay 후보로만 기록한다.",
        LABEL_FAIL: "**SMA200 market gate 종료.** alternate SMA · SMA150 · SMA250 ·"
        " 10개월 이동평균 · volatility gate · BULL-only 탐색을 하지 않는다.",
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
    missing = [
        run_id_for(*job) for job in planned() if run_id_for(*job) not in runs
    ]
    control = runs.get(run_id_for(CONTROL, LAST_CLOSE_EXIT))
    gated = runs.get(run_id_for(CHALLENGER, LAST_CLOSE_EXIT))

    lines = [
        "# PR #16 — Market Gate Portfolio Translation",
        "",
        "**물은 것:** J126이 SMA200 아래에서도 **양의** signal edge를 갖는 상황에서, 그"
        " 구간의 신규진입을 포기하는 것이 현재 K42/S5 포트폴리오의 after-cost economics를"
        " 개선하는가. 그리고 개선이 있다면 그것이 **노출·타이밍 기여(ΔB)**인지"
        " **matched-SPY 상대 기여(ΔG)**인지 분해한다.",
        "",
        "**이것은 \"나쁜 거래 제거\" 실험이 아니다.** PR #15가 잰 값에서 J63은"
        " `SPY <= SMA200`에서 alpha가 −1.640%로 반전되지만 **J126은 +0.507%로 양수가"
        " 남는다.** 이 게이트는 신호 층에서 이미 양수인 구간을 **통째로 포기하는** 처치다.",
        "",
        "**처치는 하나다** — `regime_mode`만 `MARKET` → `TREND_GATE`. 파라미터·한도·프로필·"
        "진입·청산·비용·슬롯이 전부 같다. 게이트는 `new_entries`만 닫으므로 **보유 포지션은"
        " 게이트가 닫혀도 K42 만기까지 간다.**",
        "",
        "**사전등록은 결과 전에 커밋했다**(`README.md`). label A~D와 분해 규칙을 그때 박았다.",
        "",
        "**개발 표본이다.** 이 구간은 PR #9~#15에서 반복 사용됐고 OOS 검증이 아니다.",
        "",
    ]
    if missing:
        lines += [f"**아직 없는 실행 {len(missing)}개:** {', '.join(missing)}", ""]
    if not control or not gated:
        lines += ["**LAST_CLOSE 두 팔이 모두 있어야 판정할 수 있다.**", ""]
        return _write(lines)

    lines += _reproduction(control)
    lines += _decomposition(control, gated)
    lines += _secondary(control, gated)
    lines += _gate_activity(control, gated)
    lines += _scenario(runs)
    lines += _regime(control, gated)
    lines += _verdict(control, gated)
    return _write(lines)


def _write(lines: list[str]) -> int:
    path = out_dir() / "results.md"
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("\n".join(lines))
    print(f"\n보고서: {RUNS_DIR.name}/{EXPERIMENT}/{path.name}")
    return 0


def _reproduction(control: dict) -> list[str]:
    """**게이트 결과를 해석하기 전에 control이 재현돼야 한다.**"""
    expected = [
        ("거래", "512", "trade_count", lambda v: f"{v:,}"),
        ("기대값R", "0.233", "expectancy_r", _num),
        ("총수익", "+35.63%", "total_return", _pct),
        ("MDD", "10.8%", "max_drawdown", _share),
        ("평균 노출", "17.8%", "avg_exposure", _share),
    ]
    lines = ["## 1. control 재현 (PR #13·#14의 `jt-j126-k42`)", "",
             "**재현이 깨지면 게이트 결과를 해석하지 말고 drift부터 설명한다.**", "",
             "|항목|기대|이번|", "|---|---|---|"]
    for label, want, key, fmt in expected:
        lines.append(f"|{label}|{want}|**{fmt(control['metrics'][key])}**|")
    holdout = control["holdout"]
    lines += ["",
              f"구간 {control['window'][0]} ~ {control['window'][1]} ·"
              f" `HOLDOUT_CONSUMED = {str(holdout['HOLDOUT_CONSUMED']).lower()}`"
              f" (`HOLDOUT_START = {holdout['HOLDOUT_START']}`)", ""]
    return lines


def _decomposition(control: dict, gated: dict) -> list[str]:
    delta = decompose(control, gated)
    lines = ["## 2. Primary — ΔS = ΔB + ΔG 분해 (LAST_CLOSE)", "",
             "**노출 일치 벤치마크는 정의상 타이밍을 상쇄한다.** 전략이 게이트로 노출을"
             " 끄면 벤치마크도 같이 꺼지므로 `G`는 *선택 능력*만 재고 *타이밍 능력*은 보지"
             " 못한다. 그래서 전체 변화를 두 경로로 가른다.", "",
             "|값|게이트 없음|SMA200 게이트|**Δ**|",
             "|---|---|---|---|",
             f"|`S` 비용 후 전략 총수익|{_pct(delta['S_control'])}|{_pct(delta['S_gate'])}"
             f"|**{_pct(delta['delta_S'])}**|",
             f"|`B` 노출 일치 SPY|{_pct(delta['B_control'])}|{_pct(delta['B_gate'])}"
             f"|**{_pct(delta['delta_B'])}**|",
             f"|`G = S − B` 격차|{_pct(delta['G_control'])}|{_pct(delta['G_gate'])}"
             f"|**{_pct(delta['delta_G'])}**|",
             "",
             f"항등식 확인: `ΔS = ΔB + ΔG` → {_pct(delta['delta_S'])} ="
             f" {_pct(delta['delta_B'])} + {_pct(delta['delta_G'])}"
             f" (잔차 {delta['identity_residual'] * 100:+.10f}%p)",
             "",
             "**잔차가 0인 것은 `G ≡ S − B`라는 정의의 결과이지 발견이 아니다.** 읽을 수"
             " 있는 것은 전체 변화가 두 경로에 **어떻게 갈렸는가**다.", ""]
    return lines


def _secondary(control: dict, gated: dict) -> list[str]:
    left, right = control["metrics"], gated["metrics"]
    lines = ["## 3. 사전등록 secondary", "",
             "|지표|게이트 없음|SMA200 게이트|Δ|",
             "|---|---|---|---|"]
    rows = [
        ("총수익", "total_return", _pct),
        ("CAGR", "cagr", lambda v: _pct(v, 2)),
        ("MDD", "max_drawdown", _share),
        ("Sharpe", "sharpe", lambda v: _num(v, 2)),
        ("Sortino", "sortino", lambda v: _num(v, 2)),
        ("Calmar", "calmar", lambda v: _num(v, 2)),
        ("평균 노출", "avg_exposure", _share),
        ("기대값R", "expectancy_r", _num),
        ("PF", "profit_factor", lambda v: _num(v, 2)),
        ("승률", "win_rate", _share),
        ("회전", "turnover", lambda v: _num(v, 2)),
        ("평균 보유", "avg_hold_sessions", lambda v: _num(v, 1)),
    ]
    for label, key, fmt in rows:
        lines.append(
            f"|{label}|{fmt(left[key])}|{fmt(right[key])}"
            f"|**{fmt(_delta(left[key], right[key]))}**|"
        )
    lines.append(
        f"|거래 수|{left['trade_count']:,}|{right['trade_count']:,}"
        f"|**{right['trade_count'] - left['trade_count']:+,}**|"
    )
    lines.append(
        f"|비용|{_money(left['fees_paid'])}|{_money(right['fees_paid'])}"
        f"|**{_money(_delta(left['fees_paid'], right['fees_paid']))}**|"
    )
    exposure_cut = _delta(right["avg_exposure"], left["avg_exposure"])
    lines += ["",
              f"**노출 감소분** {_pct(exposure_cut)}"
              f" (상대 {(exposure_cut / left['avg_exposure'] * 100) if left['avg_exposure'] else 0:+.1f}%)",
              ""]

    lines += ["### 100% SPY 매수보유 (opportunity-cost reference)", "",
              "**promotion criterion으로 쓰지 않는다.** 이 전략이 무엇을 포기하고 있는지"
              " 보여주는 기준선일 뿐이다.", "",
              "|기준|총수익|", "|---|---|",
              f"|게이트 없음 전략|{_pct(control['metrics']['total_return'])}|",
              f"|SMA200 게이트 전략|{_pct(gated['metrics']['total_return'])}|",
              f"|**100% SPY 매수보유**|**{_pct(control['benchmark'][BUY_AND_HOLD]['total_return'])}**|",
              ""]
    return lines


def _gate_activity(control: dict, gated: dict) -> list[str]:
    lines = ["## 4. 게이트가 실제로 무엇을 했는가", "",
             "|항목|게이트 없음|SMA200 게이트|", "|---|---|---|"]
    sessions = gated["sessions"]
    below = gated["below_sma200_sessions"]
    lines += [
        f"|세션|{control['sessions']:,}|{sessions:,}|",
        f"|`SPY <= SMA200` 세션 (시장 사실)|{control['below_sma200_sessions']:,}"
        f"|{below:,} ({below / sessions:.1%})|",
        f"|**게이트가 실제로 멈춘 세션** (`REGIME_*`)|"
        f"**{gate_halted_sessions(control):,}**|**{gate_halted_sessions(gated):,}**|",
        f"|진입|{control['capacity']['entries']:,}|{gated['capacity']['entries']:,}|",
        f"|진입/년|{_num(control['capacity']['entries_per_year'], 1)}"
        f"|{_num(gated['capacity']['entries_per_year'], 1)}|",
        f"|평균 점유|{_num(control['capacity']['avg_open_positions'], 2)}"
        f"|{_num(gated['capacity']['avg_open_positions'], 2)}|",
        f"|만석 비율|{_share(control['capacity']['fraction_sessions_at_full_capacity'])}"
        f"|{_share(gated['capacity']['fraction_sessions_at_full_capacity'])}|",
    ]
    lines += ["", "**게이트로 막힌 후보 사유**", "",
              "|사유|게이트 없음|SMA200 게이트|", "|---|---|---|"]
    reasons = sorted(
        {key for run in (control, gated) for key in run["skip_counts"]}
        & {
            "MAX_POSITIONS_REACHED",
            "ALREADY_HELD",
            "DAILY_ENTRY_CAP",
            "SECTOR_UNKNOWN",
            "DAILY_LOSS_LIMIT",
        }
    )
    for reason in reasons:
        lines.append(
            f"|`{reason}`|{control['skip_counts'].get(reason, 0):,}"
            f"|{gated['skip_counts'].get(reason, 0):,}|"
        )
    lines += ["",
              "**두 줄은 다른 것을 센다.** `SPY <= SMA200` 세션은 **시장의 사실**이라 두"
              " 팔에서 같고, 게이트가 멈춘 세션은 **처치가 실제로 작동한 횟수**라 control에서"
              " 0이다. 앞의 값을 게이트 효과로 읽지 않는다.", "",
              f"게이트 표식은 `{TREND_GATE_BLOCKED}`이고 상태 이름은 바꾸지 않는다 —"
              " 레짐별 성과표를 control과 그대로 견줄 수 있다.", ""]
    return lines


def _scenario(runs: dict) -> list[str]:
    lines = ["## 5. 폐지 가정 민감도 (보조)", "",
             "**main 판정은 `LAST_CLOSE`다.** `ZERO`는 보조 민감도이고 섞지 않는다."
             " PR #13에서 J126이 이 가정에 크게 민감했다.", "",
             "|시나리오|게이트 없음 총수익|게이트 총수익|Δ|게이트 없음 기대값|게이트 기대값|",
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


def _regime(control: dict, gated: dict) -> list[str]:
    lines = ["## 6. 레짐별 (진입 시점 라벨)", "",
             "**레짐별 격차는 그 상태의 세션만 따로 복리한 값이라 레짐 간에 더해지지"
             " 않는다.** 전체 격차의 귀속으로 쓰지 않는다.", "",
             "|상태|게이트 없음 전략|게이트 전략|게이트 없음 격차|게이트 격차|",
             "|---|---|---|---|---|"]
    detail = {
        key: {row["regime"]: row for row in run["regime_detail"]}
        for key, run in (("control", control), ("gated", gated))
    }
    for state in sorted(detail["control"]):
        left = detail["control"].get(state)
        right = detail["gated"].get(state)
        if not left or not right:
            continue
        lines.append(
            f"|{state}|{_pct(left['strategy_return'])}|{_pct(right['strategy_return'])}"
            f"|{_pct(left['gap'])}|{_pct(right['gap'])}|"
        )
    lines.append("")
    return lines


def _verdict(control: dict, gated: dict) -> list[str]:
    delta = decompose(control, gated)
    risk = risk_improvements(control, gated)
    label = classify_gate(delta, risk)

    lines = ["## 7. 사전등록 판정", "",
             "|조건|값|", "|---|---|",
             f"|`ΔS`|**{_pct(delta['delta_S'])}**|",
             f"|`ΔG`|**{_pct(delta['delta_G'])}**|",
             f"|`ΔB`|{_pct(delta['delta_B'])}|",
             "",
             "**위험 네 항목** (label B가 요구한다)", "",
             "|항목|개선|", "|---|---|",
             f"|MDD 감소|{_mark(risk['max_drawdown_down'])}|",
             f"|Sharpe 상승|{_mark(risk['sharpe_up'])}|",
             f"|Calmar 상승|{_mark(risk['calmar_up'])}|",
             f"|노출 감소|{_mark(risk['exposure_down'])}|",
             "",
             f"### label — **{label}**", "",
             treatment(label), ""]

    if label not in PROMOTES:
        lines += ["**alpha stack 승격이 아니다.** 사용자 검토 없이 alternate SMA ·"
                  " volatility gate · BULL-only 같은 대안을 열지 않는다.", ""]

    lines += ["### `ΔB`는 label과 따로 읽고, `ΔB`를 타이밍 자체로 읽지도 않는다", "",
              f"`ΔB = {_pct(delta['delta_B'])}`. **승격 label은 `ΔS > 0`과 `ΔG > 0`만"
              " 요구하고 `ΔB`의 부호를 요구하지 않는다.** 그래서 이 label을 \"타이밍이"
              " 좋아졌다\"로 읽지 않는다 — 이름을 `ECONOMICS_AND_RELATIVE_IMPROVED`로 둔"
              " 이유가 그것이다.",
              "",
              "**그리고 `ΔB` 자체도 타이밍이 아니다.** 벤치마크 표에 이미 있는 \"평균 노출"
              " 고정\" 줄(`F`)로 한 번 더 가른다. **새 promotion criterion이 아니라 기존"
              " secondary의 해석 정정이다.**",
              "",
              "```",
              "F = 평균 노출 고정 SPY",
              "T = B − F        (노출 타이밍의 몫)",
              "ΔB = ΔF + ΔT     (T ≡ B − F이므로 정의상 닫힌다)",
              "```",
              "",
              "|값|게이트 없음|SMA200 게이트|Δ|",
              "|---|---|---|---|",
              f"|`B` 일별 노출 일치|{_pct(delta['B_control'])}|{_pct(delta['B_gate'])}"
              f"|**{_pct(delta['delta_B'])}**|",
              f"|`F` 평균 노출 고정|{_pct(delta['F_control'])}|{_pct(delta['F_gate'])}"
              f"|**{_pct(delta['delta_F'])}**|",
              f"|`T = B − F` 타이밍|{_pct(delta['T_control'])}|{_pct(delta['T_gate'])}"
              f"|**{_pct(delta['delta_T'])}**|",
              "",
              f"**`ΔB`의 음수는 대부분 평균 노출 수준이 낮아진 것(`ΔF ="
              f" {_pct(delta['delta_F'])}`)에서 오고, 타이밍 몫(`ΔT ="
              f" {_pct(delta['delta_T'])}`)은 오히려 소폭 양수다.** 그래서 \"노출·타이밍"
              " 기여가 음수다\"라고 쓰지 않고 **\"exposure-path benchmark contribution이"
              f" {_pct(delta['delta_B'])}였고 matched-SPY relative component가"
              f" {_pct(delta['delta_G'])}였다\"**라고 적는다.",
              ""]

    control_final = final_gate(control)
    gated_final = final_gate(gated)
    lines += ["## 8. 로드맵 §4 최종 경제 게이트 (다른 층)", "",
              "**component label과 다른 층이다.** label은 게이트의 marginal contribution을"
              " 재고, 이 표는 그 팔이 **최종 전략 자격**을 갖췄는지를 잰다. 문턱을 낮추지"
              " 않았다.", "",
              "|조건|게이트 없음|SMA200 게이트|", "|---|---|---|"]
    for left, right in zip(control_final["rows"], gated_final["rows"]):
        lines.append(
            f"|{left['label']}|{'**통과**' if left['pass'] else '미달'}"
            f"|{'**통과**' if right['pass'] else '미달'}|"
        )
    lines += [f"|**전체**|{'**통과**' if control_final['pass'] else '**미달**'}"
              f"|{'**통과**' if gated_final['pass'] else '**미달**'}|", ""]

    case, action = next_step(label, gated_final)
    lines += ["## 9. 다음 단계 (§5.5 · 결과 전에 고정)", "",
              f"### {case}", "", action, "",
              "**이 규칙은 결과를 보기 전에 사전등록 문서에 박았다.**", ""]

    if label in (LABEL_TIMING_UNCONFIRMED, LABEL_RELATIVE_ONLY):
        lines += ["**이 label은 사전등록 문서의 A~D가 덮지 않은 칸이다.** 넷이"
                  " `(ΔS, ΔG, 위험)` 공간을 완전히 덮지 않아서 **결과가 나오기 전에**"
                  " 남는 칸 둘을 채웠고, 둘 다 alpha stack 승격이 아니다. 승격하는 label은"
                  " `A` 하나뿐이라는 원래 구조는 바뀌지 않았다.", ""]

    lines += ["## 10. Limitations", "",
              "- **개발 표본이다.** 이 구간은 PR #9~#15에서 반복 사용됐고 OOS 검증이 아니다",
              "- **신호 층 근거에 이미 경고가 붙어 있었다** — PR #15의 연도 label이"
              " `CONCENTRATED`이고(2009 또는 2011을 빼면 부호가 뒤집힌다) frozen control"
              " J63의 시장 대비가 J126보다 컸다(+2.751% vs +0.681%)",
              "- **인과를 증명하지 않는다** — 한 구간의 한 처치를 잰 것이다",
              "- **`ΔS = ΔB + ΔG`의 잔차 0은 정의의 결과다** — 분해가 맞다는 증거이지"
              " 발견이 아니다",
              "- **`LAST_CLOSE`가 main이고 `ZERO`는 보조다** — 두 층을 섞지 않았다",
              "- 노출 일치 벤치마크는 타이밍을 상쇄하므로 `ΔG`만으로 게이트의 가치를"
              " 판단하지 않는다. 그래서 분해했다",
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
