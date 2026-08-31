"""Step 5A-2a/b — SEC identity 제안/증명 packet 계약.

전부 network-free다. `EdgarClient`는 stub이고 실제 SEC 호출은 하지 않는다.
**production manifest 파일(`trading/qv/identity/*.jsonl`)을 읽지도 쓰지도 않는다.**
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

TRADING_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TRADING_ROOT))

from backtest.qv_identity_proposals import (  # noqa: E402
    AUTO_PROVABLE,
    CLASS_CENSUS_COMPLETE,
    CLASS_CENSUS_REVIEW_REQUIRED,
    CLASS_INTERVAL_NOT_EXPLICIT,
    CIK_CONFLICT,
    CURRENT_TICKER_FILE,
    DEMANDED_CLASS_NOT_PROVED_ORDINARY_COMMON,
    DISCOVERY_ONLY_NO_SEC_PROOF,
    EXISTING_CIK_OVERRIDE,
    MECHANICALLY_COMPLETE_SEC_PROOF,
    MULTIPLE_DISCOVERY_CANDIDATES,
    NO_COVER_FACTS,
    NO_COVER_PAGE_PROOF_DOCUMENT,
    NO_DISCOVERY_CANDIDATE,
    NO_FILINGS_IN_SCOPE,
    ORDINARY_COMMON_LISTED,
    ORDINARY_COMMON_UNLISTED,
    PRE_INLINE_XBRL_NO_EXPLICIT_BRIDGE,
    REGISTERED_NOT_PROVED_COMMON,
    REGISTRANT_CIK_MISMATCH,
    REVIEW_REQUIRED,
    SIBLING_CLASS_CENSUS_UNCLEAR,
    SUCCESSOR_JUDGEMENT_REQUIRED,
    SYMBOL_NOT_ON_COVER_PAGE,
    SYMBOL_REUSE_CONFLICT,
    UNRESOLVED,
    ClassInterval,
    DiscoveryCandidate,
    EvidenceRef,
    QVProposalError,
    build_symbol_proposal,
    class_role,
    discover_candidates,
    extract_cover_proof,
    fetch_cover_proof,
    load_mapping_demand,
    run_proposals,
)
from backtest.qv_xbrl import parse_instance  # noqa: E402

USG = "http://fasb.org/us-gaap/2024"
DEI = "http://xbrl.sec.gov/dei/2024"
XBRLI = "http://www.xbrl.org/2003/instance"
XBRLDI = "http://xbrl.org/2006/xbrldi"


def cover_instance(facts: list[dict], *, default_cik: str) -> bytes:
    """합성 표지 instance.

    fact 키: `concept`(local), `value`, `member`(local|None), `axis`(local),
    `cik`(그 context의 entity CIK), `extra_dim`(axis_local, member_local),
    `numeric`(True면 shares unit을 붙인다).
    """
    contexts: dict[str, str] = {}
    fact_xml: list[str] = []
    for index, item in enumerate(facts):
        cik = item.get("cik") or default_cik
        member = item.get("member")
        axis = item.get("axis", "StatementClassOfStockAxis")
        extra = item.get("extra_dim")
        ctx_id = item.get("context_id") or f"c{index}"
        if ctx_id not in contexts:
            parts = []
            if member:
                prefix = "ext" if item.get("member_ext") else "us-gaap"
                parts.append(
                    f'<xbrldi:explicitMember dimension="us-gaap:{axis}">'
                    f"{prefix}:{member}</xbrldi:explicitMember>"
                )
            if extra:
                extra_axis, extra_member = extra
                parts.append(
                    f'<xbrldi:explicitMember dimension="dei:{extra_axis}">'
                    f"us-gaap:{extra_member}</xbrldi:explicitMember>"
                )
            segment = f'<xbrli:segment>{"".join(parts)}</xbrli:segment>' if parts else ""
            contexts[ctx_id] = (
                f'<xbrli:context id="{ctx_id}"><xbrli:entity>'
                f'<xbrli:identifier scheme="http://www.sec.gov/CIK">{cik}</xbrli:identifier>'
                f"{segment}</xbrli:entity>"
                "<xbrli:period><xbrli:instant>2024-01-31</xbrli:instant></xbrli:period>"
                "</xbrli:context>"
            )
        unit = ' unitRef="shares" decimals="0"' if item.get("numeric") else ""
        local = item["concept"]
        fact_xml.append(
            f'<dei:{local} contextRef="{ctx_id}"{unit}>{item["value"]}</dei:{local}>'
        )
    return (
        '<?xml version="1.0" encoding="UTF-8"?>'
        f'<xbrli:xbrl xmlns:xbrli="{XBRLI}" xmlns:xbrldi="{XBRLDI}"'
        f' xmlns:us-gaap="{USG}" xmlns:dei="{DEI}"'
        ' xmlns:ext="http://example.com/ext">'
        '<xbrli:unit id="shares"><xbrli:measure>xbrli:shares</xbrli:measure></xbrli:unit>'
        + "".join(contexts.values())
        + "".join(fact_xml)
        + "</xbrli:xbrl>"
    ).encode("utf-8")


def proof_from(facts: list[dict], *, cik: str, accession: str = "0000000000-24-000001"):
    document = parse_instance(cover_instance(facts, default_cik=cik), "cover.xml")
    return extract_cover_proof(document, cik=cik, accession=accession, document_name="cover.xml")


def dual_class_facts() -> list[dict]:
    return [
        {"concept": "Security12bTitle", "value": "Class A Common Stock",
         "member": "CommonClassAMember", "context_id": "a"},
        {"concept": "TradingSymbol", "value": "AAA",
         "member": "CommonClassAMember", "context_id": "a"},
        {"concept": "EntityCommonStockSharesOutstanding", "value": "1000",
         "member": "CommonClassAMember", "context_id": "a", "numeric": True},
        {"concept": "EntityCommonStockSharesOutstanding", "value": "500",
         "member": "CommonClassBMember", "context_id": "b", "numeric": True},
    ]


class StubRow:
    def __init__(self, accession, form, acceptance):
        self.accession = accession
        self.form = form
        self.acceptance_eastern_date = acceptance
        self.acceptance_datetime = f"{acceptance}T16:00:00.000Z"
        self.filed_date = acceptance
        self.report_date = acceptance
        self.primary_document = "cover.htm"
        self.submissions_file = "CIK.json"


class StubCompany:
    def __init__(self, cik, name):
        self.cik = cik
        self.name = name


class StubClient:
    """SEC 호출을 흉내내는 stub. 네트워크를 쓰지 않는다."""

    def __init__(self, *, rows_by_cik=None, files_by_accession=None, browse=None):
        self.rows_by_cik = rows_by_cik or {}
        self.files_by_accession = files_by_accession or {}
        self.browse = browse or {}
        self.fetched: list[str] = []

    # cover_filing_rows가 쓰는 경로
    def submissions(self, cik):
        rows = self.rows_by_cik.get(cik, [])
        return {
            "filings": {
                "recent": {
                    "accessionNumber": [row.accession for row in rows],
                    "form": [row.form for row in rows],
                    "filingDate": [row.acceptance_eastern_date for row in rows],
                    "acceptanceDateTime": [
                        f"{row.acceptance_eastern_date}T16:00:00.000Z" for row in rows
                    ],
                    "reportDate": [row.acceptance_eastern_date for row in rows],
                    "primaryDocument": ["cover.htm" for _ in rows],
                },
                "files": [],
            }
        }

    def accession_index(self, cik, accession):
        names = sorted(self.files_by_accession.get(accession, {}))
        return {"directory": {"item": [{"name": name} for name in names]}}

    def accession_file_bytes(self, cik, accession, name):
        self.fetched.append(f"{accession}/{name}")
        files = self.files_by_accession.get(accession, {})
        if name not in files:
            raise KeyError(name)
        return files[name]

    def text(self, url):
        for ticker, cik in self.browse.items():
            if f"={ticker}" in url or ticker in url:
                return f"<cik>{cik}</cik>"
        return ""


INTERVAL_EVIDENCE = (
    EvidenceRef(
        source_kind="SEC_EVIDENCE_DOCUMENT",
        cik="0000000001",
        accession="0000000000-16-000009",
        document_name="charter.htm",
        evidence_role="CLASS_CREATION_CHARTER",
    ),
)


class CoverExtractionTest(unittest.TestCase):
    def test_dual_class_cover_yields_listed_and_unlisted(self):
        proof = proof_from(dual_class_facts(), cik="0000000001")
        self.assertEqual(len(proof.classes), 2)
        by_member = {item.member_local: item for item in proof.classes}
        self.assertEqual(by_member["CommonClassAMember"].trading_symbol, "AAA")
        self.assertEqual(
            by_member["CommonClassAMember"].security_title, "Class A Common Stock"
        )
        self.assertIsNone(by_member["CommonClassBMember"].trading_symbol)
        self.assertEqual(class_role(by_member["CommonClassAMember"]), ORDINARY_COMMON_LISTED)
        self.assertEqual(class_role(by_member["CommonClassBMember"]), ORDINARY_COMMON_UNLISTED)
        self.assertEqual(proof.anomalies, ())

    def test_co_registrant_entity_block_is_excluded(self):
        facts = dual_class_facts() + [
            {"concept": "TradingSymbol", "value": "SUBX", "member": "CommonClassAMember",
             "cik": "0000000999", "context_id": "sub"},
            {"concept": "EntityCommonStockSharesOutstanding", "value": "7", "numeric": True,
             "member": "CommonClassCMember", "cik": "0000000999", "context_id": "sub2"},
        ]
        proof = proof_from(facts, cik="0000000001")
        self.assertEqual(
            sorted(item.member_local for item in proof.classes),
            ["CommonClassAMember", "CommonClassBMember"],
        )

    def test_extra_dimension_is_an_anomaly_not_a_silent_drop(self):
        facts = dual_class_facts() + [
            {"concept": "EntityCommonStockSharesOutstanding", "value": "3", "numeric": True,
             "member": "CommonClassCMember", "extra_dim": ("LegalEntityAxis", "SubsidiaryMember"),
             "context_id": "x"},
        ]
        proof = proof_from(facts, cik="0000000001")
        self.assertIn("EXTRA_DIMENSION_ON_COVER_FACT", proof.anomalies)
        self.assertNotIn(
            "CommonClassCMember", [item.member_local for item in proof.classes]
        )

    def test_conflicting_symbol_on_one_class_is_an_anomaly(self):
        facts = dual_class_facts() + [
            {"concept": "TradingSymbol", "value": "ZZZ",
             "member": "CommonClassAMember", "context_id": "a2"},
        ]
        proof = proof_from(facts, cik="0000000001")
        self.assertIn("CONFLICTING_SYMBOL", proof.anomalies)

    def test_title_only_row_is_not_promoted_to_common(self):
        facts = [
            {"concept": "Security12bTitle", "value": "6.5% Notes due 2029",
             "member": "NotesDue2029Member", "context_id": "w"},
        ]
        proof = proof_from(facts, cik="0000000001")
        self.assertEqual(class_role(proof.classes[0]), REGISTERED_NOT_PROVED_COMMON)

    def test_issuer_extension_member_namespace_is_keyed_by_cik(self):
        """실측 회귀: Apple 표지의 member namespace가 발행사 확장이다."""
        facts = [
            {"concept": "Security12bTitle", "value": "1.375% Notes due 2029",
             "member": "A1.375NotesDue2029Member", "member_ext": True, "context_id": "n"},
        ]
        proof = proof_from(facts, cik="0000000001")
        self.assertEqual(proof.anomalies, ())
        self.assertTrue(proof.classes[0].member_key.startswith("ext:0000000001"))


def full_intervals(proof):
    return {
        item.member_key: ClassInterval("2016-04-08", None, INTERVAL_EVIDENCE)
        for item in proof.classes
    }


TICKER_CANDIDATE = (
    DiscoveryCandidate(cik="0000000001", origin=CURRENT_TICKER_FILE, detail="Acme Inc."),
)


class AdjudicationTest(unittest.TestCase):
    def test_auto_provable_needs_explicit_intervals(self):
        proof = proof_from(dual_class_facts(), cik="0000000001")
        without = build_symbol_proposal(
            symbol="AAA",
            formation_sessions=("2024-06-28",),
            candidates=TICKER_CANDIDATE,
            proof=proof,
        )
        self.assertEqual(without.proposal_status, REVIEW_REQUIRED)
        self.assertIn(CLASS_INTERVAL_NOT_EXPLICIT, without.reason_codes)

        with_intervals = build_symbol_proposal(
            symbol="AAA",
            formation_sessions=("2024-06-28",),
            candidates=TICKER_CANDIDATE,
            proof=proof,
            intervals=full_intervals(proof),
        )
        self.assertEqual(with_intervals.proposal_status, AUTO_PROVABLE)
        self.assertEqual(with_intervals.reason_codes, (MECHANICALLY_COMPLETE_SEC_PROOF,))
        self.assertEqual(with_intervals.class_census_status, CLASS_CENSUS_COMPLETE)

    def test_auto_provable_packet_carries_evidence_on_every_relation(self):
        proof = proof_from(dual_class_facts(), cik="0000000001")
        packet = build_symbol_proposal(
            symbol="AAA",
            formation_sessions=("2024-06-28",),
            candidates=TICKER_CANDIDATE,
            proof=proof,
            intervals=full_intervals(proof),
        )
        self.assertEqual(packet.issuer_proposal.issuer_id, "us-cik-0000000001")
        self.assertTrue(packet.issuer_proposal.evidence)
        self.assertEqual(len(packet.share_class_proposals), 2)
        for group in (
            packet.share_class_proposals,
            packet.xbrl_alias_proposals,
            packet.prose_alias_proposals,
        ):
            for item in group:
                self.assertTrue(item.evidence, item)
        # 미상장 class는 prose alias를 만들지 않는다 — 표지에 제목이 없다.
        self.assertEqual(len(packet.prose_alias_proposals), 1)
        self.assertEqual(len(packet.xbrl_alias_proposals), 2)
        alias = packet.xbrl_alias_proposals[0]
        self.assertEqual(alias.axis_namespace, USG)
        self.assertEqual(alias.axis_local, "StatementClassOfStockAxis")

    def test_auto_provable_is_not_a_manifest_mutation(self):
        proof = proof_from(dual_class_facts(), cik="0000000001")
        run = run_proposals.__module__
        self.assertTrue(run.endswith("qv_identity_proposals"))
        packet = build_symbol_proposal(
            symbol="AAA",
            formation_sessions=("2024-06-28",),
            candidates=TICKER_CANDIDATE,
            proof=proof,
            intervals=full_intervals(proof),
        )
        payload = packet.as_json()
        self.assertEqual(payload["proposal_status"], AUTO_PROVABLE)
        self.assertNotIn("identity_source_version", payload)

    def test_no_candidate_is_unresolved(self):
        packet = build_symbol_proposal(
            symbol="GONE", formation_sessions=("2009-06-26",), candidates=()
        )
        self.assertEqual(packet.proposal_status, UNRESOLVED)
        self.assertIn(NO_DISCOVERY_CANDIDATE, packet.reason_codes)
        self.assertIsNone(packet.selected_cik)

    def test_discovery_without_sec_proof_is_review_required(self):
        packet = build_symbol_proposal(
            symbol="AAA",
            formation_sessions=("2009-06-26",),
            candidates=TICKER_CANDIDATE,
            proof_absence_reason=NO_COVER_FACTS,
        )
        self.assertEqual(packet.proposal_status, REVIEW_REQUIRED)
        self.assertIn(DISCOVERY_ONLY_NO_SEC_PROOF, packet.reason_codes)
        self.assertIn(NO_COVER_PAGE_PROOF_DOCUMENT, packet.reason_codes)
        self.assertIn(NO_COVER_FACTS, packet.unresolved_questions)
        self.assertEqual(packet.selected_cik, "0000000001")

    def test_multiple_ciks_block_even_with_proof(self):
        proof = proof_from(dual_class_facts(), cik="0000000001")
        packet = build_symbol_proposal(
            symbol="AAA",
            formation_sessions=("2024-06-28",),
            candidates=TICKER_CANDIDATE
            + (DiscoveryCandidate(cik="0000000002", origin=EXISTING_CIK_OVERRIDE, detail="pin"),),
            proof=proof,
            intervals=full_intervals(proof),
        )
        self.assertEqual(packet.proposal_status, REVIEW_REQUIRED)
        self.assertIn(MULTIPLE_DISCOVERY_CANDIDATES, packet.reason_codes)
        self.assertIn(CIK_CONFLICT, packet.reason_codes)
        self.assertTrue(packet.conflicts)

    def test_proof_cik_outside_candidates_is_a_mismatch(self):
        proof = proof_from(dual_class_facts(), cik="0000000007")
        packet = build_symbol_proposal(
            symbol="AAA",
            formation_sessions=("2024-06-28",),
            candidates=TICKER_CANDIDATE,
            proof=proof,
            intervals=full_intervals(proof),
        )
        self.assertEqual(packet.proposal_status, REVIEW_REQUIRED)
        self.assertIn(REGISTRANT_CIK_MISMATCH, packet.reason_codes)
        self.assertEqual(packet.selected_cik, "0000000007")

    def test_symbol_absent_from_cover_blocks(self):
        proof = proof_from(dual_class_facts(), cik="0000000001")
        packet = build_symbol_proposal(
            symbol="BBB",
            formation_sessions=("2024-06-28",),
            candidates=TICKER_CANDIDATE,
            proof=proof,
            intervals=full_intervals(proof),
        )
        self.assertEqual(packet.proposal_status, REVIEW_REQUIRED)
        self.assertIn(SYMBOL_NOT_ON_COVER_PAGE, packet.reason_codes)

    def test_symbol_on_two_classes_is_a_reuse_conflict(self):
        facts = dual_class_facts() + [
            {"concept": "Security12bTitle", "value": "Class C Common Stock",
             "member": "CommonClassCMember", "context_id": "c"},
            {"concept": "TradingSymbol", "value": "AAA",
             "member": "CommonClassCMember", "context_id": "c"},
            {"concept": "EntityCommonStockSharesOutstanding", "value": "9", "numeric": True,
             "member": "CommonClassCMember", "context_id": "c"},
        ]
        proof = proof_from(facts, cik="0000000001")
        packet = build_symbol_proposal(
            symbol="AAA",
            formation_sessions=("2024-06-28",),
            candidates=TICKER_CANDIDATE,
            proof=proof,
            intervals=full_intervals(proof),
        )
        self.assertEqual(packet.proposal_status, REVIEW_REQUIRED)
        self.assertIn(SYMBOL_REUSE_CONFLICT, packet.reason_codes)

    def test_cover_anomaly_forces_census_review(self):
        facts = dual_class_facts() + [
            {"concept": "EntityCommonStockSharesOutstanding", "value": "3", "numeric": True,
             "member": "CommonClassCMember", "extra_dim": ("LegalEntityAxis", "SubsidiaryMember"),
             "context_id": "x"},
        ]
        proof = proof_from(facts, cik="0000000001")
        packet = build_symbol_proposal(
            symbol="AAA",
            formation_sessions=("2024-06-28",),
            candidates=TICKER_CANDIDATE,
            proof=proof,
            intervals=full_intervals(proof),
        )
        self.assertEqual(packet.class_census_status, CLASS_CENSUS_REVIEW_REQUIRED)
        self.assertIn(SIBLING_CLASS_CENSUS_UNCLEAR, packet.reason_codes)
        self.assertEqual(packet.proposal_status, REVIEW_REQUIRED)

    def test_mixed_dimensionless_and_axis_rows_force_census_review(self):
        facts = [
            {"concept": "EntityCommonStockSharesOutstanding", "value": "1000",
             "numeric": True, "context_id": "plain"},
            {"concept": "Security12bTitle", "value": "Class A Common Stock",
             "member": "CommonClassAMember", "context_id": "a"},
            {"concept": "TradingSymbol", "value": "AAA",
             "member": "CommonClassAMember", "context_id": "a"},
            {"concept": "EntityCommonStockSharesOutstanding", "value": "1000",
             "member": "CommonClassAMember", "context_id": "a", "numeric": True},
        ]
        proof = proof_from(facts, cik="0000000001")
        packet = build_symbol_proposal(
            symbol="AAA",
            formation_sessions=("2024-06-28",),
            candidates=TICKER_CANDIDATE,
            proof=proof,
            intervals=full_intervals(proof),
        )
        self.assertEqual(packet.class_census_status, CLASS_CENSUS_REVIEW_REQUIRED)
        self.assertEqual(packet.proposal_status, REVIEW_REQUIRED)

    def test_demanded_class_without_shares_fact_blocks(self):
        facts = [
            {"concept": "Security12bTitle", "value": "Class A Common Stock",
             "member": "CommonClassAMember", "context_id": "a"},
            {"concept": "TradingSymbol", "value": "AAA",
             "member": "CommonClassAMember", "context_id": "a"},
            {"concept": "EntityCommonStockSharesOutstanding", "value": "500",
             "member": "CommonClassBMember", "context_id": "b", "numeric": True},
        ]
        proof = proof_from(facts, cik="0000000001")
        packet = build_symbol_proposal(
            symbol="AAA",
            formation_sessions=("2024-06-28",),
            candidates=TICKER_CANDIDATE,
            proof=proof,
            intervals=full_intervals(proof),
        )
        self.assertIn(DEMANDED_CLASS_NOT_PROVED_ORDINARY_COMMON, packet.reason_codes)
        self.assertEqual(packet.proposal_status, REVIEW_REQUIRED)

    def test_successor_judgement_is_never_machine_decided(self):
        proof = proof_from(dual_class_facts(), cik="0000000001")
        packet = build_symbol_proposal(
            symbol="AAA",
            formation_sessions=("2024-06-28",),
            candidates=TICKER_CANDIDATE,
            proof=proof,
            intervals=full_intervals(proof),
            successor_judgement_required=True,
        )
        self.assertEqual(packet.proposal_status, REVIEW_REQUIRED)
        self.assertIn(SUCCESSOR_JUDGEMENT_REQUIRED, packet.reason_codes)

    def test_pre_mandate_cover_is_named_not_confused_with_a_wrong_symbol(self):
        """실측 회귀: 2019 표지 XBRL 의무화 이전 filing은 제목·심볼 칸이 없다."""
        facts = [
            {"concept": "EntityCommonStockSharesOutstanding", "value": "1000",
             "numeric": True, "context_id": "plain"},
        ]
        proof = proof_from(facts, cik="0000000001")
        packet = build_symbol_proposal(
            symbol="AAA",
            formation_sessions=("2019-06-28",),
            candidates=TICKER_CANDIDATE,
            proof=proof,
            intervals=full_intervals(proof),
        )
        self.assertEqual(packet.proposal_status, REVIEW_REQUIRED)
        self.assertIn(SYMBOL_NOT_ON_COVER_PAGE, packet.reason_codes)
        self.assertIn(PRE_INLINE_XBRL_NO_EXPLICIT_BRIDGE, packet.reason_codes)

    def test_registered_non_common_rows_do_not_block_but_are_surfaced(self):
        """실측 회귀: 표지의 notes 줄이 census를 막지도, 조용히 사라지지도 않는다."""
        facts = dual_class_facts() + [
            {"concept": "Security12bTitle", "value": "1.375% Notes due 2029",
             "member": "NotesDue2029Member", "context_id": "n"},
        ]
        proof = proof_from(facts, cik="0000000001")
        packet = build_symbol_proposal(
            symbol="AAA",
            formation_sessions=("2024-06-28",),
            candidates=TICKER_CANDIDATE,
            proof=proof,
            intervals=full_intervals(proof),
        )
        self.assertEqual(packet.class_census_status, CLASS_CENSUS_COMPLETE)
        self.assertEqual(packet.proposal_status, AUTO_PROVABLE)
        self.assertEqual(len(packet.share_class_proposals), 2)
        self.assertTrue(
            any("1.375% Notes due 2029" in note for note in packet.unresolved_questions)
        )

    def test_unknown_discovery_origin_is_rejected(self):
        with self.assertRaises(QVProposalError):
            build_symbol_proposal(
                symbol="AAA",
                formation_sessions=("2024-06-28",),
                candidates=(DiscoveryCandidate(cik="0000000001", origin="GUESS"),),
            )

    def test_status_vocabulary_is_exactly_three(self):
        proof = proof_from(dual_class_facts(), cik="0000000001")
        seen = {
            build_symbol_proposal(
                symbol="AAA", formation_sessions=(), candidates=TICKER_CANDIDATE,
                proof=proof, intervals=full_intervals(proof),
            ).proposal_status,
            build_symbol_proposal(
                symbol="AAA", formation_sessions=(), candidates=TICKER_CANDIDATE,
            ).proposal_status,
            build_symbol_proposal(
                symbol="AAA", formation_sessions=(), candidates=(),
            ).proposal_status,
        }
        self.assertEqual(seen, {AUTO_PROVABLE, REVIEW_REQUIRED, UNRESOLVED})


class DemandTest(unittest.TestCase):
    def payload(self, **overrides):
        base = {
            "stage": "5A-1",
            "measures": "STATIC_MAPPING_COVERAGE_DEMAND",
            "identity_source_version": "qv-identity-sha256:abc",
            "securities": [
                {"symbol": "AAA", "formation_session": "2024-06-28", "status": "UNMAPPED"},
                {"symbol": "AAA", "formation_session": "2023-06-30", "status": "UNMAPPED"},
                {"symbol": "BBB", "formation_session": "2024-06-28", "status": "MAPPED"},
                {"symbol": "CCC", "formation_session": "2024-06-28",
                 "status": "AMBIGUOUS_MAPPING"},
            ],
        }
        base.update(overrides)
        return base

    def test_only_unmapped_and_ambiguous_rows_are_demand(self):
        demand = load_mapping_demand(self.payload())
        self.assertEqual(sorted(demand), ["AAA", "CCC"])
        self.assertEqual(demand["AAA"], ("2023-06-30", "2024-06-28"))

    def test_non_5a1_payload_fails_closed(self):
        with self.assertRaises(QVProposalError):
            load_mapping_demand(self.payload(stage="5A-3"))
        with self.assertRaises(QVProposalError):
            load_mapping_demand(self.payload(measures="PIT_IDENTITY_USABILITY"))


class DiscoveryTest(unittest.TestCase):
    def test_ticker_map_and_override_are_both_candidates(self):
        found = discover_candidates(
            "AAA",
            companies={"AAA": StubCompany("0000000001", "Acme Inc.")},
            overrides={"AAA": "0000000002"},
        )
        self.assertEqual(
            sorted((item.cik, item.origin) for item in found),
            [("0000000001", CURRENT_TICKER_FILE), ("0000000002", EXISTING_CIK_OVERRIDE)],
        )

    def test_discovery_is_deterministic_and_deduplicated(self):
        extra = (
            DiscoveryCandidate(cik="0000000001", origin=CURRENT_TICKER_FILE, detail="Acme Inc."),
        )
        first = discover_candidates(
            "AAA", companies={"AAA": StubCompany("0000000001", "Acme Inc.")}, extra=extra
        )
        second = discover_candidates(
            "AAA", companies={"AAA": StubCompany("0000000001", "Acme Inc.")}, extra=extra
        )
        self.assertEqual(first, second)
        self.assertEqual(len(first), 1)

    def test_missing_symbol_yields_no_candidate(self):
        self.assertEqual(discover_candidates("ZZZ", companies={}, overrides={}), ())


class FetchTest(unittest.TestCase):
    def client_with_cover(self, *, forms=("10-K",), facts=None):
        facts = dual_class_facts() if facts is None else facts
        return StubClient(
            rows_by_cik={
                "0000000001": [
                    StubRow("0000000001-24-000001", forms[0], "2024-02-20"),
                    StubRow("0000000001-25-000001", forms[0], "2025-02-20"),
                ]
            },
            files_by_accession={
                "0000000001-24-000001": {
                    "cover.xml": cover_instance(facts, default_cik="0000000001")
                },
                "0000000001-25-000001": {
                    "cover.xml": cover_instance(facts, default_cik="0000000001")
                },
            },
        )

    def test_proof_never_comes_from_after_the_demanded_session(self):
        client = self.client_with_cover()
        proof, absence, tried = fetch_cover_proof(
            client, "0000000001", not_after_session="2024-06-28"
        )
        self.assertIsNone(absence)
        self.assertEqual(proof.accession, "0000000001-24-000001")
        self.assertEqual(tried, ("0000000001-24-000001",))

    def test_no_filings_in_scope_is_named(self):
        client = self.client_with_cover()
        proof, absence, tried = fetch_cover_proof(
            client, "0000000001", not_after_session="2009-06-26"
        )
        self.assertIsNone(proof)
        self.assertEqual(absence, NO_FILINGS_IN_SCOPE)
        self.assertEqual(tried, ())

    def test_cover_without_dei_class_facts_is_absence_not_a_guess(self):
        empty = cover_instance(
            [{"concept": "EntityRegistrantName", "value": "Acme Inc.", "context_id": "p"}],
            default_cik="0000000001",
        )
        client = StubClient(
            rows_by_cik={"0000000001": [StubRow("0000000001-10-000001", "10-K", "2010-02-20")]},
            files_by_accession={"0000000001-10-000001": {"cover.xml": empty}},
        )
        proof, absence, tried = fetch_cover_proof(client, "0000000001")
        self.assertIsNone(proof)
        self.assertEqual(absence, NO_COVER_FACTS)
        self.assertEqual(tried, ("0000000001-10-000001",))


class RunTest(unittest.TestCase):
    def test_run_is_deterministic_and_declares_no_manifest_mutation(self):
        facts = dual_class_facts()
        client = StubClient(
            rows_by_cik={"0000000001": [StubRow("0000000001-24-000001", "10-K", "2024-02-20")]},
            files_by_accession={
                "0000000001-24-000001": {
                    "cover.xml": cover_instance(facts, default_cik="0000000001")
                }
            },
        )
        demand = {"AAA": ("2024-06-28",), "ZZZ": ("2024-06-28",)}
        companies = {"AAA": StubCompany("0000000001", "Acme Inc.")}
        run = run_proposals(
            client,
            demand,
            companies=companies,
            overrides={},
            identity_source_version="qv-identity-sha256:abc",
            demand_source="runs/x/inventory.json",
        )
        payload = run.as_json()
        self.assertIs(payload["mutates_production_manifest"], False)
        self.assertEqual(payload["stage"], "5A-2")
        self.assertEqual([item["symbol"] for item in payload["proposals"]], ["AAA", "ZZZ"])
        self.assertEqual(run.counts()[UNRESOLVED], 1)
        self.assertEqual(run.counts()[REVIEW_REQUIRED], 1)
        self.assertEqual(run.counts()[AUTO_PROVABLE], 0)
        self.assertIn(CLASS_INTERVAL_NOT_EXPLICIT, run.reason_counts())

    def test_ambiguous_candidates_skip_the_sec_fetch_entirely(self):
        client = StubClient(rows_by_cik={}, files_by_accession={})
        run = run_proposals(
            client,
            {"AAA": ("2024-06-28",)},
            companies={"AAA": StubCompany("0000000001", "Acme Inc.")},
            overrides={"AAA": "0000000002"},
            identity_source_version="qv-identity-sha256:abc",
            demand_source="runs/x/inventory.json",
        )
        self.assertEqual(client.fetched, [])
        self.assertEqual(run.proposals[0].proposal_status, REVIEW_REQUIRED)
        self.assertIn(CIK_CONFLICT, run.proposals[0].reason_codes)


class ManifestIsolationTest(unittest.TestCase):
    def test_module_never_touches_the_production_manifest(self):
        source = (
            TRADING_ROOT / "backtest" / "qv_identity_proposals.py"
        ).read_text(encoding="utf-8")
        for forbidden in ("qv/identity", "issuers.jsonl", "share_classes.jsonl",
                          "load_manifest", "materialize"):
            self.assertNotIn(forbidden, source, forbidden)


if __name__ == "__main__":
    unittest.main()
