"""universe/market-data 심볼 ↔ SEC 경제적 심볼 사이의 **명시** 다리.

production 과거 유니버스는 재사용된 과거 티커 일부를 `universe_membership`에 넣기 전에
**벤더 계열 코드**로 바꾼다(`selftest.real_run.apply_reused`).

```text
reconstruction -> apply_reused(...) -> universe_membership
```

그 오른쪽 값(`TFCFA` · `MON_OLD` · `ABI_OLD1` · `SUN1` · `CCTYQ` …)은 **시장 데이터 계열
locator**이지 SEC 경제적 거래 심볼이 아니다. 두 영역을 섞으면 5A-2가 `TFCFA`를 과거
거래소 티커인 것처럼 SEC에서 찾게 된다.

```text
member_symbol / data_symbol   universe_membership에 저장된 심볼 = 시장 데이터 계열
identity_symbol               SEC identity와 manifest 조회에 쓰는 실제 거래 심볼
```

**정본은 `trading/universe/reused-tickers.csv` 한 파일뿐이다.** 접미사 떼기 · `_OLD`
관례 · 현재 ticker 조회 · 이름/fuzzy 매칭 · 임의의 벤더 코드 해석으로 원 심볼을
유도하지 않는다 — `SUN1` · `CCTYQ` · `TFCFA` · `MIICF`가 접미사 휴리스틱이 정본이 될 수
없다는 것을 그대로 보여준다. **정확한 매핑 줄이 권한이다.**

파일의 grain은 `(원 심볼, valid_from) → 벤더 계열`이다. QV의 역방향 해석은 멤버십 구간
정체성을 그대로 뒤집는다.

```text
(vendor_symbol, valid_from) -> identity_symbol
```

역관계가 모호하거나 모순이면 **fail-close**다. 멤버십 심볼이 매핑에 벤더 계열로
나타나지 않으면 그 identity 심볼은 자기 자신이다.

**이것은 SEC identity 증거가 아니다.** universe/market-data 심볼 provenance일 뿐이고
identity bundle의 일부가 아니다.
"""

from __future__ import annotations

import csv
import hashlib
import io
from dataclasses import dataclass
from pathlib import Path

# 다리 종류 — 고정 어휘 둘뿐이다. 신뢰도 점수를 만들지 않는다.
DIRECT = "DIRECT"
REUSED_VENDOR_SERIES = "REUSED_VENDOR_SERIES"

BRIDGE_KINDS = frozenset({DIRECT, REUSED_VENDOR_SERIES})

REUSED_CSV_NAME = "reused-tickers.csv"
DEFAULT_REUSED_PATH = Path(__file__).resolve().parents[1] / "universe" / REUSED_CSV_NAME

# 이 다리가 무엇인지/무엇이 아닌지를 산출물에서도 말한다.
BRIDGE_PROVENANCE_KIND = "UNIVERSE_MARKET_DATA_SYMBOL_PROVENANCE"
BRIDGE_PROVENANCE_NOTE = (
    "universe/bar symbol != SEC economic symbol for reused-ticker historical series. "
    "This is universe/market-data symbol provenance, NOT SEC identity evidence, and it "
    "is not part of the identity bundle."
)

REQUIRED_COLUMNS = ("symbol", "valid_from", "vendor_symbol")


class QVSymbolBridgeError(Exception):
    """역방향 재사용 매핑이 모호·모순이거나 읽을 수 없을 때 올린다."""


@dataclass(frozen=True)
class SymbolBridge:
    """`(member_symbol, valid_from) → identity_symbol` 역방향 해석기.

    `source_version`은 읽은 CSV **내용**의 결정론적 해시다. 파일 경로나 mtime이 아니라
    내용이 바뀌면 바뀐다.
    """

    source: str
    source_version: str
    reverse: dict[tuple[str, str], str]
    vendor_symbols: frozenset[str]

    def resolve(self, member_symbol: str, valid_from: str) -> tuple[str, str]:
        """`(identity_symbol, symbol_bridge_kind)`.

        매핑에 벤더 계열로 없는 심볼의 identity 심볼은 자기 자신이다. 벤더 계열로는
        아는데 **그 구간에 대한 명시 줄이 없으면** fail-close다 — 그때 자기 자신으로
        되돌리면 벤더 코드가 SEC 심볼로 조용히 새어 나간다.
        """
        symbol = str(member_symbol or "").strip().upper()
        start = str(valid_from or "").strip()
        if not symbol:
            raise QVSymbolBridgeError("member_symbol이 비었습니다")
        if not start:
            raise QVSymbolBridgeError(f"{symbol}: valid_from이 비었습니다")
        found = self.reverse.get((symbol, start))
        if found is not None:
            return found, REUSED_VENDOR_SERIES
        if symbol in self.vendor_symbols:
            raise QVSymbolBridgeError(
                f"{symbol}는 재사용 벤더 계열인데 구간 {start}에 대한 명시 줄이"
                f" {self.source}에 없습니다 — 원 심볼을 추측하지 않고 멈춥니다"
            )
        return symbol, DIRECT

    def as_json(self, *, translated_membership_rows: int | None = None) -> dict:
        payload = {
            "kind": BRIDGE_PROVENANCE_KIND,
            "note": BRIDGE_PROVENANCE_NOTE,
            "reused_series_source": self.source,
            "reused_series_source_version": self.source_version,
            "reused_series_rows": len(self.reverse),
        }
        if translated_membership_rows is not None:
            payload["translated_membership_rows"] = translated_membership_rows
        return payload


def content_version(text: str) -> str:
    """CSV 내용의 결정론적 불변 식별자."""
    digest = hashlib.sha256(text.encode("utf-8")).hexdigest()
    return f"reused-tickers-sha256:{digest}"


def parse_symbol_bridge(text: str, *, source: str) -> SymbolBridge:
    """명시 CSV를 역방향 해석기로 뒤집는다. 모호·모순이면 fail-close다."""
    reader = csv.DictReader(io.StringIO(text))
    fields = tuple(reader.fieldnames or ())
    missing = [name for name in REQUIRED_COLUMNS if name not in fields]
    if missing:
        raise QVSymbolBridgeError(
            f"{source}: 재사용 매핑에 없는 열입니다 — " + ", ".join(missing)
        )

    reverse: dict[tuple[str, str], str] = {}
    originals: set[str] = set()
    vendors: set[str] = set()
    for row in reader:
        symbol = (row.get("symbol") or "").strip().upper()
        vendor = (row.get("vendor_symbol") or "").strip().upper()
        valid_from = (row.get("valid_from") or "").strip()
        if not symbol and not vendor and not valid_from:
            continue
        if not (symbol and vendor and valid_from):
            raise QVSymbolBridgeError(
                f"{source}: 불완전한 줄입니다 —"
                f" symbol={symbol!r} valid_from={valid_from!r} vendor_symbol={vendor!r}"
            )
        if symbol == vendor:
            raise QVSymbolBridgeError(
                f"{source}: {symbol}가 자기 자신을 벤더 계열로 가리킵니다"
            )
        key = (vendor, valid_from)
        existing = reverse.get(key)
        if existing is not None and existing != symbol:
            raise QVSymbolBridgeError(
                f"{source}: 역방향 매핑이 모호합니다 —"
                f" ({vendor}, {valid_from})가 {existing}와 {symbol} 둘을 가리킵니다"
            )
        reverse[key] = symbol
        originals.add(symbol)
        vendors.add(vendor)

    both = sorted(originals & vendors)
    if both:
        raise QVSymbolBridgeError(
            f"{source}: 원 심볼이면서 동시에 벤더 계열인 심볼이 있습니다 — "
            + ", ".join(both)
        )

    return SymbolBridge(
        source=source,
        source_version=content_version(text),
        reverse=reverse,
        vendor_symbols=frozenset(vendors),
    )


def load_symbol_bridge(path: str | Path = DEFAULT_REUSED_PATH) -> SymbolBridge:
    """명시 매핑 파일을 읽는다. **없으면 fail-close다.**

    빈 매핑으로 조용히 넘어가면 벤더 계열 심볼이 전부 `DIRECT`가 되어 SEC identity로
    새어 나간다 — 정확히 이 fix가 막는 일이다.
    """
    target = Path(path)
    if not target.exists():
        raise QVSymbolBridgeError(
            f"재사용 티커 매핑 파일이 없습니다: {target}"
            " — 벤더 계열 심볼을 SEC 심볼로 취급하지 않기 위해 멈춥니다"
        )
    try:
        relative = str(target.resolve().relative_to(Path(__file__).resolve().parents[2]))
    except ValueError:
        relative = str(target)
    return parse_symbol_bridge(target.read_text(encoding="utf-8"), source=relative)
