"""EODHD 어댑터. 네트워크 없이 픽스처로 확인한다.

가장 중요한 테스트는 `TruncationTest`다. 잘린 응답을 조용히 받아들이면 구간 앞부분이
비어 있는 채로 백테스트가 정상 종료한다. `warning`과 `gaps`가 그걸 드러내야 한다.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

TRADING_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TRADING_ROOT))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from backtest import store  # noqa: E402
from backtest.data import BARS_CSV_COLUMNS, PointInTimeSnapshot  # noqa: E402
from backtest.eodhd import (  # noqa: E402
    COMMON_STOCK,
    EodhdClient,
    EodhdError,
    Listing,
    bars_from_eod,
    load_prices,
    missing_universe_symbols,
    parse_listings,
    uncovered_intervals,
    unlisted_symbols,
)

VERSION = "v1"


def eod_row(date: str, close: float = 100.0, factor: float = 1.0, **changes) -> dict:
    row = {
        "date": date,
        "open": close,
        "high": close * 1.01,
        "low": close * 0.99,
        "close": close,
        "adjusted_close": close * factor,
        "volume": 1_000_000,
    }
    row.update(changes)
    return row


class BarConversionTest(unittest.TestCase):
    def test_csv_matches_the_loader_column_contract(self):
        bars = bars_from_eod("AAPL", [eod_row("2026-01-02")])
        self.assertEqual(bars.csv_text.splitlines()[0].split(","), list(BARS_CSV_COLUMNS))
        self.assertEqual(bars.rows, 1)
        self.assertEqual((bars.first, bars.last), ("2026-01-02", "2026-01-02"))

    def test_the_adjustment_factor_survives_the_round_trip(self):
        bars = bars_from_eod("AAPL", [eod_row("2026-01-02", close=200.0, factor=0.5)])
        fields = bars.csv_text.splitlines()[1].split(",")
        self.assertAlmostEqual(float(fields[5]), 200.0)  # close
        self.assertAlmostEqual(float(fields[7]), 100.0)  # adj_close

    def test_rows_that_break_the_schema_are_dropped_not_raised(self):
        payload = [
            eod_row("2026-01-02"),
            eod_row("2026-01-05", close=0.0),  # 0 이하 가격
            eod_row("2026-01-06", adjusted_close=0.0),
            eod_row("2026-01-07", volume=-5),
            {"date": "2026-01-08"},  # 필드 누락
            eod_row("2026-01-09", high=1.0),  # 고가가 최고가 아님
            "쓰레기",
        ]
        bars = bars_from_eod("AAPL", payload)
        self.assertEqual(bars.rows, 1)
        self.assertEqual(bars.dropped, 6)

    def test_a_non_list_payload_is_an_error(self):
        with self.assertRaises(EodhdError):
            bars_from_eod("AAPL", {"error": "nope"})

    def test_an_empty_payload_yields_no_rows(self):
        bars = bars_from_eod("AAPL", [])
        self.assertEqual(bars.rows, 0)
        self.assertIsNone(bars.first)


class TruncationTest(unittest.TestCase):
    """무료 티어는 날짜 범위를 무시하고 최근 1년만 주면서 warning을 넣는다."""

    def test_the_warning_is_captured(self):
        bars = bars_from_eod(
            "AAPL",
            [eod_row("2026-01-02", warning="Data is limited by one year as you have free subscription")],
        )
        self.assertIn("limited by one year", bars.warning)

    def test_covers_detects_a_short_history(self):
        bars = bars_from_eod("AAPL", [eod_row("2025-08-06"), eod_row("2026-08-05")])
        self.assertFalse(bars.covers("2011-01-03"))
        self.assertTrue(bars.covers("2025-09-01"))

    def test_no_warning_when_the_tier_is_not_truncating(self):
        self.assertIsNone(bars_from_eod("AAPL", [eod_row("2026-01-02")]).warning)


class ListingTest(unittest.TestCase):
    def test_the_universe_type_filter_follows_7_2(self):
        common = Listing("AAPL", "Apple", "NASDAQ", COMMON_STOCK, "USD", "US03", False)
        self.assertTrue(common.passes_universe_type_filter)
        for changes in (
            {"security_type": "Preferred Stock"},
            {"security_type": "ETF"},
            {"security_type": "FUND"},
            {"security_type": "Warrant"},
            {"exchange": "PINK"},  # OTC
            {"exchange": "OTCQB"},
            {"currency": "CAD"},
        ):
            import dataclasses

            candidate = dataclasses.replace(common, **changes)
            self.assertFalse(
                candidate.passes_universe_type_filter, msg=str(changes)
            )

    def test_delisted_flag_is_recorded(self):
        rows = [{"Code": "AAAB", "Name": "Admiralty Bancorp", "Exchange": "NASDAQ",
                 "Type": COMMON_STOCK, "Currency": "USD", "Isin": None}]
        listings = parse_listings(rows, delisted=True)
        self.assertTrue(listings[0].delisted)
        self.assertIsNone(listings[0].isin)
        self.assertTrue(listings[0].passes_universe_type_filter)

    def test_a_non_list_payload_is_an_error(self):
        with self.assertRaises(EodhdError):
            parse_listings({"x": 1}, delisted=False)


class FakeClient(EodhdClient):
    def __init__(self, payloads: dict[str, list]) -> None:
        self.payloads = payloads
        self.key = "test"
        self.interval = 0.0
        self._last_call = 0.0
        self.calls = 0

    def eod(self, symbol, start=None, end=None):
        self.calls += 1
        return bars_from_eod(symbol, self.payloads.get(symbol, []))


class UniverseCoverageTest(unittest.TestCase):
    """구성원에 있는데 바가 없는 심볼이 곧 생존편향이다."""

    def setUp(self):
        self.connection = store.connect_memory()
        from backtest.data import load_universe_csv, register_source

        register_source(self.connection, "announcements", VERSION, "universe")
        load_universe_csv(
            self.connection,
            "symbol,index_name,valid_from,valid_to\n"
            "LIVE,SP500,2011-01-03,\n"
            "DEAD,SP500,2011-01-03,2015-06-01\n"
            "LATER,SP500,2026-01-02,\n",
            "announcements",
            VERSION,
        )

    def test_a_delisted_member_without_bars_is_reported(self):
        load_prices(
            self.connection,
            ["LIVE"],
            VERSION,
            client=FakeClient({"LIVE.US": [eod_row("2012-01-03")]}),
        )
        missing = missing_universe_symbols(
            self.connection, VERSION, start="2011-01-03", end="2016-01-04"
        )
        self.assertEqual(missing, ["DEAD"])

    def test_members_outside_the_window_are_not_required(self):
        load_prices(
            self.connection,
            ["LIVE", "DEAD"],
            VERSION,
            client=FakeClient(
                {"LIVE.US": [eod_row("2012-01-03")], "DEAD.US": [eod_row("2012-01-03")]}
            ),
        )
        # LATER는 2026부터 구성원이라 2011~2016 구간에 필요하지 않다.
        self.assertEqual(
            missing_universe_symbols(
                self.connection, VERSION, start="2011-01-03", end="2016-01-04"
            ),
            [],
        )


class UnlistedSymbolsTest(unittest.TestCase):
    """개명한 회사가 조용히 빠지는 것을 적재 전에 잡는 그물."""

    class ListingClient(EodhdClient):
        def __init__(self, live, dead):
            self.key = "test"
            self.interval = 0.0
            self._last_call = 0.0
            self.calls = 0
            self.live, self.dead = live, dead

        def listings(self, exchange="US", delisted=False):
            codes = self.dead if delisted else self.live
            self.calls += 1
            return [
                Listing(code, code, "NYSE", COMMON_STOCK, "USD", None, delisted)
                for code in codes
            ]

    def test_a_renamed_ticker_is_reported(self):
        client = self.ListingClient(live=["MNST"], dead=["MWW"])
        # HANS는 어느 쪽에도 없다 — 개명을 아직 안 걸어준 것이다.
        self.assertEqual(unlisted_symbols(client, ["MNST", "MWW", "HANS"]), ["HANS"])

    def test_the_delisted_list_counts_as_listed(self):
        """폐지 종목은 상장 목록에 없다. 그것만 보면 폐지 전체가 개명으로 오인된다."""
        client = self.ListingClient(live=["MNST"], dead=["MWW"])
        self.assertEqual(unlisted_symbols(client, ["MWW"]), [])
        self.assertEqual(client.calls, 2)


class UncoveredIntervalsTest(unittest.TestCase):
    """티커 재사용은 바가 **있는데** 다른 회사 것이다. 커버리지로만 보인다."""

    def setUp(self):
        self.connection = store.connect_memory()
        from backtest.data import load_universe_csv, register_source

        register_source(self.connection, "announcements", VERSION, "universe")
        load_universe_csv(
            self.connection,
            "symbol,index_name,valid_from,valid_to\n"
            # 옛 SanDisk 자리. 벤더 계열은 2025년 신설 법인 것이라 구간을 못 덮는다.
            "SNDK,SP500,2008-01-02,2016-05-12\n"
            # 정상. 계열이 구간보다 먼저 시작해서 끝까지 간다.
            "AAPL,SP500,2008-01-02,\n"
            # 구간 도중에 계열이 끊긴다.
            "STOPS,SP500,2008-01-02,2016-05-12\n",
            "announcements",
            VERSION,
        )

    def _load(self, payloads):
        symbols = [name.removesuffix(".US") for name in payloads]
        load_prices(self.connection, symbols, VERSION, client=FakeClient(payloads))

    def test_a_reused_ticker_shows_up_as_a_late_start(self):
        self._load(
            {
                "SNDK.US": [eod_row("2025-02-13"), eod_row("2026-08-07")],
                "AAPL.US": [eod_row("2008-01-02"), eod_row("2026-08-07")],
                "STOPS.US": [eod_row("2008-01-02"), eod_row("2016-05-10")],
            }
        )
        found = uncovered_intervals(self.connection, VERSION, end="2026-08-07")
        self.assertEqual(
            [(item.symbol, item.problem) for item in found], [("SNDK", "STARTS_LATE")]
        )

    def test_a_series_that_stops_mid_interval_is_reported(self):
        self._load(
            {
                "SNDK.US": [eod_row("2008-01-02"), eod_row("2016-05-10")],
                "AAPL.US": [eod_row("2008-01-02"), eod_row("2026-08-07")],
                "STOPS.US": [eod_row("2008-01-02"), eod_row("2012-01-03")],
            }
        )
        found = uncovered_intervals(self.connection, VERSION, end="2026-08-07")
        self.assertEqual(
            [(item.symbol, item.problem) for item in found], [("STOPS", "ENDS_EARLY")]
        )

    def test_a_member_with_no_bars_at_all_is_reported(self):
        self._load({"AAPL.US": [eod_row("2008-01-02"), eod_row("2026-08-07")]})
        problems = {item.symbol: item.problem for item in
                    uncovered_intervals(self.connection, VERSION, end="2026-08-07")}
        self.assertEqual(problems, {"SNDK": "NO_BARS", "STOPS": "NO_BARS"})

    def test_a_back_filled_reuse_is_not_caught(self):
        """**이 그물이 못 잡는 것을 고정해둔다.**

        벤더가 생존 회사 이력을 구간 전체에 back-fill하면 커버리지는 완벽하다. `MNST`가
        그랬다. 그것은 다구간 심볼을 이름으로 확인해야 보이고, 이 함수의 일이 아니다.
        """
        self._load(
            {
                "SNDK.US": [eod_row("1995-01-03"), eod_row("2026-08-07")],
                "AAPL.US": [eod_row("2008-01-02"), eod_row("2026-08-07")],
                "STOPS.US": [eod_row("1995-01-03"), eod_row("2026-08-07")],
            }
        )
        self.assertEqual(uncovered_intervals(self.connection, VERSION, end="2026-08-07"), [])


class LoadPricesTest(unittest.TestCase):
    def setUp(self):
        self.connection = store.connect_memory()

    def client(self) -> FakeClient:
        return FakeClient(
            {
                "AAPL.US": [eod_row(f"2026-01-{day:02d}") for day in range(2, 10)],
                "SHORT.US": [eod_row("2026-08-03"), eod_row("2026-08-04")],
                "GONE.US": [],
            }
        )

    def test_symbols_are_stored_without_the_exchange_suffix(self):
        summary = load_prices(
            self.connection, ["AAPL"], VERSION, client=self.client()
        )
        self.assertEqual(summary["loaded"], 1)
        symbols = [
            row["symbol"]
            for row in self.connection.execute("SELECT DISTINCT symbol FROM bars_daily")
        ]
        self.assertEqual(symbols, ["AAPL"])

    def test_a_symbol_with_no_data_is_reported_not_silent(self):
        summary = load_prices(
            self.connection, ["AAPL", "GONE"], VERSION, client=self.client()
        )
        self.assertEqual(summary["empty"], ["GONE"])
        self.assertEqual(summary["loaded"], 1)

    def test_a_short_history_shows_up_as_a_gap(self):
        summary = load_prices(
            self.connection,
            ["AAPL", "SHORT"],
            VERSION,
            client=self.client(),
            start="2026-01-02",
        )
        self.assertEqual(summary["gaps"], ["SHORT"])

    def test_no_start_means_no_gap_report(self):
        summary = load_prices(
            self.connection, ["AAPL", "SHORT"], VERSION, client=self.client()
        )
        self.assertEqual(summary["gaps"], [])

    def source_row(self):
        return self.connection.execute(
            "SELECT point_in_time, survivorship_biased, note FROM data_sources"
            " WHERE source = 'eodhd' AND kind = 'bars'"
        ).fetchone()

    def test_bias_defaults_to_true_until_coverage_is_verified(self):
        """생존 종목 몇 개만 받아놓고 편향 없음을 선언하면 14.7 blocker가 안 걸린다."""
        load_prices(self.connection, ["AAPL"], VERSION, client=self.client())
        row = self.source_row()
        self.assertEqual(row["point_in_time"], 1)
        self.assertEqual(row["survivorship_biased"], 1)
        self.assertIn("미확인", row["note"])

    def test_verified_coverage_can_declare_no_bias(self):
        load_prices(
            self.connection,
            ["AAPL"],
            VERSION,
            client=self.client(),
            delisted_coverage_verified=True,
        )
        row = self.source_row()
        self.assertEqual(row["survivorship_biased"], 0)
        self.assertIn("확인됨", row["note"])

    def test_loaded_bars_answer_point_in_time_queries(self):
        load_prices(self.connection, ["AAPL"], VERSION, client=self.client())
        snapshot = PointInTimeSnapshot(
            self.connection, "2026-01-06", VERSION, reference_symbol="AAPL"
        )
        bars = snapshot.bars("AAPL")
        self.assertEqual([bar.trade_date for bar in bars][-1], "2026-01-06")
        self.assertTrue(all(bar.trade_date <= "2026-01-06" for bar in bars))
        self.assertAlmostEqual(bars[-1].price_scale, 1.0)


if __name__ == "__main__":
    unittest.main()
