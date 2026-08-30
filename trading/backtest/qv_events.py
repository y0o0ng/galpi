"""share-basis 기업행동 — 탐색 coverage · 원시 후보 · class 효과를 분리한다.

세 개념을 절대 한 표에 섞지 않는다.

    qv_share_basis_searches        탐색 coverage/closure
    qv_share_basis_candidates      발견·추출된 원시 공시 후보
    qv_share_basis_class_effects   대상 class에 대한 semantic 효과

fuzzy·LLM·embedding·점수·토큰 창 절단·최근접 숫자/날짜 휴리스틱을 쓰지 않는다.
결과를 보고 recall/precision을 조정하지 않는다.
"""

from __future__ import annotations

import json
import re
import sqlite3
import unicodedata
from dataclasses import dataclass
from html.parser import HTMLParser

NOT_SEARCHED = "NOT_SEARCHED"
COMPLETE = "COMPLETE"
INCOMPLETE = "INCOMPLETE"

CURRENT_EVENT = "CURRENT_EVENT"
EXCLUDED_NOT_IMPLEMENTED = "EXCLUDED_NOT_IMPLEMENTED"
EXCLUDED_OUT_OF_WINDOW = "EXCLUDED_OUT_OF_WINDOW"
UNRESOLVED = "UNRESOLVED"

SHARE_BASIS_CHANGE_CONFIRMED = "SHARE_BASIS_CHANGE_CONFIRMED"
NO_SHARE_BASIS_EFFECT_CONFIRMED = "NO_SHARE_BASIS_EFFECT_CONFIRMED"

ORIGINAL_FORMS = frozenset({"10-K", "10-Q"})
AMENDMENT_FORMS = frozenset({"10-K/A", "10-Q/A"})
SEARCHABLE_FORMS = ORIGINAL_FORMS | AMENDMENT_FORMS

# share-side transition으로 쓸 수 있는 역할. DECLARED/RECORD는 금지다.
SHARE_SIDE_ROLES = ("EFFECTIVE", "DISTRIBUTION")

BLOCK_TAGS = frozenset(
    {"p", "div", "td", "th", "li", "tr", "table", "section", "h1", "h2", "h3", "h4"}
)


class QVEventsError(Exception):
    """기업행동 계약을 벗어날 때 올린다."""


class _ScopeUnresolved(Exception):
    """class scope 이름을 PIT alias로 풀지 못했다."""


# ── HTML block 분해 ──────────────────────────────────────────────────────────


class _BlockExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.blocks: list[str] = []
        self._buffer: list[str] = []
        self._skip = 0

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style"):
            self._skip += 1
        elif tag in BLOCK_TAGS:
            self._flush()

    def handle_endtag(self, tag):
        if tag in ("script", "style"):
            self._skip = max(0, self._skip - 1)
        elif tag in BLOCK_TAGS:
            self._flush()

    def handle_data(self, data):
        if not self._skip:
            self._buffer.append(data)

    def _flush(self):
        text = " ".join("".join(self._buffer).split())
        if text:
            self.blocks.append(text)
        self._buffer = []

    def close(self):
        super().close()
        self._flush()


def html_blocks(document: bytes | str) -> tuple[str, ...]:
    """block 수준 구조로 문서를 자른다. 토큰 창으로 자르지 않는다."""
    text = document.decode("utf-8", "replace") if isinstance(document, bytes) else document
    parser = _BlockExtractor()
    parser.feed(text)
    parser.close()
    normalized = []
    for block in parser.blocks:
        clean = unicodedata.normalize("NFKC", block).replace(" ", " ")
        clean = " ".join(clean.split())
        if clean:
            normalized.append(clean)
    return tuple(normalized)


# ── 명시 semantic family ──────────────────────────────────────────────────────

_RATIO_WORD = r"(?:one|two|three|four|five|six|seven|eight|nine|ten|fifteen|twenty|fifty|hundred)"
_RATIO_NUM = r"(?:\d{1,4}(?:\.\d+)?)"
_RATIO_TOKEN = rf"(?:{_RATIO_NUM}|{_RATIO_WORD})"

RATIO_PATTERNS = (
    rf"\b{_RATIO_TOKEN}\s*[- ]\s*for\s*[- ]\s*{_RATIO_TOKEN}\b",
    r"\b\d{1,4}\s*%\s*(?:common\s+)?stock\s+dividend\b",
    rf"\bdividend of {_RATIO_TOKEN} additional shares?\b",
    rf"\b{_RATIO_TOKEN} additional shares? for (?:each|every) share\b",
    rf"\breceived {_RATIO_TOKEN} additional shares?\b",
    rf"\b{_RATIO_TOKEN} shares? of [^.]{{0,60}}? for (?:each|every) share\b",
)

DISCOVERY_FAMILIES = {
    "STOCK_SPLIT": (r"\bstock split\b", r"\bsplit of (?:its|our|the) [^.]{0,40}\bstock\b"),
    "REVERSE_SPLIT": (r"\breverse stock split\b", r"\breverse split\b"),
    "STOCK_DIVIDEND": (r"\bstock dividend\b", r"\bcommon stock dividend\b"),
    "SUBDIVISION": (r"\bsubdivision\b", r"\bsubdivid(?:e|ed|ing)\b"),
    "CONSOLIDATION": (r"\bconsolidation of (?:the )?(?:issued )?shares\b", r"\bshare consolidation\b"),
    "RECAPITALIZATION": (r"\brecapitalization\b", r"\breclassification\b"),
}

# 실행되지 않았음을 **명시**하는 표현만 제외 근거가 된다.
NOT_IMPLEMENTED_PATTERNS = (
    r"\bproposal\b",
    r"\bproposed\b",
    r"\bsubject to (?:the )?approval\b",
    r"\bhas not been implemented\b",
    r"\bwas not implemented\b",
    r"\bno assurance\b",
    r"\bintends to\b",
    r"\bto be determined by (?:our|the) board\b",
    r"\babandoned\b",
    r"\bwithdrawn\b",
)

DATE_ROLE_PATTERNS = (
    ("TRADING_SPLIT_ADJUSTED", r"(?:began|begin|commenced) trading[^.]{0,60}?split[- ]adjusted[^.]{0,40}?on\s+(?P<d>[A-Z][a-z]+ \d{1,2}, \d{4})"),
    ("TRADING_SPLIT_ADJUSTED", r"trading[^.]{0,40}on a split[- ]adjusted basis on\s+(?P<d>[A-Z][a-z]+ \d{1,2}, \d{4})"),
    ("EFFECTIVE", r"effective (?:date of|on)\s+(?P<d>[A-Z][a-z]+ \d{1,2}, \d{4})"),
    ("EFFECTIVE", r"became effective on\s+(?P<d>[A-Z][a-z]+ \d{1,2}, \d{4})"),
    ("EFFECTIVE", r"\bon\s+(?P<d>[A-Z][a-z]+ \d{1,2}, \d{4})[^.]{0,40}?\beffective\b"),
    ("DISTRIBUTION", r"(?:distributed|payable|paid|issued)\s+on\s+(?P<d>[A-Z][a-z]+ \d{1,2}, \d{4})"),
    ("RECORD", r"record date[^.]{0,20}?(?:of|was)\s+(?P<d>[A-Z][a-z]+ \d{1,2}, \d{4})"),
    ("RECORD", r"shareholders of record as of\s+(?P<d>[A-Z][a-z]+ \d{1,2}, \d{4})"),
    ("DECLARED", r"(?:declared|approved|announced)[^.]{0,40}?on\s+(?P<d>[A-Z][a-z]+ \d{1,2}, \d{4})"),
    ("DECLARED", r"On\s+(?P<d>[A-Z][a-z]+ \d{1,2}, \d{4})[^.]{0,60}?(?:declared|approved|announced)"),
)

_MONTHS = {
    m: i
    for i, m in enumerate(
        ["January","February","March","April","May","June","July","August",
         "September","October","November","December"], 1)
}

# 명시적으로 "이 class는 영향받지 않는다"를 말하는 표현만 negative scope가 된다.
# 형제 class가 긍정으로 지목됐다는 사실은 negative 증거가 아니다.
#
# 표현을 **문법 방향**으로 둘로 가른다. 실제 공시가 두 모양을 모두 쓴다.
#
#   OBJECT형 : "The Class B stock split had no effect on ... Class A common shares"
#              -> 영향받지 않는 class가 표현 **뒤에** 온다
#   SUBJECT형: "Holders of class B and C common stock did not receive a stock dividend"
#              -> 영향받지 않는 class가 표현 **앞에** 온다
#
# 점수를 매기지 않는다. 목록에 없는 표현은 negative 증거가 아니다.
NEGATIVE_SCOPE_OBJECT_PATTERNS = (
    r"had no effect on",
    r"has no effect on",
    r"no (?:change|effect) (?:in|to|on)",
    r"not applicable to",
    r"exclud(?:es|ed|ing)",
)
NEGATIVE_SCOPE_SUBJECT_PATTERNS = (
    r"did not (?:receive|participate|apply|change)",
    r"(?:was|were|is|are) not (?:affected|subject to|entitled|changed)",
    r"remained? unchanged",
    r"(?:was|were) unchanged",
)
NEGATIVE_SCOPE_PATTERNS = (
    NEGATIVE_SCOPE_OBJECT_PATTERNS + NEGATIVE_SCOPE_SUBJECT_PATTERNS
)

CLASS_NAME_PATTERN = re.compile(
    r"\bClass\s+[A-C](?:-\d)?(?:\s+Special)?(?:\s+Convertible)?"
    r"(?:\s+common|\s+capital)?(?:\s+stock|\s+shares)?\b",
    re.IGNORECASE,
)
ALL_COMMON_PATTERN = re.compile(
    r"\b(?:its|our|the) (?:issued )?common stock\b", re.IGNORECASE
)


def _sentences(block: str) -> list[str]:
    """block을 문장으로 자른다. 토큰 창이 아니라 문장 부호 기준이다."""
    return [part.strip() for part in re.split(r"(?<=[.;])\s+", block) if part.strip()]


def _scoped_class_names(block: str) -> tuple[tuple[str, ...], tuple[str, ...]]:
    """긍정 scope와 명시 부정 scope의 class 이름을 가른다.

    부정 표현의 문법 방향에 따라 앞/뒤 중 한쪽만 negative scope로 본다.
    같은 이름이 양쪽에 나오면 어느 쪽도 아니다 — 그 class는 결정되지 않는다.
    """
    affected: list[str] = []
    unaffected: list[str] = []

    def push(target: list[str], text: str) -> None:
        for name in CLASS_NAME_PATTERN.findall(text):
            if name not in target:
                target.append(name)

    for sentence in _sentences(block):
        spans: list[tuple[int, int, str]] = []
        for pattern in NEGATIVE_SCOPE_OBJECT_PATTERNS:
            for match in re.finditer(pattern, sentence, re.IGNORECASE):
                spans.append((match.start(), match.end(), "OBJECT"))
        for pattern in NEGATIVE_SCOPE_SUBJECT_PATTERNS:
            for match in re.finditer(pattern, sentence, re.IGNORECASE):
                spans.append((match.start(), match.end(), "SUBJECT"))
        if not spans:
            push(affected, sentence)
            continue
        spans.sort()
        start, end, direction = spans[0]
        if direction == "OBJECT":
            push(affected, sentence[:start])
            push(unaffected, sentence[end:])
        else:
            push(unaffected, sentence[:start])
            push(affected, sentence[end:])

    both = set(affected) & set(unaffected)
    return (
        tuple(name for name in affected if name not in both),
        tuple(name for name in unaffected if name not in both),
    )

def _iso_date(text: str) -> str | None:
    match = re.match(r"([A-Z][a-z]+) (\d{1,2}), (\d{4})$", text.strip())
    if not match:
        return None
    month = _MONTHS.get(match.group(1))
    if month is None:
        return None
    return f"{int(match.group(3)):04d}-{month:02d}-{int(match.group(2)):02d}"


# ── 후보 추출 ─────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class Candidate:
    block_ordinal: int
    document_name: str
    document_role: str
    discovery_family: str
    source_span: str
    raw_action: str | None
    raw_ratio: str | None
    raw_class_names: tuple[str, ...]
    explicit_unaffected_class_names: tuple[str, ...]
    all_common_scope: bool
    raw_disclosure_status: str
    role_dates: tuple[tuple[str, str], ...]
    disposition: str
    disposition_reason: str


def _match_ratio(block: str) -> str | None:
    for pattern in RATIO_PATTERNS:
        match = re.search(pattern, block, re.IGNORECASE)
        if match:
            return match.group(0)
    return None


def _match_family(block: str) -> tuple[str, str] | None:
    for family, patterns in DISCOVERY_FAMILIES.items():
        for pattern in patterns:
            match = re.search(pattern, block, re.IGNORECASE)
            if match:
                return family, match.group(0)
    return None


def _role_dates(block: str) -> tuple[tuple[str, str], ...]:
    found: list[tuple[str, str]] = []
    for role, pattern in DATE_ROLE_PATTERNS:
        for match in re.finditer(pattern, block, re.IGNORECASE):
            iso = _iso_date(match.group("d"))
            if iso and (role, iso) not in found:
                found.append((role, iso))
    return tuple(found)


def extract_candidates(
    document: bytes | str,
    *,
    document_name: str,
    document_role: str,
    interval_lo: str,
    interval_hi: str,
) -> tuple[Candidate, ...]:
    """block 단위로 명시 action/ratio semantics를 가진 후보만 올린다."""
    out: list[Candidate] = []
    for ordinal, block in enumerate(html_blocks(document)):
        matched = _match_family(block)
        if matched is None:
            continue
        family, action = matched
        ratio = _match_ratio(block)
        if ratio is None:
            # 명시 action/ratio semantics를 요구한다. 비율 없는 언급은 후보가 아니다.
            continue
        roles = _role_dates(block)
        class_names, unaffected_names = _scoped_class_names(block)
        all_common = bool(ALL_COMMON_PATTERN.search(block)) and not class_names
        not_implemented = [
            p for p in NOT_IMPLEMENTED_PATTERNS if re.search(p, block, re.IGNORECASE)
        ]
        disposition, reason = _dispose(
            roles, not_implemented, interval_lo, interval_hi
        )
        out.append(
            Candidate(
                block_ordinal=ordinal,
                document_name=document_name,
                document_role=document_role,
                discovery_family=family,
                source_span=block[:4000],
                raw_action=action,
                raw_ratio=ratio,
                raw_class_names=class_names,
                explicit_unaffected_class_names=unaffected_names,
                all_common_scope=all_common,
                raw_disclosure_status=(
                    "NOT_IMPLEMENTED_MARKERS" if not_implemented else "PLAIN"
                ),
                role_dates=roles,
                disposition=disposition,
                disposition_reason=reason,
            )
        )
    return tuple(out)


def _dispose(
    roles: tuple[tuple[str, str], ...],
    not_implemented: list[str],
    interval_lo: str,
    interval_hi: str,
) -> tuple[str, str]:
    """제외는 **명시 증거**가 있을 때만 한다. 애매하면 UNRESOLVED다."""
    if not_implemented:
        return (
            EXCLUDED_NOT_IMPLEMENTED,
            "명시적 미실행 표현: " + ", ".join(sorted(not_implemented)),
        )
    anchored = [(role, date) for role, date in roles if role in SHARE_SIDE_ROLES]
    if not anchored:
        # 날짜가 없거나 역할이 없으면 시기를 증명할 수 없다.
        return UNRESOLVED, "share-side 역할이 붙은 사건 날짜가 없다"
    if all(date < interval_lo or date > interval_hi for _role, date in anchored):
        return (
            EXCLUDED_OUT_OF_WINDOW,
            "역할이 붙은 사건 날짜가 전부 탐색 구간 밖이다: "
            + ", ".join(f"{r}={d}" for r, d in anchored),
        )
    return CURRENT_EVENT, "탐색 구간 안의 역할 anchored 사건 날짜가 있다"


# ── 탐색 coverage ─────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class ProcessedDocument:
    """탐색이 실제로 읽고 discovery에 통과시킨 문서 하나."""

    accession: str
    document_name: str
    document_role: str


@dataclass(frozen=True)
class SearchCoverage:
    coverage: str
    interval_lo: str
    interval_hi: str
    closure_accession: str | None
    closure_acceptance_eastern_date: str | None
    searched_accessions: tuple[str, ...]
    processed_accessions: tuple[str, ...]
    failed_accessions: tuple[tuple[str, str], ...]
    incomplete_reason: str | None


def _incomplete(
    lo: str, hi: str, reason: str, *,
    closure: str | None = None, closure_date: str | None = None,
    searched: tuple[str, ...] = (), processed: tuple[str, ...] = (),
    failed: tuple[tuple[str, str], ...] = (),
) -> SearchCoverage:
    return SearchCoverage(
        INCOMPLETE, lo, hi, closure, closure_date, searched, processed, failed, reason
    )


def compute_search_coverage(
    connection: sqlite3.Connection,
    *,
    cik: str,
    anchor_acceptance_eastern_date: str,
    valuation_date: str,
    formation_session: str,
    filings_source_version: str,
    processed_accessions: tuple[str, ...] | list[str] | set[str] = (),
    failed_accessions: tuple[tuple[str, str], ...] | list[tuple[str, str]] = (),
) -> SearchCoverage:
    """anchor filing에서 December D까지의 탐색이 닫히는지 판정한다.

    closure filing G는 high boundary 이상 acceptance를 가진 **원본** 10-K/10-Q다.
    amendment는 증거로 탐색에 들어가지만 **절대 닫지 못한다**.

    **metadata closure만으로는 COMPLETE가 되지 않는다.** 구간 안 모든 필수 accession이
    실제로 읽히고 discovery/extraction을 통과했다는 증명(`processed_accessions`)이
    있어야 하고, 필요한 문서를 하나라도 못 읽으면(`failed_accessions`) INCOMPLETE다.
    """
    lo = anchor_acceptance_eastern_date
    hi = valuation_date
    processed = tuple(sorted(set(processed_accessions)))
    failed = tuple(sorted((str(a), str(r)) for a, r in failed_accessions))

    rows = connection.execute(
        "SELECT accession, form, acceptance_eastern_date FROM qv_sec_filings"
        " WHERE cik = ? AND source_version = ? AND acceptance_eastern_date IS NOT NULL"
        " ORDER BY acceptance_eastern_date, accession",
        (cik, filings_source_version),
    ).fetchall()

    closure = None
    for row in rows:
        if row["form"] not in ORIGINAL_FORMS:
            continue
        if row["acceptance_eastern_date"] >= hi:
            closure = row
            break

    if closure is None:
        return _incomplete(
            lo, hi, "high boundary 이상 acceptance를 가진 원본 10-K/10-Q가 없다",
            processed=processed, failed=failed,
        )
    if closure["acceptance_eastern_date"] > formation_session:
        return _incomplete(
            lo, hi, "closure filing의 acceptance가 formation보다 늦다",
            closure=closure["accession"],
            closure_date=closure["acceptance_eastern_date"],
            processed=processed, failed=failed,
        )

    searched = tuple(
        row["accession"]
        for row in rows
        if row["form"] in SEARCHABLE_FORMS
        and lo < row["acceptance_eastern_date"] <= closure["acceptance_eastern_date"]
    )

    if failed:
        return _incomplete(
            lo, hi,
            "필요한 문서를 읽지 못했다: "
            + ", ".join(f"{acc}({reason})" for acc, reason in failed),
            closure=closure["accession"],
            closure_date=closure["acceptance_eastern_date"],
            searched=searched, processed=processed, failed=failed,
        )
    unprocessed = tuple(acc for acc in searched if acc not in set(processed))
    if unprocessed:
        return _incomplete(
            lo, hi,
            "탐색 구간의 accession이 처리되지 않았다: " + ", ".join(unprocessed),
            closure=closure["accession"],
            closure_date=closure["acceptance_eastern_date"],
            searched=searched, processed=processed, failed=failed,
        )

    return SearchCoverage(
        COMPLETE, lo, hi, closure["accession"],
        closure["acceptance_eastern_date"], searched, processed, (), None,
    )


def store_search(
    connection: sqlite3.Connection,
    coverage: SearchCoverage,
    *,
    cik: str,
    anchor_accession: str,
    valuation_date: str,
    formation_session: str,
    source: str,
    source_version: str,
    provenance: str,
) -> None:
    """탐색 receipt를 남긴다. **처리 증명 없는 COMPLETE는 저장되지 않는다.**"""
    if coverage.coverage == COMPLETE:
        missing = [
            accession
            for accession in coverage.searched_accessions
            if accession not in set(coverage.processed_accessions)
        ]
        if coverage.failed_accessions or missing:
            raise QVEventsError(
                "처리 증명 없이 COMPLETE 탐색을 저장할 수 없습니다: "
                f"failed={coverage.failed_accessions} unprocessed={missing}"
            )
    with connection:
        connection.execute(
            "INSERT OR REPLACE INTO qv_share_basis_searches"
            " (cik, anchor_accession, valuation_date, formation_session, interval_lo,"
            "  interval_hi, closure_accession, closure_acceptance_eastern_date, coverage,"
            "  incomplete_reason, searched_accessions, processed_accessions,"
            "  failed_accessions, source, source_version, provenance)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                cik, anchor_accession, valuation_date, formation_session,
                coverage.interval_lo, coverage.interval_hi,
                coverage.closure_accession, coverage.closure_acceptance_eastern_date,
                coverage.coverage, coverage.incomplete_reason,
                json.dumps(list(coverage.searched_accessions)),
                json.dumps(list(coverage.processed_accessions))
                if coverage.coverage == COMPLETE or coverage.processed_accessions
                else None,
                json.dumps([list(item) for item in coverage.failed_accessions])
                if coverage.failed_accessions
                else None,
                source, source_version, provenance,
            ),
        )


# ── class 효과 ────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class ClassEffect:
    class_id: str
    effect: str
    effect_reason: str
    ratio_text: str | None = None
    share_side_transition_date: str | None = None
    share_side_transition_role: str | None = None


def resolve_class_effect(
    connection: sqlite3.Connection,
    candidate: Candidate,
    *,
    class_id: str,
    issuer_id: str,
    as_of: str,
    identity_source_version: str,
    usable_by: str | None,
    registrant_scoped: bool,
) -> ClassEffect:
    """후보 하나가 대상 class의 share-unit basis를 바꿨는지 판정한다.

    `SHARE_BASIS_CHANGE_CONFIRMED`는 다섯 조건을 **전부** 만족할 때만이다.
    제외된 후보가 `NO_SHARE_BASIS_EFFECT_CONFIRMED`가 되는 일은 없다.
    """
    from . import qv_identity  # 순환 import 회피
    from .qv_manifest import prose_key

    if candidate.disposition in (EXCLUDED_NOT_IMPLEMENTED, EXCLUDED_OUT_OF_WINDOW):
        # 제외는 "이 후보가 이 구간의 사건이 아니다"일 뿐 "효과가 없다"가 아니다.
        return ClassEffect(class_id, UNRESOLVED, f"후보가 제외됨: {candidate.disposition}")
    if candidate.disposition == UNRESOLVED:
        return ClassEffect(class_id, UNRESOLVED, candidate.disposition_reason)
    if not registrant_scoped:
        return ClassEffect(class_id, UNRESOLVED, "registrant scope가 명시되지 않았다")
    if candidate.raw_ratio is None:
        return ClassEffect(class_id, UNRESOLVED, "명시 비율이 없다")

    def resolve_names(names):
        out = set()
        for raw in names:
            try:
                resolved = qv_identity.resolve_prose_name(
                    connection, issuer_id, prose_key(raw), as_of,
                    identity_source_version, usable_by=usable_by,
                )
            except qv_identity.QVIdentityError as error:
                raise _ScopeUnresolved(
                    f"class 이름을 PIT prose alias로 풀지 못했다: {raw!r}"
                ) from error
            out.add(resolved.class_id)
        return out

    # 명시 부정 scope를 먼저 본다. 형제가 긍정으로 지목됐다는 사실은 negative 증거가 아니다.
    try:
        excluded_ids = resolve_names(candidate.explicit_unaffected_class_names)
    except _ScopeUnresolved as error:
        return ClassEffect(class_id, UNRESOLVED, str(error))
    if class_id in excluded_ids:
        return ClassEffect(
            class_id, NO_SHARE_BASIS_EFFECT_CONFIRMED,
            "명시 공시가 이 class는 영향받지 않는다고 직접 말한다",
        )

    # 영향 class scope
    if candidate.all_common_scope:
        applies = True
        scope_reason = "all-common scope"
    elif candidate.raw_class_names:
        try:
            resolved_ids = resolve_names(candidate.raw_class_names)
        except _ScopeUnresolved as error:
            return ClassEffect(class_id, UNRESOLVED, f"영향 {error}")
        applies = class_id in resolved_ids
        scope_reason = f"명시 class {sorted(resolved_ids)}"
    else:
        return ClassEffect(class_id, UNRESOLVED, "영향 class scope가 없다")

    if not applies:
        # 다른 class가 지목됐을 뿐 이 class에 대한 명시 진술이 없다.
        # 형제의 부재는 explicit negative evidence가 아니다.
        return ClassEffect(
            class_id, UNRESOLVED,
            f"이 class에 대한 명시 진술이 없다 (공시가 지목한 것은 {scope_reason})",
        )

    anchored = [
        (role, date)
        for role, date in candidate.role_dates
        if role in SHARE_SIDE_ROLES
    ]
    if not anchored:
        return ClassEffect(
            class_id, UNRESOLVED,
            "action에 연결된 EFFECTIVE/DISTRIBUTION 날짜가 없다 (DECLARED/RECORD는 금지)",
        )
    role, date = sorted(anchored, key=lambda item: (SHARE_SIDE_ROLES.index(item[0]), item[1]))[0]
    return ClassEffect(
        class_id, SHARE_BASIS_CHANGE_CONFIRMED,
        f"registrant·실행·{scope_reason}·비율·share-side 전환일이 모두 명시된다",
        ratio_text=candidate.raw_ratio,
        share_side_transition_date=date,
        share_side_transition_role=role,
    )


# ── production 탐색 경로 ──────────────────────────────────────────────────────


def required_accessions(
    connection: sqlite3.Connection,
    *,
    cik: str,
    anchor_acceptance_eastern_date: str,
    valuation_date: str,
    filings_source_version: str,
) -> tuple[str | None, tuple[str, ...]]:
    """closure filing과 그때까지 반드시 읽어야 할 accession 목록."""
    rows = connection.execute(
        "SELECT accession, form, acceptance_eastern_date FROM qv_sec_filings"
        " WHERE cik = ? AND source_version = ? AND acceptance_eastern_date IS NOT NULL"
        " ORDER BY acceptance_eastern_date, accession",
        (cik, filings_source_version),
    ).fetchall()
    closure = None
    for row in rows:
        if row["form"] in ORIGINAL_FORMS and row["acceptance_eastern_date"] >= valuation_date:
            closure = row
            break
    if closure is None:
        return None, ()
    return closure["accession"], tuple(
        row["accession"]
        for row in rows
        if row["form"] in SEARCHABLE_FORMS
        and anchor_acceptance_eastern_date
        < row["acceptance_eastern_date"]
        <= closure["acceptance_eastern_date"]
    )


def run_share_basis_search(
    connection: sqlite3.Connection,
    *,
    cik: str,
    anchor_accession: str,
    anchor_acceptance_eastern_date: str,
    valuation_date: str,
    formation_session: str,
    filings_source_version: str,
    load_documents,
    source: str,
    source_version: str,
    provenance: str,
    store: bool = True,
) -> tuple[SearchCoverage, tuple[Candidate, ...]]:
    """탐색을 **실제로 수행**하고 receipt와 후보를 돌려준다.

    `load_documents(accession)`는 `(document_name, document_role, payload)` 목록을
    돌려주거나 예외를 올린다. 예외는 그 accession의 read failure로 기록되고 coverage는
    `INCOMPLETE`가 된다. **metadata만으로 COMPLETE가 될 수 없는 이유가 이것이다.**

    HTML 본문을 DB에 넣지 않는다. 범용 SEC 크롤러를 만들지 않는다 — 문서 획득은
    호출자의 loader가 맡고 여기서는 처리 완료 여부만 증명한다.
    """
    _closure, required = required_accessions(
        connection,
        cik=cik,
        anchor_acceptance_eastern_date=anchor_acceptance_eastern_date,
        valuation_date=valuation_date,
        filings_source_version=filings_source_version,
    )

    processed: list[str] = []
    failed: list[tuple[str, str]] = []
    candidates: list[Candidate] = []
    for accession in required:
        try:
            documents = list(load_documents(accession))
        except Exception as error:  # noqa: BLE001 — read failure는 INCOMPLETE 사유다
            failed.append((accession, f"{type(error).__name__}: {error}"))
            continue
        if not documents:
            failed.append((accession, "필수 문서가 비었다"))
            continue
        try:
            for document_name, document_role, payload in documents:
                candidates.extend(
                    extract_candidates(
                        payload,
                        document_name=document_name,
                        document_role=document_role,
                        interval_lo=anchor_acceptance_eastern_date,
                        interval_hi=valuation_date,
                    )
                )
        except Exception as error:  # noqa: BLE001
            failed.append((accession, f"추출 실패 {type(error).__name__}: {error}"))
            continue
        processed.append(accession)

    coverage = compute_search_coverage(
        connection,
        cik=cik,
        anchor_acceptance_eastern_date=anchor_acceptance_eastern_date,
        valuation_date=valuation_date,
        formation_session=formation_session,
        filings_source_version=filings_source_version,
        processed_accessions=tuple(processed),
        failed_accessions=tuple(failed),
    )
    if store:
        store_search(
            connection, coverage, cik=cik, anchor_accession=anchor_accession,
            valuation_date=valuation_date, formation_session=formation_session,
            source=source, source_version=source_version, provenance=provenance,
        )
    return coverage, tuple(candidates)
