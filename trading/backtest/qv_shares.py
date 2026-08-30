"""qv_share_observations — accession 단위 **주식수 전용** 관측 원장.

범용 raw-XBRL 창고가 아니다. 정본은 raw SEC XBRL instance이고 concept은 둘뿐이다.

    A  us-gaap:CommonStockSharesOutstanding
    B  dei:EntityCommonStockSharesOutstanding

D0 dimension 계약과 accession 안 중복 fact 병합이 여기 산다. tier 선택(A가 B를
가리는 규칙)과 same-regime 선택은 `qv_selector`가 맡는다.
"""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass
from decimal import Decimal

from . import qv_identity
from .qv_manifest import (
    APPROVED_CLASS_AXIS_LOCALS,
    DERIVED_MEMBER_LOCALS,
    QVManifestError,
    is_standard_family,
    qname_key,
)
from .qv_xbrl import Context, Fact, InstanceDocument, SHARES_QNAME, is_dei, is_us_gaap

ALLOWED_FORMS = frozenset({"10-K", "10-K/A", "10-Q", "10-Q/A"})

TIER_A_LOCAL = "CommonStockSharesOutstanding"
TIER_B_LOCAL = "EntityCommonStockSharesOutstanding"

DIMENSIONLESS = "DIMENSIONLESS"
SINGLE_CLASS_AXIS = "SINGLE_CLASS_AXIS"
UNUSABLE = "UNUSABLE"

RESOLVED = "RESOLVED"
UNRESOLVED = "UNRESOLVED"
AMBIGUOUS = "AMBIGUOUS"
UNUSABLE_SHAPE = "UNUSABLE_SHAPE"

UNIQUE = "UNIQUE"
CONSOLIDATED = "CONSOLIDATED"


class QVSharesError(Exception):
    """주식수 관측 계약을 벗어날 때 올린다."""


@dataclass(frozen=True)
class ShareObservation:
    fact_ordinal: int
    concept_tier: str
    concept_namespace: str
    concept_local: str
    fact_instant: str
    share_value_text: str
    decimals: str | None
    unit_id: str | None
    context_id: str
    raw_axis_namespace: str | None
    raw_axis_local: str | None
    raw_member_namespace: str | None
    raw_member_local: str | None
    axis_key: str | None
    member_key: str | None
    dimension_shape: str
    issuer_id: str | None
    class_id: str | None
    mapping_status: str
    duplicate_status: str
    duplicate_group: str | None


# ── decimals 반올림 구간 ──────────────────────────────────────────────────────


def rounding_interval(value: Decimal, decimals: str | None) -> tuple[Decimal, Decimal]:
    """raw Decimal + `decimals`에서 CLOSED 반올림 구간을 만든다. INF는 정확값이다."""
    if decimals is None:
        # decimals가 없으면 정확도를 주장할 수 없다. 값 자체만 참이다.
        return value, value
    token = str(decimals).strip().upper()
    if token == "INF":
        return value, value
    try:
        places = int(token)
    except ValueError as error:
        raise QVSharesError(f"decimals를 읽을 수 없습니다: {decimals!r}") from error
    half = Decimal(1).scaleb(-places) / 2
    return value - half, value + half


def _precision_rank(decimals: str | None) -> tuple[int, int]:
    """정밀도 순위. 큰 것이 더 정밀하다. INF가 가장 정밀하다."""
    if decimals is None:
        return (-1, 0)
    token = str(decimals).strip().upper()
    if token == "INF":
        return (1, 0)
    try:
        return (0, int(token))
    except ValueError as error:
        raise QVSharesError(f"decimals를 읽을 수 없습니다: {decimals!r}") from error


def consolidate_duplicates(
    facts: list[tuple[int, Decimal, str | None]]
) -> tuple[int, str]:
    """같은 concept+context+unit의 중복 fact를 하나로 줄인다.

    구간이 전부 겹치면 가장 정밀한 fact로 병합하고, 아니면 AMBIGUOUS다.
    같은 최고 정밀도인데 Decimal 값이 다르면 AMBIGUOUS다.
    filing이 다르면 이 규칙을 쓰지 않는다("precision wins"를 accession 밖으로 넓히지 않는다).
    """
    if not facts:
        raise QVSharesError("중복 병합에 빈 목록을 넘겼습니다")
    if len(facts) == 1:
        return facts[0][0], UNIQUE

    intervals = [rounding_interval(value, decimals) for _, value, decimals in facts]
    if max(lo for lo, _ in intervals) > min(hi for _, hi in intervals):
        return facts[0][0], AMBIGUOUS

    ranked = sorted(facts, key=lambda item: _precision_rank(item[2]), reverse=True)
    best_rank = _precision_rank(ranked[0][2])
    best = [item for item in ranked if _precision_rank(item[2]) == best_rank]
    if len({item[1] for item in best}) != 1:
        return facts[0][0], AMBIGUOUS
    return best[0][0], CONSOLIDATED


# ── D0 dimension 계약 ─────────────────────────────────────────────────────────


def classify_shape(context: Context, extension_cik: str | None) -> tuple[str, dict]:
    """관측 fact의 dimension 모양을 D0 계약으로 가른다."""
    if context.typed_dimensions:
        return UNUSABLE, {"reason": "typed dimension은 쓸 수 없습니다"}
    if not context.dimensions:
        return DIMENSIONLESS, {}
    if len(context.dimensions) != 1:
        return UNUSABLE, {"reason": f"명시 dimension이 {len(context.dimensions)}개입니다"}
    axis, member = context.dimensions[0]
    if axis.local not in APPROVED_CLASS_AXIS_LOCALS:
        return UNUSABLE, {"reason": f"승인되지 않은 축입니다: {axis.local}"}
    try:
        axis_key = qname_key(axis.namespace, axis.local, extension_cik)
        member_key = qname_key(member.namespace, member.local, extension_cik)
    except QVManifestError as error:
        return UNUSABLE, {"reason": str(error)}
    if not is_standard_family(axis_key):
        return UNUSABLE, {"reason": f"표준 family 축이 아닙니다: {axis_key}"}
    if member.local in DERIVED_MEMBER_LOCALS:
        return UNUSABLE, {"reason": f"파생/등가 member입니다: {member.local}"}
    return SINGLE_CLASS_AXIS, {
        "axis": axis,
        "member": member,
        "axis_key": axis_key,
        "member_key": member_key,
    }


def _tier(fact: Fact) -> str | None:
    if is_us_gaap(fact.namespace) and fact.local_name == TIER_A_LOCAL:
        return "A"
    if is_dei(fact.namespace) and fact.local_name == TIER_B_LOCAL:
        return "B"
    return None


# ── 관측 추출 ─────────────────────────────────────────────────────────────────


def extract_observations(
    connection: sqlite3.Connection,
    instance: InstanceDocument,
    *,
    cik: str,
    issuer_id: str,
    identity_source_version: str,
    as_of: str,
    usable_by: str | None = None,
) -> tuple[ShareObservation, ...]:
    """instance에서 주식수 fact만 뽑아 D0·중복·alias를 적용한다.

    `as_of`는 identity 구간 판정 시점(보통 fact instant가 속한 December)이고
    `usable_by`는 lookahead 차단용 formation cutoff다.
    """
    contexts = instance.context_map()
    selected: list[tuple[int, Fact, Context, str]] = []
    for ordinal, fact in enumerate(instance.facts):
        tier = _tier(fact)
        if tier is None:
            continue
        context = contexts.get(fact.context_id)
        if context is None:
            continue
        if context.instant is None:
            continue  # instant context만 본다
        if context.cik is not None and context.cik != cik:
            continue  # 다른 registrant(자회사) fact는 버린다
        if fact.unit is not None and fact.unit.simple_measure != SHARES_QNAME:
            continue
        if fact.value is None:
            continue
        selected.append((ordinal, fact, context, tier))

    # 같은 concept+context+unit 묶음의 중복 판정
    groups: dict[tuple, list[tuple[int, Decimal, str | None]]] = {}
    for ordinal, fact, _context, _tier_name in selected:
        key = (fact.concept.namespace, fact.concept.local, fact.context_id, fact.unit_id)
        groups.setdefault(key, []).append((ordinal, fact.value, fact.decimals))
    keep: dict[int, tuple[str, str]] = {}
    for key, items in groups.items():
        chosen, status = consolidate_duplicates(items)
        group_id = f"{key[1]}|{key[2]}|{key[3] or ''}"
        for ordinal, _value, _decimals in items:
            keep[ordinal] = (
                status if ordinal == chosen else AMBIGUOUS if status == AMBIGUOUS else "DROPPED",
                group_id,
            )

    sole_class = _sole_ordinary_class(
        connection, issuer_id, as_of, identity_source_version, usable_by
    )

    out: list[ShareObservation] = []
    for ordinal, fact, context, tier in selected:
        status, group_id = keep[ordinal]
        if status == "DROPPED":
            continue
        duplicate_status = AMBIGUOUS if status == AMBIGUOUS else status
        shape, detail = classify_shape(context, cik)
        axis = detail.get("axis")
        member = detail.get("member")
        class_id: str | None = None
        # class 해석과 중복 모호성을 분리한다. A tier의 "구조적 존재"는 class 단위로
        # 판정해야 하므로, 중복이 모호해도 어느 class의 관측인지는 남긴다.
        resolution_status = UNUSABLE_SHAPE

        if shape == DIMENSIONLESS:
            # 적용 가능한 ordinary class가 정확히 하나일 때만 issuer 총계를 그 class로 본다.
            if sole_class is None:
                resolution_status = UNRESOLVED
            else:
                class_id = sole_class
                resolution_status = RESOLVED
        elif shape == SINGLE_CLASS_AXIS:
            try:
                resolved = qv_identity.resolve_member(
                    connection,
                    issuer_id,
                    detail["axis_key"],
                    detail["member_key"],
                    as_of,
                    identity_source_version,
                    usable_by=usable_by,
                )
                class_id = resolved.class_id
                resolution_status = RESOLVED
            except qv_identity.AmbiguousIdentityError:
                resolution_status = AMBIGUOUS
            except qv_identity.UnresolvedIdentityError:
                resolution_status = UNRESOLVED
        else:
            resolution_status = UNUSABLE_SHAPE

        mapping_status = AMBIGUOUS if duplicate_status == AMBIGUOUS else resolution_status

        out.append(
            ShareObservation(
                fact_ordinal=ordinal,
                concept_tier=tier,
                concept_namespace=fact.concept.namespace or "",
                concept_local=fact.concept.local,
                fact_instant=context.instant,
                share_value_text=fact.raw_value.strip(),
                decimals=fact.decimals,
                unit_id=fact.unit_id,
                context_id=fact.context_id,
                raw_axis_namespace=axis.namespace if axis else None,
                raw_axis_local=axis.local if axis else None,
                raw_member_namespace=member.namespace if member else None,
                raw_member_local=member.local if member else None,
                axis_key=detail.get("axis_key"),
                member_key=detail.get("member_key"),
                dimension_shape=shape,
                issuer_id=issuer_id if class_id is not None else None,
                class_id=class_id,
                mapping_status=mapping_status,
                duplicate_status=duplicate_status,
                duplicate_group=group_id,
            )
        )
    return tuple(out)


def _sole_ordinary_class(
    connection: sqlite3.Connection,
    issuer_id: str,
    as_of: str,
    identity_source_version: str,
    usable_by: str | None,
) -> str | None:
    """그 시점 적용 가능한 ordinary common class가 정확히 하나일 때만 class_id를 준다."""
    statement = (
        "SELECT class_id FROM qv_share_classes"
        " WHERE issuer_id = ? AND source_version = ? AND is_ordinary_common = 1"
        " AND effective_from <= ? AND (effective_to IS NULL OR effective_to > ?)"
    )
    params: list[object] = [issuer_id, identity_source_version, as_of, as_of]
    if usable_by is not None:
        statement += " AND usable_from_session <= ?"
        params.append(usable_by)
    rows = connection.execute(statement, params).fetchall()
    if len(rows) != 1:
        return None
    return rows[0]["class_id"]


def store_observations(
    connection: sqlite3.Connection,
    observations: tuple[ShareObservation, ...],
    *,
    cik: str,
    accession: str,
    form: str,
    acceptance_datetime: str,
    historical_usable_session: str,
    source_file: str,
    instance_sha256: str,
    source: str,
    source_version: str,
    identity_source_version: str,
    provenance: str,
) -> int:
    if form not in ALLOWED_FORMS:
        raise QVSharesError(f"허용되지 않은 form입니다: {form}")
    rows = [
        (
            cik, accession, item.fact_ordinal, form, acceptance_datetime,
            historical_usable_session, item.concept_tier, item.concept_namespace,
            item.concept_local, item.fact_instant, item.share_value_text,
            item.decimals, item.unit_id, item.context_id,
            item.raw_axis_namespace, item.raw_axis_local,
            item.raw_member_namespace, item.raw_member_local,
            item.axis_key, item.member_key, item.dimension_shape,
            item.issuer_id, item.class_id, item.mapping_status,
            item.duplicate_status, item.duplicate_group,
            source_file, instance_sha256, source, source_version,
            identity_source_version, provenance,
        )
        for item in observations
    ]
    with connection:
        connection.executemany(
            "INSERT OR REPLACE INTO qv_share_observations"
            " (cik, accession, fact_ordinal, form, acceptance_datetime,"
            "  historical_usable_session, concept_tier, concept_namespace, concept_local,"
            "  fact_instant, share_value_text, decimals, unit_id, context_id,"
            "  raw_axis_namespace, raw_axis_local, raw_member_namespace, raw_member_local,"
            "  axis_key, member_key, dimension_shape, issuer_id, class_id, mapping_status,"
            "  duplicate_status, duplicate_group, source_file, instance_sha256,"
            "  source, source_version, identity_source_version, provenance)"
            " VALUES (" + ", ".join("?" * 32) + ")",
            rows,
        )
    return len(rows)
