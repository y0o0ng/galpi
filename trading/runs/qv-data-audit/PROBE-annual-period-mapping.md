# PROBE — annual duration context mapping

> 상태: **research evidence only**. 이 문서는 설계·freeze 문서가 아니며 production
> contract를 바꾸지 않는다. 조사 기준 commit은
> `effd02b4d029cabf1831fac2e7de4be8d13796cf`다.

## 1. 질문과 결론

질문은 하나였다.

> selected annual SEC accession에서 current fiscal year's annual duration context를
> arbitrary day cutoff 없이 deterministic하게 식별할 수 있는가?

**표본 안에서는 Candidate B의 structural longest-duration rule로 가능했다.** B가
구조적으로 resolve한 230건은 ground truth와 230/230 일치했고 wrong selection과 false
ambiguity가 없었다. 반면 현재 Candidate A(340~400)는 원본 10-K에서 240/241을 맞혔지만
ORCL FY2020의 unrelated note context 때문에 1건 false ambiguity였고, 별도 10-KT stress
3건은 모두 false missing이었다. 검토한 SEC 공식 자료에는 340/400이라는 annual semantic
boundary가 없었다.

따라서 마지막의 **User decision은 B — longest-duration structural rule 채택**을 추천한다.
다만 B는 만능 rescue가 아니다. 12건의 FilingSummary structured-metadata conflict와 2건의
standard revenue 부재를 추정하지 않고 missing으로 남겨 14/244가 fail-close했다.

## 2. 범위와 표본

- 최신 `origin/main`: `effd02b4d029cabf1831fac2e7de4be8d13796cf`.
- 고정 표본: heterogeneous operating issuer 30개 × 가능한 최근 원본 10-K 8건 = 240건.
- 필수 edge: TSLA FY2016 `0001564590-17-003118` 1건을 추가했다.
- fiscal-year-change stress: 실제 10-KT 3건을 **별도 stratum**으로 추가했다.
- 합계: main 30 issuer + transition issuer 3 = 33 issuer, 244 accession(원본 10-K 241, 10-KT 3).
- 기간: FY2016~FY2025 중 가능한 8개씩. 2026년에 제출된 FY2025 10-K도 포함한다.
- production return, rank, B/M, coverage/Gate 계산은 0건이다.

10-KT는 현재 production `ANNUAL_FORMS=(10-K, 10-K/A)` 적격으로 몰래 승격하지 않았다.
공식 FY/transition 신호와 cutoff의 의미를 stress하기 위한 별도 evidence다.

## 3. 공식 structured signals

SEC의 [EDGAR XBRL Guide (2026-06-29)](https://www.sec.gov/files/edgar/filer-information/specifications/xbrl-guide-2026-06-29.pdf)를 기준으로 확인했다.

| signal | 공식 의미와 이 조사에서의 판정 |
|---|---|
| `dei:DocumentPeriodEndDate` | reporting/transition period의 end이며 accession header의 period of report와 맞아야 한다(Guide §3.1.7). DPE canonical end로 쓸 수 있다. |
| `dei:DocumentFiscalYearFocus` | document가 focus하는 fiscal year label이다(§3.1.8). duration context start를 지시하지 않는다. |
| `dei:DocumentFiscalPeriodFocus=FY` | 10-K뿐 아니라 10-KT/other fiscal-year statement에도 FY다(§3.1.8). “annual document”와 “어느 context가 current annual column인가”는 다른 질문이다. |
| `dei:DocumentTransitionReport` | annual/quarterly/transition flags의 상호 배타적 집합 중 하나다(§3.1.23.1). transition임을 알리지만 일반 10-K start를 주지 않는다. |
| `dei:DocumentPeriodStartDate` | 공식 guide상 transition report에서 요구되는 start signal이다(§3.1.23.4). 표본 10-KT 3건의 filing-declared transition start와 일치했고, displayed current column을 raw fact로 역매칭할 수 있는 2건에서도 일치했다. |
| XBRL context | raw fact의 `contextRef`가 entity, start/end 또는 instant, dimensions를 연결한다. current annual context를 식별할 재료지만 DEI FY가 특정 contextRef를 직접 가리키지는 않는다. |
| FilingSummary report | role, `MenuCategory`, structured `LongName`, rendered `HtmlFileName`을 제공한다. statement/report boundary에 유용하나 2021-vintage 12건에서 `LongName=Statement`와 `MenuCategory=Uncategorized`가 충돌했다. |
| presentation role | standard revenue concept가 consolidated statement role에 있는지 note/disclosure와 분리한다. standalone `_pre.xml`과 최근 issuer XSD에 embedded된 presentation link 모두 실제로 존재했다. |
| `R*.htm` | displayed duration heading, period-end column, concept `defref`, value는 구조적으로 보였다. 그러나 표본 244건 모두 numeric cell에 raw `contextRef`가 없었다. |
| `R*.xml` | 표본 FilingSummary/index에서 `XmlFileName`/R XML은 0건이었다. exact context selector로 쓸 공통 artifact가 아니었다. |

Guide §6.8.1.1은 face statement의 line-item × period 조합이 instance fact/context로
존재해야 함을 설명한다. 반면 renderer의 duration heading은 §7.8에 따라 months로 반올림된
표시다. 따라서 `12 Months Ended`만 보고 정확한 start date를 역산하면 안 된다.

실제 source spot checks:

- recent inline: [AAPL FY2025 accession](https://www.sec.gov/Archives/edgar/data/320193/000032019325000079/)의 `FilingSummary.xml`, `R3.htm`, extracted instance.
- recent embedded presentation: [MSFT FY2024 issuer XSD](https://www.sec.gov/Archives/edgar/data/789019/000095017024087843/msft-20240630.xsd). 별도 `_pre.xml` 없이 XSD 안에 presentation links가 있다.
- old standalone: [HD FY2018 accession](https://www.sec.gov/Archives/edgar/data/354950/000035495019000010/)의 standalone instance/`_pre.xml` zip.
- false ambiguity: [ORCL FY2020 accession](https://www.sec.gov/Archives/edgar/data/1341439/000156459020030125/).
- no-standard-revenue: [XOM FY2018 `R2.htm`](https://www.sec.gov/Archives/edgar/data/34088/000003408819000010/R2.htm).
- transition: [CTGO 6개월](https://www.sec.gov/Archives/edgar/data/1502377/000095017024031469/), [Bristow 9개월](https://www.sec.gov/Archives/edgar/data/1525221/000152522123000010/), [Red Cat 8개월](https://www.sec.gov/Archives/edgar/data/748268/000164117225001892/).

## 4. Ground truth

Candidate A나 B의 결과를 ground truth로 재사용하지 않았다. accession마다 다음을 맞췄다.

1. FilingSummary/renderer가 보여 주는 audited consolidated operations/income statement와
   current displayed duration column을 찾았다.
2. displayed current value를 raw instance의 concept/value/scale, target CIK, dimensionless,
   USD, end=DPE 조건으로 exact match해 raw context start를 얻었다.
3. revenue가 standard taxonomy가 아닌 XOM FY2018은 같은 audited statement의 standard
   monetary line을 동일 방식으로 매칭했다.
4. 10-KT는 `DocumentPeriodStartDate`와 filing-declared transition period를 확인하고,
   displayed current value를 raw fact로 역매칭할 수 있는 2건은 다시 교차검증했다.
5. `R*.htm`의 footnote spacer/colspan과 3개월·12개월 동시 표시는 실제 column grid로
   해석했다. 첫 숫자 또는 label fuzzy matching은 쓰지 않았다.

이 방식은 renderer를 canonical accounting source로 바꾼 것이 아니다. raw context의
ground truth를 독립적으로 감사하기 위한 research-only evidence path다.

## 5. 후보 정의

### Candidate A — current 340~400

DPE에서 끝나는 target-CIK dimensionless context 중 duration 340~400일의 distinct start가
정확히 하나일 때만 선택했다. concept/role을 보지 않는 현재 production 순서를 그대로
측정했다.

### Candidate B — statement revenue longest-duration

고정한 절차는 prompt 그대로다.

1. FilingSummary가 Statement로 선언한 report role만 사용한다.
2. 그 role의 presentation에 standard revenue-family concept가 있어야 한다.
3. target CIK, dimensionless, USD, end=DPE인 revenue facts만 남긴다.
4. day cutoff 없이 duration이 가장 긴 start를 고른다.
5. longest start tie 또는 role ambiguity는 fail-close한다.

concept priority, highest-value rule, component sum, issuer whitelist는 없다. standalone
`_pre.xml`과 issuer XSD embedded presentation을 모두 raw structured source로 읽었다.
FilingSummary의 `MenuCategory`가 존재하면 현재 parser 계약처럼 그것을 우선했고, structured
`LongName=Statement`와 충돌하면 임의 override하지 않았다.

### Candidate C — rendered statement context

FilingSummary가 가리키는 `R*.htm`의 명시적 context identifier만을 찾았다. displayed value를
raw fact에 역매칭하는 ground-truth 절차를 Candidate C의 generic selector로 간주하지 않았다.
그것은 value/scale/colspan/footnote를 함께 해석해야 하는 별도 renderer parser이기 때문이다.

## 6. 결과 요약

### 6.1 정확도

| stratum | candidate | correct | false missing | false ambiguity | wrong |
|---|---:|---:|---:|---:|---:|
| 원본 10-K 241 | A | 240 | 0 | 1 | 0 |
| 원본 10-K 241 | B | 228 | 13 | 0 | 0 |
| 전체 244 | A | 240 | 3 | 1 | 0 |
| 전체 244 | B | 230 | 14 | 0 | 0 |
| 전체 244 | C explicit context | 0 | 244 | 0 | 0 |

B의 `correct=230`은 **resolved 230건의 230/230 일치**다. B missing 14건은:

- 12건: FilingSummary income report의 structured `LongName`은 Statement지만
  `MenuCategory=Uncategorized`인 conflict(PFE/CAT/VZ/WMT/TGT/NEE/KO/PEP/BA/INTC/MCD/LOW,
  모두 2021 fiscal-year accession). strict fail-close했다.
- XOM FY2018 1건: audited statement의 revenue lines가 issuer extension이고 standard
  revenue-family candidate가 없다.
- CTGO transition 1건: pre-revenue filing으로 standard revenue candidate가 없다.

### 6.2 ground-truth duration distribution

`days = (context.end - context.start).days`로 production과 같은 계산을 썼다. XBRL period의
inclusive 영업연도 일수와 1일 차이가 날 수 있으므로 52주 retail context가 주로 363으로
보이는 것이 정상이다. percentile은 nearest-rank diagnostic이며 새 cutoff 최적화에 쓰지 않았다.

| stratum | n | min | p1 | p5 | median | p95 | p99 | max |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 원본 10-K | 241 | 363 | 363 | 363 | 364 | 370 | 370 | 370 |
| 10-K + 10-KT | 244 | 183 | 274 | 363 | 364 | 370 | 370 | 370 |

전체 exact counts: 183일 1, 244일 1, 274일 1, 363일 75, 364일 114,
365일 39, 370일 13.

이 표본의 원본 10-K에는 340일 미만 또는 400일 초과가 없었다. 별도 10-KT 3건은 모두
340일 미만이었다. 400일 초과는 없었다. 362일 ground truth도 없었으며, 이 부재를 새
threshold 근거로 확대 해석하지 않는다.

## 7. Failure-mode findings

1. **CAT quarterly facts** — CAT FY2018~FY2020 accessions의 `GrossProfit`은 89~91일
   quarterly facts만 존재했다. B는 GrossProfit을 period selector에 쓰지 않고 Statement role의
   annual revenue(364/365일)를 골라 8/8 정답이었다. 최근 CAT에는 같은 `Revenues` concept가
   statement와 여러 segment/note roles에 함께 있었지만 Statement boundary가 note를 제외했다.
2. **52-week** — AAPL/COST/HD/TGT/SBUX/ADBE 등에서 363일 context를 정확히 선택했다.
3. **53-week** — 370일 context 13건(COST, HD, TGT, SBUX, JNJ, PEP, INTC, LOW, ADBE,
   CSCO 등)을 A/B 모두 정확히 선택했다.
4. **unusual/fiscal-year change** — 10-KT ground truth는 CTGO 183일, Red Cat 244일,
   Bristow 274일이었다. A는 3/3 missing, B는 revenue가 있는 2/3을 정확히 선택했다.
5. **362일** — 고정 표본에는 없었다. 비슷한 길이를 가정으로 합성하지 않았다.
6. **same DPE long-context pollution** — ORCL FY2020에는 canonical 2019-06-01 start(365일)
   외에 `RightOfUseAssetObtainedInExchangeForOperatingLeaseLiability` note fact의
   2019-06-02 start(364일)가 같은 DPE에 공존했다. A는 false ambiguity, B는 statement revenue로
   2019-06-01을 정확히 선택했다.
7. **note revenue contamination** — P&G FY2025의 standard `Revenues`는 consolidated
   earnings statement와 segment detail roles에 함께 있었다. B는 Statement role만 사용해
   2024-07-01을 골랐다. CAT도 동일하게 note/detail roles가 제외됐다.
8. **no standard revenue** — XOM FY2018과 CTGO transition에서 B는 값을 추정하거나 extension
   이름을 whitelist하지 않고 missing으로 닫았다.
9. **annual + quarterly displayed columns** — BA FY2018과 COST FY2018 renderer는 shorter
   duration과 annual columns를 한 표에 함께 보였다. longest는 annual raw context와 일치했다.
10. **old/recent XBRL packaging** — old standalone `_pre.xml`, recent XSD-embedded presentation,
    index가 zip만 노출하지만 direct extracted instance가 존재하는 accession을 모두 확인했다.
    B 자체는 old/recent 양쪽에서 성립하지만 production parser가 두 packaging을 모두 지원하는지는
    별도 implementation concern이다.

## 8. Accession-level results

표기: `A/B status`는 `OK`, `MISS`, `AMB`, `WRONG`; `C`는
`structured-context available / selected / correct`다. `FS_CATEGORY_CONFLICT`는 앞서 설명한
FilingSummary conflict, `A_RANGE`는 10-KT actual duration이 340~400 밖, `NO_STD_REVENUE`는
standard revenue candidate 부재다.

| accession | issuer | form | DPE | FPF | transition | ground truth start | days | A start | A status | A correct | B start | B status | B correct | C avail/start/correct | failure reason |
|---|---|---|---|---|---|---|---:|---|---|---|---|---|---|---|---|
| [0000320193-25-000079](https://www.sec.gov/Archives/edgar/data/320193/000032019325000079/) | AAPL | 10-K | 2025-09-27 | FY | false | 2024-09-29 | 363 | 2024-09-29 | OK | Y | 2024-09-29 | OK | Y | N/—/— | — |
| [0000320193-24-000123](https://www.sec.gov/Archives/edgar/data/320193/000032019324000123/) | AAPL | 10-K | 2024-09-28 | FY | false | 2023-10-01 | 363 | 2023-10-01 | OK | Y | 2023-10-01 | OK | Y | N/—/— | — |
| [0000320193-23-000106](https://www.sec.gov/Archives/edgar/data/320193/000032019323000106/) | AAPL | 10-K | 2023-09-30 | FY | false | 2022-09-25 | 370 | 2022-09-25 | OK | Y | 2022-09-25 | OK | Y | N/—/— | — |
| [0000320193-22-000108](https://www.sec.gov/Archives/edgar/data/320193/000032019322000108/) | AAPL | 10-K | 2022-09-24 | FY | false | 2021-09-26 | 363 | 2021-09-26 | OK | Y | 2021-09-26 | OK | Y | N/—/— | — |
| [0000320193-21-000105](https://www.sec.gov/Archives/edgar/data/320193/000032019321000105/) | AAPL | 10-K | 2021-09-25 | FY | false | 2020-09-27 | 363 | 2020-09-27 | OK | Y | 2020-09-27 | OK | Y | N/—/— | — |
| [0000320193-20-000096](https://www.sec.gov/Archives/edgar/data/320193/000032019320000096/) | AAPL | 10-K | 2020-09-26 | FY | false | 2019-09-29 | 363 | 2019-09-29 | OK | Y | 2019-09-29 | OK | Y | N/—/— | — |
| [0000320193-19-000119](https://www.sec.gov/Archives/edgar/data/320193/000032019319000119/) | AAPL | 10-K | 2019-09-28 | FY | false | 2018-09-30 | 363 | 2018-09-30 | OK | Y | 2018-09-30 | OK | Y | N/—/— | — |
| [0000320193-18-000145](https://www.sec.gov/Archives/edgar/data/320193/000032019318000145/) | AAPL | 10-K | 2018-09-29 | FY | — | 2017-10-01 | 363 | 2017-10-01 | OK | Y | 2017-10-01 | OK | Y | N/—/— | — |
| [0000950170-25-100235](https://www.sec.gov/Archives/edgar/data/789019/000095017025100235/) | MSFT | 10-K | 2025-06-30 | FY | false | 2024-07-01 | 364 | 2024-07-01 | OK | Y | 2024-07-01 | OK | Y | N/—/— | — |
| [0000950170-24-087843](https://www.sec.gov/Archives/edgar/data/789019/000095017024087843/) | MSFT | 10-K | 2024-06-30 | FY | false | 2023-07-01 | 365 | 2023-07-01 | OK | Y | 2023-07-01 | OK | Y | N/—/— | — |
| [0000950170-23-035122](https://www.sec.gov/Archives/edgar/data/789019/000095017023035122/) | MSFT | 10-K | 2023-06-30 | FY | false | 2022-07-01 | 364 | 2022-07-01 | OK | Y | 2022-07-01 | OK | Y | N/—/— | — |
| [0001564590-22-026876](https://www.sec.gov/Archives/edgar/data/789019/000156459022026876/) | MSFT | 10-K | 2022-06-30 | FY | false | 2021-07-01 | 364 | 2021-07-01 | OK | Y | 2021-07-01 | OK | Y | N/—/— | — |
| [0001564590-21-039151](https://www.sec.gov/Archives/edgar/data/789019/000156459021039151/) | MSFT | 10-K | 2021-06-30 | FY | false | 2020-07-01 | 364 | 2020-07-01 | OK | Y | 2020-07-01 | OK | Y | N/—/— | — |
| [0001564590-20-034944](https://www.sec.gov/Archives/edgar/data/789019/000156459020034944/) | MSFT | 10-K | 2020-06-30 | FY | false | 2019-07-01 | 365 | 2019-07-01 | OK | Y | 2019-07-01 | OK | Y | N/—/— | — |
| [0001564590-19-027952](https://www.sec.gov/Archives/edgar/data/789019/000156459019027952/) | MSFT | 10-K | 2019-06-30 | FY | — | 2018-07-01 | 364 | 2018-07-01 | OK | Y | 2018-07-01 | OK | Y | N/—/— | — |
| [0001564590-18-019062](https://www.sec.gov/Archives/edgar/data/789019/000156459018019062/) | MSFT | 10-K | 2018-06-30 | FY | — | 2017-07-01 | 364 | 2017-07-01 | OK | Y | 2017-07-01 | OK | Y | N/—/— | — |
| [0000078003-26-000026](https://www.sec.gov/Archives/edgar/data/78003/000007800326000026/) | PFE | 10-K | 2025-12-31 | FY | false | 2025-01-01 | 364 | 2025-01-01 | OK | Y | 2025-01-01 | OK | Y | N/—/— | — |
| [0000078003-25-000054](https://www.sec.gov/Archives/edgar/data/78003/000007800325000054/) | PFE | 10-K | 2024-12-31 | FY | false | 2024-01-01 | 365 | 2024-01-01 | OK | Y | 2024-01-01 | OK | Y | N/—/— | — |
| [0000078003-24-000039](https://www.sec.gov/Archives/edgar/data/78003/000007800324000039/) | PFE | 10-K | 2023-12-31 | FY | false | 2023-01-01 | 364 | 2023-01-01 | OK | Y | 2023-01-01 | OK | Y | N/—/— | — |
| [0000078003-23-000024](https://www.sec.gov/Archives/edgar/data/78003/000007800323000024/) | PFE | 10-K | 2022-12-31 | FY | false | 2022-01-01 | 364 | 2022-01-01 | OK | Y | 2022-01-01 | OK | Y | N/—/— | — |
| [0000078003-22-000027](https://www.sec.gov/Archives/edgar/data/78003/000007800322000027/) | PFE | 10-K | 2021-12-31 | FY | false | 2021-01-01 | 364 | 2021-01-01 | OK | Y | — | MISS | N | N/—/— | FS_CATEGORY_CONFLICT |
| [0000078003-21-000038](https://www.sec.gov/Archives/edgar/data/78003/000007800321000038/) | PFE | 10-K | 2020-12-31 | FY | false | 2020-01-01 | 365 | 2020-01-01 | OK | Y | 2020-01-01 | OK | Y | N/—/— | — |
| [0000078003-20-000014](https://www.sec.gov/Archives/edgar/data/78003/000007800320000014/) | PFE | 10-K | 2019-12-31 | FY | false | 2019-01-01 | 364 | 2019-01-01 | OK | Y | 2019-01-01 | OK | Y | N/—/— | — |
| [0000078003-19-000015](https://www.sec.gov/Archives/edgar/data/78003/000007800319000015/) | PFE | 10-K | 2018-12-31 | FY | — | 2018-01-01 | 364 | 2018-01-01 | OK | Y | 2018-01-01 | OK | Y | N/—/— | — |
| [0000018230-26-000008](https://www.sec.gov/Archives/edgar/data/18230/000001823026000008/) | CAT | 10-K | 2025-12-31 | FY | false | 2025-01-01 | 364 | 2025-01-01 | OK | Y | 2025-01-01 | OK | Y | N/—/— | — |
| [0000018230-25-000008](https://www.sec.gov/Archives/edgar/data/18230/000001823025000008/) | CAT | 10-K | 2024-12-31 | FY | false | 2024-01-01 | 365 | 2024-01-01 | OK | Y | 2024-01-01 | OK | Y | N/—/— | — |
| [0000018230-24-000009](https://www.sec.gov/Archives/edgar/data/18230/000001823024000009/) | CAT | 10-K | 2023-12-31 | FY | false | 2023-01-01 | 364 | 2023-01-01 | OK | Y | 2023-01-01 | OK | Y | N/—/— | — |
| [0000018230-23-000011](https://www.sec.gov/Archives/edgar/data/18230/000001823023000011/) | CAT | 10-K | 2022-12-31 | FY | false | 2022-01-01 | 364 | 2022-01-01 | OK | Y | 2022-01-01 | OK | Y | N/—/— | — |
| [0000018230-22-000050](https://www.sec.gov/Archives/edgar/data/18230/000001823022000050/) | CAT | 10-K | 2021-12-31 | FY | false | 2021-01-01 | 364 | 2021-01-01 | OK | Y | — | MISS | N | N/—/— | FS_CATEGORY_CONFLICT |
| [0000018230-21-000063](https://www.sec.gov/Archives/edgar/data/18230/000001823021000063/) | CAT | 10-K | 2020-12-31 | FY | false | 2020-01-01 | 365 | 2020-01-01 | OK | Y | 2020-01-01 | OK | Y | N/—/— | — |
| [0000018230-20-000056](https://www.sec.gov/Archives/edgar/data/18230/000001823020000056/) | CAT | 10-K | 2019-12-31 | FY | false | 2019-01-01 | 364 | 2019-01-01 | OK | Y | 2019-01-01 | OK | Y | N/—/— | — |
| [0000018230-19-000034](https://www.sec.gov/Archives/edgar/data/18230/000001823019000034/) | CAT | 10-K | 2018-12-31 | FY | — | 2018-01-01 | 364 | 2018-01-01 | OK | Y | 2018-01-01 | OK | Y | N/—/— | — |
| [0000034088-26-000045](https://www.sec.gov/Archives/edgar/data/34088/000003408826000045/) | XOM | 10-K | 2025-12-31 | FY | false | 2025-01-01 | 364 | 2025-01-01 | OK | Y | 2025-01-01 | OK | Y | N/—/— | — |
| [0000034088-25-000010](https://www.sec.gov/Archives/edgar/data/34088/000003408825000010/) | XOM | 10-K | 2024-12-31 | FY | false | 2024-01-01 | 365 | 2024-01-01 | OK | Y | 2024-01-01 | OK | Y | N/—/— | — |
| [0000034088-24-000018](https://www.sec.gov/Archives/edgar/data/34088/000003408824000018/) | XOM | 10-K | 2023-12-31 | FY | false | 2023-01-01 | 364 | 2023-01-01 | OK | Y | 2023-01-01 | OK | Y | N/—/— | — |
| [0000034088-23-000020](https://www.sec.gov/Archives/edgar/data/34088/000003408823000020/) | XOM | 10-K | 2022-12-31 | FY | false | 2022-01-01 | 364 | 2022-01-01 | OK | Y | 2022-01-01 | OK | Y | N/—/— | — |
| [0000034088-22-000011](https://www.sec.gov/Archives/edgar/data/34088/000003408822000011/) | XOM | 10-K | 2021-12-31 | FY | false | 2021-01-01 | 364 | 2021-01-01 | OK | Y | 2021-01-01 | OK | Y | N/—/— | — |
| [0000034088-21-000012](https://www.sec.gov/Archives/edgar/data/34088/000003408821000012/) | XOM | 10-K | 2020-12-31 | FY | false | 2020-01-01 | 365 | 2020-01-01 | OK | Y | 2020-01-01 | OK | Y | N/—/— | — |
| [0000034088-20-000016](https://www.sec.gov/Archives/edgar/data/34088/000003408820000016/) | XOM | 10-K | 2019-12-31 | FY | false | 2019-01-01 | 364 | 2019-01-01 | OK | Y | 2019-01-01 | OK | Y | N/—/— | — |
| [0000034088-19-000010](https://www.sec.gov/Archives/edgar/data/34088/000003408819000010/) | XOM | 10-K | 2018-12-31 | FY | — | 2018-01-01 | 364 | 2018-01-01 | OK | Y | — | MISS | N | N/—/— | NO_STD_REVENUE |
| [0000732712-26-000007](https://www.sec.gov/Archives/edgar/data/732712/000073271226000007/) | VZ | 10-K | 2025-12-31 | FY | false | 2025-01-01 | 364 | 2025-01-01 | OK | Y | 2025-01-01 | OK | Y | N/—/— | — |
| [0000732712-25-000006](https://www.sec.gov/Archives/edgar/data/732712/000073271225000006/) | VZ | 10-K | 2024-12-31 | FY | false | 2024-01-01 | 365 | 2024-01-01 | OK | Y | 2024-01-01 | OK | Y | N/—/— | — |
| [0000732712-24-000010](https://www.sec.gov/Archives/edgar/data/732712/000073271224000010/) | VZ | 10-K | 2023-12-31 | FY | false | 2023-01-01 | 364 | 2023-01-01 | OK | Y | 2023-01-01 | OK | Y | N/—/— | — |
| [0000732712-23-000012](https://www.sec.gov/Archives/edgar/data/732712/000073271223000012/) | VZ | 10-K | 2022-12-31 | FY | false | 2022-01-01 | 364 | 2022-01-01 | OK | Y | 2022-01-01 | OK | Y | N/—/— | — |
| [0000732712-22-000008](https://www.sec.gov/Archives/edgar/data/732712/000073271222000008/) | VZ | 10-K | 2021-12-31 | FY | false | 2021-01-01 | 364 | 2021-01-01 | OK | Y | — | MISS | N | N/—/— | FS_CATEGORY_CONFLICT |
| [0000732712-21-000012](https://www.sec.gov/Archives/edgar/data/732712/000073271221000012/) | VZ | 10-K | 2020-12-31 | FY | false | 2020-01-01 | 365 | 2020-01-01 | OK | Y | 2020-01-01 | OK | Y | N/—/— | — |
| [0000732712-20-000014](https://www.sec.gov/Archives/edgar/data/732712/000073271220000014/) | VZ | 10-K | 2019-12-31 | FY | false | 2019-01-01 | 364 | 2019-01-01 | OK | Y | 2019-01-01 | OK | Y | N/—/— | — |
| [0000732712-19-000012](https://www.sec.gov/Archives/edgar/data/732712/000073271219000012/) | VZ | 10-K | 2018-12-31 | FY | — | 2018-01-01 | 364 | 2018-01-01 | OK | Y | 2018-01-01 | OK | Y | N/—/— | — |
| [0000909832-25-000101](https://www.sec.gov/Archives/edgar/data/909832/000090983225000101/) | COST | 10-K | 2025-08-31 | FY | false | 2024-09-02 | 363 | 2024-09-02 | OK | Y | 2024-09-02 | OK | Y | N/—/— | — |
| [0000909832-24-000049](https://www.sec.gov/Archives/edgar/data/909832/000090983224000049/) | COST | 10-K | 2024-09-01 | FY | false | 2023-09-04 | 363 | 2023-09-04 | OK | Y | 2023-09-04 | OK | Y | N/—/— | — |
| [0000909832-23-000042](https://www.sec.gov/Archives/edgar/data/909832/000090983223000042/) | COST | 10-K | 2023-09-03 | FY | false | 2022-08-29 | 370 | 2022-08-29 | OK | Y | 2022-08-29 | OK | Y | N/—/— | — |
| [0000909832-22-000021](https://www.sec.gov/Archives/edgar/data/909832/000090983222000021/) | COST | 10-K | 2022-08-28 | FY | false | 2021-08-30 | 363 | 2021-08-30 | OK | Y | 2021-08-30 | OK | Y | N/—/— | — |
| [0000909832-21-000014](https://www.sec.gov/Archives/edgar/data/909832/000090983221000014/) | COST | 10-K | 2021-08-29 | FY | false | 2020-08-31 | 363 | 2020-08-31 | OK | Y | 2020-08-31 | OK | Y | N/—/— | — |
| [0000909832-20-000017](https://www.sec.gov/Archives/edgar/data/909832/000090983220000017/) | COST | 10-K | 2020-08-30 | FY | false | 2019-09-02 | 363 | 2019-09-02 | OK | Y | 2019-09-02 | OK | Y | N/—/— | — |
| [0000909832-19-000019](https://www.sec.gov/Archives/edgar/data/909832/000090983219000019/) | COST | 10-K | 2019-09-01 | Q4 | — | 2018-09-03 | 363 | 2018-09-03 | OK | Y | 2018-09-03 | OK | Y | N/—/— | — |
| [0000909832-18-000013](https://www.sec.gov/Archives/edgar/data/909832/000090983218000013/) | COST | 10-K | 2018-09-02 | FY | — | 2017-09-04 | 363 | 2017-09-04 | OK | Y | 2017-09-04 | OK | Y | N/—/— | — |
| [0000104169-25-000021](https://www.sec.gov/Archives/edgar/data/104169/000010416925000021/) | WMT | 10-K | 2025-01-31 | FY | false | 2024-02-01 | 365 | 2024-02-01 | OK | Y | 2024-02-01 | OK | Y | N/—/— | — |
| [0000104169-24-000056](https://www.sec.gov/Archives/edgar/data/104169/000010416924000056/) | WMT | 10-K | 2024-01-31 | FY | false | 2023-02-01 | 364 | 2023-02-01 | OK | Y | 2023-02-01 | OK | Y | N/—/— | — |
| [0000104169-23-000020](https://www.sec.gov/Archives/edgar/data/104169/000010416923000020/) | WMT | 10-K | 2023-01-31 | FY | false | 2022-02-01 | 364 | 2022-02-01 | OK | Y | 2022-02-01 | OK | Y | N/—/— | — |
| [0000104169-22-000012](https://www.sec.gov/Archives/edgar/data/104169/000010416922000012/) | WMT | 10-K | 2022-01-31 | FY | false | 2021-02-01 | 364 | 2021-02-01 | OK | Y | — | MISS | N | N/—/— | FS_CATEGORY_CONFLICT |
| [0000104169-21-000033](https://www.sec.gov/Archives/edgar/data/104169/000010416921000033/) | WMT | 10-K | 2021-01-31 | FY | false | 2020-02-01 | 365 | 2020-02-01 | OK | Y | 2020-02-01 | OK | Y | N/—/— | — |
| [0000104169-20-000011](https://www.sec.gov/Archives/edgar/data/104169/000010416920000011/) | WMT | 10-K | 2020-01-31 | FY | false | 2019-02-01 | 364 | 2019-02-01 | OK | Y | 2019-02-01 | OK | Y | N/—/— | — |
| [0000104169-19-000016](https://www.sec.gov/Archives/edgar/data/104169/000010416919000016/) | WMT | 10-K | 2019-01-31 | FY | — | 2018-02-01 | 364 | 2018-02-01 | OK | Y | 2018-02-01 | OK | Y | N/—/— | — |
| [0000104169-18-000028](https://www.sec.gov/Archives/edgar/data/104169/000010416918000028/) | WMT | 10-K | 2018-01-31 | FY | — | 2017-02-01 | 364 | 2017-02-01 | OK | Y | 2017-02-01 | OK | Y | N/—/— | — |
| [0000354950-25-000085](https://www.sec.gov/Archives/edgar/data/354950/000035495025000085/) | HD | 10-K | 2025-02-02 | FY | false | 2024-01-29 | 370 | 2024-01-29 | OK | Y | 2024-01-29 | OK | Y | N/—/— | — |
| [0000354950-24-000062](https://www.sec.gov/Archives/edgar/data/354950/000035495024000062/) | HD | 10-K | 2024-01-28 | FY | false | 2023-01-30 | 363 | 2023-01-30 | OK | Y | 2023-01-30 | OK | Y | N/—/— | — |
| [0000354950-23-000059](https://www.sec.gov/Archives/edgar/data/354950/000035495023000059/) | HD | 10-K | 2023-01-29 | FY | false | 2022-01-31 | 363 | 2022-01-31 | OK | Y | 2022-01-31 | OK | Y | N/—/— | — |
| [0000354950-22-000070](https://www.sec.gov/Archives/edgar/data/354950/000035495022000070/) | HD | 10-K | 2022-01-30 | FY | false | 2021-02-01 | 363 | 2021-02-01 | OK | Y | 2021-02-01 | OK | Y | N/—/— | — |
| [0000354950-21-000089](https://www.sec.gov/Archives/edgar/data/354950/000035495021000089/) | HD | 10-K | 2021-01-31 | FY | false | 2020-02-03 | 363 | 2020-02-03 | OK | Y | 2020-02-03 | OK | Y | N/—/— | — |
| [0000354950-20-000015](https://www.sec.gov/Archives/edgar/data/354950/000035495020000015/) | HD | 10-K | 2020-02-02 | FY | false | 2019-02-04 | 363 | 2019-02-04 | OK | Y | 2019-02-04 | OK | Y | N/—/— | — |
| [0000354950-19-000010](https://www.sec.gov/Archives/edgar/data/354950/000035495019000010/) | HD | 10-K | 2019-02-03 | FY | — | 2018-01-29 | 370 | 2018-01-29 | OK | Y | 2018-01-29 | OK | Y | N/—/— | — |
| [0000354950-18-000019](https://www.sec.gov/Archives/edgar/data/354950/000035495018000019/) | HD | 10-K | 2018-01-28 | FY | — | 2017-01-30 | 363 | 2017-01-30 | OK | Y | 2017-01-30 | OK | Y | N/—/— | — |
| [0000080424-25-000076](https://www.sec.gov/Archives/edgar/data/80424/000008042425000076/) | PG | 10-K | 2025-06-30 | FY | false | 2024-07-01 | 364 | 2024-07-01 | OK | Y | 2024-07-01 | OK | Y | N/—/— | — |
| [0000080424-24-000083](https://www.sec.gov/Archives/edgar/data/80424/000008042424000083/) | PG | 10-K | 2024-06-30 | FY | false | 2023-07-01 | 365 | 2023-07-01 | OK | Y | 2023-07-01 | OK | Y | N/—/— | — |
| [0000080424-23-000073](https://www.sec.gov/Archives/edgar/data/80424/000008042423000073/) | PG | 10-K | 2023-06-30 | FY | false | 2022-07-01 | 364 | 2022-07-01 | OK | Y | 2022-07-01 | OK | Y | N/—/— | — |
| [0000080424-22-000064](https://www.sec.gov/Archives/edgar/data/80424/000008042422000064/) | PG | 10-K | 2022-06-30 | FY | false | 2021-07-01 | 364 | 2021-07-01 | OK | Y | 2021-07-01 | OK | Y | N/—/— | — |
| [0000080424-21-000100](https://www.sec.gov/Archives/edgar/data/80424/000008042421000100/) | PG | 10-K | 2021-06-30 | FY | false | 2020-07-01 | 364 | 2020-07-01 | OK | Y | 2020-07-01 | OK | Y | N/—/— | — |
| [0000080424-20-000053](https://www.sec.gov/Archives/edgar/data/80424/000008042420000053/) | PG | 10-K | 2020-06-30 | FY | false | 2019-07-01 | 365 | 2019-07-01 | OK | Y | 2019-07-01 | OK | Y | N/—/— | — |
| [0000080424-19-000050](https://www.sec.gov/Archives/edgar/data/80424/000008042419000050/) | PG | 10-K | 2019-06-30 | FY | — | 2018-07-01 | 364 | 2018-07-01 | OK | Y | 2018-07-01 | OK | Y | N/—/— | — |
| [0000080424-18-000055](https://www.sec.gov/Archives/edgar/data/80424/000008042418000055/) | PG | 10-K | 2018-06-30 | FY | — | 2017-07-01 | 364 | 2017-07-01 | OK | Y | 2017-07-01 | OK | Y | N/—/— | — |
| [0000027419-25-000018](https://www.sec.gov/Archives/edgar/data/27419/000002741925000018/) | TGT | 10-K | 2025-02-01 | FY | false | 2024-02-04 | 363 | 2024-02-04 | OK | Y | 2024-02-04 | OK | Y | N/—/— | — |
| [0000027419-24-000032](https://www.sec.gov/Archives/edgar/data/27419/000002741924000032/) | TGT | 10-K | 2024-02-03 | FY | false | 2023-01-29 | 370 | 2023-01-29 | OK | Y | 2023-01-29 | OK | Y | N/—/— | — |
| [0000027419-23-000015](https://www.sec.gov/Archives/edgar/data/27419/000002741923000015/) | TGT | 10-K | 2023-01-28 | FY | false | 2022-01-30 | 363 | 2022-01-30 | OK | Y | 2022-01-30 | OK | Y | N/—/— | — |
| [0000027419-22-000007](https://www.sec.gov/Archives/edgar/data/27419/000002741922000007/) | TGT | 10-K | 2022-01-29 | FY | false | 2021-01-31 | 363 | 2021-01-31 | OK | Y | — | MISS | N | N/—/— | FS_CATEGORY_CONFLICT |
| [0000027419-21-000010](https://www.sec.gov/Archives/edgar/data/27419/000002741921000010/) | TGT | 10-K | 2021-01-30 | FY | false | 2020-02-02 | 363 | 2020-02-02 | OK | Y | 2020-02-02 | OK | Y | N/—/— | — |
| [0000027419-20-000008](https://www.sec.gov/Archives/edgar/data/27419/000002741920000008/) | TGT | 10-K | 2020-02-01 | FY | false | 2019-02-03 | 363 | 2019-02-03 | OK | Y | 2019-02-03 | OK | Y | N/—/— | — |
| [0000027419-19-000006](https://www.sec.gov/Archives/edgar/data/27419/000002741919000006/) | TGT | 10-K | 2019-02-02 | FY | — | 2018-02-04 | 363 | 2018-02-04 | OK | Y | 2018-02-04 | OK | Y | N/—/— | — |
| [0000027419-18-000010](https://www.sec.gov/Archives/edgar/data/27419/000002741918000010/) | TGT | 10-K | 2018-02-03 | FY | — | 2017-01-29 | 370 | 2017-01-29 | OK | Y | 2017-01-29 | OK | Y | N/—/— | — |
| [0000829224-25-000114](https://www.sec.gov/Archives/edgar/data/829224/000082922425000114/) | SBUX | 10-K | 2025-09-28 | FY | false | 2024-09-30 | 363 | 2024-09-30 | OK | Y | 2024-09-30 | OK | Y | N/—/— | — |
| [0000829224-24-000057](https://www.sec.gov/Archives/edgar/data/829224/000082922424000057/) | SBUX | 10-K | 2024-09-29 | FY | false | 2023-10-02 | 363 | 2023-10-02 | OK | Y | 2023-10-02 | OK | Y | N/—/— | — |
| [0000829224-23-000058](https://www.sec.gov/Archives/edgar/data/829224/000082922423000058/) | SBUX | 10-K | 2023-10-01 | FY | false | 2022-10-03 | 363 | 2022-10-03 | OK | Y | 2022-10-03 | OK | Y | N/—/— | — |
| [0000829224-22-000058](https://www.sec.gov/Archives/edgar/data/829224/000082922422000058/) | SBUX | 10-K | 2022-10-02 | FY | false | 2021-10-04 | 363 | 2021-10-04 | OK | Y | 2021-10-04 | OK | Y | N/—/— | — |
| [0000829224-21-000086](https://www.sec.gov/Archives/edgar/data/829224/000082922421000086/) | SBUX | 10-K | 2021-10-03 | FY | false | 2020-09-28 | 370 | 2020-09-28 | OK | Y | 2020-09-28 | OK | Y | N/—/— | — |
| [0000829224-20-000078](https://www.sec.gov/Archives/edgar/data/829224/000082922420000078/) | SBUX | 10-K | 2020-09-27 | FY | false | 2019-09-30 | 363 | 2019-09-30 | OK | Y | 2019-09-30 | OK | Y | N/—/— | — |
| [0000829224-19-000051](https://www.sec.gov/Archives/edgar/data/829224/000082922419000051/) | SBUX | 10-K | 2019-09-29 | FY | false | 2018-10-01 | 363 | 2018-10-01 | OK | Y | 2018-10-01 | OK | Y | N/—/— | — |
| [0000829224-18-000052](https://www.sec.gov/Archives/edgar/data/829224/000082922418000052/) | SBUX | 10-K | 2018-09-30 | FY | — | 2017-10-02 | 363 | 2017-10-02 | OK | Y | 2017-10-02 | OK | Y | N/—/— | — |
| [0000320187-25-000047](https://www.sec.gov/Archives/edgar/data/320187/000032018725000047/) | NKE | 10-K | 2025-05-31 | FY | false | 2024-06-01 | 364 | 2024-06-01 | OK | Y | 2024-06-01 | OK | Y | N/—/— | — |
| [0000320187-24-000044](https://www.sec.gov/Archives/edgar/data/320187/000032018724000044/) | NKE | 10-K | 2024-05-31 | FY | false | 2023-06-01 | 365 | 2023-06-01 | OK | Y | 2023-06-01 | OK | Y | N/—/— | — |
| [0000320187-23-000039](https://www.sec.gov/Archives/edgar/data/320187/000032018723000039/) | NKE | 10-K | 2023-05-31 | FY | false | 2022-06-01 | 364 | 2022-06-01 | OK | Y | 2022-06-01 | OK | Y | N/—/— | — |
| [0000320187-22-000038](https://www.sec.gov/Archives/edgar/data/320187/000032018722000038/) | NKE | 10-K | 2022-05-31 | FY | false | 2021-06-01 | 364 | 2021-06-01 | OK | Y | 2021-06-01 | OK | Y | N/—/— | — |
| [0000320187-21-000028](https://www.sec.gov/Archives/edgar/data/320187/000032018721000028/) | NKE | 10-K | 2021-05-31 | FY | false | 2020-06-01 | 364 | 2020-06-01 | OK | Y | 2020-06-01 | OK | Y | N/—/— | — |
| [0000320187-20-000047](https://www.sec.gov/Archives/edgar/data/320187/000032018720000047/) | NKE | 10-K | 2020-05-31 | FY | false | 2019-06-01 | 365 | 2019-06-01 | OK | Y | 2019-06-01 | OK | Y | N/—/— | — |
| [0000320187-19-000051](https://www.sec.gov/Archives/edgar/data/320187/000032018719000051/) | NKE | 10-K | 2019-05-31 | FY | — | 2018-06-01 | 364 | 2018-06-01 | OK | Y | 2018-06-01 | OK | Y | N/—/— | — |
| [0000320187-18-000142](https://www.sec.gov/Archives/edgar/data/320187/000032018718000142/) | NKE | 10-K | 2018-05-31 | FY | — | 2017-06-01 | 364 | 2017-06-01 | OK | Y | 2017-06-01 | OK | Y | N/—/— | — |
| [0001628280-26-003952](https://www.sec.gov/Archives/edgar/data/1318605/000162828026003952/) | TSLA | 10-K | 2025-12-31 | FY | false | 2025-01-01 | 364 | 2025-01-01 | OK | Y | 2025-01-01 | OK | Y | N/—/— | — |
| [0001628280-25-003063](https://www.sec.gov/Archives/edgar/data/1318605/000162828025003063/) | TSLA | 10-K | 2024-12-31 | FY | false | 2024-01-01 | 365 | 2024-01-01 | OK | Y | 2024-01-01 | OK | Y | N/—/— | — |
| [0001628280-24-002390](https://www.sec.gov/Archives/edgar/data/1318605/000162828024002390/) | TSLA | 10-K | 2023-12-31 | FY | false | 2023-01-01 | 364 | 2023-01-01 | OK | Y | 2023-01-01 | OK | Y | N/—/— | — |
| [0000950170-23-001409](https://www.sec.gov/Archives/edgar/data/1318605/000095017023001409/) | TSLA | 10-K | 2022-12-31 | FY | false | 2022-01-01 | 364 | 2022-01-01 | OK | Y | 2022-01-01 | OK | Y | N/—/— | — |
| [0000950170-22-000796](https://www.sec.gov/Archives/edgar/data/1318605/000095017022000796/) | TSLA | 10-K | 2021-12-31 | FY | false | 2021-01-01 | 364 | 2021-01-01 | OK | Y | 2021-01-01 | OK | Y | N/—/— | — |
| [0001564590-21-004599](https://www.sec.gov/Archives/edgar/data/1318605/000156459021004599/) | TSLA | 10-K | 2020-12-31 | FY | false | 2020-01-01 | 365 | 2020-01-01 | OK | Y | 2020-01-01 | OK | Y | N/—/— | — |
| [0001564590-20-004475](https://www.sec.gov/Archives/edgar/data/1318605/000156459020004475/) | TSLA | 10-K | 2019-12-31 | FY | false | 2019-01-01 | 364 | 2019-01-01 | OK | Y | 2019-01-01 | OK | Y | N/—/— | — |
| [0001564590-19-003165](https://www.sec.gov/Archives/edgar/data/1318605/000156459019003165/) | TSLA | 10-K | 2018-12-31 | FY | — | 2018-01-01 | 364 | 2018-01-01 | OK | Y | 2018-01-01 | OK | Y | N/—/— | — |
| [0001564590-17-003118](https://www.sec.gov/Archives/edgar/data/1318605/000156459017003118/) | TSLA | 10-K | 2016-12-31 | FY | — | 2016-01-01 | 365 | 2016-01-01 | OK | Y | 2016-01-01 | OK | Y | N/—/— | — |
| [0000753308-26-000015](https://www.sec.gov/Archives/edgar/data/753308/000075330826000015/) | NEE | 10-K | 2025-12-31 | FY | false | 2025-01-01 | 364 | 2025-01-01 | OK | Y | 2025-01-01 | OK | Y | N/—/— | — |
| [0000753308-25-000011](https://www.sec.gov/Archives/edgar/data/753308/000075330825000011/) | NEE | 10-K | 2024-12-31 | FY | false | 2024-01-01 | 365 | 2024-01-01 | OK | Y | 2024-01-01 | OK | Y | N/—/— | — |
| [0000753308-24-000008](https://www.sec.gov/Archives/edgar/data/753308/000075330824000008/) | NEE | 10-K | 2023-12-31 | FY | false | 2023-01-01 | 364 | 2023-01-01 | OK | Y | 2023-01-01 | OK | Y | N/—/— | — |
| [0000753308-23-000019](https://www.sec.gov/Archives/edgar/data/753308/000075330823000019/) | NEE | 10-K | 2022-12-31 | FY | false | 2022-01-01 | 364 | 2022-01-01 | OK | Y | 2022-01-01 | OK | Y | N/—/— | — |
| [0000753308-22-000014](https://www.sec.gov/Archives/edgar/data/753308/000075330822000014/) | NEE | 10-K | 2021-12-31 | FY | false | 2021-01-01 | 364 | 2021-01-01 | OK | Y | — | MISS | N | N/—/— | FS_CATEGORY_CONFLICT |
| [0000753308-21-000014](https://www.sec.gov/Archives/edgar/data/753308/000075330821000014/) | NEE | 10-K | 2020-12-31 | FY | false | 2020-01-01 | 365 | 2020-01-01 | OK | Y | 2020-01-01 | OK | Y | N/—/— | — |
| [0000753308-20-000021](https://www.sec.gov/Archives/edgar/data/753308/000075330820000021/) | NEE | 10-K | 2019-12-31 | FY | false | 2019-01-01 | 364 | 2019-01-01 | OK | Y | 2019-01-01 | OK | Y | N/—/— | — |
| [0000753308-19-000039](https://www.sec.gov/Archives/edgar/data/753308/000075330819000039/) | NEE | 10-K | 2018-12-31 | FY | — | 2018-01-01 | 364 | 2018-01-01 | OK | Y | 2018-01-01 | OK | Y | N/—/— | — |
| [0001018724-26-000004](https://www.sec.gov/Archives/edgar/data/1018724/000101872426000004/) | AMZN | 10-K | 2025-12-31 | FY | false | 2025-01-01 | 364 | 2025-01-01 | OK | Y | 2025-01-01 | OK | Y | N/—/— | — |
| [0001018724-25-000004](https://www.sec.gov/Archives/edgar/data/1018724/000101872425000004/) | AMZN | 10-K | 2024-12-31 | FY | false | 2024-01-01 | 365 | 2024-01-01 | OK | Y | 2024-01-01 | OK | Y | N/—/— | — |
| [0001018724-24-000008](https://www.sec.gov/Archives/edgar/data/1018724/000101872424000008/) | AMZN | 10-K | 2023-12-31 | FY | false | 2023-01-01 | 364 | 2023-01-01 | OK | Y | 2023-01-01 | OK | Y | N/—/— | — |
| [0001018724-23-000004](https://www.sec.gov/Archives/edgar/data/1018724/000101872423000004/) | AMZN | 10-K | 2022-12-31 | FY | false | 2022-01-01 | 364 | 2022-01-01 | OK | Y | 2022-01-01 | OK | Y | N/—/— | — |
| [0001018724-22-000005](https://www.sec.gov/Archives/edgar/data/1018724/000101872422000005/) | AMZN | 10-K | 2021-12-31 | FY | false | 2021-01-01 | 364 | 2021-01-01 | OK | Y | 2021-01-01 | OK | Y | N/—/— | — |
| [0001018724-21-000004](https://www.sec.gov/Archives/edgar/data/1018724/000101872421000004/) | AMZN | 10-K | 2020-12-31 | FY | false | 2020-01-01 | 365 | 2020-01-01 | OK | Y | 2020-01-01 | OK | Y | N/—/— | — |
| [0001018724-20-000004](https://www.sec.gov/Archives/edgar/data/1018724/000101872420000004/) | AMZN | 10-K | 2019-12-31 | FY | false | 2019-01-01 | 364 | 2019-01-01 | OK | Y | 2019-01-01 | OK | Y | N/—/— | — |
| [0001018724-19-000004](https://www.sec.gov/Archives/edgar/data/1018724/000101872419000004/) | AMZN | 10-K | 2018-12-31 | FY | — | 2018-01-01 | 364 | 2018-01-01 | OK | Y | 2018-01-01 | OK | Y | N/—/— | — |
| [0001652044-26-000018](https://www.sec.gov/Archives/edgar/data/1652044/000165204426000018/) | GOOGL | 10-K | 2025-12-31 | FY | false | 2025-01-01 | 364 | 2025-01-01 | OK | Y | 2025-01-01 | OK | Y | N/—/— | — |
| [0001652044-25-000014](https://www.sec.gov/Archives/edgar/data/1652044/000165204425000014/) | GOOGL | 10-K | 2024-12-31 | FY | false | 2024-01-01 | 365 | 2024-01-01 | OK | Y | 2024-01-01 | OK | Y | N/—/— | — |
| [0001652044-24-000022](https://www.sec.gov/Archives/edgar/data/1652044/000165204424000022/) | GOOGL | 10-K | 2023-12-31 | FY | false | 2023-01-01 | 364 | 2023-01-01 | OK | Y | 2023-01-01 | OK | Y | N/—/— | — |
| [0001652044-23-000016](https://www.sec.gov/Archives/edgar/data/1652044/000165204423000016/) | GOOGL | 10-K | 2022-12-31 | FY | false | 2022-01-01 | 364 | 2022-01-01 | OK | Y | 2022-01-01 | OK | Y | N/—/— | — |
| [0001652044-22-000019](https://www.sec.gov/Archives/edgar/data/1652044/000165204422000019/) | GOOGL | 10-K | 2021-12-31 | FY | false | 2021-01-01 | 364 | 2021-01-01 | OK | Y | 2021-01-01 | OK | Y | N/—/— | — |
| [0001652044-21-000010](https://www.sec.gov/Archives/edgar/data/1652044/000165204421000010/) | GOOGL | 10-K | 2020-12-31 | FY | false | 2020-01-01 | 365 | 2020-01-01 | OK | Y | 2020-01-01 | OK | Y | N/—/— | — |
| [0001652044-20-000008](https://www.sec.gov/Archives/edgar/data/1652044/000165204420000008/) | GOOGL | 10-K | 2019-12-31 | FY | false | 2019-01-01 | 364 | 2019-01-01 | OK | Y | 2019-01-01 | OK | Y | N/—/— | — |
| [0001652044-19-000004](https://www.sec.gov/Archives/edgar/data/1652044/000165204419000004/) | GOOGL | 10-K | 2018-12-31 | FY | — | 2018-01-01 | 364 | 2018-01-01 | OK | Y | 2018-01-01 | OK | Y | N/—/— | — |
| [0001628280-26-003942](https://www.sec.gov/Archives/edgar/data/1326801/000162828026003942/) | META | 10-K | 2025-12-31 | FY | false | 2025-01-01 | 364 | 2025-01-01 | OK | Y | 2025-01-01 | OK | Y | N/—/— | — |
| [0001326801-25-000017](https://www.sec.gov/Archives/edgar/data/1326801/000132680125000017/) | META | 10-K | 2024-12-31 | FY | false | 2024-01-01 | 365 | 2024-01-01 | OK | Y | 2024-01-01 | OK | Y | N/—/— | — |
| [0001326801-24-000012](https://www.sec.gov/Archives/edgar/data/1326801/000132680124000012/) | META | 10-K | 2023-12-31 | FY | false | 2023-01-01 | 364 | 2023-01-01 | OK | Y | 2023-01-01 | OK | Y | N/—/— | — |
| [0001326801-23-000013](https://www.sec.gov/Archives/edgar/data/1326801/000132680123000013/) | META | 10-K | 2022-12-31 | FY | false | 2022-01-01 | 364 | 2022-01-01 | OK | Y | 2022-01-01 | OK | Y | N/—/— | — |
| [0001326801-22-000018](https://www.sec.gov/Archives/edgar/data/1326801/000132680122000018/) | META | 10-K | 2021-12-31 | FY | false | 2021-01-01 | 364 | 2021-01-01 | OK | Y | 2021-01-01 | OK | Y | N/—/— | — |
| [0001326801-21-000014](https://www.sec.gov/Archives/edgar/data/1326801/000132680121000014/) | META | 10-K | 2020-12-31 | FY | false | 2020-01-01 | 365 | 2020-01-01 | OK | Y | 2020-01-01 | OK | Y | N/—/— | — |
| [0001326801-20-000013](https://www.sec.gov/Archives/edgar/data/1326801/000132680120000013/) | META | 10-K | 2019-12-31 | FY | false | 2019-01-01 | 364 | 2019-01-01 | OK | Y | 2019-01-01 | OK | Y | N/—/— | — |
| [0001326801-19-000009](https://www.sec.gov/Archives/edgar/data/1326801/000132680119000009/) | META | 10-K | 2018-12-31 | FY | — | 2018-01-01 | 364 | 2018-01-01 | OK | Y | 2018-01-01 | OK | Y | N/—/— | — |
| [0000200406-26-000016](https://www.sec.gov/Archives/edgar/data/200406/000020040626000016/) | JNJ | 10-K | 2025-12-28 | FY | false | 2024-12-30 | 363 | 2024-12-30 | OK | Y | 2024-12-30 | OK | Y | N/—/— | — |
| [0000200406-25-000038](https://www.sec.gov/Archives/edgar/data/200406/000020040625000038/) | JNJ | 10-K | 2024-12-29 | FY | false | 2024-01-01 | 363 | 2024-01-01 | OK | Y | 2024-01-01 | OK | Y | N/—/— | — |
| [0000200406-24-000013](https://www.sec.gov/Archives/edgar/data/200406/000020040624000013/) | JNJ | 10-K | 2023-12-31 | FY | false | 2023-01-02 | 363 | 2023-01-02 | OK | Y | 2023-01-02 | OK | Y | N/—/— | — |
| [0000200406-23-000016](https://www.sec.gov/Archives/edgar/data/200406/000020040623000016/) | JNJ | 10-K | 2023-01-01 | FY | false | 2022-01-03 | 363 | 2022-01-03 | OK | Y | 2022-01-03 | OK | Y | N/—/— | — |
| [0000200406-22-000022](https://www.sec.gov/Archives/edgar/data/200406/000020040622000022/) | JNJ | 10-K | 2022-01-02 | FY | false | 2021-01-04 | 363 | 2021-01-04 | OK | Y | 2021-01-04 | OK | Y | N/—/— | — |
| [0000200406-21-000008](https://www.sec.gov/Archives/edgar/data/200406/000020040621000008/) | JNJ | 10-K | 2021-01-03 | FY | false | 2019-12-30 | 370 | 2019-12-30 | OK | Y | 2019-12-30 | OK | Y | N/—/— | — |
| [0000200406-20-000010](https://www.sec.gov/Archives/edgar/data/200406/000020040620000010/) | JNJ | 10-K | 2019-12-29 | FY | false | 2018-12-31 | 363 | 2018-12-31 | OK | Y | 2018-12-31 | OK | Y | N/—/— | — |
| [0000200406-19-000009](https://www.sec.gov/Archives/edgar/data/200406/000020040619000009/) | JNJ | 10-K | 2018-12-30 | FY | — | 2018-01-01 | 363 | 2018-01-01 | OK | Y | 2018-01-01 | OK | Y | N/—/— | — |
| [0001628280-26-010047](https://www.sec.gov/Archives/edgar/data/21344/000162828026010047/) | KO | 10-K | 2025-12-31 | FY | false | 2025-01-01 | 364 | 2025-01-01 | OK | Y | 2025-01-01 | OK | Y | N/—/— | — |
| [0000021344-25-000011](https://www.sec.gov/Archives/edgar/data/21344/000002134425000011/) | KO | 10-K | 2024-12-31 | FY | false | 2024-01-01 | 365 | 2024-01-01 | OK | Y | 2024-01-01 | OK | Y | N/—/— | — |
| [0000021344-24-000009](https://www.sec.gov/Archives/edgar/data/21344/000002134424000009/) | KO | 10-K | 2023-12-31 | FY | false | 2023-01-01 | 364 | 2023-01-01 | OK | Y | 2023-01-01 | OK | Y | N/—/— | — |
| [0000021344-23-000011](https://www.sec.gov/Archives/edgar/data/21344/000002134423000011/) | KO | 10-K | 2022-12-31 | FY | false | 2022-01-01 | 364 | 2022-01-01 | OK | Y | 2022-01-01 | OK | Y | N/—/— | — |
| [0000021344-22-000009](https://www.sec.gov/Archives/edgar/data/21344/000002134422000009/) | KO | 10-K | 2021-12-31 | FY | false | 2021-01-01 | 364 | 2021-01-01 | OK | Y | — | MISS | N | N/—/— | FS_CATEGORY_CONFLICT |
| [0000021344-21-000008](https://www.sec.gov/Archives/edgar/data/21344/000002134421000008/) | KO | 10-K | 2020-12-31 | FY | false | 2020-01-01 | 365 | 2020-01-01 | OK | Y | 2020-01-01 | OK | Y | N/—/— | — |
| [0000021344-20-000006](https://www.sec.gov/Archives/edgar/data/21344/000002134420000006/) | KO | 10-K | 2019-12-31 | FY | false | 2019-01-01 | 364 | 2019-01-01 | OK | Y | 2019-01-01 | OK | Y | N/—/— | — |
| [0000021344-19-000014](https://www.sec.gov/Archives/edgar/data/21344/000002134419000014/) | KO | 10-K | 2018-12-31 | FY | — | 2018-01-01 | 364 | 2018-01-01 | OK | Y | 2018-01-01 | OK | Y | N/—/— | — |
| [0000077476-26-000007](https://www.sec.gov/Archives/edgar/data/77476/000007747626000007/) | PEP | 10-K | 2025-12-27 | FY | false | 2024-12-29 | 363 | 2024-12-29 | OK | Y | 2024-12-29 | OK | Y | N/—/— | — |
| [0000077476-25-000007](https://www.sec.gov/Archives/edgar/data/77476/000007747625000007/) | PEP | 10-K | 2024-12-28 | FY | false | 2023-12-31 | 363 | 2023-12-31 | OK | Y | 2023-12-31 | OK | Y | N/—/— | — |
| [0000077476-24-000008](https://www.sec.gov/Archives/edgar/data/77476/000007747624000008/) | PEP | 10-K | 2023-12-30 | FY | false | 2023-01-01 | 363 | 2023-01-01 | OK | Y | 2023-01-01 | OK | Y | N/—/— | — |
| [0000077476-23-000007](https://www.sec.gov/Archives/edgar/data/77476/000007747623000007/) | PEP | 10-K | 2022-12-31 | FY | false | 2021-12-26 | 370 | 2021-12-26 | OK | Y | 2021-12-26 | OK | Y | N/—/— | — |
| [0000077476-22-000010](https://www.sec.gov/Archives/edgar/data/77476/000007747622000010/) | PEP | 10-K | 2021-12-25 | FY | false | 2020-12-27 | 363 | 2020-12-27 | OK | Y | — | MISS | N | N/—/— | FS_CATEGORY_CONFLICT |
| [0000077476-21-000007](https://www.sec.gov/Archives/edgar/data/77476/000007747621000007/) | PEP | 10-K | 2020-12-26 | FY | false | 2019-12-29 | 363 | 2019-12-29 | OK | Y | 2019-12-29 | OK | Y | N/—/— | — |
| [0000077476-20-000015](https://www.sec.gov/Archives/edgar/data/77476/000007747620000015/) | PEP | 10-K | 2019-12-28 | FY | false | 2018-12-30 | 363 | 2018-12-30 | OK | Y | 2018-12-30 | OK | Y | N/—/— | — |
| [0000077476-19-000017](https://www.sec.gov/Archives/edgar/data/77476/000007747619000017/) | PEP | 10-K | 2018-12-29 | FY | — | 2017-12-31 | 363 | 2017-12-31 | OK | Y | 2017-12-31 | OK | Y | N/—/— | — |
| [0001628280-26-004357](https://www.sec.gov/Archives/edgar/data/12927/000162828026004357/) | BA | 10-K | 2025-12-31 | FY | false | 2025-01-01 | 364 | 2025-01-01 | OK | Y | 2025-01-01 | OK | Y | N/—/— | — |
| [0000012927-25-000015](https://www.sec.gov/Archives/edgar/data/12927/000001292725000015/) | BA | 10-K | 2024-12-31 | FY | false | 2024-01-01 | 365 | 2024-01-01 | OK | Y | 2024-01-01 | OK | Y | N/—/— | — |
| [0000012927-24-000010](https://www.sec.gov/Archives/edgar/data/12927/000001292724000010/) | BA | 10-K | 2023-12-31 | FY | false | 2023-01-01 | 364 | 2023-01-01 | OK | Y | 2023-01-01 | OK | Y | N/—/— | — |
| [0000012927-23-000007](https://www.sec.gov/Archives/edgar/data/12927/000001292723000007/) | BA | 10-K | 2022-12-31 | FY | false | 2022-01-01 | 364 | 2022-01-01 | OK | Y | 2022-01-01 | OK | Y | N/—/— | — |
| [0000012927-22-000010](https://www.sec.gov/Archives/edgar/data/12927/000001292722000010/) | BA | 10-K | 2021-12-31 | FY | false | 2021-01-01 | 364 | 2021-01-01 | OK | Y | — | MISS | N | N/—/— | FS_CATEGORY_CONFLICT |
| [0000012927-21-000011](https://www.sec.gov/Archives/edgar/data/12927/000001292721000011/) | BA | 10-K | 2020-12-31 | FY | false | 2020-01-01 | 365 | 2020-01-01 | OK | Y | 2020-01-01 | OK | Y | N/—/— | — |
| [0000012927-20-000014](https://www.sec.gov/Archives/edgar/data/12927/000001292720000014/) | BA | 10-K | 2019-12-31 | FY | false | 2019-01-01 | 364 | 2019-01-01 | OK | Y | 2019-01-01 | OK | Y | N/—/— | — |
| [0000012927-19-000010](https://www.sec.gov/Archives/edgar/data/12927/000001292719000010/) | BA | 10-K | 2018-12-31 | FY | — | 2018-01-01 | 364 | 2018-01-01 | OK | Y | 2018-01-01 | OK | Y | N/—/— | — |
| [0000050863-26-000011](https://www.sec.gov/Archives/edgar/data/50863/000005086326000011/) | INTC | 10-K | 2025-12-27 | FY | false | 2024-12-29 | 363 | 2024-12-29 | OK | Y | 2024-12-29 | OK | Y | N/—/— | — |
| [0000050863-25-000009](https://www.sec.gov/Archives/edgar/data/50863/000005086325000009/) | INTC | 10-K | 2024-12-28 | FY | false | 2023-12-31 | 363 | 2023-12-31 | OK | Y | 2023-12-31 | OK | Y | N/—/— | — |
| [0000050863-24-000010](https://www.sec.gov/Archives/edgar/data/50863/000005086324000010/) | INTC | 10-K | 2023-12-30 | FY | false | 2023-01-01 | 363 | 2023-01-01 | OK | Y | 2023-01-01 | OK | Y | N/—/— | — |
| [0000050863-23-000006](https://www.sec.gov/Archives/edgar/data/50863/000005086323000006/) | INTC | 10-K | 2022-12-31 | FY | false | 2021-12-26 | 370 | 2021-12-26 | OK | Y | 2021-12-26 | OK | Y | N/—/— | — |
| [0000050863-22-000007](https://www.sec.gov/Archives/edgar/data/50863/000005086322000007/) | INTC | 10-K | 2021-12-25 | FY | false | 2020-12-27 | 363 | 2020-12-27 | OK | Y | — | MISS | N | N/—/— | FS_CATEGORY_CONFLICT |
| [0000050863-21-000010](https://www.sec.gov/Archives/edgar/data/50863/000005086321000010/) | INTC | 10-K | 2020-12-26 | FY | false | 2019-12-29 | 363 | 2019-12-29 | OK | Y | 2019-12-29 | OK | Y | N/—/— | — |
| [0000050863-20-000011](https://www.sec.gov/Archives/edgar/data/50863/000005086320000011/) | INTC | 10-K | 2019-12-28 | FY | false | 2018-12-30 | 363 | 2018-12-30 | OK | Y | 2018-12-30 | OK | Y | N/—/— | — |
| [0000050863-19-000007](https://www.sec.gov/Archives/edgar/data/50863/000005086319000007/) | INTC | 10-K | 2018-12-29 | FY | — | 2017-12-31 | 363 | 2017-12-31 | OK | Y | 2017-12-31 | OK | Y | N/—/— | — |
| [0000051143-26-000010](https://www.sec.gov/Archives/edgar/data/51143/000005114326000010/) | IBM | 10-K | 2025-12-31 | FY | false | 2025-01-01 | 364 | 2025-01-01 | OK | Y | 2025-01-01 | OK | Y | N/—/— | — |
| [0000051143-25-000015](https://www.sec.gov/Archives/edgar/data/51143/000005114325000015/) | IBM | 10-K | 2024-12-31 | FY | false | 2024-01-01 | 365 | 2024-01-01 | OK | Y | 2024-01-01 | OK | Y | N/—/— | — |
| [0000051143-24-000012](https://www.sec.gov/Archives/edgar/data/51143/000005114324000012/) | IBM | 10-K | 2023-12-31 | FY | false | 2023-01-01 | 364 | 2023-01-01 | OK | Y | 2023-01-01 | OK | Y | N/—/— | — |
| [0001558370-23-002376](https://www.sec.gov/Archives/edgar/data/51143/000155837023002376/) | IBM | 10-K | 2022-12-31 | FY | false | 2022-01-01 | 364 | 2022-01-01 | OK | Y | 2022-01-01 | OK | Y | N/—/— | — |
| [0001558370-22-001584](https://www.sec.gov/Archives/edgar/data/51143/000155837022001584/) | IBM | 10-K | 2021-12-31 | FY | false | 2021-01-01 | 364 | 2021-01-01 | OK | Y | 2021-01-01 | OK | Y | N/—/— | — |
| [0001558370-21-001489](https://www.sec.gov/Archives/edgar/data/51143/000155837021001489/) | IBM | 10-K | 2020-12-31 | FY | false | 2020-01-01 | 365 | 2020-01-01 | OK | Y | 2020-01-01 | OK | Y | N/—/— | — |
| [0001558370-20-001334](https://www.sec.gov/Archives/edgar/data/51143/000155837020001334/) | IBM | 10-K | 2019-12-31 | FY | false | 2019-01-01 | 364 | 2019-01-01 | OK | Y | 2019-01-01 | OK | Y | N/—/— | — |
| [0001047469-19-000712](https://www.sec.gov/Archives/edgar/data/51143/000104746919000712/) | IBM | 10-K | 2018-12-31 | FY | — | 2018-01-01 | 364 | 2018-01-01 | OK | Y | 2018-01-01 | OK | Y | N/—/— | — |
| [0000063908-26-000035](https://www.sec.gov/Archives/edgar/data/63908/000006390826000035/) | MCD | 10-K | 2025-12-31 | FY | false | 2025-01-01 | 364 | 2025-01-01 | OK | Y | 2025-01-01 | OK | Y | N/—/— | — |
| [0000063908-25-000012](https://www.sec.gov/Archives/edgar/data/63908/000006390825000012/) | MCD | 10-K | 2024-12-31 | FY | false | 2024-01-01 | 365 | 2024-01-01 | OK | Y | 2024-01-01 | OK | Y | N/—/— | — |
| [0000063908-24-000072](https://www.sec.gov/Archives/edgar/data/63908/000006390824000072/) | MCD | 10-K | 2023-12-31 | FY | false | 2023-01-01 | 364 | 2023-01-01 | OK | Y | 2023-01-01 | OK | Y | N/—/— | — |
| [0000063908-23-000012](https://www.sec.gov/Archives/edgar/data/63908/000006390823000012/) | MCD | 10-K | 2022-12-31 | FY | false | 2022-01-01 | 364 | 2022-01-01 | OK | Y | 2022-01-01 | OK | Y | N/—/— | — |
| [0000063908-22-000011](https://www.sec.gov/Archives/edgar/data/63908/000006390822000011/) | MCD | 10-K | 2021-12-31 | FY | false | 2021-01-01 | 364 | 2021-01-01 | OK | Y | — | MISS | N | N/—/— | FS_CATEGORY_CONFLICT |
| [0000063908-21-000013](https://www.sec.gov/Archives/edgar/data/63908/000006390821000013/) | MCD | 10-K | 2020-12-31 | FY | false | 2020-01-01 | 365 | 2020-01-01 | OK | Y | 2020-01-01 | OK | Y | N/—/— | — |
| [0000063908-20-000022](https://www.sec.gov/Archives/edgar/data/63908/000006390820000022/) | MCD | 10-K | 2019-12-31 | FY | false | 2019-01-01 | 364 | 2019-01-01 | OK | Y | 2019-01-01 | OK | Y | N/—/— | — |
| [0000063908-19-000010](https://www.sec.gov/Archives/edgar/data/63908/000006390819000010/) | MCD | 10-K | 2018-12-31 | FY | — | 2018-01-01 | 364 | 2018-01-01 | OK | Y | 2018-01-01 | OK | Y | N/—/— | — |
| [0000060667-25-000049](https://www.sec.gov/Archives/edgar/data/60667/000006066725000049/) | LOW | 10-K | 2025-01-31 | FY | false | 2024-02-03 | 363 | 2024-02-03 | OK | Y | 2024-02-03 | OK | Y | N/—/— | — |
| [0000060667-24-000033](https://www.sec.gov/Archives/edgar/data/60667/000006066724000033/) | LOW | 10-K | 2024-02-02 | FY | false | 2023-02-04 | 363 | 2023-02-04 | OK | Y | 2023-02-04 | OK | Y | N/—/— | — |
| [0000060667-23-000034](https://www.sec.gov/Archives/edgar/data/60667/000006066723000034/) | LOW | 10-K | 2023-02-03 | FY | false | 2022-01-29 | 370 | 2022-01-29 | OK | Y | 2022-01-29 | OK | Y | N/—/— | — |
| [0000060667-22-000038](https://www.sec.gov/Archives/edgar/data/60667/000006066722000038/) | LOW | 10-K | 2022-01-28 | FY | false | 2021-01-30 | 363 | 2021-01-30 | OK | Y | — | MISS | N | N/—/— | FS_CATEGORY_CONFLICT |
| [0000060667-21-000026](https://www.sec.gov/Archives/edgar/data/60667/000006066721000026/) | LOW | 10-K | 2021-01-29 | FY | false | 2020-02-01 | 363 | 2020-02-01 | OK | Y | 2020-02-01 | OK | Y | N/—/— | — |
| [0000060667-20-000036](https://www.sec.gov/Archives/edgar/data/60667/000006066720000036/) | LOW | 10-K | 2020-01-31 | FY | false | 2019-02-02 | 363 | 2019-02-02 | OK | Y | 2019-02-02 | OK | Y | N/—/— | — |
| [0000060667-19-000042](https://www.sec.gov/Archives/edgar/data/60667/000006066719000042/) | LOW | 10-K | 2019-02-01 | FY | — | 2018-02-03 | 363 | 2018-02-03 | OK | Y | 2018-02-03 | OK | Y | N/—/— | — |
| [0000060667-18-000051](https://www.sec.gov/Archives/edgar/data/60667/000006066718000051/) | LOW | 10-K | 2018-02-02 | FY | — | 2017-02-04 | 363 | 2017-02-04 | OK | Y | 2017-02-04 | OK | Y | N/—/— | — |
| [0000950170-25-087926](https://www.sec.gov/Archives/edgar/data/1341439/000095017025087926/) | ORCL | 10-K | 2025-05-31 | FY | false | 2024-06-01 | 364 | 2024-06-01 | OK | Y | 2024-06-01 | OK | Y | N/—/— | — |
| [0000950170-24-075605](https://www.sec.gov/Archives/edgar/data/1341439/000095017024075605/) | ORCL | 10-K | 2024-05-31 | FY | false | 2023-06-01 | 365 | 2023-06-01 | OK | Y | 2023-06-01 | OK | Y | N/—/— | — |
| [0000950170-23-028914](https://www.sec.gov/Archives/edgar/data/1341439/000095017023028914/) | ORCL | 10-K | 2023-05-31 | FY | false | 2022-06-01 | 364 | 2022-06-01 | OK | Y | 2022-06-01 | OK | Y | N/—/— | — |
| [0001564590-22-023675](https://www.sec.gov/Archives/edgar/data/1341439/000156459022023675/) | ORCL | 10-K | 2022-05-31 | FY | false | 2021-06-01 | 364 | 2021-06-01 | OK | Y | 2021-06-01 | OK | Y | N/—/— | — |
| [0001564590-21-033616](https://www.sec.gov/Archives/edgar/data/1341439/000156459021033616/) | ORCL | 10-K | 2021-05-31 | FY | false | 2020-06-01 | 364 | 2020-06-01 | OK | Y | 2020-06-01 | OK | Y | N/—/— | — |
| [0001564590-20-030125](https://www.sec.gov/Archives/edgar/data/1341439/000156459020030125/) | ORCL | 10-K | 2020-05-31 | FY | false | 2019-06-01 | 365 | — | AMB | N | 2019-06-01 | OK | Y | N/—/— | A_CONTEXT_POLLUTION |
| [0001564590-19-023119](https://www.sec.gov/Archives/edgar/data/1341439/000156459019023119/) | ORCL | 10-K | 2019-05-31 | FY | — | 2018-06-01 | 364 | 2018-06-01 | OK | Y | 2018-06-01 | OK | Y | N/—/— | — |
| [0001193125-18-201034](https://www.sec.gov/Archives/edgar/data/1341439/000119312518201034/) | ORCL | 10-K | 2018-05-31 | FY | — | 2017-06-01 | 364 | 2017-06-01 | OK | Y | 2017-06-01 | OK | Y | N/—/— | — |
| [0000796343-26-000003](https://www.sec.gov/Archives/edgar/data/796343/000079634326000003/) | ADBE | 10-K | 2025-11-28 | FY | false | 2024-11-30 | 363 | 2024-11-30 | OK | Y | 2024-11-30 | OK | Y | N/—/— | — |
| [0000796343-25-000004](https://www.sec.gov/Archives/edgar/data/796343/000079634325000004/) | ADBE | 10-K | 2024-11-29 | FY | false | 2023-12-02 | 363 | 2023-12-02 | OK | Y | 2023-12-02 | OK | Y | N/—/— | — |
| [0000796343-24-000006](https://www.sec.gov/Archives/edgar/data/796343/000079634324000006/) | ADBE | 10-K | 2023-12-01 | FY | false | 2022-12-03 | 363 | 2022-12-03 | OK | Y | 2022-12-03 | OK | Y | N/—/— | — |
| [0000796343-23-000007](https://www.sec.gov/Archives/edgar/data/796343/000079634323000007/) | ADBE | 10-K | 2022-12-02 | FY | false | 2021-12-04 | 363 | 2021-12-04 | OK | Y | 2021-12-04 | OK | Y | N/—/— | — |
| [0000796343-22-000032](https://www.sec.gov/Archives/edgar/data/796343/000079634322000032/) | ADBE | 10-K | 2021-12-03 | FY | false | 2020-11-28 | 370 | 2020-11-28 | OK | Y | 2020-11-28 | OK | Y | N/—/— | — |
| [0000796343-21-000004](https://www.sec.gov/Archives/edgar/data/796343/000079634321000004/) | ADBE | 10-K | 2020-11-27 | FY | false | 2019-11-30 | 363 | 2019-11-30 | OK | Y | 2019-11-30 | OK | Y | N/—/— | — |
| [0000796343-20-000013](https://www.sec.gov/Archives/edgar/data/796343/000079634320000013/) | ADBE | 10-K | 2019-11-29 | FY | false | 2018-12-01 | 363 | 2018-12-01 | OK | Y | 2018-12-01 | OK | Y | N/—/— | — |
| [0000796343-19-000019](https://www.sec.gov/Archives/edgar/data/796343/000079634319000019/) | ADBE | 10-K | 2018-11-30 | FY | — | 2017-12-02 | 363 | 2017-12-02 | OK | Y | 2017-12-02 | OK | Y | N/—/— | — |
| [0000858877-25-000111](https://www.sec.gov/Archives/edgar/data/858877/000085887725000111/) | CSCO | 10-K | 2025-07-26 | FY | false | 2024-07-28 | 363 | 2024-07-28 | OK | Y | 2024-07-28 | OK | Y | N/—/— | — |
| [0000858877-24-000017](https://www.sec.gov/Archives/edgar/data/858877/000085887724000017/) | CSCO | 10-K | 2024-07-27 | FY | false | 2023-07-30 | 363 | 2023-07-30 | OK | Y | 2023-07-30 | OK | Y | N/—/— | — |
| [0000858877-23-000023](https://www.sec.gov/Archives/edgar/data/858877/000085887723000023/) | CSCO | 10-K | 2023-07-29 | FY | false | 2022-07-31 | 363 | 2022-07-31 | OK | Y | 2022-07-31 | OK | Y | N/—/— | — |
| [0000858877-22-000013](https://www.sec.gov/Archives/edgar/data/858877/000085887722000013/) | CSCO | 10-K | 2022-07-30 | FY | false | 2021-08-01 | 363 | 2021-08-01 | OK | Y | 2021-08-01 | OK | Y | N/—/— | — |
| [0000858877-21-000013](https://www.sec.gov/Archives/edgar/data/858877/000085887721000013/) | CSCO | 10-K | 2021-07-31 | FY | false | 2020-07-26 | 370 | 2020-07-26 | OK | Y | 2020-07-26 | OK | Y | N/—/— | — |
| [0000858877-20-000010](https://www.sec.gov/Archives/edgar/data/858877/000085887720000010/) | CSCO | 10-K | 2020-07-25 | FY | false | 2019-07-28 | 363 | 2019-07-28 | OK | Y | 2019-07-28 | OK | Y | N/—/— | — |
| [0000858877-19-000012](https://www.sec.gov/Archives/edgar/data/858877/000085887719000012/) | CSCO | 10-K | 2019-07-27 | FY | — | 2018-07-29 | 363 | 2018-07-29 | OK | Y | 2018-07-29 | OK | Y | N/—/— | — |
| [0000858877-18-000011](https://www.sec.gov/Archives/edgar/data/858877/000085887718000011/) | CSCO | 10-K | 2018-07-28 | FY | — | 2017-07-30 | 363 | 2017-07-30 | OK | Y | 2017-07-30 | OK | Y | N/—/— | — |
| [0001048911-25-000011](https://www.sec.gov/Archives/edgar/data/1048911/000104891125000011/) | FDX | 10-K | 2025-05-31 | FY | false | 2024-06-01 | 364 | 2024-06-01 | OK | Y | 2024-06-01 | OK | Y | N/—/— | — |
| [0000950170-24-083577](https://www.sec.gov/Archives/edgar/data/1048911/000095017024083577/) | FDX | 10-K | 2024-05-31 | FY | false | 2023-06-01 | 365 | 2023-06-01 | OK | Y | 2023-06-01 | OK | Y | N/—/— | — |
| [0000950170-23-033201](https://www.sec.gov/Archives/edgar/data/1048911/000095017023033201/) | FDX | 10-K | 2023-05-31 | FY | false | 2022-06-01 | 364 | 2022-06-01 | OK | Y | 2022-06-01 | OK | Y | N/—/— | — |
| [0000950170-22-012762](https://www.sec.gov/Archives/edgar/data/1048911/000095017022012762/) | FDX | 10-K | 2022-05-31 | FY | false | 2021-06-01 | 364 | 2021-06-01 | OK | Y | 2021-06-01 | OK | Y | N/—/— | — |
| [0001564590-21-037031](https://www.sec.gov/Archives/edgar/data/1048911/000156459021037031/) | FDX | 10-K | 2021-05-31 | FY | false | 2020-06-01 | 364 | 2020-06-01 | OK | Y | 2020-06-01 | OK | Y | N/—/— | — |
| [0001564590-20-032775](https://www.sec.gov/Archives/edgar/data/1048911/000156459020032775/) | FDX | 10-K | 2020-05-31 | FY | false | 2019-06-01 | 365 | 2019-06-01 | OK | Y | 2019-06-01 | OK | Y | N/—/— | — |
| [0001564590-19-025065](https://www.sec.gov/Archives/edgar/data/1048911/000156459019025065/) | FDX | 10-K | 2019-05-31 | FY | — | 2018-06-01 | 364 | 2018-06-01 | OK | Y | 2018-06-01 | OK | Y | N/—/— | — |
| [0001564590-18-016877](https://www.sec.gov/Archives/edgar/data/1048911/000156459018016877/) | FDX | 10-K | 2018-05-31 | FY | — | 2017-06-01 | 364 | 2017-06-01 | OK | Y | 2017-06-01 | OK | Y | N/—/— | — |
| [0000950170-24-031469](https://www.sec.gov/Archives/edgar/data/1502377/000095017024031469/) | CTGO-TRANSITION | 10-KT | 2023-12-31 | FY | true | 2023-07-01 | 183 | — | MISS | N | — | MISS | N | N/—/— | A_RANGE, NO_STD_REVENUE |
| [0001525221-23-000010](https://www.sec.gov/Archives/edgar/data/1525221/000152522123000010/) | BRISTOW-TRANSITION | 10-KT | 2022-12-31 | FY | true | 2022-04-01 | 274 | — | MISS | N | 2022-04-01 | OK | Y | N/—/— | A_RANGE |
| [0001641172-25-001892](https://www.sec.gov/Archives/edgar/data/748268/000164117225001892/) | RCAT-TRANSITION | 10-KT | 2024-12-31 | FY | true | 2024-05-01 | 244 | — | MISS | N | 2024-05-01 | OK | Y | N/—/— | A_RANGE |


## 9. Candidate C viability

**canonical selector로는 not viable**다.

- 244/244 `R*.htm`에서 numeric cell의 explicit raw context identifier를 찾지 못했다.
- 244건의 FilingSummary/index에 usable `R*.xml`/`XmlFileName`은 0건이었다.
- renderer는 duration label, DPE column, displayed value, concept `defref`는 제공했다.
  그러나 exact start를 얻으려면 displayed value와 raw instance를 value/scale/column grid로
  재결합해야 한다. 같은 값·rounding·footnote spacer·multiple duration column에서 ambiguity가
  생길 수 있는 별도 parser다.
- recent inline primary의 `ix:* contextRef`는 존재하지만 그것은 raw filing source이지
  `R*.htm` current-column context metadata가 아니다.
- 따라서 renderer는 audit/ground-truth evidence에는 유용하지만, B가 230건에서 raw structured
  facts만으로 성립한 상황에서 C를 production canonical selector로 추가할 필요는 입증되지 않았다.

## 10. User decision

### 추천: B — longest-duration structural rule 채택

이 추천은 coverage를 좋게 만들기 위한 것이 아니다. 실제로 A보다 B의 strict missingness가
더 높다(전체 14 vs 3, 원본 10-K 13 vs 0). 추천 이유는 다음과 같다.

- **correctness** — B resolved 230건은 230/230 정답이고 ORCL same-DPE note context와
  revenue가 있는 10-KT unusual duration 2건을 올바르게 처리했다. 나머지 pre-revenue
  10-KT는 추정하지 않고 missing이었다. wrong selection 0이다.
- **determinism** — Statement role, standard revenue family, target CIK, dimensionless, USD,
  end=DPE, longest duration, tie fail-close만 쓴다. value priority나 이름 fuzzy mapping이 없다.
- **arbitrary tuning knob** — 340/400 같은 숫자가 없다. observed distribution으로 새 숫자를
  최적화하지 않는다.
- **old/recent compatibility** — old standalone presentation linkbase와 recent issuer-XSD embedded
  presentation 양쪽에서 구조가 성립했다. 단, 구현 시 두 packaging과 zip-only index case를
  fixture로 잠가야 한다.
- **parser complexity** — A보다 크지만 기존 raw instance/FilingSummary/presentation graph의
  책임 범위 안이다. C의 rendered-cell/value reconciliation parser보다는 작고 canonical
  raw-XBRL 계약에도 맞는다.
- **expected missingness** — 표본에서 14/244(5.7%)다. 12건 metadata conflict와 2건 no-standard-
  revenue를 추정하지 말고 그대로 fail-close해야 한다. LongName으로 conflict를 결과 보고
  rescue하는 정책은 이 보고서가 승인하지 않는다.
- **current CLOSED contracts** — consolidated statement role, standard taxonomy,
  dimensionless target-CIK fact, note exclusion, raw-XBRL source-of-truth와 정렬된다. Tesla
  sibling-total, NEE COGS, preferred hierarchy 등 CLOSED 경제 계약을 바꾸지 않는다.

Candidate A를 formal contract로 승격하는 것은 이 표본의 높은 hit rate만으로 정당화하기
어렵다. 공식 semantic anchor가 없고 ORCL에서 concept-agnostic context pollution이 실제로
재현됐다. Candidate C는 exact context metadata가 없어 필요성 대비 복잡도가 크다.

이 문서는 recommendation까지만 한다. `MIN_ANNUAL_DAYS`, `MAX_ANNUAL_DAYS`, production code,
schema, tests, roadmap/freeze는 수정하지 않았다.

## 11. Non-actions

- production code/schema/tests/roadmap semantic changes: 0
- threshold search/340·400 조정: 0
- issuer whitelist/companyfacts fy/fp/frame selector: 0
- Tesla sibling-total/NEE COGS 작업: 0
- production ingest, returns, rank, B/M, coverage/Gate 계산: 0
