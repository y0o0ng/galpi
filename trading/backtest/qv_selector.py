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

from .qv_events import (
    COMPLETE,
    SHARE_BASIS_CHANGE_CONFIRMED,
    UNRESOLVED as EVENT_UNRESOLVED,
    normalized_interval,
)

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


def _scope_rows(
    connection: sqlite3.Connection,
    *,
    cik: str,
    formation_session: str,
    valuation_date: str,
    shares_source_version: str,
    identity_source_version: str,
) -> list[sqlite3.Row]:
    """적용 가능한 source scope 전부. **class_id로 먼저 거르지 않는다.**

    class 해석에 실패한 A 관측(`class_id IS NULL`)이 여기서 사라지면 tier 판정이
    A의 구조적 존재를 못 보고 B로 내려간다. 그것이 정확히 금지된 fallback이다.
    """
    lo, hi = s1_window(valuation_date)
    return connection.execute(
        "SELECT * FROM qv_share_observations"
        " WHERE cik = ? AND source_version = ? AND identity_source_version = ?"
        "   AND historical_usable_session <= ?"
        "   AND fact_instant >= ? AND fact_instant <= ?"
        " ORDER BY fact_instant DESC, acceptance_datetime DESC, accession DESC,"
        "          fact_ordinal ASC",
        (
            cik, shares_source_version, identity_source_version,
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
    """후보 filing의 basis regime과 D의 basis regime이 같은지 본다.

    후보의 share-basis anchor는 그 filing의 acceptance 체제다. 비교 구간은 두 끝점에서
    정규화한 `(low, high]`이고 **방향을 가정하지 않는다** — 후보가 결산 이후 filing이면
    `anchor > D`, 이전 filing이면 `anchor < D`다. 한쪽 방향만 보면 반대 방향의 확인된
    전환이 조용히 same-regime으로 통과한다.

    구간 **밖**의 사건은 후보와 D의 관계를 바꾸지 않는다.

        coverage != COMPLETE            -> 쓸 수 없다
        적용 가능한 UNRESOLVED 효과      -> 쓸 수 없다
        (low, high] 안 확인된 basis 변경 -> 다른 regime
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
    low, high = normalized_interval(
        anchor_row["acceptance_eastern_date"], valuation_date
    )

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
        if low < transition <= high:
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
    scope = _scope_rows(
        connection,
        cik=cik,
        formation_session=formation_session,
        valuation_date=valuation_date,
        shares_source_version=shares_source_version,
        identity_source_version=identity_source_version,
    )
    mine = [row for row in scope if row["class_id"] == class_id]

    # tier 판정은 class 해석 실패보다 **먼저** 온다.
    #   - 이 class로 풀린 A
    #   - 아직 어느 class인지 모르는 A (이 class일 수도 있다)
    # 둘 중 하나라도 있으면 A tier가 관측을 소유한다. 다른 class로 **명시적으로** 풀린
    # A는 이 class의 구조적 존재가 아니다 — 그것까지 세면 무관한 class 때문에 전부 막힌다.
    a_for_class = [row for row in mine if row["concept_tier"] == "A"]
    a_unattributable = [
        row for row in scope if row["concept_tier"] == "A" and row["class_id"] is None
    ]

    if a_for_class or a_unattributable:
        usable = [
            row for row in a_for_class if row["mapping_status"] == "RESOLVED"
        ]
        if not usable:
            # 모호하거나 이 class로 귀속되지 않는 A는 B로 내려가는 근거가 되지 않는다.
            detail = (
                "이 class의 A가 전부 모호/사용불가하다"
                if a_for_class
                else f"class를 확정하지 못한 fresh A가 {len(a_unattributable)}건 있다"
            )
            return ShareResolution(
                class_id, issuer_id, PATH_MISSING, None, None, None, None,
                REGIME_UNRESOLVED, "NOT_SEARCHED",
                f"{detail} — 하위 tier로 내려가지 않는다",
            )
        path = PATH_A
    else:
        usable = [
            row
            for row in mine
            if row["concept_tier"] == "B" and row["mapping_status"] == "RESOLVED"
        ]
        if not usable:
            return ShareResolution(
                class_id, issuer_id, PATH_MISSING, None, None, None, None,
                NO_CANDIDATE, "NOT_SEARCHED", "S1 창 안에 쓸 수 있는 후보가 없다",
            )
        path = PATH_B

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
