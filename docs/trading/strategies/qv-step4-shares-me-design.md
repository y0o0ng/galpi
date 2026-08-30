# QV Phase 0 Step 4 — PIT shares / market equity 구현 설계

**이 문서가 Step 4의 정본이다.** 로드맵 §4.4·§4.4.1·§4.4.2는 여기를 가리키고,
`trading/runs/qv-data-audit/PROBE-*.md`는 이 계약에 이르기까지의 **연구 기록**이다.
probe의 초기 결론이 최종인 것처럼 다시 쓰지 않는다 — 대체된 것은 이 문서가 명시한다.

**범위는 여기서 끝난다.**

```text
explicit PIT identity
  -> raw XBRL share observations
  -> P2 same-regime class share resolution
  -> class valuation resolution
  -> class market equity
  -> issuer market equity
```

**하지 않는 것**: 전략 수익률 · QV ranking/selection · Phase 1 · Phase 2.
**코드가 돈다고 Gate C가 통과했다고 말하지 않는다.**

---

## 1. identity manifest — production 운영 정본

증거력의 정본은 **원본 SEC 자료**다. production mapping의 운영 정본은
**버전 관리되는 명시 manifest**다.

```text
trading/qv/identity/issuers.jsonl
trading/qv/identity/share_classes.jsonl
trading/qv/identity/xbrl_aliases.jsonl
trading/qv/identity/prose_aliases.jsonl
```

**네 파일은 하나의 bundle이다.** 편의를 위해 다섯 번째 identity 파일을 만들지 않는다.
raw SEC 파일·캐시·materialize된 DB는 git 밖에 남는다.

### 1.1 identity_source_version

```text
identity_source_version = "qv-identity-sha256:<SHA256>"
```

네 파일 **전부**의 결정론적 정규화에서 나온다.

- 고정 파일 순서(위 목록 그대로)
- canonical JSON 직렬화(`sort_keys` · 구분자 고정 · 비ASCII 보존)
- semantic key로 결정론적 행 정렬
- 의미가 같은 행이 둘이면 거부
- **무관한 Git commit은 값을 바꾸지 못한다**
- **의미 있는 내용이 바뀌면 반드시 바뀐다**

Galpi Git commit은 **provenance/run receipt로 따로** 기록한다.
**Git commit SHA를 `identity_source_version`으로 쓰지 않는다.**

bundle은 `data_sources`에 `kind=securities · point_in_time=1 ·
survivorship_biased=0`으로 등록한다. **이것이 현재 `securities` 표를 써도 된다는
뜻은 아니다.**

### 1.2 구조화된 SEC 증거

모든 매핑은 **지역 DB row id가 아니라 안정된 SEC 자연 식별자**로 증거를 든다.

```text
source_kind   KQ_FILING | SEC_EVIDENCE_DOCUMENT
cik · accession · document_name
evidence_role
locator (있으면)
dependency    REQUIRED | CORROBORATING
```

```text
usable_from_session = max(REQUIRED 증거 전부의 PIT usable session)
```

**CORROBORATING은 사용 가능 시점을 늦추지 않는다.**
**손으로 넣은 `usable_from_session`은 거부한다** — 파생값을 덮어쓰지 못한다.
REQUIRED 증거를 원장에서 못 풀면 그 매핑은 조용히 materialize되지 않는다.

### 1.3 economic validity vs knowledge availability

```text
effective_from / effective_to   경제적·법적 관계가 실제로 유효한 기간
usable_from_session             그 증명이 당시 행위자에게 공개된 시점
```

**둘 다 만족해야 쓸 수 있다.** 나중 문서가 더 오래된 법적 상태를 증명할 수는 있어도,
**그 증거가 usable해지기 전 formation으로 backfill되지 않는다.**

### 1.4 economic class vs alias

```text
qv_share_classes                  안정된 economic class + ticker/상장/생애
qv_share_class_xbrl_aliases       PIT XBRL QName alias 관계
qv_share_class_prose_aliases      PIT SEC prose alias 관계
```

**`qv_share_classes`에서 `xbrl_axis`/`xbrl_member`를 제거했다.**
XBRL alias 표가 **유일한** semantic XBRL member 매핑 소스다.

- 겹치는 여러 alias → 같은 class: 허용
- 같은 issuer·시점의 같은 정규화 alias → 2개 이상 class: **AMBIGUOUS / fail-close**
- **alias를 economic class로 만들지 않는다**
- `EquivalentClassAMember` 같은 파생/등가 member는 실제 class가 아니다

### 1.5 XBRL QName 정규화

parser의 진실은 `QName(namespace URI, exact local)` 그대로다. alias 매칭 키는

```text
표준 taxonomy   <canonical family>:<exact local>     예) us-gaap:StatementClassOfStockAxis
발행사 확장     ext:<target CIK>:<exact local>
```

raw namespace URI + local은 provenance로 남긴다.
**local-name-only 자동 추론은 없다.** 이 계약이 실제로 요구하는 표준 family만 구현하고
범용 QName 온톨로지를 만들지 않는다.

### 1.6 prose alias 정규화

**N1만 쓴다.**

```text
Unicode NFKC · trim · 내부 공백 1칸 · casefold
구두점 · 하이픈 · 서수 · 단어는 보존한다
```

canonical bridge는 **둘뿐**이다.

1. explicit SEC 구조화 증거 `Security12bTitle` / `Security12gTitle`
2. governing instrument의 명시 class 정의

`COVER_GROUP_LABEL`은 **corroborating 전용**이고 단독 canonical bridge가 될 수 없다.
**XBRL label linkbase는 canonical이 아니다** — 한 member의 표준 label이 두 class를
담는 실측이 있다(Follow-up 9 Q5.2). fuzzy·이름 유사도·embedding·서수·주식수 일치
bridge는 없다. registrant가 아닌 자회사/투자처 이름은 제외한다.
canonical bridge가 없으면 **unresolved**다.

---

## 2. 스키마 migration

`qv_class_valuation`은 **RETIRED**다. 그 이름을 새 의미로 재사용하지 않는다.

```text
qv_class_conversion_relations     법적/경제적 고정 직접 전환 관계
qv_class_valuation_resolutions    formation 시점의 PIT 답
```

migration 정책은 **"비어 있을 때만 재구축"**이다.

- 기존 `backtest.db`를 **지우지 않는다**
- 알려진 legacy 스키마를 정확히 탐지한다(정규화 DDL 비교)
- 영향 표가 전부 비어 있으면 **원자적으로** 새 스키마로 재구축한다
- **행이 하나라도 있으면 추론·파괴적 변환을 하지 않고 `BacktestStorageError`**
- 알 수 없는 스키마 → fail-close
- 오류가 나면 rollback하고 DB/스키마/데이터를 그대로 둔다
- `bars_daily` · `universe_membership` · `securities` · `qv_sec_filings` ·
  `qv_accounting_filings` 등 무관한 데이터는 보존한다

`store.py`의 기존 known-schema migration 철학을 따르고, 무관한 표를 위한 범용
migration 프레임워크를 만들지 않는다.

---

## 3. SEC 증거 문서 원장

`qv_sec_filings`는 **K/Q 계열 filing 원장 그대로 두고 넓히지 않는다**
(`10-K / 10-K/A / 10-Q / 10-Q/A`).

`qv_sec_evidence_documents`를 따로 둔다. 자연 grain은
`(cik, accession, document_name, source_version)`이고, **CLOSED된 QV 증거/탐색 사슬이
실제로 도달하는** 문서만 담는다(8-K/8-K/A · proxy/information statement ·
charter/articles/EX-3.x · 필요한 등록·법적 filing).

**모든 SEC 문서를 창고에 쌓지 않는다. HTML/본문을 DB에 넣지 않는다.**
보존하는 것은 form · accession · document name · acceptance datetime ·
acceptance eastern date · historical usable session · primary/exhibit 역할 ·
SEC source URL · raw 문서 SHA-256 · source/source_version/provenance다.

PIT usable-session 규칙은 `qv_sec_filings`와 **같다** — SEC/Eastern acceptance
날짜 **다음**의 첫 정규 SPY 세션이다.

증거 참조는 둘 중 하나다.

```text
KQ_FILING             -> qv_sec_filings
SEC_EVIDENCE_DOCUMENT -> qv_sec_evidence_documents
```

K/Q 사건 증거는 `qv_sec_filings`를 직접 참조하고 **같은 metadata를 증거 문서 표에
복제하지 않는다.**

---

## 4. 주식수 관측 원장

`qv_share_observations`는 **범용 XBRL 창고가 아니다.** 정본은 raw SEC XBRL instance이고
form은 `10-K / 10-K/A / 10-Q / 10-Q/A`, concept은 정확히 둘이다.

```text
A  us-gaap:CommonStockSharesOutstanding
B  dei:EntityCommonStockSharesOutstanding
```

보존: issuer/class 해석 상태 · CIK · accession · form · acceptance · usable session ·
fact instant · tier · **lossless Decimal 문자열** 주식수 · decimals · unit · context id ·
raw axis/member QName · 정규화 alias 키 · dimension shape/mapping status ·
accession 내 중복 상태 · source file + SHA/source version/provenance.

### 4.1 S1 freshness

```text
Jan 1(t-1) <= share fact instant <= December valuation session D
```

**stale > scope fallback은 없다.**

### 4.2 D0 dimension 계약

1. **명시 dimension 없음** — 그 관측/측정 상태에서 적용 가능한 active ordinary-common
   economic class가 **정확히 하나**라고 explicit PIT identity가 말할 때만 쓴다.
   여러 class가 있으면 **issuer 총계를 배분하지 않는다.**
2. **명시 dimension 정확히 하나** — 축이 승인된 표준 주식 class 축 하나여야 한다
   (`StatementClassOfStockAxis` · `ClassesOfShareCapitalAxis`).
   exact PIT XBRL alias → 안정된 `class_id`.
3. **그 밖의 모든 모양** — 사용 불가 / fail-close.

**typed dimension은 쓸 수 없다. member를 전역 추론하지 않는다.**

### 4.3 accession 안 중복 fact

같은 `concept + context + unit`의 중복은 raw Decimal과 `decimals`에서 **CLOSED 반올림
구간**을 만들어 판정한다.

- 구간이 **전부 겹치면** 가장 정밀하게 명시된 fact로 병합하고 중복 provenance를 남긴다
- 전부 겹치지 않으면 **AMBIGUOUS**
- 동률 최고 정밀도인데 Decimal 값이 다르고 결정론적 동일 canonical 값이 없으면 **AMBIGUOUS**
- `INF`는 정확값이다
- **"정밀도가 이긴다"를 filing 사이에 적용하지 않는다**

---

## 5. share-basis 사건 탐색 / 원장

세 개념을 **분리해 저장한다.**

```text
qv_share_basis_searches        탐색 coverage/closure
qv_share_basis_candidates      발견·추출된 원시 공시 후보
qv_share_basis_class_effects   대상 class의 semantic 효과
```

**원시 후보 처분(disposition)과 class 효과를 섞지 않는다.**

### 5.1 탐색 coverage

```text
NOT_SEARCHED | COMPLETE | INCOMPLETE
```

선택된 filing의 share-basis anchor에서 December D를 향하는 구간에 대해

- **closure filing G** = `acceptance_eastern_date >= high boundary`인 **첫 원본**
  10-K 또는 10-Q
- G가 없으면 `INCOMPLETE`
- G의 acceptance가 formation F보다 늦으면 `INCOMPLETE`
- 탐색 범위는 `(lo, G.acceptance]`의 모든 `10-K / 10-K/A / 10-Q / 10-Q/A`
- **amendment는 증거이지만 절대 closing filing G가 될 수 없다**
- 완전 탐색에 필요한 문서가 없거나 실패하면 `INCOMPLETE`

**`COMPLETE + 사건 없음`은 "basis 변경이 발견되지 않았다"로 유효하고,
`INCOMPLETE + 후보 없음`과 같지 않다.**

### 5.2 결정론적 discovery

HTML **block 수준 구조**를 쓴다. discovery 어휘는 명시 semantic family를 갖는다 —
stock split · reverse split · stock dividend · subdivision · consolidation ·
share unit을 바꾸는 recapitalization/reclassification · `N-for-one`/`one-for-N` ·
동등한 명시 비율/action 표현. **discovery family에는 명시 action/ratio semantics를
요구한다.**

**쓰지 않는 것**: fuzzy matching · LLM · embedding · 수치 후보 점수 · 토큰 창 절단 ·
최근접 숫자/날짜 휴리스틱 · 결과를 본 뒤의 recall/precision 조정.

보존: accession · document · primary/exhibit · 정확한 source span/block · raw action ·
raw ratio · raw 영향 class 이름 · raw 공시 상태 · **역할이 붙은 날짜**.

```text
DECLARED · RECORD · DISTRIBUTION · EFFECTIVE · TRADING_SPLIT_ADJUSTED
```

**추출은 모호함을 보존할 수 있다.** 후보가 여럿이라는 이유로 한 값을 추측하지 않는다.

### 5.3 proposal / 옛 재공시 처분

proposal·authorization 텍스트는 **명시적으로 미실행 상태를 증명할 때만** 현재 사건
분류에서 제외한다(proposal · subject to approval · not implemented ·
no assurance 등). 실행 여부가 모호하면 **UNRESOLVED**다.

옛 재공시는 **역할이 붙은 사건 날짜가 탐색 구간 밖임을 명시적으로 증명할 때만** 제외한다.
날짜가 없거나 시간 관계가 모호하면 **UNRESOLVED**다.

> **제외되거나 무관한 텍스트가 `NO_SHARE_BASIS_EFFECT_CONFIRMED`가 되는 일은 없다.**

### 5.4 class 효과

```text
SHARE_BASIS_CHANGE_CONFIRMED | NO_SHARE_BASIS_EFFECT_CONFIRMED | UNRESOLVED
```

`SHARE_BASIS_CHANGE_CONFIRMED`는 **다섯을 전부** 만족할 때만이다.

1. 명시 registrant scope
2. proposal이 아니라 실제 실행된 action
3. 명시된 영향 대상 class **또는** 모호하지 않은 all-common scope
4. 명시 action + 수치 비율 semantics
5. 명시된 적용 가능 share-side 전환일

영향 raw class 이름은 **exact PIT prose alias**로 해석한다. 해석 실패는 `UNRESOLVED`다.

`NO_SHARE_BASIS_EFFECT_CONFIRMED`는 **관련 실제 action이 대상 class의 share-unit
basis를 바꾸지 않는다는 명시 SEC 증거**다. 침묵 · 후보 없음 · 무관한 텍스트 ·
vendor split 데이터 · 가격 패턴 · 주식수 도약 · 형제 class 거동에서 **추론되지 않는다.**
**manual issuer/year override는 없다.**

---

## 6. share-side 날짜 + 상장 market boundary

share-unit basis anchor는 **filing acceptance/release 체제**다.

확인된 class 수준 basis 변경 사건에서 share-side 전환일은 **action에 연결된**

```text
EFFECTIVE | DISTRIBUTION(PAYMENT)
```

만 쓸 수 있다. **`DECLARED`와 `RECORD`는 금지다.** 방어 가능한 전환일이 없으면
`UNRESOLVED / fail-close`다.

**상장 class의 market boundary는 별개 사실이다.**

- 1차: 그 class 자신의 상장 심볼 vendor split date → 같은 달력일 이상 첫 정규 세션
- vendor split date 자체가 formation까지 **available**해야 한다
- explicit SEC `TRADING_SPLIT_ADJUSTED`는 corroborate한다
- vendor 증거가 없으면 explicit SEC `TRADING_SPLIT_ADJUSTED`가 fallback이다
- 둘 다 없으면 `UNRESOLVED`
- vendor와 explicit SEC trading boundary가 충돌하면 `UNRESOLVED`

> **vendor 증거는 SEC 기업행동이 실제로 일어났음을 절대 확인하지 않는다.**
> SEC가 사건을 증명하고 vendor는 상장 시장 가격 경계를 정한다.

`share_side_transition != market_boundary`이면 그 사이 **불일치 구간**을 만들고,
선택된 share-filing basis anchor **또는** December valuation session D가 그 구간 안에
있으면 `UNRESOLVED`다. **±N일 tolerance도 가격 변화 tolerance도 없다.**

### 6.1 EODHD 연동

이 계약이 요구하는 **최소한**의 historical split API adapter만 연다
(`GET /api/splits/{SYMBOL}`). vendor의 symbol · raw split date · raw ratio ·
source/source_version/provenance를 보존하고, 결정론적 재현을 위해 좁은 vendor
split 원장(`qv_vendor_split_events`)을 둔다. **범용 corporate-actions 프레임워크로
만들지 않는다.** vendor 증거는 위의 market-boundary 해석에만 쓴다.

---

## 7. P2 same-regime share selector — CLOSED/FROZEN

결과는 `qv_class_share_resolutions`에 남는다.

**class universe**: December D에 활성인 actual ordinary-common economic class.
D 이전에 은퇴한 class와 파생/등가 member는 제외한다.

**후보 자격**: raw XBRL only · 허용 K/Q form · `historical_usable_session <= F` ·
S1 freshness · D0 dimension 계약 · exact PIT identity alias.

**tier 규칙(mandatory)**

```text
A = us-gaap:CommonStockSharesOutstanding
B = dei:EntityCommonStockSharesOutstanding
```

허용 소스 범위에서 **fresh A가 구조적으로 존재하면 A tier가 그 관측을 소유한다.**
**모호하거나 쓸 수 없는 A는 B fallback을 허용하지 않는다.**
**fresh A가 구조적으로 없을 때만** B를 본다. 이 구분은 mandatory다.

**same-regime 판정** — 후보 filing의 basis에서 D까지

```text
coverage != COMPLETE           -> 사용 불가 / fail-close
적용 가능한 UNRESOLVED 효과     -> 사용 불가 / fail-close
확인된 적용 가능 basis 변경     -> 다른 regime / 사용 불가
COMPLETE + 미해결/변경 없음     -> same regime
```

후보의 basis anchor는 그 filing의 acceptance 체제이므로, 판정 구간은 `(D, anchor]`다.
**전환이 anchor보다 뒤에 일어났으면 그 filing은 여전히 D와 같은 단위다.**

**활성 tier 안 선택 순서**

1. same-regime 후보만 남긴다
2. 가장 늦은 fact instant
3. 같은 instant면 `acceptance_datetime DESC` → `accession` 사전순 DESC

**더 새로운 다른-regime 후보가 있어도 실패하지 않는다.** 더 오래된 same-regime 후보로
물러설 수 있다. **더 새로운 후보를 비율 정규화하는 것은 금지다.**
쓸 수 있는 후보가 없으면 `MISSING`이고 `shares * split ratio` 같은 합성은 없다.

---

## 8. 법적 전환 관계

`qv_class_conversion_relations`는 **법적/경제적 고정 직접 관계**를 담는다.
"이 historical formation에서 써도 안전한가"의 답이 아니다.

보존: subject class · listed reference class · **정확한 양수 수치 비율(lossless
Decimal 표현)** · legal `effective_from`/`effective_to` · SEC 증거 ·
증거 usability/provenance · source/source_version.

**자격**

- subject가 actual ordinary class
- reference가 같은 issuer의 actual **listed** ordinary class
- 명시된 subject → reference 방향
- 명시된 결정론적 수치 비율
- 그 관계의 reference가 **정확히 하나**
- 재량·공식·security price·미래 사건 의존 없음
- litigation/escrow 의존 가치 없음
- **역방향 추정 없음 · 현재 비율의 과거 backfill 없음**

SEC 소스: `S0` governing instrument(canonical) · `S1` periodic filing의 명시 전환권 ·
`S2` 8-K/proxy의 명시 거래 경계. 웹사이트/vendor는 corroborate만 한다.
**coverage를 구하려고 두 번째 fuzzy/manual 매핑 체계를 만들지 않는다.**

---

## 9. C3 conversion continuity — CLOSED/FROZEN

historical formation valuation은 **법적 전환 관계가 December D를 가로질러 안정적이었다는
증명**을 요구한다.

```text
PRE   legal as-of <= D 인 governing snapshot 중 가장 늦은 것
POST  legal as-of >= D 이고 evidence acceptance <= F 인 것 중 가장 이른 것
```

**둘 다 필요하다.** checkpoint가 되는 것은 **실제 current-in-effect governing
snapshot**뿐이다(charter/articles · complete amended-and-restated governing instrument).
**periodic prose와 Exhibit 4.x description은 checkpoint가 아니다. proposal 텍스트도 아니다.**

비교하는 것은 조항 semantics다 — subject → reference 방향 · 비율 · **단일 reference**.
같으면 continuity를 확인할 수 있고, 바뀌었거나 모호하면 unresolved다.

checkpoint 사이의 amendment 후보는 **전수 탐색**한다(CLOSED된 SEC amendment/증거 family 포함).
**미해결 amendment 후보가 하나라도 있으면 continuity unresolved다.**
**amendment가 발견되지 않았다는 것 자체는 closure가 아니다.**

**나중 filing이 더 이른 formation을 backfill하지 못한다.**
historical formation은 **항상** C3 bracket을 요구한다.
**"오늘 보기에 유효해 보인다"는 이유로 `effective_to = NULL`을 historical 증명으로
쓰지 않는다.**

---

## 10. formation 시점 valuation resolution

`qv_class_valuation_resolutions`는 법적 관계 표와 **분리**돼 있다.
grain은 `formation_session + valuation_date D + class_id + 관련 source version`이다.

```text
OBSERVED_MARKET_PRICE | CONVERSION_VALUE_PROXY | MISSING
```

- **상장 ordinary class** → `OBSERVED_MARKET_PRICE`, 자기 December D raw close
- **자격 있는 비상장 class** → `CONVERSION_VALUE_PROXY`,
  `subject shares × 확인된 고정 비율 × reference listed class의 D raw close`

보존: 선택된 관계(proxy일 때) · C3 pre/post checkpoint · amendment 탐색/continuity 상태 ·
증거 cutoff · 가격/reference provenance · missing 사유 · source versions.

> **법적 관계가 존재해도 PIT 증거나 continuity 증명이 아직 없으면 그 formation의
> valuation은 `MISSING`이다.**
> **상장 class에 가짜 영구 OBSERVED 법적 관계 행을 만들지 않는다.**

---

## 11. class / issuer market equity

**Step 4는 여기서 끝난다.** 모든 금액·주식수 연산은 `Decimal`이고 이진 float가 아니다.

```text
listed  ME_class = 선택된 PIT class shares × 그 class의 December raw_close
proxy   ME_class = 선택된 PIT subject shares × 고정 전환 비율
                     × reference listed class의 December raw_close

ME_issuer = sum(ME_class for D에 활성인 **모든** actual ordinary-common class)
```

> **활성 ordinary class 중 하나라도 주식수나 valuation이 미해결이면 issuer ME는
> 통째로 `MISSING`이다. 아는 부분만 더해 완전한 척하지 않는다.**

보존: class 구성요소 · share-resolution provenance · valuation-resolution provenance ·
price symbol/date/source_version/raw close · 정확한 Decimal ME · issuer 집계 상태 ·
missing 사유. 파생/등가 member는 포함하지 않는다.
**여기서 B/M을 계산하지 않고 issuer를 랭킹하지 않는다.**

`bars_daily.raw_close`가 SQLite `REAL`이라 float 경계가 **한 번** 있다.
`Decimal(str(...))`로 가장 짧은 왕복 표현을 받은 뒤부터는 전부 Decimal 연산이다.
`raw_close_text`는 출처 표현 그대로 보존하고, ME 문자열만 지수 표기 없이 정규화한다.

---

## 12. Step 5 경계

**Step 5가 소유한다**: 최종 formation snapshot · accounting + issuer ME join ·
Q raw value · V raw value · Q/V 백분위 랭크 · 50:50 QV score · 상위 20% 선택 ·
execution-security 선택 · `coverage_start` · Gate A~H 판정 · look-ahead audit/sentinel ·
수익률.

Step 4는 Gate C/F/H가 필요로 하는 **상태 필드를 노출할 수 있지만
그 gate들이 통과했다고 선언하지 않는다.**

---

## 13. 구현 위치

| 계약 | 코드 |
|---|---|
| manifest 정규화·해시·검증·materialize | `trading/backtest/qv_manifest.py` |
| economic class · alias 해석 | `trading/backtest/qv_identity.py` |
| SEC 증거 문서 원장 | `trading/backtest/qv_evidence.py` |
| 주식수 관측 · D0 · 중복 | `trading/backtest/qv_shares.py` |
| 사건 탐색 · 후보 · class 효과 | `trading/backtest/qv_events.py` |
| share-side/market boundary · vendor split | `trading/backtest/qv_boundary.py` |
| EODHD splits adapter | `trading/backtest/eodhd.py` |
| P2 same-regime selector | `trading/backtest/qv_selector.py` |
| 전환 관계 · C3 continuity | `trading/backtest/qv_conversion.py` |
| valuation resolution · class/issuer ME | `trading/backtest/qv_market_equity.py` |
| 스키마 · known-schema migration | `trading/backtest/schema.sql` · `store.py` |
| 계약 회귀 | `trading/tests/test_qv_step4.py` · `test_qv_identity.py` |

---

## 14. 대체된 초기 probe 진술

probe 파일은 연구 기록이므로 다시 쓰지 않는다. **아래는 이 문서가 대체한다.**

| 초기 진술 | 대체 |
|---|---|
| 로드맵 §4.4.1의 단순 December selector("usable filing 중 December 이하 가장 늦은 instant") | **§7 P2 same-regime selector.** freshness·D0·tier·regime 판정이 추가됐고 same-regime이 아니면 더 오래된 후보로 물러선다 |
| `qv_share_classes`가 XBRL axis/member를 직접 들고 있던 모델 | **§1.4** alias 분리. `xbrl_axis`/`xbrl_member` 제거 |
| `qv_class_valuation` 하나가 법적 관계와 사용 가능성을 겸하던 모델 | **§8·§10** 두 표 분리. `qv_class_valuation`은 RETIRED |
| Follow-up 6·7이 남긴 "vendor split_date를 boundary로 쓴다" | **§6** 그대로 유지하되 `available by formation` · 충돌 시 `UNRESOLVED` · 불일치 구간 guard가 추가됐다 |
| Follow-up 7 N15의 META `2013~2026 ELIGIBLE` | **Follow-up 8이 이미 명시적으로 supersede했다.** C3 bracket이 §9의 계약이다 |
