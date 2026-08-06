"""EODHD에서 일봉과 심볼 목록을 받아 저장소 계약으로 옮긴다.

가격은 유일하게 빌려야 하는 데이터다. 상장폐지 종목의 가격을 무료로 주는 곳이 없다.
실적일·섹터는 EDGAR(공공 자료), 구성원은 공고 아카이브에서 만들므로 **삭제 의무 대상이
가격만 남는다.** EODHD 약관은 해지 후 1개월 안에 복사본을 지우라고 요구한다.

## 잘린 응답을 조용히 받아들이지 않는다

무료 티어는 요청한 날짜 범위를 무시하고 최근 1년만 주면서 `warning` 필드를 넣는다.
유료 티어에서도 심볼에 따라 이력이 짧을 수 있다. 그 사실을 모르고 넘어가면 **구간 앞부분이
비어 있는 채로 백테스트가 정상 종료한다.** 그래서 이 어댑터는

- 응답의 `warning`을 모아 요약에 담고
- 요청 구간의 시작을 덮지 못한 심볼을 `gaps`로 돌려주고
- 스키마 CHECK를 만족하지 못하는 행(0 이하 가격 등)을 세어 `dropped`로 돌려준다

## 조정가는 단일 배율 가정을 쓴다

EODHD는 `close`와 `adjusted_close`를 준다. 우리 `load_bars_csv`가 그날의 단일 배율
`adjusted_close / close`를 raw OHLC에 곱해 조정 OHLC를 만든다. 2026-08-06 실측에서
필드 구성과 배율이 그 가정에 맞는 것을 확인했다(AAPL: 0.996048).
"""

from __future__ import annotations

import json
import sqlite3
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path

from .data import BARS_CSV_COLUMNS, load_bars_csv, register_source

BASE_URL = "https://eodhd.com/api"
KEY_NAMES = ("EODHD_API_KEY", "EODHD_TOKEN")
CREDENTIAL_FILENAMES = ("backtest-credentials.env", "backtest-credentials.txt")
TRADING_ROOT = Path(__file__).resolve().parents[1]

# 유료 티어는 분당 1,000회다. 여유를 두고 호출 간격을 둔다.
REQUEST_INTERVAL_SECONDS = 0.08

# 7.2가 요구하는 "미국 보통주만". EODHD 심볼 목록의 `Type` 값이다.
COMMON_STOCK = "Common Stock"
# 7.2가 제외하는 OTC를 걸러내기 위한 주요 거래소.
MAJOR_EXCHANGES = ("NASDAQ", "NYSE", "NYSE MKT", "BATS")


class EodhdError(Exception):
    """응답이 계약을 만족하지 못할 때 올린다."""


def load_key() -> str:
    """키는 gitignore된 파일에서 읽고 어디에도 찍지 않는다."""
    from paper.config import decode_env_bytes, parse_env_file

    for path in (TRADING_ROOT / name for name in CREDENTIAL_FILENAMES):
        try:
            values = parse_env_file(decode_env_bytes(path.read_bytes()))
        except FileNotFoundError:
            continue
        for name in KEY_NAMES:
            if values.get(name):
                return values[name].strip()
    import os

    for name in KEY_NAMES:
        if os.environ.get(name):
            return os.environ[name].strip()
    raise EodhdError(
        f"API 키가 없습니다. {TRADING_ROOT / CREDENTIAL_FILENAMES[0]}에"
        f" {KEY_NAMES[0]}=... 형태로 넣어주세요."
    )


@dataclass(frozen=True)
class Listing:
    """심볼 목록 한 줄. 7.2의 증권 종류·거래소 필터가 쓰는 값이다."""

    symbol: str
    name: str
    exchange: str
    security_type: str
    currency: str
    isin: str | None
    delisted: bool

    @property
    def is_common_stock(self) -> bool:
        return self.security_type == COMMON_STOCK

    @property
    def is_major_exchange(self) -> bool:
        return self.exchange in MAJOR_EXCHANGES

    @property
    def passes_universe_type_filter(self) -> bool:
        """7.2: 미국 보통주만, OTC·우선주·ETF·펀드·워런트 제외."""
        return self.is_common_stock and self.is_major_exchange and self.currency == "USD"


@dataclass(frozen=True)
class SymbolBars:
    symbol: str
    csv_text: str
    rows: int
    first: str | None
    last: str | None
    dropped: int
    warning: str | None

    def covers(self, start: str) -> bool:
        return self.first is not None and self.first <= start


def parse_listings(payload: object, *, delisted: bool) -> list[Listing]:
    if not isinstance(payload, list):
        raise EodhdError("심볼 목록이 배열이 아닙니다.")
    listings = []
    for row in payload:
        if not isinstance(row, dict):
            continue
        code = str(row.get("Code") or "").strip().upper()
        if not code:
            continue
        listings.append(
            Listing(
                symbol=code,
                name=str(row.get("Name") or ""),
                exchange=str(row.get("Exchange") or ""),
                security_type=str(row.get("Type") or ""),
                currency=str(row.get("Currency") or ""),
                isin=(str(row["Isin"]) if row.get("Isin") else None),
                delisted=delisted,
            )
        )
    return listings


def bars_from_eod(symbol: str, payload: object) -> SymbolBars:
    """EOD JSON을 우리 CSV 계약으로 옮긴다. 계약을 못 지키는 행은 세어서 버린다."""
    if not isinstance(payload, list):
        raise EodhdError(f"{symbol}의 EOD 응답이 배열이 아닙니다.")
    lines = [",".join(BARS_CSV_COLUMNS)]
    kept: list[str] = []
    dropped = 0
    warning: str | None = None
    for row in payload:
        if not isinstance(row, dict):
            dropped += 1
            continue
        if warning is None and row.get("warning"):
            warning = str(row["warning"])
        try:
            date = str(row["date"])
            values = [float(row[name]) for name in ("open", "high", "low", "close")]
            volume = float(row.get("volume") or 0.0)
            adjusted = float(row["adjusted_close"])
        except (KeyError, TypeError, ValueError):
            dropped += 1
            continue
        # 스키마 CHECK가 거부할 행을 미리 걸러 적재가 통째로 실패하지 않게 한다.
        low, high = min(values), max(values)
        if low <= 0 or adjusted <= 0 or volume < 0 or high != values[1] or low != values[2]:
            dropped += 1
            continue
        kept.append(date)
        lines.append(
            f"{symbol},{date},{values[0]:.10g},{values[1]:.10g},{values[2]:.10g},"
            f"{values[3]:.10g},{volume:.10g},{adjusted:.10g}"
        )
    return SymbolBars(
        symbol=symbol,
        csv_text="\n".join(lines) + "\n",
        rows=len(kept),
        first=min(kept) if kept else None,
        last=max(kept) if kept else None,
        dropped=dropped,
        warning=warning,
    )


class EodhdClient:
    def __init__(
        self,
        key: str | None = None,
        interval: float = REQUEST_INTERVAL_SECONDS,
    ) -> None:
        self.key = key or load_key()
        self.interval = interval
        self._last_call = 0.0
        self.calls = 0

    def _get(self, path: str, **params) -> object:
        wait = self.interval - (time.monotonic() - self._last_call)
        if wait > 0:
            time.sleep(wait)
        params.setdefault("fmt", "json")
        params["api_token"] = self.key
        url = f"{BASE_URL}/{path}?{urllib.parse.urlencode(params)}"
        self.calls += 1
        try:
            with urllib.request.urlopen(url, timeout=120) as response:
                body = response.read()
        except urllib.error.HTTPError as error:
            detail = error.read().decode("utf-8", errors="replace")[:200]
            raise EodhdError(f"HTTP {error.code} {path}: {detail}") from error
        finally:
            self._last_call = time.monotonic()
        try:
            return json.loads(body)
        except json.JSONDecodeError as error:
            raise EodhdError(f"{path}의 응답이 JSON이 아닙니다.") from error

    def eod(
        self, symbol: str, start: str | None = None, end: str | None = None
    ) -> SymbolBars:
        params: dict[str, str] = {"period": "d"}
        if start:
            params["from"] = start
        if end:
            params["to"] = end
        return bars_from_eod(symbol, self._get(f"eod/{symbol}", **params))

    def listings(self, exchange: str = "US", delisted: bool = False) -> list[Listing]:
        params = {"delisted": "1"} if delisted else {}
        return parse_listings(
            self._get(f"exchange-symbol-list/{exchange}", **params), delisted=delisted
        )


def missing_universe_symbols(
    connection: sqlite3.Connection,
    source_version: str,
    *,
    start: str,
    end: str,
) -> list[str]:
    """구간과 겹치는 구성원 중 바가 없는 심볼.

    이 목록이 비어야 "생존편향 없음"을 선언할 수 있다. 폐지 종목이 구성원에 있는데 바가
    없으면 그 종목은 유니버스에서 조용히 빠지고, 그것이 정확히 생존편향이다.
    """
    rows = connection.execute(
        "SELECT DISTINCT m.symbol FROM universe_membership AS m"
        " WHERE m.source_version = ?"
        "   AND m.valid_from <= ?"
        "   AND (m.valid_to IS NULL OR m.valid_to > ?)"
        "   AND NOT EXISTS ("
        "     SELECT 1 FROM bars_daily AS b"
        "     WHERE b.symbol = m.symbol AND b.source_version = m.source_version"
        "   )"
        " ORDER BY m.symbol",
        (source_version, end, start),
    ).fetchall()
    return [row["symbol"] for row in rows]


def load_prices(
    connection: sqlite3.Connection,
    symbols: list[str],
    source_version: str,
    *,
    client: EodhdClient | None = None,
    source: str = "eodhd",
    start: str | None = None,
    end: str | None = None,
    suffix: str = ".US",
    delisted_coverage_verified: bool = False,
) -> dict[str, object]:
    """심볼별 일봉을 받아 `bars_daily`에 넣는다.

    구간 시작을 덮지 못한 심볼은 `gaps`로 돌려준다. **그 목록을 보지 않고 넘어가면 구간
    앞부분이 비어 있는 채로 백테스트가 정상 종료한다.**

    **`survivorship_biased`의 기본값은 참이다.** EODHD가 상장폐지 가격을 제공하는 것은
    소스의 능력이고, 이 적재분이 실제로 편향이 없는지는 별개다. 생존 종목 몇 개만 받아
    놓고 "편향 없음"을 선언하면 14.7의 `SURVIVORSHIP_BIASED` blocker가 걸리지 않아
    그대로 판정에 쓰이게 된다. 편향 없음은 증명해야 하는 주장이므로
    `missing_universe_symbols`로 유니버스 전체가 덮이는지 확인한 뒤
    `delisted_coverage_verified=True`를 넘겨야 한다.
    """
    eodhd = client or EodhdClient()
    register_source(
        connection,
        source,
        source_version,
        "bars",
        point_in_time=True,
        survivorship_biased=not delisted_coverage_verified,
        note=(
            "EODHD EOD. 조정가는 adjusted_close/close 단일 배율."
            + (
                " 유니버스 전체 커버리지 확인됨"
                if delisted_coverage_verified
                else " 폐지 종목 커버리지 미확인이라 편향 있음으로 둔다"
            )
        ),
    )

    loaded: list[SymbolBars] = []
    empty: list[str] = []
    warnings: dict[str, str] = {}
    for symbol in sorted({value.strip().upper() for value in symbols}):
        request_symbol = symbol if "." in symbol else f"{symbol}{suffix}"
        bars = eodhd.eod(request_symbol, start, end)
        if bars.warning:
            warnings[symbol] = bars.warning
        if bars.rows == 0:
            empty.append(symbol)
            continue
        # 저장소에는 접미사 없는 심볼로 넣는다. 유니버스·EDGAR와 키를 맞춘다.
        load_bars_csv(
            connection, bars.csv_text.replace(f"{request_symbol},", f"{symbol},"),
            source, source_version,
        )
        loaded.append(
            SymbolBars(
                symbol=symbol,
                csv_text="",
                rows=bars.rows,
                first=bars.first,
                last=bars.last,
                dropped=bars.dropped,
                warning=bars.warning,
            )
        )

    gaps = [item.symbol for item in loaded if start and not item.covers(start)]
    return {
        "symbols": len(symbols),
        "loaded": len(loaded),
        "empty": empty,
        "rows": sum(item.rows for item in loaded),
        "dropped": sum(item.dropped for item in loaded),
        "gaps": gaps,
        "warnings": warnings,
        "calls": eodhd.calls,
        "coverage": loaded,
    }
