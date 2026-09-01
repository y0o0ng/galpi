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
없음) 자동 승격도 없다. **5A-2는 아직 끝나지 않았고 Gate A~H는 여전히 미판정이다.**

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


---

## 11. 결과


<!-- 전수 실행 후 채운다. 이 위의 어떤 문턱도 그때 고치지 않는다. -->

```text
판정        (미실행)
```
