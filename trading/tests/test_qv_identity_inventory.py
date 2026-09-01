"""Step 5A-1 — static explicit identity mapping coverage demand 계약.

전부 network-free다. manifest 파일을 건드리지 않고, DB를 바꾸지 않으며, gate도
판정하지 않는다. **materialize된 QV identity 표를 전제하지 않는다.**

`SymbolBridgeInventoryTest`가 이 fix의 계약을 잠근다 — universe/bar 심볼과 SEC 경제적
심볼은 다른 것이고 manifest 조회는 후자로만 한다.
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
    pit_membership_rows,
)
from backtest.qv_manifest import load_manifest  # noqa: E402
from backtest.qv_symbol_bridge import (  # noqa: E402
    DIRECT,
    REUSED_VENDOR_SERIES,
    parse_symbol_bridge,
)

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

    def bridge(self, rows=()):
        """명시 재사용 매핑 하나를 fixture로 만든다. repository 파일을 읽지 않는다."""
        lines = ["symbol,valid_from,vendor_symbol,vendor_name"]
        lines.extend(f"{symbol},{valid_from},{vendor}," for symbol, valid_from, vendor in rows)
        return parse_symbol_bridge("\n".join(lines) + "\n", source="fixture-reused.csv")

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
            symbol_bridge=self.bridge(),
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

    def mapped(self, manifest, symbol, session="2020-06-30", **kwargs):
        return map_security(index_manifest(manifest), symbol, session, **kwargs)

    def member_rows(self, session="2020-06-30", bridge=None):
        return pit_membership_rows(
            self.connection, session, index_name=INDEX,
            universe_source=UNI_SOURCE, universe_source_version=UNI_VERSION,
            symbol_bridge=bridge if bridge is not None else self.bridge(),
        )


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
        members = self.member_rows()
        self.assertEqual([row.member_symbol for row in members], ["AAA"])

    def test_universe_source_versions_and_index_never_mix(self):
        self.member("AAA", "2019-01-02")
        self.member("ZZZ", "2019-01-02", version="uni-v2")
        self.member("NDX", "2019-01-02", index="NDX100")
        self.assertEqual([row.member_symbol for row in self.member_rows()], ["AAA"])
        self.assertEqual(
            [
                row.member_symbol
                for row in pit_membership_rows(
                    self.connection, "2020-06-30", index_name="NDX100",
                    universe_source=UNI_SOURCE, universe_source_version=UNI_VERSION,
                    symbol_bridge=self.bridge(),
                )
            ],
            ["NDX"],
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

        self.assertEqual(
            [row.identity_symbol for row in inventory.securities], ["GOOG", "GOOGL"]
        )
        self.assertEqual({row.status for row in inventory.securities}, {MAPPED})

        self.assertEqual(len(inventory.issuer_groups), 1)
        group = inventory.issuer_groups[0]
        self.assertEqual(group.issuer_id, "iss-alphabet")
        self.assertEqual(group.member_symbols, ("GOOG", "GOOGL"))
        self.assertEqual(group.identity_symbols, ("GOOG", "GOOGL"))
        self.assertEqual(group.member_class_ids, ("cls-a", "cls-c"))

        summary = inventory.formations[0]
        self.assertEqual(
            (summary.member_count, summary.mapped_count,
             summary.mapped_issuer_count, summary.multi_security_issuer_count),
            (2, 2, 1, 1),
        )


class SymbolBridgeInventoryTest(InventoryFixture, unittest.TestCase):
    """universe/bar 심볼 != SEC 경제적 심볼.

    production 유니버스는 재사용된 과거 티커 일부를 벤더 계열 코드로 바꿔
    `universe_membership`에 넣는다. manifest는 SEC 경제적 identity 정본이라 그 코드를
    담지 않으므로, 조회는 **되돌린 경제적 심볼로만** 해야 한다.
    """

    FOXA = (("FOXA", "2019-01-02", "TFCFA"),)

    def test_a_plain_membership_symbol_is_its_own_identity_symbol(self):
        self.member("AAA", "2019-01-02")
        row = self.member_rows()[0]
        self.assertEqual(
            (row.member_symbol, row.identity_symbol, row.symbol_bridge_kind),
            ("AAA", "AAA", DIRECT),
        )

    def test_an_explicit_reused_vendor_series_resolves_to_the_original_symbol(self):
        self.member("TFCFA", "2019-01-02")
        row = self.member_rows(bridge=self.bridge(self.FOXA))[0]
        self.assertEqual(
            (row.member_symbol, row.identity_symbol, row.symbol_bridge_kind),
            ("TFCFA", "FOXA", REUSED_VENDOR_SERIES),
        )

    def test_manifest_lookup_uses_the_identity_symbol_not_the_vendor_series(self):
        """FOXA로 등록된 manifest 행이 TFCFA 멤버십 행을 푼다. 그 반대는 아니다."""
        manifest = self.builder().issuer("iss-fox").share_class(
            "cls-a", "iss-fox", "FOXA"
        ).write()
        self.member("TFCFA", "2019-01-02")
        inventory = self.inventory(manifest, symbol_bridge=self.bridge(self.FOXA))
        row = inventory.securities[0]
        self.assertEqual(row.status, MAPPED)
        self.assertEqual(row.member_symbol, "TFCFA")
        self.assertEqual(row.identity_symbol, "FOXA")
        self.assertEqual(row.symbol_bridge_kind, REUSED_VENDOR_SERIES)
        self.assertEqual(row.class_id, "cls-a")

        # 벤더 코드를 manifest에 넣는 것은 해답이 아니다 — 그렇게 해도 안 풀린다.
        vendor_manifest = self.builder().issuer("iss-fox").share_class(
            "cls-a", "iss-fox", "TFCFA"
        ).write()
        vendor = self.inventory(vendor_manifest, symbol_bridge=self.bridge(self.FOXA))
        self.assertEqual(vendor.securities[0].status, UNMAPPED)
        self.assertEqual(vendor.securities[0].reason, NO_CLASS_MAPPING_FOR_SYMBOL)

    def test_a_formation_stored_under_the_vendor_series_becomes_mapped(self):
        """실제 FOXA manifest 매핑이 생기는 순간 TFCFA formation이 MAPPED가 된다."""
        self.member("TFCFA", "2019-01-02")
        bridge = self.bridge(self.FOXA)
        before = self.inventory(
            self.builder().issuer("iss-fox").write(),
            symbol_bridge=bridge, from_year=2019, to_year=2019,
        )
        self.assertEqual(before.securities[0].status, UNMAPPED)
        self.assertEqual(before.mapping_demand_work_items(), (("TFCFA", "FOXA"),))

        # 그 구간에만 유효한 FOXA 매핑이다 — 현재 FOXA 주인의 매핑이 아니다.
        after = self.inventory(
            self.builder().issuer("iss-fox").share_class(
                "cls-a", "iss-fox", "FOXA",
                effective_from="2019-01-02", effective_to="2019-07-01",
            ).write(),
            symbol_bridge=bridge, from_year=2019, to_year=2019,
        )
        self.assertEqual(after.securities[0].status, MAPPED)
        self.assertEqual(after.mapping_demand_work_items(), ())

    def test_a_non_suffix_vendor_code_proves_there_is_no_suffix_heuristic(self):
        """`SUN1` · `CCTYQ`는 `_OLD` 규칙 밖이다. 정확한 매핑 줄만이 권한이다."""
        self.member("SUN1", "2019-01-02")
        self.member("CCTYQ", "2019-01-02")
        bridge = self.bridge(
            (("SUN", "2019-01-02", "SUN1"), ("CC", "2019-01-02", "CCTYQ"))
        )
        rows = {row.member_symbol: row for row in self.member_rows(bridge=bridge)}
        self.assertEqual(rows["SUN1"].identity_symbol, "SUN")
        self.assertEqual(rows["CCTYQ"].identity_symbol, "CC")
        for row in rows.values():
            self.assertEqual(row.symbol_bridge_kind, REUSED_VENDOR_SERIES)

    def test_two_disjoint_reuse_episodes_stay_two_work_items(self):
        """옛 FOXA(TFCFA 계열)와 새 FOXA를 하나로 뭉개지 않는다."""
        self.member("TFCFA", "2019-01-02", "2019-07-01")
        self.member("FOXA", "2019-07-01")
        inventory = self.inventory(
            self.builder().issuer("iss-x").write(),
            symbol_bridge=self.bridge((("FOXA", "2019-01-02", "TFCFA"),)),
            from_year=2019, to_year=2020,
        )
        self.assertEqual(
            inventory.mapping_demand_work_items(),
            (("FOXA", "FOXA"), ("TFCFA", "FOXA")),
        )
        # 경제적 심볼은 하나다 — 작업 단위가 그것으로 붕괴하지 않는 것이 계약이다.
        self.assertEqual(inventory.mapping_demand_symbols(), ("FOXA",))

    def test_the_run_records_the_reused_mapping_provenance(self):
        self.member("TFCFA", "2019-01-02")
        self.member("AAA", "2019-01-02")
        bridge = self.bridge(self.FOXA)
        payload = self.inventory(
            self.builder().issuer("iss-x").write(), symbol_bridge=bridge
        ).as_json(git_commit="x")
        self.assertEqual(payload["reused_series_source"], "fixture-reused.csv")
        self.assertTrue(
            payload["reused_series_source_version"].startswith("reused-tickers-sha256:")
        )
        self.assertEqual(payload["symbol_bridge"]["translated_membership_rows"], 1)
        # identity bundle과 섞이지 않는다.
        self.assertNotEqual(
            payload["reused_series_source_version"], payload["identity_source_version"]
        )
        self.assertIn("NOT SEC identity evidence", payload["symbol_bridge"]["note"])

    def test_changing_the_reused_mapping_changes_the_recorded_version(self):
        first = self.bridge(self.FOXA).source_version
        second = self.bridge(
            self.FOXA + (("MON", "2019-01-02", "MON_OLD"),)
        ).source_version
        self.assertNotEqual(first, second)

    def test_a_vendor_series_at_an_unmapped_interval_fails_closed(self):
        """`TFCFA`는 벤더 계열로 알려져 있는데 그 구간 줄이 없다 — 추측하지 않는다."""
        self.member("TFCFA", "2020-01-02")
        with self.assertRaises(Exception) as caught:
            self.member_rows(bridge=self.bridge(self.FOXA))
        self.assertIn("TFCFA", str(caught.exception))


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
        keys = [
            (row["formation_session"], row["member_symbol"], row["identity_symbol"])
            for row in first["securities"]
        ]
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
