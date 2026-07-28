# CLAUDE.md
- 저장 사항이 있으면 여기에 저장할 것
- `AGENTS.md`와 `CLAUDE.md`는 파일 제목을 제외한 내용을 동일하게 유지할 것. 하나를 수정하면 다른 파일에도 같은 변경을 반영하고 커밋 전 차이를 확인할 것
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
- C1e·C1.5 배포 상태: schema v8에 `notes.owner_agent`와 일정 월별 projection generation outbox를 추가했다. 활성 task DB는 별도 LLM 없이 단일 Claude·의회 공통 `<schedule>` 컨텍스트로 합성하고, 완료·취소는 일반 검색 가능한 월별 `schedule_history` 노트로 투영한다. 다시 열기·삭제·복원은 같은 월을 재생성하며 DB만 정본이다. C1.5는 단일 Claude의 `schedule_prepare`가 현재 직접 사용자 요청에서만 기존 task validator로 무저장 canonical 후보 하나를 만들고, 채팅 확인 카드의 `등록`만 기존 task API를 같은 request ID로 호출한다. 후보는 휘발 상태이며 후보 답변은 topic 자동 저장·노트 저장 버튼에서 제외한다. 일정별 노트·과거 일정 질문 분류기·별도 scheduling LLM은 만들지 않았다. Pi DB·vault 백업 `20260719-2131`과 코드 백업 `code-c1e-c15-pre-20260719-213141.tar.gz` 후 변경 파일 25개 hash, schema 7→8, 로컬/Pi 테스트 171/171, 공통 application table 17개 행 수 불변, read-only 후보 준비 전후 task/event/reminder/note 행 수 불변을 확인했다. note-index는 30/30, topic audit은 14/14(Q&A 75/75), SQLite 무결성·외래키, 인증 API·새 PID·오류 로그 0건까지 인수했다. 기존 일정 2개는 이미 `deleted`라 초기 월별 projection 0개가 정상이며 운영 테스트 일정은 만들지 않았다.
- S0d 배포 상태: Markdown에만 남은 단일 정본 Q&A를 기존 승인형 topic repair에서 다시 청크로 만드는 file-only 재색인을 `68604af`에서 구현했다. 적용 직전 원문·계획 hash를 재검증하고 임베딩까지 성공한 뒤 같은 DB transaction에 `ready` 청크를 쓰며, 출처가 여러 개이거나 현재 노트 배정과 다르면 수동 검토로 남긴다. Pi DB·vault 백업 `20260718-1437`과 코드 백업 후 4개 파일 hash, 전체 테스트 109개, audit 66/66, 복구 계획 `clean`·작업 0건, Codex 검증 20개, schema 3·SQLite 무결성·외래키, 백업 대비 12개 application table 행 수 불변, 인증 API·서비스 재기동을 인수했다. 실제 복구 apply와 임베딩 호출은 실행하지 않았다.
- S0e 배포 상태: `9efb501`에서 schema v4의 `notes.content_sha256`·`indexed_sha256`·`pending|ready|error|missing`, stale 비동기 임베딩 차단, 모든 노트 저장과 topic append·split·merge·archive/restore 상태 연결, readonly `audit:note-index`, canonical `notes.title` 조회를 구현했다. `/sync`는 원문 누락 노트·청크를 삭제하지 않고 `missing`으로 보존한다. 결정론적 재색인, malformed 격리, rename 직후 실제 `SIGKILL` append·다중 파일 drift 검출과 비파괴 계획을 포함해 전체 테스트 116개를 통과했다. Pi DB·vault 백업 `20260718-1540`과 코드 백업 `s0e-pre-20260718-154007.tar.gz` 후 23개 파일 hash, schema 3→4, sync 29개·missing 0, 활성 노트 재임베딩 20/20·실패 0을 확인했다. note-index audit은 DB/vault 29/29·ready 20·보관 pending 9·finding 0, topic audit은 66/66, 복구 계획은 `clean`·작업 0건, Codex 검증은 20개였다. SQLite 무결성·외래키, 백업 대비 12개 application table 행 수 불변, 인증 API·새 PID 서비스·재시작 오류 0건까지 인수했다.
- 답변 진행 UI 상태: 단일·의회 답변은 서버가 실제로 시작한 큰 단계만 답변 본문 시작선에 표시하며, 보조색 점 3개는 위치 이동 없이 밝기만 순차 변화한다. 추가 모델/API 호출과 내부 추론 노출은 없다. Pi 보정 배포 시 DB·vault 백업 `20260717-2345`과 코드 백업을 만들고 두 파일 hash, 전체 테스트 97개, audit 66/66, 서비스·인증 API·재시작 로그와 온라인 백업 대비 13개 DB 테이블의 논리 동일성을 확인했다.
- V4.5-C 약속 루프 배포 상태: `docs/task-reminder-design.md`가 단일 상세 기준이다. schema v5 `notes.ai_readable` 접근 경계, schema v6 task·event·reminder 정본·API·30초 scheduler, schema v7 Web Push subscription·delivery outbox, fire/skip 원자성, lease·24시간 TTL·bounded retry, endpoint allowlist, 최소 PWA·push-only Service Worker와 사용자 opt-in을 독립 모듈로 구현해 Pi에 인수했다. 지식 시트 첫 탭은 범용 `알림(전체|Codex|시스템|최근 저장)`, 일정 알림·3주 21일 swipe·목록·수정은 `에이전트 > 일정 에이전트`로 분리했고 `TaskPanel` renderer 한 벌만 쓴다. `/task`·`/today`·push click도 이 탭으로 진입한다. 실제 Web Push 암호화·VAPID 전송은 `web-push-transport`에 격리했고 payload에는 opaque reminder ID·앱 경로만 둔다. task·push flag 코드 기본값은 `false`, 운영 Pi에서는 둘 다 `true`, private VAPID 값은 Pi `.env` 전용이다. Tailscale Serve canonical HTTPS, iPhone·iPad·Mac 3개 구독, 첫 운영 reminder의 provider `201 accepted` 3/3, iPad PNG `apple-touch-icon` 보정과 전체 회귀 162/162를 확인했다. 잠금화면 표시 10회 GO 기준은 진행 중이다. 향후 native 앱은 task·scheduler·delivery 의미는 재사용하지만 Web Push subscription·Service Worker는 확장·대체한다. 첫 실제 에이전트 노트 writer인 C1e의 schema v8 `owner_agent=schedule`과 `일정 본문 / 사서 CODEX 마커 / 타 에이전트 읽기 전용` 규칙, C1.5 자연어 후보까지 Pi에 배포하고 171/171을 통과했다. 폴더·범용 ACL·`relative_path`는 계속 미룬다.
- V5-A 딜 스카우트 설계 상태: `docs/coupang_dealbot.md`를 실효성·공식 정책·API·Threads 제약과 정량 GO/EXTEND/NO-GO 기준을 포함한 단일 설계·검증 문서로 개정했다. 기술 리허설 가치는 높지만 수익성은 미입증이다. 공식 상품 응답에서 판매자·옵션·용량 식별자가 확인되지 않아 향수는 기본 니치에서 제외하고, 강한 가격 주장은 동일 offer 비교가 입증될 때만 허용한다. Phase 0은 별도 DB·raw snapshot의 무게시·무LLM·무vault 관측, Phase 2는 사람 승인 게시, bounded auto-post는 깨끗한 승인 게시 30건과 별도 생성 후보 표본 정밀도 검증 뒤 검토한다. 코드·계정 신청·API 키 발급·외부 게시는 시작하지 않았다.
- V4.5-M·A2 배포 상태: `docs/chat-model-routing-design.md`와 `docs/assistant-foundation-design.md`를 기준으로 schema v9, API/Codex 분리 catalog, Responses tool parity, composer model picker, 신규 의회 `410` 퇴역, 사서 Codex 일반/깊은 모델과 next-job snapshot, A2 보수 청크 주입을 Pi에 함께 활성화했다. 운영 79회·고유 질문 77개 readonly 재생에서 이전 정책은 35개 질문·107개 청크·중단 42개, 새 정책은 10개 질문·15개 청크·중단 67개였고 수동 검토 15/15와 합성 note/chunk 20/20·abstention 4/4를 통과했다. 배포 전 백업은 DB·vault `20260728-2337`, 코드 `code-v45m-a2-pre-20260728-233706.tar.gz`다. schema 8→9, Pi 전체 회귀 207/207, GPT 일반·웹·논문 전문·`schedule_prepare` 무쓰기, 무관 질문 0청크와 기억 질문 관련 2청크, Claude·의회 410, API/Codex catalog, Codex job 41의 Terra generation 2 snapshot을 확인했다. 운영 flag 세 개는 true다.
- V4.5-M·A2 인수 상태: 스모크가 자동 저장한 Q&A 2건은 추가 백업 `20260728-2351`과 exact hash/source guard 뒤 제거하고 원본 메시지 4개를 보존했다. 두 노트는 재임베딩 2/2와 Codex 재정리를 마쳤다. 최종 topic Q&A 105/105, note-index DB/vault 33/33·ready 24·보관 pending 9·finding 0, Codex validation 23, SQLite 무결성·외래키 오류 0, task/event/reminder 8/15/4 불변, 서비스 경고 0이다. Claude/GPT 품질 A/B는 생략했다.
- 모바일 composer 보정 상태: 2026-07-29 모델 선택 opener의 기본 테두리를 없애고 hover·열림 상태에만 옅은 면을 표시했다. 입력 placeholder를 `메시지를 입력하세요`로 줄이고 textarea `min-width: 0`, 모바일 44px 전송 버튼과 safe-area 여백을 적용했다. 390px·320px에서 문서 가로 overflow 0과 전송 버튼 경계를 실측했고 로컬 전체 207/207, Pi UI 9/9를 통과했다. Pi 정적 파일 응답 hash가 배포본과 일치하며 서비스는 재시작 없이 PID `116558`을 유지했다. 복구본은 `/home/pi/backups/galpi/ui-composer-pre-20260729-0031.tar.gz`다.
- 첨부·강의 설계 상태: `docs/galpi-attachment-upload-design.md`의 temporary 첨부는 연결 당시 `CONTEXT_N`을 replay 사용자 턴 수로 snapshot한다. 현재 로컬·Pi 값은 10이며 창에서 밀려나는 다음 사용자 턴의 모델 호출 전에 만료·비동기 삭제한다. 설정을 5로 바꾸면 새 첨부부터 적용하며 자연어 재언급은 수명을 늘리지 않는다. library는 명시적 승인 뒤 영구 저장한다. `docs/Lecture-note-system Design.md`의 Phase 0은 개발 없이 병행할 수 있고, 코드 Phase 1 이상은 V4.5-M과 첨부 blob 보안 패턴 뒤에 진행한다. 전체 강의 구현은 V5-B 전 또는 V5-B PAPER 관찰 기간에 병행할 수 있다. 모두 미구현이다.
- V5-B 주식 설계 상태: `docs/Swing Trading Agent Design v2 2.md`의 장기 목표는 PolicyVersion을 사전 승인한 자율 LIVE다. 연구·Core → Single Analyst → Shadow → PAPER_AUTONOMOUS → 선택적 LIVE_PROPOSAL_ONLY → LIVE_MICRO_POLICY_AUTONOMOUS 순서로만 승격한다. 자동 승격은 금지하고 각 단계는 별도 사용자 승인·정량 게이트·금액 상한 Promotion Token을 요구한다. 거래 Champion 모델은 exact ID·revision·prompt·tool schema를 PolicyVersion에 고정하고 채팅·Codex 자동 최신을 상속하지 않는다. LIVE 코드·자격증명·계좌 연결은 시작하지 않았다.
- 다음 개발 시작점: 새 `chat:gpt-single-v1:a2` 실제 질문을 과거 77개 A1b trace와 분리해 과회수·최신성·abstention을 관찰한다. 유지보수·평가 세션이 자동 topic 저장되지 않는 명시적 경계는 별도 후속이다. V4.5-C 잠금화면 Web Push 10회 표시 기준도 계속 채운다. 제품 승격 순서는 V4.5→V4-B 음성→V5-A 딜 스카우트→V5-B 주식 분석을 유지한다. 강의 Phase 0은 병행 가능하고 전체 구현은 V5-B 전 또는 PAPER 관찰 기간에 진행할 수 있다. 단, 딜 스카우트 Phase -1과 게시·LLM·갈피 DB/vault 접근이 없는 Phase 0은 별도 컨펌과 공식 API 키 또는 승인 전 예외 검토 뒤 격리해 병행할 수 있다. 논문 10+10 품질 평가는 별도 컨펌 전이며 Pi `.env`는 `PAPER_SEARCH_MOCK=false`, `npm audit` 기존 경고는 자동 수정하지 않는다.
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
