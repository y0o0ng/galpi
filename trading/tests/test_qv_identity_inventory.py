"""Step 5A-1 — static explicit identity mapping coverage demand 계약.

전부 network-free다. manifest 파일을 건드리지 않고, DB를 바꾸지 않으며, gate도
판정하지 않는다. **materialize된 QV identity 표를 전제하지 않는다.**
"""

from __future__ import annotations

import json
import sys
import unittest
from datetime import date, timedelta
from pathlib import Path

TRADING_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TRADING_ROOT))

from backtest import store  # noqa: E402
from backtest.qv_identity_inventory import (  # noqa: E402
    AMBIGUOUS_MAPPING,
    CLASS_NOT_ACTIVE_AT_FORMATION,
    CLASS_NOT_LISTED_ORDINARY,
    CONTRADICTORY_MANIFEST_STATE,
    ISSUER_MAPPING_MISSING,
    MAPPED,
    MULTIPLE_CLASS_MAPPINGS,
    NO_CLASS_MAPPING_FOR_SYMBOL,
    UNMAPPED,
    QVInventoryError,
    build_inventory,
    index_manifest,
    june_formation_sessions,
    map_security,
    pit_members,
)
from backtest.qv_manifest import load_manifest  # noqa: E402

CAL_SOURCE = "eodhd"
CAL_VERSION = "cal-v1"
UNI_SOURCE = "announcements"
UNI_VERSION = "uni-v1"
INDEX = "SP500"
USG = "http://fasb.org/us-gaap/2024"
CIK = "0001234567"

EVIDENCE = [{
    "source_kind": "KQ_FILING", "cik": CIK, "accession": "0001234567-21-000001",
    "document_name": "d.htm", "evidence_role": "COVER_SECURITY_12B_TITLE",
    "dependency": "REQUIRED",
}]


class ManifestBuilder:
    """임시 디렉터리에 manifest bundle을 쓴다. repository 파일은 건드리지 않는다."""

    def __init__(self, directory: Path):
        self.directory = directory
        self.issuers: list[dict] = []
        self.classes: list[dict] = []

    def issuer(self, issuer_id, cik=CIK):
        self.issuers.append({
            "issuer_id": issuer_id, "cik": cik,
            "resolution_method": "SEC_REGISTRANT_CIK", "provenance": "fixture",
            "evidence": EVIDENCE,
        })
        return self

    def share_class(self, class_id, issuer_id, symbol, *, listed=True, ordinary=True,
                    effective_from="2019-01-02", effective_to=None):
        self.classes.append({
            "class_id": class_id, "issuer_id": issuer_id, "symbol": symbol,
            "is_ordinary_common": ordinary, "is_listed": listed,
            "effective_from": effective_from, "effective_to": effective_to,
            "provenance": "fixture", "evidence": EVIDENCE,
        })
        return self

    def write(self):
        payload = {
            "issuers.jsonl": self.issuers,
            "share_classes.jsonl": self.classes,
            "xbrl_aliases.jsonl": [],
            "prose_aliases.jsonl": [],
        }
        for name, rows in payload.items():
            (self.directory / name).write_text(
                "\n".join(json.dumps(r, ensure_ascii=False) for r in rows)
                + ("\n" if rows else ""),
                encoding="utf-8",
            )
        return load_manifest(self.directory)


class InventoryFixture:
    def setUp(self):
        self.connection = store.connect_memory()
        self.seed_calendar()
        for source, version, kind in (
            (CAL_SOURCE, CAL_VERSION, "bars"),
            (UNI_SOURCE, UNI_VERSION, "universe"),
        ):
            self.connection.execute(
                "INSERT OR REPLACE INTO data_sources"
                " (source, source_version, kind, point_in_time, survivorship_biased, note)"
                " VALUES (?, ?, ?, 1, 0, 'fixture')",
                (source, version, kind),
            )
        self.connection.commit()
        self._tmp = __import__("tempfile").TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.manifest_dir = Path(self._tmp.name)

    def builder(self):
        return ManifestBuilder(self.manifest_dir)

    def seed_calendar(self, *, source=CAL_SOURCE, version=CAL_VERSION,
                      start="2019-01-01", end="2022-12-31", symbol="SPY",
                      skip=frozenset()):
        current = date.fromisoformat(start)
        stop = date.fromisoformat(end)
        rows = []
        while current <= stop:
            iso = current.isoformat()
            if current.weekday() < 5 and iso not in skip:
                rows.append((symbol, iso, 1.0, 1.0, 1.0, 1.0, 1, 1.0, 1.0, 1.0, 1.0,
                             source, version))
            current += timedelta(days=1)
        self.connection.executemany(
            "INSERT OR REPLACE INTO bars_daily"
            " (symbol, trade_date, raw_open, raw_high, raw_low, raw_close, raw_volume,"
            "  adj_open, adj_high, adj_low, adj_close, source, source_version)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            rows,
        )
        self.connection.commit()

    def member(self, symbol, valid_from, valid_to=None, *, index=INDEX,
               source=UNI_SOURCE, version=UNI_VERSION):
        self.connection.execute(
            "INSERT OR REPLACE INTO universe_membership"
            " (symbol, index_name, valid_from, valid_to, source, source_version)"
            " VALUES (?, ?, ?, ?, ?, ?)",
            (symbol, index, valid_from, valid_to, source, version),
        )
        self.connection.commit()

    def inventory(self, manifest, **overrides):
        kwargs = dict(
            manifest=manifest,
            index_name=INDEX,
            universe_source=UNI_SOURCE,
            universe_source_version=UNI_VERSION,
            calendar_source=CAL_SOURCE,
            calendar_source_version=CAL_VERSION,
            identity_source_version=manifest.identity_source_version,
            from_year=2020, to_year=2020,
        )
        kwargs.update(overrides)
        return build_inventory(self.connection, **kwargs)

    def mapped(self, manifest, symbol, session="2020-06-30"):
        return map_security(index_manifest(manifest), symbol, session)


class FormationCalendarTest(InventoryFixture, unittest.TestCase):
    def test_june_formation_is_the_last_regular_june_session(self):
        sessions = dict(june_formation_sessions(
            self.connection,
            calendar_source=CAL_SOURCE, calendar_source_version=CAL_VERSION,
        ))
        self.assertEqual(sessions[2020], "2020-06-30")   # 화요일
        self.assertEqual(sessions[2019], "2019-06-28")   # 6/30은 일요일

    def test_a_june_holiday_moves_the_formation_session_back(self):
        self.connection.execute(
            "DELETE FROM bars_daily WHERE symbol = 'SPY' AND trade_date = '2020-06-30'"
            "  AND source = ? AND source_version = ?",
            (CAL_SOURCE, CAL_VERSION),
        )
        self.connection.commit()
        sessions = dict(june_formation_sessions(
            self.connection,
            calendar_source=CAL_SOURCE, calendar_source_version=CAL_VERSION,
        ))
        self.assertEqual(sessions[2020], "2020-06-29")

    def test_calendar_source_versions_never_mix(self):
        self.seed_calendar(version="cal-v2", start="2020-01-01", end="2020-12-31")
        other = dict(june_formation_sessions(
            self.connection,
            calendar_source=CAL_SOURCE, calendar_source_version="cal-v2",
        ))
        self.assertEqual(sorted(other), [2020])
        with self.assertRaises(QVInventoryError):
            june_formation_sessions(
                self.connection,
                calendar_source=CAL_SOURCE, calendar_source_version="cal-absent",
            )


class MembershipTest(InventoryFixture, unittest.TestCase):
    def test_membership_uses_a_half_open_interval(self):
        self.member("AAA", "2020-06-30", None)           # 시작일 포함
        self.member("CCC", "2019-01-02", "2020-06-30")   # 종료일 미포함
        self.member("DDD", "2020-07-01", None)           # 아직 아니다
        members = pit_members(
            self.connection, "2020-06-30", index_name=INDEX,
            universe_source=UNI_SOURCE, universe_source_version=UNI_VERSION,
        )
        self.assertEqual(members, ("AAA",))

    def test_universe_source_versions_and_index_never_mix(self):
        self.member("AAA", "2019-01-02")
        self.member("ZZZ", "2019-01-02", version="uni-v2")
        self.member("NDX", "2019-01-02", index="NDX100")
        self.assertEqual(
            pit_members(self.connection, "2020-06-30", index_name=INDEX,
                        universe_source=UNI_SOURCE, universe_source_version=UNI_VERSION),
            ("AAA",),
        )
        self.assertEqual(
            pit_members(self.connection, "2020-06-30", index_name="NDX100",
                        universe_source=UNI_SOURCE, universe_source_version=UNI_VERSION),
            ("NDX",),
        )


class StaticMappingTest(InventoryFixture, unittest.TestCase):
    F = "2020-06-30"

    def test_one_active_listed_ordinary_manifest_class_is_mapped(self):
        manifest = self.builder().issuer("iss-a").share_class(
            "cls-a", "iss-a", "AAA"
        ).write()
        row = self.mapped(manifest, "AAA")
        self.assertEqual(row.status, MAPPED)
        self.assertEqual((row.class_id, row.issuer_id), ("cls-a", "iss-a"))
        self.assertEqual(row.reason, MAPPED)

    def test_no_manifest_class_is_unmapped(self):
        manifest = self.builder().issuer("iss-a").write()
        row = self.mapped(manifest, "AAA")
        self.assertEqual(row.status, UNMAPPED)
        self.assertEqual(row.reason, NO_CLASS_MAPPING_FOR_SYMBOL)

    def test_effective_to_equal_to_formation_is_inactive(self):
        manifest = self.builder().issuer("iss-a").share_class(
            "cls-a", "iss-a", "AAA", effective_to=self.F
        ).write()
        row = self.mapped(manifest, "AAA")
        self.assertEqual(row.status, UNMAPPED)
        self.assertEqual(row.reason, CLASS_NOT_ACTIVE_AT_FORMATION)

        later = self.builder().issuer("iss-a").share_class(
            "cls-a", "iss-a", "AAA", effective_to="2020-07-01"
        ).write()
        self.assertEqual(self.mapped(later, "AAA").status, MAPPED)

    def test_unlisted_or_non_ordinary_mapping_does_not_count(self):
        # manifest는 비상장 class가 옛 symbol을 들고 있는 것을 허용한다
        # (계약은 "상장이면 symbol 필수"일 뿐이다). 그것이 S&P 500 종목을 풀면 안 된다.
        unlisted = self.builder().issuer("iss-a").share_class(
            "cls-a", "iss-a", "AAA", listed=False
        ).write()
        row = self.mapped(unlisted, "AAA")
        self.assertEqual(row.status, UNMAPPED)
        self.assertEqual(row.reason, CLASS_NOT_LISTED_ORDINARY)

        non_ordinary = self.builder().issuer("iss-a").share_class(
            "cls-a", "iss-a", "AAA", ordinary=False
        ).write()
        row = self.mapped(non_ordinary, "AAA")
        self.assertEqual(row.status, UNMAPPED)
        self.assertEqual(row.reason, CLASS_NOT_LISTED_ORDINARY)

    def test_multiple_eligible_class_mappings_are_ambiguous(self):
        manifest = (
            self.builder()
            .issuer("iss-a")
            .issuer("iss-b", cik="0007654321")
            .share_class("cls-a", "iss-a", "AAA")
            .share_class("cls-b", "iss-b", "AAA")
            .write()
        )
        row = self.mapped(manifest, "AAA")
        self.assertEqual(row.status, AMBIGUOUS_MAPPING)
        self.assertEqual(row.reason, MULTIPLE_CLASS_MAPPINGS)
        self.assertIsNone(row.class_id)      # 승자를 고르지 않는다
        self.assertIsNone(row.issuer_id)

    def test_overlapping_segments_of_one_class_fail_closed(self):
        manifest = (
            self.builder()
            .issuer("iss-a")
            .share_class("cls-a", "iss-a", "AAA", effective_from="2019-01-02")
            .share_class("cls-a", "iss-a", "AAA", effective_from="2020-01-02")
            .write()
        )
        row = self.mapped(manifest, "AAA")
        self.assertEqual(row.status, AMBIGUOUS_MAPPING)
        self.assertEqual(row.reason, CONTRADICTORY_MANIFEST_STATE)

    def test_class_owned_by_two_issuers_fails_closed(self):
        manifest = (
            self.builder()
            .issuer("iss-a")
            .issuer("iss-b", cik="0007654321")
            .share_class("cls-a", "iss-a", "AAA", effective_from="2019-01-02",
                         effective_to="2020-01-02")
            .share_class("cls-a", "iss-b", "AAA", effective_from="2020-01-02")
            .write()
        )
        row = self.mapped(manifest, "AAA")
        self.assertEqual(row.status, AMBIGUOUS_MAPPING)
        self.assertEqual(row.reason, CONTRADICTORY_MANIFEST_STATE)

    def test_missing_referenced_issuer_fails_closed(self):
        manifest = self.builder().issuer("iss-other").share_class(
            "cls-a", "iss-absent", "AAA"
        ).write()
        row = self.mapped(manifest, "AAA")
        self.assertEqual(row.status, UNMAPPED)
        self.assertEqual(row.reason, ISSUER_MAPPING_MISSING)
        self.assertIsNone(row.issuer_id)


class NoMaterializedIdentityNeededTest(InventoryFixture, unittest.TestCase):
    def test_empty_qv_identity_tables_still_yield_mapped(self):
        """5A-1은 materialize된 identity를 전제하지 않는다."""
        manifest = self.builder().issuer("iss-a").share_class(
            "cls-a", "iss-a", "AAA"
        ).write()
        self.member("AAA", "2019-01-02")
        for table in ("qv_share_classes", "qv_issuers"):
            self.assertEqual(
                self.connection.execute(
                    f"SELECT count(*) AS n FROM {table}"
                ).fetchone()["n"],
                0,
            )
        inventory = self.inventory(manifest)
        self.assertEqual(inventory.formations[0].mapped_count, 1)
        self.assertEqual(inventory.securities[0].status, MAPPED)

    def test_usability_dependent_db_state_cannot_change_the_result(self):
        """`usable_from_session`을 더 이상 소비하지 않는다."""
        manifest = self.builder().issuer("iss-a").share_class(
            "cls-a", "iss-a", "AAA"
        ).write()
        self.member("AAA", "2019-01-02")
        before = self.inventory(manifest).as_json(git_commit="x")

        # formation 훨씬 뒤에야 usable한 identity 행을 DB에 심는다.
        self.connection.execute(
            "INSERT OR REPLACE INTO data_sources"
            " (source, source_version, kind, point_in_time, survivorship_biased, note)"
            " VALUES ('manifest', ?, 'securities', 1, 0, 'fixture')",
            (manifest.identity_source_version,),
        )
        self.connection.execute(
            "INSERT OR REPLACE INTO qv_issuers"
            " (issuer_id, cik, resolution_method, usable_from_session,"
            "  source, source_version, provenance)"
            " VALUES ('iss-a', ?, 'SEC_REGISTRANT_CIK', '2099-01-01', 'manifest', ?, 'f')",
            (CIK, manifest.identity_source_version),
        )
        self.connection.execute(
            "INSERT OR REPLACE INTO qv_share_classes"
            " (class_id, issuer_id, symbol, is_ordinary_common, is_listed,"
            "  effective_from, effective_to, usable_from_session,"
            "  source, source_version, provenance)"
            " VALUES ('cls-a', 'iss-a', 'AAA', 1, 1, '2019-01-02', NULL, '2099-01-01',"
            "         'manifest', ?, 'f')",
            (manifest.identity_source_version,),
        )
        self.connection.commit()

        after = self.inventory(manifest).as_json(git_commit="x")
        self.assertEqual(before, after)
        self.assertEqual(after["formations"][0]["mapped_count"], 1)

    def test_current_securities_or_ticker_tables_cannot_rescue_an_unmapped_symbol(self):
        manifest = self.builder().issuer("iss-a").write()
        self.member("AAA", "2019-01-02")
        self.connection.execute(
            "INSERT OR REPLACE INTO securities (symbol, sector, source, source_version)"
            " VALUES ('AAA', 'SIC1234', 'sec-edgar', 'securities-v1')"
        )
        self.connection.commit()
        row = self.inventory(manifest).securities[0]
        self.assertEqual(row.status, UNMAPPED)
        self.assertEqual(row.reason, NO_CLASS_MAPPING_FOR_SYMBOL)


class BundleVersionTest(InventoryFixture, unittest.TestCase):
    def test_identity_version_mismatch_fails_closed(self):
        manifest = self.builder().issuer("iss-a").share_class(
            "cls-a", "iss-a", "AAA"
        ).write()
        self.member("AAA", "2019-01-02")
        with self.assertRaises(QVInventoryError):
            self.inventory(manifest, identity_source_version="qv-identity-sha256:other")
        # 정확히 같으면 통과한다.
        self.assertEqual(
            self.inventory(
                manifest, identity_source_version=manifest.identity_source_version
            ).identity_source_version,
            manifest.identity_source_version,
        )


class IssuerGroupingTest(InventoryFixture, unittest.TestCase):
    def test_two_member_symbols_of_one_issuer_stay_two_rows_one_group(self):
        manifest = (
            self.builder()
            .issuer("iss-alphabet")
            .share_class("cls-a", "iss-alphabet", "GOOGL")
            .share_class("cls-c", "iss-alphabet", "GOOG")
            .write()
        )
        self.member("GOOGL", "2019-01-02")
        self.member("GOOG", "2019-01-02")
        inventory = self.inventory(manifest)

        self.assertEqual([row.symbol for row in inventory.securities], ["GOOG", "GOOGL"])
        self.assertEqual({row.status for row in inventory.securities}, {MAPPED})

        self.assertEqual(len(inventory.issuer_groups), 1)
        group = inventory.issuer_groups[0]
        self.assertEqual(group.issuer_id, "iss-alphabet")
        self.assertEqual(group.member_symbols, ("GOOG", "GOOGL"))
        self.assertEqual(group.member_class_ids, ("cls-a", "cls-c"))

        summary = inventory.formations[0]
        self.assertEqual(
            (summary.member_count, summary.mapped_count,
             summary.mapped_issuer_count, summary.multi_security_issuer_count),
            (2, 2, 1, 1),
        )


class DeterminismTest(InventoryFixture, unittest.TestCase):
    def build(self):
        manifest = (
            self.builder()
            .issuer("iss-b", cik="0007654321")
            .issuer("iss-a")
            .share_class("cls-b", "iss-b", "BBB")
            .share_class("cls-a", "iss-a", "AAA")
            .write()
        )
        for symbol in ("ZZZ", "BBB", "AAA"):
            self.member(symbol, "2019-01-02")
        return self.inventory(manifest, from_year=2019, to_year=2020)

    def test_output_is_sorted_and_semantically_deterministic(self):
        first = self.build().as_json(git_commit="deadbeef")
        second = self.build().as_json(git_commit="deadbeef")
        self.assertEqual(first, second)
        self.assertEqual(
            json.dumps(first, sort_keys=True), json.dumps(second, sort_keys=True)
        )
        keys = [(row["formation_session"], row["symbol"]) for row in first["securities"]]
        self.assertEqual(keys, sorted(keys))
        group_keys = [
            (row["formation_session"], row["issuer_id"]) for row in first["issuer_groups"]
        ]
        self.assertEqual(group_keys, sorted(group_keys))
        for row in first["issuer_groups"]:
            self.assertEqual(row["member_symbols"], sorted(row["member_symbols"]))

    def test_payload_labels_what_it_measures(self):
        payload = self.build().as_json(git_commit="deadbeef")
        self.assertEqual(payload["stage"], "5A-1")
        self.assertEqual(payload["measures"], "STATIC_MAPPING_COVERAGE_DEMAND")
        self.assertIn("not PIT identity usability", payload["note"])
        self.assertEqual(payload["universe_source_version"], UNI_VERSION)
        self.assertEqual(payload["calendar_source_version"], CAL_VERSION)
        self.assertTrue(
            payload["identity_source_version"].startswith("qv-identity-sha256:")
        )

    def test_mapping_demand_lists_symbols_needing_5a2_work(self):
        inventory = self.build()
        self.assertIn("ZZZ", inventory.mapping_demand_symbols())
        self.assertNotIn("AAA", inventory.mapping_demand_symbols())


if __name__ == "__main__":
    unittest.main()
