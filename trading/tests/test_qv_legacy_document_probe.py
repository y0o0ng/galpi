"""공유 embedded `<DOCUMENT>` parser 계약. **전부 network-free다.**

parser는 production `backtest.qv_sec_embedded` **하나**다. audit probe는 그것을 그대로
import하고, 그래서 probe가 검증하는 문법과 5A-2 공급기가 쓰는 문법이 같다.
"""

from __future__ import annotations

import hashlib
import sys
import unittest
from pathlib import Path

TRADING_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TRADING_ROOT))

from backtest.qv_sec_embedded import (  # noqa: E402
    AMBIGUOUS_TEXT,
    DUPLICATE_KEY_DIFFERENT_BYTES,
    DUPLICATE_SEQUENCE,
    MISSING_DOCUMENT_CLOSE,
    MISSING_SEQUENCE,
    MISSING_TEXT_CLOSE,
    MISSING_TEXT_OPEN,
    MISSING_TYPE,
    NESTED_DOCUMENT,
    NON_NUMERIC_SEQUENCE,
    decompose,
    failure_reasons,
    sha256_bytes,
)


def document(type_=b"EX-3", sequence=b"2", body=b"charter text", filename=None,
            description=None, close=True, text_close=True, text_open=True):
    parts = [b"<DOCUMENT>", b"<TYPE>" + type_]
    if sequence is not None:
        parts.append(b"<SEQUENCE>" + sequence)
    if filename is not None:
        parts.append(b"<FILENAME>" + filename)
    if description is not None:
        parts.append(b"<DESCRIPTION>" + description)
    if text_open:
        parts.append(b"<TEXT>")
    parts.append(body)
    if text_close:
        parts.append(b"</TEXT>")
    if close:
        parts.append(b"</DOCUMENT>")
    return b"\n".join(parts)


def submission(*documents):
    head = b"-----BEGIN PRIVACY-ENHANCED MESSAGE-----\n<SEC-DOCUMENT>x.txt\n"
    return head + b"\n".join(documents) + b"\n"


class LegacyProbeParserTest(unittest.TestCase):
    def test_normal_filenameless_multi_document_submission(self):
        raw = submission(
            document(b"10-K", b"1", b"annual report body"),
            document(b"EX-3.1", b"2", b"certificate body"),
            document(b"EX-27", b"3", b"fds body"),
        )
        out = decompose(raw)
        self.assertTrue(out.structurally_deterministic)
        self.assertEqual([c.ordinal for c in out.children], [1, 2, 3])
        self.assertEqual([c.sequence for c in out.children], [1, 2, 3])
        self.assertEqual([c.document_type for c in out.children], ["10-K", "EX-3.1", "EX-27"])
        # flat layout의 핵심 — 파일 이름이 없다. 지어내지 않는다.
        self.assertEqual([c.filename for c in out.children], [None, None, None])

    def test_two_children_same_type_different_sequence_stay_distinct(self):
        raw = submission(
            document(b"EX-3", b"2", b"first charter"),
            document(b"EX-3", b"3", b"second charter"),
        )
        out = decompose(raw)
        self.assertTrue(out.structurally_deterministic)
        self.assertEqual([c.sequence for c in out.children], [2, 3])
        self.assertNotEqual(out.children[0].text_sha256, out.children[1].text_sha256)

    def test_missing_sequence_is_reported_not_replaced_by_ordinal(self):
        raw = submission(document(b"EX-3", None, b"charter"))
        out = decompose(raw)
        self.assertFalse(out.structurally_deterministic)
        self.assertIn(MISSING_SEQUENCE, out.children[0].failures)
        self.assertIsNone(out.children[0].sequence)   # ordinal로 대체하지 않는다

    def test_non_numeric_sequence_is_reported(self):
        raw = submission(document(b"EX-3", b"two", b"charter"))
        out = decompose(raw)
        self.assertIn(NON_NUMERIC_SEQUENCE, out.children[0].failures)
        self.assertIsNone(out.children[0].sequence)

    def test_duplicate_sequence_fails_closed_for_the_accession(self):
        raw = submission(
            document(b"EX-3", b"2", b"first"),
            document(b"EX-3", b"2", b"second"),
        )
        out = decompose(raw)
        self.assertFalse(out.structurally_deterministic)
        self.assertIn(DUPLICATE_SEQUENCE, out.failures)
        for child in out.children:
            self.assertIn(DUPLICATE_SEQUENCE, child.failures)

    def test_missing_document_close_is_reported(self):
        raw = submission(document(b"EX-3", b"2", b"charter", close=False))
        out = decompose(raw)
        self.assertFalse(out.structurally_deterministic)
        self.assertIn(MISSING_DOCUMENT_CLOSE, out.failures)

    def test_missing_text_close_is_reported(self):
        raw = submission(document(b"EX-3", b"2", b"charter", text_close=False))
        out = decompose(raw)
        self.assertFalse(out.structurally_deterministic)
        self.assertIn(MISSING_TEXT_CLOSE, out.children[0].failures)
        self.assertIsNone(out.children[0].text_sha256)

    def test_zero_and_negative_sequences_are_not_addresses(self):
        """`0`·`-1`은 등록인이 적은 주소가 아니다. 그대로 실패로 적는다."""
        for token in (b"0", b"-1"):
            with self.subTest(sequence=token):
                out = decompose(submission(document(b"EX-3", token, b"charter")))
                self.assertFalse(out.structurally_deterministic)

    def test_nested_documents_are_reported_not_flattened(self):
        raw = submission(
            b"\n".join([b"<DOCUMENT>", b"<TYPE>EX-3", b"<SEQUENCE>2", b"<TEXT>",
                         b"<DOCUMENT>", b"<TYPE>EX-3.1", b"<SEQUENCE>3", b"<TEXT>",
                         b"inner", b"</TEXT>", b"</DOCUMENT>"])
        )
        out = decompose(raw)
        self.assertFalse(out.structurally_deterministic)
        self.assertIn(NESTED_DOCUMENT, out.failures)

    def test_missing_text_open_is_reported(self):
        raw = submission(document(b"EX-3", b"2", b"charter", text_open=False))
        out = decompose(raw)
        self.assertFalse(out.structurally_deterministic)
        self.assertIn(MISSING_TEXT_OPEN, out.children[0].failures)

    def test_the_same_key_with_different_bytes_is_reported(self):
        """같은 SEQUENCE인데 내용이 다르면 그 주소가 무엇을 가리키는지 알 수 없다."""
        raw = submission(
            document(b"EX-3", b"2", b"first"),
            document(b"EX-3", b"2", b"second"),
        )
        out = decompose(raw)
        self.assertIn(DUPLICATE_KEY_DIFFERENT_BYTES, out.failures)

    def test_failure_reasons_name_the_child_without_inventing_a_name(self):
        """오류 표시는 `sequence=2`다 — 합성 document_name이 아니다."""
        raw = submission(document(b"EX-3", b"two", b"charter"))
        reasons = failure_reasons(decompose(raw))
        self.assertTrue(any(NON_NUMERIC_SEQUENCE in item for item in reasons))
        self.assertTrue(all("seq:" not in item for item in reasons))

    def test_the_audit_probe_uses_the_production_parser(self):
        """probe가 자기 문법을 복제하지 않는다 — 같은 함수여야 한다."""
        from selftest import qv_legacy_document_probe

        self.assertIs(qv_legacy_document_probe.decompose, decompose)

    def test_missing_type_is_reported(self):
        raw = b"\n".join([b"<DOCUMENT>", b"<SEQUENCE>2", b"<TEXT>", b"body",
                          b"</TEXT>", b"</DOCUMENT>"])
        out = decompose(raw)
        self.assertIn(MISSING_TYPE, out.children[0].failures)

    # ── 경계 정확성 — 본문이 태그처럼 생긴 문자열을 말할 때 ──────────────
    def test_taglike_literals_inside_body_do_not_break_boundaries(self):
        body = (b"the filing says <DOCUMENT> and </DOCUMENT> inline, "
                b"and mentions </TEXT> mid-line too")
        raw = submission(document(b"EX-3", b"2", body))
        out = decompose(raw)
        self.assertTrue(out.structurally_deterministic)
        self.assertEqual(len(out.children), 1)
        # 규약: payload는 `</TEXT>` 줄 시작 직전까지 — 마지막 개행을 포함한다.
        self.assertEqual(
            raw[out.children[0].text_start:out.children[0].text_end], body + b"\n")

    def test_a_taglike_text_open_inside_body_does_not_move_the_payload_start(self):
        """본문이 `<TEXT>`를 말해도 payload 시작은 진짜 `<TEXT>` 줄이다."""
        body = b"the exhibit references <TEXT> inline and keeps going"
        raw = submission(document(b"EX-3", b"2", body))
        out = decompose(raw)
        self.assertTrue(out.structurally_deterministic)
        child = out.children[0]
        self.assertEqual(raw[child.text_start:child.text_end], body + b"\n")

    def test_a_taglike_line_on_its_own_line_is_detected_not_silently_absorbed(self):
        """줄 머리에 진짜처럼 놓이면 구조가 모호해진다 — 조용히 삼키지 않는다."""
        body = b"intro\n</TEXT>\n<TEXT>\ntrailing"
        raw = submission(document(b"EX-3", b"2", body))
        out = decompose(raw)
        self.assertIn(AMBIGUOUS_TEXT, out.children[0].failures)

    # ── 원본 바이트 — 정규화하지 않는다 ─────────────────────────────────
    def test_hashes_are_over_raw_bytes_with_no_normalization(self):
        body = b"caf\xe9 &amp; co\r\n  trailing spaces   \r\n"
        raw = submission(document(b"EX-3", b"2", body))
        out = decompose(raw)
        child = out.children[0]
        extracted = raw[child.text_start:child.text_end]
        self.assertEqual(extracted, body + b"\n")
        self.assertEqual(child.text_sha256, sha256_bytes(body + b"\n"))
        # unescape/정규화한 것과 달라야 한다 — 변환이 없다는 증거다.
        self.assertNotEqual(child.text_sha256, sha256_bytes(b"caf\xe9 & co\n  trailing spaces\n"))
        self.assertEqual(out.parent_sha256, hashlib.sha256(raw).hexdigest())

    def test_offsets_re_derive_the_child_from_the_parent_original(self):
        raw = submission(
            document(b"10-K", b"1", b"annual"),
            document(b"EX-3.1", b"2", b"charter bytes here"),
        )
        out = decompose(raw)
        for child in out.children:
            self.assertEqual(
                sha256_bytes(raw[child.text_start:child.text_end]), child.text_sha256)
            self.assertTrue(child.document_start <= child.text_start)
            self.assertTrue(child.text_end <= child.document_end)

    def test_decomposition_is_deterministic_across_repeated_parses(self):
        raw = submission(document(b"EX-3", b"2", b"charter"), document(b"EX-27", b"3", b"fds"))
        first, second = decompose(raw), decompose(raw)
        self.assertEqual(first.parent_sha256, second.parent_sha256)
        self.assertEqual([c.__dict__ for c in first.children],
                         [c.__dict__ for c in second.children])

    # ── 권한은 기존 규칙이 정한다 — probe가 넓히지 않는다 ────────────────
    def test_extracted_type_feeds_the_existing_authority_rule_unchanged(self):
        from backtest.qv_identity_legal_evidence import (
            FILING_NARRATIVE, GOVERNING_EXHIBIT, document_proof_authority)

        raw = submission(
            document(b"10-K", b"1", b"annual"),
            document(b"EX-3.1", b"2", b"charter"),
            document(b"EX-27", b"3", b"fds"),
            document(b"EX-3", b"4", b"bare exhibit three"),
        )
        out = decompose(raw)
        got = [document_proof_authority(c.document_type) for c in out.children]
        self.assertEqual(got, [FILING_NARRATIVE, GOVERNING_EXHIBIT,
                               FILING_NARRATIVE, GOVERNING_EXHIBIT])

    def test_the_exhibit_three_rule_is_not_loosened_by_the_probe(self):
        """`EX-30`·`EX-31`은 Exhibit 3이 아니다 — probe가 그 경계를 넓히지 않는다."""
        from backtest.qv_identity_legal_evidence import (
            FILING_NARRATIVE, GOVERNING_EXHIBIT, document_proof_authority)

        raw = submission(
            document(b"EX-3.(I)", b"1", b"charter one"),
            document(b"EX-03", b"2", b"zero padded"),
            document(b"EX-31", b"3", b"certification"),
            document(b"EX-32.1", b"4", b"certification"),
        )
        out = decompose(raw)
        self.assertTrue(out.structurally_deterministic)
        self.assertEqual(
            [document_proof_authority(c.document_type) for c in out.children],
            [GOVERNING_EXHIBIT, GOVERNING_EXHIBIT, FILING_NARRATIVE, FILING_NARRATIVE])

    def test_authority_is_never_inferred_from_sequence_or_ordinal(self):
        from backtest.qv_identity_legal_evidence import (
            FILING_NARRATIVE, document_proof_authority)

        raw = submission(document(b"10-K", b"2", b"annual at sequence two"))
        out = decompose(raw)
        # sequence 2가 EX-3 자리라는 관습이 있어도 권한은 TYPE만 정한다.
        self.assertEqual(document_proof_authority(out.children[0].document_type),
                         FILING_NARRATIVE)
        self.assertEqual(document_proof_authority(out.children[0].sequence),
                         FILING_NARRATIVE)


if __name__ == "__main__":
    unittest.main()
