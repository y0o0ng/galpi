"""QV Phase 0 research fast path — **research-only** coverage preflight primitives.

production 계약이 아니다. production identity · selector · ME는 그대로 CLOSED다.

    RESEARCH_SELECTED_CIK   formation-local. "이 formation/member episode에서 동결된 Phase 0
                            identity 증거가 SEC 등록인 CIK X를 골랐다"는 뜻뿐이다.
                            economic issuer · legal share class · CIK 간 연속성이 아니다.

    RESEARCH_SINGLE_CLASS_ME  단순 단일 class 경우만 SEC shares × December raw close로 잰다.
                              복잡하면 풀지 않고 MISSING이다. 그것이 이 경로의 목적이다.

여기 있는 것은 순수 함수뿐이다. DB · 네트워크 · production identity 표를 모른다.
누락은 누락으로 남고 어떤 증거 확장도 촉발하지 않는다.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation

from .qv_shares import AMBIGUOUS, DIMENSIONLESS, SINGLE_CLASS_AXIS, _tier, classify_shape, consolidate_duplicates
from .qv_xbrl import SHARES_QNAME, InstanceDocument, is_dei

FASTPATH_VERSION = "qv-research-fastpath-v1"

IDENTITY_MISSING = "IDENTITY_MISSING"
PROPOSAL_SELECTED_CIK = "5A2_PROPOSAL_SELECTED_CIK"
MANIFEST_ISSUER_CIK = "PRODUCTION_MANIFEST_ISSUER_CIK"

STRICT_PRODUCTION_ME = "STRICT_PRODUCTION_ME"
RESEARCH_SINGLE_CLASS_ME = "RESEARCH_SINGLE_CLASS_ME"
ME_MISSING_COMPLEX = "ME_MISSING_COMPLEX_CLASS_STRUCTURE"
ME_MISSING_SHARE_FACT = "ME_MISSING_SHARE_FACT"
ME_MISSING_PRICE = "ME_MISSING_PRICE"
ME_MISSING_SPLIT_BOUNDARY = "ME_MISSING_SPLIT_BOUNDARY"
ME_SOURCE_INCOMPLETE = "ME_SOURCE_INCOMPLETE"

_COMMON_TITLE = re.compile(r"\b(COMMON|ORDINARY)\b")
_ISSUER_CIK = re.compile(r"^us-cik-(\d{10})$")


# ── population ───────────────────────────────────────────────────────────────


def membership_rows(inventory: dict, proposals: dict) -> list[dict]:
    """동결된 5A-1 inventory 전체를 member 행으로 편다. CIK를 새로 찾지 않는다.

    UNMAPPED 행은 5A-2 proposal의 `selected_cik`, MAPPED 행은 manifest issuer의 CIK다.
    둘 다 없으면 `IDENTITY_MISSING`이고 추론하지 않는다.
    """
    by_episode = {
        (item["member_symbol"], item["identity_symbol"]): item
        for item in proposals["proposals"]
    }
    rows = []
    for security in inventory["securities"]:
        key = (security["member_symbol"], security["identity_symbol"])
        cik = None
        provenance = IDENTITY_MISSING
        if security["status"] == "MAPPED":
            matched = _ISSUER_CIK.match(security.get("issuer_id") or "")
            if matched:
                cik, provenance = matched.group(1), MANIFEST_ISSUER_CIK
        else:
            proposal = by_episode.get(key)
            if proposal is None or security["formation_session"] not in proposal["demanded_formation_sessions"]:
                raise ValueError(f"5A-2 proposal이 이 demanded 행을 덮지 않는다: {key} {security['formation_session']}")
            if proposal.get("selected_cik"):
                cik, provenance = proposal["selected_cik"], PROPOSAL_SELECTED_CIK
        rows.append({
            "formation_session": security["formation_session"],
            "member_symbol": security["member_symbol"],
            "identity_symbol": security["identity_symbol"],
            "symbol_bridge_kind": security["symbol_bridge_kind"],
            "inventory_status": security["status"],
            "selected_cik": cik,
            "selected_cik_provenance": provenance,
        })
    return rows


def issuer_formations(rows: list[dict]) -> list[dict]:
    """research grain = (formation_session, selected_cik). 같은 CIK의 여러 security는 하나다."""
    grouped: dict[tuple[str, str], list[dict]] = {}
    for row in rows:
        if row["selected_cik"]:
            grouped.setdefault((row["formation_session"], row["selected_cik"]), []).append(row)
    return [
        {
            "formation_session": formation,
            "selected_cik": cik,
            "members": sorted(members, key=lambda m: (m["member_symbol"], m["identity_symbol"])),
            "security_count": len(members),
        }
        for (formation, cik), members in sorted(grouped.items())
    ]


# ── calendar / SIC ───────────────────────────────────────────────────────────


def december_session(spy_sessions: list[str], formation_year: int) -> str | None:
    """D = t-1년 12월의 마지막 SPY 정규 세션."""
    prefix = f"{formation_year - 1:04d}-12-"
    found = [session for session in spy_sessions if session.startswith(prefix)]
    return found[-1] if found else None


def sic_group(filing_sic: str | None) -> str:
    if filing_sic is None:
        return "CLASSIFICATION_MISSING"
    return "FINANCIAL" if filing_sic.startswith("6") else "NONFINANCIAL"


# ── raw XBRL shares (research extraction) ────────────────────────────────────


def share_facts(instance: InstanceDocument, *, cik: str) -> list[dict]:
    """주식수 fact를 연구용으로 뽑는다. identity 표를 보지 않는다.

    production `extract_observations`와 같은 tier · instant · 중복 병합 · D0 모양 판정을
    쓰되, class 해석 대신 모양만 남긴다. 대상 CIK는 **정확히 일치**해야 하고 단위는
    shares여야 한다.
    """
    contexts = instance.context_map()
    selected = []
    for ordinal, fact in enumerate(instance.facts):
        tier = _tier(fact)
        if tier is None:
            continue
        context = contexts.get(fact.context_id)
        if context is None or context.instant is None or context.cik != cik:
            continue
        if fact.unit is None or fact.unit.simple_measure != SHARES_QNAME or fact.value is None:
            continue
        selected.append((ordinal, fact, context, tier))

    groups: dict[tuple, list] = {}
    for ordinal, fact, _context, _tier_name in selected:
        key = (fact.concept.namespace, fact.concept.local, fact.context_id, fact.unit_id)
        groups.setdefault(key, []).append((ordinal, fact.value, fact.decimals))
    kept: dict[int, str] = {}
    for items in groups.values():
        chosen, status = consolidate_duplicates(items)
        for ordinal, _value, _decimals in items:
            if status == AMBIGUOUS:
                kept[ordinal] = AMBIGUOUS
            elif ordinal == chosen:
                kept[ordinal] = status

    out = []
    for ordinal, fact, context, tier in selected:
        if ordinal not in kept:
            continue
        shape, detail = classify_shape(context, cik)
        axis = detail.get("axis")
        member = detail.get("member")
        out.append({
            "fact_ordinal": ordinal,
            "tier": tier,
            "instant": context.instant,
            "value_text": fact.raw_value.strip(),
            "decimals": fact.decimals,
            "context_id": fact.context_id,
            "shape": shape,
            "axis_local": axis.local if axis else None,
            "member_local": member.local if member else None,
            "duplicate_status": kept[ordinal],
            "instance_file": instance.source_file,
            "instance_sha256": instance.sha256,
        })
    return out


def cover_listing(instance: InstanceDocument, *, cik: str) -> dict:
    """같은 filing의 DEI 표지 사실만 본다. 일반 legal class parser가 아니다.

    context마다 `TradingSymbol`과 `Security12bTitle`을 모으고, 제목이 보통주 계열이거나
    제목이 없는 context의 거래 심볼만 보통주 상장 심볼로 센다.
    """
    contexts = instance.context_map()
    by_context: dict[str, dict] = {}
    for fact in instance.facts:
        if not is_dei(fact.namespace) or fact.local_name not in ("TradingSymbol", "Security12bTitle"):
            continue
        context = contexts.get(fact.context_id)
        if context is None or context.cik != cik:
            continue
        slot = by_context.setdefault(fact.context_id, {"symbols": set(), "titles": set()})
        text = fact.raw_value.strip()
        if not text:
            continue
        if fact.local_name == "TradingSymbol":
            slot["symbols"].add(normalize_symbol(text))
        else:
            slot["titles"].add(text.upper())
    common = set()
    for slot in by_context.values():
        if not slot["titles"] or any(_COMMON_TITLE.search(title) for title in slot["titles"]):
            common.update(slot["symbols"])
    return {"common_symbols": sorted(common), "contexts": len(by_context)}


def normalize_symbol(text: str) -> str:
    return text.strip().upper().replace("-", ".").replace("/", ".")


# ── research single-class ME ─────────────────────────────────────────────────


@dataclass(frozen=True)
class ShareChoice:
    status: str | None
    reason: str | None
    fact: dict | None = None
    tier_path: str | None = None


def choose_research_shares(
    facts: list[dict], *, formation_session: str, december: str
) -> ShareChoice:
    """S1 창 · PIT 가용 · tier 규칙으로 연구용 12월 주식수 하나를 고른다.

    `facts`의 각 항목은 `share_facts` 결과에 filing의 `accession`·`acceptance_datetime`·
    `historical_usable_session`이 붙은 것이다.

    - class 축 주식수 fact가 하나라도 있으면 단순 단일 class가 아니다 → COMPLEX
    - fresh A가 구조적으로 있으면 A가 소유한다. 쓸 수 없는 A는 B로 내려가지 않는다
    - 가장 늦은 instant → acceptance DESC → accession DESC. 같은 자리 값이 다르면 MISSING
    """
    lo = f"{int(december[:4]):04d}-01-01"
    scope = [
        fact for fact in facts
        if fact["historical_usable_session"] is not None
        and fact["historical_usable_session"] <= formation_session
        and lo <= fact["instant"] <= december
    ]
    if any(fact["shape"] == SINGLE_CLASS_AXIS for fact in scope):
        return ShareChoice(ME_MISSING_COMPLEX, "CLASS_AXIS_SHARE_FACT")

    a_present = [fact for fact in scope if fact["tier"] == "A"]
    tier = "A" if a_present else "B"
    usable = [
        fact for fact in scope
        if fact["tier"] == tier
        and fact["shape"] == DIMENSIONLESS
        and fact["duplicate_status"] != AMBIGUOUS
    ]
    if not usable:
        reason = "TIER_A_PRESENT_NOT_USABLE" if a_present else "NO_CANDIDATE_IN_S1_WINDOW"
        return ShareChoice(ME_MISSING_SHARE_FACT, reason, tier_path=tier)

    usable.sort(key=lambda f: (f["instant"], f["acceptance_datetime"], f["accession"]), reverse=True)
    top = usable[0]
    same_slot = [
        fact for fact in usable
        if (fact["instant"], fact["acceptance_datetime"], fact["accession"])
        == (top["instant"], top["acceptance_datetime"], top["accession"])
    ]
    if len({Decimal(fact["value_text"]) for fact in same_slot}) > 1:
        return ShareChoice(ME_MISSING_SHARE_FACT, "TIE_VALUES_DIFFER", tier_path=tier)
    if Decimal(top["value_text"]) <= 0:
        return ShareChoice(ME_MISSING_SHARE_FACT, "NONPOSITIVE_SHARES", tier_path=tier)
    return ShareChoice(None, None, top, tier)


def cover_check(cover: dict | None, identity_symbol: str) -> str | None:
    """선택된 accession의 표지가 하나의 보통주 상장 심볼과 양립하는가. 증거가 없으면 통과다."""
    if cover is None:
        return None
    symbols = cover["common_symbols"]
    if len(symbols) > 1:
        return "COVER_MULTIPLE_COMMON_SYMBOLS"
    if len(symbols) == 1 and symbols[0] != normalize_symbol(identity_symbol):
        return "COVER_SYMBOL_NOT_IDENTITY_SYMBOL"
    return None


def split_boundary(
    split_dates: list[str], *, fact_instant: str, acceptance_eastern_date: str, december: str
) -> str | None:
    """관측된 vendor split이 주식수 basis와 D 사이에 있으면 그 날짜를 돌려준다. 정규화하지 않는다.

    basis는 fact instant와 filing acceptance 둘 다다 — D 뒤에 제출된 filing의 비교기 주식수는
    그 사이 split으로 소급 재작성됐을 수 있다. 구간은 양끝을 포함한다.
    """
    low = min(fact_instant, acceptance_eastern_date, december)
    high = max(fact_instant, acceptance_eastern_date, december)
    inside = sorted(date for date in split_dates if low <= date <= high)
    return inside[0] if inside else None


def market_equity(shares_text: str, raw_close: float) -> Decimal:
    """SQLite REAL 경계는 `Decimal(str(...))` 한 번뿐이다."""
    try:
        return Decimal(shares_text) * Decimal(str(raw_close))
    except InvalidOperation as error:
        raise ValueError(f"ME를 Decimal로 만들 수 없습니다: {shares_text!r} × {raw_close!r}") from error


# ── accounting availability ──────────────────────────────────────────────────


def q_available(accounting: dict | None) -> bool:
    if not accounting:
        return False
    if accounting.get("gross_profit_status") != "RESOLVED" or accounting.get("assets_status") != "RESOLVED":
        return False
    return Decimal(accounting["assets_value"]) > 0


def gpa_text(accounting: dict | None) -> str | None:
    if not q_available(accounting):
        return None
    return format(Decimal(accounting["gross_profit_value"]) / Decimal(accounting["assets_value"]), "f")


def be_available(accounting: dict | None) -> bool:
    if not accounting or accounting.get("book_equity_status") != "RESOLVED":
        return False
    return Decimal(accounting["book_equity_value"]) > 0


# ── scorecard ────────────────────────────────────────────────────────────────


def coverage_start(annual: dict[int, float], *, threshold: float = 0.85, run: int = 3) -> int | None:
    """joint QV coverage >= 85%인 해가 3년 연속 처음 나타나는 구간의 첫 해."""
    years = sorted(annual)
    for index, year in enumerate(years):
        window = years[index:index + run]
        if len(window) == run and window == list(range(year, year + run)) and all(
            annual[y] >= threshold for y in window
        ):
            return year
    return None


def preflight_verdict(
    *, start: int | None, aggregate_joint: float | None, min_annual: float | None, me_coverage: float | None
) -> dict:
    if start is None:
        return {"result": "DATA_NOT_READY_FAST_PATH", "A": None, "B": None, "C": None}
    gate_a = aggregate_joint >= 0.85
    gate_b = min_annual >= 0.75
    gate_c = me_coverage >= 0.95
    passed = gate_a and gate_b and gate_c
    return {
        "result": "PHASE0_COVERAGE_PREFLIGHT_PASS" if passed else "PHASE0_COVERAGE_PREFLIGHT_FAIL",
        "A": gate_a,
        "B": gate_b,
        "C": gate_c,
    }
