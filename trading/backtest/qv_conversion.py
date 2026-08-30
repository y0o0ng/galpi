"""법적 전환 관계와 C3 continuity — 두 개의 다른 질문이다.

    qv_class_conversion_relations    법적/경제적 고정 직접 전환 관계
    C3 continuity                    "그 관계가 December D에도 유효했는가"

법적 관계가 있어도 PIT 증거나 continuity 증명이 없으면 그 formation의 valuation은
`MISSING`이다. `effective_to`가 NULL이라는 것은 historical 증명이 아니다.
"""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation

RATIO_SEMANTICS = frozenset(
    {"EXPLICIT_INTEGER", "ONE_FOR_ONE", "SHARE_FOR_SHARE", "EQUAL_NUMBER"}
)

CONTINUITY_CONFIRMED = "CONFIRMED"
CONTINUITY_UNRESOLVED = "UNRESOLVED"
CONTINUITY_NOT_REQUIRED = "NOT_REQUIRED"

AMENDMENT_COMPLETE = "COMPLETE"
AMENDMENT_UNRESOLVED = "UNRESOLVED"
AMENDMENT_NOT_REQUIRED = "NOT_REQUIRED"

# governing snapshot만 checkpoint가 된다. periodic prose·EX-4.x·proposal은 아니다.
GOVERNING_SNAPSHOT_ROLES = frozenset(
    {
        "AMENDED_AND_RESTATED_CERTIFICATE",
        "AMENDED_AND_RESTATED_ARTICLES",
        "RESTATED_CERTIFICATE",
        "RESTATED_ARTICLES",
        "CHARTER_CLASS_DEFINITION",
    }
)


class QVConversionError(Exception):
    """전환 계약을 벗어날 때 올린다."""


@dataclass(frozen=True)
class ClauseSemantics:
    """governing instrument가 말하는 전환 조항의 의미."""

    subject_class_id: str
    reference_class_id: str
    ratio_text: str

    def key(self) -> tuple[str, str, str]:
        return (
            self.subject_class_id,
            self.reference_class_id,
            str(_decimal(self.ratio_text).normalize()),
        )


@dataclass(frozen=True)
class GoverningSnapshot:
    """current-in-effect governing instrument 하나."""

    cik: str
    accession: str
    document_name: str
    evidence_role: str
    legal_as_of: str
    acceptance_eastern_date: str
    clause: ClauseSemantics | None
    clause_status: str = "READ"       # READ | AMBIGUOUS

    @property
    def is_checkpoint(self) -> bool:
        return self.evidence_role in GOVERNING_SNAPSHOT_ROLES


@dataclass(frozen=True)
class AmendmentCandidate:
    """checkpoint 사이에서 발견된 charter amendment 후보."""

    accession: str
    document_name: str
    legal_as_of: str
    resolved: bool
    touches_conversion: bool
    reason: str


@dataclass(frozen=True)
class Continuity:
    status: str
    pre: GoverningSnapshot | None
    post: GoverningSnapshot | None
    amendment_status: str
    reason: str | None


def _decimal(text: str) -> Decimal:
    try:
        value = Decimal(str(text).strip())
    except (InvalidOperation, ValueError) as error:
        raise QVConversionError(f"비율을 Decimal로 읽을 수 없습니다: {text!r}") from error
    if value <= 0:
        raise QVConversionError(f"전환 비율은 양수여야 합니다: {text!r}")
    return value


def register_relation(
    connection: sqlite3.Connection,
    *,
    relation_id: str,
    subject_class_id: str,
    reference_class_id: str,
    issuer_id: str,
    conversion_ratio_text: str,
    ratio_semantics: str,
    effective_from: str,
    effective_to: str | None,
    usable_from_session: str,
    source: str,
    source_version: str,
    provenance: str,
) -> None:
    """고정 직접 전환 관계를 등록한다. 역산·현재비율 소급은 여기서 막는다."""
    if ratio_semantics not in RATIO_SEMANTICS:
        raise QVConversionError(f"모르는 ratio_semantics입니다: {ratio_semantics!r}")
    if subject_class_id == reference_class_id:
        raise QVConversionError("subject와 reference가 같습니다")
    _decimal(conversion_ratio_text)

    subject = connection.execute(
        "SELECT is_ordinary_common, is_listed, issuer_id FROM qv_share_classes"
        " WHERE class_id = ? AND source_version = ?",
        (subject_class_id, source_version),
    ).fetchall()
    reference = connection.execute(
        "SELECT is_ordinary_common, is_listed, issuer_id FROM qv_share_classes"
        " WHERE class_id = ? AND source_version = ?",
        (reference_class_id, source_version),
    ).fetchall()
    if not subject or not reference:
        raise QVConversionError("subject/reference class가 identity에 없습니다")
    if any(not row["is_ordinary_common"] for row in subject + reference):
        raise QVConversionError("actual ordinary common class만 전환 관계에 들어갑니다")
    if any(row["is_listed"] for row in subject):
        raise QVConversionError("상장 class는 conversion proxy의 subject가 아닙니다")
    if any(not row["is_listed"] for row in reference):
        raise QVConversionError("reference는 상장 ordinary class여야 합니다")
    if {row["issuer_id"] for row in subject + reference} != {issuer_id}:
        raise QVConversionError("subject와 reference는 같은 issuer여야 합니다")

    with connection:
        connection.execute(
            "INSERT OR REPLACE INTO qv_class_conversion_relations"
            " (relation_id, subject_class_id, reference_class_id, issuer_id,"
            "  conversion_ratio_text, ratio_semantics, effective_from, effective_to,"
            "  usable_from_session, source, source_version, provenance)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                relation_id, subject_class_id, reference_class_id, issuer_id,
                str(conversion_ratio_text).strip(), ratio_semantics,
                effective_from, effective_to, usable_from_session,
                source, source_version, provenance,
            ),
        )


def active_relation(
    connection: sqlite3.Connection,
    *,
    subject_class_id: str,
    valuation_date: str,
    formation_session: str,
    source_version: str,
) -> sqlite3.Row | None:
    """D에 법적으로 유효하고 formation에 이미 usable한 관계 하나. 둘이면 fail-close다."""
    rows = connection.execute(
        "SELECT * FROM qv_class_conversion_relations"
        " WHERE subject_class_id = ? AND source_version = ?"
        "   AND effective_from <= ? AND (effective_to IS NULL OR effective_to > ?)"
        "   AND usable_from_session <= ?",
        (subject_class_id, source_version, valuation_date, valuation_date,
         formation_session),
    ).fetchall()
    if len(rows) > 1:
        raise QVConversionError(
            f"{subject_class_id}의 전환 관계가 한 시점에 {len(rows)}개입니다"
        )
    return rows[0] if rows else None


def assess_continuity(
    snapshots: list[GoverningSnapshot],
    amendments: list[AmendmentCandidate],
    *,
    valuation_date: str,
    formation_session: str,
) -> Continuity:
    """C3 bracket. pre/post checkpoint가 **둘 다** 필요하고 조항 의미가 같아야 한다."""
    checkpoints = [item for item in snapshots if item.is_checkpoint]
    pre_pool = [item for item in checkpoints if item.legal_as_of <= valuation_date]
    post_pool = [
        item
        for item in checkpoints
        if item.legal_as_of >= valuation_date
        and item.acceptance_eastern_date <= formation_session
    ]
    if not pre_pool:
        return Continuity(
            CONTINUITY_UNRESOLVED, None, None, AMENDMENT_NOT_REQUIRED,
            "as-of <= D 인 governing snapshot(pre checkpoint)이 없다",
        )
    if not post_pool:
        return Continuity(
            CONTINUITY_UNRESOLVED, None, None, AMENDMENT_NOT_REQUIRED,
            "as-of >= D 이면서 formation 전에 usable한 post checkpoint가 없다",
        )
    pre = max(pre_pool, key=lambda item: (item.legal_as_of, item.accession))
    post = min(post_pool, key=lambda item: (item.legal_as_of, item.accession))

    if pre.clause is None or post.clause is None:
        return Continuity(
            CONTINUITY_UNRESOLVED, pre, post, AMENDMENT_NOT_REQUIRED,
            "checkpoint에서 전환 조항을 읽지 못했다",
        )
    if pre.clause_status != "READ" or post.clause_status != "READ":
        return Continuity(
            CONTINUITY_UNRESOLVED, pre, post, AMENDMENT_NOT_REQUIRED,
            "checkpoint 조항 의미가 모호하다",
        )
    if pre.clause.key() != post.clause.key():
        return Continuity(
            CONTINUITY_UNRESOLVED, pre, post, AMENDMENT_NOT_REQUIRED,
            f"전환 조항이 바뀌었다: {pre.clause.key()} -> {post.clause.key()}",
        )

    # checkpoint 사이 amendment 후보를 전수로 본다. 발견이 없다는 것 자체는 closure가 아니다.
    between = [
        item
        for item in amendments
        if pre.legal_as_of <= item.legal_as_of <= post.legal_as_of
    ]
    unresolved = [item for item in between if not item.resolved]
    if unresolved:
        return Continuity(
            CONTINUITY_UNRESOLVED, pre, post, AMENDMENT_UNRESOLVED,
            "미해결 amendment 후보가 있다: "
            + ", ".join(f"{item.accession}({item.reason})" for item in unresolved),
        )
    changed = [item for item in between if item.touches_conversion]
    if changed:
        return Continuity(
            CONTINUITY_UNRESOLVED, pre, post, AMENDMENT_UNRESOLVED,
            "구간 안 amendment가 전환 조항을 건드린다: "
            + ", ".join(item.accession for item in changed),
        )
    return Continuity(CONTINUITY_CONFIRMED, pre, post, AMENDMENT_COMPLETE, None)
