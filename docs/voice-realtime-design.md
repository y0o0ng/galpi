# V4-B 시온 음성·Realtime 상세 설계

> Version: 1.0
>
> Date: 2026-07-30
>
> Status: R0 GO, R1 읽기 전용 시온 착수 전
>
> Scope: 짧은 음성 입력, 자연스러운 실시간 대화, 갈피 읽기 도구, 승인형 쓰기, 음성 모델 운영

---

## 현재 구현 상태

2026-07-30 R0 통신 spike를 구현하고 Pi HTTPS 실제 통신까지 인수했다.

- `lib/realtime-session.js`가 서버 소유 session config와 unified WebRTC SDP proxy를 담당한다.
- `POST /api/voice/realtime/session`은 기존 갈피 인증, 전역 API 제한과 별도 10분당 6회 제한, `application/sdp` 64KB 상한을 적용한다.
- 표준 `OPENAI_API_KEY`는 서버의 OpenAI 요청에만 사용하고 브라우저에는 SDP answer와 공개 모델 메타데이터만 반환한다.
- `public/voice-realtime.js`가 마이크 권한, `RTCPeerConnection`, `oai-events` data channel, remote audio, mute, transcript, 끼어들기 상태, 5분 hard cap과 공용 cleanup을 담당한다.
- composer에는 기능 flag가 켜졌을 때만 보이는 마이크 버튼과 `AI 생성 음성 · 저장 안 함` 라이브 패널을 추가했다.
- R0 session에는 tool이 0개이며 DB message, topic, Vault, task, 사용량 ledger 쓰기 경로를 연결하지 않았다.
- 초기 모델은 `gpt-realtime-2.1-mini`, voice는 `marin`, 사용자 자막은 대화형 Realtime input transcription 호환성을 우선해 `gpt-4o-mini-transcribe`와 한국어 hint를 사용한다. 전사 모델은 `OPENAI_REALTIME_TRANSCRIPTION_MODEL` exact ID로만 바꿀 수 있다.
- 코드 기본값은 `OPENAI_REALTIME_ENABLED=false`다. 로컬 기본 설정은 계속 꺼져 있고 Pi 운영 `.env`에서만 `true`로 활성화했다.

검증:

- Realtime 단위·route 통합 테스트 7/7에서 multipart SDP/session 전달, 인증, 표준 키 비노출, provider 오류 최소 진단, `X-Forwarded-For` 안전 처리, 잘못된 SDP fail-close, browser handshake mock, 종료 cleanup, DB application table과 Vault 불변을 확인했다.
- OpenAI unified interface는 `sdp`와 `session`을 multipart 일반 필드로 보내야 한다. 초기 파일 Blob 전송은 실제 호출에서 `400 invalid_form_data`로 거절돼 공식 예제 형식으로 보정했다.
- Mac 격리 서버 실제 호출은 `201`, peer `connected`, data channel `open`, remote audio 수신, `response.done=completed`, 자막 `연결 확인 완료`를 통과했다. 실제 프론트 상태 머신도 `listening → idle`, local track `ended`, 패널·버튼 복원을 확인했다.
- Pi Tailscale HTTPS 실제 호출도 `201`, peer `connected`, data channel `open`, remote audio 수신, 완료 자막 `파이 연결 확인 완료.`를 통과했다.
- Tailscale Serve의 `X-Forwarded-For`는 전역 `trust proxy=true` 대신 실제 socket 주소 기반 rate-limit key로 처리한다. 최종 재시작 뒤 익명·인증 HTTPS config를 호출해 새 proxy validation 경고가 없음을 확인했다.
- 로컬은 Realtime 7/7을 통과했다. 최종 전체 실행은 217/218 뒤 기존 Codex runner 서버 기동 timeout 1건을 격리 1/1로 통과했고, 같은 R0 배치의 직전 전체 실행은 218/218이었다. Pi 현재 배치는 Realtime 7/7과 전체 214/214를 통과했다.
- 390px Playwright에서 idle composer와 권한 요청 패널이 가로 overflow나 입력바 겹침 없이 배치됐다.
- 배포 전 백업은 `galpi-20260730-1744.db`, `vault-20260730-1744.tar.gz`, `code-v4b-r0-pre-20260730-174417.tar.gz`다. 최종 PID는 `124693`이다.
- 실제 호출 전후 `messages 448`, `notes 34`, `assistant_tasks 8`, `assistant_task_events 16`, `assistant_reminders 4`, Vault 전체 hash `7e71c78e...c0dd`가 불변이고 SQLite integrity `ok`, foreign key 오류 0건이다.

2026-07-30 사용자 실기기 인수에서 iPhone 홈 화면 PWA로 5분 세션을 끝까지 사용했고 한국어·영어 전환, 시온 발화 중 끼어들기, mute/unmute, 수동 종료, 5분 hard cap 자동 종료와 마이크 해제가 모두 정상임을 확인했다. 턴 수와 끼어들기 횟수는 별도 계수하지 않았지만 사용자가 기능 GO를 승인했다. 따라서 R0는 완료했고, 다음 단계는 별도 컨펌 뒤 R1 읽기 전용 시온을 여는 것이다.

## 0. 결정 요약

1. 시온의 자연 대화는 **OpenAI Realtime API를 갈피가 직접 WebRTC로 연결**해 구현한다. STT·VAD·끼어들기·스트리밍 TTS 엔진을 자체 제작하지 않는다.
2. V4-B에는 목적이 다른 두 경로를 둔다.
   - **정밀 전사 경로**: 녹음 → STT → 수정 → `대화 | 메모 | 할 일` 확인. 정확한 문구와 승인형 작업에 사용한다.
   - **Realtime 대화 경로**: 말하면서 듣고, 시온의 말을 끊을 수 있는 자연 대화에 사용한다.
3. 전체 기능을 한 번에 붙이지 않는다. `R0 통신 spike → R1 읽기 전용 시온 → R2 기록·승인형 쓰기` 순서로 승격한다.
4. R0는 현재 vanilla JS 프론트에 **표준 WebRTC API를 직접 사용**한다. Agents SDK는 초기 의존성·번들러 변경을 만들지 않기 위해 도입하지 않고, 도구·handoff가 실제로 복잡해질 때 재검토한다.
5. 브라우저·PWA에는 표준 OpenAI API 키를 절대 전달하지 않는다. Pi 서버가 기존 `OPENAI_API_KEY`로 Realtime 세션 초기화만 중계한다.
6. Realtime 모델은 현재 GPT-5.6 Responses 채팅 모델과 다른 실행 계열이다. 텍스트 모델 선택을 Realtime 세션에 그대로 적용하지 않는다.
7. R0와 R1은 DB·Vault·task에 쓰지 않는다. R2에서도 완료된 턴만 대화 DB에 정확히 한 번 저장하고, 원본 오디오는 저장하지 않는다.
8. R1 도구는 갈피 서버의 읽기 전용 allowlist만 호출한다. 모델이나 브라우저가 DB·Vault에 직접 접근하지 않는다.
9. 일정·메모처럼 상태를 바꾸는 요청은 R2에서도 후보만 만들고, 기존 확인 카드와 API를 통해 사용자가 승인한 뒤에만 저장한다.
10. 초기 제품 계약은 **화면이 열린 동안의 명시적 음성 세션**이다. 상시 마이크, 호출어, 잠금화면·백그라운드 지속 대화는 포함하지 않는다.
11. 기능 flag, 세션 시간 상한, 도구 호출 상한, last-known-good 모델을 코드에서 집행한다. 모델 지시만으로 비용과 권한을 통제하지 않는다.
12. 이 문서를 V4-B의 상세 단일 기준으로 삼는다. 저장·task 경계는 [V4.5 비서 기본기 설계](assistant-foundation-design.md)와 [시온 약속 루프 설계](task-reminder-design.md), 텍스트 모델 경계는 [단일 GPT 채팅·모델 라우팅 설계](chat-model-routing-design.md)를 따른다.

---

## 1. 왜 Realtime을 지금 작은 범위로 검증하나

OpenAI는 끼어들기, 첫 음성 지연, 자연스러운 턴 교대, 실시간 도구 사용이 필요한 음성 비서에 live audio 경로를 권장한다.[^voice-agents] 브라우저·모바일 클라이언트에는 WebSocket보다 WebRTC를 권장하며, WebRTC는 미디어 전송과 사용자의 끼어들기 시 재생되지 않은 음성 잘라내기를 처리한다.[^webrtc][^realtime-conversations]

갈피는 이미 아래 조건을 갖췄다.

- Express 서버와 서버 전용 OpenAI API 키
- vanilla JS 기반 PWA
- Tailscale Serve canonical HTTPS
- GPT Responses 채팅, A2 기억 회수, 웹·논문 도구, 일정 무저장 후보와 승인 카드

따라서 음성을 주고받는 R0 자체는 별도 플랫폼 재작성 없이 붙일 수 있다. 진짜 난이도는 Realtime이 기존 시온의 기억·도구·저장·승인 의미를 우회하지 않게 만드는 R1·R2다. 먼저 R0로 모바일 연결·한국어 대화·끼어들기를 검증하면, 쓸 만한 음성 경험인지 확인한 뒤 통합 비용을 지불할 수 있다.

### 하지 않을 대안

- **STT → GPT-5.6 Responses → TTS를 매 턴 직렬 연결해 Realtime처럼 보이기**: 기존 뇌를 그대로 쓰기 쉽지만 첫 음성 지연과 끼어들기가 불리하다. 정밀 전사 fallback으로는 유지하되 자연 대화의 주 경로로 삼지 않는다.
- **Realtime 모델이 기존 `/api/chat`을 도구로 다시 호출하기**: 텍스트 기능 parity는 빠르지만 모델 호출이 중복돼 지연·비용·대화 상태가 복잡해진다.
- **로컬 Pi에서 음성 엔진 전체 자체 구현**: VAD, 노이즈, 스트리밍 인코딩, TTS, 재생 위치·끼어들기 동기화까지 별도 제품이 된다. 현재 범위와 맞지 않는다.

---

## 2. 제품 경로

|경로|주 용도|모델 경계|저장 경계|
|---|---|---|---|
|텍스트 채팅|일반 대화·깊은 토론·기존 도구|GPT-5.6 Responses와 현재 모델 선택|기존 `shared-main` 계약|
|정밀 전사|정확한 메모·일정 문구·짧은 음성 입력|별도 STT, 필요 시 기존 텍스트 채팅/TTS|전사 수정·목적 확인 전 `inbox`|
|Realtime 대화|자연 대화·빠른 응답·끼어들기|별도 Realtime 모델·세션|R0/R1 무쓰기, R2 완료 턴만 DB|

정밀 전사와 Realtime은 경쟁 기능이 아니다. 자유로운 토론은 Realtime이 맡고, 날짜·금액·고유명사처럼 정확성이 중요한 쓰기 요청은 화면 카드와 정밀 전사 경로가 안전망이 된다.

Realtime 경로는 모델이 음성을 직접 출력하므로 별도의 TTS 호출을 직렬로 붙이지 않는다. 별도 OpenAI TTS는 기존 텍스트 답변 읽어주기나 정밀 전사 fallback에서 필요성이 확인될 때만 추가한다.

---

## 3. 연결 구조

```text
브라우저/PWA
  ├ 마이크·원격 음성: WebRTC media
  ├ 상태·transcript·tool event: WebRTC data channel
  └ SDP 초기화
        ↓
Pi /api/voice/realtime/session
  ├ 기존 갈피 인증 확인
  ├ model·voice·instructions·상한을 서버에서 고정
  ├ 기존 OPENAI_API_KEY로 /v1/realtime/calls 호출
  └ SDP answer만 브라우저에 반환

R1 이후 tool call
브라우저 data channel
  → Pi /api/voice/realtime/tools
  → 서버 read-only allowlist 실행
  → function_call_output을 data channel로 반환
```

### 3.1 WebRTC 초기화 방식

OpenAI의 unified interface를 우선 사용한다.[^webrtc]

1. 브라우저가 사용자 탭 동작 뒤 `getUserMedia({ audio: true })`를 요청한다.
2. 브라우저가 `RTCPeerConnection`과 `oai-events` data channel을 만들고 SDP offer를 생성한다.
3. 인증된 갈피 endpoint가 SDP와 서버 소유 session config를 OpenAI `/v1/realtime/calls`로 보낸다.
4. 반환된 SDP answer를 브라우저가 적용한다.
5. 이후 음성 미디어는 WebRTC peer connection으로 전송하고, Pi는 세션 초기화와 갈피 도구 실행만 담당한다.

ephemeral client secret 방식도 공식 지원되지만 R0에서는 사용하지 않는다. unified interface가 현재 1인용 Pi 구조에서 더 단순하고, 표준 API 키를 브라우저에 노출하지 않는 경계가 분명하다.

### 3.2 SDK 결정

R0는 `RTCPeerConnection`, `getUserMedia`, `MediaStream`, data channel을 직접 쓴다.

- 장점: 현재 빌드 없는 프론트 구조를 유지하고 새 SDK·번들러를 추가하지 않는다.
- 비용: session event와 상태 전이를 우리가 관리해야 한다.
- 재검토 조건: R1 이후 handoff·guardrail·도구 lifecycle 코드가 자체 모듈보다 커지거나, 공식 Agents SDK 도입이 전체 코드를 실제로 줄인다는 diff가 확인될 때.

---

## 4. 단계별 범위

### R0 — Realtime 통신 spike

목표는 “갈피에 붙일 수 있는가”만 검증하는 것이다.

포함:

- 음성 세션 시작·종료
- 마이크 권한, mute/unmute
- 시온 음성 재생
- 사용자·시온의 진행 중/완료 transcript 표시
- 사용자 transcript를 위한 `session.audio.input.transcription` 활성화. R0 기본은 `gpt-4o-mini-transcribe`와 `language: ko`이며 별도 과금되는 보조 자막으로만 취급한다.
- 자동 턴 감지와 사용자의 끼어들기
- 연결·듣는 중·말하는 중·종료·오류 상태
- 한 세션 5분 hard cap
- 페이지 이탈·연결 실패·사용자 종료 시 media track과 peer connection 정리
- 사용자에게 AI 생성 음성임을 명시

제외:

- 갈피 기억·일정·웹·논문 도구
- DB 메시지, topic, Vault, task, 사용량 ledger 쓰기
- 세션 자동 재연결 루프
- 정식 음성 설정 UI

초기 개발 기본은 반복 실험 비용이 낮은 `gpt-realtime-2.1-mini`로 두고, R0 승격 직전에 현재 권장 full Realtime 모델로 기능 smoke를 한 번 확인한다.[^realtime-mini] 이는 Claude/GPT 품질 비교가 아니라 통신 계약 인수다.

### R1 — 읽기 전용 시온

R0를 통과한 뒤 기존 시온의 읽기 기능을 작은 allowlist로 연결한다.

1. 세션 시작 시 KST 현재 시각, 현재 사용자 메모리, 활성 일정의 bounded snapshot, 최근 완료 대화의 bounded suffix를 제공한다.
2. `galpi_context_lookup`
   - 기존 A2 retrieval provider를 재사용한다.
   - topic 최대 3개, 청크 최대 6개, 총 8,000자 상한과 abstention을 유지한다.
3. `schedule_read`
   - 기존 활성 task 합성기를 재사용한다.
   - 읽기만 가능하며 완료·취소·등록 endpoint를 호출하지 않는다.
4. 기억·일정이 안정된 뒤에만 기존 `web_search`, `paper_fulltext_search/read`를 같은 read-only dispatcher로 추가한다.
5. 도구 호출은 턴당 최대 2회이며 timeout 뒤 음성 대화는 도구 실패를 짧게 알리고 계속할 수 있다.

OpenAI는 애플리케이션 안에서 실행할 작업에는 function tool을 기본으로 제시한다. 모델이 인자를 만들고 애플리케이션이 코드를 실행한 뒤 `function_call_output`을 돌려주는 경계다.[^realtime-tools] 갈피에서도 브라우저는 tool event를 운반할 뿐이고, 실제 allowlist·검증·실행은 Pi 서버가 맡는다.

R1은 계속 무쓰기다. 사용자가 “일정 만들어줘”라고 말하면 시온은 현재 Realtime 베타가 조회 전용임을 알리고, 정밀 전사 또는 텍스트 채팅으로 이어갈 수 있다.

### R2 — 완료 턴 기록과 승인형 쓰기

R2부터 Realtime을 기존 `shared-main` 대화에 연결한다.

#### 대화 기록

- 사용자 입력은 완료된 input transcript event만 저장한다.
- 시온 답변은 `response.done`이 정상 완료된 턴만 저장한다.
- input transcript가 끝내 확정되지 않으면 해당 user/assistant 쌍을 완료 대화처럼 저장하지 않는다.
- `session_id`, OpenAI conversation `item_id`, `response_id`를 idempotency receipt로 사용해 정확히 한 번만 반영한다.
- 사용자가 시온을 끊어 취소된 assistant response의 부분 transcript는 일반 assistant 메시지로 저장하지 않는다.
- 완료된 user turn 뒤 assistant가 취소되면 user 메시지는 보존할 수 있지만, 존재하지 않는 최종 assistant 답변을 합성하지 않는다.
- 메시지에는 `source_type: voice_realtime`과 실제 resolved Realtime model을 남긴다.
- 원본 오디오는 DB·Vault·백업에 저장하지 않는다.

R2 schema가 필요하면 기존 `messages`를 크게 바꾸기보다 작은 `realtime_turn_receipts` 테이블로 외부 item/response ID, 완료·중단 상태, message ID 연결만 additive하게 둔다.

#### 일정·메모

- `schedule_prepare`는 기존 validator로 무저장 후보만 만든다.
- 채팅 확인 카드의 `등록`만 기존 task API를 같은 request ID로 호출한다.
- 취소·카드 닫기·세션 종료는 task write 0회다.
- 메모도 transcript를 곧바로 topic에 넣지 않고 수정 가능한 후보로 보여준 뒤 기존 manual 저장 경로로 보낸다.
- Realtime tool dispatcher에는 task 생성, 노트 append, 정책 변경, Codex 실행 같은 직접 쓰기 함수를 등록하지 않는다.

#### 자동 저장

- DB의 완료 대화 보존과 Obsidian 지식 저장을 분리한다.
- Realtime 대화는 처음에는 `inbox` source로 분류해 topic 자동 저장에서 제외한다.
- 사용자가 명시적으로 저장한 최종 턴만 manual/topic 경로로 승격한다.
- 실사용에서 유용한 자유 대화가 반복적으로 누락된다는 근거가 쌓일 때만 별도 자동 저장 정책을 검토한다.

---

## 5. 모델과 자동 최신 경계

Realtime 모델은 텍스트 Responses 모델 목록에 섞지 않는다. 기존 채팅 카탈로그가 embedding·audio·transcription·realtime 모델을 제외하는 규칙은 그대로 유지한다.

### R0

- `OPENAI_REALTIME_MODEL` exact ID를 서버 설정으로 고정한다.
- 모델 ID와 voice는 세션 시작 시 snapshot하며 진행 중인 세션을 바꾸지 않는다.
- 화면에는 `Realtime · <resolved model>`을 읽기 전용으로 표시한다.

### R1 이후

장기적으로 `auto:realtime`을 별도 정책으로 추가한다.

```text
공식 권장 family 확인
  → 현재 API 계정에서 발견
  → WebRTC audio smoke
  → R1이면 function tool smoke
  → compatible
  → last-known-good 승격
```

- Models API에 보인다는 이유만으로 자동 승격하지 않는다.
- 새 모델 probe가 실패하면 진행 중인 세션과 last-known-good를 유지한다.
- 수동 exact Realtime 모델은 사용자가 바꾸기 전 조용히 이동하지 않는다.
- 텍스트 `자동 · GPT-5.6 Terra` 선택과 음성 `Realtime · 자동` 선택은 별도 설정이다.
- 개발 spike에서는 자동 카탈로그를 먼저 만들지 않는다. R0가 통과한 뒤 R1 범위로 추가한다.

---

## 6. UI와 세션 상태

### 6.1 진입

- 사용자가 누르는 명시적 음성 버튼으로만 마이크 권한을 요청한다.
- 첫 탭에서 `AI 음성 · 마이크 사용 중`을 보여준다.
- 기존 텍스트 composer와 같은 대화를 사용하되, 음성 세션 중에는 텍스트 모델 pill이 Realtime 모델 선택처럼 보이지 않게 구분한다.

### 6.2 상태

```text
idle
  → requesting_permission
  → connecting
  → listening
  ↔ speaking
  → ending
  → idle

어느 상태에서든
  → error
  → 정리 후 idle
```

- `listening`: 마이크가 실제 활성인 상태만 표시한다.
- `speaking`: 원격 음성이 실제 재생 중인 상태다.
- `muted`: 세션은 유지하지만 local audio track을 비활성화한다.
- `ending/error`: 모든 local track을 `stop()`, data channel과 peer connection을 닫는다.
- 페이지 숨김·화면 잠금·iOS 백그라운드에서 지속 연결을 보장하지 않는다. 복귀 시 정본을 다시 읽고 사용자가 새 세션을 시작한다.

### 6.3 transcript

- partial transcript는 UI 임시 표시이며 저장 정본이 아니다.
- item ID별 final event가 partial을 교체한다.
- 중복·순서 역전 event는 item/response ID로 대사한다.
- 끼어들기로 취소된 assistant partial은 흐리게 폐기하거나 즉시 제거하며 완료 메시지로 보이지 않게 한다.

---

## 7. 보안·비용·장애 경계

### 보안

- 표준 OpenAI API 키는 Pi `.env`와 서버 요청에만 존재한다.
- `/api/voice/realtime/session`은 기존 갈피 인증, rate limit, 허용 Content-Type, SDP body 상한을 적용한다.
- session config의 model, instructions, tools, voice, token·시간 상한은 서버가 만든다. 브라우저가 임의의 tool이나 모델을 추가하지 못한다.
- tool arguments는 기존 schema validator로 재검증하고, server allowlist 밖 이름은 거부한다.
- 노트·웹·논문·일정 내용은 데이터이며 session instruction을 덮는 명령으로 취급하지 않는다.
- 음성으로 들은 지시만으로 외부 행동·파일 수정·정책 변경·매매를 실행하지 않는다.

### 비용

- Realtime은 ChatGPT 구독 한도가 아니라 기존 `OPENAI_API_KEY`의 OpenAI API Billing으로 과금된다.
- R0는 세션당 5분 hard cap을 둔다.
- 자동 재연결은 하지 않고, 명시적 재시작만 새 세션을 만든다.
- max output과 도구 호출 횟수에 코드 상한을 둔다.
- 사용자 자막용 input transcription의 별도 사용량도 포함해 대사한다.
- R2 전에는 OpenAI Billing과 R0 실행 횟수로 비용을 확인하고, R2에서는 `response.done` usage를 session/response ID별 숫자 ledger로 대사한다.
- 운영 기본 모델과 일일·월간 상한은 실제 R0 사용량을 본 뒤 정한다. 가격 숫자는 문서에 고정하지 않고 구현·배포 시 [공식 가격표](https://developers.openai.com/api/docs/pricing)를 다시 확인한다.

### 장애

- 세션 생성 실패: 텍스트 채팅과 정밀 전사 경로는 계속 사용 가능해야 한다.
- data channel 오류: 미완료 transcript와 response를 저장하지 않고 media를 정리한다.
- tool timeout: 최대 횟수 뒤 read-only tool 실패를 음성으로 알리고 턴을 종료한다.
- 모델 제거·권한 없음: last-known-good가 있으면 다음 새 세션에서만 사용하고, exact 고정 모델이면 자동 대체하지 않는다.
- Pi 재시작: Realtime 세션은 복구하지 않는다. DB에 완료된 R2 턴만 남고 사용자가 새 세션을 시작한다.

---

## 8. 코드 구조

대규모 `server.js` 분해나 프론트 빌드 도입 없이 아래 경계로 시작한다.

```text
lib/realtime-session.js
  - 서버 소유 session config
  - SDP/OpenAI unified interface
  - feature flag·모델·시간 상한

lib/realtime-tool-dispatcher.js       # R1
  - read-only tool allowlist
  - schema·timeout·횟수 상한
  - 기존 retrieval/task/web/paper 함수 어댑터

lib/realtime-turn-store.js            # R2
  - final-only/idempotent message 반영
  - interrupted response 폐기
  - realtime_turn_receipts

public/voice-realtime.js
  - RTCPeerConnection·media track·data channel
  - 상태 머신·transcript reconciliation
  - 시작·mute·종료·오류 정리

server.js
  - 인증된 route와 의존성 주입만
```

R0에서는 `realtime-tool-dispatcher`와 `realtime-turn-store`를 만들지 않는다. 단계가 열릴 때 필요한 모듈만 추가한다.

---

## 9. 통과 기준

### R0 GO

- [x] iPhone 홈 화면 PWA와 Mac 브라우저가 Tailscale HTTPS에서 세션을 시작한다.
- [x] iPhone에서 5분 동안 한국어·영어로 말하고 들으며 완료 transcript가 표시된다.
- [x] 시온 발화 중 끼어들기에서 남은 답변이 계속 나오지 않고 다음 턴으로 전환된다.
- [x] mute/unmute, 사용자 종료, 5분 hard cap 뒤 마이크 track과 peer connection이 남지 않는다.
- [x] 표준 API 키가 브라우저 응답·정적 파일·로그에 없다.
- [x] R0 전후 DB application table 행 수, task/event/reminder, Vault hash가 불변이다.
- [x] 기존 텍스트 GPT 채팅·Web Push·일정 에이전트 회귀 테스트가 통과한다.

> 사용자 실기기 기능 인수는 통과했다. 5분 세션 안의 정확한 턴 수와 끼어들기 횟수는 별도 계수하지 않았다.

R0가 위 기준을 통과하지 못하면 R1을 만들지 않는다. 정확한 지연은 먼저 기록하고, 첫 spike 전에 임의의 숫자 GO 기준을 만들지 않는다.

### R1 GO

- [ ] 알려진 기억 질문 5개에서 기존 A2의 관련 청크를 같은 상한 안에서 읽는다.
- [ ] 모르는 질문 4개에서 `galpi_context_lookup`이 무관 기억을 주입하지 않는다.
- [ ] 활성 일정 질문이 현재 task 정본과 일치하고 closed/deleted를 실시간 일정으로 섞지 않는다.
- [ ] 도구는 턴당 2회·8,000자·timeout 상한을 넘지 않는다.
- [ ] 등록·완료·취소·노트 저장·Codex 실행 tool이 session config에 없다.
- [ ] R1 질문 전후 DB·Vault·task가 불변이다.

### R2 GO

- [ ] 완료된 음성 user/assistant 턴 10개가 `shared-main`에 각각 정확히 한 번 저장된다.
- [ ] 끼어든 assistant 응답 5개의 partial transcript가 일반 assistant 메시지로 저장되지 않는다.
- [ ] 일정 음성 요청은 확인 카드 전 task write 0회, 취소 0회, 등록 시 같은 request ID로 정확히 1회 생성된다.
- [ ] 메모 transcript는 수정·확인 전 topic·memory에 들어가지 않는다.
- [ ] 원본 오디오 파일이 DB·Vault·backup에 0개다.
- [ ] session/response usage가 중복 없이 숫자로 대사되고 hard cap 뒤 새 응답이 생성되지 않는다.
- [ ] 세션 장애·Pi 재시작 뒤 완료 턴은 남고 미완료 턴은 완료된 것처럼 복구되지 않는다.

---

## 10. 명시적 비범위

- 상시 호출어·상시 마이크
- 잠금화면·백그라운드 지속 대화
- 전화망/SIP 연결
- 다중 화자 구분
- 장시간 강의 녹음·실시간 강의 전사
- 음성 복제·사용자 맞춤 voice 생성
- 원본 오디오 장기 보관
- Realtime 모델이 task·노트·정책을 직접 쓰는 도구
- R0 전에 Agents SDK·TypeScript·번들러를 도입하는 작업
- Realtime이 텍스트 GPT-5.6 경로와 완전히 같은 모델이라고 보이게 하는 UI

강의 녹음은 [갈피 강의 노트 설계](Lecture-note-system%20Design.md)의 Apple 음성 메모 기반 안정성 경계를 유지한다. V4-B 짧은 대화 세션을 강의 녹음기로 확장하지 않는다.

---

## 11. 구현 순서

```text
문서 승인
  → R0 raw WebRTC local spike
  → Mac·iPhone/Pi 실제 R0 인수
  → R0 결과로 voice·VAD·지연·운영 모델 결정
  → R1 기억·일정 read-only
  → 웹·논문 read-only parity는 필요가 확인된 순서로 추가
  → R2 final-only history
  → 일정·메모 승인 카드 연결
  → Realtime 운영 기본 승격
  → V5-A 딜 스카우트
```

정밀 전사 경로는 R0와 병행해 만들지 않는다. R0가 실패하거나 정확한 쓰기 UX가 먼저 필요하다는 실사용 근거가 생기면 `POST /api/voice/transcribe` 기반 작은 입력구를 우선한다.

---

## 12. 공식 근거

[^voice-agents]: OpenAI, [Voice agents — Build a speech-to-speech voice agent](https://developers.openai.com/api/docs/guides/voice-agents#build-a-speech-to-speech-voice-agent). Live audio를 끼어들기, 낮은 첫 음성 지연, 자연스러운 턴 교대, 실시간 도구 사용이 필요한 경우의 출발점으로 설명한다.
[^webrtc]: OpenAI, [Realtime API with WebRTC](https://developers.openai.com/api/docs/guides/realtime-webrtc). 브라우저·모바일 클라이언트에는 WebRTC를 권장하고, unified interface와 ephemeral token 두 초기화 방식을 문서화한다.
[^realtime-conversations]: OpenAI, [Realtime conversations](https://developers.openai.com/api/docs/guides/realtime-conversations). 세션·conversation·response lifecycle, VAD, transcript event, function calling, WebRTC interruption/truncation을 설명한다.
[^realtime-tools]: OpenAI, [Realtime with tools — Configure a function tool](https://developers.openai.com/api/docs/guides/realtime-mcp#configure-a-function-tool). 애플리케이션에서 실행할 작업에는 function tool을 기본으로 제시한다.
[^realtime-mini]: OpenAI, [GPT-Realtime-2.1 mini](https://developers.openai.com/api/docs/models/gpt-realtime-2.1-mini). WebRTC·WebSocket·SIP의 audio/text 입력과 function calling을 지원하는 더 빠르고 저렴한 Realtime 모델로 설명한다.
