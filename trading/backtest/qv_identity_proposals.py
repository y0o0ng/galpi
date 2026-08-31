"""Step 5A-2a/b — SEC identity **proposal / proof packet** 생성.

5A-1의 static 매핑 수요를 구조화된 SEC identity 제안과 증명 packet으로 바꾼다.
**production manifest를 바꾸지 않는다.** 자동 승격도 없다.

권한 경계를 코드와 출력에서 명시적으로 유지한다.

    DISCOVERY_HINT  !=  SEC_PROOF  !=  PRODUCTION_MANIFEST

`AUTO_PROVABLE`은 "승인된 규칙 아래 proof packet이 기계적으로 완결돼 보인다"는 뜻일
뿐이고 **manifest가 이미 바뀌었다는 뜻이 아니다.**

발견(discovery)은 넓어도 된다 — 현재 ticker map · `edgar.resolve_cik` ·
`CIK_OVERRIDES` · 이름 색인 · predecessor 힌트. 그러나 그것들은 **후보 CIK/filing만**
가리키고 production identity가 되지 못한다. 증명은 SEC 원문에서만 나온다.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

from .edgar import CIK_OVERRIDES, resolve_by_browse
from .qv_manifest import APPROVED_CLASS_AXIS_LOCALS, prose_key, qname_key
# 아카이브까지 훑는 submissions row 수집은 이미 한 곳에 있다. 여기서 복제하면
# 두 경로가 조용히 갈라지므로 그대로 쓴다.
from .qv_submissions import _submissions_rows as _submission_rows_from_sec
from .qv_xbrl import (
    candidate_xml_names,
    looks_like_instance,
    parse_filing_summary,
    parse_instance,
)
from .qv_xbrl import is_dei, normalize_cik

# ── 최종 제안 상태 — 이 셋뿐이다 ──────────────────────────────────────────────
AUTO_PROVABLE = "AUTO_PROVABLE"
REVIEW_REQUIRED = "REVIEW_REQUIRED"
UNRESOLVED = "UNRESOLVED"

# ── 발견 출처(증거 권한이 아니라 provenance다) ────────────────────────────────
CURRENT_TICKER_FILE = "CURRENT_TICKER_FILE"
BROWSE_EDGAR = "BROWSE_EDGAR"
HISTORICAL_NAME_LOOKUP = "HISTORICAL_NAME_LOOKUP"
EXISTING_CIK_OVERRIDE = "EXISTING_CIK_OVERRIDE"
PREDECESSOR_HINT = "PREDECESSOR_HINT"

DISCOVERY_ORIGINS = frozenset({
    CURRENT_TICKER_FILE, BROWSE_EDGAR, HISTORICAL_NAME_LOOKUP,
    EXISTING_CIK_OVERRIDE, PREDECESSOR_HINT,
})

# ── sibling class census ──────────────────────────────────────────────────────
CLASS_CENSUS_COMPLETE = "CLASS_CENSUS_COMPLETE"
CLASS_CENSUS_REVIEW_REQUIRED = "CLASS_CENSUS_REVIEW_REQUIRED"

# ── 사유 코드 ─────────────────────────────────────────────────────────────────
NO_DISCOVERY_CANDIDATE = "NO_DISCOVERY_CANDIDATE"
MULTIPLE_DISCOVERY_CANDIDATES = "MULTIPLE_DISCOVERY_CANDIDATES"
DISCOVERY_ONLY_NO_SEC_PROOF = "DISCOVERY_ONLY_NO_SEC_PROOF"
NO_COVER_PAGE_PROOF_DOCUMENT = "NO_COVER_PAGE_PROOF_DOCUMENT"
REGISTRANT_CIK_MISMATCH = "REGISTRANT_CIK_MISMATCH"
SYMBOL_NOT_ON_COVER_PAGE = "SYMBOL_NOT_ON_COVER_PAGE"
CLASS_TITLE_BRIDGE_NOT_EXPLICIT = "CLASS_TITLE_BRIDGE_NOT_EXPLICIT"
SIBLING_CLASS_CENSUS_UNCLEAR = "SIBLING_CLASS_CENSUS_UNCLEAR"
CLASS_INTERVAL_NOT_EXPLICIT = "CLASS_INTERVAL_NOT_EXPLICIT"
PRE_INLINE_XBRL_NO_EXPLICIT_BRIDGE = "PRE_INLINE_XBRL_NO_EXPLICIT_BRIDGE"
CIK_CONFLICT = "CIK_CONFLICT"
SYMBOL_REUSE_CONFLICT = "SYMBOL_REUSE_CONFLICT"
SUCCESSOR_JUDGEMENT_REQUIRED = "SUCCESSOR_JUDGEMENT_REQUIRED"
MECHANICALLY_COMPLETE_SEC_PROOF = "MECHANICALLY_COMPLETE_SEC_PROOF"

# cover page에서 읽는 dei concept. 이름 유사도가 아니라 정확한 local name이다.
SECURITY_12B_TITLE = "Security12bTitle"
SECURITY_12G_TITLE = "Security12gTitle"
TRADING_SYMBOL = "TradingSymbol"
ENTITY_COMMON_SHARES = "EntityCommonStockSharesOutstanding"

# 5A-1 inventory payload가 만족해야 하는 계약.
EXPECTED_STAGE = "5A-1"
EXPECTED_MEASURES = "STATIC_MAPPING_COVERAGE_DEMAND"


class QVProposalError(Exception):
    """제안/증명 계약을 벗어날 때 올린다."""


# ── 증거 · 발견 ───────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class DiscoveryCandidate:
    """후보 CIK 하나와 그것을 **어디서 봤는지**. 증거 권한이 아니다."""

    cik: str
    origin: str
    detail: str = ""

    def as_json(self) -> dict:
        return {"cik": self.cik, "origin": self.origin, "detail": self.detail}


@dataclass(frozen=True)
class EvidenceRef:
    """Step 4의 구조화 증거 자연키 모양 그대로. 지역 DB row id를 쓰지 않는다."""

    source_kind: str
    cik: str
    accession: str
    document_name: str
    evidence_role: str
    dependency: str = "REQUIRED"
    locator: str | None = None

    def as_json(self) -> dict:
        return {
            "source_kind": self.source_kind,
            "cik": self.cik,
            "accession": self.accession,
            "document_name": self.document_name,
            "evidence_role": self.evidence_role,
            "dependency": self.dependency,
            "locator": self.locator,
        }


@dataclass(frozen=True)
class CoverClass:
    """cover page의 class 축 member 하나에서 읽은 사실.

    axis/member QName을 문자열 키로만 남기지 않고 namespace까지 보존한다 —
    XBRL alias 제안이 prefix가 아니라 namespace로 서야 하기 때문이다.
    """

    member_key: str
    axis_namespace: str | None
    axis_local: str | None
    member_namespace: str | None
    member_local: str | None
    security_title: str | None
    title_concept: str | None
    trading_symbol: str | None
    has_shares_fact: bool

    @property
    def is_listed(self) -> bool:
        return bool(self.trading_symbol)

    @property
    def has_axis(self) -> bool:
        return self.member_key != NO_CLASS_AXIS

    def as_json(self) -> dict:
        return {
            "member_key": self.member_key,
            "axis_namespace": self.axis_namespace,
            "axis_local": self.axis_local,
            "member_namespace": self.member_namespace,
            "member_local": self.member_local,
            "security_title": self.security_title,
            "title_concept": self.title_concept,
            "trading_symbol": self.trading_symbol,
            "has_shares_fact": self.has_shares_fact,
        }


@dataclass(frozen=True)
class CoverPageProof:
    """한 accession의 표지에서 기계적으로 읽은 class 구조."""

    cik: str
    accession: str
    document_name: str
    classes: tuple[CoverClass, ...]
    anomalies: tuple[str, ...] = ()

    def as_json(self) -> dict:
        return {
            "cik": self.cik,
            "accession": self.accession,
            "document_name": self.document_name,
            "classes": [item.as_json() for item in self.classes],
            "anomalies": list(self.anomalies),
        }


# cover class가 무엇으로 증명됐는지. 이름 추론이 아니라 fact 존재로 정한다.
ORDINARY_COMMON_LISTED = "ORDINARY_COMMON_LISTED"
ORDINARY_COMMON_UNLISTED = "ORDINARY_COMMON_UNLISTED"
REGISTERED_NOT_PROVED_COMMON = "REGISTERED_NOT_PROVED_COMMON"
INDETERMINATE_CLASS = "INDETERMINATE_CLASS"

# class 축이 없는 dimensionless cover fact를 묶는 자리표시자.
NO_CLASS_AXIS = "__NO_CLASS_AXIS__"

DEMANDED_CLASS_NOT_PROVED_ORDINARY_COMMON = "DEMANDED_CLASS_NOT_PROVED_ORDINARY_COMMON"


def class_role(item: CoverClass) -> str:
    """cover class의 역할. **`Member` 이름 문자열로 추론하지 않는다.**

    보통주 여부는 `dei:EntityCommonStockSharesOutstanding`이 그 class member에
    실제로 실렸는지로만 정한다. 12(b) 제목과 심볼만 있는 줄은 notes·warrant일 수
    있으므로 보통주로 승격하지 않는다.
    """
    if item.has_shares_fact:
        return ORDINARY_COMMON_LISTED if item.is_listed else ORDINARY_COMMON_UNLISTED
    if item.security_title or item.trading_symbol:
        # 등록된 증권이지만 보통주로 증명되지 않았다 — 표지의 notes·warrant 줄이다.
        return REGISTERED_NOT_PROVED_COMMON
    return INDETERMINATE_CLASS


# ── cover page 증명 추출 ──────────────────────────────────────────────────────


def _class_member(context, prefix_free_axis: frozenset[str], target_cik: str):
    """`(member_key, axis, member, extra_dimension_present)`를 돌려준다.

    class 축이 정확히 0개면 dimensionless 자리표시자, 1개면 그 member다.
    **class 축 말고 다른 축이 하나라도 붙어 있으면 anomaly로 표시한다** — 조용히
    버리면 census가 비어 있는 채로 COMPLETE가 되기 때문이다.
    """
    class_dims = []
    extra = False
    for axis, member in context.dimensions:
        if not axis.resolved:
            return None, None, None, True
        axis_key = qname_key(axis.namespace, axis.local, target_cik)
        if axis.local in prefix_free_axis and not axis_key.startswith("ext:"):
            class_dims.append((axis, member))
        else:
            extra = True
    if context.typed_dimensions:
        extra = True
    if len(class_dims) > 1:
        return None, None, None, True
    if not class_dims:
        return NO_CLASS_AXIS, None, None, extra
    axis, member = class_dims[0]
    if not member.resolved:
        return None, None, None, True
    return qname_key(member.namespace, member.local, target_cik), axis, member, extra


def extract_cover_proof(
    document,
    *,
    cik: str,
    accession: str,
    document_name: str,
) -> CoverPageProof:
    """파싱된 instance의 표지에서 class 구조를 기계적으로 읽는다.

    - 등록인 CIK가 아닌 entity의 context는 제외한다(자회사 co-registrant 블록).
    - `dei` namespace의 정확한 local name만 읽는다. 이름 유사도를 쓰지 않는다.
    - 같은 class에 서로 다른 제목/심볼이 실리면 anomaly로 남긴다.
    """
    target = normalize_cik(cik)
    if target is None:
        raise QVProposalError(f"CIK가 아닙니다: {cik!r}")
    contexts = document.context_map()
    collected: dict[str, dict] = {}
    anomalies: set[str] = set()

    for fact in document.facts:
        if not is_dei(fact.concept.namespace):
            continue
        local = fact.concept.local
        if local not in (SECURITY_12B_TITLE, SECURITY_12G_TITLE, TRADING_SYMBOL, ENTITY_COMMON_SHARES):
            continue
        context = contexts.get(fact.context_id)
        if context is None:
            anomalies.add("MISSING_CONTEXT")
            continue
        context_cik = context.cik
        if context_cik is not None and context_cik != target:
            continue  # 다른 등록인(자회사 co-registrant) 블록
        member_key, axis, member, extra = _class_member(
            context, APPROVED_CLASS_AXIS_LOCALS, target
        )
        if member_key is None:
            anomalies.add("UNPARSEABLE_CLASS_DIMENSION")
            continue
        if extra:
            anomalies.add("EXTRA_DIMENSION_ON_COVER_FACT")
            continue
        slot = collected.setdefault(
            member_key,
            {
                "axis_namespace": axis.namespace if axis else None,
                "axis_local": axis.local if axis else None,
                "member_namespace": member.namespace if member else None,
                "member_local": member.local if member else None,
                "title": None,
                "title_concept": None,
                "symbol": None,
                "shares": False,
            },
        )
        if local == ENTITY_COMMON_SHARES:
            slot["shares"] = True
            continue
        value = " ".join(str(fact.raw_value or "").split())
        if not value:
            continue
        field_name = "symbol" if local == TRADING_SYMBOL else "title"
        current = slot[field_name]
        if current is None:
            slot[field_name] = value
            if field_name == "title":
                slot["title_concept"] = local
        elif prose_key(current) != prose_key(value):
            anomalies.add(f"CONFLICTING_{field_name.upper()}")

    classes = tuple(
        CoverClass(
            member_key=key,
            axis_namespace=slot["axis_namespace"],
            axis_local=slot["axis_local"],
            member_namespace=slot["member_namespace"],
            member_local=slot["member_local"],
            security_title=slot["title"],
            title_concept=slot["title_concept"],
            trading_symbol=slot["symbol"],
            has_shares_fact=slot["shares"],
        )
        for key, slot in sorted(collected.items())
    )
    return CoverPageProof(
        cik=target,
        accession=accession,
        document_name=document_name,
        classes=classes,
        anomalies=tuple(sorted(anomalies)),
    )


# ── 제안 레코드(manifest row와 같은 모양이지만 manifest가 아니다) ────────────


@dataclass(frozen=True)
class ClassInterval:
    """class 유효구간. **이 모듈은 이것을 절대 추론하지 않는다.**

    5A-2c(사람 판정)나 테스트 stub이 명시 증거와 함께 넣어줄 때만 존재한다.
    """

    effective_from: str
    effective_to: str | None
    evidence: tuple[EvidenceRef, ...]

    def as_json(self) -> dict:
        return {
            "effective_from": self.effective_from,
            "effective_to": self.effective_to,
            "evidence": [item.as_json() for item in self.evidence],
        }


@dataclass(frozen=True)
class IssuerProposal:
    issuer_id: str
    cik: str
    resolution_method: str
    provenance: str
    evidence: tuple[EvidenceRef, ...]

    def as_json(self) -> dict:
        return {
            "issuer_id": self.issuer_id,
            "cik": self.cik,
            "resolution_method": self.resolution_method,
            "provenance": self.provenance,
            "evidence": [item.as_json() for item in self.evidence],
        }


@dataclass(frozen=True)
class ShareClassProposal:
    class_id: str
    issuer_id: str
    symbol: str | None
    is_ordinary_common: bool
    is_listed: bool
    role: str
    effective_from: str | None
    effective_to: str | None
    interval_proved: bool
    provenance: str
    evidence: tuple[EvidenceRef, ...]

    def as_json(self) -> dict:
        return {
            "class_id": self.class_id,
            "issuer_id": self.issuer_id,
            "symbol": self.symbol,
            "is_ordinary_common": self.is_ordinary_common,
            "is_listed": self.is_listed,
            "role": self.role,
            "effective_from": self.effective_from,
            "effective_to": self.effective_to,
            "interval_proved": self.interval_proved,
            "provenance": self.provenance,
            "evidence": [item.as_json() for item in self.evidence],
        }


@dataclass(frozen=True)
class XbrlAliasProposal:
    class_id: str
    issuer_id: str
    axis_namespace: str
    axis_local: str
    member_namespace: str
    member_local: str
    provenance: str
    evidence: tuple[EvidenceRef, ...]

    def as_json(self) -> dict:
        return {
            "class_id": self.class_id,
            "issuer_id": self.issuer_id,
            "axis_namespace": self.axis_namespace,
            "axis_local": self.axis_local,
            "member_namespace": self.member_namespace,
            "member_local": self.member_local,
            "provenance": self.provenance,
            "evidence": [item.as_json() for item in self.evidence],
        }


@dataclass(frozen=True)
class ProseAliasProposal:
    class_id: str
    issuer_id: str
    raw_prose_name: str
    prose_key: str
    bridge_type: str
    provenance: str
    evidence: tuple[EvidenceRef, ...]

    def as_json(self) -> dict:
        return {
            "class_id": self.class_id,
            "issuer_id": self.issuer_id,
            "raw_prose_name": self.raw_prose_name,
            "prose_key": self.prose_key,
            "bridge_type": self.bridge_type,
            "provenance": self.provenance,
            "evidence": [item.as_json() for item in self.evidence],
        }


@dataclass(frozen=True)
class SymbolProposal:
    """심볼 하나에 대한 제안 packet. **manifest 상태가 아니다.**"""

    symbol: str
    demanded_formation_sessions: tuple[str, ...]
    discovery_candidates: tuple[DiscoveryCandidate, ...]
    selected_cik: str | None
    proposal_status: str
    reason_codes: tuple[str, ...]
    class_census_status: str
    proof: CoverPageProof | None
    issuer_proposal: IssuerProposal | None
    share_class_proposals: tuple[ShareClassProposal, ...]
    xbrl_alias_proposals: tuple[XbrlAliasProposal, ...]
    prose_alias_proposals: tuple[ProseAliasProposal, ...]
    conflicts: tuple[str, ...] = ()
    unresolved_questions: tuple[str, ...] = ()

    def as_json(self) -> dict:
        return {
            "symbol": self.symbol,
            "demanded_formation_sessions": list(self.demanded_formation_sessions),
            "discovery_candidates": [item.as_json() for item in self.discovery_candidates],
            "selected_cik": self.selected_cik,
            "proposal_status": self.proposal_status,
            "reason_codes": list(self.reason_codes),
            "class_census_status": self.class_census_status,
            "proof": self.proof.as_json() if self.proof else None,
            "issuer_proposal": self.issuer_proposal.as_json() if self.issuer_proposal else None,
            "share_class_proposals": [item.as_json() for item in self.share_class_proposals],
            "xbrl_alias_proposals": [item.as_json() for item in self.xbrl_alias_proposals],
            "prose_alias_proposals": [item.as_json() for item in self.prose_alias_proposals],
            "conflicts": list(self.conflicts),
            "unresolved_questions": list(self.unresolved_questions),
        }


# ── 5A-1 수요 읽기 ────────────────────────────────────────────────────────────


def load_mapping_demand(payload: dict) -> dict[str, tuple[str, ...]]:
    """5A-1 inventory 산출물에서 **static 매핑 수요**만 뽑는다.

    5A-1이 아닌 산출물, 다른 measure, stage 불일치는 fail-close다. 5A-2는 5A-1의
    수요 정의를 다시 계산하지 않고 그대로 받는다.
    """
    if not isinstance(payload, dict):
        raise QVProposalError("inventory payload가 객체가 아닙니다")
    stage = payload.get("stage")
    if stage != EXPECTED_STAGE:
        raise QVProposalError(f"5A-1 산출물이 아닙니다: stage={stage!r}")
    measures = payload.get("measures")
    if measures != EXPECTED_MEASURES:
        raise QVProposalError(f"measures 계약 불일치: {measures!r}")
    rows = payload.get("securities")
    if not isinstance(rows, list):
        raise QVProposalError("securities 목록이 없습니다")

    demand: dict[str, set[str]] = {}
    for row in rows:
        if not isinstance(row, dict):
            raise QVProposalError("securities 항목이 객체가 아닙니다")
        if row.get("status") == "MAPPED":
            continue
        symbol = str(row.get("symbol") or "").strip()
        if not symbol:
            raise QVProposalError("symbol이 비었습니다")
        session = str(row.get("formation_session") or "").strip()
        if not session:
            raise QVProposalError(f"{symbol}: formation_session이 비었습니다")
        demand.setdefault(symbol, set()).add(session)
    return {symbol: tuple(sorted(sessions)) for symbol, sessions in sorted(demand.items())}


def read_mapping_demand(path: str | Path) -> tuple[dict[str, tuple[str, ...]], str]:
    """5A-1 JSON 파일에서 (수요, identity_source_version)을 읽는다."""
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    version = str(payload.get("identity_source_version") or "").strip()
    if not version:
        raise QVProposalError("identity_source_version이 없습니다")
    return load_mapping_demand(payload), version


# ── 제안 id(기계적·결정적). 5A-2c 승격 때 사람이 다시 이름 붙인다 ────────────


def issuer_id_for(cik: str) -> str:
    return f"us-cik-{normalize_cik(cik)}"


def class_id_for(cik: str, item: CoverClass) -> str:
    base = normalize_cik(cik)
    if not item.has_axis:
        return f"prop-{base}-single"
    local = (item.member_local or "").strip() or "unknown"
    return f"prop-{base}-{local}"


# ── 판정 ──────────────────────────────────────────────────────────────────────


def _census_status(proof: CoverPageProof) -> tuple[str, tuple[str, ...]]:
    """sibling class census가 기계적으로 완결됐는가."""
    notes: list[str] = []
    if proof.anomalies:
        notes.extend(f"cover anomaly: {item}" for item in proof.anomalies)
        return CLASS_CENSUS_REVIEW_REQUIRED, tuple(notes)
    if not proof.classes:
        return CLASS_CENSUS_REVIEW_REQUIRED, ("cover page에 dei class fact가 없습니다",)
    roles = [class_role(item) for item in proof.classes]
    if not any(role in (ORDINARY_COMMON_LISTED, ORDINARY_COMMON_UNLISTED) for role in roles):
        return CLASS_CENSUS_REVIEW_REQUIRED, ("보통주로 증명된 class가 없습니다",)
    if INDETERMINATE_CLASS in roles:
        return CLASS_CENSUS_REVIEW_REQUIRED, ("역할을 정할 수 없는 class 축 member가 있습니다",)
    # notes·warrant 줄은 census를 막지 않지만 **조용히 사라지지도 않는다.**
    for item in proof.classes:
        if class_role(item) == REGISTERED_NOT_PROVED_COMMON:
            notes.append(
                "보통주로 증명되지 않은 등록 증권 줄: "
                f"{item.security_title or item.trading_symbol}"
            )
    # 축 없는 줄과 축 있는 줄이 섞이면 같은 class가 두 번 세어질 수 있다.
    if len(proof.classes) > 1 and any(not item.has_axis for item in proof.classes):
        return CLASS_CENSUS_REVIEW_REQUIRED, (
            "dimensionless cover fact와 class 축 fact가 섞여 있습니다",
        )
    return CLASS_CENSUS_COMPLETE, tuple(notes)


def _evidence_for(proof: CoverPageProof, role: str) -> tuple[EvidenceRef, ...]:
    return (
        EvidenceRef(
            source_kind="KQ_FILING",
            cik=proof.cik,
            accession=proof.accession,
            document_name=proof.document_name,
            evidence_role=role,
            dependency="REQUIRED",
        ),
    )


def _class_packets(
    proof: CoverPageProof,
    intervals: dict[str, ClassInterval] | None,
) -> tuple[
    tuple[ShareClassProposal, ...],
    tuple[XbrlAliasProposal, ...],
    tuple[ProseAliasProposal, ...],
]:
    """cover page가 실제로 증명한 것만 제안으로 만든다.

    `effective_from`/`effective_to`는 **표지가 증명하지 않는다.** `intervals`로 명시
    증거가 들어온 class만 값이 차고 나머지는 `None`으로 남는다. 추론하지 않는다.
    """
    issuer_id = issuer_id_for(proof.cik)
    classes: list[ShareClassProposal] = []
    xbrl: list[XbrlAliasProposal] = []
    prose: list[ProseAliasProposal] = []

    for item in proof.classes:
        role = class_role(item)
        if role not in (ORDINARY_COMMON_LISTED, ORDINARY_COMMON_UNLISTED):
            continue
        class_id = class_id_for(proof.cik, item)
        interval = (intervals or {}).get(item.member_key)
        evidence_role = (
            "COVER_SECURITY_12B_TITLE" if role == ORDINARY_COMMON_LISTED else "COVER_CLASS_AXIS_SHARES"
        )
        if role == ORDINARY_COMMON_LISTED and item.title_concept == SECURITY_12G_TITLE:
            evidence_role = "COVER_SECURITY_12G_TITLE"
        evidence = _evidence_for(proof, evidence_role)
        if interval is not None:
            evidence = evidence + tuple(interval.evidence)
        classes.append(
            ShareClassProposal(
                class_id=class_id,
                issuer_id=issuer_id,
                symbol=item.trading_symbol,
                is_ordinary_common=True,
                is_listed=item.is_listed,
                role=role,
                effective_from=interval.effective_from if interval else None,
                effective_to=interval.effective_to if interval else None,
                interval_proved=interval is not None,
                provenance=(
                    f"cover page {proof.document_name} — "
                    f"{item.security_title or '(제목 없음)'} / member {item.member_local or '(축 없음)'}"
                ),
                evidence=evidence,
            )
        )
        if item.has_axis and item.axis_namespace and item.member_namespace:
            xbrl.append(
                XbrlAliasProposal(
                    class_id=class_id,
                    issuer_id=issuer_id,
                    axis_namespace=item.axis_namespace,
                    axis_local=item.axis_local or "",
                    member_namespace=item.member_namespace,
                    member_local=item.member_local or "",
                    provenance=f"cover page class 축 fact ({proof.document_name})",
                    evidence=_evidence_for(proof, "COVER_CLASS_AXIS_FACT"),
                )
            )
        if item.security_title:
            prose.append(
                ProseAliasProposal(
                    class_id=class_id,
                    issuer_id=issuer_id,
                    raw_prose_name=item.security_title,
                    prose_key=prose_key(item.security_title),
                    bridge_type="SECURITY_TITLE_FACT",
                    provenance=f"cover {item.title_concept or SECURITY_12B_TITLE}",
                    evidence=_evidence_for(
                        proof,
                        "SECURITY_12G_TITLE"
                        if item.title_concept == SECURITY_12G_TITLE
                        else "SECURITY_12B_TITLE",
                    ),
                )
            )
    return tuple(classes), tuple(xbrl), tuple(prose)


def build_symbol_proposal(
    *,
    symbol: str,
    formation_sessions: tuple[str, ...] | list[str],
    candidates: tuple[DiscoveryCandidate, ...] | list[DiscoveryCandidate],
    proof: CoverPageProof | None = None,
    proof_absence_reason: str | None = None,
    intervals: dict[str, ClassInterval] | None = None,
    successor_judgement_required: bool = False,
) -> SymbolProposal:
    """심볼 하나의 제안 packet을 만든다. **manifest를 읽지도 쓰지도 않는다.**

    상태는 `AUTO_PROVABLE` · `REVIEW_REQUIRED` · `UNRESOLVED` 셋뿐이고,
    `AUTO_PROVABLE`은 "승인된 규칙 아래 SEC 증거가 기계적으로 완결됐다"는 뜻이지
    manifest가 바뀌었다는 뜻이 아니다.
    """
    clean_symbol = str(symbol or "").strip()
    if not clean_symbol:
        raise QVProposalError("symbol이 비었습니다")
    ordered_candidates = tuple(
        sorted(candidates, key=lambda item: (item.cik, item.origin, item.detail))
    )
    for item in ordered_candidates:
        if item.origin not in DISCOVERY_ORIGINS:
            raise QVProposalError(f"알 수 없는 발견 출처: {item.origin!r}")
    distinct = sorted({item.cik for item in ordered_candidates})

    reasons: list[str] = []
    conflicts: list[str] = []
    questions: list[str] = []
    blocked = False
    unresolved = False

    if not distinct:
        reasons.append(NO_DISCOVERY_CANDIDATE)
        unresolved = True
    elif len(distinct) > 1:
        reasons.append(MULTIPLE_DISCOVERY_CANDIDATES)
        reasons.append(CIK_CONFLICT)
        conflicts.append("후보 CIK가 둘 이상입니다: " + ", ".join(distinct))
        blocked = True

    selected = proof.cik if proof is not None else (distinct[0] if len(distinct) == 1 else None)

    if successor_judgement_required:
        reasons.append(SUCCESSOR_JUDGEMENT_REQUIRED)
        questions.append("발행사 승계·재편 판정이 필요합니다(기계로 정하지 않습니다)")
        blocked = True

    census = CLASS_CENSUS_REVIEW_REQUIRED
    class_proposals: tuple[ShareClassProposal, ...] = ()
    xbrl_proposals: tuple[XbrlAliasProposal, ...] = ()
    prose_proposals: tuple[ProseAliasProposal, ...] = ()
    issuer_proposal: IssuerProposal | None = None

    if proof is None:
        reasons.append(NO_COVER_PAGE_PROOF_DOCUMENT)
        if proof_absence_reason:
            questions.append(proof_absence_reason)
        if distinct:
            reasons.append(DISCOVERY_ONLY_NO_SEC_PROOF)
            blocked = True
        else:
            unresolved = True
    else:
        if distinct and proof.cik not in distinct:
            reasons.append(REGISTRANT_CIK_MISMATCH)
            conflicts.append(
                f"증명된 등록인 CIK {proof.cik}가 발견 후보({', '.join(distinct)})에 없습니다"
            )
            blocked = True

        issuer_proposal = IssuerProposal(
            issuer_id=issuer_id_for(proof.cik),
            cik=proof.cik,
            resolution_method="SEC_REGISTRANT_CIK",
            provenance=f"SEC 등록인 CIK — {proof.accession} / {proof.document_name}",
            evidence=_evidence_for(proof, "SEC_REGISTRANT_CIK_ON_FILING"),
        )

        census, notes = _census_status(proof)
        questions.extend(notes)
        if census != CLASS_CENSUS_COMPLETE:
            reasons.append(SIBLING_CLASS_CENSUS_UNCLEAR)
            blocked = True

        matched = [
            item
            for item in proof.classes
            if item.trading_symbol
            and prose_key(item.trading_symbol) == prose_key(clean_symbol)
        ]
        if not matched:
            reasons.append(SYMBOL_NOT_ON_COVER_PAGE)
            if not any(item.trading_symbol or item.security_title for item in proof.classes):
                # 2019 표지 XBRL 의무화 이전 filing의 구조적 서명이다 — 제목·심볼
                # 칸 자체가 없다. "심볼이 다른 회사 것"과 구분해서 적는다.
                reasons.append(PRE_INLINE_XBRL_NO_EXPLICIT_BRIDGE)
                questions.append(
                    "표지에 dei 제목·심볼 fact가 아예 없습니다 — 2019 표지 XBRL 의무화 "
                    "이전 filing일 수 있고, 다른 명시 증거가 필요합니다"
                )
            blocked = True
        elif len(matched) > 1:
            reasons.append(SYMBOL_REUSE_CONFLICT)
            conflicts.append(f"{clean_symbol}가 표지의 여러 class에 실려 있습니다")
            blocked = True
        else:
            target = matched[0]
            if not target.security_title:
                reasons.append(CLASS_TITLE_BRIDGE_NOT_EXPLICIT)
                blocked = True
            if not target.has_shares_fact:
                reasons.append(DEMANDED_CLASS_NOT_PROVED_ORDINARY_COMMON)
                blocked = True

        class_proposals, xbrl_proposals, prose_proposals = _class_packets(proof, intervals)
        if not class_proposals:
            reasons.append(CLASS_TITLE_BRIDGE_NOT_EXPLICIT)
            blocked = True
        elif any(not item.interval_proved for item in class_proposals):
            reasons.append(CLASS_INTERVAL_NOT_EXPLICIT)
            questions.append(
                "class 유효구간(effective_from/effective_to)은 표지가 증명하지 않습니다 — "
                "명시 증거가 필요합니다"
            )
            blocked = True

    if unresolved:
        status = UNRESOLVED
    elif blocked:
        status = REVIEW_REQUIRED
    else:
        status = AUTO_PROVABLE
        reasons.append(MECHANICALLY_COMPLETE_SEC_PROOF)

    return SymbolProposal(
        symbol=clean_symbol,
        demanded_formation_sessions=tuple(sorted(set(formation_sessions))),
        discovery_candidates=ordered_candidates,
        selected_cik=selected,
        proposal_status=status,
        reason_codes=tuple(sorted(set(reasons))),
        class_census_status=census,
        proof=proof,
        issuer_proposal=issuer_proposal,
        share_class_proposals=class_proposals,
        xbrl_alias_proposals=xbrl_proposals,
        prose_alias_proposals=prose_proposals,
        conflicts=tuple(conflicts),
        unresolved_questions=tuple(questions),
    )


# ── 5A-2b: SEC 문서 발견과 proof packet 수집(네트워크가 필요한 유일한 층) ────

# 표지 dei fact를 담는 정기보고서. 사업보고서를 먼저 본다.
COVER_FORMS = ("10-K", "10-Q")
FILING_SUMMARY_NAME = "FilingSummary.xml"
DEFAULT_MAX_PROOF_ATTEMPTS = 3

NO_FILINGS_IN_SCOPE = "요구 시점 이전에 정기보고서가 없습니다"
NO_COVER_FACTS = "표지에 dei class fact가 없습니다(inline XBRL 표지 이전일 수 있습니다)"


def discover_candidates(
    symbol: str,
    *,
    companies: dict,
    overrides: dict[str, str] | None = None,
    extra: tuple[DiscoveryCandidate, ...] | list[DiscoveryCandidate] = (),
) -> tuple[DiscoveryCandidate, ...]:
    """후보 CIK를 넓게 모은다. **이것은 증거가 아니라 어디를 볼지에 대한 힌트다.**

    현재 ticker map · `CIK_OVERRIDES` · 호출자가 따로 얻은 후보(browse-EDGAR ·
    이름 색인 · predecessor 힌트)를 합친다. 어느 것도 production identity가 되지
    못하고, 승격은 SEC 원문 증명이 선 뒤 5A-2c에서만 일어난다.
    """
    clean = str(symbol or "").strip().upper()
    if not clean:
        raise QVProposalError("symbol이 비었습니다")
    found: list[DiscoveryCandidate] = []
    table = overrides if overrides is not None else CIK_OVERRIDES
    pinned = table.get(clean)
    if pinned:
        found.append(
            DiscoveryCandidate(
                cik=str(pinned).zfill(10),
                origin=EXISTING_CIK_OVERRIDE,
                detail="edgar.CIK_OVERRIDES",
            )
        )
    company = companies.get(clean)
    if company is not None:
        found.append(
            DiscoveryCandidate(
                cik=str(company.cik).zfill(10),
                origin=CURRENT_TICKER_FILE,
                detail=str(company.name or ""),
            )
        )
    found.extend(extra)
    seen: set[tuple[str, str, str]] = set()
    unique: list[DiscoveryCandidate] = []
    for item in found:
        key = (item.cik, item.origin, item.detail)
        if key in seen:
            continue
        seen.add(key)
        unique.append(item)
    return tuple(sorted(unique, key=lambda item: (item.cik, item.origin, item.detail)))


def browse_candidate(client, symbol: str) -> DiscoveryCandidate | None:
    """browse-EDGAR 2층. 현재 등록인만 푼다(폐지 종목은 못 푼다)."""
    cik = resolve_by_browse(client, str(symbol).strip().upper())
    if not cik:
        return None
    return DiscoveryCandidate(cik=cik, origin=BROWSE_EDGAR, detail="browse-edgar company search")


def cover_filing_rows(
    client,
    cik: str,
    *,
    not_after_session: str | None = None,
    forms: tuple[str, ...] = COVER_FORMS,
) -> tuple:
    """표지 증명 후보 정기보고서. **수리 시각이 늦은 것부터** 결정적으로 정렬한다.

    `not_after_session`을 주면 그날 이후에 수리된 제출은 제외한다 — 제안이 요구
    시점보다 미래의 표지에서 만들어지지 않게 한다. 수리 시각이 같으면 accession으로
    가른다(정렬 안정성).
    """
    rows = [
        row
        for row in _submission_rows_from_sec(client, normalize_cik(cik))
        if row.form in forms and row.acceptance_eastern_date
    ]
    if not_after_session:
        rows = [row for row in rows if row.acceptance_eastern_date <= not_after_session]
    return tuple(
        sorted(rows, key=lambda row: (row.acceptance_eastern_date, row.accession), reverse=True)
    )


def _instance_from_accession(client, cik: str, accession: str):
    """accession에서 XBRL instance 문서 하나를 찾는다. 파일명 규칙을 쓰지 않는다."""
    index_payload = client.accession_index(cik, accession)
    summary = None
    try:
        raw_summary = client.accession_file_bytes(cik, accession, FILING_SUMMARY_NAME)
    except Exception:
        raw_summary = None
    if raw_summary is not None:
        summary = parse_filing_summary(raw_summary, FILING_SUMMARY_NAME)
    for name in candidate_xml_names(index_payload, summary):
        try:
            raw = client.accession_file_bytes(cik, accession, name)
        except Exception:
            continue
        if not looks_like_instance(raw, name):
            continue
        return parse_instance(raw, name), name
    return None, None


def fetch_cover_proof(
    client,
    cik: str,
    *,
    not_after_session: str | None = None,
    forms: tuple[str, ...] = COVER_FORMS,
    max_attempts: int = DEFAULT_MAX_PROOF_ATTEMPTS,
) -> tuple[CoverPageProof | None, str | None, tuple[str, ...]]:
    """표지 증명을 찾는다. `(proof, 부재사유, 시도한 accession)`을 돌려준다.

    가장 최근 정기보고서부터 최대 `max_attempts`건을 본다. 표지 class fact가 하나도
    없으면 (inline XBRL 표지 이전이거나 그 filing이 담지 않은 것이라) 증명 없음으로
    끝낸다 — **추정으로 채우지 않는다.**
    """
    target = normalize_cik(cik)
    if target is None:
        raise QVProposalError(f"CIK가 아닙니다: {cik!r}")
    rows = cover_filing_rows(client, target, not_after_session=not_after_session, forms=forms)
    if not rows:
        return None, NO_FILINGS_IN_SCOPE, ()
    attempted: list[str] = []
    for row in rows[: max(1, int(max_attempts))]:
        attempted.append(row.accession)
        document, name = _instance_from_accession(client, target, row.accession)
        if document is None:
            continue
        proof = extract_cover_proof(
            document, cik=target, accession=row.accession, document_name=name
        )
        if proof.classes:
            return proof, None, tuple(attempted)
    return None, NO_COVER_FACTS, tuple(attempted)


# ── 실행 산출물 ───────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class ProposalRun:
    """5A-2a/b 한 번의 산출물. **manifest 변경이 아니다.**"""

    identity_source_version: str
    demand_source: str
    proposals: tuple[SymbolProposal, ...]
    attempted_accessions: tuple[tuple[str, tuple[str, ...]], ...] = ()

    def counts(self) -> dict[str, int]:
        tally = {AUTO_PROVABLE: 0, REVIEW_REQUIRED: 0, UNRESOLVED: 0}
        for item in self.proposals:
            tally[item.proposal_status] += 1
        return tally

    def reason_counts(self) -> dict[str, int]:
        tally: dict[str, int] = {}
        for item in self.proposals:
            for code in item.reason_codes:
                tally[code] = tally.get(code, 0) + 1
        return dict(sorted(tally.items()))

    def as_json(self) -> dict:
        return {
            "stage": "5A-2",
            "produces": "SEC_IDENTITY_PROPOSALS",
            "mutates_production_manifest": False,
            "identity_source_version": self.identity_source_version,
            "demand_source": self.demand_source,
            "counts": self.counts(),
            "reason_counts": self.reason_counts(),
            "attempted_accessions": [
                {"symbol": symbol, "accessions": list(accessions)}
                for symbol, accessions in self.attempted_accessions
            ],
            "proposals": [item.as_json() for item in self.proposals],
        }


def run_proposals(
    client,
    demand: dict[str, tuple[str, ...]],
    *,
    companies: dict,
    identity_source_version: str,
    demand_source: str,
    overrides: dict[str, str] | None = None,
    use_browse: bool = False,
    intervals: dict[str, dict[str, ClassInterval]] | None = None,
    max_attempts: int = DEFAULT_MAX_PROOF_ATTEMPTS,
) -> ProposalRun:
    """수요 심볼마다 발견 → SEC 증명 → 제안 packet을 만든다.

    **manifest 파일을 읽지도 쓰지도 않는다.** `identity_source_version`은 어느 5A-1
    수요를 상대로 만든 제안인지 기록하기 위한 표식일 뿐이다.
    """
    proposals: list[SymbolProposal] = []
    attempts: list[tuple[str, tuple[str, ...]]] = []

    for symbol in sorted(demand):
        sessions = tuple(sorted(demand[symbol]))
        extra: list[DiscoveryCandidate] = []
        if use_browse:
            found = browse_candidate(client, symbol)
            if found is not None:
                extra.append(found)
        candidates = discover_candidates(
            symbol, companies=companies, overrides=overrides, extra=tuple(extra)
        )
        proof = None
        absence = None
        tried: tuple[str, ...] = ()
        distinct = sorted({item.cik for item in candidates})
        if len(distinct) == 1:
            proof, absence, tried = fetch_cover_proof(
                client,
                distinct[0],
                not_after_session=max(sessions) if sessions else None,
                max_attempts=max_attempts,
            )
        elif len(distinct) > 1:
            absence = "후보 CIK가 확정되지 않아 증명을 시도하지 않았습니다"
        attempts.append((symbol, tried))
        proposals.append(
            build_symbol_proposal(
                symbol=symbol,
                formation_sessions=sessions,
                candidates=candidates,
                proof=proof,
                proof_absence_reason=absence,
                intervals=(intervals or {}).get(symbol),
            )
        )

    return ProposalRun(
        identity_source_version=identity_source_version,
        demand_source=demand_source,
        proposals=tuple(proposals),
        attempted_accessions=tuple(attempts),
    )
