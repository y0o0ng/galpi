# V4-B 시온 음성·Realtime 상세 설계

> Version: 1.2
>
> Date: 2026-07-31
>
> Status: R0 GO, R1 노트 탐색·말투 연속성 Pi 기능 인수, R2a 이벤트 reconciliation·R2b bounded 턴 보정 Pi 기술 인수 완료, `near_field` 실기기 잡음 표본 조건부 인수, R2c 이후 미구현
>
> Scope: 짧은 음성 입력, 자연스러운 실시간 대화, 갈피 읽기 도구, 보정 전사 정본, 승인형 쓰기, 음성 모델 운영

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

같은 날 R1 읽기 전용 경로를 로컬에 구현하고 Pi에 기술 배포했다. 이후 실기기에서 일정 조회는 정상이고 “내 시들 중 마음에 드는 것 하나를 읽어달라”는 노트 탐색 요청이 실패한 것을 확인해, 전역 A2 기준을 낮추지 않고 노트 탐색 경계를 로컬에서 보강했다.

- `lib/realtime-tool-dispatcher.js`는 `galpi_context_lookup`, `galpi_note_search`, `galpi_note_read`, `schedule_read` 네 function tool만 노출한다. 등록·수정·완료·취소·노트 저장·Codex 실행 도구는 session config에 없다.
- 브라우저는 `response.function_call_arguments.done` 또는 최종 `response.done`의 function call을 감지해 인증된 갈피 서버로 전달한다. 서버 결과는 같은 `call_id`의 `function_call_output`으로 data channel에 돌려주고 `response.create`로 답변을 이어간다.[^realtime-conversations]
- 서버는 5분 수명의 추측 불가능한 tool session을 만들고, 음성 VAD 응답을 사용자 턴에 매핑한다. 같은 `call_id` 재전송은 결과를 재사용하며 다른 인자 재사용은 거절한다.
- 턴별 실행은 직렬화해 동시 호출도 합계 2회·8,000자를 넘지 않는다. 각 provider는 5초 timeout 뒤 실패 결과로 음성 대화를 계속한다.
- 기억 조회는 A2의 전역 `ready` topic 청크 provider와 점수·abstention·3노트·6청크·8,000자 정책을 재사용하되, R1 무쓰기 계약 때문에 `assistant_retrieval_shadow_runs` trace는 기록하지 않는다.
- 노트 탐색은 제목·종류의 작은 카탈로그 단계로 정확한 활성 `ai_readable` 노트를 고른 뒤, topic이면 기존 `note_chunks`의 `ready` QA를 최대 6개 균등 표본으로 같은 `<retrieval>` 포맷에 넣는다. `source_missing`과 정리·복구 중 노트는 읽지 않는다. 비topic만 안정 상태를 재확인한 bounded 본문으로 대체한다.
- 노트 탐색과 A2 기억 검색을 합치지 않는다. “아무거나 하나 골라줘”에는 특정 QA의 lexical anchor가 없으므로 A2가 기권하는 것이 정상이고, 이를 통과시키려고 전역 점수 문턱을 낮추면 한 글자 제목 `시`가 무관 청크를 되살릴 위험이 있다.
- 일정 조회는 기존 `buildActiveScheduleContext()`만 호출하므로 활성 task 정본만 읽고 closed/deleted를 섞지 않는다.
- `OPENAI_REALTIME_READ_TOOLS_ENABLED=true`와 `ASSISTANT_RETRIEVAL_A2_ENABLED=true`가 함께 있어야 열린다. 코드와 `.env.example` 기본값은 계속 `false`다.

로컬 Realtime 집중 테스트 13/13에서 공식 tool round-trip, 인증, allowlist, 중복 멱등성, 동시 호출 직렬화, 턴당 2회, 합계 8,000자, timeout·만료, 무관 기억 abstention, 활성 일정 합성, DB application table·Vault 불변을 확인했다. 전체 회귀는 222/224였고 실패 2건은 병렬 서버 기동 timeout으로, 기존 일정·Codex 서버 묶음을 격리 재실행해 9/9 통과했다.

Pi에서는 DB·Vault 백업 `20260730-2045`와 코드 복구본 `code-v4b-r1-pre-20260730-2045.tar.gz`를 만든 뒤 변경 파일 15개 hash를 로컬과 대조했다. R1 집중 테스트 13/13, Pi 전체 220/220, note-index 34/34·finding 0, topic Q&A 105/105·finding 0을 통과했다. `OPENAI_REALTIME_READ_TOOLS_ENABLED=true`로 재시작한 새 PID는 `126573`이며 인증된 로컬·Tailscale HTTPS config 모두 `readToolsEnabled=true`다. HTTPS `voice-realtime.js`와 배포 파일 SHA-256도 일치한다. 재시작 전후 `messages 448`, `notes 34`, `assistant_tasks 8`, `assistant_task_events 16`, `assistant_reminders 4`, retrieval trace 99와 Vault hash `7e71c78e...c0dd`가 불변이고 SQLite integrity `ok`, foreign key 오류 0건이다. 실제 기억 5개·무관 4개·활성 일정 음성 기능 인수 전이므로 R1 GO는 아직 아니다.

노트 탐색 보강의 로컬 집중 테스트는 14/14, 전체 순차 회귀는 225/225다. route 통합 fixture에서 제목 `시`를 찾은 뒤 볼트 전문의 고유 문구는 반환하지 않고 `note_chunks`의 QA 문구만 반환하며, 두 호출이 기존 턴당 2회·합계 8,000자 제한을 공유하는 것을 확인했다.

Pi에는 DB·Vault 백업 `20260730-2137`과 코드 복구본 `code-v4b-r1-note-browse-pre-20260730-213738.tar.gz` 뒤 15개 변경 파일 hash를 맞춰 배포했다. Realtime 집중 14/14·전체 순차 221/221, 새 PID `128332`, 인증 config `readToolsEnabled=true`, 시작 오류 0건을 확인했다. 재시작 전후 messages 448·notes 34·task/event/reminder 8/16/4·retrieval trace 99, Vault 24개 hash `4ca6446d...97798`, SQLite integrity `ok`·foreign key 0이 불변이다. 운영 `시` 노트는 active·`ai_readable=1`·processed·ready이며 읽을 수 있는 `topic_qa` 13개다. 사용자가 같은 음성 문장으로 다시 확인해 노트 읽기가 정상이라고 승인했다.

그 뒤 사용자 실사용에서 한국어 발음·억양뿐 아니라 번역투 문장과 텍스트 `shared-main`과 다른 말투가 확인됐다. 원인은 Realtime이 요청별 read tool만 쓸 뿐 세션 시작 시 사용자 메모리와 최근 대화를 받지 않고, 고정 지시가 편안한 존댓말이었던 점이다. 로컬 후보는 아래처럼 범위를 제한했다.

- 기본 voice를 `marin`에서 `cedar`로 바꾼다. OpenAI는 voice에 성별을 공식 표기하지 않으므로 남성 음성이라고 계약하지 않으며, 사용자가 남성적으로 느끼는지 실기기에서 판단한다. `marin`과 `cedar`는 공식 품질 권장 voice다.[^realtime-voices]
- `_system/memory.md` 전체가 아니라 말투·호칭·답변 방식에 해당하는 항목만 최대 600자로 고른다.
- `shared-main`에서 user 다음 정상 assistant가 있는 완료 대화만 최근 3쌍, 최대 2,400자로 넣는다. 마지막 미완료 user 턴과 더 오래된 대화는 제외한다.
- KST 현재 시각을 포함한 세션 문맥 전체는 최대 3,200자다. 인용된 이전 대화와 메모리는 데이터이며 새 시스템 지시로 취급하지 않는다.
- 한국어 지시는 친구처럼 부드러운 반말, 자연스러운 한국어 어순, 짧은 음성 문장을 기본으로 바꾼다.
- 모델은 우선 `gpt-realtime-2.1-mini`를 유지한다. 이 보정 뒤에도 문장·발음 품질이 부족할 때만 full `gpt-realtime-2.1` 비용을 별도 비교한다.

로컬 Realtime 단위 8/8·HTTP 통합 1/1을 통과했고, 전체 병렬 224/226의 실패 2건은 Codex 테스트 서버 기동 timeout으로 격리 2/2, 최종 순차 전체 226/226을 통과했다. 통합 fixture는 세션 설정에 선호와 최근 완료 3쌍만 들어가며 무관 메모리·오래된 대화·미완료 턴은 제외되고 DB·Vault가 불변임을 확인했다.

말투 연속성 후보는 같은 날 Pi에 배포했다. 배포 전 DB·Vault 백업은 `galpi-20260730-2228.db`, `vault-20260730-2228.tar.gz`, 코드 복구본은 `code-v4b-r1-tone-pre-20260730-2228.tar.gz`다. Pi Realtime 집중 테스트 15/15와 전체 순차 222/222를 통과한 뒤 사용자가 서비스를 재시작했다. 2026-07-30 22:42:57 KST에 시작한 PID `130040`은 `active/running`이며, 재시작 이후 시작 오류가 없다. 인증된 운영 config는 `gpt-realtime-2.1-mini`, `cedar`, 300초, `readToolsEnabled=true`이고 `.env`의 보조 자막 모델은 `gpt-4o-mini-transcribe`다. 사용자는 재시작 뒤 실제 대화를 다시 사용하고 이전보다 “훨씬 낫다”고 승인했다. 이는 Cedar·bounded 말투 문맥 조합의 제품 체감 GO이지, 한국어 고유명사·숫자·날짜·긴 code-switch 전사 정확도까지 계수한 품질 평가를 뜻하지 않는다. 따라서 mini/Cedar를 유지하고 full 모델이나 별도 TTS로 즉시 이동하지 않는다.

또한 Realtime input transcription을 그대로 갈피 대화 정본으로 저장하지 않기로 결정했다. OpenAI는 이 전사가 Realtime 모델의 음성 이해와 별개인 ASR 과정이며, 모델의 해석과 달라질 수 있으므로 “rough guide”로 취급하라고 명시한다.[^realtime-input-transcript] 따라서 R2는 Realtime을 즉각적인 귀·입으로 유지하되, 턴 종료 후 bounded 오디오를 `gpt-transcribe`로 다시 전사한 보정본만 `shared-main`, 메모, 일정 후보의 텍스트 정본으로 사용한다. 이 계약은 아래 R2 설계에 반영했다. 이벤트 대사의 휘발성 기반인 R2a만 구현했고, 실제 bounded audio·보정 전사·영구 저장 경로는 아직 구현하지 않았다.

같은 날 R2 전체를 한 번에 열지 않고 첫 단계인 R2a를 로컬에 구현했다. R2a는 보정 전사를 하기 전에 브라우저가 이미 받는 Realtime 이벤트를 정확한 턴에 대사하는 휘발성 기반만 만든다.

- `public/voice-realtime.js`의 한 음성 세션 안에만 turn receipt, input item→turn, response→turn, assistant item→response 매핑을 둔다. 세션 종료·오류 cleanup에서 전부 지우며 브라우저 저장소, 서버, DB, Vault로 보내지 않는다.
- `event_id`가 있는 server event는 세션 안에서 한 번만 처리한다. 집합은 4,096개를 넘으면 가장 오래된 ID부터 버려 장시간 세션에서 무한히 자라지 않게 했다. `event_id`가 없는 이벤트는 공식 식별자가 없으므로 기존처럼 처리한다.
- 사용자 input transcript의 `completed`는 이름과 무관하게 `provisional` 상태다. 늦은 delta는 이미 닫힌 자막을 바꾸지 않고, 같은 completion 재전송도 같은 행을 중복 생성하지 않는다.
- assistant transcript는 정상 완료일 때만 `final`이다. R2a 첫 구현은 transcript completion 뒤 `response.done`이 `cancelled`·`failed`·`incomplete`이면 모두 `interrupted`로 되돌렸지만, 2026-07-31 실기기에서 어려운 질문의 token 한도 종료까지 사용자 끼어들기로 오분류되는 것을 확인했다. 현재는 `cancelled → interrupted`, `failed → failed`, `incomplete → incomplete`로 분리하고 끼어들기 뒤 늦게 온 delta만 다시 final로 만들지 못하게 한다.
- `response.output_item.added`를 통해 assistant item과 response를 연결하므로 `response.done`과 transcript completion 순서가 바뀌어도 현재 턴이 아니라 원래 response의 턴에 귀속된다.
- tool-only response도 기존 R1 function call loop를 그대로 사용하고, response/turn 상태만 휘발성 receipt에 연결한다. R2a 때문에 새 provider 호출, audio upload, transcription route, schema, message·topic·task·trace write는 생기지 않았다.

로컬 브라우저 VM fixture는 중복 user completion, 완료 뒤 late delta, 중복 assistant delta, assistant completion 뒤 cancellation, 다음 턴 뒤 늦게 도착한 이전 턴 completion, `response.done`이 먼저 온 정상 assistant completion, tool-only response를 한 세션에서 뒤섞어 검증한다. 네 transcript 행만 남고 두 번째 user/assistant가 같은 turn ID, 첫째와 둘째 user가 다른 turn ID이며, interrupted assistant는 완료 자막이 있었어도 `중단됨`으로 끝난다. HTTP 요청도 기존 session handshake와 R1 read tool 두 건뿐임을 확인했다. 집중 테스트는 15/15, 로컬 전체 회귀는 226/226을 통과했다. 아직 오디오 캡처·보정 STT·영구 receipt가 없으므로 R2 전체 GO나 corrected-only 저장 GO로 승격하지 않는다.

R2a는 같은 날 Pi에도 무중단 배포했다. 정적 클라이언트와 해당 회귀 테스트만 바꿨으므로 서비스 재시작 없이 기존 PID `130040`을 유지했다. 배포 전 온라인 백업은 `galpi-20260730-2354.db`, `vault-20260730-2354.tar.gz`, 코드 복구본은 `code-v4b-r2a-pre-20260730-2353.tar.gz`다. 로컬과 Pi의 `public/voice-realtime.js` SHA-256은 `372a9c0d...42f48`로 일치하고, localhost가 실제 제공한 정적 응답 hash도 같았다. Pi 집중 테스트 15/15와 전체 순차 222/222를 통과했다.

배포 전후 기준은 `messages 448`, `notes 34`, `assistant_tasks 8`, `assistant_task_events 16`, `assistant_reminders 4`, `assistant_retrieval_shadow_runs 99`, Vault 전체 hash `7e71c78e...c0dd`로 모두 불변이었다. SQLite integrity는 `ok`, foreign key 오류는 0건이며 배포 시각 이후 journal의 warning/error도 0건이다. 이 증거는 R2a가 현재 무쓰기임을 확인하지만, 실제 오디오 보정과 영구 message exactly-once는 R2b·R2c에서 별도로 인수한다.

2026-07-31 R2b를 로컬에 구현하고 Pi 운영에 기술 인수했다. R2b는 같은 마이크 스트림에서 사용자 턴만 bounded WAV로 만들고 `gpt-transcribe` 보정본을 기존 사용자 말풍선에 표시하지만, 아직 대화·노트·일정 정본을 저장하지 않는 무쓰기 단계다.

- `public/voice-turn-recorder.js`는 WebRTC가 사용하는 동일 `MediaStream`을 Web Audio에 연결한다. 세션 전체 녹음이 아니라 연속 ring buffer를 유지하고, VAD의 `speech_started`/`speech_stopped`를 기준으로 500ms pre-roll과 300ms post-roll을 포함한 독립 사용자 턴을 만든다.
- 브라우저별 컨테이너 협상과 서버 디코딩 의존성을 피하기 위해 첫 구현의 전송 형식은 16kHz·mono·16-bit PCM WAV로 고정했다. 입력 장치 sample rate는 브라우저에서 16kHz로 resample하며, 서버는 RIFF/WAVE 헤더와 PCM format·channel·bit depth·sample rate를 실제 bytes에서 다시 검사한다.
- 클라이언트와 서버는 사용자 발화 최대 120초·WAV 최대 8MB를 함께 집행한다. 이는 OpenAI file transcription의 25MB 상한보다 의도적으로 작다. 세션 전체나 강의 녹음을 이 route로 보내지 않는다.[^file-transcription]
- `lib/realtime-transcription.js`는 `busboy`로 multipart를 stream parse하고 audio file 하나와 `session_id`, `input_item_id`, `duration_ms` 세 일반 필드만 메모리에서 받는다. temp file, DB, Vault, schema, transcript log를 만들지 않는다.
- `POST /api/voice/realtime/turns/:turnId/transcribe`는 기존 인증과 보정 feature flag를 요구한다. 안전한 ID 형식, 현재 보정 session, item/turn 결합, MIME, WAV 구조, 서버 산출 duration과 client claim의 ±2초 일치, byte·duration 상한을 provider 호출 전에 검증한다.
- 서버가 정한 exact `gpt-transcribe`만 사용하고 브라우저가 model을 고르지 못한다. provider 요청에는 `languages[]=ko`, `languages[]=en`을 넣고 30초 timeout을 적용한다. API key는 계속 Pi 서버에만 있으며 응답 usage는 숫자형 필드만 통과시킨다.
- 보정 session은 opaque하고 메모리에서 5분 뒤 만료된다. 같은 `(session, item, turn, audio SHA-256)` 재전송은 동일 promise 또는 결과를 재사용해 provider를 한 번만 호출하고, 같은 item에 다른 turn/audio가 오면 `409`로 막는다.
- session별 provider 호출은 직렬화하고 미처리 턴은 최대 3개다. 상한에 닿으면 새 발화를 조용히 무기록으로 진행하지 않고 local mic track을 잠시 꺼 `기록 정리 중`을 표시하며, backlog가 줄면 원래 mute 상태를 존중해 복원한다.
- `public/voice-realtime.js`는 R2a receipt에 bounded audio를 휘발성으로 연결한다. 보정 요청 중에는 사용자 행이 `보정 중`, 성공하면 같은 행의 텍스트와 상태가 `corrected`, 실패하면 provisional을 유지하되 `기록 확인 필요`로 표시한다. 실패한 provisional은 저장 정본으로 승격되지 않는다.
- `pagehide`, `beforeunload`, 사용자 종료와 공용 cleanup은 진행 중 upload를 abort하고 recorder node·AudioContext·ring buffer·audio 참조를 해제한다. 현재 서버도 audio를 메모리에만 가지므로 process restart 뒤 청소할 temp root가 없다.
- 화면 고지는 보정 기능이 켜진 동안 `보정 자막 · 아직 저장 안 함`이다. 이는 R2b 보정본도 현재 세션 화면의 휘발성 결과일 뿐 `shared-main` 저장 완료가 아님을 뜻한다.

공식 file transcription은 완료된 또는 bounded audio 요청에 쓰는 경로이고, 현재 문서는 녹음 음성 전사에 `gpt-transcribe`부터 시작하도록 안내한다. 공식 입력 상한은 25MB이며 WAV가 지원된다. 갈피는 이 provider 계약 안에서 첫·끝 음절 보존과 독립 턴 검증을 단순화하려고 더 좁은 PCM WAV·8MB·120초 제품 경계를 택했다.[^file-transcription]

로컬 집중 테스트 23/23과 전체 순차 회귀 234/234를 통과했다. 집중 fixture는 WAV resample·pre/post-roll·byte 상한, multipart 필드·provider request, timeout abort, session 결합, 직렬화, 같은 audio 멱등성, 다른 audio 충돌, pending 3개 상한, expiry, MIME·duration 거절, corrected/failed UI, page close abort와 DB·Vault 무쓰기를 확인한다.

Pi 배포 전 백업은 DB `/home/pi/backups/galpi/galpi-20260731-0058.db`, Vault `/home/pi/backups/galpi/vault-20260731-0058.tar.gz`, 코드 `/home/pi/backups/galpi/code-v4b-r2b-pre-20260731-0055.tar.gz`다. 변경 파일 hash를 로컬과 Pi에서 대조하고 Pi 집중 23/23·전체 순차 230/230을 통과했다. 운영 `.env`에는 아래 값만 활성화했으며 코드와 `.env.example`의 기능 기본값은 `false`다.

```dotenv
OPENAI_REALTIME_CORRECTION_ENABLED=true
OPENAI_REALTIME_CANONICAL_TRANSCRIPTION_MODEL=gpt-transcribe
OPENAI_REALTIME_MAX_TURN_SECONDS=120
OPENAI_REALTIME_MAX_TURN_BYTES=8388608
```

사용자가 서비스를 재시작한 뒤 2026-07-31 01:09:05 KST에 시작한 PID `133153`은 `active/running`이다. 인증 config는 `gpt-realtime-2.1-mini`, `cedar`, 300초, read tools와 correction 활성, `gpt-transcribe`, 120초, 8MB를 반환했다. `public/voice-realtime.js`, `public/voice-turn-recorder.js`의 실제 localhost 응답 hash가 배포 파일과 일치하고, 새 시작 이후 correction·warning·error·exception 로그는 0건이다.

재시작 전후 `messages 448`, `notes 34`, task/event/reminder `8/16/4`, retrieval trace `99`, Vault 전체 hash `7e71c78e...c0dd`가 불변이고 SQLite integrity `ok`, foreign key 오류 0건이다. 따라서 R2b 서버·배포·무쓰기 기술 인수는 완료했다. 아직 남은 것은 iPhone 실제 마이크에서 한국어·영어·고유명사·날짜, 첫·끝 음절, 끼어들기 중 보정 UI를 확인하는 제품 품질 인수다. R2c의 durable receipt, `messages` exactly-once 저장, 실패 재시도·직접 수정·폐기 UI는 아직 구현하지 않았다.

같은 날 첫 iPhone 실사용에서 세 가지 안정성 문제가 확인됐다.

1. 어려운 질문의 답변이 작성·음성 재생되다가 회색 `중단됨`으로 끝나고 더 이어지지 않았다.
2. 사용자 input transcription이 늦게 오면 이미 표시된 XION 답변 아래에 붙어 `XION → 나` 순서로 보였다.
3. 시온이 날짜는 답하지만 현재 시각은 모른다고 답했다.

첫 문제의 직접 원인은 R2b recorder가 아니라 응답 상태와 상한 처리였다. OpenAI의 `response.done`은 최종 상태와 무관하게 항상 오며 `completed`, `cancelled`, `failed`, `incomplete`를 구분한다. `max_output_tokens`는 한 assistant response의 tool call을 포함한 전체 output token 상한이고 숫자 또는 `inf`를 지원한다.[^realtime-response-done] 갈피는 응답 상한을 `800`으로 고정하고 모든 non-completed 상태를 `interrupted`로 합쳤기 때문에, 복잡한 답변이 상한에 닿아 `incomplete`가 되면 실제 사용자 끼어들기와 같은 회색 상태로 표시했다.

안정화 보정은 아래 경계를 적용한다.

- `OPENAI_REALTIME_MAX_OUTPUT_TOKENS`를 추가하고 코드·운영 기본을 bounded 최대 `4096`로 올린다. 공식 `inf`는 비용과 장시간 독백 상한을 없애므로 사용하지 않는다.
- 프롬프트에는 복잡한 질문도 핵심부터 말하고 한 응답 안에서 마지막 문장을 완결하라고 명시한다.
- `response.done.status`를 `completed | cancelled | failed | incomplete`로 그대로 보존한다. 실제 끼어들기인 `cancelled`만 `중단됨`, provider 실패는 `응답 오류`, `incomplete`의 reason이 `max_output_tokens`면 `답변이 길어 여기서 멈춤`, 다른 incomplete는 `답변이 완료되지 않음`으로 표시한다.
- `incomplete` assistant는 R2c에서도 정상 완료 assistant로 저장하지 않는다. 상한을 늘려 발생 가능성을 낮추되 status를 거짓 `final`로 승격하지 않는다.

순서 역전은 공식적으로 허용된 비동기 전사를 DOM 도착 순서로 그린 것이 직접 원인이다. OpenAI는 input transcription이 Response 생성과 비동기로 실행되어 Response 이벤트보다 먼저 또는 나중에 올 수 있다고 명시한다.[^realtime-input-transcript] 또한 기존 client는 `response.created`가 늦게 오면 그 시점의 `currentTurnId`에 결합했으므로, 사용자가 이미 다음 발화를 시작한 빠른 끼어들기에서 이전 response가 새 턴으로 이동할 수 있었다.

- `speech_stopped`가 된 사용자 턴 ID를 response 대기 queue에 넣는다.
- 자동 response와 tool output 뒤 명시적 `response.create`는 각각 자신이 속한 턴을 queue에 넣는다.
- `response.created`, output item, transcript가 어떤 순서로 와도 아직 결합되지 않은 가장 오래된 대기 턴을 소비한다. 이미 결합된 response ID는 기존 턴을 재사용한다.
- transcript DOM은 이벤트 도착 순서가 아니라 숫자 turn ID, 같은 턴에서는 `user → assistant` 순으로 안정 정렬한다.
- 다음 user의 `speech_started` 뒤 이전 response.created가 도착하고 assistant transcript 뒤 user transcription이 도착하는 합성 fixture를 고정한다.

현재 시각 문제는 세션 시작 시 KST snapshot이 `<voice_session_context>` 안에 있었지만 같은 지시가 그 블록을 말투·대화 연속성에만 참고하라고 제한한 구조적 충돌이다. 세션이 5분 동안 진행되면 snapshot도 현재 시각 정본이 될 수 없다.

- 다섯 번째 read-only tool `galpi_current_time`을 추가한다.
- 인자는 받지 않고 호출 시점의 Pi 서버 clock을 `Asia/Seoul`, 날짜·요일·초 단위 KST로 반환한다.
- 일반 기억·노트·일정과 같은 opaque 5분 tool session, call ID 멱등성, 턴당 2회, 8,000자, 5초 timeout 경계를 공유한다.
- 모델에는 날짜·시각 질문에서 session context를 추측하지 말고 이 도구를 호출하라고 명시한다.
- DB·Vault·외부 서비스 write나 별도 API 호출은 없다. Pi의 NTP/system clock이 시간 정본이다.

R2b recorder의 물리 output 경로도 예방적으로 분리했다. 기존 Web Audio graph는 `ScriptProcessor → gain(0) → AudioContext.destination`으로 물리 출력 destination을 활성화했다. 사용자 증상은 token 상한과 정확히 일치해 이 경로가 직접 원인이라고 단정하지 않지만, iPhone audio session·echo cancellation과 불필요하게 결합할 이유가 없다. 현재는 `ScriptProcessor → MediaStreamAudioDestinationNode`의 격리 sink만 사용하고 실제 `context.destination`에는 연결하지 않는다. 브라우저가 격리 sink를 지원하지 않으면 보정 recorder만 fail-close하고 Realtime 대화는 계속한다.

안정화 배치는 로컬 집중 24/24와 전체 순차 235/235, Pi 집중 24/24와 전체 순차 231/231을 통과했다. fixture는 4,096 상한·status 분리, max token incomplete와 실제 cancelled 구분, response 대기 queue, 역순 transcript 안정 정렬, tool continuation 원래 턴 결합, 물리 destination 미연결, 서버 KST 시각과 무인자 검증, 기존 보정 STT·무쓰기를 함께 확인한다. 배포 전 백업은 DB `galpi-20260731-0147.db`, Vault `vault-20260731-0147.tar.gz`, 코드 `code-v4b-r2b-stability-pre-20260731-0147.tar.gz`다. 변경 파일 hash를 로컬과 Pi에서 대조하고 운영 `.env`에 `OPENAI_REALTIME_MAX_OUTPUT_TOKENS=4096`을 명시했다.

사용자 재시작 뒤 새 PID는 `134945`, 시작 시각은 `2026-07-31 02:02:36 KST`, 상태는 `active/running`이다. 인증된 config에서 `gpt-realtime-2.1-mini`, `cedar`, 300초, `maxOutputTokens: 4096`, read tools와 correction 활성 상태를 확인했고, localhost가 제공한 `voice-realtime.js`와 `voice-turn-recorder.js` hash는 배치 파일과 각각 일치했다. 새 시작 로그 오류는 0건이다. 재시작 전후 messages/notes/task/event/reminder/retrieval trace는 `448/34/8/16/4/99`, Vault는 59개 파일과 같은 content hash, SQLite integrity는 `ok`, foreign key 오류는 0으로 불변이다. 서버 기술 인수는 완료했으며, 기존에 끊긴 어려운 질문·현재 시각·실제 끼어들기·빠른 두 턴·보정 UI의 실기기 제품 인수만 남아 있다.

이 재시작 뒤 첫 현재 시각 실기기 질문에서 `Conversation already has an active response in progress` 오류와 회색 `연결 오류`가 확인됐다. 원인은 `response.function_call_arguments.done`에서 도구 HTTP를 즉시 실행하고 `function_call_output → response.create`를 보낸 것이었다. 이 이벤트는 arguments가 완성됐음을 뜻하지만 원래 Response의 완료를 뜻하지 않으므로, 아직 default conversation에 쓰는 응답이 활성인 동안 두 번째 응답 생성을 요청했다. OpenAI 공식 function-calling 흐름은 function call을 담은 `response.done`을 받은 뒤 도구를 실행하고 output item과 새 `response.create`를 보내며, default conversation에는 한 시점에 Response 하나만 쓸 수 있다고 명시한다.[^realtime-function-calling][^realtime-response-create]

도구 실행 경계는 아래처럼 좁힌다.

- `response.function_call_arguments.done`은 증분 완료 신호로만 소비하고 side effect를 만들지 않는다.
- `response.done.status=completed`이고 output item도 `type=function_call`, `status=completed`인 호출만 서버 read tool로 보낸다.
- 기존 `call_id` 멱등성으로 duplicate `response.done`도 한 번만 실행한다.
- tool HTTP를 기다리는 동안 사용자가 새 발화를 시작해 현재 turn이 바뀌면 `function_call_output`으로 대화 정합성은 닫되 늦은 `response.create`는 보내지 않는다.
- request-level Realtime `error` event는 transport 단절로 취급하지 않는다. 공식 문서가 대부분의 오류는 복구 가능하고 세션이 열린 채 유지된다고 명시하므로, 한국어 안내를 표시하고 mic·peer·data channel을 보존한다.[^realtime-error]
- 실제 연결 종료는 기존 WebRTC `failed | closed`, 2초 넘는 `disconnected`, data channel 자체 오류에서만 처리한다. 다음 speech 또는 `response.created`가 오면 request-level 안내를 지운다.

이 보정은 로컬 집중 24/24·전체 순차 235/235, Pi 집중 24/24·전체 순차 231/231을 통과했다. 배포 전 DB·Vault 백업은 `20260731-1053`, 코드 복구본은 `code-v4b-r2b-tool-race-pre-20260731-1053.tar.gz`다. `public/voice-realtime.js`와 회귀 테스트만 정적 배포해 서비스는 재시작하지 않고 PID `134945`를 유지했다. 배포 파일과 localhost 응답 hash `a126abeb...dac5`가 일치했고 messages/notes/task/event/reminder/trace `448/34/8/16/4/99`, Vault 59개 파일 content hash, SQLite integrity `ok`·foreign key 0은 불변이다. 백업 스크립트의 기존 7일 보관 정책으로 오래된 백업 2개가 정리됐다. 실기기에서는 PWA를 완전히 닫았다 다시 열고 현재 시각 질문의 도구 응답, `연결 오류` 부재, 바로 이어지는 다음 일반 질문을 확인한다.

사용자는 위 active-response 보정을 실기기에서 정상으로 확인한 뒤, 시온이 말하는 동안 헛기침이나 알림음에도 응답이 멈추는 false interruption을 보고했다. 2026-07-31 운영 baseline에 브라우저의 기존 echo cancellation·noise suppression·AGC와 별도로 Realtime `audio.input.noise_reduction.type=near_field`를 추가했다. `semantic_vad`, `eagerness:auto`, `create_response:true`, `interrupt_response:true`는 바꾸지 않아 실제 사용자의 즉시 끼어들기를 유지한다. 로컬 집중 9/9·전체 235/235, Pi 집중 9/9·전체 231/231을 통과했고 배포 전 DB·Vault 백업은 `galpi-20260731-1124.db`, `vault-20260731-1124.tar.gz`, 코드 복구본은 `code-v4b-noise-reduction-pre-20260731-112415.tar.gz`다. 사용자 재시작 뒤 PID `138723`, 시작 시각 `2026-07-31 11:43:47 KST`, `active/running`, HTTP 200과 warning 이상 journal 0건을 확인했다. 실제 Pi session config 생성값은 mini·Cedar·4096 tokens와 `near_field`·기존 semantic VAD 조합이다. messages/notes/task/event/reminder/trace `448/34/8/16/4/99`, Vault 59개와 hash `7e71c78e...c0dd`, SQLite integrity `ok`·foreign key 0은 재시작 전후 불변이다. 서버 기술 인수는 완료했고 아래 헛기침·알림음·실제 끼어들기·작은 목소리 실기기 표본은 2026-07-31에 받았다. 결과와 조건부 인수 판단은 같은 문서의 `near_field` 실기기 인수 절에 기록했다.

## 0. 결정 요약

1. 시온의 자연 대화는 **OpenAI Realtime API를 갈피가 직접 WebRTC로 연결**해 구현한다. STT·VAD·끼어들기·스트리밍 TTS 엔진을 자체 제작하지 않는다.
2. V4-B에는 목적이 다른 두 사용자 경로와, Realtime 뒤에서 자동으로 도는 한 보정 단계를 둔다.
   - **Realtime 대화 경로**: 말하면서 듣고, 시온의 말을 끊을 수 있는 자연 대화다.
   - **Realtime 턴 보정 단계**: 라이브 대화는 지연시키지 않고, 턴 종료 뒤 `gpt-transcribe`로 보정한 텍스트만 대화·메모·일정 후보 정본으로 쓴다.
   - **명시적 정밀 전사 입력구**: 사용자가 녹음 버튼으로 별도 캡처한 음성을 STT → 수정 → `대화 | 메모 | 할 일` 확인으로 보낸다.
3. 전체 기능을 한 번에 붙이지 않는다. `R0 통신 spike → R1 읽기 전용 시온 → R2 기록·승인형 쓰기` 순서로 승격한다.
4. R0는 현재 vanilla JS 프론트에 **표준 WebRTC API를 직접 사용**한다. Agents SDK는 초기 의존성·번들러 변경을 만들지 않기 위해 도입하지 않고, 도구·handoff가 실제로 복잡해질 때 재검토한다.
5. 브라우저·PWA에는 표준 OpenAI API 키를 절대 전달하지 않는다. Pi 서버가 기존 `OPENAI_API_KEY`로 Realtime 세션 초기화만 중계한다.
6. Realtime 모델은 현재 GPT-5.6 Responses 채팅 모델과 다른 실행 계열이다. 텍스트 모델 선택을 Realtime 세션에 그대로 적용하지 않는다.
7. R0와 R1은 DB·Vault·task에 쓰지 않는다. R2에서도 보정 STT가 성공하거나 사용자가 직접 수정·확정한 완료 턴만 대화 DB에 정확히 한 번 저장한다. Realtime 자막 임시본은 실패 fallback 정본이 아니며, 원본 오디오는 DB·Vault·백업에 저장하지 않는다.
8. R1 도구는 갈피 서버의 읽기 전용 allowlist만 호출한다. 모델이나 브라우저가 DB·Vault에 직접 접근하지 않는다.
9. 일정·메모처럼 상태를 바꾸는 요청은 R2에서도 후보만 만들고, 기존 확인 카드와 API를 통해 사용자가 승인한 뒤에만 저장한다.
10. 초기 제품 계약은 **화면이 열린 동안의 명시적 음성 세션**이다. 상시 마이크, 호출어, 잠금화면·백그라운드 지속 대화는 포함하지 않는다.
11. 기능 flag, 세션 시간 상한, 도구 호출 상한, last-known-good 모델을 코드에서 집행한다. 모델 지시만으로 비용과 권한을 통제하지 않는다.
12. 이 문서를 V4-B의 상세 단일 기준으로 삼는다. 저장·task 경계는 [V4.5 비서 기본기 설계](assistant-foundation-design.md)와 [시온 약속 루프 설계](task-reminder-design.md), 텍스트 모델 경계는 [단일 GPT 채팅·모델 라우팅 설계](chat-model-routing-design.md)를 따른다.
13. Realtime이 이미 생성한 답변은 사후 보정 transcript로 소급 수정되지 않는다. 날짜·시각·금액·고유명사·외부 행동처럼 오인식 비용이 큰 요청은 보정본을 보여주고 사용자가 확인한 뒤에만 쓰기 작업을 실행한다.

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

|경로/역할|주 용도|모델 경계|텍스트의 지위|저장 경계|
|---|---|---|---|---|
|텍스트 채팅|일반 대화·깊은 토론·기존 도구|GPT-5.6 Responses와 현재 모델 선택|입력한 사용자 텍스트가 정본|기존 `shared-main` 계약|
|Realtime 라이브|자연 대화·빠른 응답·VAD·끼어들기·음성 출력|별도 Realtime 모델·WebRTC 세션|input transcription은 화면과 턴 매핑용 임시본|R0/R1 무쓰기|
|Realtime 턴 보정|R2 음성 대화의 저장 정본 생성|완료된 bounded 녹음 + `gpt-transcribe` 파일 전사|성공한 보정본 또는 사용자 수정본만 정본|일반 대화는 `shared-main`, 쓰기는 확인 후보|
|명시적 정밀 전사 입력구|정확한 메모·일정 문구·짧은 별도 음성 입력|별도 녹음 + `gpt-transcribe`, 필요 시 기존 텍스트 채팅/TTS|미리보기에서 사용자가 수정·확인|확인 전 `inbox`, 목적 선택 뒤 기존 경로|

정밀 전사와 Realtime은 경쟁 기능이 아니다. 자유로운 토론의 귀와 입은 Realtime이 맡고, 기록관은 턴 종료 뒤의 보정 STT가 맡는다. 사용자가 따로 녹음해 메모·할 일을 만들고 싶을 때는 같은 전사 모델을 재사용하되, 별도의 명시적 입력구와 목적 확인 UX를 쓴다.

여기서 “Realtime 턴 보정”과 “명시적 정밀 전사 입력구”를 혼동하지 않는다.

- 턴 보정은 R2에서 음성 대화가 정상 종료될 때마다 자동으로 수행되는 내부 finalization 단계다. 일반 대화에는 매번 별도 확인을 요구하지 않고 보정 성공 뒤 자동으로 대화 기록을 확정한다.
- 명시적 입력구는 사용자가 녹음·전사를 목적 자체로 시작한다. 화면에서 전사와 `대화 | 메모 | 할 일` 목적을 반드시 확인한다.
- 일정·메모 같은 쓰기 요청은 자동 턴 보정을 통과했더라도 기존 후보 카드에서 한 번 더 확인한다. 정확한 전사와 행동 승인은 서로 다른 안전 경계다.

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

R2 턴 finalization
같은 브라우저 마이크 MediaStream
  ├ WebRTC track → Realtime 즉시 대화·VAD·끼어들기·음성 출력
  └ bounded in-memory recorder → 턴 종료 뒤 Pi
                               → gpt-transcribe
                               → corrected transcript
                               → realtime_turn_receipts
                                   ├ 일반 대화: shared-main exactly-once
                                   ├ 일정: schedule_prepare 후보 → 사용자 등록
                                   └ 메모: 수정 가능한 후보 → 사용자 저장
```

Pi는 현재 WebRTC 미디어 본문을 통과시키지 않는다. 따라서 R2 보정 오디오는 OpenAI Realtime에서 다시 내려받는 방식이 아니라, 브라우저가 이미 허용받은 같은 마이크 `MediaStream`을 bounded recorder로 한 번 더 읽어야 한다. 두 번째 마이크 권한이나 두 번째 캡처 장치를 열지 않는다.

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

1. 세션 시작 시 KST 현재 시각, 말투·호칭·답변 방식에 한정한 사용자 메모리 최대 600자, `shared-main` 최근 완료 대화 3쌍의 bounded suffix를 제공한다. 활성 일정은 계속 `schedule_read`로 질문할 때만 읽는다.
2. `galpi_context_lookup`
   - 기존 A2 retrieval provider를 재사용한다.
   - topic 최대 3개, 청크 최대 6개, 총 8,000자 상한과 abstention을 유지한다.
3. `schedule_read`
   - 기존 활성 task 합성기를 재사용한다.
   - 읽기만 가능하며 완료·취소·등록 endpoint를 호출하지 않는다.
4. 기억·일정이 안정된 뒤에만 기존 `web_search`, `paper_fulltext_search/read`를 같은 read-only dispatcher로 추가한다.
5. 도구 호출은 턴당 최대 2회이며 timeout 뒤 음성 대화는 도구 실패를 짧게 알리고 계속할 수 있다.

첫 구현은 위 항목 중 A2 기억 조회와 활성 일정 tool만 열었다. 이후 노트 탐색은 정상화됐지만 실제 대화에서 텍스트 세션과 말투가 달라지는 문제가 확인돼, 구조화 메모리 전체 대신 음성 말투 프로필만 600자로 제한하고 최근 완료 대화 3쌍을 주입하는 보수안을 열었다. 사실 기억은 계속 질문별 `galpi_context_lookup`의 abstention을 거치며, 일정도 상시 snapshot 대신 `schedule_read`를 사용한다.

OpenAI는 애플리케이션 안에서 실행할 작업에는 function tool을 기본으로 제시한다. 모델이 인자를 만들고 애플리케이션이 코드를 실행한 뒤 `function_call_output`을 돌려주는 경계다.[^realtime-tools] 갈피에서도 브라우저는 tool event를 운반할 뿐이고, 실제 allowlist·검증·실행은 Pi 서버가 맡는다.

R1은 계속 무쓰기다. 사용자가 “일정 만들어줘”라고 말하면 시온은 현재 Realtime 베타가 조회 전용임을 알리고, 정밀 전사 또는 텍스트 채팅으로 이어갈 수 있다.

### R2 — 보정 정본 기록과 승인형 쓰기

R2부터 Realtime을 기존 `shared-main` 대화에 연결한다.

#### 대화 기록

OpenAI의 `conversation.item.input_audio_transcription.completed`는 이름에 `completed`가 들어가지만 갈피의 저장 정본은 아니다. 이 이벤트는 Response 생성과 비동기로 도착하고, 서로 다른 턴의 completion 순서도 보장되지 않는다. Realtime 모델은 음성을 직접 이해하고 input transcription은 별도 ASR이므로, 공식 문서도 transcript가 모델 해석과 달라질 수 있는 “rough guide”라고 설명한다.[^realtime-input-transcript][^realtime-transcription]

따라서 R2에는 다음 세 종류의 텍스트가 존재한다.

|종류|생성 시점|용도|영구 저장 가능 여부|
|---|---|---|---|
|`partial`|사용자가 말하는 중|즉시 자막|불가|
|`provisional`|Realtime input transcription completed|화면 final 자막, item 매핑, 보정 전 비교|그 자체로는 불가|
|`corrected`|bounded 턴 오디오의 `gpt-transcribe` 완료 또는 사용자 직접 수정|갈피 대화·메모·일정 후보 정본|가능|

핵심 불변식은 아래와 같다.

1. `partial`과 `provisional`은 `messages`, topic, memory, task에 정본으로 쓰지 않는다.
2. `gpt-transcribe` 보정이 실패했다고 `provisional`을 조용히 정본으로 승격하지 않는다.
3. 일반 대화는 `corrected user + 정상 완료 assistant`가 준비됐을 때 한 transaction으로 `shared-main`에 반영한다.
4. 사용자가 끼어들어 취소된 assistant partial은 일반 assistant 메시지로 남기지 않는다.
5. 사용자 턴 보정은 끝났지만 assistant가 끊긴 경우 corrected user 메시지만 보존할 수 있다. 존재하지 않는 assistant 최종 답변을 합성하지 않는다.
6. 보정 결과가 Realtime이 이해한 내용과 달라도 이미 재생된 답변을 사후 재생성하거나 과거 OpenAI conversation item을 바꾸지 않는다. 화면의 사용자 자막과 갈피 기록만 보정본으로 교체한다.
7. 모든 대사는 이벤트 도착 순서가 아니라 로컬 음성 session ID, OpenAI input `item_id`, 최종 `response_id`로 한다.
8. 메시지에는 `source_type: voice_realtime`, 실제 resolved Realtime model, 보정 전사 model과 origin(`stt_corrected | user_edited`)을 남긴다.
9. 원본 오디오는 DB·Vault·노트·운영 백업에 저장하지 않는다.

#### 턴 오디오 캡처

공식 file transcription은 “completed recording or a bounded audio request”에 쓰는 경로이며, 현재는 녹음된 원어 음성 전사에 `gpt-transcribe`부터 시작하라고 권장한다.[^file-transcription] 갈피의 한 사용자 턴은 VAD로 경계가 생긴 bounded recording이므로 이 경로에 맞는다.

1. 브라우저는 WebRTC에 추가한 것과 같은 local `MediaStream`을 Web Audio 기반 bounded recorder에 연결한다.
2. recorder는 세션 전체 파일 하나를 만들지 않고 짧은 chunk를 메모리 ring buffer에 유지한다.
3. `input_audio_buffer.speech_started`에서 새 turn capture를 열되, 서버 왕복 때문에 첫 음절이 잘리지 않도록 짧은 pre-roll을 포함한다.
4. `input_audio_buffer.speech_stopped`와 대응 input item 확정 뒤 post-roll을 포함해 해당 turn만 닫는다.
5. completion event의 `item_id`와 로컬 turn ID를 결합해 보정 요청을 보낸다. 서로 다른 턴 completion이 뒤바뀌어도 순서로 매핑하지 않는다.
6. 첫 구현은 브라우저에서 16kHz mono PCM WAV를 직접 만든다. 서버는 `audio/wav | audio/x-wav`만 받고 RIFF/WAVE 구조와 실제 audio format을 다시 검사한다. 향후 다른 컨테이너를 열기 전에는 해당 브라우저·Pi decoder와 독립 턴 경계를 별도 인수한다.
7. V4-B는 짧은 턴만 대상으로 한다. 서버가 정한 duration·byte 상한을 넘으면 자동 분할기를 만들지 않고 `전사 확인 필요`로 fail-close한다. 장시간 강의 녹음은 별도 강의 노트 설계를 따른다.

초기 구현 권장값은 제품 계약이 아니라 테스트 시작점으로 `250ms` 안팎 recorder chunk, `500ms` 안팎 pre-roll, `300ms` 안팎 post-roll, 사용자 발화 최대 `120초`, 업로드 최대 `8MB`다. 실제 iPhone에서 첫·끝 음절 손실과 파일 크기를 측정한 뒤 조정한다. OpenAI file transcription의 provider 상한은 현재 25MB지만 갈피 서버 상한을 그보다 작게 둔다.[^file-transcription]

보정 요청은 session별로 직렬화하고 완료된 audio blob 대기열을 bounded하게 둔다. 초기 테스트 상한은 미처리 3턴이다. 네 번째 턴을 조용히 무기록으로 진행하지 않고 local mic track을 잠시 mute해 `기록 정리 중`을 표시한 뒤 backlog가 줄면 다시 듣는다. 실제 보정 지연을 측정해 상한을 조정하되 무한 queue와 무제한 메모리 보관은 허용하지 않는다.

#### 보정 요청과 임시 오디오 수명

첫 구현은 전용 인증 route 하나로 제한한다.

```text
POST /api/voice/realtime/turns/:turnId/transcribe
  auth: 기존 API token
  body: multipart audio + session_id + input_item_id
  server-owned: model, prompt/keywords/language hints, timeout, size/duration cap
  result: corrected transcript + model + usage + receipt state
```

- 클라이언트가 model, 저장 목적, message ID, task payload를 임의로 정하지 못한다.
- session 응답이 돌려준 별도 correction session ID만 받고, 세션에 속하지 않는 turn/item 조합을 거절한다. read tool session과 수명은 같지만 권한과 저장소는 분리한다.
- 같은 `(session_id, input_item_id, audio_sha256)` 재시도는 기존 결과를 반환한다. 같은 item ID에 다른 audio hash가 오면 자동 덮어쓰지 않고 충돌로 남긴다.
- session별 보정 provider 호출은 동시 1개로 제한한다. client retry와 server retry가 같은 audio를 동시에 이중 과금하지 않도록 receipt 생성과 호출 lease를 원자적으로 잡는다.
- 표준 OpenAI API 키는 계속 Pi 서버에만 둔다.
- 보정 model은 `OPENAI_REALTIME_CANONICAL_TRANSCRIPTION_MODEL` 같은 별도 exact ID로 고정하고 초기값은 `gpt-transcribe`로 한다. 현재 보조 자막용 `OPENAI_REALTIME_TRANSCRIPTION_MODEL=gpt-4o-mini-transcribe`와 분리한다.
- 첫 구현은 `languages[]=ko,en`만 사용한다. prompt·keywords는 고유명사 정확도를 보조할 수 있지만 실제로 말하지 않은 단어를 삽입할 위험도 있으므로 실기기 표본 없이 넣지 않는다. 나중에 열 때도 최근 대화 전체가 아니라 검증된 bounded 용어만 사용한다.[^file-transcription]

오디오는 가능한 한 브라우저 메모리 → bounded 서버 메모리 → OpenAI 업로드로 통과시키고 파일시스템에 쓰지 않는다. 사용하는 multipart/SDK가 임시 파일을 요구할 경우에만 아래 보조 경계를 적용한다.

- 지정된 Galpi 음성 temp root 아래에 추측 불가능한 이름과 exclusive create로 만든다.
- DB·Vault·`GALPI_DATA_DIR`의 backup 대상 경로 밖에 둔다.
- 성공, provider 실패, client 취소, timeout의 모든 경로에서 `finally` 삭제한다.
- process crash로 남은 파일은 시작 시와 주기적 TTL sweeper가 삭제한다.
- 파일명·로그·오류 응답에는 transcript, 사용자 발화, API 키를 넣지 않는다.
- cleanup 실패는 성공 응답으로 숨기지 않고 최소 진단과 운영 알림을 남기되, 오디오 내용을 로그에 쓰지 않는다.

현재 R2b는 browser와 server가 모두 메모리만 사용한다. 브라우저 chunk는 보정 응답 수신, 세션 종료, 페이지 이탈, 연결 오류 중 가장 먼저 발생한 시점에 해제하고 진행 중 요청을 abort한다. Pi가 multipart를 완전히 받은 뒤 연결이 끊기면 provider 호출은 끝날 수 있지만, R2c durable receipt가 없으므로 결과를 복구·저장하지 않는다. 업로드가 끝나기 전에 끊기면 해당 턴은 보정되지 않는다.

#### receipt와 exactly-once finalization

R2 schema는 기존 `messages`를 크게 바꾸지 않고 작은 additive `realtime_turn_receipts` 테이블을 둔다. 구현 전 migration에서 기존 schema 스타일과 foreign key를 맞추되 최소 필드는 아래 의미를 충족해야 한다.

|필드|의미|
|---|---|
|`id`|갈피 내부 opaque receipt ID|
|`session_id`|갈피가 만든 음성 session ID|
|`input_item_id`|OpenAI user audio conversation item ID|
|`final_response_id`|정상 완료된 최종 spoken response ID, 없을 수 있음|
|`audio_sha256`|재시도·충돌 대사용 hash, 원본 오디오 대체물이 아님|
|`status`|아래 turn state|
|`corrected_transcript`|보정 성공 또는 사용자 수정 뒤의 정본 후보|
|`transcript_origin`|`stt_corrected | user_edited`|
|`transcription_model`|실제 resolved 보정 model|
|`assistant_transcript`|정상 완료된 최종 assistant text, partial 제외|
|`user_message_id` / `assistant_message_id`|finalization 뒤 기존 message 연결|
|`usage_json`|숫자형 보정 STT usage만 저장, 원문·오디오 없음|
|`error_code`|내용 없는 bounded 진단 코드|
|`created_at` / `updated_at` / `finalized_at`|KST가 아니라 기존 DB timestamp 규칙을 따르는 lifecycle 시각|

최소 unique 경계는 `(session_id, input_item_id)`와, 값이 있을 때의 `final_response_id`다. receipt는 operation metadata이며 topic 회수·memory·Codex 입력에서 제외한다. provisional transcript 원문은 durable receipt에 복사하지 않고 브라우저 메모리에만 둔다.

```text
capturing
  → correction_pending
  → corrected
  ├ assistant_pending
  └ ready_to_finalize
       → finalized

correction_pending
  → correction_failed
  → needs_review
      ├ user_edited → ready_to_finalize
      ├ retry → correction_pending
      └ discard → discarded

assistant streaming
  → completed
  → interrupted
  → failed
```

- `capturing`, `partial`, `provisional`은 브라우저 휘발 상태다.
- 서버 receipt는 오디오 업로드를 받으며 `correction_pending`부터 시작한다.
- 정상 assistant transcript가 먼저 도착하면 receipt에서 기다리고, 보정본이 먼저 도착하면 assistant completion을 기다린다.
- 두 조건이 모이면 한 DB transaction에서 기존 `messages` 두 행과 receipt message ID를 함께 확정한다.
- 같은 요청·event·재연결을 다시 받아도 이미 연결된 message ID를 반환한다.
- assistant가 interrupted/failed이면 corrected user만 한 번 저장하고 assistant ID는 비운다. partial text는 receipt에도 durable 본문으로 남기지 않는다.
- page refresh 뒤 `correction_pending | needs_review` receipt는 상태만 다시 조회할 수 있다. 자동으로 rough transcript를 복원하거나 저장하지 않는다.

#### 보정 실패와 사용자 수정

보정 STT 실패는 라이브 대화 실패와 다르다. 사용자는 이미 시온의 답변을 들었을 수 있으므로 세션 자체를 강제 종료하지 않는다.

- 화면에는 임시 자막을 유지하되 `기록 확인 필요`로 분명히 표시한다.
- `다시 전사`, `직접 수정`, `기록 안 함`만 제공한다.
- 직접 수정한 텍스트는 `user_edited` origin으로 정본이 될 수 있다.
- 사용자가 아무 행동도 하지 않으면 해당 user/assistant 턴은 `shared-main`에 들어가지 않는다.
- 보정이 늦게 끝나 provisional과 materially 달라도 화면 사용자 문장만 교체하고, 이미 들은 assistant 답변은 다시 생성하지 않는다.
- 세션 종료 시 unresolved turn이 있으면 조용히 버리지 않고 개수와 상태를 보여준다. 다만 원본 오디오 TTL을 늘려 장기 보관하지는 않는다.

#### 일정·메모

- `schedule_prepare`는 provisional transcript가 아니라 corrected/user-edited transcript만 입력으로 받고 기존 validator로 무저장 후보만 만든다.
- 채팅 확인 카드의 `등록`만 기존 task API를 같은 request ID로 호출한다.
- 취소·카드 닫기·세션 종료는 task write 0회다.
- 메모도 transcript를 곧바로 topic에 넣지 않고 수정 가능한 후보로 보여준 뒤 기존 manual 저장 경로로 보낸다.
- Realtime tool dispatcher에는 task 생성, 노트 append, 정책 변경, Codex 실행 같은 직접 쓰기 함수를 등록하지 않는다.

아래 내용은 전사 보정과 별개로 항상 확인한다.

- 날짜·시각·시간대·반복·알림
- 금액·수량·전화번호·계좌·티커·영숫자 식별자
- 사람·장소·노트 제목 같은 고유명사
- 메모/할 일의 저장 목적과 대상
- 외부 전송·게시·구매·삭제·거래처럼 실제 상태를 바꾸는 행동

Realtime은 확인 전에 “7월 31일 오후 3시로 들었어. 등록할까?”처럼 되물을 수 있다. 실제 후보 payload와 카드에는 반드시 보정본을 사용하고, 카드 수정 뒤 최종 canonical payload를 같은 request ID로 기존 API에 보낸다. 보정본은 Realtime의 이미 끝난 이해를 소급 변경하지 않으므로 이 확인 루프를 생략하지 않는다.

#### 자동 저장

- DB의 완료 대화 보존과 Obsidian 지식 저장을 분리한다.
- 보정 완료된 Realtime 대화는 처음에는 `inbox` source로 분류해 topic 자동 저장에서 제외한다.
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

### 역할별 모델 고정

R2는 “최신 음성 모델 하나”에 세 역할을 모두 맡기지 않는다.

|역할|초기 exact model|변경 규칙|
|---|---|---|
|대화·VAD·끼어들기·음성 출력|`gpt-realtime-2.1-mini`|Cedar·말투 보정 실기기 확인 뒤에도 품질이 부족할 때만 full `gpt-realtime-2.1` 별도 A/B|
|Realtime 보조 자막|`gpt-4o-mini-transcribe`|화면 자막/turn 매핑 품질 관찰 뒤 별도 변경, 저장 정본 권한 없음|
|턴 저장 정본·명시적 정밀 전사|`gpt-transcribe`|실제 한·영·고유명사 fixture에서 검증한 exact model만 승격|

`gpt-live-transcribe`는 마이크·통화처럼 아직 들어오는 오디오의 독립 실시간 전사용 권장 모델이다. 현재 Realtime 대화는 이미 보조 자막을 받고 있고, 갈피가 필요한 것은 턴이 끝난 뒤의 bounded 정본이므로 R2 첫 구현에 별도 live transcription 세션을 하나 더 열지 않는다. `gpt-transcribe`를 Realtime transcription session에서 committed turn 용도로 쓰는 공식 경로는 WebSocket을 요구하므로, 현재 WebRTC 대화 연결을 바꾸지 않고 bounded file transcription을 사용한다.[^realtime-transcription][^file-transcription]

현재 full `gpt-realtime-2.1`은 mini보다 공식 audio token 단가가 input·output 모두 3.2배다. 모델 업그레이드는 “더 최신이니까”가 아니라 동일 실기기 문장·발음·도구 fixture에서 체감 이득이 비용 차이를 정당화할 때만 한다.[^pricing]

full 모델을 시험할 경우 reasoning effort는 먼저 `low`로 명시한다. OpenAI의 최신 Realtime migration 지침도 기본 대신 `low`부터 시작하고 깊은 계획이 필요한 workflow에서만 높이라고 권한다. 높은 effort는 지연과 output token 사용량을 늘릴 수 있다.[^realtime-prompting][^realtime-full]

일상 음성 대화의 복잡한 질문을 전부 기존 `/api/chat`에 다시 위임하지 않는다. 실제 사용에서 Realtime의 답변 깊이 부족이 반복 관찰될 때만 읽기 전용 `deep_answer` tool 하나를 별도 설계한다. 그 도구는 기존 GPT Responses 결과를 bounded text로 반환할 뿐 대화 메시지·topic을 중복 저장하거나 task 쓰기를 실행하지 않아야 한다. 웹·논문 read tool parity와 함께 관찰 근거 뒤에 연다.

### VAD·voice·별도 TTS 판단

현재 운영 baseline은 브라우저 `echoCancellation`, `noiseSuppression`, `autoGainControl`에 Realtime 서버 측 `audio.input.noise_reduction: { type: "near_field" }`를 겹치고, 턴 판정은 `semantic_vad`, `eagerness: auto`, `create_response: true`, `interrupt_response: true`를 유지하는 것이다. OpenAI는 input noise reduction이 입력 audio buffer의 오디오를 VAD와 모델에 보내기 전에 처리하며, 필터가 VAD·턴 판정의 false positive를 줄일 수 있다고 명시한다.[^realtime-noise-reduction] semantic VAD는 단순 silence 길이 대신 발화 내용상 끝났을 확률을 보고, `auto`는 `medium`과 같다.[^realtime-vad]

이 조합의 역할과 한계는 다음과 같이 분리한다.

- 브라우저 오디오 제약은 기기에서 echo와 일반적인 배경 소음을 먼저 줄인다.
- Realtime `near_field`는 가까이 두고 말하는 iPhone·개인 마이크 입력을 서버에서 한 번 더 정리한 뒤 VAD와 모델에 전달한다. 휴대폰을 책상 멀리 두는 speakerphone 사용이 주 사용법으로 바뀌면 `far_field`를 별도 실기기 표본으로 비교하고, 기기 종류만 보고 자동 전환하지 않는다.
- `semantic_vad`의 `eagerness`는 사용자가 발화를 끝냈는지 기다리는 정도를 조절한다. 헛기침·알림음을 speech start로 오인하는 문제를 해결하려고 `low`로 바꾸지 않는다.
- `interrupt_response: true`는 실제 사용자의 자연스러운 끼어들기를 즉시 반영하지만, VAD false positive도 진행 중 응답을 취소할 수 있다. noise reduction 뒤에도 오중단이 반복될 때만 이 경계를 다시 연다.
- noise reduction은 음향 필터이지 헛기침·알림음 전용 sound-event classifier가 아니다. 헛기침처럼 사람 발성과 유사하거나 가까이서 크게 난 알림음은 남을 수 있으므로 “잡음에서 절대 중단하지 않음”을 계약하지 않는다.
- 별도 모델 호출이나 클라이언트 오디오 업로드 경로를 추가하지 않는다. R2b 보정용 bounded recorder의 원본 `MediaStream`과 receipt 순서도 바꾸지 않는다.

- 문장 중간에 자주 끊기면 먼저 실제 소음·마이크·발화 표본을 확인하고 `low`를 시험한다.
- 응답 시작이 계속 늦고 사용자가 명확하게 짧게 말한다면 `high`를 제한적으로 시험한다.
- Realtime 2.1은 이전 2보다 silence/noise와 interruption behavior가 개선됐으므로, 자체 VAD를 추가하기 전에 현재 모델과 설정을 먼저 평가한다.[^realtime-full]
- `speech_started/stopped`는 라이브 턴과 recorder 경계의 신호지만 그 자체가 정본 transcript는 아니다.

`near_field`의 실기기 인수는 같은 iPhone·같은 출력 음량에서 아래 네 묶음을 연속으로 확인한다.

1. 시온이 말하는 동안 헛기침 5회: 응답이 오중단되는 횟수와 잘못 생긴 사용자 턴을 기록한다.
2. 시온이 말하는 동안 실제 알림음 5회: 응답 오중단과 불필요한 보정 전사 요청 여부를 기록한다.
3. 시온이 말하는 동안 “잠깐”, “아니”, 완전한 새 질문 등 실제 끼어들기 5회: 음성이 자연스럽게 멈추고 새 턴으로 이어지는지 확인한다.
4. 평소보다 작은 목소리와 평소 목소리 각 5회: 첫 음절 손실, 미감지, 응답 시작 지연이 기존보다 나빠지지 않는지 확인한다.

잡음 표본의 목표는 오중단 0회지만, 작은 목소리 미감지나 실제 끼어들기 실패가 생기면 잡음 억제 성공만으로 GO하지 않는다. `near_field` 뒤에도 오중단이 반복되면 다음 비교 후보는 `server_vad`의 더 높은 `threshold`다. OpenAI는 높은 threshold가 더 큰 소리를 요구해 noisy environment에서 나을 수 있다고 설명하지만,[^realtime-vad] 이 전환은 semantic turn ending을 포기하고 작은 목소리를 놓칠 수 있으므로 자동 fallback이나 기본값으로 넣지 않는다. `interrupt_response: false`와 애플리케이션 확인 뒤 수동 `response.cancel`은 더 강한 최후 후보지만 즉시 barge-in 지연과 별도 발화 판별 로직이 필요해 현재 범위 밖이다.

2026-07-31 실기기 표본 결과는 다음과 같다. 알림음 5회는 오중단 0회였다. 의도한 끼어들기 5회는 모두 정상 동작했고, 작은 목소리와 평소 목소리 각 5회에서 첫 음절 손실·미감지·응답 지연이 기존보다 나빠지지 않았다. 따라서 위 문단이 실격 조건으로 정한 작은 목소리 미감지와 실제 끼어들기 실패는 발생하지 않았다.

헛기침 오중단은 단일 비율로 적을 수 없다. **마이크 거리에 강하게 의존한다.** 휴대폰을 얼굴 가까이 들면 5회 중 5회에 가깝게 오중단하고, 팔을 뻗어 멀리 두면 5회 중 0회에 가깝다. 최초 보고한 약 1/5은 중간 자세에서 나온 값이며 이 수치만 단독으로 인용하면 안 된다. 사용자는 평소 사용 자세에서는 크게 불편하지 않다고 평가했지만, 가까이 드는 자세에서는 사실상 매 턴 끊기므로 잔존 결함의 크기를 과소평가하지 않는다. 또한 Realtime 모델 자체는 해당 소리를 기침으로 인식한다. 즉 실패 지점은 모델의 이해가 아니라 VAD의 턴 종료·끼어들기 판정이다.

이 상태를 조건부 인수로 남기고 `server_vad` threshold 비교는 아직 열지 않는다. 현재 건강한 작은 목소리 감지와 semantic turn ending을 맞바꾸는 거래이기 때문이다. 다만 거리 의존성의 원인은 아직 가르지 못했다. `near_field`가 가까운 입력의 헛기침을 오히려 또렷한 speech로 정리하는 것인지, 단순히 근접 음압이 커서 어떤 필터로도 VAD를 넘는 것인지 구분할 표본이 없다. 원인 판별은 같은 거리에서 `near_field`·`far_field`·비활성을 비교하는 별도 표본으로 다루고, 추측으로 설정을 바꾸지 않는다. 이 작업은 R2c와 독립이므로 순서를 나눈다.

같은 표본에서 헛기침이 오중단을 일으킬 때 사용자 턴이 함께 생성되는 것을 확인했다. 실측된 corrected transcript는 빈 문자열과 `하...`, `그`, `음`, `흥.`, `음.` 같은 짧은 필러·의성어였고, 비음성 구간에서 흔히 보고되는 긴 상투구 hallucination은 관찰되지 않았다. 이는 R2c의 저장 경계에 직접 영향을 준다. R2c는 이런 턴을 `shared-main`에 저장하지 않아야 하며, 그렇지 않으면 위 거리 의존 비율만큼 쓰레기 사용자 턴이 영구 대화 기록에 쌓이고 `shared-main` 최근 완료 쌍을 통해 다음 세션 컨텍스트까지 오염시킨다. 이 필터는 provisional transcript가 아니라 corrected transcript를 기준으로 판정하고, 판정에서 제외된 턴은 assistant `incomplete`와 마찬가지로 거짓 `final`로 승격하지 않는다.

기본 voice는 현재 Cedar다. Cedar와 Marin은 공식 품질 권장 voice지만 성별 label은 제공되지 않으므로 “남자 음성”을 제품 계약으로 쓰지 않는다. 사용자가 듣기에 남성적으로 느껴지는지, 한국어 억양·발음·친근한 말투가 맞는지를 실제 기기에서 평가한다. 한 세션에서 audio response가 한 번 나온 뒤 voice를 바꾸지 않고, 선택 변경은 새 세션부터 반영한다.[^realtime-conversations][^realtime-voices]

별도 TTS는 다음 조건을 모두 만족할 때만 설계한다.

1. Cedar와 Marin, mini와 full의 동일 문장 실기기 비교 뒤에도 목소리가 제품 핵심을 훼손한다.
2. 개선하려는 문제가 답변 내용·한국어 문장·메모리 문맥이 아니라 합성 음색·억양임이 분리돼 있다.
3. 첫 음성 지연, 문장 버퍼링, 사용자 발화 시 TTS stream 취소, 실제 재생된 위치와 conversation truncation을 갈피가 직접 관리할 비용을 감수한다.

별도 TTS를 붙이면 Realtime WebRTC가 자동 처리하던 미재생 audio truncation을 그대로 얻지 못한다. 그러므로 R2 보정 전사와 session rotation보다 먼저 구현하지 않는다.

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
- item ID별 Realtime completion이 partial을 `provisional` 자막으로 교체한다.
- R2에서는 `provisional` 옆에 `기록 보정 중` 상태를 표시하고, `gpt-transcribe` 성공 뒤 같은 말풍선 텍스트를 `corrected`로 교체한다.
- 보정이 실패하면 `기록 확인 필요`와 `다시 전사 | 직접 수정 | 기록 안 함`을 제공한다. 임시본을 정상 저장된 것처럼 보이지 않게 한다.
- 중복·순서 역전 event는 item/response ID로 대사한다.
- 끼어들기로 취소된 assistant partial은 흐리게 폐기하거나 즉시 제거하며 완료 메시지로 보이지 않게 한다.

```text
사용자 UI
듣는 중…
  → 임시 자막
  → 기록 보정 중
  → 보정 완료

실패 시
기록 확인 필요
  → 다시 전사
  → 직접 수정
  → 기록 안 함
```

보정 때문에 다음 Realtime 응답 재생을 막지 않는다. UI는 라이브 대화와 기록 finalization을 서로 다른 상태로 보여주며, 아직 보정 중인 턴이 있어도 다음 발화·끼어들기는 계속 가능하다. 단, 일정·메모 같은 쓰기 후보는 해당 턴의 보정이 끝나기 전 생성하지 않는다.

### 6.4 R2 연속 대화와 세션 교체

현재 5분 hard cap은 R0·R1의 비용·cleanup 인수용 제한이다. R2가 완료 대화를 `shared-main`에 정확히 한 번 저장하게 되면 사용자에게 보이는 5분 강제 종료는 없앤다.

OpenAI Realtime 단일 세션의 공식 최대 시간은 현재 60분이다.[^realtime-session-duration] 따라서 “무제한 대화”는 하나의 WebRTC 연결을 영구 유지한다는 뜻이 아니라, 내부 세션을 안전하게 교체하면서 사용자에게 하나의 연속 대화처럼 보이는 제품 계약이다.

1. 운영 기본은 공식 한도보다 여유 있는 50~55분 안에서 새 세션을 준비한다. 정확한 교체 시점은 실제 reconnect 지연과 비용을 측정한 뒤 고정한다.
2. 교체는 assistant 응답·tool call이 끝난 턴 경계에서만 한다. 진행 중 audio, partial transcript, 미완료 function call을 다음 세션의 완료 기록처럼 넘기지 않는다.
3. 새 세션은 `shared-main`의 bounded 최근 완료 suffix와 현재 말투 프로필을 다시 읽고, 사실 기억·활성 일정은 기존 read tool로 필요할 때 조회한다. 전체 대화 원문이나 원본 오디오를 재전송하지 않는다.
4. 정상 교체 직전 완료 턴을 idempotent하게 반영하고, 새 세션 첫 응답 전에 같은 receipt를 다시 확인해 중복 저장을 막는다.
5. 교체 실패 시 짧은 재연결 상태를 표시하고 텍스트 채팅을 유지한다. 무한 자동 재시도는 하지 않는다.
6. 대화 중에는 시간 때문에 끊지 않지만, 장시간 무음·페이지 이탈·화면 잠금·네트워크 단절에는 별도 idle cleanup을 유지한다. idle 시간은 실사용 비용을 본 뒤 정하며 현재 5분 hard cap과 같은 값으로 고정하지 않는다.

R1은 완료 대화 정본이 없으므로 세션 자동 교체를 먼저 붙이지 않는다. R2의 corrected-only 저장과 idempotency receipt가 선행 조건이다.

---

## 7. 보안·비용·장애 경계

### 보안

- 표준 OpenAI API 키는 Pi `.env`와 서버 요청에만 존재한다.
- `/api/voice/realtime/session`은 기존 갈피 인증, rate limit, 허용 Content-Type, SDP body 상한을 적용한다.
- session config의 model, instructions, tools, voice, token·시간 상한은 서버가 만든다. 브라우저가 임의의 tool이나 모델을 추가하지 못한다.
- tool arguments는 기존 schema validator로 재검증하고, server allowlist 밖 이름은 거부한다.
- R2 보정 route는 인증, session/item 소유권, MIME sniffing, duration·byte 상한, request timeout, audio hash 충돌을 서버에서 검증한다.
- 보정 audio와 provisional transcript는 로그·trace·analytics·오류 응답에 넣지 않는다.
- `realtime_turn_receipts`는 topic·memory·Codex·일반 검색에서 제외하고 finalization 운영 메타데이터로만 사용한다.
- 노트·웹·논문·일정 내용은 데이터이며 session instruction을 덮는 명령으로 취급하지 않는다.
- 음성으로 들은 지시만으로 외부 행동·파일 수정·정책 변경·매매를 실행하지 않는다.

### 비용

- Realtime은 ChatGPT 구독 한도가 아니라 기존 `OPENAI_API_KEY`의 OpenAI API Billing으로 과금된다.
- R0·R1은 세션당 5분 hard cap을 두고 자동 재연결하지 않는다.
- R2는 사용자에게 보이는 5분 제한을 제거하되, 60분 provider 한도 전의 bounded session rotation과 장시간 무음 cleanup을 둔다.
- max output과 도구 호출 횟수에 코드 상한을 둔다.
- 사용자 자막용 input transcription과 R2 보정 transcription은 Realtime 본체와 별도 사용량이다. 각각 item/receipt ID로 중복 없이 숫자만 대사한다.
- R2 전에는 OpenAI Billing과 R0 실행 횟수로 비용을 확인하고, R2에서는 `response.done` Realtime usage, input ASR usage, `gpt-transcribe` usage를 서로 다른 항목으로 기록한다.
- 2026-07-30 공식 가격 snapshot에서 `gpt-4o-mini-transcribe` 추정치는 분당 `$0.003`, `gpt-transcribe`는 분당 `$0.0045`다. 따라서 실제 발화 60분을 두 번 전사하면 자막 약 `$0.18` + 보정 약 `$0.27` = 약 `$0.45`의 추가 STT 비용이다. 이는 세션 wall-clock이 아니라 실제 처리 음성량의 단순 추정이며 Realtime audio token 비용은 별도다.[^pricing]
- 같은 snapshot에서 `gpt-realtime-2.1-mini` audio는 1M token당 input `$10`, output `$20`, full `gpt-realtime-2.1`은 input `$32`, output `$64`다. cached input과 text token 가격은 별도다.[^pricing]
- 가격 숫자는 운영 예산의 영구 상수가 아니다. 구현·배포 시 공식 가격표를 다시 확인하고, 앱에 잔액 조회 자격증명이나 Console 쿠키를 저장하지 않는다.
- 보정 요청은 사용자 발화가 끝난 턴에만 한 번 수행한다. silence, assistant audio, 취소되어 내용이 없는 capture, 같은 audio hash 재시도에는 새 과금을 만들지 않는다.

### 장애

- 세션 생성 실패: 텍스트 채팅과 정밀 전사 경로는 계속 사용 가능해야 한다.
- data channel 오류: 미완료 transcript와 response를 저장하지 않고 media를 정리한다.
- tool timeout: 최대 횟수 뒤 read-only tool 실패를 음성으로 알리고 턴을 종료한다.
- 보정 STT timeout/5xx/rate limit: 라이브 대화는 유지하고 receipt를 `needs_review`로 바꾼다. provisional transcript 자동 저장은 금지한다.
- 보정 결과가 빈 문자열·신뢰 불가 언어·상한 초과: 사용자 수정·재시도·폐기만 허용한다.
- 서로 다른 음성 hash가 같은 item ID를 주장: overwrite하지 않고 conflict로 막는다.
- assistant completion이 보정보다 먼저 도착: receipt에서 기다린 뒤 한 번만 finalization한다.
- 보정이 먼저 도착하고 assistant가 interrupted: corrected user만 저장하고 partial assistant는 폐기한다.
- page close: 업로드 완료 전이면 미저장, 완료 뒤면 서버 receipt가 보정을 끝낼 수 있다. 다음 접속에서 pending/review 상태만 복원한다.
- process crash: temp audio TTL sweeper와 receipt state로 복구하되 미완료 턴을 완료로 승격하지 않는다.
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

lib/realtime-transcription.js         # R2
  - bounded audio validation
  - gpt-transcribe provider adapter
  - timeout·usage·최소 오류 코드
  - 메모리 우선 처리와 필요 시 temp cleanup

lib/realtime-turn-store.js            # R2
  - corrected-only/idempotent message 반영
  - interrupted response 폐기
  - realtime_turn_receipts

public/voice-realtime.js
  - RTCPeerConnection·media track·data channel
  - 상태 머신·transcript reconciliation
  - 같은 MediaStream의 bounded turn recorder
  - partial → provisional → corrected UI
  - 시작·mute·종료·오류 정리

server.js
  - 인증된 session/tool/transcription route와 의존성 주입만
```

R0에서는 `realtime-tool-dispatcher`와 `realtime-turn-store`를 만들지 않았다. R1에서 dispatcher만 추가했고, R2에서 transcription과 turn store를 필요한 순서로 추가한다. MediaRecorder 세부 구현, provider adapter, receipt transaction을 `server.js`에 직접 쌓지 않는다.

### R2 내부 구현 순서

1. **R2a receipt·상태 reconciliation — Pi 인수 완료**
   - audio upload나 message write를 열지 않았다.
   - synthetic partial/provisional/completed/interrupted event를 item/response ID로 대사한다.
   - duplicate·out-of-order·tool-only response fixture를 고정했고 집중 15/15·전체 226/226을 통과했다.
   - 현재 receipt는 브라우저 메모리에만 존재한다. R2c의 영구 exactly-once receipt와 이름은 같아도 권한·수명·저장 책임이 다르다.
2. **R2b bounded turn recorder·보정 route — Pi 기술 인수 완료, 실기기 품질 확인 대기**
   - 같은 mic stream에서 500ms pre-roll·300ms post-roll을 가진 16kHz mono PCM WAV를 만들고 `gpt-transcribe`를 호출한다.
   - 120초·8MB, pending 3개, provider 30초 timeout, session 직렬화와 같은 audio 멱등성을 서버에서 집행한다.
   - 성공·실패·취소·page close·process restart의 browser/server 메모리 cleanup을 인수했다. temp file은 만들지 않는다.
   - 이 단계도 `messages`, topic, task, retrieval trace write는 0회다.
   - 로컬 집중 23/23·전체 234/234, Pi 집중 23/23·전체 230/230과 재시작 뒤 config·정적 hash·DB/Vault 불변을 통과했다.
3. **R2c corrected-only finalization**
   - receipt unique 경계와 한 transaction의 user/assistant message 반영을 연다.
   - failure에서 provisional fallback이 생기지 않는지 확인한다.
   - R2c-1은 schema v10 receipt·exactly-once 저장·빈 턴 필터까지만 열고, `다시 전사`·`직접 수정`·`기록 안 함` UI는 R2c-2로 분리한다. 한 diff를 작게 유지해 첫 쓰기 배포의 원인 추적을 쉽게 한다.
   - flag는 `OPENAI_REALTIME_FINALIZE_ENABLED`이고 코드 기본값은 `false`다.

##### R2c-1 저장 경계

`realtime_turn_receipts`의 `assistant_status`는 위 표의 3값 대신 `response.done.status`의 `completed | cancelled | failed | incomplete` 4값을 그대로 보존한다. R2b가 이미 이 4값을 분리해 표시하므로 3값으로 접으면 실제 끼어들기와 길이 초과 중단이 뭉개져 사후 원인 추적이 불가능해진다. `messages`의 assistant 행은 `completed`일 때만 만든다.

finalization은 `corrected_transcript`와 `assistant_status`가 모두 도착한 뒤 한 transaction에서 실행한다. 이미 `finalized`면 기존 message ID를 그대로 반환하고 재삽입하지 않는다. user 행을 assistant 행보다 먼저 삽입해 `messages.id` 순서를 보장한다. 기존 과거 대화 검색이 답변을 `id > user_id`로 찾으므로 순서가 뒤집히면 엉뚱한 답변이 결합된다. 임베딩은 transaction 커밋 뒤 기존 20자 가드 경로를 그대로 재사용한다.

빈·무의미 사용자 턴 필터는 아래 두 갈래로만 제외하고, 제외된 receipt는 `status = 'discarded'`에 `error_code = 'empty_turn'`을 남긴다. 사용자가 명시적으로 고른 `기록 안 함`과 같은 상태를 쓰되 원인을 구분해 필터 발동 빈도를 셀 수 있게 한다.

1. 문장부호·공백을 제거한 뒤 빈 문자열이면 assistant 상태와 무관하게 제외한다.
2. 실질 문자가 2자 이하이고 필러·의성어 집합에 속하며 `assistant_status`가 `completed`가 아니면 제외한다.

두 번째 갈래에 `assistant_status` 조건을 넣는 이유는 텍스트만으로 헛기침과 유효한 짧은 대답을 가를 수 없기 때문이다. false interruption은 정의상 진행 중인 응답을 끊으므로 정상 완료 assistant가 없고, 사용자의 실제 짧은 대답에는 `completed` 응답이 따른다. 필러 집합에 없는 `잠깐` 같은 실제 끼어들기는 `cancelled`여도 저장한다. 이 필터는 `messages` 행 생성을 막는 것이 목적이며, 검색 오염은 기존 20자 임베딩 가드가 2차 방어선으로 남는다.
4. **R2d 일정·메모 확인**
   - corrected transcript만 기존 `schedule_prepare`와 manual memo 후보에 전달한다.
   - 후보 전 write 0회, 등록/저장 뒤 exactly-once를 확인한다.
5. **R2e session rotation**
   - finalization이 안정된 뒤에만 5분 사용자 제한을 제거한다.
   - 먼저 짧게 강제한 rotation fixture로 중복·누락을 잡고, 그 뒤 50~55분 운영 경계를 확정한다.

각 단계를 별도 feature flag와 Pi 백업·회귀·실기기 인수 뒤 승격한다. R2a~R2d를 한 diff로 묶지 않는다.

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
- [x] 실기기에서 활성 일정 조회와 `시` 노트 탐색·읽기가 동작한다.
- [ ] 활성 일정 표본이 현재 task 정본과 일치하고 closed/deleted를 실시간 일정으로 섞지 않는지 fixture와 대조한다.
- [x] 로컬 dispatcher에서 도구는 턴당 2회·8,000자·timeout 상한을 넘지 않는다.
- [x] 등록·완료·취소·노트 저장·Codex 실행 tool이 session config에 없다.
- [ ] R1 질문 전후 DB·Vault·task가 불변이다.
- [ ] Cedar 재시작 뒤 한국어·영어·code-switch에서 문장·말투·발음 체감을 기록하고 텍스트 `shared-main`과 호칭·말투가 어긋나지 않는지 확인한다.

### R2 GO

- [ ] partial·provisional transcript가 `messages`, topic, memory, task에 정본으로 저장되는 경로가 0개다.
- [ ] 완료된 음성 user/assistant 턴 10개가 보정 transcript로 `shared-main`에 각각 정확히 한 번 저장된다.
- [ ] 같은 session/item/audio hash와 같은 response event를 세 번 재전송해도 message·receipt·사용량이 중복되지 않는다.
- [ ] 서로 다른 턴의 transcription completion 순서를 뒤집어도 `item_id` 기준으로 올바른 말풍선·receipt에 연결된다.
- [ ] 보정 provider를 느리게 만든 fixture에서 backlog 상한 뒤 새 턴이 무기록으로 진행되지 않고 `기록 정리 중` backpressure와 mic 복원이 동작한다.
- [ ] 끼어든 assistant 응답 5개의 partial transcript가 일반 assistant 메시지로 저장되지 않는다.
- [ ] assistant가 끊긴 5개 턴에서 corrected user만 남고 가짜 assistant 완료 문장이 생기지 않는다.
- [ ] `gpt-transcribe` timeout·429·5xx·빈 결과·audio 상한 초과 각각에서 provisional fallback 저장 0회, `needs_review`만 남는다.
- [ ] 실패 턴을 직접 수정하면 `user_edited` origin으로 한 번만 저장되고, `기록 안 함`이면 message write 0회다.
- [ ] 일정 음성 요청은 확인 카드 전 task write 0회, 취소 0회, 등록 시 같은 request ID로 정확히 1회 생성된다.
- [ ] 메모 transcript는 수정·확인 전 topic·memory에 들어가지 않는다.
- [ ] 일반 대화·일정·메모에서 사용자가 화면에서 본 최종 사용자 텍스트와 저장된 정본이 일치한다.
- [ ] 성공·provider 실패·사용자 취소·page close·Pi process crash 뒤 원본 오디오가 DB·Vault·backup에 0개이고 temp root에도 TTL 이후 0개다.
- [ ] session/response, input ASR, correction STT usage가 서로 구분되어 중복 없이 숫자로 대사되고 hard cap 뒤 새 응답이 생성되지 않는다.
- [ ] 짧게 강제한 rotation 테스트에서 완료 턴 10개가 중복·누락 없이 이어지고 partial·미완료 tool call은 승계되지 않는다.
- [ ] 운영 세션은 provider 60분 한도 전에 턴 경계에서 교체되고, 사용자는 새 음성 버튼을 누르지 않고 대화를 이어간다.

> R2a 증거: 저장 route 자체가 없는 상태에서 duplicate·out-of-order·tool-only·interrupted fixture를 통과했고, user completion은 `provisional`, 취소된 assistant는 `interrupted`로 수렴했다.
>
> R2b 증거: bounded PCM WAV, pre/post-roll, 보정 route, pending backpressure, provider 멱등성·timeout, corrected/failed UI와 page close cleanup을 통과했다. Pi 재시작 뒤에도 DB·Vault·task·trace가 불변이다. 다만 위 R2 GO 체크박스는 R2c 영구 receipt와 실제 corrected-only 저장·실기기 표본까지 포함하므로 아직 체크하지 않는다.
- [ ] 세션 장애·Pi 재시작 뒤 완료 턴은 남고 미완료 턴은 완료된 것처럼 복구되지 않는다.

### R2 실제 음성 표본

합성 TTS만으로 인수하지 않는다. 최소 아래 표본을 실제 iPhone 마이크로 녹음하고 provisional, corrected, 사용자 기대 문장을 나란히 본다.

- 자연스러운 한국어 10턴: 조사 생략, 머뭇거림, 짧은 맞장구, 긴 한 문장
- 영어 5턴: 일반 문장과 영숫자
- 한·영 code-switch 5턴: 모델명, 파일명, 기술 용어
- 날짜·시각·숫자 10개: `7월 31일 오후 3시`, `15만 2천 원`, `0.5%`, 전화번호 형태
- 갈피 고유명사 10개: `갈피`, `시온`, 노트 제목, 실제 task 제목
- 환경 3종: 조용한 방, 생활 소음, 스피커 재생 직후 끼어들기
- false interruption 표본: 시온 응답 중 헛기침 5회, 실제 알림음 5회, 의도한 음성 끼어들기 5회, 작은 목소리 5회

첫 구현 전에는 충분한 실제 표본이 없으므로 임의의 WER 숫자를 GO 기준으로 만들지 않는다. 대신 correction이 provisional보다 나빠진 사례, 고유명사를 환각한 사례, 첫·끝 음절이 잘린 사례를 0건 목표로 수동 분류하고, 표본이 쌓인 뒤 정량 기준을 고정한다. 일정·금액·외부 행동은 정확도가 높아도 사용자 확인을 계속 요구한다.

### 명시적 정밀 전사 입력구 GO

- [ ] iPhone에서 30초 한국어 녹음이 `gpt-transcribe` 보정본으로 화면에 뜬다.
- [ ] 사용자가 전사를 수정하고 `대화 | 메모 | 할 일` 중 목적을 고를 수 있다.
- [ ] 확인 전 transcript가 topic·memory·task에 들어가지 않는다.
- [ ] 성공·실패·취소 뒤 메모리와 임시 오디오가 정리된다.
- [ ] 같은 전사를 재제출해도 선택한 목적의 write가 중복되지 않는다.

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
  → R2a receipt·event reconciliation
  → R2b bounded turn recorder·gpt-transcribe 보정
  → R2c corrected-only history
  → R2d 일정·메모 승인 카드 연결
  → R2e provider 한도 전 session rotation
  → Realtime 운영 기본 승격
  → V5-A 딜 스카우트
```

명시적 정밀 전사 입력구는 R0와 병행해 만들지 않는다. R2b의 provider adapter·audio validation·cleanup을 재사용할 수 있을 때 `POST /api/voice/transcribe` 기반 작은 입력구를 추가한다. 자동 턴 보정과 별도 입력구가 같은 구현을 공유해도 route, 확인 UX, idempotency 목적은 분리한다.

다음 실제 작업은 먼저 R2b와 `near_field` noise reduction을 iPhone에서 hard refresh한 뒤 한국어·영어·code-switch·고유명사·날짜, 첫·끝 음절, 의도한 끼어들기, 헛기침·알림음 false interruption과 `보정 중 → corrected | 기록 확인 필요` 상태를 확인하는 것이다. 이 실기기 품질 인수와 별도 사용자 컨펌 뒤에만 R2c corrected-only `shared-main` finalization을 연다. R2c는 durable receipt와 exactly-once message transaction, 보정 실패의 재시도·직접 수정·폐기 UI를 포함하며 R2b의 휘발 결과를 소급 저장하지 않는다. R1의 기존 A2 기억 5개·무관 질문 4개 정량 parity는 별도 운영 표본으로 남아 있고, 사용자 요청 없이 R2c 쓰기나 R2e 5분 제한 제거부터 열지 않는다.

---

## 12. 공식 근거

[^voice-agents]: OpenAI, [Voice agents — Build a speech-to-speech voice agent](https://developers.openai.com/api/docs/guides/voice-agents#build-a-speech-to-speech-voice-agent). Live audio를 끼어들기, 낮은 첫 음성 지연, 자연스러운 턴 교대, 실시간 도구 사용이 필요한 경우의 출발점으로 설명한다.
[^webrtc]: OpenAI, [Realtime API with WebRTC](https://developers.openai.com/api/docs/guides/realtime-webrtc). 브라우저·모바일 클라이언트에는 WebRTC를 권장하고, unified interface와 ephemeral token 두 초기화 방식을 문서화한다.
[^realtime-conversations]: OpenAI, [Realtime conversations](https://developers.openai.com/api/docs/guides/realtime-conversations). 세션·conversation·response lifecycle, VAD, transcript event, function calling, WebRTC interruption/truncation을 설명한다.
[^realtime-tools]: OpenAI, [Realtime with tools — Configure a function tool](https://developers.openai.com/api/docs/guides/realtime-mcp#configure-a-function-tool). 애플리케이션에서 실행할 작업에는 function tool을 기본으로 제시한다.
[^realtime-mini]: OpenAI, [GPT-Realtime-2.1 mini](https://developers.openai.com/api/docs/models/gpt-realtime-2.1-mini). WebRTC·WebSocket·SIP의 audio/text 입력과 function calling을 지원하는 더 빠르고 저렴한 Realtime 모델로 설명한다.
[^realtime-voices]: OpenAI, [Realtime conversations — Voice options](https://developers.openai.com/api/docs/guides/realtime-conversations#voice-options). 현재 Realtime voice 목록을 제시하고 “For best quality, we recommend using marin or cedar.”라고 명시한다. 성별 분류는 제공하지 않는다.
[^realtime-session-duration]: OpenAI, [Realtime conversations — Session lifecycle events](https://developers.openai.com/api/docs/guides/realtime-conversations#session-lifecycle-events). “The maximum duration of a Realtime session is 60 minutes.”라고 명시한다.
[^realtime-input-transcript]: OpenAI, [Realtime server event — `conversation.item.input_audio_transcription.completed`](https://developers.openai.com/api/reference/resources/realtime/server-events#conversation.item.input_audio_transcription.completed). Response 생성과 비동기로 동작하고 별도 ASR이 만든 transcript가 모델 해석과 달라질 수 있으므로 “should be treated as a rough guide”라고 명시한다. ASR usage도 Realtime 모델과 별도로 과금된다.
[^realtime-response-done]: OpenAI, [Realtime server event — `response.done`](https://developers.openai.com/api/reference/resources/realtime/server-events#response.done). 최종 상태와 무관하게 항상 발생하며 `completed | cancelled | failed | incomplete`를 구분하라고 명시한다. 포함된 Realtime Response schema는 응답당 `max_output_tokens`를 숫자 또는 `inf`로 정의한다.
[^realtime-function-calling]: OpenAI, [Realtime conversations — Function calling](https://developers.openai.com/api/docs/guides/realtime-conversations#function-calling). function call의 완성된 인자는 `response.done`에서 확인하고, custom code 실행 뒤 `function_call_output` item을 만든 다음 새 `response.create`를 보내는 순서를 명시한다.
[^realtime-response-create]: OpenAI, [Realtime client event — `response.create`](https://developers.openai.com/api/reference/resources/realtime/client-events#response.create). default conversation에 쓰는 Response는 한 시점에 하나만 가능하며 `response.done`이 해당 Response의 완료를 알린다고 명시한다.
[^realtime-error]: OpenAI, [Realtime server event — `error`](https://developers.openai.com/api/reference/resources/realtime/server-events#error). “Most errors are recoverable and the session will stay open”이라고 명시하고 기본적으로 오류 메시지를 관찰·기록하라고 권한다.
[^realtime-transcription]: OpenAI, [Realtime transcription](https://developers.openai.com/api/docs/guides/realtime-transcription). live audio에는 `gpt-live-transcribe`를 권장하고, committed turn의 `gpt-transcribe` 특수 workflow는 WebSocket을 요구한다고 설명한다. 서로 다른 턴의 completion 순서는 보장되지 않으므로 `item_id`로 매핑해야 하며, 높은 delay는 더 많은 문맥으로 WER를 개선할 수 있어 실제 마이크·억양·소음·code-switch·숫자·날짜로 평가하라고 권한다.
[^realtime-noise-reduction]: OpenAI, [Realtime API reference — input audio noise reduction](https://developers.openai.com/api/reference/resources/realtime/subresources/transcription_sessions/methods/create). input noise reduction은 audio buffer의 오디오를 VAD와 모델보다 먼저 처리하며 “reducing false positives”와 입력 인지 개선에 도움이 될 수 있다고 명시한다. [Realtime client event — `input_audio_buffer.append`](https://developers.openai.com/api/reference/resources/realtime/client-events#input_audio_buffer.append)는 input audio noise reduction이 buffer write에 동작한다고 설명한다.
[^realtime-vad]: OpenAI, [Realtime VAD — Semantic VAD](https://developers.openai.com/api/docs/guides/realtime-vad#semantic-vad). 발화 내용상 완료 확률에 따라 기다리는 semantic VAD와 `low | medium | high | auto` eagerness를 설명하며, “`auto` is the default value, and is equivalent to `medium`.”이라고 명시한다.
[^file-transcription]: OpenAI, [File transcription](https://developers.openai.com/api/docs/guides/speech-to-text). 완료된 녹음·bounded audio request에는 file transcription을 쓰고, 원어 녹음 전사는 `gpt-transcribe`부터 시작하라고 권한다. 현재 파일 상한은 25MB이며 `mp3`, `mp4`, `mpeg`, `mpga`, `m4a`, `wav`, `webm`을 지원한다.
[^realtime-full]: OpenAI, [GPT-Realtime-2.1](https://developers.openai.com/api/docs/models/gpt-realtime-2.1). 2 대비 영숫자 인식, 침묵·소음 처리, interruption behavior가 개선됐고 reasoning effort를 지원하며, 높은 effort는 지연과 output token 사용량을 늘릴 수 있다고 설명한다.
[^realtime-prompting]: OpenAI, [Realtime prompting — Migrate from earlier realtime models](https://developers.openai.com/api/docs/guides/realtime-models-prompting#migrate-from-earlier-realtime-models). “Set reasoning effort to `low` instead of the default. Increase only for workflows that require deeper planning.”이라고 권한다.
[^pricing]: OpenAI, [API Pricing](https://developers.openai.com/api/docs/pricing). 2026-07-30 확인한 Realtime audio token과 transcription 분당 가격의 원문 기준이다. 가격은 바뀔 수 있으므로 구현·배포 때 다시 확인한다.
