"""14.4 검증 절차와 14.7 판정.

가장 중요한 테스트는 `GateBlockerTest`다. 지표가 전부 목표를 넘겨도 조건이 빠지면 판정은
`UNDETERMINED`여야 한다. 여기가 새면 생존편향 데이터로 낸 숫자가 "14.7 통과"로 읽힌다.
"""

from __future__ import annotations

import sys
import unittest
from dataclasses import replace
from pathlib import Path

TRADING_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TRADING_ROOT))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from backtest.features import TRADING_DAYS_PER_YEAR  # noqa: E402
from backtest.loop import BacktestResult, run_backtest  # noqa: E402
from backtest.metrics import Metrics, compute_metrics  # noqa: E402
from backtest.policy import DEFAULT_PARAMETERS  # noqa: E402
from backtest.validation import (  # noqa: E402
    FAIL,
    MIN_QTY_EXCEPTION_REVIEW_SHARE,
    PASS,
    TARGET,
    UNDETERMINED,
    Fold,
    ValidationError,
    WalkForwardPlan,
    WalkForwardReport,
    evaluate_gate,
    holdout_run_count,
    neighbourhood_report,
    parameter_variant,
    plan_walk_forward,
    record_holdout_run,
    run_walk_forward,
    stress_config,
)
from test_metrics import CAPITAL, make_result, trade  # noqa: E402


def fake_walk_forward(
    metrics: Metrics, *, fold_count: int = 3, holdout_run_count: int | None = 1
) -> WalkForwardReport:
    """실행 없이 만든 워크포워드 보고서. 게이트의 차단 논리만 볼 때 쓴다."""
    folds = tuple(
        Fold(f"fold-{index + 1:02d}", "2026-01-01", "2026-01-31")
        for index in range(fold_count)
    ) + (Fold("holdout", "2026-02-01", "2026-02-27", is_holdout=True),)
    plan = WalkForwardPlan(folds=folds, warmup_sessions=252, unused_sessions=0)
    return WalkForwardReport(
        plan=plan,
        fold_metrics=tuple((fold, metrics) for fold in folds),
        holdout_run_count=holdout_run_count,
    )


def perfect_result() -> BacktestResult:
    """모든 문턱을 넘기는 결과. 조건 차단만 남기기 위한 것이다."""
    equities = []
    equity = CAPITAL
    for index in range(TRADING_DAYS_PER_YEAR):
        equity *= 1.004 if index % 5 else 0.999
        equities.append(equity)
    trades = tuple(
        trade(500.0, 0.6, symbol=f"S{index}") if index % 4 else trade(-200.0, -0.3)
        for index in range(420)
    )
    return make_result(equities, trades)


class GateBlockerTest(unittest.TestCase):
    def test_a_clean_run_can_pass(self):
        result = perfect_result()
        metrics = compute_metrics(result)
        report = evaluate_gate(
            result,
            metrics,
            survivorship_biased=False,
            walk_forward=fake_walk_forward(metrics),
            stressed=metrics,
        )
        # 인접 파라미터 실행은 아직 없다. 그래서 깨끗한 실행도 여기서 막힌다.
        self.assertEqual(report.blockers, ("PARAMETER_NEIGHBOURHOOD_NOT_RUN",))
        self.assertEqual(report.verdict, UNDETERMINED)
        for name in ("expectancy_r", "sharpe", "profit_factor", "max_drawdown"):
            self.assertIn(report.row(name).verdict, (PASS, TARGET), msg=name)

    def test_survivorship_bias_blocks_judgement(self):
        result = perfect_result()
        metrics = compute_metrics(result)
        report = evaluate_gate(
            result,
            metrics,
            survivorship_biased=True,
            walk_forward=fake_walk_forward(metrics),
            stressed=metrics,
        )
        self.assertEqual(report.verdict, UNDETERMINED)
        self.assertIn("SURVIVORSHIP_BIASED", report.blockers)

    def test_a_run_without_walk_forward_is_not_judgement(self):
        result = perfect_result()
        metrics = compute_metrics(result)
        report = evaluate_gate(
            result, metrics, survivorship_biased=False, stressed=metrics
        )
        self.assertIn("NO_WALK_FORWARD", report.blockers)

    def test_disabled_gates_are_blockers(self):
        result = replace(
            perfect_result(),
            config=replace(
                perfect_result().config,
                require_earnings_calendar=False,
                require_sector=False,
            ),
        )
        metrics = compute_metrics(result)
        report = evaluate_gate(
            result,
            metrics,
            survivorship_biased=False,
            walk_forward=fake_walk_forward(metrics),
            stressed=metrics,
        )
        self.assertIn("EARNINGS_GATE_DISABLED", report.blockers)
        self.assertIn("SECTOR_LIMIT_DISABLED", report.blockers)

    def test_missing_cost_stress_is_a_blocker(self):
        result = perfect_result()
        metrics = compute_metrics(result)
        report = evaluate_gate(
            result,
            metrics,
            survivorship_biased=False,
            walk_forward=fake_walk_forward(metrics),
        )
        self.assertIn("COST_STRESS_MISSING", report.blockers)
        self.assertEqual(report.row("cost_stress_breakeven").verdict, UNDETERMINED)

    def test_numbers_survive_even_when_judgement_does_not(self):
        """숫자를 지우지는 않는다. 엔진 검증에는 그 숫자가 필요하다."""
        result = perfect_result()
        metrics = compute_metrics(result)
        report = evaluate_gate(result, metrics, survivorship_biased=True)
        self.assertEqual(report.verdict, UNDETERMINED)
        self.assertIsNotNone(report.row("sharpe").value)
        self.assertIsNotNone(report.row("profit_factor").value)


class GateRowTest(unittest.TestCase):
    def base_report(self, **changes):
        result = perfect_result()
        metrics = replace(compute_metrics(result), **changes)
        return evaluate_gate(
            result,
            metrics,
            survivorship_biased=False,
            walk_forward=fake_walk_forward(metrics),
            stressed=metrics,
        )

    def test_thresholds_follow_the_14_7_table(self):
        report = self.base_report()
        expected = {
            "trade_count": (200, 400),
            "expectancy_r": (0.0, 0.20),
            "sharpe": (0.6, 0.9),
            "sortino": (0.9, 1.3),
            "max_drawdown": (0.15, 0.10),
            "profit_factor": (1.15, 1.35),
            "calmar": (0.6, 1.0),
        }
        for name, (minimum, target) in expected.items():
            row = report.row(name)
            self.assertAlmostEqual(row.minimum, minimum, msg=name)
            self.assertAlmostEqual(row.target, target, msg=name)

    def test_a_metric_below_the_minimum_fails(self):
        report = self.base_report(sharpe=0.2)
        self.assertEqual(report.row("sharpe").verdict, FAIL)

    def test_a_metric_between_minimum_and_target_passes(self):
        report = self.base_report(sharpe=0.7)
        self.assertEqual(report.row("sharpe").verdict, PASS)

    def test_drawdown_is_judged_the_other_way(self):
        self.assertEqual(self.base_report(max_drawdown=0.08).row("max_drawdown").verdict, TARGET)
        self.assertEqual(self.base_report(max_drawdown=0.13).row("max_drawdown").verdict, PASS)
        self.assertEqual(self.base_report(max_drawdown=0.20).row("max_drawdown").verdict, FAIL)

    def test_min_qty_exception_share_uses_the_9_1_1_threshold(self):
        row = self.base_report(min_qty_exception_share=0.5).row("min_qty_exception_share")
        self.assertEqual(row.verdict, FAIL)
        self.assertAlmostEqual(row.minimum, MIN_QTY_EXCEPTION_REVIEW_SHARE)
        self.assertFalse(row.higher_is_better)

    def test_a_failing_row_makes_the_whole_gate_fail_when_nothing_blocks(self):
        result = perfect_result()
        metrics = replace(compute_metrics(result), sharpe=0.1)
        report = evaluate_gate(
            result,
            metrics,
            survivorship_biased=False,
            walk_forward=fake_walk_forward(metrics),
            stressed=metrics,
        )
        # 인접 파라미터가 아직 막고 있어 UNDETERMINED가 우선이다.
        self.assertEqual(report.verdict, UNDETERMINED)
        self.assertEqual(report.row("sharpe").verdict, FAIL)


class StressConfigTest(unittest.TestCase):
    def test_stress_config_only_changes_costs(self):
        result = perfect_result()
        stressed = stress_config(result, 2.0)
        self.assertEqual(stressed.start, result.config.start)
        self.assertEqual(stressed.policy, result.config.policy)
        self.assertAlmostEqual(
            stressed.costs.round_trip_bps, 2 * result.config.costs.round_trip_bps
        )
        self.assertAlmostEqual(
            stress_config(result, 3.0).costs.round_trip_bps,
            3 * result.config.costs.round_trip_bps,
        )


class EndToEndTest(unittest.TestCase):
    """loop → 지표 → 판정을 한 번에 돌린다. 합성 데이터라 판정은 반드시 미확정이다."""

    @classmethod
    def setUpClass(cls):
        from test_loop import build, config

        connection, dates = build()
        cls.run_result = run_backtest(connection, config(dates))
        cls.stressed_result = run_backtest(connection, stress_config(cls.run_result, 2.0))

    def test_metrics_come_out_of_a_real_run(self):
        metrics = compute_metrics(self.run_result)
        self.assertGreater(metrics.trade_count, 0)
        self.assertEqual(metrics.sessions, len(self.run_result.equity_curve))
        self.assertGreater(metrics.fees_paid, 0.0)
        self.assertGreater(metrics.avg_exposure, 0.0)

    def test_doubling_costs_lowers_the_result(self):
        base = compute_metrics(self.run_result)
        stressed = compute_metrics(self.stressed_result)
        self.assertLess(stressed.fees_paid, base.fees_paid * 2 + 1e-6)
        self.assertGreater(stressed.fees_paid, base.fees_paid)
        self.assertLess(stressed.final_equity, base.final_equity)

    def test_a_synthetic_run_can_never_pass_the_gate(self):
        metrics = compute_metrics(self.run_result)
        report = evaluate_gate(
            self.run_result,
            metrics,
            survivorship_biased=True,
            stressed=compute_metrics(self.stressed_result),
        )
        self.assertEqual(report.verdict, UNDETERMINED)
        self.assertIn("SURVIVORSHIP_BIASED", report.blockers)
        self.assertIn("NO_WALK_FORWARD", report.blockers)
        self.assertIn("EARNINGS_GATE_DISABLED", report.blockers)


class NeighbourhoodTest(unittest.TestCase):
    """21.2의 인접 파라미터 안정성. 이 이관이 가능하게 만든 것이다."""

    @classmethod
    def setUpClass(cls):
        from test_loop import build, config

        cls.connection, cls.dates = build()
        cls.base_config = config(cls.dates)
        cls.center = compute_metrics(run_backtest(cls.connection, cls.base_config))

    def sweep(self, field: str, values: tuple) -> dict:
        return {
            value: compute_metrics(
                run_backtest(
                    self.connection,
                    parameter_variant(self.base_config, **{field: value}),
                )
            )
            for value in values
        }

    def test_a_variant_changes_the_policy_signature(self):
        variant = parameter_variant(self.base_config, breakout_window=18)
        self.assertEqual(variant.policy.parameters.breakout_window, 18)
        self.assertNotEqual(
            variant.policy.signature, self.base_config.policy.signature
        )
        self.assertIn("breakout_window=18", variant.policy.policy_id)
        # 파라미터만 바뀌고 한도·프로필은 그대로다.
        self.assertEqual(variant.policy.limits, self.base_config.policy.limits)
        self.assertEqual(variant.policy.profile, self.base_config.policy.profile)

    def test_adjacent_breakout_windows_run_and_report(self):
        """21.2가 예로 든 18/20/22일을 실제로 돌린다."""
        neighbours = self.sweep("breakout_window", (18, 22))
        report = neighbourhood_report(
            "breakout_window", self.center, neighbours, center_value=20
        )
        self.assertEqual(report.field, "breakout_window")
        self.assertEqual([value for value, _ in report.neighbours], [18, 22])
        self.assertIsNotNone(report.collapse_ratio)
        self.assertGreater(report.collapse_ratio, 0.0)

    def test_the_gate_blocker_disappears_once_the_sweep_exists(self):
        result = run_backtest(self.connection, self.base_config)
        metrics = compute_metrics(result)
        stressed = compute_metrics(
            run_backtest(self.connection, stress_config(result, 2.0))
        )
        report = neighbourhood_report(
            "breakout_window",
            metrics,
            self.sweep("breakout_window", (18, 22)),
            center_value=20,
        )

        without = evaluate_gate(
            result, metrics, survivorship_biased=False,
            walk_forward=fake_walk_forward(metrics), stressed=stressed,
        )
        self.assertIn("PARAMETER_NEIGHBOURHOOD_NOT_RUN", without.blockers)

        with_sweep = evaluate_gate(
            result, metrics, survivorship_biased=False,
            walk_forward=fake_walk_forward(metrics), stressed=stressed,
            neighbourhood=report,
        )
        self.assertNotIn("PARAMETER_NEIGHBOURHOOD_NOT_RUN", with_sweep.blockers)
        self.assertIsNotNone(with_sweep.row("parameter_neighbourhood").value)

    def test_a_collapsing_neighbour_is_visible(self):
        collapsed = neighbourhood_report(
            "breakout_window",
            replace(self.center, expectancy_r=1.0),
            {
                18: replace(self.center, expectancy_r=0.1),
                22: replace(self.center, expectancy_r=0.9),
            },
            center_value=20,
        )
        self.assertAlmostEqual(collapsed.collapse_ratio, 0.1)

    def test_a_non_positive_center_makes_the_ratio_meaningless(self):
        report = neighbourhood_report(
            "breakout_window",
            replace(self.center, expectancy_r=-0.2),
            {18: replace(self.center, expectancy_r=0.5)},
            center_value=20,
        )
        self.assertIsNone(report.collapse_ratio)


class WalkForwardPlanTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from test_loop import build

        cls.connection, cls.dates = build(520)

    def plan(self, **changes):
        kwargs = dict(
            parameters=DEFAULT_PARAMETERS, fold_sessions=80, holdout_sessions=80
        )
        kwargs.update(changes)
        return plan_walk_forward(self.connection, "v1", **kwargs)

    def test_warmup_is_not_traded(self):
        """앞 252세션은 피처가 요구하는 이력이라 거래 구간에 들어가지 않는다."""
        plan = self.plan()
        self.assertEqual(plan.warmup_sessions, 252)
        self.assertEqual(plan.folds[0].start, self.dates[252])

    def test_folds_are_consecutive_and_equal_sized(self):
        plan = self.plan()
        tradeable = self.dates[252:]
        # 268세션 - 홀드아웃 80 = 188, 80씩 2 fold + 나머지 28은 버린다.
        self.assertEqual(len(plan.test_folds), 2)
        self.assertEqual(plan.unused_sessions, 28)
        for earlier, later in zip(plan.folds, plan.folds[1:]):
            self.assertLess(earlier.end, later.start)
        self.assertEqual(plan.folds[-1].end, tradeable[-1])

    def test_the_last_segment_is_the_holdout(self):
        plan = self.plan()
        self.assertTrue(plan.holdout.is_holdout)
        self.assertEqual(plan.holdout.name, "holdout")
        self.assertEqual(plan.holdout.start, self.dates[-80])
        self.assertEqual(plan.holdout.end, self.dates[-1])
        self.assertFalse(any(fold.is_holdout for fold in plan.test_folds))

    def test_too_little_data_is_refused(self):
        with self.assertRaises(ValidationError) as caught:
            self.plan(fold_sessions=200, holdout_sessions=100)
        self.assertIn("거래 가능 세션", str(caught.exception))

    def test_a_segment_shorter_than_twice_the_max_hold_is_refused(self):
        """구간이 짧으면 보유가 구간을 넘는 거래가 잘려 빠른 청산만 세어진다."""
        for changes in ({"fold_sessions": 40}, {"holdout_sessions": 20}):
            with self.assertRaises(ValidationError) as caught:
                self.plan(**changes)
            self.assertIn("최대 보유", str(caught.exception))
            self.assertIn("두 배", str(caught.exception))


class WalkForwardRunTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from test_loop import build, config

        cls.connection, cls.dates = build(520)
        cls.config = config(cls.dates)
        cls.plan = plan_walk_forward(
            cls.connection,
            "v1",
            parameters=DEFAULT_PARAMETERS,
            fold_sessions=80,
            holdout_sessions=80,
        )
        cls.report = run_walk_forward(cls.connection, cls.config, cls.plan)

    def test_every_fold_is_measured(self):
        self.assertEqual(len(self.report.fold_metrics), len(self.plan.folds))
        for fold, metrics in self.report.fold_metrics:
            self.assertEqual(metrics.sessions, 80)

    def test_each_fold_starts_from_the_initial_capital(self):
        """앞 fold의 운이 뒤로 복리되지 않아야 구간끼리 비교할 수 있다."""
        for _, metrics in self.report.fold_metrics:
            self.assertAlmostEqual(metrics.initial_equity, self.config.initial_capital)

    def test_oos_trade_count_sums_the_folds(self):
        self.assertEqual(
            self.report.oos_trade_count,
            sum(metrics.trade_count for _, metrics in self.report.fold_metrics),
        )
        self.assertGreater(self.report.oos_trade_count, 0)

    def test_fold_stability_is_reported(self):
        self.assertIsNotNone(self.report.positive_fold_share)
        self.assertGreaterEqual(self.report.positive_fold_share, 0.0)
        self.assertLessEqual(self.report.positive_fold_share, 1.0)
        self.assertIsNotNone(self.report.worst_fold_expectancy_r)

    def test_holdout_metrics_are_separable(self):
        self.assertIsNotNone(self.report.holdout_metrics)
        self.assertEqual(self.report.holdout_metrics.sessions, 80)
        self.assertGreater(self.report.holdout_metrics.trade_count, 0)


class HoldoutDisciplineTest(unittest.TestCase):
    def setUp(self):
        from test_loop import build, config

        self.connection, self.dates = build(520)
        self.config = config(self.dates)
        self.plan = plan_walk_forward(
            self.connection,
            "v1",
            parameters=DEFAULT_PARAMETERS,
            fold_sessions=80,
            holdout_sessions=80,
        )
        self.metrics = compute_metrics(
            run_backtest(
                self.connection,
                replace(
                    self.config,
                    start=self.plan.holdout.start,
                    end=self.plan.holdout.end,
                ),
            )
        )

    def record(self, run_id: str, policy=None):
        return record_holdout_run(
            self.connection,
            run_id,
            self.plan.holdout,
            policy or self.config.policy,
            "v1",
            self.metrics,
        )

    def test_the_first_look_is_free(self):
        self.assertEqual(self.record("run-1"), 1)
        self.assertEqual(holdout_run_count(self.connection, "v1", self.plan.holdout), 1)

    def test_a_second_look_is_counted_even_with_another_policy(self):
        """다른 정책으로 다시 돌리는 것이야말로 홀드아웃을 소모하는 행위다."""
        self.record("run-1")
        variant = parameter_variant(self.config, breakout_window=18)
        self.assertEqual(self.record("run-2", variant.policy), 2)

    def test_the_same_run_id_does_not_inflate_the_count(self):
        self.record("run-1")
        self.assertEqual(self.record("run-1"), 1)

    def test_a_reused_holdout_blocks_judgement(self):
        result = run_backtest(self.connection, self.config)
        metrics = compute_metrics(result)
        clean = evaluate_gate(
            result,
            metrics,
            survivorship_biased=False,
            walk_forward=fake_walk_forward(metrics, holdout_run_count=1),
            stressed=metrics,
            neighbourhood=None,
        )
        self.assertNotIn("HOLDOUT_REUSED", clean.blockers)

        reused = evaluate_gate(
            result,
            metrics,
            survivorship_biased=False,
            walk_forward=fake_walk_forward(metrics, holdout_run_count=4),
            stressed=metrics,
        )
        self.assertIn("HOLDOUT_REUSED", reused.blockers)
        self.assertEqual(reused.verdict, UNDETERMINED)


class WalkForwardGateTest(unittest.TestCase):
    def test_trade_count_uses_the_walk_forward_sample(self):
        result = make_result([CAPITAL * 1.1], (trade(100.0, 0.5),))
        metrics = compute_metrics(result)
        alone = evaluate_gate(result, metrics, survivorship_biased=False)
        self.assertEqual(alone.row("trade_count").value, 1)

        with_folds = evaluate_gate(
            result,
            metrics,
            survivorship_biased=False,
            walk_forward=fake_walk_forward(
                compute_metrics(
                    make_result([CAPITAL], tuple(trade(100.0, 0.5) for _ in range(60)))
                )
            ),
        )
        # fold 3개 + 홀드아웃 1개 × 60거래.
        self.assertEqual(with_folds.row("trade_count").value, 240)

    def test_fold_stability_row_appears_only_with_a_report(self):
        result = make_result([CAPITAL], (trade(100.0, 0.5),))
        metrics = compute_metrics(result)
        self.assertEqual(
            evaluate_gate(result, metrics, survivorship_biased=False)
            .row("fold_stability")
            .verdict,
            UNDETERMINED,
        )
        report = evaluate_gate(
            result,
            metrics,
            survivorship_biased=False,
            walk_forward=fake_walk_forward(metrics),
        )
        self.assertAlmostEqual(report.row("fold_stability").value, 1.0)
        self.assertEqual(report.row("fold_stability").verdict, TARGET)


if __name__ == "__main__":
    unittest.main()
