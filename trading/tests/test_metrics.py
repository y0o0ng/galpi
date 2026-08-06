"""성과 지표 측정. 손으로 답을 낼 수 있는 자산 곡선과 거래 목록으로 확인한다.

14.4 검증 절차와 14.7 판정은 `test_validation.py`에 있다.
"""

from __future__ import annotations

import sys
import unittest
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
)
from backtest.metrics import compute_metrics, daily_returns  # noqa: E402

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


if __name__ == "__main__":
    unittest.main()
