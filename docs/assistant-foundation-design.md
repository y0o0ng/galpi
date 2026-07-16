# V4.5 믿을 수 있는 비서 기본기 설계

> 작성: 2026-07-15 · 갱신: 2026-07-16
>
> 상태: A0·A1 shadow와 S0a 읽기 전용 audit 로컬 구현 완료, Pi audit와 S0b 복구 구현 전
>
> 위치: V4-A 논문 검색 완료 후, V4-B 음성 입력과 V5 전문 에이전트 전에 진행

## 0. 결정 요약

현재 AI Council은 대화 보존, 토픽 자동 저장, 하이브리드 노트 검색, 웹 근거, 저장 논문 전문 검색, Codex 정리까지 갖춘 개인 지식 시스템이다. 다음 단계에서는 입력구나 에이전트를 더 늘리기 전에 아래 세 가지를 보강한다.

1. **기억 신뢰성**: 긴 토픽의 특정 Q&A를 청크 단위로 회수하고, 최신 정보·출처·무효화 상태를 반영한다.
2. **평가와 관측**: 무엇을 회수했고 왜 답했는지, 비용·지연·도구 사용이 어땠는지 측정한다.
3. **약속 루프**: 할 일·기한·알림·후속 확인을 구조화해 비서가 먼저 챙길 수 있게 한다.

이 세 기능 전에 **S0 저장 무결성**을 둔다. 토픽 노트 형식은 유지하되, Markdown `QA-LOG`와 SQLite 검색 인덱스가 어긋나도 감지·복구할 수 있게 만든 뒤 A2 실제 답변 회수로 전환한다. 저장 형식을 원자 노트나 외부 메모리 저장소로 교체하는 작업은 아니다.

V4-B 음성은 이 기반 뒤에 연결한다. 음성 전사는 곧바로 영구 토픽에 저장하지 않고 Inbox/미리보기에서 사용자가 목적을 확인한 뒤 `대화 | 메모 | 할 일` 중 하나로 보낸다.

이 단계에서 하지 않는 것:

- 논문 자율 발견 검색
- 이메일·캘린더 쓰기나 외부 앱 조작
- 주식 분석 에이전트
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

2. **일반 topic 경로**
   - 활성 topic의 `note_chunks`를 전역 후보로 검색한다.
   - 제목, aliases, Codex 태그, 요약, 노트 임베딩 점수는 청크 점수의 soft prior로 사용한다.
   - 노트 top 3을 먼저 확정해 그 밖의 청크를 버리는 hard gate는 유일한 경로로 사용하지 않는다. A1 첫 shadow에서 목표 노트를 놓친 경우 그 안의 정답 청크를 회수할 수 없었기 때문이다.
   - 키워드와 기존 청크 임베딩을 함께 사용하고, archive 또는 index가 준비되지 않은 청크는 제외한다.
   - 같은 topic의 비슷한 청크가 결과를 독점하지 않도록 노트당 최대 2개를 둔다.
   - 동일한 사실의 갱신 관계가 있으면 최신 active 항목을 우선하고, 낮은 점수 결과는 넣지 않는다.

A1 shadow에서 기존 hard-gated 2단계 결과와 전역 청크+노트 soft prior 결과를 같은 fixture로 비교한다. 현재 61개 규모에서는 전역 후보 검색 비용이 작으며, 새 벡터 DB나 LLM reranker는 추가하지 않는다.

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

물리 삭제는 별도 관리 기능으로 미룬다. 사용자의 실수 취소가 다시 되돌릴 수 있어야 한다.

### 4.6 저장 정책

요청마다 서버가 다음 저장 정책 중 하나를 선택한다.

|정책|용도|영구 topic 반영|
|---|---|---|
|`auto`|일반 채팅·의회|현재 가치 판정 후 가능|
|`manual`|명시적 저장|사용자 확인 후|
|`never`|스모크·평가·관리 요청|안 함|
|`inbox`|음성 전사·불확실한 캡처|사용자 분류 전에는 안 함|

`never`와 `inbox`는 클라이언트 문자열만 믿지 않고 서버가 허용한 경로·세션 유형으로 결정한다. 테스트 스크립트는 전용 인증된 내부 경로 또는 명시적 서버 옵션을 사용한다.

자동 저장 분류기는 계속 저비용 휴리스틱으로 시작하되, 다음을 추가한다.

- 테스트·상태 확인·배포 검증 문구 차단
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
  -> Clawd 알림센터에 추가/갱신 제안
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

### 5.4 사용자 피드백

답변 아래에 상시 큰 평가 UI를 두지 않는다. 작은 메뉴에서 다음만 제공한다.

- 답변 도움됨
- 잘못된 기억 사용
- 출처가 맞지 않음

`잘못된 기억 사용`은 해당 run의 evidence 목록을 열고 Q&A 단위 invalidation으로 이어진다. 피드백은 다음 평가 fixture 후보로 남긴다.

### 5.5 답변 근거 표시

단일 채팅과 의회 결과에 간단한 상태를 표시한다.

```text
기억 3 · 웹 2 · 논문 전문 1
```

누르면 제목, 날짜, 섹션·페이지, URL을 확인한다. 원문 전체나 내부 점수는 기본 화면에 노출하지 않는다.

현재 API가 반환하는 `paperFullText.used`, `calls`, `evidenceRefs`는 이 표시와 저장 provenance에 사용한다. 브라우저가 전문 본문을 보관하거나 심층 의회 요청에 재전송하지 않는 기존 원칙은 유지한다.

### 5.6 자동화 회귀 테스트

- 임시 SQLite와 임시 vault를 사용하는 통합 harness를 만든다.
- 모델·임베딩·시간·알림 채널은 주입 가능한 mock으로 둔다.
- 저장 정책, 청크 회수, invalidation, supersession, reminder 중복 차단을 API까지 통과시킨다.
- 실사용 Pi 데이터는 테스트 fixture로 복사하지 않는다.

## 6. C - 약속 루프

### 6.1 범위

첫 구현은 AI 에이전트가 아니라 개인 할 일·알림 시스템이다.

- 할 일 생성·수정·완료·보류
- 기한과 단일/반복 알림
- 오늘·지연된 일 보기
- 첫 접속 또는 정해진 시각의 오늘 브리핑
- 완료 후 결과 기록 제안

외부 캘린더 동기화, 이메일 발송, 결제, 매매는 제외한다.

### 6.2 데이터 구조

```text
assistant_tasks
  id
  title
  detail
  status            # proposed | active | done | snoozed | cancelled
  due_at
  timezone
  recurrence_rule
  source_session
  source_message
  related_note
  created_at
  updated_at
  completed_at

assistant_reminders
  id
  task_id
  remind_at
  status            # pending | fired | acknowledged | cancelled
  occurrence_key    # 중복 발화 차단
  fired_at
  acknowledged_at
```

`occurrence_key`는 같은 반복 일정이 재시작·재시도 때문에 두 번 울리지 않도록 고유하게 만든다.

### 6.3 생성 흐름

```text
"금요일까지 보고서 초안 써야 해"
  -> LLM이 task 후보 {title, due expression} 제안
  -> 서버가 KST 기준 절대 시각으로 정규화
  -> 사용자에게 카드 표시
  -> 확인 후 active
```

- 날짜가 모호하면 추측해 저장하지 않고 한 번 질문한다.
- `내일`, `다음 주`, `저녁`의 해석 결과를 카드에 절대 날짜로 보여준다.
- 대화 속 모든 미래형 문장을 자동 task로 만들지 않는다.
- 명시적인 `기억해줘`, `해야 해`, `알려줘`, `/task`를 우선 신호로 쓴다.

### 6.4 실행 흐름

- 서버 내부 scheduler가 1분 단위로 pending reminder를 확인한다.
- SQLite 상태 전이를 먼저 확정한 뒤 알림을 만든다.
- 서버 재시작 후 놓친 알림은 catch-up하되 같은 occurrence를 중복 생성하지 않는다.
- 초기 알림 채널은 Clawd 알림센터와 다음 접속 시 catch-up이다.
- 브라우저가 닫힌 상태의 Web Push는 기본 루프가 안정된 뒤 별도 승인·권한 설계로 추가한다.
- 알림 문구 생성에는 LLM이 필요 없다.

### 6.5 오늘 브리핑

브리핑은 새로운 독립 에이전트가 아니라 저장된 상태를 읽는 workflow다.

입력:

- 오늘 마감
- 지연된 할 일
- 오늘 알림
- 최근 완료 후 결과 미기록 항목
- 향후 에이전트 보고 노트

출력:

- 짧은 우선순위 목록
- 필요한 경우에만 관련 노트 링크
- 자동 실행은 하지 않고 다음 행동을 제안

### 6.6 후속 확인

완료된 task에는 선택적으로 결과를 묻는다.

```text
완료
  -> 결과 기록 제안
  -> 사용자가 한 줄 기록
  -> 관련 topic 또는 task 결과에 저장
  -> 필요하면 사용자 메모리 갱신 제안
```

모든 완료 항목에 질문하면 피로해지므로, 결정·구매·실험·연락처럼 결과가 다음 판단에 유용한 task만 제안한다.

## 7. V4-B 음성 입력과의 경계

기존 설계의 `STT -> isMemo: true -> 항상 저장` 흐름은 폐기한다.

새 흐름:

```text
녹음
  -> STT
  -> 전사 미리보기·수정
  -> 목적 선택 또는 안전한 의도 제안
       대화: 기존 채팅 입력
       메모: manual/inbox 저장 확인
       할 일: task 후보 카드
  -> 사용자 확인 후 기존 파이프라인
```

짧은 잡음, 잘못된 인식, 테스트 녹음은 영구 기억에 들어가지 않는다. 원본 오디오 장기 보관은 첫 구현 범위에서 제외하며 STT 완료 후 임시파일을 삭제한다.

## 8. 보안과 승인 경계

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
lib/assistant-scheduler.js   # due reminder, catch-up, 중복 차단
```

프론트엔드는 에이전트 탭을 만들기 전에 `paper-panel.js`와 `note-panel.js`의 공용 패널 헬퍼를 추출한다. 다만 retrieval 백엔드와 무관한 시각 리팩터링을 같은 커밋에 섞지 않는다.

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

S0a 읽기 전용 감사 기반은 `575205a`에서 로컬 구현했다. 날짜 제목+`qa_id`를 함께 보는 QA-LOG 파서, CRLF·trailing space를 정규화한 note/QA SHA-256, Markdown/DB의 file-only·DB-only·배정 drift·중복·제목·source 참조를 분리하는 `npm run audit:topics`를 추가했다. 실제 로컬 DB·vault에서는 QA 7/7이 일치했고 기존 UUID형 assistant source 참조 1건만 검출했다. 실행 전후 DB SHA-256은 같았고 전체 테스트 64개를 통과했다. Pi 배포·실행과 데이터 복구는 아직 하지 않았다.

- [ ] `schema_version`과 순차 migration을 별도 모듈로 관리
- [ ] 모든 append·split·merge·archive를 공용 topic mutation queue와 QA-LOG parser로 통과
- [ ] 파일은 임시 파일+rename으로 쓰고, 관련 DB 변경은 하나의 transaction으로 처리
- [ ] 다중 파일 변경은 원본 snapshot을 두고 실패 시 복원하며, 프로세스 중단은 다음 audit에서 감지
- [ ] `content_sha256`, `indexed_sha256`, `index_status`로 Markdown과 검색 인덱스의 일치 여부 기록
- [x] dry-run audit에서 malformed QA, file-only QA, DB-only 청크, source 참조 오류를 분리 보고
- [ ] file-only QA는 재색인하고 DB-only 청크는 조용히 삭제하지 않고 `source_missing`으로 회수 제외
- [ ] `note_chunks.note_title`은 호환 캐시로만 두고 표시·검색 제목은 `notes` 조인 또는 현재 파일 메타데이터 사용
- [ ] 현재 4개 topic의 QA ID 불일치와 8개 제목 drift를 검토·복구한 뒤 Pi audit 0건 확인

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

- 전역 활성 청크 검색에 노트 점수를 soft prior로 결합
- 무관 evidence 중단 임계값과 abstention을 Pi fixture로 조정
- 현재 hard-gated shadow와 같은 20개 평가로 비교
- 목표치를 넘기기 전에는 실제 모델 컨텍스트에 주입하지 않음

### A2. 청크 회수 전환

- topic을 청크 단위로 주입
- 전체 컨텍스트 8,000자 상한
- `index_status=ready`인 청크만 사용
- 문제 시 feature flag로 기존 검색 복귀

### A3. provenance·무효화·메모리 제안

- 저장 정책과 source refs 연결
- 최근 저장에서 Q&A invalidation
- 구조화 메모리 proposed/active/superseded 흐름

### B. 평가·trace UI

- run/evidence/token/latency 기록
- 근거 상태 표시와 피드백 메뉴
- 평가 결과 리포트

### C. task·reminder

- 명시적 `/task`와 카드 확인부터 구현
- 자연어 후보 추출
- scheduler, 재시작 catch-up, 중복 차단
- Today/Inbox와 브리핑

### D. 음성

- STT spike
- transcript 미리보기
- 대화·메모·task 분기

## 11. 통과 기준

### S0. 저장 무결성

- [ ] 활성 topic의 QA ID 집합과 `ready` 청크 ID 집합 차이 0건
- [ ] 같은 vault를 두 번 재색인해 동일한 chunk ID·본문 hash가 생성됨
- [ ] append·split·merge 도중 DB 실패와 프로세스 중단을 재현해 원본 보존 또는 자동 복구
- [ ] malformed topic 하나가 다른 정상 topic의 재색인을 막거나 기존 인덱스를 삭제하지 않음
- [ ] DB-only 청크와 source 참조 오류가 감사 기록 없이 물리 삭제되지 않음

### A. 기억 신뢰성

- [ ] 평가 20개에서 목표 note Recall@3 18/20 이상
- [ ] 평가 20개에서 목표 chunk Recall@6 18/20 이상
- [ ] 최신 정보 갱신 4개에서 superseded 항목이 답변 근거로 선택되지 않음
- [ ] 모르는 질문 4개에서 무관한 기억 주입 0건
- [ ] 어떤 요청도 retrieval context 8,000자 상한을 넘지 않음
- [ ] 8,000자 이상 topic의 마지막 Q&A를 질문해 정확히 회수
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

- [ ] 자연어 날짜를 절대 KST 시각으로 보여주고 확인 후 task 생성
- [ ] 서버 재시작 후 task와 reminder가 유지됨
- [ ] 같은 reminder occurrence가 중복 발화하지 않음
- [ ] 놓친 알림이 다음 시작·접속에서 한 번만 catch-up됨
- [ ] 완료·미루기·취소 상태가 UI와 DB에서 일치
- [ ] Today에 오늘 마감·지연 항목이 정확히 표시됨
- [ ] 결과 기록이 관련 task/note에 출처와 함께 연결됨

### D. 음성 연결

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
|A1b 보정+A2 전환|1~2일|
|A3 provenance·무효화·메모리|2~3일|
|B trace·피드백|1~2일|
|C task·reminder MVP|2~4일|
|D 음성 MVP|1~2일|

정확한 기간은 기존 큰 topic의 backfill과 모바일 알림 UX에서 달라질 수 있다. 각 단계는 독립 커밋·독립 Pi 인수로 끝낸다.

## 13. 실측 후에만 결정할 것

- 키워드/임베딩/최신성의 정확한 가중치
- RRF 또는 LLM reranker 도입
- graph edge를 세 번째 회수 경로로 사용할지
- 브라우저 Web Push와 외부 캘린더 제공자
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
