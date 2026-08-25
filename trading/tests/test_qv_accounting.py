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
    ACCOUNTING_DEFINITION_VERSION,
    AMBIGUOUS,
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


def _dei_period(context_id: str = "dpe") -> str:
    return (
        f'<dei:DocumentPeriodEndDate contextRef="{context_id}">{DPE}'
        "</dei:DocumentPeriodEndDate>"
    )


def build_files(
    *,
    contexts: list[str],
    facts: list[str],
    roles: dict[str, list[tuple[str, str]]],
    reports: list[dict] | None = None,
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
    return {
        "FilingSummary.xml": B.filing_summary(
            reports, input_files=[INSTANCE_NAME, PRESENTATION_NAME]
        ),
        INSTANCE_NAME: B.instance(contexts, facts),
        PRESENTATION_NAME: B.presentation(roles),
    }


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

    def test_structural_total_is_used_when_hierarchy_resolves_it(self):
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
        self.assertEqual(result.revenue_value, "100")
        self.assertEqual(result.gross_profit_value, "30")


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

    def _ingest(self, files=None, version=ACCOUNTING_SOURCE_VERSION):
        return ingest_accounting(
            self.connection,
            FakeClient(files or _default_files()),
            cik=CIK,
            filing_source_version=FILING_SOURCE_VERSION,
            accounting_source=ACCOUNTING_SOURCE,
            accounting_source_version=version,
        )

    def test_row_is_written_with_canonical_values(self):
        self.assertEqual(self._ingest(), 1)
        row = self.connection.execute("SELECT * FROM qv_accounting_filings").fetchone()
        self.assertEqual(row["revenue_value"], "100")
        self.assertEqual(row["gross_profit_value"], "40")
        self.assertEqual(row["assets_value"], "500")
        self.assertEqual(row["book_equity_value"], "300")
        self.assertEqual(row["accounting_definition_version"], ACCOUNTING_DEFINITION_VERSION)

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
