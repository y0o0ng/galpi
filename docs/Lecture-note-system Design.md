# 갈피 강의 노트 (Galpi Lecture Notes) — System Design

**Version:** 3.2  
**Date:** 2026-07-28  
**Status:** Approved for Phase 0 validation / Implementation not started  
**Primary device:** iPad + Apple Pencil  
**Core strategy:** Apple Voice Memos + Shortcuts + Galpi web capture client

**v3.2 변경 요약:** ① 남아 있던 Sync 구호 표현을 Sync 버튼+두드리기로 통일 ② 초기 출처 링크를 인증된 갈피 상대 HTTPS 경로로 확정 ③ capture·audio·processing 상태를 독립 축으로 분리 ④ 일반 첨부와 공유하는 blob seam을 저장 기반으로 제한 ⑤ 평면 Vault 노트와 `_attachments/lectures` sidecar 경계 확정 ⑥ V5-B 전 또는 PAPER_AUTONOMOUS 관찰 중 병행하는 로드맵 위치 확정

-----

## 0. Executive Summary

### 이름 규칙

시스템·서버·저장소·API·repo의 주체는 **갈피**이며 영문 표기는 **galpi**로 고정한다(도메인 `galpi.local`, 토큰 스코프, 코드 네임스페이스 포함). **시온(Xion)** 은 갈피 안에서 사용자를 상대하는 비서·에이전트의 대표 이름으로, 질문 답변, 요약 생성의 발화 주체, 알림 문구(“시온이 어제 자료구조 강의를 정리했어요”)에만 쓴다. 시스템 컴포넌트 이름에는 시온을 쓰지 않는다. 이 문서에서 남아 있는 Xion 표기는 모두 비서로서의 시온을 가리킨다.

갈피 강의 노트는 강의 녹음, 펜 필기, 음성 전사, 구간 요약, 검색, 복습을 하나의 세션으로 묶는 개인용 강의 지식 시스템이다.

핵심 가치는 단순한 녹음이나 AI 요약이 아니다.

> **시간을 축으로 음성·필기·질문·검색 결과를 연결하고, 검색 결과에서 당시 원음과 필기 위치로 즉시 돌아가는 것.**

초기 버전은 별도 iPadOS 네이티브 앱을 배포하지 않는다. Apple의 앱 서명·재배포 비용과 유지 마찰을 피하기 위해 다음 조합을 사용한다.

- **녹음:** Apple 음성 메모
- **세션 시작·오디오 업로드:** Apple 단축어
- **필기·마커·복습:** 기존 갈피 웹앱의 Lecture Notes 탭
- **전사·요약·인덱싱:** 갈피 서버와 로컬 워커
- **영구 저장:** 볼트의 Markdown + sidecar 파일

음성 메모는 임시 우회책이 아니라, 갈피가 직접 다시 만들 필요가 없는 안정적인 네이티브 녹음 모듈로 취급한다. 단축어는 음성 메모와 갈피 세션 사이의 연결 계층을 담당한다.

네이티브 캡처 앱은 웹 필기감, 녹음 누락, 동기화 오차가 실제 사용에서 반복적으로 문제가 될 때만 검토한다. 그 전까지 네이티브 배포는 범위에서 제외한다.

-----

## 1. Product Goal

### 1.1 해결하려는 문제

강의 중에는 내용을 이해하고 필기하는 데 집중해야 한다. 그러나 강의 후에는 다음 문제가 발생한다.

- 교수의 정확한 설명을 다시 찾기 어렵다.
- 필기만 보면 당시 맥락이 복원되지 않는다.
- 녹음만 있으면 원하는 구간을 다시 찾는 데 오래 걸린다.
- AI 요약은 편하지만 근거 발화와 연결되지 않으면 신뢰하기 어렵다.
- 강의 자료가 별도 앱이나 제조사 클라우드에 갇히면 개인 지식 시스템과 연결되지 않는다.

갈피 강의 노트는 강의를 하나의 시간 기반 지식 세션으로 저장해 이 문제를 해결한다.

### 1.2 핵심 사용자 경험

사용자가 시온에게 질문한다.

> “지난주 자료구조 시간에 교수님이 레드블랙 트리 삽입 예외를 뭐라고 설명했지?”

시온은 요약 인덱스에서 관련 구간을 찾고 다음 형태로 답한다.

```text
삽입 직후 부모 노드가 빨간색인 경우, 삼촌 노드 색상에 따라
재색칠 또는 회전으로 분기한다고 설명했습니다.

[자료구조 · Lecture 03 · 12:40–14:50]
```

출처를 누르면 다음이 동시에 복원된다.

- 해당 시각부터 원음 재생
- 그 시각까지 작성된 필기 표시
- 해당 구간의 질문·중요 마커 표시
- 전사문과 구조화 요약 표시

### 1.3 성공 조건

이 시스템은 다음 세 조건을 만족해야 한다.

1. **캡처 신뢰성:** 90분 강의가 앱 전환이나 네트워크 문제로 사라지지 않는다.
1. **검색 회수성:** 사용자가 기억하는 표현과 전사 표현이 달라도 관련 구간을 찾는다.
1. **근거 복원성:** 답변이 원음과 당시 필기로 연결된다.

-----

## 2. Design Principles

### 2.1 Capture devices are replaceable

아이패드, 향후 Boox, 별도 녹음기는 모두 교체 가능한 캡처 클라이언트다. 전사, 요약, 검색, 볼트 저장은 갈피 서버에 둔다.

### 2.2 Local first, server eventually

강의 중 발생한 필기 데이터는 서버 응답보다 먼저 단말에 저장한다. 네트워크가 끊겨도 필기는 계속 가능해야 하며, 재연결 후 미전송 이벤트를 복구한다.

### 2.3 Recording reliability outranks elegance

웹에서 녹음까지 통합하면 화면은 깔끔해지지만, iPadOS의 백그라운드 제약 때문에 강의 전체 녹음이 위험해질 수 있다. 초기 버전은 UX 일체감보다 음성 메모의 안정성을 우선한다.

### 2.4 Near-zero interaction during class

강의 중 사용자는 필기 외의 작업을 거의 하지 않아야 한다. 세션 시작과 종료 절차는 짧고 실패가 명확히 보여야 한다.

### 2.5 Human-readable notes, machine-readable sidecars

Markdown은 사람이 읽는 정보와 메타데이터만 담는다. 스트로크, 타임라인, 전사 세그먼트처럼 큰 기계 데이터는 JSONL, JSON 또는 SQLite에 분리한다.

### 2.6 Index distilled memory, preserve original evidence

원본 전사 전체는 기본 벡터 인덱싱 대상에서 제외한다. 대신 구간별 구조화 요약을 인덱싱한다. 원본 오디오와 전사본은 근거 자료로 보존하고 링크한다.

### 2.7 Native development requires evidence

웹과 단축어로 핵심 가치가 검증되기 전에는 iPadOS 네이티브 앱을 만들지 않는다. 기술적 욕망이 아니라 실사용 실패 데이터가 네이티브 전환을 결정한다.

-----

## 3. Confirmed Decisions

1. 초기 캡처 단말은 보유 중인 iPad와 Apple Pencil이다.
1. Lecture Notes는 별도 앱이 아니라 기존 갈피 웹앱의 독립 탭으로 구현한다.
1. 녹음은 Apple 음성 메모를 사용한다.
1. 단축어가 세션 생성, 음성 메모 연결, 녹음 파일 업로드를 담당한다.
1. 음성 메모 녹음 시작 버튼은 사용자가 직접 누른다.
1. 필기 스트로크는 웹 캔버스가 직접 수집하고 시간 정보를 붙인다.
1. 웹 캔버스는 IndexedDB 기반 로컬 우선 저장을 사용한다.
1. 원본 전사 전체가 아니라 구간별 구조화 요약만 검색 인덱스에 넣는다.
1. 원본 오디오, 전사, 타임라인은 보존하고 답변의 출처로 연결한다.
1. Boox 또는 네이티브 캡처 앱은 실사용 후 조건부로 검토한다.

-----

## 4. System Architecture

```text
┌──────────────────────── iPad ────────────────────────┐
│                                                     │
│  [Shortcut: Galpi Lecture Start]                     │
│       ├─ session 생성                               │
│       ├─ 과목 선택 또는 시간표 추론                │
│       ├─ Voice Memos 열기                           │
│       └─ 갈피 강의 노트 URL 준비                │
│                                                     │
│  [Apple Voice Memos]                                │
│       └─ native background recording                │
│                                                     │
│  [Galpi Web · Lecture Notes]                         │
│       ├─ Apple Pencil canvas                        │
│       ├─ timestamped stroke events                  │
│       ├─ importance/question markers                │
│       ├─ IndexedDB local persistence                │
│       └─ asynchronous event sync                    │
│                                                     │
│  [Shortcut: Send Lecture to Galpi]                   │
│       └─ Share Sheet audio upload                   │
└───────────────────────┬─────────────────────────────┘
                        │ Tailscale / HTTPS
                        ▼
┌──────────────────────── Galpi Server ─────────────────┐
│  Session API                                         │
│  Event ingest API                                    │
│  Audio upload API                                    │
│  Processing queue                                    │
│       ├─ STT                                         │
│       ├─ segment generation                          │
│       ├─ structured summarization                    │
│       ├─ question answering                          │
│       └─ vault writer / retrieval index              │
└───────────────────────┬─────────────────────────────┘
                        ▼
┌───────────────────────── Vault ──────────────────────┐
│  <강의 제목>.md                                      │
│  _attachments/lectures/<session_id>/                 │
│       ├─ audio.m4a                                   │
│       ├─ transcript.json                             │
│       ├─ timeline.jsonl                              │
│       └─ canvas snapshot / stroke assets             │
└─────────────────────────────────────────────────────┘
```

### 4.1 Component boundaries

#### Capture Web Client

- 과목과 세션 표시
- 필기 캔버스
- 스트로크 이벤트 기록
- 명시적 중요·질문 마커
- 로컬 저장과 서버 동기화
- 강의 중 오디오 재생 차단

#### Shortcut Bridge

- 세션 생성
- 현재 활성 세션 조회
- 음성 파일을 올바른 세션에 연결
- 업로드 결과 표시
- 실패 시 재시도 경로 제공

#### Processing Pipeline

- 오디오 검증
- 전사
- 구간 분할
- 구조화 요약
- 질문 마커 기반 답변 생성
- 볼트 파일 생성
- 검색 인덱스 갱신

#### Review Client

- 구간별 요약
- 출처 타임코드
- 원음 재생
- 특정 시각의 필기 상태 복원
- 질문과 중요 구간 표시

### 4.2 Shared blob boundary

일반 첨부와 강의 오디오는 다음 blob 저장 기반만 공유한다.

- 서버 생성 ID
- SHA-256·MIME·크기 검증
- temporary 저장
- 인증된 읽기
- 같은 filesystem 안의 원자적 finalization
- orphan·미참조 blob 정리

강의가 별도로 소유한다.

- lecture session
- 대용량·재개 업로드
- capture·audio·processing 상태
- STT·동기화·구간 분할
- 학기별 보존 정책

강의 오디오는 일반 `attachments`·`message_attachments`의 대화 replay lifecycle이나 Attachment 노트를 사용하지 않는다. 사람에게 보이는 강의 Markdown은 기존 평면 Vault에 두고, 바이너리·기계 sidecar만 `_attachments/lectures/<session_id>/` 아래에 둔다.

-----

## 5. Shortcut UX

단축어는 음성 메모의 기능을 대체하지 않는다. 음성 메모를 갈피 세션과 연결하고 반복 작업을 줄인다.

## 5.1 Shortcut A — Galpi Lecture Start

### 목적

강의 세션을 생성하고 사용자가 녹음과 필기를 시작할 준비를 만든다.

### 권장 흐름

```text
홈 화면 위젯 또는 단축어 실행
→ 과목 자동 추론
→ 필요하면 과목 선택 메뉴
→ POST /lecture/sessions
→ session_id 수신
→ 갈피 노트 URL 생성
→ Voice Memos 열기
→ 사용자가 녹음 버튼 탭
→ 갈피 강의 노트 탭으로 이동
→ 세션 시작 상태 확인
```

### 과목 선택 우선순위

1. 현재 요일·시간과 시간표가 정확히 일치하면 자동 선택
1. 후보가 여러 개면 메뉴 표시
1. 일치 항목이 없으면 최근 과목 또는 직접 입력

### 서버 요청 예시

```json
{
  "course_id": "cs-data-structures",
  "client_started_at": "2026-09-01T09:00:03+09:00",
  "capture_device": "ipad",
  "recording_provider": "apple_voice_memos"
}
```

### 응답 예시

```json
{
  "session_id": "lec_20260901_csds_0900_01",
  "status": "created",
  "capture_url": "https://galpi.local/lecture/lec_20260901_csds_0900_01/capture"
}
```

### 주의점

단축어가 음성 메모의 실제 녹음 시작 버튼을 대신 누른다고 가정하지 않는다. 녹음 시작은 사용자가 확인 가능한 명시적 동작으로 남긴다.

## 5.2 Shortcut B — Send Lecture to Galpi

### 목적

음성 메모의 공유 시트에서 선택한 녹음 파일을 현재 세션에 업로드한다.

### 입력

- 오디오 또는 파일
- 공유 시트에서 실행

### 권장 흐름

```text
음성 메모에서 녹음 종료
→ 공유
→ Send Lecture to Galpi
→ GET /lecture/sessions/active
→ 활성 세션과 과목 표시
→ 사용자가 확인
→ multipart audio upload
→ 업로드 완료 처리
→ processing status page 열기
```

### 안전장치

- 활성 세션이 없으면 새 세션을 만들거나 기존 세션을 선택하게 한다.
- 같은 오디오 해시가 이미 업로드되었다면 중복 업로드를 막는다.
- 길이가 지나치게 짧으면 경고한다.
- 업로드 실패 시 파일을 버리지 않고 재시도 버튼을 제공한다.
- 서버가 수신 완료 ACK를 보낸 뒤에만 성공으로 표시한다.

## 5.3 Shortcut C — Upload Latest Recording

공유 시트 사용이 불편할 때를 위한 보조 경로다.

```text
최근 음성 녹음 조회
→ 최신순 정렬
→ 파일명·생성 시각·길이 표시
→ 업로드 대상 확인
→ 활성 세션 선택
→ 업로드
```

이 단축어는 자동 추측보다 사용자 확인을 우선한다. 잘못된 녹음을 강의 세션에 연결하는 것이 한 번 더 누르는 것보다 큰 실패다.

## 5.4 Shortcut API credential

단축어에는 갈피 전체 권한 토큰을 넣지 않는다. 다음 권한만 가진 별도 ingest token을 사용한다.

```text
lecture:session:create
lecture:session:read-active
lecture:audio:upload
```

토큰은 회전 가능해야 하며, 서버 로그에 토큰 원문을 기록하지 않는다.

-----

## 6. Capture UX

## 6.1 Start flow

강의 시작의 목표는 완전한 원탭이 아니라 **실패 여부가 명확한 짧은 흐름**이다.

1. `Galpi Lecture Start` 실행
1. 과목 확인
1. 음성 메모 녹음 버튼 탭
1. 갈피 캡처 화면으로 이동
1. 상단 상태가 다음처럼 표시되는지 확인

```text
● Voice Memos recording: user confirmed
● Galpi session: active
● Local save: ready
● Server sync: connected / offline
```

웹앱은 음성 메모의 실제 녹음 상태를 직접 신뢰성 있게 읽지 못할 수 있다. 따라서 초기 버전의 `Voice Memos recording` 표시는 사용자 확인 상태이며, 녹음을 기술적으로 감시한다는 의미가 아니다.

## 6.2 During class

- 기본 상태에서는 Apple Pencil 입력만 필기로 처리한다.
- 손가락은 스크롤, 확대, 이동에 사용한다.
- 강의 중 화면을 벗어나도 필기 데이터는 로컬에 남는다.
- 서버가 끊기면 오프라인 배지를 표시하고 기록은 계속한다.
- 갈피 캡처 화면은 TTS, 효과음, 자동 재생을 하지 않는다.

## 6.3 Marker design

초기 버전은 손글씨 도형 인식을 핵심 입력으로 사용하지 않는다. 오탐과 사용자의 기호 형태 차이를 피하기 위해 캔버스 가장자리에 두 개의 작은 명시적 마커를 둔다.

- `★ Important` — 요약 가중치와 복습 우선순위를 높인다.
- `? Question` — 해당 시각 주변 전사를 근거로 질문 항목을 만든다.

두 버튼은 한 번 탭하면 현재 시각에 이벤트를 남긴다. 길게 누르면 최근 마커를 취소한다.

손글씨 `★`, `?` 인식은 실제 스트로크 데이터를 축적한 뒤 선택 기능으로 추가한다.

## 6.4 End flow

1. 음성 메모 녹음 종료
1. 녹음 파일 공유
1. `Send Lecture to Galpi` 실행
1. 활성 세션 확인
1. 업로드 성공 확인
1. 갈피 캡처 화면에서 `Finish Session`
1. capture가 닫히고 audio·processing 상태 확인

`Finish Session`은 `capture_status`만 `closed`로 바꾼다. 오디오는 종료 전이나 종료 후 모두 업로드할 수 있으며 `audio_status`가 독립적으로 진행된다. 오디오가 아직 없으면 processing은 시작하지 않고 나중에 파일을 연결할 수 있어야 한다.

-----

## 7. Audio–Canvas Synchronization

음성 메모와 웹 캔버스가 서로 다른 앱에서 동작하므로 동기화 기준이 필요하다.

## 7.1 Canonical synchronization method

파일 생성 시각만으로 녹음 시작 시각을 확정하지 않는다. 해당 메타데이터가 실제 녹음 시작 시각을 항상 보존한다는 전제는 Phase 1에서 검증하기 전까지 신뢰하지 않는다.

초기 기본 방식은 **Sync 버튼 + 두드리기**다. 발화 구호는 조용한 강의실에서 실제로 수행되지 않을 가능성이 높아 기본에서 제외한다.

```text
음성 메모 녹음 시작
→ 갈피 캡처 화면 열기
→ Sync 버튼을 누르는 순간 펜이나 손끝으로 책상을 한 번 톡 두드리기
```

웹 캔버스는 Sync 버튼을 누른 정확한 단조 증가 시간을 기록한다. 처리 단계에서 버튼 시각 기준 ±30초 탐색 창 안의 오디오에서 단발 임펄스(짧은 구간 에너지 피크)를 찾아 오프셋을 계산한다. 탐색 창을 좁게 잡으므로 강의 중 다른 소음과의 혼동 가능성은 낮다.

```text
audio_offset_ms = audio_impulse_ms - canvas_sync_event_ms
```

### 대안 (우선순위 순)

- 발화 구호: 소리 내 말할 수 있는 환경이면 Sync 버튼과 함께 “갈피 싱크”라고 말한다. 전사에서 해당 문구를 찾아 오프셋을 계산하며, 임펄스 탐지가 실패한 세션의 보조 수단으로도 유효하다.
- 검증된 녹음 시작 메타데이터: Phase 1에서 음성 메모 파일의 생성 시각이 실제 녹음 시작과 일치함이 반복 확인되면, 무동작 방식으로 기본 승격한다.
- 수동 파형 정렬: 복습 화면의 수동 보정 UI와 동일 경로.

### 목표 오차

- 목표: ±5초 이내
- 허용 상한: ±10초
- 허용 상한을 넘으면 복습 화면에서 수동 보정 UI 제공

90분 세션에서 시작 anchor 하나만으로 후반 drift가 반복되면 종료 직전 같은 Sync 버튼+두드리기를 선택적 end anchor로 한 번 더 기록한다. Phase 2 실측 전에는 필수 동작으로 만들지 않는다.

## 7.2 Clock model

한 세션 내부에서는 벽시계보다 단조 증가 시간을 기준으로 한다.

- `created_at`: 사람이 읽고 시스템 간 대조하는 벽시계
- `t_monotonic_ms`: 세션 시작 이후 경과 시간
- `seq`: 이벤트 순서

기기 시각이 조정되더라도 스트로크 순서와 재생 위치가 깨지지 않아야 한다.

-----

## 8. Local-First Canvas Persistence

필기 데이터는 서버보다 단말 저장을 먼저 완료해야 한다.

## 8.1 Event pipeline

```text
Pointer event
→ stroke event 생성
→ IndexedDB append
→ 화면 렌더링
→ background sync queue 등록
→ 서버 batch upload
→ ACK 수신
→ synced flag 업데이트
```

서버 연결이 없어도 앞 네 단계는 정상 동작해야 한다.

## 8.2 Required event fields

```json
{
  "session_id": "lec_20260901_csds_0900_01",
  "event_id": "evt_01J7...",
  "seq": 1042,
  "type": "stroke",
  "page_id": "page_03",
  "t_monotonic_ms": 427820,
  "created_at": "2026-09-01T09:07:08.214+09:00",
  "payload": {
    "tool": "pen",
    "width": 1.8,
    "points": []
  },
  "sync_state": "pending"
}
```

## 8.3 Snapshot strategy

이벤트 로그만으로 긴 강의를 처음부터 재생하면 느릴 수 있다.

- 일정 이벤트 수 또는 일정 시간마다 캔버스 snapshot 생성
- 복습 시 목표 시각 직전 snapshot 로드
- 이후 이벤트만 replay
- snapshot은 캐시이며 원본 이벤트가 진실의 원천이다.

## 8.4 Recovery behavior

- 새로고침 후 마지막 로컬 상태 복구
- 브라우저 강제 종료 후 세션 복구
- 중복 전송은 `event_id`로 멱등 처리
- 서버 ACK 이전 이벤트는 자동 재전송
- 세션 종료 후에도 미전송 이벤트가 있으면 경고
- 사용자가 명시적으로 삭제하기 전까지 로컬 원본 유지

-----

## 9. Session State Machine

세션의 capture, audio, processing은 서로 독립된 상태 축이다. 오디오 업로드 전 세션 종료나 오프라인 이벤트 복구를 하나의 선형 상태로 억지로 표현하지 않는다.

```text
capture_status
  created
    → capturing ⇄ capturing_offline
    → closed

audio_status
  missing
    → uploading
    → stored
    ↘ failed_retryable → uploading

processing_status
  pending
    → processing
    → ready
    ↘ failed_retryable → processing
```

`capturing ⇄ capturing_offline` 전이는 네트워크 상태에 따라 양방향으로 자동 발생하며 사용자 동작을 요구하지 않는다. 오프라인 상태에서 `closed`로 바뀌어도 미전송 이벤트는 로컬에 보존되고 재연결 시 업로드된다.

### State definitions

- `capture_status`: 필기 캡처의 생성·진행·오프라인·종료
- `audio_status`: 원본 오디오의 부재·업로드·보존·재시도
- `processing_status`: 전사·요약·manifest 처리의 대기·진행·완료·재시도

사용자에게 보이는 `READY`는 다음 조건의 파생 상태다.

```text
READY =
  capture_status == closed
  AND audio_status == stored
  AND 모든 canvas event가 서버 ACK됨
  AND transcript·timeline·summary·index manifest가 최종 확정됨
```

원본이 보존되어 있다면 단순 terminal `failed`로 끝내지 않고 `failed_retryable`과 실패 단계를 기록한다.

-----

## 10. Data Model

## 10.1 Session identity

`week`나 날짜만으로 세션을 식별하지 않는다. 휴강, 보강, 주 2회 수업을 처리하기 위해 `session_id`가 기본 키다.

```text
session_id
term
course_id
lecture_no
scheduled_at
capture_started_at
capture_ended_at
```

`week`는 사용자 표시와 검색 보조를 위한 파생 메타데이터다.

## 10.2 Markdown frontmatter

Markdown frontmatter에는 작은 세션 메타데이터만 저장한다.

```yaml
type: lecture
session_id: lec_20260901_csds_0900_01
course: data-structures
term: 2026-2
lecture_no: 3
week: 2
started_at: 2026-09-01T09:00:03+09:00
duration_ms: 5412032
status: ready
audio: ./_attachments/lectures/lec_20260901_csds_0900_01/audio.m4a
transcript: ./_attachments/lectures/lec_20260901_csds_0900_01/transcript.json
timeline: ./_attachments/lectures/lec_20260901_csds_0900_01/timeline.jsonl
canvas: ./_attachments/lectures/lec_20260901_csds_0900_01/canvas.json
```

## 10.3 Human-readable Markdown body

```markdown
## 12:40–18:12 레드블랙 트리의 균형 조건

루트 노드는 검은색이며, 삽입 후 부모와 삼촌 노드의 색상에 따라
재색칠 또는 회전으로 균형을 복원한다.

- 핵심 용어: recoloring, left rotation, uncle node
- 교수 강조: 삽입 예외 분기를 시험 전에 다시 볼 것
- 질문: 삼촌 노드가 검은색일 때 회전 순서는 어떻게 결정되는가?

[원음 재생](/lecture/lec_20260901_csds_0900_01/review?t=760000)
```

Markdown에는 현재 인증 origin에서 여는 애플리케이션 상대 HTTPS 경로를 저장한다. `xion://` 또는 `galpi://` 같은 custom scheme은 네이티브 캡처 앱이 실제 도입될 때만 검토한다.

## 10.4 Timeline sidecar

스트로크와 마커 이벤트는 JSONL 또는 SQLite에 둔다.

```json
{"seq":1042,"t_ms":420312,"type":"stroke","page_id":"page_03","stroke_id":"stroke_1042"}
{"seq":1043,"t_ms":427820,"type":"marker","marker":"question"}
{"seq":1044,"t_ms":431200,"type":"page_change","page_id":"page_04"}
```

## 10.5 Transcript sidecar

```json
{
  "language": "ko",
  "segments": [
    {
      "start_ms": 760000,
      "end_ms": 774000,
      "text": "부모 노드와 삼촌 노드가 모두 빨간색이면..."
    }
  ]
}
```

-----

## 11. Processing Pipeline

## 11.1 Ingest

1. 파일 MIME과 길이 검사
1. 오디오 해시 계산
1. 중복 업로드 확인
1. 원본 보존
1. 처리 작업 큐 등록

## 11.2 Transcription

우선순위는 다음과 같다.

1. Raspberry Pi 야간 배치 실측
1. 처리 시간이 부족하면 MacBook 로컬 워커 오프로드
1. 로컬 경로가 운영상 실패할 때만 외부 STT API 검토

과목별 전공 용어 목록을 `initial_prompt` 또는 해당 엔진의 동등한 문맥 입력으로 제공한다. 용어 목록은 볼트의 기존 과목 노트, 강의계획서, 교재 목차에서 추출할 수 있다.

## 11.3 Segmentation

고정 길이만으로 자르지 않고 다음 신호를 함께 사용한다.

- 긴 침묵
- 주제 전환 표현
- 필기 페이지 변경
- 중요·질문 마커
- 일정 최대 길이

권장 초기 구간 길이는 3~10분이다.

## 11.4 Structured summary bundle

원본 전사 전체는 기본 검색 인덱스에 넣지 않는다. 각 구간에서 다음 구조를 생성하고 이 묶음을 인덱싱한다.

```yaml
summary: 레드블랙 트리 삽입 후 균형 복원 과정
keywords:
  - 레드블랙 트리
  - recoloring
  - rotation
claims:
  - 루트 노드는 항상 검은색이다
  - 루트에서 리프까지 검은 노드 수는 동일하다
questions:
  - 삼촌 노드 색상에 따라 회전과 재색칠은 어떻게 달라지는가?
professor_emphasis:
  - 삽입 예외 분기를 시험 전에 다시 확인
source_range_ms: [760000, 1092000]
```

이 구조는 여전히 원본이 아니라 **요약·추출된 기억**만 인덱싱한다는 원칙을 지킨다. 동시에 서술형 요약 하나가 정확한 용어나 명제를 빠뜨리는 위험을 줄인다.

## 11.5 Question marker processing

`?` 마커가 발생하면 해당 시각의 전후 문맥을 별도 처리한다.

```text
marker time - 90 sec
→ marker time + 180 sec
→ 관련 전사 추출
→ 사용자의 당시 필기와 함께 질문 후보 생성
→ 시온 답변 생성
→ 근거 타임코드 연결
```

명확한 질문 문장이 필기에 없으면 질문을 임의로 확정하지 않고 `Review needed` 항목으로 남긴다.

## 11.6 Vault commit

처리가 완료되면 다음을 원자적으로 연결한다.

- Markdown 강의 노트
- 오디오
- 전사
- 타임라인
- 캔버스 데이터
- 검색 인덱스 문서

일부 파일만 저장된 상태에서 `READY`로 표시하면 안 된다.

전사·요약 산출물 manifest에는 다음 provenance를 기록한다.

```text
stt_engine
stt_engine_version
summary_model_id
prompt_sha256
parser_version
output_schema_version
```

모델 카탈로그의 자동 최신은 새 processing job의 기본값만 바꾼다. job이 시작되면 정확한 model ID를 snapshot하며, 이미 `READY`인 세션을 새 모델로 자동 재생성하지 않는다. 재처리는 별도 사용자 승인과 새 generation으로 수행한다.

-----

## 12. Retrieval and Review UX

## 12.1 Retrieval path

```text
사용자 질문
→ structured summary index 검색
→ 관련 구간 rerank
→ 원본 전사 구간 확인
→ 근거 기반 답변
→ 세션·타임코드 citation
```

검색은 요약 인덱스에서 시작하지만 최종 답변은 가능하면 원본 전사 구간을 다시 읽고 생성한다. 요약 내용을 근거 원문처럼 취급하지 않는다.

## 12.2 Review screen

복습 화면은 다음 영역을 제공한다.

- 오디오 플레이어
- 현재 구간 전사
- 현재 시각까지의 필기 캔버스
- 구간 요약
- 중요·질문 마커 타임라인
- 앞뒤 구간 이동
- 수동 동기화 오프셋 조정

## 12.3 Time-linked canvas reconstruction

**v1 결정: 정적 상태 복원만 구현한다.** 사용자가 `12:40`으로 이동하면 해당 시각까지의 이벤트를 일회 재생해 그 시점의 캔버스를 정적으로 그린다. 재생 진행에 따라 후속 획을 점진적으로 표시하는 애니메이션은 실사용에서 필요가 확인될 때만 추가한다(v1 범위 밖).

이 결정의 파급 효과: 8.3의 snapshot은 필수 기반이 아니라 성능 최적화(캐시)로 지위가 내려간다. v1에서는 세션 종료 시점 snapshot 1개로 시작하고, 정적 복원의 일회 replay가 실측에서 느릴 때만 중간 snapshot을 추가한다. 이벤트 소싱의 저장·복구 계층(8.1, 8.2, 8.4)은 데이터 생존을 위해 그대로 유지한다.

-----

## 13. API Draft

```text
POST /api/lecture/sessions
GET  /api/lecture/sessions/active
GET  /api/lecture/sessions/{session_id}
POST /api/lecture/sessions/{session_id}/events/batch
POST /api/lecture/sessions/{session_id}/audio
POST /api/lecture/sessions/{session_id}/sync-anchor
POST /api/lecture/sessions/{session_id}/finish
POST /api/lecture/sessions/{session_id}/retry
GET  /api/lecture/sessions/{session_id}/status
GET  /api/lecture/sessions/{session_id}/review
```

### Event batch request

```json
{
  "device_id": "ipad-chan-yong-01",
  "from_seq": 1000,
  "to_seq": 1100,
  "events": []
}
```

### Event batch response

```json
{
  "accepted_through_seq": 1100,
  "duplicate_event_ids": [],
  "server_received_at": "2026-09-01T09:20:04.120+09:00"
}
```

API는 재시도와 중복 전송을 전제로 멱등하게 설계한다.

`GET /status`는 단일 문자열 대신 `captureStatus`, `audioStatus`, `processingStatus`와 파생 `ready`를 모두 반환한다. 실패 시에는 어느 축의 어떤 단계가 재시도 가능한지도 함께 반환한다.

-----

## 14. Validation Plan and Acceptance Criteria

## Phase 0 — Audio and retrieval validation

**개발 없이 실제 강의 1~2개로 검증한다.**

### 작업

- 음성 메모 녹음
- 수동 업로드
- 전사
- 3~10분 구간 요약
- 구조화 요약 인덱싱
- 테스트 질문 작성

### 통과 기준

|항목                |목표              |
|------------------|---------------:|
|중요 전공 용어 식별       |90% 이상          |
|사전 작성 질문의 관련 구간 회수|20개 중 16개 이상    |
|검색 결과의 타임코드 정확도   |정답 발화 기준 ±30초 이내|
|강의당 수동 교정 시간      |5분 이하           |
|처리 완료 시점          |다음 강의 전         |

이 단계에서 전사 품질이나 검색 회수율이 낮으면 캔버스 개발을 시작하지 않는다.

## Phase 1 — Shortcut ingest

### 작업

- 세션 생성 API
- `Galpi Lecture Start`
- `Send Lecture to Galpi`
- 중복 업로드 방지
- 처리 상태 페이지

### 통과 기준

- 실제 녹음 5개 연속으로 올바른 세션에 연결
- 실패 후 재시도에서 파일 손실 없음
- 같은 파일 재공유 시 중복 처리 없음
- 시작부터 업로드까지 사용자의 필수 선택이 과도하지 않음

## Phase 1.5 — Web canvas spike

### 작업

- Pointer Events 입력
- Apple Pencil과 손가락 역할 분리
- IndexedDB 이벤트 저장
- 새로고침 복구
- 기본 지우개·실행 취소

### 통과 기준

- 30분 연속 필기에서 스트로크 유실 없음
- 새로고침 및 브라우저 재실행 후 복구
- 네트워크 차단 중에도 정상 기록
- 필기 지연이 실제 수업에서 거슬리지 않음
- 메모리 사용이 시간에 따라 비정상적으로 증가하지 않음

## Phase 2 — Full capture session

### 작업

- 90분 필기 세션
- 로컬 우선 동기화
- Sync 버튼+두드리기 기반 오프셋 계산
- 임펄스 탐지 실패 시 선택적 발화 구호
- 오디오 업로드와 세션 종료

### 통과 기준

- 90분 세션 데이터 손실 0건
- 동기화 오차 목표 ±5초, 허용 상한 ±10초
- 서버 장애 후 미전송 이벤트 자동 복구
- 잘못된 세션에 오디오가 연결되는 사고 0건

## Phase 3 — Differentiated review

### 작업

- 중요·질문 마커
- 타임코드 오디오 점프
- 해당 시각 필기 복원
- 질문 답변 파이프라인

### 통과 기준

- 검색 결과에서 두 번 이하의 동작으로 근거 원음 재생
- 질문 답변에 항상 세션과 타임코드 표시
- 마커 이벤트의 오탐 없음
- 사용자가 기존 음성 메모 검색보다 실제로 빠르다고 판단

## Phase 4 — Multi-week field test

최소 2~4주 동안 실제 수업에서 사용한다.

### 관찰 항목

- 녹음 시작 누락 빈도
- 음성 업로드를 미루는 빈도
- 웹 캔버스 사용 중 앱 전환 빈도
- 복습 기능의 실제 재사용률
- 눈 피로와 배터리 불만
- iPad에서 딴짓이 학습 흐름을 깨는 정도

이 데이터가 충분히 쌓인 뒤에만 e-ink 또는 네이티브 캡처 앱을 검토한다.

-----

## 15. Native and E-Ink Decision Gates

## 15.1 Native capture app trigger

다음 중 하나가 반복적으로 발생할 때만 네이티브 앱을 검토한다.

- 웹 캔버스 필기 지연이나 스트로크 누락이 수업을 방해한다.
- 음성 메모와 웹앱을 따로 시작하는 실수가 반복된다.
- 오디오와 필기의 동기화 오차가 허용 범위를 자주 넘는다.
- 오프라인 복구와 백그라운드 업로드가 웹에서 불안정하다.
- 네이티브 PencilKit이 제공하는 기능이 실제 핵심 요구로 확인된다.

검토하더라도 갈피 전체를 네이티브로 다시 만들지 않는다.

```text
Galpi Capture Native
- PencilKit
- audio recording
- unified session clock
- local database
- upload queue

Galpi Web
- transcription review
- summarization
- retrieval
- 시온 Q&A
- vault management
```

## 15.2 E-ink trigger

다음 문제가 몇 주간 계속될 때 Boox를 검토한다.

- 배터리 관리가 번거롭다.
- LCD 눈 피로가 수업 지속성을 낮춘다.
- iPad의 다른 앱이 집중을 반복적으로 깨뜨린다.
- 교재와 필기를 한 기기에서 장시간 사용해야 한다.

기기 구매는 파이프라인 검증보다 앞서지 않는다.

-----

## 16. Risks and Mitigations

### 16.1 Recording permission and policy

학교와 교수의 녹음 허용 범위를 확인한다. 기술 설계로 해결할 수 없는 정책 문제다.

### 16.2 Voice Memos start omission

**위험:** 사용자가 세션만 만들고 녹음 버튼을 누르지 않는다.  
**완화:** 시작 화면에 사용자 확인 체크, 수업 종료 시 오디오 미연결 경고, 시작 루틴을 홈 화면 위젯으로 고정한다.

### 16.3 Wrong audio attached

**위험:** 최근 녹음을 자동 추측하다 잘못된 파일을 올린다.  
**완화:** 공유 시트 입력을 기본으로 하고 파일명, 길이, 세션을 업로드 전에 표시한다.

### 16.4 Canvas data loss

**위험:** Safari 종료, 새로고침, 네트워크 장애로 필기가 사라진다.  
**완화:** IndexedDB 즉시 저장, 이벤트 ACK, snapshot, 복구 테스트를 기능보다 먼저 구현한다.

### 16.5 Summary-only retrieval blind spots

**위험:** 원본에는 있지만 요약에서 빠진 내용은 검색되지 않는다.  
**완화:** summary, keywords, claims, questions, professor emphasis를 함께 인덱싱하고 Phase 0에서 의도적으로 누락 사례를 수집한다.

### 16.6 Synchronization drift

**위험:** 음성 메모와 캔버스 시작 시간이 달라 필기와 발화가 어긋난다.  
**완화:** Sync 버튼+두드리기 기반 오프셋, 임펄스 탐지 실패 시 선택적 발화 구호, 수동 보정 UI, 메타데이터 검증, 세션 내부 단조 증가 시간 사용.

### 16.7 Web audio interference

**위험:** 캡처 웹앱의 오디오 재생이 음성 메모 녹음에 영향을 준다.  
**완화:** `CAPTURING` 상태에서는 TTS, 자동 재생, 효과음, 복습 플레이어를 비활성화한다.

### 16.8 Processing speed

**위험:** Raspberry Pi가 90분 강의를 제때 처리하지 못한다.  
**완화:** Pi 벤치마크 후 MacBook 로컬 워커 오프로드. 처리 위치는 캡처 UX와 분리한다.

### 16.9 Gesture recognition false positives

**위험:** 손글씨 별표나 물음표를 잘못 인식한다.  
**완화:** 첫 버전은 명시적 마커 버튼만 사용하고, 스트로크 데이터를 모은 뒤 선택 기능으로 확장한다.

### 16.10 Storage growth and backup

**위험:** 압축 설정 기준 90분 녹음은 강의당 대략 수십 MB로 예상되며(첫 녹음에서 실측할 것), 주당 여러 강의 × 한 학기면 수 GB가 파이 SD카드에 쌓인다. SD카드는 수명이 짧고 백업 없는 단일 장애점이다.  
**완화:** 오디오 원본은 수신 즉시 저용량 재인코딩(예: 64kbps mono) 보관을 기본으로 검토. 백업은 두 계층으로 분리한다 — 볼트의 텍스트 자산(Markdown, 요약, 타임라인)은 기존 볼트 백업 경로에 포함하고, 오디오는 외장 SSD 또는 맥북으로 주기 오프로드한다. 학기 종료 시 오디오 보존 정책(원본 유지 / 저음질 아카이브 / 삭제)을 정하고, `READY` 판정은 백업 여부와 무관하게 원본 보존 확인을 전제로 한다.

-----

## 17. Implementation Order

1. 실제 강의 오디오로 전사·검색 품질 측정
1. 세션·오디오 ingest API
1. 두 개의 핵심 단축어
1. 구조화 요약 스키마와 볼트 writer
1. 웹 캔버스 기술 스파이크
1. IndexedDB와 복구 로직
1. 90분 전체 캡처 테스트
1. Sync 버튼+두드리기 기반 오프셋 계산
1. 타임코드 복습 화면
1. 중요·질문 마커
1. 다주간 실사용 평가
1. 필요한 경우에만 네이티브 또는 e-ink 검토

이 순서는 보기 좋은 캔버스보다 데이터 생존과 검색 가치를 먼저 검증한다.

### 17.1 중앙 로드맵 위치

- Phase 0은 개발 없이 지금 진행할 수 있다.
- Phase 1은 [단일 GPT·모델 라우팅](chat-model-routing-design.md)과 일반 첨부 U0의 인증 업로드 패턴이 안정된 뒤, V5-B 구현 전에 진행할 수 있다.
- Phase 1.5~4의 캔버스·전체 캡처·field test는 V5-B 시작 전에 마치거나, V5-B `PAPER_AUTONOMOUS`의 장기 관찰 기간과 병행할 수 있다.
- 강의와 거래 시스템은 DB, worker queue, scheduler budget, API cost ledger를 공유하지 않는다. Pi CPU·저장량 상한만 전역 운영 정책에서 함께 조정한다.

권장 순서:

```text
V4.5-M 단일 GPT
→ Attachment U0/U1
→ Lecture Phase 0/1
→ Lecture canvas
→ V5-B 시작 또는 PAPER 관찰과 Lecture field test 병행
```

-----

## 18. Non-Goals for Initial Release

- App Store 또는 TestFlight 배포
- 무료 계정 IPA를 매주 재서명하는 운영
- 화자 분리
- 실시간 전사
- 강의 중 실시간 AI 답변
- 완전한 손글씨 OCR
- 복잡한 도형 자동 인식
- 협업 필기
- 제조사 수준의 범용 노트 앱 기능
- 원본 전사 전체의 기본 벡터 인덱싱

초기 버전의 목표는 범용 필기 앱이 아니라 **시간이 연결된 신뢰성 높은 개인 강의 캡처 시스템**이다.

-----

## 19. Final Product Definition

갈피 강의 노트의 초기 완성형은 다음과 같다.

```text
[홈 화면: Galpi Lecture Start]
             ↓
[Apple Voice Memos] + [Galpi Web Canvas]
             ↓
[Share → Send Lecture to Galpi]
             ↓
[STT → Structured Summary → Index → Vault]
             ↓
[시온 Q&A → Timestamped Evidence → Audio + Notes]
```

최종 판단 기준은 기능 개수가 아니다.

> 사용자가 기억이 흐릿한 강의 내용을 검색했을 때, 몇 초 안에 정확한 설명과 당시 필기로 돌아갈 수 있는가?

이 질문에 안정적으로 “그렇다”고 답할 수 있을 때 갈피 강의 노트의 핵심 가치는 검증된 것이다.
