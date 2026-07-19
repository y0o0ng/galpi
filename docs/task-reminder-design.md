# V4.5-C 시온 약속 루프 상세 설계

> 작성: 2026-07-18 · 갱신: 2026-07-19
>
> 상태: **C1d schema v5/v6/v7·최소 PWA·Web Push·일정 에이전트 Pi 배포 및 Tailscale Serve HTTPS 인수 완료(2026-07-19) · 실기기 provider acceptance 1/10, 잠금화면 표시 반복 검증 진행 중**
>
> 단일 기준: V4.5-C의 task·reminder 구현 세부사항은 이 문서를 따른다.

## 0. 결정 요약

시온의 첫 일정 기능은 외부 캘린더를 운영하는 자율 에이전트가 아니라, 갈피 안에서 사용자가 확정한 할 일과 단발성 알림을 잊지 않게 지키는 **약속 루프**다.

- 첫 진입은 명시적 `/task`다. `/task 보고서 초안`처럼 뒤에 쓴 텍스트는 제목에 그대로 채우되 자연어 날짜 해석은 하지 않는다.
- 사용자가 확인 카드를 제출하기 전에는 DB에 아무것도 저장하지 않는다.
- C1은 task 생성·수정·완료·취소·다시 열기·삭제·복원, Today·예정·Inbox, 단발성 알림·확인·1시간 미루기를 지원한다.
- 완료·취소는 내용을 계속 참조할 수 있는 `closed`, 잘못 만든 항목의 삭제는 평소 검색·AI 참조에서 제외하는 `deleted`로 분리한다. C1에는 물리 purge가 없다.
- task와 reminder는 별도 SQLite 정본으로 저장한다. 기존 `notification_actions`는 Codex 승인 이력이므로 재사용하지 않는다.
- reminder 행은 약속 occurrence와 사용자 확인 상태의 영속 정본이다. 푸시 구독과 기기별 전송 receipt는 별도 정본으로 둬 네트워크 실패가 reminder를 되돌리지 못하게 한다.
- Web Push는 후속 보너스가 아니라 C1 첫 배포의 필수 전달 채널이다. 다만 task core와 push migration·feature flag·인수 단위는 분리한다.
- 지식 시트의 첫 탭은 범용 `알림`이며 `전체 | Codex | 시스템 | 최근 저장`만 다룬다. 일정 알림·목록·수정은 `에이전트 > 일정 에이전트` 안에서 처리한다.
- C1에는 반복, 자연어 후보 추출, 오늘 브리핑, 결과 기록, 외부 캘린더를 넣지 않는다.
- 반복은 회차별 완료를 표현하는 세 번째 테이블이 필요하므로 C2의 별도 schema migration과 컨펌으로 진행한다.

이 기능은 향후 외부 캘린더를 읽고 일정을 조정할 수 있는 `V5-C 일정 에이전트`와 다르다. 이 문서의 대상은 `V4.5-C 약속 루프`다.

## 1. 지금 병행해도 되는 경계

현재 A1b는 실제 답변에 새 청크를 주입하지 않는 shadow 관찰 단계다. C1은 아래 경계를 지키는 동안 A1b 관찰과 독립적으로 진행할 수 있다.

1. 새 `assistant_tasks`, `assistant_task_events`, `assistant_reminders`, `assistant_push_subscriptions`, `assistant_push_deliveries`만 쓰고 `messages`, `notes`, `note_chunks`, retrieval trace를 수정하지 않는다.
2. `/task` 경로에서 LLM·임베딩·웹 검색·자동 저장·Codex organizer를 호출하지 않는다.
3. scheduler는 새 task/reminder 정본만 읽고 쓰고, push dispatcher는 commit된 delivery outbox만 처리한다.
4. 기존 `/api/notifications`에는 읽기 결과만 합성하며 Codex 승인 상태와 API를 공유하지 않는다.
5. A1b feature flag, 후보 점수, 컨텍스트 상한, 실사용 trace 형식을 바꾸지 않는다.

이 경계를 넘는 자연어 task 추출이나 기억 연결은 A1b 중간 검토와 별도로 다시 컨펌한다.

## 2. 사용자에게 보이는 동작

### 2.1 할 일 만들기

```text
/task
  -> 작성 카드 열기
  -> 제목·설명·기한·알림 입력
  -> "2026년 7월 20일 월요일 오후 6:00 KST"처럼 절대 시각 확인
  -> 만들기
  -> 같은 transaction에서 active task와 선택적 pending reminder 저장
```

- 제목만 필수다.
- 기한은 `없음 | 날짜만 | 날짜+시각` 중 하나다.
- 날짜만 있는 기한에는 임의의 09:00 또는 23:59 알림을 만들지 않는다.
- 알림은 기한과 별개다. 알림을 원하면 정확한 날짜와 시각을 직접 확인한다.
- `/task 보고서 초안`은 `보고서 초안`을 제목에 채울 뿐, 대화로 전송하거나 자동 저장하지 않는다.

### 2.2 목록 보기

지식 시트의 첫 탭은 범용 `알림`이다. 이 탭은 `전체 | Codex | 시스템 | 최근 저장` 네 필터만 제공하고 `task_reminder`는 표시하지 않는다. 기존 데스크톱 PIP·드래그 위치 저장은 제거한다.

일정 목록과 행동은 `에이전트 > 일정 에이전트`의 전용 작업 화면에 둔다.

- **알림**: 발화됐지만 아직 확인하지 않은 reminder
- **오늘·지연**: KST 오늘 마감과 이미 지난 active task
- **예정**: 오늘 이후 기한이 있는 active task
- **Inbox**: 기한이 없는 active task
- **종결됨**: `closed`인 완료·취소 항목. 기본은 접고 최근 항목만 조회하며 AI와 사용자 검색에서 계속 참조할 수 있다.
- **삭제됨**: `deleted` 항목. 일반 목록·검색·AI 참조에서는 제외하고 복구 화면에서만 조회한다.

`/today`는 일정 에이전트의 `오늘` 목록을 바로 연다. `/task`는 같은 작업 화면의 작성 카드를 연다. 단순히 화면을 열거나 목록을 조회했다고 reminder를 확인 처리하지 않는다.

### 2.3 에이전트 탭의 일정 에이전트

`ASSISTANT_TASKS_ENABLED=true`일 때 기존 `에이전트` 탭의 첫 블록은 **일정 에이전트**다. 이는 외부 캘린더를 조정하는 V5-C 자율 에이전트가 아니라 같은 task DB를 읽는 C1 약속 루프의 요약·진입점이다.

- 상단: `일정 에이전트` 제목과 이 브라우저의 `확인 중 | 알림 준비 중 | 알림 켜짐 | 알림 켜기 | 알림 차단됨 | 알림 미지원` 상태
- 주간 이동: KST 기준 이전·현재·다음 3주, 총 21개 날짜만 받아 native horizontal scroll-snap으로 넘긴다. 한 주를 넘기면 그 주를 새 중앙으로 다시 조회한다. 화면에는 별도 `이전 | 오늘 | 다음` 버튼을 두지 않고 가로 스와이프와 키보드 좌우 이동만 제공한다.
- 요약: `지연 | 오늘 | 예정 | Inbox`의 전체 건수
- 미리보기: 지연 우선, 그다음 오늘 순으로 최대 3개
- 다음 알림: 현재 시각 이후 가장 가까운 pending reminder의 시각과 task 제목
- 확인할 알림: unresolved reminder를 같은 블록에서 보여주고 `확인 | 1시간 뒤 | 완료`를 처리한다.
- 진입: `일정 추가`와 `전체 일정`은 같은 에이전트 탭 안의 일정 작업 화면으로 전환한다.

일정 에이전트 셸은 task 행동을 새로 구현하지 않고 `TaskPanel`의 단일 renderer를 호출한다. 따라서 에이전트 탭 안에서 행동하지만 상태 전이·낙관적 갱신 구현은 한 벌이다. `ASSISTANT_TASKS_ENABLED=false`일 때는 블록을 숨기고 기존 에이전트 탭의 준비 상태를 유지한다.

### 2.4 알림 행동

- `확인`: reminder만 확인한다. task는 active로 남는다.
- `완료`: task를 완료하고 아직 남은 reminder를 함께 정리한다.
- `1시간 뒤`: 현재 reminder를 `snoozed` 행동으로 확인하고, 정확히 한 개의 새 pending reminder를 만든다. task 기한은 바꾸지 않는다.
- `취소`: task를 취소하고 미처리 reminder를 숨긴다.
- `다시 열기`: 종결된 task를 active로 되돌리되 이전 reminder는 복원하지 않는다.
- `삭제`: 잘못 만든 task를 `deleted`로 보내고 live reminder를 취소한다. 이력은 남지만 일반 참조에서는 사라진다.
- `복원`: 삭제 직전의 상태로 보이게 되돌리되 reminder는 자동 복원하지 않는다.

## 3. C1 범위와 비범위

### 3.1 C1에 포함

- 명시적 `/task` 작성·확인 카드
- active task 생성, 수정, 완료, 취소, 다시 열기, 삭제, 복원
- 기한 없음, 날짜 전용 기한, KST 절대 시각 기한
- task당 동시에 최대 한 개의 live 단발성 reminder
- 30초 scheduler, 시작 직후 catch-up, occurrence 중복 차단
- reminder 확인과 한 번씩 멱등적인 1시간 미루기
- 지식 시트 첫 탭의 범용 알림 네 필터와, 여기서 분리된 일정 에이전트의 Today·예정·Inbox·종결·삭제 복구 화면
- 에이전트 탭 최상단의 일정 에이전트 3주 스와이프·요약·미리보기·unresolved 알림·작업 화면
- 최소 PWA 기반, 사용자 opt-in Web Push, 일정 에이전트·focus polling fallback
- Tailscale Serve HTTPS origin, Service Worker `push`·`notificationclick`, 기기별 delivery outbox·재시도
- API token 보호, 입력 상한, 낙관적 동시성, 결정론적 테스트 시계
- task와 Web Push의 독립 feature flag를 통한 scheduler·UI·dispatcher 비활성화

### 3.2 C1에서 제외

- 대화의 미래형 문장을 감지하는 자연어 task 후보
- 매일·평일·매주·매월 등 반복 task/reminder
- 첫 접속 또는 정해진 시각의 오늘 브리핑
- 월간·연간 달력, drag-and-drop 일정 이동
- 완료 결과를 노트나 사용자 메모리에 연결하는 흐름
- 이메일, SMS, 외부 캘린더 읽기·쓰기
- 백그라운드 탭을 계속 실행시키는 polling, 화면 Wake Lock, 상시 마이크·hotword
- 푸시 알림에서 바로 완료·미루기 같은 인증 write를 수행하는 action
- offline app shell·응답 캐시·Service Worker `fetch` 가로채기
- task 우선순위를 LLM이 자동 결정하거나 대신 실행하는 기능
- 프로젝트·하위 task·공유·담당자·첨부 파일

## 4. 시간 규칙

### 4.1 정본 표현

- C1 timezone은 `Asia/Seoul`만 허용한다.
- 정확한 시각인 `due_at`, `remind_at`은 UTC Unix epoch seconds로 저장한다.
- 날짜만 있는 기한은 `due_date`에 KST 달력 날짜 `YYYY-MM-DD`로 저장하고 `due_at`은 `NULL`로 둔다.
- 서버 host timezone, 브라우저 timezone, SQLite `localtime`, offset 없는 `Date.parse()`에 의존하지 않는다.
- 브라우저는 날짜와 시각을 분리해 입력받고, 제출 전 `... KST` 절대 표현을 표시한다.
- API의 정확한 시각 문자열은 반드시 `YYYY-MM-DDTHH:mm:ss+09:00` 형식이어야 한다.
- 새 기한은 요청에서 캡처한 `now`보다 과거일 수 없고, 새 reminder는 `now + 60초` 이상이어야 한다. 둘 다 KST 기준 10년 이내만 허용한다.
- 날짜는 실제 달력에 존재해야 하며 `+09:00` 이외 offset은 거부한다.
- 기한 없는 task에 reminder를 두는 것과 마감 이후에 별도 후속 reminder를 두는 것은 둘 다 허용한다. 두 값은 독립된 사용자 약속이다.

HTML `datetime-local`은 timezone을 포함하지 않으므로 C1에서는 `date`와 `time` 입력을 분리한다. MDN 원문도 이 컨트롤을 “a local date and time”을 표현하는 것으로 설명한다.[^mdn-datetime-local]

### 4.2 Today 분류

한 API 요청은 `now`를 한 번만 캡처하고 그 값으로 KST의 `[오늘 00:00, 다음 날 00:00)`을 계산한다.

- **지연**: `due_date < 오늘` 또는 `due_at < now`
- **오늘**: `due_date = 오늘` 또는 `now <= due_at < 다음 날 00:00`
- **예정**: `due_date > 오늘` 또는 `due_at >= 다음 날 00:00`
- **Inbox**: `due_date IS NULL AND due_at IS NULL`

모든 활성 집합은 `status = 'active' AND lifecycle = 'active'`만 포함한다. reminder를 확인해도 task가 완료되지 않았다면 목록에서 사라지지 않는다.

### 4.3 catch-up

- Pi가 꺼져 있는 동안 지난 단발성 reminder는 다음 서버 시작 tick에서 한 번 `fired`로 바뀐다.
- 늦은 정도와 관계없이 같은 reminder 행 하나만 보인다.
- 사용자가 `확인`, `1시간 뒤`, `완료`, `취소` 중 하나를 누를 때까지 같은 unresolved 카드가 재접속 때 다시 보일 수 있다. 이는 중복 발화가 아니라 같은 영속 receipt의 재표시다.
- catch-up push는 `now - remind_at <= 24시간`인 unresolved reminder에만 생성한다. 그보다 오래된 reminder는 일정 에이전트에는 남기되 뒤늦은 잠금화면 알림으로 사용자를 방해하지 않는다.
- 보장 범위는 **occurrence key당 reminder 행 최대 한 개 + subscription당 delivery 행 최대 한 개 + 확인 전 계속 조회 가능**이다. push service 수락, 기기 표시, 사용자 확인의 exactly-once는 보장하지 않는다.

## 5. 상태 머신

### 5.1 task

```text
status:    active -> done | cancelled
lifecycle: active -> closed | deleted

완료: active/active -> done/closed
취소: active/active -> cancelled/closed
다시 열기: done|cancelled/closed -> active/active
삭제: */active|closed -> 기존 status/deleted
복원: */deleted -> 삭제 직전 lifecycle
```

- 확인 전 후보는 클라이언트 카드 상태일 뿐 DB task가 아니다.
- `snoozed`는 task 상태가 아니다.
- 제품 문구의 `소프트 딜리트`는 내부 `closed`, `딜리트`는 내부 `deleted`에 대응한다. 관용적인 용어와 반대 의미가 섞이지 않도록 API·DB에는 이 내부 이름만 쓴다.
- `closed`는 더 수정할 필요가 없는 종결 상태지만 검색·AI·이력 참조에는 남는다. `deleted`는 물리 보존·복구가 가능하되 일반 검색·AI·그래프·Codex 대상에서 제외한다.
- 다시 열기·복원은 기존 reminder를 자동 복구하지 않는다. 사용자가 새 알림을 확인해 만들어야 한다.
- 상태 전이는 append-only `assistant_task_events`에도 남기되 현재 task 행을 정본으로 유지한다. event replay로 현재 상태를 재구성하지 않는다.

### 5.2 reminder

```text
pending -> fired -> acknowledged
pending | fired -> cancelled

fired --1시간 뒤--> acknowledged(action=snoozed)
                      + 새 pending reminder 1개
```

- `pending -> fired`는 scheduler만 수행한다.
- 단순 GET, 패널 열기, 브라우저 focus는 상태를 바꾸지 않는다.
- 완료 transaction은 pending reminder를 cancelled로, fired reminder를 acknowledged(`completed`)로 만든다.
- 취소 transaction은 pending·fired reminder를 cancelled로 만든다.
- 삭제 transaction은 pending·fired reminder를 `task_deleted` 사유로 cancelled로 만든다.
- terminal reminder는 되돌리지 않고 감사 이력으로 보존한다.

### 5.3 경합 규칙

모든 쓰기는 같은 SQLite connection의 transaction과 조건부 상태 갱신으로 직렬화한다.

- 완료/취소가 먼저 commit되면 scheduler는 해당 task의 reminder를 fire하지 못한다.
- 완료·취소·삭제 transaction은 unresolved reminder를 정리하고 아직 전송하지 않은 `pending | retry` delivery를 `skipped`로 만든다.
- dispatcher는 claim 뒤와 네트워크 호출 직전에 task lifecycle·reminder 상태를 다시 확인한다. 이미 외부 push service로 나간 요청은 회수할 수 없지만 그 결과가 task 상태를 되돌리지는 않는다.
- scheduler가 먼저 fire해도 뒤이은 완료/취소 transaction이 unresolved reminder를 정리한다.
- 수정 요청은 task `version`이 맞을 때만 적용한다. 다르면 `409 Conflict`와 최신 task를 반환한다.
- 같은 create·snooze 요청을 재전송하면 새 행을 만들지 않고 첫 결과를 반환한다.

SQLite 공식 문서는 동시 read transaction은 여러 개 가능하지만 “only one simultaneous write transaction”이라고 명시한다.[^sqlite-transaction] 이 직렬성만 믿지 않고 조건부 UPDATE와 UNIQUE 제약을 함께 둔다.

## 6. 정본 schema

운영 Pi는 2026-07-19 schema v4→5→6→7을 한 번에 적용했다. 노트 `ai_readable` 접근 경계인 schema v5, C1 task core인 **schema v6**, 독립 feature flag로 끌 수 있는 Web Push subscription·delivery outbox **schema v7**이 현재 운영 정본이다.

### 6.1 schema v5 — 노트 AI 읽기 경계

```sql
ALTER TABLE notes ADD COLUMN ai_readable INTEGER NOT NULL DEFAULT 1
  CHECK (ai_readable IN (0, 1));
```

- 기존 노트는 동작 보존을 위해 `1`로 이관하고, `/sync`가 Markdown frontmatter의 명시적 `ai_readable: false`를 `0`으로 반영한다. 값이 없으면 레거시 호환으로 `true`, 잘못된 값은 fail-close로 `false`다.
- `0`인 노트는 답변 컨텍스트·자동 검색·A1b 청크·논문 전문·MCP AI 조회·임베딩·Codex 대상/참고 허용 목록·AI 파생 그래프에서 제외한다. 사용자의 일반 목록과 직접 열람은 유지한다.
- 이 값은 앱과 모델 컨텍스트를 가르는 정책 경계이지 암호화나 별도 OS 사용자 격리가 아니다. 비밀 키·인증정보 저장소로 사용하지 않는다.
- 현재 vault와 파일명 정본은 그대로 둔다. 에이전트별 폴더, 범용 ACL, `relative_path`는 만들지 않는다.

### 6.2 schema v6 — task·event·reminder

```sql
CREATE TABLE assistant_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_request_id TEXT NOT NULL UNIQUE,
  create_payload_sha256 TEXT NOT NULL
    CHECK (length(create_payload_sha256) = 64),
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  detail TEXT NOT NULL DEFAULT '' CHECK (length(detail) <= 2000),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'done', 'cancelled')),
  lifecycle TEXT NOT NULL DEFAULT 'active'
    CHECK (lifecycle IN ('active', 'closed', 'deleted')),
  deleted_from_lifecycle TEXT
    CHECK (deleted_from_lifecycle IN ('active', 'closed')),
  due_kind TEXT NOT NULL DEFAULT 'none'
    CHECK (due_kind IN ('none', 'date', 'datetime')),
  due_date TEXT,
  due_at INTEGER,
  timezone TEXT NOT NULL DEFAULT 'Asia/Seoul'
    CHECK (timezone = 'Asia/Seoul'),
  reminder_version INTEGER NOT NULL DEFAULT 1
    CHECK (reminder_version >= 1),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  completed_at INTEGER,
  cancelled_at INTEGER,
  closed_at INTEGER,
  deleted_at INTEGER,
  CHECK (
    (due_kind = 'none' AND due_date IS NULL AND due_at IS NULL) OR
    (due_kind = 'date' AND due_date GLOB '????-??-??' AND due_at IS NULL) OR
    (due_kind = 'datetime' AND due_date IS NULL AND due_at IS NOT NULL)
  ),
  CHECK (
    (status = 'active' AND completed_at IS NULL AND cancelled_at IS NULL) OR
    (status = 'done' AND completed_at IS NOT NULL AND cancelled_at IS NULL) OR
    (status = 'cancelled' AND completed_at IS NULL AND cancelled_at IS NOT NULL)
  ),
  CHECK (
    (lifecycle = 'active' AND status = 'active' AND closed_at IS NULL
      AND deleted_at IS NULL AND deleted_from_lifecycle IS NULL) OR
    (lifecycle = 'closed' AND status IN ('done', 'cancelled') AND closed_at IS NOT NULL
      AND deleted_at IS NULL AND deleted_from_lifecycle IS NULL) OR
    (lifecycle = 'deleted' AND deleted_at IS NOT NULL
      AND deleted_from_lifecycle IN ('active', 'closed')
      AND ((deleted_from_lifecycle = 'active' AND closed_at IS NULL) OR
           (deleted_from_lifecycle = 'closed' AND closed_at IS NOT NULL)))
  )
);

CREATE TABLE assistant_task_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'created', 'updated', 'completed', 'cancelled', 'reopened', 'deleted', 'restored'
  )),
  from_status TEXT CHECK (from_status IN ('active', 'done', 'cancelled')),
  to_status TEXT NOT NULL CHECK (to_status IN ('active', 'done', 'cancelled')),
  from_lifecycle TEXT CHECK (from_lifecycle IN ('active', 'closed', 'deleted')),
  to_lifecycle TEXT NOT NULL CHECK (to_lifecycle IN ('active', 'closed', 'deleted')),
  task_version INTEGER NOT NULL CHECK (task_version >= 1),
  actor_type TEXT NOT NULL DEFAULT 'user'
    CHECK (actor_type IN ('user', 'system')),
  occurred_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  FOREIGN KEY (task_id) REFERENCES assistant_tasks(id)
);

CREATE TABLE assistant_reminders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL,
  remind_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'fired', 'acknowledged', 'cancelled')),
  occurrence_key TEXT NOT NULL UNIQUE,
  snoozed_from_id INTEGER,
  snooze_request_key TEXT UNIQUE,
  fired_at INTEGER,
  acknowledged_at INTEGER,
  acknowledgement_action TEXT
    CHECK (acknowledgement_action IN ('seen', 'snoozed', 'completed')),
  cancellation_reason TEXT CHECK (cancellation_reason IN (
    'task_completed', 'task_cancelled', 'task_deleted', 'replaced', 'removed'
  )),
  cancelled_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  FOREIGN KEY (task_id) REFERENCES assistant_tasks(id),
  FOREIGN KEY (snoozed_from_id) REFERENCES assistant_reminders(id),
  CHECK (
    (snoozed_from_id IS NULL AND snooze_request_key IS NULL) OR
    (snoozed_from_id IS NOT NULL AND snooze_request_key IS NOT NULL)
  ),
  CHECK (
    (status = 'pending' AND fired_at IS NULL AND acknowledged_at IS NULL
      AND acknowledgement_action IS NULL AND cancellation_reason IS NULL
      AND cancelled_at IS NULL) OR
    (status = 'fired' AND fired_at IS NOT NULL AND acknowledged_at IS NULL
      AND acknowledgement_action IS NULL AND cancellation_reason IS NULL
      AND cancelled_at IS NULL) OR
    (status = 'acknowledged' AND fired_at IS NOT NULL AND acknowledged_at IS NOT NULL
      AND acknowledgement_action IS NOT NULL AND cancellation_reason IS NULL
      AND cancelled_at IS NULL) OR
    (status = 'cancelled' AND acknowledged_at IS NULL
      AND acknowledgement_action IS NULL AND cancellation_reason IS NOT NULL
      AND cancelled_at IS NOT NULL)
  )
);

CREATE INDEX idx_assistant_tasks_status_due_date
  ON assistant_tasks(status, due_date);
CREATE INDEX idx_assistant_tasks_status_due_at
  ON assistant_tasks(status, due_at);
CREATE INDEX idx_assistant_tasks_lifecycle_updated
  ON assistant_tasks(lifecycle, updated_at);
CREATE INDEX idx_assistant_task_events_task_occurred
  ON assistant_task_events(task_id, occurred_at, id);
CREATE INDEX idx_assistant_reminders_status_remind_at
  ON assistant_reminders(status, remind_at);
CREATE INDEX idx_assistant_reminders_task_status
  ON assistant_reminders(task_id, status);
CREATE UNIQUE INDEX idx_assistant_reminders_one_live_per_task
  ON assistant_reminders(task_id)
  WHERE status IN ('pending', 'fired');
```

### 6.3 schema v7 — Web Push 구독·delivery outbox

```sql
CREATE TABLE assistant_push_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  endpoint TEXT NOT NULL UNIQUE CHECK (length(endpoint) BETWEEN 1 AND 2048),
  p256dh TEXT NOT NULL CHECK (length(p256dh) BETWEEN 1 AND 256),
  auth TEXT NOT NULL CHECK (length(auth) BETWEEN 1 AND 128),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'expired', 'revoked')),
  device_label TEXT NOT NULL DEFAULT '' CHECK (length(device_label) <= 80),
  failure_count INTEGER NOT NULL DEFAULT 0 CHECK (failure_count >= 0),
  last_success_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

CREATE TABLE assistant_push_deliveries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reminder_id INTEGER NOT NULL,
  subscription_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN (
      'pending', 'sending', 'retry', 'accepted', 'failed', 'expired', 'skipped'
    )),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  lease_until INTEGER,
  last_attempt_at INTEGER,
  last_http_status INTEGER,
  last_error_code TEXT CHECK (length(last_error_code) <= 80),
  accepted_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  FOREIGN KEY (reminder_id) REFERENCES assistant_reminders(id),
  FOREIGN KEY (subscription_id) REFERENCES assistant_push_subscriptions(id),
  UNIQUE (reminder_id, subscription_id),
  CHECK (expires_at >= created_at),
  CHECK (
    (status = 'sending' AND lease_until IS NOT NULL) OR
    (status != 'sending' AND lease_until IS NULL)
  )
);

CREATE INDEX idx_assistant_push_deliveries_due
  ON assistant_push_deliveries(status, next_attempt_at);
CREATE INDEX idx_assistant_push_deliveries_lease
  ON assistant_push_deliveries(status, lease_until);
CREATE INDEX idx_assistant_push_deliveries_reminder
  ON assistant_push_deliveries(reminder_id, status);
```

### 6.4 불변식

- task당 live reminder는 `pending | fired` 합쳐 최대 하나다.
- `assistant_tasks`의 현재 행이 정본이고 `assistant_task_events`는 전이 감사 로그다. 같은 결과 상태 재요청은 새 event를 만들지 않는다.
- `closed` task는 참조 가능하지만 수정할 수 없다. `deleted` task는 복구 API 이외의 일반 조회·알림·AI 후보에서 제외한다.
- create 시 정규화한 최초 payload의 SHA-256을 `create_payload_sha256`에 고정하고 이후 task 수정 때 바꾸지 않는다. 같은 `client_request_id` retry는 이 hash가 같을 때만 기존 task의 현재 상태를 `replayed: true`로 반환한다.
- canonical payload는 NFC 정규화·양끝 공백 제거한 `title`, `detail`과 서버가 확정한 `dueKind`, `dueDate`, `dueAt`, `reminderAt`을 고정된 key 순서의 JSON으로 직렬화한 값이다. request ID는 hash에서 제외한다.
- `occurrence_key`는 서버가 `task:{taskId}:v{reminderVersion}:{remindAt}` 형태로 만든다. 현재 tick 시각으로 만들지 않는다.
- reminder를 바꾸거나 제거하면 같은 transaction에서 `reminder_version`을 올리고 기존 live reminder를 취소한 뒤, 교체하는 경우에만 새 key의 reminder를 만든다. task 기한만 바꾸고 reminder를 `keep`한 경우에는 올리지 않는다.
- snooze child의 key는 원 reminder ID와 검증된 `snooze_request_key`의 SHA-256으로 만든다.
- `client_request_id`, `snooze_request_key`는 8~128자의 제한된 ASCII 토큰만 받는다.
- 날짜의 실제 유효성, epoch 범위, 문자열 상한은 DB CHECK에만 기대지 않고 API에서도 검증한다.
- 물리 purge는 C1 API에 제공하지 않는다. 제품의 삭제는 `lifecycle=deleted` 전이이고 복구 가능하다.
- reminder가 `fired`로 바뀌는 transaction 안에서 그 시점의 active subscription마다 delivery 행을 `INSERT ... ON CONFLICT DO NOTHING`으로 만든다. push 네트워크 호출은 commit 뒤 별도 dispatcher만 수행한다.
- 완료·취소·삭제 시 아직 전송하지 않은 delivery는 같은 transaction에서 `skipped`로 바꾼다. dispatcher는 네트워크 호출 직전 정본을 재검증한다.
- 새 subscription을 등록해도 이미 fired인 과거 reminder를 backfill하지 않는다. 일정 에이전트의 unresolved reminder는 그대로 조회된다.
- delivery의 `accepted`는 push service의 HTTP 수락일 뿐 기기 표시·사용자 확인이 아니다. task·reminder 상태는 앱의 ack·complete·snooze 요청만 바꾼다.
- subscription endpoint는 서버가 요청하는 capability URL이다. HTTPS push-service host allowlist를 적용하고 IP literal·loopback·private address·redirect를 거부해 SSRF 경계를 둔다.

기존 `server.js`는 `PRAGMA foreign_keys = ON`을 명시하지 않지만 2026-07-18 읽기 전용 확인에서 로컬과 Pi better-sqlite3 연결은 모두 `foreign_keys=1`, `foreign_key_check` 0건이었고 Pi schema는 v4였다. C1은 연결 직후 이를 명시적으로 `ON`으로 설정하고 다시 읽어 `1`이 아니면 시작을 중단한다. store의 부모 존재 검증과 조건부 UPDATE도 그대로 두며, snooze child는 원 reminder와 같은 task에만 연결할 수 있다.

## 7. scheduler와 영속 알림

### 7.1 모듈 경계

- `lib/assistant-tasks.js`: 검증, 정본 CRUD, 상태 전이, 목록 조회
- `lib/assistant-scheduler.js`: 주입 가능한 `clock`, `tick(now)`, start/stop
- `lib/assistant-push.js`: subscription 검증, delivery outbox, lease·재시도 상태 기계
- `lib/web-push-transport.js`: `web-push` 암호화·VAPID·provider HTTP 전송 어댑터
- `lib/assistant-push-config.js`, `lib/assistant-push-routes.js`: fail-close 환경 설정과 인증 뒤 구독 API
- `server.js`: 설정과 얇은 route, `/api/notifications` 합성, worker lifecycle 연결
- `public/sw.js`: `push` 표시와 `notificationclick`만 담당

기존 `server.js` 전체 분해는 하지 않는다. 프론트에서는 범용 알림 renderer를 `NotificationPanel`, 일정 renderer를 `TaskPanel`로 분리하되 지식 시트 shell 자체는 유지한다.

### 7.2 한 tick

```text
server listen 완료
  -> 즉시 tick(capturedNow)
  -> 이후 30초마다 tick

tick transaction
  -> status='active' AND lifecycle='active' task에 속한 pending reminder 중 remind_at <= now
  -> remind_at, id 순으로 최대 100개 선택
  -> status=fired, fired_at=now, updated_at=now 조건부 갱신
  -> 24시간 이내 catch-up이면 active subscription별 delivery INSERT
  -> commit

push dispatcher
  -> commit된 pending/retry delivery를 조건부 UPDATE로 sending lease claim
  -> 네트워크 전송
  -> 결과를 accepted/retry/failed/expired로 기록
```

- `<= now`를 사용해 정확히 경계에 도달한 항목도 처리한다. 다음 30초 tick을 미리 당겨 처리하지 않으므로 조기 발송은 없고, 정상 event loop에서 tick 대기 지연은 30초 미만이다.
- reminder 행은 약속 occurrence와 사용자 확인 상태의 정본이고, subscription별 delivery 행은 push outbox·전송 receipt다.
- `/api/notifications`는 `fired` 행을 읽기만 하므로 commit 뒤 crash가 나도 다음 시작에 유실되지 않는다.
- 한 tick 실패는 transaction 전체를 rollback하고 다음 tick에서 재시도한다.
- in-memory overlap guard, SQLite write transaction, `status = pending` 조건, UNIQUE를 겹쳐 방어한다.
- interval·HTTP server·dispatcher handle을 보관한다. 종료 신호에서 scheduler를 멈추고, 새 delivery claim을 막고, 진행 중 전송을 제한 시간 안에 끝낸 뒤 HTTP server와 DB를 닫는다.
- 개인용 범위를 벗어난 100개 초과 backlog는 다음 분 tick에서 이어 처리한다.
- delivery claim은 짧은 transaction에서 `status IN ('pending','retry') AND next_attempt_at <= now` 조건부 UPDATE로 `sending`, `lease_until=now+고정 lease`를 기록한다. 네트워크 timeout은 lease보다 짧게 고정하고, 한 worker만 변경 행 수 1을 얻는다.
- 시작 시와 각 dispatcher loop에서 만료된 `sending` lease를 `retry`로 회수한다. 전송 수락 뒤 receipt commit 전에 죽은 경우 재전송될 수 있으므로 stable notification tag는 계속 필요하다.
- schema v7이 없거나 `WEB_PUSH_ENABLED=false`면 delivery insert·dispatcher 분기를 건너뛴다. C1b scheduler는 reminder만 `fired`로 만들고 C1c가 같은 transaction에 outbox 생성을 확장한다.

### 7.3 알림 새로고침

- 앱 시작, 브라우저 focus, `visibilitychange`로 다시 visible이 될 때, foreground 60초 간격으로 task 알림을 갱신한다.
- 기존 채팅 7초 polling에 붙이지 않는다. 여러 탭에서 API rate limit을 불필요하게 소모하지 않기 위해서다.
- hidden/frozen 탭의 timer를 정확한 알림 장치로 사용하지 않는다. 백그라운드·종료 상태의 전달은 서버 scheduler와 Web Push가 맡는다.
- GET은 어떤 상태도 변경하지 않는다.

### 7.4 Web Push 전송 규칙

- `2xx`: delivery를 `accepted`로 기록한다. 화면 표시나 사용자가 봤다는 뜻으로 해석하지 않는다.
- `404 | 410`: delivery를 `expired`, subscription을 `expired`로 바꾸고 이후 대상에서 제외한다.
- `408 | 429 | 5xx | network error`: `Retry-After`를 우선하고, 없으면 jitter를 더한 bounded exponential backoff로 TTL 안에서 재시도한다.
- `400 | 401 | 403 | 413`: 구성·payload의 영구 실패로 기록하고 자동 무한 재시도하지 않는다.
- 프로세스가 commit 뒤 죽으면 시작 worker가 만료되지 않은 `pending | retry`를 다시 처리한다. `(reminder_id, subscription_id)` UNIQUE로 중복 outbox를 막고, `task-reminder:{reminderId}` notification tag로 기기에 보이는 중복을 완화한다.
- `sending` worker가 죽으면 lease 만료 뒤 `retry`로 회수한다. claim lease는 HTTP timeout보다 길어야 하며 terminal 결과 갱신은 현재 `status=sending`과 claim 때 받은 `lease_until` 값이 모두 같은 경우에만 적용한다.
- payload는 Service Worker가 추가 fetch 없이 표시할 수 있는 일반 문구와 불투명 reminder ID·앱 내부 경로만 담는다. task 제목·설명·노트 본문·API token·subscription key를 넣지 않는다.
- Service Worker는 push event마다 반드시 `showNotification()`을 호출한다. 알림 클릭은 기존 창에 focus하거나 앱을 열 뿐 완료·확인·미루기를 실행하지 않는다.

### 7.5 HTTPS·PWA·백그라운드 계약

Service Worker와 Push API는 secure context가 필요하므로 현재 `http://<Pi_IP>:3000`을 설치 origin으로 쓰지 않는다. C1은 공개 Funnel 없이 private tailnet 안의 `https://<Pi노드>.<tailnet>.ts.net`을 **단일 canonical origin**으로 고정하고, Pi의 `tailscale serve --bg 3000` 계열 reverse proxy로 `127.0.0.1:3000`을 노출한다.[^tailscale-serve]

- `manifest.webmanifest`에 앱 이름·아이콘·안정된 `id`·`start_url`·`scope`·`display: standalone`을 둔다.
- `public/sw.js`는 첫 버전에서 `fetch` handler와 offline cache를 두지 않는다. 배포 직후 낡은 HTML/JS가 남는 위험을 만들지 않고 push·click만 담당한다.
- 알림 권한과 `PushManager.subscribe({ userVisibleOnly: true, applicationServerKey })`는 사용자가 설치된 앱에서 `알림 켜기`를 직접 누른 뒤에만 요청한다.[^webkit-ios-push]
- iPhone·iPad는 iOS/iPadOS 16.4 이상에서 **홈 화면에 추가한 웹 앱**만 대상으로 한다. 일반 Safari 탭만 열어 둔 상태를 지원 계약으로 삼지 않는다.[^webkit-ios-push]
- 브라우저는 hidden page를 freeze/discard하고 timer를 throttle할 수 있다. Screen Wake Lock도 “Only active documents can acquire screen wake locks”이므로 백그라운드 실행 수단이 아니다.[^chrome-lifecycle][^mdn-wake-lock]
- 따라서 C1의 계약은 `백그라운드에서 계속 refresh`가 아니라 `Pi가 시각을 판정 -> push가 Service Worker를 이벤트성으로 깨움 -> 앱을 열거나 다시 visible일 때 DB 정본 재동기화`다.
- PWA 설치도 상시 JavaScript·상시 마이크를 보장하지 않는다. 향후 음성 hotword가 필요하면 Pi 상시 listener 또는 별도 native 앱을 다시 판단한다. 일반 일정 알림에는 native 앱이 필수가 아니다.
- HTTP IP origin의 `localStorage`는 새 HTTPS origin으로 이전되지 않는다. 첫 전환 때 사용자가 API token을 한 번 다시 입력하고, 서버의 공유 대화·task 정본은 그대로 유지한다.
- Service Worker는 현재 API token이 든 `localStorage`를 읽지 않는다. token을 push payload·URL·Service Worker 저장소로 복제하지 않는다.

## 8. API 계약

모든 endpoint는 기존 `requireApiToken` 뒤에 둔다. JSON 이외 입력은 거부한다. 현행 프론트 관례에 맞춰 오류 응답은 사용자용 `error`, 기계 판별용 `code`, 필요한 경우 최신 `task`를 반환한다.

### 8.1 목록

```http
GET /api/tasks?view=today|upcoming|inbox|all|history|trash&status=done|cancelled|all&limit=100
```

- `today`: 지연과 오늘을 각각 정렬해 반환
- `upcoming`: 가까운 기한순
- `inbox`: 최근 수정순
- `all`: 모든 active task를 기한순·최근 수정순으로 조회
- `history`: `closed` task를 최근 상태 변경순으로 조회. `status` 기본값은 `all`이며 이 view에서만 받는다.
- `trash`: `deleted` task를 삭제 최근순으로 조회. 복구 UI에서만 호출하고 일반 검색·알림·AI 조회에는 합성하지 않는다.
- 각 task 항목은 현재 `pending | fired` reminder 하나를 `reminder`로 함께 반환하며 없으면 `null`이다. terminal reminder 이력 전체는 목록 응답에 싣지 않는다.

### 8.2 일정 에이전트 요약

```http
GET /api/tasks/summary?calendarCenter=2026-07-20
```

한 요청에서 `now`를 한 번 캡처해 현재 KST 주간과 모든 건수를 일관되게 계산한다. `calendarCenter`는 선택적 KST 월요일이며 생략하면 현재 주를 중앙으로 쓴다. 월요일이 아니거나 잘못된 날짜는 `INVALID_CALENDAR_WEEK`로 거부한다.

```json
{
  "capturedAt": 1784534400,
  "timezone": "Asia/Seoul",
  "counts": { "overdue": 1, "today": 2, "upcoming": 4, "inbox": 3 },
  "currentWeekStart": "2026-07-20",
  "calendarCenter": "2026-07-20",
  "calendar": [
    {
      "startDate": "2026-07-13",
      "days": [
        { "date": "2026-07-13", "count": 0, "isToday": false },
        { "date": "2026-07-14", "count": 0, "isToday": false },
        { "date": "2026-07-15", "count": 0, "isToday": false },
        { "date": "2026-07-16", "count": 0, "isToday": false },
        { "date": "2026-07-17", "count": 0, "isToday": false },
        { "date": "2026-07-18", "count": 0, "isToday": false },
        { "date": "2026-07-19", "count": 0, "isToday": false }
      ]
    },
    {
      "startDate": "2026-07-20",
      "days": [
        { "date": "2026-07-20", "count": 2, "isToday": true },
        { "date": "2026-07-21", "count": 1, "isToday": false },
        { "date": "2026-07-22", "count": 0, "isToday": false },
        { "date": "2026-07-23", "count": 1, "isToday": false },
        { "date": "2026-07-24", "count": 0, "isToday": false },
        { "date": "2026-07-25", "count": 0, "isToday": false },
        { "date": "2026-07-26", "count": 0, "isToday": false }
      ]
    },
    {
      "startDate": "2026-07-27",
      "days": [
        { "date": "2026-07-27", "count": 0, "isToday": false },
        { "date": "2026-07-28", "count": 0, "isToday": false },
        { "date": "2026-07-29", "count": 0, "isToday": false },
        { "date": "2026-07-30", "count": 0, "isToday": false },
        { "date": "2026-07-31", "count": 0, "isToday": false },
        { "date": "2026-08-01", "count": 0, "isToday": false },
        { "date": "2026-08-02", "count": 0, "isToday": false }
      ]
    }
  ],
  "week": [
    { "date": "2026-07-20", "count": 2, "isToday": true },
    { "date": "2026-07-21", "count": 1, "isToday": false },
    { "date": "2026-07-22", "count": 0, "isToday": false },
    { "date": "2026-07-23", "count": 1, "isToday": false },
    { "date": "2026-07-24", "count": 0, "isToday": false },
    { "date": "2026-07-25", "count": 0, "isToday": false },
    { "date": "2026-07-26", "count": 0, "isToday": false }
  ],
  "preview": [
    {
      "taskId": 7,
      "title": "보험 갱신",
      "bucket": "overdue",
      "dueKind": "date",
      "dueDate": "2026-07-19",
      "dueAt": null
    }
  ],
  "nextReminder": {
    "reminderId": 42,
    "taskId": 8,
    "title": "보고서 초안",
    "remindAt": 1784538000
  }
}
```

- `calendar`는 중앙 주의 이전·중앙·다음 주 3개이고 각 `days`는 KST 월요일부터 일요일까지 정확히 7개다. 한 응답의 날짜 셀은 항상 21개다.
- 각 날짜의 `count`는 그날 마감하는 `status='active' AND lifecycle='active'` task 수다. 지연 항목을 오늘 건수에 합치지 않는다.
- `week`은 기존 소비자를 위한 중앙 주 `days` 별칭이다. `currentWeekStart`는 실제 오늘이 속한 주, `calendarCenter`는 사용자가 탐색 중인 중앙 주다.
- `preview`는 `taskId`, `title`, `bucket`, `dueKind`, `dueDate`, `dueAt`만 가진 최대 3개 task다. `bucket`은 `overdue | today`이며 지연을 먼저 둔다. 같은 bucket에서는 KST 마감 날짜, `datetime` 우선, `dueAt`, `taskId` 순으로 안정 정렬한다.
- `nextReminder`는 `status='active' AND lifecycle='active'` task에 속하고 현재 시각 이후인 가장 이른 pending reminder의 `reminderId`, `taskId`, `title`, `remindAt` 또는 `null`이다. 동률이면 reminder ID가 작은 것을 고른다.
- `counts`는 응답 limit과 무관한 전체 건수다. 제목·설명은 기존 인증 뒤에서만 반환하고 GET은 상태를 바꾸지 않는다.
- Web Push 표시는 이 응답에 섞지 않는다. 클라이언트가 `/api/push/config`, `Notification.permission`, 현재 Service Worker subscription을 결합해 이 브라우저 상태만 표시한다.

### 8.3 생성

```http
POST /api/tasks
Content-Type: application/json

{
  "clientRequestId": "web-7f5d1d6e-...",
  "title": "보고서 초안",
  "detail": "1차 목차까지",
  "due": {
    "kind": "datetime",
    "at": "2026-07-20T18:00:00+09:00"
  },
  "reminderAt": "2026-07-20T17:00:00+09:00"
}
```

날짜만이면 `due`는 `{ "kind": "date", "date": "2026-07-20" }`, 기한이 없으면 `{ "kind": "none" }`이다. 같은 `clientRequestId`와 같은 canonical payload 재요청은 새 행 없이 기존 task의 현재 상태를 반환하고, payload가 다르면 `409`다.

### 8.4 수정

```http
PATCH /api/tasks/:id

{
  "expectedVersion": 3,
  "title": "보고서 초안 수정",
  "due": { "kind": "date", "date": "2026-07-21" },
  "reminderChange": {
    "action": "replace",
    "at": "2026-07-21T09:00:00+09:00"
  }
}
```

`reminderChange.action`은 `keep | replace | remove`다. 기한과 reminder 변경은 하나의 transaction으로 처리한다. active task만 수정할 수 있다.

### 8.5 task 상태·lifecycle

```http
POST /api/tasks/:id/complete  { "expectedVersion": 3 }
POST /api/tasks/:id/cancel    { "expectedVersion": 3 }
POST /api/tasks/:id/reopen    { "expectedVersion": 4 }
POST /api/tasks/:id/delete    { "expectedVersion": 4 }
POST /api/tasks/:id/restore   { "expectedVersion": 5 }
```

완료·취소는 `closed`, 삭제는 `deleted`로 전이한다. 복원은 삭제 직전 `active | closed` lifecycle로 돌아가고, 다시 열기는 `closed` task만 `active`로 돌린다. 같은 결과 상태에 대한 재요청은 멱등적으로 현재 값을 반환한다. 서로 다른 최신 변경과 충돌하면 `409`다.

### 8.6 reminder 행동

```http
POST /api/reminders/:id/acknowledge
{}

POST /api/reminders/:id/snooze
{
  "requestKey": "web-snooze-91a4...",
  "minutes": 60
}
```

C1 snooze는 `minutes = 60`만 허용한다. retry는 같은 child reminder를 반환한다. pending·acknowledged·cancelled reminder나 inactive task에는 새 snooze를 만들지 않는다.

handler는 응답 유실 retry를 위해 먼저 `(snoozed_from_id, snooze_request_key)`가 같은 기존 child를 조회한다. 있으면 그 행을 반환하고, 없을 때만 원 reminder가 현재 `fired`인지 검사해 새 child를 만든다.

### 8.7 일정 알림 합성

기존 `GET /api/notifications` 응답에 아래 source를 추가한다.

```json
{
  "id": "task-reminder:42",
  "source": "task",
  "type": "task_reminder",
  "taskId": 7,
  "taskVersion": 3,
  "reminderId": 42,
  "title": "보고서 초안",
  "remindAt": 1784534400,
  "firedAt": 1784534460
}
```

클라이언트는 `item.type === 'task_reminder'`를 범용 알림 탭에서 제외하고 일정 에이전트에서 `TaskPanel` 전용 renderer로 그린다. 기존 `/approve`, `/ignore`를 호출하지 않고 reminder 전용 endpoint를 사용한다.

### 8.8 Web Push 구독

```http
GET    /api/push/config
POST   /api/push/subscriptions
DELETE /api/push/subscriptions/:id
```

- config는 `enabled`, VAPID public key와 canonical origin·설치 안내를 그릴 최소 정보만 반환한다. 권한·구독 상태는 브라우저에서 직접 읽으며 private key는 절대 반환하지 않는다.
- 등록 body는 브라우저 `PushSubscription.toJSON()`의 `endpoint`, `keys.p256dh`, `keys.auth`와 선택적 device label만 받는다. capability URL인 endpoint는 원문 그대로 저장하고 URL parse·HTTPS·host·주소 정책만 검증한 뒤 upsert한다.
- 등록·해제는 기존 API token 인증과 JSON 상한을 적용한다. endpoint·키 원문을 request/server log에 남기지 않는다.
- 해제는 행을 물리 삭제하지 않고 `revoked`로 바꾼다. 브라우저의 `unsubscribe()` 실패와 서버 해제 실패를 각각 사용자에게 알려 재시도할 수 있게 한다.
- 권한이 `denied`거나 Push API가 없으면 계속 요청하지 않고 일정 에이전트의 in-app fallback 상태를 표시한다.

### 8.9 노트와의 관계

- C1의 모든 일정은 SQLite task 정본에 저장하며 일정마다 노트를 자동 생성하지 않는다.
- 사용자가 기존 일반 노트를 관련 자료로 연결해도 task 완료·취소·삭제가 그 노트 lifecycle을 바꾸지 않는다.
- 향후 공용 에이전트 노트 계층에서 전용 `task_note`를 명시적으로 만든 경우에만 완료·취소 시 결정론적 종결 한 줄을 붙이고 `closed`, 잘못 만든 task 삭제 시 `deleted`로 맞춘다.
- C1에는 task-note 자동 생성·본문 수정·Codex 호출을 넣지 않는다. 링크 schema와 권한은 공용 에이전트 노트 설계에서 따로 확정한다.

## 9. UI 세부 규칙

### 9.1 작성 카드

- 제목 200자, 설명 2,000자 상한을 남은 글자 수와 함께 표시한다.
- 기한 종류를 먼저 고르고 날짜·시각 필드를 필요한 만큼만 연다.
- reminder toggle을 켜야 별도 날짜·시각이 나타난다.
- 제출 버튼 바로 위에 굵지 않은 절대 KST 요약을 보여준다.
- 과거 기한, 1분보다 가까운 reminder, 10년을 넘는 날짜는 제출 전에 차단한다.
- 전송 중 버튼을 잠그되 같은 `clientRequestId`를 유지해 네트워크 retry를 안전하게 만든다.

### 9.2 task 카드

- 제목, 기한, 지연 정도, 선택적 설명을 보여준다.
- active 카드 행동은 `완료 | 수정 | 취소 | 삭제`다.
- reminder 카드는 `확인 | 1시간 뒤 | 완료`다.
- 종결 카드 행동은 `다시 열기 | 삭제`, 삭제 복구 카드 행동은 `복원`이다.
- due와 reminder를 혼동하지 않도록 각각 `마감`, `알림` label을 붙인다.
- 390px에서는 행동 버튼이 카드 밖으로 넘치지 않고 두 줄까지 재배치된다.
- keyboard focus, 버튼 accessible name, `aria-live` 성공·오류 안내를 제공한다.

### 9.3 에이전트 탭 일정 블록

- 현재 갈피의 색·서체·radius·다크모드 token을 그대로 사용한다. 새 palette·font·component library를 도입하지 않는다.
- 350px 데스크톱 패널과 모바일 76dvh bottom sheet에서 같은 정보 순서를 유지한다. 월간 달력 대신 이전·현재·다음 3주만 가진 native horizontal scroll-snap을 사용한다.
- 제목과 알림 상태, 주간 이동, 확인할 알림, 네 건수, 미리보기, 다음 알림, 두 진입 버튼 순으로 한 개의 표면 안에 배치한다. 카드 안에 다시 여러 카드를 중첩하지 않는다.
- 날짜 셀은 선택·편집 버튼이 아니라 탐색용 표식이다. 주 단위 스와이프가 끝났을 때만 새 중앙 주를 조회하고 다시 3주로 제한해 DOM을 누적하지 않는다.
- `지연`, `오늘`, `예정`, `Inbox`는 색만으로 구분하지 않고 항상 text label과 숫자를 함께 표시한다. 숫자는 tabular figures를 사용한다.
- `일정 추가`, `전체 일정`, `알림 켜기`의 모바일 hit area는 최소 44px이며 keyboard focus와 screen-reader name을 제공한다.
- loading은 최종 블록 높이를 예약하는 skeleton, 전체 active task가 0개인 empty는 `등록된 일정 없음`과 `일정 추가`, error는 원인을 숨기지 않는 짧은 문구와 `다시 시도`를 표시한다. 중앙 주 count만 모두 0이고 upcoming·Inbox가 남아 있으면 블록을 비우지 않고 주간 스트립에 `이번 주 마감 없음`을 표시한다.
- `WEB_PUSH_ENABLED=false`이거나 schema v7 배포 전이면 비대화형 `알림 준비 중`, Push API·Service Worker를 지원하지 않으면 `알림 미지원`을 표시하고 버튼을 숨긴다. 상태를 읽는 동안은 `확인 중`, 구독이 있으면 `알림 켜짐`, 권한이 `denied`면 재요청 없이 `알림 차단됨`, 그 밖의 지원 가능한 미구독 상태에서만 `알림 켜기` 버튼을 보인다.
- 탭을 처음 열 때, 앱 시작·focus·hidden→visible 복귀, foreground 60초 tick, task mutation 성공 뒤 일정 에이전트를 갱신한다. 범용 알림의 일반 source는 별도 `NotificationPanel`이 갱신하며 기존 채팅 7초 polling에는 연결하지 않는다.
- `public/agent-panel.js`가 일정 셸·주간 탐색·loading/empty/error를 맡고 기존 `apiFetch`와 `TaskPanel`을 주입받는다. `public/notification-panel.js`는 범용 알림 네 필터만 맡는다. 현재 tab shell 이름인 `paper-panel.js`는 유지하고 큰 공용 패널 리팩터링은 하지 않는다.
- 이후 딜·주식 에이전트 블록은 일정 블록 아래에 추가한다. 일정 블록은 노트 기반 에이전트 보고와 달리 task 정본의 운영 요약이므로 별도 보고 노트를 만들지 않는다.

## 10. 입력·보안·개인정보 경계

- 외부 웹·논문·노트 본문은 task 생성 명령으로 취급하지 않는다.
- C1 task는 인증된 사용자의 명시적 UI/API 요청으로만 생성한다.
- title/detail은 의도적으로 저장하는 사용자 데이터지만 server log에는 본문을 남기지 않는다.
- scheduler log는 tick 시각, fired 수, 오류 코드만 기록한다.
- 알림 문구에 LLM을 호출하지 않는다.
- `ASSISTANT_TASKS_ENABLED` 기본값은 `false`다. `/api/config`는 `tasksEnabled`를 노출한다.
- flag가 `false`면 task UI를 숨기고 scheduler를 시작하지 않으며 task/reminder 읽기·쓰기 API는 `503 { error, code: 'TASKS_DISABLED' }`를 반환한다. migration과 기존 행 보존은 그대로 수행한다.
- `WEB_PUSH_ENABLED` 기본값도 `false`다. false면 권한 요청·구독 버튼·dispatcher를 끄고 일정 블록에는 비대화형 `알림 준비 중`을 표시하되 task scheduler와 일정 에이전트의 in-app reminder는 계속 동작한다.
- VAPID private key와 subject는 Pi `.env`에만 두고 DB·vault·API·로그·브라우저 bundle에 넣지 않는다. key 교체는 기존 subscription 재등록이 필요한 운영 변경으로 취급한다.
- subscription endpoint·`p256dh`·`auth`와 push payload 원문은 로그·diagnostic report에서 제외한다. push service가 전송 시각·빈도·크기 메타데이터를 볼 수 있다는 한계도 설정 화면에 짧게 알린다.[^w3c-push-privacy]
- Tailscale HTTPS 기기명은 인증서 발급 과정에서 Certificate Transparency log에 공개될 수 있으므로 개인 정보를 담지 않은 이름을 사용한다.[^tailscale-https]

## 11. 실패·복구 규칙

|실패 지점|기대 결과|
|---|---|
|create transaction 전 중단|task/reminder 0개|
|task insert 뒤 transaction 중단|전체 rollback, task/reminder 0개|
|firing transaction 전 중단|재시작 tick에서 pending을 한 번 처리|
|firing commit 직후 중단|같은 fired reminder와 pending delivery를 재시작 후 복구, 재발화·outbox 중복 0개|
|ack HTTP 응답 유실|retry가 같은 acknowledged 상태 반환|
|snooze HTTP 응답 유실|같은 request key로 child reminder 1개|
|완료와 tick 경합|commit 순서와 무관하게 최종 visible reminder 0개|
|삭제와 tick·push 경합|삭제 commit 뒤 새 fire·delivery 0개, pending delivery는 skipped; 이미 push service로 나간 요청은 회수하지 못하지만 task는 deleted|
|push service `404 | 410`|subscription expired, 이후 delivery 생성·재시도 중단|
|push `408 | 429 | 5xx`·network 오류|TTL 안 bounded retry, reminder·일정 에이전트 fallback은 유지|
|push accepted 뒤 receipt 기록 전 중단|재전송 가능, 같은 tag로 표시 중복 완화; exactly-once라고 주장하지 않음|
|delivery claim 뒤 worker 중단|lease 만료 뒤 retry로 회수, 영구 sending 0건|
|권한 거부·구독 없음·지원 안 됨|일정 에이전트의 in-app reminder와 foreground refresh만 유지|
|HTTPS origin 전환|API token 1회 재입력, 서버 DB의 대화·task는 불변|
|시계가 뒤로 이동|이미 fired인 행은 pending으로 돌아가지 않음|
|시계가 앞으로 이동|도달한 pending을 catch-up하고 같은 행을 중복 생성하지 않음|

## 12. 구현 단위와 성공 기준

### C0 — 설계 고정

- [x] 제품 경계, 시간 규칙, 상태 머신, schema, API, crash semantics 결정
- [x] V4.5-C와 V5-C 일정 에이전트 구분
- [x] A1b와 병행 가능한 무LLM·별도 정본 경계 결정
- [x] 완료·취소=`closed`, 잘못 생성=`deleted`, 물리 purge 없음 결정
- [x] C1 첫 배포에 private HTTPS·PWA·Web Push와 in-app fallback 포함 결정
- [x] 지식 시트 첫 범용 알림 탭과 에이전트 탭 안의 단일 task renderer 경계 결정

### C1a — 정본과 API ✅ Pi 배포 완료(2026-07-19)

구현 파일:

- `lib/database-migrations.js`: 선행 v5 뒤 schema v6
- `lib/assistant-tasks.js`: 검증·transaction·상태 전이·목록
- `lib/assistant-task-routes.js`: 인증 뒤 feature flag·JSON·task/reminder HTTP 계약
- `server.js`: 설정·store 생성·route 등록만 담당하는 얇은 연결
- `test/assistant-tasks.test.js`, `test/assistant-tasks-server.test.js`: store·HTTP 계약

통과 기준:

- [x] v5→v6 migration과 재실행이 멱등적이고 기존 application table 행이 불변
- [x] 확인 전 DB 행 0개, create retry 뒤 task/reminder 각 최대 1개
- [x] create 후 task를 수정해도 최초 create retry hash가 같으면 같은 task를 반환하고, 다른 payload면 409
- [x] date-only와 datetime 기한이 host timezone과 무관하게 분류됨
- [x] 인증 없음·JSON 아님·길이 초과·잘못된 달력 날짜·offset·과거·10년 초과 입력을 거부
- [x] version 충돌 409, 완료·취소·다시 열기·삭제·복원 상태와 reminder 정리가 일치
- [x] closed는 참조 가능·수정 불가, deleted는 일반 조회·검색·AI 후보 0건, 복구 조회에서만 노출
- [x] 모든 실제 상태 전이에 event 1개, 멱등 retry에는 추가 event 0개
- [x] due 수정과 reminder `keep`에서 reminder ID·시각이 불변
- [x] snooze child의 task ID를 서버가 원 reminder에서만 파생해 서로 다른 task parent 입력 경로가 없음
- [x] `/task` 경로 LLM·임베딩·topic 저장 호출 0회

C1a 시점의 로컬 전체 회귀는 141/141을 통과했다. `ASSISTANT_TASKS_ENABLED` 기본값은 `false`이며 이 task 정본과 API 위에 아래 C1b를 추가했다.

### C1b — scheduler·in-app 일정 UI·일정 에이전트 블록

Pi 배포 완료(2026-07-19):

- `lib/assistant-scheduler.js`: 즉시 catch-up 뒤 30초 tick, tick당 최대 100개, transaction·조건부 update 중복 차단, start/stop. `remind_at <= now`만 fire해 30초 lookahead 조기 발송은 하지 않는다.
- `lib/assistant-tasks.js`, `server.js`: stable fired reminder 조회, 기존 notification read merge, feature flag 뒤 scheduler lifecycle과 graceful stop
- `public/task-panel.js`: `/task`, `/today`, Today·예정·Inbox·종결·삭제, 생성·수정·상태 전이, reminder 확인·고정 request key 1시간 미루기의 단일 renderer
- `public/agent-panel.js`: 일정 summary와 unresolved reminder, 3주 스와이프, 같은 탭의 `TaskPanel` 작업 화면을 연결한다. mutation 구현은 `TaskPanel` 한 벌만 유지한다.
- `public/notification-panel.js`, `public/index.html`, `public/paper-panel.js`, `public/app.js`, `public/style.css`: 지식 시트 첫 `알림` 탭과 네 범용 필터, AgentPanel 연결, 앱 시작·focus·visible·foreground 60초 갱신과 모바일 action wrap
- 2026-07-19 UI 보정: 주간 이동의 중복 버튼을 제거하고 swipe·키보드 탐색만 유지했다. 전체 일정은 `<`로 요약에 복귀하며, 목록은 평면 구분선 구조와 모바일 한 줄 행동 버튼을 사용한다.
- `test/assistant-task-ui.test.js`와 scheduler·서버 통합 테스트를 추가했다. `ASSISTANT_TASKS_ENABLED=false`의 일정 진입 비활성 경계도 유지한다.

통과 기준:

- [x] 같은 tick 반복, DB 재오픈, 두 scheduler instance에서도 같은 reminder 행이 한 번만 fired
- [x] 두 번째 tick에서 `fired_at`과 안정된 `task-reminder:{id}` notification ID가 바뀌지 않음
- [x] 중단 중 지난 단발성 reminder가 시작 후 한 번 fired
- [x] fired commit 뒤 readonly 알림 조회가 가능하고 notification GET이 DB를 변경하지 않음
- [x] ack·snooze retry가 멱등적이고 snooze child 1개
- [x] create·PATCH·snooze 경합에서도 task당 live reminder 최대 1개
- [x] KST 자정 직전·정각·직후 Today 분류가 정확함
- [x] summary 한 요청의 `capturedAt`으로 건수·3주 21일·preview·nextReminder가 일치하고 GET 전후 DB가 불변
- [x] history·trash 조회, reopen·restore 뒤 terminal reminder 미복원, flag off에서 API·UI·scheduler 비활성 경계를 유지
- [x] 기존 Codex 승인·수동 복구·최근 저장 알림 회귀 없이 최종 전체 161/161 통과
- [x] task title/detail을 `textContent`로 렌더하고 server log에 본문을 남기지 않음
- [x] 에이전트 탭 첫 블록이 일정 에이전트이고 3주 21일·지연/오늘/예정/Inbox·preview 최대 3·nextReminder와 `알림 준비 중`을 표시
- [x] 범용 알림 탭은 `task_reminder`를 제외하고 일정 에이전트가 `TaskPanel`의 단일 renderer로 확인·수정·종결 행동을 처리
- [x] `일정 추가 | 전체 일정`, `/task`, `/today`, push click deep link가 모두 에이전트 탭 안의 해당 작업 화면을 연다
- [x] 1440×900·390×844 실브라우저에서 중앙 주 초기 표시·스와이프·키보드 좌우 이동·작성/수정·deep link·알림 분리·확인 처리·panel overflow와 44px 모바일 target 확인
- [ ] Pi 실제 재시작 catch-up과 서비스 lifecycle 인수

### C1c — private HTTPS·PWA·Web Push

로컬 구현 완료:

- schema v7의 Web Push subscription·기기별 delivery outbox와 endpoint SSRF allowlist
- scheduler fire와 outbox insert, task 종결·reminder 확인과 delivery skip의 동일 transaction 연결
- `pending | sending | retry | accepted | failed | expired | skipped`, lease 회수, 24시간 TTL, `Retry-After` 우선 재시도
- 실제 프로토콜을 `web-push-transport` 한 파일에 둔 dispatcher lifecycle과 제한 시간 종료 drain
- 인증 뒤 config·등록·soft revoke API, private VAPID 값 비노출, `WEB_PUSH_ENABLED=false` 기본값
- canonical HTTPS origin에서만 동작하는 최소 PWA, fetch cache가 없는 Service Worker, 사용자 버튼 기반 opt-in
- 일정 에이전트 블록의 `확인 중 | 알림 켜짐 | 알림 켜기 | 알림 차단됨 | 알림 미지원 | 알림 준비 중` 상태

검증 상태:

- [x] plain HTTP·비canonical origin에서는 Service Worker·subscription 활성화 0회
- [x] 권한 요청은 `알림 켜기` 직접 동작 뒤에만 1회, 자동 prompt 0회
- [x] reminder·subscription당 delivery 최대 1개, 반복 enqueue와 두 claim instance의 동시 claim 0개
- [x] fire와 outbox insert 사이 강제 실패 전체 rollback, terminal task·reminder의 미전송 delivery skip
- [x] `2xx`는 accepted receipt만 기록하고 reminder를 seen으로 바꾸지 않음
- [x] `404 | 410` 구독 만료, `408 | 429 | 5xx | network` TTL 내 재시도, permanent error 재시도 0회
- [x] 새 구독의 과거 fired reminder backfill 0건, opaque payload에 task 제목·설명·API token·endpoint·key 0건
- [x] SW `fetch` handler·offline cache·silent push 0건, notification click은 focus 또는 앱 열기만 수행
- [x] 1440×900·390×844 실제 브라우저에서 push disabled 상태·task UI overflow·light/dark 확인
- [x] Tailscale Serve canonical HTTPS와 iPhone·iPad·Mac 홈 화면 설치·권한·구독 실기기 확인
- [x] iPad가 SVG 홈 화면 아이콘 대신 fallback을 쓰는 문제를 167·180·192·512px PNG와 `apple-touch-icon`으로 보정하고 HTTPS 응답을 확인
- [ ] 잠긴 iPhone에서 앱을 벗어난 10회 시험 중 정상 네트워크·Focus 해제 조건에서 2분 안 표시 9회 이상. 2026-07-19 첫 운영 reminder는 구독 3개 모두 provider `201 accepted`, retry·오류 0건이었다. 플랫폼 보장이 아닌 GO 기준

향후 native 앱은 task·reminder 정본, scheduler, delivery의 멱등·lease·retry 의미를 재사용한다. `web-push-transport`는 APNs/FCM 어댑터로 추가·교체할 수 있지만, 브라우저 endpoint·`p256dh`·`auth` subscription schema, 구독 API, manifest·Service Worker는 Web 전용이므로 native 단계에서 확장하거나 대체한다. 지금 범위에서 다중 transport schema를 미리 만들지는 않는다.

### C1d — Pi 인수

- [x] 배포 전 DB·vault와 코드 백업
- [x] 로컬/Pi 변경 파일 SHA-256 일치
- [x] schema 4→5→6→7 순차 적용, `integrity_check=ok`, `foreign_key_check` 0건
- [x] 기존 application table 보존과 note/topic audit finding 0
- [x] Tailscale Serve HTTPS와 PWA 설치·아이콘 보정 절차 확인
- [x] 서비스 새 PID, 인증 API, 시작 tick·push dispatcher, 재시작 오류 0건
- 운영 DB에는 별도 승인 없이 테스트 task를 만들지 않음
- 기능 비활성화가 필요하면 먼저 `WEB_PUSH_ENABLED=false`로 dispatcher만 끄고, 필요할 때 `ASSISTANT_TASKS_ENABLED=false`로 scheduler·UI까지 끈다.
- 이전 코드로 완전 rollback할 때는 v4 코드가 상위 schema DB를 거부하므로 코드 백업과 배포 전 DB 백업을 함께 복원한다.

## 13. C2 이후 확장 경계

반복을 C1의 `recurrence_rule` 한 컬럼으로 얹지 않는다. 반복 master, 회차 완료, 알림 receipt를 분리해야 한다.

```text
assistant_tasks             # 반복 master
  -> assistant_task_occurrences  # 날짜별 open/done/skipped/cancelled 회차
       -> assistant_reminders    # pending/fired/acknowledged receipt
```

C2는 별도 schema v8과 컨펌으로 아래만 검토한다.

- `매일 | 평일 | 매주`의 제한된 반복
- 회차 완료와 반복 전체 종료 분리
- downtime 중 최신 놓친 회차 하나만 표시하고 이전 회차는 skipped 집계
- fired 시각이 아니라 KST anchor로 다음 회차 계산해 drift 방지
- schedule version이 바뀌면 이전 미래 회차를 transaction 안에서 취소

매월, n번째 요일, 공휴일, cron, 하루 여러 번은 그 뒤로 미룬다. RFC 5545는 존재하지 않는 날짜에 생긴 recurrence instance를 “MUST be ignored”라고 정한다.[^rfc5545] 전체 RRULE을 흉내 내기보다 지원하는 규칙을 작게 명시하는 편이 안전하다.

C1 인수 뒤의 C1.5에서 front Claude가 필요할 때 deterministic `schedule_prepare`를 호출해 **무저장 후보 카드**만 만들고, 사용자가 확인한 뒤 `schedule_commit`이 같은 canonical payload를 저장하는 자연어 진입을 검토한다. 단순 일정 생성에 두 번째 scheduling LLM은 두지 않는다. 해석 기준 시각은 한 번 캡처하고, 카드에 표시한 canonical KST 값을 승인 시 다시 해석하지 않는다.

C3에서만 오늘 브리핑·완료 결과 기록·Codex/Terra 기반 분석 보고를 검토한다. 단순 일정 요약은 서버가 직접 만들고, LLM 보고가 필요할 때도 사용자 대화 lane과 격리된 낮은 우선순위 background job으로 실행한다.

## 14. 결정의 트레이드오프

- **명시적 폼 우선**: 말로 바로 만드는 마법은 늦어지지만, 틀린 날짜를 약속하는 위험과 모델 비용이 없다.
- **단발성 우선**: 반복 사용성은 늦어지지만, task 완료와 회차 완료를 잘못 섞은 schema를 운영에 넣지 않는다.
- **Web Push를 첫 배포에 포함**: HTTPS·PWA·구독·재시도 때문에 C1이 커지지만, 일정 기능의 핵심인 백그라운드 전달을 실제 사용 전에 검증한다. task core와 push migration은 나눠 rollback 범위를 제한한다.
- **서버가 시각 정본**: 브라우저를 계속 깨워 두지는 못하지만 Pi scheduler가 탭 수명주기와 무관하게 약속 시각을 판정한다.
- **in-app fallback 유지**: push는 빠른 전달을 보강하고, 유실·권한 거부·만료 때도 일정 에이전트에서 unresolved reminder를 복구한다.
- **KST 고정**: 여행·다중 timezone은 아직 못 다루지만 현재 단일 사용자 환경의 날짜 경계를 결정적으로 만든다.
- **closed/deleted 분리, 물리 purge 없음**: DB는 조금씩 커지지만 종결 항목은 계속 참조하고 잘못 만든 항목은 일반 회수에서 숨긴 채 복구할 수 있다.
- **기존 지식 시트 shell 재사용**: 범용 알림과 일정의 위치는 분리하지만 새 최상위 화면은 만들지 않는다. task 행동은 Codex 승인 API와 명확히 분기한다.

## 15. 근거와 현행 코드

프로젝트 내부 기준:

- [V4.5 비서 기본기 설계](assistant-foundation-design.md): 약속 루프의 제품 위치와 음성 연결 경계
- [로드맵](roadmap.md): V4.5-C, V4-B, V5 전문 에이전트의 승격 순서
- [최종 제품 설계](galpi-design-final.md): SQLite 정본, 결정론적 scheduler, 얇은 모듈 경계
- [`lib/database-migrations.js`](../lib/database-migrations.js): 배포 schema v4, 로컬 schema v5와 순차 transaction migration
- [`server.js`](../server.js): 기존 `/api/notifications`, API token, startup/shutdown 경계
- [`public/app.js`](../public/app.js): 지식 시트 진입·command/deep link와 7초 채팅 polling
- [`public/index.html`](../public/index.html): 현재 Apple meta만 있고 manifest·Service Worker 등록은 없는 PWA 시작점
- [Pi 운영·복구 runbook](RASPBERRY_PI_RUNBOOK.md): 현재 HTTP 접속 기준; C1 구현 때 private HTTPS 전환·복구 절차를 함께 갱신

외부 1차 자료:

- [SQLite Transaction](https://www.sqlite.org/lang_transaction.html): 동시 write transaction과 transaction 경계
- [SQLite ON CONFLICT](https://www.sqlite.org/lang_conflict.html): UNIQUE 충돌 처리
- [RFC 5545 §3.3.10](https://www.rfc-editor.org/rfc/rfc5545.html#section-3.3.10): recurrence 규칙과 invalid instance 처리
- [MDN `datetime-local`](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/input/datetime-local): timezone 없는 local date/time 입력의 의미
- [W3C Push API](https://www.w3.org/TR/push-api/): 앱·user agent가 inactive여도 push service가 메시지를 전달하고 worker를 시작하는 표준
- [WebKit, Web Push for Web Apps on iOS and iPadOS](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/): iOS/iPadOS 16.4+, 홈 화면 웹 앱, 사용자 동작 기반 권한 조건
- [Chrome Page Lifecycle](https://developer.chrome.com/docs/web-platform/page-lifecycle-api): hidden page의 freeze·discard와 background 작업 중단
- [MDN Screen Wake Lock](https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API): visible·active document에서만 유지되는 화면 wake lock
- [MDN Periodic Background Sync](https://developer.mozilla.org/en-US/docs/Web/API/Web_Periodic_Background_Synchronization_API): 제한적 지원과 user agent가 결정하는 실행 간격
- [MDN Service Worker registration](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerContainer/register): secure context 요구사항
- [Tailscale Serve](https://tailscale.com/docs/features/tailscale-serve): tailnet 내부 HTTPS reverse proxy와 자동 TLS
- [Tailscale HTTPS](https://tailscale.com/docs/how-to/set-up-https-certificates): `.ts.net` 인증서와 Certificate Transparency 주의사항
- [Web Push protocol](https://web.dev/articles/push-notifications-web-push-protocol): VAPID와 push service HTTP 오류 처리

[^sqlite-transaction]: SQLite, “only one simultaneous write transaction.” [Transaction §2.1](https://www.sqlite.org/lang_transaction.html#read_transactions_versus_write_transactions).
[^rfc5545]: RFC 5545 §3.3.10, “Such recurrence instances MUST be ignored and MUST NOT be counted as part of the recurrence set.”
[^mdn-datetime-local]: MDN, “The control is intended to represent a local date and time.”
[^webkit-ios-push]: WebKit은 홈 화면에 추가한 웹 앱이 사용자 직접 동작에 응답해 권한을 요청할 수 있다고 명시한다. [Web Push for Web Apps on iOS and iPadOS](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/).
[^chrome-lifecycle]: Chrome, frozen 상태에서는 “freezable tasks in the page's task queues are suspended.” [Page Lifecycle API](https://developer.chrome.com/docs/web-platform/page-lifecycle-api).
[^mdn-wake-lock]: MDN, “Only active documents can acquire screen wake locks.” [Screen Wake Lock API](https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API).
[^tailscale-serve]: Tailscale Serve는 tailnet 안에서 local service를 HTTPS로 proxy하고 TLS를 자동 provision한다. [Tailscale Serve](https://tailscale.com/docs/features/tailscale-serve).
[^tailscale-https]: Tailscale은 공개 인증서의 machine name이 Certificate Transparency log에 기록된다고 설명한다. [Enabling HTTPS](https://tailscale.com/docs/how-to/set-up-https-certificates).
[^w3c-push-privacy]: W3C Push API는 push service가 메시지의 timing·frequency를 관찰할 수 있다고 명시한다. [Security and privacy considerations](https://www.w3.org/TR/push-api/#security-and-privacy-considerations).
