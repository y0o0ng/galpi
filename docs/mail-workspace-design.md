# Galpi Mail Workspace

## Backend Phase 1

Mail Workspace의 화면 정본은 [galpi-home-design의 Mail Workspace](https://www.figma.com/design/8EafrARqh4NwKmaRvwRkZM/galpi-home-design?node-id=449-931)다. 이 단계는 화면이 나중에 사용할 계정·메일함·목록·상세 계약을 적용한다. 내부 API는 `API의 별도 플래그 뒤에 둔다.

[Mail Agent 설계](xion-mail-agent-design-final.md)는 INBOX 동기화, 신규 메일 분석, Attention, Push, 채팅 검색과 기존 알림 카드의 계약을 계속 정의한다. 이후 Workspace 화면이 완성되면 일반 메일 탐색과 상세 표시를 이 설계가 맡는다. 분석 큐와 운영·알림 경로는 해당 단계에서도 기존 Agent의 책임이다. v44의 시온 답장 경로는 기존 계약을 따른다.

## 제공자

- Gmail은 Agent 읽기 경로와 동일한 OAuth 토큰 인스턴스와 MAIL-1 자격증명을 사용한다. Workspace는 Gmail REST의 `labels.list`와 `messages.list/get`를 GET으로 호출한다. `kind=label`과 `kind=all`을 구분한다. 전체 메일은 Gmail의 All Mail 범위로 조회하고 스팸·휴지통은 해당 라벨에서 조회한다. 메시지 ID와 thread ID를 보존한다. 목록에는 선택된 MIME 트리 메타데이터만 요청하고 깊이 제한 아래에서 첨부 유무를 확정할 수 없으면 `null`을 반환한다. [Gmail 목록](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/list) · [Gmail 메시지 조회](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/get)
- Naver·NAVER WORKS는 기존 TLS·앱 비밀번호 설정을 공유한다. LIST에서 반환된 경로·구분자·Special-Use·선택 가능 여부를 사용한다. 실제 INBOX는 서버가 반환한 inbox 경로로 찾는다. 폴더 페이지는 첫 요청의 UID 상한과 마지막 UID 경계를 기준으로 진행한다. 폴더 선택은 항상 read-only이고 원문에는 `BODY.PEEK`를 사용한다. [ImapFlow API](https://imapflow.com/docs/api/imapflow-client/)
- 목록과 상세에서 `starred`는 Gmail `STARRED` 또는 IMAP `\Flagged`다. `important`는 Gmail `IMPORTANT`를 별도로 보존하며 IMAP에서는 `null`이다. Agent의 AI 분류는 별도 데이터다. 이전 v45 캐시의 별표는 저장된 Gmail 라벨이나 IMAP의 이전 `important` 필드에서 복원한다.
- 제공자별 자격증명 하나를 유지한다. Gmail 프로필 또는 IMAP 로그인 계정이 저장된 계정 주소와 일치할 때만 새 관측을 읽는다.

## 위치 검증과 저장

v45의 `mail_client_messages`에는 계정, 제공자 위치, 검증값, 발신·수신·제목·수신 시각, 폴더·라벨, 마지막 관측 플래그, 첨부 존재와 갱신 시각을 보존한다. `mail_client_cache`에는 요청한 목록 범위의 메타데이터 관측만 둔다. 같은 Gmail ID는 라벨을 여러 개 갖더라도 한 메시지다. IMAP에서는 폴더·UID·UIDVALIDITY와 메타데이터 검증값을 사용한다. UIDVALIDITY에 유효한 값이 없으면 응답 페이지의 원문 바이트 SHA-256을 추가한다. UID 재사용 뒤 관측이 달라지면 새 상세 ID가 발급되고 이전 ID의 상세 요청은 `409 MAIL_CLIENT_LOCATION_STALE`로 끝난다. 폴더가 다르면 RFC Message-ID가 같아도 각 폴더 위치를 보존한다.

목록은 요청한 페이지와 통합 수신 시각 창만 읽는다. 과거 일괄 수집과 주기 동기화 작업은 두지 않는다. 캐시는 계정당 최근 256개 목록 관측을 보관한다. 성공한 갱신은 기존 관측을 대체하고, 공급자 오류 시 해당 목록의 최종 성공 캐시가 있으면 `stale`과 갱신 실패 코드를 함께 반환한다. 오래된 상세 ID로 열 때는 현재 원본을 다시 검증한다.

Agent 메시지·Attention 링크는 계정과 Agent identity, 해당 제공자 위치를 대조한다. IMAP은 INBOX에서 UID, 유효 UIDVALIDITY, 원본 identity, 발신 주소·제목·봉투 날짜를 함께 확인한다. 기존 Agent 행에는 RFC Message-ID가 있을 때 과거 원문 해시를 보관한 적이 없으므로, 이전 바이트와의 동일성은 새 Workspace 관측부터 적용된다. 한 번 확인된 링크는 그 상세 ID에 고정되고 새 위치를 가리키기 시작하면 위치 오류를 반환한다. 조회 결과를 `mail_messages`나 분석 큐에 기록하는 경로는 없다.

## 통합 받은편지함

통합 목록은 동일한 UTC 수신 시각 창에 대해 계정별 받은편지함을 병렬 조회한다. 완료한 창의 메시지는 수신 시각 내림차순으로 정렬하고, 동률은 계정 ID와 제공자 위치로 고정한다. UID 할당 순서와 수신 날짜가 다른 IMAP 메일도 같은 시각 정렬을 적용한다. 기본 7일 창에 계정별 후보가 200건을 넘으면 채우기 전에 창을 양분한다. 같은 1초에 모인 메일은 동률 정렬을 위해 그 범위 전체를 조회한다. 과거 창으로 이동할 때 제공자의 날짜 검색은 ID와 날짜만 조사하며 메타데이터는 요청 범위 안에서 읽는다.

커서는 서버에서 발급하는 불투명 토큰으로 10분 동안 유지한다. 같은 커서 재시도에는 같은 페이지를 반환하며, 재시작·만료 후 첫 페이지에서 다시 시작한다. 요청한 개수에 도달하거나 과거 메일이 끝날 때까지 날짜 창을 이어 읽는다. 한 요청에서 새 창은 최대 3개 읽으며, 더 탐색해야 하면 후속 커서를 반환한다. 계정별 `fresh`·`stale`·`unavailable`과 `incomplete`를 명시한다. 한 페이지에 여러 창의 결과가 들어와도 행마다 해당 관측 시각과 캐시 상태를 유지한다. 범위를 제공하지 못한 계정은 후속 탐색에서 제외하되 이미 조회한 메시지는 보존한다. 새 첫 페이지에서 해당 계정을 다시 시도한다. 새 메일 유입이나 제공자 삭제에 따라 아직 읽지 않은 날짜 창의 관측은 달라질 수 있다.

## 상세와 첨부

Gmail 상세는 Workspace 전용 `format=raw`, IMAP 상세는 검증을 함께 수행하는 원문 PEEK를 사용한다. 텍스트 본문은 16,000자 분석 정규화를 거치지 않고 전체를 반환한다. HTML 전용 메일은 HTML을 평문으로 변환한다. 응답의 본문 형식은 `text`이고 후속 화면에서는 `textContent`로 표시한다. 외부 이미지·링크의 자동 호출, HTML 실행, 첨부파일 다운로드는 이 API에서 지원하지 않는다. MIME에서 파싱한 첨부 이름·타입·크기·인라인 여부와 `Message-ID`, `In-Reply-To`, `References` 및 제공자 thread ID를 제공한다. 32 MiB를 초과하는 원문은 상세에서 `413`으로 표시한다. 이 제한은 잘린 응답을 전체 본문으로 표시하지 않도록 둔다. 원문과 첨부 바이트는 영구 저장 대상에서 제외한다.

## API

`MAIL_CLIENT_ENABLED=false`가 기본값이다. 기존 `/api/` 인증과 요청 제한을 적용하고 응답에 `Cache-Control: no-store`를 붙인다. 성공 응답은 `success: true`, 실패는 HTTP 상태와 `code`를 반환한다. 목록의 `limit` 기본값은 20, 상한은 25다.

| GET 경로 | 반환 |
| --- | --- |
| `/api/mail-client/accounts` | 연결 계정 ID, 제공자, 주소, 상태 |
| `/api/mail-client/accounts/:accountId/mailboxes` | 실제 메일함·라벨과 관측 상태 |
| `/api/mail-client/accounts/:accountId/messages?mailbox=…&cursor=…` | 선택 목록, 원본 관측 상태, 후속 커서 |
| `/api/mail-client/inbox?cursor=…` | 통합 목록, 계정별 관측 상태, 불완전 여부와 후속 커서 |
| `/api/mail-client/messages/:messageId` | 메일 상세, 평문 본문, 송수신 정보, 스레드 관계와 첨부 메타데이터 |
| `/api/mail-client/messages/:messageId/attachments` | 첨부 메타데이터 |
| `/api/mail-client/agent-messages/:messageId` | 기존 Agent 메시지를 검증한 Workspace 상세 ID |
| `/api/mail-client/attention/:attentionId` | 현재 Attention 메시지를 검증한 Workspace 상세 ID |

제공자 쓰기·초안·전송·읽음 플래그 변경과 자동 분석은 별도 단계의 권한이다. 모의 HTTP 및 IMAP과 기존 Agent 회귀 검증은 로컬에서 실행하고, 실계정 스모크는 별도 검증으로 다룬다.
