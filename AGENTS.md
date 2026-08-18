# AGENTS.md

## 기본 규칙

- 저장할 프로젝트 인계 사항은 이 파일에 남긴다. 완료된 배포 이력과 수치는 상세 설계 문서·git에 두고 여기에는 현재 계약과 다음 작업만 유지한다.
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
- 트레이딩(V5-B): `docs/Swing Trading Agent Design v2 2.md`. 실측·완료 기록은 20.0절이다.
- 트레이딩 전략 구축 계약: `docs/momentum-v2-roadmap.md`. **연구 예산·종료 조건·Phase별 사전등록이 여기 있다.** 실험 산출물 색인은 `trading/runs/README.md`다.
- 메일 에이전트(독립 트랙 MAIL-1~4): `docs/xion-mail-agent-design-final.md`. 스키마·Phase·통과 기준이 전부 그 문서에 있다.
- 세부 설계는 각 기능 문서를 단일 기준으로 삼고, 이 파일에 상세 이력을 복제하지 않는다.

## 현재 제품과 운영 경계

- 제품은 `갈피`(`galpi`), 화면 비서는 `시온`(`XION`)이다. Pi 운영 경로는 `/home/pi/galpi`, `galpi.db`, `galpi-vault`, `galpi.service`다.
- 메인 채팅은 단일 GPT다. 신규 의회 실행은 `410`으로 퇴역했고 기존 의회 대화·transcript·노트의 읽기·검색 호환성만 유지한다. 채팅 `자동`은 `gpt-5.6-terra`, Codex 일반은 `gpt-5.6-luna`, Codex 깊은 재처리는 `gpt-5.5`다. Codex 모델의 정본은 `app_settings`이고 기동 로그는 env 기본값을 찍으므로 실제 값은 DB에서 확인한다.
- A2는 전역 `ready` topic 청크를 보수적으로 최대 8,000자 주입한다. 명시 선택 노트와 비topic 자료는 기존 경로를 유지하고, 관찰에는 질문 원문 대신 `query_sha256`·`runtime_generation`을 쓴다.
- DB가 대화·task·상태의 정본이다. topic Markdown QA-LOG는 사람에게 보이는 Q&A 정본이고 `note_chunks`는 재생성 가능한 검색 인덱스다. Codex는 허용 마커만 수정하며 `recovery_required` fail-close·원자적 finalization을 유지한다.
- 첨부가 연결된 턴은 `<context>` 마지막 `<current_attachments>` 블록으로 파일명만 알리고 지시는 시스템 프롬프트에만 둔다. 저장되는 메시지 본문과 화면 표시는 바꾸지 않는다. 새 첨부의 파싱은 채팅 요청 안에서 끝나므로 그동안 `attachment_parse` 단계를 보낸다.
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

- **메일 에이전트 MAIL-2는 2026-08-18 Pi 배포·인수까지 마쳤고 다음은 MAIL-3다.** 계약·스키마·단계·실측은 `docs/xion-mail-agent-design-final.md`와 `docs/roadmap.md`의 독립 트랙 `MAIL-1~4`에 있다(`V5-C`는 외부 캘린더 에이전트가 쓰는 다른 이름이다). 코드로 잠긴 계약은 여기 옮겨 적지 않는다 — `lib/mail/*`와 `test/mail-*.test.js`가 정본이다. 아래는 코드 밖 사실만이다.
- **Pi가 메일의 정본이고 로컬은 `MAIL_AGENT_ENABLED=false`다.** 둘 다 켜면 커서가 갈리고 같은 새 메일을 양쪽이 분석해 LLM 호출과 Attention이 두 벌이 된다. 로컬에서 메일 작업을 할 때만 잠깐 켜고 끝나면 되돌린다.
- **`MAIL_AGENT_ENABLED=true`인 환경에서는 서버를 띄우는 순간 실계정 메일이 동기화·분석되고 OpenAI 호출이 나간다.** 2026-08-18 문법 확인용으로 띄운 로컬 서버가 13시간 살아남아 실제 메일 6건을 분석한 적이 있다. 문법 확인은 `node --check`로 끝내고, 서버를 띄우면 PID를 잡아 반드시 종료한다.
- **자격증명은 Pi `.env`(`chmod 600`, 백업 대상 아님)와 로컬 `.env` 양쪽에 있다.** **Google OAuth 앱은 `In production`으로 게시하되 인증은 제출하지 않는다**(개인 사용 면제, 제출하면 restricted scope라 CASA가 붙는다). 분석 모델은 `MAIL_ANALYZER_MODEL` 기본 `gpt-5.6-luna`이고 채팅 자동 모델을 상속하지 않는다.
- **fixture 게이트가 통과한 것은 세 번째 계약이다.** v1 단발 게이트는 FAIL이었고 그 뒤 (1) 판정을 반복 실행 기반으로 바꾸고 (2) safety와 quality를 갈랐으며 (3) fixture 기대값 넷을 설계 기준으로 고쳤다. 각 변경의 근거는 설계 원문이고 커밋 메시지와 fixture note에 있지만, **결과를 본 뒤에 계약이 움직였다는 사실 자체를 기록해 둔다.** 판정 규칙은 `scripts/evaluate-mail-fixtures.js` 주석이 정본이다.
- **판단의 run-to-run 흔들림은 남아 있고, 모델·파라미터로는 못 고친다는 것을 2026-08-18 실측으로 확인했다.** 실제 메일함에서 같은 발신자의 인증번호 3통이 `action_required/immediate` · `important/immediate` · `info/silent`로 갈린 것이 계기였다. **사용자 판단으로 OTP 건 자체는 수용했다** — 인증번호는 어차피 바로 확인하므로 알림이 흔들려도 실제 손해가 없다. 다만 **흔들림은 OTP만의 문제가 아니다**(`github-notification`의 `silent↔batch`, `huge-newsletter`의 `ignore↔info`). 흔들리는 자리가 대부분 설계가 경계를 긋지 않은 곳이라, 판단 층에서 없애려 하면 과적합이 된다. **MAIL-3의 batch 묶기로 라우팅 층에서 흡수하는 쪽이 설계에 맞다** — 판단이 흔들려도 사용자가 겪는 알림은 일정해진다. 그리고 "바로 확인하니 안 울려도 된다"는 발신자별 취향은 프롬프트가 아니라 `mail_preferences`의 sender `suppress_notification`이 설계된 자리다(MAIL-4).
- **막힌 길 둘을 기록해 둔다. 다시 시도하지 않는다.** (1) **`reasoning.effort`**: 이 모델은 `temperature`·`seed`를 400으로 거부하고, `none`은 consistency를 12/18 → 15/18로 올렸지만 `deadline 오탐`을 0 → 4/180으로 만들어 safety를 깼다. 명시된 날짜는 10/10 정확한데 `"목요일 회의 전까지"` 같은 상대 표현을 4/10에서 놓친다. `low`·`medium`은 기본값보다 더 흔들렸다. (2) **Terra 승격**: 같은 조건 18×10에서 **hard safety를 셋 깼다**(falseNegative 17/180 · deadline 오탐 6/180 · actionMissed 7/180). 상대 기한 적중률도 Luna 28/30 대비 **13/30**이고 이탈 17건이 전부 **시각을 지어낸 `datetime`**이라 설계 10.6이 금지한 동작이다. Terra가 빠르고(median 2.4s vs 3.6s) 출력 토큰이 1/3이지만 안전 조건을 통과한 뒤에나 의미가 있다. **Terra의 consistency가 오히려 높았는데(13/18 vs 11/18) 그것은 일관되게 틀린 결과였다** — OTP를 꾸준히 `silent`로 보내고 상대 기한을 꾸준히 `datetime`으로 만든다. 일관성은 정확성이 아니다. **총계 지표는 Luna끼리도 한 시간 간격 재실행에서 consistency 12→11 · falsePositive 1→2로 움직이므로 몇 건 차이는 노이즈로 읽는다.** 비교는 `npm run eval:mail-fixtures -- --runs N [--model M] [--reasoning X]`로 다시 한다.
- H3 되묻기 문턱은 실제 오전사 표본이 더 쌓인 뒤 정한다. 현재 작은 표본에서 정확 전사는 `min logprob -0.024~-0.425`, 오류 전사는 `-0.652`, `-1.356`이었지만 확정 문턱으로 쓰기엔 부족하다. 로그에는 토큰 문자열을 저장하지 않는다.
- H6의 동일 request ID iPhone 재시도·화면 소등 10회 기준·추가 기기 등록은 더 진행하지 않는다. bounded 3턴은 현재 단축어와 `shared-main`으로 유지하고 별도 server conversation 상태를 추가하지 않는다. 남은 음성 후보인 침묵 1200→1000ms, earcon, H3 되묻기는 각각 필요성이 생길 때만 별도 변경으로 연다.
- 상시 관찰: 새 `chat:gpt-single-v1:a2`의 과회수·최신성·abstention, Web Push 잠금화면 10회 표시, 다음 실제 일정 생성의 KST 기한·알림·월별 projection. 승인 없는 가짜 운영 task는 만들지 않는다.
- **C2 반복 일정은 2026-08-08 설계를 확정하고 구현에 들어간다.** 기준은 `docs/task-reminder-design.md` 13절이고 단계는 같은 문서 12절의 C2a~C2g다. 반복 master는 새 `assistant_task_series`, **회차는 `series_id`를 가진 평범한 `assistant_tasks` 행**이라 완료·취소·달력·월별 노트·Web Push가 그대로 돌고 `assistant_reminders`는 바뀌지 않는다. 그래서 override는 새 경로가 아니라 기존 `PATCH /api/tasks/:id`와 `/cancel`이다. 규칙은 `매일 | 평일 | 매주 요일 | 매월 n일` 넷이고 없는 날짜의 회차는 만들지 않는다. 회차 창은 향후 60일이라 그보다 먼 달력에는 반복이 비어 보인다. 시온의 자연어 override는 회차 하나든 시리즈 전체든 **무저장 확인 카드**를 거친다 — 무카드 즉시 적용은 실패가 조용하고 대상 지목 단계가 추가돼 접었다(13.8). 전부 `ASSISTANT_TASK_SERIES_ENABLED` 기본 `false` 뒤에 둔다.
- V5-A 딜 스카우트(쿠팡봇)는 수익 모델 불확실성 때문에 2026-08-04 잠정보류했고, 2026-08-05 사용자가 "진짜 나중"으로 다시 확인했다. 계정 신청·API 키·코드·외부 게시를 시작하지 않는다. 다음 제품 작업을 고를 때 딜 스카우트를 후보로 올리지 않는다. 2026-08-05 **트레이딩 봇 먼저, 강의 노트는 그 모의투자 관찰 기간에 병행**으로 정했다(설계 20.2와 같은 순서).
- 첨부 U0a~U1c는 Pi·iPhone 인수를, U3a는 Pi·브라우저 인수를 마쳤다. U3a는 MD·TXT·PDF의 명시적 `library` 승격, Attachment 노트, 일반 서재 재회수다. library-only 후속 답변은 일반 저장을 허용하고 temporary 후보가 하나라도 살아 있으면 계속 막는다. iPhone 실기기 저장과 Codex 요약(U3b)은 남았다.
- 이미지 썸네일까지 2026-08-05 Pi·iPhone 인수해 첨부 트랙은 사실상 닫혔다. 서버 리사이즈가 없어 원본을 한 번 받아 캔버스로 72px까지 줄이고 큰 blob은 즉시 놓아준다. 축소본은 attachmentId별로 캐시(상한 24)하고 IntersectionObserver로 보일 때만 받는다. 이미지의 `원본` 버튼은 원본을 다시 받는데 축소본만 남기는 대신 치르는 비용이다.
- U4 공통 문서 계층은 2026-08-05 실측 후 보류했다. 파서와 PDF 청커는 이미 `paper-fulltext`에서 import해 공유 중이고, 이름이 같은 `cleanEvidenceItem`·`fitToolPayload`는 필드와 알고리즘이 달라 합치면 배포된 회수 동작이 바뀐다. 근거는 설계 문서 U4 절에 있다.
- 논문 전문 URL 후보는 `open_access_pdf_url`(S2 기본) → `alternate_pdf_url`(사용자가 확인한 대체) → `arxiv_id` 순이다. DNS·timeout·일반 연결·HTTP 실패에서만 다음 후보를 시도하고 URL/SSRF·PDF 형식·크기·파싱 실패는 우회하지 않는다. 성공한 원본은 기존 `paper_documents` 캐시를 재사용한다. 브라우저 외부 링크는 실패를 감지해 다음 후보로 넘길 수 없으므로 `원문 PDF` 버튼은 대체 URL이 있으면 그것을 우선 연다.
- 인증된 원본 열기는 2026-08-05 Pi 배포했다. `GET /api/attachments/:id/original`이 scope별로 판정해 임시는 그 대화 안에서만, 서재는 대화와 무관하게 스트리밍한다. PDF·이미지는 inline이고 MD·TXT는 attachment로 내려받게 한다. 열 때 전체 sha256은 다시 계산하지 않고 경로와 크기만 본다. 인증이 헤더 토큰이라 클라이언트는 blob을 받아 object URL로 열며, iOS 팝업 차단 때문에 클릭 시점에 빈 창을 먼저 잡는다. 이 폴백은 실기기 확인이 남았다.
- U2 이미지 읽기와 이미지 library 승격을 2026-08-05 Pi·iPhone 인수했다. 이미지는 도구가 아니라 그 턴의 모델 입력에 base64로 직접 실리고 replay 창은 3턴, 턴 예산은 8장·12MiB다. 메시지당 첨부는 6개이고 그중 문서는 1개, 이미지 합계는 12MiB다. 모델의 이미지 입력은 1x1 PNG probe로 따로 판정하며 미지원 고정 모델은 조용히 바꾸지 않고 409로 알린다. 이번 턴 첨부는 사용자가 올린 순서를 유지하고 replay만 오래된 것부터 놓는다. 승격된 이미지는 replay 창 안에서 계속 보이되 자동 topic 저장 차단에는 세지 않는다.
- Pi에는 git이 없고 `/home/pi/galpi`는 git 체크아웃이 아니다. 배포는 바뀐 파일만 복사하고 SHA-256을 대조하는 방식이며, 그 전에 DB·Vault 온라인 백업(`POST /api/backup`)과 코드 복구본 tar를 만든다. `sudo systemctl restart galpi`는 비밀번호가 필요하므로 사용자에게 요청한다.
- 맥 Obsidian 볼트는 Syncthing 폴더 `galpi-vault`로 `~/galpi-vault`에 **receiveonly** 단방향 미러다. 이관 때 옛 `aic-vault` 폴더가 버려진 `ai-council-vault`를 가리켜 2026-07-18부터 08-05까지 동기화가 끊겨 있었다. 양방향으로 되돌리지 않는다.
- **Codex 정리가 멈추는 경로는 둘이고 원인이 다르다.** (1) 실패한 job은 `pending`으로 되돌아가면서 worker를 멈춘다. 그 뒤로는 새 저장이 worker를 깨울 때까지 아무도 다시 돌리지 않는다 — 2026-08-08 Pi의 job 42(재시도 8회)·43이 이 상태였고 `queued` 노트 4개를 그 둘이 들고 있었다. (2) 재시도 가능한 실패가 job을 `failed`로 끝내면 노트는 `queued`로 남는데, 새 job은 `pending`만 골라서 그 노트가 어디에도 다시 들어가지 못한다. 둘 다 고쳤다. job 선택은 "살아 있는 job이 들고 있지 않은 `pending`+`queued`"이고, 에이전트 탭 사서 Codex 블록의 `대기열 정리` 버튼은 새로 만들 노트가 없어도 밀려 있는 job이 있으면 worker를 깨운다. `/api/organize/status`가 `queueable`·`stranded`·`waitingJobs`를 준다.
- **`owner_agent`가 있는 노트는 `knowledge_type`·`confidence`를 요구하지 않는다.** 그 둘은 사람이 쌓는 지식 노트의 성질이라 DB에서 다시 만들어내는 projection 노트에는 없다. 모두에게 요구하면 매달 생기는 `xion-schedule-YYYY-MM.md`가 영영 정리를 통과하지 못하고 `needs_manual_check`로 쌓인다(2026-08-08 실제로 7월·8월 노트가 걸렸다). 예외는 그 두 필드뿐이고 CODEX 마커와 나머지 필수 frontmatter는 그대로 받는다. `validate-codex-edit.js`는 서브프로세스라 재시작 없이 적용된다.
- **CODEX 링크의 대상은 이름 규칙이 아니라 존재 여부로 판정한다.** 볼트에는 대화 노트의 타임스탬프 이름 말고도 `attachment-...`·`xion-schedule-...`이 있는데, 검증기가 타임스탬프만 파일 ID로 인정해서 Codex가 첨부 노트로 정당한 링크를 걸 때마다 정리가 통째로 실패했다(2026-08-08 `논문 검색 서비스`·`강의 노트 설계 문서`가 재현되게 걸렸다). 이제 볼트에 있는 파일이면 통과하고, 없을 때만 사유를 가른다 — 공백이 있으면 제목을 ID 자리에 쓴 것이고 아니면 대상 파일 없음이다. 이름 규칙 목록으로 가르지 않는 이유는 새 노트 종류가 생길 때마다 그 목록이 낡아서 같은 버그가 다시 나기 때문이다.
- **`needs_manual_check`와 `recovery_required`는 사람이 할 수 있는 일이 다르다.** 검증 실패는 본문을 건드리지 않고 끝나므로 열어봐야 고칠 것이 없고, 실제 조치는 다시 돌리는 것이다. 그래서 알림 카드가 노트별 실패 사유(`notes.codex_last_error`, schema v18)를 보여주고 `재정리`·`정리된 것으로 두기`를 준다. `recovery_required`는 원본이 위태로우니 재정리를 주지 않고 백업 대조 후 `확인 완료`만 남긴다. 복구 필요 노트가 하나라도 있으면 정리 전체가 fail-close로 멈추므로 그동안은 다른 노트의 `재정리`도 내밀지 않는다. 사유는 redact 이전 원문을 `parseCodexValidationWarnings`로 쪼개 붙인다 — 이름을 `[노트]`로 가린 뒤에는 어느 경고가 어느 노트 것인지 되살릴 수 없다. 사서 블록의 `멈춘 N개 다시`가 일괄 재정리다.
- V5-B 스윙 트레이딩. 코드는 `trading/`이고 `server.js`에 연결하지 않는다. Python 표준 라이브러리만 쓴다. 기준 문서는 `docs/Swing Trading Agent Design v2 2.md`이고 **실측·완료 기록은 전부 그 문서 20.0절에 있다** — 여기에 다시 쓰지 않는다.
- **실전 경로는 구현하지 않는다.** PAPER config는 `KIS_PAPER_*`만 읽고 모의 호스트가 아니면 기동을 거부한다. 자격증명은 `trading/paper-credentials.env`(gitignore)에 사용자가 직접 넣고 나는 열지 않는다. 모의 제약은 미체결내역(`TTTS3018R`) 미지원(내부 원장이 정본), 호출 1초 간격, 접근토큰 1분 1회다.
- 적재분은 `eodhd-15y-2026-08` 하나다(바 958종목 3.86M행, 구성원 구간 1,237개 위반 0, 미커버 0, `survivorship_biased=False`). **`bars_daily`는 지우지 않는다** — 908회 호출이고 EODHD 삭제 의무(해지 후 1개월) 대상이다. `edgar`·`delistings`·`universe` 단계는 공개 자료라 언제든 다시 만든다. **구독은 Stripe 자동갱신이고 해지 결정은 열려 있다.**
- **한 벌의 규칙이 코어이고 코어 하나가 파일 하나다**(`trading/core/`). 진입·청산·레짐 모드는 정책 서명 밖이라 코어 파일이 아니면 어디에도 안 남는다. `CoreDefinition.run_kwargs()`가 규칙 설정의 유일한 통로이고 러너는 구간·시나리오만 얹는다. `RULE_FIELDS`에 없는 것은 규칙이 아니다. 산출물은 `trading/runs/<실험>/`이고 폴더마다 README가 무엇을 물었고 무엇이 답이었는지 적는다.
- `paper-core-v1`은 동결이다(서명 `sha256:9e06ee9…`, `FreezeTest`). 변형은 새 코어로 만든다. **다만 서명은 엔진을 덮지 않는다** — 2026-08-10 기준선 보고서는 지금 엔진과 다른 숫자이고 견주지 않는다(`runs/baseline/README.md`).
- **계좌 낙폭을 규칙에 넣으면 자기 잠금이 된다.** 손실 → 방어 → 진입 없음 → 자산 정지 → 낙폭 영구 고정. 문이 둘이고(`risk.py`의 한도 넷, `regime.py`의 `green_max_drawdown`·`red_min_drawdown`) 하나만 닫으면 다른 쪽으로 걸린다. 연구 코어는 둘 다 풀고 일일·주간 손실 한도만 남긴다.
- **보유 세션은 시장 달력으로 센다.** 바가 있는 날만 세면 거래가 멈춘 종목이 영영 늙지 않아 슬롯을 영구 점유한다. 바가 없는 것 자체는 청산 신호가 아니고, 팔 수 없을 때는 `EXIT_PENDING_UNTRADEABLE`로 두되 가짜 체결을 만들지 않는다. 폐지·era 종료는 `delistings` 표가 판정하고 재개를 기다리지 않는다.
- **security identity 판정에 전략 파라미터를 쓰지 않는다.** `IDENTITY_MAX_GAP_SESSIONS`(데이터 계층)가 하고, `max_hold` 같은 값으로 대신하면 K=21과 K=42가 같은 티커를 다른 회사로 읽는다. 같은 이유로 레짐 게이팅은 상태 **이름**이 아니라 `new_entries`를 본다 — 이름으로 가르면 분류기를 바꾸는 순간 진입 상한이 조용히 0이 된다.
- **양수 기대값은 아무것도 증명하지 않는다.** 무작위 선택 대조군도 10시드 전부 양수였다. 결과는 **무작위 대조군**과 **노출 일치 벤치마크** 둘과 함께 읽는다. 2026-08-14 J/K 실험의 결론은 "랭킹은 노출당 효율에서 무작위를 이기지만(격차 -12.7%p vs -44.7%p) 자기 벤치마크는 못 이긴다"이다.
- **홀드아웃은 이제 코드 불변식이다**(`trading/backtest/holdout.py`, `HOLDOUT_START = "2025-08-07"`). 연구 러너는 세션 달력 자체를 그 전에서 잘라 쓴다 — 신호일만 거르면 `t+84`가 홀드아웃 안의 종가를 읽어 같은 누수가 된다. 넘으려면 `consume_holdout=True`를 명시해야 하고 그때는 산출물에 `HOLDOUT_CONSUMED = true`가 남는다. `plan_walk_forward`가 내는 홀드아웃 시작은 적재분 마지막 세션에서 거꾸로 센 값이라 바를 더 받으면 움직이므로 상수와 어긋나는지 확인하는 데만 쓴다.
- **홀드아웃은 두 번 소모됐다.** 2026-08-10 기준선 판정이 한 번, 2026-08-14 신호 연구가 한 번이다(구간이 2026-08-07까지였다). `record_holdout_run`은 정책 서명으로 세는데 신호 연구는 백테스트가 아니라 그 계수기에 잡히지도 않았다. 같은 이유로 **엔진 변경도 세지 못한다.** 지금 잘라 냈다고 표본 밖으로 돌아가지 않는다.
- **무작위 표본은 비교 대상과 정확히 같은 크기로 뽑는다.** 5종목 라벨을 52종목 분포와 견주면 좁은 쪽이 공짜로 유의해 보인다. 크기는 십분위 배정이 실제로 넘긴 수(`bucket_sizes`)를 쓴다 — `len // 10`은 나머지가 있을 때 한 종목 모자라다. 측정해 보니 5종목 분포의 표준편차는 0.02~0.09%로 어림(±0.2%)보다 훨씬 좁았다. 매일 4,422번 뽑아 평균 내면 표본 하나의 폭이 씻겨나가기 때문이다.
- **중첩 표본을 유의성으로 읽지 않는다.** 매일 뽑으면 +84 수익률이 83/84 겹쳐 관측이 수천 개처럼 보여도 독립인 것은 53개다. K개 위상을 각각 평균 내 흩어짐을 보고, D1뿐 아니라 TOP5도 본다. **+42 이상에서는 두 유니버스 모두 부호가 뒤집히는 위상이 있다** — 합집합 +84는 위상 최소 -1.33%·중앙 +0.61%·최대 +3.46%이고 중앙이 매일 표본(+0.91%)보다 낮다. 첫 실행의 "부호가 뒤집히는 위상은 없다"는 D1만 본 오염된 표였다.
- 지평별 신호일 집합이 달라서 생기는 착시는 **common anchors**로 지웠다. +84까지 관측되는 4,343개 날짜만 써도 21→42→63→84 방향과 값이 거의 그대로다. 감쇠 없음은 표본 창 차이가 아니다.
- **긴 신호 수명은 포트폴리오 수익이 되지 않는다**(2026-08-15 K 실험, `runs/jt-k-lifetime/README.md`). K=42/63/84를 `max_hold_sessions`만 바꿔 돌렸더니 거래당 기대값은 0.229→0.244→0.388로 커지는데 총수익은 +35.4%→+21.9%→+26.2%로 줄고 MDD는 9.4%→13.6%로 커진다. 노출 일치 격차도 -12.7→-25.1→-16.7%p로 나빠진다. **K는 42를 기준선으로 유지한다.**
- **`ALREADY_HELD` 증가를 "후보 공급 부족"으로 읽지 않는다.** 관측된 것은 `MAX_POSITIONS_REACHED` 감소와 `ALREADY_HELD` 증가뿐이고, 그것만으로 `max_candidates=5`가 모자라다고 결론낼 수 없다. **"후보 공급 부족"과 "같은 극단 상위 종목이 여러 날 반복되는 낮은 churn"은 다른 것이고 잰 것은 후자다.** TOP10·TOP20·동적 후보 수를 새 전략 가설로 만들지 않고 `max_candidates`를 바꾸지 않는다.
- **`open_risk`는 남은 위험이지 배정된 위험이 아니다**(`수량 × max(0, min(현재가, 진입가) − 손절가)`). 만기 청산만 있어 손절 청산이 없으므로 손절가 아래 포지션은 0으로 잡힌다. 위험 사용률 19~30%를 "예산을 그만큼만 배정했다"로 읽지 않는다. 어느 쪽이든 **총 위험 한도는 한 번도 구속하지 않았고 구속한 것은 자리였다.**
- **사전등록 판정은 `NO_CLEAR_STAGE`·`INCONCLUSIVE`이고 이것을 "층 사이에 아무 일도 없었다"로 읽지 않는다.** `classify_pattern`이 PATTERN S의 "R 또는 달러에서 **축소 또는 역전**"을 역전(`≤0`)만으로 구현해서 이번 데이터가 그 틈에 떨어졌다. **결과를 본 뒤 문턱을 고치지 않았고** 크기 변화는 탐색적 절로 분리했다. 읽을 수 있는 것은 "사전등록한 부호 기준으로는 collapse point를 지목할 수 없다"까지다. **sizing ablation을 지금 열지 않는다.**
- **관찰자는 결과를 바꾸지 않는다.** `run_backtest`의 `entry_observer`는 읽기 전용이고 `observer=None`과 켠 실행의 거래·체결·자산곡선·스킵·지표가 같다는 것을 `test_funnel.py`가 잠근다. **진단용 sizing 계산기를 만들지 않는다** — 엔진의 `SizedIntent`·`Caps`를 그 자리에서 읽는다. 복제하면 그 복제본이 엔진과 갈릴 자리가 생긴다.
- **`allocation_weighted_mean`을 포트폴리오 수익률로 부르지 않는다.** `Σ(w·r)/Σw`는 서로 다른 날짜의 거래를 정적으로 모은 **정렬 진단**이다. 자본이 시간에 따라 굴러가지 않고 동시 보유도 재현하지 않으므로 counterfactual·백테스트 수익률이 아니다. equal weight·fixed notional 재실행은 하지 않았다.
- **다음 작업은 `docs/momentum-v2-roadmap.md`가 정한다.** 우리는 모멘텀 전략을 만든 것이 아니라 **모멘텀 신호를 분리·검증**했고, 그것을 돈 버는 전략으로 조립하는 단계는 아직 시작하지 않았다. 알파 개입은 **네 번까지만** 허용한다 — 시장 상태 → 종목 absolute momentum → signal-aligned exit → FIP quality. 넷을 다 써도 **§4 전체 경제성 허들을 통과하지 못하면** long-only cross-sectional momentum 단독 전략은 **종료**한다(로드맵 §8, 2026-08-17 정정). **2026-08-17 이 조건이 발동해 계열은 종료됐다.** **J·K·슬롯·랭크 cutoff 재탐색 금지.** 각 Phase는 독립 PR + 사전등록 + 사용자 승인이고 **결과를 보고 자동 진행하지 않는다.**
- **동결하는 것은 전략이 아니라 알파 신호다.** 주 알파는 `RS(126,5)`, frozen control은 `RS(63,5)`다. **이것은 PR #13의 "개발 기준선은 J63 유지"를 뒤집지 않는다** — 포트폴리오 비교의 **기준선(baseline)**은 J63이고, 조립 대상인 **동결 알파(alpha under test)**가 J126이다. 두 역할을 한 단어로 합쳐 "기준선을 J126으로 바꿨다"고 쓰지 않는다.
- **모든 전략 실험의 primary는 `after-cost exposure-matched SPY gap > 0` 하나다.** 총수익만 보면 착시가 크다 — `jt-k42`는 18.6년 총수익 +35.4%(CAGR 1.65%)인데 같은 기간 SPY 매수보유가 **+531.7%**이고, 설계 14.7 게이트에서 Sharpe 0.375·Sortino 0.525·Calmar 0.176으로 **하드 최소를 셋 미달**한다. **matched-SPY를 못 이긴 것은 "아직 전략 아님"이다.**
- **`ABS(126,5) > 0` 후보 조건은 이 구조에서 구속력이 없다 — `NON_BINDING`**(2026-08-16 PR #17, `runs/absolute-momentum-signal/`). 유효 paired 날짜 3,385일 중 **TOP5 구성이 바뀐 날이 0일**이고 후보 교체율도 0/16,925다. ALL·NDX100 둘 다 같다. HARD A 실패로 **`DO_NOT_PROMOTE_ABS_TO_PORTFOLIO`이고 ABS candidate intervention은 종료한다** — 문턱·horizon·ranking weight 변경도, SMA/breakout 대안도 열지 않는다. **예정했던 ABS Portfolio Translation은 열지 않는다** — 번호가 밀리지 않으므로 다음 `#18`은 Signal Invalidation Exit다.
- **`absolute_momentum`은 `relative_strength`의 자기 항이고 한 곳에만 정의한다.** `RS = ABS(자기) − ABS(시장)`으로 리팩터했고 RS 값은 **비트 단위로 동일**하다. 복제하면 "같은 형성기간"이라던 두 신호가 조용히 다른 것을 재게 된다.
- **알파 개입 네 번을 전부 썼다 — long-only cross-sectional momentum 단독 전략의 alpha construction은 종료했다.** 시장 상태(PR #15·#16, **유지**) · 종목 absolute momentum(PR #17, **종료**) · signal-aligned exit(PR #18, **종료**) · FIP quality(PR #20, **종료**). 로드맵 §8의 종료 조건이 발동했고 **Phase 7~9(Reality Hardening · Robustness · Frozen Historical Sanity Check)를 열지 않는다.**
- **D가 한 위상 차이로 갈렸지만(25/42 = 59.5% vs 최소 60%) 문턱을 옮기지 않았다.** 사전등록 문턱을 결과를 본 뒤 고치면 로드맵 계약 전체가 무의미해진다. **다른 threshold · window · quality filter를 열지 않는다.**
- **Stage A가 FAIL이라 Stage B를 만들지 않았다.** FIP portfolio core도 `RS_ONLY_FIP`/`RANDOM_FIP` 진입 모드도 Stage B 러너도 저장소에 없고, `test_fip_signal.py`의 `StageGateTest`가 **Stage A가 승격이 아닐 때 그것들이 없다는 것**을 값으로 잠근다.
- **`information_discreteness`는 `features.py`의 순수 helper이고 `Features` dataclass·`features_daily` 스키마를 건드리지 않았다.** 넣었으면 `feature_hash`가 바뀌어 기존 캐시와 과거 산출물이 흔들린다. **크기로 가중하지 않고 부호 빈도만 본다** — 크기를 넣으면 RS의 magnitude 정보와 역할이 겹친다.
- **신호가 깨질 때 나가는 것은 fixed K42보다 나쁘다 — `RISK_ONLY`**(2026-08-17 PR #18, `runs/signal-invalidation-exit/`). control 재현은 여덟 항목 전부 일치했다(445거래 · +47.84% · 0.343R · PF 1.47 · Sharpe 0.46 · MDD 12.0% · 노출 16.4% · `G` +4.99%). 처치는 `exit_mode` 하나이고 `SPY <= SMA200`인 종가에 보유분을 표시해 다음 시초에 내보낸다. `ΔS` **−15.57%p**(+47.84% → +32.27%) · `ΔG` **−6.42%p**(+4.99% → −1.43%)로 두 marginal 조건이 모두 반대 방향이다. **개선된 것은 MDD 하나뿐이다**(12.0% → 10.6%). **fixed K42를 유지하고 alpha stack에 넣지 않는다.**
- **`MARKET_TREND_BREAK` 건수를 단축 건수로 읽지 않는 규칙은 이번에 구속하지 않았다.** 이 실행에서는 표시 = 체결 = 단축이 180으로 모두 같았다. **그래도 셋을 갈라 세는 코드와 테스트는 남긴다** — 값이 같았던 것은 이 구간에 거래정지·폐지 선점이 겹치지 않았기 때문이고 다음 실행에서 같다는 보장이 없다.
- **결과가 나쁘다고 대안을 열지 않는다.** 사전등록 §5가 confirmation days · buffer · alternate SMA · ATR threshold를 금지했고 그대로 지킨다. `SIGNAL_INVALIDATION` 청산 모드와 `jt-j126-k42-sma200-exit` 코어는 **기록·재현용**으로 남기고 `PARKED_RISK_OVERLAY_CANDIDATE`로 보존한다 — 보존과 alpha stack 포함을 섞지 않는다.
- **`ΔB`를 타이밍 그 자체로 읽지도 않는다.** 벤치마크 표의 "평균 노출 고정"(`F`)으로 한 번 더 가르면 `T = B − F`가 타이밍 몫이다. 실측은 `ΔF = −4.11%p` · `ΔT = **+0.51%p**`로, **`ΔB`의 음수는 대부분 평균 노출 수준이 낮아진 것에서 오고 타이밍 몫은 오히려 소폭 양수다.** 이것은 새 promotion criterion이 아니라 기존 secondary의 해석 정정이다.
- **`below_sma200_sessions`는 게이트가 막은 수가 아니다.** 시장이 SMA200 아래였던 세션 수(1,027)이고 **시장 라벨이 두 팔에서 같으므로 control에도 같은 값이 들어간다.** 처치가 실제로 작동한 횟수는 `REGIME_*` halt로 따로 세고 그쪽이 control 0 · gated 1,027이다. 앞의 값을 게이트 효과로 읽지 않는다.
- **게이트는 `new_entries`만 닫는다.** `gate_new_entries`가 익스포저 상한도 상태 이름도 청산도 건드리지 않아서 **보유 포지션은 게이트가 닫혀도 K42 만기까지 간다** — 그래야 진입 타이밍 효과만 잰다. 레짐 라벨이 그대로라 control과 레짐별 성과표를 견줄 수 있다는 것을 회귀 테스트가 실제 실행으로 확인한다.
- **control과 challenger는 `policy_id`만 다르고 행동 규칙은 전부 같다.** 서명을 공유하지 않는 이유는 `record_holdout_run`이 서명으로 홀드아웃 소모를 세기 때문이다 — 공유하면 두 팔이 같은 행으로 덮어써진다(로드맵 §7 C3-1). 감사 identity는 갈라야 하고 행동 규칙은 같아야 한다.
- **판정 label은 `(ΔS 부호, ΔG 부호, 위험)` 공간을 정확히 한 번씩 덮는다.** 사전등록 A~D가 두 칸을 비워둬서 결과 전에 `TIMING_BENEFIT_UNCONFIRMED`·`RELATIVE_ONLY`로 채웠고, **둘 다 alpha stack 승격이 아니다.** 144칸 전수 테스트가 빈칸도 겹침도 없음을 잠근다 — 빈칸이 있으면 결과가 거기 떨어졌을 때 사후에 label을 만들게 된다.
- **`holdout_run_count`는 정책 서명이 아니라 구간 단위로 센다.** `WHERE source_version = ? AND start_date = ? AND end_date = ?`이고 `policy_signature`는 조건에 없다. `run_id`에만 서명이 들어가는데 목적은 정반대다 — 같은 정책 재실행은 덮어써 1회로 남고 **다른 정책이면 새 행이 되어 `HOLDOUT_REUSED`가 붙는다.** 그래서 **"새 코어가 홀드아웃을 공짜로 다시 연다"는 구멍은 없다.** 실제 구멍은 둘이다 — **같은 정책 + 엔진만 변경**은 `run_id`가 같아 덮어쓰이고, **신호 층 연구**는 `record_holdout_run` 호출부가 `real_run.py` 하나뿐이라 아예 안 잡힌다. 그래서 현재 1행인데 실제 소모는 최소 2회다.
- **`2025-08-07` 이후는 `CONTAMINATED_FOR_FORMAL_OOS`다.** 이미 signal-layer 연구에서 관찰됐으므로 **formal OOS라고 부르지 않는다.** 로드맵 Phase 9의 역할도 `ONE-SHOT HOLDOUT`에서 **Frozen Historical Sanity Check**로 낮췄다 — 통과해도 "out-of-sample 검증을 통과했다"고 쓰지 않고 "구조가 무너지지는 않았다"까지만 읽는다. **진짜 OOS 판결은 최종 전략 freeze 이후 새로 쌓이는 forward shadow data가 담당한다.**
- **홀드아웃 추적은 append-only로 설계하고 덮어쓰지 않는다.** `holdout_runs`는 기존 백테스트 감사 로그로 두고, 연구 데이터 소비는 별도 `holdout_consumptions`(`research_family`·`purpose`·`source_version`·구간·`question_id`·timestamp)로 남긴다. **같은 계열이 같은 구간을 다시 봐도 새 행이다** — `consumer`별 덮어쓰기는 반복 관찰을 숨기므로 채택하지 않았다. **더 중요한 불변식은 Phase 1~8이 홀드아웃을 아예 못 읽는 것**이고(`research_sessions`가 달력을 물리적으로 자른다), 계수는 사후 기록이지 본체가 아니다. **이 인프라는 지금 구현하지 않는다 — 전략 freeze 전 별도 infrastructure PR이다.**
- **연구 코어는 구조적으로 `UNDETERMINED`를 벗어날 수 없다.** JT 코어는 전부 `require_earnings_calendar=False`라 `EARNINGS_GATE_DISABLED` blocker가 항상 붙는다. Phase 1~6의 1차 합격선은 **게이트 verdict와 다른 층**이고 blocker가 사라지는 것은 Phase 7(Reality Hardening)이다.
- **2ATR는 sizing 단위이지 집행되는 손절선이 아니다 — `VOLATILITY_SCALED_POSITION`**(2026-08-17 PR #19, `runs/risk-semantics/`). control 재현은 여덟 항목 전부 일치했고(445거래 · +47.84% · 0.343 · PF 1.47 · Sharpe 0.46 · MDD 12.0% · 노출 16.4% · `G` +4.99%) 처치는 `exit_mode` 하나다. 2ATR를 실제 initial hard stop으로 집행하자 `S` +47.84% → **+0.95%**(`ΔS` −46.89%p) · `G` +4.99% → **−29.10%**(`ΔG` −34.09%p) · Sharpe 0.46 → **0.03** · PF 1.47 → **1.00** · MDD 12.0% → 12.5%로, 사전등록 여덟 조건 중 다섯이 실패했다. **fixed K42를 유지하고 0.25%는 volatility sizing budget으로 읽는다.**
- **처치가 작동하지 않은 것이 아니다.** 손절이 472건으로 청산의 63.8%였고 평균 보유가 41.8 → 23.4세션으로 줄었다. 거래가 445 → 740으로 늘어 비용이 $10,993 → $13,853이 됐다. **"작동 안 했다"와 "작동했는데 손해였다"를 섞지 않는다.**
- **`jt-j126-k42-sma200-stop` 코어와 `FIXED_HOLD_HARD_STOP` 모드는 기록·재현용으로만 남긴다.** **1.5 / 2.5 / 3ATR 재탐색 · trailing stop 대안 · stop confirmation을 열지 않는다** — 사전등록 §13 B의 금지 목록이고 결과가 나쁘다고 확장하지 않는다.
- **0.25%가 무엇인지는 코어가 아니라 `exit_mode`가 정한다.** "JT 코어는 손절을 집행하지 않는다"로 **일반화하지 않는다** — `jt-core-exit`은 `jt_policy`를 쓰면서도 `CORE_EXITS`라 초기·추적·시간·실적 청산을 실제로 집행한다. `CORE`(`core1`·`jt-core-exit`)와 `FIXED_HOLD_HARD_STOP`은 **planned stop risk**이고, `FIXED_HOLD`·`SIGNAL_INVALIDATION`은 **volatility sizing budget**이다. 현재 살아남은 후보 `jt-j126-k42-sma200`이 뒤쪽이라 그 코어들의 문서에서만 "거래당 위험"이라는 표현을 뺐다. **`paper-core-v1`·`jt-core-exit`에 대한 기존 "계획 stop risk" 설명은 그 정책에서 맞는 표현이므로 지우지 않는다.** 정본 설명은 `core/jt.py` 한 곳이다.
- **`FIXED_HOLD` 계열의 위험 회계는 legacy volatility-budget accounting이다.** `planned_risk`·`planned_risk_fraction`·`open_risk`·`risk_dollars`·`max_total_planned_risk`·`TOTAL_PLANNED_RISK_EXCEEDED`·`return_r`은 이름이 그대로 남아 있지만 그 계열에서 **실제 stop-defined loss risk로 읽지 않는다** — `2ATR` 기반 position scale과 그 합의 portfolio budget일 뿐 집행되는 손절선도 최대손실 한도도 아니다. `TOTAL_PLANNED_RISK_EXCEEDED`도 "손실 한도 초과"가 아니라 "volatility budget 합계가 한도에 닿음"이고, control에서 이 사유는 실제 결과를 구속하지 않았다. **이름·`risk.py` 행동·`max_total_planned_risk` 계산은 바꾸지 않았다** — 공유 field라 rename은 별도 PR의 compatibility plan이다.
- **`jt-core-exit`(-23.07%)를 "2ATR stop이 나쁘다"의 증거로 인용하지 않는다.** 그것은 stop·트레일링·20일 time stop·실적 청산이 **한 묶음**인 결과다. 2ATR stop 단독 효과는 아직 재지 않았다.
- 다음 후보: **수량 규칙 ablation은 아직 열지 않는다.** 퍼널이 부호는 모든 층에서 유지되는데 R·달러에서 크기가 무너지는 것을 보였고 구속 제약이 `RISK`임을 확인했지만, 정렬 진단이 X3이라 배분 희석 가설이 지지되지 않았다. **현재 증거만으로 sizing ablation을 다음 PR로 승격하지 않는다** — 실제 수량 규칙 변경은 이 메커니즘을 인과적으로 검증하는 방법이 될 수 있지만 **별도의 독립적인 근거가 더 생겼을 때** 새 연구 질문으로 사전등록한다. **이 문단이 PR #14 시점에 열어뒀던 축들은 2026-08-17 freeze로 전부 닫혔다** — sizing ablation · BULL-only 게이트 · 레짐 조건부 J는 `momentum-v2`에서 열지 않는다(§8 종료). `jt-k42` 비용 스트레스와 `RX` 확정은 전략 개선이 아니라 데이터·감사 정리라 필요해지면 그때 별건으로 다룬다.
- 미해결로 남긴 것: 정체불명 계열 23개(`MER`·`JAVA`·`RX`…), CIK 3개(`FMCN`·`LMCA`·`LMCK`), 섹터 11개(`ACAS`·`YHOO`). 섹터 게이트가 fail-close라 그 종목들은 진입이 막힌다. 외국 발행사(20-F/6-K)와 주 인가 은행은 실적일을 만들 수 없는데, **결과를 낙관적으로 만들지 않고 기회만 좁히므로** 14.7 판정을 막지 않는다.

## 구조 방향

- 새 기능은 독립 모듈에 두고 `server.js`에는 설정과 얇은 연결만 추가한다. 기존 대형 코드는 관련 영역을 실제로 수정할 때 회귀 테스트와 함께 점진적으로 옮긴다.
- 비용은 provider 공식 Billing에서 직접 확인한다. 로그인 정보·쿠키·관리자 키를 앱에 저장하거나 잔액 자동 조회를 만들지 않는다.
- 노트 구조 v4와 CODEX 마커 경계를 유지한다. 폴더·범용 ACL·`relative_path`는 아직 도입하지 않는다.
