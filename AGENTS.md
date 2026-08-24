# AGENTS.md

## 기본 규칙

- 저장할 프로젝트 인계 사항은 이 파일에 남긴다. 완료된 배포 이력과 수치는 상세 설계 문서·git에 두고 여기에는 현재 계약과 다음 작업만 유지한다.
- **항목이 닫히면 그 자리에서 한 줄로 줄이거나 지운다.** 남기는 한 줄은 `무엇이 닫혔고 정본이 어디인가`뿐이다. 배경·근거·함정·실측은 설계 문서와 git에 이미 있고, 여기에 두면 다음 작업을 찾는 사람이 매번 끝난 일을 먼저 읽는다. **줄이기 전에 그 줄의 내용이 설계 문서에 실제로 있는지 확인한다** — 없으면 먼저 옮기고 줄인다. 닫힌 뒤에도 다른 작업의 판단을 바꾸는 계약만 예외로 남긴다.
- `AGENTS.md`와 `CLAUDE.md`는 제목을 제외한 내용을 동일하게 유지한다. 하나를 고치면 다른 파일도 반영하고 커밋 전 차이를 확인한다.
- git 커밋 메시지·PR 본문·이슈 등 저장소에 남는 어디에도 `Co-Authored-By: Claude`나
  `Generated with Claude Code` 같은 AI 표기를 넣지 않는다.
- 사용자에게 편한 반말로, 부드럽지만 생산적으로 말한다. 항상 사용자 말이 옳다고 가정하지 않는다.
- 잘 모르겠으면 “잘 모르겠다”, 근거가 부족하면 “확신을 갖고 평가하기엔 정보가 부족해”라고 말한다.
- 출처를 명시한다. 사실 근거는 가능하면 원문의 표현을 직접 인용한다.
- `sudo npm`·`sudo npx`는 사용하지 않는다.

## 작업 원칙

- 구현 전에 가정·해석·더 단순한 대안·트레이드오프를 밝힌다. 중요한 불확실성은 묻고 넘어간다.
- 요청을 만족하는 최소 변경만 한다. 단일 용도 추상화, 요청하지 않은 확장성·방어 코드, 주변 정리는 만들지 않는다.
- 기존 스타일을 따르고, 이번 변경이 만든 미사용 코드만 치운다. 모든 변경 줄은 요청으로 설명할 수 있어야 한다.
- 작업을 검증 가능한 목표로 바꾼다. 버그는 가능하면 재현 테스트를 먼저 만들고, 여러 단계면 `작업 → 검증`의 짧은 계획을 공유한다.
- 실제 코드 수정 전 무엇을 왜 바꾸는지, 영향과 트레이드오프를 설명하고 컨펌받는다.

## 먼저 읽을 문서

- 계획·편집 전: `docs/galpi-design-final.md`, `docs/roadmap.md`
- Pi 운영·복구: `docs/RASPBERRY_PI_RUNBOOK.md`
- 현재 음성 기준: `docs/voice-halfduplex-design.md`
- XION 통합 홈(지식 패널 첫 화면): `docs/xion-home-design.md`
- 트레이딩(V5-B): `docs/trading/strategies/Swing Trading Agent Design v2 2.md`. 실측·완료 기록은 20.0절이다.
- 트레이딩 전략 구축 계약: 전략 family마다 로드맵이 하나다. **연구 예산·종료 조건·Phase별 사전등록이 거기 있다.** 실험 산출물 색인은 `trading/runs/README.md`다.
  - `momentum-v2` (CLOSED/FROZEN): `docs/trading/momentum-v2-roadmap.md`
  - `quality-value` (Phase 0 진행 중 — identity 완료, 다음 submissions ingestion): `docs/trading/strategies/quality-value-roadmap.md`
- 메일 에이전트(독립 트랙 MAIL-1~4): `docs/xion-mail-agent-design-final.md`. 스키마·Phase·통과 기준이 전부 그 문서에 있다.
- 세부 설계는 각 기능 문서를 단일 기준으로 삼고, 이 파일에 상세 이력을 복제하지 않는다.

## 현재 제품과 운영 경계

- 제품은 `갈피`(`galpi`), 화면 비서는 `시온`(`XION`)이다. Pi 운영 경로는 `/home/pi/galpi`, `galpi.db`, `galpi-vault`, `galpi.service`다.
- 메인 채팅은 단일 GPT다. 신규 의회 실행은 `410`으로 퇴역했고 기존 의회 대화·transcript·노트의 읽기·검색 호환성만 유지한다. 채팅 `자동`은 `gpt-5.6-terra`, Codex 일반은 `gpt-5.6-luna`, Codex 깊은 재처리는 `gpt-5.5`다. Codex 모델의 정본은 `app_settings`이고 기동 로그는 env 기본값을 찍으므로 실제 값은 DB에서 확인한다.
- A2는 전역 `ready` topic 청크를 보수적으로 최대 8,000자 주입한다. 명시 선택 노트와 비topic 자료는 기존 경로를 유지하고, 관찰에는 질문 원문 대신 `query_sha256`·`runtime_generation`을 쓴다.
- DB가 대화·task·상태의 정본이다. topic Markdown QA-LOG는 사람에게 보이는 Q&A 정본이고 `note_chunks`는 재생성 가능한 검색 인덱스다. Codex는 허용 마커만 수정하며 `recovery_required` fail-close·원자적 finalization을 유지한다.
- 첨부가 연결된 턴은 `<context>` 마지막 `<current_attachments>` 블록으로 파일명만 알리고 지시는 시스템 프롬프트에만 둔다. 저장되는 메시지 본문과 화면 표시는 바꾸지 않는다. 새 첨부의 파싱은 채팅 요청 안에서 끝나므로 그동안 `attachment_parse` 단계를 보낸다.
- **Web Push의 `Topic` 헤더는 dispatcher가 해시로 정규화한다. 도메인이 만든 문자열을 그대로 보내지 않는다.** `Topic`은 RFC 8030에서 URL-safe base64이고 base64 길이는 4로 나눈 나머지가 1일 수 없다. `mail-batch-9`(12자)는 통과하는데 `mail-batch-10`(13자)은 Apple이 `BadWebPushTopic`으로 거절해 **2026-08-20~21에 메일 알림 9건이 조용히 사라졌다.** `task-1234`·`news-review-1`도 같은 함정이었다. 합치기 동작은 해시가 그대로 보존한다.
- 일정은 DB 정본, 활성 일정 대화 컨텍스트, 완료·취소 월별 `schedule_history` projection 구조다. 자연어 요청은 무저장 후보 카드가 되고 `등록`만 기존 task API를 같은 request ID로 호출한다.
- **기한이 있는 활성 일정은 살아있는 알림이 항상 하나다.** 사용자가 정했으면 그것이고, 아니면 기본 알림이다(`datetime`은 10분 전, `date`는 당일 09:00 KST, `none`은 없음). `assistant_reminders.origin`이 둘을 가른다. `remove`는 사용자 알림에만 듣고, 기한이 바뀌면 기본 알림만 따라 옮긴다. 이미 지난 시각으로는 만들지 않아서 배포 직후 밀린 알림이 터지지 않는다. 발송 경로는 기존 스케줄러 → `enqueueReminder` → Web Push 그대로다.
- Docker는 개발·CI 재현성에만 사용한다. Pi는 native `galpi.service`, host Codex, 분리된 DB/WAL/SHM·Vault·backup 경계를 유지한다.
- 구현·Pi 배포가 끝난 기능의 상세 테스트 수·PID·백업명·hash는 git과 관련 설계 문서에서 찾는다. 이 파일에는 다시 누적하지 않는다.

## 음성의 현재 계약

- Realtime은 2026-08-01 제품 경로에서 접었다. `docs/voice-realtime-design.md`는 R0~R2c-1 기록일 뿐이고 새 작업 기준은 반이중 문서다.
- 2026-08-03 H5에서 Pi의 Realtime·read tool·correction·finalize 운영 flag를 모두 껐고 반이중만 유지해 실기기 인수했다. Realtime 코드는 기록·롤백용으로 남긴다.
- H6a 서버와 iPhone 단일·고정 3회 반복·로컬 종료는 인수했다. 잠금 화면 표시 중에는 동작하지만 디스플레이 소등 상태에서는 최소 음성 단축어부터 호출되지 않아 플랫폼 제약으로 수용하고 H6 확대를 닫았다. 현재 iPhone route·credential은 유지하되 iPad는 강의 노트, 노트북은 V6 화면 시온 단계까지 등록하지 않는다.
- H6d는 단축어의 명시적인 새 일정 생성만 기존 validator 뒤 `shortcut-task:<requestId>`로 즉시·멱등 저장하도록 Pi·실기기 인수했다. PWA 카드 확인, 기존 일정 mutation·다른 쓰기 차단, scoped bearer exact route를 유지하며 생성·알림·취소 projection까지 정상이다.
- 운영 흐름은 브라우저 VAD → `gpt-transcribe` → 기존 단일 GPT 채팅 → `gpt-4o-mini-tts`다. 음성 턴도 `sendSingleMessage`를 통해 `shared-main`에 저장하지만 `source:'voice'`는 topic 자동 저장에서 제외한다. 원본 오디오는 DB·Vault·backup·temp file에 저장하지 않는다.
- 일정 카드의 음성 등록·취소는 모델이 아니라 좁은 어휘로 카드 버튼과 같은 핸들러를 호출한다. 그 턴은 모델·메시지 저장을 거치지 않는다. 등록·취소가 아닌 발화는 카드를 조용히 취소한 뒤 일반 대화로 보낸다.
- TTS voice는 `echo`, 기본 speed는 `1.3`, 조각 RMS 목표는 `0.18`이다. WAV의 streaming sentinel 길이는 실제 길이로 정규화하고 재생 진행 감시 타이머를 유지한다.
- 음성 답변은 기본 6문장 이내, 제목·목록 없이 결론부터 말한다. 사용자가 명시적으로 자세한 설명을 원하면 더 길게 답할 수 있다.
- **링크는 화면에만 남고 소리로는 읽히지 않는다.** 음성 턴의 답변도 같은 텍스트가 화면에 저장되므로 모델에게 "링크를 쓰지 마라"라고 시키면 원문으로 들어갈 길이 함께 사라진다. 그래서 TTS로 가는 텍스트에서만 벗기고, 표시 글자는 남긴다. 스킴 없는 주소(`axios.com`)까지 잡되 TLD를 열거해 `설정.json`·`3.5`·`gpt-5.6-terra`는 건드리지 않는다.
- 첫 낭독은 최대 600자와 닫는 말 자리를 포함해 최대 7개 조각으로 제한한다. 남은 답이 있을 때만 `화면에 정리해뒀어. 더 들으려면 말해줘.`로 닫고, 이어 듣기 요청 한 번이면 나머지를 400자 조각으로 끝까지 읽는다. 이어 듣기 턴은 모델·저장·일정 카드를 건드리지 않는다.
- 닫는 말이 요구하는 표현(`말해줘` 등)은 이어 듣기 매처가 반드시 받아야 한다. 단독 `응`은 모호해서 제외하고 `응 계속`처럼 의도가 붙은 표현만 받는다.
- VAD 소음 바닥은 초기 프레임의 하위 20% 백분위로 잡고, 듣는 중 8초 동안 발화를 못 잡으면 재보정해 영구 고착을 막는다.
- 음성 루프의 최종 판정은 iPhone 실기기다. 브라우저 자동화는 UI·요청·렌더링 확인용이며 iOS 자동재생·AudioContext 동작을 대신하지 못한다.

## UI 현재 계약

- 방향은 미니멀리즘 기반 Apple Human Interface다. 기능보다 장식을 늘리지 않는다.
- Markdown 말풍선은 `.bubble.md { white-space: normal; }`과 `marked`의 `breaks:true`를 함께 유지한다.
- 공통 거터는 16px, 본문·입력 읽기 폭은 600px, 모바일 동작 타깃은 44px 이상, 경계선은 테마별 `--hairline`을 쓴다.
- composer는 위 입력·아래 도구의 두 줄 구조다. 보조 기능과 첨부는 `+` 메뉴에 두고, 오른쪽 주 액션은 빈 입력에서 시온 마크의 반이중 음성·입력값이 생기면 전송으로 전환한다. 활성 음성 루프의 종료 버튼은 입력값보다 우선한다. 음성·전송은 한 슬롯을 교대하므로 시각 원을 `.composer-action-disc` 하나로 묶어 데스크톱 36px·모바일 38px로 맞추고 실제 타깃은 40px·44px로 유지한다.
- composer 두 줄은 같은 세로선에서 시작하고 끝난다. `+` 글리프는 입력 글자선에, 주 액션 원의 오른쪽 끝은 입력 텍스트 오른쪽 경계에 맞춘다. 버튼 안에서 글리프와 원이 들어간 만큼 `#composer-toolbar`의 좌우 padding 값은 서로 다르고, `#input`의 padding을 고치면 함께 고쳐야 한다.
- 컨트롤 모서리는 `10px`(일반 컨트롤·카드 내부) · `12px`(패널 카드) · `18px`(말풍선) · `20px`(40px pill) · `24px`(composer shell) · 원 · `999px`(상태 pill)만 쓴다. 1px 차이의 새 값을 만들지 않는다.
- 아이콘은 텍스트 글자가 아니라 SVG로 그린다. 화살표·기호 문자는 잉크가 em 상자 가운데에 있지 않아 flex 중앙 정렬로도 어긋난다. 회전 상태가 있는 아이콘은 잉크를 viewBox 중심 기준으로 대칭이 되게 그린다.
- 대화 턴 사이 간격은 `#messages`의 `gap` 한 곳에서만 준다. 답변 안 문단 간격(10px)보다 넓게 유지한다.
- 패널 카드의 작은 글자는 한 단계로 모은다. Codex 카드는 `9px` 키커 · `11px` 본문·컨트롤 · `17px` 제목이고 굵기는 `650`·`700`만 쓴다.
- `test/chat-ui.test.js`는 CSS·소스 계약 회귀용이다. 실제 픽셀은 Playwright로 확인하되 리뷰 서버는 스크래치 데이터만 사용한다.

## 현재 음성 상태 — 2026-08-04

- VAD 고착 복구, 이어 듣기, 6문장 음성 프롬프트, UI 정리를 Pi와 실기기에서 인수했고 `main`에 push했다. 상세 receipt는 `docs/voice-halfduplex-design.md`와 git에 있다.
- 정상 길이의 여러 문장을 모두 읽고도 마지막 문장이 `spokenRemaining`에 남을 수 있다. 안내가 없는데 사용자가 직후 우연히 이어 듣기 어휘를 말해야만 중복 재생되므로, 사용자 판단으로 현재 수정하지 않는 낮은 확률 경계로 수용했다.
- `.claude/settings.local.json` 변경은 개인 설정이므로 의도적으로 커밋하지 않는다.

## 열린 작업

### 메일 — 닫혔다, 관측만 남았다

- **MAIL-1~4와 카드의 본문 열기·일정 등록까지 2026-08-20 Pi 배포·실기기 인수로 닫혔다.** 계약과 실측은 `docs/xion-mail-agent-design-final.md`와 `docs/roadmap.md`의 독립 트랙 `MAIL-1~4`에 있고(`V5-C`는 외부 캘린더 에이전트가 쓰는 다른 이름이다), 코드로 잠긴 계약은 `lib/mail/*`와 `test/mail-*.test.js`가 정본이다. **운영 사실(스크래치 확인법·자격증명·분석 모델·막힌 길)은 로드맵의 `메일 운영 사실` 항목에 모아뒀다.**
- **`MAIL_AGENT_ENABLED=true`로 서버를 띄우면 그 순간 실계정 메일이 동기화·분석되고 OpenAI 호출이 나간다.** 문법 확인은 `node --check`로 끝내고, 띄웠으면 PID를 잡아 반드시 종료한다. **Pi가 정본이고 로컬은 `false`다.**
- **관측 대상 둘**: 실제 알림에서 판단 흔들림이 얼마나 드러나는지(흡수 장치인 batch 묶기와 발신자 억제는 이미 배포됐다), 그리고 본문 열기의 IMAP 연결이 동기화 tick과 부딪히는지.

### 뉴스 — v1 인수했다, 홈 노출과 재확인만 남았다

- **`docs/xion-news-agent-design.md`가 단일 기준이고 로드맵 독립 트랙 `뉴스`에 순서가 있다.**
- **2026-08-21 Pi 배포 완료(schema v22). 관심 등록 · 수집 · 판단 · 대화 조회까지 실기기 인수했다.** 관심 노트는 `lib/news-interest-note.js`, 등록 도구는 `lib/news-interest-tool.js`, 나머지는 `lib/news/*`다. 뉴스 표는 v22에서 한 번에 만든다.
- **2026-08-21 저녁 홈 `알아둘 것`까지 인수했다.** 문턱은 `{ relevance: 0.6, novelty: 0.4, importance: 0.4 }`이고 근거·표본은 설계 13.1절이다. **아직 인수하지 않은 것 하나**: 재확인 질문(`expressed` 관심이 `review_after`에 닿은 적이 없다).
- **켜면 사용자가 `계속 알려줘`라고 말한 순간 `xion-news-context.md`가 볼트에 생긴다** — 확인 카드가 없고 취소는 대화(`그만 봐줘`)로만 된다. 관심이 하나라도 있으면 15분마다 Tavily 뉴스 검색이 나가고 판단 LLM이 돈다. **관심이 0개면 검색도 LLM도 0회다.**
- **플래그가 둘이다.** `NEWS_AGENT_ENABLED`가 수집·판단·조회·재확인을 열고, 홈의 `알아둘 것`만 `NEWS_SURFACE_ENABLED`가 따로 연다. **Pi는 둘 다 `true`이고 `.env.example`은 둘 다 `false`다.** 표본이 30~50건에 못 미쳐 문턱을 다시 볼 수 있으므로 나눈 구조는 유지한다.
- **판단은 (기사, 관심) 쌍에 속한다.** 같은 기사가 두 관심에 걸리면 판단도 둘이다. 기사에 하나만 두면 한쪽 기준 이유가 다른 쪽 설명으로 새어 사용자에게 틀린 이유를 말한다. dedupe는 기사 단위 그대로다.
- **`last_seen`은 사용자가 실제로 말한 시점이다.** 시스템이 재확인 예정일을 미뤄도 바뀌지 않으므로, 미루기는 `update`가 아니라 `reschedule` op를 쓴다.
- **노출 판정은 세 축을 모두 넘어야 한다.** `novelty`를 재기만 하고 게이트에서 안 써서 기존 보고서 해설(`rel 0.75`·`nov 0.20`)이 통과하던 구멍을 막았다. `store.briefingArticles`는 **바깥 WHERE와 대표 쌍을 고르는 안쪽 서브쿼리 둘 다** 세 조건을 쓴다 — 한쪽만 걸면 문턱을 못 넘는 쌍이 대표로 뽑혀 기사가 통째로 사라진다.
- **이름과 검색어는 다른 칸이다**(설계 12.1). topic은 사람이 읽는 이름이고 수집이 던지는 것은 `query`다. 하나였을 때 사용자가 말한 대로 적으면 검색이 넓어지고(`피지컬 AI 관련 정보` → 국내 일반지·보도자료·스팸) 검색이 되게 고치면 노트가 읽기 나빠졌다. `reason`은 여전히 검색에 안 쓰이고 판단 프롬프트에만 들어간다.
- **검색어 생성은 등록하는 그 턴 한 번뿐이다.** `news_interest_prepare`의 선택 입력 `search_query`라 **추가 LLM 호출이 없다.** 언어는 고정하지 않고 그 주제가 주로 보도되는 언어로 모델이 고른다. **없으면 topic으로 돌아 무회귀다.** 생성된 질의는 노트에 보이는 자리에 남긴다 — 안 보이면 사용자가 말하지 않은 문자열이 조용히 수집을 정한다.
- **필터는 만들지 않는다.** `searchTavilyWeb`이 언어·국가·도메인 필터를 넘길 자리가 없어서, 지금 만들면 안 쓰이는 값이 쌓인다. provider를 바꿀 때 함께 연다.
- **뉴스 검색 예산은 Pi가 `700`이고 `.env.example`이 `200`이다.** 관심 1개가 6시간 주기로 월 120회이므로 Pi의 현재 관심 3개는 월 360회로 여유가 있다. **한도에 걸리면 실패로 적지 않고 조용히 미루기만 하므로**(`collect.js`의 `budget: true`) 관심을 크게 늘릴 때는 한도부터 확인한다.
- **아직 정하지 못한 것 둘.** 원문 fetch(문턱이 생겼어도 별도 결정이라 안 열었다) · 11.2절 최근 언급 매칭이 너무 엄격한 문제. 둘 다 30~50건 표본이 필요하다.
- **v1은 사용자가 직접 말한 관심만 다룬다**(hot path `expressed`·`subscribed` → RSS/API 수집 → 홈 조건부 브리핑). 먼저 묻기는 v1.1, 대화에서 관심을 추론하는 background batch는 v2다.
- **v2를 여는 조건이 메일 관측이다.** background 추론만이 사용자가 요청하지 않은 상태를 LLM이 스스로 만드는 경로라, 메일의 판단 흔들림 관측이 끝나기 전에는 열지 않는다. 두 트랙은 병행한다.
- **전달·큐 인프라는 새로 만들지 않는다** — 공유 Push dispatcher · `lib/mail/quiet-hours.js` · 메일 분석 큐 상태 기계 · `PROMPT_VERSION` 기록을 그대로 쓴다.
- **`messages` 스키마는 건드리지 않는다.** proactive 표시는 v1.1에서 schema v22의 `news_proactive_messages`로 들어가고 `UNIQUE(candidate_id)`가 중복 발송을 잠근다.

### 음성

- H3 되묻기 문턱은 실제 오전사 표본이 더 쌓인 뒤 정한다. 작은 표본에서 정확 전사는 `min logprob -0.024~-0.425`, 오류 전사는 `-0.652`·`-1.356`이었지만 확정 문턱으로 쓰기엔 부족하다. 로그에는 토큰 문자열을 저장하지 않는다.
- H6은 더 진행하지 않는다. bounded 3턴은 현재 단축어와 `shared-main`으로 유지하고 별도 server conversation 상태를 추가하지 않는다. 남은 후보(침묵 1200→1000ms, earcon, H3 되묻기)는 필요성이 생길 때만 별도 변경으로 연다.

### 첨부 · 일정 · 화면

- **첨부는 U3b(Codex 제목·요약)만 남았다.** U0~U2 · U3a · 인증된 원본 열기 · 이미지 썸네일은 Pi·iPhone 인수를 마쳤고 U4 공통 문서 계층은 실측 후 보류했다. 상세와 보류 근거는 `docs/galpi-attachment-upload-design.md`에 있다.
- **C2 반복 일정은 구현·Pi 배포까지 끝났다**(schema v17, `lib/assistant-task-series.js`, `ASSISTANT_TASK_SERIES_ENABLED`). 플래그는 Pi `.env`에만 `true`이고 `.env.example`에는 `false`로 있다. 계약은 `docs/task-reminder-design.md` 12·13절이다.
- **지식 패널의 첫 화면은 `XION` 홈이다**(탭 줄 맨 왼쪽, 기본 선택). `확인할 것` → `오늘` → 에이전트 상태 순서이고 기존 정본만 읽는 projection이라 서버 상태가 없다. 계약은 `docs/xion-home-design.md`다. **탭 키는 `agents`로 남겨둔다** — 설치된 Service Worker와 지난 알림이 `/?panel=agents` 링크를 들고 있다. 기본 탭은 `index.html`의 `active`·`hidden`과 `paper-panel.js`의 `state.activeTab` **두 곳**이 함께 정한다. 지식 패널이 데스크톱에서 350px 고정 폭이라(`grid-template-columns: minmax(0, 1fr) 350px`) 2열은 물리적으로 안 들어가고 모바일과 같은 1열을 쓴다.
- **대시보드는 채팅과 분리된 별도 창이고 아직 착수하지 않는다.** 착수 조건은 상시 확인 대상이 늘어나는 것인데 지금은 없다(V5-B가 `server.js`에 안 붙는 것이 계약이다). **그때까지 홈은 350px 안에 남고, "홈이 허전하다"를 패널 확장이나 카드 추가로 읽지 않는다.** 계약은 `docs/roadmap.md`의 V6 절이다.
- **홈 날씨는 2026-08-22 Pi 배포·실기기 인수로 닫혔다.** 정본은 `docs/xion-weather-design.md`이고(구현 기록 29절·관측 30절) 코드는 `lib/weather.js`·`lib/weather-routes.js`, 계약은 `test/weather*.test.js`다. 홈 쪽 파장은 `docs/xion-home-design.md` 12절이다.
- 상시 관찰: `chat:gpt-single-v1:a2`의 과회수·최신성·abstention, Web Push 잠금화면 표시, 실제 일정 생성의 KST 기한·알림·월별 projection. 승인 없는 가짜 운영 task는 만들지 않는다.

### 운영

- Pi에는 git이 없고 `/home/pi/galpi`는 git 체크아웃이 아니다. 배포는 바뀐 파일만 복사하고 SHA-256을 대조하며, 그 전에 DB·Vault 온라인 백업(`POST /api/backup`)과 코드 복구본 tar를 만든다. `sudo systemctl restart galpi`는 비밀번호가 필요하므로 사용자에게 요청한다.
- 맥 Obsidian 볼트는 Syncthing 폴더 `galpi-vault`로 `~/galpi-vault`에 **receiveonly** 단방향 미러다. 양방향으로 되돌리지 않는다.

### Codex 정리

- **정리가 멈추는 경로는 둘이고 원인이 다르다.** 실패한 job이 `pending`으로 되돌아가 worker를 멈추는 것과, 재시도 가능한 실패가 job을 `failed`로 끝내 노트가 `queued`에 갇히는 것이다. 둘 다 고쳤다 — job 선택은 "살아 있는 job이 들고 있지 않은 `pending`+`queued`"이고 `대기열 정리` 버튼은 새로 만들 노트가 없어도 밀린 job이 있으면 worker를 깨운다.
- **`owner_agent`가 있는 노트는 `knowledge_type`·`confidence`를 요구하지 않는다.** 그 둘은 사람이 쌓는 지식 노트의 성질이라 DB에서 다시 만드는 projection 노트에는 없다. 모두에게 요구하면 매달 생기는 `xion-schedule-YYYY-MM.md`가 영영 `needs_manual_check`로 쌓인다.
- **CODEX 링크의 대상은 이름 규칙이 아니라 존재 여부로 판정한다.** 이름 규칙 목록으로 가르면 새 노트 종류가 생길 때마다 그 목록이 낡아 같은 버그가 다시 난다.
- **`needs_manual_check`와 `recovery_required`는 사람이 할 수 있는 일이 다르다.** 검증 실패는 본문을 건드리지 않고 끝나므로 조치는 다시 돌리는 것이고, `recovery_required`는 원본이 위태로우니 재정리를 주지 않고 백업 대조 후 `확인 완료`만 남긴다. 복구 필요 노트가 하나라도 있으면 정리 전체가 fail-close로 멈춘다.

### V5-A 딜 스카우트 — 보류

- 수익 모델 불확실성 때문에 2026-08-04 잠정보류했고 2026-08-05 "진짜 나중"으로 다시 확인했다. 계정 신청·API 키·코드·외부 게시를 시작하지 않고, 다음 제품 작업 후보로 올리지 않는다.

### V5-B 스윙 트레이딩

- 코드는 `trading/`이고 `server.js`에 연결하지 않는다. Python 표준 라이브러리만 쓴다. 기준 문서는 `docs/trading/strategies/Swing Trading Agent Design v2 2.md`이고 **실측·완료 기록은 20.0절, 실험별 결과는 `trading/runs/<실험>/README.md`에 있다. 여기에 다시 쓰지 않는다.**
- **실전 경로는 구현하지 않는다.** PAPER config는 `KIS_PAPER_*`만 읽고 모의 호스트가 아니면 기동을 거부한다. 자격증명은 `trading/paper-credentials.env`(gitignore)에 사용자가 직접 넣고 나는 열지 않는다.
- **`bars_daily`는 지우지 않는다** — 적재분 `eodhd-15y-2026-08`은 908회 호출이고 EODHD 삭제 의무(해지 후 1개월) 대상이다. `edgar`·`delistings`·`universe` 단계는 공개 자료라 언제든 다시 만든다.
- **한 벌의 규칙이 코어이고 코어 하나가 파일 하나다**(`trading/core/`). `CoreDefinition.run_kwargs()`가 규칙 설정의 유일한 통로이고 `RULE_FIELDS`에 없는 것은 규칙이 아니다. `paper-core-v1`은 동결이고(`FreezeTest`) 변형은 새 코어로 만든다. **다만 서명은 엔진을 덮지 않아서** 옛 보고서의 숫자를 지금 엔진과 견주지 않는다.
- **계좌 낙폭을 규칙에 넣으면 자기 잠금이 된다**(손실 → 방어 → 진입 없음 → 낙폭 영구 고정). 문이 둘이라 한쪽만 닫으면 다른 쪽으로 걸린다. 연구 코어는 둘 다 풀고 일일·주간 손실 한도만 남긴다.
- **보유 세션은 시장 달력으로 센다.** 바가 있는 날만 세면 거래가 멈춘 종목이 영영 늙지 않아 슬롯을 영구 점유한다. 팔 수 없을 때는 `EXIT_PENDING_UNTRADEABLE`로 두되 가짜 체결을 만들지 않는다.
- **security identity 판정에 전략 파라미터를 쓰지 않는다.** 같은 이유로 레짐 게이팅은 상태 **이름**이 아니라 `new_entries`를 본다 — 이름으로 가르면 분류기를 바꾸는 순간 진입 상한이 조용히 0이 된다.
- **읽는 법.** 양수 기대값은 아무것도 증명하지 않는다(무작위 대조군도 전부 양수였다). 결과는 무작위 대조군과 노출 일치 벤치마크 둘과 함께 읽는다. 중첩 표본을 유의성으로 읽지 않는다. 무작위 표본은 비교 대상과 정확히 같은 크기로 뽑는다. `allocation_weighted_mean`은 정렬 진단이지 포트폴리오 수익률이 아니다. `open_risk`는 남은 위험이지 배정된 위험이 아니다. **모든 전략 실험의 primary는 `after-cost exposure-matched SPY gap > 0` 하나다.**
- **관찰자는 결과를 바꾸지 않는다.** `entry_observer`는 읽기 전용이고 `test_funnel.py`가 그것을 잠근다. 진단용 sizing 계산기를 따로 만들지 않고 엔진의 `SizedIntent`·`Caps`를 그 자리에서 읽는다.
- **홀드아웃은 코드 불변식이다**(`trading/backtest/holdout.py`, `HOLDOUT_START = "2025-08-07"`). 연구 러너는 세션 달력 자체를 그 전에서 자른다. **이미 두 번 소모됐고 `2025-08-07` 이후는 `CONTAMINATED_FOR_FORMAL_OOS`다** — 통과해도 "out-of-sample 검증을 통과했다"고 쓰지 않는다. `holdout_run_count`는 정책 서명이 아니라 구간 단위로 세므로 "새 코어가 홀드아웃을 공짜로 다시 연다"는 구멍은 없지만, **같은 정책 + 엔진만 변경**과 **신호 층 연구**는 못 센다. append-only 추적(`holdout_consumptions`)은 전략 freeze 전 별도 infrastructure PR이다.
- **`absolute_momentum`은 `relative_strength`의 자기 항이고 한 곳에만 정의한다.** 복제하면 "같은 형성기간"이라던 두 신호가 조용히 다른 것을 재게 된다.
- **동결하는 것은 전략이 아니라 알파 신호다.** 주 알파 `RS(126,5)`, frozen control `RS(63,5)`. 포트폴리오 비교의 **기준선**은 J63이고 조립 대상인 **동결 알파**가 J126이다. 두 역할을 한 단어로 합치지 않는다.
- **control과 challenger는 `policy_id`만 다르고 행동 규칙은 전부 같다.** 서명을 공유하면 `record_holdout_run`이 두 팔을 같은 행으로 덮어쓴다.
- **`FIXED_HOLD` 계열의 위험 회계는 legacy volatility-budget accounting이다.** `planned_risk`·`open_risk`·`return_r` 같은 이름이 남아 있지만 집행되는 손절선도 최대손실 한도도 아니다. **0.25%가 무엇인지는 코어가 아니라 `exit_mode`가 정한다** — `CORE`·`FIXED_HOLD_HARD_STOP`은 planned stop risk이고 `FIXED_HOLD`·`SIGNAL_INVALIDATION`은 volatility sizing budget이다. 정본 설명은 `core/jt.py` 한 곳이다.
- **연구 코어는 구조적으로 `UNDETERMINED`를 벗어날 수 없다.** JT 코어는 전부 `require_earnings_calendar=False`라 `EARNINGS_GATE_DISABLED` blocker가 항상 붙는다.
- **`momentum-v2`는 2026-08-17 종료됐다.** 알파 개입 네 번(시장 상태 · 종목 absolute momentum · signal-aligned exit · FIP quality)을 전부 쓰고 §4 경제성 허들을 통과하지 못해 로드맵 §8의 종료 조건이 발동했다. Phase 7~9를 열지 않는다. **다시 열지 않는 축**: J/K·슬롯·랭크 cutoff 재탐색 · sizing ablation · BULL-only 게이트 · 레짐 조건부 J · alternate SMA·ATR threshold·confirmation days·buffer · 1.5/2.5/3ATR·trailing stop·stop confirmation · FIP threshold/window/quality filter. 각 종료 근거는 `docs/trading/momentum-v2-roadmap.md`의 Phase별 절과 해당 `runs/*/README.md`에 있다.
- 미해결로 남긴 것: 정체불명 계열 23개(`MER`·`JAVA`·`RX`…), CIK 3개(`FMCN`·`LMCA`·`LMCK`), 섹터 11개(`ACAS`·`YHOO`). 섹터 게이트가 fail-close라 그 종목들은 진입이 막힌다. 외국 발행사와 주 인가 은행은 실적일을 만들 수 없는데, **결과를 낙관적으로 만들지 않고 기회만 좁히므로** 14.7 판정을 막지 않는다.

## 구조 방향

- 새 기능은 독립 모듈에 두고 `server.js`에는 설정과 얇은 연결만 추가한다. 기존 대형 코드는 관련 영역을 실제로 수정할 때 회귀 테스트와 함께 점진적으로 옮긴다.
- 비용은 provider 공식 Billing에서 직접 확인한다. 로그인 정보·쿠키·관리자 키를 앱에 저장하거나 잔액 자동 조회를 만들지 않는다.
- 노트 구조 v4와 CODEX 마커 경계를 유지한다. 폴더·범용 ACL·`relative_path`는 아직 도입하지 않는다.
