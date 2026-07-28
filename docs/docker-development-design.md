# 갈피 Docker 개발·CI 설계

> Version: 1.0  
> Date: 2026-07-28  
> Status: approved design / not implemented / Pi production migration deferred  
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

구현 순서는 다음과 같다.

1. `GALPI_DATA_DIR` 같은 명시적 데이터 루트를 추가한다.
2. SQLite DB·WAL·SHM을 같은 host 디렉터리에 둔다.
3. Vault와 백업 디렉터리를 각각 별도 bind mount로 연결한다.
4. multi-stage `Dockerfile`, `.dockerignore`, 개발용 Compose를 추가한다.
5. x86_64/ARM64에서 install·migration·전체 테스트 smoke를 수행한다.
6. CI에서 컨테이너 테스트를 추가하되 기존 native 테스트를 당장 없애지 않는다.

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

## 3. Codex 경계

사서 Codex는 첫 Docker 단계에서 host 실행을 유지한다.

- ChatGPT 로그인 상태와 Codex CLI config를 container에 복제하지 않는다.
- 갈피 web/server 개발 컨테이너와 Codex organizer 실행을 억지로 한 image에 넣지 않는다.
- 컨테이너에서는 Codex catalog·runner가 unavailable인 상태가 UI의 독립 실패 계약대로 표시되는지 검증한다.
- 장기적으로 container에서 Codex를 실행하려면 인증 주입, UID/GID, Vault lock, child process 종료와 recovery 절차를 별도 설계한다.

---

## 4. Pi 운영 승격 조건

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

## 5. 이번 배포와의 관계

V4.5-M 단일 GPT 전환과 A2 회수 상향은 현재 native Pi 배포 방식으로 한 번에 진행한다.

- Dockerfile·Compose는 이번 Pi 활성화의 선행조건이 아니다.
- 이번 배포 중 DB 경로·service manager·Codex 인증 경계를 함께 바꾸지 않는다.
- Docker 구현은 GPT·A2 운영 인수 뒤 별도 변경으로 시작한다.
- 첫 Docker PR은 기능 변경 없이 data directory 분리와 테스트 재현성만 다룬다.

---

## 6. 성공 정의

> 새 개발 환경과 CI가 같은 명령으로 갈피를 설치·테스트할 수 있고 ARM64 문제를 배포 전에 발견한다. 운영 데이터와 인증은 image 밖에 남으며, Pi production은 별도 승격 전까지 현재 systemd 경계를 유지한다.

---

## 출처

[^docker-storage]: Docker Docs, [Storage](https://docs.docker.com/engine/storage/)
[^docker-restart]: Docker Docs, [Start containers automatically](https://docs.docker.com/engine/containers/start-containers-automatically/)
[^docker-multi-platform]: Docker Docs, [Multi-platform builds](https://docs.docker.com/build/building/multi-platform/)
[^sqlite-wal]: SQLite, [Temporary Files Used By SQLite](https://www.sqlite.org/tempfiles.html)
