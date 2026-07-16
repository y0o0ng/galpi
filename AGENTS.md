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
  - docs/ai-council-design-final.md
  - docs/roadmap.md

  Pi 운영·복구는 docs/RASPBERRY_PI_RUNBOOK.md 참조.



**프로젝트 현재 상태**

- 현재 배포 상태: V4 논문 검색 1·2차, 논문 서재 UI, 일반 노트 읽기, 공개 PDF 외부 링크, Clawd 패널 이동, 알림센터 `최근 저장`, 2.5A Phase A/B/C와 유지보수 리뷰 버그 1~9까지 Pi 배포 완료 (`c9bf470`, `4c3d07f`, `1078df5`, `5d28d73`, `fd615c7`, `6bd1f57`). V4.5 A0 기준선·A1 청크 회수 shadow mode, S0a audit, S0b-1 readonly 복구 계획(`3a96ff3`, `c5e5d04`, `575205a`, `fdabe05`, `8c2d490`)도 Pi에 배포했고 전체 테스트 65개를 통과했다.
- 현재 개발 상태: A1 shadow는 실제 답변을 기존 회수로 유지한 채 노트 최대 3개·청크 최대 6개·총 8,000자 evidence만 기록한다. Pi 비공개 실사용은 note 15/20·chunk 9/20·abstention 0/4라 A2 전환 전이다. S0b-1 Pi 계획 15건은 적용 후보 13건과 수동 2건이었다. S0b-2a·2b는 `699d1e9`, `7e4fdc5`에서 schema version·청크 hash/상태·승인형 apply·백업·stale hash 차단·원자적 중복 제거·DB transaction·실패 rollback까지 로컬 구현했고 전체 테스트 76개를 통과했다. 실제 로컬·Pi 운영 DB와 vault는 아직 변경하지 않았다.
- 다음 개발 시작점: Pi maintenance window에서 S0b-2 코드를 배포하고 readonly 계획의 새 hash와 수동 작업 ID를 확인한 뒤 실제 schema·파일·DB 적용 범위를 설명하고 다시 컨펌받는다. Pi의 서비스 중지·시작은 사용자가 직접 수행한다. 적용 후 감사와 전체 테스트를 통과하면 append/split/merge/archive 공용 쓰기 경로와 A1b 전역 청크 검색+노트 soft prior를 진행한다. V4.5 전에는 V4-B 음성·V5 전문 에이전트를 구현하지 않는다. 논문 10+10 품질 평가는 별도 컨펌 전이며 Pi `.env`는 `PAPER_SEARCH_MOCK=false`, `npm audit` 기존 경고는 자동 수정하지 않는다.
- 완료된 V3.5: 모든 모델 경로 KST 현재 시각 주입, `[N일 후]` 경과 마커, 짧은 사실 확인 자동 저장 차단, 한 글자 기능어 검색 노이즈 제거
- 코드 구조 방향: `server.js`는 현재 5,684줄. 기존 코드를 한꺼번에 분해하지 말고, V4.5는 topic-store·migration·retrieval·memory·trace·task·scheduler를 별도 모듈로 작성하며 서버에는 설정과 얇은 라우트만 둘 것
- 기존 검색·의회·Codex·웹 검색 코드는 해당 영역을 크게 수정할 때 회귀 테스트와 함께 점진적으로 모듈로 옮길 것
- 비용 확인은 상단 `Claude 크레딧 ↗`에서 공식 Billing을 연다. 잔액 자동 조회는 하지 않고 Console 로그인 정보·쿠키·관리자 키를 앱에 저장하지 않을 것
- 노트 구조 방향: v4 유지. 사람도 읽기 좋고 AI도 회수하기 좋은 형식. CODEX 마커 구역은 Codex가 안전하게 편집할 수 있는 영역으로 유지
- Codex 역할 방향: 노트 저장/정리/태그/링크/주석을 담당. 현재 자동 큐·worker·검증·알림·병합/분리까지 운영 중
- 작업 방식: 실제 코드 수정 전에 무엇을 바꾸는지, 왜 그렇게 하는지, 영향과 트레이드오프를 설명하고 컨펌받기
