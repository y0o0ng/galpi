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

import datetime as dt
import json
import sqlite3
import time
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Callable
from dataclasses import dataclass, replace
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


def unlisted_symbols(
    client: EodhdClient,
    symbols: list[str] | set[str] | frozenset[str],
    *,
    exchange: str = "US",
) -> list[str]:
    """벤더 심볼 목록(상장+폐지)에 아예 없는 유니버스 심볼. **적재 전에 부른다.**

    개명한 회사가 유니버스에서 조용히 빠지는 것을 잡는 그물이다. 지금까지 개명을 찾은
    신호는 "편입만 있고 편출 없는 티커"였는데, 편출 기록이 멀쩡히 있는 개명은 그 신호에
    안 걸린다. 2026-08-09에 이 검사로 여덟 개(`ACE`·`CDAY`·`FRE`·`HANS`·`RE`·`RIMM`·
    `UAUA`·`WFMI`)를 더 찾았다.

    호출 2회이고 적재 전에 알 수 있으므로, 900여 종목을 받다가 404로 멈추는 것보다 싸다.
    """
    known: set[str] = set()
    for delisted in (False, True):
        known |= {listing.symbol for listing in client.listings(exchange, delisted=delisted)}
    return sorted({str(symbol).strip().upper() for symbol in symbols} - known)


NO_BARS = "NO_BARS"
STARTS_LATE = "STARTS_LATE"
ENDS_EARLY = "ENDS_EARLY"
EXIT_LAG = "EXIT_LAG"


@dataclass(frozen=True)
class IntervalCoverage:
    """멤버십 구간 하나와 그 심볼의 벤더 계열이 얼마나 맞물리는지."""

    symbol: str
    index_name: str
    valid_from: str
    valid_to: str | None
    first: str | None
    last: str | None
    problem: str

    @property
    def tail_days(self) -> int | None:
        """계열이 끊긴 뒤로 구간이 더 이어진 날 수. 편출일 지연의 크기다."""
        if self.last is None or self.valid_to is None:
            return None
        return (dt.date.fromisoformat(self.valid_to) - dt.date.fromisoformat(self.last)).days

    def describe(self) -> str:
        return (
            f"{self.symbol} [{self.index_name}] {self.valid_from}~{self.valid_to or ''}"
            f" 계열 {self.first or '없음'}~{self.last or '없음'} → {self.problem}"
        )


def _shift_days(date: str, days: int) -> str:
    return (dt.date.fromisoformat(date) + dt.timedelta(days=days)).isoformat()


def uncovered_intervals(
    connection: sqlite3.Connection,
    source_version: str,
    *,
    end: str,
    tolerance_days: int = 10,
) -> list[IntervalCoverage]:
    """벤더 계열이 멤버십 구간을 덮지 못하는 곳. **적재 뒤에 부른다.**

    `missing_universe_symbols`는 바가 **하나도** 없는 심볼만 본다. 그래서 티커가 재사용된
    경우를 통째로 놓친다 — 벤더는 그 티커의 현재 주인 계열을 아무 불평 없이 주고, 우리는
    옛 구성원 자리에 **다른 회사 가격**을 넣은 채로 정상 종료한다. 2026-08-09 실측에서
    `CEG`(2022-01-19~)·`DOW`(2019-03-20~)·`DELL`(2016-08-17~)·`SNDK`(2025-02-13~)·
    `Q`(2024-12-31~)가 전부 그 모양이었고, 다섯 종목의 구간은 모두 2016년 이전에 끝난다.

    구간 시작보다 계열이 늦게 시작하면 그것이 신호다. **지수에 들어가기 전에 상장돼 있어야
    하므로 정상적인 종목은 계열이 구간보다 먼저 시작한다.** 반대로 계열이 구간 끝보다 일찍
    끊기면 뒷부분이 빈 채로 백테스트가 돈다.

    잡지 못하는 한 가지는 벤더가 **생존 회사 이력을 전 구간에 back-fill한** 재사용이다.
    `MNST`가 그랬다(1995년부터 한 계열이라 커버리지는 완벽한데 2008년 자리의 실체는 몬스터
    월드와이드다). 그것은 구간이 둘 이상인 심볼을 이름으로 확인해야 보인다.
    """
    # 계열의 끝은 심볼당 한 번만 잰다. 구간마다 재면 다구간 심볼에서 바 테이블을 다시 훑는다.
    rows = connection.execute(
        "WITH extent AS ("
        "  SELECT symbol, MIN(trade_date) AS first, MAX(trade_date) AS last"
        "    FROM bars_daily WHERE source_version = ? GROUP BY symbol"
        ")"
        " SELECT m.symbol, m.index_name, m.valid_from, m.valid_to, e.first, e.last"
        "   FROM universe_membership AS m"
        "   LEFT JOIN extent AS e ON e.symbol = m.symbol"
        "  WHERE m.source_version = ?"
        "  ORDER BY m.symbol, m.index_name, m.valid_from",
        (source_version, source_version),
    ).fetchall()

    found: list[IntervalCoverage] = []
    for row in rows:
        first, last = row["first"], row["last"]
        valid_to = row["valid_to"]
        # 열린 구간은 적재 구간의 끝까지 필요하다.
        closes_at = min(valid_to, end) if valid_to else end
        if first is None:
            problem = NO_BARS
        elif first > _shift_days(row["valid_from"], tolerance_days):
            problem = STARTS_LATE
        elif last < _shift_days(closes_at, -tolerance_days):
            problem = ENDS_EARLY
        else:
            continue
        found.append(
            IntervalCoverage(
                symbol=row["symbol"],
                index_name=row["index_name"],
                valid_from=row["valid_from"],
                valid_to=valid_to,
                first=first,
                last=last,
                problem=problem,
            )
        )
    return found


def accept_exit_lag(
    found: list[IntervalCoverage],
    snapshot_closed: set[tuple[str, str, str]],
    *,
    index_symbol: Callable[[str], str] | None = None,
) -> tuple[list[IntervalCoverage], list[IntervalCoverage]]:
    """넘치는 구간 끝 중 **편출일 지연**을 인정해 가른다. `(인정, 남음)`을 준다.

    스냅샷이 낸 편출은 효력일이 아니라 "늦어도 이 판에는 빠져 있었다"는 상한이다. 그래서
    회사가 이미 거래를 멈춘 뒤로 구간이 며칠~몇 달 더 이어지고, 그 꼬리에 바가 없는 것이
    맞다. 2026-08-10 실측에서 `ENDS_EARLY` 25개의 계열 끝이 전부 진짜 기업 사건 날짜였다
    — `AW` 2008-12-05(리퍼블릭 합병) · `MOT` 2011-01-03(분사) · `EDS` 2008-08-25(HP 인수).
    **넘치는 구간에 바가 없으면 백테스트가 그 종목을 고를 수 없으므로** 결과를 낙관적으로
    만들지 않는다. 생존편향은 죽은 회사가 목록에서 빠지는 것이지 며칠 더 남는 것이 아니다.

    ## 문턱을 쓰지 않는다

    지연 일수는 11·23·36·58·86·104·247·956·1655로 이어져 자를 자리가 없고, "직전 판
    날짜 안"으로 좁히면 `AW`·`BDK`·`EDS`·`FO`·`MOT`가 떨어진다 — 위키 표가 직전 판에서도
    이미 낡아 있기 때문이다. 대신 성질이 다른 두 조건만 본다.

    1. **그 구간을 닫은 것이 스냅샷 사건일 것.** 공고 편출은 효력일이 정확하므로 거기서
       계열이 일찍 끊기면 상한이 헐거운 것이 아니라 진짜 데이터 구멍이다(`COV`는 코비디엔이
       2015년까지 거래했는데 벤더 계열이 2012년에 끊긴다).
    2. **계열이 구간 안까지 닿을 것.** 구간 시작에도 못 닿았으면 지연이 아니라 부재이거나
       티커 재사용이다(`PEAK`·`HET`).

    `snapshot_closed`는 `(지수, 심볼, 날짜)`이고 **공고가 이긴 편출은 들어가지 않는다.**
    심볼은 지수 티커라, 재사용 매핑으로 벤더 계열 심볼이 된 구간은 `index_symbol`로 되돌려
    맞춘다.
    """
    to_index = index_symbol or (lambda symbol: symbol)
    accepted: list[IntervalCoverage] = []
    remaining: list[IntervalCoverage] = []
    for item in found:
        lagged = (
            item.problem == ENDS_EARLY
            and item.last is not None
            and item.valid_to is not None
            and (item.index_name, to_index(item.symbol), item.valid_to) in snapshot_closed
            and item.last >= item.valid_from
        )
        if lagged:
            accepted.append(replace(item, problem=EXIT_LAG))
        else:
            remaining.append(item)
    return accepted, remaining


# 벤더가 재사용된 티커의 **옛** 회사를 담아두는 접미사. 실측으로 확인한 규칙이다 —
# `CEG_OLD`(CONSTELLATION ENERGY GROUP INC)·`DELL_OLD`(Dell Inc)·`EMC_OLD`(EMC Corporation).
# 한 티커를 세 회사가 나눠 쓴 경우를 위해 번호가 붙은 것도 본다(`PCS_OLD`·`PCS_OLD1`).
REUSE_SUFFIXES = ("_OLD", "_OLD1", "_OLD2", "_OLD3")

REUSED_CSV_COLUMNS = ("symbol", "valid_from", "vendor_symbol", "vendor_name")


@dataclass(frozen=True)
class ReusedSeries:
    """멤버십 구간 하나를 벤더의 어느 계열에서 읽을지."""

    symbol: str
    valid_from: str
    vendor_symbol: str
    vendor_name: str
    first: str
    last: str


def find_reused_series(
    client: EodhdClient,
    uncovered: list[IntervalCoverage],
    *,
    start: str,
    end: str,
    tolerance_days: int = 10,
) -> tuple[list[ReusedSeries], list[IntervalCoverage]]:
    """구간을 못 덮는 심볼마다 `_OLD` 계열을 찾아 **구간을 덮는 것만** 받는다.

    `unlisted_symbols`가 0을 주는데도 구간이 비는 이유가 여기 있었다. 현재 티커는 벤더
    목록에 멀쩡히 있고, 정작 그 시절 회사는 `_OLD` 아래 따로 있다.

    **찾은 계열을 기본 심볼로 합치지 않는다.** `CEG_OLD`는 2006~2012, 새 `CEG`는 2022~라
    한 계열로 묶으면 10년 구멍과 가격 점프가 있는 하나가 되고, 새 회사의 첫 252세션이
    SMA·ATR·모멘텀을 옛 회사 바에서 끌어온다. 다른 회사는 다른 심볼로 둔다.
    """
    known = set()
    for delisted in (False, True):
        known |= {listing.symbol for listing in client.listings("US", delisted=delisted)}

    found: list[ReusedSeries] = []
    remaining: list[IntervalCoverage] = []
    for interval in uncovered:
        closes_at = min(interval.valid_to, end) if interval.valid_to else end
        picked = None
        for suffix in REUSE_SUFFIXES:
            candidate = f"{interval.symbol}{suffix}"
            if candidate not in known:
                continue
            bars = client.eod(f"{candidate}.US", start, end)
            if bars.first is None or bars.last is None:
                continue
            if bars.first > _shift_days(interval.valid_from, tolerance_days):
                continue
            if bars.last < _shift_days(closes_at, -tolerance_days):
                continue
            picked = ReusedSeries(
                symbol=interval.symbol,
                valid_from=interval.valid_from,
                vendor_symbol=candidate,
                vendor_name="",
                first=bars.first,
                last=bars.last,
            )
            break
        if picked:
            found.append(picked)
        else:
            remaining.append(interval)
    return found, remaining


def reused_csv(items: list[ReusedSeries]) -> str:
    lines = [",".join(REUSED_CSV_COLUMNS)]
    for item in sorted(items, key=lambda value: (value.symbol, value.valid_from)):
        lines.append(
            f"{item.symbol},{item.valid_from},{item.vendor_symbol},{item.vendor_name}"
        )
    return "\n".join(lines) + "\n"


def parse_reused_csv(text: str) -> dict[tuple[str, str], str]:
    """`(심볼, 구간 시작) → 벤더 계열` 매핑."""
    import csv as _csv
    import io as _io

    reader = _csv.DictReader(_io.StringIO(text))
    missing = [name for name in REUSED_CSV_COLUMNS[:3] if name not in (reader.fieldnames or ())]
    if missing:
        raise EodhdError("재사용 티커 CSV에 없는 열입니다: " + ", ".join(missing))
    mapping: dict[tuple[str, str], str] = {}
    for row in reader:
        symbol = (row.get("symbol") or "").strip().upper()
        vendor = (row.get("vendor_symbol") or "").strip().upper()
        valid_from = (row.get("valid_from") or "").strip()
        if symbol and vendor and valid_from:
            mapping[(symbol, valid_from)] = vendor
    return mapping


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

    **`missing_universe_symbols`만으로는 모자란다.** 그것은 바가 하나도 없는 심볼만 보므로,
    티커가 재사용돼 다른 회사 계열이 들어온 구간은 통과시킨다. `uncovered_intervals`도
    함께 비어야 한다.
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
    failed: dict[str, str] = {}
    warnings: dict[str, str] = {}
    for symbol in sorted({value.strip().upper() for value in symbols}):
        request_symbol = symbol if "." in symbol else f"{symbol}{suffix}"
        try:
            bars = eodhd.eod(request_symbol, start, end)
        except EodhdError as error:
            # **한 심볼의 실패로 배치를 버리지 않는다.** 900종목을 받다가 404 하나에
            # 멈추면 그때까지 받은 것이 다음 실행에서 건너뛰기 대상이 되어, 어디까지
            # 받았는지 사람이 세야 한다. 실패는 모아서 돌려주고 계속 간다.
            failed[symbol] = str(error)[:120]
            continue
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
        "failed": failed,
        "rows": sum(item.rows for item in loaded),
        "dropped": sum(item.dropped for item in loaded),
        "gaps": gaps,
        "warnings": warnings,
        "calls": eodhd.calls,
        "coverage": loaded,
    }
