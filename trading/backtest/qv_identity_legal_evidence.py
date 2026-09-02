"""5A-2 **법적 증거 공급기** — SEC governing instrument에서 명시 class 사실만 읽는다.

```text
SEC submission/accession 문서
      -> 명시 legal/governing 사실
      -> 구조화된 legal proof
      -> ClassEvidence
```

**읽기 전용이다.** production identity manifest(`trading/qv/identity/*.jsonl`)를 읽지도
쓰지도 않는다. 여기서 나오는 것은 5A-2 제안 packet에 실릴 증거이고, 승격은 5A-2c가
그 구조화된 proof에서 **같은 함수로** 다시 파생시킨 뒤에만 한다.

일반 legal NLP 엔진 · 범용 SEC 문서 창고 · LLM parser · embedding/fuzzy 검색을 만들지
않는다. 결정론적 구조 파싱과 **열거된 semantic family**뿐이다.

## B1 — 표지 제목은 관측이지 production alias가 아니다

```text
Security12bTitle = "Class A Common Stock"
```

이 표지는 **그 accession이 그 증권을 그렇게 불렀다**를 증명한다. "그 철자가 class
탄생부터 지금까지 유효한 alias였다"는 증명하지 않는다. 그래서 표지 제목은
`CoverPageProof`에 그대로 남되, **자기 구간이 독립적으로 증명됐을 때만** production
prose alias 제안이 된다(§11 · `_class_packets`).

## B2 — 탄생 증거만으로는 `effective_to = null`이 되지 않는다

```text
명시 탄생일 + 발견된 종료 없음   =>  effective_to = null      **금지**
```

종료를 못 찾았다는 것은 연속성의 증거가 아니다. open-ended economic lifetime은
**명시 탄생 + current-in-effect 완전 governing snapshot + amendment 탐색 COMPLETE +
미해결 class 영향 없음**이 전부 성립할 때만 나온다. C3가 이미 쓰는 fail-close
continuity 철학과 같다.

## 자동 class 연결은 의도적으로 좁다

governing 문서의 class를 표지 class에 자동으로 잇는 anchor는 **하나뿐**이다.

```text
표지에 Security12bTitle / Security12gTitle이 있고
N1(표지 증권 제목) == N1(governing class 이름)
```

정확한 N1 동일성만이다. XBRL member 철자 · `CommonClassBMember` · class 글자 유사도 ·
sibling 순서 · ticker 유사도 · 액면가 유사도 · 주식수 · `COVER_GROUP_LABEL` ·
근사 prose 유사도 · fuzzy 매칭으로 잇지 않는다.

**결과**: 제목 없는 sibling(`CommonClassBMember` + 주식수 fact)은 charter에 "Class B
Common Stock"이 있다는 이유로 기계적으로 연결되지 않는다. 그대로 `REVIEW_REQUIRED`다.
AUTO 비율을 올리려고 이 규칙을 약화하지 않는다.

## 탐색 지평은 명시적이다

임의의 시도 상한(`최근 3건` · `최근 5년` · `최신 charter만`)을 correctness 규칙으로
쓰지 않는다. 대신 **frozen하게 선언된 지평**을 쓰고 그것을 proof에 적는다.

```text
GOVERNING_SEARCH_FORMS = 8-K 계열 · 10-K 계열 · 10-Q 계열
```

그 지평 안의 **모든** accession index를 읽고, 후보 문서를 하나도 건너뛰지 않는다.
지평 밖 form에만 존재하는 governing instrument는 이 증분의 **선언된 한계**이고
proof의 `accessions_outside_horizon`에 수량으로 남는다 — 조용히 흡수하지 않는다.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from .edgar import accession_dir_url
from .qv_events import NOT_IMPLEMENTED_PATTERNS, html_blocks
# 날짜 문자열 → ISO 변환과 block 분해는 이미 한 곳에 있다. 두 번째로 미묘하게 다른
# parser를 만들면 두 경로가 조용히 갈라진다.
from .qv_events import _iso_date
from .qv_identity_proposals import (
    ClassEvidence,
    CoverPageProof,
    EvidenceRef,
    RelationInterval,
)
from .qv_manifest import prose_key
# recent + archive submission row 수집은 이미 한 곳에 있다(`qv_identity_proposals`가
# 같은 이유로 같은 함수를 쓴다). form 필터만 넓혀서 그대로 재사용한다.
from .qv_submissions import _submissions_rows as _submission_rows_from_sec
from .qv_xbrl import normalize_cik, sha256

# ── 결과 상태 — 셋뿐이고 신뢰도 점수가 아니다 ────────────────────────────────
COMPLETE = "COMPLETE"
INCOMPLETE = "INCOMPLETE"
UNRESOLVED = "UNRESOLVED"

# ── 증거 역할 — 정확한 이름을 일관되게 쓴다. 동의어를 늘리지 않는다 ──────────
GOVERNING_CLASS_DEFINITION = "GOVERNING_CLASS_DEFINITION"
# **정의와 탄생은 다른 사실이다.** 완전 restated instrument가 그 class를 정의하고
# 스스로 D에 발효한다는 것은 "그 class가 D에 만들어졌다"가 아니다 — class가 그
# restatement보다 수십 년 앞설 수 있다. 탄생은 그 class를 실제로 세우는 **명시 실행
# 행위**가 따로 있어야 한다.
CLASS_BIRTH_ACTION = "CLASS_BIRTH_ACTION"
CLASS_BIRTH_EFFECTIVE_DATE = "CLASS_BIRTH_EFFECTIVE_DATE"
CURRENT_GOVERNING_SNAPSHOT = "CURRENT_GOVERNING_SNAPSHOT"
CLASS_TERMINATION_EFFECTIVE_DATE = "CLASS_TERMINATION_EFFECTIVE_DATE"
PROSE_ALIAS_LIFETIME = "PROSE_ALIAS_LIFETIME"

SEC_EVIDENCE_DOCUMENT = "SEC_EVIDENCE_DOCUMENT"

# ── 탐색 지평 — 선언된 form 계열. 건수·연도 상한이 아니다 ────────────────────
GOVERNING_SEARCH_FORMS = frozenset({
    "8-K", "8-K/A", "10-K", "10-K/A", "10-Q", "10-Q/A",
})
EIGHT_K_FORMS = frozenset({"8-K", "8-K/A"})
# 8-K가 governing instrument 변경을 알리는 구조화된 항목 번호.
CHARTER_AMENDMENT_ITEM = "5.03"

PRIMARY = "PRIMARY"
EXHIBIT = "EXHIBIT"

# ── 증명 권한 — discovery와 authority는 다른 축이다 ──────────────────────────
#
# **filing 서술은 governing instrument가 아니다.** Item 5.03 8-K의 primary 문서는
# "우리가 Certificate of Amendment를 제출했다"라고 말할 뿐 그 instrument 자체가
# 아니다. 그 서술을 economic identity로 파싱하면 첨부물 이름만 보고 class 사실을
# 만들어내는 셈이 된다. 후보 discovery는 그대로 두되 권한은 실제 Exhibit 3 문서에만
# 준다.
GOVERNING_EXHIBIT = "GOVERNING_EXHIBIT"
FILING_NARRATIVE = "FILING_NARRATIVE"

# **Exhibit 3 계열만이다.** `EX-3`으로 문자열 prefix 비교를 하면 SOX 인증서
# `EX-31.1`·`EX-32.1`이 전부 governing 후보로 끌려 들어온다(실측: ABMD 385건 중 102건이
# 그 이유로 분류 불가였다). 전시번호 3 뒤에 다른 숫자가 붙지 않는 것만 받는다.
EXHIBIT_3_PATTERN = re.compile(r"^EX-0*3(?![0-9])", re.IGNORECASE)


def document_proof_authority(document_type: object) -> str:
    """그 문서가 **법적 증명 권한**을 갖는가. 정의는 여기 하나뿐이다.

    실제 Exhibit 3 문서만 governing instrument로 읽힌다. Item 5.03으로 발견된 primary
    8-K는 discovery/corroborating receipt로 남되 어떤 finding도 만들지 못한다.
    """
    clean = str(document_type or "").strip()
    if clean and EXHIBIT_3_PATTERN.match(clean):
        return GOVERNING_EXHIBIT
    return FILING_NARRATIVE

# ── 문서 분류 — 열거된 family만 인정한다 ─────────────────────────────────────
#
# **완전한 current-in-effect governing instrument만 snapshot checkpoint가 된다.**
# 단순 amendment는 snapshot이 아니고, 정기보고서의 서술은 governing instrument가 아니다.
# C3의 `GOVERNING_SNAPSHOT_ROLES`와 같은 철학이다.
SNAPSHOT_FAMILIES = (
    ("AMENDED_AND_RESTATED_CERTIFICATE",
     r"amended\s+and\s+restated\s+certificate\s+of\s+incorporation"),
    ("AMENDED_AND_RESTATED_ARTICLES",
     r"amended\s+and\s+restated\s+articles\s+of\s+(?:incorporation|organization)"),
    ("RESTATED_CERTIFICATE", r"restated\s+certificate\s+of\s+incorporation"),
    ("RESTATED_ARTICLES", r"restated\s+articles\s+of\s+(?:incorporation|organization)"),
)
AMENDMENT_FAMILIES = (
    ("CERTIFICATE_OF_AMENDMENT", r"certificate\s+of\s+amendment"),
    ("ARTICLES_OF_AMENDMENT", r"articles\s+of\s+amendment"),
)
# governing instrument가 **아니라고** 분류되는 것들. 인식됐으므로 미분류가 아니다.
NON_GOVERNING_FAMILIES = (
    ("BYLAWS", r"\bby-?laws\b"),
)
UNCLASSIFIED = "UNCLASSIFIED"

SNAPSHOT_CLASSIFICATIONS = frozenset(name for name, _ in SNAPSHOT_FAMILIES)
AMENDMENT_CLASSIFICATIONS = frozenset(name for name, _ in AMENDMENT_FAMILIES)
GOVERNING_CLASSIFICATIONS = SNAPSHOT_CLASSIFICATIONS | AMENDMENT_CLASSIFICATIONS

# ── 명시 class 정의 grammar — §9.1의 세 shape뿐이다 ──────────────────────────
#
# **단순 언급으로는 부족하다.** 그 이름이 법적으로 세워지는 문장 모양이어야 한다.
# 목록을 열린 채로 늘리지 않는다 — 맞지 않으면 UNRESOLVED다.
CLASS_DEFINITION_PATTERNS = (
    ("AUTHORIZED_TO_ISSUE",
     r"authorized\s+to\s+issue\b[^.;]{0,240}?\bshares\s+of\s+(?:the\s+)?{name}\b"),
    ("DIVIDED_INTO", r"\bdivided\s+into\b[^.;]{0,240}?\b{name}\b"),
    ("DESIGNATED", r"\bdesignated(?:\s+as)?\s+(?:the\s+)?[\"“‘']?{name}\b"),
)

# ── 명시 class 탄생 행위 grammar ─────────────────────────────────────────────
#
# **정의가 아니라 생성이다.** `authorized to issue ... Class A Common Stock`은 그
# instrument가 서술하는 **상태**이고, 그 class를 그 시점에 만들었다는 진술이 아니다.
# 여기 있는 것은 그 class를 실제로 세우는 행위를 명시로 말하는 문장 모양뿐이다.
# 원본 governing instrument도 그 언어가 있을 때만 탄생을 증명한다.
CLASS_BIRTH_ACTION_PATTERNS = (
    ("HEREBY_CREATED",
     r"\bhereby\s+(?:created|established)\b[^.;]{0,200}?\b{name}\b"),
    ("HEREBY_CREATED",
     r"\b{name}\b[^.;]{0,160}?\b(?:is|are|shall\s+be)\s+hereby\s+"
     r"(?:created|established)\b"),
    ("NEW_CLASS_DESIGNATED",
     r"\bnew\s+class\b[^.;]{0,200}?\bdesignated(?:\s+as)?\s+(?:the\s+)?"
     r"[\"“‘']?{name}\b"),
    ("RECLASSIFIED_INTO",
     r"\breclassified\s+into\b[^.;]{0,200}?\b{name}\b"),
)

_DATE = r"[A-Z][a-z]+ \d{1,2}, \d{4}"

# ── 명시 operative date grammar — §9.2 ───────────────────────────────────────
#
# **수리 시각 · filed date · accession 날짜 · report date · 서명일 단독 · 최초 관측
# filing · 최초 XBRL 등장 · 최초 ticker 등장을 경제적 발효일로 쓰지 않는다.**
# 여기 있는 것은 전부 governing instrument/action에 명시로 붙은 표현이다.
EFFECTIVE_DATE_PATTERNS = (
    ("EFFECTIVE_AS_OF", r"\beffective\s+as\s+of\s+(?P<d>" + _DATE + r")"),
    ("BECOMES_EFFECTIVE",
     r"\b(?:shall\s+become|becomes|became|shall\s+be|is)\s+effective\s+"
     r"(?:on|as\s+of)\s+(?P<d>" + _DATE + r")"),
    ("EFFECTIVE",
     r"\beffective\s+(?:date|time)\s+(?:of|is|shall\s+be)\b[^.;]{0,60}?"
     r"(?P<d>" + _DATE + r")"),
    ("EFFECTIVE", r"\beffective\s+on\s+(?P<d>" + _DATE + r")"),
)

# ── 명시 class 종료 grammar — §9.5 ───────────────────────────────────────────
#
# 제안 · 승인 · 장래 의사 · 주주총회 대기 · 기준일 · 공고는 종료가 아니다. ticker
# 소멸 · 주식수 0 · 피인수 · 나중 표지에서의 부재 · 현재 SEC 메타데이터의 부재도
# 종료가 아니다. **명시로 실행된 class 종료 행위 + 명시 발효일**만이다.
CLASS_TERMINATION_PATTERNS = (
    ("RECLASSIFIED",
     r"\b(?:each|all|every)\b[^.;]{0,120}?\bshares?\s+of\s+{name}\b[^.;]{0,160}?"
     r"\b(?:was|were|is|are|shall\s+be|been)\s+reclassified\b"),
    ("RECLASSIFIED",
     r"\b{name}\b[^.;]{0,120}?\b(?:was|were|shall\s+be|been)\s+reclassified\s+into\b"),
    ("ELIMINATED",
     r"\b{name}\b[^.;]{0,120}?\b(?:was|were|is|are|shall\s+be|been)\s+"
     r"(?:eliminated|cancelled|canceled)\b"),
    ("CONVERTED_ENTIRE_CLASS",
     r"\b(?:each|all|every)\b[^.;]{0,120}?\bshares?\s+of\s+{name}\b[^.;]{0,160}?"
     r"\b(?:was|were|shall\s+be|been|automatically)\s+converted\b"),
)

# 실행되지 않았음을 **명시**하는 표현. `qv_events`의 목록을 그대로 쓰고 governing
# 문맥에만 있는 좁은 표현을 더한다. 하나라도 걸린 block은 어떤 finding도 만들지 못한다.
LEGAL_NOT_IMPLEMENTED_PATTERNS = NOT_IMPLEMENTED_PATTERNS + (
    r"\bif approved\b",
    r"\bwill be submitted\b",
    r"\bpending (?:shareholder|stockholder) (?:vote|approval)\b",
    r"\brecord date\b",
    r"\bannounced\b",
)


class QVLegalEvidenceError(Exception):
    """법적 증거 계약을 벗어날 때 올린다. **전부 fail-close다.**"""


def _name_regex(raw_name: str) -> str:
    """정확한 class 이름의 정규식 조각. **fuzzy가 아니라 exact token 연쇄다.**"""
    parts = str(raw_name or "").split()
    if not parts:
        raise QVLegalEvidenceError("class 이름이 비었습니다")
    return r"\s+".join(re.escape(part) for part in parts)


def _fill(pattern: str, raw_name: str) -> str:
    return pattern.replace("{name}", _name_regex(raw_name))


def _not_implemented(block: str) -> tuple[str, ...]:
    return tuple(
        sorted(
            pattern
            for pattern in LEGAL_NOT_IMPLEMENTED_PATTERNS
            if re.search(pattern, block, re.IGNORECASE)
        )
    )


# ── 구조화된 legal proof ──────────────────────────────────────────────────────


@dataclass(frozen=True)
class LegalDocument:
    """증거로 쓰인 SEC 문서 하나의 **자연키와 불변 정체성.**

    본문 HTML은 넣지 않는다. 문서 SHA와 자연키만 남고, 그것을 실제 SEC 문서와 맞춰
    보는 것은 5A-3 ingest의 일이다.
    """

    cik: str
    accession: str
    form: str
    document_name: str
    document_role: str
    document_type: str | None
    acceptance_datetime: str | None
    source_url: str
    document_sha256: str
    classification: str
    # **discovery와 authority는 다른 축이다.** 서술 문서도 receipt에는 남지만
    # 어떤 finding도 만들지 못한다.
    proof_authority: str
    # 첫 일치 하나만이 아니라 문서가 언급한 family 전부. 조용히 잃지 않는다.
    classification_families: tuple[str, ...] = ()

    @property
    def key(self) -> tuple[str, str, str]:
        return (self.cik, self.accession, self.document_name)

    def as_json(self) -> dict:
        return {
            "cik": self.cik,
            "accession": self.accession,
            "form": self.form,
            "document_name": self.document_name,
            "document_role": self.document_role,
            "document_type": self.document_type,
            "acceptance_datetime": self.acceptance_datetime,
            "source_url": self.source_url,
            "document_sha256": self.document_sha256,
            "classification": self.classification,
            "proof_authority": self.proof_authority,
            "classification_families": list(self.classification_families),
        }


@dataclass(frozen=True)
class LegalFinding:
    """문서 한 곳에서 읽은 명시 semantic 사실 하나.

    `locator`는 결정론적 source span이다(`block:<ordinal>`). 자유 문장 요약이 아니라
    승격기가 되짚을 수 있는 위치다.
    """

    finding_kind: str
    accession: str
    document_name: str
    locator: str
    class_name_key: str
    raw_class_name: str
    semantic_family: str
    effective_date: str | None = None

    def as_json(self) -> dict:
        return {
            "finding_kind": self.finding_kind,
            "accession": self.accession,
            "document_name": self.document_name,
            "locator": self.locator,
            "class_name_key": self.class_name_key,
            "raw_class_name": self.raw_class_name,
            "semantic_family": self.semantic_family,
            "effective_date": self.effective_date,
        }


@dataclass(frozen=True)
class ClassLegalProof:
    """표지 class 하나에 대한 법적 증명.

    `status`는 신뢰도 점수가 아니라 **셋 중 하나**다.

    ```text
    COMPLETE     주장한 요소를 전부 기계적으로 세웠고 필요한 탐색도 닫혔다
    INCOMPLETE   fetch/index/parse 실패로 필요한 SEC 탐색이 닫히지 않았다
    UNRESOLVED   탐색은 닫혔으나 명시 법적 사실이 없거나 의미가 모호하다
    ```
    """

    member_key: str
    raw_target_name: str
    target_name_key: str
    status: str
    birth_date: str | None
    termination_date: str | None
    open_ended: bool
    snapshot_accession: str | None
    snapshot_document_name: str | None
    findings: tuple[LegalFinding, ...]
    notes: tuple[str, ...]

    def as_json(self) -> dict:
        return {
            "member_key": self.member_key,
            "raw_target_name": self.raw_target_name,
            "target_name_key": self.target_name_key,
            "status": self.status,
            "birth_date": self.birth_date,
            "termination_date": self.termination_date,
            "open_ended": self.open_ended,
            "snapshot_accession": self.snapshot_accession,
            "snapshot_document_name": self.snapshot_document_name,
            "findings": [item.as_json() for item in self.findings],
            "notes": list(self.notes),
        }


@dataclass(frozen=True)
class LegalEvidenceProof:
    """작업 항목 하나의 **구조화된 법적 증명 전체.**

    `RelationInterval`만 남기고 그것이 어떻게 나왔는지를 버리지 않는다 — 승격기가
    이 구조에서 같은 `ClassEvidence`를 다시 파생시켜야 하기 때문이다.
    """

    cik: str
    cover_accession: str
    cover_document_name: str
    search_status: str
    horizon_forms: tuple[str, ...]
    searched_accessions: tuple[str, ...]
    accessions_outside_horizon: int
    documents: tuple[LegalDocument, ...]
    failures: tuple[tuple[str, str], ...]
    classes: tuple[ClassLegalProof, ...]

    def as_json(self) -> dict:
        return {
            "cik": self.cik,
            "cover_accession": self.cover_accession,
            "cover_document_name": self.cover_document_name,
            "search_status": self.search_status,
            "horizon_forms": list(self.horizon_forms),
            "searched_accessions": list(self.searched_accessions),
            "accessions_outside_horizon": self.accessions_outside_horizon,
            "documents": [item.as_json() for item in self.documents],
            "failures": [list(item) for item in self.failures],
            "classes": [item.as_json() for item in self.classes],
        }


# ── 문서 분류 ─────────────────────────────────────────────────────────────────


def classify_document(blocks: tuple[str, ...]) -> str:
    """문서가 **무엇인지**를 열거된 family로 정한다. 파일명으로 정하지 않는다.

    `charter`가 파일명에 있다는 이유로 권위를 주지 않는다 — 본문이 스스로 무엇인지
    말해야 한다. 자기 제목을 처음 말하는 block으로 정하고, 그 block 안에서는
    **amendment가 snapshot보다 먼저**다. `Certificate of Amendment of the Amended and
    Restated Certificate of Incorporation`은 amendment이지 complete snapshot이 아니다.
    """
    for block in blocks:
        for name, pattern in AMENDMENT_FAMILIES:
            if re.search(pattern, block, re.IGNORECASE):
                return name
        for name, pattern in SNAPSHOT_FAMILIES:
            if re.search(pattern, block, re.IGNORECASE):
                return name
        for name, pattern in NON_GOVERNING_FAMILIES:
            if re.search(pattern, block, re.IGNORECASE):
                return name
    return UNCLASSIFIED


def classification_families(blocks: tuple[str, ...]) -> tuple[str, ...]:
    """문서 **전체**가 언급한 family 전부.

    `classify_document()`는 첫 일치 하나만 돌려주므로, bylaws를 먼저 말하고 charter
    amendment를 나중에 말하는 서술은 앞의 것만 남고 뒤가 조용히 사라진다. 권한이 없는
    서술이라도 무엇을 봤는지는 receipt에 남아야 한다.
    """
    found: set[str] = set()
    for block in blocks:
        for name, pattern in AMENDMENT_FAMILIES + SNAPSHOT_FAMILIES + NON_GOVERNING_FAMILIES:
            if re.search(pattern, block, re.IGNORECASE):
                found.add(name)
    return tuple(sorted(found))


# ── 명시 사실 추출 ────────────────────────────────────────────────────────────


def instrument_effective_dates(blocks: tuple[str, ...]) -> tuple[str, ...]:
    """그 instrument에 명시로 붙은 발효일 전부(중복 제거·정렬).

    **문서 수준으로 센다.** 하나면 그 instrument의 operative date이고, 둘 이상이면
    어느 것이 그 행위의 발효일인지 기계로 정할 수 없으므로 아무것도 증명하지 못한다.
    가장 가까운 날짜를 고르거나 최초/최종을 쓰지 않는다.
    """
    found: set[str] = set()
    for block in blocks:
        if _not_implemented(block):
            continue
        for _role, pattern in EFFECTIVE_DATE_PATTERNS:
            for match in re.finditer(pattern, block, re.IGNORECASE):
                iso = _iso_date(match.group("d"))
                if iso:
                    found.add(iso)
    return tuple(sorted(found))


def _matches(
    blocks: tuple[str, ...], patterns, raw_name: str
) -> tuple[tuple[int, str], ...]:
    """`(block ordinal, semantic family)` — 명시 미실행 표현이 있는 block은 뺀다."""
    out: list[tuple[int, str]] = []
    for ordinal, block in enumerate(blocks):
        if _not_implemented(block):
            continue
        for family, pattern in patterns:
            if re.search(_fill(pattern, raw_name), block, re.IGNORECASE):
                out.append((ordinal, family))
                break
    return tuple(out)


def class_definition_matches(
    blocks: tuple[str, ...], raw_name: str
) -> tuple[tuple[int, str], ...]:
    """그 **정확한** 이름을 법적으로 세우는 block들. 단순 언급은 걸리지 않는다."""
    return _matches(blocks, CLASS_DEFINITION_PATTERNS, raw_name)


def class_birth_action_matches(
    blocks: tuple[str, ...], raw_name: str
) -> tuple[tuple[int, str], ...]:
    """그 **정확한** 이름의 class를 실제로 세우는 block들.

    정의(`class_definition_matches`)와 다르다. 정의는 instrument가 서술하는 상태이고
    여기는 그 class를 만드는 **행위**다. 완전 restated instrument의 발효일이 그 안의
    모든 class의 탄생일이 되면 안 되기 때문에 둘을 가른다.
    """
    return _matches(blocks, CLASS_BIRTH_ACTION_PATTERNS, raw_name)


def class_termination_matches(
    blocks: tuple[str, ...], raw_name: str
) -> tuple[tuple[int, str], ...]:
    """그 **정확한** 이름의 class를 실제로 끝내는 block들."""
    return _matches(blocks, CLASS_TERMINATION_PATTERNS, raw_name)


# ── SEC 탐색 ─────────────────────────────────────────────────────────────────


def _items_tokens(raw: object) -> tuple[str, ...]:
    text = str(raw or "")
    return tuple(part.strip() for part in text.split(",") if part.strip())


@dataclass(frozen=True)
class AccessionDocument:
    """accession header 색인이 선언한 문서 하나."""

    document_type: str
    sequence: int | None
    filename: str
    description: str | None


_DOCUMENT_BLOCK = re.compile(
    r"<DOCUMENT>\s*<TYPE>(?P<type>[^\n<]*)"
    r"(?:\s*<SEQUENCE>(?P<sequence>[^\n<]*))?"
    r"\s*<FILENAME>(?P<filename>[^\n<]*)"
    r"(?:\s*<DESCRIPTION>(?P<description>[^\n<]*))?",
    re.IGNORECASE,
)
_HEADER_ITEMS = re.compile(r"<ITEMS>\s*([0-9]+\.[0-9]+)", re.IGNORECASE)
_DOCUMENT_OPEN = re.compile(r"<DOCUMENT>", re.IGNORECASE)


def parse_accession_header(text: str) -> tuple[tuple[str, ...], tuple[AccessionDocument, ...]]:
    """`(<ITEMS> 번호들, 선언된 문서들)`.

    **`index.json`의 `type`은 문서 종류가 아니라 아이콘 이름(`text.gif`)이다.** 문서별
    `<TYPE>`(`EX-3.1`)과 8-K `<ITEMS>`는 SGML header 색인에만 구조화돼 있다. 파일명
    규칙으로 종류를 추정하지 않는다.
    """
    import html as _html

    raw = str(text or "")
    body = _html.unescape(raw)
    items = tuple(sorted(set(_HEADER_ITEMS.findall(raw) + _HEADER_ITEMS.findall(body))))
    documents: dict[str, AccessionDocument] = {}
    for match in _DOCUMENT_BLOCK.finditer(body):
        filename = (match.group("filename") or "").strip()
        if not filename or filename in documents:
            continue
        sequence = (match.group("sequence") or "").strip()
        documents[filename] = AccessionDocument(
            document_type=(match.group("type") or "").strip(),
            sequence=int(sequence) if sequence.isdigit() else None,
            filename=filename,
            description=((match.group("description") or "").strip() or None),
        )
    return items, tuple(documents.values())


def unaddressable_document_count(text: str, documents) -> int:
    """**파일 이름 없이 선언된 문서 수.**

    2001년 이전 flat layout은 문서를 accession 디렉터리의 개별 파일로 두지 않고
    complete submission 안에 `<FILENAME>` 없이 담는다. 그런 문서는 이 공급기가
    문서 자연키로 가리킬 수 없으므로 **조용히 건너뛰지 않고 탐색 실패로 적는다** —
    0을 돌려주면 governing 후보가 없다는 뜻이 되어 거짓 COMPLETE가 난다.
    """
    import html as _html

    total = len(_DOCUMENT_OPEN.findall(_html.unescape(str(text or ""))))
    return max(0, total - len(documents))


def governing_candidates(
    documents: tuple[AccessionDocument, ...],
    *,
    form: str,
    items,
) -> tuple[tuple[str, str, str | None], ...]:
    """`(document_name, document_role, 선언된 문서 종류)` 후보들.

    discovery는 header metadata를 **힌트로** 쓴다 — 권위가 아니다. 실제 권위는 본문이
    §9의 semantic 규칙을 만족하는지다.

    ```text
    선언된 종류가 Exhibit 3 계열  -> governing exhibit 후보
    8-K이고 ITEMS에 5.03이 있다   -> 그 8-K의 primary(SEQUENCE 1) 문서도 후보
    ```

    파일명에 `charter`가 있다는 이유로 후보가 되지 않는다.
    """
    found: dict[str, tuple[str, str, str | None]] = {}
    for document in documents:
        if EXHIBIT_3_PATTERN.match(document.document_type.strip()):
            found[document.filename] = (
                document.filename,
                PRIMARY if document.sequence == 1 else EXHIBIT,
                document.document_type,
            )
    if form in EIGHT_K_FORMS and CHARTER_AMENDMENT_ITEM in tuple(items or ()):
        primary = next(
            (item for item in documents if item.sequence == 1), None
        )
        if primary is not None and primary.filename not in found:
            found[primary.filename] = (
                primary.filename, PRIMARY, primary.document_type or None
            )
    return tuple(sorted(found.values()))


def _accession_header(client, cik: str, accession: str) -> str:
    """accession의 SGML header. **2001년 이전 flat layout에는 header 파일이 없다.**

    그때는 complete submission 원문이 같은 `<DOCUMENT><TYPE><FILENAME>` 구조를 들고
    있으므로 그것으로 돈다. 그 시기 filing은 작고(실측 34KB), 최신 filing은 header
    파일이 있어 이 경로로 오지 않는다. 둘 다 실패하면 fail-close다 — 건너뛰지 않는다.
    """
    try:
        return client.accession_header_index(cik, accession)
    except Exception as error:  # noqa: BLE001 — 옛 layout이면 complete submission으로
        try:
            return client.complete_submission_text(cik, accession)
        except Exception:  # noqa: BLE001
            # 둘 다 실패하면 **원래 실패**를 그대로 올린다. 폴백이 원인을 가리면
            # receipt가 "왜 못 읽었는지"를 잃는다.
            raise error from None


def _target_names(cover_proof: CoverPageProof) -> tuple[tuple[str, str, str], ...]:
    """`(member_key, raw title, N1 key)` — **명시 표지 제목이 있는 class만.**

    제목 없는 sibling에는 anchor가 없다. XBRL member 철자로 만들어내지 않는다.
    """
    out = []
    for item in cover_proof.classes:
        title = str(item.security_title or "").strip()
        if not title:
            continue
        out.append((item.member_key, title, prose_key(title)))
    return tuple(out)


def collect_legal_evidence(
    client,
    *,
    cik: str,
    cover_proof: CoverPageProof,
) -> LegalEvidenceProof:
    """선언된 지평 전체를 훑어 구조화된 법적 증명을 만든다. **SEC를 부른다.**

    실패는 조용히 건너뛰지 않는다. submissions archive · accession index · 후보 문서
    fetch · 분류 불가 후보가 하나라도 있으면 `search_status = INCOMPLETE`이고, 그
    상태로는 어떤 구간도 나오지 않는다.
    """
    registrant = normalize_cik(cik)
    if registrant is None:
        raise QVLegalEvidenceError(f"CIK가 아닙니다: {cik!r}")
    targets = _target_names(cover_proof)

    failures: list[tuple[str, str]] = []
    documents: list[LegalDocument] = []
    blocks_by_key: dict[tuple[str, str, str], tuple[str, ...]] = {}
    searched: list[str] = []
    outside = 0

    try:
        rows = _submission_rows_from_sec(client, registrant, forms=None)
    except Exception as error:  # noqa: BLE001 — 탐색 실패는 INCOMPLETE 사유다
        return LegalEvidenceProof(
            cik=registrant,
            cover_accession=cover_proof.accession,
            cover_document_name=cover_proof.document_name,
            search_status=INCOMPLETE,
            horizon_forms=tuple(sorted(GOVERNING_SEARCH_FORMS)),
            searched_accessions=(),
            accessions_outside_horizon=0,
            documents=(),
            failures=((f"submissions:{registrant}", f"{type(error).__name__}: {error}"),),
            classes=tuple(
                ClassLegalProof(
                    member_key=member, raw_target_name=raw, target_name_key=key,
                    status=INCOMPLETE, birth_date=None, termination_date=None,
                    open_ended=False, snapshot_accession=None,
                    snapshot_document_name=None, findings=(),
                    notes=("submissions 이력을 읽지 못했다",),
                )
                for member, raw, key in targets
            ),
        )

    horizon = []
    for row in rows:
        if row.form in GOVERNING_SEARCH_FORMS:
            horizon.append(row)
        else:
            outside += 1
    horizon.sort(key=lambda row: (row.acceptance_eastern_date or row.filed_date, row.accession))

    for row in horizon:
        searched.append(row.accession)
        try:
            header = _accession_header(client, registrant, row.accession)
            header_items, declared = parse_accession_header(header)
            # header의 `<ITEMS>`가 정본이고, 없으면 submissions row의 값으로 돈다.
            candidates = governing_candidates(
                declared,
                form=row.form,
                items=header_items or _items_tokens(getattr(row, "items", None)),
            )
        except Exception as error:  # noqa: BLE001
            failures.append((f"index:{row.accession}", f"{type(error).__name__}: {error}"))
            continue
        unaddressable = unaddressable_document_count(header, declared)
        if unaddressable:
            failures.append((
                f"legacy_layout:{row.accession}",
                f"파일 이름 없이 선언된 문서가 {unaddressable}건이다 — 2001년 이전 "
                "flat layout이라 문서 자연키로 가리킬 수 없다",
            ))
            continue
        # **Item 5.03은 정관이 바뀌었다는 구조화된 신고다.** 그 accession에 주소를
        # 지정할 수 있는 Exhibit 3이 하나도 없으면 그 governing 변경을 읽을 길이 없다.
        # primary 서술로 대신하지 않고 탐색 실패로 적는다.
        if (
            row.form in EIGHT_K_FORMS
            and CHARTER_AMENDMENT_ITEM in (
                header_items or _items_tokens(getattr(row, "items", None))
            )
            and not any(
                document_proof_authority(document_type) == GOVERNING_EXHIBIT
                for _name, _role, document_type in candidates
            )
        ):
            failures.append((
                f"governing_exhibit_missing:{row.accession}",
                "Item 5.03 8-K인데 주소 지정 가능한 Exhibit 3 문서가 없다 — primary "
                "서술은 governing instrument가 아니다",
            ))

        for name, role, document_type in candidates:
            try:
                payload = client.accession_file_bytes(registrant, row.accession, name)
            except Exception as error:  # noqa: BLE001
                failures.append((
                    f"document:{row.accession}/{name}",
                    f"{type(error).__name__}: {error}",
                ))
                continue
            blocks = html_blocks(payload)
            classification = classify_document(blocks)
            authority = document_proof_authority(document_type)
            document = LegalDocument(
                cik=registrant,
                accession=row.accession,
                form=row.form,
                document_name=name,
                document_role=role,
                document_type=document_type,
                acceptance_datetime=row.acceptance_datetime,
                source_url=accession_dir_url(registrant, row.accession) + "/" + name,
                document_sha256=sha256(payload),
                classification=classification,
                proof_authority=authority,
                classification_families=classification_families(blocks),
            )
            documents.append(document)
            blocks_by_key[document.key] = blocks
            # 분류 실패는 **증명 권한이 있는 문서**에만 탐색 실패다. 권한 없는 서술이
            # 열거된 family에 안 맞는 것은 그 자체로 증거 공백이 아니다 — 진짜 공백은
            # 위의 `governing_exhibit_missing`이 잡는다.
            if classification == UNCLASSIFIED and authority == GOVERNING_EXHIBIT:
                failures.append((
                    f"classify:{row.accession}/{name}",
                    "governing 후보를 열거된 family로 분류하지 못했다",
                ))

    search_status = INCOMPLETE if failures else COMPLETE
    classes = tuple(
        _assess_class(
            member_key=member,
            raw_name=raw,
            name_key=key,
            documents=tuple(documents),
            blocks_by_key=blocks_by_key,
            search_status=search_status,
        )
        for member, raw, key in targets
    )
    return LegalEvidenceProof(
        cik=registrant,
        cover_accession=cover_proof.accession,
        cover_document_name=cover_proof.document_name,
        search_status=search_status,
        horizon_forms=tuple(sorted(GOVERNING_SEARCH_FORMS)),
        searched_accessions=tuple(searched),
        accessions_outside_horizon=outside,
        documents=tuple(documents),
        failures=tuple(sorted(failures)),
        classes=classes,
    )


# ── 명시 사실 → 구간 (하나의 규칙, 두 곳에서 쓴다) ───────────────────────────
#
# **생성기와 승격기가 같은 함수를 쓴다.** 둘이 각자 법 규칙을 들고 있으면 조용히
# 갈라지고, 그러면 승격 재검증이 아무것도 확인하지 못한다.


def _document_order(document: dict) -> tuple:
    return (
        str(document.get("acceptance_datetime") or ""),
        str(document.get("accession") or ""),
        str(document.get("document_name") or ""),
    )


def _finding_document(finding: dict) -> tuple[str, str]:
    return (
        str(finding.get("accession") or ""),
        str(finding.get("document_name") or ""),
    )


def project_class_proof(
    class_entry: dict, documents: list[dict], *, search_ok: bool
) -> dict:
    """구조화된 finding에서 **구간 결론을 다시 계산한다.**

    저장된 `status` · `birth_date` · `termination_date` · `open_ended`를 권한으로 삼지
    않는다 — 그것들이 바로 이 함수의 산출물이고, 누가 packet에서 고쳐도 여기서 다시
    계산한 값과 달라진다.

    ```text
    B2  탄생만으로는 effective_to = null이 되지 않는다
        탄생 + current-in-effect 완전 snapshot + 탐색 COMPLETE + 미해결 영향 없음
    ```
    """
    target = str(class_entry.get("target_name_key") or "")
    findings = [item for item in (class_entry.get("findings") or [])
                if isinstance(item, dict) and str(item.get("class_name_key") or "") == target]
    definitions = [item for item in findings
                   if item.get("finding_kind") == GOVERNING_CLASS_DEFINITION]
    birth_actions = [item for item in findings
                     if item.get("finding_kind") == CLASS_BIRTH_ACTION]
    birth_dates = [item for item in findings
                   if item.get("finding_kind") == CLASS_BIRTH_EFFECTIVE_DATE
                   and item.get("effective_date")]
    terminations = [item for item in findings
                    if item.get("finding_kind") == CLASS_TERMINATION_EFFECTIVE_DATE
                    and item.get("effective_date")]

    blank = {
        "status": UNRESOLVED, "birth_date": None, "termination_date": None,
        "open_ended": False, "snapshot_accession": None,
        "snapshot_document_name": None, "birth_definition": None,
        "birth_action": None, "birth_date_finding": None,
        "snapshot_definition": None, "termination_finding": None, "notes": (),
    }
    if not search_ok:
        return {**blank, "status": INCOMPLETE,
                "notes": ("필요한 SEC 탐색이 닫히지 않았다",)}

    # ── A. 탄생 — 정확히 하나 ────────────────────────────────────────────────
    distinct_births = sorted({str(item["effective_date"]) for item in birth_dates})
    if not distinct_births:
        return {**blank, "notes": (
            "그 class를 세우는 **명시 실행 행위**와 거기 묶인 명시 발효일이 한 "
            "instrument에서 함께 증명되지 않았다 — 정의만으로는 탄생이 아니고, 완전 "
            "restated instrument의 발효일도 그 안의 class 탄생일이 아니다",
        )}
    if len(distinct_births) > 1:
        return {**blank, "notes": (
            "탄생일이 서로 다른 governing 문서에서 충돌한다: " + ", ".join(distinct_births),
        )}
    birth = distinct_births[0]
    birth_date_finding = sorted(
        (item for item in birth_dates if str(item["effective_date"]) == birth),
        key=lambda item: (_finding_document(item), str(item.get("locator") or "")),
    )[0]
    birth_document = _finding_document(birth_date_finding)
    birth_definition = sorted(
        (item for item in definitions if _finding_document(item) == birth_document),
        key=lambda item: str(item.get("locator") or ""),
    )
    if not birth_definition:
        return {**blank, "notes": ("탄생일 문서가 그 class를 명시로 정의하지 않는다",)}
    birth_action = sorted(
        (item for item in birth_actions if _finding_document(item) == birth_document),
        key=lambda item: str(item.get("locator") or ""),
    )
    if not birth_action:
        return {**blank, "notes": (
            "탄생일 문서에 그 class를 세우는 명시 실행 행위가 없다 — instrument 발효일을 "
            "class 탄생일로 쓰지 않는다",
        )}

    # ── E. 명시 종료가 있으면 그것이 끝이다 ─────────────────────────────────
    distinct_terminations = sorted({str(item["effective_date"]) for item in terminations})
    if len(distinct_terminations) > 1:
        return {**blank, "notes": (
            "종료일이 충돌한다: " + ", ".join(distinct_terminations),
        )}
    if distinct_terminations:
        end = distinct_terminations[0]
        if end <= birth:
            return {**blank, "notes": (
                f"명시 종료일이 탄생일보다 늦지 않다: {birth}..{end}",
            )}
        termination_finding = sorted(
            (item for item in terminations if str(item["effective_date"]) == end),
            key=lambda item: (_finding_document(item), str(item.get("locator") or "")),
        )[0]
        return {
            "status": COMPLETE, "birth_date": birth, "termination_date": end,
            "open_ended": False, "snapshot_accession": None,
            "snapshot_document_name": None,
            "birth_definition": birth_definition[0],
            "birth_action": birth_action[0],
            "birth_date_finding": birth_date_finding,
            "snapshot_definition": None,
            "termination_finding": termination_finding,
            "notes": ("명시 실행 종료 행위와 명시 발효일이 유한 구간을 만든다",),
        }

    # ── B. current-in-effect 완전 governing snapshot ────────────────────────
    #
    # **증명 권한이 있는 문서만 센다.** Item 5.03 primary 서술은 그 본문이 무엇을
    # 말하든 governing instrument가 아니다. 저장된 `proof_authority` 칸이 아니라
    # `document_type`에서 같은 공유 helper로 다시 계산한다.
    governing = [
        item for item in documents
        if document_proof_authority(item.get("document_type")) == GOVERNING_EXHIBIT
    ]
    snapshots = sorted(
        (item for item in governing
         if str(item.get("classification") or "") in SNAPSHOT_CLASSIFICATIONS),
        key=_document_order,
    )
    if not snapshots:
        return {**blank, "birth_date": birth, "notes": (
            "current-in-effect 완전 governing snapshot이 없다 — 탄생만으로는 "
            "effective_to = null이 되지 않는다",
        )}
    current = snapshots[-1]
    current_key = (str(current.get("accession") or ""), str(current.get("document_name") or ""))

    # **amendment는 complete snapshot이 아니다.** 가장 늦은 완전 snapshot 뒤에
    # governing amendment가 하나라도 있으면 그 snapshot은 현재 상태를 닫지 못한다.
    # 그 amendment가 대상 class 정의를 되풀이한다는 이유로 snapshot을 "현재"로
    # 올려주지 않는다 — 그러면 amendment를 complete snapshot으로 승격하는 셈이다.
    # 나중에 그 상태를 흡수한 완전 restated snapshot이 나와야 열린다.
    later_amendments = sorted(
        f"{item.get('accession')}/{item.get('document_name')}"
        for item in governing
        if str(item.get("classification") or "") in AMENDMENT_CLASSIFICATIONS
        and _document_order(item) > _document_order(current)
    )
    if later_amendments:
        return {**blank, "birth_date": birth, "notes": (
            "가장 늦은 완전 governing snapshot 뒤에 governing amendment가 있다 — "
            "그 snapshot은 current-in-effect 상태를 닫지 못한다: "
            + ", ".join(later_amendments),
        )}

    snapshot_definition = sorted(
        (item for item in definitions if _finding_document(item) == current_key),
        key=lambda item: str(item.get("locator") or ""),
    )
    if not snapshot_definition:
        return {**blank, "birth_date": birth, "notes": (
            "current governing snapshot이 그 정확한 class 이름을 정의하지 않는다",
        )}

    # ── D. 탄생 이후 모든 governing 후보의 영향이 해소돼야 한다 ─────────────
    #
    # **대상 class 이름이 없다는 것은 영향이 없다는 증명이 아니다.** 그래서 탄생 뒤의
    # governing 문서는 그 class를 명시로 정의해야만 해소된 것으로 센다.
    order_of = {
        (str(item.get("accession") or ""), str(item.get("document_name") or "")):
        _document_order(item)
        for item in documents
    }
    birth_order = order_of.get(birth_document)
    defined_keys = {_finding_document(item) for item in definitions}
    unresolved_changes = sorted(
        f"{item.get('accession')}/{item.get('document_name')}"
        for item in governing
        if str(item.get("classification") or "") in GOVERNING_CLASSIFICATIONS
        and birth_order is not None
        and _document_order(item) > birth_order
        and (str(item.get("accession") or ""), str(item.get("document_name") or ""))
        not in defined_keys
    )
    if unresolved_changes:
        return {**blank, "birth_date": birth, "notes": (
            "탄생 이후 governing 후보의 class 영향이 해소되지 않았다: "
            + ", ".join(unresolved_changes),
        )}

    return {
        "status": COMPLETE, "birth_date": birth, "termination_date": None,
        "open_ended": True,
        "snapshot_accession": current_key[0],
        "snapshot_document_name": current_key[1],
        "birth_definition": birth_definition[0],
        "birth_action": birth_action[0],
        "birth_date_finding": birth_date_finding,
        "snapshot_definition": snapshot_definition[0],
        "termination_finding": None,
        "notes": (
            "탄생 · current 완전 snapshot · COMPLETE 탐색 · 미해결 영향 없음",
        ),
    }


def _effective_date_hits(blocks: tuple[str, ...]) -> tuple[tuple[int, str], ...]:
    """`(block ordinal, ISO date)` — instrument에 명시로 붙은 발효일 위치."""
    out: list[tuple[int, str]] = []
    for ordinal, block in enumerate(blocks):
        if _not_implemented(block):
            continue
        for _role, pattern in EFFECTIVE_DATE_PATTERNS:
            for match in re.finditer(pattern, block, re.IGNORECASE):
                iso = _iso_date(match.group("d"))
                if iso and (ordinal, iso) not in out:
                    out.append((ordinal, iso))
    return tuple(out)


def _class_findings(
    *,
    raw_name: str,
    name_key: str,
    documents: tuple[LegalDocument, ...],
    blocks_by_key: dict,
) -> tuple[LegalFinding, ...]:
    """governing 문서에서 그 정확한 class 이름에 대한 명시 사실만 모은다."""
    findings: list[LegalFinding] = []
    for document in documents:
        # **filing 서술은 governing instrument가 아니다.** 첨부된 instrument 이름을
        # 말한다는 이유로 economic identity 사실을 만들지 않는다.
        if document.proof_authority != GOVERNING_EXHIBIT:
            continue
        if document.classification not in GOVERNING_CLASSIFICATIONS:
            continue
        blocks = blocks_by_key.get(document.key, ())
        definitions = class_definition_matches(blocks, raw_name)
        for ordinal, family in definitions:
            findings.append(LegalFinding(
                finding_kind=GOVERNING_CLASS_DEFINITION,
                accession=document.accession,
                document_name=document.document_name,
                locator=f"block:{ordinal}",
                class_name_key=name_key,
                raw_class_name=raw_name,
                semantic_family=family,
            ))
        # **탄생 행위는 정의와 별개로 명시돼야 한다.** 완전 restated instrument가 그
        # class를 정의하고 스스로 D에 발효한다는 것만으로는 탄생이 아니다.
        birth_actions = class_birth_action_matches(blocks, raw_name)
        for ordinal, family in birth_actions:
            findings.append(LegalFinding(
                finding_kind=CLASS_BIRTH_ACTION,
                accession=document.accession,
                document_name=document.document_name,
                locator=f"block:{ordinal}",
                class_name_key=name_key,
                raw_class_name=raw_name,
                semantic_family=family,
            ))

        hits = _effective_date_hits(blocks)
        distinct = sorted({iso for _ordinal, iso in hits})
        # **instrument의 발효일이 정확히 하나일 때만** 그 행위의 경제적 발효일이다.
        # 가장 가까운 날짜를 고르거나 최초/최종을 쓰지 않는다.
        if len(distinct) != 1:
            continue
        ordinal = min(item for item, iso in hits if iso == distinct[0])
        # 명시 탄생 행위가 있는 문서에서만 그 발효일이 탄생일 후보가 된다.
        if birth_actions:
            findings.append(LegalFinding(
                finding_kind=CLASS_BIRTH_EFFECTIVE_DATE,
                accession=document.accession,
                document_name=document.document_name,
                locator=f"block:{ordinal}",
                class_name_key=name_key,
                raw_class_name=raw_name,
                semantic_family="INSTRUMENT_EFFECTIVE_DATE",
                effective_date=distinct[0],
            ))
        for block_ordinal, family in class_termination_matches(blocks, raw_name):
            findings.append(LegalFinding(
                finding_kind=CLASS_TERMINATION_EFFECTIVE_DATE,
                accession=document.accession,
                document_name=document.document_name,
                locator=f"block:{block_ordinal}",
                class_name_key=name_key,
                raw_class_name=raw_name,
                semantic_family=family,
                effective_date=distinct[0],
            ))
    return tuple(findings)


def _assess_class(
    *,
    member_key: str,
    raw_name: str,
    name_key: str,
    documents: tuple[LegalDocument, ...],
    blocks_by_key: dict,
    search_status: str,
) -> ClassLegalProof:
    """한 표지 class의 법적 증명. **결론은 `project_class_proof`가 낸다.**"""
    findings = _class_findings(
        raw_name=raw_name, name_key=name_key,
        documents=documents, blocks_by_key=blocks_by_key,
    )
    entry = {
        "target_name_key": name_key,
        "findings": [item.as_json() for item in findings],
    }
    projected = project_class_proof(
        entry, [item.as_json() for item in documents],
        search_ok=search_status == COMPLETE,
    )
    return ClassLegalProof(
        member_key=member_key,
        raw_target_name=raw_name,
        target_name_key=name_key,
        status=projected["status"],
        birth_date=projected["birth_date"],
        termination_date=projected["termination_date"],
        open_ended=bool(projected["open_ended"]),
        snapshot_accession=projected["snapshot_accession"],
        snapshot_document_name=projected["snapshot_document_name"],
        findings=findings,
        notes=tuple(projected["notes"]),
    )


# ── 구조화된 proof → 기존 ClassEvidence ──────────────────────────────────────


def _ref(finding: dict, *, cik: str, role: str) -> EvidenceRef:
    return EvidenceRef(
        source_kind=SEC_EVIDENCE_DOCUMENT,
        cik=cik,
        accession=str(finding.get("accession") or ""),
        document_name=str(finding.get("document_name") or ""),
        evidence_role=role,
        dependency="REQUIRED",
        locator=str(finding.get("locator") or ""),
    )


# ── 정규 직렬화와 비교 — **정의가 하나여야 한다** ────────────────────────────
#
# production 행은 나중에 packet의 구간 증거를 합쳐 넣고, 5A-3는 그 REQUIRED 자연키에서
# `usable_from_session`을 파생시킨다. 그래서 날짜만 맞춰 보면 **같은 구간에 다른
# 증거를 끼워 넣는 변조**가 통과한다. 승격 재검증은 provenance까지 본다.


def canonical_evidence_refs(items) -> list[dict]:
    """증거 참조 목록의 결정론적 정규형. **순서만 정규화하고 내용은 손대지 않는다.**

    중복을 지우지 않는다 — 하나를 지우면 치환을 못 잡는다.
    """
    out = []
    for item in items or []:
        if not isinstance(item, dict):
            raise QVLegalEvidenceError("증거 항목이 객체가 아닙니다")
        locator = item.get("locator")
        out.append({
            "source_kind": str(item.get("source_kind") or ""),
            "cik": str(item.get("cik") or ""),
            "accession": str(item.get("accession") or ""),
            "document_name": str(item.get("document_name") or ""),
            "evidence_role": str(item.get("evidence_role") or ""),
            "dependency": str(item.get("dependency") or ""),
            "locator": "" if locator in (None, "") else str(locator),
        })
    return sorted(out, key=lambda row: tuple(sorted(row.items())))


def canonical_interval(payload: dict | None) -> dict | None:
    """직렬화된 구간 하나의 정규형 — 경계 **와** 증거 provenance."""
    if payload is None:
        return None
    if not isinstance(payload, dict):
        raise QVLegalEvidenceError("구간이 객체가 아닙니다")
    end = payload.get("effective_to")
    return {
        "effective_from": str(payload.get("effective_from") or ""),
        "effective_to": None if end in (None, "") else str(end),
        "evidence": canonical_evidence_refs(payload.get("evidence")),
    }


def canonical_class_evidence(evidence: ClassEvidence) -> dict:
    """`ClassEvidence` 하나의 정규형. 승격 재검증이 이 모양으로 대조한다."""
    return {
        "class_interval": canonical_interval(
            evidence.class_interval.as_json() if evidence.class_interval else None
        ),
        "cover_title_interval": canonical_interval(
            evidence.cover_title_interval.as_json()
            if evidence.cover_title_interval else None
        ),
        "extra_prose_bridges": sorted(
            (
                {
                    "bridge_type": item.bridge_type,
                    "prose_key": prose_key(item.raw_prose_name),
                    "interval": canonical_interval(
                        item.interval.as_json() if item.interval else None
                    ),
                }
                for item in evidence.extra_prose_bridges
            ),
            key=lambda row: (row["bridge_type"], row["prose_key"]),
        ),
    }


def assert_proof_integrity(payload: dict, *, cover_proof: CoverPageProof) -> None:
    """구조화된 proof가 **그 표지 증명에 실제로 속하는지** 본다.

    다른 등록인의 proof나 다른 표지의 proof를 끼워 넣으면 finding은 그대로인데
    class가 엉뚱한 발행사에 붙는다. finding이 receipt에 없는 문서를 가리키는 것도
    막는다 — 그러면 5A-3가 맞춰 볼 자연키가 없는 증거가 production으로 새어 나간다.

    **네트워크를 부르지 않는다.** 문서 SHA를 실제 SEC 문서와 맞춰 보는 것은 5A-3다.
    """
    if not isinstance(payload, dict):
        raise QVLegalEvidenceError("legal_evidence_proof가 객체가 아닙니다")
    cik = normalize_cik(payload.get("cik"))
    if cik is None or cik != normalize_cik(cover_proof.cik):
        raise QVLegalEvidenceError(
            f"legal proof CIK가 표지 증명과 다릅니다: {payload.get('cik')!r} != "
            f"{cover_proof.cik}"
        )
    if str(payload.get("cover_accession") or "") != cover_proof.accession:
        raise QVLegalEvidenceError(
            "legal proof의 cover accession이 표지 증명과 다릅니다: "
            f"{payload.get('cover_accession')!r} != {cover_proof.accession}"
        )
    if str(payload.get("cover_document_name") or "") != cover_proof.document_name:
        raise QVLegalEvidenceError(
            "legal proof의 cover 문서가 표지 증명과 다릅니다: "
            f"{payload.get('cover_document_name')!r} != {cover_proof.document_name}"
        )
    known = {
        (str(item.get("accession") or ""), str(item.get("document_name") or ""))
        for item in (payload.get("documents") or []) if isinstance(item, dict)
    }
    for entry in payload.get("classes") or []:
        if not isinstance(entry, dict):
            raise QVLegalEvidenceError("legal proof class 항목이 객체가 아닙니다")
        for finding in entry.get("findings") or []:
            if not isinstance(finding, dict):
                raise QVLegalEvidenceError("legal proof finding이 객체가 아닙니다")
            key = _finding_document(finding)
            if key not in known:
                raise QVLegalEvidenceError(
                    "finding이 receipt에 없는 문서를 가리킵니다: "
                    f"{key[0]}/{key[1]}"
                )


def class_evidence_from_legal_proof(
    payload: dict, *, cover_proof: CoverPageProof
) -> dict[str, ClassEvidence]:
    """구조화된 법적 증명에서 `ClassEvidence`를 파생시킨다. **순수 함수다.**

    5A-2 제안 생성과 5A-2c 승격 재검증이 **이 함수 하나**를 쓴다. 네트워크를 부르지
    않고, 저장된 결론 칸(`status` · `birth_date` · `search_status`)을 믿지 않는다 —
    `documents` · `findings` · `failures`에서 다시 계산한다.

    **명시로 세우지 못한 것은 `None`으로 남는다.** 기본값을 채우거나 sibling의 증거를
    복사하지 않는다.

    anchor는 정확한 N1 동일성 하나다. 표지 제목과 legal proof의 대상 이름이 N1으로
    같지 않으면 그 class는 조용히 빠진다 — 사람 눈에 아무리 비슷해도 잇지 않는다.
    """
    assert_proof_integrity(payload, cover_proof=cover_proof)
    cik = normalize_cik(payload.get("cik"))
    documents = [item for item in (payload.get("documents") or []) if isinstance(item, dict)]
    # **탐색 상태도 구조에서 다시 계산한다.** `search_status` 칸을 COMPLETE로 고쳐도
    # 실패가 하나라도 박혀 있으면 여기서 아무 구간도 나오지 않는다.
    search_ok = not (payload.get("failures") or [])

    by_member = {item.member_key: item for item in cover_proof.classes}
    out: dict[str, ClassEvidence] = {}
    for entry in payload.get("classes") or []:
        if not isinstance(entry, dict):
            raise QVLegalEvidenceError("legal proof class 항목이 객체가 아닙니다")
        member_key = str(entry.get("member_key") or "")
        cover_class = by_member.get(member_key)
        if cover_class is None or not cover_class.security_title:
            continue
        target = str(entry.get("target_name_key") or "")
        if not target or prose_key(cover_class.security_title) != target:
            # anchor가 정확한 N1 동일성이 아니다. 유사도로 잇지 않는다.
            continue

        projected = project_class_proof(entry, documents, search_ok=search_ok)
        if projected["status"] != COMPLETE:
            continue

        birth = str(projected["birth_date"])
        definition = projected["birth_definition"]
        birth_date_finding = projected["birth_date_finding"]
        interval_evidence = [
            _ref(definition, cik=cik, role=GOVERNING_CLASS_DEFINITION),
            _ref(projected["birth_action"], cik=cik, role=CLASS_BIRTH_ACTION),
            _ref(birth_date_finding, cik=cik, role=CLASS_BIRTH_EFFECTIVE_DATE),
        ]
        title_interval = None
        if projected["open_ended"]:
            snapshot = projected["snapshot_definition"]
            interval_evidence.append(
                _ref(snapshot, cik=cik, role=CURRENT_GOVERNING_SNAPSHOT)
            )
            # **prose alias 수명은 class 수명과 다른 사실이다.** class 구간을 복사하지
            # 않는다 — 같은 정확한 N1 이름이 탄생 정의와 current 완전 snapshot 양쪽에
            # 있고 탐색이 닫혔다는 **독립된** 법적 사슬이 이 구간을 만든다.
            title_interval = RelationInterval(
                birth, None,
                (
                    _ref(definition, cik=cik, role=PROSE_ALIAS_LIFETIME),
                    _ref(snapshot, cik=cik, role=PROSE_ALIAS_LIFETIME),
                ),
            )
            end = None
        else:
            interval_evidence.append(
                _ref(projected["termination_finding"], cik=cik,
                     role=CLASS_TERMINATION_EFFECTIVE_DATE)
            )
            end = str(projected["termination_date"])

        out[member_key] = ClassEvidence(
            class_interval=RelationInterval(birth, end, tuple(interval_evidence)),
            cover_title_interval=title_interval,
            # 표지 제목과 governing 이름이 exact N1으로 같으므로 별도
            # `GOVERNING_INSTRUMENT` 행은 **중복 production row**일 뿐이다.
            # provenance만 다른 행을 늘리지 않는다.
            extra_prose_bridges=(),
        )
    return out
