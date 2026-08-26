# QV Phase 0 — consolidated total revenue structural selection probe

> **Status: RESEARCH EVIDENCE ONLY.** 이 문서는 설계 승인·freeze가 아니다. production
> code/schema/test/roadmap의 의미를 바꾸지 않는다.

## 1. 질문과 결론 요약

질문은 selected annual consolidated income-statement role과 annual context 안에 standard
revenue-family fact가 여러 개 있을 때, filing이 선언한 structured XBRL 관계만으로
consolidated grand-total revenue를 결정론적으로 찾을 수 있는가였다.

결론은 **그렇다 — 이번 고정 표본은 Candidate A의 exact-role effective calculation-root
rule을 지지한다.** 이전 annual-period probe의 원본 10-K 241개를 그대로 재사용했다.
기존 annual role/context 계약으로 분석 가능한 228개 중 17개가 multi-candidate였고,
다음 엄격한 A rule이 17/17을 resolve해 17/17 ground truth와 일치했다(wrong 0).

1. selected presentation Statement role URI와 **정확히 같은** calculation extended-link role만 본다.
2. effective `summation-item` 관계만 본다.
3. canonical 후보는 기존 standard revenue-family fact 집합 그대로다.
4. eligible 후보 중 calculation source이면서 다른 모든 eligible 후보의 transitive ancestor인
   후보가 정확히 하나일 때만 그 **이미 보고된 fact**를 고른다.
5. transitive path의 custom intermediate는 관계 evidence로만 허용한다. custom fact를 canonical
   Revenue로 고르거나 component를 합산해 Revenue를 만들지 않는다.
6. 0개 또는 2개 이상이면 fail-close한다. role URI를 제목 유사도·순서로 연결하지 않는다.

Candidate B(`totalLabel`)와 C(calc + `totalLabel`)도 이 17개에서는 17/17이었지만,
`totalLabel`의 공식 의미는 “grand total”이 아니라 그 presentation occurrence에 total용 label을
사용하라는 뜻이다. Tesla FY2016은 같은 revenue section 안에서 custom **Total automotive
revenue** subtotal과 standard **Total revenues** grand total에 모두 `totalLabel`을 쓴다.
따라서 B/C는 A보다 강한 경제적 total evidence가 아니며 C는 표본에서 wrong을 하나도 더
줄이지 못했다.

추천은 마지막 `User decision`의 **B. calculation-root selector 추가**다. 이 recommendation은
research 결과일 뿐 아직 CLOSED/FROZEN 계약이 아니다.

## 2. 고정 표본과 방법

### 2.1 표본

- 이전 `PROBE-annual-period-mapping.md`에서 결과를 보기 전에 고정한 heterogeneous 30 issuer,
  원본 `10-K` 241 accession을 그대로 사용했다. 10-KT stress 3건은 이번 표본에서 제외했다.
- report period 범위: 2016-12-31 ~ 2025-12-31. filing date 범위: 2017-03-01 ~ 2026-02-26.
- fixed selection manifest SHA-256:
  `430aa2417bbba14408dcea0813d25e98c7318a62653b47300fe3ec7e8f8f7262`.
- 기존 CLOSED annual selector로 selected Statement role + annual start가 resolve된 accession은
  228개였다. 13개는 이미 알려진 2021 `FilingSummary` metadata conflict 12건과 XOM FY2018
  standard-revenue missing 1건이라 revenue-total selector에 진입하지 않았다. 이를 이번 rule의
  false missing으로 세지 않았다.
- 228개 중 standard revenue-family candidate가 2개 이상인 accession **전부 17개**를 primary
  stratum으로 삼았다. 나머지 **single-candidate 211개 전부**를 control로 사용했다(요구된 50개 이상).
- multi stratum 구성: WMT 7, PFE 3, XOM 3, TSLA 2, MCD 1, ORCL 1.

### 2.2 fact scope와 ground truth

후보 fact scope는 production의 현재 CLOSED 범위를 그대로 복제했다.

- selected Statement presentation role
- selected annual start/end
- target CIK, dimensionless context, ISO4217 USD
- standard US-GAAP `REVENUE_LOCALS`
- reported raw Decimal fact만 사용

Ground truth는 selector 결과를 재사용하지 않았다. 각 multi accession에서 SEC rendered audited
consolidated statement의 current-year displayed grand-total row를 확인하고, displayed amount를 raw
instance의 concept/context/value에 역매칭했다. calculation graph와 `totalLabel`은 그 뒤 별도
candidate evidence로 비교했다. 표의 ground-truth concept가 우연히 17건 모두 `us-gaap:Revenues`인
것은 관측 결과이지 concept-priority rule이 아니다.

원자료는 각 accession의 `FilingSummary.xml`, instance, presentation/calculation/label linkbase,
issuer XSD 안의 embedded linkbase, SEC rendered `R*.htm`이다. accession URL은 다음 결정론적
형태다.

```text
https://www.sec.gov/Archives/edgar/data/{integer CIK}/{accession without hyphens}/
```

Tesla 원자료 예시는 [accession directory](https://www.sec.gov/Archives/edgar/data/1318605/000156459017003118/),
[instance](https://www.sec.gov/Archives/edgar/data/1318605/000156459017003118/tsla-20161231.xml),
[presentation](https://www.sec.gov/Archives/edgar/data/1318605/000156459017003118/tsla-20161231_pre.xml),
[calculation](https://www.sec.gov/Archives/edgar/data/1318605/000156459017003118/tsla-20161231_cal.xml),
[label](https://www.sec.gov/Archives/edgar/data/1318605/000156459017003118/tsla-20161231_lab.xml),
[rendered statement R4](https://www.sec.gov/Archives/edgar/data/1318605/000156459017003118/R4.htm)다.

### 2.3 relationship 처리

- calculation source/target는 locator fragment를 instance namespace map으로 QName resolve했다.
- base set은 link/arc QName, arcrole, extended-link role로 분리했다.
- XBRL 2.1의 `use`/`priority` prohibition·override 규칙을 적용했다. `order`, `weight`,
  `preferredLabel`은 non-exempt semantic attribute로 유지했다.
- selected presentation role과 calculation role은 URI exact equality만 허용했다.
- standalone `_cal.xml`과 issuer XSD에 embedded된 `calculationLink`를 둘 다 읽었다.
- arithmetic은 selector와 분리했다. direct child가 current annual target-CIK dimensionless USD
  fact로 모두 유일할 때만 exact raw Decimal 합을 diagnostic으로 계산했다. formal XBRL
  decimals-aware interval validation은 수행하지 않았다.

Research result JSON SHA-256은
`e5c72f355cd3d733a47d30a5b57e52a222b004bb77a74260456076f8de400907`이다. 이 JSON은
`/private/tmp` research cache라 commit하지 않는다. canonical evidence는 SEC accession과 이 문서다.

## 3. 공식 semantics

### 3.1 calculation `summation-item`

최신 확인본인 SEC staff의 [EDGAR XBRL Guide, May 2026 §5.9–5.9.3](https://www.sec.gov/files/edgar/filer-information/specifications/xbrl-guide-2026-05-15.pdf)는
financial statement가 둘 이상의 line item과 net/total을 보여주고 required-context numeric facts가
있으면 total concept에서 contributing items로 effective calculation relationship을 두도록 한다.
또 alternate line-item sets가 같은 total로 갈 때는 distinct roles를 쓰도록 한다. 같은 guide의
validation table은 SEC calculation weight를 `+1` 또는 `-1`로 제한한다.

[XBRL 2.1 §5.2.5.2](https://www.xbrl.org/Specification/XBRL-2.1/REC-2003-12-31/XBRL-2.1-REC-2003-12-31%2Bcorrected-errata-2013-02-20.html#_5.2.5.2)는
`from` concept를 summation concept, `to` concept를 contributing concept로 정의한다. weight는
contributor가 summation에 들어갈 multiplier다. extended-link role별로 complete arc set이 갈리므로
role을 무시한 전역 graph는 잘못이다.

[XBRL 2.1 §3.5.3.9.7](https://www.xbrl.org/Specification/XBRL-2.1/REC-2003-12-31/XBRL-2.1-REC-2003-12-31%2Bcorrected-errata-2013-02-20.html#_3.5.3.9.7)은
base set 안에서 equivalent relationships의 priority를 비교하고 highest-priority prohibition이 있으면
그 관계들을 network에서 제외한다. 따라서 raw arc 존재만 세면 안 되고 effective relationship이어야
한다.

Calculation은 missing fact를 만드는 공식이 아니다. XBRL 2.1은 instance에 **명시적으로 제공된**
items로 consistency를 검사한다. [Calculations 1.1 §§4–5](https://www.xbrl.org/Specification/calculation-1.1/REC-2023-02-22%2Bcorrected-errata-2024-02-14/calculation-1.1-REC-2023-02-22%2Bcorrected-errata-2024-02-14.html)는
effective relationship과 reported fact intervals로 binding consistency를 검사하고, missing contributors
때문에도 inconsistency가 날 수 있다고 명시한다. 따라서 이 probe는 graph를 **reported canonical
candidate identity evidence**로만 썼다.

### 3.2 presentation `preferredLabel` / `totalLabel`

[XBRL 2.1 §5.2.4.2.1](https://www.xbrl.org/Specification/XBRL-2.1/REC-2003-12-31/XBRL-2.1-REC-2003-12-31%2Bcorrected-errata-2013-02-20.html#_5.2.4.2.1)은
presentation arc의 `preferredLabel`을 그 arc의 child를 보여줄 때 사용할 가장 적절한 label role을
가리키는 URI로 정의한다. 즉 concept-global total identity가 아니라 occurrence/role-specific label
선택이다.

[EDGAR XBRL Guide §6.7.3](https://www.sec.gov/files/edgar/filer-information/specifications/xbrl-guide-2026-05-15.pdf)는
같은 element가 일반 line item일 때와 다른 항목의 summation일 때 label을 달리 보여주려면 total
label을 쓰며, renderer의 underline도 이 label로 유도한다고 설명한다. **subtotal과 grand total을
구분한다는 의미는 없다.** Tesla FY2016이 이를 실제로 보여준다.

### 3.3 presentation order

[XBRL 2.1 §3.5.3.9.5](https://www.xbrl.org/Specification/XBRL-2.1/REC-2003-12-31/XBRL-2.1-REC-2003-12-31%2Bcorrected-errata-2013-02-20.html#_3.5.3.9.5)은
`order`를 sibling display order로 정의할 뿐 total identity를 부여하지 않는다. 그러므로
“마지막 revenue row”는 이 표본에서 맞더라도 canonical selector의 공식 근거가 아니다.

## 4. Tesla FY2016 complete structure

Accession `0001564590-17-003118`, target CIK `0001318605`, annual context
`2016-01-01/2016-12-31`, exact role:

```text
http://www.teslamotors.com/20161231/taxonomy/role/
StatementConsolidatedStatementsOfOperations
```

Raw amounts는 USD이고 rendered R4는 USD thousands다. `RevenuesAbstract` 아래 presentation
siblings와 같은 role의 effective calculation arcs는 다음과 같다.

| Rendered row | QName | Raw value | Presentation parent / order / preferredLabel | Calculation parent (+1) | Calculation children (+1) | 경제적 의미 |
|---|---|---:|---|---|---|---|
| Automotive | `us-gaap:SalesRevenueGoodsNet` | 5,589,007,000 | `RevenuesAbstract` / 10370 / terse | custom `SalesRevenueAutomotive` | — | automotive excluding lease subtotal component |
| Automotive leasing | `us-gaap:OperatingLeasesIncomeStatementLeaseRevenue` | 761,759,000 | `RevenuesAbstract` / 10490 / terse | custom `SalesRevenueAutomotive` | — | automotive lease component |
| Total automotive revenue | custom `tsla:SalesRevenueAutomotive` | 6,350,766,000 | `RevenuesAbstract` / 10610 / **totalLabel** | `us-gaap:Revenues` | `SalesRevenueGoodsNet`, `OperatingLeases…` | automotive subtotal; canonical 후보 아님 |
| Energy generation and storage | `us-gaap:SalesRevenueEnergyServices` | 181,394,000 | `RevenuesAbstract` / 10730 / terse | `us-gaap:Revenues` | — | energy component; frozen candidate set 밖 |
| Services and other | custom `tsla:SalesRevenueServicesAndOtherNet` | 467,972,000 | `RevenuesAbstract` / 10850 / terse | `us-gaap:Revenues` | — | services component; canonical 후보 아님 |
| Total revenues | `us-gaap:Revenues` | 7,000,132,000 | `RevenuesAbstract` / 10970 / **totalLabel** | `us-gaap:GrossProfit` | custom automotive, energy, custom services | consolidated grand total; ground truth |

Current frozen standard candidate set에 들어오는 것은 `SalesRevenueGoodsNet`와 `Revenues` 두 개다.
둘은 presentation siblings라 기존 ancestor rule은 정상적으로 AMBIGUOUS다. calculation graph는
`Revenues → custom SalesRevenueAutomotive → SalesRevenueGoodsNet`의 transitive path를 선언한다.
따라서 unique exact-role calculation root는 `Revenues`다. custom subtotal은 graph evidence일 뿐
canonical fact가 아니다.

Label linkbase도 직접 확인했다. custom automotive concept에는 `totalLabel="Total automotive
revenue"`, `Revenues`에는 `totalLabel="Total revenues"`가 동시에 있다. 이것이 `totalLabel` 단독
semantics로 subtotal/grand total을 구분할 수 없는 실제 반례다.

## 5. accession-level multi-candidate 결과

금액은 raw USD다. `A`=calculation-root, `B`=`totalLabel`, `C`=둘의 agreement다. `✓`는
independent rendered-statement ground truth와 일치함을 뜻한다.

| Issuer | Accession | Fiscal period | Statement role tail | Eligible concept/value | Ground truth | Baseline | A | B | C | Exact-equal? |
|---|---|---|---|---|---|---|---|---|---|---|
| PFE | 0000078003-26-000026 | 2025-12-31 | `ConsolidatedStatementsofOperations` | Collaborative=9,266,000,000<br>`Revenues`=62,579,000,000 | `Revenues`=62,579,000,000 | AMBIG | `Revenues` ✓ | `Revenues` ✓ | `Revenues` ✓ | N |
| PFE | 0000078003-25-000054 | 2024-12-31 | `ConsolidatedStatementsofOperations` | Collaborative=8,388,000,000<br>`Revenues`=63,627,000,000 | `Revenues`=63,627,000,000 | AMBIG | `Revenues` ✓ | `Revenues` ✓ | `Revenues` ✓ | N |
| PFE | 0000078003-24-000039 | 2023-12-31 | `ConsolidatedStatementsofIncome` | Collaborative=7,582,000,000<br>Contract=50,914,000,000<br>`Revenues`=58,496,000,000 | `Revenues`=58,496,000,000 | AMBIG | `Revenues` ✓ | `Revenues` ✓ | `Revenues` ✓ | N |
| XOM | 0000034088-22-000011 | 2021-12-31 | `ConsolidatedStatementOfIncome` | Contract=276,692,000,000<br>`Revenues`=285,640,000,000 | `Revenues`=285,640,000,000 | AMBIG | `Revenues` ✓ | `Revenues` ✓ | `Revenues` ✓ | N |
| XOM | 0000034088-21-000012 | 2020-12-31 | `ConsolidatedStatementOfIncome` | Contract=178,574,000,000<br>`Revenues`=181,502,000,000 | `Revenues`=181,502,000,000 | AMBIG | `Revenues` ✓ | `Revenues` ✓ | `Revenues` ✓ | N |
| XOM | 0000034088-20-000016 | 2019-12-31 | `StatementConsolidatedStatementOfIncome` | Contract=255,583,000,000<br>`Revenues`=264,938,000,000 | `Revenues`=264,938,000,000 | AMBIG | `Revenues` ✓ | `Revenues` ✓ | `Revenues` ✓ | N |
| WMT | 0000104169-25-000021 | 2025-01-31 | `ConsolidatedStatementsofIncome` | Contract=674,538,000,000<br>`Revenues`=680,985,000,000 | `Revenues`=680,985,000,000 | AMBIG | `Revenues` ✓ | `Revenues` ✓ | `Revenues` ✓ | N |
| WMT | 0000104169-24-000056 | 2024-01-31 | `ConsolidatedStatementsofIncome` | Contract=642,637,000,000<br>`Revenues`=648,125,000,000 | `Revenues`=648,125,000,000 | AMBIG | `Revenues` ✓ | `Revenues` ✓ | `Revenues` ✓ | N |
| WMT | 0000104169-23-000020 | 2023-01-31 | `ConsolidatedStatementsofIncome` | Contract=605,881,000,000<br>`Revenues`=611,289,000,000 | `Revenues`=611,289,000,000 | AMBIG | `Revenues` ✓ | `Revenues` ✓ | `Revenues` ✓ | N |
| WMT | 0000104169-21-000033 | 2021-01-31 | `ConsolidatedStatementsofIncome` | Contract=555,233,000,000<br>`Revenues`=559,151,000,000 | `Revenues`=559,151,000,000 | AMBIG | `Revenues` ✓ | `Revenues` ✓ | `Revenues` ✓ | N |
| WMT | 0000104169-20-000011 | 2020-01-31 | `ConsolidatedStatementsOfIncome` | Contract=519,926,000,000<br>`Revenues`=523,964,000,000 | `Revenues`=523,964,000,000 | AMBIG | `Revenues` ✓ | `Revenues` ✓ | `Revenues` ✓ | N |
| WMT | 0000104169-19-000016 | 2019-01-31 | `ConsolidatedStatementsOfIncome` | Contract=510,329,000,000<br>`Revenues`=514,405,000,000 | `Revenues`=514,405,000,000 | AMBIG | `Revenues` ✓ | `Revenues` ✓ | `Revenues` ✓ | N |
| WMT | 0000104169-18-000028 | 2018-01-31 | `ConsolidatedStatementsOfIncome` | `SalesRevenueNet`=495,761,000,000<br>`Revenues`=500,343,000,000 | `Revenues`=500,343,000,000 | AMBIG | `Revenues` ✓ | `Revenues` ✓ | `Revenues` ✓ | N |
| TSLA | 0001564590-19-003165 | 2018-12-31 | `StatementConsolidatedStatementsOfOperations` | Contract=21,461,268,000<br>`Revenues`=21,461,268,000 | `Revenues`=21,461,268,000 | AMBIG | `Revenues` ✓ | `Revenues` ✓ | `Revenues` ✓ | **Y** |
| TSLA | 0001564590-17-003118 | 2016-12-31 | `StatementConsolidatedStatementsOfOperations` | `SalesRevenueGoodsNet`=5,589,007,000<br>`Revenues`=7,000,132,000 | `Revenues`=7,000,132,000 | AMBIG | `Revenues` ✓ | `Revenues` ✓ | `Revenues` ✓ | N |
| MCD | 0000063908-19-000010 | 2018-12-31 | `ConsolidatedStatementOfIncome` | `SalesRevenueGoodsNet`=10,012,700,000<br>`Revenues`=21,025,200,000 | `Revenues`=21,025,200,000 | AMBIG | `Revenues` ✓ | `Revenues` ✓ | `Revenues` ✓ | N |
| ORCL | 0001193125-18-201034 | 2018-05-31 | `StatementCONSOLIDATEDSTATEMENTSOFOPERATIONS` | `SalesRevenueServicesNet`=3,394,000,000<br>`Revenues`=39,831,000,000 | `Revenues`=39,831,000,000 | AMBIG | `Revenues` ✓ | `Revenues` ✓ | `Revenues` ✓ | N |

Abbreviation은 표 공간만 줄인다: `Contract`는
`RevenueFromContractWithCustomerExcludingAssessedTax`, `Collaborative`는
`RevenueFromCollaborativeArrangementExcludingRevenueFromContractWithCustomer`다.

## 6. candidate accuracy와 availability

### 6.1 multi-candidate primary stratum (n=17)

| Rule | Resolved | Correct | Wrong | False missing | False ambiguity |
|---|---:|---:|---:|---:|---:|
| Candidate 0 — current presentation ancestor | 0 | 0 | 0 | 0 | 17 |
| Candidate A — exact-role transitive calculation root | 17 | 17 | 0 | 0 | 0 |
| Candidate B — unique eligible `totalLabel` | 17 | 17 | 0 | 0 | 0 |
| Candidate C — A + B same-candidate agreement | 17 | 17 | 0 | 0 | 0 |
| Candidate E — presentation-last diagnostic | 17 | 17 | 0 | 0 | 0 |

Candidate E의 17/17은 공식 semantic support가 없는 표본 관측이다. recommendation으로 쓰지 않는다.

Candidate A family의 세부 결과:

- A1 unique eligible direct calculation source: 17/17.
- A2 eligible-candidate graph의 unique topmost source: 17/17.
- A3 full graph의 transitive root가 다른 모든 eligible 후보에 도달: 17/17.
- A4 selected presentation role URI와 calculation role URI exact match: 17/17.
- custom intermediate가 실제로 필요한 transitive path: Tesla FY2016 1/17.
- eligible multiple roots: 0/17. prohibited/overridden relevant arc: 0/17.

### 6.2 linkbase / label availability

| Diagnostic | Multi 17 | Resolved annual 228 | Single control 211 |
|---|---:|---:|---:|
| calculation source artifact available | 17 | 228 | 211 |
| exact selected-role calculation arcs available | 17 | 223 | 206 |
| eligible calculation root resolves | 17 | 37 | 20 |
| unique eligible `totalLabel` resolves | 17 | 39 | 22 |
| calc and `totalLabel` both resolve and agree | 17/17 | 37/37 | 20/20 |

Standalone `_cal.xml`은 223/228, issuer XSD embedded `calculationLink`는 recent control 5/228에서
관측됐다. 즉 old standalone과 recent embedded 모두 parser scope에 들어가야 한다. exact selected-role
calculation arc가 없던 5건은 모두 single-candidate control(MSFT 2024/2025, ORCL 2024/2025,
FDX 2024)이므로 current canonical value는 단일 후보로 이미 결정된다. role URI fuzzy matching으로
rescue할 근거는 없다.

Multi 4건(PFE 3, XOM 2021)은 같은 revenue concept가 note/detail calculation roles에도 재사용됐다.
selected exact role 제한을 빼면 note graph가 섞인다. 같은-role restriction은 선택 사항이 아니라
correctness boundary다.

## 7. failure modes와 counterexamples

| Failure mode | 관측 |
|---|---|
| no calculation linkbase | 분석 가능한 228에서 0; 단, artifact 존재가 exact-role 관계 존재를 보장하지는 않음 |
| calculation role 없음 / presentation-role mismatch | multi 0; single control 5는 exact selected-role candidate relation 없음 |
| eligible candidate가 calc source가 아님 | multi의 narrow candidates는 모두 non-source; single control 191은 source evidence 없음 |
| multiple eligible calc roots | 0/17 |
| subtotal과 grand total 둘 다 calc source | Tesla FY2016에서 custom automotive subtotal과 standard grand total이 모두 source. eligible standard root는 하나 |
| eligible `totalLabel` 없음 | multi 0; single control 189/211. B/C를 일반 필수조건으로 만들면 불필요한 missing이 큼 |
| multiple eligible `totalLabel` | 0/17 |
| broader revenue section에 multiple totalLabel | Tesla FY2016: custom automotive subtotal + standard grand total |
| calc vs `totalLabel` disagreement | 둘 다 resolve된 37건에서 0; multi 0 |
| exact-equal distinct concepts | Tesla FY2018 1/17 |
| custom intermediate | Tesla FY2016 1/17 |
| calculation relation이 note와 재사용 | multi 4/17; exact-role restriction으로 격리 |
| current annual contributing facts 부족 | PFE FY2024/FY2025 2/17: relation은 있지만 one child의 dimensionless fact가 없어 direct arithmetic은 bind하지 않음 |
| malformed/prohibited/ineffective relevant arcs | multi 0 |

### 7.1 exact-equal은 identity가 아니다

Tesla FY2018은 annual context에서
`RevenueFromContractWithCustomerExcludingAssessedTax`와 `Revenues`가 정확히
21,461,268,000으로 같다. 하지만 rendered statement occurrence와 calculation graph에서 전자는
`Revenues`의 contributor이고 후자는 grand-total source다. 게다가 같은 concept의 dimensional facts가
segment rows에도 존재한다. **값 equality는 concept/structural-role equality가 아니다.** Candidate D
collapse는 amount를 우연히 보존하지만 provenance와 total identity를 지우므로 추천하지 않는다.

### 7.2 calculation arithmetic diagnostic

Multi 17건 중 direct root calculation이 current annual target-CIK dimensionless facts로 bind 가능한 것은
15건이었다. exact raw Decimal sum은 14/15가 일치했다. PFE 2건은 contributor가 dimensional facts로만
있어 unavailable이었다. Tesla FY2018은 exact raw sum이 불일치했다. 같은 standard contract-revenue
concept의 dimensionless grand amount가 contributor로도 binding되어 double counting되는 구조였기
때문이다.

이 결과는 graph identity와 arithmetic validation을 분리해야 함을 보여준다. Calculation inconsistency를
보고 다른 revenue concept를 선택하지 않았고, component sum으로 canonical Revenue를 만들지 않았다.
Formal XBRL decimals-aware validation은 수행하지 않았으므로 위 숫자는 **exact raw Decimal diagnostic**일
뿐 XBRL 2.1/Calculations 1.1 conformance 결과가 아니다.

### 7.3 known controls

- P&G: selected Statement role은 각 연도 단일 candidate(`SalesRevenueNet` 또는 `Revenues`)였다.
  historical note `Revenues` contamination은 exact role scope 밖이라 multi로 들어오지 않았다.
- Caterpillar: selected Statement annual context는 단일 `Revenues`; quarterly/note occurrences는 scope 밖이다.
- Costco: 8개 accession 모두 단일 standard total. distinct standard concepts의 exact-equal multi는 없었다.
- NEE: resolved 연도는 단일 `RegulatedAndUnregulatedOperatingRevenue`; 이번 연구는 COGS를 건드리지 않았다.
- XOM FY2018: standard revenue가 없는 기존 annual-selector missing을 그대로 유지했다.
- AAPL, MSFT, AMZN, HD, TGT, JNJ, PEP, VZ, BA, INTC, DIS를 포함하라는 요청 중 DIS는 prior fixed
  30-issuer manifest에 없어서 새 결과표본으로 추가하지 않았다. 나머지는 manifest에 포함되어 control로
  검사했다.

## 8. minimal parser implication (implementation 아님)

Candidate A를 나중에 freeze/implement한다면 현재 `qv_xbrl.py`에 부족한 최소 capability는 다음이다.

- `CalculationArc(role, parent, child, order, weight, use, priority, arcrole)`
- `CalculationRole` / calculation document container
- effective relationship 처리(`use`, `priority`, non-exempt attributes)
- standalone calculation linkbase와 issuer XSD embedded `calculationLink` discovery
- exact role URI lookup과 transitive descendants

Generic taxonomy engine, raw XBRL warehouse, Arelle dependency는 필요하다는 evidence가 없다. 다만 DTS
effective semantics를 추정으로 생략해서도 안 된다. 이 표본의 relevant extension arcs에는 prohibition이
없었지만 parser contract는 prohibited/overridden 관계를 source evidence로 세지 않아야 한다.

Candidate B/C를 구현한다면 `PresentationArc.preferred_label` 하나가 최소 추가 필드다. accepted filing의
presentation arc에 있는 standard `totalLabel` URI를 판정하는 데 label text fuzzy parsing은 필요 없다.
그러나 B/C를 추천하지 않으므로 이 필드는 A implementation의 필수 조건이 아니다.

## 9. 범위 준수

- production code/schema/tests/roadmap/README 변경: 0
- `qv-accounting-v2` 의미 변경: 0
- companyfacts, COGS, annual-period, FilingSummary conflict 변경: 0
- production ingest: 0
- coverage/Gate, rank, B/M, returns/portfolio 계산: 0
- issuer/year whitelist, concept priority, highest value, presentation-last 채택, fuzzy label, custom canonical
  revenue, component-sum Revenue 생성: 0

## User decision

### 추천: B. calculation-root selector 추가

추천할 freeze 후보는 다음이다.

```text
multi eligible standard revenue candidates
  -> selected presentation Statement role URI와 exact-equal calculation role
  -> effective summation-item graph
  -> reported eligible candidate 중 calculation source이며
     다른 모든 eligible candidate의 transitive ancestor인 candidate
  -> exactly one: canonical consolidated total Revenue
  -> zero or multiple: REVENUE_UNRESOLVED
```

추천 이유:

- **Correctness / wrong selection:** fixed multi stratum 17/17 correct, wrong 0. Tesla FY2016도 custom
  intermediate를 evidence로만 지나 정확히 resolve했다.
- **Determinism:** QName, exact role URI, effective arcs, graph reachability, uniqueness만 쓴다. label text,
  numeric magnitude, order, issuer/year exception이 없다.
- **SEC/XBRL semantic support:** SEC는 face-statement net/total에서 total→contributors 관계를 요구하고,
  XBRL은 source를 summation concept으로 정의한다. `totalLabel`보다 total identity에 직접 맞는다.
- **Old/recent compatibility:** resolved sample의 standalone 223건과 embedded-XSD 5건을 모두 확인했다.
  multi 17건은 exact same role이었다. 둘을 읽는 작은 additive parser가 필요하다.
- **Parser complexity:** calculation arc/effective-role graph가 필요해 `preferredLabel` 하나보다 복잡하지만,
  generic DTS engine이나 arithmetic reconstruction은 필요 없다. prohibition/priority와 embedded linkbase는
  correctness 때문에 생략할 수 없다.
- **Failure/missing:** 0/여러 root, exact role 부재, unresolved locator는 fail-close한다. Arithmetic bind가
  없거나 inconsistent해도 graph를 다른 concept로 바꾸지 않는다. single candidate는 기존 rule로 남는다.
- **CLOSED economic definition 정렬:** reported standard fact 중 filing이 summation source로 선언한
  consolidated grand total을 고르므로 “consolidated total revenue”와 맞는다.
- **추가 금지 규칙 불필요:** custom tag canonicalization, component sum, concept priority, highest value,
  presentation-last, Tesla exception을 하나도 추가하지 않는다.

Candidate C는 표본에서 A와 같은 17/17이지만 wrong을 더 줄이지 않았고, `totalLabel`은 subtotal에도
정상 사용된다. Single controls 189/211에서 eligible candidate의 `totalLabel`이 없었다는 점도 이
metadata가 보편적이지 않음을 보여준다. C는 표본이 필요성을 입증하지 못한 추가 precondition이다.
Candidate D exact-equal collapse는 Tesla FY2018 반례 때문에 먼저 채택할 이유가 없다.
