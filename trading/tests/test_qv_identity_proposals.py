"""Step 5A-2a/b — SEC identity 제안/증명 packet 계약.

전부 network-free다. `EdgarClient`는 stub이고 실제 SEC 호출은 하지 않는다.
**production manifest 파일(`trading/qv/identity/*.jsonl`)을 읽지도 쓰지도 않는다.**
"""

from __future__ import annotations

import json
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
    NO_EXPLICIT_COVER_SYMBOL_ANYWHERE,
    NO_PERIODIC_FILINGS,
    NO_TARGET_SYMBOL_COVER_PROOF,
    ORDINARY_COMMON_LISTED,
    ORDINARY_COMMON_UNLISTED,
    PRE_INLINE_XBRL_NO_EXPLICIT_BRIDGE,
    REGISTERED_NOT_PROVED_COMMON,
    REGISTRANT_CIK_MISMATCH,
    REUSED_SERIES_ONLY_CURRENT_TICKER_CANDIDATE,
    REVIEW_REQUIRED,
    SIBLING_CLASS_CENSUS_UNCLEAR,
    SUCCESSOR_JUDGEMENT_REQUIRED,
    SYMBOL_NOT_ON_COVER_PAGE,
    SYMBOL_REUSE_CONFLICT,
    UNRESOLVED,
    HISTORICAL_NAME_LOOKUP,
    PREDECESSOR_HINT,
    DIRECT,
    REUSED_VENDOR_SERIES,
    CANONICAL_CLASS_BRIDGE_NOT_EXPLICIT,
    COVER_GROUP_LABEL,
    GOVERNING_INSTRUMENT,
    PROSE_ALIAS_INTERVAL_NOT_EXPLICIT,
    SECURITY_TITLE_FACT,
    XBRL_ALIAS_INTERVAL_NOT_EXPLICIT,
    ClassEvidence,
    ProseBridgeInput,
    RelationInterval,
    DemandInput,
    DiscoveryCandidate,
    DiscoveryHints,
    EvidenceRef,
    QVProposalError,
    WorkItem,
    build_symbol_proposal,
    canonical_bridges_for,
    class_role,
    cover_classes_for_symbol,
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

    def __init__(
        self,
        *,
        rows_by_cik=None,
        files_by_accession=None,
        browse=None,
        name_index=None,
        earnings_by_cik=None,
        submissions_extra=None,
    ):
        self.rows_by_cik = rows_by_cik or {}
        self.files_by_accession = files_by_accession or {}
        self.browse = browse or {}
        self.name_index = name_index
        self.earnings_by_cik = earnings_by_cik or {}
        self.submissions_extra = submissions_extra or {}
        self.fetched: list[str] = []
        self.cik_lookup_calls = 0

    # cover_filing_rows가 쓰는 경로
    def submissions(self, cik):
        rows = self.rows_by_cik.get(cik, [])
        payload = dict(self.submissions_extra.get(cik) or {})
        payload["filings"] = {
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
        return payload

    def cik_lookup(self):
        self.cik_lookup_calls += 1
        if self.name_index is None:
            raise AssertionError("이 stub에는 이름 색인이 없다")
        return self.name_index

    def all_earnings_dates(self, cik, window_start=None):
        dates = sorted(self.earnings_by_cik.get(cik, []))
        if window_start:
            dates = [item for item in dates if item >= window_start]
        return dates, self.submissions(cik)

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


BIRTH = "2016-04-08"

GOVERNING_EVIDENCE = (
    EvidenceRef(
        source_kind="SEC_EVIDENCE_DOCUMENT",
        cik="0000000001",
        accession="0000000000-16-000011",
        document_name="charter.htm",
        evidence_role="CHARTER_CLASS_DEFINITION",
    ),
)


def span(evidence=INTERVAL_EVIDENCE, start=BIRTH, end=None):
    return RelationInterval(start, end, evidence)


def intervals_only(proof, **kwargs):
    """**세 관계의 구간만** 채운다. canonical bridge를 보충하지 않는다.

    제목 없는 보통주 sibling은 여전히 canonical bridge가 없다 — 그것이 계약이다.
    """
    return {
        item.member_key: ClassEvidence(
            class_interval=span(**kwargs),
            xbrl_interval=span(**kwargs),
            cover_title_interval=span(**kwargs) if item.security_title else None,
        )
        for item in proof.classes
    }


def complete_evidence(proof):
    """구간 셋 + 제목 없는 보통주 class의 명시 governing instrument bridge까지.

    **표지 제목이 없는 class는 이것 없이는 절대 `AUTO_PROVABLE`이 되지 않는다.**
    """
    out = {}
    for item in proof.classes:
        extra = ()
        if not item.security_title:
            extra = (
                ProseBridgeInput(
                    raw_prose_name=f"{item.member_local or 'Common'} charter definition",
                    bridge_type=GOVERNING_INSTRUMENT,
                    interval=span(GOVERNING_EVIDENCE),
                ),
            )
        out[item.member_key] = ClassEvidence(
            class_interval=span(),
            xbrl_interval=span(),
            cover_title_interval=span() if item.security_title else None,
            extra_prose_bridges=extra,
        )
    return out


TICKER_CANDIDATE = (
    DiscoveryCandidate(cik="0000000001", origin=CURRENT_TICKER_FILE, detail="Acme Inc."),
)


def work(identity, sessions, *, member=None):
    """작업 항목 하나. `member`를 주면 재사용 벤더 계열 항목이 된다."""
    if member is None or member == identity:
        return WorkItem(identity, identity, DIRECT, tuple(sessions))
    return WorkItem(member, identity, REUSED_VENDOR_SERIES, tuple(sessions))


class AdjudicationTest(unittest.TestCase):
    def test_auto_provable_needs_explicit_intervals(self):
        proof = proof_from(dual_class_facts(), cik="0000000001")
        without = build_symbol_proposal(
            work_item=work("AAA", ("2024-06-28",)),
            candidates=TICKER_CANDIDATE,
            proof=proof,
        )
        self.assertEqual(without.proposal_status, REVIEW_REQUIRED)
        self.assertIn(CLASS_INTERVAL_NOT_EXPLICIT, without.reason_codes)

        with_intervals = build_symbol_proposal(
            work_item=work("AAA", ("2024-06-28",)),
            candidates=TICKER_CANDIDATE,
            proof=proof,
            class_evidence=complete_evidence(proof),
        )
        self.assertEqual(with_intervals.proposal_status, AUTO_PROVABLE)
        self.assertEqual(with_intervals.reason_codes, (MECHANICALLY_COMPLETE_SEC_PROOF,))
        self.assertEqual(with_intervals.class_census_status, CLASS_CENSUS_COMPLETE)

    def test_auto_provable_packet_carries_evidence_on_every_relation(self):
        proof = proof_from(dual_class_facts(), cik="0000000001")
        packet = build_symbol_proposal(
            work_item=work("AAA", ("2024-06-28",)),
            candidates=TICKER_CANDIDATE,
            proof=proof,
            class_evidence=complete_evidence(proof),
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
        # 표지에서 나온 prose alias는 제목이 있는 class 하나뿐이고, 제목 없는
        # sibling은 **명시 governing instrument bridge**로만 canonical이 된다.
        by_type = {}
        for item in packet.prose_alias_proposals:
            by_type.setdefault(item.bridge_type, []).append(item)
        self.assertEqual(sorted(by_type), [GOVERNING_INSTRUMENT, SECURITY_TITLE_FACT])
        self.assertEqual(len(packet.prose_alias_proposals), 2)
        self.assertEqual(len(packet.xbrl_alias_proposals), 2)
        # 관계마다 자기 구간이 따로 증명돼 있다.
        for group in (packet.share_class_proposals, packet.xbrl_alias_proposals,
                      packet.prose_alias_proposals):
            for item in group:
                self.assertTrue(item.interval_proved, item)
                self.assertIsNotNone(item.effective_from, item)
        alias = packet.xbrl_alias_proposals[0]
        self.assertEqual(alias.axis_namespace, USG)
        self.assertEqual(alias.axis_local, "StatementClassOfStockAxis")

    def test_auto_provable_is_not_a_manifest_mutation(self):
        proof = proof_from(dual_class_facts(), cik="0000000001")
        run = run_proposals.__module__
        self.assertTrue(run.endswith("qv_identity_proposals"))
        packet = build_symbol_proposal(
            work_item=work("AAA", ("2024-06-28",)),
            candidates=TICKER_CANDIDATE,
            proof=proof,
            class_evidence=complete_evidence(proof),
        )
        payload = packet.as_json()
        self.assertEqual(payload["proposal_status"], AUTO_PROVABLE)
        self.assertNotIn("identity_source_version", payload)

    def test_no_candidate_is_unresolved(self):
        packet = build_symbol_proposal(
            work_item=work("GONE", ("2009-06-26",)), candidates=()
        )
        self.assertEqual(packet.proposal_status, UNRESOLVED)
        self.assertIn(NO_DISCOVERY_CANDIDATE, packet.reason_codes)
        self.assertIsNone(packet.selected_cik)

    def test_discovery_without_sec_proof_is_review_required(self):
        packet = build_symbol_proposal(
            work_item=work("AAA", ("2009-06-26",)),
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
            work_item=work("AAA", ("2024-06-28",)),
            candidates=TICKER_CANDIDATE
            + (DiscoveryCandidate(cik="0000000002", origin=EXISTING_CIK_OVERRIDE, detail="pin"),),
            proof=proof,
            class_evidence=complete_evidence(proof),
        )
        self.assertEqual(packet.proposal_status, REVIEW_REQUIRED)
        self.assertIn(MULTIPLE_DISCOVERY_CANDIDATES, packet.reason_codes)
        self.assertIn(CIK_CONFLICT, packet.reason_codes)
        self.assertTrue(packet.conflicts)

    def test_proof_cik_outside_candidates_is_a_mismatch(self):
        proof = proof_from(dual_class_facts(), cik="0000000007")
        packet = build_symbol_proposal(
            work_item=work("AAA", ("2024-06-28",)),
            candidates=TICKER_CANDIDATE,
            proof=proof,
            class_evidence=complete_evidence(proof),
        )
        self.assertEqual(packet.proposal_status, REVIEW_REQUIRED)
        self.assertIn(REGISTRANT_CIK_MISMATCH, packet.reason_codes)
        self.assertEqual(packet.selected_cik, "0000000007")

    def test_symbol_absent_from_cover_blocks(self):
        proof = proof_from(dual_class_facts(), cik="0000000001")
        packet = build_symbol_proposal(
            work_item=work("BBB", ("2024-06-28",)),
            candidates=TICKER_CANDIDATE,
            proof=proof,
            class_evidence=complete_evidence(proof),
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
            work_item=work("AAA", ("2024-06-28",)),
            candidates=TICKER_CANDIDATE,
            proof=proof,
            class_evidence=complete_evidence(proof),
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
            work_item=work("AAA", ("2024-06-28",)),
            candidates=TICKER_CANDIDATE,
            proof=proof,
            class_evidence=complete_evidence(proof),
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
            work_item=work("AAA", ("2024-06-28",)),
            candidates=TICKER_CANDIDATE,
            proof=proof,
            class_evidence=complete_evidence(proof),
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
            work_item=work("AAA", ("2024-06-28",)),
            candidates=TICKER_CANDIDATE,
            proof=proof,
            class_evidence=complete_evidence(proof),
        )
        self.assertIn(DEMANDED_CLASS_NOT_PROVED_ORDINARY_COMMON, packet.reason_codes)
        self.assertEqual(packet.proposal_status, REVIEW_REQUIRED)

    def test_successor_judgement_is_never_machine_decided(self):
        proof = proof_from(dual_class_facts(), cik="0000000001")
        packet = build_symbol_proposal(
            work_item=work("AAA", ("2024-06-28",)),
            candidates=TICKER_CANDIDATE,
            proof=proof,
            class_evidence=complete_evidence(proof),
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
            work_item=work("AAA", ("2019-06-28",)),
            candidates=TICKER_CANDIDATE,
            proof=proof,
            class_evidence=complete_evidence(proof),
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
            work_item=work("AAA", ("2024-06-28",)),
            candidates=TICKER_CANDIDATE,
            proof=proof,
            class_evidence=complete_evidence(proof),
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
                work_item=work("AAA", ("2024-06-28",)),
                candidates=(DiscoveryCandidate(cik="0000000001", origin="GUESS"),),
            )

    def test_status_vocabulary_is_exactly_three(self):
        proof = proof_from(dual_class_facts(), cik="0000000001")
        seen = {
            build_symbol_proposal(
                work_item=work("AAA", ()), candidates=TICKER_CANDIDATE,
                proof=proof, class_evidence=complete_evidence(proof),
            ).proposal_status,
            build_symbol_proposal(
                work_item=work("AAA", ()), candidates=TICKER_CANDIDATE,
            ).proposal_status,
            build_symbol_proposal(
                work_item=work("AAA", ()), candidates=(),
            ).proposal_status,
        }
        self.assertEqual(seen, {AUTO_PROVABLE, REVIEW_REQUIRED, UNRESOLVED})


class DemandTest(unittest.TestCase):
    def row(self, identity, session, *, member=None, status="UNMAPPED"):
        member = member or identity
        return {
            "member_symbol": member,
            "identity_symbol": identity,
            "symbol_bridge_kind": DIRECT if member == identity else REUSED_VENDOR_SERIES,
            "formation_session": session,
            "status": status,
        }

    def payload(self, **overrides):
        base = {
            "stage": "5A-1",
            "measures": "STATIC_MAPPING_COVERAGE_DEMAND",
            "index_name": "SP500",
            "universe_source": "announcements",
            "universe_source_version": "eodhd-15y-2026-08",
            "calendar_source": "eodhd",
            "calendar_source_version": "eodhd-15y-2026-08",
            "identity_source_version": "qv-identity-sha256:abc",
            "reused_series_source": "trading/universe/reused-tickers.csv",
            "reused_series_source_version": "reused-tickers-sha256:abc",
            "securities": [
                self.row("AAA", "2024-06-28"),
                self.row("AAA", "2023-06-30"),
                self.row("BBB", "2024-06-28", status="MAPPED"),
                self.row("CCC", "2024-06-28", status="AMBIGUOUS_MAPPING"),
                self.row("FOXA", "2010-06-30", member="TFCFA"),
            ],
        }
        base.update(overrides)
        return base

    def test_only_unmapped_and_ambiguous_rows_are_demand(self):
        loaded = load_mapping_demand(self.payload())
        self.assertEqual(
            [item.key for item in loaded.work_items],
            [("AAA", "AAA"), ("CCC", "CCC"), ("TFCFA", "FOXA")],
        )
        self.assertEqual(
            loaded.demand[("AAA", "AAA")].formation_sessions,
            ("2023-06-30", "2024-06-28"),
        )

    def test_the_work_item_keeps_both_symbols(self):
        loaded = load_mapping_demand(self.payload())
        item = loaded.demand[("TFCFA", "FOXA")]
        self.assertEqual(item.member_symbol, "TFCFA")
        self.assertEqual(item.identity_symbol, "FOXA")
        self.assertEqual(item.symbol_bridge_kind, REUSED_VENDOR_SERIES)

    def test_a_pre_fix_payload_without_the_distinction_fails_closed(self):
        """`symbol` 하나만 들고 있던 5A-1 산출물은 더 이상 받지 않는다."""
        broken = self.payload(securities=[
            {"symbol": "AAA", "formation_session": "2024-06-28", "status": "UNMAPPED"},
        ])
        with self.assertRaises(QVProposalError) as caught:
            load_mapping_demand(broken)
        self.assertIn("member_symbol", str(caught.exception))

    def test_an_unknown_or_inconsistent_bridge_kind_fails_closed(self):
        unknown = self.payload(securities=[
            dict(self.row("AAA", "2024-06-28"), symbol_bridge_kind="GUESS"),
        ])
        with self.assertRaises(QVProposalError):
            load_mapping_demand(unknown)
        lying = self.payload(securities=[
            dict(self.row("FOXA", "2010-06-30", member="TFCFA"),
                 symbol_bridge_kind=DIRECT),
        ])
        with self.assertRaises(QVProposalError):
            load_mapping_demand(lying)

    def test_non_5a1_payload_fails_closed(self):
        with self.assertRaises(QVProposalError):
            load_mapping_demand(self.payload(stage="5A-3"))
        with self.assertRaises(QVProposalError):
            load_mapping_demand(self.payload(measures="PIT_IDENTITY_USABILITY"))

    def test_every_required_provenance_field_fails_closed(self):
        """빠진 source/version을 추측하거나 DB에서 캐다 채우지 않는다."""
        for field_name in (
            "index_name",
            "universe_source",
            "universe_source_version",
            "calendar_source",
            "calendar_source_version",
            "identity_source_version",
            "reused_series_source",
            "reused_series_source_version",
        ):
            for empty in (None, "", "   "):
                with self.subTest(field=field_name, empty=repr(empty)):
                    with self.assertRaises(QVProposalError):
                        load_mapping_demand(self.payload(**{field_name: empty}))
            with self.subTest(field=field_name, empty="absent"):
                broken = self.payload()
                del broken[field_name]
                with self.assertRaises(QVProposalError):
                    load_mapping_demand(broken)

    def test_full_provenance_is_carried_not_reduced_to_a_path(self):
        loaded = load_mapping_demand(self.payload(), inventory_path="runs/x/inventory.json")
        self.assertEqual(
            loaded.provenance_json(),
            {
                "stage_source": "5A-1",
                "measures": "STATIC_MAPPING_COVERAGE_DEMAND",
                "index_name": "SP500",
                "universe_source": "announcements",
                "universe_source_version": "eodhd-15y-2026-08",
                "calendar_source": "eodhd",
                "calendar_source_version": "eodhd-15y-2026-08",
                "identity_source_version": "qv-identity-sha256:abc",
                "reused_series_source": "trading/universe/reused-tickers.csv",
                "reused_series_source_version": "reused-tickers-sha256:abc",
                "inventory_path": "runs/x/inventory.json",
            },
        )

    def test_selecting_symbols_preserves_provenance(self):
        loaded = load_mapping_demand(self.payload(), inventory_path="runs/x/inventory.json")
        picked = loaded.select(["AAA"])
        self.assertEqual([item.key for item in picked.work_items], [("AAA", "AAA")])
        self.assertEqual(picked.provenance_json(), loaded.provenance_json())
        with self.assertRaises(QVProposalError):
            loaded.select(["NOPE"])

    def test_selection_reaches_a_work_item_by_either_symbol(self):
        loaded = load_mapping_demand(self.payload())
        for token in ("TFCFA", "FOXA", "TFCFA/FOXA"):
            with self.subTest(token=token):
                self.assertEqual(
                    [item.key for item in loaded.select([token]).work_items],
                    [("TFCFA", "FOXA")],
                )


def demand_for(symbols: dict, *, members: dict | None = None) -> DemandInput:
    """`{경제적 심볼: 세션들}`. `members`로 그 심볼의 데이터 계열을 따로 준다."""
    items = [
        work(identity, sessions, member=(members or {}).get(identity))
        for identity, sessions in symbols.items()
    ]
    return DemandInput(
        index_name="SP500",
        universe_source="announcements",
        universe_source_version="eodhd-15y-2026-08",
        calendar_source="eodhd",
        calendar_source_version="eodhd-15y-2026-08",
        identity_source_version="qv-identity-sha256:abc",
        reused_series_source="trading/universe/reused-tickers.csv",
        reused_series_source_version="reused-tickers-sha256:abc",
        demand={item.key: item for item in items},
        inventory_path="runs/x/inventory.json",
    )


def demand_from_items(*items: WorkItem) -> DemandInput:
    return DemandInput(
        index_name="SP500",
        universe_source="announcements",
        universe_source_version="eodhd-15y-2026-08",
        calendar_source="eodhd",
        calendar_source_version="eodhd-15y-2026-08",
        identity_source_version="qv-identity-sha256:abc",
        reused_series_source="trading/universe/reused-tickers.csv",
        reused_series_source_version="reused-tickers-sha256:abc",
        demand={item.key: item for item in items},
        inventory_path="runs/x/inventory.json",
    )


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
    def client_with_cover(self, facts=None):
        facts = dual_class_facts() if facts is None else facts
        return StubClient(
            rows_by_cik={
                "0000000001": [
                    StubRow("0000000001-24-000001", "10-K", "2024-02-20"),
                    StubRow("0000000001-25-000001", "10-K", "2025-02-20"),
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

    def test_later_filing_is_valid_static_evidence(self):
        """CLOSED Step 4 계약: 나중 문서가 더 오래된 상태를 증명할 수 있다.

        요구 formation보다 늦게 수리됐다는 이유로 문서를 버리지 않는다. 그 증거를
        과거에 쓸 수 있었는지는 5A-3의 `usable_from_session`이 가른다.
        """
        client = self.client_with_cover()
        proof, absence, tried = fetch_cover_proof(
            client, "0000000001", target_symbol="AAA"
        )
        self.assertIsNone(absence)
        self.assertEqual(proof.accession, "0000000001-25-000001")
        self.assertEqual(tried, ("0000000001-25-000001",))

    def test_no_periodic_filings_is_named(self):
        client = StubClient(rows_by_cik={"0000000001": []})
        proof, absence, tried = fetch_cover_proof(
            client, "0000000001", target_symbol="AAA"
        )
        self.assertIsNone(proof)
        self.assertEqual(absence, NO_PERIODIC_FILINGS)
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
        proof, absence, tried = fetch_cover_proof(
            client, "0000000001", target_symbol="AAA"
        )
        self.assertIsNone(proof)
        self.assertEqual(absence, NO_COVER_FACTS)
        self.assertEqual(tried, ("0000000001-10-000001",))


def single_class_facts(symbol: str, title: str | None = None) -> list[dict]:
    """단일 class 표지. 제목·심볼·주식수를 같은 class 축 context에 싣는다."""
    return [
        {"concept": "Security12bTitle", "value": title or f"{symbol} Common Stock",
         "member": "CommonStockMember", "context_id": "s"},
        {"concept": "TradingSymbol", "value": symbol,
         "member": "CommonStockMember", "context_id": "s"},
        {"concept": "EntityCommonStockSharesOutstanding", "value": "1000",
         "member": "CommonStockMember", "context_id": "s", "numeric": True},
    ]


class TargetAwareProofSearchTest(unittest.TestCase):
    """5A-2b 표지 증명 탐색은 **요구 심볼을 알고** 들어간다.

    target-blind 탐색은 같은 등록인의 티커 변경에서 체계적 위음성을 만든다 — 최신
    표지(새 심볼)에서 멈춘 뒤 대조에서 떨어지고, 옛 심볼을 명시로 증명하는 더 오래된
    표지는 읽히지도 않는다.
    """

    CIK = "0000000042"

    def history(self, pairs, *, cik=None):
        """`[(연도, 심볼 또는 None), ...]`을 filing 이력 stub으로 만든다.

        `None`이면 표지 fact가 없는 filing이다(2019 표지 XBRL 의무화 이전 모양).
        """
        cik = cik or self.CIK
        rows, files = [], {}
        for year, symbol in pairs:
            accession = f"{cik}-{str(year)[2:]}-000001"
            rows.append(StubRow(accession, "10-K", f"{year}-02-20"))
            if symbol is None:
                payload = cover_instance(
                    [{"concept": "EntityRegistrantName", "value": "Acme",
                      "context_id": "p"}],
                    default_cik=cik,
                )
            else:
                payload = cover_instance(single_class_facts(symbol), default_cik=cik)
            files[accession] = {"cover.xml": payload}
        return StubClient(rows_by_cik={cik: rows}, files_by_accession=files)

    # 2026/2025/2024 -> NEW, 2023 -> OLD. 같은 등록인 CIK 하나다.
    TICKER_CHANGE = ((2026, "NEW"), (2025, "NEW"), (2024, "NEW"), (2023, "OLD"))

    def test_a_same_cik_ticker_change_finds_the_older_matching_cover(self):
        client = self.history(self.TICKER_CHANGE)
        proof, absence, tried = fetch_cover_proof(
            client, self.CIK, target_symbol="OLD"
        )
        self.assertIsNone(absence)
        self.assertEqual(proof.accession, f"{self.CIK}-23-000001")
        # 새 심볼 표지 셋이 탐색을 멈추지 못했고, 시도 기록에 그대로 남는다.
        self.assertEqual(tried, tuple(
            f"{self.CIK}-{n}-000001" for n in ("26", "25", "24", "23")
        ))
        self.assertEqual([item.trading_symbol for item in proof.classes], ["OLD"])

    def test_the_new_symbol_still_selects_the_newest_matching_cover(self):
        client = self.history(self.TICKER_CHANGE)
        proof, absence, tried = fetch_cover_proof(
            client, self.CIK, target_symbol="NEW"
        )
        self.assertIsNone(absence)
        self.assertEqual(proof.accession, f"{self.CIK}-26-000001")
        self.assertEqual(tried, (f"{self.CIK}-26-000001",))   # 즉시 멈춘다

    def test_the_old_symbol_is_not_reported_missing_from_the_cover(self):
        """회귀의 핵심 — 옛 심볼이 `SYMBOL_NOT_ON_COVER_PAGE`를 받지 않는다."""
        client = self.history(self.TICKER_CHANGE)
        run = run_proposals(
            client,
            demand_from_items(WorkItem("OLD", "OLD", DIRECT, ("2013-06-28",))),
            companies={"OLD": StubCompany(self.CIK, "Acme Inc.")},
            overrides={},
        )
        packet = run.proposals[0]
        self.assertNotIn(SYMBOL_NOT_ON_COVER_PAGE, packet.reason_codes)
        self.assertNotIn(NO_COVER_PAGE_PROOF_DOCUMENT, packet.reason_codes)
        self.assertEqual(packet.proof.accession, f"{self.CIK}-23-000001")
        self.assertEqual(
            [item.symbol for item in packet.share_class_proposals], ["OLD"]
        )
        # 남는 것은 명시 증거가 필요한 관계들뿐이다 — 표지는 어느 구간도 증명하지
        # 않고, 제목 없는 sibling의 canonical bridge도 표지 밖에서 와야 한다.
        self.assertEqual(
            packet.reason_codes,
            (CANONICAL_CLASS_BRIDGE_NOT_EXPLICIT, CLASS_INTERVAL_NOT_EXPLICIT,
             PROSE_ALIAS_INTERVAL_NOT_EXPLICIT, XBRL_ALIAS_INTERVAL_NOT_EXPLICIT),
        )

    def test_the_match_is_found_beyond_the_old_three_attempt_limit(self):
        """옛 상한(3)을 되살리면 이 테스트가 깨진다.

        과거 티커가 "현재로부터 네 번째·스무 번째 제출"이라는 이유로 증명 불가가
        되면 안 된다.
        """
        beyond = tuple((2026 - n, "NEW") for n in range(8)) + ((2018, "OLD"),)
        client = self.history(beyond)
        proof, absence, tried = fetch_cover_proof(
            client, self.CIK, target_symbol="OLD"
        )
        self.assertIsNone(absence)
        self.assertEqual(proof.accession, f"{self.CIK}-18-000001")
        self.assertEqual(len(tried), 9)          # 아홉 번째에서 찾았다
        self.assertEqual(tried[-1], f"{self.CIK}-18-000001")

    def test_a_run_reaches_a_match_far_down_the_history(self):
        client = self.history(
            tuple((2026 - n, "NEW") for n in range(8)) + ((2018, "OLD"),)
        )
        run = run_proposals(
            client,
            demand_from_items(WorkItem("OLD", "OLD", DIRECT, ("2013-06-28",))),
            companies={"OLD": StubCompany(self.CIK, "Acme Inc.")},
            overrides={},
        )
        packet = run.proposals[0]
        self.assertEqual(packet.proof.accession, f"{self.CIK}-18-000001")
        self.assertEqual(len(run.attempted_accessions[0][2]), 9)

    def test_no_matching_cover_anywhere_returns_no_target_proof(self):
        """어느 표지도 요구 심볼을 싣지 않으면 무관한 표지를 증명으로 삼지 않는다."""
        client = self.history(((2026, "NEW"), (2025, "NEW"), (2024, "NEW")))
        proof, absence, tried = fetch_cover_proof(
            client, self.CIK, target_symbol="GONE"
        )
        self.assertIsNone(proof)
        self.assertEqual(absence, NO_TARGET_SYMBOL_COVER_PROOF)
        self.assertEqual(len(tried), 3)          # 무엇을 뒤졌는지 남는다

    def test_no_matching_cover_keeps_the_candidate_and_stays_review_required(self):
        client = self.history(((2026, "NEW"), (2025, "NEW"), (2024, "NEW")))
        run = run_proposals(
            client,
            demand_from_items(WorkItem("GONE", "GONE", DIRECT, ("2010-06-30",))),
            companies={"GONE": StubCompany(self.CIK, "Acme Inc.")},
            overrides={},
        )
        packet = run.proposals[0]
        self.assertIsNone(packet.proof)
        self.assertNotEqual(packet.proposal_status, AUTO_PROVABLE)
        self.assertEqual(packet.proposal_status, REVIEW_REQUIRED)   # UNRESOLVED가 아니다
        self.assertIn(NO_TARGET_SYMBOL_COVER_PROOF, packet.reason_codes)
        self.assertIn(NO_COVER_PAGE_PROOF_DOCUMENT, packet.reason_codes)
        self.assertIn(DISCOVERY_ONLY_NO_SEC_PROOF, packet.reason_codes)
        # 후보 CIK는 그대로 보인다.
        self.assertEqual(packet.selected_cik, self.CIK)
        self.assertEqual(
            [item.cik for item in packet.discovery_candidates], [self.CIK]
        )
        # 무관한 새 심볼의 class 제안을 만들지 않는다.
        self.assertEqual(packet.share_class_proposals, ())
        self.assertEqual(len(run.attempted_accessions[0][2]), 3)

    def test_covers_without_any_title_or_symbol_keep_the_pre_inline_signature(self):
        """표지 class fact는 있는데 제목·심볼 칸이 없는 모양은 따로 적는다."""
        shares_only = cover_instance(
            [{"concept": "EntityCommonStockSharesOutstanding", "value": "7",
              "member": "CommonStockMember", "context_id": "x", "numeric": True}],
            default_cik=self.CIK,
        )
        client = StubClient(
            rows_by_cik={self.CIK: [StubRow(f"{self.CIK}-19-000001", "10-Q", "2019-04-30")]},
            files_by_accession={f"{self.CIK}-19-000001": {"cover.xml": shares_only}},
        )
        proof, absence, tried = fetch_cover_proof(
            client, self.CIK, target_symbol="OLD"
        )
        self.assertIsNone(proof)
        self.assertEqual(absence, NO_EXPLICIT_COVER_SYMBOL_ANYWHERE)

        run = run_proposals(
            client,
            demand_from_items(WorkItem("OLD", "OLD", DIRECT, ("2010-06-30",))),
            companies={"OLD": StubCompany(self.CIK, "Acme Inc.")},
            overrides={},
        )
        packet = run.proposals[0]
        self.assertIn(PRE_INLINE_XBRL_NO_EXPLICIT_BRIDGE, packet.reason_codes)
        self.assertIn(NO_TARGET_SYMBOL_COVER_PROOF, packet.reason_codes)
        self.assertEqual(packet.proposal_status, REVIEW_REQUIRED)

    def test_filings_without_any_cover_facts_are_skipped_not_terminal(self):
        """표지 fact가 없는 filing은 탐색을 끝내지 않는다."""
        client = self.history(((2026, None), (2025, None), (2024, "OLD")))
        proof, absence, tried = fetch_cover_proof(
            client, self.CIK, target_symbol="OLD"
        )
        self.assertIsNone(absence)
        self.assertEqual(proof.accession, f"{self.CIK}-24-000001")
        self.assertEqual(len(tried), 3)

    def test_no_cover_facts_anywhere_is_still_named_separately(self):
        client = self.history(((2010, None), (2009, None)))
        proof, absence, tried = fetch_cover_proof(
            client, self.CIK, target_symbol="OLD"
        )
        self.assertIsNone(proof)
        self.assertEqual(absence, NO_COVER_FACTS)

    def test_the_search_and_the_adjudication_share_one_matcher(self):
        """탐색이 고른 표지는 대조가 인정하는 표지와 같은 함수로 정해진다."""
        proof = proof_from(single_class_facts("OLD"), cik=self.CIK)
        self.assertEqual(
            [item.trading_symbol for item in cover_classes_for_symbol(proof, "old")],
            ["OLD"],
        )
        self.assertEqual(cover_classes_for_symbol(proof, "OL"), ())      # 부분 일치 없음
        self.assertEqual(cover_classes_for_symbol(proof, "OLDX"), ())
        self.assertEqual(cover_classes_for_symbol(proof, " OLD "), tuple(proof.classes))

    def test_an_empty_target_symbol_fails_closed(self):
        client = self.history(self.TICKER_CHANGE)
        with self.assertRaises(QVProposalError):
            fetch_cover_proof(client, self.CIK, target_symbol="  ")

    def test_a_reused_series_work_item_searches_for_its_economic_symbol(self):
        """다리를 거친 항목도 그대로다 — 탐색 대상은 `identity_symbol`이다."""
        client = self.history(((2026, "NEW"), (2023, "FOXA")))
        run = run_proposals(
            client,
            demand_from_items(
                WorkItem("TFCFA", "FOXA", REUSED_VENDOR_SERIES, ("2010-06-30",))
            ),
            companies={"FOXA": StubCompany(self.CIK, "Acme Inc.")},
            overrides={},
        )
        packet = run.proposals[0]
        self.assertEqual(packet.proof.accession, f"{self.CIK}-23-000001")
        self.assertEqual(
            [item.symbol for item in packet.share_class_proposals], ["FOXA"]
        )


class LaterEvidenceTest(unittest.TestCase):
    """Finding 1 — static 증거와 PIT 가용성의 분리."""

    def run_with_later_filing(self):
        facts = dual_class_facts()
        client = StubClient(
            rows_by_cik={"0000000001": [StubRow("0000000001-25-000001", "10-K", "2025-02-20")]},
            files_by_accession={
                "0000000001-25-000001": {
                    "cover.xml": cover_instance(facts, default_cik="0000000001")
                }
            },
        )
        return run_proposals(
            client,
            demand_for({"AAA": ("2009-06-30",)}),
            companies={"AAA": StubCompany("0000000001", "Acme Inc.")},
            overrides={},
        )

    def test_later_filing_reaches_the_proposal_through_the_run_path(self):
        run = self.run_with_later_filing()
        packet = run.proposals[0]
        self.assertEqual(packet.proof.accession, "0000000001-25-000001")
        self.assertNotIn(NO_COVER_PAGE_PROOF_DOCUMENT, packet.reason_codes)
        self.assertEqual(len(packet.share_class_proposals), 2)

    def test_no_usable_from_session_is_invented_anywhere(self):
        payload = self.run_with_later_filing().as_json()
        # 제안 본문 어디에도 PIT 가용성 값이 없다. 설명 note만 그것이 5A-3의 일이라고 적는다.
        self.assertNotIn(
            "usable_from_session", json.dumps(payload["proposals"], ensure_ascii=False)
        )
        self.assertIn("usable_from_session is derived in 5A-3", payload["note"])

    def test_later_evidence_makes_no_claim_about_earlier_formations(self):
        run = self.run_with_later_filing()
        packet = run.proposals[0]
        # 요구 formation은 기록되지만 그 시점에 쓸 수 있었다는 주장은 어디에도 없다.
        self.assertEqual(packet.demanded_formation_sessions, ("2009-06-30",))
        self.assertEqual(
            [item.effective_from for item in packet.share_class_proposals], [None, None]
        )
        self.assertTrue(
            all(not item.interval_proved for item in packet.share_class_proposals)
        )
        self.assertIn(CLASS_INTERVAL_NOT_EXPLICIT, packet.reason_codes)
        self.assertEqual(packet.proposal_status, REVIEW_REQUIRED)


class FakeNameIndex:
    def __init__(self, mapping):
        self.mapping = mapping

    def candidates(self, name):
        return sorted(self.mapping.get(name, ()))


def historical_client(*, rows_by_cik, files_by_accession, submissions_extra, earnings, index):
    return StubClient(
        rows_by_cik=rows_by_cik,
        files_by_accession=files_by_accession,
        submissions_extra=submissions_extra,
        earnings_by_cik=earnings,
        name_index=index,
    )


def eight_k_rows(accession_prefix, dates):
    return [StubRow(f"{accession_prefix}-{n:06d}", "8-K", date)
            for n, date in enumerate(dates, start=1)]


HISTORICAL_HINTS = DiscoveryHints(
    source="announcements",
    source_version="eodhd-15y-2026-08",
    provenance="이름: sp500-changes.csv (security 칸) / 구간: universe_membership",
    names={"OLDCO": "Oldco Industries", "REORG": "Reorg Industries"},
    spans={"OLDCO": ("2008-01-02", "2012-06-30"), "REORG": ("2008-01-02", "2016-06-30")},
)


class HistoricalDiscoveryTest(unittest.TestCase):
    """Finding 2 — 3층 발견이 실제 실행 경로에서 닿는다."""

    def oldco_client(self, *, with_cover=True):
        cover = cover_instance(dual_class_facts(), default_cik="0000000055")
        rows = eight_k_rows("0000000055-10", ["2009-03-01", "2010-03-01"])
        if with_cover:
            rows = rows + [StubRow("0000000055-11-000001", "10-K", "2011-02-20")]
        return historical_client(
            rows_by_cik={"0000000055": rows},
            files_by_accession={"0000000055-11-000001": {"cover.xml": cover}},
            submissions_extra={
                "0000000055": {"name": "OLDCO INDUSTRIES INC", "sic": "3714"}
            },
            earnings={"0000000055": ["2009-03-01", "2010-03-01"]},
            index=FakeNameIndex({"Oldco Industries": ["0000000055"]}),
        )

    def test_historical_name_candidate_is_reachable_through_the_run_path(self):
        client = self.oldco_client()
        run = run_proposals(
            client,
            demand_for({"OLDCO": ("2010-06-30",)}),
            companies={},
            overrides={},
            hints=HISTORICAL_HINTS,
        )
        packet = run.proposals[0]
        origins = {item.origin for item in packet.discovery_candidates}
        self.assertIn(HISTORICAL_NAME_LOOKUP, origins)
        self.assertEqual(packet.selected_cik, "0000000055")
        self.assertEqual(run.origin_counts().get(HISTORICAL_NAME_LOOKUP), 1)

    def test_delisted_symbol_is_not_unresolved_just_because_the_ticker_file_lacks_it(self):
        client = self.oldco_client()
        run = run_proposals(
            client,
            demand_for({"OLDCO": ("2010-06-30",)}),
            companies={},
            overrides={},
            hints=HISTORICAL_HINTS,
        )
        packet = run.proposals[0]
        self.assertNotEqual(packet.proposal_status, UNRESOLVED)
        self.assertNotIn(NO_DISCOVERY_CANDIDATE, packet.reason_codes)

        without = run_proposals(
            self.oldco_client(), demand_for({"OLDCO": ("2010-06-30",)}),
            companies={}, overrides={},
        )
        self.assertEqual(without.proposals[0].proposal_status, UNRESOLVED)

    def test_a_historical_hint_alone_cannot_create_auto_provable(self):
        """증명이 있어도 구간 증거 없이는 승격되지 않고, 증명이 없으면 더더욱 아니다."""
        client = self.oldco_client(with_cover=False)
        run = run_proposals(
            client,
            demand_for({"OLDCO": ("2010-06-30",)}),
            companies={},
            overrides={},
            hints=HISTORICAL_HINTS,
        )
        packet = run.proposals[0]
        self.assertEqual(packet.proposal_status, REVIEW_REQUIRED)
        self.assertIn(DISCOVERY_ONLY_NO_SEC_PROOF, packet.reason_codes)
        self.assertEqual(packet.share_class_proposals, ())

    def test_third_layer_does_not_run_when_earlier_layers_already_answered(self):
        """`edgar.collect`와 같은 층 순서다. 항상 돌리면 건강한 종목까지 충돌한다."""
        client = self.oldco_client()
        run = run_proposals(
            client,
            demand_for({"OLDCO": ("2010-06-30",)}),
            companies={"OLDCO": StubCompany("0000000055", "Oldco Inc.")},
            overrides={},
            hints=HISTORICAL_HINTS,
        )
        origins = {item.origin for item in run.proposals[0].discovery_candidates}
        self.assertEqual(origins, {CURRENT_TICKER_FILE})

    def reorg_client(self):
        """후속은 2014부터만 제출하고 선행 등록인이 앞부분을 냈다."""
        return historical_client(
            rows_by_cik={
                "0000000077": eight_k_rows("0000000077-14", ["2014-03-01", "2015-03-01"]),
                "0000000066": eight_k_rows("0000000066-09", ["2009-03-01", "2010-03-01"]),
            },
            files_by_accession={},
            submissions_extra={
                "0000000077": {"name": "REORG HOLDINGS INC", "sic": "3714"},
                "0000000066": {"name": "REORG INDUSTRIES INC", "sic": "3714"},
            },
            earnings={
                "0000000077": ["2014-03-01", "2015-03-01"],
                "0000000066": ["2009-03-01", "2010-03-01"],
            },
            index=FakeNameIndex({"Reorg Industries": ["0000000066"]}),
        )

    def test_predecessor_hint_is_reachable_through_the_run_path(self):
        client = self.reorg_client()
        run = run_proposals(
            client,
            demand_for({"REORG": ("2010-06-30",)}),
            companies={"REORG": StubCompany("0000000077", "Reorg Holdings Inc.")},
            overrides={},
            hints=HISTORICAL_HINTS,
        )
        packet = run.proposals[0]
        origins = {item.origin for item in packet.discovery_candidates}
        self.assertIn(PREDECESSOR_HINT, origins)
        self.assertEqual(run.origin_counts().get(PREDECESSOR_HINT), 1)

    def test_historical_and_current_candidates_conflict_with_no_tie_break(self):
        """선행(과거)과 후속(현재)이 함께 나오면 기계가 고르지 않는다."""
        client = self.reorg_client()
        run = run_proposals(
            client,
            demand_for({"REORG": ("2010-06-30",)}),
            companies={"REORG": StubCompany("0000000077", "Reorg Holdings Inc.")},
            overrides={},
            hints=HISTORICAL_HINTS,
        )
        packet = run.proposals[0]
        self.assertEqual(packet.proposal_status, REVIEW_REQUIRED)
        self.assertIn(MULTIPLE_DISCOVERY_CANDIDATES, packet.reason_codes)
        self.assertIn(CIK_CONFLICT, packet.reason_codes)
        self.assertIsNone(packet.proof)
        self.assertEqual(client.fetched, [])  # 확정 전에는 증명을 시도하지 않는다

    def test_a_predecessor_hint_alone_cannot_create_auto_provable(self):
        client = self.reorg_client()
        run = run_proposals(
            client,
            demand_for({"REORG": ("2010-06-30",)}),
            companies={"REORG": StubCompany("0000000077", "Reorg Holdings Inc.")},
            overrides={},
            hints=HISTORICAL_HINTS,
        )
        packet = run.proposals[0]
        self.assertNotEqual(packet.proposal_status, AUTO_PROVABLE)
        self.assertIn(SUCCESSOR_JUDGEMENT_REQUIRED, packet.reason_codes)
        self.assertEqual(packet.share_class_proposals, ())

    def test_predecessor_is_skipped_when_the_successor_already_covers_the_span(self):
        client = historical_client(
            rows_by_cik={
                "0000000077": eight_k_rows("0000000077-07", ["2007-03-01", "2015-03-01"]),
            },
            files_by_accession={},
            submissions_extra={"0000000077": {"name": "REORG HOLDINGS INC", "sic": "3714"}},
            earnings={"0000000077": ["2007-03-01", "2015-03-01"]},
            index=FakeNameIndex({"Reorg Industries": ["0000000066"]}),
        )
        run = run_proposals(
            client,
            demand_for({"REORG": ("2010-06-30",)}),
            companies={"REORG": StubCompany("0000000077", "Reorg Holdings Inc.")},
            overrides={},
            hints=HISTORICAL_HINTS,
        )
        origins = {item.origin for item in run.proposals[0].discovery_candidates}
        self.assertEqual(origins, {CURRENT_TICKER_FILE})

    def test_name_index_is_built_at_most_once_per_run(self):
        client = self.oldco_client()
        run_proposals(
            client,
            demand_for({"OLDCO": ("2010-06-30",)}),
            companies={},
            overrides={},
            hints=HISTORICAL_HINTS,
        )
        self.assertEqual(client.cik_lookup_calls, 1)

    def test_hints_without_a_name_or_span_are_not_used(self):
        partial = DiscoveryHints(
            source="announcements",
            source_version="eodhd-15y-2026-08",
            provenance="부분",
            names={"OLDCO": "Oldco Industries"},
            spans={},
        )
        self.assertIsNone(partial.entry(work("OLDCO", ("2010-06-30",))))
        client = self.oldco_client()
        run = run_proposals(
            client,
            demand_for({"OLDCO": ("2010-06-30",)}),
            companies={},
            overrides={},
            hints=partial,
        )
        self.assertEqual(run.proposals[0].proposal_status, UNRESOLVED)
        self.assertEqual(client.cik_lookup_calls, 0)


class RelationIntervalCompletenessTest(unittest.TestCase):
    """`class 구간 != XBRL alias 구간 != prose alias 구간`.

    production manifest에 쓰일 관계는 **저마다 자기 유효구간을 증명해야** 한다.
    class가 X부터 존재한다는 것이 특정 QName이나 철자가 X부터 그 class를 가리켰다는
    증명이 아니다.
    """

    def packet(self, evidence, *, facts=None, symbol="AAA"):
        proof = proof_from(facts or dual_class_facts(), cik="0000000001")
        return proof, build_symbol_proposal(
            work_item=work(symbol, ("2024-06-28",)),
            candidates=TICKER_CANDIDATE,
            proof=proof,
            class_evidence=evidence(proof) if callable(evidence) else evidence,
        )

    def test_a_class_interval_alone_does_not_prove_the_xbrl_alias(self):
        def only_class(proof):
            return {
                item.member_key: ClassEvidence(
                    class_interval=span(),
                    cover_title_interval=span() if item.security_title else None,
                    extra_prose_bridges=complete_evidence(proof)[
                        item.member_key
                    ].extra_prose_bridges,
                )
                for item in proof.classes
            }

        _proof, packet = self.packet(only_class)
        self.assertEqual(packet.proposal_status, REVIEW_REQUIRED)
        self.assertIn(XBRL_ALIAS_INTERVAL_NOT_EXPLICIT, packet.reason_codes)
        self.assertNotIn(CLASS_INTERVAL_NOT_EXPLICIT, packet.reason_codes)
        for item in packet.xbrl_alias_proposals:
            self.assertFalse(item.interval_proved)
            self.assertIsNone(item.effective_from)

    def test_a_class_interval_alone_does_not_prove_the_prose_alias(self):
        def only_class_and_xbrl(proof):
            return {
                item.member_key: ClassEvidence(
                    class_interval=span(),
                    xbrl_interval=span(),
                    extra_prose_bridges=complete_evidence(proof)[
                        item.member_key
                    ].extra_prose_bridges,
                )
                for item in proof.classes
            }

        _proof, packet = self.packet(only_class_and_xbrl)
        self.assertEqual(packet.proposal_status, REVIEW_REQUIRED)
        self.assertIn(PROSE_ALIAS_INTERVAL_NOT_EXPLICIT, packet.reason_codes)
        self.assertNotIn(CLASS_INTERVAL_NOT_EXPLICIT, packet.reason_codes)
        self.assertNotIn(XBRL_ALIAS_INTERVAL_NOT_EXPLICIT, packet.reason_codes)

    def test_an_alias_interval_is_never_copied_from_the_class_interval(self):
        """class는 2016부터, alias는 2019부터. 그대로 따로 남는다."""
        proof = proof_from(dual_class_facts(), cik="0000000001")
        evidence = {}
        for item in proof.classes:
            evidence[item.member_key] = ClassEvidence(
                class_interval=span(start="2016-04-08"),
                xbrl_interval=span(start="2019-01-02"),
                cover_title_interval=(
                    span(start="2020-07-01") if item.security_title else None
                ),
                extra_prose_bridges=complete_evidence(proof)[
                    item.member_key
                ].extra_prose_bridges,
            )
        packet = build_symbol_proposal(
            work_item=work("AAA", ("2024-06-28",)),
            candidates=TICKER_CANDIDATE, proof=proof, class_evidence=evidence,
        )
        self.assertEqual(
            {item.effective_from for item in packet.share_class_proposals},
            {"2016-04-08"},
        )
        self.assertEqual(
            {item.effective_from for item in packet.xbrl_alias_proposals},
            {"2019-01-02"},
        )
        titles = [
            item for item in packet.prose_alias_proposals
            if item.bridge_type == SECURITY_TITLE_FACT
        ]
        self.assertEqual([item.effective_from for item in titles], ["2020-07-01"])

    def test_the_cover_filing_date_is_never_used_as_an_alias_lifetime(self):
        """표지 accession/수리 시각이 alias 수명으로 새어 들어가지 않는다."""
        proof = proof_from(dual_class_facts(), cik="0000000001")
        packet = build_symbol_proposal(
            work_item=work("AAA", ("2024-06-28",)),
            candidates=TICKER_CANDIDATE, proof=proof,
        )
        # 아무 구간도 주지 않았으면 아무 구간도 생기지 않는다.
        for group in (packet.share_class_proposals, packet.xbrl_alias_proposals,
                      packet.prose_alias_proposals):
            for item in group:
                self.assertFalse(item.interval_proved, item)
                self.assertIsNone(item.effective_from, item)
                self.assertIsNone(item.effective_to, item)
        payload = json.dumps(packet.as_json(), ensure_ascii=False)
        # 표지 accession의 연도(2024)가 구간 값으로 등장하지 않는다.
        self.assertNotIn('"effective_from": "2024', payload)

    def test_every_relation_interval_together_is_what_makes_auto_provable(self):
        _proof, packet = self.packet(complete_evidence)
        self.assertEqual(packet.proposal_status, AUTO_PROVABLE)
        self.assertEqual(packet.reason_codes, (MECHANICALLY_COMPLETE_SEC_PROOF,))


class CanonicalClassBridgeTest(unittest.TestCase):
    """모든 보통주 economic class에 canonical bridge가 하나는 있어야 한다.

    요구된 상장 심볼만이 아니라 **발행사 package의 sibling 전부**다.
    """

    def build(self, evidence, facts=None):
        proof = proof_from(facts or dual_class_facts(), cik="0000000001")
        return build_symbol_proposal(
            work_item=work("AAA", ("2024-06-28",)),
            candidates=TICKER_CANDIDATE, proof=proof,
            class_evidence=evidence(proof) if callable(evidence) else evidence,
        )

    def test_an_unlisted_shares_only_sibling_has_no_canonical_bridge(self):
        """Class B는 주식수 fact와 XBRL member뿐이다 — 그것은 정체성이 아니다."""
        packet = self.build(intervals_only)
        self.assertEqual(packet.proposal_status, REVIEW_REQUIRED)
        self.assertIn(CANONICAL_CLASS_BRIDGE_NOT_EXPLICIT, packet.reason_codes)
        # 구간은 전부 있는데도 막힌다.
        self.assertNotIn(CLASS_INTERVAL_NOT_EXPLICIT, packet.reason_codes)
        self.assertNotIn(XBRL_ALIAS_INTERVAL_NOT_EXPLICIT, packet.reason_codes)
        self.assertNotIn(PROSE_ALIAS_INTERVAL_NOT_EXPLICIT, packet.reason_codes)
        classb = [
            item for item in packet.share_class_proposals
            if item.class_id.endswith("CommonClassBMember")
        ]
        self.assertEqual(len(classb), 1)
        self.assertEqual(
            canonical_bridges_for(packet.prose_alias_proposals, classb[0].class_id), ()
        )

    def test_a_cover_group_label_alone_never_satisfies_canonical_identity(self):
        def label_only(proof):
            base = intervals_only(proof)
            out = {}
            for key, item in base.items():
                out[key] = ClassEvidence(
                    class_interval=item.class_interval,
                    xbrl_interval=item.xbrl_interval,
                    cover_title_interval=item.cover_title_interval,
                    extra_prose_bridges=(
                        ProseBridgeInput(
                            raw_prose_name="Class B Common Stock",
                            bridge_type=COVER_GROUP_LABEL,
                            interval=span(),
                        ),
                    ),
                )
            return out

        packet = self.build(label_only)
        self.assertEqual(packet.proposal_status, REVIEW_REQUIRED)
        self.assertIn(CANONICAL_CLASS_BRIDGE_NOT_EXPLICIT, packet.reason_codes)
        # 라벨은 사라지지 않고 corroborating으로 packet에 남는다.
        labels = [
            item for item in packet.prose_alias_proposals
            if item.bridge_type == COVER_GROUP_LABEL
        ]
        self.assertTrue(labels)
        self.assertFalse(any(item.is_canonical for item in labels))

    def test_a_security_title_fact_with_an_explicit_interval_satisfies_it(self):
        packet = self.build(intervals_only, facts=single_class_facts("AAA"))
        self.assertEqual(packet.proposal_status, AUTO_PROVABLE)
        bridges = canonical_bridges_for(
            packet.prose_alias_proposals, packet.share_class_proposals[0].class_id
        )
        self.assertEqual([item.bridge_type for item in bridges], [SECURITY_TITLE_FACT])

    def test_a_governing_instrument_with_an_explicit_interval_satisfies_it(self):
        packet = self.build(complete_evidence)
        self.assertEqual(packet.proposal_status, AUTO_PROVABLE)
        classb = [
            item for item in packet.share_class_proposals
            if item.class_id.endswith("CommonClassBMember")
        ][0]
        bridges = canonical_bridges_for(packet.prose_alias_proposals, classb.class_id)
        self.assertEqual([item.bridge_type for item in bridges], [GOVERNING_INSTRUMENT])

    def test_a_canonical_bridge_without_its_own_interval_does_not_count(self):
        """제목은 있는데 그 철자의 구간이 없으면 정체성을 세우지 못한다."""
        def title_without_interval(proof):
            return {
                item.member_key: ClassEvidence(
                    class_interval=span(), xbrl_interval=span(),
                )
                for item in proof.classes
            }

        packet = self.build(title_without_interval, facts=single_class_facts("AAA"))
        self.assertEqual(packet.proposal_status, REVIEW_REQUIRED)
        self.assertIn(CANONICAL_CLASS_BRIDGE_NOT_EXPLICIT, packet.reason_codes)
        self.assertIn(PROSE_ALIAS_INTERVAL_NOT_EXPLICIT, packet.reason_codes)

    def test_an_unknown_bridge_type_fails_closed(self):
        def bad(proof):
            return {
                item.member_key: ClassEvidence(
                    class_interval=span(),
                    extra_prose_bridges=(
                        ProseBridgeInput("X", "TICKER_SIMILARITY", span()),
                    ),
                )
                for item in proof.classes
            }

        with self.assertRaises(QVProposalError):
            self.build(bad)


class ReusedVendorSeriesTest(unittest.TestCase):
    """universe/bar 심볼 != SEC 경제적 심볼.

    `member_symbol=TFCFA` · `identity_symbol=FOXA` 작업 항목의 SEC 발견·증명은 전부
    `FOXA`로 간다. `TFCFA`를 과거 거래소 티커인 것처럼 SEC에서 찾지 않는다.
    """

    FOXA_ITEM = WorkItem("TFCFA", "FOXA", REUSED_VENDOR_SERIES, ("2010-06-30",))

    def fox_facts(self):
        return [
            {"concept": "Security12bTitle", "value": "Class A Common Stock",
             "member": "CommonClassAMember", "context_id": "a"},
            {"concept": "TradingSymbol", "value": "FOXA",
             "member": "CommonClassAMember", "context_id": "a"},
            {"concept": "EntityCommonStockSharesOutstanding", "value": "1000",
             "member": "CommonClassAMember", "context_id": "a", "numeric": True},
        ]

    def fox_client(self):
        return StubClient(
            rows_by_cik={
                "0000000021": [StubRow("0000000021-19-000001", "10-K", "2019-02-20")]
            },
            files_by_accession={
                "0000000021-19-000001": {
                    "cover.xml": cover_instance(self.fox_facts(), default_cik="0000000021")
                }
            },
            browse={"FOXA": "0000000021"},
        )

    def test_sec_discovery_queries_the_identity_symbol_never_the_vendor_series(self):
        client = self.fox_client()
        run = run_proposals(
            client,
            demand_from_items(self.FOXA_ITEM),
            companies={"FOXA": StubCompany("0000000021", "Twenty-First Century Fox")},
            overrides={},
            use_browse=True,
        )
        packet = run.proposals[0]
        self.assertEqual(packet.member_symbol, "TFCFA")
        self.assertEqual(packet.identity_symbol, "FOXA")
        self.assertEqual(packet.symbol_bridge_kind, REUSED_VENDOR_SERIES)
        self.assertEqual(packet.selected_cik, "0000000021")
        # 표지 대조가 경제적 심볼로 붙었다 — 벤더 코드였다면 SYMBOL_NOT_ON_COVER_PAGE다.
        self.assertNotIn(SYMBOL_NOT_ON_COVER_PAGE, packet.reason_codes)
        # 다만 발견이 현재 티커 계열뿐이라 기계적 완결은 아니다.
        self.assertIn(
            REUSED_SERIES_ONLY_CURRENT_TICKER_CANDIDATE, packet.reason_codes
        )
        self.assertEqual(
            [item.symbol for item in packet.share_class_proposals], ["FOXA"]
        )
        # SEC를 향한 어떤 칸에도 벤더 코드가 들어가지 않는다. 사람이 읽는 질문에는
        # 남아도 되고, 남아야 검토자가 어느 계열의 수요인지 안다.
        payload = packet.as_json()
        self.assertEqual(payload["member_symbol"], "TFCFA")
        sec_facing = json.dumps(
            {
                "discovery_candidates": payload["discovery_candidates"],
                "proof": payload["proof"],
                "issuer_proposal": payload["issuer_proposal"],
                "share_class_proposals": payload["share_class_proposals"],
                "xbrl_alias_proposals": payload["xbrl_alias_proposals"],
                "prose_alias_proposals": payload["prose_alias_proposals"],
            },
            ensure_ascii=False,
        )
        self.assertNotIn("TFCFA", sec_facing)

    def test_the_vendor_series_is_never_a_discovery_key(self):
        """`TFCFA`가 ticker map · override · browse 어디에도 던져지지 않는다."""
        seen: list[str] = []

        class WatchingClient(StubClient):
            def text(self, url):
                seen.append(url)
                return super().text(url)

        client = WatchingClient(
            rows_by_cik={},
            files_by_accession={},
            browse={"FOXA": "0000000021"},
        )
        run_proposals(
            client,
            demand_from_items(self.FOXA_ITEM),
            companies={"TFCFA": StubCompany("0000000099", "Wrong Series Inc.")},
            overrides={"TFCFA": "0000000098"},
            use_browse=True,
        )
        self.assertTrue(seen)
        for url in seen:
            self.assertNotIn("TFCFA", url)

    def test_a_vendor_series_lookalike_in_the_ticker_map_is_not_reachable(self):
        """벤더 코드가 우연히 현재 ticker 파일에 있어도 그것으로 풀리지 않는다."""
        client = self.fox_client()
        run = run_proposals(
            client,
            demand_from_items(self.FOXA_ITEM),
            companies={"TFCFA": StubCompany("0000000099", "Unrelated Inc.")},
            overrides={},
        )
        packet = run.proposals[0]
        self.assertEqual(packet.proposal_status, UNRESOLVED)
        self.assertIn(NO_DISCOVERY_CANDIDATE, packet.reason_codes)
        self.assertEqual(packet.discovery_candidates, ())

    def test_historical_name_lookup_keys_from_the_economic_symbol(self):
        """이름은 지수 공고의 `FOXA`로 찾고 구간은 데이터 계열 `TFCFA`로 찾는다."""
        cover = cover_instance(self.fox_facts(), default_cik="0000000021")
        client = historical_client(
            rows_by_cik={
                "0000000021": eight_k_rows("0000000021-10", ["2009-03-01"])
                + [StubRow("0000000021-19-000001", "10-K", "2019-02-20")]
            },
            files_by_accession={"0000000021-19-000001": {"cover.xml": cover}},
            submissions_extra={
                "0000000021": {"name": "21ST CENTURY FOX", "sic": "4841"}
            },
            earnings={"0000000021": ["2009-03-01"]},
            index=FakeNameIndex({"21st Century Fox": ["0000000021"]}),
        )
        hints = DiscoveryHints(
            source="announcements",
            source_version="eodhd-15y-2026-08",
            provenance="이름(identity_symbol 키) / 구간(member_symbol 키)",
            names={"FOXA": "21st Century Fox"},
            spans={"TFCFA": ("2008-01-02", "2019-03-20")},
        )
        # 두 칸의 키가 실제로 다르다.
        self.assertIsNotNone(hints.entry(self.FOXA_ITEM))
        self.assertEqual(hints.entry(self.FOXA_ITEM)[1], ("2008-01-02", "2019-03-20"))

        run = run_proposals(
            client, demand_from_items(self.FOXA_ITEM),
            companies={}, overrides={}, hints=hints,
        )
        packet = run.proposals[0]
        self.assertEqual(
            [item.origin for item in packet.discovery_candidates],
            [HISTORICAL_NAME_LOOKUP],
        )
        self.assertEqual(packet.selected_cik, "0000000021")

    def test_a_name_keyed_by_the_vendor_series_is_not_reachable(self):
        hints = DiscoveryHints(
            source="announcements", source_version="v1", provenance="p",
            names={"TFCFA": "Twenty-First Century Fox"},
            spans={"TFCFA": ("2008-01-02", "2019-03-20")},
        )
        self.assertIsNone(hints.entry(self.FOXA_ITEM))

    def test_a_span_keyed_by_the_economic_symbol_is_not_reachable(self):
        hints = DiscoveryHints(
            source="announcements", source_version="v1", provenance="p",
            names={"FOXA": "21st Century Fox"},
            spans={"FOXA": ("2019-03-20", "2026-06-30")},
        )
        self.assertIsNone(hints.entry(self.FOXA_ITEM))

    def test_two_reuse_episodes_do_not_collapse_into_one_work_item(self):
        """옛 FOXA(TFCFA 계열)와 새 FOXA는 서로 다른 발행사·서로 다른 packet이다."""
        old_cover = cover_instance(self.fox_facts(), default_cik="0000000021")
        new_cover = cover_instance(self.fox_facts(), default_cik="0000000031")
        client = StubClient(
            rows_by_cik={
                "0000000021": [StubRow("0000000021-19-000001", "10-K", "2019-02-20")],
                "0000000031": [StubRow("0000000031-24-000001", "10-K", "2024-08-20")],
            },
            files_by_accession={
                "0000000021-19-000001": {"cover.xml": old_cover},
                "0000000031-24-000001": {"cover.xml": new_cover},
            },
        )
        new_item = WorkItem("FOXA", "FOXA", DIRECT, ("2024-06-28",))
        run = run_proposals(
            client,
            demand_from_items(self.FOXA_ITEM, new_item),
            companies={"FOXA": StubCompany("0000000031", "Fox Corporation")},
            overrides={"TFCFA/FOXA": "unused"},
        )
        self.assertEqual(len(run.proposals), 2)
        by_member = {item.member_symbol: item for item in run.proposals}
        self.assertEqual(sorted(by_member), ["FOXA", "TFCFA"])
        self.assertEqual(by_member["FOXA"].selected_cik, "0000000031")
        # 옛 episode는 현재 ticker 주인의 CIK로 조용히 승격되지 않는다. 여기서는
        # 후보가 그 하나뿐이라 발견은 같은 CIK를 주지만 **작업 항목은 별도로 남는다.**
        self.assertEqual(
            by_member["TFCFA"].demanded_formation_sessions, ("2010-06-30",)
        )
        self.assertEqual(
            by_member["FOXA"].demanded_formation_sessions, ("2024-06-28",)
        )

    def test_a_current_ticker_only_reused_series_never_becomes_auto_provable(self):
        """옛 계열에 지금 주인의 표지가 붙어 기계적으로 완결되면 안 된다.

        구간 증거가 다 들어와도 발견이 현재 티커 계열뿐이면 `REVIEW_REQUIRED`다 —
        그 표지는 **다른 발행사의** 것일 수 있고 그 판정은 5A-2c의 사람 몫이다.
        """
        proof = proof_from(self.fox_facts(), cik="0000000031")
        packet = build_symbol_proposal(
            work_item=self.FOXA_ITEM,
            candidates=(
                DiscoveryCandidate(
                    cik="0000000031", origin=CURRENT_TICKER_FILE, detail="Fox Corporation"
                ),
            ),
            proof=proof,
            class_evidence=complete_evidence(proof),
        )
        self.assertEqual(packet.proposal_status, REVIEW_REQUIRED)
        self.assertIn(REUSED_SERIES_ONLY_CURRENT_TICKER_CANDIDATE, packet.reason_codes)

        # 같은 증거라도 DIRECT 항목이면 그대로 AUTO_PROVABLE이다 — 회귀가 아니다.
        direct = build_symbol_proposal(
            work_item=WorkItem("FOXA", "FOXA", DIRECT, ("2024-06-28",)),
            candidates=(
                DiscoveryCandidate(
                    cik="0000000031", origin=CURRENT_TICKER_FILE, detail="Fox Corporation"
                ),
            ),
            proof=proof,
            class_evidence=complete_evidence(proof),
        )
        self.assertEqual(direct.proposal_status, AUTO_PROVABLE)

    def test_a_historical_origin_clears_the_current_ticker_only_block(self):
        proof = proof_from(self.fox_facts(), cik="0000000021")
        packet = build_symbol_proposal(
            work_item=self.FOXA_ITEM,
            candidates=(
                DiscoveryCandidate(
                    cik="0000000021", origin=HISTORICAL_NAME_LOOKUP, detail="21st Century Fox"
                ),
            ),
            proof=proof,
            class_evidence=complete_evidence(proof),
        )
        self.assertNotIn(REUSED_SERIES_ONLY_CURRENT_TICKER_CANDIDATE, packet.reason_codes)
        self.assertEqual(packet.proposal_status, AUTO_PROVABLE)

    def test_a_reused_series_still_asks_the_historical_layer(self):
        """옛 episode가 지금 ticker 주인의 CIK를 조용히 받지 않는다.

        그 행이 벤더 계열로 다시 쓰인 이유가 바로 "그 구간의 그 티커는 지금 주인의 것이
        아니다"이므로, 1층이 답했다고 3층을 건너뛰면 옛 episode가 새 발행사로 붙는다.
        둘이 갈리면 `CIK_CONFLICT`이고 증명은 시도하지 않는다.
        """
        client = historical_client(
            rows_by_cik={
                "0000000021": eight_k_rows("0000000021-10", ["2009-03-01"]),
                "0000000031": [StubRow("0000000031-24-000001", "10-K", "2024-08-20")],
            },
            files_by_accession={},
            submissions_extra={
                "0000000021": {"name": "21ST CENTURY FOX", "sic": "4841"}
            },
            earnings={"0000000021": ["2009-03-01"]},
            index=FakeNameIndex({"21st Century Fox": ["0000000021"]}),
        )
        hints = DiscoveryHints(
            source="announcements", source_version="v1", provenance="p",
            names={"FOXA": "21st Century Fox"},
            spans={"TFCFA": ("2008-01-02", "2019-03-20")},
        )
        run = run_proposals(
            client, demand_from_items(self.FOXA_ITEM),
            companies={"FOXA": StubCompany("0000000031", "Fox Corporation")},
            overrides={}, hints=hints,
        )
        packet = run.proposals[0]
        self.assertEqual(
            sorted(item.origin for item in packet.discovery_candidates),
            [CURRENT_TICKER_FILE, HISTORICAL_NAME_LOOKUP],
        )
        self.assertIn(CIK_CONFLICT, packet.reason_codes)
        self.assertEqual(packet.proposal_status, REVIEW_REQUIRED)
        self.assertEqual(client.fetched, [])   # 확정 전에는 증명하지 않는다

    def test_a_direct_work_item_keeps_the_layer_order(self):
        """DIRECT 항목의 층 순서는 그대로다 — 3층을 항상 돌리지 않는다."""
        client = historical_client(
            rows_by_cik={"0000000031": [StubRow("0000000031-24-000001", "10-K", "2024-08-20")]},
            files_by_accession={
                "0000000031-24-000001": {
                    "cover.xml": cover_instance(self.fox_facts(), default_cik="0000000031")
                }
            },
            submissions_extra={},
            earnings={"0000000031": ["2024-08-20"]},
            index=FakeNameIndex({"Fox Corporation": ["0000000099"]}),
        )
        hints = DiscoveryHints(
            source="announcements", source_version="v1", provenance="p",
            names={"FOXA": "Fox Corporation"},
            spans={"FOXA": ("2019-03-20", "2026-06-30")},
        )
        run = run_proposals(
            client, demand_from_items(WorkItem("FOXA", "FOXA", DIRECT, ("2024-06-28",))),
            companies={"FOXA": StubCompany("0000000031", "Fox Corporation")},
            overrides={}, hints=hints,
        )
        packet = run.proposals[0]
        self.assertEqual(
            [item.origin for item in packet.discovery_candidates], [CURRENT_TICKER_FILE]
        )
        self.assertNotIn(CIK_CONFLICT, packet.reason_codes)

    def test_the_run_payload_carries_the_reused_mapping_provenance(self):
        client = StubClient(rows_by_cik={}, files_by_accession={})
        payload = run_proposals(
            client, demand_from_items(self.FOXA_ITEM), companies={}, overrides={}
        ).as_json()
        provenance = payload["demand_provenance"]
        self.assertEqual(
            provenance["reused_series_source"], "trading/universe/reused-tickers.csv"
        )
        self.assertEqual(
            provenance["reused_series_source_version"], "reused-tickers-sha256:abc"
        )
        # identity bundle과 다른 값이다 — 같은 자리에 두지 않는다.
        self.assertNotEqual(
            provenance["reused_series_source_version"],
            provenance["identity_source_version"],
        )
        self.assertEqual(
            payload["attempted_accessions"][0]["member_symbol"], "TFCFA"
        )
        self.assertEqual(
            payload["attempted_accessions"][0]["identity_symbol"], "FOXA"
        )

    def test_an_unknown_bridge_kind_fails_closed(self):
        with self.assertRaises(QVProposalError):
            build_symbol_proposal(
                work_item=WorkItem("TFCFA", "FOXA", "GUESS", ("2010-06-30",)),
                candidates=TICKER_CANDIDATE,
            )


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
        companies = {"AAA": StubCompany("0000000001", "Acme Inc.")}
        run = run_proposals(
            client,
            demand_for({"AAA": ("2024-06-28",), "ZZZ": ("2024-06-28",)}),
            companies=companies,
            overrides={},
        )
        payload = run.as_json()
        self.assertIs(payload["mutates_production_manifest"], False)
        self.assertEqual(payload["stage"], "5A-2")
        self.assertEqual(
            [item["identity_symbol"] for item in payload["proposals"]], ["AAA", "ZZZ"]
        )
        self.assertEqual(run.counts()[UNRESOLVED], 1)
        self.assertEqual(run.counts()[REVIEW_REQUIRED], 1)
        self.assertEqual(run.counts()[AUTO_PROVABLE], 0)
        self.assertIn(CLASS_INTERVAL_NOT_EXPLICIT, run.reason_counts())

    def test_run_output_reproduces_the_complete_5a1_provenance(self):
        client = StubClient(rows_by_cik={}, files_by_accession={})
        run = run_proposals(
            client, demand_for({"ZZZ": ("2024-06-28",)}), companies={}, overrides={}
        )
        payload = run.as_json()
        self.assertEqual(
            payload["demand_provenance"],
            {
                "stage_source": "5A-1",
                "measures": "STATIC_MAPPING_COVERAGE_DEMAND",
                "index_name": "SP500",
                "universe_source": "announcements",
                "universe_source_version": "eodhd-15y-2026-08",
                "calendar_source": "eodhd",
                "calendar_source_version": "eodhd-15y-2026-08",
                "identity_source_version": "qv-identity-sha256:abc",
                "reused_series_source": "trading/universe/reused-tickers.csv",
                "reused_series_source_version": "reused-tickers-sha256:abc",
                "inventory_path": "runs/x/inventory.json",
            },
        )
        self.assertEqual(payload["identity_source_version"], "qv-identity-sha256:abc")
        self.assertIsNone(payload["discovery_hints"])

    def test_ambiguous_candidates_skip_the_sec_fetch_entirely(self):
        client = StubClient(rows_by_cik={}, files_by_accession={})
        run = run_proposals(
            client,
            demand_for({"AAA": ("2024-06-28",)}),
            companies={"AAA": StubCompany("0000000001", "Acme Inc.")},
            overrides={"AAA": "0000000002"},
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
