"""QV canonical accounting ledger의 동결 계약 회귀. 네트워크를 쓰지 않는다."""

from __future__ import annotations

import json
import sqlite3
import sys
import unittest
from decimal import Decimal
from pathlib import Path

TRADING_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TRADING_ROOT))

from backtest import store  # noqa: E402
from backtest.qv_accounting import (  # noqa: E402
    ACCOUNTING_CONTRACT_COMMIT,
    ACCOUNTING_DEFINITION_VERSION,
    AMBIGUOUS,
    AMBIGUOUS_STATEMENT_ROLE,
    DIRECT_PARENT_SE,
    INCLUDING_NCI_MINUS_NCI,
    LIQUIDATION,
    MISSING,
    PAR_CARRYING,
    PARENT_EQUITY_SCOPE_AMBIGUOUS,
    PARENT_RECONSTRUCTED,
    PERIOD_CROSSCHECK_MISMATCH,
    PERIOD_CROSSCHECK_OK,
    PERIOD_CROSSCHECK_UNAVAILABLE,
    PREF_UNRESOLVED,
    QVAccountingError,
    RESOLVED,
    ROUNDING_COMPATIBLE,
    TIEOUT_EXACT,
    TIEOUT_INPUT_AMBIGUOUS,
    TIEOUT_MISMATCH,
    TIEOUT_UNAVAILABLE,
    UNRESOLVED,
    VALIDATED,
    ZERO,
    accounting_for_formation,
    decimal_text,
    fetch_bundle,
    half_width,
    ingest_accounting,
    preferred_tier_transitions,
    resolve_accounting,
)
from tests.fixtures.qv_xbrl import builder as B  # noqa: E402

CIK = "0000320193"
OTHER_CIK = "0000037634"
ACCESSION = "0000320193-24-000001"
DPE = "2023-12-31"
START = "2023-01-01"
BS_ROLE = "http://acme.com/role/ConsolidatedBalanceSheets"
IS_ROLE = "http://acme.com/role/ConsolidatedStatementsOfIncome"
SECOND_IS_ROLE = "http://acme.com/role/ConsolidatedStatementsOfOperations"
EQUITY_ROLE = "http://acme.com/role/ConsolidatedStatementsOfEquity"
NOTE_ROLE = "http://acme.com/role/SegmentDetails"
LEGAL_ENTITY_AXIS = "us-gaap:LegalEntityAxis"
CLASS_AXIS = "us-gaap:StatementClassOfStockAxis"

FILING_SOURCE_VERSION = "sec-submissions-fixture-v1"
ACCOUNTING_SOURCE = "sec-accession-xbrl"
ACCOUNTING_SOURCE_VERSION = "sec-xbrl-fixture-v1"

INSTANCE_NAME = "acme-20231231.xml"
PRESENTATION_NAME = "acme-20231231_pre.xml"


class FakeClient:
    """accession 파일을 메모리에서 제공한다. SEC 네트워크를 쓰지 않는다."""

    def __init__(self, files: dict[str, bytes], *, fail: set[str] | None = None):
        self.files = files
        self.fail = fail or set()

    def accession_index(self, cik, accession):
        if "index" in self.fail:
            raise OSError("index unavailable")
        return {"directory": {"item": [{"name": n} for n in sorted(self.files)]}}

    def accession_file_bytes(self, cik, accession, name):
        if name in self.fail:
            raise OSError(f"unavailable: {name}")
        if name not in self.files:
            raise OSError(f"missing: {name}")
        return self.files[name]


def _dei_period(context_id: str = "dpe", *, end: str = DPE) -> str:
    return (
        f'<dei:DocumentPeriodEndDate contextRef="{context_id}">{end}'
        "</dei:DocumentPeriodEndDate>"
    )


CALCULATION_NAME = "acme-20231231_cal.xml"
SCHEMA_NAME = "acme-20231231.xsd"
SUMMATION_ITEM = "http://www.xbrl.org/2003/arcrole/summation-item"


def calculation_xml(roles, *, embedded_in_schema=False):
    """role -> [arc dict]. `builder.py`를 건드리지 않으려고 여기서 만든다."""
    links = []
    for role, arcs in roles.items():
        labels = {}
        locs = []
        for arc in arcs:
            for fragment in (arc["parent"], arc["child"]):
                if fragment in labels:
                    continue
                label = f"loc_{len(labels)}"
                labels[fragment] = label
                locs.append(
                    f'<link:loc xlink:type="locator" xlink:href="{SCHEMA_NAME}#{fragment}"'
                    f' xlink:label="{label}"/>'
                )
        arc_xml = []
        for index, arc in enumerate(arcs):
            attrs = [
                'xlink:type="arc"',
                f'xlink:arcrole="{arc.get("arcrole", SUMMATION_ITEM)}"',
                f'xlink:from="{labels[arc["parent"]]}"',
                f'xlink:to="{labels[arc["child"]]}"',
                f'order="{arc.get("order", index + 1)}"',
                f'weight="{arc.get("weight", "1")}"',
            ]
            if "use" in arc:
                attrs.append(f'use="{arc["use"]}"')
            if "priority" in arc:
                attrs.append(f'priority="{arc["priority"]}"')
            arc_xml.append(f"<link:calculationArc {' '.join(attrs)}/>")
        links.append(
            f'<link:calculationLink xlink:type="extended" xlink:role="{role}">'
            + "".join(locs)
            + "".join(arc_xml)
            + "</link:calculationLink>"
        )
    body = "".join(links)
    if embedded_in_schema:
        return (
            '<?xml version="1.0" encoding="UTF-8"?>'
            '<xsd:schema xmlns:xsd="http://www.w3.org/2001/XMLSchema"'
            ' xmlns:link="http://www.xbrl.org/2003/linkbase"'
            ' xmlns:xlink="http://www.w3.org/1999/xlink">'
            f"<xsd:annotation><xsd:appinfo>{body}</xsd:appinfo></xsd:annotation>"
            "</xsd:schema>"
        ).encode("utf-8")
    return (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<link:linkbase xmlns:link="http://www.xbrl.org/2003/linkbase"'
        ' xmlns:xlink="http://www.w3.org/1999/xlink">'
        + body
        + "</link:linkbase>"
    ).encode("utf-8")


def build_files(
    *,
    contexts: list[str],
    facts: list[str],
    roles: dict[str, list[tuple[str, str]]],
    reports: list[dict] | None = None,
    extra_units: str = "",
    calculation: dict | None = None,
    calculation_embedded: bool = False,
) -> dict[str, bytes]:
    if reports is None:
        reports = [
            {
                "Role": BS_ROLE,
                "MenuCategory": "Statements",
                "LongName": "1 - Statement - Consolidated Balance Sheets",
                "ShortName": "Consolidated Balance Sheets",
            },
            {
                "Role": IS_ROLE,
                "MenuCategory": "Statements",
                "LongName": "2 - Statement - Consolidated Statements Of Income",
                "ShortName": "Consolidated Statements Of Income",
            },
            {
                "Role": EQUITY_ROLE,
                "MenuCategory": "Statements",
                "LongName": "3 - Statement - Consolidated Statements Of Equity",
                "ShortName": "Consolidated Statements Of Equity",
            },
            {
                "Role": NOTE_ROLE,
                "MenuCategory": "Details",
                "LongName": "9 - Disclosure - Segment (Details)",
                "ShortName": "Segment",
            },
        ]
    files = {
        "FilingSummary.xml": B.filing_summary(
            reports, input_files=[INSTANCE_NAME, PRESENTATION_NAME]
        ),
        INSTANCE_NAME: B.instance(contexts, facts, extra_units=extra_units),
        PRESENTATION_NAME: B.presentation(roles),
    }
    if calculation:
        name = SCHEMA_NAME if calculation_embedded else CALCULATION_NAME
        files[name] = calculation_xml(
            calculation, embedded_in_schema=calculation_embedded
        )
    return files


def base_contexts(extra: list[str] | None = None) -> list[str]:
    return [
        B.context("dpe", cik=CIK, start=START, end=DPE),
        B.context("i", cik=CIK, instant=DPE),
        B.context("d", cik=CIK, start=START, end=DPE),
    ] + (extra or [])


def us(local: str) -> str:
    return f"us-gaap_{local}"


def resolve(files: dict[str, bytes], *, report_date: str | None = DPE):
    bundle = fetch_bundle(FakeClient(files), CIK, ACCESSION)
    return resolve_accounting(bundle, report_date=report_date)


def simple_roles(
    *,
    income: list[str],
    balance: list[str],
    note: list[str] | None = None,
    equity: list[str] | None = None,
    income_arcs: list[tuple[str, str]] | None = None,
) -> dict[str, list[tuple[str, str]]]:
    roles = {
        IS_ROLE: income_arcs
        or [(us("IncomeStatementAbstract"), us(local)) for local in income],
        BS_ROLE: [(us("StatementOfFinancialPositionAbstract"), us(local)) for local in balance],
    }
    if note:
        roles[NOTE_ROLE] = [(us("SegmentAbstract"), us(local)) for local in note]
    if equity:
        roles[EQUITY_ROLE] = [(us("StatementOfStockholdersEquityAbstract"), us(local)) for local in equity]
    return roles


class HalfWidthTest(unittest.TestCase):
    def test_declared_decimals_drive_the_interval(self):
        self.assertEqual(half_width("-6"), Decimal("500000"))
        self.assertEqual(half_width("-3"), Decimal("500"))
        self.assertEqual(half_width("0"), Decimal("0.5"))

    def test_missing_or_infinite_decimals_require_exact(self):
        self.assertEqual(half_width(None), Decimal(0))
        self.assertEqual(half_width("INF"), Decimal(0))
        self.assertEqual(half_width(""), Decimal(0))

    def test_decimal_text_has_no_scientific_notation(self):
        self.assertEqual(decimal_text(Decimal("1E+11")), "100000000000")
        self.assertEqual(decimal_text(Decimal("-1791000000")), "-1791000000")
        self.assertIsNone(decimal_text(None))


class AnnualDurationSelectionTest(unittest.TestCase):
    def _resolve(
        self,
        *,
        dpe: str,
        contexts: list[str],
        facts: list[str],
        roles: dict[str, list[tuple[str, str]]],
        reports: list[dict] | None = None,
    ):
        dpe_context_start = f"{int(dpe[:4]) - 1:04d}-01-01"
        files = build_files(
            contexts=[B.context("dpe", cik=CIK, start=dpe_context_start, end=dpe)]
            + contexts,
            facts=[_dei_period(end=dpe)] + facts,
            roles=roles,
            reports=reports,
        )
        return resolve(files, report_date=dpe)

    def _single_statement_result(self, *, start: str, end: str):
        return self._resolve(
            dpe=end,
            contexts=[B.context("annual", cik=CIK, start=start, end=end)],
            facts=[B.fact("us-gaap", "Revenues", "annual", "100")],
            roles={IS_ROLE: [(us("IncomeStatementAbstract"), us("Revenues"))]},
        )

    def test_orcl_same_dpe_unrelated_note_context_does_not_pollute_period(self):
        dpe = "2020-05-31"
        result = self._resolve(
            dpe=dpe,
            contexts=[
                B.context("annual", cik=CIK, start="2019-06-01", end=dpe),
                B.context("note", cik=CIK, start="2019-06-02", end=dpe),
            ],
            facts=[
                B.fact("us-gaap", "Revenues", "annual", "100"),
                B.fact(
                    "us-gaap",
                    "RightOfUseAssetObtainedInExchangeForOperatingLeaseLiability",
                    "note",
                    "5",
                ),
            ],
            roles={
                IS_ROLE: [(us("IncomeStatementAbstract"), us("Revenues"))],
                NOTE_ROLE: [
                    (
                        us("LeasesAbstract"),
                        us("RightOfUseAssetObtainedInExchangeForOperatingLeaseLiability"),
                    )
                ],
            },
        )
        self.assertEqual(result.income_statement_role, IS_ROLE)
        self.assertEqual(
            result.provenance["revenue_provenance"]["start"], "2019-06-01"
        )
        self.assertNotIn("annual_period", result.diagnostics)

    def test_52_week_statement_revenue_selects_363_day_period(self):
        result = self._single_statement_result(start="2023-01-01", end="2023-12-30")
        self.assertEqual(
            result.provenance["revenue_provenance"]["start"], "2023-01-01"
        )

    def test_53_week_statement_revenue_selects_370_day_period(self):
        result = self._single_statement_result(start="2021-12-26", end="2022-12-31")
        self.assertEqual(
            result.provenance["revenue_provenance"]["start"], "2021-12-26"
        )

    def test_structural_selector_has_no_fixed_minimum_days(self):
        result = self._single_statement_result(start="2023-04-01", end="2023-12-31")
        self.assertEqual(
            result.provenance["revenue_provenance"]["start"], "2023-04-01"
        )

    def test_period_candidates_require_target_dimensionless_usd_facts(self):
        result = self._resolve(
            dpe=DPE,
            contexts=[
                B.context("annual", cik=CIK, start="2023-04-01", end=DPE),
                B.context("other", cik=OTHER_CIK, start=START, end=DPE),
                B.context(
                    "dimensioned",
                    cik=CIK,
                    start="2023-02-01",
                    end=DPE,
                    dimensions=((LEGAL_ENTITY_AXIS, "acme:SubsidiaryMember"),),
                ),
                B.context("shares", cik=CIK, start="2023-03-01", end=DPE),
            ],
            facts=[
                B.fact("us-gaap", "Revenues", "annual", "100"),
                B.fact("us-gaap", "Revenues", "other", "200"),
                B.fact("us-gaap", "Revenues", "dimensioned", "300"),
                B.fact("us-gaap", "Revenues", "shares", "400", unit="shares"),
            ],
            roles={IS_ROLE: [(us("IncomeStatementAbstract"), us("Revenues"))]},
        )
        self.assertEqual(
            result.provenance["revenue_provenance"]["start"], "2023-04-01"
        )

    def test_unparseable_and_nonpositive_durations_are_ineligible(self):
        result = self._resolve(
            dpe=DPE,
            contexts=[
                B.context("annual", cik=CIK, start="2023-04-01", end=DPE),
                B.context("malformed", cik=CIK, start="not-a-date", end=DPE),
                B.context("reversed", cik=CIK, start="2024-01-01", end=DPE),
            ],
            facts=[
                B.fact("us-gaap", "Revenues", "annual", "100"),
                B.fact("us-gaap", "Revenues", "malformed", "200"),
                B.fact("us-gaap", "Revenues", "reversed", "300"),
            ],
            roles={IS_ROLE: [(us("IncomeStatementAbstract"), us("Revenues"))]},
        )
        self.assertEqual(
            result.provenance["revenue_provenance"]["start"], "2023-04-01"
        )

    def test_longest_statement_revenue_beats_quarterly_revenue(self):
        result = self._resolve(
            dpe=DPE,
            contexts=[
                B.context("annual", cik=CIK, start=START, end=DPE),
                B.context("quarter", cik=CIK, start="2023-10-01", end=DPE),
            ],
            facts=[
                B.fact("us-gaap", "Revenues", "annual", "100"),
                B.fact("us-gaap", "Revenues", "quarter", "25"),
            ],
            roles={IS_ROLE: [(us("IncomeStatementAbstract"), us("Revenues"))]},
        )
        self.assertEqual(result.revenue_value, "100")
        self.assertEqual(result.provenance["revenue_provenance"]["start"], START)

    def test_distinct_longest_start_tie_fails_close(self):
        result = self._resolve(
            dpe=DPE,
            contexts=[
                B.context("annual_a", cik=CIK, start="2023-01-01", end=DPE),
                B.context("annual_b", cik=CIK, start="20230101", end=DPE),
            ],
            facts=[
                B.fact("us-gaap", "Revenues", "annual_a", "100"),
                B.fact("us-gaap", "Revenues", "annual_b", "100"),
            ],
            roles={IS_ROLE: [(us("IncomeStatementAbstract"), us("Revenues"))]},
        )
        self.assertIsNone(result.revenue_value)
        self.assertTrue(
            result.diagnostics["annual_period"].startswith("ANNUAL_PERIOD_AMBIGUOUS")
        )

    def test_multiple_statement_roles_fail_close_before_duration_choice(self):
        result = self._resolve(
            dpe=DPE,
            contexts=[B.context("annual", cik=CIK, start=START, end=DPE)],
            facts=[B.fact("us-gaap", "Revenues", "annual", "100")],
            roles={
                IS_ROLE: [(us("IncomeStatementAbstract"), us("Revenues"))],
                SECOND_IS_ROLE: [(us("OperationsAbstract"), us("Revenues"))],
            },
            reports=[
                {
                    "Role": IS_ROLE,
                    "MenuCategory": "Statements",
                    "LongName": "1 - Statement - Consolidated Statements Of Income",
                },
                {
                    "Role": SECOND_IS_ROLE,
                    "MenuCategory": "Statements",
                    "LongName": "2 - Statement - Consolidated Statements Of Operations",
                },
            ],
        )
        self.assertIsNone(result.income_statement_role)
        self.assertEqual(
            result.diagnostics["income_statement_role"], AMBIGUOUS_STATEMENT_ROLE
        )
        self.assertIsNone(result.revenue_value)

    def test_custom_revenue_does_not_define_annual_period(self):
        result = self._resolve(
            dpe=DPE,
            contexts=[B.context("annual", cik=CIK, start=START, end=DPE)],
            facts=[B.fact("acme", "SubscriptionRevenue", "annual", "100")],
            roles={IS_ROLE: [("acme_IncomeStatementAbstract", "acme_SubscriptionRevenue")]},
        )
        self.assertIsNone(result.income_statement_role)
        self.assertEqual(
            result.diagnostics["income_statement_role"], "UNRESOLVED_STATEMENT_ROLE"
        )
        self.assertIsNone(result.revenue_value)

    def test_filing_summary_category_conflict_is_not_rescued_by_long_name(self):
        result = self._resolve(
            dpe=DPE,
            contexts=[B.context("annual", cik=CIK, start=START, end=DPE)],
            facts=[B.fact("us-gaap", "Revenues", "annual", "100")],
            roles={IS_ROLE: [(us("IncomeStatementAbstract"), us("Revenues"))]},
            reports=[
                {
                    "Role": IS_ROLE,
                    "MenuCategory": "Uncategorized",
                    "LongName": "1 - Statement - Consolidated Statements Of Income",
                }
            ],
        )
        self.assertIsNone(result.income_statement_role)
        self.assertEqual(
            result.diagnostics["income_statement_role"], "UNRESOLVED_STATEMENT_ROLE"
        )

    def test_tesla_sibling_total_remains_unresolved_after_period_selection(self):
        result = self._resolve(
            dpe=DPE,
            contexts=[B.context("annual", cik=CIK, start=START, end=DPE)],
            facts=[
                B.fact("us-gaap", "SalesRevenueGoodsNet", "annual", "60"),
                B.fact("us-gaap", "SalesRevenueServicesNet", "annual", "40"),
            ],
            roles={
                IS_ROLE: [
                    (us("IncomeStatementAbstract"), us("SalesRevenueGoodsNet")),
                    (us("IncomeStatementAbstract"), us("SalesRevenueServicesNet")),
                ]
            },
        )
        self.assertEqual(result.income_statement_role, IS_ROLE)
        self.assertNotIn("annual_period", result.diagnostics)
        self.assertEqual(result.revenue_status, AMBIGUOUS)
        self.assertTrue(result.diagnostics["revenue"].startswith("REVENUE_AMBIGUOUS"))


class GrossProfitTest(unittest.TestCase):
    def test_costco_shape_note_gross_profit_is_not_a_candidate(self):
        """손익계산서에는 total revenue와 COGS만, GrossProfit은 주석 role에만 있다."""
        files = build_files(
            contexts=base_contexts(),
            facts=[
                _dei_period(),
                B.fact("us-gaap", "RevenueFromContractWithCustomerExcludingAssessedTax", "d", "152703000000"),
                B.fact("us-gaap", "CostOfGoodsAndServicesSold", "d", "132886000000"),
                B.fact("us-gaap", "GrossProfit", "d", "16465000000"),
                B.fact("us-gaap", "Assets", "i", "45400000000"),
            ],
            roles=simple_roles(
                income=["RevenueFromContractWithCustomerExcludingAssessedTax", "CostOfGoodsAndServicesSold"],
                balance=["Assets"],
                note=["GrossProfit"],
            ),
        )
        result = resolve(files)
        self.assertEqual(result.revenue_value, "152703000000")
        self.assertEqual(result.cogs_value, "132886000000")
        self.assertEqual(result.gross_profit_value, "19817000000")
        self.assertIsNone(result.direct_gross_profit_value)
        self.assertEqual(result.gross_profit_tieout_status, TIEOUT_UNAVAILABLE)

    def test_pg_shape_note_revenues_is_excluded(self):
        """`Revenues`가 지역 주석에만 있으면 canonical revenue가 아니다."""
        files = build_files(
            contexts=base_contexts(),
            facts=[
                _dei_period(),
                B.fact("us-gaap", "SalesRevenueNet", "d", "83062000000"),
                B.fact("us-gaap", "Revenues", "d", "29400000000"),
                B.fact("us-gaap", "CostOfGoodsSold", "d", "42460000000"),
                B.fact("us-gaap", "Assets", "i", "144266000000"),
            ],
            roles=simple_roles(
                income=["SalesRevenueNet", "CostOfGoodsSold"],
                balance=["Assets"],
                note=["Revenues"],
            ),
        )
        result = resolve(files)
        self.assertEqual(result.revenue_value, "83062000000")
        self.assertEqual(result.gross_profit_value, "40602000000")

    def test_caterpillar_shape_segment_cogs_is_excluded(self):
        """세그먼트 주석의 CostOfGoodsAndServicesSold가 아니라 손익계산서 COGS를 쓴다."""
        files = build_files(
            contexts=base_contexts(),
            facts=[
                _dei_period(),
                B.fact("us-gaap", "Revenues", "d", "67589000000"),
                B.fact("us-gaap", "CostOfRevenue", "d", "44752000000"),
                B.fact("us-gaap", "CostOfGoodsAndServicesSold", "d", "49000000"),
                B.fact("us-gaap", "Assets", "i", "98585000000"),
            ],
            roles=simple_roles(
                income=["Revenues", "CostOfRevenue"],
                balance=["Assets"],
                note=["CostOfGoodsAndServicesSold"],
            ),
        )
        result = resolve(files)
        self.assertEqual(result.cogs_value, "44752000000")
        self.assertEqual(result.gross_profit_value, "22837000000")

    def test_dimension_only_cogs_is_missing_and_not_summed(self):
        files = build_files(
            contexts=base_contexts(
                [
                    B.context("svc", cik=CIK, start=START, end=DPE,
                              dimensions=(("srt:ProductOrServiceAxis", "us-gaap:ServiceMember"),)),
                    B.context("prd", cik=CIK, start=START, end=DPE,
                              dimensions=(("srt:ProductOrServiceAxis", "us-gaap:ProductMember"),)),
                ]
            ),
            facts=[
                _dei_period(),
                B.fact("us-gaap", "Revenues", "d", "94425000000"),
                B.fact("us-gaap", "CostOfGoodsAndServicesSold", "svc", "52677000000"),
                B.fact("us-gaap", "CostOfGoodsAndServicesSold", "prd", "6089000000"),
                B.fact("us-gaap", "Assets", "i", "196219000000"),
            ],
            roles=simple_roles(
                income=["Revenues", "CostOfGoodsAndServicesSold"], balance=["Assets"]
            ),
        )
        result = resolve(files)
        self.assertEqual(result.revenue_value, "94425000000")
        self.assertEqual(result.cogs_status, MISSING)
        self.assertIsNone(result.cogs_value)
        self.assertEqual(result.gross_profit_status, MISSING)

    def test_direct_gross_profit_exact_tieout(self):
        files = build_files(
            contexts=base_contexts(),
            facts=[
                _dei_period(),
                B.fact("us-gaap", "SalesRevenueNet", "d", "100"),
                B.fact("us-gaap", "CostOfGoodsAndServicesSold", "d", "60"),
                B.fact("us-gaap", "GrossProfit", "d", "40"),
                B.fact("us-gaap", "Assets", "i", "500"),
            ],
            roles=simple_roles(
                income=["SalesRevenueNet", "CostOfGoodsAndServicesSold", "GrossProfit"],
                balance=["Assets"],
            ),
        )
        result = resolve(files)
        self.assertEqual(result.gross_profit_value, "40")
        self.assertEqual(result.direct_gross_profit_value, "40")
        self.assertEqual(result.gross_profit_tieout_status, TIEOUT_EXACT)

    def test_direct_gross_profit_mismatch_keeps_canonical_reconstruction(self):
        files = build_files(
            contexts=base_contexts(),
            facts=[
                _dei_period(),
                B.fact("us-gaap", "Revenues", "d", "152703000000"),
                B.fact("us-gaap", "CostOfGoodsAndServicesSold", "d", "132886000000"),
                B.fact("us-gaap", "GrossProfit", "d", "16465000000"),
                B.fact("us-gaap", "Assets", "i", "45400000000"),
            ],
            roles=simple_roles(
                income=["Revenues", "CostOfGoodsAndServicesSold", "GrossProfit"],
                balance=["Assets"],
            ),
        )
        result = resolve(files)
        self.assertEqual(result.gross_profit_tieout_status, TIEOUT_MISMATCH)
        self.assertEqual(result.gross_profit_value, "19817000000")
        self.assertEqual(result.gross_profit_status, RESOLVED)

    def test_incomparable_revenue_candidates_are_unresolved(self):
        files = build_files(
            contexts=base_contexts(),
            facts=[
                _dei_period(),
                B.fact("us-gaap", "SalesRevenueGoodsNet", "d", "60"),
                B.fact("us-gaap", "SalesRevenueServicesNet", "d", "40"),
                B.fact("us-gaap", "CostOfRevenue", "d", "70"),
                B.fact("us-gaap", "Assets", "i", "500"),
            ],
            roles=simple_roles(
                income=["SalesRevenueGoodsNet", "SalesRevenueServicesNet", "CostOfRevenue"],
                balance=["Assets"],
            ),
        )
        result = resolve(files)
        self.assertEqual(result.revenue_status, AMBIGUOUS)
        self.assertIsNone(result.revenue_value)
        self.assertEqual(result.gross_profit_status, MISSING)

    def test_presentation_hierarchy_alone_no_longer_resolves_revenue(self):
        """multi-candidate Revenue는 calculation-root로만 정해진다 (로드맵 §4.2.1)."""
        files = build_files(
            contexts=base_contexts(),
            facts=[
                _dei_period(),
                B.fact("us-gaap", "Revenues", "d", "100"),
                B.fact("us-gaap", "SalesRevenueGoodsNet", "d", "60"),
                B.fact("us-gaap", "SalesRevenueServicesNet", "d", "40"),
                B.fact("us-gaap", "CostOfRevenue", "d", "70"),
                B.fact("us-gaap", "Assets", "i", "500"),
            ],
            roles={
                IS_ROLE: [
                    (us("IncomeStatementAbstract"), us("Revenues")),
                    (us("Revenues"), us("SalesRevenueGoodsNet")),
                    (us("Revenues"), us("SalesRevenueServicesNet")),
                    (us("IncomeStatementAbstract"), us("CostOfRevenue")),
                ],
                BS_ROLE: [(us("StatementOfFinancialPositionAbstract"), us("Assets"))],
            },
        )
        result = resolve(files)
        self.assertEqual(result.revenue_status, AMBIGUOUS)
        self.assertIsNone(result.revenue_value)
        self.assertIn("no exact-role calculation graph", result.diagnostics["revenue"])
        # COGS는 기존 presentation 구조 selector 그대로다.
        self.assertEqual(result.cogs_value, "70")


class ExactDuplicatePolicyTest(unittest.TestCase):
    """같은 semantic candidate에서 decimals/unit이 갈리면 첫 번째를 고르지 않는다."""

    def _files(self, equity_facts):
        return build_files(
            contexts=base_contexts([B.context("i2", cik=CIK, instant=DPE)]),
            facts=[
                _dei_period(),
                B.fact("us-gaap", "Revenues", "d", "100"),
                B.fact("us-gaap", "CostOfRevenue", "d", "60"),
                B.fact("us-gaap", "Assets", "i", "500"),
            ]
            + equity_facts,
            roles=simple_roles(
                income=["Revenues", "CostOfRevenue"],
                balance=["Assets", "StockholdersEquity"],
            ),
        )

    def test_exact_duplicate_across_context_ids_is_deduped(self):
        result = resolve(
            self._files(
                [
                    B.fact("us-gaap", "StockholdersEquity", "i", "100", decimals="-6"),
                    B.fact("us-gaap", "StockholdersEquity", "i2", "100", decimals="-6"),
                ]
            )
        )
        self.assertEqual(result.parent_se_value, "100")
        self.assertEqual(result.parent_se_status, RESOLVED)

    def test_same_value_different_decimals_is_ambiguous(self):
        result = resolve(
            self._files(
                [
                    B.fact("us-gaap", "StockholdersEquity", "i", "100", decimals="-6"),
                    B.fact("us-gaap", "StockholdersEquity", "i2", "100", decimals="-3"),
                ]
            )
        )
        self.assertNotEqual(result.parent_se_status, RESOLVED)
        self.assertIsNone(result.parent_se_value)

    def test_same_semantic_unit_declared_twice_is_still_one_fact(self):
        """같은 측정단위를 다른 unit id로 선언한 것은 exact duplicate다."""
        files = build_files(
            contexts=base_contexts([B.context("i2", cik=CIK, instant=DPE)]),
            facts=[
                _dei_period(),
                B.fact("us-gaap", "Revenues", "d", "100"),
                B.fact("us-gaap", "CostOfRevenue", "d", "60"),
                B.fact("us-gaap", "Assets", "i", "500"),
                B.fact("us-gaap", "StockholdersEquity", "i", "100", decimals="-6"),
                B.fact("us-gaap", "StockholdersEquity", "i2", "100",
                       unit="usd2", decimals="-6"),
            ],
            roles=simple_roles(
                income=["Revenues", "CostOfRevenue"],
                balance=["Assets", "StockholdersEquity"],
            ),
            extra_units='<xbrli:unit id="usd2">'
            "<xbrli:measure>iso4217:USD</xbrli:measure></xbrli:unit>",
        )
        result = resolve(files)
        self.assertEqual(result.parent_se_value, "100")
        self.assertEqual(result.parent_se_status, RESOLVED)

    def test_non_usd_unit_is_not_a_monetary_candidate(self):
        result = resolve(
            self._files(
                [
                    B.fact("us-gaap", "StockholdersEquity", "i", "100",
                           unit="shares", decimals="-6"),
                ]
            )
        )
        self.assertNotEqual(result.parent_se_status, RESOLVED)
        self.assertIsNone(result.parent_se_value)


class CalculationRootRevenueTest(unittest.TestCase):
    """multi-candidate consolidated total Revenue는 exact-role calculation root로 정한다."""

    def _files(self, revenue_facts, revenue_locals, *, calculation=None,
               calculation_embedded=False, income_arcs=None, extra_contexts=None):
        return build_files(
            contexts=base_contexts(extra_contexts),
            facts=[
                _dei_period(),
                B.fact("us-gaap", "CostOfRevenue", "d", "60"),
                B.fact("us-gaap", "Assets", "i", "500"),
            ]
            + revenue_facts,
            roles=simple_roles(
                income=revenue_locals + ["CostOfRevenue"],
                balance=["Assets"],
                income_arcs=income_arcs,
            ),
            calculation=calculation,
            calculation_embedded=calculation_embedded,
        )

    def test_a_tesla_transitive_custom_intermediate(self):
        """Revenues -> custom subtotal -> SalesRevenueGoodsNet. custom은 evidence only."""
        result = resolve(
            self._files(
                [
                    B.fact("us-gaap", "SalesRevenueGoodsNet", "d", "5589007000"),
                    B.fact("us-gaap", "Revenues", "d", "7000132000"),
                ],
                ["SalesRevenueGoodsNet", "Revenues"],
                calculation={
                    IS_ROLE: [
                        {"parent": "us-gaap_Revenues", "child": "acme_SalesRevenueAutomotive"},
                        {"parent": "acme_SalesRevenueAutomotive",
                         "child": "us-gaap_SalesRevenueGoodsNet"},
                    ]
                },
            )
        )
        self.assertEqual(result.revenue_status, RESOLVED)
        self.assertEqual(result.revenue_value, "7000132000")
        self.assertIn(
            "calculation-root",
            result.provenance["revenue_provenance"]["selection_reason"],
        )

    def test_b_direct_two_candidate_root(self):
        result = resolve(
            self._files(
                [
                    B.fact("us-gaap", "Revenues", "d", "100"),
                    B.fact("us-gaap", "RevenueFromContractWithCustomerExcludingAssessedTax",
                           "d", "80"),
                ],
                ["Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax"],
                calculation={
                    IS_ROLE: [
                        {"parent": "us-gaap_Revenues",
                         "child": "us-gaap_RevenueFromContractWithCustomerExcludingAssessedTax"}
                    ]
                },
            )
        )
        self.assertEqual(result.revenue_value, "100")

    def test_c_no_calculation_role_is_unresolved(self):
        result = resolve(
            self._files(
                [
                    B.fact("us-gaap", "Revenues", "d", "100"),
                    B.fact("us-gaap", "SalesRevenueNet", "d", "80"),
                ],
                ["Revenues", "SalesRevenueNet"],
            )
        )
        self.assertEqual(result.revenue_status, AMBIGUOUS)
        self.assertIsNone(result.revenue_value)
        self.assertIn("no exact-role calculation graph", result.diagnostics["revenue"])

    def test_d_calculation_role_uri_mismatch_is_unresolved(self):
        result = resolve(
            self._files(
                [
                    B.fact("us-gaap", "Revenues", "d", "100"),
                    B.fact("us-gaap", "SalesRevenueNet", "d", "80"),
                ],
                ["Revenues", "SalesRevenueNet"],
                calculation={
                    NOTE_ROLE: [
                        {"parent": "us-gaap_Revenues", "child": "us-gaap_SalesRevenueNet"}
                    ]
                },
            )
        )
        self.assertEqual(result.revenue_status, AMBIGUOUS)
        self.assertIsNone(result.revenue_value)

    def test_e_multiple_roots_is_unresolved(self):
        result = resolve(
            self._files(
                [
                    B.fact("us-gaap", "Revenues", "d", "100"),
                    B.fact("us-gaap", "SalesRevenueNet", "d", "80"),
                ],
                ["Revenues", "SalesRevenueNet"],
                calculation={
                    IS_ROLE: [
                        {"parent": "us-gaap_Revenues", "child": "acme_A"},
                        {"parent": "us-gaap_SalesRevenueNet", "child": "acme_B"},
                    ]
                },
            )
        )
        self.assertEqual(result.revenue_status, AMBIGUOUS)
        self.assertIn("calculation root count=0", result.diagnostics["revenue"])

    def test_f_exact_equal_values_do_not_collapse(self):
        """값이 같아도 concept identity는 calculation root가 정한다."""
        result = resolve(
            self._files(
                [
                    B.fact("us-gaap", "Revenues", "d", "100"),
                    B.fact("us-gaap", "SalesRevenueNet", "d", "100"),
                ],
                ["Revenues", "SalesRevenueNet"],
                calculation={
                    IS_ROLE: [
                        {"parent": "us-gaap_Revenues", "child": "us-gaap_SalesRevenueNet"}
                    ]
                },
            )
        )
        self.assertEqual(result.revenue_status, RESOLVED)
        self.assertEqual(
            result.provenance["revenue_provenance"]["concept_local_name"], "Revenues"
        )

    def test_g_arithmetic_mismatch_does_not_change_identity(self):
        result = resolve(
            self._files(
                [
                    B.fact("us-gaap", "Revenues", "d", "100"),
                    B.fact("us-gaap", "SalesRevenueNet", "d", "80"),
                    B.fact("us-gaap", "SalesRevenueServicesNet", "d", "5"),
                ],
                ["Revenues", "SalesRevenueNet", "SalesRevenueServicesNet"],
                calculation={
                    IS_ROLE: [
                        {"parent": "us-gaap_Revenues", "child": "us-gaap_SalesRevenueNet"},
                        {"parent": "us-gaap_Revenues",
                         "child": "us-gaap_SalesRevenueServicesNet"},
                    ]
                },
            )
        )
        self.assertEqual(result.revenue_value, "100")
        self.assertEqual(result.revenue_status, RESOLVED)

    def test_h_missing_contributor_does_not_create_a_sum(self):
        result = resolve(
            self._files(
                [
                    B.fact("us-gaap", "Revenues", "d", "100"),
                    B.fact("us-gaap", "SalesRevenueNet", "d", "80"),
                ],
                ["Revenues", "SalesRevenueNet"],
                calculation={
                    IS_ROLE: [
                        {"parent": "us-gaap_Revenues", "child": "us-gaap_SalesRevenueNet"},
                        {"parent": "us-gaap_Revenues",
                         "child": "us-gaap_SalesRevenueServicesNet"},
                    ]
                },
            )
        )
        self.assertEqual(result.revenue_value, "100")

    def test_i_single_candidate_needs_no_calculation(self):
        result = resolve(
            self._files(
                [B.fact("us-gaap", "Revenues", "d", "100")],
                ["Revenues"],
            )
        )
        self.assertEqual(result.revenue_value, "100")
        self.assertIn(
            "single candidate",
            result.provenance["revenue_provenance"]["selection_reason"],
        )

    def test_j_note_role_calculation_graph_is_ignored(self):
        result = resolve(
            self._files(
                [
                    B.fact("us-gaap", "Revenues", "d", "100"),
                    B.fact("us-gaap", "SalesRevenueNet", "d", "80"),
                ],
                ["Revenues", "SalesRevenueNet"],
                calculation={
                    NOTE_ROLE: [
                        {"parent": "us-gaap_SalesRevenueNet", "child": "us-gaap_Revenues"}
                    ],
                    IS_ROLE: [
                        {"parent": "us-gaap_Revenues", "child": "us-gaap_SalesRevenueNet"}
                    ],
                },
            )
        )
        self.assertEqual(result.revenue_value, "100")

    def test_embedded_schema_calculation_is_used(self):
        result = resolve(
            self._files(
                [
                    B.fact("us-gaap", "Revenues", "d", "100"),
                    B.fact("us-gaap", "SalesRevenueNet", "d", "80"),
                ],
                ["Revenues", "SalesRevenueNet"],
                calculation={
                    IS_ROLE: [
                        {"parent": "us-gaap_Revenues", "child": "us-gaap_SalesRevenueNet"}
                    ]
                },
                calculation_embedded=True,
            )
        )
        self.assertEqual(result.revenue_value, "100")

    def test_prohibited_root_arc_removes_the_root(self):
        result = resolve(
            self._files(
                [
                    B.fact("us-gaap", "Revenues", "d", "100"),
                    B.fact("us-gaap", "SalesRevenueNet", "d", "80"),
                ],
                ["Revenues", "SalesRevenueNet"],
                calculation={
                    IS_ROLE: [
                        {"parent": "us-gaap_Revenues", "child": "us-gaap_SalesRevenueNet",
                         "order": "1", "weight": "1", "priority": "0"},
                        {"parent": "us-gaap_Revenues", "child": "us-gaap_SalesRevenueNet",
                         "order": "1", "weight": "1", "use": "prohibited", "priority": "3"},
                    ]
                },
            )
        )
        self.assertEqual(result.revenue_status, AMBIGUOUS)
        self.assertIsNone(result.revenue_value)

    def test_calculation_file_hash_is_in_bundle_provenance(self):
        files = self._files(
            [
                B.fact("us-gaap", "Revenues", "d", "100"),
                B.fact("us-gaap", "SalesRevenueNet", "d", "80"),
            ],
            ["Revenues", "SalesRevenueNet"],
            calculation={
                IS_ROLE: [{"parent": "us-gaap_Revenues", "child": "us-gaap_SalesRevenueNet"}]
            },
        )
        bundle = fetch_bundle(FakeClient(files), CIK, ACCESSION)
        self.assertIn(CALCULATION_NAME, bundle.file_hashes)
        self.assertEqual(len(bundle.file_hashes[CALCULATION_NAME]), 64)


class TotalAssetsTest(unittest.TestCase):
    def _files(self, extra_facts=None, extra_contexts=None, balance=None):
        return build_files(
            contexts=base_contexts(extra_contexts),
            facts=[
                _dei_period(),
                B.fact("us-gaap", "Revenues", "d", "100"),
                B.fact("us-gaap", "CostOfRevenue", "d", "60"),
                B.fact("us-gaap", "Assets", "i", "500"),
            ]
            + (extra_facts or []),
            roles=simple_roles(
                income=["Revenues", "CostOfRevenue"],
                balance=balance or ["Assets", "LiabilitiesAndStockholdersEquity"],
            ),
        )

    def test_target_dimensionless_assets(self):
        result = resolve(self._files())
        self.assertEqual(result.assets_value, "500")
        self.assertEqual(result.assets_status, RESOLVED)

    def test_co_registrant_assets_are_excluded(self):
        files = self._files(
            extra_facts=[B.fact("us-gaap", "Assets", "sub", "105158000000")],
            extra_contexts=[
                B.context(
                    "sub",
                    cik=CIK,
                    instant=DPE,
                    dimensions=((LEGAL_ENTITY_AXIS, "acme:SubsidiaryMember"),),
                )
            ],
        )
        result = resolve(files)
        self.assertEqual(result.assets_value, "500")

    def test_other_registrant_entity_assets_are_excluded(self):
        files = self._files(
            extra_facts=[B.fact("us-gaap", "Assets", "other", "105158000000")],
            extra_contexts=[B.context("other", cik=OTHER_CIK, instant=DPE)],
        )
        result = resolve(files)
        self.assertEqual(result.assets_value, "500")

    def test_period_crosscheck_ok(self):
        result = resolve(self._files(), report_date=DPE)
        self.assertEqual(result.period_crosscheck_status, PERIOD_CROSSCHECK_OK)

    def test_period_crosscheck_mismatch_fails_close(self):
        result = resolve(self._files(), report_date="2024-02-27")
        self.assertEqual(result.period_crosscheck_status, PERIOD_CROSSCHECK_MISMATCH)
        self.assertIsNone(result.assets_value)
        self.assertIsNone(result.revenue_value)
        self.assertIsNone(result.book_equity_value)

    def test_report_date_null_keeps_dpe_canonical(self):
        result = resolve(self._files(), report_date=None)
        self.assertEqual(result.fiscal_period_end, DPE)
        self.assertEqual(result.period_crosscheck_status, PERIOD_CROSSCHECK_UNAVAILABLE)
        self.assertEqual(result.assets_value, "500")

    def test_assets_equals_liabilities_and_equity_validated(self):
        files = self._files(
            extra_facts=[B.fact("us-gaap", "LiabilitiesAndStockholdersEquity", "i", "500")]
        )
        result = resolve(files)
        self.assertEqual(result.assets_tieout_status, VALIDATED)
        self.assertEqual(result.assets_status, RESOLVED)

    def test_assets_tieout_mismatch_fails_close(self):
        files = self._files(
            extra_facts=[B.fact("us-gaap", "LiabilitiesAndStockholdersEquity", "i", "501")]
        )
        result = resolve(files)
        self.assertEqual(result.assets_tieout_status, TIEOUT_MISMATCH)
        self.assertEqual(result.assets_status, UNRESOLVED)
        self.assertIsNone(result.assets_value)

    def test_ambiguous_lse_does_not_rescue_assets(self):
        """validation 입력이 모호하면 unavailable로 내려가 Assets를 살리지 않는다."""
        files = self._files(
            extra_facts=[
                B.fact("us-gaap", "LiabilitiesAndStockholdersEquity", "i", "500"),
                B.fact("us-gaap", "LiabilitiesAndStockholdersEquity", "i2", "501"),
            ],
            extra_contexts=[B.context("i2", cik=CIK, instant=DPE)],
        )
        result = resolve(files)
        self.assertEqual(result.assets_tieout_status, TIEOUT_INPUT_AMBIGUOUS)
        self.assertEqual(result.assets_status, UNRESOLVED)
        self.assertIsNone(result.assets_value)
        self.assertEqual(result.diagnostics["assets"], "LSE_AMBIGUOUS")

    def test_missing_lse_is_unavailable_not_mismatch(self):
        result = resolve(self._files())
        self.assertEqual(result.assets_tieout_status, TIEOUT_UNAVAILABLE)
        self.assertEqual(result.assets_value, "500")

    def test_current_plus_noncurrent_is_never_a_fallback(self):
        files = self._files(
            extra_facts=[
                B.fact("us-gaap", "AssetsCurrent", "i", "200"),
                B.fact("us-gaap", "AssetsNoncurrent", "i", "300"),
            ],
            balance=["AssetsCurrent", "AssetsNoncurrent"],
        )
        result = resolve(files)
        self.assertIn(result.assets_status, {MISSING, AMBIGUOUS})
        self.assertIsNone(result.assets_value)

    def test_dimension_only_assets_is_missing(self):
        files = build_files(
            contexts=base_contexts(
                [
                    B.context(
                        "sub",
                        cik=CIK,
                        instant=DPE,
                        dimensions=((LEGAL_ENTITY_AXIS, "acme:SubsidiaryMember"),),
                    )
                ]
            ),
            facts=[
                _dei_period(),
                B.fact("us-gaap", "Revenues", "d", "100"),
                B.fact("us-gaap", "CostOfRevenue", "d", "60"),
                B.fact("us-gaap", "Assets", "sub", "500"),
            ],
            roles=simple_roles(income=["Revenues", "CostOfRevenue"], balance=["Assets"]),
        )
        result = resolve(files)
        self.assertEqual(result.assets_status, MISSING)
        self.assertIsNone(result.balance_sheet_role)


class ParentEquityTest(unittest.TestCase):
    def _files(self, equity_facts, balance, *, equity_role=None, extra_contexts=None):
        return build_files(
            contexts=base_contexts(extra_contexts),
            facts=[
                _dei_period(),
                B.fact("us-gaap", "Revenues", "d", "100"),
                B.fact("us-gaap", "CostOfRevenue", "d", "60"),
                B.fact("us-gaap", "Assets", "i", "500"),
            ]
            + equity_facts,
            roles=simple_roles(
                income=["Revenues", "CostOfRevenue"],
                balance=["Assets"] + balance,
                equity=equity_role,
            ),
        )

    def test_direct_parent_equity(self):
        result = resolve(
            self._files(
                [B.fact("us-gaap", "StockholdersEquity", "i", "300")],
                ["StockholdersEquity"],
            )
        )
        self.assertEqual(result.parent_se_value, "300")
        self.assertEqual(result.parent_se_path, DIRECT_PARENT_SE)

    def test_fallback_reconstruction(self):
        result = resolve(
            self._files(
                [
                    B.fact("us-gaap", "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest", "i", "320"),
                    B.fact("us-gaap", "MinorityInterest", "i", "20"),
                ],
                [
                    "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest",
                    "MinorityInterest",
                ],
            )
        )
        self.assertEqual(result.parent_se_value, "300")
        self.assertEqual(result.parent_se_path, INCLUDING_NCI_MINUS_NCI)
        self.assertEqual(result.nci_tieout_status, PARENT_RECONSTRUCTED)

    def test_missing_minority_interest_is_not_assumed_zero(self):
        result = resolve(
            self._files(
                [
                    B.fact("us-gaap", "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest", "i", "320")
                ],
                ["StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"],
            )
        )
        self.assertNotEqual(result.parent_se_status, RESOLVED)
        self.assertIsNone(result.parent_se_value)

    def test_redeemable_nci_blocks_fallback(self):
        result = resolve(
            self._files(
                [
                    B.fact("us-gaap", "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest", "i", "5905125000"),
                    B.fact("us-gaap", "MinorityInterest", "i", "785175000"),
                    B.fact("us-gaap", "RedeemableNoncontrollingInterestEquityCarryingAmount", "i", "367039000"),
                ],
                [
                    "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest",
                    "MinorityInterest",
                    "RedeemableNoncontrollingInterestEquityCarryingAmount",
                ],
            )
        )
        self.assertEqual(result.parent_se_status, UNRESOLVED)
        self.assertEqual(result.diagnostics["parent_se"], PARENT_EQUITY_SCOPE_AMBIGUOUS)

    def test_direct_parent_survives_mezzanine_evidence(self):
        result = resolve(
            self._files(
                [
                    B.fact("us-gaap", "StockholdersEquity", "i", "4752911000"),
                    B.fact("us-gaap", "MinorityInterest", "i", "785175000"),
                    B.fact("us-gaap", "RedeemableNoncontrollingInterestEquityCarryingAmount", "i", "367039000"),
                ],
                [
                    "StockholdersEquity",
                    "MinorityInterest",
                    "RedeemableNoncontrollingInterestEquityCarryingAmount",
                ],
            )
        )
        self.assertEqual(result.parent_se_value, "4752911000")
        self.assertEqual(result.parent_se_path, DIRECT_PARENT_SE)

    def test_ambiguous_direct_parent_does_not_fall_back(self):
        """direct tier가 모호하면 IncludingNCI - NCI로 내려가지 않는다."""
        result = resolve(
            self._files(
                [
                    B.fact("us-gaap", "StockholdersEquity", "i", "100"),
                    B.fact("us-gaap", "StockholdersEquity", "i2", "101"),
                    B.fact(
                        "us-gaap",
                        "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest",
                        "i",
                        "120",
                    ),
                    B.fact("us-gaap", "MinorityInterest", "i", "20"),
                ],
                [
                    "StockholdersEquity",
                    "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest",
                    "MinorityInterest",
                ],
                extra_contexts=[B.context("i2", cik=CIK, instant=DPE)],
            )
        )
        self.assertEqual(result.parent_se_status, AMBIGUOUS)
        self.assertIsNone(result.parent_se_value)
        self.assertIsNone(result.parent_se_path)
        self.assertEqual(result.diagnostics["parent_se"], "DIRECT_PARENT_SE_AMBIGUOUS")
        self.assertEqual(result.book_equity_status, UNRESOLVED)

    def test_direct_parent_ambiguous_by_decimals_does_not_fall_back(self):
        result = resolve(
            self._files(
                [
                    B.fact("us-gaap", "StockholdersEquity", "i", "100", decimals="-6"),
                    B.fact("us-gaap", "StockholdersEquity", "i2", "100", decimals="-3"),
                    B.fact(
                        "us-gaap",
                        "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest",
                        "i",
                        "120",
                    ),
                    B.fact("us-gaap", "MinorityInterest", "i", "20"),
                ],
                [
                    "StockholdersEquity",
                    "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest",
                    "MinorityInterest",
                ],
                extra_contexts=[B.context("i2", cik=CIK, instant=DPE)],
            )
        )
        self.assertEqual(result.parent_se_status, AMBIGUOUS)
        self.assertIsNone(result.parent_se_path)

    def test_equity_rollforward_including_nci_is_not_a_candidate(self):
        """equity roll-forward도 Statement지만 대차대조표 role이 아니라 후보가 아니다."""
        result = resolve(
            self._files(
                [
                    B.fact("us-gaap", "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest", "i", "5905125000"),
                    B.fact("us-gaap", "MinorityInterest", "i", "785175000"),
                ],
                [],
                equity_role=[
                    "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest",
                    "MinorityInterest",
                ],
            )
        )
        self.assertNotEqual(result.parent_se_status, RESOLVED)


class NciTieoutTest(unittest.TestCase):
    def _result(self, incl, parent, nci, decimals):
        files = build_files(
            contexts=base_contexts(),
            facts=[
                _dei_period(),
                B.fact("us-gaap", "Revenues", "d", "100"),
                B.fact("us-gaap", "CostOfRevenue", "d", "60"),
                B.fact("us-gaap", "Assets", "i", "500"),
                B.fact("us-gaap", "StockholdersEquity", "i", parent, decimals=decimals),
                B.fact("us-gaap", "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest", "i", incl, decimals=decimals),
                B.fact("us-gaap", "MinorityInterest", "i", nci, decimals=decimals),
            ],
            roles=simple_roles(
                income=["Revenues", "CostOfRevenue"],
                balance=[
                    "Assets",
                    "StockholdersEquity",
                    "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest",
                    "MinorityInterest",
                ],
            ),
        )
        return resolve(files)

    def test_exact_identity_is_validated(self):
        result = self._result("320", "300", "20", "-6")
        self.assertEqual(result.nci_tieout_status, VALIDATED)

    def test_million_rounding_is_compatible(self):
        """CMCSA/GE/PFE 모양: decimals=-6에서 gap 1,000,000은 허용 1,500,000 안이다."""
        result = self._result("86038000000", "85560000000", "477000000", "-6")
        self.assertEqual(result.nci_tieout_status, ROUNDING_COMPATIBLE)
        self.assertEqual(result.parent_se_value, "85560000000")

    def test_tesla_scope_error_is_blocked(self):
        """decimals=-3에서 허용은 1,500뿐이라 367,039,000 gap은 mismatch다."""
        result = self._result("5905125000", "4752911000", "785175000", "-3")
        self.assertEqual(result.nci_tieout_status, TIEOUT_MISMATCH)
        self.assertEqual(result.parent_se_value, "4752911000")
        self.assertEqual(result.parent_se_path, DIRECT_PARENT_SE)

    def test_missing_decimals_requires_exact(self):
        result = self._result("86038000000", "85560000000", "477000000", None)
        self.assertEqual(result.nci_tieout_status, TIEOUT_MISMATCH)

    def test_infinite_decimals_requires_exact(self):
        result = self._result("86038000000", "85560000000", "477000000", "INF")
        self.assertEqual(result.nci_tieout_status, TIEOUT_MISMATCH)

    def test_ambiguous_nci_input_is_not_called_unavailable(self):
        """ambiguity는 부재가 아니다. direct parent canonical 값은 유지한다."""
        files = build_files(
            contexts=base_contexts([B.context("i2", cik=CIK, instant=DPE)]),
            facts=[
                _dei_period(),
                B.fact("us-gaap", "Revenues", "d", "100"),
                B.fact("us-gaap", "CostOfRevenue", "d", "60"),
                B.fact("us-gaap", "Assets", "i", "500"),
                B.fact("us-gaap", "StockholdersEquity", "i", "300"),
                B.fact("us-gaap", "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest", "i", "320"),
                B.fact("us-gaap", "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest", "i2", "321"),
                B.fact("us-gaap", "MinorityInterest", "i", "20"),
            ],
            roles=simple_roles(
                income=["Revenues", "CostOfRevenue"],
                balance=[
                    "Assets",
                    "StockholdersEquity",
                    "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest",
                    "MinorityInterest",
                ],
            ),
        )
        result = resolve(files)
        self.assertEqual(result.parent_se_value, "300")
        self.assertEqual(result.parent_se_path, DIRECT_PARENT_SE)
        self.assertEqual(result.nci_tieout_status, TIEOUT_INPUT_AMBIGUOUS)
        self.assertNotEqual(result.nci_tieout_status, TIEOUT_UNAVAILABLE)

    def test_no_including_nci_is_unavailable(self):
        files = build_files(
            contexts=base_contexts(),
            facts=[
                _dei_period(),
                B.fact("us-gaap", "Revenues", "d", "100"),
                B.fact("us-gaap", "CostOfRevenue", "d", "60"),
                B.fact("us-gaap", "Assets", "i", "500"),
                B.fact("us-gaap", "StockholdersEquity", "i", "300"),
            ],
            roles=simple_roles(
                income=["Revenues", "CostOfRevenue"],
                balance=["Assets", "StockholdersEquity"],
            ),
        )
        result = resolve(files)
        self.assertEqual(result.nci_tieout_status, TIEOUT_UNAVAILABLE)


class PreferredTest(unittest.TestCase):
    def _files(self, preferred_facts, balance):
        return build_files(
            contexts=base_contexts(),
            facts=[
                _dei_period(),
                B.fact("us-gaap", "Revenues", "d", "100"),
                B.fact("us-gaap", "CostOfRevenue", "d", "60"),
                B.fact("us-gaap", "Assets", "i", "500"),
                B.fact("us-gaap", "StockholdersEquity", "i", "23874000000"),
            ]
            + preferred_facts,
            roles=simple_roles(
                income=["Revenues", "CostOfRevenue"],
                balance=["Assets", "StockholdersEquity"] + balance,
            ),
        )

    def test_avgo_shape_liquidation_beats_zero_par(self):
        result = resolve(
            self._files(
                [
                    B.fact("us-gaap", "PreferredStockValue", "i", "0"),
                    B.fact("us-gaap", "PreferredStockSharesIssued", "i", "4000000", unit="shares", decimals="INF"),
                    B.fact("us-gaap", "PreferredStockLiquidationPreferenceValue", "i", "3738000000"),
                ],
                [
                    "PreferredStockValue",
                    "PreferredStockSharesIssued",
                    "PreferredStockLiquidationPreferenceValue",
                ],
            )
        )
        self.assertEqual(result.preferred_tier, LIQUIDATION)
        self.assertEqual(result.preferred_value, "3738000000")
        self.assertEqual(result.book_equity_value, "20136000000")

    def test_resolved_liquidation_survives_ambiguous_par_decimals(self):
        files = build_files(
            contexts=base_contexts([B.context("i2", cik=CIK, instant=DPE)]),
            facts=[
                _dei_period(),
                B.fact("us-gaap", "Revenues", "d", "100"),
                B.fact("us-gaap", "CostOfRevenue", "d", "60"),
                B.fact("us-gaap", "Assets", "i", "500"),
                B.fact("us-gaap", "StockholdersEquity", "i", "5000000000"),
                B.fact(
                    "us-gaap",
                    "PreferredStockLiquidationPreferenceValue",
                    "i",
                    "3738000000",
                ),
                B.fact(
                    "us-gaap", "PreferredStockValue", "i", "0", decimals="-6"
                ),
                B.fact(
                    "us-gaap", "PreferredStockValue", "i2", "0", decimals="-3"
                ),
            ],
            roles=simple_roles(
                income=["Revenues", "CostOfRevenue"],
                balance=[
                    "Assets",
                    "StockholdersEquity",
                    "PreferredStockLiquidationPreferenceValue",
                    "PreferredStockValue",
                ],
            ),
        )
        result = resolve(files)
        self.assertEqual(result.preferred_status, RESOLVED)
        self.assertEqual(result.preferred_tier, LIQUIDATION)
        self.assertEqual(result.preferred_value, "3738000000")

    def test_ge_shape_par_carrying_when_no_liquidation(self):
        result = resolve(
            self._files(
                [
                    B.fact("us-gaap", "PreferredStockValue", "i", "6000000"),
                    B.fact("us-gaap", "PreferredStockSharesOutstanding", "i", "5939875", unit="shares", decimals="INF"),
                ],
                ["PreferredStockValue", "PreferredStockSharesOutstanding"],
            )
        )
        self.assertEqual(result.preferred_tier, PAR_CARRYING)
        self.assertEqual(result.preferred_value, "6000000")

    def test_explicit_zero_shares_is_zero(self):
        result = resolve(
            self._files(
                [
                    B.fact("us-gaap", "PreferredStockSharesIssued", "i", "0", unit="shares", decimals="INF"),
                ],
                ["PreferredStockSharesIssued"],
            )
        )
        self.assertEqual(result.preferred_tier, ZERO)
        self.assertEqual(result.preferred_value, "0")

    def test_absent_element_is_presentation_completeness_zero(self):
        result = resolve(self._files([], []))
        self.assertEqual(result.preferred_tier, ZERO)
        provenance = result.provenance["preferred_provenance"]
        self.assertIn("presentation completeness", provenance["reason"])

    def test_pg_shape_dimension_only_preferred_is_not_zero(self):
        files = build_files(
            contexts=base_contexts(
                [
                    B.context("clsA", cik=CIK, instant=DPE,
                              dimensions=((CLASS_AXIS, "acme:SeriesAEsopMember"),)),
                    B.context("clsB", cik=CIK, instant=DPE,
                              dimensions=((CLASS_AXIS, "acme:UnissuedMember"),)),
                ]
            ),
            facts=[
                _dei_period(),
                B.fact("us-gaap", "Revenues", "d", "100"),
                B.fact("us-gaap", "CostOfRevenue", "d", "60"),
                B.fact("us-gaap", "Assets", "i", "500"),
                B.fact("us-gaap", "StockholdersEquity", "i", "54311000000"),
                B.fact("us-gaap", "PreferredStockValue", "clsA", "756000000"),
                B.fact("us-gaap", "PreferredStockValue", "clsB", "0"),
            ],
            roles=simple_roles(
                income=["Revenues", "CostOfRevenue"],
                balance=["Assets", "StockholdersEquity", "PreferredStockValue"],
            ),
        )
        result = resolve(files)
        self.assertNotEqual(result.preferred_tier, ZERO)
        self.assertEqual(result.preferred_status, PREF_UNRESOLVED)
        self.assertEqual(result.book_equity_status, UNRESOLVED)

    def test_zero_par_with_issued_shares_is_par_carrying_not_zero(self):
        result = resolve(
            self._files(
                [
                    B.fact("us-gaap", "PreferredStockValue", "i", "0"),
                    B.fact("us-gaap", "PreferredStockSharesIssued", "i", "4000000", unit="shares", decimals="INF"),
                ],
                ["PreferredStockValue", "PreferredStockSharesIssued"],
            )
        )
        self.assertEqual(result.preferred_tier, PAR_CARRYING)
        self.assertEqual(result.preferred_value, "0")

    def test_contradictory_zero_shares_and_nonzero_amount(self):
        result = resolve(
            self._files(
                [
                    B.fact("us-gaap", "PreferredStockSharesIssued", "i", "0", unit="shares", decimals="INF"),
                    B.fact("us-gaap", "PreferredStockLiquidationPreferenceValue", "i", "3738000000"),
                ],
                ["PreferredStockSharesIssued", "PreferredStockLiquidationPreferenceValue"],
            )
        )
        self.assertEqual(result.preferred_status, PREF_UNRESOLVED)
        self.assertIn("CONTRADICTORY", result.diagnostics["preferred"])
        self.assertIsNone(result.preferred_tier)
        self.assertIsNone(result.preferred_value)

    def test_ambiguous_liquidation_does_not_fall_back_to_par(self):
        files = build_files(
            contexts=base_contexts([B.context("i2", cik=CIK, instant=DPE)]),
            facts=[
                _dei_period(),
                B.fact("us-gaap", "Revenues", "d", "100"),
                B.fact("us-gaap", "CostOfRevenue", "d", "60"),
                B.fact("us-gaap", "Assets", "i", "500"),
                B.fact("us-gaap", "StockholdersEquity", "i", "1000"),
                B.fact("us-gaap", "PreferredStockLiquidationPreferenceValue", "i", "100"),
                B.fact("us-gaap", "PreferredStockLiquidationPreferenceValue", "i2", "200"),
                B.fact("us-gaap", "PreferredStockValue", "i", "10"),
            ],
            roles=simple_roles(
                income=["Revenues", "CostOfRevenue"],
                balance=[
                    "Assets",
                    "StockholdersEquity",
                    "PreferredStockLiquidationPreferenceValue",
                    "PreferredStockValue",
                ],
            ),
        )
        result = resolve(files)
        self.assertEqual(result.preferred_status, PREF_UNRESOLVED)
        self.assertEqual(result.diagnostics["preferred"], "LIQUIDATION_AMBIGUOUS")
        self.assertIsNone(result.preferred_value)
        self.assertIsNone(result.preferred_tier)
        self.assertEqual(result.book_equity_status, UNRESOLVED)

    def test_ambiguous_zero_par_decimals_does_not_fall_back_to_zero(self):
        files = build_files(
            contexts=base_contexts([B.context("i2", cik=CIK, instant=DPE)]),
            facts=[
                _dei_period(),
                B.fact("us-gaap", "Revenues", "d", "100"),
                B.fact("us-gaap", "CostOfRevenue", "d", "60"),
                B.fact("us-gaap", "Assets", "i", "500"),
                B.fact("us-gaap", "StockholdersEquity", "i", "1000"),
                B.fact(
                    "us-gaap", "PreferredStockValue", "i", "0", decimals="-6"
                ),
                B.fact(
                    "us-gaap", "PreferredStockValue", "i2", "0", decimals="-3"
                ),
            ],
            roles=simple_roles(
                income=["Revenues", "CostOfRevenue"],
                balance=["Assets", "StockholdersEquity", "PreferredStockValue"],
            ),
        )
        result = resolve(files)
        self.assertEqual(result.preferred_status, PREF_UNRESOLVED)
        self.assertEqual(result.diagnostics["preferred"], "PAR_CARRYING_AMBIGUOUS")
        self.assertIsNone(result.preferred_tier)
        self.assertIsNone(result.preferred_value)

    def test_ambiguous_par_does_not_fall_back_to_zero(self):
        files = build_files(
            contexts=base_contexts([B.context("i2", cik=CIK, instant=DPE)]),
            facts=[
                _dei_period(),
                B.fact("us-gaap", "Revenues", "d", "100"),
                B.fact("us-gaap", "CostOfRevenue", "d", "60"),
                B.fact("us-gaap", "Assets", "i", "500"),
                B.fact("us-gaap", "StockholdersEquity", "i", "1000"),
                B.fact("us-gaap", "PreferredStockValue", "i", "10"),
                B.fact("us-gaap", "PreferredStockValue", "i2", "20"),
            ],
            roles=simple_roles(
                income=["Revenues", "CostOfRevenue"],
                balance=["Assets", "StockholdersEquity", "PreferredStockValue"],
            ),
        )
        result = resolve(files)
        self.assertEqual(result.preferred_status, PREF_UNRESOLVED)
        self.assertEqual(result.diagnostics["preferred"], "PAR_CARRYING_AMBIGUOUS")

    def test_zero_shares_with_zero_par_is_zero_not_par_carrying(self):
        result = resolve(
            self._files(
                [
                    B.fact("us-gaap", "PreferredStockValue", "i", "0"),
                    B.fact("us-gaap", "PreferredStockSharesIssued", "i", "0",
                           unit="shares", decimals="INF"),
                ],
                ["PreferredStockValue", "PreferredStockSharesIssued"],
            )
        )
        self.assertEqual(result.preferred_tier, ZERO)
        self.assertEqual(result.preferred_value, "0")

    def test_conflicting_zero_and_positive_share_evidence(self):
        files = build_files(
            contexts=base_contexts(),
            facts=[
                _dei_period(),
                B.fact("us-gaap", "Revenues", "d", "100"),
                B.fact("us-gaap", "CostOfRevenue", "d", "60"),
                B.fact("us-gaap", "Assets", "i", "500"),
                B.fact("us-gaap", "StockholdersEquity", "i", "1000"),
                B.fact("us-gaap", "PreferredStockSharesIssued", "i", "0",
                       unit="shares", decimals="INF"),
                B.fact("us-gaap", "PreferredStockSharesOutstanding", "i", "4000000",
                       unit="shares", decimals="INF"),
            ],
            roles=simple_roles(
                income=["Revenues", "CostOfRevenue"],
                balance=[
                    "Assets",
                    "StockholdersEquity",
                    "PreferredStockSharesIssued",
                    "PreferredStockSharesOutstanding",
                ],
            ),
        )
        result = resolve(files)
        self.assertEqual(result.preferred_status, PREF_UNRESOLVED)
        self.assertIn("CONTRADICTORY", result.diagnostics["preferred"])

    def test_dimensioned_share_evidence_blocks_absence_zero(self):
        """차원 fact는 존재 evidence로만 본다. 합산하지 않고 ZERO도 아니다."""
        files = build_files(
            contexts=base_contexts(
                [
                    B.context("clsA", cik=CIK, instant=DPE,
                              dimensions=((CLASS_AXIS, "acme:SeriesAMember"),))
                ]
            ),
            facts=[
                _dei_period(),
                B.fact("us-gaap", "Revenues", "d", "100"),
                B.fact("us-gaap", "CostOfRevenue", "d", "60"),
                B.fact("us-gaap", "Assets", "i", "500"),
                B.fact("us-gaap", "StockholdersEquity", "i", "1000"),
                B.fact("us-gaap", "PreferredStockSharesIssued", "clsA", "4000000",
                       unit="shares", decimals="INF"),
            ],
            roles=simple_roles(
                income=["Revenues", "CostOfRevenue"],
                balance=["Assets", "StockholdersEquity", "PreferredStockSharesIssued"],
            ),
        )
        result = resolve(files)
        self.assertNotEqual(result.preferred_tier, ZERO)
        self.assertEqual(result.preferred_status, PREF_UNRESOLVED)

    def test_zero_shares_does_not_swallow_ambiguous_liquidation(self):
        """zero-share ZERO가 상위 tier ambiguity를 삼키면 안 된다."""
        files = build_files(
            contexts=base_contexts([B.context("i2", cik=CIK, instant=DPE)]),
            facts=[
                _dei_period(),
                B.fact("us-gaap", "Revenues", "d", "100"),
                B.fact("us-gaap", "CostOfRevenue", "d", "60"),
                B.fact("us-gaap", "Assets", "i", "500"),
                B.fact("us-gaap", "StockholdersEquity", "i", "1000"),
                B.fact("us-gaap", "PreferredStockSharesIssued", "i", "0",
                       unit="shares", decimals="INF"),
                B.fact("us-gaap", "PreferredStockLiquidationPreferenceValue", "i", "100"),
                B.fact("us-gaap", "PreferredStockLiquidationPreferenceValue", "i2", "200"),
            ],
            roles=simple_roles(
                income=["Revenues", "CostOfRevenue"],
                balance=[
                    "Assets",
                    "StockholdersEquity",
                    "PreferredStockSharesIssued",
                    "PreferredStockLiquidationPreferenceValue",
                ],
            ),
        )
        result = resolve(files)
        self.assertEqual(result.preferred_status, PREF_UNRESOLVED)
        self.assertEqual(result.diagnostics["preferred"], "LIQUIDATION_AMBIGUOUS")
        self.assertNotEqual(result.preferred_tier, ZERO)

    def test_zero_shares_with_dimensioned_positive_amount_is_contradictory(self):
        """차원 fact의 양수 금액도 positive evidence다. 합산하지 않고 ZERO도 아니다."""
        files = build_files(
            contexts=base_contexts(
                [
                    B.context("clsA", cik=CIK, instant=DPE,
                              dimensions=((CLASS_AXIS, "acme:SeriesAEsopMember"),))
                ]
            ),
            facts=[
                _dei_period(),
                B.fact("us-gaap", "Revenues", "d", "100"),
                B.fact("us-gaap", "CostOfRevenue", "d", "60"),
                B.fact("us-gaap", "Assets", "i", "500"),
                B.fact("us-gaap", "StockholdersEquity", "i", "1000"),
                B.fact("us-gaap", "PreferredStockSharesIssued", "i", "0",
                       unit="shares", decimals="INF"),
                B.fact("us-gaap", "PreferredStockValue", "clsA", "756000000"),
            ],
            roles=simple_roles(
                income=["Revenues", "CostOfRevenue"],
                balance=[
                    "Assets",
                    "StockholdersEquity",
                    "PreferredStockSharesIssued",
                    "PreferredStockValue",
                ],
            ),
        )
        result = resolve(files)
        self.assertEqual(result.preferred_status, PREF_UNRESOLVED)
        self.assertIn("CONTRADICTORY", result.diagnostics["preferred"])
        self.assertNotEqual(result.preferred_tier, ZERO)
        self.assertIsNone(result.preferred_value)

    def test_tier_transitions_helper(self):
        self.assertEqual(
            preferred_tier_transitions(
                [(2018, PAR_CARRYING), (2019, PAR_CARRYING), (2020, LIQUIDATION)]
            ),
            (2020,),
        )
        self.assertEqual(
            preferred_tier_transitions([(2018, ZERO), (2019, LIQUIDATION)]), ()
        )

    def test_non_adjacent_fiscal_years_are_not_a_transition(self):
        """2018 -> 2020처럼 중간 회계연도가 비면 인접이 아니다."""
        self.assertEqual(
            preferred_tier_transitions([(2018, PAR_CARRYING), (2020, LIQUIDATION)]), ()
        )
        self.assertEqual(
            preferred_tier_transitions(
                [(2018, PAR_CARRYING), (2019, LIQUIDATION), (2021, PAR_CARRYING)]
            ),
            (2019,),
        )


class BookEquityTest(unittest.TestCase):
    def _files(self, equity_facts, balance):
        return build_files(
            contexts=base_contexts(),
            facts=[
                _dei_period(),
                B.fact("us-gaap", "Revenues", "d", "100"),
                B.fact("us-gaap", "CostOfRevenue", "d", "60"),
                B.fact("us-gaap", "Assets", "i", "500"),
            ]
            + equity_facts,
            roles=simple_roles(
                income=["Revenues", "CostOfRevenue"], balance=["Assets"] + balance
            ),
        )

    def test_direct_parent_minus_liquidation(self):
        result = resolve(
            self._files(
                [
                    B.fact("us-gaap", "StockholdersEquity", "i", "1000"),
                    B.fact("us-gaap", "PreferredStockLiquidationPreferenceValue", "i", "150"),
                ],
                ["StockholdersEquity", "PreferredStockLiquidationPreferenceValue"],
            )
        )
        self.assertEqual(result.book_equity_value, "850")
        self.assertEqual(result.book_equity_status, RESOLVED)

    def test_reconstructed_parent_minus_par(self):
        result = resolve(
            self._files(
                [
                    B.fact("us-gaap", "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest", "i", "1020"),
                    B.fact("us-gaap", "MinorityInterest", "i", "20"),
                    B.fact("us-gaap", "PreferredStockValue", "i", "50"),
                    B.fact("us-gaap", "PreferredStockSharesIssued", "i", "10", unit="shares", decimals="INF"),
                ],
                [
                    "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest",
                    "MinorityInterest",
                    "PreferredStockValue",
                    "PreferredStockSharesIssued",
                ],
            )
        )
        self.assertEqual(result.parent_se_path, INCLUDING_NCI_MINUS_NCI)
        self.assertEqual(result.book_equity_value, "950")

    def test_preferred_zero_gives_parent_equity(self):
        result = resolve(
            self._files(
                [B.fact("us-gaap", "StockholdersEquity", "i", "1000")],
                ["StockholdersEquity"],
            )
        )
        self.assertEqual(result.preferred_tier, ZERO)
        self.assertEqual(result.book_equity_value, "1000")

    def test_parent_unresolved_gives_unresolved_book_equity(self):
        result = resolve(self._files([], []))
        self.assertEqual(result.book_equity_status, UNRESOLVED)
        self.assertIsNone(result.book_equity_value)

    def test_negative_book_equity_is_resolved(self):
        result = resolve(
            self._files(
                [B.fact("us-gaap", "StockholdersEquity", "i", "-1791000000")],
                ["StockholdersEquity"],
            )
        )
        self.assertEqual(result.book_equity_value, "-1791000000")
        self.assertEqual(result.book_equity_status, RESOLVED)

    def test_deferred_tax_facts_never_enter_book_equity(self):
        result = resolve(
            self._files(
                [
                    B.fact("us-gaap", "StockholdersEquity", "i", "1000"),
                    B.fact("us-gaap", "DeferredIncomeTaxLiabilitiesNet", "i", "12133000000"),
                    B.fact("us-gaap", "AccumulatedDeferredInvestmentTaxCredit", "i", "2002000000"),
                    B.fact("acme", "DeferredCreditsRelatedToIncomeTaxes", "i", "4712000000"),
                ],
                [
                    "StockholdersEquity",
                    "DeferredIncomeTaxLiabilitiesNet",
                    "AccumulatedDeferredInvestmentTaxCredit",
                ],
            )
        )
        self.assertEqual(result.book_equity_value, "1000")


def _seed_filing(connection, *, accession=ACCESSION, form="10-K",
                 acceptance="2024-02-01T21:00:00.000000Z",
                 usable="2024-02-02", report_date=DPE, cik=CIK):
    connection.execute(
        "INSERT INTO qv_sec_filings (cik, accession, form, filed_date, report_date,"
        " acceptance_datetime, acceptance_eastern_date, historical_usable_session,"
        " filing_sic, sic_status, primary_document, submissions_file, calendar_source,"
        " calendar_source_version, source, source_version, provenance)"
        " VALUES (?, ?, ?, '2024-02-01', ?, ?, '2024-02-01', ?, NULL, 'MISSING', NULL,"
        " 'CIK.json', 'cal', 'cal-v1', 'sec', ?, '{}')",
        (cik, accession, form, report_date, acceptance, usable, FILING_SOURCE_VERSION),
    )
    connection.commit()


def _default_files():
    return build_files(
        contexts=base_contexts(),
        facts=[
            _dei_period(),
            B.fact("us-gaap", "Revenues", "d", "100"),
            B.fact("us-gaap", "CostOfRevenue", "d", "60"),
            B.fact("us-gaap", "Assets", "i", "500"),
            B.fact("us-gaap", "StockholdersEquity", "i", "300"),
        ],
        roles=simple_roles(
            income=["Revenues", "CostOfRevenue"], balance=["Assets", "StockholdersEquity"]
        ),
    )


class IngestionTest(unittest.TestCase):
    def setUp(self):
        self.connection = store.connect_memory()
        self.connection.execute("PRAGMA foreign_keys=ON")
        _seed_filing(self.connection)

    def tearDown(self):
        self.connection.close()

    def _ingest(
        self,
        files=None,
        version=ACCOUNTING_SOURCE_VERSION,
        definition=ACCOUNTING_DEFINITION_VERSION,
    ):
        return ingest_accounting(
            self.connection,
            FakeClient(files or _default_files()),
            cik=CIK,
            filing_source_version=FILING_SOURCE_VERSION,
            accounting_source=ACCOUNTING_SOURCE,
            accounting_source_version=version,
            accounting_definition_version=definition,
        )

    def test_row_is_written_with_canonical_values(self):
        self.assertEqual(ACCOUNTING_DEFINITION_VERSION, "qv-accounting-v3")
        self.assertEqual(
            ACCOUNTING_CONTRACT_COMMIT,
            "5936298bc1a3aa7971f97c032b564b8f8294ae01",
        )
        self.assertEqual(self._ingest(), 1)
        row = self.connection.execute("SELECT * FROM qv_accounting_filings").fetchone()
        self.assertEqual(row["revenue_value"], "100")
        self.assertEqual(row["gross_profit_value"], "40")
        self.assertEqual(row["assets_value"], "500")
        self.assertEqual(row["book_equity_value"], "300")
        self.assertEqual(row["accounting_definition_version"], ACCOUNTING_DEFINITION_VERSION)
        bundle = json.loads(row["bundle_provenance"])
        self.assertEqual(bundle["contract_commit"], ACCOUNTING_CONTRACT_COMMIT)

    def test_superseded_definition_labels_cannot_be_written_by_v3(self):
        for superseded in ("qv-accounting-v1", "qv-accounting-v2"):
            with self.assertRaises(QVAccountingError):
                self._ingest(definition=superseded)
        count = self.connection.execute(
            "SELECT COUNT(*) AS n FROM qv_accounting_filings"
        ).fetchone()["n"]
        self.assertEqual(count, 0)

    def test_unknown_definition_label_cannot_be_written(self):
        with self.assertRaises(QVAccountingError):
            self._ingest(definition="qv-accounting-v99")
        count = self.connection.execute(
            "SELECT COUNT(*) AS n FROM qv_accounting_filings"
        ).fetchone()["n"]
        self.assertEqual(count, 0)

    def test_historical_v1_row_remains_explicitly_readable(self):
        self.connection.execute(
            "INSERT INTO qv_accounting_filings"
            " (cik, accession, filing_source_version, accounting_source,"
            " accounting_source_version, accounting_definition_version,"
            " fiscal_period_end, period_crosscheck_status, revenue_status, cogs_status,"
            " gross_profit_status, gross_profit_tieout_status, assets_status,"
            " assets_tieout_status, parent_se_status, nci_tieout_status,"
            " preferred_status, book_equity_status, bundle_provenance, diagnostics)"
            " VALUES (?, ?, ?, ?, ?, 'qv-accounting-v1', ?, 'OK', 'MISSING', 'MISSING',"
            " 'MISSING', 'TIEOUT_UNAVAILABLE', 'MISSING', 'TIEOUT_UNAVAILABLE',"
            " 'MISSING', 'TIEOUT_UNAVAILABLE', 'MISSING', 'MISSING', '{}', '{}')",
            (
                CIK,
                ACCESSION,
                FILING_SOURCE_VERSION,
                ACCOUNTING_SOURCE,
                ACCOUNTING_SOURCE_VERSION,
                DPE,
            ),
        )
        row = accounting_for_formation(
            self.connection,
            cik=CIK,
            fiscal_period_end_year=2023,
            formation_session="2024-06-28",
            filing_source_version=FILING_SOURCE_VERSION,
            accounting_source_version=ACCOUNTING_SOURCE_VERSION,
            accounting_definition_version="qv-accounting-v1",
        )
        self.assertIsNotNone(row)
        self.assertEqual(row["accounting_definition_version"], "qv-accounting-v1")

    def test_reingest_same_version_is_rejected(self):
        self._ingest()
        with self.assertRaises(QVAccountingError):
            self._ingest()

    def test_new_accounting_source_version_is_a_separate_row(self):
        self._ingest()
        self._ingest(version="sec-xbrl-fixture-v2")
        count = self.connection.execute(
            "SELECT COUNT(*) AS n FROM qv_accounting_filings"
        ).fetchone()["n"]
        self.assertEqual(count, 2)

    def test_accession_without_a_filing_row_violates_the_foreign_key(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.connection.execute(
                "INSERT INTO qv_accounting_filings (cik, accession, filing_source_version,"
                " accounting_source, accounting_source_version,"
                " accounting_definition_version, period_crosscheck_status, revenue_status,"
                " cogs_status, gross_profit_status, gross_profit_tieout_status,"
                " assets_status, assets_tieout_status, parent_se_status, nci_tieout_status,"
                " preferred_status, book_equity_status, bundle_provenance, diagnostics)"
                " VALUES (?, ?, 'no-such-version', 'sec', 'v1', 'qv-accounting-v1',"
                " 'UNAVAILABLE', 'MISSING', 'MISSING', 'MISSING', 'TIEOUT_UNAVAILABLE',"
                " 'MISSING', 'TIEOUT_UNAVAILABLE', 'MISSING', 'TIEOUT_UNAVAILABLE',"
                " 'MISSING', 'MISSING', '{}', '{}')",
                (CIK, ACCESSION),
            )

    def test_no_annual_filing_rows_writes_nothing(self):
        self.connection.execute("DELETE FROM qv_sec_filings")
        self.connection.commit()
        self.assertEqual(self._ingest(), 0)

    def test_ten_q_is_not_ingested(self):
        self.connection.execute("DELETE FROM qv_sec_filings")
        _seed_filing(self.connection, accession="0000320193-24-000009", form="10-Q")
        self.assertEqual(self._ingest(), 0)

    def test_transport_failure_does_not_write_rows(self):
        files = _default_files()
        with self.assertRaises(QVAccountingError):
            ingest_accounting(
                self.connection,
                FakeClient(files, fail={INSTANCE_NAME}),
                cik=CIK,
                filing_source_version=FILING_SOURCE_VERSION,
                accounting_source=ACCOUNTING_SOURCE,
                accounting_source_version=ACCOUNTING_SOURCE_VERSION,
            )
        count = self.connection.execute(
            "SELECT COUNT(*) AS n FROM qv_accounting_filings"
        ).fetchone()["n"]
        self.assertEqual(count, 0)

    def test_mapping_failure_still_writes_a_row_with_status(self):
        files = build_files(
            contexts=base_contexts(),
            facts=[_dei_period(), B.fact("us-gaap", "Assets", "i", "500")],
            roles=simple_roles(income=[], balance=["Assets"]),
        )
        self.assertEqual(self._ingest(files), 1)
        row = self.connection.execute("SELECT * FROM qv_accounting_filings").fetchone()
        self.assertEqual(row["revenue_status"], MISSING)
        self.assertIsNone(row["revenue_value"])
        self.assertIn("revenue", json.loads(row["diagnostics"]))

    def test_provenance_keeps_selected_fact_identity(self):
        self._ingest()
        row = self.connection.execute("SELECT * FROM qv_accounting_filings").fetchone()
        provenance = json.loads(row["assets_provenance"])
        self.assertEqual(provenance["concept_local_name"], "Assets")
        self.assertTrue(provenance["concept_namespace"].startswith("http://fasb.org/us-gaap/"))
        self.assertEqual(provenance["instance_file"], INSTANCE_NAME)
        self.assertEqual(len(provenance["instance_sha256"]), 64)
        self.assertEqual(provenance["statement_role"], BS_ROLE)
        self.assertEqual(provenance["presentation_file"], PRESENTATION_NAME)
        self.assertEqual(len(provenance["presentation_sha256"]), 64)
        self.assertEqual(provenance["decimals"], "-6")
        self.assertEqual(provenance["context_id"], "i")
        bundle = json.loads(row["bundle_provenance"])
        self.assertEqual(bundle["target_cik"], CIK)
        self.assertIn(INSTANCE_NAME, bundle["file_sha256"])

    def test_raw_xml_body_is_not_stored(self):
        self._ingest()
        row = self.connection.execute("SELECT * FROM qv_accounting_filings").fetchone()
        for value in tuple(row):
            if isinstance(value, str):
                self.assertNotIn("<xbrli:xbrl", value)
                self.assertNotIn("<link:linkbase", value)

    def test_canonical_values_are_text_not_float(self):
        self._ingest()
        row = self.connection.execute(
            "SELECT typeof(assets_value) AS t1, typeof(book_equity_value) AS t2"
            " FROM qv_accounting_filings"
        ).fetchone()
        self.assertEqual(row["t1"], "text")
        self.assertEqual(row["t2"], "text")

    def test_no_generic_raw_fact_tables_exist(self):
        names = {
            r[0]
            for r in self.connection.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            )
        }
        for forbidden in ("xbrl_facts", "xbrl_contexts", "xbrl_dimensions", "xbrl_presentation_edges"):
            self.assertNotIn(forbidden, names)


class FormationSelectorTest(unittest.TestCase):
    """filing을 먼저 PIT 규칙으로 고른 뒤 그 filing의 상태를 그대로 돌려준다."""

    def setUp(self):
        self.connection = store.connect_memory()
        self.connection.execute("PRAGMA foreign_keys=ON")

    def tearDown(self):
        self.connection.close()

    def _ingest_all(self, files_by_accession):
        class Router:
            def __init__(self, mapping):
                self.mapping = mapping

            def accession_index(self, cik, accession):
                return {
                    "directory": {
                        "item": [{"name": n} for n in sorted(self.mapping[accession])]
                    }
                }

            def accession_file_bytes(self, cik, accession, name):
                return self.mapping[accession][name]

        return ingest_accounting(
            self.connection,
            Router(files_by_accession),
            cik=CIK,
            filing_source_version=FILING_SOURCE_VERSION,
            accounting_source=ACCOUNTING_SOURCE,
            accounting_source_version=ACCOUNTING_SOURCE_VERSION,
        )

    def _select(self, formation):
        return accounting_for_formation(
            self.connection,
            cik=CIK,
            fiscal_period_end_year=2023,
            formation_session=formation,
            filing_source_version=FILING_SOURCE_VERSION,
            accounting_source_version=ACCOUNTING_SOURCE_VERSION,
        )

    def test_original_only_usable_selects_original(self):
        _seed_filing(self.connection)
        self._ingest_all({ACCESSION: _default_files()})
        self.assertEqual(self._select("2024-06-28")["accession"], ACCESSION)

    def test_amendment_usable_before_formation_wins(self):
        amendment = "0000320193-24-000002"
        _seed_filing(self.connection)
        _seed_filing(
            self.connection,
            accession=amendment,
            form="10-K/A",
            acceptance="2024-03-01T21:00:00.000000Z",
            usable="2024-03-04",
        )
        self._ingest_all(
            {ACCESSION: _default_files(), amendment: _default_files()}
        )
        self.assertEqual(self._select("2024-06-28")["accession"], amendment)

    def test_amendment_after_formation_is_not_used(self):
        amendment = "0000320193-24-000002"
        _seed_filing(self.connection)
        _seed_filing(
            self.connection,
            accession=amendment,
            form="10-K/A",
            acceptance="2024-08-01T21:00:00.000000Z",
            usable="2024-08-02",
        )
        self._ingest_all(
            {ACCESSION: _default_files(), amendment: _default_files()}
        )
        self.assertEqual(self._select("2024-06-28")["accession"], ACCESSION)

    def test_same_acceptance_breaks_by_accession_desc(self):
        second = "0000320193-24-000009"
        _seed_filing(self.connection)
        _seed_filing(
            self.connection,
            accession=second,
            acceptance="2024-02-01T21:00:00.000000Z",
            usable="2024-02-02",
        )
        self._ingest_all({ACCESSION: _default_files(), second: _default_files()})
        self.assertEqual(self._select("2024-06-28")["accession"], second)

    def test_latest_usable_failure_does_not_fall_back_to_older_filing(self):
        broken = "0000320193-24-000002"
        _seed_filing(self.connection)
        _seed_filing(
            self.connection,
            accession=broken,
            form="10-K/A",
            acceptance="2024-03-01T21:00:00.000000Z",
            usable="2024-03-04",
        )
        no_revenue = build_files(
            contexts=base_contexts(),
            facts=[_dei_period(), B.fact("us-gaap", "Assets", "i", "500")],
            roles=simple_roles(income=[], balance=["Assets"]),
        )
        self._ingest_all({ACCESSION: _default_files(), broken: no_revenue})
        row = self._select("2024-06-28")
        self.assertEqual(row["accession"], broken)
        self.assertEqual(row["revenue_status"], MISSING)
        self.assertIsNone(row["revenue_value"])

    def test_dpe_failed_amendment_does_not_fall_back_to_older_filing(self):
        """최신 usable filing의 DPE가 안 풀려도 older original로 물러나지 않는다."""
        amendment = "0000320193-24-000002"
        _seed_filing(self.connection)
        _seed_filing(
            self.connection,
            accession=amendment,
            form="10-K/A",
            acceptance="2024-03-01T21:00:00.000000Z",
            usable="2024-03-04",
            report_date=DPE,
        )
        no_dpe = build_files(
            contexts=base_contexts(),
            facts=[
                B.fact("us-gaap", "Revenues", "d", "100"),
                B.fact("us-gaap", "CostOfRevenue", "d", "60"),
                B.fact("us-gaap", "Assets", "i", "500"),
            ],
            roles=simple_roles(
                income=["Revenues", "CostOfRevenue"], balance=["Assets"]
            ),
        )
        self._ingest_all({ACCESSION: _default_files(), amendment: no_dpe})
        row = self._select("2024-06-28")
        self.assertIsNotNone(row)
        self.assertEqual(row["accession"], amendment)
        self.assertIsNone(row["fiscal_period_end"])
        self.assertEqual(row["revenue_status"], MISSING)
        self.assertIsNone(row["book_equity_value"])

    def test_ambiguous_dpe_amendment_also_blocks_older_fallback(self):
        amendment = "0000320193-24-000002"
        _seed_filing(self.connection)
        _seed_filing(
            self.connection,
            accession=amendment,
            form="10-K/A",
            acceptance="2024-03-01T21:00:00.000000Z",
            usable="2024-03-04",
            report_date=DPE,
        )
        ambiguous_dpe = build_files(
            contexts=base_contexts([B.context("dpe2", cik=CIK, start=START, end=DPE)]),
            facts=[
                _dei_period(),
                '<dei:DocumentPeriodEndDate contextRef="dpe2">2023-12-30'
                "</dei:DocumentPeriodEndDate>",
                B.fact("us-gaap", "Assets", "i", "500"),
            ],
            roles=simple_roles(income=[], balance=["Assets"]),
        )
        self._ingest_all({ACCESSION: _default_files(), amendment: ambiguous_dpe})
        row = self._select("2024-06-28")
        self.assertEqual(row["accession"], amendment)
        self.assertIsNone(row["fiscal_period_end"])

    def test_report_date_is_never_promoted_to_fiscal_period_end(self):
        _seed_filing(self.connection, report_date="2023-12-31")
        no_dpe = build_files(
            contexts=base_contexts(),
            facts=[B.fact("us-gaap", "Assets", "i", "500")],
            roles=simple_roles(income=[], balance=["Assets"]),
        )
        self._ingest_all({ACCESSION: no_dpe})
        row = self._select("2024-06-28")
        self.assertEqual(row["accession"], ACCESSION)
        self.assertIsNone(row["fiscal_period_end"])
        self.assertEqual(row["report_date"], "2023-12-31")

    def test_ten_q_never_enters_selection(self):
        _seed_filing(self.connection)
        _seed_filing(
            self.connection,
            accession="0000320193-24-000003",
            form="10-Q",
            acceptance="2024-05-01T21:00:00.000000Z",
            usable="2024-05-02",
        )
        self._ingest_all({ACCESSION: _default_files()})
        self.assertEqual(self._select("2024-06-28")["accession"], ACCESSION)

    def test_filing_without_usable_session_is_not_selected(self):
        _seed_filing(self.connection, usable=None)
        self._ingest_all({ACCESSION: _default_files()})
        self.assertIsNone(self._select("2024-06-28"))


if __name__ == "__main__":
    unittest.main()
