"""노출을 맞춘 벤치마크. 기대값은 손으로 낸 닫힌 형태다.

가장 중요한 테스트는 `test_yesterdays_weight_earns_todays_return`이다. 오늘 비중으로
오늘 수익을 곱하면 그날의 움직임을 미리 알고 노출을 정한 것이 되고, 그러면 벤치마크가
전략보다 좋아 보이는 방향으로 조용히 틀린다.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

TRADING_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TRADING_ROOT))

from backtest.benchmark import (  # noqa: E402
    benchmark_table,
    exposure_matched,
    exposure_weights,
    summarize,
)
from backtest.loop import EquityPoint  # noqa: E402


def point(trade_date: str, equity: float, exposure: float) -> EquityPoint:
    return EquityPoint(
        trade_date=trade_date, equity=equity, cash=equity - exposure,
        exposure=exposure, drawdown=0.0, regime="GREEN",
        market_regime="BULL/LOW_VOL", open_positions=1,
    )


class WeightTest(unittest.TestCase):
    def test_weights_are_the_exposure_fraction(self):
        curve = (point("2026-01-02", 100.0, 25.0), point("2026-01-05", 200.0, 50.0))
        self.assertEqual(exposure_weights(curve), [0.25, 0.25])

    def test_a_wiped_out_account_has_no_weight(self):
        self.assertEqual(exposure_weights((point("2026-01-02", 0.0, 0.0),)), [0.0])


class ExposureMatchedTest(unittest.TestCase):
    CLOSES = {"2026-01-02": 100.0, "2026-01-05": 110.0, "2026-01-06": 99.0}

    def curve(self, *weights: float):
        dates = sorted(self.CLOSES)
        return tuple(
            point(date, 100.0, 100.0 * weight) for date, weight in zip(dates, weights)
        )

    def test_half_exposure_earns_half_the_move(self):
        # +10% 다음 -10%. 비중 0.5면 각각 +5%, -5%다.
        returns = exposure_matched(self.curve(0.5, 0.5, 0.5), self.CLOSES)
        self.assertAlmostEqual(returns[0], 0.05)
        self.assertAlmostEqual(returns[1], -0.05)

    def test_yesterdays_weight_earns_todays_return(self):
        """**오늘 비중으로 오늘 수익을 곱하면 룩어헤드다.**

        첫날 비중 0, 둘째 날 1로 두면 두 수익률은 `0 × +10%`와 `1 × -10%`여야 한다.
        반대로 짝지으면 `+10%`와 `0`이 나와서 벤치마크가 상승만 먹는다.
        """
        returns = exposure_matched(self.curve(0.0, 1.0, 1.0), self.CLOSES)
        self.assertAlmostEqual(returns[0], 0.0)
        self.assertAlmostEqual(returns[1], -0.10)

    def test_zero_exposure_earns_nothing(self):
        returns = exposure_matched(self.curve(0.0, 0.0, 0.0), self.CLOSES)
        self.assertEqual(returns, [0.0, 0.0])


class SummaryTest(unittest.TestCase):
    def test_total_return_compounds(self):
        result = summarize([0.10, -0.10], "x")
        self.assertAlmostEqual(result.total_return, 1.10 * 0.90 - 1)
        self.assertAlmostEqual(result.max_drawdown, 0.10)

    def test_a_flat_series_has_no_sharpe(self):
        """표준편차가 0이면 나눌 수 없다. 무한대를 만들지 않는다."""
        self.assertIsNone(summarize([0.0, 0.0, 0.0], "x").sharpe)

    def test_the_table_has_the_three_rows(self):
        closes = ExposureMatchedTest.CLOSES
        dates = sorted(closes)
        curve = tuple(point(date, 100.0, 20.0) for date in dates)
        rows = benchmark_table(curve, closes)
        self.assertEqual([row.label for row in rows][0], "일별 노출 일치")
        self.assertIn("20.0%", rows[1].label)
        self.assertEqual(rows[2].label, "100% 보유")
        # 비중이 상수면 일별 일치와 평균 고정이 같은 값이어야 한다.
        self.assertAlmostEqual(rows[0].total_return, rows[1].total_return)


if __name__ == "__main__":
    unittest.main()
