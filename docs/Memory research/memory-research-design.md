# XION Memory Research Design

> 상태: **DRAFT RESEARCH PROTOCOL**
>
> 기준일: 2026-08-26
>
> 목적: XION 개인화 장기기억 연구를 기존 시스템 조사, 자체 메커니즘 발명, Galpi shadow 실험으로 진행하기 위한 연구 정본 초안.
>
> 이 문서는 memory architecture의 구현 설계가 아니다. 연구 질문, 평가 원칙, 첫 실험 순서를 정의한다.

---

# 1. Research Goal

최상위 목표:

> **세상에서 가장 뛰어난 개인화 장기기억 시스템을 만든다.**

이를 위해:

1. 기존 장기기억 시스템과 연구의 핵심 mechanism을 조사한다.
2. 쓸 수 있는 기술은 적극적으로 가져온다.
3. 공통 실패 모드가 발견되면 새로운 mechanism도 직접 설계한다.
4. Galpi의 canonical/raw layer는 보호한다.
5. derived memory layer는 shadow에서 과감하게 실험한다.
6. 최종 architecture는 조사 결과와 실험 evidence를 기반으로 다시 설계한다.

핵심 원칙:

> **정본은 보수적으로, 기억 연구는 공격적으로.**

---

# 2. Product Target

XION의 목표는 사용자의 latent utility function을 완전히 복원하는 것이 아니다.

목표는:

> **한 사람과 장기간 지내면서 필요한 사실·경험·선호·결정·관계·패턴을 정확한 근거와 함께 기억하고, 현재 상황에 필요한 것만 적절히 떠올리는 비서**

다.

```text
Memory
≠ complete user model

Memory
= evidence + useful derived structures + retrieval policy
```

---

# 3. Research Tracks

## R1 — Landscape

기존 system / paper / benchmark / implementation 조사.

핵심 비교 축:
- representation
- write policy
- consolidation
- reconsolidation
- temporal state
- identity
- conflict
- forgetting
- reflection / belief
- procedural memory
- relationship memory
- routing / retrieval
- working / core memory
- provenance
- governance
- personalization
- learned memory policy
- efficiency

## R1-X — Innovation

기존 방식의 구체적 실패에서 자체 mechanism 가설 생성.

모든 자체 아이디어는:

```text
Problem
Hypothesis
Minimal Prototype
Baseline
Success Condition
Kill Condition
```

형태로 발전시킨다.

## R2 — Synthesis

R1/R1-X 결과로 2~4개의 의미 있게 다른 XION memory architecture 후보 구성.

## R3 — Experiment

Galpi shadow environment에서 후보/메커니즘 비교.

---

# 4. Current High-Potential Hypotheses

- Memory Forks
- Memory Hypothesis Loop
- Memory Predictions
- Active Memory Acquisition
- Adaptive Memory Specialization
- Memory Formatter Architecture
- Sparse Memory Routing
- Canonical Evidence/Event Ledger
- Explicit Memory + Neural Memory Controller
- Learned Memory Policy
- Shadow Counterfactual Supervision

아직 어느 것도 production architecture로 확정하지 않는다.

---

# 5. Canonical vs Derived Research Principle

현재 가장 강한 가설:

```text
Canonical:
evidence / event ledger

Derived:
graph views
ranking
forks
observations
formatter states
routing projections
entity-equivalence projections
```

사용자의 explicit comparison도 canonical ranking row가 아니라 evidence event다.

예:

```text
user_explicit_comparison:
A > B
```

Ranking formatter는 이를 재생성한다.

이 원칙은 연구 중 반례가 발견되면 재검토 가능하다.

---

# 6. First Experimental Target

첫 실제 비교 축:

```text
hard-gated
vs
global-soft-prior
```

둘 다 현재 Galpi assistant retrieval에 이미 존재한다.

첫 실험의 핵심 연구 질문:

> **LLM이 여러 memory chunk를 동시에 소비하는 상황에서 routing quality를 안정적으로 측정할 수 있는가?**

Routing winner를 고르는 것은 두 번째 목적이다.

---

# 7. Locked Experimental Decisions

## D0 — Routing

첫 비교 축은 routing.

## D1 — Usage Attribution

전량 cheap proxy + sampled Leave-One-Out calibration.

## D2 — Shadow Only

Production answer path에는 영향 없음.

## D3 — Equal Character Budget

동일 query에 대해 동일한 character context budget을 부여.

기본 baseline은 현재 8,000 characters.

mode/device별 실제 상한이 다르면 해당 mode의 동일 budget을 사용.

## D4 — False Memory as Constraint

```text
maximize helpfulness
subject to safety / UX / operational constraints
```

실제 threshold는 관측 후 calibration.

## D5 — Correction Gold

초기에는 deterministic explicit action만 gold signal로 사용.

## D6 — Shadow All-Write

Production heuristic이 버린 episode도 shadow candidate로 유지해 counterfactual coverage를 넓힌다.

---

# 8. First Measurement Questions

## F1 — Actual Request Volume

최우선.

측정:
- daily eligible requests
- retrieval activation rate
- mode/device breakdown
- retrieved chunk count
- context-char distribution
- context-cap hit rate

## F2 — Position Bias

Evidence order randomization으로 측정.

## F3 — Proxy vs LOO Agreement

Cheap attribution proxy의 오차율 calibration.

## F4 — Explicit Correction Frequency

Hard constraint를 rate로 검정할 수 있는지 판단.

## F5 — Redundancy

LOO/ablation에서 marginal contribution overlap 측정.

## F6 — Interleaving for LLM Multi-Evidence Use

IR interleaving의 이론/실증이 LLM context에서 유지되는지 조사.

---

# 9. First Experiment Baseline

Primary baseline은 interleaving이 아니라 paired shadow comparison.

```text
same request
same char budget

A:
hard-gated retrieval
→ shadow answer A

B:
global-soft-prior retrieval
→ shadow answer B
```

Interleaving은 별도 연구 lane으로 둔다.

---

# 10. Usage Attribution

## Cheap Proxies — All Requests

후보:
- structured memory-ID attribution
- answer/evidence entailment
- structured output/decision change
- citation marker
- lexical overlap

## Sampled Evaluation

```text
with memory_i
vs
without memory_i
```

LOO/ablation.

LLM nondeterminism을 고려해:
- fixed model/prompt
- temperature 0
- fixed seed where available
- 필요 시 paired repeated runs

목표:

> proxy를 truth로 쓰지 않고 proxy error를 측정한다.

---

# 11. Shadow Experimental Lanes

```text
RAW
모든 episode 보존

PRODUCTION
현재 policy
실제 사용자 answer

SHADOW-FULL
모든 candidate
사용자 영향 없음

SHADOW-EXPLORE
sampled include/exclude
사용자 영향 없음
```

Shadow-Full은 write-policy selection bias를 줄이지만 retrieval distribution shift가 생긴다.

Shadow-Explore는 후속 counterfactual/off-policy 실험 후보.

---

# 12. Outcome Labels

장기 memory outcome은 binary가 아닐 수 있다.

```text
positive:
실제로 도움됨 / 검증된 사용

negative:
실제로 잘못됨 / 방해됨 / explicit correction

unlabeled / censored:
아직 의미 있는 outcome이 관측되지 않음
```

`not retrieved yet`를 negative로 취급하지 않는다.

관련 연구:
- positive-unlabeled learning
- survival analysis
- delayed feedback
- logged bandit feedback

---

# 13. Objective Formulation

Scalar weighted score를 기본으로 하지 않는다.

후보:

```text
maximize:
future helpfulness

subject to:
false-memory <= X
elicitation burden <= Y
retrieval latency <= Z
resource/token budget <= B
```

우선순위:

1. catastrophic correctness / safety
2. UX / operation budget
3. helpfulness maximization

초기에는 Pareto frontier 비교 가능.

---

# 14. Execution Order

```text
1. 최신 main 확인
2. F1 actual request/retrieval logs 측정
3. hard-gated vs global-soft-prior retrieval-only replay
4. same-char-budget normalization
5. evidence-set difference rate 측정
6. sufficiently-different cases에 paired shadow generation
7. F2 position bias
8. cheap attribution logs
9. sampled LOO
10. F3 proxy calibration
11. first routing evaluation
12. F4/F5/F6
13. Shadow-All-Write expansion
14. formatter/write-policy/learned-routing experiments
```

---

# 15. First Experiment Non-Goals

- production routing 변경
- formatter 구현
- learned router 학습
- neural memory controller 구현
- 자연어 correction LLM classifier를 gold로 사용
- interleaving을 검증 없이 primary metric으로 사용
- scalar false-memory tradeoff
- full architecture implementation

---

# 16. R1 Completion Criteria

R1은 “읽을 논문이 없어질 때” 끝나지 않는다.

다음이 충족되면 saturation으로 간주:

- 핵심 mechanism 축마다 최소 2~3개의 의미 있게 다른 접근 비교
- 새로운 시스템을 추가해도 mechanism catalog의 주요 범주가 거의 늘지 않음
- 주요 architecture tradeoff가 반복적으로 재현됨
- 자체 가설의 baseline/실험 후보가 충분히 정의됨

---

# 17. Relationship to Brainstorm

`memory-research-brainstorm.md`는 자유로운 작업대다.

이 문서는 그중 현재 연구 운영에 필요한 부분만 정리한 **research protocol 초안**이다.

새 아이디어는 먼저 brainstorm에 들어가고, 충분히 검토된 뒤 research/design 문서로 승격한다.


---

# 18. Cross-Disciplinary Gap-Fill Pass

R1은 LLM memory system 조사에만 한정하지 않는다.

현재 XION 설계의 직접적인 빈칸을 오래 연구한 외부 분야가 있다면
해당 mechanism을 우선 조사한다.

## G1 — Truth Maintenance / Belief Revision

목표:

- Evidence와 assumption 분리
- multiple interpretations 공존
- correction vs world update 구분
- derived-belief dependency 추적
- minimal-change revision
- iterated revision

현재 연구 방향:

```text
Local Justification DAG
+ Local Nogoods
+ Belief-Base Revision
```

전역 ATMS environment lattice는 범위에서 제외한다.

## G2 — Active Preference Elicitation / Value of Information

목표:

- unresolved uncertainty 중 무엇을 물을지
- cognitive/interruption cost 반영
- explicit question 없이 evidence를 얻는 방법
- 사용자별 질문 형식 학습 가능성

현재 research hypothesis:

```text
routing overlap
→ downstream decision divergence
→ natural observation?
→ opportunistic elicitation?
→ explicit question?
```

VOI는 global user utility reconstruction이 아니라
**local decision improvement**에 사용한다.

---

# 19. Research Contract Additions

## RC1 — Evidence / Assumption Separation

Canonical evidence:

```text
user utterance
explicit action
correction event
task/candidate outcome
```

Interpretation assumption은 canonical evidence와 별개다.

Derived hypothesis는 최소:

```text
evidence_dependencies
assumption_dependencies
```

를 구분한다.

## RC2 — Change Semantics

새 evidence가 기존 derived state와 다를 때 최소:

```text
EXPANSION
WORLD_UPDATE
CORRECTION
ADDITIONAL_CONTEXT
CONTRADICTION
TEMPORAL_SCOPE_CHANGE
INTERPRETATION_REVISION
```

를 구분하는 실험을 한다.

특히:

```text
WORLD_UPDATE ≠ CORRECTION
```

을 강한 invariant 후보로 둔다.

## RC3 — Minimal Local Revision

Derived memory 수정은 가능한 한
영향받는 dependency component에 제한한다.

목표:

> **minimal epistemic change**

## RC4 — Elicitation Action Includes Do Nothing

후보 action space:

```text
DO_NOTHING
OBSERVE
OPPORTUNISTIC_QUERY
EXPLICIT_BINARY
EXPLICIT_PAIRWISE
ATTRIBUTE_CLARIFICATION
OPEN_CLARIFICATION
```

항상 질문하는 정책은 baseline이지 기본 설계가 아니다.

---

# 20. Experiment Additions

## E-G1 — Local Truth-Maintenance Fixture

Synthetic cases:

- ambiguous preference
- real world-state change
- explicit correction
- additional context resolving apparent contradiction
- overlapping hypotheses
- downstream dependency invalidation

검증:

- raw evidence never disappears
- only affected derived state changes
- correction does not become historical world-state
- world update preserves prior valid history
- invalid hypothesis provenance remains inspectable

## E-G2 — Elicitation Policy Fixture

Compare:

```text
A. Never Ask
B. Ask Every Ambiguity
C. Routing-Overlap Ask
D. VOI-Gated Ask
```

Measure:

```text
decision correctness
false personalization
questions per interaction
unnecessary question rate
answerability
future reuse
correction rate
```

## E-G3 — Opportunistic vs Explicit Elicitation

같은 uncertainty를:

```text
normal recommendation/choice interaction
vs
explicit clarification
```

으로 해결했을 때 비교한다.

---

# 21. Scope Guard for Gap-Fill Research

이번 연구는 다음을 의미하지 않는다.

- ATMS를 그대로 구현한다.
- global Bayesian user model을 만든다.
- 모든 Fork를 해결한다.
- 모든 belief에 persistent confidence score를 붙인다.
- arbitrary scalar utility function을 먼저 만든다.

목적은 XION의 빈칸에
**검증된 mechanism과 더 정확한 semantics를 공급하는 것**이다.


---

# 22. Gap-Fill Research Addition — Counterfactual Memory Policy Learning

## G3 — Contextual Bandits / Off-Policy Evaluation

목표:

- current memory policy가 만드는 selection bias를 측정한다.
- shadow execution의 counterfactual boundary를 명시한다.
- future learned policy에 필요한 logging contract를 정의한다.
- local binary policy에서 OPE instrument를 검증한다.
- whole-memory RL로 성급하게 확장하지 않는다.

## RC5 — Policy Decision Provenance

후보:

```text
context_ref
policy_version
available_actions
chosen_action
chosen_action_probability / propensity
shadow_actions
outcome_refs
reward_definition_version
```

## RC6 — Shadow Outcome Boundary

Shadow lane은 system-side counterfactual만 제공한다.

```text
candidate exists
retrieves
fits budget
changes answer
LOO contribution
```

다음은 shadow gold가 아니다.

```text
user satisfaction
user correction
future conversation trajectory
```

## RC7 — Support Matters

Target policy action은 historical support가 있어야 standard OPE가 식별 가능하다.

단, 첫 실험 D2 `shadow-only`는 유지한다.
live exploration은 현재 범위에서 제외한다.

## RC8 — Local Policy First

첫 learned policy 후보:

```text
WRITE
vs
NO_WRITE
```

Exact ordered chunk-set을 하나의 action으로 학습하는 것은 현재 비선호다.

## RC9 — Constraint-First Evaluation

Candidate policy는 평균 utility보다 먼저:

```text
false-memory
governance
hard contracts
```

위반 여부를 본다.

## E-G4 — Logged Write-Policy Replay

기록:

```text
policy version
chosen action
propensity
shadow alternative
future proxy outcomes
explicit outcome events
```

목표는 estimator winner가 아니라 evaluation-instrument validity다.

## E-G5 — IPS / DR Diagnostic

비교:

```text
naive observed average
IPS
DR-style estimate
```

관심:

```text
support coverage
weight concentration
effective sample size
variance
reward-model sensitivity
```

## E-G6 — Shadow Observability Audit

Outcome을:

```text
OBSERVABLE_IN_PRODUCTION
OBSERVABLE_IN_SHADOW
HUMAN_COUNTERFACTUAL_UNOBSERVABLE
DELAYED_OR_CENSORED
```

로 분류한다.

## Scope Guard

- XION 전체를 RL agent로 만들지 않는다.
- live randomized experimentation을 즉시 시작하지 않는다.
- shadow answer를 실제 user reward로 취급하지 않는다.
- exact retrieval-set policy를 먼저 학습하지 않는다.
- support 없는 counterfactual을 estimator가 알아낼 수 있다고 가정하지 않는다.


---

# 25. Gap-Fill Research Addition — Delayed / Censored Outcomes

## G4 — Survival / PU / Delayed Feedback

목표:

- `unobserved != negative`를 evaluation contract로 검증한다.
- calendar age와 relevant-opportunity age를 비교한다.
- explicit feedback의 selection bias를 측정한다.
- reward를 canonical field로 고정하지 않고 outcome events에서 재구성한다.
- formatter/domain별 outcome latency 차이를 측정한다.

## RC10 — Outcome-State Separation

Outcome은 최소:

```text
OBSERVED_POSITIVE
OBSERVED_NEGATIVE
UNOBSERVED_OR_CENSORED
```

를 구분한다.

No-feedback를 positive/negative로 자동 변환하지 않는다.

## RC11 — Opportunity Exposure

Memory evaluation은 가능하면:

```text
calendar_age
relevant_opportunity_count
policy_exposure_count
actual_retrieval_count
reader_use_count
```

를 분리한다.

`relevant opportunity` 정의 자체는 R3 fixture에서 operationalize한다.

## RC12 — Outcome Event Canonicality

Canonical candidate:

```text
RELEVANT_OPPORTUNITY
RETRIEVED
INJECTED
ANSWER_CHANGED
EXPLICIT_REUSE
EXPLICIT_APPROVAL
CORRECTED
SUPERSEDED
DELETED
DECISION_COMPLETED
```

Reward, survival label, PU label은 versioned projection이다.

## RC13 — Feedback Selection Bias

Explicit user feedback는 high-precision signal로 보되
representative sample로 가정하지 않는다.

Missing feedback의 mechanism을 분석 가능한 범위에서 기록한다.

## E-G7 — Opportunity-Adjusted Utility Audit

각 memory candidate에 대해 최소:

```text
age
relevant opportunities
retrieval opportunities
actual retrievals
actual injections
answer divergence count
explicit outcomes
first-use delay
reuse count
censoring state
```

를 분석한다.

질문:

- calendar age가 usefulness와 관계가 있는가
- opportunity-adjusted inactivity가 더 설명력이 있는가
- formatter별 first-use latency가 다른가
- reuse recurrence가 first-use와 다른 정보를 주는가

## E-G8 — Outcome Funnel Audit

각 candidate를:

```text
NO_RELEVANT_OPPORTUNITY
POLICY_NOT_EXPOSED
EXPOSED_NOT_USED
USED_NO_HUMAN_FEEDBACK
OBSERVED_POSITIVE
OBSERVED_NEGATIVE
```

등의 분석 category로 분류한다.

정확한 schema enum 확정이 목적은 아니다.
목표는 missing outcome을 하나의 unlabeled bucket으로 뭉갰을 때
얼마나 정보가 사라지는지 보는 것이다.

## Scope Guard

- global survival model을 즉시 채택하지 않는다.
- Kaplan-Meier를 그대로 memory lifespan estimator로 사용하지 않는다.
- unlabeled를 negative로 취급하지 않는다.
- explicit feedback를 unbiased gold distribution으로 가정하지 않는다.
- global forgetting horizon을 먼저 만들지 않는다.
- scalar reward를 canonical source of truth로 만들지 않는다.


---

# 26. Gap-Fill Research Addition — Complementary Learning & Consolidation Replay

## G5 — Complementary Learning Systems / Multiple Representations

목표:

- recent-only consolidation의 failure mode를 측정한다.
- structured replay가 false generalization / exception loss를 줄이는지 본다.
- schema-congruence가 model escalation의 좋은 gate인지 검증한다.
- `separate on write, associate on read`가 identity/retrieval tradeoff를 개선하는지 본다.
- Formatter 0..N parallel projection 가설을 검증한다.

## RC14 — Capture / Generalization Separation

Canonical evidence capture와
derived generalization update를 동일 operation으로 가정하지 않는다.

```text
capture fast
generalize conservatively
```

## RC15 — Consolidation Must See Counter-Evidence

Background consolidation candidate input에는
가능하면 다음을 포함한다.

```text
new evidence
related historical evidence
explicit corrections
contradictions
known exceptions
```

Recent-only summary를 default truth-update mechanism으로 가정하지 않는다.

## RC16 — Schema-Congruence Is a Routing Signal

후보:

```text
CONGRUENT
NOVEL
CONFLICTING
AMBIGUOUS
```

를 strong/cheap model routing feature로 시험한다.

이 값 자체를 canonical truth로 저장하지 않는다.

## RC17 — Write / Read Asymmetry

Identity and semantic merge experiment에서는:

```text
WRITE:
conservative separation

READ:
aggressive candidate association
```

가 false merge와 retrieval recall 사이의 tradeoff를 개선하는지 본다.

## E-G9 — Consolidation Replay Experiment

Compare:

```text
A. Recent-only
B. New + random old replay
C. New + structured/contrastive replay
```

Measure:

```text
false generalization
old-pattern retention
exception retention
correction consistency
token cost
latency
```

## E-G10 — Schema-Gated Model Cascade

Cases:

```text
stable schema-congruent
novel
conflicting
ambiguous
```

Compare:

```text
Always Strong Consolidation
vs
Schema-Gated Cascade
```

Measure:

```text
false update
missed update
escalation rate
latency
cost
```

## E-G11 — Separate-on-Write / Associate-on-Read

Identity fixtures:

```text
similar names
partial aliases
ambiguous relations
later correction
```

Compare:

```text
A. aggressive write-time merge
B. conservative separation + read-time association
```

Measure:

```text
false merges
retrieval recall
correction cost
contamination propagation
```

## Scope Guard

- biological hippocampus/neocortex implementation을 모방하지 않는다.
- human memory taxonomy를 formatter schema로 그대로 사용하지 않는다.
- recent evidence만으로 stable profile을 재작성하지 않는다.
- abstraction 생성 후 raw episode를 삭제하지 않는다.
- sleep stage / neural circuit timing을 software schedule 근거로 사용하지 않는다.


---

# 27. Gap-Fill Research Addition — Event / Associative Retrieval

## G6 — Event Segmentation, Context Reinstatement, Associative Retrieval

목표:

- session/fixed chunk와 semantic event segmentation을 비교한다.
- event-first retrieval이 flat retrieval보다 실제 answer quality를 높이는지 검증한다.
- `retrieval unit != reader context unit` 가설을 테스트한다.
- associative expansion의 recall gain과 drift/contamination cost를 측정한다.
- broad retrieval / narrow mutation split이 false-memory risk를 낮추는지 본다.

## RC18 — Event Segmentation Is Derived

Message/action history는 canonical하다.

Event membership / hierarchy / summary / transition은 rebuildable projection이다.

```text
raw evidence
→ event segmentation vN
```

## RC19 — Event Membership ≠ Association

`same event`와 `related event`를 동일 relation으로 취급하지 않는다.

Temporal proximity도 association prior일 뿐 merge rule이 아니다.

## RC20 — Retrieval Provenance

Associative candidate는 가능한 경우:

```text
source_anchor
why_retrieved
association_path
depth
```

를 남긴다.

Reader가 direct hit와 associative expansion을 구분할 수 있게 한다.

## RC21 — Retrieval Unit / Context Unit Separation

검색 anchor와 reader context를 같은 단위로 강제하지 않는다.

Candidate architecture:

```text
small anchor
→ locate event/context
→ reconstruct canonical evidence package
```

## RC22 — Broad Read / Narrow Mutation

Read-time retrieval은 recall을 위해 넓힐 수 있지만 mutation/reconsolidation scope는 provenance/dependency-confirmed subset으로 제한한다.

Working maxim:

> **Write conservatively. Retrieve associatively. Mutate by provenance.**

## E-G12 — Flat vs Event-Hierarchical Retrieval

Compare:

```text
A. flat chunk retrieval
B. event-first → event-local evidence
C. event-first + typed associative expansion
```

Measure:

```text
answer correctness
retrieval recall
irrelevant-context rate
context chars
latency
false association
```

## E-G13 — Retrieval Unit ≠ Context Unit

Compare:

```text
A. retrieved chunk directly injected
B. small anchor → raw event-context reconstruction
```

Measure:

```text
retrieval precision
answer factuality
context completeness
token budget
```

## E-G14 — Boundary Policy

Compare:

```text
A. session boundary
B. fixed chunks
C. semantic event boundary
D. conservative semantic boundary + associative bridge
```

Measure:

```text
false split
false merge
cross-event recall
within-event coherence
downstream answer accuracy
```

## E-G15 — Associative Cascade

Compare:

```text
A. direct retrieval only
B. unrestricted associative expansion
C. typed + budgeted associative expansion
```

Measure:

```text
recall gain
precision loss
topic drift
token explosion
answer contamination
```

## E-G16 — Read Neighborhood vs Mutation Neighborhood

Construct fixtures where broad associative candidates are useful for answering but only a small provenance-confirmed subset is safe to mutate.

Compare:

```text
A. same neighborhood for read/update
B. broad read + narrow provenance-scoped update
```

Measure:

```text
answer recall
unrelated memory mutation
correction propagation
false-memory contamination
```

## Scope Guard

- session/day boundary를 event truth로 고정하지 않는다.
- temporal proximity로 merge하지 않는다.
- associative expansion을 unbounded BFS로 구현하지 않는다.
- event summary를 canonical truth로 만들지 않는다.
- retrieved association을 user fact로 승격하지 않는다.
- broad retrieval candidate set을 그대로 mutation scope로 사용하지 않는다.


---

# 28. Gap-Fill Research Addition — Reconsolidation / Prediction-Error Maintenance

## G7 — Reconsolidation / Prediction-Error-Gated Maintenance

목표:

- retrieval-triggered rewrite의 unnecessary mutation을 측정한다.
- mismatch-gated local reconsolidation이 global/periodic rewrite보다 안전하고 저렴한지 본다.
- update-vs-fork policy가 history preservation과 false overwrite를 개선하는지 검증한다.
- canonical replay가 summary-of-summary drift를 줄이는지 본다.

## RC23 — Retrieval Does Not Grant Write Permission

```text
RETRIEVED
≠
REWRITE
≠
REINFORCE
```

기본 read path는 memory mutation을 일으키지 않는다.

## RC24 — Reconsolidation Trigger

후보 trigger:

```text
explicit correction
meaningful prediction mismatch
high-impact contradiction
```

Retrieval count / mere access는 trigger로 쓰지 않는다.

## RC25 — Canonical Replay

High-impact reconsolidation은 최소 다음을 다시 본다.

```text
original support evidence
new canonical evidence
known counterevidence
explicit corrections
relevant assumptions
```

Derived summary alone을 source of truth로 쓰지 않는다.

## RC26 — Provenance-Scoped Mutation

Mutation scope는 broad retrieval neighborhood가 아니라
Justification / dependency reachability로 제한한다.

## RC27 — Atomic Derived-State Revision

Revision candidate는 validate 후 atomic하게 commit한다.

Failure 시 old derived state 유지.
Canonical evidence는 수정하지 않는다.

## E-G17 — Global vs Retrieval vs Mismatch-Gated Maintenance

Compare:

```text
A. periodic/global consolidation
B. every retrieval → reconsolidate
C. activation + meaningful mismatch → local reconsolidation
```

Fixture:

```text
stable preference repetition
irrelevant retrieval repetition
small contextual exception
explicit correction
true state change
large out-of-schema evidence
downstream dependencies
```

Measure:

```text
unnecessary rewrites
false-memory mutations
correction propagation accuracy
exception preservation
compute/token cost
stale-derived-state duration
global regression
```

## E-G18 — Update vs Fork

Compare:

```text
A. always modify existing memory
B. always create new memory
C. classify mismatch → integrate / revise / fork
```

Cases:

```text
compatible detail
explicit correction
world state change
strong contradictory statement
new context
```

Measure:

```text
history preservation
false overwrite
duplicate proliferation
query-time ambiguity
later correction recoverability
```

## E-G19 — Summary Drift

Compare:

```text
A. derived-summary → derived-summary rewrite chain
B. canonical-evidence replay for each high-impact revision
```

Measure:

```text
factual drift
unsupported additions
provenance recoverability
correction consistency
```

## Scope Guard

- every retrieval을 rewrite trigger로 사용하지 않는다.
- biological reconsolidation time window를 software clock으로 복사하지 않는다.
- prediction error를 arbitrary persistent scalar truth로 저장하지 않는다.
- large mismatch를 자동 overwrite하지 않는다.
- retrieval frequency를 support/confidence로 직접 사용하지 않는다.
- derived summary chain만으로 high-impact memory를 재작성하지 않는다.


---

# 29. Gap-Fill Research Addition — Procedural / Teachable Skills

## G8 — Procedural Memory / Skill Learning

목표:

- declarative memory와 procedural memory의 책임 경계를 검증한다.
- episode reuse와 distilled skill의 transfer tradeoff를 측정한다.
- skill granularity / routing / update policy를 비교한다.
- explicit user-taught skill과 learned skill이 공통 invocation contract를 공유할 수 있는지 검토한다.

## RC28 — Procedural Plane Separation

Procedural Skill은 declarative Formatter의 subtype으로 강제하지 않는다.

```text
Declarative projection → Reader
Procedural projection  → Controller
```

## RC29 — Skill Promotion Gate

한 번 성공한 execution episode를 즉시 active skill로 만들지 않는다.

```text
episode
→ skill candidate
→ transfer / verification
→ active
```

## RC30 — Minimum Skill Contract

후보 최소 구조:

```text
applicability / trigger
preconditions
goal
procedure
termination
verification
```

Exact schema는 R2/R3 synthesis에서 확정한다.

## RC31 — Skill Is Derived

Canonical sources:

```text
explicit instruction
execution episode
tool result
verification outcome
correction
```

Skill / workflow는 rebuildable / versioned derived state다.

## RC32 — Governance Is External to Skill Learning

Skill은 hard permission / safety / authorization policy를
학습으로 제거하거나 override할 수 없다.

## RC33 — User-Taught / Registered Skills

명시 등록된 external capability를 procedural memory에 연결할 수 있다.

핵심 boundary:

```text
external code / robot controller
= executable source of truth

XION skill registry
= invocation contract + provenance + governance metadata
```

UI는 별도 product layer로 미룬다.

## RC34 — Registration ≠ Authorization

```text
skill exists
≠
applicable
≠
authorized
```

Side-effectful skill은 runtime governance를 반드시 통과한다.

## RC35 — Executor Version Provenance

External registered skill은 가능한 경우:

```text
executor_id
executor_version / hash
registration source
validation receipt
```

를 가져야 한다.

Backend version change는 revalidation trigger 후보.

## E-G20 — Episode vs Skill

Compare:

```text
A. no memory
B. raw successful episode
C. distilled skill
D. skill + supporting episode
```

Contexts:

```text
same task
surface variant
context shift
adversarial case
composition
```

Measure:

```text
local success
transfer
negative transfer
context tokens
latency
```

## E-G21 — Skill Granularity

Compare:

```text
A. whole-task skill
B. subtask skill
C. atomic micro-skill
```

Measure:

```text
transfer
composition
invocation precision
library size
negative transfer
```

## E-G22 — Skill Update Policy

Compare:

```text
A. update after every use
B. update after every failure
C. mismatch / correction gated
D. frozen skill
```

Measure:

```text
drift
coverage
transfer
regression
token / cost
```

## E-G23 — Registered External Skill Contract

Prototype a harmless external capability with a versioned executor.

Compare:

```text
A. tool exposed directly with ad-hoc prompt
B. registered skill with applicability / input / termination / verification metadata
```

Measure:

```text
invocation precision
schema adherence
verification success
wrong-context activation
version-change handling
auditability
```

The robot-arm case is a motivating example, not the first required experimental target.

## Deferred UI

Later product/UI design may include:

```text
skill registration
edit / version view
dry-run / test
enable / disable
permission review
execution log
```

This UI is explicitly out of scope for the current memory research phase.

## Scope Guard

- user-registered skill UI를 지금 설계하지 않는다.
- external algorithm source code를 memory canonical truth로 복제하지 않는다.
- registered skill을 automatic authorization으로 해석하지 않는다.
- learned skill이 hard governance를 override하게 하지 않는다.
- one-shot successful trajectory를 automatic active skill로 승격하지 않는다.


---

# 30. Gap-Fill Research Addition — Prospective Memory / Selective Intervention

## G9 — Prospective Memory / Future Intentions

목표:

- time-based와 event/context-based prospective triggers를 분리해 평가한다.
- always-monitor와 context-gated monitoring의 비용/오류 tradeoff를 측정한다.
- completion deactivation이 duplicate/commission error를 막는지 검증한다.
- reminder quality를 omission뿐 아니라 false trigger / interruption cost까지 포함해 평가한다.

## RC36 — Commitment State Remains Operational

기존 task/reminder SQLite source of truth를 memory projection으로 교체하지 않는다.

Memory research는:

```text
when to reactivate
how to route cues
when to intervene
```

를 추가로 연구한다.

## RC37 — What / Cue / Execution Separation

Prospective intention은 최소 conceptual하게:

```text
intended content
trigger / cue
activation state
result / completion
```

을 분리한다.

Exact schema는 후속 synthesis에서 결정한다.

## RC38 — Context-Gated Monitoring

Long-horizon event/context intention은 모든 turn에 전체 intention set을 직접 검사하지 않는다.

```text
all intentions
→ cheap context router
→ relevant armed subset
→ cue evaluator
```

## RC39 — Completion Deactivation

완료/취소된 intention은 historical retrieval 가능성을 유지하면서 future execution trigger를 비활성화한다.

## RC40 — Intention Detection Is Not Commitment Creation

Future-oriented statement를 자동 task/commitment로 승격하지 않는다.

Confirmed commitment는 기존 user-confirmation contract를 따른다.

## RC41 — Selective Intervention

Reminder / proactive behavior를 평가할 때:

```text
omission
commission
false trigger
late trigger
interruption cost
```

를 함께 본다.

## E-G24 — Always Monitor vs Context-Gated

Create multiple long-horizon event-based intentions.

Compare:

```text
A. evaluate every active intention every turn
B. context/event route → evaluate relevant subset only
```

Measure:

```text
trigger recall
false activation
tokens
latency
router misses
```

## E-G25 — Always Surface vs Selective Intervention

Research branch only; do not modify current production schedule injection contract.

Compare:

```text
A. surface all relevant active commitments continuously
B. surface only when intervention threshold is reached
```

Measure:

```text
task success
omission
false trigger
interruption count
context chars
```

## E-G26 — Completion Deactivation

After completion/cancel, repeatedly present the old cue.

Measure:

```text
re-trigger rate
duplicate action
duplicate reminder
historical retrieval preservation
```

## E-G27 — Cue Specificity

Compare:

```text
exact system event
structured event/state
semantic context
broad inferred context
```

Measure:

```text
omission
false trigger
latency
authority level needed
```

## Scope Guard

- current C1/C2 task/reminder semantics를 다시 열지 않는다.
- future-oriented remark를 자동 commitment로 저장하지 않는다.
- semantic/inferred cue를 곧바로 high-impact side effect와 연결하지 않는다.
- completed intention의 trigger를 history retention과 묶어서 유지하지 않는다.
- every-turn full-intention monitoring을 default로 만들지 않는다.


---

# 31. Gap-Fill Research Addition — Identity Repair / Relationship Closeness

## G10 — Identity Resolution / Relationship Closeness

목표:

- 이름/alias와 identity를 분리한다.
- 사람 identity collision의 fail-close / elicitation policy를 검증한다.
- evidence clustering이 identity repair 질문 수를 줄이는지 본다.
- closeness가 reference resolution prior로 유용한지 보되 identity proof로 사용하지 않는다.

## RC42 — Name Is Alias, Not Identity

Entity identity는 이름 문자열로 결정하지 않는다.

```text
one alias → multiple entities
one entity → multiple aliases
```

를 허용한다.

## RC43 — Identity Collision Is Fail-Close

다음과 같은 상황에서는 기존 entity에 새 evidence를 unsafe merge하지 않는다.

```text
same alias clearly maps to multiple entities
existing facts become incompatible
prior entity may need split
identity choice changes answer/action
downstream contamination is plausible
```

Canonical evidence는 보존하고 identity assignment를 unresolved로 둘 수 있다.

## RC44 — Active Identity Repair

Identity collision은 ordinary ambiguity보다 높은 elicitation priority를 가진다.

다만 먼저 local evidence clustering을 수행해
질문 수를 줄인다.

Candidate clustering signals:

```text
same event
temporal adjacency
explicit descriptors
relationship cues
co-occurrence / provenance
```

질문은 cluster partition을 최대한 많이 확정하는 discriminative question을 우선한다.

## RC45 — Ambiguous Is Valid

사용자도 어느 entity였는지 모르는 evidence는
강제로 하나에 assign하지 않는다.

```text
AMBIGUOUS(entity_A, entity_B)
```

상태를 허용한다.

## RC46 — Identity Repair Rebuilds Derived Links

Entity split / merge 시 canonical evidence를 rewrite하지 않는다.

Rebuild candidates:

```text
entity assignments
relationships
event links
hypotheses
reference priors
other dependent projections
```

## RC47 — Closeness Is Relationship State

Closeness는 Entity 자체의 intrinsic field로 강제하지 않는다.

```text
Relationship(USER, PERSON)
→ closeness
```

로 표현하는 방향을 우선한다.

Exact scale / enum / scoring은 아직 OPEN이다.

## RC48 — Closeness Is Not Conversational Salience

Runtime reference resolution은 별도 derived prior를 사용할 수 있다.

Candidate signals:

```text
current context
event membership
relationship closeness
mention recency / frequency
active project
explicit descriptors
```

Closeness 단독으로 identity를 결정하지 않는다.

## E-G28 — Identity Collision Repair

Construct fixtures where one stored person entity actually represents two people.

Compare:

```text
A. keep merging by alias
B. ask per-fact clarification
C. cluster evidence → ask discriminative partition questions
```

Measure:

```text
wrong-merge contamination
questions asked
resolved evidence fraction
downstream repair accuracy
user burden
```

## E-G29 — Reference Prior

Create multiple same-alias entities with different relationship/context patterns.

Compare:

```text
A. name-only candidate ranking
B. current context only
C. context + relationship closeness + mention/event signals
```

Measure:

```text
top-1 reference accuracy
abstention / ask rate
false confident resolution
```

Hard guard:

```text
derived prior
≠
identity proof
```

## Scope Guard

- 별도 Social Memory subsystem을 만들지 않는다.
- 이름을 entity primary identity로 사용하지 않는다.
- identity collision을 silent merge로 해결하지 않는다.
- closeness를 고정된 인간 가치/성격 점수로 해석하지 않는다.
- 행동 빈도만으로 closeness를 hard truth로 확정하지 않는다.
- closeness/reference prior가 conflict evidence를 override하게 하지 않는다.


---

# 32. Gap-Fill Research Addition — Core / Working Memory

## G11 — Core / Working Memory

목표:

- always-visible Core와 current Working Set을 분리한다.
- Rich User Profile을 Core에 복제하는 방향을 거부하고 User Model과 역할을 분리한다.
- Tiny Stable Core가 retrieval-only baseline보다 유용한지 검증한다.
- Working Set은 ephemeral derived projection으로 유지한다.

## RC49 — Working Memory Is Not a Persistent Source of Truth

Working Set은 별도 canonical DB가 아니다.

```text
Current Event
+ Operational State
+ Retrieved Evidence
+ Relevant Entities / Relationships
+ Forks
+ Prospective State
→ Dynamic Working Set
```

Event/task transition 이후 폐기하고 필요하면 재구성한다.

## RC50 — Attention State Is Not Evidence

현재 reasoning context에 들어갔다는 사실만으로
memory write / reinforcement / truth update를 만들지 않는다.

```text
retrieved
≠ used
≠ correct
≠ evidence
```

## RC51 — Tiny Stable User Core Is the Selected Direction

비교 후보:

```text
A. No Core / retrieval only
B. Tiny Stable User Core
C. Rich always-visible user profile
```

현재 선택 방향은 **B**다.

C는 User Model과 역할 중복, stale profile, global bias,
context budget 낭비 때문에 기본적으로 거부한다.

## RC52 — Core Is a Projection of Evidence / User Model

Core는 independent source of truth가 아니다.

```text
Canonical Evidence / User Model
→ Core Projection
→ always-visible context
```

Core 수정은 upstream evidence/model revision을 통해 반영한다.

## RC53 — Important Does Not Mean Core

Core promotion은 중요도 순위가 아니다.

Candidate criteria:

```text
global applicability
temporal stability
safe if always visible
cross-context usefulness
strong provenance
no unresolved contradiction
```

Current goal / current project는 기본적으로 Working Set 또는 User Model에 남긴다.

## RC54 — Core Promotion Is Stricter Than Ordinary Memory Write

Always-visible information의 오류 비용이 더 크므로
Core promotion threshold는 ordinary memory write보다 높게 둔다.

Exact promotion policy는 OPEN.

## RC55 — Governance Is Separate

다음은 memory Core로 취급하지 않는다.

```text
permissions
safety rules
confirmation contracts
tool authority
project governance
```

이들은 별도 governance/system contract 계층에 남긴다.

## E-G30 — Core Strategy Comparison

Compare under equal context budget:

```text
A. No Core
   retrieval only

B. Tiny Stable Core
   + dynamic working set

C. Rich Fixed Core
   large user profile always visible
```

Fixture classes:

```text
stable user anchor
changed preference
context-specific preference
old goal replaced by new goal
same-name entities
unrelated query
multi-session active project
```

Measure:

```text
personalization accuracy
retrieval miss
obsolete-memory error
irrelevant-memory influence
false assumption
context chars
latency
correction propagation
```

Do not assume B wins before measurement.

## E-G31 — Working Set Assembly

Compare:

```text
A. raw retrieved chunks only
B. current event + retrieved chunks
C. event + active operational state + retrieved evidence + unresolved relevant state
```

Measure:

```text
answer correctness
context chars
irrelevant carryover
cross-turn continuity
event-boundary reset errors
```

## Scope Guard

- Rich User Model을 Core에 복제하지 않는다.
- Working Set 자체를 canonical memory로 저장하지 않는다.
- retrieval/attention만으로 reinforcement하지 않는다.
- current goal을 stable Core로 자동 승격하지 않는다.
- governance contract를 learned memory와 섞지 않는다.
- Tiny Core의 exact size/fields를 구현 전에 고정하지 않는다; 먼저 experiment / synthesis에서 promotion contract를 정한다.


---

# 33. Gap-Fill Research Addition — Forgetting / Retention

## G12 — Forgetting / Accessibility

목표:

- ordinary forgetting과 canonical deletion을 분리한다.
- age-only decay를 baseline 이상으로 신뢰하지 않는다.
- opportunity-adjusted accessibility가 retrieval quality를 개선하는지 본다.
- frequent-retrieval self-reinforcement가 rare evidence를 묻는지 측정한다.

## RC56 — Ordinary Forgetting Is Accessibility Reduction

기본 방향:

```text
canonical evidence remains
→ accessibility / activation may fall
```

오래됐다는 이유만으로 canonical evidence를 삭제하지 않는다.

## RC57 — Semantic Invalidity, Accessibility, Erasure Are Separate

```text
SEMANTIC INVALIDITY
superseded / invalidated current state

ACCESSIBILITY
retrieval activation / ranking

ERASURE
privacy / user deletion / retention governance
```

세 개를 같은 field 의미로 합치지 않는다.

## RC58 — Age Is a Weak Signal, Not the Policy

Global exponential decay를 기본 contract로 두지 않는다.

Candidate signals:

```text
relevant_opportunities
retrieval_opportunities
actual_retrievals
actual_downstream_use
explicit_outcomes
supersession
current_context
wall_clock_age
```

Wall-clock age는 하나의 약한 feature로만 둘 수 있다.

## RC59 — Retrieval Frequency Is Not Utility

```text
retrieved
≠ useful
used
≠ correct
frequency
≠ importance
```

Retrieval count 단독 automatic reinforcement를 금지한다.

## RC60 — Rare-but-Critical Memories Must Remain Recoverable

Low-accessibility memory도
strong exact / entity / event / provenance cue가 있으면
다시 검색될 수 있어야 한다.

## RC61 — Archive Is Not Semantic Validity

HOT/WARM/COLD/ARCHIVE tier가 필요해져도
storage/runtime optimization으로 먼저 취급한다.

Archive state가 current validity / importance를 결정하게 하지 않는다.

## E-G32 — Age Decay vs Opportunity-Adjusted Accessibility

Compare:

```text
A. no decay
B. age-only decay
C. opportunity-adjusted accessibility
```

Fixture classes:

```text
old but never had a relevant opportunity
old and repeatedly irrelevant
rare-but-critical memory
recent but superseded memory
historical query
```

Measure:

```text
current-answer correctness
historical recall
rare-memory recall
irrelevant retrieval
obsolete-memory use
```

## E-G33 — Retrieval Self-Reinforcement

Compare:

```text
A. retrieval count boosts rank directly
B. retrieval count ignored
C. downstream verified-use / outcome signals only
```

Measure:

```text
candidate diversity
counterevidence recall
rare-memory recall
feedback-loop concentration
answer quality
```

## Scope Guard

- canonical evidence를 age로 삭제하지 않는다.
- superseded와 inaccessible을 합치지 않는다.
- archive/cold를 semantic invalidation으로 사용하지 않는다.
- privacy deletion은 다음 governance pass와 분리한다.
- exact numeric decay parameter를 지금 결정하지 않는다.

---

# 34. Gap-Fill Research Addition — Longitudinal Identity / Agent Self-History

## G13 — Longitudinal Identity

목표:

- same user identity와 changing temporal state를 분리한다.
- Current User Model과 Historical User Model(t)를 비교 가능하게 만든다.
- SELF-CONCEPT CLAIM과 inferred trait를 분리한다.
- User Life / Shared / XION Self-History의 provenance-separated autobiography가 실용적인지 평가한다.

## RC62 — Identity Persists Across State Change

Preference / role / goal / relationship 변화만으로
user entity를 split하지 않는다.

```text
same user
→ multiple temporal states
```

## RC63 — Current and Historical User Model

User Model은 static latest profile이 아니라
temporal projection으로 볼 수 있어야 한다.

```text
UserModel(now)
UserModel(t)
```

Exact materialization strategy는 OPEN.

## RC64 — WORLD UPDATE vs CORRECTION Remains Distinct

```text
changed over time
→ WORLD UPDATE

previous statement was wrong
→ CORRECTION
```

기존 revision machinery를 재사용한다.

## RC65 — SELF-CONCEPT CLAIM Is a Separate Evidence Type Candidate

Explicit self-description:

```text
"I am the kind of person who..."
```

를 objective trait로 자동 승격하지 않는다.

```text
SELF_CONCEPT_CLAIM
≠
OBJECTIVE_TRAIT
```

Behavior-derived personality interpretation은
revisable hypothesis로 둔다.

## RC66 — Preserve History, Do Not Auto-Author User Narrative

Temporal life history는 보존한다.

Meaning-level coherent life story는
사용자가 직접 말했거나 충분히 검증된 별도 evidence가 없는 한
truth로 만들지 않는다.

## RC67 — Three Provenance-Separated Autobiographical Layers

사용자 선택: **B — full autobiographical scope**.

```text
USER LIFE HISTORY
SHARED XION-USER HISTORY
XION SELF-HISTORY
```

세 층을 연결할 수 있지만 source 의미를 섞지 않는다.

## RC68 — XION Self-History Is Derived From Canonical System Events

Candidate system events:

```text
capability add/remove
deployment
design decision
failure
user correction
verified success
contract change
research decision
```

Pipeline:

```text
Canonical System Events
→ System Self-History
→ Current Self-Model
→ Tiny System Core
```

## RC69 — Self-History Is Not Current Capability Truth

Source hierarchy candidate:

```text
CURRENT OPERATIONAL STATE
>
DECLARED DESIGN CONTRACT
>
SYSTEM SELF-HISTORY
>
INFERRED NARRATIVE
```

Runtime capability/config/code가 Self-History보다 우선한다.

## RC70 — XION Autobiography Without Mythology

강한 guard:

> **XION may maintain an autobiography, but not author its own mythology.**

System history에서 의미를 추론해야 한다면
`Narrative Hypothesis`로 분리한다.

## E-G34 — Current vs Historical User Model

Fixture:

```text
preference changes
goal changes
relationship state changes
self-concept changes
corrections that rewrite past belief
```

Compare:

```text
A. latest-profile overwrite
B. temporal state projection
```

Measure:

```text
current answer correctness
historical answer correctness
world-update/correction confusion
obsolete-state leakage
```

## E-G35 — Self-Concept Claim Handling

Compare:

```text
A. explicit self-description → hard trait
B. explicit self-description → self-concept claim
C. behavior-only trait inference
```

Measure:

```text
false trait generalization
context sensitivity
correction handling
longitudinal change handling
```

## E-G36 — System / Shared History Utility

Queries:

```text
"why does this rule exist?"
"when did this capability change?"
"what failure caused this design?"
"what did we decide together?"
```

Compare:

```text
A. current docs / current state only
B. git/design history retrieval
C. provenance-linked User/Shared/XION Self-History
```

Measure:

```text
causal provenance accuracy
hallucinated rationale
history reconstruction completeness
context cost
current-state confusion
```

## Scope Guard

- user history를 coherent personality narrative로 자동 truth화하지 않는다.
- user state changes를 entity splits로 만들지 않는다.
- self-concept를 objective personality diagnosis로 저장하지 않는다.
- XION Self-History가 code/config/current runtime state를 override하지 않는다.
- Shared History에 user-only events를 복제하지 않는다; interaction relevance가 있어야 한다.
- XION의 unsupported identity mythology를 canonical memory로 만들지 않는다.


---

# 35. Procedural Research Amendment — Executor-Relative Skill Granularity

## G14 — Hierarchical Skill Compilation / Executor Deployment

목표:

- skill granularity를 executor-relative contract로 재정의한다.
- semantic primitive와 hardware-overfit actuator primitive를 비교한다.
- Macro-first / Primitive-fallback planning의 효과를 측정한다.
- 반복 조합을 validated Macro로 승격하고 executor-local registry에 deploy하는 구조를 검증한다.

## RC71 — Skill Granularity Is Executor-Relative

Skill을 전역적으로 같은 크기로 쪼개지 않는다.

```text
XION view
→ semantic macro / semantic primitive

executor view
→ task decomposition

controller view
→ IK / trajectory / feedback

actuator view
→ joint / motor commands
```

강한 contract:

```text
atomicity
= relative to interface boundary
```

## RC72 — Primitive Must Be Semantic and Reusable

XION-visible primitive는 다음 성질을 우선한다.

```text
parameterizable
hardware-agnostic where practical
semantic/task-space meaning
stable across calibration changes
composable by planner
verifiable
```

다음과 같은 actuator-overfit primitive는
일반 XION skill interface에서 기본적으로 금지한다.

```text
move_left(n_ticks)
joint_delta(n)
motor_for(ms)
```

좌표 primitive에는 coordinate frame을 포함한다.

## RC73 — Macro-First / Primitive-Fallback

Planning policy candidate:

```text
retrieve applicable macro
→ if validated + compatible + authorized: execute macro
→ otherwise compose semantic primitives
```

Macro 존재가 primitive access를 제거하지 않는다.

Macro 실패 / unsupported task / novel task에서는
primitive composition으로 내려갈 수 있어야 한다.

## RC74 — Repeated Composition Creates Candidate, Not Truth

Repeated primitive sequence는 Macro candidate 생성 신호다.

ACTIVE promotion 전 검증 후보:

```text
goal equivalence
input parameterization
precondition stability
termination stability
verification stability
variation robustness
hidden-context dependence
executor compatibility
```

Frequency alone은 promotion criterion이 아니다.

## RC75 — Active Macro Is Deployed to Executor When Supported

Local macro-capable executor에서는:

```text
canonical Skill Registry
→ deploy
→ executor-local Macro Registry
```

를 사용한다.

이 deployment는 canonical memory write가 아니라
executable projection/materialization이다.

## RC76 — Canonical Contract and Deployed Projection Are Separate

Canonical side:

```text
skill_id
version
applicability
inputs
preconditions
termination
verification
executor compatibility
validation receipt
permission / side-effect metadata
implementation reference
```

Executor side:

```text
macro_id
version
hash
compiled program / runtime reference
deployment receipt
```

Version/hash mismatch는 silent execution하지 않는다.

Candidate handling:

```text
re-deploy
or fail-close
or primitive fallback when allowed
```

## RC77 — Execution Provenance Remains Decomposable

Macro는 planning abstraction일 수 있지만
underlying executor trace를 남긴다.

Failure analysis:

```text
macro
→ lower-level step trace
→ failing primitive/controller phase
→ macro revision / invalidation / revalidation
```

## E-G37 — Primitive Granularity

Compare:

```text
A. actuator-level primitives
B. task-space semantic primitives
C. semantic primitives + stable macros
```

Tasks:

```text
same robot / same calibration
same robot / changed calibration
different robot backend
novel composition
repeated common task
```

Measure:

```text
task success
planner token/tool-call cost
hardware transfer robustness
overfit failures
latency
debuggability
```

Hypothesis:
actuator-level interface may fit narrow fixtures but transfer poorly.

## E-G38 — Macro-First vs Primitive-Only

Compare:

```text
A. primitive-only planning
B. macro-first + primitive fallback
```

Use repeated household-like tasks plus novel variants.

Measure:

```text
tool calls
latency
success rate
recovery rate
planner errors
executor-local continuity
```

## E-G39 — Macro Promotion

Candidate policies:

```text
A. promote after repetition count only
B. repetition + same-goal clustering
C. parameterization + variation/replay validation
```

Measure:

```text
false promotion
negative transfer
success across variation
macro reuse
fallback frequency
```

Expected hard guard:
frequency-only promotion should not be treated as safe by default.

## E-G40 — Executor Deployment Consistency

Test:

```text
canonical macro v3
executor has v2
executor has v3 wrong hash
executor missing macro
executor updated successfully
```

Measure:

```text
silent stale execution
fail-close behavior
re-deploy success
primitive fallback correctness
receipt completeness
```

## Scope Guard

- XION이 robot IK / trajectory / motor commands를 memory contract로 소유하지 않는다.
- primitive를 hardware-specific tick/joint action까지 강제 분해하지 않는다.
- macro가 있다고 primitive interface를 제거하지 않는다.
- 반복만으로 macro를 ACTIVE로 승격하지 않는다.
- executor-local macro list를 canonical source of truth로 취급하지 않는다.
- macro deployment가 permission/governance를 우회하지 않는다.
- macro execution 성공만으로 underlying skill contract를 자동 rewrite하지 않는다.


---

# 36. Architecture Extension — Shared Memory / Specialist Conversational Identity

## G15 — Multi-Specialist Shared-Memory Architecture

목표:

- specialist별 독립 long-term truth silo 없이 전문성을 분리할 수 있는지 본다.
- specialist Role Core / Working Set / retrieval lens의 효용을 검증한다.
- explicit conversational handoff가 continuity와 specialist depth를 함께 만족하는지 본다.
- user-created chat/session spaces를 memory boundary가 아닌 context-organization layer로 유지한다.

## RC78 — Shared Canonical Memory, Specialist-Local Cognitive State

기본 방향:

```text
Shared:
Canonical Evidence Ledger
Temporal User Model
Entity / Relationship / Event state
Shared History
XION Self-History
Skill contracts
System Core

Local:
Role Core
Working Set
retrieval lens
active goals
tools
derived domain experience
```

독립 specialist DB에 user truth를 복제하지 않는다.

## RC79 — System Core vs Role Core

```text
System Core
→ XION's shared identity / global governance / broad role

Role Core
→ specialist domain role / contracts / tool boundaries
```

Role Core는 user truth 저장소가 아니다.

## RC80 — Specialist Working Sets Are Ephemeral

각 specialist는 task/domain에 맞는 별도 Working Set을 가질 수 있다.

Working Set은 persistent evidence가 아니다.

Specialist switching 시 전체 Working Set을 서로 그대로 복제하지 않는다.

필요한 continuity는 shared evidence 또는 explicit handoff bridge에서 재구축한다.

## RC81 — Specialist Observations Write to Shared Ledger

Specialist가 user와 대화하거나 environment를 관찰해 얻은 canonical event는
shared Evidence Ledger로 들어간다.

Candidate provenance:

```text
speaker
observed_by
active_identity
conversation_thread
conversation_segment
source event / tool receipt
```

Specialist output은 user truth로 승격하지 않는다.

## RC82 — Explicit Conversational Identity Handoff

기본 relational identity는 XION.

흐름 후보:

```text
XION gives brief answer
→ identifies specialist value
→ offers handoff
→ user approves
→ specialist becomes active conversational identity
→ user can explicitly return to XION
```

Unexpected silent switching은 기본 정책에서 금지한다.

## RC83 — Handoff Bridge Is Derived State

Specialist ↔ XION switching 시 continuity를 위해
ephemeral handoff state를 둘 수 있다.

Candidate content:

```text
topic
key evidence references
current conclusion
user decision
unresolved questions
active task state
```

Canonical evidence를 대체하지 않는다.

## RC84 — Sparse Multi-Specialist Routing

요청에 따라 0..N specialist를 내부적으로 활성화할 수 있다.

사용자-facing conversational identity는 한 번에 명확히 유지하되,
behind-the-scenes cognition은 여러 specialist가 협력할 수 있다.

Exact orchestration protocol은 OPEN.

## RC85 — Personality Is Secondary to Cognitive Role

Primary specialization mechanism:

```text
Role Core
Working Set
retrieval
tools
goals
derived experience
```

Surface persona / speaking style는 optional product layer.

## G16 — User-Created Conversation Spaces

목표:

- purpose-specific chat/session이 local continuity를 개선하는지 본다.
- UI thread가 memory silo나 event boundary로 오해되지 않게 계약을 분리한다.

## RC86 — UI Thread Is Not a Canonical Memory Boundary

```text
separate chat
≠ separate user truth
≠ separate long-term memory database
≠ automatic event boundary
```

Shared canonical memory는 유지한다.

## RC87 — Thread-Local Derived Context Is Allowed

Conversation space는 다음 derived/local state를 가질 수 있다.

```text
thread-local working state
default specialist affinity
topic-local retrieval bias
recent local context
open plans / questions
surface organization metadata
```

이 state는 rebuildable이어야 한다.

## RC88 — Event Segmentation Remains Independent

기존 contract:

```text
conversation session ≠ event
```

을 유지한다.

별도 개념:

```text
UI thread
conversation segment
specialist identity segment
autobiographical / task event segment
```

UI 경계를 semantic event truth로 사용하지 않는다.

## E-G41 — Shared vs Siloed Specialist Memory

Compare:

```text
A. each specialist keeps separate long-term user memory
B. shared canonical memory + specialist-local Working Set / Role Core
```

Fixtures:

```text
user preference corrected while speaking to one specialist
same entity appears across two specialist domains
specialist learns a fact later needed by XION
conflicting specialist interpretation
```

Measure:

```text
cross-specialist consistency
correction propagation
false-memory divergence
retrieval relevance
context cost
```

## E-G42 — Conversational Handoff

Compare:

```text
A. XION handles all specialist questions directly
B. silent automatic specialist switch
C. XION brief answer + explicit optional handoff
```

Measure:

```text
task depth
user orientation / identity confusion
conversation continuity
handoff friction
specialist utilization
return-to-XION continuity
```

## E-G43 — Thread-Local Context

Compare:

```text
A. one global conversation stream
B. separate UI threads as hard memory silos
C. separate UI threads + shared canonical memory + local working context
```

Repeated workflows:

```text
daily diet / exercise logging
trading follow-up
memory research
robot development
```

Measure:

```text
local continuity
irrelevant context carryover
cross-thread memory consistency
correction propagation
context budget
event-boundary errors
```

## Scope Guard

- specialist마다 독립 user truth source를 만들지 않는다.
- Role Core에 temporal user facts를 복제하지 않는다.
- specialist Working Set을 evidence로 취급하지 않는다.
- specialist inference를 user-authored fact로 저장하지 않는다.
- conversational identity switch를 사용자에게 숨기지 않는다.
- handoff summary를 canonical source로 만들지 않는다.
- UI thread를 event boundary나 memory deletion scope로 자동 해석하지 않는다.
- exact chat sidebar/tab/visual design은 현재 memory research scope에서 결정하지 않는다.


---

# 37. Final Gap-Fill Research Addition — Privacy / Governed Erasure

## G17 — Governed Erasure / User Control

목표:

- correction / suppression / erasure를 분리한다.
- erasure가 canonical evidence와 derived artifacts에 어떻게 전파되어야 하는지 검증한다.
- erased content의 resurrection을 방지한다.
- learned artifacts의 erasability requirement를 명확히 한다.

## RC89 — Ordinary Immutability Has a Governance Exception

```text
ordinary memory operation
→ canonical event mutation/deletion 금지
→ correction / supersession event

governed erasure
→ canonical evidence removal allowed
```

## RC90 — Erasure Propagates by Provenance

삭제 대상 source의 downstream derivation을 찾고
affected projection을 invalidate / rebuild한다.

```text
erase source
→ dependency reachability
→ invalidate descendants
→ replay surviving sources
```

Mixed-support projection은 surviving evidence로 재구축한다.

## RC91 — No Resurrection

Erased source가 아래 경로를 통해 복구되면 failure다.

```text
stale cache
snapshot
queued job
old embedding
summary
index
learned artifact
```

Minimal tombstone / receipt는 content-free metadata만 유지하는 방향을 우선한다.

## RC92 — Erasability by Design for Personal Learned Artifacts

Personal-data-derived learned artifacts는 최소한:

```text
source traceability
retrain / rebuild / unlearn path
artifact invalidation
verification
```

중 적절한 contract가 있어야 한다.

삭제 불가능한 opaque personalization artifact를
기본 memory sink로 만들지 않는다.

## RC93 — Deletion Scope Must Be Resolved Before Execution

```text
entity / alias ambiguity
temporal ambiguity
conversation-scope ambiguity
topic-scope ambiguity
```

가 결과를 바꾸면 fail-close하고 사용자에게 묻는다.

## RC94 — History Projections Are Not Exempt

User Life History / Shared History / XION Self-History /
specialist-derived projections도 erased source에 의존하면
rebuild / redact 대상이다.

비개인적 system consequence 보존의 exact contract는 OPEN.

## E-G44 — Erasure Propagation

Fixture:

```text
one evidence → one projection
one evidence → many projections
many evidence → one projection
erased evidence + surviving support
core projection dependency
specialist-derived experience dependency
shared-history dependency
```

Measure:

```text
residual erased content
surviving-fact preservation
rebuild correctness
dependency coverage
false over-deletion
```

## E-G45 — Resurrection Attack / Replay Test

After erasure, intentionally replay:

```text
old snapshot
stale embedding queue
old derived summary
reindex
projection rebuild
cache restore
```

Pass condition:

```text
erased content does not reappear
```

## E-G46 — Intent Disambiguation

Inputs:

```text
"그건 틀렸어"
"그건 이제 옛날 얘기야"
"앞으로 쓰지 마"
"기억하지 마"
"완전히 삭제해"
"민수 관련 거 다 지워"
```

Compare:

```text
A. single forget action
B. typed correction / suppression / erasure + clarification
```

Measure:

```text
wrong physical deletion
wrong retention
scope mistakes
user clarification burden
identity-collision safety
```

## E-G47 — Learned Artifact Erasability

Candidate artifact classes:

```text
retrieval policy
routing classifier
personal adapter
formatter model
summary cache
```

For each class, record:

```text
source traceable?
rebuildable?
deletable?
unlearning required?
verification possible?
```

Reject or isolate artifact classes that cannot satisfy the required deletion contract.

## Scope Guard

- suppression을 physical erasure로 자동 해석하지 않는다.
- ordinary correction 때문에 canonical history를 hard-delete하지 않는다.
- erased content를 tombstone/receipt에 그대로 복사하지 않는다.
- primary row만 삭제하고 derived copies를 방치하지 않는다.
- identity-ambiguous mass delete를 silent execution하지 않는다.
- exact backup retention 기간 / purge implementation은 지금 고정하지 않는다.
- privacy gap-fill 이후 새 mechanism class를 추가하지 않는다.

---

# 38. Gap-Fill Stop / R2 Entry Gate

Gap-Fill은 여기서 종료한다.

R2에서는 다음만 수행한다.

```text
1. overlap map
2. subsystem collapse
3. truth / state boundary normalization
4. shared invariants
5. unresolved decisions
6. experiment priority reduction
7. architecture candidate synthesis
```

R2에서 금지:

```text
new subsystem hunting
new literature gap-fill for its own sake
premature schema fixation
arbitrary tuning knobs
implementation prompt before design closure
```

R2 성공 조건:

> **현재 30+ mechanism ideas를 작은 수의 coherent architecture planes / loops / projections로 설명할 수 있고, 각 plane의 source of truth·inputs·outputs·failure boundaries가 겹치지 않게 정리되어야 한다.**
