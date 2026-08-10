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
    # 아래 여덟은 2026-08-09에 **벤더 심볼 목록 대조**로 찾았다. 위 항목들을 찾은 신호는
    # "편입만 있고 편출 없는 티커"였는데, 이것들은 편출 기록이 멀쩡히 있어서 그 신호에
    # 걸리지 않았다. EODHD의 US 심볼 목록(상장+폐지)에 아예 없는 티커를 세는 쪽이 더 센
    # 그물이다. `eodhd.unlisted_symbols`가 그 검사다.
    Rename("SP500", "CDAY", "2024-02-02", "DAY",
           "Dayforce former_name 'Ceridian HCM Holding Inc.', 보도자료 'Ceridian to change"
           " ticker symbol to DAY on NYSE and TSX effective February 1'(2024-02-01)"),
    Rename("SP500", "RE", "2023-07-11", "EG",
           "Everest Group former_name 'Everest Re Group, Ltd.', traded_as {{NYSE|EG}}."
           " 표의 2023-07-10 행이 remove RE와 add EG를 같은 날 적어 그날이 교체일이다"),
    Rename("SP500", "FRE", "2010-06-17", "FMCC",
           "Freddie Mac traded_as {{OTCQB|FMCC}}. 본문 'dropped a further 50% on June 16,"
           " 2010, when the stocks delisted due to falling below minimum share prices for"
           " the NYSE' — NYSE 폐지 다음 날부터 장외 티커를 쓴다"),
    Rename("NDX100", "RIMM", "2013-02-04", "BB",
           "NDX 표 2012-12-24 행이 RIMM을 [[Research in Motion]]으로 적고, 그 문서는"
           " BlackBerry Limited로 넘어가며 traded_as {{NASDAQ|BB}}다. 본문 'ticker symbols"
           " on the TSX and NASDAQ already were changed to BB and BBRY respectively on"
           " February 4, 2013'. **BBRY가 아니라 BB로 보내는 이유**는 벤더 계열이 그쪽에"
           " 전 이력을 담기 때문이다(BB.US 1999-02-04~현재, BBRY.US는 2018-03-29에 끊긴다)"),
    Rename("NDX100", "UAUA", "2010-10-01", "UAL",
           "UAL Corporation traded_as {{NASDAQ was|UAUA}}, successor 'United Airlines"
           " Holdings, Inc.', fate 'Merged with Continental Airlines'(2010-10-01)."
           " S&P 구성원 표가 United Airlines Holdings를 {{NasdaqSymbol|UAL}}로 적는다"),
    Rename("NDX100", "WFMI", "2010-12-20", "WFM",
           "NDX 표 2008-12-22 행이 WFMI를 [[Whole Foods Market]]으로 적고, 그 문서는"
           " traded_as {{NASDAQ was|WFM}}에 'The company's ticker symbol on the Nasdaq was"
           " WFM'이다. 정확한 티커 변경일은 확인하지 못해 **표에서 WFM 사용이 확인되는 가장"
           " 이른 날짜**(2010-12-20 편입)를 쓴다"),
    # 아래 둘은 한 쌍이다. `MNST`를 두 회사가 나눠 쓴다.
    #
    # NDX 표 원문이 그것을 직접 적는다 — 2008-11-10 행은 `MNST / [[Monster Worldwide]]`,
    # 2011-12-19 행은 `MNST / [[Monster Beverage|Hansen Natural]]`이다. 뒤엣것은 표가
    # **오늘의 티커**를 쓴 것이고 당시 티커는 HANS였다. 그래서 한쪽만 고치면 안 된다.
    # 몬스터 월드와이드를 MWW로 보내지 않으면 그 회사의 구간이 몬스터 베버리지 가격을
    # 받고, 한센을 MNST로 보내지 않으면 그 구간이 통째로 가격을 잃는다.
    Rename("NDX100", "HANS", "2012-01-05", "MNST",
           "Monster Beverage former_name 'Hansen Natural Corporation (1935 - 2012)',"
           " 본문 'On January 5, 2012 ... change the name of the company from Hansen's"
           " Natural to Monster Beverage Corporation, under the new ticker MNST'"),
    # `before`가 2011-12-19보다 앞이어야 한다. 그날 한센이 MNST라는 이름으로 편입되는데
    # 그 행까지 MWW로 덮으면 두 회사를 반대로 뒤집는다. 세 날 차이다.
    # 아래 아홉은 2026-08-10에 **과거 판 스냅샷**이 데려온 옛 티커다.
    #
    # `before`는 그 심볼의 **마지막 스냅샷 사건보다 뒤**여야 한다. 처음에 개명 발효일로
    # 잡았더니 그보다 늦은 사건이 안 걸려 `WFMI`·`WMI`·`MHFI`·`MXB`가 그대로 남았다.
    # 구성원 표는 개명 뒤에도 한동안 옛 표기를 쓰기 때문이다. 변경 이력 표에는
    # 없던 종목들이라 지금까지 개명을 걸 일이 없었다. 근거는 위키 infobox와, 그 계열이
    # 실제로 멤버십 구간을 덮는지 확인한 벤더 실측이다.
    Rename("SP500", "AOC", "2012-01-01", "AON",
           "Aon plc의 현재 티커가 AON이고 벤더 계열이 2006-01-03부터 이어진다."
           " 옛 티커 AOC는 벤더 목록에 없다"),
    Rename("SP500", "CZN", "2008-07-31", "FTR",
           "Frontier Communications former_name에 'Citizens Communications'가 있다."
           " **FYBR가 아니라 FTR이다** — FYBR는 2021년 회생 이후 계열(2021-05-04~)이라"
           " 그 시절 구간을 못 덮고, FTR가 2006-01-03~2020-04-29로 덮는다"),
    Rename("SP500", "WMI", "2009-09-01", "WM",
           "Waste Management traded_as {{NYSE|WM}}, former_name 'USA Waste Services, Inc.'"),
    Rename("SP500", "LIZ", "2012-05-15", "KATE",
           "Kate Spade & Company의 옛 이름이 Liz Claiborne이다. 벤더에 KATE가"
           " 2006-01-03~2017-07-11로 있고 LIZ는 목록에 없다"),
    Rename("SP500", "MHFI", "2016-06-01", "SPGI",
           "S&P Global former_name 'The McGraw–Hill Companies, Inc. (1995–2013)',"
           " traded_as {{nyse|SPGI}}"),
    Rename("SP500", "WPO", "2013-11-29", "GHC",
           "Graham Holdings former_name 'The Washington Post Company (1947–2013)',"
           " traded_as {{NYSE|GHC}}"),
    Rename("SP500", "MXB", "2010-08-01", "MSCI",
           "MSCI Inc. traded_as {{nyse|MSCI}}. 벤더의 MXB는 Marnetics Broadband라는"
           " **다른 회사**이므로 그대로 두면 안 된다"),
    # `WFMI`는 NDX100에만 걸려 있었다. 스냅샷이 S&P 쪽 편출을 데려오면서 같은 개명이
    # 그 지수에도 필요해졌다. 개명 규칙이 지수별인 이유가 여기서 다시 드러난다.
    Rename("SP500", "UA-C", "2017-01-01", "UA",
           "2016년 Under Armour 클래스 분할에서 Class C가 UA, Class A가 UAA를 받았다."
           " 구성원 표가 잠깐 `UA-C`로 적었을 뿐 벤더 코드는 UA다"),
    Rename("SP500", "WFMI", "2011-06-01", "WFM",
           "Whole Foods Market traded_as {{NASDAQ was|WFM}}. NDX100 항목과 같은 근거다"),
    Rename("NDX100", "MNST", "2011-12-16", "MWW",
           "S&P 표 2011-12-16 행이 [[Monster Worldwide]]를 MWW로, NDX 표 2008-11-10 행이"
           " 같은 회사를 MNST로 적는다. 정확한 티커 변경일은 확인하지 못해 **MWW 사용이"
           " 확인되는 가장 이른 날짜**를 쓴다"),
    # 아래 열둘은 2026-08-10에 **미커버 STARTS_LATE 구간**에서 찾았다. 여태 개명을 찾은
    # 신호(편출 없는 티커·벤더 목록 미등록)에 둘 다 안 걸린다 — 편출 기록이 있고, 옛
    # 티커도 벤더 목록에 멀쩡히 있기 때문이다. **다른 회사가 그 티커를 물려받았을 뿐이다.**
    # 그래서 세 번째 그물인 구간 커버리지에서만 보였다.
    #
    # 판정 근거는 하나다 — **후계 티커의 벤더 계열이 옛 구간을 통째로 덮는가.** 덮으면
    # 벤더가 한 회사의 이력을 그 코드에 이어붙였다는 뜻이고, 그것이 개명이다. 덮지 못하면
    # 다른 회사이므로 개명이 아니라 `universe/reused-tickers.csv`로 간다.
    #
    # 편출·편입이 **같은 날 한 쌍**으로 있어서(스냅샷 diff가 그렇게 낸다) 개명을 걸면
    # `_drop_same_day_reuse`가 그 쌍을 상쇄하고 구간이 하나로 이어진다.
    Rename("SP500", "FPL", "2010-07-29", "NEE",
           "NextEra Energy former_name 'FPL Group'. 벤더 NEE 계열 2006-01-03~현재가"
           " 구간(2008-01-02~2010-07-28)을 통째로 덮는다"),
    Rename("SP500", "GCI", "2015-06-30", "TGNA",
           "2015년 Gannett 분할에서 방송을 남긴 존속법인이 TEGNA로 개명하고 출판이 새"
           " Gannett으로 분사했다. 벤더 TGNA 계열 2006-01-03~2026-03-20이 구간을 덮고,"
           " 분사한 새 Gannett은 GCI_OLD(2015-06-23~)로 따로 있다"),
    Rename("SP500", "HCN", "2018-03-01", "WELL",
           "Welltower former_name 'Health Care REIT, Inc.'. 벤더 WELL 계열"
           " 2006-01-03~현재가 구간(2009-03-19~2018-02-28)을 덮는다"),
    # HCP → PEAK → DOC 두 단계다. 둘을 다 걸어야 한 구간으로 이어지고, 그 덕에 남아 있던
    # `PEAK`의 ENDS_EARLY(계열이 구간 시작에도 못 닿던 것)도 같이 사라진다.
    Rename("SP500", "HCP", "2019-11-30", "DOC",
           "Healthpeak Properties의 옛 이름이 HCP, Inc.이고 2019-11 PEAK, 2024-03 DOC로"
           " 바뀌었다. 벤더 DOC 계열 2006-01-03~현재가 구간(2008-08-30~)을 덮는다"),
    Rename("SP500", "PEAK", "2024-03-29", "DOC",
           "같은 회사의 두 번째 티커 변경이다. 벤더의 PEAK 코드는 2012-10-17~2019-09-16의"
           " **다른 회사**라 그대로 두면 구간이 그 가격을 받는다"),
    Rename("SP500", "IACI", "2008-08-31", "IAC",
           "IAC/InterActiveCorp의 현재 벤더 코드가 IAC(2006-01-03~2026-06-03)다."
           " IACI 코드에는 2016-01-04~2016-01-20의 13행짜리 토막만 있다"),
    Rename("NDX100", "IACI", "2009-12-22", "IAC",
           "SP500 항목과 같은 회사·같은 근거다. 지수마다 편출일이 달라 규칙을 따로 건다"),
    Rename("SP500", "LB", "2021-08-29", "BBWI",
           "Bath & Body Works former_name 'L Brands'. 벤더 BBWI 계열 2006-01-03~현재가"
           " 구간(2013-12-29~2021-08-28)을 덮는다"),
    Rename("SP500", "PX", "2018-11-28", "LIN",
           "2018년 Praxair와 Linde AG 합병으로 만들어진 Linde plc가 PX 주주의 이력을"
           " 잇는다. 벤더 LIN 계열 2006-01-03~현재가 구간을 덮는다"),
    Rename("SP500", "SAI", "2013-10-28", "LDOS",
           "2013년 SAIC 분할에서 존속법인이 Leidos로 개명하고 정부서비스가 새 SAIC로"
           " 분사했다. 벤더 LDOS 계열 2006-10-13~현재가 구간(2009-12-18~2013-09-20)을"
           " 덮는다. LDOS는 2019-08-09에 다시 편입되므로 구간이 둘로 떨어진다"),
    # WellPoint → Anthem → Elevance도 두 단계다. 중간의 ANTM 구간은 지금 커버리지를
    # 통과하지만, 한 회사를 세 심볼로 나눠두면 보유 중에 심볼이 사라진다. 사슬 전체를
    # 현재 티커로 모은다.
    Rename("SP500", "WLP", "2014-12-30", "ELV",
           "Elevance Health의 옛 이름이 WellPoint(2014-12 Anthem, 2022-06 Elevance)다."
           " 벤더 WLP 코드에는 2014-09-22~2014-12-02의 두 달짜리 토막만 있고, ELV 계열"
           " 2006-01-03~현재가 구간(2008-01-02~2014-12-29)을 덮는다"),
    Rename("SP500", "ANTM", "2022-06-30", "ELV",
           "같은 회사의 두 번째 이름이다. ANTM 계열(2006-01-03~2022-06-27)도 구간을"
           " 덮지만, 사슬을 한 심볼로 모아야 구간이 끊기지 않는다"),
    # `AGN`은 두 회사가 나눠 쓰는데 **벤더가 이미 갈라놨다.** AGN_OLD가 옛 Allergan Inc
    # (2006-01-03~2015-03-16, 액타비스 인수 완료일에 끝난다)이므로 기본 AGN 계열
    # (2006-01-03~2020-05-08)은 왓슨→액타비스→Allergan plc 쪽이다. 그래서 ACT를 AGN으로
    # 보내면 옛 Allergan의 가격이 섞이지 않는다. `CORRECTIONS`의 AGN 판단과 같은 결론이다.
    Rename("SP500", "ACT", "2015-06-30", "AGN",
           "Allergan plc의 옛 이름이 Actavis plc다. 벤더 AGN 계열 2006-01-03~2020-05-08이"
           " 구간(2013-01-30~2015-06-29)을 덮고, 옛 Allergan Inc는 AGN_OLD로 따로 있다"),
)

# 표에 있지만 재구성에서 빼는 행. **지우는 것도 해석이므로 근거를 적는다.**
#
# 여기 들어오는 조건은 하나다 — 그 구간의 실체가 어느 벤더 티커에도 없어서 가격을 구할 수
# 없을 때다. 남겨두면 `missing_universe_symbols`가 영원히 그 심볼을 물고 `SURVIVORSHIP_BIASED`
# blocker가 안 풀린다. 종목 하나 때문에 전체 판정을 막는 것보다, 빠진 사실을 적어두고
# 나머지를 판정하는 쪽이 낫다는 판단이다(2026-08-09 사용자 승인).
#
# **구성원 수 불변식이 이 구멍을 감시한다.** SP500 허용 오차가 ±6이므로 여기 쌓이는 행이
# 늘면 `count_violations`가 먼저 걸린다. 조용히 커지지 않는다.
EXCLUDED_CHANGES = (
    (
        "2016-01-19", "SP500", "remove", "ACE",
        "이 행의 실체는 ACE가 아니라 **옛 The Chubb Corporation**이고 그 가격 계열이"
        " 벤더에 없다. 표 원문은 'EXR replaces ACE as ACE Ltd acquires Chubb and retains"
        " the CB ticker, giving up ACE'인데, 여기서 지수를 떠난 것은 피인수된 Chubb Corp"
        " 이고 ACE Ltd는 CB 티커로 남았다. EODHD `CB.US`는 ACE Ltd의 계열이다 —"
        " 인수 발표일(2015-07-01)에 거래량만 1.8→17.6M으로 뛰고 종가는 101.68→102.49로"
        " 평평했다(피인수 기업이면 그날 +25%였어야 한다). `search/Chubb`에 옛 Chubb Corp"
        " 계열이 없어 2008-01-02~2016-01-19 구간의 가격을 구할 방법이 없다",
    ),
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


def _drop_excluded(
    index_name: str,
    emitted: list[tuple[str, str, str, str]],
    since: str | None = None,
) -> list[tuple[str, str, str, str]]:
    """`EXCLUDED_CHANGES`의 행을 뺀다. **없어진 행은 조용히 넘기지 않는다.**

    표가 고쳐져서 대상 행이 사라지면 제외는 아무 일도 안 하게 되는데, 그때가 바로 근거를
    다시 봐야 하는 순간이다. 조용히 통과시키면 우리가 무엇을 지우고 있었는지 잊는다.
    """
    targets = [
        (date_, index, action, symbol)
        for date_, index, action, symbol, _ in EXCLUDED_CHANGES
        if index == index_name and (since is None or date_ >= since)
    ]
    present = set(emitted)
    missing = [target for target in targets if target not in present]
    if missing:
        raise WikipediaError(
            f"제외하려던 행이 표에 없습니다: {missing}."
            " 표가 바뀌었으면 EXCLUDED_CHANGES의 근거를 다시 확인하세요."
        )
    return [record for record in emitted if record not in set(targets)]


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

    **종목명 열을 버리지 않는다.** 그것이 그 티커의 *당시* 회사 이름이고, 폐지 종목의
    CIK를 찾는 유일하게 믿을 만한 단서다. 벤더 심볼 목록의 이름은 티커의 **현재** 주인을
    가리켜서 못 쓴다 — `EMC`가 "Global X Emerging Markets Great Consumer ETF", `SHLD`가
    "Global X Defense Tech ETF"로 온다. 위키 표는 같은 티커를 `EMC Corporation`·
    `Sears Holdings`로 적는다. 이름을 티커별 파일로 따로 두지 않는 이유는 `MNST`처럼 한
    티커를 두 회사가 나눠 쓸 때 날짜가 붙어 있어야 갈리기 때문이다.
    """
    _, rows = parse_table(wikitext, CHANGES_TABLE_ID)
    emitted: list[tuple[str, str, str, str]] = []
    names: dict[tuple[str, str, str, str], str] = {}
    for row in rows:
        if len(row) < 5:
            raise WikipediaError(f"변경 이력 행의 열이 모자랍니다: {row}")
        effective = parse_date(row[0])
        if since is not None and effective < since:
            continue
        for action, cell, name_cell in (
            ("add", row[1], row[2]),
            ("remove", row[3], row[4]),
        ):
            symbol = _symbol(cell)
            if symbol:
                record = (
                    effective,
                    index_name,
                    action,
                    apply_renames(index_name, effective, symbol),
                )
                emitted.append(record)
                names.setdefault(record, clean_cell(name_cell).strip())
    emitted = _drop_excluded(index_name, emitted, since)
    emitted.extend(
        (date_, index, action, symbol)
        for date_, index, action, symbol, _ in CORRECTIONS
        if index == index_name and (since is None or date_ >= since)
    )
    if not emitted:
        raise WikipediaError(f"{index_name}의 변경 이력이 한 줄도 나오지 않았습니다.")

    buffer = io.StringIO()
    writer = csv.writer(buffer, lineterminator="\n")
    writer.writerow(("date", "index_name", "action", "symbol", "security"))
    for record in sorted(set(emitted), reverse=True):
        writer.writerow((*record, names.get(record, "")))
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

    def _get(self, params: dict, tries: int = 5) -> dict:
        """API 한 번. 429는 물러섰다가 다시 시도한다.

        판을 200개 넘게 받으면 간격만으로는 부족해 429가 온다. 실측으로 확인했다.
        """
        url = f"{WIKI_API}?" + urllib.parse.urlencode(params)
        request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        for attempt in range(tries):
            wait = self.interval - (time.monotonic() - self._last_call)
            if wait > 0:
                time.sleep(wait)
            self.calls += 1
            try:
                with urllib.request.urlopen(request, timeout=120) as response:
                    return json.load(response)
            except urllib.error.HTTPError as error:
                if error.code != 429 or attempt == tries - 1:
                    raise WikipediaError(f"HTTP {error.code} {params}") from error
                time.sleep(5 * (attempt + 1))
            finally:
                self._last_call = time.monotonic()
        raise WikipediaError("도달할 수 없는 경로")

    def fetch(self, index_name: str) -> Page:
        title = PAGES[index_name]
        payload = self._get({
            "action": "parse", "page": title, "prop": "wikitext|revid",
            "format": "json", "formatversion": "2",
        })
        if "parse" not in payload:
            raise WikipediaError(f"{title} 응답에 parse가 없습니다: {payload}")
        return Page(
            index_name=index_name,
            title=title,
            revision=int(payload["parse"]["revid"]),
            wikitext=payload["parse"]["wikitext"],
        )

    def revision_at(self, index_name: str, when: str) -> tuple[int, str] | None:
        """그 날짜 이전의 가장 최근 판. `(revid, 판 날짜)`."""
        payload = self._get({
            "action": "query", "prop": "revisions", "titles": PAGES[index_name],
            "rvlimit": 1, "rvstart": f"{when}T00:00:00Z", "rvdir": "older",
            "rvprop": "ids|timestamp", "format": "json", "formatversion": "2",
        })
        pages = (payload.get("query") or {}).get("pages") or []
        revisions = pages[0].get("revisions") if pages else None
        if not revisions:
            return None
        return int(revisions[0]["revid"]), str(revisions[0]["timestamp"])[:10]

    def fetch_revision(self, revid: int) -> str:
        payload = self._get({
            "action": "parse", "oldid": revid, "prop": "wikitext",
            "format": "json", "formatversion": "2",
        })
        if "parse" not in payload:
            raise WikipediaError(f"판 {revid} 응답에 parse가 없습니다")
        return payload["parse"]["wikitext"]


# --------------------------------------------------------------------------
# 과거 판 스냅샷 — "Selected changes"가 빠뜨린 사건을 되찾는다
# --------------------------------------------------------------------------
#
# 변경 이력 표는 **사건 목록**이라 빠질 수 있고 제목이 문자 그대로 "Selected changes"다.
# 반면 구성원 표는 **그 시점의 전체 목록**이라 빠질 수가 없다. 문서의 과거 판에서 그 표를
# 읽어 연속한 두 판을 비교하면 편입과 편출이 둘 다 나온다.
#
# 2026-08-09 실측: 2008~2014 사건 375건 중 **196건이 변경 이력 표에 없었다.** 빠진 편출에
# 베어스턴스·워싱턴뮤추얼·메릴린치·GM·서킷시티가 들어 있다. 2008년 금융위기의 사망자들이
# 통째로 빠져 있었고, 그것이 정확히 생존편향이다.

SNAPSHOT_CSV_COLUMNS = ("date", "index_name", "action", "symbol", "source", "revid")
SNAPSHOT_SOURCE = "snapshot"


@dataclass(frozen=True)
class Snapshot:
    """한 시점의 구성원 목록."""

    index_name: str
    revid: int
    date: str
    symbols: frozenset[str]


def constituent_symbols(wikitext: str) -> frozenset[str]:
    """구성원 표의 티커 집합.

    **행의 첫 칸만 본다.** 셀마다 줄을 바꾸는 서식에서 모든 `|` 줄을 행으로 보면 GICS
    섹터·본사 같은 다른 칸까지 티커로 줍는다(2022년 판이 503개 대신 572개로 나왔다).
    행 경계는 `|-`다.

    표를 id로 찾지 않는 이유는 `id="constituents"`가 2019년쯤에야 붙었기 때문이다.
    대신 티커가 400~600개 나오는 표를 고른다.
    """
    best: frozenset[str] = frozenset()
    for block in re.findall(r"\{\|.*?\n\|\}", wikitext, re.S):
        found: set[str] = set()
        fresh = True
        for line in block.splitlines():
            if line.startswith("|-"):
                fresh = True
                continue
            if not line.startswith("|") or line.startswith("|+") or line.startswith("|}"):
                continue
            if not fresh:
                continue
            fresh = False
            ticker = _snapshot_ticker(line)
            if ticker:
                found.add(ticker)
        if 400 <= len(found) <= 600 and len(found) > len(best):
            best = frozenset(found)
    return best


_TICKER = re.compile(r"^[A-Z][A-Z0-9]{0,5}([.\-][A-Z])?$")


def _snapshot_ticker(line: str) -> str | None:
    """행의 첫 칸에서 티커를 뽑는다. 판마다 서식이 다르다."""
    body = line.lstrip("|").strip()
    found = re.match(r"\{\{[^|}]+\|([^}|]+)\}\}", body)
    if found:
        return _symbol(found.group(1))
    found = re.match(r"\[\[[^\]|]*\|?([^\]|]+)\]\]", body)
    if found and _TICKER.match(found.group(1).strip().upper()):
        return _symbol(found.group(1))
    plain = re.split(r"\|\||\t", body)[0].strip().strip("[]").upper()
    plain = re.sub(r"\s+", "", plain)
    return plain.replace(".", "-") if _TICKER.match(plain) else None


# 구성원 표에만 잠깐 나타나는 비구성원 티커. 지수 사건이 아니라 표기 부산물이다.
# **근거 없이 넣지 않는다** — 벤더 목록에 본선 티커가 따로 있는 것을 확인한 것만 넣는다.
SNAPSHOT_IGNORED = (
    ("KRFTV", "Kraft Foods Group 분사 때의 when-issued 라인. 벤더에는 본선 `KRFT`만 있다"),
    ("NAVIV", "Navient 분사 때의 when-issued 라인. 벤더에는 본선 `NAVI`만 있다"),
    ("SGPPRB", "Schering-Plough 우선주(`PR`). 7.2가 배제하는 증권 종류다"),
)


def _snapshot_dropped(index_name: str) -> frozenset[str]:
    """스냅샷 사건에서 뺄 심볼.

    `EXCLUDED_CHANGES`가 공고 행에만 걸려 있으면 **스냅샷으로 다시 새어 들어온다.**
    `ACE`가 그랬다 — 옛 The Chubb Corporation이라 가격을 구할 수 없어 뺐는데, 구성원
    표에는 그대로 있으므로 diff가 같은 심볼을 되살렸다. 제외는 한 소스가 아니라 그
    심볼에 걸려야 한다.
    """
    excluded = {symbol for _, index, _, symbol, _ in EXCLUDED_CHANGES if index == index_name}
    return frozenset(excluded | {symbol for symbol, _ in SNAPSHOT_IGNORED})


def _class_key(symbol: str) -> str:
    """클래스 구분자를 지운 비교용 형태. `BF-B`·`BF.B`·`BFB`가 모두 `BFB`가 된다."""
    return symbol.replace("-", "").replace(".", "")


def canonical_spelling(members: frozenset[str] | set[str]) -> dict[str, str]:
    """비교용 형태 → 현재 구성원 표기.

    18년치를 손으로 고친 표라 클래스주 표기가 판마다 흔들린다. 그대로 두면 표기가
    바뀐 판마다 **가짜 편출+편입 쌍**이 생긴다(2012-08-30에 `remove BFB`와 `add BF-B`가
    같이 나왔다). 지수 사건이 아니라 철자 변경이다.

    기준은 현재 구성원 목록의 표기다. 벤더 조회가 필요 없고, 우리가 이미 신뢰하는
    소스이며, 같은 회사가 아니면 비교용 형태가 애초에 같아지지 않는다.
    """
    return {_class_key(symbol): symbol for symbol in members}


def snapshot_changes(
    snapshots: list[Snapshot],
    spelling: dict[str, str] | None = None,
) -> list[tuple[str, str, str, str, str, int]]:
    """연속한 두 스냅샷의 차이를 변경 사건으로 바꾼다.

    **날짜는 뒤쪽 판의 날짜다** — "늦어도 이 날에는 반영돼 있었다". 편입을 늦게 잡으면
    실제보다 늦게 거래 가능해져 기회를 잃을 뿐이지만, 편출을 늦게 잡으면 실제보다 오래
    보유하게 된다. 그 불확실성은 `source` 열로 드러내고 판정 전에 좁힐 수 있게 남긴다.

    티커는 개명을 적용한 뒤 비교한다. 안 그러면 개명이 편출+편입 한 쌍으로 잡힌다.
    """
    spelling = spelling or {}

    def normalize(index_name: str, when: str, value: str) -> str:
        renamed = apply_renames(index_name, when, value)
        return spelling.get(_class_key(renamed), renamed)

    events = []
    for earlier, later in zip(snapshots, snapshots[1:]):
        dropped = _snapshot_dropped(later.index_name)
        before = {normalize(earlier.index_name, earlier.date, value)
                  for value in earlier.symbols} - dropped
        after = {normalize(later.index_name, later.date, value)
                 for value in later.symbols} - dropped
        entered, left = after - before, before - after
        # 표기만 바뀐 것은 사건이 아니다. 현재 구성원에 없는 옛 클래스주는 위 정규화가
        # 못 잡으므로(`VIA-B`·`NWS-A`), 같은 단계에서 비교용 형태가 같은 편출·편입이
        # 함께 나오면 그 쌍을 지운다. `_drop_same_day_reuse`와 같은 판단이다.
        paired = {_class_key(value) for value in entered} & {
            _class_key(value) for value in left
        }
        for symbol in sorted(entered):
            if _class_key(symbol) in paired:
                continue
            events.append((later.date, later.index_name, "add", symbol, SNAPSHOT_SOURCE, later.revid))
        for symbol in sorted(left):
            if _class_key(symbol) in paired:
                continue
            events.append((later.date, later.index_name, "remove", symbol, SNAPSHOT_SOURCE, later.revid))
    return events


def snapshot_changes_csv(events: list[tuple[str, str, str, str, str, int]]) -> str:
    lines = [",".join(SNAPSHOT_CSV_COLUMNS)]
    for date_, index, action, symbol, source, revid in sorted(events, reverse=True):
        lines.append(f"{date_},{index},{action},{symbol},{source},{revid}")
    return "\n".join(lines) + "\n"


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
    lines += [
        "",
        "## 표에 있지만 우리가 뺀 것",
        "",
        "실체의 가격 계열을 어느 벤더 티커에서도 구할 수 없는 구간이다. 남겨두면 그 심볼이",
        "영원히 `missing_universe_symbols`에 남아 생존편향 blocker가 풀리지 않는다.",
        "**빠진 만큼 유니버스에 구멍이 있고, 구성원 수 불변식이 그 크기를 감시한다.**",
        "",
        "|지수|날짜|동작|심볼|근거|",
        "|---|---|---|---|---|",
    ]
    for date_, index, action, symbol, evidence in EXCLUDED_CHANGES:
        lines.append(f"|{index}|{date_}|{action}|{symbol}|{evidence}|")
    return "\n".join(lines) + "\n"
