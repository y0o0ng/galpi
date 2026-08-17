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
from core.core1 import PAPER_CORE_V1  # noqa: E402
from backtest.policy import DEFAULT_PARAMETERS  # noqa: E402

MAX_HOLD_SESSIONS = DEFAULT_PARAMETERS.max_hold_sessions

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
    days: int = TOTAL,
    earnings_csv: str | None = None,
    spy_closes=None,
    trend_closes=None,
) -> tuple[sqlite3.Connection, list[str]]:
    """합성 픽스처. `spy_closes`·`trend_closes`는 `(일수, ...)` → 종가 목록이다.

    `trend_closes(days, start_price, step)`는 랭킹 상위가 되는 종목의 경로를 바꾼다.
    기본값은 계단식 상승이고, 손절이 실제로 걸리는 실행을 만들려면 하락 꼬리가 붙은
    경로가 필요하다(PR #19).
    """
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
                trend_closes(days, 50.0, step)
                if trend_closes
                else synthetic.staircase_closes(days, 50.0, step),
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


class ModeValidationTest(unittest.TestCase):
    """모르는 모드는 기동에서 거부한다.

    오타가 조용히 `CORE`로 읽히면 어떤 규칙으로 낸 결과인지 알 수 없게 되고, 보고서의
    provenance는 설정값을 그대로 찍으므로 거짓 기록이 남는다.
    """

    def test_an_unknown_entry_mode_is_refused(self):
        with self.assertRaises(ValueError):
            BacktestConfig(source_version="v", start="a", end="b", entry_mode="RS")

    def test_an_unknown_exit_mode_is_refused(self):
        with self.assertRaises(ValueError):
            BacktestConfig(source_version="v", start="a", end="b", exit_mode="FIXED")


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
        limit = PAPER_CORE_V1.limits.max_positions
        self.assertLessEqual(
            max(point.open_positions for point in self.result.equity_curve), limit
        )

    def test_exposure_stays_inside_the_profile_cap(self):
        cap = PAPER_CORE_V1.profile.max_exposure
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


class MarketLabelTest(unittest.TestCase):
    """시장 라벨은 게이팅과 무관하게 항상 남는다.

    어떤 시장에서 벌었는지는 실행이 끝난 뒤에 묻게 되는데, 그때 라벨이 없으면 자산
    곡선만으로는 다시 만들 수 없다. CORE 모드에서도 기록되어야 기준선을 시장 상태별로
    접을 수 있다.
    """

    @classmethod
    def setUpClass(cls):
        cls.connection, cls.dates = build()
        cls.result = run_backtest(cls.connection, config(cls.dates))

    def test_a_core_run_still_records_the_market_label(self):
        self.assertEqual(self.result.config.regime_mode, "CORE")
        labels = {point.market_regime for point in self.result.equity_curve}
        self.assertTrue(labels)
        self.assertNotIn("UNKNOWN", labels)
        for label in labels:
            trend, _, volatility = label.partition("/")
            self.assertIn(trend, ("BULL", "CORRECTION", "RECOVERY", "BEAR"))
            self.assertIn(volatility, ("LOW_VOL", "HIGH_VOL"))

    def test_the_gating_state_is_kept_separately(self):
        """두 열이 서로 다른 것을 가리킨다. 하나로 합치면 둘 중 하나를 잃는다."""
        states = {point.regime for point in self.result.equity_curve}
        self.assertTrue(states <= {"GREEN", "YELLOW", "RED", "UNKNOWN"}, msg=str(states))

    def test_the_label_survives_into_the_database(self):
        save_run(self.connection, self.result, "run-label", survivorship_biased=True)
        rows = self.connection.execute(
            "SELECT market_regime FROM backtest_equity WHERE run_id = 'run-label'"
        ).fetchall()
        self.assertEqual(len(rows), len(self.result.equity_curve))
        self.assertTrue(all(row["market_regime"] for row in rows))


class DelistingTest(unittest.TestCase):
    """거래를 멈춘 종목은 **재개를 기다리지 않고** 그 자리에서 끝난다.

    기다리면 두 가지가 망가진다. 슬롯이 영구 점유되어 신규 진입이 막히고(2026-08-14
    실측: 13.6년 정지), 몇 년 뒤 같은 티커를 물려받은 **다른 회사 주가로 청산**된다.
    """

    def run_with(self, status: str, scenario: str = "LAST_CLOSE"):
        connection, dates = build()
        stop_date = dates[WARMUP + 10]
        connection.execute(
            "INSERT INTO delistings"
            " (symbol, source_version, last_trade_date, status, evidence)"
            " VALUES (?, ?, ?, ?, '테스트')",
            ("TRENDA", VERSION, stop_date, status),
        )
        connection.commit()
        result = run_backtest(
            connection, config(dates, unresolved_exit_price=scenario)
        )
        return result, stop_date

    def test_a_delisted_position_exits_at_the_last_traded_price(self):
        result, stop_date = self.run_with("DELISTED")
        closed = [t for t in result.trades if t.exit_reason == "DELISTED_EXIT"]
        self.assertTrue(closed, msg=str(result.exit_counts))
        for trade in closed:
            self.assertEqual(trade.symbol, "TRENDA")
            self.assertEqual(trade.exit_date, stop_date)
            self.assertGreater(trade.exit_price, 0.0)
        # 그 뒤로 같은 종목을 다시 들고 있지 않다.
        self.assertNotIn("TRENDA", {p.symbol for p in result.open_positions})

    def test_an_unresolved_position_follows_the_scenario(self):
        """경계조건이 결과를 얼마나 흔드는지 재려면 두 끝이 실제로 달라야 한다."""
        last_close, _ = self.run_with("UNRESOLVED", "LAST_CLOSE")
        zero, _ = self.run_with("UNRESOLVED", "ZERO")
        for result in (last_close, zero):
            self.assertTrue(
                [t for t in result.trades if t.exit_reason == "UNRESOLVED_EXIT"]
            )
        recovered = sum(
            t.pnl for t in last_close.trades if t.exit_reason == "UNRESOLVED_EXIT"
        )
        wiped = sum(t.pnl for t in zero.trades if t.exit_reason == "UNRESOLVED_EXIT")
        self.assertGreater(recovered, wiped)
        self.assertLess(zero.final_equity, last_close.final_equity)

    def test_the_cash_identity_survives_a_terminal_exit(self):
        """바 없이 만든 체결도 현금 항등식을 지켜야 한다. 아니면 지표 전체를 못 믿는다."""
        for status in ("DELISTED", "UNRESOLVED"):
            with self.subTest(status=status):
                result, _ = self.run_with(status)
                last = result.equity_curve[-1]
                self.assertAlmostEqual(
                    last.cash,
                    CAPITAL + sum(fill.cash_delta for fill in result.fills),
                    places=6,
                )

    def test_a_zero_exit_charges_no_fees(self):
        result, _ = self.run_with("UNRESOLVED", "ZERO")
        wiped = [f for f in result.fills if f.reason == "UNRESOLVED_EXIT"]
        self.assertTrue(wiped)
        for fill in wiped:
            self.assertEqual(fill.fill_price, 0.0)
            self.assertEqual(fill.fees, 0.0)


class PersistenceTest(unittest.TestCase):
    def test_saved_run_keeps_the_conditions(self):
        connection, dates = build()
        result = run_backtest(connection, config(dates))
        save_run(connection, result, "run-1", survivorship_biased=True)

        row = connection.execute("SELECT * FROM backtest_runs").fetchone()
        self.assertEqual(row["run_id"], "run-1")
        self.assertEqual(row["survivorship_biased"], 1)
        self.assertEqual(row["require_earnings_calendar"], 0)
        self.assertEqual(row["policy_signature"], PAPER_CORE_V1.signature)
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
