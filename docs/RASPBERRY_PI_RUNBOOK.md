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
