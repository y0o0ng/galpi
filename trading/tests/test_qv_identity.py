"""QV Phase 0 identity: issuer/class/ticker/valuation PIT 불변식."""

from __future__ import annotations

import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

TRADING_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TRADING_ROOT))

from backtest import store  # noqa: E402
from backtest.data import (  # noqa: E402
    PointInTimeSnapshot,
    load_bars_csv,
    register_source,
)
from backtest.qv_identity import (  # noqa: E402
    CONVERSION_VALUE_PROXY,
    MISSING,
    OBSERVED_MARKET_PRICE,
    AmbiguousIdentityError,
    QVIdentityError,
    UnresolvedIdentityError,
    active_classes,
    get_issuer,
    get_issuer_by_cik,
    register_class_valuation,
    register_issuer,
    register_share_class,
    resolve_member,
    resolve_symbol,
    resolve_symbols_to_issuers,
    valuation_at,
)

SOURCE = "sec-qv-identity"
VERSION = "qv-identity-fixture-v1"
AXIS = "us-gaap:StatementClassOfStockAxis"


class QVIdentityFixture:
    def setUp(self):
        self.connection = store.connect_memory()
        register_source(
            self.connection,
            SOURCE,
            VERSION,
            "securities",
            point_in_time=True,
            survivorship_biased=False,
            note="QV issuer/share-class identity materialization fixture",
        )

    def issuer(
        self,
        issuer_id: str,
        cik: str,
        *,
        resolution_method: str = "SEC_TICKER",
    ):
        return register_issuer(
            self.connection,
            issuer_id=issuer_id,
            cik=cik,
            resolution_method=resolution_method,
            source=SOURCE,
            source_version=VERSION,
            provenance=f"fixture://issuer/{issuer_id}",
        )

    def share_class(
        self,
        class_id: str,
        issuer_id: str,
        *,
        symbol: str | None,
        member: str | None,
        listed: bool,
        effective_from: str = "2000-01-01",
        effective_to: str | None = None,
        ordinary: bool = True,
    ):
        return register_share_class(
            self.connection,
            class_id=class_id,
            issuer_id=issuer_id,
            symbol=symbol,
            xbrl_axis=AXIS if member else None,
            xbrl_member=member,
            is_ordinary_common=ordinary,
            is_listed=listed,
            effective_from=effective_from,
            effective_to=effective_to,
            source=SOURCE,
            source_version=VERSION,
            provenance=f"fixture://class/{class_id}/{effective_from}",
        )

    def valuation(
        self,
        class_id: str,
        method: str,
        *,
        reference: str | None = None,
        ratio: float | None = None,
        effective_from: str = "2000-01-01",
        effective_to: str | None = None,
        accession: str | None = None,
        missing_reason: str | None = None,
    ):
        return register_class_valuation(
            self.connection,
            class_id=class_id,
            valuation_method=method,
            reference_class_id=reference,
            conversion_ratio=ratio,
            effective_from=effective_from,
            effective_to=effective_to,
            source_accession=accession,
            missing_reason=missing_reason,
            source=SOURCE,
            source_version=VERSION,
            provenance=f"fixture://valuation/{class_id}/{effective_from}",
        )

class QVIdentityContractTest(QVIdentityFixture, unittest.TestCase):
    def test_single_class_issuer(self):
        issuer = self.issuer("issuer-aapl", "320193", resolution_method="OVERRIDE")
        self.share_class(
            "class-aapl-common",
            issuer.issuer_id,
            symbol="AAPL",
            member="CommonStockMember",
            listed=True,
        )
        self.valuation("class-aapl-common", OBSERVED_MARKET_PRICE)

        resolved = resolve_symbol(self.connection, "aapl", "2020-06-30", VERSION)
        self.assertEqual(resolved.issuer.issuer_id, "issuer-aapl")
        self.assertEqual(resolved.share_class.class_id, "class-aapl-common")
        self.assertEqual(get_issuer(self.connection, "issuer-aapl", VERSION), issuer)
        self.assertEqual(get_issuer_by_cik(self.connection, "320193", VERSION), issuer)
        self.assertEqual(issuer.resolution_method, "OVERRIDE")
        self.assertTrue(issuer.provenance)

    def test_alphabet_listed_a_c_and_unlisted_convertible_b(self):
        self.issuer("issuer-alphabet", "1652044")
        self.share_class(
            "alphabet-a",
            "issuer-alphabet",
            symbol="GOOGL",
            member="ClassACommonStockMember",
            listed=True,
        )
        self.share_class(
            "alphabet-c",
            "issuer-alphabet",
            symbol="GOOG",
            member="ClassCCommonStockMember",
            listed=True,
        )
        self.share_class(
            "alphabet-b",
            "issuer-alphabet",
            symbol=None,
            member="ClassBCommonStockMember",
            listed=False,
        )
        self.valuation("alphabet-a", OBSERVED_MARKET_PRICE)
        self.valuation("alphabet-c", OBSERVED_MARKET_PRICE)
        self.valuation(
            "alphabet-b",
            CONVERSION_VALUE_PROXY,
            reference="alphabet-a",
            ratio=1.0,
            accession="0001652044-20-000008",
        )

        classes = active_classes(
            self.connection,
            "issuer-alphabet",
            "2020-06-30",
            VERSION,
            ordinary_common_only=True,
        )
        self.assertEqual({item.class_id for item in classes}, {
            "alphabet-a", "alphabet-b", "alphabet-c"
        })
        proxy = valuation_at(self.connection, "alphabet-b", "2020-06-30", VERSION)
        self.assertEqual(proxy.valuation_method, CONVERSION_VALUE_PROXY)
        self.assertEqual(proxy.reference_class_id, "alphabet-a")
        self.assertEqual(proxy.conversion_ratio, 1.0)
        self.assertTrue(proxy.source_accession)

    def test_berkshire_a_and_b_keep_their_own_observed_price_identity(self):
        self.issuer("issuer-berkshire", "1067983")
        for class_id, symbol, member, price_evidence in (
            ("berkshire-a", "BRK.A", "ClassACommonStockMember", "raw-close~600000"),
            ("berkshire-b", "BRK.B", "ClassBCommonStockMember", "raw-close~400"),
        ):
            register_share_class(
                self.connection,
                class_id=class_id,
                issuer_id="issuer-berkshire",
                symbol=symbol,
                xbrl_axis=AXIS,
                xbrl_member=member,
                is_ordinary_common=True,
                is_listed=True,
                effective_from="2000-01-01",
                effective_to=None,
                source=SOURCE,
                source_version=VERSION,
                provenance=f"fixture://berkshire/{price_evidence}",
            )
            self.valuation(class_id, OBSERVED_MARKET_PRICE)

        for class_id in ("berkshire-a", "berkshire-b"):
            relation = valuation_at(self.connection, class_id, "2020-06-30", VERSION)
            self.assertEqual(relation.valuation_method, OBSERVED_MARKET_PRICE)
            self.assertIsNone(relation.reference_class_id)
            self.assertIsNone(relation.conversion_ratio)

    def test_equivalent_class_a_member_is_not_an_actual_class(self):
        self.issuer("issuer-berkshire", "1067983")
        self.share_class(
            "berkshire-a",
            "issuer-berkshire",
            symbol="BRK.A",
            member="ClassACommonStockMember",
            listed=True,
        )
        self.share_class(
            "berkshire-b",
            "issuer-berkshire",
            symbol="BRK.B",
            member="ClassBCommonStockMember",
            listed=True,
        )

        with self.assertRaises(UnresolvedIdentityError):
            resolve_member(
                self.connection,
                "issuer-berkshire",
                AXIS,
                "EquivalentClassAMember",
                "2020-06-30",
                VERSION,
            )
        self.assertEqual(
            self.connection.execute(
                "SELECT COUNT(*) AS n FROM qv_share_classes"
                " WHERE xbrl_member = 'EquivalentClassAMember'"
            ).fetchone()["n"],
            0,
        )

    def test_ticker_rename_uses_class_history_not_current_ticker(self):
        self.issuer("issuer-meta", "1326801")
        self.share_class(
            "meta-common",
            "issuer-meta",
            symbol="FB",
            member="ClassACommonStockMember",
            listed=True,
            effective_from="2012-05-18",
            effective_to="2022-06-09",
        )
        self.share_class(
            "meta-common",
            "issuer-meta",
            symbol="META",
            member="ClassACommonStockMember",
            listed=True,
            effective_from="2022-06-09",
        )

        before = resolve_symbol(self.connection, "FB", "2022-06-08", VERSION)
        after = resolve_symbol(self.connection, "META", "2022-06-09", VERSION)
        self.assertEqual(before.share_class.class_id, after.share_class.class_id)
        self.assertEqual(before.issuer.issuer_id, after.issuer.issuer_id)
        with self.assertRaises(UnresolvedIdentityError):
            resolve_symbol(self.connection, "FB", "2022-06-09", VERSION)

    def test_old_ticker_reuse_can_resolve_to_a_different_issuer(self):
        self.issuer("issuer-sun", "709519")
        self.issuer("issuer-java-acquisition", "1809987")
        self.share_class(
            "sun-common",
            "issuer-sun",
            symbol="JAVA",
            member="SunCommonStockMember",
            listed=True,
            effective_from="1986-03-04",
            effective_to="2010-01-27",
        )
        self.share_class(
            "java-new-common",
            "issuer-java-acquisition",
            symbol="JAVA",
            member="CommonStockMember",
            listed=True,
            effective_from="2018-08-28",
        )

        self.assertEqual(
            resolve_symbol(self.connection, "JAVA", "2009-06-30", VERSION).issuer.issuer_id,
            "issuer-sun",
        )
        self.assertEqual(
            resolve_symbol(self.connection, "JAVA", "2020-06-30", VERSION).issuer.issuer_id,
            "issuer-java-acquisition",
        )
        with self.assertRaises(UnresolvedIdentityError):
            resolve_symbol(self.connection, "JAVA", "2015-06-30", VERSION)

    def test_one_issuer_with_multiple_listed_classes_is_one_rank_unit(self):
        self.issuer("issuer-alphabet", "1652044")
        self.share_class(
            "alphabet-a",
            "issuer-alphabet",
            symbol="GOOGL",
            member="ClassACommonStockMember",
            listed=True,
        )
        self.share_class(
            "alphabet-c",
            "issuer-alphabet",
            symbol="GOOG",
            member="ClassCCommonStockMember",
            listed=True,
        )

        rank_units = resolve_symbols_to_issuers(
            self.connection, ["GOOG", "GOOGL"], "2020-06-30", VERSION
        )
        self.assertEqual([issuer.issuer_id for issuer in rank_units], ["issuer-alphabet"])

    def test_unknown_member_fails_closed_without_name_similarity(self):
        self.issuer("issuer-example", "1234567")
        self.share_class(
            "example-a",
            "issuer-example",
            symbol="EXA",
            member="ClassACommonStockMember",
            listed=True,
        )

        with self.assertRaises(UnresolvedIdentityError):
            resolve_member(
                self.connection,
                "issuer-example",
                AXIS,
                "ClassACommonSharesMember",
                "2020-06-30",
                VERSION,
            )

    def test_conversion_ratio_effective_date_boundary(self):
        self.issuer("issuer-convertible", "7654321")
        self.share_class(
            "convertible-a",
            "issuer-convertible",
            symbol="CVA",
            member="ClassACommonStockMember",
            listed=True,
        )
        self.share_class(
            "convertible-b",
            "issuer-convertible",
            symbol=None,
            member="ClassBCommonStockMember",
            listed=False,
        )
        self.valuation(
            "convertible-b",
            CONVERSION_VALUE_PROXY,
            reference="convertible-a",
            ratio=1.0,
            effective_to="2020-01-01",
            accession="0007654321-19-000001",
        )
        self.valuation(
            "convertible-b",
            CONVERSION_VALUE_PROXY,
            reference="convertible-a",
            ratio=1.5,
            effective_from="2020-01-01",
            accession="0007654321-20-000001",
        )

        self.assertEqual(
            valuation_at(self.connection, "convertible-b", "2019-12-31", VERSION).conversion_ratio,
            1.0,
        )
        self.assertEqual(
            valuation_at(self.connection, "convertible-b", "2020-01-01", VERSION).conversion_ratio,
            1.5,
        )


class QVIdentityConstraintTest(QVIdentityFixture, unittest.TestCase):
    def test_active_class_period_overlap_is_rejected(self):
        self.issuer("issuer-overlap", "1111111")
        self.share_class(
            "overlap-a",
            "issuer-overlap",
            symbol="OVR",
            member="CommonStockMember",
            listed=True,
            effective_from="2010-01-01",
            effective_to="2020-01-01",
        )
        with self.assertRaises(QVIdentityError):
            self.share_class(
                "overlap-a",
                "issuer-overlap",
                symbol="OVR2",
                member="CommonStockMember",
                listed=True,
                effective_from="2019-01-01",
            )

    def test_same_symbol_cannot_point_to_two_issuers_at_once(self):
        self.issuer("issuer-symbol-a", "1010101")
        self.issuer("issuer-symbol-b", "2020202")
        self.share_class(
            "symbol-a",
            "issuer-symbol-a",
            symbol="SAME",
            member="CommonStockMember",
            listed=True,
        )
        with self.assertRaises(QVIdentityError):
            self.share_class(
                "symbol-b",
                "issuer-symbol-b",
                symbol="SAME",
                member="CommonStockMember",
                listed=True,
            )

    def test_class_id_cannot_move_to_another_issuer(self):
        self.issuer("issuer-class-a", "3030303")
        self.issuer("issuer-class-b", "4040404")
        self.share_class(
            "stable-class",
            "issuer-class-a",
            symbol="FIRST",
            member="CommonStockMember",
            listed=True,
            effective_from="2000-01-01",
            effective_to="2010-01-01",
        )
        with self.assertRaises(QVIdentityError):
            self.share_class(
                "stable-class",
                "issuer-class-b",
                symbol="SECOND",
                member="CommonStockMember",
                listed=True,
                effective_from="2010-01-01",
            )

    def test_invalid_conversion_payload_is_rejected_by_schema(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.connection.execute(
                "INSERT INTO qv_class_valuation"
                " (class_id, valuation_method, reference_class_id, conversion_ratio,"
                " effective_from, source_accession, source, source_version, provenance)"
                " VALUES ('bad', 'CONVERSION_VALUE_PROXY', 'ref', 0, '2020-01-01',"
                " 'accession', ?, ?, 'fixture://bad')",
                (SOURCE, VERSION),
            )

    def test_conversion_reference_must_be_same_issuer(self):
        self.issuer("issuer-one", "2222222")
        self.issuer("issuer-two", "3333333")
        self.share_class(
            "one-unlisted",
            "issuer-one",
            symbol=None,
            member="ClassBCommonStockMember",
            listed=False,
        )
        self.share_class(
            "two-listed",
            "issuer-two",
            symbol="TWO",
            member="ClassACommonStockMember",
            listed=True,
        )
        with self.assertRaises(QVIdentityError):
            self.valuation(
                "one-unlisted",
                CONVERSION_VALUE_PROXY,
                reference="two-listed",
                ratio=1.0,
                accession="0002222222-20-000001",
            )

    def test_listed_class_cannot_receive_conversion_proxy(self):
        self.issuer("issuer-listed", "4444444")
        for class_id, symbol, member in (
            ("listed-a", "LSA", "ClassACommonStockMember"),
            ("listed-b", "LSB", "ClassBCommonStockMember"),
        ):
            self.share_class(
                class_id,
                "issuer-listed",
                symbol=symbol,
                member=member,
                listed=True,
            )
        with self.assertRaises(QVIdentityError):
            self.valuation(
                "listed-b",
                CONVERSION_VALUE_PROXY,
                reference="listed-a",
                ratio=1.0,
                accession="0004444444-20-000001",
            )

    def test_unlisted_class_without_ratio_is_explicit_missing(self):
        self.issuer("issuer-missing", "5555555")
        self.share_class(
            "missing-b",
            "issuer-missing",
            symbol=None,
            member="ClassBCommonStockMember",
            listed=False,
        )
        relation = self.valuation(
            "missing-b",
            MISSING,
            missing_reason="NO_DEFENSIBLE_FIXED_CONVERSION_RATIO",
        )
        self.assertEqual(relation.valuation_method, MISSING)
        self.assertEqual(
            relation.missing_reason, "NO_DEFENSIBLE_FIXED_CONVERSION_RATIO"
        )

    def test_corrupt_overlapping_symbol_rows_fail_closed_as_ambiguous(self):
        self.issuer("issuer-corrupt-a", "6666666")
        self.issuer("issuer-corrupt-b", "7777777")
        for class_id, issuer_id, member in (
            ("corrupt-a", "issuer-corrupt-a", "ClassAMember"),
            ("corrupt-b", "issuer-corrupt-b", "ClassBMember"),
        ):
            self.connection.execute(
                "INSERT INTO qv_share_classes"
                " (class_id, issuer_id, symbol, xbrl_axis, xbrl_member,"
                " is_ordinary_common, is_listed, effective_from, source,"
                " source_version, provenance)"
                " VALUES (?, ?, 'DUP', ?, ?, 1, 1, '2020-01-01', ?, ?, ?)",
                (
                    class_id,
                    issuer_id,
                    AXIS,
                    member,
                    SOURCE,
                    VERSION,
                    f"fixture://corrupt/{class_id}",
                ),
            )
        with self.assertRaises(AmbiguousIdentityError):
            resolve_symbol(self.connection, "DUP", "2020-06-30", VERSION)


class QVSnapshotRegressionTest(unittest.TestCase):
    def test_existing_backtest_db_gets_empty_qv_tables_without_rewrite(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / store.BACKTEST_DB_NAME
            legacy = sqlite3.connect(path)
            legacy.execute(
                "CREATE TABLE securities (symbol TEXT NOT NULL, sector TEXT NOT NULL,"
                " source TEXT NOT NULL, source_version TEXT NOT NULL,"
                " PRIMARY KEY (symbol, source_version))"
            )
            legacy.execute(
                "INSERT INTO securities VALUES ('KEEP', 'SIC00', 'legacy', 'v1')"
            )
            legacy.commit()
            legacy.close()

            connection = store.connect(tmp)
            try:
                self.assertEqual(
                    connection.execute(
                        "SELECT symbol FROM securities"
                    ).fetchone()["symbol"],
                    "KEEP",
                )
                qv_tables = {
                    row["name"]
                    for row in connection.execute(
                        "SELECT name FROM sqlite_master"
                        " WHERE type = 'table' AND name LIKE 'qv_%'"
                    )
                }
                self.assertEqual(
                    qv_tables,
                    {"qv_issuers", "qv_share_classes", "qv_class_valuation"},
                )
                for table in qv_tables:
                    self.assertEqual(
                        connection.execute(
                            f"SELECT COUNT(*) AS n FROM {table}"
                        ).fetchone()["n"],
                        0,
                    )
            finally:
                connection.close()

    def test_qv_tables_and_rows_do_not_change_momentum_snapshot_id(self):
        connection = store.connect_memory()
        version = "momentum-v1"
        register_source(
            connection,
            "synthetic",
            version,
            "bars",
            point_in_time=True,
            survivorship_biased=False,
        )
        load_bars_csv(
            connection,
            "symbol,trade_date,open,high,low,close,volume,adj_close\n"
            "SPY,2020-06-30,300,301,299,300,1000000,300\n",
            "synthetic",
            version,
        )
        before_snapshot = PointInTimeSnapshot(connection, "2020-06-30", version)
        before = before_snapshot.snapshot_id
        self.assertFalse(before_snapshot.survivorship_biased)

        register_source(
            connection,
            SOURCE,
            version,
            "securities",
            point_in_time=True,
            survivorship_biased=False,
            note="QV identity rows must not enter the frozen momentum digest",
        )
        register_issuer(
            connection,
            issuer_id="issuer-spy",
            cik="884394",
            resolution_method="SEC_TICKER",
            source=SOURCE,
            source_version=version,
            provenance="fixture://issuer/spy",
        )
        register_share_class(
            connection,
            class_id="spy-trust-unit",
            issuer_id="issuer-spy",
            symbol="SPY",
            xbrl_axis=None,
            xbrl_member=None,
            is_ordinary_common=True,
            is_listed=True,
            effective_from="1993-01-29",
            effective_to=None,
            source=SOURCE,
            source_version=version,
            provenance="fixture://class/spy",
        )
        after_snapshot = PointInTimeSnapshot(connection, "2020-06-30", version)
        after = after_snapshot.snapshot_id

        self.assertEqual(after, before)
        self.assertFalse(after_snapshot.survivorship_biased)


if __name__ == "__main__":
    unittest.main()
