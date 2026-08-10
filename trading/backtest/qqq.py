"""QQQ 보유종목에서 Nasdaq-100의 과거 구성원 스냅샷을 만든다.

## 왜 위키가 아니라 EDGAR인가

SP500은 위키 문서의 과거 판에서 구성원 표를 읽어 스냅샷을 뜬다(`wikipedia.py`). NDX100은
그 방법이 **불가능하다** — 2026-08-10 실측에서 `List of NASDAQ-100 companies`는 2005년에
만들어진 뒤 2026-04-01 판까지도 24자짜리 리다이렉트였고, 본체인 `Nasdaq-100` 문서에는
구성원 표가 있었던 적이 없다. diff할 과거 전체 목록이 존재하지 않는다.

대신 **Invesco QQQ Trust, Series 1**(CIK 1067839)이 있다. 나스닥100을 완전복제하는 UIT라
그 보유종목이 곧 구성원 명단이고, SEC 제출이라 공개·무료이며 **삭제 의무가 없다**.

|양식|건수|기간|성격|
|---|---|---|---|
|`N-30B-2`|22|2005~2025 제출|주주 보고서. 기준일은 회계연도 말(9/30)|
|`NPORT-P`|27|2019-11~|구조화 XML. 최근 구간이 촘촘하다|

## 위키 스냅샷보다 나은 점과 못한 점

**나은 점: 날짜가 정확하다.** 위키 스냅샷은 "늦어도 이 판에는 반영돼 있었다"라 편출일이
상한이었고 `accept_exit_lag`가 그 지연을 따로 인정해야 했다. 여기 기준일은 감사받은
회계연도 말이라 지연 보정이 필요 없다.

**못한 점: 연 1회다.** 위키 SP500은 월 1회였다. **같은 회계연도 안에 들어왔다 나간 종목은
잡히지 않는다.** 그 부류는 인수·실패가 많아 놓치면 기회 손실이자 약한 편향이 남는다.
없앨 수는 없고 드러낼 수는 있어서, `qqq` 단계가 스냅샷 사이의 간격을 찍는다.

## 이름만 있고 티커가 없다

명세는 `Apple, Inc.`·`Google, Inc., Class A`처럼 **회사 이름만** 적는다. 그래서 이름을
티커로 옮겨야 하는데, **못 옮기는 이름이 정확히 우리가 찾는 사라진 회사들이다.** 그것을
추측으로 메우면 이 작업의 목적이 사라지므로, `resolve_names`는 못 푼 이름을 그대로 돌려주고
호출자가 판단하게 한다.

취득(`QqqClient`가 아니라 `edgar.EdgarClient`를 그대로 쓴다)과 파싱을 나눈다. 파싱은
문자열만 받으므로 픽스처로 테스트할 수 있다.
"""

from __future__ import annotations

import html
import re
from dataclasses import dataclass

CIK = "1067839"
SUBMISSIONS_URL = f"https://data.sec.gov/submissions/CIK{int(CIK):010d}.json"
ARCHIVE_URL = "https://www.sec.gov/Archives/edgar/data/{cik}/{accession}/{document}"

# 보유 명세를 담는 양식. 다른 양식(`NSAR-U`·`497`)에는 종목 목록이 없다.
HOLDING_FORMS = ("N-30B-2", "NPORT-P")


class QqqError(Exception):
    """제출이나 명세를 우리 계약대로 읽을 수 없을 때 올린다."""


@dataclass(frozen=True)
class Filing:
    """보유 명세를 담은 제출 하나."""

    form: str
    filed: str
    report_date: str
    accession: str
    document: str

    @property
    def url(self) -> str:
        # 제출 목록의 `primaryDocument`가 `NPORT-P`에서는 XSL 뷰어 경로
        # (`xslFormNPORT-P_X01/primary_doc.xml`)다. 그 경로로 받으면 사람이 보라고 만든
        # HTML이 오고 XML 태그가 없다. 폴더 부분을 떼면 원본 XML이다.
        document = self.document.rsplit("/", 1)[-1]
        return ARCHIVE_URL.format(
            cik=CIK, accession=self.accession.replace("-", ""), document=document
        )


@dataclass(frozen=True)
class Holdings:
    """한 기준일의 보유 종목 이름."""

    as_of: str
    form: str
    accession: str
    names: tuple[str, ...]


def parse_filings(payload: object) -> list[Filing]:
    """제출 목록 JSON에서 보유 명세 제출만 고른다. 오래된 것부터."""
    if not isinstance(payload, dict):
        raise QqqError("제출 목록이 객체가 아닙니다.")
    recent = ((payload.get("filings") or {}).get("recent")) or {}
    columns = ("form", "filingDate", "reportDate", "accessionNumber", "primaryDocument")
    missing = [name for name in columns if name not in recent]
    if missing:
        raise QqqError("제출 목록에 없는 열입니다: " + ", ".join(missing))
    found = [
        Filing(form=form, filed=filed, report_date=report, accession=accession,
               document=document)
        for form, filed, report, accession, document in zip(
            *(recent[name] for name in columns)
        )
        if form in HOLDING_FORMS and document and report
    ]
    return sorted(found, key=lambda item: (item.report_date, item.filed))


def _plain_text(document: str) -> list[str]:
    """HTML을 줄 목록으로 편다. 셀 경계가 줄바꿈이 되도록 태그를 줄바꿈으로 바꾼다."""
    text = html.unescape(re.sub(r"<[^>]+>", "\n", document))
    return [line.strip() for line in text.splitlines() if line.strip()]


# 구성원 수로 인정할 범위. Nasdaq-100은 다중 클래스 허용(2014-12-22) 전에는 정확히 100,
# 이후로는 101~107이다. **이 밴드가 파서를 고르는 심판이다** — 서식이 판마다 달라 하나의
# 읽기로는 20년을 못 덮는데, 어느 읽기가 맞았는지는 결과의 크기가 말해준다.
MEMBER_BAND = (95, 115)

# 종목 이름 줄. 숫자·통화기호·백분율이 든 줄은 이름이 아니다(`Computers—12.0%`).
_NAME = re.compile(r"^[A-Za-z][\w&.,'\-/() ]{2,70}\*?$")
_SHARES = re.compile(r"^[\d,]{4,}$")
# 이름과 주식 수 사이에 끼는 것들. 통화기호와 각주 표시다.
_FILLER = re.compile(r"^(\$|\*|\(\w\)|\d)$")
# 명세가 끝나는 자리. 여기부터는 재무제표라 `이름 + 숫자` 모양이어도 종목이 아니다
# (`Net investment income`·`Beginning of year`).
_END_OF_SCHEDULE = re.compile(
    r"^(statement of assets|statements? of operations|total assets|total investments|"
    r"notes to financial|report of independent)", re.I
)


def _has_adjacent_shares(lines: list[str], index: int) -> bool:
    """이름 줄의 **양옆** 어느 쪽이든 주식 수가 붙어 있는가.

    서식이 판마다 뒤집힌다. 2011년 판은 `이름 / 주식수 / $ / 평가액`이고 2016년 판은
    `주식수 / 이름 / (a) / 평가액`이다. 한쪽만 보면 그 해가 통째로 빈다.
    """
    for step in (1, -1):
        cursor = index + step
        while 0 <= cursor < len(lines) and _FILLER.match(lines[cursor]):
            cursor += step
        if 0 <= cursor < len(lines) and _SHARES.match(lines[cursor]):
            return True
    return False


def names_from_lines(document: str) -> list[str]:
    """HTML을 줄로 펴서 읽는다. 2008~2015년 판이 이쪽으로 풀린다.

    **틈이 아니라 끝 표시로 자른다.** 처음에는 후보 사이 간격으로 명세 덩어리를 잘랐는데,
    페이지 넘김이 13~15줄 틈을 만들어 2014년 판이 38개에서 끊겼다. 간격을 넓히면 뒤쪽
    재무제표가 딸려 들어온다. 명세는 끝나는 자리가 분명하므로 그쪽을 쓴다.
    """
    lines = _plain_text(document)
    candidates = [
        index for index, line in enumerate(lines)
        if _NAME.match(line) and _has_adjacent_shares(lines, index)
    ]
    if not candidates:
        return []
    stop = next(
        (index for index in range(candidates[0], len(lines))
         if _END_OF_SCHEDULE.match(lines[index])),
        len(lines),
    )
    found: dict[str, None] = {}
    for index in candidates:
        if index >= stop:
            break
        found.setdefault(_joined_name(lines, index), None)
    return list(found)


# 이름이 줄바꿈으로 쪼개진 꼬리. 앞줄이 쉼표로 끝나면 다음 줄이 그 이름의 일부다.
_CLASS_TAIL = re.compile(r"^(class|series)\s+[A-C]\b", re.I)


def _joined_name(lines: list[str], index: int) -> str:
    """쪼개진 이름을 붙인다.

    `Cognizant Technology Solutions Corp.,` 다음 줄에 `Class A`가 오는 판이 있다. 그대로
    두면 **한 회사가 두 조각**이 되고, 조각인 `Class A`는 어느 회사인지 알 수 없어 영영
    안 풀린다. 클래스 구분자는 티커를 가르는 정보라 버릴 수도 없다.
    """
    name = lines[index].rstrip("*").strip()
    following = lines[index + 1] if index + 1 < len(lines) else ""
    if name.endswith(",") and _CLASS_TAIL.match(following):
        return f"{name} {following.strip()}"
    return name


_TABLE = re.compile(r"<table[^>]*>(.*?)</table>", re.S | re.I)
_ROW = re.compile(r"<tr[^>]*>(.*?)</tr>", re.S | re.I)
_CELL = re.compile(r"<t[dh][^>]*>(.*?)</t[dh]>", re.S | re.I)


def names_from_tables(document: str) -> list[str]:
    """표 구조를 그대로 읽는다. 2016년 이후 판이 이쪽으로 풀린다.

    그 판들은 `Schedule of Investments`가 감사 의견 문장 속에만 나오고 주식 수가 이름
    앞에 와서 줄 기반 읽기가 흔들린다. 셀 단위로 보면 서식과 무관하게 `이름 + 숫자` 행만
    고르면 된다.

    **표 하나를 고르지 않는다.** 명세가 페이지마다 다른 `<table>`로 쪼개져 있어서 가장 큰
    표만 보면 20~40개에서 끝난다. 전부 모으고 재무제표가 시작되는 자리에서 자른다.
    """
    rows: list[tuple[int, str]] = []
    for table in _TABLE.finditer(document):
        for row in _ROW.finditer(table.group(1)):
            cells = [
                " ".join(html.unescape(re.sub(r"<[^>]+>", " ", cell.group(1))).split())
                for cell in _CELL.finditer(row.group(1))
            ]
            names = [value for value in cells if _NAME.match(value)]
            numbers = [value for value in cells if _SHARES.match(value)]
            if names and numbers:
                rows.append((table.start() + row.start(), names[0]))
    if not rows:
        return []
    ends = [
        found.start() for found in
        re.finditer(r"Statement of Assets and Liabilities", document, re.I)
        if found.start() > rows[0][0]
    ]
    stop = ends[0] if ends else len(document)
    found: dict[str, None] = {}
    for position, name in rows:
        if position >= stop:
            break
        found.setdefault(name.rstrip("*").strip(), None)
    return list(found)


def parse_report_names(document: str) -> list[str]:
    """`N-30B-2`의 명세에서 종목 이름. **두 읽기를 시도하고 밴드가 심판한다.**

    20년치 서식을 하나의 규칙으로 덮으려는 시도를 접었다. 대신 두 읽기를 다 해보고 구성원
    수가 `MEMBER_BAND`에 드는 쪽을 쓴다. 둘 다 안 들면 빈 목록을 돌려주고, 호출자가 그 판을
    버린다 — **틀린 명단은 없는 것보다 나쁘다.** 94개짜리 명단을 그대로 쓰면 다음 판과의
    diff에서 있지도 않은 편출이 아홉 건 생긴다.
    """
    low, high = MEMBER_BAND
    for names in (names_from_tables(document), names_from_lines(document)):
        if low <= len(names) <= high:
            return names
    return []


_NPORT_NAME = re.compile(r"<name>(.*?)</name>", re.I | re.S)
# **클래스는 `title`에만 있다.** `name`은 `Charter Communications, Inc.`이고 `title`이
# `Charter Communications, Inc., Class A`다. `name`을 쓰면 알파벳 두 클래스가 한 이름이 되어
# 어느 쪽이 `GOOGL`인지 알 수 없어진다.
_NPORT_TITLE = re.compile(r"<title>(.*?)</title>", re.I | re.S)
_NPORT_ROW = re.compile(r"<invstOrSec>(.*?)</invstOrSec>", re.I | re.S)
_NPORT_AS_OF = re.compile(r"<repPdDate>(\d{4}-\d{2}-\d{2})</repPdDate>", re.I)
_NPORT_ASSET = re.compile(r"<assetCat>(.*?)</assetCat>", re.I)


def parse_nport_names(document: str) -> list[str]:
    """`NPORT-P` XML에서 종목 이름. 주식(`EC`)만 고른다.

    구조화 문서라 서식 추측이 필요 없다. 현금성 자산이 섞이지 않도록 `assetCat`이 `EC`인
    행만 받는다.
    """
    names: list[str] = []
    for block in _NPORT_ROW.findall(document):
        category = _NPORT_ASSET.search(block)
        if category and category.group(1).strip().upper() != "EC":
            continue
        found = _NPORT_TITLE.search(block) or _NPORT_NAME.search(block)
        if found:
            names.append(html.unescape(found.group(1)).strip())
    return names


def holdings_from(filing: Filing, document: str) -> Holdings:
    """제출 하나를 `Holdings`로. 양식에 맞는 파서를 고른다.

    **기준일은 본문이 아니라 제출 목록의 `reportDate`다.** 본문에서 읽으려면 제목 줄을
    앵커로 써야 하는데 서식이 판마다 다르고, 실제로 2016~2025년 판 열한 개가 그것 때문에
    날짜를 못 읽었다. `reportDate`는 구조화된 값이라 서식과 무관하다.
    """
    names = (
        parse_nport_names(document) if filing.form == "NPORT-P"
        else parse_report_names(document)
    )
    as_of = filing.report_date
    if not names:
        raise QqqError(f"{filing.form} {filing.accession}에서 종목을 못 읽었습니다.")
    return Holdings(
        as_of=as_of, form=filing.form, accession=filing.accession, names=tuple(names)
    )


# 각주 표시. 명세 이름 끝에 `(a)`·`(b)`로 붙고 판마다 글자가 바뀐다(비수익 증권 표시).
_FOOTNOTE = re.compile(r"\s*\([a-z]\)\s*$", re.I)
# 분배 전 임시 거래 라인. 지수 구성원이 아니라 표기 부산물이다.
_WHEN_ISSUED = re.compile(r"\bwhen[\s-]?issued\b", re.I)
# 클래스 구분자는 **남긴다.** `GOOG`/`GOOGL`·`FOX`/`FOXA`를 합치면 두 종목이 하나가 된다.
_CLASS = re.compile(r"\b(?:class|series)\s+([A-C])\b", re.I)
# 법인 꼬리표. 같은 회사가 판마다 다르게 적힌다(`Apple, Inc.` / `Apple Inc` / `APPLE INC`).
_SUFFIX = re.compile(
    r"\b(incorporated|inc|corporation|corp|company|co|holdings|holding|group|"
    r"limited|ltd|plc|llc|lp|nv|sa|ag|the|adr|ads)\b", re.I
)


def normalize(name: str) -> str:
    """비교용 형태.

    걷어내는 순서가 중요하다. **각주를 먼저 뗀다** — `(a)`를 남겨두면 구두점을 지우는
    단계에서 `A`가 되어 클래스 A와 구별되지 않는다. 실측에서 이 하나 때문에 고유 이름
    467개 중 166개가 안 풀렸다.

    클래스 구분자는 반대로 **남긴다.** 지우면 `Alphabet Class A`와 `Class C`가 같은 키가
    되어 한 회사가 두 티커를 오간다.
    """
    text = _FOOTNOTE.sub("", name)
    text = _WHEN_ISSUED.sub(" ", text)
    text = _CLASS.sub(r" \1CLASS ", text)
    # **마침표를 먼저, 붙여서 지운다.** 공백으로 바꾸면 `N.V.`가 `N V` 두 낱말이 되어
    # 법인 꼬리표 목록에 안 걸린다(`ASML Holding N.V.`가 그래서 안 풀렸다).
    text = text.replace(".", "")
    text = re.sub(r"[^A-Za-z0-9 ]", " ", text)
    text = _SUFFIX.sub(" ", text)
    return " ".join(text.upper().split())


# 명세에만 나오는 표기라 공고 표·벤더 목록 어디에도 없는 이름. **근거를 적는다.**
#
# 사전 두 개(공고 표의 `security` 열, 벤더 심볼 목록의 이름)로 471개 중 434개가 풀린다.
# 남는 것은 대개 그 시절 이름이고, 사전은 **현재** 이름을 담기 때문이다.
NAME_OVERRIDES = (
    ("ASML Holding N.V., New York Shares", "ASML", "미국 상장분 표기"),
    ("Adobe Inc.", "ADBE", "2018년 Adobe Systems에서 개명"),
    ("Adobe, Inc.", "ADBE", "같은 회사의 쉼표 표기"),
    ("Baidu.com", "BIDU", "상장 초기 표기"),
    ("Biogen IDEC, Inc.", "BIIB", "2015년 Biogen으로 개명하기 전 이름"),
    ("Biogen Idec, Inc.", "BIIB", "같은 이름의 대소문자 변형"),
    ("Cognizant Technology Solutions Corp.", "CTSH", "클래스 없는 표기"),
    ("Ctrip.Com International Ltd. ADR", "TCOM", "2019년 Trip.com Group으로 개명"),
    ("Ctrip.com International, Ltd., ADR", "TCOM", "같은 회사의 쉼표 표기"),
    ("DENTSPLY International, Inc.", "XRAY", "2016년 Dentsply Sirona로 합병 개명"),
    ("Dentsply International, Inc.", "XRAY", "같은 이름의 대소문자 변형"),
    ("Flextronics International Ltd.", "FLEX", "2016년 Flex로 개명"),
    ("IAC/InterActive Corp.", "IAC", "벤더 코드가 IAC다"),
    ("Infosys Technologies Ltd.", "INFY", "2011년 Infosys Ltd로 개명"),
    ("NXP Semiconductor NV", "NXPI", "벤더 표기는 NXP Semiconductors N.V."),
    ("O'Reilly Automotive, Inc., Class R", "ORLY", "NPORT title의 클래스 표기 오류"),
    ("Patterson Cos, Inc.", "PDCO", "Patterson Companies의 축약 표기"),
    ("Patterson Cos., Inc.", "PDCO", "같은 축약의 마침표 변형"),
    ("Priceline Group, Inc.", "BKNG", "2018년 Booking Holdings로 개명"),
    ("Priceline Group, Inc. (The)", "BKNG", "정관사를 뒤에 붙인 표기"),
    ("Strategy Inc., Class A", "MSTR", "2025년 MicroStrategy에서 개명"),
    ("Symantec Corp.", "NLOK", "2019년 NortonLifeLock으로 개명"),
    ("Ulta Salon Cosmetics & Fragrance, Inc.", "ULTA", "2017년 Ulta Beauty로 개명"),
    ("Liberty Media Corp., Class A", "LMCA", "리버티미디어 시리즈 A"),
    ("Liberty Media Corp., Class C", "LMCK", "리버티미디어 시리즈 C. 2014-07 신설"),
    ("Liberty Global PLC Lilac, Class A", "LILA", "리버티글로벌의 LiLAC 트래킹 주식"),
    ("Liberty Global PLC Lilac, Class C", "LILAK", "같은 트래커의 클래스 C"),
    # 리버티 인터랙티브의 시리즈 A 트래킹 주식은 `LINTA`에서 2015년 `QVCA`가 됐다.
    # 벤더에 `LINTA`는 아예 없고 `QVCA`가 2006-05-10~2018-04-11로 전 이력을 담는다.
    ("Liberty Media Corp. - Interactive", "QVCA", "리버티미디어 시절의 인터랙티브 트래커"),
    ("Liberty Interactive Corp., Class A", "QVCA", "2011년 분리 후 같은 트래커"),
    ("Liberty Interactive Corp. QVC Group, Class A", "QVCA", "2015년 QVC 그룹 개명 후"),
    ("Liberty Interactive Corp. QVC Group, Series A", "QVCA", "같은 트래커의 시리즈 표기"),
    # 아바고가 2016년 브로드컴을 인수하며 `AVGO`와 브로드컴이라는 이름을 함께 가져갔다.
    # 그래서 2012~2015년 명세의 `Broadcom`은 **다른 회사**(`BRCM`)다. 이름만 보면 두 회사가
    # 한 티커로 합쳐져 그 해 구성원이 하나 줄어든다.
    ("Broadcom Corp.", "BRCM", "2016년 인수 전의 Broadcom Corporation"),
    ("Broadcom Corp., Class A", "BRCM", "같은 회사의 클래스 A 표기"),
)

# 명세에 있지만 지수 구성원이 아닌 이름. 펀드가 자기 자신을 적은 줄이다.
IGNORED_NAMES = ("PowerShares QQQ Trust", "Invesco QQQ Trust")


def override_dictionary() -> dict[str, str]:
    """`NAME_OVERRIDES`를 **원본 이름 그대로** 쓰는 사전으로.

    정규화 키로 두지 않는 이유는 그것으로는 못 가르는 쌍이 있기 때문이다. `Broadcom Corp.`
    (2016년 이전의 브로드컴, `BRCM`)와 `Broadcom Inc.`(아바고가 이름을 가져간 뒤, `AVGO`)는
    정규화하면 둘 다 `BROADCOM`이다. 손으로 확인해 적은 항목이니 적은 이름에만 듣게 한다.
    """
    return {override_key(name): symbol for name, symbol, _ in NAME_OVERRIDES}


def override_key(name: str) -> str:
    """오버라이드 대조용 형태. **각주만 떼고 법인 꼬리표는 남긴다.**

    `Ulta Salon ... (a)`와 `(b)`는 같은 이름이라 각주는 떼야 하고, `Broadcom Corp.`와
    `Broadcom Inc.`는 다른 회사라 꼬리표는 남겨야 한다. 정규화 키는 둘 다 지워서 못 쓴다.
    """
    return " ".join(_WHEN_ISSUED.sub(" ", _FOOTNOTE.sub("", name)).split()).upper()


@dataclass(frozen=True)
class NameObservation:
    """어느 날 이 이름이 어느 티커였는지. 지수 사건 한 줄이 관측 하나다."""

    date: str
    action: str
    symbol: str


def _unqualified(key: str) -> str:
    """클래스 표시를 뗀 키. `ACLASS`·`BCLASS` 토큰만 지운다."""
    return " ".join(part for part in key.split() if not part.endswith("CLASS"))


def ticker_on(observations: tuple[NameObservation, ...], as_of: str) -> str | None:
    """그 날짜에 이 이름이 쓰던 티커.

    **이름 사전은 날짜를 알아야 한다.** 처음에는 이름 하나에 티커 하나를 붙였는데,
    `Baker Hughes`가 2017-07-07에 `BHI`로 빠지고 같은 날 `BKR`로 들어온다. 날짜를 무시하면
    2022년 보유가 옛 티커 `BHI`로 풀려 있지도 않은 편입 사건이 생긴다. `SYMBOL_RENAMES`·
    `CIK_OVERRIDES`와 같은 자리에서 같은 교훈을 이름 축으로 다시 만난 것이다.

    두 동작의 뜻이 다르다는 것이 판정을 만든다.

    - `add`는 "그날부터 이 티커"다. 기준일이 그날 이후면 이쪽을 쓴다.
    - `remove`는 "그날까지 이 티커"다. 기준일이 그날 이전이면 이쪽을 쓴다.

    같은 날 편출·편입이 한 쌍으로 있는 개명(`BHI`→`BKR`)이 이 규칙으로 정확히 갈린다.
    """
    if not observations:
        return None
    earlier = [item for item in observations if item.date <= as_of]
    if earlier:
        when = max(item.date for item in earlier)
        same_day = [item for item in earlier if item.date == when]
        adds = [item for item in same_day if item.action == "add"]
        return (adds or same_day)[0].symbol
    when = min(item.date for item in observations)
    same_day = [item for item in observations if item.date == when]
    removes = [item for item in same_day if item.action == "remove"]
    return (removes or same_day)[0].symbol


def resolve_names(
    names: list[str] | tuple[str, ...],
    dictionary: dict[str, tuple[NameObservation, ...]],
    as_of: str,
) -> tuple[dict[str, str], list[str]]:
    """`이름 → 그 기준일의 티커`. `(푼 것, 못 푼 이름)`을 준다.

    **못 푼 이름을 추측으로 메우지 않는다.** 이 작업의 목적이 "빠진 구성원 찾기"인데,
    가장 안 풀리는 이름이 바로 그 사라진 회사들이다. 대충 맞춘 티커 하나가 그 회사의
    구간에 다른 회사 가격을 넣는다.

    ## 클래스는 두 단계로 본다

    명세는 `Facebook, Inc., Class A`라고 적는데 사전(공고 표·벤더 목록)은 그냥 `Facebook`
    이다. 클래스까지 맞는 키를 먼저 보고, 없으면 클래스를 뗀 키로 되짚는다.

    되짚기에는 함정이 있다. `Alphabet Class A`와 `Class C`가 둘 다 `Alphabet`으로
    떨어지면 **한 회사가 두 티커를 오간다.** 그래서 클래스를 뗀 형태가 같은데 클래스가
    둘 이상이면 그 무리를 통째로 돌려준다. 어느 쪽이 `GOOGL`인지 명세는 말해주지 않는다.

    막아야 할 것은 그것뿐이다. 같은 회사의 옛 이름과 새 이름이 같은 티커로 가는 것
    (`Facebook`과 `Meta Platforms` 둘 다 `META`)은 **맞는 결과**라 막지 않는다.
    """
    # 접두사로 견준다. 같은 자기 참조가 `PowerShares QQQ Trust, Series 1`로도 적힌다.
    ignored = tuple(normalize(name) for name in IGNORED_NAMES)

    # **키 단위로 판정한다.** 같은 회사의 표기 변형(`Facebook, Inc., Class A`와 그 각주
    # 붙은 판)은 정규화하면 한 키다. 이름 단위로 세면 그 변형들이 서로를 막는다.
    keys: dict[str, list[str]] = {}
    for name in names:
        keys.setdefault(normalize(name), []).append(name)

    # 손으로 적은 것이 먼저다. 원본 이름이 정확히 맞을 때만 듣는다.
    overrides = override_dictionary()
    exact: dict[str, str] = {}
    fallback: dict[str, str] = {}
    unresolved: list[str] = []
    for key, variants in keys.items():
        # **클래스만 남은 조각은 종목이 아니다.** 줄바꿈으로 쪼개진 이름의 꼬리가 그대로
        # 후보가 되면(`Class A`) 회사가 없는데도 사전의 아무 `...LLC`에 붙는다. 실제로
        # 2013·2014년 판에서 `LLC`라는 없는 티커가 구성원으로 들어갔다.
        if not _unqualified(key):
            continue
        if key.startswith(ignored):
            continue
        named = {overrides[override_key(name)] for name in variants
                 if override_key(name) in overrides}
        if len(named) == 1:
            exact[key] = named.pop()
            continue
        symbol = ticker_on(dictionary.get(key, ()), as_of)
        if symbol:
            exact[key] = symbol
            continue
        symbol = ticker_on(dictionary.get(_unqualified(key), ()), as_of)
        if symbol:
            fallback[key] = symbol
        else:
            unresolved.extend(variants)

    # 클래스를 뗀 형태가 같은 되짚기끼리만 다툰다.
    classes: dict[str, set[str]] = {}
    for key in fallback:
        base = _unqualified(key)
        marks = {part for part in key.split() if part.endswith("CLASS")}
        classes.setdefault(base, set()).update(marks or {""})

    resolved: dict[str, str] = {}
    for key, symbol in exact.items():
        resolved.update({name: symbol for name in keys[key]})
    for key, symbol in fallback.items():
        if len(classes[_unqualified(key)]) == 1:
            resolved.update({name: symbol for name in keys[key]})
        else:
            unresolved.extend(keys[key])
    return resolved, sorted(set(unresolved))


def snapshot_changes(
    snapshots: list[Holdings],
    dictionary: dict[str, tuple[NameObservation, ...]],
) -> tuple[list[tuple[str, str, str, str, str, str]], list[str]]:
    """연속한 두 기준일의 차이를 변경 사건으로. `(사건, 못 푼 이름)`.

    **기준일마다 따로 해석한다.** 한 번 해석해 돌려쓰면 개명이 시간을 잃는다 — 2022년
    보유가 2010년 티커로 풀린다.

    날짜는 뒤쪽 기준일이다. 그 사이 어느 날 바뀌었는지는 모르고, 늦어도 그날에는 반영돼
    있었다는 것만 안다. 위키와 달리 기준일 자체는 정확하므로 불확실성이 두 기준일의
    간격으로 한정된다.
    """
    tickers: dict[str, frozenset[str]] = {}
    unresolved: list[str] = []
    for item in snapshots:
        resolved, missing = resolve_names(item.names, dictionary, item.as_of)
        tickers[item.as_of] = frozenset(resolved.values())
        unresolved.extend(missing)

    events: list[tuple[str, str, str, str, str, str]] = []
    for earlier, later in zip(snapshots, snapshots[1:]):
        before, after = tickers[earlier.as_of], tickers[later.as_of]
        for symbol in sorted(after - before):
            events.append((later.as_of, "NDX100", "add", symbol, "qqq", later.accession))
        for symbol in sorted(before - after):
            events.append((later.as_of, "NDX100", "remove", symbol, "qqq", later.accession))
    return events, sorted(set(unresolved))


CSV_COLUMNS = ("date", "index_name", "action", "symbol", "source", "revid")


def snapshot_changes_csv(events: list[tuple[str, str, str, str, str, str]]) -> str:
    """`wikipedia.snapshot_changes_csv`와 같은 열 계약. 같은 병합 경로를 탄다."""
    lines = [",".join(CSV_COLUMNS)]
    for date_, index, action, symbol, source, accession in sorted(events, reverse=True):
        lines.append(f"{date_},{index},{action},{symbol},{source},{accession}")
    return "\n".join(lines) + "\n"
