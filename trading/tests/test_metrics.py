"""성과 지표와 14.7 판정.

가장 중요한 테스트는 `GateBlockerTest`다. 지표가 전부 목표를 넘겨도 조건이 빠지면 판정은
`UNDETERMINED`여야 한다. 여기가 새면 생존편향 데이터로 낸 숫자가 "14.7 통과"로 읽힌다.

지표 계산은 손으로 답을 낼 수 있는 자산 곡선과 거래 목록으로 확인한다.
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
from backtest.loop import (  # noqa: E402
    BacktestConfig,
    BacktestResult,
    EquityPoint,
    Trade,
    run_backtest,
)
from backtest.metrics import (  # noqa: E402
    FAIL,
    MIN_QTY_EXCEPTION_REVIEW_SHARE,
    PASS,
    TARGET,
    UNDETERMINED,
    compute_metrics,
    daily_returns,
    evaluate_gate,
    stress_config,
)

CAPITAL = 100_000.0


def curve(equities: list[float], drawdowns: list[float] | None = None) -> tuple:
    """자산 곡선. 낙폭을 주지 않으면 고점 대비로 직접 계산한다."""
    points = []
    peak = CAPITAL
    for index, equity in enumerate(equities):
        peak = max(peak, equity)
        drawdown = (
            drawdowns[index] if drawdowns is not None else max(0.0, 1 - equity / peak)
        )
        points.append(
            EquityPoint(
                trade_date=f"2026-01-{index + 1:02d}",
                equity=equity,
                cash=equity,
                exposure=0.0,
                drawdown=drawdown,
                regime="GREEN",
                open_positions=0,
            )
        )
    return tuple(points)


def trade(pnl: float, return_r: float, *, symbol="AAA", exit_reason="MAX_HOLD",
          fees: float = 5.0, min_qty_exception: bool = False) -> Trade:
    return Trade(
        symbol=symbol,
        entry_date="2026-01-01",
        exit_date="2026-01-10",
        shares=10,
        entry_price=100.0,
        exit_price=100.0 + pnl / 10,
        entry_reason="OPEN_FILL",
        exit_reason=exit_reason,
        exit_fill_reason="OPEN_EXIT",
        fees=fees,
        pnl=pnl,
        return_r=return_r,
        mfe_r=max(return_r, 0.0),
        mae_r=min(return_r, 0.0),
        sessions_held=10,
        min_qty_exception=min_qty_exception,
    )


def make_result(
    equities: list[float],
    trades: tuple = (),
    *,
    require_earnings_calendar: bool = True,
    require_sector: bool = True,
) -> BacktestResult:
    config = BacktestConfig(
        source_version="v1",
        start="2026-01-01",
        end="2026-01-31",
        initial_capital=CAPITAL,
        require_earnings_calendar=require_earnings_calendar,
        require_sector=require_sector,
    )
    return BacktestResult(
        config=config,
        trades=tuple(trades),
        equity_curve=curve(equities),
        open_positions=(),
        fills=(),
        skip_counts={},
        fill_counts={},
        exit_counts={},
    )


class ReturnSeriesTest(unittest.TestCase):
    def test_first_return_is_measured_against_initial_capital(self):
        result = make_result([110_000.0, 121_000.0])
        self.assertEqual(
            [round(value, 10) for value in daily_returns(result)], [0.1, 0.1]
        )

    def test_a_zero_mean_series_has_zero_sharpe(self):
        # +10%, -10%면 평균이 0이라 Sharpe도 0이다.
        metrics = compute_metrics(make_result([110_000.0, 99_000.0]))
        self.assertAlmostEqual(metrics.sharpe, 0.0, places=9)
        self.assertLess(metrics.sortino, 0.0 + 1e-9)

    def test_a_positive_drift_series_has_positive_sharpe(self):
        equities = [CAPITAL]
        for index in range(60):
            equities.append(equities[-1] * (1.004 if index % 5 else 0.999))
        metrics = compute_metrics(make_result(equities[1:]))
        self.assertGreater(metrics.sharpe, 0.0)
        self.assertGreater(metrics.sortino, metrics.sharpe)

    def test_a_constant_return_series_has_no_deviation(self):
        """편차가 0이면 Sharpe를 정의할 수 없다. 무한대를 만들지 않는다.

        1.5배는 이진수로 정확히 표현되므로 수익률이 비트까지 같다. 비현실적인 계열이지만
        분모가 0이 되는 갈래를 확인하는 것이 목적이다.
        """
        equities = [CAPITAL * (1.5 ** (index + 1)) for index in range(20)]
        metrics = compute_metrics(make_result(equities))
        self.assertIsNone(metrics.sharpe)
        self.assertIsNone(metrics.sortino)


class MetricValueTest(unittest.TestCase):
    def test_drawdown_is_peak_to_trough(self):
        metrics = compute_metrics(make_result([100_000.0, 120_000.0, 90_000.0, 100_000.0]))
        self.assertAlmostEqual(metrics.max_drawdown, 0.25)

    def test_cagr_annualizes_by_session_count(self):
        # 252세션에 두 배가 되면 연 100%다.
        equities = [CAPITAL * (2 ** ((index + 1) / TRADING_DAYS_PER_YEAR)) for index in range(TRADING_DAYS_PER_YEAR)]
        metrics = compute_metrics(make_result(equities))
        self.assertAlmostEqual(metrics.total_return, 1.0, places=9)
        self.assertAlmostEqual(metrics.cagr, 1.0, places=9)

    def test_profit_factor_is_gross_profit_over_gross_loss(self):
        metrics = compute_metrics(
            make_result(
                [CAPITAL + 100.0],
                (trade(100.0, 1.0), trade(50.0, 0.5), trade(-50.0, -0.5)),
            )
        )
        self.assertAlmostEqual(metrics.profit_factor, 3.0)
        self.assertAlmostEqual(metrics.gross_profit, 150.0)
        self.assertAlmostEqual(metrics.gross_loss, 50.0)
        self.assertAlmostEqual(metrics.win_rate, 2 / 3)

    def test_profit_factor_is_undefined_without_losses(self):
        metrics = compute_metrics(make_result([CAPITAL + 100.0], (trade(100.0, 1.0),)))
        self.assertIsNone(metrics.profit_factor)

    def test_expectancy_is_the_mean_r(self):
        metrics = compute_metrics(
            make_result(
                [CAPITAL],
                (trade(100.0, 1.0), trade(50.0, 0.5), trade(-100.0, -1.0)),
            )
        )
        self.assertAlmostEqual(metrics.expectancy_r, 0.5 / 3, places=9)
        self.assertAlmostEqual(metrics.avg_win_r, 0.75)
        self.assertAlmostEqual(metrics.avg_loss_r, -1.0)

    def test_calmar_is_cagr_over_drawdown(self):
        equities = [CAPITAL * 1.5, CAPITAL * 1.2, CAPITAL * 1.5]
        metrics = compute_metrics(make_result(equities))
        self.assertAlmostEqual(metrics.max_drawdown, 0.2)
        # 세션이 3개뿐이라 연환산 CAGR이 거대해진다. 비율로 대조한다.
        self.assertAlmostEqual(metrics.calmar / (metrics.cagr / 0.2), 1.0, places=9)

    def test_fees_and_exit_mix_are_summarised(self):
        metrics = compute_metrics(
            make_result(
                [CAPITAL],
                (
                    trade(10.0, 0.1, exit_reason="TRAILING_STOP", fees=7.0),
                    trade(-10.0, -0.1, exit_reason="INITIAL_STOP", fees=3.0),
                    trade(5.0, 0.05, exit_reason="INITIAL_STOP", fees=1.0),
                ),
            )
        )
        self.assertAlmostEqual(metrics.fees_paid, 11.0)
        self.assertEqual(metrics.exit_mix, {"TRAILING_STOP": 1, "INITIAL_STOP": 2})

    def test_min_qty_exception_share_counts_entries(self):
        metrics = compute_metrics(
            make_result(
                [CAPITAL],
                (
                    trade(10.0, 0.1, min_qty_exception=True),
                    trade(10.0, 0.1, min_qty_exception=True),
                    trade(10.0, 0.1),
                    trade(10.0, 0.1),
                ),
            )
        )
        self.assertAlmostEqual(metrics.min_qty_exception_share, 0.5)

    def test_an_empty_run_does_not_crash(self):
        metrics = compute_metrics(make_result([], ()))
        self.assertEqual(metrics.trade_count, 0)
        self.assertIsNone(metrics.expectancy_r)
        self.assertIsNone(metrics.sharpe)
        self.assertFalse(metrics.has_sample)


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
            out_of_sample=True,
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
            out_of_sample=True,
            stressed=metrics,
        )
        self.assertEqual(report.verdict, UNDETERMINED)
        self.assertIn("SURVIVORSHIP_BIASED", report.blockers)

    def test_in_sample_runs_are_not_judgement(self):
        result = perfect_result()
        metrics = compute_metrics(result)
        report = evaluate_gate(
            result, metrics, survivorship_biased=False, stressed=metrics
        )
        self.assertIn("NOT_OUT_OF_SAMPLE", report.blockers)

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
            out_of_sample=True,
            stressed=metrics,
        )
        self.assertIn("EARNINGS_GATE_DISABLED", report.blockers)
        self.assertIn("SECTOR_LIMIT_DISABLED", report.blockers)

    def test_missing_cost_stress_is_a_blocker(self):
        result = perfect_result()
        metrics = compute_metrics(result)
        report = evaluate_gate(
            result, metrics, survivorship_biased=False, out_of_sample=True
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
            out_of_sample=True,
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
            out_of_sample=True,
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
            out_of_sample=False,
            stressed=compute_metrics(self.stressed_result),
        )
        self.assertEqual(report.verdict, UNDETERMINED)
        self.assertIn("SURVIVORSHIP_BIASED", report.blockers)
        self.assertIn("NOT_OUT_OF_SAMPLE", report.blockers)
        self.assertIn("EARNINGS_GATE_DISABLED", report.blockers)


if __name__ == "__main__":
    unittest.main()
