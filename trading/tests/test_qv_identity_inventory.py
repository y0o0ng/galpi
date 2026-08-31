"""Step 5A-1 — PIT identity coverage inventory 계약.

전부 network-free fixture다. manifest 파일을 건드리지 않고 gate도 판정하지 않는다.
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
    AMBIGUOUS,
    CLASS_NOT_ACTIVE_AT_FORMATION,
    CLASS_NOT_LISTED_ORDINARY,
    CLASS_NOT_YET_USABLE,
    CONTRADICTORY_IDENTITY_STATE,
    ISSUER_MISSING,
    ISSUER_NOT_YET_USABLE,
    MISSING,
    MULTIPLE_CLASS_RESOLUTIONS,
    NO_CLASS_SEGMENT_FOR_SYMBOL,
    RESOLVED,
    QVInventoryError,
    build_inventory,
    june_formation_sessions,
    pit_members,
    resolve_security,
)

CAL_SOURCE = "eodhd"
CAL_VERSION = "cal-v1"
UNI_SOURCE = "announcements"
UNI_VERSION = "uni-v1"
INDEX = "SP500"
IDENTITY = "identity-v1"
OTHER_IDENTITY = "identity-v2"


class InventoryFixture:
    def setUp(self):
        self.connection = store.connect_memory()
        self.seed_calendar()
        for source, version, kind in (
            (CAL_SOURCE, CAL_VERSION, "bars"),
            (UNI_SOURCE, UNI_VERSION, "universe"),
            ("manifest", IDENTITY, "securities"),
            ("manifest", OTHER_IDENTITY, "securities"),
        ):
            self.connection.execute(
                "INSERT OR REPLACE INTO data_sources"
                " (source, source_version, kind, point_in_time, survivorship_biased, note)"
                " VALUES (?, ?, ?, 1, 0, 'fixture')",
                (source, version, kind),
            )
        self.connection.commit()

    def seed_calendar(self, *, source=CAL_SOURCE, version=CAL_VERSION,
                      start="2019-01-01", end="2022-12-31", symbol="SPY",
                      skip=frozenset()):
        """평일을 정규 세션으로 갖는 달력. `skip`은 휴장일이다."""
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

    def issuer(self, issuer_id, cik="0000000001", *, usable="2019-01-02",
               identity=IDENTITY):
        self.connection.execute(
            "INSERT OR REPLACE INTO qv_issuers"
            " (issuer_id, cik, resolution_method, usable_from_session,"
            "  source, source_version, provenance)"
            " VALUES (?, ?, 'SEC_REGISTRANT_CIK', ?, 'manifest', ?, 'fixture')",
            (issuer_id, cik, usable, identity),
        )
        self.connection.commit()

    def share_class(self, class_id, issuer_id, symbol, *, listed=True, ordinary=True,
                    effective_from="2019-01-02", effective_to=None,
                    usable="2019-01-02", identity=IDENTITY):
        self.connection.execute(
            "INSERT OR REPLACE INTO qv_share_classes"
            " (class_id, issuer_id, symbol, is_ordinary_common, is_listed,"
            "  effective_from, effective_to, usable_from_session,"
            "  source, source_version, provenance)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'manifest', ?, 'fixture')",
            (class_id, issuer_id, symbol, int(ordinary), int(listed),
             effective_from, effective_to, usable, identity),
        )
        self.connection.commit()

    def inventory(self, **overrides):
        kwargs = dict(
            index_name=INDEX,
            universe_source=UNI_SOURCE,
            universe_source_version=UNI_VERSION,
            calendar_source=CAL_SOURCE,
            calendar_source_version=CAL_VERSION,
            identity_source_version=IDENTITY,
            from_year=2020, to_year=2020,
        )
        kwargs.update(overrides)
        return build_inventory(self.connection, **kwargs)

    def resolve(self, symbol, session="2020-06-30", identity=IDENTITY):
        return resolve_security(self.connection, symbol, session, identity)


class FormationCalendarTest(InventoryFixture, unittest.TestCase):
    def test_june_formation_is_the_last_regular_june_session(self):
        sessions = dict(june_formation_sessions(
            self.connection,
            calendar_source=CAL_SOURCE, calendar_source_version=CAL_VERSION,
        ))
        # 2020-06-30은 화요일이라 그대로 마지막 세션이다.
        self.assertEqual(sessions[2020], "2020-06-30")
        # 2019-06-30은 일요일 -> 마지막 정규 세션은 6월 28일 금요일이다.
        self.assertEqual(sessions[2019], "2019-06-28")

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
        # cal-v2에는 2020만 있다.
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
        # 빈 구간(valid_to == valid_from)은 스키마 CHECK가 이미 막는다.
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
            pit_members(self.connection, "2020-06-30", index_name=INDEX,
                        universe_source=UNI_SOURCE, universe_source_version="uni-v2"),
            ("ZZZ",),
        )
        self.assertEqual(
            pit_members(self.connection, "2020-06-30", index_name="NDX100",
                        universe_source=UNI_SOURCE, universe_source_version=UNI_VERSION),
            ("NDX",),
        )


class SecurityResolutionTest(InventoryFixture, unittest.TestCase):
    F = "2020-06-30"

    def test_exactly_one_pit_usable_listed_ordinary_class_resolves(self):
        self.issuer("iss-a")
        self.share_class("cls-a", "iss-a", "AAA")
        row = self.resolve("AAA")
        self.assertEqual(row.status, RESOLVED)
        self.assertEqual((row.class_id, row.issuer_id), ("cls-a", "iss-a"))
        self.assertEqual(row.reason, RESOLVED)

    def test_no_class_segment_is_missing(self):
        row = self.resolve("AAA")
        self.assertEqual(row.status, MISSING)
        self.assertEqual(row.reason, NO_CLASS_SEGMENT_FOR_SYMBOL)

    def test_effective_to_equal_to_formation_is_not_active(self):
        self.issuer("iss-a")
        self.share_class("cls-a", "iss-a", "AAA", effective_to=self.F)
        row = self.resolve("AAA")
        self.assertEqual(row.status, MISSING)
        self.assertEqual(row.reason, CLASS_NOT_ACTIVE_AT_FORMATION)
        # 하루 뒤에 끝나면 formation에는 아직 살아 있다.
        self.share_class("cls-a", "iss-a", "AAA", effective_to="2020-07-01")
        self.assertEqual(self.resolve("AAA").status, RESOLVED)

    def test_class_known_only_after_formation_is_not_resolved(self):
        self.issuer("iss-a")
        self.share_class("cls-a", "iss-a", "AAA", usable="2020-07-01")
        row = self.resolve("AAA")
        self.assertEqual(row.status, MISSING)
        self.assertEqual(row.reason, CLASS_NOT_YET_USABLE)
        # 경제적으로는 formation에 활성이었다는 것이 요점이다.
        self.assertEqual(self.resolve("AAA", session="2020-07-01").status, RESOLVED)

    def test_issuer_known_only_after_formation_is_not_resolved(self):
        self.issuer("iss-a", usable="2020-07-01")
        self.share_class("cls-a", "iss-a", "AAA")
        row = self.resolve("AAA")
        self.assertEqual(row.status, MISSING)
        self.assertEqual(row.reason, ISSUER_NOT_YET_USABLE)
        self.assertEqual(row.class_id, "cls-a")

    def test_missing_issuer_row_is_missing(self):
        self.share_class("cls-a", "iss-absent", "AAA")
        row = self.resolve("AAA")
        self.assertEqual(row.status, MISSING)
        self.assertEqual(row.reason, ISSUER_MISSING)

    def test_multiple_valid_candidates_are_ambiguous_without_tie_break(self):
        self.issuer("iss-a")
        self.issuer("iss-b", cik="0000000002")
        self.share_class("cls-a", "iss-a", "AAA")
        self.share_class("cls-b", "iss-b", "AAA")
        row = self.resolve("AAA")
        self.assertEqual(row.status, AMBIGUOUS)
        self.assertEqual(row.reason, MULTIPLE_CLASS_RESOLUTIONS)
        # 모호한 집합에서 하나를 고르지 않는다.
        self.assertIsNone(row.class_id)
        self.assertIsNone(row.issuer_id)

    def test_overlapping_segments_of_one_class_fail_closed(self):
        self.issuer("iss-a")
        self.share_class("cls-a", "iss-a", "AAA", effective_from="2019-01-02")
        self.share_class("cls-a", "iss-a", "AAA", effective_from="2020-01-02")
        row = self.resolve("AAA")
        self.assertEqual(row.status, AMBIGUOUS)
        self.assertEqual(row.reason, CONTRADICTORY_IDENTITY_STATE)

    def test_unlisted_or_non_ordinary_class_cannot_resolve_a_member(self):
        self.issuer("iss-a")
        self.share_class("cls-a", "iss-a", "AAA", listed=False)
        self.assertEqual(self.resolve("AAA").reason, CLASS_NOT_LISTED_ORDINARY)
        self.share_class("cls-a", "iss-a", "AAA", listed=True, ordinary=False)
        self.assertEqual(self.resolve("AAA").reason, CLASS_NOT_LISTED_ORDINARY)

    def test_identity_source_versions_never_mix(self):
        self.issuer("iss-a", identity=OTHER_IDENTITY)
        self.share_class("cls-a", "iss-a", "AAA", identity=OTHER_IDENTITY)
        self.assertEqual(self.resolve("AAA", identity=IDENTITY).status, MISSING)
        self.assertEqual(self.resolve("AAA", identity=OTHER_IDENTITY).status, RESOLVED)

    def test_current_securities_or_ticker_tables_cannot_rescue_a_missing_identity(self):
        # 현재 securities/ticker 정보를 채워도 identity는 풀리지 않는다.
        self.connection.execute(
            "INSERT OR REPLACE INTO securities (symbol, sector, source, source_version)"
            " VALUES ('AAA', 'SIC1234', 'sec-edgar', 'securities-v1')"
        )
        self.connection.commit()
        row = self.resolve("AAA")
        self.assertEqual(row.status, MISSING)
        self.assertEqual(row.reason, NO_CLASS_SEGMENT_FOR_SYMBOL)


class IssuerGroupingTest(InventoryFixture, unittest.TestCase):
    def test_two_member_symbols_of_one_issuer_stay_two_rows_one_group(self):
        self.issuer("iss-alphabet")
        self.share_class("cls-a", "iss-alphabet", "GOOGL")
        self.share_class("cls-c", "iss-alphabet", "GOOG")
        self.member("GOOGL", "2019-01-02")
        self.member("GOOG", "2019-01-02")
        inventory = self.inventory()

        self.assertEqual(len(inventory.securities), 2)
        self.assertEqual(
            [row.symbol for row in inventory.securities], ["GOOG", "GOOGL"]
        )
        self.assertEqual({row.status for row in inventory.securities}, {RESOLVED})

        self.assertEqual(len(inventory.issuer_groups), 1)
        group = inventory.issuer_groups[0]
        self.assertEqual(group.issuer_id, "iss-alphabet")
        self.assertEqual(group.member_symbols, ("GOOG", "GOOGL"))
        self.assertEqual(group.member_class_ids, ("cls-a", "cls-c"))

        summary = inventory.formations[0]
        self.assertEqual(summary.member_count, 2)
        self.assertEqual(summary.resolved_count, 2)
        self.assertEqual(summary.resolved_issuer_count, 1)
        self.assertEqual(summary.multi_security_issuer_count, 1)


class DeterminismTest(InventoryFixture, unittest.TestCase):
    def build(self):
        self.issuer("iss-b", cik="0000000002")
        self.issuer("iss-a")
        self.share_class("cls-b", "iss-b", "BBB")
        self.share_class("cls-a", "iss-a", "AAA")
        for symbol in ("ZZZ", "BBB", "AAA"):
            self.member(symbol, "2019-01-02")
        return self.inventory(from_year=2019, to_year=2020)

    def test_output_is_sorted_and_semantically_deterministic(self):
        first = self.build().as_json(git_commit="deadbeef")
        second = self.build().as_json(git_commit="deadbeef")
        self.assertEqual(first, second)
        # 같은 payload는 같은 직렬화를 준다 — 시각 정보가 들어 있지 않다.
        self.assertEqual(
            json.dumps(first, sort_keys=True), json.dumps(second, sort_keys=True)
        )

        sessions = [item["formation_session"] for item in first["formations"]]
        self.assertEqual(sessions, sorted(sessions))
        keys = [(row["formation_session"], row["symbol"]) for row in first["securities"]]
        self.assertEqual(keys, sorted(keys))
        group_keys = [
            (row["formation_session"], row["issuer_id"]) for row in first["issuer_groups"]
        ]
        self.assertEqual(group_keys, sorted(group_keys))
        for row in first["issuer_groups"]:
            self.assertEqual(row["member_symbols"], sorted(row["member_symbols"]))

    def test_payload_carries_the_explicit_source_versions(self):
        payload = self.build().as_json(git_commit="deadbeef")
        self.assertEqual(payload["index_name"], INDEX)
        self.assertEqual(payload["universe_source_version"], UNI_VERSION)
        self.assertEqual(payload["calendar_source_version"], CAL_VERSION)
        self.assertEqual(payload["identity_source_version"], IDENTITY)
        self.assertEqual(payload["starting_git_commit"], "deadbeef")

    def test_unresolved_symbols_are_reported(self):
        inventory = self.build()
        self.assertIn("ZZZ", inventory.unresolved_symbols())
        self.assertNotIn("AAA", inventory.unresolved_symbols())


if __name__ == "__main__":
    unittest.main()
