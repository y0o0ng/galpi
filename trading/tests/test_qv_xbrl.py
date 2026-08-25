"""QV raw-XBRL 파서의 구조 불변식. 네트워크를 쓰지 않는다."""

from __future__ import annotations

import sys
import unittest
from decimal import Decimal
from pathlib import Path

TRADING_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TRADING_ROOT))

from backtest.qv_xbrl import (  # noqa: E402
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
    resolve_locator,
)
from tests.fixtures.qv_xbrl import builder as B  # noqa: E402

CIK = "0000320193"
OTHER_CIK = "0000037634"
AXIS = "us-gaap:LegalEntityAxis"
MEMBER = "acme:SubsidiaryMember"


def _index(names):
    return {"directory": {"item": [{"name": n} for n in names]}}


class NamespaceTest(unittest.TestCase):
    def test_us_gaap_namespace_is_matched_by_uri_not_prefix(self):
        self.assertTrue(is_us_gaap("http://fasb.org/us-gaap/2023"))
        self.assertTrue(is_us_gaap("http://xbrl.us/us-gaap/2009-01-31"))
        self.assertFalse(is_us_gaap("http://example.com/us-gaap"))
        self.assertFalse(is_us_gaap(B.CUSTOM_NS))

    def test_dei_namespace(self):
        self.assertTrue(is_dei("http://xbrl.sec.gov/dei/2023"))
        self.assertFalse(is_dei(B.CUSTOM_NS))

    def test_normalize_cik(self):
        self.assertEqual(normalize_cik("320193"), CIK)
        self.assertEqual(normalize_cik(CIK), CIK)
        self.assertIsNone(normalize_cik("not-a-cik"))
        self.assertIsNone(normalize_cik("12345678901"))


class ContextTest(unittest.TestCase):
    def _doc(self, contexts, facts):
        return parse_instance(B.instance(contexts, facts), "i.xml")

    def test_dimensionless_context(self):
        doc = self._doc(
            [B.context("c1", cik=CIK, instant="2023-12-31")],
            [B.fact("us-gaap", "Assets", "c1", "100")],
        )
        self.assertTrue(doc.contexts[0].dimensionless)
        self.assertEqual(doc.contexts[0].instant, "2023-12-31")

    def test_explicit_dimension_is_not_dimensionless(self):
        doc = self._doc(
            [
                B.context(
                    "c1", cik=CIK, instant="2023-12-31", dimensions=((AXIS, MEMBER),)
                )
            ],
            [B.fact("us-gaap", "Assets", "c1", "100")],
        )
        self.assertFalse(doc.contexts[0].dimensionless)
        self.assertEqual(doc.contexts[0].dimensions, ((AXIS, MEMBER),))

    def test_typed_dimension_is_not_dimensionless(self):
        doc = self._doc(
            [B.context("c1", cik=CIK, instant="2023-12-31", typed=("acme:TypedAxis",))],
            [B.fact("us-gaap", "Assets", "c1", "100")],
        )
        self.assertFalse(doc.contexts[0].dimensionless)
        self.assertEqual(doc.contexts[0].typed_dimensions, ("acme:TypedAxis",))

    def test_entity_cik_is_normalized(self):
        doc = self._doc(
            [B.context("c1", cik="320193", instant="2023-12-31")],
            [B.fact("us-gaap", "Assets", "c1", "100")],
        )
        self.assertEqual(doc.contexts[0].cik, CIK)

    def test_duration_context(self):
        doc = self._doc(
            [B.context("d1", cik=CIK, start="2023-01-01", end="2023-12-31")],
            [B.fact("us-gaap", "Revenues", "d1", "100")],
        )
        self.assertIsNone(doc.contexts[0].instant)
        self.assertEqual(doc.contexts[0].start, "2023-01-01")
        self.assertEqual(doc.contexts[0].end, "2023-12-31")


class FactTest(unittest.TestCase):
    def test_unit_resolution_and_decimal_exactness(self):
        doc = parse_instance(
            B.instance(
                [B.context("c1", cik=CIK, instant="2023-12-31")],
                [
                    B.fact("us-gaap", "Assets", "c1", "86038000000", decimals="-6"),
                    B.fact(
                        "us-gaap",
                        "CommonStockSharesOutstanding",
                        "c1",
                        "3778302017",
                        unit="shares",
                        decimals="INF",
                    ),
                ],
            ),
            "i.xml",
        )
        by_local = {f.local_name: f for f in doc.facts}
        self.assertEqual(by_local["Assets"].unit, "iso4217:USD")
        self.assertEqual(by_local["Assets"].value, Decimal("86038000000"))
        self.assertEqual(by_local["Assets"].decimals, "-6")
        self.assertEqual(by_local["CommonStockSharesOutstanding"].unit, "xbrli:shares")
        self.assertEqual(by_local["CommonStockSharesOutstanding"].decimals, "INF")

    def test_decimal_value_is_not_float(self):
        doc = parse_instance(
            B.instance(
                [B.context("c1", cik=CIK, instant="2023-12-31")],
                [B.fact("us-gaap", "Assets", "c1", "0.1")],
            ),
            "i.xml",
        )
        self.assertIsInstance(doc.facts[0].value, Decimal)
        self.assertEqual(doc.facts[0].value * 3, Decimal("0.3"))

    def test_precision_is_preserved_when_present(self):
        raw = B.instance(
            [B.context("c1", cik=CIK, instant="2023-12-31")],
            ['<us-gaap:Assets contextRef="c1" unitRef="usd" precision="6">100</us-gaap:Assets>'],
        )
        doc = parse_instance(raw, "i.xml")
        self.assertEqual(doc.facts[0].precision, "6")
        self.assertIsNone(doc.facts[0].decimals)

    def test_custom_namespace_fact_keeps_its_namespace(self):
        doc = parse_instance(
            B.instance(
                [B.context("c1", cik=CIK, instant="2023-12-31")],
                [B.fact("acme", "NoncurrentDeferredAndRefundableIncomeTaxes", "c1", "5")],
            ),
            "i.xml",
        )
        self.assertEqual(doc.facts[0].namespace, B.CUSTOM_NS)
        self.assertFalse(is_us_gaap(doc.facts[0].namespace))

    def test_multiple_registrant_facts_stay_separable(self):
        doc = parse_instance(
            B.instance(
                [
                    B.context("p", cik=CIK, instant="2023-12-31"),
                    B.context("s", cik=OTHER_CIK, instant="2023-12-31"),
                ],
                [
                    B.fact("us-gaap", "Assets", "p", "212721000000"),
                    B.fact("us-gaap", "Assets", "s", "105158000000"),
                ],
            ),
            "i.xml",
        )
        contexts = doc.context_map()
        by_cik = {
            contexts[f.context_id].cik: f.value for f in doc.facts
        }
        self.assertEqual(by_cik[CIK], Decimal("212721000000"))
        self.assertEqual(by_cik[OTHER_CIK], Decimal("105158000000"))


class DocumentShapeTest(unittest.TestCase):
    def test_instance_and_presentation_are_detected_by_content(self):
        instance = B.instance(
            [B.context("c1", cik=CIK, instant="2023-12-31")],
            [B.fact("us-gaap", "Assets", "c1", "1")],
        )
        presentation = B.presentation(
            {"http://x/role/BS": [("us-gaap_Abstract", "us-gaap_Assets")]}
        )
        self.assertTrue(looks_like_instance(instance, "i.xml"))
        self.assertFalse(looks_like_presentation(instance, "i.xml"))
        self.assertTrue(looks_like_presentation(presentation, "p.xml"))
        self.assertFalse(looks_like_instance(presentation, "p.xml"))

    def test_old_standalone_and_recent_extracted_instance_parse_the_same(self):
        contexts = [B.context("c1", cik=CIK, instant="2023-12-31")]
        facts = [B.fact("us-gaap", "Assets", "c1", "7")]
        old = parse_instance(B.instance(contexts, facts), "acme-20231231.xml")
        recent = parse_instance(B.instance(contexts, facts), "acme-20231231_htm.xml")
        self.assertEqual(old.facts[0].value, recent.facts[0].value)
        self.assertEqual(old.source_file, "acme-20231231.xml")
        self.assertEqual(recent.source_file, "acme-20231231_htm.xml")

    def test_broken_xml_raises(self):
        with self.assertRaises(QVXbrlError):
            parse_instance(b"<xbrli:xbrl", "i.xml")

    def test_non_instance_root_raises(self):
        with self.assertRaises(QVXbrlError):
            parse_instance(b"<root/>", "i.xml")


class PresentationTest(unittest.TestCase):
    def _doc(self):
        instance = parse_instance(
            B.instance(
                [B.context("c1", cik=CIK, instant="2023-12-31")],
                [B.fact("us-gaap", "Assets", "c1", "1")],
            ),
            "i.xml",
        )
        raw = B.presentation(
            {
                "http://x/role/BS": [
                    ("us-gaap_StatementOfFinancialPositionAbstract", "us-gaap_Assets"),
                    ("us-gaap_Assets", "us-gaap_AssetsCurrent"),
                ]
            }
        )
        return parse_presentation(raw, "p.xml", instance.prefix_map()), instance

    def test_parent_child_and_order(self):
        doc, _ = self._doc()
        role = doc.roles[0]
        self.assertEqual(role.role, "http://x/role/BS")
        self.assertEqual([a.order for a in role.arcs], ["1", "2"])
        self.assertIn((B.US_GAAP_NS, "Assets"), role.concepts())

    def test_ancestors(self):
        doc, _ = self._doc()
        role = doc.roles[0]
        self.assertIn(
            (B.US_GAAP_NS, "Assets"), role.ancestors(B.US_GAAP_NS, "AssetsCurrent")
        )
        self.assertNotIn(
            (B.US_GAAP_NS, "AssetsCurrent"), role.ancestors(B.US_GAAP_NS, "Assets")
        )

    def test_unknown_prefix_locator_is_not_guessed(self):
        self.assertEqual(resolve_locator("x.xsd#zzz_Assets", {}), (None, None))
        self.assertEqual(resolve_locator("x.xsd#noUnderscore", {}), (None, None))


class FilingSummaryTest(unittest.TestCase):
    def test_menu_category_separates_statement_from_note(self):
        doc = parse_filing_summary(
            B.filing_summary(
                [
                    {
                        "Role": "http://x/role/BS",
                        "MenuCategory": "Statements",
                        "LongName": "1 - Statement - Balance Sheets",
                        "ShortName": "Balance Sheets",
                    },
                    {
                        "Role": "http://x/role/Note",
                        "MenuCategory": "Details",
                        "LongName": "2 - Disclosure - Segment (Details)",
                        "ShortName": "Segment",
                    },
                ]
            ),
            "FilingSummary.xml",
        )
        self.assertTrue(doc.reports[0].is_statement)
        self.assertFalse(doc.reports[1].is_statement)

    def test_early_xbrl_without_menu_category_uses_long_name_kind(self):
        doc = parse_filing_summary(
            B.filing_summary(
                [
                    {
                        "Role": "http://x/role/BS",
                        "ReportType": "Sheet",
                        "LongName": "104 - Statement - CONSOLIDATED BALANCE SHEETS",
                        "ShortName": "BS",
                        "XmlFileName": "R3.xml",
                    },
                    {
                        "Role": "http://x/role/Note",
                        "ReportType": "Sheet",
                        "LongName": "205 - Disclosure - SEGMENT INFORMATION",
                        "ShortName": "Segment",
                        "XmlFileName": "R20.xml",
                    },
                ]
            ),
            "FilingSummary.xml",
        )
        self.assertTrue(doc.reports[0].is_statement)
        self.assertFalse(doc.reports[1].is_statement)
        self.assertEqual(doc.reports[0].long_name_kind, "Statement")

    def test_report_without_type_information_is_not_a_statement(self):
        doc = parse_filing_summary(
            B.filing_summary([{"Role": "http://x/role/BS", "ShortName": "Balance Sheets"}]),
            "FilingSummary.xml",
        )
        self.assertFalse(doc.reports[0].is_statement)


class CandidateFileTest(unittest.TestCase):
    def test_declared_report_files_are_excluded(self):
        summary = parse_filing_summary(
            B.filing_summary(
                [
                    {
                        "Role": "http://x/role/BS",
                        "LongName": "104 - Statement - BS",
                        "XmlFileName": "R3.xml",
                    }
                ]
            ),
            "FilingSummary.xml",
        )
        names = candidate_xml_names(
            _index(["acme-20231231.xml", "acme-20231231_pre.xml", "R3.xml", "FilingSummary.xml"]),
            summary,
        )
        self.assertEqual(names, ("acme-20231231.xml", "acme-20231231_pre.xml"))

    def test_input_files_do_not_narrow_candidates(self):
        """`InputFiles`는 제출 파일 목록이라 SEC가 만든 추출 instance가 빠진다.

        inline XBRL filing의 `*_htm.xml`이 그 경우이므로 이 목록으로 좁히지 않는다.
        """
        summary = parse_filing_summary(
            B.filing_summary(
                [{"Role": "r", "LongName": "1 - Statement - BS"}],
                input_files=["acme-20231231.htm", "acme-20231231_pre.xml"],
            ),
            "FilingSummary.xml",
        )
        names = candidate_xml_names(
            _index(["acme-20231231_htm.xml", "acme-20231231_pre.xml"]), summary
        )
        self.assertEqual(names, ("acme-20231231_htm.xml", "acme-20231231_pre.xml"))

    def test_malformed_index_raises(self):
        with self.assertRaises(QVXbrlError):
            candidate_xml_names({"directory": {}}, None)


if __name__ == "__main__":
    unittest.main()
