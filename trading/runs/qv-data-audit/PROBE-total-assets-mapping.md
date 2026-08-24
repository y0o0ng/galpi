# Phase 0 정찰 — Total Assets accounting mapping

> **READ-ONLY 연구 기록이다.** 프로덕션 코드·schema·테스트·run-card를 바꾸지 않았고
> 로드맵과 canonical README도 건드리지 않았다. **수익률·QV rank·coverage Gate를 0번
> 계산했다.** 이 문서는 결정을 내리지 않고 **정본을 고를 근거**를 모은다.

`README.md` §3.2가 open으로 남긴 `Total Assets` mapping을 정찰한다. 형식은
`PROBE-me-source.md`·`PROBE-gross-profit-mapping.md`를 따른다.

---

## 1. 조사 기준 latest main SHA

```text
128f8d94a8e990924f361cb28bd0cb80e8e2f9f7
docs(qv): Gross Profit accounting contract를 동결한다
```

`git fetch origin main` 후 `origin/main`·로컬 `HEAD`가 같고 working tree는 깨끗했다.
설계자가 마지막으로 확인한 SHA와 **동일하다** — 그 사이 새 커밋은 없다.

읽은 문서·코드: `docs/trading/strategies/quality-value-roadmap.md`(§4.1·§4.2·§4.2.1),
`trading/runs/qv-data-audit/README.md`(§3.1·§3.2·§3.6·§7),
`PROBE-gross-profit-mapping.md`, `PROBE-me-source.md`,
`trading/backtest/qv_submissions.py`, `trading/backtest/edgar.py`,
`trading/backtest/schema.sql`.

---

## 2. 조사 목적과 이미 FROZEN인 계약

**묻는 것**

> **GPA denominator인 Total Assets를, 그 시점 이후 정보를 쓰지 않고 결정론적으로
> 복원할 경로가 존재하는가?**

**다시 열지 않은 것** (로드맵 §4.1·§4.2·§4.2.1, README §3.1·§3.6)

```text
Revenue        = consolidated total revenue
Gross Profit   = consolidated total revenue - COGS      (direct GP는 diagnostic only)
GPA            = Gross Profit / Total Assets
accounting     annual 10-K family · fiscal period end가 calendar t-1 안
PIT            historical_usable_session(filing) <= formation session
filing 선택     README §3.1 (acceptance 최신 · 동률이면 accession 사전순 마지막)
custom tag      이름 유사도 자동 mapping 금지
dimension-only  COGS 합산 금지 -> MISSING
```

**Total Assets에 이미 고정된 것은 `Total Assets <= 0`은 invalid 하나뿐이고, 어떤 fact를
canonical로 쓸지는 이 정찰 시점에 OPEN이다.**

---

## 3. 표본

`PROBE-gross-profit-mapping.md`의 16개 발행사를 재사용하고 **Assets 특유의 실패 모양**을
노릴 6개를 더했다. **22개 발행사 · 23개 CIK**다.

|issuer|CIK|성격|추가 이유|
|---|---|---|---|
|Apple|`0000320193`|기술 하드웨어|재작성 이력(ASU 2009-13)|
|Microsoft|`0000789019`|소프트웨어|6월 결산 · ASC 606 소급|
|Amazon|`0001018724`|리테일+클라우드|GP probe 재사용|
|Walmart|`0000104169`|리테일러|1월 결산|
|Caterpillar|`0000018230`|산업재+금융자회사|GP probe에서 함정 발견된 발행사|
|Boeing|`0000012927`|항공우주|ASC 606 소급 대규모|
|Johnson & Johnson|`0000200406`|헬스케어|52/53주 결산|
|Pfizer|`0000078003`|제약|분사·중단사업|
|Exxon Mobil|`0000034088`|에너지|GP가 구조적으로 불가했던 발행사|
|Procter & Gamble|`0000080424`|소비재|6월 결산 · 초기 XBRL이 `.xml` R 파일|
|Coca-Cola|`0000021344`|음료|GP probe 재사용|
|Verizon|`0000732712`|통신|GP가 차원 전용이던 발행사|
|Costco|`0000909832`|창고형 리테일|8월 결산 · 52/53주|
|Home Depot|`0000354950`|하드라인 리테일|1월 결산|
|Intel|`0000050863`|반도체|52/53주|
|Walt Disney (현)|`0001744489`|미디어|CIK 교체|
|Walt Disney (구)|`0001001039`|미디어|CIK 교체 전 이력|
|**Union Pacific**|`0000100885`|철도|**capital-intensive**|
|**NextEra Energy**|`0000753308`|유틸리티|**co-registrant(FPL) 결합 10-K · 미분류 대차대조표**|
|**Kraft Heinz**|`0001637459`|소비재|**대규모 재작성(2019) · guarantor 표**|
|**General Electric**|`0000040545`|복합기업|**재작성 다수 · 금융 부문 연결**|
|**Comcast**|`0001166691`|미디어|**guarantor subsidiary**|
|**Danaher**|`0000313616`|산업재|**acquisition-heavy · 정밀도 변경 이력**|

기간: 초기 XBRL(fiscal 2007~2012 · filed 2009-10~2010-10), 중기(2013~2017),
최근(2023~2026). **10-K 계열 accession 370개**를 다뤘다.

> **이 표본은 representative coverage estimate가 아니다.** systematic failure mode를
> 찾기 위한 **adversarial reconnaissance**이고, Gate A~H는 여기서 판정하지 않는다.

### 3.1 임시 스크립트 (프로덕션 아님 · 커밋하지 않음)

전부 scratchpad에 있다. SEC JSON·filing·cache·CSV도 커밋하지 않았다.

|파일|한 일|
|---|---|
|`fetch.py` / `fetch2.py`|23개 CIK의 companyfacts JSON 캐시|
|`assets.py`|`us-gaap:Assets` 등 instant fact 추출 (10-K 계열 · `start` 없음)|
|`subs.py`|`submissions` recent+archive에서 accession별 `form`·`filed`·`reportDate`·`acceptanceDateTime`|
|`filing.py`|`FilingSummary.xml` → `R*.htm`/`R*.xml`에서 **표시 라벨 ↔ XBRL 요소명 ↔ role** 대조|
|`scan_assets.py`|한 accession의 모든 R 리포트에서 `us-gaap:Assets` 등장 위치 전수 탐색|

---

## 4. Total Assets tag inventory

### 4.1 EVIDENCE — `us-gaap:Assets`는 보편적이다

10-K 계열 instant fact 기준.

```text
us-gaap:Assets 존재 발행사        23 / 23 CIK
unit                              USD 단독 (다른 unit 0건)
issuer custom asset 개념           0건
dimension-only(무차원 부재) 사례    0건
```

|iss|Assets instant fact|distinct instant|최초 filing|
|---|---|---|---|
|AAPL|38|18|2009-10-27|
|AMZN|45|18|2010-01-29|
|BA|34|18|2010-02-08|
|CAT|44|19|2010-02-19|
|CMCSA|34|18|2010-02-23|
|COST|48|18|2010-10-18|
|DHR|49|18|2010-02-24|
|DIS|14|8|2019-11-20|
|DISo|20|11|2009-12-02|
|GE|41|18|2010-02-19|
|HD|34|18|2010-03-25|
|INTC|34|18|2010-02-22|
|JNJ|39|18|2010-03-01|
|KHC|28|18|2016-03-03|
|KO|34|18|2010-02-26|
|MSFT|34|18|2010-07-30|
|NEE|47|18|2010-02-26|
|PFE|34|18|2010-02-26|
|PG|52|19|2010-08-13|
|UNP|34|18|2010-02-05|
|VZ|34|18|2010-02-26|
|WMT|48|18|2010-03-30|
|XOM|50|18|2010-02-26|

**초기 XBRL(2009~2012)도 막히지 않는다.** 각 발행사의 **첫 XBRL 10-K부터** `us-gaap:Assets`가
있다. KHC(2016)·DIS 신 CIK(2019)는 XBRL 결손이 아니라 **법인 생성/CIK 교체** 시점이다.

**이것이 Gross Profit과 결정적으로 다른 점이다.** GP 정찰에서 Exxon Mobil은 전 기간
표준 COGS 개념이 아예 없었고 Verizon·Disney는 COGS가 차원에만 있었다. **Total Assets에는
그 두 blocker가 하나도 없다.**

### 4.2 EVIDENCE — 이름이 닮은 오탐 후보

표본에서 이름에 `asset`이 든 개념 중 annual 10-K instant fact를 가진 것은 **266개**다.
발행사 수 상위 일부:

```text
23  us-gaap:Assets                     <- 정본 후보
23  us-gaap:AssetsCurrent
23  us-gaap:DeferredTaxAssetsOther
23  us-gaap:OtherAssetsNoncurrent
22  us-gaap:OperatingLeaseRightOfUseAsset
19  us-gaap:FiniteLivedIntangibleAssetsAccumulatedAmortization
11  us-gaap:AssetsOfDisposalGroupIncludingDiscontinuedOperationCurrent
 9  us-gaap:NoncurrentAssets
 9  us-gaap:DefinedBenefitPlanFairValueOfPlanAssets
```

**INTERPRETATION**: 이름 유사도 매칭은 여기서도 위험하다. 다만 GP와 성격이 다르다 — GP는
**어떤 개념 이름이 맞는지 자체가 모호**했지만, Total Assets는 **`us-gaap:Assets`라는 정확한
개념 하나**가 보편적이라 exact-name 매칭만으로 위 266개가 전부 배제된다. 위험은 개념 선택이
아니라 **같은 개념이 어디에 쓰였는가**로 옮겨간다(§5).

### 4.3 EVIDENCE — fallback 후보는 실증적으로 나쁘다

```text
us-gaap:AssetsCurrent      730 facts
us-gaap:AssetsNoncurrent    55 facts   <- AAPL·NEE·JNJ·DISo에 편중
```

`Assets == AssetsCurrent + AssetsNoncurrent`가 **계산 가능한 경우가 869건 중 54건(6.2%)**
뿐이고, **그중 exact는 28건(51.9%)**이다. NEE는 34건 중 12건만 맞는다(미분류 대차대조표).

**INTERPRETATION**: 프롬프트가 미리 경고한 기계적 reconstruction은 **필요하지도 않고
작동하지도 않는다.** `us-gaap:Assets`가 없는 issuer-year를 표본에서 한 건도 찾지 못했으므로
fallback을 발명할 근거가 없다.

---

## 5. consolidated balance-sheet role 조사

### 5.1 EVIDENCE — `us-gaap:Assets`는 대차대조표 밖에도 무차원으로 나온다

**Walmart FY2026** (`0000104169-26-000055`) — `us-gaap:Assets` 등장 R 리포트 2개:

```text
R5.htm    9952153 - Statement  - Consolidated Balance Sheets
              Total assets   284,668 / 260,823                       (2 instants)
R73.htm   9955560 - Disclosure - Segments and Disaggregated Revenue
                                 - Schedule of Segment Reporting ... (Details)
              Total assets   284,668 / 260,823 / 252,399             <- 무차원 합계 행 · 3년치
              Total assets   165,627 / ...                           <- 세그먼트 행(차원 있음)
```

**세그먼트 주석의 무차원 합계 행이 3년치를 담기 때문에** companyfacts에 **세 번째 instant**가
생긴다. 표본 전체에서 이 패턴이 반복된다.

**Kraft Heinz FY2018** (`0001637459-19-000049`) — 등장 R 리포트 **4개**:

```text
R4.htm     1003000 - Statement  - Consolidated Balance Sheets
R58.htm    2402405 - Disclosure - Restatement of Previously Issued Consolidated
                                  Financial Statements ... Balance Sheets (Details)
R151.htm   2446405 - Disclosure - Quarterly Financial Data (Unaudited)
                                  Condensed Consolidated Quarterly Balance Sheets (Details)
R156.htm   2447403 - Disclosure - Supplemental Guarantor Information
                                  Condensed Consolidating Balance Sheets (Details)
```

이 filing 하나의 companyfacts에 **무차원 Assets instant가 8개** 들어온다.

```text
2017-04-01  120,946   frame=CY2017Q1I
2017-07-01  119,322   frame=CY2017Q2I
2017-09-30  119,902   frame=CY2017Q3I
2017-12-30  120,092   frame=CY2017Q4I
2018-03-31  120,583
2018-06-30  121,749
2018-09-29  119,575
2018-12-29  103,461   <- 실제 회계연도 말
```

**분기 instant는 재작성 주석·분기 주석에서 온다.** 대차대조표에는 없다.
`frame=CY2017Q1I`이 주석 값에 붙어 있어 **`frame`은 품질 신호가 아니다** — GP 정찰의
CAT·COST 사례와 같은 결론이다.

guarantor 표(R156)에는 **음수 TOTAL ASSETS**(`-128,833`·`-157,891`·`-158,080` = elimination
열)와 parent/guarantor/non-guarantor 열이 있다. **이들은 차원이 붙어 있어 companyfacts에는
오지 않는다.**

**NextEra Energy FY2025** (`0000753308-26-000015`) — 등장 R 리포트 4개이고, **가장 위험한
모양은 Statement role 안에 있다**:

```text
R6.htm    CONSOLIDATED BALANCE SHEETS   (Statement)
              TOTAL ASSETS   212,721 / 190,144      <- NEE 연결
              TOTAL ASSETS   105,158 /  98,141      <- co-registrant FPL 연결
R79.htm   Equity Method Investments (Details)       (Disclosure)
R80.htm   Variable Interest Entities (VIEs) (Details) (Disclosure)
R108.htm  Segment Information (Details)             (Disclosure)
```

**NEE 결합 10-K의 Statement role 대차대조표에는 자회사 FPL의 총자산이 함께 있다.**
확인 결과 FPL의 `105,158,000,000`은 **NEE companyfacts의 무차원 fact에 존재하지 않는다** —
`LegalEntityAxis` 차원이 붙어 있어 걸러진다.

### 5.2 EVIDENCE — `Statement` / `Disclosure` 구분은 세 era 모두에서 작동한다

`FilingSummary.xml`의 `<LongName>`이 role 종류를 접두어로 갖는다.

```text
WMT  FY2026 (htm)   R5  = "9952153 - Statement  - Consolidated Balance Sheets"
                    R73 = "9955560 - Disclosure - Segments ... (Details)"
KHC  FY2018 (htm)   R4  = "1003000 - Statement  - Consolidated Balance Sheets"
                    R58/R151/R156 = "... - Disclosure - ..."
PG   FY2010 (xml)   ReportLongName = "104 - Statement - CONSOLIDATED BALANCE SHEETS"
                    전체 78개 리포트 분포 = Statement 6 · Disclosure 70 · Document 1 · 기타 1
```

초기 XBRL은 `R*.xml`(`<InstanceReport>`), 최근은 `R*.htm`이지만 **`Statement` / `Disclosure`
관례는 2010년 filing에도 이미 있다.**

**INTERPRETATION**: `Statement` role + **무차원** 두 조건을 함께 걸면 이번에 찾은 오염
경로가 전부 제거된다 — 세그먼트 주석 합계 행(WMT), 재작성·분기 주석(KHC), guarantor
연결표(KHC), VIE·지분법 주석(NEE)은 모두 `Disclosure`이고, Statement role 안의 co-registrant
값(NEE FPL)은 차원으로 걸린다. **어느 한 조건만으로는 부족하다.**

---

## 6. instant / comparative / restatement 패턴

### 6.1 EVIDENCE — 회계연도 말 instant 앵커

370개 10-K accession에 대해 `submissions`의 `reportDate`와 companyfacts instant를 대조했다.

```text
reportDate와 정확히 같은 instant를 가진 accession   369 / 370   (99.73%)
가장 늦은 instant == reportDate                     369 / 370   (99.73%)
```

비12월 결산도 정확하다.

```text
COST  0000909832-25-000101   reportDate 2025-08-31   (8월 결산)
PG    0000080424-26-000103   reportDate 2026-06-30   (6월 결산)
KHC   0001637459-19-000049   reportDate 2018-12-29   (52/53주 · instant 8개 중 하나로 특정됨)
AAPL  0001193125-09-214859   reportDate 2009-09-26   10-K
AAPL  0001193125-10-012091   reportDate 2009-09-26   10-K/A  <- 같은 기간 · 다른 accession
```

**유일한 실패**:

```text
GE  0000040545-15-000030   form=10-K  filed=2015-02-27
      reportDate = 2015-02-27      <- 제출일과 같다. 회계연도 말이 아니다
      instants   = [2013-12-31, 2014-12-31]
```

같은 filing 원문의 `R1.htm`에는 **`dei:DocumentPeriodEndDate = Dec. 31, 2014`** 로 올바르게
있다. 그리고 **`dei:DocumentPeriodEndDate`는 companyfacts에 오지 않는다** — 표본의 companyfacts
`dei` namespace에는 `EntityCommonStockSharesOutstanding`·`EntityPublicFloat` 둘뿐이다.

### 6.2 EVIDENCE — 한 accession이 후보를 여럿 준다

```text
Assets instant가 2개인 accession   246 / 370
3개 이상인 accession               124 / 370   (33.5%)
최대                               8개 (KHC 0001637459-19-000049)
```

3번째 instant는 §5.1대로 **세그먼트 주석의 무차원 합계 행**이 대부분이다.

**같은 `(accession, instant, unit)`에 서로 다른 Assets 값이 있는 사례는 0건이다.**
즉 키잉 자체는 결정적이고, 위험은 **후보가 여럿이라는 것**이다.

### 6.3 EVIDENCE — 재작성은 흔하고, 세 종류다

같은 instant인데 accession마다 Assets 값이 다른 사례가 **59개 instant**(22개 발행사 중 20개)다.

```text
BA    2017-12-31   0000012927-18-000007  92,333   ->  0000012927-19-000010  112,362   +21.7%
AAPL  2009-09-26   0001193125-09-214859  53,851   ->  0001193125-10-012091   47,501   -11.8%
AAPL  2008-09-27   0001193125-09-214859  39,572   ->  0001193125-10-012091   36,171    -8.6%
BA    2014-12-31   0000012927-15-000011  99,198   ->  0000012927-16-000099   92,921    -6.3%
GE    2023-12-31   0000040545-24-000027 163,045   ->  0000040545-25-000015  173,300    +5.9%
MSFT  2017-06-30   0001564590-17-014900 241,086   ->  0001564590-18-019062  250,312    +3.7%
GE    2017-12-31   0000040545-18-000014 377,945   ->  0000040545-19-000014  369,245    -2.3%
```

세 종류가 섞여 있다.

|종류|예|크기|
|---|---|---|
|**회계기준 소급적용**|BA·MSFT의 ASC 606, AAPL의 ASU 2009-13|**-11.8% ~ +21.7%**|
|**재분류·수정**|GE 14개 instant · NEE 4 · CAT 4 · WMT 4|0.04% ~ 5.9%|
|**표시 정밀도 변경만**|DHR `29,949,447,000` → `29,949,500,000`, `47,832,500,000` → `47,833,000,000`|0.000% ~ 0.001%|

**INTERPRETATION**: DHR는 경제적 재작성이 아니라 **보고 정밀도(천 단위 → 십만/백만 단위)
변경**이다. 세 번째 종류를 재작성으로 읽으면 안 된다. 다만 PIT 계약은 셋을 **같은 방식으로**
다룬다 — formation까지 usable한 filing의 값을 쓴다.

### 6.4 EVIDENCE — 기존 PIT 계약으로 look-ahead가 차단되는가

Boeing FY2017이 가장 위험한 사례다.

```text
0000012927-18-000007  10-K  acceptance 2018-02-12T19:31:00Z   Assets(2017-12-31) =  92,333
0000012927-19-000010  10-K  acceptance 2019-02-08T18:10:39Z   Assets(2017-12-31) = 112,362
```

formation 2018년 6월은 `historical_usable_session <= formation`으로 **2018-02-12 filing만**
볼 수 있다. 2019년 filing의 112,362를 쓰면 **denominator가 21.7% 부풀어 GPA가 18% 낮아진다.**

Apple은 정정본 경계다.

```text
0001193125-09-214859  10-K    acceptance 2009-10-27T20:18:29Z   Assets(2009-09-26) = 53,851
0001193125-10-012091  10-K/A  acceptance 2010-01-25T21:25:58Z   Assets(2009-09-26) = 47,501
```

```text
2009-10-28 ~ 2010-01-25 formation  -> 원본 10-K  -> 53,851
2010-01-26 이후 formation           -> 10-K/A     -> 47,501
```

**INTERPRETATION**: README §3.1(acceptance 최신 usable filing)과 §3.2 PIT 경계가 이 세 경우
(formation 전 amendment · formation 후 amendment · 다음 해 비교표시 restate)를 **추가 규칙
없이 전부 가른다.** Total Assets 때문에 새 PIT 규칙이 필요하다는 증거는 찾지 못했다.

**단 한 가지 조건이 있다**: 값을 고를 때 **companyfacts를 기간 전체로 훑어 "가장 최근 값"을
쓰면 안 되고**, 반드시 그 formation에서 선택된 **accession 안의** instant를 읽어야 한다.
companyfacts는 오늘 기준 DB이므로 미래 filing의 값이 같은 instant에 섞여 있다.

---

## 7. edge cases / blockers

|#|모양|근거|분류|
|---|---|---|---|
|B1|세그먼트 주석 무차원 합계 행이 3번째 instant를 만든다. 124/370 accession|WMT `0000104169-26-000055` `R73.htm`|`MULTIPLE_CANDIDATES`|
|B2|재작성·분기 주석이 무차원 분기 instant를 만든다. 한 filing에 8개|KHC `0001637459-19-000049` `R58.htm`·`R151.htm`|`MULTIPLE_CANDIDATES`|
|B3|guarantor 연결표에 음수 TOTAL ASSETS(elimination)|KHC 같은 accession `R156.htm`|차원으로 걸림 (companyfacts에 없음)|
|B4|**Statement role 대차대조표에 co-registrant 자회사 총자산이 함께 있다**|NEE `0000753308-26-000015` `R6.htm`|차원으로 걸림. **role만으로는 부족**|
|B5|**`submissions.reportDate`가 제출일과 같아 회계연도 말이 아니다**|GE `0000040545-15-000030`|`ANCHOR_FAILED` 1/370|
|B6|같은 instant가 후속 filing에서 최대 **+21.7%** 바뀐다|BA `0000012927-18-000007` vs `-19-000010`|`RESTATED` 59 instant|
|B7|정밀도 변경이 재작성처럼 보인다|DHR `0001193125-12-076756` vs `0000313616-13-000026`|`RESTATED`(경제적 아님)|
|B8|`frame`이 주석 값에 붙는다(`CY2017Q1I`)|KHC 분기 instant|`frame` 사용 불가|
|B9|초기 XBRL은 R 파일이 `.xml`(`InstanceReport`)이고 최근은 `.htm`|PG `0001193125-10-188769` `R3.xml`|파서 이중 지원 필요|
|B10|R 파일 조회 중 SEC `HTTP 503` 1건|NEE `R86.htm`|운영상 재시도 필요|

**찾지 못한 것**(표본 기준, 0건): `CUSTOM_ONLY` · `DIMENSION_ONLY` · `MISSING` ·
동일 `(accn, instant, unit)`의 값 충돌 · `Total Assets <= 0`인 무차원 fact.

### 7.1 회계연도 말 instant 기준 분류

각 10-K accession에서 `reportDate` instant의 Assets를 분류했다.

```text
전체 10-K accession                               370
DIRECT_CONSOLIDATED_ASSETS (L+SE exact)           369   (99.73%)
ANCHOR_FAILED (reportDate가 instant에 없음)          1   (GE)
TIEOUT_MISMATCH                                     0
NONPOSITIVE                                         0
NO_LSE_AT_FISCAL_END                                0
--- 별도 축 ---
MULTIPLE_CANDIDATES (>2 instants)                 124   (33.5%)
RESTATED (accession 간 값 불일치 instant)           59
```

---

## 8. validation 방법 조사

Total Assets에는 GP의 `Revenue − COGS` 같은 **독립 재구성이 없다.** 대신 세 가지를 시험했다.

### 8.1 EVIDENCE — `Assets == LiabilitiesAndStockholdersEquity`

```text
계산 가능        752 / 869 Assets fact   (86.5%)
그중 exact       752 / 752               (100.0%)
```

**가능한 곳에서는 한 건도 틀리지 않았다.** tolerance가 필요했던 사례가 0건이다.

계산 불가였던 **117건은 전부 그 accession 안에서 3번째로 최신인 instant**였다.

```text
그 accession 안 최신 순위별 분포:  3위 117건 · 1위 0건 · 2위 0건
```

즉 **대차대조표에 실린 두 instant는 예외 없이 `L+SE` 짝을 갖고, 세그먼트 주석에서 온
3번째 instant는 갖지 않는다.**

**한계**: KHC의 분기 주석 instant 8개는 **모두 `L+SE` 짝을 갖는다**(주석이 요약 대차대조표
전체를 싣기 때문). 따라서 `L+SE` 존재는 §7 B1은 걸러도 **B2는 못 거른다.**

**정밀도 변경(DHR)에서도 `L+SE`가 같이 반올림되어 tie-out은 깨지지 않는다**(DHR 34/34 exact).

### 8.2 EVIDENCE — `Assets == AssetsCurrent + AssetsNoncurrent`

```text
계산 가능         54 / 869   (6.2%)
그중 exact        28 / 54    (51.9%)
```

**검증 장치로도 재구성으로도 쓸 수 없다.** `AssetsNoncurrent`는 표본 전체에서 55건뿐이고
미분류 대차대조표(NEE·GE)에서는 개념 자체가 성립하지 않는다.

### 8.3 EVIDENCE — rendered statement 대조

`R*.htm`/`R*.xml`의 표시 숫자와 XBRL fact는 §5.1의 모든 사례에서 일치했다(WMT 284,668 ·
KHC 103,461 · NEE 212,721). **다만 렌더러가 부호를 뒤집어 보여주는 경우가 있어**(GP 정찰의
Disney 비용 라인) 표시 숫자를 값 비교의 정본으로 삼지 않는다. rendered statement의 가치는
**값 검증이 아니라 role·라벨 확인**이다.

---

## 9. 후보 deterministic mappings

> 아래는 **PROPOSED ARCHITECTURE**다. evidence가 아니다.

### 후보 A — companyfacts `us-gaap:Assets` + accession/instant 앵커

```text
선택된 accession 안의 무차원 us-gaap:Assets 중 instant == 회계연도 말
```

- **장점**: 새 파서가 없다. 표본에서 369/370이 맞는다.
- **발견된 failure mode**: B5(GE `reportDate` 오류)에서 앵커가 없다. B2(KHC)에서 비12월
  결산이라면 분기 주석 instant가 회계연도 말과 같은 calendar year에 들어와 후보가 된다.
  companyfacts가 차원을 버려주는 **우연에** 의존한다(B4는 그 덕에만 막힌다).
- **예상 missing 영향**: 작다.
- **새 tuning knob**: 없음.

### 후보 B — 후보 A + `L+SE` exact tie-out 필수

- **장점**: B1(3번째 instant) 117건을 구조적으로 제거한다. 검증이 공짜다.
- **failure mode**: B2를 못 거른다(§8.1 한계). 앵커 문제는 그대로.
- **예상 missing 영향**: 표본에서 회계연도 말 instant의 tie-out 실패 0건이므로 추가 결손 없음.
- **새 tuning knob**: 없음(exact equality, tolerance 없음).

### 후보 C — presentation role + 무차원 + in-filing 기간 앵커 + `L+SE` tie-out

```text
formation까지 usable한 annual 10-K family filing 선택        (README §3.1)
        ↓
그 accession의 FilingSummary에서 " - Statement - " role 중
연결 대차대조표 role 식별                                     (특정 불가 -> MISSING)
        ↓
그 role 안의 무차원 us-gaap:Assets 만 후보
        ↓
instant == dei:DocumentPeriodEndDate                        (없으면 MISSING)
        ↓
Assets == LiabilitiesAndStockholdersEquity exact 검사
```

- **장점**: B1·B2·B3·B4·B5·B8을 **원인 차원에서** 제거한다. Gross Profit이 이미 채택한
  presentation-linkbase 구조와 같고, `PROBE-me-source.md` §8.2의 raw XBRL instance 경로와
  파서를 공유한다.
- **failure mode**: B9(초기 XBRL `.xml` R 파일)와 B10(SEC 503)을 파서가 감당해야 한다.
- **예상 missing 영향**: role을 특정 못 하는 filing이 MISSING이 된다. 표본에서 Statement role
  식별에 실패한 filing은 없었지만 **전수에서는 확인되지 않았다.**
- **새 tuning knob**: 없음. role 판정은 filing이 선언한 값이고 임계값이 아니다.

### 후보 D — 표준 fallback 계층 추가 (`AssetsCurrent + AssetsNoncurrent` 등)

- **장점**: 없다.
- **failure mode**: §8.2대로 6.2%에서만 가능하고 그중 절반이 틀린다. `us-gaap:Assets`가
  없는 issuer-year를 표본에서 0건 찾았으므로 **해결할 문제 자체가 없다.**
- **새 tuning knob**: 계층 순서라는 새 자유도가 생긴다. GP 정찰에서 계층 순서가 검증 장치가
  없는 곳에서 33% 결과를 바꿨던 것과 같은 위험.

---

## 10. 추천안

**추천은 후보 C다.** 근거는 셋이다.

1. **evidence가 Total Assets를 tractable하다고 말한다.** `us-gaap:Assets`가 23/23 CIK ·
   전 기간 · USD 단독 · custom 0 · dimension-only 0으로 존재하고, 회계연도 말 instant에서
   369/370이 `L+SE` exact다. **GP와 달리 구조적 blocker가 없다.**
2. **남은 위험은 전부 "어느 fact인가"이지 "어느 개념인가"가 아니다.** 124/370 accession이
   후보를 3개 이상 주고, 한 filing이 최대 8개를 준다. 후보 A·B는 이 후보들을 companyfacts의
   차원 제거와 instant 우연에 기대어 피한다. 후보 C는 filing이 스스로 선언한 role로 피한다.
3. **후보 C는 새 자유도를 만들지 않고 기존 인프라와 겹친다.** Gross Profit 계약(README §3.6)이
   이미 연결 손익계산서 role 안의 무차원 fact만 쓰도록 고정했고, ME shares는 raw XBRL instance를
   읽는다. Total Assets만 다른 경로를 쓰면 같은 filing을 세 방식으로 읽게 된다.

**`freeze 불가`가 아니다.** 다만 **§11의 결정 다섯이 닫히기 전에는 계약으로 박지 않는다.**

한 가지는 명확히 evidence로 말할 수 있다 — **fallback/reconstruction은 필요하지 않고
도입하면 해롭다**(§8.2, 후보 D).

---

## 11. 사용자가 결정해야 할 사항

### 11-1. presentation role 요구를 강제할 것인가

```text
(a) 강제한다 (후보 C)      Statement role + 무차원 + in-filing 앵커
(b) 강제하지 않는다 (후보 B) companyfacts 무차원 + reportDate 앵커 + L+SE tie-out
```

**tradeoff**: (b)는 파서가 필요 없고 표본에서 369/370이 맞는다. 그러나 B2·B4를 막아주는 것이
**companyfacts가 차원을 버린다는 성질**이지 우리가 건 조건이 아니다. (a)는 파서를 요구하지만
GP 계약·ME 경로와 같은 구조다.

**추천 (a).** 이유: GP는 이미 (a)로 닫혔고, **같은 filing을 두 규칙으로 읽으면 두 factor의
provenance가 갈린다.** 그리고 §5.1의 NEE는 Statement role 안에서도 차원 조건이 필요함을
보여주므로, 조건을 명시적으로 거는 편이 우연에 기대는 것보다 안전하다.

### 11-2. 회계연도 말 instant 앵커를 무엇으로 잡을 것인가

```text
(a) dei:DocumentPeriodEndDate 우선 · qv_sec_filings.report_date와 교차검증
    불일치하면 MISSING
(b) qv_sec_filings.report_date 단독
(c) 그 accession의 가장 늦은 instant
```

**tradeoff**: (b)는 GE `0000040545-15-000030`에서 실패한다(370건 중 1건, 0.27%). (c)는 그
GE 건에서 우연히 맞지만 **왜 맞는지 알 수 없고**, 주석 instant가 회계연도 말보다 늦은 filing이
나오면 조용히 틀린다. (a)는 filing이 선언한 값을 쓰고 기존 원장과 교차검증한다.

**추천 (a).** 이유: 후보 C를 택하면 filing을 어차피 파싱하므로 추가 비용이 거의 없고,
**두 출처가 어긋나는 순간을 `MISSING`으로 드러낼 수 있다.**

### 11-3. `Assets == LiabilitiesAndStockholdersEquity` tie-out을 어떻게 쓸 것인가

```text
(a) 필수 · exact equality · 불일치는 fail-close(MISSING/UNRESOLVED)
(b) diagnostic only (Gross Profit의 direct GP와 같은 취급)
```

**tradeoff**: GP에서 direct `GrossProfit`을 diagnostic으로 둔 이유는 그것이 **경쟁하는 다른
정의**였기 때문이다. `L+SE`는 정의가 아니라 **대차대조표 항등식**이라 성격이 다르다. 표본에서
가능한 752건 전부 exact이므로 (a)의 비용은 0으로 보인다. 다만 `L+SE`가 없는 경우가 존재하고
(표본에서는 전부 3번째 instant였지만) 전수에서 대차대조표 instant인데도 없는 filing이 나오면
(a)는 그 issuer-year를 잃는다.

**추천: (a)로 하되 "tie-out 계산 불가"와 "tie-out 불일치"를 다른 상태로 분리한다.**
불일치는 fail-close, 계산 불가는 별도 상태로 남겨 전수에서 빈도를 먼저 본다.
**이 분리는 사용자 결정이 필요하다** — 하나로 합치면 결손이 과대해지거나 검증이 약해진다.

### 11-4. `us-gaap:Assets`가 없을 때 fallback을 허용할 것인가

```text
(a) 허용하지 않는다. MISSING
(b) 표준 계층 fallback을 연다
```

**추천 (a).** 이유는 tradeoff가 아니라 evidence다 — 표본에서 결손이 0건이고, (b)의 후보는
6.2%에서만 계산되며 그중 절반이 틀린다(§8.2). **(b)는 없는 문제를 위해 새 자유도를 만든다.**

### 11-5. dimension-only Assets를 허용할 것인가

```text
(a) MISSING. member 합산 금지            (Gross Profit §3.6과 같은 처리)
(b) member를 합산해 연결 총계를 만든다
```

**추천 (a).** 표본에서 dimension-only 사례가 0건이므로 지금 (b)를 열면 쓰이지 않는 규칙이
쌓인다. 그리고 NEE의 FPL·KHC의 guarantor elimination이 보여주듯 **member 합산은 legal-entity
경계를 넘거나 elimination 열을 이중계산할 수 있다.**

---

## 12. source URLs / accessions

### SEC API

```text
companyfacts   https://data.sec.gov/api/xbrl/companyfacts/CIK##########.json
submissions    https://data.sec.gov/submissions/CIK##########.json
               https://data.sec.gov/submissions/CIK##########-submissions-###.json
filing 구조     https://www.sec.gov/Archives/edgar/data/{cik}/{accession_nodash}/FilingSummary.xml
rendered       https://www.sec.gov/Archives/edgar/data/{cik}/{accession_nodash}/R#.htm   (최근)
               https://www.sec.gov/Archives/edgar/data/{cik}/{accession_nodash}/R#.xml   (초기 XBRL)
```

### 주장별 accession

|주장|근거|
|---|---|
|세그먼트 주석 합계 행이 3번째 instant를 만든다|WMT `0000104169-26-000055` `R73.htm`(Disclosure) vs `R5.htm`(Statement)|
|재작성·분기 주석이 분기 instant 8개를 만든다|KHC `0001637459-19-000049` `R58.htm`·`R151.htm`|
|guarantor 연결표의 음수 TOTAL ASSETS|KHC `0001637459-19-000049` `R156.htm`|
|Statement role 안의 co-registrant(FPL) 총자산|NEE `0000753308-26-000015` `R6.htm`|
|초기 XBRL의 `Statement`/`Disclosure` 관례|PG `0001193125-10-188769` `R3.xml` `ReportLongName`|
|`reportDate`가 제출일과 같은 사례|GE `0000040545-15-000030` (reportDate `2015-02-27`)|
|같은 filing의 `dei:DocumentPeriodEndDate`는 올바름|GE `0000040545-15-000030` `R1.htm` = `Dec. 31, 2014`|
|ASC 606 소급으로 Assets +21.7%|BA `0000012927-18-000007` vs `0000012927-19-000010`|
|ASU 2009-13 소급으로 Assets -11.8%|AAPL `0001193125-09-214859` vs `0001193125-10-012091`|
|정밀도 변경만 있는 "재작성"|DHR `0001193125-12-076756` vs `0000313616-13-000026`|
|MSFT ASC 606 소급 +3.7%|`0001564590-17-014900` vs `0001564590-18-019062`|
|GE 재작성 다수|`0000040545-24-000027` vs `-25-000015`, `-18-000014` vs `-19-000014`|

### 내부 계약

```text
docs/trading/strategies/quality-value-roadmap.md   §4.1 §4.2 §4.2.1
trading/runs/qv-data-audit/README.md               §3.1 §3.2 §3.6 §7
trading/runs/qv-data-audit/PROBE-gross-profit-mapping.md
trading/runs/qv-data-audit/PROBE-me-source.md      §8.1 §8.2
trading/backtest/qv_submissions.py                 report_date · historical_usable_session
trading/backtest/schema.sql                        qv_sec_filings
```

---

## 13. 조사하지 않은 것 / 한계

```text
수익률 · Sharpe · PF · MDD · QV rank · factor 성과      0회
coverage Gate A~H 판정                                 하지 않음 (본구현 전수에서만)
프로덕션 코드 · schema · 테스트 · run-card 수정          없음
로드맵 · canonical README 수정                          없음 (사용자 결정 후 별도 freeze commit)
DB 접근 · ingestion 실행                                없음
Book Equity · preferred · deferred tax mapping         범위 밖
issuer identity · shares · ME 계약                      건드리지 않음
momentum-v2                                            건드리지 않음
```

**한계**

- 표본은 22개 발행사다. **금융업(SIC 6xxx)·소형주·최근 상장사·외국 발행사(20-F)는 없다.**
  로드맵 §3.4가 금융업을 primary에서 제외하므로 의도적이지만, **여기서 나오지 않은 형태가
  전수에 없다고 말할 근거는 없다.**
- Statement role 식별을 **표본의 일부 accession에서만** 원문 확인했다(WMT·KHC·NEE·PG).
  370개 전수의 role 식별 가능성은 검증하지 않았다.
- `L+SE` tie-out의 752/869는 **companyfacts 무차원 fact 기준**이고, role 필터를 적용한 뒤의
  숫자가 아니다.
- SEC `HTTP 503`을 한 번 만났다(NEE `R86.htm`). R 파일 전수 파싱의 운영 안정성은 별도 문제다.
- **초기 XBRL era의 실무적 함의 하나**: 각 발행사의 첫 XBRL 10-K가 2009-10 ~ 2010-10에
  흩어져 있어, 결산월에 따라 처음 사용 가능한 formation year가 달라진다. 이것은 coverage
  판정이 아니라 구조 관찰이며, **로드맵 §4.1·§6.1을 다시 열자는 뜻이 아니다.**
