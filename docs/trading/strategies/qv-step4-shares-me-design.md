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
trading/qv/identity/prose_aliases.jsonl
```

**세 파일은 하나의 bundle이다.** 편의를 위해 네 번째 identity 파일을 만들지 않는다.
raw SEC 파일·캐시·materialize된 DB는 git 밖에 남는다.

> **REOPENED → CLOSED (사용자 결정).** 옛 `xbrl_aliases.jsonl`과
> `(issuer, QName, effective_from/effective_to) -> class` 관계는 **은퇴했다.**
> XBRL QName은 economic identity가 아니다 — §1.4를 본다.

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

**issuer 매핑도 예외가 아니다.** `issuers.jsonl` 행 역시 같은 구조화 증거를 들고
`usable_from_session`을 REQUIRED 증거에서 파생한다. `qv_issuers`는 그 값을 컬럼으로
갖고, PIT 문맥의 `get_issuer` / `get_issuer_by_cik`는 그 시점에 아직 못 쓰는 매핑을
보여주지 않는다. **현재 `securities`/ticker 이력을 issuer 증거로 쓰지 않는다.**

### 1.3 economic validity vs knowledge availability

```text
effective_from / effective_to   경제적·법적 관계가 실제로 유효한 기간
usable_from_session             그 증명이 당시 행위자에게 공개된 시점
```

**둘 다 만족해야 쓸 수 있다.** 나중 문서가 더 오래된 법적 상태를 증명할 수는 있어도,
**그 증거가 usable해지기 전 formation으로 backfill되지 않는다.**

### 1.4 economic class vs alias vs **accession binding**

```text
qv_share_classes                  안정된 economic class + ticker/상장/생애   (production identity)
qv_share_class_prose_aliases      PIT SEC prose alias 관계                   (production identity)
qv_xbrl_class_bindings            accession 단위 XBRL binding                (파생 관측)
```

**`qv_share_classes`에서 `xbrl_axis`/`xbrl_member`를 제거했다.** prose alias 표가
canonical bridge의 유일한 소스다.

- 겹치는 여러 prose alias → 같은 class: 허용
- 같은 issuer·시점의 같은 정규화 alias → 2개 이상 class: **AMBIGUOUS / fail-close**
- **alias를 economic class로 만들지 않는다**
- `EquivalentClassAMember` 같은 파생/등가 member는 실제 class가 아니다

#### XBRL QName은 economic identity가 아니다 (REOPENED → CLOSED)

옛 모델은 은퇴했다.

```text
(issuer, QName, effective_from/effective_to) -> economic class      RETIRED
```

```text
economic class / prose identity   production identity — 오래 살고 버전 관리된다
XBRL QName binding                파생 filing-local 관측 — accession 안에서만 참이다
```

**QName이 어느 class를 뜻하는지는 그 관계를 등록인이 명시로 세운 SEC accession
안에서만 참이다.** accession A에서 본 QName은 accession B에 대해 아무것도 말하지
않는다. 같은 exact QName이 두 accession에서 다르게 묶일 수 있고, 그것은 오류가 아니라
정상이다.

```text
최초/최종 관측 수명 없음 · filing 사이 외삽 없음 · 연속성 가정 없음
```

binding의 권한은 **raw SEC K/Q accession + 고정된 economic identity bundle** 둘뿐이고
그 둘에서 재생산 가능한 파생 데이터다. **손으로 유지하는 새 매핑 파일이 아니다.**

`qv_share_class_xbrl_aliases`는 **은퇴했다.** production lookup·materialize 어디에서도
읽지 않고, 새 행을 쓰지 않으며, 옛 행을 binding으로 변환하지도 않는다 — 그 행들이
주장한 것은 alias **수명**이지 accession 안의 관계가 아니다. 기존 DB의 행과 CHECK
제약을 파괴적으로 다시 쓰지 않으려고 표는 물리적으로만 남긴다.
`qv_identity_evidence`의 `XBRL_ALIAS` 어휘도 같은 이유로 legacy 값으로만 남고 **새
행을 쓰지 않는다.**

#### 자동 binding 규칙 — 의도적으로 좁다

한 K/Q accession의 class 축 member는 **그 filing의 구조화 fact가 관계를 명시로
세울 때만** 자동으로 묶인다.

```text
1. QName 모양이 기존 exact QName/D0 규칙을 만족한다
2. 등록인 CIK가 맞는다
3. 그 member에 Security12bTitle 또는 Security12gTitle이 있다
4. 그 제목을 기존 N1 prose_key로 정규화한다
5. 고정된 bundle에서 그 키가 share-fact instant에 **정확히 하나의** class로 풀린다
6. 그 class가 같은 issuer의 것이다
7. 그 class가 그 instant에 활성이다
8. TradingSymbol이 있으면 production class 심볼과 맞는다
9. 제목·심볼·member·anomaly 충돌은 전부 fail-close
10. 기존 표지/주식수 규칙 아래 보통주로 증명된다
```

`TradingSymbol`은 **교차 확인**이지 정체성이 아니다. ticker만으로 묶지 않는다.

**governing instrument만으로는 QName을 묶지 못한다.** charter가 "economic Class B가
존재한다"를 증명해도 "accession X의 `CommonClassBMember`가 그 Class B다"는 증명하지
않는다. 제목 없는 member를 다음으로 만들어내지 않는다.

```text
XBRL member 철자 · class 글자 · COVER_GROUP_LABEL · sibling 순서 · 주식수 ·
ticker 유사도 · governing instrument의 class 이름 유사도
```

명시 filing-local 다리가 없으면 **`UNRESOLVED`이고 그것으로 괜찮다.** accession 단위
사람 판정 기구는 실제 coverage가 요구할 때 따로 설계한다.

#### 해석 grain — 어느 축도 뺄 수 없다

```text
정확한 SEC accession
+ 정확한 instance 문서
+ 정확한 QName
+ 고정된 identity bundle
+ 개별 fact instant
```

**한 accession 안에도 instance 문서가 여럿일 수 있다.** 문서마다 같은 QName이 다르게
묶일 수 있으므로 `instance_document_name`은 자연키이자 **필수 조회 입력**이다. 문서
이름을 빼고 찾는 폴백이 없고 순서로 문서를 고르지 않는다 — 그렇게 하면 다른 문서의
binding이 새거나 멀쩡한 문서-지역 매핑이 `AMBIGUOUS`가 된다.

**binding 행을 찾은 뒤에도 그 fact instant에서 다시 확인한다.** 저장된 canonical prose
키가 그 시점에 **같은 `class_id`로** 풀리고, 그 class가 활성이며 같은 issuer의
보통주여야 한다. 하나라도 어긋나면 다른 class로 바꾸지 않고 더 오래되거나 더 새로운
prose 구간을 대신 쓰지도 않는다 — `UNRESOLVED`이거나 기존 모호 규칙대로 fail-close다.

#### binding 가용성

filing과 identity 다리가 **둘 다** 알려진 뒤에야 쓸 수 있다.

```text
usable_from_session = max(
    filing historical_usable_session,
    matched economic class usable_from_session,
    matched canonical prose relation usable_from_session)
```

손으로 넣지 않는다. **filing 수리 시각을 economic class 유효성으로 쓰지 않는다.**

#### provenance는 호출자가 쓰지 않는다

binding의 권한이 raw accession + 고정 bundle이므로 그 값들을 호출자가 지어낼 수 없다.

```text
instance_document_name   = document.source_file
instance_sha256          = document.sha256
filing usable session    = qv_sec_filings의 그 (cik, accession, source_version) 행
```

filing 원장 조회는 **정확히 한 행**을 요구하고 없으면 fail-close다 — binding은 그
canonical K/Q 기록과 독립해서 존재할 수 없다. 스키마에도 같은 불변식을 FK로 걸었다.

```sql
FOREIGN KEY (cik, accession, filing_source_version)
  REFERENCES qv_sec_filings(cik, accession, source_version)
```

`qv_sec_filings`의 PK가 그대로 `(cik, accession, source_version)`이고
`qv_xbrl_class_bindings`는 이번 재설계에서 새로 생긴 빈 표라 파괴적 migration이 필요
없었다. 코드에서도 같은 불변식을 따로 확인한다(메모리 DB는 FK 강제를 켜지 않는다).

#### 저장 충돌은 fail-close다

```text
같은 자연키 + 같은 내용        멱등 재사용
같은 자연키 + 다른 내용        fail-close — 조용히 덮어쓰지 않는다
다른 instance_document_name    **다른 자연키** — 같은 QName이 다르게 묶여도 정상이다
```

"다른 내용"은 `class_id` · `issuer_id` · canonical prose 키 · binding 방법 ·
instance SHA · raw QName 칸 · 세 usable session이다.

구현은 `trading/backtest/qv_xbrl_binding.py`이고 해석기는
`resolve_accession_member(...)`다. 옛 시간 구간 `qv_identity.resolve_member(...,
as_of=...)`는 은퇴했다. 층은 그대로 나눈다 — **SEC/raw instance ingest → accession
binding 파생 → share observation 추출/해석.** 범용 XBRL 창고를 만들지 않고 QV에
필요한 K/Q accession/member만 다룬다.

### 1.5 XBRL QName 정규화

parser의 진실은 `QName(namespace URI, exact local)` 그대로다. 매칭 키는

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
   그 accession·**그 instance 문서**의 exact XBRL binding → 안정된 `class_id`.
   **binding이 없으면 `UNRESOLVED`다.** 다른 accession·다른 문서의 binding으로 새지
   않고, economic/prose identity 재확인은 **그 fact의 instant**로 한다.
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

구간은 **선택된 filing의 share-basis anchor와 December D 두 끝점에서 정규화**한다.

```text
low  = min(anchor acceptance_eastern_date, D)
high = max(anchor acceptance_eastern_date, D)
탐색 구간 = (low, high]      -- low는 열려 있고 high는 닫혀 있다
```

**방향을 가정하지 않는다.** 후보가 결산 이후 filing이면 `anchor > D`이고 이전 filing이면
`anchor < D`다. 한쪽 방향만 가정하면 반대 방향에서 구간이 뒤집혀 비고, **그 사이 공시를
하나도 읽지 않은 채 `COMPLETE`가 난다.** `±N일` 같은 여유는 없다.

**이 구간은 탐색뿐 아니라 §5.3의 후보 처분(disposition)까지 그대로 간다.** 추출 층에
방향값을 그대로 넘기면 탐색이 올바로 읽어온 문서의 사건이 `EXCLUDED_OUT_OF_WINDOW`로
조용히 버려진다. 정규화는 한 곳(`normalized_interval`)에만 있고 두 층이 그것을 공유한다.

- **closure filing G** = `acceptance_eastern_date >= high`인 **첫 원본** 10-K 또는 10-Q
- G가 없으면 `INCOMPLETE`
- G의 acceptance가 formation F보다 늦으면 `INCOMPLETE`
- 탐색 범위는 `(low, G.acceptance]`의 모든 `10-K / 10-K/A / 10-Q / 10-Q/A`
- **amendment는 증거이지만 절대 closing filing G가 될 수 없다**
- 완전 탐색에 필요한 문서가 없거나 실패하면 `INCOMPLETE`

> **metadata closure만으로 `COMPLETE`가 되지 않는다.** 구간 안 모든 필수 accession이
> **실제로 읽히고 discovery/extraction을 통과했다는 증명**(`processed_accessions`)이
> 있어야 하고, 필요한 문서를 하나라도 못 읽으면(`failed_accessions`) `INCOMPLETE`다.
> 저장 경계(`store_search`)가 이 불변식을 강제하므로 처리 증명 없는 `COMPLETE`는
> 영속화되지 않는다. production 경로는 `run_share_basis_search`이고 문서 획득은
> 호출자의 loader가 맡는다 — 범용 SEC 크롤러를 만들지 않는다.

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

> **형제가 긍정으로 지목됐다는 사실은 negative 증거가 아니다.**
> `20-for-one split on each share of Class A stock`는 그 자체로
> `Class B의 share-unit basis가 바뀌지 않았다`를 증명하지 않는다. 공시가 다른 class를
> 지목했을 뿐 대상 class에 대해 아무 말도 하지 않으면 **`UNRESOLVED`다.**
>
> 명시 부정 표현은 **문법 방향으로 두 family**를 둔다. 실제 공시가 두 모양을 다 쓴다.
>
> ```text
> OBJECT형  "The Class B stock split had no effect on ... Class A common shares"
>           -> 영향받지 않는 class가 표현 뒤에 온다
> SUBJECT형 "Holders of class B and C common stock did not receive a stock dividend"
>           -> 영향받지 않는 class가 표현 앞에 온다
> ```
>
> 목록에 없는 표현은 negative 증거가 아니고 점수를 매기지 않는다. 같은 이름이 긍정·부정
> 양쪽에 걸리면 그 class는 결정되지 않는다.

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
- **그 vendor row가 지금 평가 중인 확인된 SEC 사건의 것이어야 한다.**
  `formation 이전 마지막 split`을 묵시적 연결 규칙으로 쓰지 않는다. 연결이 성립하는
  경우는 둘뿐이다 — PIT scope 안 후보가 **정확히 하나**이거나, explicit SEC
  `TRADING_SPLIT_ADJUSTED`가 후보 하나와 **정확히 일치**할 때다. 그 밖에는
  `UNRESOLVED`이고 새 매칭 휴리스틱을 만들지 않는다
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

> **구조적 존재 판정은 class 해석 실패보다 먼저 온다.** 후보를 `class_id`로 먼저 거르면
> D0/alias 해석에 실패해 `class_id`가 NULL인 fresh A가 시야에서 사라지고 선택기가 B로
> 내려간다 — 그것이 정확히 금지된 fallback이다. 따라서 scope는 issuer(CIK) 단위로 읽고,
> **이 class로 풀린 A**와 **아직 어느 class인지 모르는 A** 둘 중 하나라도 있으면 A tier가
> 소유한다. **다른 class로 명시적으로 풀린 A는 이 class의 구조적 존재가 아니다** —
> 그것까지 세면 무관한 class 때문에 전부 막힌다.

**same-regime 판정** — 후보 filing basis anchor의 regime과 D의 regime을 견준다

```text
coverage != COMPLETE                  -> 사용 불가 / fail-close
적용 가능한 UNRESOLVED 효과            -> 사용 불가 / fail-close
(low, high] 안 확인된 적용 가능 변경   -> 다른 regime / 사용 불가
COMPLETE + 미해결/변경 없음            -> same regime
```

후보의 basis anchor는 그 filing의 acceptance 체제다. **판정 구간은 §5.1과 같은 정규화
구간 `(min(anchor, D), max(anchor, D)]`이고 방향을 가정하지 않는다** — 두 층이 같은
헬퍼를 쓰므로 어긋날 수 없다. **구간 밖의 사건은 후보와 D의 관계를 바꾸지 않는다.**

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

**`usable_from_session`은 호출자가 넣는 값이 아니다.** canonical SEC 증거(S0/S1/S2)의
REQUIRED 항목에서 파생하고, 증거는 `qv_identity_evidence`에
`relation_kind = CONVERSION_RELATION`으로 남는다. 전환 관계를 네 파일 identity
manifest에 넣지 않고 범용 증거 창고도 만들지 않는다.

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

> 그래서 continuity는 **명시적 탐색 receipt**를 요구한다. `AmendmentSearch.coverage`가
> `COMPLETE`일 때만 확인될 수 있고, `NOT_SEARCHED`/`INCOMPLETE`/부재는 전부
> `UNRESOLVED`다. **빈 Python 목록에서 COMPLETE를 추론하지 않는다.** 탐색한 accession은
> `qv_class_valuation_resolutions.amendment_searched_accessions`에 남는다.

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

**reference listed class도 PIT를 통과해야 한다** — actual ordinary common · D에 활성 ·
같은 issuer · **identity가 formation 시점에 usable**. 하나라도 아니면 그 formation의
valuation은 `MISSING`이다. subject만 PIT로 보고 reference를 그냥 받으면 lookahead가 열린다.

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
| PIT 시간 구간 XBRL alias 관계 | **§1.4 REOPENED → CLOSED.** accession 단위 filing-local binding으로 교체. `xbrl_aliases.jsonl` 삭제, bundle은 세 파일 |
| `qv_class_valuation` 하나가 법적 관계와 사용 가능성을 겸하던 모델 | **§8·§10** 두 표 분리. `qv_class_valuation`은 RETIRED |
| Follow-up 6·7이 남긴 "vendor split_date를 boundary로 쓴다" | **§6** 그대로 유지하되 `available by formation` · 충돌 시 `UNRESOLVED` · 불일치 구간 guard가 추가됐다 |
| Follow-up 7 N15의 META `2013~2026 ELIGIBLE` | **Follow-up 8이 이미 명시적으로 supersede했다.** C3 bracket이 §9의 계약이다 |
