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
- 현재 배포 상태: V4 논문 검색·전문 능동 독서, 지식 패널, 알림센터 `최근 저장`, 유지보수 리뷰, 컨텍스트 노트 선택 UI(`516a147`), V4.5 S0b-2a·2b(`699d1e9`, `7e4fdc5`), S0c 공용 토픽 쓰기 경로(`d41defe`), S0d Markdown-only Q&A 재색인(`68604af`), A1b 전역 청크 shadow 검색(`adb41a6`), 한국어 경계 보정(`fc332e2`), 실사용 관찰 도구(`8655706`)와 답변 생성 단계 UI·정렬 보정(`e7fe8f3`, `73b1ee7`)까지 Pi 배포·운영 적용 완료. 제품·비서·경로는 `4ce7fdc`에서 갈피/시온과 `/home/pi/galpi`, `galpi.db`, `galpi-vault`, `galpi.service`로 이관했다. `/search`의 명시적 컨텍스트 선택과 질문 기반 기존 자동 회수는 그대로 유지하고, A1b는 실제 답변에 주입하지 않고 trace만 기록한다.
- 현재 개발 상태: A1b는 모든 활성 `ready` topic 청크를 후보로 보고 기존 노트 점수를 soft prior로 결합한다. 후보 조회는 향후 FTS/벡터 사전 선택으로 교체 가능한 provider 경계 뒤에 뒀다. 한국어 한 글자 부분 문자열 과회수 보정 배포 후 Pi 비공개 20개는 note 20/20·chunk 18/20·abstention 4/4·상한 20/20, 무관 노트 13/29·무관 청크 51/69, 평균 362ms·최대 824ms였다. 정확 청크 2건과 별도 holdout의 환율 false positive 1건은 남아 있다. 실사용 관찰 도구는 schema v3에 원문 대신 `query_sha256`만 기록하고, `npm run report:retrieval-shadow`는 기본적으로 숫자 집계만, 명시적 `--review`에서만 기존 메시지와 선택 Q&A 질문부를 연결한다. Pi DB·vault 백업 `20260718-1345`과 코드 백업 후 14개 파일 hash, schema 2→3, 기존 trace 14건 보존, schema_version 외 application table 행 수 불변, SQLite 무결성·외래키, 전체 테스트 104개, audit 66/66, 인증 API·서비스 재기동을 인수했다.
- S0d 배포 상태: Markdown에만 남은 단일 정본 Q&A를 기존 승인형 topic repair에서 다시 청크로 만드는 file-only 재색인을 `68604af`에서 구현했다. 적용 직전 원문·계획 hash를 재검증하고 임베딩까지 성공한 뒤 같은 DB transaction에 `ready` 청크를 쓰며, 출처가 여러 개이거나 현재 노트 배정과 다르면 수동 검토로 남긴다. Pi DB·vault 백업 `20260718-1437`과 코드 백업 후 4개 파일 hash, 전체 테스트 109개, audit 66/66, 복구 계획 `clean`·작업 0건, Codex 검증 20개, schema 3·SQLite 무결성·외래키, 백업 대비 12개 application table 행 수 불변, 인증 API·서비스 재기동을 인수했다. 실제 복구 apply와 임베딩 호출은 실행하지 않았다.
- S0e 로컬 상태: `9efb501`에서 schema v4의 `notes.content_sha256`·`indexed_sha256`·`pending|ready|error|missing`, stale 비동기 임베딩 차단, 모든 노트 저장과 topic append·split·merge·archive/restore 상태 연결, readonly `audit:note-index`, canonical `notes.title` 조회를 구현했다. `/sync`는 원문 누락 노트·청크를 삭제하지 않고 `missing`으로 보존한다. 결정론적 재색인, malformed 격리, rename 직후 실제 `SIGKILL` append·다중 파일 drift 검출과 비파괴 계획을 포함해 전체 테스트 116개, 로컬 topic audit 7/7과 복구 계획 `clean`을 통과했다. 실제 로컬 DB migration과 Pi 배포는 아직 하지 않았다.
- 답변 진행 UI 상태: 단일·의회 답변은 서버가 실제로 시작한 큰 단계만 답변 본문 시작선에 표시하며, 보조색 점 3개는 위치 이동 없이 밝기만 순차 변화한다. 추가 모델/API 호출과 내부 추론 노출은 없다. Pi 보정 배포 시 DB·vault 백업 `20260717-2345`과 코드 백업을 만들고 두 파일 hash, 전체 테스트 97개, audit 66/66, 서비스·인증 API·재시작 로그와 온라인 백업 대비 13개 DB 테이블의 논리 동일성을 확인했다.
- 다음 개발 시작점: S0e schema v4는 별도 컨펌 뒤 Pi 백업·migration·sync·활성 노트 재임베딩·두 audit으로 배포한다. 그동안 중복을 제거한 실사용 고유 질문 30개에서 중간 점검하고 50개에서 A2 전환 여부를 판단한다. 과회수·최신성·supersession 및 남은 실패를 검토하기 전에는 A2 실제 답변 회수로 전환하지 않는다. V4.5 전에는 V4-B 음성·V5 전문 에이전트를 구현하지 않는다. 논문 10+10 품질 평가는 별도 컨펌 전이며 Pi `.env`는 `PAPER_SEARCH_MOCK=false`, `npm audit` 기존 경고는 자동 수정하지 않는다.
- 완료된 V3.5: 모든 모델 경로 KST 현재 시각 주입, `[N일 후]` 경과 마커, 짧은 사실 확인 자동 저장 차단, 한 글자 기능어 검색 노이즈 제거
- 코드 구조 방향: `server.js`는 현재 6,040줄. 기존 코드를 한꺼번에 분해하지 말고, V4.5는 topic-store·topic-mutation·migration·retrieval·memory·trace·task·scheduler를 별도 모듈로 작성하며 서버에는 설정과 얇은 라우트만 둘 것
- 기존 검색·의회·Codex·웹 검색 코드는 해당 영역을 크게 수정할 때 회귀 테스트와 함께 점진적으로 모듈로 옮길 것
- 비용 확인은 상단 `Claude 크레딧 ↗`에서 공식 Billing을 연다. 잔액 자동 조회는 하지 않고 Console 로그인 정보·쿠키·관리자 키를 앱에 저장하지 않을 것
- 노트 구조 방향: v4 유지. 사람도 읽기 좋고 AI도 회수하기 좋은 형식. CODEX 마커 구역은 Codex가 안전하게 편집할 수 있는 영역으로 유지
- Codex 역할 방향: 노트 저장/정리/태그/링크/주석을 담당. 현재 자동 큐·worker·검증·알림·병합/분리까지 운영 중
- 작업 방식: 실제 코드 수정 전에 무엇을 바꾸는지, 왜 그렇게 하는지, 영향과 트레이드오프를 설명하고 컨펌받기
