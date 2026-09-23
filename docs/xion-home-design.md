# Galpi 제품 셸과 XION Home — 설계

> 상태: 2026-09-23 승인 Figma 구현.
>
> 시각·반응형 정본은 Figma `galpi-home-design`이고, 데이터·상태·행동 정본은 현재 저장소다.
> 이 문서는 과거 350px 지식 패널 Home 설계를 대체한다.

## 1. 제품 구조

최상위 목적지는 Home, Chat, Notes, Settings 네 개로 고정한다. 데스크톱은 232px 왼쪽 전역
탐색을, Pad와 Phone은 아래 전역 탐색을 쓴다. Home 안에는 `Overview`와 `Agents`만 있다.
범용 탐색·위젯·레이아웃 설정 구조는 만들지 않는다.

Chat은 기존 대화, composer, 모델 선택, 음성, 첨부, 활성 노트, polling 동작을 유지한다.
Chat 오른쪽 지식 패널에는 `Notes`와 `Papers`만 남고 기본은 Notes다. 과거 XION과 알림 탭은
보이는 Chat 탐색에서 사라지지만 그 도메인 기능은 Home에서 계속 쓴다.

## 2. Overview 카드

현재 카드는 Weather, Tasks, Calendar, Mail, Notifications, D-Day, Lecture Notes, Notes다.

News는 표시하지 않고 빈 자리도 남기지 않는다. 뉴스 수집·판단 백엔드는 그대로 두되 Home은
`/api/news/briefing`을 호출하지 않는다. Trading과 함께 다시 결정할 때까지 UI 범위 밖이다.

강의 녹음·전사 런타임과 강의 노트 전용 메타데이터는 아직 없으므로 Lecture Notes 카드는
`준비 중`을 표시한다. 별도 저장소나 임시 스키마를 만들지 않는다.

## 3. 데스크톱 격자

Home 본문은 폭 1060px, 16열, gutter 20px의 CSS Grid다. 한 열은 47.5px이므로 승인된 `.5`
치수를 그대로 만든다.

| 카드 | 위치 | 크기 |
|---|---|---:|
| Weather | 1행 4열 | 250 × 210 |
| Tasks | 1행 7열 | 452.5 × 210 |
| Calendar | 1~2행 5열 | 317.5 × 440 |
| Mail | 2행 7열 | 452.5 × 210 |
| Notifications | 2행 4열 | 250 × 210 |
| D-Day | 3행 2열 | 115 × 210 |
| Lecture Notes | 3행 7열 | 452.5 × 210 |
| Notes | 3행 7열 | 452.5 × 210 |

절대 좌표 대신 Grid를 사용한다. Pad portrait는 폭 740px의 360px 2열과 20px 간격을 쓴다.
Phone은 좌우 16px, 카드 사이 16px인 세로 스크롤 흐름이다.

## 4. 카드 focus

상태는 `focusedCard: CardId | null` 하나다. 동시에 하나만 focus할 수 있고 A에서 B로 이동할
때는 값을 바로 교체한다. 모달이나 별도 페이지가 아니다. 카드가 원래 Home 자리에서 커지고
주변 카드는 Figma `Focused cards`의 크기와 `Calendar Focus Interaction · Explorations`의
공간 배치에 맞춰 줄어든다. 전환은 이전/다음 카드의 화면상 위치와 크기를 잇는다. Figma의
해당 탐색 섹션에는 별도 키프레임 데이터가 없으므로 전환 시간은 UI 구현값이다.

Calendar focus의 데스크톱 기준은 왼쪽 115×210 카드 네 개, 오른쪽 790×440 Calendar,
아래 D-Day 115×210·Lecture Notes 452.5×210·Notes 452.5×210이다. Pad portrait는 왼쪽
230×150 카드 네 개, 오른쪽 490×684 Calendar, 그 아래 알림·메일·D-Day 세 카드다.
Phone에서는 주변 카드가 174×100의 2열로 압축되고 선택 카드의 원래 세로 위치를 유지한다.
이 위치 보존은 페이지 자체의 세로 스크롤과 별개다.

데스크톱 승인 크기:

- Large 790 × 440: Calendar, Mail, Notes
- Medium 452.5 × 440: Tasks, Notifications
- Small 452.5 × 210: D-Day
- focus 없음: Weather, Lecture Notes

데스크톱과 Pad에서는 focus 카드 밖을 누르면 Overview로 돌아간다. Phone에서는 모든 focus
카드 위에 공통 왼쪽 위 collapse 버튼을 보인다. Notes/Papers 상세 안의 내부 `뒤로`는
`detail → list`이고 Home collapse와 다른 단계다.

Phone 참조 높이는 Large 600px, Medium 440px, Small 210px다. 개별 카드 내용은 카드 밖으로
새지 않으며 필요한 긴 목록은 카드 안에서 스크롤한다.

## 5. 크기별 정보 우선순위와 Calendar

공간이 줄면 P3, P2 순으로 숨기고 P1을 유지한다. 카드 실제 폭을 기준으로 하는 container
query를 우선한다. Weather는 맥락과 온도를 P1, 보조 날씨 표현을 P2, 짧은 조언을 P3로 둔다.

Calendar의 P1은 사라지지 않고 표현을 바꾼다. 충분한 폭에서는 월간 6주 격자를, compact에서는
선택 날짜가 있으면 그 날짜의 주, 없으면 현재 주를 쓴다. 주는 월요일부터 시작하며 월의
실제 주 수에 맞춰 4~6행만 만든다. 오늘, 선택 날짜, 이벤트 여부를
유지하며 하루에 일정이 하나 이상 있으면 점은 하나만 그린다.

확장 Calendar의 일정 추가·전체 일정·등록·변경은 기존 `TaskPanel`과 task API를 사용한다.
별도 일정 form이나 상태 기계를 만들지 않는다.

셸의 갈피 로고, 탐색 점, 알림·테마·더보기 아이콘과 일정 체크 원은 Figma 원본 SVG를
`public/assets/figma/`에 보관해 사용한다. 날씨 이모지는 Figma 원본에서도 문자로 표현된다.

## 6. 데이터와 행동 정본

Home은 projection이며 독립 저장소가 아니다.

| 카드/화면 | 기존 정본 |
|---|---|
| Tasks, Calendar, D-Day | `/api/tasks/summary`, task API, `TaskPanel` |
| Mail | `/api/mail/status`, mail settings/preferences, Attention, body/requeue 동작 |
| Notifications | `/api/notifications`, `NotificationPanel` |
| Notes | vault note API, `NotePanel` |
| Papers | vault paper API, `PaperPanel` |
| Weather | `/api/weather`, 브라우저 현재 위치 |
| Codex | `/api/models/codex`, app_settings 저장, organize API |

한 소스의 실패가 다른 카드까지 막지 않도록 독립 요청을 `Promise.allSettled`로 읽는다.
서버 검증과 기존 mutation 의미가 항상 우선한다.

위치는 `getCurrentPosition()`으로 한 번 얻고 마지막 좌표 한 건만 기기의
`councilLastLocation`에 둔다. 서버·DB에는 위치 이력을 저장하지 않는다. 15분 날씨 캐시와
6시간 좌표 fallback을 유지하며 위치 실패는 다른 Home 카드를 막지 않는다.

## 7. Mail과 Notes 확장

Mail 확장은 현재 알림의 mail filter를 재사용해 목록과 실제 처리 동작을 제공한다. Mail 계정,
분석 상태, Push, 방해 금지, 알림 규칙, 재시도는 기존 mail API만 호출한다. UI용 두 번째 Mail
store를 만들지 않는다.

Notes 확장은 Note/Paper 패널 DOM과 controller를 그대로 옮겨 쓴다. Desktop은 넓은 카드 안의
목록·상세 구성을 쓰고 Phone은 `list → detail`로 이동한다. 내부 back은 detail에서 list로만
돌아간다. 저장된 paper를 여는 것만으로 활성 Chat context를 바꾸지 않는다.

## 8. Agents

Agents는 과거 세 줄 요약이 아니라 세 운영 카드다.
Figma `Home - Agents`의 Desktop은 폭 1058px·높이 210px 카드 셋을 21px 간격으로,
Pad는 폭 740px에 높이 238/234/246px을 16px 간격으로, Phone은 폭 358px에
Mail 334px·일정 286px·Codex 362px을 세로로 둔다. 내용이 길면 카드 높이는 늘어난다.
Desktop은 계정/분석/알림, 일정 수/현재 마감/다음 알림, 모델/정리 상태/대기열의 3열이다.
Pad는 각 카드가 2열로 재배치되고 Phone은 한 열로 압축된다. 운영 요약 안에 주간 달력을
넣지 않는다. 주간 달력과 상세 진단은 기존 에이전트 상세 화면에 남긴다.

- Mail 에이전트: 계정 상태, 분석 수, 알림 상태, 규칙과 status를 보인다. Push, 방해 금지,
  규칙 되돌리기는 기존 mail settings/preferences API를 호출한다.
- 일정 에이전트: `/api/tasks/summary`의 기간, 지연·오늘·예정·Inbox, 현재 마감과 다음 알림을
  보인다. 일정 추가와 전체 일정은 기존 `TaskPanel`을 연다.
- 사서 Codex: 일반 정리와 깊은 재처리 모델은 `/api/models/codex`가 준 실제 select다. 변경
  저장은 기존 app_settings 경로를, 목록 갱신과 대기열 정리는 기존 model/organize API를 쓴다.

세 카드는 각 소스 실패를 격리한다. Phone에서는 카드가 세로로 흐르고 action 영역은 줄바꿈해
버튼과 글자가 겹치지 않는다.

## 9. 이전 링크 호환

이전 설치 Service Worker와 이미 발행된 알림 URL은 입력 계약으로 유지한다.

- `/?panel=agents&taskView=reminders` → Home의 task/reminder 흐름
- `/?panel=notifications` → Home의 Notifications focus
- 이전 task notification 링크 → 기존 일정 알림 처리 흐름

과거 `data-panel-tab="agents"`를 보이는 탭으로 남기지 않는다. URL 호환 shim이 새 목적지로
해석하며 기존 push URL 자체는 바꾸지 않는다.

## 10. 비범위와 검증

범용 dashboard/widget framework, 사용자 배치 설정, drag-and-drop, UI layout 저장, 새 DB/API,
News UI, Trading, 강의 노트 백엔드, task/mail/note/paper/chat 재구축, Pi 배포는 이 작업 범위가
아니다.

검증 기준은 Desktop 약 1440px, Pad portrait 768/834px, Phone 약 390px이다. 모든 크기에서
가로 page overflow, 카드 내부 누출, 버튼 겹침, 고정 artboard clipping이 없어야 한다. Chat의
기존 model/composer/message/voice 동작과 Notes/Papers panel을 유지한다. 자동 검증은
`npm test`와 변경 JS `node --check`다.

과거 350px 한 열 Home과 Chat의 XION/Notifications 탭을 전제로 한 테스트는 이 계약의 회귀
테스트로 교체한다.
