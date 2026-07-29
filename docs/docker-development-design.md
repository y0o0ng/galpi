# 갈피 Docker 개발·CI 설계

> Version: 1.1
> Date: 2026-07-30
> Status: phase 1 complete / Pi production migration deferred
> Scope: 로컬 개발, CI, ARM64 재현성, 데이터 경계

---

## 0. 결정

Docker는 도입한다. 다만 첫 목적은 **개발·CI 환경 재현성**이며, 현재 Raspberry Pi의 native Node.js + systemd 운영을 이번 GPT·A2 배포에서 교체하지 않는다.

이 경계를 택한 이유는 다음과 같다.

- `better-sqlite3`와 Node.js 버전을 고정해 Mac·CI·ARM64 차이를 빨리 발견할 수 있다.
- 새 기기에서 설치 절차가 짧아지고 테스트 환경이 반복 가능해진다.
- 반면 현재 갈피는 SQLite DB 경로가 앱 디렉터리에 묶여 있고, Vault·백업·Codex CLI 로그인은 host 상태에 의존한다.
- 안정적으로 운영 중인 Pi의 systemd와 Docker restart policy를 동시에 쓰면 재시작 주체가 둘이 된다. Docker 공식 문서도 “Don't combine Docker restart policies with host-level process managers”라고 안내한다.[^docker-restart]

따라서 Docker 자체를 목표로 삼지 않고, 데이터 경계를 먼저 분리한 뒤 개발·CI에서 검증한다.

---

## 1. 1차 범위

2026-07-29 구현 범위는 다음과 같다.

- [x] `GALPI_DATA_DIR` 명시적 데이터 루트와 공통 runtime path resolver
- [x] SQLite DB·WAL·SHM을 같은 host 디렉터리에 두는 계약
- [x] Vault와 백업 디렉터리의 독립 bind mount
- [x] multi-stage `Dockerfile`, `.dockerignore`, 개발용 Compose
- [x] 기존 native test와 container test를 함께 실행하는 CI
- [x] CI의 x86_64/ARM64 runtime image build
- [x] 첫 GitHub Actions 실행에서 container test와 양쪽 architecture build 확인

Docker의 bind mount는 공식 표현대로 host path와 container를 직접 연결한다.[^docker-storage] 운영 데이터는 image layer나 임시 container filesystem에 두지 않는다.

---

## 2. 데이터 배치

예상 경계:

```text
/app                 read-only application code
/var/lib/galpi       galpi.db, galpi.db-wal, galpi.db-shm
/vault               Obsidian Vault
/backups             deployment backups
```

SQLite 문서에 따르면 WAL 파일은 항상 database 파일과 같은 디렉터리에 있다.[^sqlite-wal] 따라서 DB 파일 하나만 mount하지 않고 DB 디렉터리 전체를 mount한다.

필수 규칙:

- DB·WAL·SHM은 같은 filesystem과 directory에 둔다.
- Vault와 DB는 image build context에 포함하지 않는다.
- `.env`, OpenAI API key, VAPID private key, Codex 로그인 정보는 image에 bake하지 않는다.
- backup·restore script는 container path가 아니라 데이터 루트 설정을 사용한다.
- UID/GID와 파일 권한을 명시해 host Obsidian과 갈피가 같은 Vault를 안전하게 읽고 쓸 수 있게 한다.

---

## 3. 로컬 사용

`.env`가 없다면 `.env.example`을 복사해 실제 API 키와 로컬 Vault 경로를 설정한다. 기존 `.env`를 덮어쓰면 안 된다.

현재 Intel Mac 개발 환경은 Docker Desktop 대신 Colima를 수동 실행한다.

```bash
brew install colima docker docker-compose docker-buildx
colima start --cpu 4 --memory 4 --disk 30 --runtime docker
```

자동 시작 서비스는 등록하지 않았다. 재부팅 뒤 필요할 때 `colima start`, 작업을 끝내면 `colima stop`을 사용한다.

```bash
mkdir -p .docker-data/db .docker-data/backups galpi-vault
npm run docker:test
npm run docker:up
```

Compose 기본값은 UID/GID `1000:1000`이다. Linux처럼 host 권한을 직접 맞춰야 하는 환경에서는 `.env`의 `GALPI_UID`, `GALPI_GID`를 각각 `id -u`, `id -g` 결과로 설정한다. Mac Docker Desktop에서도 명시값을 현재 사용자와 맞추는 편이 파일 소유권을 이해하기 쉽다.

기본 host 경로:

```text
./.docker-data/db       → /var/lib/galpi
./galpi-vault           → /vault
./.docker-data/backups  → /backups
```

`npm run docker:test`는 multi-stage image의 `test` target에서 기존 `npm test`를 그대로 실행한다. `npm run docker:up`은 runtime target을 만들고 `http://localhost:3000`에 연다. Docker runtime은 Node.js `24.16.0-bookworm-slim`을 고정하며 공식 image가 amd64와 arm64/v8을 함께 제공한다.[^node-image]

---

## 4. Codex 경계

사서 Codex는 첫 Docker 단계에서 host 실행을 유지한다.

- ChatGPT 로그인 상태와 Codex CLI config를 container에 복제하지 않는다.
- 갈피 web/server 개발 컨테이너와 Codex organizer 실행을 억지로 한 image에 넣지 않는다.
- Compose는 `CODEX_BIN=/nonexistent/codex`를 명시해 host CLI나 로그인을 우연히 사용하지 않는다.
- 컨테이너에서는 Codex catalog·runner가 unavailable인 상태가 UI의 독립 실패 계약대로 표시된다.
- 장기적으로 container에서 Codex를 실행하려면 인증 주입, UID/GID, Vault lock, child process 종료와 recovery 절차를 별도 설계한다.

---

## 5. CI 계약

`.github/workflows/docker.yml`은 다음 세 작업을 병렬로 실행한다.

1. Node.js 24.16.0 native `npm test`
2. Docker `test` target build 안의 `npm test`
3. runtime target의 `linux/amd64`, `linux/arm64` build

image는 registry에 push하지 않는다. Docker 공식 multi-platform 예시처럼 QEMU, Buildx, build-push action을 사용한다.[^docker-gha] API key·VAPID key·`.env`는 build context에서 제외하므로 CI build secret도 받지 않는다.

---

## 6. Pi 운영 승격 조건

아래를 모두 통과하기 전에는 Pi production을 container로 옮기지 않는다.

- ARM64 image build와 `better-sqlite3` install 성공
- migration·전체 테스트·note-index·topic audit 성공
- DB/Vault backup·restore rehearsal 성공
- Web Push scheduler, graceful shutdown, SIGTERM 중 organizer recovery 검증
- host Codex 또는 container Codex 중 실행 경계 하나만 확정
- systemd와 Docker 중 재시작 책임자 하나만 선택
- 기존 native 서비스 대비 운영 이점이 실제로 확인됨

Docker는 여러 플랫폼용 image를 만들 수 있고 ARM64 variant를 대상으로 할 수 있다.[^docker-multi-platform] 그러나 빌드 가능하다는 사실만으로 Pi 운영 전환이 안전하다는 뜻은 아니다.

---

## 7. 운영 배포와의 관계

V4.5-M 단일 GPT 전환과 A2 회수 상향은 이미 native Pi 배포 방식으로 인수했다. Docker 1단계는 그 운영 경계를 변경하지 않는다.

- Pi `.env`에 `GALPI_DATA_DIR`가 없으므로 DB는 계속 `/home/pi/galpi/galpi.db`를 사용한다.
- Pi service manager는 계속 `galpi.service` 하나다.
- Docker Compose와 image는 Pi에 배포하거나 실행하지 않는다.
- Codex 인증·organizer는 계속 host 경계를 유지한다.

---

## 8. 1단계 검증 상태

- 공통 경로·백업 집중 테스트: 6/6
- 로컬 전체 native 회귀: 211/211
- 로컬 amd64 Docker test target 전체 회귀: 211/211
- 로컬 amd64 runtime smoke: HTTP 200, read-only rootfs, UID/GID `1000:1000`, `/var/lib/galpi`의 DB/WAL/SHM, `/backups` 자동 백업 확인
- 로컬 ARM64 runtime build: 성공, image 안에서 `process.arch=arm64`와 `better-sqlite3` SQLite 3.53.1 load 확인
- Compose `config --quiet`, GitHub Actions YAML parse, JavaScript syntax, `git diff --check`: 통과
- GitHub Actions run `30463882969`: native test, container test, `linux/amd64`·`linux/arm64` runtime build 모두 성공
- Codex 경계: runtime smoke에서 `/nonexistent/codex` preflight만 독립 실패하고 서버·백업은 정상 동작

runtime smoke는 빈 격리 bind mount와 가짜 API key만 사용했다. 실제 Vault·provider API·Pi 서비스는 건드리지 않았다.

---

## 9. 성공 정의

> 새 개발 환경과 CI가 같은 명령으로 갈피를 설치·테스트할 수 있고 ARM64 문제를 배포 전에 발견한다. 운영 데이터와 인증은 image 밖에 남으며, Pi production은 별도 승격 전까지 현재 systemd 경계를 유지한다.

---

## 출처

[^docker-storage]: Docker Docs, [Storage](https://docs.docker.com/engine/storage/)
[^docker-restart]: Docker Docs, [Start containers automatically](https://docs.docker.com/engine/containers/start-containers-automatically/)
[^docker-multi-platform]: Docker Docs, [Multi-platform builds](https://docs.docker.com/build/building/multi-platform/)
[^docker-gha]: Docker Docs, [Multi-platform image with GitHub Actions](https://docs.docker.com/build/ci/github-actions/multi-platform/)
[^node-image]: Docker Hub, [Node.js 24.16.0 bookworm-slim image](https://hub.docker.com/_/node/tags?name=24.16.0-bookworm-slim)
[^sqlite-wal]: SQLite, [Temporary Files Used By SQLite](https://www.sqlite.org/tempfiles.html)
