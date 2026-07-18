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
CODEX_AUTO_QUEUE_THRESHOLD=5
```

`PAPER_SEARCH_MOCK=true`는 논문 정규화·카드 문제 해결용 고정 응답이다. 실제 Semantic Scholar 검색에서는 `false`로 유지한다.

로컬에서만 쓸 때는 `HOST=127.0.0.1`이어도 된다. 폰/맥에서 접속하려면 `HOST=0.0.0.0`이 필요하다.

`HOST=0.0.0.0`으로 LAN에 열 때는 `API_TOKEN`을 **반드시** 설정한다. 비워두면 같은 네트워크의 누구나 API를 호출해 키 크레딧을 쓰고 볼트를 읽을 수 있다(서버 시작 시 경고가 뜬다). 설정하면 첫 접속 시 브라우저가 토큰을 한 번 묻고 저장한다.

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
printf '%s\n' 'Reply only RUNNER_OK. Do not modify files.' | sudo -u pi /home/pi/galpi/bin/codex exec --model gpt-5.4-mini -C /tmp/galpi-codex-smoke --skip-git-repo-check --sandbox workspace-write --color never -
```

`check:codex-runner`는 `.env`의 실제 `CODEX_BIN`으로 버전과 로그인 상태만 검사하며 모델 호출은 하지 않는다. 마지막 명령은 서버와 같은 `codex exec`·stdin 실행 경로를 빈 임시 폴더에서 실제로 한 번 호출한다. `.env`의 `CODEX_MODEL`을 바꿨다면 `--model`도 같은 값으로 바꾼다. 출력에 `RUNNER_OK`가 없으면 정리 job을 실행하지 말고 실행 파일·로그인·모델 설정부터 고친다.

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
- `needsManualCheck: 0`
- `pending`, `queued`, `running` 값이 의도한 상태와 일치

## 6. Codex 정리

상태 확인:

```text
/organize
```

노트 상태와 최근 job의 상태·시도 횟수·실패 원인을 읽기만 한다. 파일명은 화면에 표시하지 않는다.

이미 queue에 있는 대기 job 하나를 수동 실행:

```text
/organize process
```

이 명령은 새 job을 만들거나 모든 pending 노트를 재정리하지 않는다. 실행기 장애로 멈춘 job은 같은 job ID와 시도 횟수·오류를 보존한 채 `pending`에 남으므로, 원인을 고친 뒤 이 명령으로 바로 재시도할 수 있다. 실행할 queued job이 없으면 그대로 종료한다. 자동 worker가 정상일 때는 보통 직접 누를 필요가 없는 점검·복구용 명령이다.

전체 재정리:

```text
/organize all
```

주의:

- `/organize all`은 초기/유지보수용이다.
- runner preflight가 실패한 상태의 `/organize all`은 서버가 503으로 차단한다. 실행 중 runner 장애가 나도 현재 배치 상태를 복원하고 다음 배치를 중단한다.
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
