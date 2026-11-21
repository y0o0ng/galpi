# Galpi Mail Workspace

## 프론트엔드 화면과 API

[피그마 Mail Workspace](https://www.figma.com/design/8EafrARqh4NwKmaRvwRkZM/galpi-home-design?node-id=449-931)의 45개 프레임을 화면 정본으로 삼고, 제공된 HTML로 해당 화면의 값을 확인한다. Home의 Agents 탭 Mail 에이전트 카드에서 들어간다.

| 프레임 | 구현과 연결 |
| --- | --- |
| Desktop 01~04·15·16, T1·T2, P1·P2 | 목록·선택·검색·필터·계정 폴더·임시보관함, 제공처별 서랍. 검색과 필터는 제공자 메일함 검색 API에 연결한다. |
| Desktop 05~07·17·18, T3·T4, P3~P5 | 상세, 첨부, 답장·전체 답장·전달, 초안 버전 충돌, 발송 확인. HTML은 격리된 프레임에 표시하고 답장·전달의 원문 인용에는 평문을 사용한다. 화면에서 명시한 전송만 실행한다. |
| Desktop 08·10~14 | Phase 4 스마트 분류 목록과 일정 달력. 명시적으로 배치된 분류 필터를 적용하고 원본을 검증해 연다. |
| A1~A4 | 스마트 메일함 제목 옆에서 시작하는 수동 일괄 분석. 확인창·진행 버튼·결과 토스트·대상 없음 상태를 연결한다. |
| Desktop 09, C1~C5, P6·P7 | 메일 설정과 연락처 목록·상세, CSV 매핑·미리보기·확정, 수신자 자동완성. 연결 계정의 추가·관리·재인증을 제공하며 알림 설정·규칙 해제·분석 재처리는 기존 인증 API를 사용한다. |
| S1~S11 | 휴지통/검색 빈 상태, 목록·상세 로딩, 재인증, 동기화, 읽음/이동 실패, 원본 없음, 다운로드 실패, 발송 불명. 확인된 실패만 명시적으로 재시도할 수 있다. |

이동은 필터 팝오버 패널과 계정 서랍의 계정별 펼침 목록을 재사용한다. 한 번에 같은 계정의 메시지만 이동한다. Gmail은 받은편지함 또는 실제 사용자 라벨의 출발 위치를 확인하고, 전체 메일에서는 대상 라벨을 추가한다. IMAP은 서버의 검증된 같은 계정 폴더로 이동한다. 발송·이동 결과가 불명확하면 자동으로 다시 요청하지 않는다.

### 추가한 인증 API

- `GET /api/mail-client/search`는 Gmail·Naver·NAVER WORKS에서 아직 열지 않은 과거 메일까지 검색한다. 검색어는 제목·발신자·받는 사람(To)에서 찾고, 발신자 전용 조건과 계정·메일함·기간·첨부·별표·읽음 필터를 함께 적용할 수 있다. 검색어 없이 필터만 적용해도 제공자 범위는 같다. 스팸·휴지통·초안은 기본 검색에서 제외하며 해당 라벨이나 폴더를 직접 선택하면 포함한다. `role`(`inbox`·`sent`·`drafts`·`junk`·`trash`)은 `inbox=1`·`mailbox`와 함께 쓸 수 없는 대안으로, 계정마다 통합 폴더 규칙(위 `통합 폴더`)으로 폴더를 고르고 역할이 없는 계정은 `MAIL_CLIENT_MAILBOX_UNAVAILABLE`로 제외한다.
- Gmail은 `messages.list`의 제목·주소·상태 검색과 라벨을 쓰고, Naver·NAVER WORKS는 실제 서버 폴더를 read-only로 열어 `UID SEARCH`를 실행한다. KST 기간과 헤더 조건은 반환 메타데이터에서 확인한다. IMAP 첨부 조건은 `BODYSTRUCTURE`로 확인하고, UIDVALIDITY가 없는 결과를 열 수 있는 ID로 바꿀 때만 기존 `BODY.PEEK` 원문 증명을 적용한다. 검색 본문과 별도 검색 색인은 두지 않는다. [Gmail 검색](https://developers.google.com/workspace/gmail/api/guides/filtering) · [IMAP SEARCH](https://imapflow.com/docs/guides/searching/)
- 검색 커서는 계정·검색 조건·제공자별 위치에 묶이며 같은 커서의 응답을 재사용한다. Gmail 후보는 제공자 페이지 순서로, IMAP 후보는 폴더별 UID 범위로 가져오고 확보한 후보는 수신 시각으로 병합한다. IMAP에서 UID와 수신 시각 순서가 다른 경우 페이지 경계를 넘어 시각 순서가 바뀔 수 있다. `coverage=provider_mailboxes`이며 `total`은 해당 탐색에서 지금까지 확인한 수다. 필터를 적용한 뒤 후보가 남아 있으면 빈 페이지도 다음 커서를 가질 수 있다. 계정이나 폴더 조회가 실패하면 성공한 조회 결과와 `sources`·`incomplete`를 함께 돌려준다.
- Gmail 상세는 현재 원본에서 확인한 thread ID로 `threads.get`을 호출해 같은 계정의 전체 스레드를 조회한다. 스레드에는 헤더와 MIME 메타데이터만 요청하며, 각 메일에 기존 메시지 ID를 발급해 `thread.messages`의 `id`·`from`·`subject`·`receivedAt` 형식으로 표시한다. 각 원문은 열 때 기존 상세 검증 경로에서 가져온다. 스레드 조회에 실패해도 열린 메일 본문은 표시한다. [Gmail 스레드 조회](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.threads/get)
- `GET /api/mail-client/messages/:id/attachments/:index`는 원본과 계정을 재검증한 뒤 비인라인 첨부만 다운로드로 제공한다. HTML의 CID 이미지는 `GET /api/mail-client/messages/:id/inline-images/:index`로 해당 원본을 다시 검증한 뒤 요청한다. 지원하는 래스터 형식은 PNG·JPEG·GIF·WebP이며 MIME 형식과 파일 시그니처를 모두 확인한다.
- `GET /api/mail-client/accounts/:accountId/messages/:id/draft`는 목록 메시지에서 제공자 초안의 실제 ID와 버전을 확인한다. Gmail은 제공자 메시지 ID, IMAP은 폴더·UID와 원문을 대조한다.
- v49 `mail_client_contacts`와 `GET /api/mail-client/contacts`, `POST /api/mail-client/contacts/import`는 로컬 CSV를 저장한다. 가져오기 전에 열 매핑과 중복을 확인하고 기존 연락처는 보존한다. `PUT /api/mail-client/contacts/settings`로 켠 경우에만 이미 관측한 송수신자를 목록에 합친다. 수집 결과를 별도 연락처 행으로 저장하지 않는다.
- 연락처의 `주고받은 메일`과 `모두 보기`는 `/api/mail-client/search?contactEmail=…`를 사용한다. 제공자 전체 검색 후보 중 From 또는 To 주소가 대소문자를 무시하고 정확히 일치하는 것만 포함한다. 제목·표시 이름·Cc는 이 조건에 포함되지 않는다. 연락처 목록은 기존 정렬에서 `nextOffset`을 받아 스크롤로 이어 읽고, 검색어나 출처가 바뀌면 첫 페이지부터 조회한다. CSV·수집 연락처 모두에 적용한다.

### HTML과 이미지 표시

- 상세 응답은 기존 `body.text`와 선택적인 `body.html`을 제공한다. HTML이 있으면 화면에서 DOMPurify로 정제하고 스크립트를 허용하지 않는 sandbox iframe에 넣는다. 표·문단·글꼴·색상과 인라인 CSS·미디어 쿼리는 허용한 표시 속성 범위에서 유지한다. 일반 HTTP·HTTPS 링크는 새 탭에서 열고 리퍼러와 opener를 전달하지 않는다.
- 상세 화면은 기본으로 HTML의 HTTP·HTTPS `img src`를 리퍼러 없이 직접 읽는다(2026-11-22 저장소 주인 결정). 추적 픽셀이 열람 시각과 브라우저의 공인 IP를 발신자에게 알릴 수 있다는 점을 받아들인 선택이다. 외부 이미지를 차단하는 상세에서는 iframe 전용 CSP가 인라인 이미지용 blob만 허용하고 `이미지 표시`로 그 상세에서만 연다. 외부 CSS·폰트·스크립트·CSS 이미지 요청은 항상 차단한다. 본문과 이미지 바이트는 DB에 저장하지 않는다.

### 연결이 남은 제어와 데이터

- Naver·NAVER WORKS 스레드 확장과 목록 본문 미리보기는 후속 범위다.
- Gmail 연락처·Works 조직도 직접 동기화는 후속 범위다. Naver는 CSV 경로를 사용한다. 직접 동기화 제어는 비활성으로 표시한다.
- 규칙 추가의 입력 화면은 현재 피그마에 없어 기존 규칙의 조회와 해제를 연결한다.
- 초안 충돌에서 기존 버전에 묶인 첨부가 있으면 그 첨부를 제외한 채 복사하지 않는다.

## 연결 계정 관리

- 메일 설정의 `계정 추가`·`관리`와 목록의 `다시 로그인`에서 시작한다. Gmail·Naver·NAVER WORKS를 각각 한 계정까지 연결한다. 같은 제공자의 다른 주소는 거절한다. 동일한 주소를 재인증하면 기존 account ID·동기화 커서·메일 관측·분석·일정 후보·Attention을 보존한 채 동기화를 재개한다.
- Naver·NAVER WORKS는 입력한 메일 주소와 앱 비밀번호로 기존 제공자 호스트에 IMAP/TLS 로그인하고 INBOX를 읽기 전용으로 열어 확인한다. 확인 후에만 자격증명을 교체한다. 동일 앱 비밀번호를 해당 계정의 읽기·쓰기·SMTP에 사용한다.
- Gmail은 Google 웹 OAuth 클라이언트를 사용한다. `MAIL_GMAIL_REDIRECT_URI`에 앱과 같은 origin의 `/api/mail/oauth/callback` 전체 URL을 지정하고 Google 콘솔의 리디렉션 URI에도 같은 값을 등록한다. HTTPS를 사용하며 loopback 개발만 HTTP를 허용한다. OAuth 시작·완료는 기존 앱 인증을 요구한다. callback은 단일 사용 state·PKCE·HttpOnly SameSite=Lax 쿠키로 시작한 브라우저와 연결한다. Google 계정 프로필과 권한을 검증하고 원래 탭에서 연결 결과를 확인할 때만 자격증명을 적용한다. [Google 서버 OAuth](https://developers.google.com/identity/protocols/oauth2/web-server)
- Gmail 읽기·수정·발송은 별도 동의를 받는다. 첫 연결은 `gmail.readonly`, 관리의 수정 권한은 `gmail.modify`, 발송 권한은 제공자 초안 발송과 원본 확인에 필요한 `gmail.compose`와 `gmail.metadata`를 요청한다. Agent와 Workspace는 같은 읽기 토큰 발급기를 공유한다. 읽기 refresh가 실패해 재인증이 필요한 경우 계정 상태를 표시하고, 새 자격증명을 확인하면 이전 캐시를 폐기한다. 수정·발송 권한은 관리에서 다시 연결할 수 있다. 기존 쓰기·발송 활성화 플래그를 그대로 적용한다. [Gmail 권한](https://developers.google.com/workspace/gmail/api/auth/scopes) · [Gmail 초안 발송](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.drafts/send)
- 기존 `.env` 계정은 그대로 사용할 수 있다. UI에서 처음 관리한 제공자는 이후 파일에 검증된 자격증명만 사용한다. 기존 Gmail을 UI에서 읽기 재인증한 뒤 수정·발송이 필요하면 해당 권한을 각각 연결한다. UI 자격증명은 기본적으로 `~/.config/galpi/mail` 아래 DB별 파일에 저장한다. `MAIL_ACCOUNT_SECRET_FILE`로 정한 경우 repository·DB·Vault·일반 백업 밖에 파일을 둔다. 디렉터리는 소유자 전용 `0700`, 파일은 `0600`이다. 토큰·비밀번호를 DB나 브라우저에 저장하지 않는다.
- 연결 해제는 서버의 해당 자격증명과 토큰 캐시를 폐기하고 계정을 `disabled`로 저장한다. 해당 계정 신규 조회·동기화·분석 예약·변경·발송은 중단되며 기존 기록은 유지한다. DB의 관리 여부와 파일의 해제 상태가 기존 `.env`로 자동 복구되는 것을 막는다. Google 계정에서 앱 권한을 별도로 철회할 수 있다.
- `MAIL_CLIENT_ENABLED`와 기존 앱 인증을 적용하는 `/api/mail-client/account-management`는 GET으로 계정과 상태를 반환한다. POST `/imap`은 연결·재인증, `/disconnect`는 연결 해제, `/gmail/start`와 `/gmail/finish`는 OAuth 시작과 결과 확인을 처리한다. OAuth callback의 브라우저 검증 계약은 위와 같다.

## Backend Phase 1

Mail Workspace의 화면 정본은 [galpi-home-design의 Mail Workspace](https://www.figma.com/design/8EafrARqh4NwKmaRvwRkZM/galpi-home-design?node-id=449-931)다. 이 단계는 화면이 나중에 사용할 계정·메일함·목록·상세 계약을 적용한다. 내부 API는 별도 플래그 뒤에 둔다.

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

## 통합 폴더

통합 목록은 받은편지함·보낸편지함·임시보관함·스팸함·휴지통(`inbox`·`sent`·`drafts`·`junk`·`trash`)을 지원한다. 보관함은 계정마다 폴더 의미가 달라 지원하지 않는다. 계정별 폴더는 IMAP LIST Special-Use(`\Inbox`·`\Sent`·`\Drafts`·`\Junk`·`\Trash`)에서 선택 가능한 폴더가 정확히 하나일 때만 고르고, Gmail은 시스템 라벨(`INBOX`·`SENT`·`DRAFT`·`SPAM`·`TRASH`)을 쓴다. 해당 역할의 폴더가 없는 계정은 `unavailable`과 `MAIL_CLIENT_MAILBOX_UNAVAILABLE`로 제외하며 페이지 실패나 `incomplete`로 보지 않는다. 행의 `locator.inbox`는 받은편지함 역할일 때만 참이다.

통합 목록은 UTC 7일 수신 시각 창 안에서 계정별 후보 스트림을 만들고 수신 시각이 가장 새로운 머리부터 합친다(수신 시각 내림차순, 동률은 계정 ID와 제공자 위치). 메타데이터는 페이지에 실린 행에만 읽는다. IMAP은 SEARCH와 `{uid, internalDate}` FETCH로 후보의 정확한 시각만 알고, 한 요청 동안 연결 하나(EXAMINE 유지)에서 실린 UID만 한 번에 가져온 뒤 로그아웃한다. UIDVALIDITY가 0이거나 없으면 같은 세션에서 원문(PEEK)으로 증명 해시까지 만든다. Naver·NAVER WORKS의 INBOX는 UIDVALIDITY `0`을 보고한다(2026-11-22 STATUS·EXAMINE으로 확인, Sent는 `1`). 이전의 증명용 두 번째 연결과 행별 순차 조회는 없다. Gmail은 창의 ID를 목록으로 받고(새 메일 먼저) 8건씩 머리가 필요할 때만 메타데이터를 읽는다. 청크 사이 순서는 Gmail 목록 순서(최신순)를 전제하고 청크 안에서는 수신 시각으로 정렬한다.

기본 7일 창에 후보가 200건을 넘으면 채우기 전에 창을 양분한다. 같은 1초에 모인 메일은 동률 정렬을 위해 그 범위 전체를 조회한다. 페이지에 싣지 않은 후보와 이미 읽은 행은 커서 상태에 남겨 다음 페이지가 그대로 이어진다(다음 페이지는 새 세션을 열 수 있다).

커서는 서버에서 발급하는 불투명 토큰으로 10분 동안 유지한다. 같은 커서 재시도에는 같은 페이지를 반환하며, 재시작·만료 후 첫 페이지에서 다시 시작한다. 요청한 개수에 도달하거나 과거 메일이 끝날 때까지 날짜 창을 이어 읽는다. 한 요청에서 새 창은 최대 3개 읽으며, 더 탐색해야 하면 후속 커서를 반환한다. 계정별 `fresh`·`stale`·`unavailable`과 `incomplete`를 명시한다. 창을 읽지 못한 계정은 그 창에 대해 마지막 성공 때 실었던 행(`unified:<역할>:<창>` 관측)이 있으면 `stale`로 대신하고, 없으면 후속 탐색에서 제외하되 이미 조회한 메시지는 보존한다. 새 첫 페이지에서 해당 계정을 다시 시도한다. 새 메일 유입이나 제공자 삭제에 따라 아직 읽지 않은 날짜 창의 관측은 달라질 수 있다.

첫 페이지(커서 없음)를 읽는 동안 확정된 쓰기로 세대가 바뀌면 새 세대로 한 번 다시 읽는다. 커서 페이지는 기존처럼 `409 MAIL_CLIENT_CURSOR_INVALID`를 반환한다. Gmail의 403·429 중 요청 제한 사유(`rateLimitExceeded`·`userRateLimitExceeded`·`quotaExceeded`·`dailyLimitExceeded`·`backendError`, 상태 `RESOURCE_EXHAUSTED`, HTTP 429)는 `MAIL_CLIENT_PROVIDER_RATE_LIMITED`(503)이며 로그인 만료로 보지 않는다. 그 밖의 403은 `MAIL_CLIENT_AUTH_REQUIRED`다. 로그에는 사유 코드만 남긴다.

## 상세와 첨부

Gmail 상세는 Workspace 전용 `format=raw`, IMAP 상세는 검증을 함께 수행하는 원문 PEEK를 사용한다. 텍스트 본문은 16,000자 분석 정규화를 거치지 않고 전체를 반환한다. HTML 전용 메일도 인용에 사용할 평문을 변환해 제공하며, 화면 표시용 HTML은 위 HTML 표시 계약을 따른다. MIME에서 파싱한 첨부 이름·타입·크기·인라인 여부와 `Message-ID`, `In-Reply-To`, `References` 및 제공자 thread ID를 제공한다. 32 MiB를 초과하는 원문은 상세에서 `413`으로 표시한다. 이 제한은 잘린 응답을 전체 본문으로 표시하지 않도록 둔다. 원문과 첨부 바이트는 영구 저장 대상에서 제외한다.

## API

`MAIL_CLIENT_ENABLED=false`가 기본값이다. 기존 `/api/` 인증과 요청 제한을 적용하고 응답에 `Cache-Control: no-store`를 붙인다. 성공 응답은 `success: true`, 실패는 HTTP 상태와 `code`를 반환한다. 목록의 `limit` 기본값은 20, 상한은 25다.

| GET 경로 | 반환 |
| --- | --- |
| `/api/mail-client/accounts` | 연결 계정 ID, 제공자, 주소, 상태 |
| `/api/mail-client/accounts/:accountId/mailboxes` | 실제 메일함·라벨과 관측 상태 |
| `/api/mail-client/accounts/:accountId/messages?mailbox=…&cursor=…` | 선택 목록, 원본 관측 상태, 후속 커서 |
| `/api/mail-client/inbox?cursor=…` | 통합 받은편지함(`/unified/inbox`와 같다), 계정별 관측 상태, 불완전 여부와 후속 커서 |
| `/api/mail-client/unified/:role?cursor=…` | `inbox`·`sent`·`drafts`·`junk`·`trash` 통합 목록. 그 밖의 역할은 `400 MAIL_CLIENT_INVALID_REQUEST` |
| `/api/mail-client/messages/:messageId` | 메일 상세, 평문과 선택적 HTML, 송수신 정보, 스레드 관계와 첨부 메타데이터 |
| `/api/mail-client/messages/:messageId/attachments` | 첨부 메타데이터 |
| `/api/mail-client/messages/:messageId/inline-images/:index` | 원본 메시지에서 검증한 래스터 인라인 이미지 바이트 |
| `/api/mail-client/agent-messages/:messageId` | 기존 Agent 메시지를 검증한 Workspace 상세 ID |
| `/api/mail-client/attention/:attentionId` | 현재 Attention 메시지를 검증한 Workspace 상세 ID |

Phase 1의 GET 계약은 제공자 조회 전용이다. 상태 변경은 아래 Phase 2의 명시적 POST에서 수행한다.

## Backend Phase 2

기존 인증을 적용한다. `MAIL_CLIENT_ENABLED=true`와 `MAIL_CLIENT_WRITE_ENABLED=true`가 모두 필요하며, 쓰기 플래그 기본값은 `false`다. Gmail은 연결 계정의 수정 권한(`.env` 계정은 `MAIL_GMAIL_MODIFY_REFRESH_TOKEN`)으로 프로필 주소와 원본 메시지 ID를 확인한다. 기존 Agent·Workspace 읽기 토큰과 답장 토큰은 각자의 기존 경로를 사용한다. IMAP은 요청 대상 계정의 기존 자격증명으로 쓰기 전용 연결을 연다.

| 액션 | Gmail | IMAP |
| --- | --- | --- |
| `set_read` | `value=true`면 `UNREAD` 제거, `false`면 추가 | `\Seen`의 명시적 추가·제거 |
| `set_starred` | `STARRED`의 명시적 추가·제거 | `\Flagged`의 명시적 추가·제거 |
| `archive` | `INBOX` 제거 | 서버가 `\Archive`로 표시한 선택 가능한 실제 폴더로 이동 |
| `move` | 명시한 출발 라벨과 실제 사용자 대상 라벨만 변경 | 동일 계정에서 LIST로 확인한 선택 가능한 대상 폴더로 이동 |
| `trash` | `messages.trash` | 서버가 `\Trash`로 표시한 선택 가능한 실제 폴더로 이동 |

Gmail 이동의 `sourceMailbox`는 현재 메시지에 있는 `label:INBOX` 또는 사용자 라벨, 또는 `all`을 명시한다. `all`에서는 선택한 사용자 라벨을 추가한다. 대상은 사용자 라벨로 한정한다. `IMPORTANT`는 Gmail 제공자 상태로 유지하고 Agent의 AI 분류는 기존 분석 경로에서 관리한다. [Gmail modify](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/modify) · [Gmail trash](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/trash)

IMAP은 같은 쓰기 잠금으로 메일함·UID·UIDVALIDITY와 Phase 1의 검증값을 확인한 뒤 `UID STORE` 또는 네이티브 `UID MOVE`를 보낸다. 유효한 UIDVALIDITY가 없는 경우 확보해 둔 원문 해시까지 대조한다. 원문 검증에는 Phase 1의 32 MiB 한도를 적용한다. 보관·휴지통은 실제 LIST 플래그에서 역할이 하나로 확인될 때만 허용한다. 폴더명 기반 추론은 읽기용 안내에만 사용한다. `MOVE`가 없으면 실패를 반환하고, 이 API의 제공자 명령은 `UID STORE`의 두 플래그와 `UID MOVE`로 제한된다.

### 요청과 결과

- `POST /api/mail-client/messages/:messageId/actions`의 본문은 `requestId`, `action`과 해당 액션의 인자를 받는다. `messageId`는 Phase 1의 상세 ID다.
- `POST /api/mail-client/messages/actions`의 본문은 `requestId`와 `operations`다. `operations`는 각 원소에 `messageId`와 액션 인자를 갖는 배열이며, 한 요청에 서로 다른 메시지 최대 25개를 받는다.
- `set_read`와 `set_starred`에는 boolean `value`가 필요하다. `set_read`의 `origin` 기본값은 `user`이며 `auto`는 `value=true`일 때만 허용한다. `move`에는 `targetMailbox: { accountId, id }`가 필요하다. `id`는 해당 계정 Mail Workspace 목록에서 반환한 메일함 ID다. Gmail 이동에는 `sourceMailbox`도 전달한다.
- 단일 결과는 `{ success, requestId, result }`, 일괄 결과는 `{ success, requestId, results }`를 반환한다. 각 결과는 `messageId`, `accountId`, `state`, `code`, `statusCode`를 담는다. 확인은 `confirmed`, 명시적으로 수행되지 않은 경우는 `failed`, 결과를 확인할 수 없는 경우는 `unknown`이다. 단일 요청의 `unknown`은 HTTP 202다. 유효한 일괄 요청은 HTTP 200으로 각 메시지의 상태를 반환하며 전부 `confirmed`일 때만 `success=true`다.
- v46의 `mail_client_action_receipts`에는 요청 ID, Workspace 메시지 ID, 정규화한 요청의 SHA-256, 결과 상태·코드·시각만 보존한다. 같은 ID와 같은 요청은 기록을 반환하며, 다른 요청은 409다. 제공자 호출 전에 기록을 확보하고, 처리 중이거나 응답이 끊긴 요청은 `unknown`으로 반환한다. 재시작 후에도 같은 요청으로 다시 실행하지 않는다.

### 자동 읽음과 목록 갱신

상세 GET과 Overview 미리보기는 계속 조회 전용이다. 향후 UI가 본문 표시를 마친 뒤 `origin=auto`로 읽음을 요청할 수 있다. 사용자가 명시적으로 설정한 안 읽음은 `mail_client_read_overrides`에 남고 재시작 후에도 적용된다. 예외에 따라 자동 읽음을 건너뛰면 `confirmed`와 `MAIL_CLIENT_MANUAL_UNREAD_PRESERVED`를 반환한다. 직접 읽음으로 확인되면 해당 메시지의 보호를 해제한다. IMAP MOVE에서 COPYUID가 있으면 도착 UID에 보호를 이어간다. MOVE 결과나 매핑이 불명확하면 도착 폴더에서 원문 해시가 일치하는 메시지의 자동 읽음을 보수적으로 막는다. 이 보호는 대상을 쓰기로 선택하는 근거로 사용하지 않는다.

확인된 변경은 해당 계정의 목록 관측 캐시를 무효화한다. 이미 발급한 Workspace 페이지 커서는 새 첫 페이지부터 시작하도록 만료시키고, 동시에 진행 중이던 이전 조회가 오래된 관측을 복구하지 못하게 한다. Agent의 동기화·분석·Attention·Push 및 기존 답장 발송은 기존 API 계약을 유지한다.

## Backend Phase 3

Workspace 작성은 인증된 내부 API에서만 사용한다. `MAIL_CLIENT_ENABLED=true`가 필요하며 초안 저장과 임시 업로드는 `MAIL_CLIENT_WRITE_ENABLED=true`를 요구한다. 발송은 거기에 `MAIL_CLIENT_SEND_ENABLED=true`와 명시적 POST 요청이 필요하다. 발송 플래그 기본값은 `false`다. 모든 응답은 `Cache-Control: no-store`다. 화면, 시온의 지시형 답장, Mail Agent 분석 큐와 알림은 각자의 기존 경로를 사용한다.

### 작성과 첨부

- 발신 주소는 연결 계정에서 정한다. Gmail은 UI 관리 계정의 발송 권한을 사용하고, 기존 `.env` 계정의 Workspace에서는 Phase 2의 `MAIL_GMAIL_MODIFY_REFRESH_TOKEN`을 사용한다. 두 경로 모두 실제 Gmail 프로필을 확인한다. Naver와 NAVER WORKS는 등록 계정과 기존 앱 비밀번호의 인증 주소를 대조하고 TLS SMTP 465로 보낸다. [Gmail scopes](https://developers.google.com/workspace/gmail/api/auth/scopes) · [Naver SMTP](https://help.naver.com/service/30029/contents/21341) · [NAVER WORKS IMAP/SMTP](https://help.worksmobile.com/en/use-guides/mail/settings/pop3-imap-smtp/)
- `compose`는 `kind`(`new`, `reply`, `reply_all`, `forward`), 문자열 `text`, 선택적 `html`·`subject`·`to`·`cc`·`bcc`·`attachments`를 받는다. 수신자는 이메일 주소 배열이다. 답장·전체 답장·전달에는 같은 계정의 Phase 1 상세 ID인 `originalId`가 필요하다. 답장은 검증한 원본의 Reply-To 또는 From으로, 전체 답장은 여기에 원본 To·CC를 합쳐 계산한다. 답장 요청의 To·CC는 생략하고 발신 계정 자신과 중복 주소는 서버에서 제거한다. 명시한 BCC만 발송에 사용한다. SMTP에서는 BCC를 수신 봉투에만 넣는다. Gmail은 BCC가 포함된 MIME을 받아 수신자에게 사본을 배분한다.
- 답장은 원본 Message-ID를 `In-Reply-To`와 `References`에 연결하고 `Re:`를 붙인다. 전달은 `Fwd:`와 원본 발신·날짜·제목·수신 정보 및 평문을 인용한다. 원본의 첨부는 각각 검증된 참조가 필요하다. 보관된 초안을 다시 열어 본문 전체를 편집할 때는 `kind: "new"`와 관측한 초안 버전을 써서 기존 답장 스레드와 인용된 본문을 보존할 수 있다.
- 임시 업로드는 계정별 일회용 핸들이다. 15분 동안 프로세스 메모리에 두고 사용·만료·재시작 시 정리한다. `{ kind: "upload", id }`로 전송한다. 조회한 원본·초안 첨부는 각각 `{ kind: "original" | "draft", index, proof }`로 참조한다. 원문 해시와 첨부 순서·바이트의 증명을 대조하므로 원본이나 파일이 달라지면 저장·발송을 중단한다. 첨부 원본은 제공자에서 필요할 때 읽는다.
- 첨부는 최대 30개, 합계 18 MiB, 인코딩한 최종 MIME은 최대 25 MiB다. 더 낮은 제공자 제한이 확인되면 413을 반환한다. 작성 데이터와 첨부 바이트는 서버에 영구 보관하지 않는다. 초안의 `htmlSource`는 편집용 원문이다. 소비자는 HTML을 화면에 삽입하거나 첨부 내용을 실행하지 않고, 미리보기가 필요하면 별도의 안전한 표시 경계를 적용해야 한다.

### 제공자 초안과 결과

- Gmail은 `drafts.list/get/create/update/send`를 사용한다. `id`는 초안의 안정적인 ID, `messageId`는 현재 내부 메시지 ID다. 초안 버전은 내부 ID와 원문 및 스레드 관측값을 묶는다. 같은 계정과 초안의 Galpi 갱신·발송을 직렬화하고, 쓰기 직전 버전을 다시 대조한다. Gmail에는 원자적 버전 비교와 쓰기가 없어 마지막 확인과 요청 사이의 외부 변경을 완전히 차단할 수 없다. `drafts.send`에는 확인한 내용으로 생성한 MIME을 전달한다. Gmail이 발송과 동시에 초안을 제거하고 SENT를 생성한다. [Gmail draft guide](https://developers.google.com/workspace/gmail/api/guides/drafts)
- Naver와 NAVER WORKS는 LIST 플래그에서 유일하게 확인된 실제 `\Drafts`에 MIME을 `\Draft`로 APPEND한다. 초안 ID는 계정·폴더·UID·UIDVALIDITY·원문 해시·Galpi 식별자를 묶은 불투명 값이다. APPENDUID의 유효성을 확인한 뒤에도 원문과 식별자를 대조한다. UIDVALIDITY=0이거나 UID 응답이 빠지면 최근 범위에서 원문이 고유하게 일치할 때만 확인으로 기록한다.
- IMAP 수정은 기존 버전과 네이티브 MOVE 및 실제 `\Trash`를 먼저 검증한다. 새 버전이 확인돼야 기존 버전을 다시 확인하고 UID MOVE로 옮긴다. 새 초안 확인 후 정리 결과가 불명확하면 `unknown`과 새 `draftId`, 별도 `cleanup` 상태를 반환한다. 두 초안이 남아 있을 수 있다. `MOVE`를 제공하지 않으면 수정은 APPEND 전 중단한다.
- SMTP는 전원 수락과 부분 수락을 `delivery`와 수락·거절 개수로 구분한다. 부분 수락은 `state=sent`, `success=false`다. 전원 수락한 IMAP 초안은 발송을 기록한 뒤 다시 검증해 휴지통으로 이동한다. 정리에 실패해도 영수증은 `sent`다. 부분 수락과 결과 불명인 초안은 남겨 둔다. SMTP 영수증의 `sentCopyStatus=verification_required`는 제공자 설정에 따른 보낸메일함 저장 확인이 필요하다는 뜻이다. Workspace에서 SENT APPEND나 영구 삭제를 수행하지 않는다.

### API와 재시도

| 메서드와 경로 (`/api/mail-client/accounts/:accountId`가 앞에 붙음) | 요청과 결과 |
| --- | --- |
| `GET /drafts?limit=…&cursor=…` | 제공자 초안 목록과 다음 커서 |
| `GET /drafts/:draftId` | 원문 편집값·버전·첨부 참조 |
| `POST /drafts` | `requestId`, `compose`로 초안 저장 |
| `PUT /drafts/:draftId` | `requestId`, 관측 `version`, `compose`로 갱신, 버전 충돌은 409 |
| `POST /uploads?filename=…&contentType=…` | `application/octet-stream` 바이트를 보내 임시 핸들 발급 |
| `GET /messages/:messageId/attachment-references` | 발송 시 검증에 쓸 원본 첨부 참조 |
| `POST /send` | `requestId`, `compose`로 즉시 발송 |
| `POST /drafts/:draftId/send` | `requestId`, 관측 `version`의 제공자 초안을 발송 |
| `GET /send/:requestId` | 저장된 발송 영수증 |

v47 영수증은 요청 ID·계정·요청 해시·초안 버전/원본 참조·상태·오류 코드·제공자 메시지 ID·시각과 정리/수락 결과만 남긴다. 제공자 쓰기 전 `pending`을 확보한다. 같은 요청은 기존 결과를 반환하고 다른 내용에 같은 ID를 쓰면 409를 반환한다. 같은 초안 버전에 대해 이미 `pending`·`sent`·`unknown` 영수증이 있으면 새 ID로도 발송을 막는다. 재시작 후 남은 `pending`과 응답 유실에 따른 `unknown`은 자동 실행하지 않는다. 초안 저장 결과는 `saved`·`conflict`·`failed`·`unknown`과 처리 중 `pending`을 구분한다. 확인된 저장·발송과 외부 변경 가능성이 있는 결과는 계정 목록 캐시와 Phase 2 페이지 커서를 무효화한다.

실계정 확인은 Gmail OAuth 프로필·초안 교체·스레드·SENT, Naver와 NAVER WORKS의 실제 Drafts/Trash 플래그·UIDVALIDITY·MOVE·APPEND 원문 보존·SMTP BCC·SENT 저장을 각각 포함한다. Phase 3 자동 검증은 모의 제공자만 사용한다.

## Backend Phase 4

`MAIL_CLIENT_SMART_ENABLED=false`가 기본값이며 `MAIL_CLIENT_ENABLED=true`가 필요하다. 스마트 분석은 Agent 활성화, 메일 쓰기, 발송 플래그와 독립이다. 기존 Gmail 읽기 권한과 IMAP의 read-only 원문 조회를 사용한다. 스마트 API에는 기존 인증과 `Cache-Control: no-store`를 적용한다. 스마트 메일함은 Figma의 중요·조치 필요·일정·마감·무시·미분류 구분을 따른다. [Mail Workspace 화면 정본](https://www.figma.com/design/8EafrARqh4NwKmaRvwRkZM/galpi-home-design?node-id=449-931)

### 분석 범위와 큐

- 사용자가 이미 탐색한 Workspace 상세 ID만 명시적 POST로 예약한다. 한 요청은 서로 다른 ID 최대 10개를 받는다. POST는 제공자 확인과 예약까지만 처리하고 모델 응답은 별도 작업으로 받는다. 읽기 API에서 분석을 예약하거나 모델을 호출하는 횟수는 0회다.
- Gmail은 현재 메시지 ID·수신 시각·봉투 정보를 확인한다. `SENT`, `DRAFT`, `SPAM`, `TRASH`가 붙은 메일은 제외한다. IMAP은 현재 LIST의 서버 역할과 read-only UID·UIDVALIDITY 및 원문 증명을 확인한다. INBOX나 서버의 Archive 역할을 사용할 수 있다. 일반 폴더는 서버가 Sent·Drafts·Trash·Junk를 각각 한 곳으로 식별할 수 있을 때 허용한다. ImapFlow가 이름으로 유추한 역할, 집계 폴더, Draft·Deleted 플래그는 분석 허용 근거로 쓰지 않는다.
- 비활성 계정과 변경된 위치·원문을 거부한다. 조회한 원문 바이트의 SHA-256을 확보하고 모델 호출 직전과 결과 저장 전에 동일성을 확인한다. 같은 Workspace 위치에서 이전 원문과 달라지면 해당 상세 ID는 분석에 사용할 수 없다. IMAP 이동 뒤 새 상세 ID는 자신의 독립된 결과를 갖는다. RFC Message-ID만으로 결과를 옮기거나 병합하지 않는다.
- v48의 `mail_workspace_sources`는 마지막으로 확인한 원문 해시와 관측 시각·오류를 갖는다. `mail_workspace_analysis_jobs`는 메시지·원문 해시·분류 또는 일정 작업의 조합을 유일하게 보존한다. 작업 상태는 pending·analyzing·done·failed·skipped다. 4분 lease를 회수하고 실패는 최대 세 번 시도한다. 일시 오류의 재시도 대기는 30초, 60초다. lease가 만료된 작업자의 결과는 폐기한다. 일정 후보 저장과 작업 완료는 한 트랜잭션으로 처리한다.
- 같은 계정과 제공자 위치가 검증된 Agent의 완료 판단을 먼저 표시한다. Workspace 결과는 대체 판단으로만 쓴다. `skip_analysis`는 모델 호출 전에 적용하고 이유를 결과에 남긴다. Agent baseline·분석 큐·판단 프롬프트 버전과 Attention·Push는 기존 경로에 남는다. 사용자가 선택한 baseline 메일의 Workspace 분석은 Agent baseline이나 큐를 변경하지 않는다.
- 사이드바의 `분석`은 관측 메타데이터로 전체 미분류 대상 수를 조회한다. 제외 규칙, 비활성 계정, 분석 불가 메일함, 이미 진행 중이거나 최종 실패한 분류를 제외한다. 확인창을 열 때 ID를 확정하고, 사용자가 승인하면 최대 10통씩 `kind=both`로 기존 큐에 예약한다. 예약과 실행 시에는 기존 원본·제외 규칙 검증을 수행한다. 최종 실패는 기존 큐 계약대로 자동 재예약하지 않는다.
- 진행 확인은 이미 예약한 ID에 한해 `/smart/results?statusOnly=1`의 저장된 작업 상태를 사용한다. 분류와 일정이 모두 끝난 메일을 성공으로, 최종 실패와 미처리를 별도 집계한다. 결과가 바뀌면 현재 스마트 목록 또는 달력을 기존 조회 경로로 갱신한다. 기본 전체 결과 조회는 계속 원본을 재검증한다.

### 스마트 목록과 일정 후보

- 중요는 AI `urgent`·`important`, 조치 필요는 `action_required` 또는 행동 문구가 확인된 `urgent`다. 일정은 후보가 있는 메일이며 마감은 유효한 기존 Agent 기한이나 날짜가 해석된 마감 후보다. Workspace 분류 응답의 기한 값은 근거 인용이 있는 일정 작업으로 확인한 뒤 표시한다. 무시는 `ignore`, 미분류는 판단이 아직 없는 메일이다. `info`는 분류 완료로 본다. 이 필터는 겹칠 수 있다. Gmail IMPORTANT·수동 별표는 제공자 상태 그대로다.
- 신규 Workspace 분류는 기존 `result_json`에 답장 `reply`, 확인 `confirm`, 제출 `submit`, 미확정 `null` 중 하나를 `actionType`으로 남긴다. 조치 필요의 세 칩은 `variant`로 이 필드를 조회한다. Agent 판단 또는 유형이 없는 기존 결과는 조치 필요의 전체 목록에 남으며, 유형 추가 때문에 기존 분석을 다시 실행하지 않는다.
- 목록과 달력은 탐색·분석된 관측 범위를 조회하며 `coverage.complete=false`를 반환한다. 저장된 관측에는 `sourceVerification.state=observed`와 검증 시각을 표시한다. 기본 개별 분석 결과와 일정 상세는 제공자에서 원문을 다시 검증하고 현재 검증 실패를 반환한다. 목록은 수신 시각, 계정과 제공자 위치로 정렬한다. 기간은 시작 포함, 끝 제외다. 미확정 후보는 달력 날짜가 없으며 기존 기간별 보조 응답에도 남는다.
- 기간 없이 `section=unresolved`를 요청하면 저장된 모든 월의 미확정 후보를 수신 시각 내림차순과 이벤트 ID 내림차순으로 조회한다. 전용 커서와 전체 건수를 반환한다. 일정 우측 미확정 패널은 월간 달력과 독립적으로 조회하고 내부 스크롤로 이어 읽는다. 원본 열기는 기존 일정 상세 검증을 거친다.
- 한 원문에서 최대 10개를 추출한다. 개인·공식·마감·미정 중 한 종류를 갖는다. 정확히 인용된 제목·날짜 표현과 실제 입력에 존재하는 짧은 근거가 필요하다. 외부 메일 지시는 데이터로 전달하고 모델에는 실행 도구를 주지 않는다. 원문 전체나 첨부 바이트는 보존하지 않는다. `mail_workspace_calendar_events`에는 근거 발췌·해시·날짜 출처·수신 기준일·추론 이유와 가능한 종료 시각을 보관한다. 작업에는 모델·프롬프트 버전·시각과 분류용 제한된 구조화 값만 남긴다. 입력 절단, 후보 초과, 근거 불일치, 첨부 의존성은 불완전 사유로 표시한다.
- 날짜와 시각은 메일 수신 시각의 KST 달력으로 계산한다. 명시 연도를 보존한다. 월·일만 있으면 수신 연도 전후의 유효한 날짜에서 검증된 미래·과거 방향의 가장 가까운 날짜 또는 절대 차이가 가장 작은 날짜를 선택한다. 동률, 방향 충돌, 모호한 상대 표현이나 지원되지 않는 시간대는 미확정이다. 시간이 있는 경우에만 datetime을 쓰며 KST와 명시적인 UTC·숫자 오프셋을 지원한다. 날짜만 알려진 후보는 date다.
- 일정 상세는 현재 원문을 검증한 뒤 기존 due 검증기를 통과하는 제목과 날짜를 `taskProposal.value`에 돌려준다. 미확정이거나 후보 날짜가 현재 기준 과거인 경우 `taskProposal.code`를 제공한다. 나중에 UI가 사용자 수정·확정 뒤 기존 일정 API와 `clientRequestId`로 저장한다. 이 단계에는 task·reminder 생성 경로가 없다.

### 내부 API

| 메서드와 경로 | 계약 |
| --- | --- |
| `POST /api/mail-client/smart/analyze` | `{messageIds, kind}`에서 kind는 classification·calendar·both. HTTP 202와 메시지별 기존 또는 새 작업 상태, 검증 오류 반환 |
| `GET /api/mail-client/smart/analysis-targets` | 미분류 예약 후보의 `total`. `snapshot=1`이면 현재 `messageIds`도 반환 |
| `GET /api/mail-client/smart/results?messageIds=1,2` | 현재 원문 검증, Agent·Workspace 출처와 모델·프롬프트·분석 시각, 작업 상태·실패 원인. `statusOnly=1`은 저장된 상태만 반환 |
| `GET /api/mail-client/smart/messages?filter=unclassified` | 여섯 필터 중 하나. 선택적 accountId, limit, cursor. 조치 필요의 세부 variant는 `reply`·`confirm`·`submit` |
| `GET /api/mail-client/smart/calendar?month=2026-12` | month 또는 from·until. 선택적 accountId, limit, cursor. 첫 요청은 날짜가 있는 후보와 별도 unresolved 목록 반환. section=unresolved로 해당 목록의 커서를 이어 읽음 |
| `GET /api/mail-client/smart/calendar?section=unresolved` | 기간을 생략하면 저장된 모든 월의 미확정 후보와 `total`. 선택적 accountId, limit, 전용 cursor |
| `GET /api/mail-client/smart/calendar/:eventId` | 근거·원문 연결·현재 검증 상태와 미저장 task 제안값 |

작업 결과의 실패 이유, 건너뜀, 원문 변경, 계정 비활성, 워크스페이스 기능 비활성을 응답 코드 또는 메시지별 상태로 구분한다. UI 연결, 실계정·실모델 인수 및 운영 활성화는 후속 범위다.
