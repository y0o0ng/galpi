# Phase 0 정찰 — Book Equity accounting mapping

> **READ-ONLY 연구 기록이다.** 프로덕션 코드·schema·테스트·run-card를 바꾸지 않았고
> 로드맵과 canonical README도 건드리지 않았다. **수익률·QV rank·B/M 결과·coverage Gate를
> 0번 계산했다.** 회계 tie-out을 위한 금액 계산만 했다. 이 문서는 결정을 내리지 않고
> **정본을 고를 근거**를 모은다.

`README.md` §3.2가 open으로 남긴 `StockholdersEquity` fallback 순서 · preferred stock ·
deferred tax 태그 mapping을 정찰한다. 형식은 앞선 세 probe를 따른다.

---

## 1. 조사 기준 latest main SHA

```text
d81c19190ef12ff371dba9ec952ceff3d7d80874
docs(qv): Total Assets accounting contract를 동결한다
```

`git fetch origin main` 후 `origin/main`·로컬 `HEAD`가 같고 working tree는 깨끗했다.
설계자가 마지막으로 확인한 SHA와 **동일하다** — 그 사이 새 커밋은 없다.

읽은 문서·코드: `docs/trading/strategies/quality-value-roadmap.md`(§4.1·§4.2·§4.2.1·§4.2.2·§4.3·§17),
`trading/runs/qv-data-audit/README.md`(§3.1·§3.2·§3.6·§3.7·§7),
`PROBE-gross-profit-mapping.md`, `PROBE-total-assets-mapping.md`, `PROBE-me-source.md`,
`trading/backtest/qv_submissions.py`, `trading/backtest/edgar.py`, `trading/backtest/schema.sql`.

---

## 2. 이미 FROZEN인 계약과 이번 open scope

**다시 열지 않은 것**

```text
Gross Profit    Revenue = consolidated total revenue · GP = total revenue - COGS
                direct GrossProfit = diagnostic only · exact tie-out · role + dimensionless
Total Assets    canonical = us-gaap:Assets · 연결 대차대조표 Statement role + dimensionless
                anchor = dei:DocumentPeriodEndDate · report_date는 cross-check
                Assets == LiabilitiesAndStockholdersEquity exact · fallback/합산 금지
PIT             annual 10-K family · fiscal period end가 calendar t-1 안
                historical_usable_session <= formation · README §3.1 filing 선택
Book Equity     경제적 정의와 `Book Equity <= 0 -> Value ranking 제외`는 §4.3에서 이미 고정
```

**이번에 열려 있는 것**: `Stockholders' Equity` XBRL hierarchy · preferred stock의 XBRL 의미와
hierarchy · deferred taxes / investment tax credit mapping · component 결손·모호 처리 ·
validation / fail-close 구조.

---

## 3. 문헌의 Book Equity semantics — EVIDENCE

### 3.1 Fama / French (Ken French Data Library, 원문 인용)

> "BE is the book value of stockholders' equity, plus balance sheet deferred taxes and
> investment tax credit (if available), minus the book value of preferred stock."

> "Depending on availability, we use the redemption, liquidation, or par value (in that
> order) to estimate the book value of preferred stock."

> "Stockholders' equity is the value reported by Moody's or Compustat, if it is available.
> If not, we measure stockholders' equity as the book value of common equity plus the par
> value of preferred stock, or the book value of assets minus total liabilities (in that
> order)."

출처: <https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/Data_Library/variable_definitions.html>

### 3.2 Novy-Marx (JFE 108(1), 2013 — 저자 원고 본문)

논문 PDF의 변수 정의 문단을 그대로 옮긴다(추출 과정에서 공백이 소실돼 띄어쓰기를 복원했다).

> "Book equity is shareholder equity, plus deferred taxes, minus preferred stock, when
> available. For the components of shareholder equity, I employ tiered definitions largely
> consistent with those used by Fama and French (1993) to construct HML. Stockholders
> equity is as given in Compustat (SEQ) if available, or else common equity plus the
> carrying value of preferred stock (CEQ + PSTX) if available, or else total assets minus
> total liabilities (AT - LT). Deferred taxes is deferred taxes and investment tax credits
> (TXDITC) if available, or else deferred taxes and/or investment tax credit (TXDB and/or
> ITCB). Preferred stock is redemption value (PSTKR) if available, or else liquidating
> value (PSTKRL) if available, or else carrying value (PSTK)."

출처: <https://mysimon.rochester.edu/novy-marx/research/OSoV.pdf>

같은 문단이 gross profit도 정의한다 — "total revenue (REVT) minus cost of goods sold
(COGS)". **이는 이미 FROZEN된 §4.2.1의 consolidated total revenue 선택과 일치한다.**
(확인만 하고 그 계약을 다시 열지 않는다.)

### 3.3 두 문헌의 차이와 표기 주의

|항목|French|Novy-Marx|
|---|---|---|
|SE 2단계 fallback|common equity + **par value** of preferred|common equity + **carrying value** of preferred (`CEQ + PSTX`)|
|preferred 순위|redemption → liquidation → **par**|redemption(`PSTKR`) → liquidating(`PSTKRL`) → **carrying**(`PSTK`)|

**INTERPRETATION**: 두 정의는 실질적으로 같은 tier 구조다. 다만 Novy-Marx 본문의
`PSTX`·`PSTKR`·`PSTKRL`은 Compustat의 표준 mnemonic 표기와 정확히 일치하지 않는다(표준은
`PSTK`·`PSTKRV`·`PSTKL`). **이 정찰은 Compustat 항목 정의를 1차 자료로 확인하지 못했으므로,
mnemonic 대응을 근거로 삼지 않고 "무엇을 재려는가"라는 경제적 서술만 사용한다.**

### 3.4 문헌 정의가 만들어진 회계 시대 — 결정적 EVIDENCE

SFAS No. 160은 **연결재무제표에서 noncontrolling interest를 지배주주 지분과 구분해 자본
안에 표시**하도록 요구했고, **2008-12-15 이후 시작하는 회계연도부터** 적용됐다. 그 전에는
minority interest가 부채와 자본 사이(mezzanine)에 표시되는 것이 일반적이었다.

**INTERPRETATION**: French의 3단계 fallback `assets minus total liabilities`는 **minority
interest가 자본 밖에 있던 시대**의 식이다. 우리의 XBRL 데이터는 **전부 SFAS 160 이후**이므로
(표본의 최초 XBRL 10-K가 2009-10~2010-10, `PROBE-total-assets-mapping.md` §4.1) 같은 식을
그대로 쓰면 **NCI가 조용히 Book Equity에 들어간다.** §6.3에서 실측으로 확인한다.

---

## 4. 표본

앞선 probe의 발행사를 재사용하고 **Book Equity 특유의 edge case**를 8개 더했다.
**30개 발행사 · 31개 CIK**다. 금융업(SIC 6xxx)은 primary universe가 제외하므로 넣지 않았다.

|성격|issuer|CIK|
|---|---|---|
|tech|AAPL `0000320193` · MSFT `0000789019` · INTC `0000050863`|
|retail|AMZN `0001018724` · WMT `0000104169` · COST `0000909832` · HD `0000354950`|
|industrial|CAT `0000018230` · BA `0000012927` · UNP `0000100885` · GE `0000040545`|
|healthcare/pharma|JNJ `0000200406` · PFE `0000078003` · **BDX `0000010795`**|
|energy|XOM `0000034088` · **MPC `0001510295`**|
|staples|PG `0000080424` · KO `0000021344` · KHC `0001637459` · **PM `0001413329`**|
|telecom/media|VZ `0000732712` · CMCSA `0001166691` · DIS `0001744489` · DISo `0001001039`|
|utility|NEE `0000753308` · **SO `0000092122`**|
|acq-heavy|DHR `0000313616` · **AVGO `0001730168`**|
|**대형 NCI**|**MPC** · CMCSA · NEE|
|**redeemable / mezzanine equity**|**TSLA `0001318605`** · CMCSA · GE|
|**우선주 실제 발행**|**AVGO** · DHR · BDX · PFE · GE|
|**자사주 과다 / equity 음수**|**MCD `0000063908`** · **SBUX `0000829224`** · PM · BA · HD|
|non-December 결산|AAPL · MSFT · PG · COST · HD · WMT · DIS · AVGO|

기간은 초기 XBRL(2009~2012) · 중기(2013~2017) · 최근(2023~2026)을 모두 포함한다.
회계연도 말 instant 기준 **stockholders-equity 관측 484건**을 다뤘다.

> **coverage estimate가 아니다.** systematic failure mode를 찾기 위한 adversarial
> reconnaissance이고 Gate A~H는 여기서 판정하지 않는다.

### 4.1 임시 스크립트 (프로덕션 아님 · 커밋하지 않음)

|파일|한 일|
|---|---|
|`fetch*.py`|31개 CIK companyfacts 캐시|
|`be.py`|10-K instant fact 추출 · 이름 패턴별 개념 inventory|
|`subs.py`|accession별 `form`·`filed`·`reportDate`·`acceptanceDateTime`|
|`filing.py` / `scan_concept.py`|`FilingSummary.xml` → `R*.htm`에서 **라벨 ↔ 요소명 ↔ role** 대조|
|`pdftext.py`|의존성 없이 논문 PDF 텍스트 추출(§3.2 인용용)|

---

## 5. Stockholders' Equity tag inventory

### 5.1 EVIDENCE — 두 개념의 가용성

회계연도 말 instant(= `submissions.reportDate`) 기준, 무차원 USD fact.

```text
us-gaap:StockholdersEquity                                          415 accession
us-gaap:StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest
                                                                    357 accession
IncludingNCI는 있는데 parent가 없는 accession                          79
(accn, instant, unit)이 같은데 값이 다른 fact                            0
```

**parent `StockholdersEquity`가 표본 전 기간 0건인 발행사가 넷이다.**

```text
CAT · JNJ · PG · VZ
```

원문 대차대조표에서 확인했다.

```text
PG  0000080424-26-000103  R6.htm  "9952154 - Statement - Consolidated Balance Sheets"
      us-gaap:MinorityInterest                          Noncontrolling interest        230
      us-gaap:StockholdersEquityIncluding...NCI         TOTAL SHAREHOLDERS' EQUITY  54,311
CAT 0000018230-26-000008  R5.htm  "9952153 - Statement - Consolidated Financial Position"
      us-gaap:MinorityInterest                          Noncontrolling interests         0
      us-gaap:StockholdersEquityIncluding...NCI         Total shareholders' equity  21,318
VZ  0000732712-26-000007  R6.htm  "9952154 - Statement - Consolidated Balance Sheets"
      us-gaap:MinorityInterest                          Noncontrolling interests     1,281
      us-gaap:StockholdersEquityIncluding...NCI         Total equity               105,741
```

**세 발행사 모두 대차대조표 면에 지배주주 소계 라인을 아예 표시하지 않는다.** 자본 구성요소
들과 NCI를 나열한 뒤 총계 하나로 끝낸다. 따라서 parent equity는 **표시되지 않은 값**이고
`총계 − NCI`로만 얻을 수 있다.

### 5.2 EVIDENCE — 발행사별 요약

`SE(p)`=parent, `SE(i)`=including NCI, `NCI`=`us-gaap:MinorityInterest`. 모두 회계연도 말.

|iss|SE(p)|SE(i)|NCI|iss|SE(p)|SE(i)|NCI|
|---|---|---|---|---|---|---|---|
|AAPL|18|0|0|MCD|17|0|0|
|AMZN|17|0|0|MPC|15|14|14|
|AVGO|2|8|1|MSFT|17|0|0|
|BA|17|17|17|NEE|17|12|12|
|BDX|18|0|0|PFE|17|17|17|
|**CAT**|**0**|17|17|**PG**|**0**|18|18|
|CMCSA|17|17|17|PM|17|17|17|
|COST|16|16|14|SBUX|17|16|16|
|DHR|17|16|16|SO|13|17|15|
|DIS|7|7|7|TSLA|16|10|10|
|DISo|10|9|10|UNP|17|12|0|
|GE|16|16|16|**VZ**|**0**|17|17|
|HD|17|0|0|WMT|17|17|17|
|INTC|17|4|4|XOM|18|18|18|
|**JNJ**|**0**|17|0|||||
|KHC|11|11|11|||||
|KO|17|17|17|||||

**AVGO는 발행사 안에서 개념이 바뀐다** — FY2018·FY2019는 parent `StockholdersEquity`,
FY2020부터는 `IncludingNCI`만 있다.

**JNJ와 UNP는 `IncludingNCI`는 있는데 `MinorityInterest`가 0건**이다. NCI가 0인지 태깅을
안 한 것인지 companyfacts만으로는 구분되지 않는다.

---

## 6. NCI / total-equity 구조

### 6.1 EVIDENCE — 항등식 `SE(i) == SE(p) + NCI`

```text
셋이 모두 있는 회계연도 말 관측       261
정확히 성립                          252   (96.6%)
불일치                                 9   ( 3.4%)
```

불일치 9건의 정체가 **두 종류로 완전히 갈린다.**

|iss|instant|accession|SE(i)|SE(p)|NCI|gap|정체|
|---|---|---|---|---|---|---|---|
|CMCSA|2024-12-31|`0001166691-25-000011`|86,038|85,560|477|**+1**|반올림|
|CMCSA|2025-12-31|`0001628280-26-004994`|97,151|96,903|249|**-1**|반올림|
|GE|2020-12-31|`0000040545-21-000011`|37,073|35,552|1,522|**-1**|반올림|
|GE|2023-12-31|`0000040545-24-000027`|28,579|27,378|1,202|**-1**|반올림|
|GE|2024-12-31|`0000040545-25-000015`|19,564|19,342|223|**-1**|반올림|
|PFE|2019-12-31|`0000078003-20-000014`|63,447|63,143|303|**+1**|반올림|
|PFE|2021-12-31|`0000078003-22-000027`|77,462|77,201|262|**-1**|반올림|
|PFE|2022-12-31|`0000078003-23-000024`|95,916|95,661|256|**-1**|반올림|
|**TSLA**|**2016-12-31**|`0001564590-17-003118`|5,905,125|4,752,911|785,175|**+367,039**|**redeemable NCI**|

(단위: 백만 USD. TSLA만 천 USD.)

**8건은 백만 단위 표시 반올림으로 정확히 ±$1,000,000이다.** 경제적 불일치가 아니다.

### 6.2 EVIDENCE — Tesla FY2016: mezzanine equity가 총계에 섞인다

`0001564590-17-003118`의 **대차대조표**(`R2.htm`, `100010 - Statement - Consolidated
Balance Sheets`):

```text
us-gaap:RedeemableNoncontrollingInterestEquityCarryingAmount   367,039   (mezzanine)
us-gaap:StockholdersEquity                Total stockholders' equity    4,752,911
us-gaap:MinorityInterest                  Noncontrolling interests        785,175
```

그런데 `StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest = 5,905,125`
는 **대차대조표에 없다.** 그 fact는 다른 role에 있다.

```text
R6.htm   "100050 - Statement - Consolidated Statements of Redeemable Noncontrolling
          Interest and Stockholders' Equity"
      Balance at Dec. 31, 2016   $ 5,905,125 | $ 367,039 | $ 161 | $ 7,773,727
```

```text
4,752,911 + 785,175             = 5,538,086
5,905,125 - 5,538,086           =   367,039   = redeemable NCI
```

**INTERPRETATION**: 이 `IncludingNCI` fact는 **equity roll-forward statement**의 값이고
**mezzanine(redeemable NCI)까지 포함**한다. 대차대조표의 총계가 아니다.

**이것이 `Total Assets` 계약(§4.2.2)에서 "Statement role + 무차원"으로 충분했던 것과
다른 점이다.** equity roll-forward도 `Statement` role이므로, **role을 "연결 대차대조표"로
특정하지 않으면 다른 scope의 값이 canonical 후보가 된다.**

`IncludingNCI − MinorityInterest`를 parent equity fallback으로 쓰면 이 해의 Tesla는

```text
5,905,125 - 785,175 = 5,119,950     (실제 parent 4,752,911 대비 +7.7%)
```

가 되어 **조용히 7.7% 부풀어 오른다.**

### 6.3 EVIDENCE — `Assets − Liabilities`가 실제로 무엇과 같은가

회계연도 말에 `us-gaap:Assets`와 `us-gaap:Liabilities`가 둘 다 있는 관측 **302건**:

```text
Assets - Liabilities == SE(i)  (including NCI)      174건
Assets - Liabilities == SE(p)  (parent)              78건
Assets - Liabilities != SE(i)                        64건
Assets - Liabilities != SE(p)                       162건

NCI > 0 인 관측 159건 중
     == SE(i)                                       106건
     == SE(p)                                         0건
```

**INTERPRETATION**: NCI가 존재하는 관측에서 `Assets − Liabilities`가 parent equity와 같은
경우는 **한 건도 없다.** §3.4의 SFAS 160 해석이 실측으로 확인된다 — French의 3단계 fallback을
XBRL 시대에 그대로 쓰면 **항상 NCI를 포함한다.** `!= SE(i)` 64건은 mezzanine이 부채와 자본
사이에 있어 차이가 나는 경우로 보이나, **이 정찰에서 64건 전부의 원인을 원문으로 확인하지는
않았다.**

또한 `us-gaap:Liabilities`(총부채) 자체가 484건 중 302건에서만 존재한다. **fallback의 입력도
보편적이지 않다.**

---

## 7. Preferred Stock tag inventory와 filing evidence

### 7.1 EVIDENCE — 개념 inventory

표본에서 `Preferred|TemporaryEquity|Redeemable|Mezzanine` 이름의 10-K instant 개념은 **22개**다.
발행사 수 상위:

```text
20  us-gaap:PreferredStockSharesAuthorized              <- 주식 수. 금액 아님
17  us-gaap:PreferredStockValue                         <- 대차대조표 액면/장부 금액
16  us-gaap:PreferredStockSharesIssued                  <- 주식 수
13  us-gaap:PreferredStockParOrStatedValuePerShare      <- 주당 액면
10  us-gaap:PreferredStockSharesOutstanding
10  us-gaap:RedeemableNoncontrollingInterestEquityCarryingAmount
 4  us-gaap:TemporaryEquityCarryingAmountAttributableToParent
 3  us-gaap:TemporaryEquityCarryingAmount
 2  us-gaap:PreferredStockLiquidationPreferenceValue    <- 청산우선가치. 단 2개 발행사
 1  us-gaap:PreferredStockLiquidationPreference
 1  us-gaap:MinorityInterestPreferredStockAmount
```

**우선주의 redemption value에 해당하는 표준 개념은 표본에 존재하지 않는다.**
이름에 `Redemption`이 든 개념은 셋뿐이고 전부 우선주가 아니다.

```text
us-gaap:TemporaryEquityRedemptionValue
us-gaap:RedeemableNoncontrollingInterestEquityRedemptionValue
us-gaap:SharesSubjectToMandatoryRedemptionSettlementTermsAmountNoncurrent
```

**INTERPRETATION**: 문헌 hierarchy의 **1순위(redemption)는 XBRL 표준 개념으로 복원 불가**이고,
**2순위(liquidation)는 표본 30개 발행사 중 2개**에만 있다. 실제로 얻을 수 있는 것은
사실상 **3순위(par/carrying)뿐**이다.

### 7.2 EVIDENCE — `us-gaap:PreferredStockValue`의 실체

회계연도 말 무차원 USD 기준.

```text
관측                    182
값이 정확히 0            153   (84.1%)
값이 0이 아님             29
태그가 아예 없는 발행사    14 / 31
   AAPL BA CAT HD KHC KO MSFT NEE PG PM SBUX SO UNP XOM
```

**0이 아닌 값의 성격이 발행사마다 다르다.**

```text
BDX    2,000,000          (액면 수준)
GE     6,000,000          (액면 수준)
PFE    17,000,000 ~ 21,000,000
DHR    1,599,600,000 · 1,668,000,000 · 3,268,000,000   (발행금액 수준)
```

### 7.3 EVIDENCE — Broadcom: 액면 $0 vs 청산가치 $3.7B

`AVGO` 회계연도 말 fact(무차원):

```text
instant      accession                PreferredStockValue  SharesIssued  LiquidationPreferenceValue
2019-11-03   0001730168-19-000144              (태그 없음)             -   3,737,500,000
2020-11-01   0001730168-20-000226                        0     4,000,000   3,738,000,000
2021-10-31   0001730168-21-000153                        0     4,000,000   3,737,000,000
2022-10-30   0001730168-22-000118                        0             0               0
2023-10-29   0001730168-23-000096                        0             0        (태그 없음)
PreferredStockParOrStatedValuePerShare = 0.001 USD/share
StockholdersEquityIncludingNCI (2020-11-01) = 23,874,000,000
```

**INTERPRETATION**: Broadcom은 FY2020~2021에 실제로 우선주 400만 주가 발행돼 있었고 청산
우선가치가 **$3.738B, 자본의 15.7%**였다. 그런데 액면이 주당 $0.001이라 대차대조표
`PreferredStockValue`는 **$0**이다.

```text
문헌대로 redemption -> liquidation -> par 라면   -3,738,000,000 을 차감
XBRL 대차대조표 금액(par)만 쓰면                  -0             을 차감
Book Equity 차이                                 자본의 15.7%
```

그리고 **`PreferredStockValue == 0`이 "우선주 없음"을 뜻하지 않는다.** 같은 filing의
`PreferredStockSharesIssued = 4,000,000`이 그것을 부정한다. FY2022부터는 `SharesIssued = 0`이라
**그때의 0은 진짜 0**이다. **ZERO와 MISSING을 가르는 실측 가능한 신호는 금액 태그가 아니라
발행주식수 태그다.**

### 7.4 EVIDENCE — mezzanine / redeemable NCI

```text
us-gaap:RedeemableNoncontrollingInterestEquityCarryingAmount     10 발행사
us-gaap:TemporaryEquityCarryingAmountAttributableToParent         4 발행사
```

§6.2의 Tesla처럼 이들은 **부채와 자본 사이**에 있고, 일부 filing의 `IncludingNCI` 총계에는
포함되고 대차대조표 자본 총계에는 포함되지 않는다.

---

## 8. Deferred Tax / ITC tag inventory와 filing evidence

### 8.1 EVIDENCE — 개념 폭발

표본에서 `DeferredTax|InvestmentTaxCredit|TaxCredit` 이름의 10-K instant 개념은 **107개**다.
대부분이 **법인세 주석의 구성요소**이고 대차대조표 라인이 아니다.

```text
31  us-gaap:DeferredTaxLiabilities                   <- 주석의 총 DTL
30  us-gaap:DeferredTaxAssetsOther
30  us-gaap:DeferredTaxAssetsValuationAllowance      <- 평가충당금. deferred tax 자체가 아님
27  us-gaap:DeferredTaxAssetsGross
26  us-gaap:DeferredTaxAssetsLiabilitiesNet          <- 주석의 순액
26  us-gaap:DeferredTaxAssetsNet
28  us-gaap:DeferredTaxLiabilitiesNoncurrent
18  us-gaap:DeferredTaxAssetsNetCurrent              <- ASU 2015-17 이전 세대
```

### 8.2 EVIDENCE — 대차대조표 면의 이연법인세 라인

회계연도 말 무차원 관측 수(비교 기준: stockholders-equity 관측 484건).

```text
us-gaap:DeferredIncomeTaxLiabilitiesNet          160
us-gaap:DeferredTaxLiabilitiesNoncurrent         220
us-gaap:DeferredTaxAssetsLiabilitiesNet          201   <- 주석 개념
us-gaap:DeferredTaxAssetsNetNoncurrent            87
us-gaap:DeferredIncomeTaxAssetsNet                53
us-gaap:AccumulatedDeferredInvestmentTaxCredit    18   <- NEE 1 · SO 17
```

**어느 하나도 절반을 넘지 못하고, 이들은 서로 다른 것을 잰다.**

원문 대차대조표 셋을 확인했다.

```text
AAPL 0000320193-25-000079  R5.htm  "Statement - CONSOLIDATED BALANCE SHEETS"
      -> 이연법인세 라인이 대차대조표에 아예 없다 (기타 비유동부채에 포함)

CAT  0000018230-26-000008  R5.htm  "Statement - Consolidated Financial Position"
      cat:NoncurrentDeferredAndRefundableIncomeTaxes   2,882    <- issuer custom

SO   0000092122-26-000006  R8.htm  "Statement - Consolidated Balance Sheets - Southern"
      us-gaap:DeferredIncomeTaxLiabilitiesNet         12,133
      us-gaap:AccumulatedDeferredInvestmentTaxCredit   2,002
      so:DeferredCreditsRelatedToIncomeTaxes           4,712    <- issuer custom
      so:DeferredChargesRelatedToIncomeTaxes             948    <- issuer custom
```

**INTERPRETATION**: 세 발행사가 세 가지 모양이다 — 라인 없음 · custom 단일 라인(이연분과
환급분을 합친 것) · 표준 + custom 혼합. §4.2가 issuer custom tag의 이름 유사도 mapping을
금지하므로 CAT와 SO의 custom 부분은 계약상 사용할 수 없다.

### 8.3 EVIDENCE — 크기가 1차적이다

`DeferredIncomeTaxLiabilitiesNet / stockholders' equity` (회계연도 말, 발행사별 최대~최소):

```text
UNP     107.2% ~  72.2%          MPC      34.6% ~ 13.8%
VZ       61.8% ~  46.1%          NEE      23.5% ~ 21.4%
CMCSA    38.5% ~  28.7%          XOM      19.1% ~ 11.6%
KHC      36.3% ~  19.7%          AAPL     17.1% ~ 13.6%
SO       35.3% ~  26.5%          PG       14.5% ~ 10.6%
KO       12.3% ~   7.5%          MSFT      1.7% ~  0.1%
HD       82.7% ~ -53.6%          MCD     -25.9% ~ -58.0%
PM       -5.4% ~ -21.8%          SBUX     -0.2% ~  -2.8%
```

**INTERPRETATION**: 이 항은 보조 조정이 아니라 **B/M 분자를 최대 2배 이상 바꿀 수 있는
1차 항**이다. 특히 철도·통신·유틸리티 같은 자본집약 업종에서 크고, MCD·PM처럼 자본이 음수인
발행사에서는 비율의 부호까지 뒤집힌다. **가용성은 33%인데 영향은 최대 100%가 넘는다** —
"있으면 더하고 없으면 만다"(`when available`)를 그대로 옮기면 **같은 산업 안에서도 발행사마다
다른 정의로 계산된 값이 한 cross-section에 섞인다.**

### 8.4 EVIDENCE — investment tax credit

```text
us-gaap:AccumulatedDeferredInvestmentTaxCredit   NEE 1건 · SO 17건   (표본에서 전부)
```

**INTERPRETATION**: ITC는 현대 filing에서 **규제 유틸리티에 국한**된다. 문헌 정의의 ITC 항은
비금융 대형주 대부분에서 구조적으로 존재하지 않는다.

---

## 9. instant / presentation / restatement 패턴

### 9.1 EVIDENCE — 키잉은 결정적이다

```text
(accn, instant, unit)이 같은데 SE 값이 다른 fact      0건
```

`Total Assets`(§4.2.2)와 같다. 위험은 **후보가 여럿이라는 것**이지 값 충돌이 아니다.

### 9.2 EVIDENCE — role이 scope를 바꾼다

§6.2의 Tesla가 그 증거다. `StockholdersEquity`·`IncludingNCI`는 다음 role에 모두 등장한다.

```text
Statement - Consolidated Balance Sheets                          <- 대차대조표 총계
Statement - Consolidated Statements of ... Stockholders' Equity  <- roll-forward. scope가 다를 수 있다
Disclosure - 각종 주석
```

**`Total Assets`에서 충분했던 "Statement role + 무차원"이 Book Equity에서는 충분하지 않다.**

### 9.3 EVIDENCE — 재작성 폭이 Total Assets보다 훨씬 크다

같은 instant인데 accession마다 parent SE가 다른 사례가 **23개 instant**다.

```text
BA    2017-12-31   0000012927-18-000007        355  ->  0000012927-19-000010      1,656   +366%
MSFT  2017-06-30   0001564590-17-014900     72,394  ->  0001564590-18-019062     87,711   +21.2%
MSFT  2016-06-30   0001193125-16-662209     71,997  ->  0001564590-18-019062     83,090   +15.4%
GE    2017-12-31   0000040545-18-000014     64,263  ->  0000040545-19-000014     56,030   -12.8%
AAPL  2009-09-26   0001193125-09-214859     27,832  ->  0001193125-10-012091     31,640   +13.7%
GE    2016-12-31   0000040545-17-000010     75,828  ->  0000040545-19-000014     70,162    -7.5%
```

(단위: 백만 USD)

**INTERPRETATION**: 자본은 잔여 항목이라 같은 ASC 606 소급이 총자산을 +21.7% 바꿀 때
(`PROBE-total-assets-mapping.md` §6.3) **Boeing의 지배주주지분은 +366% 바뀐다.** PIT 계약
위반의 대가가 Book Equity에서 훨씬 크다. 기존 계약(README §3.1 · formation까지 usable한
filing)은 이 경우들도 추가 규칙 없이 가르지만, **companyfacts를 기간 전체로 훑어 "최신 값"을
쓰면 즉시 look-ahead가 된다.**

### 9.4 EVIDENCE — 음수 Book Equity

parent SE가 회계연도 말에 0 이하인 관측:

```text
PM    14건 (2012-12-31 ~ 2025-12-31)   최근 -9,994,000,000
MCD   10건 (2016-12-31 ~ 2025-12-31)   최근 -1,791,000,000
SBUX   7건 (2019-09-29 ~ 2025-09-28)   최근 -8,096,600,000
BA     6건 (2019-12-31 ~ 2024-12-31)   최근 -3,908,000,000
HD     3건 (2019-02-03 ~ 2022-01-30)   최근 -1,696,000,000
```

**INTERPRETATION**: 자사주 매입이 큰 대형주에서 음수 자본은 **정상적으로 계산된 값**이다.
`Book Equity <= 0 -> Value ranking 제외`는 이미 FROZEN이므로 여기서 바꾸지 않는다. 다만
**이 제외가 특정 성격의 대형주를 체계적으로 걷어낸다는 사실은 기록해 둔다.** mapping을 바꿔
이들을 살리지 않는다.

---

## 10. validation 조사

|검증식|계산 가능|exact|한계|
|---|---|---|---|
|`SE(i) == SE(p) + NCI`|261 / 484|**252 (96.6%)**|불일치 9건 중 **8건이 백만 단위 반올림 ±$1M**, 1건이 Tesla mezzanine|
|`Assets == Liabilities + Equity`|—|—|`Total Assets` 계약(§4.2.2)이 이미 `Assets == LiabilitiesAndStockholdersEquity`로 쓴다. 그 항등식은 **자본을 NCI 포함 총계로 본다**|
|`Assets − Liabilities == SE(?)`|302 / 484|`==SE(i)` 174 · `==SE(p)` 78|NCI>0이면 parent와 같은 경우 **0건**. 검증이 아니라 **scope 판별기**로만 유용|
|preferred: 금액 vs 발행주식수|—|—|`PreferredStockValue==0` & `SharesIssued>0` 이면 **금액이 경제적 우선주가 아님**을 드러낸다(AVGO)|
|equity roll-forward ending balance|—|—|scope가 대차대조표와 다를 수 있어(§6.2) 검증식으로 쓰면 안 된다|

**INTERPRETATION**: Book Equity에는 Gross Profit의 `direct GP vs Revenue−COGS` 같은
**독립적인 이중 계산 검증이 없다.** 쓸 수 있는 것은 `SE(i) == SE(p) + NCI` 하나이고,
**그것마저 exact로 걸면 백만 단위 반올림에서 3.1%가 깨진다.** `Total Assets`에서 752/752가
exact였던 것과 다르다 — 거기서는 두 값이 같은 반올림을 거친 총계였고, 여기서는 **세 값의
합**이라 각각의 반올림 오차가 누적된다.

---

## 11. blockers / failure modes

|#|모양|근거|분류|
|---|---|---|---|
|B1|**parent `StockholdersEquity`가 전 기간 없다.** 대차대조표에 지배주주 소계 라인이 없다|CAT · JNJ · PG · VZ (79 accession)|`TOTAL_EQUITY_INCLUDING_NCI_ONLY`|
|B2|**`IncludingNCI`가 대차대조표가 아니라 equity roll-forward에서 오고 mezzanine을 포함한다**|TSLA `0001564590-17-003118` `R6.htm`|`EQUITY_AMBIGUOUS` · role 특정 필요|
|B3|`IncludingNCI − NCI` 항등식이 **백만 단위 반올림으로 ±$1M 깨진다**|CMCSA 2 · GE 3 · PFE 3|`VALIDATION_MISMATCH`(비경제적)|
|B4|**`Assets − Liabilities`는 NCI가 있으면 parent equity와 절대 같지 않다**|NCI>0 159건 중 `==parent` 0건|문헌 3순위 fallback이 XBRL 시대에 의미가 바뀜|
|B5|**우선주 redemption value 표준 개념이 없고 liquidation은 2/30 발행사**|표본 전수|문헌 1·2순위 복원 불가|
|B6|**액면 $0.001 우선주 — 장부금액 $0인데 청산가치 $3.738B (자본의 15.7%)**|AVGO `0001730168-20-000226`|`PREFERRED_AMBIGUOUS`|
|B7|**`PreferredStockValue == 0`이 "우선주 없음"이 아니다**|AVGO: 값 0 · `SharesIssued` 4,000,000|`ZERO` vs `MISSING` 구분 필요|
|B8|**우선주 금액 태그가 아예 없는 발행사 14/31**|AAPL BA CAT HD KHC KO MSFT NEE PG PM SBUX SO UNP XOM|`COMPONENT_MISSING`|
|B9|**대차대조표 이연법인세 라인이 issuer custom이다**|CAT `cat:NoncurrentDeferredAndRefundableIncomeTaxes` · SO `so:DeferredCredits...`|`CUSTOM_ONLY` — §4.2가 금지|
|B10|**이연법인세 라인이 아예 없다**|AAPL 대차대조표|`COMPONENT_MISSING`|
|B11|**이연법인세 항의 크기가 자본의 최대 107%**|UNP · VZ · CMCSA · SO|가용성 33%인데 영향 1차|
|B12|**ITC는 규제 유틸리티에만 존재**|NEE 1건 · SO 17건|문헌 항이 구조적으로 부재|
|B13|**주석 개념과 대차대조표 라인이 이름으로 구분되지 않는다** (107개 `DeferredTax*`)|`DeferredTaxAssetsLiabilitiesNet` 201건 등|`DEFERRED_TAX_AMBIGUOUS`|
|B14|**재작성 폭이 자본에서 훨씬 크다**|BA 2017-12-31 `355 -> 1,656` (+366%)|`RESTATED`|
|B15|발행사 안에서 개념이 바뀐다|AVGO: FY2019까지 parent, FY2020부터 IncludingNCI|taxonomy/presentation transition|
|B16|`IncludingNCI`는 있는데 `MinorityInterest` 태그가 없다|JNJ 17건 · UNP 12건|NCI가 0인지 미태깅인지 불명|

**찾지 못한 것**(표본 기준 0건): `(accn, instant, unit)` 값 충돌 · stockholders' equity의
custom-tag-only 발행사 · unit/scale 이상(전부 USD).

---

## 12. 후보 deterministic mappings

> **PROPOSED ARCHITECTURE**다. evidence가 아니다.
> 네 후보 모두 공통으로 `Total Assets` 계약(§4.2.2)과 같은 뼈대를 쓴다 —
> formation까지 usable한 filing → **연결 대차대조표 Statement role** → 무차원 →
> instant == `dei:DocumentPeriodEndDate`.

### 후보 A — 문헌 완전 재현

```text
SE   = parent SE  → (없으면) common equity + preferred par  → (없으면) Assets - Liabilities
DT   = 이연법인세 + ITC (있으면)
PS   = redemption → liquidation → par
BE   = SE + DT - PS
```

- **문헌 재현성**: 최고.
- **failure mode**: B4(3순위가 NCI를 포함) · B5(1·2순위 복원 불가) · B9~B13(DT 항이
  custom·부재·주석 혼동) 때문에 **표본에서 그대로 구현할 수 없다.**
- **판정**: evidence상 실행 불가.

### 후보 B — parent equity only (축소 정의)

```text
BE = parent stockholders' equity
     parent SE fact가 있으면 그것
     없으면 IncludingNCI - MinorityInterest      (B2·B3 위험을 안고)
DT, PS 항을 쓰지 않는다
```

- **문헌 재현성**: 낮다. **문헌 식의 두 항을 버린 다른 정의**다.
- **장점**: 가용성이 가장 높고 tuning knob이 없다.
- **failure mode**: B2(Tesla 7.7%) · B3(반올림) · **B6이 그대로 남는다** — 우선주를 빼지
  않으므로 AVGO의 자본이 15.7% 과대.

### 후보 C — parent equity − 우선주, 이연법인세 제외 (component-gated)

```text
BE = parent SE - preferred
parent SE   대차대조표 role의 parent fact
            없고 IncludingNCI·NCI가 둘 다 있으면 차감으로 복원하되
            redeemable NCI / temporary equity fact가 있으면 fail-close
preferred   PreferredStockSharesIssued == 0            -> PREFERRED_ZERO_CONFIRMED (0 차감)
            SharesIssued > 0 이고 liquidation 있음      -> 그 값 차감
            SharesIssued > 0 인데 금액이 par뿐          -> PREFERRED_AMBIGUOUS -> MISSING
            우선주 관련 태그가 전무                     -> ZERO인지 UNKNOWN인지 판정 후 처리
이연법인세  이번 lineage에서 사용하지 않는다
```

- **문헌 재현성**: 부분적. **preferred는 문헌 취지에 맞추고 DT 항만 버린다.**
- **장점**: B6·B7을 실측 가능한 신호(발행주식수)로 막는다.
- **failure mode**: 우선주가 있는 issuer-year 일부가 MISSING. DT 항 부재는 여전히 문헌 이탈.

### 후보 D — 후보 C + 이연법인세를 표준 대차대조표 라인이 있을 때만 가산

```text
BE = parent SE - preferred + DeferredIncomeTaxLiabilitiesNet (표준·대차대조표 role에 있을 때만)
```

- **failure mode**: **가장 위험하다.** B11대로 이 항이 있는 발행사(UNP·VZ·CMCSA·SO)는 BE가
  최대 2배가 되고 없는 발행사(AAPL 일부 연도·CAT·MSFT 대부분)는 그대로다. **가용성이
  발행사 성격과 상관되어 있어**(자본집약 업종이 이 라인을 표시한다) `when available`이
  **무작위 결손이 아니라 체계적 편향**이 된다.
- 새 tuning knob: 어떤 DT 개념을 인정할지가 그대로 knob이 된다(B13).

---

## 13. 추천안

**단일 후보를 지금 freeze할 수 없다. 다만 무엇이 불가능한지는 확정적으로 말할 수 있다.**

**evidence가 강제하는 것 (해석 아님)**

1. **후보 A(문헌 완전 재현)는 실행 불가하다.** 우선주 redemption·liquidation은 표준 XBRL에
   사실상 없고(B5), 이연법인세 대차대조표 항은 custom이거나 부재하거나 주석과 구분되지
   않으며(B9·B10·B13), ITC는 유틸리티 전용이다(B12).
2. **`Assets − Liabilities` fallback은 XBRL 시대에 문헌과 다른 것을 잰다**(B4). 문헌 그대로
   옮기면 NCI가 조용히 들어간다.
3. **`Statement` role + 무차원만으로는 부족하다**(B2). `Total Assets` 계약을 그대로 복사할 수 없다.
4. **`PreferredStockValue == 0`은 "우선주 없음"이 아니다**(B7). 발행주식수가 판별 신호다.
5. **`SE(i) == SE(p) + NCI`를 exact로 걸면 반올림에서 3.1%가 깨진다**(B3). `Total Assets`의
   752/752 exact와 같은 강도를 여기서 기대할 수 없다.

**INTERPRETATION — 내가 보는 선택 구조**

이 lineage의 Value 축은 `B/M` 하나다. 문헌 식의 세 항 중 **두 항(DT·PS)이 복원 난이도가
전혀 다르다.** 우선주는 발행주식수라는 실측 신호로 ZERO/UNKNOWN을 가를 수 있어 다룰 수
있지만, **이연법인세는 가용성 33%에 영향 최대 107%, 게다가 가용성이 업종과 상관된다.**

따라서 **후보 C를 잠정 선두 후보로 보되, 그것이 "문헌 정의를 축소한 다른 정의"라는 사실을
문서에 명시적으로 남기는 것**이 정직한 경로라고 본다. 다만 **이것은 경제적 정의의 변경이므로
§4.3을 건드리는 결정이고, 내가 정할 수 없다.** §14-1이 그 결정이다.

**freeze 가능 여부**: `Stockholders' Equity` 축만 떼면 지금도 freeze할 수 있다.
**preferred와 deferred tax는 §14의 결정 없이는 freeze 불가다.**

---

## 14. 사용자가 결정해야 할 사항

### 14-1. 이연법인세 / ITC 항을 어떻게 할 것인가 — 가장 큰 결정

```text
(a) 이번 lineage에서 DT/ITC 항을 쓰지 않는다   BE = SE - preferred
    -> 문헌 식과 다른 정의임을 §4.3에 명시
(b) 표준 대차대조표 라인이 있을 때만 가산       (후보 D)
(c) DT 항을 못 구하면 그 issuer-year를 MISSING
```

**tradeoff**: (b)는 문헌에 가장 가깝지만 **가용성이 업종과 상관되어 체계적 편향**을 만든다
(B11 — UNP 107%, MSFT 0.1%). (c)는 편향은 없지만 자본집약 업종이 대거 빠져 universe 성격이
바뀐다. (a)는 정의가 일관되지만 문헌 재현이 아니다.

**추천 (a).** 이유: 로드맵 §0.2가 이미 "우리가 찾는 것은 논문의 수익률 재현이 아니라 현재
갈피 데이터에서 실제 보유 가능한 포트폴리오의 경제성"이라고 고정했다. **정의의 일관성이
문헌 근접성보다 우선한다.** 다만 이는 §4.3의 경제적 정의를 축소하는 변경이므로 **네 승인이
필요하다.**

### 14-2. parent equity를 어떻게 얻을 것인가

```text
(a) 대차대조표 role의 parent StockholdersEquity 만. 없으면 MISSING
(b) 없으면 IncludingNCI - MinorityInterest 로 복원
(c) (b)를 쓰되 redeemable NCI / temporary equity fact가 있으면 fail-close
```

**tradeoff**: (a)는 CAT·JNJ·PG·VZ 같은 대형주가 통째로 빠진다(B1, 79 accession). (b)는
Tesla형 mezzanine 오염을 그대로 먹는다(B2, +7.7%). (c)는 (b)의 위험만 좁게 막는다.

**추천 (c).** 이유: B1의 4개 발행사는 대차대조표에 소계 라인이 없을 뿐 **NCI가 명시적으로
표시되어 있어 차감이 결정론적**이다. 반면 Tesla형 오염은 `RedeemableNoncontrollingInterest*`
/ `TemporaryEquity*` fact의 **존재 여부**로 사전에 탐지된다.

### 14-3. `IncludingNCI == parent + NCI` 검증을 어떻게 쓸 것인가

```text
(a) exact 필수. 불일치는 fail-close        -> 반올림으로 3.1% 손실
(b) 표시 반올림 단위 이내 차이는 통과       -> 새 tolerance를 만드는 것
(c) 검증을 강제하지 않고 진단으로만 기록
```

**tradeoff**: `Total Assets`에서는 exact가 공짜였지만(752/752) 여기서는 세 값의 합이라
반올림이 누적된다(B3). (b)는 앞선 두 계약이 일관되게 거부해 온 **tolerance 도입**이다.

**추천: 지금 정하지 말고 (c)로 두되, 후보 (b)를 열려면 "임의 문턱"이 아니라 filing이
선언한 표시 단위(`RoundingOption` / `decimals` 속성)에서 파생되는 값이어야 한다는 조건을
함께 정한다.** 이 조건이 성립하는지는 이 정찰에서 확인하지 않았다.

### 14-4. 우선주 차감을 어떻게 정의할 것인가

```text
(a) liquidation preference가 있으면 그것, 없고 발행주식수 0이면 0,
    발행주식수 > 0 인데 금액이 par뿐이면 MISSING           (후보 C)
(b) PreferredStockValue(대차대조표 금액)만 쓴다
(c) 우선주 차감을 하지 않는다
```

**tradeoff**: (b)는 AVGO에서 자본을 15.7% 과대계상한다(B6). (c)는 더 크게 틀린다.
(a)는 문헌 취지에 가장 가깝지만 우선주 보유 issuer-year 일부가 MISSING이 된다.

**추천 (a).** 이유: B7이 **ZERO와 MISSING을 가를 실측 신호(`PreferredStockSharesIssued`)가
실제로 존재함**을 보여주므로, 추측 없이 셋을 구분할 수 있다.

### 14-5. 우선주 태그가 전무한 발행사를 0으로 볼 것인가

```text
(a) 우선주 관련 태그가 전무하면 ZERO로 본다
(b) UNKNOWN으로 보고 MISSING
```

**tradeoff**: 표본 14/31 발행사가 여기 해당한다(B8). (b)면 AAPL·MSFT·XOM 같은 핵심 대형주가
전부 빠진다. (a)는 "태그 없음 = 없음"이라는 추론인데, **AVGO FY2019는 금액 태그가 없으면서
청산가치 태그는 있었다** — 즉 태그 부재가 곧 부재는 아니다.

**추천 (a)로 하되 조건을 붙인다** — 우선주 관련 **어떤** 태그도(금액·주식수·청산가치 전부)
없을 때만 ZERO로 보고, 하나라도 있으면 §14-4의 규칙을 태운다. 표본에서 이 조건이 실제로
안전한지는 **전수에서 다시 확인해야 한다.**

### 14-6. Book Equity에도 연결 대차대조표 role을 강제할 것인가

```text
(a) 강제한다 (Total Assets §4.2.2와 같은 구조, 단 role을 "대차대조표"로 더 좁게)
(b) Statement role이면 충분
```

**추천 (a).** 이유는 tradeoff가 아니라 evidence다 — B2에서 equity roll-forward도 `Statement`
role이고 scope가 다르다.

---

## 15. source URLs / accessions

### 문헌

```text
Ken French, Variable Definitions (Book Equity)
  https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/Data_Library/variable_definitions.html
Novy-Marx, The Other Side of Value: The Gross Profitability Premium (저자 원고)
  https://mysimon.rochester.edu/novy-marx/research/OSoV.pdf
  게재본: Journal of Financial Economics 108(1), 2013, 1-28 · DOI 10.1016/j.jfineco.2013.01.003
SFAS No. 160 (NCI를 자본 내 별도 표시 · 2008-12-15 이후 개시 회계연도부터 적용)
  요약 근거: SEC 및 회계 실무 문헌. FASB 공식 요약 페이지는 이 정찰에서 HTTP 403으로 직접
  인용하지 못했다(§16 한계).
```

### SEC

```text
companyfacts   https://data.sec.gov/api/xbrl/companyfacts/CIK##########.json
submissions    https://data.sec.gov/submissions/CIK##########.json
filing 구조     https://www.sec.gov/Archives/edgar/data/{cik}/{accession_nodash}/FilingSummary.xml
rendered       https://www.sec.gov/Archives/edgar/data/{cik}/{accession_nodash}/R#.htm
```

|주장|근거|
|---|---|
|PG·CAT·VZ 대차대조표에 parent 소계 라인 없음|`0000080424-26-000103` `R6.htm` · `0000018230-26-000008` `R5.htm` · `0000732712-26-000007` `R6.htm`|
|Tesla mezzanine이 `IncludingNCI`에 포함|`0001564590-17-003118` `R2.htm`(대차대조표) vs `R6.htm`(roll-forward, `100050 - Statement - ...`)|
|Broadcom 액면 $0 vs 청산가치 $3.738B|`0001730168-20-000226` · `0001730168-19-000144` · `0001730168-22-000118`|
|Southern Company 대차대조표의 ITC와 custom 이연법인세|`0000092122-26-000006` `R8.htm`|
|Caterpillar 대차대조표 이연법인세가 custom|`0000018230-26-000008` `R5.htm`|
|Apple 대차대조표에 이연법인세 라인 없음|`0000320193-25-000079` `R5.htm`|
|Boeing 지배주주지분 +366% 재작성|`0000012927-18-000007` vs `0000012927-19-000010`|
|MSFT ASC 606 소급 +21.2%|`0001564590-17-014900` vs `0001564590-18-019062`|
|AAPL ASU 2009-13 소급 +13.7%|`0001193125-09-214859` vs `0001193125-10-012091`|
|GE 재작성|`0000040545-18-000014` vs `0000040545-19-000014`|
|반올림으로 항등식이 깨지는 사례|`0001166691-25-000011` · `0000040545-21-000011` · `0000078003-20-000014` 등 8건|

### 내부 계약

```text
docs/trading/strategies/quality-value-roadmap.md   §4.1 §4.2 §4.2.1 §4.2.2 §4.3 §17
trading/runs/qv-data-audit/README.md               §3.1 §3.2 §3.6 §3.7 §7
trading/runs/qv-data-audit/PROBE-gross-profit-mapping.md
trading/runs/qv-data-audit/PROBE-total-assets-mapping.md
trading/runs/qv-data-audit/PROBE-me-source.md
trading/backtest/qv_submissions.py · schema.sql    qv_sec_filings
```

---

## 16. 조사하지 않은 것 / 한계

```text
수익률 · QV rank · B/M 결과 · Sharpe · PF · MDD          0회
coverage Gate A~H 판정                                   하지 않음
프로덕션 코드 · schema · 테스트 · run-card 수정            없음
로드맵 · canonical README 수정                            없음
DB 접근 · ingestion 실행                                  없음
Gross Profit · Total Assets · shares/ME · SIC 계약 변경    없음
```

**한계**

- **Compustat의 `SEQ`·`CEQ`·`PSTK`·`PSTKRV`·`PSTKL`·`TXDITC` 정의를 1차 자료로 확인하지
  못했다.** 유료 매뉴얼이라 접근하지 못했고, 그래서 §3.3에서 mnemonic 대응을 근거로 삼지
  않았다. **Compustat 항목과 XBRL 개념의 경제적 동일성은 이 정찰이 검증하지 못한 부분이다.**
- **SFAS 160 요약을 FASB 공식 페이지에서 직접 인용하지 못했다**(HTTP 403). 적용 시점과
  표시 위치는 2차 자료로 확인했고, §6.3의 실측(NCI>0에서 `Assets−Liabilities == parent`가
  0건)이 그 해석을 독립적으로 뒷받침한다.
- 표본은 **비금융 30개 발행사**다. 금융업은 primary universe가 제외하므로 넣지 않았고,
  따라서 **금융업의 우선주·이연법인세 semantics는 이 정찰의 범위 밖**이다. 소형주·최근
  상장사·외국 발행사(20-F)도 없다.
- **연결 대차대조표 role 식별을 표본 일부 accession에서만 원문 확인했다**(PG·CAT·VZ·TSLA·
  AVGO·SO·AAPL). 484건 전수의 role 판정 가능성은 검증하지 않았다.
- §6.3의 `Assets − Liabilities != SE(i)` 64건의 원인을 원문으로 전수 확인하지 않았다.
- `Total Assets` probe와 달리 이번에는 **`dei:DocumentPeriodEndDate`를 전수로 대조하지
  않고** `submissions.reportDate`를 앵커로 썼다. 그 앵커의 실패율(369/370)은
  `PROBE-total-assets-mapping.md` §6.1에 있고, **본구현에서는 §4.2.2 계약대로
  `dei:DocumentPeriodEndDate`가 정본이다.**
