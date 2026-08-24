# Phase 0 정찰 — Gross Profit accounting mapping

> **READ-ONLY 연구 기록이다.** 프로덕션 코드·schema·테스트·로드맵 계약을 바꾸지 않았고
> **수익률을 0번 계산했다.** 이 문서는 결정을 내리지 않고 **정본을 고를 근거**를 모은다.
> 최종 mapping 확정은 §10의 승인 항목이 닫힌 뒤다.

로드맵 §4.2가 Phase 0으로 넘긴 결정(`GrossProfit` 직접 태그 vs `Revenue − COGS`)과
`README.md` §3.2의 첫 칸을 정찰한다. 형식은 `PROBE-me-source.md`를 따른다.

---

## 1. 확인한 최신 main SHA

```text
47d89d42c3bc0400c172fead70bd67a9f3c31199
2026-08-24 18:35:34 +0900
fix(trading): QV filing 구형 DB를 Eastern 경계로 이관한다
```

`git fetch origin main` 후 `origin/main`과 로컬 `HEAD`가 같고 working tree는 깨끗했다.
아키텍처 리뷰 시점과 **동일하다** — 그 사이 새 커밋은 없다.

읽은 문서·코드: `docs/trading/strategies/quality-value-roadmap.md`,
`trading/runs/qv-data-audit/README.md`, `trading/runs/qv-data-audit/PROBE-me-source.md`,
`trading/backtest/qv_submissions.py`, `trading/backtest/edgar.py`,
`trading/backtest/schema.sql`. momentum-v2의 CLOSED/FROZEN 결정은 열지 않았다.

---

## 2. 표본

의도적으로 이질적으로 골랐다. **기술주만 보면 전부 통과한다**는 것이 이 정찰의 첫 결론이다.

|issuer|CIK|성격|companyfacts 최초 10-K|annual period ends|
|---|---|---|---|---|
|Apple|`0000320193`|기술 하드웨어|2009-10-27|19|
|Microsoft|`0000789019`|소프트웨어|2010-07-30|19|
|Amazon|`0001018724`|리테일 + 클라우드|2010-01-29|19|
|Walmart|`0000104169`|리테일러|2010-03-30|19|
|Caterpillar|`0000018230`|산업재 + 금융자회사|2010-02-19|19|
|Boeing|`0000012927`|항공우주|2010-02-08|19|
|Johnson & Johnson|`0000200406`|헬스케어|2010-03-01|19|
|Pfizer|`0000078003`|제약|2010-02-26|19|
|Exxon Mobil|`0000034088`|에너지|2010-02-26|17|
|Procter & Gamble|`0000080424`|소비재|2010-08-13|19|
|Coca-Cola|`0000021344`|음료|2010-02-26|19|
|Verizon|`0000732712`|통신|2010-02-26|19|
|Costco|`0000909832`|창고형 리테일|2010-10-18|18|
|Home Depot|`0000354950`|하드라인 리테일|2010-03-25|19|
|Intel|`0000050863`|반도체|2010-02-22|19|
|Walt Disney (구)|`0001001039`|미디어|2009-12-02|12|
|Walt Disney (현)|`0001744489`|미디어|2019-11-20|9|

기간은 초기 XBRL(fiscal 2007~2009 비교표시), 중기(2013~2017), 최근(2023~2026)을 모두 포함한다.

**추출 규칙**: `us-gaap` namespace, unit `USD`, `form`이 `10-K`로 시작, `start`/`end` 존재,
duration 340~400일. 같은 fiscal period가 후속 filing에 다시 나오므로 **accession을 절대
접지 않았다.** 결과 단위는 `(period_end, accession)` 그룹이며 **총 813개**다.

### 2.1 임시 스크립트 (프로덕션 아님)

전부 `scratchpad/qv-recon/`에 있고 저장소에 넣지 않았다. `edgar.py`의 `EdgarClient`를
쓰지 않고 같은 User-Agent·간격으로 별도 조회했다(읽기 전용, DB 미접근).

|파일|한 일|
|---|---|
|`fetch.py`|17개 CIK의 companyfacts JSON을 파일로 캐시|
|`extract.py`|위 추출 규칙으로 annual 10-K fact를 뽑음|
|`survey.py`|이름에 revenue/cost/gross가 든 모든 개념을 전수 나열|
|`recon.py`|direct GP를 정확히 재현하는 `(revenue, cogs)` 쌍을 역으로 탐색|
|`audit.py` / `hier.py`|후보 계층별 tie-out과 계층 간 불일치를 측정|
|`filing.py`|`FilingSummary.xml` → `R*.htm`에서 **표시 라벨 ↔ XBRL 요소명**을 대조|

---

## 3. 태그 인벤토리

### 3.1 direct Gross Profit

표준 개념은 **`us-gaap:GrossProfit` 하나뿐이다.** 다른 후보는 없었다.

annual 10-K fact 기준 존재 여부:

```text
전 기간 존재   AAPL · MSFT · BA · HD · INTC · JNJ · KO         (6/16 발행사)
단발성 존재    AMZN (FY2007~2009만) · COST (FY2019 1건만)
연간값 없음    CAT · PFE · PG · VZ · WMT · XOM · DIS(신·구)
```

**CAT은 `GrossProfit`을 10-K에 88건 갖고 있지만 전부 88~91일 분기값이다**(보충 분기 주석).
연간 duration 필터가 없으면 분기값이 연간 GP로 들어간다.

### 3.2 Revenue 계열 (무차원 annual 10-K에서 실제로 관측된 것)

```text
us-gaap:Revenues
us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax
us-gaap:SalesRevenueNet
us-gaap:SalesRevenueGoodsNet
us-gaap:SalesRevenueServicesNet
us-gaap:RevenueNotFromContractWithCustomer                       (VZ)
us-gaap:RevenueFromCollaborativeArrangementExcludingRevenueFromContractWithCustomer  (PFE)
```

### 3.3 COGS 계열

```text
us-gaap:CostOfRevenue
us-gaap:CostOfGoodsAndServicesSold
us-gaap:CostOfGoodsSold
us-gaap:CostOfServices
us-gaap:CostOfGoodsSoldExcludingDepreciationDepletionAndAmortization      (DISo)
us-gaap:CostOfServicesExcludingDepreciationDepletionAndAmortization       (DISo)
```

### 3.4 이름이 닮았지만 손익계산서가 아닌 개념 — 자동 매칭 금지 대상

`survey.py`가 이름 정규식으로 긁으면 아래가 같이 걸린다. **전부 주석/세그먼트/중단사업이다.**

```text
EquityMethodInvestmentSummarizedFinancialInformationRevenue / ...GrossProfitLoss / ...CostOfSales
SegmentReportingInformationRevenue / SegmentReportingSegmentRevenue
DisposalGroupIncludingDiscontinuedOperationRevenue / ...CostsOfGoodsSold / ...GrossProfitLoss
BusinessAcquisitionsProFormaRevenue
ContractWithCustomerLiabilityRevenueRecognized / RecognitionOfDeferredRevenue
RevenueRecognitionSalesReturnsReserveForSalesReturns / SalesReturnsAndAllowancesGoods
OperatingLeasesIncomeStatementSubleaseRevenue
```

이름 유사도 매칭을 금지한 §4.2는 **custom tag뿐 아니라 표준 태그에도 필요하다.**

---

## 4. direct vs reconstructed 감사

`(period_end, accession)` 813 그룹 전체 분류:

|상태|건수|
|---|---|
|direct GP와 재구성이 **둘 다** 있고 **정확히 일치**|**361**|
|둘 다 있고 material mismatch|**1**|
|direct GP 없음 · 재구성 가능|346|
|direct GP 없음 · 재구성 **불가**|105|
|direct GP 있음 · 재구성 불가|0|

**tie-out이 가능한 362건 중 361건이 `diff == 0`이다.** tolerance가 필요했던 건은 없다.
`IMMATERIAL_DIFFERENCE` 구간(0 < rel < 0.5%)은 **표본에서 한 건도 나오지 않았다.**

### 4.1 유일한 MATERIAL_MISMATCH — Costco FY2019

```text
CIK              0000909832
accession        0000909832-19-000019   (10-K, filed 2019-10-11)
fiscal end       2019-09-01   start 2018-09-03   d=363   unit USD
fy=2019  fp=Q4   frame=CY2019

us-gaap:GrossProfit                                      16,465,000,000
us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax 152,703,000,000
us-gaap:Revenues                                        152,703,000,000
us-gaap:CostOfGoodsAndServicesSold                      132,886,000,000

reconstructed  = 152,703 − 132,886 = 19,817
direct         = 16,465
absolute diff  = 3,352,000,000
relative diff  = 20.36%
```

**원인은 원문에서 확정했다.** `R32.htm — Summary of Significant Accounting Policies -
Additional Information (Details)`에 `us-gaap:GrossProfit`이 있다. 즉 이 GP는 **손익계산서
라인이 아니라 회계정책 주석 값**이고, Costco의 손익계산서(`R4.htm`)에는 gross profit
소계 자체가 없다. 그리고 그 주석 GP는 **net sales 149,351 − merchandise costs 132,886**로
계산됐다. 반면 `RevenueFromContractWithCustomerExcludingAssessedTax`는 "Total revenue"
152,703(= net sales + membership fees 3,352)로 태깅돼 있다.

```text
diff 3,352,000,000 = Costco FY2019 membership fees
```

프롬프트가 지목한 Walmart형 함정이 **숫자로 그대로 재현됐다.**

---

## 5. taxonomy 세대 변화

### 5.1 관측된 전환

```text
SalesRevenueNet / SalesRevenueGoodsNet / SalesRevenueServicesNet
        → RevenueFromContractWithCustomerExcludingAssessedTax        (ASC 606, FY2018 전후)

CostOfGoodsSold + CostOfServices
        → CostOfGoodsAndServicesSold
```

전환 시점은 발행사마다 다르다. AAPL·INTC는 FY2018, JNJ·KO는 FY2018, VZ는 FY2018에
COGS 태깅 자체를 끊었다(§6.1).

### 5.2 한 filing 안에서는 깨끗하다

**같은 accession·같은 annual period에 `SalesRevenueNet`과
`RevenueFromContractWithCustomerExcludingAssessedTax`가 동시에 있는 경우는 0건이었다.**
전환은 filing 단위로 한 번에 일어나므로 "한 filing 안에서 둘 중 뭘 고를지"의 문제는 없다.

또한 `(accn, tag, start, end, unit)`이 같은데 값이 다른 충돌도 **0건**이고, 위 태그들의
unit은 전부 `USD` 하나였다. **키잉은 결정적이다 — 흔들리는 것은 의미뿐이다.**

### 5.3 그러나 filing이 바뀌면 같은 기간의 개념이 바뀐다 — Pfizer

같은 fiscal period `2023-12-31`을 세 filing이 담고 있다.

|accession|filed|Revenues|RevenueFromContract…|CostOfGoodsAndServicesSold|
|---|---|---|---|---|
|`0000078003-24-000039`|2024-02-22|58,496|50,914|24,954|
|`0000078003-25-000054`|2025-02-27|59,553|**없음**|24,954|
|`0000078003-26-000026`|2026-02-26|59,553|**없음**|24,954|

같은 기간의 재구성 GP가 filing에 따라 **25,960 / 33,542 / 34,599**로 갈린다.
이 중 두 효과는 분리된다.

```text
7,582  = 개념 범위 차이 (총매출 vs 고객계약매출; alliance revenue 등이 빠짐)
1,057  = 실제 재작성 (58,496 → 59,553)
```

**"narrow 우선" 계층은 FY2023 10-K에서 25,960을, FY2024 10-K에서 34,599를 준다.**
PIT 규칙상 formation 시점에 따라 어느 filing을 보는지가 달라지므로, 이 차이는 재작성이
아니라 **태그 가용성만으로** 33% 흔들리는 값이다.

### 5.4 재작성/정정본 — Apple FY2009

```text
0001193125-09-214859  10-K    acceptance 2009-10-27T20:18:29Z
    end 2009-09-26   SalesRevenueNet 36,537   COGS 23,397   GrossProfit 13,140
0001193125-10-012091  10-K/A  acceptance 2010-01-25T21:25:58Z
    end 2009-09-26   SalesRevenueNet 42,905   COGS 25,683   GrossProfit 17,222
```

ASU 2009-13/14 소급적용이다. 두 filing 모두 **자기 안에서는 tie-out이 정확**하다
(36,537−23,397=13,140; 42,905−25,683=17,222). 차이는 mapping이 아니라 PIT다.

`README.md` §3.1의 amended-filing 규칙과 정확히 맞물린다.

```text
2009-10-28 ~ 2010-01-25 사이 formation  → 원본 10-K  → GP 13,140
2010-01-26 이후 formation               → 10-K/A     → GP 17,222
```

**`acceptanceDateTime`이 2009~2010년 filing에도 실제로 존재함을 확인했다.** 따라서 이
분기는 `qv_sec_filings.historical_usable_session`으로 결정론적으로 갈린다.

### 5.5 `frame` · `fy` · `fp`는 신뢰할 수 없다

- **`fy`/`fp`는 fact의 회계연도가 아니라 그 fact를 담은 filing의 회계연도다.**
  Apple의 `end=2007-09-29` fact가 `fy=2009 fp=FY`로 온다.
- Costco의 **연간** 10-K fact가 `fp=Q4`다(`0000909832-19-000019`).
- `frame`은 품질 신호가 아니다. §6.5의 CAT 세그먼트 조정값($49M)에 `frame=CY2025`가,
  Costco의 주석 GP에 `frame=CY2019`가 붙어 있다.

**기간 식별은 `start`/`end`로만 한다.**

---

## 6. systematic blocker와 미해결 사례

### 6.1 B1 — COGS가 차원에만 붙어 companyfacts에서 사라진다

`PROBE-me-source.md` §8.1이 shares에서 확인한 "companyfacts fact에 dimension이 없다"가
회계 쪽에서는 **손익계산서 라인의 소실**로 나타난다.

**Verizon FY2025** (`0000732712-26-000007`, `R3.htm`):

```text
us-gaap:Revenues                     Operating Revenues              138,191   (무차원 O)
us-gaap:CostOfGoodsAndServicesSold   Cost of services and wireless
                                     equipment                        28,976 / 27,789
                                       → srt:ProductOrServiceAxis 차원에만 존재. 무차원 총계 없음
```

VZ의 무차원 COGS 개념은 `CostOfGoodsAndServicesSold`가 FY2014까지,
`CostOfGoodsSold`+`CostOfServices`가 FY2017까지다. **FY2018 이후 8개 회계연도는 0건**이다.

**Disney (현 CIK) FY2025** (`0001744489-25-000155`, `R3.htm`): 완전히 같은 모양이다.

```text
us-gaap:Revenues                     Revenues                         94,425   (무차원 O)
us-gaap:CostOfGoodsAndServicesSold   Cost of Product and Service Sold 52,677 / 6,089
                                       → 차원에만 존재
us-gaap:CostsAndExpenses             Total costs and expenses         80,593   (SG&A·D&A 포함, COGS 아님)
```

구 Disney CIK도 FY2007~2011은 무차원 COGS가 없다(FY2012부터
`CostOfGoodsSoldExcludingDDA`+`CostOfServicesExcludingDDA` 등장).

### 6.2 B2 — 표준 COGS 개념이 역사 전체에 아예 없다: Exxon Mobil

전 namespace·전 기간을 훑었다. XOM의 무차원 annual 10-K에 존재하는 비용 총계는
`us-gaap:CostsAndExpenses`(SG&A·DD&A·이자·제세 포함 총계)뿐이고, 실제 원가 라인은
**issuer custom**이다.

```text
xom:CrudeOilAndProductPurchases        184,248
xom:ProductionAndManufacturingExpenses  42,424
```

§4.2가 issuer custom tag의 이름 유사도 매칭을 금지하므로 **XOM은 구조적으로 매핑 불가**다.
표본의 45개 그룹(fiscal 2009~2025 전부)이 여기 해당한다.

부수적으로 XOM의 `us-gaap:Revenues` 332,238은 매출이 아니라 "Revenues and other income"
총계이고, 차원 분해상 sales and other operating revenue 323,905 + 지분법이익 5,064 +
기타수익으로 구성된다. `us-gaap:ExciseAndSalesTaxes`도 FY2007~2016에 별도로 존재한다.

### 6.3 B3 — `GrossProfit` fact가 손익계산서 라인이 아닐 수 있다

독립적인 반례 둘을 원문에서 확인했다.

|issuer|무엇인가|출처|
|---|---|---|
|Caterpillar|10-K의 `GrossProfit` 88건이 **전부 분기값** (보충 분기 주석)|duration 88~91일|
|Costco|`GrossProfit` = **회계정책 주석 값** (net sales 기준)|`R32.htm`|

**"annual duration의 `us-gaap:GrossProfit`이 10-K에 있다" ≠ "손익계산서 gross profit"이다.**

### 6.4 B4 — 무차원 태그의 범위가 발행사·시점에 따라 달라진다 (가장 치명적)

같은 `us-gaap:Revenues`가 발행사마다 다른 것을 가리킨다.

|issuer|filing|`us-gaap:Revenues` 라벨|의미|
|---|---|---|---|
|P&G|`0000080424-26-000103`|**NET SALES** 87,032|연결 순매출|
|Walmart|`0000104169-26-000055`|**Total revenues** 713,163|순매출 + 회원비·기타수익|
|Caterpillar|`0000018230-26-000008`|**Total sales and revenues** 67,589|기계 63,980 + 금융자회사 3,609|
|Exxon Mobil|`0000034088-26-000045`|**Revenues** 332,238|매출 + 지분법이익 + 기타수익|
|Pfizer|`0000078003-26-000026`|**Total revenues**|고객계약매출 + alliance revenue|

**더 나쁜 것은 한 발행사 안에서도 시점에 따라 달라진다는 점이다.**
P&G FY2014 10-K(`0000080424-14-000057`)에서:

```text
us-gaap:SalesRevenueNet    83,062,000,000     ← 손익계산서 NET SALES
us-gaap:Revenues           29,400,000,000     ← R82 "SEGMENT INFORMATION - ADDITIONAL
                                                 INFORMATION (DETAIL)"의 "Net sales in the U.S."
us-gaap:CostOfGoodsSold    42,460,000,000     ← 손익계산서 Cost of products sold
```

즉 **P&G의 무차원 `Revenues`는 2014년 filing에서 미국 지역 순매출이고, 2026년 filing에서는
연결 NET SALES다.** 같은 개념, 같은 발행사, 반대 의미다.

`Revenues`를 우선하는 계층은 P&G FY2012~2014에 대해

```text
29,400 − 42,460 = −13,060,000,000
```

를 산출한다. **§4.2가 "음수 Gross Profit은 허용한다"고 고정해 뒀으므로 이 값은 어떤 유효성
검사도 통과하고, P&G를 quality 최하위 분위로 밀어 넣는다.** 조용한 오류다.

### 6.5 B5 — `CostOfGoodsAndServicesSold`가 세그먼트 조정값인 경우: Caterpillar

```text
us-gaap:CostOfGoodsAndServicesSold  (무차원, annual, 10-K)
    FY2022  413,000,000
    FY2023  160,000,000
    FY2024   33,000,000
    FY2025   49,000,000     accn 0000018230-26-000008   frame=CY2025

출처: R132.htm — "Segment information - Reconciliations of consolidated profit
      before taxes (Details)" 의 "Inventory/cost of sales" 라인
```

같은 filing의 실제 손익계산서 COGS는 `us-gaap:CostOfRevenue` = **44,752,000,000**이다.

```text
CostOfGoodsAndServicesSold 우선 계층 →  67,589 −     49 = 67,540   (196% 과대)
CostOfRevenue 우선 계층            →  67,589 − 44,752 = 22,837   (올바름)
```

**CAT은 FY2021까지는 이 함정이 없다가 FY2022부터 생긴다.** 즉 같은 발행사가 초기엔 맞고
후기엔 3배 틀린다. §6.4의 P&G와 정확히 반대 방향의 조용한 오류다.

### 6.6 B6 — broad vs narrow revenue의 크기

같은 accession 안에서 `Revenues`와 narrow 개념이 둘 다 있을 때의 격차(GP 대비):

|issuer|기간|`Revenues`|narrow|gap|GP(narrow) 대비|
|---|---|---|---|---|---|
|WMT|2026-01-31|713,163|706,413|6,750|**3.95%**|
|WMT|2024-01-31|648,125|642,637|5,488|3.60%|
|CAT|2017-12-31|45,462|42,676|2,786|**23.96%**|
|CAT|2016-12-31|38,537|35,773|2,764|**37.03%**|
|PFE|2023-12-31|58,496|50,914|7,582|**29.21%**|
|PFE|2022-12-31|100,330|91,793|8,537|14.86%|
|COST|2025-08-31|275,235|275,235|0|0.00%|

**Costco의 gap이 0인 이유가 중요하다** — `Revenues`와
`RevenueFromContractWithCustomerExcludingAssessedTax`가 **둘 다 total revenue**여서
narrow 개념이 companyfacts에 **아예 없다.** Costco의 issuer-defined gross profit은
companyfacts만으로는 복원 불가능하다.

### 6.7 계층 선택이 얼마나 결과를 바꾸는가 — 결정적 측정

네 가지 그럴듯한 계층(revenue narrow-first / Revenues-first × COGS `CostOfGoodsAndServicesSold`-first /
`CostOfRevenue`-first)을 813 그룹에 모두 돌렸다.

```text
direct GP가 있어 tie-out으로 검증되는 362 그룹
    → 네 계층 전부 동일한 결과 (EXACT 361 / MATERIAL 1)
    → 즉 검증 장치가 있는 곳에서는 계층 순서가 무의미하다

direct GP가 없어 검증 장치가 없는 346 그룹
    → 114 그룹(33%)에서 계층 간 결과가 갈린다
    → 최대 spread 132% (P&G FY2014), 66% (CAT FY2025)
```

**계층은 자기가 틀리는 곳에서만 자유도를 갖는다.** 이것이 이 정찰의 핵심 결과다.

### 6.8 발행사별 요약

`grp` = `(period_end, accession)` 그룹 수, `tie` = direct GP와 재구성이 정확히 일치,
`recon` = GP 없이 재구성만 가능, `none` = 둘 다 불가, `ambig` = 계층 간 결과 불일치.

|issuer|ends|GP ends|grp|tie|mismatch|recon|none|ambig|
|---|---|---|---|---|---|---|---|---|
|AAPL|19|19|54|54|0|0|0|0|
|BA|19|19|51|51|0|0|0|0|
|HD|19|19|51|51|0|0|0|0|
|INTC|19|19|51|51|0|0|0|0|
|JNJ|19|19|51|51|0|0|0|0|
|KO|19|19|51|51|0|0|0|0|
|MSFT|19|19|51|49|0|2|0|0|
|AMZN|19|3|51|3|0|48|0|0|
|COST|18|1|48|0|**1**|47|0|**24**|
|CAT|19|0|51|0|0|51|0|**33**|
|PFE|19|0|51|0|0|51|0|3|
|PG|19|0|54|0|0|54|0|3|
|WMT|19|0|51|0|0|51|0|**51**|
|VZ|19|0|51|0|0|27|**24**|0|
|DISo|12|0|30|0|0|15|**15**|0|
|DIS|9|0|21|0|0|0|**21**|0|
|XOM|17|0|45|0|0|0|**45**|0|

**16개 발행사 중 7개(AAPL·BA·HD·INTC·JNJ·KO·MSFT)만 tie-out으로 자기검증된다.**

> **coverage 비율은 여기서 판정하지 않는다.** `PROBE-me-source.md` §2와 같은 규율을
> 유지한다 — 이 정찰이 보는 것은 **systematic blocker의 유무**이고, Gate A/B는 본구현
> 전수에서만 판정한다. 위 표를 coverage 추정치로 읽지 않는다.

---

## 7. 후보 결정론적 mapping

### 후보 A — direct `GrossProfit` 우선, 없으면 표준 계층으로 재구성

```text
1. annual duration us-gaap:GrossProfit 이 있으면 그것
2. 없으면 revenue 계층 − cogs 계층
```

### 후보 B — 재구성만 사용 (direct GP 무시)

```text
revenue 계층 − cogs 계층 을 항상 사용
```

### 후보 C — tie-out 검증 후 fail-close

```text
direct GP와 재구성이 둘 다 있으면  → 정확히 같을 때만 채택, 다르면 UNRESOLVED
direct GP만 있으면                → 채택
재구성만 있으면                    → 계층 간 결과가 유일할 때만 채택, 갈리면 UNRESOLVED
둘 다 없으면                       → MISSING
```

### 후보 D — presentation linkbase로 손익계산서 fact만 고른다

companyfacts를 의미 판정에 쓰지 않고, filing의 **statement role과 presentation 순서**로
"이 fact가 연결손익계산서 라인인가"를 판정한 뒤 그 안에서만 revenue/cogs/GP를 고른다.
`PROBE-me-source.md` §8.2가 shares에 대해 채택한 **raw XBRL instance 경로와 같은 성격**이다.

---

## 8. 후보별 트레이드오프

|후보|장점|이 정찰이 찾은 실패 모드|
|---|---|---|
|**A**|가장 단순. 7개 발행사에서 완벽|COST의 주석 GP를 정본으로 삼는다(20.4% 오류). AMZN은 FY2007~2009만 GP가 있어 **같은 발행사가 연도에 따라 다른 정의로 계산**된다. 재구성 구간은 후보 B의 실패를 전부 물려받는다|
|**B**|정의가 한 벌로 통일됨. AMZN의 정의 불연속이 사라진다|**114/346 그룹에서 계층 순서가 결과를 바꾼다.** CAT FY2022+ 196% 과대, P&G FY2012~2014 음수 GP. 둘 다 조용히 통과한다|
|**C**|**틀린 값을 만들지 않는다.** 검증 가능한 곳은 검증하고, 나머지는 상태로 남긴다|coverage가 크게 준다. 위 표에서 tie 361 + (계층 유일한 recon 232) 규모이고, 그중 232는 여전히 §6.4/§6.5 오류에 노출된다 — **계층이 갈리지 않는다고 맞는 것은 아니다**. WMT는 네 계층이 모두 다르므로 UNRESOLVED가 되어 S&P 500 최대 종목이 빠진다|
|**D**|§6.1(차원 전용 COGS)·§6.3(주석 GP)·§6.4(범위 표류)·§6.5(세그먼트 조정)를 **원인 차원에서 전부 제거한다.** shares 경로와 인프라가 겹친다|XOM(§6.2)은 여전히 못 푼다 — custom tag 금지 계약이 막는다. 새 파서가 필요하고 `FilingSummary`/instance 형식이 2009~2012년과 최근이 다르다. 다만 `PROBE-me-source.md` §8.2가 2012-02-27 filing의 독립 인스턴스 파싱을 이미 실증했다|

---

## 9. 권고 mapping 계층

> **아래는 증거가 아니라 제안(architecture)이다.** §10이 닫히기 전에는 구현하지 않는다.

### 9.1 증거가 강제하는 것 (해석 아님)

1. companyfacts의 **태그 이름만으로는 경제적 범위를 알 수 없다.** 같은 개념이 발행사·시점에
   따라 연결 순매출 / 총수익 / 지역 소계 / 세그먼트 조정값이었다(§6.4, §6.5).
2. `frame`·`fy`·`fp`는 판정에 쓸 수 없다(§5.5).
3. tie-out이 되는 곳에서는 **정확 일치가 실제로 달성된다**(361/362). tolerance를 도입할
   실증적 근거가 이 표본에는 없다.
4. `acceptanceDateTime` 기반 PIT 분기는 2009년 filing까지 실제로 작동한다(§5.4).

### 9.2 제안하는 구조

**주 경로는 후보 D + 후보 C의 fail-close다.**

```text
STEP 1  formation까지 usable한 filing 선택
        qv_sec_filings.historical_usable_session <= formation session
        같은 (issuer, fiscal_year)면 README §3.1 규칙 (acceptance 최신, 동률이면 accession 사전순 마지막)

STEP 2  그 accession의 presentation linkbase에서 연결손익계산서 role을 찾는다
        role을 특정하지 못하면 → UNRESOLVED_STATEMENT_ROLE  (추정하지 않는다)

STEP 3  그 role 안에서만 무차원 fact를 읽는다
        gross_profit_line  = 그 role의 us-gaap:GrossProfit
        revenue_line       = 그 role의 revenue 계열 중 매출 소계
        cogs_line          = 그 role의 COGS 계열
        role 밖의 fact는 후보에 넣지 않는다  ← §6.3 · §6.4 · §6.5가 여기서 죽는다
        차원에만 있는 fact도 넣지 않는다     ← §6.1은 여기서 MISSING이 된다

STEP 4  tie-out
        둘 다 있고 정확히 같음        → GPA 입력으로 채택
        둘 다 있고 다름               → UNRESOLVED_TIEOUT_MISMATCH (값을 고르지 않는다)
        direct GP만                   → 채택
        revenue/cogs만                → 채택
        없음                          → MISSING (사유 보존)

STEP 5  보존
        accession · form · acceptance_datetime · historical_usable_session
        · statement role · concept · start · end · unit · value · 선택 경로
```

**`Total Assets <= 0` invalid, 음수 GP 허용, annual 10-K family only는 그대로 둔다.**

### 9.3 이 제안이 §6의 blocker에 대해 약속하는 것

|blocker|9.2에서의 결과|
|---|---|
|B1 차원 전용 COGS (VZ·DIS)|`MISSING` — 조용한 오답이 아니라 명시적 결손|
|B2 XOM custom tag|`MISSING` — §4.2 계약이 그대로 유지된다|
|B3 주석 GP (CAT·COST)|role 밖이므로 애초에 후보가 아니다|
|B4 범위 표류 (P&G)|role 안의 매출 소계만 보므로 "Net sales in the U.S."는 들어올 수 없다|
|B5 세그먼트 조정 (CAT)|role 밖이므로 후보가 아니다|
|B6 broad vs narrow|**§10-1이 결정해야 한다. 구조가 대신 정해주지 않는다**|

---

## 10. 사용자 승인이 필요한 결정

**아래를 정하기 전에는 accounting mapping을 freeze하지 않는다.**

### 10-1. Revenue 범위 — 이 정찰이 대신 정할 수 없는 유일한 경제적 선택

```text
(a) issuer-defined net sales   COGS와 짝이 맞는 좁은 매출
                               WMT 706,413 · COST 149,351 · CAT 기계매출
(b) total revenue              Novy-Marx의 REVT − COGS 정의에 더 가깝다
                               WMT 713,163 · COST 152,703 · CAT 67,589
```

**로드맵 §4.2의 `Gross Profit = Revenue − Cost of Goods Sold`는 이 둘을 가르지 않는다.**
§0.2가 근거로 든 Novy-Marx는 Compustat `REVT`(총수익)를 쓰므로 문헌 재현은 (b)에 가깝다.
반면 (b)는 회원비·금융자회사 수익처럼 **대응 원가가 없는 수익을 GP에 더한다**(CAT에서
GP의 24~37%). 어느 쪽이든 **결과를 보기 전에** 정해야 하고, 정한 뒤 `accounting_definition_version`에 박힌다.

### 10-2. direct `GrossProfit`이 정본인가

증거: role 기반으로 고르면 CAT·COST 반례가 사라지므로 **9.2 하에서는 direct GP를 정본으로
삼아도 안전하다.** 다만 AMZN처럼 일부 연도에만 GP 라인이 있는 발행사는 **같은 발행사가
연도에 따라 다른 정의로 계산되는 것을 허용할지**를 정해야 한다.

```text
(a) direct GP 우선                 → AMZN FY2007~2009와 FY2010+가 다른 정의
(b) 항상 revenue − cogs            → 정의 일관. tie-out은 검증용으로만 사용
(c) tie-out 일치 요구, 불일치는 UNRESOLVED
```

**나는 (c)를 권한다** — §4의 361/362가 (c)의 비용이 표본에서 거의 0임을 보여준다.

### 10-3. tolerance

표본에 `0 < rel < 0.5%` 구간이 **0건**이다. 따라서 **exact equality**를 제안한다.
다만 이는 16개 발행사의 증거이므로, 전수에서 반올림 단위 차이가 나오면 그때 tolerance를
만들지 말고 **원인(단위·부호·중단사업)을 먼저 제거**하는 §6.2 sentinel 규율을 따른다.

### 10-4. presentation linkbase 파서를 여는가

후보 D는 `FilingSummary.xml`/instance 파서를 새로 만든다. `PROBE-me-source.md` §8.2가
채택한 raw XBRL instance 경로와 겹치므로 **shares 본구현과 같은 계층에서 함께 만들 수 있다.**
열지 않으면 후보 C로 후퇴하고 WMT·CAT·PG·PFE·COST가 대거 UNRESOLVED가 된다.

### 10-5. 차원 전용 COGS를 어떻게 셀 것인가

VZ FY2018+, DIS 전체, DISo FY2007~2011은 **연결 총계가 XBRL에 무차원으로 존재하지 않는다.**
`README.md` §4의 denominator 규칙상 이들은 분모에 남고 missing으로 세야 한다. 다만
"차원에서 합산해 총계를 만든다"를 허용할지는 별도 결정이다. **나는 허용하지 말 것을 권한다** —
member whitelist가 필요해지고 `PROBE-me-source.md` §8.6의 이중계산 함정과 같은 문제가 생긴다.

---

## 11. 출처

### SEC API

```text
companyfacts   https://data.sec.gov/api/xbrl/companyfacts/CIK##########.json
submissions    https://data.sec.gov/submissions/CIK##########.json
               https://data.sec.gov/submissions/CIK##########-submissions-001.json
filing 원문     https://www.sec.gov/Archives/edgar/data/{cik}/{accession_nodash}/FilingSummary.xml
               https://www.sec.gov/Archives/edgar/data/{cik}/{accession_nodash}/R#.htm
```

### 주장별 accession

|주장|근거|
|---|---|
|Costco GP는 회계정책 주석|`0000909832-19-000019` `R32.htm`; 손익계산서는 `R4.htm`|
|Walmart `Revenues` = Total revenues, narrow = Net sales|`0000104169-26-000055` `R3.htm`|
|P&G `Revenues` = NET SALES (2026)|`0000080424-26-000103` `R3.htm`|
|P&G `Revenues` = "Net sales in the U.S." (2014)|`0000080424-14-000057` `R82.htm`|
|Exxon Mobil 원가가 custom tag|`0000034088-26-000045` `R3.htm`|
|Caterpillar `Revenues` = Total sales and revenues, COGS = `CostOfRevenue`|`0000018230-26-000008` `R3.htm`|
|Caterpillar `CostOfGoodsAndServicesSold` = 세그먼트 조정|`0000018230-26-000008` `R132.htm`|
|Verizon COGS가 차원 전용|`0000732712-26-000007` `R3.htm`|
|Disney COGS가 차원 전용|`0001744489-25-000155` `R3.htm`|
|Pfizer 총수익 vs 고객계약매출|`0000078003-26-000026` `R3.htm`; 기간별 fact는 `0000078003-24-000039` / `-25-000054` / `-26-000026`|
|Apple FY2009 재작성|`0001193125-09-214859` (acceptance `2009-10-27T20:18:29Z`) vs `0001193125-10-012091` (`2010-01-25T21:25:58Z`)|
|Amazon GP는 FY2009 10-K에만|`0001193125-10-016098`|
|Caterpillar GP가 전부 분기값|`0001104659-11-008938` · `0001104659-12-011331` · `0000018230-13-000075` 외|

### 내부 계약

```text
docs/trading/strategies/quality-value-roadmap.md   §3.1 §3.2 §4.1 §4.2 §4.4.1 §6 §6.2 §6.4
trading/runs/qv-data-audit/README.md               §3.1 §3.2 §3.5 §4
trading/runs/qv-data-audit/PROBE-me-source.md      §8.1 §8.2 §8.6
trading/backtest/qv_submissions.py                 historical_usable_session · ALLOWED_FORMS
trading/backtest/schema.sql                        qv_sec_filings
```

---

## 12. 이 정찰이 하지 않은 것

```text
수익률 · Sharpe · PF · MDD · factor 성과        0회
프로덕션 코드 · schema · 테스트 · 로드맵 수정    없음
DB 접근 · ingestion 실행                        없음
coverage 비율 판정 / Gate A~H 판정              하지 않음 (본구현 전수에서만)
Book Equity · preferred · deferred tax mapping  범위 밖
Total Assets 태그 mapping                       범위 밖
S&P 500 전수 / 금융업 · 소형주 · 비12월 결산 편중  검증 안 됨 (16개 발행사 표본)
```

**표본 16개 발행사는 systematic blocker를 찾기 위한 적대적 표본이지 대표 표본이 아니다.**
여기서 나오지 않은 형태가 전수에 없다고 말할 근거는 없다.
