"""SEC EDGAR에서 실적일과 섹터를 모은다.

12.4는 뉴스·공시를 "SEC EDGAR·거래소 공시·실적 일정 등 무료 공식 소스로 한정"하라고
한다. EDGAR는 공공 자료라 **구독 만료 후 삭제 의무가 없다.** 가격만 벤더에서 빌리고
나머지를 여기서 만들면 재실행 비용이 가격값으로 줄어든다.

## 실적일: 8-K Item 2.02

실적 발표는 8-K의 Item 2.02(`Results of Operations and Financial Condition`)로 제출된다.
`submissions/CIK*.json`의 `items` 필드에 항목 번호가 있어 그대로 걸러낼 수 있다. Item
2.02 제도가 2004년 시행이라 그 이전은 없고, 14.3이 요구하는 10~15년에는 충분하다.

## 왜 추정 캘린더가 필요한가

우리 규칙은 "다가오는 실적일"을 알아야 하는데 EDGAR는 **지나간** 발표일만 준다. 그래서
관측된 발표일마다 다음 발표일을 추정해 넣는다.

- `event_at` = 마지막 실제 발표일 + 추정 간격
- `published_at` = 마지막 실제 발표일 (그날 이 추정을 할 수 있었다)
- `confidence` = `estimated`

**추정 간격은 이른 쪽으로 잡는다.** 추정이 실제보다 늦으면 실적을 그대로 맞지만, 이르면
잃는 것은 거래 기회뿐이다. 그리고 이르게 잡아도 안전한 이유는 fail-close 두 개가 맞물리기
때문이다. 추정일이 지나면 `next_earnings`가 None을 주고, 그러면 `require_earnings_calendar`
가 `EARNINGS_UNKNOWN`으로 신규 진입을 막는다. 즉 추정일과 실제 발표 사이의 공백에서
재진입해 실적을 맞는 일이 없다. 그 공백의 비용은 `EARNINGS_UNKNOWN` 카운터로 측정된다.

실제 발표일도 `confirmed`로 함께 저장한다. `next_earnings`의 조건(`published_at <= as_of`
이면서 `event_at > as_of`)에는 절대 걸리지 않아 결정에 영향을 주지 않지만, 나중에 추정이
얼마나 일렀는지 재는 근거가 된다.

## 섹터: SIC 2자리 대분류

`submissions`의 `sic`을 2자리 대분류로 줄여 섹터 키로 쓴다. **GICS가 아니다.** 4자리를
그대로 쓰면 분류가 수백 개로 쪼개져 9.2의 섹터 25% 한도가 사실상 작동하지 않고, SIC
division(10개)은 제조업 하나가 기술·제약·산업재를 다 삼켜 반대로 상시 구속한다. 2자리
대분류(약 80개)가 그 사이다.

같은 GICS 섹터인 반도체와 소프트웨어가 다른 SIC 대분류로 갈리므로 이 한도는 설계가
의도한 것과 **다르게 분할한다.** `securities.source`에 출처를 남겨 이 편차가 보이게 한다.
제대로 된 GICS 분류가 필요해지면 유료 소스가 있어야 한다.

또 `sic`은 **현재** 값이고 과거 재분류 이력이 아니다. `securities` 표가 이미 그 한계를
갖고 있다.

## 티커→CIK 매핑이 과거를 잃는 경우

`company_tickers.json`은 티커의 **현재** CIK만 준다. 회사가 지주회사로 재편되거나 합병되면
티커가 새 법인으로 옮겨가고 그 법인에는 과거 제출이 없다. 실측 예: `XOM`은
`CIK 2115436 ExxonMobil Holdings Corp`(제출 28건, 2026-07부터)로 가고 실제 이력 125건은
`CIK 34088 EXXON MOBIL CORP`에 있는데 그 CIK의 `tickers`는 이제 빈 배열이다.

**이것을 그냥 두면 조용한 유니버스 편향이 된다.** 재편된 회사는 실적일이 없어
`EARNINGS_UNKNOWN`으로 후보에서 빠지고, 아무도 그 사실을 모른다. 그래서 두 가지를 한다.

1. **커버리지를 재서 부족한 종목을 목록으로 돌려준다.** 조용히 넘기지 않는다.
2. `CIK_OVERRIDES`로 알려진 경우를 고정한다. 자동으로 선행 법인을 찾아주는 API는 없으므로
   발견될 때마다 근거와 함께 추가한다.
"""

from __future__ import annotations

import json
import sqlite3
import statistics
import time
import urllib.error
import urllib.request
from dataclasses import dataclass

from .data import load_earnings_csv, load_securities_csv, register_source

# SEC 공정접근 정책은 연락처가 있는 User-Agent와 초당 10회 이하를 요구한다.
DEFAULT_CONTACT = "chanyongs2005@gmail.com"
REQUEST_INTERVAL_SECONDS = 0.15

TICKER_MAP_URL = "https://www.sec.gov/files/company_tickers.json"
SUBMISSIONS_URL = "https://data.sec.gov/submissions/CIK{cik}.json"
ARCHIVE_URL = "https://data.sec.gov/submissions/{name}"

EARNINGS_ITEM = "2.02"

# 티커가 이력 없는 신설 법인으로 옮겨간 경우의 수동 고정. 발견 근거를 함께 남긴다.
# XOM: company_tickers.json은 CIK 2115436(ExxonMobil Holdings Corp, 2026-07 이후 제출
# 28건)을 주지만 실적 이력 125건은 CIK 34088(EXXON MOBIL CORP)에 있다. 2026-08-06 확인.
CIK_OVERRIDES = {"XOM": "0000034088"}

# 분기 발표로 볼 간격의 범위. Item 2.02는 실적 외의 사유로도 제출되므로 이 범위를
# 벗어난 간격은 분기 주기 추정에서 뺀다. 실측 예: AAPL의 간격 중앙값 91일, 범위 27~98일.
MIN_QUARTER_GAP_DAYS = 60
MAX_QUARTER_GAP_DAYS = 120
# 관측이 부족한 종목의 기본 간격. 분기(91일)보다 짧게 잡아 이른 쪽으로 기울인다.
FALLBACK_GAP_DAYS = 80
# 추정 간격의 분위. 낮을수록 이르게 추정해 실적을 맞을 위험이 줄고 거래 기회가 줄어든다.
GAP_QUANTILE = 0.10

# 요청 구간보다 이만큼 앞의 제출까지 가져온다. 추정 행은 **직전** 실제 발표일에 발행되므로,
# 구간 시작일에 다가오는 실적을 알고 있으려면 그 앞 분기의 발표일이 있어야 한다. 한 분기
# (약 91일)로는 경계에서 아슬아슬하고, 1년이면 간격 추정에 쓸 표본도 함께 들어온다.
# 이 여유가 없으면 구간 시작 직후 종목들이 EARNINGS_UNKNOWN으로 조용히 빠진다.
FETCH_LOOKBACK_DAYS = 400


class EdgarError(Exception):
    """EDGAR 응답이 기대한 모양이 아닐 때 올린다."""


@dataclass(frozen=True)
class Coverage:
    """종목별 실적일 커버리지. 부족한 것을 조용히 넘기지 않기 위한 기록이다."""

    symbol: str
    cik: str
    count: int
    first: str | None
    last: str | None
    pinned: bool

    def covers(self, window_start: str) -> bool:
        """요청 구간 시작 이전부터 실적일이 있어야 그 구간을 판정에 쓸 수 있다."""
        return self.first is not None and self.first <= window_start


@dataclass(frozen=True)
class Company:
    ticker: str
    cik: str  # 10자리 zero-padded
    name: str


def parse_ticker_map(payload: object) -> dict[str, Company]:
    """`company_tickers.json`을 티커 → 회사로 바꾼다."""
    if not isinstance(payload, dict):
        raise EdgarError("company_tickers.json이 객체가 아닙니다.")
    companies: dict[str, Company] = {}
    for row in payload.values():
        ticker = str(row.get("ticker", "")).strip().upper()
        if not ticker:
            continue
        companies[ticker] = Company(
            ticker=ticker,
            cik=str(row["cik_str"]).zfill(10),
            name=str(row.get("title", "")),
        )
    if not companies:
        raise EdgarError("티커 매핑이 비어 있습니다.")
    return companies


def _fetch_floor(window_start: str) -> str:
    """아카이브를 건너뛸 기준일. 요청 구간보다 `FETCH_LOOKBACK_DAYS` 앞이다."""
    from datetime import date as date_type, timedelta

    return (
        date_type.fromisoformat(window_start) - timedelta(days=FETCH_LOOKBACK_DAYS)
    ).isoformat()


def _filing_blocks(payload: dict) -> list[dict]:
    filings = payload.get("filings") or {}
    blocks = []
    recent = filings.get("recent")
    if isinstance(recent, dict):
        blocks.append(recent)
    return blocks


def earnings_dates_from_block(block: dict) -> list[str]:
    """제출 블록에서 8-K Item 2.02의 제출일을 뽑는다."""
    forms = block.get("form") or []
    dates = block.get("filingDate") or []
    items = block.get("items") or [""] * len(forms)
    found = []
    for form, date, item in zip(forms, dates, items):
        if form == "8-K" and EARNINGS_ITEM in str(item):
            found.append(str(date))
    return found


def sector_from_submissions(payload: dict) -> str | None:
    """SIC 4자리를 2자리 대분류 섹터 키로 줄인다."""
    sic = str(payload.get("sic") or "").strip()
    if not sic.isdigit():
        return None
    return f"SIC{int(sic) // 100:02d}"


def estimate_gap_days(dates: list[str]) -> int:
    """다음 발표까지의 추정 간격. 이른 쪽으로 기울인 분위값이다."""
    ordered = sorted(set(dates))
    if len(ordered) < 3:
        return FALLBACK_GAP_DAYS
    from datetime import date as date_type

    parsed = [date_type.fromisoformat(value) for value in ordered]
    gaps = [
        (later - earlier).days
        for earlier, later in zip(parsed, parsed[1:])
        if MIN_QUARTER_GAP_DAYS <= (later - earlier).days <= MAX_QUARTER_GAP_DAYS
    ]
    if not gaps:
        return FALLBACK_GAP_DAYS
    gaps.sort()
    index = max(0, min(len(gaps) - 1, int(GAP_QUANTILE * (len(gaps) - 1))))
    return gaps[index]


def build_earnings_rows(symbol: str, dates: list[str]) -> list[dict[str, str]]:
    """실제 발표일(confirmed)과 그 시점에 만들 수 있었던 다음 발표 추정(estimated)."""
    from datetime import date as date_type, timedelta

    ordered = sorted(set(dates))
    if not ordered:
        return []
    gap = estimate_gap_days(ordered)
    rows: list[dict[str, str]] = []
    for value in ordered:
        actual = date_type.fromisoformat(value)
        rows.append(
            {
                "symbol": symbol,
                "event_at": value,
                "published_at": value,
                "confidence": "confirmed",
            }
        )
        rows.append(
            {
                "symbol": symbol,
                "event_at": (actual + timedelta(days=gap)).isoformat(),
                "published_at": value,
                "confidence": "estimated",
            }
        )
    return rows


def earnings_csv(rows: list[dict[str, str]]) -> str:
    lines = ["symbol,event_at,published_at,confidence"]
    for row in rows:
        lines.append(
            f"{row['symbol']},{row['event_at']},{row['published_at']},{row['confidence']}"
        )
    return "\n".join(lines) + "\n"


def securities_csv(sectors: dict[str, str]) -> str:
    lines = ["symbol,sector"]
    for symbol in sorted(sectors):
        lines.append(f"{symbol},{sectors[symbol]}")
    return "\n".join(lines) + "\n"


class EdgarClient:
    """EDGAR 조회. 초당 10회 제한을 지키려고 호출 사이를 띄운다."""

    def __init__(
        self,
        contact: str = DEFAULT_CONTACT,
        interval: float = REQUEST_INTERVAL_SECONDS,
    ) -> None:
        self.user_agent = f"galpi-research {contact}"
        self.interval = interval
        self._last_call = 0.0
        self.calls = 0

    def _get(self, url: str) -> object:
        wait = self.interval - (time.monotonic() - self._last_call)
        if wait > 0:
            time.sleep(wait)
        request = urllib.request.Request(url, headers={"User-Agent": self.user_agent})
        self.calls += 1
        try:
            with urllib.request.urlopen(request, timeout=90) as response:
                body = response.read()
        except urllib.error.HTTPError as error:
            raise EdgarError(f"HTTP {error.code}: {url}") from error
        finally:
            self._last_call = time.monotonic()
        return json.loads(body)

    def ticker_map(self) -> dict[str, Company]:
        return parse_ticker_map(self._get(TICKER_MAP_URL))

    def submissions(self, cik: str) -> dict:
        payload = self._get(SUBMISSIONS_URL.format(cik=cik))
        if not isinstance(payload, dict):
            raise EdgarError(f"submissions 응답이 객체가 아닙니다: {cik}")
        return payload

    def all_earnings_dates(
        self, cik: str, window_start: str | None = None
    ) -> tuple[list[str], dict]:
        """최근 블록과 과거 아카이브를 합쳐 전체 실적일을 모은다.

        `filings.recent`는 최근 1,000건까지만 담고 나머지는 `filings.files`의 별도
        파일에 있다. 15년을 보려면 아카이브까지 읽어야 한다.

        `window_start`를 주면 그보다 완전히 이전인 아카이브는 읽지 않는다. 아카이브
        메타데이터에 `filingTo`가 있어 호출 전에 건너뛸 수 있다. 종목당 호출이 20회에
        가깝고(실측) 유니버스가 500종목대이므로 SEC 서버 부담을 줄이는 쪽이 옳다.
        """
        payload = self.submissions(cik)
        dates: list[str] = []
        for block in _filing_blocks(payload):
            dates.extend(earnings_dates_from_block(block))
        for meta in (payload.get("filings") or {}).get("files") or []:
            name = meta.get("name")
            if not name:
                continue
            if window_start and str(meta.get("filingTo") or "") < _fetch_floor(window_start):
                continue
            archive = self._get(ARCHIVE_URL.format(name=name))
            if isinstance(archive, dict):
                dates.extend(earnings_dates_from_block(archive))
        return sorted(set(dates)), payload


def resolve_cik(
    ticker: str,
    companies: dict[str, Company],
    overrides: dict[str, str] | None = None,
) -> tuple[str | None, bool]:
    """티커의 CIK. 고정값이 있으면 그것을 쓰고 고정 여부를 함께 돌려준다."""
    pinned = (overrides or CIK_OVERRIDES).get(ticker)
    if pinned:
        return pinned.zfill(10), True
    company = companies.get(ticker)
    return (company.cik, False) if company else (None, False)


def collect(
    connection: sqlite3.Connection,
    tickers: list[str],
    source_version: str,
    *,
    client: EdgarClient | None = None,
    source: str = "sec-edgar",
    window_start: str | None = None,
    overrides: dict[str, str] | None = None,
) -> dict[str, object]:
    """티커 목록의 실적일과 섹터를 모아 저장소에 넣는다.

    EDGAR는 공공 자료이므로 생존편향과 무관하고 point-in-time이다. 실적일은 제출일이
    그대로 발표일이고, 섹터는 현재 SIC라 과거 재분류 이력이 없다.

    `window_start`를 주면 그 구간을 덮지 못하는 종목을 `gaps`로 돌려준다. **그 목록을
    보지 않고 다음 단계로 넘어가면 재편된 회사가 조용히 유니버스에서 빠진다.**
    """
    edgar = client or EdgarClient()
    companies = edgar.ticker_map()

    earnings_rows: list[dict[str, str]] = []
    sectors: dict[str, str] = {}
    missing: list[str] = []
    coverage: list[Coverage] = []
    for ticker in sorted({value.strip().upper() for value in tickers}):
        cik, pinned = resolve_cik(ticker, companies, overrides)
        if cik is None:
            missing.append(ticker)
            continue
        dates, payload = edgar.all_earnings_dates(cik, window_start)
        earnings_rows.extend(build_earnings_rows(ticker, dates))
        sector = sector_from_submissions(payload)
        if sector is not None:
            sectors[ticker] = sector
        coverage.append(
            Coverage(
                symbol=ticker,
                cik=cik,
                count=len(dates),
                first=dates[0] if dates else None,
                last=dates[-1] if dates else None,
                pinned=pinned,
            )
        )

    register_source(
        connection,
        source,
        source_version,
        "earnings",
        point_in_time=True,
        survivorship_biased=False,
        note="8-K Item 2.02 제출일. estimated 행은 그 시점에 만들 수 있었던 다음 발표 추정",
    )
    register_source(
        connection,
        source,
        source_version,
        "securities",
        point_in_time=False,
        survivorship_biased=False,
        note="SIC 2자리 대분류. GICS가 아니고 과거 재분류 이력이 없다",
    )
    load_earnings_csv(connection, earnings_csv(earnings_rows), source, source_version)
    load_securities_csv(connection, securities_csv(sectors), source, source_version)
    gaps = [
        item
        for item in coverage
        if window_start is not None and not item.covers(window_start)
    ]
    return {
        "tickers": len(tickers),
        "missing": missing,
        "earnings_rows": len(earnings_rows),
        "sectors": len(sectors),
        "calls": edgar.calls,
        "coverage": coverage,
        "gaps": gaps,
    }
