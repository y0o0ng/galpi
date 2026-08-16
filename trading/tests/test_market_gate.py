"""PR #16 시장 게이트의 처치와 사전등록 판정.

**가장 중요한 것은 셋이다.**

1. `TreatmentTest` — 처치가 정확히 하나다. `regime_mode` 말고는 control과 같아야 한다.
2. `GateSemanticsTest` — 게이트가 **신규 진입만** 막는다. 익스포저 상한도 상태 이름도
   청산도 건드리지 않는다. 건드리면 두 실행의 차이를 진입 타이밍에 귀속할 수 없다.
3. `RegressionTest` — 기존 `MARKET`·`CORE` 모드의 동작이 그대로다. 새 모드를 더하면서
   기존 실행이 바뀌면 PR #10~#15의 결과가 전부 비교 불가가 된다.
"""

from __future__ import annotations

import json
import sys
import unittest
from dataclasses import fields, replace
from pathlib import Path

TRADING_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TRADING_ROOT))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import test_loop  # noqa: E402
from backtest.loop import run_backtest  # noqa: E402
from backtest.modes import (  # noqa: E402
    CORE_REGIME,
    MARKET_REGIME,
    REGIME_MODES,
    TREND_GATE_REGIME,
)
from backtest.regime import (  # noqa: E402
    TREND_GATE_BLOCKED,
    Regime,
    gate_new_entries,
    market_trend,
)
from core import CORES  # noqa: E402
from core.definition import RULE_FIELDS  # noqa: E402
from selftest.market_gate_run import (  # noqa: E402
    ARMS,
    CHALLENGER,
    CONTROL,
    GATE_LABELS,
    LABEL_ECONOMICS_AND_RELATIVE,
    LABEL_FAIL,
    LABEL_RELATIVE_ONLY,
    LABEL_RISK_ONLY,
    LABEL_TIMING_ONLY,
    LABEL_TIMING_UNCONFIRMED,
    PROMOTES,
    classify_gate,
    decompose,
    planned,
    risk_improvements,
    run_id_for,
)


def _regime(above: bool) -> Regime:
    trend = "BULL" if above else "BEAR"
    return Regime(
        state=f"{trend}/LOW_VOL",
        max_exposure=1.0,
        new_entries="allow",
        above_sma200=above,
        below_sma200_streak=0,
        realized_vol20=0.1,
        drawdown=0.0,
        reasons=(trend, "LOW_VOL"),
        trend=trend,
        volatility="LOW_VOL",
    )


class GateSemanticsTest(unittest.TestCase):
    """**게이트는 `new_entries` 하나만 바꾼다.**"""

    def test_above_sma200_is_untouched(self):
        regime = _regime(above=True)
        self.assertIs(gate_new_entries(regime), regime)

    def test_below_sma200_blocks_new_entries(self):
        gated = gate_new_entries(_regime(above=False))
        self.assertEqual(gated.new_entries, "blocked")

    def test_nothing_else_changes(self):
        """익스포저 상한·상태 이름·추세·변동성이 그대로여야 레짐표를 견줄 수 있다."""
        regime = _regime(above=False)
        gated = gate_new_entries(regime)
        for field in fields(Regime):
            if field.name in ("new_entries", "reasons"):
                continue
            self.assertEqual(
                getattr(regime, field.name), getattr(gated, field.name), field.name
            )

    def test_the_block_is_recorded_as_a_reason_not_a_state_name(self):
        """상태 이름을 바꾸면 레짐별 성과표가 `MARKET` 실행과 견줄 수 없게 된다."""
        gated = gate_new_entries(_regime(above=False))
        self.assertIn(TREND_GATE_BLOCKED, gated.reasons)
        self.assertNotIn(TREND_GATE_BLOCKED, gated.state)

    def test_the_gate_reads_the_axis_not_the_label(self):
        """`above_sma200`을 본다. 라벨 문자열을 파싱하면 분류기를 바꿀 때 조용히 틀린다."""
        for close, fast, slow in (
            (110.0, 105.0, 100.0),  # BULL
            (110.0, 120.0, 100.0),  # CORRECTION
            (95.0, 90.0, 100.0),  # RECOVERY
            (95.0, 100.0, 100.0),  # BEAR
            (100.0, 100.0, 100.0),  # 경계 — SMA200과 같으면 막는다
        ):
            trend = market_trend(close, fast, slow)
            regime = replace(_regime(above=close > slow), state=f"{trend}/LOW_VOL",
                             trend=trend)
            gated = gate_new_entries(regime)
            expected = "allow" if close > slow else "blocked"
            self.assertEqual(gated.new_entries, expected, (close, slow))

    def test_a_blocked_regime_allows_zero_daily_entries(self):
        """`max_daily_entries`가 이름이 아니라 `new_entries`를 본다는 것을 확인한다."""
        parameters = CORES[CONTROL].policy.parameters
        self.assertEqual(parameters.max_daily_entries("blocked"), 0)
        self.assertGreater(parameters.max_daily_entries("allow"), 0)


class TreatmentTest(unittest.TestCase):
    """**처치는 정확히 하나다.**"""

    def test_the_only_rule_difference_is_the_regime_mode(self):
        control, gated = CORES[CONTROL], CORES[CHALLENGER]
        different = [
            field
            for field in RULE_FIELDS
            if control.run_kwargs()[field] != gated.run_kwargs()[field]
        ]
        # `policy`는 인스턴스가 달라 값 비교로는 다르게 나온다. 아래에서 내용이 같은지 본다.
        self.assertEqual(sorted(different), ["policy", "regime_mode"])
        self.assertEqual(control.regime_mode, MARKET_REGIME)
        self.assertEqual(gated.regime_mode, TREND_GATE_REGIME)

    def test_parameters_limits_and_profile_are_identical(self):
        """`policy_id`만 다르다. 값이 하나라도 갈리면 처치가 둘이 된다."""
        control, gated = CORES[CONTROL].policy, CORES[CHALLENGER].policy
        self.assertEqual(control.parameters, gated.parameters)
        self.assertEqual(control.limits, gated.limits)
        self.assertEqual(control.profile, gated.profile)
        self.assertNotEqual(control.policy_id, gated.policy_id)

    def test_every_behaviour_rule_is_identical_except_the_regime_mode(self):
        """**행동을 바꾸는 것은 `regime_mode` 하나뿐이어야 한다.**

        `policy_id`와 서명은 **감사 identity**라 달라도 되고 달라야 한다(홀드아웃 계수기가
        둘을 구분해야 한다). 그러나 실행 동작을 정하는 값은 하나도 갈리면 안 된다 —
        갈리면 결과 차이를 게이트에 귀속할 수 없다.
        """
        control, gated = CORES[CONTROL], CORES[CHALLENGER]

        # 정책 안쪽 — 서명이 덮는 값 중 `policy_id`를 뺀 전부.
        for attribute in ("broker_mode", "strategy_version", "approved_by"):
            self.assertEqual(
                getattr(control.policy, attribute),
                getattr(gated.policy, attribute),
                attribute,
            )
        self.assertEqual(control.policy.profile, gated.policy.profile)
        self.assertEqual(control.policy.limits, gated.policy.limits)
        self.assertEqual(control.policy.parameters, gated.policy.parameters)

        # 정책 바깥 — 서명 밖의 실행 모드.
        for attribute in (
            "entry_mode",
            "exit_mode",
            "require_earnings_calendar",
            "require_sector",
        ):
            self.assertEqual(
                getattr(control, attribute), getattr(gated, attribute), attribute
            )

        # 그리고 `canonical_text`에서 실제로 다른 키가 `policy_id` 하나인지 확인한다.
        left = json.loads(control.policy.canonical_text)
        right = json.loads(gated.policy.canonical_text)
        self.assertEqual(
            [key for key in left if left[key] != right[key]], ["policy_id"]
        )

    def test_the_signature_differs_so_the_holdout_counter_can_tell_them_apart(self):
        """**서명을 공유하면 `record_holdout_run`이 둘을 같은 행으로 덮어쓴다.**

        로드맵 §7 C3-1이 적어둔 구멍이다. 계수기가 구간 단위로 세고 `run_id`에 서명을
        넣으므로, 두 코어가 같은 서명이면 control과 challenger가 구분되지 않는다.
        """
        self.assertNotEqual(CORES[CONTROL].signature, CORES[CHALLENGER].signature)

    def test_the_formation_horizon_is_unchanged(self):
        """J를 재탐색하지 않는다. 둘 다 J126이어야 한다."""
        for name in ARMS:
            self.assertEqual(CORES[name].policy.parameters.rs_lookback, 126)
            self.assertEqual(CORES[name].policy.parameters.rs_skip, 5)

    def test_hold_and_slots_are_unchanged(self):
        for name in ARMS:
            self.assertEqual(CORES[name].policy.parameters.max_hold_sessions, 42)
            self.assertEqual(CORES[name].policy.limits.max_positions, 5)

    def test_exactly_four_runs(self):
        jobs = planned()
        self.assertEqual(len(jobs), 4)
        self.assertEqual({core for core, _ in jobs}, set(ARMS))
        self.assertEqual({scenario for _, scenario in jobs}, {"LAST_CLOSE", "ZERO"})

    def test_the_two_arms_never_share_an_output_file(self):
        self.assertNotEqual(
            run_id_for(CONTROL, "LAST_CLOSE"), run_id_for(CHALLENGER, "LAST_CLOSE")
        )
        self.assertNotEqual(
            run_id_for(CONTROL, "LAST_CLOSE"), run_id_for(CONTROL, "ZERO")
        )


class RegressionTest(unittest.TestCase):
    """**새 모드를 더하면서 기존 모드의 동작이 바뀌면 안 된다.**"""

    @classmethod
    def setUpClass(cls):
        cls.connection, cls.dates = test_loop.build()

    @classmethod
    def tearDownClass(cls):
        cls.connection.close()

    def config(self, regime_mode: str):
        core = CORES[CONTROL]
        return test_loop.config(
            self.dates,
            policy=core.policy,
            entry_mode=core.entry_mode,
            exit_mode=core.exit_mode,
            regime_mode=regime_mode,
            require_earnings_calendar=False,
        )

    def test_the_new_mode_is_registered(self):
        self.assertIn(TREND_GATE_REGIME, REGIME_MODES)
        self.assertEqual(
            set(REGIME_MODES), {CORE_REGIME, MARKET_REGIME, TREND_GATE_REGIME}
        )

    def test_market_mode_still_runs(self):
        result = run_backtest(self.connection, self.config(MARKET_REGIME))
        self.assertGreater(len(result.equity_curve), 0)

    def test_the_gate_never_produces_more_entries_than_the_control(self):
        """게이트는 진입을 **막기만** 한다. 늘리면 처치가 반대로 작동한 것이다."""
        control = run_backtest(self.connection, self.config(MARKET_REGIME))
        gated = run_backtest(self.connection, self.config(TREND_GATE_REGIME))
        control_entries = len(control.trades) + len(control.open_positions)
        gated_entries = len(gated.trades) + len(gated.open_positions)
        self.assertLessEqual(gated_entries, control_entries)

    def test_the_gate_leaves_the_market_label_alone(self):
        """자산곡선의 `market_regime`이 두 실행에서 같아야 레짐표를 견줄 수 있다."""
        control = run_backtest(self.connection, self.config(MARKET_REGIME))
        gated = run_backtest(self.connection, self.config(TREND_GATE_REGIME))
        self.assertEqual(
            [point.market_regime for point in control.equity_curve],
            [point.market_regime for point in gated.equity_curve],
        )

    def test_an_unknown_regime_mode_is_still_refused(self):
        with self.assertRaises(ValueError):
            test_loop.config(self.dates, regime_mode="TREND")


def _delta(ds: float, dg: float) -> dict:
    return {"delta_S": ds, "delta_G": dg, "delta_B": ds - dg}


def _risk(**changes) -> dict:
    base = {
        "max_drawdown_down": True,
        "sharpe_up": True,
        "calmar_up": True,
        "exposure_down": True,
    }
    base.update(changes)
    return base


class LabelTest(unittest.TestCase):
    """§5의 label. **결과를 본 뒤 바꾸지 않는다.**"""

    def test_a_needs_both_deltas_positive(self):
        self.assertEqual(
            classify_gate(_delta(0.05, 0.02), _risk()), LABEL_ECONOMICS_AND_RELATIVE
        )

    def test_a_is_the_only_promotion(self):
        """**승격하는 label은 하나뿐이다.**"""
        self.assertEqual(PROMOTES, frozenset({LABEL_ECONOMICS_AND_RELATIVE}))
        for label in GATE_LABELS:
            if label != LABEL_ECONOMICS_AND_RELATIVE:
                self.assertNotIn(label, PROMOTES, label)

    def test_b_requires_all_four_risk_improvements(self):
        self.assertEqual(
            classify_gate(_delta(0.05, -0.01), _risk()), LABEL_TIMING_ONLY
        )
        self.assertEqual(
            classify_gate(_delta(0.05, -0.01), _risk(exposure_down=False)),
            LABEL_TIMING_UNCONFIRMED,
        )
        self.assertEqual(
            classify_gate(_delta(0.05, -0.01), _risk(sharpe_up=False)),
            LABEL_TIMING_UNCONFIRMED,
        )

    def test_c_prime_is_relative_only(self):
        """총수익은 나빠졌는데 상대 위치만 좋아진 칸. **승격이 아니다.**"""
        self.assertEqual(
            classify_gate(_delta(-0.05, 0.02), _risk()), LABEL_RELATIVE_ONLY
        )

    def test_c_requires_the_three_risk_quality_metrics(self):
        self.assertEqual(
            classify_gate(_delta(-0.05, -0.02), _risk(exposure_down=False)),
            LABEL_RISK_ONLY,
        )
        self.assertEqual(
            classify_gate(_delta(-0.05, -0.02), _risk(calmar_up=False)), LABEL_FAIL
        )

    def test_d_is_no_improvement_anywhere(self):
        self.assertEqual(
            classify_gate(
                _delta(-0.05, -0.02),
                _risk(max_drawdown_down=False, sharpe_up=False, calmar_up=False,
                      exposure_down=False),
            ),
            LABEL_FAIL,
        )

    def test_zero_is_not_an_improvement(self):
        """`ΔS = 0`·`ΔG = 0`은 개선이 아니다. 부등호가 느슨해지면 문턱이 사라진다."""
        self.assertNotEqual(
            classify_gate(_delta(0.0, 0.0), _risk()), LABEL_ECONOMICS_AND_RELATIVE
        )
        self.assertNotEqual(
            classify_gate(_delta(0.05, 0.0), _risk()), LABEL_ECONOMICS_AND_RELATIVE
        )

    def test_a_missing_number_never_promotes(self):
        self.assertEqual(classify_gate({"delta_S": None, "delta_G": 0.1}, _risk()),
                         LABEL_FAIL)
        self.assertEqual(classify_gate({}, _risk()), LABEL_FAIL)

    def test_every_verdict_is_a_registered_label(self):
        for ds in (-0.05, 0.0, 0.05):
            for dg in (-0.05, 0.0, 0.05):
                for risk in (_risk(), _risk(sharpe_up=False),
                             _risk(max_drawdown_down=False, sharpe_up=False,
                                   calmar_up=False, exposure_down=False)):
                    self.assertIn(classify_gate(_delta(ds, dg), risk), GATE_LABELS)


# `(ΔS 부호, ΔG 부호, 위험)` 공간 전체. 부호는 음·영·양 셋이고 위험은 네 항목의 참거짓이라
# 3 × 3 × 16 = 144칸이다.
SIGNS = (-0.05, 0.0, 0.05)
RISK_KEYS = ("max_drawdown_down", "sharpe_up", "calmar_up", "exposure_down")
RISK_SPACE = tuple(
    {key: bool(index >> position & 1) for position, key in enumerate(RISK_KEYS)}
    for index in range(2 ** len(RISK_KEYS))
)


def _predicates(ds: float, dg: float, risk: dict) -> dict[str, bool]:
    """label 조건을 `classify_gate`와 **독립적으로** 다시 쓴 것.

    같은 코드를 두 번 부르면 분할을 확인하는 것이 아니라 자기 자신을 확인하게 된다.
    """
    all_four = all(risk[key] for key in RISK_KEYS)
    quality = all(risk[key] for key in ("max_drawdown_down", "sharpe_up", "calmar_up"))
    return {
        LABEL_ECONOMICS_AND_RELATIVE: ds > 0 and dg > 0,
        LABEL_TIMING_ONLY: ds > 0 and dg <= 0 and all_four,
        LABEL_TIMING_UNCONFIRMED: ds > 0 and dg <= 0 and not all_four,
        LABEL_RELATIVE_ONLY: ds <= 0 and dg > 0,
        LABEL_RISK_ONLY: ds <= 0 and dg <= 0 and quality,
        LABEL_FAIL: ds <= 0 and dg <= 0 and not quality,
    }


class PartitionTest(unittest.TestCase):
    """**label이 `(ΔS 부호, ΔG 부호, 위험)` 공간을 정확히 한 번씩 덮는다.**

    빈칸이 있으면 실제 결과가 거기 떨어졌을 때 사후에 label을 만들게 되고, 겹치는 칸이
    있으면 어느 label로 읽을지가 코드 순서에 달리게 된다. 둘 다 사전등록을 무의미하게 한다.
    """

    def test_every_cell_matches_exactly_one_label(self):
        for ds in SIGNS:
            for dg in SIGNS:
                for risk in RISK_SPACE:
                    with self.subTest(ds=ds, dg=dg, risk=risk):
                        matched = [
                            label
                            for label, holds in _predicates(ds, dg, risk).items()
                            if holds
                        ]
                        self.assertEqual(len(matched), 1, matched)

    def test_the_classifier_agrees_with_the_partition_everywhere(self):
        for ds in SIGNS:
            for dg in SIGNS:
                for risk in RISK_SPACE:
                    with self.subTest(ds=ds, dg=dg, risk=risk):
                        expected = next(
                            label
                            for label, holds in _predicates(ds, dg, risk).items()
                            if holds
                        )
                        self.assertEqual(
                            classify_gate(_delta(ds, dg), dict(risk)), expected
                        )

    def test_the_whole_space_is_covered_and_nothing_else_appears(self):
        seen = {
            classify_gate(_delta(ds, dg), dict(risk))
            for ds in SIGNS
            for dg in SIGNS
            for risk in RISK_SPACE
        }
        self.assertEqual(seen, set(GATE_LABELS))

    def test_the_label_set_has_no_duplicates(self):
        self.assertEqual(len(GATE_LABELS), len(set(GATE_LABELS)))
        self.assertEqual(len(GATE_LABELS), 6)

    def test_the_promoting_label_does_not_claim_a_timing_improvement(self):
        """**이름이 `ΔB > 0`을 주장하면 안 된다.**

        승격 조건은 `ΔS > 0` AND `ΔG > 0`뿐이고 `ΔB`의 부호를 요구하지 않는다. 실제로
        `ΔB < 0`이면서 이 label이 나올 수 있으므로 이름에 timing을 넣으면 과해석이다.
        """
        self.assertEqual(LABEL_ECONOMICS_AND_RELATIVE, "ECONOMICS_AND_RELATIVE_IMPROVED")
        self.assertNotIn("TIMING", LABEL_ECONOMICS_AND_RELATIVE)
        # ΔB = ΔS − ΔG < 0 인데도 승격 label이 나오는 실제 조합.
        delta = _delta(0.05, 0.09)
        self.assertLess(delta["delta_B"], 0)
        self.assertEqual(
            classify_gate(delta, _risk()), LABEL_ECONOMICS_AND_RELATIVE
        )


class DecompositionTest(unittest.TestCase):
    """`ΔS = ΔB + ΔG`는 `G ≡ S − B`의 결과다. **잔차가 0이어야 한다.**"""

    def run_payload(self, strategy: float, matched: float) -> dict:
        return {
            "metrics": {
                "total_return": strategy,
                "max_drawdown": 0.10,
                "sharpe": 0.4,
                "calmar": 0.2,
                "avg_exposure": 0.18,
            },
            "benchmark": [
                {"label": "일별 노출 일치", "total_return": matched},
                {"label": "평균 노출 고정", "total_return": matched},
                {"label": "100% 보유", "total_return": 5.0},
            ],
        }

    def test_the_identity_closes_exactly(self):
        delta = decompose(
            self.run_payload(0.3563, 0.4809), self.run_payload(0.2800, 0.3500)
        )
        self.assertAlmostEqual(delta["identity_residual"], 0.0, places=12)
        self.assertAlmostEqual(
            delta["delta_S"], delta["delta_B"] + delta["delta_G"], places=12
        )

    def test_the_pieces_are_what_they_say(self):
        delta = decompose(
            self.run_payload(0.10, 0.40), self.run_payload(0.25, 0.30)
        )
        self.assertAlmostEqual(delta["delta_S"], 0.15)
        self.assertAlmostEqual(delta["delta_B"], -0.10)
        self.assertAlmostEqual(delta["delta_G"], 0.25)
        self.assertAlmostEqual(delta["G_control"], -0.30)
        self.assertAlmostEqual(delta["G_gate"], -0.05)

    def test_matched_is_the_first_benchmark_row(self):
        """행 순서가 바뀌면 분해가 조용히 다른 벤치마크를 쓴다."""
        delta = decompose(self.run_payload(0.1, 0.4), self.run_payload(0.1, 0.4))
        self.assertAlmostEqual(delta["B_control"], 0.4)


class RiskImprovementTest(unittest.TestCase):
    def payload(self, **metrics) -> dict:
        base = {
            "max_drawdown": 0.10,
            "sharpe": 0.40,
            "calmar": 0.20,
            "avg_exposure": 0.18,
        }
        base.update(metrics)
        return {"metrics": base}

    def test_direction_is_per_metric(self):
        risk = risk_improvements(
            self.payload(),
            self.payload(max_drawdown=0.08, sharpe=0.5, calmar=0.3, avg_exposure=0.12),
        )
        self.assertEqual(set(risk.values()), {True})

    def test_lower_is_better_for_drawdown_and_exposure(self):
        risk = risk_improvements(
            self.payload(), self.payload(max_drawdown=0.12, avg_exposure=0.25)
        )
        self.assertFalse(risk["max_drawdown_down"])
        self.assertFalse(risk["exposure_down"])

    def test_equal_is_not_an_improvement(self):
        risk = risk_improvements(self.payload(), self.payload())
        self.assertEqual(set(risk.values()), {False})

    def test_a_missing_metric_is_unknown_not_false(self):
        risk = risk_improvements(self.payload(), {"metrics": {"max_drawdown": 0.08}})
        self.assertTrue(risk["max_drawdown_down"])
        self.assertIsNone(risk["sharpe_up"])


class ScopeTest(unittest.TestCase):
    """**이번 PR은 진입 게이트 하나만 더한다.**"""

    def source(self) -> str:
        return (TRADING_ROOT / "selftest" / "market_gate_run.py").read_text()

    def test_no_sizing_or_exit_change(self):
        source = self.source()
        for forbidden in ("risk_per_trade", "stop_atr_multiple", "max_position_weight",
                          "max_hold_sessions=", "max_positions="):
            self.assertNotIn(forbidden, source, forbidden)

    def test_no_alternate_market_filter(self):
        """SMA150·SMA250·10개월·변동성 게이트를 만들지 않았다."""
        source = (TRADING_ROOT / "backtest" / "regime.py").read_text()
        for forbidden in ("sma150", "SMA150", "sma250", "SMA250", "month_ma"):
            self.assertNotIn(forbidden, source, forbidden)

    def test_only_two_arms(self):
        self.assertEqual(ARMS, ("jt-j126-k42", "jt-j126-k42-sma200"))


if __name__ == "__main__":
    unittest.main(verbosity=1)
