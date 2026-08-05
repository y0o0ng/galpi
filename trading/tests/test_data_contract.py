"""3단계 게이트: 재현성 테스트와 미래정보 누출 0건.

설계 14.3은 point-in-time 구성원과 당시 공개 시각을, 3.1은 같은 입력에 같은 결과를
요구한다. 이 테스트는 그 두 요구를 조회 경로와 적재 경로에 고정한다.
"""

from __future__ import annotations

import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

TRADING_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TRADING_ROOT))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import synthetic  # noqa: E402
from backtest import store  # noqa: E402
from backtest.data import (  # noqa: E402
    BARS_CSV_COLUMNS,
    Bar,
    DataContractError,
    PointInTimeSnapshot,
    load_bars_csv,
    load_earnings_csv,
    load_universe_csv,
    register_source,
)
from paper import db as paper_db  # noqa: E402

VERSION = "v1"


def make_db(days: int = 60) -> tuple[sqlite3.Connection, list[str]]:
    """SPY 하나만 있는 저장소와 그 거래일 목록."""
    connection = store.connect_memory()
    register_source(connection, "synthetic", VERSION, "bars")
    dates = synthetic.sessions(days)
    load_bars_csv(
        connection,
        synthetic.to_csv(synthetic.rows("SPY", dates, synthetic.constant_closes(days, 400.0))),
        "synthetic",
        VERSION,
    )
    return connection, dates


class SourceRegistrationTest(unittest.TestCase):
    def test_unregistered_source_cannot_load(self):
        connection = store.connect_memory()
        dates = synthetic.sessions(3)
        with self.assertRaises(DataContractError) as caught:
            load_bars_csv(
                connection,
                synthetic.to_csv(synthetic.rows("SPY", dates, synthetic.constant_closes(3, 400.0))),
                "synthetic",
                VERSION,
            )
        self.assertIn("선언되지 않은 출처", str(caught.exception))

    def test_survivorship_bias_defaults_to_true(self):
        """편향 없음은 증명해야 하는 주장이므로 기본값이 '편향 있음'이다."""
        connection, dates = make_db()
        snapshot = PointInTimeSnapshot(connection, dates[-1], VERSION)
        self.assertTrue(snapshot.survivorship_biased)

        clean = store.connect_memory()
        register_source(
            clean,
            "vendor",
            "pit-2026",
            "bars",
            point_in_time=True,
            survivorship_biased=False,
        )
        load_bars_csv(
            clean,
            synthetic.to_csv(
                synthetic.rows("SPY", dates, synthetic.constant_closes(len(dates), 400.0))
            ),
            "vendor",
            "pit-2026",
        )
        self.assertFalse(
            PointInTimeSnapshot(clean, dates[-1], "pit-2026").survivorship_biased
        )

    def test_one_biased_kind_marks_the_whole_snapshot(self):
        """가격은 깨끗해도 구성원이 편향이면 그 스냅샷의 결과는 판정에 쓸 수 없다."""
        connection = store.connect_memory()
        dates = synthetic.sessions(30)
        register_source(connection, "vendor", "mixed", "bars", survivorship_biased=False)
        register_source(connection, "static-list", "mixed", "universe", survivorship_biased=True)
        load_bars_csv(
            connection,
            synthetic.to_csv(
                synthetic.rows("SPY", dates, synthetic.constant_closes(len(dates), 400.0))
            ),
            "vendor",
            "mixed",
        )
        self.assertTrue(
            PointInTimeSnapshot(connection, dates[-1], "mixed").survivorship_biased
        )


class ImmutabilityTest(unittest.TestCase):
    def test_same_version_cannot_be_overwritten(self):
        connection, dates = make_db()
        with self.assertRaises(DataContractError) as caught:
            load_bars_csv(
                connection,
                synthetic.to_csv(
                    synthetic.rows("SPY", dates, synthetic.constant_closes(len(dates), 999.0))
                ),
                "synthetic",
                VERSION,
            )
        self.assertIn("새 source_version", str(caught.exception))
        row = connection.execute(
            "SELECT raw_close FROM bars_daily WHERE symbol='SPY' AND trade_date=?",
            (dates[-1],),
        ).fetchone()
        self.assertAlmostEqual(row["raw_close"], 400.0)

    def test_revision_lands_in_a_new_version_and_leaves_the_old_snapshot_alone(self):
        connection, dates = make_db()
        before = PointInTimeSnapshot(connection, dates[-1], VERSION).snapshot_id

        register_source(connection, "synthetic", "v2", "bars")
        load_bars_csv(
            connection,
            synthetic.to_csv(
                synthetic.rows("SPY", dates, synthetic.constant_closes(len(dates), 410.0))
            ),
            "synthetic",
            "v2",
        )

        self.assertEqual(
            PointInTimeSnapshot(connection, dates[-1], VERSION).snapshot_id, before
        )
        self.assertNotEqual(
            PointInTimeSnapshot(connection, dates[-1], "v2").snapshot_id, before
        )
        self.assertAlmostEqual(
            PointInTimeSnapshot(connection, dates[-1], VERSION).bars("SPY")[-1].raw_close,
            400.0,
        )


class PointInTimeTest(unittest.TestCase):
    def test_bars_never_reach_past_as_of(self):
        connection, dates = make_db()
        as_of = dates[30]
        snapshot = PointInTimeSnapshot(connection, as_of, VERSION)
        bars = snapshot.bars("SPY")
        self.assertEqual(len(bars), 31)
        self.assertEqual(bars[-1].trade_date, as_of)
        self.assertTrue(all(bar.trade_date <= as_of for bar in bars))

    def test_count_returns_the_most_recent_bars_in_order(self):
        connection, dates = make_db()
        snapshot = PointInTimeSnapshot(connection, dates[30], VERSION)
        recent = snapshot.bars("SPY", 5)
        self.assertEqual([bar.trade_date for bar in recent], dates[26:31])

    def test_non_session_as_of_is_refused(self):
        """휴장일이나 데이터 공백으로는 스냅샷을 만들 수 없다."""
        connection, _ = make_db()
        for bad in ("2018-01-06", "2017-12-31"):
            with self.assertRaises(DataContractError) as caught:
                PointInTimeSnapshot(connection, bad, VERSION)
            self.assertIn("거래일이 아닙니다", str(caught.exception))

    def test_membership_is_point_in_time(self):
        connection, dates = make_db()
        register_source(connection, "static-list", VERSION, "universe")
        load_universe_csv(
            connection,
            "symbol,index_name,valid_from,valid_to\n"
            f"OLD,SP500,{dates[0]},{dates[20]}\n"
            f"NEW,SP500,{dates[20]},\n"
            f"NDX,NDX100,{dates[0]},\n",
            "static-list",
            VERSION,
        )
        early = PointInTimeSnapshot(connection, dates[10], VERSION)
        self.assertEqual(early.members("SP500"), frozenset({"OLD"}))
        self.assertEqual(early.members(), frozenset({"OLD", "NDX"}))

        # 구간은 [valid_from, valid_to)다. 편출 당일은 이미 구성원이 아니다.
        later = PointInTimeSnapshot(connection, dates[20], VERSION)
        self.assertEqual(later.members("SP500"), frozenset({"NEW"}))

    def test_earnings_are_invisible_until_published(self):
        connection, dates = make_db()
        register_source(connection, "calendar", VERSION, "earnings")
        load_earnings_csv(
            connection,
            "symbol,event_at,published_at,confidence\n"
            f"AAA,{dates[40]},{dates[30]},confirmed\n",
            "calendar",
            VERSION,
        )
        self.assertIsNone(
            PointInTimeSnapshot(connection, dates[29], VERSION).next_earnings("AAA")
        )
        # 공개된 날 장 마감 후에는 알고 있다. 여기서 보수적으로 굴면 실적을 못 보고
        # 포지션을 들고 가게 되므로 안전한 방향이 아니다.
        self.assertEqual(
            PointInTimeSnapshot(connection, dates[30], VERSION).next_earnings("AAA"),
            dates[40],
        )
        # 발표 당일 장 마감 후에는 다음 일정이 아니다.
        self.assertIsNone(
            PointInTimeSnapshot(connection, dates[40], VERSION).next_earnings("AAA")
        )

    def test_snapshot_id_is_stable_and_sensitive(self):
        connection, dates = make_db()
        first = PointInTimeSnapshot(connection, dates[-1], VERSION).snapshot_id
        again = PointInTimeSnapshot(connection, dates[-1], VERSION).snapshot_id
        self.assertEqual(first, again)
        self.assertEqual(len(first), 64)
        self.assertNotEqual(
            PointInTimeSnapshot(connection, dates[-2], VERSION).snapshot_id, first
        )

        register_source(connection, "static-list", VERSION, "universe")
        load_universe_csv(
            connection,
            f"symbol,index_name,valid_from,valid_to\nAAA,SP500,{dates[0]},\n",
            "static-list",
            VERSION,
        )
        self.assertNotEqual(
            PointInTimeSnapshot(connection, dates[-1], VERSION).snapshot_id, first
        )


class AdjustmentTest(unittest.TestCase):
    def test_adjusted_ohlc_comes_from_the_daily_factor(self):
        connection = store.connect_memory()
        register_source(connection, "synthetic", VERSION, "bars")
        load_bars_csv(
            connection,
            "symbol,trade_date,open,high,low,close,volume,adj_close\n"
            "AAA,2020-01-02,100,110,90,100,1000,50\n",
            "synthetic",
            VERSION,
        )
        row = connection.execute("SELECT * FROM bars_daily").fetchone()
        self.assertAlmostEqual(row["adj_open"], 50.0)
        self.assertAlmostEqual(row["adj_high"], 55.0)
        self.assertAlmostEqual(row["adj_low"], 45.0)
        self.assertAlmostEqual(row["adj_close"], 50.0)
        self.assertAlmostEqual(row["raw_close"], 100.0)

    def test_price_scale_returns_order_prices(self):
        """분할 이전 구간에서도 그날 실제 주문 가격을 되찾을 수 있어야 한다."""
        connection = store.connect_memory()
        register_source(connection, "synthetic", VERSION, "bars")
        dates = synthetic.sessions(4)
        raw = [200.0, 200.0, 100.0, 100.0]
        factors = [0.5, 0.5, 1.0, 1.0]
        load_bars_csv(
            connection,
            synthetic.to_csv(synthetic.rows("SPY", dates, raw, adj_factors=factors)),
            "synthetic",
            VERSION,
        )
        bars = PointInTimeSnapshot(connection, dates[-1], VERSION).bars("SPY")
        self.assertAlmostEqual(bars[0].adj_close, 100.0)
        self.assertAlmostEqual(bars[-1].adj_close, 100.0)
        self.assertAlmostEqual(bars[0].price_scale, 2.0)
        self.assertAlmostEqual(bars[-1].price_scale, 1.0)

    def test_dollar_volume_uses_raw_prices(self):
        connection = store.connect_memory()
        register_source(connection, "synthetic", VERSION, "bars")
        load_bars_csv(
            connection,
            "symbol,trade_date,open,high,low,close,volume,adj_close\n"
            "AAA,2020-01-02,100,100,100,100,1000,50\n",
            "synthetic",
            VERSION,
        )
        row = connection.execute("SELECT * FROM bars_daily").fetchone()
        self.assertAlmostEqual(Bar.from_row(row).dollar_volume, 100_000.0)


class SchemaGuardTest(unittest.TestCase):
    def test_impossible_bars_are_refused(self):
        connection = store.connect_memory()
        register_source(connection, "synthetic", VERSION, "bars")
        with self.assertRaises(sqlite3.IntegrityError):
            connection.execute(
                "INSERT INTO bars_daily (symbol, trade_date, raw_open, raw_high, raw_low,"
                " raw_close, raw_volume, adj_open, adj_high, adj_low, adj_close, source,"
                " source_version) VALUES ('AAA','2020-01-02',10,9,11,10,100,10,9,11,10,"
                "'synthetic','v1')"
            )
        with self.assertRaises(sqlite3.IntegrityError):
            connection.execute(
                "INSERT INTO bars_daily (symbol, trade_date, raw_open, raw_high, raw_low,"
                " raw_close, raw_volume, adj_open, adj_high, adj_low, adj_close, source,"
                " source_version) VALUES ('AAA','2020/01/02',10,11,9,10,100,10,11,9,10,"
                "'synthetic','v1')"
            )

    def test_csv_columns_are_required(self):
        connection = store.connect_memory()
        register_source(connection, "synthetic", VERSION, "bars")
        with self.assertRaises(DataContractError) as caught:
            load_bars_csv(connection, "symbol,trade_date,close\nAAA,2020-01-02,10\n", "synthetic", VERSION)
        self.assertIn("adj_close", str(caught.exception))
        self.assertEqual(len(BARS_CSV_COLUMNS), 8)


class StoreIsolationTest(unittest.TestCase):
    def test_backtest_db_is_its_own_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = store.resolve_backtest_db_path(tmp)
            self.assertEqual(path.name, "backtest.db")

    def test_operational_stores_are_unreachable(self):
        """연구 저장소가 PAPER 운영 DB나 갈피 본체로 해석되는 일은 없다."""
        self.assertIn("trading-paper.db", store.FORBIDDEN_DB_NAMES)
        self.assertTrue(paper_db.FORBIDDEN_DB_NAMES <= store.FORBIDDEN_DB_NAMES)
        with tempfile.TemporaryDirectory() as tmp:
            nested_live = Path(tmp) / "live" / "data"
            nested_live.mkdir(parents=True)
            with self.assertRaises(store.BacktestStorageError):
                store.resolve_backtest_db_path(nested_live)

    def test_connection_opens_exactly_the_backtest_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            connection = store.connect(tmp)
            try:
                attached = [
                    (row["name"], row["file"])
                    for row in connection.execute("PRAGMA database_list")
                ]
                self.assertEqual(len(attached), 1)
                self.assertEqual(
                    Path(attached[0][1]), Path(tmp).resolve() / "backtest.db"
                )
            finally:
                connection.close()


if __name__ == "__main__":
    unittest.main()
