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

CLASS_NAME_PATTERN = re.compile(
    r"\bClass\s+[A-C](?:-\d)?(?:\s+Special)?(?:\s+Convertible)?"
    r"(?:\s+[Cc]ommon|\s+[Cc]apital)?(?:\s+[Ss]tock|\s+[Ss]hares)?\b"
)
ALL_COMMON_PATTERN = re.compile(
    r"\b(?:its|our|the) (?:issued )?common stock\b", re.IGNORECASE
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
        class_names = tuple(dict.fromkeys(CLASS_NAME_PATTERN.findall(block)))
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
class SearchCoverage:
    coverage: str
    interval_lo: str
    interval_hi: str
    closure_accession: str | None
    closure_acceptance_eastern_date: str | None
    searched_accessions: tuple[str, ...]
    incomplete_reason: str | None


def compute_search_coverage(
    connection: sqlite3.Connection,
    *,
    cik: str,
    anchor_acceptance_eastern_date: str,
    valuation_date: str,
    formation_session: str,
    filings_source_version: str,
) -> SearchCoverage:
    """anchor filing에서 December D까지의 탐색이 닫히는지 판정한다.

    closure filing G는 high boundary 이상 acceptance를 가진 **원본** 10-K/10-Q다.
    amendment는 증거로 탐색에 들어가지만 **절대 닫지 못한다**.
    """
    lo = anchor_acceptance_eastern_date
    hi = valuation_date
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
        return SearchCoverage(
            INCOMPLETE, lo, hi, None, None, (),
            "high boundary 이상 acceptance를 가진 원본 10-K/10-Q가 없다",
        )
    if closure["acceptance_eastern_date"] > formation_session:
        return SearchCoverage(
            INCOMPLETE, lo, hi, closure["accession"],
            closure["acceptance_eastern_date"], (),
            "closure filing의 acceptance가 formation보다 늦다",
        )

    searched = tuple(
        row["accession"]
        for row in rows
        if row["form"] in SEARCHABLE_FORMS
        and lo < row["acceptance_eastern_date"] <= closure["acceptance_eastern_date"]
    )
    return SearchCoverage(
        COMPLETE, lo, hi, closure["accession"],
        closure["acceptance_eastern_date"], searched, None,
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
    with connection:
        connection.execute(
            "INSERT OR REPLACE INTO qv_share_basis_searches"
            " (cik, anchor_accession, valuation_date, formation_session, interval_lo,"
            "  interval_hi, closure_accession, closure_acceptance_eastern_date, coverage,"
            "  incomplete_reason, searched_accessions, source, source_version, provenance)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                cik, anchor_accession, valuation_date, formation_session,
                coverage.interval_lo, coverage.interval_hi,
                coverage.closure_accession, coverage.closure_acceptance_eastern_date,
                coverage.coverage, coverage.incomplete_reason,
                json.dumps(list(coverage.searched_accessions)),
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

    # 영향 class scope
    if candidate.all_common_scope:
        applies = True
        scope_reason = "all-common scope"
    elif candidate.raw_class_names:
        resolved_ids = set()
        for raw in candidate.raw_class_names:
            try:
                resolved = qv_identity.resolve_prose_name(
                    connection, issuer_id, prose_key(raw), as_of,
                    identity_source_version, usable_by=usable_by,
                )
            except qv_identity.QVIdentityError:
                return ClassEffect(
                    class_id, UNRESOLVED,
                    f"영향 class 이름을 PIT prose alias로 풀지 못했다: {raw!r}",
                )
            resolved_ids.add(resolved.class_id)
        applies = class_id in resolved_ids
        scope_reason = f"명시 class {sorted(resolved_ids)}"
    else:
        return ClassEffect(class_id, UNRESOLVED, "영향 class scope가 없다")

    if not applies:
        return ClassEffect(
            class_id, NO_SHARE_BASIS_EFFECT_CONFIRMED,
            f"명시 공시가 이 class를 영향 범위에서 제외한다 ({scope_reason})",
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
