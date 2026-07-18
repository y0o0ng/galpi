# V4.5-C 시온 약속 루프 상세 설계

> 작성: 2026-07-18
>
> 상태: **C0 설계 완료 · C1 구현 전 컨펌 대기**
>
> 단일 기준: V4.5-C의 task·reminder 구현 세부사항은 이 문서를 따른다.

## 0. 결정 요약

시온의 첫 일정 기능은 외부 캘린더를 운영하는 자율 에이전트가 아니라, 갈피 안에서 사용자가 확정한 할 일과 단발성 알림을 잊지 않게 지키는 **약속 루프**다.

- 첫 진입은 명시적 `/task`다. `/task 보고서 초안`처럼 뒤에 쓴 텍스트는 제목에 그대로 채우되 자연어 날짜 해석은 하지 않는다.
- 사용자가 확인 카드를 제출하기 전에는 DB에 아무것도 저장하지 않는다.
- C1은 task 생성·수정·완료·취소·되돌리기, Today·예정·Inbox, 단발성 알림·확인·1시간 미루기만 지원한다.
- task와 reminder는 별도 SQLite 정본으로 저장한다. 기존 `notification_actions`는 Codex 승인 이력이므로 재사용하지 않는다.
- reminder 행 자체를 영속 알림 receipt로 쓴다. 별도 알림 생성 단계가 없으므로 DB 반영 직후 프로세스가 죽어도 다음 접속에서 같은 행을 다시 읽을 수 있다.
- C1에는 반복, 자연어 후보 추출, 오늘 브리핑, 결과 기록, Web Push, 외부 캘린더를 넣지 않는다.
- 반복은 회차별 완료를 표현하는 세 번째 테이블이 필요하므로 C2의 별도 schema migration과 컨펌으로 진행한다.

이 기능은 향후 외부 캘린더를 읽고 일정을 조정할 수 있는 `V5-C 일정 에이전트`와 다르다. 이 문서의 대상은 `V4.5-C 약속 루프`다.

## 1. 지금 병행해도 되는 경계

현재 A1b는 실제 답변에 새 청크를 주입하지 않는 shadow 관찰 단계다. C1은 아래 경계를 지키는 동안 A1b 관찰과 독립적으로 진행할 수 있다.

1. 새 `assistant_tasks`, `assistant_reminders` 테이블만 쓰고 `messages`, `notes`, `note_chunks`, retrieval trace를 수정하지 않는다.
2. `/task` 경로에서 LLM·임베딩·웹 검색·자동 저장·Codex organizer를 호출하지 않는다.
3. scheduler는 새 reminder 테이블만 읽고 쓴다.
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

기존 시온 알림센터에 `할 일` 탭을 추가한다.

- **알림**: 발화됐지만 아직 확인하지 않은 reminder
- **오늘·지연**: KST 오늘 마감과 이미 지난 active task
- **예정**: 오늘 이후 기한이 있는 active task
- **Inbox**: 기한이 없는 active task
- **최근 완료**: 기본은 접고 최근 항목만 조회한다. 물리 삭제는 하지 않는다.

`/today`는 알림센터의 `할 일` 탭을 바로 연다. 단순히 패널을 열거나 목록을 조회했다고 reminder를 확인 처리하지 않는다.

### 2.3 알림 행동

- `확인`: reminder만 확인한다. task는 active로 남는다.
- `완료`: task를 완료하고 아직 남은 reminder를 함께 정리한다.
- `1시간 뒤`: 현재 reminder를 `snoozed` 행동으로 확인하고, 정확히 한 개의 새 pending reminder를 만든다. task 기한은 바꾸지 않는다.
- `취소`: task를 취소하고 미처리 reminder를 숨긴다.

## 3. C1 범위와 비범위

### 3.1 C1에 포함

- 명시적 `/task` 작성·확인 카드
- active task 생성, 수정, 완료, 취소, 되돌리기
- 기한 없음, 날짜 전용 기한, KST 절대 시각 기한
- task당 동시에 최대 한 개의 live 단발성 reminder
- 1분 scheduler, 시작 직후 catch-up, occurrence 중복 차단
- reminder 확인과 한 번씩 멱등적인 1시간 미루기
- 알림센터의 알림·Today·예정·Inbox·최근 완료
- API token 보호, 입력 상한, 낙관적 동시성, 결정론적 테스트 시계
- 기능 flag를 통한 scheduler·UI 비활성화

### 3.2 C1에서 제외

- 대화의 미래형 문장을 감지하는 자연어 task 후보
- 매일·평일·매주·매월 등 반복 task/reminder
- 첫 접속 또는 정해진 시각의 오늘 브리핑
- 완료 결과를 노트나 사용자 메모리에 연결하는 흐름
- Web Push, 이메일, SMS, 외부 캘린더 읽기·쓰기
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

모든 집합은 `status = active`만 포함한다. reminder를 확인해도 task가 완료되지 않았다면 목록에서 사라지지 않는다.

### 4.3 catch-up

- Pi가 꺼져 있는 동안 지난 단발성 reminder는 다음 서버 시작 tick에서 한 번 `fired`로 바뀐다.
- 늦은 정도와 관계없이 같은 reminder 행 하나만 보인다.
- 사용자가 `확인`, `1시간 뒤`, `완료`, `취소` 중 하나를 누를 때까지 같은 unresolved 카드가 재접속 때 다시 보일 수 있다. 이는 중복 발화가 아니라 같은 영속 receipt의 재표시다.
- 보장 범위는 **occurrence key당 reminder receipt 행 최대 한 개 + 확인 전 계속 조회 가능**이다. 브라우저 전달의 exactly-once는 보장하지 않는다.

## 5. 상태 머신

### 5.1 task

```text
active -> done
active -> cancelled
done | cancelled -> active  # 명시적 되돌리기
```

- 확인 전 후보는 클라이언트 카드 상태일 뿐 DB task가 아니다.
- `snoozed`는 task 상태가 아니다.
- 되돌리기는 기존 reminder를 자동 복구하지 않는다. 사용자가 새 알림을 확인해 만들어야 한다.

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
- terminal reminder는 되돌리지 않고 감사 이력으로 보존한다.

### 5.3 경합 규칙

모든 쓰기는 같은 SQLite connection의 transaction과 조건부 상태 갱신으로 직렬화한다.

- 완료/취소가 먼저 commit되면 scheduler는 해당 task의 reminder를 fire하지 못한다.
- scheduler가 먼저 fire해도 뒤이은 완료/취소 transaction이 unresolved reminder를 정리한다.
- 수정 요청은 task `version`이 맞을 때만 적용한다. 다르면 `409 Conflict`와 최신 task를 반환한다.
- 같은 create·snooze 요청을 재전송하면 새 행을 만들지 않고 첫 결과를 반환한다.

SQLite 공식 문서는 동시 read transaction은 여러 개 가능하지만 “only one simultaneous write transaction”이라고 명시한다.[^sqlite-transaction] 이 직렬성만 믿지 않고 조건부 UPDATE와 UNIQUE 제약을 함께 둔다.

## 6. schema v5

C1은 기존 schema v4에 아래 두 테이블만 추가한다. 기존 application table의 행과 컬럼은 바꾸지 않는다.

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
  CHECK (
    (due_kind = 'none' AND due_date IS NULL AND due_at IS NULL) OR
    (due_kind = 'date' AND due_date GLOB '????-??-??' AND due_at IS NULL) OR
    (due_kind = 'datetime' AND due_date IS NULL AND due_at IS NOT NULL)
  ),
  CHECK (
    (status = 'active' AND completed_at IS NULL AND cancelled_at IS NULL) OR
    (status = 'done' AND completed_at IS NOT NULL AND cancelled_at IS NULL) OR
    (status = 'cancelled' AND completed_at IS NULL AND cancelled_at IS NOT NULL)
  )
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
      AND acknowledgement_action IS NULL AND cancelled_at IS NULL) OR
    (status = 'fired' AND fired_at IS NOT NULL AND acknowledged_at IS NULL
      AND acknowledgement_action IS NULL AND cancelled_at IS NULL) OR
    (status = 'acknowledged' AND fired_at IS NOT NULL AND acknowledged_at IS NOT NULL
      AND acknowledgement_action IS NOT NULL AND cancelled_at IS NULL) OR
    (status = 'cancelled' AND acknowledged_at IS NULL
      AND acknowledgement_action IS NULL AND cancelled_at IS NOT NULL)
  )
);

CREATE INDEX idx_assistant_tasks_status_due_date
  ON assistant_tasks(status, due_date);
CREATE INDEX idx_assistant_tasks_status_due_at
  ON assistant_tasks(status, due_at);
CREATE INDEX idx_assistant_reminders_status_remind_at
  ON assistant_reminders(status, remind_at);
CREATE INDEX idx_assistant_reminders_task_status
  ON assistant_reminders(task_id, status);
CREATE UNIQUE INDEX idx_assistant_reminders_one_live_per_task
  ON assistant_reminders(task_id)
  WHERE status IN ('pending', 'fired');
```

### 6.1 불변식

- task당 live reminder는 `pending | fired` 합쳐 최대 하나다.
- create 시 정규화한 최초 payload의 SHA-256을 `create_payload_sha256`에 고정하고 이후 task 수정 때 바꾸지 않는다. 같은 `client_request_id` retry는 이 hash가 같을 때만 기존 task의 현재 상태를 `replayed: true`로 반환한다.
- canonical payload는 NFC 정규화·양끝 공백 제거한 `title`, `detail`과 서버가 확정한 `dueKind`, `dueDate`, `dueAt`, `reminderAt`을 고정된 key 순서의 JSON으로 직렬화한 값이다. request ID는 hash에서 제외한다.
- `occurrence_key`는 서버가 `task:{taskId}:v{reminderVersion}:{remindAt}` 형태로 만든다. 현재 tick 시각으로 만들지 않는다.
- reminder를 바꾸거나 제거하면 같은 transaction에서 `reminder_version`을 올리고 기존 live reminder를 취소한 뒤, 교체하는 경우에만 새 key의 reminder를 만든다. task 기한만 바꾸고 reminder를 `keep`한 경우에는 올리지 않는다.
- snooze child의 key는 원 reminder ID와 검증된 `snooze_request_key`의 SHA-256으로 만든다.
- `client_request_id`, `snooze_request_key`는 8~128자의 제한된 ASCII 토큰만 받는다.
- 날짜의 실제 유효성, epoch 범위, 문자열 상한은 DB CHECK에만 기대지 않고 API에서도 검증한다.
- 물리 DELETE는 C1 API에 제공하지 않는다.

기존 `server.js`는 `PRAGMA foreign_keys = ON`을 명시하지 않지만 2026-07-18 읽기 전용 확인에서 로컬과 Pi better-sqlite3 연결은 모두 `foreign_keys=1`, `foreign_key_check` 0건이었고 Pi schema는 v4였다. C1은 연결 직후 이를 명시적으로 `ON`으로 설정하고 다시 읽어 `1`이 아니면 시작을 중단한다. store의 부모 존재 검증과 조건부 UPDATE도 그대로 두며, snooze child는 원 reminder와 같은 task에만 연결할 수 있다.

## 7. scheduler와 영속 알림

### 7.1 모듈 경계

- `lib/assistant-tasks.js`: 검증, 정본 CRUD, 상태 전이, 목록 조회
- `lib/assistant-scheduler.js`: 주입 가능한 `clock`, `tick(now)`, start/stop
- `server.js`: 설정과 얇은 route, `/api/notifications` 합성, lifecycle 연결

기존 `server.js` 전체 분해나 알림센터 리팩터링은 하지 않는다.

### 7.2 한 tick

```text
server listen 완료
  -> 즉시 tick(capturedNow)
  -> 이후 60초마다 tick

tick transaction
  -> active task에 속한 pending reminder 중 remind_at <= now
  -> remind_at, id 순으로 최대 100개 선택
  -> status=fired, fired_at=now, updated_at=now 조건부 갱신
  -> commit
```

- `<= now`를 사용해 정확히 경계에 도달한 항목도 처리한다.
- reminder 행이 곧 outbox이자 receipt다. 별도 notification INSERT나 네트워크 전송은 없다.
- `/api/notifications`는 `fired` 행을 읽기만 하므로 commit 뒤 crash가 나도 다음 시작에 유실되지 않는다.
- 한 tick 실패는 transaction 전체를 rollback하고 다음 tick에서 재시도한다.
- in-memory overlap guard, SQLite write transaction, `status = pending` 조건, UNIQUE를 겹쳐 방어한다.
- interval handle을 보관하고 종료 신호에서 interval을 먼저 멈춘 뒤 DB를 닫는다.
- 개인용 범위를 벗어난 100개 초과 backlog는 다음 분 tick에서 이어 처리한다.

### 7.3 알림 새로고침

- 앱 시작, 브라우저 focus, 60초 간격으로 task 알림을 갱신한다.
- 기존 채팅 7초 polling에 붙이지 않는다. 여러 탭에서 API rate limit을 불필요하게 소모하지 않기 위해서다.
- GET은 어떤 상태도 변경하지 않는다.

## 8. API 계약

모든 endpoint는 기존 `requireApiToken` 뒤에 둔다. JSON 이외 입력은 거부한다. 현행 프론트 관례에 맞춰 오류 응답은 사용자용 `error`, 기계 판별용 `code`, 필요한 경우 최신 `task`를 반환한다.

### 8.1 목록

```http
GET /api/tasks?view=today|upcoming|inbox|all|history&status=done|cancelled|all&limit=100
```

- `today`: 지연과 오늘을 각각 정렬해 반환
- `upcoming`: 가까운 기한순
- `inbox`: 최근 수정순
- `all`: 모든 active task를 기한순·최근 수정순으로 조회
- `history`: done/cancelled task를 최근 상태 변경순으로 조회. `status` 기본값은 `all`이며 이 view에서만 받는다.

### 8.2 생성

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

### 8.3 수정

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

### 8.4 task 상태

```http
POST /api/tasks/:id/complete  { "expectedVersion": 3 }
POST /api/tasks/:id/cancel    { "expectedVersion": 3 }
POST /api/tasks/:id/reopen    { "expectedVersion": 4 }
```

같은 결과 상태에 대한 재요청은 멱등적으로 현재 값을 반환한다. 서로 다른 최신 변경과 충돌하면 `409`다.

### 8.5 reminder 행동

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

### 8.6 알림센터 합성

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

task 카드는 `item.type === 'task_reminder'`에서 기존 generic renderer보다 먼저 전용 renderer로 분기하고, 기존 `/approve`, `/ignore`를 호출하지 않는다. reminder 전용 endpoint를 사용한다.

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
- active 카드 행동은 `완료 | 수정 | 취소`다.
- reminder 카드는 `확인 | 1시간 뒤 | 완료`다.
- due와 reminder를 혼동하지 않도록 각각 `마감`, `알림` label을 붙인다.
- 390px에서는 행동 버튼이 카드 밖으로 넘치지 않고 두 줄까지 재배치된다.
- keyboard focus, 버튼 accessible name, `aria-live` 성공·오류 안내를 제공한다.

## 10. 입력·보안·개인정보 경계

- 외부 웹·논문·노트 본문은 task 생성 명령으로 취급하지 않는다.
- C1 task는 인증된 사용자의 명시적 UI/API 요청으로만 생성한다.
- title/detail은 의도적으로 저장하는 사용자 데이터지만 server log에는 본문을 남기지 않는다.
- scheduler log는 tick 시각, fired 수, 오류 코드만 기록한다.
- 알림 문구에 LLM을 호출하지 않는다.
- `ASSISTANT_TASKS_ENABLED` 기본값은 `false`다. `/api/config`는 `tasksEnabled`를 노출한다.
- flag가 `false`면 task UI를 숨기고 scheduler를 시작하지 않으며 task/reminder 읽기·쓰기 API는 `503 { error, code: 'TASKS_DISABLED' }`를 반환한다. migration과 기존 행 보존은 그대로 수행한다.

## 11. 실패·복구 규칙

|실패 지점|기대 결과|
|---|---|
|create transaction 전 중단|task/reminder 0개|
|task insert 뒤 transaction 중단|전체 rollback, task/reminder 0개|
|firing transaction 전 중단|재시작 tick에서 pending을 한 번 처리|
|firing commit 직후 중단|같은 fired receipt를 다음 접속에서 표시, 재발화 행 0개|
|ack HTTP 응답 유실|retry가 같은 acknowledged 상태 반환|
|snooze HTTP 응답 유실|같은 request key로 child reminder 1개|
|완료와 tick 경합|commit 순서와 무관하게 최종 visible reminder 0개|
|시계가 뒤로 이동|이미 fired인 행은 pending으로 돌아가지 않음|
|시계가 앞으로 이동|도달한 pending을 catch-up하고 같은 행을 중복 생성하지 않음|

## 12. 구현 단위와 성공 기준

### C0 — 설계 고정

- [x] 제품 경계, 시간 규칙, 상태 머신, schema, API, crash semantics 결정
- [x] V4.5-C와 V5-C 일정 에이전트 구분
- [x] A1b와 병행 가능한 무LLM·별도 정본 경계 결정

### C1a — 정본과 API

변경 예정:

- `lib/database-migrations.js`: schema v5
- `lib/assistant-tasks.js`: 검증·transaction·상태 전이·목록
- `server.js`: 얇은 task/reminder route
- migration·store·API 테스트

통과 기준:

- v4→v5 migration과 재실행이 멱등적이고 기존 application table 행이 불변
- 확인 전 DB 행 0개, create retry 뒤 task/reminder 각 최대 1개
- create 후 task를 수정해도 최초 create retry hash가 같으면 같은 task를 반환하고, 다른 payload면 409
- date-only와 datetime 기한이 host timezone과 무관하게 분류됨
- 인증 없음·JSON 아님·길이 초과·잘못된 달력 날짜·offset·과거·10년 초과 입력을 거부
- version 충돌 409, 완료·취소·되돌리기 상태와 reminder 정리가 일치
- due 수정과 reminder `keep`에서 reminder ID·시각이 불변
- 서로 다른 task 사이 snooze parent 연결을 거부
- `/task` 경로 LLM·임베딩·topic 저장 호출 0회

### C1b — scheduler와 알림센터

변경 예정:

- `lib/assistant-scheduler.js`: 결정론적 tick, start/stop
- `server.js`: lifecycle과 notification read merge
- `public/app.js`, `public/style.css`: `/task`, `/today`, task tab과 카드 행동
- scheduler·서버 통합·브라우저 테스트

통과 기준:

- 같은 tick 반복, 서버 재시작, 두 scheduler instance에서도 같은 reminder 행이 한 번만 fired
- 두 번째 tick에서 `fired_at`과 안정된 `task-reminder:{id}` notification ID가 바뀌지 않음
- 중단 중 지난 단발성 reminder가 시작 후 한 번 fired
- fired commit 직후 crash에서도 알림 조회 가능
- notification GET이 DB를 변경하지 않음
- ack·snooze retry가 멱등적이고 snooze child 1개
- create·PATCH·snooze 경합에서도 task당 live reminder 최대 1개
- KST 자정 직전·정각·직후 Today 분류가 정확함
- history 조회, reopen 뒤 terminal reminder 미복원, flag off에서 API·UI·scheduler 비활성 및 행 보존
- 기존 Codex 승인·수동 복구·최근 저장 알림의 카드·count·filter 회귀 0건
- task title/detail의 HTML이 실행되지 않고 server log에 본문이 남지 않음
- 1440×900과 390×844에서 생성·수정·완료·확인·미루기와 overflow 검증
- 기존 전체 테스트와 note/topic audit 회귀 0건

### C1c — Pi 인수

- 배포 전 DB·vault와 코드 백업
- 로컬/Pi 변경 파일 SHA-256 일치
- schema 4→5, `integrity_check=ok`, `foreign_key_check` 0건
- 기존 application table 행 수와 note/topic audit 불변
- 서비스 새 PID, 인증 API, 시작 tick, 재시작 오류 0건
- 운영 DB에는 별도 승인 없이 테스트 task를 만들지 않음
- 기능 비활성화가 필요하면 flag로 scheduler·UI를 먼저 끈다.
- 이전 코드로 완전 rollback할 때는 v4 코드가 v5 DB를 거부하므로 코드 백업과 배포 전 DB 백업을 함께 복원한다.

## 13. C2 이후 확장 경계

반복을 C1의 `recurrence_rule` 한 컬럼으로 얹지 않는다. 반복 master, 회차 완료, 알림 receipt를 분리해야 한다.

```text
assistant_tasks             # 반복 master
  -> assistant_task_occurrences  # 날짜별 open/done/skipped/cancelled 회차
       -> assistant_reminders    # pending/fired/acknowledged receipt
```

C2는 별도 schema v6과 컨펌으로 아래만 검토한다.

- `매일 | 평일 | 매주`의 제한된 반복
- 회차 완료와 반복 전체 종료 분리
- downtime 중 최신 놓친 회차 하나만 표시하고 이전 회차는 skipped 집계
- fired 시각이 아니라 KST anchor로 다음 회차 계산해 drift 방지
- schedule version이 바뀌면 이전 미래 회차를 transaction 안에서 취소

매월, n번째 요일, 공휴일, cron, 하루 여러 번은 그 뒤로 미룬다. RFC 5545는 존재하지 않는 날짜에 생긴 recurrence instance를 “MUST be ignored”라고 정한다.[^rfc5545] 전체 RRULE을 흉내 내기보다 지원하는 규칙을 작게 명시하는 편이 안전하다.

C3에서만 자연어 후보·브리핑·결과 기록을 검토한다. 자연어 후보도 해석 기준 시각을 한 번 캡처하고, 카드에 표시한 canonical KST 값을 승인 시 다시 해석하지 않는다.

## 14. 결정의 트레이드오프

- **명시적 폼 우선**: 말로 바로 만드는 마법은 늦어지지만, 틀린 날짜를 약속하는 위험과 모델 비용이 없다.
- **단발성 우선**: 반복 사용성은 늦어지지만, task 완료와 회차 완료를 잘못 섞은 schema를 운영에 넣지 않는다.
- **알림센터 우선**: 브라우저가 닫혀 있을 때 즉시 push되지는 않지만, 권한·service worker 없이 restart 안전성을 먼저 검증한다.
- **KST 고정**: 여행·다중 timezone은 아직 못 다루지만 현재 단일 사용자 환경의 날짜 경계를 결정적으로 만든다.
- **물리 삭제 없음**: DB는 조금씩 커지지만 실수와 장애를 되돌리고 이력을 감사할 수 있다.
- **기존 알림센터 shell 재사용**: 새 화면을 빠르게 붙일 수 있지만 task 행동은 Codex 승인 API와 명확히 분기해야 한다.

## 15. 근거와 현행 코드

프로젝트 내부 기준:

- [V4.5 비서 기본기 설계](assistant-foundation-design.md): 약속 루프의 제품 위치와 음성 연결 경계
- [로드맵](roadmap.md): V4.5-C, V4-B, V5 전문 에이전트의 승격 순서
- [최종 제품 설계](galpi-design-final.md): SQLite 정본, 결정론적 scheduler, 얇은 모듈 경계
- [`lib/database-migrations.js`](../lib/database-migrations.js): 현재 schema v4와 순차 transaction migration
- [`server.js`](../server.js): 기존 `/api/notifications`, API token, startup/shutdown 경계
- [`public/app.js`](../public/app.js): 기존 알림센터 shell과 7초 채팅 polling

외부 1차 자료:

- [SQLite Transaction](https://www.sqlite.org/lang_transaction.html): 동시 write transaction과 transaction 경계
- [SQLite ON CONFLICT](https://www.sqlite.org/lang_conflict.html): UNIQUE 충돌 처리
- [RFC 5545 §3.3.10](https://www.rfc-editor.org/rfc/rfc5545.html#section-3.3.10): recurrence 규칙과 invalid instance 처리
- [MDN `datetime-local`](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/input/datetime-local): timezone 없는 local date/time 입력의 의미

[^sqlite-transaction]: SQLite, “only one simultaneous write transaction.” [Transaction §2.1](https://www.sqlite.org/lang_transaction.html#read_transactions_versus_write_transactions).
[^rfc5545]: RFC 5545 §3.3.10, “Such recurrence instances MUST be ignored and MUST NOT be counted as part of the recurrence set.”
[^mdn-datetime-local]: MDN, “The control is intended to represent a local date and time.”
