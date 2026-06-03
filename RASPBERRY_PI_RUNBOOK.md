# Raspberry Pi Runbook

AI Council을 라즈베리파이에 올릴 때 쓰는 최소 실행 절차.

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

Codex 확인:

```sh
codex --version
codex exec --help
```

## 2. 프로젝트 배치

예시 경로:

```sh
mkdir -p ~/apps
cd ~/apps
git clone <repo-url> ai-council
cd ai-council
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
VAULT_PATH=/home/pi/apps/ai-council/ai-council-vault
HOST=0.0.0.0
PORT=3000
API_TOKEN=아무도-모를-긴-문자열
CODEX_RUNNER_MODE=codex
CODEX_BIN=codex
CODEX_AUTO_QUEUE_THRESHOLD=5
```

로컬에서만 쓸 때는 `HOST=127.0.0.1`이어도 된다. 폰/맥에서 접속하려면 `HOST=0.0.0.0`이 필요하다.

`HOST=0.0.0.0`으로 LAN에 열 때는 `API_TOKEN`을 **반드시** 설정한다. 비워두면 같은 네트워크의 누구나 API를 호출해 키 크레딧을 쓰고 볼트를 읽을 수 있다(서버 시작 시 경고가 뜬다). 설정하면 첫 접속 시 브라우저가 토큰을 한 번 묻고 저장한다.

## 4. 실행

```sh
npm start
```

서버 로그에서 아래를 확인한다.

```text
AI 의회 서버 실행 중
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

`npm start`는 터미널을 닫으면 멈춘다. 재부팅·크래시 후 자동으로 다시 뜨게 하려면 systemd에 등록한다. `deploy/ai-council.service`가 템플릿이다(User/경로를 실제 환경으로 교체).

```sh
sudo cp deploy/ai-council.service /etc/systemd/system/ai-council.service
sudo nano /etc/systemd/system/ai-council.service   # User, WorkingDirectory, ExecStart 경로 확인
sudo systemctl daemon-reload
sudo systemctl enable --now ai-council
```

확인 / 로그:

```sh
systemctl status ai-council
journalctl -u ai-council -f
```

- `Restart=on-failure`로 크래시 시 자동 재시작, `enable`로 재부팅 후 자동 기동.
- 자동 백업(인프로세스)도 서버가 떠 있어야 도니, systemd 등록이 사실상 백업의 전제다.
- 코드 갱신 후 재시작: `sudo systemctl restart ai-council`

## 5. Smoke Test

서버에서:

```sh
node scripts/validate-codex-edit.js
```

다른 터미널에서:

```sh
curl http://127.0.0.1:3000/api/config
curl http://127.0.0.1:3000/api/organize/status
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

대기 job 하나 실행:

```text
/organize process
```

전체 재정리:

```text
/organize all
```

주의:

- `/organize all`은 초기/유지보수용이다.
- 노트가 많아지면 토큰과 시간이 크게 든다.
- 장기적으로는 새 노트/변경 노트 중심의 증분 정리를 기본으로 쓴다.

## 7. 백업

볼트(`ai-council-vault/`)와 DB(`council.db`)를 자동 백업한다. (DB는 SQLite 온라인 백업이라 서버 실행 중에도 안전.)

- **자동:** 서버가 떠 있으면 하루 1회. 서버가 꺼져 24시간 넘겼다가 다시 뜨면 시작 시 1회 따라잡기(catch-up).
- **보관:** 7일 지난 백업은 자동 삭제.
- **위치:** 기본 `~/backups/ai-council/`. `.env`의 `BACKUP_DIR`로 변경 가능.
- **수동:** 채팅에 `/backup`, 또는 `node scripts/backup.js`.

서버가 꺼져 있어도 백업하고 싶으면 cron으로도 돌릴 수 있다 (같은 스크립트). 예: 매일 04:00.

```sh
crontab -e
# 경로는 실제 설치 위치로 교체
0 4 * * * cd /home/pi/apps/ai-council && /usr/bin/node scripts/backup.js >> ~/backups/ai-council/backup.log 2>&1
```

주의:

- `.env`(API 키)는 백업 대상이 아니다 — 키는 따로 안전하게 보관할 것. (분실해도 키만 다시 입력하면 됨.)
- 백업 폴더에는 DB(전체 대화 기록)가 들어 있으니 외부 공유 금지.

### 복원

백업에서 되돌릴 때 (`<stamp>`는 복원할 백업 시각):

```sh
sudo systemctl stop ai-council          # 서버 멈춤 (systemd 미사용이면 그냥 종료)
cd ~/apps/ai-council
cp council.db council.db.bak            # 혹시 모를 현재 상태 보존
cp ~/backups/ai-council/council-<stamp>.db council.db
rm -f council.db-wal council.db-shm     # 옛 WAL 잔재 제거
rm -rf ai-council-vault
tar -xzf ~/backups/ai-council/vault-<stamp>.tar.gz   # ai-council-vault/ 통째로 풀림
sudo systemctl start ai-council
```

DB와 볼트는 **같은 stamp**로 맞춰 복원하는 게 안전하다(시점 일치).

## 8. 자주 보는 문제

### 폰/맥에서 접속이 안 됨

- `.env`의 `HOST=0.0.0.0` 확인
- `hostname -I`로 IP 확인
- 같은 와이파이인지 확인
- 포트가 3000인지 확인

### Codex가 실패함

- `codex --version` 확인
- Codex 로그인 상태 확인
- 사용량 제한 메시지인지 확인
- quota/rate limit 실패는 노트 수동점검 문제가 아니다. 시간이 지난 뒤 다시 실행한다.

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
