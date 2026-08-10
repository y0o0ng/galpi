# 구성원 CSV의 출처

`2008-01-02` 이후의 변경만 담는다. 원 자료는 S&P Dow Jones Indices와 Nasdaq의
보도자료이고, 아래 문서의 표가 그 보도자료를 행마다 인용하는 색인이다.

|지수|문서|판(revision)|
|---|---|---|
|SP500|[List of S&P 500 companies](https://en.wikipedia.org/wiki/Special:PermanentLink/1368287955)|1368287955|
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
|SP500|CDAY|2024-02-02|DAY|Dayforce former_name 'Ceridian HCM Holding Inc.', 보도자료 'Ceridian to change ticker symbol to DAY on NYSE and TSX effective February 1'(2024-02-01)|
|SP500|RE|2023-07-11|EG|Everest Group former_name 'Everest Re Group, Ltd.', traded_as {{NYSE|EG}}. 표의 2023-07-10 행이 remove RE와 add EG를 같은 날 적어 그날이 교체일이다|
|SP500|FRE|2010-06-17|FMCC|Freddie Mac traded_as {{OTCQB|FMCC}}. 본문 'dropped a further 50% on June 16, 2010, when the stocks delisted due to falling below minimum share prices for the NYSE' — NYSE 폐지 다음 날부터 장외 티커를 쓴다|
|NDX100|RIMM|2013-02-04|BB|NDX 표 2012-12-24 행이 RIMM을 [[Research in Motion]]으로 적고, 그 문서는 BlackBerry Limited로 넘어가며 traded_as {{NASDAQ|BB}}다. 본문 'ticker symbols on the TSX and NASDAQ already were changed to BB and BBRY respectively on February 4, 2013'. **BBRY가 아니라 BB로 보내는 이유**는 벤더 계열이 그쪽에 전 이력을 담기 때문이다(BB.US 1999-02-04~현재, BBRY.US는 2018-03-29에 끊긴다)|
|NDX100|UAUA|2010-10-01|UAL|UAL Corporation traded_as {{NASDAQ was|UAUA}}, successor 'United Airlines Holdings, Inc.', fate 'Merged with Continental Airlines'(2010-10-01). S&P 구성원 표가 United Airlines Holdings를 {{NasdaqSymbol|UAL}}로 적는다|
|NDX100|WFMI|2010-12-20|WFM|NDX 표 2008-12-22 행이 WFMI를 [[Whole Foods Market]]으로 적고, 그 문서는 traded_as {{NASDAQ was|WFM}}에 'The company's ticker symbol on the Nasdaq was WFM'이다. 정확한 티커 변경일은 확인하지 못해 **표에서 WFM 사용이 확인되는 가장 이른 날짜**(2010-12-20 편입)를 쓴다|
|NDX100|HANS|2012-01-05|MNST|Monster Beverage former_name 'Hansen Natural Corporation (1935 - 2012)', 본문 'On January 5, 2012 ... change the name of the company from Hansen's Natural to Monster Beverage Corporation, under the new ticker MNST'|
|SP500|AOC|2012-01-01|AON|Aon plc의 현재 티커가 AON이고 벤더 계열이 2006-01-03부터 이어진다. 옛 티커 AOC는 벤더 목록에 없다|
|SP500|CZN|2008-07-31|FTR|Frontier Communications former_name에 'Citizens Communications'가 있다. **FYBR가 아니라 FTR이다** — FYBR는 2021년 회생 이후 계열(2021-05-04~)이라 그 시절 구간을 못 덮고, FTR가 2006-01-03~2020-04-29로 덮는다|
|SP500|WMI|2009-09-01|WM|Waste Management traded_as {{NYSE|WM}}, former_name 'USA Waste Services, Inc.'|
|SP500|LIZ|2012-05-15|KATE|Kate Spade & Company의 옛 이름이 Liz Claiborne이다. 벤더에 KATE가 2006-01-03~2017-07-11로 있고 LIZ는 목록에 없다|
|SP500|MHFI|2016-06-01|SPGI|S&P Global former_name 'The McGraw–Hill Companies, Inc. (1995–2013)', traded_as {{nyse|SPGI}}|
|SP500|WPO|2013-11-29|GHC|Graham Holdings former_name 'The Washington Post Company (1947–2013)', traded_as {{NYSE|GHC}}|
|SP500|MXB|2010-08-01|MSCI|MSCI Inc. traded_as {{nyse|MSCI}}. 벤더의 MXB는 Marnetics Broadband라는 **다른 회사**이므로 그대로 두면 안 된다|
|SP500|UA-C|2017-01-01|UA|2016년 Under Armour 클래스 분할에서 Class C가 UA, Class A가 UAA를 받았다. 구성원 표가 잠깐 `UA-C`로 적었을 뿐 벤더 코드는 UA다|
|SP500|WFMI|2011-06-01|WFM|Whole Foods Market traded_as {{NASDAQ was|WFM}}. NDX100 항목과 같은 근거다|
|NDX100|MNST|2011-12-16|MWW|S&P 표 2011-12-16 행이 [[Monster Worldwide]]를 MWW로, NDX 표 2008-11-10 행이 같은 회사를 MNST로 적는다. 정확한 티커 변경일은 확인하지 못해 **MWW 사용이 확인되는 가장 이른 날짜**를 쓴다|
|SP500|FPL|2010-07-29|NEE|NextEra Energy former_name 'FPL Group'. 벤더 NEE 계열 2006-01-03~현재가 구간(2008-01-02~2010-07-28)을 통째로 덮는다|
|SP500|GCI|2015-06-30|TGNA|2015년 Gannett 분할에서 방송을 남긴 존속법인이 TEGNA로 개명하고 출판이 새 Gannett으로 분사했다. 벤더 TGNA 계열 2006-01-03~2026-03-20이 구간을 덮고, 분사한 새 Gannett은 GCI_OLD(2015-06-23~)로 따로 있다|
|SP500|HCN|2018-03-01|WELL|Welltower former_name 'Health Care REIT, Inc.'. 벤더 WELL 계열 2006-01-03~현재가 구간(2009-03-19~2018-02-28)을 덮는다|
|SP500|HCP|2019-11-30|DOC|Healthpeak Properties의 옛 이름이 HCP, Inc.이고 2019-11 PEAK, 2024-03 DOC로 바뀌었다. 벤더 DOC 계열 2006-01-03~현재가 구간(2008-08-30~)을 덮는다|
|SP500|PEAK|2024-03-29|DOC|같은 회사의 두 번째 티커 변경이다. 벤더의 PEAK 코드는 2012-10-17~2019-09-16의 **다른 회사**라 그대로 두면 구간이 그 가격을 받는다|
|SP500|IACI|2008-08-31|IAC|IAC/InterActiveCorp의 현재 벤더 코드가 IAC(2006-01-03~2026-06-03)다. IACI 코드에는 2016-01-04~2016-01-20의 13행짜리 토막만 있다|
|NDX100|IACI|2009-12-22|IAC|SP500 항목과 같은 회사·같은 근거다. 지수마다 편출일이 달라 규칙을 따로 건다|
|SP500|LB|2021-08-29|BBWI|Bath & Body Works former_name 'L Brands'. 벤더 BBWI 계열 2006-01-03~현재가 구간(2013-12-29~2021-08-28)을 덮는다|
|SP500|PX|2018-11-28|LIN|2018년 Praxair와 Linde AG 합병으로 만들어진 Linde plc가 PX 주주의 이력을 잇는다. 벤더 LIN 계열 2006-01-03~현재가 구간을 덮는다|
|SP500|SAI|2013-10-28|LDOS|2013년 SAIC 분할에서 존속법인이 Leidos로 개명하고 정부서비스가 새 SAIC로 분사했다. 벤더 LDOS 계열 2006-10-13~현재가 구간(2009-12-18~2013-09-20)을 덮는다. LDOS는 2019-08-09에 다시 편입되므로 구간이 둘로 떨어진다|
|SP500|WLP|2014-12-30|ELV|Elevance Health의 옛 이름이 WellPoint(2014-12 Anthem, 2022-06 Elevance)다. 벤더 WLP 코드에는 2014-09-22~2014-12-02의 두 달짜리 토막만 있고, ELV 계열 2006-01-03~현재가 구간(2008-01-02~2014-12-29)을 덮는다|
|SP500|ANTM|2022-06-30|ELV|같은 회사의 두 번째 이름이다. ANTM 계열(2006-01-03~2022-06-27)도 구간을 덮지만, 사슬을 한 심볼로 모아야 구간이 끊기지 않는다|

|지수|날짜|동작|심볼|근거|
|---|---|---|---|---|
|SP500|2015-03-23|add|AGN|옛 Allergan, Inc.가 이날 편출되고 Actavis plc가 Allergan plc로 개명하며 같은 AGN 티커를 이어받았다(Allergan plc predecessors: 'Allergan, Inc. and Actavis'). 두 실체를 심볼 공간에서 가를 수 없어 같은 날 이어지는 것으로 본다.|

## 표에 있지만 우리가 뺀 것

실체의 가격 계열을 어느 벤더 티커에서도 구할 수 없는 구간이다. 남겨두면 그 심볼이
영원히 `missing_universe_symbols`에 남아 생존편향 blocker가 풀리지 않는다.
**빠진 만큼 유니버스에 구멍이 있고, 구성원 수 불변식이 그 크기를 감시한다.**

|지수|날짜|동작|심볼|근거|
|---|---|---|---|---|
|SP500|2016-01-19|remove|ACE|이 행의 실체는 ACE가 아니라 **옛 The Chubb Corporation**이고 그 가격 계열이 벤더에 없다. 표 원문은 'EXR replaces ACE as ACE Ltd acquires Chubb and retains the CB ticker, giving up ACE'인데, 여기서 지수를 떠난 것은 피인수된 Chubb Corp 이고 ACE Ltd는 CB 티커로 남았다. EODHD `CB.US`는 ACE Ltd의 계열이다 — 인수 발표일(2015-07-01)에 거래량만 1.8→17.6M으로 뛰고 종가는 101.68→102.49로 평평했다(피인수 기업이면 그날 +25%였어야 한다). `search/Chubb`에 옛 Chubb Corp 계열이 없어 2008-01-02~2016-01-19 구간의 가격을 구할 방법이 없다|
