"""qv_sec_evidence_documents — K/Q 밖 SEC 증거 문서의 좁은 원장.

`qv_sec_filings`는 K/Q 계열 filing 원장 그대로 두고 넓히지 않는다. 이 표는
CLOSED된 QV 증거·탐색 사슬이 **실제로 도달하는** 문서만 담는다(8-K, proxy,
charter/EX-3.x 등). 모든 SEC 문서를 창고에 쌓지 않고 본문/HTML도 넣지 않는다.

PIT 규칙은 `qv_sec_filings`와 같다 — SEC/Eastern acceptance 날짜 **다음** 첫 정규
SPY 세션이다.
"""

from __future__ import annotations

import sqlite3

from .qv_submissions import (
    QVSubmissionsError,
    _acceptance_eastern_date,
    _historical_usable_session,
    normalize_acceptance_datetime,
)
from .qv_xbrl import normalize_cik, sha256

DOCUMENT_ROLES = frozenset({"PRIMARY", "EXHIBIT"})

# qv_sec_filings가 이미 정본인 form은 여기 중복 저장하지 않는다.
KQ_FORMS = frozenset({"10-K", "10-K/A", "10-Q", "10-Q/A"})


class QVEvidenceError(Exception):
    """증거 문서 원장 계약을 벗어날 때 올린다."""


def register_evidence_document(
    connection: sqlite3.Connection,
    *,
    cik: str,
    accession: str,
    document_name: str,
    form: str,
    document_role: str,
    acceptance_datetime: str,
    source_url: str,
    document_bytes: bytes | None = None,
    document_sha256: str | None = None,
    calendar_source: str,
    calendar_source_version: str,
    source: str,
    source_version: str,
    provenance: str,
) -> dict:
    """SEC 증거 문서 하나를 등록한다. K/Q form은 거부한다."""
    clean_cik = normalize_cik(cik)
    if clean_cik is None:
        raise QVEvidenceError(f"CIK가 아닙니다: {cik!r}")
    accession = str(accession).strip()
    document_name = str(document_name).strip()
    form = str(form).strip()
    if not accession or not document_name or not form:
        raise QVEvidenceError("accession·document_name·form은 비울 수 없습니다")
    if form in KQ_FORMS:
        raise QVEvidenceError(
            f"K/Q 계열은 qv_sec_filings가 정본이라 여기 중복 저장하지 않습니다: {form}"
        )
    if document_role not in DOCUMENT_ROLES:
        raise QVEvidenceError(f"모르는 document_role입니다: {document_role!r}")

    if document_sha256 is None:
        if document_bytes is None:
            raise QVEvidenceError("document_bytes나 document_sha256 중 하나가 필요합니다")
        document_sha256 = sha256(document_bytes)
    document_sha256 = str(document_sha256).strip().lower()
    if len(document_sha256) != 64:
        raise QVEvidenceError("document_sha256이 64자가 아닙니다")

    try:
        normalized_acceptance = normalize_acceptance_datetime(acceptance_datetime)
    except QVSubmissionsError as error:
        raise QVEvidenceError(str(error)) from error
    if normalized_acceptance is None:
        raise QVEvidenceError("acceptance_datetime이 필요합니다")
    eastern = _acceptance_eastern_date(normalized_acceptance)
    usable = _historical_usable_session(
        connection, eastern, calendar_source, calendar_source_version
    )
    if usable is None:
        raise QVEvidenceError(
            "acceptance 이후 첫 정규 세션을 달력에서 찾지 못했습니다: "
            f"{eastern} ({calendar_source}/{calendar_source_version})"
        )

    row = (
        clean_cik, accession, document_name, form, document_role,
        normalized_acceptance, eastern, usable, str(source_url).strip(),
        document_sha256, calendar_source, calendar_source_version,
        source, source_version, provenance,
    )
    with connection:
        connection.execute(
            "INSERT OR REPLACE INTO qv_sec_evidence_documents"
            " (cik, accession, document_name, form, document_role,"
            "  acceptance_datetime, acceptance_eastern_date, historical_usable_session,"
            "  source_url, document_sha256, calendar_source, calendar_source_version,"
            "  source, source_version, provenance)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            row,
        )
    return {
        "cik": clean_cik,
        "accession": accession,
        "document_name": document_name,
        "acceptance_datetime": normalized_acceptance,
        "acceptance_eastern_date": eastern,
        "historical_usable_session": usable,
        "document_sha256": document_sha256,
    }
