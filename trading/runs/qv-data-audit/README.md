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
|`StockholdersEquity` XBRL fallback 순서|§4.3|
|preferred stock · deferred tax 태그 mapping|§4.3|
|historical SIC 복원 경로|§3.4 — filing 시점 submission header 우선|
|point-in-time common shares / ME source|§3.1 우선순위 1→2→3. **정찰이 열어둔 다섯 중 (1)(2)(3)(4)(5)는 로드맵 §4.4.1·§4.4.2로 확정됐다**(아래 3.5)|
|multi-class issuer aggregation + execution-security rule|§6 작업 6|

**issuer custom tag를 이름 유사도로 자동 연결하지 않는다**(§4.2). 표준 taxonomy와 filing
원문으로 회계적 동일성이 확인된 mapping만 넣는다.

**`Total Assets` · `StockholdersEquity` · preferred · deferred tax는 아직 open이다.**
Gross Profit이 닫혔다고 회계 mapping 전체가 닫힌 것이 아니다.

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
role 불명            추측 금지. unresolved / missing
role 밖 fact         주석 · segment · geographic subtotal · 중단사업은 이름이 같아도 후보 아님
fy / fp / frame      statement 의미 추정에 쓰지 않는다
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

**이 결정에 포함되지 않은 것**: `Total Assets` · Book Equity · preferred stock · deferred
tax mapping은 그대로 open이다(위 3.2).

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
|3. companyfacts / accounting mapping|**진행 중.** Gross Profit mapping은 **CLOSED / FROZEN** (2026-08-25, 위 3.6 · 로드맵 §4.2.1). `Total Assets` · Book Equity mapping과 실제 ingestion 구현은 아직 open이다|
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

## 10. 결과

<!-- 전수 실행 후 채운다. 이 위의 어떤 문턱도 그때 고치지 않는다. -->

```text
판정        (미실행)
```
