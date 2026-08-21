# XION News Agent — Design

> 상태: 설계 합의 — v1 범위 확정  
> 작성: 2026-08-20 · 갱신: 2026-08-20  
> 파일명: `xion-news-agent-design.md`
>
> 목적: XION이 사용자의 **현재 관심사**를 제한적으로 유지하고, 그 관심사와 관련된 외부 변화를 수집·선별해 비서형 브리핑으로 제공한다.
>
> **v1은 사용자가 직접 말한 관심만 다룬다.** 대화에서 관심을 추론하는 background batch는 v2다. 이유와 대가는 0절 4번과 19절에 있다.
>
> 이 문서는 구현 전에 합의할 설계 기준이다. 실제 코드 수정은 별도 컨펌 후 진행한다.

---

## 0. 결정 요약

뉴스 기능의 목표는 범용 뉴스 리더를 만드는 것이 아니다.

XION News Agent는:

> **사용자가 최근 무엇을 신경 쓰고 있는지 기억하고, 외부에서 그와 관련된 변화가 생겼을 때 필요한 것만 가져오는 에이전트**

다.

핵심 결정은 다음과 같다.

1. 관심 상태는 **에이전트 소유 Markdown 노트 한 장**에서 관리한다.
2. 일정 에이전트 노트의 ownership 경계를 재사용한다.
   - `owner_agent=news`
   - News Agent만 자기 본문 영역 수정
   - Codex는 `CODEX-TAGS`, `CODEX-LINKS`만 수정
   - 다른 에이전트는 읽기 전용
3. **전달·큐 인프라는 메일 에이전트에서 가져온다.** Push transport, quiet hours, 분석 큐 상태 기계, 프롬프트 버전 기록을 새로 만들지 않는다. 상세는 1절이다.
4. **v1은 사용자가 직접 말한 관심만 다룬다.** 메인 XION의 hot path가 `expressed`와 `subscribed`를 모두 받고, 대화에서 관심을 추론하는 background batch는 **v2로 미룬다**.
   - 이유: 그것만이 사용자가 요청하지 않은 상태를 LLM이 스스로 만드는 경로다. 메일에서 **판단 흔들림 관측이 아직 끝나지 않았고**, 그 결과가 나오기 전에 두 번째 무감독 판단기를 배포하지 않는다.
   - 부수 효과: cursor·동시성·재처리 안전(7절)이 통째로 v2로 밀려 v1이 훨씬 작아진다.
   - 대가: v1에는 "말 안 해도 알아서 챙겨주는" 동작이 없다. 이것은 진짜 손실이고, 받아들이고 시작한다.
5. 뉴스 기사 자체는 관심사를 만들거나 강화하지 않는다.
   - 관심 상태의 근거는 **사용자 발화**다.
   - 기사가 스스로 주장하는 중요도(속보·긴급·단독)도 근거가 아니다(12.2절).
6. 관심 상태는 `inferred`, `expressed`, `subscribed`로 구분한다. v1에 `inferred`를 만드는 경로는 없지만 상태 정의와 validator는 미리 넣어, v2에서 노트 형식이 바뀌지 않게 한다.
7. `expressed` 관심은 일정 기간 뒤 재확인 대상이 될 수 있다.
8. **재확인은 사용자 활동에 종속시킨다.** 사용자가 앱을 쓰지 않는 동안에는 "아직 관심 있어?"를 만들지 않는다(11.3절).
9. 재확인은 **News Agent 전용 review candidate → proactive chat message → Web Push**로 전달한다.
10. proactive message는 기존 `shared-main` 채팅에 시온 메시지로 남기고, Web Push는 그 메시지의 전달 수단으로만 사용한다.
11. **proactive 표시는 `messages` 스키마가 아니라 뉴스 전용 표에 둔다.** 전역 `source` 개념을 뉴스 하나 때문에 지금 정의하지 않는다(11.4절).
12. XION 홈은 뉴스 상태 관리 화면으로 확장하지 않는다. 뉴스는 필요할 때 조건부 브리핑으로만 남길 수 있고, 재확인 질문의 기본 전달 경로는 채팅이다.
13. v1에서는 RSS/API/검색 기반 수집을 우선하며 범용 HTML 크롤러는 만들지 않는다.

---

## 1. 현재 갈피와의 연결

현재 갈피는 다음 경계를 이미 갖는다.

- 대화 원문과 구조화 상태의 정본은 SQLite에 둔다.
- 사람이 읽는 지식은 Markdown Vault에 둔다.
- 에이전트 소유 노트는 소유 에이전트가 정해진 본문 영역을 관리하고, Codex는 제한된 메타 영역만 수정한다.
- LLM은 판단·후보 생성을 맡고, validation·persistence·state transition은 application code가 책임진다.
- XION 홈은 새 dashboard 상태를 만드는 곳이 아니라 기존 정본을 읽어 **“지금 시온이 나한테 알려줘야 할 게 뭐지?”**를 편집해 보여주는 화면이다.

News Agent는 이 원칙을 바꾸지 않고 그대로 이용한다.

### 일정 에이전트에서 가져오는 것

- `owner_agent`
- 에이전트 전용 수정 marker
- Codex 전용 marker
- 다른 에이전트 read-only
- mutation validation
- 실패 시 기존 정본을 훼손하지 않는 경계

### 일정 에이전트에서 가져오지 않는 것

- 월별 파일 분할
- task DB → Markdown projection 구조
- generation outbox
- 월 단위 재생성 worker

뉴스 관심 상태는 작고 현재성이 중요하므로 v1에서는 **한 장의 살아있는 상태 노트**로 유지한다.

### 메일 에이전트에서 가져오는 것

메일 트랙은 2026-08-20에 닫혔고, 뉴스가 필요로 하는 것 — 외부 콘텐츠를 주기적으로 가져와 LLM으로 판단하고 그중 일부만 Push로 전달하는 경로 — 를 이미 만들어 뒀다. 같은 것을 다시 만들지 않는다.

**그대로 쓰는 것**

- `createAssistantPushDispatcher`(`lib/assistant-push.js:509`). claim · retry · 410 만료 · lease · overlap guard는 도메인과 무관하고, 도메인이 주입하는 것은 `buildPayload`와 `buildSendOptions` 둘뿐이다. 메일이 정확히 이 방식으로 붙었다(`lib/mail/push.js`).
- `lib/mail/quiet-hours.js`. KST 고정이고 별도 보류 큐 없이 `next_attempt_at` 하나로 표현한다. **22절의 quiet hours 미결정이 이것으로 닫힌다.**
- 분석 모델 기본값 `gpt-5.6-luna`(`lib/mail/analyze.js:338`). 샘플 평가를 처음부터 다시 하지 않고 여기서 출발한다.

**패턴만 가져오는 것**

- 큐 상태 기계. `pending / analyzing / done / failed / skipped` + `lease_until` + `attempt_count` + `next_attempt_at` + 지수 backoff + 만료 lease 회수 + 사람이 누르는 재처리(`lib/mail/store.js`). 뉴스 수집(N4)이 필요로 하는 모양이 이것과 같다. 16절의 실패 서술은 이 상태 이름으로 적는다.
- `PROMPT_VERSION`을 판단 행에 함께 저장하는 것(`lib/mail/analyze.js`). 이것이 없으면 18절의 지표가 나빠졌을 때 "프롬프트를 바꿔서인지"를 되짚을 수 없다. 메일은 v1 → v3으로 가면서 실측으로 고쳤다.
- **외부 콘텐츠의 자기 주장을 판단 근거로 쓰지 않는 규칙.** 메일 분석 프롬프트 v3이 "메일 자신의 긴급 주장을 근거로 쓰지 않는다"를 넣어 피싱 메일의 `urgent` 승격을 닫았다. 뉴스는 이것이 더 심하다 — 12.2절을 보라.
- identity를 한 곳에서 결정적으로 계산하는 것(`lib/mail/agent.js`). 뉴스에서는 기사 dedupe와 관심 topic 정규화가 그 자리다(10절).

**공유하지 않는 것**

- delivery 상태표. 메일이 자기 표를 소유한 선례를 따라 뉴스도 자기 표를 갖는다. 범용 notification framework를 만들지 않는다는 3절 대안 D와 같은 결정이다.

**아직 끝나지 않은 것**

메일에는 관측이 하나 남아 있다 — 판단이 run-to-run으로 흔들리고 모델·파라미터로는 고쳐지지 않는다는 것, 그리고 흡수 장치(batch 묶기 · 발신자 억제)가 실제 알림에서 얼마나 듣는지. **뉴스의 v1 범위는 그 관측과 병행하도록 잡았다**(19절).

---

## 2. 가정

이 설계는 다음을 가정한다.

1. XION의 일반 대화는 기존 `messages` DB에 저장된다.
2. 사용자 관심은 모든 대화에서 영구적으로 유지되어야 하는 지식과 다르다.
3. 관심은 시간에 따라 바뀔 수 있으므로 append-only topic note보다 현재 상태를 갱신하는 형식이 적합하다.
4. 사용자가 한 번 주제를 언급했다고 그 주제를 지속 관심으로 간주하면 과잉 수집이 발생한다.
5. 사용자가 “관심 있다”고 말하는 것과 “계속 알려달라”고 요청하는 것은 다르다.
6. 사용자가 앱을 사용하지 않는 동안 즉시 푸시로 질문하는 기능은 v1에 필요하지 않다.

---

## 3. 더 단순한 대안과 제외 이유

### 대안 A — 메인 XION이 매 턴 관심사를 직접 저장

장점:

- 추가 LLM 호출이 거의 없다.
- 명시적인 요청은 즉시 반영된다.

단점:

- 한 턴만 보고 순간 관심과 지속 관심을 구분하기 어렵다.
- 메인 답변 경로가 관심 관리 책임까지 갖게 된다.
- 모든 턴에서 tool 판단 부담이 생긴다.

따라서 **사용자가 직접 말한 관심에만** 사용한다. v1에서 그 범위는 지속 추적 요청뿐 아니라 명시적인 관심 표현까지 넓어지지만(6.1절), 그래도 메인 XION이 매 턴 도는 일반 관심 추론기를 겸하지는 않는다.

### 대안 B — News Agent를 모든 턴에 병렬 실행

장점:

- 메인 XION과 관심 추론을 완전히 분리할 수 있다.

단점:

- 이미 메인 모델이 읽은 대화를 별도 모델이 다시 읽는다.
- 짧은 대화 조각에서 incomplete context 문제가 생긴다.
- 호출 수와 입력 토큰이 불필요하게 늘어난다.

따라서 채택하지 않는다.

### 대안 C — 최근 대화 N개를 매번 다시 분석

장점:

- 구현이 단순하다.

단점:

- 같은 대화를 반복 처리한다.
- 비용이 누적된다.
- 동일한 관심사를 반복 생성할 가능성이 커진다.

따라서 **cursor 이후 새 대화만 처리**한다.

### 대안 D — 처음부터 범용 proactive framework 구축

장점:

- 일정·메일·뉴스의 “먼저 묻기”를 한 시스템으로 통합할 수 있다.

단점:

- 실제 두 번째 사용 사례가 확정되기 전에 추상화가 커진다.
- 상태, 우선순위, 푸시, 대화 진입 정책까지 범위가 급격히 넓어진다.

따라서 처음에는 **News Agent 전용 proactive delivery**만 만든다(v1.1).

이때도 범용 프레임워크는 만들지 않는다.

```text
review candidate
  ↓
shared-main proactive assistant message
  ↓
Web Push
  ↓
사용자 응답
  ↓
candidate resolve
```

즉 “먼저 말 걸기”의 최소 사례 하나만 구현하고, 일정·메일에서 같은 문제가 실제로 생긴 뒤 공통화를 검토한다.

---

## 4. 핵심 개념

### 4.1 Interest

News Agent가 외부에서 추적할 주제다.

예:

- OpenAI API / Responses API
- 초경량 로컬 LLM
- 특정 기업 또는 종목
- Zigbee / 월세형 스마트홈
- 장거리 자전거 여행과 정비
- 특정 연구 분야 또는 후속 논문

Interest는 사용자에 대한 일반 기억이 아니다.

> “사용자가 누구인가”가 아니라  
> **“지금 무엇의 변화를 외부에서 지켜볼 가치가 있는가”**

를 나타낸다.

### 4.2 상태

#### `inferred`

사용자가 여러 대화에서 반복적으로 다뤄 최근 관심이 있다고 추론한 상태.

**이 상태를 만드는 경로는 v2에만 있다**(19절). v1에서는 정의와 validator만 두고 실제로 생성되지 않는다.

- background batch가 생성 가능 (v2)
- background batch가 갱신 가능 (v2)
- background batch가 제거 가능 (v2)
- 사용자 명시 요청으로 상위 상태로 승격 가능

#### `expressed`

사용자가 관심을 직접 표현했지만 지속 추적까지 명시하지 않은 상태.

예:

- “요즘 로컬 LLM에 관심 많아.”
- “Zigbee 쪽 좀 재밌네.”
- “이 회사 계속 궁금하긴 해.”

특징:

- `inferred`보다 오래 유지한다.
- 일정 시간이 지나고 최근 언급도 없으면 재확인 후보가 될 수 있다.
- 단순 시간 경과만으로 `subscribed`로 승격하지 않는다.

#### `subscribed`

사용자가 지속적인 추적 의도를 명시한 상태.

예:

- “앞으로 OpenAI API 업데이트 계속 알려줘.”
- “이 종목 관련 중요한 소식 나오면 챙겨줘.”
- “이 분야는 계속 봐줘.”

특징:

- background batch는 삭제할 수 없다.
- background batch는 관련 근거와 `last_seen`을 갱신할 수는 있다.
- 사용자의 명시적 철회로만 제거 또는 하향한다.
- v1에서는 자동 만료하지 않는다.

---

## 5. 상태 전이

아래는 완성된 그림이다. **`inferred`로 들어가는 첫 화살표와 `inferred`의 background 전이는 v2**이고, 나머지는 v1·v1.1이다(19절).

```text
                 repeated conversation  (v2)
                        │
                        ▼
                    inferred
                        │
         explicit interest expression
                        │
                        ▼
                    expressed
                        │
         explicit "keep tracking" request
                        │
                        ▼
                   subscribed
```

추가 전이:

```text
inferred                                  (v2)
  ├─ 새 관련 대화 → update / last_seen 갱신
  ├─ 장기간 무관 → background remove
  └─ 사용자 지속 추적 요청 → subscribed

expressed
  ├─ 새 관련 대화 → last_seen 갱신 + review_after 연장 가능
  ├─ 조용함 + review_after 도달 + 사용자 활동 → review candidate (v1.1)
  ├─ "계속 봐줘" → subscribed
  └─ "관심 없어" → remove

subscribed
  ├─ 관련 대화 → last_seen 갱신
  ├─ background remove 금지
  └─ 사용자 철회 → remove 또는 expressed
```

---

## 6. 관심 상태 형성 — Hybrid Path

경로는 둘이지만 **v1에 들어가는 것은 hot path 하나다.** background 추론은 v2다(19·20절).

### 6.1 Hot path — 사용자가 직접 말한 관심 (v1)

메인 XION은 아주 좁은 후보 도구 하나를 가진다.

개념적 형태:

```text
news_interest_prepare(
  action,
  topic,
  state,
  intent,
  evidence_message_id
)
```

`state`가 인자에 있는 이유는 v1에 background 추론이 없기 때문이다. 이 도구가 `expressed`와 `subscribed`를 만드는 **유일한 통로**다.

**`subscribed`로 호출하는 예 — 지속 추적 의도가 명확할 때**

- "계속 알려줘"
- "앞으로 지켜봐줘"
- "중요한 변화 있으면 알려줘"
- "이제 이건 그만 봐줘" (제거)

**`expressed`로 호출하는 예 — 관심을 직접 말했지만 지속 추적까지는 아닐 때**

- "요즘 로컬 LLM에 관심 많아."
- "Zigbee 쪽 좀 재밌네."
- "이 회사 계속 궁금하긴 해."

**호출하지 않는 예 — 한 번 묻는 것은 관심 표현이 아니다**

- "Nemotron 어때?"
- "이거 재밌네."
- "그거 무슨 뜻이야?"

경계는 **사용자가 자기 관심을 주어로 말했는가**다. 질문의 주제는 관심이 아니다.

이 구분이 v1에서 유일한 관심 생성 판단이므로, 위 세 목록을 프롬프트에 그대로 넣고 18절에서 오생성과 누락을 센다.

핵심은 메인 XION이 **일반적인 관심 추론기를 겸하지 않는 것**이다. 사용자가 말하지 않은 관심은 v1에서 만들어지지 않는다.

### 6.2 Background path — 추론 및 관심 표현 정리 (v2)

**이 절은 v2 계약이고 v1에서 구현하지 않는다.** 미리 적어두는 이유는 v1의 노트 형식과 validator가 v2에서 바뀌지 않게 하기 위해서다.

새 사용자 메시지가 일정 수 쌓이면 News Context Batch를 실행한다.

초기 기준:

```text
새 user message >= 8
```

숫자 8은 운영 초기값일 뿐이며 성능 측정 뒤 조정한다(22절).

batch 입력:

1. 현재 News Context Note
2. 마지막 성공 cursor 이후 새 사용자 메시지
3. 해당 사용자 메시지의 의미를 이해하는 데 필요한 최소 assistant 문맥
4. 현재 시각
5. 상태 전이 규칙

중요한 계약:

> assistant 발화는 **해석 문맥**으로만 사용한다.  
> 관심의 근거는 사용자 발화만 인정한다.

assistant 문맥을 조립할 때 `news_proactive_messages`에 있는 메시지는 제외한다(11.4·11.6절). 시온이 스스로 꺼낸 주제가 사용자 관심으로 되돌아오는 경로를 만들지 않는다.

batch 출력은 자유 Markdown이 아니라 구조화 action이다.

예:

```json
{
  "actions": [
    {
      "op": "add",
      "state": "inferred",
      "topic": "lightweight local LLMs",
      "reason": "사용자가 로컬 추론용 소형 모델을 반복해서 탐색함",
      "evidence_message_ids": [1845, 1848, 1851]
    },
    {
      "op": "update",
      "interest_id": "news-a13f",
      "evidence_message_ids": [1854]
    },
    {
      "op": "remove",
      "interest_id": "news-b202",
      "reason": "새 대화에서 더 이상 유지할 근거가 없고 상태가 inferred임"
    }
  ]
}
```

허용 operation:

- `add`
- `update`
- `remove`
- `noop`

---

## 7. Cursor와 실행 조건 (v2)

**이 절은 6.2와 함께 v2다.** v1에는 background batch가 없으므로 cursor도 없다.

반복 분석을 피하기 위해 News Agent는 마지막 성공 처리 지점을 가진다.

개념적 상태:

```text
last_processed_user_message_id
```

### 7.1 실행 조건은 개수로 센다

message id는 전역 `AUTOINCREMENT`라 **id의 차이는 메시지 개수가 아니다.** 세야 한다.

```sql
SELECT COUNT(*) FROM messages
 WHERE role = 'user'
   AND session_id = 'shared-main'
   AND id > :cursor
```

이 값이 8 미만이면 아무것도 하지 않고, 8 이상이면 batch를 예약한다.

**세션 범위는 `shared-main` 하나다.** 관심은 사용자 한 명의 현재 상태이고, 음성 턴도 같은 세션에 저장된다(`server.js`의 `sessionId: 'shared-main'`). 의회는 `410`으로 퇴역해 새 대화가 생기지 않는다.

### 7.2 cursor는 노트와 원자적으로 움직일 수 없다

관심 본문은 **파일**이고 cursor는 **DB**라 한 트랜잭션에 넣을 수 없다. "성공하면 이동, 실패하면 유지"는 둘이 한 원자 단위일 때만 성립하는 말이므로 그대로 계약에 두지 않는다.

순서를 고정한다.

```text
1. 노트 파일 쓰기 (원자적 finalization)
2. DB cursor 갱신
```

1과 2 사이에서 죽으면 cursor가 뒤처져 **같은 메시지가 다시 처리된다.** 이것을 막지 않고 **재처리가 안전하도록** 만든다 — 10절 validator가 정규화한 topic 기준으로 중복을 거부하므로 재처리가 같은 관심을 두 번 만들지 못한다.

반대 순서(cursor 먼저)는 쓰지 않는다. 그 경우의 실패는 **관심을 영구히 잃게** 만든다. 되풀이되는 일은 고칠 수 있고 사라진 일은 못 고친다.

### 7.3 동시 실행

- 같은 cursor 범위에 대해 worker 두 개를 동시에 실행하지 않는다.
- 한 batch가 실행 중일 때 새 메시지가 들어오면 다음 실행 대상으로 남긴다.
- **새 distributed lease를 만들지 않는다.** 메일 분석 큐의 `lease_until` + 만료 회수 패턴을 그대로 쓴다(1절).

---

## 8. News Context Note

파일 예시:

```text
xion-news-context.md
```

frontmatter 개념:

```yaml
---
title: XION News Context
note_type: news_context
owner_agent: news
---
```

본문:

```markdown
<!-- XION-NEWS-START -->

## Interests

### OpenAI API
<!-- interest_id: news-a13f -->
state: subscribed
last_seen: 2026-08-20
reason: 갈피 개발과 직접 관련된 API 변화를 지속 추적하도록 사용자가 요청함

### Lightweight local LLMs
<!-- interest_id: news-b202 -->
state: expressed
last_seen: 2026-08-20
review_after: 2026-09-20
reason: 사용자가 최근 로컬 XION 추론 후보에 관심을 직접 표현함

### Long-distance cycling
<!-- interest_id: news-c91d -->
state: inferred
last_seen: 2026-08-17
reason: 장거리 자전거 여행과 정비 이야기가 최근 반복됨

<!-- XION-NEWS-END -->

<!-- CODEX-TAGS-START -->
<!-- CODEX-TAGS-END -->

<!-- CODEX-LINKS-START -->
<!-- CODEX-LINKS-END -->
```

### 8.1 Stable ID

각 interest는 stable `interest_id`를 가진다.

이유:

- topic 이름이 바뀌어도 같은 항목을 갱신할 수 있다.
- update/remove가 제목 문자열에 의존하지 않는다.
- retry와 validation이 단순해진다.

### 8.2 Evidence

모든 evidence 원문을 Markdown에 길게 복사하지 않는다.

노트에는 사람이 이해할 수 있는 `reason`과 `last_seen`만 둔다.

필요한 provenance는 DB message id로 추적 가능해야 한다.

v1에서 별도 evidence 테이블이 반드시 필요한 것은 아니다. 구조화 저장이 필요해질 때 추가한다.

---

## 9. Mutation 권한

### News Agent

`XION-NEWS` 영역에서:

- interest 생성
- inferred/expressed 갱신
- inferred 제거 (v2)
- review 상태 갱신 (v1.1)

### 메인 XION

직접 Markdown을 수정하지 않는다.

사용자가 직접 말한 관심 표현·지속 추적·철회에서 **candidate**만 만든다(6.1절). v1에서는 이것이 관심을 만드는 유일한 통로다.

### Codex

- `CODEX-TAGS`
- `CODEX-LINKS`

만 수정 가능하다.

### 다른 에이전트

read-only.

---

## 10. Validator

LLM 출력은 바로 파일 변경으로 이어지지 않는다.

최소 검증:

1. `op`가 허용값인지
2. update/remove 대상 `interest_id`가 정확히 하나 존재하는지
3. 중복 `interest_id`가 없는지
4. **정규화한 topic이 기존 항목과 겹치지 않는지**
5. `subscribed`를 background가 remove하려 하지 않는지
6. 사용자 발화가 아닌 외부 뉴스 결과를 evidence로 사용하지 않는지
7. marker 밖 변경이 없는지
8. note frontmatter의 `owner_agent=news`가 유지되는지
9. 관심사 수 상한을 넘지 않는지
10. 빈 topic 또는 의미 없는 범용 topic을 만들지 않는지

**4번이 3번과 다른 이유를 적어둔다.** 3번은 *같은 id가 두 번 오는 것*을 막는다. 그런데 재처리(7.2절)와 사용자의 반복 발화가 만드는 것은 **같은 내용의 다른 id**다. id만 보면 "로컬 LLM"과 "초경량 로컬 LLM"이 각각 살아남아 같은 뉴스를 두 번 가져온다.

정규화는 결정적인 변환만 쓴다 — 공백 접기, 소문자화, 조사·관사 제거 정도이고 현재 시각이나 로케일에 기대는 것을 넣지 않는다. 판정은 프롬프트가 아니라 **코드 한 곳**에서 한다. 메일이 identity를 provider가 아니라 한 파일에서 계산한 것과 같은 이유다(`lib/mail/agent.js`) — 두 곳에 두면 한쪽만 고쳐지는 순간 같은 것이 두 행이 된다.

초기 관심사 상한은 예를 들어 20개로 둘 수 있다.

상한 값은 실사용 관찰 후 조정한다.

---

## 11. Review — "아직 관심 있어?" (v1.1)

### 11.1 목적

사용자가 관심을 표현했다고 해서 영구 구독으로 간주하지 않는다.

`expressed` 상태는 일정 시간이 지나면 현재도 유효한지 확인할 수 있다.

이 확인은 관리 화면의 토글이 아니라 **시온이 먼저 말을 거는 채팅**으로 처리한다.

### 11.2 묻지 않아야 하는 경우

`review_after`가 됐더라도 최근 관련 사용자 발화가 계속 있으면 묻지 않는다.

대신 **`review_after`만 미룬다.**

```text
review_after 연장
```

**`last_seen`은 건드리지 않는다.** 그 값의 뜻은 *사용자가 마지막으로 그 관심을 실제로 표현하거나 언급한 시점*이고, 시스템이 예정일을 미뤘다는 이유로 바뀌면 안 된다. 바뀌면 "언제부터 조용했나"의 기준이 시스템 자신의 동작에 오염돼 재확인 판정이 자기 꼬리를 문다. 그래서 이 미루기는 일반 `update`가 아니라 **예정일만 바꾸는 별도 mutation**을 쓴다.

사용자가 계속 같은 주제를 이야기하는데 "아직 관심 있어?"라고 묻는 것은 잘못된 UX다.

**v1.1에서 이것이 저절로 되지 않는다.** `last_seen`을 갱신하는 것은 hot path뿐인데, 사용자는 그 주제를 계속 이야기하면서도 "계속 알려줘"라고 다시 말하지는 않는다. 그러면 `last_seen`이 낡은 채로 남아 **정확히 묻지 말아야 할 때 묻게 된다.**

그래서 review 판정 직전에 **결정적 최근 언급 검사**를 한 번 한다.

```text
interest.topic과 등록된 별칭으로
last_seen 다음 날부터의 user 메시지를 훑는다
→ 걸리면: review_after 연장, 질문 없음 (last_seen은 그대로)
→ 안 걸리면: 11.3의 나머지 조건을 본다
```

**`last_seen` 당일은 이미 센 것이라 훑지 않는다.** 그날 자정부터 보면 `last_seen`을 만든 바로 그 발화가 다시 잡혀 "방금 말했다"로 오판한다. 관심을 처음 등록한 발화가 언제나 가장 먼저 걸리므로, 이 경계가 없으면 첫 재확인부터 틀린다.

**LLM을 부르지 않는다.** 이것은 판단이 아니라 *묻지 않을 이유를 찾는 안전장치*라, 놓쳐서 묻는 것보다 과하게 걸려서 안 묻는 쪽이 낫다.

v2에서 background batch가 `last_seen`을 제대로 갱신하게 되면 이 검사는 바닥값으로 남긴다. 지우지 않는다 — batch가 실패하거나 밀린 동안에도 이 검사는 계속 듣는다.

### 11.3 Review candidate

조건:

```text
state = expressed
AND review_after <= now
AND 11.2의 최근 언급 검사에 걸리지 않음
AND 사용자가 최근에 앱을 쓰고 있음
```

이면 News Agent가 한 건의 review candidate를 만든다.

**마지막 조건이 이 절의 핵심이다.** review candidate 생성을 독립 스케줄러의 시계에 걸지 않고 **사용자 활동에 종속시킨다** — 구체적으로는 사용자 메시지를 처리한 뒤에 검사한다.

이유: 사용자가 몇 주 동안 앱을 쓰지 않는데 "아직 관심 있어?"를 푸시하는 것이 이 기능의 최악의 실패다. 활동에 종속시키면 **조용한 사용자에게는 아무 일도 일어나지 않는다.**

이것은 제약이 아니라 의도다. 나중에 "왜 review가 안 나가지?" 하고 독립 스케줄러로 바꾸지 않는다.

v2에서 background batch가 들어오면 이 검사를 **batch 성공 직후 마지막 단계**로 옮긴다. batch가 도는 시점이 곧 "사용자가 최근에 말했다"는 뜻이고 그때는 `last_seen`도 방금 갱신돼 있다. 옮긴 뒤에는 조건에 **"이번 batch가 이 interest를 건드리지 않았을 것"**을 더한다.

예:

```text
전에 초경량 로컬 LLM 쪽에 관심 있다고 했는데,
앞으로도 관련 소식을 계속 챙겨볼까?
```

review candidate는 아직 사용자에게 전달된 메시지가 아니다.

최소 상태:

```text
id
interest_id
kind = interest_review
state = pending | delivered | resolved | dismissed | expired
question
created_at
delivered_at
resolved_at
```

News Agent 전용 상태로 둔다. 범용 proactive schema로 추상화하지 않는다.

**관심 하나에 살아 있는 질문이 하나뿐이라는 것은 DB가 보장한다.** `SELECT` 뒤 `INSERT`로는 겹치는 두 턴이 둘 다 통과할 수 있고, 그러면 서버는 첫 번째만 보므로 나머지는 답을 받을 수 없는 채로 남고 Push는 두 벌 나간다. `state IN ('pending','delivered')`에 걸린 부분 unique index가 그것을 막고, 코드는 제약 위반을 오류가 아니라 "이미 물어둔 질문이 있다"로 읽는다.

### 11.4 Proactive chat delivery

pending review candidate가 전달 대상이 되면 시온이 기존 `shared-main` 채팅에 먼저 메시지를 남긴다.

```text
News Agent review candidate
        ↓
proactive assistant message 생성
        ↓
shared-main에 저장
        ↓
Web Push 발송
        ↓
사용자가 알림 탭
        ↓
해당 채팅으로 진입
```

예:

> 전에 로컬 LLM 쪽에 관심 있다고 했었는데, 요즘은 이야기가 없네. 앞으로도 관련 소식 계속 챙겨볼까?

이 메시지는 일반 assistant 답변과 구분 가능한 provenance를 가져야 한다.

**`messages` 스키마는 건드리지 않는다.** 대신 뉴스 전용 표 하나를 둔다.

**뉴스 표는 전부 schema v22 하나에서 만든다.** 단계마다 나눠 만들지 않는 이유는 메일 v19가 이미 값을 치렀기 때문이다 — SQLite는 나중에 `CHECK`나 `FOREIGN KEY`를 붙이려면 표를 통째로 다시 만들어야 해서, 한 기능의 스키마를 단계별로 쪼개면 재작성 마이그레이션이 생긴다. 그래서 N4가 쓰는 기사·연결·수집 커서·검색 예산과 함께 아래 둘도 v22에서 빈 채로 만들어지고, v1.1이 올 때까지 아무도 쓰지 않는다.

```text
news_proactive_messages(
  message_id   UNIQUE,
  candidate_id UNIQUE,
  interest_id,
  created_at
)
```

`messages`에 `source` 같은 컬럼을 더하지 않는 이유는 셋이다.

1. `messages`는 채팅 전체가 쓰는 뜨거운 표다. 뉴스 하나 때문에 **전역 `source` 개념을 지금 정의하면** 음성·일정·메일이 나중에 각자 다른 뜻으로 그 컬럼을 쓴다. 실제로 음성은 이미 `source`를 요청 안 파라미터로만 쓰고 저장하지 않는다(`server.js`의 `allowAutoTopic: source !== 'voice'`).
2. 11.6절의 규칙은 전부 "이 메시지가 proactive인가" 하나만 묻는다. **존재 여부를 담는 표 하나로 충분하다.**
3. 관심 evidence 조회는 어차피 `role = 'user'`라 assistant 행을 읽지 않는다. 이 표가 필요한 곳은 assistant를 해석 문맥으로 넣을 때(6.2절) 하나뿐이고, 거기서 제외하면 된다.

**`UNIQUE(candidate_id)`가 이 표의 핵심이다.** 11.5절의 "같은 candidate로 같은 메시지를 여러 번 만들지 않는다"를 조건문이 아니라 **DB 제약으로 잠근다.** Push 재시도든 worker 중복 실행이든 두 번째 삽입이 실패한다.

topic 자동 저장 제외는 스키마 문제가 아니다. proactive 저장 경로는 사용자 요청이 없어 `sendSingleMessage`를 타지 않으므로, 그 경로에서 자동 저장을 켜지 않으면 끝난다.

### 11.5 Web Push의 역할

Web Push는 **정본이 아니라 전달 채널**이다.

정본은:

- review candidate 상태
- `shared-main`에 저장된 proactive assistant message

다.

Push 전송이 실패해도 proactive message와 candidate가 사라지면 안 된다. 전달 루프의 retry·410 만료는 기존 dispatcher가 처리한다(1절).

반대로 동일 candidate 때문에 같은 proactive message를 여러 번 생성하면 안 된다. 그것은 11.4절의 `UNIQUE(candidate_id)`가 잠근다.

전달 시각은 **`lib/mail/quiet-hours.js`를 그대로 쓴다.** 별도 보류 큐를 만들지 않고 `next_attempt_at` 하나로 표현한다.

**`Topic` 헤더는 도메인이 만든 문자열을 그대로 쓰지 않는다.** RFC 8030의 `Topic`은 URL-safe base64이고 base64 길이는 4로 나눈 나머지가 1일 수 없어서, `news-review-${id}` 같은 이름은 id 자릿수가 바뀌는 순간 거절당한다. 실제로 메일에서 `mail-batch-10`(13자)이 `BadWebPushTopic`으로 막혀 알림이 조용히 사라졌다. dispatcher가 해시로 정규화하므로 도메인은 뜻 있는 이름을 그대로 주면 되고, 같은 대상이 같은 값으로 합쳐지는 것도 유지된다.

Push 문구는 짧게 유지한다.

예:

```text
시온
물어볼 게 하나 있어
```

또는:

```text
시온
전에 관심 있던 주제, 계속 챙겨볼까?
```

알림을 누르면 새 화면이 아니라 기존 채팅으로 진입한다.

payload에는 라우팅 metadata만 싣는다. 메일에서 잠금화면 미리보기를 없앤 것과 같은 이유다 — 넣을 수 있는 경로가 있으면 버그 하나로 샌다.

### 11.6 메인 채팅과의 경계

proactive message는 일반 대화에 보이지만 다음 규칙을 가진다.

1. topic 자동 저장 대상에서 제외한다.
2. interest evidence로 사용하지 않는다.
3. News Context Batch가 assistant proactive message 자체를 사용자 관심 신호로 취급하지 않는다(v2, 6.2절).
4. 사용자의 다음 응답이 열려 있는 candidate와 관련 있을 때만 candidate resolution에 사용한다.
5. candidate가 이미 해결·만료됐으면 일반 대화로 처리한다.

셋 다 "이 메시지가 proactive인가"를 물으므로 판정은 `news_proactive_messages` 한 곳에서 한다.

메인 XION에 candidate를 알려줄 때는 bounded context만 넣는다.

예:

```text
<news_proactive>
candidate_id: news-review-...
interest_id: news-b202
question: 앞으로도 관련 소식을 계속 챙겨볼까?
</news_proactive>
```

사용자의 자연어 응답을 다시 Markdown에 직접 반영하지 않고, 구조화된 state transition 후보로 바꿔 validator를 통과시킨다.

### 11.7 응답 결과

- "응 / 계속 봐줘" → `subscribed`
- "당분간 관심 있어 / 가끔만" → `expressed` 유지 + `review_after` 연장
- "아니 / 이제 관심 없어" → remove
- 무관한 답변 → candidate 유지 또는 dismiss 정책에 따라 처리
- 무응답 → candidate는 일정 기간 뒤 `expired`; 같은 질문을 즉시 재발송하지 않는다

### 11.8 먼저 말 걸기의 범위

proactive chat은 **관심사 재확인**에만 사용한다.

아직 하지 않는 것:

- 일정·메일까지 공용 proactive framework로 합치기
- 임의의 일상 질문
- 습관 형성용 메시지
- 일반 뉴스 전부 push
- 사용자가 원하지 않은 빈번한 체크인

이 기능이 안정적으로 동작한 뒤 다른 에이전트에서 같은 필요가 실제로 확인되면 공통 primitive를 검토한다.

## 12. 뉴스 수집 파이프라인

> 12.1절(검색 질의)은 2026-08-21 실측 뒤에 추가됐다. 그전까지 `buildQuery`는 topic을 그대로 돌려줬다.

v1 수집은 가능한 한 단순하게 시작한다.

```text
News Context Note
        ↓
검색 질의 생성
        ↓
RSS / 뉴스 검색 API / 공식 소스
        ↓
metadata 정규화
        ↓
중복 제거
        ↓
interest relevance
        ↓
importance / novelty
        ↓
필요 시 원문 fetch
        ↓
짧은 summary + reason
```

### 12.1 처음부터 범용 HTML crawler를 만들지 않는 이유

본문 직접 크롤링은:

- robots 정책
- anti-bot
- paywall
- JS 렌더링
- 사이트별 parser
- 본문 추출 실패
- markup 변경

문제를 동시에 만든다.

따라서 v1은 RSS/API/공식 피드를 먼저 사용한다.

본문이 필요한 기사만 제한적으로 fetch한다.

### 12.2 뉴스는 evidence이지 instruction이 아니다

외부 기사, RSS description, 검색 snippet, 웹페이지 본문은 모두 **비신뢰 외부 콘텐츠**로 취급한다.

기사 안의 문장 때문에:

- 관심 상태를 변경하거나
- 도구를 실행하거나
- 저장 정책을 바꾸거나
- 다른 외부 행동을 해서는 안 된다.

뉴스는 오직 정보 근거다.

**그리고 기사의 자기 중요도 주장은 근거가 아니다.**

메일에서 같은 문제를 이미 봤다. 분석 프롬프트 v2에서 피싱 메일이 10회 중 6회 `urgent`로 흔들렸는데, 원인은 injection 추종이 아니라 **"긴급하다고 적힌 메일"과 "실제로 긴급한 메일"을 가르는 기준이 프롬프트에 없던 것**이었다. 지시줄을 뺀 프로브도 같은 승격을 보였다. v3에서 "메일 자신의 긴급 주장을 근거로 쓰지 않는다"를 넣어 닫았다.

뉴스는 이것이 구조적으로 더 심하다. **기사 제목은 거의 전부 자기가 중요하다고 주장한다** — 속보, 긴급, 단독, 역대급. 트래픽이 목적인 매체일수록 그 주장이 세다. 주장을 그대로 읽으면 importance는 사용자의 필요가 아니라 **매체의 편집 방침을 재는 값**이 된다.

따라서 13절의 판단에 규칙 하나를 명시한다.

> 기사가 스스로 붙인 중요도 표지(속보·긴급·단독·역대급)를 importance의 근거로 쓰지 않는다.  
> importance는 **사용자의 관심과 기사 내용의 관계**에서만 나온다.

---

## 13. 기사 relevance

단순 키워드 매칭만으로 결정하지 않는다.

최소 입력:

- interest topic
- interest reason
- state
- 기사 title
- source
- publish time
- snippet/summary

결과 예:

```text
relevance: 0..1
novelty: 0..1
importance: 0..1
reason: 짧은 설명
```

**판단은 (기사, 관심) 쌍에 속한다.** 같은 기사가 두 관심 검색에 다 걸릴 수 있는데, 그때 relevance와 "왜 가져왔는지"는 어느 관심에서 보느냐에 따라 다르다. 기사 하나에 판단을 하나만 두면 한쪽 기준이 다른 쪽 설명으로 새어 사용자에게 **틀린 이유**를 말하게 된다. 그래서 판단과 분석 큐의 키는 기사가 아니라 쌍이고, **같은 URL을 한 번만 저장하는 dedupe는 그대로다**.

홈은 기사 하나를 카드 하나로 보여주므로, 두 쌍이 모두 문턱을 넘으면 더 중요하게 판단된 쌍 하나를 고르고 그 쌍의 주제와 이유를 함께 쓴다. 이름과 이유가 다른 판단에서 오는 일이 없어야 한다.

**문턱은 세 축을 모두 넘어야 한다**(13.1절). 대표 쌍을 고르는 안쪽 질의도 같은 세 조건을 쓴다 — 한쪽만 걸면 문턱을 못 넘는 쌍이 대표로 뽑혀 기사 전체가 사라진다.

**원문 fetch는 아직 열지 않는다.** 17.1절이 원문을 relevance 높은 후보에만 가져오라고 했고 그 "높은"은 13.1절에서 정해졌지만, 문턱이 생겼다는 것과 원문을 가져올 값어치가 있다는 것은 다른 판단이다. 표본이 30~50건에 이르기 전에는 별도 결정으로 남긴다. v1의 판단 재료는 제목·요약문·출처·발행 시각까지다.

### 12.1 검색 질의는 topic과 다른 것이다

**topic 하나가 두 가지 일을 하고 있었다** — 사람이 노트에서 읽는 이름이면서 동시에 검색 엔진에 던지는 문자열이었다. 그래서 사용자가 말한 대로 적으면 검색이 넓어지고(`피지컬 AI 관련 정보` → 국내 일반지·보도자료·카지노 스팸), 검색이 되게 고쳐 쓰면 노트에서 읽기 나빠졌다. **둘은 서로 다른 독자를 위한 문자열이라 한 칸에 같이 둘 수 없다.**

그래서 관심에 `query`를 둔다. 이름은 `topic`이 들고 검색은 `query`가 든다. `reason`은 그대로 판단 프롬프트의 재료이고 검색에 쓰이지 않는다.

**생성은 등록하는 그 턴에 한 번뿐이다.** `news_interest_prepare`의 선택 입력 `search_query`로 받는다 — 모델이 이미 사용자 발화 맥락을 들고 있으므로 **추가 LLM 호출이 없고**, 관심은 한 번 등록되어 계속 쓰이므로 폴마다 비용이 붙지 않는다.

**언어를 고정하지 않는다.** 그 주제가 주로 보도되는 언어로 모델이 고른다. 해외 기술 소식이면 영어, 국내 사안이면 한국어다. 실측은 영어권 주제에서 영어 질의가 나았다는 것뿐이고, 국내 주제까지 영어로 고정할 근거는 없다.

**없으면 topic으로 돈다.** 모델이 안 채워도, 이 계층 이전에 만들어진 관심도 그대로 수집된다. `buildQuery`는 정규화한 뒤에 고른다 — `query: "   "`는 truthy라 그대로 고르면 빈 질의가 되고 그 관심의 수집이 조용히 멈춘다. **노트는 볼트에 있어 사람이 직접 고칠 수 있으므로** 읽는 쪽에서 막는다.

**생성된 질의는 노트에 보이는 자리에 쓴다.** 보이지 않으면 "왜 이런 게 왔지"를 되짚을 수 없고, 사용자가 말하지 않은 문자열이 조용히 수집을 정하게 된다. 검색어는 관심 자체가 아니라 그것을 찾는 방법이라 "관심의 근거는 사용자 발화뿐"이라는 경계(4.2절)를 깨지 않지만, 경계 근처인 것은 맞다. 보이게 두는 것이 그 대가다.

**필터는 만들지 않는다.** `searchTavilyWeb`이 Tavily에 넘기는 것은 `query`·`search_depth`·`max_results`·`topic`·`time_range`뿐이라 언어·국가·도메인 필터를 받을 자리가 없다. 지금 `filters`를 생성하면 쓰이지 않는 값이 노트에 쌓인다. provider가 바뀔 때 함께 연다.

**개선폭은 깨끗하게 측정된다.** `topic`과 `reason`을 건드리지 않으므로 판단 기준은 그대로이고 가져오는 것만 바뀐다. 기준선은 2026-08-21의 22쌍이다.

importance에는 규칙 하나를 명시한다(12.2절).

> 기사가 스스로 붙인 중요도 표지(속보·긴급·단독·역대급)를 importance의 근거로 쓰지 않는다.

이 규칙과 프롬프트 버전을 판단 행에 함께 남긴다. 그래야 나중에 relevance가 나빠졌을 때 프롬프트 때문인지 소스 때문인지 가를 수 있다(18절).

v1에서는 점수 공식을 복잡하게 고정하지 않는다.

먼저 실제 뉴스 30~50건 정도를 수집해 사람이 relevance를 평가한 뒤 threshold를 정한다.

### 13.1 실데이터로 정한 문턱 (2026-08-21)

`SURFACE_THRESHOLD = { relevance: 0.6, novelty: 0.4, importance: 0.4 }` (`lib/news/analyze.js`).

Pi 실데이터 (기사, 관심) 12쌍으로 정했다. 30~50건에는 못 미치므로 표본이 쌓이면 다시 본다.

- **relevance 0.6** — 12쌍에서 값이 두 덩어리로 갈리고 그 사이가 비어 있었다(`0.36` 아래 6건, `0.75` 위 6건). 이후 좁힌 관심의 5쌍에서 중간대가 처음 채워졌고(`0.34`·`0.52`), `0.52`짜리 기사의 이유가 "하드웨어 활용 측면에서는 관련이 있지만 피지컬 AI용 신제품인지는 분명하지 않다"였다. **문턱이 애매한 것을 자르는 자리에 있다는 첫 증거다.**
- **importance 0.4** — relevance를 넘은 6건이 `0.40~0.70`에 몰려 있었다. `0.5`로 두면 사용자가 보고 싶다고 한 제품 변경 소식(Claude 워터마킹, `0.43`·`0.45`)이 죽는다.
- **novelty 0.4** — **판단은 처음부터 novelty를 쟀지만 게이트가 쓰지 않았다.** 그래서 기존 보고서 해설(`rel 0.75` · `nov 0.20` · `imp 0.40`)이 나머지 두 축만으로 통과했다. 12.2절 프롬프트가 "이미 알려진 것의 재보도, 총정리, 해설, 홍보는 낮다"고 정의해둔 값을 게이트에서 실제로 쓴다.

**문턱으로 고칠 수 없는 것이 하나 드러났다.** 홍보성 보도자료(카카오 AI 교육 캠프)가 `0.82 / 0.68 / 0.45`로 세 축을 모두 넘었다. novelty가 높은 이유는 캠프 소식 자체는 새롭기 때문이고, 어느 축으로도 막히지 않는다. 원인은 관심 정의가 넓었던 것이다(`피지컬 AI 관련 정보`). **판단 이유는 이미 "기술·제품의 새로운 발전보다는 교육 프로그램 소식에 가깝다"고 정확히 구분하고 있었으나, 관심이 그것을 요구하지 않아 relevance를 깎을 근거가 없었다.** 관심을 좁히자 같은 계열의 기사가 relevance 단계에서 걸렸다. **문턱이 아니라 관심 정의로 고치는 종류의 문제다.**

**topic이 곧 검색어라는 것이 실측으로 확인됐다**(당시 `buildQuery`는 topic 한 줄을 그대로 돌려줬다. 12.1절이 이 발견에서 나왔다). 반면 `reason`은 검색에 쓰이지 않고 판단 프롬프트에만 들어간다. 같은 주제라도 topic 문구에 따라 오는 기사가 통째로 달라졌다 — `피지컬 AI 관련 정보`는 국내 일반지·보도자료·스팸을 물어왔고, `피지컬 AI 관련 하드웨어 신기술·제품 뉴스`는 TechCrunch·Reuters를 물어왔지만 "피지컬"이 흘러 데이터센터 AI 칩 기사가 왔다. **`피지컬 AI`라는 용어 자체가 검색에서 불안정하다.**

---

## 14. XION 홈 노출

XION 홈은 뉴스 관심 상태를 관리하는 화면으로 만들지 않는다.

현재 홈의 원칙:

> 정상 상태는 정보가 적은 상태다.

를 유지한다.

### 14.1 관심사 재확인

관심사 재확인은 홈 카드가 아니라 **proactive chat + Web Push**가 기본 경로다.

홈에:

- “관심사 확인 필요”
- “구독 유지 여부”
- “News Agent 상태”

같은 관리 UI를 새로 만들지 않는다.

### 14.2 뉴스 브리핑

중요 뉴스 자체는 홈의 `알아둘 것` 같은 read-only briefing으로 노출할 수 있다.

예:

```text
알아둘 것

OpenAI, Responses API에 새 기능 공개
갈피의 tool runtime과 직접 관련 · 2시간 전

NVIDIA, 초경량 스트리밍 모델 공개
로컬 XION 후보와 관련 · 오늘
```

없으면 영역 자체가 없다.

### 14.3 전달 레벨

뉴스 전달은 중요도에 따라 단계화할 수 있다.

v1 기본안:

```text
낮음
→ 저장/검색 가능 상태만 유지

중간
→ XION 홈 또는 사용자가 물었을 때 노출

높음
→ v1에서는 자동 proactive push까지 확대하지 않음
```

즉 proactive chat은 **interest review 검증용**으로만 먼저 사용한다(v1.1, 11절).

실제 뉴스 proactive push는 review flow가 안정적으로 동작한 뒤 별도 승격한다. v1에는 뉴스 push가 없다.

### 14.4 우선순위

기존 홈의:

1. Needs Attention
2. 오늘
3. 에이전트 상태

구조를 뉴스 때문에 깨지 않는다.

뉴스 위치는 실제 구현 시 모바일 첫 viewport 높이를 다시 측정해 결정한다.

## 15. 채팅 사용

사용자가 묻는 예:

- “오늘 내가 알아야 할 거 있어?”
- “요즘 OpenAI 쪽 중요한 변화 있어?”
- “내가 관심 있어 하던 것 중 새 소식 있어?”
- “왜 이 뉴스 가져왔어?”

**조회는 낱말 단위로 맞춘다.** 질의 전체를 한 덩어리로 부분일치시키면 `"OpenAI 안전"`처럼 낱말이 제목과 요약에 나뉜 흔한 경우가 0건이 된다 — 제목은 저장된 원문이라 대개 영어이고 요약·이유는 한국어라, 나뉘어 있는 쪽이 정상이다. 실측에서 이것 때문에 `왜 가져왔어?`가 사용자 자기 데이터를 "없다"고 부인했다. 낱말을 AND로 묶어, 빗나가도 0으로 무너지지 않고 좁혀지게 한다.

**이미 보여준 기사의 이유를 되물을 때는 다시 찾지 않는다.** 이유는 앞선 턴의 도구 결과 안에만 있고 대화에는 남지 않으므로 모델은 기사를 다시 집어야 하는데, 자기가 한국어로 옮겨 쓴 문장으로는 저장된 제목을 맞힐 수 없다. 그래서 **필터 없이** 호출해 최근 목록을 이유째 받고 그중에서 고른다. 관심당 기사 수가 작아 이 방법이 확실하다.

News Agent 결과에는 반드시 관심 연결 이유가 있어야 한다.

예:

> 네가 최근 로컬 추론용 소형 모델을 계속 알아보고 있어서 가져왔어.

이는 “추천 알고리즘이 그냥 골랐다”가 아니라 **사용자 관심과 기사 사이의 provenance**를 설명하기 위함이다.

---

## 16. 실패와 재시도

상태 이름은 메일 분석 큐에서 가져온다(1절). 새 어휘를 만들지 않는다.

```text
pending → analyzing → done
              ├→ pending   재시도 가능, next_attempt_at을 지수 backoff로 밀어둠
              ├→ failed    상한 초과, 목록에 남고 사람이 다시 돌릴 수 있음
              └→ skipped   재시도해도 결과가 안 바뀜 — 처리 대상이 아니라고 밝혀진 것
```

`analyzing`인 채로 죽으면 `lease_until` 만료로 회수해 `pending`으로 되돌린다.

`skipped`를 `failed`와 가르는 이유는 목록 때문이다. **사람이 고칠 것이 없는 항목이 좌초 목록에 쌓이면 그 목록을 아무도 안 보게 된다.**

### 수집·분석 실패

- 위 상태 기계로 처리한다.
- 상한을 넘으면 `failed`로 두고 목록에 남긴다. 조용히 지우지 않는다.
- 사람이 누르는 재처리는 `attempt_count`를 0으로 되돌린다. 안 되돌리면 되살린 항목이 즉시 다시 상한에 걸린다.

### Interest batch 실패 (v2)

- 기존 note 그대로 유지
- cursor 이동 금지 (7.2절의 순서를 지키면 재처리가 안전하다)
- 다음 worker tick에서 재시도 가능

### Validator 실패

- mutation 전체 폐기
- 부분 적용 금지
- 원인 로그 기록

### 뉴스 검색 실패

- interest note에는 영향 없음
- 다음 수집 주기에 재시도
- XION 홈 전체를 오류로 만들지 않음

### 특정 소스 실패

- 해당 소스만 제외
- 다른 소스 결과는 계속 처리

### summary 실패

- 원문 metadata를 보존
- 사용자에게 불완전한 요약을 확정 사실처럼 노출하지 않음

### Push 실패 (v1.1)

- 기존 dispatcher의 retry·410 만료가 처리한다(1절)
- candidate와 proactive message는 남는다(11.5절)

---

## 17. 비용 제어

핵심 비용 절감 원칙:

1. 기사 전체 본문은 relevance가 높은 후보에만 가져온다.
2. 같은 URL/기사의 중복 분석을 피한다.
3. 기사 relevance 판단과 최종 요약을 한 호출에서 합칠 수 있으면 우선 검토한다.
4. 현재 interest note 전체가 작도록 상한을 둔다.
5. 분석 모델은 `gpt-5.6-luna`에서 시작한다(1절). **비용을 먼저 측정한 뒤에 모델을 키운다.**
6. **v1에는 관심 추론 호출 자체가 없다.** hot path 도구는 사용자가 그렇게 말한 턴에만 불린다.

v2에서 background batch가 들어오면 다음이 더해진다.

7. News Context Batch를 매 턴 실행하지 않는다.
8. cursor 이후 새 메시지만 보낸다.
9. assistant 문맥은 필요한 범위만 포함한다.

참고로 LangMem의 공개 문서도 active/hot-path memory와 background memory를 분리하고, 메시지마다 background 처리를 하면 **redundant work, incomplete context, unnecessary token consumption**이 생길 수 있어 debounce를 권장한다. 이 설계는 해당 패턴을 그대로 채용하는 것이 아니라, 갈피의 현재 구조에 맞춰 `8 user messages + cursor` 방식으로 단순화한 것이다.

---

## 18. 관찰 지표

자율성을 늘리기 전에 실제 품질을 본다.

**모든 판단 행에 프롬프트 버전을 함께 저장한다**(1절, `lib/mail/analyze.js`의 `PROMPT_VERSION`). 이것이 없으면 아래 숫자가 나빠졌을 때 프롬프트를 바꿔서인지 데이터가 달라져서인지 되짚을 수 없다.

최소 기록:

### Interest 생성 — hot path (v1)

- 도구 호출 수
- `expressed` / `subscribed` 생성 수
- 사용자가 나중에 삭제한 관심 비율
- **오생성**: 단순 질문("Nemotron 어때?")에 도구가 불린 횟수
- **누락**: 명시적 요청("계속 알려줘")에 도구가 안 불린 횟수

6.1절의 세 목록이 프롬프트에 그대로 들어가므로, 이 두 숫자가 그 목록의 성적표다. **v2를 열기 전에 이 둘을 본다** — hot path에서도 경계가 흔들린다면 background 추론은 더 흔들린다.

### Interest extraction — background batch (v2)

- batch 실행 수
- 입력 user message 수
- add/update/remove/noop 수
- 사용자가 나중에 삭제한 inferred interest 비율
- expressed → subscribed 전환 비율
- 잘못 생성된 관심사 수동 검토

### News relevance

- 수집 기사 수
- dedupe 후 기사 수
- relevance 통과 수
- 실제 XION 홈 뉴스 노출 수
- 사용자가 연 기사 수
- "관심 없음" 피드백 수
- **같은 기사에 대한 run-to-run 판단 흔들림** — 메일에서 나온 문제이므로 뉴스에도 있다고 가정하고 처음부터 잰다

### Proactive review (v1.1)

- review candidate 생성 수
- subscribed 전환
- expressed 유지
- remove
- 무시

이 데이터 없이 threshold와 review 기간을 정교하게 만들지 않는다.

---

## 19. 범위

세 덩이로 나눈다. **가장 비싸고 가장 틀리기 쉬운 조각을 맨 뒤에 둔다.**

### v1 — 사용자가 말한 것만

포함:

- `owner_agent=news` 단일 News Context Note
- 상태 3종의 정의와 validator (`inferred`는 v2에서 쓰지만 형식을 미리 잠근다)
- 메인 XION의 hot path 도구 — `expressed`·`subscribed` 생성·승격·제거
- mutation validator (정규화 topic 중복 포함)
- RSS/API/검색 기반 뉴스 수집
- dedupe
- interest relevance
- 제한적 원문 fetch
- 짧은 요약
- XION 홈의 조건부 뉴스 노출
- 뉴스와 관심사의 연결 이유
- 메일 인프라 재사용 — 큐 상태 기계 · 프롬프트 버전 기록 (1절)

**대가를 분명히 적어둔다.** background 추론이 없으므로 v1에는 *"말 안 해도 알아서 챙겨주는"* 동작이 없다. 사용자가 "계속 알려줘" 또는 "이거 관심 있어"라고 말한 것만 추적한다. 이것은 진짜 손실이다.

그래도 이 순서인 이유는 **v1이 그 자체로 제품이 되기 때문**이다. 명시적으로 구독한 주제의 변화를 가져와 보여주는 것만으로 기능이 선다. 반대로 관심 추론만 있고 수집이 없으면 아무것도 못 준다.

### v1.1 — 먼저 묻기

- `expressed`의 `review_after`
- 결정적 최근 언급 검사 (11.2절)
- 사용자 활동에 종속된 review candidate (11.3절)
- `shared-main` proactive assistant message
- `news_proactive_messages`·`news_review_candidates` (표는 v22에서 이미 만들어져 있다)
- review candidate용 Web Push — 기존 dispatcher와 quiet hours 재사용 (1절)
- candidate resolution

v1의 hot path가 `expressed`를 쌓은 뒤에야 의미가 생기므로 뒤에 둔다.

### v2 — 알아서 추론하기

- News Context Batch (6.2절)
- cursor와 8-user-message trigger (7절)
- `inferred` 생성·갱신·정리
- structured add/update/remove/noop

**여는 조건 둘.**

1. 메일의 판단 흔들림 관측이 끝나 있을 것. 그 결과가 이 단계의 프롬프트와 흡수 장치 설계에 그대로 들어간다.
2. 18절의 hot path 오생성·누락 숫자가 나와 있을 것.

### 전 범위에서 제외

- 범용 웹 크롤러
- 사이트별 scraper 대량 구현
- 범용 proactive agent framework
- 뉴스 이외 목적의 proactive 질문
- 일반 뉴스 전체의 자동 proactive push
- news → interest 역방향 학습
- 뉴스 추천 피드 무한 스크롤
- 사용자별 복잡한 ranking 학습
- 범용 event bus
- 뉴스 전용 대형 dashboard
- 자동 행동/트레이딩 실행
- 외부 기사 내용에 의한 도구 실행
- 처음부터 정교한 ML ranking 모델

---

## 20. 구현 단계

단계 이름은 고정하고 **실행 순서만 재배치했다.**

| 순서 | 단계 | 버전 |
|---|---|---|
| 1 | N0 — Interest Note Contract | v1 |
| 2 | N2 — Hot-path Explicit Interest | v1 |
| 3 | N4 — News Collection | v1 |
| 4 | N5 — XION Integration | v1 |
| 5 | N3 — Review Candidate + Proactive Chat | v1.1 |
| 6 | N1 — Background Interest Batch | v2 |

번호를 다시 매기지 않는 이유는 단계 이름이 논의와 커밋에서 이미 식별자로 쓰이기 때문이다. **순서는 이 표가 정본이고 아래 절의 나열 순서가 아니다** — 아래는 표와 같은 순서로 적었다.

### N0 — Interest Note Contract (v1)

작업:

- note format
- marker
- stable interest id
- state validation
- owner boundary
- topic 정규화 (10절 4번)

검증:

- 허용 영역 밖 mutation 거부
- background의 subscribed remove 거부
- duplicate id 거부
- **정규화 후 같은 topic의 중복 생성 거부**

### N2 — Hot-path Explicit Interest (v1)

작업:

- 메인 XION candidate tool (`state` 인자 포함)
- `expressed` 생성
- `subscribed` 생성·제거
- 기존 항목 승격

검증:

- "계속 알려줘"는 즉시 `subscribed`
- "요즘 관심 있어"는 `expressed`
- 단순 질문("Nemotron 어때?")은 tool 호출 안 함
- **사용자 발화가 없으면 관심이 만들어지지 않음** — assistant가 먼저 꺼낸 주제 포함
- 같은 관심을 두 번 말해도 항목이 하나

### N4 — News Collection (v1)

작업:

- 초기 source adapters
- metadata schema
- dedupe
- relevance
- selective fetch
- summary
- 큐 상태 기계 (16절)

검증:

- 동일 기사 중복 제거
- 관심 없는 기사 대부분 탈락
- 외부 콘텐츠가 interest를 수정하지 못함
- **기사의 자기 중요도 주장이 importance를 올리지 못함** (12.2절)
- 소스 하나 실패해도 나머지 동작
- 분석 실패가 좌초하지 않고 사람이 다시 돌릴 수 있음
- 프롬프트 버전이 판단 행에 남음

### N5 — XION Integration (v1)

작업:

- XION 홈의 조건부 뉴스 브리핑
- 채팅 조회
- "왜 가져왔어?" provenance

검증:

- 뉴스가 없으면 홈 UI 0개 추가
- 관심사 관리 UI가 홈에 추가되지 않음
- Attention/오늘보다 뉴스가 무조건 우선하지 않음
- 관심 근거 설명 가능
- 모바일 첫 viewport 회귀 없음

### N3 — Review Candidate + Proactive Chat (v1.1)

작업:

- `expressed`의 `review_after`
- 결정적 최근 언급 검사
- 사용자 활동에 종속된 candidate 생성
- `shared-main` proactive assistant message
- `news_proactive_messages`·`news_review_candidates` (표는 v22에서 이미 만들어져 있다)
- Web Push delivery
- candidate resolution

검증:

- 최근 계속 이야기하는 관심에는 질문 안 함
- **사용자가 앱을 안 쓰는 동안 candidate가 생기지 않음**
- proactive message가 일반 채팅에 한 번만 저장됨 — `UNIQUE(candidate_id)`가 잠근다
- Push 실패가 candidate/message를 잃게 만들지 않음
- proactive assistant message가 topic 자동 저장 또는 interest evidence가 되지 않음
- 답변에 따라 subscribed/expressed/remove 전이
- 같은 질문 반복 스팸 없음
- Push를 누르면 기존 `shared-main`의 proactive message로 진입
- payload에 관심 topic·질문 문면이 실리지 않음

### N1 — Background Interest Batch (v2)

**여는 조건은 19절에 있다.**

작업:

- cursor
- 8-user-message trigger
- minimal assistant context
- structured actions
- retry

검증:

- 이미 처리한 message 재전송 없음
- 실행 조건이 id 차가 아니라 **개수**로 계산됨 (7.1절)
- 실패 시 cursor 미이동
- **파일 쓰기와 cursor 갱신 사이에서 죽어도 관심이 두 벌이 되지 않음** (7.2절)
- 대화에서 반복 관심을 inferred로 잡음
- assistant가 먼저 꺼낸 주제는 사용자 근거 없이 interest로 만들지 않음
- proactive message가 관심 신호가 되지 않음

---

## 21. 통과 기준

### v1 — Interest

- [ ] News Context는 한 장의 agent-owned note다.
- [ ] 다른 에이전트가 XION-NEWS 영역을 수정할 수 없다.
- [ ] 사용자 발화만 관심의 evidence가 된다.
- [ ] **사용자가 말하지 않은 관심은 만들어지지 않는다.**
- [ ] 정규화 후 같은 topic이 두 항목이 되지 않는다.
- [ ] `expressed`는 지속 관심으로 자동 승격되지 않는다.
- [ ] 상태 3종의 형식이 v2에서 바뀌지 않도록 validator가 미리 잠겨 있다.

### v1 — Collection

- [ ] RSS/API 기반으로 최소 한 소스에서 수집 가능하다.
- [ ] 중복 기사가 합쳐진다.
- [ ] 관심 없는 기사는 홈까지 올라오지 않는다.
- [ ] 외부 콘텐츠는 interest나 시스템 상태를 변경하지 못한다.
- [ ] **기사의 자기 중요도 주장이 importance를 올리지 못한다.**
- [ ] 원문 fetch 실패가 전체 수집 실패가 되지 않는다.
- [ ] 분석이 실패해도 좌초하지 않고 사람이 다시 돌릴 수 있다.

### v1 — Product

- [ ] 새 소식이 없을 때 XION 홈은 더 복잡해지지 않는다.
- [ ] 사용자는 "왜 이걸 가져왔는지" 알 수 있다.
- [ ] 기능별 호출 수와 토큰 사용량을 측정할 수 있다.
- [ ] 판단 행에 프롬프트 버전이 남는다.

### v1.1 — Review / Proactive Chat

- [ ] `expressed`가 오래 조용할 때만 재확인 후보가 생긴다.
- [ ] 최근 관련 대화가 있으면 묻지 않고 review를 연장한다.
- [ ] **사용자가 앱을 쓰지 않는 동안에는 candidate가 생기지 않는다.**
- [ ] review candidate는 `shared-main` proactive assistant message로 한 번만 전달된다.
- [ ] Web Push는 전달 채널이며 candidate/message의 정본이 아니다.
- [ ] Push 실패가 candidate 상태를 유실시키지 않는다.
- [ ] proactive assistant message는 topic 자동 저장과 interest evidence에서 제외된다.
- [ ] 사용자 응답은 candidate와 연결된 bounded context로 해석된다.
- [ ] 동일 review가 반복 스팸되지 않는다.

### v2 — Background batch

- [ ] batch는 cursor 이후 새 메시지만 처리한다.
- [ ] 실행 조건이 개수로 계산된다.
- [ ] subscribed는 background에서 제거되지 않는다.
- [ ] inferred는 background가 정리할 수 있다.
- [ ] assistant 발화는 해석 문맥으로만 사용한다.
- [ ] 파일 쓰기와 cursor 갱신 사이의 실패가 관심을 두 벌로 만들지 않는다.
- [ ] 메인 채팅 latency를 background interest 추론이 늘리지 않는다.

---

## 22. 구현 전 확인할 불확실성

### 닫힌 것

1. **News Context Note의 정본 위치** — 관심 본문은 Markdown, cursor·worker 상태·proactive 표는 DB. 7.2절이 그 둘이 원자적이지 않다는 사실과 순서를 정했다.
2. **proactive chat의 전달 제한** — `lib/mail/quiet-hours.js`를 그대로 쓴다(1절). 범용 priority/notification framework를 만들지 않는다.
3. **News Agent에 사용할 모델** — `gpt-5.6-luna`에서 시작한다(1절). 비용 측정 뒤에 키운다.
4. **proactive message의 provenance 위치** — `news_proactive_messages`. `messages`는 건드리지 않는다(11.4절).
5. **뉴스 표의 schema 번호** — 전부 v22 하나다. 단계별로 쪼개면 나중에 표 재작성이 생긴다(11.4절).
6. **review 판정 시점** — 사용자 활동에 종속시킨다. v2에서 batch 성공 직후로 옮긴다(11.3절).
7. **판단의 단위** — (기사, 관심) 쌍이다. dedupe는 기사 단위로 유지한다(13절).
8. **`last_seen`의 뜻** — 사용자가 실제로 표현·언급한 시점이고, 시스템이 예정일을 미뤄도 바뀌지 않는다(11.2절).
9. **문턱이 정해지기 전의 홈 노출** — 수집·판단·조회는 `NEWS_AGENT_ENABLED`로 돌리고 홈만 `NEWS_SURFACE_ENABLED`로 따로 열었다. 표본을 모으려면 수집을 켜야 하는데, 그러면 아직 정하지 못한 `SURFACE_THRESHOLD`가 홈 판정을 시작하기 때문이다. **2026-08-21 12쌍으로 문턱을 정하고(13.1절) 홈을 켜서 인수했다.** 두 플래그를 나눈 구조는 그대로 둔다 — 표본이 설계가 요구한 30~50건에 못 미쳐 문턱을 다시 볼 수 있다.

### 남은 것

1. `expressed`의 초기 review 기간. 30일을 예시로 썼지만 근거 있는 확정값은 아니다. 18절의 review 지표가 쌓인 뒤 정한다.
2. 관심사 수 상한. 20을 예시로 썼다.
3. batch trigger 기본값 8. **v2까지 정하지 않아도 된다.** 정하기 전에 `messages`에서 최근 사용자 메시지의 일별 분포를 뽑아 batch가 하루 몇 번 도는지 먼저 본다.
4. XION 홈에서 뉴스 브리핑의 위치. review candidate는 홈에 두지 않는다. 뉴스 `알아둘 것`만 필요성이 확인되면 배치하며 모바일 첫 viewport를 다시 잰다.
5. 첫 뉴스 소스. RSS · 공식 블로그/피드 · 검색 API 중 실제 품질·비용을 비교해 최소 세트만 선택한다.
6. **11.2절 최근 언급 검사가 지금 너무 엄격하다.** 매칭은 topic 문자열 전체의 부분일치 하나뿐이고, 별칭을 등록할 통로가 v1에 없다(도구 입력에 `aliases`가 없다). 실측한 놓침: topic `초경량 로컬 LLM` ← "로컬 LLM 요즘 뭐가 좋아?", topic `OpenAI Responses API` ← "responses api 업데이트 봤어?", topic `Zigbee` ← "지그비 허브 살까". 우리가 피하고 싶은 방향(사용자가 이야기하는 중에 "요즘은 이야기가 없네"라고 묻기)의 실패다. 다만 낱말 단위로 풀면 `LLM`·`API` 같은 넓은 조각이 아무 문장에나 걸려 반대로 영영 묻지 않게 되고, 그 경계는 `SURFACE_THRESHOLD`와 같은 실데이터가 있어야 정한다. **Pi 관측 항목이다.**

---

## 23. 참고한 기존 설계와 외부 패턴

### 갈피 내부

- `AGENTS.md`
- `docs/galpi-design-final.md`
- `docs/roadmap.md`
- `docs/task-reminder-design.md`
- `docs/xion-home-design.md`
- **`docs/xion-mail-agent-design-final.md`** — 전달·큐·판단 인프라의 직접 선례다. 1절이 무엇을 가져오고 무엇을 안 가져오는지 적었다.

코드로 잠긴 계약은 다음이 정본이다.

- `lib/assistant-push.js` — 공유 dispatcher
- `lib/mail/quiet-hours.js` — 전달 시각
- `lib/mail/store.js` — 큐 상태 기계
- `lib/mail/analyze.js` — 프롬프트 버전과 외부 주장 배제 규칙
- `lib/mail/agent.js` — 결정적 identity 계산

특히 재사용하는 핵심은:

- deterministic state transition
- agent-owned note boundary
- bounded context
- read-only XION home projection
- 외부 콘텐츠는 evidence이며 instruction이 아님
- 외부 콘텐츠가 주장하는 중요도도 근거가 아님
- 중요한 상태 변경은 검증 가능한 경로를 통함

### 외부 참고

LangMem의 공개 memory architecture는 memory formation을 active/hot path와 background path로 나누고, background 처리에서 debounce를 통해 반복 처리와 불완전한 문맥, 토큰 낭비를 줄이는 패턴을 설명한다.

이 설계는 LangMem 구현을 의존성으로 채택하지 않는다. 참고한 것은 **hot path + background reflection을 분리하는 설계 패턴**뿐이고, **v1은 그중 hot path만 만든다.**

---

## 24. 최종 방향

News Agent v1의 핵심은 뉴스 수집량이 아니다.

```text
사용자 대화
   ↓
현재 관심 상태
   ↓
외부 변화 감지
   ↓
관련성과 새로움 선별
   ↓
필요한 경우에만 XION이 알려줌
```

좋은 결과는 “뉴스를 많이 찾는다”가 아니라:

> **사용자가 지금 신경 쓰는 것 중 정말 달라진 게 있을 때만 시온이 알고 있다가 꺼내주는 것**

이다.

그리고 관심 자체도 영구 사실처럼 취급하지 않는다.

> 기억은 하되, 현재도 유효한지는 함부로 단정하지 않는다.

필요하면 시온이 먼저 묻는다.

```text
관심 상태가 애매해짐
   ↓
review candidate
   ↓
시온이 shared-main에 먼저 메시지를 남김
   ↓
Web Push로 사용자에게 전달
   ↓
사용자가 같은 채팅에서 자연스럽게 답함
```

이때 관리 화면을 하나 더 만드는 대신 **대화 자체를 비서의 인터페이스**로 사용한다.

이 원칙이 News Agent의 관심 관리와 proactive review의 기준이다.

### v1이 서는 자리

위 그림은 완성된 모습이고, **v1은 그중 첫 칸을 사용자가 직접 채우는 형태로 시작한다.**

```text
사용자가 "이거 계속 알려줘"라고 말함
   ↓
관심 상태
   ↓
외부 변화 감지
   ↓
관련성과 새로움 선별
   ↓
필요한 경우에만 XION이 알려줌
```

첫 칸을 시온이 스스로 채우는 것(대화에서 관심을 추론하는 것)이 v2다. 그 칸을 나중에 여는 이유는 어렵기 때문이 아니라, **사용자가 요청하지 않은 상태를 LLM이 만드는 유일한 자리**이기 때문이다. 나머지가 먼저 안정적으로 돌고, 메일에서 같은 성질의 판단이 실제로 얼마나 흔들리는지 본 뒤에 연다.
