# XION Long-Term Memory Research Log & Brainstorm

> 상태: **RESEARCH LOG — NON-CANONICAL / HISTORICAL WORKSPACE**
>
> 작성 시작: 2026-08-26
>
> 목적: XION 개인화 장기기억 연구 과정의 아이디어, 반론, 실패 모드, 자체 가설, 사용자 결정, superseded paths를 보존한다.
>
> 운영 규칙:
> - 이 문서는 **설계 정본이 아니다**. 현재 정본은 `memory-architecture-design.md`다. 아이디어는 틀릴 수 있고 서로 충돌해도 된다.
> - 사용자가 **“추가하자 / 기록하자 / 업데이트하자”라고 말한 타이밍에만** 새 내용을 반영한다.
> - 확정된 architecture 의미·계약은 `memory-architecture-design.md`에만 승격한다. 조사 근거는 `memory-architecture-survey.md`에 남긴다.
> - 기존 아이디어가 바뀌면 가능하면 삭제하지 않고 `UPDATED / SUPERSEDED / REJECTED` 상태를 붙여 흐름을 남긴다.
> - 연구 아이디어는 가능한 한 `문제 → 가설 → 최소 실험 → 성공/폐기 조건` 형태로 발전시킨다.
> - 외부 모델/논문의 제안은 **재료**일 뿐 정답으로 취급하지 않는다.
> - 현재 Galpi의 안정된 raw/canonical layer는 보호하되, derived memory layer에서는 과감하게 실험한다.

---

## Document Authority

이 문서는 **history / scratch / rejected-alternative record**다.

- 아이디어가 나중에 REJECTED 또는 SUPERSEDED되어도 연구 경로를 설명할 가치가 있으면 남긴다.
- 현재 architecture를 판단할 때 이 문서를 단독 source of truth로 사용하지 않는다.
- 현재 의미 계약은 `memory-architecture-design.md`, 연구 근거는 `memory-architecture-survey.md`를 따른다.

---

# 1. 최상위 연구 목표

## 1.1 목표

**장기간 사용할 수 있는 신뢰할 만한 개인화 장기기억 시스템을 설계하고 실증적으로 검증한다.**

단순히 기존 memory framework를 조합하는 데서 끝나지 않는다.

- 공개된 최고의 memory mechanism을 조사한다.
- 쓸 수 있는 것은 적극적으로 가져온다.
- 기존 기술의 공통 실패를 발견하면 새로운 mechanism도 직접 설계한다.
- Galpi를 실제 longitudinal memory 실험실로 활용한다.
- 기존 구조에 맞추기 위해 좋은 아이디어를 일찍 잘라내지 않는다.
- 반대로 새롭다는 이유만으로 복잡한 아이디어를 채택하지 않는다.

핵심 연구 태도:

> **정본은 보수적으로, 기억 연구는 공격적으로.**

## 1.2 제품 목표의 교정

사용자가 원하는 것은:

> **사용자를 잘 아는 비서**

이지,

> **사용자의 머릿속 utility function을 완벽히 복원한 비서**

가 아니다.

따라서 장기기억은 사용자의 내부 상태를 과도하게 수치화하거나 단정하기보다 다음을 잘 보존하고 연결해야 한다.

- 실제 발언
- 선택
- 경험
- 맥락
- 반복된 관찰
- 정정
- 취소
- 거절
- 반례
- 현재와 과거의 차이

필요한 순간에만 현재 상황과 관련 기억을 reasoning model에 전달한다.

---

# 2. 연구 운영 구조

```text
R1 — Landscape
기존 memory system / paper / benchmark / implementation 조사

R1-X — Innovation
공통 실패 모드에서 새로운 memory mechanism 가설 생성

R2 — Synthesis
기존 mechanism + 자체 가설의 overlap을 먼저 정리하고 최소 coherent model로 합성.
후보 architecture 수는 미리 정하지 않으며, 실증적으로 unresolved인 대안만 variant로 남긴다.

R3 — Experimental Design
Galpi shadow 환경에서 R2가 닫지 못한 최소 단위의 policy / mechanism variant를 비교.
```

## 2.1 R1 종료 조건

“논문을 다 읽을 때까지”가 아니라:

- 주요 mechanism 축마다 의미 있게 다른 접근 2~3개 이상 비교
- 새 자료를 더해도 새로운 핵심 mechanism 범주가 거의 생기지 않는 saturation 도달

시 R1을 닫는다.

---

# 3. 현재 연구 축

```text
R1-A Representation & Consolidation
R1-B Retrieval & Association
R1-C Procedural / Relationship Memory
R1-D Governance / Forgetting / Conflict
R1-E Neural Memory & Learned Memory Policy
R1-F Adaptive Specialization / Formatter Architecture
R1-G Active Elicitation / Meta-memory
```

---

# 4. IDEA A — Memory Forks

## 4.1 최초 아이디어

모호한 기억을 하나의 해석으로 강제하지 않는다.

예:

```text
"요즘 커피 안 마셔."

가능한 해석:
A. 커피를 싫어하게 됨
B. 좋아하지만 건강 때문에 안 마심
C. 최근 일시적으로만 안 마심
```

단순 `AMBIGUOUS`보다:

```text
evidence
 ├─ interpretation A
 ├─ interpretation B
 └─ interpretation C
```

처럼 복수 해석을 보존하고, 이후 evidence나 사용자 확인으로 정리하는 방향.

## 4.2 Claude 리뷰에서 나온 생산적 교정

Fork와 Active Acquisition은 **같은 메커니즘이 아니라 서로 연결된 두 단계**로 보는 편이 더 정확하다.

```text
Fork
= uncertainty representation

Active Acquisition
= uncertainty reduction action policy
```

중요한 아이디어:

> 각 fork에 “이 분기가 갈리면 어떤 종류의 판단이 달라지는가?”를 연결한다.

그러면 모든 모호성을 해결할 필요가 없다.

현재 query/decision과 연결되지 않는 fork는 영원히 미해결 상태여도 된다.

```text
fork
├─ interpretation A
├─ interpretation B
└─ affects:
    - movie recommendation
    - purchase advice
    - schedule planning
```

현재 query가 영향 영역에 들어올 때만 resolve/ask 후보가 된다.

## 4.3 의미

이렇게 하면 별도의 거대한 VoI 계산 없이도:

```text
unresolved fork
        +
current query overlap
        ↓
active elicitation candidate
```

를 만들 수 있다.

### 상태

**OPEN / HIGH-POTENTIAL HYPOTHESIS**

---

# 5. IDEA B — Memory Predictions

## 5.1 최초 아이디어

기억이 과거를 설명하는 데서 끝나지 않고, 미래 interaction/choice에 대한 검증 가능한 prediction을 만들 수 있다.

```text
past evidence
    ↓
memory / observation
    ↓
future prediction
    ↓
actual future evidence
    ↓
prediction error
```

prediction이 반복적으로 빗나가면:

- memory가 과잉 일반화됐거나
- 잘못된 context를 적용했거나
- 중요한 숨은 constraint를 놓쳤을 가능성

을 재검토한다.

## 5.2 중요한 교정 — 예측 대상은 “모델 판정”보다 실제 사용자 행동/반응

LLM이 prediction을 다시 채점하면 run-to-run variance와 자기참조가 생길 수 있다.

더 직접적인 관측 label 후보:

### 선택 예측

```text
A/B 중 무엇을 고를까?
→ 실제 선택으로 채점
```

### 재등장 예측

```text
N일 안에 이 주제를 다시 꺼낼까?
→ 실제 activation log로 채점
```

### 교정 예측

```text
이 memory를 꺼냈을 때 사용자가 정정할까?
→ correction 여부로 채점
```

## 5.3 단, 행동 = 선호는 아니다

이 교정도 그대로 쓰면 위험하다.

예:

```text
사용자는 비싼 제품을 더 좋아하지만
현재 예산이 부족해서 싼 제품을 선택
```

실제 선택을 곧바로 preference truth로 해석하면 틀린다.

따라서 observation label의 의미를 분리해야 한다.

후보 evidence ordering:

```text
직접 정정
> 명시적 비교 / 명시적 선택 이유
> 실제 행동 + 알려진 제약
> 반복 언급
> 단순 재등장
```

이건 아직 **가설적 ordering**이며 실험 필요.

### 상태

**OPEN HYPOTHESIS**

---

# 6. IDEA C — Memory Competition → Contextual Memory Activation

## 6.1 최초 아이디어

같은 영역의 여러 value/preference가 ranking을 공유하며 경쟁하는 구조.

예:

```text
가격 중요
성능 중요
디자인 중요
```

## 6.2 발견한 문제

- 초기 ranking 값을 어떻게 정할 것인가
- 일반 preference와 domain-specific preference가 충돌
- context가 여러 개 동시에 걸림
- context hierarchy가 깊어짐
- 언급 횟수와 표현 강도 반영이 애매함
- stated preference와 actual behavior가 다름
- 사용자의 내부 utility를 과도하게 모델링

## 6.3 핵심 교정

**전역 ranking은 기본 memory representation으로 필요하지 않을 수 있다.**

예:

```text
"대체로 가성비를 신경 쓴다."
"전자기기에서는 가격보다 성능에 돈을 더 쓸 의향이 있다."
```

두 기억을 그대로 유지하고, 현재 상황에서 관련 기억들을 retrieval한 뒤 reasoning model이 조합하면 된다.

### 현재 형태 — Contextual Memory Activation

> 사용자의 가치·취향을 하나의 전역 ranking/utility function으로 복원하지 않는다.  
> 서로 다른 맥락의 preference / constraint / goal / behavior를 독립적인 근거 기반 기억으로 유지한다.  
> 새로운 상황에서는 관련 기억들을 함께 활성화하고, 현재 context를 보는 reasoning model이 필요할 때만 우선순위를 해석한다.

### 상태

**UPDATED HYPOTHESIS**

---

# 7. Domain-local Ranking

## 7.1 핵심 아이디어

Ranking은 불필요한 게 아니라 **필요한 domain에서만 specialized representation으로 사용**한다.

예: 영화 input이 충분히 많아지면:

```text
Movie Preference Ranking
- Project Hail Mary
- The Martian
- Interstellar
...
```

추천 시:

```text
query
 ↓
memory router
 ↓
movies specialization
 ↓
movie ranking / preference view
 ↓
top films + evidence
 ↓
LLM
```

## 7.2 Explicit comparison은 매우 고품질 evidence

예:

```text
Project Hail Mary > The Martian
basis = user_explicit_comparison
source = message_x
```

LLM이 장기간 대화에서 latent score를 억지로 추정하는 것보다 직접 비교가 훨씬 정확할 수 있다.

## 7.3 Ranking은 domain-local formatter

Ranking을 memory system 전체의 보편 primitive로 강제하지 않는다.

영화/책/게임처럼 비교가 자연스러운 곳에서만 사용 가능.

### 상태

**PROMISING SPECIALIZED REPRESENTATION**

---

# 8. Active Memory Acquisition

## 8.1 핵심 아이디어

개인화에 필요한 정보가 모호하면 무조건 추론하지 않는다.

필요하면 사용자에게 자연스럽게 역질문한다.

예:

> “프로젝트 헤일메리가 전에 좋아한다고 했던 마션보다도 더 좋았어?”

사용자:

> “응, 헤일메리가 더 좋았어.”

그러면 고품질 explicit comparison evidence 획득.

## 8.2 중요한 원칙

> **모르는 personalization 정보를 추론만 하지 말고, 가치가 높다면 사용자에게 물어볼 줄 알아야 한다.**

## 8.3 질문 남발 방지

별도 VoI를 무겁게 계산하는 대신 Memory Fork의 `affects` 정보와 현재 query overlap을 이용할 수 있다.

추가 후보 요소:

```text
future personalization value
+
current decision relevance
+
uncertainty reduction
-
user interruption cost
```

### 상태

**OPEN / HIGH-POTENTIAL HYPOTHESIS**

---

# 9. Adaptive Memory Specialization

## 9.1 핵심 아이디어

처음부터 모든 domain의 schema를 만들지 않는다.

장기간 상호작용 중 필요해진 domain에 맞춰 specialized memory structure를 만들 수 있다.

예:

```text
General Memory
   │
   ├─ Movies
   │   ├─ Ranking
   │   └─ Timeline
   │
   ├─ Projects
   │   ├─ Decision Ledger
   │   └─ Timeline
   │
   ├─ Fitness
   │   └─ Timeline / Metrics
   │
   └─ Relationships
       └─ Relationship Ledger
```

## 9.2 중요한 교정 — 한 domain에 여러 formatter를 허용

초기에는:

```text
domain → formatter 하나
```

처럼 생각하기 쉬웠지만, 실제로는:

```text
domain → 0..N formatter
```

가 더 자연스럽다.

예:

```text
Movies
├─ Ranking
├─ Timeline
└─ Preference Set
```

Ranking과 Timeline은 같은 사실을 두고 경쟁하는 해석이 아니라 **서로 다른 질문에 답하는 구조**일 수 있다.

## 9.3 Specialization 생성 기준을 “도메인 밀도” 하나로 고정하지 않는다

Claude가 제안한:

```text
비교문 반복 → Ranking
시점 표현 반복 → Timeline
인과/선택 발화 → Decision Ledger
인물 지칭 + 약속 → Relationship Ledger
```

는 **formatter bootstrap prior**로는 유용하다.

하지만 이것을 hard rule로 고정하면 안 된다.

사용자 발화 형식은 formatter의 필요성을 알려주는 신호일 뿐이다.

### 상태

**PROMISING ARCHITECTURE HYPOTHESIS**

---

# 10. Sparse Memory Routing

## 10.1 핵심 아이디어

specialization이 100개, 1000개 있어도 상관없다.

현재 episode/query와 관련된 소수만 활성화한다.

```text
episode / query
      ↓
memory routing
      ↓
0..N relevant formatter / specialization
      ↓
only those structures
```

Scalability는:

> 총 memory structure 개수

보다

> **한 interaction에서 활성화되는 structure 수**

로 보는 것이 더 중요하다.

## 10.2 다중 formatter가 오히려 데이터 요구량을 줄일 수 있음

전역 N-way router를 학습하면 formatter 수가 늘어날수록 classification space가 커진다.

하지만 formatter별 독립 accept 문제로 바꾸면:

```text
Ranking.accepts(evidence)?
Timeline.accepts(evidence)?
DecisionLedger.accepts(evidence)?
...
```

같은 formatter type을 여러 domain에서 재사용할 수 있다.

예:

```text
Ranking formatter 학습 데이터
= 영화 ranking evidence
+ 책 ranking evidence
+ 게임 ranking evidence
+ ...
```

즉 domain 수가 늘수록 formatter-type별 표본이 늘 수 있다.

### 중요한 변화

라우팅이:

```text
N-class softmax
```

가 아니라:

```text
formatter마다 독립적인
"이 evidence가 내 것인가?"
```

판정으로 바뀔 수 있다.

이건 **Mixture-of-Experts식 sparse gating과 비슷하지만 동일하지는 않다.**

## 10.3 Multi-formatter에서는 “formatter conflict”의 의미도 달라짐

write 시점:

```text
Ranking.accepts = yes
Timeline.accepts = yes
```

이면 둘 다 받으면 된다.

충돌은 write가 아니라 read에서 생긴다.

그리고 read conflict도 보통:

```text
같은 사실에 대한 competing interpretation
```

이 아니라:

```text
서로 다른 질문에 답하는 구조
```

일 가능성이 높다.

예:

```text
"어떤 영화를 더 좋아해?"
→ Ranking

"언제 봤어?"
→ Timeline
```

### 상태

**STRONG DESIGN DIRECTION**

---

# 11. Memory Formatter Architecture

## 11.1 Galpi note formatter에서 얻은 아이디어

현재 Galpi 노트가:

```text
Topic
Agent
Attachment
```

처럼 같은 Vault 안에서 상황에 맞는 formatter를 쓰듯이,

Memory도 하나의 만능 schema가 아니라 상황에 맞는 formatter를 쓸 수 있다.

예:

```text
General Fact
Ranking
Timeline
Decision Ledger
Relationship
Routine
Preference Set
...
```

## 11.2 Formatter 계약 가설

초기 아이디어:

```text
MemoryFormatter
- canHandle(...)
- extract(...)
- validate(...)
- write(...)
- retrieve(...)
- summarize(...)
- merge(...)
- explain(...)
```

Claude 리뷰 후 더 단순한 후보:

```text
MemoryFormatter
- accepts(evidence)
- merge(state, evidence)
- render(state, query)
```

공통 substrate가:

```text
write
retrieve
validate
provenance
governance
```

를 맡는 구조.

### 상태

**HIGH-POTENTIAL ARCHITECTURE HYPOTHESIS**

---

# 12. General Graph와 Specialized Formatter의 역할 분리

현재 유력한 관점:

```text
General Graph
= 의미 / entity / 관계 / provenance / routing substrate

Specialized Formatter
= 특정 domain/task를 잘 처리하기 위한 representation
```

모든 데이터를 graph에 억지로 표현하지 않는다.

예:

```text
Graph:
user ─ LIKES → movies
user ─ WORKS_ON → xion
user ─ TRAINS → cycling

Specialized Structures:
movies → Ranking + Timeline
xion → Decision Ledger
cycling → Timeline / Equipment
```

중요한 원칙:

> **DB representation을 하나로 통일하는 것 자체는 목표가 아니다.**

### 상태

**STRONG SYNTHESIS CANDIDATE**

---

# 13. Learned Routing — 순서와 데이터 문제

## 13.1 처음부터 learned router를 만들기 어려운 이유

라우팅 품질은 formatter 집합에 상대적이다.

```text
"이 routing이 좋았다"
```

는 결국:

```text
"라우팅된 memory structure가 미래 답변에 실제로 유용했다"
```

는 뜻이다.

formatter가 거의 없으면 routing quality 자체를 정의하기 어렵다.

## 13.2 그래서 순서는 “라우팅 로그 먼저 → formatter 몇 개 → 학습”

중요한 교정:

> **라우팅을 먼저 완성하는 게 아니라, 라우팅 데이터를 먼저 모은다.**

Galpi는 raw episode와 사용자 행동 로그가 이미 남기 때문에:

```text
formatter가 없어도
"이 episode는 어떤 축들과 관련됐는가?"
```

를 shadow로 기록할 수 있다.

나중에 formatter가 생기면 replay 가능.

추천 연구 순서:

```text
1. routing trace/log부터 수집
2. formatter 2~3개 구현
3. rule/LLM/bootstrap routing으로 shadow
4. 실제 retrieval/usefulness label 축적
5. learned routing 실험
```

### 상태

**STRONG EXPERIMENTAL DIRECTION**

---

# 14. Routing Label — LLM 품질점수보다 실제 사용 여부

## 14.1 중요한 아이디어

라우팅 label을 다시 LLM에게:

```text
"이 routing이 좋은 routing이었나?"
```

라고 평가하게 하면 비싸고 흔들린다.

대신:

> **라우팅해서 꺼낸 memory가 실제 답변 근거에 사용됐는가?**

를 label로 사용할 수 있다.

후보 observables:

- retrieval된 memory가 answer evidence에 실제 사용됨
- 사용된 evidence의 run/request ID
- user가 그 답을 정정함
- 후속 행동에서 해당 memory가 도움이 됨
- retrieved but unused
- retrieved and contradicted
- user explicitly rejected

즉 retrieval/action pipeline 자체가 routing precision label을 부산물로 만들 수 있다.

## 14.2 주의

“모델이 사용했다”가 곧 “좋은 memory였다”는 뜻은 아니다.

따라서 장기적으로는:

```text
used
+
not corrected
+
future utility
```

등 복수 label을 보아야 한다.

### 상태

**PROMISING LEARNING SIGNAL**

---

# 15. First Learned Decision — write / no-write

## 15.1 왜 첫 실험 후보인가

Memory Controller를 처음부터 거대한 learned system으로 만들기보다 가장 작은 decision부터 학습할 수 있다.

후보:

```text
이 episode를 derived memory로 승격할 것인가?
write / no-write
```

중요:

> raw `messages` 저장 여부가 아니다.  
> raw experience는 항상 남기고, **derived memory 승격 여부**만 학습한다.

## 15.2 현재 Galpi log 활용

기존 auto-save / task / candidate / cancellation 등 로그는 weak label이나 behavioral baseline으로 활용 가능.

하지만 현재 heuristic decision을 정답으로 그대로 학습하면:

```text
learned model
≈ old heuristic clone
```

이 될 수 있다.

따라서 현재 로그는:

- bootstrap label
- weak supervision
- baseline
- error mining source

정도로 보는 게 안전하다.

### 상태

**PROMISING FIRST LEARNING EXPERIMENT**

---

# 16. Negative Evidence를 1급 memory signal로

## 16.1 문제

초기 brainstorming은 positive evidence에 치우쳐 있었다.

하지만 개인화에서 다음은 매우 중요하다.

- 취소한 일정
- 안 누른 후보 카드
- 거절한 추천
- 끈 알림
- 저장 취소
- 숨김
- 명시적 정정
- “그건 싫어”
- “그렇게 기억하지 마”

## 16.2 중요한 교정

`negative=true` 하나로 뭉개면 안 된다.

예:

```text
preference_negative
state_transition_cancel
recommendation_reject
memory_correction
notification_disable
candidate_reject
```

처럼 semantic type을 구분해야 한다.

또한:

```text
무응답 / 안 누름
```

은 대부분 강한 negative evidence가 아니다.

### 상태

**STRONG MISSING PIECE**

---

# 17. Neural Memory Controller / Learned Memory Policy

## 17.1 출발 질문

> 왜 LLM 위에 검색 계층만 올리려고 하지?  
> 메모리를 담당하는 별도의 딥러닝 모델을 만들어 LLM과 결합할 수는 없을까?

이 질문에서 retrieval-only architecture와 다른 독립 연구 축이 열렸다.

## 17.2 핵심 구분

```text
LLM
 ↑
retrieval layer
 ↑
memory store
```

뿐 아니라:

```text
LLM
 ↑
Neural Memory Controller
 ↑
explicit memory stores
```

구조 가능.

장기적으로 사용자마다 작은 persistent neural memory state를 둘 가능성도 있다.

## 17.3 역할 분리 가설

### Explicit / declarative memory

> 무엇을 알고 있는가?

- raw episodes
- temporal facts
- graph
- formatter tables
- explicit ranking
- decisions
- provenance
- user corrections

특성:

- editable
- auditable
- provenance-preserving
- delete / retract / restore 가능

### Neural memory / controller

> 어떻게 기억하고, 어디로 보내고, 지금 무엇을 꺼낼 것인가?

후보 역할:

- write / no-write
- formatter accept/routing
- retrieval prioritization
- consolidation candidate detection
- active elicitation trigger
- specialization proposal
- learned suppression/forgetting
- latent user representation

## 17.4 기존 아이디어와 연결

```text
Sparse Routing
Adaptive Specialization
Active Elicitation
Memory Predictions
```

를 하나의 learned policy로 연결할 가능성.

## 17.5 장기 credit assignment

```text
t=1
memory action

...

t=100
future assistant success/failure

        ↓
earlier memory action credit assignment
```

궁극적으로는 future assistant utility가 memory policy 학습 목표가 될 수 있다.

## 17.6 현재 제한

Pure neural memory로 explicit memory를 대체하는 것은 현재 단계에서 비추천.

이유:

- 개별 기억 수정/삭제 어려움
- provenance 어려움
- user correction / restore 어려움
- catastrophic interference
- governance 불투명

따라서 현재 유력 가설:

> **Explicit auditable memory + learned neural memory controller**

### 상태

**HIGH-POTENTIAL RESEARCH AXIS**

---

# 18. 현재 목표 함수에 대한 질문

Claude 리뷰에서 나온 중요한 질문:

> 이 시스템의 목표 함수를 무엇으로 볼 것인가?

단순히:

```text
"사용자가 같은 말을 두 번 하지 않아도 되는 비율"
```

만 최적화하면 과기억과 과개입을 유도할 수 있다.

현재 후보:

```text
Memory Utility
=
future helpfulness
- false-memory cost
- correction burden
- irrelevant retrieval cost
- user interruption cost
```

추가로 볼 수 있는 항목:

- obsolete memory reuse
- evidence provenance correctness
- abstention quality
- active elicitation annoyance
- latency / token cost
- user correction recovery

이 목표 함수는 아직 확정하지 않는다.

### 상태

**OPEN CORE RESEARCH QUESTION**

---

# 19. 현재 가장 중요한 메타 인사이트

## 19.1 Memory != complete user model

```text
Memory System
= evidence + useful observations + specialized structures

Reasoning
= current context에서 의미 조합

Optional User Model
= 특정 문제에서만 파생
```

## 19.2 specialization 개수보다 activation sparsity

```text
1000 structures × 2 active
```

가:

```text
10 structures × 10 active
```

보다 더 나을 수 있다.

## 19.3 질문도 memory mechanism

사용자에게 묻는 것은 단순 UX가 아니라 **memory evidence acquisition operation**이다.

## 19.4 하나의 schema를 찾는 것이 잘못된 목표일 수 있다

```text
common substrate
+
multiple formatter types
+
sparse routing
+
active acquisition
+
learned controller
```

조합일 가능성.

## 19.5 Routing과 Formatter는 서로 공동 진화한다

라우팅을 먼저 완성하고 formatter를 나중에 붙이는 것도,
formatter를 완성한 뒤 routing을 시작하는 것도 지나치게 선형적이다.

더 현실적인 흐름:

```text
routing trace 먼저
→ formatter 2~3개
→ shadow routing
→ usefulness labels
→ learned routing
→ formatter 확대
→ replay / 재학습
```

---

# 20. 다음 연구에서 반드시 조사할 영역

- adaptive / modular memory architecture
- heterogeneous memory stores
- schema induction
- adaptive specialization
- sparse routing
- mixture-of-experts와 memory routing
- independent gating vs N-way routing
- active preference elicitation
- value of information
- pairwise ranking / recommender systems
- contextual personalization
- learned write policies
- learned routing
- procedural / relationship memory
- memory reconsolidation
- dynamic user modeling
- meta-memory
- negative feedback / rejection learning
- implicit vs explicit user feedback
- test-time learning
- neural long-term memory
- fast weights
- Memorizing Transformers
- Recurrent Memory Transformer
- Titans
- long-horizon credit assignment
- continual learning / catastrophic interference

---

# 21. Brainstorm Log

## 2026-08-26 — Initial XION memory research

1. Graphiti-inspired temporal graph 단일 구조에서 출발.
2. 목표를 “Graphiti-lite”가 아니라 “최고 수준의 개인화 장기기억”으로 확장.
3. 기존 기술 조합뿐 아니라 새로운 memory mechanism 발명을 명시적 연구 목표로 추가.
4. `Memory Forks`, `Memory Predictions`, `Memory Competition` 아이디어 발생.
5. preference ranking을 전역 latent utility로 만드는 접근의 구멍 발견.
6. “사용자는 머릿속을 꿰뚫는 AI보다 자신을 잘 아는 비서를 원한다”는 제품 목표 재확인.
7. 전역 ranking 대신 **domain-local ranking** 아이디어.
8. 모호할 때 사용자에게 물어보는 **Active Memory Acquisition** 아이디어.
9. domain이 성장하면 적절한 structure를 추가하는 **Adaptive Memory Specialization** 아이디어.
10. specialization 개수보다 interaction당 활성화 수가 중요하다는 **Sparse Memory Routing** 관점.
11. Galpi의 Topic / Agent / Attachment 구조에서 영감을 받아 **Memory Formatter Architecture** 제안.
12. General graph는 semantic/routing substrate, specialized formatter는 domain-local representation을 담당하는 분리 가능성.
13. 메모리 담당 별도 딥러닝 모델 가능성을 질문하면서 **Neural Memory Controller / Learned Memory Policy** 연구 축이 열림.
14. explicit memory = `what do I know?`, neural controller = `how should I remember / retrieve / route?`라는 역할 분리 가설.
15. Memory Controller가 Sparse Routing, Adaptive Specialization, Active Elicitation, Memory Predictions를 연결할 가능성.
16. Pure neural replacement 대신 **explicit auditable memory + neural controller hybrid**를 우선 연구 후보로 둠.

## 2026-08-26 — Claude review / adversarial brainstorming 반영

17. Fork와 Active Acquisition은 동일 메커니즘이 아니라 `uncertainty representation ↔ uncertainty reduction action` 관계로 정리.
18. Fork마다 “이 분기가 어떤 판단을 바꾸는가”를 연결하면 대부분의 모호성을 영구 미해결 상태로 둬도 됨.
19. Memory Prediction의 평가 신호를 LLM 자체 채점보다 실제 사용자 선택/재등장/정정 같은 observable behavior 쪽으로 옮기는 아이디어.
20. 다만 행동=선호는 아니므로 실제 행동의 constraint/context를 함께 봐야 한다는 반론 추가.
21. Specialization 생성 기준을 단순 domain density로 고정하지 않고, 비교문·시점·인과·관계 발화형식을 formatter bootstrap signal로 사용할 가능성.
22. **한 domain에 여러 formatter를 동시에 허용**하는 방향을 명확히 함.
23. Multi-formatter에서는 write conflict가 거의 사라지고 read 시점에 질문 종류별 formatter 선택 문제가 중심이 됨.
24. Routing을 N-class classification보다 formatter별 independent accept/gating 문제로 보는 방향 제안.
25. 같은 formatter type을 여러 domain에서 재사용하면 domain 수 증가가 오히려 formatter별 학습 표본을 늘릴 수 있다는 아이디어.
26. Learned router를 바로 만들기보다 **routing log를 먼저 수집하고 formatter 2~3개를 만든 뒤 학습**하는 순서 제안.
27. Routing label을 LLM 품질평가가 아니라 “꺼낸 memory가 실제 답변 근거로 쓰였는가” 같은 runtime signal에서 얻는 아이디어.
28. 첫 learned decision 후보로 **derived memory write/no-write**를 제안. 기존 auto-save log는 ground truth가 아니라 weak label/baseline으로 취급.
29. Positive evidence만이 아니라 **typed negative evidence**(취소, 거절, 정정, 숨김, 알림 끄기 등)를 1급 신호로 봐야 한다는 결론.
30. 목표 함수는 단순 recall이 아니라 future helpfulness, false-memory, correction burden, irrelevant retrieval, interruption cost를 함께 봐야 한다는 문제 제기.

---

# 22. 지금 시점의 잠정 구조

아직 설계 확정이 아니라 brainstorming synthesis다.

```text
                        XION
                         │
                         ▼
                  Reasoning LLM
                         ▲
                         │
               Memory Orchestration
                         │
        ┌────────────────┼────────────────┐
        │                │                │
   Explicit Store   Neural Controller   Active Elicitation
        │                │                │
        │                ├─ write/no-write
        │                ├─ formatter gating
        │                ├─ retrieval routing
        │                └─ specialization policy
        │
        ├─ Raw Episodes
        ├─ General Graph
        ├─ Fork / uncertainty
        ├─ Negative Evidence
        └─ Specialized Formatters
              ├─ Ranking
              ├─ Timeline
              ├─ Decision Ledger
              ├─ Relationship Ledger
              └─ future formatter types

Routing principle:

episode/query
    ↓
record routing trace
    ↓
0..N formatter independent accepts
    ↓
sparse active structures
    ↓
retrieve / render
    ↓
LLM answer
    ↓
actual-use / correction / behavior logs
    ↓
future routing & memory-policy learning
```

---

# 23. 현재 열려 있는 핵심 질문

1. Formatter의 최소 공통 contract는 무엇이어야 하나?
2. General Graph는 routing substrate인가, memory representation 중 하나인가?
3. Fork를 실제 schema로 둘 것인가, proposal/evidence state로만 둘 것인가?
4. Router는 언제 rule → learned policy로 승격할 것인가?
5. `accepts(evidence)` label은 어떻게 얻을 것인가?
6. 실제 답변에서 memory가 “사용됨”을 어떻게 deterministic하게 기록할 것인가?
7. Negative evidence semantic taxonomy는 어느 정도까지 필요한가?
8. write/no-write의 gold label을 무엇으로 정의할 것인가?
9. Specialized formatter state 중 무엇이 rebuildable이고 무엇이 canonical인가?
10. Neural Memory Controller의 첫 prototype 크기/입력/출력은 무엇인가?
11. Memory Utility의 실제 objective와 catastrophic error penalty는 어떻게 정의할 것인가?
12. 사용자에게 물어볼 타이밍은 fork-query overlap만으로 충분한가?
13. 여러 formatter가 같은 evidence를 받아도 provenance는 한 번만 유지할 수 있는가?
14. formatter type 간 cross-domain transfer가 실제로 성립하는가?
15. routing log를 formatter가 아직 없는 초기 단계부터 어떤 schema로 남겨야 replay가 가능한가?

---

# 24. 문서의 역할

이 문서는 **좋은 아이디어를 잊지 않기 위한 연구 작업대**다.

여기 있는 내용은:

- 설계 결정이 아니다.
- 구현 지시가 아니다.
- benchmark 결과가 아니다.
- 외부 연구의 사실을 그대로 의미하지도 않는다.

아이디어를 충분히 부딪혀 본 뒤:

```text
ADOPT
EXPERIMENT
DEFER
REJECT
```

판정을 거쳐 정본 설계로 승격한다.

---

# 25. Counterfactual Supervision / Logged-Policy Bias

## 25.1 Q5와 Q8의 공통 병목

`formatter.accepts(evidence)` 라벨과 `derived memory write/no-write` gold label은 사실 같은 문제를 공유한다.

> **오라클 없이 감독 신호를 어디서 얻는가?**

현재 heuristic 자체의 결정을 정답으로 쓰면:

```text
learned policy
≈ current heuristic clone
```

이 된다.

따라서 **결정 자체가 아니라 결정의 하류 결과**를 봐야 한다.

후보:

- 나중에 실제로 retrieval됐는가
- 답변에 실제로 기여했는가
- 사용자가 정정했는가
- 후속 행동에 도움이 됐는가
- obsolete memory로 방해했는가

## 25.2 Logged-policy selection bias

그러나 여기에도 더 근본적인 문제가 있다.

현재 production policy가:

```text
episode
  ↓
heuristic
  ├─ WRITE
  │    └─ downstream outcome observable
  │
  └─ NO WRITE
       └─ "썼으면 유용했을까?"는 관측 불가
```

라면 학습 로그는 현재 정책에 의해 선택된다.

즉 추천 시스템의 **logged bandit feedback / selection bias**와 비슷한 문제가 생긴다.

## 25.3 Galpi에서 가능한 탈출구 — Shadow All-Write

Galpi는 raw episode를 이미 보존하고 있고, derived layer는 실험해도 된다.

따라서:

```text
RAW
모든 episode를 항상 보존

PRODUCTION
현재 정책이 선택한 derived memory만
실제 XION answer path에 영향

SHADOW
승격 판정과 무관하게 candidate derived memory를 모두 생성
실제 답변에는 영향 없음
```

구조로 counterfactual coverage를 넓힐 수 있다.

이렇게 하면 production heuristic이 버린 episode도:

> "저장했다면 나중에 retrieval 후보가 되었을까?"

를 shadow에서 관측할 수 있다.

## 25.4 완전한 counterfactual은 아니다

Shadow에 모든 memory를 넣으면 retrieval 경쟁 조건 자체가 달라진다.

```text
production store
≠
shadow-full store
```

따라서 write-axis selection bias는 줄어들지만 retrieval-axis counterfactual bias는 남는다.

장기 연구 후보:

```text
SHADOW-FULL
모든 candidate 사용

SHADOW-EXPLORE
일부 candidate를 의도적으로 include/exclude
```

소량 randomized exploration을 shadow에서만 수행하고, propensity/logging을 남기는 방식.

## 25.5 주의

Shadow replay만으로는:

```text
"답이 달라졌는가?"
```

는 볼 수 있지만,

```text
"사용자가 그 다른 답을 더 좋아했는가?"
```

는 직접 관측할 수 없다.

최종 user utility에는 여전히:

- 실제 correction / choice
- periodic human review
- 제한된 production experiment
- explicit user feedback

같은 별도 신호가 필요할 수 있다.

### 상태

**CORE EXPERIMENTAL PROBLEM / HIGH PRIORITY**

---

# 26. Causal Memory Contribution — Proxy + Sampled Leave-One-Out

## 26.1 문제

> "retrieved memory가 실제로 answer에 사용됐는가?"

를 모델 자기보고만으로 측정하면 흔들릴 수 있다.

인용 태그/attribution은 유용한 proxy일 수 있지만 ground truth가 아니다.

## 26.2 Leave-One-Out

후보 memory `m_i`에 대해:

```text
answer(M)
vs
answer(M - m_i)
```

를 비교하면 해당 memory의 marginal contribution을 추정할 수 있다.

## 26.3 결정론적이라는 표현은 피한다

Reader가 LLM이면 같은 prompt도 provider/model runtime에 따라 미세한 nondeterminism이 남을 수 있다.

따라서 가능하면:

```text
fixed model snapshot
fixed prompt
temperature = 0
fixed seed where supported
paired execution
```

을 사용한다.

더 엄밀한 샘플 실험에서는:

```text
with m_i    × K
without m_i × K
```

의 paired distribution을 비교할 수 있다.

## 26.4 전량 proxy + 표본 LOO

매 요청마다 LOO를 하면 너무 비싸다.

따라서:

### Cheap proxies — 전량

- structured memory-ID attribution
- answer/evidence entailment
- structured decision change
- citation presence
- lexical / n-gram overlap

### Expensive causal-ish check — 표본

- LOO / ablation replay
- 필요하면 repeated paired runs

### 목적

Proxy 자체를 truth로 믿는 것이 아니라:

> **proxy의 precision / recall / error rate를 calibration한다.**

## 26.5 Structured output change는 강한 신호가 될 수 있음

예:

```text
with memory:
recommendation = A

without memory:
recommendation = B
```

처럼 high-level decision이 바뀌면 contribution signal이 강하다.

### 상태

**PROMISING EVALUATION MECHANISM**

---

# 27. `affects`는 저장 필드가 아니라 Routing 부산물

## 27.1 이전 아이디어

Fork마다:

```text
affects:
- movie recommendation
- purchase advice
- schedule planning
```

같은 영향 영역을 저장하는 방안을 생각했다.

## 27.2 교정

이 필드를 write 시점 LLM이 직접 생성하면:

- 새로운 LLM 판단이 하나 더 생기고
- run-to-run variance가 추가되며
- formatter/routing과 중복된다.

따라서 `affects`를 별도 canonical/derived field로 저장하지 않는 방향이 더 단순하다.

## 27.3 Runtime derivation

Fork는 evidence에 붙어 있고, evidence는 0..N formatter / structure membership을 가질 수 있다.

현재 query가 오면 routing이 이미:

```text
query
  ↓
[MovieRanking, MoviePreference, ...]
```

를 계산한다.

이때 unresolved fork가 같은 active structure에 걸려 있으면:

```text
fork ∩ routed structures != ∅
→ elicitation candidate
```

로 보면 된다.

즉:

> **영향 영역은 저장되는 속성이 아니라 query-time routing overlap에서 파생된다.**

## 27.4 General evidence fallback

아직 specialized formatter에 들어가지 않은 fork도 있을 수 있으므로:

```text
General Fact / General Graph
```

자체도 routing target으로 취급할 수 있다.

### 상태

**STRONG SIMPLIFICATION**

---

# 28. Fork Branch = Hypothesis = Prediction

## 28.1 핵심 통합

Fork와 Memory Prediction은 서로 완전히 별개의 메커니즘이 아닐 수 있다.

각 fork branch는:

> **이 해석이 맞다면 앞으로 어떤 observation이 나와야 하는가?**

를 암묵적으로 포함한다.

예:

```text
Evidence:
"요즘 커피 안 마셔."

Branch B:
좋아하지만 건강 때문에 안 마심

Branch C:
최근 일시적으로만 안 마심
```

각 branch는 미래 evidence에 대해 서로 다른 기대를 만든다.

```text
evidence
  ↓
forked hypotheses
  ↓
predicted discriminating observations
  ↓
future evidence
  ↓
support / weaken / reject branch
```

## 28.2 시간만 지났다고 branch를 죽이면 안 됨

중요:

> **absence of evidence != evidence of absence**

3개월 동안 커피 이야기가 없었다고 특정 branch가 틀렸다고 결론낼 수 없다.

따라서 단순 `deadline`보다:

```text
expected_observation
observation_window
observation_opportunity
```

같은 개념이 더 적절할 수 있다.

예:

- 실제로 커피를 선택할 상황이 다시 있었는가?
- 해당 topic이 다시 등장할 기회가 있었는가?
- 관련 행동을 관측할 수 있었는가?

## 28.3 Fork 해소 경로

현재 최소 세 경로를 고려한다.

```text
1. new evidence
2. explicit user confirmation / correction
3. future observation that discriminates branches
```

### 상태

**HIGH-POTENTIAL SYNTHESIS**

---

# 29. Canonical Evidence/Event Ledger

## 29.1 강한 방향

현재 가장 강한 source-of-truth 가설:

> **canonical = evidence / event ledger**
>
> **formatter state = 100% rebuildable projection**

## 29.2 Canonical evidence의 범위

단순 user message만이 아니라, 관측 가능한 user/system governance event도 evidence로 본다.

예:

```text
user utterance
explicit comparison
explicit preference
task completion
task cancellation
candidate approval
candidate rejection
recommendation rejection
notification disable
memory correction
entity merge approval
entity merge rejection
```

이들은 모두 **관측된 사건**이다.

## 29.3 Derived state

다음은 evidence ledger에서 다시 만들 수 있는 projection 후보:

```text
ranking
fork
entity equivalence projection
observation
current preference
formatter state
timeline view
decision ledger view
relationship view
```

## 29.4 User-confirmed ranking도 canonical state가 아님

예:

```text
"Project Hail Mary가 The Martian보다 더 좋아."
```

이것을 canonical ranking row로 저장할 필요가 없다.

대신:

```text
evidence:
  type = user_explicit_comparison
  lhs = Project Hail Mary
  relation = preferred_over
  rhs = The Martian
  source_message = ...
```

를 canonical하게 저장한다.

Ranking formatter는 이를 재생성한다.

## 29.5 Supersession / correction

사용자가:

```text
"아니, 그때 말 잘못했어."
```

라고 하면 기존 evidence를 physical rewrite하지 않고 correction/supersession event를 추가한다.

그 후:

```text
ledger replay
→ formatter / fork / ranking / observation recompute
```

로 반영한다.

### 상태

**VERY STRONG ARCHITECTURE CANDIDATE**

---

# 30. Multi-Formatter Provenance — Q9/Q13 통합

## 30.1 문제

한 evidence가 여러 formatter에 들어갈 수 있다.

```text
Evidence E137
 ├─ Ranking
 ├─ Timeline
 └─ Decision Ledger
```

provenance를 formatter마다 복제하면 중복과 drift가 생긴다.

## 30.2 해결 방향

Evidence는 substrate에 한 번만 저장한다.

각 formatter는:

```text
evidence_id
```

를 참조한다.

그러면 provenance는 한 벌만 존재한다.

```text
formatter state
→ evidence_id
→ canonical event/message
```

## 30.3 결과

- multi-formatter 허용이 쉬움
- formatter rebuild 가능
- correction propagation 단순
- provenance duplication 없음
- formatter별 copy divergence 없음

### 상태

**STRONG DESIGN DIRECTION**

---

# 31. Objective — Scalar Weighted Sum보다 Constrained / Lexicographic Optimization

## 31.1 문제

초기 후보:

```text
Memory Utility
=
future helpfulness
- false-memory cost
- correction burden
- irrelevant retrieval cost
- interruption cost
```

는 각 항의 단위가 다르고 가중치가 임의적일 수 있다.

특히 개인화 memory는 오차 비용이 심하게 비대칭이다.

> 확신을 갖고 틀린 기억 하나가 놓친 기억 여러 개보다 더 나쁠 수 있다.

## 31.2 Constrained formulation

후보:

```text
maximize:
future helpfulness

subject to:
false-memory rate <= X
elicitation frequency <= Y
retrieval latency <= Z
token/resource budget <= B
```

## 31.3 Lexicographic priority

초기 연구에서는 다음 순서를 둘 수도 있다.

```text
1. Safety / correctness constraints
   - catastrophic false memory
   - false entity merge
   - provenance loss

2. UX / operational constraints
   - question frequency
   - latency
   - token budget

3. 그 안에서 helpfulness maximize
```

## 31.4 Threshold는 calibration이 필요함

`X/Y/Z`를 단순 취향으로 정하면 끝나는 문제는 아니다.

실제 데이터 분포를 보고:

- 너무 빡빡한지
- 너무 느슨한지
- achievable frontier가 어디인지

봐야 한다.

따라서 초기에는 하나의 optimum보다 **Pareto frontier**를 비교하는 것이 좋을 수 있다.

예:

```text
System A
helpfulness ↑
question burden ↑

System B
helpfulness slightly ↓
question burden much ↓
```

### 상태

**PROMISING EVALUATION FRAMEWORK**

---

# 32. Censoring / Positive-Unlabeled Memory Outcomes

## 32.1 새로 발견한 함정

어떤 memory가 저장됐지만 2주 동안 한 번도 retrieval되지 않았다고 해서:

```text
useless
```

라고 label하면 안 된다.

6개월 뒤 매우 중요한 순간에 한 번 쓰일 수 있다.

즉:

```text
not retrieved yet
```

는 negative가 아니라 **아직 outcome이 관측되지 않은 censored sample**일 수 있다.

## 32.2 라벨 구조 후보

```text
positive
= 실제로 도움됨 / 사용됨

negative
= 실제로 잘못됨 / 방해됨 / 사용자 정정

unlabeled / censored
= 아직 의미 있는 outcome이 관측되지 않음
```

## 32.3 관련 연구 축

- positive-unlabeled learning
- survival analysis
- delayed feedback
- long-horizon bandit feedback
- censored recommendation outcomes

### 상태

**IMPORTANT LEARNING PROBLEM**

---

# 33. Memory Hypothesis Loop

4장(Fork), 5장(Prediction), 10장(Routing)은 데이터 구조 하나로 합칠 필요는 없지만 **하나의 lifecycle**로 묶일 가능성이 높다.

임시 이름:

> **Memory Hypothesis Loop**

```text
                  Evidence
                     │
                     ▼
             Formatter Routing
                     │
                     ▼
            Derived Interpretation
                     │
             ┌───────┴────────┐
             │                │
          resolved          fork
                              │
                              ▼
                         hypotheses
                              │
                    predictions/discriminators
                              │
          ┌───────────────────┴──────────────────┐
          │                                      │
 future observation                      relevant query arrives
          │                                      │
          ▼                                      ▼
 support / weaken / reject             unresolved branch encountered
                                                   │
                                                   ▼
                                          Active Elicitation?
                                                   │
                                                   ▼
                                              new evidence
                                                   │
                                                   └────→ loop
```

## 33.1 역할 분리

### Routing

> 지금 어떤 memory structure가 관련 있는가?

### Fork

> 무엇을 아직 모르는가?

### Prediction

> 어떤 future observation이 해석을 가를 수 있는가?

### Active Elicitation

> 지금 사용자에게 물어볼 가치가 있는가?

## 33.2 중요한 원칙

이들을 하나의 테이블이나 하나의 LLM call로 억지로 합치지 않는다.

**lifecycle은 통합하되 responsibility는 분리한다.**

### 상태

**STRONG SYNTHESIS CANDIDATE**

---

# 34. Updated Experimental Lanes

현재 실험 구조 후보:

```text
                       RAW EPISODES
                            │
         ┌──────────────────┼──────────────────┐
         │                  │                  │
         ▼                  ▼                  ▼
   PRODUCTION          SHADOW-FULL       SHADOW-EXPLORE
 current policy         all candidates      sampled subsets
 real answers           no user impact      no user impact
         │                  │                  │
         └──────────────┬───┴───────┬──────────┘
                        │           │
                        ▼           ▼
                   replay/eval   randomized logs
                        │           │
                        └─────┬─────┘
                              ▼
                     policy learning/eval
```

목표:

- production behavior는 안정적으로 유지
- shadow에서 counterfactual coverage 확장
- replay 가능한 immutable logs 보존
- future learned policy 비교 가능

### 상태

**PROMISING GALPI EXPERIMENT ARCHITECTURE**

---

# 35. Updated Open Questions

1. Canonical evidence/event ledger의 exact schema는 무엇이어야 하나?
2. Evidence correction / supersession / retraction event를 어떻게 표현할 것인가?
3. Formatter state는 정말 100% rebuildable로 유지할 수 있는가?
4. Entity equivalence approval도 evidence/event ledger로 충분히 표현 가능한가?
5. `accepts(evidence)`의 gold/weak label을 어떻게 얻을 것인가?
6. write/no-write 학습에서 censored/unlabeled sample을 어떻게 다룰 것인가?
7. Shadow-All-Write가 만들어내는 retrieval distribution shift를 어떻게 보정할 것인가?
8. SHADOW-EXPLORE의 randomized inclusion/exclusion은 어느 정도까지 안전하고 유용한가?
9. memory contribution proxy를 어떤 조합으로 만들 것인가?
10. sampled LOO의 frequency와 K를 어떻게 정할 것인가?
11. LOO에서 provider nondeterminism을 어떻게 추정할 것인가?
12. Fork branch의 predicted observation은 누가/어떻게 생성할 것인가?
13. `observation_opportunity`를 어떻게 정의하고 기록할 것인가?
14. Routing overlap만으로 active elicitation timing이 충분한가?
15. Multi-formatter read 시 어떤 formatter를 어떻게 조합할 것인가?
16. formatter별 independent gating이 실제 N-way routing보다 sample-efficient한가?
17. cross-domain formatter transfer가 실제로 성립하는가?
18. constraints X/Y/Z를 어떤 shadow distribution에서 calibration할 것인가?
19. helpfulness를 어떤 observable outcome으로 정의할 것인가?
20. long-horizon memory outcome에 PU learning / survival analysis가 실제로 적합한가?
21. Memory Hypothesis Loop를 어느 수준까지 deterministic state machine으로 만들 수 있는가?
22. Neural Memory Controller가 loop의 어느 decision부터 맡아야 하는가?

---

# 36. Brainstorm Log Update — 2026-08-26 / Claude Review Round 2

31. Q5(`accepts`)와 Q8(`write/no-write`)을 동일한 **오라클 없는 감독신호 문제**로 묶음.
32. 현재 policy가 선택한 outcome만 관측되는 **logged-policy selection bias**를 핵심 병목으로 식별.
33. Galpi의 raw 보존 구조를 활용해 **Shadow All-Write**로 write-axis counterfactual coverage를 넓히는 아이디어.
34. Shadow-All-Write만으로는 retrieval distribution이 변하므로 **SHADOW-EXPLORE / randomized subset** 연구 필요.
35. memory usage attribution을 모델 자기보고만으로 보지 않고 **cheap proxy + sampled LOO**로 calibration하는 방향.
36. LOO도 LLM nondeterminism 때문에 완전 결정론적이지 않으므로 repeated paired runs가 필요할 수 있음.
37. Fork의 `affects`는 stored field가 아니라 **query-time routing overlap에서 파생**시키는 방향으로 단순화.
38. Fork branch 자체를 **hypothesis/prediction**으로 보고 future discriminating observation으로 해소하는 아이디어.
39. 단순 time deadline이 아니라 `observation_opportunity`를 구분해야 함.
40. **Canonical = evidence/event ledger**, formatter state = rebuildable projection 방향 강화.
41. User-confirmed ranking도 canonical ranking row가 아니라 explicit comparison evidence로 저장.
42. Multi-formatter provenance는 evidence ID를 공유해 한 벌만 유지.
43. scalar Memory Utility 대신 **constrained / lexicographic optimization**을 우선 검토.
44. threshold는 임의 취향값으로 끝나지 않고 실제 shadow distribution에서 calibration 필요.
45. 아직 retrieval되지 않은 memory를 negative로 보지 않고 **censored / unlabeled** sample로 취급하는 문제 발견.
46. Fork / Prediction / Routing / Elicitation을 데이터 구조 하나로 합치지 않고 하나의 **Memory Hypothesis Loop** lifecycle로 묶는 방향.
47. 현재 실험 architecture를 `RAW / PRODUCTION / SHADOW-FULL / SHADOW-EXPLORE` lane으로 구체화.

---

# 37. Scoring / Routing Experiment — User Decisions Locked

2026-08-26 기준, 첫 실제 메모리 연구 실험을 위해 다음 결정을 닫는다.

## D0 — 첫 비교 축

**결정: Routing**

비교 대상:

```text
hard-gated
vs
global-soft-prior
```

이유:
- 두 정책이 이미 Galpi 코드에 존재
- formatter는 아직 구현되지 않아 직접 비교 불가
- write/no-write는 outcome horizon이 길다
- routing은 새 architecture 구현 없이도 즉시 shadow 비교 가능
- 첫 실험에서 가장 중요한 것은 “좋은 routing을 측정할 수 있는가”라는 evaluation instrumentation 검증

**상태: CLOSED**

## D1 — “memory가 실제로 쓰였다”의 측정

**결정: cheap proxy 전량 + sampled LOO calibration**

```text
all requests:
cheap attribution proxies

sampled requests:
leave-one-out / ablation replay

LOO result:
proxy error rate calibration
```

프록시 자체를 truth로 보지 않는다. 목적은 **프록시가 어느 정도 틀리는지 아는 것**이다.

후보 cheap proxy:
- structured memory ID attribution
- answer/evidence entailment
- structured recommendation/decision change
- citation marker
- lexical overlap

LOO는 비용과 LLM nondeterminism 때문에 표본 실험으로 제한한다.

**상태: CLOSED — exact proxy set은 experiment detail로 OPEN**

## D2 — 실험 위치

**결정: Shadow only**

```text
production:
현재 답변 경로 유지

shadow:
비교 lane 별도 생성
사용자에게 노출 안 함
```

**상태: CLOSED**

## D3 — 비교 budget

**결정: 문자 수 고정**

현재 assistant retrieval의 `maxContextChars` 계약을 비교 조건으로 승격한다.

기본 기준:

```text
8,000 characters
```

실제 device / mode별 context 상한이 다르면 해당 모드의 실제 문자 budget을 동일하게 맞춘다.

**상태: CLOSED — mode별 exact budget mapping은 측정 후 확정**

## D4 — False memory

**결정: 점수 항이 아니라 hard constraint**

```text
maximize:
future helpfulness

subject to:
false-memory rate <= X
elicitation burden <= Y
latency <= Z
resource/token budget <= B
```

허위 기억과 missed memory의 교환비를 임의 scalar weight로 만들지 않는다.

- constraint 형식은 CLOSED
- 실제 X/Y/Z/B 값은 OPEN
- threshold는 shadow distribution과 사건 빈도를 보고 calibration

## D5 — Correction gold signal

**결정: 명시적 행동만으로 시작**

초기 gold-negative/correction signal 후보:

```text
remove
cancel
hide
reject
disable
explicit undo
explicit memory deletion/correction action
```

자연어 correction은 초기 gold label에 포함하지 않는다.

**상태: CLOSED**

## D6 — Shadow All-Write

**결정: 한다**

목적:
- production heuristic이 버린 episode도 counterfactual candidate로 남김
- write/no-write 학습의 logged-policy selection bias 완화
- future replay 가능성 확보

주의:
- Shadow-All-Write는 retrieval distribution을 바꾸므로 완전한 counterfactual이 아님
- SHADOW-EXPLORE / randomized subset이 후속 연구로 필요할 수 있음
- embedding/storage/API cost는 실제 측정

**상태: CLOSED direction**

---

# 38. 첫 실험의 실제 연구 질문

표면 질문:

> `hard-gated`와 `global-soft-prior` 중 어느 routing이 더 좋은가?

더 근본적인 연구 질문:

> **LLM이 여러 memory chunk를 동시에 소비하는 상황에서 routing quality를 안정적으로 측정할 수 있는가?**

첫 실험은 routing policy winner를 정하는 것보다 **evaluation instrument validation**이 우선이다.

---

# 39. Interleaving — 아직 연구 가설

전통 IR interleaving은 사용자가 ranked list를 훑고 click하는 상황에서 강한 통계적 장점이 있다.

하지만 LLM은 여러 evidence를 동시에 읽고 조합한다. 따라서 기존 IR interleaving의 이론적 보장이 그대로 이식된다고 가정하지 않는다.

Primary baseline:

```text
same query
same context budget

Lane A:
hard-gated context
→ shadow answer A

Lane B:
global-soft-prior context
→ shadow answer B
```

**paired shadow comparison**을 baseline으로 둔다. Interleaving은 별도 F6 연구 lane으로 둔다.

---

# 40. Facts to Measure

## F1 — 실제 요청 수

최우선.

측정:
- daily eligible requests
- retrieval activation rate
- requests per mode/device if available
- retrieved chunk count
- context-char distribution
- context-cap hit rate

## F2 — Context position bias

Shadow에서 evidence order만 바꿔 측정.

## F3 — Cheap proxy ↔ LOO agreement

D1 프록시의 오차율 calibration.

## F4 — Explicit correction event frequency

Hard constraint를 rate로 검정할 수 있는 사건 수가 있는지 확인.

너무 드물면 `rate constraint` 대신 `any occurrence → mandatory incident review` 형태를 검토.

## F5 — Retrieval redundancy

LOO / ablation 부산물로 marginal contribution overlap 측정.

## F6 — Interleaving under multi-evidence LLM use

문헌 조사 + 자체 shadow experiment.

---

# 41. 실행 순서 — Final Research Start Plan

```text
1. F1 — 실제 요청량 / retrieval 로그 측정

2. 두 routing 정책 retrieval-only replay
   - hard-gated
   - global-soft-prior
   - same query
   - same character budget

3. 두 정책의 evidence-set 차이 빈도 측정

4. 충분히 다른 요청만 paired shadow generation

5. F2 — order / position bias

6. cheap attribution proxy 전량 기록

7. sampled LOO / ablation

8. F3 — proxy calibration

9. 첫 routing comparison 판정

10. F4 / F5 / F6 확장

11. Shadow-All-Write instrumentation 확대

12. formatter / write-policy / learned-routing 실험으로 확장
```

---

# 42. 첫 실험에서 하지 않을 것

- production answer routing 변경
- learned router 학습
- formatter 신규 구현
- neural memory controller 구현
- 자연어 correction classifier를 gold label로 사용
- interleaving을 검증 없이 primary metric으로 사용
- false-memory와 recall을 scalar weight로 합산
- shadow result를 사용자에게 자동 노출
- 아직 쓰이지 않은 memory를 negative label로 처리

---

# 43. Brainstorm Log Update — 2026-08-26 / Scoring Decisions

48. 첫 실험 축은 **routing**으로 확정.
49. `hard-gated`와 `global-soft-prior`를 첫 비교 대상으로 사용.
50. memory usage 측정은 **cheap proxy 전량 + sampled LOO calibration**으로 확정.
51. 실험은 **shadow-only**.
52. 비교 budget은 **동일 문자 수**, 8k baseline.
53. false memory는 **hard constraint**.
54. correction gold는 **명시적 행동만**.
55. Shadow-All-Write 채택.
56. 첫 실험 목표를 routing winner 선정보다 **measurement validity 검증**으로 재정의.
57. paired shadow comparison을 baseline, interleaving은 F6 연구로 둠.
58. F1 실제 요청량을 첫 측정으로 수행.
59. 실행 순서를 `F1 → retrieval replay → difference rate → paired shadow → position bias → proxy → sampled LOO → calibration`으로 확정.



---

# 44. Cross-Disciplinary Gap-Fill — Truth Maintenance / Belief Revision

**Status: UPDATED / HIGH-POTENTIAL**

기존 Memory Fork를 다음처럼 재정의한다.

```text
canonical evidence
≠
interpretive assumption
```

사용자의 실제 utterance/action은 evidence이고,
그 evidence를 어떤 의미로 해석하는지는 assumption이다.

Fork는 mutually-exclusive branch list가 아니라
**공존 가능한 competing / overlapping hypotheses**를 포함할 수 있다.

후보 구조:

```text
Hypothesis
├─ support justifications
├─ contradiction justifications
├─ evidence dependencies
├─ assumption dependencies
└─ hypothesis dependencies
```

Full ATMS의 전역 environment enumeration은 조합 폭발 때문에 **REJECT**.

대신:

> **Local Justification DAG + Local Nogood Propagation**

을 실험 후보로 둔다.

새 evidence가 들어왔을 때 최소 다음 semantics를 구분한다.

```text
EXPANSION
WORLD_UPDATE
CORRECTION
ADDITIONAL_CONTEXT
CONTRADICTION
TEMPORAL_SCOPE_CHANGE
INTERPRETATION_REVISION
```

특히:

```text
world changed
≠
our previous belief was wrong
```

를 강한 계약 후보로 둔다.

Belief Revision에서 가져올 원리:

- minimal epistemic change
- belief-base revision
- iterated revision
- explicit justification dependency

가져오지 않을 것:

- logically closed global belief set
- all-new-input-must-be-accepted assumption
- global ATMS environment lattice
- magic scalar entrenchment


# 45. Cross-Disciplinary Gap-Fill — Active Preference Elicitation / VOI

**Status: UPDATED / HIGH-POTENTIAL**

핵심 distinction:

```text
uncertainty
≠
value of resolving uncertainty
```

Fork와 current routed structures의 overlap은 candidate generation이다.
실제 질문 여부는 plausible branches가 downstream answer/action을 바꾸는지 본다.

```text
branch A → action X
branch B → action X
=> DON'T ASK

branch A → action X
branch B → action Y
=> evaluate VOI
```

질문 정책은 세 단계:

```text
1. Natural Observation
2. Opportunistic Elicitation
3. Explicit Elicitation
```

좋은 질문은:

```text
agent uncertainty HIGH
human uncertainty LOW
```

인 질문이다.

Fork label 자체를 강제로 고르게 하기보다
가장 discriminative한 assumption/evidence를 묻는다.

사용자의:

```text
unknown
both
neither
context-dependent
```

응답도 valid evidence다.

Persistent memory에는 probability를 truth score로 저장하지 않고:

```text
hypotheses
evidence
assumptions
contradictions
status
```

를 보존한다.

VOI 계산의 probability는 transient working state로 사용할 수 있다.

초기 heuristic:

```text
ASK only if:
- unresolved Fork
- current routing overlap
- branches change downstream behavior
- evidence insufficient
- no cheap natural observation soon
- question easy to answer
- interruption cost acceptable
```

향후 interaction log가 쌓이면 learned elicitation policy로 확장한다.


# 46. Gap-Fill Synthesis — Fork × Elicitation

**Status: STRONG SYNTHESIS CANDIDATE**

```text
Evidence
  ↓
Assumption-aware Hypotheses
  ↓
Justification DAG
  ↓
Current query routing
  ↓
Do hypotheses change downstream behavior?
  ├─ No  → leave unresolved
  └─ Yes
       ↓
Can natural evidence resolve it?
  ├─ Yes → observe
  └─ No
       ↓
Can normal recommendation/action double as query?
  ├─ Yes → opportunistic elicitation
  └─ No
       ↓
Generate easy discriminators
       ↓
VOI - interruption/difficulty/error cost
       ↓
ASK / DEFER
```

핵심 원칙:

> **모든 ambiguity를 해결하려 하지 않는다. 실제 decision을 바꾸는 ambiguity만, 가장 낮은 interaction cost로 해결한다.**


---

# 47. Cross-Disciplinary Gap-Fill — Contextual Bandits / OPE

**Status: UPDATED / HIGH-POTENTIAL**

핵심:

```text
policy chooses action
→ only chosen action outcome is observed
→ policy shapes future training data
```

Future logging 후보:

```text
context_ref
available_actions
behavior_policy_version
chosen_action
propensity
shadow_actions
outcome_refs
reward_definition_version
```

`support = 0`인 action의 real outcome은 historical logs만으로 식별할 수 없다.

Shadow-All-Write는 **counterfactual observability augmenter**다.
System-side proxy는 늘릴 수 있지만 user-level counterfactual reward는 만들지 못한다.

후보 평가 stack:

```text
shadow-derived reward model
+
logged actual outcome
+
propensity
→ IPS / DR / conservative evaluation
```

First learned action으로 `WRITE / NO_WRITE` 방향이 강화된다.

Whole-memory controller는 long-horizon state를 바꾸므로 pure contextual bandit이 아니다.

```text
binary local action first
→ factorized routing later
→ long-horizon sequential learning only if evidence supports it
```

False memory는 평균 utility와 단순 trade-off하지 않는다.

```text
safety / false-memory constraints first
utility optimization second
```


---

# 48. Cross-Disciplinary Gap-Fill — Delayed / Censored Feedback

**Status: UPDATED / HIGH-POTENTIAL**

핵심:

```text
not yet used
≠
negative
```

Memory outcome을:

```text
POSITIVE
NEGATIVE
UNOBSERVED / CENSORED
```

로 구분한다.

Calendar age보다:

```text
relevant opportunity exposure
```

가 더 의미 있는 denominator일 수 있다.

후보 funnel:

```text
memory exists
→ relevant opportunity
→ policy exposure
→ reader use
→ answer change
→ human outcome
```

따라서 observed use는 intrinsic memory quality만이 아니라
opportunity + routing + retrieval + reader behavior가 섞인 결과다.

PU learning 관점:

```text
observed positive
+
unlabeled
```

이며 unlabeled를 negative로 직접 쓰지 않는다.

Explicit feedback는:

```text
high precision
but selection-biased
```

로 취급한다.

Survival / cure / recurrent-event 연구는:

```text
P(ever useful)
time-to-first-use
reuse recurrence
```

를 분리하는 데 참고한다.

Global forgetting clock은 비선호다.
Formatter/domain마다 natural latency가 다를 수 있다.

### Strong new hypothesis

```text
many relevant opportunities
+
never contributed
+
redundant
+
no active dependency
```

가 단순 old+unused보다 훨씬 강한 forgetting signal일 수 있다.

### Outcome canonicality

Canonical하게 보존할 것은 scalar reward보다:

```text
relevant opportunity
retrieval
injection
answer divergence
explicit reuse
correction
supersession
deletion
decision completion
```

같은 outcome event history다.

Reward / survival / PU label은 versioned projection으로 본다.


---

# 49. Cross-Disciplinary Gap-Fill — CLS / Multiple Memory Systems

**Status: UPDATED / HIGH-POTENTIAL**

핵심 computational lesson:

```text
fast exact acquisition
≠
fast stable generalization
```

Canonical evidence는 즉시 보존하되
derived generalization은 old/new evidence를 interleave해 천천히 갱신한다.

### Consolidation replay

```text
new evidence
+
related old evidence
+
corrections
+
contradictions
+
exceptions
```

를 함께 사용한다.

Random replay보다 `Structured / Contrastive Replay`를 실험 후보로 둔다.

### Schema-congruence gating

```text
stable schema + congruent evidence
→ cheap fast path

novel/conflicting/ambiguous evidence
→ preserve episode + Fork/strong Librarian
```

Local SLM → strong model cascade의 새 gate 후보다.

### Multiple representations

```text
one Evidence Event
→ 0..N projections
```

이 Formatter architecture를 강화한다.

단, human neuroscience memory categories를 DB schema로 그대로 복제하지 않는다.

### New design maxim candidate

> **Separate on write, associate on read.**

Write-side에는 distinction/ambiguity를 보존하고
Read-side에는 recall을 위해 association/candidate expansion을 허용한다.

### Controller implication

Learned memory controller는 continual-learning/catastrophic-forgetting 문제를 가질 수 있으므로
historical replay, old-policy fixtures, rare-domain/correction cases가 필요할 수 있다.


---

# 50. Cross-Disciplinary Gap-Fill — Memory Linking / Associative Retrieval

**Status: UPDATED / HIGH-POTENTIAL**

핵심:

```text
session boundary
≠
event boundary
```

Event segmentation은 canonical message/action history 위의 derived / rebuildable projection으로 본다.

### Event transition

Boundary를 단순 cut으로 보지 않는다.

```text
Event A
→ Transition / Bridge
→ Event B
```

`왜 A에서 B로 넘어갔는가`가 personal-history query에서 중요할 수 있다.

### Context reinstatement

```text
Query
→ first anchor
→ recover old context
→ next related memory
```

첫 memory가 다음 memory의 search cue 역할을 할 수 있다.

### Strong retrieval hypothesis

```text
small retrieval anchor
→ typed associative expansion
→ reconstruct canonical evidence package
```

즉:

```text
RETRIEVAL UNIT
≠
READER CONTEXT UNIT
```

### Association safety

Temporal proximity는 weak association prior이지 merge/equivalence proof가 아니다.

Unbounded associative cascade는 topic drift/token explosion 위험 때문에 reject한다.

Candidate마다:

```text
why_retrieved
association_path
depth
source_anchor
```

를 보존하는 Retrieval Provenance가 유망하다.

### New design maxim

> **Write conservatively. Retrieve associatively. Mutate by provenance.**

또는:

```text
WRITE:
separate conservatively

READ:
associate broadly

UPDATE:
mutate only proven dependencies
```

### Event segmentation safety

False merge가 false split보다 더 위험할 가능성이 높다.

Ambiguous continuity는:

```text
two events
+
POSSIBLY_CONTINUOUS bridge
```

처럼 보존하는 정책을 실험한다.

### Multi-view neighborhood

Target memory 주변은 하나가 아니다.

```text
justification
event
semantic
temporal
task/goal
```

operation별로 다른 neighborhood를 사용할 수 있다.


---

# 51. Cross-Disciplinary Gap-Fill — Memory Reconsolidation

**Status: UPDATED / VERY HIGH-POTENTIAL**

핵심:

```text
retrieved
≠
rewrite permission
```

Memory는 relevant new evidence와의 **meaningful mismatch**가 생길 때 local reconsolidation candidate가 된다.

### Prediction as maintenance interrupt

```text
Hypothesis
→ discriminating Prediction
→ Future Evidence
→ mismatch
→ local maintenance
```

Prediction은 점수 장식이 아니라
`어떤 memory를 다시 볼 것인가`를 알려주는 interrupt가 될 수 있다.

### Update / Fork split

```text
MATCH
→ no-op / support

COMPATIBLE NOVELTY
→ integrate

MEANINGFUL MISMATCH
→ local reconsolidation

LARGE / OUT-OF-SCHEMA
→ new episode + Fork / world-update candidate
```

### Canonical replay requirement

Derived summary-of-summary rewrite는 drift 위험이 있다.

High-impact revision은:

```text
old derived state
+
original support evidence
+
new evidence
+
counterevidence / corrections
→ revision
```

으로 수행하는 방향이 강하다.

### Sparse mutation

```text
activate sparsely
→ detect mismatch
→ reopen affected derived state only
→ replay canonical evidence
→ minimally revise or fork
→ atomically restabilize
```

### New safety split

```text
READ:
activation may be broad

UPDATE:
provenance/dependency scope only
```

Retrieval frequency 자체로 truth/support를 강화하지 않는다.


---

# 52. Procedural Memory + User-Taught Skills

**Status: UPDATED / STRONG CANDIDATE**

Procedural Memory를 declarative Formatter와 분리한다.

```text
Evidence Ledger
   ├─ Declarative Projections → Reader
   └─ Procedural Projections  → Controller
```

Skill candidate는 최소:

```text
Applicability
Preconditions
Goal
Procedure
Termination
Verification
```

를 가져야 한다.

핵심 safety:

```text
skill invoked
≠
skill rewrite

skill retrieved
≠
skill executed

skill registered
≠
skill authorized now
```

### User-Taught / Registered Skill

사용자가 이미 만든 algorithm / workflow / robot behavior를
XION에 skill로 명시 등록할 수 있게 하는 방향을 추가한다.

이것은 UI만의 문제가 아니다.

```text
Core:
skill contract + executor reference + permissions + provenance

UI later:
register/edit/test/enable/logs
```

로 책임을 분리한다.

### Robot Arm Example

```text
robot controller code
= execution source of truth

XION registered skill
= when/how XION may invoke it
```

Memory가 로봇 제어 algorithm 자체를 canonical하게 복제하지 않는다.

### Skill Sources

후보:

```text
SYSTEM / BUILT_IN
USER_REGISTERED / USER_TAUGHT
LEARNED_FROM_EPISODES
```

명시 등록 skill은 learned heuristic보다 강한 source provenance를 가질 수 있지만
hard governance를 우회하지 않는다.

### Common Contract, Different Backends

```text
Learned textual skill
→ LLM procedure

Registered external skill
→ executable tool / robot / service
```

둘은 applicability / input / precondition / termination / verification /
permission / provenance는 공유할 수 있고 execution backend만 다를 수 있다.

### Working Principle

> **Memory remembers the procedure contract; capability runtime owns execution.**


---

# 53. Prospective Memory / Future Intentions

**Status: UPDATED / VERY HIGH-POTENTIAL**

Prospective memory를 ordinary future fact와 분리한다.

```text
WHAT
≠
WHEN / CUE
≠
DO
```

### Trigger modes

```text
TIME
→ deterministic scheduler

EVENT / STATE
→ structural matcher

SEMANTIC CONTEXT
→ context router

INFERRED TIMING
→ low-authority candidate only
```

### Context-Gated Prospective Monitoring

모든 intention을 항상 검사하지 않는다.

```text
active intentions
→ context/event routing
→ relevant subset armed
→ exact cue evaluation
→ selective intervention
```

### Completion Deactivation

```text
history remains
execution trigger dies
```

완료된 intention의 historical memory를 보존하되 future execution edge는 즉시 비활성화한다.

### Commitment Safety

```text
future-oriented remark
≠
confirmed task
```

현재의 candidate→confirmation→commit 계약을 유지한다.

### User vs Agent Prospective State

```text
USER-FACING
"remind me"

AGENT-INTERNAL
"surface/check this when workflow reaches X"
```

### Three-way split

```text
Prediction
→ what may happen

Prospective Intention
→ what should become relevant under future cue

Procedure
→ how to act
```

### Working Principle

> **Persist the intention, index the cue, monitor only when relevant, intervene selectively, and deactivate execution immediately when the intention is finished.**


---

# 54. Relationship Identity Repair / Closeness

**Status: UPDATED / SHALLOW GAP-FILL**

Social Memory는 별도 subsystem으로 만들지 않는다.

```text
Entity → who
Relationship → how connected
Event → shared history
Hypothesis → revisable interpretation
```

### Identity

강한 원칙:

```text
NAME
≠
IDENTITY
```

한 이름은 여러 entity를 가리킬 수 있고,
한 entity는 여러 alias를 가질 수 있다.

Identity collision이 보이면:

```text
stop unsafe merge
→ preserve evidence
→ cluster existing evidence
→ ask discriminative questions
→ split / merge / ambiguous
→ rebuild derived links
```

사람 identity collision은 질문 interruption cost보다
wrong-merge contamination cost가 더 크므로
Active Elicitation 우선순위를 높인다.

모든 fact를 하나씩 묻지 않는다.

```text
same event
temporal adjacency
shared descriptors
relationship cues
provenance
```

로 먼저 cluster한 뒤 unresolved partition만 묻는다.

### Unknown Is Valid

사용자가 어느 사람인지 기억하지 못하면
`AMBIGUOUS(A,B)`를 유지한다.

### Closeness

친밀도는 identity object의 intrinsic property가 아니다.

```text
Relationship(USER, PERSON)
→ closeness
```

로 둔다.

또:

```text
closeness
≠
conversational salience
```

Reference resolution에서는 closeness, mention frequency/recency,
active project, current event context 등을 합친 derived prior를 쓸 수 있다.

하지만:

```text
closeness
→ ranking prior
closeness
≠ identity proof
```

Identity collision이 생기면 prior를 믿고 merge하지 않고 질문한다.

### Useful Side Effect

Closeness / relationship descriptors는
identity repair 질문을 사람에게 자연스럽게 설명하는 feature가 된다.

> “자주 얘기하고 자전거 같이 타는 민수랑 군대에서 알게 된 민수는 다른 사람이야?”

처럼 cluster 하나를 한 질문으로 확인할 수 있다.


---

# 55. Tiny Core / Dynamic Working Set

**Status: UPDATED / IMPORTANT ARCHITECTURAL BOUNDARY**

Core와 Working을 분리한다.

```text
CORE
→ always-visible privileged projection

WORKING SET
→ current reasoning에 필요한 ephemeral derived state
```

### Selected Direction

```text
A. No Core
B. Tiny Stable Core   ← selected direction
C. Rich User Profile ← reject likely
```

C를 거부하는 핵심 이유는 **User Model과 역할이 겹치기 때문**이다.

### User Model vs Core

```text
User Model
→ rich, longitudinal, revisable personalization

Core
→ tiny, stable, globally safe projection
```

Core는 독립 truth store가 아니다.

```text
Canonical Evidence / User Model
→ Core Projection
→ always-visible context
```

### Important ≠ Core

```text
very important current goal
→ not necessarily Core

stable global interaction anchor
→ Core candidate
```

Core promotion에서는:

```text
global applicability
stability
always-visible safety
cross-context usefulness
provenance quality
```

를 본다.

### Working Set

```text
Current Event
+ Active Goal / Task
+ Retrieved Evidence
+ Relevant Entities
+ Unresolved Forks
+ Relevant Prospective State
→ Dynamic Working Set
```

Working set은:

```text
ephemeral
derived
rebuildable
```

이며 canonical evidence가 아니다.

> **Attention state is not evidence.**

### Strong Principle

> **Always-visible memory is privileged memory.**

따라서 Core promotion threshold는 ordinary memory write보다 높아야 한다.

### Governance

Permissions / safety / confirmation / tool authority는 memory Core가 아니라 별도 governance layer다.

### Working Synthesis

> **Rich personalization belongs in the User Model. Core is only its tiny, stable, always-safe projection. Working Memory is ephemeral activation, not another source of truth.**


---

# 56. Forgetting = Accessibility, Not Deletion

**Status: UPDATED / SHALLOW GAP-FILL**

Ordinary forgetting은 canonical deletion이 아니다.

```text
Semantic forgetting
→ superseded / invalidated
→ current-state retrieval에서 억제

Accessibility forgetting
→ still-valid memory
→ lower activation / retrieval priority

Governance erasure
→ actual deletion / privacy action
→ separate problem
```

강한 원칙:

```text
not retrieved
≠ forgotten
≠ erased
```

### Age Is Not Opportunity

`memory_importance * exp(-age)` 같은 global decay는 기본 설계에서 거부한다.

더 좋은 후보:

```text
relevant opportunities
retrieval opportunities
actual use
explicit outcome
supersession
current context
```

### Retrieval Frequency Trap

```text
retrieved often
≠ important
retrieved
≠ useful
used
≠ correct
```

인기 memory가 계속 강화되어 rare-but-critical / counterevidence를 묻는 feedback loop를 경계한다.

### Archive

HOT/WARM/COLD를 semantic truth로 지금 고정하지 않는다.

Archive는 필요하면:

```text
storage / cache / cost optimization
```

으로 둔다.

> **Archive state must not silently become semantic validity.**

### Working Synthesis

> **Old memories become less accessible, not less true merely because they are old. Actual deletion belongs to governance.**

---

# 57. Longitudinal Identity / User + Shared + XION Self-History

**Status: UPDATED / HIGH-POTENTIAL SYNTHESIS**

### User Identity vs User State

```text
same identity
≠ same state

different state
≠ different person
```

User Model은 temporal projection으로 본다.

```text
Canonical Evidence
→ Temporal User Model
   ├─ Current(now)
   └─ Historical(t)
```

### Life History, Not Invented Life Story

> **XION should preserve a life history, not invent a life story.**

변화 기록은 보존하지만
몇몇 evidence로 coherent narrative를 truth화하지 않는다.

### Self-Concept Claim

```text
explicit user self-description
→ SELF-CONCEPT CLAIM

behavior-derived personality interpretation
→ INFERRED HYPOTHESIS
```

강한 원칙:

> **Self-concept claim ≠ objective trait.**

### XION Also Has Longitudinal History

사용자는 full autobiographical scope의 **B**를 선택.

```text
USER LIFE HISTORY
→ 사용자에게 일어난 일

SHARED HISTORY
→ 사용자와 XION이 함께 겪은 interaction / correction / decision

XION SELF-HISTORY
→ XION의 설계 / capability / failure / evolution
```

세 층은 연결하되 provenance를 섞지 않는다.

### System History Pipeline

```text
Canonical System Events
→ System Self-History
→ Current Self-Model
→ Tiny System Core
```

Self-History는 current capability source of truth가 아니다.

### Strong Guard

> **XION may maintain an autobiography, but not author its own mythology.**

실제 events에서 history를 구성하되,
“나는 어떤 존재로 성장했다” 같은 의미는 근거 없이 truth화하지 않는다.

### Source Hierarchy Candidate

```text
Current Operational State
>
Declared Design Contract
>
System Self-History
>
Inferred Narrative
```

### Useful Outcome

몇 달 뒤:

> “왜 이 memory rule이 생겼지?”

에 대해 current contract만이 아니라:

```text
shared failure
→ discussion
→ research
→ design decision
→ system change
```

의 evolution path까지 복원할 수 있다.


---

# 58. Executor-Relative Skill Hierarchy / Macro Deployment

**Status: UPDATED / IMPORTANT SKILL-MEMORY AMENDMENT**

Skill granularity는 절대적이지 않다.

> **Atomicity is interface-relative.**

### XION-Visible Primitive

Primitive를 actuator level까지 쪼개지 않는다.

```text
GOOD:
detect_object(obj)
move_to_pose(frame, x, y, z, orientation)
grasp(obj)
release(obj)
verify_pose(obj, target)

BAD:
move_left(n_ticks)
joint_delta(...)
motor_ms(...)
```

강한 원칙:

> **XION-visible primitive should be the lowest reusable semantic action, not the lowest executable physical action.**

Hardware-overfit action은 executor/controller가 책임진다.

### Macro-First / Primitive-Fallback

```text
task
→ macro candidate lookup
   ├─ applicable macro exists → execute macro
   └─ no macro → compose semantic primitives
```

반복되는 primitive composition은 Macro Skill 후보가 될 수 있다.

```text
repeated composition
→ candidate
→ parameterize
→ variation / replay validation
→ ACTIVE MACRO
```

반복 횟수만으로 자동 승격하지 않는다.

### Deploy Macro to Executor

ACTIVE Macro가 local execution을 지원하는 executor에 붙는 경우:

```text
XION canonical Skill Registry
→ deploy
→ executor-local Macro Registry
```

즉 로봇팔 제어보드의 macro list에도 write-out한다.

Working principle:

> **Compile upward in XION; deploy downward to the executor.**

### Source Boundary

```text
XION Skill Registry
→ canonical reusable contract

Executor Macro Registry
→ deployed executable projection
```

Version/hash mismatch는 re-deploy 또는 fail-close/fallback 대상으로 둔다.

### Provenance

Macro planning은 coarse해도 executor trace는 decomposable해야 한다.

> **Planning abstraction can be coarse; execution provenance should remain decomposable.**

### Revised Skill Principle

기존 “subtask skill이 대체로 낫다”는 관찰은
LLM이 executor까지 맡는 상황에 더 강하게 적용된다.

외부 executor가 안정적인 high-level capability를 제공한다면
그 capability 자체를 하나의 XION skill로 사용해도 된다.

> **Compile at stable executor boundaries, not arbitrary task boundaries.**


---

# 59. Shared Memory + Specialist Conversational Identities

**Status: UPDATED / HIGH-POTENTIAL**

원래 메모의 “시온 다중인격자”는
독립된 personality silos보다 아래 구조가 더 적합하다.

```text
one XION identity
+
shared canonical long-term memory
+
multiple specialist conversational identities
```

### Shared vs Local

공유:

```text
Canonical Evidence Ledger
Temporal User Model
Entity / Relationship / Event state
Shared History
XION Self-History
Skill contracts
System Core
```

specialist-local:

```text
Role Core
Working Set
retrieval lens
active goals
tools
domain-specific derived experience
```

강한 문장:

> **Multiple specialist minds without multiple truths.**

### Direct Conversation With Specialist

XION이 간단히 답한 뒤:

```text
"이건 투자 스페셜리스트가 더 깊게 볼 수 있는데 불러줄까?"
```

사용자 승인 시 같은 conversation continuity 안에서
`active conversational identity`를 specialist로 handoff할 수 있다.

사용자가:

```text
"시온 다시 불러줘"
```

라고 하면 XION으로 돌아온다.

Unexpected / silent identity switch는 피한다.

### Handoff Continuity

Specialist → XION 복귀 시:

```text
topic
important evidence
current conclusion
user decision
unresolved questions
```

같은 handoff working state를 둘 수 있다.

이는 canonical truth가 아니라 ephemeral derived bridge다.

### Specialist Writes

Specialist와 사용자 사이 대화도 중앙 evidence ledger에 들어간다.

```text
speaker=user
observed_by=trading_specialist
```

등 provenance를 남긴다.

Specialist의 해석은 user truth가 아니다.

### Personality

캐릭터 프롬프트보다:

```text
role + memory view + tools + goals + experience
```

에서 전문적 행동 차이가 먼저 나오도록 한다.

Surface personality는 later product layer.

---

# 60. User-Created Chat / Session Spaces

**Status: UI/UX DIRECTION OPEN / ARCHITECTURE GUARD RECORDED**

사용자가 목적별 chat을 직접 만들 수 있는 것은 유용해 보인다.

예:

```text
Main XION
Fitness / Diet
Trading
Memory Research
Robot Lab
```

특히 매일 식단/운동 기록처럼 반복되는 workflow는
main conversation에 모두 섞는 것보다
전용 thread에서 local continuity를 유지하는 편이 자연스럽다.

그러나:

> **UI chat boundaries are not canonical memory boundaries.**

즉 separate chat은 다음이 아니다.

```text
separate user identity
separate long-term truth database
automatic autobiographical event
```

대신 다음을 가질 수 있다.

```text
thread-local working context
default specialist affinity
topic-local retrieval bias
open questions / plans
surface organization
```

그리고 중앙 memory는 공유한다.

기존 Event Segmentation 결론도 유지:

```text
conversation session
≠ event
```

따라서:

```text
UI thread
specialist identity segment
conversation segment
event segment
```

를 분리해서 생각한다.

Exact sidebar / tab / naming / UX는 지금 연구 scope 밖이므로 DEFER.


---

# 61. Privacy / Governed Erasure / User Control

**Status: UPDATED / FINAL GAP-FILL**

Ordinary memory update와 실제 deletion을 분리한다.

```text
correction
≠ world update
≠ retrieval suppression
≠ governed erasure
```

강한 원칙:

> **Canonical evidence is logically immutable under ordinary memory operations, but subject to governed erasure.**

### Deletion Propagation

Raw evidence 하나만 지우는 것은 충분하지 않다.

```text
evidence erased
→ trace derivation provenance
→ invalidate affected projections
→ rebuild from surviving evidence
```

Mixed-support state는 남은 evidence로 재구축한다.

### No Resurrection

```text
stale cache
snapshot
embedding queue
derived summary
learned artifact
```

를 통해 erased content가 되살아나는 것을 hard failure로 본다.

Minimal non-content tombstone / receipt 후보:

```text
target identity
erased_at
scope
propagation / rebuild watermark
status
```

민감한 삭제 내용을 tombstone에 다시 복제하지 않는다.

### Erasability by Design

> **Personal memory should remain externalizable and erasable by default.**

개인 데이터를 opaque model weights에 기본적으로 굽지 않는다.

학습 산출물을 사용한다면:

```text
source traceability
rebuild / unlearning path
invalidation
verification
```

가 필요하다.

### Scope Resolution

```text
"민수 관련 기억 다 지워"
```

같은 요청은 identity ambiguity를 먼저 해소한다.

```text
ambiguous target
→ fail-close
→ ask
```

Same-name collision과 Active Elicitation을 재사용한다.

### Shared / XION History

Erased user evidence에 의존하는:

```text
Shared History
XION Self-History narrative
specialist-derived experience
```

도 rebuild / redact 대상이 될 수 있다.

Non-personal system consequence를 어디까지 남길지는 R2 open question.

### Working Synthesis

> **Erase content, rebuild surviving meaning, and preserve only enough non-content metadata to prevent resurrection.**

---

# 62. Gap-Fill Stop

**Status: STOP**

현재까지 새 mechanism class를 충분히 탐색했다.

다음 단계에서 새 gap을 계속 추가하지 않는다.

R2의 목적:

```text
map overlapping mechanisms
separate semantic / operational / experimental differences
identify canonical vs derived vs operational vs ephemeral state
collapse theories that can share one coherent model
preserve boundaries only where authority/lifecycle/failure semantics require them
reduce unresolved empirical choices to minimal shadowable variants
```

원칙:

> **From here, subtraction and synthesis are more valuable than additional mechanism collection.**

> **Do not create subsystems to mirror theories. If multiple theories collapse into one coherent model, keep the model.**


---

# 63. R2 Reset / Operating Rules

**Status: ACTIVE SYNTHESIS RULES**

r17의 초기 R2 architecture 결정은 정본으로 승계하지 않는다.
Privacy까지 포함된 r16 연구 corpus에서 다시 출발한다.

R2에서는 세 종류의 차이를 먼저 구분한다.

```text
SEMANTIC CONTRACT
→ 의미가 다르다.
→ 반드시 구분하되 별도 subsystem을 자동 의미하지 않는다.

OPERATIONAL BOUNDARY
→ SoT / authority / lifecycle / permission / failure policy가 다르다.
→ experiment와 무관하게 실제 책임 경계가 필요할 수 있다.

EXPERIMENTAL VARIANT
→ 어느 쪽이 더 나은지 논리만으로 닫히지 않는다.
→ 같은 interface 아래 shadow / replay로 비교한다.
```

금지:

```text
theory마다 subsystem 하나 만들기
미리 정한 plane 개수 채우기
비교할 이유 없이 여러 architecture 후보 만들기
기존 CLOSED contract를 memory 연구 때문에 조용히 다시 열기
```

Working maxim:

> **Implement the coherent model, not the literature taxonomy.**

> **Separate only when semantics, authority, lifecycle, failure policy, or irreducible empirical uncertainty requires separation.**


---

# 64. R2 Overlap Map — Pass 1

**Status: WORKING MAP / NOT CLOSED ARCHITECTURE**

R1부터 Privacy pass까지 다시 읽고,
이론 이름이 아니라 **같은 failure mode를 다루는 연구**를 기준으로 겹침을 묶었다.

현재 overlap family:

```text
A Evidence / Derivation / Provenance
B Hypothesis / Uncertainty / Revision
C Consolidation / Generalization / Projection Formation
D Representation / Specialization
E Event / Context Structure
F Retrieval / Activation / Accessibility
G Evidence Acquisition / Clarification
H Procedure / Commitment / Capability
I Identity / Relationship / Longitudinal History
J Policy Learning / Evaluation
K Governance / Erasure / Authority
L Specialist / Session Cognitive Views
```

이 family들은 subsystem이 아니다.

강한 collapse pressure:

```text
Fork + Prediction + Belief Revision + Reconsolidation
→ one hypothesis-maintenance lifecycle candidate

CLS + Reflection + Formatter projection + event micro-consolidation
→ shared projection/generalization problem
  (formation vs revision trigger는 아직 분리 검토)

Contextual Activation + Sparse Routing + Event Retrieval
+ Working Set + Forgetting + specialist-local context
→ one read-side context assembly problem candidate

Write/Route learning + attribution + OPE + delayed/censored outcomes
→ one policy-evaluation / instrumentation loop candidate
```

강한 non-collapse pressure:

```text
HOW(skill) ≠ WHAT/WHEN(commitment)
≠ WHETHER ALLOWED(governance)
≠ execution backend

forgetting/accessibility
≠ semantic invalidity
≠ governed erasure

session/thread
≠ semantic event
≠ long-term memory boundary

self-history
≠ current operational capability truth
```

다음 단계는 subsystem 설계가 아니라
각 state를 `semantic / operational / experimental` 및
`canonical / derived / operational / ephemeral`로 분류하는 truth/state map이다.


---

# 65. R2 Truth / State Map — Key Discovery

**ACCEPTED R2 FOUNDATION**

`canonical / derived / operational / ephemeral`을 하나의 enum처럼 쓰면 안 된다.
서로 다른 축이다.

```text
Epistemic provenance:
  evidence / assumption-hypothesis / derived abstraction

Authority:
  source record / authoritative domain state /
  derived current state / projection-cache / candidate

Lifecycle:
  durable / ephemeral / historical-inactive / rebuildable

Semantic domain:
  memory-knowledge / commitment / capability-execution /
  governance / cognitive context / evaluation-learning

Mutation:
  append / supersede-invalidate / local revision / rebuild /
  operational transition / promotion / erasure
```

핵심 예:

```text
task
= operational + durable + authoritative

promoted skill
= epistemically derived
+ durable
+ authoritative as skill contract
+ NOT authorization

User Core
= derived + durable + privileged projection
+ NOT source truth

Working Set
= derived/assembled + ephemeral + non-authoritative
```

따라서 `canonical`은 전역적인 truth label이 아니다.
**provenance graph**와 **authority/precedence graph**도 분리해야 한다.

```text
Provenance:
why do we believe this?
what rebuilds on correction/erasure?

Authority:
what is allowed?
what is actually committed/capable?
what controls behavior now?
```

Strong operational boundaries:

```text
task/reminder != memory
governance != learned memory
skill contract != executor deployment
current capability != self-history
Working Set != persistent truth
```

Strong collapse candidates remain:

```text
Fork + Prediction + Belief Revision + Reconsolidation
→ provenance-aware hypothesis/revision model?

Activation + routing + event reinstatement + Working Set + forgetting
→ context assembly/read policy?

Reflection + CLS + formatter formation + micro-consolidation
→ shared formation/generalization machinery with distinct triggers?
```

R3가 필요한 uncertainty는 주로 policy 영역:

```text
retrieval routing
write/no-write
formatter routing
elicitation threshold
promotion/consolidation thresholds
learned controller policy
```

semantic/authority contracts를 A/B test하지 않는다.


---

# 66. R2 Shared Invariants / Transition Collapse

**ACCEPTED R2 SYNTHESIS — CONTRACT LEVEL**

문서 전체에서 반복되는 invariant를 압축하면:

```text
source evidence != interpretation
ordinary mutation changes derived state, not source history
durable derived state needs replayable provenance
formation/generalization is conservative
classify change before mutation
mutate minimally by provenance
replay source + counterevidence
retrieval/attention does not reinforce truth
ambiguity is a valid state
candidate revision validates before atomic commit
provenance != operational authority
WORLD_UPDATE != CORRECTION
accessibility != invalidity != erasure
governed erasure propagates through provenance
evaluation policy != user-memory truth
```

현재 가장 강한 collapse:

```text
FORMATION
CONSOLIDATION
RECONSOLIDATION
ORDINARY DERIVED REVISION
```

은 서로 다른 subsystem이라기보다:

```text
different trigger / evidence selection / target scope
             ↓
same provenance-aware semantic transition protocol
             ↓
different domain-specific validation gate
```

로 설명 가능해 보인다.

Candidate protocol:

```text
trigger
→ select target/scope
→ build replay package
→ classify change
→ propose transition
→ domain gate
→ atomic commit + provenance
```

중요한 경고:

> **semantic contract 하나로 합친다고 one giant MemoryTransitionEngine을 만들자는 뜻은 아니다.**

Task/reminder, governance/erasure authority, executor runtime,
read-side context assembly, policy learning은 이 generic epistemic transition 밖에 둔다.


---

# 67. R2 Semantic Collapse / Completion — Pass 1

**WORKING SYNTHESIS**

Verdict types:

```text
MERGE / COMPOSE / SPECIALIZE / DECOMPOSE / KEEP SEPARATE
```

가장 강한 collapse:

```text
Fork
→ live Hypothesis set / unresolved relation

Prediction
→ optional discriminator/expectation on a Hypothesis

Active Elicitation
→ discriminator를 획득하기 위한 policy

Reconsolidation
→ stable derived state를 다시 여는 trigger/scope semantics

Belief Revision
→ change semantics

CLS / structured replay
→ replay evidence discipline

Formatter
→ Derived Projection Contract

Sparse Routing + event retrieval + association + accessibility
→ Context Assembly process

Neural Memory Controller
→ optional implementation of memory policies, not memory content type
```

중요한 decomposition:

```text
"General Graph"
→ Derivation/Dependency Provenance
  ≠
  Semantic Association/Event Projection
```

그래프라는 물리 표현을 공유할 수 있어도
`derived from`과 `related to`는 mutation/erasure 의미가 완전히 다르다.

Projection family 후보:

```text
Ranking
Timeline
Decision
Relationship
Routine
Event
Semantic Association
User/history views
```

은 공통 projection contract를 가질 수 있지만
type-specific semantics를 generic table 하나로 평탄화하지 않는다.

Identity:

```text
generic hypothesis/revision/acquisition
+ stricter fail-close identity gate
```

Skill:

```text
generic derived transition
+ Skill Contract
+ transfer/verification gate
+ executor-relative deployment
```

Specialist / chat:

```text
shared evidence
+ scoped cognitive context / derived projection
```

으로 줄일 수 있어 별도 truth silo가 필요 없다.

Emerging vocabulary (architecture 아님):

```text
Source Evidence
Derived State
Derivation Provenance
Projection Contract
Derived-State Transition
Context Assembly
Evidence Acquisition Policy
Memory Policy + Evaluation
Domain Authority State
```

추가 collapse 금지:

```text
provenance != association
temporal validity != timeline
routine != skill
prediction != intention
skill != authorization/deployment
accessibility != invalidity/erasure
Working Set != persistent truth
```


## 67.1 Accepted decision — split graph semantics

사용자 승인:

```text
Derivation / Dependency Provenance
≠
Semantic Association / Event Projection
```

이유는 storage 취향이 아니라 traversal semantics다.

```text
provenance/dependency
→ support / explanation / correction scope /
  replay / erasure propagation

semantic association/event
→ retrieval / navigation /
  context reinstatement / exploration
```

`related to`를 `derived from`처럼 쓰지 않고,
`derived from`을 자동 retrieval relevance로도 쓰지 않는다.

Physical graph/store 선택은 여전히 OPEN.


---

# 68. Semantic Candidate — Hypothesis / Fork / Prediction / Elicitation

**ACCEPTED R2 SEMANTICS**

추천 collapse:

```text
Hypothesis
= evidence + assumptions에서 파생된 live interpretation / claim

Fork
= 별도 content type이 아니라
  같은 ambiguity space의 1..N live Hypotheses relation/view
  (non-exclusive, non-exhaustive 가능)

Prediction
= Hypothesis의 optional discriminator subtype

Active Elicitation / VOI
= discriminator를 실제로 얻을지/어떻게 얻을지 결정하는 policy
```

따라서:

```text
what might be true?
→ Hypothesis

what evidence would distinguish it?
→ Discriminator / Prediction

is it worth resolving now?
→ VOI

how should evidence be obtained?
→ observe / opportunistic / explicit ask / do nothing
```

추가 collapse 금지:

```text
assumption != hypothesis
discriminator != acquisition action
uncertainty != probability requirement
```

Identity는:

```text
shared Hypothesis model
+ stricter fail-close identity gate
```

로 specialize 가능하다.


## 68.1 User acceptance

채택:

```text
Hypothesis = base semantic state
Fork = unresolved Hypothesis-set relation/view
Prediction = optional discriminator subtype
Active Elicitation / VOI = evidence-acquisition policy
```

Identity는 shared model + stricter fail-close gate로 specialize한다.


---

# 69. Semantic Candidate — Projection / Formatter / User Model

**ACCEPTED R2 SEMANTICS**

핵심 교정:

```text
old MemoryFormatter
- accepts
- merge
- render
```

는 세 책임을 섞는다.

추천:

```text
accepts / instantiate
→ Projection routing / materialization policy

merge
→ shared Derived-State Transition Contract

render / computational representation
→ Projection Contract
```

Projection 후보:

```text
Ranking
Timeline
Decision History
Semantic Association / Event view
Relationship View
Preference View
User Core
Life / Shared / Self History
```

하지만 모든 derived object가 projection인 것은 아니다.

```text
General Fact
→ derived claim/state

Relationship
→ relationship derived state + projection

Routine
→ descriptive derived pattern + optional projection
  != Skill
```

User Model:

```text
user-related typed derived states
+ temporal projections
→ User Model @ now / @ t
```

으로 composition하는 방향을 추천.
giant static profile / giant formatter를 만들지 않는다.

Adaptive Specialization은 다음으로 닫는다.

```text
Projection Contract vocabulary
= developer-curated registry

runtime
= registered types 중 domain별 0..N adaptive instantiation/materialization

new projection type
= explicit design/development change

runtime autonomous type invention
= OUT OF SCOPE
```

즉 새 formatter/projection 후보는 개발 과정에서 우리가 설계·검토해 넣는다.


## 69.1 User acceptance

채택:

```text
MemoryFormatter mini-engine
→ Projection Contract

User Model
→ temporal logical composition

Adaptive Specialization
→ registered Projection Contracts의 adaptive use/materialization

Projection Contract registry
→ developer-curated

runtime autonomous projection-type invention
→ OUT OF SCOPE
```

새 projection 후보는 개발 과정에서 semantic contract와 tests를 정의한 뒤 registry에 추가한다.


---

# 70. Semantic Candidate — Context Assembly

**ACCEPTED R2 SEMANTICS**

강한 collapse 후보:

```text
Contextual Activation
Sparse Retrieval
Event-first Retrieval
Context Reinstatement
Associative Expansion
ordinary Forgetting / Accessibility
Activated Candidate Set
Working Set
specialist/thread-local working context
```

→ one ephemeral **Context Assembly** read process.

Candidate flow:

```text
request + scoped priors
→ context frame
→ source/projection routing
→ direct anchors
→ bounded event/association expansion
→ validity/accessibility/scope filtering
→ reader-context reconstruction
→ activated candidate set
→ narrow focus
→ typed Dynamic Working Set
```

중요한 semantic split:

```text
Derivation Provenance
= why does a belief/state exist?

Semantic Association
= how are states/events/entities related?

Retrieval / Access Trace
= why did this candidate enter this reasoning episode?
```

ordinary forgetting은:

```text
Accessibility Policy
```

로 Context Assembly 안에 들어간다.

하지만:

```text
semantic invalidation
→ transition/temporal state

erasure
→ governance
```

는 밖에 남긴다.

Core / role / thread:

```text
Tiny User Core
→ privileged user-derived input

Role Core
→ role contract input

thread/specialist state
→ scoped context prior / rebuildable working state

Working Set
→ ephemeral output
```

같은 context path에 들어와도 authority는 합치지 않는다.

과도한 collapse 금지:

```text
memory routing != specialist routing
event projection != current context frame
Working Set != evidence
accessibility != validity
context activation != prospective commitment/action authority
```

Semantic process는 하나로 닫혀도 retrieval policy experiments는 남는다.


## 70.1 User acceptance

채택:

```text
Contextual Activation + retrieval + reinstatement + association
+ ordinary forgetting/accessibility + Working Set
→ one ephemeral Context Assembly read process
```

Core/role/thread/event/operational state는 typed inputs로 compose하되
authority는 합치지 않는다.


---

# 71. Semantic Candidate — Skill / Prospective / Action Boundary

**ACCEPTED R2 SEMANTICS**

이번 pass에서는 처음으로 hard non-collapse boundary가 나온다.

```text
Skill Contract
= HOW

Commitment State
= WHAT remains pending/promised

Prospective Activation
= WHEN / under what CUE it becomes relevant

Governance
= WHETHER it is allowed

Executor Runtime
= DO / current capability truth
```

Skill 내부는 크게 collapse:

```text
learned / taught / registered
macro / primitive
→ one Skill Contract family
```

acquisition path와 executor-relative granularity만 다르다.

Prospective Memory는 오히려 decompose:

```text
commitment content
+ activation condition
+ armed/relevance state
+ intervention policy
+ completion/deactivation
```

User-facing durable commitment는 기존 task/reminder operational SoT를 유지한다.

```text
Task / Reminder
→ cue/time index
→ scheduler or Context Assembly
→ selective intervention
```

Context-based prospective monitoring은 accepted Context Assembly와 compose한다.

Skill applicability와 prospective cue는 condition-matching machinery를
공유할 수 있지만 semantic result/authority는 다르다.

```text
skill applicable
!= commitment active
!= authorized
!= executable now
```

Executor deployment:

```text
canonical Skill Contract
!= executor-local deployed implementation
```

Durable agent-internal cross-session commitment는 concrete requirement가 없으므로
현재는 새 store를 만들지 않고 OPEN / out-of-scope로 둔다.


## 71.1 User acceptance

채택:

```text
Skill → one Skill Contract family

Prospective Memory
→ commitment + activation condition + relevance/armed
+ intervention + completion/deactivation

Skill Contract
!= Commitment
!= Governance
!= Executor / Current Capability
```

Durable agent-internal cross-session commitment는 concrete requirement가 생기기 전까지 만들지 않는다.


---

# 72. Semantic Candidate — Memory Policy / Evaluation

**ACCEPTED R2 SEMANTICS**

강한 collapse:

```text
local policy decision
→ semantic/authority gate
→ exposure/application
→ downstream use/outcome
→ derived Evaluation Views
→ compare policy versions
→ shadow/replay/promote
```

`Neural Memory Controller`는 semantic primitive가 아니라
local policy들의 optional learned implementation family로 내린다.

Common instrumentation:

```text
Policy Decision Trace
- context ref
- policy type/version
- available actions
- chosen action
- gate result
- actual exposure/application
- propensity when meaningful
- shadow alternative refs
```

Outcome은 global truth ledger를 새로 복제하지 않는다.

```text
user correction
task completion
skill failure
...
```

같은 owning-domain event를 evaluation role로 reference한다.

추가 evaluation-only observations:

```text
relevant opportunity
policy exposure
retrieval/injection
reader use
answer/action divergence
```

Reward / attribution / PU / survival:

```text
raw observation
→ versioned Evaluation View
```

이지 source truth가 아니다.

```text
unobserved != negative
```

를 유지한다.

Shadow-All-Write:

```text
system counterfactual instrumentation
!= human counterfactual truth
```

OPE / IPS / DR / PU / survival estimator는 architecture component가 아니라
R3 experiment/evaluation method다.

강한 boundary:

```text
policy proposal != transition
policy choice != authorization
learned policy != governance
Decision Trace != Derivation Provenance != Retrieval Trace
```

Policy promotion은 constraint-first:

```text
hard contracts
→ correctness/safety
→ observability/support validity
→ utility/cost
```

순으로 본다.


## 72.1 User acceptance

채택:

```text
Memory Policy
→ local policy family

Decision / Exposure / Outcome
→ shared instrumentation

Reward / PU / survival / attribution
→ derived Evaluation Views

learned controller
→ optional implementation

policy
→ always below semantic / authority / governance gates
```


---

# 73. Semantic Candidate — Governance / Erasure

**ACCEPTED R2 SEMANTICS**

핵심 non-collapse:

```text
Governance
!= memory
!= learned policy
```

`forget`은 네 semantics로 분해한다.

```text
correction
→ epistemic transition

world update
→ temporal transition

explicit "do not use"
→ authoritative purpose-scoped Use Constraint
→ Context Assembly hard gate

explicit erasure
→ governed destructive operation
```

Erasure flow:

```text
intent
→ fail-closed scope resolution
→ source target selection in owning domains
→ derivation impact plan
→ authorization
→ erase/revoke sources
→ invalidate/rebuild descendants from survivors
→ invalidate caches/indexes/queues/learned artifacts
→ no-resurrection barrier
→ verify
→ content-free receipt
```

중요:

```text
source target selection
!= derivation propagation
```

Semantic association은 candidate discovery에는 쓸 수 있지만
삭제 전파 authority가 아니다.

```text
association
!= delete authority

DERIVED_FROM
→ rebuild/invalidate authority
```

Explicit suppression도:

```text
suppression != low accessibility
```

이며 learned policy가 override하면 안 된다.

현재 Galpi task의:

```text
lifecycle = deleted
```

는 CLOSED operational soft-delete contract다.
C1에는 physical purge가 없으므로 privacy erasure로 재해석하지 않는다.

Learned personal artifacts:

```text
affected
→ invalidate
→ rebuild/retrain/unlearn
→ verify
```

가 안 되는 opaque artifact는 erasable personal memory sink로 쓰지 않는다.

OPEN edge:

```text
erased personal source 때문에 생긴
independent non-personal system consequence를
어디까지 보존할 것인가
```

현재 후보 rule은 independent operational truth를 가지면서
erased content를 reconstruct하지 않는 경우에만 보존이지만
exact threshold는 later decision.


## 73.1 User acceptance

채택:

```text
Governance = cross-cutting authority

correction != world update != suppression != erasure

explicit suppression
→ authoritative Use Constraint

erasure propagation
→ Derivation / Dependency Provenance

task `deleted`
→ existing operational soft delete
```


---

# 74. R2 Open-Decision Triage

Semantic collapse 이후 OPEN을 네 bucket으로 정리한다.

```text
A. USER / R2 ARCHITECTURE DECISION
B. R3 EMPIRICAL DECISION
C. IMPLEMENTATION / STORAGE DETAIL
D. REQUIREMENT-TRIGGERED / DO NOT BUILD
```

현재 R2 architecture를 실제로 막는 user decision은 하나다.

```text
heterogeneous source evidence를
어떻게 globally address할 것인가?
```

후보:

```text
A. Unified Physical Evidence Ledger
B. Logical Evidence Registry / Address Layer over existing SoTs
C. Hybrid new-memory ledger
```

추천:

```text
B
```

이유:

```text
existing Galpi SoTs 유지
+ stable evidence identity
+ provenance/replay
+ cross-domain erasure planning
+ minimal migration/blast radius
```

R3로 넘길 것:

```text
instrument validity / retrieval
write & promotion
Context Assembly
VOI / acquisition
skill & prospective policies
learned-policy/evaluation methods
```

Implementation으로 내릴 것:

```text
exact schemas
graph/storage technology
Projection interface
Working Set serialization
evaluation trace storage
erasure machinery shape
```

지금 만들지 않을 것:

```text
runtime projection-type invention
durable agent-internal commitment store
one universal neural controller
specialist truth silos
generic Action Memory
universal graph truth substrate
```

A1 source-addressability decision이 닫히면
R2는 remaining-boundary map → experiment reduction → minimal architecture synthesis로 넘어간다.


## 74.1 User decision — source addressability ACCEPTED

채택:

```text
Logical Evidence Registry / Address Layer over Existing SoTs
```

강한 contract:

```text
registry = global logical identity / address
registry != copied source evidence

owning domains = source bytes / canonical records
```

Attachment도 같은 원칙:

```text
file/blob asset
→ owning attachment/library domain

EvidenceRef
→ whole file or stable region/span

parsed chunks / embeddings / summaries
→ rebuildable derived data
```

temporary attachment는 기존 bounded lifecycle을 유지하고
explicit promotion 없이 durable memory evidence로 조용히 승격하지 않는다.


---

# 75. R2 Hard Boundary Final Map — Compact

Normative design은 Research Design §51을 따른다.
Visual companion은 `xion-r2-hard-boundary-map.png`.

```text
Owning Sources
→ Logical Evidence Registry
→ Derivation Provenance
→ Derived-State Transition
→ Derived State / Hypothesis
→ 0..N Projections
→ Context Assembly
→ Reasoning / Action Candidate
```

Hard external authorities:

```text
Skill Contract
!= Commitment State
!= Governance
!= Executor Capability
```

Trace semantics:

```text
Derivation Provenance
!= Semantic Association
!= Retrieval Trace
!= Policy Decision Trace
```

Lifecycle semantics:

```text
Accessibility
!= Validity
!= Governed Erasure
```

Action principle:

```text
Memory can recall WHAT/WHEN and recommend HOW.
Governance owns WHETHER.
Executor owns what can actually happen NOW.
```

Erasure principle:

```text
select sources by owning-domain scope
propagate only by derivation/dependency provenance
rebuild surviving meaning
prevent resurrection
```

# 76. R3 Reduced Queue — Compact

Immediate:

```text
R3-0 instrument validity
R3-1 hard-gated vs global-soft-prior retrieval
```

Then one variable at a time:

```text
R3-2 Context Assembly mechanisms
R3-3 write / promotion / consolidation
```

Only when real usage/data exists:

```text
R3-4 active acquisition
R3-5 skill / prospective policy
R3-6 learned policy / OPE
```

Do not start with:

```text
universal neural controller
new autonomous projection types
full graph/storage bake-off
unsupported OPE
```


---

# 77. External Review Correction — R3 Feasibility / False-Memory Observability

**ACCEPTED / INCORPORATED**

외부 리뷰가 지적한 핵심 중 다음을 채택했다.

```text
R2 semantic closure
!=
R3 empirical feasibility
```

따라서 R2를 reopen하지 않고 R3 앞에 P0 preflight를 둔다.

```text
E  = eligible requests/day
ΔE = evidence-set-sensitive fraction
ΔA = materially answer-sensitive fraction among ΔE

Projected informative cases / 28d
= E × ΔE × ΔA × 28
```

User-accepted preregistered gate:

```text
GREEN  >= 50 / 28d
AMBER  20..49 / 28d
RED    < 20 / 28d
```

GREEN은 sequential online queue,
AMBER는 offline replay + small online holdout hybrid,
RED는 multi-lane online queue 중단/축소를 의미한다.

중요 correction:

```text
evidence-set difference != answer decision sensitivity
```

기존 A1b 77-query replay는 ΔE 추정에 재사용하고,
ΔE case에만 same-budget paired generation을 수행해 preliminary ΔA를 잰다.

D4 + D5 blind spot도 채택:

```text
explicit correction
→ high-precision user-detected incident signal
→ NOT total false-memory-rate estimator
```

추가:

```text
F7 proactive memory-claim faithfulness audit
```

sampled answer의 memory-dependent claim을
노출된 evidence/context에 대해 SUPPORTED / UNSUPPORTED / CONTRADICTED /
TEMPORALLY_STALE / NOT_MEMORY_DEPENDENT로 검사한다.

confirmed CONTRADICTED는 promotion-blocking hard incident로 다룬다.

F3 threshold는 측정 정의가 고정되기 전에 arbitrary 숫자를 박지 않는다.

```text
calibration pilot
→ freeze proxy + metric
→ preregister threshold
→ untouched holdout
```

순서를 따른다.


---

# 78. P0 Code Reality Check — Two Important Corrections

**ACCEPTED IMPLEMENTATION CLARIFICATION**

Current main inspection found:

```text
1. default retrieval-shadow report filters :a1b
   but current production text chat records :a2

2. review:retrieval-policy changedQueries compares
   legacy-global vs current-global thresholds,
   NOT D0 hard-gated vs global-soft-prior
```

Therefore neither number may be copied directly into P0 without explicit mode/policy handling.

Sensitivity variable refined:

```text
ΔR = final reader-visible bounded retrieval context differs
```

with diagnostic breakdown:

```text
activation change
membership change
order-only change
```

P0 executes in two steps:

```text
P0-A: online E + historical D0 ΔR, read-only
P0-B: paired generation only on ΔR cases → preliminary ΔA
```

If point-in-time approximation uncertainty can cross GREEN/AMBER/RED,
return INDETERMINATE and refine rather than forcing a color.
