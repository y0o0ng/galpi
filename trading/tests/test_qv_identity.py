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
from backtest import qv_conversion  # noqa: E402
from backtest.qv_identity import (  # noqa: E402
    AmbiguousIdentityError,
    QVIdentityError,
    UnresolvedIdentityError,
    active_classes,
    get_issuer,
    get_issuer_by_cik,
    register_issuer,
    register_share_class,
    resolve_member,
    resolve_prose_name,
    resolve_symbol,
    resolve_symbols_to_issuers,
)
from backtest.qv_manifest import prose_key  # noqa: E402

SOURCE = "sec-qv-identity"
VERSION = "qv-identity-fixture-v1"
AXIS = "us-gaap:StatementClassOfStockAxis"
USG = "http://fasb.org/us-gaap/2024"
USABLE = "2000-01-03"


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
        usable_from_session: str = USABLE,
    ):
        return register_issuer(
            self.connection,
            issuer_id=issuer_id,
            cik=cik,
            resolution_method=resolution_method,
            usable_from_session=usable_from_session,
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
        usable_from_session: str = USABLE,
    ):
        result = register_share_class(
            self.connection,
            class_id=class_id,
            issuer_id=issuer_id,
            symbol=symbol,
            is_ordinary_common=ordinary,
            is_listed=listed,
            effective_from=effective_from,
            effective_to=effective_to,
            usable_from_session=usable_from_session,
            source=SOURCE,
            source_version=VERSION,
            provenance=f"fixture://class/{class_id}/{effective_from}",
        )
        if member:
            self.xbrl_alias(
                class_id, issuer_id, member,
                effective_from=effective_from, effective_to=effective_to,
                usable_from_session=usable_from_session,
            )
        return result

    def xbrl_alias(
        self,
        class_id: str,
        issuer_id: str,
        member_local: str,
        *,
        effective_from: str = "2000-01-01",
        effective_to: str | None = None,
        usable_from_session: str = USABLE,
    ):
        """alias는 economic class가 아니라 별도 관계다."""
        self.connection.execute(
            "INSERT INTO qv_share_class_xbrl_aliases"
            " (class_id, issuer_id, axis_key, member_key,"
            "  raw_axis_namespace, raw_axis_local, raw_member_namespace, raw_member_local,"
            "  effective_from, effective_to, usable_from_session,"
            "  source, source_version, provenance)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                class_id, issuer_id, AXIS, f"us-gaap:{member_local}",
                USG, "StatementClassOfStockAxis", USG, member_local,
                effective_from, effective_to, usable_from_session,
                SOURCE, VERSION, f"fixture://alias/{class_id}/{member_local}",
            ),
        )
        self.connection.commit()

    def prose_alias(
        self,
        class_id: str,
        issuer_id: str,
        raw_name: str,
        *,
        bridge_type: str = "SECURITY_TITLE_FACT",
        effective_from: str = "2000-01-01",
        effective_to: str | None = None,
        usable_from_session: str = USABLE,
    ):
        self.connection.execute(
            "INSERT INTO qv_share_class_prose_aliases"
            " (class_id, issuer_id, raw_prose_name, comparison_key, bridge_type,"
            "  effective_from, effective_to, usable_from_session,"
            "  source, source_version, provenance)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                class_id, issuer_id, raw_name, prose_key(raw_name), bridge_type,
                effective_from, effective_to, usable_from_session,
                SOURCE, VERSION, f"fixture://prose/{class_id}",
            ),
        )
        self.connection.commit()

    def conversion_relation(
        self,
        relation_id: str,
        subject: str,
        reference: str,
        issuer_id: str,
        *,
        ratio: str = "1",
        semantics: str = "ONE_FOR_ONE",
        effective_from: str = "2000-01-01",
        effective_to: str | None = None,
        acceptance: str = "1999-12-30T21:00:00.000000Z",
    ):
        """전환 관계는 canonical SEC 증거에서 usable을 파생한다."""
        cik = get_issuer(self.connection, issuer_id, VERSION).cik
        accession = f"{cik}-99-{abs(hash(relation_id)) % 1000000:06d}"
        self._seed_filing(cik, accession, acceptance)
        return qv_conversion.register_relation(
            self.connection,
            relation_id=relation_id,
            subject_class_id=subject,
            reference_class_id=reference,
            issuer_id=issuer_id,
            conversion_ratio_text=ratio,
            ratio_semantics=semantics,
            effective_from=effective_from,
            effective_to=effective_to,
            evidence=[{
                "source_kind": "KQ_FILING", "cik": cik, "accession": accession,
                "document_name": "d.htm",
                "evidence_role": "CONVERSION_RIGHT_DISCLOSURE",
                "dependency": "REQUIRED",
            }],
            filings_source_version=VERSION,
            source=SOURCE,
            source_version=VERSION,
            provenance=f"fixture://relation/{relation_id}",
        )

    def _seed_filing(self, cik: str, accession: str, acceptance: str) -> None:
        """증거 해석에 필요한 최소 filing/달력 seed."""
        self.connection.execute(
            "INSERT OR REPLACE INTO data_sources"
            " (source, source_version, kind, point_in_time, survivorship_biased, note)"
            " VALUES ('cal', 'cal-v1', 'bars', 1, 0, 'fixture')"
        )
        self.connection.executemany(
            "INSERT OR REPLACE INTO bars_daily"
            " (symbol, trade_date, raw_open, raw_high, raw_low, raw_close, raw_volume,"
            "  adj_open, adj_high, adj_low, adj_close, source, source_version)"
            " VALUES ('SPY', ?, 1, 1, 1, 1, 1, 1, 1, 1, 1, 'cal', 'cal-v1')",
            [(f"{year:04d}-01-04",) for year in range(1994, 2031)],
        )
        from backtest.qv_submissions import (
            _acceptance_eastern_date,
            _historical_usable_session,
        )
        eastern = _acceptance_eastern_date(acceptance)
        usable = _historical_usable_session(self.connection, eastern, "cal", "cal-v1")
        self.connection.execute(
            "INSERT OR REPLACE INTO qv_sec_filings"
            " (cik, accession, form, filed_date, acceptance_datetime,"
            "  acceptance_eastern_date, historical_usable_session, sic_status,"
            "  submissions_file, calendar_source, calendar_source_version,"
            "  source, source_version, provenance)"
            " VALUES (?, ?, '10-K', ?, ?, ?, ?, 'MISSING', 'f.json', 'cal', 'cal-v1',"
            "         ?, ?, 'fixture')",
            (cik, accession, eastern, acceptance, eastern, usable, SOURCE, VERSION),
        )
        self.connection.commit()


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
        self.conversion_relation(
            "rel-alphabet-b", "alphabet-b", "alphabet-a", "issuer-alphabet",
            ratio="1", semantics="ONE_FOR_ONE",
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
        relation = qv_conversion.active_relation(
            self.connection,
            subject_class_id="alphabet-b",
            valuation_date="2019-12-31",
            formation_session="2020-06-30",
            source_version=VERSION,
        )
        self.assertIsNotNone(relation)
        self.assertEqual(relation["reference_class_id"], "alphabet-a")
        self.assertEqual(relation["conversion_ratio_text"], "1")
        # 상장 class에는 가짜 영구 OBSERVED 행을 만들지 않는다.
        self.assertIsNone(
            qv_conversion.active_relation(
                self.connection, subject_class_id="alphabet-a",
                valuation_date="2019-12-31", formation_session="2020-06-30",
                source_version=VERSION,
            )
        )

    def test_berkshire_a_and_b_keep_their_own_observed_price_identity(self):
        issuer = self.issuer("issuer-berkshire", "1067983")
        for class_id, symbol, member in (
            ("berkshire-a", "BRK.A", "ClassACommonStockMember"),
            ("berkshire-b", "BRK.B", "ClassBCommonStockMember"),
        ):
            self.share_class(
                class_id, issuer.issuer_id, symbol=symbol, member=member, listed=True
            )

        active = active_classes(
            self.connection, issuer.issuer_id, "2020-06-30", VERSION
        )
        self.assertEqual(
            {item.class_id for item in active}, {"berkshire-a", "berkshire-b"}
        )
        # 각 class가 자기 심볼을 그대로 들고 있다. 하나로 합치지 않는다.
        self.assertEqual(
            {item.class_id: item.symbol for item in active},
            {"berkshire-a": "BRK.A", "berkshire-b": "BRK.B"},
        )
        # 상장 class에는 전환 관계를 만들지 않는다.
        for class_id in ("berkshire-a", "berkshire-b"):
            self.assertIsNone(
                qv_conversion.active_relation(
                    self.connection, subject_class_id=class_id,
                    valuation_date="2019-12-31", formation_session="2020-06-30",
                    source_version=VERSION,
                )
            )

    def test_equivalent_class_a_member_is_not_an_actual_class(self):
        issuer = self.issuer("issuer-berkshire", "1067983")
        self.share_class(
            "berkshire-a", issuer.issuer_id, symbol="BRK.A",
            member="ClassACommonStockMember", listed=True,
        )
        # 파생/등가 member는 alias로도 등록되지 않는다.
        with self.assertRaises(UnresolvedIdentityError):
            resolve_member(
                self.connection, "issuer-berkshire", AXIS,
                "us-gaap:EquivalentClassAMember", "2020-06-30", VERSION,
            )
        self.assertEqual(
            self.connection.execute(
                "SELECT COUNT(*) AS n FROM qv_share_class_xbrl_aliases"
                " WHERE raw_member_local = 'EquivalentClassAMember'"
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
            "convertible-a", "issuer-convertible", symbol="CVA",
            member="ClassACommonStockMember", listed=True,
        )
        self.share_class(
            "convertible-b", "issuer-convertible", symbol=None,
            member="ClassBCommonStockMember", listed=False,
        )
        self.conversion_relation(
            "rel-b-old", "convertible-b", "convertible-a", "issuer-convertible",
            ratio="1", effective_to="2020-01-01",
        )
        self.conversion_relation(
            "rel-b-new", "convertible-b", "convertible-a", "issuer-convertible",
            ratio="1.5", semantics="EXPLICIT_INTEGER", effective_from="2020-01-01",
        )

        before = qv_conversion.active_relation(
            self.connection, subject_class_id="convertible-b",
            valuation_date="2019-12-31", formation_session="2020-06-30",
            source_version=VERSION,
        )
        after = qv_conversion.active_relation(
            self.connection, subject_class_id="convertible-b",
            valuation_date="2020-01-01", formation_session="2020-06-30",
            source_version=VERSION,
        )
        self.assertEqual(before["conversion_ratio_text"], "1")
        self.assertEqual(after["conversion_ratio_text"], "1.5")

    def test_non_pit_securities_source_cannot_register_an_issuer(self):
        register_source(
            self.connection,
            SOURCE,
            VERSION,
            "securities",
            point_in_time=False,
            survivorship_biased=False,
            note="current-only identity fixture",
        )

        with self.assertRaises(QVIdentityError):
            self.issuer("issuer-non-pit", "8080808")
        self.assertEqual(
            self.connection.execute(
                "SELECT COUNT(*) AS n FROM qv_issuers"
            ).fetchone()["n"],
            0,
        )

    def test_survivorship_biased_securities_source_cannot_register_an_issuer(self):
        register_source(
            self.connection,
            SOURCE,
            VERSION,
            "securities",
            point_in_time=True,
            survivorship_biased=True,
            note="survivorship-biased identity fixture",
        )

        with self.assertRaises(QVIdentityError):
            self.issuer("issuer-biased", "9090909")
        self.assertEqual(
            self.connection.execute(
                "SELECT COUNT(*) AS n FROM qv_issuers"
            ).fetchone()["n"],
            0,
        )

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
        # 전환 비율은 lossless Decimal 문자열이고 subject != reference여야 한다.
        with self.assertRaises(sqlite3.IntegrityError):
            self.connection.execute(
                "INSERT INTO qv_class_conversion_relations"
                " (relation_id, subject_class_id, reference_class_id, issuer_id,"
                "  conversion_ratio_text, ratio_semantics, effective_from,"
                "  usable_from_session, source, source_version, provenance)"
                " VALUES ('bad', 'same', 'same', 'iss', '1', 'ONE_FOR_ONE',"
                " '2020-01-01', '2020-01-02', ?, ?, 'fixture://bad')",
                (SOURCE, VERSION),
            )

    def test_conversion_reference_must_be_same_issuer(self):
        self.issuer("issuer-one", "2222222")
        self.issuer("issuer-two", "3333333")
        self.share_class(
            "one-unlisted", "issuer-one", symbol=None,
            member="ClassBCommonStockMember", listed=False,
        )
        self.share_class(
            "two-listed", "issuer-two", symbol="TWO",
            member="ClassACommonStockMember", listed=True,
        )
        with self.assertRaises(qv_conversion.QVConversionError):
            self.conversion_relation(
                "rel-cross", "one-unlisted", "two-listed", "issuer-one",
            )

    def test_listed_class_cannot_receive_conversion_proxy(self):
        self.issuer("issuer-listed", "4444444")
        for class_id, symbol, member in (
            ("listed-a", "LSA", "ClassACommonStockMember"),
            ("listed-b", "LSB", "ClassBCommonStockMember"),
        ):
            self.share_class(
                class_id, "issuer-listed", symbol=symbol, member=member, listed=True
            )
        with self.assertRaises(qv_conversion.QVConversionError):
            self.conversion_relation(
                "rel-listed", "listed-b", "listed-a", "issuer-listed",
            )

    def test_unlisted_class_without_relation_has_no_active_relation(self):
        self.issuer("issuer-missing", "5555555")
        self.share_class(
            "missing-b", "issuer-missing", symbol=None,
            member="ClassBCommonStockMember", listed=False,
        )
        # 법적 관계가 없으면 그냥 없다. 가짜 MISSING 행을 identity 층에 만들지 않는다.
        self.assertIsNone(
            qv_conversion.active_relation(
                self.connection, subject_class_id="missing-b",
                valuation_date="2019-12-31", formation_session="2020-06-30",
                source_version=VERSION,
            )
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
                " (class_id, issuer_id, symbol, is_ordinary_common, is_listed,"
                " effective_from, usable_from_session, source,"
                " source_version, provenance)"
                " VALUES (?, ?, 'DUP', 1, 1, '2020-01-01', '2020-01-02', ?, ?, ?)",
                (
                    class_id,
                    issuer_id,
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
                    {
                        "qv_issuers",
                        "qv_share_classes",
                        "qv_share_class_xbrl_aliases",
                        "qv_share_class_prose_aliases",
                        "qv_identity_evidence",
                        "qv_sec_filings",
                        "qv_sec_evidence_documents",
                        "qv_share_observations",
                        "qv_share_basis_searches",
                        "qv_share_basis_candidates",
                        "qv_share_basis_class_effects",
                        "qv_vendor_split_events",
                        "qv_class_share_resolutions",
                        "qv_class_conversion_relations",
                        "qv_class_valuation_resolutions",
                        "qv_class_market_equity",
                        "qv_issuer_market_equity",
                        "qv_accounting_filings",
                    },
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
            usable_from_session="1993-02-01",
            source=SOURCE,
            source_version=version,
            provenance="fixture://issuer/spy",
        )
        register_share_class(
            connection,
            class_id="spy-trust-unit",
            issuer_id="issuer-spy",
            symbol="SPY",
            is_ordinary_common=True,
            is_listed=True,
            effective_from="1993-01-29",
            effective_to=None,
            usable_from_session="1993-02-01",
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
