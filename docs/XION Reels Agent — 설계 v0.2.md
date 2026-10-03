# XION Reels Agent — 설계 v0.2

> 목적: 기술·하드웨어 뉴스를 계기로, 그 밑에 깔린 원리를 짧은 애니메이션 릴스로 설명한다. 성격: 수익이 아니라 **재미**가 목적인 개인 프로젝트. 단계를 넘어갈 때만 갱신한다. v0.2(2026-10-02)는 0단계(4편 제작)를 마치고 1단계 착수 전에 정리한 판이다.

## 0. 결정 요약

1. 갈피 산하의 **릴스 에이전트**로 만든다. 갈피의 첫 **라이브 액션**(외부 공개 행동) 에이전트가 된다.
2. 사람 검토는 **두 번**: 검토 1(주제 고르기), 검토 2(완성 영상 확인).
3. **2단계까지는 업로드가 없다.** 외부 행동은 3단계에서만 켠다.
4. 애니메이션은 **Manim + 템플릿**. 제작 에이전트는 공용 모듈(`reels/templates/`·`style.py`·`mascot.py`·`timeline.py`·`sound.py`) 위에 편 전용 장면(`scene.py`·`art.py`)만 만든다. 공용 모듈을 처음부터 다시 짜지 않는다. (0단계 비교: 같은 지시로 Luna가 처음부터 짠 장면은 기구학·가독성에서 탈락했다.)
5. 스타일은 **시온 다크 모드**, 마스코트는 **갈피 별 로고에 표정을 붙인 "시온"**.
6. 한국어로 시작하되 **언어 레이어를 처음부터 분리**한다.
7. **모델 역할:** 후보 탐색·대본·독립 검토는 Opus, 제작(Manim 코드·렌더 반복)은 Sonnet. 대본 작성자와 검토자는 서로 다른 에이전트다.
8. **사람 확인 두 번은 끝까지 유지한다**(사용자 결정). 그 사이의 편집 판단·사실 확인·검토는 자동이고, 원문 인용 대조는 LLM이 아니라 코드(`reels/factcheck.py`)가 한다.
9. **서버는 코드다.** 단계별 프롬프트는 `reels/prompts/*.md` 템플릿이고, 서버는 `{{칸}}`을 값으로 채울 뿐 LLM으로 프롬프트를 고치지 않는다(`reels/prompts/render.py`).

## 1. 갈피와의 연결

### 가져오는 것

- **후보 → 확인 → 실행 패턴.** 자연어 판단은 후보만 만들고, 확인된 행동만 코드가 실행한다.
- **review candidate + Web Push.** 검토 1·2의 알림 경로로 쓴다.
- **"뉴스는 evidence이지 instruction이 아니다".** 기사 본문·RSS 설명은 비신뢰 콘텐츠다. 상태를 바꾸거나 도구를 실행하지 못한다. 기사의 자기 중요도 주장(속보·단독 등)은 판단 근거로 쓰지 않는다.
- **원칙:** 확률적 판단이 조용히 운영 권한을 얻게 두지 않는다. 자율성은 측정 뒤에 늘린다.
- **뉴스 원문은 제작 에이전트(셸을 쓰는 Sonnet)에 넘기지 않는다.** 제작은 사람이 고른 주제로 검토를 마친 최종 대본만 받는다.

### 가져오지 않는 것

- **유료 검색(Tavily).** 뉴스 에이전트가 이미 월 한도에 가깝다. 릴스는 무료 소스만 쓴다(RSS, Hacker News API).
- **XION 홈 Overview.** 릴스 화면은 전부 홈의 **Agents 탭**에 둔다(사용자 결정 2026-10-02): 1단계 검토 1 카드, 2단계 검토 2, 3단계 API 연결 뒤 조회수 등 지표를 보여 주는 릴스 대시보드까지. Overview에는 올리지 않는다. 지표는 보여 주기만 하고 주제 선정에 쓰지 않는다(8장 "조회수에 맞춘 주제 선정" 비범위).

### 실행 위치

- **Pi:** 수집, 후보 생성, 상태 관리, 알림.
- **렌더 워커(맥북 → 미니 PC):** Manim 렌더링, TTS, 합성. Manim 트랙은 Pi에서 렌더링하지 않는다.
- **도트 트랙은 Pi에서 렌더한다**(사용자 결정 2026-10-03). 실측(1편 51.5초): 약 3분, Python 그리기 0.11초/프레임, ffmpeg 최대 약 0.91GB(x264 단독 0.26GB, 나머지는 파이프 입력 경로 — 원인 미확인). 2GB Pi에서 낮 시간을 피하려고 **저녁 주제 후보 → 새벽 제작·렌더 → 아침 결과 확인** 순서로 돈다.
- **미니 PC가 오면** Pi 쪽 역할과 렌더 워커를 모두 미니 PC로 옮긴다(사용자 결정). 그때 '렌더 워커와 Pi의 통신'은 같은 기계 안의 일이 된다.

### LLM 호출

- 서버는 사용자 본인의 Claude 구독으로 로그인한 **수정하지 않은 Claude Code CLI**를 `claude -p` 하위 프로세스로 실행하고 결과만 받는다(Pi의 host Codex와 같은 방식). OAuth 토큰을 읽거나 SDK로 직접 쓰지 않는다 — Claude Code 문서의 "developers may not collect, store, or intermediate Claude.ai credentials or session tokens". 로그인은 사용자가 Anthropic 흐름으로 직접 한다.
- 근거: 같은 문서의 "Advertised usage limits for Pro and Max plans assume ordinary, individual usage of Claude Code and the Agent SDK." 개인 한 명이 자기 기계에서 쓰는 갈피는 이 범위로 해석한다(해석이며, Anthropic은 사전 통보 없이 제한할 수 있다고 적었다). 막히면 API 키로 바꾼다.
- **후보 탐색 호출에는 도구를 주지 않는다.** 수집은 코드가 하고, 모델은 수집 목록을 받아 카드 JSON만 돌려준다. 기사에 숨은 지시가 있어도 실행할 도구가 없다.

## 2. 콘텐츠 규칙

### 난이도 범위

- **바닥:** 기어비에 따라 토크가 왜 달라지나
- **천장:** CPU는 왜 미리 추측해서 실행하고, 그 흔적이 어떻게 새나
- 개념은 하나, 그림 한 장으로 설명 가능, 고등학교 물리·컴퓨터 상식으로 따라올 수 있을 것.

### 주제 기준 (후보 생성 프롬프트에 넣는다)

- 60\~120초 안에 그림으로 설명할 개념이 있다. 늘어난 시간은 새 개념이 아니라 같은 개념의 깊이(왜, 숫자, 한계)에 쓴다.
- 며칠 안에 나온 뉴스다. (단, 개념 자체는 오래가도 된다.)
- 기존 템플릿 중 하나에 맞는다.
- 투자 유치·출시 발표처럼 기술 내용이 없는 뉴스는 제외한다.

### 지켜야 할 것

- 출처는 원문 링크. 기사 문장·사진·영상을 그대로 쓰지 않는다. 내용은 우리 말로.
- 보안 주제는 **무슨 일이 있었고, 원리가 뭐고, 어떻게 막는지**까지. 따라 할 수 있는 공격 방법은 다루지 않는다.
- 제조사 주장은 "제조사 설명으로는"을 붙인다.
- 남의 캐릭터·로고·영상을 쓰지 않는다. (`Xion_pet`, Claude Code 펫 에셋 사용 금지)

## 3. 상태와 데이터

```
candidate ─(검토1 선택)→ selected → scripted → rendered ─(검토2 승인)→ approved → archived
     │                                              │                       │
     └─(거절/만료)→ dropped                          └─(수정 요청)→ scripted   └─(3단계) published
```

| 테이블 | 핵심 필드 |
| --- | --- |
| `reels_candidates` | id, 뉴스 제목, 출처 URL, 수집 시각, 핵심 개념, 왜 흥미로운지(1줄), 템플릿 후보, 훅 초안, 상태 |
| `reels_episodes` | id, candidate_id, 언어, 대본, 장면 목록(JSON), 렌더 경로, 상태, 검토 기록 |
| `reels_claims` | episode_id, 주장 문장, 출처 URL, 출처 근거 문장, 확인 여부 |

`reels_claims`가 검토 2의 팩트체크 화면을 만든다. 대본에서 사실 주장이 들어간 문장마다 한 행씩 생긴다. 행은 최종 대본의 사실 확인 표에서 오고, `reels/factcheck.py`가 행마다 그 행의 출처 원문에 인용이 글자 그대로 있는지 대조한 결과를 `확인 여부`로 남긴다.

1단계는 `reels_candidates`만 만든다. `selected` 이후 상태와 나머지 두 표는 2단계에서 연다.

## 4. 검토 게이트

### 검토 1 — 주제 고르기 (목표 1\~2분)

- 하루 1회 19:00 KST, 후보 3개를 카드로 Push.
- 카드: 뉴스 제목 · 출처 링크 · 왜 흥미로운지 1줄 · 핵심 개념과 **뉴스 → 기반 기술 연결** · 템플릿 · 훅 초안 · 위험·불확실
- 후보는 뉴스 자체가 아니라 그 밑의 기반 기술을 제안한다. 이 판단이 후보 탐색에 Opus를 쓰는 이유다.
- 행동: **하나 선택** / **전부 거절** / **보류**

### 검토 2 — 완성 영상 확인

- 영상 + 대본 + `reels_claims` 목록(주장 ↔ 출처 문장 나란히)
- 행동: **승인** / **수정 요청**(장면 또는 문장 단위) / **폐기**
- 2단계까지 "승인"은 보관(archived)만 한다.
- **사람 검토 → 바로 수정 파이프라인(사용자 요청 2026-10-03, 꼭 만든다).** 사용자가 검토 2에서 남긴 의견(장면·시각·문장 단위, 자유 문장)을 서버가 장면별 수정 요청으로 정리해 제작 에이전트에 넘기고 → 그 장면만 다시 렌더 → 자동 시각 검토 → 다시 검토 2로 돌아온다. 0단계 동안 대화로 하던 "이거 고쳐줘 → 다시 렌더 → 확인" 루프를 그대로 자동화하는 것이다. 수정 요청과 결과는 편 기록에 남긴다(사실 수정 수·검토 시간 측정과 같이).
- 사람 검토 2 앞에 **자동 시각 검토**(독립 Opus, 장면별 프레임 시트 + 대본 + 체크리스트: 주인공 그림 크기, 글자 가독성, 대본·그림 일치, 라벨 가림)와 수정 1회를 둔다. 코드로 잴 수 있는 것(팔레트, 픽셀 크기, 주인공 그림 크기 하한)은 검사기가 먼저 잡는다.

## 5. 영상 규격과 템플릿

- 세로 9:16, 1080×1920, 60\~120초(4편부터; 1\~3편은 30\~45초 버전으로 남긴다), 존댓말(해요체), TTS 목소리는 하나로 고정.
- **한 화면(자막 카드 한 장)은 공백 빼고 22자 이하**(사용자 결정 2026-10-03, 5편부터). 카드는 두 줄·줄당 한글 약 14자인데, 줄을 뜻 단위로 고르게 끊으면 24자부터 안 들어가는 문장이 생긴다(1\~4편 실측: 23자 이하는 전부 한 장). 넘는 문장은 ` / `로 뜻 단위에서 끊거나 문장을 줄인다. 설명이 길어져도 한 화면 글자 수는 늘리지 않는다.
- TTS는 edge-tts `ko-KR-SunHiNeural`, 속도 `+16%`로 고정한다(2026-10-02 귀로 비교해 결정, +13%에서 올림; GPT TTS는 품질·비용에서 탈락). edge-tts는 비공식 경로라 3단계 게시 전에 이용 조건을 다시 확인하고, 막히면 로컬 MeloTTS(MIT)를 대안으로 잰다.

### 템플릿 v1

| 템플릿 | 용도 |
| --- | --- |
| 훅 카드 | 첫 장면 = 썸네일. 역설 한 줄 + 영어 용어 크게 + 한국어 부제 + 그림 하나 |
| 비교 | 전후·크기·속도 비교 |
| 단계 | 순서대로 일어나는 일 (기어 회전, 공정) |
| 단면도 확대 | 겉에서 안으로 들어가며 구조 보여주기 |
| 흐름 화살표 | 데이터·열·힘이 흘러가는 경로 |

다섯 개 모두 `reels/templates/`에 있다(흐름 화살표는 3편에서 추가). 잠금/해제, 타임라인, 공정 단계는 필요해지면 추가한다.

### 시간과 소리

- **장면 시간은 실제 음성 길이가 정한다.** 편마다 `narration.<lang>.json`(문장)과 `scenes.json`(장면 순서·최소 길이) → `reels/tts.py` → `timeline.json`과 자막(`subtitles.<lang>.ass`, 생성물). 장면 안 연출은 문장 시작에 묶는다(`TimedScene.when`).
- **배경음악은 넣지 않는다.** 효과음은 박자에만 — 장면의 첫 그림, 마스코트 지목·결론, 위험 표시 — 그리고 대본이 정한 **뜻 있는 소리**(소리가 개념을 들려주는 순간, 한 편에 1\~2개: 끓음 = 보글보글, 톱니 3개 = 딸깍 3번). 효과음 사이 최소 3초. 점선 그리기·단계 칩처럼 반복되는 연출에는 달지 않는다(짧은 간격 반복이 거슬렸다).
- 소리 파일은 CC0(Kenney, 라이선스 파일 동봉) 또는 `reels/sfx/`의 합성 코드로만 만든다. 표는 `reels/sound.py` 한 곳이다.

### 언어 레이어

- 애니메이션 안의 글자는 최소화. 용어는 영어(예: HARMONIC DRIVE).
- 한국어 설명은 그림이 아니라 **자막 레이어**. 자막은 대본에서 생성한다.
- 자막 파일과 TTS만 바꾸면 다른 언어판이 렌더링되는 구조로 만든다.

## 6. 스타일

| 용도 | 토큰 | 색 |
| --- | --- | --- |
| 배경 | `--bg`(다크) | #151A18 |
| 강조(용어, 선) | `--brand-ink`(다크) | #7FB99F |
| 깊은 강조(채움) | `--brand` | #2F6B57 |
| 본문 글자 | `--ai-text`(다크) | #E7EDE9 |
| 부제, 라벨 | `--label`(다크) | #A8B4AD |
| 대비 강조(가끔) | `--council` | #7C6FCD |
| 위험, 오류 | `--danger` | #FF3B30 |

카드 모서리와 얇은 구분선은 시온 UI를 따른다.

### 마스코트 "시온" (공개 표기 Sion)

- 몸: `public/lib/icons/Xion/xion-mark.svg`의 별 경로 그대로. 몸 색 #7FB99F.
- 표정: **기본 · 놀람(훅 장면) · 가리키기(위쪽 긴 꼬리로 핵심 지목) · 반짝임(결론 장면, 살짝 커졌다 작아짐)**
- 폰 화면에서 읽히도록 눈은 넉넉하게 크게.

## 7. 단계

| 단계 | 하는 일 | 외부 행동 | 다음 단계 조건 |
| --- | --- | --- | --- |
| 0 | 갈피 없이 손으로 제작 (AI로 대본·Manim 받아 다듬기) | 없음 | **완료 2026-10-02:** 4편 제작, 템플릿 v1 다섯 개, 4편은 프롬프트 템플릿만으로 손수정 없이 끝까지 |
| 1 | RSS/HN 수집(코드) → Opus 1회 호출로 후보 3개 → Push → 검토 1 (갈피 `lib/reels/`, 기본 꺼짐) | 없음 | 2주 운영, 후보에서 고를 만한 게 꾸준히 나옴 |
| 2 | 렌더 워커 + 검토 2, 승인 영상은 보관 | 없음 | 10편 보관, 1편당 검토 시간과 사실 수정 수가 안정 |
| 3 | 검토 2 승인 → 공식 API로 게시 | **게시** | — |

### 편마다 기록할 것

사실 수정 수 · 새 템플릿이 필요했는지 · 검토 두 번에 든 시간 · 재미(내가 다시 보고 싶은가, 1\~5) · 단계별 토큰(0단계 실측: 대본·검토·제작 합계 약 40\~51만, 후보 탐색 에이전트 방식 약 12만)

### 3단계 준비물 (지금은 하지 않음)

- 인스타그램 프로페셔널 계정. API 게시는 24시간에 50개 한도.
- 공개 임시 저장소. API는 영상을 공개 URL에서 가져가고, Pi는 Tailscale 비공개다.
- 토큰 보관 위치와 권한 범위 최소화.
- 팔로워 1,000명 이후 Meta AI 번역(한국어 → 영어) 시험.

## 8. 비범위

확인 없는 자동 게시 · 남의 영상·이미지 사용 · 유료 검색 · 댓글 자동 응답 · 여러 계정 운영 · 수익화 · 조회수에 맞춘 주제 선정

## 9. 열린 질문

- 렌더 워커와 Pi의 통신 방식 (미니 PC 통합이면 사라진다)
- 1일 1편이 구독 사용량 한도 안에 드는지 (2단계에서 잰다)
- 계정 핸들
- **유튜브 쇼츠 동시 게시**(사용자 2026-10-03): 같은 파일을 올린다. API 업로드 프로젝트 검수(미검수면 비공개 고정이라고 알고 있음)·업로드 할당량·썸네일 기준을 3단계 전에 공식 문서로 확인한다.

## 부록 — 1편 대본: 하모닉 드라이브

**훅 카드:** 톱니 두 개 차이로, **힘이 100배가 된다** / HARMONIC DRIVE / 하모닉 드라이브

| 시간 | 화면 (템플릿) | 내레이션 |
| --- | --- | --- |
| 0–5초 | 훅 카드, 로봇 관절 강조 | 휴머노이드 로봇 부품값의 절반 가까이가 관절이래요. |
| 5–10초 | 빠른 모터 → 느리고 강한 관절 (비교) | 모터는 빠르지만 힘이 약해요. 그래서 기어로 속도를 줄이고 힘을 키우죠. |
| 10–15초 | 기어 여러 단이 쌓이며 커짐 (단계) | 그런데 100배로 줄이려면 보통 기어로는 여러 단을 겹쳐야 해서, 크고 무거워져요. |
| 15–25초 | 부품 세 개 등장 (단면도 확대) | 하모닉 드라이브는 부품이 세 개뿐이에요. 타원 모양 캠, 그 위에서 휘는 얇은 톱니 컵, 바깥의 단단한 톱니 링. 안쪽 톱니가 바깥보다 딱 두 개 적어요. |
| 25–35초 | 캠 한 바퀴, 컵은 반대로 두 칸 (단계) | 캠이 한 바퀴 돌면, 안쪽 컵은 반대 방향으로 톱니 두 칸만 움직여요. |
| 35–45초 | 200 ÷ 2 = 100 (비교), 시온 반짝임 | 톱니 200개 중에 두 칸이니까 100분의 1. 한 단만으로 100배 감속이에요. 그래서 좁은 로봇 관절에 딱 맞죠. |

### 사실 확인 목록

1. 액추에이터가 휴머노이드 부품 원가의 약 50% (Schaeffler 기준, humanoid.guide)
2. 부품 세 개: 웨이브 제너레이터, 플렉스플라인, 서큘러 스플라인 / 플렉스플라인 톱니가 두 개 적음 (Harmonic Drive 공식 설명)
3. 웨이브 제너레이터 한 바퀴 → 플렉스플라인 반대 방향 톱니 두 개 (Harmonic Drive 공식 설명)
4. 202개/200개 → 100:1, 서큘러 스플라인 고정·웨이브 제너레이터 입력·플렉스플라인 출력 기준 (Wikipedia "Strain wave gearing")
5. "여러 단을 겹쳐야 한다"는 일반 원리 — 직접 확인

## 부록 — 2편 대본: 투기적 실행

**훅 카드:** **답을 알기도 전에, 먼저 해 버린다** / SPECULATIVE EXECUTION / 투기적 실행

| 시간 | 화면 (템플릿) | 내레이션 |
| --- | --- | --- |
| 0–4초 | 훅 카드. 갈림길 한쪽으로 블록이 먼저 출발, 시온 놀람 | CPU는 답이 나오기도 전에, 다음 일을 먼저 해요. |
| 4–11초 | `WAIT` vs `GUESS` 카드 (비교). 키커 `BRANCH ?`. WAIT 카드는 멈춘 블록 + `100s OF CYCLES`, GUESS 카드는 달리는 블록 | 갈 길을 정할 값이 메모리에서 오기까지, 수백 클럭이 걸리기도 해요. 기다리면 그동안 놀게 되죠. |
| 11–15초 | 칩 `SAVE` → `GUESS + RUN` → `CHECK` (단계). 무대: 갈림길에서 상태 스냅샷 → 한쪽 길로 블록 진행 → 값 도착, `CHECK` 점등 | 그래서 상태를 저장해 두고, 한쪽 길을 골라 미리 실행해요. |
| 15–23초 | `RIGHT` vs `WRONG` 카드 (비교). RIGHT: 블록 유지 `KEEP`. WRONG: 블록이 지워지고 `UNDO`, 아래 `≈ WAIT`. 시온 가리키기로 `≈ WAIT` 지목 | 값이 와서 맞았으면 시간을 번 거고, 틀렸으면 저장한 상태로 되돌려요. 손해는 기다린 것과 비슷할 뿐이에요. |
| 23–27초 | 칩 그림에서 한 칸이 커지며 `BRANCH PREDICTOR`, 그 아래 지난 갈림길 기록 점 줄 (단면도 확대) | 추측은 지난 기록을 보고 하는데, 거의 다 맞혀요. |
| 27–40초 | 칩 `WRONG PATH` → `CACHE TRACE` → `FIX` (단계). 키커 `SPECTRE 2018`. 무대: 칩 옆 `CACHE` 상자 등장 → 틀린 길의 블록은 지워지는데 `CACHE` 상자에 점 하나가 `--danger` 색으로 남음 → 마지막에 갈림길 위험 구간에 막대(차단) | 그런데 빠른 저장소인 캐시에는, 되돌려도 흔적이 남아요. 2018년 Spectre 연구는 이 흔적으로 비밀을 읽어냈어요. 막는 방법 하나는, 위험한 자리에서 추측을 멈추는 거예요. |
| 40–45초 | `IDLE` vs `SPECULATE` 타임라인 막대 (비교, 수치 없는 도식), 시온 반짝임 | 놀지 않으려고 미리 추측하기, 요즘 CPU가 빠른 비결 중 하나예요. |

자막은 1편처럼 문장 단위로 쪼갠다. 화면 글자는 `SPECULATIVE EXECUTION`, `BRANCH`, `WAIT`, `GUESS`, `SAVE`, `CHECK`, `RIGHT`, `WRONG`, `KEEP`, `UNDO`, `BRANCH PREDICTOR`, `WRONG PATH`, `CACHE`, `CACHE TRACE`, `SPECTRE 2018`, `FIX`, `IDLE`, `SPECULATE`, `100s OF CYCLES`, `≈`, `?` 만 쓴다. Spectre 장면에 캐시 흔적을 읽는 관찰자·측정 화살표는 그리지 않는다(보안 규칙).

### 사실 확인 목록

출처 약칭 — **[Spectre]** Kocher et al., "Spectre Attacks: Exploiting Speculative Execution", https://spectreattack.com/spectre.pdf · **[Lin-Tarsa]** Lin & Tarsa (Intel), "Branch Prediction Is Not A Solved Problem" (2019), https://arxiv.org/abs/1906.08170 · **[PZ]** Google Project Zero, "Reading privileged memory with a side-channel", https://googleprojectzero.blogspot.com/2018/01/reading-privileged-memory-with-side.html

인용은 원문 텍스트층에서 그대로 복사했다(PDF 하이픈 줄바꿈만 이어 붙임). 아포스트로피는 원문대로 `’`(U+2019)다. 한 행에 인용이 둘 이상이면 각각 원문에 따로 있다.

| # | 주장 (대본 문장) | 출처 | 원문 인용 |
| --- | --- | --- | --- |
| 1 | CPU는 답이 나오기도 전에 다음 일을 먼저 한다 | [Spectre] Abstract https://spectreattack.com/spectre.pdf | "if the destination of a branch depends on a memory value that is in the process of being read, CPUs will try to guess the destination and attempt to execute ahead." |
| 2 | 갈 길을 정할 값이 메모리에서 오기까지 수백 클럭이 걸리기도 한다 | [Spectre] §I https://spectreattack.com/spectre.pdf | "an uncached value located in external physical memory. As this memory is much slower than the CPU, it often takes several hundred clock cycles before the value becomes known." |
| 3 | 기다리면 그동안 논다 | [Spectre] §I https://spectreattack.com/spectre.pdf | "Rather than wasting these cycles by idling" |
| 4 | 상태를 저장해 두고 한쪽 길을 골라 미리 실행한다 | [Spectre] §I https://spectreattack.com/spectre.pdf | "saves a checkpoint of its register state, and proceeds to speculatively execute the program on the guessed path." |
| 5 | 값이 오면 맞았는지 확인한다 | [Spectre] §I https://spectreattack.com/spectre.pdf | "When the value eventually arrives from memory, the CPU checks the correctness of its initial guess." |
| 6 | 맞았으면 시간을 번 것이다 | [Spectre] §I https://spectreattack.com/spectre.pdf | "if the guess was correct, the speculative execution results are committed" / "useful work was accomplished during the delay." |
| 7 | 틀렸으면 저장한 상태로 되돌리고, 손해는 기다린 것과 비슷하다 | [Spectre] §I https://spectreattack.com/spectre.pdf | "If the guess was wrong, the CPU discards the incorrect speculative execution by reverting the register state back to the stored checkpoint, resulting in performance comparable to idling." |
| 8 | 추측은 지난 기록을 보고 한다 | [Spectre] §II-E https://spectreattack.com/spectre.pdf / [Lin-Tarsa] §I https://arxiv.org/abs/1906.08170 | "they maintain state that depends on past program behavior and assume that future behavior is similar to or related to past behavior." / "BPUs work by training statistical models of branch directions observed as instructions are retired, and then using these models to predict unresolved directions for subsequent branches as they are fetched." |
| 9 | 거의 다 맞힌다 | [Lin-Tarsa] Abstract https://arxiv.org/abs/1906.08170 | "Modern branch predictors predict the vast majority of conditional branch instructions with near-perfect accuracy" |
| 10 | Spectre는 2018년에 공개됐다 | [PZ] https://googleprojectzero.blogspot.com/2018/01/reading-privileged-memory-with-side.html | 게시일 "2018-Jan-03" / "their [writeups/blogposts/paper drafts] are at:" 다음 목록의 "Spectre (variants 1 and 2)" / "We have discovered that CPU data cache timing can be abused to efficiently leak information out of mis-speculated execution" |
| 11 | 되돌려도 캐시에는 흔적이 남는다 | [Spectre] §I-B https://spectreattack.com/spectre.pdf | "When the result of the bounds check is eventually determined, the CPU discovers its error and reverts any changes made to its nominal microarchitectural state. However, changes made to the cache state are not reverted" |
| 12 | 그 흔적으로 비밀을 읽어냈다 | [Spectre] §I-A https://spectreattack.com/spectre.pdf / [PZ] | "Using this technique, we are able to read memory from the victim’s address space, including the secrets stored within it." / (캐시 흔적과의 연결은 10번 [PZ] 세 번째 인용) |
| 13 | 막는 방법 하나는 위험한 자리에서 추측을 멈추는 것이다 | [Spectre] §VII-A https://spectreattack.com/spectre.pdf | "speculation blocking instructions that ensure that instructions following them are not executed speculatively. Intel and AMD recommend the use of the lfence instruction" / "An improved approach is to use static analysis [36] to reduce the number of speculation blocking instructions required, since many code paths do not have the potential to read and leak out-of-bounds memory." |
| 14 | 미리 추측하기는 CPU가 빠른 비결 중 하나다 | [Spectre] §I https://spectreattack.com/spectre.pdf / [Lin-Tarsa] §I https://arxiv.org/abs/1906.08170 | "speculative execution, which is widely used to increase performance" / "BPU predictions drive speculative execution, a key technique for hiding latency in out-of-order CPUs." |
| 15 | 캐시는 (CPU가 쓰는) 빠른 저장소다 | [Spectre] §II-D https://spectreattack.com/spectre.pdf | "To bridge the speed gap between the faster processor and the slower memory, processors use a hierarchy of successively smaller but faster caches." |

화면 전용 표기 `100s OF CYCLES`는 2번, `≈ WAIT`는 7번, `CACHE`는 15번, `SPECTRE 2018`은 10번에 묶인다. 마지막 장면의 `IDLE` vs `SPECULATE` 막대는 수치가 아닌 도식이므로 길이 비율을 실측값처럼 보이게 그리지 않는다.

## 부록 — 3편 대본: 자연 순환

**훅 카드:** **펌프 없이, 물이 혼자 돈다** / NATURAL CIRCULATION / 자연 순환

| 시간 | 화면 (템플릿) | 내레이션 |
| --- | --- | --- |
| 0–7초 | 훅 카드. 용기 단면 안에서 고리가 돈다. 키커 `BWRX-300`, 시온 놀람 | 노심의 물을 펌프 없이 돌리는 소형 원자로, BWRX-300이 미국에서 첫 건설 허가를 받았어요. |
| 7–13초 | `FORCED` vs `NATURAL` 카드 (비교). 두 카드 모두 같은 사각 고리(가운데 위로, 바깥 아래로)가 흐른다. FORCED는 내려가는 줄 위에 `PUMP` 상자를 두고 화살표가 거기서 밀려 나간다. NATURAL은 같은 자리에 점선 빈 상자 `NO PUMP`를 두고 화살표는 그대로 돈다 | 끓는 물 원자로는 대부분 펌프로 물을 밀어 돌려요. 그런데 여기선 물이 스스로 돌아요. |
| 13–18초 | 흐름 화살표 ① 상승. `rise`만 켠다. `CORE`에서 LIGHT 색 화살표가 위로 가고, 노심 중간부터 `CHIMNEY` 안에 기포(빈 원)가 섞여 올라간다 | 노심에서 데워진 물은 끓어서 증기가 섞이고, 가벼워져서 위로 올라가요. |
| 18–28초 | 흐름 화살표 ② 분리·하강. `steam_out` → `down_left`·`down_right` → `fw_in` 순서로 켠다. 범례 `LIGHT`/`HEAVY`가 나타난다 | 증기는 위에서 빠져나가 터빈을 돌리고, 남은 물은 새로 들어온 물과 섞여 바깥 통로로 내려와요. 증기가 없는 물은 무거워서 가라앉죠. |
| 28–35초 | 흐름 화살표 ③ 높이. 한 바퀴 흐른 뒤 `highlight(['rise','down_left','down_right'])`, 굴뚝 높이 막대 `↕`. 시온이 가리키기로 `CHIMNEY` 라벨을 지목 | 이 무게 차이가 펌프 대신 물을 밀어요. 이 힘은 높이가 길수록 세져서, 노심 위에 긴 굴뚝을 세웠어요. |
| 35–40초 | `LIGHT ↑` vs `HEAVY ↓` 카드 (비교). LIGHT는 기포 섞인 물방울과 위쪽 화살표, HEAVY는 기포 없는 물방울과 아래쪽 화살표. 시온 반짝임 | 가벼우면 뜨고 무거우면 가라앉는 힘, 그 힘만으로 물이 도는 거예요. |

자막은 1·2편처럼 문장 단위로 쪼갠다. 다음 편 예고는 없다. 길이는 2편 자막 속도(약 5.6음절/초, 쉼 포함)로 잰 추정치이고, TTS로 실제 잰 값이 아니다. 45초를 넘으면 A-3의 순서대로 줄인다.

### 화면 글자 목록

`NATURAL CIRCULATION`, `BWRX-300`, `FORCED`, `NATURAL`, `PUMP`, `NO PUMP`, `CORE`, `CHIMNEY`, `DOWNCOMER`, `STEAM`, `FEEDWATER`, `LIGHT`, `HEAVY`, `↑`, `↓`, `↕`, `→` 만 쓴다. 온도·유량·높이 숫자는 화면에 쓰지 않는다.

### 사실 확인 목록

출처 약칭
- **[PR]** GE Vernova 보도자료, "NRC issues first U.S. construction permit for a BWRX-300 small modular reactor at Tennessee Valley Authority’s Clinch River site" (KNOXVILLE, TN, September 29, 2026), https://www.gevernova.com/news/press-releases/nrc-issues-first-us-construction-permit-bwrx-300-small-modular-reactor-tva-clinch-river
- **[GD]** GE Vernova Hitachi Nuclear Energy, "BWRX-300 General Description", 005N9751 Revision J (제조사 1차 기술 자료), https://www.gevernova.com/content/dam/gevernova-nuclear/global/en_us/documents/carbon-free-power/005N9751-BWRX-300-General-Description.pdf. 쪽 번호는 "Page N of 129"이고 PDF 쪽과 같다.
- **[ACRS]** U.S. NRC Advisory Committee on Reactor Safeguards, BWRX-300 Clinch River 건설 허가 신청 안전성 보고 서한, 2026-06-20, ADAMS ML26058A279, https://www.nrc.gov/docs/ML2605/ML26058A279.pdf. NRC 스태프 SER이 아니라 자문위원회 서한이다. nrc.gov는 curl에 403을 돌려준다.
- **[IAEA]** IAEA-TECDOC-1474, "Natural circulation in water cooled nuclear power plants" (2005), https://www-pub.iaea.org/MTCD/Publications/PDF/TE_1474_web.pdf. 쪽 번호는 PDF 쪽이다.

인용은 PDF 텍스트층에서 그대로 복사했고 줄바꿈은 공백으로 이었다. 7번과 11번의 `steam-water`는 원문에서 `steam-` 뒤에 줄이 바뀐다. 실제 복합어 하이픈이므로 하이픈은 남기고 줄바꿈만 지웠다. 3번에는 원문 합자 `ﬁ`·`ﬂ`가 그대로 있다. [PR]의 아포스트로피는 원문 그대로 `’`(U+2019)다. 한 칸에 인용이 둘 이상이면 각각 원문의 다른 자리에 있다.

| # | 주장 (대본 문장) | 출처 | 원문 인용 |
| --- | --- | --- | --- |
| 1 | BWRX-300(소형 원자로)이 미국에서 첫 건설 허가를 받았다 | [PR] | "today welcomed the U.S. Nuclear Regulatory Commission’s (NRC) issuance of a construction permit to the Tennessee Valley Authority (TVA) for a BWRX-300 small modular reactor at its Clinch River site in Oak Ridge, Tennessee." / "The permit is the first issued in the United States for a BWRX-300" |
| 2 | 이 원자로는 노심의 물을 펌프 없이 돌린다 | [GD] p.30 / [ACRS] p.2 | "Flow through the core is by natural circulation; pumps are not required to force reactor coolant through the RPV." / "The BWRX-300 Clinch River design is a nominal 300 MWe (870 MWth) BWR with core heat removal by natural circulation." |
| 3 | 끓는 물 원자로는 대부분 펌프로 물을 밀어 돌린다 | [GD] p.12 | "Most BWRs deployed to date have used forced circulation, including the BWR/1s through BWR/6s and the ABWR." / "Later plants were simpliﬁed by the introduction of internal jet pumps. These pumps boosted recirculation ﬂow" |
| 4 | 여기(BWRX-300)선 물이 스스로 돈다 | [GD] p.30 / [GD] p.12 | "Flow through the core is by natural circulation" / "The BWRX-300 continues the cost-saving advances of the SBWR and ESBWR with a tall vessel design to achieve natural circulation but without the need for a shorter core." |
| 5 | 노심에서 데워진 물은 가벼워진다 | [IAEA] p.27 | "The fluid in contact with the heat source is being heated so that its density is decreasing." |
| 6 | 끓어서 증기가 섞이면 가벼워진다 | [IAEA] p.27 / [IAEA] p.104 | "Fluid density differences can be created by changes in temperature or by changes in phase (i.e. vapor/liquid), as is the case for two-phase fluids." / "With two-phase systems, it is possible to obtain larger density differences and hence larger flow rates than in single-phase systems." |
| 7 | 노심을 나온, 증기 섞인 물이 위로 올라간다 | [GD] p.33 | "The chimney forms the annulus separating the subcooled recirculation downward flow from the upward steam-water mixture flow exiting the core." |
| 8 | 가벼운 쪽은 올라가고 무거운 쪽은 가라앉는다 | [IAEA] p.99 | "At the source, the fluid absorbs heat becomes lighter and rises. At the sink the fluid rejects heat becomes heavier and sinks thus establishing a circulation." |
| 9 | 증기는 위에서 빠져나가 터빈을 돌린다 | [GD] p.33 / [GD] p.33 / [GD] p.30 | "In each separator, the steam-water mixture rising through the standpipe passes through vanes to separate the water from the steam." / "removes the moisture from the steam before it exits the reactor." / "generates steam to drive the High Pressure (HP) and Low Pressure (LP) turbines." |
| 10 | 남은 물은 바깥 통로(downcomer)로 내려온다 | [GD] p.33 | "The separated water flows from the lower portion of the steam separator into the downcomer region." / "This partition separates the core region from the downcomer annulus." |
| 11 | 내려오는 물은 새로 들어온 물과 섞인 물이고, 증기가 없다 | [GD] p.33 / [GD] p.33 / [IAEA] p.109 | "The recirculation flow consists of reactor coolant returning from the steam separators and FW makeup." / "subcooled recirculation downward flow" / "Usually single-phase flow prevails in the downcomer." |
| 12 | 이 무게(밀도) 차이가 펌프 대신 물을 민다 | [IAEA] p.27 | "This density difference, acted upon by gravity over the difference in elevation between the source and the sink, produces a buoyancy force that drives the fluid through the loop. This behavior is known as natural circulation." |
| 13 | 이 힘은 높이가 길수록 세진다 | [IAEA] p.27 / [IAEA] p.109 | "acted upon by gravity over the difference in elevation between the source and the sink" / "Increasing riser height promotes natural circulation flow. An equivalent term used in vessel type BWRs is the chimney." |
| 14 | 그래서 노심 위에 긴 굴뚝을 세웠다 | [GD] p.30 / [GD] p.33 | "Natural circulation is enabled by a tall chimney between the top of the core at the top guide to the bottom of the steam separators." / "The chimney provides additional downcomer height for the driving head necessary to sustain natural circulation flow." |
| 15 | 뜨고 가라앉는 힘만으로 (노심의) 물이 돈다 | [IAEA] p.27 / [GD] p.30 | "produces a buoyancy force that drives the fluid through the loop. This behavior is known as natural circulation." / "pumps are not required to force reactor coolant through the RPV." |
| G1 | (그림) 안쪽 원통이 노심과 굴뚝을 함께 둘러싸고, 바깥 고리 통로와 나눈다 | [GD] p.33 | "provides a partition to separate the upward flow of coolant through the core from the downward recirculation flow." |
| G2 | (그림) 노즐은 모두 노심보다 한참 위에 있다 | [GD] p.30 | "All nozzles are located significantly above the level of active fuel" |

화면 표기와 행의 연결: `BWRX-300`은 1번, `FORCED`·`PUMP`는 3번, `NATURAL`·`NO PUMP`는 2·4번, `CORE`·`CHIMNEY`·`DOWNCOMER`·`STEAM`은 7·9·10·14번과 G1, `FEEDWATER`는 11번, `LIGHT ↑`는 5·6·8번, `HEAVY ↓`는 8·11번, `↕`는 13번이다. 훅의 "펌프 없이, 물이 혼자 돈다"는 2·4번이다.

## 부록 — 4편 대본: 라이프니츠 계단 드럼

**훅 카드:** **훅 카드:** 톱니 길이만 바꿨는데, **기계가 곱셈을 한다** / STEPPED DRUM / 라이프니츠 계단 드럼

| 시간 | 화면 (템플릿) | 내레이션 |
| --- | --- | --- |
| 0–15초 `hook` | **훅 카드.** 용어 `STEPPED\nDRUM`, 그림은 계단 드럼 옆모습 + 작은 기어(1절), 시온 놀람. 훅 카드 템플릿 그대로 | S1 톱니 길이만 다르게 했을 뿐인데, 기계가 곱셈을 해요. S2 최근 한 유튜버가 손바닥만 한 기계식 계산기를 3D 프린팅해 만들었는데요, S3 그 심장이 17세기에 라이프니츠가 고안한 계단 드럼이에요. |
| 15–28초 `problem` | **비교.** 키커 `STEPPED DRUM`. 카드 2장 `3 × 2` / `3 + 3`, 연결 기호 `=`. 왼쪽 카드 먼저(S4), 오른쪽 카드와 `=`는 S5에서. S6에서 오른쪽 카드의 두 `3`이 같은 색으로 깜빡여 "같은 수"를 보인다 | S4 이런 기계에게 곱셈은, 같은 수를 여러 번 더하는 거예요. S5 3 곱하기 2는, 3을 두 번 더하면 되죠. S6 그러려면 넣은 숫자를 기계가 기억해 두고, 몇 번이든 다시 보낼 수 있어야 해요. |
| 28–42초 `drum` | **단면도 확대.** 키커 `STEPPED DRUM`. 무대(ART_CENTER)에 펼친 드럼(5절): 톱니 9줄이 위끝에서 나란히 시작해 길이 1~9칸 계단을 이룬다. 왼쪽에 자리 눈금 `9`(위)~`0`(아래). 범례 `STEPPED DRUM`(S7~S8) → `GEAR`(S9, 펼친 드럼 위에 기어 등장, 자리 `0`) → `COUNTER`(S10, 오른쪽에 숫자창 `0`) 순서로 켠다 | S7 라이프니츠의 답은 원통이었어요. S8 길이가 서로 다른 톱니 아홉 개를 계단처럼 붙였죠. S9 드럼 옆에는 기어가 하나 있고, S10 이 기어가 돈 만큼 결과 숫자가 올라가요. |
| 42–61초 `set` | **단계.** 칩 `SET 3` → `TURN` → `+3`. 무대는 앞 장면의 펼친 드럼·기어·숫자창. ① S11 `SET 3` 켜짐, 기어가 눈금 `3` 자리로 미끄러진다. ② S12 시작에 기어 자리까지 닿는 톱니 3줄(가장 긴 3줄)만 밝아지고, 같은 순간 시온 가리키기가 그 3줄을 지목. ③ S13 `TURN` 켜짐, 회전 한 바퀴(5절): 밝은 3줄이 기어 밑을 지날 때마다 기어가 한 칸 돌고 숫자창이 `1`→`2`→`3`(뜻 있는 소리 1). 바퀴가 끝나면 칩 `+3` 켜짐. ④ S14 숫자창 `3`을 그대로 둔 채 기어를 `0` 자리로 옮겨 한 바퀴 돌리면 어느 톱니에도 닿지 않고 숫자창이 그대로(소리 없음). 끝나면 기어를 `3` 자리로 되돌린다 | S11 3을 넣으면, 기어가 드럼의 3번 자리에 맞춰져요. S12 그 자리까지 닿는 톱니는 딱 세 개예요. S13 크랭크를 한 바퀴 돌리면 그 세 개만 기어를 쳐서, 결과 바퀴가 세 칸 돌아요. S14 0에 두면 어떤 톱니에도 닿지 않아서, 한 칸도 안 돌고요. |
| 61–73초 `repeat` | **비교.** 키커 `STEPPED DRUM`. 카드 `TURN ×1` (작은 펼친 드럼, 기어는 `3` 자리, 밝은 3줄, 숫자창 `3`) / `TURN ×2` (같은 그림, 숫자창 `3`), 연결 기호 `→`. **두 카드와 `→`를 장면 시작에 함께 켠다.** S16에서 오른쪽 카드 숫자창만 딸깍마다 `4`→`5`→`6`(뜻 있는 소리 2). 기어는 움직이지 않는다 | S15 기어 자리는 그대로니까, 드럼이 3을 기억하고 있는 셈이에요. S16 한 번 더 돌리면 또 3이 더해져서 6이 돼요. S17 3 곱하기 2를 크랭크 두 바퀴로 푼 거예요. |
| 73–90초 `shift` | **비교.** 키커 `× 12`. 카드 `NO SHIFT` (크랭크 아이콘 + `12 TURNS`) / `SHIFT` (두 줄: `2 TURNS → 6`, `1 TURN → 30`, 아래 `= 36`), 카드 사이는 세로 구분선(3편 `A.divider()`와 같은 것). S18에서 왼쪽, S19에서 오른쪽 카드 틀, S20에서 두 줄이 차례로, S21에서 `= 36` | S18 그런데 3에 12를 곱하려면, 열두 바퀴를 돌려야 할까요? S19 라이프니츠는 입력을 한 자리씩 옮기는 장치도 넣었어요. S20 12를 10과 2로 나누면, 두 바퀴로 6, 한 자리 옮겨 한 바퀴로 30. S21 세 바퀴면 36이 나와요. |
| 90–104초 `finale` | **비교.** 키커 `STEPPED DRUM`. 카드 `SET` (펼친 드럼, 기어 `3` 자리, 밝은 톱니 3줄) / `TURN` (크랭크 아이콘 + `×2`), 연결 기호 `×`, 아래 `= 6`. S22에서 두 카드, S23에서 `= 6`, S24에서 시온 반짝임 | S22 손으로 돌리는 작은 계산기 쿠르타도, 같은 계단 드럼 원리를 썼어요. S23 기어 자리로 숫자를 기억하고, 돌릴 때마다 그 수를 더하기. S24 그게 계단 드럼이 곱셈을 하는 방법이에요. |

자막은 앞 편들처럼 문장 단위로 쪼갠다. 다음 편 예고는 없다.

장면별 실측(초): hook 14.6 · problem 13.9 · drum 13.9 · set 18.3 · repeat 12.0 · shift 17.4 · finale 13.8. 문장별 음성 길이는 4.06 / 5.30 / 4.27 · 4.03 / 3.43 / 5.45 · 2.83 / 3.77 / 2.69 / 3.38 · 3.98 / 3.14 / 5.54 / 4.46 · 4.37 / 3.43 / 3.22 · 4.32 / 4.10 / 5.16 / 2.62 · 5.11 / 4.49 / 3.17초다. 넘칠 때 줄이는 순서는 0절 A-1이다.

### 사실 확인 목록

출처 약칭
- **[REG]** The Register, Brandon Vigliarolo, "YouTube lunatic designed and 3D printed a working mechanical calculator" (2026-09-30, 계기 뉴스), https://www.theregister.com/offbeat/2026/09/30/youtube-lunatic-designed-and-3d-printed-a-working-mechanical-calculator/5300273
- **[ARI]** Arithmeum (Universität Bonn 계산기 박물관·연구소), 소장품 "Leibniz machina arithmetica (Replik)" 해설(독일어), https://www.arithmeum.uni-bonn.de/sammlungen/rechnen-einst/objekt.html?tx_arithinventory%5Bobject%5D=4251
- **[DM]** Deutsches Museum Digital, 소장품 56956 "Rechenmaschine von Gottfried Wilhelm Leibniz, Nachbildung" 해설(독일어), https://digital.deutsches-museum.de/de/digital-catalogue/collection-object/56956/
- **[NASM]** Smithsonian National Air and Space Museum, 소장품 "Curta Mechanical Calculator" (A20070038000), https://airandspace.si.edu/collection-objects/curta-mechanical-calculator/nasm_A20070038000

인용은 각 페이지 HTML 본문 텍스트에서 그대로 복사했다. [REG]의 아포스트로피는 원문 그대로 `’`(U+2019), [NASM]은 곧은 `'`다. [ARI]의 `0 – 9`는 원문 그대로 앞뒤 공백이 있는 en dash(U+2013)다. 한 칸에 인용이 둘 이상이면 각각 원문의 다른 자리에 있다.

| # | 주장 (대본 문장) | 출처 | 원문 인용 |
| --- | --- | --- | --- |
| 1 | (S1) 톱니 길이를 다르게 한 것이 이 기계들의 핵심이고, 기계는 그것으로 같은 수를 반복해 더해 곱셈을 한다 | [REG] | "The core concept of the calculator’s central mechanism, like that of many other mechanical calculators, is the Leibniz drum’s teeth of different lengths." / "the addition of a multi-wheel enables it to also do multiplication by simply performing multiple sequences of adding the same number." |
| 2 | (S2) 최근 한 유튜버가 손바닥만 한 기계식 계산기를 3D 프린팅해 만들었다 | [REG] | "YouTube lunatic designed and 3D printed a working mechanical calculator" / "As a result of wanting to keep the 3D printed calc’s build palm-sized" |
| 3 | (S3) 그 계산기의 심장은 라이프니츠의 계단 드럼이다 | [REG] | "relies on a more than 200-year-old component known as the Leibniz stepped drum, named for its inventor, German philosopher and mathematician Gottfried Wilhelm Leibniz." |
| 4 | (S3) 라이프니츠가 계단 드럼을 고안한 것은 17세기(1670년 무렵)다 | [DM] / [ARI] | "führte um 1670 als Schaltorgan einer Vierspeziesmaschine die Staffelwalze ein, eine Anordnung von Zahnrippen gestaffelter Länge." / "Die erste Rechenmaschine zur mechanischen Lösung aller vier Grundrechenarten wurde 1671 vom Philosophen, Mathematiker und Universalgelehrten Gottfried Wilhelm Leibniz (1646-1716) erfunden." |
| 5 | (S4) 이런 기계에게 곱셈은 같은 수를 여러 번 더하는 것이다 | [ARI] / [REG] | "Leibniz hatte die Idee, dass seine Rechenmaschine durch sukzessive Additionen multiplizieren können sollte" / "multiplication by simply performing multiple sequences of adding the same number." |
| 6 | (S6) 그러려면 넣은 숫자를 기계가 기억해 두고 몇 번이든 다시 보낼 수 있어야 한다 | [ARI] | "Zu diesem Zweck benötigte Leibniz mechanische Zahlenspeicher, um eine eingestellte Zahl mehrfach ins Ergebniswerk seiner Rechenmaschine übertragen zu können." |
| 7 | (S7·S8) 라이프니츠의 답은 길이가 서로 다른 톱니 아홉 개를 계단처럼 붙인 원통이다 | [ARI] / [REG] | "ersann er stattdessen eine Walze mit 9 unterschiedlich langen gestaffelten Rippen darauf, die sogenannte Staffelwalze." / "There are nine teeth per drum, representing values one through nine, while a zero setting engages none of them." |
| 8 | (S9·S10) 드럼 옆에 기어가 있고, 그 기어가 돈 만큼 결과가 올라간다 | [ARI] | "konnten sie bei einer Kurbelumdrehung das Übernahmezahnrad des Ergebniswerks um 0 – 9 Zähne weiterdrehen." |
| 9 | (S11·S12) 숫자를 넣으면 기어가 드럼의 그 숫자 자리에 맞춰지고, 그러면 그 수만큼의 톱니만 기어에 닿는다 | [REG] / [ARI] | "You use a lever to move a gear up the drum so that it only activates as many teeth as are needed for a particular number." / "Entsprechend ihrer jeweiligen Positionierung durch die Einstellknöpfe am Einstellwerk der Maschine konnten sie bei einer Kurbelumdrehung das Übernahmezahnrad des Ergebniswerks um 0 – 9 Zähne weiterdrehen." |
| 10 | (S13) 크랭크 한 바퀴에 결과 바퀴가 그 수만큼(0~9칸) 돈다 | [ARI] | "bei einer Kurbelumdrehung das Übernahmezahnrad des Ergebniswerks um 0 – 9 Zähne weiterdrehen." |
| 11 | (S14) 0에 두면 어떤 톱니에도 닿지 않는다 | [REG] | "while a zero setting engages none of them." |
| 12 | (S15) 기어 자리가 그대로인 동안 드럼이 넣은 수를 기억하고 있는 셈이다 | [ARI] | "mechanische Zahlenspeicher, um eine eingestellte Zahl mehrfach ins Ergebniswerk seiner Rechenmaschine übertragen zu können." |
| 13 | (S16·S17) 한 번 더 돌리면 같은 수가 또 더해진다 — 곱셈을 크랭크 횟수로 푼다 | [REG] / [ARI] | "multiplication by simply performing multiple sequences of adding the same number." / "durch sukzessive Additionen multiplizieren können sollte" |
| 14 | (S19) 라이프니츠는 입력을 결과 쪽에 대해 한 자리씩(10배씩) 옮기는 장치를 넣었다 | [ARI] | "hat Leibniz eine Stellenverschiebung vorgesehen, bei der das Einstellwerk gegenüber dem Ergebniswerk um 10er-Potenzen verschoben werden kann." |
| 15 | (S18·S20·S21) 그래서 12를 곱할 때 12바퀴가 아니라 3바퀴면 된다 | [ARI] | "Eine Multiplikation mit 12 bedeutet somit nicht 12, sondern lediglich 3 Kurbeldrehungen." |
| 16 | (S22) 쿠르타는 손으로 돌리는 작은 계산기다 | [NASM] | "The Curta was a small, hand-cranked mechanical calculator invented by Curt Herzstark and introduced in 1948." |
| 17 | (S22) 쿠르타도 같은 계단 드럼 원리를 썼다 | [NASM] / [REG] | "The Curta's design is a variant of Gottfried Leibniz's Arithmometer, accumulating values on cogs, which are added or complemented by a stepped drum mechanism." / "The same concept is used to input values into the Curta" |
| 18 | (S23·S24) 요약: 기어 자리로 숫자를 붙잡고, 돌릴 때마다 그 수를 더하는 것이 계단 드럼의 곱셈 방법이다 | [ARI] / [REG] | "um eine eingestellte Zahl mehrfach ins Ergebniswerk seiner Rechenmaschine übertragen zu können." / "multiplication by simply performing multiple sequences of adding the same number." |
| G1 | (그림) 톱니 줄은 드럼 둘레 전체가 아니라 약 절반(약 180°)에만 있다 | [ARI] | "deren Rippen nur ca. 180° des Umfangs der Walze bedecken" |

S5·S20·S21의 계산(`3×2 = 6`, `12 = 10 + 2`, 한 자리 옮긴 한 바퀴 `30`, `6 + 30 = 36`)은 출처의 주장이 아니라 산수다. 15번 행은 "12는 3바퀴"라는 사실만 받친다.

화면 표기와 행의 연결: `STEPPED DRUM`은 3·7번, `GEAR`는 8·9번, `COUNTER`는 8·10번, 자리 눈금 `0`~`9`는 7·11번, `SET 3`·`SET`은 9번, `TURN`·`+3`은 10번, `TURN ×1`·`TURN ×2`·`3`·`6`은 12·13번, `× 12`·`12 TURNS`·`SHIFT`·`NO SHIFT`·`2 TURNS`·`1 TURN`은 14·15번이다. 훅의 "톱니 길이만 바꿨는데, 기계가 곱셈을 한다"는 1번이다.
