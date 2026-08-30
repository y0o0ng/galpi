"""QV Phase 0 Step 4 — identity manifest · shares · events · boundary · ME 계약.

전부 network-free fixture다. 실제 SEC/EODHD 호출은 하지 않는다.
"""

from __future__ import annotations

import json
import sqlite3
import sys
import tempfile
import unittest
from decimal import Decimal
from pathlib import Path

TRADING_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TRADING_ROOT))

from backtest import (  # noqa: E402
    qv_boundary,
    qv_conversion,
    qv_events,
    qv_evidence,
    qv_manifest,
    qv_market_equity,
    qv_selector,
    qv_shares,
    store,
)
from backtest.qv_xbrl import parse_instance, sha256  # noqa: E402
from backtest.store import BacktestStorageError  # noqa: E402
from tests.qv_step4_fixtures import (  # noqa: E402
    CALENDAR_SOURCE,
    CALENDAR_VERSION,
    USG,
    instance_xml,
    seed_calendar,
    seed_filing,
    seed_price,
)

SHARES_SOURCE = "sec-xbrl"
SHARES_VERSION = "shares-v1"
EVENTS_VERSION = "events-v1"
VENDOR_SOURCE = "eodhd"
VENDOR_VERSION = "vendor-v1"
AXIS = "us-gaap:StatementClassOfStockAxis"
CIK = "0001234567"
ISSUER = "us-cik-0001234567"


class Step4Fixture:
    def setUp(self):
        self.connection = store.connect_memory()
        seed_calendar(self.connection)
        self.identity_version = "identity-v1"
        self.connection.execute(
            "INSERT OR REPLACE INTO data_sources"
            " (source, source_version, kind, point_in_time, survivorship_biased, note)"
            " VALUES ('manifest', ?, 'securities', 1, 0, 'fixture')",
            (self.identity_version,),
        )
        self.connection.execute(
            "INSERT INTO qv_issuers"
            " (issuer_id, cik, resolution_method, source, source_version, provenance)"
            " VALUES (?, ?, 'SEC_REGISTRANT_CIK', 'manifest', ?, 'fixture')",
            (ISSUER, CIK, self.identity_version),
        )
        self.connection.commit()

    # ── identity 헬퍼 ─────────────────────────────────────────────────────────
    def add_class(
        self, class_id, *, symbol=None, listed=False, ordinary=True,
        effective_from="2015-01-01", effective_to=None, usable="2015-01-02",
        member=None,
    ):
        self.connection.execute(
            "INSERT INTO qv_share_classes"
            " (class_id, issuer_id, symbol, is_ordinary_common, is_listed,"
            "  effective_from, effective_to, usable_from_session,"
            "  source, source_version, provenance)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'manifest', ?, 'fixture')",
            (class_id, ISSUER, symbol, int(ordinary), int(listed),
             effective_from, effective_to, usable, self.identity_version),
        )
        if member:
            self.add_alias(class_id, member, effective_from=effective_from,
                           effective_to=effective_to, usable=usable)
        self.connection.commit()

    def add_alias(self, class_id, member_local, *, effective_from="2015-01-01",
                  effective_to=None, usable="2015-01-02", axis_local="StatementClassOfStockAxis"):
        self.connection.execute(
            "INSERT INTO qv_share_class_xbrl_aliases"
            " (class_id, issuer_id, axis_key, member_key, raw_axis_namespace,"
            "  raw_axis_local, raw_member_namespace, raw_member_local,"
            "  effective_from, effective_to, usable_from_session,"
            "  source, source_version, provenance)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'manifest', ?, 'fixture')",
            (class_id, ISSUER, f"us-gaap:{axis_local}", f"us-gaap:{member_local}",
             USG, axis_local, USG, member_local,
             effective_from, effective_to, usable, self.identity_version),
        )
        self.connection.commit()

    def add_prose(self, class_id, raw_name, *, bridge="SECURITY_TITLE_FACT",
                  effective_from="2015-01-01", effective_to=None, usable="2015-01-02"):
        self.connection.execute(
            "INSERT INTO qv_share_class_prose_aliases"
            " (class_id, issuer_id, raw_prose_name, comparison_key, bridge_type,"
            "  effective_from, effective_to, usable_from_session,"
            "  source, source_version, provenance)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'manifest', ?, 'fixture')",
            (class_id, ISSUER, raw_name, qv_manifest.prose_key(raw_name), bridge,
             effective_from, effective_to, usable, self.identity_version),
        )
        self.connection.commit()

    def ingest(self, accession, facts, *, form="10-K",
               acceptance="2021-02-10T21:00:00.000000Z", as_of="2020-12-31",
               usable_by=None):
        usable = seed_filing(
            self.connection, cik=CIK, accession=accession, form=form,
            acceptance_datetime=acceptance, source=SHARES_SOURCE,
            source_version=SHARES_VERSION,
        )
        xml = instance_xml(facts, cik=CIK)
        doc = parse_instance(xml, f"{accession}.xml")
        obs = qv_shares.extract_observations(
            self.connection, doc, cik=CIK, issuer_id=ISSUER,
            identity_source_version=self.identity_version, as_of=as_of,
            usable_by=usable_by,
        )
        qv_shares.store_observations(
            self.connection, obs, cik=CIK, accession=accession, form=form,
            acceptance_datetime=acceptance, historical_usable_session=usable,
            source_file=f"{accession}.xml", instance_sha256=sha256(xml),
            source=SHARES_SOURCE, source_version=SHARES_VERSION,
            identity_source_version=self.identity_version,
            provenance="fixture://instance",
        )
        return obs, usable

    def mark_search(self, accession, coverage, *, valuation_date="2020-12-31",
                    formation="2021-06-30", closure="0000000000-21-000001"):
        self.connection.execute(
            "INSERT OR REPLACE INTO qv_share_basis_searches"
            " (cik, anchor_accession, valuation_date, formation_session, interval_lo,"
            "  interval_hi, closure_accession, closure_acceptance_eastern_date, coverage,"
            "  incomplete_reason, searched_accessions, source, source_version, provenance)"
            " VALUES (?, ?, ?, ?, '2020-01-01', ?, ?, '2021-02-10', ?, ?, '[]',"
            "         'fixture', ?, 'fixture')",
            (CIK, accession, valuation_date, formation, valuation_date,
             closure if coverage == "COMPLETE" else None, coverage,
             None if coverage == "COMPLETE" else "fixture", EVENTS_VERSION),
        )
        self.connection.commit()

    def mark_effect(self, class_id, accession, effect, *, ratio=None,
                    transition=None, role=None):
        self.connection.execute(
            "INSERT OR REPLACE INTO qv_share_basis_class_effects"
            " (class_id, cik, accession, document_name, block_ordinal, effect,"
            "  effect_reason, ratio_text, share_side_transition_date,"
            "  share_side_transition_role, source, source_version,"
            "  identity_source_version, provenance)"
            " VALUES (?, ?, ?, 'd.htm', 0, ?, 'fixture', ?, ?, ?, 'fixture', ?, ?, 'fixture')",
            (class_id, CIK, accession, effect, ratio, transition, role,
             EVENTS_VERSION, self.identity_version),
        )
        self.connection.commit()


# ══════════════════════════════════════════════════════════════════════════════
# MIGRATION
# ══════════════════════════════════════════════════════════════════════════════


class MigrationTest(unittest.TestCase):
    LEGACY_VAL = """CREATE TABLE qv_class_valuation (
  class_id TEXT NOT NULL, valuation_method TEXT NOT NULL,
  effective_from TEXT NOT NULL, source TEXT NOT NULL, source_version TEXT NOT NULL,
  provenance TEXT NOT NULL, PRIMARY KEY (class_id, effective_from, source_version)
) WITHOUT ROWID;"""

    def legacy_db(self, *, rows=False, unknown=False, bars=40):
        tmp = tempfile.mkdtemp()
        path = Path(tmp) / store.BACKTEST_DB_NAME
        connection = sqlite3.connect(path)
        connection.execute(
            "CREATE TABLE bars_daily (symbol TEXT, trade_date TEXT, raw_close REAL)"
        )
        connection.executemany(
            "INSERT INTO bars_daily VALUES (?, ?, ?)",
            [("SPY", f"2020-01-{i:02d}", float(i)) for i in range(1, bars)],
        )
        connection.execute(
            "CREATE TABLE qv_issuers (issuer_id TEXT NOT NULL, cik TEXT NOT NULL,"
            " resolution_method TEXT NOT NULL, source TEXT NOT NULL,"
            " source_version TEXT NOT NULL, provenance TEXT NOT NULL,"
            " PRIMARY KEY (issuer_id, source_version)) WITHOUT ROWID"
        )
        ddl = store._STEP4_LEGACY_SHARE_CLASSES_DDL.replace(
            "CREATE TABLE IF NOT EXISTS", "CREATE TABLE", 1
        )
        if unknown:
            ddl = ddl.replace("xbrl_axis TEXT,", "xbrl_axis TEXT, surprise TEXT,", 1)
        connection.executescript(ddl)
        connection.executescript(self.LEGACY_VAL)
        if rows:
            connection.execute(
                "INSERT INTO qv_share_classes (class_id, issuer_id, symbol, xbrl_axis,"
                " xbrl_member, is_ordinary_common, is_listed, effective_from,"
                " effective_to, source, source_version, provenance)"
                " VALUES ('c', 'i', 'X', 'ax', 'mem', 1, 1, '2020-01-01', NULL,"
                " 's', 'v', 'p')"
            )
        connection.commit()
        connection.close()
        return tmp

    def test_fresh_db_gets_step4_schema(self):
        with tempfile.TemporaryDirectory() as tmp:
            connection = store.connect(tmp)
            columns = {r["name"] for r in connection.execute("PRAGMA table_info(qv_share_classes)")}
            self.assertNotIn("xbrl_axis", columns)
            self.assertIn("usable_from_session", columns)
            self.assertIsNone(
                connection.execute(
                    "SELECT 1 FROM sqlite_master WHERE name = 'qv_class_valuation'"
                ).fetchone()
            )
            connection.close()

    def test_empty_legacy_tables_rebuild_atomically(self):
        tmp = self.legacy_db(rows=False)
        connection = store.connect(tmp)
        columns = {r["name"] for r in connection.execute("PRAGMA table_info(qv_share_classes)")}
        self.assertNotIn("xbrl_axis", columns)
        self.assertIn("usable_from_session", columns)
        self.assertIsNone(
            connection.execute(
                "SELECT 1 FROM sqlite_master WHERE name = 'qv_class_valuation'"
            ).fetchone()
        )
        # 무관한 대용량 표/데이터는 그대로다.
        self.assertEqual(
            connection.execute("SELECT count(*) AS n FROM bars_daily").fetchone()["n"], 39
        )
        connection.close()

    def test_nonempty_legacy_table_fails_closed(self):
        tmp = self.legacy_db(rows=True)
        with self.assertRaises(BacktestStorageError):
            store.connect(tmp)
        connection = sqlite3.connect(Path(tmp) / store.BACKTEST_DB_NAME)
        connection.row_factory = sqlite3.Row
        columns = {r["name"] for r in connection.execute("PRAGMA table_info(qv_share_classes)")}
        self.assertIn("xbrl_axis", columns)  # 손대지 않았다
        self.assertEqual(
            connection.execute("SELECT count(*) AS n FROM qv_share_classes").fetchone()["n"], 1
        )
        connection.close()

    def test_unknown_schema_fails_closed(self):
        tmp = self.legacy_db(unknown=True)
        with self.assertRaises(BacktestStorageError):
            store.connect(tmp)
        connection = sqlite3.connect(Path(tmp) / store.BACKTEST_DB_NAME)
        connection.row_factory = sqlite3.Row
        self.assertEqual(
            connection.execute("SELECT count(*) AS n FROM bars_daily").fetchone()["n"], 39
        )
        connection.close()


# ══════════════════════════════════════════════════════════════════════════════
# IDENTITY MANIFEST
# ══════════════════════════════════════════════════════════════════════════════


class ManifestTest(unittest.TestCase):
    def write(self, directory: Path, rows: dict) -> Path:
        for name in qv_manifest.MANIFEST_FILES:
            (directory / name).write_text(
                "\n".join(json.dumps(r, ensure_ascii=False) for r in rows.get(name, []))
                + ("\n" if rows.get(name) else ""),
                encoding="utf-8",
            )
        return directory

    def base_rows(self):
        evidence = [{
            "source_kind": "KQ_FILING", "cik": "0001234567",
            "accession": "0001234567-21-000001", "document_name": "p.htm",
            "evidence_role": "COVER_SECURITY_12B_TITLE", "dependency": "REQUIRED",
        }]
        return {
            "issuers.jsonl": [
                {"issuer_id": ISSUER, "cik": CIK,
                 "resolution_method": "SEC_REGISTRANT_CIK", "provenance": "fixture"}
            ],
            "share_classes.jsonl": [
                {"class_id": "cls-a", "issuer_id": ISSUER, "symbol": "AAA",
                 "is_ordinary_common": True, "is_listed": True,
                 "effective_from": "2015-01-01", "effective_to": None,
                 "provenance": "fixture", "evidence": evidence},
            ],
            "xbrl_aliases.jsonl": [
                {"class_id": "cls-a", "issuer_id": ISSUER,
                 "axis_namespace": USG, "axis_local": "StatementClassOfStockAxis",
                 "member_namespace": USG, "member_local": "CommonClassAMember",
                 "effective_from": "2015-01-01", "effective_to": None,
                 "provenance": "fixture", "evidence": evidence},
            ],
            "prose_aliases.jsonl": [
                {"class_id": "cls-a", "issuer_id": ISSUER,
                 "raw_prose_name": "Class A Common Stock",
                 "bridge_type": "SECURITY_TITLE_FACT",
                 "effective_from": "2015-01-01", "effective_to": None,
                 "provenance": "fixture", "evidence": evidence},
            ],
        }

    def test_bundle_hash_is_deterministic_and_order_independent(self):
        rows = self.base_rows()
        rows["share_classes.jsonl"].append({
            **rows["share_classes.jsonl"][0], "class_id": "cls-b",
            "symbol": None, "is_listed": False,
        })
        with tempfile.TemporaryDirectory() as one, tempfile.TemporaryDirectory() as two:
            first = qv_manifest.load_manifest(self.write(Path(one), rows))
            flipped = dict(rows)
            flipped["share_classes.jsonl"] = list(reversed(rows["share_classes.jsonl"]))
            second = qv_manifest.load_manifest(self.write(Path(two), flipped))
        self.assertEqual(first.identity_source_version, second.identity_source_version)
        self.assertTrue(
            first.identity_source_version.startswith(qv_manifest.IDENTITY_VERSION_PREFIX)
        )

    def test_semantic_change_changes_hash(self):
        rows = self.base_rows()
        with tempfile.TemporaryDirectory() as one, tempfile.TemporaryDirectory() as two:
            first = qv_manifest.load_manifest(self.write(Path(one), rows))
            changed = json.loads(json.dumps(rows))
            changed["share_classes.jsonl"][0]["symbol"] = "BBB"
            second = qv_manifest.load_manifest(self.write(Path(two), changed))
        self.assertNotEqual(first.identity_source_version, second.identity_source_version)

    def test_duplicate_semantic_row_is_rejected(self):
        rows = self.base_rows()
        rows["share_classes.jsonl"].append(dict(rows["share_classes.jsonl"][0]))
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(qv_manifest.QVManifestError):
                qv_manifest.load_manifest(self.write(Path(tmp), rows))

    def test_manual_usable_from_session_is_rejected(self):
        rows = self.base_rows()
        rows["share_classes.jsonl"][0]["usable_from_session"] = "1999-01-01"
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(qv_manifest.QVManifestError):
                qv_manifest.load_manifest(self.write(Path(tmp), rows))

    def test_derived_member_cannot_become_a_class(self):
        rows = self.base_rows()
        rows["xbrl_aliases.jsonl"][0]["member_local"] = "EquivalentClassAMember"
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(qv_manifest.QVManifestError):
                qv_manifest.load_manifest(self.write(Path(tmp), rows))

    def test_unapproved_axis_is_rejected(self):
        rows = self.base_rows()
        rows["xbrl_aliases.jsonl"][0]["axis_local"] = "StatementEquityComponentsAxis"
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(qv_manifest.QVManifestError):
                qv_manifest.load_manifest(self.write(Path(tmp), rows))

    def test_same_alias_to_two_classes_fails_closed(self):
        rows = self.base_rows()
        rows["share_classes.jsonl"].append({
            **rows["share_classes.jsonl"][0], "class_id": "cls-b",
            "symbol": None, "is_listed": False,
        })
        rows["xbrl_aliases.jsonl"].append({
            **rows["xbrl_aliases.jsonl"][0], "class_id": "cls-b",
        })
        with tempfile.TemporaryDirectory() as tmp:
            manifest = qv_manifest.load_manifest(self.write(Path(tmp), rows))
            with self.assertRaises(qv_manifest.QVManifestError):
                qv_manifest.validate(manifest)

    def test_many_aliases_to_one_class_is_allowed(self):
        rows = self.base_rows()
        for member in ("ClassASpecialCommonStockMember", "ClassaSpecialCommonStockMember"):
            rows["xbrl_aliases.jsonl"].append({
                **rows["xbrl_aliases.jsonl"][0], "member_local": member,
            })
        with tempfile.TemporaryDirectory() as tmp:
            manifest = qv_manifest.load_manifest(self.write(Path(tmp), rows))
            qv_manifest.validate(manifest)
        self.assertEqual(len(manifest.rows["xbrl_aliases.jsonl"]), 3)

    def test_normalization_does_not_repair_a_missing_space(self):
        # Comcast 표지의 실제 오타형. 어떤 정규화 단계도 이 둘을 합치지 않는다.
        self.assertNotEqual(
            qv_manifest.prose_key("ClassA Special Common Stock"),
            qv_manifest.prose_key("Class A Special Common Stock"),
        )
        # N1은 표기 차이만 합친다.
        self.assertEqual(
            qv_manifest.prose_key("  Class A  Common Stock "),
            qv_manifest.prose_key("class a common stock"),
        )

    def test_local_name_only_inference_is_rejected(self):
        with self.assertRaises(qv_manifest.QVManifestError):
            qv_manifest.qname_key(None, "CommonClassAMember")

    def test_extension_namespace_uses_target_cik(self):
        self.assertEqual(
            qv_manifest.qname_key("http://example.com/x", "FounderMember", "1234567"),
            "ext:0001234567:FounderMember",
        )


class ManifestEvidenceTest(Step4Fixture, unittest.TestCase):
    def evidence(self, dependency, accession):
        return {
            "source_kind": "KQ_FILING", "cik": CIK, "accession": accession,
            "document_name": "p.htm", "evidence_role": "COVER", "dependency": dependency,
        }

    def test_required_evidence_max_drives_usable_from_session(self):
        early = seed_filing(
            self.connection, cik=CIK, accession="0001234567-20-000001", form="10-K",
            acceptance_datetime="2020-02-10T21:00:00.000000Z",
            source=SHARES_SOURCE, source_version=SHARES_VERSION,
        )
        late = seed_filing(
            self.connection, cik=CIK, accession="0001234567-21-000001", form="10-K",
            acceptance_datetime="2021-02-10T21:00:00.000000Z",
            source=SHARES_SOURCE, source_version=SHARES_VERSION,
        )
        usable, resolved = qv_manifest.resolve_usable_from_session(
            self.connection,
            [
                self.evidence("REQUIRED", "0001234567-20-000001"),
                self.evidence("REQUIRED", "0001234567-21-000001"),
            ],
            SHARES_VERSION,
        )
        self.assertEqual(usable, max(early, late))
        self.assertEqual(len(resolved), 2)

    def test_corroborating_evidence_does_not_delay_usability(self):
        early = seed_filing(
            self.connection, cik=CIK, accession="0001234567-20-000001", form="10-K",
            acceptance_datetime="2020-02-10T21:00:00.000000Z",
            source=SHARES_SOURCE, source_version=SHARES_VERSION,
        )
        seed_filing(
            self.connection, cik=CIK, accession="0001234567-24-000001", form="10-K",
            acceptance_datetime="2024-02-10T21:00:00.000000Z",
            source=SHARES_SOURCE, source_version=SHARES_VERSION,
        )
        usable, _ = qv_manifest.resolve_usable_from_session(
            self.connection,
            [
                self.evidence("REQUIRED", "0001234567-20-000001"),
                self.evidence("CORROBORATING", "0001234567-24-000001"),
            ],
            SHARES_VERSION,
        )
        self.assertEqual(usable, early)

    def test_unresolvable_required_evidence_blocks_materialization(self):
        with self.assertRaises(qv_manifest.QVManifestError):
            qv_manifest.resolve_usable_from_session(
                self.connection,
                [self.evidence("REQUIRED", "0001234567-99-999999")],
                SHARES_VERSION,
            )

    def test_evidence_document_ledger_keeps_kq_out(self):
        with self.assertRaises(qv_evidence.QVEvidenceError):
            qv_evidence.register_evidence_document(
                self.connection, cik=CIK, accession="0001234567-21-000009",
                document_name="x.htm", form="10-K", document_role="PRIMARY",
                acceptance_datetime="2021-02-10T21:00:00.000000Z",
                source_url="https://sec.gov/x", document_bytes=b"x",
                calendar_source=CALENDAR_SOURCE, calendar_source_version=CALENDAR_VERSION,
                source="sec", source_version=SHARES_VERSION, provenance="fixture",
            )

    def test_evidence_document_usable_session_is_after_acceptance(self):
        row = qv_evidence.register_evidence_document(
            self.connection, cik=CIK, accession="0001234567-21-000010",
            document_name="ex3-1.htm", form="8-K", document_role="EXHIBIT",
            acceptance_datetime="2021-02-10T21:00:00.000000Z",
            source_url="https://sec.gov/ex", document_bytes=b"charter",
            calendar_source=CALENDAR_SOURCE, calendar_source_version=CALENDAR_VERSION,
            source="sec", source_version=SHARES_VERSION, provenance="fixture",
        )
        self.assertGreater(
            row["historical_usable_session"], row["acceptance_eastern_date"]
        )
        self.assertEqual(row["document_sha256"], sha256(b"charter"))

    def test_later_evidence_cannot_backfill_an_earlier_formation(self):
        self.add_class("cls-a", symbol="AAA", listed=True, member="CommonClassAMember",
                       usable="2021-02-11")
        # 2021-02-11부터 usable한 alias는 2020 formation에서 보이지 않는다.
        from backtest import qv_identity
        with self.assertRaises(qv_identity.UnresolvedIdentityError):
            qv_identity.resolve_member(
                self.connection, ISSUER, AXIS, "us-gaap:CommonClassAMember",
                "2020-12-31", self.identity_version, usable_by="2020-06-30",
            )
        resolved = qv_identity.resolve_member(
            self.connection, ISSUER, AXIS, "us-gaap:CommonClassAMember",
            "2020-12-31", self.identity_version, usable_by="2021-06-30",
        )
        self.assertEqual(resolved.class_id, "cls-a")

    def test_cover_group_label_is_not_a_standalone_canonical_bridge(self):
        from backtest import qv_identity
        self.add_class("cls-b", listed=False)
        self.add_prose("cls-b", "Class B Common Stock", bridge="COVER_GROUP_LABEL")
        with self.assertRaises(qv_identity.UnresolvedIdentityError):
            qv_identity.resolve_prose_name(
                self.connection, ISSUER, qv_manifest.prose_key("Class B Common Stock"),
                "2020-12-31", self.identity_version,
            )
        self.add_prose("cls-b", "Class B Common Stock", bridge="GOVERNING_INSTRUMENT")
        self.assertEqual(
            qv_identity.resolve_prose_name(
                self.connection, ISSUER, qv_manifest.prose_key("Class B Common Stock"),
                "2020-12-31", self.identity_version,
            ).class_id,
            "cls-b",
        )


# ══════════════════════════════════════════════════════════════════════════════
# QNAME / D0 / DUPLICATES / A-B TIER
# ══════════════════════════════════════════════════════════════════════════════


class DimensionContractTest(Step4Fixture, unittest.TestCase):
    def test_exact_standard_axis_alias_resolves(self):
        self.add_class("cls-a", symbol="AAA", listed=True, member="CommonClassAMember")
        obs, _ = self.ingest("0001234567-21-000001", [
            {"concept": ("us-gaap", "CommonStockSharesOutstanding"),
             "instant": "2020-12-31", "value": "1000", "decimals": "INF",
             "member": (USG, "CommonClassAMember")},
        ])
        self.assertEqual(obs[0].mapping_status, "RESOLVED")
        self.assertEqual(obs[0].class_id, "cls-a")
        self.assertEqual(obs[0].dimension_shape, "SINGLE_CLASS_AXIS")

    def test_dimensionless_works_only_for_a_sole_applicable_class(self):
        self.add_class("cls-a", symbol="AAA", listed=True, member="CommonClassAMember")
        obs, _ = self.ingest("0001234567-21-000001", [
            {"concept": ("dei", "EntityCommonStockSharesOutstanding"),
             "instant": "2020-12-31", "value": "500", "decimals": "INF"},
        ])
        self.assertEqual(obs[0].dimension_shape, "DIMENSIONLESS")
        self.assertEqual(obs[0].class_id, "cls-a")

    def test_dimensionless_multi_class_total_is_unusable(self):
        self.add_class("cls-a", symbol="AAA", listed=True, member="CommonClassAMember")
        self.add_class("cls-b", listed=False, member="CommonClassBMember")
        obs, _ = self.ingest("0001234567-21-000001", [
            {"concept": ("dei", "EntityCommonStockSharesOutstanding"),
             "instant": "2020-12-31", "value": "500", "decimals": "INF"},
        ])
        self.assertEqual(obs[0].mapping_status, "UNRESOLVED")
        self.assertIsNone(obs[0].class_id)

    def test_typed_and_extra_dimensions_are_rejected(self):
        self.add_class("cls-a", symbol="AAA", listed=True, member="CommonClassAMember")
        obs, _ = self.ingest("0001234567-21-000001", [
            {"concept": ("us-gaap", "CommonStockSharesOutstanding"),
             "instant": "2020-12-31", "value": "1", "decimals": "INF", "typed": True},
            {"concept": ("us-gaap", "CommonStockSharesOutstanding"),
             "instant": "2020-12-31", "value": "2", "decimals": "INF",
             "member": (USG, "CommonClassAMember"),
             "extra_dim": ("StatementEquityComponentsAxis", "CommonStockMember")},
        ])
        self.assertEqual({item.dimension_shape for item in obs}, {"UNUSABLE"})
        self.assertEqual({item.mapping_status for item in obs}, {"UNUSABLE_SHAPE"})

    def test_unknown_member_fails_closed_without_name_similarity(self):
        self.add_class("cls-a", symbol="AAA", listed=True, member="CommonClassAMember")
        obs, _ = self.ingest("0001234567-21-000001", [
            {"concept": ("us-gaap", "CommonStockSharesOutstanding"),
             "instant": "2020-12-31", "value": "1000", "decimals": "INF",
             "member": (USG, "CommonClassASharesMember")},
        ])
        self.assertEqual(obs[0].mapping_status, "UNRESOLVED")


class DuplicateFactTest(Step4Fixture, unittest.TestCase):
    def facts(self, values):
        return [
            {"concept": ("us-gaap", "CommonStockSharesOutstanding"),
             "instant": "2020-12-31", "value": value, "decimals": decimals,
             "member": (USG, "CommonClassAMember"), "context_id": "c0"}
            for value, decimals in values
        ]

    def test_overlapping_intervals_consolidate_to_most_precise(self):
        self.add_class("cls-a", symbol="AAA", listed=True, member="CommonClassAMember")
        obs, _ = self.ingest(
            "0001234567-21-000001", self.facts([("1234000", "-3"), ("1234321", "INF")])
        )
        self.assertEqual(len(obs), 1)
        self.assertEqual(obs[0].share_value_text, "1234321")
        self.assertEqual(obs[0].duplicate_status, "CONSOLIDATED")

    def test_non_overlapping_intervals_are_ambiguous(self):
        self.add_class("cls-a", symbol="AAA", listed=True, member="CommonClassAMember")
        obs, _ = self.ingest(
            "0001234567-21-000001", self.facts([("1234000", "-3"), ("1240000", "-3")])
        )
        self.assertEqual(obs[0].duplicate_status, "AMBIGUOUS")
        self.assertEqual(obs[0].mapping_status, "AMBIGUOUS")

    def test_equally_precise_conflict_is_ambiguous(self):
        self.add_class("cls-a", symbol="AAA", listed=True, member="CommonClassAMember")
        obs, _ = self.ingest(
            "0001234567-21-000001", self.facts([("1234321", "INF"), ("1234999", "INF")])
        )
        self.assertEqual(obs[0].duplicate_status, "AMBIGUOUS")

    def test_decimal_value_stays_lossless(self):
        self.add_class("cls-a", symbol="AAA", listed=True, member="CommonClassAMember")
        obs, _ = self.ingest("0001234567-21-000001", [
            {"concept": ("us-gaap", "CommonStockSharesOutstanding"),
             "instant": "2020-12-31", "value": "123456789012345678",
             "decimals": "INF", "member": (USG, "CommonClassAMember")},
        ])
        self.assertEqual(obs[0].share_value_text, "123456789012345678")
        self.assertEqual(
            Decimal(obs[0].share_value_text), Decimal("123456789012345678")
        )


class TierAndSameRegimeTest(Step4Fixture, unittest.TestCase):
    FORMATION = "2021-06-30"
    D = "2020-12-31"

    def resolve(self, class_id="cls-a"):
        return qv_selector.resolve_class_shares(
            self.connection, class_id=class_id, issuer_id=ISSUER, cik=CIK,
            formation_session=self.FORMATION, valuation_date=self.D,
            shares_source_version=SHARES_VERSION, events_source_version=EVENTS_VERSION,
            identity_source_version=self.identity_version,
        )

    def setup_class_a(self):
        self.add_class("cls-a", symbol="AAA", listed=True, member="CommonClassAMember")

    def test_usable_a_beats_b(self):
        self.setup_class_a()
        self.ingest("0001234567-21-000001", [
            {"concept": ("us-gaap", "CommonStockSharesOutstanding"),
             "instant": "2020-12-31", "value": "111", "decimals": "INF",
             "member": (USG, "CommonClassAMember")},
            {"concept": ("dei", "EntityCommonStockSharesOutstanding"),
             "instant": "2020-12-31", "value": "999", "decimals": "INF"},
        ])
        self.mark_search("0001234567-21-000001", "COMPLETE")
        result = self.resolve()
        self.assertEqual(result.selector_path, "A")
        self.assertEqual(result.share_value_text, "111")

    def test_ambiguous_a_does_not_fall_back_to_b(self):
        self.setup_class_a()
        self.ingest("0001234567-21-000001", [
            {"concept": ("us-gaap", "CommonStockSharesOutstanding"),
             "instant": "2020-12-31", "value": "1234321", "decimals": "INF",
             "member": (USG, "CommonClassAMember"), "context_id": "c0"},
            {"concept": ("us-gaap", "CommonStockSharesOutstanding"),
             "instant": "2020-12-31", "value": "1234999", "decimals": "INF",
             "member": (USG, "CommonClassAMember"), "context_id": "c0"},
            {"concept": ("dei", "EntityCommonStockSharesOutstanding"),
             "instant": "2020-12-31", "value": "999", "decimals": "INF"},
        ])
        self.mark_search("0001234567-21-000001", "COMPLETE")
        result = self.resolve()
        self.assertEqual(result.selector_path, "MISSING")
        self.assertIn("하위 tier로 내려가지 않는다", result.missing_reason)

    def test_b_is_used_only_when_fresh_a_is_structurally_absent(self):
        self.setup_class_a()
        self.ingest("0001234567-21-000001", [
            {"concept": ("dei", "EntityCommonStockSharesOutstanding"),
             "instant": "2020-12-31", "value": "777", "decimals": "INF"},
        ])
        self.mark_search("0001234567-21-000001", "COMPLETE")
        result = self.resolve()
        self.assertEqual(result.selector_path, "B_FALLBACK")
        self.assertEqual(result.share_value_text, "777")

    def test_s1_freshness_is_enforced(self):
        self.setup_class_a()
        self.ingest("0001234567-21-000001", [
            {"concept": ("us-gaap", "CommonStockSharesOutstanding"),
             "instant": "2019-12-31", "value": "111", "decimals": "INF",
             "member": (USG, "CommonClassAMember")},
        ])
        self.mark_search("0001234567-21-000001", "COMPLETE")
        result = self.resolve()
        self.assertEqual(result.selector_path, "MISSING")
        self.assertEqual(result.regime_status, "NO_CANDIDATE")

    def test_incomplete_coverage_is_unusable(self):
        self.setup_class_a()
        self.ingest("0001234567-21-000001", [
            {"concept": ("us-gaap", "CommonStockSharesOutstanding"),
             "instant": "2020-12-31", "value": "111", "decimals": "INF",
             "member": (USG, "CommonClassAMember")},
        ])
        self.mark_search("0001234567-21-000001", "INCOMPLETE")
        self.assertEqual(self.resolve().selector_path, "MISSING")

    def test_unresolved_event_is_unusable(self):
        self.setup_class_a()
        self.ingest("0001234567-21-000001", [
            {"concept": ("us-gaap", "CommonStockSharesOutstanding"),
             "instant": "2020-12-31", "value": "111", "decimals": "INF",
             "member": (USG, "CommonClassAMember")},
        ])
        self.mark_search("0001234567-21-000001", "COMPLETE")
        self.mark_effect("cls-a", "0001234567-21-000001", "UNRESOLVED")
        result = self.resolve()
        self.assertEqual(result.selector_path, "MISSING")
        self.assertEqual(result.regime_status, "UNRESOLVED")

    def test_older_same_regime_candidate_is_selected_over_newer_different_regime(self):
        """split 재현 — 새 filing은 다른 regime이라 10배 ME 오류를 만들 수 있다."""
        self.setup_class_a()
        # 오래된 same-regime 후보 (split 전 단위, December instant)
        self.ingest("0001234567-21-000001", [
            {"concept": ("us-gaap", "CommonStockSharesOutstanding"),
             "instant": "2020-12-31", "value": "1000", "decimals": "INF",
             "member": (USG, "CommonClassAMember")},
        ], acceptance="2021-02-10T21:00:00.000000Z")
        # 새 후보는 split 이후 단위(10배)
        self.ingest("0001234567-21-000002", [
            {"concept": ("us-gaap", "CommonStockSharesOutstanding"),
             "instant": "2020-12-31", "value": "10000", "decimals": "INF",
             "member": (USG, "CommonClassAMember")},
        ], form="10-Q", acceptance="2021-05-10T21:00:00.000000Z")
        self.mark_search("0001234567-21-000001", "COMPLETE")
        self.mark_search("0001234567-21-000002", "COMPLETE")
        self.mark_effect(
            "cls-a", "0001234567-21-000002", "SHARE_BASIS_CHANGE_CONFIRMED",
            ratio="10-for-one", transition="2021-03-01", role="EFFECTIVE",
        )
        result = self.resolve()
        self.assertEqual(result.selector_path, "A")
        self.assertEqual(result.share_value_text, "1000")  # 10000이 아니다
        self.assertEqual(result.selected_accession, "0001234567-21-000001")

    def test_no_split_ratio_normalization_happens(self):
        """split 이후 체제의 후보는 비율로 되돌리지 않고 그냥 쓰지 않는다."""
        self.setup_class_a()
        self.ingest("0001234567-21-000002", [
            {"concept": ("us-gaap", "CommonStockSharesOutstanding"),
             "instant": "2020-12-31", "value": "10000", "decimals": "INF",
             "member": (USG, "CommonClassAMember")},
        ], acceptance="2021-05-10T21:00:00.000000Z")
        self.mark_search("0001234567-21-000002", "COMPLETE")
        self.mark_effect(
            "cls-a", "0001234567-21-000002", "SHARE_BASIS_CHANGE_CONFIRMED",
            ratio="10-for-one", transition="2021-03-01", role="EFFECTIVE",
        )
        result = self.resolve()
        self.assertEqual(result.selector_path, "MISSING")
        self.assertEqual(result.regime_status, "DIFFERENT_REGIME")

    def test_class_retired_before_d_is_excluded_from_the_universe(self):
        self.add_class("cls-a", symbol="AAA", listed=True, member="CommonClassAMember")
        self.add_class("cls-old", listed=False, effective_from="2015-01-01",
                       effective_to="2020-06-30")
        active = qv_market_equity.active_ordinary_class_ids(
            self.connection, issuer_id=ISSUER, valuation_date=self.D,
            identity_source_version=self.identity_version,
        )
        self.assertEqual(active, ("cls-a",))

    def test_acceptance_and_accession_tie_break_is_frozen(self):
        self.setup_class_a()
        for accession, acceptance, value in (
            ("0001234567-21-00000A", "2021-02-10T21:00:00.000000Z", "1"),
            ("0001234567-21-00000B", "2021-03-10T21:00:00.000000Z", "2"),
        ):
            self.ingest(accession, [
                {"concept": ("us-gaap", "CommonStockSharesOutstanding"),
                 "instant": "2020-12-31", "value": value, "decimals": "INF",
                 "member": (USG, "CommonClassAMember")},
            ], acceptance=acceptance)
            self.mark_search(accession, "COMPLETE")
        result = self.resolve()
        # 같은 instant면 acceptance DESC가 먼저다.
        self.assertEqual(result.selected_accession, "0001234567-21-00000B")


# ══════════════════════════════════════════════════════════════════════════════
# EVENT SEARCH
# ══════════════════════════════════════════════════════════════════════════════


class EventSearchTest(Step4Fixture, unittest.TestCase):
    def coverage(self, *, anchor="2021-02-11", d="2021-12-31", formation="2022-06-30"):
        return qv_events.compute_search_coverage(
            self.connection, cik=CIK, anchor_acceptance_eastern_date=anchor,
            valuation_date=d, formation_session=formation,
            filings_source_version=SHARES_VERSION,
        )

    def test_missing_closure_is_incomplete(self):
        seed_filing(
            self.connection, cik=CIK, accession="0001234567-21-000001", form="10-K",
            acceptance_datetime="2021-02-10T21:00:00.000000Z",
            source=SHARES_SOURCE, source_version=SHARES_VERSION,
        )
        result = self.coverage()
        self.assertEqual(result.coverage, "INCOMPLETE")
        self.assertIn("원본 10-K/10-Q가 없다", result.incomplete_reason)

    def test_closure_after_formation_is_incomplete(self):
        seed_filing(
            self.connection, cik=CIK, accession="0001234567-22-000001", form="10-K",
            acceptance_datetime="2022-08-10T21:00:00.000000Z",
            source=SHARES_SOURCE, source_version=SHARES_VERSION,
        )
        result = self.coverage()
        self.assertEqual(result.coverage, "INCOMPLETE")
        self.assertIn("formation보다 늦다", result.incomplete_reason)

    def test_amendment_participates_but_cannot_close(self):
        seed_filing(
            self.connection, cik=CIK, accession="0001234567-22-00000A", form="10-K/A",
            acceptance_datetime="2022-01-10T21:00:00.000000Z",
            source=SHARES_SOURCE, source_version=SHARES_VERSION,
        )
        self.assertEqual(self.coverage().coverage, "INCOMPLETE")
        seed_filing(
            self.connection, cik=CIK, accession="0001234567-22-00000B", form="10-K",
            acceptance_datetime="2022-02-10T21:00:00.000000Z",
            source=SHARES_SOURCE, source_version=SHARES_VERSION,
        )
        result = self.coverage()
        self.assertEqual(result.coverage, "COMPLETE")
        self.assertEqual(result.closure_accession, "0001234567-22-00000B")
        # amendment는 탐색에는 들어간다.
        self.assertIn("0001234567-22-00000A", result.searched_accessions)

    def test_complete_with_no_event_is_not_the_same_as_incomplete(self):
        seed_filing(
            self.connection, cik=CIK, accession="0001234567-22-000001", form="10-K",
            acceptance_datetime="2022-02-10T21:00:00.000000Z",
            source=SHARES_SOURCE, source_version=SHARES_VERSION,
        )
        complete = self.coverage()
        self.assertEqual(complete.coverage, "COMPLETE")
        self.assertIsNone(complete.incomplete_reason)


class CandidateDispositionTest(unittest.TestCase):
    LO, HI = "2022-01-01", "2022-12-31"

    def only(self, html):
        found = qv_events.extract_candidates(
            html, document_name="d.htm", document_role="PRIMARY",
            interval_lo=self.LO, interval_hi=self.HI,
        )
        return found[0] if found else None

    def test_explicit_unimplemented_proposal_is_excluded(self):
        candidate = self.only(
            "<p>our board of directors intends to issue two shares of the Class C capital"
            " stock as a one-time stock dividend for each share of Class A and Class B"
            " common stock outstanding as of a record date to be determined by our board"
            " of directors. There can be no assurance as to the timing.</p>"
        )
        self.assertEqual(candidate.disposition, "EXCLUDED_NOT_IMPLEMENTED")

    def test_undated_event_is_unresolved(self):
        candidate = self.only(
            "<p>The Company completed a two-for-one stock split of its common stock.</p>"
        )
        self.assertEqual(candidate.disposition, "UNRESOLVED")

    def test_clearly_out_of_window_old_redisclosure_is_excluded(self):
        candidate = self.only(
            "<p>On August 31, 2020, the Company effected a four-for-one stock split of"
            " its common stock, with an effective date of August 31, 2020.</p>"
        )
        self.assertEqual(candidate.disposition, "EXCLUDED_OUT_OF_WINDOW")

    def test_in_window_event_is_a_current_event(self):
        candidate = self.only(
            "<p>the Board of Directors approved and declared a 20-for-one stock split in"
            " the form of a one-time special stock dividend on each share of the company's"
            " Class A, Class B, and Class C stock. The Stock Split had a record date of"
            " July 1, 2022 and an effective date of July 15, 2022.</p>"
        )
        self.assertEqual(candidate.disposition, "CURRENT_EVENT")
        self.assertEqual(candidate.raw_ratio, "20-for-one")
        self.assertIn(("EFFECTIVE", "2022-07-15"), candidate.role_dates)

    def test_text_without_explicit_ratio_is_not_a_candidate(self):
        self.assertIsNone(
            self.only("<p>The board discussed a possible stock split.</p>")
        )


class ClassEffectTest(Step4Fixture, unittest.TestCase):
    def candidate(self, html, lo="2022-01-01", hi="2022-12-31"):
        return qv_events.extract_candidates(
            html, document_name="d.htm", document_role="PRIMARY",
            interval_lo=lo, interval_hi=hi,
        )[0]

    def effect(self, candidate, class_id="cls-a", registrant=True):
        return qv_events.resolve_class_effect(
            self.connection, candidate, class_id=class_id, issuer_id=ISSUER,
            as_of="2022-12-31", identity_source_version=self.identity_version,
            usable_by="2023-06-30", registrant_scoped=registrant,
        )

    def test_confirmed_change_requires_all_five_conditions(self):
        self.add_class("cls-a", symbol="AAA", listed=True, member="CommonClassAMember")
        # 본문이 실제로 쓰는 표기를 그대로 등록한다. N1은 "stock"을 떼지 않는다.
        self.add_prose("cls-a", "Class A")
        self.add_prose("cls-a", "Class A stock")
        candidate = self.candidate(
            "<p>the Board approved a 20-for-one stock split on each share of the"
            " company's Class A stock, with an effective date of July 15, 2022.</p>"
        )
        result = self.effect(candidate)
        self.assertEqual(result.effect, "SHARE_BASIS_CHANGE_CONFIRMED")
        self.assertEqual(result.ratio_text, "20-for-one")
        self.assertEqual(result.share_side_transition_date, "2022-07-15")
        self.assertEqual(result.share_side_transition_role, "EFFECTIVE")

    def test_missing_registrant_scope_is_unresolved(self):
        self.add_class("cls-a", symbol="AAA", listed=True, member="CommonClassAMember")
        self.add_prose("cls-a", "Class A")
        candidate = self.candidate(
            "<p>a 20-for-one stock split of Class A stock with an effective date of"
            " July 15, 2022.</p>"
        )
        self.assertEqual(self.effect(candidate, registrant=False).effect, "UNRESOLVED")

    def test_unresolvable_class_name_is_unresolved(self):
        self.add_class("cls-a", symbol="AAA", listed=True, member="CommonClassAMember")
        # prose alias 등록이 없다.
        candidate = self.candidate(
            "<p>a 20-for-one stock split of Class A stock with an effective date of"
            " July 15, 2022.</p>"
        )
        result = self.effect(candidate)
        self.assertEqual(result.effect, "UNRESOLVED")
        self.assertIn("PIT prose alias", result.effect_reason)

    def test_declared_or_record_only_cannot_be_a_share_side_transition(self):
        self.add_class("cls-a", symbol="AAA", listed=True, member="CommonClassAMember")
        self.add_prose("cls-a", "Class A")
        candidate = self.candidate(
            "<p>On March 2, 2022 the Board declared a 20-for-one stock split of the"
            " company's Class A stock with a record date of July 1, 2022.</p>"
        )
        # 후보 단계에서 이미 share-side 역할 날짜가 없어 UNRESOLVED다.
        self.assertEqual(candidate.disposition, "UNRESOLVED")
        self.assertEqual(self.effect(candidate).effect, "UNRESOLVED")

    def test_excluded_candidate_never_becomes_no_effect_confirmed(self):
        self.add_class("cls-a", symbol="AAA", listed=True, member="CommonClassAMember")
        candidate = self.candidate(
            "<p>On August 31, 2020, the Company effected a four-for-one stock split of"
            " its common stock, with an effective date of August 31, 2020.</p>"
        )
        result = self.effect(candidate)
        self.assertEqual(result.effect, "UNRESOLVED")
        self.assertNotEqual(result.effect, "NO_SHARE_BASIS_EFFECT_CONFIRMED")

    def test_explicit_other_class_scope_confirms_no_effect(self):
        self.add_class("cls-a", symbol="AAA", listed=True, member="CommonClassAMember")
        self.add_class("cls-b", listed=False, member="CommonClassBMember")
        self.add_prose("cls-a", "Class A stock")
        candidate = self.candidate(
            "<p>the Board approved a 20-for-one stock split on each share of the"
            " company's Class A stock, with an effective date of July 15, 2022.</p>"
        )
        result = self.effect(candidate, class_id="cls-b")
        self.assertEqual(result.effect, "NO_SHARE_BASIS_EFFECT_CONFIRMED")


# ══════════════════════════════════════════════════════════════════════════════
# MARKET BOUNDARY
# ══════════════════════════════════════════════════════════════════════════════


class MarketBoundaryTest(Step4Fixture, unittest.TestCase):
    def vendor(self, symbol, split_date, raw="20.000000/1.000000"):
        self.connection.execute(
            "INSERT OR REPLACE INTO qv_vendor_split_events"
            " (symbol, split_date, raw_split, retrieved_at, source, source_version, provenance)"
            " VALUES (?, ?, ?, '2026-08-30', ?, ?, 'fixture')",
            (symbol, split_date, raw, VENDOR_SOURCE, VENDOR_VERSION),
        )
        self.connection.commit()

    def resolve(self, *, sec=None, formation="2022-12-30", symbol="AAA"):
        return qv_boundary.resolve_market_boundary(
            self.connection, symbol=symbol, formation_session=formation,
            sec_trading_date=sec, vendor_source_version=VENDOR_VERSION,
            calendar_source=CALENDAR_SOURCE, calendar_source_version=CALENDAR_VERSION,
        )

    def test_vendor_supplies_the_listed_market_boundary(self):
        self.vendor("AAA", "2022-07-18")
        result = self.resolve()
        self.assertEqual(result.status, "RESOLVED")
        self.assertEqual(result.boundary_session, "2022-07-18")
        self.assertEqual(result.basis, "VENDOR")

    def test_sec_trading_date_corroborates_matching_vendor(self):
        self.vendor("AAA", "2022-07-18")
        result = self.resolve(sec="2022-07-18")
        self.assertEqual(result.basis, "VENDOR_CORROBORATED")

    def test_vendor_and_sec_conflict_is_unresolved(self):
        self.vendor("AAA", "2022-07-18")
        result = self.resolve(sec="2022-07-19")
        self.assertEqual(result.status, "UNRESOLVED")
        self.assertIn("경계가 다르다", result.reason)

    def test_sec_trading_is_a_fallback_when_vendor_is_absent(self):
        result = self.resolve(sec="2022-07-18")
        self.assertEqual(result.status, "RESOLVED")
        self.assertEqual(result.basis, "SEC_TRADING_FALLBACK")

    def test_both_absent_is_unresolved(self):
        self.assertEqual(self.resolve().status, "UNRESOLVED")

    def test_vendor_split_after_formation_is_not_visible(self):
        self.vendor("AAA", "2023-07-18")
        self.assertEqual(self.resolve(formation="2022-12-30").status, "UNRESOLVED")

    def test_mismatch_interval_guard_blocks_anchor_or_d(self):
        ok, reason = qv_boundary.guard_mismatch(
            share_side_transition="2022-07-15", market_boundary="2022-07-18",
            anchor_session="2022-07-16", valuation_date="2022-12-30",
        )
        self.assertFalse(ok)
        self.assertIn("불일치 구간", reason)

        ok, reason = qv_boundary.guard_mismatch(
            share_side_transition="2022-07-15", market_boundary="2022-07-18",
            anchor_session="2022-02-10", valuation_date="2022-12-30",
        )
        self.assertTrue(ok)
        self.assertIsNone(reason)

    def test_identical_boundaries_have_no_mismatch_interval(self):
        self.assertIsNone(qv_boundary.mismatch_interval("2022-07-18", "2022-07-18"))


# ══════════════════════════════════════════════════════════════════════════════
# CONVERSION / C3
# ══════════════════════════════════════════════════════════════════════════════


class ConversionContinuityTest(Step4Fixture, unittest.TestCase):
    def snapshot(self, accession, legal_as_of, acceptance, *, ratio="1",
                 role="AMENDED_AND_RESTATED_CERTIFICATE", reference="cls-a",
                 clause_status="READ", clause=True):
        return qv_conversion.GoverningSnapshot(
            cik=CIK, accession=accession, document_name="ex3-1.htm",
            evidence_role=role, legal_as_of=legal_as_of,
            acceptance_eastern_date=acceptance,
            clause=(
                qv_conversion.ClauseSemantics("cls-b", reference, ratio)
                if clause else None
            ),
            clause_status=clause_status,
        )

    def assess(self, snapshots, amendments=(), d="2020-12-31", formation="2021-06-30"):
        return qv_conversion.assess_continuity(
            list(snapshots), list(amendments), valuation_date=d, formation_session=formation
        )

    def test_both_checkpoints_are_required(self):
        only_pre = self.assess([self.snapshot("a", "2015-10-02", "2015-10-05")])
        self.assertEqual(only_pre.status, "UNRESOLVED")
        self.assertIn("post checkpoint", only_pre.reason)

        only_post = self.assess([self.snapshot("b", "2021-01-05", "2021-01-06")])
        self.assertEqual(only_post.status, "UNRESOLVED")
        self.assertIn("pre checkpoint", only_post.reason)

    def test_same_clause_across_the_bracket_confirms_continuity(self):
        result = self.assess([
            self.snapshot("a", "2015-10-02", "2015-10-05"),
            self.snapshot("b", "2021-01-05", "2021-01-06"),
        ])
        self.assertEqual(result.status, "CONFIRMED")
        self.assertEqual(result.amendment_status, "COMPLETE")

    def test_changed_clause_is_unresolved(self):
        result = self.assess([
            self.snapshot("a", "2015-10-02", "2015-10-05", ratio="1"),
            self.snapshot("b", "2021-01-05", "2021-01-06", ratio="1.5"),
        ])
        self.assertEqual(result.status, "UNRESOLVED")
        self.assertIn("전환 조항이 바뀌었다", result.reason)

    def test_changed_reference_class_is_unresolved(self):
        result = self.assess([
            self.snapshot("a", "2015-10-02", "2015-10-05", reference="cls-a"),
            self.snapshot("b", "2021-01-05", "2021-01-06", reference="cls-c"),
        ])
        self.assertEqual(result.status, "UNRESOLVED")

    def test_post_checkpoint_accepted_after_formation_is_unusable(self):
        result = self.assess([
            self.snapshot("a", "2015-10-02", "2015-10-05"),
            self.snapshot("b", "2021-01-05", "2021-12-01"),
        ])
        self.assertEqual(result.status, "UNRESOLVED")
        self.assertIn("formation 전에 usable한 post checkpoint가 없다", result.reason)

    def test_periodic_prose_is_not_a_checkpoint(self):
        result = self.assess([
            self.snapshot("a", "2015-10-02", "2015-10-05"),
            self.snapshot("b", "2021-01-05", "2021-01-06",
                          role="PERIODIC_DESCRIPTION_OF_SECURITIES"),
        ])
        self.assertEqual(result.status, "UNRESOLVED")

    def test_unresolved_amendment_candidate_breaks_continuity(self):
        result = self.assess(
            [
                self.snapshot("a", "2015-10-02", "2015-10-05"),
                self.snapshot("b", "2021-01-05", "2021-01-06"),
            ],
            [qv_conversion.AmendmentCandidate(
                "amd-1", "ex3-2.htm", "2018-06-01", resolved=False,
                touches_conversion=False, reason="실행 여부 불명",
            )],
        )
        self.assertEqual(result.status, "UNRESOLVED")
        self.assertEqual(result.amendment_status, "UNRESOLVED")

    def test_absence_of_amendments_is_not_itself_closure(self):
        # amendment가 0건이어도 checkpoint가 없으면 continuity는 확인되지 않는다.
        result = self.assess([self.snapshot("a", "2015-10-02", "2015-10-05")], [])
        self.assertEqual(result.status, "UNRESOLVED")

    def test_ambiguous_clause_is_unresolved(self):
        result = self.assess([
            self.snapshot("a", "2015-10-02", "2015-10-05", clause_status="AMBIGUOUS"),
            self.snapshot("b", "2021-01-05", "2021-01-06"),
        ])
        self.assertEqual(result.status, "UNRESOLVED")

    def test_reverse_inference_and_listed_subject_are_rejected(self):
        self.add_class("cls-a", symbol="AAA", listed=True, member="CommonClassAMember")
        self.add_class("cls-b", listed=False, member="CommonClassBMember")
        # 상장 class를 subject로 둘 수 없다 (역방향 추정 금지).
        with self.assertRaises(qv_conversion.QVConversionError):
            qv_conversion.register_relation(
                self.connection, relation_id="bad", subject_class_id="cls-a",
                reference_class_id="cls-b", issuer_id=ISSUER,
                conversion_ratio_text="1", ratio_semantics="ONE_FOR_ONE",
                effective_from="2015-01-01", effective_to=None,
                usable_from_session="2015-01-02", source="manifest",
                source_version=self.identity_version, provenance="fixture",
            )

    def test_current_ratio_is_not_backfilled_into_an_earlier_formation(self):
        self.add_class("cls-a", symbol="AAA", listed=True, member="CommonClassAMember")
        self.add_class("cls-b", listed=False, member="CommonClassBMember")
        qv_conversion.register_relation(
            self.connection, relation_id="rel", subject_class_id="cls-b",
            reference_class_id="cls-a", issuer_id=ISSUER,
            conversion_ratio_text="1", ratio_semantics="ONE_FOR_ONE",
            effective_from="2015-01-01", effective_to=None,
            usable_from_session="2022-03-01", source="manifest",
            source_version=self.identity_version, provenance="fixture",
        )
        self.assertIsNone(
            qv_conversion.active_relation(
                self.connection, subject_class_id="cls-b",
                valuation_date="2020-12-31", formation_session="2021-06-30",
                source_version=self.identity_version,
            )
        )
        self.assertIsNotNone(
            qv_conversion.active_relation(
                self.connection, subject_class_id="cls-b",
                valuation_date="2020-12-31", formation_session="2022-06-30",
                source_version=self.identity_version,
            )
        )


# ══════════════════════════════════════════════════════════════════════════════
# MARKET EQUITY
# ══════════════════════════════════════════════════════════════════════════════


class MarketEquityTest(Step4Fixture, unittest.TestCase):
    D = "2020-12-31"
    FORMATION = "2021-06-30"

    def valuation(self, class_id, *, continuity=None):
        return qv_market_equity.resolve_valuation(
            self.connection, class_id=class_id, issuer_id=ISSUER,
            formation_session=self.FORMATION, valuation_date=self.D,
            identity_source_version=self.identity_version,
            price_source=CALENDAR_SOURCE, price_source_version=CALENDAR_VERSION,
            continuity=continuity,
        )

    def shares(self, class_id, value):
        return qv_selector.ShareResolution(
            class_id=class_id, issuer_id=ISSUER, selector_path="A",
            selected_accession="0001234567-21-000001", selected_fact_ordinal=0,
            share_value_text=value, fact_instant=self.D, regime_status="SAME_REGIME",
            search_coverage="COMPLETE", missing_reason=None,
        )

    def missing_shares(self, class_id):
        return qv_selector.ShareResolution(
            class_id=class_id, issuer_id=ISSUER, selector_path="MISSING",
            selected_accession=None, selected_fact_ordinal=None,
            share_value_text=None, fact_instant=None, regime_status="NO_CANDIDATE",
            search_coverage="NOT_SEARCHED", missing_reason="후보 없음",
        )

    def confirmed_continuity(self):
        pre = qv_conversion.GoverningSnapshot(
            CIK, "acc-pre", "ex3-1.htm", "AMENDED_AND_RESTATED_CERTIFICATE",
            "2015-10-02", "2015-10-05",
            qv_conversion.ClauseSemantics("cls-b", "cls-a", "1"),
        )
        post = qv_conversion.GoverningSnapshot(
            CIK, "acc-post", "ex3-1.htm", "AMENDED_AND_RESTATED_CERTIFICATE",
            "2021-01-05", "2021-01-06",
            qv_conversion.ClauseSemantics("cls-b", "cls-a", "1"),
        )
        return qv_conversion.assess_continuity(
            [pre, post], [], valuation_date=self.D, formation_session=self.FORMATION
        )

    def test_two_listed_classes_keep_their_own_prices(self):
        self.add_class("cls-a", symbol="AAA", listed=True, member="CommonClassAMember")
        self.add_class("cls-c", symbol="CCC", listed=True, member="CommonClassCMember")
        seed_price(self.connection, "AAA", self.D, 100.0)
        seed_price(self.connection, "CCC", self.D, 90.0)
        equities = [
            qv_market_equity.compute_class_market_equity(
                self.shares(class_id, "1000"), self.valuation(class_id)
            )
            for class_id in ("cls-a", "cls-c")
        ]
        self.assertEqual(
            [item.market_equity_text for item in equities], ["100000", "90000"]
        )
        issuer = qv_market_equity.aggregate_issuer_market_equity(
            ISSUER, ("cls-a", "cls-c"), equities
        )
        self.assertEqual(issuer.status, "RESOLVED")
        self.assertEqual(Decimal(issuer.market_equity_text), Decimal("190000"))

    def test_conversion_proxy_uses_subject_shares_ratio_and_reference_close(self):
        self.add_class("cls-a", symbol="AAA", listed=True, member="CommonClassAMember")
        self.add_class("cls-b", listed=False, member="CommonClassBMember")
        seed_price(self.connection, "AAA", self.D, 100.0)
        qv_conversion.register_relation(
            self.connection, relation_id="rel-b", subject_class_id="cls-b",
            reference_class_id="cls-a", issuer_id=ISSUER,
            conversion_ratio_text="1.5", ratio_semantics="EXPLICIT_INTEGER",
            effective_from="2015-01-01", effective_to=None,
            usable_from_session="2015-01-02", source="manifest",
            source_version=self.identity_version, provenance="fixture",
        )
        valuation = self.valuation("cls-b", continuity=self.confirmed_continuity())
        self.assertEqual(valuation.valuation_method, "CONVERSION_VALUE_PROXY")
        equity = qv_market_equity.compute_class_market_equity(
            self.shares("cls-b", "200"), valuation
        )
        # 200 * 1.5 * 100 = 30000
        self.assertEqual(Decimal(equity.market_equity_text), Decimal("30000"))
        self.assertEqual(equity.price_symbol, "AAA")

    def test_proxy_without_continuity_is_missing(self):
        self.add_class("cls-a", symbol="AAA", listed=True, member="CommonClassAMember")
        self.add_class("cls-b", listed=False, member="CommonClassBMember")
        seed_price(self.connection, "AAA", self.D, 100.0)
        qv_conversion.register_relation(
            self.connection, relation_id="rel-b", subject_class_id="cls-b",
            reference_class_id="cls-a", issuer_id=ISSUER,
            conversion_ratio_text="1", ratio_semantics="ONE_FOR_ONE",
            effective_from="2015-01-01", effective_to=None,
            usable_from_session="2015-01-02", source="manifest",
            source_version=self.identity_version, provenance="fixture",
        )
        valuation = self.valuation("cls-b", continuity=None)
        self.assertEqual(valuation.valuation_method, "MISSING")
        self.assertIn("C3 continuity", valuation.missing_reason)

    def test_one_unresolved_active_class_makes_the_whole_issuer_missing(self):
        self.add_class("cls-a", symbol="AAA", listed=True, member="CommonClassAMember")
        self.add_class("cls-b", listed=False, member="CommonClassBMember")
        seed_price(self.connection, "AAA", self.D, 100.0)
        resolved = qv_market_equity.compute_class_market_equity(
            self.shares("cls-a", "1000"), self.valuation("cls-a")
        )
        missing = qv_market_equity.compute_class_market_equity(
            self.missing_shares("cls-b"), self.valuation("cls-b")
        )
        self.assertEqual(resolved.status, "RESOLVED")
        self.assertEqual(missing.status, "MISSING")
        issuer = qv_market_equity.aggregate_issuer_market_equity(
            ISSUER, ("cls-a", "cls-b"), [resolved, missing]
        )
        self.assertEqual(issuer.status, "MISSING")
        self.assertIsNone(issuer.market_equity_text)
        self.assertIn("cls-b", issuer.missing_reason)

    def test_derived_member_is_never_double_counted(self):
        self.add_class("cls-a", symbol="AAA", listed=True, member="CommonClassAMember")
        self.add_class("cls-b", listed=False, member="CommonClassBMember")
        # 파생 member는 identity에 없으므로 활성 class 집합에 들어올 수 없다.
        active = qv_market_equity.active_ordinary_class_ids(
            self.connection, issuer_id=ISSUER, valuation_date=self.D,
            identity_source_version=self.identity_version,
        )
        self.assertEqual(active, ("cls-a", "cls-b"))

    def test_issuer_aggregation_is_exact_decimal(self):
        self.add_class("cls-a", symbol="AAA", listed=True, member="CommonClassAMember")
        self.add_class("cls-c", symbol="CCC", listed=True, member="CommonClassCMember")
        seed_price(self.connection, "AAA", self.D, 0.1)
        seed_price(self.connection, "CCC", self.D, 0.2)
        equities = [
            qv_market_equity.compute_class_market_equity(
                self.shares(class_id, "3"), self.valuation(class_id)
            )
            for class_id in ("cls-a", "cls-c")
        ]
        issuer = qv_market_equity.aggregate_issuer_market_equity(
            ISSUER, ("cls-a", "cls-c"), equities
        )
        # 이진 float였다면 0.30000000000000004 + 0.6000000000000001 이 된다.
        self.assertEqual(Decimal(issuer.market_equity_text), Decimal("0.9"))

    def test_split_fixture_reproduces_the_failure_mode_p2_prevents(self):
        """same-regime이 아니었다면 10배 ME 오류가 났을 상황을 재현한다."""
        self.add_class("cls-a", symbol="AAA", listed=True, member="CommonClassAMember")
        seed_price(self.connection, "AAA", self.D, 100.0)
        # 같은 December instant를 두 filing이 서로 다른 단위로 보고한다.
        self.ingest("0001234567-21-000001", [
            {"concept": ("us-gaap", "CommonStockSharesOutstanding"),
             "instant": self.D, "value": "1000", "decimals": "INF",
             "member": (USG, "CommonClassAMember")},
        ], acceptance="2021-02-10T21:00:00.000000Z")
        self.ingest("0001234567-21-000002", [
            {"concept": ("us-gaap", "CommonStockSharesOutstanding"),
             "instant": self.D, "value": "10000", "decimals": "INF",
             "member": (USG, "CommonClassAMember")},
        ], form="10-Q", acceptance="2021-05-10T21:00:00.000000Z")
        self.mark_search("0001234567-21-000001", "COMPLETE")
        self.mark_search("0001234567-21-000002", "COMPLETE")
        self.mark_effect(
            "cls-a", "0001234567-21-000002", "SHARE_BASIS_CHANGE_CONFIRMED",
            ratio="10-for-one", transition="2021-03-01", role="EFFECTIVE",
        )
        shares = qv_selector.resolve_class_shares(
            self.connection, class_id="cls-a", issuer_id=ISSUER, cik=CIK,
            formation_session=self.FORMATION, valuation_date=self.D,
            shares_source_version=SHARES_VERSION, events_source_version=EVENTS_VERSION,
            identity_source_version=self.identity_version,
        )
        equity = qv_market_equity.compute_class_market_equity(
            shares, self.valuation("cls-a")
        )
        self.assertEqual(Decimal(equity.market_equity_text), Decimal("100000"))
        self.assertNotEqual(Decimal(equity.market_equity_text), Decimal("1000000"))

    def test_persisted_rows_round_trip(self):
        self.add_class("cls-a", symbol="AAA", listed=True, member="CommonClassAMember")
        seed_price(self.connection, "AAA", self.D, 100.0)
        valuation = self.valuation("cls-a")
        shares = self.shares("cls-a", "1000")
        equity = qv_market_equity.compute_class_market_equity(shares, valuation)
        issuer = qv_market_equity.aggregate_issuer_market_equity(
            ISSUER, ("cls-a",), [equity]
        )
        qv_selector.store_resolution(
            self.connection, shares, formation_session=self.FORMATION,
            valuation_date=self.D, source="qv", source_version=SHARES_VERSION,
            identity_source_version=self.identity_version, provenance="fixture",
        )
        qv_market_equity.store_valuation(
            self.connection, valuation, formation_session=self.FORMATION,
            valuation_date=self.D, source="qv", source_version=SHARES_VERSION,
            identity_source_version=self.identity_version, provenance="fixture",
        )
        qv_market_equity.store_market_equity(
            self.connection, formation_session=self.FORMATION, valuation_date=self.D,
            classes=[equity], issuer=issuer, source="qv",
            source_version=SHARES_VERSION,
            identity_source_version=self.identity_version, provenance="fixture",
        )
        row = self.connection.execute(
            "SELECT * FROM qv_issuer_market_equity"
        ).fetchone()
        self.assertEqual(row["status"], "RESOLVED")
        self.assertEqual(Decimal(row["market_equity_text"]), Decimal("100000"))
        self.assertEqual(json.loads(row["component_class_ids"]), ["cls-a"])


if __name__ == "__main__":
    unittest.main()
