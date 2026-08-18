# XION 통합 홈 — 설계

> 기존 `에이전트` 탭의 첫 화면을 운영 상태 목록에서 사용자 브리핑으로 바꾼다.
>
> 상태: 2026-08-19 설계 확정, 구현 착수 전. 선행 조건이던 MAIL-3 알림 합류는 인수 완료다.

---

## 1. 정의

XION 홈은 **기존 정본을 읽어 편집해 내놓는 read-only projection**이다. 새 상태 저장소도,
새 dashboard route도, 범용 위젯 framework도 아니다.

화면이 답하는 질문은 `에이전트들이 내부적으로 어떻게 돌고 있지?`가 아니라
`지금 시온이 나한테 알려줘야 할 게 뭐지?`다.

**정상 상태는 정보가 적은 상태다.** 채우기 위해 보여주는 정보를 만들지 않는다.

## 2. v1 범위

세 영역만 만든다.

1. **Needs Attention** — 후속 행동이 남은 것
2. **오늘** — 오늘 일정·마감과 다음 알림
3. **에이전트 상태** — 세 줄 축약과 개입 필요 강조

`최근`(알아둘 가치가 있었던 변화)은 v1에서 뺀다. 근거는 4절이다.

행동은 **열기**뿐이다. 완료·미루기·복구·일정 추가 같은 상태 변경은 기존 책임 화면이 맡는다.

## 3. 데이터 소스

새 API를 만들지 않는다. 아래 넷은 지금 `agent-panel.js`가 이미 병렬로 부르는 것들이다.

| 영역 | 소스 | 쓰는 값 |
|---|---|---|
| Needs Attention | `GET /api/notifications` | `source === 'mail'` 항목 |
| 오늘 | `GET /api/tasks/summary` | `counts` · `preview` · `nextReminder` |
| Mail 상태 | `GET /api/mail/status` | `accounts[].status` · `analysis` · `stranded` |
| Codex 상태 | `GET /api/organize/status` | `runner` · `queueable` · `stranded` · `recoveryRequired` |
| 일정 상태 | `GET /api/tasks/summary` | `counts` |

`/api/tasks/summary`의 `calendar`·`week`는 홈에서 쓰지 않는다. 홈 안에 달력을 다시 만들지 않는다.

## 4. Needs Attention은 Notification이 아니다

`알릴 가치가 있다`(`notification_mode`)와 `잊으면 안 될 후속 행동이 있다`(Attention)는 독립된 축이다.
홈 최상단은 **후자만** 보여준다.

- 대상: `mail_attention`의 `action_required` · `attachment_check` · `low_confidence`
- **Attention 없는 `important/batch` 메일은 승격하지 않는다.** `listAttentionNotifications`가
  `mail_attention` 조인이라 구조적으로 나올 수 없다.
- **silent 메일은 홈에 나오지 않는다.** 같은 이유로 보장된다.
- **`snoozed`는 v1에서 보여주지 않는다.** `나중에`는 사용자가 지금 안 보겠다고 말한 것이고,
  홈 최상단에 다시 올리면 스누즈가 무의미해진다. 지금 API도 `state = 'open'`만 준다.

`최근 Mail 알림`(Attention 없는 batch·immediate)을 보여주려면 새 read endpoint가 필요하다.
그 순간 홈은 두 번째 알림 패널로 미끄러지기 시작하므로, 필요가 실제로 드러난 뒤에 연다.

## 5. 탭

다섯 번째 탭을 추가하지 않는다. 기존 `에이전트` 탭의 **라벨만** `XION`으로 바꾼다.

**`data-panel-tab="agents"` 키는 그대로 둔다.** `public/app.js`의 딥링크 파싱과 `public/sw.js`의
일정 알림 fallback URL(`/?panel=agents&taskView=reminders`)이 그 값을 쓰고, 사용자 기기에 이미
설치된 Service Worker와 지난 알림이 그 링크를 들고 있다. 키를 바꾸면 그것들이 깨진다.

## 6. 에이전트 상태

첫 화면에는 상태 한 줄씩만 둔다. `model id` · `prompt version` · lease · retry · cursor ·
worker timestamp · queue 내부값 · 상세 설정은 첫 화면에 없다. 그것들은 상세의 몫이다.

다만 **사람이 개입해야 멈춤이 풀리는 상태는 첫 화면에서 드러낸다.**

| 신호 | 출처 |
|---|---|
| 재인증 필요 | `accounts[].status === 'auth_required'` |
| 분석 멈춤 | `analysis.failed > 0` |
| 복구 필요 | `organize.recoveryRequired > 0` |
| 정리 좌초 | `organize.stranded > 0` |

카드를 누르면 **기존 상세**(`renderMailDetail` · `renderScheduleDetail` · `renderCodexDetail`)로
간다. 상세를 새로 만들지 않고, 복구 버튼을 홈 카드에 옮기지 않는다.

## 7. 실패 격리

한 소스가 죽어도 나머지 영역은 렌더한다. `agent-panel.js`가 이미 쓰는 `Promise.allSettled`
패턴을 그대로 유지하고, 실패한 영역만 `확인 불가`로 둔다. 하나의 실패를 화면 전체 오류로
승격하지 않는다.

`/api/mail/status`의 `503 MAIL_AGENT_DISABLED`는 오류가 아니다. 플래그가 꺼진 것뿐이라
사람이 고칠 것이 없다.

## 8. 모바일

지식 패널은 데스크톱에서 350px 고정이라 2열이 물리적으로 들어가지 않는다. 모바일과 같은
1열을 쓴다.

첫 viewport에 **Needs Attention과 오늘이 함께** 들어와야 한다. 메일 카드 실측 높이가 약
118px이라 Attention을 3장 펼치면 오늘이 접힌다. 그래서 **첫 화면에는 Attention 2건까지만
보이고 나머지는 `+N개` 한 줄로 접는다.**

## 9. 빈 상태

Attention도 오늘 일정도 없으면 빈 카드를 여러 장 만들지 않는다. `오늘은 따로 확인할 일이
없어` 한 줄과 다음 일정, 그리고 에이전트가 모두 정상이라는 사실만 조용히 남긴다.

## 10. 통과 기준

- [ ] 홈은 기존 정본만 읽고 별도 상태를 저장하지 않는다 (서버 변경 0줄)
- [ ] active Mail Attention이 있으면 Needs Attention에 보인다
- [ ] Attention 없는 batch·immediate 메일은 Needs Attention으로 승격되지 않는다
- [ ] silent 메일은 홈에 나오지 않는다
- [ ] `snoozed` Attention은 홈에 나오지 않는다
- [ ] 오늘 영역이 `/api/tasks/summary`와 일치한다
- [ ] 한 소스가 실패해도 나머지 영역이 렌더된다
- [ ] 정상 에이전트의 운영 세부값이 첫 화면을 채우지 않는다
- [ ] 개입이 필요한 상태는 첫 화면에서 드러난다
- [ ] 기존 상세·복구 기능과 알림·노트·논문 탭이 회귀하지 않는다
- [ ] `/?panel=agents` 딥링크와 `sw.js`의 일정 fallback URL이 그대로 동작한다
- [ ] 모바일 첫 화면에서 운영 상태보다 Attention·오늘이 먼저 나온다

## 11. 하지 않는 것

다섯 번째 홈 탭 · 홈 전용 DB나 API 래핑 · 범용 dashboard framework · activity event bus ·
에이전트 공통 추상 schema · 메일함·알림 패널·달력·에이전트 상세 복제 · 실시간 websocket ·
위젯 편집이나 레이아웃 저장 · 주변 UI 대규모 정리.
