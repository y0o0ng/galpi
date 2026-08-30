"""P2 same-regime December share selector — CLOSED/FROZEN.

이 선택기는 "가장 최신 fact"를 고르지 않는다. **December D와 같은 share-unit
regime**에 있는 후보 중에서 고른다. 더 새로운 다른-regime 후보가 있어도 실패하지
않고, 더 오래된 same-regime 후보로 물러선다. 비율 정규화(`shares * ratio`)는 금지다.

tier 규칙이 mandatory다.

    A  us-gaap:CommonStockSharesOutstanding
    B  dei:EntityCommonStockSharesOutstanding

fresh A가 **구조적으로 존재**하면 A tier가 그 관측을 소유한다. A가 모호하거나
쓸 수 없다고 해서 B로 내려가지 않는다. A가 구조적으로 없을 때만 B를 본다.
"""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass

from .qv_events import COMPLETE, SHARE_BASIS_CHANGE_CONFIRMED, UNRESOLVED as EVENT_UNRESOLVED

PATH_A = "A"
PATH_B = "B_FALLBACK"
PATH_MISSING = "MISSING"

SAME_REGIME = "SAME_REGIME"
DIFFERENT_REGIME = "DIFFERENT_REGIME"
REGIME_UNRESOLVED = "UNRESOLVED"
NO_CANDIDATE = "NO_CANDIDATE"


class QVSelectorError(Exception):
    """선택 계약을 벗어날 때 올린다."""


@dataclass(frozen=True)
class ShareResolution:
    class_id: str
    issuer_id: str
    selector_path: str
    selected_accession: str | None
    selected_fact_ordinal: int | None
    share_value_text: str | None
    fact_instant: str | None
    regime_status: str
    search_coverage: str
    missing_reason: str | None


def s1_window(valuation_date: str) -> tuple[str, str]:
    """S1 freshness 구간. 측정연도 t-1의 1월 1일부터 December valuation session까지."""
    year = int(valuation_date[:4])
    return f"{year:04d}-01-01", valuation_date


def _candidate_rows(
    connection: sqlite3.Connection,
    *,
    class_id: str,
    formation_session: str,
    valuation_date: str,
    shares_source_version: str,
    identity_source_version: str,
) -> list[sqlite3.Row]:
    lo, hi = s1_window(valuation_date)
    return connection.execute(
        "SELECT * FROM qv_share_observations"
        " WHERE class_id = ? AND source_version = ? AND identity_source_version = ?"
        "   AND historical_usable_session <= ?"
        "   AND fact_instant >= ? AND fact_instant <= ?"
        " ORDER BY fact_instant DESC, acceptance_datetime DESC, accession DESC,"
        "          fact_ordinal ASC",
        (
            class_id, shares_source_version, identity_source_version,
            formation_session, lo, hi,
        ),
    ).fetchall()


def _regime_for_accession(
    connection: sqlite3.Connection,
    *,
    cik: str,
    accession: str,
    class_id: str,
    valuation_date: str,
    formation_session: str,
    filings_source_version: str,
    events_source_version: str,
    identity_source_version: str,
) -> tuple[str, str]:
    """후보 filing의 basis에서 D까지 같은 regime인지 본다.

    후보의 share-basis anchor는 그 filing의 acceptance 체제다. 따라서 판정 구간은
    `(D, anchor]`이고, 그 안에 확인된 basis 전환이 들어오면 그 filing의 숫자는
    D와 다른 단위다. 사건이 anchor보다 뒤면 그 filing은 여전히 D와 같은 단위다.

        coverage != COMPLETE            -> 쓸 수 없다
        적용 가능한 UNRESOLVED 효과      -> 쓸 수 없다
        구간 안 확인된 basis 변경        -> 다른 regime
        COMPLETE + 미해결/변경 없음      -> same regime
    """
    search = connection.execute(
        "SELECT coverage FROM qv_share_basis_searches"
        " WHERE cik = ? AND anchor_accession = ? AND valuation_date = ?"
        "   AND formation_session = ? AND source_version = ?",
        (cik, accession, valuation_date, formation_session, events_source_version),
    ).fetchone()
    coverage = search["coverage"] if search is not None else "NOT_SEARCHED"
    if coverage != COMPLETE:
        return REGIME_UNRESOLVED, coverage

    anchor_row = connection.execute(
        "SELECT acceptance_eastern_date FROM qv_sec_filings"
        " WHERE cik = ? AND accession = ? AND source_version = ?",
        (cik, accession, filings_source_version),
    ).fetchone()
    if anchor_row is None or anchor_row["acceptance_eastern_date"] is None:
        return REGIME_UNRESOLVED, coverage
    anchor = anchor_row["acceptance_eastern_date"]

    effects = connection.execute(
        "SELECT effect, share_side_transition_date FROM qv_share_basis_class_effects"
        " WHERE class_id = ? AND cik = ? AND source_version = ?"
        "   AND identity_source_version = ?",
        (class_id, cik, events_source_version, identity_source_version),
    ).fetchall()

    # 날짜를 붙일 수 없는 미해결 효과는 어느 구간에 속하는지 모르므로 fail-close다.
    if any(row["effect"] == EVENT_UNRESOLVED for row in effects):
        return REGIME_UNRESOLVED, coverage
    for row in effects:
        if row["effect"] != SHARE_BASIS_CHANGE_CONFIRMED:
            continue
        transition = row["share_side_transition_date"]
        if transition is None:
            return REGIME_UNRESOLVED, coverage
        if valuation_date < transition <= anchor:
            return DIFFERENT_REGIME, coverage
    return SAME_REGIME, coverage

def resolve_class_shares(
    connection: sqlite3.Connection,
    *,
    class_id: str,
    issuer_id: str,
    cik: str,
    formation_session: str,
    valuation_date: str,
    shares_source_version: str,
    events_source_version: str,
    identity_source_version: str,
    filings_source_version: str | None = None,
) -> ShareResolution:
    """한 class·formation의 December 주식수를 P2 규칙으로 고른다."""
    filings_source_version = filings_source_version or shares_source_version
    rows = _candidate_rows(
        connection,
        class_id=class_id,
        formation_session=formation_session,
        valuation_date=valuation_date,
        shares_source_version=shares_source_version,
        identity_source_version=identity_source_version,
    )
    if not rows:
        return ShareResolution(
            class_id, issuer_id, PATH_MISSING, None, None, None, None,
            NO_CANDIDATE, "NOT_SEARCHED", "S1 창 안에 PIT-usable 후보가 없다",
        )

    tier_a = [row for row in rows if row["concept_tier"] == "A"]
    if tier_a:
        # fresh A가 이 class에 구조적으로 존재한다. A tier가 관측을 소유한다.
        active_tier, pool, path = "A", tier_a, PATH_A
    else:
        active_tier, pool, path = "B", [r for r in rows if r["concept_tier"] == "B"], PATH_B
    if not pool:
        return ShareResolution(
            class_id, issuer_id, PATH_MISSING, None, None, None, None,
            NO_CANDIDATE, "NOT_SEARCHED", f"{active_tier} tier 후보가 없다",
        )

    usable = [row for row in pool if row["mapping_status"] == "RESOLVED"]
    if not usable:
        # 모호하거나 쓸 수 없는 A는 B로 내려가는 근거가 되지 않는다.
        return ShareResolution(
            class_id, issuer_id, PATH_MISSING, None, None, None, None,
            REGIME_UNRESOLVED, "NOT_SEARCHED",
            f"{active_tier} tier 후보가 전부 모호/사용불가라 하위 tier로 내려가지 않는다",
        )

    last_coverage = "NOT_SEARCHED"
    last_reason = None
    for row in usable:
        regime, coverage = _regime_for_accession(
            connection,
            cik=cik,
            accession=row["accession"],
            class_id=class_id,
            valuation_date=valuation_date,
            formation_session=formation_session,
            filings_source_version=filings_source_version,
            events_source_version=events_source_version,
            identity_source_version=identity_source_version,
        )
        last_coverage = coverage
        if regime == SAME_REGIME:
            return ShareResolution(
                class_id, issuer_id, path, row["accession"], row["fact_ordinal"],
                row["share_value_text"], row["fact_instant"], SAME_REGIME, coverage, None,
            )
        if regime == REGIME_UNRESOLVED:
            # 탐색이 닫히지 않았거나 미해결 효과가 있다. 더 오래된 후보로 물러설 수 없다.
            return ShareResolution(
                class_id, issuer_id, PATH_MISSING, None, None, None, None,
                REGIME_UNRESOLVED, coverage,
                f"{row['accession']}의 same-regime 판정이 미해결이다 (coverage={coverage})",
            )
        last_reason = (
            f"{row['accession']}은 확인된 basis 변경으로 다른 regime이다"
        )
    return ShareResolution(
        class_id, issuer_id, PATH_MISSING, None, None, None, None,
        DIFFERENT_REGIME, last_coverage,
        last_reason or "same-regime 후보가 없다",
    )


def store_resolution(
    connection: sqlite3.Connection,
    resolution: ShareResolution,
    *,
    formation_session: str,
    valuation_date: str,
    source: str,
    source_version: str,
    identity_source_version: str,
    provenance: str,
) -> None:
    with connection:
        connection.execute(
            "INSERT OR REPLACE INTO qv_class_share_resolutions"
            " (formation_session, valuation_date, class_id, issuer_id, selector_path,"
            "  selected_accession, selected_fact_ordinal, share_value_text, fact_instant,"
            "  regime_status, search_coverage, missing_reason,"
            "  source, source_version, identity_source_version, provenance)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                formation_session, valuation_date, resolution.class_id,
                resolution.issuer_id, resolution.selector_path,
                resolution.selected_accession, resolution.selected_fact_ordinal,
                resolution.share_value_text, resolution.fact_instant,
                resolution.regime_status, resolution.search_coverage,
                resolution.missing_reason, source, source_version,
                identity_source_version, provenance,
            ),
        )
