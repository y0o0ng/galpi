"""SEC complete submission 원본 바이트 -> `<DOCUMENT>` 자식 분해. **I/O를 하지 않는다.**

2001년 이전 flat-layout accession은 문서를 개별 파일로 두지 않고 complete submission
안에 `<FILENAME>` 없이 담는다. 그 문서를 가리키는 production 자연키는

```text
(CIK, accession, SEQUENCE)
```

이고, `SEQUENCE`는 등록인이 SGML header에 **명시로 적은 값**이다. ordinal · TYPE+순번 ·
합성 파일명은 자연키가 아니다 — 없거나 겹치면 그 accession을 주소 지정 불가로 적는다.

**원본 바이트만 본다.** HTML unescape · 개행 정규화 · Unicode 정규화 · trim을 경계
계산이나 해시 **앞에** 하지 않는다. production `parse_accession_header()`는
`html.unescape()`를 하지만 그것은 filename 있는 문서를 세는 다른 목적이고, 여기서 그
변환을 흉내내면 byte offset과 SHA가 원본과 어긋난다.

**태그는 줄 머리에서만 인정한다.** SEC dissemination SGML은 `<DOCUMENT>` ·
`</DOCUMENT>` · `<TEXT>` · `</TEXT>`를 각자 줄 머리에 둔다. 본문 한가운데의
`<DOCUMENT>` 같은 문자열은 경계가 아니다 — 그것을 경계로 읽으면 본문이 태그를 말할
때마다 구조가 깨진다. 이 가정은 fixture로 검사한다.

**손상된 것은 고치지 않는다.** 휴리스틱 복구가 없고, 연도 cutoff를 규칙으로 쓰지
않으며, `SEQUENCE`가 없거나 겹치면 ordinal로 대체하지 **않는다**.

`ordinal` · byte offset · parent SHA는 audit provenance다. **production 증거 정체성에
넣지 않는다** — 정체성은 `(CIK, accession, SEQUENCE)`이고 내용 검사는 자식 TEXT
payload의 SHA-256이다.
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass, field

# ── 실패 코드 — 고치지 않고 그대로 적는다. 하나라도 있으면 fail-close다. ────
MISSING_DOCUMENT_CLOSE = "MISSING_DOCUMENT_CLOSE"
UNMATCHED_DOCUMENT_CLOSE = "UNMATCHED_DOCUMENT_CLOSE"
NESTED_DOCUMENT = "NESTED_DOCUMENT"
MISSING_TYPE = "MISSING_TYPE"
EMPTY_TYPE = "EMPTY_TYPE"
MISSING_SEQUENCE = "MISSING_SEQUENCE"
NON_NUMERIC_SEQUENCE = "NON_NUMERIC_SEQUENCE"
NON_POSITIVE_SEQUENCE = "NON_POSITIVE_SEQUENCE"
DUPLICATE_SEQUENCE = "DUPLICATE_SEQUENCE"
MISSING_TEXT_OPEN = "MISSING_TEXT_OPEN"
MISSING_TEXT_CLOSE = "MISSING_TEXT_CLOSE"
AMBIGUOUS_TEXT = "AMBIGUOUS_TEXT"
CHILD_RANGE_OUTSIDE_PARENT = "CHILD_RANGE_OUTSIDE_PARENT"
DUPLICATE_KEY_DIFFERENT_BYTES = "DUPLICATE_KEY_DIFFERENT_BYTES"
NO_DOCUMENTS = "NO_DOCUMENTS"

# 줄 머리 태그만 경계다(`(?m)^`). IGNORECASE는 production 정규식과 같은 관용이다.
_DOC_OPEN = re.compile(rb"(?im)^[ \t]*<DOCUMENT>[ \t]*\r?$")
_DOC_CLOSE = re.compile(rb"(?im)^[ \t]*</DOCUMENT>[ \t]*\r?$")
_TEXT_OPEN = re.compile(rb"(?im)^[ \t]*<TEXT>[ \t]*\r?$")
_TEXT_CLOSE = re.compile(rb"(?im)^[ \t]*</TEXT>[ \t]*\r?$")
# header 필드는 한 줄짜리 `<TAG>value` 형태다.
_FIELD = {
    "type": re.compile(rb"(?im)^[ \t]*<TYPE>(?P<v>[^\r\n]*)"),
    "sequence": re.compile(rb"(?im)^[ \t]*<SEQUENCE>(?P<v>[^\r\n]*)"),
    "filename": re.compile(rb"(?im)^[ \t]*<FILENAME>(?P<v>[^\r\n]*)"),
    "description": re.compile(rb"(?im)^[ \t]*<DESCRIPTION>(?P<v>[^\r\n]*)"),
}


def sha256_bytes(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


@dataclass(frozen=True)
class EmbeddedChild:
    """`<DOCUMENT>` 자식 하나의 정체성과 byte provenance."""

    ordinal: int                     # audit provenance이지 자연키가 아니다
    document_type: str | None
    raw_sequence: str | None         # 원문 토큰 그대로
    sequence: int | None             # 타입 있는 필드다 — document_name이 아니다
    filename: str | None             # flat layout에서는 보통 None이다
    description: str | None
    document_start: int
    document_end: int
    # payload 경계 규약: `<TEXT>` 줄의 개행 **다음** byte부터 `</TEXT>` 줄이
    # 시작하기 **직전** byte까지다. 마지막 내용 줄의 개행은 payload에 들어간다.
    # 무엇을 고르든 상관없지만 **결정론적이고 문서화돼야** 재현이 성립한다.
    text_start: int | None
    text_end: int | None
    text_sha256: str | None
    failures: tuple[str, ...] = ()


@dataclass
class AccessionDecomposition:
    parent_sha256: str
    parent_bytes: int
    children: list[EmbeddedChild] = field(default_factory=list)
    failures: list[str] = field(default_factory=list)

    @property
    def structurally_deterministic(self) -> bool:
        """production locator 계약 아래 **모든** 자식이 주소 지정 가능한가."""
        if self.failures or not self.children:
            return False
        return all(not child.failures for child in self.children)


def _field_in(block: bytes, name: str) -> tuple[str | None, bool]:
    """`(값, 존재했는가)`. 값은 원문에서 오른쪽 공백만 떼고 그대로 둔다."""
    found = _FIELD[name].search(block)
    if found is None:
        return None, False
    raw = found.group("v")
    return raw.decode("latin-1").strip(), True


def _outer_document_spans(raw: bytes) -> tuple[list[tuple[int, int]], list[str]]:
    """겹치지 않는 바깥 `<DOCUMENT>` 구간. 손상된 경계는 고치지 않고 실패로 적는다.

    경계 토큰을 **위치 순서대로 한 번** 훑는 상태 기계다. 열림/닫힘이 정확히 짝지어야
    하고, 그렇지 않은 모양은 전부 실패다.

    ```text
    열려 있는데 또 열린다  -> NESTED_DOCUMENT
    안 열렸는데 닫힌다     -> UNMATCHED_DOCUMENT_CLOSE   (남는 닫힘도 여기다)
    열린 채로 끝난다       -> MISSING_DOCUMENT_CLOSE
    ```

    **짝이 남는 닫힘을 무시하지 않는다.** 무시하면 열림 하나에 닫힘 둘인 문서가
    조용히 첫 닫힘까지만 잘려 그 잘린 바이트가 자식 SHA가 된다.
    """
    tokens = sorted(
        [(match.start(), True) for match in _DOC_OPEN.finditer(raw)]
        + [(match.start(), False) for match in _DOC_CLOSE.finditer(raw)]
    )
    failures: list[str] = []
    spans: list[tuple[int, int]] = []
    opened: int | None = None
    for position, is_open in tokens:
        if is_open:
            if opened is not None:
                failures.append(NESTED_DOCUMENT)
                break
            opened = position
        else:
            if opened is None:
                failures.append(UNMATCHED_DOCUMENT_CLOSE)
                break
            spans.append((opened, position))
            opened = None
    else:
        if opened is not None:
            failures.append(MISSING_DOCUMENT_CLOSE)
    return spans, failures


def decompose(raw: bytes) -> AccessionDecomposition:
    """원본 바이트 하나를 결정론적으로 분해한다. **변환하지 않는다.**"""
    out = AccessionDecomposition(parent_sha256=sha256_bytes(raw), parent_bytes=len(raw))
    spans, span_failures = _outer_document_spans(raw)
    out.failures.extend(span_failures)
    if not spans:
        out.failures.append(NO_DOCUMENTS)
        return out

    for ordinal, (start, end) in enumerate(spans, start=1):
        block = raw[start:end]
        failures: list[str] = []

        text_opens = list(_TEXT_OPEN.finditer(block))
        text_closes = list(_TEXT_CLOSE.finditer(block))
        # header 필드는 본문 앞에서만 읽는다 — 본문이 `<TYPE>`을 말해도 줍지 않는다.
        header = block[: text_opens[0].start()] if text_opens else block

        document_type, had_type = _field_in(header, "type")
        if not had_type:
            failures.append(MISSING_TYPE)
        elif not document_type:
            failures.append(EMPTY_TYPE)

        raw_sequence, had_sequence = _field_in(header, "sequence")
        sequence: int | None = None
        if not had_sequence:
            failures.append(MISSING_SEQUENCE)
        elif raw_sequence is None or not raw_sequence.isdigit():
            failures.append(NON_NUMERIC_SEQUENCE)
        elif int(raw_sequence) <= 0:
            # `0`은 등록인이 적을 수 있는 주소가 아니다. 1로 밀어 올리지 않는다.
            failures.append(NON_POSITIVE_SEQUENCE)
        else:
            sequence = int(raw_sequence)

        filename, _ = _field_in(header, "filename")
        description, _ = _field_in(header, "description")

        text_start = text_end = None
        text_sha = None
        # **payload 경계는 정확히 한 쌍이어야 한다.** 경쟁하는 경계 토큰이 둘 이상이면
        # 어느 것이 진짜인지 고르지 않는다 — 고르면 본문 한가운데의 줄 머리 `</TEXT>`
        # 뒤가 조용히 잘린 채로 그 자식의 SHA가 된다.
        if not text_opens:
            failures.append(MISSING_TEXT_OPEN)
        elif not text_closes:
            failures.append(MISSING_TEXT_CLOSE)
        elif len(text_opens) > 1 or len(text_closes) > 1:
            failures.append(AMBIGUOUS_TEXT)
        elif text_closes[0].start() < text_opens[0].end():
            # 닫힘이 열림보다 앞이면 이 문서에는 닫힌 payload가 없다.
            failures.append(MISSING_TEXT_CLOSE)
        else:
            # `<TEXT>` 줄의 개행 다음부터 `</TEXT>` 줄 시작 앞까지가 payload다.
            payload_start = text_opens[0].end()
            while payload_start < len(block) and block[payload_start:payload_start + 1] in (b"\r", b"\n"):
                payload_start += 1
            payload_end = text_closes[0].start()
            text_start = start + payload_start
            text_end = start + payload_end
            if not (start <= text_start <= text_end <= end):
                failures.append(CHILD_RANGE_OUTSIDE_PARENT)
            else:
                text_sha = sha256_bytes(raw[text_start:text_end])

        out.children.append(EmbeddedChild(
            ordinal=ordinal, document_type=document_type,
            raw_sequence=raw_sequence if had_sequence else None, sequence=sequence,
            filename=filename or None, description=description or None,
            document_start=start, document_end=end,
            text_start=text_start, text_end=text_end, text_sha256=text_sha,
            failures=tuple(failures),
        ))

    # 자연키 `(CIK, accession, SEQUENCE)` — accession 안에서 유일해야 한다.
    # **없거나 겹치면 ordinal로 대체하지 않는다.**
    seen: dict[int, str | None] = {}
    duplicated: set[int] = set()
    for child in out.children:
        if child.sequence is None:
            continue
        if child.sequence in seen:
            duplicated.add(child.sequence)
            if seen[child.sequence] != child.text_sha256:
                out.failures.append(DUPLICATE_KEY_DIFFERENT_BYTES)
        else:
            seen[child.sequence] = child.text_sha256
    if duplicated:
        out.failures.append(DUPLICATE_SEQUENCE)
        out.children = [
            child if child.sequence not in duplicated
            else EmbeddedChild(**{**child.__dict__,
                                 "failures": tuple(child.failures) + (DUPLICATE_SEQUENCE,)})
            for child in out.children
        ]
    return out


def failure_reasons(out: AccessionDecomposition) -> tuple[str, ...]:
    """분해가 실패한 이유 전부. **legacy_layout 실패 메시지의 유일한 출처다.**

    자식 실패는 그 자식이 무엇이었는지와 함께 남긴다 — `sequence=2`는 오류 메시지의
    표시이지 production document_name이 아니다.
    """
    reasons = list(dict.fromkeys(out.failures))
    for child in out.children:
        if not child.failures:
            continue
        where = (
            f"sequence={child.sequence}" if child.sequence is not None
            else f"ordinal={child.ordinal}"
        )
        reasons.extend(f"{code}({where})" for code in child.failures)
    if not reasons and not out.children:
        reasons.append(NO_DOCUMENTS)
    return tuple(reasons)
