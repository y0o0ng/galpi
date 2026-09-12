# QV Phase 0 — PIT Fundamentals Data Gate

> **결과를 계산하기 전에 작성한 사전등록 문서다.** 결과를 본 뒤 이 문서의 판정 기준을
> 고치지 않는다. **이 Phase는 수익률을 한 번도 계산하지 않는다.**

로드맵은 `docs/trading/strategies/quality-value-roadmap.md`이고 이 run은 그 **Phase 0**이다.

**이 Phase는 alpha 예산을 태우지 않는다.** `alpha_intervention_budget = 0`은 그대로이고,
여기서 accounting mapping과 source를 고치는 것은 로드맵 §6이 명시한 대로 개입이 아니라
**데이터를 만들 수 있느냐의 문제**다. 다만 그 허용은 **첫 forward return을 계산하기 전까지만**
유효하다.

---

## 1. 묻는 것

> **수익률을 보지 않고도 QV factor를 과거 시점 기준으로 재현할 수 있는가?**

통과하면 `SIGNAL_STUDY_READY`, 실패하면 `DATA_NOT_READY`다. **`DATA_NOT_READY`는 alpha
실패가 아니다** — 수익률을 아예 계산하지 않았으므로 QV에 대해 아무것도 주장하지 않는다.

---

## 2. 현재 갈피에 이미 있는 것과 없는 것

착수 전 `main`에서 직접 확인했다. **없는 것을 있다고 가정하고 일정을 세우지 않는다.**

### 재사용한다

|자산|실측|
|---|---|
|`bars_daily`|`2006-01-03` ~ `2026-08-07` · 4,122,726행 · raw/adjusted 양쪽|
|`universe_membership`|1,257행 · 고유 심볼 983 · **`valid_to` 채워진 행 632** · `valid_from` 2008-01-02~|
|`delistings`|기존 상장폐지 처리|
|`data_sources`|`source` / `source_version` provenance|
|`edgar.py`|ticker↔CIK map · `submissions` fetch · filing block 파싱|
|`holdout.py`|`HOLDOUT_START` 코드 불변식|

**PIT membership 주장은 검증됐다.** 고유 심볼 983 대 현재 구성원 625이고 탈락이 632건
기록돼 있으므로 생존편향은 구조적으로 차단돼 있다.

### 없다 — 이번에 만든다

```text
XBRL companyfacts ingestion          (저장소 전체 검색 결과 0건)
acceptance_datetime                  (0건)
Revenue / COGS / Assets / BookEquity (0건)
issuer 단위 identity 계층             (securities는 symbol·sector·source·source_version 4칸뿐)
formation-time historical SIC        (securities.sector는 현재 SIC 파생이라 §3.4가 금지)
point-in-time common shares / ME
```

**`securities`에 `cik` 칸이 없다.** issuer 단위 ranking(§4.4)의 전제인 CIK↔security 연결이
표로 존재하지 않으므로 Phase 0의 실작업 대부분은 identity 계층이다.

### 만들지 않는다

```text
전역 Hypothesis Registry / 연구 UI          (§6.3)
범용 run-card 프레임워크                    (§6.3 — sidecar 두 파일뿐)
기존 RULE_FIELDS·paper-core-v1 확장         (§4.7)
QV 때문에 HOLDOUT_START를 옮기거나 리셋      (§1.5)
```

---

## 3. 결과를 보기 전에 고정하는 규칙

로드맵이 "Phase 0에서 정한다"고 남겨둔 칸들이다. **여기서 정하고, 정한 뒤에는 coverage
숫자를 보고 되돌리지 않는다.**

### 3.1 amended filing — 로드맵 본문에 없던 유일한 구멍

§16 체크리스트는 `amended filing 처리 규칙이 고정됐는가`를 요구하는데 본문 어디에도 규칙이
없다. §6.2 sentinel이 `10-K/A`를 경계로 넣으라고만 한다. 그대로 두면 gate E(`동일 fiscal-year를
서로 다른 filing으로 이중 사용 0건`)를 판정할 수 없다. 그래서 여기서 고정한다.

```text
같은 (issuer, fiscal_year)에 대해 formation session까지 usable한 filing이 여럿이면
  → acceptance_datetime이 가장 늦은 것 하나만 쓴다
  → 그것이 10-K/A여도 쓴다. formation 시점에 실제로 볼 수 있었기 때문이다
  → formation 이후에 acceptance된 amendment는 쓰지 않는다. 그것이 look-ahead다
동률(같은 acceptance_datetime)이면 accession 사전순 마지막
```

**"원본 10-K만 쓴다"를 고르지 않은 이유**는 그것이 PIT가 아니기 때문이다. 당시 투자자는
정정본을 보고 있었다. 반대로 **"최종본을 쓴다"도 고르지 않았다** — 그것은 미래를 보는 것이다.
기준은 하나뿐이다: **그날 볼 수 있었는가.**

### 3.2 Phase 0 audit이 정본을 고르는 칸

각 항목은 filing 원문 대조 결과와 함께 `accounting_definition_version`에 박고, 그 값은
QV core signature에 들어간다(§4.7).

|칸|근거|
|---|---|
|~~`GrossProfit` 직접 태그 vs `Revenue − COGS`~~|**CLOSED / FROZEN** (2026-08-25). canonical은 `consolidated total revenue − COGS`다. 계약은 아래 3.6, 정찰은 `PROBE-gross-profit-mapping.md`|
|~~`Total Assets` XBRL mapping~~|**CLOSED / FROZEN** (2026-08-25). canonical은 `us-gaap:Assets` 하나다. 계약은 아래 3.7, 정찰은 `PROBE-total-assets-mapping.md`|
|~~`StockholdersEquity` XBRL fallback 순서~~|**CLOSED / FROZEN** (2026-08-25). direct `us-gaap:StockholdersEquity` 우선, 없으면 `IncludingNCI − MinorityInterest`. 계약은 아래 3.8|
|~~preferred stock · deferred tax 태그 mapping~~|**CLOSED / FROZEN** (2026-08-25). preferred는 `liquidation → par/carrying`, **deferred tax / ITC 항은 이번 lineage에서 항상 0**이다. 계약은 아래 3.8, 정찰은 `PROBE-book-equity-mapping.md`|
|historical SIC 복원 경로|§3.4 — filing 시점 submission header 우선|
|point-in-time common shares / ME source|§3.1 우선순위 1→2→3. **정찰이 열어둔 다섯 중 (1)(2)(3)(4)(5)는 로드맵 §4.4.1·§4.4.2로 확정됐다**(아래 3.5)|
|multi-class issuer aggregation + execution-security rule|§6 작업 6|

**issuer custom tag를 이름 유사도로 자동 연결하지 않는다**(§4.2). 표준 taxonomy와 filing
원문으로 회계적 동일성이 확인된 mapping만 넣는다.

**Gross Profit · Total Assets · Book Equity 셋이 모두 닫혔다.** 그러나 **회계 mapping이
닫힌 것과 실제 ingestion·parser 구현은 다르다** — 후자는 그대로 open이다(아래 7).

### 3.5 ME shares — 정찰 뒤 확정된 계약

정본은 로드맵 §4.4.1·§4.4.2다. **여기서 다시 정하지 않고 Phase 0이 지켜야 할 형태로만
옮겨 적는다.** 정찰 기록은 `PROBE-me-source.md`다.

```text
정본 source      raw XBRL instance          (companyfacts / companyconcept API 금지)
허용 form        10-K · 10-K/A · 10-Q · 10-Q/A
usable 경계      historical_usable_session(filing) <= formation session
12월 instant     t-1년 12월 마지막 거래일 이하 중 가장 늦은 instant
tie-break        acceptance_datetime 늦은 쪽 → accession 사전순 마지막 → 정해지지 않으면 MISSING
member           원문 확인된 실제 ordinary class만 whitelist. derived/equivalent 제외
                 알 수 없는 member는 unresolved/missing
비상장 class     OBSERVED_MARKET_PRICE | CONVERSION_VALUE_PROXY | MISSING (셋 중 하나)
                 조용한 제외 금지 · 임의 가격 금지 · 결과 보고 mapping 추가 금지
보존             accession · form · acceptance_datetime · instant · axis/member
                 · valuation_method · provenance
```

**`§4.1`의 10-Q 배제는 accounting factor 입력에만 적용된다.** ME용 shares는 stock-state
입력이라 10-Q 계열을 읽는다. 12월 결산이 아닌 발행사는 10-K에 12월 instant가 없다.

**coverage 영향**: 위 규칙으로 ME가 `MISSING`이 된 issuer-year는 **denominator에서 빠지지
않는다.** missing reason으로 세고 Gate C는 본구현 전수에서만 판정한다.

### 3.6 Gross Profit accounting mapping — 정찰 뒤 확정된 계약

정본은 로드맵 §4.2·§4.2.1이다. **여기서 다시 정하지 않고 Phase 0이 지켜야 할 형태로만
옮겨 적는다.** 정찰 기록은 `PROBE-gross-profit-mapping.md`다.

```text
canonical Revenue    consolidated total revenue
                     issuer-defined net sales · COGS 대응 좁은 revenue 사용 금지
canonical GP         consolidated total revenue - COGS   (연도마다 정의를 바꾸지 않는다)
direct GrossProfit   canonical source 아님. validation / diagnostic 전용
tie-out              같은 연결 손익계산서 context에서 exact equality. tolerance 없음
mismatch 처리        canonical을 무효로 만들지 않는다. diagnostic/audit 상태로 보존
fail-close           total revenue 또는 COGS 자체의 statement 의미가 ambiguous할 때
fact 선택            그 accession의 연결 손익계산서 role 안의
                     standard-taxonomy · 무차원 fact만
revenue 후보 1개      기존 unique-value 규칙. calculation 관계를 요구하지 않는다
revenue 후보 2개+     selected Statement role URI와 **exact equality**인 calculation role의
                     effective summation-item graph에서, eligible 후보 중 다른 모든 eligible
                     후보의 transitive ancestor인 후보가 정확히 하나일 때 그 보고된 standard
                     fact가 canonical total Revenue. 0개·2개 이상은 REVENUE_UNRESOLVED
custom intermediate  transitive path의 evidence로만 통과. canonical 승격·합산 금지
calculation source   standalone linkbase와 issuer XSD embedded calculationLink 둘 다
effective 관계        arcrole · role · order · weight · use · priority 보존.
                     equivalent 관계의 highest-priority prohibition/override 반영
arithmetic           canonical selection 조건 아님. mismatch가 concept를 바꾸지 않는다
금지 selector         totalLabel · presentation order · 값 크기 · concept 우선순위
                     · role 제목 유사도 · component 합산으로 Revenue 생성
role 불명            추측 금지. unresolved / missing
role 밖 fact         주석 · segment · geographic subtotal · 중단사업은 이름이 같아도 후보 아님
fy / fp / frame      statement 의미 추정에 쓰지 않는다
annual period        FilingSummary Statement role 중 target CIK · dimensionless · USD · end=DPE인
                     standard revenue-family fact가 연결된 role이 정확히 하나여야 함
                     그 role 안 eligible revenue fact의 unique longest-duration start
day cutoff           없음. 340~400 및 다른 fixed/분포 기반 threshold 금지
period fail-close    role missing/ambiguous · eligible standard revenue 없음
                     · longest duration의 서로 다른 start 동률
form / metadata      10-K · 10-K/A만. 10-KT 추가 금지
                     FilingSummary metadata conflict는 현재 parser 분류대로 fail-close
dimension-only COGS  MISSING. member 합산 · whitelist · issuer별 예외 · derived member 추정 금지
보존                 accession · form · acceptance_datetime · historical_usable_session
                     · statement role · concept · start · end · unit · value · 선택 경로
```

**Revenue 범위는 의도적인 선택이다.** membership fee나 금융자회사 revenue처럼 직접 대응
COGS가 없는 수익이 분자에 들어갈 수 있다는 것을 받아들인 결과다. 로드맵 §0.2가 근거로 든
Novy-Marx 계열의 `REVT − COGS`에 가까운 신호를 재현하기 위해서다. **결과를 보고 net-sales
정의로 되돌리지 않는다.**

**coverage 영향**: 위 규칙으로 GP가 `MISSING`이 된 issuer-year는 **denominator에서 빠지지
않는다.** missing reason으로 세고, Gate A·B는 본구현 전수에서만 판정한다. **정찰의 발행사별
숫자를 coverage 추정치로 쓰지 않는다.**

#### 3.6.1 calculation-root revenue freeze receipt — 2026-08-26

정찰 근거는 `PROBE-revenue-total-selection.md`이고 **이 문서에서 다시 정하지 않는다.**

```text
고정 표본            직전 annual-period probe의 원본 10-K 241 accession 재사용
분석 가능            228 (기존 annual role/context 계약으로 resolve된 것)
multi-candidate      17
single-candidate     211  (control)

Candidate 0  presentation ancestor      resolved 0 / ambiguous 17
Candidate A  exact-role calc root       resolved 17 · correct 17 · wrong 0
Candidate B  totalLabel                 correct 17
Candidate C  calc + totalLabel          correct 17
```

**B/C를 채택하지 않은 이유**는 `totalLabel`이 subtotal에도 정상적으로 쓰이기 때문이다.
Tesla FY2016은 같은 revenue section에서 custom **Total automotive revenue** subtotal과
standard **Total revenues** grand total에 **둘 다** `totalLabel`을 쓴다. C는 표본에서 A보다
wrong을 하나도 더 줄이지 못했다.

**Tesla FY2016(`0001564590-17-003118`)이 transitive custom intermediate의 정본 사례다.**

```text
presentation   SalesRevenueGoodsNet 과 Revenues 가 sibling  -> ancestor 규칙으로 ambiguous
calculation    Revenues -> (custom) SalesRevenueAutomotive -> SalesRevenueGoodsNet
결과            Revenue = 7,000,132,000  (Revenues), custom intermediate는 evidence only
```

**exact-role 제한이 실제로 필요하다.** 정찰에서 PFE·XOM 일부 revenue concept가 note/detail
calculation role에도 재사용되는 것을 확인했고, role을 느슨하게 잡으면 그 graph가 섞인다.

**arithmetic과 identity를 분리한다.** multi 17 중 direct arithmetic bind가 가능한 15건에서
exact raw Decimal 일치는 14건이었다(PFE 2건은 current annual dimensionless contributor 부족,
Tesla FY2018은 raw sum mismatch). 그럼에도 calculation-root total identity는 ground truth와
일치했다. **arithmetic mismatch는 canonical Revenue를 다른 concept로 바꾸는 근거가 아니다.**

**이 결정에 포함되지 않은 것**: `Total Assets`는 아래 3.7에서, Book Equity · preferred stock ·
deferred tax mapping은 아래 3.8에서 각각 따로 닫혔다. **COGS selector는 그대로 두며 이 규칙을
COGS에 확장하지 않는다.**

### 3.7 Total Assets accounting mapping — 정찰 뒤 확정된 계약

정본은 로드맵 §4.2·§4.2.2다. **여기서 다시 정하지 않고 Phase 0이 지켜야 할 형태로만
옮겨 적는다.** 정찰 기록은 `PROBE-total-assets-mapping.md`다.

```text
canonical concept   us-gaap:Assets
                    issuer custom 태그 · 이름 유사도 mapping · fallback hierarchy 금지
fact 선택            그 accession의 연결 대차대조표 Statement role 안의
                    무차원(dimensionless) fact만
role + 무차원        둘 다 필요하다. Statement role만으로는 부족
role 불명            추측 금지. unresolved / missing
role 밖 fact         Disclosure · 주석 · segment · guarantor · VIE · disposal은
                    개념이 us-gaap:Assets여도 후보 아님
period anchor       dei:DocumentPeriodEndDate            (canonical)
cross-check         qv_sec_filings.report_date           (불일치 -> MISSING / UNRESOLVED)
금지                 report_date 단독 canonical · accession 내 최신 instant 추정
                    · fy / fp / frame을 period-end source나 quality filter로 사용
validation          Assets == LiabilitiesAndStockholdersEquity, exact. tolerance 없음
  계산 가능 + exact      VALIDATED
  계산 가능 + mismatch   fail-close (TIEOUT_MISMATCH)
  계산 불가              TIEOUT_UNAVAILABLE / UNVERIFIED  (mismatch와 합치지 않는다)
fallback            금지 -> MISSING
                    AssetsCurrent + AssetsNoncurrent 및 component 합산 금지
dimension-only      금지 -> MISSING. member 합산 · whitelist · issuer별 예외
                    · parent/subsidiary/guarantor 조합 · elimination 계산 · derived 추정 금지
Total Assets <= 0   invalid (아래 3.3 그대로)
보존                accession · form · acceptance_datetime · historical_usable_session
                    · statement role · concept · instant · unit · value
                    · anchor 출처와 cross-check 결과 · tie-out 상태 · provenance
```

**`Statement` role과 무차원 조건은 둘 다 필요하다.** 정찰에서 결합 10-K의 Statement role
대차대조표 안에 co-registrant 자회사의 총자산이 함께 있는 사례를 찾았다. role만 걸면 그것이
후보로 들어온다.

**"tie-out 계산 불가"는 실패가 아니다.** mismatch와 다른 상태로 보존한다. 이 Phase의 freeze는
**상태 계약만** 고정하고, unavailable의 빈도와 coverage 해석은 본구현 전수에서 판정한다.

**coverage 영향**: 위 규칙으로 Total Assets가 `MISSING`이 된 issuer-year는 **denominator에서
빠지지 않는다.** missing reason으로 세고, Gate A·B는 본구현 전수에서만 판정한다. **정찰의
발행사별 숫자를 coverage 추정치로 쓰지 않는다.**

**이 결정에 포함되지 않은 것**: Book Equity · `StockholdersEquity` fallback · preferred stock ·
deferred tax mapping은 이 결정의 범위 밖이고 **아래 3.8에서 따로 닫혔다.** companyfacts
ingestion·presentation parser·raw XBRL parser·accounting schema 구현도 이 결정에 포함되지 않는다.

### 3.8 Book Equity accounting mapping — 정찰 뒤 확정된 계약

정본은 로드맵 §4.3·§4.3.1이다. **여기서 다시 정하지 않고 Phase 0이 지켜야 할 형태로만
옮겨 적는다.** 정찰 기록은 `PROBE-book-equity-mapping.md`다.

```text
canonical BE        Parent Stockholders' Equity - Preferred Stock
DT / ITC            이번 lineage에서 항상 0. "when available" 로 되돌리지 않는다
                    -> 문헌 원형에서 한 항을 제거한 의도적 축소 정의다 (아래 참고)
공통 context        formation까지 usable한 annual 10-K family filing (위 3.1)
                    -> 그 accession의 연결 대차대조표 role -> fiscal-end instant -> 무차원
period anchor       dei:DocumentPeriodEndDate (canonical)
                    qv_sec_filings.report_date (cross-check) · 불일치 -> MISSING / UNRESOLVED
금지                 report_date 단독 canonical · accession 내 최신 instant 추정
                    · fy / fp / frame 으로 period 추정 · 후속 filing 값의 과거 backfill

Parent SE 1순위      us-gaap:StockholdersEquity (direct)
Parent SE 2순위      StockholdersEquityIncluding...NCI - MinorityInterest
                    두 fact가 같은 accession · role · instant · unit · 무차원일 때만
                    MinorityInterest 부재를 NCI=0 으로 추정하지 않는다 -> MISSING
scope guard         redeemable NCI / temporary equity 증거가 있으면 2순위 fail-close
                    (PARENT_EQUITY_SCOPE_AMBIGUOUS)
금지 fallback        Assets - Liabilities · common equity + preferred · component 합산
                    · equity roll-forward ending balance · custom reconstruction
                    · 오늘 companyfacts 값 · issuer별 예외

preferred 순위       liquidation preference value -> par / carrying value
                    redemption tier 사용 안 함 · prose/manual 복원 금지
                    미래 filing의 liquidation 을 과거 accession 에 backfill 금지
preferred ZERO      SharesIssued == 0 · SharesOutstanding == 0
                    · 연결 대차대조표 role 에 PreferredStockValue 요소가 차원 포함해서도 부재
                      (numeric fact 가 아니라 표시 완결성에 기반한 inference 임을 명시)
preferred 예외       존재 판정에 한해 같은 role 의 차원 fact 존재 여부를 본다
                    값 합산 · member whitelist · elimination · derived total 은 금지
                    요소는 차원에만 있고 무차원 금액을 못 정하면 ZERO 가 아니라 PREF_UNRESOLVED
모순 증거            PreferredStockValue == 0 인데 SharesIssued > 0 이면 ZERO 아님 -> 위 순위 적용
진단                 인접 회계연도에서 tier 가 바뀌면 PREF_TIER_UNSTABLE 보존
                    값 변경 · fail-close · smoothing · carry-forward · tier 통일 금지

tie-out             SE(i) == Parent SE + MinorityInterest 를 raw XBRL decimals 로 판정
  hw(f)             = 10^(-decimals(f)) / 2 · decimals 없거나 "INF" 이면 0
  gap == 0                              VALIDATED
  0 < gap <= hw 합                       ROUNDING_COMPATIBLE   (VALIDATED 와 합치지 않는다)
  gap > hw 합                            TIEOUT_MISMATCH
  independent fact 하나라도 부재           TIEOUT_UNAVAILABLE
  금지                                   $1M · 백분율 · 0.1% · 0.5% · issuer별 tolerance
                                        · 관측을 본 뒤 문턱 조정
  direct parent 경로                     mismatch 여도 direct 값을 버리지 않는다 (진단)
  복원 경로                              같은 식으로 재검사하지 않는다. 가짜 VALIDATED 금지
                                        TIEOUT_UNAVAILABLE / PARENT_RECONSTRUCTED 로 명시하고
                                        그 자체로 복원을 무효화하지 않는다

statement scope     generic Statement role 로 충분하지 않다. 연결 대차대조표를 특정한다
                    equity roll-forward 도 Statement 다. role 종류만 보고 허용하지 않는다
                    role 특정 불가 -> MISSING / UNRESOLVED

최종                Parent SE 또는 Preferred 가 unresolved -> BE MISSING / UNRESOLVED
                    Preferred = ZERO 확정 -> BE = Parent SE
                    Book Equity <= 0 -> Value ranking 제외 (아래 3.3 그대로)
보존                accession · form · acceptance_datetime · historical_usable_session
                    · DocumentPeriodEndDate 와 report_date cross-check 결과 · statement role
                    · parent source path(DIRECT_PARENT_SE | INCLUDING_NCI_MINUS_NCI)
                    · concept · value · unit · dimension · raw decimals · validation 상태
                    · preferred 상태와 tier(LIQUIDATION | PAR_CARRYING | ZERO) · 선택 concept
                    · PREF_TIER_UNSTABLE · accounting_definition_version · missing 사유
```

**DT / ITC 제외는 의도적인 축소다.** 문헌 원형(Fama/French · Novy-Marx)에는
`+ Deferred Taxes / Investment Tax Credit when available` 항이 있고, **이번 lineage는 그 항을
뺀 다른 정의다.** 이것을 원형과 같다고 적지 않는다. 이유는 그 수량을 issuer-independent한
결정론적 규칙으로 복원할 수 없기 때문이다 — 표준 개념부터 DTA 차감·관할 netting 후 값이고,
custom 값은 환급채권이나 규제자산이 섞이며, 세금 라인이 아예 없는 발행사도 있고, 부분 가산은
서로 다른 BE 정의를 한 cross-section에 섞는다. **명확해 보이는 발행사만 골라 더하지 않고,
표준 태그가 있을 때만 더하지도 않으며, DT 결손으로 issuer-year를 MISSING으로 만들지도
않는다.** 언제나 `DT/ITC contribution = 0`이다.

**coverage 영향**: 위 규칙으로 Book Equity가 `MISSING`이 된 issuer-year는 **denominator에서
빠지지 않는다.** missing reason으로 세고, Gate A·B는 본구현 전수에서만 판정한다. **정찰의
발행사별 숫자를 coverage 추정치로 쓰지 않는다.**

**이 결정에 포함되지 않은 것**: companyfacts/raw XBRL ingestion · presentation parser ·
decimals 구간 계산 코드 · preferred parser · schema/DDL · 상태 enum 구현은 전부 open이다.

### 3.3 이미 고정돼 있어 여기서 손대지 않는 것

```text
Total Assets <= 0            invalid            (§4.2)
Gross Profit < 0             허용                (§4.2)
Book Equity <= 0             Value ranking 제외  (§4.3)
formation                    매년 6월 마지막 정규 거래일 종가 이후 (§4.1)
accounting 표본               fiscal period end가 t-1 안 · annual 10-K only (§4.1)
usable 경계                  acceptance 이후 첫 정규 거래일 (§3.2)
```

### 3.4 30건 수동 audit 표본 — 뽑는 규칙을 먼저 적는다

§6은 표본을 return 보기 전에 고정하고 split·대규모 buyback/issuance·multi-class를 의도적으로
포함하라고만 한다. **뽑는 절차 자체가 결정론적이 아니면 "마음에 드는 30개"가 된다.**

```text
seed              = 20260822 (고정)
층화              초기 / 중기 / 최근 3구간 × 각 10건
필수 포함          각 구간에 split >= 1, 대규모 share 변동 >= 1, multi-class >= 1
잔여              해당 구간 eligible issuer-year에서 seed 고정 셔플 후 순서대로
섹터              한 구간 안에서 같은 SIC 대분류 3건 초과 금지
기록              선정 목록과 그 SHA-256을 audit 실행 전에 커밋한다
```

---

## 4. 통과 조건 — 로드맵 §6 그대로

문턱을 옮기지 않는다.

```text
A. coverage_start 이후 aggregate joint QV coverage >= 85%
B. 어떤 formation year도 joint QV coverage < 75%가 아님
C. issuer market-equity reconstruction coverage >= 95%
D. 수동 audit 30 issuer-years에서 look-ahead 0건
E. 동일 fiscal-year를 서로 다른 filing으로 이중 사용 0건
F. split/share-class 때문에 명백한 market-cap 배수 오류 0건
G. 한 issuer를 여러 security로 중복 ranking/selection한 건 0건
H. source/version/provenance에서 factor 원자료까지 역추적 가능
```

`coverage_start`는 사람이 고르지 않는다(§6.1).

```text
coverage_start = joint QV coverage >= 85%인 formation year가
                 3년 연속 처음 나타나는 구간의 첫 formation year
```

**coverage denominator는 Q/V availability를 보기 전에 고정한다** — formation 시점 PIT S&P500
issuer 중 historical SIC로 non-financial 판정이 가능한 issuer다. Q나 V가 없다고 분모에서
사라지지 않는다. historical SIC 자체가 없으면 `classification_missing`으로 따로 센다.

coverage report는 aggregate만 내지 않고 **formation year · sector · identity-resolution path ·
missing reason · single/multi-class**로 분해한다.

### 4.1 look-ahead sentinel

```text
formation snapshot(t)을 baseline과 오염본에서 각각 계산하고
canonical serialization의 SHA-256이 exact match여야 한다
```

`t` 이후의 filing · share fact · price · membership만 오염시킨다. 경계는 acceptance 직전/직후,
10-K/A, split/reverse split, multi-class, membership 진입·이탈, formation 이후 가격 급변을
각각 포함한다.

**tolerance를 두지 않는다.** exact match가 안 되면 tolerance를 늘리지 말고 nondeterminism의
원인을 먼저 없앤다(§6.2).

---

## 5. 판정

|라벨|뜻|다음|
|---|---|---|
|`SIGNAL_STUDY_READY`|A~H 전부 통과|§6.4 봉인 후 Phase 1|
|`DATA_NOT_READY`|하나라도 실패|`quality-value` 보류 · 대안 source 없으면 다음 family|

**`DATA_NOT_READY`는 QV에 대한 증거가 아니다.** 수익률을 계산하지 않았으므로 실패 ledger에
`QV는 작동하지 않는다`류의 문장을 남기지 않는다(§14).

Phase 1로 넘어가기 직전 §6.4의 봉인 artifact에 `source_version` · `accounting_mapping_hash` ·
`identity_mapping_hash` · `coverage_start` · `final_historical_cut` ·
`last_completed_12m_cohort` · `random_seed_set`을 정확한 값으로 기록한다.

---

## 6. run card

`run-card.json` · `run-card.md`를 이 디렉터리에 둔다. historical run이므로
`formal_oos_status = NOT_FORMAL_OOS`이고, run range가 `2025-08-07` 이후를 건드리면
`legacy_holdout_status = CONTAMINATED_FOR_FORMAL_OOS`를 함께 남긴다.

```text
research_id = quality-value    phase = 0    hypothesis_status = testing
```

---

## 7. 진행

|단계|상태|
|---|---|
|**정찰 — ME source** (`PROBE-me-source.md`)|**`SEC_ROUTE_VIABLE`** (2026-08-22). raw XBRL instance 경로가 여섯 축을 전부 통과했고 API 경로는 기각됐다|
|1. identity 계층|**구현 완료** (2026-08-24). `schema.sql`의 QV 전용 세 테이블과 `qv_identity.py`, fixture·회귀 테스트가 정본이다|
|2. submissions ingestion|**`CLOSED / PASS`** (2026-08-24). `qv_sec_filings`와 `qv_submissions.py`, network-free fixture가 정본이다|
|3. companyfacts / accounting mapping|**진행 중.** mapping은 셋 다 **CLOSED / FROZEN**이고(위 3.6·3.7·3.8 · 로드맵 §4.2.1·§4.2.2·§4.3.1), **raw-XBRL parser와 accounting ingestion도 구현을 마쳤다**(아래 10). **아직 open**: production 전수 accounting ingest와 coverage audit은 실행하지 않았다|
|4. shares / ME 본구현|미착수|
|5. formation snapshot · sentinel · coverage|미착수|

정찰이 열어둔 빈칸 둘은 **로드맵 §4.4.1·§4.4.2로 확정됐다**(위 3.5). 10-Q 계열은 ME shares
source로 허용하고, 비상장 ordinary class는 `OBSERVED_MARKET_PRICE` / `CONVERSION_VALUE_PROXY` /
`MISSING` 셋 중 하나로만 처리한다.

## 8. identity 계층 구현 receipt — 2026-08-24

### 구현된 계약

- 내부 정본은 `issuer_id`이고 CIK는 10자리 SEC external identifier다. CIK를 PK로 쓰지 않는다.
- 기존 `securities`와 `data_sources` CHECK는 바꾸지 않았다. identity source는 기존
  `kind='securities'`로 등록하고 각 QV 행의 `source` · `source_version` · `provenance`를 보존한다.
- `qv_share_classes`의 구간은 `[effective_from, effective_to)`다. 같은 `class_id`의 비중첩 행으로
  ticker/XBRL member history를 표현하며, 같은 ticker의 서로 다른 issuer 재사용도 비중첩 구간으로
  분리한다.
- axis/member는 exact explicit mapping만 조회한다. derived/equivalent 이름 규칙이나 유사도 mapping은
  없다. 등록되지 않은 member는 `UnresolvedIdentityError`다.
- 같은 시점의 class · symbol · member 중복과 손상된 중복 조회는 하나를 고르지 않고 각각
  `QVIdentityError` / `AmbiguousIdentityError`로 fail-close한다.
- valuation은 `OBSERVED_MARKET_PRICE` · `CONVERSION_VALUE_PROXY` · `MISSING` 셋뿐이다. proxy는
  같은 issuer의 active listed ordinary reference class, 양수 fixed ratio, 원문 accession을 요구한다.
  관계 구간이 subject/reference class history 전체로 덮이지 않거나 현재 ratio를 과거에 소급하면
  등록할 수 없다. `MISSING`은 coverage용 사유를 반드시 가진다.
- 여러 listed security가 같은 issuer를 가리켜도 `resolve_symbols_to_issuers()` 결과에는 issuer가
  한 번만 나온다.

기간 중첩처럼 다른 행을 봐야 하는 불변식은 `qv_identity.py`의 등록 경로가 잠근다. 단일 행의 날짜,
CIK, method/ratio/accession/missing-reason 형태는 SQLite `CHECK`도 잠근다. DB를 외부에서 직접 오염해
중복 행을 만들더라도 조회 경로는 ambiguity로 멈춘다.

### 테스트

지정한 아홉 fixture는 모두 통과했다.

1. single-class issuer
2. Alphabet listed A/C + unlisted convertible B
3. Berkshire A/B가 가격 단위 차이와 무관하게 각자의 observed-price class를 유지
4. `EquivalentClassAMember` 미등록
5. ticker rename
6. old ticker reuse / issuer change
7. one issuer / multiple listed classes의 rank unit 1개
8. unknown member fail-close
9. conversion ratio effective-date 경계

추가로 active period/symbol/issuer 불변식, invalid conversion payload, 다른 issuer reference,
listed-class proxy 금지, 명시적 `MISSING`, 손상된 ambiguity, 기존 DB additive migration을 검사했다.

```text
python3 -m unittest trading.tests.test_qv_identity
  19 tests · PASS

python3 -m unittest discover -s trading/tests -p 'test_*.py'
  1,127 tests · PASS

npm test
  949 tests · PASS
```

### PIT source guard review fix — 2026-08-24

`_assert_identity_source()`가 이제 `kind='securities'`뿐 아니라 `point_in_time=1`과
`survivorship_biased=0`도 요구한다. non-PIT source와 survivorship-biased source가
`register_issuer()`에서 각각 거부되고 행을 남기지 않는 regression 두 개를 추가했다.

```text
QV identity focused  21 tests · PASS
trading 전체          1,129 tests · PASS
npm                   949 tests · PASS
```

기존 momentum `snapshot_id()` exact-match regression도 그대로 통과했다.

QV 테이블과 실제 fixture 행을 넣기 전후의 기존 `PointInTimeSnapshot.snapshot_id()`는 exact match였다.
기존 DB fixture의 `securities` 행도 보존됐고 당시 새 QV identity 표 셋은 빈 상태로 생성됐다. 따라서 frozen momentum
snapshot 입력, `RULE_FIELDS`, core/policy와 `features_daily`에는 영향이 없다.

### 새로 발견된 unresolved / ambiguous 사례

실제 전수 identity ingest는 이번 단계에 포함하지 않았으므로 **새로 발견된 실제 발행사 사례는 없다.**
fixture에서는 미등록 derived/unknown member와 손상된 동일시점 ticker 중복이 각각 unresolved/ambiguous로
멈추는 것을 확인했다. issuer-level effective history, 한 CIK의 의미상 issuer 분기, 비고정 conversion,
현재 schema로 구분할 수 없는 ticker reuse 사례가 실제 submissions ingest에서 나오면 규칙을 추가하지
않고 별도 설계 확장 대상으로 보고한다.

### 이번 단계에서 하지 않은 것

submissions/raw XBRL/shares ingestion, 12월 instant 선택, accounting mapping, class별 ME 합산,
formation snapshot, coverage/`coverage_start`/Gate C, factor·portfolio·수익률 계산은 전부 미착수다.
`CIK_OVERRIDES`도 옮기거나 수정하지 않았다. 후속 submissions ingestion도 CIK를 issuer로 승격하지
않고 raw SEC registrant layer로 분리했다.

## 9. submissions ingestion receipt — 2026-08-24

### 구현된 계약

- `qv_sec_filings`의 PK는 `(cik, accession, source_version)`이다. CIK는 10자리 target
  registrant이고 `issuer_id` FK는 없다. 동일 accession의 multi-registrant row를 서로 다른 CIK로
  보존할 수 있다.
- SEC `filings.recent`와 `filings.files` archive를 모두 읽고 `10-K` · `10-K/A` · `10-Q` ·
  `10-Q/A`만 저장한다. required column과 존재하는 optional column의 길이가 다르면 filter 전에
  fail-close한다.
- `acceptanceDateTime`은 고정 폭 UTC `YYYY-MM-DDTHH:MM:SS.ffffffZ`로 보존하고,
  `zoneinfo.ZoneInfo('America/New_York')`로 `acceptance_eastern_date`를 따로 파생한다. 동일 Eastern
  calendar date는 사용할 수 없고, 지정한 source/version의 SPY 세션 중 그 날짜보다 엄격히 뒤인
  첫 세션만 `historical_usable_session`이 된다. 이 `>` 경계는 ingestion과 SQLite `CHECK` 양쪽에
  있다. acceptance가 없거나 calendar coverage 뒤면 NULL이며 filed date fallback은 없다.
- complete submission의 `FILER` 아래 `COMPANY DATA`만 읽는다. target CIK의 distinct bracket SIC가
  하나면 `EXACT`, 없으면 `MISSING`, 둘 이상이면 `AMBIGUOUS`다. current submissions top-level SIC와
  `securities.sector`는 읽지 않는다.
- `historical_sic()`은 formation까지 usable한 row를 `acceptance_datetime DESC, accession DESC`로
  하나만 고른다. 그 row가 MISSING/AMBIGUOUS면 오래된 EXACT로 fallback하지 않는다. 10-Q 계열도
  historical classification의 최신 filing 후보에 포함된다.
- 같은 `(cik, accession, source_version)` 재적재는 UPDATE/REPLACE하지 않고 전체 insert를
  거부한다. 각 row는 recent/archive filename, complete submission URL, target CIK, calendar와
  source/version을 deterministic provenance로 남긴다. `data_sources` schema와 kind는 바꾸지 않았다.
- `store.connect()`는 바로 전 ca801b0의 `qv_sec_filings` DDL만 정확히 식별해 transaction 안에서
  현재 표로 rebuild한다. 기존 row의 UTC acceptance는 같은 `America/New_York` 변환으로 Eastern
  date를 채우고, row에 저장된 calendar source/version의 첫 다음 SPY 세션을 다시 계산한다. 기존
  `source_version`·provenance·`ingested_at`은 그대로 보존하며, acceptance 누락과 calendar coverage
  끝은 NULL로 남는다. fresh/current DB는 no-op이고 알려지지 않은 표 형태는 추정하지 않고 거부한다.

### 실제 SEC read-only smoke

AAPL `CIK0000320193` 한 건으로 unit test와 분리해 실행했다. recent에서 허용 form 45개,
`CIK0000320193-submissions-001.json`에서 87개를 같은 parser가 읽었고, 최근 accession
`0000320193-26-000020`의 complete submission에서 target-CIK SIC `3571`을 `EXACT`로 찾았다.

API acceptance `2026-07-31T10:01:02.000Z`와 complete submission header의
`20260731060102`는 시각 표기가 달랐지만 이 **특정 표본에서는** UTC와 Eastern calendar date가
모두 `2026-07-31`이었다. 이 smoke는 UTC/Eastern rollover 사례를 검증하지 않았다. rollover 계약은
겨울 `2024-01-10T01:30Z → 2024-01-09 EST`와 여름 DST fixture를 `America/New_York` 변환으로
검증한다. smoke는 unit test의 네트워크 의존성이 아니다.

### 검증

아래는 이번 구현 뒤 로컬에서 실제 실행한 결과다. GitHub CI 결과가 아니다.

```text
python3 -m unittest \
  trading.tests.test_qv_submissions.QVSecFilingsMigrationTest
  3 tests · PASS

python3 -m unittest trading.tests.test_qv_submissions
  48 tests · PASS

python3 -m unittest trading.tests.test_qv_identity
  21 tests · PASS

python3 -m unittest discover -s trading/tests -p 'test_*.py'
  1,177 tests · PASS

npm test
  949 tests · PASS
```

filing row 삽입 전후 기존 `PointInTimeSnapshot.snapshot_id()`는 exact match였다. 기존
`securities` column, `features_daily`, `RULE_FIELDS`, `paper-core-v1`과 momentum-v2 코어·정책
파일은 수정하지 않았다.

### 새로 발견된 unresolved / ambiguous 사례와 범위 밖

live smoke의 단일 target CIK에서는 unresolved/ambiguous SIC가 발견되지 않았다. fixture의 target
CIK missing·distinct SIC ambiguity는 값을 추정하지 않고 상태로 남았다. 실제 전수 ingest는 아직
실행하지 않았으므로 전체 SEC history의 unresolved/ambiguous 사례가 없다고 말할 근거는 없다.

companyfacts/accounting tag mapping, raw XBRL shares, issuer ME, formation snapshot, coverage와
Gate A~H, factor·portfolio·수익률 계산은 전부 하지 않았다. 다음 단계는 **companyfacts ingestion +
accounting tag mapping audit**다.

## 10. Step 3 accounting ingestion 구현 receipt — 2026-08-25

> **상태: accounting parser/ingestion implementation complete;
> production population ingest / coverage audit not yet run.**
> S&P500 전수 accounting ingest를 실행하지 않았고 Gate A~H를 판정하지 않았다.
> 수익률·QV rank·B/M·coverage를 0번 계산했다.

기준 commit은 `cc70cb42d417b920c7221d4ad995a36b92c4c61e`(Book Equity 계약 동결)이다.

### 구현된 모듈

|파일|책임|
|---|---|
|`trading/backtest/qv_xbrl.py`|**DB를 모르는 순수 파서.** instance·presentation linkbase·FilingSummary를 XML root/content로 판정하고 fact·context·presentation graph·report로만 바꾼다. QName은 prefix가 아니라 **namespace URI + local name**이다|
|`trading/backtest/qv_accounting.py`|동결 계약 적용 · `qv_accounting_filings` 적재 · PIT filing selector · `preferred_tier_transitions` 파생 helper|
|`trading/backtest/edgar.py`|`accession_dir_url` · `accession_index` · `accession_file_bytes` **셋만** 추가. 기존 `text()`의 latin-1 의미는 그대로다|
|`trading/backtest/schema.sql`|`qv_accounting_filings` 한 표 추가|

### 책임 경계

```text
raw SEC accession XBRL   accounting source of truth
qv_sec_filings           filing / PIT source of truth
qv_accounting_filings    canonical 값 + 그 값을 만든 selected fact provenance만
```

**generic XBRL warehouse를 만들지 않았다** — `xbrl_facts`·`xbrl_contexts`·`xbrl_dimensions`·
`xbrl_presentation_edges` 같은 표가 없고 raw XML 본문을 DB에 넣지 않는다. companyfacts를
canonical accounting source로 쓰지 않는다.

### statement role 선택

`FilingSummary`가 **선언한** report 종류로 statement와 non-statement를 먼저 가른다.
최근 filing은 `MenuCategory == "Statements"`, `MenuCategory`가 없는 초기 XBRL filing은
`LongName`의 `{sort} - {kind} - {title}` 중 kind를 쓴다. **제목 유사도를 쓰지 않는다.**

```text
연결 대차대조표 role  = statement report 중 그 presentation role이
                       target CIK · DPE instant · 무차원 us-gaap:Assets fact의 개념을 담은 것
연결 손익계산서 role  = statement report 중 그 role이
                       target CIK · 연간 duration · 무차원 revenue-family fact의 개념을 담은 것
후보 0개 -> UNRESOLVED_STATEMENT_ROLE · 2개 이상 -> AMBIGUOUS_STATEMENT_ROLE (임의 선택 없음)
```

### 계약 준수

```text
Gross Profit   canonical = total revenue - COGS. direct us-gaap:GrossProfit은 diagnostic only
               tolerance 없음 · mismatch여도 canonical reconstruction 유지
               revenue/COGS는 presentation 구조의 total로만 고르고 component 합산 금지
Total Assets   canonical = us-gaap:Assets · Assets == LiabilitiesAndStockholdersEquity exact
               mismatch -> fail-close · unavailable은 mismatch가 아님 · fallback 없음
Book Equity    = Parent SE - Preferred · DT/ITC contribution은 언제나 0
               direct StockholdersEquity 우선 · 없으면 IncludingNCI - MinorityInterest
               redeemable NCI / temporary equity 증거가 있으면 fallback fail-close
               preferred는 liquidation -> par/carrying · ZERO는 shares 0 또는 요소 부재 추론
               존재 판정에만 차원 fact를 보고 값 합산은 금지
NCI tie-out    raw XBRL decimals에서 파생한 반폭. decimals 없거나 INF면 exact 요구
               direct 경로 mismatch는 진단 · 복원 경로는 순환 검증하지 않고 PARENT_RECONSTRUCTED
period anchor  dei:DocumentPeriodEndDate canonical · report_date는 cross-check
               불일치 -> PERIOD_CROSSCHECK_MISMATCH -> canonical outputs fail-close
```

금액은 전부 `Decimal`이고 DB에는 **REAL이 아니라 lossless decimal 문자열**로 넣는다.

### 검증 — 실제 실행 결과

```text
python3 -m unittest trading.tests.test_qv_xbrl trading.tests.test_qv_accounting
  93 tests · PASS
python3 -m unittest trading.tests.test_qv_submissions trading.tests.test_qv_identity
  69 tests · PASS
python3 -m unittest discover -s trading/tests -p 'test_*.py'
  1,270 tests · PASS
npm test
  949 tests · PASS
```

**unit test는 전부 network-free다.** fixture는 `trading/tests/fixtures/qv_xbrl/`의 빌더가
만든 작은 XML이고 실제 filing을 복사하지 않았다.

기존 `test_qv_identity`의 "기존 DB에 QV 표가 비어 생긴다" 회귀에서 기대 표 집합에
`qv_accounting_filings`를 더했다. 그 테스트의 불변식(모두 존재하고 모두 0행)은 그대로다.

### 실제 SEC read-only smoke — unit test와 별개다

임시 경로에서 4개 probe anchor로 실행했다. production DB에 넣지 않았고 수익률·coverage를
계산하지 않았다.

|anchor|결과|
|---|---|
|**COST** `0000909832-19-000019`|revenue `152,703,000,000` · COGS `132,886,000,000` · **GP `19,817,000,000`** · **주석 role의 `GrossProfit` 16,465는 canonical에도 diagnostic에도 들어오지 않았다** · Assets `45,400,000,000` VALIDATED · BE `15,243,000,000`|
|**CAT** `0000018230-26-000008`|revenue `67,589,000,000` · **COGS `44,752,000,000`(`CostOfRevenue`)** — **세그먼트 주석의 `CostOfGoodsAndServicesSold` 49,000,000은 배제됐다** · GP `22,837,000,000` · parent SE는 direct가 없어 `INCLUDING_NCI_MINUS_NCI`로 `21,318,000,000`|
|**NEE** `0000753308-26-000015`|**Assets `212,721,000,000`** — **co-registrant FPL의 `105,158,000,000`이 들어오지 않았다** · tie-out VALIDATED · parent SE `54,608,000,000` DIRECT · NCI tie-out VALIDATED · BE `54,608,000,000`. revenue는 아래 review fix로 `27,412,000,000`이 됐다|
|**TSLA** `0001564590-17-003118`|대차대조표 role에서 parent SE `4,752,911,000` DIRECT · Assets `22,664,076,000` VALIDATED. **equity roll-forward의 `IncludingNCI` 5,905,125,000은 canonical 후보가 되지 않았다.** revenue/COGS는 아래 구조 한계로 `AMBIGUOUS`|

### smoke가 드러낸 것 — 사용자 결정이 필요한 둘

**둘 다 조용히 우회하지 않고 명시 상태로 남겼다.**

1. **presentation의 total은 보통 components의 *형제*다.** Tesla FY2016 손익계산서는
   `RevenuesAbstract` 아래에 components와 `Revenues`(총계)를 **같은 레벨**로 두고
   `order`로만 마지막에 놓는다. 계약 §13.1 규칙 2(“하나가 다른 후보들의 presentation
   조상”)가 성립하지 않아 규칙 3대로 `REVENUE_UNRESOLVED`가 된다. **총계 식별에 계산
   linkbase를 쓸지, `order`를 쓸지는 새 구조 규칙이라 여기서 정하지 않았다.**
2. **utility 표준 revenue 개념이 목록에 없다.** NEE 손익계산서는
   `us-gaap:RegulatedAndUnregulatedOperatingRevenue` `27,412,000,000`을 쓰는데 정찰이
   문서화한 revenue 계열에 없어 income-statement role이 `UNRESOLVED_STATEMENT_ROLE`이었다.
   **아래 review fix에서 사용자 승인으로 이 표준 개념을 revenue family에 넣어 해소됐다.**

### 이번 단계에서 하지 않은 것

```text
production S&P500 전수 accounting ingest        미실행
coverage_start · Gate A~H 판정                  하지 않음
shares / ME / B-M / GPA / QV rank / portfolio   미구현
returns · run-card 결과                          0회
PAPER/LIVE DB 변경                               없음
data_sources.kind CHECK 확장                     하지 않음 (새 fundamentals kind 없음)
store.py 변경                                    없음 (additive CREATE TABLE로 충분)
```

---

## 10.1 review fix receipt — 2026-08-25

`0bc9dfc32c3c081137fdf2c5fe0ab0a442a23ce7` 리뷰에서 나온 여덟 가지를 고쳤다. **경제적 회계
계약을 다시 열지 않았고**, Tesla sibling-total 문제도 이번에 결정하지 않았다.

|#|고친 것|
|---|---|
|1|**QName을 URI+local로 완전히 정규화했다.** concept뿐 아니라 **dimension axis·member·typed axis·unit measure**까지 그 요소 시점의 namespace 선언으로 푼다. 모르는 prefix는 raw 문자열로 남기지 않고 `namespace=None`인 명시적 unresolved다. USD 판정도 `iso4217:USD` 문자열 비교가 아니라 **ISO4217 namespace URI + `USD`** 의미 비교다|
|2|**exact duplicate 계약을 잠갔다.** dedupe 조건에 concept·entity·기간·dimension·**semantic unit measure**·값·**`decimals`**를 모두 넣었다. 값이 같아도 `decimals`가 다르면 `AMBIGUOUS`다 — 첫 번째를 골라 NCI tolerance를 계산하지 않는다. 같은 측정단위를 다른 unit id로 선언한 것은 여전히 exact duplicate다|
|3|**ambiguous validation 입력을 unavailable로 rescue하지 않는다.** `LiabilitiesAndStockholdersEquity`가 `AMBIGUOUS`면 `TIEOUT_INPUT_AMBIGUOUS` + `assets_status=UNRESOLVED` + `diagnostics.assets=LSE_AMBIGUOUS`다. MISSING일 때만 `TIEOUT_UNAVAILABLE`로 Assets를 유지한다|
|4|**preferred hierarchy에서 `AMBIGUOUS`와 `MISSING`을 분리했다.** liquidation이 모호하면 par로 내려가지 않고 `PREF_UNRESOLVED`, par가 모호하면 ZERO로 내려가지 않는다|
|5|**explicit zero-share evidence가 zero monetary fact보다 우선한다.** `SharesIssued == 0` + `PreferredStockValue == 0`은 `PAR_CARRYING`이 아니라 `ZERO`다. zero share와 nonzero amount가 함께면 contradiction, zero share와 positive share가 함께여도 contradiction이다. **차원 fact는 존재 evidence로만 보고 합산하지 않는다**|
|6|**`PREF_TIER_UNSTABLE`은 실제 인접 회계연도만이다.** `2018 -> 2020`처럼 중간 연도가 비면 transition이 아니다|
|7|**`us-gaap:RegulatedAndUnregulatedOperatingRevenue`를 revenue family에 넣었다.** 표준 US-GAAP 개념이고 정의상 total operating revenues다. **issuer 예외나 NEE whitelist가 아니다**|
|8|**DPE mapping failure 때문에 older filing으로 물러나지 않는다.** 이전에는 `fiscal_period_end IS NOT NULL`이 SQL 앞에 있어 DPE가 안 풀린 최신 10-K/A가 후보에서 사라지고 older original이 선택될 수 있었다. 이제 **같은 회계연도 후보로 남기기 위해서만** `report_date`를 guard로 본다. **canonical fiscal-period-end는 여전히 `dei:DocumentPeriodEndDate` 하나이고 `report_date`로 채우지 않는다**|

### 검증 — 실제 실행 결과

```text
python3 -m unittest trading.tests.test_qv_xbrl trading.tests.test_qv_accounting
  112 tests · PASS
python3 -m unittest trading.tests.test_qv_submissions trading.tests.test_qv_identity
  69 tests · PASS
python3 -m unittest discover -s trading/tests -p 'test_*.py'
  1,289 tests · PASS
npm test
  949 tests · PASS
```

### 실제 SEC read-only smoke 재실행

|anchor|결과|
|---|---|
|**COST**|변화 없음. GP `19,817,000,000` · 주석 `GrossProfit` 여전히 배제|
|**CAT**|변화 없음. COGS `44,752,000,000` · 세그먼트 `49,000,000` 여전히 배제 · GP `22,837,000,000`|
|**NEE**|**income role과 revenue가 resolve됐다** — `27,412,000,000`. Assets `212,721,000,000`으로 co-registrant 여전히 배제. COGS는 유틸리티 손익계산서에 표준 COGS 개념이 없어 `MISSING`이고 이는 계약대로다|
|**TSLA**|**의도적으로 그대로 `REVENUE_UNRESOLVED`다.** sibling-total 문제는 이번 fix에서 건드리지 않았다. Assets `22,664,076,000` VALIDATED · parent SE `4,752,911,000` DIRECT · equity roll-forward 여전히 배제|

**production 전수 accounting ingest와 coverage audit은 여전히 실행하지 않았다.**
수익률·QV rank·B/M·coverage를 0번 계산했다.

---

## 10.2 mechanical correctness fix receipt — 2026-08-25

`630bf85fa595014a9047ef06a6287be228dae8be` 리뷰의 네 가지를 고쳤다. **경제적 회계 정의를
바꾸지 않았고**, Tesla sibling-total과 NEE COGS도 이번에 손대지 않았다. schema·roadmap·
`store.py`·`qv_identity.py`·`qv_submissions.py`·`edgar.py`는 변경하지 않았다.

|#|고친 것|
|---|---|
|A|**ambiguous direct Parent SE는 fallback하지 않는다.** 전에는 `direct is not None`만 봐서 direct tier가 `AMBIGUOUS`인데도 `IncludingNCI − NCI`로 내려갈 수 있었다. 이제 **`MISSING`일 때만** fallback이고, 모호하면 `parent_se_status=AMBIGUOUS` · `parent_se_path=NULL` · `diagnostics.parent_se=DIRECT_PARENT_SE_AMBIGUOUS`로 fail-close한다|
|B|**preferred ZERO가 ambiguity와 positive evidence를 삼키지 않는다.** zero-share 분기를 tier ambiguity 검사 **뒤로** 옮겼다. liquidation/par가 모호하면 ZERO로도 하위 tier로도 내려가지 않는다. contradiction 판정의 positive monetary evidence에 **같은 role·target CIK·DPE의 차원 fact 양수 금액**을 포함한다 — 존재/모순 판정에만 쓰고 **합산하지 않는다**|
|C|**NCI tie-out의 ambiguous 입력을 unavailable로 부르지 않는다.** `IncludingNCI`나 `MinorityInterest`가 `AMBIGUOUS`면 `TIEOUT_INPUT_AMBIGUOUS`다. 실제 부재만 `TIEOUT_UNAVAILABLE`이다. direct 경로에서 tie-out은 진단이므로 **canonical direct parent 값은 그대로 유지한다**|
|D|**QName-valued child를 child 자신의 namespace scope로 푼다.** 전에는 context/unit의 end 시점 scope로 descendant를 해석해 **child-local `xmlns:` 선언을 놓쳤다.** 이제 `explicitMember` · `typedMember` · `measure`의 in-scope 선언을 walk 중에 따로 모아 그 요소의 scope로 resolve한다|

### 새 regression

```text
FIX A  ambiguous direct parent(값 다름)가 fallback되지 않음
       ambiguous direct parent(decimals 다름)도 동일
FIX B  zero shares + ambiguous liquidation -> PREF_UNRESOLVED (ZERO 금지)
       zero shares + 차원 양수 PreferredStockValue -> contradiction (ZERO·합산 금지)
FIX C  ambiguous IncludingNCI -> TIEOUT_INPUT_AMBIGUOUS, direct parent 값 유지
FIX D  child-local xmlns의 explicitMember axis/member resolve
       child-local xmlns의 unit measure -> is_usd True
       child-local xmlns의 typedMember axis resolve
```

### 검증 — 실제 로컬 실행 결과 (이 저장소에 GitHub CI는 없다)

```text
python3 -m unittest trading.tests.test_qv_xbrl trading.tests.test_qv_accounting
  120 tests · PASS
python3 -m unittest trading.tests.test_qv_submissions trading.tests.test_qv_identity
  69 tests · PASS
python3 -m unittest discover -s trading/tests -p 'test_*.py'
  1,297 tests · PASS
npm test
  949 tests · PASS
```

### 실제 SEC read-only smoke 재실행 — 네 anchor 모두 기대대로

```text
COST  revenue 152,703,000,000 · COGS 132,886,000,000 · GP 19,817,000,000 · 주석 GP 배제 유지
CAT   COGS 44,752,000,000 (세그먼트 49,000,000 배제 유지) · GP 22,837,000,000
NEE   revenue 27,412,000,000 resolve 유지 · Assets 212,721,000,000 (co-registrant 배제 유지)
      COGS 는 MISSING 이고 이번에 utility COGS를 새로 만들지 않았다
TSLA  Assets 22,664,076,000 · direct parent SE 4,752,911,000 · roll-forward 배제 유지
      revenue 는 sibling-total 때문에 여전히 REVENUE_UNRESOLVED 이고 이번에 바꾸지 않았다
```

### CLOSED / FROZEN — annual duration context

`340~400일`은 canonical accounting 의미가 아니었다. 근거를 실제로 찾아보면 이렇다.

```text
로드맵 §4.1        "annual 10-K"     — 일수 범위 없음
README §3.3        "annual 10-K only" — 일수 범위 없음
PROBE-gross-profit-mapping.md §2   "duration 340~400일"
                                   -> 정찰 **임시 추출 스크립트의 필터**로만 기록돼 있다
```

즉 이 cutoff는 **어떤 CLOSED/FROZEN 계약에서도 유래하지 않았고, probe의 scratch 추출
규칙이 구현으로 넘어온 것**이다. 이를 닫기 위해
`PROBE-annual-period-mapping.md`에서 heterogeneous 30 issuer의 원본 `10-K` 241건과 별도
transition stress `10-KT` 3건, 총 244 accession을 조사했다.

```text
판정: Candidate B — statement-revenue structural longest-duration / CLOSED / FROZEN
```

canonical annual start는 현재 parser가 Statement로 인정한 role 중 target CIK · dimensionless ·
USD · `end == DocumentPeriodEndDate`인 standard US-GAAP revenue-family duration fact가 연결된
role이 정확히 하나일 때만, 그 role 안 eligible fact의 **unique longest-duration start**로 고른다.
고정 day cutoff는 없고 role missing/ambiguity, eligible standard revenue 부재, longest-start
동률은 fail-close한다.

이 period selector와 그 period 안의 consolidated Revenue structural-total selector는 별개다.
따라서 Tesla sibling-total은 해결하지 않는다. `10-KT`는 production 허용 form에 추가하지 않고,
2021 FilingSummary metadata conflict도 LongName fallback 없이 현재 parser semantics대로
fail-close한다. 결과를 보고 threshold·issuer/year 예외·custom revenue rescue를 추가하지 않는다.

---

## 10.3 preferred hierarchy precedence fix receipt — 2026-08-26

`f3e9248978b6a56ff43d1bb36a0644cc071bc95e` 리뷰의 tier precedence 한 곳만 고쳤다.
liquidation이 `RESOLVED`면 lower-tier par/carrying ambiguity가 그 값을 무효화하지 않는다.
liquidation이 `MISSING`일 때만 par/carrying 상태를 검사하고, liquidation 자체가
`AMBIGUOUS`면 계속 fallback 없이 `PREF_UNRESOLVED`다. zero-share와 positive preferred
evidence의 contradiction 및 dimension fact의 existence-only 계약도 그대로다.

```text
resolved liquidation 3,738,000,000 + par 0(decimals -6/-3)
  -> RESOLVED / LIQUIDATION / 3,738,000,000
liquidation MISSING + par 0(decimals -6/-3)
  -> PREF_UNRESOLVED, ZERO fallback 없음
liquidation 100/200 conflict + par 10
  -> PREF_UNRESOLVED, par fallback 없음
zero shares + positive resolved liquidation
  -> contradiction / PREF_UNRESOLVED, ZERO 금지
```

로컬 실제 실행 결과는 accounting/XBRL 122 PASS, submissions/identity 69 PASS, trading 전체
1,299 PASS, npm 949 PASS다. SEC smoke는 accounting 의미와 source assumption을 바꾸지 않아
재실행하지 않았다. production ingest · coverage · rank · B/M · returns는 전부 0회다.
340~400 annual-period heuristic · Tesla sibling-total · NEE COGS는 변경하지 않았다.

---

## 10.4 structural annual-duration implementation receipt — 2026-08-26

docs freeze는 `b9358e1e1ac05acfb1737852b58962eb443f39de`이고, Phase 2 implementation은
**이 receipt를 포함한 바로 다음 implementation commit**이다(git history와 완료 보고 SHA가
정본). `ACCOUNTING_DEFINITION_VERSION`은 `qv-accounting-v2`로 올렸고
`ACCOUNTING_CONTRACT_COMMIT`은 위 docs freeze SHA를 가리킨다. 기존 v1 row를 update/replace하지
않았고 schema도 바꾸지 않았다.

production selector에서 `MIN_ANNUAL_DAYS=340` · `MAX_ANNUAL_DAYS=400`을 제거했다. 이제
FilingSummary가 현재 parser 계약상 Statement로 인정한 role 중 eligible standard revenue fact가
연결된 role이 정확히 하나일 때, 그 role 안 fact의 unique longest-duration start를 annual
start로 쓴다. target CIK · dimensionless · USD · `end=DPE` · parse 가능한 양의 duration만
eligible이고 fixed day threshold는 없다. role missing/ambiguity, eligible revenue 부재,
longest-start 동률은 fail-close한다.

### network-free regression — 실제 로컬 실행

```text
ORCL same-DPE unrelated note pollution 배제
52-week 363일 · 53-week 370일 선택
10-K unit fixture의 274일 period 선택 (10-KT 허용 의미 아님)
annual + quarterly revenue 중 longest 선택
longest distinct-start tie -> ANNUAL_PERIOD_AMBIGUOUS
eligible revenue가 있는 Statement role 둘 -> AMBIGUOUS_STATEMENT_ROLE
standard revenue 없음 -> unresolved
target CIK · dimensionless · USD와 valid positive duration 조건
LongName=Statement + MenuCategory=Uncategorized conflict -> fail-close 유지
Tesla sibling revenue total -> period/role 선택 뒤에도 REVENUE_AMBIGUOUS 유지

python3 -m unittest trading.tests.test_qv_xbrl trading.tests.test_qv_accounting
  134 tests · PASS
python3 -m unittest trading.tests.test_qv_submissions trading.tests.test_qv_identity
  69 tests · PASS
python3 -m unittest discover -s trading/tests -p 'test_*.py'
  1,311 tests · PASS
npm test
  949 tests · PASS
```

위 숫자는 이 implementation에서 실제 로컬로 실행한 결과다. GitHub CI가 독립 재현했다는
뜻이 아니다.

### 실제 SEC read-only smoke — production DB 미사용

|anchor|결과|
|---|---|
|**ORCL FY2020** `0001564590-20-030125`|annual start `2019-06-01`; same-DPE unrelated note context 때문에 ambiguity가 생기지 않음; revenue `39,068,000,000` RESOLVED|
|**CAT** `0000018230-26-000008`|annual start `2025-01-01`; COGS `44,752,000,000`, GP `22,837,000,000`; note/segment contamination 배제 유지|
|**COST** `0000909832-19-000019`|363일 annual start `2018-09-03`; GP `19,817,000,000`; note GrossProfit 배제 유지|
|**TSLA FY2016** `0001564590-17-003118`|income role과 annual period 선택 성공; sibling-total은 의도대로 `REVENUE_AMBIGUOUS`; Assets `22,664,076,000`, parent SE `4,752,911,000` 유지|
|**NEE** `0000753308-26-000015`|annual start `2025-01-01`; revenue `27,412,000,000` RESOLVED; COGS는 계약대로 `MISSING`; Assets `212,721,000,000` 유지|

FilingSummary 2021 metadata conflict는 LongName fallback 없이 계속 fail-close하고, 허용 form은
`10-K` · `10-K/A`뿐이다. `10-KT`, Tesla sibling-total, NEE utility COGS는 추가하지 않았다.
production accounting ingest · coverage · rank · B/M · returns는 전부 0회다.

---

## 10.5 accounting definition write provenance fix — 2026-08-26

`ingest_accounting()`은 이제 caller가 넘긴 `accounting_definition_version`이 현재 구현 상수
`qv-accounting-v2`와 정확히 같을 때만 새 row를 만든다. 빈 문자열 거부도 유지한다. 따라서 v2
계산을 `qv-accounting-v1`이나 unknown/future label로 저장할 수 없고, 정상 row의 definition
version과 `bundle_provenance.contract_commit=b9358e1e1ac05acfb1737852b58962eb443f39de`가
모순되지 않는다.

read 경로인 `accounting_for_formation()`은 바꾸지 않았다. network-free로 수동 seed한 v1 row를
`accounting_definition_version="qv-accounting-v1"`로 명시 조회할 수 있음을 회귀로 잠갔다.

```text
XBRL + accounting  137 PASS
submissions + identity  69 PASS
trading 전체  1,314 PASS
npm  949 PASS
```

모두 실제 로컬 실행 결과이며 GitHub CI 독립 재현을 뜻하지 않는다. SEC smoke는 extraction
semantics/source handling을 바꾸지 않아 재실행하지 않았다. schema 변경과 production ingest ·
coverage · rank · B/M · returns 실행은 전부 0회다.

---

## 10.6 calculation-root revenue implementation receipt — 2026-08-26

docs freeze는 `5936298bc1a3aa7971f97c032b564b8f8294ae01`이고 **implementation SHA는 git
history가 정본**이다. 계약 정본은 로드맵 §4.2.1과 위 §3.6·§3.6.1이다.

```text
ACCOUNTING_DEFINITION_VERSION = qv-accounting-v3
ACCOUNTING_CONTRACT_COMMIT    = 5936298bc1a3aa7971f97c032b564b8f8294ae01
```

**v1/v2 row를 다시 쓰지 않았다.** write는 `qv-accounting-v3`만 허용하고, historical read는
`accounting_for_formation(..., accounting_definition_version="qv-accounting-v1"/"v2")`로 그대로
가능하다. **schema는 바꾸지 않았다** — `calculation_arcs`·`calculation_roles`·`taxonomy_network`
같은 표를 만들지 않았고 raw calculation 원문도 DB에 넣지 않는다.

### 구현

- `qv_xbrl.py`에 `CalculationArc` · `CalculationRole` · `CalculationDocument` ·
  `parse_calculation()` · `looks_like_calculation()`을 additive로 추가했다. locator fragment는
  기존 원칙대로 `QName(namespace URI, local)`로 풀고 unresolved는 조용히 문자열로 쓰지 않는다.
- **effective relationship**: raw `calculationArc` 존재를 세지 않는다. `role` · `arcrole` ·
  `order` · `weight` · `use` · `priority`를 보존하고, equivalent 관계(= exempt인 `use`/
  `priority`를 뺀 나머지가 같은 관계)에서 **highest-priority prohibition**이 있으면 그 관계를
  graph에서 제외한다. `order`가 다르면 equivalent가 아니라는 것도 회귀로 잠갔다.
- **source discovery**: standalone linkbase와 issuer XSD embedded `calculationLink`를 둘 다
  읽는다. accession 후보에 `.xsd`를 포함하고 **파일 내용/root로 판정**한다. generic DTS
  engine을 만들지 않았다.
- `qv_accounting.py`에는 Revenue 전용 `_revenue_total()`만 추가했다. **COGS selector는 기존
  `_structural_total()` 그대로**이고 이 규칙을 COGS로 확장하지 않았다. result/provenance
  schema도 넓히지 않았고 `selection_reason`만 새 의미를 담는다.

### 새 regression

```text
parser   standalone / XSD-embedded · ordinary summation-item · transitive custom intermediate
         prohibition · priority override · order 차이는 non-equivalent · 비-summation arcrole
         unresolved locator는 source evidence 아님 · role URI 보존 · 순환 · calculationLink 부재
accounting  A transitive custom intermediate(Tesla 모양)   B direct two-candidate root
            C calculation role 없음 -> unresolved          D role URI mismatch -> unresolved
            E multiple/zero root -> unresolved             F 값이 같아도 root가 identity
            G arithmetic mismatch가 selector를 안 바꿈      H contributor 부족해도 합산 안 함
            I single candidate는 calculation 불필요        J note role graph 무시
            embedded XSD calculation · prohibited root arc · bundle에 calc file hash 보존
            presentation ancestor는 더 이상 Revenue selector가 아님(COGS는 유지)
```

### 검증 — 로컬 실제 실행 (이 저장소에 GitHub CI는 없다)

```text
python3 -m unittest trading.tests.test_qv_xbrl trading.tests.test_qv_accounting
  163 tests · PASS
python3 -m unittest trading.tests.test_qv_submissions trading.tests.test_qv_identity
  69 tests · PASS
python3 -m unittest discover -s trading/tests -p 'test_*.py'
  1,340 tests · PASS
npm test
  949 tests · PASS
```

### 실제 SEC read-only smoke (production DB 미사용)

|accession|revenue|선택 경로|
|---|---|---|
|**TSLA FY2016** `0001564590-17-003118`|**7,000,132,000** (`Revenues`)|**calculation-root** — custom `SalesRevenueAutomotive`를 거친 transitive|
|**TSLA FY2018** `0001564590-19-003165`|**21,461,268,000** (`Revenues`)|calculation-root. **raw 합 mismatch가 concept를 바꾸지 않았다**|
|**PFE FY2023** `0000078003-24-000039`|**58,496,000,000** (`Revenues`)|calculation-root. v2에서는 `REVENUE_AMBIGUOUS`였다|
|**WMT FY2026** `0000104169-26-000055`|**713,163,000,000** (`Revenues`)|calculation-root. 좁은 net sales 706,413이 아니라 **consolidated total**|
|**XOM FY2025** `0000034088-26-000045`|332,238,000,000|single candidate (control)|
|**COST FY2019** `0000909832-19-000019`|152,703,000,000|single candidate. GP 19,817,000,000 유지|
|**NEE FY2025** `0000753308-26-000015`|27,412,000,000|single candidate. **COGS는 여전히 `MISSING`**|
|**CAT FY2025** `0000018230-26-000008`|67,589,000,000|single candidate. GP 22,837,000,000 유지|

**component 합산으로 Revenue를 만든 경우는 0건이다.**

**변하지 않은 것**: NEE COGS `MISSING` · FilingSummary metadata conflict fail-close ·
annual duration structural selector · COST 주석 GP 배제 · CAT 세그먼트 COGS 배제 ·
NEE co-registrant Assets 배제 · Total Assets tie-out · Parent SE fallback/ambiguity ·
preferred hierarchy/ZERO · NCI tie-out. **PFE FY2023의 `assets AMBIGUOUS`는 v2에서도 같았고
이번 변경과 무관하다**(직접 대조 확인).

**production 전수 accounting ingest · coverage Gate · QV rank · B/M · 수익률은 0회다.**

---

## 10.7 calculation effective-network mechanical fix — 2026-08-26

`b67c98e39a62c7affa54a17f5ad06ddf0e12c093`의 mechanical correctness fix다. **Revenue 경제
정의와 selector 설계를 다시 열지 않았고** `qv-accounting-v3` ·
`ACCOUNTING_CONTRACT_COMMIT = 5936298bc1a3aa7971f97c032b564b8f8294ae01`도 그대로다.
schema·roadmap·COGS selector·annual period는 변경하지 않았다.

|#|고친 것|
|---|---|
|A|**같은 exact role의 arc는 DTS 범위에서 하나의 base-set network다.** 전에는 `calculation_role()`이 첫 문서의 role을 즉시 돌려줘서, 같은 role arc가 standalone linkbase와 issuer XSD embedded `calculationLink`에 나뉘면 나머지를 버렸다. 이제 accession 안의 모든 문서에서 그 role의 arc를 모아 **prohibition·override·transitive reachability를 merged set에서** 계산한다. 파일 순서 precedence나 standalone/XSD tier를 만들지 않는다|
|B|**effective relationship 속성을 typed semantic 값으로 비교한다.** `order` 누락은 schema default `Decimal("1")`, `weight`는 required non-zero Decimal, `priority` 누락은 `0`, `use` 누락은 `optional`이다. `order="1"`과 `order="1.0"`은 같은 값이다. **float를 쓰지 않는다**|
|—|**malformed는 fail-close다.** 잘못된 `order`·`weight`·`priority`·`use`를 기본값으로 조용히 바꾸지 않고 `malformed`로 남기며, 그 `(parent, child)` 관계 전체를 effective network에서 제외한다. malformed prohibition이 사라져 관계가 되살아나는 fail-open도 막는다|

### 새 regression

```text
parser   order 누락 == semantic 1 · "1" vs "1.0" decimal 동치 · malformed priority/use/order
         missing weight · zero weight · malformed가 같은 pair를 fail-close
         malformed가 다른 pair를 오염시키지 않음
         merge: 문서 분할 transitive · 문서 분할 prohibition · 다른 role merge 거부 · 빈 merge
accounting  A1 문서 둘로 나뉜 transitive path -> Revenue resolve
            A2 문서 둘로 나뉜 prohibition -> 관계 소멸 -> unresolved
            A3 두 번째 문서의 다른 role은 섞이지 않음
            selected role의 malformed arc -> multi-candidate Revenue fail-close
```

### 검증 — 로컬 실제 실행 (이 저장소에 GitHub CI는 없다)

```text
python3 -m unittest trading.tests.test_qv_xbrl trading.tests.test_qv_accounting
  180 tests · PASS
python3 -m unittest trading.tests.test_qv_submissions trading.tests.test_qv_identity
  69 tests · PASS
python3 -m unittest discover -s trading/tests -p 'test_*.py'
  1,357 tests · PASS
npm test
  949 tests · PASS
```

### 실제 SEC read-only smoke — `b67c98e`와 결과가 동일하다

```text
TSLA FY2016   7,000,132,000  calculation-root      TSLA FY2018  21,461,268,000  calculation-root
PFE  FY2023  58,496,000,000  calculation-root      WMT  FY2026 713,163,000,000  calculation-root
XOM  FY2025 332,238,000,000  single candidate      COST FY2019 152,703,000,000  single candidate
NEE  FY2025  27,412,000,000  single candidate      CAT  FY2025  67,589,000,000  single candidate
```

**NEE COGS는 계속 `MISSING`이다.** production DB를 쓰지 않았고 전수 ingest · coverage Gate ·
QV rank · B/M · 수익률은 0회다.

---

## 10.8 Step 4 shares/ME 구현 receipt — 2026-08-30

**구현 정본은 `docs/trading/strategies/qv-step4-shares-me-design.md`다.** 여기에는
무엇이 얼어붙었고 무엇이 대체됐는지만 적는다. **수익률을 계산하지 않았고 Gate 판정도
하지 않았다.**

### 얼어붙은 것

| 계약 | 자리 |
|---|---|
| identity manifest bundle(4파일)과 `identity_source_version` | 설계 §1 · `trading/qv/identity/` · `qv_manifest.py` |
| economic class와 XBRL/prose alias 분리 | 설계 §1.4 · `qv_share_class_*_aliases` |
| REQUIRED 증거 최대값에서 파생하는 `usable_from_session` | 설계 §1.2 · `qv_identity_evidence` |
| D0 dimension 계약과 accession 안 중복 병합 | 설계 §4 · `qv_shares.py` |
| 탐색 coverage와 class 효과의 분리 | 설계 §5 · `qv_share_basis_*` |
| share-side 전환일과 상장 market boundary 분리 | 설계 §6 · `qv_boundary.py` |
| **P2 same-regime selector** | 설계 §7 · `qv_selector.py` · `qv_class_share_resolutions` |
| 법적 전환 관계와 formation valuation 분리 | 설계 §8·§10 · 두 개의 표 |
| **C3 continuity bracket** | 설계 §9 · `qv_conversion.assess_continuity` |
| class/issuer ME(Decimal) | 설계 §11 · `qv_class_market_equity` · `qv_issuer_market_equity` |

### 대체된 것

- **로드맵 §4.4.1의 단순 December selector**는 P2 same-regime selector로 대체됐다.
- **`qv_share_classes`의 `xbrl_axis`/`xbrl_member`**는 제거됐고 alias 표가 유일한
  semantic 소스다.
- **`qv_class_valuation`은 RETIRED다.** 이름을 새 의미로 재사용하지 않았다.

**probe 파일은 다시 쓰지 않았다.** 초기 결론이 대체된 자리는 설계 문서 §14가 가리킨다.

### migration

기존 `backtest.db`를 지우지 않는다. 알려진 legacy 스키마를 정확히 탐지하고, 영향 표가
**전부 비어 있을 때만** 원자적으로 재구축한다. 행이 하나라도 있으면 `BacktestStorageError`로
멈추고 아무것도 바꾸지 않는다. 알 수 없는 스키마도 fail-close다.
`bars_daily` 등 무관한 데이터는 보존된다.

### 검증

```text
python3 -m unittest tests.test_qv_step4          -> 83 tests OK
python3 -m unittest tests.test_qv_identity       -> 21 tests OK
python3 -m unittest discover -s tests -p "test_*.py" -> 1440 tests OK
```

fixture는 전부 network-free다. split fixture 하나가 **P2가 막으려는 10배 ME 오류**를
재현하고 그것이 실제로 막히는지 확인한다.

### 아직 하지 않은 것

- manifest는 원문으로 확인한 anchor(UA · CMCSA · NKE · GOOGL)만 담는다. 나머지 발행사
  등록은 **코드 변경이 아니라 증거 입력**이다.
- 사건 탐색·boundary·C3의 **실제 SEC 문서 수집 파이프라인**은 이번 범위 밖이다.
  계약과 판정 함수만 구현했고 입력은 호출자가 준다.
- **Gate C/F/H는 판정하지 않았다.** Step 4는 그 gate가 쓸 상태 필드를 노출할 뿐이다.

---

## 10.9 Step 4 correctness fix receipt — 2026-08-30

**정본은 그대로 `docs/trading/strategies/qv-step4-shares-me-design.md`다.** 이번 수정은
얼어붙은 fail-close 계약을 코드가 실제로 강제하도록 고친 것이고 **semantic 결정을 새로
열지 않았다.** 수익률·랭킹·Gate는 여전히 계산하지 않는다.

| # | 고친 것 | 계약 |
|---|---|---|
| 1 | 형제가 긍정으로 지목됐다는 이유로 `NO_SHARE_BASIS_EFFECT_CONFIRMED`를 주던 것 | 명시 부정 진술이 있을 때만. 없으면 `UNRESOLVED` (설계 §5.4) |
| 2 | 빈 amendment 목록에서 continuity `CONFIRMED`가 나오던 것 | 명시 `COMPLETE` 탐색 receipt를 요구 (설계 §9) |
| 3 | class 해석 실패한 fresh A가 선택기 시야에서 사라져 B로 내려가던 것 | 구조적 A 존재를 class 해석 **전에** 판정 (설계 §7) |
| 4 | `formation 이전 마지막 split`을 묵시적으로 고르던 것 | 후보 단일 또는 SEC trading 정확 일치일 때만. 그 밖에는 `UNRESOLVED` (설계 §6) |
| 5 | metadata만으로 탐색 `COMPLETE`가 되던 것 | 문서 처리 증명 필수. 저장 경계가 강제 (설계 §5.1) |
| 6 | issuer 매핑만 구조화 증거가 면제되던 것 | 같은 증거·파생 usability·PIT 조회 (설계 §1.2) |
| 7 | 전환 관계의 usability가 호출자 인자였고 reference PIT를 안 보던 것 | 증거에서 파생 · reference도 formation까지 usable해야 함 (설계 §8·§10) |

**스키마 변화 셋** — `qv_issuers.usable_from_session` ·
`qv_share_basis_searches.processed_accessions`/`failed_accessions` ·
`qv_class_valuation_resolutions.amendment_searched_accessions`. 전부 Step-4에서 새로
생긴 표이거나 비어 있는 표라, 기존 known-schema 정책 그대로 **비어 있을 때만** 원자적으로
다시 만들고 행이 있으면 `BacktestStorageError`로 멈춘다. `bars_daily`는 보존된다.

### 검증

```text
python3 -m unittest tests.test_qv_step4 tests.test_qv_identity  -> 129 tests OK
python3 -m unittest discover -s tests -p "test_*.py"            -> 1465 tests OK
```

일곱 실패 계열이 전부 regression으로 잠겼고, BRK 2010과 Visa 2015의 **실제 공시 문구**가
명시 부정 증거의 두 문법 형태를 각각 시험한다.

---

## 10.10 P2 same-regime interval fix receipt — 2026-08-31

**정본은 그대로 `docs/trading/strategies/qv-step4-shares-me-design.md`다.**
P2를 다시 열지 않았고 새 휴리스틱·tolerance·tuning knob을 넣지 않았다.

**버그는 시간 구간을 방향에 따라 다르게 다룬 것이다.** P2가 견주는 것은 후보 filing
basis anchor의 regime과 December D의 regime인데, 구현이 한쪽 방향만 가정했다.

| 층 | 증상 |
|---|---|
| 탐색 | `lo = anchor`, `hi = D`로 고정. 결산 이후 filing(`anchor > D`)에서 구간이 뒤집혀 필수 accession 범위가 **비고**, D와 anchor 사이 공시를 하나도 읽지 않은 채 `COMPLETE`가 났다 |
| 선택기 | `D < transition <= anchor`만 봤다. 결산 **이전** filing(`anchor < D`)에서 `anchor < transition <= D`인 확인된 전환이 잡히지 않아 후보가 `SAME_REGIME`으로 통과했다 |

**수정은 두 끝점에서 구간을 정규화하는 것 하나다.**

```text
low  = min(anchor acceptance_eastern_date, D)
high = max(anchor acceptance_eastern_date, D)
비교 구간 = (low, high]
```

`qv_events.normalized_interval()` 하나를 탐색(`compute_search_coverage` ·
`required_accessions`)과 선택기(`_regime_for_accession`)가 **함께** 쓰므로 두 층이
어긋날 수 없다. closure G·amendment 비폐쇄·처리 증명·A/B tier·fallback·비율 정규화
금지는 전부 그대로다.

### 검증

새 regression을 수정 **전** 코드에 돌려 세 실패를 직접 확인했다.

```text
SAME_REGIME != DIFFERENT_REGIME        (anchor < D 전환을 못 잡음)
COMPLETE != INCOMPLETE                 (뒤집힌 구간에서 빈 범위로 COMPLETE)
() != ('0001234567-21-000001',)        (필수 accession 범위가 비어 있음)
```

```text
python3 -m unittest tests.test_qv_step4 tests.test_qv_identity  -> 136 tests OK
python3 -m unittest discover -s tests -p "test_*.py"            -> 1472 tests OK
```

기존 테스트는 하나도 약화하지 않았다. **Gate C는 여전히 판정하지 않는다.**

---

## 10.11 P2 normalized-interval propagation fix receipt — 2026-08-31

10.10이 정규화 구간을 도입했지만 **production 문서 처리 경로가 그것을 추출 층까지
전파하지 않았다.** `run_share_basis_search()`가 `extract_candidates()`에 정규화되지 않은
방향값(`interval_lo=anchor`, `interval_hi=D`)을 그대로 넘겼다.

`anchor > D`인 일반적인 결산 이후 filing에서 구간이 뒤집힌다.

```text
D                 = 2020-12-31
anchor acceptance = 2021-02-10
split effective   = 2021-01-15      -- CLOSED 비교 구간 안이다

넘겨진 값          interval_lo=2021-02-10, interval_hi=2020-12-31
_dispose 판정      EXCLUDED_OUT_OF_WINDOW
```

**탐색 층은 필요한 10-K를 올바로 읽어오는데 추출 층이 그 사건을 조용히 버렸다.**

수정은 `run_share_basis_search()`에서 기존 `normalized_interval()`로 `low`/`high`를
구해 모든 `extract_candidates()` 호출에 넘기는 것 하나다. **두 번째 정규화 구현을
만들지 않았다.** closure G · 필수 accession 범위 · proposal/재공시 규칙 · class 효과
semantics · A/B tier · selector fallback · 비율 정규화 금지는 전부 그대로다.
스키마 변경 없음.

### 검증

새 end-to-end regression을 수정 **전** 코드에 돌려 실패를 직접 확인했다.

```text
AssertionError: 'EXCLUDED_OUT_OF_WINDOW' != 'CURRENT_EVENT'
```

```text
python3 -m unittest tests.test_qv_step4 tests.test_qv_identity  -> 138 tests OK
python3 -m unittest discover -s tests -p "test_*.py"            -> 1474 tests OK
```

기존 `anchor < D` production-search 테스트는 그대로 남아 있고, 구간 **밖** 사건이
여전히 `EXCLUDED_OUT_OF_WINDOW`인지도 함께 잠갔다. **Gate C는 판정하지 않는다.**

---

## 10.12 Step 5A-1 inventory receipt — 2026-08-31 (초판, **무효**) / 2026-08-31 (**pre-fix**) / 2026-09-01 정정판

> **아래 2026-08-31 정정판의 `897`은 economic-identity 수요의 정본이 아니다.**
> 그때는 `universe_membership.symbol`을 그대로 economic 심볼로 썼고, 그 심볼 중 일부는
> 벤더 계열 코드(`TFCFA`·`MON_OLD`·`SUN1`…)다. **사실 receipt로 보존하되
> pre-fix/noncanonical로 표시한다.** 정본은 10.12b다. 손으로 고치지 않았다.

**정본은 `docs/trading/strategies/qv-step5-phase0-materialization-design.md`다.**
읽기 전용이고 manifest를 바꾸지 않았으며 어떤 gate도 판정하지 않았다.

### 초판이 왜 무효인가 — 순환 의존

초판 구현은 스스로를 "PIT identity coverage inventory"라 부르고
`class.usable_from_session` · `issuer.usable_from_session`을 평가했다.
**그런데 그 값들은 REQUIRED 증거가 materialize된 뒤에야 존재하고, 그 materialization은
5A-3의 일이다.** 실행 순서가 `5A-1 → 5A-2 → 5A-3`이므로 5A-1이 materialize된 PIT
usability에 기대는 것은 순환이다.

실제 실행이 그것을 그대로 드러냈다.

```text
9,525 security 행 · 898 DB-unresolved 심볼 · resolved = 0
사유 분포: NO_CLASS_SEGMENT_FOR_SYMBOL 9,525 (100%)
```

**이 출력은 두 가지를 구분하지 못한다.**

```text
A. 요청한 manifest에 그 종목의 매핑이 정말 없다
B. 요청한 manifest가 애초에 DB에 materialize된 적이 없다
```

당시 스크래치 DB는 B였다. 따라서 **초판 수치는 진단 기록일 뿐 static 매핑 수요의
정본이 아니다.** 초판 receipt가 유도했던 `892`(manifest 심볼을 DB 기반 미해결 수에서
손으로 뺀 값)도 **정본이 아니다** — 아래 정정판이 독립적으로 산출한 값은 다르다.

### 정정판 — static explicit mapping coverage demand

5A-1을 실제 목적으로 좁혔다. **manifest 내용에서 직접** 읽고
`usable_from_session` · `qv_identity_evidence` · `qv_sec_filings`를 보지 않는다.
materialize된 QV identity 표가 **비어 있어도** 돌아간다.

상태 어휘도 production PIT resolution과 섞이지 않게 바꿨다 —
`MAPPED` / `UNMAPPED` / `AMBIGUOUS_MAPPING`.

#### 사용한 명시 source version

```text
index_name              SP500
universe                announcements / eodhd-15y-2026-08
calendar                eodhd / eodhd-15y-2026-08        (참조 심볼 SPY)
identity bundle         qv-identity-sha256:55ed78d0b33bb5f85ccf14e81a5a7d8e6bcbe82d17812e46470b3b133372e6ec
materialized qv_share_classes rows   0   (5A-1의 전제가 아니다)
```

production `data/backtest.db`는 열지 않았다. 실제 `universe_membership`과 `SPY` 달력만
스크래치 사본으로 두고 읽었다.

#### 결과 — formation별 (구성원이 있는 해만)

| formation | session | members | MAPPED | UNMAPPED | AMBIGUOUS | issuers | multi-security issuers |
|---|---|---|---|---|---|---|---|
| 2008 | 2008-06-30 | 494 | 0 | 494 | 0 | 0 | 0 |
| 2009 | 2009-06-30 | 498 | 0 | 498 | 0 | 0 | 0 |
| 2010 | 2010-06-30 | 498 | 1 | 497 | 0 | 1 | 0 |
| 2011 | 2011-06-30 | 496 | 1 | 495 | 0 | 1 | 0 |
| 2012 | 2012-06-29 | 497 | 1 | 496 | 0 | 1 | 0 |
| 2013 | 2013-06-28 | 497 | 1 | 496 | 0 | 1 | 0 |
| 2014 | 2014-06-30 | 498 | 1 | 497 | 0 | 1 | 0 |
| 2015 | 2015-06-30 | 501 | 1 | 500 | 0 | 1 | 0 |
| 2016 | 2016-06-30 | 504 | 5 | 499 | 0 | 4 | 1 |
| 2017 | 2017-06-30 | 505 | 6 | 499 | 0 | 4 | 2 |
| 2018 | 2018-06-29 | 506 | 6 | 500 | 0 | 4 | 2 |
| 2019 | 2019-06-28 | 506 | 6 | 500 | 0 | 4 | 2 |
| 2020 | 2020-06-30 | 505 | 6 | 499 | 0 | 4 | 2 |
| 2021 | 2021-06-30 | 505 | 6 | 499 | 0 | 4 | 2 |
| 2022 | 2022-06-30 | 503 | 4 | 499 | 0 | 3 | 1 |
| 2023 | 2023-06-30 | 503 | 4 | 499 | 0 | 3 | 1 |
| 2024 | 2024-06-28 | 503 | 4 | 499 | 0 | 3 | 1 |
| 2025 | 2025-06-30 | 503 | 4 | 499 | 0 | 3 | 1 |
| 2026 | 2026-06-30 | 503 | 4 | 499 | 0 | 3 | 1 |

`2006`·`2007`은 달력에 6월 세션이 있으나 universe가 2008-01-02부터라 구성원이 0이다.
formation이 6월 30일이 아닌 해(2012·2013·2018·2019·2024)는 그 달의 **마지막 정규
세션**이 맞다.

```text
security 행 총계               9,525
MAPPED 행                        61
5A-2 mapping demand (고유 심볼)  897
AMBIGUOUS_MAPPING                 0
사유 분포   NO_CLASS_MAPPING_FOR_SYMBOL 9,442
            CLASS_NOT_ACTIVE_AT_FORMATION  22
            MAPPED                         61
MAPPED 심볼  CMCSA · GOOG · GOOGL · NKE · UA · UAA
```

**`897`은 이번 inventory가 직접 산출한 값이다.** 초판이 유도했던 `892`와 다르고,
그 차이가 정확히 손으로 빼는 방식이 왜 정본이 될 수 없는지를 보여준다.

> **pre-fix.** 이 `897`은 **저장된 심볼**의 고유 수다. `TFCFA`를 `FOXA`와 다른 경제적
> 심볼로 세고 있었고, 5A-2가 그 값을 SEC 티커로 던지게 되어 있었다. 10.12b가 정본이다.

#### 이 숫자가 재는 것과 재지 않는 것

- **재는 것**: 선택된 manifest bundle 안의 **static 매핑 coverage/수요**.
  anchor 매핑이 자기 class 구간이 활성인 formation에서 `MAPPED`로 나타난다
  (NKE 2010~, CMCSA·GOOGL·GOOG 2016~, UAA·UA 2016~2021).
- **재지 않는 것**: **historical PIT identity usability**. `usable_from_session`은
  5A-3이 REQUIRED 증거를 materialize한 뒤에 생기고, **그때 `MAPPED`였던 것 중 일부가
  그 formation에서 여전히 쓸 수 없을 수 있다.**
- `AMBIGUOUS_MAPPING = 0`은 지금 manifest가 작아서 나온 값이지 계약이 안전하다는
  증거가 아니다.

**Gate A~H와 Phase 0는 여전히 평가되지 않았다.** 수익률·B/M·Q/V·랭킹·선택·
`coverage_start`를 계산하지 않았다.

## 10.13 Step 5A-2a/b pilot receipt — 2026-08-31 (**pre-fix**) / 2026-09-01 (**pre-fix**)

> **아래 두 실행의 대상은 `universe_membership`에 저장된 심볼이다.** 그중 일부는 벤더
> 계열 코드이고, 여기서 `FOXA`는 2019 이후 episode만 가리킨다. 실행 사실로 보존하되
> **수요 `897`의 해석과 대상 정의는 pre-fix/noncanonical이다.** 정본은 10.13b다.
> 이 절의 숫자를 손으로 고치지 않았다.

**정본은 `docs/trading/strategies/qv-step5-phase0-materialization-design.md`의
5A-2 절이다.** 이 실행은 **production manifest를 바꾸지 않았다** —
`trading/qv/identity/*.jsonl`은 읽지도 쓰지도 않았고 자동 승격도 없다.
어떤 Phase 0 gate도 판정하지 않았다.

**5A-2는 아직 끝나지 않았다.** 이 receipt는 5A-2a/b 구현의 pilot 실행 사실만 적는다.

### 무엇을 확인하려던 실행인가

수요 897개를 다 돌리는 것이 목적이 아니다. **상태 어휘(`AUTO_PROVABLE` /
`REVIEW_REQUIRED` / `UNRESOLVED`)가 실제 filing에서 옳게 갈리는지**를 보려고 5A-1
수요에서 서로 다른 모양 다섯 개를 골랐다.

```text
inventory     5A-1 산출물 (qv-identity-sha256:55ed78d0...372e6ec)
대상          AAPL  post-2019 단일 class
              FOXA  다중 class 발행사
              CELG  2019 이전 표지 · 이후 피인수
              LEH   CIK/재편 복잡 (CIK_OVERRIDES 고정)
              ABMD  폐지 구성원
```

**대상 다섯은 초판과 정정판이 같다.** 아래 두 절이 초판(pre-fix) 실행이고 그 다음이
정정판이다.

### 초판 결과 — **pre-fix. 아래 정정판이 정본이다.**

```text
AUTO_PROVABLE=0  REVIEW_REQUIRED=4  UNRESOLVED=1
SEC 호출 31
```

| symbol | status | proof accession | 제안 class | reason codes |
|---|---|---|---|---|
| AAPL | REVIEW_REQUIRED | 0000320193-26-000013 | 1 | CLASS_INTERVAL_NOT_EXPLICIT · DEMANDED_CLASS_NOT_PROVED_ORDINARY_COMMON · SIBLING_CLASS_CENSUS_UNCLEAR |
| FOXA | REVIEW_REQUIRED | 0001628280-26-033172 | 2 | CLASS_INTERVAL_NOT_EXPLICIT |
| CELG | REVIEW_REQUIRED | 0000816284-19-000031 | 1 | CLASS_INTERVAL_NOT_EXPLICIT · PRE_INLINE_XBRL_NO_EXPLICIT_BRIDGE · SYMBOL_NOT_ON_COVER_PAGE |
| LEH | REVIEW_REQUIRED | (없음) | 0 | DISCOVERY_ONLY_NO_SEC_PROOF · NO_COVER_PAGE_PROOF_DOCUMENT |
| ABMD | UNRESOLVED | (없음) | 0 | NO_DISCOVERY_CANDIDATE · NO_COVER_PAGE_PROOF_DOCUMENT |

### `AUTO_PROVABLE=0`은 실패가 아니다

**표지는 class의 유효구간을 증명하지 않는다.** 5A-2b는 `effective_from` ·
`effective_to`를 추론하지 않기로 계약했으므로, 표지만 읽은 제안에는 언제나
`CLASS_INTERVAL_NOT_EXPLICIT`가 붙는다. 구간 증거는 5A-2c에서 사람이 붙인다.

FOXA가 그 경계를 그대로 보여준다 — 표지가 증명한 것은 전부 깨끗했고
(`CLASS_CENSUS_COMPLETE`, Class A/FOXA · Class B/FOX 둘 다 `ORDINARY_COMMON_LISTED`),
**남은 유일한 이유가 구간이다.** 구간 증거가 들어오면 이 packet은 `AUTO_PROVABLE`이
된다. 네트워크 없는 테스트가 stub 구간 증거로 그 전이를 잠근다.

### 실행이 실제로 잡아낸 것 셋

1. **발행사 확장 member namespace.** Apple 표지의 class member가
   `http://www.apple.com/20260328` 확장이라 `qname_key`에 target CIK를 넘기지 않으면
   그 자리에서 멈춘다. 실행 전에는 합성 fixture가 전부 `us-gaap` member라 안 보였다.
   회귀 테스트를 넣었다.
2. **AAPL은 단일 class인데도 census가 깨끗하지 않다.** 표지가
   `EntityCommonStockSharesOutstanding`은 **차원 없는** context에, 12(b) 제목·심볼은
   **class 축** context에 싣는다. 그래서 요구된 class(`CommonStockMember`, AAPL)에
   주식수 fact가 없다. 이름으로 이었으면 조용히 통과했을 자리다 —
   `DEMANDED_CLASS_NOT_PROVED_ORDINARY_COMMON`로 막았다.
   같은 표지의 notes 여섯 줄은 `REGISTERED_NOT_PROVED_COMMON`으로 남아 class 제안이
   되지 않지만 packet의 질문으로는 남는다.
3. **2019 표지 XBRL 의무화 이전 filing의 서명.** CELG의 2019-03-31 10-Q에는 제목·심볼
   fact 칸 자체가 없다. "심볼이 없다"와 "심볼 칸이 없다"를 같은 이유로 적으면 검토자가
   틀린 곳을 본다 — `PRE_INLINE_XBRL_NO_EXPLICIT_BRIDGE`를 따로 붙인다.

### 초판이 왜 pre-fix인가 — 리뷰 지적 셋

1. **static 증거와 PIT 가용성을 섞었다.** 초판은 요구 formation 이후에 수리된 제출을
   증명에서 제외했다. **Step 4의 CLOSED 계약은 나중 문서가 더 오래된 상태를 증명할 수
   있다는 것이고,** 그 증거를 과거에 쓸 수 있었는지는 5A-3의 `usable_from_session`이
   가른다. 5A-2에 두 번째 look-ahead 규칙을 둘 자리가 아니었다.
2. **3층 발견이 어휘로만 있었다.** `HISTORICAL_NAME_LOOKUP` · `PREDECESSOR_HINT`가
   상수로만 있고 실행 경로에 배선되지 않아, ABMD의 `NO_DISCOVERY_CANDIDATE`가 증거
   공백이 아니라 **5A-2a의 한계**를 함께 반영하고 있었다.
3. **5A-1 provenance를 잘라 썼다.** `identity_source_version`과 파일 경로만 들고
   `index_name` · universe · calendar source/version을 버렸다.

### 정정판 — 2026-09-01

```text
inventory     5A-1 산출물 (변경 없음)
index_name             SP500
universe               announcements / eodhd-15y-2026-08
calendar               eodhd / eodhd-15y-2026-08
identity bundle        qv-identity-sha256:55ed78d0...372e6ec
discovery hints        이름: trading/universe/sp500-changes.csv (security 칸)
                       구간: universe_membership (위 source/version)
대상          AAPL · FOXA · CELG · LEH · ABMD (초판과 같다)
SEC 호출      49   (초판 31 — 3층 이름 색인 40MB와 후보 제출 조회가 늘었다)
```

```text
AUTO_PROVABLE=0  REVIEW_REQUIRED=5  UNRESOLVED=0
발견 출처 분포  CURRENT_TICKER_FILE 2 · EXISTING_CIK_OVERRIDE 2 · HISTORICAL_NAME_LOOKUP 1
```

| symbol | status | 발견 출처 | proof accession | 제안 class | reason codes |
|---|---|---|---|---|---|
| AAPL | REVIEW_REQUIRED | CURRENT_TICKER_FILE | 0000320193-26-000020 | 1 | CLASS_INTERVAL_NOT_EXPLICIT · DEMANDED_CLASS_NOT_PROVED_ORDINARY_COMMON · SIBLING_CLASS_CENSUS_UNCLEAR |
| FOXA | REVIEW_REQUIRED | CURRENT_TICKER_FILE | 0001628280-26-053960 | 2 | CLASS_INTERVAL_NOT_EXPLICIT |
| CELG | REVIEW_REQUIRED | EXISTING_CIK_OVERRIDE | 0000816284-19-000046 | 1 | CLASS_INTERVAL_NOT_EXPLICIT · DEMANDED_CLASS_NOT_PROVED_ORDINARY_COMMON · SIBLING_CLASS_CENSUS_UNCLEAR |
| ABMD | REVIEW_REQUIRED | HISTORICAL_NAME_LOOKUP | 0000950170-22-021880 | 1 | CLASS_INTERVAL_NOT_EXPLICIT |
| LEH | REVIEW_REQUIRED | EXISTING_CIK_OVERRIDE | (없음) | 0 | DISCOVERY_ONLY_NO_SEC_PROOF · NO_COVER_PAGE_PROOF_DOCUMENT |

#### 두 종목이 바뀐 이유

- **CELG: `UNRESOLVED`가 아니라 증거가 더 늘었다.** 초판은 formation cutoff 때문에
  2019-03-31 10-Q(`celg-20190331.xml`)만 볼 수 있었고 거기엔 표지 제목·심볼 fact 칸이
  아예 없었다. cutoff를 없애자 **같은 등록인의 마지막 10-Q**(2019-09-30,
  `a2019093010q_htm.xml`)가 잡혔고 그것이 `CELG` ↔ `Common Stock, par value $.01 per
  share`를 명시로 증명한다. 같은 표지가 CVR(`CELGZ`)도 드러낸다.
  **나중 문서가 더 오래된 관계를 증명한 실측 사례다.**
- **ABMD: `UNRESOLVED` → `REVIEW_REQUIRED`.** 현재 ticker 파일에 없는 폐지 종목이라
  초판은 후보 CIK가 0개였다. 3층 이름 색인이 `Abiomed`를 `0000815094`로 풀었고, 그
  등록인의 마지막 10-Q(2022-09-30)가 `ABMD` ↔ Common Stock을 증명한다.
  **초판의 `NO_DISCOVERY_CANDIDATE`는 증거 공백이 아니라 배선 공백이었다.**

#### 정정판이 새로 보여준 것

- **`DEMANDED_CLASS_NOT_PROVED_ORDINARY_COMMON`이 AAPL만의 특수 사정이 아니다.**
  CELG도 주식수를 차원 없는 context에, 제목·심볼을 class 축 context에 싣는다. 같은
  모양이 다섯 표본에서 두 번 나왔다.
- **`PRE_INLINE_XBRL_NO_EXPLICIT_BRIDGE`는 이번 실행에서 발화하지 않았다.** CELG의
  더 늦은 표지에 fact가 있었기 때문이고, 그 사유 코드 자체는 network-free 회귀가
  계속 잠근다. **초판 pilot이 그 코드의 유일한 근거가 아니다.**
- LEH는 그대로다 — 2008년 제출에는 표지 XBRL 자체가 없다.

### 이 receipt가 주장하지 않는 것

- 5A-2가 완료됐다고 주장하지 않는다. 수요 897개 중 5개만 돌렸다
  (**그 `897`은 pre-fix 해석이다 — 10.12b를 본다**).
- 어떤 gate도 통과·실패했다고 주장하지 않는다. **Gate A~H는 여전히 미판정이다.**
- `AUTO_PROVABLE`이 나왔더라도 그것은 manifest 변경이 아니다.
- 5개 표본으로 897개의 상태 분포를 추정하지 않는다.
- Q/V · B/M · 랭크 · 선택 · 수익률을 계산하지 않았다.
- **`FOXA`가 옛 21세기폭스 episode까지 덮는다고 주장하지 않는다.** 이 실행의 `FOXA`는
  저장된 심볼이고 2019 이후 episode만이다. 옛 episode는 `TFCFA`로 저장돼 있었고
  10.13b가 그것을 별도 작업 항목으로 돌린다.


## 10.12b Step 5A-1 정정 실행 — 2026-09-01 (**economic-identity 정본**)

**정본은 `docs/trading/strategies/qv-step5-phase0-materialization-design.md` §0과 5A-1
절이다.** 읽기 전용이고 manifest를 바꾸지 않았으며 어떤 gate도 판정하지 않았다.

### 왜 다시 돌렸나 — universe/bar 심볼 != SEC 경제적 심볼

production 과거 유니버스는 재사용된 과거 티커 일부를 `universe_membership`에 넣기 전에
**벤더 계열 코드**로 바꾼다(`reconstruction → apply_reused(...) → universe_membership`).

```text
ABI -> ABI_OLD1   FOXA -> TFCFA   FOX -> TFCF   MON -> MON_OLD   SNDK -> SNDK_OLD
SUN -> SUN1       CC   -> CCTYQ   MICC -> MIICF
```

그 값들은 **시장 데이터 계열 locator**이고 SEC 경제적 거래 심볼이 아니다. 10.12의 5A-1은
`universe_membership.symbol`을 그대로 읽어 manifest 조회 키로 썼고, 5A-2는 같은 값을
발견·증명 심볼로 썼다. **시장 데이터 계열 정체성과 경제적 증권 정체성이라는 두 영역이
거기서 섞였다.**

**해답은 벤더 코드를 manifest에 넣는 것이 아니다.** manifest는 SEC/경제적 identity
정본으로 남고 SEC 증거가 증명한 **실제 과거 거래 심볼**만 담는다.

### 사용한 명시 source version — 10.12와 같다

```text
index_name              SP500
universe                announcements / eodhd-15y-2026-08
calendar                eodhd / eodhd-15y-2026-08        (참조 심볼 SPY)
identity bundle         qv-identity-sha256:55ed78d0b33bb5f85ccf14e81a5a7d8e6bcbe82d17812e46470b3b133372e6ec
reused-series bridge    trading/universe/reused-tickers.csv
                        reused-tickers-sha256:a9e7e79cc5807813ed250ac694a81b5d8652ff5b092ee040578fa2af78f0e55e
materialized qv_share_classes rows   0   (5A-1의 전제가 아니다)
```

**재사용 매핑 provenance는 SEC identity bundle의 일부가 아니다.** universe/market-data
심볼 provenance이고 산출물의 `symbol_bridge` 블록이 그 문장을 직접 들고 다닌다.

### 결과 — formation별 표는 10.12와 **같다**

`member_count` · `mapped_count` · `unmapped_count` · `ambiguous_count` ·
`mapped_issuer_count` · `multi_security_issuer_count`가 formation마다 전부 같다. 다리는
**행을 만들거나 없애지 않고 조회 키만 바꾸므로** 그것이 기대되는 결과다.

```text
security 행 총계                       9,525   (10.12와 같다)
MAPPED 행                                61    (10.12와 같다)
AMBIGUOUS_MAPPING                         0    (10.12와 같다)
MAPPED 심볼   CMCSA · GOOG · GOOGL · NKE · UA · UAA   (10.12와 같다)
사유 분포     NO_CLASS_MAPPING_FOR_SYMBOL 9,442
              CLASS_NOT_ACTIVE_AT_FORMATION  22
              MAPPED                         61
```

### 바뀐 것 — 수요의 **의미**

```text
symbol_bridge_kind 분포   DIRECT 9,185 · REUSED_VENDOR_SERIES 340
reused-tickers.csv를 거친 멤버십 행      340   (formation × 행)

5A-2 work item (member_symbol, identity_symbol)   897
  그중 재사용 벤더 계열                              63
고유 economic identity 심볼                        889
```

**`897`이라는 숫자는 우연히 같고 재는 것이 다르다.** 10.12의 `897`은 "MAPPED가 아닌
**저장된 심볼**의 고유 수"였고, 이번 `897`은 "MAPPED가 아닌 고유
`(데이터 계열, 경제적 심볼)` 작업 항목 수"다. **경제적 심볼로 세면 `889`이고 그 값은
10.12가 산출할 수 없던 것이다.** 두 숫자가 갈리는 자리가 정확히 재사용 episode 8개다.

```text
CEG   CEG   · CEG_OLD          DELL  DELL · DELL_OLD
DOW   DOW   · DOW_OLD          FOX   FOX  · TFCF
FOXA  FOXA  · TFCFA            GM    GM   · GM_OLD
Q     Q     · Q_OLD            SNDK  SNDK · SNDK_OLD
```

**이 여덟은 하나로 뭉치면 안 된다.** 같은 티커를 서로 다른 발행사가 겹치지 않는 기간에
썼고, 뭉치면 두 발행사가 하나의 `selected_cik`로 밀려 들어간다. 예를 들어 FOXA는
`TFCFA/FOXA`가 2008~2018 formation 11개, `FOXA/FOXA`가 2019~2026 formation 8개다.

### 이 숫자가 재는 것과 재지 않는 것 — 10.12와 같다

- **재는 것**: 선택된 manifest bundle 안의 **static 매핑 coverage/수요**.
- **재지 않는 것**: **historical PIT identity usability**. `usable_from_session`은
  5A-3이 REQUIRED 증거를 materialize한 뒤에 생긴다.
- `AMBIGUOUS_MAPPING = 0`은 지금 manifest가 작아서 나온 값이지 계약이 안전하다는
  증거가 아니다.
- **다리가 coverage를 늘리지 않았다.** `MAPPED`는 61 그대로다. 이 fix는 숫자를 키우는
  것이 아니라 **어느 심볼에 대해 SEC 증거를 찾을 것인가**를 바로잡는다.

**Gate A~H와 Phase 0는 여전히 평가되지 않았다.** 수익률·B/M·Q/V·랭킹·선택·
`coverage_start`를 계산하지 않았다.

## 10.13b Step 5A-2a/b 정정 pilot — 2026-09-01 (**economic-identity 정본**, target-blind 탐색)

> **이 실행의 표지 탐색은 target-blind였다** — 최신 정기보고서 3건까지만 보고 표지
> class fact가 있으면 그것으로 멈췄다. 판정·CIK·증명 accession은 10.13c가 그대로
> 재현했으므로 **이 표는 유효한 사실로 남는다.** 다만 `LEH`의 "표지 fact 없음"은 최신
> 3건에 대한 것이고, 전 이력에 대한 진술이 아니다. 정본은 10.13c다.

**production manifest를 바꾸지 않았다** — `trading/qv/identity/*.jsonl`은 읽지도 쓰지도
않았고 자동 승격도 없다. 어떤 Phase 0 gate도 판정하지 않았다. **5A-2는 아직 끝나지
않았다.**

10.13의 두 실행(초판·2026-09-01 정정판)은 사실 receipt로 그대로 남는다. 다만 그 실행들의
대상은 **저장된 심볼**이었고, `FOXA`는 2019 이후 episode만 가리키고 있었다.

### 대상 — 10.13의 다섯에 재사용 episode 하나를 더했다

```text
inventory     10.12b 산출물 (같은 명시 source/version, 위에 적었다)
대상          AAPL/AAPL    post-2019 단일 class
              TFCFA/FOXA   **재사용 벤더 계열** — 옛 21세기폭스 episode (2008~2018)
              FOXA/FOXA    같은 경제적 심볼의 새 episode (2019~2026)
              CELG/CELG    2019 이전 표지 · 이후 피인수
              LEH/LEH      CIK/재편 복잡 (CIK_OVERRIDES 고정)
              ABMD/ABMD    폐지 구성원
discovery     --historical (이름: sp500-changes.csv `security` 칸 / 구간: universe_membership)
              name_key = identity_symbol · span_key = member_symbol
SEC 호출      57
```

```text
AUTO_PROVABLE=0  REVIEW_REQUIRED=6  UNRESOLVED=0
발견 출처 분포  CURRENT_TICKER_FILE 3 · EXISTING_CIK_OVERRIDE 2 · HISTORICAL_NAME_LOOKUP 1
```

| work item | status | 발견 출처 | proof accession | 제안 class | reason codes |
|---|---|---|---|---|---|
| AAPL → AAPL | REVIEW_REQUIRED | CURRENT_TICKER_FILE | 0000320193-26-000020 | 1 | CLASS_INTERVAL_NOT_EXPLICIT · DEMANDED_CLASS_NOT_PROVED_ORDINARY_COMMON · SIBLING_CLASS_CENSUS_UNCLEAR |
| ABMD → ABMD | REVIEW_REQUIRED | HISTORICAL_NAME_LOOKUP | 0000950170-22-021880 | 1 | CLASS_INTERVAL_NOT_EXPLICIT |
| CELG → CELG | REVIEW_REQUIRED | EXISTING_CIK_OVERRIDE | 0000816284-19-000046 | 1 | CLASS_INTERVAL_NOT_EXPLICIT · DEMANDED_CLASS_NOT_PROVED_ORDINARY_COMMON · SIBLING_CLASS_CENSUS_UNCLEAR |
| FOXA → FOXA | REVIEW_REQUIRED | CURRENT_TICKER_FILE | 0001628280-26-053960 | 2 | CLASS_INTERVAL_NOT_EXPLICIT |
| LEH → LEH | REVIEW_REQUIRED | EXISTING_CIK_OVERRIDE | (없음) | 0 | DISCOVERY_ONLY_NO_SEC_PROOF · NO_COVER_PAGE_PROOF_DOCUMENT |
| **TFCFA → FOXA** | REVIEW_REQUIRED | CURRENT_TICKER_FILE | 0001628280-26-053960 | 2 | CLASS_INTERVAL_NOT_EXPLICIT · **REUSED_SERIES_ONLY_CURRENT_TICKER_CANDIDATE** |

10.13 정정판과 비교해 **AAPL·CELG·LEH·ABMD의 판정·CIK·사유가 그대로다.** 다리는 그
넷을 건드리지 않는다(전부 `DIRECT`).

### 이 실행이 실제로 확인한 것

1. **`TFCFA`가 SEC에 던져지지 않았다.** 발견·증명이 전부 `FOXA`로 갔고 표지 대조도
   `FOXA`로 붙었다. 벤더 코드로 대조했다면 SEC 표지에 실릴 수 없는 문자열이라 언제나
   `SYMBOL_NOT_ON_COVER_PAGE`였을 것이다. network-free 회귀가 그것을 잠근다
   (`ReusedVendorSeriesTest`).
2. **두 FOXA episode가 별도 packet으로 남았다.** 요구 formation이
   `TFCFA/FOXA` 11개(2008-06-30~2018-06-29)와 `FOXA/FOXA` 8개(2019-06-28~2026-06-30)로
   갈린다. 하나로 뭉갰다면 19개가 한 `selected_cik`에 붙었을 것이다.
3. **옛 episode가 조용히 새 발행사로 완결되지 않았다.** 아래가 그 실측이다.

### 실측이 드러낸 한계 — `TFCFA → FOXA`의 발견

3층(구간 이름 색인)은 이 항목에서 **돌았고 빈손이었다.** 명시 source
(`sp500-changes.csv`)가 `FOXA`에 대해 적은 이름이 `21st Century Fox`인데 EDGAR 이름
색인은 그 문자열을 풀지 못한다.

```text
"21st Century Fox"          -> []            (등록인 이름이 아니다)
"Twenty-First Century Fox"  -> 0001308161    (실제 옛 등록인)
"Fox Corporation"           -> 0000881040 · 0001754301
```

**이름을 고쳐 넣지 않았다.** 새 회사 이름 source를 만들거나 fuzzy 정규화를 하는 것은
Follow-up 9가 닫은 자리다. 그래서 이 항목의 유일한 후보가 현재 ticker 파일의
`0001754301`(**새** Fox Corporation)이었다.

그 상태가 `AUTO_PROVABLE`이 되면 **옛 economic identity에 새 발행사의 표지가 붙는다.**
그래서 이번 fix가 사유 코드 하나를 더했다.

```text
REUSED_SERIES_ONLY_CURRENT_TICKER_CANDIDATE
  재사용 벤더 계열인데 발견 후보가 현재 티커 계열 출처뿐이다.
  구간 증거가 다 들어와도 기계적 완결이 되지 못한다 — 5A-2c의 사람이 판정한다.
```

packet의 질문에도 그대로 남는다 — *"TFCFA는 FOXA의 옛 계열인데 발견 후보가 현재 티커
계열 출처뿐입니다 — 그 구간의 등록인인지 사람이 판정해야 합니다."*

**상태 어휘는 여전히 셋뿐이다**(`AUTO_PROVABLE` · `REVIEW_REQUIRED` · `UNRESOLVED`).
`DIRECT` 항목의 판정 규칙은 하나도 바뀌지 않았다.

### 이 receipt가 주장하지 않는 것

- 5A-2가 완료됐다고 주장하지 않는다. 897개 작업 항목 중 6개만 돌렸다.
- **어떤 gate도 통과·실패했다고 주장하지 않는다. Gate A~H는 여전히 미판정이다.**
- `TFCFA → FOXA`의 옛 등록인이 `0001754301`이라고 주장하지 않는다. 그 packet의
  `selected_cik`은 **DISCOVERY_HINT일 뿐이고** 사유 코드가 그것을 명시로 막고 있다.
- 6개 표본으로 897개의 상태 분포를 추정하지 않는다.
- Q/V · B/M · 랭크 · 선택 · 수익률을 계산하지 않았다.


## 10.13c Step 5A-2b target-aware 표지 탐색 — 2026-09-01 (**정본**)

**정본은 `docs/trading/strategies/qv-step5-phase0-materialization-design.md`의 5A-2b
절이다.** production manifest를 바꾸지 않았고(`trading/qv/identity/*.jsonl` 읽기·쓰기
없음) 승격도 없다. **5A-2는 아직 끝나지 않았고 Gate A~H는 여전히 미판정이다.**

> **10.13 계열 receipt는 전부 5A-2a/b 실행이고, 그 단계는 승격을 하지 않는다.**
> 이 절들의 "사람이 판정한다"는 말은 **`REVIEW_REQUIRED` packet에 대한 것**이지 모든
> packet에 사람 승인이 필요하다는 뜻이 아니다. 승격 경계는 상태가 정하고(승인 정책 B)
> 정본은 설계 문서의 5A-2c 절이다 — `AUTO_PROVABLE`은 fail-close 관문을 통과하면
> 사람의 의미 승인 없이 승격될 수 있다. **아래 실측·판정은 그대로 유효하다.**

### 무엇이 문제였나 — target-blind 탐색

`fetch_cover_proof()`가 요구 심볼을 모른 채 최신 정기보고서부터 훑고 **표지에 class
fact가 있으면 그것을 돌려줬다.** 요구 심볼과의 대조는 그 **뒤에**
`build_symbol_proposal()`에서 일어났다.

```text
같은 등록인 CIK
  더 오래된 filing -> TradingSymbol OLD
  더 최신 filing   -> TradingSymbol NEW
요구 identity_symbol = OLD

최신 NEW 표지를 읽는다 -> class fact가 있다 -> 그것을 돌려준다
                       -> OLD가 없다 -> SYMBOL_NOT_ON_COVER_PAGE
```

**OLD를 명시로 증명하는 더 오래된 표지는 읽히지도 않는다.** fail-closed이긴 하지만
기계적으로 증명 가능한 과거 매핑을 수동 검토로 보내버린다. 거기에 옛
`DEFAULT_MAX_PROOF_ATTEMPTS = 3`이 겹쳐서, 일치하는 표지가 현재로부터 네 번째면 아예
증명 불가였다.

### 실측 — `FTR`이 정확히 그 모양이었다

5A-1 수요에 실제로 있는 **같은 등록인 티커 변경** 사례 하나를 읽기 전용으로 확인했다.
**만들어낸 사례가 아니다** — Frontier는 `universe/SOURCES.md`가 근거와 함께 적은
`CZN → FTR` 개명 대상이고 수요에 `('FTR','FTR')` 작업 항목으로 들어 있다.

```text
member_symbol     FTR
identity_symbol   FTR            (DIRECT — 재사용 벤더 계열이 아니다)
candidate CIK     0000020520     HISTORICAL_NAME_LOOKUP
                  "Frontier Communications @ 2008-01-02..2017-03-20"
                  (announcements/eodhd-15y-2026-08)
attempted         24 accessions  (최신순, 전부 provenance로 남는다)
  첫 번째         0000020520-25-000006   fybr-20250930x10q_htm.xml -> FYBR
  스물세 번째     0001562762-20-000173   c520-20200331x10q_htm.xml -> (제목·심볼 없음)
  스물네 번째     0001140361-20-007583   form10k_htm.xml           -> **FTR**
selected proof    0001140361-20-007583   (FY2019 10-K)
표지가 증명한 것  FTR ↔ "Common Stock, par value $0.25 per share"
                  N/A ↔ "Preferred Stock Purchase Rights"
status            REVIEW_REQUIRED
reason codes      CLASS_INTERVAL_NOT_EXPLICIT
                  DEMANDED_CLASS_NOT_PROVED_ORDINARY_COMMON
                  SIBLING_CLASS_CENSUS_UNCLEAR
SEC 호출          197
```

**같은 등록인 CIK가 FYBR와 FTR 둘 다로 제출한다.** 회생 이후 계열이 `FYBR`이고 그
시절 구간의 티커가 `FTR`이다. 이 fix 이전이라면 첫 번째 accession(FYBR 표지)이 class
fact를 갖고 있으므로 **그것이 FTR의 canonical proof로 돌아오고
`SYMBOL_NOT_ON_COVER_PAGE`가 붙었을 것이다.** 24번째까지 가야 나오는 증명이라 옛
3건 상한으로도 막혔다.

남은 사유 셋은 이 fix와 무관한 **기존 계약 그대로**다 — Frontier 표지도 AAPL·CELG와
같은 모양으로 주식수를 차원 없는 context에, 제목·심볼을 class 축 context에 싣는다.
**고쳐 덮지 않았다.**

### 여섯 항목 pilot 재실행 — 판정이 하나도 바뀌지 않았다

10.13b와 같은 대상·같은 명시 입력이다.

```text
AUTO_PROVABLE=0  REVIEW_REQUIRED=6  UNRESOLVED=0        (10.13b와 같다)
발견 출처 분포  CURRENT_TICKER_FILE 3 · EXISTING_CIK_OVERRIDE 2
                · HISTORICAL_NAME_LOOKUP 1              (10.13b와 같다)
SEC 호출        157   (10.13b 57 — 아래 LEH가 전부다)
```

| work item | status | proof accession | attempted | reason codes |
|---|---|---|---|---|
| AAPL → AAPL | REVIEW_REQUIRED | 0000320193-26-000020 | 1 | CLASS_INTERVAL_NOT_EXPLICIT · DEMANDED_CLASS_NOT_PROVED_ORDINARY_COMMON · SIBLING_CLASS_CENSUS_UNCLEAR |
| ABMD → ABMD | REVIEW_REQUIRED | 0000950170-22-021880 | 1 | CLASS_INTERVAL_NOT_EXPLICIT |
| CELG → CELG | REVIEW_REQUIRED | 0000816284-19-000046 | 1 | CLASS_INTERVAL_NOT_EXPLICIT · DEMANDED_CLASS_NOT_PROVED_ORDINARY_COMMON · SIBLING_CLASS_CENSUS_UNCLEAR |
| FOXA → FOXA | REVIEW_REQUIRED | 0001628280-26-053960 | 1 | CLASS_INTERVAL_NOT_EXPLICIT |
| LEH → LEH | REVIEW_REQUIRED | (없음) | **53** | DISCOVERY_ONLY_NO_SEC_PROOF · NO_COVER_PAGE_PROOF_DOCUMENT |
| TFCFA → FOXA | REVIEW_REQUIRED | 0001628280-26-053960 | 1 | CLASS_INTERVAL_NOT_EXPLICIT · REUSED_SERIES_ONLY_CURRENT_TICKER_CANDIDATE |

**증명을 찾은 다섯은 전부 첫 번째 accession에서 멈춘다.** 요구 심볼이 최신 표지에 이미
있으므로 탐색이 즉시 끝나고, 결과는 10.13b와 **글자 그대로 같다.**

**바뀐 것은 LEH의 provenance 하나다.** 3건 → 53건. 2008년 제출에는 표지 XBRL 자체가
없어서 결론(`NO_COVER_FACTS`)은 같지만, 그 진술의 범위가 달라졌다.

```text
before   최신 3건에 표지 fact가 없다
after    이 등록인의 정기보고서 53건 어디에도 표지 fact가 없다
```

SEC 호출 57 → 157의 100건이 그 값이다.

### 이 receipt가 주장하지 않는 것

- 5A-2가 완료됐다고 주장하지 않는다. 897개 작업 항목 중 pilot 6개와 smoke 1개만 돌렸다.
- **어떤 gate도 통과·실패했다고 주장하지 않는다. Gate A~H는 여전히 미판정이다.**
- `FTR`의 identity가 승격됐다고 주장하지 않는다 — `REVIEW_REQUIRED`이고 manifest는
  바뀌지 않았다. 구간 증거와 census 판정은 5A-2c의 사람 몫이다.
- 7개 표본으로 897개의 상태 분포를 추정하지 않는다.
- 다른 896개 작업 항목에 같은 티커 변경 모양이 몇 개인지 세지 않았다.
- Q/V · B/M · 랭크 · 선택 · 수익률을 계산하지 않았다.


## 10.14 Step 5A-2b 완결성 fix + 5A-2c 승격기 코어 — 2026-09-01 (구현 receipt)

**정본은 `docs/trading/strategies/qv-step5-phase0-materialization-design.md`의 5A-2b ·
5A-2c 절이다.** 이 커밋은 **production identity manifest 행을 하나도 늘리지 않았다** —
`trading/qv/identity/*.jsonl` 네 파일이 그대로다. 실행 receipt가 아니라 구현·테스트
사실만 적는다. 어떤 Phase 0 gate도 판정하지 않았다.

### 5A-2b가 무엇을 닫았나 — 관계마다 자기 유효구간

`ShareClassProposal`만 `effective_from`/`effective_to`/`interval_proved`를 들고 있었고
`XbrlAliasProposal`·`ProseAliasProposal`은 없었다. **production 승격에는 모자란다** —
Step 4가 셋을 분리하기 때문이다.

```text
economic class 수명   !=   XBRL alias 수명   !=   prose alias 수명
```

세 제안이 각자 구간·증거를 들고 다니게 하고, 하나라도 비면 `AUTO_PROVABLE`이 되지
않도록 사유 코드 셋을 더했다.

```text
XBRL_ALIAS_INTERVAL_NOT_EXPLICIT
PROSE_ALIAS_INTERVAL_NOT_EXPLICIT
CANONICAL_CLASS_BRIDGE_NOT_EXPLICIT
```

**모든 보통주 sibling에 canonical bridge를 요구한다.** 요구된 상장 심볼만이 아니다.
주식수 fact와 XBRL member만 있는 미상장 sibling은 canonical bridge가 없으므로
`REVIEW_REQUIRED`로 남는다. `COVER_GROUP_LABEL`은 corroborating 전용이고 class 정체성도
production class-ID seed도 되지 못한다.

**옛 dual-class 테스트 기대가 너무 약했다.** `full_intervals(proof)`만으로
`AUTO_PROVABLE`이 되던 자리를 고쳤다 — 이제 제목 없는 Class B에는 명시 governing
instrument bridge가 있어야 한다.

### `qv-class-id-v1` — 불투명 결정적 production class id (Option A)

```text
class_id = "us-cik-" + CIK + "-class-v1-" + SHA256(canonical_seed_json).hexdigest()
seed     = {scheme, cik, effective_from, canonical_bridge_type, canonical_bridge_key}
```

전체 hex를 쓰고 자르지 않는다. **ticker·XBRL member·class 글자·제안 id·삽입 순서·정수
시퀀스를 쓰지 않는다.** `prop-<CIK>-<member>`는 packet-local 임시 참조이고 production
foreign key로 새어 나가지 않는다(회귀가 잠근다).

기존 사람이 읽는 anchor id(`nke-b` · `googl-c` …)는 **개명하지 않는다.** 정확히 안전한
재사용(같은 issuer · 같은 canonical comparison_key · 탄생 시점 유효 · economic 구간·속성
일치 · 정확히 하나)만 시도하고, 둘 이상이면 fail-close다.

### 5A-2c 승격기 코어

구현 `trading/backtest/qv_identity_promotion.py`, 진입점
`trading/selftest/qv_identity_promotion_run.py`(**기본 dry-run**).

```text
정확한 pinned base가 아니면        STALE_IDENTITY_BASE — 병합·rebase 없이 rerun
proposal_status는 입력이지 권한이 아니다 — packet을 처음부터 재검증한다
표지에서 온 관계는 packet에 박힌 원본 표지 fact와 대조한다
SEC를 다시 부르지 않는다 · DB를 건드리지 않는다 · 다섯 번째 identity 파일이 없다
append/reuse 전용 — 기존 semantic 행을 바꿔야 하면 fail-close
선택한 AUTO_PROVABLE 하나가 실패하면 batch 전체 중단(--force·--skip-bad 없음)
```

후보 bundle은 임시 디렉터리에 네 파일로 세우고 **정본 `load_manifest()`·`validate()`**로
검사한 뒤에야 쓰기로 간다. 쓰기 직전에 base version을 한 번 더 확인하고, 평범한 예외가
나면 원래 바이트로 되돌린다. **그 이상의 파일시스템 crash-consistency를 주장하지
않는다.**

### 로컬 Python 실측 (2026-09-01)

| 모듈 | 결과 |
|---|---|
| `test_qv_symbol_bridge` | 18 OK |
| `test_qv_identity_inventory` | 30 OK |
| `test_qv_identity_proposals` | 92 OK |
| `test_qv_identity` | 21 OK |
| `test_qv_step4` | 117 OK |
| `test_qv_identity_promotion` | 40 OK (신규) |
| **전체 trading suite** | **1,654 OK** |

**GitHub CI는 이 숫자를 재현하지 않는다** — 워크플로는 `npm test`(`node --test`)만
돌리고 `trading/`의 Python 테스트를 실행하지 않는다.

### 이 receipt가 주장하지 않는 것

- **production identity manifest를 넓히지 않았다.** 네 파일이 그대로다.
- 897개 작업 항목을 production으로 돌리지 않았다.
- 5A-3을 구현하지 않았고 DB materialize도 `usable_from_session` 파생도 하지 않았다.
- **Gate A~H는 여전히 미판정이다.**
- Q/V · B/M · 랭크 · 선택 · `coverage_start` · 수익률을 계산하지 않았다.


## 10.15 5A-2b 구간 증거 무결성 + 5A-2c 재검증·batch 원자성 fix — 2026-09-01

**정본은 `docs/trading/strategies/qv-step5-phase0-materialization-design.md`다.**
이 커밋도 **production identity manifest 행을 하나도 늘리지 않았다** — 네 파일이
그대로다. 테스트는 전부 임시 fixture manifest만 쓴다. Gate A~H는 여전히 미판정이다.

### BLOCKER 1 — `interval_proved`가 구간 증거의 존재를 증명하지 못했다

`RelationInterval`이 빈 증거를 받았고, `_class_packets()`가 구간 증거를 관계 증거에
평평하게 합쳤다. 그래서 이런 것이 통과했다.

```text
RelationInterval("2016-04-08", None, evidence=())
  -> interval_proved = true
  -> evidence = [표지 fact]        (구간을 증명한 것이 아무것도 없다)
```

표지 fact는 "그 filing 시점에 이 관계가 있었다"를 증명하지 **수명 경계**를 증명하지
않는다. 승격기가 그 둘을 구분할 방법이 없었다.

**구간을 별도로 직렬화되는 증명 객체로 만들었다.**

```json
"interval": {"effective_from": "...", "effective_to": null, "evidence": [...]}
```

`RelationInterval`이 빈 증거 · REQUIRED 없는 증거 · 뒤집힌 순서를 **만들어지는 자리에서**
거부한다. 승격기는 `interval_proved` flag가 아니라 그 객체에서 직접 확인하고,
**관계 증거가 REQUIRED라는 이유로 구간 증거를 대신하지 못한다.**

구간 포함 불변식도 넣었다 — alias는 그 class 수명 밖에서 유효할 수 없고, 벗어나면
`ALIAS_INTERVAL_OUTSIDE_CLASS_LIFETIME`이다. **조용히 잘라 맞추지 않는다.**

### BLOCKER 2 — 승격기가 상태 결정 규칙을 전부 다시 계산하지 않았다

`proposal_status`와 `reason_codes`만 고친 packet이 통과할 수 있었다. 이제 승격기가
구조화된 fact에서 다시 계산한다.

```text
작업 항목 계약 · 요구 심볼(같은 대조 함수) · 발견 출처 · 재사용 계열의 historical 출처
요구 · 승계 판정(명시 칸) · 원본 표지에서 다시 센 census
```

**제안기의 순수 함수를 공유해서 쓴다** — `cover_proof_from_json` ·
`cover_classes_for_symbol` · `class_role` · `census_status`. 두 번째 조금 다른 정의를
만들지 않았다. `successor_judgement_required`는 `SymbolProposal`의 명시 칸으로 넣었고
자유 문장 질문에서 추론하지 않는다.

### MAJOR 3 — batch 안의 packet들이 서로를 못 봤다

`resolve_class_id()`가 base manifest만 받아서, 같은 batch의 앞 packet이 계획한
class/alias를 뒤 packet이 보지 못했다. 다중 증권 발행사에서 두 상장 심볼이 같은
sibling package를 들고 오면 같은 관계가 두 번 추가된다.

**base + 이번 batch가 계획한 행을 함께 보는 전망 상태 위에서 계획한다.** 같은 관계면
재사용하고, 같은 semantic key인데 내용이 다르면 batch 전체가 실패한다. 계획 중에
production 파일을 쓰지 않는다.

### MAJOR 4 — 쓰다가 터진 파일 자신이 되돌려지지 않았다

`write_text()`가 파일을 자른 뒤 예외를 던지면 그 파일명은 아직 `written`에 들어가지
못해 되돌리기에서 빠졌다. **이제 평범한 Python 예외에서 네 파일 전부를 원래 바이트로
되돌린다.** 그 이상의 파일시스템 crash-consistency는 여전히 주장하지 않는다.

### 회귀 — fix 전에는 실패하는 것들

10개를 넣었고, 그중 가장 미묘한 둘(전체 되돌리기 · batch 전망 상태)은 **fix를 임시로
되돌려 실제로 실패하는 것을 확인한 뒤** 복구했다.

```text
빈 구간 증거로 AUTO_PROVABLE 불가 · 표지에 없는 요구 심볼 위조 실패 ·
CURRENT_TICKER_FILE만 든 재사용 계열 위조 실패 · census 위조 실패 ·
DIRECT 심볼 불일치 실패 · alias가 class 탄생 전/사망 후로 나가면 실패 ·
같은 발행사 package를 든 두 작업 항목이 전망 상태에 대고 중복 제거 ·
batch 안 semantic 불일치가 전체 실패 · 쓰기 실패 시 네 파일 원본 복구
```

### 로컬 Python 실측 (2026-09-01)

| 모듈 | 결과 |
|---|---|
| `test_qv_identity_proposals` | 102 OK |
| `test_qv_identity_promotion` | 55 OK |
| `test_qv_identity` | 21 OK |
| `test_qv_symbol_bridge` | 18 OK |
| `test_qv_identity_inventory` | 30 OK |
| `test_qv_step4` | 117 OK |
| **전체 trading suite** | **1,679 OK** |

**GitHub CI는 이 숫자를 재현하지 않는다** — 워크플로는 npm 테스트·빌드만 돌리고
`trading/`의 Python QV suite를 실행하지 않는다.

### 이 receipt가 주장하지 않는 것

- production identity manifest를 넓히지 않았다. 네 파일이 그대로다.
- 897개 작업 항목을 승격하지 않았다.
- 5A-3·materialize·`usable_from_session` 파생을 하지 않았다.
- **Gate A~H는 여전히 미판정이다.** Q/V·B/M·랭크·선택·수익률을 계산하지 않았다.


## 10.16 XBRL alias 은퇴 → accession 단위 binding 재설계 — 2026-09-01

**사용자가 CLOSED였던 Step 4 계약 하나를 명시로 다시 열어 닫았다.** 대규모 production
identity 확장 **전에** 하는 것이 이 결정의 조건이었다.

```text
(issuer, QName, effective_from/effective_to) -> economic class      RETIRED

economic class / prose identity   production identity — 오래 살고 버전 관리된다
XBRL QName binding                파생 filing-local 관측 — accession 안에서만 참이다
```

정본은 `docs/trading/strategies/qv-step4-shares-me-design.md` §1.4와
`qv-step5-phase0-materialization-design.md`다. **이 커밋도 production identity 행을
늘리지 않았다** — economic anchor는 그대로이고 `xbrl_aliases.jsonl`만 삭제됐다.

### 무엇이 바뀌었나

```text
identity bundle       네 파일 -> 세 파일 (issuers · share_classes · prose_aliases)
bundle 해시           앞에 판별자 `qv-identity-bundle-v2`를 먹인다
                      -> 옛 네 파일 version과 절대 같아질 수 없다(설계상 stale)
xbrl_aliases.jsonl    삭제. 옛 행을 binding으로 변환하지 않는다 —
                      그 행들이 주장한 것은 alias 수명이지 accession 안의 관계가 아니다
새 표                 qv_xbrl_class_bindings (accession 단위 파생 관측)
새 모듈               backtest/qv_xbrl_binding.py
은퇴                  qv_identity.resolve_member(..., as_of=...)
                      qv_share_class_xbrl_aliases (표는 물리적으로만 남는다)
                      XbrlAliasProposal · xbrl_interval · XBRL_ALIAS_INTERVAL_NOT_EXPLICIT
```

**DB를 파괴적으로 고치지 않았다.** 옛 표와 `qv_identity_evidence`의 `XBRL_ALIAS`
어휘는 legacy 값으로 남고 새 행을 쓰지 않는다. 실측: 로컬 `backtest.db`에서 옛 표가
그대로 공존하고 `bars_daily` 4,122,726행도 그대로다.

### 자동 binding은 좁다

표지의 `Security12bTitle`/`Security12gTitle`이 그 member에 있고 그 N1 키가 고정된
bundle에서 **정확히 하나의** class로 풀릴 때만 묶는다. `TradingSymbol`은 교차
확인이고 ticker만으로는 묶지 않는다. **governing instrument는 class를 증명하지 QName
관계를 증명하지 않는다** — 제목 없는 member는 charter가 같은 이름의 class를 정의해도
자동으로 묶이지 않고 `UNRESOLVED`로 남는다.

### 새 identity_source_version과 5A-1 재실행

```text
이전(네 파일)  qv-identity-sha256:55ed78d0b33bb5f85ccf14e81a5a7d8e6bcbe82d17812e46470b3b133372e6ec
현재(세 파일)  qv-identity-sha256:612412421278fb9d7fba90fa351e95a0ede09596474d4ec8696a7c59f43906a1
```

**옛 pinned version은 전부 stale이다.** 손으로 맞추지 않았다. 같은 명시
universe/calendar 입력으로 5A-1을 다시 돌렸다.

```text
security 행 총계                       9,525
MAPPED 행                                61   (CMCSA · GOOG · GOOGL · NKE · UA · UAA)
5A-2 work item                          897   (재사용 벤더 계열 63)
고유 economic identity 심볼             889
reused-tickers.csv를 거친 멤버십 행     340
```

**수치가 10.12b와 같다.** 기대되는 결과다 — `xbrl_aliases.jsonl`을 빼도 manifest가
어느 심볼을 매핑하는지는 바뀌지 않는다. 바뀐 것은 `identity_source_version` 하나이고,
그것이 옛 receipt를 stale로 만든다.

### 실제 SEC binding smoke (읽기 전용, 기존 anchor 발행사)

세 파일 bundle 행을 스크래치 메모리 DB에 넣고 실제 최신 표지를 읽었다. SEC 호출 17.

| issuer | accession | 결과 |
|---|---|---|
| NKE `0000320187` | `0000320187-26-000088` / `nke-20260531_htm.xml` | 표지에 class 축 제목·심볼 fact가 없다 → binding 0 · unresolved 0 |
| GOOGL `0001652044` | `0001652044-26-000071` / `goog-20260630_htm.xml` | binding 2 · unresolved 24 |

```text
us-gaap:CommonClassAMember              -> googl-a   'class a common stock, $0.001 par value'
ext:0001652044:CapitalClassCMember      -> googl-c   'class c capital stock, $0.001 par value'
usable_from_session 2026-07-22           (filing과 identity 다리의 max)
```

**`googl-b`는 묶이지 않았다.** manifest가 charter `GOVERNING_INSTRUMENT`로 Class B를
economic class로 증명하지만, 그 표지에 Class B member의 제목 fact가 없다 —
**governing instrument가 QName 관계를 만들지 않는다**는 계약이 실측에서 그대로
나타났다. 남은 24건은 senior notes·depositary shares로 canonical prose bridge가 없다.

`ext:0001652044:` 접두가 발행사 확장 member의 exact target CIK 키를 그대로 보존한다.

### 로컬 Python 실측 (2026-09-01)

| 모듈 | 결과 |
|---|---|
| `test_qv_identity` | 21 OK |
| `test_qv_xbrl_binding` | 20 OK (신규) |
| `test_qv_step4` | 124 OK |
| `test_qv_identity_proposals` | 102 OK |
| `test_qv_identity_promotion` | 60 OK |
| `test_qv_identity_inventory` | 30 OK |
| `test_qv_symbol_bridge` | 18 OK |
| **전체 trading suite** | **1,711 OK** |

**GitHub CI는 이 숫자를 재현하지 않는다** — 워크플로는 npm 테스트·빌드만 돌리고
`trading/`의 Python QV suite를 실행하지 않는다. 이 작업에서 CI를 바꾸지 않았다.

### 이 receipt가 주장하지 않는 것

- production identity manifest를 넓히지 않았다. economic anchor 행이 그대로다.
- 897개 작업 항목을 승격·binding하지 않았다.
- 5A-3을 구현하지 않았다. materialize도 `usable_from_session` 파생도 하지 않았다.
- accession 단위 사람 판정 기구를 만들지 않았다.
- **Gate A~H는 여전히 미판정이다.** Q/V·B/M·랭크·선택·수익률을 계산하지 않았다.


## 10.17 accession binding grain · fact-instant 재확인 · provenance 권한 fix — 2026-09-02

10.16 재설계(C2)는 그대로 승인 상태이고, 그 위의 리뷰 지적 넷을 고친다. **production
identity 행을 늘리지 않았다** — economic anchor 세 파일이 그대로다.

### 1 (BLOCKER) — 조회 grain에 instance 문서가 빠져 있었다

스키마 자연키에는 `instance_document_name`이 있는데 `resolve_accession_member()`가
그것을 빼고 찾았고 `qv_shares`도 넘기지 않았다. **한 accession 안의 다른 instance
문서 binding이 관측으로 새거나, 그것이 있다는 이유로 멀쩡한 문서-지역 매핑이
`AMBIGUOUS`가 됐다.**

문서 이름을 **필수 조회 입력**으로 만들고 자연키 전체로 찾는다. 문서 이름을 무시하는
폴백도, 순서로 문서를 고르는 규칙도 없다. `qv_shares`는 이미 들고 있는
`instance.source_file`을 그대로 넘긴다.

### 2 (BLOCKER) — fact instant에서 economic/prose identity를 다시 확인한다

binding 파생은 표지 context instant를 쓰고, `qv_shares`는 나중에 class 수명만 다시
봤다. **CLOSED 규칙은 그 share-fact instant에서 철자가 정확히 하나로 풀리고 그 class가
활성일 것을 요구한다.**

`resolve_accession_member()`에 `fact_instant`를 필수로 넣고, 행을 찾은 뒤 저장된
`issuer_id`·`class_id`·canonical prose 키로 그 시점에 다시 확인한다 — 같은 class로
풀리는가 · 활성인가 · 같은 issuer인가 · 보통주인가. **다른 class로 바꿔치지 않고 더
오래되거나 더 새로운 prose 구간을 대신 쓰지도 않는다.** 기존 `_canonical_class` ·
`_active_class`를 그대로 쓰고 두 번째 정의를 만들지 않았다. "없다"와 "둘이다"는
문자열이 아니라 `QVBindingAmbiguity` 형으로 가른다. `qv_shares`의 독립
`_class_active_at`는 해석기가 계약을 통째로 갖게 되어 없앴다.

### 3 (MAJOR) — filing session과 instance SHA는 파생 provenance다

호출자가 `filing_historical_usable_session`과 `instance_sha256`을 넣을 수 있어서 실제
K/Q filing·실제 문서와 어긋난 provenance로 binding이 저장될 수 있었다.

```text
instance_document_name = document.source_file
instance_sha256        = document.sha256
filing usable session  = qv_sec_filings의 (cik, accession, source_version) 행
```

filing 원장 조회는 **정확히 한 행**을 요구하고 없으면 fail-close다. 스키마에도 FK를
걸었다 — `qv_sec_filings`의 PK가 그대로 그 셋이고 binding 표는 10.16에서 새로 생긴
빈 표라 파괴적 migration이 필요 없었다. `ClassBinding`이 불변 source 정체성을 직접
들고 다니므로 `store_bindings()`는 호출자 복사본을 받지 않는다.

### 4 (MAJOR) — 정확한 자연키 충돌이 fail-close다

`INSERT OR REPLACE`가 같은 자연키의 다른 semantic 내용을 조용히 덮어썼다. 이제
같은 내용이면 멱등 재사용이고 다르면 `QVBindingError`다. `instance_document_name`이
다르면 **다른 자연키**라 같은 QName이 다르게 묶여도 정상이다. 행을 직접 `UPDATE`한 뒤
관찰하던 옛 테스트를 실제 저장 경로 테스트로 바꿨다.

### 정리

`load_manifest()`의 "네 파일"과 `data_sources.note`의 `(4 files...)`를 세 파일 ·
bundle v2로 맞췄다.

### 회귀 — fix 전에는 실패하는 것들

문서 grain 셋(공유 binding 분리 · 다른 문서 binding 미노출 · qv_shares 누출)은
**fix를 임시로 되돌려 실제로 실패하는 것을 확인**한 뒤 복구했다.

```text
한 accession 두 문서가 같은 QName을 따로 묶는다(어느 쪽도 AMBIGUOUS가 아니다) ·
없는 문서 이름은 UNRESOLVED · share fact가 다른 문서 binding을 보지 않는다 ·
철자가 다른 class의 것인 instant에서 UNRESOLVED · 그 instant에 class가 비활성이면
UNRESOLVED · 그 instant에 철자가 둘로 가면 AMBIGUOUS · filing 기록이 없으면
fail-close · 원장 session을 쓰고 호출자 값을 쓰지 않는다 · 같은 자연키 다른 내용은
fail-close이고 원래 행이 그대로 · 같은 내용 재저장은 멱등
```

### 실제 SEC smoke (읽기 전용, GOOGL `0001652044-26-000071`)

```text
문서            goog-20260630_htm.xml     (document.source_file)
instance sha    1376c154c799dd52…         (document.sha256)
filing usable   2026-07-23                (qv_sec_filings 행에서)
저장            2행 · 같은 것 재저장 0행(멱등)
us-gaap:CommonClassAMember          -> googl-a   정확한 문서 조회 RESOLVED
ext:0001652044:CapitalClassCMember  -> googl-c   정확한 문서 조회 RESOLVED
같은 QName을 `other.xml`로 조회      -> (None, UNRESOLVED)   폴백 없음
googl-b bound: False                 unresolved 24
SEC 호출 8
```

`googl-b`는 여전히 묶이지 않는다 — governing instrument는 class를 증명하지 QName
관계를 증명하지 않는다.

### 로컬 Python 실측 (2026-09-02)

| 모듈 | 결과 |
|---|---|
| `test_qv_xbrl_binding` | 27 OK |
| `test_qv_step4` | 127 OK |
| `test_qv_identity` | 21 OK |
| `test_qv_identity_proposals` | 102 OK |
| `test_qv_identity_promotion` | 60 OK |
| `test_qv_identity_inventory` | 30 OK |
| `test_qv_symbol_bridge` | 18 OK |
| **전체 trading suite** | **1,721 OK** |

**GitHub CI는 이 숫자를 재현하지 않는다** — 워크플로는 npm 테스트·빌드만 돌린다.

### 이 receipt가 주장하지 않는 것

- production identity manifest를 넓히지 않았다.
- 897개를 승격·binding하지 않았고 5A-3을 구현하지 않았다.
- 사람 QName 판정 기구를 만들지 않았다.
- **Gate A~H는 여전히 미판정이다.** Q/V·B/M·랭크·선택·수익률을 계산하지 않았다.


## 10.18 accession binding PIT 완결 — 2026-09-02

C2 구조는 그대로 승인 상태이고, production materialization 전에 남은 PIT·범위 구멍 둘을
닫는다. **production identity 행을 늘리지 않았다.**

### BLOCKER 1 — fact instant 재확인이 지식 가용성을 무시했다

`resolve_accession_member(... usable_by=...)`가 binding 행은 걸렀지만 이어지는
`_canonical_class()` · `_active_class()`는 `usable_by`를 무시했다. **나중에야 usable해진
prose/class 구간이 더 이른 formation에 노출될 수 있었다.**

두 순수 헬퍼에 `usable_by`를 선택 인자로 더하고(로직을 복제하지 않았다) 해석기가 두 재확인에
모두 넘긴다. cutoff에서 쓸 수 있는 관계가 없으면 `UNRESOLVED`, 둘 이상이면 `AMBIGUOUS`이고
다른 class로 바꿔치지 않는다.

### BLOCKER 2 — `issuer_id`가 CIK와 독립으로 들어왔다

`derive_bindings()`가 `cik`과 `issuer_id`를 따로 받아서 **CIK A의 filing이 issuer B의
economic identity에 묶일 수 있었다** — 두 FK가 각각 통과하기 때문이다. 공개 파생 경계에서
`issuer_id`를 없애고 `qv_issuers`에서 그 CIK로 **정확히 한 행**을 찾는다. 없거나 둘이면
fail-close다.

issuer 매핑도 PIT identity 관계이므로 binding의 identity 문턱이 셋의 최댓값이 됐다.

```text
identity_usable_from_session = max(issuer, economic class, canonical prose)
```

### 3 — 저장된 관측에 매핑 가용성을 명시한다

`qv_share_observations`의 PK에 `formation_session`이 없어 formation마다 다른 매핑 결과를
저장할 수 없다. 그래서 `extract_observations(... usable_by=<한 formation>)`의 결과를 모든
formation에 쓰는 방식을 **버렸다** — 이제 그 인자가 없다.

새 칸 `mapping_usable_from_session`을 더했다. class 축 관측이면 그 fact instant 해석에
실제로 필요했던 관계 전부(binding · issuer · economic class · canonical prose)의
최댓값이고, 차원 없는 관측이면 issuer·class 가용성의 최댓값이다. **filing 수리 시각을
identity 가용성으로 쓰지 않는다** — filing은 `historical_usable_session`이 따로 다스린다.

선택기는 formation F에서 두 문턱을 모두 요구한다.

```text
filing historical_usable_session <= F  AND  mapping_usable_from_session <= F
```

**tier 규칙은 그대로다.** 매핑을 아직 쓸 수 없는 A는 "귀속되지 않은 A"로 세어 B fallback을
그대로 막는다. A-owns / B-fallback · same-regime 의미를 바꾸지 않았다.

### 회귀 — fix 전에는 실패하는 것들

네 축을 임시로 되돌려 **실제로 실패하는 것을 확인**한 뒤 복구했다.

```text
prose 구간이 2020에야 증명됐으면 2018 formation은 못 쓴다(binding 자체는 2017부터 usable)
class 구간이 나중에 증명된 경우도 같다
나중 usable한 issuer 매핑이 binding 가용성을 늦춘다
CIK A가 issuer B에 묶이지 않는다 · CIK에 issuer가 정확히 하나가 아니면 fail-close
매핑을 아직 못 쓰는 RESOLVED 관측은 그 formation에서 귀속되지 않는다
그래도 B fallback을 막는다(9999를 쓰지 않는다) · formation이 문턱에 닿으면 귀속된다
filing cutoff는 독립이고 여전히 필수다 · 저장 행은 formation 독립이다
문서/accession/QName locality와 fact-instant class·prose 변경 회귀는 그대로 통과
```

### 로컬 Python 실측 (2026-09-02)

| 모듈 | 결과 |
|---|---|
| `test_qv_xbrl_binding` | 34 OK |
| `test_qv_step4` | 133 OK |
| `test_qv_identity` | 21 OK |
| `test_qv_identity_proposals` | 102 OK |
| `test_qv_identity_promotion` | 60 OK |
| `test_qv_identity_inventory` | 30 OK |
| `test_qv_symbol_bridge` | 18 OK |
| **전체 trading suite** | **1,734 OK** |

**GitHub CI는 이 숫자를 재현하지 않는다** — 워크플로는 npm 테스트·빌드만 돌린다.

### 이 receipt가 주장하지 않는 것

- production identity manifest를 넓히지 않았다. 897개를 승격·binding하지 않았다.
- 5A-3을 여기서 필요한 관측/PIT 계약 이상으로 구현하지 않았다.
- share-basis·사건 의미, 회계·Q/V·B/M·랭크를 바꾸지 않았다.
- **Gate A~H는 여전히 미판정이다.** 수익률을 계산하지 않았다.


---

## 10.19 C2 마무리 — issuer 파생 · `(축, member)` grain · 두 가용성 축 분리 — 2026-09-02

C2 아키텍처와 10.18의 PIT fix는 그대로 두고 남은 세 곳만 고쳤다.

### BLOCKER 1 — share 관측 추출이 여전히 `cik`과 `issuer_id`를 따로 받았다

`derive_bindings()`에서는 이미 없앤 문제가 `qv_shares.extract_observations()`에 남아
있었다. 잘못된 호출이 다음을 짝지을 수 있었다.

```text
CIK A의 filing  +  issuer B
```

차원 없는 fact는 `_sole_ordinary_class()`가 **호출자가 준 issuer**로 풀어서 issuer B의
class가 됐고, class 축 fact는 binding 해석기가 CIK A로 올바른 class를 찾은 뒤
`ShareObservation.issuer_id`만 호출자의 issuer로 채워 다음이 저장될 수 있었다.

```text
cik=A · issuer_id=B · class_id=<issuer A의 class> · mapping_status=RESOLVED
```

공개 입력에서 `issuer_id`를 없애고 `cik` + `identity_source_version`에서 한 번만
파생한다. **CIK→issuer 구현은 그대로 하나다** — `qv_xbrl_binding.resolve_issuer()`를
그대로 쓰고 두 번째 구현을 만들지 않았다. `_sole_ordinary_class()`가 따로 하던
`qv_issuers` 재조회도 없앴고 파생된 값을 받는다. 그 하나가 D0 해석 · class 축 관측의
`issuer_id` · 매핑 가용성 · 저장되는 모든 행에 쓰인다. ticker · class 심볼 · XBRL
member · 현재 SEC 메타데이터 · 호출자 상태로 추론하지 않는다.

### BLOCKER 2 — 충돌 추적이 `axis_key`를 버렸다

production 자연키는 `(cik, accession, instance_document_name, axis_key, member_key,
filing_source_version, identity_source_version)`인데 `derive_bindings()`는
`seen[member_key]`만 추적했다. 승인된 두 축에 같은 member QName이 실리면 **서로 다른 두
관계가 한 자리로 무너져** 정상 filing이 충돌로 멈췄다.

`seen`의 키를 `(axis_key, member_key)` 쌍으로 바꿨다. member local name도 member QName도
축을 가로질러 뭉개지 않는다. 정확히 **같은** `axis_key + member_key`가 두 class를
가리키는 것만 fail-close이고, 그것은 저장 자연키에서도 이미 fail-close다.

### MAJOR 3 — 매핑 가용성이 filing 가용성을 품고 있었다

`resolve_accession_member()`가 `MemberResolution.mapping_usable_from_session`을
binding 행의 `usable_from_session`으로 계산했는데, 그 칸은 이미 다음이다.

```text
usable_from_session = max(filing_historical_usable_session,
                          identity_usable_from_session)
```

그래서 identity 전용이어야 할 매핑 가용성이 filing 가용성을 **상속했다.** 선택기가
filing 문턱을 따로 요구하므로 조기 사용 버그는 아니었지만, 두 축을 나눈 의미가
사라지고 provenance가 사실과 달라진다.

binding의 `identity_usable_from_session`을 쓰도록 바꿨다.

```text
mapping_usable_from_session = max(
    binding.identity_usable_from_session,
    fact-instant issuer usable_from_session,
    fact-instant economic class usable_from_session,
    fact-instant canonical prose usable_from_session)
```

filing 가용성은 이제 `qv_share_observations.historical_usable_session` **한 곳에만**
산다. 선택기 계약은 그대로다.

```text
historical_usable_session <= F  AND  mapping_usable_from_session <= F
```

### 용어 — 네 칸의 뜻이 서로 다르다

```text
binding.usable_from_session              filing 문턱 + binding identity 문턱
binding.identity_usable_from_session     그 binding을 세우는 데 필요한 identity 관계
observation.historical_usable_session    filing 문턱
observation.mapping_usable_from_session  identity/class 귀속 문턱
```

### 회귀 — fix 전에는 실패하는 것을 확인했다

fix를 임시로 되돌려 **실제로 실패하는 것을 본 뒤** 복구했다.

| 회귀 | 되돌렸을 때 |
|---|---|
| `test_one_member_qname_under_two_axes_binds_independently` | `QVBindingError: …/us-gaap:CommonStockMember가 이 accession 안에서 두 class로 갑니다: cls-b vs cls-a` |
| `test_the_mapping_usable_session_covers_every_required_identity_relation` | `'2024-02-20' != '2014-01-02'` |
| `test_mapping_availability_never_inherits_filing_availability` | `['2024-02-20'] != ['2014-01-02']` |

축별 회귀 내용:

```text
같은 member QName이 두 승인 축에 실리면 독립된 두 binding이 되고, 정확한 축으로
    조회하면 각자의 class가 나온다(StatementClassOfStock -> cls-a,
    ClassesOfShareCapital -> cls-b). 같은 축+member의 두 class는 저장에서 fail-close다.
extract_observations의 서명에 `issuer_id`가 없고 `**kwargs`도 없다 — CIK A 문서를
    처리하면서 issuer B를 넣을 자리가 없다(TypeError).
CIK A의 차원 없는 fact는 issuer A의 identity만 쓴다(issuer B에도 유일 보통주가 있다).
CIK A의 class 축 fact가 저장하는 issuer_id·class_id는 같은 발행사의 것이다.
그 CIK의 issuer가 없으면 다른 issuer로 넘어가지 않고 fail-close다
    (`UNIQUE(cik, source_version)`이 "둘" 쪽을 이미 막는다).
issuer 2012 · class 2013 · prose 2014 · filing 2024이면 저장된 관측은
    historical_usable_session = 2024, mapping_usable_from_session = 2014이고,
    2020 formation에서는 filing 문턱 때문에 여전히 못 쓴다. 두 문턱을 모두 넘은
    formation에서만 A로 귀속된다.
```

기존 계약은 그대로 통과한다 — 세 파일 identity bundle v2 · 시간 구간 XBRL alias 없음 ·
정확한 accession/문서/QName binding · fact-instant 재확인 · 지식 가용성 cutoff · CIK 파생
issuer · `qv_sec_filings` filing provenance · `InstanceDocument`의 문서 이름/SHA · 정확한
자연키 충돌 fail-close · 멱등 저장 · formation 독립 관측 · A-owns/B-fallback ·
same-regime · `qv-class-id-v1`.

### 로컬 Python 실측 (2026-09-02)

| 모듈 | 결과 |
|---|---|
| `test_qv_xbrl_binding` | 35 OK |
| `test_qv_step4` | 138 OK |
| `test_qv_identity` | 21 OK |
| `test_qv_identity_proposals` | 102 OK |
| `test_qv_identity_promotion` | 60 OK |
| `test_qv_identity_inventory` | 30 OK |
| `test_qv_symbol_bridge` | 18 OK |
| **전체 trading suite** | **1,740 OK** |

**GitHub CI는 이 숫자를 재현하지 않는다** — `.github/workflows/docker.yml` 하나뿐이고
Python 테스트를 돌리지 않는다. 위 숫자는 전부 로컬 실측이다.

### 이 receipt가 주장하지 않는 것

- C2 아키텍처를 바꾸지 않았다. 시간 구간 XBRL alias를 되살리지 않았다.
- 897개 작업 항목을 넓히거나 승격하지 않았다. 사람의 QName 판정 기구를 만들지 않았다.
- 5A-3을 넓히지 않았다. share-basis·사건 의미를 바꾸지 않았다.
- 회계 · Q/V · B/M · 랭크 · Gate A~H · 수익률을 건드리지 않았다.


---

## 10.20 5A-2 법적 증거 공급기 — B1/B2 CLOSED · 구조화된 proof · 승격 재검증 — 2026-09-02

5A-2의 병목은 더 이상 identity 아키텍처가 아니었다. 제안 경로는 이미 작업 항목마다
`ClassEvidence`를 받고 승격기도 구현·검토가 끝나 있었다. 빠진 것은 **SEC 원문의 명시
법적 증거를 읽어 그 원문이 실제로 증명하는 것만 `ClassEvidence`로 만드는 좁은 공급기**
하나였다. 이번에 그것을 넣었다. **production identity manifest는 바꾸지 않았다.**

### 사용자 결정 두 개를 CLOSED로 구현했다

**B1 — 표지 제목은 filing 관측이지 자동으로 temporal production alias가 아니다.**
`Security12bTitle`은 "그 accession이 그 증권을 그렇게 불렀다"를 증명하지 "그 철자가
class 수명 내내 유효했다"를 증명하지 않는다. 그래서 `_class_packets()`가 바뀌었다.

```text
제목 있음 + cover_title_interval 있음  ->  SECURITY_TITLE_FACT production 제안
제목 있음 + cover_title_interval 없음  ->  CoverPageProof에만 남고 제안 행이 없다
```

구간 없는 제목은 제안되지 않으므로 `PROSE_ALIAS_INTERVAL_NOT_EXPLICIT`도 붙지 않는다 —
애초에 production 관계가 될 자격이 없던 것에 가짜 사유를 만들지 않는다. 그 사유는
**실제로 제안된** prose 관계에만 남아 있고(테스트로 잠갔다), package는 canonical bridge가
없어 `REVIEW_REQUIRED`로 남는다.

**B2 — 탄생 증거만으로는 `effective_to = null`이 되지 않는다.** 종료를 못 찾았다는
것은 연속성의 증거가 아니다. 다섯 조건을 전부 만족해야 무기한 수명이 나온다.

```text
A  명시 CLASS_BIRTH 정확히 하나 (충돌하면 UNRESOLVED)
B  current-in-effect 완전 governing snapshot이 그 정확한 N1 class를 정의한다
C  governing amendment 탐색이 COMPLETE
D  탄생 이후 모든 governing 후보의 class 영향이 해소됐다
E  명시 종료가 없다 (있으면 effective_to = 그 종료일)
```

D의 해소 기준이 좁다 — **대상 class 이름의 부재는 영향 없음의 증명이 아니므로** 탄생 뒤
governing 문서는 그 class를 명시로 정의해야만 해소된 것으로 센다.

### 새 모듈 — `backtest/qv_identity_legal_evidence.py`

```text
SEC submission/accession 문서 -> 명시 legal 사실 -> 구조화된 proof -> ClassEvidence
```

자동 anchor는 **정확한 N1 동일성 하나**다(`N1(표지 제목) == N1(governing class 이름)`).
XBRL member 철자 · class 글자 유사도 · sibling 순서 · ticker/액면가 유사도 · 주식수 ·
`COVER_GROUP_LABEL` · 근사 prose 유사도로 잇지 않는다. 제목 없는 sibling은 charter가
같은 이름을 정의해도 연결되지 않고 `REVIEW_REQUIRED`로 남는다.

semantic family는 열거돼 있다 — 정의 3종(`authorized to issue` · `divided into` ·
`designated`), 발효일 4종(`effective as of` · `becomes/became effective on` ·
`effective date of/is` · `effective on`), 종료 4종(reclassified · eliminated/cancelled ·
전체 class converted). block 분해는 `qv_events.html_blocks`를 그대로 쓴다. 토큰 창
점수 · 최근접 날짜 · "가장 그럴듯한 class"가 없다.

**instrument 발효일은 문서 수준으로 정확히 하나여야 한다.** 둘 이상이면 어느 것이 그
행위의 발효일인지 기계로 정할 수 없어 아무것도 증명하지 못한다.

### 실측이 드러낸 defect 셋 — 전부 고쳤다

**1. `index.json`의 `type`은 문서 종류가 아니라 아이콘 이름이다.**

```text
{"name": "d395522dex31.htm", "type": "text.gif"}
```

처음 구현은 `type.startswith("EX-3")`으로 governing exhibit을 찾았는데, 실 SEC에서 그
값은 `text.gif`·`compressed.gif`라 **EX-3 exhibit이 하나도 발견되지 않았다**(ABMD 385
accession에서 governing 문서 2건). 문서별 `<TYPE>`·`<FILENAME>`·`<SEQUENCE>`와 8-K
`<ITEMS>`는 accession의 SGML header 색인(`<accession>-index-headers.html`)에만 구조화돼
있다. `EdgarClient.accession_header_index()`와 `parse_accession_header()`로 바꾼 뒤
ABMD의 governing 문서가 13건이 됐다.

**2. `EX-3` 문자열 prefix 비교가 SOX 인증서를 끌어왔다.** `"EX-31.1".startswith("EX-3")`이
참이라 `EX-31.1`·`EX-32.1`이 전부 governing 후보가 됐고, 분류 불가로 ABMD 385건 중
**102건이 실패**해 멀쩡한 등록인이 통째로 INCOMPLETE가 됐다. 전시번호 3 뒤에 다른 숫자가
붙지 않는 것만 받도록 고쳤다(`EX-3` · `EX-3.1` · `EX-3.2.1` · `EX-3(i)` 통과,
`EX-31.1` · `EX-32.1` · `EX-30` 탈락).

**3. 2001년 이전 flat layout이 조용히 COMPLETE를 만들 뻔했다.** 그 시기 accession에는
`-index-headers.html`이 없고(HTTP 404) complete submission의 `<DOCUMENT>` 블록에
`<FILENAME>`이 없다. 폴백만 두면 "선언된 문서 0건 = 후보 없음"이 되어 그 시기 governing
instrument를 하나도 안 본 채 무기한 수명이 만들어진다. **파일 이름 없이 선언된 문서 수를
세어 `legacy_layout` 실패로 적는다** — 후보 0건과 명시적으로 구분한다.

### 탐색 closure와 지평

`COMPLETE`는 선언된 지평(`8-K` · `10-K` · `10-Q` 계열)이 요구하는 accession/문서를 전부
열거하고 모든 governing 후보를 받아 분류했다는 뜻이다. submissions archive 실패 ·
header 색인 실패 · 문서 fetch 실패 · 분류 불가 후보 · legacy layout 중 하나라도 있으면
`INCOMPLETE`이고, 그 상태로는 어떤 구간도 나오지 않는다. 건수·연도 상한은 correctness
규칙으로 쓰지 않는다. **지평 밖 form은 `accessions_outside_horizon`에 수량으로 남는다.**

### 구조화된 proof와 승격 재검증 — 함수가 하나다

제안 packet에 `legal_evidence_proof`가 기계가 읽는 구조로 실린다(문서 자연키·form·
document_role·acceptance·source_url·SHA·분류, finding별 `block:<ordinal>` locator,
실패 목록, cover class별 proof). SEC HTML 본문은 넣지 않는다.

```text
class_evidence_from_legal_proof(legal_evidence_proof, cover_proof) -> ClassEvidence
```

5A-2 제안 생성과 5A-2c 승격 재검증이 **이 순수 함수 하나**를 쓴다. 저장된 결론 칸
(`proposal_status` · `reason_codes` · `interval_proved` · `search_status` · `status` ·
`birth_date`)을 믿지 않고 `documents` · `findings` · `failures`에서 다시 계산한다.
승격기는 여전히 네트워크를 부르지 않는다.

### K/Q exhibit 증거 원장

`register_evidence_document`가 form만 보고 K/Q를 통째로 거부하던 것을 좁혔다. governing
instrument는 10-K/10-Q accession의 **exhibit**으로 올 수 있고 그때는 그 문서의 정확한
정체성·SHA가 중요하다.

```text
K/Q PRIMARY  -> 거부 (qv_sec_filings가 filing 정본이다)
K/Q EXHIBIT  -> 허용 (SEC_EVIDENCE_DOCUMENT)
```

`qv_sec_filings`는 넓히지 않았다. submission row 열거만 `forms` 필터를 선택적으로 받고
적재 경로는 기본값(K/Q 계열)을 그대로 쓴다.

### 회귀 — 36개 요구를 network-free fixture로 잠갔다

`tests/test_qv_identity_legal_evidence.py`(56건). 축별로:

```text
B1        구간 없는 표지 제목은 관측으로만 남고 production 행이 되지 않는다 ·
          가짜 PROSE_ALIAS_INTERVAL_NOT_EXPLICIT가 생기지 않는다 ·
          canonical bridge가 없어 REVIEW_REQUIRED로 남는다
탄생      정확한 N1 정의 + 명시 발효일이 있어야 탄생이다 · 발효일 없으면 탄생이 아니다 ·
          수리 시각/최초 관측 filing이 탄생일이 되지 않는다 · XBRL member 철자로
          class 이름을 만들지 않는다 · 근사 제목으로 잇지 않는다 · 탄생일 충돌은 UNRESOLVED
B2        탄생만으로 null이 안 된다 · 탐색 INCOMPLETE면 null이 안 된다 ·
          탄생+current snapshot+COMPLETE면 null이다 · 해소되지 않는 중간 governing
          변경이 막는다 · 다른 class 언급은 negative 증거가 아니다 ·
          index 실패/문서 fetch 실패/분류 불가/legacy layout이 INCOMPLETE를 만든다 ·
          임의 N건 뒤에 멈추지 않는다(관련 증거를 20건 너머에 뒀다)
유한      명시 실행 종료 + 발효일이 유한 구간을 만든다 · 제안/장래 의사는 종료가 아니다 ·
          ticker 소멸과 나중 표지에서의 부재는 종료가 아니다
prose     exact-N1 법적 사슬이 title 구간을 독립적으로 증명한다 · 다른 N1 governing
          이름은 표지 제목 구간을 상속하지 않는다 · class 구간을 prose로 복사하지 않는다
sibling   제목 없는 sibling은 XBRL member 철자로 연결되지 않는다 ·
          모든 보통주 sibling에 여전히 canonical bridge가 필요하다
discovery EX-3 exhibit만 받고 나머지는 fetch하지 않는다 · ITEMS 5.03 primary를 받는다 ·
          5.03 없는 8-K는 primary 후보가 없다 · SOX 인증서는 후보가 아니다 ·
          index.json 아이콘 type을 문서 종류로 쓰지 않는다
receipt   COMPLETE의 결정론적 탐색 receipt · INCOMPLETE의 실패 source ·
          결정론적 직렬화 · submissions 실패 fail-close
승격      무변조 packet은 승격된다(임시 manifest) · effective_from 변조 실패 ·
          증명이 종료를 말하는데 null이면 실패 · 표지 제목 구간 변조 실패 ·
          지어낸 prose bridge 실패 · 실패가 박힌 채 COMPLETE로 고치면 실패 ·
          finding 발효일 변조 실패 · 정의 finding 삭제 실패
원장      K/Q PRIMARY 거부 유지 · K/Q EXHIBIT 허용
실행      기본 경로는 legal 탐색을 돌리지 않는다 · opt-in이 ClassEvidence를 공급한다 ·
          표지 제목 anchor가 없으면 돌지 않는다
```

### 로컬 Python 실측 (2026-09-02)

| 모듈 | 결과 |
|---|---|
| `test_qv_identity_legal_evidence` | 56 OK (신규) |
| `test_qv_identity_proposals` | 103 OK |
| `test_qv_identity_promotion` | 60 OK |
| `test_qv_identity` | 21 OK |
| `test_qv_identity_inventory` | 30 OK |
| `test_qv_symbol_bridge` | 18 OK |
| `test_qv_xbrl_binding` | 35 OK |
| `test_qv_step4` | 138 OK |
| `test_qv_submissions` | 48 OK |
| **전체 trading suite** | **1,797 OK** |

**GitHub CI는 이 숫자를 재현하지 않는다** — `.github/workflows/docker.yml` 하나뿐이고
Python 테스트를 돌리지 않는다. 위 숫자는 전부 로컬 실측이다. CI를 이것 때문에 고치지
않았다.

### 실제 SEC read-only smoke (2026-09-02)

5A-1 inventory(SP500 · `announcements/eodhd-15y-2026-08` ·
`qv-identity-sha256:6124124…`)에서 pilot 5종목을 `--historical --legal-evidence`로 돌렸다.
**어느 packet도 승격하지 않았다.**

| 항목 | CIK | 표지 accession | legal 탐색 | 탄생 | snapshot | 종료 | class/prose 구간 | 최종 | SEC 호출 |
|---|---|---|---|---|---|---|---|---|---|
| AAPL | 0000320193 | `0000320193-26-000020` | INCOMPLETE(legacy 43) | 없음 | 없음 | 없음 | 0 / 0 | REVIEW_REQUIRED | 615 |
| FOXA | 0001754301 | `0001628280-26-053960` | INCOMPLETE(분류 1) | 없음 | 없음 | 없음 | 0 / 0 | REVIEW_REQUIRED | 258 |
| CELG | 0000816284 | `0000816284-19-000046` | INCOMPLETE(legacy 42) | 없음 | 없음 | 없음 | 0 / 0 | REVIEW_REQUIRED | 698 |
| LEH | 0000806085 | (없음) | 미실행 | — | — | — | 0 / 0 | REVIEW_REQUIRED | 115 |
| ABMD | 0000815094 | `0000950170-22-021880` | INCOMPLETE(legacy 30) | 없음 | 없음 | 없음 | 0 / 0 | REVIEW_REQUIRED | 671 |

사유 코드: AAPL·CELG는 `CANONICAL_CLASS_BRIDGE_NOT_EXPLICIT` ·
`CLASS_INTERVAL_NOT_EXPLICIT` · `DEMANDED_CLASS_NOT_PROVED_ORDINARY_COMMON` ·
`SIBLING_CLASS_CENSUS_UNCLEAR`, FOXA·ABMD는 앞의 둘, LEH는
`DISCOVERY_ONLY_NO_SEC_PROOF` · `NO_COVER_PAGE_PROOF_DOCUMENT`(표지 증명 자체가 없어
legal 탐색을 돌리지 않았다).

지평 밖 accession은 AAPL 1,877 · CELG 1,615 · ABMD 1,420 · FOXA 547건이고(대부분 Form 4
계열) 수량으로 receipt에 남는다. 문서 분류 실측: BYLAWS가 압도적이고
(AAPL 31 · CELG 19 · FOXA 11 · ABMD 11) 완전 snapshot은 AAPL 5 · FOXA 3 · CELG 1 ·
ABMD 2건이었다.

**결과를 보고 parser 규칙을 조정하지 않았다.** AUTO 비율을 올리려고 문법을 넓히지 않는다.

### 실 SEC 언어가 드러낸 후속 설계 질문 (문법을 넓히지 않고 보고만 한다)

**표지 제목이 액면가 수식을 달고 있으면 exact-N1 anchor가 성립하지 않는다.** FOXA가
가장 깨끗한 사례다 — 탐색은 거의 닫혔고(분류 실패 1건) 완전 snapshot이 3건 있는데
findings가 0이다.

```text
표지    "Class A Common Stock, par value $0.01 per share"
charter "Class A Common Stock"
```

§5의 CLOSED 규칙대로 exact N1이 아니므로 잇지 않았다. 이것이 실제 coverage의 지배적
차단 요인으로 보이지만, **par-value 수식을 벗기는 정규화는 새 semantic 가정**이므로
사용자 결정 없이 넣지 않았다. 별도 결정 사항으로 올린다.

**2001년 이전 flat layout은 문서 자연키가 없다.** 그 시기 filing이 있는 등록인은 지평이
구조적으로 닫히지 않아 항상 INCOMPLETE다(AAPL 43 · CELG 42 · ABMD 30건). complete
submission 안의 `<DOCUMENT>` 블록을 문서로 취급하려면 `<FILENAME>` 없는 문서의 자연키를
새로 정의해야 하므로 이 증분에서 열지 않았다.

**8-K primary가 Item 5.03 서술 때문에 BYLAWS로 분류된다.** 본문이 "Amended and Restated
Bylaws"를 말하면 그렇게 분류되고, governing class 정의로는 쓰이지 않으므로 결과를
낙관적으로 만들지 않는다. 다만 실 데이터에서 BYLAWS 분류가 압도적인 이유가 이것이다.

### 이 receipt가 주장하지 않는 것

- production identity JSONL을 바꾸지 않았다. 897개를 확장·승격하지 않았다.
- 사람 검토 UI · 수동 override · title-less sibling 추론 · fuzzy class 이름 매칭 ·
  신뢰도 점수 · LLM을 만들지 않았다.
- 넓은 합병/피인수 종료 엔진과 5A-3 전체를 구현하지 않았다.
- C2 accession XBRL binding · share-basis/사건 의미 · 회계 · Q/V · B/M · 랭크를
  건드리지 않았다.
- **Gate A~H는 여전히 미판정이다.** 수익률을 계산하지 않았다.


---

## 10.21 5A-2 법적 증거 — 탄생 semantics · governing 권한 · snapshot closure · 증거 재검증 — 2026-09-02

10.20의 아키텍처는 그대로 두고 semantic 구멍 넷을 닫았다. **production identity
manifest는 여전히 바꾸지 않았고 par-value/N1 정책은 건드리지 않았다**(별도 사용자
결정).

### BLOCKER 1 — 완전 restated instrument의 발효일이 곧 class 탄생일이 아니었다

`_class_findings()`가 "정의 하나 + instrument 발효일 하나"만 보고
`CLASS_BIRTH_EFFECTIVE_DATE`를 만들었다. 그것은 두 사실을 섞는다.

```text
그 restated governing instrument가 D에 발효했다
그 economic class가 D에 만들어졌다
```

class는 나중 amended-and-restated certificate보다 수십 년 앞설 수 있다. 예컨대

```text
authorized to issue Class A Common Stock
this Certificate becomes effective on 2020-01-01
```

가 증명하는 것은 "그 snapshot에 Class A가 정의돼 있다"와 "그 snapshot이 2020-01-01에
operative하다"뿐이고 **"Class A가 2020-01-01에 만들어졌다"가 아니다.**

`GOVERNING_CLASS_DEFINITION`에서 `CLASS_BIRTH_ACTION`을 갈랐다. 열거된 탄생 행위
문법은 넷이다.

```text
hereby created/established ... <NAME>
<NAME> is hereby created/established
new class ... designated <NAME>
reclassified into ... <NAME>
```

`CLASS_BIRTH_EFFECTIVE_DATE`는 같은 instrument에 명시 탄생 행위가 있고 operative
date가 거기 모호함 없이 묶일 때만 나온다. 완전 restatement의 발효일 단독 · snapshot
발효일 · 수리 시각 · filed date · 최초 관측을 쓰지 않고 가까운 날짜를 고르지도 않는다.
원본 governing instrument도 그 언어가 명시로 있을 때만 탄생을 증명한다.

**부수 효과 하나**: 정의만 든 restatement가 둘이어도 그 발효일들은 이제 탄생일 후보가
아니므로 서로 충돌하지 않는다. 전에는 그 둘이 "탄생일 충돌"로 UNRESOLVED가 됐고 그
사유 문구가 사실과 달랐다.

### BLOCKER 2 — B2의 "current" snapshot이 실제로 현재를 닫지 않았다

`project_class_proof()`가 완전 snapshot 중 가장 늦은 것을 골랐는데, 그 뒤에 governing
amendment가 있어도 그 amendment가 대상 class 정의를 되풀이하면 D 검사에서 "해소됨"으로
세어 열린 채 통과했다. **그것은 Certificate/Articles of Amendment를 complete
snapshot으로 승격하는 셈이다.**

최소 보수 규칙을 넣었다.

```text
가장 늦은 완전 snapshot 뒤에 governing amendment가 하나라도 있으면
open-ended continuity는 UNRESOLVED다.
그 상태를 흡수한 나중 완전 restated snapshot이 나와야 다시 열린다.
```

정의를 되풀이한다는 이유로 amendment를 snapshot으로 올려주지 않는다. 유한 명시 종료는
독립된 종료 규칙으로 그대로 처리된다.

### BLOCKER 3 — Item 5.03 primary 8-K 서술이 governing instrument로 읽혔다

Item 5.03 primary는 후보 discovery로는 옳았지만 `classify_document()`가 본문만 보고
분류하므로 `우리는 Certificate of Amendment를 제출했다`라는 **서술**이
`CERTIFICATE_OF_AMENDMENT`로 분류돼 정의·탄생·종료 finding을 만들 수 있었다. 그리고
`classify_document()`는 첫 일치 하나만 돌려주므로 bylaws를 먼저 말하고 charter
amendment를 나중에 말하는 서술은 뒤가 조용히 사라졌다.

discovery는 그대로 두고 **권한**을 갈랐다.

```text
실제 Exhibit 3 문서    -> 본문 분류 뒤 법적 증명 권한
Item 5.03 PRIMARY 8-K  -> filing 서술 / discovery / corroborating receipt 전용
                          여섯 증거 역할을 하나도 만들지 못한다
```

권한 판정 정의는 `document_proof_authority()` 한 곳이고 수집기와 투영기가 같은 함수를
쓴다. 투영기는 저장된 `proof_authority` 칸이 아니라 `document_type`에서 다시 계산한다.

**진짜 증거 공백은 따로 잡는다.** Item 5.03은 정관이 바뀌었다는 구조화된 신고이므로,
그 accession에 주소 지정 가능한 Exhibit 3이 하나도 없으면
`governing_exhibit_missing` 탐색 실패다 — primary 서술로 대신하지 않는다. 대신 분류
실패는 이제 **증명 권한이 있는 문서**에만 탐색 실패다. 그리고 문서가 언급한 family
전부를 `classification_families`로 남겨 서술이 조용히 사라지지 않게 했다.

이 증분에서 embedded 문서 parser를 만들지 않았다.

### BLOCKER 4 — 승격 재검증이 구간 경계만 비교했다

`_assert_legal_projection()`이 `effective_from`/`effective_to`만 대조했다. production
행은 나중에 packet의 구간 증거를 합쳐 넣고 **5A-3가 그 REQUIRED 자연키에서
`usable_from_session`을 파생시킨다.** 그래서 같은 경계를 유지한 채 증거 자연키를
바꿔치면 그 파생이 조용히 달라진다.

정규화된 `ClassEvidence` 전체를 비교하도록 바꿨다.

```text
class_interval · cover_title_interval · extra_prose_bridges
    effective_from · effective_to
    각 EvidenceRef의 source_kind · cik · accession · document_name ·
                     evidence_role · dependency · locator
```

**순서만 결정론적으로 정규화한다.** 추가·삭제·치환은 전부 실패이고 중복을 지우지
않는다 — 하나를 지우면 치환을 못 잡는다. 정규 직렬화·비교 정의는 legal 증거 모듈
한 곳(`canonical_class_evidence` · `canonical_interval` · `canonical_evidence_refs`)에
두고 승격기가 그대로 쓴다.

같은 경계에서 구조화된 proof의 정합성도 fail-close다.

```text
legal proof의 cik != 표지 증명 CIK
cover_accession != CoverPageProof.accession
cover_document_name != CoverPageProof.document_name
finding이 legal_evidence_proof.documents에 없는 문서를 가리킨다
```

`assert_proof_integrity()`가 `class_evidence_from_legal_proof()` 안에 있으므로 제안
생성과 승격 재검증이 **둘 다** 이 검사를 받는다. 승격기는 여전히 네트워크를 부르지
않는다 — 문서 SHA를 실제 SEC 문서와 맞춰 보는 것은 5A-3다.

### 회귀 — network-free fixture로 잠갔다

`tests/test_qv_identity_legal_evidence.py` **80건**(10.20의 56건에서 +24). 새로 잠근 축:

```text
탄생      restated snapshot의 발효일은 탄생일이 아니다 ·
          정의만 든 두 restatement의 발효일은 충돌하는 탄생일이 되지 않는다 ·
          명시 생성 행위 + 발효일이 있어야 탄생이다 ·
          reclassified into도 생성 행위다 ·
          발효일이 정확히 하나여도 생성 행위가 없으면 탄생이 아니다
B2        가장 늦은 완전 snapshot 뒤 amendment가 있으면 null이 없다 ·
          그 amendment가 정의를 되풀이해도 snapshot이 current가 되지 않는다 ·
          나중 완전 restated snapshot이 나오면 다시 열린다 ·
          snapshot 앞의 미해결 amendment는 D 규칙이 따로 막는다
권한      Item 5.03 primary는 발견되지만 증명 권한이 없다 ·
          서술이 정의·생성·발효일을 다 말해도 finding이 0이다 ·
          bylaws를 먼저 말한 서술도 family 전부를 receipt에 남긴다 ·
          실제 EX-3 certificate of amendment는 그대로 유효하다 ·
          실제 EX-3 restated certificate는 그대로 snapshot이다 ·
          Item 5.03에 Exhibit 3이 없으면 governing_exhibit_missing으로 닫히지 않는다 ·
          Exhibit 3이 bylaws여도 주소 지정은 되므로 닫힌다
증거      구간 증거의 accession/문서/역할/locator 치환이 전부 실패 ·
          REQUIRED 증거 삭제·추가가 실패 · 순서만 다른 것은 그대로 승격 ·
          legal proof CIK/cover accession/cover 문서 불일치가 실패 ·
          receipt에 없는 문서를 가리키는 finding이 실패
```

### 로컬 Python 실측 (2026-09-02)

| 모듈 | 결과 |
|---|---|
| `test_qv_identity_legal_evidence` | 80 OK |
| `test_qv_identity_proposals` | 103 OK |
| `test_qv_identity_promotion` | 60 OK |
| `test_qv_identity` | 21 OK |
| `test_qv_identity_inventory` | 30 OK |
| `test_qv_symbol_bridge` | 18 OK |
| `test_qv_xbrl_binding` | 35 OK |
| `test_qv_step4` | 138 OK |
| `test_qv_submissions` | 48 OK |
| **전체 trading suite** | **1,821 OK** |

**GitHub CI는 이 숫자를 재현하지 않는다** — `.github/workflows/docker.yml` 하나뿐이고
Python 테스트를 돌리지 않는다. CI를 이것 때문에 고치지 않았다.

### 실제 SEC read-only smoke (2026-09-02, 같은 5A-1 inventory)

`--historical --legal-evidence`. **어느 packet도 승격하지 않았고 결과를 보고 문법을
고치지 않았다.**

| 항목 | CIK | legal 탐색 | 실패 종류 | 문서(권한 있음/서술) | 탄생 | 구간 | 최종 | SEC 호출 |
|---|---|---|---|---|---|---|---|---|
| AAPL | 0000320193 | INCOMPLETE | legacy 43 · exhibit_missing 1 | 37 (22/15) | 없음 | 0 | REVIEW_REQUIRED | 615 |
| FOXA | 0001754301 | INCOMPLETE | classify 1 | 15 (9/6) | 없음 | 0 | REVIEW_REQUIRED | 258 |
| CELG | 0000816284 | INCOMPLETE | legacy 42 | 22 (14/8) | 없음 | 0 | REVIEW_REQUIRED | 698 |
| LEH | 0000806085 | 미실행(표지 증명 없음) | — | — | — | 0 | REVIEW_REQUIRED | 115 |
| ABMD | 0000815094 | INCOMPLETE | legacy 30 | 13 (11/2) | 없음 | 0 | REVIEW_REQUIRED | 671 |

10.20과 견줘 달라진 것 둘이다. **AAPL에 `governing_exhibit_missing` 1건이 새로
생겼다** — Item 5.03 8-K인데 주소 지정 가능한 Exhibit 3이 없어 전에는 primary 서술이
후보로 남았고 지금은 명시 탐색 실패다. 그리고 **문서 receipt가 권한별로 갈렸다** —
서술 문서가 AAPL 15 · CELG 8 · FOXA 6 · ABMD 2건이고 그것들은 이제 어떤 finding도
만들지 못한다.

### 새로 관찰된 미지원 SEC 언어 (문법을 넓히지 않고 보고만 한다)

**탄생 행위 문법이 실 pilot에서 한 건도 걸리지 않았다.** 다섯 종목 전부 finding이
0인데, FOXA는 par-value anchor 때문에 정의 단계에서 이미 막히고 나머지는 탐색이 legacy
layout으로 닫히지 않아 그 앞에서 멈춘다. 그래서 **이번 pilot은 탄생 문법의 실제
recall을 재지 못했다** — 문법이 좁아서 못 잡은 것인지 앞 단계에서 막힌 것인지 구분할
표본이 없다. 탐색이 닫히는 등록인 표본이 생긴 뒤에 다시 봐야 한다.

이전에 올린 두 질문은 그대로다 — 표지 제목의 par-value 수식(`Class A Common Stock,
par value $0.01 per share` vs charter의 `Class A Common Stock`)과 2001년 이전 flat
layout의 문서 자연키. **둘 다 이번 fix에서 건드리지 않았다.**

### 이 receipt가 주장하지 않는 것

- B1/B2를 바꾸지 않았고 par-value 정규화·exact N1을 건드리지 않았다.
- production identity JSONL을 바꾸지 않았고 897개를 확장·승격하지 않았다.
- fuzzy/LLM/신뢰도 · 사람 검토 UI · 넓은 합병 종료 엔진 · embedded 문서 parser ·
  5A-3 전체를 만들지 않았다.
- C2 accession binding · share-basis/사건 의미 · 회계 · Q/V · B/M · 랭크 ·
  Gate A~H · 수익률을 건드리지 않았다.


---

## 10.22 5A-2 법적 연대기 — governing operative date로 순서를 세운다 — 2026-09-02

10.21의 네 fix는 그대로 두고 마지막 연대기 구멍 하나를 닫았다. **production identity
manifest는 여전히 바꾸지 않았고 par-value/exact-N1 정책도 건드리지 않았다.**

### BLOCKER — 법적 연대기가 SEC 수리 순서를 쓰고 있었다

`_document_order()`가 `acceptance_datetime` → `accession` → `document_name`으로 정렬했고
`project_class_proof()`가 그 순서로 세 가지를 정했다.

```text
가장 늦은 완전 governing snapshot이 무엇인가
amendment가 그 snapshot보다 뒤인가
탄생 이후의 governing 변경이 무엇인가
```

이것은 이미 CLOSED인 구분을 어긴다.

```text
경제적/법적 유효성   !=   SEC 지식 가용성
```

SEC 수리 시각은 그 증거를 **언제 알 수 있었는가**를 정하지, governing 행위가 **언제
법적으로 발효했는가**를 정하지 않는다. **EDGAR가 늦게 받았다는 이유로 문서가 경제적으로
더 나중이 되지 않는다.**

### 구조화된 operative-date 사실 하나

기존 좁은 `EFFECTIVE_DATE_PATTERNS`를 그대로 쓰고 문서 수준 사실 하나로 모았다
(`governing_operative_date()`).

```text
명시 발효일 하나        -> RESOLVED   그 문서의 법적 as-of가 정해진다
하나도 없다             -> MISSING    그 문서의 법적 연대기는 미해결이다
서로 다른 둘 이상       -> AMBIGUOUS  법적 연대기가 모호하다
```

가장 가까운/이른/늦은 날짜를 고르지 않고 SEC 수리 시각으로 되돌아가지 않는다. 그 값이
문서 receipt에 자연키·locator와 함께 남는다.

```text
legal_operative_status · legal_operative_date · legal_operative_locator ·
legal_operative_observed
```

`CLASS_BIRTH_EFFECTIVE_DATE`와 `CLASS_TERMINATION_EFFECTIVE_DATE`도 **같은 값**에서
나온다 — 경제적 날짜의 원천이 문서마다 하나다. 문서에 operative date가 있다고 탄생이
증명되는 것은 아니다(탄생은 여전히 `CLASS_BIRTH_ACTION`이 함께 있어야 한다). 중복
계산이던 옛 `instrument_effective_dates()`/`_effective_date_hits()`는 없앴다.

### B2 연대기와 fail-close

현재 완전 snapshot 선택과 "그 뒤 amendment" 판정, 탄생 이후 변경 판정이 전부 법적
operative date로 바뀌었다.

```text
restated snapshot   법적 2020-05-15 / SEC 수리 2020-07-01
amendment           법적 2020-06-01 / SEC 수리 2020-06-03
```

수리 순서로는 amendment가 앞이지만 법적으로는 뒤이므로 `effective_to = null`은 막힌다.
반대로 법적으로 앞인 amendment는 SEC가 나중에 받았더라도 나중 완전 snapshot이 흡수할 수
있다.

연대기를 세울 수 없으면 자동 open-ended는 `UNRESOLVED`다.

```text
open-ended에 필요한 governing 문서 중 하나라도 유일한 명시 operative date가 없다
같은 날짜의 완전 snapshot이 둘 -> 어느 것이 current인지 정할 수 없다
amendment가 snapshot과 같은 날 -> 앞인지 뒤인지 정할 수 없다
탄생일과 같은 날의 미해소 문서 -> 탄생 앞뒤를 정할 수 없다
```

**accession tie-break를 만들지 않았다** — 그것은 semantic 순서가 아니다. 결정론적
자연키 정렬은 탐색 순회·직렬화·표시에만 남는다.

### 승격 재검증

`project_class_proof()`가 packet의 `legal_operative_date`를 읽으므로 제안 생성과 승격
재검증이 **같은 구조화된 연대기 하나**를 쓴다. 두 번째 구현이 없고 승격기는 여전히
offline이다.

`assert_proof_integrity()`에 단일 원천 잠금을 하나 더했다 — finding의 경제적 날짜가 그
문서의 법적 operative date와 다르면 fail-close다. 생성기가 둘을 같은 `OperativeDate`
하나에서 만들므로 packet에서 갈라져 있으면 어느 쪽이 참인지 알 수 없고, 고르지 않고
멈춘다.

### 회귀 — 되돌리면 실제로 깨진다

`_legal_date()`를 `acceptance_datetime`으로 임시로 되돌려 **일곱 개가 실패하는 것을
확인**한 뒤 복구했다.

```text
법적 순서가 SEC 수리 순서를 이긴다(snapshot 05-15/수리 07-01 vs amendment 06-01/수리 06-03)
수리는 늦지만 법적으로 앞인 amendment는 나중 완전 snapshot이 흡수한다
완전 snapshot에 명시 operative date가 없으면 미해결이다
관련 governing amendment에 명시 operative date가 없으면 미해결이다
한 문서에 서로 다른 발효일이 둘이면 하나를 고르지 않는다(AMBIGUOUS)
같은 법적 발효일의 완전 snapshot이 둘이면 fail-close다
amendment가 snapshot과 같은 법적 발효일이면 fail-close다
```

그리고 **수리 시각만 바꾸고 법적 발효일을 그대로 두면 경제적 구간이 바뀌지 않는다**
(공급기와 승격 재검증 양쪽에서). 문서 operative date나 finding 발효일을 고치면 실패한다.

`test_qv_identity_legal_evidence`는 80 -> **92건**이다.

### 로컬 Python 실측 (2026-09-02)

| 모듈 | 결과 |
|---|---|
| `test_qv_identity_legal_evidence` | 92 OK |
| `test_qv_identity_proposals` | 103 OK |
| `test_qv_identity_promotion` | 60 OK |
| `test_qv_identity` | 21 OK |
| `test_qv_identity_inventory` | 30 OK |
| `test_qv_symbol_bridge` | 18 OK |
| `test_qv_xbrl_binding` | 35 OK |
| `test_qv_step4` | 138 OK |
| `test_qv_submissions` | 48 OK |
| **전체 trading suite** | **1,833 OK** |

**GitHub CI는 이 숫자를 재현하지 않는다** — docker 워크플로 하나뿐이고 Python 테스트를
돌리지 않는다.

### 실제 SEC read-only smoke (2026-09-02, 같은 5A-1 inventory)

`--historical --legal-evidence`. **어느 packet도 승격하지 않았고 결과를 보고 문법을
고치지 않았다.** 최종 판정은 다섯 종목 모두 `REVIEW_REQUIRED`로 10.21과 같다.

| 항목 | governing exhibit | operative date RESOLVED / MISSING / AMBIGUOUS | 탐색 | SEC 호출 |
|---|---|---|---|---|
| AAPL | 22 | 0 / 22 / 0 | INCOMPLETE(legacy 43 · exhibit_missing 1) | 615 |
| FOXA | 9 | 5 / 4 / 0 | INCOMPLETE(classify 1) | 258 |
| CELG | 14 | 0 / 14 / 0 | INCOMPLETE(legacy 42) | 698 |
| LEH | — | — | 미실행(표지 증명 없음) | 115 |
| ABMD | 10 | 1 / 9 / 0 | INCOMPLETE(legacy 30 · document 1) | 671 |

ABMD의 `document` 실패 1건은 **일시적 SEC 오류**다(`HTTP 503`,
`0001564590-20-003682/abmd-ex321_663.htm`). 코드 변화가 아니라 그 시각 EDGAR 응답이다.

### 새로 측정된 것 — operative-date 문법의 실제 recall이 매우 낮다 (설계 질문)

이번 smoke가 처음으로 **실제 governing exhibit에 대한 operative-date recall**을 쟀다.

```text
AAPL  governing exhibit 22건 중 22건이 MISSING
CELG  14건 중 14건이 MISSING
ABMD  10건 중 9건이 MISSING
FOXA   9건 중 4건이 MISSING
```

FOXA에서 RESOLVED가 나온 5건은 **전부 bylaws**이고, 실제
`AMENDED_AND_RESTATED_CERTIFICATE` 3건은 모두 MISSING이다. 즉 실 charter는 열거된 네
표현(`effective as of D` · `shall become/became effective on D` ·
`effective date of/is D` · `effective on D`)으로 자기 발효일을 말하지 않는다 — 흔한
실제 표현은 `effective upon filing with the Secretary of State`이거나 서명/집행 블록의
날짜다.

**그래서 지금 규칙 아래 B2 open-ended continuity는 실 발행사 대부분에서 도달 불가능하다.**
이 fix가 그렇게 만든 것이 아니라, 전에는 SEC 수리 순서가 그 공백을 조용히 메우고 있었고
이제 그것이 정직하게 드러난 것이다.

**문법을 넓히지 않았다.** `effective upon filing`류를 받으려면 "filing 시점"을 무엇으로
볼지(그리고 그것이 SEC 수리 시각과 어떻게 다른지)를 새로 정해야 하고, 서명 블록 날짜는
§9.2가 명시로 금지한 "execution/signature date by itself"에 닿는다. 둘 다 사용자
결정이 필요한 semantic 확장이므로 후속 설계 질문으로 올린다.

이전 두 질문은 그대로다 — 표지 제목의 par-value 수식과 2001년 이전 flat layout의 문서
자연키. **둘 다 이번에도 건드리지 않았다.**

### 이 receipt가 주장하지 않는 것

- B1/B2 · exact N1 · par-value 정책을 바꾸지 않았다.
- production identity JSONL을 바꾸지 않았고 897개를 확장·승격하지 않았다.
- C2 · 사람 검토 · 넓은 합병 종료 · 5A-3 전체를 만들지 않았다.
- 회계 · Q/V · B/M · 랭크 · Gate A~H · 수익률을 건드리지 않았다.


---

## 10.23 5A-2 recall 확장 — O2 주 filing 시점 · P2 액면가 연결 정규화 — 2026-09-02

**사용자 승인 CLOSED 결정 둘만 구현했다.** 다른 자동 증거 규칙을 느슨하게 하지 않았다.
production identity JSONL · `qv_manifest.prose_key` · `qv-class-id-v1` · C2 accession
binding · 회계/Q/V/B-M/랭크/Gate/수익률을 건드리지 않았다. 897개를 확장·승격하지 않았고
5A-3도 만들지 않았다.

계약 정본은 `docs/trading/strategies/qv-step5-phase0-materialization-design.md`의 5A-2
절(**O2** · **P2**)이다. 여기에는 구현·테스트·pilot 실측만 적는다.

### O2 — 법적 시점의 출처가 셋이 됐다

```text
EXPLICIT_EFFECTIVE_DATE          기존 좁은 문법 그대로
STATE_CERTIFIED_EFFECTIVE_DATE   같은 Exhibit 3 안의 주 증명이 명시한 발효일/발효시각
STATE_FILED_UPON_FILING          제출 발효 명시 조항 + 같은 문서의 주 FILED 스탬프
```

`OperativeDate`가 `status · date · source_family · supporting_locators · observed`를
든다. `STATE_FILED_UPON_FILING`은 조항 locator와 스탬프 locator를 **둘 다** 남기고,
`assert_proof_integrity()`가 family별 locator 개수와 탄생일 finding의 locator 일치를
fail-close로 잠근다. `acceptance_datetime`은 provenance로 그대로 남는다.

**바뀌지 않은 것**: SEC 수리 시각·EDGAR 접수·filed date·report date·서명일 단독은
여전히 법적 시점이 아니다. 지연 발효는 명시 발효일이 지배하고(스탬프는 제출 발효
조항이 없으면 애초에 후보가 아니다), 제출 발효를 말하면서 다른 명시 발효일까지 들면
`AMBIGUOUS`다. 주 기관 어휘는 `Secretary of State` · `Division of Corporations` ·
`Department of State` 셋으로 열거돼 있다.

### P2 — 액면가 수식은 연결 경계에서만 무시된다

`class_designation_anchor()`가 **끝에 붙은 인식된 숫자 액면가 수식** 하나만 떼어내고
값은 Decimal로 정확히 읽는다(float·허용 오차 없음). `associate_class_designation()`이
연결 판정의 **유일한 정의**이고 생성기와 승격기가 같은 함수를 돌린다.

```text
exact N1을 먼저 본다                          -> EXACT_N1
실패했을 때만 core designation을 본다
  한쪽만 숫자 액면가 / 양쪽이 Decimal 동일    -> NUMERIC_PAR_VALUE_SUFFIX
  양쪽 숫자 액면가가 다르다                   -> 연결하지 않는다
```

fail-close 셋: 같은 core가 서로 다른 숫자 액면가로 나타남 · 같은 표지의 다른 보통주
제목이 같은 core로 줄어듦 · 서로 다른 governing designation 여럿에 닿음. 일치 자리에서
앞이 더 긴 designation의 꼬리이거나(`Class A ` + `Common Stock`) 뒤가 값 수식처럼
보이는데 동결 문법에 없으면 그 자리를 버린다.

**연결 동치 != production alias 동치.** P2로 연결된 class는 governing 이름의
`GOVERNING_INSTRUMENT` bridge만 얻고 표지 제목은 `cover_title_interval`을 받지 못한다
(B1 그대로). 연결 전용 designation key는 class-ID seed에 들어가지 않는다.

**Step 4의 CLOSED 계약 하나가 이 결정으로 다시 열려 닫혔다** —
`test_an_approximate_title_never_links_a_governing_class`(액면가 제목은 절대 연결되지
않는다)가 `test_a_numeric_par_value_title_associates_but_keeps_its_own_n1`으로 바뀌었다.
N1과 production alias 격리는 그 테스트가 계속 잠근다.

### 로컬 Python 실측 (2026-09-02)

| 모듈 | 이전 | 이번 |
|---|---|---|
| `test_qv_identity_legal_evidence` | 92 | **143 OK** |
| `test_qv_identity_proposals` | 103 | 103 OK |
| `test_qv_identity_promotion` | 60 | 60 OK |
| `test_qv_identity` | 21 | 21 OK |
| `test_qv_identity_inventory` | 30 | 30 OK |
| `test_qv_symbol_bridge` | 18 | 18 OK |
| `test_qv_xbrl_binding` | 35 | 35 OK |
| `test_qv_step4` | 138 | 138 OK |
| `test_qv_submissions` | 48 | 48 OK |
| **전체 trading suite** | 1,833 | **1,884 OK** |

**GitHub CI는 이 숫자를 재현하지 않는다** — `.github/workflows/docker.yml` 하나뿐이고
`npm ci` · `npm test`(Node)만 돌린다. Python 테스트를 돌리지 않으므로 CI 통과가 위
숫자의 독립 재현이 아니다. CI를 이것 때문에 고치지 않았다.

### 실제 SEC read-only smoke (2026-09-02, 같은 5A-1 inventory)

`--historical --legal-evidence`, manifest `qv-identity-sha256:6124124…`. **어느 packet도
승격하지 않았고 결과를 보고 문법을 고치지 않았다.** SEC 호출 2,350(이전 실행의 종목별
합 2,357). 최종 판정은 여섯 작업 항목 모두 `REVIEW_REQUIRED`로 10.22와 같다.

| 항목 | governing exhibit | operative R/M/A | source family | 탐색 실패 |
|---|---|---|---|---|
| AAPL | 22 → **22** | 0/22/0 → **0/22/0** | — | legacy 43 · exhibit_missing 1 (그대로) |
| FOXA | 9 → **9** | 5/4/0 → **5/4/0** | EXPLICIT 5 | classify 1 (그대로) |
| CELG | 14 → **14** | 0/14/0 → **0/14/0** | — | legacy 42 (그대로) |
| LEH | — | — | — | 미실행(표지 증명 없음) |
| ABMD | 10 → **11** | 1/9/0 → **1/10/0** | EXPLICIT 1 | legacy 30 (그대로) |

**O2의 실 recall 개선은 0이다.** 이번 pilot의 governing exhibit 어디에서도
`STATE_CERTIFIED_EFFECTIVE_DATE`·`STATE_FILED_UPON_FILING`이 한 건도 걸리지 않았다.
ABMD의 governing exhibit이 10 → 11로 는 것은 문법이 아니라 지난 실행의 일시적 SEC
오류(`HTTP 503`) 1건이 이번에는 정상 응답한 결과다.

**P2는 실제로 막혀 있던 정의를 열었다.**

| 항목 | 표지 제목 | designation | 연결 | 정의 finding (이전 → 이번) |
|---|---|---|---|---|
| AAPL | `Common Stock, $0.00001 par value per share` | `common stock` | NUMERIC_PAR_VALUE_SUFFIX | 0 → **3** |
| CELG | `Common Stock, par value $.01 per share` | `common stock` | NUMERIC_PAR_VALUE_SUFFIX | 0 → **1** |
| ABMD | `Common Stock, $0.01 par value` | `common stock` | 없음 | 0 → 0 |
| FOXA | `Class A/B Common Stock, par value $0.01 per share` | `class a/b common stock` | 없음 | 0 → 0 |

exact-N1 anchor는 다섯 종목 모두 이전에도 이번에도 **0**이다 — 표지 제목이 전부 액면가
수식을 달고 있어 governing 이름과 N1으로 같을 수 없었다. 액면가 충돌·P2 모호성은 이번
pilot에서 0건이다.

이전 = 이번의 직접 대조는 같은 문서에 이전 target(표지 제목 원문)과 이번 target(core
designation)을 각각 걸어 확인했다.

```text
AAPL 0001193125-14-084697/d684095dex31.htm block:13
  "authorized to issue one class of shares designated “Common Stock,” par value
   $0.00001 per share"
  이전 target 정의 일치 0 · 이번 target 정의 일치 1

CELG 0001193125-14-241821/d744699dex31.htm block:10
  "1,150,000,000 shares of the par value of $.01 per share shall be designated
   ‘Common Stock’"
  이전 target 정의 일치 0 · 이번 target 정의 일치 1
```

**그래도 class 구간은 여전히 0/0이다.** 다섯 종목 전부 탐색이 닫히지 않아
(`legacy_layout` · `classify` · `governing_exhibit_missing`) `search_status`가
`INCOMPLETE`이고, 그 상태로는 어떤 구간도 나오지 않는다. **P2/O2가 만든 상태가
아니다** — §20의 별도 진단이다.

### FOXA — par-value anchor는 더 이상 막는 요인이 아니다 (그러나 여전히 막힌다)

가장 깨끗한 사례였던 FOXA를 실제로 확인했다. P2 연결 자리 규칙은 **통과한다.**

```text
d721949dex31.htm block:18
  "consisting of 2,000,000,000 shares of Class A Common Stock, par value $0.01 per
   share (“Class A Common Stock”), 1,000,000,000 shares of Class B Common Stock,
   par value $0.01 per share …"

_designation_site -> ("Class A Common Stock", "$0.01")   표지 $0.01과 Decimal 동일
                  -> ("Class B Common Stock", "$0.01")   표지 $0.01과 Decimal 동일
```

막는 것은 이제 **class 정의 문법**이다. 실제 charter는 `authorized to issue … shares
of <NAME>`이 아니라 `shall have authority to issue … consisting of … shares of
<NAME>`로 말하고, 동결된 세 정의 shape(`AUTHORIZED_TO_ISSUE` · `DIVIDED_INTO` ·
`DESIGNATED`) 어느 것도 걸리지 않는다(일치 0/0/0, 탄생 행위도 0). **이번 증분의 승인
범위가 아니므로 넓히지 않았고 후속 설계 질문으로 올린다.**

### 이번 pilot이 드러낸 후속 설계 질문 (문법을 넓히지 않고 보고만 한다)

1. **주 스탬프의 실제 표기가 동결된 날짜 토큰과 맞지 않는다.** 실 Delaware 스탬프는
   `FILED 09:00 AM 01/03/2022`처럼 숫자 날짜이거나 전부 대문자다. 동결된 `_DATE`는
   산문 날짜(`January 3, 2022`)만 받고 `_iso_date`는 대소문자를 가리므로 둘 다
   `MISSING`이다(offline 확인). 숫자 날짜 토큰을 여는 것은 **새 날짜 문법 결정**이고
   `_iso_date`는 `qv_events`와 공유하므로 이 증분에서 건드리지 않았다. **이것이 O2
   개선 0의 가장 유력한 원인이다.**
2. **닫는 따옴표가 액면가 수식을 가린다.** AAPL의 `designated “Common Stock,” par
   value $0.00001 per share`에서 이름 바로 뒤가 `,”`라 인식 문법에도 값 수식 탐지에도
   걸리지 않아 그 자리의 액면가가 `None`으로 관측된다. 지금은 한쪽만 액면가를 든 것이
   되어 연결이 허용된다 — **양쪽 값이 실제로 달랐다면 충돌을 못 잡는 좁은 구멍이다.**
   따옴표를 통과시키는 것은 결과를 본 뒤의 문법 변경이므로 하지 않았다.
3. **class 정의 문법이 실 charter 표현을 덮지 못한다**(위 FOXA 절).
4. 2001년 이전 flat layout의 문서 자연키는 그대로 열려 있다(§21). `legacy_layout ->
   INCOMPLETE` fail-close를 유지했다.

### 이 receipt가 주장하지 않는 것

- O2/P2 밖의 어떤 자동 증거 규칙도 느슨하게 하지 않았다.
- `qv_manifest.prose_key` · `qv-class-id-v1` · production identity JSONL을 바꾸지 않았다.
- P2만으로 production alias를 만들지 않았고 class 수명을 표지 제목 수명으로 복사하지
  않았다.
- legacy flat layout · 누락 Exhibit 3 · 분류 실패 · 명시 탄생 행위 부재를 고치지 않았다.
- 897개 확장·승격 · 5A-3 · C2 binding · 회계/Q/V/B-M/랭크/Gate/수익률을 건드리지 않았다.


## 10.24 5A-2 후속 — 인용부호 뒤 액면가 · 주 자료 날짜 표기 — 2026-09-03

10.23이 올린 후속 설계 질문 **둘만** 고쳤다(리뷰가 지정한 BLOCKER 1 · MAJOR 2). 나머지
셋(`shall have authority to issue … consisting of` 정의 문법 · legacy flat layout 자연키 ·
governing exhibit 누락)은 그대로 열어뒀고 탄생·snapshot·종료 문법도 건드리지 않았다.
production identity JSONL · `qv_manifest.prose_key` · `qv-class-id-v1` · SEC 수리 의미론은
그대로다. 계약 정본은 설계 문서의 5A-2 절(**O2** · **P2**)이다.

### 1. 닫는 인용부호가 진짜 액면가 충돌을 가릴 수 있었다 (BLOCKER)

```text
designated “Common Stock,” par value $0.00001 per share
                         ^^ 이름 그룹이 여기서 끝나고 그 뒤를 못 읽었다
```

`_LEADING_PAR_SUFFIX`도 `_VALUE_SHAPED`도 인용부호를 지나가지 못해 그 자리의 액면가가
`None`으로 관측됐다. **그러면 다른 액면가를 든 표지 제목이 `PAR_VALUE_CONFLICT`가 아니라
"한쪽만 액면가를 든 정상 연결"로 보인다** — P2 fail-close가 조용히 열린다.

designation 자리에서만 열거된 닫는 인용부호 **하나**(`"` · `”` · `'` · `’`)와 그에 인접한
쉼표·공백을 지나가고, 지나간 뒤에는 동결된 숫자 액면가 문법을 그대로 적용한다. 인식
경로와 fail-close 경로 **둘 다**에 같은 구분자를 열어서 인용부호 뒤의 `no par value` ·
`stated value $0.01`은 여전히 그 자리를 버린다. 일반 구두점 제거가 아니고 괄호·임의 뒤
산문을 벗기지 않으며 전역 N1과 표지 종단 수식은 그대로다.

### 2. O2가 실제 주 스탬프 날짜 표기를 못 읽었다 (MAJOR)

```text
실제        Secretary of State ... FILED 09:00 AM 01/03/2022
동결 _DATE  January 3, 2022
```

**공유 `qv_events._iso_date`의 의미는 넓히지 않았다.** 이미 `_state_filing_material`
게이트를 통과한 주 자료 **안에서만** `MM/DD/YYYY` · `Month D, YYYY` · 같은 영어 월 이름의
대소문자 변형을 읽는 O2 전용 parser를 뒀다. `MM/DD/YYYY`를 미국 월/일/년으로 읽는 것은 그
게이트 안에서만 참이고, 달력으로 성립하지 않는 날짜와 모르는 월 이름은 추측하지 않고
버린다. 게이트 없는 일반 발효일 문법은 이 모양을 쓰지 않으므로 숫자 날짜를 읽지 않는다.
O2 출처 동작(스탬프 단독 -> 발효 없음 · 제출 발효 조항 + 스탬프 -> 주 제출일 · 주 증명
명시 발효일 · 지연 발효 우선순위·모호성)은 하나도 바꾸지 않았다.

### 로컬 Python 실측 (2026-09-03)

| 모듈 | 10.23 | 이번 |
|---|---|---|
| `test_qv_identity_legal_evidence` | 143 | **157 OK** |
| `test_qv_identity_proposals` | 103 | 103 OK |
| `test_qv_identity_promotion` | 60 | 60 OK |
| `test_qv_identity` | 21 | 21 OK |
| `test_qv_identity_inventory` | 30 | 30 OK |
| `test_qv_symbol_bridge` | 18 | 18 OK |
| `test_qv_xbrl_binding` | 35 | 35 OK |
| `test_qv_step4` | 138 | 138 OK |
| `test_qv_submissions` | 48 | 48 OK |
| **전체 trading suite** | 1,884 | **1,898 OK** |

새 테스트 14개는 **고치기 전 코드에서 전부 실패한다**(17 subtest 실패, 확인함). GitHub CI는
여전히 Node만 돌리므로 이 숫자를 재현하지 않는다.

### 실제 SEC read-only smoke (2026-09-03, 같은 inventory·같은 5종목)

`--historical --legal-evidence`, SEC 호출 2,350(10.23과 같다). **어느 packet도 승격하지
않았고 결과를 보고 문법을 다시 넓히지 않았다.** 여섯 작업 항목 모두 `REVIEW_REQUIRED`로
10.23과 같다.

| 항목 | governing exhibit | operative R/M/A | source family | 연결 |
|---|---|---|---|---|
| AAPL | 22 → **22** | 0/22/0 → **0/22/0** | — | NUMERIC 1 (그대로) |
| FOXA | 9 → **9** | 5/4/0 → **5/4/0** | EXPLICIT 5 | 없음 (그대로) |
| CELG | 14 → **14** | 0/14/0 → **0/14/0** | — | NUMERIC 1 (그대로) |
| ABMD | 11 → **11** | 1/10/0 → **1/10/0** | EXPLICIT 1 | 없음 (그대로) |
| LEH | — | — | — | 미실행(표지 증명 없음) |

**P2 — 관측 가능한 변화는 하나다.**

```text
AAPL us-gaap:CommonStockMember
  표지 "Common Stock, $0.00001 par value per share"  cover_par 0.00001
  governing "Common Stock"        gov_par  None  ->  **0.00001**
  method NUMERIC_PAR_VALUE_SUFFIX (그대로)
```

이제 그 자리의 액면가를 **실제로 읽는다.** 값이 표지와 Decimal로 같아서 판정은 그대로지만,
달랐다면 이번에는 `PAR_VALUE_CONFLICT`가 된다 — 10.23에서 열려 있던 구멍이 그것이다.
액면가 충돌·P2 모호성은 이번에도 **0건**이고, CELG는 액면가가 이름 **앞**에 오는 문장
(`shares of the par value of $.01 per share shall be designated ‘Common Stock’`)이라
읽을 것이 없어 `gov_par=None` 그대로다. class 구간은 다섯 종목 전부 여전히 0/0이다
(`search_status=INCOMPLETE`, P2/O2가 만든 상태가 아니다).

FOXA의 `accessions_outside_horizon` 547 → 548은 문법이 아니라 그 사이 SEC에 새 제출이
하나 들어온 결과다.

### O2 — 실 recall은 **여전히 0이고, 원인은 날짜 표기가 아니었다**

숫자·대문자 주 스탬프는 이번 pilot에서 **한 건도 O2 hit를 만들지 않았다.** 10.23의 가설
1번("날짜 표기가 O2 개선 0의 가장 유력한 원인이다")은 **이 pilot에서는 틀렸다.** 대표
governing exhibit 5건을 직접 다시 읽어 확인했다.

```text
문서                      주 자료 block  기관 언급  제출발효 조항  숫자 날짜
AAPL d684095dex31.htm          0            0           0            없음
AAPL d49399dex31.htm           0            0           0            없음
FOXA d721949dex31.htm          1            1           0            없음
CELG tm1923405d1_ex3-1.htm     0            0           0            없음
ABMD d353287dex31.htm          0            0           0            없음
```

**스탬프 자체가 문서에 없다.** EDGAR Exhibit 3은 다시 타이핑된 conformed 사본이라 주
기관의 FILED 스탬프(원본의 스캔 머리글)가 대개 본문에 없다. 유일하게 기관을 말하는 FOXA
block은 연혁 서술(`The original Certificate of Incorporation was filed with the
Secretary of State ... on May 3, 2018`)이고 그 문서에 제출 발효 조항이 없으므로 **스탬프
단독은 발효를 만들지 않는다**는 동결 규칙대로 후보가 되지 않는다 — 설계대로 동작한 것이다.

날짜 표기 gap은 실재했고 이번에 닫혔다(테스트가 잠근다). 다만 **이 pilot의 O2 recall 0을
설명하는 것은 표기가 아니라 conformed exhibit에 주 스탬프가 없다는 사실이다.** 결과를 보고
문법을 다시 넓히지 않았다 — conformed 사본에서 주 filing 시점을 어디서 얻을 것인가는 별도
설계 질문으로 남긴다.

### 이 receipt가 주장하지 않는 것

- production prose identity(N1 · `prose_key` · class-ID seed · JSONL)를 넓히지 않았다.
- SEC 수리·EDGAR 접수 의미론을 넓히지 않았다. 수리 시각은 여전히 구간을 움직이지 못한다.
- 10.23이 남긴 나머지 후속 질문 셋을 고치지 않았다.
- 어떤 packet도 승격하지 않았다.

## 10.25 5A-2 — `Corporation shall have authority to issue` 정의 문언 — 2026-09-03

10.23이 남긴 후속 설계 질문 3번(**FOXA class 정의 문법**) 하나만 닫는다. 시작 `main`은
`d33ff03fc1cd3b3be79fe238978a303d96bd697f`다.

**legacy flat layout은 열린 질문이 아니라 CLOSED다.**

```text
2001년 이전 파일명 없는 flat layout 문서
  -> 지금의 provenance 계약은 synthetic identity 없이 그것을 가리킬 수 없다
  -> read-only probe에서 finding recall 이득이 0이었다(EX-3 14건이 전부
     bylaws 9 · amendment 5이고 operative date·정의·탄생·종료 전부 0)
  -> legacy_layout -> INCOMPLETE fail-close를 유지한다
  -> 나중 Phase 0 coverage 증거가 구체적으로 요구하지 않는 한 다시 열지 않는다
```

아직 **열려 있는** 후속 질문은 둘이다 — governing exhibit 누락(`classify` ·
`governing_exhibit_missing`)과 O2 주 출처 recall(conformed exhibit에 주 스탬프가 없다,
10.24절)이다.

### 문법 추가 — semantic family는 늘지 않는다

실 charter는 `authorized to issue`가 아니라 자본구조 문장으로 같은 법적 사실을 말한다.

```text
The total number of shares of capital stock which the Corporation shall have
authority to issue is 3,070,000,000 shares, consisting of 2,000,000,000 shares of
Class A Common Stock, par value $0.01 per share (“Class A Common Stock”),
1,000,000,000 shares of Class B Common Stock, ...
```

`AUTHORIZED_TO_ISSUE` family에 **두 번째 문언 하나**를 더했다. 네 번째 family를 만들지
않았고 `finding_kind`는 `GOVERNING_CLASS_DEFINITION` 그대로다. 좁히는 것은 셋이다.

```text
주어가 법인 자신이다     `(?:^|[.;:,)]\s+|\bwhich\s+)(?:the )?Corporation`
자본구조 문장이다        consisting of ... shares of <NAME>
문장 경계를 넘지 않는다  `(?:[^.;]|\.(?=\d))` — 숫자 사이의 소수점만 지나간다
```

**주어 경계는 부정이 아니라 열거로 세운다**(리뷰 지적으로 고쳤다). 처음에는 `of the
Corporation`을 부정 lookbehind로 막았는데 그 방식은 닫히지 않는다 — `The Board
appointed by the Corporation` · `A committee designated by the Corporation` ·
`An officer authorized by the Corporation`이 전부 통과했다. 막아야 할 전치사·분사
목록에는 끝이 없다. 그래서 반대로 **절이 시작하는 자리 셋만 받는다.**

```text
block 시작        Corporation shall have authority to issue ...
절 경계 구두점    (a) The Corporation shall have authority to issue ...
관계대명사 which  ... capital stock which the Corporation shall have authority ...
```

그 밖이면 `Corporation` 앞에 다른 낱말이 있다는 뜻이고, 그때 `shall have authority`의
주어는 법인이 아니다. 관계대명사는 실제로 관측된 `which` 하나만 열거했다 — `that`
변형은 관측되면 그때 별도로 연다. 영어 문법 parser도 fuzzy도 아니다.

세 번째가 필요한 이유는 **한 문장 안의 Class B가 `$0.01` 뒤에 오기 때문이다.** 기존
`[^.;]` 창은 그 소수점에서 멈춰 Class B에 영원히 닿지 못한다. 진짜 문장 끝(`. `)은
그대로 막는다. 기존 세 문언(`authorized to issue` · `divided into` · `designated`)과
`_matches` · `_fill` · `_designation_site` · P2 · N1 · class-ID는 한 줄도 바꾸지 않았다.

**정의는 여전히 탄생이 아니다.** 이 문언 + 발효일만으로는 탄생이 나오지 않고, 같은
instrument에 동결된 탄생 행위 문법이 **따로** 있을 때만 탄생이다. 계약 정본은 설계
문서의 열거된 legal semantic family 절이다.

### 로컬 Python 실측 (2026-09-03)

| 모듈 | 이전 | 문법 추가 | 주어 경계 수정 |
|---|---|---|---|
| `test_qv_identity_legal_evidence` | 157 | 167 OK | **169 OK** |
| **전체 trading suite** | 1,898 | 1,908 OK | **1,910 OK** |

새 테스트 10개 중 **양성 5개는 구현 전에 실패하는 것을 먼저 확인했다**(dual-class 정의
A·B · 두 class 비충돌 · 정의≠탄생 · P2 액면가 라우팅). 음성 테스트(이사회·이사·주주
주어 · `may issue` · `consisting of` 없음 · 문장 경계)는 구현 전후 모두 통과한다.

주어 경계 수정에서 테스트 2개를 더 넣었고, **음성 3건이 고치기 전에 실패하는 것을 먼저
확인했다**(`appointed by` · `designated by` · `authorized by` + the Corporation).
양성 통제(`The Corporation` · 관계절 `which the Corporation` · `(a) The Corporation` ·
`shall have the authority`)는 수정 전후 모두 통과하고, 실 FOXA charter의 Class A/B
recall도 그대로다(`d721949dex31.htm` block:18, 각각 `$0.01`, 탄생 0건).

**GitHub CI는 Node만 돌리므로 이 숫자를 재현하지 않는다.**

### 실제 SEC read-only smoke (FOXA 단독, 2026-09-03)

`--symbols FOXA --historical --legal-evidence`, SEC 호출 258. **승격하지 않았고
manifest·production JSONL을 건드리지 않았다.**

| | 이전 | 이번 |
|---|---|---|
| Class A 연결 | 없음 | **NUMERIC_PAR_VALUE_SUFFIX** |
| Class B 연결 | 없음 | **NUMERIC_PAR_VALUE_SUFFIX** |
| Class A findings | 0 | **2** |
| Class B findings | 0 | **2** |
| governing exhibit | 9 | 9 |
| operative R/M/A | 5/4/0 | 5/4/0 |
| class 구간 | 0/2 | 0/2 |
| 판정 | REVIEW_REQUIRED | REVIEW_REQUIRED |

새로 나온 finding 4건은 전부 정의이고 탄생이 아니다.

```text
CommonClassAMember
  GOVERNING_CLASS_DEFINITION AUTHORIZED_TO_ISSUE
    0001193125-19-079678/d721949dex31.htm block:18  'Class A Common Stock'  $0.01
    0001628280-23-002786/foxa-20221231x10qex31.htm block:19  'Class A Common Stock'  $0.01
CommonClassBMember
  GOVERNING_CLASS_DEFINITION AUTHORIZED_TO_ISSUE
    0001193125-19-079678/d721949dex31.htm block:18  'Class B Common Stock'  $0.01
    0001628280-23-002786/foxa-20221231x10qex31.htm block:19  'Class B Common Stock'  $0.01
```

`d721949dex31.htm` block:18은 10.23이 지목한 바로 그 자리다. 두 class가 서로 다른
governing 이름으로 남고 각 자리의 액면가 `$0.01`이 표지 `$0.01`과 Decimal로 같아
기존 P2 규칙 그대로 연결됐다. `CLASS_BIRTH_ACTION`·`CLASS_BIRTH_EFFECTIVE_DATE`는
**0건**이다.

### 남아 있는 차단 요인 (이번에 고치지 않았다)

```text
classify:0001193125-19-296568/d837035dex31.htm   governing 후보 분류 실패 1건
  -> search_status = INCOMPLETE  -> class 구간 0/2  -> REVIEW_REQUIRED
명시 탄생 행위 없음 · 두 restated certificate의 operative date MISSING
```

**정의 recall 구멍만 닫혔고 무관한 semantic은 하나도 바뀌지 않았다.** 결과를 보고
문법을 다시 넓히지 않았다.

### 이 receipt가 주장하지 않는 것

- production identity JSONL · `qv_manifest.prose_key` · `qv-class-id-v1` ·
  provenance 자연키 · SEC 수리 의미론을 바꾸지 않았다.
- 탄생·종료·snapshot 분류·O2·P2·B1/B2·Exhibit 3 권한·Item 5.03을 바꾸지 않았다.
- legacy flat layout을 열지 않았다(`legacy_layout -> INCOMPLETE` 그대로).
- 어떤 packet도 승격하지 않았고 5A-3를 만들지 않았다.

---

## 10.26 5A-2 — Certificate of Elimination 문서 분류 — 2026-09-04

시작 `main` = `ba034a4d23c3c7d5204f3044cbc4ebe7ef6de87d`(설계 시점 `01c321b`의 한 커밋
뒤이고 그 커밋은 메모리 연구 파일만 건드린다). **어느 packet도 승격하지 않았고
manifest·production JSONL을 읽지도 쓰지도 않았다.**

### 정확히 무엇을 더했나

FOXA의 남은 탐색 실패 하나가 목표다.

```text
classify:0001193125-19-296568/d837035dex31.htm
```

실제 SEC Exhibit 3.1은 `FOX CORPORATION / CERTIFICATE OF ELIMINATION / OF THE /
SERIES A JUNIOR PARTICIPATING PREFERRED STOCK`이다. **진짜 governing instrument인데
열거된 family에 그 이름이 없어서** 분류에 실패하고 있었다.

`AMENDMENT_FAMILIES`에 열거 항목 하나만 붙였다.

```python
("CERTIFICATE_OF_ELIMINATION", r"certificate\s+of\s+elimination"),
```

```text
CERTIFICATE_OF_ELIMINATION
    ∈ AMENDMENT_CLASSIFICATIONS  ∈ GOVERNING_CLASSIFICATIONS
    ∉ SNAPSHOT_CLASSIFICATIONS
```

넓은 `ELIMINATION` family도, 두 번째 분류기도, elimination finding 문법도, 우선주
lifecycle parsing도, 발행사·티커 예외도 만들지 않았다. 기존 분류·탐색 closure 논리를
그대로 재사용한다.

**분류는 문서가 무엇인지만 말한다.** 관측된 FOXA 문서는 우선주 시리즈를 없애고 Class
A/B 보통주를 명시로 논하지 않는다 — 그것은 A/B에 영향이 없다는 증명이 아니다. B2
fail-close(`대상 class 이름의 부재는 영향 없음의 증명이 아니다`)는 그대로이고, 인식은
**탐색 열거**를 닫을 뿐 A/B 구간을 만들지 않는다. operative date 규칙(O2)·Item 5.03
증명 권한·B1/B2·P2·탄생/종료 문법은 한 줄도 바꾸지 않았다.

### 로컬 Python 실측 (2026-09-04)

| 모듈 | 이전 | 이번 |
|---|---|---|
| `test_qv_identity_legal_evidence` | 169 | **175 OK** |
| **전체 trading suite** | 1,910 | **1,916 OK** |

새 테스트 6개를 구현 **전에** 넣었고 그중 5개가 먼저 실패하는 것을 확인했다(분류 ·
탐색 closure · snapshot 승격 거부 · 보통주 A/B finding 0건 · operative MISSING 유지).
여섯 번째(`SNAPSHOT_CLASSIFICATIONS`에 없다)는 회귀 방지용 음성 통제라 전후 모두
통과한다. 기존 분류 테스트(Certificate/Articles of Amendment · restated snapshot ·
bylaws)는 한 줄도 바꾸지 않았다.

**GitHub CI는 Node만 돌리므로 이 숫자를 재현하지 않는다.**

### 실제 SEC read-only smoke (FOXA 단독, 2026-09-04)

`--symbols FOXA --historical --legal-evidence`, SEC 호출 258(10.25와 같다).
**승격하지 않았고 manifest·production JSONL을 건드리지 않았다.**

| | 이전(10.25) | 이번 |
|---|---|---|
| governing 문서 | 9 | 9 |
| 분류 실패 | **1** | **0** |
| `search_status` | **INCOMPLETE** | **COMPLETE** |
| Class A 정의 findings | 2 | 2 |
| Class B 정의 findings | 2 | 2 |
| 탄생 findings | 0 | 0 |
| operative R/M/A | 5/4/0 | 5/4/0 |
| class 구간 | 0/2 | 0/2 |
| 최종 판정 | REVIEW_REQUIRED | REVIEW_REQUIRED |

분류 결과는 `AMENDED_AND_RESTATED_CERTIFICATE` 3 · `BYLAWS` 5 ·
`CERTIFICATE_OF_ELIMINATION` 1이고 `UNCLASSIFIED`는 0건이다.

```text
0001193125-19-296568/d837035dex31.htm
  CERTIFICATE_OF_ELIMINATION   legal_operative = MISSING
```

**operative 5/4/0은 그대로다.** elimination 문서는 전에도 지금도 `MISSING`이다 —
분류만 바뀌었고 O2는 그대로다. 서명일·SEC 수리 시각·8-K 서술("델라웨어에 제출했고
제출 즉시 발효한다")로 되돌아가지 않았다. 그것을 근거로 쓰는 것은 별도의 O2/증명 권한
결정이고 여기서 하지 않았다.

**FOXA가 legacy가 아닌 첫 search-complete pilot 발행사다**(`accessions=104` ·
`outside_horizon=548` · `documents=15` · `failures=0`). 이제 탄생 recall과 O2가
불완전 탐색에 가려지지 않은 채로 측정된다.

### 남아 있는 차단 요인 (이번에 고치지 않았다)

```text
명시 탄생 행위 = 0건          -> Class A/B 둘 다 UNRESOLVED (정의 2건씩만 있다)
restated certificate 3건의 operative date = MISSING
```

`CANONICAL_CLASS_BRIDGE_NOT_EXPLICIT` · `CLASS_INTERVAL_NOT_EXPLICIT`가 그대로 남아
판정은 `REVIEW_REQUIRED`다. **결과를 보고 탄생·O2 문법을 넓히지 않았다.**

### 이 receipt가 주장하지 않는 것

- production identity JSONL · `qv_manifest.prose_key` · `qv-class-id-v1` ·
  provenance 자연키 · SEC 수리 의미론을 바꾸지 않았다.
- 탄생·종료·class 정의 문법 · snapshot 분류 · O2 · P2 · B1/B2 · Exhibit 3 권한 ·
  Item 5.03을 바꾸지 않았다.
- legacy flat layout을 열지 않았다.
- 어떤 packet도 승격하지 않았고 5A-3를 만들지 않았다.

---

## 10.27 5A-2 — 탄생 계약 축소 · Item 5.03 날짜 보강(O2-C) — 2026-09-05

시작 `main` = `3ff6f5dcf8c2cc76ca2c0c2ef18576a02c6b8316`. **어느 packet도 승격하지
않았고 production identity를 바꾸지 않았다.** 아래 사전 영향 점검이
`trading/qv/identity/*.jsonl`을 **읽기 전용으로 조회했고**(승격된 class 구간의 증거
역할을 세는 목적) 쓰기·승격·이행은 하나도 하지 않았다.

### 사전 영향 점검 — `RECLASSIFIED_INTO` (읽기 전용)

옛 탄생 규칙을 지우기 전에 이미 승격된 production 행이 그것에 기대는지 전수로 봤다.

```text
tracked 파일의 RECLASSIFIED_INTO   source + test 두 곳뿐이다(문서·receipt에는 없다)
tracked proof/proposal packet      없다
승격된 class 구간                  11개
그중 CLASS_BIRTH_ACTION 역할        0개
```

`cmcsa-aspecial`만 `RECLASSIFICATION_8K`를 들지만 **`CORROBORATING`이고 종료 쪽
사실**(`2010-01-01 -> 2015-12-12`)이다. 종료 재분류 문법은 이번에 건드리지 않았다.
**의존 0건 — 조용한 semantic 무효화 없이 진행했다.**

### 결정 1 — 재분류도 열거도 탄생이 아니다

`CLASS_BIRTH_ACTION_PATTERNS`에서 `RECLASSIFIED_INTO`를 지웠다. `reclassified as and
become`을 **새 탄생 문법으로 넣지 않았고**, 관측 보존용 중립 finding family도 만들지
않았다. 수권자본 열거는 CLOSED 규칙 그대로 정의뿐이다. 명시 생성 문법
(`hereby created` · `hereby established` · `new class ... designated`)은 그대로다.

### 결정 2 — O2-C `ITEM_503_CORROBORATED_UPON_FILING`

```text
governing Exhibit  ->  제출이 발효 사건이라는 법적 규칙
Item 5.03 primary  ->  그 제출이 일어난 날짜
```

**동결된 `UPON_FILING_PATTERNS`를 넓히지 않았다.** 교차 경로 전용 tuple
(`CROSS_DOCUMENT_UPON_FILING_PATTERNS`)을 따로 두어 `effective upon filing pursuant to
the DGCL`만 받는다 — 같은 문서 `STATE_FILED_UPON_FILING`은 조항이 기관을 명시해야 한다는
계약 그대로다. 보상 장치가 다르기 때문이다(같은 문서의 주 스탬프 vs. primary가 명시한
기관·날짜). `applicable law` · `Delaware law` · 맨 `upon filing`은 받지 않고, DGCL 조항은
델라웨어 제출처와만 짝지어진다.

**명시 `respectively`는 순서 추론이 아니다**(사용자 결정). 금지 규칙은 *명시 대응 표지
없는* 순서 추론을 가리킨다. 받는 모양은 block 하나 안의 **직접 참조** 또는
**`respectively`가 닫는 2↔2**뿐이고, 두 instrument 이름은 분류기가 이미 아는 열거
family로만 읽는다. 나열이 둘이 아니거나 · 둘이 같은 family이거나 · 대상이 그 둘에 없거나 ·
`respectively`가 없으면 fail-close다.

**교차 의존을 문자열 locator에 숨기지 않았다.** `OperativeDependency`가
`cik`·`accession`·`document_name`·`locator`·`proof_authority`를 통째로 들고,
최종 구간 증거는 그 primary를 `LEGAL_OPERATIVE_DATE_CORROBORATION` **REQUIRED**로 함께
든다 — 5A-3가 두 문서에서 PIT 가용성을 파생시킨다. `governing_operative_date()`는 여전히
한 문서만 읽는 parser이고, 보강은 accession 단위 두 번째 걸음이다.

### 로컬 Python 실측 (2026-09-05)

| 모듈 | 이전 | 이번 |
|---|---|---|
| `test_qv_identity_legal_evidence` | 175 | **201 OK** |
| **전체 trading suite** | 1,916 | **1,942 OK** |

새 테스트 26개다. 탄생 쪽은 뒤집은 테스트가 구현 전에 실패하는 것을 먼저 확인했고
(`reclassified into -> 탄생`이 이제 반대다), 음성 통제 둘(FOXA `reclassified as and
become` · 수권자본 열거 + 해소된 날짜)은 전후 모두 통과한다 — 넓힌 문법이 없다는 뜻이다.
O2-C 쪽은 양성 · `respectively` 제거 · 대응 개수 불일치 · 같은 family 중복 · 비델라웨어
관청 · 열린 법령 문구 · Item 5.03 없음 · 조항 없음 · 다른 Exhibit 지목 · 나중 accession ·
동반 by-laws · 일치/불일치 직접 날짜 · 복수 날짜, 그리고 provenance 변조 7건이다.

**GitHub CI는 Node만 돌리므로 이 숫자를 재현하지 않는다.**

### 실제 SEC read-only smoke (FOXA 단독, 2026-09-05)

`--symbols FOXA --historical --legal-evidence`, SEC 호출 258(10.26과 같다).
**승격하지 않았고 manifest·production JSONL을 건드리지 않았다.**

| | 이전(10.26) | 이번 |
|---|---|---|
| `search_status` | COMPLETE | COMPLETE |
| 분류 실패 | 0 | 0 |
| governing exhibit | 9 | 9 |
| operative R/M/A | 5/4/0 | **6/3/0** |
| Class A/B 정의 findings | 2 / 2 | 2 / 2 |
| 탄생 findings | 0 | 0 |
| class 구간 | 0/2 | 0/2 |
| 최종 판정 | REVIEW_REQUIRED | REVIEW_REQUIRED |

바뀐 문서는 하나다.

```text
0001193125-19-079678/d721949dex31.htm
  MISSING  ->  RESOLVED 2019-03-18  ITEM_503_CORROBORATED_UPON_FILING
  Exhibit  block:127   "shall become effective upon filing pursuant to the DGCL"
  primary  0001193125-19-079678/d721949d8k.htm  block:204  FILING_NARRATIVE
```

`block:204`가 델라웨어 제출·발효일과 `Exhibits 3.1 and 3.2, respectively`를 **한
block에** 담고, SEC header가 `EX-3.1 -> d721949dex31.htm`으로 유일하게 대응시킨다.

**나머지는 계약대로 MISSING이다.**

```text
d721949dex33.htm            Certificate of Designation — 제출 발효 조항이 없다
d837035dex31.htm            Certificate of Elimination — governing 쪽 조항이 없다
                            (primary의 `effective upon filing`은 법적 규칙을 대지 못한다)
foxa-20221231x10qex31.htm   DGCL 조항은 있으나 10-Q accession이라 Item 5.03 primary가 없다
```

**Class A·B는 여전히 `UNRESOLVED`이고 구간은 0/2, 판정은 `REVIEW_REQUIRED`다.** 날짜가
풀렸어도 탄생 계약이 더 엄격해졌기 때문이고 **그것이 의도한 결과다.** 결과를 보고 탄생
문법을 넓히지 않았다.

### 다음 관측 blocker — Certificate of Designation 오분류 (이번에 고치지 않았다)

`d721949dex33.htm`은 Certificate of Designation인데 본문이 모(母) charter를 인용한다는
이유만으로 `AMENDED_AND_RESTATED_CERTIFICATE`로 분류된다. **Certificate of Designation이
모 charter를 언급했다는 이유로 complete governing snapshot이 되면 안 된다.**

이번 변경은 그 오분류를 **이용하지도 악화시키지도 않는다** — 연결은 family로 전시 번호를
고른 뒤 SEC metadata로 문서를 확정하고 그것이 대상 문서와 같은지 다시 본다. `3.1`은
`d721949dex31.htm`이므로 `d721949dex33.htm`에 붙지 않고, 그 문서는 조항이 없어 애초에
O2-C에 닿지 못한다. FOXA에 complete snapshot이 하나 더 있다고 읽지 않는다. **다음 작업은
좁은 문서 제목/분류 수정이다.**

### 이 receipt가 주장하지 않는 것

- production identity JSONL · `qv_manifest.prose_key` · `qv-class-id-v1` ·
  provenance 자연키 · SEC 수리 의미론을 바꾸지 않았다.
- 탐색 지평 · `GOVERNING_SEARCH_FORMS` · Form 10/10-12B 수집 · class 정의 문법 ·
  종료 문법 · P2 · B1 · N1 · Exhibit 3 권한 · Item 5.03의 일반 의미 권한을 바꾸지 않았다.
- 같은 문서 O2 family(`STATE_FILED_UPON_FILING`)를 넓히지 않았다.
- 어떤 packet도 승격하지 않았고 5A-3를 만들지 않았다.

---

## 10.28 5A-2 후속 — 직접 연결에 명시 instrument를 요구한다 — 2026-09-05

시작 `main` = `7f544cedbb6f691a4951a11008af1b86295e8d56`(리뷰 대상 `81837f4` 이후 커밋
셋은 전부 다른 트랙이고 QV 파일을 건드리지 않았다). **승격·manifest 변경 없다.**

### 고친 것 하나

`item_503_document_association()`의 **직접** 경로가 block 안에 전시 번호가 하나뿐이면
그것을 연결로 받았다. 원문이 그 Exhibit을 대상 instrument에 붙였다고 말하지 않아도
통과하므로 동결된 exact-document 계약 위반이다.

이제 직접 경로는 **그 참조가 든 문장**이 `respectively` 경로와 **같은 열거 family**로
대상을 명시할 때만 성립한다.

```text
recognized family 정확히 하나  AND  recognized family == target_family
AND  전시 번호 정확히 하나
```

```text
The Amended and Restated Certificate of Incorporation
  is attached hereto as Exhibit 3.1.          받는다
For additional information, see Exhibit 3.1.  받지 않는다(instrument가 없다)
The By-laws are attached hereto as Exhibit 3.1.
                                              받지 않는다(다른 family다)
The Certificate is attached hereto as Exhibit 3.1.
                                              받지 않는다(정의어 참조)
```

**정의어·대명사 공참조 해소를 만들지 않았다** — 옛 양성 fixture를 살리려고 문법을
넓히지 않고 fixture 쪽을 명시 이름으로 고쳤다. `respectively` 경로 · DGCL 조항 문법 ·
provenance 구조 · O2 우선순위 · 탄생 의미론은 한 줄도 바뀌지 않았다. 문장 경계 helper만
양쪽 경계를 갖도록 넓혔고 `respectively`가 읽는 텍스트는 그대로다.

### 로컬 Python 실측 (2026-09-05)

| 모듈 | 이전 | 이번 |
|---|---|---|
| `test_qv_identity_legal_evidence` | 201 | **204 OK** |
| **전체 trading suite** | 1,942 | **1,945 OK** |

새 음성 테스트 3건(instrument 없음 · 다른 family · 정의어 참조)과 helper 계약 통제를
더했고, 옛 직접 양성 테스트 둘은 명시 이름 fixture로 고쳤다 — 그 둘이 수정 뒤 새 규칙으로
먼저 실패하는 것을 확인하고 고쳤다.

### 실제 SEC read-only smoke (FOXA 단독, 2026-09-05)

helper가 바뀌었으므로 다시 돌렸다. `--symbols FOXA --historical --legal-evidence`,
SEC 호출 258. **결과는 10.27과 동일하다.**

```text
search_status = COMPLETE      분류 실패 0      operative R/M/A = 6/3/0
0001193125-19-079678/d721949dex31.htm
    RESOLVED 2019-03-18  ITEM_503_CORROBORATED_UPON_FILING
    Exhibit block:127  ·  primary d721949d8k.htm block:204
Class A/B 탄생 0 · 구간 0/2 · REVIEW_REQUIRED
```

FOXA는 `respectively` 경로로 연결되므로 영향이 없다. `block:206`(Certificate of
Designation)은 이제 직접 경로에서도 떨어지지만 — `Certificate of Designation`은 열거
family가 아니다 — 그 Exhibit은 제출 발효 조항이 없어 애초에 O2-C에 닿지 못했다.
**MISSING 그대로다.**

### 문서 정정

- `qv_identity_legal_evidence.py`: `OperativeDate`의 "동결된 셋"을 넷으로 고쳤고,
  `governing_operative_date()`가 네 family 중 셋만 만든다는 것을 명시했다
  (`ClassLegalProof.status`의 "셋"은 상태 어휘라 그대로다).
- 설계 문서: 직접 경로 서술을 새 규칙으로 고치고 `source_family`가 넷임을 반영했다.
- 10.27 receipt 서두: production identity JSONL을 "읽지도 않았다"는 서술이 사전 점검
  사실과 어긋나므로 **읽기 전용 조회는 했고 변경·승격은 없다**로 정정했다. 점검
  **결과**(의존 0건)는 관측 그대로이므로 바꾸지 않았다.

---

## 10.29 5A-2 — Certificate of Designation 문서 분류 — 2026-09-05

시작 `main` = `b007f083d2541bb132a6910fa2582499e2a29399`. **어느 packet도 승격하지
않았고 production identity를 바꾸지 않았다**(이번에는 읽지도 않았다).

### 관측된 오분류

```text
0001193125-19-079678/d721949dex33.htm
  실제:  CERTIFICATE OF DESIGNATION, PREFERENCES, AND
         RIGHTS OF SERIES A JUNIOR PARTICIPATING PREFERRED STOCK
  분류:  AMENDED_AND_RESTATED_CERTIFICATE
```

`CERTIFICATE_OF_DESIGNATION`이 닫힌 어휘에 없어서, 뒤쪽 모(母) charter 인용
(`... authority conferred upon the Board ... by the Amended and Restated Certificate
of Incorporation ...`) 하나가 시리즈 전용 instrument를 **완전 governing snapshot으로**
만들었다. 10.28 receipt가 다음 blocker로 적어둔 그것이다.

### 정확히 무엇을 더했나

`AMENDMENT_FAMILIES`에 열거 항목 하나뿐이다.

```python
("CERTIFICATE_OF_DESIGNATION", r"certificate\s+of\s+designation\b"),
```

```text
CERTIFICATE_OF_DESIGNATION
    ∈ AMENDMENT_CLASSIFICATIONS  ∈ GOVERNING_CLASSIFICATIONS
    ∉ SNAPSHOT_CLASSIFICATIONS
```

제목 blocks가 인용보다 앞서므로 **기존 block 순서 동작 그대로** 바로잡힌다.
`classify_document()`를 재설계하지 않았고, 제목 NLP·heading 추출·fuzzy 분류·파일명
분류·발행사 예외를 만들지 않았다. 일반 `designation`·`designated` 산문은 분류되지 않고,
class 사실 문법(`... designated <NAME>`)은 **다른 층 그대로**다.

### 로컬 Python 실측 (2026-09-05)

| 모듈 | 이전 | 이번 |
|---|---|---|
| `test_qv_identity_legal_evidence` | 204 | **211 OK** |
| **전체 trading suite** | 1,945 | **1,952 OK** |

새 테스트 7건이고 그중 **5건이 구현 전에 실패하는 것을 먼저 확인했다** — FOXA 모양 분류 ·
모 charter 인용의 진단 보존 · B2에서 snapshot으로 뽑히지 않음 · 대상 class를 언급해도
마찬가지 · operative가 여전히 MISSING. 음성 통제 2건(앞선 진짜 restated 제목이 이김 ·
일반 designation 산문)은 전후 모두 통과한다 — 넓힌 문법이 없다는 뜻이다.

**GitHub CI는 Node만 돌리므로 이 숫자를 재현하지 않는다.**

### 실제 SEC read-only smoke (FOXA 단독, 2026-09-05)

`--symbols FOXA --historical --legal-evidence`, SEC 호출 258. **승격하지 않았고
manifest·production JSONL을 건드리지 않았다.**

문서 **하나만** 바뀌었다.

```text
0001193125-19-079678/d721949dex33.htm
  AMENDED_AND_RESTATED_CERTIFICATE  ->  CERTIFICATE_OF_DESIGNATION
  proof_authority = GOVERNING_EXHIBIT (그대로)
  legal_operative_status = MISSING   (그대로)
  classification_families에 AMENDED_AND_RESTATED_CERTIFICATE가 그대로 남는다
```

| | 이전(10.28) | 이번 |
|---|---|---|
| snapshot-class 문서 | 3 | **2** |
| amendment-class 문서 | 1 | **2** |
| `search_status` | COMPLETE | COMPLETE |
| 분류 실패 | 0 | 0 |
| operative R/M/A | 6/3/0 | 6/3/0 |
| Class A/B 정의 findings | 2 / 2 | 2 / 2 |
| 탄생 findings | 0 | 0 |
| class 구간 | 0/2 | 0/2 |
| 최종 판정 | REVIEW_REQUIRED | REVIEW_REQUIRED |

**O2는 그대로다.** 새 family가 O2-C의 열거 instrument 어휘에 자연히 참여하므로 그
accession의 `block:206`(`The Certificate of Designation is attached hereto as Exhibit
3.3`)이 이제 직접 연결에 성공하지만, **그 Exhibit에 제출 발효 조항이 없어서** O2-C가
애초에 닿지 못한다 — `MISSING` 그대로다. `ITEM_503_CORROBORATED_UPON_FILING` ·
`CROSS_DOCUMENT_UPON_FILING_PATTERNS` · `item_503_document_association()` ·
`item_503_corroborated_dates()`는 한 줄도 바꾸지 않았다.

우선주 lifecycle은 열지 않았다 — identity package · 탄생 구간 · 시리즈 파싱 ·
우선주/보통주 관계 논리 전부 없다. 이 작업은 **문서 분류 하나**다.

### 함께 고친 낡은 서술 하나

설계 문서의 열거 semantic family 표가 `탄생 행위`에 `reclassified into ... <NAME>`을
아직 적고 있었다 — 10.27에서 코드는 이미 그것을 뺐다. 표를 사실에 맞췄고 문법은 건드리지
않았다.

### 이 receipt가 주장하지 않는 것

- O2/O2-C · Item 5.03 권한 · 탄생/정의/종료 문법 · P2 · N1 · `qv-class-id-v1` ·
  legacy · SEC 자연키 · 탐색 지평 · 승격기 · production identity · 5A-3를 바꾸지 않았다.
- 일반 분류기 refactor를 하지 않았다.
- 어떤 packet도 승격하지 않았다.

---

## 10.30 5A-2 실행 — 작업 항목 단위 체크포인트/재개 — 2026-09-05

**실행 인프라만 바꿨다.** identity·발견·법적 증거·승격 semantics를 한 줄도 바꾸지
않았고, 어떤 packet도 승격하지 않았고, 문턱·문법·상태 어휘를 건드리지 않았다.

### 왜 (실측된 차단 요인)

전수 cheap-path census(`N=897` · `--browse --historical` · legal 없음)가 약 2시간 7분을
돌다가 **작업 항목 397/897 `HOG/HOG`**에서 죽었다.

```text
EdgarError: HTTP 503: https://www.sec.gov/cgi-bin/browse-edgar?...CIK=HOG...
```

러너가 `run_proposals()`가 **끝난 뒤에야** 산출물을 직렬화하므로 **이미 끝난 396개
작업 항목이 전부 사라졌다.** 그 session의 `client.calls`도 함께 사라져 정확한 SEC
호출 수를 알 수 없다.

전송 실패 하나가 전수 실행을 통째로 버리게 만드는 것이 관측된 blocker다. legal 경로는
accession 단위 실패를 이미 `failures`로 삼키지만(`qv_identity_legal_evidence.py`),
**발견 층 `browse_candidate()`에는 그 보호가 없다** — 그래서 cheap 경로가 시간당
취약도는 오히려 더 높다.

### 무엇을 더했나

`selftest/qv_identity_proposal_run.py` 하나에만 더했다. `run_proposals()` ·
법적 공급기 · 승격기는 그대로다.

```text
--checkpoint-dir <dir>   작업 항목 하나 단위로 durable하게 적는 실행 모드
--resume                 첫 미완료 작업 항목부터 이어서 돌린다
```

- **체크포인트 단위는 `(member_symbol, identity_symbol)` 하나다.** 티커로 묶지 않아
  재사용 벤더 계열 episode가 합쳐지지 않는다. 한 항목이 끝나면 다음 항목을 시작하기
  전에 `os.replace`로 원자적으로 남으므로, 전송 실패로 잃는 것은 **그때 돌던 항목
  하나뿐이다.**
- **전송 실패는 의미 상태가 아니다.** 503은 `UNRESOLVED`·`REVIEW_REQUIRED`로 적히지
  않는다 — 그 항목의 artifact 자체가 생기지 않고, `N+1`로 넘어가지 않고, 종료 코드가
  1이다. 자동 재시도·backoff는 이 증분에 **없다**(`EdgarClient._read`는 그대로다).
- **체크포인트 디렉터리는 정확히 한 실행 정체성에 속한다.** schema · git commit ·
  inventory 바이트 SHA-256 · 수요 provenance 전부 · `identity_source_version` ·
  선택된 작업 항목 키의 **순서** · `--browse`/`--historical`/`--legal-evidence` ·
  `--historical`일 때 지수 변경 CSV의 SHA-256을 묶는다. `--resume`에서 전부 다시
  계산해 대조하고 **하나라도 다르면 멈춘다.** `--force`도 `--ignore-version`도
  best-effort merge도 rebase도 없다.
- **완료 항목은 파일 존재만으로 건너뛰지 않는다.** JSON 유효성 · schema · 실행 정체성
  digest · 수요 provenance · 그 순번의 작업 항목 키 · packet 키를 전부 검증하고, 하나라도
  어긋나면 fail-close다. 순번 파일이 그 순번의 키만 받으므로 같은 작업 항목이 둘일
  수는 없다.
- **모든 항목이 검증을 통과했을 때만** `--out`을 쓴다. 조립은 빈 `ProposalRun.as_json()`
  에서 정적·provenance 칸을 그대로 받고 항목별 칸만 다시 세므로 기존 5A-2 산출물 계약이
  갈리지 않는다. 제안 순서는 선택된 수요 순서이고 `qv_identity_promotion.load_proposal_run()`
  이 특별 취급 없이 그대로 읽는다.
- **실행 회계.** session receipt를 시작할 때 `RUNNING`으로 적고 끝/실패에 덮어쓴다.
  급사하면 `RUNNING`이 남아 그 session의 SEC 호출 수가 **`unknown`**으로 합계에
  전파된다 — 추정치를 지어내지 않는다. 회계는 진단이고 제안 semantics에 닿지 않는다.
- **40MB 이름 색인은 프로세스당 한 번이다.** 항목마다 `run_proposals()`를 부르므로
  기존 `name_index=` 인자로 미리 만들어 넘긴다. ticker map도 한 번이다.

### 로컬 Python 실측 (2026-09-05)

```text
python3 -m unittest trading.tests.test_qv_identity_proposal_run
  31 tests · PASS

python3 -m unittest discover -s trading/tests -p 'test_*.py'
  1,983 tests · PASS
```

**GitHub CI는 이 숫자를 재현하지 않는다** — `.github/workflows/docker.yml` 하나뿐이고
`npm ci` · `npm test`(Node)만 돌린다. Python 테스트를 돌리지 않으므로 CI 통과가 위
숫자의 독립 재현이 아니다. CI를 이것 때문에 고치지 않았다.

핵심 회귀는 **등가성**이다. 같은 결정적 network-free fixture에서

```text
기존 한 번에 돌리기            ==  체크포인트로 중단 없이 돌리기
기존 한 번에 돌리기            ==  1..K 완료 → K+1 실패 → --resume → 나머지 완료
```

의 최종 산출물이 진단용 칸(`sec_calls` · `git_commit` · `checkpoint_dir` ·
`run_identity_sha256`)을 뺀 **직렬화까지 같다.** dict 비교만 하면 `counts`·
`reason_counts`의 정렬 계약이 조용히 사라져도 통과하므로 문자열로 견준다.

가드마다 하나씩 무력화해 테스트가 실제로 잡는지 확인했다(정체성 digest · 항목 키 ·
항목 schema · 항목 provenance · 정렬 계약 · 실패 후 계속 진행 · 기존 체크포인트 재사용).
구조적으로 닿을 수 없던 중복 검사 하나는 지웠다 — 순번 키 검사가 이미 그것을 보장한다.

### 이 receipt가 주장하지 않는 것

- 전수 census를 **다시 돌리지 않았다.** 이 작업은 인프라뿐이고, 재개 실행은 별도다.
- 자동 재시도·backoff를 넣지 않았다. 재개로 부족한지는 따로 정한다.
- `--browse`를 layer-1 해결 여부에 조건부로 만들지 않았다 — 503이 난 그 호출이지만
  발견 semantics라 이 작업의 경계 밖이다.
- B1/B2 · O2/O2-C · P2 · N1 · 탐색 지평 · legacy fail-close · Item 5.03 권한 ·
  `qv-class-id-v1` · 상태 어휘 · 사유 코드 · 승격 정책 · manifest · production DB ·
  Phase 0 gate를 하나도 바꾸지 않았다.
- 어떤 packet도 승격하지 않았고 factor·rank·수익률을 계산하지 않았다.

## 10.31 5A-2 실행 — 체크포인트는 정확한 commit을 요구한다 — 2026-09-06

10.30의 후속 fail-close 하나와 receipt 시각 하나다. 체크포인트/재개 구조 · 항목 단위 ·
등가성 · 전송 실패 처리 · 최종 조립은 그대로다.

### 고친 것 — `git_commit: null`은 정체성이 아니다

`_git_commit()`은 git이 없는 환경에서도 돌게 `None`을 돌려준다. 기존 비-체크포인트
실행에는 맞는 관용이지만 재개 실행에는 맞지 않는다 — 체크포인트 계약이 **"이 실행은
이 commit의 코드다"**를 명시로 묶는데 `null`을 정체성으로 적으면 서로 다른 코드에서
조용히 이어붙일 수 있다. `null == null`이라 정체성 대조가 통과해버린다.

체크포인트 전용 helper `_required_git_commit()`를 더해 `run_identity()`가 그것을 쓴다.
확인할 수 없으면 `CheckpointError`다.

```text
run.json을 만들기 전에 멈춘다        items/ · sessions/ 도 생기지 않는다
EdgarClient를 세우기 전에 멈춘다     SEC 예산을 쓰지 않는다
```

`run_identity()`가 `Checkpoint` 생성 · `create()`/`open_existing()` · `EdgarClient()`
**앞**에서 불리므로 세 조건이 그 자리에서 만족된다. 빈 문자열도 revision이 아니다.

**다른 호출자는 건드리지 않았다.** `stage_run`(기존 경로) · `qv_identity_inventory_run` ·
`qv_identity_promotion_run`은 여전히 관용적인 `_git_commit()`을 쓴다 — git 없는
환경에서 그 실행들이 계속 돌아야 한다.

최종 산출물의 `git_commit`은 다시 묻지 않고 **이미 검증된 정체성 값**을 그대로 쓴다.
다시 물으면 실행 도중 git이 사라졌을 때 다 끝난 산출물이 `null`을 달게 된다.

### 고친 것 — session receipt의 `started_at`

`start_session()`이 적은 **실제 시작 시각**을 종료·실패 receipt가 보존한다. 전에는
`COMPLETE`/`FAILED`를 쓸 때 `_now()`를 다시 불러 시작 시각이 끝난 시각으로 덮였다.
`ended_at`은 그대로 종료·실패 시각이다. SEC 호출·제안 semantics는 닿지 않았다.

### 로컬 Python 실측 (2026-09-06)

```text
python3 -m unittest trading.tests.test_qv_identity_proposal_run
  41 tests · PASS

python3 -m unittest discover -s trading/tests -p 'test_*.py'
  1,993 tests · PASS
```

**GitHub CI는 이 숫자를 재현하지 않는다** — Python 테스트를 돌리지 않는다.

가드를 하나씩 무력화해 테스트가 실제로 잡는지 확인했다. `started_at`은 **시계가
움직이는 fixture**가 있어야 잡힌다 — `_now()`가 초 단위라 같은 초 안에서는 덮어써도
값이 같아 통과한다. 그래서 `COMPLETE`·`FAILED` 두 경로 모두에 ticking clock 회귀를
뒀고, 둘 다 무력화하면 실패한다.

### 이 receipt가 주장하지 않는다

- 전수 census를 다시 돌리지 않았다.
- 발견·법적 증거·승격 semantics · 문턱 · 문법 · 상태 어휘 · 사유 코드 · manifest ·
  production DB · Phase 0 gate를 하나도 바꾸지 않았다.
- 어떤 packet도 승격하지 않았고 factor·rank·수익률을 계산하지 않았다.

## 10.32 5A-2 — filename 없는 embedded SEC 문서의 주소 (`REOPENED -> CLOSED`) — 2026-09-06

**transport/addressability 하나만 고쳤다.** legal semantics · 문턱 · 문법 · 권한 규칙 ·
상태 어휘를 하나도 넓히지 않았다. 전수 legal 실행도 승격도 하지 않았다.

### 왜 열었나

2001년 이전 flat-layout accession은 문서를 개별 파일로 두지 않고 complete submission
안에 `<FILENAME>` 없이 담는다. 전 구현은 그 사실 **하나로** 그 accession 전체를
`legacy_layout` 실패로 적었고, 그 시기 filing이 있는 등록인은 지평이 구조적으로 닫히지
않아 언제나 `INCOMPLETE`였다(10.20의 실측: AAPL 43 · CELG 42 · ABMD 30건).

그것은 법적 판단이 아니라 **주소 문제**였다.

### 구조 probe 실측 (audit)

production parser를 만들기 전에 실제 SEC 표본으로 분해 가능성을 쟀다.

```text
45 distinct CIK / 45 accessions
212 embedded children
structurally deterministic            45 / 45
parent bytes stable across refetch    45 / 45
full decomposition identical          45 / 45
candidate keys unique                 45 / 45
missing FILENAME                     212 / 212
missing SEQUENCE                       0
malformed accession                    0
candidate-key collision                0
```

**이 표본은 global proof가 아니다.** production은 malformed를 fail-close한다.

### 닫은 계약

```text
identity       CIK + accession + source-backed <SEQUENCE>
authority      TYPE + 기존 semantic 규칙 (sequence는 권위가 아니다)
content check  자식 raw <TEXT> payload의 SHA-256
transport      부모 complete submission URL
```

증거 문서의 주소는 typed locator이고 형태가 정확히 둘이다 —
`document_name` **XOR** `document_sequence`. `KQ_FILING`은 이름만 든다.
**ordinal · `seq:2` 같은 합성 이름 · TYPE+순번 · 연도 cutoff · best-effort 복구가
없다.** 문자열 `"2"`도 정수로 바꾸지 않고 거부한다.

malformed는 그대로 실패다 — 누락·중복·비숫자·비양수 `SEQUENCE` · `<DOCUMENT>`/`<TEXT>`
경계 손상 · 중첩 · 모호한 `TEXT` 구간 · 같은 키에 다른 바이트. 그 accession은
`legacy_layout:<accession>` 실패로 남고 `search_status = INCOMPLETE`다. 실패 이름공간은
그대로이고 **뜻만 바뀌었다**.

```text
전:  filename이 없어서 무조건 실패
후:  embedded layout이 production locator 계약으로 결정론적으로 addressable하지 않다
```

parser는 `trading/backtest/qv_sec_embedded.py` **하나**다(bytes -> children, I/O 없음).
audit probe(`trading/selftest/qv_legacy_document_probe.py`)가 그것을 import하므로 probe가
검증하는 문법과 공급기가 쓰는 문법이 같다. **probe는 production 증거 원천이 아니다.**

해시 앞에 어떤 정규화도 하지 않는다(HTML unescape · 개행 · Unicode · trim 전부 없음).
부모 SHA · `<DOCUMENT>` ordinal · byte offset은 audit provenance로만 남고 production
증거 정체성에 들어가지 않는다.

### 바뀌지 않은 것

B1 · B2 · 정의≠탄생 · O2 · O2-C · P2 · exact N1 · `qv-class-id-v1` · C2 ·
promotion fail-close · manifest 정본 · Gate A-H · `document_proof_authority(TYPE)` ·
`EXHIBIT_3_PATTERN` · 8-K primary의 source-backed `SEQUENCE == 1` 규칙.
**새 primary heuristic도 새 association heuristic도 만들지 않았다.**

`complete_submission_text()`의 외부 의미도 그대로다(원본 바이트의 latin-1 decode).

### manifest bundle v2 -> v3

증거 계약이 바뀌었으므로 bundle 판별자를 올렸다.

```text
qv-identity-bundle-v2 -> qv-identity-bundle-v3

old identity_source_version  qv-identity-sha256:612412421278fb9d7fba90fa351e95a0ede09596474d4ec8696a7c59f43906a1
new identity_source_version  qv-identity-sha256:de239b12524d48fbe02d12fac6bdc1ca68a34ab7ea859d695c7f574eec8914be
```

**manifest 파일 내용은 한 글자도 바꾸지 않았다.** 그래도 version이 바뀌는 것이
의도된 결과다 — 그래서 그 앞의 5A-1 inventory와 5A-2 checkpoint는 stale이고 재사용하지
않았다. `qv-class-id-v1`은 바뀌지 않았다.

### DB migration — 기존 행을 보존한다

`qv_identity_evidence` · `qv_sec_evidence_documents`를 generic "비어 있을 때만 재구축"
목록에서 빼고 **좁은 명시 migration**을 뒀다.

```text
알려진 정확한 옛 스키마  -> 원자적 migration · 모든 행 보존 · document_sequence = NULL
이미 새 스키마          -> no-op
알 수 없는 스키마       -> BacktestStorageError · 아무것도 바꾸지 않는다
```

옛 `document_name`은 새 계약에서도 그대로 file locator이므로 **의미 추론이 없다.**
`qv_identity_evidence`는 `ISSUER` 어휘가 붙기 전 4c79a74 모양도 알려진 옛 스키마로
인식한다. 두 표의 계약 상승은 한 transaction이고, 한 표라도 옮길 수 없으면 아무 표도
옮기지 않는다. 범용 migration 틀은 만들지 않았다.

`qv_sec_evidence_documents`는 locator 종류마다 유일성이 따로 필요해 WITHOUT ROWID PK
대신 **부분 유일 인덱스 둘**을 쓴다. 대리 evidence id를 production 계약으로 만들지
않았다 — SQLite rowid는 locator도 evidence 정체성도 아니다.

### 실제 SEC smoke (2026-09-06, read-only)

고정 accession을 production parser로 다시 확인했다.

```text
CIK 0000320193  0000320193-99-000004
  children 5 · structurally deterministic
  EX-3 sequences 2 · 3 · 둘 다 filename 없음
  parent bytes 190,424 · 재요청에서 parent SHA와 자식 SHA 5개 모두 동일
```

서로 다른 CIK의 legacy accession 둘을 더 봤다.

```text
0000789019  0001032210-00-001019  children 2  filename 없음 2  deterministic
0000051143  0001005477-00-003871  children 5  filename 없음 5  deterministic
```

embedded EX-3 자식을 기존 파이프라인에 그대로 넣어 본 관측(**규칙을 바꾸지 않았다**):
AAPL sequence 2는 `CERTIFICATE_OF_AMENDMENT` · sequence 3은 `BYLAWS`로 분류됐고 권한은
`GOVERNING_EXHIBIT`, operative date는 둘 다 `MISSING`이다. 1990년대 평문 filing은
`html_blocks`가 **block 하나**로 내므로 그 시기 문서의 block locator는 굵다 — 사실로
적어 두고 이번에 고치지 않는다.

### 5A-2 통합 smoke — AAPL 하나 (2026-09-06, read-only)

bundle v3로 5A-1 inventory를 다시 만들고(`work items 897` · 이전과 같은 수요) 그중
**작업 항목 하나**만 `--legal-evidence`로 돌렸다. **승격하지 않았다.**

```text
AAPL/AAPL  cik=0000320193  SEC calls 615
  legal search=INCOMPLETE  accessions=368  outside_horizon=1878  documents=47
  failures 1     (전: legacy_layout 43건)
  최종 상태      REVIEW_REQUIRED
```

**`legacy_layout` 실패가 43 -> 0이 됐다.** 그 시기 accession이 실제로 열거되고
embedded EX-3 자식 10건(9 accession)이 후보 문서가 됐다.

```text
embedded documents 10 / 47   document_name = null · document_sequence = 2·3
  TYPE            EX-3 6 · EX-3.3 3 · EX-3.2 1
  classification  BYLAWS 8 · CERTIFICATE_OF_AMENDMENT 2
  source_url      부모 complete submission (…/0000320193-94-000013.txt)
```

남은 실패 하나는 **legacy layout과 무관하다** —
`governing_exhibit_missing:0001181431-05-013840`(2005년 Item 5.03 8-K에 주소 지정
가능한 Exhibit 3이 없다)이고 기존 CLOSED 규칙 그대로다. 그래서 탐색은 여전히
`INCOMPLETE`이고 구간이 나오지 않는다.

보통주 class의 finding 3건은 전부 **filename 있는 현대 문서**에서 나왔다. embedded
자식은 위 분류대로 governing class 정의를 만들지 않았다 — **결과를 보고 문법이나
semantics를 조정하지 않았다.**

### 리뷰 수정 — 2026-09-07

리뷰가 잡은 둘을 고쳤다. **계약은 그대로다** — typed locator · 자연키 · source kind ·
raw child SHA · 부모 URL · bundle v3 · legal semantics 하나도 건드리지 않았다.

#### 1. migration fixture가 움직이는 `HEAD`를 옛 스키마로 쓰고 있었다

`_pre_locator_db()`의 기본 revision이 `HEAD`였다. 구현이 커밋되기 **전**에는 그것이
locator 이전 스키마였지만, `8a2003c`가 커밋된 뒤에는 `HEAD`가 v3 스키마다.

**그래서 커밋된 HEAD에서 migration 회귀 두 개가 실제로 깨졌다.**

```text
python3 -m unittest trading.tests.test_qv_step4   (at 8a2003c)
  FAIL  test_an_unknown_evidence_schema_fails_closed
  FAIL  test_a_blocked_locator_migration_changes_nothing
```

`8a2003c` receipt의 `2,047 PASS`는 **커밋 전 worktree**에서 나온 값이다(그때 `HEAD`는
아직 `9684eee`였다). 그 값을 post-commit 검증으로 적은 것은 잘못이었다.

fixture를 고정 상수로 못박았다.

```text
PRE_LOCATOR_SCHEMA_COMMIT = "9684eee05307973041732a6524ad23b5b5deb0a6"
```

fixture가 정말 locator 이전 스키마인지(`document_sequence`가 없는지)와, "알 수 없는
스키마" 변조가 **실제로 적용됐는지**를 fixture 안에서 확인한다 — 둘 다 조용히 깨지면
테스트가 아무것도 검사하지 않게 되는 자리다. migration 전 두 표에 `document_sequence`
칸이 없다는 것도 이제 명시로 확인한다. 4c79a74 pre-`ISSUER` 어휘 케이스는 별도
historical 케이스로 그대로 둔다. **production migration semantics는 손대지 않았다.**

#### 2. 짝이 남는 SGML 닫힘 경계가 조용히 지나갔다

`<DOCUMENT>` 경계를 열림마다 "뒤의 첫 닫힘"으로 잡고 **남는 닫힘을 세지 않았다.**
`</TEXT>`도 여러 개면 첫 것으로 잘랐다. 이전 parser로 실측한 결과다.

```text
</DOCUMENT>가 하나 더 있다        -> deterministic True   (무시됐다)
</DOCUMENT>가 열림보다 먼저다     -> deterministic True   (무시됐다)
줄 머리 </TEXT>가 둘이다          -> deterministic True
                                     해시된 payload = b'first part\n'   ← 잘렸다
```

경계 검출을 **위치 순서대로 한 번 훑는 상태 기계**로 바꿨다.

```text
열려 있는데 또 열린다  -> NESTED_DOCUMENT
안 열렸는데 닫힌다     -> UNMATCHED_DOCUMENT_CLOSE   (남는 닫힘도 여기다)
열린 채로 끝난다       -> MISSING_DOCUMENT_CLOSE
TEXT 경계 토큰이 둘 이상 -> AMBIGUOUS_TEXT · payload도 SHA도 만들지 않는다
```

`UNMATCHED_DOCUMENT_CLOSE`는 parser 내부 실패 코드일 뿐이고 **production 상태 어휘는
그대로다** — 그 accession은 여전히 `legacy_layout:<accession>` · `INCOMPLETE`다.
줄 머리가 아닌 인라인 `</TEXT>`·`</DOCUMENT>` 문자열은 여전히 경계가 아니다(기존
fixture 유지). 복구도 "가장 그럴듯한 후보" 선택도 넣지 않았다.

#### 실측 (이 수정이 커밋된 HEAD에서, 2026-09-07)

```text
python3 -m unittest trading.tests.test_qv_legacy_document_probe      26  PASS
python3 -m unittest trading.tests.test_qv_identity_legal_evidence   225  PASS
python3 -m unittest trading.tests.test_qv_identity_promotion         62  PASS
python3 -m unittest trading.tests.test_qv_step4                     151  PASS
python3 -m unittest discover -s trading/tests -p 'test_*.py'      2,050  PASS
```

가드를 하나씩 무력화해 실제로 잡는지 확인했다 — `UNMATCHED_DOCUMENT_CLOSE` 제거
(2 실패) · 여러 `</TEXT>` 허용(1 실패) · fixture를 `HEAD`로 되돌림(3 실패).

**엄격해진 경계가 known-good accession을 거부하지 않는다**(실제 SEC 재확인).

```text
0000320193 / 0000320193-99-000004  children 5 · deterministic · EX-3 sequence 2·3
                                   parent SHA·자식 SHA 5개 모두 수정 전과 동일
0000789019 / 0001032210-00-001019  children 2 · deterministic
0000051143 / 0001005477-00-003871  children 5 · deterministic
```

**smoke 결과를 보고 parser 규칙을 조정하지 않았다.**

### 이 receipt가 주장하지 않는다

- 672건 전수 legal 실행을 하지 않았다. 897건 제안 재실행도 하지 않았다.
- 어떤 packet도 승격하지 않았고 manifest 행을 채우지 않았다.
- 과거 README의 "legacy recovery probe가 governing-relevant 14개를 복구했다"는 주장은
  **근거가 없어 여기 옮기지 않는다.**
- returns · ranking · portfolio · Gate A-H를 계산하지 않았다.

## 10.33 5A-2 전수 법적 증거 population — 897 work item — 2026-09-10

**관측 실행이다.** 코드·semantic·문턱을 하나도 바꾸지 않았고 승격·manifest 반영·5A-3·
Gate를 실행하지 않았다. 결과를 보고 규칙을 조정하지 않았다.

### 실행 정체성

```text
execution commit          9e1203c46e69b30040678d317c34c92cb3cb0971
checkpoint schema         qv-5a2-checkpoint-v1
run identity sha256       sha256:52ff66d48ef3a1aecc620bd7aed2c5ec15112c57a5abd9d714667532c1165fda
inventory sha256          sha256:dc13cae6c9f375c2f1dea72a01da9bc16682d7298fcc2b24900d03feb5a8ceba
identity_source_version   qv-identity-sha256:de239b12524d48fbe02d12fac6bdc1ca68a34ab7ea859d695c7f574eec8914be
final output sha256       b68813def1f815c174ff454b89a6b198ddbac3eb6fe631ae1232f486b364cfc5
runtime artifact path     trading/data/qv-5a2-run/   (gitignored · 산출물은 커밋하지 않는다)
```

실행은 `9e1203c`에 고정된 별도 worktree에서 했다. 그 사이 `main`은 다른 트랙으로
전진했지만 checkpoint 정체성은 worktree HEAD에 묶이므로 재개가 흔들리지 않았다.

**§11 완료 무결성 — 전부 통과.**

```text
git_commit == 9e1203c                     ✓
identity_source_version == inventory       ✓
proposals == 897                           ✓
AUTO + REVIEW + UNRESOLVED == 897          ✓
checkpoint item 파일 == 897                ✓
(member_symbol, identity_symbol) 중복 0    ✓   inventory 집합과 정확히 일치(누락 0 · 잉여 0)
mutates_production_manifest == false       ✓
```

### population

```text
work items 897    DIRECT 834 · REUSED_VENDOR_SERIES 63
selected CIK 808 · cover proof 730 · usable title anchor 672 · legal-evidence proof 672

AUTO_PROVABLE 0 · REVIEW_REQUIRED 847 · UNRESOLVED 50
legal search   COMPLETE 255 · INCOMPLETE 417
searched accessions 278,892 · legal documents 19,732
```

실패 계열:

```text
classify                   1,104
governing_exhibit_missing    606
document                     142
index                         60
legacy_layout                 19
```

### embedded 문서 — 이번 계약이 실제로 연 것

```text
embedded (sequence 주소)   1,440 / 19,732
filename (파일 주소)      18,292
embedded governing exhibit 1,440      (전부 EX-3 계열이라 100%다)
embedded을 가진 고유 accession 1,087
```

`document_sequence` 분포는 `2` 965 · `3` 274 · `4` 109 · `5` 42 · `6` 20 · `7` 14 ·
`8` 5 · `9` 2다. **이 분포는 진단이지 정체성이 아니다** — sequence는 등록인이 적은
주소이고 ordinal로 해석하지 않는다.

### 핵심 legacy 판정

```text
legacy_layout 실패        19건 · 고유 accession 19 · 영향 work item 18
```

확인된 legacy를 가진 적격 work item **425 / 672** 중 `legacy_layout`으로 끝난 것은
**18개**다. 나머지는 embedded 문서가 source-backed `<SEQUENCE>`로 주소 지정됐다.

19건은 전부 **실제로 손상된 accession**이고 새 계약상 올바른 fail-close다. 파일 이름이
없다는 이유로 실패한 것은 0건이다.

```text
NO_DOCUMENTS                    11   WEN · HRL · MAT · DHR · GL · AN · HD · D · SNA · LMT(2) · JNJ
MISSING_TEXT_CLOSE               3   HAL(seq 2) · CCL(seq 10) · WSM(seq 2·3·4·5·12·13)
DUPLICATE_SEQUENCE + 다른 바이트  2   SRCL · ROP  (둘 다 sequence 1이 중복이고 내용이 다르다)
MISSING_DOCUMENT_CLOSE           1   AES
NESTED_DOCUMENT                  1   BAC
```

`MISSING_TEXT_CLOSE`와 `DUPLICATE_KEY_DIFFERENT_BYTES`는 2026-09-07 리뷰 수정으로
엄격해진 경계 검사가 실제 SEC 자료에서 잡은 것이다. 그 전 parser였다면 잘린 payload나
모호한 자식을 자식 SHA로 삼았을 자리다. **parser를 고치지 않았다.**

### cheap-path baseline과의 비교 — 조정하지 않는다

```text
                    baseline   이번 전수
work items              897        897   같다
DIRECT / REUSED     834 / 63   834 / 63   같다
selected CIK            808        808   같다
cover proof             730        730   같다
usable title anchor     672        672   같다
AUTO_PROVABLE             0          0   같다
REVIEW_REQUIRED         847        847   같다
UNRESOLVED               50         50   같다
```

**법적 증거 공급기가 어떤 work item의 상태도 바꾸지 않았다.** 사유 코드는
`CANONICAL_CLASS_BRIDGE_NOT_EXPLICIT` 730건과 `CLASS_INTERVAL_NOT_EXPLICIT` 730건이
지배적이고, legal 탐색은 `COMPLETE`가 255건뿐이다. **이 결과를 근거로 semantics를
넓히지 않는다.**

> **정정(10.34).** 이 절의 초판은 위 사유 코드를 두고 "legal 탐색이 닫히기 전에
> 표지 anchor 층에서 이미 걸린다"고 적었다. **그 해석은 자료로 입증되지 않는다.**
> 10.34의 offline 재파생 결과, 요구된 class에 대해서는 표지 anchor가 아니라
> **법적 탄생 증거 층**이 지배적 차단 지점이다. 표지 층이 막는 것은 별도의
> 465건(요구 class 199 + sibling 266)이다. 정확한 수치는 10.34에 있다.

### 실행

```text
sessions 4    COMPLETE 1 · FAILED 1(TimeoutError) · RUNNING 표식으로 남은 급사 2
```

```text
20260907T011913  RUNNING   first=0    calls=unknown    (재부팅 위해 사용자가 정지)
20260907T165338  FAILED    first=201  calls=2,923      TimeoutError: read operation timed out
20260907T172245  RUNNING   first=207  calls=unknown    (재부팅 위해 사용자가 정지)
20260908T172709  COMPLETE  first=451  calls=233,023    last_completed_order=896
```

```text
SEC calls   확인된 두 세션 합 235,946 — **전체 합이 아니다.**
            급사한 두 세션은 runner 계약상 unknown이고 추정하지 않는다.
벽시계      90.1시간 (2026-09-06T16:19Z → 2026-09-10T10:24Z)
순수 실행   87.9시간 · 평균 5.9분/항목
```

전송 실패는 **한 번**이었고 지시대로 처리했다 — semantic 상태로 적지 않고, 코드를
바꾸지 않고, 자동 retry/backoff를 넣지 않고, checkpoint 항목을 손대지 않고, 같은
명령에 `--resume`만 붙여 수동 재개했다. 재개 세 번 모두 identity 대조를 통과했다.

### 검증 구분

```text
로컬 실행 결과   위 전수 population · §11 무결성 검사 전부
코드 검사        legacy_layout 19건의 실패 사유는 checkpoint에 적힌 값 그대로다
GitHub CI        이 숫자를 재현하지 않는다 — 워크플로가 Docker 하나뿐이고
                 Python 테스트를 돌리지 않는다
```

### 범위

- production manifest를 바꾸지 않았다. 어떤 packet도 승격하지 않았다.
- 5A-3 materialization · Gate A-H · returns · ranking · portfolio를 실행하지 않았다.
- semantic·문턱·문법·코드를 하나도 바꾸지 않았다.
- 산출물 JSON·checkpoint·inventory는 gitignored 경로에 있고 커밋하지 않았다.

## 10.34 5A-2 전수 결과 offline 분석 — 어느 CLOSED 계약이 무엇을 막는가 — 2026-09-10

**측정만 한다.** 저장된 산출물(`qv-5a2-legal-proposals.json` · checkpoint)만 읽어
production `project_class_proof`를 그대로 다시 돌렸다. SEC/network 호출 없음, 코드·
semantic 변경 없음, 승격·manifest 반영 없음. **해결책을 제안하지 않는다.**

재파생에 쓴 코드가 산출물을 만든 코드와 같은지 먼저 확인했다 —
`git diff 9e1203c..HEAD -- trading/backtest/ trading/selftest/`가 비어 있다.

### 먼저 — 전 population에서 완결된 것이 하나도 없다

```text
ClassEvidence 생성            0 / 672 legal proof
prose_alias_proposal          0 / 897 work item
interval_proved = true 인 share_class_proposal   0
```

그래서 `CANONICAL_CLASS_BRIDGE_NOT_EXPLICIT` 730 = `CLASS_INTERVAL_NOT_EXPLICIT` 730이
같은 수인 것은 우연이 아니다. 둘 다 legal proof가 있는 672건 + 없는 58건이다.

### project_class_proof 단계별 병목

`project_class_proof`의 조기 반환은 각자 고유한 note로 끝난다. 그 note로 단계를
되짚었다(계측을 위해 코드를 고치지 않았다).

```text
                                요구 class   sibling class
SEARCH_NOT_CLOSED                     415          605
NO_BIRTH_ACTION_OR_DATE               254          214
그 밖의 모든 단계                        0            0
```

**도달한 단계가 둘뿐이다.** 탄생일 충돌 · 탄생 문서의 정의/행위 부재 · 종료 충돌 ·
governing 문서 무일자 · current snapshot 부재/동률 · 나중 amendment · snapshot 정의
부재 · 탄생일 동률 · 미해결 영향 — **B2 continuity 사슬의 어느 관문에도 아무것도
도달하지 못했다.** 그 규칙들이 이번 population에서 막은 건수는 0이다.

##### legal search가 COMPLETE인 255건의 histogram

요청된 histogram이다. 탐색이 닫혔는데도 class projection이 COMPLETE가 되지 않은 이유:

```text
NO_BIRTH_ACTION_OR_DATE   254 / 254   (100%)
그 밖                       0
```

sibling도 같다(214/214). **탐색이 닫힌 항목에서는 예외 없이 탄생 증거 하나에서
멈춘다.**

### 왜 탄생 증거가 없는가 — 두 층으로 갈린다

```text
전 population의 finding 종류 (association 필터 전)
  GOVERNING_CLASS_DEFINITION      843
  CLASS_BIRTH_ACTION               19
  CLASS_TERMINATION_EFFECTIVE_DATE 13
  CLASS_BIRTH_EFFECTIVE_DATE        0
```

**`CLASS_BIRTH_ACTION` 19건은 전부 우선주 시리즈다.** 보통주 class에서 탄생 행위
문법이 일치한 건 672개 발행사에서 **0건**이다.

```text
APO  us-gaap:SeriesAPreferredStockMember            1
DLR  ext:...SeriesJ/K/L PreferredStockMember       16
HPE  us-gaap:SeriesCPreferredStockMember            2
MAA  us-gaap:CumulativePreferredStockMember         1
```

그 19건조차 `CLASS_BIRTH_EFFECTIVE_DATE`를 만들지 못했다 — 해당 문서의 법적 발효일이
**전부 `MISSING`**이기 때문이다(APO 1 · DLR 6 · HPE 2 · MAA 1). 즉 탄생 행위와 O2
발효일이 **한 instrument에서 함께** 성립해야 한다는 CLOSED 계약이 그 자리에서 막는다.

##### O2 — governing exhibit의 법적 발효일

```text
governing exhibit 문서            13,177
  MISSING                         12,250   (93.0%)
  RESOLVED                           855   ( 6.5%)
  AMBIGUOUS                           72   ( 0.5%)

탐색이 닫힌 항목만                 3,475
  MISSING                          3,190   (91.8%)
  RESOLVED                           279
  AMBIGUOUS                            6

RESOLVED의 source family
  EXPLICIT_EFFECTIVE_DATE            837
  STATE_FILED_UPON_FILING             14
  ITEM_503_CORROBORATED_UPON_FILING    4
```

O2-C(교차 문서 보강)가 실제로 세운 날짜는 **4건**이고 주 FILED 스탬프 경로는 14건이다.

### `CANONICAL_CLASS_BRIDGE_NOT_EXPLICIT` 730건 분해

요청대로 "실제로 governing canonical definition을 못 찾음"과 "definition은 있었지만
full ClassEvidence가 생성되지 않아 bridge가 노출되지 않음"으로 갈랐다.

```text
legal proof 있음 672 · legal proof 없음 58

요구 class (전부 표지에서 보통주로 증명된 473건)
  A2  governing definition을 못 찾음                        322   (68.1%)
  B   definition은 있었는데 projection 미완결                151   (31.9%)
        ├ NO_BIRTH_ACTION_OR_DATE                            76
        └ SEARCH_NOT_CLOSED                                  75
  C   ClassEvidence가 있는데 bridge만 없음                     0

sibling class (283건)
  A1  표지 제목이 없어 legal 탐색 target이 되지 못함           266   (94.0%)
  A2  governing definition을 못 찾음                           9
  B   definition은 있었는데 projection 미완결                   8
```

**요구 class에서는 C가 0이다** — "definition을 찾고 ClassEvidence까지 만들었는데
bridge만 안 붙은" 경우는 없다. 3분의 1(151건)은 governing definition을 실제로 찾았고,
그 뒤 탄생 증거 또는 탐색 closure에서 막혔다.

**sibling에서는 A1이 지배적이다.** 표지에 제목이 없는 보통주 class는 `_target_names`가
탐색 target으로 삼지 않으므로 legal 층에 도달하지도 못한다. 이것이 표지 anchor 층
(B1 · exact N1)이 실제로 막는 자리다.

### `CLASS_INTERVAL_NOT_EXPLICIT` 730건 분해

요청대로 "demanded class 자체가 미완결"과 "sibling 때문에 package가 막힘"으로 갈랐다.

```text
legal proof 있음 672 · legal proof 없음 58

demanded 미완결 (단독)                        453
demanded가 보통주로 증명 안 됨 → 제안 자체 없음  196
demanded 미완결 + sibling도 미완결               20
demanded를 표지에서 특정 못함                     3
demanded는 완결인데 sibling만 미완결               0
```

**"sibling 때문에 package가 막힌" 경우는 0건이다.** 완결된 class가 전 population에
하나도 없으므로 sibling 단독 차단은 구조적으로 나올 수 없다. 196건은 sibling 문제가
아니라 **요구된 class 자신이 표지에서 보통주로 증명되지 않아**(`has_shares_fact`
없음) 제안 자체가 만들어지지 않은 경우다 — 이는 표지 층이다.

### 10.33의 해석 정정

10.33 초판은 "legal 탐색이 닫히기 전에 표지 anchor 층에서 이미 걸린다"고 적었다.
**자료가 그것을 뒷받침하지 않는다.**

```text
요구된 class를 막는 층
  법적 탄생 증거 층   473 / 473 보통주 요구 class   (A2 322 + B 151)
  표지 층             196 (보통주 미증명) + 3 (특정 실패)

sibling class를 막는 층
  표지 층             266 / 283   (제목 없음 → 탐색 target 아님)
  법적 층              17
```

요구된 class에 대해서는 **표지 anchor를 통과한 뒤 법적 층에서 막힌다.** 표지 층이
막는 것은 요구 class 199건과 sibling 266건, 합쳐 465건이고 요구 class의 지배적
차단 지점이 아니다. 10.33 해당 문단에 정정을 달았다.

### 이번 population에서 각 CLOSED 계약이 실제로 막은 건수

```text
탐색 closure (INCOMPLETE)                     요구 415 · sibling 605
탄생 행위 + O2 발효일 동시 성립               요구 254 · sibling 214   (탐색 닫힌 전부)
B1 표지 제목 anchor (제목 없으면 target 아님)  sibling 266
표지 보통주 증명 (has_shares_fact)             요구 196
exact N1 / P2 연결 실패                        0
B2 continuity 사슬 (snapshot·amendment·영향)   0
종료 규칙                                      0
```

**exact N1 · P2 · B2 · 종료 규칙은 이번 population에서 아무것도 막지 않았다** — 그
앞 단계에서 이미 멈추기 때문이다. 이 측정은 그 규칙들이 느슨하다는 뜻도 엄격하다는
뜻도 아니고, **아직 시험되지 않았다**는 뜻이다.

### 범위

- 저장된 산출물만 읽었다. SEC/network 호출 0회.
- 코드·semantic·문턱을 바꾸지 않았고 새 규칙이나 해결책을 제안하지 않는다.
- 승격·manifest 반영·5A-3·Gate·returns·ranking·portfolio를 실행하지 않았다.
- 분석 스크립트는 스크래치에 두고 저장소에 커밋하지 않는다.

## 10.35 5A-2 진단 probe — 보통주 탄생/발효일이 원문에 있는가 — 2026-09-10

**진단 probe다.** parser·semantics·CLOSED 계약을 바꾸지 않았고, 전수 재실행·제출 이력
재열거·승격·manifest 변경을 하지 않았다. **해결책이나 정규식을 제안하지 않는다.**

10.34가 "요구 class 254/254가 탐색이 닫히고도 탄생 증거에서 멈춘다"를 셌다. 이 절은
**그 원인이 parser recall인지 원문 부재인지**를 실제 SEC 원문으로 가른다.

### 표본 — 30문서 · 29 발행사

선정은 저장된 5A-2 산출물에서만 했다(회사 재발견·이력 재스캔 없음).

```text
선정 규칙 (재현 가능)
  natural_key = f"{cik}|{accession}|{document_name or ''}|{document_sequence or ''}|{member_key}"
  order_key   = sha256("qv-5a2-birth-probe-v1|" + natural_key).hexdigest()
  pool 안에서 order_key 오름차순, 앞 pool과 문서 중복 배제,
  1차 순회에서 CIK 중복 배제 후 정원 미달이면 2차에서 허용
```

```text
Pool A  15   요구 보통주 · 탐색 COMPLETE · governing definition 있음 · NO_BIRTH_ACTION_OR_DATE
             (후보 76 · 고유 CIK 71)
Pool B  10   요구 보통주 definition 있음 · 해당 governing exhibit operative MISSING
             (후보 148 · 고유 CIK 143)
Pool C   5   CLASS_BIRTH_ACTION이 실제로 검출된 우선주 control · operative MISSING
             (후보 19 · 고유 CIK 4 — DLR이 2건, control이라 CIK 재사용 허용)
```

embedded 문서는 승인된 typed locator `(CIK, accession, document_sequence)`로만 해석했다
(MTD seq:2 · CTXS seq:2 · LM seq:3). 파일명을 만들어내지 않았다.

### 받은 바이트 — bounded live fetch

```text
SEC 호출 30회 (선정된 문서 정확히 30건) · 추가 열거 없음 · 자동 재시도 없음
받은 바이트의 SHA-256 30/30이 전수 실행이 기록한 document_sha256과 일치
```

SHA 일치는 **전수 실행이 해시한 그 바이트를 그대로 읽었다**는 뜻이다. 본문은 저장소에
커밋하지 않는다(기존 계약: HTML/본문을 DB·저장소에 넣지 않는다).

### 기계 확인 — production 함수를 그대로 재실행

`governing_operative_date` · `class_birth_action_matches` · O2 네 경로를 30문서에
그대로 돌렸다.

```text
                              A(15)  B(10)  C(5)
CLASS_BIRTH_ACTION 검출          0      0     5
EXPLICIT 발효일 검출             1      0     0
STATE_CERTIFIED 검출             0      0     0
STATE_FILED 스탬프 검출          4      5     1
제출발효 조항(UPON_FILING) 검출   0      0     0
```

**30문서 전부에서 `UPON_FILING_PATTERNS`가 한 번도 맞지 않았다.**

### SOURCE_TEXT_REVIEW — 보통주 25건 (Pool A+B)

> **판정 주체 정정.** 이 절의 초판은 아래 30행을 `HUMAN 판정`이라 적고 "사람이
> 원문을 읽고 내렸다"고 기술했다. **그 provenance는 사실이 아니다.**
>
> ```text
> 판정 주체   MODEL_ASSISTED_SOURCE_TEXT_JUDGMENT
>             원문을 읽고 판정한 것은 이 작업을 실행한 모델이다.
> 아닌 것     primary-human gold judgment가 아니다.
>             사람의 adjudication은 없었고 그것을 뒷받침할 human receipt도 없다.
> ```
>
> 저장소 소유자가 이 30건을 직접 판정한 적이 없으므로 `HUMAN` 표기를 유지하지
> 않는다. 모델 판정을 사람 증거로 조용히 바꾸지 않는다. 아래 수치는 그 전제에서
> 읽어야 하고, 사람 검토가 필요하면 §10.35-A의 행 단위 부록이 그 입력이다.

자동 분류가 아니라 원문을 읽고 내린 판정이지만, 읽은 주체는 사람이 아니라 모델이다.

```text
BIRTH_ACTION_SOURCE_JUDGMENT
  EXPLICIT_TARGET_CLASS_CREATION      0
  DEFINITION_ONLY                    18
  OTHER / AMBIGUOUS                   7
  현재 parser의 놓친 건수(false negative)   0
```

`DEFINITION_ONLY` 18건은 전부 자본구조 지정 문언이다 — `designated "Common Stock"` ·
`authorized to issue ... shares of Common Stock` · `divided into`. **그 class가 언제
어떤 행위로 생겼는지를 말하지 않는다.**

`OTHER / AMBIGUOUS` 7건의 내역:

```text
기존 문자 class를 대상 보통주로 재분류·재지정   6   CXO · UIS · VRSK · FCX · DISCA · MSCI
문서 본문이 bye-laws (governing charter 아님)    1   EG
```

그 6건은 예컨대 `each share of Class A Common Stock ... shall be automatically
reclassified as one ... share of Common Stock`(VRSK) 같은 모양이다. **재분류는 탄생이
아니라는 것이 CLOSED 결정**이므로(설계 문서 5A-2 절) parser가 내보내지 않는 것이
계약대로다 — recall 결함이 아니라 계약 범위다.

```text
OPERATIVE_DATE_SOURCE_JUDGMENT
  EXPLICIT_DATE_PRESENT                3    LW · WEC · DISCA
  EFFECTIVE_UPON_FILING_PRESENT        3    VRSK · FCX · MSCI
  STATE_CERTIFIED_DATE_PRESENT         0
  NO_SUPPORTED_OPERATIVE_DATE         19
  AMBIGUOUS                            0
  현재 O2 true positive                1    LW
  현재 O2 놓친 건수                     5    WEC · DISCA · VRSK · FCX · MSCI
```

### 놓친 어휘 계열 — 재현성 측정

```text
반복 계열 1건
  "effective upon the filing of <instrument 이름> with <주 기관>"
  현행 UPON_FILING_PATTERNS는 filing 바로 뒤 with를 요구해 instrument 이름이
  끼면 맞지 않는다.
  출현 4회   VRSK · FCX · MSCI · (control) MAA

단발 표현 2건
  대문자 월 표기        "AS AMENDED EFFECTIVE MAY 21, 2012"        WEC   1회
  발효일 앞 시각 삽입구 "effective as of 5:00 p.m. ... on <date>"  DISCA 1회
```

### 놓친 것을 인정했다면 실제로 날짜가 나왔는가

```text
WEC    나온다   2012-05-21
DISCA  나온다   2022-04-08
VRSK   안 나온다   제출발효 조항은 있으나 문서에 주 FILED 스탬프가 없다
MSCI   안 나온다   동     상
FCX    틀린 날짜가 나온다   아래를 보라
```

`STATE_FILED_STAMP_PATTERNS`가 맞은 9건을 원문에서 확인한 결과 **8건이 이 instrument의
FILED 스탬프가 아니라 원 설립 제출일 recital**이었다.

```text
진짜 주 FILED 스탬프   1건   NWL "Delivered 12:36 pm 05/06/2008 FILED 12:36 pm 05/06/2008"
원 설립일 recital      8건   CXO 2006 · LW 2016 · VEEV 2007 · FCX 1987 · NWL 1987 ·
                             DISCA 2008 · TDC 2007 · EXE 1996/1998 · HPE 2024
```

그래서 FCX는 조항을 인정해도 1987년(원 설립일)이 2007년 restatement의 발효일로
파생된다. 오늘은 조항 검출이 0이라 `derived`가 항상 비어 무해하지만, **이 관측은
사실로 적어 둔다.**

> **관측으로만 남긴다.** 이 스탬프 귀속 문제(recital과 이 instrument의 FILED 스탬프를
> 가르지 못한다)는 이 commit에서 O2를 고치지 않는다. 그리고 **스탬프 귀속이 따로
> 설계되기 전에는 `UPON_FILING` 확장을 제안하지 않는다** — 조항만 넓히면 위 FCX처럼
> 잘못된 날짜가 파생되는 경로가 열린다. 그리고 NWL은 진짜 스탬프가 있는데 조항이 없어 MISSING이다 —
CLOSED 계약("스탬프 단독은 발효를 만들지 않는다") 그대로다.

결과적으로 O2 recall을 계열대로 넓혔다면 **보통주 25건 중 2건**(WEC · DISCA)이 올바른
발효일을 얻었을 것이다. 나머지는 원문에 쓸 날짜가 없거나 틀린 날짜가 나온다.

### 우선주 control (Pool C, 5건)

```text
EXPLICIT_TARGET_CLASS_CREATION      5 / 5
현재 parser true positive           5 / 5      놓친 건수 0
```

```text
DLR  "A series of Preferred Stock, designated the '5.200% Series L ...', is hereby established."
APO  "a series of Preferred Stock be, and hereby is, created and designated 6.75% Series A ..."
MAA  "A series of Preferred Stock, designated the '8.50% Series I ...', is hereby established."
HPE  "the New Preferred Stock be, and hereby is, created and designated 7.625% Series C ..."
```

**탄생 문법은 진짜 창설 문언을 정확히 인식한다.** 같은 parser가 보통주에서 0건인 것은
문법의 능력 문제가 아니다.

control의 발효일은 5건 중 4건이 원문에 없고(원 제출일 recital뿐), MAA 1건은
`effective at the time the Tennessee Secretary of State accepts this amendment for
filing`으로 위 반복 계열의 또 다른 변형이지만 스탬프가 없어 날짜가 나오지 않는다.

### 결론

```text
CONCLUSION: MIXED
```

두 층이 서로 다른 답을 준다. 합치면 정확도가 떨어지므로 나눠 적는다.

```text
탄생 층    SOURCE_DOES_NOT_STATE_TRUE_BIRTH  (이 표본이 뒷받침한다 · 전수 증명은 아니다)
           결정론적 보통주 25문서에서 명시 창설 문언 0건 · parser 놓침 0건 ·
           control 5/5 정상. 여기에 10.34의 전수 관측(완결된 ClassEvidence 0건)이
           같은 방향을 가리킨다.

발효일 층  PARSER_RECALL_GAP (작다)
           보통주 25건 중 5건을 놓쳤고 반복 계열 1개(4회) + 단발 2개다.
           다만 인정해도 올바른 날짜가 나오는 것은 2건뿐이다.
```

**이 결론이 주장하지 않는 것.** "어떤 SEC 문서도 보통주 탄생을 말할 수 없다"를 증명하지
않는다. 증명한 것은 **이 30문서 표본과 이 증거 지평 안에서** 후기 governing instrument가
그 class를 정의하되 원래의 법적 창설 사건·날짜를 말하지 않는다는 것이고, 전수 population은
그것과 모순되지 않는 관측(완결 0건)을 준다. 다른 지평(원 설립 charter · S-1 · 주 기록)에서
그 문언이 나올 가능성은 이 probe가 판단하지 않았다.

**발효일 recall을 넓혀도 이번 표본에서 탄생 증거는 하나도 생기지 않는다** — 두 요소가
한 instrument에서 함께 성립해야 하는데 창설 문언 자체가 0건이기 때문이다.

이 절은 계약을 다시 열지 않는다. 어떤 규칙 변경도 제안하지 않는다.

### 자료 구분

```text
저장소·코드 사실   선정에 쓴 산출물은 9e1203c가 만들었고 trading/backtest·selftest는
                   그 이후 변경 0. 기계 확인은 production 함수를 그대로 호출했다.
저장된 population 측정   pool 후보 수 · 단계 분포 · operative 상태는 10.34와 같은 산출물이다.
새로 수행한 원문 판정     위 두 판정표 30행 — MODEL_ASSISTED_SOURCE_TEXT_JUDGMENT.
                   실행 모델이 원문을 읽고 내렸다. 사람 판정이 아니고 human receipt도 없다.
bounded live SEC fetch   30회. 선정된 문서만. 재시도·확장 없음. SHA 30/30 일치.
GitHub CI                이 절과 무관하다 — CI는 Python 테스트를 돌리지 않는다.
```

### 범위

- production parser·semantics·CLOSED 계약(탄생·O2·O2-C·B1·B2·P2·N1)을 바꾸지 않았다.
- 897건 전수 재실행·제출 이력 재스캔을 하지 않았다.
- 승격·manifest 변경·5A-3·Gate·returns·ranking·portfolio를 하지 않았다.
- 받은 SEC 본문과 분석 스크립트는 스크래치에 두고 커밋하지 않는다.

## 10.35-A 진단 probe 행 단위 감사 부록 — 30/30

10.35가 선정한 **바로 그 30문서**다. 표본을 바꾸지 않았고 새 발행사를 받지 않았다.

```text
행 수                30 / 30
source SHA-256 대조   30 / 30 일치 (5A-2 전수 실행이 기록한 document_sha256과)
판정 주체            MODEL_ASSISTED_SOURCE_TEXT_JUDGMENT — 실행 모델이 원문을 읽었다.
                     primary-human gold가 아니고 사람 adjudication은 없었다.
인용 범위            감사에 필요한 최소 구간만. 전체 filing을 싣지 않는다.
```

`CLASS_BIRTH_ACTION parser` 줄은 production `class_birth_action_matches`를 그 문서에
다시 돌린 결과이고, `operative`는 전수 실행이 기록한 값이다.

#### [A] LNT / LNT — 0000107832-02-000073

```text
CIK               0000352541
locator           sept10q2002exh3pt1.txt
member_key        __NO_CLASS_AXIS__
target class      Common Stock, $0.01 Par Value
form / type       10-Q / EX-3
classification    AMENDED_AND_RESTATED_ARTICLES
operative         MISSING / None
CLASS_BIRTH_ACTION parser   0건 검출  (definition 1건)
source SHA-256    OK (5A-2 기록과 대조)
source URL        https://www.sec.gov/Archives/edgar/data/352541/000010783202000073/sept10q2002exh3pt1.txt
```
- class 근거 — `block:0 … The authorized capital stock ---------- of the Corporation shall consist of 40,000,000 shares, of which (i) 24,000,000 shares shall designated "Common Stock" of the par value of $2.50 each; and (ii) 16,000,000 shares shall be designated "Preferred Stock" of the par value of $.01 each. …`
- 발효일 근거 — 이 instrument의 발효를 말하는 문언이 없다
- 판정 — **DEFINITION_ONLY** / **NO_SUPPORTED_OPERATIVE_DATE** — 자본구조 지정만. 창설 행위·발효일 문언 없음.

#### [A] CXO / CXO — 0000950129-07-003852

```text
CIK               0001358071
locator           h48791exv3w1.htm
member_key        __NO_CLASS_AXIS__
target class      Common Stock, par value $0.001 per share
form / type       8-K / EX-3.1
classification    RESTATED_CERTIFICATE
operative         MISSING / None
CLASS_BIRTH_ACTION parser   0건 검출  (definition 1건)
source SHA-256    OK (5A-2 기록과 대조)
source URL        https://www.sec.gov/Archives/edgar/data/1358071/000095012907003852/h48791exv3w1.htm
```
- class 근거 — `block:18 … time (the “Old Common Stock”) shall be and hereby is automatically reclassified, changed and converted into one-half of a share (the “Reverse Stock Split”) of Common Stock without any action by the holder thereof. Shares of Old Common Stock that are held by stockholders through …`
- 발효일 근거 — `block:6 … The original certificate of incorporation was filed with the Secretary of State of the State of Delaware on February 22, 2006. …`
- 판정 — **OTHER_AMBIGUOUS** / **NO_SUPPORTED_OPERATIVE_DATE** — 역분할. Old Common Stock을 같은 Common Stock으로 재분류 — 새 class 창설 아님.

#### [A] UIS / UIS — 0000746838-09-000207

```text
CIK               0000746838
locator           ex3splitamend.txt
member_key        __NO_CLASS_AXIS__
target class      Common Stock, par value $.01
form / type       8-K / EX-3.1
classification    CERTIFICATE_OF_AMENDMENT
operative         MISSING / None
CLASS_BIRTH_ACTION parser   0건 검출  (definition 1건)
source SHA-256    OK (5A-2 기록과 대조)
source URL        https://www.sec.gov/Archives/edgar/data/746838/000074683809000207/ex3splitamend.txt
```
- class 근거 — `block:0 … nt to the General Corporation Law of the State of Delaware, each ten (10) shares of the Corporation's Common Stock, par value $.01 per share, issued and outstanding immediately prior to the Effective Time shall automatically be combined into one (1) validly issued, fully paid and …`
- 발효일 근거 — `block:0 … the dates from which dividends thereon shall be cumulative. Upon the filing and effectiveness (the "Effective Time") of this amendment to the Restated Certificate of Incorporation of the Corporation pursuant to the General Corporation Law of the State of Delaware, each ten (10) shares of the …`
- 판정 — **OTHER_AMBIGUOUS** / **NO_SUPPORTED_OPERATIVE_DATE** — 역분할 결합. 제출 발효를 말하나 주 기관 지정이 없고 스탬프도 없다.

#### [A] IT / IT — 0000950123-00-011900

```text
CIK               0000749251
locator           y43399ex3-1_a.txt
member_key        __NO_CLASS_AXIS__
target class      Common Stock, $.0005 par value per share
form / type       10-K / EX-3.1.A
classification    AMENDED_AND_RESTATED_CERTIFICATE
operative         MISSING / None
CLASS_BIRTH_ACTION parser   0건 검출  (definition 1건)
source SHA-256    OK (5A-2 기록과 대조)
source URL        https://www.sec.gov/Archives/edgar/data/749251/000095012300011900/y43399ex3-1_a.txt
```
- class 근거 — `block:0 … 000) shares. Two hundred fifty million (250,000,000) shares shall be designated common stock (the "Common Stock"), of which one hundred sixty-six million (166,000,000) shares shall be designated Common Stock, Class A (the "Class A Common Stock") and eighty-four million (84,000,000) shares sh …`
- 발효일 근거 — 이 instrument의 발효를 말하는 문언이 없다
- 판정 — **DEFINITION_ONLY** / **NO_SUPPORTED_OPERATIVE_DATE** — authorized/designated 지정만.

#### [A] VST / VST — 0001193125-20-132407

```text
CIK               0001692819
locator           d899504dex31.htm
member_key        __NO_CLASS_AXIS__
target class      Common stock, par value $0.01 per share
form / type       8-K / EX-3.1
classification    RESTATED_CERTIFICATE
operative         MISSING / None
CLASS_BIRTH_ACTION parser   0건 검출  (definition 1건)
source SHA-256    OK (5A-2 기록과 대조)
source URL        https://www.sec.gov/Archives/edgar/data/1692819/000119312520132407/d899504dex31.htm
```
- class 근거 — `block:19 … authority to issue is 1,900,000,000, of which 1,800,000,000 shall be designated as Common Stock, par value $.01 per share (the “Common Stock”), and 100,000,000 shall be designated as Preferred Stock, par value $.01 per share (the “Preferred Stock”). For the avoidance of doubt, notwithstanding a …`
- 발효일 근거 — 이 instrument의 발효를 말하는 문언이 없다
- 판정 — **DEFINITION_ONLY** / **NO_SUPPORTED_OPERATIVE_DATE** — designated as Common Stock 지정만.

#### [A] VRSK / VRSK — 0001193125-15-206612

```text
CIK               0001442145
locator           d933894dex31.htm
member_key        __NO_CLASS_AXIS__
target class      Common Stock $.001 par value
form / type       8-K / EX-3.1
classification    AMENDED_AND_RESTATED_CERTIFICATE
operative         MISSING / None
CLASS_BIRTH_ACTION parser   0건 검출  (definition 1건)
source SHA-256    OK (5A-2 기록과 대조)
source URL        https://www.sec.gov/Archives/edgar/data/1442145/000119312515206612/d933894dex31.htm
```
- class 근거 — `block:15 … issued and outstanding immediately prior thereto, shall be automatically reclassified as one validly issued, fully paid and non-assessable share of Common Stock without any further action on the part of the Corporation or by the holder thereof. Each certificate formerly representing a share …`
- 발효일 근거 — `block:9 … 4. This Certificate shall become effective upon the filing of this Amended and Restated Certificate of Incorporation with the Secretary of State of the State of Delaware. …`
- 판정 — **OTHER_AMBIGUOUS** / **EFFECTIVE_UPON_FILING_PRESENT** — Class A를 Common으로 재분류. 제출 발효 조항 있으나 주 FILED 스탬프 없어 날짜 없음.

#### [A] LW / LW — 0001193125-16-766127

```text
CIK               0001679273
locator           d273163dex31.htm
member_key        __NO_CLASS_AXIS__
target class      Common Stock, $1.00 par value
form / type       8-K / EX-3.1
classification    AMENDED_AND_RESTATED_CERTIFICATE
operative         RESOLVED / EXPLICIT_EFFECTIVE_DATE
CLASS_BIRTH_ACTION parser   0건 검출  (definition 1건)
source SHA-256    OK (5A-2 기록과 대조)
source URL        https://www.sec.gov/Archives/edgar/data/1679273/000119312516766127/d273163dex31.htm
```
- class 근거 — `block:37 … Section 1. Authorized Capital Stock. The Corporation is authorized to issue two classes of capital stock, designated Common Stock and Preferred Stock. The total number of shares of capital stock that the Corporation is authorized to issue is six hundred sixty million (660,000,000) share …`
- 발효일 근거 — `block:10 … 3. Effective as of November 8, 2016, the text of the Certificate of Incorporation of the Corporation is amended and restated in its entirety to read as set forth in Exhibit A attached hereto. …`
- 판정 — **DEFINITION_ONLY** / **EXPLICIT_DATE_PRESENT** — 지정만. 명시 발효일이 있고 parser가 인식했다(유일한 true positive).

#### [A] MTD / MTD — 0000895345-98-000141

```text
CIK               0001037646
locator           seq:2
member_key        __NO_CLASS_AXIS__
target class      Common Stock, $0.01 par value
form / type       10-K / EX-3.1
classification    AMENDED_AND_RESTATED_CERTIFICATE
operative         MISSING / None
CLASS_BIRTH_ACTION parser   0건 검출  (definition 1건)
source SHA-256    OK (5A-2 기록과 대조)
source URL        https://www.sec.gov/Archives/edgar/data/1037646/000089534598000141/0000895345-98-000141.txt
```
- class 근거 — `block:0 … ll be designated as Preferred Stock, and 125,000,000 shares shall be designated as Common Stock. A. Preferred Stock. The Board of Directors is authorized, subject to limitations prescribed by law, to provide for the issuance of shares of Preferred Stock in one or more series, to establish the n …`
- 발효일 근거 — 이 instrument의 발효를 말하는 문언이 없다
- 판정 — **DEFINITION_ONLY** / **NO_SUPPORTED_OPERATIVE_DATE** — 지정만. 발효일 어휘 자체가 없다.

#### [A] VEEV / VEEV — 0001193125-13-406605

```text
CIK               0001393052
locator           d615271dex31.htm
member_key        __NO_CLASS_AXIS__
target class      Class A Common Stock,par value $0.00001 per share
form / type       8-K / EX-3.1
classification    RESTATED_CERTIFICATE
operative         MISSING / None
CLASS_BIRTH_ACTION parser   0건 검출  (definition 1건)
source SHA-256    OK (5A-2 기록과 대조)
source URL        https://www.sec.gov/Archives/edgar/data/1393052/000119312513406605/d615271dex31.htm
```
- class 근거 — `block:22 … ons. Shares of Class A Common Stock or Class B Common Stock may not be subdivided, combined or reclassified unless the shares of the other class are concurrently therewith proportionately subdivided, combined or reclassified in a manner that maintains the same proportionate equity …`
- 발효일 근거 — 이 instrument의 발효를 말하는 문언이 없다
- 판정 — **DEFINITION_ONLY** / **NO_SUPPORTED_OPERATIVE_DATE** — Class A Common 창설 문언 없음. 분할·전환 조항뿐.

#### [A] EME / EME — 0000930413-06-001268

```text
CIK               0000105634
locator           c41117_ex3-a4.txt
member_key        __NO_CLASS_AXIS__
target class      Common Stock
form / type       10-K / EX-3.(A-4)
classification    CERTIFICATE_OF_AMENDMENT
operative         MISSING / None
CLASS_BIRTH_ACTION parser   0건 검출  (definition 1건)
source SHA-256    OK (5A-2 기록과 대조)
source URL        https://www.sec.gov/Archives/edgar/data/105634/000093041306001268/c41117_ex3-a4.txt
```
- class 근거 — `block:0 … Restated Certificate of Incorporation of the Corporation is hereby amended by deleting Article FOURTH thereof and by substituting in lieu of said Article the following new Article: "FOURTH. The total number of shares of all classes of stock which the Corporation shall have the authorit …`
- 발효일 근거 — 이 instrument의 발효를 말하는 문언이 없다
- 판정 — **DEFINITION_ONLY** / **NO_SUPPORTED_OPERATIVE_DATE** — Article FOURTH 치환 amendment. 창설·발효 문언 없음.

#### [A] WEC / WEC — 0000107815-12-000108

```text
CIK               0000783325
locator           wec06302012ex31.htm
member_key        __NO_CLASS_AXIS__
target class      Common Stock, $.01 Par Value
form / type       10-Q / EX-3.1
classification    RESTATED_ARTICLES
operative         MISSING / None
CLASS_BIRTH_ACTION parser   0건 검출  (definition 1건)
source SHA-256    OK (5A-2 기록과 대조)
source URL        https://www.sec.gov/Archives/edgar/data/783325/000010781512000108/wec06302012ex31.htm
```
- class 근거 — `block:20 … ll have authority to issue is Three Hundred and Forty Million (340,000,000) shares, consisting of Three Hundred and Twenty-Five Million (325,000,000) shares of Common Stock of the par value of One Cent ($.01) per share (hereinafter called the "Common Stock") and Fifteen Million (15,000,000) shares o …`
- 발효일 근거 — `block:6 … AS AMENDED EFFECTIVE MAY 21, 2012 …`
- 판정 — **DEFINITION_ONLY** / **EXPLICIT_DATE_PRESENT** — 지정만. 발효일이 대문자 월 표기라 EXPLICIT 문법이 놓쳤다.

#### [A] CTXS / CTXS — 0000927016-98-004061

```text
CIK               0000877890
locator           seq:2
member_key        __NO_CLASS_AXIS__
target class      Common Stock, par value $.001 per share
form / type       10-Q / EX-3
classification    CERTIFICATE_OF_AMENDMENT
operative         MISSING / None
CLASS_BIRTH_ACTION parser   0건 검출  (definition 1건)
source SHA-256    OK (5A-2 기록과 대조)
source URL        https://www.sec.gov/Archives/edgar/data/877890/000092701698004061/0000927016-98-004061.txt
```
- class 근거 — `block:0 … of shares of all classes of capital ------ stock which the Corporation shall have authority to issue is 155,000,000 shares, consisting of 150,000,000 shares of Common Stock with a par value of $.001 per share (the "Common Stock") and 5,000,000 shares of Preferred Stock with a par value of $.01 per s …`
- 발효일 근거 — 이 instrument의 발효를 말하는 문언이 없다
- 판정 — **DEFINITION_ONLY** / **NO_SUPPORTED_OPERATIVE_DATE** — 수권주식 증자 amendment. 창설·발효 문언 없음.

#### [A] EG / EG — 0001095073-09-000008

```text
CIK               0001095073
locator           grpbyelaws3-2.htm
member_key        __NO_CLASS_AXIS__
target class      Common Shares, $0.01 par value
form / type       10-K / EX-3.(II)
classification    CERTIFICATE_OF_DESIGNATION
operative         MISSING / None
CLASS_BIRTH_ACTION parser   0건 검출  (definition 1건)
source SHA-256    OK (5A-2 기록과 대조)
source URL        https://www.sec.gov/Archives/edgar/data/1095073/000109507309000008/grpbyelaws3-2.htm
```
- class 근거 — `block:758 … n of these Bye-laws, the share capital of the Company shall initially be divided into two classes of shares consisting of (i) two hundred million (200,000,000) Common Shares and (ii) fifty million (50,000,000) Preferred Shares. The Board may create classes of shares and may increase or decrease the …`
- 발효일 근거 — 이 instrument의 발효를 말하는 문언이 없다
- 판정 — **OTHER_AMBIGUOUS** / **NO_SUPPORTED_OPERATIVE_DATE** — 본문이 bye-laws다. governing charter가 아니어서 창설 문언을 기대할 자리가 아니다.

#### [A] FCX / FCX — 0000950103-07-000681

```text
CIK               0000831259
locator           dp05057e_ex0301.htm
member_key        __NO_CLASS_AXIS__
target class      Common Stock, par value $0.10 per share
form / type       8-K / EX-3.1
classification    AMENDED_AND_RESTATED_CERTIFICATE
operative         MISSING / None
CLASS_BIRTH_ACTION parser   0건 검출  (definition 1건)
source SHA-256    OK (5A-2 기록과 대조)
source URL        https://www.sec.gov/Archives/edgar/data/831259/000095010307000681/dp05057e_ex0301.htm
```
- class 근거 — `block:9 … Common Stock of the Corporation, par value $0.10 per share, redesignated herein as the common stock of the Corporation (the “Common Stock) at the Corporation’s special meeting of stockholders held on March 14, 2007. …`
- 발효일 근거 — `block:85 … Upon the filing of this Amended and Restated Certificate of Incorporation with the Delaware Secretary of State (the “Effective Time”), each outstanding share of the Class B Common Stock (including treasury shares) shall automatical …`
- 판정 — **OTHER_AMBIGUOUS** / **EFFECTIVE_UPON_FILING_PRESENT** — Class B를 common으로 재지정. 제출 발효 조항 있으나 문서의 스탬프 후보는 1987년 원 설립일 recital이다.

#### [A] EFX / EFX — 0001104659-09-032557

```text
CIK               0000033185
locator           a09-13450_1ex3d1.htm
member_key        __NO_CLASS_AXIS__
target class      Common stock, $1.25 par value per share
form / type       8-K / EX-3.1
classification    AMENDED_AND_RESTATED_ARTICLES
operative         MISSING / None
CLASS_BIRTH_ACTION parser   0건 검출  (definition 1건)
source SHA-256    OK (5A-2 기록과 대조)
source URL        https://www.sec.gov/Archives/edgar/data/33185/000110465909032557/a09-13450_1ex3d1.htm
```
- class 근거 — `block:6 … f stock of which Three Hundred Million (300,000,000) shares shall be designated “Common Stock,” $1.25 par value per share, and Ten Million (10,000,000) shares shall be designated “Preferred Stock,” $.01 par value per share. Shares that are reacquired by the Corporation shall be classified as …`
- 발효일 근거 — 이 instrument의 발효를 말하는 문언이 없다
- 판정 — **DEFINITION_ONLY** / **NO_SUPPORTED_OPERATIVE_DATE** — designated Common Stock 지정만.

#### [B] NWL / NWL — 0000950137-08-007241

```text
CIK               0000814453
locator           c26543exv3w2.htm
member_key        __NO_CLASS_AXIS__
target class      Common stock, $1 par value per share
form / type       10-Q / EX-3.2
classification    RESTATED_CERTIFICATE
operative         MISSING / None
CLASS_BIRTH_ACTION parser   0건 검출  (definition 1건)
source SHA-256    OK (5A-2 기록과 대조)
source URL        https://www.sec.gov/Archives/edgar/data/814453/000095013708007241/c26543exv3w2.htm
```
- class 근거 — `block:11 … FOURTH: The total number of shares which the Corporation shall have authority to issue is 810,000,000, consisting of 800,000,000 shares of Common Stock of the par value of $1.00 per share and 10,000,000 shares of Preferred Stock, consisting of 10,000 shares without par value, and 9,990,000 shares of …`
- 발효일 근거 — `block:2 … tate Division of Corporations Delivered 12:36 pm 05/06/2008 FILED 12:36 pm 05/06/2008 SRV 080508722 — 2118347 FILE …`
- 판정 — **DEFINITION_ONLY** / **NO_SUPPORTED_OPERATIVE_DATE** — 진짜 주 FILED 스탬프가 있으나 제출 발효 조항이 없다 — 스탬프 단독은 발효를 만들지 않는다(CLOSED).

#### [B] ITT / ITT — 0000950123-08-005650

```text
CIK               0000216228
locator           y55652exv3w1.htm
member_key        __NO_CLASS_AXIS__
target class      Common Stock, par value $1.00 per share
form / type       8-K / EX-3.1
classification    CERTIFICATE_OF_AMENDMENT
operative         MISSING / None
CLASS_BIRTH_ACTION parser   0건 검출  (definition 1건)
source SHA-256    OK (5A-2 기록과 대조)
source URL        https://www.sec.gov/Archives/edgar/data/216228/000095012308005650/y55652exv3w1.htm
```
- class 근거 — `block:15 … y to issue is 550,000,000 shares, consisting of 500,000,000 shares designated “Common Stock” and 50,000,000 shares designated “Preferred Stock”. The shares of Common Stock shall have a par value of $1 per share, and the shares of Preferred Stock shall not have any par or stated value, excep …`
- 발효일 근거 — 이 instrument의 발효를 말하는 문언이 없다
- 판정 — **DEFINITION_ONLY** / **NO_SUPPORTED_OPERATIVE_DATE** — designated Common Stock 지정만.

#### [B] DISCA / DISCA — 0001193125-22-103051

```text
CIK               0001437107
locator           d328161dex31.htm
member_key        us-gaap:CommonClassAMember
target class      Series A Common Stock, par value $0.01 per share
form / type       8-K / EX-3.1
classification    RESTATED_CERTIFICATE
operative         MISSING / None
CLASS_BIRTH_ACTION parser   0건 검출  (definition 1건)
source SHA-256    OK (5A-2 기록과 대조)
source URL        https://www.sec.gov/Archives/edgar/data/1437107/000119312522103051/d328161dex31.htm
```
- class 근거 — `block:24 … tock, par value $0.01 per share, all of which shall be of a single class designated as Series A Common Stock (the “Common Stock”), and (y) 1,200,000,000 shares of preferred stock, par value $0.01 per share (the “Preferred Stock”), issuable in one or more series as hereinafter provided. The number of a …`
- 발효일 근거 — `block:10 … ate of Delaware (as amended from time to time, the “DGCL”), effective as of 5:00 p.m. Eastern Time on April 8, 2022, so as to read in its entirety in the form attached hereto as Exhibit A and incorporated herein by this reference. …`
- 판정 — **OTHER_AMBIGUOUS** / **EXPLICIT_DATE_PRESENT** — 여러 series를 Common으로 재분류. 명시 발효일이 있으나 시각 삽입구 때문에 EXPLICIT 문법이 놓쳤다.

#### [B] M / M — 0000950152-07-003009

```text
CIK               0000794367
locator           l25203aexv3w1w2.htm
member_key        __NO_CLASS_AXIS__
target class      Common Stock, $.01 par value per share
form / type       10-K / EX-3.1.2
classification    CERTIFICATE_OF_AMENDMENT
operative         MISSING / None
CLASS_BIRTH_ACTION parser   0건 검출  (definition 1건)
source SHA-256    OK (5A-2 기록과 대조)
source URL        https://www.sec.gov/Archives/edgar/data/794367/000095015207003009/l25203aexv3w1w2.htm
```
- class 근거 — `block:7 … ompany is authorized to issue two classes of capital stock, designated Common Stock and Preferred Stock. The total number of shares of capital stock that the Company is authorized to issue is 1,125,000,000 shares, consisting of 1,000,000,000 shares of Common Stock, par value $0.01 per share, and …`
- 발효일 근거 — 이 instrument의 발효를 말하는 문언이 없다
- 판정 — **DEFINITION_ONLY** / **NO_SUPPORTED_OPERATIVE_DATE** — designated Common Stock 지정만.

#### [B] PCAR / PCAR — 0001104659-08-029403

```text
CIK               0000075362
locator           a08-11219_1ex3db.htm
member_key        __NO_CLASS_AXIS__
target class      Common stock, $1 par value
form / type       10-Q / EX-3.B
classification    CERTIFICATE_OF_AMENDMENT
operative         MISSING / None
CLASS_BIRTH_ACTION parser   0건 검출  (definition 1건)
source SHA-256    OK (5A-2 기록과 대조)
source URL        https://www.sec.gov/Archives/edgar/data/75362/000110465908029403/a08-11219_1ex3db.htm
```
- class 근거 — `block:9 … FOURTH: The Corporation is authorized to issue 1,201,000,000 shares of stock of all classes, consisting of 1,200,000,000 shares of common stock having a par value of $1 per share and 1,000,000 shares of preferred stock having no par value. …`
- 발효일 근거 — 이 instrument의 발효를 말하는 문언이 없다
- 판정 — **DEFINITION_ONLY** / **NO_SUPPORTED_OPERATIVE_DATE** — 창설·발효 문언 없음.

#### [B] TDC / TDC — 0001193125-07-198885

```text
CIK               0000816761
locator           dex31.htm
member_key        __NO_CLASS_AXIS__
target class      Common Stock, $0.01 par value
form / type       8-K / EX-3.1
classification    AMENDED_AND_RESTATED_CERTIFICATE
operative         MISSING / None
CLASS_BIRTH_ACTION parser   0건 검출  (definition 1건)
source SHA-256    OK (5A-2 기록과 대조)
source URL        https://www.sec.gov/Archives/edgar/data/816761/000119312507198885/dex31.htm
```
- class 근거 — `block:14 … l number of shares of stock which the Corporation shall have authority to issue is 600,000,000 shares of capital stock, consisting of (a) 500,000,000 shares of common stock, $0.01 par value per share (the “Common Stock”) and (b) 100,000,000 shares of preferred stock, $0.01 par value per share (the “ …`
- 발효일 근거 — `block:6 … he original Certificate of Incorporation of the Corporation was filed with the office of the Secretary of State of the State of Delaware on March 27, 2007. …`
- 판정 — **DEFINITION_ONLY** / **NO_SUPPORTED_OPERATIVE_DATE** — 원 설립일 recital뿐. 창설 문언 없음.

#### [B] MSCI / MSCI — 0001193125-12-212354

```text
CIK               0001408198
locator           d324997dex31.htm
member_key        __NO_CLASS_AXIS__
target class      Common stock, par value $0.01 per share
form / type       10-Q / EX-3.1
classification    AMENDED_AND_RESTATED_CERTIFICATE
operative         MISSING / None
CLASS_BIRTH_ACTION parser   0건 검출  (definition 1건)
source SHA-256    OK (5A-2 기록과 대조)
source URL        https://www.sec.gov/Archives/edgar/data/1408198/000119312512212354/d324997dex31.htm
```
- class 근거 — `block:18 … mmon Stock”) outstanding immediately prior thereto shall be redesignated as one share of Common Stock and (ii) all references to the Class A Common Stock or any right to purchase or acquire the Class A Common Stock (whether in the Certificate of Incorporation or otherwise) shall refer to the Co …`
- 발효일 근거 — `block:66 … This Certificate shall become effective upon the filing of this Third Amended and Restated Certificate of Incorporation with the Secretary of State of the State of Delaware. …`
- 판정 — **OTHER_AMBIGUOUS** / **EFFECTIVE_UPON_FILING_PRESENT** — Class A를 Common으로 재지정. 제출 발효 조항 있으나 스탬프 없어 날짜 없음.

#### [B] LM / LM — 0000704051-96-000026

```text
CIK               0000704051
locator           seq:3
member_key        __NO_CLASS_AXIS__
target class      Common stock, $0.10 par value
form / type       10-Q / EX-3
classification    ARTICLES_OF_AMENDMENT
operative         MISSING / None
CLASS_BIRTH_ACTION parser   0건 검출  (definition 1건)
source SHA-256    OK (5A-2 기록과 대조)
source URL        https://www.sec.gov/Archives/edgar/data/704051/000070405196000026/0000704051-96-000026.txt
```
- class 근거 — `block:0 … orporation is authorized to issue is $41,200,000, represented by 4,000,000 shares of Preferred Stock of the par value of $10 per share and 12,000,000 shares of Common Stock of the par value of $.10 per share." 2. The first sentence of Article SIXTH is amended to read as follows: "SIXTH: The number o …`
- 발효일 근거 — 이 instrument의 발효를 말하는 문언이 없다
- 판정 — **DEFINITION_ONLY** / **NO_SUPPORTED_OPERATIVE_DATE** — 창설·발효 문언 없음.

#### [B] EXE / EXE — 0000950134-01-505480

```text
CIK               0000895126
locator           d89135ex3-1.txt
member_key        __NO_CLASS_AXIS__
target class      Common Stock, $0.01 par value per share
form / type       10-Q / EX-3.1
classification    CERTIFICATE_OF_DESIGNATION
operative         MISSING / None
CLASS_BIRTH_ACTION parser   0건 검출  (definition 1건)
source SHA-256    OK (5A-2 기록과 대조)
source URL        https://www.sec.gov/Archives/edgar/data/895126/000095013401505480/d89135ex3-1.txt
```
- class 근거 — `block:0 … 0) shares, consisting of Ten Million (10,000,000) shares of Preferred Stock, par value $0.01 per share, and Three Hundred Fifty Million (350,000,000) shares of Common Stock, par value $0.01 per share. The preferences, qualifications, limitations, restrictions and the special or relative rights in re …`
- 발효일 근거 — `block:0 … he original Certificate of Incorporation of the Corporation was filed with the Secretary of State of Oklahoma on November 19, 1996 (as amended from time to time, the "Certificate of Incorporation"). C. This Restated Certificate of Incorporation was duly adopted in accordance with the provisions of Section 10 …`
- 판정 — **DEFINITION_ONLY** / **NO_SUPPORTED_OPERATIVE_DATE** — 원 설립일 recital뿐.

#### [B] UNH / UNH — 0000950137-02-001930

```text
CIK               0000731766
locator           c68469ex3-a.txt
member_key        __NO_CLASS_AXIS__
target class      Common Stock, $.01 par value
form / type       10-K / EX-3.(A)
classification    ARTICLES_OF_AMENDMENT
operative         MISSING / None
CLASS_BIRTH_ACTION parser   0건 검출  (definition 1건)
source SHA-256    OK (5A-2 기록과 대조)
source URL        https://www.sec.gov/Archives/edgar/data/731766/000095013702001930/c68469ex3-a.txt
```
- class 근거 — `block:0 … number of shares of capital stock which this corporation is authorized to issue is 1,510,000,000 shares, including 1,500,000,000 shares of Common Stock, $.01 par value, and 10,000,000 shares of Preferred Stock, $.001 par value. Shares of each class of stock of the corporation may be issued for s …`
- 발효일 근거 — 이 instrument의 발효를 말하는 문언이 없다
- 판정 — **DEFINITION_ONLY** / **NO_SUPPORTED_OPERATIVE_DATE** — authorized to issue 지정만.

#### [C] DLR / DLR — 0001558370-20-001906

```text
CIK               0001297996
locator           ex-3d1.htm
member_key        ext:0001297996:SeriesLPreferredStockMember
target class      Series L Cumulative Redeemable Preferred Stock
form / type       10-K / EX-3.1
classification    ARTICLES_OF_AMENDMENT
operative         MISSING / None
CLASS_BIRTH_ACTION parser   1건 검출  (definition 0건)
source SHA-256    OK (5A-2 기록과 대조)
source URL        https://www.sec.gov/Archives/edgar/data/1297996/000155837020001906/ex-3d1.htm
```
- class 근거 — `block:170 … emable Preferred Stock” (the “ Series A Preferred Stock ”), is hereby established. The number of shares of Series A Preferred Stock shall be 4,140,000. …`
- 발효일 근거 — 이 instrument의 발효를 말하는 문언이 없다
- 판정 — **EXPLICIT_TARGET_CLASS_CREATION** / **NO_SUPPORTED_OPERATIVE_DATE** — control. 명시 창설 문언 — parser true positive.

#### [C] APO / APO — 0001193125-23-210853

```text
CIK               0001858681
locator           d538322dex31.htm
member_key        us-gaap:SeriesAPreferredStockMember
target class      6.75% Series A Mandatory Convertible Preferred Stock
form / type       8-K / EX-3.1
classification    AMENDED_AND_RESTATED_CERTIFICATE
operative         MISSING / None
CLASS_BIRTH_ACTION parser   1건 검출  (definition 3건)
source SHA-256    OK (5A-2 기록과 대조)
source URL        https://www.sec.gov/Archives/edgar/data/1858681/000119312523210853/d538322dex31.htm
```
- class 근거 — `block:8 … the Pricing Committee, a series of Preferred Stock be, and hereby is, created and designated 6.75% Series A Mandatory Convertible Preferred Stock, and that the designation and number of shares of such series, and the voting powers, designations, preferences and rights, and qualifications, li …`
- 발효일 근거 — 이 instrument의 발효를 말하는 문언이 없다
- 판정 — **EXPLICIT_TARGET_CLASS_CREATION** / **NO_SUPPORTED_OPERATIVE_DATE** — control. hereby is, created and designated — parser true positive.

#### [C] MAA / MAA — 0001193125-16-765947

```text
CIK               0000912595
locator           d292445dex31.htm
member_key        us-gaap:CumulativePreferredStockMember
target class      8.50% Series I Cumulative Redeemable Preferred Stock
form / type       8-K / EX-3.1
classification    ARTICLES_OF_AMENDMENT
operative         MISSING / None
CLASS_BIRTH_ACTION parser   1건 검출  (definition 2건)
source SHA-256    OK (5A-2 기록과 대조)
source URL        https://www.sec.gov/Archives/edgar/data/912595/000119312516765947/d292445dex31.htm
```
- class 근거 — `block:10 … deemable Preferred Stock” (the “Series I Preferred Stock”), is hereby established. The maximum number of authorized shares of the Series I Preferred Stock shall be 868,000. …`
- 발효일 근거 — `block:76 … THIRD: This amendment to the Charter shall be effective at the time the Tennessee Secretary of State accepts this amendment to the Charter for filing. …`
- 판정 — **EXPLICIT_TARGET_CLASS_CREATION** / **EFFECTIVE_UPON_FILING_PRESENT** — control. 창설 문언 인식됨. 수리시 발효 조항은 반복 계열의 변형이나 스탬프 없어 날짜 없음.

#### [C] HPE / HPE — 0001645590-24-000139

```text
CIK               0001645590
locator           ex-38xcorrectedcertificate.htm
member_key        us-gaap:SeriesCPreferredStockMember
target class      7.625% Series C Mandatory Convertible Preferred Stock, par value $0.01 per share
form / type       10-K / EX-3.8
classification    RESTATED_CERTIFICATE
operative         MISSING / None
CLASS_BIRTH_ACTION parser   1건 검출  (definition 3건)
source SHA-256    OK (5A-2 기록과 대조)
source URL        https://www.sec.gov/Archives/edgar/data/1645590/000164559024000139/ex-38xcorrectedcertificate.htm
```
- class 근거 — `block:21 … d to the Pricing Committee, the New Preferred Stock be, and hereby is, created and designated 7.625% Series C Mandatory Convertible Preferred Stock, and that the designation and number of shares of such series, and the voting powers, designations, preferences and rights, and qualifications, l …`
- 발효일 근거 — `block:8 … he Corporation (the “Series C Certificate of Designations”) was filed with the Secretary of State of the State of Delaware on September 12, 2024, and the Series C Certificate of Designations requires correction as permitted by subsection (f) of Section 103 of the General Corporation Law of the St …`
- 판정 — **EXPLICIT_TARGET_CLASS_CREATION** / **NO_SUPPORTED_OPERATIVE_DATE** — control. 창설 문언 인식됨. 발효일 후보는 원 Certificate of Designations 제출일 recital이다.

#### [C] DLR / DLR — 0001297996-17-000155

```text
CIK               0001297996
locator           ex31-articlesofamendmentan.htm
member_key        ext:0001297996:SeriesJPreferredStockMember
target class      Series J Cumulative Redeemable Preferred Stock
form / type       10-Q / EX-3.1
classification    ARTICLES_OF_AMENDMENT
operative         MISSING / None
CLASS_BIRTH_ACTION parser   1건 검출  (definition 0건)
source SHA-256    OK (5A-2 기록과 대조)
source URL        https://www.sec.gov/Archives/edgar/data/1297996/000129799617000155/ex31-articlesofamendmentan.htm
```
- class 근거 — `block:170 … emable Preferred Stock” (the “ Series A Preferred Stock ”), is hereby established. The number of shares of Series A Preferred Stock shall be 4,140,000. …`
- 발효일 근거 — 이 instrument의 발효를 말하는 문언이 없다
- 판정 — **EXPLICIT_TARGET_CLASS_CREATION** / **NO_SUPPORTED_OPERATIVE_DATE** — control. 명시 창설 문언 — parser true positive.

## 10.36 Option A 실현가능성 census — proved-validity-segment가 실제로 무엇을 여는가 — 2026-09-11

**측정 전용이다.** Option A를 구현하지 않았고 CLOSED 계약을 하나도 바꾸지 않았다.
가설 구간은 scratch 구조에만 계산했고 v3 `RelationInterval`이나 manifest 행으로
직렬화하지 않았다. `birth_date`라 부르지 않고 `hypothetical_valid_from/to` ·
`witness_family`로만 다뤘다.

```text
base commit          e2bc593b613e7899ffbe15f016f96ef6be696d9b
inventory sha256     dc13cae6c9f375c2f1dea72a01da9bc16682d7298fcc2b24900d03feb5a8ceba
5A-2 output sha256   b68813def1f815c174ff454b89a6b198ddbac3eb6fe631ae1232f486b364cfc5
run_identity_sha256  sha256:52ff66d48ef3a1aecc620bd7aed2c5ec15112c57a5abd9d714667532c1165fda
입력 경로            trading/data/qv-5a2-run/ (gitignored)
network calls        0
```

세 SHA 모두 10.33 receipt 기록과 대조해 일치를 확인한 뒤 분석했다. 분석기는 scratch에
두고 커밋하지 않는다. 아래 수치는 전부 **결정론적 코드/데이터 처리**이고 원문 판정을
섞지 않았다.

### 가설 규칙 — 바꾼 것은 하나뿐

원래 탄생 요구만 제거하고 나머지는 현행 계약 그대로 재사용했다. anchor는 §3의 A/B이고
연속성은 현행 B2 fail-close를 그대로 호출한다 — 무일자 governing 문서는 순서를 막고,
미해결 class 영향은 연속성을 막으며, 열린 구간은 현행 current-snapshot 조건을 그대로
요구한다. 새 연속성 가정이 필요한 자리는 `NEEDS_NEW_CONTINUITY_RULE`로 두고 진행하지
않았다. K/Q 표지 사실은 점 증거로만 세고 구간으로 확장하지 않았다.

### 결과 — work item funnel

```text
TOTAL WORK ITEMS                              897
CURRENT AUTO_PROVABLE                           0

  표지 층에서 탈락 (COVER_LAYER_FAILURE)      369
  exact cover association 성립                528
      legal search INCOMPLETE                 332
      governing definition 없음               120
      날짜 있는 anchor 없음                    65
      anchor 있음(탐색 COMPLETE)                11
          -> 무일자 governing 문서가 연속성 차단  11

HYPOTHETICAL OPTION A
  target class validity anchor                  0
  target formation coverage                     0
  target all formations covered                 0
  full sibling package formation coverage       0
  canonical prose package complete              0
  full S1-window sufficient coverage            0
```

### 결과 — demanded formation point funnel

work item 수와 formation point 수를 합치지 않는다.

```text
TOTAL FORMATION POINTS                      9,464

  표지 층에서 탈락                           3,594
  exact cover association 성립               5,870
      legal search INCOMPLETE                3,947
      governing definition 없음              1,248
      날짜 있는 anchor 없음                    597
      anchor 있음 -> 연속성 차단                 78

  가설 구간이 덮은 formation point               0
```

### 연도별 (2010–2026) — 최근 formation도 열리지 않는다

```text
year   covered  search_INC  no_def  no_anchor  undated
2010         0         164      47         21        1
2013         0         175      54         24        1
2016         0         192      60         30        4
2019         0         200      72         35        6
2022         0         198      81         41        7
2026         0         182      85         47        7
```

전 구간에서 `covered = 0`이다. **이 규칙은 최근 formation에만 유리하지도 않다.**

### anchor family

```text
DATED_COMPLETE_GOVERNING_SNAPSHOT   15   (탐색 closure를 무시했을 때)
                                    11   (탐색 COMPLETE까지 요구했을 때)
DATED_EXPLICIT_TARGET_ACTION         0   보통주에서 탄생 행위 finding이 0건이다(10.35)
KQ_COVER_POINT_ONLY                528   구간 증거 없이 점 증거만 있는 요구 class
```

### 하위 섹션이 비는 이유

`§5 sibling` · `§6 canonical prose` · `§7 S1 window`는 전부 0이다. **측정 실패가 아니라
상위 관문에서 0이 나와 표본이 없기 때문이다.** sibling 의미론이나 prose 계약을 완화하지
않았고, 그 층이 안전하다는 뜻도 아니다 — **아직 시험되지 않았다**는 뜻이다.

```text
FULL_S1_WINDOW_COVERAGE            0  (덮은 formation이 0이라 계산할 표본이 없다)
EXACT_EXISTING_SHARE_FACT_COVERAGE NOT_MEASURABLE_PRE_5A3
```

로컬 DB를 확인한 결과 `qv_share_observations` · `qv_class_share_resolutions` ·
`qv_share_classes` · `qv_issuers` · `qv_sec_evidence_documents` · `qv_identity_evidence`가
**전부 0행**이다. 5A-3가 아직 materialize하지 않았으므로 실제 fact instant를 알 수 없고,
이 지표를 채우려고 데이터를 받거나 materialize하지 않았다.

**December D 매핑 주의.** 코드에 formation → December valuation session을 만드는 canonical
helper가 없다(`s1_window()`는 valuation_date를 인자로 받는다). 달력 날짜를 지어내지
않으려고, S1 충분조건을 "formation 직전 해 1월 1일부터 formation까지를 덮는가"로 잡았다 —
그 구간을 덮으면 그 사이 어떤 December D로 끝나는 S1 창도 덮인다. **필요조건이 아니라
충분조건이고**, 이번에는 표본이 0이라 결과에 영향이 없다.

### qv-class-id-v2 충돌 census — 설계가 아니라 정보량 측정

v1 seed가 true birth를 쓰므로 birth-unknown class에 그대로 쓸 수 없다. 탄생 없이 남는
식별 정보가 얼마나 되는지만 셌다. 모집단은 **association이 성립한 요구 보통주 class**다
(가설 구간이 0이라 그 상위 집합으로 잰다).

```text
모집단                                          151
후보키 (CIK, bridge type, comparison_key)       149
  한 class만 가리키는 키                        149
  두 class 이상으로 갈리는 키                     0
서로 다른 cover member가 한 키로 뭉치는 경우        0
같은 키에 액면가 충돌                              0
같은 키에 종료/재분류 증거                          1
금지 seed(ticker·XBRL member·제안 id·삽입 순서)가
  있어야만 유일해지는 경우                          0
```

**이 관측 증거 안에서는 충돌이 없다.** 다만 모집단이 151건이고 재분류 사례가 1건 있으므로
"disambiguation 설계가 불필요하다"로 읽지 않는다 — 같은 키가 서로 겹치지 않는 두 episode에
나타나는 모양은 이 표본에서 관측되지 않았을 뿐이다. v2 seed를 고르지 않았다.

### 해석 — 물어본 것에 답한다

**현재 AUTO 0 중 true-birth 요구가 기여한 몫.** 요구 보통주 528건 중 true-birth를 제거해
실제로 anchor를 얻는 것은 **11건(2.1%)**이고, 그 11건도 전부 연속성에서 막혀 최종
**0건**이 된다. **true-birth 요구는 지배적 차단 지점이 아니다.**

**제거 후 지배적 차단.** 순서대로 `legal search INCOMPLETE 332` → `governing definition
없음 120` → `날짜 있는 anchor 없음 65`다.

**O2 날짜 불완전성이 여전히 구조적으로 지배적인가 — 그렇다.** 셋 중 둘이 직접 O2다.
`날짜 있는 anchor 없음 65`는 정의는 찾았는데 그 문서에 법적 발효일이 없는 경우이고,
`무일자 governing 문서 11`은 anchor를 얻고도 다른 문서의 무일자가 순서를 막은 경우다.
10.35의 실측(governing exhibit 13,177건 중 **93%가 발효일 MISSING**)이 같은 방향이다.

**sibling identity가 지배적인가 — 이 census로는 알 수 없다.** demanded가 0건이라 sibling
층에 도달하지 못했다. 10.34는 sibling 단독 차단이 0건이었다고 셌지만, 그것도 완결이
0건이어서 나온 값이다.

**canonical prose 시간 증명이 지배적인가 — 역시 아직 시험되지 않았다.**

**formation-only 집계가 감추는 하위 차단이 있는가 — 이번에는 없다.** 상위에서 0이라
S1 창 요구가 추가 손실을 만들 자리 자체가 없다. 다만 **5A-3 이후에는 다시 물어야 한다** —
formation 한 점을 덮는 것과 S1 창 전체를 덮는 것은 다른 요구다.

**Option A의 경험적 유용성.** 이 population·이 증거 지평에서 **Option A 단독으로는 아무
work item도 열리지 않는다**(897 → 0). 설계 방향의 옳고 그름을 판정하는 것이 아니라,
**O2 발효일 커버리지가 먼저 해결되지 않으면 Option A만으로는 측정 가능한 이득이 없다**는
사실을 적는다. 성공 문턱을 임의로 만들지 않았고 "Option A 통과"라고 쓰지 않는다.

**남은 semantic 결정.** (1) O2 발효일 커버리지 — 10.35의 반복 계열과 스탬프 귀속 문제가
선행 과제다. (2) 무일자 governing 문서가 순서를 막는 현행 B2 규칙을 유지할 것인가.
(3) sibling·prose 층은 상위가 열린 뒤에 다시 측정해야 한다. **이 census는 그중 어느 것도
결정하지 않는다.**

### 범위

```text
production parser 변경      NO
O2 / O2-C 변경              NO
B1 / B2 / P2 / N1 / C2 변경  NO
bundle schema 변경          NO
qv-class-id 변경            NO
production manifest 변경    NO
promotion 실행              NO
5A-3 실행                   NO
Gate A-H 실행               NO
returns / ranking / portfolio NO
SEC / network 호출          0
```

## 10.37 O2 / governing-date 순서 진단 census — 발효일 공백은 parser인가 원문인가 — 2026-09-11

**진단 전용이다.** production 코드 · O2/O2-C · B1/B2/P2/N1 · 탄생 계약을 바꾸지 않았고 Option A를
구현하지 않았다. 897건 전수 재실행 · 제출 이력 재열거 · 승격 · manifest 변경을 하지 않았다. 아래
반사실은 **측정이지 production-valid가 아니다.**

```text
base commit          b025295c279b6dad98258e2be6335a9ce566bb47
inventory sha256     dc13cae6c9f375c2f1dea72a01da9bc16682d7298fcc2b24900d03feb5a8ceba
5A-2 output sha256   b68813def1f815c174ff454b89a6b198ddbac3eb6fe631ae1232f486b364cfc5
run_identity_sha256  sha256:52ff66d48ef3a1aecc620bd7aed2c5ec15112c57a5abd9d714667532c1165fda
입력 경로            trading/data/qv-5a2-run/ (gitignored)
```

세 SHA를 10.33 기록과 대조해 일치를 확인했다. pool 재구성은 10.36 funnel과 정확히 같다
(표지 층 369 · INCOMPLETE 332 · definition 없음 120 · 날짜 anchor 없음 65 · anchor 11 · closure
무시 anchor 15). 10.36의 528은 `trading_symbol`을 **대소문자 무시로** 맞춘 값이다 — 제목 없는
소문자 심볼 10건(`cvg` · `mmm` …)이 여기 들어간다.

### network — bounded exact refetch

로컬 본문 캐시가 없었다(`EdgarClient`는 캐시하지 않고 10.35 스크래치는 남아 있지 않다). 이미 알려진
자연키의 정확한 URL만 받았다.

```text
Pool B/C 문서 137건                 136회   SHA 137/137   (embedded 자식이 부모 submission을 공유)
O2-C primary 확인                     1회   SHA 1/1
Pool C 현행 anchor 귀속 확인          9회   SHA 9/9       (anchor Exhibit 8 + O2-C primary 1)
반사실 연속성 문서 94건              92회   SHA 94/94
합계                                238회   불일치 0 · 오류 0 · 자동 재시도 0 · 제출 이력 열거 0
```

### POOL A — legal search INCOMPLETE 332 (저장 산출물만)

```text
332 = legal search INCOMPLETE 277 + legal search 미실행 55
```

**55건은 탐색 실패가 아니다.** 표지 대응은 됐지만 요구 class에 표지 제목이 없어(B1)
`_target_names`가 legal target을 만들지 않았고 `legal_evidence_proof`가 null이다. 10.36이 이 55건을
INCOMPLETE 칸에 넣었다.

failure family — 한 item이 여러 family를 가질 수 있다(겹침 포함).

```text
family                     items  CIKs  accessions  documents  rows
governing_exhibit_missing    158   157        320          -    321
classify                     139   137        476        629    633
document                      65    64         75         90     91   HTTP 404 76 · 503 15
index                         26    26         42          -     42   HTTP 404 38 · 503 4
legacy_layout                 13    13         14          -     14
submissions                    0     0          0          -      0
other (legal search 미실행)    55    55          -          -      -
```

family 하나뿐인 item은 governing_exhibit_missing 75 · classify 61 · 미실행 55 · document 25 ·
index 7 · legacy_layout 3이고 나머지 106건은 둘 이상이다.

```text
transport/source retrieval (index·document)   84 items · 그것만인 item 32 (그중 전부 HTTP 503인 item 3)
malformed legacy layout                       13 items (단독 3)
governing exhibit 누락 (Item 5.03)            158 items (단독 75)
classification 실패                           139 items (단독 61) — 저장된 classification_families가 전부 비어 있다.
                                              무슨 문서인지는 NOT_MEASURABLE (본문을 받지 않았다)
지평 밖 accession 때문에 INCOMPLETE           0 — search_status는 failures가 있을 때만 INCOMPLETE다.
                                              277/277이 accessions_outside_horizon > 0이지만 원인이 아니다.
                                              지평 밖에 governing instrument가 있는지는 NOT_MEASURABLE
date / O2 관련                                0 — O2 · O2-C는 failure를 만들지 않는다
O2 parser 변경으로 개선 불가                  332 / 332
```

### POOL B · POOL C 구조 (결정론적)

```text
POOL B  65 = 무일자 snapshot 정의 문서가 있는 item 54 (문서 96) + 정의가 amendment 계열에만 있는 item 11
POOL C  11 work items · 6 CIK · 막는 무일자 governing Exhibit 3 41건 (전부 열거)
          BYLAWS 18 · CERTIFICATE_OF_AMENDMENT 7 · AMENDED_AND_RESTATED_CERTIFICATE 6 ·
          AMENDED_AND_RESTATED_ARTICLES 5 · RESTATED_CERTIFICATE 2 · CERTIFICATE_OF_DESIGNATION 2 ·
          CERTIFICATE_OF_ELIMINATION 1
```

amendment-only 11건(DRI · EG · EME · FIX · FLIR · HONA · IRM · ODP · VICI · VLTO · VRT)은 10.36 anchor
정의(날짜 있는 완전 snapshot)상 **O2가 무엇을 해도 anchor가 생기지 않는다.**

**현행 B2 undated 관문은 분류가 아니라 TYPE으로 governing을 고른다**
(`document_proof_authority(document_type) == GOVERNING_EXHIBIT`). 그래서 BYLAWS로 분류된 EX-3도 순서를
막고, Pool C 41건은 전부 "현행 B2에서 대상 class 연대기에 영향을 준다"다. anchor 문서 여부와 차단
문서 여부는 행 단위 부록의 `B2 role` 열에 있다.

### 기계 census — production 함수를 그대로 다시 돌렸다

```text
                                        Pool B 96     Pool C 41
classification · operative status parity   96/96         41/41      (MISSING 136 · AMBIGUOUS 1)
EFFECTIVE_DATE_PATTERNS 일치 문서            1             1         FDXF(날짜 둘 -> AMBIGUOUS) · Q bylaws(대문자 월 -> _iso_date 실패)
STATE_CERTIFIED_DATE_PATTERNS                0             0
UPON_FILING_PATTERNS                         0             0
STATE_FILED_STAMP (주 게이트 통과)       35문서 47건   11문서 14건
O2-C 교차 조항 (DGCL)                        0             2         NWS 8-K primary에 ITEM_503 문형 0 · FOXA는 10-Q라 primary가 없다
```

O2-C 두 건은 현행 계약대로 MISSING이다. 반사실 연속성 문서 94건도 parity 94/94다.

### 현행 anchor 귀속 확인 — Pool C 8문서

반사실이 anchor 날짜 위에 서므로 그 날짜의 근거 block을 원문으로 확인했다(MODEL_ASSISTED).

```text
WST  2020 · 2024 A&R articles   "(Effective as of May 5, 2020)" · "(Effective as of April 24, 2024)"          맞다
FLT  2023 ex31 · ex32           "(As Amended on, and Effective as of June 9, 2022)"                            맞다
LW   2016 A&R certificate       "Effective as of November 8, 2016, the text ... is amended and restated"       맞다
FOX  2019 A&R (O2-C)            primary "filed with the Secretary of State ... and became effective on March 18, 2019"  맞다
NWS  2018 restated certificate  block:207 "The effective time of this Certificate of Designations shall be June 28, 2013"  틀리다
Q    2025 A&R certificate       block:83 "Separation and Distribution Agreement, effective as of November 1, 2025"        틀리다
```

**EXPLICIT_EFFECTIVE_DATE 문법에도 귀속 게이트가 없다.** NWS는 합본 안의 우선주 지정서 발효일을, Q는
다른 계약서의 발효일을 그 instrument의 날짜로 받았다. Pool C 11건 중 3건(NWS · NWSA · Q)의 현행
anchor가 그렇다. FDXF(Pool B)의 AMBIGUOUS도 같은 원인이다 — 선행 amendment의 `filed ... effective on
May 27, 2026`을 이 문서의 날짜로 함께 받았다. **이 census는 그 anchor를 수치에서 빼지 않는다** — 빼는
것이 새 규칙이다.

### SOURCE_TEXT_REVIEW

```text
판정 주체   MODEL_ASSISTED_SOURCE_TEXT_JUDGMENT — 실행 모델이 원문을 읽고 판정했다.
            primary-human gold가 아니고 사람 adjudication도 human receipt도 없다.
판정 수     231문서 = Pool B 96 · Pool C 41 · 반사실 연속성 94
보조 장치   결정론적 prescreen이 발효/제출 어휘와 날짜가 같은 block에 있거나 제출-발효 조항 모양인 block만
            창으로 뽑았다. 창이 0인 문서는 무필터 effective…<date> · 조항 · 범례 정규식으로 다시 확인했다.
판정 규칙   A/B/C  현행 O2 의미의 사실이 대상 instrument에 붙어 있는데 parser가 놓쳤다
            F      대상 instrument의 후보 날짜/사건이 둘 이상이고 현행 규칙으로 가를 수 없다
            D      발효·제출·설립·서명처럼 보이는 날짜가 있지만 다른 instrument·사건의 것이다
            E      그런 날짜가 없다 (Rule 12b-2 기준일 · 배당/상환일은 세지 않는다)
```

```text
OPERATIVE_DATE_SOURCE_JUDGMENT          Pool B 96   Pool C 41   연속성 94   합 231
A  CURRENT_O2_EXPLICIT_DATE_PRESENT         13           6           6        25
B  CURRENT_O2_UPON_FILING_PRESENT            0           0           0         0
C  CURRENT_O2_STATE_CERTIFIED_DATE_PRESENT   0           0           0         0
D  DATE_PRESENT_BUT_WRONG_ATTRIBUTION       66          14          14        94
E  SUPPORTED_DATE_NOT_STATED                16          21          73       110
F  AMBIGUOUS                                 1           0           1         2
G  OTHER                                     0           0           0         0
```

**B가 0인 이유.** 제출-발효 조항은 원문에 4문서(FCX · CMG · FLT · VRSK) 있지만 대상 instrument 자신의
주 FILED 스탬프가 있는 문서가 **하나도 없다.** C가 0인 이유는 주 증명 발효일 자료가 문서 안에 없어서다.

범례 모양 하나는 A가 아니라 **새 의미 규칙**이다 — `As Amended Through <date>` · `Amended and Restated
as of <date>` · `As amended, <date>`는 `effective`를 말하지 않는다. 47문서 · 9 발행사이고 대부분 bylaws다.

### 주 FILED 스탬프 귀속 — `STATE_FILED_STAMP_PATTERNS` 일치 전수

```text
                                      Pool B   Pool C   연속성    합
SUBJECT_INSTRUMENT_STAMP                  0        0        0      0
HISTORICAL_INCORPORATION_RECITAL         27        8        4     39
PRIOR_INSTRUMENT_RECITAL                 20        6        4     30
OTHER_DOCUMENT_DATE                       0        0        0      0
AMBIGUOUS                                 0        0        0      0
합 (주 게이트 통과)                       47       14        8     69
```

10.35의 "9건 중 8건 recital"이 이 pool에서는 **69건 중 69건**이다. 그리고 조항은 있는데 스탬프가
recital뿐인 문서가 실재한다.

```text
FCX  [042]  "Upon the filing of this A&R Certificate with the Delaware Secretary of State (the "Effective Time")"
            스탬프 = 1987 설립 recital   -> 조항만 넓히면 2007 restatement가 1987-11-10으로 RESOLVED
CMG  [055]  서명란 "... effective as of the date of filing with the Secretary of State of the State of Delaware"
            스탬프 = 1998 설립 recital   -> 2016 A&R이 1998-01-30으로 RESOLVED
FLT  [073]  "effective upon the filing of this Certificate of Amendment with the Secretary of State of Delaware"
            스탬프 = 2010 · 2018 선행 instrument   -> AMBIGUOUS
VRSK [084]  "become effective upon the filing of this A&R Certificate with the Secretary of State ..."
            스탬프 없음   -> MISSING 유지
```

조항 확장만으로 올바른 날짜가 나오는 문서는 0이다. 스탬프 귀속을 설계하지 않았다.

### 놓친 어휘 계열 (A 25문서)

```text
family                              docs  발행사  실패한 자리              판정
TIME_BEFORE_DATE                      18     13   EFFECTIVE_DATE_PATTERNS  PARSER_RECALL_ONLY (귀속 노출 있음)
BARE_EFFECTIVE  "effective <date>"     6      5   EFFECTIVE_DATE_PATTERNS  ATTRIBUTION_PROBLEM
UPPERCASE_MONTH (주 게이트 밖)          3      2   공유 _iso_date            NEW_SEMANTIC_RULE_REQUIRED
ORDINAL_DAY  "13th day of February"     1      1   공유 _iso_date            singleton — 제안하지 않는다
TIME_AFTER_DATE                         1      1   EFFECTIVE_DATE_PATTERNS  singleton (BARE_EFFECTIVE와 겹침)
제출-발효 조항 변형 (A 아님)              4      4   UPON_FILING_PATTERNS     ATTRIBUTION_PROBLEM — 스탬프 귀속 선행
```

- **TIME_BEFORE_DATE** — `effective as of 5:00 p.m. Eastern time, on June 4, 2025`(TSCO [047]) ·
  `shall become effective at 8:11 a.m. (local time ...) on May 25, 2022`(VRSK [085]) · `The effective time
  of this ... Certificate ... is 9:03 a.m. on April 30, 2007`(DAL [001]). 문법은 `as of`/`on` 바로 뒤의
  날짜만 받고, `effective time ... is` 경로의 `[^.;]{0,60}`은 `a.m.`의 마침표에서 멈춘다. 주어가 그
  instrument인 문장만 보면 지역 정규식으로 충분해 보이지만, **같은 모양이 합본 안의 선행 amendment에도
  있다**(FAST [038]–[041] `amended, effective at the close of business on May 10, 2002` · DAL X009).
- **BARE_EFFECTIVE** — `effective June 3, 2022, at 4:01p.m., EDT`(GOOGL [111]) · `(Effective February 25,
  2019)`(NWS bylaws [103]) · `AS AMENDED EFFECTIVE MAY 21, 2012`(WEC [034]). 같은 모양이 선행 결의(FAST
  `effective August 6, 1987`) · 이사회 footnote(WEC X015 `Effective June 2, 1999, the Board`) · 주식 전환
  note(ANF `Effective May 19, 1998`)에도 있어 문법만 넓히면 다른 사건 날짜를 받는다.
- **UPPERCASE_MONTH** — Q bylaws [135] `EFFECTIVE AS OF NOVEMBER 1, 2025`는 문법이 맞았고 날짜 변환만
  실패했다. 대문자 월 정규화는 CLOSED 결정으로 **주 자료 게이트 안에만** 있다 — 그 범위를 넓히는 결정이다.

### 반사실 — CURRENT-O2-RECALL-ONLY

A 판정 문서의 원문 날짜만 그 문서의 `legal_operative_date`로 채웠다. D · E · F · 범례 · 조항-only는
채우지 않았다. anchor 정의와 B2 undated 관문은 10.36 · production 그대로이고, 관문을 넘는 item이 있으면
나머지 B2 사슬을 돌리게 했지만 **넘은 item이 0이다.**

```text
                                   CURRENT   COUNTERFACTUAL (CURRENT-O2-RECALL-ONLY)
dated-anchor work items                11        22   (+11 Pool B: AA · ASH · CI · DAL · GOOGL · HII · HLT · TSCO · VEEV · VRSK · WEC)
continuity-pass work items              0         0
```

```text
Pool B 새 dated anchor                         11
Pool C 무일자 차단이 사라진 work item            0   (41문서 중 날짜를 얻는 것은 6: NWS 4 · Q 2)
다른 무일자 문서 때문에 여전히 실패             22   (Pool C 11 + 새 anchor 11)
legal search INCOMPLETE로 여전히 실패          332
definition/association 없음으로 여전히 실패     120   (+ amendment-only 정의 11 · 표지 층 369)
hypothetical validity segment 도달               0
```

anchor를 가진 22 item에 남는 무일자 governing 문서는 고유 133건이다.

```text
BYLAWS   84   범례(effective 없음) 45 · 날짜 없음 37 · D 1 · F 1
그 외    49   D 37 (그중 bylaws 본문이 ARTICLES_OF_AMENDMENT로 분류된 2) · E 12
잔여 차단이 전부 BYLAWS인 item   1   ASH (bylaws 5)
```

### 결정표 — exact cover association 528 work items

```text
CAUSE                                           WORK ITEMS
----------------------------------------------------------
SEARCH_INCOMPLETE_NON_O2                         332   INCOMPLETE 277 + legal search 미실행 55
SOURCE_DOES_NOT_STATE_SUPPORTED_DATE              51   Pool B 40 + Pool C 11
CURRENT_O2_PARSER_RECALL_GAP                      11   Pool B (anchor 층)
STATE_STAMP_ATTRIBUTION_HAZARD                     2   Pool B FCX · CMG
AMBIGUOUS_DATE                                     1   Pool B FDXF (EXPLICIT 귀속)
OTHER                                            131   governing definition 없음 120 + amendment-only 정의 11
                                                 528   (표지 층 369는 이 표 밖이다)
```

item 배정은 Pool B에서 A snapshot 정의 문서 -> F -> 조항+recital 스탬프 -> amendment-only -> 나머지
순서이고, Pool C는 반사실 뒤에도 남는 차단 문서의 판정(11/11 D·E)으로 정했다.

```text
CURRENT_O2_RECALL_FIX PAYOFF
- new dated anchors: 11
- continuity blockers removed: 0 work items (Pool C 문서 6/41 · 연속성 문서 6/94)
- work items reaching hypothetical validity segment: 0
```

### 답

1. **O2 parser recall이 material blocker인가 — anchor 층에서만이다.** Pool B 65 중 11이 현행 O2 의미의
   날짜를 원문에 갖고 있는데 문법이 놓쳤다(주로 시각 삽입, 18문서 · 13 발행사). 그러나 반사실로 anchor가
   11 -> 22가 되어도 continuity-pass는 **0 -> 0**이다.
2. **원문 부재가 지배적이다.** 판정 231문서 중 A 25 · F 2 · D 94 · E 110이고, 반사실 뒤에도 22 item 전부가
   자기 날짜를 말하지 않는 governing 문서(고유 133)에서 막힌다.
3. **스탬프 귀속은 UPON_FILING 확장의 선행 조건이다.** 주 게이트 통과 스탬프 69건 중 대상 instrument의
   스탬프는 0이고, 조항이 있는 4문서 중 조항만 넓혀 올바른 날짜가 나오는 것은 0이다(설립일 RESOLVED 2 ·
   AMBIGUOUS 1 · MISSING 1). **EXPLICIT 문법도 이미 귀속 문제가 있다**(현행 anchor 8 중 2 · FDXF).
4. **parser-only fix는 Option A 커버리지를 바꾸지 않는다** — 0 -> 0.
5. **다음에 다시 열어야 할 CLOSED 계약은 B2 undated fail-close의 범위다.** 현행 관문은 TYPE이 Exhibit
   3이면 분류와 무관하게 전부 유일한 법적 발효일을 요구한다. 잔여 133건 중 84건이 BYLAWS이고, 나머지
   49건도 자기 날짜를 말하지 않는다 — parser를 어떻게 넓혀도 이 population은 "모든 EX-3가 날짜를 가져야
   순서를 세운다"를 충족하지 못한다. 그 논의에는 발효일 귀속(EXPLICIT · 스탬프)이 함께 따라온다.
   **이 census는 어느 계약도 다시 열지 않는다.**

### 범위

```text
production code changed          NO
O2 / O2-C changed                NO
B1 / B2 / P2 / N1 changed        NO
birth contract changed           NO
Option A implemented             NO
bundle schema changed            NO
qv-class-id changed              NO
manifest changed                 NO
full 897 SEC rerun               NO   (bounded exact refetch 238회 · 알려진 자연키만)
promotion                        NO
5A-3                             NO
Gate A-H                         NO
returns / rankings / portfolio   NO
```

받은 SEC 본문과 분석 스크립트는 스크래치에 두고 커밋하지 않는다.

## 10.37-A 행 단위 감사 — Pool B/C 137문서

`O2 matches`는 production 문법의 일치 수다 — `ex` EFFECTIVE_DATE · `ce` STATE_CERTIFIED(주 게이트) ·
`up` UPON_FILING · `st` STATE_FILED_STAMP(주 게이트) · `x` O2-C 교차 조항. `stored`는 전수 실행 기록값이고
재실행 값과 137/137 같다. SHA-256은 받은 바이트의 해시이고 5A-2 `document_sha256`과 전부 일치한다.
source URL은 `(CIK, accession, locator)`에서 결정론적으로 나온다. `cf date`는 반사실에서 채운 날짜다.
판정 주체는 전부 MODEL_ASSISTED_SOURCE_TEXT_JUDGMENT다.

| # | pool | work item(s) | CIK | accession | locator | TYPE | classification | stored | SHA-256 | O2 matches | B2 role | judgment | evidence | cf date |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 000 | B | BIO | 0000012208 | 0000012208-11-000016 | exhibit31.htm | EX-3 | RESTATED_CERTIFICATE | MISSING | 5fd81f2fd4d345dff89c02d186b145dbb3d31292af7059fc441026d7380757e8 | ex0 ce0 up0 st2 x0 | undated snapshot def (anchor candidate) | **D** INC+PRIOR | recitals: original cert filed 1975; restated cert filed 1989 |  |
| 001 | B | DAL | 0000027904 | 0001019687-09-001566 | delta_8k-ex0301.htm | EX-3.1 | AMENDED_AND_RESTATED_CERTIFICATE | MISSING | b52d186f8826501907ad6a0baf3e131a15dccb634cb85d8ada0317237cf9a51f | ex0 ce0 up0 st1 x0 | undated snapshot def (anchor candidate) | **A** TIME_BEFORE_DATE | "The effective time of this A&R Certificate ... is 9:03 a.m. on April 30, 2007" | 2007-04-30 |
| 002 | B | DAL | 0000027904 | 0001188112-07-001266 | ex3-1.htm | EX-3.1 | AMENDED_AND_RESTATED_CERTIFICATE | MISSING | 906ebaf26df47fb62a37c73bc9764d9462646f44d10d45f8b6dc2631fdf73f4b | ex0 ce0 up0 st1 x0 | undated snapshot def (anchor candidate) | **A** TIME_BEFORE_DATE | same sentence (2007 original exhibit) | 2007-04-30 |
| 003 | B | EFX | 0000033185 | 0001104659-09-032557 | a09-13450_1ex3d1.htm | EX-3.1 | AMENDED_AND_RESTATED_ARTICLES | MISSING | 5a29054280bfc28abe8231be18b4022741f78da4f92bb612e494540f55c874ab | ex0 ce0 up0 st0 x0 | undated snapshot def (anchor candidate) | **E** | no dated effectiveness/filing statement |  |
| 004 | B | NBL | 0000072207 | 0000072207-16-000092 | ex33restatedcertificationo.htm | EX-3.3 | RESTATED_CERTIFICATE | MISSING | cc970ee8fb7a97aeabcd8ce7e2b1c9ff37ed7ed6aa74401d4ae6e85c297cc840 | ex0 ce0 up0 st1 x0 | undated snapshot def (anchor candidate) | **D** INC+PRIOR | recitals: original cert filed 1969; amendment filed 2002 |  |
| 005 | C | WST | 0000105770 | 0000105770-04-000199 | exh3b.htm | EX-3.(I) | BYLAWS | MISSING | b50330e122e68f3a10e823a7473b1e3f7f41ee571b4a5f5614e18a49d71d4374 | ex0 ce0 up0 st0 x0 | undated continuity blocker | **E** LEGEND_NO_EFFECTIVE | bylaws "As Amended Through March 6, 2004" |  |
| 006 | C | WST | 0000105770 | 0000105770-07-000368 | exh31.htm | EX-3 | AMENDED_AND_RESTATED_ARTICLES | MISSING | 54a423797a097393d6a3b507b0c2e54085516ef6028024224195d96b22e40ad8 | ex0 ce0 up0 st0 x0 | undated continuity blocker | **E** | only Rule 12b-2 "as in effect on" reference dates |  |
| 007 | C | WST | 0000105770 | 0000105770-07-000368 | exh32.htm | EX-3 | BYLAWS | MISSING | 15d35891e4c1581aafb35702aeacc28fa732641b6dae1c2fe0c76bd55ab9b636 | ex0 ce0 up0 st0 x0 | undated continuity blocker | **E** LEGEND_NO_EFFECTIVE | bylaws "As Amended Through December 11, 2007" |  |
| 008 | C | WST | 0000105770 | 0000105770-08-000056 | exh3-2.htm | EX-3 | BYLAWS | MISSING | f8a9ad60e4fa6777ba6d5bed87b9ac0bc890685fd262ac804d452f0c338ef21d | ex0 ce0 up0 st0 x0 | undated continuity blocker | **E** LEGEND_NO_EFFECTIVE | bylaws "As Amended Through October 14, 2008" |  |
| 009 | C | WST | 0000105770 | 0000105770-11-000025 | exh31.htm | EX-3.1 | CERTIFICATE_OF_AMENDMENT | MISSING | 4b1e544c193e67909f26c6a62b584f1800521fe6541387789827222402163cf4 | ex0 ce0 up0 st1 x0 | undated continuity blocker | **D** PRIOR+FILING_NOTATION | recital A&R articles filed 2007; footer "Filed with the Commonwealth of Pennsylvania on May 5, 2011" (no clause, outside authority vocab) |  |
| 010 | C | WST | 0000105770 | 0000105770-13-000045 | exh31certificateofamendmen.htm | EX-3.1 | CERTIFICATE_OF_AMENDMENT | MISSING | 1b797b6602707b5fdcdf1983bf82fafbef5ced4dd311ed3d7be1d049dd892f7a | ex0 ce0 up0 st1 x0 | undated continuity blocker | **D** PRIOR+FILING_NOTATION | recital A&R articles filed 2007; footer "Filed with the Commonwealth of Pennsylvania on August 23, 2013" |  |
| 011 | C | WST | 0000105770 | 0000105770-14-000065 | ex31amendedandrestatedarti.htm | EX-3.1 | AMENDED_AND_RESTATED_ARTICLES | MISSING | 0426882eec6548a92856e74fbb3818aa99f4407def0f3370da0b66585c312fe6 | ex0 ce0 up0 st0 x0 | undated continuity blocker | **E** | only Rule 12b-2 reference dates |  |
| 012 | C | WST | 0000105770 | 0000105770-15-000015 | ex31amendedarticles.htm | EX-3.1 | AMENDED_AND_RESTATED_ARTICLES | MISSING | e32210d672eac05f38ac1c82a838f305224327a0a141539fdcd04745b3e8274f | ex0 ce0 up0 st0 x0 | undated continuity blocker | **E** | only Rule 12b-2 reference dates |  |
| 013 | C | WST | 0000105770 | 0000105770-15-000015 | ex32bylaws.htm | EX-3.2 | BYLAWS | MISSING | e3742d3d174127b1b192e2579abb5e30427af6a5a7d94efbaa0af09296a1f577 | ex0 ce0 up0 st0 x0 | undated continuity blocker | **E** LEGEND_NO_EFFECTIVE | bylaws "As Amended through May 5, 2015" |  |
| 014 | C | WST | 0000105770 | 0000105770-21-000014 | wpsbylawamendmentsfinalfeb.htm | EX-3.2 | BYLAWS | MISSING | 117ca7bcc900a30f546e221ac50119f4887677e0385437d7df59ac019d9345e5 | ex0 ce0 up0 st0 x0 | undated continuity blocker | **E** LEGEND_NO_EFFECTIVE | bylaws "As Amended through February 23, 2021" |  |
| 015 | C | WST | 0000105770 | 0000105770-23-000068 | amendedrestatedbylawsoct20.htm | EX-3.2 | BYLAWS | MISSING | 045926567804cde1e463ccf8c5e54690c9dfb46c43793de72a158f6fffb7f9ea | ex0 ce0 up0 st0 x0 | undated continuity blocker | **E** LEGEND_NO_EFFECTIVE | bylaws "As Amended through October 23, 2023" |  |
| 016 | C | WST | 0000105770 | 0000105770-98-000033 | seq:2 | EX-3 | AMENDED_AND_RESTATED_ARTICLES | MISSING | 4b3316bc3ad698e254a12686cc235318fa7d6680cc16bfc7aa225e94e6e81017 | ex0 ce0 up0 st0 x0 | undated continuity blocker | **E** | legacy 1-block text; rights-plan/Rule 12b-2 dates only |  |
| 017 | C | WST | 0000105770 | 0000105770-98-000033 | seq:3 | EX-3 | BYLAWS | MISSING | 93cfaa97a7a00f368824e47469f9bbbf4812ab3bc54cc20318c0c82b8300c2a5 | ex0 ce0 up0 st0 x0 | undated continuity blocker | **E** LEGEND_NO_EFFECTIVE | bylaws "As Amended Through October 27, 1998" |  |
| 018 | C | WST | 0000105770 | 0000105770-99-000016 | seq:2 | EX-3 | AMENDED_AND_RESTATED_ARTICLES | MISSING | b68caa6fb39a1b7c1d05284ffcfe0bf114afd9c289bcfb727fe2989243c7315c | ex0 ce0 up0 st0 x0 | undated continuity blocker | **E** | legacy 1-block text; rights-plan/Rule 12b-2 dates only |  |
| 019 | C | WST | 0000105770 | 0000950115-95-000063 | seq:2 | EX-3.B | BYLAWS | MISSING | 5e70ce73b378e5ee89787054e87df0be512a59b24d04e154c0900daf3c175ed5 | ex0 ce0 up0 st0 x0 | undated continuity blocker | **E** LEGEND_NO_EFFECTIVE | bylaws "As Amended and Restated December 13, 1994" |  |
| 020 | B | TXT | 0000217346 | 0000217346-10-000048 | threeone.htm | EX-3.1 | RESTATED_CERTIFICATE | MISSING | ceba85addae5fa517bebff2acefe3e823d59fdb74053e3825ff65ebe4a54a8ea | ex0 ce0 up0 st2 x0 | undated snapshot def (anchor candidate) | **D** INC+PRIOR | recitals: original cert filed 1967; restated cert filed 1998 |  |
| 021 | B | KLAC | 0000319201 | 0000319201-19-000031 | exhibit31restatedcertifica.htm | EX-3.1 | RESTATED_CERTIFICATE | MISSING | b2399613270470bc9294bed6f1929e5da7952bc06a0f5fda3c6b645b8e8a2261 | ex0 ce0 up0 st0 x0 | undated snapshot def (anchor candidate) | **D** INC | "date of filing its original Certificate ... was July 9, 1975" |  |
| 022 | B | KLAC | 0000319201 | 0001193125-26-269375 | d144278dex32.htm | EX-3.2 | RESTATED_CERTIFICATE | MISSING | 5cd8f6137f144c07f9e2afb8fead1f84bc0bc38249dd2a545c0450cd65984a1b | ex0 ce0 up0 st0 x0 | undated snapshot def (anchor candidate) | **D** INC | same recital |  |
| 023 | B | LNT | 0000352541 | 0000107832-02-000073 | sept10q2002exh3pt1.txt | EX-3 | AMENDED_AND_RESTATED_ARTICLES | MISSING | 15d6ca2c9f303554830aafeb437c82966f583ec90440638bb36041fa1ee5f536 | ex0 ce0 up0 st0 x0 | undated snapshot def (anchor candidate) | **E** | no dates |  |
| 024 | B | LNT | 0000352541 | 0000107832-04-000096 | form10k123103exh3pt5.htm | EX-3 | RESTATED_ARTICLES | MISSING | c5ba4455e9b279dbd7ffde347390544cadbe61234fb7ec53f62191c78e92ce5a | ex0 ce0 up0 st0 x0 | undated snapshot def (anchor candidate) | **E** | preferred redemption/dividend dates only |  |
| 025 | B | LNT | 0000352541 | 0000352541-21-000103 | lnt121720218-kex31.htm | EX-3.1 | RESTATED_ARTICLES | MISSING | a76fbbb7aa8b79d9bdbe19a20977ac87c9a6ef3324d12066710162a14dd9c026 | ex0 ce0 up0 st0 x0 | undated snapshot def (anchor candidate) | **E** | no dates |  |
| 026 | B | LNT | 0000352541 | 0001193125-13-216734 | d535964dex32.htm | EX-3.2 | RESTATED_ARTICLES | MISSING | 65981f8ef79e6eb8738f5325d7399c6d3723d13042cc24c08bc694259d7a4570 | ex0 ce0 up0 st0 x0 | undated snapshot def (anchor candidate) | **E** | preferred redemption/dividend dates only |  |
| 027 | B | LNT | 0000352541 | 0001193125-13-216734 | d535964dex34.htm | EX-3.4 | AMENDED_AND_RESTATED_ARTICLES | MISSING | cf791fdb350999d82fe6edc815f79aa50147cd9aef73cca8206f7fb74e9c5870 | ex0 ce0 up0 st0 x0 | undated snapshot def (anchor candidate) | **E** | no dates |  |
| 028 | B | COO | 0000711404 | 0001193125-06-006352 | dex31.htm | EX-3.1 | RESTATED_CERTIFICATE | MISSING | 8511a892a9d0033dbf59cdce30e464c6ce3164099c9183e0235d7ac33e67c0d8 | ex0 ce0 up0 st0 x0 | undated snapshot def (anchor candidate) | **D** PRIOR | recital: certificate of designation filed 1997 |  |
| 029 | B | EXPD | 0000746515 | 0000746515-18-000004 | a201710-kex31.htm | EX-3.1 | RESTATED_ARTICLES | MISSING | 58c313b68b7f39fd8d3f785f5385147b1a59c064713b92d559cde9d746a53c49 | ex0 ce0 up0 st0 x0 | undated snapshot def (anchor candidate) | **D** COMPONENT+SIGNATURE | compiled articles of amendment: adoption dates, "DATED:" and 1987 execution |  |
| 030 | B | UIS | 0000746838 | 0001104659-25-048477 | tm2514710d1_ex3-1.htm | EX-3.1 | AMENDED_AND_RESTATED_CERTIFICATE | MISSING | 4c83b84135441d3b3a2ea9636c4ce96ab88d8c0a8b61ba89aff0e418f7398379 | ex0 ce0 up0 st0 x0 | undated snapshot def (anchor candidate) | **E** | only Rule 12b-2 reference date |  |
| 031 | B | UIS | 0000746838 | 0001104659-25-116956 | tm2532123d1_ex3-1.htm | EX-3.1 | AMENDED_AND_RESTATED_CERTIFICATE | MISSING | 0f29b923bcb5cbf9a54f245f7333f51d7cab4a7ffccec1ba8e169531961e181a | ex0 ce0 up0 st0 x0 | undated snapshot def (anchor candidate) | **D** INC+PRIOR | recitals: original cert 1984; A&R cert filed May 9, 2025 (this is a correction) |  |
| 032 | B | IT | 0000749251 | 0000950123-00-011900 | y43399ex3-1_a.txt | EX-3.1.A | AMENDED_AND_RESTATED_CERTIFICATE | MISSING | 5ac02811264386e8a3f0f41d828c7133d62972f312831943ba4f23156dca8e93 | ex0 ce0 up0 st0 x0 | undated snapshot def (anchor candidate) | **D** INC+SIGNATURE | "originally incorporated on June 1, 1990"; "executed this certificate on July 16, 1999" |  |
| 033 | B | IT | 0000749251 | 0000950123-05-008192 | y10586exv3w1.htm | EX-3.1 | RESTATED_CERTIFICATE | MISSING | 3cdca96c57b9127e0c128fe967fbb29a01c024215f52494116798fd2d975bbd7 | ex0 ce0 up0 st0 x0 | undated snapshot def (anchor candidate) | **D** INC+SIGNATURE | "originally incorporated on June 1, 1990"; executed July 5, 2005 |  |
| 034 | B | WEC | 0000783325 | 0000107815-12-000108 | wec06302012ex31.htm | EX-3.1 | RESTATED_ARTICLES | MISSING | 71440e7eefd4d518d3faaa6d9db20f89a0b2ed124260cf2fee28e9c6b2ae4a95 | ex0 ce0 up0 st0 x0 | undated snapshot def (anchor candidate) | **A** BARE_EFFECTIVE+UPPERCASE+LEGEND | title legend "AS AMENDED EFFECTIVE MAY 21, 2012" | 2012-05-21 |
| 035 | B | WEC | 0000783325 | 0000107815-95-000020 | seq:2 | EX-3.1 | RESTATED_ARTICLES | MISSING | 84af5bab65f78be3a289b7da03ae565105d6d1aceae8cc04e9454c52b6e986e8 | ex0 ce0 up0 st0 x0 | undated snapshot def (anchor candidate) | **A** BARE_EFFECTIVE+UPPERCASE+LEGEND | title legend "AS AMENDED AND RESTATED EFFECTIVE JUNE 12, 1995" | 1995-06-12 |
| 036 | B | OI | 0000812074 | 0001047469-13-000991 | a2212782zex-3_1.htm | EX-3.1 | RESTATED_CERTIFICATE | MISSING | 1688c8817c89927db97e3e7cd7ab68853ba2aae9bc768cbdb222e36dca109fd9 | ex0 ce0 up0 st0 x0 | undated snapshot def (anchor candidate) | **D** INC | "date of filing of its original Certificate ... was November 27, 1985" |  |
| 037 | B | OI | 0000812074 | 0001104659-09-030006 | a09-9069_1ex3d1.htm | EX-3.1 | RESTATED_CERTIFICATE | MISSING | 56283b857d16333d9d87ea458364a8ca644250650a4fcafd1ff2cd69a882207c | ex0 ce0 up0 st0 x0 | undated snapshot def (anchor candidate) | **D** INC | same recital |  |
| 038 | B | FAST | 0000815556 | 0000815556-19-000032 | ex_314232019amendedarticle.htm | EX-3.1 | RESTATED_ARTICLES | MISSING | 44c148dcaf27d71f4cc5853428524ec5e464eb572bb319a011b520ebc557bacf | ex0 ce0 up0 st0 x0 | undated snapshot def (anchor candidate) | **D** COMPONENT | compiled component certificates "amended, effective at the close of business on May 10, 2002 / Nov 10, 2005 / May 20, 2011 / May 22, 2019" |  |
| 039 | B | FAST | 0000815556 | 0001193125-05-206786 | dex31.htm | EX-3.1 | RESTATED_ARTICLES | MISSING | 8106ba9cf3e40794947aad402a3f378183dbe588c42379a24f36f313a1f5f9ee | ex0 ce0 up0 st0 x0 | undated snapshot def (anchor candidate) | **D** COMPONENT | same compilation (2002, 2005) |  |
| 040 | B | FAST | 0000815556 | 0001193125-11-104739 | dex31.htm | EX-3.1 | RESTATED_ARTICLES | MISSING | 2c91284e268763e7d03acaf91fccaec6810948841a21be2eb4f2bd0a29dff26a | ex0 ce0 up0 st0 x0 | undated snapshot def (anchor candidate) | **D** COMPONENT | same compilation (2002, 2005, 2011) |  |
| 041 | B | FAST | 0000815556 | 0001193125-12-172121 | d310097dex31.htm | EX-3.1 | RESTATED_ARTICLES | MISSING | 0c5ef90e3aeda8307039e5ab08d575c8c103da1b45be03f4fbafeffcd1a8be89 | ex0 ce0 up0 st0 x0 | undated snapshot def (anchor candidate) | **D** COMPONENT | same compilation (2002, 2005, 2011) |  |
| 042 | B | FCX | 0000831259 | 0000950103-07-000681 | dp05057e_ex0301.htm | EX-3.1 | AMENDED_AND_RESTATED_CERTIFICATE | MISSING | bbf032104ff5ba9bdaa1d4b1d0fefe2d5e79b3834b4ae832d0e916b083fc233a | ex0 ce0 up0 st1 x0 | undated snapshot def (anchor candidate) | **D** INC+CLAUSE_NO_SUBJECT_STAMP | "Upon the filing of this A&R Certificate with the Delaware Secretary of State (the Effective Time)"; only stamp = 1987 incorporation recital |  |
| 043 | B | IEX | 0000832101 | 0000832101-18-000019 | iex-12312017xex31.htm | EX-3.1 | RESTATED_CERTIFICATE | MISSING | bec6bc10fc2558a4432dc81aef9a69adb887659bff7e237b1099de2dfd8a3cb7 | ex0 ce0 up0 st0 x0 | undated snapshot def (anchor candidate) | **D** INC | "date of filing of its original Certificate ... was September 24, 1987" |  |
| 044 | B | CTXS | 0000877890 | 0001193125-13-239426 | d544715dex31.htm | EX-3.1 | RESTATED_CERTIFICATE | MISSING | 66fa616a81f1d171949b7e115e9aaebe95bcfe243a5c469ffb828d7f971a6089 | ex0 ce0 up0 st1 x0 | undated snapshot def (anchor candidate) | **D** INC | recital: original cert filed 1989 |  |
| 045 | B | TSCO | 0000916365 | 0000916365-12-000017 | exhibit3_5.htm | EX-3.1 | RESTATED_CERTIFICATE | MISSING | 79eefa85cc22ca66f5ffa883a2b0d8dd3b69baa6e4099687746b59937aee64cf | ex0 ce0 up0 st1 x0 | undated snapshot def (anchor candidate) | **D** INC | recital: original cert filed 1982 |  |
| 046 | B | TSCO | 0000916365 | 0000916365-20-000184 | restatedcertificateofi.htm | EX-3.1 | RESTATED_CERTIFICATE | MISSING | 4a8390b5a5c816d79d09d554a584a3f5b5c2c0e278b6d5f572bbb8d3e8e36c95 | ex0 ce0 up0 st1 x0 | undated snapshot def (anchor candidate) | **D** INC | recital: original cert filed 1982 |  |
| 047 | B | TSCO | 0000916365 | 0000916365-25-000150 | tscorestatedcertificateofi.htm | EX-3.1 | AMENDED_AND_RESTATED_CERTIFICATE | MISSING | 03ecbff52921749b74383e918edc58ccda1f44888d1b190acc41eca98e535360 | ex0 ce0 up0 st1 x0 | undated snapshot def (anchor candidate) | **A** TIME_BEFORE_DATE | "Effective as of 5:00 p.m. Eastern time, on June 4, 2025, the text ... shall read" | 2025-06-04 |
| 048 | B | DVA | 0000927066 | 0001193125-07-172119 | dex31.htm | EX-3.1 | AMENDED_AND_RESTATED_CERTIFICATE | MISSING | 0cb87ddc935355d6e2f1ac5235200cf51424bd26da99b441d1cb00575840ed57 | ex0 ce0 up0 st0 x0 | undated snapshot def (anchor candidate) | **D** MEETING+SIGNATURE+CLASSIFICATION_HAZARD | body is a Certificate of Amendment (meeting May 29, 2007; signed May 30, 2007); classified from SEC description header |  |
| 049 | B | HSIC | 0001000228 | 0000950123-05-009366 | y11335exv3w1.htm | EX-3.1 | AMENDED_AND_RESTATED_CERTIFICATE | MISSING | 9b20d1f3bd615f217803e30051982f20339fe502e7f6ed939a066ce42cd6af22 | ex0 ce0 up0 st0 x0 | undated snapshot def (anchor candidate) | **D** INC | recital: original cert filed 1992 |  |
| 050 | B | HSIC | 0001000228 | 0000950123-07-002886 | y30969exv3w1.htm | EX-3.1 | AMENDED_AND_RESTATED_CERTIFICATE | MISSING | 3aac84263c8efc1ba4fcab1dfe418d606d9a8b096c08e0468ec72c37686233ca | ex0 ce0 up0 st0 x0 | undated snapshot def (anchor candidate) | **D** INC | recital: original cert filed 1992 |  |
| 051 | B | HSIC | 0001000228 | 0001193125-18-181713 | d586703dex31.htm | EX-3.1 | AMENDED_AND_RESTATED_CERTIFICATE | MISSING | b2fb56b4da20be75c422f73d48a1867a83e987bb2719c44cfbbc47c78e1c7e8f | ex0 ce0 up0 st0 x0 | undated snapshot def (anchor candidate) | **D** INC | recital: original cert filed 1992 |  |
| 052 | B | ANF | 0001018840 | 0000950123-11-082951 | c20376exv3w2.htm | EX-3.2 | AMENDED_AND_RESTATED_CERTIFICATE | MISSING | f5dd975a649d5a231b88c04d73da93643db8130eee416fe62b61970ab6ab5c40 | ex0 ce0 up0 st3 x0 | undated snapshot def (anchor candidate) | **D** PRIOR+COMPONENT | conformed notes: cert of designation filed 1998; amendments filed June 16, 2011; share conversions "Effective May 19, 1998" |  |
| 053 | B | MTD | 0001037646 | 0000895345-98-000141 | seq:2 | EX-3.1 | AMENDED_AND_RESTATED_CERTIFICATE | MISSING | 564772e6d66b9bc123acea071f2b957638b03a93da04806150b971eed73b7793 | ex0 ce0 up0 st0 x0 | undated snapshot def (anchor candidate) | **E** | legacy 1-block text; no dates |  |
| 054 | B | CHRW | 0001043277 | 0001193125-12-233730 | d353095dex31.htm | EX-3.1 | RESTATED_CERTIFICATE | MISSING | 4d855e272657624d8f9d4f9143da6bca37d2614142a32abbc66385a910600afd | ex0 ce0 up0 st1 x0 | undated snapshot def (anchor candidate) | **D** INC | recital: original cert filed 1997 |  |
| 055 | B | CMG | 0001058090 | 0001058090-16-000088 | cmg-20160930xex3_1.htm | EX-3.1 | AMENDED_AND_RESTATED_CERTIFICATE | MISSING | 13a1b285bc977c68e68e8c934224c9fc960992f040a9c81ca36695f15c6e20b8 | ex0 ce0 up0 st1 x0 | undated snapshot def (anchor candidate) | **D** INC+CLAUSE_NO_SUBJECT_STAMP | signature block "effective as of the date of filing with the Secretary of State"; only stamp = 1998 incorporation recital |  |
| 056 | B | NFLX | 0001065280 | 0001065280-15-000031 | restatedcertificateofincor.htm | EX-3.1 | RESTATED_CERTIFICATE | MISSING | 6747825cf3c7d0e995b8d3c9cbe104fab5f72f524569991d5660be4ff11f2843 | ex0 ce0 up0 st0 x0 | undated snapshot def (anchor candidate) | **E** | no dates |  |
| 057 | B | NFLX | 0001065280 | 0001065280-22-000216 | ex-31amendedandrestatedcer.htm | EX-3.1 | AMENDED_AND_RESTATED_CERTIFICATE | MISSING | 4ae01c3f6d071e0a51ccd41b564e92b55ab6bcc881ed3cca03538e17c868ebbe | ex0 ce0 up0 st4 x0 | undated snapshot def (anchor candidate) | **D** PRIOR | recitals: A&R filed 2002; amendments filed 2003/2004/2015 |  |
| 058 | B | NFLX | 0001065280 | 0001193125-04-128377 | dex31.htm | EX-3.1 | AMENDED_AND_RESTATED_CERTIFICATE | MISSING | 89c091808c199b69f0e18fa3848862e21a8f3ba9cab6a8f49dcbd8cdb45fdeb3 | ex0 ce0 up0 st0 x0 | undated snapshot def (anchor candidate) | **D** INC+SIGNATURE | "originally incorporated on August 29, 1997"; executed May 29, 2002 |  |
| 059 | B | ON | 0001097864 | 0001193125-06-155889 | dex31a.htm | EX-3.1(A) | AMENDED_AND_RESTATED_CERTIFICATE | MISSING | 8530bdbb56c31094ba4550c252be28a45ee55a15de55eea92d17a498560de4cd | ex0 ce0 up0 st1 x0 | undated snapshot def (anchor candidate) | **D** INC+PRIOR | compilation: original 1992; A&R 2000; designations filed 2001 |  |
| 060 | B | ON | 0001097864 | 0001193125-08-104433 | dex31.htm | EX-3.1 | AMENDED_AND_RESTATED_CERTIFICATE | MISSING | f62995e2e5b0ad5439ed373d7bf6d6e95e17c426630fca881b4bb113c91ed205 | ex0 ce0 up0 st1 x0 | undated snapshot def (anchor candidate) | **D** INC+PRIOR | same compilation |  |
| 061 | B | AYI | 0001144215 | 0001144215-24-000015 | ayi-20240124xex32xrestated.htm | EX-3.2 | RESTATED_CERTIFICATE | MISSING | 451356f9adef0b99ebf44fa84c137e9b23bea776e39233b6e83999bb065d3089 | ex0 ce0 up0 st0 x0 | undated snapshot def (anchor candidate) | **D** INC | recital: original cert 2007 |  |
| 062 | B | AYI | 0001144215 | 0001193125-07-208062 | dex31.htm | EX-3.1 | RESTATED_CERTIFICATE | MISSING | 0ae5e6a4875b8535cf9de20f2855e13d53e90d523988c91a09462eb3f5ff6429 | ex0 ce0 up0 st0 x0 | undated snapshot def (anchor candidate) | **D** INC | recital: original cert 2007 |  |
| 063 | B | AAP | 0001158449 | 0001158449-04-000083 | exhibit_3-1.htm | EX-3 | RESTATED_CERTIFICATE | MISSING | 0faacb2b5966cdeed9e9d0756faf133d4768f8ddfa605701ad231f4c1c05d471 | ex0 ce0 up0 st1 x0 | undated snapshot def (anchor candidate) | **D** PRIOR | "as amended and restated in the Certificate of Amendment filed August 8, 2001" |  |
| 064 | B | AAP | 0001158449 | 0001158449-13-000226 | aap_exhibit31x7132013.htm | EX-3.1 | RESTATED_CERTIFICATE | MISSING | d96291cdef83f2262a466813d0ace6973400d226105e33f272068a9bdd403fb5 | ex0 ce0 up0 st2 x0 | undated snapshot def (anchor candidate) | **D** INC+PRIOR | recitals: Aug 1 2001 original; Aug 8 2001 amendment; 2001/2004 filings |  |
| 065 | C | CPAY,FLT | 0001175454 | 0001175454-19-000020 | ex3120190614certificateofa.htm | EX-3.1 | CERTIFICATE_OF_AMENDMENT | MISSING | d7fc116ea24e911b9bb29e5ba6d5ebd89878ab3b904d5b347fb4ed45c7050633 | ex0 ce0 up0 st2 x0 | undated continuity blocker | **D** INC+PRIOR | recitals: cert filed 1998; amendments filed 2010/2018 |  |
| 066 | C | CPAY,FLT | 0001175454 | 0001175454-20-000040 | a20201018bylawsoctober.htm | EX-3.1 | BYLAWS | MISSING | bb1428e77fd60868d8606e31beac7dfdb38eb9765a06787b2a4b17dfea48adab | ex0 ce0 up0 st0 x0 | undated continuity blocker | **E** | bylaws; resignation-effectiveness language only |  |
| 067 | C | CPAY,FLT | 0001175454 | 0001193125-11-078175 | dex31.htm | EX-3.1 | AMENDED_AND_RESTATED_CERTIFICATE | MISSING | 0e71e5c132608907bbd13e67fa2035196469b81abbe52132c856fdae247656e0 | ex0 ce0 up0 st0 x0 | undated continuity blocker | **D** INC | "(Originally Incorporated on February 3, 1998)" |  |
| 068 | C | CPAY,FLT | 0001175454 | 0001193125-11-078175 | dex32.htm | EX-3.2 | BYLAWS | MISSING | dfcededfbe893773289f8b2b1f90224d3bbd6448ca4de1dedd5a7782173c5fbd | ex0 ce0 up0 st0 x0 | undated continuity blocker | **E** | bylaws; resignation-effectiveness language only |  |
| 069 | C | CPAY,FLT | 0001175454 | 0001299933-16-003120 | exhibit1.htm | EX-3.01 | BYLAWS | MISSING | 5f8d8916545a1a62fee28f56a5d76d68f6a6e3c6a301b392de4244ae23a96bfd | ex0 ce0 up0 st0 x0 | undated continuity blocker | **E** | bylaws; no dates |  |
| 070 | C | CPAY,FLT | 0001175454 | 0001299933-18-000095 | exhibit1.htm | EX-3.1 | BYLAWS | MISSING | f15401fef9fe6a2b067a402614ca72c557b1219075218f533c937d49da3a6822 | ex0 ce0 up0 st0 x0 | undated continuity blocker | **E** | bylaws; no dates |  |
| 071 | C | CPAY,FLT | 0001175454 | 0001299933-18-000489 | exhibit1.htm | EX-3.1 | CERTIFICATE_OF_AMENDMENT | MISSING | 1fea7ca90b99a1413bb8434d9405972697496714ac8c59ef29eac57f0444d359 | ex0 ce0 up0 st2 x0 | undated continuity blocker | **D** INC+PRIOR | recitals: cert filed 1998; amendment filed 2010 |  |
| 072 | C | CPAY,FLT | 0001175454 | 0001628280-22-017144 | flt-bylaws2022bdmeeting.htm | EX-3.2 | AMENDED_AND_RESTATED_CERTIFICATE | MISSING | a63df45dd5c0229f5f9da305bf01f9b26aefb8d6d2201303c9d3ea54889af0c1 | ex0 ce0 up0 st0 x0 | undated continuity blocker | **E** CLASSIFICATION_HAZARD | bylaws text classified AMENDED_AND_RESTATED_CERTIFICATE; no dates |  |
| 073 | C | CPAY,FLT | 0001175454 | 0001628280-22-017144 | flt-charteramendmentxjune9.htm | EX-3.1 | CERTIFICATE_OF_AMENDMENT | MISSING | 09af4f06d27ab36f17080007179261c990dba5bd94ae2e8b3bb3c39c167e0bd9 | ex0 ce0 up0 st2 x0 | undated continuity blocker | **D** PRIOR+CLAUSE_NO_SUBJECT_STAMP | "effective upon the filing of this Certificate of Amendment with the Secretary of State of Delaware"; stamps = 2010/2018 prior-instrument recitals |  |
| 074 | B | DPZ | 0001286681 | 0001193125-25-096735 | d574686dex31.htm | EX-3.1 | AMENDED_AND_RESTATED_CERTIFICATE | MISSING | b211e8a0dd8625b245541b1f725230ce121f90cbcbeb4e3d56a4b775d83a97cb | ex0 ce0 up0 st0 x0 | undated snapshot def (anchor candidate) | **D** INC+PRIOR | "originally filed July 30, 2002, amended and restated on May 11, 2004 ..." |  |
| 075 | B | TSLA | 0001318605 | 0001564590-17-003118 | tsla-ex31_1396.htm | EX-3.1 | AMENDED_AND_RESTATED_CERTIFICATE | MISSING | 357e2c6007abcca524c8d0c5002663e1bfce2d89022828d93e6f808956df7df2 | ex0 ce0 up0 st1 x0 | undated snapshot def (anchor candidate) | **D** INC | recital 2003; "Effective Date" = IPO closing (board classes) |  |
| 076 | B | UAA | 0001336917 | 0001193125-12-335302 | d359179dex301.htm | EX-3.01 | AMENDED_AND_RESTATED_ARTICLES | MISSING | 030a1cfb6a526362838e9d24282b3c5fa01adad91f49f2c47510d7f542e80a0a | ex0 ce0 up0 st0 x0 | undated snapshot def (anchor candidate) | **D** COMPONENT | annotation "[Amended June 11, 2012]" |  |
| 077 | B | CXO | 0001358071 | 0000950129-07-003852 | h48791exv3w1.htm | EX-3.1 | RESTATED_CERTIFICATE | MISSING | ec1c412fd58d02c6ef6104943f52aa34f4ce48f2bf892c58ad83a796d7fad659 | ex0 ce0 up0 st1 x0 | undated snapshot def (anchor candidate) | **D** INC | recital: original cert filed 2006 |  |
| 078 | B | VEEV | 0001393052 | 0001193125-13-406605 | d615271dex31.htm | EX-3.1 | RESTATED_CERTIFICATE | MISSING | 30468bd598f8c69cde4a27f8d86fd1d3e2f36c69fe0a1eff7e8f9bb971aa0b47 | ex0 ce0 up0 st1 x0 | undated snapshot def (anchor candidate) | **D** INC | recital: original cert filed 2007 |  |
| 079 | B | VEEV | 0001393052 | 0001393052-24-000031 | a240612arcertificateofin.htm | EX-3.1 | AMENDED_AND_RESTATED_CERTIFICATE | MISSING | 4835644463b69f0e7c502928ac7ce3bc5823cb5abe5f0a53c5c44fc0265eb70b | ex0 ce0 up0 st1 x0 | undated snapshot def (anchor candidate) | **D** INC | recital: original cert filed 2007 |  |
| 080 | B | VEEV | 0001393052 | 0001628280-21-001246 | veevex31feb2021.htm | EX-3.1 | RESTATED_CERTIFICATE | MISSING | b6bb7ad78f7270fe992134da0fc9a09f127a13cf3c19615c7cb2332511918d49 | ex0 ce0 up0 st1 x0 | undated snapshot def (anchor candidate) | **A** TIME_BEFORE_DATE | "shall be effective as of 12:02 p.m. Eastern Time on February 1, 2021" | 2021-02-01 |
| 081 | B | VEEV | 0001393052 | 0001628280-21-013044 | veevex31jun2021.htm | EX-3.1 | AMENDED_AND_RESTATED_CERTIFICATE | MISSING | 95572ef913cebef01603b5f39cffd627bb31d492edbd7226fc7df3e040005ed4 | ex0 ce0 up0 st1 x0 | undated snapshot def (anchor candidate) | **D** INC | recital: original cert filed 2007 |  |
| 082 | B | AWK | 0001410636 | 0001193125-08-227647 | dex31.htm | EX-3.1 | RESTATED_CERTIFICATE | MISSING | 3dbad47ecaac5da4c76cc6d419393e8099a75d89c52bd8f6be363603691be4b1 | ex0 ce0 up0 st1 x0 | undated snapshot def (anchor candidate) | **D** INC | recital: original cert filed 1936 |  |
| 083 | B | KDP | 0001418135 | 0001104659-18-044357 | a18-16509_3ex3d1.htm | EX-3.1 | AMENDED_AND_RESTATED_CERTIFICATE | MISSING | 32d9a21cbb4f46d0244934c9ca07ce4b0e23fee5fed9cd70b0de5c4be39fe0e5 | ex0 ce0 up0 st0 x0 | undated snapshot def (anchor candidate) | **D** SIGNATURE+CLASSIFICATION_HAZARD | "CERTIFICATE OF THIRD AMENDMENT" classified as A&R; executed July 9, 2018 |  |
| 084 | B | VRSK | 0001442145 | 0001193125-15-206612 | d933894dex31.htm | EX-3.1 | AMENDED_AND_RESTATED_CERTIFICATE | MISSING | ae286dc36dc2acee78b0707255dd383d94e996c68c59eb5845ac785e00a173ae | ex0 ce0 up0 st0 x0 | undated snapshot def (anchor candidate) | **D** INC+CLAUSE_NO_STAMP | "become effective upon the filing of this A&R Certificate with the Secretary of State"; no stamp at all |  |
| 085 | B | VRSK | 0001442145 | 0001193125-22-163943 | d308585dex31.htm | EX-3.1 | RESTATED_CERTIFICATE | MISSING | 1415b3ce0794d43cac146f395d9db8fed8cc68bf4d8aa27241ba618c55c4dbb0 | ex0 ce0 up0 st0 x0 | undated snapshot def (anchor candidate) | **A** TIME_BEFORE_DATE | "shall become effective at 8:11 a.m. (local time ...) on May 25, 2022" | 2022-05-25 |
| 086 | B | VRSK | 0001442145 | 0001193125-25-127567 | d908167dex31.htm | EX-3.1 | RESTATED_CERTIFICATE | MISSING | fcfce68b2952c0e7719efbdee02a1bbfb9ddd449e6b4f02b9021769a0a5b1c07 | ex0 ce0 up0 st1 x0 | undated snapshot def (anchor candidate) | **D** INC | recital: original cert filed 2008 |  |
| 087 | B | GM | 0001467858 | 0001193125-09-169233 | dex31.htm | EX-3.1 | AMENDED_AND_RESTATED_CERTIFICATE | MISSING | 7c69ceae6b31a0ee068904325bd70818e961293b5f824b2f920d22333080b322 | ex0 ce0 up0 st0 x0 | undated snapshot def (anchor candidate) | **D** INC | "date of filing of its original Certificate ... was June 17, 2009" |  |
| 088 | B | GM | 0001467858 | 0001193125-09-235641 | dex31.htm | EX-3.1 | AMENDED_AND_RESTATED_CERTIFICATE | MISSING | 5862279a7ceeb272345859ced853ed149549393c4d9923e0e169e5f66f3dbbcd | ex0 ce0 up0 st0 x0 | undated snapshot def (anchor candidate) | **D** INC+PRIOR+BARE_UPON_FILING | appended Certificate of Amendment "shall be effective upon filing" (no authority, contract-excluded) |  |
| 089 | B | GM | 0001467858 | 0001193125-10-279214 | dex32.htm | EX-3.2 | RESTATED_CERTIFICATE | MISSING | c0b2a4dd885d44552cdb573f5da2de424b7607df2c9e2b0a2aaae08f76f4da33 | ex0 ce0 up0 st0 x0 | undated snapshot def (anchor candidate) | **D** INC | "date of filing ... was August 11, 2009" |  |
| 090 | B | HII | 0001501585 | 0000950123-11-032558 | v59141exv3w1.htm | EX-3.1 | RESTATED_CERTIFICATE | MISSING | c8fe868bd722008e6b4a68c6c60031765a2b5fb02aea78cdcd1cc8c08a8ec5f4 | ex0 ce0 up0 st0 x0 | undated snapshot def (anchor candidate) | **A** TIME_BEFORE_DATE | "shall become effective at 11:59 p.m. (local time ...) on March 30, 2011" | 2011-03-30 |
| 091 | B | XYL | 0001524472 | 0000950123-11-089760 | y93081exv3w1.htm | EX-3.1 | AMENDED_AND_RESTATED_ARTICLES | MISSING | 8914c2ff92a2ed462a0d0656c0888de75a4af6275951abaae443d81484621637 | ex0 ce0 up0 st0 x0 | undated snapshot def (anchor candidate) | **E** | no dates |  |
| 092 | B | XYL | 0001524472 | 0001524472-13-000016 | xyl09302013ex31.htm | EX-3.1 | AMENDED_AND_RESTATED_ARTICLES | MISSING | 94764aaa2f537fd2234b569e6ac587a11fa9bd17509cda7c937bb60360fe51a2 | ex0 ce0 up0 st0 x0 | undated snapshot def (anchor candidate) | **E** | no dates |  |
| 093 | B | XYL | 0001524472 | 0001524472-14-000013 | xyl06302014ex31.htm | EX-3.1 | AMENDED_AND_RESTATED_ARTICLES | MISSING | 43f17e3fcebdaa9b4744603cb6cc5910f801a2791b6f46027c4263311147a605 | ex0 ce0 up0 st0 x0 | undated snapshot def (anchor candidate) | **E** | no dates |  |
| 094 | B | XYL | 0001524472 | 0001524472-17-000027 | a8-k31xcharter.htm | EX-3.1 | AMENDED_AND_RESTATED_ARTICLES | MISSING | 86317e062eb47bb5d2d3c79297cde702554fc548e4330d373c05faadbf146fcf | ex0 ce0 up0 st0 x0 | undated snapshot def (anchor candidate) | **E** | no dates |  |
| 095 | B | CRWD | 0001535527 | 0001104659-19-035685 | a19-11597_1ex3d1.htm | EX-3.1 | AMENDED_AND_RESTATED_CERTIFICATE | MISSING | 9a22a5529e9730c8ca7e189adb20ff76a03bbe5b362fcedd05d5f07698300fd4 | ex0 ce0 up0 st1 x0 | undated snapshot def (anchor candidate) | **D** INC | recital: original cert filed 2011 |  |
| 096 | B | CRWD | 0001535527 | 0001104659-26-076376 | tm2618192d1_ex3-1.htm | EX-3.1 | AMENDED_AND_RESTATED_CERTIFICATE | MISSING | ccebc29e4449080cc0bf7cf58a51d6330f6e91c636d8d1136540388f2618db7d | ex0 ce0 up0 st1 x0 | undated snapshot def (anchor candidate) | **D** INC | recital: original cert filed 2011 |  |
| 097 | B | FANG | 0001539838 | 0001539838-12-000004 | exhibit31amendcertofincorp.htm | EX-3.1 | AMENDED_AND_RESTATED_CERTIFICATE | MISSING | 369b0c5de21d828c31a7d9dd261e9f8da24a97ff7afaff6ee151fc4194b6485a | ex0 ce0 up0 st0 x0 | undated snapshot def (anchor candidate) | **E** | no dates |  |
| 098 | B | FANG | 0001539838 | 0001539838-23-000086 | diamondbackex31-6x14x23.htm | EX-3.1 | AMENDED_AND_RESTATED_CERTIFICATE | MISSING | 3f38fb5896b27cc14eeac90570eb8a63deef7a37db8a04ba15bc2e7ad2d7e864 | ex0 ce0 up0 st0 x0 | undated snapshot def (anchor candidate) | **D** INC | "date of filing ... was the 30th day of December, 2011" |  |
| 099 | C | NWS,NWSA | 0001564708 | 0001193125-13-281463 | d560987dex31.htm | EX-3.1 | AMENDED_AND_RESTATED_CERTIFICATE | MISSING | b6f09bc8ec1f02c46ff634c38428f457100e52e7a7d3278ca3782a95f557b976 | ex0 ce0 up0 st1 x1 | undated continuity blocker | **A** TIME_BEFORE_DATE | "Upon this A&R Certificate ... becoming effective at 3:40 pm on June 28, 2013, the date of filing with the Secretary of State" | 2013-06-28 |
| 100 | C | NWS,NWSA | 0001564708 | 0001193125-13-281463 | d560987dex32.htm | EX-3.2 | BYLAWS | MISSING | 35939885d65e35a627c156b2389a68992d2f8dea261f5828d84220d066382b73 | ex0 ce0 up0 st0 x0 | undated continuity blocker | **E** | bylaws; no dates |  |
| 101 | C | NWS,NWSA | 0001564708 | 0001193125-13-282830 | d564422dex31.htm | EX-3.1 | AMENDED_AND_RESTATED_CERTIFICATE | MISSING | 1629df8849843a3626a6eb95187d0732ad5954bef5f4ae96aec273712376c80d | ex0 ce0 up0 st1 x0 | undated continuity blocker | **A** TIME_BEFORE_DATE | same sentence (second 2013 copy) | 2013-06-28 |
| 102 | C | NWS,NWSA | 0001564708 | 0001193125-13-373501 | d581644dex31.htm | EX-3.1 | RESTATED_CERTIFICATE | MISSING | 3fe68918b4eae8cb9e80592bd67292a1a5b15b1f998aaa1a33d2e3de5f6eb714 | ex0 ce0 up0 st1 x0 | undated continuity blocker | **D** INC+PRIOR | recitals: LLC formation 2012; June 28, 2013 name change and A&R filings |  |
| 103 | C | NWS,NWSA | 0001564708 | 0001564708-19-000002 | ex3-1.htm | EX-3.1 | BYLAWS | MISSING | eb3f80d9f512daae76d2415842201fae1fc706d78ac8a3b8a67134a65802b789 | ex0 ce0 up0 st0 x0 | undated continuity blocker | **A** BARE_EFFECTIVE+LEGEND+BYLAWS | bylaws legend "(Effective February 25, 2019)" | 2019-02-25 |
| 104 | C | NWS,NWSA | 0001564708 | 0001564708-23-000258 | exhibit31-amendedandrestat.htm | EX-3.1 | BYLAWS | MISSING | a6a7452c46d0c84cf91aaf996d74e7d6bb0c903d8c0f629fd57fc1e727bcc66c | ex0 ce0 up0 st0 x0 | undated continuity blocker | **A** BARE_EFFECTIVE+LEGEND+BYLAWS | bylaws legend "(Effective June 23, 2023)" | 2023-06-23 |
| 105 | C | NWS,NWSA | 0001564708 | 0001564708-25-000586 | ex31combinedcertificateofa.htm | EX-3.1 | CERTIFICATE_OF_AMENDMENT | MISSING | d518a6d6dc0c0369949d21629aedecdfcf5317c959f64cb86cfad0f177e02e82 | ex0 ce0 up0 st0 x0 | undated continuity blocker | **D** SIGNATURE | executed "this 19th day of November 2025"; no effective statement |  |
| 106 | C | NWS,NWSA | 0001564708 | 0001564708-25-000586 | ex32combinedrestatedcertif.htm | EX-3.2 | RESTATED_CERTIFICATE | MISSING | 7c8501dc113ce26e47f6b9b7ab7ca70df6806078101130145323cb170ce3739b | ex0 ce0 up0 st1 x0 | undated continuity blocker | **D** INC+PRIOR | recitals: LLC formation 2012; 2013 filings; restates only |  |
| 107 | B | HLT | 0001585689 | 0001193125-13-476077 | d645078dex31.htm | EX-3.1 | AMENDED_AND_RESTATED_CERTIFICATE | MISSING | cc26447d0167402ec9c4d5f0d275d3741e5a19261c99c5172578ba5dd6b2b3ec | ex0 ce0 up0 st0 x0 | undated snapshot def (anchor candidate) | **A** TIME_BEFORE_DATE | "shall become effective at 8:00 a.m. (Eastern Time) on December 17, 2013" | 2013-12-17 |
| 108 | B | HLT | 0001585689 | 0001585689-25-000109 | restatedhltcharterexhibit33.htm | EX-3.3 | RESTATED_CERTIFICATE | MISSING | a5127b8c7d526446357a11897a29f925faec21c4741a7b16b649b7d609129d00 | ex0 ce0 up0 st0 x0 | undated snapshot def (anchor candidate) | **D** INC+BARE_UPON_FILING | "shall be effective upon filing" (no authority, contract-excluded); recital 2010 |  |
| 109 | B | CZR | 0001590895 | 0001104659-14-067189 | a14-21021_2ex3d1.htm | EX-3.1 | AMENDED_AND_RESTATED_ARTICLES | MISSING | dc479587c12a4e74a68a3463ff6a156e73b0667313a85981673edad1e1a15506 | ex0 ce0 up0 st0 x0 | undated snapshot def (anchor candidate) | **E** | no dates |  |
| 110 | B | CZR | 0001590895 | 0001193125-23-169019 | d522744dex31.htm | EX-3.1 | AMENDED_AND_RESTATED_CERTIFICATE | MISSING | 9e10c658d145c2901d9109b7ff2c08161accf7aa837453a783956d9f5c52162a | ex0 ce0 up0 st0 x0 | undated snapshot def (anchor candidate) | **D** INC | recital: original cert 2020 |  |
| 111 | B | GOOGL | 0001652044 | 0001193125-22-167375 | d294315dex301.htm | EX-3.01 | AMENDED_AND_RESTATED_CERTIFICATE | MISSING | e2cbb1d17678da6d23c021c3f5dede303181926353170c0f36f5a9fafdd59e08 | ex0 ce0 up0 st1 x0 | undated snapshot def (anchor candidate) | **A** BARE_EFFECTIVE+TIME_AFTER_DATE | "amended and restated in its entirety, effective June 3, 2022, at 4:01p.m., EDT" | 2022-06-03 |
| 112 | B | FTV | 0001659166 | 0001659166-21-000199 | a20210702-ex31.htm | EX-3.1 | RESTATED_CERTIFICATE | MISSING | 8b47f1efa92844178248c188803bc29949e2055dfbfb7d83055aef57da4a3841 | ex0 ce0 up0 st0 x0 | undated snapshot def (anchor candidate) | **D** INC | recital: original cert filed 2015 |  |
| 113 | B | FTV | 0001659166 | 0001659166-22-000155 | a202271-ex31.htm | EX-3.1 | RESTATED_CERTIFICATE | MISSING | bd8573686812a35049157d73ba60ca5e52073854ecb45166e1703710a57c9d11 | ex0 ce0 up0 st0 x0 | undated snapshot def (anchor candidate) | **D** INC | recital: original cert filed 2015 |  |
| 114 | B | FTV | 0001659166 | 0001659166-24-000148 | exhibit31-restatedcertific.htm | EX-3.1 | RESTATED_CERTIFICATE | MISSING | bfeba628b470d00c2b41b49427bee2590949f4dcd744afc4c2108b26ab81a9f6 | ex0 ce0 up0 st0 x0 | undated snapshot def (anchor candidate) | **D** INC | recital: original cert filed 2015 |  |
| 115 | B | ASH | 0001674862 | 0001193125-16-714093 | d246354dex31.htm | EX-3.1 | AMENDED_AND_RESTATED_CERTIFICATE | MISSING | 84fb79e3acdec2cee4096b125004680a278adf39e7eb183a2bce7bafd1004416 | ex0 ce0 up0 st1 x0 | undated snapshot def (anchor candidate) | **A** TIME_BEFORE_DATE | "shall be effective as of 8:30 a.m. Eastern Daylight Time on September 20, 2016" | 2016-09-20 |
| 116 | B | AA | 0001675149 | 0001193125-16-758975 | d474959dex31.htm | EX-3.1 | AMENDED_AND_RESTATED_CERTIFICATE | MISSING | 6d1726a8524f3f700fae2f269d66cd3c4a9b48ee33a461af3c3f03c46d02179f | ex0 ce0 up0 st0 x0 | undated snapshot def (anchor candidate) | **A** TIME_BEFORE_DATE | "is to become effective as of 11:59 p.m., Eastern time, on October 31, 2016" | 2016-10-31 |
| 117 | C | LW | 0001679273 | 0001104659-23-036640 | tm239888d1_ex3-1.htm | EX-3.1 | BYLAWS | MISSING | 31a05234442ce30dd8273a07a87dbc36cc155bd29d7afd17e9292adccc20b51c | ex0 ce0 up0 st0 x0 | undated continuity blocker | **E** LEGEND_NO_EFFECTIVE | bylaws "As Amended March 23, 2023" |  |
| 118 | C | LW | 0001679273 | 0001193125-16-766127 | d273163dex32.htm | EX-3.2 | BYLAWS | MISSING | 352aec829c7c49b701dc4f1ed9dea6c4d280808c8508b426c8eeca2dfed3a637 | ex0 ce0 up0 st0 x0 | undated continuity blocker | **E** LEGEND_NO_EFFECTIVE | bylaws "As Amended November 8, 2016" |  |
| 119 | C | LW | 0001679273 | 0001679273-24-000064 | lw-202409278kxex31.htm | EX-3.1 | CERTIFICATE_OF_AMENDMENT | MISSING | 0e538020a74df06466fb097ee70c98dcf2be95c6168eb4ae3361a703125b864a | ex0 ce0 up0 st0 x0 | undated continuity blocker | **D** PRIOR+SIGNATURE | "A&R Certificate ... dated November 8, 2016"; executed September 26, 2024 |  |
| 120 | B | MRNA | 0001682852 | 0001193125-18-349938 | d677222dex31.htm | EX-3.1 | AMENDED_AND_RESTATED_CERTIFICATE | MISSING | c5c588feb9977c6eee8efb90fb8981e126c1792c40c36091aafaf1258cd8d83a | ex0 ce0 up0 st1 x0 | undated snapshot def (anchor candidate) | **D** INC+PRIOR | recitals: original 2016; A&R filed May 7, 2018 |  |
| 121 | B | MRNA | 0001682852 | 0001682852-24-000031 | exhibit3158248-k.htm | EX-3.1 | RESTATED_CERTIFICATE | MISSING | edbaa2cf3764cf6547b29dc71b2da1762c01fbd017601490b568ce86e2ffc769 | ex0 ce0 up0 st0 x0 | undated snapshot def (anchor candidate) | **D** INC | recital: original cert 2016 |  |
| 122 | B | VST | 0001692819 | 0001193125-20-132407 | d899504dex31.htm | EX-3.1 | RESTATED_CERTIFICATE | MISSING | 658875be56fd812f57ca757aa961a9eaa6ce794b4171ac69bff029f56c94668a | ex0 ce0 up0 st0 x0 | undated snapshot def (anchor candidate) | **D** OTHER | "Operative Date" defined by stockholder agreement dated October 3, 2016 |  |
| 123 | B | VST | 0001692819 | 0001193125-25-112869 | d786785dex31.htm | EX-3.1 | AMENDED_AND_RESTATED_CERTIFICATE | MISSING | a6ef5d6435775c91e48a52dbe9e21a52c440e01178e5df6eeb8638145c627332 | ex0 ce0 up0 st1 x0 | undated snapshot def (anchor candidate) | **D** INC+PRIOR | recital: original cert filed 2016; restated April 29, 2020 |  |
| 124 | B | CI | 0001739940 | 0000950159-23-000019 | ex3-2.htm | EX-3.2 | RESTATED_CERTIFICATE | MISSING | 1eb739c0231bacf2197411defe57471c584355b5e4ff9c5d555aabf8b450595e | ex0 ce0 up0 st0 x0 | undated snapshot def (anchor candidate) | **A** TIME_BEFORE_DATE+ORDINAL_DAY | "shall become effective at 8:01 a.m. Eastern Time on the 13th day of February, 2023" | 2023-02-13 |
| 125 | B | CI | 0001739940 | 0001739940-23-000016 | exhibit31-thecignagroupxre.htm | EX-3.1 | RESTATED_CERTIFICATE | MISSING | db1e87e1b2137c9452689b25f237d4071d615bfa0c6d761bff07879bb9a2850e | ex0 ce0 up0 st0 x0 | undated snapshot def (anchor candidate) | **D** INC | recital: original cert filed 2018 |  |
| 126 | B | CI | 0001739940 | 0001739940-23-000020 | exh_31xrestatedxcharter.htm | EX-3.1 | RESTATED_CERTIFICATE | MISSING | 02498ad982c6201087d255871909c3106938273eb05a8f247ddda1cdd97a9a9c | ex0 ce0 up0 st0 x0 | undated snapshot def (anchor candidate) | **D** INC | recital: original cert filed 2018 |  |
| 127 | B | BEAM_OLD | 0001745999 | 0001193125-20-031290 | d842502dex31.htm | EX-3.1 | AMENDED_AND_RESTATED_CERTIFICATE | MISSING | cf270e6f9ea470aeb33fe75ddbd09a42614080ff27c49c787dd5dd104e32fe48 | ex0 ce0 up0 st3 x0 | undated snapshot def (anchor candidate) | **D** INC+PRIOR | recitals: cert 2017; A&R filed 2018 x2; amendment filed 2019 |  |
| 128 | C | FOX,FOXA,TFCF,TFCFA | 0001754301 | 0001193125-19-079678 | d721949dex33.htm | EX-3.3 | CERTIFICATE_OF_DESIGNATION | MISSING | 8cd6eef02eeb26545856103657ec90c5a544f106fa9f599e9afe344e2194c0e3 | ex0 ce0 up0 st0 x0 | undated continuity blocker | **D** ADOPTION+SIGNATURE | board adopted March 19, 2019; signed 19 March 2019 |  |
| 129 | C | FOX,FOXA,TFCF,TFCFA | 0001754301 | 0001193125-19-296568 | d837035dex31.htm | EX-3.1 | CERTIFICATE_OF_ELIMINATION | MISSING | 8bb59d99447682200685242dd0d1cd36200a4db3b9db8a8675a990384b7c231b | ex0 ce0 up0 st0 x0 | undated continuity blocker | **D** ADOPTION+SIGNATURE | board resolution March 19, 2019; signed November 20, 2019 |  |
| 130 | C | FOX,FOXA,TFCF,TFCFA | 0001754301 | 0001628280-23-002786 | foxa-20221231x10qex31.htm | EX-3.1 | AMENDED_AND_RESTATED_CERTIFICATE | MISSING | 477a9b5ce30b7c047dfbb218ea15e5929779ac986dd4d4fe4cae686f3386ceb5 | ex0 ce0 up0 st1 x1 | undated continuity blocker | **D** INC+PRIOR+DGCL_CLAUSE_10Q | "effective upon filing pursuant to the DGCL" in a 10-Q exhibit (no Item 5.03 primary) |  |
| 131 | B | DNB_OLD | 0001799208 | 0001104659-25-082892 | tm2524330d1_ex3-1.htm | EX-3.1 | AMENDED_AND_RESTATED_CERTIFICATE | MISSING | 859dd4566fad7b5268deafb34ca92144f681235fc21d3462dfbe2ec854acff95 | ex0 ce0 up0 st0 x0 | undated snapshot def (anchor candidate) | **E** | no dates |  |
| 132 | B | MRVL | 0001835632 | 0001193125-23-071340 | d483967dex31.htm | EX-3.1 | AMENDED_AND_RESTATED_CERTIFICATE | MISSING | aac9dae80ca493c5868b18a7548791c833bca7aa39228698f1ec628991730784 | ex0 ce0 up0 st2 x0 | undated snapshot def (anchor candidate) | **D** INC+PRIOR | recitals: original 2020; A&R filed 2021 |  |
| 133 | C | Q | 0002058873 | 0001193125-25-240313 | d21160dex31.htm | EX-3.1 | AMENDED_AND_RESTATED_CERTIFICATE | MISSING | e56a7cc32a67e63c6f8d341fa3174a9eb93c7710eb96b13ca9d8c2fa3a16bdd4 | ex0 ce0 up0 st1 x0 | undated continuity blocker | **D** INC+OTHER_INSTRUMENT | recital 2024; embedded power of attorney "effective as of this 1st day of November, 2025" |  |
| 134 | C | Q | 0002058873 | 0001193125-25-261603 | d65598dex31.htm | EX-3.1 | CERTIFICATE_OF_DESIGNATION | MISSING | 681d653d4af35df60444cadd6abbbec41703aba005b7e419a85ed0826b6230f5 | ex0 ce0 up0 st0 x0 | undated continuity blocker | **A** TIME_BEFORE_DATE | series "authorized, designated and created, effective as of 11:59 p.m., New York City Time, on October 31, 2025" | 2025-10-31 |
| 135 | C | Q | 0002058873 | 0001193125-25-261603 | d65598dex33.htm | EX-3.3 | BYLAWS | MISSING | 68545557fe52cf1a077a091a8bd3c10415738bc9562dac9b73f65047ec69efc3 | ex1 ce0 up0 st0 x0 | undated continuity blocker | **A** UPPERCASE_MONTH+LEGEND+BYLAWS | "EFFECTIVE AS OF NOVEMBER 1, 2025" (grammar matched; _iso_date rejects uppercase month) | 2025-11-01 |
| 136 | B | FDXF | 0002082247 | 0001104659-26-068521 | tm2615735d1_ex3-2.htm | EX-3.2 | AMENDED_AND_RESTATED_CERTIFICATE | AMBIGUOUS | 18ea7267fe363b8fc24747cacbf5502a8418bb63ef30492ab319f2167f52ede2 | ex3 ce0 up0 st2 x0 | undated snapshot def (anchor candidate) | **F** EXPLICIT_ATTRIBUTION_HAZARD | subject "effective as of June 1, 2026 at 1:01 a.m." + prior amendment "filed ... effective on May 27, 2026" both taken by EXPLICIT grammar -> AMBIGUOUS |  |

## 10.37-B 행 단위 감사 — 반사실 연속성 94문서

새 anchor를 얻는 Pool B 11 item의 나머지 무일자 governing 문서다. 열은 10.37-A와 같고 parity 94/94 ·
SHA 94/94다.

| # | work item | accession | locator | TYPE | classification | stored | SHA-256 | O2 matches | judgment | evidence | cf date |
|---|---|---|---|---|---|---|---|---|---|---|---|
| X000 | DAL | 0000950144-03-003858 | g81186exv3w2.txt | EX-3.2 | BYLAWS | MISSING | 7cb87b08e034207d33d391f3c1a97c35abf7ed2d51009c54e3786e77115e5e53 | ex0 up0 st0 x0 | **E** | no dated effectiveness/filing statement |  |
| X001 | DAL | 0000950144-04-002423 | g87427exv3w2.txt | EX-3.2 | BYLAWS | MISSING | 98e298c326e2b00315092b5f4d0739220a083b46cecde61c858340c9c7ebfe5a | ex0 up0 st0 x0 | **E** LEGEND_NO_EFFECTIVE | "BY-LAWS AS AMENDED THROUGH NOVEMBER 23, 2003" |  |
| X002 | DAL | 0000950144-98-001674 | seq:2 | EX-3.2 | BYLAWS | MISSING | 5ac13500add38af57004cf87eab8b74a78e40e34918e9c6bf2fca9ca34115302 | ex0 up0 st0 x0 | **E** LEGEND_NO_EFFECTIVE | "BY-LAWS AS AMENDED THROUGH JANUARY 22, 1998" |  |
| X003 | DAL | 0001019687-08-002378 | delta_8k-ex301.htm | EX-3.1 | BYLAWS | MISSING | 5d0cd2df8e547c38fa564f692c6ac78b73401e5e2316d6cbab19903ee5bb0e59 | ex0 up0 st0 x0 | **E** LEGEND_NO_EFFECTIVE | "(As amended through May 19, 2008)" |  |
| X004 | DAL | 0001019687-14-002579 | delta_8k-ex0301.htm | EX-3.01 | CERTIFICATE_OF_AMENDMENT | MISSING | e2ff13a737c49e9169adff3c793aaf067b3b614367ac7dd3e870fcd4b7ff5032 | ex0 up0 st0 x0 | **E** | no dated effectiveness/filing statement |  |
| X005 | DAL | 0001019687-14-002579 | delta_8k-ex0302.htm | EX-3.2 | BYLAWS | MISSING | 6e6baaba5f29565e96cd4babd05f7d47678db84d16f49e9f912eaf76e71c7483 | ex0 up0 st0 x0 | **E** LEGEND_NO_EFFECTIVE | "(As amended through June 27, 2014)" |  |
| X006 | DAL | 0001047469-98-035570 | seq:2 | EX-3.2 | BYLAWS | MISSING | 1dc41c705927bb4bbc14d26735d0f4ca25fcd6440b6349139b1e1afab249a2ff | ex0 up0 st0 x0 | **E** LEGEND_NO_EFFECTIVE | "As Amended Through July 23, 1998" |  |
| X007 | DAL | 0001047469-98-041279 | seq:2 | EX-3.1 | BYLAWS | MISSING | 11979195dccbf606ecae4194a410a3eff6b8ada8369bfcff3727f6159d7208c3 | ex0 up0 st0 x0 | **E** LEGEND_NO_EFFECTIVE | "As Amended Through November 16, 1998" |  |
| X008 | DAL | 0001167966-05-000134 | ex-3.htm | EX-3 | BYLAWS | MISSING | ec66f046d24071285d5c039168f284dc832ed97736bdd9bcc088009bc89610f6 | ex0 up0 st0 x0 | **E** LEGEND_NO_EFFECTIVE | "As Amended Through January 27, 2005" |  |
| X009 | DAL | 0001188112-05-001106 | ex3-1.htm | EX-3.1 | BYLAWS | MISSING | 6d1061bedc6f355ca5040d92f505ec3c143e349586908b01e688d5821956bf1e | ex0 up0 st0 x0 | **D** COMPONENT | compiled 1998 amendment "5:00 p.m. ... November 2, 1998 (the Effective Time)"; 1996 designations |  |
| X010 | DAL | 0001188112-05-001106 | ex3-2.htm | EX-3.2 | BYLAWS | MISSING | 13c04de09597a6475b6e122eb05a841106a28dc6fdeeaab9a8413522e03226d5 | ex0 up0 st0 x0 | **E** LEGEND_NO_EFFECTIVE | "As Amended Through May 19, 2005" |  |
| X011 | DAL | 0001188112-06-001696 | ex3-1.htm | EX-3.1 | BYLAWS | MISSING | b547358bd767d8cca5a96c0d8ea1c0fec5f1e5c17624ab0e9ab7ba6361e4161f | ex0 up0 st0 x0 | **E** LEGEND_NO_EFFECTIVE | "As Amended Through May 25, 2006" |  |
| X012 | DAL | 0001683168-16-000419 | delta_8k-ex0301.htm | EX-3.1 | BYLAWS | MISSING | dd138e2ef85167c930599ee705c24f240e1fa800f3d7fb646dd87abf1e3fe061 | ex0 up0 st0 x0 | **E** LEGEND_NO_EFFECTIVE | "As Amended and Restated through October 28, 2016" |  |
| X013 | DAL | 0001683168-19-000302 | delta_8k-ex0301.htm | EX-3.1 | BYLAWS | MISSING | 8974c4dd035faa258bee7683476dcbb7ea653ef4a21ac3df728a13da10ebf0be | ex0 up0 st0 x0 | **E** LEGEND_NO_EFFECTIVE | "As Amended and Restated through February 7, 2019" |  |
| X014 | DAL | 0001683168-22-008312 | delta_ex0301.htm | EX-3.1 | BYLAWS | MISSING | 502e6cc3326d34053feb7bbc8d15020994090d8086fe34f57bf6b4dceb1c2194 | ex0 up0 st0 x0 | **E** LEGEND_NO_EFFECTIVE | "As Amended and Restated through December 7, 2022" |  |
| X015 | WEC | 0000107815-00-000004 | seq:2 | EX-3.2 | ARTICLES_OF_AMENDMENT | MISSING | 338a59daf80dc8281e9437255801fbfc0d55ad811b9e6ef752a3cc1f963984b2 | ex0 up0 st0 x0 | **D** COMPONENT+LEGEND_NO_EFFECTIVE | bylaws "As Amended to January 25, 2000"; footnote "Effective June 2, 1999, the Board ..." |  |
| X016 | WEC | 0000107815-00-000009 | seq:2 | EX-3.1 | ARTICLES_OF_AMENDMENT | MISSING | 3f5b2ca268a9dc573041a15dd92fa6e2de9bf34c788b32ae4dc2dd17f4c742d3 | ex0 up0 st0 x0 | **D** COMPONENT+LEGEND_NO_EFFECTIVE | bylaws "As Amended to May 1, 2000"; footnote "Effective June 26, 2000, the Board ..." |  |
| X017 | WEC | 0000107815-05-000049 | exhibit3.htm | EX-3 | BYLAWS | MISSING | 3f1d568411649b7e46c43a899cb37ba9a716a25fbdd53d34a94bc66320f3dea3 | ex0 up0 st0 x0 | **E** | "amended, effective at the time of the 2005 Annual Meeting" (event, no date) |  |
| X018 | WEC | 0000107815-12-000108 | wec06302012ex32.htm | EX-3.2 | BYLAWS | MISSING | f46be596f2c8a70ad179d86e964fd3d61cc090181af80a7aadcd20602ef62a60 | ex0 up0 st0 x0 | **E** | no dated effectiveness/filing statement |  |
| X019 | WEC | 0000107815-16-000198 | bylawamendments2016.htm | EX-3.1 | BYLAWS | MISSING | 0a48df70f1993a8163c7ffd18a985e4c86309df056b3264bb80e405d6c0b49d0 | ex0 up0 st0 x0 | **F** CONDITIONAL_EVENT | "(Effective upon the Retirement of Gale E. Klappa as CEO, Expected to be May 1, 2016)" |  |
| X020 | WEC | 0000107815-16-000306 | wec03312016ex31.htm | EX-3.1 | BYLAWS | MISSING | 488740dccbaa6188a74f48744a8c6cb42cafee519ae65e6350eb73c9662c1107 | ex0 up0 st0 x0 | **E** | no dated effectiveness/filing statement |  |
| X021 | WEC | 0000107815-16-000444 | wecenergygroupexhibit31102.htm | EX-3.1 | BYLAWS | MISSING | 6e2c810448203b4fa8e8ef8b16ba3db268e533af5030ab7cd3d7cffcac9a6b7b | ex0 up0 st0 x0 | **E** | no dated effectiveness/filing statement |  |
| X022 | WEC | 0000107815-20-000165 | wecenergygroup-amended.htm | EX-3.1 | BYLAWS | MISSING | a3aa7edeb2d538a5102187cb7cc27f47b0308a0d3677f49c3ad6d93e68e75728 | ex0 up0 st0 x0 | **E** | no dated effectiveness/filing statement |  |
| X023 | WEC | 0000107815-23-000089 | wecenergygroupamendedbylaws.htm | EX-3.1 | BYLAWS | MISSING | c37f02e9ab3882f63b2d0a0f7f959c6b105bc633da17c19d9cc04363f1c985d8 | ex0 up0 st0 x0 | **E** | no dated effectiveness/filing statement |  |
| X024 | WEC | 0000107815-24-000203 | a2024q2wec10qexhibit31.htm | EX-3.1 | ARTICLES_OF_AMENDMENT | MISSING | 4454264b7c82b3c06856d04660b43ffe435c8f6739cdc97c37ef739816048b34 | ex0 up0 st0 x0 | **A** TIME_BEFORE_DATE | "This amendment shall be effective as of 5:00 p.m. Central Time on May 9, 2024" | 2024-05-09 |
| X025 | WEC | 0001104659-15-048374 | a15-14883_1ex3d1.htm | EX-3.1 | ARTICLES_OF_AMENDMENT | MISSING | 87cfcc2522e4de8f9d5bc9804ee8ad3558e86878b1122b1179ce0dc5e139c50f | ex0 up0 st0 x0 | **A** TIME_BEFORE_DATE | "This amendment shall be effective as of 9:01 a.m. Central Time on June 29, 2015" | 2015-06-29 |
| X026 | WEC | 0001104659-15-048374 | a15-14883_1ex3d2.htm | EX-3.2 | BYLAWS | MISSING | 6605b9b91f7fed440cec634524f0ced9c7b32828ddb63727f8014488c8624e80 | ex0 up0 st0 x0 | **E** | no dated effectiveness/filing statement |  |
| X027 | WEC | 0001193125-05-042628 | dex32b.htm | EX-3.2(B) | BYLAWS | MISSING | b0602416ee9298513dde7955bb0b5ccadca858afe9677d808c3f724d234b8fa9 | ex0 up0 st0 x0 | **E** | no dated effectiveness/filing statement |  |
| X028 | TSCO | 0000916365-12-000081 | exhibit31thirdamendedandre.htm | EX-3.1 | BYLAWS | MISSING | 0879dc010710a1e3e60bc82d9cc76aff370bd0ce7ca89c8029b5c44feb22c7d7 | ex0 up0 st0 x0 | **E** | no dated effectiveness/filing statement |  |
| X029 | TSCO | 0000916365-14-000123 | tscofourthamendedandrestat.htm | EX-3.1 | BYLAWS | MISSING | 3ece9c138d05caa0b2dc1d9d328486f7274e2e7a676ee77ea6e6169dc081b5a3 | ex0 up0 st0 x0 | **E** | no dated effectiveness/filing statement |  |
| X030 | TSCO | 0000916365-17-000026 | a31ififthamendedandrestate.htm | EX-3.1 | BYLAWS | MISSING | eaf76bcfcbd60a364ca512513c04c0455ec2c6c6416de44ad37843c80eebb1a9 | ex0 up0 st0 x0 | **E** | no dated effectiveness/filing statement |  |
| X031 | TSCO | 0000916365-17-000026 | a31iififthamendedandrestat.htm | EX-3.1 | BYLAWS | MISSING | 646d57377075dc1755b38f2a5812150413ab6e2a57c060968f46aa72d2207703 | ex0 up0 st0 x0 | **E** | no dated effectiveness/filing statement |  |
| X032 | TSCO | 0000916365-20-000065 | ex31bylawamendment.htm | EX-3.1 | BYLAWS | MISSING | e423f91b747f3da66bd412fa3bab56d656b51836579c7a41932202baeb9d8638 | ex0 up0 st0 x0 | **E** | no dated effectiveness/filing statement |  |
| X033 | TSCO | 0000916365-20-000107 | ex31-fifthamendedandre.htm | EX-3.1 | BYLAWS | MISSING | 97d31be1123493b2e3981ecde95f6f1defd7e3636de8f1fec53d2413ea9c50c3 | ex0 up0 st0 x0 | **E** | no dated effectiveness/filing statement |  |
| X034 | TSCO | 0000916365-22-000112 | ex31sixthamendedandrestate.htm | EX-3.1 | BYLAWS | MISSING | 2b03680f99d65aff1a83de9abcad28a471c019f62aee8ed246d7f685609ed3a9 | ex0 up0 st0 x0 | **E** | no dated effectiveness/filing statement |  |
| X035 | TSCO | 0000916365-22-000112 | ex32sixthamendedandrestate.htm | EX-3.2 | BYLAWS | MISSING | 15766254d0de405767a9088e5fe0472a5be73c29d2f4f9bf54c4c5b0276864c0 | ex0 up0 st0 x0 | **E** | no dated effectiveness/filing statement |  |
| X036 | TSCO | 0000916365-24-000110 | ex31seventhamendedandresta.htm | EX-3.1 | BYLAWS | MISSING | ec2f91d7c55eb7477a4c81ab507eff299c7bdb24a422b823c3e7881fc558a829 | ex0 up0 st0 x0 | **E** | no dated effectiveness/filing statement |  |
| X037 | TSCO | 0000916365-24-000110 | ex32seventhamendedandres.htm | EX-3.2 | BYLAWS | MISSING | b9e10da686453c1ca07b42e3cb019875f82545a11fbfe17d7216768ca3bdb8ac | ex0 up0 st0 x0 | **E** LEGEND_NO_EFFECTIVE | redline legend "(as amended on November 73, 20242)" |  |
| X038 | TSCO | 0000916365-24-000117 | exhibit31stocksplit12202024.htm | EX-3.1 | CERTIFICATE_OF_AMENDMENT | MISSING | e30068d0cf0193cf62940d4d2a3a9c8ab6f3029ccc9e6c13ab69ad948fbb1aae | ex0 up0 st0 x0 | **A** TIME_BEFORE_DATE | "This Certificate of Amendment shall be effective at 5:00 p.m., Eastern Time, on December 19, 2024" | 2024-12-19 |
| X039 | TSCO | 0000950144-09-001147 | g17618exv3xiiy.htm | EX-3.II | BYLAWS | MISSING | 3c4531a1e321c4326f5dcfcf4516f531e0f93936eb91866897926a1ccfafb96a | ex0 up0 st0 x0 | **E** | no dated effectiveness/filing statement |  |
| X040 | TSCO | 0000950144-97-008644 | seq:2 | EX-3.1 | RESTATED_CERTIFICATE | MISSING | a09fcecddaac3f2688c9f51a3403e71330a5619b4a492f5841092e947557edb4 | ex0 up0 st0 x0 | **E** | no dated effectiveness/filing statement |  |
| X041 | TSCO | 0000950144-97-008644 | seq:3 | EX-3.2 | CERTIFICATE_OF_AMENDMENT | MISSING | add818f4e639afd47ce0dadac7751f85e11f567ff535082aeb2dfe2109b6c9b4 | ex0 up0 st1 x0 | **D** INC | recital: cert originally filed 1982 |  |
| X042 | TSCO | 0000950144-97-008644 | seq:4 | EX-3.3 | CERTIFICATE_OF_AMENDMENT | MISSING | 3c34f0cfbe31b154724f8e72d4175fa2f91f2d427a18053c15861d8f1a8acf34 | ex0 up0 st1 x0 | **D** INC | recital: cert originally filed 1982 |  |
| X043 | TSCO | 0001188112-04-001145 | ex3_5.txt | EX-3 | BYLAWS | MISSING | a9cd5e03a8180eac40eb990e8faf90bed4714b751c341fb7bbcad9b9857ba954 | ex0 up0 st0 x0 | **E** | no dated effectiveness/filing statement |  |
| X044 | TSCO | 0001188112-05-000902 | tex3_1-6138.txt | EX-3.1 | CERTIFICATE_OF_AMENDMENT | MISSING | 72ad257ed534a6fa24d3cafe36e757e08014b7a9f3982724a31e5d574a504d8b | ex0 up0 st1 x0 | **D** INC | recital: cert originally filed 1982 |  |
| X045 | TSCO | 0001188112-05-000902 | tex3_2-6138.txt | EX-3.2 | CERTIFICATE_OF_AMENDMENT | MISSING | 658b6b52876efa509bb97015f56e80ce2563e3ec6495776e138e3915a03c7a51 | ex0 up0 st0 x0 | **E** | no dated effectiveness/filing statement |  |
| X046 | VEEV | 0001393052-21-000008 | veevex31mar2021.htm | EX-3.1 | BYLAWS | MISSING | 80083dbeea08d9cedac45a4fb0c3fb04fd83f83e38154c41bc034449ac4f57ad | ex0 up0 st0 x0 | **E** LEGEND_NO_EFFECTIVE | "(as amended and restated on March 17, 2021)" |  |
| X047 | VEEV | 0001393052-23-000039 | veevex31jun2023.htm | EX-3.1 | BYLAWS | MISSING | 3c9b0c9731185de9ea6658e2b7026245920248a5ca16d078d85c767ac7e1670b | ex0 up0 st0 x0 | **E** LEGEND_NO_EFFECTIVE | "(as amended and restated on June 21, 2023)" |  |
| X048 | VEEV | 0001393052-23-000055 | amendedrestatedcertifica.htm | EX-3.2 | AMENDED_AND_RESTATED_CERTIFICATE | MISSING | 69933b36632dac55e06bd1d2d6fedb0ad66a36787d4b21125eaac74ee699ad3f | ex0 up0 st1 x0 | **D** INC | recital: original cert filed 2007 |  |
| X049 | VEEV | 0001393052-23-000055 | certificateofretiremento.htm | EX-3.1 | AMENDED_AND_RESTATED_CERTIFICATE | MISSING | 8d8885620a220d886fdb468d1243733e075c6e15fef4f625640ce9f4d6a0e9ae | ex0 up0 st1 x0 | **D** PRIOR+SIGNATURE | recital A&R filed June 25, 2021; "executed, acknowledged, and filed ... as of October 16, 2023" |  |
| X050 | VEEV | 0001628280-21-001246 | veevex32feb2021.htm | EX-3.2 | BYLAWS | MISSING | 56612d75f4e13a1fbe4ba3a2a1ed57bc7f0f1f6ee26d114a30ac191c1938ca5f | ex0 up0 st0 x0 | **E** LEGEND_NO_EFFECTIVE | "(as amended and restated on February 1, 2021)" |  |
| X051 | VEEV | 0001628280-21-013044 | veevex32june2021.htm | EX-3.2 | BYLAWS | MISSING | 1005183c336ea97328fe9e3a84e6df23aa6d6d7ca6a3e842d4ad46e4763d82e3 | ex0 up0 st0 x0 | **E** LEGEND_NO_EFFECTIVE | "(as amended and restated on June 25, 2021)" |  |
| X052 | VRSK | 0001193125-15-206612 | d933894dex32.htm | EX-3.2 | BYLAWS | MISSING | 7534432ba19c2732107c4339ab9edbcd3dea947558bcdc5d4c87a8f80d45b51e | ex0 up0 st0 x0 | **E** LEGEND_NO_EFFECTIVE | "Amended and Restated as of May 26, 2015" |  |
| X053 | VRSK | 0001193125-16-503652 | d158680dex31.htm | EX-3.1 | BYLAWS | MISSING | 761c12a409b52e7a54c0370fd9d2815ee8221a36b8853c18c1c9c2dd0eea9578 | ex0 up0 st0 x0 | **E** LEGEND_NO_EFFECTIVE | "Amended and Restated as of March 11, 2016" |  |
| X054 | VRSK | 0001193125-19-042424 | d707519dex31.htm | EX-3.1 | BYLAWS | MISSING | 9ab4de0a388dd2bbaccc940c55945ecfd40c80e78d87aa87c050fbf4f0b6e985 | ex0 up0 st0 x0 | **E** LEGEND_NO_EFFECTIVE | "Amended and Restated as of February 13, 2019" |  |
| X055 | VRSK | 0001193125-22-163943 | d308585dex32.htm | EX-3.2 | BYLAWS | MISSING | 14fae38026f413cee9044d2441930648ec3ec10bd9446a19c497dfbc5d47dd11 | ex0 up0 st0 x0 | **E** LEGEND_NO_EFFECTIVE | "Amended and Restated as of May 25, 2022" |  |
| X056 | VRSK | 0001193125-25-127567 | d908167dex32.htm | EX-3.2 | BYLAWS | MISSING | 9aa34f51a490bf6a86275465c0ebb1d86e9ac96f53044fdf019956aee468758b | ex0 up0 st0 x0 | **E** LEGEND_NO_EFFECTIVE | "Amended and Restated as of May 20, 2025" |  |
| X057 | HII | 0000950123-11-032558 | v59141exv3w2.htm | EX-3.2 | BYLAWS | MISSING | cc33171e742b0927fac0f1bad33a2abb86afea678463d561f7133c514ae7befb | ex0 up0 st0 x0 | **E** LEGEND_NO_EFFECTIVE | "As amended, March 30, 2011" |  |
| X058 | HII | 0001193125-13-201661 | d532438dex3ii.htm | EX-3.(II) | BYLAWS | MISSING | 87ddd448e27d434c3643afe5e435589a0699f153e3e45cde1c0ef0f58292f21a | ex0 up0 st0 x0 | **E** LEGEND_NO_EFFECTIVE | "As amended, May 1, 2013" |  |
| X059 | HII | 0001193125-15-073547 | d882901dex32.htm | EX-3.2 | BYLAWS | MISSING | c2fec4cb6731110f23b2c738c5c43fe454b3524bd67b876b3d36be4653c9a800 | ex0 up0 st0 x0 | **E** LEGEND_NO_EFFECTIVE | "As amended, February 24, 2015" |  |
| X060 | HII | 0001193125-16-445822 | d131600dex31.htm | EX-3.1 | BYLAWS | MISSING | a9c9d8560e066a69c1789ba58fbdf839aa6af7161aa11f3df2f6856ee30cd780 | ex0 up0 st0 x0 | **E** LEGEND_NO_EFFECTIVE | "As amended, January 28, 2016" |  |
| X061 | HII | 0001193125-21-100439 | d168808dex31.htm | EX-3.1 | BYLAWS | MISSING | 11b636e9e2b16e6d4c6b756920f0a6f8364a8c6c6654b94a212c0a7c4b870f57 | ex0 up0 st0 x0 | **E** LEGEND_NO_EFFECTIVE | "As amended, March 2, 2021" |  |
| X062 | HII | 0001193125-22-280169 | d418198dex31.htm | EX-3.1 | BYLAWS | MISSING | e48875d0e7f6a359d1503cb7966effa5b3af7166b76325d253a7e7d0ea6f8305 | ex0 up0 st0 x0 | **E** LEGEND_NO_EFFECTIVE | "As amended, March 2, 2021" |  |
| X063 | HII | 0001501585-12-000028 | hii-ex32q3.htm | EX-3.2 | BYLAWS | MISSING | 5e7fdeee4f8d05fa7ef0577c74d029e5dc38cd90a5e2aed032d60b820088a870 | ex0 up0 st0 x0 | **E** LEGEND_NO_EFFECTIVE | "As amended, March 30, 2011" |  |
| X064 | HII | 0001501585-14-000034 | hii-ex32q22014.htm | EX-3.2 | CERTIFICATE_OF_AMENDMENT | MISSING | 786cd558670492237867e0bbdaabbc045afcd9cf85890d2d7fcdb93cf84e9e45 | ex0 up0 st1 x0 | **D** PRIOR | recital: restated cert filed March 30, 2011 |  |
| X065 | HII | 0001501585-15-000027 | hii-ex33q22015.htm | EX-3.3 | CERTIFICATE_OF_AMENDMENT | MISSING | 030ecfe0285decebea4869b7cee5be3c60f793e110ca32ae70c353dddb599488 | ex0 up0 st2 x0 | **D** PRIOR | recitals: restated cert filed 2011; amendment filed 2014 |  |
| X066 | HII | 0001501585-25-000040 | ex31huntingtoningallsresta.htm | EX-3.1 | RESTATED_CERTIFICATE | MISSING | f7465dba345e684d494e97be12f4bdbad5e59aba960bc9f1148847d7c3f6b248 | ex0 up0 st0 x0 | **D** INC | recital: original cert filed 2010 |  |
| X067 | HII | 0001501585-25-000040 | ex32hii-restatedbylaws0430.htm | EX-3.2 | BYLAWS | MISSING | f539a820447fc9f9525428c335802687b547b2fd2975ca72b1da7c159780844e | ex0 up0 st0 x0 | **E** LEGEND_NO_EFFECTIVE | "As amended, April 30, 2025" |  |
| X068 | HLT | 0001193125-13-476077 | d645078dex32.htm | EX-3.2 | BYLAWS | MISSING | db6337451b4d8dc3b734d71fe34eade84d8d002c1434eafff3bed40802e8e8e7 | ex0 up0 st0 x0 | **E** | no dated effectiveness/filing statement |  |
| X069 | HLT | 0001193125-17-001901 | d302894dex31.htm | EX-3.1 | CERTIFICATE_OF_AMENDMENT | MISSING | ed5c92fb31156bf0ddaaa8a0b20ca3940a3ed23e57a731e0a0a2b567e0eb3574 | ex0 up0 st0 x0 | **A** TIME_BEFORE_DATE | "The foregoing amendment shall become effective at 5:01 p.m. (Eastern Time) on January 3, 2017" | 2017-01-03 |
| X070 | HLT | 0001193125-17-087414 | d363167dex32.htm | EX-3.2 | BYLAWS | MISSING | 877d58f7061470b0e2fb9cfd4c197062910fcab12a3516002f331943451c8405 | ex0 up0 st0 x0 | **E** | no dated effectiveness/filing statement |  |
| X071 | HLT | 0001193125-17-347054 | d497124dex31.htm | EX-3.1 | BYLAWS | MISSING | 3ae2c02fc9606bb39a93584ea3d6f92f6d703b982ad3c4860e73a8c222c3cd97 | ex0 up0 st0 x0 | **E** | no dated effectiveness/filing statement |  |
| X072 | HLT | 0001193125-19-212020 | d778524dex31.htm | EX-3.1 | BYLAWS | MISSING | a74cc7338b3735e33fa72bb4c5d67cc5b24dde9a98d95036e24a8e38db8595cb | ex0 up0 st0 x0 | **E** | no dated effectiveness/filing statement |  |
| X073 | HLT | 0001193125-19-212020 | d778524dex32.htm | EX-3.2 | BYLAWS | MISSING | 42743cebb441347b872e420a5184f27a032e79294dbc689552612a52ca773ed1 | ex0 up0 st0 x0 | **E** | no dated effectiveness/filing statement |  |
| X074 | HLT | 0001585689-25-000109 | certificateofamendment-bxe.htm | EX-3.2 | CERTIFICATE_OF_AMENDMENT | MISSING | 980bba1bbd5279f1ea163af92ba5900b2df0cce1780a0a723f433ea392ea2ea6 | ex0 up0 st0 x0 | **E** | no dated effectiveness/filing statement |  |
| X075 | HLT | 0001585689-25-000109 | certificateofamendment-sup.htm | EX-3.1 | CERTIFICATE_OF_AMENDMENT | MISSING | 0952c270a24b3e0736d9538599a2bb3bae2d32f9ba4d5a9054c33677c82ffa18 | ex0 up0 st0 x0 | **E** | no dated effectiveness/filing statement |  |
| X076 | HLT | 0001585689-25-000109 | hlt-bylawredlinexex35.htm | EX-3.5 | BYLAWS | MISSING | 1586d755192dae3976e803deb1a53316469c7c8e99cd16af67280f4e092738f4 | ex0 up0 st0 x0 | **E** | no dated effectiveness/filing statement |  |
| X077 | HLT | 0001585689-25-000109 | hlt-bylawsexhibit34.htm | EX-3.4 | BYLAWS | MISSING | 70a14191fb88b2ad537641bbb9c425fbd54920cc93cb720e78709f9d7c8e68a8 | ex0 up0 st0 x0 | **E** | no dated effectiveness/filing statement |  |
| X078 | GOOGL | 0001193125-26-259830 | d36818dex31.htm | EX-3.1 | AMENDED_AND_RESTATED_CERTIFICATE | MISSING | def7e91b12dc53cee637ca08fe717c8b964dc781739681e172b5569b0869f2ec | ex0 up0 st0 x0 | **D** ADOPTION | certificate of designations; "on June 3, 2026, the Audit Committee adopted the resolution" |  |
| X079 | GOOGL | 0001193125-26-259830 | d36818dex32.htm | EX-3.2 | AMENDED_AND_RESTATED_CERTIFICATE | MISSING | b4e855dec8bf104967cc27b592be4026df493e5d6749cd80ab8c16d5950d71d7 | ex0 up0 st0 x0 | **D** ADOPTION | same (Series B) |  |
| X080 | ASH | 0000950170-22-000508 | ash-ex3_1.htm | EX-3.1 | BYLAWS | MISSING | c427d9770a598409cf80a20a772fe44c1ae495924a337bbf3d0572b718f9556e | ex0 up0 st0 x0 | **E** LEGEND_NO_EFFECTIVE | "Amended and restated as of January 24, 2022" |  |
| X081 | ASH | 0000950170-22-018687 | ash-ex3_1.htm | EX-3.1 | BYLAWS | MISSING | f0559cbba84c912d7afe17973b568238c6b5281847fcb4c0e950b8e33cd06ad0 | ex0 up0 st0 x0 | **E** LEGEND_NO_EFFECTIVE | "Amended and restated as of September 20, 2022" |  |
| X082 | ASH | 0001193125-16-714093 | d246354dex32.htm | EX-3.2 | BYLAWS | MISSING | 0ecf0a75d11a43c5d4e114d12789dfd6c6b5eef7575f21c6f9f7aeb1f1c2987e | ex0 up0 st0 x0 | **E** LEGEND_NO_EFFECTIVE | "Amended and restated as of September 19, 2016" |  |
| X083 | ASH | 0001674862-16-000008 | a9302016exhibit32by-laws.htm | EX-3.2 | BYLAWS | MISSING | e41a97c63128e36b0fdbd04f4c834eadb5ca5e7fc0c2b2480b250905171f8f70 | ex0 up0 st0 x0 | **E** LEGEND_NO_EFFECTIVE | "Amended and restated as of September 19, 2016" |  |
| X084 | ASH | 0001674862-17-000083 | ex3_1.htm | EX-3.1 | BYLAWS | MISSING | 98f5ca63a368c03dbb9b3786e6b7c0189621c32cab5bff775f455a5c98702b3f | ex0 up0 st0 x0 | **E** LEGEND_NO_EFFECTIVE | "AMENDED AND RESTATED AS OF NOVEMBER 15, 2017" |  |
| X085 | AA | 0000950103-24-011378 | dp215750_ex0301.htm | EX-3.1 | CERTIFICATE_OF_DESIGNATION | MISSING | 6d54fdf4e38012eb823f0c892f829c0216e7cd0cb310525ce24cf8fffaf67a33 | ex0 up0 st0 x0 | **E** | conversion-rate "effective as of the date the Board ... determines" (no instrument date) |  |
| X086 | AA | 0001193125-26-077167 | aa-ex3_4.htm | EX-3.4 | CERTIFICATE_OF_DESIGNATION | MISSING | 6fd667382de45f07543997677c579a4b5e9f10b959795c469ee5fddeea582649 | ex0 up0 st0 x0 | **D** PRIOR | recital: certificate of designation filed July 31, 2024 |  |
| X087 | CI | 0000950159-20-000057 | ex3-1.htm | EX-3.1 | BYLAWS | MISSING | d10ba40b0506b2fc736a4ead3a469f0360069f8434843f4078a35087bd202f24 | ex0 up0 st0 x0 | **E** | no dated effectiveness/filing statement |  |
| X088 | CI | 0000950159-21-000343 | ex3-1.htm | EX-3.1 | BYLAWS | MISSING | af9da629aa99d79ff06f4785aed9da6b6417a94a44fd6299a56466e19e783266 | ex0 up0 st0 x0 | **E** | no dated effectiveness/filing statement |  |
| X089 | CI | 0000950159-22-000220 | ex3-2.htm | EX-3.2 | BYLAWS | MISSING | d1a250bea6c6fb57e3d2241d6dba5f619644b596944a17f804940d64d63fbc40 | ex0 up0 st0 x0 | **E** | no dated effectiveness/filing statement |  |
| X090 | CI | 0000950159-23-000019 | ex3-1.htm | EX-3.1 | CERTIFICATE_OF_AMENDMENT | MISSING | 81237abbf0e5c2142148a843a52ce2e25ca17568616ee6b8a278ab53cb26d5d5 | ex0 up0 st0 x0 | **A** TIME_BEFORE_DATE | "This Certificate of Amendment shall become effective at 8:00 a.m. Eastern Time on February 13, 2023" | 2023-02-13 |
| X091 | CI | 0000950159-23-000019 | ex3-3.htm | EX-3.3 | BYLAWS | MISSING | 756129f68fb18222d97d0eee3c1a9b884c7fd8f497312ed7af21b9aa3281450e | ex0 up0 st0 x0 | **E** | no dated effectiveness/filing statement |  |
| X092 | CI | 0001739940-21-000024 | exhibit31-2021_q3.htm | EX-3.1 | BYLAWS | MISSING | 6434b309d9bf2e8484a1619dbb608745368fbe5a844403ea3c892b689968aecc | ex0 up0 st0 x0 | **A** BARE_EFFECTIVE+BYLAWS | "Approved by the Board of Directors effective November 2, 2021." | 2021-11-02 |
| X093 | CI | 0001739940-22-000007 | exh32amendedandrestatedbyl.htm | EX-3.2 | BYLAWS | MISSING | ee6fd76321167d8ef60b474fd25a0bf2c66315937cbf3ff6b6984642a27df3ca | ex0 up0 st0 x0 | **E** | no dated effectiveness/filing statement |  |


## 10.38 B2 대상 class 연대기 관련성 재설계 census — proof authority ≠ chronology relevance — 2026-09-11

**설계 census 전용이다.** production 코드와 CLOSED 계약(O2 · O2-C · B2 · 탄생 · B1/P2/N1)을 하나도
바꾸지 않았다. R1 · R2는 **반사실 측정**이고 새 규칙을 설계하지 않았다.

```text
base (origin/main)   a3861a0b5cd1b9029aec3fcd8828636f0f8fa965
                     로컬에만 있던 cbcd431(P1-B6 memory research)은 trading/ · docs/trading/ 변경 0
inventory sha256     dc13cae6c9f375c2f1dea72a01da9bc16682d7298fcc2b24900d03feb5a8ceba   ✓
5A-2 output sha256   b68813def1f815c174ff454b89a6b198ddbac3eb6fe631ae1232f486b364cfc5   ✓
run_identity_sha256  sha256:52ff66d48ef3a1aecc620bd7aed2c5ec15112c57a5abd9d714667532c1165fda   ✓
network calls        3  (NWS Certificate of Elimination 1 · ASH 2022 Exhibit 3.1/3.2 2) · SHA 3/3
                     나머지 본문은 10.37이 SHA를 대조해 받은 스크래치 사본이고 R2 후보 6건은 다시 해시했다
```

**판정 주체.** 원문 판정은 전부 `MODEL_ASSISTED_SOURCE_TEXT_JUDGMENT`다 — 10.37의 231문서 판정을
그대로 쓰고, 이번에 새로 R2 후보 6 · ASH 2 · 일반 amendment 3(LW · WEC ×2)을 읽었다. primary-human
gold가 아니고 사람 adjudication도 human receipt도 없다.

### 1. corrected-O2 진단 baseline

```text
10.37 A  CURRENT_O2_EXPLICIT_DATE_PRESENT      원문 날짜를 반사실로 채운다
10.37 D  DATE_PRESENT_BUT_WRONG_ATTRIBUTION     그 날짜를 이 instrument의 것으로 쓰지 않는다
10.37 F  AMBIGUOUS                              미해결
10.37 E  SUPPORTED_DATE_NOT_STATED              무일자
현행 RESOLVED인데 10.37이 귀속 오류로 판정      무일자로 내린다
  NWS  0001193125-18-249117/d603651dex31.htm   합본 안 우선주 지정서의 발효일
  Q    0001193125-25-261603/d65598dex32.htm    다른 계약서(SDA)의 발효일
10.37이 읽지 않은 RESOLVED 문서                 저장값 그대로 (한계로 적는다)
```

**이것은 production O2 변경이 아니다.** 효과는 이렇다 — Q는 날짜 있는 anchor를 잃어 B2에 도달하지
못하고, NWS · NWSA는 10.37 A 판정 문서([099] · [101])의 2013-06-28 anchor를 유지하되 2018 합본이 무일자
RESTATED_CERTIFICATE 차단 문서가 된다.

### 2. 차단 population 재구성

```text
10.37 CURRENT-O2-recall 반사실 재현   22 work items · 고유 무일자 133 (BYLAWS 84 · 그 외 49)   정확히 일치
corrected-O2 baseline                21 work items · 고유 무일자 133 (BYLAWS 84 · 그 외 49)
                                     (Q의 [133] 차단이 빠지고 NWS 2018 합본이 들어온다)
```

### 3. 시뮬레이션 규칙

현행 `project_class_proof`의 탄생 단계 뒤 사슬을 그대로 따랐고 anchor 날짜가 탄생일 자리에 온다(10.36과
같다) — undated 관문 → snapshot 존재 · 같은 날짜 snapshot 둘 → snapshot과 같은 날 amendment → snapshot
뒤 amendment → current snapshot의 대상 class 정의 → anchor와 같은 날 · anchor 뒤 미해소 governing 문서.
**바뀐 것은 연대기 집합의 구성원뿐이다.** `OUT_OF_SCOPE` · `PROVEN_IRRELEVANT` 문서는 모든 연대기 검사에서
빠지고, 그 밖의 문서는 전부 `RELEVANT` 또는 `UNRESOLVED`로 남아 **현행과 똑같이 막는다.**

```text
R1  연대기 집합 = classification ∈ GOVERNING_CLASSIFICATIONS
    BYLAWS(NON_GOVERNING_FAMILIES) -> OUT_OF_SCOPE
R2  R1 + CERTIFICATE_OF_DESIGNATION · CERTIFICATE_OF_ELIMINATION에만 다섯 조건 검사
    전부 성립 -> PROVEN_IRRELEVANT · 하나라도 아니면 UNRESOLVED(fail-close)
    CERTIFICATE_OF_AMENDMENT · ARTICLES_OF_AMENDMENT에는 적용하지 않는다
```

21 item 안에 명시 종료 finding은 0이다(FDXF의 1건은 anchor 없는 item이다).

### 4. 결과

```text
                                   CORRECTED-O2 BASELINE        R1                          R2
work items reaching B2                    21                    21                          21
연대기 집합에서 빠진 문서                    0            OUT_OF_SCOPE 101            + PROVEN_IRRELEVANT 4 = 105
  그중 무일자                                0                    84                          87
residual 무일자 차단 (고유)                  133                    49                          46
work items through undated gate              0                     1  (ASH)                    1  (ASH)
work items B2-complete                       0                     0                           0
처음 실패한 B2 관문                   UNDATED 21     UNDATED 20 · SNAPSHOT_TIE 1      UNDATED 20 · SNAPSHOT_TIE 1
```

R1의 OUT_OF_SCOPE 101 = BYLAWS 무일자 84 + 날짜 있는 BYLAWS 17이다.

```text
Residual blockers by classification        R1    R2
AMENDED_AND_RESTATED_CERTIFICATE           10    10
AMENDED_AND_RESTATED_ARTICLES               5     5
RESTATED_CERTIFICATE                       12    12
RESTATED_ARTICLES                           0     0
CERTIFICATE_OF_AMENDMENT                   16    16
ARTICLES_OF_AMENDMENT                       2     2
CERTIFICATE_OF_DESIGNATION                  3     1
CERTIFICATE_OF_ELIMINATION                  1     0
other                                       0     0
합                                         49    46
```

```text
item     baseline   R1 무일자 · 관문         R2 무일자 · 관문         R2 residual 모양
AA          2       2 · UNDATED              1 · UNDATED              DESIGNATION(UNRESOLVED) 1
ASH         5       0 · SNAPSHOT_TIE         0 · SNAPSHOT_TIE         -
CI          7       2 · UNDATED              2 · UNDATED              snapshot 2
CPAY        9       5 · UNDATED              5 · UNDATED              snapshot 2 · amendment 3
DAL        15       1 · UNDATED              1 · UNDATED              amendment 1
FLT         9       5 · UNDATED              5 · UNDATED              snapshot 2 · amendment 3
FOX         3       3 · UNDATED              1 · UNDATED              snapshot 1
FOXA        3       3 · UNDATED              1 · UNDATED              snapshot 1
GOOGL       2       2 · UNDATED              2 · UNDATED              snapshot 2 (분류 오류, 아래 §7)
HII        11       3 · UNDATED              3 · UNDATED              snapshot 1 · amendment 2
HLT        10       3 · UNDATED              3 · UNDATED              snapshot 1 · amendment 2
LW          3       1 · UNDATED              1 · UNDATED              amendment 1
NWS         5       4 · UNDATED              4 · UNDATED              snapshot 3 · amendment 1
NWSA        5       4 · UNDATED              4 · UNDATED              snapshot 3 · amendment 1
TFCF        3       3 · UNDATED              1 · UNDATED              snapshot 1
TFCFA       3       3 · UNDATED              1 · UNDATED              snapshot 1
TSCO       19       7 · UNDATED              7 · UNDATED              snapshot 3 · amendment 4
VEEV        9       5 · UNDATED              5 · UNDATED              snapshot 5
VRSK        7       2 · UNDATED              2 · UNDATED              snapshot 2
WEC        11       2 · UNDATED              2 · UNDATED              amendment 2 (분류 오류, 아래 §7)
WST        15       7 · UNDATED              7 · UNDATED              snapshot 5 · amendment 2
```

#### 새로 undated 관문을 넘은 item — ASH (R1)

```text
그만 막게 된 문서 5건 — 전부 BYLAWS -> OUT_OF_SCOPE (10.37 판정 E)
  0000950170-22-000508/ash-ex3_1.htm
  0000950170-22-018687/ash-ex3_1.htm
  0001193125-16-714093/d246354dex32.htm
  0001674862-16-000008/a9302016exhibit32by-laws.htm
  0001674862-17-000083/ex3_1.htm
그 뒤 실패  SNAPSHOT_TIE — 0000950170-22-013666의 ash-ex3_1.htm · ash-ex3_2.htm가 둘 다
            AMENDED_AND_RESTATED_CERTIFICATE · 저장 RESOLVED 2022-08-01
```

두 문서를 받아 읽었다(SHA 2/2). **어느 쪽도 완전 snapshot이 아니다.**

```text
ash-ex3_1.htm  "CERTIFICATE OF OWNERSHIP AND MERGER MERGING ASHLAND CHEMCO INC. WITH AND INTO
               ASHLAND GLOBAL HOLDINGS INC." · block:19 "This Certificate of Ownership and Merger and the
               Merger shall become effective on August 1, 2022."   (날짜 귀속은 맞다)
ash-ex3_2.htm  "BY-LAWS OF ASHLAND INC." · block:18 각주 "... change of the name of the Corporation ...
               effective as of August 1, 2022"                       (bylaws다)
대상 "Common Stock" 정의 매치   둘 다 0
```

관문을 통과한 유일한 item이 **분류 오류 위에 서 있다.** tie를 가르더라도 current snapshot이 대상 class를
정의하지 않아 다음 관문에서 막히고, 올바르게 분류하면 ex3_2는 BYLAWS이고 ex3_1은 열거된 family가 아니어서
탐색 자체가 `classify` 실패로 INCOMPLETE가 된다. **어느 경로로도 B2-complete가 아니다.**

R2에서 새로 관문을 넘은 item은 0이다.

### 5. R2 원문 검토 — PROVEN_IRRELEVANT와 기각된 후보

조건 2는 production `associate_class_designation(표지 제목, 시리즈 이름)`으로만 봤고 결과가 전부
`NOT_ASSOCIATED`다. 조건 3은 production 정의/탄생/종료 문법을 대상 designation으로 다시 돌려 전부 0이고
저장 finding도 0이다. ticker · XBRL member · sibling 순서 · 유사도 · 이름 부재 추론을 쓰지 않았다 —
**근거는 시리즈를 명시로 지목한 operative resolution 문장이다.**

```text
AA · CIK 0001675149 · 0001193125-26-077167 · aa-ex3_4.htm · EX-3.4 · CERTIFICATE_OF_DESIGNATION
  target      Common Stock, par value $0.01 per share
  scoped      Series A Convertible Preferred Stock
  span        b9 "RESOLVED FURTHER, that the Board hereby cancels the Certificate of Designation and retires
              and eliminates all Series A Convertible Preferred Stock"
  capital     일반 자본구조 문언 없음 (Common Stock + 운영 어휘 block 0)
  state       PROVEN_IRRELEVANT · 무일자(10.37 D)
  rationale   제목부터 결의까지 그 시리즈의 지정서 취소에 한정된다

FOX · FOXA · TFCF · TFCFA · CIK 0001754301 · 0001193125-19-079678 · d721949dex33.htm · EX-3.3 · CERTIFICATE_OF_DESIGNATION
  target      Class A Common Stock, par value $0.01 per share · Class B Common Stock, par value $0.01 per share
  scoped      Series A Junior Participating Preferred Stock
  span        b9 "the Board hereby designates 1,000,000 shares of Preferred Stock, par value $0.01 per share,
              of the Corporation as "Series A Junior Participating Preferred Stock""
  capital     없음 — Common Stock 언급은 그 시리즈 조건의 조정 조항뿐이다(b41 "In the event the Corporation
              shall at any time ... subdivide the outstanding Common Stock ... then ... the Adjustment Number")
  state       PROVEN_IRRELEVANT · 무일자(10.37 D)
  rationale   조건부 조정 조항은 대상 class에 가해지는 operation이 아니다

FOX · FOXA · TFCF · TFCFA · CIK 0001754301 · 0001193125-19-296568 · d837035dex31.htm · EX-3.1 · CERTIFICATE_OF_ELIMINATION
  target      Class A / Class B Common Stock, par value $0.01 per share
  scoped      Series A Junior Participating Preferred Stock
  span        b12 "none of the authorized shares of Series A Junior Participating Preferred Stock are
              outstanding, and none will be issued" · b13 "to eliminate the Series A Junior Participating
              Preferred Stock"
  capital     없음 (block 0)
  state       PROVEN_IRRELEVANT · 무일자(10.37 D)

NWS · NWSA · CIK 0001564708 · 0001140361-21-032030 · brhc10029075_ex3-1.htm · EX-3.1 · CERTIFICATE_OF_ELIMINATION
  target      Class A / Class B Common Stock, par value $0.01 per share
  scoped      Series A Junior Participating Preferred Stock
  span        b12 FOX와 같은 결의 문언
  capital     없음 (block 0)
  state       PROVEN_IRRELEVANT · 저장 RESOLVED 2021-09-22 (이번에 귀속을 감사하지 않았다 — 빠지므로 결과에 무관)

Q · CIK 0002058873 · 0001193125-25-261603 · d65598dex31.htm · EX-3.1 · CERTIFICATE_OF_DESIGNATION
  target      Common Stock, par value $0.01 per share
  scoped      Series A Preferred Stock
  span        b9 "The shares of such series of Preferred Stock shall be designated as "Series A Preferred Stock""
  capital     없음 (block 0)
  state       PROVEN_IRRELEVANT — 그러나 Q는 corrected baseline에서 anchor가 없어 funnel 밖이다(수치 영향 0)

기각 — AA · CIK 0001675149 · 0000950103-24-011378 · dp215750_ex0301.htm · EX-3.1 · CERTIFICATE_OF_DESIGNATION
  scoped      Series A Convertible Preferred Stock (조건 1–3 성립)
  조건 4 실패  b114 "CITIC shall be entitled ... to surrender Common Stock to the Corporation in exchange for
              the delivery to CITIC of a number of shares of such Non-Voting Preferred Stock" ·
              b66 "... will be converted into a number of fully-paid and non-assessable shares of Common Stock"
  state       UNRESOLVED -> fail-close
  rationale   발행된 대상 class 주식을 그 시리즈와 맞바꾸는 operation이 시리즈 범위를 넘는다
```

조건 4의 경계는 **판정이지 규칙이 아니다** — "대상 class에 조건부로 반응하는 조정 조항"은 operation으로
세지 않았고 "발행된 대상 class 주식을 옮기는 교환 · 전환 기제"는 셌다.

### 6. 보존된 B2 불변식

```text
탐색 INCOMPLETE는 fail-close              모집단이 탐색 COMPLETE item뿐이고 통과로 세지 않았다
법적 발효일만 순서를 세운다                SEC acceptance를 어디에도 쓰지 않았다
무일자 RELEVANT 문서는 막는다              snapshot · 일반 amendment 46건이 그대로 막는다
UNRESOLVED 관련성은 막는다                 일반 amendment 전부 · AA 2024 지정서
amendment를 snapshot으로 올리지 않는다     snapshot 뒤 amendment 규칙 그대로
대상 이름 부재는 아무것도 증명하지 않는다  이름이 없다는 이유로 빠진 문서 0
같은 날짜 순서 모호는 fail-close           ASH tie를 그대로 실패로 셌다
명시 종료 · 탄생 · B1/P2/N1                변경 없음
```

`OpenEndedContinuityTest`의 기대(`test_an_incomplete_amendment_search_never_produces_null` ·
`test_an_amendment_after_the_latest_snapshot_blocks_null` ·
`test_a_later_amendment_repeating_the_definition_does_not_make_it_current` ·
`test_legal_order_beats_sec_acceptance_order` · `test_two_snapshots_on_the_same_operative_date_fail_closed` ·
`test_an_amendment_tied_with_the_snapshot_date_fails_closed` · 무일자 snapshot/amendment 두 테스트)는 개념
불변식으로 유지된다. 테스트를 돌리거나 고치지 않았다.

### 7. 관측된 분류 오류 — 민감도이지 시나리오가 아니다

**R1은 권한의 근거를 TYPE에서 classifier 출력으로 옮긴다.** 그래서 분류가 틀리면 R1도 틀린다. 이번
funnel의 연대기 집합에서 원문으로 읽은 문서 중 분류가 틀린 것은 8건이다.

```text
FLT    0001628280-22-017144/flt-bylaws2022bdmeeting.htm   bylaws                        -> AMENDED_AND_RESTATED_CERTIFICATE
ASH    0000950170-22-013666/ash-ex3_2.htm                 bylaws                        -> AMENDED_AND_RESTATED_CERTIFICATE
ASH    0000950170-22-013666/ash-ex3_1.htm                 Certificate of Ownership and Merger -> AMENDED_AND_RESTATED_CERTIFICATE
GOOGL  0001193125-26-259830/d36818dex31.htm · dex32.htm  Certificate of Designations ×2 -> AMENDED_AND_RESTATED_CERTIFICATE
VEEV   0001393052-23-000055/certificateofretiremento.htm Certificate of Retirement of Class B Common Stock -> AMENDED_AND_RESTATED_CERTIFICATE
WEC    0000107815-00-000004 · 0000107815-00-000009 seq:2  bylaws ×2                     -> ARTICLES_OF_AMENDMENT
```

그 8건만 바로잡아 R1 · R2를 다시 돌리면(나머지는 저장 분류 그대로):

```text
CPAY · FLT   무일자 5 -> 4, 여전히 UNDATED
WEC          무일자 2 -> 0, 관문 통과 -> LATER_AMENDMENT (2012 snapshot 뒤 2015 · 2024 Articles of Amendment)
ASH · VEEV   열거 family 밖 문서 -> classify 실패 -> 탐색 INCOMPLETE
B2-complete  0
```

GOOGL의 두 지정서는 올바르게 분류되면 R2 대상이 된다. 시리즈(`6.25% Series A/B Mandatory Convertible
Preferred Stock`)는 대상 `Class A Common Stock`과 `NOT_ASSOCIATED`이지만 Class A Common Stock으로의 의무
전환 조건을 가져 AA 2024 지정서와 같은 모양이다 — 같은 판정이면 UNRESOLVED다(조건 4를 끝까지 검토하지
않았다).

### 8. 질문 4를 위한 상한 진단 — 규칙이 아니다

R2에 더해 **모든** CERTIFICATE_OF_AMENDMENT · ARTICLES_OF_AMENDMENT를 연대기 집합에서 뺀다. 이것은 금지된
"이름 부재" 추론보다도 넓은 **unsafe 상한**이고 오직 크기를 재려고 돌렸다.

```text
                                  저장 분류                              관측 분류 오류 8건 교정
UNDATED                                17                                    16
SNAPSHOT_TIE                            2  (ASH · DAL)                        1  (DAL)
탐색 INCOMPLETE (classify)              -                                     2  (ASH · VEEV)
B2-complete                             2  (LW · WEC)                         2  (LW · WEC)
```

그 두 B2-complete를 원문으로 확인했다.

```text
LW   [119] 0001679273-24-000064/lw-202409278kxex31.htm
     "1. Article VIII of the Amended and Restated Certificate of Incorporation is hereby amended to read in
     its entirety as follows: "ARTICLE VIII LIMITATION OF LIABILITY ...""
     -> 명시로 지목된 조항 하나를 책임 제한 문언으로 바꾼다. 대상 class 연대기와 무관해 보이는 실례다.
WEC  X024 0000107815-24-000203/a2024q2wec10qexhibit31.htm
     "2. Article III(A) of the Restated Articles of Incorporation ... is hereby amended to read in its
     entirety ... 650,000,000 shares of Common Stock of the par value of One Cent ($.01) per share"
     -> 대상 class의 수권 구조를 다시 쓴다. RELEVANT다. 상한이 WEC를 통과시킨 것은 틀렸다.
     X025 0001104659-15-048374/a15-14883_1ex3d1.htm — Article I(법인 이름)만 바꾼다.
DAL  같은 2007 A&R certificate가 2007 · 2009에 두 번 제출돼 같은 법적 날짜의 snapshot 둘 -> tie fail-close.
```

**일괄 제외는 실제로 틀린 통과(WEC)를 만든다.** 상한에서 정당해 보이는 item은 LW 하나다.

### 답

1. **NON_GOVERNING 분리가 커버리지를 바꾸나 — 아니다.** 차단 문서는 133 -> 49로 크게 줄지만 undated 관문
   통과는 0 -> 1(ASH)이고 B2-complete는 0 -> 0이다. 그 한 건도 분류 오류 위에 서 있다.
2. **좁은 다른-시리즈 범위 증명이 R1 너머를 바꾸나 — 아니다.** PROVEN_IRRELEVANT 4(funnel 안) · residual
   49 -> 46 · 새 통과 0 · B2-complete 0이다. FOX 계열은 지정서 · 소거증서가 빠져도 무일자 2023 A&R
   certificate가 남고, AA는 교환 조건 때문에 2024 지정서가 UNRESOLVED로 남는다.
3. **R2 뒤 지배적 residual은 무일자 완전 snapshot이다.** AMENDED_AND_RESTATED_CERTIFICATE 10 ·
   AMENDED_AND_RESTATED_ARTICLES 5 · RESTATED_CERTIFICATE 12 = 27 / 46(59%)이고 21 item 중 16이 그것을
   하나 이상 가진다. 완전 snapshot은 정의상 RELEVANT라 **관련성 규칙으로는 빠지지 않는다** — 법적 발효일
   (10.37의 원문 부재 · 귀속 문제)이 필요하다. 다음이 일반 amendment 18(39%)이다.
4. **일반 amendment 무관성 지원이 필요한가 — 필요하지만 충분하지 않다.** residual이 일반 amendment뿐인
   item은 3(DAL · LW · WEC)이고 WEC의 둘은 분류 오류 bylaws다. unsafe 상한에서도 B2-complete는 2이고 그중
   WEC는 원문상 틀렸다. 16 item은 어떤 amendment 규칙과도 무관하게 무일자 snapshot에서 막힌다.
5. **이름 부재 없이 일반 amendment의 범위를 증명하려면 필요한 증거** (규칙을 설계하지 않는다)
   - instrument 자신의 operative clause가 바뀌는 **조항을 명시로 열거**하고(`Article VIII ... is hereby
     amended to read in its entirety`), 그 밖에 operative clause가 없다는 것이 문서 구조로 닫혀야 한다.
   - 그 조항 번호가 **날짜 있는 current 완전 snapshot의 조항 지도에서** 자본구조 조항이 아닌 조항을
     가리킨다는 양성 증거 — 교체 문언에서 대상 이름을 못 찾았다는 것이 아니다. WEC 2024처럼 교체 조항이
     수권 구조(`Authorized Number and Classes of Shares`)면 RELEVANT다.
   - 부속 문서(`as set forth in Exhibit A`)나 결의 인용으로 범위를 넓히는 문언이 없거나, 있으면 그것까지
     읽혀야 한다.
   - 법인 이름만 바꾸는 조항(WEC 2015 Article I)도 같은 조항 지도 증거가 필요하다.
   - 어느 하나라도 닫히지 않으면 UNRESOLVED다.

### 9. O2 correctness note

production O2에는 **알려진 subject-attribution 실패가 있다.**

```text
NWS   0001193125-18-249117/d603651dex31.htm   합본 안 우선주 지정서의 발효일을 restated certificate의 날짜로 RESOLVED
Q     0001193125-25-261603/d65598dex32.htm    다른 계약서(Separation and Distribution Agreement)의 발효일로 RESOLVED
FDXF  0001104659-26-068521/tm2615735d1_ex3-2.htm  선행 amendment의 "filed ... effective on" 날짜를 함께 받아 AMBIGUOUS
```

이 census는 그것을 진단용으로 내렸을 뿐 고치지 않았다.

**B2 production 구현은 O2 subject-attribution 버그에 회귀 테스트로 잠긴 수정이 있기 전에는 진행하지
않는다.** 관련성 재설계는 연대기 집합을 줄이므로 남은 문서 하나하나의 날짜가 결과를 직접 정한다 — 틀린
날짜 하나가 틀린 open-ended 구간을 만든다.

### 범위

```text
production code changed          NO
O2 / O2-C changed                NO
B2 changed                       NO
birth changed                    NO
B1 / P2 / N1 changed             NO
Option A implemented             NO
bundle changed                   NO
manifest changed                 NO
full 897 rerun                   NO   (bounded exact refetch 3회)
promotion / 5A-3 / Gates         NO
returns / ranking / portfolio    NO
```

받은 SEC 본문과 분석 스크립트는 스크래치에 두고 커밋하지 않는다.


## 10.39 Regulation S-K Item 601 current-state observation probe — 10-K가 "현재 유효한 정관"을 증언하는가 — 2026-09-11

**작은 source/structure viability probe다.** production 코드와 CLOSED 계약(O2 · O2-C · B2 · 탄생 ·
B1/P2/N1 · class-id · bundle · manifest · `RelationInterval`)을 바꾸지 않았고 Option A를 구현하지 않았다.
새 사실 `REGULATORY_CURRENT_STATE_OBSERVATION`은 **법적 발효일도 탄생도 아니다** — 이 probe가 재는 것은
`CURRENT_AT_OBSERVATION(target class, charter state, SEC filing observation time)`이 historical 10-K에서
결정론적으로 뽑히는지와 얼마나 자주 formation 앞에 있는지뿐이다.

```text
base (origin/main)   0b52f97b9f0fe4946a8609d3e65581d305775546   (QV 코드·문서 이동 없음)
inventory sha256     dc13cae6c9f375c2f1dea72a01da9bc16682d7298fcc2b24900d03feb5a8ceba   ✓
5A-2 output sha256   b68813def1f815c174ff454b89a6b198ddbac3eb6fe631ae1232f486b364cfc5   ✓
run_identity_sha256  sha256:52ff66d48ef3a1aecc620bd7aed2c5ec15112c57a5abd9d714667532c1165fda   ✓
authority set        Form 10-K · 10-K/A 뿐 (10-Q · S-1 · S-3 · proxy · 주 등록부는 넣지 않았다)
```

열린 correctness 문제(O2 subject attribution · 10.38의 classifier false positive)는 고치지 않았고 그 출력을
권위로 쓰지 않았다 — 이 probe는 charter의 O2 날짜를 한 번도 읽지 않는다.

### 근거 구분

```text
OFFICIAL_SEC_RULE_BASIS    Regulation S-K Item 601(b)(3)(i) "as currently in effect" · 8-K에 amendment 문언만
                           보고한 뒤 다음 해당 정기보고서/등록서류에 complete copy · Corp Fin C&DI 246.01 ·
                           Form 8-K Item 5.03의 보고 조건(proxy/information statement로 이미 공시한 제안 제외)
                           — 과제 지시문이 제시한 근거다. 이 probe에서 규칙 원문을 다시 받아 대조하지 않았다.
DETERMINISTIC              표본 선정 · submissions 행 · exhibit index 행 추출 · 행 유형 · 참조 해석 · SHA ·
                           production classify_document / resolve_class_association · 세션 수 · 틈 진단 · bracketing
MODEL_ASSISTED_SOURCE_TEXT_JUDGMENT
                           TRMB · AME 불일치 원인 · WST 사례 해석 · 추출기 누락 식별. 사람 판정이 아니다.
DIAGNOSTIC_INFERENCE       아래 "답" 5 · 6
```

### 표본 — 36 formation point

```text
eligible item     exact cover association(10.36의 528) 중 saved proof에 대상 class와 연결된
                  GOVERNING_CLASS_DEFINITION이 하나 이상 있는 item — 151
                  (production ClassEvidence는 전 population에서 0이라 "ClassEvidence 없음"은 자동 성립)
formation point   그 item의 demanded_formation_sessions · 연도로 층을 나눈다
                  2010–2014 373 · 2015–2020 556 · 2021–2026 604
order key         sha256("qv-5a2-item601-probe-v1|" + member_symbol + "|" + identity_symbol + "|" + formation_session)
선정              층마다 order key 오름차순 앞 12개 (CIK 중복 배제 없음)
결과              36 case · 33 CIK (MCD · CTSH · TXT가 두 번씩)
```

### 관측 filing 선택 규칙

```text
PRE   acceptance Eastern date < formation인 10-K · 10-K/A 중 가장 늦은 것 하나.
      그것이 10-K/A이고 exhibit index에 charter 행이 없으면 가장 늦은 원본 10-K 하나로만 물러난다(WM 1건).
POST  acceptance Eastern date ≥ formation인 첫 10-K · 10-K/A (같은 물러남 규칙).
      더 거슬러 올라가거나 다른 form을 보지 않는다.
```

### network

```text
requests 179 · distinct URL 172 · 표본 CIK 33 밖 요청 0 · population crawl 없음
  submissions recent 33 · archive 46
  10-K primary document · charter document 85
  accession header index 11   (전부 HTTP 404 · 고유 URL 4)
  complete submission 4
deviation  실패 응답을 캐시에 남기지 않아 같은 404 header index URL 4개가 추출기 재실행과 pre/post에서
           7번 더 요청됐다. 자동 retry 루프는 아니었지만 "요청은 한 번" 원칙에서 벗어났다. 결과는 같다.
```

### 추출기 개발 이력 — 낙관 편향을 적는다

추출기는 이 36건을 보면서 세 번 고쳤다.

```text
v1  표 행 파서
v2  여러 셀로 쪼개진 번호 조립 ("(3)" "(a)" · "3" ".1" · "3-1" · "EXHIBIT 3" "(a)")
v3  괄호 번호 "(3.1)" · 문자 부속 번호 "3.A" · 표 footnote 뒤에 가려진 문단 목록 ·
    "06/30/95 Form 10-Q" 기간 표기 · header index 404일 때 production _accession_layout과 같은
    complete submission 분해
```

**같은 표본을 보며 고쳤으므로 아래 추출 성공률은 처음 보는 10-K에 대해 낙관적이다.** 자격 규칙(단일
charter 행 · 모호하면 fail-close · 한 hop)은 반복 중 완화하지 않았다.

### ITEM 601 EXTRACTION — PRE 36

```text
qualifying current-state observations     12   early 2 · mid 4 · late 6
no qualifying 10-K                          1   BEAM_OLD — 선택 CIK(2018 설립 Beam Therapeutics)에 2012 이전 10-K가 없다
exhibit-index parse failure                 0   관측 filing 35개 전부에서 Exhibit 3 행을 뽑았다(v3 기준)
incorporated-by-reference (qualifying)     12
directly filed (qualifying)                 0
ambiguous/composite charter                17
  charter + amendment 행                   10
  charter + amendment + designation         2
  charter + amendment + elimination         1
  charter 행 여럿 (다중 등록인 AEP · EXC)    2
  charter + certificate of merger (CPAY)    1
  charter + other-series 행만 (NWS)          1   그 행을 제쳤다면 자격을 얻는다
unresolved reference                        4   MCD ×2 참조에 exhibit 번호가 없다 · TDC "8-K dated" 날짜가 제출일인지
                                                사건일인지 정해지지 않아 일치 0 · SWN 가리킨 8-K에 TYPE EX-3.1 0
target definition absent                    0
classification/source mismatch              2   TRMB · AME
```

qualifying 12의 참조 방식은 **hyperlink 9**(2019–2025 filing)와 **같은 CIK의 form + 제출일/기간 metadata 한
hop + exhibit TYPE 3**(XYL · WEC · SWKS, 2011–2015 filing)이다. 두 번째 hop이 필요한 사례는 없었고, 회사 이름
· fuzzy 문서 매칭은 쓰지 않았다.

해석된 charter 본문은 **고유 16문서이고 전부 5A-2 receipt에 이미 있었으며 SHA가 전부 일치한다.** XYL · SWKS는
complete submission `<TEXT>` payload의 SHA가 파일 SHA와 달라 exact file URL로 다시 받아 대조했다(2회) — 표현
차이이지 provenance 차이가 아니다. 5A-2 밖에서 새로 따라간 문서는 0이다.

**불일치 2건 (MODEL_ASSISTED_SOURCE_TEXT_JUDGMENT).**

```text
TRMB  hyperlink ex3-1.htm = 델라웨어 주가 인증한 원 "CERTIFICATE OF INCORPORATION OF TRIMBLE INC." — 완전한 charter다.
      production classifier에 plain certificate-of-incorporation family가 없어 본문의 by-laws 언급으로 BYLAWS가 됐다
      (false positive). production 정의 문법도 "authorized to issue two classes of shares to be designated
      respectively Preferred Stock ... and Common Stock"을 받지 못해 정의 0이다.
AME   행 설명은 "Conformed Copy of Amended and Restated Certificate of Incorporation ... as amended to and
      including May 9, 2019"인데 hyperlink가 가리키는 문서는 "CERTIFICATE OF AMENDMENT TO THE AMENDED AND
      RESTATED CERTIFICATE OF INCORPORATION"(Article SEVENTH만 교체)이다. classifier가 맞다 — 10-K의 exhibit
      index 설명과 그 링크 대상이 서로 다르다.
```

### FORMATION DIAGNOSTIC — qualifying 12

```text
observation before formation              12 / 12 (선택 규칙상)
first_regular_session_after_observation   production _historical_usable_session
                                          (SPY eodhd/eodhd-15y-2026-08 · acceptance Eastern date 다음 첫 세션)
session gap                               [first session, formation) 안의 SPY 세션 수
gaps                                      84 85 86 88 89 90 92 94 94 96 97 102
median                                    91
p90                                       97 (nearest-rank)
```

```text
틈 진단 (관측 accept < t, t의 Eastern date < formation · 이미 알려진 SEC 증거만)
no known charter/governing candidate in gap        11
Item 5.03 filing in gap                             1   CMG (bylaws 8-K)
target-class finding in gap                         0
other-series-only positive scope                    0
bylaws-only                                         1   CMG
unresolved governing document                       0
later current-state observation before formation    0   (WM의 10-K/A 1건은 exhibit index가 없다)
classification ambiguity/error                      0
틈 증거가 legal search INCOMPLETE item에서 온 것     7 / 12
```

**"no Item 5.03"은 연속성 증거가 아니다 — 이 표본에 실례가 있다.**

```text
WST  PRE  0000105770-20-000015 (10-K, 2020-02-21) -> 2015 A&R Articles(ex31amendedarticles.htm)가 current
     POST 0000105770-21-000008 (10-K, 2021-02-23) -> 2020 A&R Articles(ex31articlesofincorpor.htm)가 current
     새 articles 본문: "(Effective as of May 5, 2020)"   (10.37 anchor 귀속 감사)
     formation 2020-06-30
     틈 안: Item 5.03 8-K 0 · legal search COMPLETE · 새 articles의 첫 SEC 수리는 10-Q 2020-07-24(formation 뒤)
```

2월 10-K가 current라고 말한 charter는 **formation 전인 5월 5일에 이미 바뀌었다.** 그런데 틈 진단은
"no known governing candidate"라고 셌다 — Item 5.03도 없고, 새 문서의 SEC 수리는 formation 뒤이기 때문이다.
대상 class 이름과 액면가(Common Stock · $0.25)는 그대로였지만 **charter 상태는 달랐다.**

### BRACKETING — qualifying 12

```text
post-formation qualifying observation available   12
exact same referenced charter SHA                 11
different referenced charter SHA                   1   WST
same target designation / par                     12
changed target designation / par                   0
unresolved                                         0
```

같은 SHA 11건은 **두 관측 사이에 일시적 변경이 없었다는 증명이 아니다.** WST처럼 틈 안의 변경은 SEC
증거로 보이지 않을 수 있고, 바뀌었다 되돌아간 상태는 bracketing이 원리상 볼 수 없다.

POST 쪽 전체 분포는 QUALIFYING 12 · composite 17 · unresolved 4 · mismatch 2 · 10-K 없음 1(WAT, formation
2026-06-30 뒤 10-K 미제출)이다.

### DOWNSTREAM

```text
PRIOR_DECEMBER_CHECK = NOT_MEASURABLE
```

formation → December valuation session D를 만드는 canonical helper가 없다. `qv_selector.s1_window()`는 D를
인자로 받고 `june_formation_sessions()`는 6월만 만든다. 새 달력 규칙을 만들지 않았고 share fact를
materialize하지 않았다.

### 답

1. **historical 10-K에서 Item 601 current-state 관측을 결정론적으로 뽑을 수 있나 — 조건부로 그렇다.** 관측
   filing 35개 전부에서 Exhibit 3 행을 뽑았고, 단일 charter 행 구조 18건 중 14건이 정확한 SEC 자연키로
   풀렸다. 다만 exhibit index 모양이 filing마다 달라(분할 셀 · `(3)(a)` · `3-1` · 다중 등록인) 추출기를 이
   표본으로 세 번 고쳐야 했다. 2019년 이후 hyperlink 행은 안정적이고, 그 이전 텍스트 참조가 약하다.
2. **incorporation-by-reference를 휴리스틱 없이 풀 수 있나 — 대부분 그렇지만 전부는 아니다.** hyperlink 9건은
   자연키가 URL에 그대로 있다. 텍스트 참조는 같은 CIK의 form + 제출일/기간 + exhibit TYPE으로 3건이 풀렸고
   4건은 fail-close했다(exhibit 번호 없음 2 · "dated"의 제출일/사건일 모호 1 · TYPE 없음 1). **hyperlink도
   설명과 다른 문서를 가리킬 수 있다(AME)** — 설명 ↔ 대상 일치 확인이 따로 필요하다.
3. **formation 앞에 자격 있는 관측이 얼마나 자주 있나 — 36 중 12(early 2/12 · mid 4/12 · late 6/12).**
   가장 큰 손실은 빈도가 아니라 **composite 구조(17/36)**다 — 기본 charter와 amendment들을 따로 나열하는
   exhibit index는 흔하고, "단일 charter 행" 규칙이 그것을 전부 떨어뜨린다.
4. **formation보다 얼마나 앞서나 — 중앙값 91 세션 · p90 97 세션.** 12월 결산 10-K(2월)에서 6월 formation까지의
   거리다.
5. **CURRENT_AT_OBSERVATION → proved-valid-segment 연속성 계약을 설계할 만큼 잦은가 — 문턱으로 답하지 않고
   증거를 적는다.** 자격 관측은 formation 앞에 3분의 1에서 있고 formation 시점에 약 91 세션 묵어 있다.
   12건 중 1건(WST)은 그 틈 안에서 charter가 법적으로 바뀌었는데 Item 5.03도 formation 전 SEC 수리 문서도
   없었다. composite 구조가 빈도보다 큰 장벽이고, 그것을 쓰려면 "기본 charter + 나열된 amendment = 현재
   상태" 해석 계약이 따로 필요하다. bracketing은 11/12가 같은 SHA이지만 틈 안의 변경을 배제하지 못한다.
6. **점 관측을 세션 구간으로 만들려면 무엇이 더 필요한가.** SEC acceptance를 법적 시점으로 바꾸지 않는다는
   전제에서:
   - **틈 안 charter 변경의 완전한 원장.** Item 5.03은 원장이 아니다(WST). proxy/information statement의 승인
     공시와 주 등록부 제출 기록이 후보이지만 이 probe의 authority set 밖이다.
   - **틈을 줄이는 중간 관측.** 10-Q exhibit index가 Item 601(b)(3) current-state 표현을 싣는지는 이 probe가
     확인하지 않았다.
   - **관측 앞쪽 경계.** 관측은 acceptance 다음 첫 세션부터만 알 수 있다. 그 전 세션의 유효성은 charter 자신의
     법적 발효일(O2)이 필요하고, O2는 subject-attribution 수리가 먼저다.
   - **composite 상태 해석 계약**과 **exhibit 설명 ↔ 대상 문서 일치 확인**.
   - **classifier 적용 범위** — plain certificate of incorporation · conformed copy(TRMB · AME).

### 범위

```text
production code changed          NO
O2 / O2-C · B2 · birth changed   NO
B1 / P2 / N1 · class-id          NO
Option A · bundle v4             NO
RelationInterval semantics       NO   (관측을 어떤 구간에도 쓰지 않았다)
manifest · promotion             NO
5A-3 · Gates                     NO
returns / rankings / portfolio   NO
full 897 crawl                   NO   (표본 CIK 33만 · 179 요청)
```

받은 SEC 본문과 분석 스크립트는 스크래치에 두고 커밋하지 않는다.

## 10.39-A 행 단위 감사 — 36 formation point

`gap`은 `[first session after, formation)`의 SPY 세션 수다. `= 5A-2`는 charter 본문 SHA가 5A-2 기록의
`document_sha256`과 같은지다. `bracket`은 PRE가 QUALIFYING일 때만 채운다. 판정은 전부 DETERMINISTIC이고,
TRMB · AME의 원인 해석과 WST 해석만 위 절의 MODEL_ASSISTED_SOURCE_TEXT_JUDGMENT다.

| # | stratum | item | formation | CIK | 5A-2 stage | PRE 10-K observation (accession · form · acceptance) | first session after | gap | exhibit row | reference | charter natural key | charter SHA-256 | = 5A-2 | classification | target assoc | PRE outcome | gap diagnostics | POST outcome · charter | bracket |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 01 | early | NFLX/NFLX | 2014-06-30 | 0001065280 | NO_DATED_ANCHOR | 0001065280-14-000006 · 10-K · 2014-02-01T00:14:52.000000Z | 2014-02-03 | 102 |  |  |  |  |  |  |  | **AMBIGUOUS_COMPOSITE** CHARTER_PLUS_AMENDMENT_ELIMINATION | no_known_governing_candidate=1 · search COMPLETE | AMBIGUOUS_COMPOSITE CHARTER_PLUS_AMENDMENT · 0001065280-15-000006 |  |
| 02 | early | XYL/XYL | 2012-06-29 | 0001524472 | NO_DATED_ANCHOR | 0001193125-12-084766 · 10-K · 2012-02-28T19:43:15.000000Z | 2012-02-29 | 85 | (3.1) | TEXT_METADATA+COMPLETE_SUBMISSION · INCORPORATED | 0000950123-11-089760/y93081exv3w1.htm | 8914c2ff92a2ed462a0d0656c0888de75a4af6275951abaae443d81484621637 | True | AMENDED_AND_RESTATED_ARTICLES | NUMERIC_PAR_VALUE_SUFFIX | **QUALIFYING** | no_known_governing_candidate=1 · search COMPLETE | QUALIFYING · 0001524472-13-000003 · 0000950123-11-089760/y93081exv3w1.htm | SAME_SHA |
| 03 | early | MCD/MCD | 2010-06-30 | 0000063908 | SEARCH_INCOMPLETE | 0001193125-10-042025 · 10-K · 2010-02-26T15:45:54.000000Z | 2010-03-01 | 85 | (3) (a) | TEXT · form=8-K exhibit=None date=1998-04-17 |  |  |  |  |  | **UNRESOLVED_REFERENCE** | no_known_governing_candidate=1 · search INCOMPLETE | UNRESOLVED_REFERENCE · 0001193125-11-046701 |  |
| 04 | early | CTSH/CTSH | 2011-06-30 | 0001058290 | SEARCH_INCOMPLETE | 0001193125-11-043696 · 10-K · 2011-02-23T22:01:58.000000Z | 2011-02-24 | 88 |  |  |  |  |  |  |  | **AMBIGUOUS_COMPOSITE** CHARTER_PLUS_AMENDMENT | target_class_finding=1, bylaws=1 · search INCOMPLETE | AMBIGUOUS_COMPOSITE CHARTER_PLUS_AMENDMENT · 0001193125-12-081638 |  |
| 05 | early | ANF/ANF | 2010-06-30 | 0001018840 | NO_DATED_ANCHOR | 0000950123-10-029409 · 10-K · 2010-03-29T20:03:20.000000Z | 2010-03-30 | 64 |  |  |  |  |  |  |  | **AMBIGUOUS_COMPOSITE** CHARTER_PLUS_AMENDMENT_DESIGNATION | no_known_governing_candidate=1 · search COMPLETE | AMBIGUOUS_COMPOSITE CHARTER_PLUS_AMENDMENT_DESIGNATION · 0000950123-11-030172 |  |
| 06 | early | AEP/AEP | 2014-06-30 | 0000004904 | SEARCH_INCOMPLETE | 0000004904-14-000019 · 10-K · 2014-02-25T19:26:50.000000Z | 2014-02-26 | 86 |  |  |  |  |  |  |  | **AMBIGUOUS_COMPOSITE** MULTIPLE_CHARTER_ROWS | no_known_governing_candidate=1 · search INCOMPLETE | AMBIGUOUS_COMPOSITE MULTIPLE_CHARTER_ROWS · 0000004904-15-000008 |  |
| 07 | early | WEC/WEC | 2011-06-30 | 0000783325 | NO_DATED_ANCHOR | 0000107815-11-000028 · 10-K · 2011-02-25T16:08:30.000000Z | 2011-02-28 | 86 | 3.1* | TEXT_METADATA+COMPLETE_SUBMISSION · INCORPORATED | 0000107815-95-000020/seq:2 | 84af5bab65f78be3a289b7da03ae565105d6d1aceae8cc04e9454c52b6e986e8 | True | RESTATED_ARTICLES | NUMERIC_PAR_VALUE_SUFFIX | **QUALIFYING** | no_known_governing_candidate=1 · search COMPLETE | QUALIFYING · 0000107815-12-000039 · 0000107815-95-000020/seq:2 | SAME_SHA |
| 08 | early | BEAM_OLD/BEAM | 2012-06-29 | 0001745999 | NO_DATED_ANCHOR | — | — | — |  |  |  |  |  |  |  | **NO_QUALIFYING_10K** no 10-K/10-K-A on that side of formation under this CIK |  | AMBIGUOUS_COMPOSITE CHARTER_PLUS_AMENDMENT · 0001564590-20-014308 |  |
| 09 | early | MCD/MCD | 2014-06-30 | 0000063908 | SEARCH_INCOMPLETE | 0000063908-14-000019 · 10-K · 2014-02-24T18:26:44.000000Z | 2014-02-25 | 87 | (3)(a) | TEXT · form=10-Q exhibit=None date=2012-06-30 |  |  |  |  |  | **UNRESOLVED_REFERENCE** | no_known_governing_candidate=1 · search INCOMPLETE | UNRESOLVED_REFERENCE · 0000063908-15-000016 |  |
| 10 | early | CTSH/CTSH | 2010-06-30 | 0001058290 | SEARCH_INCOMPLETE | 0001193125-10-040500 · 10-K · 2010-02-25T20:07:06.000000Z | 2010-02-26 | 86 |  |  |  |  |  |  |  | **AMBIGUOUS_COMPOSITE** CHARTER_PLUS_AMENDMENT | no_known_governing_candidate=1 · search INCOMPLETE | AMBIGUOUS_COMPOSITE CHARTER_PLUS_AMENDMENT · 0001193125-11-043696 |  |
| 11 | early | TXT/TXT | 2013-06-28 | 0000217346 | NO_DATED_ANCHOR | 0001104659-13-011048 · 10-K · 2013-02-15T11:06:55.000000Z | 2013-02-19 | 91 |  |  |  |  |  |  |  | **AMBIGUOUS_COMPOSITE** CHARTER_PLUS_AMENDMENT | no_known_governing_candidate=1 · search COMPLETE | AMBIGUOUS_COMPOSITE CHARTER_PLUS_AMENDMENT · 0001104659-14-009908 |  |
| 12 | early | SWN/SWN | 2012-06-29 | 0000007332 | SEARCH_INCOMPLETE | 0000007332-12-000003 · 10-K · 2012-02-27T18:06:56.000000Z | 2012-02-28 | 86 | 3.1 | TEXT_METADATA+COMPLETE_SUBMISSION · INCORPORATED · exhibit ('3', '1') TYPE matches=0 |  |  |  |  |  | **UNRESOLVED_REFERENCE** | item_503_in_gap=1 · search INCOMPLETE | UNRESOLVED_REFERENCE · 0000007332-13-000007 |  |
| 13 | mid | EXC/EXC | 2016-06-30 | 0001109357 | SEARCH_INCOMPLETE | 0001193125-16-457652 · 10-K · 2016-02-10T21:36:37.000000Z | 2016-02-11 | 97 |  |  |  |  |  |  |  | **AMBIGUOUS_COMPOSITE** MULTIPLE_CHARTER_ROWS | item_503_in_gap=1, bylaws=1 · search INCOMPLETE | AMBIGUOUS_COMPOSITE MULTIPLE_CHARTER_ROWS · 0001193125-17-039639 |  |
| 14 | mid | HAL/HAL | 2020-06-30 | 0000045012 | SEARCH_INCOMPLETE | 0000045012-20-000031 · 10-K · 2020-02-11T21:57:53.000000Z | 2020-02-12 | 96 | 3.1 | HYPERLINK · INCORPORATED | 0000045012-06-000247/restatedcertofincorp.htm | 72a88a07420e52ac0a4fc31199bf9321894f31e631fa18467951af64a4aa5dac | True | RESTATED_CERTIFICATE | NUMERIC_PAR_VALUE_SUFFIX | **QUALIFYING** | no_known_governing_candidate=1 · search INCOMPLETE | QUALIFYING · 0000045012-21-000009 · 0000045012-06-000247/restatedcertofincorp.htm | SAME_SHA |
| 15 | mid | SWKS/SWKS | 2015-06-30 | 0000004127 | SEARCH_INCOMPLETE | 0000004127-15-000004 · 10-K/A · 2015-02-02T21:01:09.000000Z | 2015-02-03 | 102 | 3.1 | TEXT_METADATA+COMPLETE_SUBMISSION · INCORPORATED | 0001193125-11-216494/dex3a.htm | 50347176d7df827acc922c4b3ab9b95a9b72051b40cf5a4f865e7211f37a6db3 | True | RESTATED_CERTIFICATE | NUMERIC_PAR_VALUE_SUFFIX | **QUALIFYING** | no_known_governing_candidate=1 · search INCOMPLETE | QUALIFYING · 0000004127-15-000037 · 0001193125-11-216494/dex3a.htm | SAME_SHA |
| 16 | mid | ISRG/ISRG | 2016-06-30 | 0001035267 | SEARCH_INCOMPLETE | 0001035267-16-000130 · 10-K · 2016-02-02T22:22:41.000000Z | 2016-02-03 | 103 |  |  |  |  |  |  |  | **AMBIGUOUS_COMPOSITE** CHARTER_PLUS_AMENDMENT | no_known_governing_candidate=1 · search INCOMPLETE | AMBIGUOUS_COMPOSITE CHARTER_PLUS_AMENDMENT · 0001035267-17-000021 |  |
| 17 | mid | WST/WST | 2020-06-30 | 0000105770 | ANCHOR | 0000105770-20-000015 · 10-K · 2020-02-21T23:56:52.000000Z | 2020-02-24 | 89 | 3.1 | HYPERLINK · INCORPORATED | 0000105770-15-000015/ex31amendedarticles.htm | e32210d672eac05f38ac1c82a838f305224327a0a141539fdcd04745b3e8274f | True | AMENDED_AND_RESTATED_ARTICLES | NUMERIC_PAR_VALUE_SUFFIX | **QUALIFYING** | no_known_governing_candidate=1 · search COMPLETE | QUALIFYING · 0000105770-21-000008 · 0000105770-20-000045/ex31articlesofincorpor.htm | DIFFERENT_SHA |
| 18 | mid | WU/WU | 2019-06-28 | 0001365135 | SEARCH_INCOMPLETE | 0001558370-19-000848 · 10-K · 2019-02-21T21:08:24.000000Z | 2019-02-22 | 88 | 3.1 | HYPERLINK · INCORPORATED | 0001365135-18-000024/exhibit31-2018amendedcoi.htm | c96c074a5ac9c4cf2754b05df29d467f67c5da19a91f27529423638c92a1cf67 | True | AMENDED_AND_RESTATED_CERTIFICATE | NUMERIC_PAR_VALUE_SUFFIX | **QUALIFYING** | no_known_governing_candidate=1 · search INCOMPLETE | QUALIFYING · 0001558370-20-001090 · 0001365135-18-000024/exhibit31-2018amendedcoi.htm | SAME_SHA |
| 19 | mid | HSIC/HSIC | 2016-06-30 | 0001000228 | NO_DATED_ANCHOR | 0001000228-16-000042 · 10-K · 2016-02-10T20:04:27.000000Z | 2016-02-11 | 97 |  |  |  |  |  |  |  | **AMBIGUOUS_COMPOSITE** CHARTER_PLUS_AMENDMENT | no_known_governing_candidate=1 · search COMPLETE | AMBIGUOUS_COMPOSITE CHARTER_PLUS_AMENDMENT · 0001000228-17-000011 |  |
| 20 | mid | TDC/TDC | 2015-06-30 | 0000816761 | SEARCH_INCOMPLETE | 0000816761-15-000008 · 10-K · 2015-02-27T15:27:25.000000Z | 2015-03-02 | 84 | 3.1 | TEXT_METADATA · 8-K PERIOD 2007-09-25 matches=0 |  |  |  |  |  | **UNRESOLVED_REFERENCE** | no_known_governing_candidate=1 · search INCOMPLETE | UNRESOLVED_REFERENCE · 0000816761-16-000045 |  |
| 21 | mid | TXT/TXT | 2015-06-30 | 0000217346 | NO_DATED_ANCHOR | 0001104659-15-013784 · 10-K · 2015-02-25T18:56:08.000000Z | 2015-02-26 | 86 |  |  |  |  |  |  |  | **AMBIGUOUS_COMPOSITE** CHARTER_PLUS_AMENDMENT | no_known_governing_candidate=1 · search COMPLETE | AMBIGUOUS_COMPOSITE CHARTER_PLUS_AMENDMENT · 0001104659-16-099562 |  |
| 22 | mid | AYI/AYI | 2017-06-30 | 0001144215 | NO_DATED_ANCHOR | 0001144215-16-000287 · 10-K · 2016-10-27T21:16:54.000000Z | 2016-10-28 | 168 |  |  |  |  |  |  |  | **AMBIGUOUS_COMPOSITE** CHARTER_PLUS_AMENDMENT | unresolved_governing_document=1, bylaws=1 · search COMPLETE | AMBIGUOUS_COMPOSITE CHARTER_PLUS_AMENDMENT · 0001144215-17-000106 |  |
| 23 | mid | KLAC/KLAC | 2016-06-30 | 0000319201 | NO_DATED_ANCHOR | 0000319201-15-000053 · 10-K · 2015-08-07T20:31:43.000000Z | 2015-08-10 | 225 |  |  |  |  |  |  |  | **AMBIGUOUS_COMPOSITE** CHARTER_PLUS_AMENDMENT | no_known_governing_candidate=1 · search COMPLETE | AMBIGUOUS_COMPOSITE CHARTER_PLUS_AMENDMENT · 0000319201-16-000090 |  |
| 24 | mid | CNC/CNC | 2020-06-30 | 0001071739 | SEARCH_INCOMPLETE | 0001071739-20-000060 · 10-K · 2020-02-18T22:17:30.000000Z | 2020-02-19 | 92 |  |  |  |  |  |  |  | **AMBIGUOUS_COMPOSITE** CHARTER_PLUS_AMENDMENT | no_known_governing_candidate=1 · search INCOMPLETE | AMBIGUOUS_COMPOSITE CHARTER_PLUS_AMENDMENT · 0001071739-21-000039 |  |
| 25 | late | CPAY/CPAY | 2025-06-30 | 0001175454 | ANCHOR | 0001628280-25-008746 · 10-K · 2025-02-27T22:13:10.000000Z | 2025-02-28 | 83 |  |  |  |  |  |  |  | **AMBIGUOUS_COMPOSITE** CHARTER_PLUS_MERGER | no_known_governing_candidate=1 · search COMPLETE | AMBIGUOUS_COMPOSITE CHARTER_PLUS_MERGER · 0001175454-26-000018 |  |
| 26 | late | TRMB/TRMB | 2022-06-30 | 0000864749 | SEARCH_INCOMPLETE | 0000864749-22-000044 · 10-K · 2022-02-23T01:13:12.000000Z | 2022-02-23 | 88 | 3.1 | HYPERLINK · INCORPORATED | 0001341004-16-001666/ex3-1.htm | fcbd28aa9c1b4a0e6bc8bb96a298843a32d416ec77f2e3920a227f1d499ce822 | True | BYLAWS |  | **CLASSIFICATION_SOURCE_MISMATCH** | no_known_governing_candidate=1 · search INCOMPLETE | CLASSIFICATION_SOURCE_MISMATCH · 0000864749-23-000012 · 0001341004-16-001666/ex3-1.htm |  |
| 27 | late | NWS/NWS | 2025-06-30 | 0001564708 | ANCHOR | 0001564708-24-000408 · 10-K · 2024-08-13T11:05:30.000000Z | 2024-08-14 | 218 | 3.1 | HYPERLINK · INCORPORATED | 0001193125-18-249117/d603651dex31.htm | 3c600fb75c3f88ba80152309a8695eb3fc203975fd08f7c2d5a7970e45093968 | True | RESTATED_CERTIFICATE | NUMERIC_PAR_VALUE_SUFFIX | **AMBIGUOUS_COMPOSITE** CHARTER_PLUS_OTHER_SERIES_ROWS | no_known_governing_candidate=1 · search COMPLETE | AMBIGUOUS_COMPOSITE CHARTER_PLUS_OTHER_SERIES_ROWS · 0001564708-25-000419 · 0001193125-18-249117/d603651dex31.htm |  |
| 28 | late | EXE/EXE | 2025-06-30 | 0000895126 | SEARCH_INCOMPLETE | 0000895126-25-000021 · 10-K · 2025-02-26T21:06:32.000000Z | 2025-02-27 | 84 | 3.1 | HYPERLINK · INCORPORATED | 0001104659-24-104976/tm2425151d1_ex3-1.htm | dae7d493e7434cb01d6d123994321e0e6a7e16d7a15b61b6b6151bd6c1b51ad6 | True | AMENDED_AND_RESTATED_CERTIFICATE | NUMERIC_PAR_VALUE_SUFFIX | **QUALIFYING** | no_known_governing_candidate=1 · search INCOMPLETE | QUALIFYING · 0000895126-26-000011 · 0001104659-24-104976/tm2425151d1_ex3-1.htm | SAME_SHA |
| 29 | late | FE/FE | 2023-06-30 | 0001031296 | SEARCH_INCOMPLETE | 0001031296-23-000014 · 10-K · 2023-02-13T22:01:49.000000Z | 2023-02-14 | 94 | 3-1 | HYPERLINK · INCORPORATED | 0001031296-19-000034/q22019-ex3x1.htm | 1a367a7c8a01b191da019ea81532fef8e1530d652cd98827361b6e4fbd888a22 | True | AMENDED_AND_RESTATED_ARTICLES | NUMERIC_PAR_VALUE_SUFFIX | **QUALIFYING** | no_known_governing_candidate=1 · search INCOMPLETE | QUALIFYING · 0001031296-24-000008 · 0001031296-19-000034/q22019-ex3x1.htm | SAME_SHA |
| 30 | late | CMG/CMG | 2021-06-30 | 0001058090 | NO_DATED_ANCHOR | 0001058090-21-000010 · 10-K · 2021-02-10T02:59:51.000000Z | 2021-02-10 | 97 | 3.1 | HYPERLINK · INCORPORATED | 0001058090-16-000088/cmg-20160930xex3_1.htm | 13a1b285bc977c68e68e8c934224c9fc960992f040a9c81ca36695f15c6e20b8 | True | AMENDED_AND_RESTATED_CERTIFICATE | NUMERIC_PAR_VALUE_SUFFIX | **QUALIFYING** | item_503_in_gap=1, bylaws=1 · search COMPLETE | QUALIFYING · 0001058090-22-000011 · 0001058090-16-000088/cmg-20160930xex3_1.htm | SAME_SHA |
| 31 | late | WM/WM | 2022-06-30 | 0000823768 | SEARCH_INCOMPLETE | 0001558370-22-001179 · 10-K · 2022-02-15T19:22:45.000000Z | 2022-02-16 | 92 | 3.1 | HYPERLINK · INCORPORATED | 0000950123-10-070947/h74168exv3w1.htm | abad27aa22e344f442885755ed8466a34c6f2953e17be8282c65e7bcd6d72fcf | True | RESTATED_CERTIFICATE | EXACT_N1 | **QUALIFYING** | later_10k_in_gap=1, no_known_governing_candidate=1 · search INCOMPLETE | QUALIFYING · 0001558370-23-000964 · 0000950123-10-070947/h74168exv3w1.htm | SAME_SHA |
| 32 | late | AME/AME | 2021-06-30 | 0001037868 | SEARCH_INCOMPLETE | 0001037868-21-000007 · 10-K · 2021-02-18T17:23:36.000000Z | 2021-02-19 | 91 | 3.1 | HYPERLINK · INCORPORATED | 0001193125-19-144863/d740805dex31.htm | 8b279335fe25c180764db1803834d28b95f5014c8c4d7514b51e78bf78efc6a0 | True | CERTIFICATE_OF_AMENDMENT |  | **CLASSIFICATION_SOURCE_MISMATCH** | no_known_governing_candidate=1 · search INCOMPLETE | CLASSIFICATION_SOURCE_MISMATCH · 0001037868-22-000009 · 0001193125-19-144863/d740805dex31.htm |  |
| 33 | late | CMI/CMI | 2024-06-28 | 0000026172 | SEARCH_INCOMPLETE | 0000026172-24-000012 · 10-K · 2024-02-12T20:24:59.000000Z | 2024-02-13 | 94 | 3(a) | HYPERLINK · INCORPORATED | 0000897069-18-000338/cg1103ex32.htm | 6afef606c03f88e8a29291f1d38d722a63311b78430294d80a1e4a81af52fc3c | True | RESTATED_ARTICLES | NUMERIC_PAR_VALUE_SUFFIX | **QUALIFYING** | no_known_governing_candidate=1 · search INCOMPLETE | QUALIFYING · 0000026172-25-000007 · 0000897069-18-000338/cg1103ex32.htm | SAME_SHA |
| 34 | late | WAT/WAT | 2026-06-30 | 0001000697 | SEARCH_INCOMPLETE | 0001193125-26-062604 · 10-K · 2026-02-23T14:10:03.000000Z | 2026-02-24 | 87 |  |  |  |  |  |  |  | **AMBIGUOUS_COMPOSITE** CHARTER_PLUS_AMENDMENT | no_known_governing_candidate=1 · search INCOMPLETE | NO_QUALIFYING_10K no 10-K/10-K-A on that side of formation under this CIK |  |
| 35 | late | TSCO/TSCO | 2022-06-30 | 0000916365 | NO_DATED_ANCHOR | 0000916365-22-000049 · 10-K · 2022-02-17T21:10:33.000000Z | 2022-02-18 | 90 | 3.1 | HYPERLINK · INCORPORATED | 0000916365-20-000184/restatedcertificateofi.htm | 4a8390b5a5c816d79d09d554a584a3f5b5c2c0e278b6d5f572bbb8d3e8e36c95 | True | RESTATED_CERTIFICATE | NUMERIC_PAR_VALUE_SUFFIX | **QUALIFYING** | no_known_governing_candidate=1 · search COMPLETE | QUALIFYING · 0000916365-23-000045 · 0000916365-20-000184/restatedcertificateofi.htm | SAME_SHA |
| 36 | late | SYY/SYY | 2023-06-30 | 0000096021 | SEARCH_INCOMPLETE | 0000096021-22-000151 · 10-K · 2022-08-25T21:39:42.000000Z | 2022-08-26 | 211 |  |  |  |  |  |  |  | **AMBIGUOUS_COMPOSITE** CHARTER_PLUS_AMENDMENT_DESIGNATION | item_503_in_gap=1, bylaws=1 · search INCOMPLETE | AMBIGUOUS_COMPOSITE CHARTER_PLUS_AMENDMENT_DESIGNATION · 0000096021-23-000117 |  |


## 10.40 SEC-only current-state gap ledger probe — 관측과 formation 사이를 SEC 공시가 메우는가 — 2026-09-12

**진단 전용이다.** production 코드와 CLOSED 계약(O2 · O2-C · B2 · 탄생 · B1/P2/N1 · class-id · bundle ·
manifest · `RelationInterval`)을 하나도 바꾸지 않았고 연속성 계약을 설계하지 않았다. 여기서 만든 것은
**공시 사건 원장(disclosure ledger)**이지 경제 구간이 아니다. `qv_sec_filings` production 적재는 K/Q 전용
그대로다.

```text
base (origin/main)   ccde5122c42e57f12f186a61b7ff253bfe77093e   (trading/ · docs/trading/ 변경 없음)
population           §10.39-A의 PRE 자격 관측 12건 그대로 — 재표집하지 않았다
                     XYL · WEC · HAL · SWKS · WST · WU · EXE · FE · CMG · WM · CMI · TSCO
gap 시간 계약        gap 시작 = PRE 관측 acceptance · gap 끝 = formation_session
                     filing은 production _historical_usable_session(SPY eodhd/eodhd-15y-2026-08)이 준
                     historical_usable_session <= formation_session 일 때만 formation에서 쓸 수 있다
network              EDGAR 27회 (전부 이 12 CIK · 성공 26 · header index 404 1건) + 규칙 원문 9회(비-EDGAR)
                     그 404는 10-Q 참조 해석 중 000095012311089760의 header index이고,
                     production _accession_layout과 같은 complete submission 경로로 처리됐다(§10.39와 같은 모양)
                     §10.39 캐시 재사용 · population crawl 없음 · 자동 retry 없음
```

### 근거 구분

```text
OFFICIAL_SEC_RULE_BASIS            아래 §1 — 원문을 직접 받아 인용했다(요약기 해석을 쓰지 않았다)
DETERMINISTIC                      submissions 열거 · PIT usable session · Item 5.03/5.07 구간 추출 ·
                                   10-Q Item 601 추출(§10.39 v3 코드 동결) · SHA · 세션 수 · bracketing 대조
MODEL_ASSISTED_SOURCE_TEXT_JUDGMENT 5.03/5.07 원문의 정관/부속정관 구분과 대상 class 범위 판정 · WST 해석
DIAGNOSTIC_COUNTERFACTUAL          §9의 C0 · C1. 채택한 규칙이 아니다
```

### 1. 공식 규칙 재확인 (OFFICIAL_SEC_RULE_BASIS)

**ecfr.gov는 이 환경에서 차단 페이지로 redirect돼서** GPO 공식 연간판(CFR-2024)을 썼다. "current eCFR"이
아니라 **2024 annual edition**이라는 것을 그대로 적는다.

```text
17 CFR 229.601(b)(3)(i)   https://www.govinfo.gov/content/pkg/CFR-2024-title17-vol3/xml/CFR-2024-title17-vol3-sec229-601.xml
```

> "The articles of incorporation of the registrant or instruments corresponding thereto as currently in
> effect and any amendments thereto. Whenever the registrant files an amendment to its articles of
> incorporation, it must file a complete copy of the articles as amended. However, if such amendment is
> being reported on Form 8-K (§ 249.308 of this chapter), the registrant is required to file only the text
> of the amendment as a Form 8-K exhibit. In such case, a complete copy of the articles of incorporation as
> amended must be filed as an exhibit to the next Securities Act registration statement or periodic report
> filed by the registrant to which this exhibit requirement applies."

전시표(§229.601(a)(2))의 `(3)(i) Articles of incorporation` 행을 **원본 GPO 셀 위치로 정렬**했다.

```text
S-1 X · S-3 – · SF-1 X · SF-3 X · S-4 X · S-8 – · S-11 X · F-1 X · F-3 – · F-4 X
10 X · 8-K X · 10-D X · 10-Q X · 10-K X
주의: 그 행의 <ENT> 셀은 15개이고 열은 16개다(끝의 ABS-EE 빈 셀이 생략됐다). 앞 15열 정렬은 확정이고
      10-Q · 10-K가 표시된다는 사실은 그 정렬 안에서 나온다.
```

**Form 8-K Item 5.03**(현행 양식 `https://www.sec.gov/files/form8-k.pdf`, 로컬 텍스트 추출):

> "If a registrant with a class of equity securities registered under Section 12 of the Exchange Act amends
> its articles of incorporation or bylaws and a proposal for the amendment was not disclosed in a proxy
> statement or information statement filed by the registrant, disclose the following information: (i) the
> effective date of the amendment; and (ii) a description of the provision adopted or changed by amendment
> and, if applicable, the previous provision."
> Instructions to Item 5.03: "1. Refer to Item 601(b)(3) of Regulation S-K (17 CFR 229.601(b)(3)) regarding
> the filing of exhibits to this Item 5.03."

**Form 8-K Item 5.07**(같은 출처):

> "If any matter was submitted to a vote of security holders, through the solicitation of proxies or
> otherwise, provide the following information: (a) The date of the meeting and whether it was an annual or
> special meeting. … (b) If the meeting involved the election of directors, the name of each director
> elected at the meeting, as well as a brief description of each other matter voted upon at the meeting; and
> state the number of votes cast for, against or withheld …"
> Instruction 1: "The four business day period for reporting the event under this Item 5.07 … shall begin to
> run on the day on which the meeting ended. … The registrant shall file an amended report on Form 8-K under
> this Item 5.07 to disclose the final voting results within four business days after the final voting
> results are known."
> Instruction 2: "If any matter has been submitted to a vote of security holders otherwise than at a meeting
> of such security holders, corresponding information with respect to such submission shall be provided."

**Corp Fin C&DI, Regulation S-K, Section 246 (Item 601 — Exhibits), Question 246.01**
(`https://www.sec.gov/rules-regulations/staff-guidance/compliance-disclosure-interpretations/regulation-s-k`,
페이지 표기 Last Update 2026-03-06, 해당 항목 표기 [July 3, 2008]):

> "246.01 Item 601(b)(3) requires that the entire amended text of the articles or by-laws be filed, along
> with the text of the new amendments. This could be accomplished by filing the entire amended text,
> redlined to show the new amendments. [July 3, 2008]"

**Item 5.03은 완전한 amendment 원장이 아니다** — 조문 자체가 "제안이 proxy/information statement로 공시되지
않았을 때"로 조건을 건다. 그리고 **Item 5.07은 표결 결과를 요구하지 발효일을 요구하지 않는다.**

### 2. 탐색 — submissions 전량 metadata

```text
_submissions_rows(client, cik, forms=None)  recent + archive   12/12 성공 → GAP_SEARCH_INCOMPLETE 0
PIT로 formation에서 쓸 수 있는 gap filing 합계   565건
  (CMI 157 · WM 49 · CMG 44 · FE 42 · SWKS 38 · WST 38 · WU 35 · WEC 33 · XYL 53 · EXE 29 · HAL 25 · TSCO 22)
```

`qv_sec_filings`(K/Q 전용)에 기대지 않았고 production 적재 범위를 넓히지 않았다.

### 3. 원장 사건

```text
ITEM_503_EFFECTIVE_AMENDMENT      0
ITEM_503 (bylaws-only)            1   CMG — "approved an amendment to Chipotle's Amended and Restated Bylaws
                                      … to add a new forum selection provision as Article XII"
ITEM_507 8-K (정기주총)           12   12건 전부 gap 안에 있다
ITEM_507_CHARTER_VOTE_APPROVED     1   WST
ITEM_507_CHARTER_VOTE_REJECTED     0
10-Q 검사                          13   자격 재-anchor 3 (XYL · WST · EXE) · Exhibit 3 charter 행 없음 10
PROPOSAL_REFERENCE                 1   WST (아래 — 결정론적 참조 해석은 실패했다)
UNRESOLVED_EVENT                   0
```

**10-Q 재-anchor는 §10.39 v3 추출 코드를 그대로 얼려 돌렸다**(`i601eval_v3.py`
sha256 `71af8ac159185a2c474a281dd99c3c7f11ea0a39c3586ebf8ab56f11b0c1193a`, 규칙을 결과를 본 뒤에 고치지
않았다). Exhibit 3 charter 행이 없는 10-Q는 파서 실패가 아니라 `NO_CURRENT_STATE_OBSERVATION`이다.

재-anchor가 실제로 틈을 줄인 것은 둘이다.

```text
XYL  85 세션 -> 39 세션   (10-Q 0001193125-12-206735 usable 2012-05-04, 같은 charter SHA)
EXE  84 세션 -> 41 세션   (10-Q 0000895126-25-000053 usable 2025-04-30, 같은 charter SHA)
WST  재-anchor 10-Q(usable 2020-04-27)는 표결(5월 5일)보다 앞이라 변경 뒤 재-anchor가 아니다
```

### 4. WST 양성 대조 — SEC-only 채널이 잡는다

```text
채널        Item 5.07  (8-K 0000105770-20-000025 · acceptance 2020-05-07 · usable 2020-05-08 <= formation 2020-06-30)
원문        "Proposal 3: Our shareholders approved the amendment to Article 5 of our Amended and Restated
             Articles of Incorporation to increase the number of authorized shares of common stock from
             100 million to 200 million by the following vote:"
성립하는 것  주주 승인(approval) · 대상 class 관련성(수권 보통주 수 = GENERAL_CAPITAL_STRUCTURE)
성립하지 않는 것  법적 발효일. Item 5.07은 발효일을 요구하지 않고 이 8-K도 말하지 않는다.
             독립 진단(§10.39)으로는 새 정관이 "(Effective as of May 5, 2020)"이고, 그 문서의 첫 SEC 수리는
             formation 뒤인 2020-07-24 10-Q다.
ledger 상태  APPROVED_CHANGE_EFFECT_UNKNOWN
```

**proxy 참조는 결정론적으로 풀리지 않았다.** 5.07은 "our proxy statement dated March 13, 2020"이라고만
하고, gap 안 유일한 DEF 14A(`0001047469-20-001767`, filed 2020-03-25, report_date 2020-05-05)의 본문에서
"March 13" 문자열은 **0회**다. 그래서 이 proxy는 **gap 안 유일성으로 고른 것이지 원문 참조로 해석한 것이
아니다**(`UNRESOLVED_PROXY_REFERENCE` + `PROXY_UNIQUE_DEF14A_IN_GAP`). 그 전제에서 본문만 기록한다.

> "If the Company's shareholders approve the proposed amendment to the Amended and Restated Articles of
> Incorporation, the number of authorized shares of common stock will be increased to 200 million … The
> amendment will be immediately effective upon approval and filing with the Pennsylvania Department of State
> Corporation Bureau."

proxy는 **제안 출처**다. 발효를 증명하지 않는다 — 그 문장도 "승인 + 주 제출"을 발효 조건으로 말한다.

**C0 오통과 여부.** 이번 원장(5.03 + 5.07 + 10-Q)에서는 WST에 신호가 있으므로 C0가 WST를 통과시키지
**않는다.** 그러나 **§10.39가 쓰던 좁은 채널 집합(5.03 + formation 앞 governing 문서 수리)에서는 신호가
0이었고, 그 규칙이었다면 WST를 오통과시켰다.** 채널을 5.07까지 넓힌 것이 차이를 만들었다.

### 5. 대상 class 범위 판정 (MODEL_ASSISTED_SOURCE_TEXT_JUDGMENT)

```text
TARGET_CLASS_RELEVANT / GENERAL_CAPITAL_STRUCTURE   1   WST (수권 보통주 100M -> 200M, Article 5)
PROVEN_NON_CLASS_SCOPE                              1   CMG — 개정 대상이 Bylaws Article XII(재판관할)이고
                                                        operative 문언이 그 조항에 갇혀 있다. 정관이 아니다.
UNRESOLVED_SCOPE                                    0
```

대상 class 이름이 없다는 것을 무관성의 근거로 쓰지 않았다. CMG는 "부속정관 조항"이라는 **양성 범위 증거**가
있어서 non-class로 적었다.

### 6. formation 시점 원장 상태

```text
NO_CHARTER_SIGNAL_OBSERVED                8   WEC · HAL · SWKS · WU · FE · WM · CMI · TSCO
NO_CHARTER_SIGNAL_OBSERVED + REANCHORED   2   XYL · EXE (변경 신호 없이 10-Q가 재-anchor)
ONLY_PROVEN_NON_CLASS_CHANGES             1   CMG
APPROVED_CHANGE_EFFECT_UNKNOWN            1   WST
KNOWN_CHANGE_RELEVANT / UNRESOLVED        0
```

`NO_CHARTER_SIGNAL_OBSERVED`는 **연속성 증명이 아니다.** 측정된 원장 결과일 뿐이다.

### 7. 반사실 계약 (DIAGNOSTIC_COUNTERFACTUAL · 채택하지 않는다)

```text
C0  무신호 규칙          12 중 11 통과 · WST는 막힌다(5.07 신호) — 단 §10.39 채널이었다면 WST 오통과
C1  공시원장 fail-close  positively closed by evidence           0
                        requires SEC-ledger completeness assumption  11
                        blocked / unresolved                      1   WST
```

C1이 "증거로 닫힌" 사례가 0인 이유는 구조적이다 — 11건은 **변경 신호가 없다**는 사실에 기대므로, 그것이
연속성 증거인지는 이 probe가 정하지 않는 semantic 결정이다(§8).

### 8. bracketing 대조 (§10.39 POST는 진단 진실로만 쓴다)

```text
SAME_SHA 11 · DIFFERENT_SHA 1
DIFFERENT_SHA 중 formation 전 원장이 잡아낸 것        1 / 1   WST
SAME_SHA 중 amendment 신호가 있던 것                  0
SAME_SHA 중 non-class 신호만 있던 것                  1       CMG
SAME_SHA 중 미해결 신호가 있던 것                      0
SAME_SHA 중 신호가 전혀 없던 것                       10
```

같은 SHA가 일시적 변경의 부재를 증명하지 않는다는 §10.39 경고는 그대로다.

### 9. 완결성 질문 — 공시 채널이 닫힌 분할을 이루는가

**A. 규칙이 명시로 요구하는 것.** Section 12 등록 국내 발행인이 정관을 개정하면, (i) **제안이
proxy/information statement로 공시되지 않았을 때** Item 5.03이 발효일과 변경 조항 설명을 요구하고,
(ii) 증권보유자 표결·동의가 있었으면 Item 5.07이 그 결과를 요구하며(Instruction 2가 회의 밖 동의도 포함),
(iii) Item 601(b)(3)(i)이 **다음** 해당 정기보고서/등록서류에 개정 반영 완전본을 요구한다.

**B. 12건 실측.** 정관 변경이 실제로 있었던 1건(WST)은 (ii) 채널에 formation 전에 보였다. (i)은 0건,
(iii)은 그 변경을 formation **뒤**에야 보여줬다. 나머지 11건은 어떤 정관 변경 신호도 없었다.

**C. 남는 구멍.** 세 채널을 합쳐도 **닫힌 분할이 아니다.**

```text
1  5.03은 proxy/information statement로 이미 공시된 제안을 제외한다 — WST가 정확히 그 경우다.
2  5.07은 승인을 말하지 발효를 말하지 않는다. 승인과 발효 사이의 지연·미이행·조건은 SEC 공시에 없다.
3  601(b)(3)(i)의 완전본은 "다음 정기보고서"이므로 formation보다 늦을 수 있다(WST: 2020-07-24).
4  이사회 단독 개정 중 5.03이 적용되는 경우에도 보고 기한(4영업일)과 수리 시각이 formation을 넘을 수 있다.
5  지연 제출·미이행(noncompliance)은 어떤 규칙 인용으로도 배제되지 않는다.
```

**D. 그래서 여전히 주 기록이 필요한 자리.** 승인과 발효 사이(**정확한 법적 발효일**), 그리고 승인 없이
이사회 권한으로 이뤄지는 변경의 발효 시점이다. 이 둘은 SEC 공시가 아니라 주 등록부 제출 기록이 정본이다.

**이 절은 위 법적·공시 추론을 production 진실로 바꾸지 않는다.** `NO_CHARTER_SIGNAL_OBSERVED`를 연속성으로
승격하는 결정은 하지 않았다.

### 범위

```text
production code changed        NO      O2 / O2-C changed        NO
B2 changed                     NO      birth changed            NO
B1 / P2 / N1 changed           NO      RelationInterval changed NO
class-id / bundle / manifest   NO      promotion                NO
5A-3 / Gates                   NO      returns / ranking        NO
qv_sec_filings 적재 범위 확대   NO      network                  EDGAR 27(12 CIK 한정) + 규칙 9
```

받은 SEC 본문과 분석 스크립트는 스크래치에 두고 커밋하지 않는다.

## 10.40-A 행 단위 감사 — 12건

`gap filings / sessions`는 PIT로 쓸 수 있는 gap filing 수와 §10.39가 잰 관측→formation 세션 수다.
`C0`는 무신호 규칙이 그 사례를 통과시키는지, `C1`은 공시원장 fail-close의 결론이다. 둘 다 진단이다.

| # | case | CIK | formation | PRE obs (usable) | PRE charter SHA | gap filings / sessions | 5.03 | 5.07 charter vote | proxy ref | 10-Q re-anchor | scope | ledger state at formation | C0 | C1 | POST bracket |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 01 | CMG | 0001058090 | 2021-06-30 | 0001058090-21-000010 (2021-02-10) | 13a1b285bc977c68… | 44 / 97 | bylaws-only (forum provision, Art. XII of Bylaws) | annual-meeting votes, no charter amendment | — | 0001058090-21-000022 2021-04-29 EXHIBIT_INDEX_PARSE_FAILURE | PROVEN_NON_CLASS_SCOPE | **ONLY_PROVEN_NON_CLASS_CHANGES** | clears | C1_REQUIRES_COMPLETENESS_DECISION | SAME_SHA |
| 02 | CMI | 0000026172 | 2024-06-28 | 0000026172-24-000012 (2024-02-13) | 6afef606c03f88e8… | 157 / 94 | none in gap | annual-meeting votes, no charter amendment | — | 0000026172-24-000023 2024-05-03 EXHIBIT_INDEX_PARSE_FAILURE | — | **NO_CHARTER_SIGNAL_OBSERVED** | clears | C1_REQUIRES_COMPLETENESS_DECISION | SAME_SHA |
| 03 | EXE | 0000895126 | 2025-06-30 | 0000895126-25-000021 (2025-02-27) | dae7d493e7434cb0… | 29 / 84 | none in gap | annual-meeting votes, no charter amendment | — | 0000895126-25-000053 2025-04-30 QUALIFYING dae7d493e7434cb0 | — | **NO_CHARTER_SIGNAL_OBSERVED+REANCHORED** | clears | C1_REQUIRES_COMPLETENESS_DECISION | SAME_SHA |
| 04 | FE | 0001031296 | 2023-06-30 | 0001031296-23-000014 (2023-02-14) | 1a367a7c8a01b191… | 42 / 94 | none in gap | annual-meeting votes, no charter amendment | — | 0001031296-23-000032 2023-04-28 NO_CHARTER_ROW | — | **NO_CHARTER_SIGNAL_OBSERVED** | clears | C1_REQUIRES_COMPLETENESS_DECISION | SAME_SHA |
| 05 | HAL | 0000045012 | 2020-06-30 | 0000045012-20-000031 (2020-02-12) | 72a88a07420e52ac… | 25 / 96 | none in gap | annual-meeting votes, no charter amendment | — | 0000045012-20-000059 2020-04-27 EXHIBIT_INDEX_PARSE_FAILURE | — | **NO_CHARTER_SIGNAL_OBSERVED** | clears | C1_REQUIRES_COMPLETENESS_DECISION | SAME_SHA |
| 06 | SWKS | 0000004127 | 2015-06-30 | 0000004127-15-000004 (2015-02-03) | 50347176d7df827a… | 38 / 102 | none in gap | annual-meeting votes, no charter amendment | — | 0000004127-15-000012 2015-05-07 EXHIBIT_INDEX_PARSE_FAILURE; 0000004127-15-000006 2015-02-05 EXHIBIT_INDEX_PARSE_FAILURE | — | **NO_CHARTER_SIGNAL_OBSERVED** | clears | C1_REQUIRES_COMPLETENESS_DECISION | SAME_SHA |
| 07 | TSCO | 0000916365 | 2022-06-30 | 0000916365-22-000049 (2022-02-18) | 4a8390b5a5c816d7… | 22 / 90 | none in gap | annual-meeting votes, no charter amendment | — | 0000916365-22-000057 2022-05-06 EXHIBIT_INDEX_PARSE_FAILURE | — | **NO_CHARTER_SIGNAL_OBSERVED** | clears | C1_REQUIRES_COMPLETENESS_DECISION | SAME_SHA |
| 08 | WEC | 0000783325 | 2011-06-30 | 0000107815-11-000028 (2011-02-28) | 84af5bab65f78be3… | 33 / 86 | none in gap | annual-meeting votes, no charter amendment | — | 0000107815-11-000052 2011-05-06 EXHIBIT_INDEX_PARSE_FAILURE | — | **NO_CHARTER_SIGNAL_OBSERVED** | clears | C1_REQUIRES_COMPLETENESS_DECISION | SAME_SHA |
| 09 | WM | 0000823768 | 2022-06-30 | 0001558370-22-001179 (2022-02-16) | abad27aa22e344f4… | 49 / 92 | none in gap | annual-meeting votes, no charter amendment | — | 0001558370-22-005976 2022-04-27 EXHIBIT_INDEX_PARSE_FAILURE | — | **NO_CHARTER_SIGNAL_OBSERVED** | clears | C1_REQUIRES_COMPLETENESS_DECISION | SAME_SHA |
| 10 | WST | 0000105770 | 2020-06-30 | 0000105770-20-000015 (2020-02-24) | e32210d672eac05f… | 38 / 89 | none in gap | APPROVED — Art. 5 authorized common 100M→200M | DEF 14A 0001047469-20-001767 (unique DEF 14A in gap; 5.07 cites “proxy statement dated March 13, 2020” — not matchable to a filing date)  | 0000105770-20-000021 2020-04-27 QUALIFYING e32210d672eac05f | GENERAL_CAPITAL_STRUCTURE | **APPROVED_CHANGE_EFFECT_UNKNOWN** | BLOCKS | C1_BLOCKED | DIFFERENT_SHA |
| 11 | WU | 0001365135 | 2019-06-28 | 0001558370-19-000848 (2019-02-22) | c96c074a5ac9c4cf… | 35 / 88 | none in gap | annual-meeting votes, no charter amendment | — | 0001558370-19-004270 2019-05-08 EXHIBIT_INDEX_PARSE_FAILURE | — | **NO_CHARTER_SIGNAL_OBSERVED** | clears | C1_REQUIRES_COMPLETENESS_DECISION | SAME_SHA |
| 12 | XYL | 0001524472 | 2012-06-29 | 0001193125-12-084766 (2012-02-29) | 8914c2ff92a2ed46… | 53 / 85 | none in gap | annual-meeting votes, no charter amendment | — | 0001193125-12-206735 2012-05-04 QUALIFYING adda378ce4bde703 | — | **NO_CHARTER_SIGNAL_OBSERVED+REANCHORED** | clears | C1_REQUIRES_COMPLETENESS_DECISION | SAME_SHA |


## 11. 결과


<!-- 전수 실행 후 채운다. 이 위의 어떤 문턱도 그때 고치지 않는다. -->

```text
판정        (미실행)
```
