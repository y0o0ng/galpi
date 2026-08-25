"""Quality + Value의 canonical accounting ledger.

동결된 회계 계약(로드맵 §4.2.1 Gross Profit · §4.2.2 Total Assets · §4.3.1 Book Equity)을
raw SEC accession XBRL에 적용하고, canonical 값과 **그 값을 만든 fact의 provenance만**
`qv_accounting_filings`에 남긴다.

이 모듈은 raw filing 전체를 DB에 warehouse하지 않는다. companyfacts를 canonical source로
쓰지 않는다. 회계 의미를 여기서 다시 정하지 않는다.
"""

from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass, field
from decimal import Decimal

from .edgar import EdgarError
from .qv_xbrl import (
    Context,
    Fact,
    FilingSummaryDocument,
    InstanceDocument,
    PresentationDocument,
    PresentationRole,
    QVXbrlError,
    candidate_xml_names,
    is_dei,
    is_us_gaap,
    looks_like_instance,
    looks_like_presentation,
    normalize_cik,
    parse_filing_summary,
    parse_instance,
    parse_presentation,
    sha256,
)

ACCOUNTING_DEFINITION_VERSION = "qv-accounting-v1"
# 이 semantic version이 뜻하는 frozen contract의 기준 commit. code hash와 혼동하지 않는다.
ACCOUNTING_CONTRACT_COMMIT = "cc70cb42d417b920c7221d4ad995a36b92c4c61e"

FILING_SUMMARY_NAME = "FilingSummary.xml"
ANNUAL_FORMS = ("10-K", "10-K/A")
MIN_ANNUAL_DAYS = 340
MAX_ANNUAL_DAYS = 400
USD = "iso4217:USD"

RESOLVED = "RESOLVED"
MISSING = "MISSING"
AMBIGUOUS = "AMBIGUOUS"
UNRESOLVED = "UNRESOLVED"

VALIDATED = "VALIDATED"
ROUNDING_COMPATIBLE = "ROUNDING_COMPATIBLE"
TIEOUT_MISMATCH = "TIEOUT_MISMATCH"
TIEOUT_UNAVAILABLE = "TIEOUT_UNAVAILABLE"
TIEOUT_EXACT = "TIEOUT_EXACT"

DIRECT_PARENT_SE = "DIRECT_PARENT_SE"
INCLUDING_NCI_MINUS_NCI = "INCLUDING_NCI_MINUS_NCI"
PARENT_RECONSTRUCTED = "PARENT_RECONSTRUCTED"
PARENT_EQUITY_SCOPE_AMBIGUOUS = "PARENT_EQUITY_SCOPE_AMBIGUOUS"

LIQUIDATION = "LIQUIDATION"
PAR_CARRYING = "PAR_CARRYING"
ZERO = "ZERO"
PREF_UNRESOLVED = "PREF_UNRESOLVED"
PREF_TIER_UNSTABLE = "PREF_TIER_UNSTABLE"

PERIOD_CROSSCHECK_OK = "OK"
PERIOD_CROSSCHECK_UNAVAILABLE = "UNAVAILABLE"
PERIOD_CROSSCHECK_MISMATCH = "PERIOD_CROSSCHECK_MISMATCH"

UNRESOLVED_STATEMENT_ROLE = "UNRESOLVED_STATEMENT_ROLE"
AMBIGUOUS_STATEMENT_ROLE = "AMBIGUOUS_STATEMENT_ROLE"

# probe에서 실제 관측된 standard revenue 계열. **우선순위 목록이 아니다** —
# canonical target은 consolidated total revenue 하나이고 선택은 presentation 구조로 한다.
REVENUE_LOCALS = frozenset(
    {
        "Revenues",
        "RevenueFromContractWithCustomerExcludingAssessedTax",
        "RevenueFromContractWithCustomerIncludingAssessedTax",
        "SalesRevenueNet",
        "SalesRevenueGoodsNet",
        "SalesRevenueServicesNet",
        "RevenueNotFromContractWithCustomer",
        "RevenueFromCollaborativeArrangementExcludingRevenueFromContractWithCustomer",
    }
)
COGS_LOCALS = frozenset(
    {
        "CostOfRevenue",
        "CostOfGoodsAndServicesSold",
        "CostOfGoodsSold",
        "CostOfServices",
        "CostOfGoodsSoldExcludingDepreciationDepletionAndAmortization",
        "CostOfServicesExcludingDepreciationDepletionAndAmortization",
    }
)
GROSS_PROFIT_LOCAL = "GrossProfit"
ASSETS_LOCAL = "Assets"
LIABILITIES_AND_SE_LOCAL = "LiabilitiesAndStockholdersEquity"
PARENT_SE_LOCAL = "StockholdersEquity"
SE_INCLUDING_NCI_LOCAL = (
    "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"
)
MINORITY_INTEREST_LOCAL = "MinorityInterest"
MEZZANINE_LOCALS = frozenset(
    {
        "RedeemableNoncontrollingInterestEquityCarryingAmount",
        "RedeemableNoncontrollingInterestEquityCommonCarryingAmount",
        "RedeemableNoncontrollingInterestEquityOtherCarryingAmount",
        "TemporaryEquityCarryingAmount",
        "TemporaryEquityCarryingAmountAttributableToParent",
        "TemporaryEquityCarryingAmountIncludingPortionAttributableToNoncontrollingInterests",
    }
)
PREFERRED_LIQUIDATION_LOCALS = frozenset(
    {"PreferredStockLiquidationPreferenceValue"}
)
PREFERRED_VALUE_LOCAL = "PreferredStockValue"
PREFERRED_SHARE_LOCALS = frozenset(
    {"PreferredStockSharesIssued", "PreferredStockSharesOutstanding"}
)
DOCUMENT_PERIOD_END_LOCAL = "DocumentPeriodEndDate"


class QVAccountingError(Exception):
    """raw source 자체를 읽지 못했거나 적재 계약을 어겼을 때 올린다."""


def decimal_text(value: Decimal | None) -> str | None:
    """지수 표기 없는 canonical decimal 문자열. float를 거치지 않는다."""
    if value is None:
        return None
    return format(value, "f")


def half_width(decimals: str | None) -> Decimal:
    """filing이 선언한 `decimals`가 허용하는 반올림 반폭. 없거나 INF면 0이다."""
    if decimals is None:
        return Decimal(0)
    clean = str(decimals).strip()
    if not clean or clean.upper() == "INF":
        return Decimal(0)
    try:
        places = int(clean)
    except ValueError:
        return Decimal(0)
    return Decimal(10) ** (-places) / 2


def _days(start: str, end: str) -> int | None:
    from datetime import date

    try:
        return (date.fromisoformat(end) - date.fromisoformat(start)).days
    except ValueError:
        return None


@dataclass(frozen=True)
class BoundFact:
    """fact와 그 context, 출처 instance를 함께 묶은 것."""

    fact: Fact
    context: Context
    instance_file: str
    instance_sha256: str

    @property
    def value(self) -> Decimal | None:
        return self.fact.value


@dataclass
class AccessionBundle:
    cik: str
    accession: str
    summary: FilingSummaryDocument | None
    instances: list[InstanceDocument] = field(default_factory=list)
    presentations: list[PresentationDocument] = field(default_factory=list)
    file_hashes: dict[str, str] = field(default_factory=dict)
    index_names: tuple[str, ...] = ()

    def bound_facts(self) -> list[BoundFact]:
        out: list[BoundFact] = []
        for doc in self.instances:
            contexts = doc.context_map()
            for fact in doc.facts:
                context = contexts.get(fact.context_id)
                if context is None:
                    continue
                out.append(
                    BoundFact(
                        fact=fact,
                        context=context,
                        instance_file=doc.source_file,
                        instance_sha256=doc.sha256,
                    )
                )
        return out

    def presentation_role(self, role: str) -> tuple[PresentationRole, str, str] | None:
        for doc in self.presentations:
            for candidate in doc.roles:
                if candidate.role == role:
                    return candidate, doc.source_file, doc.sha256
        return None

    def prefix_map(self) -> dict[str, str]:
        merged: dict[str, str] = {}
        for doc in self.instances:
            merged.update(doc.prefix_map())
        return merged


def fetch_bundle(client, cik: str, accession: str) -> AccessionBundle:
    """accession의 FilingSummary · instance · presentation linkbase를 읽는다.

    파일명 규칙으로 의미를 정하지 않고 XML root/content로 판정한다. raw source를 읽지
    못하면 `QVAccountingError`다 — 회계 mapping 실패와 섞지 않는다.
    """
    normalized = normalize_cik(cik)
    if normalized is None:
        raise QVAccountingError(f"cik가 10자리 숫자가 아닙니다: {cik!r}")
    hashes: dict[str, str] = {}
    try:
        index_payload = client.accession_index(normalized, accession)
    except (EdgarError, OSError) as error:
        raise QVAccountingError(
            f"accession index를 읽지 못했습니다: {accession} ({error})"
        ) from error

    summary: FilingSummaryDocument | None = None
    try:
        raw = client.accession_file_bytes(normalized, accession, FILING_SUMMARY_NAME)
    except (EdgarError, OSError):
        raw = None
    if raw is not None:
        try:
            summary = parse_filing_summary(raw, FILING_SUMMARY_NAME)
            hashes[FILING_SUMMARY_NAME] = summary.sha256
        except QVXbrlError as error:
            raise QVAccountingError(
                f"FilingSummary를 파싱하지 못했습니다: {accession} ({error})"
            ) from error

    try:
        names = candidate_xml_names(index_payload, summary)
    except QVXbrlError as error:
        raise QVAccountingError(str(error)) from error

    bundle = AccessionBundle(
        cik=normalized,
        accession=accession,
        summary=summary,
        index_names=tuple(names),
    )
    raw_by_name: dict[str, bytes] = {}
    for name in names:
        try:
            raw_by_name[name] = client.accession_file_bytes(normalized, accession, name)
        except (EdgarError, OSError) as error:
            raise QVAccountingError(
                f"accession 파일을 읽지 못했습니다: {accession}/{name} ({error})"
            ) from error

    for name, raw in raw_by_name.items():
        if looks_like_instance(raw, name):
            doc = parse_instance(raw, name)
            bundle.instances.append(doc)
            hashes[name] = doc.sha256
    prefix_map = bundle.prefix_map()
    for name, raw in raw_by_name.items():
        if name in hashes and any(d.source_file == name for d in bundle.instances):
            continue
        if looks_like_presentation(raw, name):
            doc = parse_presentation(raw, name, prefix_map)
            bundle.presentations.append(doc)
            hashes[name] = doc.sha256
    bundle.file_hashes = hashes
    return bundle


def _fact_provenance(
    bound: BoundFact,
    *,
    role: str | None,
    presentation_file: str | None,
    presentation_sha256: str | None,
    summary: FilingSummaryDocument | None,
    reason: str,
) -> dict:
    fact = bound.fact
    return {
        "concept_namespace": fact.namespace,
        "concept_local_name": fact.local_name,
        "raw_value": fact.raw_value,
        "value": decimal_text(fact.value),
        "unit": fact.unit,
        "unit_id": fact.unit_id,
        "decimals": fact.decimals,
        "precision": fact.precision,
        "context_id": bound.context.context_id,
        "entity_identifier": bound.context.entity_identifier,
        "instant": bound.context.instant,
        "start": bound.context.start,
        "end": bound.context.end,
        "dimensions": [list(pair) for pair in bound.context.dimensions],
        "typed_dimensions": list(bound.context.typed_dimensions),
        "instance_file": bound.instance_file,
        "instance_sha256": bound.instance_sha256,
        "statement_role": role,
        "presentation_file": presentation_file,
        "presentation_sha256": presentation_sha256,
        "filing_summary_file": summary.source_file if summary else None,
        "filing_summary_sha256": summary.sha256 if summary else None,
        "selection_reason": reason,
    }


def _standard(bound: BoundFact, local: str | frozenset[str]) -> bool:
    if not is_us_gaap(bound.fact.namespace):
        return False
    if isinstance(local, str):
        return bound.fact.local_name == local
    return bound.fact.local_name in local


def _target_dimensionless(bound: BoundFact, cik: str) -> bool:
    return bound.context.cik == cik and bound.context.dimensionless


def _usd_monetary(bound: BoundFact) -> bool:
    return bound.fact.unit == USD and bound.fact.value is not None


def _unique_value(bounds: list[BoundFact]) -> tuple[BoundFact | None, str]:
    """같은 의미 범위의 후보에서 값이 유일해야 canonical이다.

    exact duplicate(값·decimals 동일)는 dedupe하고, 값이 갈리면 AMBIGUOUS다.
    최신 context id·사전순·first/last 같은 임의 규칙으로 고르지 않는다.
    """
    if not bounds:
        return None, MISSING
    signature = {
        (
            decimal_text(b.fact.value),
            b.fact.decimals,
            b.fact.unit,
            b.context.instant,
            b.context.start,
            b.context.end,
        )
        for b in bounds
    }
    if len({s[0] for s in signature}) > 1:
        return None, AMBIGUOUS
    return bounds[0], RESOLVED


@dataclass
class AccountingResult:
    cik: str
    accession: str
    fiscal_period_end: str | None = None
    period_crosscheck_status: str = PERIOD_CROSSCHECK_UNAVAILABLE
    income_statement_role: str | None = None
    balance_sheet_role: str | None = None

    revenue_value: str | None = None
    revenue_status: str = MISSING
    cogs_value: str | None = None
    cogs_status: str = MISSING
    gross_profit_value: str | None = None
    gross_profit_status: str = MISSING
    direct_gross_profit_value: str | None = None
    gross_profit_tieout_status: str = TIEOUT_UNAVAILABLE

    assets_value: str | None = None
    assets_status: str = MISSING
    assets_tieout_status: str = TIEOUT_UNAVAILABLE

    parent_se_value: str | None = None
    parent_se_status: str = MISSING
    parent_se_path: str | None = None
    nci_tieout_status: str = TIEOUT_UNAVAILABLE

    preferred_value: str | None = None
    preferred_status: str = MISSING
    preferred_tier: str | None = None

    book_equity_value: str | None = None
    book_equity_status: str = MISSING

    provenance: dict = field(default_factory=dict)
    diagnostics: dict = field(default_factory=dict)


def _resolve_period(bundle: AccessionBundle, report_date: str | None) -> tuple[
    str | None, str, dict
]:
    facts = [
        b
        for b in bundle.bound_facts()
        if is_dei(b.fact.namespace)
        and b.fact.local_name == DOCUMENT_PERIOD_END_LOCAL
        and _target_dimensionless(b, bundle.cik)
    ]
    values = {b.fact.raw_value.strip() for b in facts if b.fact.raw_value.strip()}
    if not values:
        return None, PERIOD_CROSSCHECK_UNAVAILABLE, {"period": "DPE_MISSING"}
    if len(values) > 1:
        return None, PERIOD_CROSSCHECK_UNAVAILABLE, {
            "period": f"DPE_AMBIGUOUS:{sorted(values)}"
        }
    dpe = values.pop()
    if report_date is None:
        return dpe, PERIOD_CROSSCHECK_UNAVAILABLE, {}
    if report_date != dpe:
        return dpe, PERIOD_CROSSCHECK_MISMATCH, {
            "period": f"DPE={dpe} report_date={report_date}"
        }
    return dpe, PERIOD_CROSSCHECK_OK, {}


def _statement_roles(bundle: AccessionBundle) -> list[str]:
    if bundle.summary is None:
        return []
    return [r.role for r in bundle.summary.reports if r.is_statement and r.role]


def _select_balance_sheet_role(
    bundle: AccessionBundle, dpe: str
) -> tuple[str | None, str | None]:
    facts = bundle.bound_facts()
    assets = [
        b
        for b in facts
        if _standard(b, ASSETS_LOCAL)
        and _target_dimensionless(b, bundle.cik)
        and b.context.instant == dpe
        and _usd_monetary(b)
    ]
    if not assets:
        return None, UNRESOLVED_STATEMENT_ROLE
    candidates = []
    for role in _statement_roles(bundle):
        found = bundle.presentation_role(role)
        if found is None:
            continue
        concepts = found[0].concepts()
        if any((b.fact.namespace, b.fact.local_name) in concepts for b in assets):
            candidates.append(role)
    if len(candidates) == 1:
        return candidates[0], None
    if not candidates:
        return None, UNRESOLVED_STATEMENT_ROLE
    return None, AMBIGUOUS_STATEMENT_ROLE


def _annual_period(bundle: AccessionBundle, dpe: str) -> tuple[str | None, str | None]:
    """DPE에서 끝나는 연간 duration의 시작일. 여러 개면 ambiguous."""
    starts = set()
    for b in bundle.bound_facts():
        ctx = b.context
        if ctx.cik != bundle.cik or not ctx.dimensionless:
            continue
        if ctx.end != dpe or not ctx.start:
            continue
        span = _days(ctx.start, ctx.end)
        if span is None or not (MIN_ANNUAL_DAYS <= span <= MAX_ANNUAL_DAYS):
            continue
        starts.add(ctx.start)
    if len(starts) == 1:
        return starts.pop(), None
    if not starts:
        return None, "ANNUAL_PERIOD_MISSING"
    return None, f"ANNUAL_PERIOD_AMBIGUOUS:{sorted(starts)}"


def _select_income_role(
    bundle: AccessionBundle, start: str, dpe: str
) -> tuple[str | None, str | None]:
    revenue = [
        b
        for b in bundle.bound_facts()
        if _standard(b, REVENUE_LOCALS)
        and _target_dimensionless(b, bundle.cik)
        and b.context.start == start
        and b.context.end == dpe
        and _usd_monetary(b)
    ]
    if not revenue:
        return None, UNRESOLVED_STATEMENT_ROLE
    candidates = []
    for role in _statement_roles(bundle):
        found = bundle.presentation_role(role)
        if found is None:
            continue
        concepts = found[0].concepts()
        if any((b.fact.namespace, b.fact.local_name) in concepts for b in revenue):
            candidates.append(role)
    if len(candidates) == 1:
        return candidates[0], None
    if not candidates:
        return None, UNRESOLVED_STATEMENT_ROLE
    return None, AMBIGUOUS_STATEMENT_ROLE


def _structural_total(
    role: PresentationRole, bounds: list[BoundFact]
) -> tuple[BoundFact | None, str]:
    """presentation 구조에서 유일한 total/subtotal candidate를 고른다.

    후보가 하나면 그것. 여러 개면 다른 후보 전부의 presentation 조상인 하나가 있을 때만
    그것을 쓴다. component 합산으로 total을 만들지 않고, concept 우선순위 목록도 쓰지 않는다.
    """
    if not bounds:
        return None, MISSING
    by_concept: dict[tuple[str, str], list[BoundFact]] = {}
    for b in bounds:
        by_concept.setdefault((b.fact.namespace, b.fact.local_name), []).append(b)
    if len(by_concept) == 1:
        return _unique_value(next(iter(by_concept.values())))
    tops = []
    for concept, group in by_concept.items():
        others = set(by_concept) - {concept}
        if all(concept in role.ancestors(*other) for other in others):
            tops.append((concept, group))
    if len(tops) == 1:
        return _unique_value(tops[0][1])
    return None, AMBIGUOUS


def resolve_accounting(
    bundle: AccessionBundle, *, report_date: str | None
) -> AccountingResult:
    """동결 계약을 한 accession에 적용한다. 실패는 상태로 남기고 값을 지어내지 않는다."""
    result = AccountingResult(cik=bundle.cik, accession=bundle.accession)
    facts = bundle.bound_facts()

    dpe, crosscheck, diag = _resolve_period(bundle, report_date)
    result.fiscal_period_end = dpe
    result.period_crosscheck_status = crosscheck
    result.diagnostics.update(diag)
    if dpe is None or crosscheck == PERIOD_CROSSCHECK_MISMATCH:
        # accounting canonical outputs fail-close.
        for name in ("revenue", "cogs", "gross_profit", "assets", "parent_se", "preferred", "book_equity"):
            result.diagnostics.setdefault(name, "PERIOD_FAIL_CLOSE")
        return result

    bs_role, bs_reason = _select_balance_sheet_role(bundle, dpe)
    result.balance_sheet_role = bs_role
    if bs_reason:
        result.diagnostics["balance_sheet_role"] = bs_reason

    start, period_reason = _annual_period(bundle, dpe)
    if period_reason:
        result.diagnostics["annual_period"] = period_reason
    is_role = None
    if start:
        is_role, is_reason = _select_income_role(bundle, start, dpe)
        if is_reason:
            result.diagnostics["income_statement_role"] = is_reason
    result.income_statement_role = is_role

    _resolve_income(bundle, result, facts, start, dpe, is_role)
    _resolve_assets(bundle, result, facts, dpe, bs_role)
    _resolve_equity(bundle, result, facts, dpe, bs_role)
    _resolve_book_equity(result)
    return result


def _role_context(bundle: AccessionBundle, role: str | None):
    if role is None:
        return None, None, None
    found = bundle.presentation_role(role)
    if found is None:
        return None, None, None
    return found


def _in_role(role_obj: PresentationRole | None, bound: BoundFact) -> bool:
    if role_obj is None:
        return False
    return (bound.fact.namespace, bound.fact.local_name) in role_obj.concepts()


def _resolve_income(bundle, result, facts, start, dpe, role):
    role_obj, pre_file, pre_sha = _role_context(bundle, role)
    if role_obj is None or start is None:
        result.revenue_status = MISSING
        result.cogs_status = MISSING
        result.gross_profit_status = MISSING
        result.diagnostics.setdefault("revenue", "NO_INCOME_STATEMENT_ROLE")
        result.diagnostics.setdefault("cogs", "NO_INCOME_STATEMENT_ROLE")
        return

    def annual(locals_):
        return [
            b
            for b in facts
            if _standard(b, locals_)
            and _target_dimensionless(b, bundle.cik)
            and b.context.start == start
            and b.context.end == dpe
            and _usd_monetary(b)
            and _in_role(role_obj, b)
        ]

    revenue, rev_status = _structural_total(role_obj, annual(REVENUE_LOCALS))
    result.revenue_status = rev_status
    if revenue is not None:
        result.revenue_value = decimal_text(revenue.fact.value)
        result.provenance["revenue_provenance"] = _fact_provenance(
            revenue,
            role=role,
            presentation_file=pre_file,
            presentation_sha256=pre_sha,
            summary=bundle.summary,
            reason="income-statement role · dimensionless · structural total",
        )
    else:
        result.diagnostics["revenue"] = f"REVENUE_{rev_status}"

    cogs, cogs_status = _structural_total(role_obj, annual(COGS_LOCALS))
    result.cogs_status = cogs_status
    if cogs is not None:
        result.cogs_value = decimal_text(cogs.fact.value)
        result.provenance["cogs_provenance"] = _fact_provenance(
            cogs,
            role=role,
            presentation_file=pre_file,
            presentation_sha256=pre_sha,
            summary=bundle.summary,
            reason="income-statement role · dimensionless · structural total",
        )
    else:
        result.diagnostics["cogs"] = f"COGS_{cogs_status}"

    if revenue is not None and cogs is not None:
        gross = revenue.fact.value - cogs.fact.value
        result.gross_profit_value = decimal_text(gross)
        result.gross_profit_status = RESOLVED
    else:
        result.gross_profit_status = MISSING
        result.diagnostics.setdefault("gross_profit", "COMPONENT_UNRESOLVED")

    direct_bounds = annual(frozenset({GROSS_PROFIT_LOCAL}))
    direct, direct_status = _unique_value(direct_bounds)
    if direct is None:
        result.gross_profit_tieout_status = TIEOUT_UNAVAILABLE
        if direct_status == AMBIGUOUS:
            result.diagnostics["direct_gross_profit"] = AMBIGUOUS
        return
    result.direct_gross_profit_value = decimal_text(direct.fact.value)
    result.provenance["direct_gp_provenance"] = _fact_provenance(
        direct,
        role=role,
        presentation_file=pre_file,
        presentation_sha256=pre_sha,
        summary=bundle.summary,
        reason="diagnostic only · canonical GP는 언제나 revenue - cogs",
    )
    if result.gross_profit_value is None:
        result.gross_profit_tieout_status = TIEOUT_UNAVAILABLE
        return
    reconstructed = Decimal(result.gross_profit_value)
    result.gross_profit_tieout_status = (
        TIEOUT_EXACT if direct.fact.value == reconstructed else TIEOUT_MISMATCH
    )


def _resolve_assets(bundle, result, facts, dpe, role):
    role_obj, pre_file, pre_sha = _role_context(bundle, role)
    if role_obj is None:
        result.assets_status = MISSING
        result.diagnostics.setdefault("assets", "NO_BALANCE_SHEET_ROLE")
        return

    def at_instant(local):
        return [
            b
            for b in facts
            if _standard(b, local)
            and _target_dimensionless(b, bundle.cik)
            and b.context.instant == dpe
            and _usd_monetary(b)
            and _in_role(role_obj, b)
        ]

    assets, status = _unique_value(at_instant(ASSETS_LOCAL))
    if assets is None:
        result.assets_status = status
        result.diagnostics["assets"] = f"ASSETS_{status}"
        return
    lse, lse_status = _unique_value(at_instant(LIABILITIES_AND_SE_LOCAL))
    if lse is None:
        result.assets_tieout_status = TIEOUT_UNAVAILABLE
        result.assets_value = decimal_text(assets.fact.value)
        result.assets_status = RESOLVED
    elif lse.fact.value == assets.fact.value:
        result.assets_tieout_status = VALIDATED
        result.assets_value = decimal_text(assets.fact.value)
        result.assets_status = RESOLVED
    else:
        result.assets_tieout_status = TIEOUT_MISMATCH
        result.assets_status = UNRESOLVED
        result.diagnostics["assets"] = "ASSETS_TIEOUT_MISMATCH"
    result.provenance["assets_provenance"] = _fact_provenance(
        assets,
        role=role,
        presentation_file=pre_file,
        presentation_sha256=pre_sha,
        summary=bundle.summary,
        reason="balance-sheet role · dimensionless · instant == DocumentPeriodEndDate",
    )
    if lse is not None:
        result.provenance["assets_tieout_provenance"] = _fact_provenance(
            lse,
            role=role,
            presentation_file=pre_file,
            presentation_sha256=pre_sha,
            summary=bundle.summary,
            reason="Assets == LiabilitiesAndStockholdersEquity exact validation",
        )


def _resolve_equity(bundle, result, facts, dpe, role):
    role_obj, pre_file, pre_sha = _role_context(bundle, role)
    if role_obj is None:
        result.parent_se_status = MISSING
        result.preferred_status = MISSING
        result.diagnostics.setdefault("parent_se", "NO_BALANCE_SHEET_ROLE")
        result.diagnostics.setdefault("preferred", "NO_BALANCE_SHEET_ROLE")
        return

    def at_instant(local, *, dimensionless=True, in_role=True):
        return [
            b
            for b in facts
            if _standard(b, local)
            and b.context.cik == bundle.cik
            and (b.context.dimensionless if dimensionless else True)
            and b.context.instant == dpe
            and (_in_role(role_obj, b) if in_role else True)
        ]

    def monetary(bounds):
        return [b for b in bounds if _usd_monetary(b)]

    direct, direct_status = _unique_value(monetary(at_instant(PARENT_SE_LOCAL)))
    incl, incl_status = _unique_value(monetary(at_instant(SE_INCLUDING_NCI_LOCAL)))
    nci, nci_status = _unique_value(monetary(at_instant(MINORITY_INTEREST_LOCAL)))

    if direct is not None:
        result.parent_se_value = decimal_text(direct.fact.value)
        result.parent_se_status = RESOLVED
        result.parent_se_path = DIRECT_PARENT_SE
        result.provenance["parent_se_provenance"] = _fact_provenance(
            direct,
            role=role,
            presentation_file=pre_file,
            presentation_sha256=pre_sha,
            summary=bundle.summary,
            reason="direct parent stockholders' equity",
        )
        result.nci_tieout_status = _nci_tieout(
            result, bundle, direct, incl, nci, role, pre_file, pre_sha
        )
    else:
        mezz = [
            b
            for b in at_instant(MEZZANINE_LOCALS, dimensionless=False)
            if b.fact.value is not None and b.fact.value != 0
        ]
        if mezz:
            result.parent_se_status = UNRESOLVED
            result.diagnostics["parent_se"] = PARENT_EQUITY_SCOPE_AMBIGUOUS
        elif incl is not None and nci is not None:
            result.parent_se_value = decimal_text(incl.fact.value - nci.fact.value)
            result.parent_se_status = RESOLVED
            result.parent_se_path = INCLUDING_NCI_MINUS_NCI
            result.nci_tieout_status = PARENT_RECONSTRUCTED
            result.provenance["parent_se_provenance"] = {
                "path": INCLUDING_NCI_MINUS_NCI,
                "including_nci": _fact_provenance(
                    incl,
                    role=role,
                    presentation_file=pre_file,
                    presentation_sha256=pre_sha,
                    summary=bundle.summary,
                    reason="fallback numerator",
                ),
                "minority_interest": _fact_provenance(
                    nci,
                    role=role,
                    presentation_file=pre_file,
                    presentation_sha256=pre_sha,
                    summary=bundle.summary,
                    reason="fallback subtrahend",
                ),
                "note": "algebraic identity라 자기 자신으로 재검증하지 않는다",
            }
        else:
            result.parent_se_status = (
                AMBIGUOUS
                if AMBIGUOUS in (direct_status, incl_status, nci_status)
                else MISSING
            )
            result.diagnostics["parent_se"] = (
                f"direct={direct_status} incl={incl_status} nci={nci_status}"
            )

    _resolve_preferred(bundle, result, facts, dpe, role, role_obj, pre_file, pre_sha)


def _nci_tieout(result, bundle, direct, incl, nci, role, pre_file, pre_sha):
    if incl is None or nci is None:
        return TIEOUT_UNAVAILABLE
    gap = abs(incl.fact.value - (direct.fact.value + nci.fact.value))
    allowed = (
        half_width(incl.fact.decimals)
        + half_width(direct.fact.decimals)
        + half_width(nci.fact.decimals)
    )
    result.provenance["nci_tieout_provenance"] = {
        "gap": decimal_text(gap),
        "allowed_half_width_sum": decimal_text(allowed),
        "including_nci": _fact_provenance(
            incl,
            role=role,
            presentation_file=pre_file,
            presentation_sha256=pre_sha,
            summary=bundle.summary,
            reason="tie-out term",
        ),
        "minority_interest": _fact_provenance(
            nci,
            role=role,
            presentation_file=pre_file,
            presentation_sha256=pre_sha,
            summary=bundle.summary,
            reason="tie-out term",
        ),
    }
    if gap == 0:
        return VALIDATED
    if gap <= allowed:
        return ROUNDING_COMPATIBLE
    return TIEOUT_MISMATCH


def _resolve_preferred(bundle, result, facts, dpe, role, role_obj, pre_file, pre_sha):
    def at_instant(local, *, dimensionless=True):
        return [
            b
            for b in facts
            if _standard(b, local)
            and b.context.cik == bundle.cik
            and (b.context.dimensionless if dimensionless else True)
            and b.context.instant == dpe
            and _in_role(role_obj, b)
        ]

    liq, liq_status = _unique_value(
        [b for b in at_instant(PREFERRED_LIQUIDATION_LOCALS) if _usd_monetary(b)]
    )
    par, par_status = _unique_value(
        [b for b in at_instant(frozenset({PREFERRED_VALUE_LOCAL})) if _usd_monetary(b)]
    )
    shares = [
        b
        for b in at_instant(PREFERRED_SHARE_LOCALS)
        if b.fact.value is not None
    ]
    zero_shares = bool(shares) and all(b.fact.value == 0 for b in shares)
    positive_shares = any(b.fact.value is not None and b.fact.value > 0 for b in shares)
    element_present = bool(
        at_instant(frozenset({PREFERRED_VALUE_LOCAL}), dimensionless=False)
        or (role_obj is not None
            and any(
                is_us_gaap(ns) and local == PREFERRED_VALUE_LOCAL
                for ns, local in role_obj.concepts()
            ))
    )
    nonzero_amount = any(
        b.fact.value not in (None, 0) for b in ([liq] if liq else []) + ([par] if par else [])
    )

    if zero_shares and nonzero_amount:
        result.preferred_status = PREF_UNRESOLVED
        result.diagnostics["preferred"] = "CONTRADICTORY_ZERO_SHARES_AND_AMOUNT"
        return
    if liq is not None:
        result.preferred_value = decimal_text(liq.fact.value)
        result.preferred_status = RESOLVED
        result.preferred_tier = LIQUIDATION
        result.provenance["preferred_provenance"] = _fact_provenance(
            liq,
            role=role,
            presentation_file=pre_file,
            presentation_sha256=pre_sha,
            summary=bundle.summary,
            reason="liquidation preference tier",
        )
        return
    if par is not None:
        result.preferred_value = decimal_text(par.fact.value)
        result.preferred_status = RESOLVED
        result.preferred_tier = PAR_CARRYING
        result.provenance["preferred_provenance"] = _fact_provenance(
            par,
            role=role,
            presentation_file=pre_file,
            presentation_sha256=pre_sha,
            summary=bundle.summary,
            reason="par / carrying tier",
        )
        return
    if zero_shares:
        result.preferred_value = "0"
        result.preferred_status = RESOLVED
        result.preferred_tier = ZERO
        result.provenance["preferred_provenance"] = {
            "reason": "explicit zero preferred shares evidence",
            "role": role,
        }
        return
    if not element_present and not positive_shares:
        result.preferred_value = "0"
        result.preferred_status = RESOLVED
        result.preferred_tier = ZERO
        result.provenance["preferred_provenance"] = {
            "reason": "balance-sheet presentation completeness inference "
            "(no PreferredStockValue element in the consolidated balance-sheet role, "
            "dimension 포함). numeric zero fact가 아니다",
            "role": role,
        }
        return
    result.preferred_status = PREF_UNRESOLVED
    result.diagnostics["preferred"] = (
        "PREFERRED_PRESENT_BUT_NO_USABLE_DIMENSIONLESS_AMOUNT"
        if element_present or positive_shares
        else f"liq={liq_status} par={par_status}"
    )


def _resolve_book_equity(result: AccountingResult) -> None:
    """BE = Parent SE - Preferred. DT/ITC contribution은 언제나 0이다."""
    if result.parent_se_status != RESOLVED or result.preferred_status != RESOLVED:
        result.book_equity_status = UNRESOLVED
        result.diagnostics.setdefault(
            "book_equity",
            f"parent_se={result.parent_se_status} preferred={result.preferred_status}",
        )
        return
    parent = Decimal(result.parent_se_value)
    preferred = Decimal(result.preferred_value)
    result.book_equity_value = decimal_text(parent - preferred)
    result.book_equity_status = RESOLVED


_INSERT_SQL = """
INSERT INTO qv_accounting_filings
 (cik, accession, filing_source_version, accounting_source, accounting_source_version,
  accounting_definition_version, fiscal_period_end, period_crosscheck_status,
  income_statement_role, balance_sheet_role,
  revenue_value, revenue_status, cogs_value, cogs_status,
  gross_profit_value, gross_profit_status,
  direct_gross_profit_value, gross_profit_tieout_status,
  assets_value, assets_status, assets_tieout_status,
  parent_se_value, parent_se_status, parent_se_path, nci_tieout_status,
  preferred_value, preferred_status, preferred_tier,
  book_equity_value, book_equity_status,
  revenue_provenance, cogs_provenance, direct_gp_provenance,
  assets_provenance, assets_tieout_provenance,
  parent_se_provenance, nci_tieout_provenance, preferred_provenance,
  bundle_provenance, diagnostics)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
"""


def _json(value) -> str | None:
    if value is None:
        return None
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def _bundle_provenance(bundle: AccessionBundle, source: str, version: str) -> dict:
    return {
        "target_cik": bundle.cik,
        "accession": bundle.accession,
        "index_xml_names": list(bundle.index_names),
        "file_sha256": dict(sorted(bundle.file_hashes.items())),
        "instances": [d.source_file for d in bundle.instances],
        "presentations": [d.source_file for d in bundle.presentations],
        "accounting_source": source,
        "accounting_source_version": version,
        "contract_commit": ACCOUNTING_CONTRACT_COMMIT,
    }


def ingest_accounting(
    connection: sqlite3.Connection,
    client,
    *,
    cik: object,
    filing_source_version: str,
    accounting_source: str,
    accounting_source_version: str,
    accounting_definition_version: str = ACCOUNTING_DEFINITION_VERSION,
) -> int:
    """한 target CIK의 annual filing을 canonical accounting observation으로 적재한다."""
    normalized = normalize_cik(cik)
    if normalized is None:
        raise QVAccountingError(f"cik가 10자리 숫자가 아닙니다: {cik!r}")
    for name, value in (
        ("filing_source_version", filing_source_version),
        ("accounting_source", accounting_source),
        ("accounting_source_version", accounting_source_version),
        ("accounting_definition_version", accounting_definition_version),
    ):
        if not str(value or "").strip():
            raise QVAccountingError(f"{name}는 비울 수 없습니다.")

    rows = connection.execute(
        "SELECT accession, form, report_date FROM qv_sec_filings"
        " WHERE cik = ? AND source_version = ? AND form IN (?, ?)"
        " ORDER BY accession",
        (normalized, filing_source_version, *ANNUAL_FORMS),
    ).fetchall()

    payload = []
    for row in rows:
        bundle = fetch_bundle(client, normalized, row["accession"])
        result = resolve_accounting(bundle, report_date=row["report_date"])
        payload.append(
            (
                normalized,
                row["accession"],
                filing_source_version,
                accounting_source,
                accounting_source_version,
                accounting_definition_version,
                result.fiscal_period_end,
                result.period_crosscheck_status,
                result.income_statement_role,
                result.balance_sheet_role,
                result.revenue_value,
                result.revenue_status,
                result.cogs_value,
                result.cogs_status,
                result.gross_profit_value,
                result.gross_profit_status,
                result.direct_gross_profit_value,
                result.gross_profit_tieout_status,
                result.assets_value,
                result.assets_status,
                result.assets_tieout_status,
                result.parent_se_value,
                result.parent_se_status,
                result.parent_se_path,
                result.nci_tieout_status,
                result.preferred_value,
                result.preferred_status,
                result.preferred_tier,
                result.book_equity_value,
                result.book_equity_status,
                _json(result.provenance.get("revenue_provenance")),
                _json(result.provenance.get("cogs_provenance")),
                _json(result.provenance.get("direct_gp_provenance")),
                _json(result.provenance.get("assets_provenance")),
                _json(result.provenance.get("assets_tieout_provenance")),
                _json(result.provenance.get("parent_se_provenance")),
                _json(result.provenance.get("nci_tieout_provenance")),
                _json(result.provenance.get("preferred_provenance")),
                _json(
                    _bundle_provenance(
                        bundle, accounting_source, accounting_source_version
                    )
                ),
                _json(result.diagnostics) or "{}",
            )
        )

    try:
        with connection:
            connection.executemany(_INSERT_SQL, payload)
    except sqlite3.IntegrityError as error:
        raise QVAccountingError(
            f"이 accounting source/definition version에 이미 있는 row입니다 ({error})."
            " 개정본은 덮지 않고 새 accounting_source_version으로 적재하세요."
        ) from error
    return len(payload)


def accounting_for_formation(
    connection: sqlite3.Connection,
    *,
    cik: object,
    fiscal_period_end_year: int,
    formation_session: str,
    filing_source_version: str,
    accounting_source_version: str,
    accounting_definition_version: str = ACCOUNTING_DEFINITION_VERSION,
) -> sqlite3.Row | None:
    """formation까지 usable한 annual filing 하나를 README §3.1대로 고른다.

    **고른 filing의 accounting이 실패했다고 더 오래된 filing으로 물러나지 않는다.**
    filing을 먼저 PIT 규칙으로 고른 뒤 그 filing의 상태를 그대로 돌려준다.
    """
    normalized = normalize_cik(cik)
    if normalized is None:
        raise QVAccountingError(f"cik가 10자리 숫자가 아닙니다: {cik!r}")
    return connection.execute(
        "SELECT a.*, f.form, f.acceptance_datetime, f.historical_usable_session"
        " FROM qv_accounting_filings AS a"
        " JOIN qv_sec_filings AS f"
        "   ON f.cik = a.cik AND f.accession = a.accession"
        "  AND f.source_version = a.filing_source_version"
        " WHERE a.cik = ? AND a.filing_source_version = ?"
        "   AND a.accounting_source_version = ?"
        "   AND a.accounting_definition_version = ?"
        "   AND f.form IN (?, ?)"
        "   AND f.historical_usable_session IS NOT NULL"
        "   AND f.historical_usable_session <= ?"
        "   AND a.fiscal_period_end IS NOT NULL"
        "   AND CAST(substr(a.fiscal_period_end, 1, 4) AS INTEGER) = ?"
        " ORDER BY f.acceptance_datetime DESC, f.accession DESC LIMIT 1",
        (
            normalized,
            filing_source_version,
            accounting_source_version,
            accounting_definition_version,
            *ANNUAL_FORMS,
            formation_session,
            int(fiscal_period_end_year),
        ),
    ).fetchone()


def preferred_tier_transitions(
    observations: list[tuple[int, str | None]]
) -> tuple[int, ...]:
    """인접 회계연도에서 preferred tier가 par/carrying <-> liquidation로 바뀐 연도.

    저장 primitive는 accession별 tier뿐이고 이 진단은 순수 함수로 파생한다.
    값을 바꾸거나 backfill하지 않는다.
    """
    ordered = sorted((year, tier) for year, tier in observations)
    unstable: list[int] = []
    swap = {LIQUIDATION, PAR_CARRYING}
    for (_, previous), (year, current) in zip(ordered, ordered[1:]):
        if previous in swap and current in swap and previous != current:
            unstable.append(year)
    return tuple(unstable)
