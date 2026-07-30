# V4.5 믿을 수 있는 비서 기본기 설계

> 작성: 2026-07-15 · 갱신: 2026-07-30
>
> 상태: A0·A1 shadow, S0b-2 Pi 실제 복구, S0c 공용 topic 쓰기 경로와 A1b 전역 청크 검색·한국어 경계 보정, V4.5-C schema v5/v6/v7·PWA·Web Push·지식 시트/일정 에이전트 UI, schema v8 일정 컨텍스트·월별 종결 노트 projection과 C1.5 자연어 무저장 후보까지 Pi에 인수했다. 운영 trace 77개 재생으로 보수 정책을 검증한 A2 실제 청크 주입을 2026-07-28 단일 GPT 전환과 함께 Pi에 활성화했다. 새 GPT generation의 독립 온라인 관찰을 시작했다. 2026-07-30 V4-B R0 raw WebRTC를 Pi에 활성화하고 Mac·Pi HTTPS 실제 음성 응답과 무쓰기를 인수했다. 사용자 iPhone의 5분 한·영 대화, 끼어들기, mute, 수동·자동 종료와 마이크 해제까지 통과해 R0 GO로 승격했다
>
> 위치: V4-A 논문 검색 완료 후, V4-B 음성과 V5-A 딜 스카우트·V5-B 주식 분석 전에 진행

## 0. 결정 요약

현재 갈피는 대화 보존, 토픽 자동 저장, 하이브리드 노트 검색, 웹 근거, 저장 논문 전문 검색, Codex 정리까지 갖춘 개인 지식 시스템이다. 다음 단계에서는 입력구나 에이전트를 더 늘리기 전에 아래 세 가지를 보강한다.

1. **기억 신뢰성**: 긴 토픽의 특정 Q&A를 청크 단위로 회수하고, 최신 정보·출처·무효화 상태를 반영한다.
2. **평가와 관측**: 무엇을 회수했고 왜 답했는지, 비용·지연·도구 사용이 어땠는지 측정한다.
3. **약속 루프**: 할 일·기한·알림·후속 확인을 구조화해 비서가 먼저 챙길 수 있게 한다.

이 세 기능 전에 **S0 저장 무결성**을 둔다. 토픽 노트 형식은 유지하되, Markdown `QA-LOG`와 SQLite 검색 인덱스가 어긋나도 감지·복구할 수 있게 만든 뒤 A2 실제 답변 회수로 전환한다. 저장 형식을 원자 노트나 외부 메모리 저장소로 교체하는 작업은 아니다.

V4-B 음성은 이 기반 뒤에 연결한다. 자연 대화는 OpenAI Realtime WebRTC를 `R0 무쓰기 → R1 읽기 전용 → R2 승인형 쓰기`로 승격하고, 정확한 문구가 필요한 음성 전사는 Inbox/미리보기에서 사용자가 목적을 확인한 뒤 `대화 | 메모 | 할 일` 중 하나로 보낸다. 상세 단일 기준은 [V4-B 시온 음성·Realtime 설계](voice-realtime-design.md)다.

이 단계에서 하지 않는 것:

- 논문 자율 발견 검색
- 이메일·캘린더 쓰기나 외부 앱 조작
- V5 전문 에이전트의 제품 운영(딜 스카우트·주식 분석 등)
- 그래프 검색, LLM reranker, 새 벡터 DB
- 전체 `server.js` 선행 리팩터링
- 무승인 자동 메모리 확정 또는 무승인 외부 행동

## 1. 왜 지금 필요한가

### 1.1 현재 시스템의 강점

- 모든 대화는 SQLite에 보존되고 세션 복원이 가능하다.
- 저장 가치가 있는 Q&A는 성장형 topic 노트와 `note_chunks`에 누적된다.
- 키워드·임베딩 하이브리드 검색과 시간 문맥이 있다.
- 웹 검색과 논문 전문은 외부 콘텐츠 격리, 사용량·문자 수 상한, 공통 evidence 경계를 갖는다.
- Codex 수정 범위, 승인, diff 검증, soft delete, 일일 백업이 있다.

이 기반은 버리지 않는다. V4.5는 이미 만든 저장·검색 구조의 빈 연결을 채우는 단계다.

### 1.2 Pi 실사용 데이터에서 확인한 문제

2026-07-15 읽기 전용 집계 기준:

- 세션 17개, 메시지 250개
- 활성 topic 13개, `topic_qa` 청크 61개
- 자동 저장 분류 결과: `semantic_signal` 저장 47건, 자동 skip 45건
- 큰 topic 상위 10개 중 8개가 현재 노트 컨텍스트 한도 5,000자를 초과
- 그중 5개가 현재 노트 임베딩 입력 한도 8,000자를 초과
- 가장 큰 topic은 Q&A 11개, 8,148자
- 항상 주입되는 사용자 메모리 항목은 0개

현재 `note_chunks`에는 Q&A별 본문과 임베딩이 있다. A1 shadow 경로는 이를 검색하고 trace에 기록하지만, 실제 모델 답변은 아직 `searchVault()`가 고른 노트 앞부분을 사용한다. 새 Q&A는 QA-LOG 뒤에 붙으므로 기존 답변 경로에서는 topic이 길어질수록 최신 내용이 잘릴 수 있다.

또한 Phase C 실제 스모크 질문 2건이 일반 `/api/chat` 저장 흐름을 타고 기존 topic에 들어갔다. 이는 테스트·운영 대화와 영구 기억을 구분하는 저장 정책이 필요하다는 실제 사례다.

### 1.3 제품 관점의 빈칸

현재 시스템은 다음 질문에는 강하다.

- 예전에 생각한 내용이 무엇이었나?
- 관련 노트와 논문은 무엇인가?
- 이 주제를 두 모델로 검토하면 어떤 결론인가?

하지만 비서가 해야 할 다음 루프는 구조화되어 있지 않다.

```text
사용자가 약속함
  -> 할 일로 구조화
  -> 때가 되면 먼저 알림
  -> 완료 여부 확인
  -> 결과와 변경 사항을 기억
```

음성 입력만 먼저 추가하면 현재 저장·회수 경로에 더 많은 데이터가 빨리 들어갈 뿐, 이 빈칸은 해결되지 않는다.

### 1.4 저장 구조 점검에서 확인한 문제

2026-07-16 Pi DB와 vault를 읽기 전용으로 대조했다.

- SQLite 외래키 오류, 고아 `note_chunks`, 임베딩 누락은 모두 0건이었다.
- 활성 topic 13개의 Markdown QA는 57개, 활성 DB 청크는 60개였다.
- 4개 topic에서 QA ID가 달랐고, 합계는 파일에만 있는 ID 1개와 DB에만 있는 ID 4개였다.
- `note_chunks.note_title` 캐시 8개가 현재 노트 제목과 달랐고, assistant source 참조 1개는 원본 메시지를 찾지 못했다.
- DB는 약 8.2MB, vault는 약 3.0MB였다. DB 용량 대부분은 약 7.3MB의 JSON 임베딩이므로 현재 문제는 저장 용량이나 벡터 검색 엔진이 아니라 일관성이다.

이는 토픽 노트 방식의 결함이 아니라, 파일 쓰기와 DB 갱신, append와 split/merge, vault sync와 청크 재생성이 하나의 복구 규칙을 공유하지 않는 데서 생긴 문제다. A1 shadow가 잘못된 청크를 학습하거나 A2가 DB에만 남은 청크를 답변 근거로 쓰지 않도록 S0를 먼저 통과한다.

## 2. 설계 원칙

### 2.1 토픽 노트 구조를 유지하되 역할을 분리한다

토픽 노트는 한 생각마다 파일을 만드는 원자 노트가 아니라, 사람이 한 주제의 흐름을 읽는 **성장형 dossier**다. 이 장점은 유지한다.

- 하나의 Q&A에는 관리용 primary topic 하나를 둔다.
- 여러 주제와 관련된 Q&A는 내용을 복제하지 않고 링크와 `note_edges`로 연결한다.
- 별도 맥락으로 계속 성장할 만큼 경계가 분명할 때만 승인형 split을 사용한다.
- AI는 긴 토픽 파일 전체가 아니라 관련 Q&A 청크와 짧은 현재 요약을 회수한다.
- CODEX 요약은 현재 상태를 빠르게 읽는 파생 뷰이며 QA-LOG 원문을 대체하지 않는다.
- 선호·사실·결정·목표와 task·reminder처럼 상태 전이가 필요한 정보는 토픽 본문에만 묻어두지 않고 SQLite 구조화 상태로 승격한다.

정본과 파생 데이터의 경계는 다음과 같다.

|영역|정본 또는 운영 기준|파생·표시 데이터|
|---|---|---|
|대화 원문|SQLite `messages`|대화 발췌·임베딩|
|topic에 속한 Q&A와 표시 본문|Markdown `QA-LOG`|`note_chunks`, 청크 임베딩|
|topic 제목·사람용 구성|Markdown 파일|SQLite `notes` 카탈로그|
|유효성·provenance·승인 상태|SQLite 상태 필드|Markdown 상태 마커·UI|
|요약·태그·연결|Markdown CODEX 구역|검색용 집계·그래프 리포트|
|논문 원본|해시가 고정된 PDF 캐시|`paper_documents`, `paper_chunks`, 임베딩|
|구조화 메모리·task·reminder|SQLite 상태 머신|관련 토픽 링크·Today/Inbox UI|

`note_chunks`는 실제 AI 회수 단위지만 정본은 아니다. 유실하거나 스키마가 바뀌어도 QA-LOG에서 재생성할 수 있어야 한다.

### 2.2 기억은 원문과 파생 상태를 분리한다

- DB 메시지와 topic QA 원문은 보존한다.
- 잘못된 기억은 물리 삭제보다 `invalidated` 상태로 회수에서 제외한다.
- 요약·임베딩·점수·메모리 제안은 다시 만들 수 있는 파생 데이터다.
- 사용자가 직접 말한 사실과 AI가 생성한 분석을 같은 신뢰도로 다루지 않는다.

### 2.3 검색은 작은 고신호 조각을 반환한다

- 노트 전체를 여러 개 넣지 않는다.
- 질문에 필요한 Q&A 청크, 요약, 출처만 넣는다.
- 질문과 무관하면 기억을 주입하지 않는다.
- 총 컨텍스트 상한은 노트별이 아니라 요청 전체에 적용한다.

Anthropic의 context engineering 원칙인 "smallest possible set of high-signal tokens"를 적용한다.

### 2.4 최신 정보가 과거 정보를 조용히 덮지 않게 한다

- 시간은 임베딩 유사도와 별도의 신호다.
- 같은 사용자 사실·취향이 바뀌면 새 항목이 이전 항목을 `superseded` 처리한다.
- 과거 내용은 감사·회고를 위해 남기되 현재 답변의 기본 근거에서는 제외한다.

### 2.5 LLM은 제안하고 코드는 집행한다

- 할 일 후보·메모리 후보 추출은 LLM이 할 수 있다.
- 날짜 파싱, 상태 전이, 중복 알림, 재시도 상한은 코드가 처리한다.
- 외부 행동과 민감한 변경은 사용자 승인을 요구한다.
- 명확한 예약 작업은 자율 에이전트가 아니라 결정론적 scheduler/workflow로 실행한다.

### 2.6 평가 없이 검색 가중치를 바꾸지 않는다

- RRF, 그래프 검색, reranker는 먼저 넣지 않는다.
- 현재 하이브리드 검색을 기준선으로 기록한다.
- 실제 실패 사례에서 개선이 측정될 때만 다음 검색 방식을 채택한다.

## 3. 전체 흐름

```text
사용자 입력
  -> 의도/시간 표현 정규화
  -> 명시적으로 활성화한 자료
  -> 노트 후보 회수
  -> 후보 안의 Q&A 청크 회수
  -> 최신성·유효성·출처 적용
  -> 요청 전체 컨텍스트 상한으로 조립
  -> Claude 또는 의회 답변
  -> 실행 trace 기록
  -> 저장 정책(auto/manual/never/inbox)
  -> 메모리·할 일 후보가 있으면 승인 큐
```

답변 모델은 원문 파일 경로, 임의 chunk ID, 임의 URL을 직접 선택하지 않는다. 서버가 허용한 evidence만 전달한다.

## 4. A - 기억 신뢰성

### 4.1 회수 단위

초기 구현은 기존 자료 유형을 다음처럼 다룬다.

|자료|후보 선택|모델에 넣는 단위|
|---|---|---|
|topic|제목·태그·요약·청크 집계|관련 `topic_qa` 청크|
|paper|기존 paper 노트 검색|초록 또는 전문 도구 evidence|
|single/council/manual|기존 노트 검색|짧은 노트는 전체, 긴 노트는 관련 발췌|
|과거 대화|기존 메시지 임베딩|질문·답변 발췌 최대 2개|
|사용자 메모리|활성 구조화 메모리|현재 유효한 항목만|

topic은 `note_chunks`가 실제 지식 단위다. 파일 전체 임베딩은 후보 노트를 찾는 보조 신호로만 유지한다.

### 4.2 노트 신호와 전역 청크 검색

1. **명시적 자료 경로**
   - activeNotes는 사용자가 직접 활성화한 자료로 우선한다.
   - activeNotes도 관련 청크를 우선하며, 긴 노트 전체가 요청 총량 상한을 우회하지 않는다.

2026-07-16 `516a147`을 Pi에 배포해 `/search` 결과의 자동 활성화를 제거하고 검색 카드·일반 노트·저장 논문 상세에서만 명시적으로 activeNotes를 추가·제거하도록 바꿨다. 이 UI 변경은 질문 기반 자동 회수와 A1 shadow 경로를 변경하지 않는다.

2. **일반 topic 경로**
   - 활성 topic의 `note_chunks`를 전역 후보로 검색한다.
   - 제목, aliases, Codex 태그, 요약, 노트 임베딩 점수는 청크 점수의 soft prior로 사용한다.
   - 노트 top 3을 먼저 확정해 그 밖의 청크를 버리는 hard gate는 유일한 경로로 사용하지 않는다. A1 첫 shadow에서 목표 노트를 놓친 경우 그 안의 정답 청크를 회수할 수 없었기 때문이다.
   - 키워드와 기존 청크 임베딩을 함께 사용하고, archive 또는 index가 준비되지 않은 청크는 제외한다.
   - 같은 topic의 비슷한 청크가 결과를 독점하지 않도록 기본 노트당 최대 3개를 둔다. `함께`, `같이`, `동시에`, `둘 다`, `각각`처럼 여러 근거를 명시한 질문만 최대 5개로 넓힌다.
   - 동일한 사실의 갱신 관계가 있으면 최신 active 항목을 우선하고, 낮은 점수 결과는 넣지 않는다.

A1 shadow에서 기존 hard-gated 2단계 결과와 전역 청크+노트 soft prior 결과를 같은 fixture로 비교한다. 현재 규모에서는 전역 후보 검색 비용이 작으며, 새 벡터 DB나 LLM reranker는 추가하지 않는다. 구현은 `getGlobalChunkCandidates` provider 경계 뒤에 후보 조회를 두므로, 청크 수와 retrieval p95가 병목이 될 때 랭킹 계약은 유지하고 provider만 FTS 또는 벡터 사전 선택으로 교체한다.

초기 결과 상한:

```text
RETRIEVAL_MAX_NOTES=3
RETRIEVAL_MAX_CHUNKS=6
RETRIEVAL_MAX_CHARS_PER_CHUNK=1400
RETRIEVAL_MAX_CONTEXT_CHARS=8000
```

숫자는 첫 기준선이다. 실제 20개 평가에서 컨텍스트가 부족하거나 과하면 조정한다. 모델 프롬프트가 아니라 서버가 자른다.

### 4.3 최신성과 시간 질의

- `최근`, `요즘`, `마지막`, `그 뒤`, `현재`가 있으면 시간 범위와 최신성 가중을 활성화한다.
- 날짜를 포함한 질문은 해당 기간 밖 결과를 기본적으로 낮춘다.
- 최신성은 관련도 없는 새 항목을 끌어올리는 주점수가 아니라 동점 해소·갱신 선택 신호로 사용한다.
- `created_at`과 `updated_at`을 구분한다. 노트가 정리된 시각이 원래 발언 시각을 바꾸지 않는다.

LongMemEval의 time-aware query와 knowledge update 범주를 최소 형태로 반영한다.

### 4.4 출처와 신뢰 경계

`note_chunks`에 다음 파생 메타데이터를 추가한다.

```text
source_type:
  user_statement
  manual_memo
  assistant_analysis
  web_grounded
  paper_grounded
  legacy

validity:
  active
  invalidated
  superseded

source_refs_json: 웹 URL 또는 paperId/chunkId 참조
invalidated_at
invalidated_reason
supersedes_chunk_id
```

원칙:

- 일반 Q&A의 질문·답변 역할 표시는 유지하고, `source_type`은 저장된 답변의 주된 근거 유형을 뜻한다.
- 사용자 발언과 수동 메모는 사용자 사실·취향의 1차 근거가 될 수 있다.
- AI 답변은 `assistant_analysis`이며 검증된 사실처럼 표현하지 않는다.
- 웹·논문 근거가 있으면 참조를 저장하되, 원문이 사용자 지시보다 우선하지 않는다.
- 기존 청크는 마이그레이션 시 `legacy`로 두고 임의로 신뢰도를 추측하지 않는다.
- `confidence` 숫자를 새로 만들지 않는다. 초기에는 source type과 validity만 사용한다.

### 4.5 Q&A 단위 기억 제외

최근 저장 화면에서 각 Q&A에 `기억에서 제외` 동작을 제공한다.

실행 결과:

1. 해당 `note_chunks` 행을 `invalidated`로 변경한다.
2. QA-LOG 원문에는 서버 소유 상태 마커를 추가한다.
3. active 청크만 사용해 노트 요약·노트 임베딩을 다시 만든다.
4. 이후 검색·Codex 요약·링크 후보에서 제외한다.
5. 감사 목적으로 원문과 invalidation 이유는 남긴다.

일반 UI의 물리 삭제는 계속 미룬다. 사용자의 실수 취소는 다시 되돌릴 수 있어야 한다. 단, 사용자가 명백한 오저장이라고 특정한 Q&A는 별도 승인형 유지보수 명령에서 사전 백업·본문 hash·출처 메시지·저장 결정 ID를 모두 확인한 뒤 Q&A·청크·저장 기록만 물리 삭제할 수 있다. 원본 대화는 이 경우에도 남긴다.

### 4.6 저장 정책

요청마다 서버가 다음 저장 정책 중 하나를 선택한다.

|정책|용도|영구 topic 반영|
|---|---|---|
|`auto`|일반 채팅·의회|현재 가치 판정 후 가능|
|`manual`|명시적 저장|사용자 확인 후|
|`never`|스모크·평가·관리 요청|안 함|
|`inbox`|정밀 음성 전사·R2 Realtime 완료 턴·불확실한 캡처|사용자 분류 전에는 안 함|

`never`와 `inbox`는 클라이언트 문자열만 믿지 않고 서버가 허용한 경로·세션 유형으로 결정한다. 테스트 스크립트는 전용 인증된 내부 경로 또는 명시적 서버 옵션을 사용한다.

자동 저장 분류기는 계속 저비용 휴리스틱으로 시작하되, 다음을 추가한다.

- 테스트·상태 확인·배포 검증 문구 차단
- 과거 대화·노트 회수 질문과 회수 실패·불확실 답변 차단
- 답변 길이만으로 durable knowledge로 판단하지 않음
- paper evidence와 web source가 있으면 provenance 전달
- 저장 결과를 최근 저장에서 즉시 확인·무효화 가능

### 4.7 구조화 사용자 메모리

현재 `memory.md` 문자열 목록은 명시적 규칙을 위한 호환 경로로 유지한다. 장기적으로 바뀔 수 있는 사용자 정보는 SQLite의 구조화 메모리로 분리한다.

```text
assistant_memories
  id
  memory_type       # preference | fact | routine | decision | goal
  memory_key        # 충돌·갱신을 찾는 안정 키
  value
  status            # proposed | active | superseded | rejected
  source_session
  source_message
  source_note
  valid_from
  supersedes_id
  created_at
  updated_at
```

메모리 생성 흐름:

```text
명시적 사용자 발언
  -> 메모리 후보 추출
  -> 기존 active memory와 충돌 검사
  -> 시온 알림센터에 추가/갱신 제안
  -> 사용자 승인
  -> active 또는 superseded 전이
```

자동으로 확정하지 않는다. AI 답변에서 사용자 메모리를 추출하지 않는다. `/memory add`처럼 사용자가 명시한 명령은 기존처럼 즉시 반영할 수 있다.

## 5. B - 평가와 관측

### 5.1 평가 세트

처음부터 대규모 벤치마크를 만들지 않는다. 실제 실패와 중요 사용 흐름에서 20개를 만든다.

|범주|초기 개수|검사|
|---|---:|---|
|정확한 단일 기억 회수|5|목표 chunk가 top-k에 포함|
|여러 세션 종합|4|필수 chunk 둘 이상 회수|
|최신 정보·변경 반영|4|superseded 제외, 최신 active 선택|
|시간 표현|3|기간과 순서가 맞음|
|모르는 질문|4|무관한 기억을 넣지 않고 모른다고 함|

공개 저장소에는 합성 fixture를 둔다. 실제 개인 노트를 쓰는 평가 케이스는 Pi의 비공개 경로에 두며 백업·권한 정책을 따른다.

### 5.2 지표

첫 구현에서 측정할 값:

- note Recall@3
- chunk Recall@6
- 잘못된 evidence 주입률
- invalidated/superseded 회수 건수
- 요청당 retrieval context 문자 수
- 응답 지연
- 모델 input/output token
- 도구 호출 횟수와 실패율
- 자동 저장 precision: 최근 저장 검토에서 유지된 비율

정확한 자연어 답변 점수는 두 번째다. 먼저 서버가 올바른 근거를 골랐는지 결정론적으로 검사한다.

### 5.3 실행 trace

각 모델 요청에 서버 생성 `run_id`를 부여한다.

```text
assistant_runs
  run_id
  session_id
  user_message_id
  mode
  model_id
  status
  latency_ms
  input_tokens
  output_tokens
  retrieval_context_chars
  tool_calls_json
  error_code
  created_at

assistant_run_evidence
  run_id
  evidence_type     # memory | note | qa | web | paper
  reference_id
  note_filename
  score
  rank
```

trace에는 API 키, 전체 프롬프트, 전체 외부 원문을 중복 저장하지 않는다. 디버깅에 필요한 참조와 수치만 기록한다.

### 5.4 응답 진행 상태

답변 대기 중에는 별도 오버레이를 만들지 않고 기존 점 세 개 위치에 서버가 실제로 수행 중인 큰 단계만 표시한다. 이는 사용자 대기 경험을 위한 일시적 전송 이벤트이며 `assistant_runs` trace나 모델의 내부 추론 공개가 아니다.

- `/api/chat`과 `/api/council/debate`는 클라이언트가 `progress: true`를 보낸 경우에만 NDJSON으로 단계와 최종 결과를 전송한다.
- 공개 단계 ID는 `context`, `evidence`, `web_search`, `paper_search`, `paper_read`, `answer`, `council_draft`, `council_critique`처럼 안정된 작업 경계만 사용한다.
- 검색·전문 도구 단계는 도구가 실제 실행될 때만 내보내고, 완료 후 답변 또는 초안 작성 단계로 돌아간다.
- 단계 이벤트에는 질문, 검색어, 근거 본문, 도구 결과, 모델 내부 추론을 넣지 않으며 영구 저장하지 않는다.
- 진행 표시를 위해 모델이나 외부 API를 추가 호출하지 않는다.
- progress를 요청하지 않은 호출과 스트림 시작 전 검증 오류는 기존 JSON 응답을 유지한다. 프론트도 일반 JSON 응답을 fallback으로 처리한다.
- 심층 재검증과 최종 종합은 브라우저가 이미 분리된 요청 시작을 알고 있으므로 별도 스트리밍 없이 같은 상태 문구 컴포넌트를 사용한다.

### 5.5 사용자 피드백

답변 아래에 상시 큰 평가 UI를 두지 않는다. 작은 메뉴에서 다음만 제공한다.

- 답변 도움됨
- 잘못된 기억 사용
- 출처가 맞지 않음

`잘못된 기억 사용`은 해당 run의 evidence 목록을 열고 Q&A 단위 invalidation으로 이어진다. 피드백은 다음 평가 fixture 후보로 남긴다.

### 5.6 답변 근거 표시

단일 채팅과 의회 결과에 간단한 상태를 표시한다.

```text
기억 3 · 웹 2 · 논문 전문 1
```

누르면 제목, 날짜, 섹션·페이지, URL을 확인한다. 원문 전체나 내부 점수는 기본 화면에 노출하지 않는다.

현재 API가 반환하는 `paperFullText.used`, `calls`, `evidenceRefs`는 이 표시와 저장 provenance에 사용한다. 브라우저가 전문 본문을 보관하거나 심층 의회 요청에 재전송하지 않는 기존 원칙은 유지한다.

### 5.7 자동화 회귀 테스트

- 임시 SQLite와 임시 vault를 사용하는 통합 harness를 만든다.
- 모델·임베딩·시간·알림 채널은 주입 가능한 mock으로 둔다.
- 저장 정책, 청크 회수, invalidation, supersession, reminder 중복 차단을 API까지 통과시킨다.
- 실사용 Pi 데이터는 테스트 fixture로 복사하지 않는다.

## 6. C - 약속 루프

첫 구현은 AI 에이전트가 아니라 개인 할 일·알림 시스템이다. 외부 캘린더를 읽고 일정을 재배치하는 향후 `V5-C 일정 에이전트`와 구분한다.

구현 세부사항의 단일 기준은 [V4.5-C 시온 약속 루프 상세 설계](task-reminder-design.md)다. 반복까지 2-table에 넣던 기존 초안은 회차 완료와 알림 확인을 분리하지 못하고 task의 `snoozed` 상태도 의미가 겹쳐 폐기했다.

C1은 아래 범위만 구현한다.

- 명시적 `/task`와 사용자 확인 후 active task 생성
- 기한 없음·날짜 전용·KST 절대 시각 기한
- 단발성 reminder, 30초 scheduler, 재시작 catch-up, 중복 차단
- Today·예정·Inbox, 완료·취소·다시 열기·삭제·복원·확인·1시간 미루기
- 완료·취소는 참조 가능한 `closed`, 잘못 만든 항목은 일반 회수에서 제외하는 `deleted`; C1 물리 purge 없음
- reminder를 약속 occurrence 정본으로, subscription별 delivery를 별도 outbox·전송 receipt로 사용하는 crash-safe 흐름
- Tailscale Serve private HTTPS, 최소 PWA, 사용자 opt-in Web Push와 일정 에이전트·foreground polling fallback
- 지식 시트 첫 `알림` 탭: `전체 | Codex | 시스템 | 최근 저장`. 일정 알림은 여기서 제외한다.
- 에이전트 탭 최상단의 일정 에이전트 블록: 3주 21일 스와이프, 지연·오늘·예정·Inbox, 오늘·지연 최대 3개, 다음 알림, unresolved reminder, push 상태와 같은 탭의 일정 작업 화면

자연어 후보, 반복, 오늘 브리핑, 완료 결과 기록, 외부 캘린더는 C1 본체에서 제외한다. C1.5는 단일 Claude가 직접 사용자 요청에서 `schedule_prepare`로 무저장 후보 하나만 만들고, 확인 뒤 기존 task API가 저장하는 자연어 진입으로 별도 구현했다. 반복은 `task -> occurrence -> reminder`의 3층이 필요한 별도 schema migration으로 진행한다. Web Push는 C1 범위지만 task core와 분리된 schema·feature flag·인수 단위로 구현한다.

명시적 `/task`, 새 전용 테이블·모듈, 무LLM을 지키는 C1은 A1b shadow 관찰과 격리해 병행할 수 있다. C1e는 사용자 컨펌 뒤 활성 일정 bounded 컨텍스트와 종결 일정 월별 노트를 추가했으며 A1b 점수·trace와 topic 자동 저장 판단은 바꾸지 않는다. C1.5도 A1b 점수·trace 형식은 유지하고 후보가 생긴 운영 요청만 topic 자동 저장에서 제외한다. 숨은 웹 탭을 계속 refresh하는 방식은 지원 계약이 아니며, Pi scheduler가 시각을 판정하고 Service Worker가 push event 때만 깨어난 뒤 앱 복귀 시 정본을 재동기화한다.

## 7. V4-B 음성과의 경계

상세 단일 기준은 [V4-B 시온 음성·Realtime 설계](voice-realtime-design.md)다. 이 문서에서는 V4.5 기억·task 경계만 고정한다.

1. **Realtime 대화**
   - R0·R1은 DB·Vault·task에 쓰지 않는다.
   - R0는 서버 소유 unified SDP proxy, raw WebRTC client, tool 0개, 5분 hard cap과 공용 media cleanup을 Pi 운영에 활성화했다. Mac·Pi HTTPS의 실제 `201`·remote audio·완료 자막과 DB·Vault·task 불변, 사용자 iPhone의 5분 한·영 대화·끼어들기·mute·수동/자동 종료·마이크 해제를 통과해 GO로 승격했다.
   - R1의 기억·일정 도구는 기존 A2 retrieval과 task 합성기를 읽기 전용으로 재사용한다.
   - R2는 완료된 user/assistant 턴만 DB에 idempotent하게 저장하고, 끼어들기로 취소된 assistant partial은 일반 메시지로 남기지 않는다.
   - 일정·메모는 모델의 직접 쓰기를 허용하지 않고 기존 후보 카드와 사용자 확인을 거친다.
2. **정밀 전사**
   - 기존 `STT -> isMemo: true -> 항상 저장` 흐름은 폐기한다.
   - `녹음 → STT → 전사 미리보기·수정 → 대화 | 메모 | 할 일 → 사용자 확인` 뒤 기존 파이프라인으로 보낸다.

짧은 잡음, 잘못된 인식, 테스트 녹음은 영구 기억에 들어가지 않는다. 원본 오디오는 두 경로 모두 장기 보관하지 않으며, 정밀 전사의 임시파일은 성공·실패·취소 뒤 삭제한다.

## 8. 보안과 승인 경계

- schema v5는 `notes.ai_readable`을 Markdown frontmatter와 동기화한다. 명시적 `false`인 노트는 답변·검색·A1b·논문 전문·MCP AI 읽기·임베딩·Codex·AI 파생 그래프에서 제외하되 사람의 직접 열람은 유지한다. schema v6 task core, schema v7 Web Push, schema v8 일정 노트 projection과 C1.5 자연어 후보까지 Pi에 적용했다. 30초 scheduler의 조기 발송 차단, projection, 무저장 후보 경계를 포함한 로컬/Pi 전체 테스트 171/171을 통과했다.
- 이 경계는 모델에 제공하는 컨텍스트와 자동 작업 범위를 통제한다. 암호화·OS 계정 분리는 아니므로 API 키와 인증정보는 vault에 넣지 않는다.
- 첫 실제 에이전트 노트 writer인 일정 월별 종결 기록에 `owner_agent=schedule`을 추가했다. 일정 에이전트 본문 / 사서 CODEX 마커 / 타 에이전트 읽기 전용의 세 규칙을 적용하되 폴더·범용 ACL·`relative_path`는 만들지 않는다.
- 기본 회수 범위는 자기 소유와 공용 노트다. 교차 에이전트 노트는 명시적 링크·handoff·사용자 요청이 있을 때만 읽어 컨텍스트 오염을 막는다.
- 기억 invalidation은 되돌릴 수 있어야 한다.
- task 생성은 사용자 확인 전 `proposed`다.
- 알림은 정보를 보여줄 뿐 외부 행동을 실행하지 않는다.
- 외부 콘텐츠 안의 task 생성·저장·정책 변경 지시는 무시한다.
- 웹·논문·음성 텍스트를 근거로 민감한 행동을 자동 실행하지 않는다.
- 향후 캘린더 쓰기, 이메일 발송, 결제, 매매는 각각 별도 권한과 승인 기록을 요구한다.
- 재시도 횟수, 도구 호출, 일일 비용은 코드 상한을 둔다.

OpenAI의 agent guide에서 말하는 고위험 행동의 human oversight 원칙과 기존 Codex 승인 게이트를 그대로 확장한다.

## 9. 코드 구조 방향

대규모 선행 리팩터링은 하지 않는다. 각 단계를 구현할 때 아래 모듈을 새로 만들고 `server.js`에는 설정·의존성 주입·얇은 라우트만 둔다.

```text
lib/topic-store.js           # QA-LOG 파싱, 토픽 변경 직렬화, audit/reindex
lib/db-migrations.js         # schema version과 순차 migration
lib/assistant-retrieval.js   # 노트 후보, 청크 검색, 컨텍스트 조립
lib/assistant-memory.js      # 메모리 제안·갱신·상태 전이
lib/assistant-trace.js       # run/evidence/feedback 기록
lib/assistant-tasks.js       # task/reminder 상태와 검증
lib/assistant-task-routes.js # task/reminder HTTP 계약과 feature flag
lib/assistant-scheduler.js   # due reminder, catch-up, 중복 차단
lib/assistant-push.js        # subscription, delivery outbox, retry
public/agent-panel.js        # 일정 요약과 향후 에이전트 블록
```

기존 에이전트 탭 shell은 유지하고 `public/agent-panel.js`를 별도 모듈로 추가한다. 현재 tab 전환을 가진 `paper-panel.js`에는 `AgentPanel.init()`·`show()` 연결만 두며, `paper-panel.js`와 `note-panel.js`의 공용 helper 추출을 선행 조건으로 만들지 않는다. 일정 데이터가 생기기 전 빈 대시보드를 먼저 만들지 않고 C1b task summary와 함께 활성화한다.

## 10. 구현 순서

### A0. 기준선 고정

- [x] 합성 fixture와 Pi 비공개 실사용 평가 20개 작성
- [x] 현재 검색 결과, 컨텍스트 문자 수, 지연 측정
- [x] DB·볼트 백업을 Pi 밖의 암호화된 위치에도 복사
- [x] 같은 시각의 DB·볼트 백업으로 임시 복원 검증

2026-07-16 합성 기준선을 고정했다. `fixtures/assistant-retrieval-eval.js`는 단일 기억 5개, 여러 세션 종합 4개, 최신 정보 4개, 시간 3개, abstention 4개로 구성한다. 현재 노트 단위 회수는 note Recall@3 20/20이지만, 노트 앞 5,000자만 주입하는 경로의 chunk Recall@6는 11/20이었다. 최신 정보·시간 7개는 모두 노트를 찾고도 뒤쪽 Q&A를 컨텍스트에 넣지 못했다. 컨텍스트는 평균 3,957자, 최대 10,425자였고 20개 중 3개가 향후 8,000자 총상한을 넘었다.

Pi 비공개 실사용 20개에서는 엄격한 note Recall@3 15/20, chunk Recall@6 7/20, abstention 0/4였다. 알려진 기억 16개만 보면 목표 노트는 15/16으로 잘 찾았지만, 낮은 임계값으로 거의 모든 질의에 노트 8개를 채워 넣어 컨텍스트가 평균 35,327자, 최대 40,439자로 커졌다. A1은 청크 점수화뿐 아니라 무관 노트 중단과 최대 3개 후보 상한을 shadow mode에서 같이 검증해야 한다. `npm run eval:retrieval`로 합성 평가를, `--base-url`과 깃에서 제외된 fixture로 Pi 평가를 재현한다. 같은 시각 `20260715-2135`의 DB·vault 백업을 FileVault가 켜진 Mac의 깃 제외 위치로 복사해 Pi와 SHA-256 일치를 확인했다. 임시 복원은 SQLite `integrity_check=ok`, 외래키 오류 0건, 추적 노트 누락 0건을 통과했다.

### A1. 청크 회수 shadow mode

- [x] 새 retrieval이 고른 evidence를 trace에만 기록
- [x] 실제 모델 답변은 기존 회수를 유지
- [x] 합성·Pi 비공개 20개 평가에서 기존과 새 결과 비교

`c5e5d04`에서 노트 최대 3개, 청크 최대 6개, 노트당 청크 2개, 청크당 1,400자, 총 8,000자 상한을 구현했다. 합성 shadow는 note Recall@3 20/20, chunk Recall@6 20/20, abstention 4/4, 컨텍스트 상한 20/20이었다.

Pi 실사용 shadow는 note Recall@3 15/20, chunk Recall@6 9/20, abstention 0/4, 컨텍스트 상한 20/20이었다. 무관 노트는 53개 중 38개, 무관 청크는 71개 중 58개였다. 상한 집행은 성공했지만 hard note gate와 낮은 중단 성능 때문에 실제 답변 전환 기준은 통과하지 못했다.

### S0. 토픽 저장 무결성 (A2 전 필수)

S0a 읽기 전용 감사 기반은 `575205a`에서 구현해 Pi까지 배포·검증했다. 날짜 제목+`qa_id`를 함께 보는 QA-LOG 파서, CRLF·trailing space를 정규화한 note/QA SHA-256, Markdown/DB의 file-only·DB-only·배정 drift·중복·제목·source 참조를 분리하는 `npm run audit:topics`를 추가했다. Pi의 활성 topic 13개에서 파일 QA 57개·DB QA 60개 중 55개가 고유하게 일치했다. malformed·file-only·배정 drift·고아·임베딩 누락은 0건이고, 동일 `qa_id`가 두 토픽 파일에 들어간 중복 1건, DB-only 4건, 제목 drift 8건, 형식이 잘못된 assistant source 참조 1건, 보관 노트 청크 1건을 확인했다. 전체 테스트 64개를 통과했고 감사 전후 `council.db` SHA-256도 같았다. 자동 복구·schema 변경·데이터 수정은 하지 않았다.

S0b-1은 `fdabe05`, `8c2d490`에서 readonly `npm run plan:topic-repair`로 구현해 Pi까지 검증했다. 원문을 출력하지 않고 Q&A·청크 본문 hash, DB 배정, `auto_save_decisions` provenance로 복구 근거를 만들며 입력 상태 hash도 고정한다. Pi 계획 15건은 적용 후보 13건(제목 캐시 8, DB-only `source_missing` 4, 보관 청크 제외 1)과 수동 검토 2건으로 나뉘었다. 전체 테스트 65개를 통과했고 실행 전후 DB SHA-256은 같았다.

수동 항목 중 중복 Q&A는 M60 토픽과 향수 토픽에 본문 hash까지 같은 복사본이다. DB 청크와 자동저장 기록은 모두 M60 토픽을 가리키므로 M60의 ID를 유지하고 향수 토픽 복사본을 제거하는 계획이다. UUID형 assistant source 참조는 당시 `auto_save_decisions`에도 같은 값이 남은 legacy provenance라 조용히 지우지 않는다. S0b-2b의 요구사항은 백업, 계획 입력 hash 재검증, 승인형 적용과 재감사로 확정했다.

S0b-2a는 `699d1e9`에서 로컬 구현했다. `schema_version` 1·2를 순서대로 transaction 안에서 적용하는 migration 모듈을 만들고, 기존 `note_chunks`에 정규화 본문 `content_sha256`과 `ready | source_missing` 상태를 추가했다. 새 Q&A 저장은 hash와 `ready`를 함께 갱신하고 본문 hash가 바뀌면 오래된 임베딩만 비운다. `source_missing`은 청크 조회·랭커·저장 상태 표시·감사 일치 집계에서 제외하며, UUID형 source는 같은 `qa_id`·노트·`auto_save_decisions` 값이 모두 일치할 때만 legacy provenance 관찰 항목으로 분류한다. 구형 DB 호환과 migration 멱등성을 포함한 전체 테스트 70개를 통과했다.

이번 단계는 메모리 DB fixture로만 검증했다. 실제 로컬·Pi 운영 DB와 vault는 변경하지 않았으며, 서버 시작 시 migration이 실행되므로 Pi 배포는 백업과 별도 컨펌 뒤에 진행한다.

S0b-2b는 `7e4fdc5`에서 로컬 구현했다. `npm run apply:topic-repair`는 기본적으로 readonly 계획만 출력한다. 실제 적용은 서버 중지 확인, 정확한 계획 입력 SHA-256, 각 수동 작업 ID 승인을 요구한다. 승인 후에도 백업을 먼저 만들고 migration 뒤 같은 hash를 재검증하며, 정확히 같은 중복 Q&A만 임시 파일+rename으로 제거한다. 제목 캐시는 DB transaction에서 갱신하고 DB-only 청크는 물리 삭제 대신 `source_missing`으로 바꾼다. 적용 후 감사가 clean이 아니거나 중간 DB 작업이 실패하면 vault 파일과 migration 전 DB를 함께 복원한다.

보관 노트 청크는 원본이 사라진 것이 아니므로 `source_missing`으로 바꾸지 않는다. 활성 topic과 JOIN한 조회에서 제외하고 감사에서는 정상 관찰 항목으로 남긴다. 사용자 지정 DB 경로 백업, 승인 누락, stale hash, 성공 적용, 강제 DB 실패 rollback을 포함해 전체 테스트 76개를 통과했다.

2026-07-16 Pi maintenance window에서 S0b-2를 실제 적용했다. 서비스 중지 후 새 계획의 입력 hash `ce458ee775f4f4e40e2a94b205f5cf968d515a0c0dcdea6ec9af6558a78e0f17`과 수동 작업 `duplicate-file-qa:qa-767c6f81-5915-48ba-be52-dbd6bd4bfc18`을 확인하고, 동시 백업 `council-20260716-1733.db`·`vault-20260716-1733.tar.gz`을 만든 뒤 schema version 2와 작업 13건을 적용했다. M60 토픽의 원본 Q&A는 유지하고 향수 토픽의 동일 복사본만 제거했으며, 제목 캐시 8건과 DB-only 청크 4건을 각각 현재 제목·`source_missing` 상태로 갱신했다.

적용 후 활성 topic의 Markdown Q&A 65개와 ready 청크 65개가 모두 일치했다. malformed·file-only·DB-only·배정 drift·중복·제목 drift·source 참조 오류·고아·임베딩 누락은 모두 0건이고, SQLite `integrity_check=ok`, 외래키 오류 0건, Pi 전체 테스트 76개, 인증 API와 systemd 재기동을 통과했다. 재실행한 복구 계획은 `clean`, 작업 0건이다.

S0c는 `d41defe`에서 구현해 Pi 인수까지 마쳤다. `lib/topic-mutation.js`의 전역 queue가 append·split·merge·archive/restore를 직렬화하고, `lib/topic-store.js`의 날짜 제목+`qa_id` strict parser를 쓰기와 Q&A 목록·요약·제목 재생성에 공통 사용한다. 각 파일 변경은 읽은 원문 또는 파일 부재를 precondition으로 다시 확인하고 같은 디렉터리의 임시 파일+rename으로 적용한다. 여러 파일은 전부 snapshot한 뒤 쓰며, 관련 `notes`·`note_chunks`·`auto_save_decisions`·edge 변경은 하나의 동기 SQLite transaction에서 처리한다. 파일 쓰기나 DB transaction이 실패하면 snapshot을 복원하고 queue는 다음 작업을 계속 받는다.

merge는 target 변경 뒤 source 보관이 실패해도 성공으로 넘기던 동작을 제거하고 전체 mutation을 실패·복원한다. split은 청크 이동에 기존 source filename까지 요구하며, 빈 source를 지우기 전 source의 전체 청크 수가 이동 ID 수와 같은지 확인해 `source_missing` 등 숨은 청크를 조용히 삭제하지 않는다. 전체 테스트 85개, 임시 서버 HTTP split→archive/restore→merge와 최종 audit, 로컬 topic 3개·Q&A 7/7 readonly audit를 통과했고 로컬 DB hash는 전후 동일했다.

2026-07-17 Pi 배포 전 동시 DB·vault 백업 `20260717-1754`와 기존 코드 백업을 남겼다. 배포 파일 6개의 hash가 로컬과 일치했고 Pi 전체 테스트 85개를 통과했다. readonly audit은 활성 topic 13개, Markdown Q&A 65개, ready 청크 65개가 전부 일치했으며 DB hash는 전후 `c9c57afe…f1ede`로 같았다. 서비스는 새 PID로 재기동했고 `/api/config`, 인증된 `/api/organize/status`·`/api/notifications`가 정상 응답했으며 재기동 이후 error journal은 0건이다.

S0d는 `68604af`에서 구현했다. audit이 단일 Markdown 정본과 누락 청크를 확인해 만든 `reindex_file_qa` 계획을 기존 승인형 apply가 실행한다. 적용 단계는 strict parser로 원문과 계획 hash를 다시 검사하고, 출처가 없거나 정확히 한 자동 저장 기록으로 확정되는 Q&A만 대상으로 삼는다. 자동 저장 출처가 여러 개이거나 현재 노트 배정과 다르면 `manual_review`로 남긴다. OpenAI 임베딩이 먼저 유효하게 생성된 경우에만 기존 `topic-chunk-store`가 provenance·본문 hash·`ready` 청크와 임베딩을 하나의 DB transaction에 쓰므로 검색 가능한 척하는 빈 임베딩 청크를 만들지 않는다. stale 원문은 백업 전에 중단하고, 백업 뒤 임베딩 실패나 DB insert 실패는 migration 전 DB로 복원한다. 성공·출처 중복·stale hash·임베딩 실패·DB 실패·재실행 멱등성을 포함한 로컬 전체 테스트 109개, readonly audit 7/7과 복구 계획 `clean`을 통과했다.

같은 날 Pi DB·vault 백업 `20260718-1437`과 코드 백업 `s0d-reindex-pre-20260718-143720.tar.gz`를 만든 뒤 4개 파일의 로컬/Pi SHA-256 일치를 확인했다. Pi 전체 테스트 109개, readonly audit의 활성 Q&A/ready 청크 66/66, 복구 계획 `clean`·작업 0건, Codex 검증 20개를 통과했다. 재시작 전 백업과 재시작 후 현재 DB는 schema_version을 제외한 12개 application table 행 수가 모두 같고, 양쪽 모두 schema 3, `integrity_check=ok`, 외래키 오류 0건이었다. 인증된 `/api/config`·`/api/organize/status`가 `200`을 반환하고 새 PID 서비스와 시작 로그가 정상이었다. 현재 불일치가 없어 실제 복구 apply와 임베딩 호출은 실행하지 않았다.

S0e는 `9efb501`에서 2026-07-18 로컬 구현했다. schema version 4는 `notes.content_sha256`, `indexed_sha256`, `pending | ready | error | missing` 상태를 추가한다. topic은 strict parser로 정규화한 QA-LOG, 그 외 노트는 생성 태그·링크·제안 구역을 제외한 의미 본문을 hash한다. 노트 저장·append·split·merge·archive/restore·vault sync와 전체 임베딩 경로가 같은 상태 모듈을 사용하고, 비동기 임베딩은 시작할 때의 content hash가 현재 hash와 일치할 때만 `ready`가 된다. `/sync`는 원문이 사라진 노트와 청크를 더 이상 물리 삭제하지 않고 `missing`으로 표시한다. `npm run audit:note-index`는 본문을 출력하지 않고 파일/hash/마지막 성공 인덱스 상태를 readonly로 검사한다.

`note_chunks.note_title`은 쓰기 호환 캐시로 유지하되 저장 상태·단일/전역 청크 조회·그래프 표시는 `notes.title` 조인을 사용한다. repair audit만 캐시 drift를 찾기 위해 `note_title`을 직접 읽는다. 같은 file-only Q&A 복구를 두 번 실행해 두 번째가 no-op이고 청크 ID·본문 hash·상태가 그대로임을 확인했다. malformed topic은 기존 파일·DB 증거를 보존한 채 격리되며 다른 정상 Q&A 재색인을 막지 않는다. 실제 자식 프로세스를 rename 직후 `SIGKILL`로 종료한 append와 split/merge 형태에서는 다음 audit이 각각 file-only Q&A와 assignment drift를 검출했고 DB 청크는 삭제되지 않았다. 로컬 전체 테스트 116개, 기존 topic readonly audit 7/7과 복구 계획 `clean`을 통과했다.

같은 날 Pi 서비스를 중지하고 DB·vault 동시 백업 `20260718-1540`과 코드 백업 `s0e-pre-20260718-154007.tar.gz`를 만든 뒤 백업 DB의 schema 3·SQLite 무결성·외래키, vault 압축 67개 엔트리와 코드 백업 제외 범위를 검증했다. 배포 파일 23개의 로컬/Pi SHA-256이 모두 일치했고 Pi 전체 테스트 116개를 통과했다. schema 3→4 migration 뒤 `/sync`는 DB/vault 노트 29개를 등록하고 missing 0건을 반환했으며, 활성 노트 재임베딩은 20/20 성공·실패 0건이었다. note-index audit은 DB/vault 29/29, ready 20, 보관 pending 9, error·missing·finding 0건이었다. topic audit은 Q&A 66/66, 복구 계획은 `clean`·작업 0건, Codex 검증은 20개를 통과했다. 백업 대비 schema_version을 제외한 12개 application table 행 수 차이 0건, 현재 DB `integrity_check=ok`, 외래키 오류 0건, 인증 API와 새 PID 서비스, 재시작 뒤 오류 로그 0건을 인수했다. Pi `.env`의 `PAPER_SEARCH_MOCK=false`도 유지했다.

파일시스템과 SQLite를 하나의 ACID transaction으로 만들 수는 없다. 잡힌 예외는 즉시 복원하지만 rename 뒤 `SIGKILL`·전원 차단이 발생하면 다음 `audit:topics`가 drift를 찾아야 한다. 현재 단일 사용자 규모에서는 영속 mutation journal보다 이 경계를 유지하는 편이 단순하며, 운영 중에는 readonly audit으로 이 경계를 감시한다.

- [x] `schema_version`과 순차 migration을 별도 모듈로 관리
- [x] 모든 append·split·merge·archive/restore를 공용 topic mutation queue와 QA-LOG parser로 통과 (`d41defe`, Pi 인수 완료)
- [x] 파일은 임시 파일+rename으로 쓰고, 관련 DB 변경은 하나의 transaction으로 처리
- [x] 다중 파일 변경은 원본 snapshot을 두고 실패 시 복원하며, 프로세스 중단은 다음 audit에서 감지
- [x] `note_chunks.content_sha256`과 `index_status`로 원본 Q&A 존재 여부와 회수 상태 기록
- [x] `notes.content_sha256`, `indexed_sha256`, `index_status`로 노트 전체와 마지막 성공 인덱스 상태 기록
- [x] dry-run audit에서 malformed QA, file-only QA, DB-only 청크, source 참조 오류를 분리 보고
- [x] 원문 비노출 hash·DB 배정·자동저장 provenance 기반 readonly 복구 계획 생성
- [x] `source_missing` 청크를 회수·저장 상태에서 제외하고 일치하는 UUID형 legacy provenance를 별도 관찰
- [x] 복구 apply는 백업·입력 hash·수동 작업 ID·서버 중지 확인을 모두 요구
- [x] 복구 apply의 파일 원자 교체·DB transaction·실패 시 DB/vault rollback 구현
- [x] file-only QA를 단일 정본 Q&A에서 재색인 (`68604af`, Pi 배포·인수 완료)
- [x] DB-only 청크를 조용히 삭제하지 않고 `source_missing`으로 적용·회수 제외
- [x] `note_chunks.note_title`은 호환 캐시로만 두고 표시·검색 제목은 `notes` 조인 또는 현재 파일 메타데이터 사용
- [x] 현재 topic의 QA ID 불일치와 8개 제목 drift를 검토·복구한 뒤 Pi audit 0건 확인

교차 저장소 전체를 하나의 ACID transaction으로 만들 수는 없다. 대신 **직렬화된 변경 + 원자적 파일 교체 + DB transaction + hash 기반 재조정**으로 중단 후 복구 가능성을 보장한다. 혼자 쓰는 현재 규모에서는 전역 topic mutation queue가 가장 단순하며, 쓰기 처리량 손실은 무시할 수 있다.

S0의 최소 상태는 다음처럼 둔다.

```text
notes
  content_sha256    # topic은 정규화한 QA-LOG, 그 외 노트는 의미 본문 hash
  indexed_sha256    # 마지막으로 성공한 청크 인덱스의 원본 hash
  index_status      # pending | ready | error | missing

note_chunks
  content_sha256    # qa_id에 대응하는 Q&A 내용 hash
  index_status      # ready | source_missing
```

`index_status`는 파일과 인덱스의 동기화 건강 상태다. A3의 `validity: active | invalidated | superseded`와 합치지 않는다. 사용자가 기억을 폐기한 것과 원본 파일에서 청크를 찾지 못한 것은 원인과 복구 방법이 다르기 때문이다.

### A1b. shadow 검색 보정

- [x] 전역 활성 `ready` 청크 검색에 노트 점수를 soft prior로 결합
- [x] 무관 evidence 중단 임계값과 abstention을 Pi fixture로 조정
- [x] 현재 hard-gated shadow와 같은 20개 평가로 비교
- [x] 실제 모델 컨텍스트는 기존 회수를 유지하고 A1b 결과만 trace
- [x] 운영 Pi에 shadow-only 배포·인수
- [ ] 실제 trace의 과회수와 지연 관찰

`adb41a6`에서 전역 후보 provider, 저장 Q/A의 질문부 가중치, 답변 내 같은 검색어 반복 상한, 보수적인 한국어 조사 변형, lexical anchor가 없는 중간 유사도 결과의 중단 기준을 추가했다. 노트 점수는 후보 제거가 아니라 최대 15% soft prior로만 사용한다. 전체 상한은 노트 3개·청크 6개·청크당 1,400자·총 8,000자를 유지하고, 실제 답변에는 여전히 기존 노트 컨텍스트가 들어간다.

합성 20개는 note Recall@3 20/20, chunk Recall@6 20/20, abstention 4/4, 상한 20/20이었다. Pi 백업 `20260717-1754`로 만든 비공개 격리 복제본에서는 기존 hard-gated가 note 16/20·chunk 10/20·abstention 1/4였고, A1b는 note 20/20·chunk 18/20·abstention 4/4·상한 20/20이었다. 컨텍스트는 평균 3,973자, 최대 8,000자였고 오류는 0건이었다. 운영 서비스는 이 평가 중 변경하지 않았다.

남은 실패는 두 종류다. 여러 세션 종합 1건은 서비스 이름과 최초 발상 표현 사이 lexical/embedding 연결이 약해 원형 청크를 놓쳤고, 최신 정보 1건은 같은 주제의 최근 결말 방향보다 다른 관련 청크가 앞섰다. 또한 fixture가 필수로 지정하지 않은 청크를 모두 무관으로 세는 엄격한 기준에서 무관 노트는 14/30, 무관 청크는 54/72였다. 목표 recall과 abstention은 넘겼지만 최신성·supersession과 과회수 문제가 남아 있으므로 A2는 자동 전환하지 않는다.

2026-07-17 운영 Pi에는 실제 답변 경로를 바꾸지 않는 shadow-only 상태로 배포했다. DB·vault 백업 `20260717-1921`과 코드 백업 `a1b-pre-20260717-192117.tar.gz`를 만든 뒤 13개 파일 hash 일치, Pi 전체 테스트 93개, readonly audit 65/65, DB hash 불변을 확인했다. 재시작 후 `global-soft-prior`·`hard-gated` 진단 API와 잘못된 전략 `400` 검증, 오류 없는 시작 로그를 통과했다.

같은 날 재시작된 운영 `3000`에 비공개 20개 fixture를 직접 실행했다. A1b는 note Recall@3 20/20, chunk Recall@6 18/20, abstention 4/4, 상한 20/20, 평균 354ms·최대 655ms였다. hard-gated는 각각 16/20, 10/20, 1/4, 평균 291ms였다. 무관 노트는 38/53에서 13/29로 감소했지만 무관 청크는 55/67에서 53/71로 소폭 줄어, 약 63ms의 평균 지연 증가와 청크 과회수를 A2 전환 전 계속 관찰한다. 진단 API 평가는 모델 답변·노트 저장·trace 쓰기 없이 실행했고 DB hash는 바뀌지 않았다.

2026-07-18에는 한국어 한 글자 의미어의 부분 문자열 과회수를 줄이는 로컬 후보를 추가했다. `시`가 `시간`·`시스템`에, `살을`이 `자살을`에 걸리던 문제를 토큰 경계와 조사 기준으로 제한하되 `시와`·`시들`, `꿈속` 같은 유효한 결합은 유지했다. 명령형 불용어도 보강했다. 고정 tune 20개는 note 16/16·chunk 14/16·abstention 3/4, 무관 노트 9/28·무관 청크 18/56, 평균 컨텍스트 3,167자였고, 한 번만 실행한 holdout 10개는 기존 대비 핵심 지표 회귀 없이 note 9/9·chunk 8/9·abstention 0/1이었다. 운영 Pi 비공개 20개에서는 note 16/16·chunk 14/16·abstention 4/4를 유지하면서 무관 청크가 53/71에서 51/69로 줄었다. 평균 지연은 361ms로 이전 354ms와 비슷했다.

같은 날 이름·경로 이관과 함께 이 후보를 Pi에 shadow-only로 배포했다. 운영 API의 비공개 20개 재평가는 note Recall@3 20/20, chunk Recall@6 18/20, abstention 4/4, 상한 20/20, 무관 노트 13/29, 무관 청크 51/69, 평균 362ms·최대 824ms, 오류 0이었다. 테스트 101개, audit 66/66, Codex 검증 20개와 DB hash 불변도 확인했다. 남은 실패는 시 작품의 정확 청크 1건, 포트폴리오 원문 청크 1건, 별도 holdout의 환율 false positive 1건이다. 최신성·supersession과 함께 실제 shadow trace를 더 관찰하기 전에는 A2로 전환하지 않는다.

2026-07-18에는 실사용 trace를 안전하게 집계·검토하는 도구를 구현해 Pi 인수까지 마쳤다(`8655706`). schema version 3은 질문 원문을 trace에 중복 저장하지 않고 정규화 SHA-256만 남긴다. `npm run report:retrieval-shadow`는 SQLite를 readonly/query_only로 열어 A1b 추가 랭킹 지연 p50/p95, 컨텍스트·노트·청크 수, abstention·상한 도달·오류를 기본 집계하며 개인 내용은 출력하지 않는다. 명시적 `--review`에서만 기존 `messages`와 hash를 연결해 질문과 선택된 Q&A의 질문부를 보여주고 답변 본문은 출력하지 않는다. 같은 질문과 의회 내부 중복 단계는 하나의 고유 hash로 계산하며, hash가 없는 기존 trace도 숫자 집계에는 남긴다.

Pi DB·vault 백업 `20260718-1345`와 코드 백업 `retrieval-report-pre-20260718-134510.tar.gz` 후 배포한 14개 파일의 로컬/Pi SHA-256 일치를 확인했다. 재시작에서 schema 2→3 migration과 query hash 컬럼·인덱스가 적용됐고 기존 trace 14건은 모두 null hash인 과거 실행으로 보존됐다. 백업 대비 schema_version 외 application table 행 수 차이는 0건, SQLite `integrity_check=ok`, 외래키 오류 0건이었다. Pi 전체 테스트 104개, readonly audit의 활성 Q&A/ready 청크 66/66, 인증 API와 새 PID 서비스 기동, 재시작 로그 오류 0건을 통과했다. 실제 답변 경로와 A1b 랭킹은 바뀌지 않았다.

배포 전 Pi를 읽기 전용으로 집계한 결과 전체 shadow trace는 14건(2026-07-16 16:10~2026-07-17 23:27 KST)이지만 현재 A1b 모드 실사용은 1건뿐이었다. 따라서 고유 질문 30개를 최소 중간 점검선, 50개를 A2 판단선으로 둔다. 기억 회수, 여러 시점·최신 결말, 무관 질문의 abstention, 짧은 한국어 경계 사례가 함께 포함되어야 하며 같은 질문 반복은 표본 수에 더하지 않는다.

2026-07-18 재집계에서 A1b 실사용 trace는 12회, hash가 있어 중복 제거 가능한 고유 질문은 11개였고 1회는 schema v3 이전의 hash 없는 실행이었다. 추가 랭킹 지연은 평균 33.3ms·p50 34ms·p95/최대 44ms, 컨텍스트는 평균 1,289자·p95/최대 6,482자였다. 노트는 평균 0.8개·최대 3개, 청크는 평균 1.2개·최대 5개였고 abstention 5회, 8,000자/6청크 상한 도달·오류·손상 JSON은 모두 0이었다. 컨텍스트 3,000자 이상은 2회, 6,000자 이상은 1회다. 30개 중간 점검까지 고유 질문 19개가 더 필요하며, abstention의 정답 여부와 큰 컨텍스트 1건의 과회수 여부는 30개에서 명시적 `--review`로 판단한다.

2026-07-19 운영 Pi를 다시 read-only 집계한 결과 7월 18일 이후 A1b 실행과 hash가 있는 고유 질문은 모두 19개였다. 추가 랭킹 지연은 평균 34.9ms·p50 35ms·p95/최대 44ms, 컨텍스트는 평균 1,580.2자·p50 655자·p95/최대 6,482자였다. 선택 노트는 평균 1개·최대 3개, 청크는 평균 1.7개·최대 5개, abstention 8회였고 8,000자/6청크 상한 도달·오류·손상 JSON은 계속 0이었다. 30개 중간 점검까지 고유 질문 11개가 더 필요하므로 원문 `--review`와 A2 전환은 아직 실행하지 않는다.

같은 날 추가된 고유 질문 2개는 하나의 실제 실패 연속 질문이었다. 첫 최신 대화 회수 질문에서 A1b는 숙면 대행 서비스 청크 대신 주식·TradingAgents 청크 2개만 선택했다. 일반 회화 문구가 lexical anchor로 작동하고 서비스 명칭 표기가 달랐던 영향이다. 이어진 정정 질문에서는 실제 `비슷한 소재의 소설` Q&A를 1위로 찾았지만 직전 오답 청크와 무관한 `시` 청크 3개도 함께 선택했다. 따라서 고유 질문은 21개가 됐고 30개 중간 점검까지 9개가 남았으며, 두 번째 성공만 근거로 A2를 켜지 않는다.

현재 답변 실패의 직접 원인은 A1b가 아니라 기존 실제 주입 경로였다. 관련 노트는 올바르게 찾았지만 노트 앞 5,000자만 모델에 전달해 9,000자 이후의 최신 Q&A가 사라졌다. 5,000자 상한을 유지하면서 앞·뒤를 균형 있게 넣는 브리지로 바꿨다. 중간 내용 누락은 남으므로 최종 해법은 검증을 통과한 A2 청크 주입이며, 이번 변경은 A2 승격으로 취급하지 않는다. A1b에서는 `가장`, `최근`, `무슨 이야기`, `관련해서` 같은 회수 명령형 일반어를 lexical anchor에서 제외해 중간 유사도 과회수가 무근거 중단 기준을 우회하지 못하게 했다. 공백을 제거한 제목이 5자 이상일 때만 질문과 제목의 한 글자 치환을 제한적으로 허용하고 높은 제목 점수를 부여해 `수면 대행 서비스`와 `숙면 대행 서비스` 같은 실사용 표기 차이를 회수하되 짧은 일반어 과회수는 피한다.

자동 저장은 과거 대화·노트 회수 질문 자체와, 노트가 잘렸거나 검색 근거를 확인하지 못했다는 불확실 답변을 `retrieval_meta | retrieval_uncertain`으로 제외한다. 새 결정·아이디어와 수동 저장은 그대로 허용한다. 이미 생긴 명백한 오저장에는 사용자 승인형 `remove:topic-qa` 유지보수 명령을 둔다. 파일 Q&A 본문 hash, 청크 출처 메시지, 자동 저장 결정 ID가 모두 일치하고 서비스 중지·DB/vault 백업이 확인될 때만 파일 Q&A·ready 청크·자동 저장 기록을 함께 물리 삭제한다. 원본 대화 메시지는 보존하고, 해당 노트의 stale 전체 임베딩은 지운 뒤 `pending`으로 전환해 재색인한다. 일반 `기억에서 제외`의 되돌릴 수 있는 invalidation과는 별도 경로다.

2026-07-19에 이 보정을 `3a0e10c`, `917b1ef`, `b96a44f`, `d55256d`로 Pi에 배포하고 승인된 오저장 Q&A 2건을 삭제했다. 코드 백업은 `/home/pi/backups/galpi/code-memory-fix-pre-20260719-224058.tar.gz`, 삭제 직전 DB·vault 백업은 `/home/pi/backups/galpi/galpi-20260719-2245.db`와 `/home/pi/backups/galpi/vault-20260719-2245.tar.gz`다. 파일 Q&A·ready 청크·자동 저장 기록은 각 대상만 제거했고 원본 메시지 4개는 보존했으며, 영향받은 노트 2개를 재색인했다. 삭제 전 대비 `note_chunks`와 `auto_save_decisions`만 각각 2개 감소했고 나머지 application table 행 수는 같았다. 로컬·Pi 전체 테스트 181/181, note-index DB/vault 31/31·finding 0, topic Q&A 76/76·finding 0, SQLite `integrity_check=ok`·외래키 오류 0을 통과했다. 재시작된 운영 진단에서 첫 질문의 기존 실제 검색은 `숙면 대행 서비스`가 1위였고, 두 질문의 A1b는 각각 관련 숙면 Q&A 청크 1개만 선택했다. A1b는 계속 trace만 기록하고 실제 모델 주입은 기존 경로이므로 A2 전환 판단에는 포함하지 않는다.

2026-07-28 운영 Pi의 A1b는 실행 79회·고유 질문 77개로 50개 판단선을 넘었다. 추가 랭킹 지연은 평균 38.6ms·p50 37ms·p95 56ms·최대 60ms였고 오류·손상 JSON은 0건이었다. 첫 opt-in 검토에서는 일정·기기·구매·모델 질문에 주식·숙면·향수 청크가 반복 선택돼 당시 정책은 A2 NO-GO였다. 원인은 노트 어느 곳의 키워드 일치를 모든 청크의 lexical anchor로 취급하고, 자동 노트 prior가 일반 문턱까지 낮추며, 강한 상위 근거 뒤의 약한 꼬리를 계속 넣는 데 있었다.

같은 77개 질문을 현재 DB·vault에 읽기 전용으로 재생하는 `npm run review:retrieval-policy`를 추가했다. 과거 질문 뒤에 생성된 청크를 제외하고 topic 본문도 해당 시점 이전 청크로 재구성해 자기 질문이 미래의 정답처럼 잡히는 누수를 막았다. 저장된 메시지 임베딩이 없는 32개는 명시적 `--embed-missing --env`에서만 한 번 생성하며 DB에는 쓰지 않는다. 기본 출력은 숫자만 보여주고 질문·근거는 `--review`에서만 표시한다.

보수 정책은 청크의 저장 질문부가 직접 맞을 때만 lexical anchor를 인정하고, 의미어가 셋 이상이면 질문부 두 개 이상 일치를 요구한다. 자동 note prior는 일반 문턱을 낮추지 않고, 5자 이상 구체어가 제목에서 충분히 맞을 때만 제한적으로 낮은 제목 prior를 허용한다. lexical 결과도 임베딩 0.30 이상, semantic-only는 0.80 이상, 일반 최종 점수는 0.45 이상이어야 한다. 자동 결과는 최고점과 0.11보다 벌어진 꼬리를 제거하되 명시적으로 선택한 노트와 명백한 복수 근거 질문은 예외다. 합성 20개는 note/chunk Recall 20/20·abstention 4/4를 유지했다.

동일 corpus의 이전 정책은 77개 중 35개 질문에서 107개 청크를 골랐고 42개에서 중단했다. 새 정책은 10개 질문에서 15개 청크만 고르고 67개에서 중단했다. opt-in 수동 검토에서 15개는 노션·트레이딩·향수·숙면·M60·카메라·갈피/시온 기억처럼 모두 질문 주제와 연결됐고, 앞서 확인한 시험 일정→휴가 일정 오회수는 0.45 문턱에서 제거됐다. 이는 과거 데이터 재생 결과이므로 새 정책 적용 후의 독립 온라인 표본은 아니지만, 기존 오회수 재현 제거·합성 recall 유지·읽기 전용 전체 재생을 함께 만족해 feature flag 기반 A2 배포 후보로 판정한다.

### A2. 청크 회수 전환

- [x] 자동 검색 topic은 전체 노트 대신 검증된 Q&A 청크를 주입
- [x] 사용자가 명시적으로 선택한 노트와 paper/single 등 비topic 자료는 기존 계약을 보존
- [x] 전체 컨텍스트 8,000자 상한과 `index_status=ready` 경계를 유지
- [x] `ASSISTANT_RETRIEVAL_A2_ENABLED=false` 기본값과 `:a2` trace 분리
- [x] GPT Responses 입력에서 자동 topic 전체 본문이 빠지고 `<retrieval>` 청크만 들어가는 통합 테스트
- [x] Pi 백업·통합 배포·재기동 뒤 실제 기억/무관 질문 스모크

2026-07-28 단일 GPT 전환과 같은 Pi 배포에서 A2를 활성화했다. 무관 사실 질문은 노트·청크 0개·35ms로 중단했고, 숙면 대행 서비스의 최신 방향 질문은 같은 topic의 청크 2개·1,918자·41ms만 주입해 최신 결말 방향을 답했다. 두 trace는 `chat:gpt-single-v1:a2`로 기록됐다. 과거 77개 재생은 승격 근거로 보존하되 배포 후 독립 표본과 합산하지 않는다.

배포 스모크의 기억·논문 질문 2건은 기존 자동 저장 규칙에서 실제 topic Q&A로 들어갔다. 이를 운영 지식으로 남기지 않기 위해 exact hash/source guard와 추가 DB·Vault 백업 뒤 해당 Q&A·청크·저장 결정만 제거하고 원본 대화 4개를 보존했다. 두 노트는 2/2 재임베딩하고 현재 원문으로 Codex 재정리를 완료했다. 유지보수·평가 세션이 자동 저장되지 않아야 한다는 별도 제품 계약은 아직 미구현이므로 아래 통과 기준은 계속 열어 둔다.

### A3. provenance·무효화·메모리 제안

- 저장 정책과 source refs 연결
- 최근 저장에서 Q&A invalidation
- 구조화 메모리 proposed/active/superseded 흐름

### B. 평가·trace UI

- run/evidence/token/latency 기록
- 근거 상태 표시와 피드백 메뉴
- 평가 결과 리포트

### C. task·reminder

- [상세 설계](task-reminder-design.md)의 C1부터 구현
- [x] schema v5 접근 경계, v6 task·event·reminder 정본·scheduler/UI, v7 Web Push outbox·최소 PWA를 독립 모듈로 구현해 Pi 인수
- 명시적 `/task`, 단발성 reminder, scheduler, 재시작 catch-up, 중복 차단
- Today·예정·Inbox와 closed/deleted lifecycle, 완료·취소·다시 열기·삭제·복원·확인·1시간 미루기
- 지식 시트 첫 범용 알림 탭과, 에이전트 탭 최상단 일정 블록·`GET /api/tasks/summary`: 중앙 주 앞뒤 3주·네 건수·preview 최대 3·다음 알림·unresolved reminder·push 상태·일정 작업 화면
- [x] schema v7 subscription·delivery outbox, 사용자 opt-in PWA·Web Push와 일정 에이전트 fallback 로컬 구현
- [x] 1440×900·390×844 viewport, 주간 스와이프·deep link·일반/일정 알림 경계·모바일 44px target 확인
- [x] schema v8 `owner_agent`·generation outbox, 활성 일정 bounded 대화 컨텍스트, 완료·취소 월별 노트 projection을 Pi 인수
- [x] 단일 Claude `schedule_prepare`, 기존 task validator의 무쓰기 후보, 채팅 확인 뒤 기존 API 저장을 Pi 인수
- [x] Tailscale Serve private HTTPS와 iPhone·iPad·Mac 홈 화면 구독, provider acceptance 3/3 확인
- [ ] 잠금화면 표시 10회 GO 기준 확인
- C1.5 자연어 후보는 Pi 배포 완료, 실제 후보 카드→등록은 다음 실사용 일정으로 확인하며 반복·브리핑은 후속 별도 단계

### D. 음성

- R0 Realtime WebRTC 무쓰기 spike
- R1 A2 기억·활성 일정 read-only 도구
- R2 final-only 대화 기록·일정/메모 승인 카드
- 정밀 전사 fallback의 transcript 미리보기·대화/메모/task 분기

## 11. 통과 기준

### S0. 저장 무결성

- [x] 활성 topic의 QA ID 집합과 `ready` 청크 ID 집합 차이 0건
- [x] 같은 vault를 두 번 재색인해 동일한 chunk ID·본문 hash가 생성됨
- [x] append·split·merge 도중 잡힌 DB 실패는 원본을 복원하고, hard process 중단은 다음 audit의 비파괴 복구 계획으로 이어짐
- [x] malformed topic 하나가 다른 정상 topic의 재색인을 막거나 기존 인덱스를 삭제하지 않음
- [x] DB-only 청크와 source 참조 오류가 감사 기록 없이 물리 삭제되지 않음

### A. 기억 신뢰성

- [x] 평가 20개에서 목표 note Recall@3 18/20 이상
- [x] 평가 20개에서 목표 chunk Recall@6 18/20 이상
- [ ] 최신 정보 갱신 4개에서 superseded 항목이 답변 근거로 선택되지 않음
- [x] 모르는 질문 4개에서 무관한 기억 주입 0건
- [x] 평가 요청이 retrieval context 8,000자 상한을 넘지 않음
- [x] 긴 topic의 최신 Q&A를 실제 Pi 질문에서 정확히 회수
- [ ] invalidated Q&A가 검색·요약·Codex 링크 후보에 다시 나오지 않음
- [ ] 테스트 세션의 자동 topic 저장 0건
- [ ] 웹·논문 근거를 사용한 저장 항목에 provenance가 남음
- [ ] activeNotes를 포함해 retrieval context 총량이 같은 8,000자 상한을 따름

### B. 평가와 관측

- [ ] 모든 모델 요청에 run ID, 모델, 지연, token usage가 기록됨
- [ ] 사용한 note/chunk/web/paper 참조를 run에서 확인 가능
- [ ] trace에 API 키·전체 PDF·전체 프롬프트를 중복 저장하지 않음
- [ ] 피드백에서 잘못된 evidence를 찾아 invalidation 가능
- [ ] 모델·프롬프트·검색 정책 변경 전후 같은 20개 평가를 재실행 가능
- [ ] Pi 밖 백업으로 DB·볼트 동시 복원 테스트를 통과

### C. 약속 루프

- [x] C0 상세 설계에서 제품 경계·시간 규칙·closed/deleted 상태 머신·schema·API·crash semantics를 고정
- [x] 범용 알림 탭과 일정 에이전트 안의 `TaskPanel` 단일 쓰기 경계를 고정
- [x] schema v6 정본·KST 검증·create 멱등성·낙관적 version·closed/deleted 전이·summary·ack/snooze API를 독립 모듈로 구현하고 flag 기본값을 `false`로 유지
- [ ] 명시적 `/task`가 날짜·시각 입력 시 절대 KST 시각을 보여주고 확인 후에만 task 생성
- [ ] 서버 재시작 후 task와 reminder가 유지됨
- [ ] 같은 reminder occurrence의 DB 행이 하나이며 확인 전 같은 receipt를 계속 조회 가능
- [ ] 놓친 단발성 알림이 다음 시작·접속에서 한 번만 catch-up됨
- [ ] 완료·취소는 closed로 계속 참조되고, 잘못 만든 항목은 deleted로 일반 검색·AI에서 제외됨
- [ ] 완료·미루기·취소·다시 열기·삭제·복원 상태가 UI와 DB에서 일치
- [ ] task 다시 열기·복원은 terminal reminder를 자동 복원하지 않음
- [ ] reminder는 명시적 확인 전에는 조회·패널 열기로 acknowledged되지 않음
- [ ] Today·예정·Inbox에 날짜 전용·시각 기한이 KST 경계대로 표시됨
- [x] 에이전트 탭 최상단 일정 블록의 3주 21일·지연/오늘/예정/Inbox·preview 최대 3·다음 알림이 같은 task DB와 일치함
- [x] `일정 추가 | 전체 일정`과 `/task | /today`가 같은 에이전트 탭 작업 화면으로 이동하고 mutation은 `TaskPanel` 한 벌만 사용함
- [x] loading·empty·error·push disabled 상태와 350px desktop panel·390px mobile bottom sheet가 overflow 없이 동작함
- [ ] private HTTPS 홈 화면 PWA의 Web Push 10회 표시 기준을 충족함. 첫 운영 reminder는 3개 구독 모두 provider `201 accepted`, 표시 반복 검증은 진행 중
- [ ] push 구독 만료·일시 실패·프로세스 재시작에도 delivery outbox가 유실·무한 재시도·중복 행을 만들지 않음
- [ ] push 권한 거부·실패에도 일정 에이전트와 앱 복귀 reconciliation에서 같은 unresolved reminder를 조회 가능
- [ ] push payload·URL·로그에 task 내용·API token·subscription secret이 없음
- [ ] `/task` 경로의 LLM·임베딩·topic 저장 호출이 0회
- [x] 자연어 후보는 확인 전 task 행 0개, 취소 write 0회, 등록만 같은 canonical payload와 request ID로 기존 API 호출
- [ ] 반복·결과 기록은 별도 컨펌

### D. 음성 연결

- [x] iPhone PWA·Mac에서 5분 한국어·영어 Realtime, 끼어들기, mute·수동/자동 종료와 마이크 해제
- [x] R0 전후 DB·Vault·task 불변, 표준 API 키 브라우저 비노출
- [ ] R1이 기존 A2 기억과 활성 일정을 같은 상한으로 읽고 모든 쓰기 tool을 제외
- [ ] R2 완료 턴 exactly-once, interrupted assistant partial 미저장
- [ ] 일정 후보 확인 전 write 0회, 취소 0회, 등록 시 같은 request ID로 1회 생성
- [ ] 30초 한국어 음성을 텍스트로 변환하고 사용자가 수정 가능
- [ ] 확인 전 transcript가 topic·task·memory에 영구 저장되지 않음
- [ ] 같은 transcript를 대화·메모·task 중 선택한 경로로 보낼 수 있음
- [ ] STT 실패·취소 시 임시 오디오가 정리됨

## 12. 예상 일정

한 기능씩 구현·Pi 인수한다는 전제의 대략적인 범위다.

|단계|예상|
|---|---:|
|A0 기준선+A1 shadow|완료|
|S0 저장 무결성|1~2일|
|A1b 보정|Pi shadow 인수 완료|
|A2 전환|Pi 운영 활성화·온라인 관찰|
|A3 provenance·무효화·메모리|2~3일|
|B trace·피드백|1~2일|
|C task·reminder + private Web Push MVP|4~7일|
|D-R0 Realtime 통신 spike|1일 안팎|
|D-R1 읽기 전용 시온|1~2일|
|D-R2 기록·승인형 쓰기|2~4일 + 실기기 검증|
|D-T 정밀 전사 fallback|1~2일|

정확한 기간은 기존 큰 topic의 backfill과 모바일 알림 UX에서 달라질 수 있다. 각 단계는 독립 커밋·독립 Pi 인수로 끝낸다.

## 13. 실측 후에만 결정할 것

- 키워드/임베딩/최신성의 정확한 가중치
- RRF 또는 LLM reranker 도입
- graph edge를 세 번째 회수 경로로 사용할지
- 외부 캘린더 제공자
- Web Push 실측 뒤 native local notification이 추가로 필요한지
- 자동 메모리 제안의 호출 시점과 모델
- 장기 task의 별도 프로젝트 계층
- SQLite FTS5 또는 sqlite-vec 전환 시점

## 14. 참고 자료

- [Anthropic, Building Effective AI Agents](https://www.anthropic.com/engineering/building-effective-agents): 명확한 작업은 workflow로 두고 필요한 경우에만 자율성을 늘리는 원칙
- [Anthropic, Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents): 한정된 attention budget 안에서 고신호 컨텍스트를 선별하는 원칙
- [Anthropic, Demystifying evals for AI agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents): 실제 실패에서 시작한 20~50개 초기 평가와 trajectory/outcome 구분
- [LongMemEval, ICLR 2025](https://arxiv.org/abs/2410.10813): 정보 추출, 세션 간 추론, 시간 추론, 지식 갱신, abstention의 장기 기억 평가 범주
- [OpenAI, A practical guide to building agents](https://openai.com/business/guides-and-resources/a-practical-guide-to-building-ai-agents/): 고위험 행동의 human intervention과 layered guardrail 원칙
- [Letta, Context hierarchy](https://docs.letta.com/guides/core-concepts/memory/context-hierarchy): 항상 보이는 core memory와 필요할 때 찾는 archival/external memory의 역할 분리
- [Mem0, memory implementation](https://github.com/mem0ai/mem0/blob/main/mem0/memory/main.py): 사용자·에이전트 범위, 후보 overfetch, semantic/BM25/entity 신호 결합과 threshold 후 top-k 선택 참고
- [Graphiti](https://github.com/getzep/graphiti): 원본 episode provenance를 보존하고 파생 사실·관계에 시간과 유효성을 두는 구조 참고
- [LangChain memory template](https://github.com/langchain-ai/memory-template): hot path와 background memory 처리, precision/recall 평가 흐름 참고
