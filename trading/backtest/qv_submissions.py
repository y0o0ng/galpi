"""Quality + Value의 SEC submissions raw-CIK/PIT 원장.

이 모듈은 recent/archive filing metadata, SEC/Eastern acceptance date 이후 첫 SPY
세션, complete submission header의 filing-time SIC만 다룬다. CIK를 issuer로 승격하거나
accounting fact, shares, formation snapshot, factor와 수익률을 계산하지 않는다.
"""

from __future__ import annotations

import json
import re
import sqlite3
from dataclasses import dataclass
from datetime import date, datetime
from zoneinfo import ZoneInfo

from .edgar import EdgarClient, complete_submission_url


ALLOWED_FORMS = frozenset({"10-K", "10-K/A", "10-Q", "10-Q/A"})
EXACT = "EXACT"
MISSING = "MISSING"
AMBIGUOUS = "AMBIGUOUS"

_REQUIRED_COLUMNS = ("accessionNumber", "form", "filingDate")
_OPTIONAL_COLUMNS = ("reportDate", "acceptanceDateTime", "primaryDocument", "items")
_ACCESSION_PATTERN = re.compile(r"^\d{10}-\d{2}-\d{6}$")
_ACCEPTANCE_PATTERN = re.compile(
    r"^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?Z$"
)
_TOP_LEVEL_HEADING = re.compile(r"^[A-Z][A-Z0-9 &/\-]*:$")
_CIK_LINE = re.compile(r"CENTRAL INDEX KEY:\s*(\d+)", re.IGNORECASE)
_SIC_LINE = re.compile(
    r"STANDARD INDUSTRIAL CLASSIFICATION:.*\[(\d{4})\]", re.IGNORECASE
)
_SEC_TIMEZONE = ZoneInfo("America/New_York")


class QVSubmissionsError(Exception):
    """QV submissions 원자료가 PIT/shape 계약을 만족하지 못할 때 올린다."""


@dataclass(frozen=True)
class SubmissionRow:
    accession: str
    form: str
    filed_date: str
    report_date: str | None
    acceptance_datetime: str | None
    acceptance_eastern_date: str | None
    primary_document: str | None
    submissions_file: str
    # 8-K의 구조화된 항목 번호(`5.03,9.01`). K/Q 적재 경로는 쓰지 않고, governing
    # instrument 탐색이 "이 8-K가 정관 변경을 알린다"를 **명시 metadata로** 볼 때 쓴다.
    items: str | None = None


@dataclass(frozen=True)
class FilingSic:
    filing_sic: str | None
    status: str


@dataclass(frozen=True)
class HistoricalSic:
    cik: str
    accession: str
    form: str
    acceptance_datetime: str
    historical_usable_session: str
    filing_sic: str | None
    status: str
    source: str
    source_version: str
    provenance: str


def _required(value: object, field: str) -> str:
    clean = str(value if value is not None else "").strip()
    if not clean:
        raise QVSubmissionsError(f"{field}는 비울 수 없습니다.")
    return clean


def _optional(value: object) -> str | None:
    if value is None:
        return None
    clean = str(value).strip()
    return clean or None


def _normalize_cik(cik: object) -> str:
    clean = _required(cik, "cik")
    if not clean.isdigit() or len(clean) > 10:
        raise QVSubmissionsError(
            f"cik는 10자리 이하 숫자여야 합니다: {clean!r}"
        )
    return clean.zfill(10)


def _normalize_date(value: object, field: str, *, required: bool) -> str | None:
    clean = _optional(value)
    if clean is None:
        if required:
            raise QVSubmissionsError(f"{field}는 비울 수 없습니다.")
        return None
    try:
        parsed = date.fromisoformat(clean)
    except ValueError as error:
        raise QVSubmissionsError(
            f"{field}가 YYYY-MM-DD 날짜가 아닙니다: {clean!r}"
        ) from error
    if parsed.isoformat() != clean:
        raise QVSubmissionsError(
            f"{field}가 canonical YYYY-MM-DD가 아닙니다: {clean!r}"
        )
    return clean


def normalize_acceptance_datetime(value: object | None) -> str | None:
    """SEC acceptance를 날짜 이동 없이 고정 폭 UTC 문자열로 정규화한다."""
    clean = _optional(value)
    if clean is None:
        return None
    matched = _ACCEPTANCE_PATTERN.fullmatch(clean)
    if matched is None:
        raise QVSubmissionsError(
            f"acceptanceDateTime 형식이 예상과 다릅니다: {clean!r}"
        )
    day, clock, fraction = matched.groups()
    try:
        datetime.fromisoformat(f"{day}T{clock}.{(fraction or '0').ljust(6, '0')}")
    except ValueError as error:
        raise QVSubmissionsError(
            f"acceptanceDateTime 값이 유효하지 않습니다: {clean!r}"
        ) from error
    return f"{day}T{clock}.{(fraction or '0').ljust(6, '0')}Z"


def _acceptance_eastern_date(acceptance_datetime: str | None) -> str | None:
    """UTC acceptance instant가 속한 실제 America/New_York calendar date."""
    if acceptance_datetime is None:
        return None
    accepted_utc = datetime.fromisoformat(
        acceptance_datetime.removesuffix("Z") + "+00:00"
    )
    return accepted_utc.astimezone(_SEC_TIMEZONE).date().isoformat()


def _column(block: dict, name: str, *, required: bool, count: int | None) -> list:
    if name not in block:
        if required:
            raise QVSubmissionsError(f"submissions 필수 column이 없습니다: {name}")
        assert count is not None
        return [None] * count
    values = block[name]
    if not isinstance(values, list):
        raise QVSubmissionsError(f"submissions column이 array가 아닙니다: {name}")
    if count is not None and len(values) != count:
        raise QVSubmissionsError(
            f"submissions column 길이가 다릅니다: {name}={len(values)}, rows={count}"
        )
    return values


def parse_submission_rows(
    block: object, *, submissions_file: str, forms=ALLOWED_FORMS
) -> tuple[SubmissionRow, ...]:
    """compact columnar block을 검증한 뒤 요청한 form의 row만 만든다.

    **기본값은 K/Q 계열 그대로다.** `qv_sec_filings` 적재 경로의 동작은 바뀌지 않는다.
    `forms=None`이면 form을 거르지 않는다 — governing instrument 탐색이 8-K 같은 다른
    form을 열거해야 하는데, 그렇다고 `qv_sec_filings`를 범용 SEC filing 창고로
    넓히지는 않는다.
    """
    if not isinstance(block, dict):
        raise QVSubmissionsError(
            f"submissions block이 객체가 아닙니다: {submissions_file}"
        )
    submissions_file = _required(submissions_file, "submissions_file")
    accession_values = _column(
        block, "accessionNumber", required=True, count=None
    )
    count = len(accession_values)
    columns = {"accessionNumber": accession_values}
    for name in _REQUIRED_COLUMNS[1:]:
        columns[name] = _column(block, name, required=True, count=count)
    for name in _OPTIONAL_COLUMNS:
        columns[name] = _column(block, name, required=False, count=count)

    rows: list[SubmissionRow] = []
    for index in range(count):
        accession = _required(
            columns["accessionNumber"][index], f"accessionNumber[{index}]"
        )
        if _ACCESSION_PATTERN.fullmatch(accession) is None:
            raise QVSubmissionsError(
                f"accessionNumber 형식이 잘못됐습니다: {accession!r}"
            )
        form = _required(columns["form"][index], f"form[{index}]")
        filed_date = _normalize_date(
            columns["filingDate"][index], f"filingDate[{index}]", required=True
        )
        report_date = _normalize_date(
            columns["reportDate"][index], f"reportDate[{index}]", required=False
        )
        acceptance = normalize_acceptance_datetime(
            columns["acceptanceDateTime"][index]
        )
        primary_document = _optional(columns["primaryDocument"][index])
        if forms is None or form in forms:
            rows.append(
                SubmissionRow(
                    accession=accession,
                    form=form,
                    filed_date=str(filed_date),
                    report_date=report_date,
                    acceptance_datetime=acceptance,
                    acceptance_eastern_date=_acceptance_eastern_date(acceptance),
                    primary_document=primary_document,
                    submissions_file=submissions_file,
                    items=_optional(columns["items"][index]),
                )
            )
    return tuple(rows)


def _indent(line: str) -> int:
    expanded = line.expandtabs(8)
    return len(expanded) - len(expanded.lstrip())


def _header_lines(text: str) -> list[str]:
    header = str(text).split("</SEC-HEADER>", 1)[0]
    header = header.split("<DOCUMENT>", 1)[0]
    return header.splitlines()


def parse_filing_sic(complete_submission: str, target_cik: object) -> FilingSic:
    """target CIK의 FILER/COMPANY DATA block에서 distinct SIC를 결정한다."""
    target = _normalize_cik(target_cik)
    found: set[str] = set()
    top_section: str | None = None
    in_company_data = False
    company_indent = 0
    block_ciks: set[str] = set()
    block_sics: set[str] = set()

    def finish_company_data() -> None:
        nonlocal in_company_data, block_ciks, block_sics
        if target in block_ciks:
            found.update(block_sics)
        in_company_data = False
        block_ciks = set()
        block_sics = set()

    for raw_line in _header_lines(complete_submission):
        stripped = raw_line.strip()
        indent = _indent(raw_line)
        if indent == 0 and _TOP_LEVEL_HEADING.fullmatch(stripped):
            finish_company_data()
            top_section = stripped[:-1]
            continue
        if top_section != "FILER":
            continue
        if stripped == "COMPANY DATA:":
            finish_company_data()
            in_company_data = True
            company_indent = indent
            continue
        if (
            in_company_data
            and stripped.endswith(":")
            and indent <= company_indent
        ):
            finish_company_data()
            continue
        if not in_company_data:
            continue
        cik_match = _CIK_LINE.search(stripped)
        if cik_match and len(cik_match.group(1)) <= 10:
            block_ciks.add(cik_match.group(1).zfill(10))
        sic_match = _SIC_LINE.search(stripped)
        if sic_match:
            block_sics.add(sic_match.group(1))
    finish_company_data()

    if len(found) == 1:
        return FilingSic(next(iter(found)), EXACT)
    if not found:
        return FilingSic(None, MISSING)
    return FilingSic(None, AMBIGUOUS)


def _historical_usable_session(
    connection: sqlite3.Connection,
    acceptance_eastern_date: str | None,
    calendar_source: str,
    calendar_source_version: str,
) -> str | None:
    if acceptance_eastern_date is None:
        return None
    row = connection.execute(
        "SELECT MIN(trade_date) AS trade_date FROM bars_daily"
        " WHERE symbol = 'SPY' AND source = ? AND source_version = ?"
        " AND trade_date > ?",
        (calendar_source, calendar_source_version, acceptance_eastern_date),
    ).fetchone()
    return row["trade_date"] if row and row["trade_date"] else None


def _submissions_rows(
    client: EdgarClient, cik: str, *, forms=ALLOWED_FORMS
) -> tuple[SubmissionRow, ...]:
    """recent + archive submission row. **form 필터만 선택적이다.**

    `forms=None`이면 전부 열거한다. 적재 경로는 기본값을 쓰므로 `qv_sec_filings`는
    여전히 K/Q 계열만 담는다.
    """
    payload = client.submissions(cik)
    filings = payload.get("filings")
    if not isinstance(filings, dict):
        raise QVSubmissionsError(f"submissions filings가 객체가 아닙니다: {cik}")
    recent = filings.get("recent")
    if not isinstance(recent, dict):
        raise QVSubmissionsError(f"submissions recent가 객체가 아닙니다: {cik}")
    rows = list(
        parse_submission_rows(recent, submissions_file=f"CIK{cik}.json", forms=forms)
    )
    files = filings.get("files", [])
    if not isinstance(files, list):
        raise QVSubmissionsError(f"submissions files가 array가 아닙니다: {cik}")
    for index, metadata in enumerate(files):
        if not isinstance(metadata, dict):
            raise QVSubmissionsError(
                f"submissions files[{index}]가 객체가 아닙니다: {cik}"
            )
        name = _required(metadata.get("name"), f"filings.files[{index}].name")
        archive = client.submissions_archive(name)
        rows.extend(parse_submission_rows(archive, submissions_file=name, forms=forms))
    return tuple(rows)


def _provenance(
    *,
    cik: str,
    row: SubmissionRow,
    source: str,
    source_version: str,
    calendar_source: str,
    calendar_source_version: str,
) -> str:
    return json.dumps(
        {
            "accession": row.accession,
            "calendar_source": calendar_source,
            "calendar_source_version": calendar_source_version,
            "complete_submission": complete_submission_url(cik, row.accession),
            "source": source,
            "source_version": source_version,
            "submissions_file": row.submissions_file,
            "target_cik": cik,
        },
        sort_keys=True,
        separators=(",", ":"),
    )


def ingest_submissions(
    connection: sqlite3.Connection,
    client: EdgarClient,
    *,
    cik: object,
    source: str,
    source_version: str,
    calendar_source: str,
    calendar_source_version: str,
) -> int:
    """한 target CIK의 recent+archive filing metadata를 불변 적재한다."""
    normalized_cik = _normalize_cik(cik)
    source = _required(source, "source")
    source_version = _required(source_version, "source_version")
    calendar_source = _required(calendar_source, "calendar_source")
    calendar_source_version = _required(
        calendar_source_version, "calendar_source_version"
    )
    calendar_exists = connection.execute(
        "SELECT 1 FROM bars_daily WHERE symbol = 'SPY'"
        " AND source = ? AND source_version = ? LIMIT 1",
        (calendar_source, calendar_source_version),
    ).fetchone()
    if calendar_exists is None:
        raise QVSubmissionsError(
            "SPY calendar source/version에 거래 세션이 없습니다: "
            f"{calendar_source}/{calendar_source_version}"
        )

    payload = []
    for row in _submissions_rows(client, normalized_cik):
        header = client.complete_submission_text(normalized_cik, row.accession)
        sic = parse_filing_sic(header, normalized_cik)
        usable_session = _historical_usable_session(
            connection,
            row.acceptance_eastern_date,
            calendar_source,
            calendar_source_version,
        )
        payload.append(
            (
                normalized_cik,
                row.accession,
                row.form,
                row.filed_date,
                row.report_date,
                row.acceptance_datetime,
                row.acceptance_eastern_date,
                usable_session,
                sic.filing_sic,
                sic.status,
                row.primary_document,
                row.submissions_file,
                calendar_source,
                calendar_source_version,
                source,
                source_version,
                _provenance(
                    cik=normalized_cik,
                    row=row,
                    source=source,
                    source_version=source_version,
                    calendar_source=calendar_source,
                    calendar_source_version=calendar_source_version,
                ),
            )
        )

    try:
        with connection:
            connection.executemany(
                "INSERT INTO qv_sec_filings"
                " (cik, accession, form, filed_date, report_date,"
                "  acceptance_datetime, acceptance_eastern_date,"
                "  historical_usable_session, filing_sic,"
                "  sic_status, primary_document, submissions_file, calendar_source,"
                "  calendar_source_version, source, source_version, provenance)"
                " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                payload,
            )
    except sqlite3.IntegrityError as error:
        raise QVSubmissionsError(
            f"이 source_version에 이미 있는 QV filing입니다 ({error})."
            " 개정본은 기존 버전을 덮지 않고 새 source_version으로 적재하세요."
        ) from error
    return len(payload)


def historical_sic(
    connection: sqlite3.Connection,
    cik: object,
    formation_session: str,
    source_version: str,
) -> HistoricalSic | None:
    """formation까지 usable한 최신 filing 하나의 SIC 상태를 그대로 돌려준다."""
    normalized_cik = _normalize_cik(cik)
    formation = _normalize_date(
        formation_session, "formation_session", required=True
    )
    source_version = _required(source_version, "source_version")
    row = connection.execute(
        "SELECT cik, accession, form, acceptance_datetime,"
        " historical_usable_session, filing_sic, sic_status, source,"
        " source_version, provenance FROM qv_sec_filings"
        " WHERE cik = ? AND source_version = ?"
        " AND historical_usable_session IS NOT NULL"
        " AND historical_usable_session <= ?"
        " ORDER BY acceptance_datetime DESC, accession DESC LIMIT 1",
        (normalized_cik, source_version, formation),
    ).fetchone()
    if row is None:
        return None
    values = dict(row)
    values["status"] = values.pop("sic_status")
    return HistoricalSic(**values)
