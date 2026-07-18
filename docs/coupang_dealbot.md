# 딜 스카우트 에이전트 설계·검증 문서

갈피 V5-A — 쿠팡 파트너스 기반 니치 가격 관측·딜 큐레이션 에이전트

작성일: 2026-07-18 · 최종 검토: 2026-07-18 · 상태: **조건부 진행, Phase -1 착수 전**

---

## 0. 결정 요약

이 프로젝트는 유지할 가치가 있다. 다만 현재 확인된 가치는 곧바로 제휴 수익을 내는 봇이 아니라 아래 순서다.

1. 공식 API가 동일한 상품·옵션·판매자·배송 조건의 가격을 반복 비교할 만큼 안정적인지 확인한다.
2. `정기 실행 → 외부 데이터 격리 → 결정적 판정 → 승인 → 외부 행동 → 결과 대사`라는 전문 에이전트 공통 패턴을 저위험 도메인에서 검증한다.
3. 실제 노출·클릭·구매·취소 후 순수수료가 쌓인 뒤에만 운영비 충당 가능성을 판단한다.

따라서 **기술 실효성은 검증 가치가 높고, 사업 실효성은 아직 판단 불가**다. 2주 무게시 수집은 데이터 공급과 후보 빈도만 검증한다. 도달·클릭·전환·수익은 게시 단계의 별도 실험이다.

Phase 0은 LLM 판단과 외부 행동이 없는 결정적 수집 workflow이지 완성된 자율 에이전트는 아니다. 여기서는 실행·격리·재현성만 검증하고, 후보 생성→사람 승인→게시 receipt→성과 대사까지 이어지는 Phase 2부터 전문 에이전트 패턴 전체를 평가한다.

로드맵상 위치는 V4.5와 V4-B 음성 뒤, 주식 분석 에이전트 앞의 **V5-A 첫 전문 에이전트**다. 다만 게시·LLM·갈피 데이터 접근이 없는 Phase -1과, API 키가 이미 있거나 예외 승인을 받은 경우의 Phase 0은 A1b 실사용 관찰과 격리해 먼저 수행할 수 있다.

```text
V4.5 기억·trace·task
  → V4-B 음성
  → V5-A 딜 스카우트
      Phase -1 API·정책 feasibility
      Phase 0 2주 관측
      Phase 1 replay·니치 확정
      Phase 2 draft-only·사람 승인 게시
      Phase 3 bounded auto-post 검토
      Phase 4 예산 대사·조건부 확장
  → V5-B 주식 분석
  → V5-C 후속 전문 에이전트
```

공통 agent runtime을 먼저 만들지는 않는다. 딜 스카우트가 Phase 2까지 실제로 돈 뒤 검증된 seam만 주식 에이전트로 추출한다.

## 1. 실효성 판정

|축|현재 판정|무엇으로 확인하는가|
|---|---|---|
|API 수집 가능성|조건부|실제 계정·키로 공식 파트너스 API 응답과 호출 한도 확인|
|가격 비교 가능성|미확인·핵심 위험|안정된 offer 식별자, 가격·배송비·할인 필드, 반복 관측 일치율|
|니치 딜 공급|미확인|2주 관측의 비교 가능 offer 수와 후보 빈도|
|큐레이션 품질|미확인|replay 후보 30개 수동 검토와 치명적 오판 0건|
|채널 수요|Phase 0에서 측정 불가|승인 게시의 노출·outbound click·저장·반응|
|제휴 수익|Phase 0에서 측정 불가|주문·취소·반품을 반영한 순수수료와 실제 비용|
|정책·계정 안정성|조건부·게시 단계 핵심 위험|미디어 등록, 고지 100%, 정책 경고 0건, 적용 원문 snapshot|
|주식 에이전트 리허설|조건부 유효|Phase 0의 run 경계와 Phase 2의 승인·receipt·감사 seam 재사용성|

가장 큰 실패 가능성은 코드가 아니라 **동일 offer를 정확히 식별하지 못하는 것**과 **좋은 후보가 실제 클릭·구매로 이어지지 않는 것**이다. 안정된 옵션·판매자 식별자가 없으면 제목 문자열을 억지로 합치지 않고 가격 비교 프로젝트를 중단하거나 단순 골드박스 알림으로 축소한다.

## 2. 공식 근거와 확인 수준

2026-07-18 공개 원문으로 다시 확인한 범위다. 정책 해석은 법률 자문이 아니며, 실제 게시 직전 적용 중인 약관과 계정 대시보드를 다시 확인한다.

### 확인됨

- 쿠팡의 [공개 이용가이드](https://partners.coupangcdn.com/partners-guide/partners-guide-20250324160743.pdf)는 파트너스 API를 **“무료로 제공되는 Open API”**라고 설명하고 골드박스 상품 리스트 등을 예시로 든다. [공식 API 가이드](https://partners.coupang.com/api/v1/configuration/content/OPEN_API_GUIDE)는 원칙적으로 최종 승인 회원에게만 API를 제공한다고 명시한다.
- [공식 API 스펙](https://partners.coupang.com/api/v1/configuration/content/OPEN_API_SPEC)에는 키워드 상품 검색, 골드박스, 카테고리별 베스트, PL 상품, 딥링크, 추천과 클릭·주문·취소·수익 리포트가 있다. 리포트 endpoint의 존재는 확인됐지만 게시물별 상관키, 집계 차원·지연·취소 귀속은 아직 확인되지 않았다.
- [2026-06-08 적용 운영정책](https://partners.coupang.com/api/v1/configuration/content/operating_policy)은 별도 요율이 없을 때 결제금액의 3%를 지급한다고 명시한다. 다만 별도 요율과 변경 가능성이 있으므로 코드에는 현재 요율표를 설정·증거와 함께 넣고 3%를 영구 상수로 박지 않는다.
- 같은 [운영정책](https://partners.coupang.com/#help/operating-policy)은 모든 광고 미디어 등록을 요구하고, 금지 예시에 **“메일, 메신저, SMS 등을 이용하여 클릭을 요청하는 메시지를 발송하는 행위”**를 명시한다. 자동 클릭·자동 브라우징·클릭 교환과 도배성·광고 편중 콘텐츠도 제한한다. 이 클릭 요청 유형은 정책의 A급 제재표상 1회 최근 14일 수익 취소, 2회 최근 30일 수익 취소와 계정 해지 대상이므로 메시지 배포 경로는 쓰지 않는다.
- Meta의 [Threads API 시작 문서](https://developers.facebook.com/documentation/threads/get-started)는 OAuth 기반의 프로그래밍 게시를 설명한다. 자체 계정 게시에는 `threads_basic`, `threads_content_publish` 권한이 필요하고, [publishing reference](https://developers.facebook.com/documentation/threads/reference/publishing)는 텍스트 자동 발행을 지원한다.
- [Threads API overview](https://developers.facebook.com/documentation/threads/overview)의 API 게시 상한은 rolling 24시간 250건이며 별도 호출 한도도 있다. 제품 내부 상한은 이보다 훨씬 낮게 둔다.
- 국가법령정보센터의 현행 [「추천·보증 등에 관한 표시·광고 심사지침」](https://www.law.go.kr/LSW/admRulInfoP.do?admRulSeq=2100000280130)은 2026-06-01 시행판이며, 경제적 이해관계가 있는 추천·보증 표시의 공개 경계를 둔다.

### 아직 재현 불가 또는 미확인

- 운영정책 원문 URL은 확인했지만 변경 추적용 snapshot hash는 아직 없다. 게시 전 적용일·확인일·원문 SHA-256을 비공개 운영 기록으로 남긴다.
- [공식 상품 응답 스펙](https://partners.coupang.com/api/v1/configuration/content/OPEN_API_SPEC)에는 상품 ID·이름·가격·URL·이미지·카테고리·로켓 여부·무료배송 여부가 있으나 판매자 ID·공식판매자 여부·옵션·용량·유료 배송비 금액·할인 구조는 확인되지 않는다. 현재 API만으로 향수 판매자 신뢰 필터나 ml당 가격을 구현할 수 없고, 무료배송이 아닌 상품의 실효가격도 바로 확정할 수 없다.
- 현재 [공식 스펙](https://partners.coupang.com/api/v1/configuration/content/OPEN_API_SPEC)은 상품 검색을 분당 50회로 표기하지만 [과거 공개 가이드](https://partners.coupangcdn.com/partners-guide/partners-guide-20240716100922.pdf)는 검색 시간당 10회·리포트 시간당 50회·그 외 시간당 100회로 표기한다. 실제 키 발급 뒤 로그인 문서·응답 헤더와 보수적 하한으로 확정한다.
- [공개 이용가이드](https://partners.coupangcdn.com/partners-guide/partners-guide-20250324160743.pdf)는 최종 승인을 누적 판매금액 15만 원부터 자동 검토한다고 설명한다. 승인 전 API 예외 검토 경로가 있지만 승인은 보장되지 않는다.
- 공개 정책은 미디어 운영기간·공개 콘텐츠 수·적합성을 심사 요소로 두지만 공개 숫자 통과선은 확인되지 않았다. 근거 없는 “계정 N일 숙성” 규칙을 만들지 않는다.
- 정산 1만 원 경계의 표현도 운영정책과 이용가이드가 정확히 일치하지 않아 지급 직전 포털 기준을 따른다.
- Meta 공식 문서에서 Threads API의 별도 사용료나 영구 무료 보장은 확인되지 않았다. `0원`은 잠정 가정일 뿐이다.
- Threads API의 기술적 자동 게시 지원은 상업적 제휴 링크 반복 게시의 정책 적합성을 보장하지 않는다.
- 자체 Threads Tester 역할 계정은 외부 사용자용 App Review 없이 권한을 시험할 수 있지만, 역할이 없는 외부 계정으로 확장할 때는 [별도 App Review](https://developers.facebook.com/documentation/resp-plat-initiatives/individual-processes/app-review)가 필요하다. 실제 앱 설정에서 재확인한다.
- 쿠팡 단축·redirect 링크의 Threads 미리보기 성공 여부와 외부 링크 게시물의 도달 성과는 실제 계정에서 측정해야 한다.
- 링크 없는 통계 글이 광고 비중이나 스팸 판정을 완화한다는 공식 근거는 없다. 정책 회피 수단으로 만들지 않는다.

### 실행 금지선

- 공개 문서에 없는 기능을 크롤링이나 비공식 API로 대체하지 않는다.
- 자동 클릭, 클릭 요청 메시지 발송, 자기 링크 클릭, 성과 조작은 구현하지 않는다.
- 미디어 등록·대가성 고지·Threads 약관을 재확인하기 전에는 외부 게시하지 않는다.
- 정책 문구를 “탐지 회피” 방식으로 해석하지 않는다. 게시 빈도와 콘텐츠 품질은 사용자 가치와 명시적 내부 상한으로 통제한다.

## 3. 가격 주장 경계

Phase 0의 데이터만으로 `역대가`, `시장 최저가`, `진짜 특가`라고 부르지 않는다. 기본 라벨은 **“동일 offer의 N일 관측 최저 실효가격 후보”**다.

비교 단위인 `offer_key`의 목표 형태는 아래 값의 결합이다.

```text
source + product_id + option_id + seller_id + fulfillment
```

offer 비교 규칙:

1. 상품, 옵션·용량·묶음 수, 판매자, 배송 방식이 같은 관측만 비교한다.
2. `api_price`는 공식 응답의 가격 필드를 변형 없이 저장하고, `price_basis`에 원본 필드명과 할인 포함·제외 의미를 버전으로 고정한다.
3. 실효가격은 `api_price + 확인된 필수 배송비 - api_price에 아직 포함되지 않았다고 공식 문서로 확인된 보편 즉시 할인`이다. 할인 포함 여부가 불명확하면 다시 빼지 않는다.
4. 무료배송 `true`일 때만 배송비를 0으로 확정한다. 무료배송이 아니면서 숫자 배송비가 없거나, 가격·할인 의미가 불명확하면 `comparable=false`로 닫는다.
5. 와우회원가, 카드 할인, 개인 쿠폰, 적립금은 실효가격에 합치지 않고 별도 조건으로 기록한다.
6. 현재 관측값을 제외한 과거 동일 offer의 실효가격과만 비교한다. 1%·3%·5%·10% 하락률도 이 값으로 계산한다.
7. 서로 다른 7일 이상, 과거 관측 24회 미만이면 후보 판정을 보류한다.
8. 검색 결과에서 사라진 상품을 품절이나 가격 상승으로 추정하지 않는다.
9. 게시 직전에 같은 offer의 가격·판매 상태·제휴 URL을 다시 확인한다.
10. 단위가격은 구조화된 수량·단위가 있을 때만 계산한다. LLM으로 용량을 추측하지 않는다.
11. 로켓배송은 배송 조건이지 정품 증명이 아니다. 향수의 신뢰 필터는 확인된 공식 판매자 allowlist가 있을 때만 사용한다.

`product_id` 하나만으로는 옵션·판매자·배송 조건의 동일성을 증명할 수 없으므로 대체 키로 허용하지 않는다. 실제 계정 응답 또는 공식 endpoint에서 `product + option + seller + fulfillment`을 안정적으로 식별하는 필드나 그 결합과 동등하다고 공식 문서에 정의된 immutable offer ID를 확보하지 못하면, Phase -1에서 강한 가격 비교를 **NO-GO/PIVOT**한다. 제목 유사도로 자동 병합하지 않고 Phase 0 가격 시계열도 시작하지 않는다.

향수는 판매자 신원과 용량을 공식 응답에서 확인할 수 없으므로 기본 Phase 0 니치에서 제외한다. 신뢰 가능한 별도 공식 데이터 경로를 확보하기 전에는 “사도 되는 향수”를 주장하지 않는다.

## 4. 격리 아키텍처

같은 Pi와 Node.js 저장소는 사용할 수 있지만 운영 상태는 갈피와 분리한다.

```text
파트너스 공식 API
  → one-shot collector
  → immutable raw snapshot + SHA-256
  → dealbot.db
  → deterministic replay/scorer
  → 내부 후보 보고서
  → 사람 승인
  → Threads publisher (Phase 2 이후)
```

- 별도 DB `dealbot.db`, 별도 raw snapshot·로그·백업 경로를 쓴다.
- 키는 별도 권한 `600` 환경 파일에 두고 로그·DB·vault에 기록하지 않는다.
- Phase 0은 `galpi.db`와 `galpi-vault`를 읽거나 쓰지 않는다.
- 별도 one-shot service와 systemd timer로 실행하며 동시 실행을 거절한다.
- timeout, 재시도 횟수, 실행당·일일 API 호출 상한, idempotency key를 코드가 집행한다.
- dealbot 실패가 `galpi.service` 재시작이나 갈피 DB transaction을 유발하지 않는다.
- 외부 응답은 데이터이지 명령이 아니다. 응답 안의 지시문은 실행·저장 정책을 바꾸지 못한다.
- Phase 2 이후 검증된 결과만 단방향 bridge를 통해 예정된 `agent_report` 노트로 전달한다. 이 note type은 아직 구현된 schema가 아니다.
- 사람 작성 지식을 쓰게 되면 명시적 allowlist 폴더만 읽기 전용으로 연다.

Phase 0 최소 스키마는 세 테이블이다.

```text
collection_runs
  run_id, niche, endpoint
  started_at, finished_at, status, http_status, latency_ms
  result_count, accepted_count, error_code
  collector_version, raw_snapshot_path, raw_sha256

offers
  offer_key, product_id, option_id, seller_id, fulfillment
  title, option_text, quantity_value, quantity_unit
  first_seen_at, last_seen_at

price_observations
  run_id, offer_key, observed_at
  api_price, shipping_fee, universal_discount, effective_price
  unit_price, price_basis, availability
  comparable, reject_reason
```

`price_basis`는 원본 가격 필드명, API 가격의 할인 포함 여부, 배송비·할인 근거와 mapping version을 기록한다. 어느 구성요소의 의미라도 불명확하면 `effective_price`를 후보 판정에 쓰지 않고 `comparable=false`로 남긴다. 후보는 원본 관측에서 결정적으로 재계산할 수 있으므로 Phase 0에는 candidate·persona·ledger 테이블을 만들지 않는다.

## 5. Phase -1 — 접근·정책 feasibility

코드 착수 전에 아래를 실제 계정과 공식 문서로 확인한다.

- 최종 승인 또는 승인 전 API 예외 검토 가능 여부와 허용된 사용 목적
- 공개 이용가이드의 누적 판매금액 15만 원 승인 조건이 현재 계정에도 적용되는지
- 골드박스·검색·카테고리 endpoint의 실제 path, HMAC 방식, 응답 필드, 호출 한도
- stable product·option·seller·fulfillment 식별자 또는 공식적으로 동등한 offer ID와 가격·배송비·할인·제휴 URL 필드
- 가격 필드가 어떤 할인을 포함하는지와 무료배송 `false`일 때 배송비 숫자를 얻을 수 있는지
- 수수료·정산·미디어 등록·최종 승인 규칙과 리포트 endpoint 접근
- 허용된 `subId`·tracking code 같은 상관키, 리포트 집계 단위·지연, 주문·취소·반품 귀속 수준
- 적용 중인 운영정책의 URL·적용일·확인일·문서 hash
- raw payload 3종을 비공개 fixture로 저장할 수 있는지

API 키가 없다면 Phase 0보다 먼저 수동으로 유용한 미디어를 운영해 정식 승인 요건을 충족하거나 예외 검토를 요청해야 한다. 승인·예외 검토가 되지 않으면 수집기를 만들지 않는다. 안정된 offer와 실효가격을 만들 수 없거나 API 접근이 허용되지 않으면 **NO-GO/PIVOT**이며 크롤러로 우회하지 않는다. 게시별 상관키가 없으면 게시별 클릭·주문 성과를 주장하지 않고, 공식 리포트가 지원하는 채널·기간 단위까지만 측정한다.

## 6. Phase 0 — 2주 무게시 관측

Phase -1 샘플에서 상품 구성이 단순하고 비교 가능한 후보 2~3개 니치를 고른 뒤 1시간 고정 주기로 수집한다. PC 주변기기·게이밍 기어와 음향기기는 초기 후보지만 실제 필드를 보고 확정한다. 판매자·용량을 확인할 수 없는 향수는 제외한다. 예산 로직이 주기를 바꾸지 못하며 게시, LLM, Threads, vault 연결은 없다.

아래 수치는 업계 표준이 아니라 **착수 전에 동결하는 실험 기준선**이다.

### 기술 GO

- 예정 실행 대비 성공률 95% 이상
- raw 응답 건수와 DB 처리·거절 건수 reconciliation 100%
- 같은 run·offer의 논리 중복 insert 0건
- 반환 관측 중 안정된 offer와 실효가격 구성 가능 비율 80% 이상
- 니치당 최소 50개 offer가 서로 다른 7일 이상·24회 이상 관측됨

### 품질 GO

- 실효가격의 1%·3%·5%·10% 하락 기준별 후보 수와 오류 민감도 표 생성
- 동결된 scorer가 만든 후보 30개 이하면 전부, 넘으면 `raw_sha256` seed의 결정적 표본 30개 수동 검토
- 옵션·판매자·배송비가 뒤섞인 치명적 오판 0건
- 후보 정밀도 = `같은 offer·유효한 실효가격·게시 가능한 주장`을 모두 만족한 후보 수 ÷ 동결된 검토 표본의 전체 생성 후보 수. 사람의 승인·거절과 무관하게 90% 이상
- 선택할 니치에서 서로 다른 상품 기준 게시 가능 후보 주 3건 이상

### 판정

- **GO:** 기술·품질 기준 모두 통과 → Phase 1
- **EXTEND:** 비교 구조는 유효하고 관측량만 부족 → 같은 기준으로 2주 한 번만 연장
- **FIX/REPEAT:** 수집 성공률·reconciliation·중복·replay 같은 구현·운영 지표만 실패 → 원인을 고친 뒤 전체 관측 기간을 새 run으로 다시 시작
- **NO-GO/PIVOT:** offer 식별자 또는 가격 의미 불명확, 비교 가능률 80% 미만, 치명적 오판 발생 같은 데이터·도메인 한계
- **사업성 판단 보류:** Phase 0 결과만으로 수익 가능성을 선언하지 않음

## 7. 발전 단계와 승격 조건

### Phase 1 — replay·니치 확정

같은 raw snapshot을 같은 collector/scorer 버전으로 재실행해 결과가 결정적인지 확인한다. 니치별 후보 빈도·단가·비교 가능률·수동 정밀도를 비교하고 하나만 선택한다. 가격 하락 임계값은 민감도 표를 본 뒤 동결한다.

통과 조건은 위에서 정의한 동결 표본의 후보 정밀도 90% 이상, 치명적 비교 오류 0건, 주 3건 이상의 게시 가능 후보, 동일 입력 replay 결과 일치다.

### Phase 2 — draft-only·사람 승인 게시

처음부터 LLM과 자동 게시를 붙이지 않는다. 구조화 사실로 만든 템플릿 초안을 사람이 검토하고 승인한 건만 게시한다.

- 게시 직전 가격·offer·URL 재검증
- 관측 기간과 관측 시각을 명시하고 `역대가` 표현 금지
- 모든 제휴 게시에 대가성 고지를 소비자가 쉽게 인식할 위치에 자동 삽입
- 실제 Threads 계정을 파트너스 광고 미디어로 등록하고 승인·검토 상태 확인
- 자체 Threads Tester 계정, OAuth 권한, 장기 토큰 갱신·권한 만료 알림 확인
- 실제 쿠팡 제휴 링크 1개의 게시·redirect·미리보기 검증
- `/threads_publishing_limit` 확인과 별도의 보수적 일일 게시 상한
- post ID, candidate 근거 hash, 승인자, 게시 시각, 당시 가격을 감사 로그로 기록
- 링크 없는 통계 글은 실제 정보 가치가 있을 때만 게시하고 정책 회피용 filler로 만들지 않음

LLM 코멘트는 템플릿보다 사람 평가가 좋아진다는 증거가 생긴 뒤 검토한다. 사용하더라도 구조화된 사실을 짧게 표현할 뿐 가격 판정·판매자 신뢰·게시 여부를 바꾸지 못한다.

### Phase 3 — bounded auto-post 검토

최소 30건의 승인 게시에서 가격 정정, 근거 없는 주장, 중복 게시, 대가성 고지 누락, 정책 경고가 모두 0건이어야 한다. 이 승인 게시 표본과 별도로, 같은 기간 승인 전에 생성된 전체 후보에서 동결한 새 결정적 표본 30개의 후보 정밀도가 90% 이상일 때만 검토한다.

- kill switch와 feature flag
- 낮은 일일 게시 상한과 동일 offer 중복 차단
- 가격·URL 재검증 실패 시 fail-closed
- 정책·임계값·예산 상향은 사람 승인 없이 변경 불가
- 외부 post receipt가 없으면 성공 처리하지 않음

API의 250건 한도는 목표가 아니라 플랫폼 최대치다. 제품 내부 상한은 실제 채널 품질 기준으로 훨씬 낮게 둔다.

### Phase 4 — 예산 대사·조건부 확장

수입은 클릭 추정치가 아니라 취소·반품을 반영한 확정 수수료로 기록한다. 지출은 API·모델·플랫폼·저장 비용을 실제 청구 기준으로 기록한다.

예산 로직이 바꿀 수 있는 것은 실행 빈도와 선택적 코멘트 모델 등급뿐이다. 가격 판정선, 품질 기준, 대가성 고지, 게시 상한은 바꿀 수 없다. 첫 니치의 순기여와 품질 추세가 확인된 뒤에만 두 번째 니치나 X를 검토한다.

## 8. 사업성 측정

사업 가설은 아래 funnel로 분해한다.

```text
예상 수수료
  = 노출 × outbound CTR × 구매 전환율 × 평균 인정 주문액 × 실효 수수료율

순기여
  = 확정 수수료 - API·모델·플랫폼·저장 비용
```

Phase 2 시작 전에 실제 운영비와 필요한 break-even funnel을 계산하고 아래 값을 숫자로 사전 등록한다. 공식 리포트의 귀속 수준을 확인하기 전에는 값을 임의로 채우지 않으며, 빈칸이 남아 있으면 게시 실험을 시작하지 않는다.

- 1차 평가 기간(기본안: 첫 승인 게시부터 12주)
- 최소 승인 게시 수, 공식적으로 귀속 가능한 outbound click 수, 확정 주문 수
- 허용 가능한 누적 순손실과 즉시 중단선
- 게시별·채널별·기간별 중 실제 지원되는 attribution 단위
- 개선 추세 계산법: 마지막 4주의 CTR·구매전환·순기여를 첫 4주와 같은 attribution 단위로 비교

Phase 0의 후보 수로 CTR·전환율을 대신하지 않는다. 정확한 최소 클릭·주문 표본은 Phase -1의 리포트 차원과 Phase 1의 후보 공급, Phase 2 전 비용을 본 뒤 동결해야 하므로 현재 문서에서는 미정이다.

측정 항목:

- 후보 수, 승인율, 거절 사유, 가격 정정률
- Threads가 제공하는 단위의 노출, 저장·답글 등 채널 반응
- 공식 상관키가 지원하는 가장 세밀한 단위의 outbound click·주문·취소·반품·확정 수수료·실효 수수료율
- 실행별 API·모델 비용과 월 순기여
- 정책 경고·게시 실패·토큰 갱신 실패

12주에 사전 등록한 최소 표본을 채웠고도 순기여가 음수이며 위 4주 비교에서도 개선이 없으면 종료하거나 비게시 가격 데이터 프로젝트로 축소한다. 최소 표본을 못 채우면 성공으로 해석하지 않고, 같은 종료선으로 한 번만 연장할지 종료할지 결정한다. 게시별 상관이 지원되지 않으면 채널·기간 수준 결과만 보고하며 다른 미디어 성과와 섞인 값을 이 에이전트의 실적으로 귀속하지 않는다.

## 9. 주식 에이전트로 넘길 것

딜 스카우트 Phase 2 이후 실제로 검증된 아래 seam만 공통 agent runtime 후보가 된다.

- one-shot run contract와 `run_id`
- timeout, bounded retry, idempotency, receipt 확인
- 실행당·일일·월간 비용·호출 상한
- 외부 콘텐츠를 비신뢰 데이터로 취급하는 경계
- 구조화 근거가 붙은 candidate/report
- 사람 승인 큐, kill switch, 감사 로그
- 결과 대사와 전략별 성적표

쿠팡 offer schema, 제휴 링크, Threads 게시, 니치 persona는 주식 에이전트와 공유하지 않는다. 첫 구현 전부터 범용 framework를 만들지 않는다.

## 10. 공식 출처

확인일은 모두 2026-07-18이다.

- [쿠팡 파트너스 공식 사이트](https://partners.coupang.com/)
- [쿠팡 파트너스 운영정책 2026-06-08 적용판](https://partners.coupang.com/#help/operating-policy)
- [쿠팡 파트너스 운영정책 원문 JSON](https://partners.coupang.com/api/v1/configuration/content/operating_policy)
- [쿠팡 파트너스 Open API 문서](https://partners.coupang.com/#help/open-api)
- [쿠팡 파트너스 Open API 공식 스펙 JSON](https://partners.coupang.com/api/v1/configuration/content/OPEN_API_SPEC)
- [쿠팡 파트너스 Open API 가이드](https://partners.coupang.com/api/v1/configuration/content/OPEN_API_GUIDE)
- [쿠팡 파트너스 공개 이용가이드 2024.12](https://partners.coupangcdn.com/partners-guide/partners-guide-20250324160743.pdf)
- [쿠팡 파트너스 과거 공개 API 가이드(쿼터 비교용)](https://partners.coupangcdn.com/partners-guide/partners-guide-20240716100922.pdf)
- [Threads API 시작·권한·토큰](https://developers.facebook.com/documentation/threads/get-started)
- [Threads API 호출·게시 한도](https://developers.facebook.com/documentation/threads/overview)
- [Threads 게시 형식·링크](https://developers.facebook.com/documentation/threads/posts)
- [Threads publishing reference](https://developers.facebook.com/documentation/threads/reference/publishing)
- [Meta App Review](https://developers.facebook.com/documentation/resp-plat-initiatives/individual-processes/app-review)
- [Threads 이용약관](https://help.instagram.com/769983657850450)
- [국가법령정보센터, 추천·보증 등에 관한 표시·광고 심사지침](https://www.law.go.kr/LSW/admRulInfoP.do?admRulSeq=2100000280130)

실제 키 발급 뒤 계정 전용 API 문서의 revision·쿼터와 샘플 payload hash를 비공개 운영 증거에 추가한다.
