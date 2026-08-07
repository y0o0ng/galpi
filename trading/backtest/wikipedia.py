"""지수 변경 공고 아카이브를 모아 `membership.py`의 입력 CSV를 만든다.

12.4가 지시한 경로다. "Point-in-time 지수 구성원 | 상용 데이터는 고가 | 지수 변경 공고
아카이브로 자체 구축". 공개 자료라 **삭제 의무가 없다** — 빌리는 것은 가격뿐이다.

## 왜 위키백과인가

원 자료는 S&P Dow Jones Indices와 Nasdaq의 보도자료다. 그런데 그것은 수백 개의 PDF로
흩어져 있고 목록이 따로 없다. 위키백과의 두 표는 **그 PDF들을 행마다 인용한 색인**이다.

|지수|페이지|표 `id`|
|---|---|---|
|S&P 500|`List of S&P 500 companies`|`constituents`·`changes`|
|Nasdaq-100|`List of NASDAQ-100 companies`|`constituents`·`changes`|

위키백과는 2차 자료이므로 그대로 믿지 않는다. 두 가지로 받는다.

1. **행마다 원 공고를 확인할 수 있다.** 변경 이력 CSV가 한 줄에 한 변경이라(설계의 CSV
   계약) 의심스러운 행만 골라 인용된 PDF로 대조할 수 있다.
2. **구성원 수 불변식이 마지막 그물이다.** S&P 500의 표 제목은 문자 그대로 "Selected
   changes"라 완전성이 보장되지 않는다. 편출 기록이 빠지면 과거로 갈수록 구성원이 늘어나고
   (생존편향의 모양) `membership.count_violations`가 그것을 잡는다. Nasdaq-100은 허용
   오차가 ±1이라 한 쌍만 빠져도 걸린다.

**판정은 이 모듈이 하지 않는다.** 여기서는 CSV를 만들 뿐이고, 신뢰할 수 있는지는
`membership.load_universe`가 불변식으로 판정한다. 위반이 있으면 적재가 거부된다.

## 티커 변경은 이 표에 없다

S&P 표의 편집 지침이 못박는다. "Company name changes and ticker changes are not changes
to the index and should not be in this table." 그래서 이름만 바뀐 회사는 현재 티커로
이어지지만, **옛 티커로 편출된 종목은 벤더 심볼과 어긋날 수 있다.**
`eodhd.missing_universe_symbols`가 그것을 잡는 자리다.

## 파싱은 순수 함수다

취득(`WikipediaClient`)과 파싱을 나눈다. 파싱은 wikitext 문자열만 받으므로 픽스처로
테스트할 수 있고, 표 서식이 바뀌면 테스트가 먼저 깨진다.

wikitext 표에는 함정이 셋 있다.

- `<ref>` 안의 `{{cite web |url=...}}`에 파이프가 들어 있어 셀을 먼저 나누면 깨진다.
  참조를 **먼저** 걷어낸다.
- 티커 셀이 `{{NyseSymbol|ZTS}}` 같은 템플릿이다(S&P 표에서 502건).
- S&P 표는 한 줄에 `||`로 이어 쓰고 Nasdaq 표는 셀마다 줄을 바꾼다. 둘 다 받아야 한다.
"""

from __future__ import annotations

import csv
import io
import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import date

WIKI_API = "https://en.wikipedia.org/w/api.php"
# SEC와 같은 예의다. 누가 얼마나 부르는지 밝힌다.
USER_AGENT = "galpi-backtest/0.1 (research; contact via repository)"
REQUEST_INTERVAL_SECONDS = 1.0

PAGES = {
    "SP500": "List of S&P 500 companies",
    "NDX100": "List of NASDAQ-100 companies",
}
MEMBERS_TABLE_ID = "constituents"
CHANGES_TABLE_ID = "changes"

MONTHS = {
    "january": 1, "february": 2, "march": 3, "april": 4, "may": 5, "june": 6,
    "july": 7, "august": 8, "september": 9, "october": 10, "november": 11,
    "december": 12,
}

# 구성원 표에서 티커 열을 찾는 이름. 두 페이지가 서로 다른 말을 쓴다.
SYMBOL_HEADERS = ("symbol", "ticker")


@dataclass(frozen=True)
class Rename:
    """옛 티커를 현재 벤더 티커로 옮기는 규칙. `edgar.CIK_OVERRIDES`와 같은 자리다.

    `before`보다 **이전** 날짜의 행에만 적용한다. 날짜가 필요한 이유는 티커 재사용
    때문이다. `IR`은 2020-03-02 이전에는 잉거솔랜드(현 `TT`)지만 그날부터는 가드너덴버가
    이어받은 다른 회사다. 날짜 없이 통짜로 걸면 뒤엣것까지 덮어쓴다.
    """

    index_name: str
    old: str
    before: str
    new: str
    evidence: str


# 위키 표의 편집 지침이 "Company name changes and ticker changes are not changes to the
# index and should not be in this table"라고 못박는다. 그래서 개명은 표에 없고, 그대로
# 두면 **개명한 회사가 유니버스에서 조용히 빠진다.** 편입 기록만 있고 편출이 없는데 현재
# 구성원도 아닌 티커가 그 신호다.
#
# 근거는 위키백과 문서의 infobox `former_name`·`traded_as`·`predecessor`에서 확인했다.
SYMBOL_RENAMES = (
    Rename("SP500", "FB", "2022-06-09", "META",
           "Meta Platforms traded_as {{NASDAQ|META}}, 옛 이름 Facebook"),
    Rename("SP500", "PCLN", "2018-02-27", "BKNG",
           "Booking Holdings former_name 'Priceline.com Incorporated (1998–2014)'"),
    Rename("SP500", "KORS", "2019-01-02", "CPRI",
           "Capri Holdings former_name 'Michael Kors Holdings Limited', traded_as NYSE|CPRI"),
    Rename("SP500", "DLPH", "2017-12-05", "APTV",
           "Aptiv former_name 'Delphi Automotive plc (2011–2017)', traded_as NYSE|APTV"),
    Rename("SP500", "HRS", "2019-07-01", "LHX",
           "L3Harris는 2019-06-29 L3와 Harris 합병으로 만들어졌고 traded_as NYSE|LHX"),
    Rename("SP500", "COG", "2021-10-01", "CTRA",
           "Coterra predecessors 'Cabot Oil & Gas Corporation, Cimarex Energy'"),
    Rename("SP500", "SATS", "2026-08-07", "ECHO",
           "EchoStar traded_as {{NASDAQ|ECHO}}, 현재 S&P 500 구성원 티커가 ECHO"),
    Rename("SP500", "IR", "2020-03-02", "TT",
           "Trane Technologies: 2020년 공구 사업을 Ingersoll Rand로 분사하고 남은 회사가 개명"),
    Rename("SP500", "UA", "2016-04-08", "UAA",
           "2016-04-08 'Under Armour distribution of second class of stock'로 새 클래스가 UA를 받았다"),
    # JOYG는 직접 인용을 찾지 못했다. 표에 JOYG 편입(2011-02-25)과 JOY 편출(2015-10-07)만
    # 있고 다른 Joy Global 행이 없으며, Nasdaq-100 표가 "Joy Global transferred its listing
    # from NASDAQ to NYSE"를 적고 있다. **추론이고 불변식이 검증한다.**
    Rename("SP500", "JOYG", "2015-10-07", "JOY",
           "NASDAQ→NYSE 이전에 따른 티커 변경으로 추론(직접 인용 없음)"),
    Rename("NDX100", "KFT", "2012-10-02", "MDLZ",
           "S&P 표의 2012-10-02 행이 'Old Kraft Foods renamed Mondelez'라고 적는다"),
    Rename("NDX100", "PCLN", "2018-02-27", "BKNG",
           "Booking Holdings former_name 'Priceline.com Incorporated (1998–2014)'"),
    Rename("NDX100", "NWSA", "2013-06-28", "FOXA",
           "21st Century Fox predecessor 'News Corporation', traded_as FOXA (Class A, 2013–2019)"),
)

# 표에 없는 지수 사건. **여기에 넣는 행은 공고가 아니라 우리의 해석이므로 근거를 적는다.**
CORRECTIONS = (
    (
        "2015-03-23", "SP500", "add", "AGN",
        "옛 Allergan, Inc.가 이날 편출되고 Actavis plc가 Allergan plc로 개명하며 같은 AGN"
        " 티커를 이어받았다(Allergan plc predecessors: 'Allergan, Inc. and Actavis')."
        " 두 실체를 심볼 공간에서 가를 수 없어 같은 날 이어지는 것으로 본다.",
    ),
)


class WikipediaError(Exception):
    """표를 우리 계약대로 읽을 수 없을 때 올린다."""


# --------------------------------------------------------------------------
# wikitext 파싱 — 순수 함수
# --------------------------------------------------------------------------


def strip_annotations(text: str) -> str:
    """주석과 참조를 걷어낸다. 셀을 나누기 **전에** 해야 한다.

    `<ref>{{cite web |url=... |title=...}}</ref>`의 파이프가 셀 구분자로 읽히면 열이
    통째로 밀린다.
    """
    text = re.sub(r"<!--.*?-->", "", text, flags=re.S)
    text = re.sub(r"<ref[^>/]*/\s*>", "", text)
    text = re.sub(r"<ref[^>]*>.*?</ref>", "", text, flags=re.S)
    return text


def _split_top_level(text: str, separator: str) -> list[str]:
    """`{{...}}`와 `[[...]]` 안쪽을 건너뛰며 나눈다."""
    parts: list[str] = []
    depth = 0
    start = 0
    index = 0
    while index < len(text):
        pair = text[index : index + 2]
        if pair in ("{{", "[["):
            depth += 1
            index += 2
            continue
        if pair in ("}}", "]]"):
            depth = max(0, depth - 1)
            index += 2
            continue
        if depth == 0 and text.startswith(separator, index):
            parts.append(text[start:index])
            index += len(separator)
            start = index
            continue
        index += 1
    parts.append(text[start:])
    return parts


def clean_cell(text: str) -> str:
    """셀 하나를 사람이 읽는 값으로 만든다."""
    value = text.strip()
    # `| style="..." | 값` 형태의 셀 속성을 떼어낸다.
    pieces = _split_top_level(value, "|")
    if len(pieces) == 2 and re.search(r"\w+\s*=\s*[\"']", pieces[0]):
        value = pieces[1]
    # `{{NyseSymbol|ZTS}}` → `ZTS`. 템플릿의 마지막 인자를 쓴다.
    value = re.sub(
        r"\{\{[^{}|]*\|([^{}]*)\}\}",
        lambda match: match.group(1).split("|")[-1],
        value,
    )
    value = re.sub(r"\{\{[^{}]*\}\}", "", value)
    # `[[Alphabet Inc.|Alphabet]]` → `Alphabet`, `[[Zoetis]]` → `Zoetis`
    value = re.sub(r"\[\[([^\[\]|]*\|)?([^\[\]]*)\]\]", r"\2", value)
    value = re.sub(r"<[^>]+>", "", value)
    value = value.replace("'''", "").replace("''", "")
    return value.strip()


def parse_table(wikitext: str, table_id: str) -> tuple[list[str], list[list[str]]]:
    """`id="..."`가 붙은 wikitable의 헤더와 데이터 행을 준다."""
    text = strip_annotations(wikitext)
    opening = re.search(
        r"^\{\|[^\n]*id\s*=\s*[\"']?" + re.escape(table_id) + r"[\"']?[^\n]*$",
        text,
        re.M,
    )
    if opening is None:
        raise WikipediaError(f"id={table_id!r}인 표를 찾지 못했습니다.")
    body = text[opening.end() :]
    end = re.search(r"^\|\}", body, re.M)
    if end is None:
        raise WikipediaError(f"id={table_id!r} 표의 끝을 찾지 못했습니다.")
    body = body[: end.start()]

    header: list[str] = []
    rows: list[list[str]] = []
    # `{|` 바로 뒤에 `|-` 없이 헤더가 오는 표도 있다. 암묵적인 첫 행으로 연다.
    current: list[str] = []
    is_header = False
    for line in body.splitlines():
        stripped = line.strip()
        if stripped.startswith("|-"):
            if not is_header and current:
                rows.append(current)
            current = []
            is_header = False
            continue
        if stripped.startswith("!"):
            is_header = True
            # 헤더 셀은 `!!`로 나누는 것이 표준이지만 `||`을 쓴 표도 있다. 둘 다 받는다.
            header.extend(
                clean_cell(piece)
                for cell in _split_top_level(stripped[1:], "!!")
                for piece in _split_top_level(cell, "||")
            )
            continue
        if stripped.startswith("|"):
            current.extend(
                clean_cell(cell) for cell in _split_top_level(stripped[1:], "||")
            )
            continue
        # 셀이 여러 줄에 걸친 경우. 앞 셀에 이어 붙인다.
        if stripped and current:
            current[-1] = f"{current[-1]} {stripped}".strip()
    if not is_header and current:
        rows.append(current)
    return header, rows


def parse_date(text: str) -> str:
    """`August 5, 2026` → `2026-08-05`."""
    match = re.match(r"([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})", text.strip())
    if match is None:
        raise WikipediaError(f"효력일을 읽을 수 없습니다: {text!r}")
    month = MONTHS.get(match.group(1).lower())
    if month is None:
        raise WikipediaError(f"알 수 없는 달입니다: {text!r}")
    return date(int(match.group(3)), month, int(match.group(2))).isoformat()


def apply_renames(index_name: str, effective: str, symbol: str) -> str:
    """그 날짜의 티커를 현재 벤더 티커로 옮긴다."""
    for rename in SYMBOL_RENAMES:
        if (
            rename.index_name == index_name
            and rename.old == symbol
            and effective < rename.before
        ):
            return rename.new
    return symbol


def _symbol(text: str) -> str:
    """티커 셀. 클래스 표기의 점은 벤더 표기(`BRK-B`)에 맞춘다."""
    value = clean_cell(text).upper().strip()
    value = re.sub(r"\s+", "", value)
    return value.replace(".", "-")


def parse_members(wikitext: str, index_name: str) -> str:
    """현재 구성원 CSV(`membership.MEMBERS_CSV_COLUMNS`)."""
    header, rows = parse_table(wikitext, MEMBERS_TABLE_ID)
    column = next(
        (
            index
            for index, name in enumerate(header)
            if name.strip().lower() in SYMBOL_HEADERS
        ),
        None,
    )
    if column is None:
        raise WikipediaError(f"구성원 표에 티커 열이 없습니다: {header}")

    symbols: list[str] = []
    for row in rows:
        if column >= len(row):
            raise WikipediaError(f"구성원 행의 열이 모자랍니다: {row}")
        symbol = _symbol(row[column])
        if symbol:
            symbols.append(symbol)
    if len(symbols) != len(set(symbols)):
        raise WikipediaError(f"{index_name} 구성원 목록에 중복 티커가 있습니다.")

    buffer = io.StringIO()
    writer = csv.writer(buffer, lineterminator="\n")
    writer.writerow(("index_name", "symbol"))
    for symbol in sorted(symbols):
        writer.writerow((index_name, symbol))
    return buffer.getvalue()


def parse_changes(wikitext: str, index_name: str, *, since: str | None = None) -> str:
    """변경 이력 CSV(`membership.CHANGES_CSV_COLUMNS`).

    표는 `효력일 | 편입(티커, 종목) | 편출(티커, 종목) | 사유`다. 한 행이 편입과 편출을
    동시에 담으므로 두 줄로 쪼갠다. 한쪽만 있는 행(분사·상장폐지)도 그대로 받는다.
    """
    _, rows = parse_table(wikitext, CHANGES_TABLE_ID)
    emitted: list[tuple[str, str, str, str]] = []
    for row in rows:
        if len(row) < 5:
            raise WikipediaError(f"변경 이력 행의 열이 모자랍니다: {row}")
        effective = parse_date(row[0])
        if since is not None and effective < since:
            continue
        for action, cell in (("add", row[1]), ("remove", row[3])):
            symbol = _symbol(cell)
            if symbol:
                emitted.append(
                    (
                        effective,
                        index_name,
                        action,
                        apply_renames(index_name, effective, symbol),
                    )
                )
    emitted.extend(
        (date_, index, action, symbol)
        for date_, index, action, symbol, _ in CORRECTIONS
        if index == index_name and (since is None or date_ >= since)
    )
    if not emitted:
        raise WikipediaError(f"{index_name}의 변경 이력이 한 줄도 나오지 않았습니다.")

    buffer = io.StringIO()
    writer = csv.writer(buffer, lineterminator="\n")
    writer.writerow(("date", "index_name", "action", "symbol"))
    for record in sorted(set(emitted), reverse=True):
        writer.writerow(record)
    return buffer.getvalue()


# --------------------------------------------------------------------------
# 취득
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class Page:
    """받아온 문서 한 편. `revision`이 이 CSV가 어느 판에서 나왔는지 고정한다."""

    index_name: str
    title: str
    revision: int
    wikitext: str


class WikipediaClient:
    def __init__(self, interval: float = REQUEST_INTERVAL_SECONDS) -> None:
        self.interval = interval
        self._last_call = 0.0
        self.calls = 0

    def fetch(self, index_name: str) -> Page:
        title = PAGES[index_name]
        wait = self.interval - (time.monotonic() - self._last_call)
        if wait > 0:
            time.sleep(wait)
        url = f"{WIKI_API}?" + urllib.parse.urlencode(
            {
                "action": "parse",
                "page": title,
                "prop": "wikitext|revid",
                "format": "json",
                "formatversion": "2",
            }
        )
        request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        self.calls += 1
        try:
            with urllib.request.urlopen(request, timeout=120) as response:
                payload = json.load(response)
        except urllib.error.HTTPError as error:
            raise WikipediaError(f"HTTP {error.code} {title}") from error
        finally:
            self._last_call = time.monotonic()
        if "parse" not in payload:
            raise WikipediaError(f"{title} 응답에 parse가 없습니다: {payload}")
        return Page(
            index_name=index_name,
            title=title,
            revision=int(payload["parse"]["revid"]),
            wikitext=payload["parse"]["wikitext"],
        )


# CSV는 저장소에 커밋한다. 공개 자료라 **삭제 의무가 없고**, 어느 판에서 뽑았는지와 함께
# 남겨야 같은 결과를 다시 낼 수 있다. 가격만 빌린다는 원칙 그대로다.
UNIVERSE_DIR = "universe"
PROVENANCE_NAME = "SOURCES.md"


def build_csvs(
    index_names: tuple[str, ...] = tuple(PAGES),
    *,
    since: str,
    client: WikipediaClient | None = None,
) -> dict[str, object]:
    """두 지수의 구성원·변경 이력 CSV와 출처 기록을 만든다."""
    wikipedia = client or WikipediaClient()
    files: dict[str, str] = {}
    pages: list[Page] = []
    for index_name in index_names:
        page = wikipedia.fetch(index_name)
        pages.append(page)
        files[f"{index_name.lower()}-members.csv"] = parse_members(
            page.wikitext, index_name
        )
        files[f"{index_name.lower()}-changes.csv"] = parse_changes(
            page.wikitext, index_name, since=since
        )
    files[PROVENANCE_NAME] = _provenance(pages, since)
    return {"files": files, "pages": pages, "calls": wikipedia.calls}


def _provenance(pages: list[Page], since: str) -> str:
    """어느 문서의 어느 판에서 뽑았는지. 행마다 원 공고를 되짚는 출발점이다."""
    lines = [
        "# 구성원 CSV의 출처",
        "",
        f"`{since}` 이후의 변경만 담는다. 원 자료는 S&P Dow Jones Indices와 Nasdaq의",
        "보도자료이고, 아래 문서의 표가 그 보도자료를 행마다 인용하는 색인이다.",
        "",
        "|지수|문서|판(revision)|",
        "|---|---|---|",
    ]
    for page in pages:
        lines.append(
            f"|{page.index_name}|[{page.title}]"
            f"(https://en.wikipedia.org/wiki/Special:PermanentLink/{page.revision})"
            f"|{page.revision}|"
        )
    lines += [
        "",
        "## 표에 없어서 우리가 더한 것",
        "",
        "위키 표의 편집 지침이 티커 변경을 지수 변경으로 보지 않으므로 개명은 표에 없다.",
        "`wikipedia.SYMBOL_RENAMES`가 그것을 현재 벤더 티커로 옮기고, `CORRECTIONS`가",
        "표에 없는 사건을 근거와 함께 더한다. 두 목록 모두 항목마다 근거를 달았다.",
        "",
        "|지수|옛 티커|이 날짜 이전|현재 티커|근거|",
        "|---|---|---|---|---|",
    ]
    for rename in SYMBOL_RENAMES:
        lines.append(
            f"|{rename.index_name}|{rename.old}|{rename.before}|{rename.new}"
            f"|{rename.evidence}|"
        )
    lines += ["", "|지수|날짜|동작|심볼|근거|", "|---|---|---|---|---|"]
    for date_, index, action, symbol, evidence in CORRECTIONS:
        lines.append(f"|{index}|{date_}|{action}|{symbol}|{evidence}|")
    return "\n".join(lines) + "\n"
