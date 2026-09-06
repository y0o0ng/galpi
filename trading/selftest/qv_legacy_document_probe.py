"""5A-2 구조 probe — legacy flat-layout accession 하나를 분해해 receipt를 찍는다.

**production evidence source가 아니다.** 여기서 나오는 것은 audit 관측이고, production
경로는 이 모듈을 import하지 않는다. parser는 production `backtest.qv_sec_embedded`
**하나**이고 이 파일은 그것을 SEC 원본에 대고 돌려 보는 audit CLI다 — probe가 자기
parser를 복제하면 두 문법이 조용히 갈라진다.

    python3 -m selftest.qv_legacy_document_probe 0000320193 0000320193-99-000004 \
        --contact "이름 <메일>"

**SEC를 부른다.** accession 하나에 complete submission 한 번이다.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from backtest.edgar import EdgarClient  # noqa: E402
from backtest.qv_sec_embedded import (  # noqa: E402,F401 — 기존 fixture가 쓰는 이름들
    AMBIGUOUS_TEXT,
    CHILD_RANGE_OUTSIDE_PARENT,
    DUPLICATE_KEY_DIFFERENT_BYTES,
    DUPLICATE_SEQUENCE,
    EMPTY_TYPE,
    MISSING_DOCUMENT_CLOSE,
    MISSING_SEQUENCE,
    MISSING_TEXT_CLOSE,
    MISSING_TEXT_OPEN,
    MISSING_TYPE,
    NESTED_DOCUMENT,
    NON_NUMERIC_SEQUENCE,
    NON_POSITIVE_SEQUENCE,
    NO_DOCUMENTS,
    AccessionDecomposition,
    EmbeddedChild,
    decompose,
    failure_reasons,
    sha256_bytes,
)


def probe(client, cik: str, accession: str) -> AccessionDecomposition:
    """complete submission 원본을 그대로 받아 분해한다. **변환하지 않는다.**"""
    return decompose(client.complete_submission_bytes(cik, accession))


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="legacy embedded document probe")
    parser.add_argument("cik")
    parser.add_argument("accession")
    parser.add_argument("--contact", default=None)
    arguments = parser.parse_args(argv)

    client = EdgarClient(contact=arguments.contact) if arguments.contact else EdgarClient()
    out = probe(client, arguments.cik, arguments.accession)
    print(f"{arguments.cik} {arguments.accession}")
    print(f"  parent bytes {out.parent_bytes} sha256 {out.parent_sha256}")
    print(f"  children {len(out.children)}")
    print(f"  structurally deterministic {out.structurally_deterministic}")
    for child in out.children:
        print(
            f"    seq={child.sequence} type={child.document_type} "
            f"filename={child.filename} sha256={child.text_sha256}"
        )
    for reason in failure_reasons(out):
        print(f"  failure {reason}")
    return 0 if out.structurally_deterministic else 1


if __name__ == "__main__":
    raise SystemExit(main())
