"""체결과 비용. 설계 10.1·10.4·9.3.

가장 중요한 테스트는 `GapStopTest`다. 9.3은 "백테스트에서 stop price가 아니라 다음 거래
가능 가격으로 체결"을 요구한다. 손절가로 체결한다고 가정하면 갭 손실이 사라져서 백테스트가
실제보다 좋아 보인다.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

TRADING_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TRADING_ROOT))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from backtest.costs import (  # noqa: E402
    BASE_STRESS,
    DESIGN_STRESS,
    RATE_SOURCE,
    CostError,
    CostModel,
    Stress,
)
from backtest.data import Bar  # noqa: E402
from backtest.execution import (  # noqa: E402
    ExecutionError,
    corporate_action_between,
    execute_entry,
    execute_market_exit,
    try_stop_exit,
)
from backtest.policy import DEFAULT_PARAMETERS as PARAMS  # noqa: E402
from backtest.sizing import SizedIntent  # noqa: E402

COSTS = CostModel()
FREE = CostModel(slippage_bps=0.0, spread_bps=0.0, commission_bps=0.0, sell_tax_bps=0.0)

SIGNAL_DATE = "2026-08-05"
EXECUTION_DATE = "2026-08-06"


def bar(
    trade_date: str = EXECUTION_DATE,
    *,
    open_: float = 100.0,
    high: float | None = None,
    low: float | None = None,
    close: float | None = None,
    scale: float = 1.0,
    symbol: str = "AAA",
) -> Bar:
    """raw 가격만 쓰는 바. `scale`이 raw/adj 배율이라 기업행동을 흉내낼 수 있다."""
    close = open_ if close is None else close
    high = max(open_, close) if high is None else high
    low = min(open_, close) if low is None else low
    return Bar(
        symbol=symbol,
        trade_date=trade_date,
        raw_open=open_,
        raw_high=high,
        raw_low=low,
        raw_close=close,
        raw_volume=1_000_000.0,
        adj_open=open_ / scale,
        adj_high=high / scale,
        adj_low=low / scale,
        adj_close=close / scale,
    )


def intent(shares: int = 10, close: float = 100.0, atr: float = 5.0) -> SizedIntent:
    """신호 종가 100, ATR 5 → 지정가 101.25, 갭 취소 문턱 105."""
    return SizedIntent(
        symbol="AAA",
        shares=shares,
        original_shares=shares,
        reference_close=close,
        atr14=atr,
        planned_entry=close + 0.25 * atr,
        initial_stop=close + 0.25 * atr - 2 * atr,
        stop_distance=2 * atr,
        planned_risk=shares * 2 * atr,
        planned_risk_fraction=0.0025,
        min_qty_exception=False,
        effective_risk_ratio=1.0,
        binding_constraint="RISK",
        reduction_factor=1.0,
    )


class CostModelTest(unittest.TestCase):
    def test_one_way_cost_is_slippage_plus_half_spread(self):
        self.assertAlmostEqual(COSTS.one_way_bps, 6.0)

    def test_buying_is_dearer_and_selling_is_cheaper(self):
        self.assertAlmostEqual(COSTS.fill_price(100.0, "BUY"), 100.06)
        self.assertAlmostEqual(COSTS.fill_price(100.0, "SELL"), 99.94)

    def test_commission_is_25bp_each_way(self):
        self.assertAlmostEqual(COSTS.fees_for(10, 100.0, "BUY"), 2.5)
        floored = CostModel(commission_bps=1.0, commission_min=1.0, sell_tax_bps=0.0)
        self.assertAlmostEqual(floored.fees_for(1, 100.0, "BUY"), 1.0)

    def test_selling_adds_the_statutory_tax(self):
        # 0.00206%는 매도에만 붙는다. 1,000달러에 2.06센트다.
        self.assertAlmostEqual(COSTS.fees_for(10, 100.0, "SELL"), 2.5 + 0.0206)
        self.assertAlmostEqual(
            COSTS.fees_for(10, 100.0, "SELL") - COSTS.fees_for(10, 100.0, "BUY"),
            0.0206,
        )

    def test_round_trip_is_dominated_by_commission(self):
        self.assertAlmostEqual(COSTS.round_trip_bps, 12.0 + 50.0 + 0.206)
        self.assertAlmostEqual(COSTS.stressed(DESIGN_STRESS).round_trip_bps, 34.0 + 100.412)

    def test_design_stress_matches_the_table(self):
        stressed = COSTS.stressed(DESIGN_STRESS)
        # 슬리피지 5bp → 15bp, 스프레드 2bp → 4bp의 절반.
        self.assertAlmostEqual(stressed.one_way_bps, 17.0)
        self.assertAlmostEqual(stressed.fees_for(10, 100.0, "BUY"), 5.0)

    def test_uniform_stress_scales_everything(self):
        doubled = COSTS.stressed(Stress.uniform(2.0))
        self.assertAlmostEqual(doubled.one_way_bps, 12.0)
        tripled = COSTS.stressed(Stress.uniform(3.0))
        self.assertAlmostEqual(tripled.one_way_bps, 18.0)

    def test_default_rates_are_the_confirmed_account_rates(self):
        self.assertAlmostEqual(COSTS.commission_bps, 25.0)
        self.assertAlmostEqual(COSTS.sell_tax_bps, 0.206)
        self.assertEqual(COSTS.stress, BASE_STRESS)
        self.assertIn("2026-08-06", RATE_SOURCE)

    def test_bad_inputs_are_refused(self):
        with self.assertRaises(CostError):
            COSTS.fill_price(0.0, "BUY")
        with self.assertRaises(CostError):
            COSTS.fill_price(100.0, "HOLD")
        with self.assertRaises(CostError):
            COSTS.fees_for(1, 100.0, "HOLD")


class EntryTest(unittest.TestCase):
    def execute(self, execution_bar, signal_bar=None, costs=COSTS, **kwargs):
        return execute_entry(
            intent(**kwargs),
            signal_bar or bar(SIGNAL_DATE),
            execution_bar,
            costs=costs,
            parameters=PARAMS,
        )

    def test_open_below_the_limit_fills_at_the_open(self):
        result = self.execute(bar(open_=100.5, low=99.0, close=101.0))
        self.assertTrue(result)
        self.assertEqual(result.fill.reason, "OPEN_FILL")
        self.assertAlmostEqual(result.fill.reference_price, 100.5)
        self.assertAlmostEqual(result.fill.fill_price, 100.5 * 1.0006)
        self.assertEqual(result.fill.side, "BUY")
        self.assertEqual(result.fill.trade_date, EXECUTION_DATE)

    def test_open_above_the_limit_fills_only_if_the_low_touches_it(self):
        touched = self.execute(bar(open_=102.0, low=101.0, close=102.0))
        self.assertEqual(touched.fill.reason, "LIMIT_FILL")
        self.assertAlmostEqual(touched.fill.reference_price, 101.25)

        missed = self.execute(bar(open_=102.0, low=101.5, close=102.0))
        self.assertFalse(missed)
        self.assertEqual(missed.cancellation.reason, "NO_FILL")

    def test_gap_of_one_atr_cancels(self):
        cancelled = self.execute(bar(open_=105.0, low=104.0, close=106.0))
        self.assertFalse(cancelled)
        self.assertEqual(cancelled.cancellation.reason, "GAP_LIMIT")

        # 문턱 바로 아래는 취소가 아니다. 다만 지정가에 닿지 않으면 미체결이다.
        just_under = self.execute(bar(open_=104.99, low=101.0, close=104.0))
        self.assertEqual(just_under.fill.reason, "LIMIT_FILL")

    def test_signals_cannot_fill_on_their_own_day(self):
        with self.assertRaises(ExecutionError):
            self.execute(bar(SIGNAL_DATE, open_=100.0))
        with self.assertRaises(ExecutionError):
            self.execute(bar("2026-08-04", open_=100.0))

    def test_corporate_action_cancels_instead_of_filling(self):
        """분할이 끼면 지정가·수량·손절을 다시 계산해야 한다. 가짜 체결을 만들지 않는다."""
        split = bar(open_=50.0, low=49.0, close=50.0, scale=1.0)
        result = self.execute(split, signal_bar=bar(SIGNAL_DATE, scale=2.0))
        self.assertFalse(result)
        self.assertEqual(result.cancellation.reason, "CORPORATE_ACTION")

    def test_cash_delta_includes_the_commission(self):
        result = self.execute(bar(open_=100.0, low=99.0), shares=10)
        fill = result.fill
        self.assertAlmostEqual(
            fill.cash_delta, -(10 * fill.fill_price + fill.fees)
        )
        self.assertLess(fill.cash_delta, -1000.0)

    def test_costs_can_push_the_fill_past_the_limit(self):
        """지정가는 기준가의 상한이고 비용은 그 위에 얹는다. 비싸게 사는 쪽이라 그대로 둔다."""
        result = self.execute(bar(open_=102.0, low=101.0, close=102.0))
        self.assertGreater(result.fill.fill_price, 101.25)


class GapStopTest(unittest.TestCase):
    def test_stop_touched_intraday_fills_at_the_stop(self):
        fill = try_stop_exit("AAA", 10, 90.0, bar(open_=95.0, low=89.0), costs=COSTS)
        self.assertEqual(fill.reason, "STOP_FILL")
        self.assertAlmostEqual(fill.reference_price, 90.0)
        self.assertAlmostEqual(fill.fill_price, 90.0 * 0.9994)

    def test_gap_below_the_stop_fills_at_the_open(self):
        """9.3: stop price가 아니라 다음 거래 가능 가격이다."""
        fill = try_stop_exit("AAA", 10, 90.0, bar(open_=85.0, low=84.0), costs=COSTS)
        self.assertEqual(fill.reason, "GAP_FILL")
        self.assertAlmostEqual(fill.reference_price, 85.0)

    def test_the_gap_fill_is_worse_than_the_stop_would_have_been(self):
        gapped = try_stop_exit("AAA", 10, 90.0, bar(open_=85.0, low=84.0), costs=FREE)
        clean = try_stop_exit("AAA", 10, 90.0, bar(open_=95.0, low=89.0), costs=FREE)
        self.assertLess(gapped.fill_price, clean.fill_price)
        self.assertAlmostEqual(clean.fill_price - gapped.fill_price, 5.0)

    def test_an_untouched_stop_does_not_fill(self):
        self.assertIsNone(
            try_stop_exit("AAA", 10, 90.0, bar(open_=95.0, low=91.0), costs=COSTS)
        )

    def test_stop_at_the_open_is_a_gap_fill(self):
        # 시초가가 정확히 손절가면 그 가격에 팔 수 있었다.
        fill = try_stop_exit("AAA", 10, 90.0, bar(open_=90.0, low=88.0), costs=FREE)
        self.assertEqual(fill.reason, "GAP_FILL")
        self.assertAlmostEqual(fill.fill_price, 90.0)

    def test_bad_stop_is_refused(self):
        with self.assertRaises(ExecutionError):
            try_stop_exit("AAA", 10, 0.0, bar(), costs=COSTS)


class MarketExitTest(unittest.TestCase):
    def test_open_exit_uses_the_open(self):
        fill = execute_market_exit("AAA", 10, bar(open_=97.0, close=99.0), costs=FREE)
        self.assertEqual(fill.reason, "OPEN_EXIT")
        self.assertAlmostEqual(fill.fill_price, 97.0)
        self.assertAlmostEqual(fill.cash_delta, 970.0)

    def test_close_exit_uses_the_close(self):
        fill = execute_market_exit(
            "AAA", 10, bar(open_=97.0, close=99.0), costs=FREE, price_kind="CLOSE"
        )
        self.assertEqual(fill.reason, "CLOSE_EXIT")
        self.assertAlmostEqual(fill.fill_price, 99.0)

    def test_selling_pays_the_cost_too(self):
        fill = execute_market_exit("AAA", 10, bar(open_=100.0), costs=COSTS)
        self.assertAlmostEqual(fill.fill_price, 100.0 * 0.9994)
        self.assertAlmostEqual(
            fill.cash_delta, 10 * fill.fill_price - fill.fees
        )

    def test_unknown_price_kind_is_refused(self):
        with self.assertRaises(ExecutionError):
            execute_market_exit("AAA", 10, bar(), costs=COSTS, price_kind="MID")


class CorporateActionDetectionTest(unittest.TestCase):
    def test_same_scale_is_no_action(self):
        self.assertFalse(
            corporate_action_between(bar(SIGNAL_DATE), bar(EXECUTION_DATE))
        )

    def test_changed_scale_is_an_action(self):
        self.assertTrue(
            corporate_action_between(
                bar(SIGNAL_DATE, scale=2.0), bar(EXECUTION_DATE, scale=1.0)
            )
        )


if __name__ == "__main__":
    unittest.main()
