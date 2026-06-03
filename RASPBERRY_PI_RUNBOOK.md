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
```

라즈베리파이에서는 아래 값을 특히 확인한다.

```env
ANTHROPIC_API_KEY=...
OPENAI_API_KEY=...
VAULT_PATH=/home/pi/apps/ai-council/ai-council-vault
HOST=0.0.0.0
PORT=3000
CODEX_RUNNER_MODE=codex
CODEX_BIN=codex
CODEX_AUTO_QUEUE_THRESHOLD=5
```

로컬에서만 쓸 때는 `HOST=127.0.0.1`이어도 된다. 폰/맥에서 접속하려면 `HOST=0.0.0.0`이 필요하다.

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

최소 백업 대상:

```text
council.db
ai-council-vault/
.env
```

예시:

```sh
mkdir -p ~/backups/ai-council
cp council.db ~/backups/ai-council/council-$(date +%Y%m%d-%H%M).db
tar -czf ~/backups/ai-council/vault-$(date +%Y%m%d-%H%M).tar.gz ai-council-vault
```

`.env`에는 키가 있으므로 외부 공유 금지.

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
