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

## 유니버스 규모에서는 `company_tickers.json` 하나로 모자란다

907종목으로 돌리자 **223종목이 CIK를 못 찾았다.** 그 파일은 10,398개뿐이고 폐지 종목은
물론 `AEP`·`CMA`·`K`·`HES` 같은 현재 대형주도 없다. `company_tickers_exchange.json`도 같은
10,398개라 소스를 바꿔서 풀리지 않는다.

**이게 조용한 사고인 이유는 실적·섹터 게이트가 fail-close라서다.** 못 찾은 종목은 영영
진입 대상이 되지 않고, 그 목록이 폐지 종목 쪽으로 크게 기울어 있다. 즉 가격 데이터에서
막아낸 생존편향이 실적 게이트를 통해 되돌아온다. 그래서 세 층을 쌓았다.

1. `company_tickers.json` — 현재 등록인의 티커 (684/907)
2. `browse-edgar?CIK=<티커>` — 그 파일에 없는 현재 등록인 (+58)
3. **당시 회사 이름** → `cik-lookup-data.txt`(105만 행, 지금까지의 모든 등록인) → 제출
   이력으로 검증

3층의 이름은 위키 지수 변경 표에서 온다. 벤더 심볼 목록의 이름은 티커의 **현재** 주인을
가리켜서 못 쓴다 — `EMC`가 "Global X Emerging Markets Great Consumer ETF"로 온다.

**하나로 좁혀지지 않으면 고르지 않는다.** `LEHMAN BROTHERS HOLDINGS`는 이름만으로 신탁
법인과 지주회사가 갈리지 않아서, 검증을 거쳐도 후보가 둘 남는다. 그런 것은 `ambiguous`로
돌려주고 사람이 `CIK_OVERRIDES`에 근거와 함께 넣는다.
"""

from __future__ import annotations

import datetime as dt
import json
import re
import sqlite3
import statistics
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass

from .data import load_earnings_csv, load_securities_csv, register_source

# SEC 공정접근 정책은 연락처가 있는 User-Agent와 초당 10회 이하를 요구한다.
DEFAULT_CONTACT = "chanyongs2005@gmail.com"
REQUEST_INTERVAL_SECONDS = 0.15

TICKER_MAP_URL = "https://www.sec.gov/files/company_tickers.json"
SUBMISSIONS_URL = "https://data.sec.gov/submissions/CIK{cik}.json"
ARCHIVE_URL = "https://data.sec.gov/submissions/{name}"
COMPLETE_SUBMISSION_URL = (
    "https://www.sec.gov/Archives/edgar/data/{cik}/{accession_compact}/{accession}.txt"
)

EARNINGS_ITEM = "2.02"

# 티커가 이력 없는 신설 법인으로 옮겨간 경우의 수동 고정. 발견 근거를 함께 남긴다.
# XOM: company_tickers.json은 CIK 2115436(ExxonMobil Holdings Corp, 2026-07 이후 제출
# 28건)을 주지만 실적 이력 125건은 CIK 34088(EXXON MOBIL CORP)에 있다. 2026-08-06 확인.
CIK_OVERRIDES = {
    "XOM": "0000034088",
    # 이름으로는 자회사와 지주회사가 안 갈린다. `LEHMAN BROTHERS INC//`(0000728586,
    # 옛 이름 `SHEARSON LEHMAN BROTHERS INC`)는 브로커딜러 자회사이고 구간 안의 실적
    # 제출이 0건이다. 지수 구성원은 `LEHMAN BROTHERS HOLDINGS INC`이고, 그 등록인이
    # 파산 후 `LEHMAN BROTHERS HOLDINGS INC. PLAN TRUST`로 개명해 옛 이름에 남아 있다.
    "LEH": "0000806085",
    # 아래는 2026-08-09에 손으로 확인했다. 전부 지수를 떠난 회사라 자동 경로가 못 찾았고,
    # **빠지면 정확히 생존편향이다.** 후보는 SEC 회사 검색으로 찾고 두 가지로 확인했다 —
    # `formerNames`의 날짜로 **그 멤버십 구간 동안** 그 CIK가 쓰던 이름, 그리고 구간 안의
    # Item 2.02 제출 건수. 주석의 이름이 그 구간의 이름이다.
    # `sic`이 비어 자동 검증을 통과하지 못한다. 구간 이름이 `AMERICAN CAPITAL STRATEGIES
    # LTD`이고 Item 2.02가 5건이다. 검색 후보로 나오는 `AGNC Investment`는 이 회사가
    # 운용하던 다른 회사라 쓰지 않는다.
    "ACAS": "0000817473",   # AMERICAN CAPITAL STRATEGIES LTD → AMERICAN CAPITAL, LTD
    "AET": "0001122304",    # AETNA INC /PA/
    "AKS": "0000918160",    # AK STEEL HOLDING CORP (현 Cleveland-Cliffs Steel Holding)
    "BCR": "0000009892",    # BARD C R INC /NJ/
    "CCE": "0001491675",    # COCA-COLA ENTERPRISES, INC.
    "CELG": "0000816284",   # CELGENE CORP /DE/
    "CMCSK": "0001166691",  # COMCAST CORP (K주는 같은 등록인이다)
    "CVC": "0001053112",    # CABLEVISION SYSTEMS CORP /NY (CSC Holdings는 자회사다)
    "DAY": "0001725057",    # Ceridian HCM Holding → Dayforce
    "DISCA": "0001437107",  # Discovery Communications → Warner Bros. Discovery
    "DWDP": "0001666700",   # DowDuPont Inc. → DuPont de Nemours
    "ETFC": "0001015780",   # E TRADE FINANCIAL CORP
    "FDO": "0000034408",    # FAMILY DOLLAR STORES INC
    "FII": "0001056288",    # FEDERATED INVESTORS INC /PA/ (현 Federated Hermes)
    "FNM": "0000310522",    # FEDERAL NATIONAL MORTGAGE ASSOCIATION
    "HAR": "0000800459",    # HARMAN INTERNATIONAL INDUSTRIES INC /DE/
    "HNZ": "0000046640",    # HEINZ H J CO (현 Kraft Heinz Foods)
    "HOT": "0000316206",    # STARWOOD HOTEL & RESORTS WORLDWIDE INC
    "JCP": "0001166126",    # J C PENNEY CO INC (0000077182은 실적을 내지 않는 자회사다)
    "JDSU": "0000912093",   # JDS UNIPHASE CORP /CA/ (현 Viavi Solutions)
    "KRFT": "0001545158",   # Kraft Foods Group, Inc. (Mondelez는 나뉜 반대쪽이다)
    "LLTC": "0000791907",   # LINEAR TECHNOLOGY CORP /CA/
    "LO": "0001424847",     # LORILLARD, INC.
    "LXK": "0001001288",    # LEXMARK INTERNATIONAL INC /KY/
    "MIL": "0000066479",    # MILLIPORE CORP /MA
    # 검색 1순위인 `0000067686`은 **옛** Monsanto(현 Pharmacia)라 쓰지 않는다.
    "MON": "0001110783",    # MONSANTO CO /NEW/
    "NFX": "0000912750",    # NEWFIELD EXPLORATION CO /DE/
    "RRD": "0000029669",    # RR Donnelley & Sons Co
    "STRZA": "0001507934",  # Starz
    "TSS": "0000721683",    # TOTAL SYSTEM SERVICES INC
    # 검색이 자산유동화 특수목적법인만 돌려준다. 지수 구성원은 지주회사다.
    "WB": "0000036995",     # WACHOVIA CORP NEW
    "WCG": "0001279363",    # WELLCARE HEALTH PLANS, INC.
    "WIN": "0001282266",    # WINDSTREAM CORP → WINDSTREAM HOLDINGS
    # Altaba는 펀드로 전환해 `sic`이 비었고 그래서 자동 검증을 통과하지 못한다. 명시
    # 지정은 그 검사를 거치지 않으며, 구간 이름이 `YAHOO INC`이고 Item 2.02가 69건이다.
    "YHOO": "0001011006",   # YAHOO INC → ALTABA INC.
    # 아래 둘은 **한 구간 안에서 회사가 바뀌어** 어느 CIK도 구간 전체를 덮지 못한다.
    # 구간 시작을 덮는 쪽을 골랐고 나머지 절반은 실적을 모른 채로 남는다(fail-close).
    "AGN": "0000850693",    # ALLERGAN INC. 2015-03-23부터의 Allergan plc(0001578845)는 빠진다
    "GAS": "0000072020",    # NICOR INC. 2011-12-12부터의 AGL Resources(0001004155)는 빠진다
}

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

    def _read(self, url: str) -> bytes:
        wait = self.interval - (time.monotonic() - self._last_call)
        if wait > 0:
            time.sleep(wait)
        request = urllib.request.Request(url, headers={"User-Agent": self.user_agent})
        self.calls += 1
        try:
            with urllib.request.urlopen(request, timeout=180) as response:
                return response.read()
        except urllib.error.HTTPError as error:
            raise EdgarError(f"HTTP {error.code}: {url}") from error
        finally:
            self._last_call = time.monotonic()

    def _get(self, url: str) -> object:
        return json.loads(self._read(url))

    def text(self, url: str) -> str:
        """JSON이 아닌 응답. `browse-edgar`의 atom이 이쪽이다."""
        # 이름 덤프에 latin-1 바이트가 섞여 있어 utf-8로는 읽히지 않는다.
        return self._read(url).decode("latin-1")

    def cik_lookup(self) -> "CikNameIndex":
        """이름 → CIK 색인. 40MB 한 번이고 캐시하지 않는다(실행당 1회 쓴다)."""
        return parse_cik_lookup(self.text(CIK_LOOKUP_URL))

    def ticker_map(self) -> dict[str, Company]:
        return parse_ticker_map(self._get(TICKER_MAP_URL))

    def submissions(self, cik: str) -> dict:
        payload = self._get(SUBMISSIONS_URL.format(cik=cik))
        if not isinstance(payload, dict):
            raise EdgarError(f"submissions 응답이 객체가 아닙니다: {cik}")
        return payload

    def submissions_archive(self, name: str) -> dict:
        """`filings.files`가 가리키는 과거 submissions JSON 하나."""
        payload = self._get(ARCHIVE_URL.format(name=name))
        if not isinstance(payload, dict):
            raise EdgarError(f"submissions archive 응답이 객체가 아닙니다: {name}")
        return payload

    def complete_submission_text(self, cik: str, accession: str) -> str:
        """filing-time SEC header가 든 complete submission 원문."""
        return self.text(complete_submission_url(cik, accession))

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


def complete_submission_url(cik: str, accession: str) -> str:
    """SEC Archives complete submission URL을 결정론적으로 만든다."""
    normalized_cik = str(cik).strip()
    if not normalized_cik.isdigit():
        raise EdgarError(f"complete submission CIK가 숫자가 아닙니다: {cik!r}")
    normalized_accession = str(accession).strip()
    if not re.fullmatch(r"\d{10}-\d{2}-\d{6}", normalized_accession):
        raise EdgarError(
            f"complete submission accession 형식이 잘못됐습니다: {accession!r}"
        )
    return COMPLETE_SUBMISSION_URL.format(
        cik=str(int(normalized_cik)),
        accession_compact=normalized_accession.replace("-", ""),
        accession=normalized_accession,
    )


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


# --------------------------------------------------------------------------
# 티커→CIK 2·3층. `company_tickers.json`이 유니버스 규모에서 모자라서 만들었다.
# --------------------------------------------------------------------------

BROWSE_URL = (
    "https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK={ticker}"
    "&type=8-K&dateb=&owner=include&count=1&output=atom"
)
CIK_LOOKUP_URL = "https://www.sec.gov/Archives/edgar/cik-lookup-data.txt"

# 법인 형태. 위키는 `Genzyme`, SEC는 `GENZYME CORP`로 적어서 이것을 지우지 않으면
# 거의 아무것도 안 맞는다. 회사를 가리키는 말이 아니라 등기 형태라 지워도 안전하다.
_LEGAL_FORM = (
    r"\b(INC|CORP|CORPORATION|COMPANY|CO|LTD|LIMITED|LLC|LP|PLC|NV|SA|AG|THE)\b"
)
# 서술어. 이것까지 지우면 매칭은 늘지만 **다른 회사가 합쳐진다** — `RAYTHEON TECHNOLOGIES`
# (현 RTX)와 `RAYTHEON CO`가 같은 키가 돼 후보에 섞였다. 그래서 기본이 아니라 폴백이다.
_DESCRIPTIVE = (
    r"\b(HOLDINGS?|GROUP|SYSTEMS|TECHNOLOGIES|TECHNOLOGY|INTERNATIONAL|"
    r"INDUSTRIES|ENTERPRISES|USA|US|NEW)\b"
)


def normalize_company_name(name: str, *, drop_descriptive: bool = False) -> str:
    """이름 대조용 정규형. 대소문자·구두점·법인 형태를 지운다."""
    text = re.sub(r"[^A-Z0-9 ]", " ", name.upper())
    text = re.sub(_LEGAL_FORM, " ", text)
    if drop_descriptive:
        text = re.sub(_DESCRIPTIVE, " ", text)
    return re.sub(r"\s+", " ", text).strip()


@dataclass(frozen=True)
class CikNameIndex:
    """이름 → CIK 색인 두 벌. **엄격한 쪽을 먼저 보고 빈손일 때만 느슨한 쪽을 본다.**

    한 벌만 두면 어느 쪽으로도 진다. 엄격하면 `Lehman Brothers`(위키)가
    `LEHMAN BROTHERS HOLDINGS INC`(SEC)를 못 찾고, 느슨하면 `Raytheon`이 RTX까지 끌어온다.
    """

    strict: dict[str, set[str]]
    loose: dict[str, set[str]]

    def candidates(self, name: str) -> list[str]:
        hit = self.strict.get(normalize_company_name(name))
        if not hit:
            hit = self.loose.get(normalize_company_name(name, drop_descriptive=True))
        return sorted(hit or ())


def parse_cik_lookup(text: str) -> CikNameIndex:
    """`cik-lookup-data.txt`를 이름 색인으로 바꾼다.

    한 줄이 `회사이름:CIK:`이고 105만 행이다. **현재 등록인만 담는 `company_tickers.json`과
    달리 지금까지 등록한 모든 법인이 들어 있어** 폐지 회사를 여기서 찾을 수 있다.
    """
    strict: dict[str, set[str]] = {}
    loose: dict[str, set[str]] = {}
    for line in text.splitlines():
        parts = line.rsplit(":", 2)
        if len(parts) != 3 or not parts[1].isdigit():
            continue
        cik = parts[1].zfill(10)
        key = normalize_company_name(parts[0])
        if key:
            strict.setdefault(key, set()).add(cik)
        key = normalize_company_name(parts[0], drop_descriptive=True)
        if key:
            loose.setdefault(key, set()).add(cik)
    if not strict:
        raise EdgarError("CIK 이름 색인이 비어 있습니다.")
    return CikNameIndex(strict=strict, loose=loose)


@dataclass(frozen=True)
class CikCandidate:
    """이름으로 찾은 CIK 후보와 그것을 받아들일지 가른 근거."""

    cik: str
    name: str
    sic: str
    first_filing: str | None
    last_filing: str | None
    files_8k: bool

    def overlaps(self, start: str, end: str) -> bool:
        if self.first_filing is None or self.last_filing is None:
            return False
        return self.first_filing <= end and self.last_filing >= start

    def accepts(self, start: str, end: str) -> bool:
        """**셋을 다 만족해야 받는다.**

        제출 이력이 멤버십 구간과 겹치지 않으면 다른 시대의 동명 법인이고, 8-K를 낸 적이
        없으면 상장 발행사가 아니며(신탁·자회사·특수목적법인), SIC가 없으면 사업 등록이
        아니다. 실측에서 `Novellus Systems` 후보 4개가 이 검사로 1개가 됐다.
        """
        return bool(self.sic) and self.files_8k and self.overlaps(start, end)


def candidate_from_submissions(cik: str, payload: dict) -> CikCandidate:
    recent = (payload.get("filings") or {}).get("recent") or {}
    dates = [str(value) for value in (recent.get("filingDate") or []) if value]
    forms = {str(value) for value in (recent.get("form") or [])}
    files = (payload.get("filings") or {}).get("files") or []
    first = min(dates) if dates else None
    # 아카이브가 있으면 최초 제출은 그쪽에 있다. 메타데이터만 보고 호출하지 않는다.
    for meta in files:
        stamp = str(meta.get("filingFrom") or "")
        if stamp and (first is None or stamp < first):
            first = stamp
    return CikCandidate(
        cik=str(cik).zfill(10),
        name=str(payload.get("name") or ""),
        sic=str(payload.get("sic") or ""),
        first_filing=first,
        last_filing=max(dates) if dates else None,
        files_8k=any(form.startswith("8-K") for form in forms),
    )


def resolve_by_browse(client: "EdgarClient", ticker: str) -> str | None:
    """2층. `browse-edgar`가 `company_tickers.json`에 없는 **현재** 등록인을 푼다.

    실측에서 223개 중 58개가 여기서 풀렸다(`AEP`·`CMA`·`K`·`HES` 등). 폐지 종목은 못 푼다.
    """
    body = client.text(BROWSE_URL.format(ticker=urllib.parse.quote(ticker)))
    found = re.search(r"<cik>(\d+)</cik>", body)
    return found.group(1).zfill(10) if found else None


def names_in_window(payload: dict, span: tuple[str, str]) -> list[str]:
    """그 구간 동안 이 등록인이 쓰던 이름들.

    `formerNames`가 `from`·`to`를 들고 있어서 **이름을 시점으로 물을 수 있다.** 현재
    이름은 마지막 옛 이름이 끝난 뒤부터 쓴 것으로 본다.
    """
    start, end = span
    spans: list[tuple[str, str | None, str]] = []
    latest = ""
    for former in payload.get("formerNames") or []:
        name = str(former.get("name") or "")
        since = str(former.get("from") or "")[:10]
        until = str(former.get("to") or "")[:10]
        if name:
            spans.append((since, until or None, name))
            latest = max(latest, until)
    spans.append((latest, None, str(payload.get("name") or "")))
    return [
        name
        for since, until, name in spans
        if name and since <= end and (until is None or until >= start)
    ]


def name_held_in_window(payload: dict, name: str, span: tuple[str, str]) -> bool:
    """**그 구간에 이 등록인이 그 이름이었는가.**

    이 검사가 없으면 이름이 언젠가 스쳤다는 이유로 엉뚱한 시대의 법인을 고른다. 실측:
    `DNB`(Dun & Bradstreet)의 후보 `0000030419`는 1994~1998에만 `DUN & BRADSTREET CORP`
    였고 2008년 구간에는 `R H DONNELLEY CORP`였다. `ADT`의 후보 `0000833444`도 `ADT
    LIMITED`는 1995~1997뿐이고 2012년 구간에는 `TYCO INTERNATIONAL LTD`였다. 둘 다
    이름·SIC·제출이력·승계로는 통과하고 이 검사에만 걸린다.
    """
    strict = normalize_company_name(name)
    loose = normalize_company_name(name, drop_descriptive=True)
    for value in names_in_window(payload, span):
        if normalize_company_name(value) == strict:
            return True
        if loose and normalize_company_name(value, drop_descriptive=True) == loose:
            return True
    return False


def earnings_filings_in_span(
    client: "EdgarClient", cik: str, span: tuple[str, str]
) -> int:
    """구간 안의 Item 2.02 제출 건수. 후보를 가르는 마지막 증거다.

    **지주회사·중간 법인·신탁은 분기 실적 8-K를 내지 않는다.** `LEHMAN BROTHERS INC//`
    (브로커딜러 자회사)와 `LEHMAN BROTHERS HOLDINGS INC`(지수 구성원)는 이름으로도 SIC로도
    안 갈리지만 실적 제출로는 갈린다. 우리가 어차피 모으는 데이터라 새 소스가 필요 없다.
    """
    start, end = span
    try:
        dates, _ = client.all_earnings_dates(cik, start)
    except EdgarError:
        return 0
    return sum(1 for date in dates if start <= date <= end)


def resolve_by_name(
    client: "EdgarClient",
    name: str,
    index: CikNameIndex,
    *,
    span: tuple[str, str],
    max_candidates: int = 8,
) -> tuple[str | None, list[CikCandidate]]:
    """3층. 당시 회사 이름으로 찾고 제출 이력으로 검증한다.

    **하나로 좁혀지지 않으면 고르지 않는다.** 살아남은 후보를 그대로 돌려주므로 호출자가
    목록을 보고 `CIK_OVERRIDES`에 근거와 함께 넣을 수 있다. 조용히 첫 번째를 고르면
    `LEHMAN BROTHERS HOLDINGS`의 첫 매치가 신탁 법인(`0001382976`)인 것 같은 사고가 난다.

    후보가 둘 이상 남으면 구간 안의 실적 제출 건수를 센다. **실적을 낸 후보가 정확히
    하나일 때만 고른다** — 둘 다 실제 발행사면 어느 쪽이 지수 구성원이었는지는 제출
    기록으로 알 수 없고, 그건 사람이 판단할 일이다.
    """
    ciks = index.candidates(name)
    if not ciks or len(ciks) > max_candidates:
        return None, []
    survivors: list[CikCandidate] = []
    for cik in ciks:
        try:
            payload = client.submissions(cik)
        except EdgarError:
            continue
        candidate = candidate_from_submissions(cik, payload)
        if candidate.accepts(*span) and name_held_in_window(payload, name, span):
            survivors.append(candidate)
    if not survivors:
        return None, []
    # **후보가 하나뿐이어도 실적 제출은 확인한다.** 이 검사를 건너뛰었더니 `LEH`가
    # `LEHMAN BROTHERS INC//`(브로커딜러 자회사, 구간 내 실적 0건)로 갔다. 지수 구성원은
    # 실적을 발표하는 상장 발행사이므로, 구간 안에 실적이 하나도 없는 후보는 그 자리의
    # 회사가 아니다.
    filers = [
        item for item in survivors if earnings_filings_in_span(client, item.cik, span)
    ]
    if len(filers) == 1:
        return filers[0].cik, survivors
    return None, survivors


# 선행 법인의 마지막 실적과 후속 법인의 첫 실적이 이만큼 넘게 겹치면 승계가 아니다.
# 둘이 오래 나란히 실적을 내면 개명·재편이 아니라 서로 다른 회사다. 실측: `MPC`의 후보
# `MARATHON OIL CORP`는 MPC가 분사한 2011년 뒤로도 13년을 더 냈다.
SUCCESSION_OVERLAP_DAYS = 400


def find_predecessor(
    client: "EdgarClient",
    name: str,
    index: CikNameIndex,
    *,
    span: tuple[str, str],
    successor_cik: str,
    successor_first: str | None,
) -> str | None:
    """구간 앞부분을 채울 **선행 등록인**. 없으면 None이다.

    1층은 티커로 현재 CIK를 주는데, 회사가 지주회사로 재편되면 그 CIK에 과거 제출이 없다
    (`XOM`·`GOOGL`·`DIS`·`MDT`…). 그러면 그 종목은 구간 앞부분 내내 `EARNINGS_UNKNOWN`으로
    빠진다. 1층이 준 CIK는 티커 기반이라 믿을 만하므로 **버리지 않고 선행분을 합친다.**

    받아들이는 조건이 `resolve_by_name`보다 하나 더 있다 — 선행이 후속 시작 뒤로도 오래
    제출하면 승계가 아니라 별개 회사다.
    """
    cik, _ = resolve_by_name(client, name, index, span=span)
    if cik is None or cik == successor_cik:
        return None
    if successor_first is None:
        return cik
    dates, _ = client.all_earnings_dates(cik, span[0])
    if not dates:
        return None
    overlap = (
        dt.date.fromisoformat(max(dates)) - dt.date.fromisoformat(successor_first)
    ).days
    return cik if overlap <= SUCCESSION_OVERLAP_DAYS else None


def collect(
    connection: sqlite3.Connection,
    tickers: list[str],
    source_version: str,
    *,
    client: EdgarClient | None = None,
    source: str = "sec-edgar",
    window_start: str | None = None,
    overrides: dict[str, str] | None = None,
    security_names: dict[str, str] | None = None,
    spans: dict[str, tuple[str, str]] | None = None,
) -> dict[str, object]:
    """티커 목록의 실적일과 섹터를 모아 저장소에 넣는다.

    EDGAR는 공공 자료이므로 생존편향과 무관하고 point-in-time이다. 실적일은 제출일이
    그대로 발표일이고, 섹터는 현재 SIC라 과거 재분류 이력이 없다.

    `window_start`를 주면 그 구간을 덮지 못하는 종목을 `gaps`로 돌려준다. **그 목록을
    보지 않고 다음 단계로 넘어가면 재편된 회사가 조용히 유니버스에서 빠진다.**

    `security_names`(티커 → 당시 회사 이름)와 `spans`(티커 → 멤버십 구간)를 주면 3층까지
    쓴다. 주지 않으면 1층만 돌던 예전 동작 그대로다. **못 푼 티커는 조용히 빠지는 게 아니라
    `missing`·`ambiguous`로 돌아온다** — 그것들이 폐지 종목 쪽으로 기울어 있어서, 놓치면
    가격에서 막은 생존편향이 실적 게이트로 되돌아온다.
    """
    edgar = client or EdgarClient()
    companies = edgar.ticker_map()
    index: CikNameIndex | None = None

    earnings_rows: list[dict[str, str]] = []
    sectors: dict[str, str] = {}
    missing: list[str] = []
    ambiguous: dict[str, list[CikCandidate]] = {}
    resolved_by: dict[str, str] = {}
    coverage: list[Coverage] = []
    for ticker in sorted({value.strip().upper() for value in tickers}):
        cik, pinned = resolve_cik(ticker, companies, overrides)
        if cik is None:
            cik = resolve_by_browse(edgar, ticker)
            if cik:
                resolved_by[ticker] = "browse"
        if cik is None and security_names and spans and ticker in spans:
            if index is None:
                index = edgar.cik_lookup()
            cik, survivors = resolve_by_name(
                edgar, security_names.get(ticker, ""), index, span=spans[ticker]
            )
            if cik:
                resolved_by[ticker] = "name"
            elif survivors:
                ambiguous[ticker] = survivors
        if cik is None:
            missing.append(ticker)
            continue
        dates, payload = edgar.all_earnings_dates(cik, window_start)
        # 구간 앞부분이 비면 선행 등록인을 찾아 **합친다**(바꾸지 않는다). 1층이 준 CIK는
        # 티커 기반이라 뒷부분은 그쪽이 맞다.
        floor = (spans or {}).get(ticker, (None, None))[0]
        if floor and security_names and (not dates or min(dates) > floor):
            if index is None:
                index = edgar.cik_lookup()
            earlier = find_predecessor(
                edgar,
                security_names.get(ticker, ""),
                index,
                span=spans[ticker],
                successor_cik=cik,
                successor_first=min(dates) if dates else None,
            )
            if earlier:
                extra, _ = edgar.all_earnings_dates(earlier, floor)
                if extra:
                    dates = sorted(set(dates) | set(extra))
                    resolved_by[ticker] = "predecessor"
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
    # 커버리지는 **그 종목이 구성원이 된 날**을 기준으로 잰다. 전역 시작일과 견주면
    # 2008년 이후 상장한 회사가 전부 미달로 잡혀(907종목에서 245개) 진짜 구멍이 묻힌다.
    # 지수에 들어가기 전의 실적일은 애초에 필요하지 않다.
    gaps = [
        item
        for item in coverage
        if (floor := (spans or {}).get(item.symbol, (window_start, ""))[0]) is not None
        and not item.covers(floor)
    ]
    return {
        "tickers": len(tickers),
        "missing": missing,
        "ambiguous": ambiguous,
        "resolved_by": resolved_by,
        "earnings_rows": len(earnings_rows),
        "sectors": len(sectors),
        "calls": edgar.calls,
        "coverage": coverage,
        "gaps": gaps,
    }
