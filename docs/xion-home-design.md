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
전역 탐색의 `Notes`는 별도의 강의 노트 자리다. 강의 노트 런타임이 아직 없으므로 지금은
`준비 중`만 표시한다. 토픽 노트·논문은 Chat 지식 패널과 Home의 기존 노트 카드에서 계속 쓴다.

## 2. Overview 카드

현재 카드는 Weather, Tasks, Calendar, Mail, Notifications, D-Day, Lecture Notes, Notes다.

News는 표시하지 않고 빈 자리도 남기지 않는다. 뉴스 수집·판단 백엔드는 그대로 두되 Home은
`/api/news/briefing`을 호출하지 않는다. Trading과 함께 다시 결정할 때까지 UI 범위 밖이다.

강의 녹음·전사 런타임과 강의 노트 전용 메타데이터는 아직 없으므로 Lecture Notes 카드는
`준비 중`을 표시한다. 별도 저장소나 임시 스키마를 만들지 않는다.

날씨 카드는 기존 `/api/weather`의 짧은 `message`를 기본 크기에서 보여준다. 카드가 실제로
좁아질 때만 이 보조 문구를 숨기며, 프론트에서 날씨 문장을 새로 만들지 않는다.

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
왼쪽은 날씨·할일·강의 노트·노트, 오른쪽은 달력·알림·메일·다가오는 날 순서로
각 열이 독립적으로 쌓인다. 기본 달력은 오른쪽 한 열의 360×260 카드다.
Phone은 좌우 16px, 카드 사이 16px인 **한 열**의 세로 스크롤 흐름이다.

## 4. 카드 focus

상태는 `focusedCard: CardId | null` 하나다. 동시에 하나만 focus할 수 있고 A에서 B로 이동할
때는 값을 바로 교체한다. 모달이나 별도 페이지가 아니다. 카드가 원래 Home 자리에서 커지고
주변 카드는 Figma `Focused cards`의 크기와 `Calendar Focus Interaction · Explorations`의
공간 배치에 맞춰 줄어든다. 전환은 이전/다음 카드의 화면상 위치와 크기를 잇는다. Figma의
해당 탐색 섹션에는 별도 키프레임 데이터가 없으므로 전환 시간은 UI 구현값이다.
데스크톱의 모든 focus 배치는 카드가 위쪽 빈 공간으로도 이동해 기본 Home과 같은 3행·670px
영역 안에 머문다. 아래에 4행을 덧붙여 데스크톱 화면을 스크롤시키지 않는다.
Calendar·Tasks는 1행, Mail·Notifications·Notes는 2행, D-Day는 3행을 확장의 기준으로
삼는다. 특히 Notes가 Calendar의 포커스 위치로 이동해서는 안 된다. 주변 카드만 빈 자리와
윗줄로 재배치한다.

Mail focus에서는 다른 카드를 윗줄로 옮기지 않는다. 기존 1·2·3행의 순서를 유지하면서
행 높이를 95·440·95px로 바꿔 메일이 원래 2행에서 790×440으로 커진다. 총 높이는
기본 격자와 같은 670px이다.

Calendar focus의 데스크톱 기준은 왼쪽 115×210 카드 네 개, 오른쪽 790×440 Calendar,
아래 D-Day 115×210·Lecture Notes 452.5×210·Notes 452.5×210이다. Pad portrait에서
Medium·Small focus는 원래 열 안에서 위아래 카드가 줄어들며, Large focus만 740×440으로
두 열을 사용하고 주변 카드를 위아래로 재배치한다. Phone은 focus 전후 모두 한 열이다.
선택 카드의 원래 세로 순서를 유지하면서 주변 카드가 세로로 줄어든다. Pad·Phone에서는
focus 뒤 페이지가 더 길어져도 자연스럽게 스크롤한다.

데스크톱 승인 크기:

- Large 790 × 440: Calendar, Mail, Notes
- Medium 452.5 × 440: Tasks, Notifications
- Small 452.5 × 210: D-Day
- focus 없음: Weather, Lecture Notes

데스크톱과 Pad에서는 focus 카드 밖을 누르면 Overview로 돌아간다. Phone에서는 모든 focus
카드 위에 공통 왼쪽 위 collapse 버튼을 보인다. Notes/Papers 상세 안의 내부 `뒤로`는
`detail → list`이고 Home collapse와 다른 단계다.
Phone에서 collapse할 때는 방금 보던 카드가 화면의 같은 위치에 남도록 스크롤을 보정한다.
페이지가 짧아져 스크롤 범위가 부족하면 필요한 만큼만 임시 아래 여백을 유지한다.

Phone 참조 높이는 Large 600px, Medium 440px, Small 210px다. 개별 카드 내용은 카드 밖으로
새지 않으며 필요한 긴 목록은 카드 안에서 스크롤한다.
할일 focus는 숫자·진행 막대·목록과 각 일정의 동작을 보여준다. `일정 추가`·`전체 일정`은
이 카드에 넣지 않는다. 진행 막대는 기존 완료 이력과 남은 오늘 일정으로 계산하고,
오늘 대상이 전혀 없으면 표시하지 않는다.

## 5. 크기별 정보 우선순위와 Calendar

공간이 줄면 P3, P2 순으로 숨기고 P1을 유지한다. 카드 실제 폭을 기준으로 하는 container
query를 우선한다. Weather는 맥락과 온도를 P1, 보조 날씨 표현을 P2, 짧은 조언을 P3로 둔다.

Calendar의 P1은 사라지지 않고 표현을 바꾼다. 데스크톱 기본 카드의 월간 격자는 피그마처럼
주별 구분선과 아래 일정 목록을 가지며, 실제 월의 주 수에 맞춰 4~6행을 만든다. Pad·Phone
기본 카드는 기준 주와 앞 주(첫 주라면 다음 주) 두 행을 보여 주고, 115px처럼 좁아진 동반 카드는
기준 주 한 행을 세로로 보여 준다. 기준 주는 선택 날짜가 있으면 그 날짜의 주, 없으면 현재
주다. 오늘은 채운 원, 선택 날짜는 점선 원이며 하루에 일정이 하나 이상 있으면 피그마 원본
표시 SVG로 점 하나만 그린다. 초기에는 선택 날짜가 없으므로 점선 원도 없다. 세로 압축
주간 보기에서는 날짜 행과 두 원의 높이를 맞춰 이웃 날짜와 겹치지 않게 한다.

확장 Calendar의 일정 추가·전체 일정·등록·변경은 기존 `TaskPanel`과 task API를 사용한다.
별도 일정 form이나 상태 기계를 만들지 않는다.
Calendar focus의 오른쪽 상단은 날짜 pill·세로 구분선·전체 일정·세로 구분선·일정 추가하기의
25px 선택기이며, 세 항목은 같은 높이로 정렬되고 활성 항목에 같은 연녹색 배경을 쓴다.
일정 제목과 목록은 그 아래에 둔다. Figma의 `Calendar Focus Interaction ·
Explorations`에 따라 선택 날짜, 전체 일정(오늘·예정·알림·반복·종결), 일정 추가를 전환하고,
선택 날짜의 `+ 일정 추가`와 일정 추가의 `수동으로 생성`은 각각 작성 상태를 연다. 취소하면
해당 보기로 돌아간다. 자연어 일정 요청은 Chat 기록을 만들지 않고 Codex CLI가 달력 카드 안의
미저장 확인 후보로 해석한다. 후보는 기존 일정 validator와 `TaskPanel` 확인 카드를 사용하며
카드에는 `취소·수정·등록`을 둔다. `수정`은 위 입력창을 재사용해 현재 후보와 변경 요청을
Codex CLI에 전달하고, 검증된 새 후보로 교체한다. 실패·모호함은 원래 후보를 유지한다.
`등록`을 눌러야만 저장한다. 수동 등록과 기존 일정 변경도 `TaskPanel`을 쓴다.
Phone에서도 월간 격자 아래에 같은 선택기와 내용이
한 열로 이어지며 긴 목록·작성 폼만 카드 안에서 스크롤한다. Notes focus의 노트·논문 선택기는
카드 헤더 안의 16px 텍스트와 세로 구분선이다. 각 상세 목록·동작은 기존 NotePanel/PaperPanel을 쓴다.

셸의 갈피 로고, 탐색 점, 알림·테마·더보기 아이콘과 일정 체크 원은 Figma 원본 SVG를
`public/assets/figma/`에 보관해 사용한다. 날씨 이모지는 Figma 원본에서도 문자로 표현된다.

## 6. 데이터와 행동 정본

Home의 기존 카드들은 각 도메인의 projection이다. D-Day는 일정과 별도로 사용자가 직접
이름·날짜를 등록하는 기능이므로 자체 저장소를 쓴다. 일정의 생성·변경·알림·완료와
연동하지 않으며, 홈에는 오늘 이후의 가까운 D-Day 세 건을 표시한다. Focus 카드의
`D-Day 관리`에서 추가·수정·삭제한다. 반복 규칙은 현재 제품 범위에 없다.

| 카드/화면 | 기존 정본 |
|---|---|
| Tasks, Calendar | `/api/tasks/summary`, task API, `TaskPanel` |
| D-Day | `ddays` 테이블, `/api/ddays` |
| Mail | `/api/mail/status`, mail settings/preferences, Attention, body/requeue 동작 |
| Notifications | `/api/notifications`, `NotificationPanel` |
| Notes | vault note API, `NotePanel` |
| Papers | vault paper API, `PaperPanel` |
| Weather | `/api/weather`, 브라우저 현재 위치 |
| Codex | `/api/models/codex`, app_settings 저장, organize API |

한 소스의 실패가 다른 카드까지 막지 않도록 독립 요청을 `Promise.allSettled`로 읽는다.
서버 검증과 기존 mutation 의미가 항상 우선한다.

Pad·Phone의 Chat 화면은 전역 헤더만 보이고 Chat 전용 헤더는 숨긴다. 웹 사용량은 이
화면에서만 전역 헤더의 알림 아이콘 옆에 둔다. 지식 패널을 여는 책 버튼도 Chat에서만
보인다. 데스크톱 Chat 헤더는 유지한다.

위치는 `getCurrentPosition()`으로 한 번 얻고 마지막 좌표 한 건만 기기의
`councilLastLocation`에 둔다. 서버·DB에는 위치 이력을 저장하지 않는다. 15분 날씨 캐시와
6시간 좌표 fallback을 유지하며 위치 실패는 다른 Home 카드를 막지 않는다.

## 7. Mail과 Notes 확장

Mail 확장은 현재 알림의 mail filter를 재사용해 목록과 실제 처리 동작을 제공한다. Mail 계정,
분석 상태, Push, 방해 금지, 알림 규칙, 재시도는 기존 mail API만 호출한다. UI용 두 번째 Mail
store를 만들지 않는다.

Home의 Notes 카드 확장은 Note/Paper 패널 DOM과 controller를 그대로 옮겨 쓴다. Desktop은 넓은 카드 안의
목록·상세 구성을 쓰고 Phone은 `list → detail`로 이동한다. 내부 back은 detail에서 list로만
돌아간다. 저장된 paper를 여는 것만으로 활성 Chat context를 바꾸지 않는다.

## 8. Agents

Agents 메인은 Figma `392:958`(Desktop), `398:994`(Pad), `396:976`(Phone)을 따른다.
Desktop은 큰 데이터 보드(800px 기준) + 오른쪽 상태 레일, Pad는 같은 2열,
Phone은 압축형 2열 상태 카드가 위에 오고 데이터 보드가 아래에 온다.
Mail·일정·Codex·Reels/Shorts 진입은 기존 상세 컨트롤러와 API를 사용한다.

- 데이터 보드는 설명 헤더 없이 그래프부터 표시한다. 우상단에 `인스타그램`, 좌상단에 작은 색상 범례를 두고, 집계 기준·조회 시각은 접힌 일별 데이터 안에서 확인한다. 그래프 높이는 최대 220px로 제한해 아래 YouTube 영역을 확보한다.
- Instagram 조회수는 `/api/reels/instagram/insights`로 계정 전체 Reels(수동 게시 포함)의
  최근 7개 Meta 집계일을 조회한다. `views`의 `media_product_type=REEL`만 사용한다.
  Meta의 `reach` 일별 응답에서 경계 `end_time`만 읽고, 조회수는 각 인접 경계 사이의
  `views/total_value` 응답을 읽는다. `until`에는 종료 시각 1초 전을 넣어 경계일 중복을 막는다.
  날짜 정본은 Meta 집계 구간이며 그래프에는 종료일, 표에는 UTC 시작·종료 시각을 표시한다.
  조회수는 실측 점을 잇는 추세선으로 표시한다. 누락 구간은 이어 그리지 않고 미제공으로 두며
  0으로 채우지 않는다. 조회 시각은 한국 시간으로 표시한다.
  팔로워는 계정 전체 `followers_count` 총수를 1시간마다 실제 관측하며 감소도 그대로 보존한다.
  계정별 기록 파일은 기존 토큰 폴더의 `instagram-followers-<account hash>.json`이며 0600 원자적
  쓰기로 재시작 후에도 유지한다. 파일 계정 불일치·손상은 덮어쓰지 않고 기록 오류로 표시한다.
  Meta 집계 구간 안의 마지막 관측을 일별 총수로 표시하고 관측 시각을 함께 표시한다.
  기록 전 구간은 미제공이며 역산·앞 값 채우기·증가 강제는 하지 않는다. 현재 구간의 최신 관측은
  한국 시간 관측일의 날짜 위치에 표시한다. 같은 날짜의 조회수 점이 있으면 같은 x축 위치를 쓰며,
  없으면 실제 관측 날짜만 추가하고 조회수는 미제공으로 둔다. Meta 조회수 집계 구간 자체를 바꾸지는 않는다.
  점 옆 숫자 라벨은 표시하지 않고 축 눈금·가로 격자선과 일별 데이터 표로 읽는다. 조회수는 녹색 왼쪽 축(회), 팔로워는 보라색 오른쪽 축(명)이며
  두 시계열 모두 실측 점을 잇는 꺾은선이다. 아직 관측이 한 개면 선을 만들어내지 않고 점만 그린다.
  API 오류·기록 실패 시 조회수는 유지하며 팔로워는 실제 저장된 기록과 오류 안내만 표시한다.
  이 파일은 DB/Vault 백업 범위 밖의 별도 계정 상태이며 운영 백업 시 함께 보존해야 한다.
  정상 조회는 서버 메모리에 1시간 캐시한다. 실패 뒤 5분간 재요청을 제한하고 기존 결과가
  있으면 실제 조회 시각과 함께 오래된 결과임을 명시한다. 최초 실패는 오류/인증 안내다.
  기존 Instagram Login 사용자·토큰 파일 우선순위·Graph 버전을 재사용하며 게시 활성화와
  성과 읽기는 독립적이다. 토큰·Meta 오류 원문은 API/로그/DB에 노출하지 않는다.
  DB·제작·게시 파이프라인은 바꾸지 않는다. 조회수는 API가 반환하는 최근 구간을 읽으므로
  장기 조회수 이력 보관은 이번 범위에 없다. YouTube Shorts는 데이터 미연결이다. 가상 성과를 만들지 않는다.
- 카드 뉴스 제작은 별도 작업이다. 현재 main에 제작 API가 없으므로 미연결로 표시한다.
  일반 `/api/news/briefing`을 카드 뉴스 제작 API로 취급하지 않는다. 1차·2차에서 제작 파이프라인을 개편하지 않는다.
  배포 전 Pi에서 확인한 별도 카드 뉴스 UI는 사용자 승인에 따라 원본 함수와 `/api/cards/*` 계약을 보존해 연결한다.
  API가 404인 동안은 미연결이며, 서버 활성화는 별도 카드 뉴스 작업의 책임이다.
- Mail 상세는 연결 계정·분석 상태·알림 설정·저장된 선호 규칙을 두 열로 배치한다.
  Push/방해 금지는 기존 settings API, 규칙 되돌리기는 기존 preferences API를 쓴다.
  인증 오류는 재인증 안내만, 분석 복구는 실패 건이 있을 때만 표시한다. 실제 메일은 기존 알림 화면에서 확인한다.
- 일정 상세는 summary의 counts·주간 달력·오늘/지연·알림을 재사용한다.
  추가·변경·완료와 알림 동작은 기존 TaskPanel을 쓰며 화면 열기로 알림을 자동 확인하지 않는다.
- Codex 상세는 대기열·CLI/카탈로그와 모델 설정을 분리한다. 정확한 모델 ID·version을 유지한다.
  CLI 비정상·상태 조회 실패·recovery_required에서는 정리/재시도를 fail-close한다.
  수동 복구는 자동 재시도와 구분하며 기존 서버 복구 gate를 유지한다.
- Reels 상세는 주제 선정 → 영상 제작 → 영상 검토 → 게시의 4단계다.
  수동 펼침 없이 현재 단계의 내용만 표시한다. 한국 시간 19시부터 다음 날 19시까지
  후보 batchId를 하루 사이클로 삼고, 같은 사이클의 현재 단계 이전에만 체크한다.
  19시에는 전날 표시를 초기화하고 새 후보가 없으면 대기를 표시한다. 기존 제작·게시 기록은 삭제하지 않는다.
  기존 후보 선택/거절/보류, 승인/수정/폐기, 인증된 미디어 blob, 다운로드/공유,
  플랫폼별 게시 상태·실패 재시도·수동 게시 계약을 유지한다. 완료는 실제 uploads 상태로만 표시한다.
  카드 뉴스 열은 연결 시 기존 후보·검토·게시 UI를, 미연결 시 안내를 표시한다. Pad는 두 열, Phone은 한 열이다.

각 소스 실패는 다른 에이전트에 전파하지 않는다. 모든 도메인 문자열은 textContent로 표시한다.
기존 task/mail/reels API의 시간·identity·provenance, 모델, 업로드와 복구 계약 및 SW payload는 바꾸지 않는다.

1차 로컬 검증 (2026-10-10, 기준 main `e98732f`): 변경 관련 59 PASS.
전체 실행은 2,039 PASS / 2 FAIL / 24 SKIP였고 두 실패는 변경 전 main으로도 재현한
`assistant-task-ui.test.js`의 기존 다크 테마 기대값 불일치다. GitHub CI 결과로 주장하지 않는다.
`scripts/check-agents-ui.js`는 설치된 Chrome/Playwright로 실제 public 셸·AgentPanel·TaskPanel을
메모리 fixture API에 연결해 1440/820/390px의 메인·상세·오류·Reels 상태를 검사한다.
실제 계정·Push·게시 API 호출, Pi 배포와 iOS 기기 인수는 이 검증에 포함하지 않는다.

## 9. 이전 링크 호환

이전 설치 Service Worker와 이미 발행된 알림 URL은 입력 계약으로 유지한다.

- `/?panel=agents&taskView=reminders` → Home의 task/reminder 흐름
- `/?panel=notifications` → Home의 Notifications focus
- 이전 task notification 링크 → 기존 일정 알림 처리 흐름

과거 `data-panel-tab="agents"`를 보이는 탭으로 남기지 않는다. URL 호환 shim이 새 목적지로
해석하며 기존 push URL 자체는 바꾸지 않는다.

## 10. 비범위와 검증

범용 dashboard/widget framework, 사용자 배치 설정, drag-and-drop, UI layout 저장, 새 DB,
News UI, Trading, 강의 노트 백엔드, task/mail/note/paper/chat 재구축은 이 작업 범위가
아니다.

검증 기준은 Desktop 약 1440px, Pad portrait 768/834px, Phone 약 390px이다. 모든 크기에서
가로 page overflow, 카드 내부 누출, 버튼 겹침, 고정 artboard clipping이 없어야 한다. Chat의
기존 model/composer/message/voice 동작과 Notes/Papers panel을 유지한다. 자동 검증은
`npm test`와 변경 JS `node --check`다.

과거 350px 한 열 Home과 Chat의 XION/Notifications 탭을 전제로 한 테스트는 이 계약의 회귀
테스트로 교체한다.

## 11. 다크 테마 토큰 (2026-09-30)

Figma `galpi-home-design`에는 다크 정본이 없다(변수는 라이트 한 벌). 다크는 라이트와 같은 층 구조 —
바탕(`--bg`) < 카드(`--ai-bubble`) < 옅은 면(`--user-bubble`) — 를 한 단계씩 분명히 두고, 경계선은
보이는 실선으로 긋는다. 바탕 `#151A18`·카드 `#1E2521`·경계 흰색 10%일 때는 카드가 바탕에 뭉개져
시인성이 나빴다(사용자 지적). 현재 값은 `style.css`의 `[data-theme="dark"]`가 정본이다: 바탕
`#1B211E`, 카드 `#252D29`, 옅은 면 `#2E3A34`, 경계 `#3A4640`, 본문 `#E7EDE9`, 보조 `#AEBAB3`,
강조 글자 `#8CC4AA`. 앱 상단 `theme-color`도 바탕과 같다.

기능 화면은 색을 하드코딩하지 않고 이 토큰을 쓴다. 셸 토큰에 없는 색만 기능 CSS에서 라이트·다크
한 쌍으로 둔다(예: 강의 노트 `--lc-*`). PDF·백지 페이지는 종이라 두 테마 모두 흰색이고 필기 잉크
색도 바꾸지 않는다.
