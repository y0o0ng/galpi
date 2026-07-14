# 유지보수 메모

코드 리뷰에서 확인된 버그·구조 이슈를 추적하는 파일. 고치면 해당 항목에 처리 커밋을 적고 "처리됨"으로 옮길 것.

## 2026-07-14 작업분 리뷰 (범위: `0aed95a`~`ac4db10`, 21커밋)

V4 논문 검색 1·2차, 논문 서재/노트 패널, 새벽 저장·검색 픽스 전체를 8개 앵글로 스캔 후 검증 에이전트로 확인한 결과. 검증 통과 10건 (CONFIRMED 9, PLAUSIBLE 1). 심각도순.

### 처리됨 (`fd615c7`)

1. **의회 노트 수동 저장 영구 차단** — 자동 topic과 수동 council의 저장 판정을 노트 타입별로 분리했다. 히스토리 `noteSaved`, 저장 상태 API, 중복 검사도 같은 규칙을 사용한다.
2. **전부 불용어인 질의의 검색 빈 결과** — 의미어가 없어도 질의 임베딩이 있으면 임베딩 전용 랭킹으로 폴백한다. 로컬 API에서 `그 내용 알려줘`가 14건을 회수했다.
3. **저장 약 7초 뒤 전체 재렌더와 스크롤 점프** — 메시지 ID가 같은 저장 버튼만 갱신하고 수동 저장 직후 로컬 시그니처를 반영한다. Playwright에서 DOM 노드와 스크롤 위치 보존을 확인했다.
4. **노트 탭 스테일 목록** — 노트 탭을 열 때마다 목록을 다시 조회한다.
5. **논문 노트가 일반 노트 목록을 잠식** — `/api/vault/notes`에 `excludeNoteType`을 추가하고 서버에서 paper를 제외한 뒤 limit을 적용한다.
6. **`/paper` 초기화 실패 후 복구 불가** — config 실패 경로에서도 패널을 초기화하고 `/paper` 실행 시 초기화를 재시도한다.
7. **잘못된 200 응답의 빈 결과 캐시** — 비JSON 또는 `data` 배열이 없는 성공 응답을 `invalid_response`로 거부하며 캐시하지 않는다.
8. **펫이 앱 콘텐츠 클릭을 가로챔** — 이동 범위는 유지하되 겹친 버튼·링크·입력 요소를 우선 클릭한다. 빈 영역에서는 기존 펫 메뉴와 드래그가 유지된다.
9. **PaperPanel.init 예외가 config 배선을 중단** — 필수 DOM을 먼저 검증하고 초기화 예외를 config 배선과 격리했다. 스테일 HTML Playwright 재현에서 모델·의회 초기화가 계속되는 것을 확인했다.

검증: `node:test` 34개, 관련 JS 문법 검사, 모바일 390px·데스크톱 1440px Playwright 회귀 테스트 통과. 2026-07-15 Pi 배포 후 서비스 정상 기동, 일반 노트 목록의 paper 제외, 불용어 질의 임베딩 폴백, 의회 저장 상태 API를 확인했다.

### 구조 이슈 (다음 리팩터링 때)

10. **note-panel.js가 paper-panel.js 헬퍼 ~70-90줄 복제** — `public/note-panel.js:44` (CONFIRMED, 8개 앵글 중 5개가 독립 지적)
    - backIcon·formatUpdatedAt·makeSectionHead·renderLoading·renderError·스켈레톤이 거의 그대로 복사, 'paper-panel-*' CSS 클래스 재사용. 이미 renderLoading/renderError가 드리프트 시작. 예정된 '에이전트' 탭이 세 번째 사본을 만들기 전에 공용 패널 헬퍼로 추출할 것.

추가로 확인됐지만 10건 컷에 밀린 클린업 테마 (전부 CONFIRMED):
- `lib/paper-search.js`가 server.js의 URL 정규화(`normalizeWebUrl`)·텍스트 새니타이저(`sanitizeWebText`)·TTL 캐시를 복제 (URL 정규화는 paper-panel.js까지 3중). server.js 헬퍼를 lib/으로 추출해 공유할 것.
- `watchMessageSaveState`(1.5s/4s 타이머 + `/api/messages/:id/save-status` 전용 엔드포인트)가 기존 7초 폴링·noteSaved 렌더와 3중으로 같은 질문에 답함. 채널 하나로 정리.
- `searchVault`가 검색마다 노트 전문을 term당 두 번 스캔 (termDocFreq의 includes + 스코어링 regex). 예전 mtime 키 termSet 캐시가 제거됨 — Pi에서 검색마다 비용.
- `PAPER_SEARCH_MOCK` env 배선이 테스트의 `mockResponse` 옵션과 중복 (오프라인 프론트 개발용으로 남길지 판단).

### 검증에서 반증된 항목 (재보고 방지용 기록)

- 마크다운 괄호 URL 링크 깨짐(`lib/paper-notes.js:49`): marked v18이 균형 괄호를 처리함 — 실제 렌더 테스트로 반증. 불균형 `)`만 문제인데 현실적 케이스 없음.
- mock 픽스처의 `javascript:` URL 서빙 우려: `normalizeHttpUrl`이 http/https 외 프로토콜을 걸러냄. 픽스처는 새니타이즈 테스트용.
- `watchMessageSaveState`가 4초 초과 저장을 놓친다는 주장: 7초 폴링 시그니처가 최종 상태를 잡음 (코드 주석대로).
