# CLAUDE.md
- 저장 사항이 있으면 여기에 저장할 것
- `AGENTS.md`와 `CLAUDE.md`는 파일 제목을 제외한 내용을 동일하게 유지할 것. 하나를 수정하면 다른 파일에도 같은 변경을 반영하고 커밋 전 차이를 확인할 것
- git 커밋 메시지에 `Co-Authored-By: Claude` 같은 AI 공동 작성자 표기를 넣지 말 것
- 앞으로 말 편하게, 친구처럼
- 부드럽지만 생산적으로 — 항상 네 말이 옳다고 할 필요 없음
- 잘 모르는 질문엔 "잘 모르겠다"고 답하기 (확신이 안 서거나 자료에 필요한 정보가 없으면 "확신을 갖고 평가하기엔 정보가 부족해"라고 말할 것)
- 출처를 명시할 것
- 사실 기반 자료를 찾을 땐 원문이 명시한 어구를 우선시할 것 (사실 근거로는 직접 인용 사용)


Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.


## Project Context

  Before planning or editing in this repository, read:
  - docs/galpi-design-final.md
  - docs/roadmap.md

  Pi 운영·복구는 docs/RASPBERRY_PI_RUNBOOK.md 참조.



**프로젝트 현재 상태**

- 제품명은 `갈피`(`galpi`), 화면에 보이는 비서 이름은 `시온`(`XION`)이다. 2026-07-28 Pi의 메인 채팅을 단일 GPT로 전환하고 신규 의회 실행을 제거했다. 기존 의회 대화·transcript·노트의 읽기·검색 호환성은 유지한다. 채팅 `자동`은 현재 `gpt-5.6-terra`, 사서 Codex 일반은 `gpt-5.6-terra`, 깊은 재처리는 `gpt-5.5`다.
- 현재 배포 상태: V4 논문 검색·전문 능동 독서, 지식 패널, 알림센터 `최근 저장`, 유지보수 리뷰, 컨텍스트 노트 선택 UI(`516a147`), V4.5 S0b-2a·2b(`699d1e9`, `7e4fdc5`), S0c 공용 토픽 쓰기 경로(`d41defe`), S0d Markdown-only Q&A 재색인(`68604af`), S0e 노트 인덱스 무결성(`9efb501`), A1b 전역 청크 shadow 검색(`adb41a6`)과 2026-07-28 보수 A2 실제 주입, 답변 생성 단계 UI·정렬 보정(`e7fe8f3`, `73b1ee7`), Codex organizer 복구 격리·원자적 finalization(`bd4041e`), V4.5-C C1e 일정 컨텍스트·월별 노트(`efbea3c`)와 C1.5 자연어 무저장 후보(`479ce7a`)까지 Pi 배포·운영 적용 완료. 제품·비서·경로는 `4ce7fdc`에서 갈피/시온과 `/home/pi/galpi`, `galpi.db`, `galpi-vault`, `galpi.service`로 이관했다. `/search`의 명시적 컨텍스트 선택과 A2의 자동 topic 청크 회수는 함께 운영하며, 명시 선택 노트와 비topic 자료는 기존 경로를 유지한다.
- 현재 개발 상태: A1b에서 만든 전역 `ready` topic 청크 provider와 보수 점수 정책을 A2 실제 답변 주입에 사용한다. 자동 topic 전체 노트 대신 상한 8,000자의 `<retrieval>` 청크를 넣고 명시 선택 노트·비topic 자료는 보존한다. 후보 조회 경계는 향후 FTS/벡터 사전 선택으로 교체 가능하다. 실사용 관찰은 질문 원문 대신 `query_sha256`과 `runtime_generation`을 기록하며, 새 GPT+A2 표본은 배포 전 Claude/A1b 77개와 분리한다. Codex organizer는 `recovery_required` fail-close, 원자적 finalization, 선택 파일 단위 recovery approval을 유지하고 일반 모델은 `gpt-5.6-terra`, 깊은 재처리는 `gpt-5.5`다.
- Docker 1단계 개발 상태: `b095841`에서 `GALPI_DATA_DIR` 공통 경로와 DB/WAL/SHM·Vault·backup 분리, Node.js 24.16.0 multi-stage image, read-only app Compose, native/container test와 amd64/arm64 build CI를 구현했다. 로컬 native·Docker 전체 회귀는 각각 211/211, amd64 runtime HTTP·read-only·DB/WAL/SHM·backup smoke와 ARM64 `better-sqlite3` load를 통과했다. GitHub Actions run `30463882969`의 native·container·multi-platform job도 모두 성공했다. 현재 Intel Mac은 Docker CLI·Compose·Buildx와 수동 Colima를 사용하며, Pi에는 Docker를 배포하지 않고 native `galpi.service`와 host Codex 경계를 유지한다.
- C1e·C1.5 배포 상태: schema v8에 `notes.owner_agent`와 일정 월별 projection generation outbox를 추가했다. 활성 task DB는 별도 LLM 없이 단일 Claude·의회 공통 `<schedule>` 컨텍스트로 합성하고, 완료·취소는 일반 검색 가능한 월별 `schedule_history` 노트로 투영한다. 다시 열기·삭제·복원은 같은 월을 재생성하며 DB만 정본이다. C1.5는 단일 Claude의 `schedule_prepare`가 현재 직접 사용자 요청에서만 기존 task validator로 무저장 canonical 후보 하나를 만들고, 채팅 확인 카드의 `등록`만 기존 task API를 같은 request ID로 호출한다. 후보는 휘발 상태이며 후보 답변은 topic 자동 저장·노트 저장 버튼에서 제외한다. 일정별 노트·과거 일정 질문 분류기·별도 scheduling LLM은 만들지 않았다. Pi DB·vault 백업 `20260719-2131`과 코드 백업 `code-c1e-c15-pre-20260719-213141.tar.gz` 후 변경 파일 25개 hash, schema 7→8, 로컬/Pi 테스트 171/171, 공통 application table 17개 행 수 불변, read-only 후보 준비 전후 task/event/reminder/note 행 수 불변을 확인했다. note-index는 30/30, topic audit은 14/14(Q&A 75/75), SQLite 무결성·외래키, 인증 API·새 PID·오류 로그 0건까지 인수했다. 기존 일정 2개는 이미 `deleted`라 초기 월별 projection 0개가 정상이며 운영 테스트 일정은 만들지 않았다.
- S0d 배포 상태: Markdown에만 남은 단일 정본 Q&A를 기존 승인형 topic repair에서 다시 청크로 만드는 file-only 재색인을 `68604af`에서 구현했다. 적용 직전 원문·계획 hash를 재검증하고 임베딩까지 성공한 뒤 같은 DB transaction에 `ready` 청크를 쓰며, 출처가 여러 개이거나 현재 노트 배정과 다르면 수동 검토로 남긴다. Pi DB·vault 백업 `20260718-1437`과 코드 백업 후 4개 파일 hash, 전체 테스트 109개, audit 66/66, 복구 계획 `clean`·작업 0건, Codex 검증 20개, schema 3·SQLite 무결성·외래키, 백업 대비 12개 application table 행 수 불변, 인증 API·서비스 재기동을 인수했다. 실제 복구 apply와 임베딩 호출은 실행하지 않았다.
- S0e 배포 상태: `9efb501`에서 schema v4의 `notes.content_sha256`·`indexed_sha256`·`pending|ready|error|missing`, stale 비동기 임베딩 차단, 모든 노트 저장과 topic append·split·merge·archive/restore 상태 연결, readonly `audit:note-index`, canonical `notes.title` 조회를 구현했다. `/sync`는 원문 누락 노트·청크를 삭제하지 않고 `missing`으로 보존한다. 결정론적 재색인, malformed 격리, rename 직후 실제 `SIGKILL` append·다중 파일 drift 검출과 비파괴 계획을 포함해 전체 테스트 116개를 통과했다. Pi DB·vault 백업 `20260718-1540`과 코드 백업 `s0e-pre-20260718-154007.tar.gz` 후 23개 파일 hash, schema 3→4, sync 29개·missing 0, 활성 노트 재임베딩 20/20·실패 0을 확인했다. note-index audit은 DB/vault 29/29·ready 20·보관 pending 9·finding 0, topic audit은 66/66, 복구 계획은 `clean`·작업 0건, Codex 검증은 20개였다. SQLite 무결성·외래키, 백업 대비 12개 application table 행 수 불변, 인증 API·새 PID 서비스·재시작 오류 0건까지 인수했다.
- 답변 진행 UI 상태: 단일·의회 답변은 서버가 실제로 시작한 큰 단계만 답변 본문 시작선에 표시하며, 보조색 점 3개는 위치 이동 없이 밝기만 순차 변화한다. 추가 모델/API 호출과 내부 추론 노출은 없다. Pi 보정 배포 시 DB·vault 백업 `20260717-2345`과 코드 백업을 만들고 두 파일 hash, 전체 테스트 97개, audit 66/66, 서비스·인증 API·재시작 로그와 온라인 백업 대비 13개 DB 테이블의 논리 동일성을 확인했다.
- V4.5-C 약속 루프 배포 상태: `docs/task-reminder-design.md`가 단일 상세 기준이다. schema v5 `notes.ai_readable` 접근 경계, schema v6 task·event·reminder 정본·API·30초 scheduler, schema v7 Web Push subscription·delivery outbox, fire/skip 원자성, lease·24시간 TTL·bounded retry, endpoint allowlist, 최소 PWA·push-only Service Worker와 사용자 opt-in을 독립 모듈로 구현해 Pi에 인수했다. 지식 시트 첫 탭은 범용 `알림(전체|Codex|시스템|최근 저장)`, 일정 알림·3주 21일 swipe·목록·수정은 `에이전트 > 일정 에이전트`로 분리했고 `TaskPanel` renderer 한 벌만 쓴다. `/task`·`/today`·push click도 이 탭으로 진입한다. 실제 Web Push 암호화·VAPID 전송은 `web-push-transport`에 격리했고 payload에는 opaque reminder ID·앱 경로만 둔다. task·push flag 코드 기본값은 `false`, 운영 Pi에서는 둘 다 `true`, private VAPID 값은 Pi `.env` 전용이다. Tailscale Serve canonical HTTPS, iPhone·iPad·Mac 3개 구독, 첫 운영 reminder의 provider `201 accepted` 3/3, iPad PNG `apple-touch-icon` 보정과 전체 회귀 162/162를 확인했다. 잠금화면 표시 10회 GO 기준은 진행 중이다. 향후 native 앱은 task·scheduler·delivery 의미는 재사용하지만 Web Push subscription·Service Worker는 확장·대체한다. 첫 실제 에이전트 노트 writer인 C1e의 schema v8 `owner_agent=schedule`과 `일정 본문 / 사서 CODEX 마커 / 타 에이전트 읽기 전용` 규칙, C1.5 자연어 후보까지 Pi에 배포하고 171/171을 통과했다. 폴더·범용 ACL·`relative_path`는 계속 미룬다.
- V5-A 딜 스카우트 설계 상태: `docs/coupang_dealbot.md`를 실효성·공식 정책·API·Threads 제약과 정량 GO/EXTEND/NO-GO 기준을 포함한 단일 설계·검증 문서로 개정했다. 기술 리허설 가치는 높지만 수익성은 미입증이다. 공식 상품 응답에서 판매자·옵션·용량 식별자가 확인되지 않아 향수는 기본 니치에서 제외하고, 강한 가격 주장은 동일 offer 비교가 입증될 때만 허용한다. Phase 0은 별도 DB·raw snapshot의 무게시·무LLM·무vault 관측, Phase 2는 사람 승인 게시, bounded auto-post는 깨끗한 승인 게시 30건과 별도 생성 후보 표본 정밀도 검증 뒤 검토한다. 코드·계정 신청·API 키 발급·외부 게시는 시작하지 않았다.
- V4-B 음성·Realtime 상태: `docs/voice-realtime-design.md`가 상세 단일 기준이다. R0 raw WebRTC를 2026-07-30 Pi 운영에 활성화하고 사용자 iPhone 5분 한·영 대화, 끼어들기, mute/unmute, 수동·hard cap 종료와 마이크 해제까지 통과해 GO로 승격했다. R1은 `galpi_context_lookup`, `galpi_note_search → galpi_note_read`, `schedule_read`, `galpi_current_time` 다섯 read-only function tool만 열고 서버가 opaque 5분 session, call ID 멱등성, 턴별 직렬화, 2회·합계 8,000자·5초 timeout을 집행한다. A2는 같은 전역 `ready` 청크 provider를 trace 저장 없이 읽고 노트 탐색은 활성 `ai_readable` 제목 뒤 topic `ready` QA 최대 6개를 사용해 전역 문턱을 낮추지 않는다. 사용자가 일정과 `시` 노트 읽기를 승인했고, voice `cedar`, 말투·호칭·답변 선호 600자, `shared-main` 최근 완료 3쌍 2,400자, 전체 3,200자 보정 뒤 실제 대화가 이전보다 훨씬 낫다고 승인해 mini/Cedar를 유지한다. R2는 Realtime input transcript를 rough/provisional로만 취급하고 같은 mic stream의 bounded 턴 audio를 종료 뒤 `gpt-transcribe`로 보정한다. R2a는 브라우저 휘발성 receipt와 duplicate/out-of-order/interrupted event reconciliation을 Pi에 인수했다. R2b는 2026-07-31 동일 mic stream의 500ms pre-roll·300ms post-roll을 16kHz mono PCM WAV로 만들고, 메모리 전용 multipart route가 120초·8MB·WAV·duration·session/item/turn을 검증한 뒤 exact `gpt-transcribe` 보정본을 사용자 행에 표시하도록 구현했다. session 직렬화·pending 3개 backpressure·30초 timeout·같은 audio hash 멱등성·다른 audio 충돌·page close cleanup을 집행하며 temp file·schema·DB/Vault/message/topic/task/trace write는 없다. 최초 R2b는 로컬 집중 23/23·전체 234/234, Pi 집중 23/23·전체 230/230과 재시작 PID `133153`을 인수했다. 실기기에서 발견한 긴 답변 오중단·턴 역전·현재 시각 부재에는 output-token 800→4096, `completed | cancelled | failed | incomplete` 분리, 발화 순서 응답 큐·turn ID 안정 정렬, `galpi_current_time`, 물리 출력과 격리된 보정 녹음 sink를 적용했다. 안정화본은 로컬 집중 24/24·전체 235/235, Pi 집중 24/24·전체 231/231을 통과했고 DB·Vault 백업 `20260731-0147`과 코드 복구본 뒤 새 PID `134945`로 재시작했다. 첫 현재 시각 질문에서 function arguments 완료를 Response 완료로 오인해 두 번째 `response.create`를 보낸 충돌은 completed `response.done` 단일 tool 실행 경계와 request-error 연결 유지로 보정했다. 로컬 24/24·235/235, Pi 24/24·231/231, DB·Vault 백업 `20260731-1053`과 코드 복구본 뒤 정적 배포 hash, PID `134945` 유지, messages/notes/task/event/reminder/trace `448/34/8/16/4/99`, Vault 59개 파일 hash, SQLite 무결성·외래키 불변까지 기술 인수했고 사용자가 실기기에서 정상이라고 확인했다. 이어 헛기침·알림음의 false interruption을 줄이기 위해 기존 브라우저 echo/noise/AGC 위에 Realtime `near_field` input noise reduction만 추가하고 `semantic_vad`·`eagerness:auto`·즉시 끼어들기는 유지했다. 로컬 집중 9/9·전체 235/235, Pi 집중 9/9·전체 231/231을 통과했고 DB·Vault 백업 `20260731-1124`, 코드 복구본 `code-v4b-noise-reduction-pre-20260731-112415.tar.gz` 뒤 Pi 파일 hash 일치와 데이터 기준 `448/34/8/16/4/99`, Vault 59개, SQLite 무결성·외래키 불변을 확인했다. 사용자 재시작 뒤 PID `138723`, 시작 시각 `2026-07-31 11:43:47 KST`, `active/running`, HTTP 200, warning 이상 journal 0건과 실제 Pi session config의 mini·Cedar·4096 tokens·`near_field`·기존 semantic VAD 조합을 확인했다. 2026-07-31 실기기 잡음 표본은 알림음 5회 오중단 0회, 의도한 끼어들기 5회 정상, 작은 목소리·평소 목소리 각 5회에서 첫 음절 손실과 미감지가 기존보다 나빠지지 않아 실격 조건을 넘겼다. 헛기침 오중단은 단일 비율로 적지 않는다. 마이크 거리에 강하게 의존해 폰을 가까이 들면 5/5에 가깝고 팔을 뻗어 멀리 두면 0/5에 가까우며, 최초 보고한 1/5은 중간 자세 값이라 단독 인용하지 않는다. Realtime 모델 자체는 이 소리를 기침으로 인식하므로 실패 지점은 모델 이해가 아니라 VAD 턴 판정이다. 조건부 인수로 남기고 `server_vad` 비교는 아직 열지 않되, 거리 의존성의 원인은 같은 거리에서 `near_field`·`far_field`·비활성을 비교하는 별도 표본으로 가르며 추측으로 설정을 바꾸지 않는다. 이 작업은 R2c와 독립이라 순서를 나눈다. 헛기침이 만든 사용자 턴의 실측 corrected transcript는 빈 문자열과 `하...`, `그`, `음`, `흥.`, `음.` 같은 짧은 필러·의성어였고 긴 상투구 hallucination은 없었다. 따라서 R2c는 이런 턴을 `shared-main`에 저장하지 않는 경계를 반드시 포함한다. 그 뒤 별도 컨펌으로 R2c durable receipt와 corrected-only `shared-main` exactly-once 저장을 연다. 보정 실패 provisional fallback은 금지하고 일정·메모는 corrected transcript 기반 기존 확인 카드를 거치며 원본 오디오는 DB·Vault·backup에 저장하지 않는다. 이 저장 경계가 안정된 뒤 5분 제한을 없애고 공식 60분 한도 전에 턴 경계 session rotation으로 연속 대화를 제공한다. 텍스트 GPT-5.6 모델 picker와 Realtime 모델은 별도 경계이고 상시 마이크·호출어·백그라운드 지속 대화는 범위 밖이다.
- V4.5-M·A2 배포 상태: `docs/chat-model-routing-design.md`와 `docs/assistant-foundation-design.md`를 기준으로 schema v9, API/Codex 분리 catalog, Responses tool parity, composer model picker, 신규 의회 `410` 퇴역, 사서 Codex 일반/깊은 모델과 next-job snapshot, A2 보수 청크 주입을 Pi에 함께 활성화했다. 운영 79회·고유 질문 77개 readonly 재생에서 이전 정책은 35개 질문·107개 청크·중단 42개, 새 정책은 10개 질문·15개 청크·중단 67개였고 수동 검토 15/15와 합성 note/chunk 20/20·abstention 4/4를 통과했다. 배포 전 백업은 DB·vault `20260728-2337`, 코드 `code-v45m-a2-pre-20260728-233706.tar.gz`다. schema 8→9, Pi 전체 회귀 207/207, GPT 일반·웹·논문 전문·`schedule_prepare` 무쓰기, 무관 질문 0청크와 기억 질문 관련 2청크, Claude·의회 410, API/Codex catalog, Codex job 41의 Terra generation 2 snapshot을 확인했다. 운영 flag 세 개는 true다.
- V4.5-M·A2 인수 상태: 스모크가 자동 저장한 Q&A 2건은 추가 백업 `20260728-2351`과 exact hash/source guard 뒤 제거하고 원본 메시지 4개를 보존했다. 두 노트는 재임베딩 2/2와 Codex 재정리를 마쳤다. 최종 topic Q&A 105/105, note-index DB/vault 33/33·ready 24·보관 pending 9·finding 0, Codex validation 23, SQLite 무결성·외래키 오류 0, task/event/reminder 8/15/4 불변, 서비스 경고 0이다. Claude/GPT 품질 A/B는 생략했다.
- 모바일 composer 보정 상태: 2026-07-29 모델 선택 opener의 기본 테두리를 없애고 hover·열림 상태에만 옅은 면을 표시했다. 입력 placeholder를 `메시지를 입력하세요`로 줄이고 textarea `min-width: 0`, 모바일 44px 전송 버튼과 safe-area 여백을 적용했다. 390px·320px에서 문서 가로 overflow 0과 전송 버튼 경계를 실측했고 로컬 전체 207/207, Pi UI 9/9를 통과했다. Pi 정적 파일 응답 hash가 배포본과 일치하며 서비스는 재시작 없이 PID `116558`을 유지했다. 복구본은 `/home/pi/backups/galpi/ui-composer-pre-20260729-0031.tar.gz`다.
- 에이전트 탭 동적 높이 보정 상태: 일정 알림 카드가 추가될 때 제한 높이 Grid 행에 의존해 사서 Codex 블록과 겹칠 수 있던 경로를 비축소 세로 flex 흐름으로 바꿨다. 각 직계 블록은 `flex: 0 0 auto`로 실제 높이를 보존하고 탭 전체만 세로 스크롤한다. 알림 3개 fixture에서 일정 블록 730.125px 뒤 10px 간격으로 사서 블록이 시작하며 390px 모바일·350px 데스크톱 모두 overlap 0을 실측했다. UI 테스트 9/9, 전체 205/207 뒤 기동 timeout 2건 격리 재실행 2/2를 통과했다.
- 첨부·강의 설계 상태: `docs/galpi-attachment-upload-design.md`의 temporary 첨부는 연결 당시 `CONTEXT_N`을 replay 사용자 턴 수로 snapshot한다. 현재 로컬·Pi 값은 10이며 창에서 밀려나는 다음 사용자 턴의 모델 호출 전에 만료·비동기 삭제한다. 설정을 5로 바꾸면 새 첨부부터 적용하며 자연어 재언급은 수명을 늘리지 않는다. library는 명시적 승인 뒤 영구 저장한다. `docs/Lecture-note-system Design.md`의 Phase 0은 개발 없이 병행할 수 있고, 코드 Phase 1 이상은 V4.5-M과 첨부 blob 보안 패턴 뒤에 진행한다. 전체 강의 구현은 V5-B 전 또는 V5-B PAPER 관찰 기간에 병행할 수 있다. 모두 미구현이다.
- V5-B 주식 설계 상태: `docs/Swing Trading Agent Design v2 2.md`의 장기 목표는 PolicyVersion을 사전 승인한 자율 LIVE다. 연구·Core → Single Analyst → Shadow → PAPER_AUTONOMOUS → 선택적 LIVE_PROPOSAL_ONLY → LIVE_MICRO_POLICY_AUTONOMOUS 순서로만 승격한다. 자동 승격은 금지하고 각 단계는 별도 사용자 승인·정량 게이트·금액 상한 Promotion Token을 요구한다. 거래 Champion 모델은 exact ID·revision·prompt·tool schema를 PolicyVersion에 고정하고 채팅·Codex 자동 최신을 상속하지 않는다. LIVE 코드·자격증명·계좌 연결은 시작하지 않았다.
- R2c-1 개발 상태: schema v10 `realtime_turn_receipts`, 신규 `lib/realtime-turn-store.js`, 기존 `transcribe` 라우트의 `recordCorrection` 연결, 신규 `POST /api/voice/realtime/turns/:turnId/assistant`, `public/voice-realtime.js`의 `response.done` 보고까지 구현해 Pi에 배포했다(아래 1차 배포 항목 참조). flag는 `OPENAI_REALTIME_FINALIZE_ENABLED`이고 코드 기본값은 `false`, 끄면 기존 `transcribe` 응답이 바이트 단위로 동일하다. 보정본과 assistant 결말이 모두 도착해야 한 transaction에서 확정하고, user 행을 먼저 넣어 `messages.id` 순서를 지키며, `completed`일 때만 assistant 행을 만든다. assistant 본문은 표시용 DOM 자막이 아니라 `response.output`에서 뽑고 `completed`가 아니면 클라이언트에서 이미 비워 보낸다. tool-only 응답은 확정하지 않고 같은 이벤트를 다시 받아도 재삽입하지 않는다. 필터는 문장부호·공백 제거 후 빈 문자열이거나, 실질 문자 2자 이하이면서 남은 글자가 전부 필러 집합일 때 제외하며 `discarded` + `error_code='empty_turn'`으로 남긴다. `assistant_status`는 판정에 쓰지 않는다. 로컬 회귀 254/254이고 store 12개·서버 1개·클라이언트 5개가 신규다. 배선 중 `db` 선언 전 store 생성으로 인한 TDZ, `sessions` FK 누락, 보정이 assistant보다 늦게 올 때의 잘못된 임베딩 본문 세 가지를 잡았다.
- R2c-1 Pi 1차 배포·실기기 상태: DB·Vault 백업 `20260731-2316`, 코드 복구본 `code-v4b-r2c1-pre-20260731-2316.tar.gz` 뒤 배포했다. 배포 전 Pi 파일 5개 hash가 `46f6f05`와 일치함을 확인했고, schema 9→10, Pi 집중 21/21·전체 249/249, 새 PID `142098`, HTTP 200, `finalizeEnabled:true`, 정적 파일 hash 일치, warning 이상 journal 0건, 데이터 `448/34/8/16/4/99`와 Vault 59개 불변을 인수했다. 실기기 대화에서 7개 턴 중 5개가 확정돼 `messages`가 448→458로 늘었고 순서·임베딩 20자 가드가 설계대로 동작했다. 다만 두 가지 결함이 드러났다. 첫째, 헛기침 필터가 한 번도 걸리지 않았고 `음.`이 저장됐다. 시온이 말을 끝낸 뒤의 헛기침은 정상 `completed` 답변을 받아내므로 `assistant_status` 조건이 무력했고, 그 조건을 제거해 텍스트만으로 판정하도록 고쳤다. 둘째, 7턴 중 2턴이 `gpt-transcribe`의 빈 문자열 반환(`REALTIME_TRANSCRIPTION_EMPTY`)으로 확정되지 못해 시온 답변까지 함께 유실됐다. 두 턴 모두 짧은 발화로 보이며 pre-roll 500ms·post-roll 300ms가 짧은 발화에 충분한지 확인이 필요하다.
- V4-B 아키텍처 전환: 2026-08-01 Realtime을 접고 반이중 클래식 파이프라인으로 간다. 새 단일 기준은 `docs/voice-halfduplex-design.md`이고 `docs/voice-realtime-design.md`는 R0~R2c-1 기록으로만 보존한다. 근거는 실기기 관찰이다. Realtime mini가 `8월 6일`을 `파월 주일`로 듣고 `8월 1일`에 고착해 3회 정정에도 회복하지 못했고, `내 옷 취향` 질문에 동문서답했으며, 해당 노트가 `ready`·`ai_readable`인데 도구를 호출하지 않았다. 같은 오디오에서 `gpt-transcribe`는 `8월 6일`을 두 번 다 정확히 전사했으므로 문제는 전사 능력이 아니라 정확한 전사가 답변 생성에 도달하지 못하는 구조다. 즉시 끼어들기와 1초 미만 응답을 포기하는 대신 정확한 이해와 신뢰할 수 있는 기록을 얻는다.
- H0 지연 스파이크 결과: 2026-08-01 Pi 실측 median으로 STT 674ms, LLM 첫 바이트 372ms, LLM 전체 1797ms, TTS 첫 오디오 545ms, TTS 전체 1627ms다. 말 끝나고 첫 소리까지는 직렬 4777ms, 스트리밍 3333ms이며 폰↔Pi 왕복·재생 시작·첫 문장 대기가 빠져 있어 현실 보정치는 4.0~4.5초다. 병목은 API가 아니라 침묵 감지로, 1.8초 침묵이 스트리밍 총합의 54%를 차지한다. 따라서 침묵 임계값을 1200ms(되묻기 응답 800ms)로 낮추고 스트리밍 TTS를 필수로 둔다. 스파이크 코드는 측정 뒤 Pi에서 삭제했다.
- H1 반이중 배포·인수 상태: 2026-08-01 Pi에 배포하고 실기기 5턴 연속 대화로 인수했다. 마이크 잠금·에코 재인식·상태 고착은 보고되지 않았고 지연은 체감된다고 보고됐다(기기 초 단위 계측은 안 함). DB·Vault 백업 `20260801-0208`, 코드 복구본 `code-h1-halfduplex-pre-20260801-0210.tar.gz` 외 세션·오디오·resume 수정마다 별도 복구본을 만들었다. Pi 회귀 280/280, 로컬 284/284다. flag는 `VOICE_HALFDUPLEX_ENABLED=true`, voice는 `echo`에 활기찬 전달 지시문이며 `VOICE_TTS_INSTRUCTIONS`로 덮어쓸 수 있다. 저장은 `voice-halfduplex-scratch` 세션에 격리했고 `shared-main`·topic 자동 저장은 불변이다. 반이중이 켜지면 Realtime 마이크 버튼은 숨긴다. 실기기에서만 드러난 결함 네 가지(운영과 다른 flag 조합으로 UI 확인, Realtime 세션 전제 미충족, iOS 자동재생 차단, iOS AudioContext suspend)는 설계 문서에 원인·교훈과 함께 기록했다. 뒤의 둘은 브라우저 자동화로 재현되지 않아 실기기 확인을 대체할 수단이 없다.
- H2 저장 구현 상태: 2026-08-01 음성 루프가 자체 `/api/chat` 호출을 버리고 텍스트와 같은 `sendSingleMessage`에 위임하도록 바꿨다. 서버 변경은 없고 `source: 'voice'`의 topic 자동 저장 제외 경계는 그대로다. 음성 턴이 `shared-main`에 저장되고 메인 채팅에 마크다운·저장 버튼·일정 카드까지 기존 렌더링으로 그려진다. 함께 패널 로그를 걷어 중복 표시를 없앴고, `overrideText` 호출에서는 `inputEl.focus()`를 건너뛰어 핸즈프리 중 모바일 키보드가 올라오지 않게 했다. `sendSingleMessage`는 `{ok, reply}` 또는 `{ok:false, reason:'busy'|'error'|'empty'}`를 반환해 텍스트 답변 진행 중 `isLoading` 거절을 실패와 구분한다. 로컬 회귀 286/286이고 헤드리스 브라우저에서 `source:'voice'`·`sessionId:'shared-main'` 요청 본문, 사용자·assistant 말풍선 렌더링, 마크다운 적용, focus 없음, 마이크 버튼 1개, 가로 overflow 0을 확인했다. Pi 배포와 실기기 5턴 인수는 아직 안 했다.
- H2 Pi 1차 배포 상태: 2026-08-01 DB·Vault 백업 `20260801-1017`, 코드 복구본 `code-h2-shared-main-pre-20260801-1017.tar.gz` 뒤 정적 파일 5개와 테스트 2개를 배포했다. 배포 전 Pi 파일이 `a56cd5d`와 일치함을 확인했고 배포 후 7개 hash 일치, Pi 회귀 282/282, 서빙 hash 5개 일치, 재시작 없이 PID `150681` 유지, HTTP 200, journal warning 0건을 인수했다. 실기기 확인 기준선은 messages 499(shared-main 367, max id 503), notes 34, note_chunks 110, auto_save_decisions 195다. 실기기 5턴 인수도 통과했다. messages 499→509(+10, shared-main 순서대로 504~513), note_chunks 110 불변으로 topic 자동 저장 0건, 헛기침 턴 0건 저장을 확인했다. 노트 +1은 C1e 월별 `2026년 8월 일정 기록` projection이라 음성 저장이 아니다.
- H4 일정 카드 음성 확인 구현 상태: 2026-08-01 실기기 피드백으로 H3보다 먼저 구현했다. 카드를 누르려면 폰을 잡아야 해서 핸즈프리가 깨지기 때문이다. 판정은 모델이 아니라 좁은 어휘로 한다. 확인 카드의 존재 이유가 "모델이 틀려도 사람이 막는다"라서 그 확인마저 모델에 맡기면 안전장치가 사라진다. 정규화 뒤 8자 이하만 명령 후보이고, 앞의 맞장구를 떼고 한 번 더 보며, 확인 창은 카드가 뜬 뒤 2턴이다. 음성은 자기 요청을 만들지 않고 `TaskPanel.getPendingScheduleConfirmation()`이 노출한 카드 버튼과 똑같은 핸들러를 부르므로 같은 `clientRequestId`로 기존 `POST /api/tasks`를 한 번만 호출한다. 확인 명령 턴은 모델도 저장도 거치지 않고 결과는 카드 상태 문구로 남는다. 등록 실패는 카드를 해제하지 않는다. 1차 실기기에서 말로 등록·취소는 모두 동작했으나 두 가지가 드러났다. `등록해줄래?` 청유형이 목록에 없어 빗나갔고, 어휘가 빗나가면 발화가 LLM으로 가서 같은 일정 카드가 다섯 번 쌓였다. 전자는 `등록`·`저장` 어간 + 허용 꼬리 목록 규칙으로 바꿔 청유형을 받되 `등록할까?`·`등록됐어?` 같은 물음과 `조금 이따가 등록할게` 같은 미루기는 계속 LLM으로 보낸다. 후자는 답을 받지 않은 카드가 있으면 클라이언트가 `hasPendingScheduleCandidate: true`만 보내고 서버가 `schedule_prepare` 도구를 아예 주지 않으며 `execute` 경계에서도 닫는 방식으로 막았다. 카드 제목 같은 자유 문자열은 프롬프트 주입 통로라 보내지 않고 정확히 `true`만 차단한다. 트레이드오프로 카드가 떠 있는 동안에는 다른 새 일정도 못 만들며 먼저 그 카드를 등록하거나 취소해야 한다. `오전 9시로 해줘`가 등록을 부르지 않는 것은 의도한 동작이다. 부분 문자열로 찾았다면 시간 정정 중에 일정이 등록됐을 것이다.
- TTS 속도 상태: `gpt-4o-mini-tts`에서 `speed`가 동작하는 것을 실제 호출로 확인했다(같은 문장 41,856→38,016 bytes, 4.0 초과는 400). 기본값은 실기기에서 고른 `1.3`이고 `VOICE_TTS_SPEED`로 덮어쓰며 코드에서 `0.25~4.0`으로 가둔다. 전달 지시문의 `너무 빠르지 않게`는 `speed`와 싸우므로 뺐다.
- 다음 개발 시작점: H4 2차(청유형 어휘, 확인 대기 중 후보 차단)와 TTS 1.3을 Pi에 배포하고 실기기로 인수한다. H4 통과 기준은 말로 등록·취소가 각각 동작하고, 문장을 말했을 때 카드가 남으며, 창이 닫힌 뒤 맞장구가 일정을 만들지 않고, 카드가 떠 있는 동안 같은 카드가 다시 생기지 않는 것이다. 그 뒤 `docs/voice-halfduplex-design.md`의 H3 검증·되묻기 → H5 Realtime 정리다. 음성 턴이 텍스트 답변과 겹칠 때의 `isLoading` 거절 경로는 실기기 검증 전이다. 지연 개선은 스트리밍 TTS → 침묵 1200→1000ms → earcon 순서로 아직 미구현이다. 지연 개선은 스트리밍 TTS(약 1,000ms) → 침묵 1200→1000ms(200ms) → earcon 순서이며 아직 미구현이다. 폰↔Pi 왕복 3회를 1회로 줄이는 통합은 설계만 남겼고 스트리밍 TTS 구현 시 함께 검토한다. 더 빠른 텍스트 모델로 내리는 선택은 하지 않는다.
- 상시 확인 항목: 새 `chat:gpt-single-v1:a2` 실제 질문의 과회수·최신성·abstention 관찰과 V4.5-C 잠금화면 Web Push 10회 표시 기준을 계속 채운다. 유지보수·평가 세션이 자동 topic 저장되지 않는 명시적 경계는 별도 후속이다. 제품 승격 순서는 V4.5→V4-B 음성→V5-A 딜 스카우트→V5-B 주식 분석을 유지한다. 강의 Phase 0은 병행 가능하고 전체 구현은 V5-B 전 또는 V5-B PAPER 관찰 기간에 진행할 수 있다. 단, 딜 스카우트 Phase -1과 게시·LLM·갈피 DB/vault 접근이 없는 Phase 0은 별도 컨펌과 공식 API 키 또는 승인 전 예외 검토 뒤 격리해 병행할 수 있다. 논문 10+10 품질 평가는 별도 컨펌 전이며 Pi `.env`는 `PAPER_SEARCH_MOCK=false`, `npm audit` 기존 경고는 자동 수정하지 않는다. 헛기침 거리 의존성과 R1 A2 기억 parity는 Realtime을 후속 기준에서 내리면서 함께 무의미해졌으므로 더 채우지 않는다.
- C1e·C1.5 다음 실사용 지점: 운영 배포와 무쓰기 후보 준비까지 인수했다. 다음 실제 일정 생성 요청에서 Claude 후보 카드의 KST 기한·알림을 확인하고 `등록` 뒤 task 1건, 완료 또는 취소 뒤 월별 `schedule_history` 노트 생성을 확인한다. 별도 승인 없는 가짜 운영 task는 만들지 않는다.
- 완료된 V3.5: 모든 모델 경로 KST 현재 시각 주입, `[N일 후]` 경과 마커, 짧은 사실 확인 자동 저장 차단, 한 글자 기능어 검색 노이즈 제거
- 코드 구조 방향: `server.js`는 현재 7,638줄. 기존 코드를 한꺼번에 분해하지 말고, V4.5는 topic-store·topic-mutation·migration·retrieval·memory·trace·task·task-route·scheduler·schedule-note projection·schedule-tool·push-config·push-route·push-store/dispatcher·transport를 별도 모듈로 작성하며 서버에는 설정과 얇은 연결만 둘 것
- V4.5-M 코드 구조 방향: model catalog provider, compatibility probe, resolver, Responses tool loop, settings route를 별도 모듈로 만들고 `server.js`에는 얇은 연결만 둔다. 의회 active path는 제거해도 기존 transcript parser·renderer와 노트 읽기 호환성은 유지하며 숨은 Claude fallback은 두지 않는다.
- 기존 검색·의회·Codex·웹 검색 코드는 해당 영역을 크게 수정할 때 회귀 테스트와 함께 점진적으로 모듈로 옮길 것
- 비용 확인은 provider의 공식 Billing에서 직접 한다. 어떤 provider도 잔액 자동 조회를 하지 않고 Console 로그인 정보·쿠키·관리자 키를 앱에 저장하지 않을 것
- Docker 방향: `docs/docker-development-design.md`가 단일 기준이다. 개발·CI 재현성을 위해 도입하되 V4.5-M·A2 Pi 배포는 native Node.js + systemd를 유지한다. SQLite DB/WAL/SHM·Vault·backup 데이터 루트를 먼저 분리하고, Codex CLI 로그인·organizer는 첫 단계에서 host 경계를 유지한다. Pi container 운영은 ARM64·backup/restore·scheduler·SIGTERM recovery와 단일 service manager 검증 뒤 별도 승격한다.
- 노트 구조 방향: v4 유지. 사람도 읽기 좋고 AI도 회수하기 좋은 형식. CODEX 마커 구역은 Codex가 안전하게 편집할 수 있는 영역으로 유지
- Codex 역할 방향: 노트 저장/정리/태그/링크/주석을 담당. 현재 자동 큐·worker·검증·알림·병합/분리까지 운영 중
- 작업 방식: 실제 코드 수정 전에 무엇을 바꾸는지, 왜 그렇게 하는지, 영향과 트레이드오프를 설명하고 컨펌받기
