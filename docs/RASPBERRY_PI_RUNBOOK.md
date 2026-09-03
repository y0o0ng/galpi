# Raspberry Pi Runbook

갈피를 라즈베리파이에 올릴 때 쓰는 최소 실행 절차.

## 1. 준비

- 라즈베리파이 OS 설치
- 같은 네트워크에서 접속할 맥/폰 준비
- Node.js 설치
- Codex CLI 설치 및 로그인
- Anthropic/OpenAI API 키 준비

Node 확인:

```sh
node --version
npm --version
```

Codex 설치 위치 확인:

```sh
command -v node
command -v codex
codex --version
codex exec --help
```

위의 bare `codex`는 설치 위치를 찾는 용도로만 쓴다. systemd는 로그인 셸과 `PATH`가 다르므로 `.env`의 `CODEX_BIN`에는 실행을 확인한 **절대 경로**를 넣는다.

현재 Pi에서 검증한 패턴은 프로젝트 안의 고정 wrapper `/home/pi/galpi/bin/codex`가 실제 Node와 Codex JS 진입점을 절대 경로로 실행하는 방식이다. Node나 Codex를 업그레이드하면 `command -v node`와 `npm root -g` 결과로 두 경로를 다시 확인한다.

```sh
mkdir -p /home/pi/galpi/bin
nano /home/pi/galpi/bin/codex
```

현재 검증된 wrapper 예시:

```sh
#!/bin/sh
exec /home/pi/.nvm/versions/node/v24.16.0/bin/node /home/pi/.nvm/versions/node/v24.16.0/lib/node_modules/@openai/codex/bin/codex.js "$@"
```

```sh
chmod 755 /home/pi/galpi/bin/codex
/home/pi/galpi/bin/codex --version
/home/pi/galpi/bin/codex exec --help
```

wrapper는 인자를 바꾸지 않고 `"$@"`로 전달해야 한다. 서버가 이 경로에 `exec`, 모델, vault 작업 경로, sandbox 옵션을 인자로 붙이고 정리 프롬프트는 표준 입력으로 전달한다.

## 2. 프로젝트 배치

예시 경로:

```sh
cd ~
git clone <repo-url> galpi
cd galpi
npm install
```

이미 폴더를 직접 복사했다면 `git clone` 대신 해당 폴더로 이동한다.

## 3. 환경 변수

```sh
cp .env.example .env
nano .env
chmod 600 .env   # 키가 들어있으니 본인만 읽게 권한 제한
```

라즈베리파이에서는 아래 값을 특히 확인한다.

```env
ANTHROPIC_API_KEY=...
OPENAI_API_KEY=...
S2_API_KEY=...
PAPER_SEARCH_MOCK=false
VAULT_PATH=/home/pi/galpi/galpi-vault
BACKUP_DIR=/home/pi/backups/galpi
HOST=0.0.0.0
PORT=3000
API_TOKEN=아무도-모를-긴-문자열
CODEX_RUNNER_MODE=codex
CODEX_BIN=/home/pi/galpi/bin/codex
```

`PAPER_SEARCH_MOCK=true`는 논문 정규화·카드 문제 해결용 고정 응답이다. 실제 Semantic Scholar 검색에서는 `false`로 유지한다.

로컬에서만 쓸 때는 `HOST=127.0.0.1`이어도 된다. 폰/맥에서 접속하려면 `HOST=0.0.0.0`이 필요하다.

`HOST=0.0.0.0`으로 LAN에 열 때는 `API_TOKEN`을 **반드시** 설정한다. 비워두면 같은 네트워크의 누구나 API를 호출해 키 크레딧을 쓰고 볼트를 읽을 수 있다(서버 시작 시 경고가 뜬다). 설정하면 첫 접속 시 브라우저가 토큰을 한 번 묻고 저장한다.

### C1 일정·private Web Push를 처음 켤 때

C1 일괄 배포 전에는 아래 flag를 `false`로 유지한다. schema v5→v6→v7은 코드가 순차 적용하지만, 운영 DB에는 배포 전 동시 DB·vault 백업을 먼저 만든다.

VAPID 키 쌍은 Pi 프로젝트에서 한 번 생성한다. 출력된 private key는 `.env`에만 넣고 DB·vault·문서·채팅에 복사하지 않는다.

```sh
cd /home/pi/galpi
./node_modules/.bin/web-push generate-vapid-keys
```

Pi `.env`에 다음 값을 채운다. HTTPS 노드 이름에는 개인 정보를 넣지 않는다.

```env
ASSISTANT_TASKS_ENABLED=true
WEB_PUSH_ENABLED=true
WEB_PUSH_CANONICAL_ORIGIN=https://<pi-node>.<tailnet-name>.ts.net
WEB_PUSH_VAPID_SUBJECT=mailto:<운영자-이메일>
WEB_PUSH_VAPID_PUBLIC_KEY=<생성한-public-key>
WEB_PUSH_VAPID_PRIVATE_KEY=<생성한-private-key>
```

갈피의 3000번 포트를 공개 Funnel 없이 tailnet 안의 HTTPS로만 노출한다. 설치된 Tailscale 버전의 명령 형식은 [공식 Serve CLI 문서](https://tailscale.com/docs/reference/tailscale-cli/serve)를 기준으로 다시 확인한다.

```sh
tailscale version
tailscale status
sudo tailscale serve --bg 3000
tailscale serve status
```

서비스를 재시작한 뒤 canonical HTTPS에서 인증 config를 확인한다. API token은 shell history에 남기지 않도록 실제 인수 때 안전한 방식으로 전달한다.

```sh
sudo systemctl restart galpi
curl -H 'X-API-Token: <API_TOKEN>' https://<pi-node>.<tailnet-name>.ts.net/api/push/config
```

기대값은 `enabled: true`, `.env`와 같은 `canonicalOrigin`, VAPID **public** key다. private key와 subject는 응답·로그에 없어야 한다. 기존 `http://<Pi_IP>:3000`과 새 HTTPS는 브라우저 저장소 origin이 달라 첫 접속 때 API token을 다시 입력한다.

iPhone·iPad는 iOS/iPadOS 16.4 이상에서 canonical HTTPS를 Safari로 열어 홈 화면에 추가한 다음, 그 홈 화면 앱 안의 일정 에이전트 블록에서 `알림 켜기`를 직접 누른다. 일반 Safari 탭은 iOS Push 인수 대상으로 세지 않는다. 알림 권한을 거부했을 때 앱이 다시 prompt하지 않고 일정 에이전트의 unresolved reminder fallback을 유지하는지도 확인한다. push를 누르면 `/?panel=agents&taskView=reminders`로 이동해야 한다.

문제가 생기면 먼저 `WEB_PUSH_ENABLED=false`로 바꾸고 서비스를 재시작한다. 이 조치는 dispatcher와 새 구독만 끄며 task 정본·scheduler·일정 에이전트 화면은 유지한다. 일정 기능 전체를 멈춰야 할 때만 `ASSISTANT_TASKS_ENABLED=false`를 추가로 적용한다.

### R1 Realtime 읽기 도구

> 아래 Realtime R1~R2 절은 과거 배포·복구 기록이다. active runtime과 `.env.example`에서는 퇴역했으며 현재 음성 운영은 `docs/voice-halfduplex-design.md`를 따른다.

R0 음성이 이미 정상이고 A2 실제 주입이 인수된 Pi에서만 R1 flag를 연다. 세 값 중 하나라도 false면 읽기 도구는 session config에 들어가지 않는다.

```env
OPENAI_REALTIME_ENABLED=true
OPENAI_REALTIME_MODEL=gpt-realtime-2.1-mini
OPENAI_REALTIME_VOICE=cedar
OPENAI_REALTIME_TRANSCRIPTION_MODEL=gpt-4o-mini-transcribe
OPENAI_REALTIME_MAX_SESSION_SECONDS=300
ASSISTANT_RETRIEVAL_A2_ENABLED=true
OPENAI_REALTIME_READ_TOOLS_ENABLED=true
```

위 값은 2026-07-30 인수한 현재 baseline이다. voice와 모델 변경은 새 Realtime 세션부터 적용되므로 `.env`만 바꾸고 기존 브라우저 음성 세션으로 판단하지 않는다. 서비스를 재시작하고 새 음성 세션을 연다.

재시작 직후 아래 세 가지를 확인한다.

1. `systemctl show`의 `MainPID`와 `ExecMainStartTimestamp`가 새 값이고 `ActiveState=active`, `SubState=running`이다.
2. 새 시작 시각 이후 journal에 기동 오류가 없다.
3. 인증된 `/api/config`의 `realtimeVoice`가 `enabled=true`, expected model/voice/seconds, `readToolsEnabled=true`다.

```sh
systemctl show galpi \
  -p MainPID \
  -p ExecMainStartTimestamp \
  -p ActiveState \
  -p SubState \
  --no-pager

journalctl -u galpi --since '<방금 확인한 ExecMainStartTimestamp>' --no-pager

curl -H 'X-API-Token: <API_TOKEN>' \
  http://127.0.0.1:3000/api/config
```

`<API_TOKEN>`을 실제 값으로 바꾼 명령은 공유 로그·문서에 복사하지 않는다. 가능한 경우 임시 interactive shell 변수나 안전한 비밀 전달 방식을 사용하고, 검증 출력에는 `realtimeVoice` 공개 필드만 남긴다. 응답에는 tool session ID, API key, 기억·일정 내용이 없어야 한다. tool session ID는 실제 SDP 세션 응답의 `X-Galpi-Realtime-Tool-Session` 헤더로만 브라우저에 전달되고 5분 뒤 만료된다.

2026-07-30 말투 보정 배포의 확인값은 PID `130040`, 시작 시각 `2026-07-30 22:42:57 KST`, `gpt-realtime-2.1-mini`, `cedar`, `300`, `readToolsEnabled=true`였고 새 시작 로그 오류는 0건이었다. 이 PID는 영구 기대값이 아니라 해당 배포 receipt이므로 다음 재시작에서는 새 PID를 정상으로 본다.

실기기 인수는 다음 순서로 한다.

1. 기존 A2 정답이 알려진 기억 질문 5개를 말해 관련 내용만 답하는지 확인한다.
2. 갈피에 없는 질문 4개를 말해 무관 기억을 끼워 넣지 않는지 확인한다.
3. “내 시들 중 마음에 드는 것 하나 읽어줘”로 `galpi_note_search → galpi_note_read`가 이어지고, topic 볼트 전문이 아니라 `ready` QA 청크의 시 한 편을 읽는지 확인한다.
4. 존재하지 않는 노트와 `ai_readable=false` 노트가 내용 없이 `no_match`가 되는지 확인한다.
5. 활성 일정 질문으로 task 정본과 맞고 완료·취소·삭제 일정이 섞이지 않는지 확인한다.
6. 일정 등록·완료·취소와 노트 저장을 요청해 현재 음성은 조회 전용이라고 답하고 실제 write가 0회인지 확인한다.
7. 전후 DB application table 수, task/event/reminder 수, Vault hash를 비교한다.

R1에 문제가 있으면 `OPENAI_REALTIME_READ_TOOLS_ENABLED=false`만 적용하고 서비스를 재시작한다. 그러면 R0 자연 대화는 유지되고 기억·일정 도구만 session config에서 제거된다. `ASSISTANT_RETRIEVAL_A2_ENABLED`는 텍스트 채팅에도 영향을 주므로 R1만 되돌릴 때 함께 끄지 않는다.

### R2a Realtime 휘발성 receipt

R2a는 `public/voice-realtime.js`의 브라우저 메모리에서만 turn receipt와 event reconciliation을 수행한다. audio upload, 보정 STT route, schema, DB·Vault·message·task write가 없으므로 정적 파일만 바뀌는 배포에는 서비스 재시작이 필요 없다. 브라우저는 새로고침하거나 새 음성 세션을 열어 새 파일을 받는다.

배포 전에는 DB·Vault 온라인 백업과 아래 두 파일의 코드 복구본을 만든다.

```sh
cd /home/pi/galpi
/home/pi/.nvm/versions/node/v24.16.0/bin/node scripts/backup.js
tar -czf /home/pi/backups/galpi/code-v4b-r2a-pre-<stamp>.tar.gz \
  public/voice-realtime.js \
  test/realtime-session.test.js
```

배포 뒤에는 정적 파일 hash, 집중 회귀, 전체 순차 회귀, DB·Vault 무쓰기를 확인한다.

```sh
cd /home/pi/galpi
sha256sum public/voice-realtime.js test/realtime-session.test.js
curl -fsS http://127.0.0.1:3000/voice-realtime.js | sha256sum

/home/pi/.nvm/versions/node/v24.16.0/bin/node \
  --test --test-concurrency=1 \
  test/realtime-session.test.js \
  test/realtime-session-server.test.js \
  test/realtime-tool-dispatcher.test.js

/home/pi/.nvm/versions/node/v24.16.0/bin/node \
  --test --test-concurrency=1
```

합성 fixture의 기대값은 duplicate completion/delta가 행을 늘리지 않고, 서로 다른 턴의 늦은 completion이 원래 item 행에 붙으며, 정상 assistant는 `final`, completion 뒤 취소된 assistant는 `interrupted`, user completion은 `provisional`인 것이다. HTTP 요청은 기존 Realtime session handshake와 R1 read tool뿐이어야 한다.

2026-07-30 첫 인수값은 DB·Vault `20260730-2354`, 코드 복구본 `code-v4b-r2a-pre-20260730-2353.tar.gz`, 집중 15/15, 전체 222/222다. `public/voice-realtime.js`와 실제 localhost 정적 응답 SHA-256은 `372a9c0d...42f48`로 일치했다. 서비스는 재시작하지 않아 PID `130040`을 유지했다. 전후 `messages 448`, `notes 34`, task/event/reminder `8/16/4`, retrieval trace `99`, Vault hash `7e71c78e...c0dd`가 불변이고 SQLite integrity `ok`, foreign key 오류 0건이었다.

R2a 회귀가 생기면 새 schema나 data rollback은 없다. 정적 파일을 코드 복구본에서 되돌리고 브라우저를 새로고침하면 된다. R2a receipt는 세션 메모리뿐이므로 재시작이나 페이지 종료 뒤 복구 대상으로 취급하지 않는다.

### R2b Realtime 턴 보정

R2b는 동일 마이크 스트림의 사용자 턴을 16kHz mono PCM WAV로 bounded capture하고, 인증된 Pi route가 `gpt-transcribe`로 보정한 텍스트를 휘발성 말풍선에 돌려준다. 아직 schema·message·topic·task·retrieval trace write는 없고 원본 audio도 DB·Vault·backup·temp file에 저장하지 않는다.

코드 기본값은 꺼져 있다. 운영 Pi에서만 아래 값을 사용한다.

```dotenv
OPENAI_REALTIME_CORRECTION_ENABLED=true
OPENAI_REALTIME_CANONICAL_TRANSCRIPTION_MODEL=gpt-transcribe
OPENAI_REALTIME_MAX_TURN_SECONDS=120
OPENAI_REALTIME_MAX_TURN_BYTES=8388608
```

모델은 exact ID로 고정한다. 브라우저가 모델·상한·저장 목적을 보내 선택하게 하지 않는다. `OPENAI_REALTIME_TRANSCRIPTION_MODEL=gpt-4o-mini-transcribe`는 Realtime provisional 자막용이고, 위 canonical model은 종료된 턴의 보정용이므로 서로 바꾸지 않는다.

배포 전 DB·Vault 온라인 백업과 코드 복구본을 만든다.

```sh
cd /home/pi/galpi
/home/pi/.nvm/versions/node/v24.16.0/bin/node scripts/backup.js
tar -czf /home/pi/backups/galpi/code-v4b-r2b-pre-<stamp>.tar.gz \
  package.json package-lock.json server.js \
  lib/realtime-transcription.js \
  public/index.html public/style.css \
  public/voice-realtime.js public/voice-turn-recorder.js \
  test/realtime-session.test.js \
  test/realtime-session-server.test.js \
  test/realtime-transcription.test.js \
  test/realtime-turn-recorder.test.js
```

`busboy`가 새 runtime dependency다. Pi login shell의 PATH와 systemd의 Node가 다를 수 있으므로 현재 서비스가 사용하는 Node 경로를 먼저 확인하고, 필요하면 절대 경로로 설치한다. `npm audit fix`는 기존 경고와 transitive dependency를 임의 변경하므로 실행하지 않는다.

```sh
systemctl show galpi.service -p ExecStart
cd /home/pi/galpi
/home/pi/.nvm/versions/node/v24.16.0/bin/node \
  /home/pi/.nvm/versions/node/v24.16.0/lib/node_modules/npm/bin/npm-cli.js \
  install --omit=dev
```

배포 뒤에는 집중 회귀와 전체 순차 회귀를 실행한다.

```sh
cd /home/pi/galpi
/home/pi/.nvm/versions/node/v24.16.0/bin/node \
  --test --test-concurrency=1 \
  test/realtime-transcription.test.js \
  test/realtime-turn-recorder.test.js \
  test/realtime-session.test.js \
  test/realtime-session-server.test.js

/home/pi/.nvm/versions/node/v24.16.0/bin/node \
  --test --test-concurrency=1
```

집중 fixture에서 확인할 불변식:

1. WAV header·16-bit mono·sample rate·server-derived duration을 bytes에서 검사한다.
2. 같은 session/item/turn/audio hash는 provider를 한 번만 호출하고 다른 audio는 충돌로 거절한다.
3. session별 provider 호출은 직렬화되며 미처리 3개를 넘지 않는다.
4. timeout·잘못된 ID/MIME/WAV/duration·만료 session은 transcript와 audio를 로그에 남기지 않고 bounded 오류로 끝난다.
5. 성공은 사용자 행을 `corrected`, 실패는 `기록 확인 필요`로 만들며 provisional을 저장 정본으로 승격하지 않는다.
6. page close·사용자 종료는 upload·AudioContext·recorder buffer를 정리한다.
7. 전후 application table과 Vault가 불변이다.

기능 flag와 공개 config는 인증된 API로 확인하되 token·session header·transcript는 문서나 공유 로그에 남기지 않는다. 기대 공개 필드는 아래와 같다.

```json
{
  "correctionEnabled": true,
  "canonicalTranscriptionModel": "gpt-transcribe",
  "maxTurnSeconds": 120,
  "maxTurnBytes": 8388608
}
```

서비스 재시작에는 sudo 권한이 필요할 수 있다. 자동 작업 환경에서 비밀번호가 필요한 경우 우회하지 말고 사용자에게 재시작을 요청한다. 사용자가 재시작한 뒤 아래를 확인한다.

```sh
sudo systemctl status galpi --no-pager
systemctl show galpi.service -p MainPID -p ExecMainStartTimestamp -p ActiveState -p SubState
sha256sum public/voice-realtime.js public/voice-turn-recorder.js lib/realtime-transcription.js
curl -fsS http://127.0.0.1:3000/voice-realtime.js | sha256sum
curl -fsS http://127.0.0.1:3000/voice-turn-recorder.js | sha256sum
journalctl -u galpi.service --since "<restart timestamp>" --no-pager
```

실기기 인수에서는 PWA를 완전히 닫았다 열거나 hard refresh해 새 JS를 받은 뒤 아래를 확인한다.

1. 짧은 한국어·영어·code-switch를 각각 말하고 사용자 자막이 `보정 중` 뒤 보정본으로 교체되는지 본다.
2. `갈피`, `시온`, 실제 노트 제목, 날짜·시각·숫자를 말해 provisional과 corrected를 비교한다.
3. 발화 첫·끝 음절이 500ms pre-roll·300ms post-roll 안에서 잘리지 않는지 본다.
4. 시온 발화 중 끼어들어도 대화 중단·새 턴과 보정 queue가 함께 정상인지 본다.
5. 화면 고지가 `보정 자막 · 아직 저장 안 함`인지 확인한다.
6. 실패를 유도할 수 있으면 임시 자막이 남되 `기록 확인 필요`로 표시되고 저장 완료처럼 보이지 않는지 본다.
7. 종료 뒤 브라우저 마이크 표시가 사라지고 다음 세션이 정상 시작하는지 본다.

2026-07-31 첫 기술 인수값은 DB `galpi-20260731-0058.db`, Vault `vault-20260731-0058.tar.gz`, 코드 `code-v4b-r2b-pre-20260731-0055.tar.gz`, 로컬 집중 23/23·전체 234/234, Pi 집중 23/23·전체 230/230이다. 사용자 재시작 뒤 PID `133153`, 시작 시각 `2026-07-31 01:09:05 KST`, `active/running`, mini·Cedar·300초·read tools/correction 활성 config와 정적 응답 hash 일치를 확인했다. 전후 messages/notes/task/event/reminder/retrieval trace `448/34/8/16/4/99`, Vault hash `7e71c78e...c0dd`, SQLite integrity `ok`, foreign key 0이 불변이고 새 시작 로그의 correction·warning·error·exception은 0건이었다.

문제가 생기면 먼저 `OPENAI_REALTIME_CORRECTION_ENABLED=false`로 바꾸고 서비스를 재시작한다. 그러면 R0/R1 자연 대화와 read tool은 유지되고 bounded audio capture·보정 upload만 빠진다. 데이터 migration이 없으므로 DB rollback은 하지 않는다. 코드까지 되돌릴 때는 위 R2b 코드 복구본에서 변경 파일만 복원하고 dependency lock과 `node_modules`가 맞는지 확인한 뒤 전체 회귀를 실행한다. R2b는 durable receipt가 없으므로 재시작 전에 진행 중이던 턴을 복구 대상으로 취급하지 않는다.

### R2b 응답 중단·턴 순서·현재 시각 안정화

어려운 질문에서 음성이 정상 재생되다가 회색 `중단됨`으로 끝나는 경우 먼저 provider 장애나 VAD 오인으로 단정하지 않는다. `response.done`의 상태와 reason 의미를 아래처럼 구분한다.

|상태|UI|의미|
|---|---|---|
|`completed`|확정 답변|정상 완료|
|`cancelled`|`중단됨`|사용자 끼어들기 등 실제 취소|
|`failed`|`응답 오류`|provider 처리 실패|
|`incomplete` + `max_output_tokens`|`답변이 길어 여기서 멈춤`|응답 상한 도달|
|그 밖의 `incomplete`|`답변이 완료되지 않음`|정상 완료가 아닌 다른 종료|

운영 설정은 아래 bounded 값을 사용한다.

```dotenv
OPENAI_REALTIME_MAX_OUTPUT_TOKENS=4096
```

공식 schema가 허용하는 `inf`는 사용하지 않는다. 4,096도 한 assistant response의 최대치일 뿐 목표 길이가 아니며, 시온은 핵심부터 간결하게 답하라는 지시를 계속 받는다. 상한에 닿은 답변을 자동으로 정상 완료로 바꾸거나 무한 continuation하지 않는다.

턴 순서 안정화 뒤에는 server event 도착 순서가 화면 순서가 아니다. `speech_stopped` 사용자 턴과 tool continuation이 response 대기 queue를 만들고, 새 response는 가장 오래된 대기 턴에 결합한다. 화면은 `turn ID → user → assistant`로 재정렬한다. 아래 순서를 합성해도 같은 턴이어야 한다.

```text
user turn 1 speech_stopped
user turn 2 speech_started
turn 1 response.created
turn 1 assistant transcript.done
turn 1 user transcription.completed
```

현재 날짜·시각 질문에는 `galpi_current_time` read-only tool을 사용한다. 결과는 Pi system clock의 `Asia/Seoul` KST이며 인자를 받지 않는다. 기존 opaque tool session·call ID 멱등성·턴당 2회·8,000자·5초 timeout을 공유한다. Pi 시각 자체가 의심되면 먼저 확인한다.

```sh
timedatectl status
date --iso-8601=seconds
```

`Time zone: Asia/Seoul`, `System clock synchronized: yes`, `NTP service: active`를 기대한다. 현재 시각 도구를 고치기 위해 외부 시간 API나 브라우저 clock을 추가하지 않는다.

보정 recorder는 `AudioContext.destination`에 연결하지 않는다. `MediaStreamAudioDestinationNode` 격리 sink만 사용하며, 지원하지 않는 브라우저에서는 보정 recorder만 실패하고 Realtime 대화는 유지돼야 한다. iPhone에서 시온 음성이 새 사용자 발화로 오인되는 증상을 관찰할 때는 아래를 구분한다.

1. 어려운 질문에서 일정 길이 뒤 종료되고 사용자가 말하지 않았다면 `response.done` incomplete 가능성을 본다.
2. 사용자가 말하거나 환경 소음 직후 즉시 끝났다면 cancelled/VAD 가능성을 본다.
3. UI 문구가 실제 status와 다르면 client status mapping 회귀다.
4. 서버 journal에 오류가 없다는 사실만으로 client-side VAD나 max token 문제를 배제하지 않는다.

안정화 배포 전에는 기존 R2b 백업과 별도로 DB·Vault·코드 복구본을 만든다. 첫 배포 receipt는 아래와 같다.

- DB: `/home/pi/backups/galpi/galpi-20260731-0147.db`
- Vault: `/home/pi/backups/galpi/vault-20260731-0147.tar.gz`
- 코드: `/home/pi/backups/galpi/code-v4b-r2b-stability-pre-20260731-0147.tar.gz`
- 로컬: 집중 24/24, 전체 순차 235/235
- Pi: 집중 24/24, 전체 순차 231/231

집중 회귀:

```sh
cd /home/pi/galpi
/home/pi/.nvm/versions/node/v24.16.0/bin/node \
  --test --test-concurrency=1 \
  test/realtime-session-server.test.js \
  test/realtime-transcription.test.js \
  test/realtime-session.test.js \
  test/realtime-tool-dispatcher.test.js \
  test/realtime-turn-recorder.test.js
```

재시작 뒤 인증 config에서 `maxOutputTokens: 4096`, read tools와 correction 활성 상태를 확인한다. 정적 응답 hash, 새 PID·시작 시각, journal 오류, DB/Vault 불변도 다시 확인한다. sudo 비밀번호가 필요하면 자동화가 우회하지 않고 사용자에게 재시작을 요청한다.

2026-07-31 사용자 재시작 뒤 PID `134945`, 시작 시각 `2026-07-31 02:02:36 KST`, `active/running`을 확인했다. 인증 config는 mini·Cedar·300초·`maxOutputTokens: 4096`·read tools·correction 활성 상태였고 실제 localhost 정적 응답 hash는 배치 파일과 일치했다. 새 시작 로그 오류는 0건이다. 재시작 전후 messages/notes/task/event/reminder/retrieval trace `448/34/8/16/4/99`, Vault 59개 파일 content hash, SQLite `integrity_check=ok`, foreign key 0이 불변이었다.

#### 도구 후속 응답의 active-response 충돌

`Conversation already has an active response in progress`가 보이면 API 장애나 실제 WebRTC 단절로 분류하기 전에 function-call event 순서를 확인한다.

```text
response.function_call_arguments.done
response.done (completed, completed function_call 포함)
갈피 read tool HTTP
conversation.item.create (function_call_output)
response.create
```

`response.function_call_arguments.done`에서는 도구를 실행하거나 `response.create`를 보내지 않는다. 원래 Response가 끝났음을 보장하는 completed `response.done` 뒤에만 실행한다. tool HTTP 중 새 `speech_started`로 turn이 바뀌면 output item만 보내고 늦은 음성 continuation은 만들지 않는다.

Realtime server `error` event는 대부분 복구 가능하다는 공식 계약이 있으므로 client에서 peer·mic·data channel을 즉시 닫지 않는다. 안내를 표시하고 다음 speech/response에서 지우며, 실제 WebRTC `failed | closed`, 2초 넘는 `disconnected`, data channel 오류만 연결 종료로 처리한다.

2026-07-31 보정 배포 receipt:

- DB·Vault 백업: `galpi-20260731-1053.db`, `vault-20260731-1053.tar.gz`
- 코드 복구본: `code-v4b-r2b-tool-race-pre-20260731-1053.tar.gz`
- 로컬 집중 24/24·전체 순차 235/235
- Pi 집중 24/24·전체 순차 231/231
- 배포/localhost `voice-realtime.js`: `a126abeb...dac5`
- 서비스 재시작 없음, PID `134945` 유지
- messages/notes/task/event/reminder/trace `448/34/8/16/4/99`, Vault 59개 파일 hash, SQLite integrity·foreign key 불변
- 기존 7일 보관 정책에 따라 백업 실행 중 오래된 백업 2개 정리

실기기에서는 PWA를 완전히 닫았다 다시 열고 `지금 몇 시야?`를 먼저 묻는다. KST 시각을 답하고 `연결 오류`가 없어야 하며, 곧바로 일반 질문 하나를 이어서 같은 session이 살아 있는지 확인한다.

#### Realtime 입력 잡음과 false interruption

브라우저의 `echoCancellation`, `noiseSuppression`, `autoGainControl`이 켜져 있어도 헛기침이나 알림음을 `speech_started`로 오인하면 `interrupt_response: true`에 의해 진행 중 답변이 취소될 수 있다. 이 경우 첫 보정은 `semantic_vad`나 끼어들기 동작을 바꾸는 것이 아니라 Realtime session의 `audio.input.noise_reduction: { type: "near_field" }`를 켜는 것이다.

`near_field`는 iPhone을 가까이 두고 말하는 현재 사용법의 운영 기준이다. 휴대폰을 멀리 둔 speakerphone 사용에서는 `far_field`를 별도 표본으로 비교하고 자동 전환하지 않는다. noise reduction은 VAD보다 앞에서 입력을 정리하지만 헛기침·알림음 전용 분류기가 아니므로 false interruption 0회를 구현만으로 단정하지 않는다.

이 설정은 `lib/realtime-session.js`가 만드는 새 session config에 들어간다. 기존 WebRTC session에는 소급 적용되지 않으며 서비스 재시작과 새 음성 세션이 필요하다. schema·DB·Vault·dependency는 바뀌지 않는다.

배포 전에는 DB·Vault 온라인 백업과 설정·테스트·문서 복구본을 만든다.

```sh
cd /home/pi/galpi
/home/pi/.nvm/versions/node/v24.16.0/bin/node scripts/backup.js
tar -czf /home/pi/backups/galpi/code-v4b-noise-reduction-pre-$(date +%Y%m%d-%H%M%S).tar.gz \
  lib/realtime-session.js \
  test/realtime-session.test.js \
  docs/voice-realtime-design.md \
  docs/RASPBERRY_PI_RUNBOOK.md \
  AGENTS.md \
  CLAUDE.md
```

배포 후 재시작 전후에는 집중 회귀와 전체 순차 회귀를 실행하고, 새 session config fixture가 `noise_reduction.type=near_field`와 기존 `semantic_vad`, `eagerness=auto`, `interrupt_response=true`를 함께 고정하는지 확인한다.

```sh
cd /home/pi/galpi
/home/pi/.nvm/versions/node/v24.16.0/bin/node \
  --test \
  test/realtime-session.test.js \
  test/realtime-session-server.test.js
PATH=/home/pi/.nvm/versions/node/v24.16.0/bin:/usr/local/bin:/usr/bin:/bin \
  /home/pi/.nvm/versions/node/v24.16.0/lib/node_modules/npm/bin/npm-cli.js \
  test -- --test-concurrency=1
```

서비스 재시작에 sudo 비밀번호가 필요하면 우회하지 않고 사용자에게 요청한다. 재시작 뒤 새 PID·시작 시각·`active/running`, 새 시작 이후 journal 오류 0건과 인증 config의 기존 mini·Cedar·300초·4096 tokens·read tools·correction 값을 확인한다. noise reduction은 공개 `/api/config` 필드로 새로 노출하지 않는다.

2026-07-31 첫 배포 receipt:

- DB·Vault 백업: `galpi-20260731-1124.db`, `vault-20260731-1124.tar.gz`
- 코드 복구본: `code-v4b-noise-reduction-pre-20260731-112415.tar.gz`
- 로컬 집중 9/9·전체 순차 235/235
- Pi 집중 9/9·전체 순차 231/231
- 사용자 재시작 뒤 PID `138723`, 시작 시각 `2026-07-31 11:43:47 KST`, `active/running`
- localhost HTTP 200, 새 시작 이후 warning 이상 journal 0건
- 실제 session config 생성값: `gpt-realtime-2.1-mini`, `cedar`, 4096 tokens, `near_field`, 기존 `semantic_vad/eagerness:auto/create_response:true/interrupt_response:true`
- messages/notes/task/event/reminder/trace `448/34/8/16/4/99`, Vault 59개와 hash `7e71c78e...c0dd`, SQLite integrity `ok`, foreign key 0으로 재시작 전후 불변

실기기에서는 PWA를 완전히 닫았다 다시 열고 새 음성 세션에서 다음 순서로 확인한다.

1. 시온이 말하는 동안 헛기침 5회와 실제 알림음 5회를 각각 재생하고 오중단·잘못 생성된 사용자 턴·불필요한 보정 요청 수를 기록한다.
2. “잠깐”, “아니”, 완전한 새 질문 등 의도한 끼어들기 5회가 계속 즉시 동작하는지 확인한다.
3. 작은 목소리와 평소 목소리 각 5회에서 미감지·첫 음절 손실·응답 시작 지연이 늘지 않았는지 확인한다.
4. 목표는 잡음 오중단 0회지만, 실제 끼어들기 실패나 작은 목소리 회귀가 하나라도 있으면 GO하지 않는다.

문제가 noise reduction 적용 뒤에만 생기면 가장 작은 rollback은 session config의 `noise_reduction` 블록만 제거하고 서비스를 재시작하는 것이다. `interrupt_response`를 끄거나 `semantic_vad`를 `server_vad`로 바꾸지 않는다. 잡음 오중단이 계속되면 동일 표본을 보존한 뒤 별도 컨펌으로 `server_vad` threshold 비교를 설계한다.

실기기 회귀는 PWA를 완전히 닫았다 다시 열어 새 JS를 받은 뒤 진행한다.

1. “지금 몇 시야?”에서 실제 KST 시각을 분 단위로 맞게 답하는지 확인한다.
2. 이전에 잘렸던 같은 어려운 질문을 다시 말해 답변이 완결되는지 확인한다.
3. 답변 중 아무 말도 하지 않았는데 `중단됨`이 생기지 않는지 본다.
4. 실제로 끼어들었을 때만 이전 답변이 `중단됨`으로 바뀌는지 본다.
5. 빠르게 두 턴을 이어 말하고 모든 행이 `나 → XION → 나 → XION` 순서인지 확인한다.
6. 보정 자막이 계속 `보정 중 → corrected | 기록 확인 필요`로 수렴하는지 확인한다.

회귀 시 가장 작은 rollback은 `OPENAI_REALTIME_MAX_OUTPUT_TOKENS=800`이 아니다. 그 값은 확인된 답변 절단 원인을 되살린다. 문제가 recorder audio graph에 한정되면 correction flag만 끄고, response/turn 상태 머신 회귀면 안정화 코드 복구본에서 관련 파일을 되돌린다. DB migration이 없으므로 data rollback은 하지 않는다.

## 4. 실행

```sh
npm start
```

서버 로그에서 아래를 확인한다.

```text
갈피 서버 실행 중
로컬: http://localhost:3000
네트워크: http://<라즈베리파이_IP>:3000
```

라즈베리파이 IP 확인:

```sh
hostname -I
```

맥/폰 브라우저에서 접속:

```text
http://<라즈베리파이_IP>:3000
```

### 자동 실행 (systemd — 재부팅·크래시 생존)

`npm start`는 터미널을 닫으면 멈춘다. 재부팅·크래시 후 자동으로 다시 뜨게 하려면 systemd에 등록한다. `deploy/galpi.service`가 템플릿이다(User/경로를 실제 환경으로 교체).

```sh
sudo cp deploy/galpi.service /etc/systemd/system/galpi.service
sudo nano /etc/systemd/system/galpi.service   # User, WorkingDirectory, ExecStart 경로 확인
sudo systemctl daemon-reload
sudo systemctl enable --now galpi
```

확인 / 로그:

```sh
systemctl status galpi
journalctl -u galpi -f
```

- `Restart=on-failure`로 크래시 시 자동 재시작, `enable`로 재부팅 후 자동 기동.
- 자동 백업(인프로세스)도 서버가 떠 있어야 도니, systemd 등록이 사실상 백업의 전제다.
- 코드 갱신 후 재시작: `sudo systemctl restart galpi`

### sudo 비밀번호가 필요한 운영 작업

- Codex 실행 환경에서 `sudo`가 TTY 또는 비밀번호를 요구하면 우회하지 않고 작업을 멈춘다.
- 프로세스에 `SIGKILL`·`SIGHUP` 같은 실패 신호를 보내 `Restart=on-failure`를 유도하지 않는다.
- 사용자에게 실행이 필요한 정확한 명령을 요청하고, 사용자가 완료했다고 확인한 뒤 새 PID·서비스 상태·로그 검증을 이어간다.
- 일반 코드 배포의 기본 요청 명령은 다음 한 줄이다.

```sh
sudo systemctl restart galpi
```

## 5. Smoke Test

서비스를 재시작하기 전에 Codex 실행 파일과 로그인·모델 호출을 서비스 계정으로 직접 확인한다.

```sh
test -x /home/pi/galpi/bin/codex
sudo -u pi /home/pi/galpi/bin/codex --version
cd /home/pi/galpi
npm run check:codex-runner
sudo -u pi mkdir -p /tmp/galpi-codex-smoke
printf '%s\n' 'Reply only RUNNER_OK. Do not modify files.' | sudo -u pi /home/pi/galpi/bin/codex exec --model gpt-5.6-terra -C /tmp/galpi-codex-smoke --skip-git-repo-check --sandbox workspace-write --color never -
```

`check:codex-runner`는 `.env`의 실제 `CODEX_BIN`으로 버전과 로그인 상태만 검사하며 모델 호출은 하지 않는다. 마지막 명령은 서버와 같은 `codex exec`·stdin 실행 경로를 빈 임시 폴더에서 실제로 한 번 호출한다. `.env`의 `CODEX_MODEL`을 바꿨다면 `--model`도 같은 값으로 바꾼다. `gpt-5.6-terra`는 Pi의 Codex CLI `0.144.5`에서 검증했으며, 구버전에서 최신 CLI 요구 오류가 나면 모델 설정 전에 CLI를 올린다. 출력에 `RUNNER_OK`가 없으면 정리 job을 실행하지 말고 실행 파일·로그인·모델 설정부터 고친다.

그다음 서버에서 정적 검증을 실행한다.

```sh
node scripts/validate-codex-edit.js
```

서비스를 재시작하고 다른 터미널에서 인증된 API를 확인한다. `<API_TOKEN>`은 `.env`의 실제 값으로 교체한다.

```sh
sudo systemctl restart galpi
curl -H 'X-API-Token: <API_TOKEN>' http://127.0.0.1:3000/api/config
curl -H 'X-API-Token: <API_TOKEN>' http://127.0.0.1:3000/api/organize/status
```

기대값:

- `hasClaude: true`
- `hasGpt: true`
- `codexJobBatchSize: 2`
- `needsManualCheck: 0`
- `recoveryRequired: 0`
- `pending`, `queued`, `running` 값이 의도한 상태와 일치

## 6. Codex 정리

상태 확인:

```text
/organize
```

노트 상태와 최근 job의 상태·시도 횟수·실패 원인을 읽기만 한다. 파일명은 화면에 표시하지 않는다. 현재 `config/codex-policy.json`의 `organize.autoQueueThreshold`는 저장 이벤트 5개가 쌓이면 자동 큐를 시작하고, `organize.jobBatchSize`는 한 번의 Codex 호출을 2개 노트로 제한한다. 호출 수는 늘지만 정리 누락·타임아웃 때 한꺼번에 롤백되는 범위가 줄어든다.

이미 queue에 있는 가장 오래된 대기 job부터 수동 재개:

```text
/organize process
```

실행기 장애나 vault 루트·권한·I/O 같은 공용 저장소 장애로 멈춘 job은 같은 job ID와 시도 횟수·오류를 보존한 채 `pending`에 남으므로, 원인을 고친 뒤 이 명령으로 바로 재시도할 수 있다. 공용 장애는 자동으로 반복 실행하지 않아 같은 job의 시도 횟수가 무한히 늘지 않는다. 단, Codex가 파일을 건드린 뒤 원본 snapshot 복원까지 실패하거나 `running` 상태에서 서버가 중단되면 변경 안전성을 추정하지 않는다. job은 `failed`, 현재 최대 2개 대상 노트는 별도 `recovery_required`로 원자적으로 격리하고 후속 배치 생성을 멈춘다. 일반 검증 실패는 snapshot 복원 성공을 확인한 뒤 `needs_manual_check`로 보내며 다음 배치로 진행한다. 처음부터 queued job이 없으면 임계값 미달 pending을 새로 실행하지 않고 종료한다. 자동 worker가 정상일 때는 보통 직접 누를 필요가 없는 점검·복구용 명령이다.

Codex가 대상 파일 snapshot을 잡고 있는 동안 append·split·merge·archive, sync와 AI용 원문 읽기는 같은 직렬 큐에서 기다린다. 한 job의 최대 2개 노트가 끝난 뒤 저장·회수를 이어가므로 동시 수정 복구가 새 Q&A를 덮거나 중간 파일이 답변에 들어가지 않지만, 그 사이 해당 응답은 job 실행 시간만큼 늦어질 수 있다. 다음 job을 시작할 때는 active 상태, 원본 파일, vault 루트의 `dev/ino` 동일성을 다시 확인한다. 그 사이 보관·병합·삭제·수동 확인·복구 격리된 노트는 건너뛴다. vault 자체는 정상인데 active DB 행에 대응하는 원본 파일 하나만 확정적으로 없는 경우에만 그 노트를 `needs_manual_check`로 격리하고 같은 배치의 정상 노트를 계속 처리한다. vault 루트 교체·접근 불가·파일 권한 거부·I/O 오류는 개별 누락으로 오판하지 않고 공용 저장소 장애로 중단한다.

`recovery_required`가 하나라도 있으면 `/organize queue|process|all`과 자동 worker 전체를 차단한다. 해당 노트는 일반 UI에서 백업 대조용으로 직접 열 수 있지만, 질문 컨텍스트·검색·A1b 청크·논문 전문·MCP list/read·임베딩·자동 append/병합/분리/보관에서는 제외한다. 알림은 무시할 수 없으며 다음 순서로만 해제한다.

1. 현재 DB·vault를 추가 백업한다.
2. 알림의 노트를 백업 원본과 대조해 수동 복구한다.
3. 일반 노트 상세에서 복구 결과를 직접 확인한다.
4. 알림센터의 `확인 완료`를 누른다. 이 승인에 한해서만 선택한 해당 파일 하나를 검증·sync하고 격리를 해제하며, 다른 vault 파일이나 missing 상태는 갱신하지 않는다.
5. `/organize`에서 `recoveryRequired: 0`을 확인한 뒤 남은 `pending` 노트가 있으면 `/organize queue`로 새 job을 만든다. 중단된 기존 job은 재실행하지 않는다.

전체 재정리:

```text
/organize all
```

주의:

- `/organize all`은 초기/유지보수용이다.
- runner preflight가 실패한 상태의 `/organize all`은 서버가 503으로 차단한다. `recovery_required`가 있으면 409로 차단한다. 실행 중 runner·저장소 장애가 나도 현재 배치 상태를 복원하고 다음 배치를 중단하며, snapshot 복원을 확인할 수 없는 배치는 위 수동 복구 절차 전까지 모든 Codex 정리를 막는다.
- 노트가 많아지면 토큰과 시간이 크게 든다.
- 장기적으로는 새 노트/변경 노트 중심의 증분 정리를 기본으로 쓴다.

## 7. 백업

볼트(`galpi-vault/`)와 DB(`galpi.db`)를 자동 백업한다. (DB는 SQLite 온라인 백업이라 서버 실행 중에도 안전.)

- **자동:** 서버가 떠 있으면 하루 1회. 서버가 꺼져 24시간 넘겼다가 다시 뜨면 시작 시 1회 따라잡기(catch-up).
- **보관:** 7일 지난 백업은 자동 삭제.
- **위치:** 기본 `~/backups/galpi/`. `.env`의 `BACKUP_DIR`로 변경 가능.
- **수동:** 채팅에 `/backup`, 또는 `node scripts/backup.js`.

서버가 꺼져 있어도 백업하고 싶으면 cron으로도 돌릴 수 있다 (같은 스크립트). 예: 매일 04:00.

```sh
crontab -e
# 경로는 실제 설치 위치로 교체
0 4 * * * cd /home/pi/galpi && /home/pi/.nvm/versions/node/v24.16.0/bin/node scripts/backup.js >> ~/backups/galpi/backup.log 2>&1
```

주의:

- `.env`(API 키)는 백업 대상이 아니다 — 키는 따로 안전하게 보관할 것. (분실해도 키만 다시 입력하면 됨.)
- 백업 폴더에는 DB(전체 대화 기록)가 들어 있으니 외부 공유 금지.

### 복원

백업에서 되돌릴 때 (`<stamp>`는 복원할 백업 시각):

```sh
sudo systemctl stop galpi          # 서버 멈춤 (systemd 미사용이면 그냥 종료)
cd ~/galpi
cp galpi.db galpi.db.bak           # 혹시 모를 현재 상태 보존
cp ~/backups/galpi/galpi-<stamp>.db galpi.db
rm -f galpi.db-wal galpi.db-shm    # 옛 WAL 잔재 제거
rm -rf galpi-vault
tar -xzf ~/backups/galpi/vault-<stamp>.tar.gz   # galpi-vault/ 통째로 풀림
sudo systemctl start galpi
```

DB와 볼트는 **같은 stamp**로 맞춰 복원하는 게 안전하다(시점 일치). 이름 변경 전 백업은 DB 파일명이 `council-<stamp>.db`이고 압축을 풀면 `ai-council-vault/`가 나오므로, 복사·압축 해제 후 각각 `galpi.db`와 `galpi-vault/`로 이름을 맞춘다.

### 토픽 저장 복구

토픽 감사에서 불일치를 실제로 복구할 때만 사용한다. 기본 명령은 readonly 계획 출력이며 DB와 vault를 수정하지 않는다.

```sh
cd /home/pi/galpi
npm run apply:topic-repair
```

출력된 `Input SHA-256`과 수동 작업 ID를 검토한 뒤 서비스 중지 상태에서만 적용한다.

```sh
sudo systemctl stop galpi

npm run apply:topic-repair -- \
  --apply \
  --confirm-service-stopped \
  --input-sha256 <검토한-hash> \
  --approve-operation <검토한-수동-작업-id>

sudo systemctl start galpi
```

적용 명령은 DB·vault 백업을 먼저 만들고, 입력 hash가 바뀌었거나 수동 승인이 빠졌으면 수정 전에 중단한다. 적용 후에는 다음을 확인한다.

```sh
npm run audit:topics
npm test
systemctl is-active galpi
```

Pi에서 `sudo` 비밀번호가 필요하므로 서비스 중지·시작은 사용자가 직접 실행한다.

## 8. 자주 보는 문제

### 폰/맥에서 접속이 안 됨

- `.env`의 `HOST=0.0.0.0` 확인
- `hostname -I`로 IP 확인
- 같은 와이파이인지 확인
- 포트가 3000인지 확인

### Codex가 실패함

- `.env`의 `CODEX_BIN=/home/pi/galpi/bin/codex` 확인. bare `codex`나 이전 프로젝트 경로를 두지 않는다.
- `test -x /home/pi/galpi/bin/codex`와 `sudo -u pi /home/pi/galpi/bin/codex --version` 확인
- Smoke Test의 실제 `codex exec` 호출로 로그인·모델 호출 확인
- `journalctl -u galpi --since '10 minutes ago'`에서 실제 runner 오류 확인
- 사용량 제한 메시지인지 확인
- `spawn ... ENOENT`는 노트 내용 문제가 아니라 실행 파일 경로 문제다. 경로 수정과 서비스 재시작 전에는 정리를 다시 실행하지 않는다.
- quota/rate limit 실패는 노트 수동점검 문제가 아니다. 시간이 지난 뒤 다시 실행한다.
- Node.js 또는 Codex를 업그레이드했다면 wrapper 안의 두 절대 경로를 갱신하고 preflight를 다시 통과시킨다.
- preflight가 정상으로 돌아오면 `/organize process`로 오류가 남은 같은 pending job을 재시도한다. 새 job을 만들거나 `/organize all`을 누르지 않는다.

### 노트 검증 실패

```sh
node scripts/validate-codex-edit.js
```

실패한 파일의 `CODEX-TAGS` / `CODEX-LINKS` 마커가 정확히 1쌍인지 확인한다.

### 서버는 뜨는데 모델 호출이 안 됨

```sh
curl http://127.0.0.1:3000/api/config
```

`hasClaude` 또는 `hasGpt`가 `false`면 `.env`의 API 키를 확인한다.
