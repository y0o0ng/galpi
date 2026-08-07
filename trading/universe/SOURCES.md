# 구성원 CSV의 출처

`2008-01-02` 이후의 변경만 담는다. 원 자료는 S&P Dow Jones Indices와 Nasdaq의
보도자료이고, 아래 문서의 표가 그 보도자료를 행마다 인용하는 색인이다.

|지수|문서|판(revision)|
|---|---|---|
|SP500|[List of S&P 500 companies](https://en.wikipedia.org/wiki/Special:PermanentLink/1368131466)|1368131466|
|NDX100|[List of NASDAQ-100 companies](https://en.wikipedia.org/wiki/Special:PermanentLink/1368041570)|1368041570|

## 표에 없어서 우리가 더한 것

위키 표의 편집 지침이 티커 변경을 지수 변경으로 보지 않으므로 개명은 표에 없다.
`wikipedia.SYMBOL_RENAMES`가 그것을 현재 벤더 티커로 옮기고, `CORRECTIONS`가
표에 없는 사건을 근거와 함께 더한다. 두 목록 모두 항목마다 근거를 달았다.

|지수|옛 티커|이 날짜 이전|현재 티커|근거|
|---|---|---|---|---|
|SP500|FB|2022-06-09|META|Meta Platforms traded_as {{NASDAQ|META}}, 옛 이름 Facebook|
|SP500|PCLN|2018-02-27|BKNG|Booking Holdings former_name 'Priceline.com Incorporated (1998–2014)'|
|SP500|KORS|2019-01-02|CPRI|Capri Holdings former_name 'Michael Kors Holdings Limited', traded_as NYSE|CPRI|
|SP500|DLPH|2017-12-05|APTV|Aptiv former_name 'Delphi Automotive plc (2011–2017)', traded_as NYSE|APTV|
|SP500|HRS|2019-07-01|LHX|L3Harris는 2019-06-29 L3와 Harris 합병으로 만들어졌고 traded_as NYSE|LHX|
|SP500|COG|2021-10-01|CTRA|Coterra predecessors 'Cabot Oil & Gas Corporation, Cimarex Energy'|
|SP500|SATS|2026-08-07|ECHO|EchoStar traded_as {{NASDAQ|ECHO}}, 현재 S&P 500 구성원 티커가 ECHO|
|SP500|IR|2020-03-02|TT|Trane Technologies: 2020년 공구 사업을 Ingersoll Rand로 분사하고 남은 회사가 개명|
|SP500|UA|2016-04-08|UAA|2016-04-08 'Under Armour distribution of second class of stock'로 새 클래스가 UA를 받았다|
|SP500|JOYG|2015-10-07|JOY|NASDAQ→NYSE 이전에 따른 티커 변경으로 추론(직접 인용 없음)|
|NDX100|KFT|2012-10-02|MDLZ|S&P 표의 2012-10-02 행이 'Old Kraft Foods renamed Mondelez'라고 적는다|
|NDX100|PCLN|2018-02-27|BKNG|Booking Holdings former_name 'Priceline.com Incorporated (1998–2014)'|
|NDX100|NWSA|2013-06-28|FOXA|21st Century Fox predecessor 'News Corporation', traded_as FOXA (Class A, 2013–2019)|

|지수|날짜|동작|심볼|근거|
|---|---|---|---|---|
|SP500|2015-03-23|add|AGN|옛 Allergan, Inc.가 이날 편출되고 Actavis plc가 Allergan plc로 개명하며 같은 AGN 티커를 이어받았다(Allergan plc predecessors: 'Allergan, Inc. and Actavis'). 두 실체를 심볼 공간에서 가를 수 없어 같은 날 이어지는 것으로 본다.|
