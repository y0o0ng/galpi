"""Step 5A-2a/b — SEC identity **proposal / proof packet** 생성.

5A-1의 static 매핑 수요를 구조화된 SEC identity 제안과 증명 packet으로 바꾼다.
**production manifest를 바꾸지 않는다.** 자동 승격도 없다.

권한 경계를 코드와 출력에서 명시적으로 유지한다.

    DISCOVERY_HINT  !=  SEC_PROOF  !=  PRODUCTION_MANIFEST

`AUTO_PROVABLE`은 "승인된 규칙 아래 proof packet이 기계적으로 완결됐다"는 뜻일 뿐이고
**manifest가 이미 바뀌었다는 뜻이 아니다.** 승격은 5A-2c가 하고, 거기서
`AUTO_PROVABLE`은 결정론적 재검증을 통과하면 사람의 의미 승인 없이 승격될 수 있다.
**이 모듈은 그 경계 바깥이다.**

발견(discovery)은 넓어도 된다 — 현재 ticker map · `CIK_OVERRIDES` · browse-EDGAR ·
구간 이름 색인(`edgar.resolve_by_name`) · 선행 등록인(`edgar.find_predecessor`).
그러나 그것들은 **후보 CIK/filing만** 가리키고 production identity가 되지 못한다.
증명은 SEC 원문에서만 나온다.

**나중 문서가 더 오래된 상태를 증명할 수 있다.** Step 4의 CLOSED 계약대로, SEC 문서의
수리 시각이 요구 formation보다 늦다는 이유로 그 문서를 static 증거에서 제외하지 않는다.
그 증거를 과거 formation에서 실제로 쓸 수 있었는지는 5A-3이 REQUIRED 증거에서
`usable_from_session`을 파생시켜 가른다 — **여기서 두 번째 look-ahead 규칙을 만들지
않고, `usable_from_session`을 지어내지도 않는다.**

**universe/bar 심볼은 SEC 경제적 심볼이 아니다.** 작업 항목은 둘을 끝까지 들고 다니고,
**모든 SEC 발견·증명은 `identity_symbol`로 한다.**

```text
member_symbol    TFCFA        universe_membership에 저장된 시장 데이터 계열
identity_symbol  FOXA         company_tickers · browse · 구간 이름 색인 ·
                              표지 TradingSymbol 대조가 쓰는 실제 거래 심볼
```

`TFCFA`를 과거 거래소 티커인 것처럼 SEC에서 찾지 않는다. 반대로 identity 심볼 하나로
모든 줄을 뭉개지도 않는다 — 같은 티커를 서로 다른 발행사가 겹치지 않는 기간에 쓸 수
있고, 그 episode를 가르는 것이 데이터 계열 심볼이다.

**표지 증명 탐색은 요구 심볼을 알고 들어간다.** 같은 등록인이 티커를 바꾼 경우
target-blind로 훑으면 최신 표지(새 심볼)에서 멈춘 뒤 대조에서 떨어지고, 옛 심볼을
명시로 증명하는 더 오래된 표지는 읽히지도 않는다. 그래서 정확한 심볼이 표지에 나올
때까지 제출 이력을 결정론적으로 계속 본다 — **임의의 시도 상한이 없다.**
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

from .edgar import CIK_OVERRIDES, find_predecessor, resolve_by_browse, resolve_by_name
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
# alias 유효성은 class 수명과 **다른 PIT 관계**다. class가 X부터 존재한다는 것이 특정
# XBRL QName이나 prose 철자가 X부터 그 class를 가리켰다는 증명이 아니다.
XBRL_ALIAS_INTERVAL_NOT_EXPLICIT = "XBRL_ALIAS_INTERVAL_NOT_EXPLICIT"
PROSE_ALIAS_INTERVAL_NOT_EXPLICIT = "PROSE_ALIAS_INTERVAL_NOT_EXPLICIT"
# 모든 보통주 economic class는 canonical class bridge를 하나는 가져야 한다.
CANONICAL_CLASS_BRIDGE_NOT_EXPLICIT = "CANONICAL_CLASS_BRIDGE_NOT_EXPLICIT"
PRE_INLINE_XBRL_NO_EXPLICIT_BRIDGE = "PRE_INLINE_XBRL_NO_EXPLICIT_BRIDGE"
CIK_CONFLICT = "CIK_CONFLICT"
SYMBOL_REUSE_CONFLICT = "SYMBOL_REUSE_CONFLICT"
SUCCESSOR_JUDGEMENT_REQUIRED = "SUCCESSOR_JUDGEMENT_REQUIRED"
REUSED_SERIES_ONLY_CURRENT_TICKER_CANDIDATE = "REUSED_SERIES_ONLY_CURRENT_TICKER_CANDIDATE"
MECHANICALLY_COMPLETE_SEC_PROOF = "MECHANICALLY_COMPLETE_SEC_PROOF"

# 옛 episode의 등록인을 실제로 가리킬 수 있는 발견 출처. 나머지는 전부 **지금** 그
# 티커를 들고 있는 쪽을 가리킨다.
HISTORICAL_ORIGINS = frozenset({HISTORICAL_NAME_LOOKUP, PREDECESSOR_HINT})

# prose bridge 종류. Step 4 §1.6이 정본이고 canonical은 **둘뿐**이다.
SECURITY_TITLE_FACT = "SECURITY_TITLE_FACT"
GOVERNING_INSTRUMENT = "GOVERNING_INSTRUMENT"
COVER_GROUP_LABEL = "COVER_GROUP_LABEL"

PROSE_BRIDGE_TYPES = frozenset({
    SECURITY_TITLE_FACT, GOVERNING_INSTRUMENT, COVER_GROUP_LABEL,
})
# **`COVER_GROUP_LABEL`은 corroborating 전용이다.** 단독으로 class 정체성을 세우지
# 못하고 production class-ID seed도 되지 못한다.
CANONICAL_PROSE_BRIDGES = frozenset({SECURITY_TITLE_FACT, GOVERNING_INSTRUMENT})

# cover page에서 읽는 dei concept. 이름 유사도가 아니라 정확한 local name이다.
SECURITY_12B_TITLE = "Security12bTitle"
SECURITY_12G_TITLE = "Security12gTitle"
TRADING_SYMBOL = "TradingSymbol"
ENTITY_COMMON_SHARES = "EntityCommonStockSharesOutstanding"

# 5A-1 inventory payload가 만족해야 하는 계약.
EXPECTED_STAGE = "5A-1"
EXPECTED_MEASURES = "STATIC_MAPPING_COVERAGE_DEMAND"

# 재사용 벤더 계열 다리의 고정 어휘. 5A-1이 준 값만 받는다.
DIRECT = "DIRECT"
REUSED_VENDOR_SERIES = "REUSED_VENDOR_SERIES"
BRIDGE_KINDS = frozenset({DIRECT, REUSED_VENDOR_SERIES})


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


def cover_classes_for_symbol(
    proof: "CoverPageProof", symbol: str
) -> tuple[CoverClass, ...]:
    """표지에서 **정확히 그 거래 심볼을 든** class들.

    `build_symbol_proposal`의 대조와 `fetch_cover_proof`의 탐색이 **같은 함수**를 쓴다.
    둘이 갈리면 "증명으로 고른 표지"와 "증명으로 인정하는 표지"가 달라진다.

    정규화는 manifest prose 계약의 `prose_key`(NFKC + 공백 정규화 + casefold) 하나뿐이다.
    **fuzzy ticker 매칭이 없다** — 접미사·부분 일치·유사도를 쓰지 않는다.
    """
    key = prose_key(str(symbol or "").strip())
    return tuple(
        item
        for item in proof.classes
        if item.trading_symbol and prose_key(item.trading_symbol) == key
    )


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
class RelationInterval:
    """관계 하나의 유효구간. **이 모듈은 이것을 절대 추론하지 않는다.**

    명시 증거와 함께 들어올 때만 존재한다. **세 관계의 구간은 서로 다른 사실이다.**

    ```text
    economic class 수명  !=  XBRL alias 수명  !=  prose alias 수명
    ```

    class가 X부터 존재한다는 것은 특정 XBRL QName이나 prose 철자가 X부터 그 class를
    가리켰다는 증명이 **아니다.** class 구간을 alias 구간으로 복사하지 않는다.
    최초/최종 관측 filing을 alias 수명으로 쓰지 않고, 수리 시각을 경제적 유효성으로
    바꾸지도 않는다.
    """

    effective_from: str
    effective_to: str | None
    evidence: tuple[EvidenceRef, ...]

    def covers(self, session: str) -> bool:
        """그 시점에 이 관계가 유효한가. 반개구간 `[from, to)`다."""
        return self.effective_from <= session and (
            self.effective_to is None or session < self.effective_to
        )

    def as_json(self) -> dict:
        return {
            "effective_from": self.effective_from,
            "effective_to": self.effective_to,
            "evidence": [item.as_json() for item in self.evidence],
        }


@dataclass(frozen=True)
class ProseBridgeInput:
    """명시 prose bridge 하나 — 이름 · 종류 · **자기 구간** · 자기 증거.

    표지 제목 말고 다른 canonical bridge(governing instrument의 명시 class 정의)를
    넣는 통로다. 종류가 `COVER_GROUP_LABEL`이면 corroborating으로만 남는다.
    """

    raw_prose_name: str
    bridge_type: str
    interval: RelationInterval


@dataclass(frozen=True)
class ClassEvidence:
    """cover class 하나에 대한 **명시** 구간·bridge 증거.

    네 칸이 전부 독립이다. 하나를 채웠다고 나머지가 채워지지 않는다.
    """

    class_interval: RelationInterval | None = None
    xbrl_interval: RelationInterval | None = None
    cover_title_interval: RelationInterval | None = None
    extra_prose_bridges: tuple[ProseBridgeInput, ...] = ()


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
    """XBRL alias 관계 하나. **자기 구간을 스스로 들고 다닌다.**

    표지가 증명하는 것은 "이 filing 시점에 이 member가 이 class를 가리킨다"이지
    "언제부터 언제까지"가 아니다. class 구간을 여기로 복사하지 않는다.
    """

    class_id: str
    issuer_id: str
    axis_namespace: str
    axis_local: str
    member_namespace: str
    member_local: str
    effective_from: str | None
    effective_to: str | None
    interval_proved: bool
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
            "effective_from": self.effective_from,
            "effective_to": self.effective_to,
            "interval_proved": self.interval_proved,
            "provenance": self.provenance,
            "evidence": [item.as_json() for item in self.evidence],
        }


@dataclass(frozen=True)
class ProseAliasProposal:
    """prose alias 관계 하나. **자기 구간을 스스로 들고 다닌다.**

    `bridge_type`이 canonical(`SECURITY_TITLE_FACT` · `GOVERNING_INSTRUMENT`)인지
    corroborating(`COVER_GROUP_LABEL`)인지가 class 정체성 자격을 가른다.
    """

    class_id: str
    issuer_id: str
    raw_prose_name: str
    prose_key: str
    bridge_type: str
    effective_from: str | None
    effective_to: str | None
    interval_proved: bool
    provenance: str
    evidence: tuple[EvidenceRef, ...]

    @property
    def is_canonical(self) -> bool:
        return self.bridge_type in CANONICAL_PROSE_BRIDGES

    def as_json(self) -> dict:
        return {
            "class_id": self.class_id,
            "issuer_id": self.issuer_id,
            "raw_prose_name": self.raw_prose_name,
            "prose_key": self.prose_key,
            "bridge_type": self.bridge_type,
            "effective_from": self.effective_from,
            "effective_to": self.effective_to,
            "interval_proved": self.interval_proved,
            "provenance": self.provenance,
            "evidence": [item.as_json() for item in self.evidence],
        }


@dataclass(frozen=True)
class SymbolProposal:
    """작업 항목 하나에 대한 제안 packet. **manifest 상태가 아니다.**

    `member_symbol`과 `identity_symbol`을 둘 다 남긴다 — 어느 시장 데이터 계열의 수요를
    어느 경제적 심볼로 증명했는지가 packet만 보고도 되짚어져야 한다.
    """

    member_symbol: str
    identity_symbol: str
    symbol_bridge_kind: str
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
            "member_symbol": self.member_symbol,
            "identity_symbol": self.identity_symbol,
            "symbol_bridge_kind": self.symbol_bridge_kind,
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

# 5A-1 산출물이 반드시 들고 있어야 하는 semantic source 정체성. 하나라도 비면
# fail-close다 — **버전을 추측하지 않고, 없는 값을 지금 DB에서 캐다 채우지도 않는다.**
REQUIRED_PROVENANCE_FIELDS = (
    "index_name",
    "universe_source",
    "universe_source_version",
    "calendar_source",
    "calendar_source_version",
    "identity_source_version",
    # universe/market-data 심볼 provenance. **SEC identity bundle의 일부가 아니다.**
    # 빠지면 어느 재사용 매핑을 거쳐 만든 수요인지 알 수 없으므로 fail-close다.
    "reused_series_source",
    "reused_series_source_version",
)


@dataclass(frozen=True)
class WorkItem:
    """5A-2 작업 단위 하나 — **데이터 계열 + 경제적 심볼 + 요구 formation.**

    identity 심볼 하나로 모든 줄을 뭉개면 같은 티커의 서로 다른 발행사·기간이 하나의
    `selected_cik`로 밀려 들어간다. 반대로 데이터 계열 심볼로 SEC를 찾으면 벤더 코드를
    과거 거래소 티커로 착각한다. **둘 다 들고 다니고 SEC에는 `identity_symbol`만 쓴다.**
    """

    member_symbol: str
    identity_symbol: str
    symbol_bridge_kind: str
    formation_sessions: tuple[str, ...]

    @property
    def key(self) -> tuple[str, str]:
        return (self.member_symbol, self.identity_symbol)

    @property
    def label(self) -> str:
        """사람이 읽는 이름. 다리를 거친 항목만 두 심볼을 함께 보인다."""
        if self.symbol_bridge_kind == DIRECT:
            return self.identity_symbol
        return f"{self.member_symbol}->{self.identity_symbol}"

    def as_json(self) -> dict:
        return {
            "member_symbol": self.member_symbol,
            "identity_symbol": self.identity_symbol,
            "symbol_bridge_kind": self.symbol_bridge_kind,
            "demanded_formation_sessions": list(self.formation_sessions),
        }


@dataclass(frozen=True)
class DemandInput:
    """5A-1이 만든 static 매핑 수요와 **그것을 만든 source 정체성 전부.**

    `inventory_path`는 부가 provenance일 뿐이고 semantic source/version 필드를
    대신하지 못한다.
    """

    index_name: str
    universe_source: str
    universe_source_version: str
    calendar_source: str
    calendar_source_version: str
    identity_source_version: str
    reused_series_source: str
    reused_series_source_version: str
    demand: dict[tuple[str, str], WorkItem]
    inventory_path: str | None = None

    @property
    def work_items(self) -> tuple[WorkItem, ...]:
        return tuple(self.demand[key] for key in sorted(self.demand))

    def select(self, symbols) -> "DemandInput":
        """일부 작업 항목만 고른다. **provenance는 그대로 따라간다.**

        토큰 하나는 `MEMBER/IDENTITY` 쌍이거나 심볼 하나다. 심볼 하나는 데이터 계열
        심볼과 경제적 심볼 **양쪽**에 맞춰본다 — `FOXA`라고 적으면 옛 `TFCFA` episode와
        새 `FOXA` episode가 둘 다 걸린다. 어느 것에도 안 걸리면 멈춘다.
        """
        picked: dict[tuple[str, str], WorkItem] = {}
        missing: list[str] = []
        for raw in symbols:
            token = str(raw).strip().upper()
            if not token:
                continue
            if "/" in token:
                member, _, identity = token.partition("/")
                found = [
                    item for item in self.demand.values()
                    if item.member_symbol == member and item.identity_symbol == identity
                ]
            else:
                found = [
                    item for item in self.demand.values()
                    if token in (item.member_symbol, item.identity_symbol)
                ]
            if not found:
                missing.append(token)
                continue
            for item in found:
                picked[item.key] = item
        if missing:
            raise QVProposalError(
                "5A-1 수요에 없는 심볼입니다: " + ", ".join(sorted(missing))
            )
        return DemandInput(
            index_name=self.index_name,
            universe_source=self.universe_source,
            universe_source_version=self.universe_source_version,
            calendar_source=self.calendar_source,
            calendar_source_version=self.calendar_source_version,
            identity_source_version=self.identity_source_version,
            reused_series_source=self.reused_series_source,
            reused_series_source_version=self.reused_series_source_version,
            demand=picked,
            inventory_path=self.inventory_path,
        )

    def provenance_json(self) -> dict:
        return {
            "stage_source": EXPECTED_STAGE,
            "measures": EXPECTED_MEASURES,
            "index_name": self.index_name,
            "universe_source": self.universe_source,
            "universe_source_version": self.universe_source_version,
            "calendar_source": self.calendar_source,
            "calendar_source_version": self.calendar_source_version,
            "identity_source_version": self.identity_source_version,
            "reused_series_source": self.reused_series_source,
            "reused_series_source_version": self.reused_series_source_version,
            "inventory_path": self.inventory_path,
        }


def load_mapping_demand(payload: dict, *, inventory_path: str | None = None) -> DemandInput:
    """5A-1 inventory 산출물에서 **static 매핑 수요와 source 정체성**을 읽는다.

    5A-1이 아닌 산출물, 다른 measure, 빠진 source/version은 전부 fail-close다.
    5A-2는 5A-1의 수요 정의를 다시 계산하지 않고 그대로 받는다.
    """
    if not isinstance(payload, dict):
        raise QVProposalError("inventory payload가 객체가 아닙니다")
    stage = payload.get("stage")
    if stage != EXPECTED_STAGE:
        raise QVProposalError(f"5A-1 산출물이 아닙니다: stage={stage!r}")
    measures = payload.get("measures")
    if measures != EXPECTED_MEASURES:
        raise QVProposalError(f"measures 계약 불일치: {measures!r}")

    provenance: dict[str, str] = {}
    for field_name in REQUIRED_PROVENANCE_FIELDS:
        value = str(payload.get(field_name) or "").strip()
        if not value:
            raise QVProposalError(
                f"5A-1 provenance가 비었습니다: {field_name}"
                " — 버전을 추측하지 않고 멈춥니다"
            )
        provenance[field_name] = value

    rows = payload.get("securities")
    if not isinstance(rows, list):
        raise QVProposalError("securities 목록이 없습니다")

    # 작업 단위는 `(데이터 계열, 경제적 심볼)`이다. 경제적 심볼 하나로 뭉개지 않는다.
    collected: dict[tuple[str, str], tuple[str, set[str]]] = {}
    for row in rows:
        if not isinstance(row, dict):
            raise QVProposalError("securities 항목이 객체가 아닙니다")
        if row.get("status") == "MAPPED":
            continue
        member = str(row.get("member_symbol") or "").strip().upper()
        identity = str(row.get("identity_symbol") or "").strip().upper()
        if not member or not identity:
            raise QVProposalError(
                "securities 행에 member_symbol/identity_symbol이 없습니다 — "
                "이 구분이 생기기 전의 5A-1 산출물입니다. "
                "벤더 계열 심볼을 SEC 심볼로 취급하지 않기 위해 멈춥니다"
            )
        kind = str(row.get("symbol_bridge_kind") or "").strip().upper()
        if kind not in BRIDGE_KINDS:
            raise QVProposalError(
                f"{member}: 알 수 없는 symbol_bridge_kind입니다 — {kind!r}"
            )
        if kind == DIRECT and member != identity:
            raise QVProposalError(
                f"{member}: DIRECT인데 identity_symbol이 다릅니다 — {identity}"
            )
        session = str(row.get("formation_session") or "").strip()
        if not session:
            raise QVProposalError(f"{member}: formation_session이 비었습니다")
        key = (member, identity)
        existing = collected.get(key)
        if existing is None:
            collected[key] = (kind, {session})
            continue
        if existing[0] != kind:
            raise QVProposalError(
                f"{member}/{identity}: symbol_bridge_kind가 행마다 다릅니다"
            )
        existing[1].add(session)

    return DemandInput(
        demand={
            key: WorkItem(
                member_symbol=key[0],
                identity_symbol=key[1],
                symbol_bridge_kind=kind,
                formation_sessions=tuple(sorted(sessions)),
            )
            for key, (kind, sessions) in sorted(collected.items())
        },
        inventory_path=inventory_path,
        **provenance,
    )


def read_mapping_demand(path: str | Path) -> DemandInput:
    """5A-1 JSON 파일을 읽는다. 빠진 provenance는 fail-close다."""
    clean = str(path)
    payload = json.loads(Path(clean).read_text(encoding="utf-8"))
    return load_mapping_demand(payload, inventory_path=clean)


# ── 제안 id — **packet 안에서만 쓰는 임시 참조다** ───────────────────────────
#
# production `class_id`가 아니다. 승격은 5A-2c가 하고, 그때 새 economic class는
# 불투명 결정적 키 `qv-class-id-v1`을 받는다(설계 문서 참조). `prop-<CIK>-<member>`는
# **production foreign key로 새어 나가면 안 된다** — XBRL member 이름에서 왔기 때문에
# alias를 정체성으로 만드는 셈이 된다.


def issuer_id_for(cik: str) -> str:
    return f"us-cik-{normalize_cik(cik)}"


def class_id_for(cik: str, item: CoverClass) -> str:
    """packet-local 제안 id. **production class_id가 아니다.**"""
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
    class_evidence: dict[str, ClassEvidence] | None,
) -> tuple[
    tuple[ShareClassProposal, ...],
    tuple[XbrlAliasProposal, ...],
    tuple[ProseAliasProposal, ...],
]:
    """cover page가 실제로 증명한 것만 제안으로 만든다.

    **세 관계의 구간을 따로 받는다.** 표지는 셋 중 어느 것의 유효구간도 증명하지
    않는다. `class_evidence`로 명시 증거가 들어온 관계만 값이 차고 나머지는 `None`으로
    남는다. **class 구간을 alias 구간으로 복사하지 않는다.**
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
        supplied = (class_evidence or {}).get(item.member_key) or ClassEvidence()

        class_interval = supplied.class_interval
        evidence_role = (
            "COVER_SECURITY_12B_TITLE" if role == ORDINARY_COMMON_LISTED
            else "COVER_CLASS_AXIS_SHARES"
        )
        if role == ORDINARY_COMMON_LISTED and item.title_concept == SECURITY_12G_TITLE:
            evidence_role = "COVER_SECURITY_12G_TITLE"
        evidence = _evidence_for(proof, evidence_role)
        if class_interval is not None:
            evidence = evidence + tuple(class_interval.evidence)
        classes.append(
            ShareClassProposal(
                class_id=class_id,
                issuer_id=issuer_id,
                symbol=item.trading_symbol,
                is_ordinary_common=True,
                is_listed=item.is_listed,
                role=role,
                effective_from=class_interval.effective_from if class_interval else None,
                effective_to=class_interval.effective_to if class_interval else None,
                interval_proved=class_interval is not None,
                provenance=(
                    f"cover page {proof.document_name} — "
                    f"{item.security_title or '(제목 없음)'} / member {item.member_local or '(축 없음)'}"
                ),
                evidence=evidence,
            )
        )

        if item.has_axis and item.axis_namespace and item.member_namespace:
            alias_interval = supplied.xbrl_interval
            alias_evidence = _evidence_for(proof, "COVER_CLASS_AXIS_FACT")
            if alias_interval is not None:
                alias_evidence = alias_evidence + tuple(alias_interval.evidence)
            xbrl.append(
                XbrlAliasProposal(
                    class_id=class_id,
                    issuer_id=issuer_id,
                    axis_namespace=item.axis_namespace,
                    axis_local=item.axis_local or "",
                    member_namespace=item.member_namespace,
                    member_local=item.member_local or "",
                    effective_from=(
                        alias_interval.effective_from if alias_interval else None
                    ),
                    effective_to=alias_interval.effective_to if alias_interval else None,
                    interval_proved=alias_interval is not None,
                    provenance=f"cover page class 축 fact ({proof.document_name})",
                    evidence=alias_evidence,
                )
            )

        if item.security_title:
            title_interval = supplied.cover_title_interval
            title_evidence = _evidence_for(
                proof,
                "SECURITY_12G_TITLE"
                if item.title_concept == SECURITY_12G_TITLE
                else "SECURITY_12B_TITLE",
            )
            if title_interval is not None:
                title_evidence = title_evidence + tuple(title_interval.evidence)
            prose.append(
                ProseAliasProposal(
                    class_id=class_id,
                    issuer_id=issuer_id,
                    raw_prose_name=item.security_title,
                    prose_key=prose_key(item.security_title),
                    bridge_type=SECURITY_TITLE_FACT,
                    effective_from=(
                        title_interval.effective_from if title_interval else None
                    ),
                    effective_to=title_interval.effective_to if title_interval else None,
                    interval_proved=title_interval is not None,
                    provenance=f"cover {item.title_concept or SECURITY_12B_TITLE}",
                    evidence=title_evidence,
                )
            )

        # 표지 밖의 명시 bridge(주로 governing instrument). **자기 증거만 달고 온다.**
        for bridge in supplied.extra_prose_bridges:
            if bridge.bridge_type not in PROSE_BRIDGE_TYPES:
                raise QVProposalError(
                    f"모르는 prose bridge_type입니다: {bridge.bridge_type!r}"
                )
            prose.append(
                ProseAliasProposal(
                    class_id=class_id,
                    issuer_id=issuer_id,
                    raw_prose_name=bridge.raw_prose_name,
                    prose_key=prose_key(bridge.raw_prose_name),
                    bridge_type=bridge.bridge_type,
                    effective_from=bridge.interval.effective_from,
                    effective_to=bridge.interval.effective_to,
                    interval_proved=True,
                    provenance=f"명시 {bridge.bridge_type} 증거",
                    evidence=tuple(bridge.interval.evidence),
                )
            )

    return tuple(classes), tuple(xbrl), tuple(prose)


def canonical_bridges_for(
    prose_proposals: tuple[ProseAliasProposal, ...], class_id: str
) -> tuple[ProseAliasProposal, ...]:
    """그 class의 **canonical** prose bridge 중 자기 구간이 증명된 것.

    `COVER_GROUP_LABEL`은 여기 들어오지 못한다 — corroborating 전용이다.
    """
    return tuple(
        item
        for item in prose_proposals
        if item.class_id == class_id and item.is_canonical and item.interval_proved
    )


def build_symbol_proposal(
    *,
    work_item: WorkItem,
    candidates: tuple[DiscoveryCandidate, ...] | list[DiscoveryCandidate],
    proof: CoverPageProof | None = None,
    proof_absence_reason: str | None = None,
    class_evidence: dict[str, ClassEvidence] | None = None,
    successor_judgement_required: bool = False,
) -> SymbolProposal:
    """작업 항목 하나의 제안 packet을 만든다. **manifest를 읽지도 쓰지도 않는다.**

    표지 `TradingSymbol` 대조는 **`identity_symbol`로만** 한다 — 벤더 계열 코드는 SEC
    표지에 실릴 수 없으므로 그것으로 대조하면 항상 `SYMBOL_NOT_ON_COVER_PAGE`가 된다.

    상태는 `AUTO_PROVABLE` · `REVIEW_REQUIRED` · `UNRESOLVED` 셋뿐이고,
    `AUTO_PROVABLE`은 "승인된 규칙 아래 SEC 증거가 기계적으로 완결됐다"는 뜻이지
    manifest가 바뀌었다는 뜻이 아니다.
    """
    clean_symbol = str(work_item.identity_symbol or "").strip()
    if not clean_symbol:
        raise QVProposalError("identity_symbol이 비었습니다")
    if work_item.symbol_bridge_kind not in BRIDGE_KINDS:
        raise QVProposalError(
            f"알 수 없는 symbol_bridge_kind입니다: {work_item.symbol_bridge_kind!r}"
        )
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

    # **재사용 벤더 계열인데 현재 티커 계열 출처만 나왔다면 기계적 완결이 아니다.**
    # 그 행이 다시 쓰인 이유가 "그 구간의 그 티커는 지금 주인의 것이 아니다"인데,
    # 지금 주인의 표지로 증명이 완결되면 옛 economic identity에 새 발행사가 붙는다.
    # 여기서 고르지 않고 5A-2c의 사람에게 넘긴다.
    if (
        work_item.symbol_bridge_kind == REUSED_VENDOR_SERIES
        and ordered_candidates
        and not any(item.origin in HISTORICAL_ORIGINS for item in ordered_candidates)
    ):
        reasons.append(REUSED_SERIES_ONLY_CURRENT_TICKER_CANDIDATE)
        questions.append(
            f"{work_item.member_symbol}는 {clean_symbol}의 옛 계열인데 발견 후보가 현재"
            " 티커 계열 출처뿐입니다 — 그 구간의 등록인인지 사람이 판정해야 합니다"
        )
        blocked = True

    census = CLASS_CENSUS_REVIEW_REQUIRED
    class_proposals: tuple[ShareClassProposal, ...] = ()
    xbrl_proposals: tuple[XbrlAliasProposal, ...] = ()
    prose_proposals: tuple[ProseAliasProposal, ...] = ()
    issuer_proposal: IssuerProposal | None = None

    if proof is None:
        reasons.append(NO_COVER_PAGE_PROOF_DOCUMENT)
        if proof_absence_reason == NO_TARGET_SYMBOL_COVER_PROOF:
            reasons.append(NO_TARGET_SYMBOL_COVER_PROOF)
            questions.append(NO_TARGET_SYMBOL_QUESTION)
        elif proof_absence_reason == NO_EXPLICIT_COVER_SYMBOL_ANYWHERE:
            # 요구 심볼의 표지가 없다는 사실은 같고, 그 **이유**가 다르다.
            reasons.append(NO_TARGET_SYMBOL_COVER_PROOF)
            reasons.append(PRE_INLINE_XBRL_NO_EXPLICIT_BRIDGE)
            questions.append(NO_EXPLICIT_COVER_SYMBOL_QUESTION)
        elif proof_absence_reason:
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

        matched = cover_classes_for_symbol(proof, clean_symbol)
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

        class_proposals, xbrl_proposals, prose_proposals = _class_packets(
            proof, class_evidence
        )
        if not class_proposals:
            reasons.append(CLASS_TITLE_BRIDGE_NOT_EXPLICIT)
            blocked = True
        else:
            # **production manifest에 쓰일 관계는 저마다 자기 구간을 증명해야 한다.**
            # 하나라도 비면 기계적 완결이 아니다 — class 구간을 alias로 복사하는 것이
            # 정확히 여기서 막는 일이다.
            if any(not item.interval_proved for item in class_proposals):
                reasons.append(CLASS_INTERVAL_NOT_EXPLICIT)
                questions.append(
                    "class 유효구간(effective_from/effective_to)은 표지가 증명하지 "
                    "않습니다 — 명시 증거가 필요합니다"
                )
                blocked = True
            if any(not item.interval_proved for item in xbrl_proposals):
                reasons.append(XBRL_ALIAS_INTERVAL_NOT_EXPLICIT)
                questions.append(
                    "XBRL alias 유효구간은 class 수명과 다른 관계입니다 — 표지가 그 "
                    "member를 실었다는 것이 언제부터 그 class를 가리켰는지를 증명하지 "
                    "않습니다"
                )
                blocked = True
            if any(not item.interval_proved for item in prose_proposals):
                reasons.append(PROSE_ALIAS_INTERVAL_NOT_EXPLICIT)
                questions.append(
                    "prose alias 유효구간은 class 수명과 다른 관계입니다 — 그 철자가 "
                    "언제부터 그 class를 가리켰는지에 명시 증거가 필요합니다"
                )
                blocked = True

            # **모든 보통주 class에 canonical bridge가 필요하다.** 요구된 상장 심볼만이
            # 아니라 발행사 package의 sibling 전부다. XBRL member 이름·표지 그룹 라벨·
            # sibling 순서·티커·주식수·class 글자 유사도로 추론하지 않는다.
            missing_bridge = sorted({
                item.class_id
                for item in class_proposals
                if not canonical_bridges_for(prose_proposals, item.class_id)
            })
            if missing_bridge:
                reasons.append(CANONICAL_CLASS_BRIDGE_NOT_EXPLICIT)
                questions.append(
                    "canonical class bridge(Security12b/12g 제목 또는 governing "
                    "instrument의 명시 class 정의)가 없는 보통주 class가 있습니다: "
                    + ", ".join(missing_bridge)
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
        member_symbol=work_item.member_symbol,
        identity_symbol=clean_symbol,
        symbol_bridge_kind=work_item.symbol_bridge_kind,
        demanded_formation_sessions=tuple(sorted(set(work_item.formation_sessions))),
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

NO_PERIODIC_FILINGS = "이 등록인에게 정기보고서(10-K/10-Q)가 없습니다"
NO_COVER_FACTS = "표지에 dei class fact가 없습니다(inline XBRL 표지 이전일 수 있습니다)"

# 요구 심볼의 표지를 끝내 못 찾은 두 모양. **열거값이라 집계할 수 있고**, 무관한 현재
# 심볼 표지를 그 심볼의 증명으로 삼는 대신 여기서 멈춘다.
NO_TARGET_SYMBOL_COVER_PROOF = "NO_TARGET_SYMBOL_COVER_PROOF"
NO_EXPLICIT_COVER_SYMBOL_ANYWHERE = "NO_EXPLICIT_COVER_SYMBOL_ANYWHERE"

NO_TARGET_SYMBOL_QUESTION = (
    "정기보고서 표지들이 다른 증권을 명시로 증명하고 요구 심볼은 어느 표지에도 "
    "없습니다 — 무관한 표지를 그 심볼의 증명으로 삼지 않습니다"
)
NO_EXPLICIT_COVER_SYMBOL_QUESTION = (
    "표지 class fact는 있으나 어느 표지도 제목·심볼 fact를 싣지 않았습니다 — "
    "2019 표지 XBRL 의무화 이전 filing일 수 있고, 다른 명시 증거가 필요합니다"
)


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


@dataclass(frozen=True)
class DiscoveryHints:
    """historical discovery의 **명시** 입력. 추측한 이름을 넣지 않는다.

    두 칸의 키가 다르고, 그것이 이 fix의 핵심이다.

    ```text
    names  identity_symbol -> 그 구간의 회사 이름   (지수 변경 공고 CSV)
    spans  member_symbol   -> 그 데이터 계열의 구간 (universe_membership)
    ```

    이름은 **경제적 심볼**로 찾는다 — 지수 공고는 `FOXA`라고 적지 `TFCFA`라고 적지
    않는다. 구간은 **데이터 계열 심볼**로 찾는다 — 그것이 재사용 episode를 이미 갈라
    놓았고, 경제적 심볼로 뭉치면 서로 다른 발행사의 구간이 하나의 min/max로 합쳐진다.

    **여기서 나온 후보는 끝까지 `DISCOVERY_HINT`다.** 어느 등록인의 filing을 볼지만
    고르고, issuer/share-class 증명을 만들거나 `AUTO_PROVABLE`을 만들지 못한다.
    """

    source: str
    source_version: str
    provenance: str
    names: dict[str, str]
    spans: dict[str, tuple[str, str]]

    def entry(self, work_item: WorkItem) -> tuple[str, tuple[str, str]] | None:
        """그 작업 항목의 (이름, 구간). 둘 다 있어야 쓴다."""
        name = str(self.names.get(work_item.identity_symbol) or "").strip()
        span = self.spans.get(work_item.member_symbol)
        if not name or not span:
            return None
        start, end = str(span[0] or "").strip(), str(span[1] or "").strip()
        if not start or not end:
            return None
        return name, (start, end)

    def as_json(self) -> dict:
        return {
            "source": self.source,
            "source_version": self.source_version,
            "provenance": self.provenance,
            "name_key": "identity_symbol",
            "span_key": "member_symbol",
            "identity_symbols_with_name": sorted(
                symbol for symbol, name in self.names.items() if str(name or "").strip()
            ),
            "member_symbols_with_span": sorted(
                symbol for symbol, span in self.spans.items()
                if span and str(span[0] or "").strip() and str(span[1] or "").strip()
            ),
        }


def historical_name_candidate(
    client, work_item: WorkItem, hints: DiscoveryHints, index
) -> DiscoveryCandidate | None:
    """3층. **그 구간의 회사 이름**으로 등록인을 찾는다.

    이름은 경제적 심볼로, 구간은 그 작업 항목의 데이터 계열로 잡는다(`DiscoveryHints`).
    `edgar.resolve_by_name`을 그대로 쓴다 — 새 fuzzy resolver를 만들지 않는다. 그것이
    하나로 좁히지 못하면 아무것도 돌려주지 않는다(조용히 첫 후보를 고르지 않는다).
    """
    found = hints.entry(work_item)
    if found is None:
        return None
    name, span = found
    cik, _survivors = resolve_by_name(client, name, index, span=span)
    if not cik:
        return None
    return DiscoveryCandidate(
        cik=cik,
        origin=HISTORICAL_NAME_LOOKUP,
        detail=f"{name} @ {span[0]}..{span[1]} ({hints.source}/{hints.source_version})",
    )


def predecessor_candidate(
    client, work_item: WorkItem, hints: DiscoveryHints, index, successor_cik: str
) -> DiscoveryCandidate | None:
    """구간 앞부분을 냈던 **선행 등록인**. `edgar.find_predecessor`를 그대로 쓴다.

    선행 등록인이 나오면 그 자체가 승계 판정이 필요하다는 신호다 — 기계가 둘 중
    하나를 고르지 않는다.
    """
    found = hints.entry(work_item)
    if found is None:
        return None
    name, span = found
    dates, _payload = client.all_earnings_dates(successor_cik, span[0])
    # 후속이 이미 구간 앞부분을 냈으면 선행 등록인을 찾을 이유가 없다. EDGAR 수집
    # 경로(`edgar.collect`)가 쓰는 것과 같은 게이트다.
    if dates and min(dates) <= span[0]:
        return None
    earlier = find_predecessor(
        client,
        name,
        index,
        span=span,
        successor_cik=successor_cik,
        successor_first=min(dates) if dates else None,
    )
    if not earlier:
        return None
    return DiscoveryCandidate(
        cik=earlier,
        origin=PREDECESSOR_HINT,
        detail=f"{name} 선행 등록인 (successor {successor_cik})",
    )


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
    forms: tuple[str, ...] = COVER_FORMS,
) -> tuple:
    """표지 증명 후보 정기보고서. **수리 시각이 늦은 것부터** 결정적으로 정렬한다.

    **요구 formation 이후에 수리됐다는 이유로 제출을 버리지 않는다.** Step 4의 CLOSED
    계약대로 나중 SEC 문서가 더 오래된 경제적·법적 상태를 명시로 증명할 수 있고,
    5A-2는 그 static 증거를 모으는 단계다. 그 증거를 과거 formation에서 실제로 쓸 수
    있었는지는 **5A-3이 REQUIRED 증거에서 `usable_from_session`을 파생시켜** 가른다.
    여기에 두 번째 look-ahead 규칙을 만들지 않는다.

    수리 시각이 같으면 accession으로 가른다(정렬 안정성).
    """
    rows = [
        row
        for row in _submission_rows_from_sec(client, normalize_cik(cik))
        if row.form in forms and row.acceptance_eastern_date
    ]
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
    target_symbol: str,
    forms: tuple[str, ...] = COVER_FORMS,
) -> tuple[CoverPageProof | None, str | None, tuple[str, ...]]:
    """**요구 심볼의** 표지 증명을 찾는다. `(proof, 부재사유, 시도한 accession)`이다.

    **target-blind 탐색은 같은 등록인의 티커 변경에서 체계적 위음성을 만든다.** 옛
    심볼을 요구하는데 최신 표지가 새 심볼을 싣고 있으면, "class fact가 있으니 이것"으로
    멈춘 뒤 대조에서 `SYMBOL_NOT_ON_COVER_PAGE`가 난다. **옛 심볼을 명시로 증명하는 더
    오래된 표지는 읽히지도 않는다.** fail-closed이긴 하지만 기계적으로 증명 가능한
    과거 매핑을 수동 검토로 보내버린다.

    그래서 수리 시각이 늦은 것부터 결정론적으로 훑되 판정 기준이 하나 더 있다.

    ```text
    표지에 요구 심볼이 정확히 있다   -> 그 표지가 증명이다. 즉시 멈춘다.
    다른 증권만 있다                 -> 더 오래된 filing을 계속 본다.
    class fact가 없다                -> 계속 본다.
    ```

    **`proof.classes`가 비어 있지 않다는 이유만으로 멈추지 않는다.** 대조는
    `cover_classes_for_symbol` 하나이고 `build_symbol_proposal`이 쓰는 것과 같은
    함수다 — fuzzy ticker 매칭이 없다.

    **탐색 지평에 임의의 상한을 두지 않는다.** 정확한 증명을 찾거나 적격 제출 이력이
    바닥날 때까지 본다. 과거 티커가 "현재로부터 네 번째 제출"이라는 이유로 증명 불가가
    되면 안 된다. 신뢰도 점수·연도 cutoff·사용자 조절 문턱을 만들지 않는다.

    **formation cutoff를 되살리지 않는다.** 나중 SEC 문서가 더 오래된 경제적 상태를
    증명할 수 있고, 그것을 그때 쓸 수 있었는지는 5A-3의 `usable_from_session`이 가른다.
    """
    registrant = normalize_cik(cik)
    if registrant is None:
        raise QVProposalError(f"CIK가 아닙니다: {cik!r}")
    wanted = str(target_symbol or "").strip()
    if not wanted:
        raise QVProposalError("target_symbol이 비었습니다")

    rows = cover_filing_rows(client, registrant, forms=forms)
    if not rows:
        return None, NO_PERIODIC_FILINGS, ()

    attempted: list[str] = []
    saw_classes = False
    saw_explicit_symbol_or_title = False
    for row in rows:
        attempted.append(row.accession)
        document, name = _instance_from_accession(client, registrant, row.accession)
        if document is None:
            continue
        proof = extract_cover_proof(
            document, cik=registrant, accession=row.accession, document_name=name
        )
        if not proof.classes:
            continue
        saw_classes = True
        if any(item.trading_symbol or item.security_title for item in proof.classes):
            saw_explicit_symbol_or_title = True
        if cover_classes_for_symbol(proof, wanted):
            return proof, None, tuple(attempted)

    if not saw_classes:
        return None, NO_COVER_FACTS, tuple(attempted)
    if not saw_explicit_symbol_or_title:
        # 표지 class fact는 있는데 제목·심볼 칸이 아예 없다 — 2019 표지 XBRL 의무화
        # 이전의 구조적 서명이다. "다른 회사 심볼이 있었다"와 구분해서 적는다.
        return None, NO_EXPLICIT_COVER_SYMBOL_ANYWHERE, tuple(attempted)
    return None, NO_TARGET_SYMBOL_COVER_PROOF, tuple(attempted)


# ── 실행 산출물 ───────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class ProposalRun:
    """5A-2a/b 한 번의 산출물. **manifest 변경이 아니다.**

    5A-1의 semantic source 정체성을 전부 그대로 들고 다닌다 — 파일 경로 하나로
    대신하지 않는다.
    """

    demand_input: DemandInput
    proposals: tuple[SymbolProposal, ...]
    attempted_accessions: tuple[tuple[str, str, tuple[str, ...]], ...] = ()
    hints: DiscoveryHints | None = None

    @property
    def identity_source_version(self) -> str:
        return self.demand_input.identity_source_version

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

    def origin_counts(self) -> dict[str, int]:
        tally: dict[str, int] = {}
        for item in self.proposals:
            for candidate in item.discovery_candidates:
                tally[candidate.origin] = tally.get(candidate.origin, 0) + 1
        return dict(sorted(tally.items()))

    def as_json(self) -> dict:
        return {
            "stage": "5A-2",
            "produces": "SEC_IDENTITY_PROPOSALS",
            "mutates_production_manifest": False,
            "note": (
                "static SEC identity evidence only — not PIT identity usability. "
                "usable_from_session is derived in 5A-3 from REQUIRED evidence."
            ),
            "demand_provenance": self.demand_input.provenance_json(),
            "identity_source_version": self.identity_source_version,
            "discovery_hints": self.hints.as_json() if self.hints else None,
            "counts": self.counts(),
            "reason_counts": self.reason_counts(),
            "discovery_origin_counts": self.origin_counts(),
            "attempted_accessions": [
                {
                    "member_symbol": member,
                    "identity_symbol": identity,
                    "accessions": list(accessions),
                }
                for member, identity, accessions in self.attempted_accessions
            ],
            "proposals": [item.as_json() for item in self.proposals],
        }


def run_proposals(
    client,
    demand_input: DemandInput,
    *,
    companies: dict,
    overrides: dict[str, str] | None = None,
    use_browse: bool = False,
    hints: DiscoveryHints | None = None,
    name_index=None,
    class_evidence: dict[tuple[str, str], dict[str, ClassEvidence]] | None = None,
) -> ProposalRun:
    """수요 작업 항목마다 발견 → SEC 증명 → 제안 packet을 만든다.

    `class_evidence`의 키는 작업 항목 키 `(member_symbol, identity_symbol)`이다.

    **manifest 파일을 읽지도 쓰지도 않는다.** 발견은 넓게 하되(현재 ticker map ·
    `CIK_OVERRIDES` · browse-EDGAR · 구간 이름 색인 · 선행 등록인) 그 결과는 전부
    `DISCOVERY_HINT`이고, production identity가 되는 것은 SEC 원문 증명뿐이다.

    `hints`가 있으면 이름 색인은 처음 필요할 때 한 번만 만든다(40MB 다운로드다).
    """
    proposals: list[SymbolProposal] = []
    attempts: list[tuple[str, str, tuple[str, ...]]] = []
    index = name_index

    for work_item in demand_input.work_items:
        # **모든 SEC 발견·증명이 경제적 심볼로 간다.** 데이터 계열 심볼은 어느 episode의
        # 수요인지를 가르는 데만 쓰이고 SEC에 던져지지 않는다.
        symbol = work_item.identity_symbol
        extra: list[DiscoveryCandidate] = []
        if use_browse:
            found = browse_candidate(client, symbol)
            if found is not None:
                extra.append(found)
        def assemble():
            found = discover_candidates(
                symbol, companies=companies, overrides=overrides, extra=tuple(extra)
            )
            return found, sorted({item.cik for item in found})

        candidates, distinct = assemble()
        wants_hint = hints is not None and hints.entry(work_item) is not None

        # 3층은 앞 층이 빈손일 때만 돈다 — `edgar.collect`와 같은 순서다. 항상 돌리면
        # 건강한 종목까지 동명 등록인과 부딪혀 전부 REVIEW_REQUIRED가 된다.
        #
        # **재사용 벤더 계열은 예외다.** 그 멤버십 행이 다시 쓰인 이유가 바로 "그 구간의
        # 그 티커는 지금 주인의 것이 아니다"이므로, 현재 ticker 파일의 답은 구조적으로
        # 다른 경제적 사용에 대한 것이다. 여기서 1층에 멈추면 옛 episode가 조용히 지금
        # 주인의 CIK를 받는다. 둘이 갈리면 `CIK_CONFLICT`로 사람에게 넘긴다 — 기계가
        # 승계·재편을 고르지 않는다.
        if wants_hint and (not distinct or work_item.symbol_bridge_kind == REUSED_VENDOR_SERIES):
            if index is None:
                index = client.cik_lookup()
            found = historical_name_candidate(client, work_item, hints, index)
            if found is not None:
                extra.append(found)
                candidates, distinct = assemble()

        # 선행 등록인은 후속이 하나로 정해졌을 때만 의미가 있다.
        successor_judgement = False
        if wants_hint and len(distinct) == 1:
            if index is None:
                index = client.cik_lookup()
            earlier = predecessor_candidate(client, work_item, hints, index, distinct[0])
            if earlier is not None:
                extra.append(earlier)
                candidates, distinct = assemble()
                successor_judgement = True

        proof = None
        absence = None
        tried: tuple[str, ...] = ()
        if len(distinct) == 1:
            # **요구 심볼을 들고 들어간다.** 어느 표지가 그 심볼의 증명인지는 대조
            # 이후가 아니라 탐색 안에서 정해져야 한다.
            proof, absence, tried = fetch_cover_proof(
                client, distinct[0], target_symbol=symbol
            )
        elif len(distinct) > 1:
            absence = "후보 CIK가 확정되지 않아 증명을 시도하지 않았습니다"
        attempts.append((work_item.member_symbol, symbol, tried))
        proposals.append(
            build_symbol_proposal(
                work_item=work_item,
                candidates=candidates,
                proof=proof,
                proof_absence_reason=absence,
                class_evidence=(class_evidence or {}).get(work_item.key),
                successor_judgement_required=successor_judgement,
            )
        )

    return ProposalRun(
        demand_input=demand_input,
        proposals=tuple(proposals),
        attempted_accessions=tuple(attempts),
        hints=hints,
    )
