"""5A-2 법적 증거 공급기 계약.

전부 network-free다. 작은 명시 SEC HTML fixture만 쓰고 실제 SEC 호출은 하지 않는다.
**production manifest(`trading/qv/identity/*.jsonl`)를 읽지도 쓰지도 않는다.**

두 CLOSED 결정이 이 파일의 핵심이다.

```text
B1  표지 Security12b/12gTitle = filing 관측
    != 자동으로 temporal production prose alias
B2  탄생 증거만으로는 effective_to = null이 되지 않는다
    탄생 + current 완전 governing snapshot + amendment 탐색 COMPLETE가 필요하다
```
"""

from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path

TRADING_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TRADING_ROOT))

from backtest import qv_evidence  # noqa: E402
from backtest.qv_identity_legal_evidence import (  # noqa: E402
    CLASS_BIRTH_ACTION,
    CLASS_BIRTH_EFFECTIVE_DATE,
    CLASS_TERMINATION_EFFECTIVE_DATE,
    COMPLETE,
    CURRENT_GOVERNING_SNAPSHOT,
    GOVERNING_CLASS_DEFINITION,
    INCOMPLETE,
    PROSE_ALIAS_LIFETIME,
    UNRESOLVED,
    class_evidence_from_legal_proof,
    classify_document,
    collect_legal_evidence,
)
from backtest.qv_identity_promotion import (  # noqa: E402
    QVPromotionError,
    revalidate_packet,
)
from backtest.qv_identity_proposals import (  # noqa: E402
    AUTO_PROVABLE,
    CANONICAL_CLASS_BRIDGE_NOT_EXPLICIT,
    CLASS_INTERVAL_NOT_EXPLICIT,
    CURRENT_TICKER_FILE,
    DIRECT,
    PROSE_ALIAS_INTERVAL_NOT_EXPLICIT,
    REVIEW_REQUIRED,
    SECURITY_TITLE_FACT,
    DiscoveryCandidate,
    WorkItem,
    build_symbol_proposal,
    extract_cover_proof,
)
from backtest.qv_xbrl import parse_instance  # noqa: E402

sys.path.insert(0, str(TRADING_ROOT / "tests"))
from test_qv_identity_promotion import ManifestFixture  # noqa: E402
from test_qv_identity_proposals import cover_instance  # noqa: E402

CIK = "0000000042"
CLASS_A = "Class A Common Stock"
CLASS_B = "Class B Common Stock"
# 법적 원문의 날짜 표기와 그 ISO 값. **문서에는 산문 날짜만 있다.**
BIRTH_PROSE = "October 2, 2015"
BIRTH_DATE = "2015-10-02"


# ── SEC HTML fixture ─────────────────────────────────────────────────────────


def html(*paragraphs: str) -> bytes:
    body = "".join(f"<p>{item}</p>" for item in paragraphs)
    return f"<html><body>{body}</body></html>".encode("utf-8")


def authorized(name: str) -> str:
    return (
        "The Corporation is authorized to issue 100,000,000 shares of "
        f"{name}, par value $0.001 per share."
    )


def effective(date: str) -> str:
    return f"This Certificate shall become effective on {date}."


def creates(name: str) -> str:
    """그 class를 **실제로 세우는** 명시 실행 행위."""
    return f"There is hereby created a new class of capital stock designated {name}."


def restated(*, names=(CLASS_A,), date=BIRTH_PROSE, extra=(), created=()) -> bytes:
    """완전한 current-in-effect governing instrument 하나.

    **기본값은 탄생을 증명하지 않는다.** 이 instrument가 그 class를 정의하고 스스로 D에
    발효한다는 것은 "그 class가 D에 만들어졌다"가 아니다 — class가 이 restatement보다
    수십 년 앞설 수 있다. 탄생을 증명하려면 `created=`로 명시 실행 행위를 넣는다.
    """
    body = ["AMENDED AND RESTATED CERTIFICATE OF INCORPORATION OF ACME INC."]
    body.extend(creates(name) for name in created)
    body.extend(authorized(name) for name in names)
    if date:
        body.append(effective(date))
    body.extend(extra)
    return html(*body)


def founding_charter(*, names=(CLASS_A,), date=BIRTH_PROSE, extra=()) -> bytes:
    """그 class를 세우는 행위와 발효일을 **둘 다** 든 완전 instrument."""
    return restated(names=names, date=date, extra=extra, created=names)


def amendment(*, paragraphs=(), date=None) -> bytes:
    """단순 amendment — **complete snapshot이 아니다.**"""
    body = ["CERTIFICATE OF AMENDMENT OF THE CERTIFICATE OF INCORPORATION"]
    body.extend(paragraphs)
    if date:
        body.append(effective(date))
    return html(*body)


# ── 표지 fixture ─────────────────────────────────────────────────────────────


def cover_facts(*, title=CLASS_A, symbol="AAA", sibling_title=None):
    facts = [
        {"concept": "Security12bTitle", "value": title,
         "member": "CommonClassAMember", "context_id": "a"},
        {"concept": "TradingSymbol", "value": symbol,
         "member": "CommonClassAMember", "context_id": "a"},
        {"concept": "EntityCommonStockSharesOutstanding", "value": "1000",
         "member": "CommonClassAMember", "context_id": "a", "numeric": True},
    ]
    return facts


def dual_cover_facts(*, title=CLASS_A, symbol="AAA"):
    """제목 있는 A + **제목 없는** 보통주 sibling B."""
    return cover_facts(title=title, symbol=symbol) + [
        {"concept": "EntityCommonStockSharesOutstanding", "value": "500",
         "member": "CommonClassBMember", "context_id": "b", "numeric": True},
    ]


def cover_proof(facts, *, cik=CIK, accession="0000000042-24-000001"):
    document = parse_instance(cover_instance(facts, default_cik=cik), "cover.xml")
    return extract_cover_proof(
        document, cik=cik, accession=accession, document_name="cover.xml"
    )


# ── SEC stub ─────────────────────────────────────────────────────────────────


class Filing:
    """submission row 하나와 그 accession이 **header 색인에 선언한** 문서들.

    `documents`는 순서가 있는 `이름 -> (선언된 종류, bytes | Exception)`이고 순서가
    곧 `<SEQUENCE>`다. `index.json`의 `type`은 아이콘 이름이라 종류가 아니다.
    """

    def __init__(self, accession, form, acceptance, documents, *,
                 items=None, primary_document=None):
        self.accession = accession
        self.form = form
        self.acceptance = acceptance
        self.documents = documents
        self.items = items
        self.primary_document = primary_document

    #: 2001년 이전 flat layout fixture가 채우는 complete submission 원문.
    legacy_text: str | None = None

    def header(self) -> str:
        """SEC `-index-headers.html`과 같은 모양의 SGML header 색인."""
        lines = [f"<TYPE>{self.form}"]
        for number in (self.items or "").split(","):
            if number.strip():
                lines.append(f"<ITEMS>{number.strip()}")
        blocks = []
        for sequence, (name, (document_type, _payload)) in enumerate(
            self.documents.items(), start=1
        ):
            blocks.append(
                f"<DOCUMENT>\n<TYPE>{document_type}\n<SEQUENCE>{sequence}\n"
                f"<FILENAME>{name}\n<DESCRIPTION>{document_type}\n<TEXT>\n</DOCUMENT>"
            )
        return (
            "<HTML><HEAD><!--\n<SEC-HEADER>\n" + "\n".join(lines)
            + "\n</SEC-HEADER>\n--></HEAD><BODY><PRE>"
            + "&lt;SEC-DOCUMENT&gt;\n"
            + "\n".join(blocks).replace("<", "&lt;").replace(">", "&gt;")
            + "</PRE></BODY></HTML>"
        )


class LegalStubClient:
    """SEC를 흉내내는 stub. 네트워크를 쓰지 않는다."""

    def __init__(self, filings, *, index_failures=(), submissions_error=None):
        self.filings = {item.accession: item for item in filings}
        self.index_failures = set(index_failures)
        self.submissions_error = submissions_error
        self.index_calls: list[str] = []
        self.document_calls: list[str] = []

    def submissions(self, cik):
        if self.submissions_error is not None:
            raise self.submissions_error
        rows = sorted(self.filings.values(), key=lambda item: item.accession)
        return {
            "filings": {
                "recent": {
                    "accessionNumber": [item.accession for item in rows],
                    "form": [item.form for item in rows],
                    "filingDate": [item.acceptance for item in rows],
                    "acceptanceDateTime": [
                        f"{item.acceptance}T21:00:00.000Z" for item in rows
                    ],
                    "reportDate": [item.acceptance for item in rows],
                    "primaryDocument": [item.primary_document for item in rows],
                    "items": [item.items for item in rows],
                },
                "files": [],
            }
        }

    def accession_header_index(self, cik, accession):
        self.index_calls.append(accession)
        if accession in self.index_failures:
            raise RuntimeError(f"index 503: {accession}")
        filing = self.filings[accession]
        if filing.legacy_text is not None:
            # 2001년 이전 accession에는 header 색인 파일이 없다(실측: HTTP 404).
            raise RuntimeError(f"HTTP 404: {accession}-index-headers.html")
        return filing.header()

    def complete_submission_text(self, cik, accession):
        """2001년 이전 flat layout 폴백. legacy fixture만 이 경로를 쓴다."""
        legacy = getattr(self.filings[accession], "legacy_text", None)
        if legacy is None:
            raise RuntimeError(f"complete submission 없음: {accession}")
        return legacy

    def accession_index(self, cik, accession):
        """표지 instance 탐색이 쓰는 경로. **문서 종류는 여기 없다**(아이콘 이름이다)."""
        filing = self.filings[accession]
        return {
            "directory": {
                "item": [
                    {"name": name, "type": "text.gif"}
                    for name in sorted(filing.documents)
                ]
            }
        }

    def accession_file_bytes(self, cik, accession, name):
        self.document_calls.append(f"{accession}/{name}")
        _document_type, payload = self.filings[accession].documents[name]
        if isinstance(payload, Exception):
            raise payload
        return payload


def collect(filings, facts=None, **kwargs):
    proof = cover_proof(facts or cover_facts())
    client = LegalStubClient(filings, **kwargs)
    return client, proof, collect_legal_evidence(client, cik=CIK, cover_proof=proof)


def charter_8k(accession, acceptance, payload, *, name="ex3-1.htm",
               document_type="EX-3.1"):
    """EX-3 exhibit으로 governing instrument를 낸 8-K. primary는 후보가 아니다."""
    return Filing(
        accession, "8-K", acceptance,
        {
            "form8k.htm": ("8-K", html("Item 9.01 Financial Statements and Exhibits.")),
            name: (document_type, payload),
        },
        primary_document="form8k.htm",
    )


def item_503_8k(accession, acceptance, payload):
    """구조화된 `ITEMS 5.03`으로만 식별되는 8-K primary 문서."""
    return Filing(
        accession, "8-K", acceptance, {"form8k.htm": ("8-K", payload)},
        items="5.03,9.01", primary_document="form8k.htm",
    )


def evidence_for(proof_json, member="us-gaap:CommonClassAMember"):
    return next(
        item for item in proof_json["classes"] if item["member_key"] == member
    )


class BaseFixture(unittest.TestCase):
    def assertClassEvidence(self, filings, facts=None, **kwargs):
        _client, proof, collected = collect(filings, facts, **kwargs)
        payload = collected.as_json()
        return payload, class_evidence_from_legal_proof(payload, cover_proof=proof)


# ══════════════════════════════════════════════════════════════════════════════
# 문서 분류
# ══════════════════════════════════════════════════════════════════════════════


class ClassificationTest(unittest.TestCase):
    def test_a_complete_restated_instrument_is_a_snapshot(self):
        self.assertEqual(
            classify_document(("AMENDED AND RESTATED CERTIFICATE OF INCORPORATION",)),
            "AMENDED_AND_RESTATED_CERTIFICATE",
        )

    def test_a_mere_amendment_is_never_a_snapshot(self):
        """`Certificate of Amendment of the Amended and Restated Certificate`."""
        self.assertEqual(
            classify_document((
                "CERTIFICATE OF AMENDMENT OF THE AMENDED AND RESTATED "
                "CERTIFICATE OF INCORPORATION OF ACME INC.",
            )),
            "CERTIFICATE_OF_AMENDMENT",
        )

    def test_bylaws_are_recognized_and_are_not_governing_for_a_class(self):
        self.assertEqual(
            classify_document(("AMENDED AND RESTATED BYLAWS OF ACME INC.",)), "BYLAWS"
        )

    def test_a_filename_never_makes_a_document_authoritative(self):
        """본문이 스스로 무엇인지 말해야 한다. `charter.htm`은 권위가 아니다."""
        filings = [charter_8k("0000000042-15-000001", "2015-10-05",
                              html("Some exhibit about employment agreements."),
                              name="charter.htm")]
        _payload, evidence = BaseFixture().assertClassEvidence(filings)
        self.assertEqual(evidence, {})


# ══════════════════════════════════════════════════════════════════════════════
# 후보 discovery — header 색인이 구조화된 metadata의 정본이다
# ══════════════════════════════════════════════════════════════════════════════


class CandidateDiscoveryTest(BaseFixture):
    def test_an_ex3_exhibit_is_discovered_and_the_rest_is_not_fetched(self):
        filing = Filing(
            "0000000042-15-000001", "8-K", "2015-10-05",
            {
                "form8k.htm": ("8-K", html("Item 9.01.")),
                "ex10-1.htm": ("EX-10.1", html("Employment agreement.")),
                "ex3-1.htm": ("EX-3.1", founding_charter()),
            },
        )
        client, _proof, collected = collect([filing])
        self.assertEqual(client.document_calls, ["0000000042-15-000001/ex3-1.htm"])
        self.assertEqual(
            [item.document_type for item in collected.documents], ["EX-3.1"]
        )
        self.assertEqual(
            [item.document_role for item in collected.documents], ["EXHIBIT"]
        )

    def test_an_item_503_primary_document_is_discovered_but_has_no_authority(self):
        """**Finding 3** — 서술은 발견되고 receipt에 남지만 증명 권한이 없다."""
        client, _proof, collected = collect(
            [item_503_8k("0000000042-15-000001", "2015-10-05", founding_charter())]
        )
        self.assertEqual(client.document_calls, ["0000000042-15-000001/form8k.htm"])
        self.assertEqual(
            [item.document_role for item in collected.documents], ["PRIMARY"]
        )
        self.assertEqual(
            [item.proof_authority for item in collected.documents], ["FILING_NARRATIVE"]
        )
        # 그 서술 본문이 완전 instrument처럼 읽혀도 finding을 만들지 않는다.
        self.assertEqual(collected.classes[0].findings, ())
        # Item 5.03인데 주소 지정 가능한 Exhibit 3이 없으므로 탐색은 닫히지 않는다.
        self.assertEqual(collected.search_status, INCOMPLETE)
        self.assertEqual(
            [item[0] for item in collected.failures],
            ["governing_exhibit_missing:0000000042-15-000001"],
        )

    def test_a_primary_narrative_never_creates_class_proof(self):
        """**Finding 3** — 서술이 첨부물 이름을 말한다고 governing instrument가 아니다.

        Item 5.03 primary가 `Certificate of Amendment`를 말하고 그 본문에 정의·탄생·
        종료 문장이 다 있어도, 실제 EX-3 문서가 없으면 어떤 finding도 나오지 않는다.
        """
        narrative = item_503_8k(
            "0000000042-15-000001", "2015-10-05",
            html(
                "On October 2, 2015 we filed a Certificate of Amendment to our "
                "certificate of incorporation.",
                creates(CLASS_A),
                authorized(CLASS_A),
                effective(BIRTH_PROSE),
            ),
        )
        _client, _proof, collected = collect([narrative])
        self.assertEqual(collected.classes[0].findings, ())
        self.assertIsNone(collected.classes[0].birth_date)
        self.assertIsNone(collected.classes[0].snapshot_accession)
        self.assertEqual(collected.search_status, INCOMPLETE)

    def test_a_primary_mentioning_bylaws_first_loses_no_narrative(self):
        """첫 일치 하나만 남기면 뒤의 서술이 조용히 사라진다.

        어느 쪽도 governing instrument 증명이 되지 않지만, 무엇을 봤는지는 receipt에
        전부 남아야 한다.
        """
        narrative = item_503_8k(
            "0000000042-15-000001", "2015-10-05",
            html(
                "We adopted Amended and Restated Bylaws.",
                "We also filed a Certificate of Amendment to the charter.",
                creates(CLASS_A),
                effective(BIRTH_PROSE),
            ),
        )
        _client, _proof, collected = collect([narrative])
        document = collected.documents[0]
        self.assertEqual(document.classification, "BYLAWS")
        self.assertEqual(
            document.classification_families, ("BYLAWS", "CERTIFICATE_OF_AMENDMENT")
        )
        self.assertEqual(document.proof_authority, "FILING_NARRATIVE")
        self.assertEqual(collected.classes[0].findings, ())

    def test_an_actual_ex3_certificate_of_amendment_remains_eligible(self):
        _client, _proof, collected = collect([
            charter_8k("0000000042-15-000001", "2015-10-05",
                       amendment(paragraphs=(creates(CLASS_A), authorized(CLASS_A)),
                                 date=BIRTH_PROSE)),
        ])
        document = collected.documents[0]
        self.assertEqual(document.proof_authority, "GOVERNING_EXHIBIT")
        self.assertEqual(document.classification, "CERTIFICATE_OF_AMENDMENT")
        self.assertEqual(collected.classes[0].birth_date, BIRTH_DATE)

    def test_an_actual_ex3_restated_certificate_remains_a_snapshot(self):
        _client, _proof, collected = collect(
            [charter_8k("0000000042-15-000001", "2015-10-05", founding_charter())]
        )
        document = collected.documents[0]
        self.assertEqual(document.proof_authority, "GOVERNING_EXHIBIT")
        self.assertEqual(document.classification, "AMENDED_AND_RESTATED_CERTIFICATE")
        self.assertEqual(collected.classes[0].snapshot_accession,
                         "0000000042-15-000001")
        self.assertTrue(collected.classes[0].open_ended)

    def test_an_item_503_with_an_exhibit_3_bylaws_document_still_closes(self):
        """Exhibit 3 문서가 있으면 그것이 bylaws여도 주소 지정은 된다."""
        filing = Filing(
            "0000000042-16-000001", "8-K", "2016-05-05",
            {
                "form8k.htm": ("8-K", html("Item 5.03 Amendments to Bylaws.")),
                "ex3-2.htm": ("EX-3.2", html("AMENDED AND RESTATED BYLAWS")),
            },
            items="5.03",
        )
        _client, _proof, collected = collect([
            charter_8k("0000000042-15-000001", "2015-10-05", founding_charter()),
            filing,
        ])
        self.assertEqual(collected.search_status, COMPLETE)
        self.assertEqual(collected.failures, ())

    def test_an_8k_without_item_503_contributes_no_primary_candidate(self):
        client, _proof, collected = collect([
            Filing("0000000042-15-000002", "8-K", "2015-11-05",
                   {"form8k.htm": ("8-K", html("Item 2.02 Results of Operations."))},
                   items="2.02"),
        ])
        self.assertEqual(client.document_calls, [])
        self.assertEqual(collected.documents, ())
        self.assertEqual(collected.search_status, COMPLETE)

    def test_sox_certification_exhibits_are_never_governing_candidates(self):
        """`EX-31.1`·`EX-32.1`은 Exhibit 3 계열이 아니다.

        문자열 prefix로 `EX-3`을 비교하면 SOX 인증서가 전부 끌려 들어와 governing
        후보가 되고, 분류에 실패해 멀쩡한 등록인이 통째로 INCOMPLETE가 된다.
        """
        filing = Filing(
            "0000000042-15-000001", "8-K", "2015-10-05",
            {
                "form8k.htm": ("8-K", html("Item 9.01.")),
                "ex31-1.htm": ("EX-31.1", html("Certification pursuant to Rule 13a-14.")),
                "ex32-1.htm": ("EX-32.1", html("Certification pursuant to 18 U.S.C. 1350.")),
                "ex3-1.htm": ("EX-3.1", founding_charter()),
            },
        )
        client, _proof, collected = collect([filing])
        self.assertEqual(client.document_calls, ["0000000042-15-000001/ex3-1.htm"])
        self.assertEqual(collected.search_status, COMPLETE)

    def test_a_legacy_flat_layout_accession_fails_closed(self):
        """2001년 이전 filing은 문서를 파일 이름으로 가리킬 수 없다.

        **후보가 0건이라는 뜻이 아니다.** 조용히 COMPLETE가 되면 그 시기의 governing
        instrument를 하나도 안 본 채 무기한 수명을 만들 수 있다.
        """
        legacy = Filing("0000000042-96-000002", "10-Q", "1996-02-06", {})
        legacy.legacy_text = (
            "<SEC-HEADER>\nCONFORMED SUBMISSION TYPE:\t10-Q\n"
            "<DOCUMENT>\n<TYPE>10-Q\n<SEQUENCE>1\n<TEXT>\nFORM 10-Q\n</DOCUMENT>\n"
            "<DOCUMENT>\n<TYPE>EX-3.1\n<SEQUENCE>2\n<TEXT>\ncharter\n</DOCUMENT>\n"
        )
        payload, evidence = self.assertClassEvidence([
            charter_8k("0000000042-15-000001", "2015-10-05", founding_charter()),
            legacy,
        ])
        self.assertEqual(payload["search_status"], INCOMPLETE)
        self.assertEqual(
            [item[0] for item in payload["failures"]],
            ["legacy_layout:0000000042-96-000002"],
        )
        self.assertEqual(evidence, {})

    def test_the_json_index_icon_type_is_never_used_as_a_document_type(self):
        """`index.json`의 `type`은 `text.gif` 같은 아이콘 이름이다.

        그것을 문서 종류로 쓰면 EX-3 exhibit이 **하나도** 발견되지 않는다.
        """
        from backtest.qv_identity_legal_evidence import parse_accession_header

        filing = Filing(
            "0000000042-15-000001", "8-K", "2015-10-05",
            {"form8k.htm": ("8-K", html("x")), "ex3-1.htm": ("EX-3.1", founding_charter())},
        )
        icons = {
            item["type"]
            for item in LegalStubClient([filing])
            .accession_index(CIK, "0000000042-15-000001")["directory"]["item"]
        }
        self.assertEqual(icons, {"text.gif"})
        _items, declared = parse_accession_header(filing.header())
        self.assertEqual(
            [(item.document_type, item.sequence) for item in declared],
            [("8-K", 1), ("EX-3.1", 2)],
        )


# ══════════════════════════════════════════════════════════════════════════════
# B1 — 표지 제목은 관측이지 production alias가 아니다
# ══════════════════════════════════════════════════════════════════════════════


def packet_from(evidence, proof, legal=None, symbol="AAA"):
    return build_symbol_proposal(
        work_item=WorkItem(symbol, symbol, DIRECT, ("2024-06-28",)),
        candidates=(DiscoveryCandidate(cik=CIK, origin=CURRENT_TICKER_FILE, detail="Acme"),),
        proof=proof,
        class_evidence=evidence or None,
        legal_evidence_proof=legal,
    )


class CoverTitlePolicyTest(BaseFixture):
    """**B1** — 표지 제목의 수명은 표지가 증명하지 않는다."""

    def test_a_cover_title_without_a_proved_interval_stays_an_observation(self):
        proof = cover_proof(cover_facts())
        packet = packet_from({}, proof)
        # 제목은 표지 증명에 그대로 남는다.
        self.assertEqual(
            [item.security_title for item in packet.proof.classes], [CLASS_A]
        )
        # production SECURITY_TITLE_FACT prose 제안은 만들어지지 않는다.
        self.assertEqual(packet.prose_alias_proposals, ())

    def test_a_non_proposed_cover_title_creates_no_missing_interval_reason(self):
        packet = packet_from({}, cover_proof(cover_facts()))
        self.assertNotIn(PROSE_ALIAS_INTERVAL_NOT_EXPLICIT, packet.reason_codes)

    def test_the_package_still_stays_review_required_without_a_canonical_bridge(self):
        packet = packet_from({}, cover_proof(cover_facts()))
        self.assertEqual(packet.proposal_status, REVIEW_REQUIRED)
        self.assertIn(CANONICAL_CLASS_BRIDGE_NOT_EXPLICIT, packet.reason_codes)
        self.assertIn(CLASS_INTERVAL_NOT_EXPLICIT, packet.reason_codes)


# ══════════════════════════════════════════════════════════════════════════════
# 탄생
# ══════════════════════════════════════════════════════════════════════════════


class BirthTest(BaseFixture):
    def test_a_restated_snapshot_effective_date_is_not_a_class_birth(self):
        """**Finding 1의 핵심.** class가 2020년 restatement보다 앞설 수 있다.

        ```text
        authorized to issue Class A Common Stock
        this Certificate becomes effective on 2020-01-01
        ```

        이것이 증명하는 것은 "그 snapshot에 Class A가 정의돼 있다"와 "그 snapshot이
        2020-01-01에 발효한다"이지 **"Class A가 2020-01-01에 만들어졌다"가 아니다.**
        """
        payload, evidence = self.assertClassEvidence(
            [charter_8k("0000000042-20-000001", "2020-01-05",
                        restated(date="January 1, 2020"))]
        )
        self.assertEqual(payload["search_status"], COMPLETE)
        entry = evidence_for(payload)
        # 정의는 있다.
        kinds = [item["finding_kind"] for item in entry["findings"]]
        self.assertIn(GOVERNING_CLASS_DEFINITION, kinds)
        # 탄생 행위와 탄생일은 없다.
        self.assertNotIn(CLASS_BIRTH_ACTION, kinds)
        self.assertNotIn(CLASS_BIRTH_EFFECTIVE_DATE, kinds)
        self.assertIsNone(entry["birth_date"])
        self.assertEqual(entry["status"], UNRESOLVED)
        self.assertEqual(evidence, {})

    def test_two_restated_snapshots_do_not_become_conflicting_birth_dates(self):
        """정의만 있는 두 restatement의 발효일은 탄생일 후보가 아니다.

        전에는 둘이 탄생일로 충돌해 UNRESOLVED가 됐고, 그 사유 문구가 사실과 달랐다.
        """
        payload, evidence = self.assertClassEvidence([
            charter_8k("0000000042-15-000001", "2015-10-05",
                       restated(date="October 2, 2015")),
            charter_8k("0000000042-20-000001", "2020-01-05",
                       restated(date="January 1, 2020")),
        ])
        entry = evidence_for(payload)
        self.assertEqual(
            [item["finding_kind"] for item in entry["findings"]],
            [GOVERNING_CLASS_DEFINITION, GOVERNING_CLASS_DEFINITION],
        )
        self.assertIsNone(entry["birth_date"])
        self.assertNotIn("탄생일이 서로 다른", entry["notes"][0])
        self.assertEqual(evidence, {})

    def test_an_explicit_creation_action_with_a_date_proves_birth(self):
        """명시 실행 생성 행위 + 거기 묶인 발효일이 있어야 탄생이다."""
        payload, evidence = self.assertClassEvidence(
            [charter_8k("0000000042-15-000001", "2015-10-05", founding_charter())]
        )
        entry = evidence_for(payload)
        kinds = [item["finding_kind"] for item in entry["findings"]]
        self.assertIn(CLASS_BIRTH_ACTION, kinds)
        self.assertIn(CLASS_BIRTH_EFFECTIVE_DATE, kinds)
        self.assertEqual(entry["birth_date"], BIRTH_DATE)
        self.assertEqual(
            evidence["us-gaap:CommonClassAMember"].class_interval.effective_from,
            BIRTH_DATE,
        )

    def test_an_explicit_reclassification_into_the_target_proves_birth(self):
        """`reclassified into <NAME>`도 그 class를 세우는 실행 행위다."""
        payload, _evidence = self.assertClassEvidence([
            charter_8k("0000000042-15-000001", "2015-10-05",
                       amendment(paragraphs=(
                           f"Each share of Common Stock was reclassified into one "
                           f"share of {CLASS_A}.",
                           authorized(CLASS_A),
                       ), date=BIRTH_PROSE)),
        ])
        entry = evidence_for(payload)
        self.assertEqual(entry["birth_date"], BIRTH_DATE)
        self.assertIn(
            "RECLASSIFIED_INTO",
            [item["semantic_family"] for item in entry["findings"]
             if item["finding_kind"] == CLASS_BIRTH_ACTION],
        )

    def test_a_definition_with_a_single_instrument_date_still_proves_no_birth(self):
        """발효일이 정확히 하나여도 탄생 행위가 없으면 탄생이 아니다."""
        payload, evidence = self.assertClassEvidence([
            charter_8k("0000000042-15-000001", "2015-10-05",
                       amendment(paragraphs=(authorized(CLASS_A),), date=BIRTH_PROSE)),
        ])
        entry = evidence_for(payload)
        self.assertEqual(
            [item["finding_kind"] for item in entry["findings"]],
            [GOVERNING_CLASS_DEFINITION],
        )
        self.assertIsNone(entry["birth_date"])
        self.assertEqual(evidence, {})

    def test_an_exact_definition_with_an_explicit_date_proves_birth(self):
        payload, evidence = self.assertClassEvidence(
            [charter_8k("0000000042-15-000001", "2015-10-05", founding_charter())]
        )
        self.assertEqual(payload["search_status"], COMPLETE)
        entry = evidence_for(payload)
        self.assertEqual(entry["status"], COMPLETE)
        self.assertEqual(entry["birth_date"], BIRTH_DATE)
        self.assertEqual(
            evidence["us-gaap:CommonClassAMember"].class_interval.effective_from,
            BIRTH_DATE,
        )

    def test_a_definition_without_an_explicit_operative_date_proves_no_birth(self):
        payload, evidence = self.assertClassEvidence(
            [charter_8k("0000000042-15-000001", "2015-10-05",
                        restated(date=None))]
        )
        self.assertEqual(payload["search_status"], COMPLETE)
        entry = evidence_for(payload)
        self.assertEqual(entry["status"], UNRESOLVED)
        self.assertIsNone(entry["birth_date"])
        self.assertEqual(evidence, {})

    def test_the_filing_acceptance_date_never_becomes_the_birth_date(self):
        payload, _evidence = self.assertClassEvidence(
            [charter_8k("0000000042-15-000001", "2015-10-05", restated(date=None))]
        )
        serialized = json.dumps(payload, ensure_ascii=False)
        self.assertNotIn("2015-10-05", [
            item.get("effective_date") for item in evidence_for(payload)["findings"]
        ])
        self.assertNotIn('"birth_date": "2015-10-05"', serialized)

    def test_the_first_observed_filing_never_becomes_the_birth_date(self):
        """가장 오래된 filing이 있다는 사실은 탄생 증거가 아니다."""
        payload, evidence = self.assertClassEvidence([
            Filing("0000000042-09-000001", "10-K", "2009-02-10", {}),
            charter_8k("0000000042-15-000001", "2015-10-05", restated(date=None)),
        ])
        self.assertEqual(evidence, {})
        self.assertIsNone(evidence_for(payload)["birth_date"])

    def test_an_xbrl_member_spelling_cannot_supply_the_class_name(self):
        """charter가 `CommonClassAMember`라는 철자를 말할 리 없다 — anchor는 표지 제목이다."""
        payload, evidence = self.assertClassEvidence(
            [charter_8k("0000000042-15-000001", "2015-10-05",
                        restated(names=("CommonClassAMember",)))]
        )
        self.assertEqual(evidence, {})
        self.assertEqual(evidence_for(payload)["findings"], [])

    def test_an_approximate_title_never_links_a_governing_class(self):
        """`Class A Common Stock, $0.001 par value` != `Class A Common Stock`."""
        facts = cover_facts(title="Class A Common Stock, $0.001 par value")
        payload, evidence = self.assertClassEvidence(
            [charter_8k("0000000042-15-000001", "2015-10-05", founding_charter())], facts
        )
        self.assertEqual(evidence, {})
        entry = evidence_for(payload)
        self.assertEqual(entry["findings"], [])
        self.assertEqual(entry["target_name_key"], "class a common stock, $0.001 par value")

    def test_conflicting_birth_dates_are_unresolved(self):
        payload, evidence = self.assertClassEvidence([
            charter_8k("0000000042-15-000001", "2015-10-05", founding_charter()),
            charter_8k("0000000042-19-000001", "2019-05-05",
                       founding_charter(date="April 1, 2019")),
        ])
        self.assertEqual(evidence, {})
        entry = evidence_for(payload)
        self.assertEqual(entry["status"], UNRESOLVED)
        self.assertIn("탄생일", entry["notes"][0])


# ══════════════════════════════════════════════════════════════════════════════
# B2 — open-ended 연속성
# ══════════════════════════════════════════════════════════════════════════════


class OpenEndedContinuityTest(BaseFixture):
    """**B2** — 종료를 못 찾았다는 것은 연속성의 증거가 아니다."""

    def test_birth_alone_never_produces_an_open_ended_lifetime(self):
        """탄생만 있고 complete snapshot이 없으면 `effective_to = null`이 없다."""
        payload, evidence = self.assertClassEvidence(
            [charter_8k("0000000042-15-000001", "2015-10-05",
                        amendment(paragraphs=(creates(CLASS_A), authorized(CLASS_A)),
                                  date=BIRTH_PROSE))]
        )
        entry = evidence_for(payload)
        self.assertEqual(entry["birth_date"], BIRTH_DATE)
        self.assertFalse(entry["open_ended"])
        self.assertEqual(entry["status"], UNRESOLVED)
        self.assertIn("snapshot", entry["notes"][0])
        self.assertEqual(evidence, {})

    def test_an_incomplete_amendment_search_never_produces_null(self):
        payload, evidence = self.assertClassEvidence(
            [
                charter_8k("0000000042-15-000001", "2015-10-05", founding_charter()),
                charter_8k("0000000042-20-000001", "2020-03-05", founding_charter()),
            ],
            index_failures=("0000000042-20-000001",),
        )
        self.assertEqual(payload["search_status"], INCOMPLETE)
        self.assertEqual(evidence_for(payload)["status"], INCOMPLETE)
        self.assertEqual(evidence, {})

    def test_birth_plus_current_snapshot_plus_complete_search_produces_null(self):
        payload, evidence = self.assertClassEvidence(
            [charter_8k("0000000042-15-000001", "2015-10-05", founding_charter())]
        )
        entry = evidence_for(payload)
        self.assertEqual(entry["status"], COMPLETE)
        self.assertTrue(entry["open_ended"])
        self.assertEqual(entry["snapshot_accession"], "0000000042-15-000001")
        interval = evidence["us-gaap:CommonClassAMember"].class_interval
        self.assertEqual(interval.effective_from, BIRTH_DATE)
        self.assertIsNone(interval.effective_to)
        self.assertIn(
            CURRENT_GOVERNING_SNAPSHOT,
            [item.evidence_role for item in interval.evidence],
        )

    def test_an_unresolved_intervening_governing_change_blocks_null(self):
        """탄생 뒤 governing amendment의 class 영향이 해소되지 않으면 막힌다.

        그 amendment는 나중 완전 snapshot **앞에** 있으므로 checkpoint 자체는 현재를
        닫는다 — 막는 것은 그 amendment의 class 영향이 해소되지 않았다는 사실이다.
        """
        payload, evidence = self.assertClassEvidence([
            charter_8k("0000000042-15-000001", "2015-10-05", founding_charter()),
            charter_8k("0000000042-18-000001", "2018-06-05",
                       amendment(paragraphs=(
                           "Article IV is hereby amended in its entirety.",
                       ))),
            charter_8k("0000000042-21-000001", "2021-03-05",
                       restated(date="March 1, 2021")),
        ])
        self.assertEqual(payload["search_status"], COMPLETE)
        entry = evidence_for(payload)
        self.assertEqual(entry["birth_date"], BIRTH_DATE)
        self.assertEqual(entry["status"], UNRESOLVED)
        self.assertIn("해소되지 않았다", entry["notes"][0])
        self.assertEqual(evidence, {})

    def test_an_amendment_after_the_latest_snapshot_blocks_null(self):
        """**Finding 2** — amendment는 complete snapshot이 아니다.

        2015 완전 snapshot 뒤에 2020 governing amendment가 있고 그 뒤에 완전 snapshot이
        없으면, 2015 snapshot은 현재 상태를 닫지 못한다.
        """
        payload, evidence = self.assertClassEvidence([
            charter_8k("0000000042-15-000001", "2015-10-05", founding_charter()),
            charter_8k("0000000042-20-000001", "2020-03-05",
                       amendment(paragraphs=(authorized(CLASS_A),),
                                 date="March 1, 2020")),
        ])
        self.assertEqual(payload["search_status"], COMPLETE)
        entry = evidence_for(payload)
        self.assertEqual(entry["birth_date"], BIRTH_DATE)
        self.assertFalse(entry["open_ended"])
        self.assertEqual(entry["status"], UNRESOLVED)
        self.assertIn("닫지 못한다", entry["notes"][0])
        self.assertEqual(evidence, {})

    def test_a_later_amendment_repeating_the_definition_does_not_make_it_current(self):
        """정의를 되풀이한다고 amendment가 complete snapshot으로 승격되지 않는다."""
        payload, evidence = self.assertClassEvidence([
            charter_8k("0000000042-15-000001", "2015-10-05", founding_charter()),
            charter_8k("0000000042-20-000001", "2020-03-05",
                       amendment(paragraphs=(
                           creates(CLASS_A), authorized(CLASS_A),
                       ))),
        ])
        entry = evidence_for(payload)
        self.assertEqual(entry["status"], UNRESOLVED)
        self.assertIn("닫지 못한다", entry["notes"][0])
        self.assertIsNone(entry["snapshot_accession"])
        self.assertEqual(evidence, {})

    def test_a_later_complete_snapshot_reopens_open_ended_continuity(self):
        """그 상태를 흡수한 완전 restated snapshot이 나오면 다시 열린다."""
        payload, evidence = self.assertClassEvidence([
            charter_8k("0000000042-15-000001", "2015-10-05", founding_charter()),
            charter_8k("0000000042-20-000001", "2020-03-05",
                       amendment(paragraphs=(authorized(CLASS_A),),
                                 date="March 1, 2020")),
            charter_8k("0000000042-21-000001", "2021-03-05",
                       restated(date="March 1, 2021")),
        ])
        entry = evidence_for(payload)
        self.assertEqual(entry["status"], COMPLETE)
        self.assertTrue(entry["open_ended"])
        self.assertEqual(entry["snapshot_accession"], "0000000042-21-000001")
        interval = evidence["us-gaap:CommonClassAMember"].class_interval
        self.assertEqual((interval.effective_from, interval.effective_to),
                         (BIRTH_DATE, None))

    def test_mentioning_another_class_is_not_negative_proof_for_the_target(self):
        """**대상 class 이름의 부재는 영향 없음의 증명이 아니다.**"""
        payload, evidence = self.assertClassEvidence([
            charter_8k("0000000042-15-000001", "2015-10-05", founding_charter()),
            charter_8k("0000000042-18-000001", "2018-06-05",
                       amendment(paragraphs=(
                           f"The number of authorized shares of {CLASS_B} is increased.",
                       ), date="June 1, 2018")),
        ])
        entry = evidence_for(payload)
        self.assertEqual(entry["status"], UNRESOLVED)
        self.assertIn("0000000042-18-000001", entry["notes"][0])
        self.assertEqual(evidence, {})

    def test_a_failing_accession_index_makes_closure_incomplete(self):
        payload, evidence = self.assertClassEvidence(
            [
                charter_8k("0000000042-15-000001", "2015-10-05", founding_charter()),
                Filing("0000000042-21-000001", "10-K", "2021-02-10", {}),
            ],
            index_failures=("0000000042-21-000001",),
        )
        self.assertEqual(payload["search_status"], INCOMPLETE)
        self.assertEqual(
            [item[0] for item in payload["failures"]],
            ["index:0000000042-21-000001"],
        )
        self.assertEqual(evidence, {})

    def test_a_failing_candidate_document_fetch_makes_closure_incomplete(self):
        broken = Filing(
            "0000000042-21-000001", "8-K", "2021-02-10",
            {"ex3-1.htm": ("EX-3.1", RuntimeError("HTTP 500"))},
            items="5.03", primary_document="form8k.htm",
        )
        payload, evidence = self.assertClassEvidence(
            [charter_8k("0000000042-15-000001", "2015-10-05", founding_charter()), broken]
        )
        self.assertEqual(payload["search_status"], INCOMPLETE)
        self.assertEqual(
            [item[0] for item in payload["failures"]],
            ["document:0000000042-21-000001/ex3-1.htm"],
        )
        self.assertEqual(evidence, {})

    def test_an_unclassifiable_governing_candidate_makes_closure_incomplete(self):
        payload, evidence = self.assertClassEvidence([
            charter_8k("0000000042-15-000001", "2015-10-05", founding_charter()),
            charter_8k("0000000042-21-000001", "2021-02-10",
                       html("Exhibit 3.1", "Nothing recognizable here.")),
        ])
        self.assertEqual(payload["search_status"], INCOMPLETE)
        self.assertTrue(payload["failures"][0][0].startswith("classify:"))
        self.assertEqual(evidence, {})

    def test_the_search_does_not_stop_after_an_arbitrary_number_of_filings(self):
        """옛 3건/5년 지평을 되살리면 이 테스트가 깨진다.

        관련 증거를 최신에서 스무 번째보다 더 뒤에 둔다.
        """
        noise = [
            Filing(f"0000000042-19-{100 + index:06d}", "10-Q",
                   f"2019-{index % 12 + 1:02d}-15", {})
            for index in range(24)
        ]
        payload, evidence = self.assertClassEvidence(
            [charter_8k("0000000042-15-000001", "2015-10-05", founding_charter())] + noise
        )
        self.assertGreater(len(payload["searched_accessions"]), 20)
        self.assertEqual(payload["search_status"], COMPLETE)
        self.assertEqual(
            evidence["us-gaap:CommonClassAMember"].class_interval.effective_from,
            BIRTH_DATE,
        )


# ══════════════════════════════════════════════════════════════════════════════
# 유한 구간 — 명시 실행 종료만
# ══════════════════════════════════════════════════════════════════════════════


TERMINATION = (
    f"Each issued and outstanding share of {CLASS_A} was reclassified into "
    "one share of Class C Common Stock."
)


class TerminationTest(BaseFixture):
    def test_an_implemented_termination_with_a_date_gives_a_finite_interval(self):
        payload, evidence = self.assertClassEvidence([
            charter_8k("0000000042-15-000001", "2015-10-05", founding_charter()),
            charter_8k("0000000042-20-000001", "2020-03-05",
                       amendment(paragraphs=(TERMINATION,), date="March 1, 2020")),
        ])
        entry = evidence_for(payload)
        self.assertEqual(entry["status"], COMPLETE)
        self.assertEqual(entry["birth_date"], BIRTH_DATE)
        self.assertEqual(entry["termination_date"], "2020-03-01")
        self.assertFalse(entry["open_ended"])
        interval = evidence["us-gaap:CommonClassAMember"].class_interval
        self.assertEqual(
            (interval.effective_from, interval.effective_to),
            (BIRTH_DATE, "2020-03-01"),
        )
        self.assertIn(
            CLASS_TERMINATION_EFFECTIVE_DATE,
            [item.evidence_role for item in interval.evidence],
        )

    def test_a_proposal_or_future_intent_is_never_a_termination(self):
        payload, evidence = self.assertClassEvidence([
            charter_8k("0000000042-15-000001", "2015-10-05", founding_charter()),
            charter_8k("0000000042-20-000001", "2020-03-05",
                       amendment(paragraphs=(
                           "The board has proposed that each share of "
                           f"{CLASS_A} be reclassified into Class C Common Stock, "
                           "subject to the approval of stockholders.",
                       ), date="March 1, 2020")),
        ])
        entry = evidence_for(payload)
        self.assertIsNone(entry["termination_date"])
        # 그 amendment는 여전히 해소되지 않은 governing 변경이라 null도 못 만든다.
        self.assertEqual(entry["status"], UNRESOLVED)
        self.assertEqual(evidence, {})

    def test_a_disappeared_ticker_is_never_a_termination(self):
        """ticker가 사라졌다는 사실은 문서에 없다 — 증거로 만들어내지 않는다."""
        payload, evidence = self.assertClassEvidence(
            [charter_8k("0000000042-15-000001", "2015-10-05", founding_charter())],
            cover_facts(symbol="GONE"),
        )
        entry = evidence_for(payload)
        self.assertIsNone(entry["termination_date"])
        self.assertTrue(entry["open_ended"])
        self.assertIsNone(
            evidence["us-gaap:CommonClassAMember"].class_interval.effective_to
        )

    def test_absence_from_a_later_cover_is_never_a_termination(self):
        """나중 표지에 그 class가 없다는 사실은 governing 종료 증거가 아니다."""
        payload, evidence = self.assertClassEvidence([
            charter_8k("0000000042-15-000001", "2015-10-05", founding_charter()),
            Filing("0000000042-24-000002", "10-K", "2024-02-10", {}),
        ])
        entry = evidence_for(payload)
        self.assertIsNone(entry["termination_date"])
        self.assertTrue(entry["open_ended"])
        self.assertIsNone(
            evidence["us-gaap:CommonClassAMember"].class_interval.effective_to
        )


# ══════════════════════════════════════════════════════════════════════════════
# prose alias 구간 — class 수명과 다른 사실이다
# ══════════════════════════════════════════════════════════════════════════════


class ProseIntervalTest(BaseFixture):
    def test_the_exact_legal_chain_independently_proves_the_title_interval(self):
        payload, evidence = self.assertClassEvidence(
            [charter_8k("0000000042-15-000001", "2015-10-05", founding_charter())]
        )
        title = evidence["us-gaap:CommonClassAMember"].cover_title_interval
        self.assertIsNotNone(title)
        self.assertEqual((title.effective_from, title.effective_to), (BIRTH_DATE, None))
        # 구간 증거는 그 이름을 정의한 문서들이다 — class 구간 증거의 복사가 아니다.
        self.assertEqual(
            sorted({item.evidence_role for item in title.evidence}),
            [PROSE_ALIAS_LIFETIME],
        )
        self.assertIn(payload["cik"], {item.cik for item in title.evidence})

    def test_a_different_n1_governing_name_never_inherits_the_cover_title(self):
        """charter가 `Class A Capital Stock`이면 표지의 `Class A Common Stock`이 아니다."""
        payload, evidence = self.assertClassEvidence(
            [charter_8k("0000000042-15-000001", "2015-10-05",
                        restated(names=("Class A Capital Stock",)))]
        )
        self.assertEqual(evidence, {})
        self.assertEqual(evidence_for(payload)["findings"], [])

    def test_the_class_interval_is_never_copied_into_the_prose_interval(self):
        """종료된 class는 class 구간만 갖고 title 구간은 갖지 않는다."""
        _payload, evidence = self.assertClassEvidence([
            charter_8k("0000000042-15-000001", "2015-10-05", founding_charter()),
            charter_8k("0000000042-20-000001", "2020-03-05",
                       amendment(paragraphs=(TERMINATION,), date="March 1, 2020")),
        ])
        item = evidence["us-gaap:CommonClassAMember"]
        self.assertEqual(item.class_interval.effective_to, "2020-03-01")
        self.assertIsNone(item.cover_title_interval)


# ══════════════════════════════════════════════════════════════════════════════
# sibling
# ══════════════════════════════════════════════════════════════════════════════


class SiblingTest(BaseFixture):
    def test_a_title_less_sibling_is_never_linked_by_xbrl_member_spelling(self):
        """charter가 `Class B Common Stock`을 정의해도 `CommonClassBMember`에 잇지 않는다."""
        payload, evidence = self.assertClassEvidence(
            [charter_8k("0000000042-15-000001", "2015-10-05",
                        founding_charter(names=(CLASS_A, CLASS_B)))],
            dual_cover_facts(),
        )
        self.assertEqual(sorted(evidence), ["us-gaap:CommonClassAMember"])
        self.assertEqual(
            [item["member_key"] for item in payload["classes"]],
            ["us-gaap:CommonClassAMember"],
        )

    def test_every_ordinary_sibling_still_needs_its_own_canonical_bridge(self):
        _client, proof, collected = collect(
            [charter_8k("0000000042-15-000001", "2015-10-05",
                        founding_charter(names=(CLASS_A, CLASS_B)))],
            dual_cover_facts(),
        )
        payload = collected.as_json()
        packet = packet_from(
            class_evidence_from_legal_proof(payload, cover_proof=proof), proof, payload
        )
        self.assertEqual(packet.proposal_status, REVIEW_REQUIRED)
        self.assertIn(CANONICAL_CLASS_BRIDGE_NOT_EXPLICIT, packet.reason_codes)
        self.assertIn(CLASS_INTERVAL_NOT_EXPLICIT, packet.reason_codes)


# ══════════════════════════════════════════════════════════════════════════════
# 탐색 receipt
# ══════════════════════════════════════════════════════════════════════════════


class SearchReceiptTest(BaseFixture):
    def test_complete_carries_a_deterministic_searched_receipt(self):
        payload, _evidence = self.assertClassEvidence([
            charter_8k("0000000042-15-000001", "2015-10-05", founding_charter()),
            Filing("0000000042-24-000002", "10-K", "2024-02-10", {}),
            Filing("0000000042-24-000003", "DEF 14A", "2024-04-10", {}),
        ])
        self.assertEqual(payload["search_status"], COMPLETE)
        self.assertEqual(
            payload["searched_accessions"],
            ["0000000042-15-000001", "0000000042-24-000002"],
        )
        # 지평 밖 form은 조용히 사라지지 않고 수량으로 남는다.
        self.assertEqual(payload["accessions_outside_horizon"], 1)
        self.assertEqual(payload["horizon_forms"],
                         ["10-K", "10-K/A", "10-Q", "10-Q/A", "8-K", "8-K/A"])
        document = payload["documents"][0]
        self.assertEqual(document["accession"], "0000000042-15-000001")
        self.assertEqual(document["document_name"], "ex3-1.htm")
        self.assertEqual(document["document_role"], "EXHIBIT")
        self.assertEqual(document["document_type"], "EX-3.1")
        self.assertEqual(document["form"], "8-K")
        self.assertEqual(len(document["document_sha256"]), 64)
        self.assertTrue(document["source_url"].endswith("/ex3-1.htm"))
        self.assertEqual(document["acceptance_datetime"], "2015-10-05T21:00:00.000000Z")

    def test_incomplete_lists_the_failed_required_source(self):
        payload, _evidence = self.assertClassEvidence(
            [charter_8k("0000000042-15-000001", "2015-10-05", founding_charter())],
            index_failures=("0000000042-15-000001",),
        )
        self.assertEqual(payload["search_status"], INCOMPLETE)
        self.assertEqual(len(payload["failures"]), 1)
        source, reason = payload["failures"][0]
        self.assertEqual(source, "index:0000000042-15-000001")
        self.assertIn("index 503", reason)

    def test_the_structured_proof_serializes_deterministically(self):
        filings = [
            charter_8k("0000000042-15-000001", "2015-10-05", founding_charter()),
            Filing("0000000042-24-000002", "10-K", "2024-02-10", {}),
        ]
        first = collect(filings)[2].as_json()
        second = collect(filings)[2].as_json()
        self.assertEqual(
            json.dumps(first, sort_keys=True, ensure_ascii=False),
            json.dumps(second, sort_keys=True, ensure_ascii=False),
        )
        # locator는 결정론적 source span이다.
        locators = [
            item["locator"] for item in evidence_for(first)["findings"]
        ]
        self.assertTrue(all(item.startswith("block:") for item in locators))

    def test_a_submissions_failure_fails_closed(self):
        payload, evidence = self.assertClassEvidence(
            [charter_8k("0000000042-15-000001", "2015-10-05", founding_charter())],
            submissions_error=RuntimeError("HTTP 503"),
        )
        self.assertEqual(payload["search_status"], INCOMPLETE)
        self.assertEqual(evidence_for(payload)["status"], INCOMPLETE)
        self.assertEqual(evidence, {})


# ══════════════════════════════════════════════════════════════════════════════
# 승격기 재검증 — packet을 고쳐도 구조화된 증명이 받쳐주지 않으면 실패한다
# ══════════════════════════════════════════════════════════════════════════════


CHARTER = charter_8k("0000000042-15-000001", "2015-10-05", founding_charter())


def legal_packet(filings=(CHARTER,), facts=None):
    """법적 증거 경로로만 만든 기계적 완결 packet."""
    _client, proof, collected = collect(list(filings), facts)
    payload = collected.as_json()
    evidence = class_evidence_from_legal_proof(payload, cover_proof=proof)
    return packet_from(evidence, proof, payload)


class TamperFixture:
    """무변조 packet을 만들어 한 곳만 고친 뒤 승격 재검증에 넣는다."""

    def tampered(self, mutate):
        payload = legal_packet().as_json()
        mutate(payload)
        with self.assertRaises(QVPromotionError) as caught:
            revalidate_packet(payload)
        return str(caught.exception)


class PromoterRevalidationTest(TamperFixture, unittest.TestCase):
    """승격기는 **`class_evidence_from_legal_proof`를 다시 돌린다.**

    `proposal_status` · `reason_codes` · `interval_proved`를 권한으로 삼지 않는다.
    """

    def test_the_untampered_legal_packet_revalidates(self):
        packet = legal_packet()
        self.assertEqual(packet.proposal_status, AUTO_PROVABLE)
        promotable = revalidate_packet(packet.as_json())
        self.assertEqual(len(promotable.classes), 1)
        self.assertEqual(promotable.classes[0]["effective_from"], BIRTH_DATE)
        self.assertIsNone(promotable.classes[0]["effective_to"])
        self.assertEqual(
            [item["bridge_type"] for item in promotable.prose_aliases],
            [SECURITY_TITLE_FACT],
        )

    def test_changing_class_effective_from_fails(self):
        def mutate(payload):
            for row in payload["share_class_proposals"]:
                row["interval"]["effective_from"] = "2010-01-01"
        self.assertIn("ClassEvidence", self.tampered(mutate))

    def test_a_null_effective_to_unsupported_by_the_proof_fails(self):
        """구조화된 증명이 유한 종료를 말하는데 packet이 null이면 어긋난다.

        **B2의 반대 방향이다** — 여기서는 증명이 종료를 말하는데 packet이 무기한을
        주장한다. 어느 쪽이든 packet의 칸이 아니라 증명이 정한다.
        """
        def mutate(payload):
            entry = payload["legal_evidence_proof"]["classes"][0]
            birth = next(
                item for item in entry["findings"]
                if item["finding_kind"] == CLASS_BIRTH_EFFECTIVE_DATE
            )
            entry["findings"].append({
                **birth,
                "finding_kind": CLASS_TERMINATION_EFFECTIVE_DATE,
                "semantic_family": "RECLASSIFIED",
                "effective_date": "2020-03-01",
            })
        message = self.tampered(mutate)
        self.assertIn("ClassEvidence", message)
        self.assertIn("2020-03-01", message)

    def test_changing_the_cover_title_interval_fails(self):
        """class 수명 **안쪽**으로 옮겨 기존 검사를 피해도 법적 증명이 잡는다."""
        def mutate(payload):
            for row in payload["prose_alias_proposals"]:
                row["interval"]["effective_from"] = "2018-01-01"
        self.assertIn("ClassEvidence", self.tampered(mutate))

    def test_adding_a_fabricated_prose_bridge_fails(self):
        """법적 증명이 만들지 않은 production prose 행을 얹으면 어긋난다."""
        def mutate(payload):
            row = dict(payload["prose_alias_proposals"][0])
            row["bridge_type"] = "GOVERNING_INSTRUMENT"
            row["raw_prose_name"] = "Class A Common Shares"
            row["prose_key"] = "class a common shares"
            row["provenance"] = "지어낸 bridge"
            payload["prose_alias_proposals"].append(row)
        self.assertIn("ClassEvidence", self.tampered(mutate))

    def test_marking_the_search_complete_over_an_embedded_failure_fails(self):
        """`search_status`를 COMPLETE로 고쳐도 실패가 박혀 있으면 구간이 안 나온다."""
        def mutate(payload):
            payload["legal_evidence_proof"]["failures"] = [
                ["index:0000000042-99-000001", "HTTP 503"]
            ]
            payload["legal_evidence_proof"]["search_status"] = COMPLETE
            for entry in payload["legal_evidence_proof"]["classes"]:
                entry["status"] = COMPLETE
        message = self.tampered(mutate)
        self.assertIn("ClassEvidence", message)

    def test_tampering_a_finding_effective_date_fails(self):
        def mutate(payload):
            for entry in payload["legal_evidence_proof"]["classes"]:
                for finding in entry["findings"]:
                    if finding["finding_kind"] == CLASS_BIRTH_EFFECTIVE_DATE:
                        finding["effective_date"] = "2001-01-01"
        self.assertIn("ClassEvidence", self.tampered(mutate))

    def test_removing_the_governing_definition_finding_fails(self):
        def mutate(payload):
            for entry in payload["legal_evidence_proof"]["classes"]:
                entry["findings"] = [
                    item for item in entry["findings"]
                    if item["finding_kind"] != GOVERNING_CLASS_DEFINITION
                ]
        self.assertIn("ClassEvidence", self.tampered(mutate))


class LegalEvidenceProvenanceTest(TamperFixture, unittest.TestCase):
    """**Finding 4** — 날짜가 같아도 증거 provenance가 다르면 승격이 실패한다.

    production 행은 나중에 packet의 구간 증거를 합쳐 넣고 5A-3가 그 REQUIRED 자연키에서
    `usable_from_session`을 파생시킨다. 경계만 대조하면 그 파생이 조용히 바뀐다.
    """

    def test_replacing_a_class_interval_evidence_ref_fails(self):
        def mutate(payload):
            for row in payload["share_class_proposals"]:
                row["interval"]["evidence"][0]["accession"] = "0000000042-99-000001"
        message = self.tampered(mutate)
        self.assertIn("ClassEvidence", message)
        self.assertIn("0000000042-99-000001", message)

    def test_replacing_a_prose_interval_evidence_ref_fails(self):
        def mutate(payload):
            for row in payload["prose_alias_proposals"]:
                row["interval"]["evidence"][0]["document_name"] = "other.htm"
        self.assertIn("ClassEvidence", self.tampered(mutate))

    def test_changing_only_an_evidence_locator_fails(self):
        """같은 문서라도 **어느 위치가 증명했는가**가 바뀌면 다른 증거다."""
        def mutate(payload):
            for row in payload["share_class_proposals"]:
                row["interval"]["evidence"][0]["locator"] = "block:999"
        self.assertIn("ClassEvidence", self.tampered(mutate))

    def test_changing_only_an_evidence_role_fails(self):
        def mutate(payload):
            for row in payload["share_class_proposals"]:
                row["interval"]["evidence"][0]["evidence_role"] = "SOMETHING_ELSE"
        self.assertIn("ClassEvidence", self.tampered(mutate))

    def test_dropping_a_required_legal_evidence_ref_fails(self):
        def mutate(payload):
            for row in payload["share_class_proposals"]:
                row["interval"]["evidence"] = row["interval"]["evidence"][:1]
        self.assertIn("ClassEvidence", self.tampered(mutate))

    def test_adding_an_unrelated_required_evidence_ref_fails(self):
        def mutate(payload):
            for row in payload["share_class_proposals"]:
                extra = dict(row["interval"]["evidence"][0])
                extra["accession"] = "0000000042-77-000001"
                extra["evidence_role"] = "GOVERNING_CLASS_DEFINITION"
                row["interval"]["evidence"].append(extra)
        self.assertIn("ClassEvidence", self.tampered(mutate))

    def test_reordering_evidence_alone_still_promotes(self):
        """순서만 정규화한다 — 순서 차이로 실패하지 않는다."""
        payload = legal_packet().as_json()
        for row in payload["share_class_proposals"]:
            row["interval"]["evidence"].reverse()
        promotable = revalidate_packet(payload)
        self.assertEqual(len(promotable.classes), 1)


class LegalProofIntegrityTest(TamperFixture, unittest.TestCase):
    """구조화된 proof가 **그 표지 증명에 속하는지**도 본다."""

    def test_a_legal_proof_cik_mismatch_fails(self):
        def mutate(payload):
            payload["legal_evidence_proof"]["cik"] = "0000000099"
        self.assertIn("CIK", self.tampered(mutate))

    def test_a_legal_proof_cover_accession_mismatch_fails(self):
        def mutate(payload):
            payload["legal_evidence_proof"]["cover_accession"] = "0000000042-11-000001"
        self.assertIn("cover accession", self.tampered(mutate))

    def test_a_legal_proof_cover_document_mismatch_fails(self):
        def mutate(payload):
            payload["legal_evidence_proof"]["cover_document_name"] = "other.xml"
        self.assertIn("cover 문서", self.tampered(mutate))

    def test_a_finding_referencing_an_unlisted_document_fails(self):
        def mutate(payload):
            for entry in payload["legal_evidence_proof"]["classes"]:
                for finding in entry["findings"]:
                    finding["document_name"] = "ghost.htm"
        self.assertIn("receipt에 없는 문서", self.tampered(mutate))


class LegalPromotionTest(ManifestFixture, unittest.TestCase):
    """기계적으로 완결된 법적 packet은 **임시 manifest에서** 실제로 승격된다."""

    def test_an_untampered_legal_packet_promotes(self):
        plan = self.plan([legal_packet()])
        self.assertEqual(plan.files_changed(),
                         ("issuers.jsonl", "share_classes.jsonl", "prose_aliases.jsonl"))
        rows = plan.rows.added["share_classes.jsonl"]
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["effective_from"], BIRTH_DATE)
        self.assertIsNone(rows[0]["effective_to"])
        alias = plan.rows.added["prose_aliases.jsonl"][0]
        self.assertEqual(alias["bridge_type"], SECURITY_TITLE_FACT)
        self.assertEqual(alias["raw_prose_name"], CLASS_A)
        # 법적 증거는 SEC_EVIDENCE_DOCUMENT 자연키로 남고 locator를 들고 있다.
        kinds = {item["source_kind"] for item in rows[0]["evidence"]}
        self.assertIn("SEC_EVIDENCE_DOCUMENT", kinds)
        locators = {
            item.get("locator") for item in rows[0]["evidence"]
            if item["source_kind"] == "SEC_EVIDENCE_DOCUMENT"
        }
        self.assertTrue(all(str(item).startswith("block:") for item in locators))
        roles = {item["evidence_role"] for item in rows[0]["evidence"]}
        self.assertEqual(
            roles & {GOVERNING_CLASS_DEFINITION, CLASS_BIRTH_EFFECTIVE_DATE,
                     CURRENT_GOVERNING_SNAPSHOT},
            {GOVERNING_CLASS_DEFINITION, CLASS_BIRTH_EFFECTIVE_DATE,
             CURRENT_GOVERNING_SNAPSHOT},
        )


# ══════════════════════════════════════════════════════════════════════════════
# 실행 통합 — `--legal-evidence`는 명시 opt-in이다
# ══════════════════════════════════════════════════════════════════════════════


class RunIntegrationTest(unittest.TestCase):
    """기본 경로는 더 싼 표지 전용 그대로다."""

    def cover_filing(self, facts=None, accession="0000000042-24-000001"):
        return Filing(
            accession, "10-K", "2024-02-10",
            {"cover.xml": (None, cover_instance(facts or cover_facts(), default_cik=CIK))},
            primary_document="cover.htm",
        )

    def proposal(self, filings, *, legal_evidence):
        from test_qv_identity_proposals import StubCompany, demand_from_items
        from backtest.qv_identity_proposals import run_proposals

        client = LegalStubClient(filings)
        run = run_proposals(
            client,
            demand_from_items(WorkItem("AAA", "AAA", DIRECT, ("2024-06-28",))),
            companies={"AAA": StubCompany(CIK, "Acme Inc.")},
            overrides={},
            legal_evidence=legal_evidence,
        )
        return client, run.proposals[0]

    def test_the_default_path_never_runs_the_legal_search(self):
        client, packet = self.proposal(
            [self.cover_filing(), CHARTER], legal_evidence=False
        )
        self.assertIsNone(packet.legal_evidence_proof)
        self.assertEqual(packet.proposal_status, REVIEW_REQUIRED)
        self.assertNotIn("0000000042-15-000001/ex3-1.htm", client.document_calls)

    def test_the_opt_in_path_supplies_class_evidence_from_legal_proof(self):
        client, packet = self.proposal(
            [self.cover_filing(), CHARTER], legal_evidence=True
        )
        self.assertEqual(packet.proposal_status, AUTO_PROVABLE)
        self.assertIsNotNone(packet.legal_evidence_proof)
        self.assertEqual(packet.legal_evidence_proof["search_status"], COMPLETE)
        self.assertIn("0000000042-15-000001/ex3-1.htm", client.document_calls)
        self.assertEqual(
            [item.effective_from for item in packet.share_class_proposals], [BIRTH_DATE]
        )
        # packet에 구조화된 원증거가 그대로 실린다.
        payload = packet.as_json()
        self.assertEqual(
            payload["legal_evidence_proof"], packet.legal_evidence_proof
        )
        self.assertTrue(payload["legal_evidence_proof"]["documents"])

    def test_no_explicit_cover_title_anchor_means_no_legal_search(self):
        """던질 대상 이름이 없으면 governing 탐색을 돌리지 않는다."""
        facts = [
            {"concept": "TradingSymbol", "value": "AAA",
             "member": "CommonClassAMember", "context_id": "a"},
            {"concept": "EntityCommonStockSharesOutstanding", "value": "1000",
             "member": "CommonClassAMember", "context_id": "a", "numeric": True},
        ]
        client, packet = self.proposal(
            [self.cover_filing(facts), CHARTER], legal_evidence=True
        )
        self.assertIsNone(packet.legal_evidence_proof)
        self.assertNotIn("0000000042-15-000001/ex3-1.htm", client.document_calls)


# ══════════════════════════════════════════════════════════════════════════════
# 증거 문서 원장 — K/Q PRIMARY만 막는다
# ══════════════════════════════════════════════════════════════════════════════


class EvidenceLedgerTest(unittest.TestCase):
    """governing instrument는 10-K accession 안의 **exhibit**일 수 있다."""

    def setUp(self):
        from backtest import store
        from tests.qv_step4_fixtures import (
            CALENDAR_SOURCE, CALENDAR_VERSION, seed_calendar,
        )

        self.connection = store.connect_memory()
        seed_calendar(self.connection)
        self.calendar = (CALENDAR_SOURCE, CALENDAR_VERSION)

    def register(self, *, form, role):
        return qv_evidence.register_evidence_document(
            self.connection, cik=CIK, accession="0000000042-21-000001",
            document_name="ex3-1.htm", form=form, document_role=role,
            acceptance_datetime="2021-02-10T21:00:00.000000Z",
            source_url="https://sec.gov/ex3-1.htm", document_bytes=b"charter",
            calendar_source=self.calendar[0], calendar_source_version=self.calendar[1],
            source="sec", source_version="shares-v1", provenance="fixture",
        )

    def test_a_kq_primary_document_is_still_rejected(self):
        with self.assertRaises(qv_evidence.QVEvidenceError) as caught:
            self.register(form="10-K", role="PRIMARY")
        self.assertIn("PRIMARY", str(caught.exception))

    def test_a_kq_exhibit_is_accepted(self):
        row = self.register(form="10-K", role="EXHIBIT")
        self.assertEqual(row["document_name"], "ex3-1.htm")
        self.assertGreater(
            row["historical_usable_session"], row["acceptance_eastern_date"]
        )


if __name__ == "__main__":
    unittest.main()
