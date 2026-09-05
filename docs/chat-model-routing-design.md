# 갈피 단일 GPT 채팅·모델 라우팅 설계

> Version: 1.0  
> Date: 2026-07-28  
> Status: M0~M5 implementation and combined Pi deployment accepted  
> Scope: 메인 채팅, OpenAI 모델 카탈로그, 의회 퇴역, 사서 Codex 모델 설정

---

## 0. 결정 요약

1. 메인 채팅은 기존 OpenAI API 키를 재사용하는 **단일 GPT 채팅**으로 전환한다.
2. ChatGPT 구독 계정은 메인 채팅 API 호출에 사용하지 않는다. OpenAI 공식 안내도 API가 ChatGPT와 “billed and managed separately”라고 명시한다.[^openai-billing] Codex CLI의 ChatGPT 로그인은 별도 실행 경계로 유지한다.
3. 대화 정본은 기존 `shared-main` 하나를 유지한다. 채팅방 목록이나 대화 분기는 이번 범위에 넣지 않는다.
4. 모델 변경은 현재 생성 중인 답변이 아니라 **다음 답변부터** 적용한다.
5. 기본값은 `자동`이며, 의미는 “갈피의 호환성 검증을 통과한 최신 균형형 모델”이다.
6. 수동 모델을 선택하면 해당 정확한 model ID에 고정한다. 새 모델이 발견돼도 조용히 바꾸지 않는다.
7. 신규 의회 실행 UI·API·Claude/GPT 합성 호출은 없앤다. 기존 의회 대화·transcript·노트·검색·렌더링은 그대로 읽을 수 있게 보존한다.
8. 에이전트 창에는 일정 에이전트 아래에 `사서 Codex` 블록을 추가하고, 일반 정리와 깊은 재정리 모델을 각각 선택하게 한다.
9. API 채팅 모델 카탈로그와 Codex 구독 모델 카탈로그는 합치지 않는다.
10. 강의·주식처럼 재현성이 중요한 작업은 채팅의 `자동 최신`을 상속하지 않는다. 강의는 job 단위, 주식 Champion은 PolicyVersion 단위로 정확한 모델을 고정한다.
11. Claude와 GPT의 별도 품질 A/B는 하지 않는다. GPT 전환 결정은 끝났으며, M2는 품질 우열 평가가 아니라 기존 기능이 GPT 경로에서 정상 동작하는지 확인하는 인수 테스트다.
12. V4.5-M과 A2 회수 상향은 각각 통과 기준을 만족한 뒤 한 번의 Pi 유지보수 창에서 함께 배포한다. 한쪽이 실패하면 둘 다 운영 활성화하지 않는다.

2026-07-28 운영 Pi에 schema v9·settings/catalog 저장 경계, OpenAI Models/Responses 호환성 probe, GPT Responses 도구 루프, composer model picker, 의회 신규 실행 퇴역, 에이전트 탭의 사서 Codex 모델 설정과 job model snapshot을 A2와 한 배포본으로 적용했다. 운영 flag는 `GPT_RESPONSES_ENABLED=true`, `ASSISTANT_RETRIEVAL_A2_ENABLED=true`, `MODEL_CATALOG_REFRESH_ENABLED=true`다. 메인 채팅의 `자동`은 실제 `gpt-5.6-terra`, Codex 일반은 `gpt-5.6-terra`, 깊은 재정리는 `gpt-5.5`로 시작했다.

### 0.1 2026-07-28 로컬 구현 기록

- schema v9 additive migration과 optimistic settings, last-known-good catalog cache를 구현했다.
- `자동`은 검증된 최신 Terra를 따르고 고정값은 probe를 통과한 정확한 model ID만 resolve한다.
- Responses 루프는 `store: false`, reasoning `current_turn`, 전체 `response.output` replay와 정확한 `call_id`를 사용한다.
- 기존 웹·논문 전문·일정 후보 executor를 공용 runtime으로 재사용하며 도구 반복은 2회로 제한한다.
- 답변 요청 시 selection·resolved model·catalog generation·runtime generation을 snapshot하고, GPT 답변의 실제 반환 model ID를 `messages.model`에 기록한다.
- 동일 세션 채팅은 직렬화하고, 정상 최종 응답 뒤 사용자·어시스턴트 메시지를 한 transaction으로 저장한다. 미완료 응답은 DB와 인메모리 대화 모두에 남지 않는다.
- GPT 회수 trace는 shadow에서 `chat:gpt-single-v1:a1b`, A2 활성 시 `chat:gpt-single-v1:a2`로 기존 Claude trace와 분리한다.
- composer picker는 `자동`의 실제 resolve 모델과 exact 고정 모델을 보여주며 변경은 다음 답변부터 적용한다. 에이전트 탭은 일정 기능과 독립된 `사서 Codex` 블록에서 일반·깊은 모델을 저장하고 다음 job부터 snapshot한다.
- 신규 의회 버튼·모드 UI는 제거했고 신규 `/api/council/*` 요청은 추가 provider 호출 없이 `410 COUNCIL_RETIRED`로 끝난다. 기존 의회 기록 renderer와 저장 노트는 보존한다.
- 로컬 전체 회귀는 GPT 전환+A2 합계 207/207을 통과했다. 실제 OpenAI 계정에서 `gpt-5.6-terra` Responses text·function call·final text smoke를 통과했고, 로컬 Codex CLI 0.145.0의 app-server에서 6개 모델을 안전 필드로 조회했다.
- 설치된 `openai` 4.104.0이 필요한 계약을 지원해 SDK upgrade는 하지 않았다.

### 0.2 2026-07-28 Pi 통합 배포 기록

- 배포 전 DB·Vault 백업은 `galpi-20260728-2337.db`, `vault-20260728-2337.tar.gz`, 코드 롤백본은 `code-v45m-a2-pre-20260728-233706.tar.gz`, 환경설정 롤백본은 `env-v45m-a2-pre-20260728-233706`이다.
- 42개 변경 파일을 한 archive로 전송했고 핵심 런타임 파일 집계 SHA-256 `9244e4dfe9ec7ddc701d1999212f1d585c2394faf3da172e822bbcb4f34db208`의 로컬·Pi 일치를 확인했다.
- schema 8→9, Pi 전체 회귀 207/207, OpenAI API·Codex subscription catalog 자동 갱신, 인증 config와 `410 CLAUDE_CHAT_RETIRED`·`410 COUNCIL_RETIRED`를 확인했다.
- 실제 GPT 일반 답변, 명시적 웹 검색 3개 근거, 저장 논문 전문 2회·8,076자 근거, 일정 후보 무쓰기, A2 무관 질문 중단과 기억 질문 회수를 통과했다. 일정 후보 전후 task/event/reminder는 8/15/4로 불변이다.
- A2 실제 trace는 무관 질문에서 노트·청크 0개·35ms, 기억 질문에서 같은 topic의 청크 2개·1,918자·41ms였고 mode는 `chat:gpt-single-v1:a2`였다.
- 배포 스모크 중 기억·논문 질문 2건이 자동 topic 저장된 사실을 확인했다. exact QA-LOG hash·결정 ID·원본 메시지 guard와 추가 백업 `galpi-20260728-2351.db`, `vault-20260728-2351.tar.gz` 뒤 두 Q&A·청크·저장 결정만 제거하고 원본 메시지 4개를 보존했다. 영향 노트 2개는 재임베딩 2/2 후 Codex job 41로 재정리했다.
- Codex job 41은 `gpt-5.6-terra`, catalog generation 2를 snapshot해 1회에 처리됐다. 최종 topic Q&A 105/105, note index DB/Vault 33/33·finding 0, Codex validation 23, SQLite integrity `ok`·외래키 오류 0, 서비스 경고 0을 확인했다.
- 2026-07-29 모바일 composer에서 opener의 기본 테두리를 제거하고 hover·열림 상태에만 옅은 면을 남겼다. placeholder를 축약하고 textarea flex 축소와 44px 전송 버튼·safe-area 여백을 보정해 390px·320px 문서 overflow 0을 실측했다. 로컬 전체 207/207, Pi UI 9/9와 정적 응답 hash 일치를 확인했으며 서비스 재시작과 DB 변경은 없었다.

---

## 1. 왜 이렇게 바꾸는가

현재 구조는 단일 Claude와 `Claude 초안 → GPT 검증 → Claude 종합` 의회를 함께 유지한다. 의회는 답변 한 번에 모델 호출이 겹치고, 현재 사용 빈도가 낮아 비용과 코드 복잡도에 비해 얻는 가치가 작다.

단일 최신 GPT로 전환하면 다음을 단순화할 수 있다.

- 앞무대 답변 모델과 도구 루프를 한 경로로 통일
- 의회 이중·다중 호출 비용 제거
- 기존 OpenAI API 인증과 비용 계정 재사용
- 모델 계층을 답변마다 선택
- 실제 사용 모델을 답변과 trace에 명확히 기록

단, 단순히 Claude 호출부를 GPT 호출로 치환하면 안 된다. 현재 Claude 경로가 맡는 웹 검색, 논문 전문 읽기, 일정 후보 생성, 진행 스트림을 먼저 동일한 계약으로 옮겨야 한다.

---

## 2. 공식 제품 경계

### 2.1 메인 채팅

| 항목 | 계약 |
|---|---|
| 인증 | 서버의 `OPENAI_API_KEY` |
| 모델 발견 | OpenAI Models API |
| 실행 | OpenAI Responses API |
| 대화 정본 | 갈피 SQLite `messages` |
| 서버측 대화 저장 | `store: false` |

OpenAI Models API는 공식 표현대로 “currently available models”와 owner·availability 같은 기본 정보만 제공한다. 따라서 목록에 보인다는 사실만으로 함수 호출·이미지 입력·현재 권장 계층 호환성을 추정하지 않는다.[^openai-models]

OpenAI의 GPT-5.6 안내는 Sol을 품질 우선, Terra를 균형형, Luna를 효율·대량 처리 계열로 설명하고 도구 사용과 다중 턴 작업에는 Responses API 사용을 권장한다.[^openai-latest][^openai-upgrade]

### 2.2 사서 Codex

| 항목 | 계약 |
|---|---|
| 인증 | 현재 Codex CLI의 ChatGPT 로그인 |
| 모델 발견 | Codex app-server `model/list` |
| 실행 | 기존 `codex exec --model <id>` |
| 설정 정본 | 갈피 DB의 Codex 모델 설정 |
| Codex 전역 설정 | 수정하지 않음 |

Codex `model/list`는 `supportedReasoningEfforts`, `defaultReasoningEffort`, `upgrade`, `hidden`, `inputModalities`, `isDefault` 같은 Codex 전용 정보를 반환한다.[^codex-model-list] 이 목록을 OpenAI API 키로 호출할 수 있는 채팅 모델 목록으로 간주하지 않는다.

---

## 3. 사용자 선택과 실제 모델

모든 답변은 아래 두 값을 구분한다.

```text
selection
  사용자가 저장한 선택 정책

resolved_model_id
  요청 시작 시 실제로 확정한 model ID
```

초기 선택지는 다음과 같다.

| UI 선택 | 저장값 예시 | 의미 |
|---|---|---|
| 자동 | `auto:balanced` | 검증된 최신 균형형 모델 |
| 최고 품질 | 정확한 Sol model ID | 깊은 토론·복잡한 설계 |
| 균형 | 정확한 Terra model ID | 일반 대화의 성능·비용 균형 |
| 빠름 | 정확한 Luna model ID | 짧은 질의·속도 우선 |

초기 `자동`의 resolved model은 현재 검증된 Terra 계열로 잡는다. Sol·Terra·Luna의 정확한 ID는 하드코딩된 UI 문구가 아니라 서버 카탈로그에서 받는다.

### 3.1 자동과 고정의 차이

- `자동`만 더 최신인 호환 모델로 이동한다.
- 수동으로 고른 정확한 모델은 새 버전이 나와도 유지한다.
- 고정 모델이 더는 사용할 수 없으면 다른 계층으로 조용히 바꾸지 않고 선택 변경을 요청한다.
- 답변 말풍선과 저장 기록에는 항상 실제 `resolved_model_id`를 남긴다.

reasoning effort는 이번 사용자 UI에 노출하지 않는다. OpenAI는 GPT-5.6에서 생략 시 `medium`을 기본으로 안내한다.[^openai-upgrade] 초기 구현은 provider 기본값을 사용한다. reasoning effort 최적화는 실제 비용이나 지연이 문제가 됐을 때 별도 운영 변경으로 다루며, 이번 전환을 막는 품질 비교 게이트로 두지 않는다.

---

## 4. 모델 카탈로그와 자동 최신

### 4.1 갱신 시점

- 서버 시작 직후 비동기 갱신
- 마지막 성공 후 24시간마다 갱신
- 에이전트 설정 블록의 수동 새로고침
- 채팅 요청 critical path에서는 원격 카탈로그 응답을 기다리지 않음

### 4.2 카탈로그 상태

```text
empty
  → refreshing
  → fresh

fresh + 다음 갱신 실패
  → stale

성공 캐시 없음 + 갱신 실패
  → fallback
```

`stale`일 때는 마지막 정상 카탈로그와 last-known-good 모델로 계속 동작한다. 캐시도 bootstrap fallback도 없을 때만 채팅을 막는다.

### 4.3 후보 검증

```text
discovered
  → probing
  → compatible
  → exact manual option
  → known auto-policy role에 해당할 때만 active 후보

durable probe 실패 → rejected
transient probe 실패 → untested (다음 refresh에서 재검증)
```

Discovery와 auto-routing policy는 별도 판정이다. Models API가 반환한 ID가 `gpt-`로 시작하면 후보로 삼되, 끝의 날짜 snapshot suffix(`-YYYY-MM-DD`)와 하이픈으로 구분된 `preview` lifecycle segment는 제외한다. Fine-tuned ID 등 non-`gpt-*` surface로 넓히지 않는다. stable specialized alias를 이름 denylist로 제외하거나 새 family를 allowlist에 추가하지 않는다. Galpi Responses runtime과의 호환성은 capability probe가 판단한다.

모든 discovery candidate를 검증한다. 같은 `OPENAI_PROBE_VERSION`과 `probeReasoningEffort`에서 이미 durable `compatible` / `rejected`인 결과는 재사용하고, 신규·`untested` 모델은 probe한다. 일시적 실패는 그 자리에서 한 번 재시도하며 계속 실패하면 `untested`로 남긴다. Models 조회 등 refresh 자체가 실패하면 last-known-good payload를 보존한다.

Manual availability의 정본은 text `probeStatus === 'compatible'`이다. `/api/models/chat`은 `auto:balanced`를 첫 option으로 유지하고, 그 뒤에 모든 compatible stable GPT candidate를 exact option으로 노출한다. 목록은 provider `created` 내림차순(없으면 0), 동률은 model ID 순으로 정렬한다. 라벨은 family 이름을 일반 형식으로 표시하며(`gpt-6-astra` → `GPT-6 Astra`), unknown 모델 설명은 `검증된 GPT 모델`이다. 이름·생성 시각으로 품질·가격·속도를 추론하지 않는다.

Known auto-policy classifier만 `gpt-<major>.<minor>-sol|terra|luna`를 해석한다. Sol → `quality`, Terra → `balanced`, Luna → `fast`이며 각 role에서 major/minor 기준 최신 compatible 모델을 `active`로 선택한다. `activeImage`는 text와 image가 모두 compatible인 known model 중 같은 순서로 선택한다. provider `created`는 자동 정책에 사용하지 않는다. `gpt-6-astra` 같은 unknown stable family는 probe를 통과하면 코드 변경 없이 **manual-only**로 사용하며 role은 `null`이다. 따라서 새 unknown family discovery가 `auto:balanced`를 암묵적으로 바꾸지 않는다. 자동의 text turn은 `active.balanced`, image turn은 `activeImage.balanced`를 계속 사용한다.

Exact 선택은 현재 catalog에 없거나 text compatibility가 없으면 `MODEL_UNAVAILABLE`, image turn에 image compatibility가 없으면 `MODEL_IMAGE_UNSUPPORTED`로 실패한다. 다른 모델로 조용히 전환하지 않으며, 선택은 다음 response부터 적용하고 요청 시작 시 실제 model snapshot을 고정한다.

호환성 probe는 실제 사용자 질문·대화·첨부를 사용하지 않는다.

- 짧은 한국어 텍스트 응답
- 부작용 없는 강제 함수 호출
- JSON 인자 검증
- 정확한 `call_id` 연결
- 함수 결과 뒤 최종 텍스트 응답
- `store: false`
- 실제 채팅의 `GPT_CHAT_REASONING_EFFORT`(기본 `medium`)와 `reasoning.context: current_turn`
- 출력 상한: `none`이면 기존 128토큰, 추론을 사용하면 메인 채팅과 같은 8,192토큰(추론 토큰 포함)

이미지 probe는 text-compatible 모델에만 수행하고 별도 image 상태로 저장한다. 이미지 거부가 일반 text chat을 막지 않는다. 제목·요약 생성도 선택 모델 snapshot의 effort를 사용하며, 추론을 쓰면 기존 짧은 출력 예산에 최소 8,192토큰 상한을 적용한다. 이 상한은 답변 길이 목표가 아니며 기존 제목·요약 프롬프트와 결과 검증은 유지한다.

**2026-09-05 설계 보완:** [공식 GPT-6 Astra 문서](https://developers.openai.com/api/docs/guides/latest-model#gpt-6-astra-whats-new)는 `none` effort 미지원을 명시한다. 따라서 discovery 분리와 함께 기존 probe·제목·요약의 `none` 고정을 제거한다. family별 예외나 effort UI는 추가하지 않는다. OpenAI catalog payload는 `schemaVersion` / `OPENAI_CATALOG_PAYLOAD_VERSION` **1 → 2**, 실제 probe 요청 계약이 바뀌므로 `OPENAI_PROBE_VERSION`은 **2 → 3**으로 올린다. DB migration 없이 cached v1 payload는 refresh 전까지 읽을 수 있고, v2 probe 결과는 새 계약으로 한 번 재검증한다. 이후 같은 probe version·effort의 durable 결과는 재사용하며 effort 변경 시 다시 검증한다.

---

## 5. Responses API 대화 계약

갈피 SQLite와 Vault를 대화·지식 정본으로 유지한다.

- 턴 사이에는 OpenAI Conversations API를 사용하지 않는다.
- 턴 사이에는 `previous_response_id`를 사용하지 않는다.
- 매 요청에서 갈피가 최근 대화와 노트·일정·논문 컨텍스트를 직접 조립한다.
- `store: false`로 요청한다.
- 턴 사이 hidden reasoning을 저장하거나 재생하지 않는다.
- 한 요청의 함수 호출 loop 안에서는 `response.output` item과 `call_id`를 손실 없이 보존해 다음 입력에 전달한다.
- 최종 사용자 답변은 정상 완료된 텍스트 output에서만 추출한다.

OpenAI의 Responses 이전 문서는 manual item replay를 사용할 때 item 유형과 함수 호출 `call_id`를 보존하도록 안내한다.[^openai-upgrade] 이번 baseline에서는 persisted reasoning, Pro 모델, PTC, 멀티에이전트, 명시적 prompt cache를 함께 도입하지 않는다.

### 5.1 기존 기능 parity

GPT 전환 전에 다음 경로가 같은 서버 계약으로 동작해야 한다.

- Tavily 웹 검색
- 저장 논문 검색
- `paper_fulltext_search`
- `paper_fulltext_read`
- `schedule_prepare`
- 활성 노트·과거 대화·일정 컨텍스트
- 기존 큰 단계만 보여주는 NDJSON 진행 스트림
- 답변 저장·topic 자동 저장·수동 저장

도구는 공용 registry와 작은 provider adapter 뒤로 옮긴다. 기존 validator·논문 세션·검색 모듈은 재작성하지 않는다. Anthropic `input_schema`를 Responses 함수의 `parameters`로 바꾸는 어댑터만 둔다.

### 5.2 요청 snapshot

```text
accepted
  → model_snapshotted
  → context_building
  → requesting
  → tool_running
  → answering
  → committed
```

- 요청 시작 시 selection, resolved model, catalog generation, runtime generation을 고정한다.
- 생성 중 설정을 바꿔도 현재 답변은 기존 snapshot을 사용한다.
- 새 선택은 다음 답변부터 적용한다.
- 도구가 외부 행동을 이미 수행한 뒤에는 전체 모델 요청을 자동 재시도하지 않는다.
- 진행 UI에는 큰 단계만 보여주고 reasoning 원문은 노출하지 않는다.

---

## 6. API 계약

### 6.1 채팅 모델 목록

```http
GET /api/models/chat
```

```json
{
  "selection": "auto:balanced",
  "resolvedModelId": "gpt-5.6-terra",
  "options": [
    {
      "value": "auto:balanced",
      "label": "자동",
      "description": "검증된 최신 균형형",
      "resolvedModelId": "gpt-5.6-terra"
    },
    {
      "value": "gpt-5.6-sol",
      "label": "GPT-5.6 Sol",
      "tier": "quality"
    }
  ],
  "catalog": {
    "generation": 12,
    "status": "fresh",
    "lastSuccessAt": "2026-07-28T10:00:00Z"
  }
}
```

### 6.2 채팅 모델 변경

```http
PUT /api/settings/chat-model
If-Match: "<settings-version>"
```

```json
{
  "selection": "gpt-5.6-sol"
}
```

성공 응답은 저장된 selection, 현재 resolved model, 새 settings version과 `appliesFrom: "next_response"`를 반환한다.

### 6.3 채팅

브라우저가 `/api/chat`에 임의 model ID를 직접 넘기지 않는다. 서버가 저장된 선택을 읽고 요청 시작 시 resolve한다.

완료 이벤트에는 아래를 포함한다.

```json
{
  "modelSelection": "auto:balanced",
  "modelId": "gpt-5.6-terra",
  "catalogGeneration": 12,
  "runtimeGeneration": "gpt-single-v1"
}
```

### 6.4 Codex 모델

```http
GET /api/models/codex
PUT /api/settings/codex-models
POST /api/models/refresh
```

Codex 설정 예시:

```json
{
  "generalModel": "gpt-5.6-terra",
  "deepModel": "gpt-5.5",
  "version": 3
}
```

서버는 app-server raw 응답에서 안전한 표시 필드만 내보낸다.

- ID·표시명·설명
- `hidden`
- 지원·기본 reasoning effort
- `isDefault`
- `upgrade`
- 입력 modality
- catalog 갱신 시각과 runner health

raw base instructions, 인증 상태의 민감한 값, provider 설정, 로컬 경로는 브라우저에 보내지 않는다.

---

## 7. SQLite schema v9

V4.5-M이 다음 additive migration인 schema v9를 사용한다. 기존 일정 문서의 미래 C2가 선점한 `v9` 표기는 특정 숫자 예약을 없애고, C2 구현 시점의 다음 가용 schema로 바꾼다.

### 7.1 `app_settings`

```text
key TEXT PRIMARY KEY
value_json TEXT NOT NULL
version INTEGER NOT NULL
updated_at INTEGER NOT NULL
```

초기 허용 key:

```text
chat.model_selection
codex.general_model
codex.deep_model
```

클라이언트가 임의 key를 만들지 못하게 서버 allowlist와 optimistic version 검사를 적용한다.

### 7.2 `model_catalog_cache`

```text
surface TEXT PRIMARY KEY
generation INTEGER NOT NULL
payload_json TEXT
payload_version INTEGER NOT NULL
last_attempt_at INTEGER
last_success_at INTEGER
last_error_code TEXT
last_error_at INTEGER
```

`surface`는 `openai_api`와 `codex_subscription`만 허용한다. 갱신 실패는 기존 정상 `payload_json`, generation, `last_success_at`을 덮어쓰지 않는다.

### 7.3 `messages`

기존 `model`에는 응답이 실제 반환한 정확한 model ID를 기록한다. 기존 `Claude`, `의회` 값은 바꾸지 않는다.

추가:

```text
model_selection TEXT
model_catalog_generation INTEGER
runtime_generation TEXT
reasoning_effort TEXT
```

이 필드는 전환 전 메시지에서 `NULL`이어도 된다.

### 7.4 `codex_jobs`

추가:

```text
model_selection TEXT
model_id TEXT
model_catalog_generation INTEGER
```

기존 job은 `NULL`을 허용한다. migration은 현재 `CODEX_MODEL=gpt-5.6-terra`, `CODEX_DEEP_MODEL=gpt-5.5` 값을 settings seed로 옮기고 환경변수는 bootstrap·복구 fallback으로만 남긴다.

---

## 8. 사서 Codex 모델 고정

에이전트 블록은 두 선택기를 제공한다.

- `일반 정리 모델`: 자동 queue와 새 노트 정리
- `깊은 재정리 모델`: 수동 전체 재정리

Codex 옵션 목록은 자동 갱신하지만, 선택한 정확한 model ID는 조용히 바꾸지 않는다.

- 자동 job은 job 생성 시 model ID를 snapshot한다.
- 전체 재정리는 run 수락 시 한 번 snapshot하고 모든 batch에 같은 모델을 쓴다.
- 설정 변경은 다음 독립 job·run부터 적용한다.
- 실행 중인 프로세스나 한 run의 batch 사이에서 모델을 바꾸지 않는다.
- `~/.codex/config.toml`은 수정하지 않는다.
- 기존 `execFile(..., ['--model', modelId])` 경계를 유지한다.
- `recovery_required`는 모델 변경으로 해제하거나 우회하지 않는다.

선택 모델이 실행 전에 사라지면 Vault를 건드리지 않고 retryable infrastructure failure로 둔다. 전체 재정리 중 사라지면 그 run을 중단하고, 새 모델로 재개할 때 새 run을 만든다.

---

## 9. UI 계약

기존 갈피 디자인 토큰과 패널 구조를 유지하는 범위의 점진적 변경이다.

### 9.1 채팅 모델 picker

- 입력창의 보내기 동선 가까이에 현재 모델 pill을 둔다.
- 데스크톱은 작은 popover, 모바일은 bottom sheet로 연다.
- pill에는 `자동 · GPT-5.6 Terra`처럼 selection과 현재 resolved model을 함께 표시한다.
- 목록의 `자동` 옵션은 현재 수동 선택과 독립적으로 자동 text 대상(`active.balanced`, 없으면 기존 bootstrap 모델)을 표시한다. 최상위 `resolvedModelId`는 현재 선택의 대상이며, 고정 모델이 사용 불가이면 `null`을 유지한다.
- 각 옵션은 이름, 짧은 용도, 실제 model ID만 보여준다.
- 가격은 자주 바뀌므로 UI에 하드코딩하지 않는다.
- 모델 저장 중에는 중복 선택을 막고, 실패하면 기존 선택을 유지한다.
- 고정 모델이 사용 불가여도 다른 옵션이 있으면 메뉴를 열 수 있다. 선택한 모델 이름과 사용 불가 안내를 유지하고, 사용자가 직접 고른 뒤에만 설정을 바꾼다.
- 답변 생성 중 바꾸면 `다음 답변부터 적용`을 표시한다.
- 키보드 이동, Escape 닫기, focus 복귀, ARIA label, 44px touch target, reduced motion을 지원한다.
- 1440×900, 390×844, light/dark에서 확인한다.

상단의 의회 버튼·빠름/기본/심층 토글과 `Claude 크레딧 ↗` 링크는 제거한다. `XION` 비서 정체성과 기존 채팅 한 줄 구조는 유지한다.

### 9.2 에이전트 창

일정 에이전트 블록 아래에 카드 중첩 없이 `사서 Codex` 블록 하나를 추가한다.

```text
사서 Codex
노트 정리와 연결을 담당해

일반 정리 모델   [GPT-5.6 Terra  ▾]
깊은 재정리 모델 [GPT-5.5        ▾]

CLI 정상 · 목록 갱신 7분 전
[변경 저장]
```

- 일정 API와 Codex catalog 실패를 독립적으로 렌더링한다.
- task 기능이 꺼져 있어도 Codex 블록은 보일 수 있다.
- 실행 중 job에는 영향을 주지 않는다는 문구를 표시한다.
- 모델 사용 불가·저장 충돌·stale catalog 오류는 해당 블록 안에서 설명한다.

---

## 10. 의회 퇴역과 legacy 보존

### 제거

- 새 의회 실행 toggle
- 빠름·기본·심층 선택 UI
- Claude 초안·GPT 검증·Claude 종합 호출
- 의회 전용 신규 진행 이벤트
- Claude billing 링크
- 활성 Anthropic runtime 설정과 SDK

기존 `/api/council/*`는 모델을 호출하지 않고 `410 COUNCIL_RETIRED`와 `/api/chat` 안내를 반환한다. stale 브라우저가 의회를 조용히 실행했다고 오해하지 않게 하기 위한 호환 tombstone이며, 별도 API 정리 전까지 유지한다.

### 보존

- 기존 `messages.model = 'Claude' | '의회'`
- 과거 의회 transcript parser·renderer
- 과거 의회 최종 답변의 일반 히스토리 변환
- `note_type: council`
- 의회 노트의 저장 상태·검색
- 기존 browser storage key의 읽기 호환
- retrieval shadow의 과거 generation 구분
- backup·audit·fixture·배포 기록

기존 대화·노트의 rename, rewrite, delete migration은 하지 않는다.

---

## 11. 첨부와의 경계

모델 라우팅과 첨부 수명은 서로 독립이다.

- 임시 첨부의 실제 모델은 업로드 때가 아니라 `/api/chat` 수락 때 snapshot한다.
- 업로드 후 모델을 바꾸고 전송하면 새 선택을 사용한다.
- 생성 중 모델을 바꾸면 현재 답변은 기존 snapshot을 유지한다.
- catalog probe에 사용자 첨부·질문·대화를 절대 넣지 않는다.
- PDF·MD·TXT는 OpenAI Files에 영구 업로드하지 않고 로컬 파싱·검색 결과만 전달한다.
- 이미지는 선택된 모델의 image input capability가 확인된 경우에만 보낸다.
- 고정 모델이 이미지를 지원하지 않으면 조용히 다른 모델로 바꾸지 않고 호환 오류를 표시한다.

현재 갈피의 replay 설정은 `CONTEXT_N=10`, 즉 사용자 턴 약 10개다. 임시 첨부는 업로드 메시지에 연결될 때 이 값을 `replay_window_turns`로 snapshot하고, origin user turn이 그 창에서 밀려나는 다음 사용자 턴의 모델 호출 전에 `expired`로 바꾼다. 이후 설정이 5로 바뀌면 새 첨부만 5턴을 쓰며 기존 첨부의 수명이 소급 단축되지 않는다.

---

## 12. 실패·보안 계약

| 상황 | 처리 |
|---|---|
| catalog 갱신 실패 | last-known-good 사용, `stale` 표시 |
| cache와 fallback 모두 없음 | `503 MODEL_CATALOG_UNAVAILABLE` |
| 고정 모델 제거·권한 없음 | `409 MODEL_UNAVAILABLE`, 자동 대체 금지 |
| Auto 후보 실패 | active last-known-good 유지 |
| API 인증 실패 | `503 PROVIDER_AUTH_FAILED` |
| rate limit | `429 PROVIDER_RATE_LIMITED` |
| timeout | `504 PROVIDER_TIMEOUT` |
| 정상 최종 텍스트 없음 | `502 INCOMPLETE_MODEL_RESPONSE` |
| 허용되지 않은 선택값 | `422 INVALID_MODEL_SELECTION` |

보안 원칙:

- OpenAI API key와 Codex 로그인은 서버에만 둔다.
- 브라우저가 보낸 model ID를 검증 없이 upstream이나 CLI에 전달하지 않는다.
- model ID 길이·문자셋·allowlist를 검증한다.
- Codex는 shell 문자열이 아니라 인자 배열로 실행한다.
- raw upstream 오류·prompt·첨부 원문을 브라우저에 반환하지 않는다.
- `store: false`를 “provider가 데이터를 전혀 처리하거나 보존하지 않는다”는 뜻으로 표현하지 않는다.
- 첨부·웹·논문 원문은 비신뢰 자료로 감싸 내부 지시를 도구 명령으로 실행하지 않는다.

---

## 13. 관찰 가능성과 세대 분리

민감한 원문 없이 다음을 기록한다.

- selection과 resolved model ID
- catalog source·generation·age
- compatibility `probe_version`과 결과
- provider request ID
- latency
- input·output·cached·reasoning token 수
- 도구 이름·호출 수·실패 분류
- Auto fallback 여부
- Codex job/run의 실제 model ID
- 설정 변경 시각과 적용 시점

V4.5-M 배포 전 A1b trace는 그대로 보존한다. 검색 후보 지표는 동일 정책이라면 이어서 참고할 수 있지만, 답변 품질·도구 사용·자동 저장 결과는 Claude runtime과 GPT runtime을 합산하지 않는다. `runtime_generation`으로 분리해 운영 회귀를 추적한다.

---

## 14. 구현 순서

### M0 — migration·catalog

- [x] schema v9 additive migration
- [x] settings repository
- [x] OpenAI API catalog provider
- [x] Codex app-server catalog provider
- [x] compatibility probe와 last-known-good

### M1 — GPT Responses parity

- [x] 별도 GPT tool loop 모듈
- [x] 웹·논문·일정 도구 adapter
- [x] `store: false` manual replay
- [x] 진행 스트림·오류 계약
- [x] 설치된 `openai` 4.104.0의 Responses item·tool 계약 실제 smoke
- [x] 운영 기본 경로를 바꾸지 않는 비활성 feature flag

### M2 — 전환 전 기능 인수

- [ ] 한국어 일반 채팅이 정상 완료되고 실제 model ID가 저장됨
- [ ] 웹 검색 출처와 저장 provenance가 유지됨
- [ ] 논문 검색·전문 읽기 도구 상한과 evidence가 유지됨
- [ ] `schedule_prepare`가 확인 전 무쓰기를 유지함
- [ ] 노트·최근 대화 회수와 진행 스트림이 유지됨
- [ ] topic 자동 저장·수동 저장·최근 저장이 유지됨

Claude와의 별도 점수표, 승률, 응답 품질 우열, 비용 A/B는 만들지 않는다. 기능 인수에서 오류가 나오면 해당 계약을 고친 뒤 재검증한다.

### M3 — 단일 GPT UI

- composer model picker
- 다음 답변 적용
- 실제 모델 label
- 운영 feature flag로 GPT 전환

### M4 — 의회 active path 퇴역

- 신규 UI 제거
- 410 tombstone
- Anthropic 호출 0건 확인
- legacy transcript·노트 회귀 테스트

### M5 — 사서 Codex 블록

- 일반·깊은 모델 선택
- job/run snapshot
- catalog·runner health 표시
- 설정 충돌·모델 unavailable 처리

대규모 `server.js` 분해를 선행하지 않는다. 새 catalog, resolver, Responses runner, settings route를 별도 모듈로 만들고 서버에는 설정과 얇은 연결만 둔다.

---

## 15. 테스트와 인수 기준

### 모델·Responses

- [x] 일반 텍스트 응답
- [x] 함수 schema 변환과 정확한 `call_id`
- [x] output item manual replay
- [x] 도구 2회 상한·도구 오류·빈 응답·incomplete 처리
- [x] 비채팅 모델 제외
- [x] 후보 probe 성공·실패·재검증
- [x] catalog 장애 시 last-known-good 보존
- [x] Auto와 고정 모델 unavailable 동작 분리

### migration·설정

- [x] v8→v9와 재실행 멱등성
- [x] 기존 Claude·의회 message 무변경
- [x] 현재 Codex 일반·깊은 모델 seed
- [x] 설정 version 충돌이 뒤늦은 브라우저의 덮어쓰기를 차단
- [x] 실패한 refresh가 정상 cache를 덮어쓰지 않음

### 기존 기능 회귀

- [x] 웹 검색·논문 전문·일정 후보·노트·최근 대화
- [ ] topic 자동 저장·수동 저장·최근 저장
- [x] 진행 단계 NDJSON
- [x] A1b trace generation 분리
- [ ] 과거 의회 transcript·검색·노트 열람
- [x] council tombstone에서 provider 호출 0회

### Codex

- [x] `model/list` timeout·오류·hidden 필터
- [x] 일반 설정이 실제 job의 정확한 `--model` 인자와 snapshot으로 전달
- [x] 설정 변경이 생성된 다음 job부터 적용
- [ ] 전체 재정리 batch 전체가 같은 모델 사용
- [x] catalog 오류가 `recovery_required`를 변경하지 않음

### UI

- [x] desktop·390×844
- [ ] light·dark
- [ ] 키보드·focus·Escape·ARIA
- [ ] loading·stale·unavailable
- [ ] 긴 모델명과 작은 화면
- [ ] 과거 의회 transcript 복원
- [ ] 일정 블록과 Codex 블록의 독립 실패

### Pi 인수

- [x] DB·Vault·코드 사전 백업
- [x] OpenAI API 실제 Responses text·tool smoke
- [x] Codex 실제 `model/list`
- [x] 일반 정리 안전 표본
- [x] 전체 회귀
- [x] SQLite integrity·foreign key
- [x] note-index·topic audit
- [x] 신규 Claude·의회 실행 410 tombstone
- [x] A2 회수 상향의 별도 정밀도 게이트 통과
- [x] GPT 전환과 A2를 같은 배포본·같은 재기동으로 활성화

---

## 16. 배포와 rollback

1. 로컬에서 GPT 기능 인수와 A2 정밀도 게이트를 각각 통과한다.
2. Pi DB·Vault·코드를 한 번 백업한다.
3. schema·catalog·resolver·GPT Responses parity·A2 정책을 한 배포본으로 올린다.
4. Pi 제한 smoke 뒤 picker와 GPT 기본 경로, 검증된 A2를 같은 재기동에서 활성화한다.
5. 의회 active path를 410 tombstone으로 전환하고 Anthropic 신규 호출 0건을 확인한다.
6. 운영 검증 뒤 Anthropic SDK·환경설정 제거를 별도 정리한다.

rollback은 숨은 Claude fallback을 유지하는 방식이 아니라 배포 전 코드·DB 백업으로 수행한다. schema v9는 구버전 코드가 무시할 수 있는 additive table·column만 사용한다.

---

## 17. 최종 성공 정의

> 사용자는 하나의 시온 채팅에서 다음 답변에 쓸 GPT 모델을 고를 수 있고, `자동`은 검증된 최신 균형형 모델로 안전하게 이동한다. 기존 검색·논문·일정·기억·저장 기능은 그대로 동작하며, 각 답변에는 실제 모델이 남는다. 의회는 새로 실행되지 않지만 과거 기록은 손실 없이 읽을 수 있고, 사서 Codex 모델은 에이전트 창에서 다음 job부터 독립적으로 변경할 수 있다.

---

## 출처

[^openai-latest]: OpenAI, [Using GPT-5.6](https://developers.openai.com/api/docs/guides/latest-model)
[^openai-upgrade]: OpenAI, [Migrating to GPT-5.6](https://developers.openai.com/api/docs/guides/upgrading-to-gpt-5p6-sol)
[^openai-models]: OpenAI, [Models — List models](https://developers.openai.com/api/reference/resources/models/methods/list)
[^codex-model-list]: OpenAI, [Codex app-server — List models (`model/list`)](https://learn.chatgpt.com/docs/app-server#list-models-modellist)
[^openai-billing]: OpenAI Help Center, [How can I move my ChatGPT subscription to the API?](https://help.openai.com/en/articles/8156019-i-want-to-move-my-chatgpt-subscription-to-the-api)
