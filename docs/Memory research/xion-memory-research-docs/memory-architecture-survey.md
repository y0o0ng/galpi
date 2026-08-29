# XION Long-Term Memory Research Survey

> 상태: **R1 RESEARCH EVIDENCE — FROZEN REFERENCE**  
> 기준일: 2026-08-29  
> 역할: 외부 시스템·논문·교차학문 조사와 Gap-Fill 연구의 근거 corpus.  
> 정본 관계: **architecture 의미와 계약은 `memory-architecture-design.md`가 우선한다.**  
> 목적: XION 개인화 장기기억 설계를 뒷받침하는 mechanism-level 비교, 반례, failure mode, 연구 근거를 보존한다.

---

## Document Authority

이 문서는 **research evidence/reference**다.

- 조사 결과, 비교 근거, 반례, 연구상 ADOPT/REJECT/OPEN 기록을 보존한다.
- 현재 XION architecture contract를 직접 정의하지 않는다.
- 본 문서의 과거 working hypothesis와 `memory-architecture-design.md`의 ACCEPTED contract가 충돌하면 **design 문서가 우선**한다.
- R3에서 새 empirical evidence가 생겨 연구 결론을 수정해야 할 때만 이 문서를 다시 연다.

---

## 1. Research Question

한 사람과 장기간 상호작용하는 AI는 무엇을 기억해야 하고, 원본 경험과 파생 해석을 어떻게 구분해야 하며, 사실·상태·선호·결정·관계·계획을 어떤 형태로 저장하고 갱신해야 하는가?

R1-A의 목적은 최종 architecture를 고르는 것이 아니라 기존 시스템이 해결한 mechanism과 아직 비어 있는 failure mode를 분리하는 것이다.

---

## 2. Comparison Frame

| Axis | 질문 |
|---|---|
| Representation | 기본 memory unit은 무엇인가 |
| Raw-source preservation | 원본 경험이 남는가 |
| Derived-state separation | 사실과 해석이 분리되는가 |
| Consolidation | 여러 경험을 어떻게 통합하는가 |
| Reconsolidation | 새 evidence가 기존 derived state를 어떻게 바꾸는가 |
| Temporal model | event time / mention time / validity가 있는가 |
| Identity | 같은 entity를 어떻게 식별하는가 |
| Conflict | 모순을 어떻게 다루는가 |
| Uncertainty | 여러 해석을 공존시킬 수 있는가 |
| Provenance | derived memory가 source까지 추적되는가 |
| Retrieval coupling | representation과 retrieval이 어떻게 연결되는가 |
| Rebuildability | derived state를 다시 만들 수 있는가 |
| Personalization | profile / belief / preference abstraction을 어떻게 다루는가 |
| Cost profile | LLM 사용이 write/read/background 중 어디에 집중되는가 |
| Main risk | 장기 개인화에서 가장 큰 실패 모드는 무엇인가 |

---

## 3. EverMemOS

### Core idea

```text
Raw Conversation
      ↓
Semantic Episode Boundary
      ↓
MemCell
 ├─ Episode
 ├─ Atomic Facts
 ├─ Foresight
 └─ Metadata
      ↓
MemScene
      ↓
User Profile
```

EverMemOS는 memory를 단순 저장/검색이 아니라 **experience formation → semantic consolidation → reconstructive recollection** lifecycle로 본다.

### Strong mechanisms

- **Semantic segmentation**: session이나 fixed-token 경계보다 의미적 episode boundary를 사용.
- **Multi-view episode representation**: narrative episode, atomic fact, foresight를 분리.
- **MemScene consolidation**: 관련 MemCell을 semantic + temporal condition으로 묶음.
- **Reconstructive recollection**: 검색 결과가 부족하면 missing information을 식별하고 query를 재작성해 다시 찾음.

### Weaknesses / open problems

- MemCell이 하나의 MemScene에만 속하는 **exclusive membership**은 다중 맥락 memory에 제약이 될 수 있음.
- Foresight는 미래를 위한 추론이지만 **future evidence로 스스로 검증되는 loop가 없음**.
- Implicit trait가 profile로 올라가면 잘못된 abstraction이 personalization 전체에 퍼질 수 있음.
- Sufficiency / query rewrite가 read path에 추가 LLM 비용을 만듦.

### XION takeaway

**ADOPT / EXPERIMENT**: semantic segmentation, atomic facts, temporal consolidation, reconstructive retrieval, foresight concept.  
**REDESIGN**: exclusive scene membership, profile inference, foresight → prediction validation loop.

---

## 4. Hindsight

### Core idea

Hindsight는 장기 memory에서 **evidence / observation / belief**의 epistemic separation을 강하게 다룬다.

초기 논문 구조:

```text
World
Experience
Observation
Opinion
```

현재 제품은 Opinion/Entity Summary를 Observation으로 통합하고 scalar confidence보다 supporting evidence와 freshness를 강조하는 방향으로 진화했다.

### Strong mechanisms

- **Dual-time representation**: occurred time과 mentioned time을 분리.
- **Evidence-backed Observation**: 여러 fact를 consolidation하되 source fact provenance를 유지.
- **Freshness / stale derived state**: 새 fact가 들어왔는데 observation이 아직 갱신되지 않았으면 stale로 취급.
- **Reversible curation**: invalidation/edit/restore를 destructive deletion보다 lifecycle state로 관리.
- **Hierarchical fallback**: Mental Model → Observation → Raw Fact.

### Architecture evolution as evidence

```text
Opinion + scalar confidence
        ↓
Observation + supporting evidence + freshness
```

실제 제품 evolution은 "magic confidence"보다 evidence와 freshness를 보존하는 쪽에 힘을 실어준다. 또한 derived structures를 facts에서 재생성한 전례는 **derived memory는 rebuildable해야 한다**는 가설과 잘 맞는다.

### Weaknesses / open problems

- Raw source에서 fact를 추출하는 순간 이미 LLM interpretation이 들어간다.
- Observation은 여전히 ambiguity를 하나의 abstraction으로 collapse시킬 수 있다.
- `proof_count`는 independent evidence의 수와 동일하지 않다.
- Fixed hierarchy는 좋은 baseline이지만 sparse heterogeneous routing은 아니다.

### XION takeaway

**STRONG ADOPT**: dual time, evidence-backed abstraction, stale detection, reversible curation, rebuildable derived views.  
**EXTEND**: Observation → Fork-aware interpretation, fixed hierarchy → sparse routing, proof count → explicit evidence graph.

---

## 5. Generative Agents

### Core idea

```text
Memory Stream
+ retrieval
+ reflection
+ planning
```

Memory Stream에는 observation, reflection, plan이 함께 들어간다.

### Strong mechanisms

- **Continuous Memory Stream**: experience를 시간순으로 계속 보존.
- **Reflection**: low-level episode가 충분히 쌓이면 higher-level abstraction 생성.
- **Significance-triggered consolidation**: 고정 시간이 아니라 중요 경험 누적이 reflection trigger.
- **Recursive abstraction**: reflection이 다시 higher-order reflection의 input이 됨.
- **Plan as prospective memory**: 미래 계획도 cognition의 일부로 다룸.

### Retrieval baseline

```text
recency
+ importance
+ relevance
```

이 weighted scoring은 영향력 있는 baseline이지만 XION 관점에서는 global scalar importance가 너무 많은 의미를 한 숫자에 압축한다.

### Weaknesses / open problems

- `importance = 1..10`은 무엇에 중요한지 표현하지 못함.
- Reflection이 다시 higher-level reflection의 evidence처럼 쓰이면서 **inference laundering**이 생길 수 있음.
- last-access recency는 잘못 뜬 memory까지 reinforcement할 수 있음.
- 실제 assistant에서는 operational task/calendar truth와 "계획을 말한 기억"을 분리해야 함.

### XION takeaway

**ADOPT CONCEPT**: continuous stream, reflection, significance-triggered consolidation, recursive abstraction.  
**REPLACE**: scalar importance → typed significance, reflection truth → evidence-backed hypothesis, access reinforcement → downstream-use signal.

---

## 6. Graphiti

### Core idea

Graphiti는 **evolving facts + temporal validity + provenance**를 graph로 표현한다.

```text
Episodes
   ↓
Entities + Temporal Facts
   ↓
Communities
```

각 derived fact는 source episode로 추적 가능하다.

### Strong mechanisms

- **Episode provenance**: raw episode와 derived entity/fact를 분리.
- **Bi-temporal lifecycle**: valid_at / invalid_at과 created_at / expired_at으로 world-validity와 system-knowledge time을 분리.
- **Non-destructive invalidation**: 새 fact가 old fact를 대체해도 history를 삭제하지 않음.
- **Incremental graph construction**: 새 episode를 전체 recomputation 없이 통합.
- **Hybrid retrieval**: semantic + lexical + graph traversal.
- **Entity resolution pipeline**: high-recall candidate generation 뒤 semantic resolution.

### Weaknesses / open problems

- Episode → edge는 여전히 LLM-derived interpretation.
- Multiple interpretations를 Fork처럼 보존하지 않음.
- State, Preference, Event, Decision은 update semantics가 서로 다른데 generic contradiction engine은 과잉 invalidation 위험이 있음.
- 개인 memory에서 false entity merge는 catastrophic할 수 있음.
- Ranking, timeseries, decision history는 graph보다 specialized representation이 더 자연스러울 수 있음.

### XION takeaway

**STRONG ADOPT**: temporal provenance, raw episode linkage, non-destructive invalidation, incremental graph, hybrid retrieval, entity candidate generation.  
**LIMIT / REDESIGN**: graph는 entire memory architecture가 아니라 **general semantic substrate**로 보는 쪽이 더 유망.

---

## 7. Cross-System Comparison

| Axis | EverMemOS | Hindsight | Generative Agents | Graphiti |
|---|---|---|---|---|
| Raw source | episode-oriented | configurable raw + facts | memory stream | explicit Episodes |
| Primary derived unit | MemCell / Scene | Observation | Reflection | Entity Fact Edge |
| Consolidation | Scene | Observation | Reflection | Graph integration |
| Recursive abstraction | limited | limited | strong | community/entity summary |
| Temporal validity | foresight interval | occurred/mentioned | recency | strong bi-temporal |
| Conflict | profile/scene update | observation revision | weak | temporal invalidation |
| Ambiguity forks | no | no | no | no |
| Provenance | moderate | strong | reflection citations | very strong |
| Rebuildability | partial | strong recent direction | weak | operationally persistent derived graph |
| Specialized representations | no | Mental Models | no | ontology types |
| Sparse heterogeneous routing | no | fixed hierarchy | no | search recipes, not full router |
| Active elicitation | no | no | no | no |
| Prediction validation | no | no | no | no |
| Learned memory policy | no | future/open | no | no |

---

## 8. Repeated Patterns Across Systems

### 8.1 Raw experience alone is insufficient

모든 강한 시스템은 raw history 위에 derived state를 만든다.

```text
raw
→ fact
→ scene / observation / reflection / graph
```

따라서 "모든 대화를 embedding해서 top-k"만으로 충분하다는 가설은 약해진다.

### 8.2 Consolidation helps

- EverMemOS: MemScene
- Hindsight: Observation
- Generative Agents: Reflection
- Graphiti: entity/fact/community integration

형태는 달라도 **여러 episode를 higher-level state로 통합**한다.

### 8.3 Derived state creates new failure modes

- hallucinated abstraction
- stale profile
- bad merge
- over-generalization
- contradiction propagation
- inference laundering

따라서 derived memory에는 provenance와 lifecycle state가 필요하다.

### 8.4 Time must be first-class

단순 `created_at` 하나로는 부족하다. 반복해서 나타난 최소 축:

```text
event time
mention / learned time
validity interval
freshness
```

### 8.5 Online and background paths naturally separate

```text
cheap online processing
+
expensive background consolidation
```

이 패턴이 네 시스템에서 반복된다.

### 8.6 No single representation wins everywhere

- Graph: entity / relation / temporal fact
- Ranking: preference ordering
- Timeline: longitudinal state
- Decision Ledger: choice + reason
- Reflection: higher-level abstraction

따라서 **representation heterogeneity**는 예외가 아니라 자연스러운 방향일 수 있다.

---

## 9. XION Emerging Hypotheses

### H1 — Canonical Evidence/Event Ledger

```text
Canonical:
raw user/system events
explicit actions
corrections
source provenance

Derived:
facts
observations
graph edges
rankings
timelines
forks
reflections
```

Derived state는 가능한 한 rebuildable하게 둔다.

### H2 — General Temporal Graph as Semantic Substrate

Graphiti-style graph는 매우 강하지만 memory 전체를 지배하는 단일 형식이 아니라 general entities, relationships, events, temporal provenance를 담당하는 common substrate로 둔다.

### H3 — Specialized Formatters

```text
Ranking
Timeline
Decision Ledger
Relationship View
Routine
Preference Set
```

하나의 evidence는 0..N formatter에 들어갈 수 있다.

### H4 — Memory Forks

여러 해석이 가능한 evidence를 premature collapse하지 않는다.

```text
Evidence
 ├─ H1
 ├─ H2
 └─ H3
```

### H5 — Prediction as Hypothesis Validation

```text
hypothesis
→ prediction
→ future evidence
→ support / weaken / reject
```

### H6 — Active Elicitation

retrieval과 future evidence만으로 중요한 ambiguity를 해결하기 어렵다면 사용자에게 묻는 것도 memory operation으로 본다.

### H7 — Sparse Heterogeneous Routing

```text
query
→ router
→ 0..N relevant structures
```

전체 memory 규모보다 interaction당 활성 구조 수를 작게 유지한다.

### H8 — Learned Memory Controller

학습 대상은 memory content 자체보다 다음 policy일 수 있다.

```text
write?
retrieve?
route?
consolidate?
ask?
suppress?
```

Explicit memory는 auditability를 유지한다.

---

## 10. Strongest Novelty Candidates So Far

아직 novelty claim은 확정하지 않는다. R1 전체와 관련 문헌 조사가 더 필요하다.

현재 네 시스템에서 직접 해결되지 않은 강한 후보:

1. Fork-based uncertainty representation
2. Prediction-backed memory self-validation
3. Active user elicitation as memory mechanism
4. Adaptive specialized formatter growth
5. Sparse multi-formatter routing
6. Shadow counterfactual supervision for memory policy
7. Learned controller over explicit auditable memory
8. Censored / delayed outcome learning for memory usefulness

이 목록은 R1-B~R1-G에서 선행연구를 더 확인해야 한다.

---

## 11. Cost / Model-Tiering Implication

```text
T0 deterministic
- timestamps
- IDs
- explicit actions
- DB invariants

T1 small local SLM
- simple routing
- candidate filtering
- simple classification
- constrained extraction

T2 cheap stronger model
- boundary detection
- simple consolidation
- query rewrite
- dedupe

T3 strong model
- ambiguous entity resolution
- Fork generation
- preference abstraction
- contradiction reasoning

T4 background frontier
- deep reflection
- memory hygiene
- specialization proposal
- policy review
```

따라서 future R1-E/R3에서 `task × model-size` benchmark가 필요하다. Raspberry Pi / local Qwen은 전체 memory intelligence보다 T1/T2 workload의 최소 충분 모델을 찾는 실험 대상으로 본다.

---

## 12. R1-A Preliminary Conclusion

> **강한 장기기억은 단일 저장소, 단일 그래프, 단일 profile이 아니다. 원본 경험을 보존하면서 여러 파생 representation을 만들고, 시간·근거·불확실성을 유지하며, 현재 query에 맞는 일부만 활성화하고, 새 경험으로 그 파생 상태와 기억 정책 자체를 계속 갱신하는 시스템에 가깝다.**

이 문장은 최종 설계가 아니라 R1-A에서 관찰된 패턴을 설명하는 working hypothesis다.

---

## 13. Next Research Steps

### R1-A Saturation Check

추가 시스템을 읽기 전에:

- representation/consolidation mechanism class가 빠졌는지 확인
- 네 시스템 밖에 의미 있게 다른 접근이 있는지 1~2개 탐색
- 새로운 mechanism class가 거의 추가되지 않으면 R1-A 종료

### R1-B — Retrieval & Association

다음 주요 축:

- associative retrieval
- graph traversal
- multi-hop
- retrieval routing
- coarse-to-fine
- memory compression
- hybrid ranking
- usage attribution
- retrieval feedback loops

후보 연구 대상:

- HippoRAG
- MAGMA
- HyperMem
- LightMem / HyMem
- LongMemEval retrieval diagnostics
- 관련 IR / interleaving literature

---

## 14. Document Role

이 문서는 brainstorm log도, final architecture design도, implementation prompt도 아니다.

역할은:

> **R1-A에서 확인한 architecture mechanisms와 잠정 synthesis를 보존하는 survey canonical**

이다.

새 외부 연구 결과가 기존 판단을 깨면 이 문서를 수정한다.


---

# 15. Gap-Fill Finding 1 — Truth Maintenance & Belief Revision

> 상태: **HIGH-IMPACT CROSS-DISCIPLINARY FINDING**
>
> 외부 연구 축: Truth Maintenance Systems, ATMS, AGM Belief Revision, Iterated Revision
>
> XION 연결부: Fork, correction semantics, derived-memory lifecycle, provenance, reconsolidation

## 15.1 Why This Matters

XION의 Memory Fork는 처음에는:

```text
Evidence
├─ Interpretation A
├─ Interpretation B
└─ Interpretation C
```

처럼 “애매한 해석을 하나로 강제하지 않는다”는 아이디어였다.

Truth Maintenance / ATMS 연구를 보면 이를 더 엄밀하게 만들 수 있다.

핵심은:

> **사용자가 실제로 남긴 evidence와, 그 evidence를 해석하기 위해 시스템이 세운 assumption을 분리하고, 각 derived belief가 어떤 evidence와 assumption에 의존하는지 추적한다.**

## 15.2 Evidence ≠ Assumption

예:

```text
E1:
"요즘 커피 안 마셔."
```

`E1`은 관측된 canonical evidence다.

반면 가능한 해석은 assumption이다.

```text
A1:
이 발언은 커피 맛에 대한 선호 변화다.

A2:
이 발언은 건강/카페인 constraint다.

A3:
이 발언은 일시적 행동 변화다.
```

그 위에서 derived hypotheses가 만들어진다.

```text
E1 + A1 → H1: 현재 커피 맛을 싫어한다.
E1 + A2 → H2: 커피를 피하지만 취향은 유지될 수 있다.
E1 + A3 → H3: 일시적으로 커피를 마시지 않는다.
```

XION에서 canonical evidence와 interpretive assumption은 epistemic status가 완전히 다르다.

## 15.3 Fork Branches Need Not Be Mutually Exclusive

Fork를 단순한:

```text
A or B or C
```

형식으로 보면 안 된다.

예:

```text
H2:
건강 때문에 카페인을 피한다.

H3:
당분간 커피를 마시지 않는다.
```

는 동시에 참일 수 있다.

따라서 Fork는:

> **서로 배타적인 선택지 목록이 아니라, 공존 가능성을 포함하는 competing / overlapping hypotheses**

로 보는 편이 더 정확하다.

## 15.4 Justification DAG

Classic ATMS의 중요한 아이디어는 결론과 함께
“왜 그 결론이 성립하는가”를 유지하는 것이다.

XION에서는 전역 ATMS environment lattice 대신:

```text
Derived Hypothesis H

justification J1:
  evidence = [E10, E11]
  assumptions = [A4]

justification J2:
  evidence = [E25, E27, E31]
  assumptions = [A7, A9]
```

같은 **Justification DAG**를 유지하는 방향이 유망하다.

이 구조는 provenance, correction propagation, stale derived-state detection, explanation, minimal recomputation에 직접 사용될 수 있다.

## 15.5 Local Nogoods

새 evidence가 특정 interpretation과 충돌하면 그 interpretation을 물리 삭제하지 않는다.

```text
E2:
"커피 맛은 아직 좋아해."

H1:
"커피 맛을 싫어하게 됐다."

H1 + E2 → contradiction
```

H1을 지지하는 특정 assumption combination을 **nogood**로 표시할 수 있다.

핵심 원칙:

```text
old evidence remains

derived interpretation changes state
ACTIVE → INVALID / CONTRADICTED / UNRESOLVED
```

## 15.6 Why Full ATMS Is Rejected

Classic ATMS는 assumption 수 `n`에 대해 가능한 environment가 이론적으로 `2^n`까지 증가할 수 있다.
장기 개인화 memory 전체에 적용하면 현실적이지 않다.

또 LLM이 잘못된 justification을 생성하면 dependency propagation이 “정확하게 잘못된” 결과를 만들 수 있다.

따라서 현재 후보는:

> **Full ATMS가 아니라 Local Justification DAG + Local Nogood Propagation**

이다. 전역 possible-world enumeration은 하지 않는다.

## 15.7 Belief Revision: Update ≠ Correction

Belief Revision에서 가장 중요한 XION 연결점은:

```text
world changed
≠
our previous belief was wrong
```

이라는 구분이다.

### World Update

```text
2026:
"익산에 살아."

2027:
"서울로 이사했어."
```

기존 memory가 틀린 것이 아니다.

```text
익산 거주
valid_until = 2027

서울 거주
valid_from = 2027
```

같은 temporal state transition이다.

### Correction / Epistemic Revision

```text
"2024년에 부산에 살았어."

later:
"아, 잘못 말했어. 부산에 산 적 없어."
```

이 경우 과거 세계가 바뀐 것이 아니다. 기존 claim이 epistemically wrong이었다.

따라서 단순 validity 종료가 아니라:

```text
old claim
→ invalidated_as_error

correction event
→ supersedes old epistemic claim
```

가 되어야 한다.

## 15.8 Change-Type Classification

새 evidence가 old derived memory와 다르다고 해서 항상 contradiction/invalidation으로 처리하면 안 된다.

최소 후보:

```text
EXPANSION
WORLD_UPDATE
CORRECTION
ADDITIONAL_CONTEXT
CONTRADICTION
TEMPORAL_SCOPE_CHANGE
INTERPRETATION_REVISION
```

예:

```text
"예전에는 커피 좋아했는데 지금은 안 좋아해."
→ WORLD_UPDATE

"커피 싫다고 말한 건 농담이었어."
→ CORRECTION / INTERPRETATION_REVISION

"커피는 좋아하지만 카페인은 끊었어."
→ ADDITIONAL_CONTEXT + apparent contradiction resolution
```

## 15.9 Minimal Epistemic Change

Belief Revision의 중요한 원리는:

> **새 evidence 때문에 필요한 만큼만 기존 belief를 바꾼다.**

예:

```text
old:
- 커피를 싫어한다.
- 카페인을 피한다.
- 아침에 따뜻한 음료를 자주 마신다.

new:
"커피 맛은 좋아해."
```

이면 첫 번째 claim만 revise해야 한다.
커피 관련 memory 전체를 폐기하면 안 된다.

XION에서는 correction propagation의 핵심 invariant 후보다.

## 15.10 Belief Base, Not Closed Belief Set

고전 AGM의 logically closed belief set은 장기 personal memory에는 과도하다.

XION은:

```text
Canonical Evidence Base
+
Explicit Derived Belief Base
+
Reader-time Reasoning
```

에 더 가깝다. 모든 logical consequence를 materialize하지 않는다.

## 15.11 New Memory Hypothesis Loop

ATMS / Belief Revision을 반영한 후보 lifecycle:

```text
Canonical Evidence Event
          │
          ▼
 Interpretation Candidates
          │
    ┌─────┼─────┐
    ▼     ▼     ▼
   H1    H2     H3
    │     │      │
    └─ Justification DAG ─┘
          │
          ▼
Consistent Support Contexts
          │
          ▼
Prediction / Retrieval / Elicitation
          │
          ▼
     New Evidence
          │
          ▼
Classify Change
 ├─ Expansion
 ├─ World Update
 ├─ Correction
 ├─ Additional Context
 └─ Contradiction
          │
          ▼
Local Dependency Propagation
          │
          ▼
Active / Invalid / Unresolved Hypotheses
```

## 15.12 Current Decision

| Mechanism | XION status |
|---|---|
| Evidence vs assumption separation | **STRONG ADOPT** |
| Justification tracking | **STRONG ADOPT** |
| Multiple simultaneous interpretations | **STRONG ADOPT concept** |
| Local nogoods | **STRONG EXPERIMENT** |
| Global ATMS environment lattice | **REJECT** |
| Minimal-change revision | **STRONG ADOPT** |
| World update vs correction distinction | **VERY STRONG ADOPT** |
| Belief-set logical closure | **REJECT** |
| Belief-base model | **STRONG ADOPT concept** |
| Iterated belief revision | **HIGH-PRIORITY RESEARCH TARGET** |

### Working synthesis

> **Fork는 단순한 ambiguity list가 아니라, canonical evidence와 explicit assumptions를 분리하고, multiple interpretations의 justification dependency를 유지하며, 새로운 evidence가 들어오면 local belief revision을 수행하는 truth-maintenance layer가 될 수 있다.**


---

# 16. Gap-Fill Finding 2 — Active Preference Elicitation & Value of Information

> 상태: **HIGH-IMPACT CROSS-DISCIPLINARY FINDING**
>
> 외부 연구 축: Active Learning, Preference Elicitation, Value of Information, Bayesian Experimental Design, Conversational Recommendation, HCI Interruption
>
> XION 연결부: Fork, Active Elicitation, sparse routing, preference formatter, memory controller

## 16.1 Uncertainty ≠ Value of Resolving It

Fork가 불확실하다는 사실만으로 사용자를 방해할 이유는 없다.

```text
Uncertainty
≠
Value of resolving uncertainty
```

현재/향후 decision에 거의 영향을 주지 않는 ambiguity는 unresolved 상태로 남겨도 된다.
반대로 작은 ambiguity라도 branch에 따라 recommendation/action이 달라지면 질문 가치가 높다.

## 16.2 Routing Overlap Is Candidate Generation, Not the Final Ask Rule

기존 가설:

```text
Fork ∩ routed structures != ∅
→ elicitation candidate
```

는 유지한다.

하지만 다음을 추가한다.

```text
branch A → downstream action X
branch B → downstream action X
=> DON'T ASK

branch A → downstream action X
branch B → downstream action Y
=> evaluate VOI
```

즉 현재 query와의 관련성만이 아니라 **branch가 실제 downstream behavior를 바꾸는가**를 본다.

## 16.3 VOI over Raw Information Gain

Information Gain:
- user model uncertainty를 얼마나 줄이는가

Value of Information:
- uncertainty 감소가 실제 downstream decision / personalization을 얼마나 개선하는가

XION은 VOI를 우선한다.

단, global latent user utility를 복원하는 것이 아니라
현재 Fork / formatter / decision-local uncertainty에 적용한다.

## 16.4 Easy-to-Answer Queries

좋은 질문 후보:

```text
agent uncertainty = HIGH
human uncertainty = LOW
```

나쁜 질문 후보:

```text
agent uncertainty = HIGH
human uncertainty = HIGH
```

따라서 query utility에는 최소 다음 요소가 필요하다.

```text
expected decision improvement
- cognitive difficulty
- interruption cost
- response noise / error risk
```

## 16.5 Ask About Discriminators, Not Fork Labels

Fork branch는 mutually exclusive일 필요가 없다.

따라서:

```text
"취향 변화야, 건강 문제야?"
```

처럼 branch 하나를 강제로 고르게 하기보다:

```text
"커피 맛 자체는 아직 좋아해?"
```

처럼 가장 discriminative한 assumption/evidence를 묻는 편이 낫다.

## 16.6 Three Elicitation Modes

Active Elicitation은 세 단계로 본다.

```text
1. Natural Observation
2. Opportunistic Elicitation
3. Explicit Elicitation
```

가능하면 자연 interaction에서 evidence가 나오기를 기다린다.

필요하다면 원래 수행할 recommendation/choice 자체를 elicitation으로 사용한다.

마지막으로 별도 clarification이 필요한 경우에만 explicit question을 한다.

기본 우선순위 후보:

```text
observe
→ opportunistic
→ explicit
```

## 16.7 Domain-Specific Query Forms

Pairwise comparison은 Ranking / preference domain에서 강한 evidence source가 될 수 있지만
모든 memory ambiguity에 강제하지 않는다.

후보 action:

```text
DO_NOTHING
OBSERVE
OPPORTUNISTIC_QUERY
EXPLICIT_BINARY
EXPLICIT_PAIRWISE
ATTRIBUTE_CLARIFICATION
OPEN_CLARIFICATION
```

## 16.8 "Unknown" Is Valid Evidence

사용자의:

```text
"모르겠어."
"상황에 따라 달라."
"둘 다."
```

같은 답은 실패가 아니다.

이는 stable global preference가 없거나 context dependency가 있다는 evidence일 수 있다.
forced certainty를 요구하지 않는다.

## 16.9 Probability Is Transient Decision State

VOI 계산을 위해 working probability / relative plausibility를 사용할 수 있다.

하지만 다음과 같은 값을 canonical/persistent memory truth로 저장하는 것은 현재 비선호다.

```text
P(H1)=0.31
P(H2)=0.52
P(H3)=0.17
```

Persistent layer는:

```text
hypotheses
evidence
assumptions
contradictions
status
```

를 보존한다.

## 16.10 Cheap Initial Policy

초기 heuristic 후보:

```text
ASK only if:
1. unresolved Fork exists
2. current routed structures overlap
3. plausible branches change downstream answer/action
4. existing evidence is insufficient
5. no cheap natural observation is likely soon
6. candidate question is easy to answer
7. interruption cost is acceptable
```

이는 향후 learned elicitation policy의 baseline이 된다.

## 16.11 Candidate Experiment

Synthetic longitudinal benchmark:

```text
A. Never Ask
B. Ask Every Ambiguity
C. Routing-Overlap Ask
D. VOI-Gated Ask
```

측정:

```text
decision correctness
false-personalization rate
questions per interaction
unnecessary-question rate
answerability
future reuse
correction rate
```

## 16.12 Current Decision

| Mechanism | XION status |
|---|---|
| Active preference elicitation | **STRONG ADOPT** |
| Information gain | **ADOPT as signal** |
| Expected Value of Information | **STRONG ADOPT concept** |
| Easy-to-answer query selection | **STRONG ADOPT** |
| Pairwise comparison | **ADOPT selectively** |
| Recommendation-as-query | **VERY STRONG ADOPT concept** |
| Always explicit asking | **REJECT** |
| Natural observation first | **STRONG ADOPT** |
| Unknown/context-dependent response | **STRONG ADOPT** |
| Global latent utility model | **REJECT as default** |
| Persistent Bayesian confidence | **DEFER / likely avoid** |
| Learned elicitation policy | **HIGH-POTENTIAL** |

### Working synthesis

> **Active Elicitation은 “모르는 것을 물어보는 기능”이 아니라, unresolved hypothesis가 현재 decision에 실제 영향을 줄 때만, 자연 관찰 → opportunistic interaction → explicit question 순으로 가장 낮은 interaction cost의 discriminating evidence를 획득하는 memory operation으로 본다.**


---

# 17. Gap-Fill Finding 3 — Contextual Bandits & Off-Policy Evaluation

> 상태: **HIGH-IMPACT CROSS-DISCIPLINARY FINDING**
>
> XION 연결부: Shadow-All-Write, memory controller, write policy, sparse routing, elicitation policy

## Core Finding

Memory policy가 선택한 action의 outcome만 관측되므로:

```text
policy → what gets observed → training data → next policy
```

라는 selection bias가 생긴다.

향후 OPE를 위해 memory decision은 최소 다음 의미를 보존해야 한다.

```text
context_ref
available_actions
behavior_policy_version
chosen_action
chosen_action_probability / propensity
shadow_actions
outcome_refs
reward_definition_version
```

`support = 0`인 action의 실제 outcome은 ordinary logged-bandit OPE로 복구할 수 없다.

## Shadow-All-Write Boundary

Shadow-All-Write는:

> **counterfactual truth oracle가 아니라 counterfactual observability augmenter**

다.

강한 영역:

```text
would exist?
would retrieve?
would fit budget?
would answer differ?
would LOO matter?
```

약한/불가능 영역:

```text
would user like it?
would user correct it?
would future conversation change?
```

따라서 production human outcomes와 shadow system-side proxies를 분리한다.

## OPE Direction

IPS는 baseline/diagnostic으로 사용 가능하지만 low-propensity에서 variance가 커진다.

Doubly Robust는:

```text
reward-model prediction
+
importance-weighted correction
```

으로 shadow-derived features와 actual logged outcomes를 결합할 수 있어 높은 연구 가치가 있다.

Counterfactual Risk Minimization / safe policy improvement는
false-memory constraint를 우선하는 XION과 잘 맞는 비교 축이다.

## Local Bandit, Long-Horizon Sequential Effects

WRITE/ASK는 미래 memory/user state를 바꾸므로
whole-memory controller는 pure contextual bandit이 아니다.

현재 방향:

```text
binary local decisions first
→ factorized routing later
→ long-horizon sequential learning only if evidence supports it
```

첫 learned action으로 `WRITE / NO_WRITE`를 택한 기존 방향은 강화된다.

Exact ordered retrieval-set을 하나의 action으로 학습하는 것은
combinatorial/slate action 때문에 현재 비선호다.

Sparse routing은 learning tractability 관점에서도 강해진다.

## Current Decision

| Mechanism | XION status |
|---|---|
| Logged-bandit view of local memory decisions | **STRONG ADOPT concept** |
| Policy-version logging | **STRONG ADOPT** |
| Action propensity logging | **STRONG ADOPT candidate** |
| IPS | **EXPERIMENT / baseline** |
| Doubly Robust OPE | **HIGH-POTENTIAL** |
| Counterfactual Risk Minimization | **HIGH-POTENTIAL** |
| Shadow-All-Write as instrumentation | **STRONG ADOPT** |
| Shadow as true human counterfactual | **REJECT** |
| Safe/conservative policy improvement | **HIGH-POTENTIAL** |
| Immediate live random exploration | **REJECT for first experiment** |
| Write/no-write first learned action | **STRONGLY REINFORCED** |
| Exact retrieval-set action learning | **REJECT likely** |
| Sparse/factorized routing actions | **STRONGER CANDIDATE** |
| Whole memory as one-step bandit | **REJECT** |
| Long-horizon sequential OPE/RL | **RESEARCH TARGET** |
| Single scalar reward | **REJECT likely** |
| Constraint-first optimization | **STRONGLY REINFORCED** |

### Working synthesis

> **현재 memory policy 자체가 미래 학습 데이터를 편향시킨다. XION은 shadow execution으로 system-side counterfactual observability를 늘리고, policy/action/propensity/outcome provenance를 남겨 OPE 가능한 local memory decisions부터 학습하되, human counterfactual과 장기 sequential effect는 별도 문제로 취급한다.**


---

# 18. Gap-Fill Finding 4 — Delayed / Censored Feedback, PU Learning & Survival

> 상태: **HIGH-IMPACT CROSS-DISCIPLINARY FINDING**
>
> 외부 연구 축: Survival Analysis, Delayed Feedback, Positive-Unlabeled Learning, Cure Models, Recurrent Events, Competing Risks
>
> XION 연결부: outcome evaluation, forgetting, reward design, shadow exposure, formatter-local lifetime, memory controller

## 18.1 Unobserved ≠ Negative

Memory가 아직 사용되지 않았다는 사실은
그 memory가 useless하다는 뜻이 아니다.

```text
not yet used
≠
negative
```

관찰 종료 시점까지 event가 일어나지 않았다면
적어도 일부 경우에는 right-censored observation으로 봐야 한다.

따라서 outcome state는 최소:

```text
POSITIVE
NEGATIVE
UNOBSERVED / CENSORED
```

를 구분해야 한다.

## 18.2 Calendar Age Is a Weak Signal

다음 두 memory는 같은 `unused for 2 years`라도 의미가 다르다.

```text
A:
calendar age = 2 years
relevant opportunities = 0

B:
calendar age = 2 years
relevant opportunities = 84
contribution = 0
```

따라서 memory age보다:

> **relevant opportunity exposure**

가 usefulness/forgetting 평가에 더 강한 denominator일 수 있다.

## 18.3 Memory Outcome Funnel

Observed use는 memory intrinsic quality만 반영하지 않는다.

```text
Memory exists
      ↓
Relevant opportunity
      ↓
Policy exposes/retrieves
      ↓
Reader uses
      ↓
Answer changes
      ↓
Human outcome
```

각 단계가 selection mechanism이다.

따라서:

```text
not retrieved ≠ not useful
retrieved but ignored ≠ wrong
answer changed ≠ better
```

를 명확히 구분해야 한다.

## 18.4 Censoring Reasons Matter

`UNOBSERVED` 하나로 묶기보다
왜 outcome이 없는지를 분석해야 할 수 있다.

후보:

```text
NO_RELEVANT_OPPORTUNITY
NOT_SELECTED_BY_POLICY
SELECTED_BUT_NOT_USED
USED_BUT_NO_HUMAN_FEEDBACK
OBSERVATION_WINDOW_OPEN
MEMORY_SUPERSEDED
USER_STATE_CHANGED
```

정확한 enum은 추후 실험에서 결정한다.

## 18.5 PU Learning Interpretation

명시적 positive outcome이 관측된 memory와
아직 label이 없는 memory를:

```text
Positive
+
Unlabeled
```

로 보는 것이 자연스럽다.

Unlabeled에는:

```text
future-positive
true-negative
not-yet-exposed
```

가 섞일 수 있다.

따라서 unlabeled를 negative로 직접 학습하지 않는다.

## 18.6 Explicit Feedback Is Precise but Biased

Explicit correction / approval / reuse는
높은 precision의 observed signal이다.

그러나:

```text
high precision
≠
representative sample
```

이다.

사용자가 feedback을 남길 확률 자체가
domain, salience, exposure, interaction cost 등에 따라 달라질 수 있다.

따라서:

> **explicit feedback is gold-like evidence, not unbiased gold distribution.**

## 18.7 Survival / Cure / Recurrent-Event Views

Memory usefulness를 한 질문으로 압축하지 않고
다음처럼 분리할 수 있다.

```text
P(ever useful | memory, context)
T_first_use | eventually useful
reuse recurrence / intensity
```

Cure-model analogy는 `never useful` latent class를,
survival은 `time to first use`를,
recurrent-event analysis는 반복 reuse를 연구하는 데 참고할 수 있다.

단, 처음부터 복잡한 survival model을 채택하지 않는다.

## 18.8 Formatter-Local Latency

Memory 종류마다 natural latency가 다를 수 있다.

```text
Decision Ledger
→ short evaluation horizon

Relationship
→ rare but long-lived

General Fact
→ persistent

Ranking
→ opportunity-driven recurrence
```

따라서 global expiration/forgetting clock은 현재 비선호다.

## 18.9 Outcome Events Should Be Canonical; Reward Should Be Derived

단일 scalar reward는 다음 차이를 잃는다.

```text
used once after 10 minutes
used once after 3 years
used 20 times
used then corrected
never had an opportunity
had 100 opportunities but never contributed
```

따라서 canonical layer에는:

```text
RELEVANT_OPPORTUNITY
RETRIEVED
INJECTED
ANSWER_CHANGED
EXPLICIT_REUSE
CORRECTED
SUPERSEDED
DELETED
DECISION_COMPLETED
...
```

같은 outcome event history를 보존하고,

```text
Reward Definition v1
Survival View v1
PU Label v1
```

등은 versioned projection으로 만드는 방향이 강하다.

> **Reward should probably not be canonical.**

## 18.10 Opportunity-Adjusted Forgetting

Age-based forgetting보다 다음 조합이 더 강한 candidate다.

```text
many relevant opportunities
+
never contributed
+
redundant elsewhere
+
no active dependency
```

즉:

> **opportunity-adjusted irrelevance**

를 forgetting/retention 연구의 주요 후보로 둔다.

## 18.11 Current Decision

| Mechanism | XION status |
|---|---|
| `unobserved != negative` | **VERY STRONG ADOPT** |
| Right-censoring view | **STRONG ADOPT concept** |
| Time-to-first-use | **STRONG EXPERIMENT** |
| Recurrent-use modeling | **HIGH-POTENTIAL** |
| Cure-model analogy | **HIGH-POTENTIAL EXPERIMENT** |
| PU learning | **STRONG RESEARCH TARGET** |
| SCAR assumption | **REJECT likely** |
| SAR/propensity-aware PU | **HIGH-POTENTIAL** |
| Explicit feedback as unbiased gold | **REJECT** |
| Explicit feedback as high-precision signal | **STRONG ADOPT** |
| Calendar age as negative evidence | **REJECT** |
| Opportunity-adjusted inactivity | **VERY STRONG CANDIDATE** |
| Global forgetting horizon | **REJECT likely** |
| Formatter/domain-local latency | **STRONG CANDIDATE** |
| Intermediate proxy signals | **STRONGLY REINFORCED** |
| Single scalar reward | **EVEN WEAKER** |
| Outcome events canonical / reward derived | **NEW STRONG CANDIDATE** |
| Censoring-reason provenance | **NEW HIGH-POTENTIAL** |

### Working synthesis

> **Memory outcome은 binary reward가 아니라 opportunity, exposure, contribution, human feedback이 순차적으로 관측되는 delayed/censored event process에 가깝다. XION은 `아직 안 쓰임`을 negative로 취급하지 않고, opportunity-adjusted exposure와 canonical outcome events를 보존한 뒤 reward/PU/survival label을 derived views로 실험하는 방향이 유망하다.**


---

# 19. Gap-Fill Finding 5 — Multiple Memory Systems & Complementary Learning Systems

> 상태: **HIGH-IMPACT CROSS-DISCIPLINARY FINDING**
>
> 외부 연구 축: Complementary Learning Systems, Multiple Memory Systems, Experience Replay, Schema Learning, Pattern Separation / Completion
>
> XION 연결부: Formatter architecture, Librarian, consolidation, model cascade, entity identity, neural memory controller

## 19.1 Fast Acquisition ≠ Fast Generalization

CLS의 핵심 computational lesson은:

```text
new episode capture
≠
stable generalization update
```

이다.

XION에서는 raw/canonical evidence를 즉시 보존할 수 있지만,
derived generalization을 동일 속도로 갱신할 필요는 없다.

```text
Canonical Evidence
→ fast exact capture

Derived Observation / Formatter / Controller
→ slower integration
```

이는 두 개의 생물학적 memory store를 그대로 모방하자는 뜻이 아니다.

## 19.2 Consolidation as Interleaved Generalization

Consolidation을 단순한 recent-memory summary로 보지 않는다.

후보:

```text
new evidence
+
older related evidence
+
corrections
+
contradictions
+
exceptions
→ constrained consolidation
```

즉 최근 evidence만으로 profile/observation을 갱신하는
recency-biased consolidation을 피한다.

## 19.3 Structured / Contrastive Replay

Replay set은 random old evidence보다 다음을 포함할 수 있다.

```text
representative old evidence
rare evidence
explicit corrections
contradictions
exceptions
high-downstream-impact cases
```

Working hypothesis:

> **Current dominant pattern을 재확인하는 evidence뿐 아니라
> 그 pattern을 깨는 evidence를 같이 replay한다.**

이를 `Structured / Contrastive Consolidation Replay` 후보로 둔다.

## 19.4 Schema-Congruence Gating

새 evidence가 기존 stable schema/formatter에 잘 맞으면
cheap/fast path로 통합할 수 있다.

```text
known stable schema
+
clean congruent evidence
+
no conflict
→ FAST INTEGRATION
```

반대로:

```text
novel
conflicting
ambiguous
schema-incongruent
```

evidence는 episode를 보존한 채 Fork / strong Librarian 경로로 보낸다.

이는 local SLM → stronger model cascade의 새로운 principled gate 후보다.

## 19.5 Same Evidence → 0..N Representations

동일 experience가 서로 다른 computational representation에
동시에 기여하는 것은 자연스러운 설계일 수 있다.

```text
one Evidence Event
      ↓
     0..N
Graph / Ranking / Routine / Timeline / Decision / ...
```

이는 Formatter 0..N sparse routing 가설을 강화한다.

단, 인간 memory taxonomy를 그대로 formatter schema로 복제하지 않는다.

## 19.6 Separate on Write, Associate on Read

Pattern separation / completion에서 얻는 software hypothesis:

> **WRITE에서는 구분을 보존하고, READ에서는 association을 넓힌다.**

Write-side:

```text
preserve distinctions
avoid irreversible merge
record ambiguity
keep episodes
```

Read-side:

```text
semantic similarity
graph association
candidate expansion
multi-hop completion
```

특히 entity identity에서 false merge의 장기 비용을 줄이는 강한 후보 원칙이다.

## 19.7 Abstraction Does Not Replace Episodes

Derived semantic abstraction이 만들어져도
그 근거가 된 canonical episodes를 제거하지 않는다.

```text
E17
E31
E52
 ↓
Observation O4
```

에서 evidence와 abstraction을 모두 유지한다.

## 19.8 Consolidation Maturity

Derived state에 단일 numeric maturity를 두기보다
typed lifecycle/maturity state를 실험할 수 있다.

예:

```text
SINGLE_EPISODE
MULTI_EVIDENCE
STABLE_PATTERN
CONFLICTED
```

이는 aggressive generalization, model tiering, replay priority를
다르게 적용하는 신호가 될 수 있다.

아직 **EXPERIMENT** 수준이다.

## 19.9 Multi-Timescale Architecture

후보 timescale:

```text
seconds
→ raw capture / simple routing

minutes-hours
→ derived projection updates

periodic/background
→ deep consolidation / replay

weeks-months
→ learned policy update
```

이는 biological timing을 모방하는 것이 아니라
서로 다른 computation의 안정성/비용 요구를 분리하는 방식이다.

## 19.10 Neural Controller Replay

DB 자체는 append-only라 catastrophic forgetting 문제가 작지만,
learned write/router/elicitation controller는 continual-learning 문제를 겪을 수 있다.

따라서 controller training에는:

```text
historical replay
old-policy fixtures
rare domains
correction cases
```

가 필요할 가능성이 높다.

CLS는 memory store보다 learned controller training에
더 직접적인 의미를 가질 수 있다.

## 19.11 Current Decision

| Mechanism | XION status |
|---|---|
| Fast episode capture / slow generalization split | **STRONG ADOPT principle** |
| Two physical stores because brain has two | **REJECT** |
| Interleaved replay | **STRONG ADOPT candidate** |
| Recent-only consolidation | **REJECT likely** |
| Structured / contrastive replay | **NEW HIGH-POTENTIAL** |
| Schema-congruent fast integration | **STRONG CANDIDATE** |
| Schema-incongruent slow path | **STRONG CANDIDATE** |
| Same evidence → parallel representations | **STRONGLY SUPPORTS FORMATTERS** |
| Brain memory categories = formatter schema | **REJECT** |
| Separate-on-write / associate-on-read | **NEW STRONG CANDIDATE** |
| Derived abstraction replaces episodes | **REJECT** |
| Consolidation maturity states | **EXPERIMENT** |
| Replay for neural controller | **HIGH-POTENTIAL** |
| Multi-timescale maintenance | **STRONG SYNTHESIS** |
| Biological sleep/circuit mimicry | **REJECT** |

### Working synthesis

> **XION은 new evidence를 즉시 canonical하게 포착하되 stable generalization은 slower interleaved consolidation으로 갱신하고, schema-congruence에 따라 fast/slow path를 나누며, 동일 evidence가 0..N heterogeneous projections에 기여하도록 허용하는 방향이 유망하다. Write에서는 distinction을 보존하고 Read에서는 association을 확장하는 asymmetry도 강한 후보 원칙이다.**


---

# 20. Gap-Fill Finding 6 — Memory Linking / Associative Retrieval / Event Boundaries

> 상태: **HIGH-IMPACT CROSS-DISCIPLINARY FINDING**
>
> 외부 연구 축: Event Segmentation Theory, Structured Event Memory, Temporal Context / Context Reinstatement, Memory Linking, Integrative Encoding, Hierarchical Retrieval
>
> XION 연결부: retrieval, event projection, reconsolidation scope, Graph/Formatter interaction, local model routing, provenance

## 20.1 Session Is Not an Event

Conversation session / message / day boundary는 storage boundary일 뿐 자연스러운 memory event boundary라고 가정하지 않는다.

하나의 세션에는 여러 event가 있을 수 있고, 여러 세션에 걸쳐 하나의 장기 decision/project episode가 이어질 수도 있다.

따라서 event segmentation은 canonical raw history 위의 **derived / rebuildable projection**으로 본다.

```text
Canonical Evidence
E1 E2 E3 E4 E5 ...

Derived Event Projection
Event A = [E1 E2 E3]
Event B = [E4 E5]
```

## 20.2 Event Boundaries Separate and Bridge

Boundary는 단순 cut point가 아닐 수 있다.

```text
Event A
   ↓
Boundary / Transition
   ↓
Event B
```

Event transition에는 `changed goal`, `changed entity set`, `changed task`, `changed time/location`, `causal bridge`, `explicit discourse transition` 같은 정보가 중요할 수 있다.

특히 personal-history query에서는 `왜 A에서 B로 넘어갔는가`가 event summary 자체보다 중요할 수 있다. 따라서 **Event Transition / Bridge**를 derived representation 후보로 둔다.

## 20.3 Event State Is Richer Than Topic

Event는 단순 `topic=cycling`이 아니라 다음과 같은 working context를 가질 수 있다.

```text
active entities
goal
current task
constraints
time/location
open questions
causal thread
expected next actions
```

이는 event-first retrieval과 boundary detection에 유용할 수 있다.

## 20.4 Boundary Signals

Prediction error / uncertainty는 event-boundary candidate signal이 될 수 있지만 sole rule로 두지 않는다.

Cheap signal 후보:

```text
goal change
entity-set change
task change
causal-thread change
time/location shift
explicit discourse transition
long temporal gap
```

Boundary score 자체를 canonical truth로 저장하지 않는다.

## 20.5 Hierarchical Retrieval

Flat retrieval:

```text
Query
→ chunks
```

대신 다음을 실험한다.

```text
Query
→ Candidate Event / Context
→ Event-local Evidence
→ Cross-event Association if needed
```

Event summary는 answer truth가 아니라 **navigation index / locator** 역할로 사용할 수 있다.

## 20.6 Context Reinstatement

첫 retrieval이 다음 retrieval의 cue가 될 수 있다.

```text
Q0
 ↓
M1
 ↓ context reinstatement
Q1 = Q0 + context(M1)
 ↓
M2 / M3
```

Associative retrieval source 후보:

```text
semantic similarity
same event
event transition
explicit graph edge
shared entity
shared goal
temporal context
shared provenance
```

Graph traversal과 context reinstatement는 서로 다른 complementary retrieval mechanism일 수 있다.

## 20.7 Associative Snowball Must Be Bounded

Unbounded expansion은 topic drift와 token explosion을 만든다.

따라서 associative retrieval은:

```text
typed path
+
query relevance
+
budget
+
stop condition
```

을 가져야 한다. Generic BFS를 default로 두지 않는다.

## 20.8 Retrieval Provenance

Candidate마다 `왜 회수됐는가`를 보존하는 방향이 강하다.

예:

```text
M1 = DIRECT_SEMANTIC
M2 = via SAME_EVENT(M1)
M3 = via EVENT_TRANSITION(M1→B)
M4 = via SHARED_ENTITY(M3)
```

Conceptual provenance 후보:

```text
why_retrieved
association_path
depth
source_anchor
```

Reader가 direct relevance와 associative relevance를 구분할 수 있어야 한다.

## 20.9 Path Semantics > Hop Count

같은 2-hop이라도 의미가 다르다.

```text
Query → Decision Event → explicit decision reason
```

과

```text
Query → same person → unrelated thing the person mentioned
```

을 동일하게 취급하지 않는다.

Expansion strength는 단순 hop count보다 typed path semantics를 더 중요하게 볼 수 있다.

## 20.10 Temporal Proximity Is an Association Prior, Not a Merge Rule

```text
temporally near
→ association prior

temporally near
≠ merge proof
```

시간적 근접성은 같은 event / identity / semantic fact의 증명이 아니다. 이는 `Separate on Write, Associate on Read` 원칙을 강화한다.

## 20.11 Event Membership vs Association

```text
EVENT MEMBERSHIP
Event A = [E1 E2 E3]

ASSOCIATION
A --SHARED_GOAL--> B
A --TEMPORALLY_ADJACENT--> B
B --SHARED_ENTITY--> C
```

Event membership은 더 강한 grouping projection이고, association은 `useful to retrieve together` 관계다. 둘을 같은 edge 의미로 쓰지 않는다.

## 20.12 Retrieval Unit ≠ Context Unit

강한 새 후보:

> **작은 anchor로 정확히 찾고, 그 anchor가 가리키는 raw context를 복원한다.**

예:

```text
retrieval anchor:
Decision: Roubaix purchase postponed

reader context:
original evidence
price discussion
size concern
existing-bike state
later budget decision
```

즉 `RETRIEVAL UNIT ≠ READER CONTEXT UNIT`.

Event summary / atomic fact / entity / hypothesis를 anchor로 쓰고, answer에는 canonical evidence package를 재구성하는 방식이 유망하다.

## 20.13 Event Summary Is Not Canonical

Event segmentation 자체가 나중에 달라질 수 있으므로 `event segmentation v1 / v2`를 canonical raw evidence로부터 rebuild 가능해야 한다. Event summary도 truth replacement가 아니라 derived locator다.

## 20.14 Retrieve Broadly, Mutate Narrowly

Reconsolidation과 결합하면 retrieval neighborhood와 mutation neighborhood를 분리해야 한다.

### Read neighborhood

```text
broad associative candidates
```

### Mutation neighborhood

```text
provenance/dependency-confirmed subset
```

핵심 design maxim:

> **Write conservatively. Retrieve associatively. Mutate by provenance.**

한국어 working form:

> **쓸 때는 분리하고, 읽을 때는 연결하고, 고칠 때는 근거가 확인된 것만 건드린다.**

## 20.15 Multi-View Neighborhood

하나의 target memory 주변은 하나의 물리적 원이 아니다.

```text
justification neighborhood
event neighborhood
semantic neighborhood
temporal neighborhood
task/goal neighborhood
```

Retrieval, consolidation, reconsolidation 등 operation마다 필요한 neighborhood view가 다를 수 있다.

## 20.16 Association Levels

### Level 1 — Deterministic / Structural
`same event`, `adjacent event`, `same canonical source`, `explicit decision membership`

### Level 2 — Extracted Semantic
`shared goal`, `explicit causal relation`, `same project/person`

### Level 3 — Inferred Association
`probable relation`, `latent common constraint`, `possible causal bridge`

Reader expansion은 1→2→3까지 갈 수 있지만, mutation scope는 보통 Level 1 + 일부 verified Level 2로 제한하는 방향이 유망하다.

## 20.17 Conservative Event Segmentation

Event segmentation에도 `FALSE_SPLIT / FALSE_MERGE`가 있다.

Working hypothesis:

> **False merge가 false split보다 더 위험할 가능성이 높다.**

False split은 read-time association으로 bridge할 수 있지만, false merge는 unrelated evidence를 같은 context로 보여 잘못된 causal narrative를 만들 수 있다.

애매할 때는:

```text
Event A
Event B
link = POSSIBLY_CONTINUOUS
```

처럼 분리 + ambiguity bridge를 유지하는 정책을 실험한다.

## 20.18 Boundary-Triggered Micro-Consolidation

Event가 닫힐 때 cheap derived maintenance를 수행하는 후보:

```text
event closes
→ event summary candidate
→ decision outcome candidate
→ unresolved fork candidate
```

이는 nightly/background deep consolidation과 별개로 multi-timescale maintenance를 구성할 수 있다. Boundary detection은 local SLM benchmark workload로도 적합하다.

## 20.19 Current Decision

| Mechanism | XION status |
|---|---|
| Session = event | **REJECT** |
| Event segmentation as derived projection | **STRONG ADOPT candidate** |
| Prediction-error boundary | **STRONG SIGNAL, not sole rule** |
| Prediction-uncertainty boundary | **EXPERIMENT** |
| Hierarchical events | **HIGH-POTENTIAL** |
| Event transitions / bridges | **NEW STRONG CANDIDATE** |
| Boundary-triggered micro-consolidation | **HIGH-POTENTIAL** |
| Temporal proximity as associative prior | **ADOPT as weak signal** |
| Temporal proximity as merge criterion | **REJECT** |
| Context reinstatement retrieval | **VERY HIGH-POTENTIAL** |
| Unbounded associative cascade | **REJECT** |
| Typed / budgeted associative expansion | **STRONG CANDIDATE** |
| Retrieval provenance / path | **NEW STRONG CANDIDATE** |
| Retrieval unit = context unit requirement | **REJECT** |
| Anchor → reconstruct raw context | **VERY STRONG CANDIDATE** |
| Event summary as canonical truth | **REJECT** |
| Broad retrieval neighborhood | **ADOPT candidate** |
| Broad mutation neighborhood | **REJECT** |
| Retrieve broadly, mutate narrowly | **NEW STRONG PRINCIPLE** |

### Working synthesis

> **XION의 retrieval은 flat chunk search보다 event/context anchor를 먼저 찾고, 그 anchor가 encoding context와 typed associations를 되살려 raw evidence package를 복원하는 계층적 과정이 될 가능성이 높다. 다만 association은 truth가 아니며, write-time grouping과 mutation scope는 계속 보수적으로 유지한다.**


---

# 21. Gap-Fill Finding 7 — Memory Reconsolidation

> 상태: **HIGH-IMPACT CROSS-DISCIPLINARY FINDING**
>
> 외부 연구 축: Memory Reconsolidation, Prediction Error, Retrieval Practice, Memory Updating, Boundary Conditions
>
> XION 연결부: Prediction loop, Fork, Justification DAG, maintenance scheduler, replay, mutation safety

## 21.1 Retrieval Is Not Permission to Rewrite

Memory가 retrieval되었다는 사실만으로 그 memory를 rewrite하거나 reinforce하지 않는다.

```text
RETRIEVED
≠
CORRECT
≠
USEFUL
≠
WRITE_PERMISSION
```

기본은 read-only activation이다.

## 21.2 Mismatch / Updating Information as Maintenance Trigger

새 evidence가 기존 derived memory가 기대한 것과 의미 있게 어긋날 때
그 memory를 reconsolidation candidate로 연다.

```text
Derived Memory / Hypothesis
        ↓
Discriminating Prediction
        ↓
New Relevant Evidence
        ↓
meaningful mismatch
        ↓
LOCAL RECONSOLIDATION CANDIDATE
```

Prediction은 단순 score가 아니라
maintenance interrupt 역할을 할 수 있다.

## 21.3 Update vs New Trace

Mismatch가 있다고 항상 기존 memory를 덮어쓰지 않는다.

Working routing:

```text
MATCH
→ no rewrite / possible support

COMPATIBLE NOVELTY
→ local integration

MEANINGFUL MISMATCH
→ local reconsolidation

LARGE / OUT-OF-SCHEMA MISMATCH
→ preserve new episode
→ Fork / world-update candidate
```

특히 큰 mismatch는 기존 trace destruction보다
새 trace + ambiguity preservation이 더 안전할 수 있다.

## 21.4 Prediction Error Is a Change-Classification Trigger

Prediction error는 곧바로 overwrite command가 아니다.

```text
new mismatch
      ↓
classify change semantics
      ├─ additional context
      ├─ interpretation revision
      ├─ correction
      ├─ world update
      └─ unresolved / fork
```

이는 기존의 `WORLD_UPDATE ≠ CORRECTION` 계약을 강화한다.

## 21.5 Schema Gating and Reconsolidation Gating May Be One Router

CLS의 schema-congruence와 reconsolidation의 mismatch signal은
같은 update-router의 complementary features일 수 있다.

```text
congruent
→ cheap integrate / no-op

informative mismatch
→ local reconsolidation

structurally novel
→ preserve episode + Fork / new schema
```

## 21.6 Canonical Replay, Not Summary-of-Summary

High-impact reconsolidation은 derived summary만 보고 수행하지 않는다.

Bad:

```text
old summary
+
new summary
→ new summary
```

Preferred:

```text
old derived state
+
ORIGINAL supporting evidence
+
new canonical evidence
+
corrections
+
exceptions
→ revised derived state
```

이는 progressive hallucination / summary drift를 줄이는 강한 후보 계약이다.

## 21.7 Reconsolidation Scope by Provenance / Dependency Reachability

Local scope는 임의의 graph-hop radius가 아니라
실제 dependency relation으로 결정하는 방향이 유망하다.

```text
target hypothesis
→ justifications
→ counterevidence
→ dependent projections
```

Derived state가 여러 support path를 갖는 경우
한 support가 깨져도 다른 independent support가 살아 있으면
전체 state를 invalidation하지 않는다.

## 21.8 Reconsolidation as a Transaction

Software에서는 biological time window를 모방하지 않고
revision을 bounded transaction으로 번역한다.

Conceptual job:

```text
trigger
scope
input watermark
canonical replay set
revision proposal
validation
atomic commit
receipt
```

실패하면 old derived state를 유지한다.

```text
old stable projection
→ candidate revision
→ validate
→ atomic swap
```

Canonical evidence는 그대로 남는다.

## 21.9 Sparse Maintenance

Global periodic rewrite를 default로 두지 않는다.

```text
activation
+
meaningful mismatch / correction
→ sparse local maintenance
```

이 방식은:

```text
compute cost ↓
mutation surface ↓
hallucination opportunities ↓
```

를 동시에 줄일 가능성이 있다.

## 21.10 Retrieval Heat ≠ Revision Priority

많이 retrieval된 memory가 자주 rewrite될 필요는 없다.

```text
frequently retrieved + no mismatch
→ stable
```

반대로:

```text
rarely retrieved + explicit correction
→ high-priority revision
```

Maintenance priority는 retrieval count보다:

```text
mismatch
explicit correction
dependency impact
current decision relevance
```

를 더 중요하게 볼 수 있다.

## 21.11 Reinforcement Requires Downstream Evidence

Access 자체로 automatic reinforcement하지 않는다.

Possible support signals:

```text
explicit reuse
explicit confirmation
successful discriminating prediction
independent new evidence
decision relevance
```

Retrieval-practice-like popularity feedback loop를 software에서 재현하지 않는다.

## 21.12 Epistemic Maturity > Wall-Clock Age

Biological memory age/strength를 그대로 번역하지 않는다.

Software revision resistance는 다음과 같은 epistemic properties를 더 잘 반영할 수 있다.

```text
independent evidence support
explicit confirmations
correction history
scope stability
```

단, explicit correction은 이러한 maturity보다 우선한다.

## 21.13 Reconsolidation Queue

Realtime strong rewrite가 필요하지 않은 경우:

```text
Mismatch detected
→ RECONSOLIDATION_CANDIDATE event
→ temporary downgrade/suppress if needed
→ background Librarian revision
```

현재 decision에 직접 영향을 주는 high-impact case는 즉시 처리할 수 있다.

## 21.14 Memory Prediction Loop — Updated

```text
Canonical Evidence
        ↓
Hypothesis / Derived Memory
        ↓
optional discriminating Prediction
        ↓
New Relevant Evidence
        ↓
Compare expectation ↔ observation
        │
        ├─ MATCH
        │    → no rewrite / possible support
        │
        ├─ INFORMATIVE MISMATCH
        │    → local reconsolidation
        │
        └─ LARGE / OUT-OF-SCHEMA
             → preserve new episode
             → Fork / world-update candidate
                     ↓
           Structured Evidence Replay
                     ↓
              Belief Revision
                     ↓
          versioned derived projection
```

## 21.15 Current Decision

| Mechanism | XION status |
|---|---|
| Every retrieval → rewrite | **REJECT** |
| Retrieval/activation as candidate gate | **ADOPT concept** |
| Prediction error as maintenance trigger | **VERY HIGH-POTENTIAL** |
| Activation-local reconsolidation | **STRONG EXPERIMENT** |
| Global periodic rewrite | **REJECT as default** |
| Compatible novelty → integrate | **STRONG CANDIDATE** |
| Meaningful mismatch → local revision | **STRONG CANDIDATE** |
| Large/out-of-schema mismatch → new trace/Fork | **VERY STRONG CANDIDATE** |
| Biological numeric PE threshold/window | **REJECT** |
| Explicit correction → privileged revision | **STRONG ADOPT** |
| Reconsolidate from derived summary only | **REJECT likely** |
| Canonical evidence replay | **STRONG ADOPT candidate** |
| Justification-reachability scope | **STRONG CANDIDATE** |
| Retrieval count = truth/usefulness | **REJECT** |
| Access-based automatic reinforcement | **REJECT likely** |
| Reconsolidation transaction/receipt | **NEW STRONG CANDIDATE** |
| Wall-clock memory strength | **REJECT as software translation** |
| Epistemic maturity as revision resistance | **STRONG CANDIDATE** |

### Working synthesis

> **XION은 memory를 retrieve했다고 다시 쓰지 않는다. Relevant evidence가 기존 expectation과 의미 있게 충돌할 때만 해당 derived state와 provenance-confirmed dependents를 열고, canonical support/counterevidence를 replay해 최소 수정 또는 Fork를 만든 뒤 atomic하게 restabilize하는 방향이 유망하다.**


---

# 22. Gap-Fill Finding 8 — Procedural / Skill Memory

> 상태: **HIGH-IMPACT CROSS-DISCIPLINARY FINDING**
>
> 외부 연구 축: Procedural Memory, ACT-R Production Compilation, Hierarchical RL / Options, Skill Libraries, Transfer / Negative Transfer
>
> XION 연결부: agent controller, local-model support, tool use, personalization policy, governance

## 22.1 Declarative Memory ≠ Procedural Memory

XION이 `무엇이 사실/관련인가`를 기억하는 것과
`이 상황에서 어떻게 행동해야 하는가`를 기억하는 것은 분리한다.

```text
Declarative Memory
→ tells the Reader what is relevant / supported

Procedural Memory
→ tells the Agent how to operate
```

따라서 Procedural Memory는 기존 Formatter 하나를 추가하는 것보다
별도의 **Action / Procedure Plane**으로 보는 방향이 강하다.

## 22.2 Shared Evidence, Different Downstream Consumer

```text
                    Canonical Evidence Ledger
                             │
           ┌─────────────────┴─────────────────┐
           │                                   │
           ▼                                   ▼
  Declarative Projections              Procedural Projections
  Facts / Events / Graph               Skills / Workflows
  Ranking / Timeline                   Interaction Policies
  Decision / Relationship              Tool Procedures
           │                                   │
           ▼                                   ▼
         Reader                         Agent Controller
```

두 계층 모두 canonical evidence를 source로 사용할 수 있지만
derived output의 소비자가 다르다.

## 22.3 Procedural Compilation

Repeated successful reasoning / workflow를
항상 처음부터 다시 reasoning하지 않고
재사용 가능한 procedure candidate로 compile할 수 있다.

```text
repeated successful episodes
→ candidate procedure
→ applicability + steps + termination + verification
→ transfer / replay validation
→ active skill
```

그러나 한 번 성공한 episode를 즉시 active skill로 승격하지 않는다.

## 22.4 Candidate Skill Contract

Exact schema는 아직 열려 있지만 최소 conceptual contract는:

```text
Skill
├─ Applicability / Trigger
├─ Preconditions
├─ Goal
├─ Procedure
├─ Termination
└─ Verification
```

추가 연구 후보:

```text
domain / task-family scope
known counterexamples
tested contexts
model/backend compatibility
side effects
permission requirements
```

핵심은 `WHAT TO DO`뿐 아니라
`WHEN TO INVOKE`, `WHEN TO STOP`, `HOW TO VERIFY`다.

## 22.5 Compile Subroutines, Not Personalities

거대한 whole-task / whole-personality skill보다
재사용 가능한 subgoal 단위 procedure가 유망하다.

```text
bad candidate:
"How to handle every XION design task"

better candidates:
inspect-current-contract
resolve-entity-ambiguity
verify-regression-test
build-implementation-handoff
```

Granularity는 step count가 아니라
재사용 가능한 subgoal / initiation / termination으로 평가한다.

## 22.6 Sparse Skill Routing

Skill library가 커진다고 항상 좋아지지 않는다.

```text
Current Task
→ 0..N Candidate Skills
```

를 검색할 수 있지만
execution gate는 declarative retrieval보다 더 보수적이어야 한다.

> **Retrieve broadly, act narrowly.**

잘못된 skill retrieval은 단순 context noise가 아니라
잘못된 행동으로 이어질 수 있기 때문이다.

## 22.7 Skill Reconsolidation

```text
skill invoked
≠
skill rewrite
```

다음과 같은 signal이 있을 때만 skill revision candidate를 연다.

```text
verification failure
explicit user correction
meaningful context mismatch
negative transfer
environment / capability change
```

## 22.8 Skill Is Derived; Episodes Stay Canonical

Canonical candidate sources:

```text
explicit user instruction
execution episode
tool call
result
verification outcome
correction
```

Derived:

```text
Skill / Workflow / Procedure
```

Skill abstraction이 생겼다고 supporting episodes를 삭제하지 않는다.

> **Abstraction does not replace experience.**

## 22.9 Opportunity-Adjusted Skill Evaluation

```text
used often ≠ good
not used ≠ useless
```

Skill quality는 단순 invocation count보다:

```text
relevant opportunities
correct invocation
verified success
negative transfer
user correction
aborted execution
```

등을 분리해서 평가해야 한다.

Calendar age만으로 skill을 retire하지 않는다.

## 22.10 Governance Cannot Be Compiled Away

Low-risk procedure는 automaticity를 높일 수 있지만
governance / authorization은 skill이 제거하거나 재정의할 수 없다.

> **Skill can automate HOW.  
> Skill must not silently redefine WHETHER IT IS ALLOWED.**

Conceptual authority layers:

```text
Governance / Hard Constraints
        ↓
Explicit User Procedures
        ↓
Validated Learned Skills
        ↓
Candidate Heuristics
```

정확한 conflict-arbitration rule은 아직 OPEN이다.

## 22.11 Explicit Textual Skills as Default

현재 기본 방향은:

```text
auditable
versioned
source-grounded
reversible
```

한 explicit skill representation이다.

Neural activation / implicit procedural memory는
나중의 hybrid experiment로 DEFER한다.

## 22.12 Local Model Interaction

Procedural support가 작은 local model의 usable capability를 높일 수 있는지
추가 실험 가치가 있다.

후보 축:

```text
task
× model size
× no-skill / curated-skill
```

이는 기존 Local / Hybrid / Cloud 연구의 보조 실험 후보이며
현재 R3의 닫힌 첫 실험 계약을 바꾸지 않는다.

## 22.13 Current Decision

| Mechanism | XION status |
|---|---|
| Declarative = Procedural memory | **REJECT** |
| Separate procedural/action-policy plane | **VERY STRONG CANDIDATE** |
| Episode → automatic active skill | **REJECT** |
| Episode → candidate → verify → promote | **STRONG CANDIDATE** |
| Procedural compilation | **STRONG ADOPT principle** |
| Applicability + procedure + termination + verification | **VERY STRONG CANDIDATE** |
| Whole-task monolithic skills | **REJECT likely** |
| Small composable subtask skills | **STRONG CANDIDATE** |
| More skills = better | **REJECT** |
| Sparse skill routing | **STRONG CANDIDATE** |
| Retrieve broadly → auto execute | **REJECT** |
| Retrieve broadly, act narrowly | **NEW STRONG CANDIDATE** |
| Every use → skill rewrite | **REJECT** |
| Failure/mismatch-gated revision | **STRONG CANDIDATE** |
| Delete episodes after compilation | **REJECT** |
| Explicit user instruction as source evidence | **STRONG ADOPT** |
| Compiled skill as canonical truth | **REJECT** |
| Explicit auditable skill | **STRONG DEFAULT** |
| Neural procedural memory | **DEFER / EXPERIMENT** |
| Usage frequency = skill quality | **REJECT** |
| Opportunity-adjusted skill evaluation | **STRONG CANDIDATE** |
| Governance compiled into habit | **HARD REJECT** |

---

# 23. Extension — User-Taught / Registered Skills

> 상태: **NEW STRONG PRODUCT + ARCHITECTURE CANDIDATE**
>
> 핵심 아이디어: 사용자가 이미 구현했거나 직접 정의한 행동 절차를 XION에게
> **skill로 명시 등록 / 가르칠 수 있어야 한다.**

## 23.1 This Is Not Only a UI Feature

사용자-facing 등록 화면 자체는 UI concern이지만,
`가르친 skill이 무엇이며 어떻게 실행되는가`는
Procedural Memory / Capability Runtime의 핵심 계약이다.

```text
CORE / PROCEDURAL CONTRACT
→ skill identity
→ applicability
→ inputs / outputs
→ executor reference
→ permissions / safety
→ termination / verification
→ provenance / version

LATER UI
→ create / edit form
→ test / dry-run
→ permission review
→ enable / disable
→ logs / history
```

즉 UI는 나중에 설계하되
**teach/register capability 자체는 지금 procedural architecture에 포함한다.**

## 23.2 Registered Skill Does Not Own the Algorithm

예를 들어 사용자가 로봇팔용 `pick_and_place` 알고리즘을 직접 구현했다고 하자.

XION memory가 그 로봇 제어 알고리즘의 source of truth가 될 필요는 없다.

```text
Robot Controller / Code
→ executable algorithm source of truth

XION Skill Registry
→ how / when XION may invoke that capability
```

Skill은 실행 코드 자체를 복제하기보다
versioned executor/capability를 참조한다.

## 23.3 Example — Robot Arm Skill

Conceptual example:

```text
Skill:
Move Object With Robot Arm

Source:
USER_REGISTERED

Applicability:
physical object relocation task

Inputs:
object
source_location
target_location

Preconditions:
robot online
target reachable
safety checks satisfied

Executor:
robot-arm://pick_and_place@<version>

Termination:
object is at target or execution aborts

Verification:
vision / controller result confirms final state

Side Effects:
physical-world actuation

Permission / Governance:
must satisfy physical-action safety policy
```

이 schema 자체는 확정이 아니며
핵심 책임 경계를 설명하기 위한 예다.

## 23.4 Explicit Teaching Is a Distinct Acquisition Path

Skill acquisition source를 최소 conceptual하게 구분한다.

```text
BUILT_IN / SYSTEM
USER_REGISTERED / USER_TAUGHT
LEARNED_FROM_EPISODES
```

`USER_REGISTERED`는 explicit source evidence이므로
learned heuristic보다 강한 provenance를 갖지만
governance / safety를 우회하지 않는다.

## 23.5 Teach ≠ Trust Everything Automatically

```text
skill exists
≠
skill applicable now
≠
skill authorized now
```

특히 physical actuator, external write, payment, trading 등
side-effectful capability는 별도의 hard governance를 유지한다.

## 23.6 Skill Versioning Matters

외부 algorithm이 바뀌면
기존 skill의 behavior assumption이 깨질 수 있다.

Candidate provenance:

```text
executor_id
executor_version / content hash
registered_at
registered_by
validation receipt
known compatibility
```

Backend version change는 skill revalidation / dirtying trigger가 될 수 있다.

## 23.7 Learned Procedure and External Capability Can Share an Invocation Contract

```text
Textual / Learned Skill
→ LLM follows procedure

External / Registered Skill
→ controller invokes executable capability
```

공통 부분:

```text
applicability
inputs
preconditions
termination
verification
permissions
provenance
```

다른 부분은 주로 `execution backend`다.

이렇게 하면 로봇, 스마트홈, 코드 실행, 외부 agent 등을
같은 procedural framework 아래 연결할 수 있다.

## 23.8 Teaching by Demonstration Is Separate Research

사용자가 algorithm / workflow를 명시 등록하는 것과
여러 실행 demonstration을 보고 XION이 skill을 자동 induction하는 것은 다르다.

```text
manual registration
→ relatively straightforward product capability

learning from demonstration
→ procedural-learning research problem
```

후자는 episode→skill abstraction / validation 연구와 함께 다룬다.

## 23.9 Working Principle

> **Memory remembers the procedure contract; the capability runtime owns execution.**

또는:

> **XION should be teachable without making memory the source of truth for external machinery.**


---

# 24. Gap-Fill Finding 9 — Prospective Memory / Intentions / Reminders

> 상태: **HIGH-IMPACT CROSS-DISCIPLINARY FINDING**
>
> 외부 연구 축: Prospective Memory, Event-Based / Time-Based Intentions, Implementation Intentions, Contextual Monitoring, Intention Offloading, Completion Deactivation
>
> XION 연결부: task/reminder DB, event/context routing, proactive intervention, procedural memory, governance

## 24.1 Prospective Memory Is Not an Ordinary Future Fact

Prospective memory는 단순히 미래에 관한 정보를 저장하는 것이 아니라 **미래 cue가 나타났을 때 다시 관련성을 획득해야 하는 intention**이다.

```text
WHAT
→ intended content / action

WHEN / CUE
→ trigger condition

DO
→ execution / intervention
```

`무엇을 해야 하는지`와 `언제 그것을 다시 활성화해야 하는지`를 같은 의미로 취급하지 않는다.

## 24.2 Current Galpi Task / Reminder Contract Is Reinforced

현재 operational contract의 핵심은 그대로 유지한다.

```text
task / reminder operational state
→ SQLite source of truth

completed history
→ still referenceable

live reminder / execution trigger
→ separately deactivated
```

Memory research가 현재 task/reminder source of truth를 graph/projection으로 대체하지 않는다.

## 24.3 Time-Based vs Event-Based Prospective Intentions

```text
TIME-BASED
"Tomorrow at 15:00, remind me."
→ deterministic scheduler

EVENT / CONTEXT-BASED
"Next time we discuss AI-PC sponsorship,
surface the experiment brief."
→ future context/event cue
```

Candidate trigger tiers:

```text
DETERMINISTIC
exact time / exact system event

STRUCTURAL
specific entity / event / state

SEMANTIC
conversation context / fuzzy condition

INFERRED
"this is probably the right moment"
```

아래 tier로 갈수록 automatic execution authority를 낮추는 방향이 강하다.

## 24.4 Context-Gated Prospective Monitoring

모든 active intention을 매 turn마다 전부 검사하지 않는다.

```text
All active intentions
        ↓
cheap context / event routing
        ↓
relevant subset becomes ARMED
        ↓
specific cue evaluation
        ↓
selective intervention
```

핵심 후보:

> **Monitor intensively only when the current context makes the intention plausibly relevant.**

## 24.5 If-Cue → Then-Action Representation

Implementation-intention style의 표현은 XION prospective state에도 자연스럽다.

```text
IF <future cue>
THEN <intended intervention/action>
```

다만 strong cue-action association은 completion 후 commission error를 만들 수 있으므로 deactivation이 필수다.

## 24.6 Completion Deactivation

강한 핵심 원칙:

> **Intention completion must deactivate future execution without erasing historical memory.**

```text
historical memory retention
≠
active trigger retention
```

완료된 intention의 history는 남기되 future execution edge는 죽인다.

## 24.7 Intention Detection ≠ Commitment Creation

```text
future-oriented thought
possible goal
hypothetical plan
≠
confirmed commitment
```

사용자의 미래지향적 발화를 자동 canonical task로 승격하지 않는다.

현재의 `candidate → explicit confirmation → commit` 계약을 강하게 유지한다.

## 24.8 External Offloading Is a Feature, Not a Failure

장기 task/reminder는 LLM internal context에 맡기지 않는다.

```text
durable task state
→ external operational store

LLM
→ receives bounded relevant state when needed
```

Prospective reliability는 external prospective-memory infrastructure의 문제로 본다.

## 24.9 User-Facing vs Agent-Internal Prospective State

```text
USER-FACING
"내일 3시에 알려줘"
→ XION → USER

AGENT-INTERNAL
"이 workflow의 다음 단계에서는 provenance를 다시 확인해야 함"
→ MEMORY / CONTROL → XION AGENT
```

두 번째는 사용자를 interrupt하지 않고도 agent 내부에서 selective reminder로 동작할 수 있다.

## 24.10 Prediction ≠ Prospective Intention ≠ Procedure

```text
Prediction
→ what may happen

Prospective Intention
→ what should/must become relevant when cue occurs

Procedure
→ how to act once activated
```

세 종류를 하나의 memory type으로 합치지 않는다.

## 24.11 Commitment State May Be Operational, Not Derived

Working architecture:

```text
                   CANONICAL EXPERIENCE
                Evidence + Outcome Events
                         │
        ┌────────────────┼────────────────┐
        │                │                │
        ▼                ▼                ▼
 DECLARATIVE        PROCEDURAL      COMMITMENT STATE
 MEMORY             MEMORY          (operational)
 what / why         how             what remains to do
        │                │                │
        ▼                ▼                ▼
     READER          CONTROLLER      TRIGGER ENGINE
        │                │                │
        └──────────────┬─┴────────────────┘
                       ▼
                  CURRENT CONTEXT
                       │
                       ▼
                  GOVERNANCE
                       │
                       ▼
                 ANSWER / ACTION
```

현재 확정된 task/reminder DB는 operational source of truth로 남는다.
Prospective research는 `언제 relevant해지는가`와 proactive intervention policy를 추가로 연구한다.

## 24.12 Selective Intervention

Prospective quality의 목표는 단순 recall 최대화가 아니다.

```text
OMISSION
→ 해야 할 때 놓침

COMMISSION
→ 끝난 일을 다시 실행/알림

FALSE TRIGGER
→ cue가 아닌데 끼어듦

LATE TRIGGER
→ 너무 늦게 활성화

INTERRUPTION COST
→ 맞는 reminder지만 현재 ongoing task를 과도하게 방해
```

따라서 `always surface all active intentions`는 default로 두지 않는다.

## 24.13 Current Decision

| Mechanism | XION status |
|---|---|
| Future intention = ordinary memory fact | **REJECT** |
| What / cue / execution separation | **VERY STRONG ADOPT principle** |
| Current task/reminder DB → memory graph replacement | **REJECT** |
| Operational task/reminder source of truth | **STRONGLY REINFORCED** |
| Time-based deterministic scheduler | **STRONGLY REINFORCED** |
| Event/context-based prospective trigger | **VERY HIGH-POTENTIAL** |
| Always monitor all intentions | **REJECT likely** |
| Context-gated prospective monitoring | **NEW VERY STRONG CANDIDATE** |
| If-cue → then-action representation | **STRONG CANDIDATE** |
| Strong cue association without deactivation | **DANGEROUS** |
| Completion deactivates execution, history preserved | **VERY STRONG ADOPT** |
| Future-oriented remark → automatic task | **HARD REJECT** |
| Candidate → confirmation → commitment | **STRONGLY REINFORCED** |
| User-facing prospective memory | **ADOPT existing task domain** |
| Agent-internal prospective obligation | **NEW HIGH-POTENTIAL** |
| Prediction = prospective intention | **REJECT** |
| Selective proactive intervention | **VERY HIGH-POTENTIAL** |
| LLM alone as durable prospective memory | **REJECT** |
| Recall maximization as sole objective | **REJECT** |
| Omission + commission + interruption evaluation | **STRONG CANDIDATE** |

### Working synthesis

> **Past memory tells XION what happened; procedural memory tells it how to act; prospective memory tells it what must become relevant again, and under what future cue.**

Software working principle:

> **Persist the intention, index the cue, monitor only when relevant, intervene selectively, and deactivate execution immediately when the intention is finished.**


---

# 25. Gap-Fill Finding 10 — Relationship / Identity Resolution / Closeness

> 상태: **SHALLOW GAP-FILL / ARCHITECTURE REINFORCEMENT**
>
> 핵심 결론: 별도 Social Memory subsystem은 필요하지 않다. 다만 사람/개체 identity는 잘못 merge될 때 downstream contamination이 커서 **강한 fail-close + active elicitation**을 받는다.

## 25.1 Social Memory Does Not Need a Separate Engine

기존 구조로 대부분 처리 가능하다.

```text
Entity
→ who / what the referent is

Relationship
→ how entities relate

Event
→ what they experienced together

Hypothesis
→ revisable interpretation about traits / intentions / relationship state
```

사람만을 위한 별도 truth engine은 만들지 않는다.

## 25.2 Name Is an Alias, Not an Identity

강한 원칙:

> **Name is an alias, not an identity.**

```text
Person P17-A
aliases = ["민수", "김민수"]

Person P17-B
aliases = ["민수"]
```

한 alias가 여러 entity를 가리킬 수 있고,
한 entity가 여러 alias를 가질 수 있다.

이 원칙은 사람뿐 아니라 로봇, 프로젝트, 장치, 물건 등
이름만으로 고유 식별되지 않는 object에도 일반화한다.

## 25.3 Identity Collision Is a High-Priority Ambiguity

다음과 같은 경우를 ordinary ambiguity보다 강하게 처리한다.

```text
same alias clearly refers to multiple entities
existing facts become mutually incompatible
new evidence implies prior entity split
downstream memories may already be cross-contaminated
identity choice changes current answer/action
```

Working policy:

```text
identity collision detected
→ FAIL CLOSED
→ stop unsafe merge
→ preserve new evidence
→ active repair
```

질문 interruption cost보다 wrong-merge contamination cost가 훨씬 큰 경우가 많기 때문이다.

## 25.4 Active Identity Repair

Identity collision이 발견되면
기존 evidence를 먼저 local structure로 묶고,
사용자에게 최소한의 discriminative questions를 한다.

```text
all evidence assigned to entity
        ↓
local clustering
- same event
- temporal adjacency
- explicit descriptors
- relationship cues
- provenance / co-occurrence
        ↓
identify unresolved cuts
        ↓
ask discriminative questions
        ↓
split / merge / remain ambiguous
        ↓
reassign derived entity links
        ↓
rebuild downstream projections
```

예:

```text
Cluster A
- 대학 친구
- 자전거
- 자주 만남

Cluster B
- 군대
- 부대 이야기
- 서울 거주
```

이면 모든 fact를 하나씩 묻지 않고:

> “자전거 같이 타는 민수랑 군대에서 알게 된 민수는 다른 사람이야?”

처럼 cluster-level 질문을 먼저 한다.

## 25.5 Identity Ambiguity May Justify Persistent Follow-Up

보통 Active Elicitation은 interruption cost를 아끼지만,
identity contamination 가능성이 확인되면 더 적극적으로 질문할 수 있다.

사용자가 split을 확인하면:

```text
"A 관련 민수는 누구?"
"C 관련 민수는 A민수?"
"D는?"
```

처럼 필요한 unresolved evidence만 추가 확인한다.

이 경우 여러 번의 질문은 허용 가능한 비용으로 본다.

## 25.6 Unknown Is a Valid Identity State

사용자도 과거 mention이 어느 entity였는지 기억하지 못할 수 있다.

```text
identity_assignment
= AMBIGUOUS(P17-A, P17-B)
```

를 허용한다.

억지로 하나를 고르지 않는다.

## 25.7 Canonical Evidence Survives Identity Repair

Identity split은 canonical evidence rewrite가 아니다.

```text
before:
E1 → P17
E2 → P17
E3 → P17

after:
E1 → P17-A
E2 → P17-A
E3 → P17-B
```

원 utterance / event는 그대로 두고
derived identity assignment와 downstream projections를 재구성한다.

이는 Event Ledger + rebuildable projection 원칙과 일치한다.

## 25.8 Closeness Belongs to the Relationship, Not the Entity

`민수 자체의 intimacy=0.8` 같은 모델은 피한다.

친밀도는 본질적으로:

```text
USER ↔ PERSON
```

관계의 상태다.

Conceptual placement:

```text
Entity
P17 = 민수

Relationship(USER, P17)
relationship_type = friend
closeness = CLOSE
supporting_evidence = [...]
temporal_validity = ...
```

따라서:

> **Closeness is a relationship property, not an identity property.**

## 25.9 Closeness ≠ Conversational Salience

다음을 분리한다.

```text
SOCIAL CLOSENESS
→ 실제 관계상 얼마나 가까운가

CONVERSATIONAL / REFERENCE SALIENCE
→ 현재 대화에서 기본 referent로 얼마나 그럴듯한가
```

친한 가족은 거의 언급되지 않을 수 있고,
덜 친한 연구 동료는 매일 언급될 수 있다.

Reference salience는 영구 truth field보다
runtime derived prior로 계산하는 방향이 유망하다.

Candidate signals:

```text
current context
event membership
relationship closeness
mention recency / frequency
active shared project
explicit descriptors
```

## 25.10 Closeness Is a Prior, Not Identity Proof

예:

```text
민수 A
- close friend
- frequently mentioned

민수 B
- old coworker
- rarely mentioned
```

사용자가 문맥 없이 “민수랑 밥 먹었어”라고 하면
A를 더 높은 candidate로 둘 수 있다.

하지만:

```text
closeness
→ candidate ranking prior

closeness
≠ merge proof
```

명시적 context evidence가 반대라면 context가 우선하고,
둘 다 plausible하면 질문한다.

## 25.11 Closeness Can Reduce Elicitation Cost

Identity split 시 cluster를 사용자에게 설명할 때
closeness / relationship features가 human-legible discriminator가 된다.

예:

> “평소 자주 얘기하고 자전거 같이 타는 민수랑, 군대에서 알게 된 민수는 다른 사람이야?”

이렇게 하면 co-occurrence/provenance로 이미 묶인 많은 evidence를
한 번의 질문으로 partition할 수 있다.

즉 closeness는 personalization뿐 아니라
**identity-repair question compression feature**로도 유용하다.

## 25.12 Relationship State Must Remain Revisable

친밀도, 관계 유형, 사람에 대한 trait impression은
행동 빈도 하나로 자동 truth화하지 않는다.

Evidence strength 예:

```text
explicit user statement about relationship
> repeated context-consistent interaction
> frequency / mention pattern
```

사람의 성격/의도 같은 interpretation은
Fact가 아니라 revisable Hypothesis로 유지한다.

## 25.13 Current Decision

| Mechanism | XION status |
|---|---|
| Separate Social Memory subsystem | **REJECT / unnecessary** |
| Entity + Relationship + Event + Hypothesis reuse | **ADOPT** |
| Name as identity key | **HARD REJECT** |
| Alias-many-to-many identity mapping | **STRONG ADOPT** |
| Identity collision → fail-close | **VERY STRONG ADOPT** |
| Identity collision → active elicitation | **VERY STRONG ADOPT** |
| Ask every fact individually | **REJECT** |
| Cluster evidence before asking | **STRONG CANDIDATE** |
| Unknown/ambiguous identity assignment | **ADOPT** |
| Rewrite canonical evidence during split | **REJECT** |
| Reassign derived identity projections | **ADOPT** |
| Closeness inside Entity object | **REJECT** |
| Closeness on User↔Person relationship | **STRONG CANDIDATE** |
| Closeness = reference identity proof | **REJECT** |
| Closeness as runtime reference prior | **STRONG CANDIDATE** |
| Closeness = conversational salience | **REJECT** |
| Derived runtime reference salience | **STRONG CANDIDATE** |
| Trait / social impression as hard fact | **REJECT** |

### Working synthesis

> **사람의 이름은 identity가 아니라 alias다. Identity collision이 발견되면 새 evidence의 unsafe merge를 멈추고, event/provenance/relationship 구조로 evidence를 먼저 clustering한 뒤 최소한의 discriminative 질문으로 split을 복구한다. 친밀도는 entity 자체가 아니라 사용자와 그 사람 사이의 relationship state이며, 평소 reference resolution에는 prior로 쓰되 identity proof로 사용하지 않는다.**


---

# 26. Gap-Fill Finding 11 — Core / Working Memory

> 상태: **SHALLOW GAP-FILL / IMPORTANT ARCHITECTURAL BOUNDARY**
>
> 핵심 결정: **Tiny Stable User Core + Dynamic Working Set**를 채택 후보로 둔다. Rich always-visible user profile은 User Model과 역할이 겹치므로 기본적으로 거부한다.

## 26.1 Core Memory and Working Memory Are Different Problems

두 개념을 분리한다.

```text
CORE
→ 무엇을 거의 모든 interaction에서 항상 보여줘도 안전한가?

WORKING MEMORY
→ 지금 reasoning에 실제로 필요한 정보는 무엇인가?
```

Working Memory를 별도 영구 저장소로 만들지 않는다.

## 26.2 Working Memory as Activated Derived State

Working set은 long-term memory와 operational state의 현재 관련 부분을 임시로 조립한 derived state로 본다.

```text
Current Event State
+ Active Goal / Task
+ Retrieved Evidence
+ Relevant Entities / Relationships
+ Unresolved Forks
+ Relevant Prospective State
        ↓
DYNAMIC WORKING SET
        ↓
Reader / Controller
```

Working set 자체는 canonical evidence가 아니다.

강한 원칙:

> **Attention state is not evidence.**

Event boundary / task transition 이후 working set은 버리고 필요하면 다시 구성한다.

## 26.3 Activated Set vs Focus Set

Working memory 내부에서도 후보 활성화와 실제 reasoning context를 구분하는 방향이 유망하다.

```text
LONG-TERM MEMORY
        ↓
ACTIVATED CANDIDATE SET
        ↓ narrow selection
FOCUS / WORKING SET
        ↓
Reader / Controller
```

이는 기존 sparse retrieval 원칙과 정합적이다.

```text
retrieve broadly
→ select narrowly
→ reason with a bounded focus
```

## 26.4 Always-Visible Memory Is Privileged Memory

항상 prompt에 들어가는 정보는 일반 retrieval memory보다 오류 비용이 높다.

잘못된 core state는:

```text
all future turns
→ distorted interpretation
→ distorted retrieval
→ distorted answer
→ potentially distorted new memory extraction
```

으로 전파될 수 있다.

따라서:

> **Core promotion threshold must be stricter than ordinary memory write threshold.**

## 26.5 Selected Direction — Tiny Stable User Core

세 후보 중 다음 방향을 우선한다.

### A. No Core

모든 personalization을 retrieval로만 처리한다.

장점:
- stale always-visible profile이 없다.
- architecture가 단순하다.

단점:
- 매우 기본적인 identity / interaction anchor도 retrieval miss에 의존한다.

### B. Tiny Stable User Core — SELECTED DIRECTION

극소수의 안정적이고 전역적인 anchor만 always-visible로 둔다.

Candidate examples:

```text
preferred language
timezone
stable identity anchors
very stable global interaction preferences
```

### C. Rich User Profile — REJECT LIKELY

취향, 성격, 프로젝트, 관계, 목표 등을 큰 profile로 항상 주입하는 방향.

거부 이유:

```text
overlaps with User Model
staleness risk
globalizes context-dependent preferences
consumes context budget
can bias unrelated reasoning
```

사용자 결정:

> **B가 맞고, C는 User Model과 역할이 겹치므로 굳이 별도 Core로 만들 이유가 없다.**

## 26.6 Core Is Not the User Model

역할을 명확히 분리한다.

```text
CANONICAL EVIDENCE
        ↓
     USER MODEL
rich longitudinal representation
- preferences
- relationships
- goals
- habits
- history
- changes over time
        │
        ├──────────────┐
        ▼              ▼
TINY STABLE CORE    RETRIEVAL
always-safe         query-relevant
projection          slices
        │              │
        └──────┬───────┘
               ▼
       DYNAMIC WORKING SET
               ▼
         Reader / Agent
```

강한 원칙:

> **Rich personalization belongs in the User Model. Core is only its tiny, stable, always-safe projection.**

## 26.7 Important ≠ Core

Core는 “가장 중요한 기억” 집합이 아니다.

예:

```text
"현재 가장 중요한 프로젝트"
→ 매우 중요하지만 temporal / contextual
→ Active Goal / User Model / Working Set

"기본 대화 언어"
→ 상대적으로 사소해 보여도 거의 항상 필요
→ Core candidate
```

따라서 Core promotion에서는 단순 중요도보다 다음을 본다.

```text
global applicability
temporal stability
safety under always-visible exposure
utility across many interactions
provenance quality
```

## 26.8 Core Is a Projection, Not a Source of Truth

Core text 자체를 canonical truth로 만들지 않는다.

```text
Canonical Evidence / User Model
        ↓
Core Projection
        ↓
always-visible context
```

수정/정정은 canonical evidence와 User Model에 반영되고,
Core는 다시 build되는 구조를 우선한다.

## 26.9 Governance Is Not Memory Core

다음은 Core Memory로 넣지 않는다.

```text
permissions
safety constraints
confirmation requirements
tool authority
project governance contracts
```

이들은 별도 governance / system contract 계층의 책임이다.

Skill이 governance를 재정의할 수 없었던 것과 동일한 원칙이다.

## 26.10 Current Goals Usually Do Not Belong in Core

현재 목표, 활성 프로젝트, 최근 관심사는 중요해도 temporal scope가 짧다.

```text
current goal
active project
current decision
→ Working Set / Operational State / User Model

not
→ Stable Core by default
```

Core는 현재 narrative를 모든 미래 질문에 강제하는 장치가 되어서는 안 된다.

## 26.11 Core Promotion Is an Open Research Question

Tiny Stable Core 방향은 선택했지만 exact promotion mechanism은 아직 열린다.

후보:

```text
explicit stable user statement
+ repeated longitudinal consistency
+ broad cross-context usefulness
+ no unresolved contradiction
+ safe if injected globally
```

시작점은 보수적으로 잡는다.

Core 항목을 일반 memory보다 쉽게 자동 승격하지 않는다.

## 26.12 Current Decision

| Mechanism | XION status |
|---|---|
| Working Memory as persistent DB | **REJECT** |
| Working Memory as ephemeral derived state | **VERY STRONG CANDIDATE** |
| Activated candidate set + narrow focus set | **VERY STRONG CANDIDATE** |
| Current Event State feeds working set | **STRONG ADOPT candidate** |
| Working set itself becomes canonical evidence | **HARD REJECT** |
| Attention state = evidence | **HARD REJECT** |
| No Core at all | **PLAUSIBLE BASELINE** |
| Tiny Stable User Core | **SELECTED DIRECTION / STRONG CANDIDATE** |
| Rich always-visible user profile | **REJECT LIKELY** |
| Core = User Model | **REJECT** |
| Core = tiny projection from User Model/Evidence | **VERY STRONG CANDIDATE** |
| Current goals in Core | **REJECT by default** |
| Stable global identity/interaction anchors in Core | **STRONG CANDIDATE** |
| Governance inside memory Core | **REJECT** |
| Core promotion threshold > ordinary write threshold | **STRONG PRINCIPLE** |

### Working synthesis

> **Core Memory는 가장 중요한 기억의 모음이 아니다. 모든 reasoning에 항상 보여줘도 안전한 극소수의 안정된 anchor만 담는 privileged projection이다. 풍부한 개인화는 User Model에 남고, 현재 필요한 정보는 Dynamic Working Set이 조립한다.**

> **Rich personalization belongs in the User Model. Core is only its tiny, stable, always-safe projection. Working Memory is ephemeral activation, not another source of truth.**


---

# 27. Gap-Fill Finding 12 — Forgetting / Retention / Archival

> 상태: **SHALLOW GAP-FILL / ARCHITECTURE REINFORCEMENT**
>
> 핵심 결론: XION에서 ordinary forgetting은 대부분 **삭제가 아니라 접근성 감소**여야 한다. Semantic invalidation, retrieval accessibility, governance erasure를 분리한다.

## 27.1 Storage Is Not Accessibility

강한 working principle:

```text
canonical evidence remains
        ↓
derived memory may remain valid
        ↓
retrieval accessibility changes
```

오래 안 쓰였다는 이유만으로 canonical evidence를 삭제하지 않는다.

```text
not currently retrieved
≠
forgotten by policy
≠
erased
```

## 27.2 Three Different Meanings of "Forgetting"

### Semantic Forgetting

현재 상태에 더 이상 적용되지 않는 기억.

```text
old preference
old goal
old relationship state
```

처리:

```text
superseded / invalidated
→ default current-state retrieval에서 억제
→ historical query에서는 접근 가능
```

기존 temporal validity / belief revision 계약을 재사용한다.

### Accessibility Forgetting

여전히 맞는 기억이지만 현재 활용 가능성이 낮은 경우.

```text
valid memory
+ low current relevance
+ few useful opportunities
→ lower activation / retrieval priority
```

삭제하지 않는다. Query가 정확히 맞으면 다시 활성화될 수 있다.

### Governance Erasure

사용자의 명시적 삭제 요청이나 privacy/retention 정책 때문에
canonical evidence 자체를 실제로 제거해야 하는 경우.

이것은 ordinary forgetting이 아니라 별도 governance 문제이며
Privacy / Erasure pass에서 다룬다.

## 27.3 Age Alone Is Not a Good Forgetting Signal

단순 global decay:

```text
importance * exp(-age)
```

같은 규칙은 기본 설계로 채택하지 않는다.

시간은 signal 하나일 뿐이다.

더 중요한 후보:

```text
relevant opportunities
retrieval opportunities
actual retrieval / injection
actual downstream use
explicit outcome
supersession
current contextual relevance
```

특히 이전 연구의 핵심:

> **age ≠ opportunity**

를 유지한다.

## 27.4 Unused Does Not Mean Useless

다음 두 memory를 같게 취급하면 안 된다.

```text
A:
6개월 동안 관련 질문 자체가 없었음

B:
관련 질문이 20번 있었지만 한 번도 필요하지 않았음
```

B가 더 강한 accessibility-downweight evidence일 수 있다.

따라서 inactivity는 wall-clock보다 opportunity-adjusted signal로 보는 방향이 강하다.

## 27.5 Retrieval Frequency Must Not Self-Reinforce Blindly

위험한 feedback loop:

```text
popular memory
→ retrieved
→ retrieval count rises
→ rank rises
→ retrieved again
```

이렇게 되면 rare-but-critical evidence와 counterevidence가 묻힐 수 있다.

강한 원칙:

```text
retrieved often
≠ inherently important

retrieved
≠ useful

used
≠ correct
```

Retrieval count 단독으로 retention / importance를 강화하지 않는다.

## 27.6 Rare-but-Critical Memory Must Remain Recoverable

접근성이 낮은 memory도 query / event / entity cue가 충분히 강하면
다시 올라올 수 있어야 한다.

이는 다음과 정합적이다.

```text
Write conservatively.
Retrieve associatively.
Select narrowly.
```

Adaptive accessibility가 archive semantics를 대신할 수 있다.

## 27.7 Archival Should Be an Optimization, Not Meaning

`HOT / WARM / COLD / ARCHIVE`를 지금 semantic truth schema로 고정하지 않는다.

Cold/archive는 필요하다면:

```text
storage optimization
cache policy
embedding rebuild priority
index tiering
cost control
```

을 위한 runtime/storage concern으로 둔다.

강한 guard:

> **Archive state must not silently become semantic validity.**

Cold storage로 내려갔다고 해서
“덜 중요하다”거나 “현재 사실이 아니다”가 되는 것은 아니다.

## 27.8 Current Decision

| Mechanism | XION status |
|---|---|
| Old → delete canonical evidence | **HARD REJECT** |
| Forgetting = accessibility reduction | **VERY STRONG ADOPT principle** |
| Age-only decay | **REJECT** |
| Recency/frequency as weak prior | **PLAUSIBLE** |
| Opportunity-adjusted inactivity | **VERY STRONG CANDIDATE** |
| Retrieval count automatic reinforcement | **DANGEROUS / REJECT default** |
| Superseded memory suppressed from current state | **ALREADY ADOPTED** |
| Superseded memory retrievable historically | **ALREADY ADOPTED** |
| Rare-but-critical memory preservation | **STRONG PRINCIPLE** |
| Hot/Warm/Cold as semantic schema now | **DEFER** |
| Archival as storage/runtime optimization | **STRONG CANDIDATE** |
| Ordinary forgetting = privacy deletion | **HARD REJECT** |
| User-requested erasure | **SEPARATE GOVERNANCE PASS** |

### Working synthesis

> **XION은 기억을 오래됐다고 버리지 않는다. 현재 필요할 가능성이 낮으면 접근성을 낮추고, 더 이상 현재 상태에 적용되지 않는 기억은 temporal validity로 억제하며, 실제 삭제는 별도의 governance 행위로 처리한다.**

---

# 28. Gap-Fill Finding 13 — Longitudinal Identity / Self-History

> 상태: **SHALLOW GAP-FILL / HIGH-POTENTIAL SYNTHESIS**
>
> 핵심 결론: 동일한 user identity와 시간에 따른 user state를 분리한다. 또한 동일한 temporal-history 원칙을 XION 자체에도 적용해 **User Life History / Shared History / XION Self-History**의 세 층을 둔다.

## 28.1 Same Identity Does Not Mean Same State

Relationship identity에서:

```text
same name
≠ same person
```

이었다면 longitudinal identity에서는 반대로:

```text
different state
≠ different person
```

이다.

예:

```text
USER entity
same longitudinal identity
    ├─ preference@t1 = A
    ├─ preference@t2 = B
    └─ preference@t3 = C
```

상태 변화 때문에 user entity를 split하지 않는다.

## 28.2 Temporal User Model

User Model을 하나의 최신 static profile로 보지 않는다.

```text
Canonical Evidence
        ↓
Temporal User Model
        ├─ Current Projection(now)
        └─ Historical Projection(t)
```

현재 질문에는 `User Model @ now`,
과거 시점 질문에는 `User Model @ t`를 구성하는 방향을 우선한다.

## 28.3 WORLD UPDATE vs CORRECTION Reused

다음은 구분한다.

```text
"예전에는 A였는데 지금은 B"
→ WORLD UPDATE

"내가 전에 잘못 말했어. 원래부터 B였어"
→ CORRECTION
```

Longitudinal identity용 새 revision engine을 만들지 않는다.
기존 temporal validity + belief revision 계약을 재사용한다.

## 28.4 Preserve Life History, Do Not Invent Life Story

XION은 사용자의 과거 상태와 변화 기록을 보존할 수 있다.

하지만 몇 개의 evidence로 coherent narrative를 truth화하지 않는다.

강한 원칙:

> **XION should preserve a life history, not invent a life story.**

예:

```text
Evidence:
2024: "연구에 관심이 적다"
2025: project started
2026: repeated research work
```

이로부터 temporal change를 요약하는 것은 가능하지만:

```text
"어떤 사건을 계기로 진정한 적성을 깨닫고 연구자로 성장했다"
```

같은 의미 부여는 사용자가 직접 말하지 않은 이상
Narrative Hypothesis로만 취급한다.

## 28.5 SELF-CONCEPT CLAIM

사용자의 자기서술은 별도 의미를 가진다.

```text
"나는 낯을 많이 가리는 사람이야"
"나는 잘 모르는 분야에서는 흥미가 잘 안 붙는 편인 것 같아"
```

이를 objective trait로 바로 확정하지 않는다.

Candidate representation:

```text
SELF_CONCEPT_CLAIM
content
context / scope
valid_from
supporting utterances
current / superseded
```

구분:

```text
explicit self-description
→ SELF-CONCEPT CLAIM

behavior-derived interpretation
→ INFERRED HYPOTHESIS
```

강한 원칙:

> **Self-concept claim ≠ objective trait.**

Self-concept 자체가 longitudinal user history에서 중요한 evidence가 될 수 있다.

## 28.6 XION Can Also Have a Longitudinal Self-History

Longitudinal-memory 원칙을 사용자에게만 한정하지 않는다.

```text
CANONICAL SYSTEM EVENTS
- capability added / removed
- design decision
- deployment
- failure
- user correction
- successful outcome
- contract change
        ↓
SYSTEM SELF-HISTORY
        ↓
CURRENT SELF-MODEL
        ↓
TINY SYSTEM CORE
```

Self-History는 현재 capability source of truth가 아니다.

## 28.7 Selected Direction — Full Autobiographical Scope With Three Layers

두 후보:

```text
A. System Development History only
B. Full autobiographical history with provenance-separated layers
```

사용자는 **B를 선택**했다.

세 층:

### USER LIFE HISTORY

사용자에게 일어난 일.

```text
user experiences
preferences / goals / relationships changing
self-concept changes
```

### SHARED HISTORY

사용자와 XION이 함께 겪은 interaction / decision / correction.

```text
problem discovered together
important joint design decision
repeated interaction pattern
user correction that shaped XION behavior
```

### XION SELF-HISTORY

XION 자체의 설계 / 기능 / 실패 / capability 변화.

```text
architecture evolution
research decisions
capability changes
deployment milestones
failure → fix / contract
```

세 층은 연결할 수 있지만 provenance 의미를 섞지 않는다.

## 28.8 Shared History Can Explain System Evolution

예:

```text
shared interaction problem
        ↓
user + XION identify failure mode
        ↓
design/research decision
        ↓
system contract changes
```

이를 연결하면 나중에:

> “왜 우리는 이 규칙을 만들었지?”

에 대해 단순 현재 rule뿐 아니라
그 rule이 생긴 interaction / failure / design path를 복원할 수 있다.

## 28.9 XION May Maintain an Autobiography, but Not Mythology

System Self-History는 실제 system events에서 파생한다.

허용:

```text
"초기에는 topic retrieval 중심이었다"
"긴 대화에서 retrieval 문제가 발견됐다"
"그 뒤 structured memory research가 시작됐다"
```

거부:

```text
"나는 실패를 통해 사용자를 이해하는 진정한 동반자로 성장했다"
```

같은 무근거 의미 창작.

강한 원칙:

> **XION may maintain an autobiography, but not author its own mythology.**

Meaning-level synthesis가 필요하면 `Narrative Hypothesis`로 분리한다.

## 28.10 Declared System Identity vs Inferred System Trait

명시적 product/design contract:

```text
SYSTEM_IDENTITY_CLAIM
SYSTEM_ROLE
SYSTEM_DESIGN_VALUE
```

예:

```text
"XION is a long-term personal secretary."
"Canonical evidence is preserved conservatively."
```

이런 명시적 identity/role은 product contract에 가까운 source를 가진다.

반면:

```text
"XION is deeply empathetic"
"XION understands the user better than anyone"
```

같은 inferred trait는 objective system identity로 저장하지 않는다.

## 28.11 Current Operational State Wins Over Self-History

Source hierarchy candidate:

```text
CURRENT OPERATIONAL STATE
code / config / connector / DB
        >
DECLARED DESIGN CONTRACT
        >
SYSTEM SELF-HISTORY
        >
INFERRED NARRATIVE
```

예전에 가능했던 capability가 현재 제거됐다면
Self-History가 아니라 현재 runtime state가 답이다.

## 28.12 User Model / System Model Symmetry

전체 구조는 대칭적일 수 있다.

```text
USER SIDE
Canonical User Evidence
→ Temporal User Model
→ Tiny User Core
→ Dynamic Working Set

XION SIDE
Canonical System Events
→ System Self-History / Current Self-Model
→ Tiny System Core
→ Dynamic Working Set
```

하지만 user truth와 system operational truth의 source hierarchy는 각각 다르게 관리한다.

## 28.13 Current Decision

| Mechanism | XION status |
|---|---|
| User = one fixed profile | **REJECT** |
| Stable identity + temporal states | **VERY STRONG ADOPT** |
| State change → user entity split | **HARD REJECT** |
| Current User Model projection | **STRONG ADOPT candidate** |
| Historical User Model(t) | **STRONG ADOPT candidate** |
| WORLD UPDATE / CORRECTION reuse | **ALREADY SOLVED** |
| Overwrite old states with latest state | **HARD REJECT** |
| Automatic coherent user life narrative | **REJECT** |
| Preserve user life history | **VERY STRONG ADOPT** |
| Explicit self-description | **SELF-CONCEPT CLAIM candidate** |
| Self-concept = objective trait | **REJECT** |
| Behavioral trait inference | **REVISABLE HYPOTHESIS** |
| System development history only | **NOT SELECTED** |
| User Life + Shared + XION Self-History | **SELECTED DIRECTION** |
| XION autobiography | **HIGH-POTENTIAL** |
| XION mythology / unsupported meaning | **HARD REJECT** |
| Self-History as capability source of truth | **REJECT** |
| Operational state > Self-History | **STRONG PRINCIPLE** |

### Working synthesis

> **XION은 한 사람을 시간에 따라 변하는 하나의 identity로 기억한다. 현재 상태는 과거 상태를 지우지 않는다. 사용자의 자기서술은 Self-Concept Claim으로 보존하되 객관적 trait와 구분한다.**

> **동시에 XION 자신도 User Life History / Shared History / XION Self-History를 provenance로 분리해 기억할 수 있다. XION은 autobiography를 가질 수 있지만 mythology를 만들어서는 안 된다.**


---

# 29. Skill Memory Amendment — Executor-Relative Hierarchy / Macro Deployment

> 상태: **IMPORTANT AMENDMENT TO PROCEDURAL / SKILL MEMORY**
>
> 핵심 수정: 기존의 “subtask-level skill이 대체로 유리하다”는 관찰을 전역 규칙으로 일반화하지 않는다. **Skill granularity는 executor boundary에 상대적**이며, 외부 executor가 안정적으로 제공하는 macro는 XION 입장에서 하나의 skill로 취급할 수 있다.

## 29.1 Skill Granularity Is Executor-Relative

강한 원칙:

> **Atomicity is interface-relative.**

같은 `pick_and_place`도:

```text
XION view
→ one reusable macro

robot controller view
→ detect / grasp / move / release / verify

motion-control view
→ coordinate transform / IK / trajectory / feedback control

actuator view
→ joint / motor commands
```

처럼 계층마다 다른 granularity를 갖는다.

XION이 모든 skill을 동일한 크기로 강제 분해하지 않는다.

## 29.2 Primitive Does Not Mean Actuator-Atomic

XION-visible primitive는 **재사용 가능한 최소 semantic action**이어야 한다.

좋은 예:

```text
detect_object(object)
get_object_pose(object)

move_to_pose(
  frame,
  position,
  orientation
)

grasp(object)
release(object)
verify_object_pose(object, target)
```

피해야 하는 예:

```text
move_left(3_ticks)
joint_2(+4)
motor_3(120_ms)
servo_delta(-2)
```

후자는 특정 geometry / calibration / hardware에 과적합되며,
로봇이나 보정값이 바뀌면 skill 의미가 깨질 수 있다.

강한 원칙:

> **XION-visible primitive should be the lowest reusable semantic action, not the lowest executable physical action.**

## 29.3 Primitive Enough to Compose, but Not Hardware-Overfit

Primitive의 목적은 XION이 새로운 task를 조합할 수 있게 하는 것이다.

```text
semantic location
        ↓
task-space pose
        ↓
joint-space
        ↓
motor-space
```

XION은 기본적으로 위쪽 semantic / task-space 층을 다루고,
joint / motor-space는 executor가 책임진다.

좌표 primitive를 사용할 경우 coordinate frame은 계약에 포함해야 한다.

```text
move_to_pose(
  frame="table",
  position=(x,y,z),
  orientation=(...)
)
```

단순 `(x,y,z)` 숫자만으로 의미를 고정하지 않는다.

## 29.4 Macro-First, Primitive-Fallback Planning

Executor가 XION에 capability를 공개할 때
macro와 compositional primitive를 구분할 수 있다.

```text
MACROS
- pick_and_place
- clear_table
- put_dishes_in_rack

PRIMITIVES
- detect_object
- get_pose
- grasp
- move_to_pose
- release
- verify_pose
```

Planning flow:

```text
task
 ↓
skill routing
 ↓
applicable macro exists?
 ├─ YES → execute macro
 └─ NO  → compose semantic primitives
```

즉 XION은 검증된 coarse macro를 우선 사용하고,
필요할 때만 primitive composition으로 내려간다.

## 29.5 Repeated Primitive Composition Can Become a Macro Candidate

처음에는:

```text
detect
→ grasp
→ move_to_pose
→ release
→ verify
```

를 XION이 조합할 수 있다.

반복적으로 동일한 semantic goal을 안정적으로 달성하면:

```text
pick_and_place(object, target)
```

같은 Macro Skill 후보로 올릴 수 있다.

하지만 **반복 횟수만으로 자동 승격하지 않는다.**

Candidate → Active promotion에서 최소한 다음을 검증한다.

```text
same semantic goal?
stable preconditions?
stable termination?
stable verification?
parameterizable inputs?
success across meaningful variation?
hidden context dependency absent?
executor compatibility known?
```

기존 procedural contract를 재사용한다.

```text
episode / composition
→ candidate
→ generalize / parameterize
→ replay / variation test
→ ACTIVE
```

## 29.6 Macro Must Be Deployed Downward to the Executor

Macro가 ACTIVE가 되면 XION 쪽 registry에만 존재하지 않는다.

해당 executor가 local macro execution을 지원한다면
**executor-local macro registry / controller board에도 write-out / deploy**한다.

```text
XION Skill Registry
        ↓ deploy
Robot Controller Macro Registry
        ↓
pick_and_place@v3
```

이후 XION은:

```text
execute_macro(
  "pick_and_place",
  object=cup,
  target=shelf
)
```

처럼 coarse call 하나로 실행할 수 있다.

Working principle:

> **Compile upward in XION; deploy downward to the executor.**

## 29.7 Canonical Skill Contract vs Deployed Executable Projection

두 source를 구분한다.

```text
XION / Capability Skill Registry
→ canonical reusable skill contract

Executor Macro Registry
→ deployed executable projection
```

제어보드의 macro list를 canonical source of truth로 만들지 않는다.

Canonical skill contract candidate fields:

```text
skill_id
version
applicability
inputs
preconditions
termination
verification
executor compatibility
implementation / decomposition reference
validation receipt
permission / side-effect metadata
```

Executor-deployed projection candidate:

```text
macro_id
version
hash
compiled executor program / reference
deployment receipt
```

연결 시 version/hash가 맞지 않으면:

```text
re-deploy
or
fail-close / primitive fallback
```

한다.

## 29.8 Planning Can Be Coarse; Execution Provenance Must Remain Decomposable

Macro를 하나의 planning action으로 써도
underlying executor trace를 버리지 않는다.

```text
pick_and_place
  ├ detect
  ├ grasp
  ├ move
  ├ release
  └ verify
```

실패 시:

```text
macro failure
→ executor trace
→ primitive-level diagnosis
→ macro revision / invalidation candidate
```

가 가능해야 한다.

강한 원칙:

> **Planning abstraction can be coarse; execution provenance should remain decomposable.**

## 29.9 External Executor Boundary

로봇팔 예시에서 책임은 다음처럼 나눈다.

```text
XION
→ semantic task selection / composition

Robot Runtime
→ physical execution decomposition

Controller
→ IK / trajectory / collision / feedback control

Actuator
→ joint / motor commands
```

XION이 IK나 low-level motor control을 Skill Memory에 복제하지 않는다.

기존 원칙은 유지되고 더 강해진다.

> **Memory remembers the procedure contract; capability runtime owns execution.**

추가 원칙:

> **Skill Registry owns the reusable contract; executor owns the deployed implementation.**

## 29.10 Generalization Beyond Robotics

이 구조는 robot arm에만 한정되지 않는다.

후보 executor:

```text
browser automation
smart home
CAD
spreadsheet automation
drone
3D printer
local software agent
```

Executor가 안정적인 macro를 제공하면 XION은 macro를 사용할 수 있고,
macro가 없으면 semantic primitives를 조합할 수 있다.

## 29.11 Revised Decision

| Mechanism | XION status |
|---|---|
| Always force every skill into small subtasks | **REJECT** |
| Executor-relative skill granularity | **VERY STRONG ADOPT** |
| XION primitive = actuator-level atomic action | **HARD REJECT** |
| XION primitive = reusable semantic/task-space action | **VERY STRONG ADOPT** |
| Hardware-overfit tick/joint deltas as general skill interface | **REJECT** |
| Macro-first, primitive-fallback planning | **VERY STRONG ADOPT** |
| Repeated composition → macro candidate | **VERY HIGH-POTENTIAL** |
| Frequency alone → automatic macro promotion | **REJECT** |
| Variation / verification before promotion | **STRONG ADOPT** |
| Active macro only in XION registry | **INCOMPLETE** |
| Deploy active macro to capable executor-local registry | **STRONG ADOPT** |
| Executor macro list = canonical truth | **REJECT** |
| Canonical registry + deployed projection | **VERY STRONG ADOPT** |
| Macro execution hides all lower-level provenance | **REJECT** |
| Coarse planning + decomposable execution trace | **STRONG PRINCIPLE** |
| XION owns IK / motor control | **HARD REJECT** |

### Working synthesis

> **Skill granularity is executor-relative. XION composes reusable semantic primitives rather than hardware-overfit actuator actions. Stable repeated compositions may be validated into Macro Skills; once active, those macros should be deployed to the executor-local macro registry while the canonical reusable contract remains in XION. XION plans coarsely, executors implement locally, and execution provenance remains decomposable.**


---

# 30. Multi-Specialist Conversational Identity / Shared Memory

> 상태: **HIGH-POTENTIAL ARCHITECTURE EXTENSION**
>
> 핵심 방향: XION은 여러 specialist를 가질 수 있지만, 사용자에 대한 canonical long-term memory와 system identity를 분리된 truth silo로 복제하지 않는다. **Shared canonical memory + specialist-local Role Core / Working Set / retrieval lens / derived experience** 구조를 우선한다.

## 30.1 Multiple Specialist Minds, Not Multiple Truths

강한 원칙:

> **XION may have multiple specialist minds without multiple truths.**

공유:

```text
SHARED XION MEMORY
- Canonical Evidence Ledger
- Temporal User Model
- Entity / Relationship / Event state
- Shared History
- XION Self-History
- Skill / Procedure contracts
```

전문화:

```text
SPECIALIST-LOCAL STATE
- Role Core
- Working Set
- retrieval lens
- active goals
- tools / capability view
- domain-specific derived experience
```

각 specialist가 user facts를 독립 long-term DB에 복제하지 않는다.

## 30.2 Shared System Core vs Specialist Role Core

두 종류의 always-visible / privileged state를 구분한다.

```text
SHARED SYSTEM CORE
→ XION identity
→ global role
→ global governance / authority boundary
→ cross-domain interaction principles
```

```text
SPECIALIST ROLE CORE
→ this specialist's domain role
→ domain contracts
→ tool / capability boundaries
→ domain-specific operating principles
```

Working distinction:

> **System Core answers “나는 누구인가?”**
>
> **Role Core answers “지금 어떤 전문가로 일하고 있는가?”**

Role Core에 user truth를 복제하지 않는다.

## 30.3 Specialist Working Sets Are Separate

Working Set은 persistent truth가 아니라 ephemeral compiled context다.

따라서 specialist별로 분리하는 것이 자연스럽다.

예:

```text
Robot Specialist Working Set
- current scene
- active robot
- object poses
- applicable macros
- safety constraints
```

```text
Trading Specialist Working Set
- portfolio-relevant state
- current market / company evidence
- research contracts
- active decision question
```

한 specialist의 단기 attention state를 다른 specialist에 무조건 주입하지 않는다.

## 30.4 Share Evidence Globally; Specialize Interpretation Locally

Specialist가 관찰하거나 학습한 사건도 canonical event는 중앙 ledger에 기록한다.

```text
specialist observation / interaction
        ↓
Canonical Evidence Ledger
agent_id / observed_by / provenance
        ↓
shared consolidation
        ↓
specialist-specific derived projection if useful
```

강한 원칙:

> **Share evidence globally; specialize interpretation locally.**

예:

```text
Canonical Event:
Robot Agent attempted grasp strategy X and failed.

Robot-derived Experience:
transparent object → vision strategy Y may be required
```

후자는 specialist-local derived experience일 수 있지만 원천 event는 중앙에 남는다.

## 30.5 Conversational Identity Handoff

Specialist는 내부 tool-like worker에만 한정하지 않는다.

사용자가 원하면 같은 conversation continuity 안에서
특정 specialist와 직접 대화할 수 있다.

예:

```text
User:
"이 주식 지금 어떻게 봐?"

XION:
"핵심만 말하면 ... .
더 깊게 보면 투자 스페셜리스트가 잘 볼 수 있는데 불러줄까?"

User:
"응"

XION → Trading Specialist handoff

...

User:
"시온 다시 불러줘"

Trading Specialist → XION handoff
```

기본 relational identity는 XION이다.
Specialist 전환은 **명시적 conversational identity handoff**로 취급한다.

## 30.6 Same Conversation, Different Active Identity

새 chat room이 필수는 아니다.

Conceptually:

```text
Conversation Thread
  segment A: active_identity = XION
  segment B: active_identity = Trading Specialist
  segment C: active_identity = XION
```

대화 원문과 user evidence는 같은 canonical substrate에 남는다.

누가 발화했는지는 provenance로 구분한다.

```text
speaker = user
observed_by = trading_specialist
```

```text
speaker = trading_specialist
```

Specialist의 추론을 user truth로 오인하지 않는다.

## 30.7 Handoff State Is Derived, Not Canonical Truth

Specialist → XION 복귀 때 continuity를 위해
간단한 handoff state를 만들 수 있다.

```text
topic
important evidence used
current conclusion
user decision
unresolved questions
```

이는 새로운 canonical memory가 아니라
**ephemeral / rebuildable working-set bridge**로 우선한다.

원본 conversation / evidence가 canonical이다.

## 30.8 XION Remains the Orchestrator

기본 방향:

```text
User
 ↓
XION
 ↓
sparse specialist routing
 ↓
0..N specialists
```

XION이 간단한 질문은 직접 처리할 수 있다.

깊은 specialist cognition이 유리할 때:

```text
brief answer
→ optional specialist offer
→ user approval
→ explicit handoff
```

를 우선한다.

Specialist가 다른 specialist가 필요하다고 판단할 수는 있지만,
사용자-facing identity handoff / orchestration authority는 중앙 XION에 두는 방향이 강하다.

## 30.9 Specialist Personality Should Not Be the Primary Architecture

처음부터 각 specialist를 캐릭터 prompt로 정의하는 것보다:

```text
role
goals
tools
Role Core
Working Set
retrieval lens
domain experience
```

차이에서 자연스럽게 전문적인 행동 차이가 나오도록 한다.

Surface tone/personality는 나중 UI/product layer에서 추가할 수 있다.

Working principle:

> **Personality should emerge from role, memory access, goals, and experience before being manually scripted.**

## 30.10 User-Created Conversation Spaces / Sessions

별도 chat/session을 만들 수 있는 UI는 **유용한 product direction**으로 열어둔다.

예:

```text
Main XION
Fitness / Diet
Trading
Memory Research
Robot Lab
```

특히 반복적인 특정 목적의 대화:

```text
daily diet + exercise log
```

를 main chat에 계속 섞기보다
별도 conversation space에서 유지하는 것이
사용자 경험과 working-context locality 측면에서 유리할 수 있다.

하지만 중요한 guard:

> **UI chat boundaries are not canonical memory boundaries.**

즉:

```text
separate chat/session
≠ separate user truth database
≠ separate identity
≠ automatic event boundary
```

대화창은 다음을 가질 수 있다.

```text
session-local working context
default specialist / role affinity
retrieval bias toward local topic history
open tasks / unresolved questions
surface organization
```

하지만 long-term user facts와 shared evidence는 중앙 memory substrate에 기록한다.

## 30.11 Conversation Session Is Not an Event Boundary

기존 Event Segmentation 계약을 유지한다.

사용자가 `Fitness` chat을 일주일 동안 계속 사용해도
그 전체가 하나의 autobiographical event라는 뜻은 아니다.

반대로 main chat 하나 안에서도 여러 event가 존재할 수 있다.

따라서:

```text
UI thread
conversation segment
event segment
specialist identity segment
```

를 서로 다른 projection / boundary로 취급한다.

## 30.12 Chat-Specific Working Continuity

예를 들어 `Fitness / Diet` chat은:

```text
persistent UI thread
        ↓
rebuildable local thread state
- recent meals
- current training week
- unresolved plan
- currently active tracking context
        ↓
Working Set
```

을 만들 수 있다.

이 local state도 user truth의 새로운 source of truth가 아니라
canonical evidence에서 재구축 가능한 derived state여야 한다.

## 30.13 Current Decision

| Mechanism | XION status |
|---|---|
| Separate specialist long-term truth DBs | **REJECT** |
| Shared canonical long-term memory | **VERY STRONG ADOPT direction** |
| Specialist-local Working Set | **VERY STRONG ADOPT** |
| Specialist Role Core | **STRONG ADOPT candidate** |
| Shared System Core | **STRONG PRINCIPLE** |
| Specialist-local user truth copy | **REJECT** |
| Specialist-specific derived experience | **VERY STRONG CANDIDATE** |
| Explicit conversational specialist handoff | **HIGH-POTENTIAL / ADOPT direction** |
| XION as default relational identity / orchestrator | **STRONG ADOPT direction** |
| Silent unexpected identity switch | **REJECT** |
| Handoff summary as canonical memory | **REJECT** |
| Handoff summary as ephemeral bridge | **STRONG CANDIDATE** |
| User-created chat/session spaces | **HIGH-POTENTIAL UI/UX direction** |
| Chat session = separate long-term memory silo | **REJECT** |
| Chat session = autobiographical event | **REJECT** |
| Session-local working context / retrieval bias | **STRONG CANDIDATE** |
| Exact UI implementation now | **DEFER** |

### Working synthesis

> **XION은 하나의 shared long-term memory와 longitudinal identity 위에 여러 specialist cognitive views를 둘 수 있다. 각 specialist는 자신의 Role Core, Working Set, retrieval lens, tools, derived experience를 가지며, 필요하면 사용자가 그 specialist와 직접 대화하도록 명시적으로 handoff할 수 있다.**

> **또한 사용자는 목적별 chat/session을 만들 수 있지만, 이는 memory silo가 아니라 working-context와 interaction organization을 위한 view다. UI thread, specialist identity, event segmentation, canonical memory boundary는 서로 같은 개념이 아니다.**


---

# 31. Gap-Fill Finding 14 — Privacy / Governed Erasure / User Control

> 상태: **SHALLOW GAP-FILL / FINAL GAP-FILL**
>
> 핵심 결론: XION의 ordinary memory update는 canonical evidence를 논리적으로 보존하지만, 사용자가 실제 삭제를 요구하는 경우에는 **governed erasure**가 canonical evidence까지 제거할 수 있어야 한다. 삭제는 provenance를 따라 모든 memory-bearing derived artifact에 전파되어야 하며, erased content가 replay/cache/learned artifact를 통해 부활하지 않아야 한다.

## 31.1 Forgetting, Correction, Suppression, Erasure Are Different

다음 명령을 하나의 `forget()` 의미로 합치지 않는다.

```text
"그건 틀렸어"
→ correction / invalidation

"그건 옛날 얘기야"
→ world update / temporal supersession

"그건 앞으로 답할 때 쓰지 마"
→ retrieval / personalization suppression

"그 얘기는 완전히 지워"
→ governed erasure
```

강한 원칙:

```text
not retrieved
≠ forgotten
≠ invalidated
≠ erased
```

## 31.2 Canonical Evidence Is Logically Immutable, Not Physically Immortal

기존 원칙을 정교화한다.

> **Canonical evidence is logically immutable under ordinary memory operations, but subject to governed erasure.**

Ordinary update:

```text
old event 수정/삭제 금지
→ correction / supersession event
```

Governed erasure:

```text
explicit deletion / privacy action
→ canonical evidence removal allowed
```

따라서 append-oriented history와 privacy deletion을 충돌하는 개념으로 보지 않는다.

## 31.3 Erasure Must Propagate Through Provenance

Raw row 하나만 지우고 derived copies를 남기면 삭제가 아니다.

Potential downstream artifacts:

```text
summary
embedding
graph edge
formatter projection
relationship state
user model
core projection
retrieval cache
specialist-derived experience
shared-history narrative
learned artifact
```

Canonical evidence `E42` 삭제 시:

```text
E42 erased
 ↓
find downstream derivations
 ↓
invalidate affected artifacts
 ↓
rebuild from surviving evidence
```

이때 mixed-support artifact는 무조건 delete하지 않는다.

```text
Preference P
support = E42 + E81 + E93
```

라면 E42만 제거하고 E81/E93으로 재구축할 수 있다.

강한 원칙:

> **Erase sources, then rebuild surviving meaning from surviving evidence.**

## 31.4 Derivation Provenance Is Required for Erasure

단순 `source_ids[]` 목록만으로는
어떤 derived state가 삭제된 source에 얼마나 의존하는지 불명확할 수 있다.

기존 provenance 연구의:

```text
source provenance
derivation provenance
causal contribution
```

구분을 유지한다.

Erasure propagation에는 최소한 **derivation reachability**가 필요하다.

## 31.5 Deleted Evidence Must Not Resurrect

실패 모드:

```text
raw evidence erased
↓
old snapshot / stale cache / queued embedding job survives
↓
rebuild
↓
erased content reappears
```

이를 hard failure로 본다.

Candidate mechanism:

```text
Erasure Receipt / Tombstone
- erased evidence identity
- erased_at
- scope
- non-content request metadata
- rebuild / propagation watermark
- status
```

삭제된 민감 내용 자체를 tombstone에 복제하지 않는다.

강한 원칙:

> **Erase the content, preserve only enough non-content metadata to prevent resurrection and verify propagation.**

Exact tombstone schema는 R2/R3에서 결정한다.

## 31.6 Erasability by Design

Personal memory를 model weights나 opaque artifact에 기본적으로 굽지 않는다.

Preferred default:

```text
LLM
+
external Evidence Ledger
+
User Model
+
Graph / Formatter projections
+
Retrieval
```

Learned controller / adapter / classifier를 개인 데이터로 학습할 경우,
삭제 요청이 들어왔을 때:

```text
source identification
influence removal / retraining path
artifact invalidation
verification
```

계약이 있어야 한다.

강한 원칙:

> **Personal memory should remain externalizable and erasable by default.**

그리고:

> **If a learned artifact cannot be rebuilt or unlearned after source erasure, it should not silently become a permanent personal-memory sink.**

## 31.7 Erasure Scope Requires Identity Resolution

사용자 요청은 단일 evidence만이 아닐 수 있다.

```text
"이 대화 삭제"
"민수 관련 기억 전부 삭제"
"지난달 기록 삭제"
"이 주제 관련 기억 전부 지워"
```

Query-based mass deletion을 곧장 실행하지 않는다.

```text
resolve target scope
↓
identity / entity ambiguity?
   YES → ask
   NO  → erasure plan
```

특히 same-name entity collision이 unresolved라면 fail-close하고 질문한다.

Active Elicitation과 Identity Repair를 재사용한다.

## 31.8 Shared History / XION Self-History Must Also Be Rebuilt or Redacted

User Life History / Shared History / XION Self-History 세 층에서도
삭제된 user content가 narrative 형태로 남을 수 있다.

따라서 erased evidence에 의존하는 history projection은
rebuild / redact 대상이다.

다만 비민감 system consequence가 독립적으로 남을 수 있는지는
R2에서 exact rule을 정한다.

Candidate boundary:

```text
content-dependent personal narrative
→ remove / rebuild

non-personal system consequence
→ may remain only if erased content cannot be reconstructed
```

## 31.9 Backups / Logs / Snapshots

실제 erasure scope에는 장기적으로:

```text
live DB
derived DB
vector indexes
cache
snapshots
backups
logs
```

가 모두 관계될 수 있다.

하지만 exact retention period, backup destruction algorithm,
storage-class별 purge protocol은 현재 scope에서 **DEFER**한다.

현재 architecture contract:

> **Erasure scope must include all memory-bearing derived copies, not only the primary row.**

## 31.10 Ambiguous User Intent Must Be Clarified

삭제는 irreversible하거나 expensive할 수 있으므로
사용자 발화가 suppression인지 erasure인지 모호하면 질문한다.

예:

```text
"이거 기억하지 마"
```

후보 질문:

```text
"앞으로 답변에만 안 쓰게 할까,
아니면 저장된 기록 자체를 삭제할까?"
```

모호성을 임의로 physical deletion으로 해석하지 않는다.

## 31.11 Current Decision

| Mechanism | XION status |
|---|---|
| Forgetting = erasure | **HARD REJECT** |
| Ordinary canonical evidence = logically immutable | **ADOPT** |
| Canonical evidence = physically immortal forever | **REJECT** |
| Explicit governed erasure may remove canonical evidence | **VERY STRONG ADOPT** |
| Delete raw only, leave derived copies | **HARD REJECT** |
| Provenance-driven deletion propagation | **VERY STRONG ADOPT** |
| Mixed-support derived artifact → rebuild from survivors | **VERY STRONG ADOPT** |
| Minimal non-content erasure receipt / tombstone | **STRONG CANDIDATE** |
| Deleted evidence can reappear through replay/cache | **HARD FAIL** |
| Personal memory baked into opaque model weights by default | **REJECT** |
| Erasability-by-design for learned artifacts | **VERY STRONG ADOPT** |
| Correction / suppression / erasure distinction | **VERY STRONG ADOPT** |
| Ambiguous deletion scope → active elicitation | **STRONG ADOPT** |
| Mass deletion without identity resolution | **HARD REJECT** |
| Exact backup retention / purge machinery now | **DEFER** |

### Working synthesis

> **XION은 평상시에는 canonical evidence를 보존하고 derived state를 수정하지만, 사용자가 실제 삭제를 요구하면 governed erasure가 canonical evidence까지 제거할 수 있어야 한다. 삭제는 provenance를 따라 모든 derived memory에 전파되고, 남은 evidence로 상태를 재구축하며, erased content가 replay·cache·snapshot·learned artifact에서 되살아나지 않도록 검증 가능해야 한다.**

> **Gap-Fill phase stops here. Further work should prioritize synthesis and subsystem reduction over adding new mechanism classes.**


---

# 32. R2 Synthesis Operating Principles

> 상태: **SYNTHESIS PROTOCOL — NOT AN ARCHITECTURE DECISION**
>
> Privacy까지 포함된 R1 / Gap-Fill corpus를 다시 기준으로 삼고,
> r17의 초기 R2 architecture decisions는 candidate discussion으로만 취급한다.

## 32.1 Theory taxonomy와 runtime architecture를 분리한다

연구에서 서로 다른 이름을 가진 mechanism이
runtime에서도 각각 subsystem이어야 한다고 가정하지 않는다.

```text
ATMS / belief revision
CLS / consolidation
reconsolidation
event segmentation
active elicitation
procedural memory
...
```

은 각각 특정 failure mode를 설명하는 lens일 수 있다.

여러 lens가 하나의 coherent state model / policy / maintenance process로
합쳐져도 연구 invariant가 손실되지 않는다면 **합친다**.

> **Implement the coherent model, not the literature taxonomy.**

## 32.2 Boundary가 필요한 이유를 세 종류로 나눈다

1. **Semantic Contract** — 의미가 달라 반드시 구분해야 한다.
2. **Operational Boundary** — SoT, authority, lifecycle, permission, failure policy가 달라 독립 책임이 필요하다.
3. **Experimental Variant** — 우열이 실증적으로 unresolved라 shadow / replay 비교가 필요하다.

Semantic difference가 곧 subsystem을 뜻하지 않고,
experimental comparison이 subsystem의 유일한 이유도 아니다.

## 32.3 Subsystem / architecture candidate 수를 목표로 삼지 않는다

R2는 작은 수의 plane을 미리 정하고 mechanism을 배치하지 않는다.

```text
overlap map
→ truth / state map
→ necessary boundaries
→ unresolved experimental alternatives
→ resulting architecture
```

순서로 진행한다.

모든 이론이 하나의 model로 닫히면 하나로 간다.
실제 behavior가 갈리는 unresolved alternative가 있을 때만
최소 비교 단위의 variant를 만든다.

## 32.4 R3는 irreducible uncertainty만 받는다

다음 조건을 모두 만족하는 대안만 실험 후보로 남긴다.

```text
multiple plausible alternatives remain
material behavior / quality / cost / safety difference
difference is observable / measurable
```

가능하면 full architecture fork보다
같은 interface 아래 작은 policy / mechanism variant를 shadow한다.

## 32.5 Existing contracts remain closed

현재 Galpi의 CLOSED/FROZEN semantics,
특히 task/reminder operational SoT와 confirmation-before-write 같은 계약은
memory theory를 합성한다는 이유로 다시 열지 않는다.

## 32.6 Synthesis default

> **From here, subtraction and synthesis are more valuable than mechanism accumulation.**

> **Do not create subsystems to mirror theories. Create separate boundaries only when semantics, authority, lifecycle, failure policy, or experimentally unresolved behavior require them.**
