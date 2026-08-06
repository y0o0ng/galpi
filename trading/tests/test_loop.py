"""실행 loop. 설계 18장 `nightly_run`과 11.1·11.2.

가장 중요한 테스트 두 개다.

- `test_future_bars_do_not_change_the_past_run`: 구간 뒤에 바를 더 넣어도 같은 결과가
  나와야 한다. 조각마다 룩어헤드를 막아도 조립하면서 새로 생길 수 있다.
- `test_cash_and_equity_reconcile`: 마지막 자산이 초기 자본 + 실현 손익 + 미실현
  평가액과 맞아야 한다. 현금 흐름이 어긋나면 성과 지표 전체가 무의미하다.
"""

from __future__ import annotations

import sqlite3
import sys
import unittest
from dataclasses import replace
from pathlib import Path

TRADING_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TRADING_ROOT))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import synthetic  # noqa: E402
from backtest import store  # noqa: E402
from backtest.data import (  # noqa: E402
    load_bars_csv,
    load_earnings_csv,
    load_securities_csv,
    load_universe_csv,
    register_source,
)
from backtest.loop import BacktestConfig, run_backtest, save_run  # noqa: E402
from backtest.policy import DEFAULT_PAPER_POLICY  # noqa: E402
from backtest.positions import MAX_HOLD_SESSIONS  # noqa: E402

VERSION = "v1"
WARMUP = 300
TRADING = 60
TOTAL = WARMUP + TRADING
SPY_PRICE = 400.0
FLAT_COUNT = 30
TREND_NAMES = ("TRENDA", "TRENDB", "TRENDC", "TRENDD", "TRENDE", "TRENDF")
TREND_STEPS = (0.030, 0.027, 0.024, 0.021, 0.018, 0.015)
TREND_RANGE = 0.005
CAPITAL = 100_000.0


def build(
    days: int = TOTAL, earnings_csv: str | None = None, spy_closes=None
) -> tuple[sqlite3.Connection, list[str]]:
    dates = synthetic.sessions(days)
    connection = store.connect_memory()
    for kind in ("bars", "universe", "securities"):
        register_source(connection, "synthetic", VERSION, kind)

    groups = [
        synthetic.rows(
            "SPY",
            dates,
            spy_closes(days) if spy_closes else synthetic.constant_closes(days, SPY_PRICE),
        )
    ]
    symbols = []
    for index in range(FLAT_COUNT):
        symbol = f"FLAT{index:02d}"
        symbols.append((symbol, "UTIL"))
        groups.append(
            synthetic.rows(symbol, dates, synthetic.constant_closes(days, 100.0))
        )
    for order, (symbol, step) in enumerate(zip(TREND_NAMES, TREND_STEPS)):
        symbols.append((symbol, f"SECTOR{order}"))
        groups.append(
            synthetic.rows(
                symbol,
                dates,
                synthetic.staircase_closes(days, 50.0, step),
                range_pct=TREND_RANGE,
            )
        )
    load_bars_csv(connection, synthetic.to_csv(*groups), "synthetic", VERSION)
    load_universe_csv(
        connection,
        "symbol,index_name,valid_from,valid_to\n"
        + "".join(f"{symbol},SP500,{dates[0]},\n" for symbol, _ in symbols),
        "synthetic",
        VERSION,
    )
    load_securities_csv(
        connection,
        "symbol,sector\n" + "".join(f"{symbol},{sector}\n" for symbol, sector in symbols),
        "synthetic",
        VERSION,
    )
    if earnings_csv is not None:
        register_source(connection, "synthetic", VERSION, "earnings")
        load_earnings_csv(connection, earnings_csv, "synthetic", VERSION)
    return connection, dates


def config(dates: list[str], **changes) -> BacktestConfig:
    base = BacktestConfig(
        source_version=VERSION,
        start=dates[WARMUP],
        end=dates[-1],
        initial_capital=CAPITAL,
        require_earnings_calendar=False,
    )
    return replace(base, **changes) if changes else base


class RunTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.connection, cls.dates = build()
        cls.result = run_backtest(cls.connection, config(cls.dates))

    def test_the_curve_covers_every_session_in_range(self):
        self.assertEqual(len(self.result.equity_curve), TRADING)
        self.assertEqual(self.result.equity_curve[0].trade_date, self.dates[WARMUP])
        self.assertEqual(self.result.equity_curve[-1].trade_date, self.dates[TOTAL - 1])

    def test_entries_happen_and_are_the_strongest_trends(self):
        entered = {position.symbol for position in self.result.open_positions}
        entered |= {trade.symbol for trade in self.result.trades}
        self.assertTrue(entered)
        self.assertTrue(entered <= set(TREND_NAMES), msg=str(entered))
        self.assertIn("TRENDA", entered)

    def test_daily_entry_cap_is_respected(self):
        """10.1 하루 진입 최대 2종목. GREEN에서 상한이 2다."""
        by_date: dict[str, int] = {}
        for trade in self.result.trades:
            by_date[trade.entry_date] = by_date.get(trade.entry_date, 0) + 1
        for position in self.result.open_positions:
            by_date[position.entry_date] = by_date.get(position.entry_date, 0) + 1
        self.assertTrue(by_date)
        self.assertLessEqual(max(by_date.values()), 2, msg=str(by_date))

    def test_never_more_than_five_positions(self):
        limit = DEFAULT_PAPER_POLICY.limits.max_positions
        self.assertLessEqual(
            max(point.open_positions for point in self.result.equity_curve), limit
        )

    def test_exposure_stays_inside_the_profile_cap(self):
        cap = DEFAULT_PAPER_POLICY.profile.max_exposure
        for point in self.result.equity_curve:
            self.assertLessEqual(point.exposure / point.equity, cap + 1e-9)

    def test_cash_and_equity_reconcile(self):
        """초기 자본 + 모든 체결의 현금 변화 = 마지막 현금. 수수료까지 포함한 항등식이다."""
        last = self.result.equity_curve[-1]
        self.assertTrue(self.result.fills)
        self.assertAlmostEqual(
            last.cash,
            CAPITAL + sum(fill.cash_delta for fill in self.result.fills),
            places=6,
        )
        self.assertAlmostEqual(last.cash + last.exposure, last.equity, places=6)

    def test_trade_pnl_is_price_move_minus_fees(self):
        """분할이 없는 구간에서는 손익을 독립 공식으로 다시 낼 수 있다."""
        self.assertTrue(self.result.trades)
        for trade in self.result.trades:
            expected = (
                trade.shares * (trade.exit_price - trade.entry_price) - trade.fees
            )
            self.assertAlmostEqual(trade.pnl, expected, places=6)

    def test_every_entry_fill_has_a_position_or_a_trade(self):
        buys = [fill for fill in self.result.fills if fill.side == "BUY"]
        sells = [fill for fill in self.result.fills if fill.side == "SELL"]
        self.assertEqual(len(buys), len(self.result.trades) + len(self.result.open_positions))
        self.assertEqual(len(sells), len(self.result.trades))

    def test_counters_are_recorded(self):
        self.assertIn("SMA_NOT_ALIGNED", self.result.skip_counts)
        self.assertTrue(
            set(self.result.fill_counts) & {"OPEN_FILL", "LIMIT_FILL"},
            msg=str(self.result.fill_counts),
        )

    def test_trades_carry_r_and_excursions(self):
        for trade in self.result.trades:
            self.assertGreaterEqual(trade.mfe_r, trade.mae_r)
            self.assertGreater(trade.fees, 0.0)
            self.assertGreaterEqual(trade.sessions_held, 1)

    def test_the_run_is_deterministic(self):
        again = run_backtest(self.connection, config(self.dates))
        self.assertEqual(self.result.trades, again.trades)
        self.assertEqual(self.result.equity_curve, again.equity_curve)
        self.assertEqual(self.result.skip_counts, again.skip_counts)


class LookaheadTest(unittest.TestCase):
    def test_future_bars_do_not_change_the_past_run(self):
        """조각마다 막아도 조립하면서 룩어헤드가 새로 생길 수 있다."""
        short_connection, short_dates = build(TOTAL)
        long_connection, long_dates = build(TOTAL + 40)
        short = run_backtest(short_connection, config(short_dates))
        long_run = run_backtest(
            long_connection,
            replace(config(long_dates), end=long_dates[TOTAL - 1]),
        )
        self.assertEqual(short.equity_curve, long_run.equity_curve)
        self.assertEqual(short.trades, long_run.trades)


class ExitPathTest(unittest.TestCase):
    def test_max_hold_closes_a_long_winner(self):
        """상승만 하는 종목은 손절에 걸리지 않으므로 최대 보유로 나간다."""
        connection, dates = build(WARMUP + MAX_HOLD_SESSIONS + 10)
        result = run_backtest(connection, config(dates))
        self.assertTrue(result.trades)
        self.assertEqual(set(result.exit_counts), {"MAX_HOLD"})
        for trade in result.trades:
            self.assertEqual(trade.exit_reason, "MAX_HOLD")
            self.assertEqual(trade.exit_fill_reason, "OPEN_EXIT")
            self.assertEqual(trade.sessions_held, MAX_HOLD_SESSIONS)

    def test_earnings_close_the_position_early(self):
        earnings_date = synthetic.sessions(TOTAL)[WARMUP + 12]
        published = synthetic.sessions(TOTAL)[WARMUP - 10]
        connection, dates = build(
            earnings_csv="symbol,event_at,published_at,confidence\n"
            + "".join(
                f"{symbol},{earnings_date},{published},confirmed\n" for symbol in TREND_NAMES
            )
        )
        result = run_backtest(connection, config(dates))
        self.assertIn("EARNINGS", result.exit_counts)
        for trade in result.trades:
            if trade.exit_reason == "EARNINGS":
                self.assertLess(trade.exit_date, earnings_date)
                self.assertEqual(trade.exit_fill_reason, "CLOSE_EXIT")

    def test_a_red_regime_blocks_new_entries(self):
        def collapsing(days: int) -> list[float]:
            # 마지막 40세션을 급락시키면 변동성과 SMA200 조건이 함께 무너진다.
            return synthetic.constant_closes(days - 40, SPY_PRICE) + [
                SPY_PRICE * (0.97**index) for index in range(1, 41)
            ]

        connection, dates = build(spy_closes=collapsing)
        result = run_backtest(connection, config(dates))
        states = {point.regime for point in result.equity_curve}
        self.assertIn("RED", states)
        self.assertIn("REGIME_RED", result.skip_counts)


class PersistenceTest(unittest.TestCase):
    def test_saved_run_keeps_the_conditions(self):
        connection, dates = build()
        result = run_backtest(connection, config(dates))
        save_run(connection, result, "run-1", survivorship_biased=True)

        row = connection.execute("SELECT * FROM backtest_runs").fetchone()
        self.assertEqual(row["run_id"], "run-1")
        self.assertEqual(row["survivorship_biased"], 1)
        self.assertEqual(row["require_earnings_calendar"], 0)
        self.assertEqual(row["policy_signature"], DEFAULT_PAPER_POLICY.signature)
        self.assertAlmostEqual(row["final_equity"], result.final_equity)
        self.assertIn("SMA_NOT_ALIGNED", row["skip_counts"])

        trades = connection.execute("SELECT COUNT(*) AS n FROM backtest_trades").fetchone()
        self.assertEqual(trades["n"], len(result.trades))
        curve = connection.execute("SELECT COUNT(*) AS n FROM backtest_equity").fetchone()
        self.assertEqual(curve["n"], len(result.equity_curve))

    def test_saving_twice_does_not_duplicate(self):
        connection, dates = build()
        result = run_backtest(connection, config(dates))
        save_run(connection, result, "run-1", survivorship_biased=True)
        save_run(connection, result, "run-1", survivorship_biased=True)
        rows = connection.execute("SELECT COUNT(*) AS n FROM backtest_trades").fetchone()
        self.assertEqual(rows["n"], len(result.trades))


if __name__ == "__main__":
    unittest.main()
