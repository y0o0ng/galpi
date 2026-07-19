# AGENTS.md
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

- 제품명은 `갈피`(`galpi`), 화면에 보이는 비서 이름은 `시온`(`XION`)이다. `의회`는 Claude 초안과 GPT 검증을 결합하는 기능명으로 유지한다.
- 현재 배포 상태: V4 논문 검색·전문 능동 독서, 지식 패널, 알림센터 `최근 저장`, 유지보수 리뷰, 컨텍스트 노트 선택 UI(`516a147`), V4.5 S0b-2a·2b(`699d1e9`, `7e4fdc5`), S0c 공용 토픽 쓰기 경로(`d41defe`), S0d Markdown-only Q&A 재색인(`68604af`), S0e 노트 인덱스 무결성(`9efb501`), A1b 전역 청크 shadow 검색(`adb41a6`), 한국어 경계 보정(`fc332e2`), 실사용 관찰 도구(`8655706`), 답변 생성 단계 UI·정렬 보정(`e7fe8f3`, `73b1ee7`), Codex organizer 복구 격리·원자적 finalization(`bd4041e`)까지 Pi 배포·운영 적용 완료. 제품·비서·경로는 `4ce7fdc`에서 갈피/시온과 `/home/pi/galpi`, `galpi.db`, `galpi-vault`, `galpi.service`로 이관했다. `/search`의 명시적 컨텍스트 선택과 질문 기반 기존 자동 회수는 그대로 유지하고, A1b는 실제 답변에 주입하지 않고 trace만 기록한다.
- 현재 개발 상태: A1b는 모든 활성 `ready` topic 청크를 후보로 보고 기존 노트 점수를 soft prior로 결합한다. 후보 조회는 향후 FTS/벡터 사전 선택으로 교체 가능한 provider 경계 뒤에 뒀다. Codex organizer 보강은 `recovery_required` fail-close, 원자적 finalization, 선택 파일 단위 recovery approval을 포함하며 로컬·Pi 전체 테스트 130/130을 통과했다. Pi에서 최종 organizer 상태는 processed 21·pending/queued/running/failed/needsManualCheck/recoveryRequired 0, 7개 미해결 노트 모두 processed·ready·비placeholder다. organizer 기본 모델은 `0b8d8de`에서 `gpt-5.6-terra`로 전환했고 깊은 재처리는 `gpt-5.5`를 유지한다. Pi Codex CLI를 `0.144.5`로 올려 Terra runner smoke, 로컬·Pi 테스트 130/130, 인증 config/status API, note-index audit 30/30과 Codex validation 21을 통과했으며 배포 전 DB·vault 백업은 `20260718-2223`, CLI 백업은 `codex-cli-0.137.0-pre-terra.tar.gz`다. topic audit 14/14(Q&A 71/71), SQLite 무결성·외래키도 확인했다. 실사용 관찰 도구는 schema v3에 원문 대신 `query_sha256`만 기록하고, `npm run report:retrieval-shadow`는 기본적으로 숫자 집계만, 명시적 `--review`에서만 기존 메시지와 선택 Q&A 질문부를 연결한다.
- S0d 배포 상태: Markdown에만 남은 단일 정본 Q&A를 기존 승인형 topic repair에서 다시 청크로 만드는 file-only 재색인을 `68604af`에서 구현했다. 적용 직전 원문·계획 hash를 재검증하고 임베딩까지 성공한 뒤 같은 DB transaction에 `ready` 청크를 쓰며, 출처가 여러 개이거나 현재 노트 배정과 다르면 수동 검토로 남긴다. Pi DB·vault 백업 `20260718-1437`과 코드 백업 후 4개 파일 hash, 전체 테스트 109개, audit 66/66, 복구 계획 `clean`·작업 0건, Codex 검증 20개, schema 3·SQLite 무결성·외래키, 백업 대비 12개 application table 행 수 불변, 인증 API·서비스 재기동을 인수했다. 실제 복구 apply와 임베딩 호출은 실행하지 않았다.
- S0e 배포 상태: `9efb501`에서 schema v4의 `notes.content_sha256`·`indexed_sha256`·`pending|ready|error|missing`, stale 비동기 임베딩 차단, 모든 노트 저장과 topic append·split·merge·archive/restore 상태 연결, readonly `audit:note-index`, canonical `notes.title` 조회를 구현했다. `/sync`는 원문 누락 노트·청크를 삭제하지 않고 `missing`으로 보존한다. 결정론적 재색인, malformed 격리, rename 직후 실제 `SIGKILL` append·다중 파일 drift 검출과 비파괴 계획을 포함해 전체 테스트 116개를 통과했다. Pi DB·vault 백업 `20260718-1540`과 코드 백업 `s0e-pre-20260718-154007.tar.gz` 후 23개 파일 hash, schema 3→4, sync 29개·missing 0, 활성 노트 재임베딩 20/20·실패 0을 확인했다. note-index audit은 DB/vault 29/29·ready 20·보관 pending 9·finding 0, topic audit은 66/66, 복구 계획은 `clean`·작업 0건, Codex 검증은 20개였다. SQLite 무결성·외래키, 백업 대비 12개 application table 행 수 불변, 인증 API·새 PID 서비스·재시작 오류 0건까지 인수했다.
- 답변 진행 UI 상태: 단일·의회 답변은 서버가 실제로 시작한 큰 단계만 답변 본문 시작선에 표시하며, 보조색 점 3개는 위치 이동 없이 밝기만 순차 변화한다. 추가 모델/API 호출과 내부 추론 노출은 없다. Pi 보정 배포 시 DB·vault 백업 `20260717-2345`과 코드 백업을 만들고 두 파일 hash, 전체 테스트 97개, audit 66/66, 서비스·인증 API·재시작 로그와 온라인 백업 대비 13개 DB 테이블의 논리 동일성을 확인했다.
- V4.5-C 약속 루프 설계 상태: `docs/task-reminder-design.md`를 단일 상세 기준으로 2026-07-19 C0 설계를 개정했다. C1은 외부 캘린더 에이전트가 아니라 명시적 `/task`, 날짜 전용·KST 시각 기한, 단발성 reminder, Today·예정·Inbox, 완료·취소·다시 열기·삭제·복원·확인·1시간 미루기다. 완료·취소는 계속 참조하는 `closed`, 잘못 만든 항목은 일반 검색·AI에서 제외하는 `deleted`이며 물리 purge는 없다. 선행 `ai_readable` 접근 경계 schema v5 뒤 task·event·reminder v6, private HTTPS·PWA·Web Push subscription/delivery v7을 순차 적용하고 알림센터·foreground refresh를 fallback으로 유지한다. 에이전트 탭 최상단에는 7일·지연/오늘/예정/Inbox·오늘/지연 최대 3개·다음 알림·push 상태·`일정 추가 | 전체 일정`을 보여주는 읽기 전용 일정 블록을 두고, 변경 행동은 알림센터에만 둔다. 일정은 DB 정본이며 노트를 기본 생성하지 않는다. 반복은 schema v8 C2로 미뤘다. 코드는 아직 구현하지 않았다.
- V5-A 딜 스카우트 설계 상태: `docs/coupang_dealbot.md`를 실효성·공식 정책·API·Threads 제약과 정량 GO/EXTEND/NO-GO 기준을 포함한 단일 설계·검증 문서로 개정했다. 기술 리허설 가치는 높지만 수익성은 미입증이다. 공식 상품 응답에서 판매자·옵션·용량 식별자가 확인되지 않아 향수는 기본 니치에서 제외하고, 강한 가격 주장은 동일 offer 비교가 입증될 때만 허용한다. Phase 0은 별도 DB·raw snapshot의 무게시·무LLM·무vault 관측, Phase 2는 사람 승인 게시, bounded auto-post는 깨끗한 승인 게시 30건과 별도 생성 후보 표본 정밀도 검증 뒤 검토한다. 코드·계정 신청·API 키 발급·외부 게시는 시작하지 않았다.
- 다음 개발 시작점: 2026-07-18 Pi A1b 실사용 trace는 12회 중 hash가 있는 고유 질문 11개이고 1회는 hash 없는 과거 실행이다. 30개 중간 점검까지 고유 질문 19개가 더 필요하며, 그동안 오류·손상 JSON·8,000자/6청크 상한 도달은 0, 추가 지연은 평균 33.3ms·p95 44ms·최대 44ms였다. 30개에서 원문 opt-in review로 과회수·최신성·supersession·abstention을 점검하고 50개에서 A2 전환 여부를 판단한다. 검토 전에는 A2 실제 답변 회수로 전환하지 않는다. 그동안 A1b 경계를 바꾸지 않는 V4.5-C C1을 병행하며, 구현 순서는 `ai_readable` schema v5 보강 → task·event·reminder schema v6/store/API → scheduler·알림센터·에이전트 탭 일정 요약 → Tailscale Serve private HTTPS·PWA·Web Push schema v7 → Pi 인수다. 백그라운드 탭 지속 refresh는 계약하지 않고 Pi scheduler와 이벤트성 push를 사용한다. 제품 승격 순서는 V4.5→V4-B 음성→V5-A 딜 스카우트→V5-B 주식 분석이다. 단, 딜 스카우트 Phase -1과 게시·LLM·갈피 DB/vault 접근이 없는 Phase 0은 별도 컨펌과 공식 API 키 또는 승인 전 예외 검토 뒤 A1b 관찰과 격리해 병행할 수 있다. 논문 10+10 품질 평가는 별도 컨펌 전이며 Pi `.env`는 `PAPER_SEARCH_MOCK=false`, `npm audit` 기존 경고는 자동 수정하지 않는다.
- 완료된 V3.5: 모든 모델 경로 KST 현재 시각 주입, `[N일 후]` 경과 마커, 짧은 사실 확인 자동 저장 차단, 한 글자 기능어 검색 노이즈 제거
- 코드 구조 방향: `server.js`는 현재 6,810줄. 기존 코드를 한꺼번에 분해하지 말고, V4.5는 topic-store·topic-mutation·migration·retrieval·memory·trace·task·scheduler를 별도 모듈로 작성하며 서버에는 설정과 얇은 라우트만 둘 것
- 기존 검색·의회·Codex·웹 검색 코드는 해당 영역을 크게 수정할 때 회귀 테스트와 함께 점진적으로 모듈로 옮길 것
- 비용 확인은 상단 `Claude 크레딧 ↗`에서 공식 Billing을 연다. 잔액 자동 조회는 하지 않고 Console 로그인 정보·쿠키·관리자 키를 앱에 저장하지 않을 것
- 노트 구조 방향: v4 유지. 사람도 읽기 좋고 AI도 회수하기 좋은 형식. CODEX 마커 구역은 Codex가 안전하게 편집할 수 있는 영역으로 유지
- Codex 역할 방향: 노트 저장/정리/태그/링크/주석을 담당. 현재 자동 큐·worker·검증·알림·병합/분리까지 운영 중
- 작업 방식: 실제 코드 수정 전에 무엇을 바꾸는지, 왜 그렇게 하는지, 영향과 트레이드오프를 설명하고 컨펌받기
