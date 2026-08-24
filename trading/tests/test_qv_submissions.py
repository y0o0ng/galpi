"""QV Phase 0 submissions ingestion의 raw-CIK/PIT 불변식."""

from __future__ import annotations

import sqlite3
import sys
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
from backtest.qv_submissions import (  # noqa: E402
    AMBIGUOUS,
    EXACT,
    MISSING,
    QVSubmissionsError,
    historical_sic,
    ingest_submissions,
    normalize_acceptance_datetime,
    parse_filing_sic,
    parse_submission_rows,
)

SOURCE = "sec-edgar-qv"
SOURCE_VERSION = "sec-submissions-fixture-v1"
CALENDAR_SOURCE = "synthetic-calendar"
CALENDAR_VERSION = "calendar-fixture-v1"


def submissions_block(
    rows: list[dict[str, str]], *, omit: tuple[str, ...] = ()
) -> dict[str, list[str]]:
    fields = (
        "accessionNumber",
        "form",
        "filingDate",
        "reportDate",
        "acceptanceDateTime",
        "primaryDocument",
    )
    return {
        field: [row.get(field, "") for row in rows]
        for field in fields
        if field not in omit
    }


def filing(
    accession: str,
    *,
    form: str = "10-K",
    filed: str = "2024-01-05",
    report: str = "2023-12-31",
    accepted: str = "2024-01-05T18:30:00.000Z",
    primary_document: str = "annual.htm",
) -> dict[str, str]:
    return {
        "accessionNumber": accession,
        "form": form,
        "filingDate": filed,
        "reportDate": report,
        "acceptanceDateTime": accepted,
        "primaryDocument": primary_document,
    }


def complete_header(*blocks: tuple[str, str | None]) -> str:
    lines = ["<SEC-HEADER>fixture"]
    for cik, sic in blocks:
        lines.extend(
            [
                "FILER:",
                "",
                "\tCOMPANY DATA:",
                "\t\tCOMPANY CONFORMED NAME: FIXTURE INC",
                f"\t\tCENTRAL INDEX KEY: {cik}",
            ]
        )
        if sic is not None:
            lines.append(
                "\t\tSTANDARD INDUSTRIAL CLASSIFICATION: "
                f"SEMICONDUCTORS & RELATED DEVICES [{sic}]"
            )
        lines.extend(["", "\tFILING VALUES:", "\t\tFORM TYPE: 10-K"])
    lines.extend(["</SEC-HEADER>", "<DOCUMENT>", "ignored"])
    return "\n".join(lines)


class FakeEdgarClient:
    def __init__(
        self,
        recent_by_cik: dict[str, dict],
        *,
        archives: dict[str, dict] | None = None,
        headers: dict[tuple[str, str], str] | None = None,
    ) -> None:
        self.recent_by_cik = recent_by_cik
        self.archives = archives or {}
        self.headers = headers or {}
        self.archive_calls: list[str] = []
        self.header_calls: list[tuple[str, str]] = []

    def submissions(self, cik: str) -> dict:
        return self.recent_by_cik[cik]

    def submissions_archive(self, name: str) -> dict:
        self.archive_calls.append(name)
        return self.archives[name]

    def complete_submission_text(self, cik: str, accession: str) -> str:
        self.header_calls.append((cik, accession))
        return self.headers[(cik, accession)]


class QVSubmissionsFixture:
    def setUp(self) -> None:
        self.connection = store.connect_memory()
        register_source(
            self.connection,
            CALENDAR_SOURCE,
            CALENDAR_VERSION,
            "bars",
            point_in_time=True,
            survivorship_biased=False,
        )
        self.add_calendar("2024-01-04", "2024-01-05", "2024-01-08", "2024-01-09")

    def add_calendar(self, *dates: str) -> None:
        present = {
            row["trade_date"]
            for row in self.connection.execute(
                "SELECT trade_date FROM bars_daily"
                " WHERE symbol = 'SPY' AND source_version = ?",
                (CALENDAR_VERSION,),
            )
        }
        missing = [value for value in dates if value not in present]
        if not missing:
            return
        csv = "symbol,trade_date,open,high,low,close,volume,adj_close\n" + "".join(
            f"SPY,{value},100,101,99,100,1000,100\n" for value in missing
        )
        load_bars_csv(
            self.connection, csv, CALENDAR_SOURCE, CALENDAR_VERSION
        )

    def client(
        self,
        cik: str,
        recent_rows: list[dict[str, str]],
        *,
        archive_rows: dict[str, list[dict[str, str]]] | None = None,
        header: str | None = None,
    ) -> FakeEdgarClient:
        normalized = str(cik).zfill(10)
        files = [
            {"name": name, "filingFrom": "2000-01-01", "filingTo": "2020-01-01"}
            for name in (archive_rows or {})
        ]
        recent = {
            "filings": {
                "recent": submissions_block(recent_rows),
                "files": files,
            }
        }
        archives = {
            name: submissions_block(rows)
            for name, rows in (archive_rows or {}).items()
        }
        all_rows = list(recent_rows)
        for rows in (archive_rows or {}).values():
            all_rows.extend(rows)
        header_text = header or complete_header((normalized, "3674"))
        headers = {
            (normalized, row["accessionNumber"]): header_text for row in all_rows
        }
        return FakeEdgarClient(
            {normalized: recent}, archives=archives, headers=headers
        )

    def ingest(
        self,
        client: FakeEdgarClient,
        cik: str,
        *,
        source_version: str = SOURCE_VERSION,
    ) -> int:
        return ingest_submissions(
            self.connection,
            client,
            cik=cik,
            source=SOURCE,
            source_version=source_version,
            calendar_source=CALENDAR_SOURCE,
            calendar_source_version=CALENDAR_VERSION,
        )


class ColumnarParsingTest(unittest.TestCase):
    def test_recent_rows_are_parsed_in_source_order(self):
        rows = parse_submission_rows(
            submissions_block(
                [
                    filing("0000000001-24-000002", form="10-Q"),
                    filing("0000000001-24-000001"),
                ]
            ),
            submissions_file="CIK0000000001.json",
        )
        self.assertEqual(
            [row.accession for row in rows],
            ["0000000001-24-000002", "0000000001-24-000001"],
        )
        self.assertEqual(rows[0].form, "10-Q")
        self.assertEqual(rows[0].submissions_file, "CIK0000000001.json")

    def test_required_column_length_mismatch_is_rejected(self):
        block = submissions_block([filing("0000000001-24-000001")])
        block["form"].append("10-Q")
        with self.assertRaises(QVSubmissionsError):
            parse_submission_rows(block, submissions_file="recent.json")

    def test_missing_required_column_is_rejected(self):
        block = submissions_block([filing("0000000001-24-000001")])
        del block["filingDate"]
        with self.assertRaises(QVSubmissionsError):
            parse_submission_rows(block, submissions_file="recent.json")

    def test_absent_optional_columns_become_null(self):
        rows = parse_submission_rows(
            submissions_block(
                [filing("0000000001-24-000001")],
                omit=("reportDate", "acceptanceDateTime", "primaryDocument"),
            ),
            submissions_file="recent.json",
        )
        self.assertIsNone(rows[0].report_date)
        self.assertIsNone(rows[0].acceptance_datetime)
        self.assertIsNone(rows[0].primary_document)

    def test_present_optional_column_length_mismatch_is_rejected(self):
        block = submissions_block([filing("0000000001-24-000001")])
        block["reportDate"] = []
        with self.assertRaises(QVSubmissionsError):
            parse_submission_rows(block, submissions_file="recent.json")

    def test_disallowed_forms_are_filtered_after_row_validation(self):
        rows = parse_submission_rows(
            submissions_block(
                [
                    filing("0000000001-24-000001", form="8-K"),
                    filing("0000000001-24-000002", form="10-Q/A"),
                ]
            ),
            submissions_file="recent.json",
        )
        self.assertEqual([row.form for row in rows], ["10-Q/A"])

    def test_disallowed_row_still_participates_in_length_validation(self):
        block = submissions_block(
            [filing("0000000001-24-000001", form="8-K")]
        )
        block["primaryDocument"] = []
        with self.assertRaises(QVSubmissionsError):
            parse_submission_rows(block, submissions_file="recent.json")


class AcceptanceNormalizationTest(unittest.TestCase):
    def test_sec_timestamp_is_normalized_without_calendar_date_shift(self):
        self.assertEqual(
            normalize_acceptance_datetime("2024-01-05T23:59:59.123Z"),
            "2024-01-05T23:59:59.123000Z",
        )

    def test_missing_acceptance_is_null(self):
        self.assertIsNone(normalize_acceptance_datetime(""))
        self.assertIsNone(normalize_acceptance_datetime(None))

    def test_non_empty_malformed_acceptance_is_rejected(self):
        for value in (
            "2024-01-05",
            "2024-01-05 18:30:00",
            "2024-01-05T25:00:00.000Z",
            "2024-01-05T18:30:00-05:00",
        ):
            with self.subTest(value=value), self.assertRaises(QVSubmissionsError):
                normalize_acceptance_datetime(value)


class FilingSicParsingTest(unittest.TestCase):
    def test_single_target_filer_is_exact(self):
        result = parse_filing_sic(
            complete_header(("0000320193", "3674")), "320193"
        )
        self.assertEqual((result.filing_sic, result.status), ("3674", EXACT))

    def test_a_different_cik_block_before_target_is_ignored(self):
        result = parse_filing_sic(
            complete_header(
                ("0000000002", "6021"), ("0000320193", "3674")
            ),
            "0000320193",
        )
        self.assertEqual((result.filing_sic, result.status), ("3674", EXACT))

    def test_repeated_target_blocks_with_same_sic_are_exact(self):
        result = parse_filing_sic(
            complete_header(
                ("0000320193", "3674"), ("0000320193", "3674")
            ),
            "0000320193",
        )
        self.assertEqual((result.filing_sic, result.status), ("3674", EXACT))

    def test_missing_target_block_is_missing(self):
        result = parse_filing_sic(
            complete_header(("0000000002", "6021")), "0000320193"
        )
        self.assertEqual((result.filing_sic, result.status), (None, MISSING))

    def test_target_with_distinct_sics_is_ambiguous(self):
        result = parse_filing_sic(
            complete_header(
                ("0000320193", "3674"), ("0000320193", "7372")
            ),
            "0000320193",
        )
        self.assertEqual((result.filing_sic, result.status), (None, AMBIGUOUS))

    def test_numeric_bracket_code_is_extracted_not_description(self):
        result = parse_filing_sic(
            complete_header(("0000320193", "3674")), "0000320193"
        )
        self.assertEqual(result.filing_sic, "3674")

    def test_leading_zero_sic_is_preserved(self):
        result = parse_filing_sic(
            complete_header(("0000320193", "0100")), "0000320193"
        )
        self.assertEqual(result.filing_sic, "0100")

    def test_non_filer_company_data_is_ignored(self):
        text = "\n".join(
            [
                "<SEC-HEADER>fixture",
                "SUBJECT COMPANY:",
                "\tCOMPANY DATA:",
                "\t\tCENTRAL INDEX KEY: 0000320193",
                "\t\tSTANDARD INDUSTRIAL CLASSIFICATION: BANKS [6021]",
                "</SEC-HEADER>",
            ]
        )
        result = parse_filing_sic(text, "0000320193")
        self.assertEqual((result.filing_sic, result.status), (None, MISSING))


class IngestionTest(QVSubmissionsFixture, unittest.TestCase):
    def test_recent_and_archive_rows_are_both_ingested(self):
        recent = filing("0000320193-24-000001")
        archived = filing(
            "0000320193-19-000001",
            filed="2019-02-01",
            report="2018-12-31",
            accepted="2019-02-01T17:00:00.000Z",
        )
        client = self.client(
            "320193",
            [recent],
            archive_rows={"CIK0000320193-submissions-001.json": [archived]},
        )
        self.assertEqual(self.ingest(client, "320193"), 2)
        rows = self.connection.execute(
            "SELECT accession, submissions_file FROM qv_sec_filings"
            " ORDER BY accession"
        ).fetchall()
        self.assertEqual(
            [(row["accession"], row["submissions_file"]) for row in rows],
            [
                (
                    "0000320193-19-000001",
                    "CIK0000320193-submissions-001.json",
                ),
                ("0000320193-24-000001", "CIK0000320193.json"),
            ],
        )
        self.assertEqual(client.archive_calls, ["CIK0000320193-submissions-001.json"])

    def test_archive_rows_can_be_ingested_without_recent_matches(self):
        archived = filing("0000320193-19-000001", form="10-Q")
        client = self.client(
            "320193",
            [],
            archive_rows={"old.json": [archived]},
        )
        self.assertEqual(self.ingest(client, "320193"), 1)
        self.assertEqual(
            self.connection.execute(
                "SELECT form FROM qv_sec_filings"
            ).fetchone()["form"],
            "10-Q",
        )

    def test_disallowed_forms_are_not_fetched_or_stored(self):
        row = filing("0000320193-24-000001", form="8-K")
        client = self.client("320193", [row])
        self.assertEqual(self.ingest(client, "320193"), 0)
        self.assertEqual(client.header_calls, [])
        self.assertEqual(
            self.connection.execute(
                "SELECT COUNT(*) AS n FROM qv_sec_filings"
            ).fetchone()["n"],
            0,
        )

    def test_cik_is_zero_padded(self):
        row = filing("0000320193-24-000001")
        client = self.client("320193", [row])
        self.ingest(client, "320193")
        self.assertEqual(
            self.connection.execute(
                "SELECT cik FROM qv_sec_filings"
            ).fetchone()["cik"],
            "0000320193",
        )

    def test_same_accession_for_two_target_ciks_is_preserved_twice(self):
        accession = "0000320193-24-000001"
        row = filing(accession)
        shared_header = complete_header(
            ("0000320193", "3674"), ("0000789019", "7372")
        )
        first = self.client("320193", [row], header=shared_header)
        second = self.client("789019", [row], header=shared_header)
        self.ingest(first, "320193")
        self.ingest(second, "789019")
        rows = self.connection.execute(
            "SELECT cik, filing_sic FROM qv_sec_filings ORDER BY cik"
        ).fetchall()
        self.assertEqual(
            [(item["cik"], item["filing_sic"]) for item in rows],
            [("0000320193", "3674"), ("0000789019", "7372")],
        )

    def test_same_key_and_source_version_is_immutable(self):
        row = filing("0000320193-24-000001", primary_document="first.htm")
        client = self.client("320193", [row])
        self.ingest(client, "320193")

        changed = filing("0000320193-24-000001", primary_document="changed.htm")
        with self.assertRaises(QVSubmissionsError):
            self.ingest(self.client("320193", [changed]), "320193")
        stored = self.connection.execute(
            "SELECT primary_document FROM qv_sec_filings"
        ).fetchone()
        self.assertEqual(stored["primary_document"], "first.htm")

    def test_same_day_is_never_usable_and_next_session_is_used(self):
        row = filing(
            "0000320193-24-000001",
            accepted="2024-01-05T08:00:00.000Z",
        )
        self.ingest(self.client("320193", [row]), "320193")
        stored = self.connection.execute(
            "SELECT acceptance_datetime, historical_usable_session"
            " FROM qv_sec_filings"
        ).fetchone()
        self.assertEqual(
            stored["acceptance_datetime"], "2024-01-05T08:00:00.000000Z"
        )
        self.assertEqual(stored["historical_usable_session"], "2024-01-08")

    def test_friday_after_close_and_weekend_use_next_regular_session(self):
        rows = [
            filing(
                "0000320193-24-000001",
                accepted="2024-01-05T23:30:00.000Z",
            ),
            filing(
                "0000320193-24-000002",
                filed="2024-01-06",
                accepted="2024-01-06T12:00:00.000Z",
            ),
        ]
        self.ingest(self.client("320193", rows), "320193")
        sessions = [
            row["historical_usable_session"]
            for row in self.connection.execute(
                "SELECT historical_usable_session FROM qv_sec_filings"
                " ORDER BY accession"
            )
        ]
        self.assertEqual(sessions, ["2024-01-08", "2024-01-08"])

    def test_missing_acceptance_does_not_fallback_to_filed_date(self):
        row = filing("0000320193-24-000001", accepted="")
        self.ingest(self.client("320193", [row]), "320193")
        stored = self.connection.execute(
            "SELECT filed_date, acceptance_datetime, historical_usable_session"
            " FROM qv_sec_filings"
        ).fetchone()
        self.assertEqual(stored["filed_date"], "2024-01-05")
        self.assertIsNone(stored["acceptance_datetime"])
        self.assertIsNone(stored["historical_usable_session"])

    def test_malformed_acceptance_rejects_the_ingestion(self):
        row = filing(
            "0000320193-24-000001", accepted="2024-01-05 18:30:00"
        )
        with self.assertRaises(QVSubmissionsError):
            self.ingest(self.client("320193", [row]), "320193")
        self.assertEqual(
            self.connection.execute(
                "SELECT COUNT(*) AS n FROM qv_sec_filings"
            ).fetchone()["n"],
            0,
        )

    def test_calendar_coverage_end_does_not_fabricate_a_session(self):
        row = filing(
            "0000320193-24-000001",
            filed="2024-01-10",
            accepted="2024-01-10T18:30:00.000Z",
        )
        self.ingest(self.client("320193", [row]), "320193")
        self.assertIsNone(
            self.connection.execute(
                "SELECT historical_usable_session FROM qv_sec_filings"
            ).fetchone()["historical_usable_session"]
        )

    def test_provenance_and_calendar_source_are_stored(self):
        row = filing("0000320193-24-000001")
        self.ingest(self.client("320193", [row]), "320193")
        stored = self.connection.execute(
            "SELECT * FROM qv_sec_filings"
        ).fetchone()
        self.assertEqual(stored["calendar_source"], CALENDAR_SOURCE)
        self.assertEqual(stored["calendar_source_version"], CALENDAR_VERSION)
        self.assertIn("0000320193", stored["provenance"])
        self.assertIn("0000320193-24-000001", stored["provenance"])
        self.assertIn("CIK0000320193.json", stored["provenance"])
        self.assertIn("Archives/edgar/data", stored["provenance"])


class HistoricalSicLookupTest(QVSubmissionsFixture, unittest.TestCase):
    def insert_filing(
        self,
        *,
        accession: str,
        accepted: str,
        sic: str | None,
        form: str = "10-K",
        header_status: str = EXACT,
    ) -> None:
        if header_status == AMBIGUOUS:
            header = complete_header(
                ("0000320193", "3674"), ("0000320193", "7372")
            )
        elif sic is None:
            header = complete_header(("0000320193", None))
        else:
            header = complete_header(("0000320193", sic))
        row = filing(accession, form=form, accepted=accepted)
        self.ingest(self.client("320193", [row], header=header), "320193")

    def test_latest_acceptance_wins(self):
        self.insert_filing(
            accession="0000320193-24-000001",
            accepted="2024-01-04T18:00:00.000Z",
            sic="3674",
        )
        self.insert_filing(
            accession="0000320193-24-000002",
            accepted="2024-01-05T18:00:00.000Z",
            sic="7372",
        )
        result = historical_sic(
            self.connection, "320193", "2024-01-08", SOURCE_VERSION
        )
        self.assertIsNotNone(result)
        self.assertEqual(result.accession, "0000320193-24-000002")
        self.assertEqual(result.filing_sic, "7372")

    def test_same_acceptance_uses_accession_descending(self):
        accepted = "2024-01-05T18:00:00.000Z"
        self.insert_filing(
            accession="0000320193-24-000001", accepted=accepted, sic="3674"
        )
        self.insert_filing(
            accession="0000320193-24-000002", accepted=accepted, sic="7372"
        )
        result = historical_sic(
            self.connection, "320193", "2024-01-08", SOURCE_VERSION
        )
        self.assertEqual(result.accession, "0000320193-24-000002")

    def test_latest_missing_does_not_fallback_to_older_exact(self):
        self.insert_filing(
            accession="0000320193-24-000001",
            accepted="2024-01-04T18:00:00.000Z",
            sic="3674",
        )
        self.insert_filing(
            accession="0000320193-24-000002",
            accepted="2024-01-05T18:00:00.000Z",
            sic=None,
        )
        result = historical_sic(
            self.connection, "320193", "2024-01-08", SOURCE_VERSION
        )
        self.assertEqual(result.status, MISSING)
        self.assertIsNone(result.filing_sic)
        self.assertEqual(result.accession, "0000320193-24-000002")

    def test_latest_ambiguous_does_not_fallback_to_older_exact(self):
        self.insert_filing(
            accession="0000320193-24-000001",
            accepted="2024-01-04T18:00:00.000Z",
            sic="3674",
        )
        self.insert_filing(
            accession="0000320193-24-000002",
            accepted="2024-01-05T18:00:00.000Z",
            sic=None,
            header_status=AMBIGUOUS,
        )
        result = historical_sic(
            self.connection, "320193", "2024-01-08", SOURCE_VERSION
        )
        self.assertEqual(result.status, AMBIGUOUS)
        self.assertIsNone(result.filing_sic)

    def test_formation_before_usable_session_does_not_see_the_filing(self):
        self.insert_filing(
            accession="0000320193-24-000001",
            accepted="2024-01-05T18:00:00.000Z",
            sic="3674",
        )
        self.assertIsNone(
            historical_sic(
                self.connection, "320193", "2024-01-05", SOURCE_VERSION
            )
        )

    def test_a_more_recent_10q_can_win_over_a_10k(self):
        self.insert_filing(
            accession="0000320193-24-000001",
            accepted="2024-01-04T18:00:00.000Z",
            sic="3674",
            form="10-K",
        )
        self.insert_filing(
            accession="0000320193-24-000002",
            accepted="2024-01-05T18:00:00.000Z",
            sic="7372",
            form="10-Q",
        )
        result = historical_sic(
            self.connection, "320193", "2024-01-08", SOURCE_VERSION
        )
        self.assertEqual((result.form, result.filing_sic), ("10-Q", "7372"))


class ExistingContractRegressionTest(QVSubmissionsFixture, unittest.TestCase):
    def test_qv_filing_table_is_raw_cik_layer_without_issuer_id(self):
        columns = {
            row["name"]
            for row in self.connection.execute("PRAGMA table_info(qv_sec_filings)")
        }
        self.assertIn("cik", columns)
        self.assertNotIn("issuer_id", columns)

    def test_qv_filing_rows_do_not_change_momentum_snapshot_id(self):
        before = PointInTimeSnapshot(
            self.connection, "2024-01-09", CALENDAR_VERSION
        ).snapshot_id
        row = filing("0000320193-24-000001")
        self.ingest(self.client("320193", [row]), "320193")
        after = PointInTimeSnapshot(
            self.connection, "2024-01-09", CALENDAR_VERSION
        ).snapshot_id
        self.assertEqual(after, before)

    def test_existing_securities_and_features_schemas_are_unchanged(self):
        securities = [
            row["name"]
            for row in self.connection.execute("PRAGMA table_info(securities)")
        ]
        self.assertEqual(
            securities, ["symbol", "sector", "source", "source_version"]
        )
        features = {
            row["name"]
            for row in self.connection.execute("PRAGMA table_info(features_daily)")
        }
        self.assertNotIn("quality", features)
        self.assertNotIn("value", features)
        self.assertNotIn("qv_score", features)

    def test_table_primary_key_keeps_target_cik_in_identity(self):
        pk = [
            row["name"]
            for row in self.connection.execute("PRAGMA table_info(qv_sec_filings)")
            if row["pk"]
        ]
        self.assertEqual(pk, ["cik", "accession", "source_version"])

    def test_schema_rejects_inconsistent_sic_status(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.connection.execute(
                "INSERT INTO qv_sec_filings"
                " (cik, accession, form, filed_date, report_date,"
                "  acceptance_datetime, historical_usable_session, filing_sic,"
                "  sic_status, primary_document, submissions_file, calendar_source,"
                "  calendar_source_version, source, source_version, provenance)"
                " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    "0000320193",
                    "0000320193-24-000001",
                    "10-K",
                    "2024-01-05",
                    "2023-12-31",
                    None,
                    None,
                    "3674",
                    MISSING,
                    "annual.htm",
                    "recent.json",
                    CALENDAR_SOURCE,
                    CALENDAR_VERSION,
                    SOURCE,
                    SOURCE_VERSION,
                    "fixture://invalid",
                ),
            )

    def test_schema_rejects_same_day_usable_session(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.connection.execute(
                "INSERT INTO qv_sec_filings"
                " (cik, accession, form, filed_date, report_date,"
                "  acceptance_datetime, historical_usable_session, filing_sic,"
                "  sic_status, primary_document, submissions_file, calendar_source,"
                "  calendar_source_version, source, source_version, provenance)"
                " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    "0000320193",
                    "0000320193-24-000001",
                    "10-K",
                    "2024-01-05",
                    "2023-12-31",
                    "2024-01-05T08:00:00.000000Z",
                    "2024-01-05",
                    "3674",
                    EXACT,
                    "annual.htm",
                    "recent.json",
                    CALENDAR_SOURCE,
                    CALENDAR_VERSION,
                    SOURCE,
                    SOURCE_VERSION,
                    "fixture://same-day",
                ),
            )


if __name__ == "__main__":
    unittest.main()
