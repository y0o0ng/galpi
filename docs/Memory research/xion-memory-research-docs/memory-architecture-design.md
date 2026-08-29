# XION Long-Term Memory Architecture Design

> 상태: **R2 CANONICAL DESIGN — SEMANTIC CONTRACTS CLOSED; R3 EMPIRICAL POLICIES OPEN**
>
> 기준일: 2026-08-29
>
> 목적: R1 조사와 R2 semantic synthesis에서 채택한 XION 개인화 장기기억의 **정본 architecture contract**를 정의하고, R3에서 실험으로 결정할 policy seam을 분리한다.
>
> 이 문서는 **architecture 의미·authority·source-of-truth·hard-boundary의 정본**이다. 다만 exact schema, table/service 분할, storage technology, policy winner까지 고정하는 구현 상세 설계는 아니다.

---

# 0. Current Canonical Status

R1 landscape / innovation / Gap-Fill research는 종료되었고, R2 Semantic Collapse / Completion도 exit gate를 통과했다.

현재 채택된 방향의 초압축본:

```text
Owning Sources
→ Logical Evidence Registry / Address Layer
→ Derivation / Dependency Provenance
→ provenance-aware Derived-State Transition
→ Hypotheses / Derived States
→ developer-curated 0..N Projections
→ Context Assembly
→ reasoning / intervention / action-facing boundaries
```

끝까지 별도 authority로 유지:

```text
Skill Contract
!= Commitment State
!= Governance / Authorization
!= Executor / Current Capability
```

현재 phase:

```text
R2 semantic architecture = CLOSED enough for synthesis
R3 empirical policy selection = OPEN, **CONDITIONAL ON R3-P0 FEASIBILITY**
implementation schema/service design = NOT YET FIXED
```

이 문서 후반의 §51은 hard-boundary consolidated map, §52는 reduced R3 experiment queue다.

---

## Document Authority

이 문서가 **XION 장기기억 architecture의 현재 정본**이다.

권위 순서:

```text
CURRENT OPERATIONAL SoT / CLOSED Galpi CONTRACTS
        ↓
THIS DOCUMENT — memory-architecture-design.md
        ↓
memory-architecture-survey.md — research evidence/reference
        ↓
memory-research-brainstorm.md — non-canonical research history
        ↓
xion-r2-hard-boundary-map.png — visual companion only
```

규칙:

- 이 문서에서 **ACCEPTED / CLOSED**로 표시한 semantic contract는 R3 실험으로 다시 열지 않는다.
- R3는 이 문서가 OPEN으로 남긴 empirical policy winner만 결정한다.
- 실제 구현이 필요할 때는 최신 Galpi `main`을 다시 읽고 별도 implementation design/prompt를 작성한다.
- Visual companion과 본문이 충돌하면 **본문이 우선**한다.

현재 baseline commit:

```text
71025861d07521f88c21b8c88360280ec6f3c604
```

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

R1/R1-X 결과를 먼저 하나의 overlap / truth-state map으로 정리한 뒤,
**가장 작은 coherent XION memory model**로 합성한다.

architecture 후보 수를 미리 정하지 않는다.

- 여러 이론이 하나의 일관된 model로 닫히면 **하나로 합친다**.
- 의미·권한·lifecycle·failure policy가 다르면 **operational boundary**를 유지한다.
- 실제 결과 우열이 문서·논리만으로 닫히지 않으면 그 지점에만 **experimental variant**를 만든다.
- 이론 이름을 그대로 subsystem 이름으로 옮기지 않는다.

## R3 — Experiment

Galpi shadow environment에서 **R2가 끝까지 닫지 못한 실질적 대안만** 비교한다.
전체 architecture를 억지로 여러 벌 만들 필요는 없으며,
동일 interface 아래 policy / mechanism variant를 shadow·replay로 비교할 수 있다.

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

R2는 **subsystem 설계부터 시작하지 않는다.**
먼저 지금까지의 연구 결과가 실제로 어디에서 겹치고,
어디에서 의미적으로 분리되어야 하는지를 정리한다.

R2 진행 순서:

```text
1. overlap map
2. semantic / operational / experimental boundary classification
3. truth / state boundary normalization
4. shared invariants
5. unresolved decisions
6. experiment set reduction
7. minimal coherent architecture synthesis
```

R2에서 금지:

```text
new literature gap-fill for its own sake
new mechanism hunting
theory 이름을 그대로 subsystem으로 옮기기
미리 정한 subsystem/plane 개수에 연구 결과를 끼워 맞추기
비교할 이유가 없는데 architecture 후보를 여러 벌 만들기
premature schema fixation
arbitrary tuning knobs
implementation prompt before design closure
```

R2 성공 조건:

> **현재 연구 결과를 가장 작은 coherent model로 설명할 수 있어야 한다. 분리는 theory taxonomy가 아니라 semantics·authority·source of truth·lifecycle·failure policy 또는 실제로 unresolved인 experimental alternative 때문에 필요한 경우에만 둔다.**

---

# 39. R2 Reset — Synthesis Operating Principles

> 상태: **R2 OPERATING CONTRACT**
>
> 기준 연구 corpus: Privacy pass와 Gap-Fill Stop까지 반영된 r16.
>
> 기준 Galpi `main`: `637caf04bb8accbb91486dc543e8ba23b6d749d2`.
>
> r17에서 시도한 초기 R2 architecture decisions는 **candidate discussion으로만 취급하며 CLOSED decision으로 승계하지 않는다.**

## 39.1 Literature taxonomy is not software architecture

ATMS, CLS, reconsolidation, active elicitation, event segmentation,
procedural memory 같은 연구 이름은 문제를 이해하기 위한 lens다.

```text
paper / theory mechanism
≠
required runtime subsystem
```

여러 이론이 같은 failure mode를 서로 보완하며
하나의 일관된 state transition / retrieval / learning model로 닫히면
그 **model 하나를 구현**한다.

강한 원칙:

> **Implement the coherent model, not the literature taxonomy.**

## 39.2 Subsystem count is not a research target

R2는 `5개`, `6개`, `8개` 같은 architecture plane 수를 먼저 정하지 않는다.

```text
mechanisms
→ overlap / conflict analysis
→ necessary boundaries
→ resulting architecture
```

순서를 지킨다.

결과가 monolithic한 하나의 model일 수도 있고,
몇 개의 별도 operational boundary를 가질 수도 있다.
숫자 자체에는 가치가 없다.

## 39.3 Separate three different reasons for separation

R2에서 어떤 개념 둘을 분리할 때는 먼저 이유를 분류한다.

### A. Semantic Contract

같은 데이터처럼 보여도 의미가 다른 경우.

예:

```text
WORLD UPDATE ≠ CORRECTION
behavior ≠ preference
retrieval ≠ evidence
forgetting ≠ erasure
```

이 차이는 반드시 보존하지만,
그 자체가 별도 runtime subsystem을 요구한다는 뜻은 아니다.

### B. Operational Boundary

source of truth, authority, lifecycle, permission, failure policy가 달라
실제로 분리된 책임 경계가 필요한 경우.

예:

```text
memory state ≠ confirmed task/reminder commitment
skill contract ≠ executor-local implementation
working set ≠ persistent truth
governance permission ≠ learned preference
```

이 경계는 A/B experiment와 무관하게 필요할 수 있다.

### C. Experimental Variant

문서·논리만으로 우열을 닫을 수 없고,
실제 Galpi shadow/replay에서 결과를 비교해야 하는 경우.

예:

```text
hard-gated retrieval
vs
global-soft-prior retrieval
```

이 경우에만 동일 contract 아래 variant를 만들어 비교한다.

## 39.4 Do not create variants when theory already closes the question

semantic contract나 기존 CLOSED product contract로 답이 정해진 문제를
불필요하게 A/B test하지 않는다.

반대로 서로 합리적인 대안이 남아 있고
실제 결과를 바꾸는 경우에는 사용자의 판단만으로
성급하게 winner를 선언하지 않는다.

```text
closed by semantics / authority
→ one contract

unresolved empirical behavior
→ shadow / replay comparison
```

## 39.5 R2 begins with maps, not decisions

각 mechanism / concept를 먼저 아래 질문으로 읽는다.

```text
What problem does it solve?
What state does it read?
What state does it produce or mutate?
What is its epistemic provenance: observed evidence, assumption/hypothesis, or derived abstraction?
What is its authority role: source record, authoritative domain state, projection/cache, or candidate/advisory state?
What is its lifecycle: durable, ephemeral, inactive/historical, and/or rebuildable?
What semantic domain does it belong to: memory/knowledge, operational commitment/capability, governance, cognitive context, or evaluation/learning?
What mutation / failure semantics apply?
What failure does separation prevent?
Which other mechanisms solve the same problem?
Is the difference semantic, operational, or empirical?
Can the theories collapse into one model without losing an invariant?
```

이 map이 끝나기 전에는
schema, table, worker, service, formatter 수를 고정하지 않는다.

## 39.6 Existing Galpi contracts remain constraints, not suggestions

R2 memory research는 기존 CLOSED/FROZEN product contract를
연결된다는 이유만으로 다시 열지 않는다.

특히 현재 Galpi의 다음 경계는 baseline constraint다.

```text
messages / QA-LOG raw-source preservation
note_chunks and summaries are rebuildable derived data
task / reminder operational SoT remains separate
confirmation-before-write task semantics remain closed
UI thread / session is not automatically a semantic memory boundary
```

새 architecture가 이 계약을 깨야만 성립한다면
그 변경은 R2 안에서 조용히 채택하지 않고
별도 user decision이 필요하다.

## 39.7 Prefer synthesis by subtraction

R2의 기본 질문은:

```text
"What else should we add?"
```

가 아니라:

```text
"Can these mechanisms be explained by one smaller model?"
"What distinction would be lost if we merge them?"
"Does that distinction actually require a runtime boundary?"
```

이다.

강한 원칙:

> **From here, subtraction and synthesis are more valuable than mechanism accumulation.**

## 39.8 Experiment only at irreducible uncertainty

R3로 넘길 항목은 다음을 만족해야 한다.

```text
two or more plausible alternatives remain
AND
they materially change behavior / quality / cost / safety
AND
the difference can be observed or measured
```

가능하면 전체 architecture fork가 아니라
가장 작은 comparable policy / mechanism boundary로 실험한다.

```text
same interface
├─ variant A
└─ variant B
      ↓
shadow / replay / benchmark
```

## 39.9 User decision rule

R2 중 시스템 의미나 결과를 바꾸는 중요한 불확실성은
assistant가 임의로 닫지 않는다.

사용자에게 제시할 때:

```text
options
tradeoffs
recommended option
reason for recommendation
what evidence is already closed
what remains inference / uncertainty
```

를 함께 제시한다.

사소한 helper 구조나 내부 loop 같은 구현 세부는
별도 제품 의미가 없으면 사용자 결정 대상으로 올리지 않는다.

## 39.10 R2 working maxim

> **Do not create subsystems to mirror theories. Create separate boundaries only when semantics, authority, lifecycle, failure policy, or experimentally unresolved behavior require them. If multiple theories collapse into one coherent model, keep the model.**

이 원칙을 R2의 출발 계약으로 사용한다.



---

# 40. R2 Overlap Map — Pass 1

> 상태: **R2 FOUNDATION ACCEPTED — NOT YET AN ARCHITECTURE**
>
> Galpi baseline checked at start of this pass:
> `dabbec08d0a54f9c3c812ace339aa40d939f0ba6`
> (`research(qv): share-count split basis를 검증한다`).
> The commit is QV research-only and does not reopen memory contracts.
>
> 목적: theory 이름을 subsystem으로 복사하지 않고,
> R1/R1-X/Gap-Fill에서 실제로 같은 failure mode를 다루는 mechanism들을 먼저 겹쳐 본다.

## 40.1 Reading rule

이 map의 group은 subsystem이 아니다.

```text
overlap group
= "these mechanisms answer overlapping questions"
≠ "build one service/table/worker for this group"
```

한 mechanism은 여러 group에 걸칠 수 있다.
반대로 한 group 안의 모든 mechanism이 최종적으로 하나로 합쳐진다는 뜻도 아니다.

## 40.2 Overlap groups

| Group | Overlapping research mechanisms | Shared question | Important non-collapse warning |
|---|---|---|---|
| A. Evidence / Derivation / Provenance | Canonical Evidence/Event Ledger, evidence-vs-assumption, multi-formatter provenance, outcome events, raw episode preservation, self-history source events, privacy propagation | 무엇이 실제 관측이고 무엇이 derived interpretation인가? 어떤 derived state를 원 source까지 추적·재생성할 수 있는가? | canonical의 **물리 저장 형태**는 아직 결정하지 않는다. operational SoT를 memory ledger로 흡수하지 않는다. |
| B. Hypothesis / Uncertainty / Revision | Memory Forks, Predictions, Local Justification DAG, Belief Revision, change-type classification, Reconsolidation, identity repair | 여러 해석을 어떻게 유지하고, 새 evidence가 오면 무엇을 최소 수정·fork·invalidate할 것인가? | `WORLD_UPDATE ≠ CORRECTION`; retrieval 자체는 rewrite permission이 아니다. Identity false-merge는 일반 ambiguity보다 비용이 크다. |
| C. Consolidation / Generalization / Projection Formation | Reflection, CLS, structured/contrastive replay, schema-congruence gating, formatter merge/update, event-boundary micro-consolidation, User Model projection, relationship/routine/ranking/timeline abstraction | 개별 experience에서 언제 더 안정적인 derived abstraction을 만들거나 갱신할 것인가? | capture와 stable generalization은 같은 operation으로 가정하지 않는다. abstraction은 episode를 대체하지 않는다. |
| D. Representation / Specialization | General Graph, General Fact, Ranking, Timeline, Decision Ledger, Relationship, Routine, Preference Set, adaptive specialization, 0..N formatter routing | 같은 evidence를 어떤 computational view들로 표현해야 하는가? | representation heterogeneity를 runtime subsystem 수와 동일시하지 않는다. graph가 entire memory truth가 되지 않는다. |
| E. Event / Context Structure | semantic event segmentation, hierarchical events, event transitions/bridges, context reinstatement, event membership vs association, retrieval-unit/context-unit separation | 대화를 session이 아니라 의미적 context/event로 어떻게 조직하고 다시 복원할 것인가? | event segmentation은 derived/rebuildable이며 UI thread/session과 동일하지 않다. temporal proximity는 merge rule이 아니다. |
| F. Retrieval / Activation / Accessibility | contextual memory activation, sparse routing, associative expansion, Core, Dynamic Working Set, forgetting-as-accessibility, archival, specialist-local working sets, thread-local retrieval bias | 지금 reasoning에 어떤 기억을 얼마나 넓게 활성화할 것인가? | activated/retrieved/used는 truth·utility·revision permission이 아니다. forgetting/accessibility와 invalidity/erasure는 다르다. |
| G. Evidence Acquisition / Clarification | Active Elicitation, VOI, natural observation, opportunistic query, Fork discriminators, identity clarification, deletion-scope clarification | 모호함을 언제 그대로 두고, 관찰하고, 사용자에게 무엇을 물을 것인가? | uncertainty 자체가 질문 이유가 아니다. 질문은 downstream behavior가 달라질 때만 가치가 있다. |
| H. Procedure / Commitment / Capability | procedural memory, registered skills, executor-relative granularity, macro deployment, prospective memory, task/reminder, selective intervention | 기억된 정보를 미래 행동과 어떻게 연결할 것인가? | **HOW(skill) ≠ WHAT/WHEN commitment ≠ authorization ≠ execution backend.** Existing task/reminder operational SoT remains separate. |
| I. Identity / Relationship / Longitudinal History | alias/entity resolution, closeness, temporal User Model, Self-Concept Claim, User Life History, Shared History, XION Self-History, specialist conversational identity | 누구에 대한 상태인지, 시간에 따라 어떻게 바뀌었는지, 어떤 history projection을 만들 것인가? | name≠identity, closeness≠identity proof, self-history≠current capability truth, narrative≠evidence. |
| J. Policy Learning / Evaluation | write/no-write, routing labels, usage attribution, sampled LOO, Shadow-All-Write, contextual-bandit/OPE, delayed/censored outcomes, PU/survival views, prediction outcomes, opportunity-adjusted utility, controller replay | memory policy가 좋았는지 어떻게 관측하고, selection bias 속에서 어떻게 개선할 것인가? | shadow는 human counterfactual oracle이 아니다. unobserved≠negative. reward는 canonical truth로 두지 않는다. |
| K. Governance / Erasure / Authority | governed erasure, no-resurrection, correction/suppression/erasure separation, skill authorization, task confirmation, safety/permission, erasability-by-design | 누가 무엇을 삭제·확정·실행할 권한이 있는가? | learned memory/policy가 governance를 재정의하면 안 된다. Governance boundary는 theory experiment가 아니라 authority contract일 수 있다. |
| L. Specialist / Session Cognitive Views | shared memory, System Core / Role Core, specialist-local Working Set, specialist derived experience, handoff bridge, user-created thread/session spaces | 하나의 shared truth 위에 여러 현재 cognitive views를 어떻게 제공할 것인가? | specialist별 truth DB, thread별 memory silo, handoff summary의 canonicalization은 금지 방향이다. |

## 40.3 Strong overlap / collapse pressure

문서 전체를 다시 읽었을 때 특히 겹침이 강한 조합은 다음과 같다.

### P1 — Fork × Prediction × Belief Revision × Reconsolidation

```text
ambiguous / conflicting evidence
→ hypothesis candidates
→ discriminating expectations
→ new evidence
→ classify change
→ minimal local revision / fork / invalidation
```

네 이론은 상당 부분 하나의 **hypothesis-maintenance lifecycle**을 서로 다른 각도에서 설명한다.

아직 결정하지 않은 것:
- 하나의 runtime mechanism으로 실제 collapse할지
- prediction이 항상 materialized state인지 query-time derivation인지
- local justification structure의 정확한 형태

### P2 — CLS × Reflection × Formatter Projection × Micro-Consolidation

공통점:

```text
episode/evidence
→ derived abstraction
→ later replay / update
```

다만 trigger와 안정성 요구가 다르다.

```text
event boundary
periodic/background replay
schema-congruent fast integration
mismatch-triggered revision
```

따라서 **"모두 consolidation이다"**라고 바로 합치지 않는다.
먼저 `formation`과 `revision`이 같은 transition engine으로 닫히는지 봐야 한다.

### P3 — Contextual Activation × Sparse Routing × Event Retrieval × Working Set × Forgetting

모두 read-side의 질문에 가깝다.

```text
what should be active now?
```

Core, specialist role, thread-local bias, event context reinstatement,
association expansion, accessibility suppression이 같은 context assembly 과정에
합쳐질 가능성이 높다.

하지만:
- `Core`는 always-visible privileged projection
- `Working Set`은 ephemeral current state
- `forgetting`은 accessibility policy
이므로 semantic distinction은 유지한다.

### P4 — Write/Route Learning × Usage Attribution × OPE × Delayed Outcomes

모두 policy-improvement loop의 서로 다른 측정 문제다.

```text
memory decision
→ exposure / retrieval / use
→ delayed outcome
→ attribution / censoring
→ policy evaluation
→ safer next policy
```

이 영역은 architecture보다 **instrumentation + experimental policy**로 collapse될 가능성이 높다.

### P5 — Identity Repair as a specialized case of local revision

Identity collision은:

```text
derived assignment was unsafe / ambiguous
→ stop merge
→ gather discriminating evidence
→ rebuild affected derived links
```

라는 점에서 Fork / elicitation / minimal revision과 강하게 겹친다.

다만 false entity merge의 catastrophic cost 때문에
generic hypothesis uncertainty와 동일 threshold/policy를 그대로 쓰면 안 될 가능성이 높다.

### P6 — Forgetting is mostly read policy; erasure is governance

```text
ordinary forgetting
→ accessibility / retrieval priority

semantic invalidity
→ current-state suppression

governed erasure
→ canonical + derived removal with no resurrection
```

하나의 "memory deletion subsystem"으로 묶는 것은 문서 전체와 충돌한다.

### P7 — Skill and Prospective Memory share the action bridge but not semantics

```text
Skill
= HOW

Prospective commitment
= WHAT / WHEN / CUE

Governance
= WHETHER ALLOWED

Executor
= actual execution
```

서로 연결되지만 collapse하면 책임 경계가 깨진다.

## 40.4 Cross-cutting invariants repeatedly supported across the corpus

다음은 여러 독립 section에서 반복되어 overlap map의 기준축으로 사용할 수 있다.

```text
raw evidence ≠ derived interpretation
evidence ≠ assumption
WORLD UPDATE ≠ CORRECTION
retrieved ≠ used ≠ correct ≠ permission to rewrite
session / UI thread ≠ semantic event
event membership ≠ association
behavior ≠ preference
name ≠ identity
closeness ≠ identity proof
abstraction does not replace source experience
write conservatively; read associatively; mutate by provenance
working set ≠ persistent truth
attention state ≠ evidence
commitment ≠ ordinary memory fact
skill exists ≠ authorized now
forgetting ≠ semantic invalidity ≠ erasure
self-history ≠ current operational truth
governance ≠ learned memory
unobserved ≠ negative
```

## 40.5 What this pass intentionally does not decide

```text
physical Evidence Ledger / Registry shape
number of runtime subsystems
number of architecture candidates
exact formatter set
event boundary algorithm
consolidation trigger policy
whether formation + reconsolidation share one engine
exact Core contents
write/no-write policy
retrieval router winner
learned-controller architecture
exact erasure machinery
```

## 40.6 Next R2 step

다음 단계는 이 overlap map을 architecture로 바로 변환하는 것이 아니다.

각 state / artifact / decision에 대해:

```text
semantic contract?
operational boundary?
experimental variant?
epistemic provenance?
authority / source-of-truth role?
persistence / rebuildability?
semantic domain?
mutation / failure policy?
```

를 붙여 **truth/state boundary map**을 만든다.


---

# 41. R2 Truth / State Boundary Map — Pass 1

> 상태: **WORKING SYNTHESIS MAP — NOT AN ARCHITECTURE DECISION**
>
> 기준 Galpi `main`: `71025861d07521f88c21b8c88360280ec6f3c604`.
>
> 이 commit은 QV research-only이며 memory contract를 변경하지 않는다.
>
> 목적: overlap map의 mechanism들을 바로 subsystem으로 만들지 않고,
> XION이 실제로 다루는 **state의 의미·권한·수명·provenance**를 먼저 정규화한다.

## 41.1 First correction — `canonical / derived / operational / ephemeral`은 한 축이 아니다

초기 R2 질문은 다음 네 단어를 한 분류처럼 놓았다.

```text
canonical
derived
operational
ephemeral
```

문서를 전체 재검토하니 이 네 개는 **상호배타적 category가 아니다.**

예:

```text
raw user message
= evidence
+ durable
+ source record

structured task
= operational
+ durable
+ authoritative domain state

promoted skill contract
= epistemically derived
+ durable
+ authoritative for the skill contract
+ NOT authorization

User Core
= derived
+ durable
+ privileged projection
+ NOT independent source of truth

Working Set
= assembled / derived
+ ephemeral
+ non-authoritative
```

즉:

```text
derived ≠ non-canonical storage
operational ≠ non-derived
persistent ≠ source truth
ephemeral ≠ unimportant
```

따라서 R2에서는 하나의 enum으로 분류하지 않고 **독립된 축**으로 본다.

## 41.2 State classification axes

### Axis A — Epistemic provenance

이 state가 **무엇을 알고 있다는 의미에서** 어디서 왔는가?

```text
SOURCE EVIDENCE
→ directly recorded utterance / action / environment or system event

ASSUMPTION / HYPOTHESIS
→ interpretation that is not itself evidence

DERIVED ABSTRACTION
→ user model, event structure, relationship state,
  generalized procedure, history projection, learned policy, etc.
```

강한 invariant:

> **Evidence status and derivation status must not be inferred from where the row is stored.**

### Axis B — Authority / source-of-truth role

이 state가 자기 domain에서 어떤 권위를 갖는가?

```text
SOURCE RECORD
→ authoritative record of an observed source event

AUTHORITATIVE DOMAIN STATE
→ current commitment / capability / registered contract / governance state
   for the domain it owns

DERIVED CURRENT STATE
→ current model used by memory/reasoning, provenance-backed but not raw truth

PROJECTION / CACHE
→ rebuildable view or materialization

CANDIDATE / ADVISORY
→ not yet authoritative; requires validation / confirmation / promotion
```

중요:

> **"Canonical"은 전역 truth label이 아니라 domain-relative authority를 가리킬 수 있다.**

따라서 `canonical evidence`와 `canonical skill registry` 같은 표현을
같은 epistemic 의미로 읽으면 안 된다.

### Axis C — Persistence / rebuildability

```text
DURABLE
EPHEMERAL
HISTORICAL / INACTIVE
MATERIALIZED-BUT-REBUILDABLE
```

이 역시 authority와 독립이다.

예:

```text
event segmentation
→ persisted materialization일 수 있어도 rebuildable derived state

Working Set
→ ephemeral

closed task
→ durable historical operational state

invalidated memory
→ durable historical derived state
```

### Axis D — Semantic domain

현재 연구 corpus에서 최소 다음 의미 domain이 반복된다.

```text
EPISTEMIC MEMORY / KNOWLEDGE
OPERATIONAL COMMITMENT
OPERATIONAL CAPABILITY / EXECUTION
GOVERNANCE / AUTHORIZATION
COGNITIVE CONTEXT
EVALUATION / LEARNING
```

이 domain은 storage/service 개수를 뜻하지 않는다.
다만 domain 간 authority가 다르면 operational boundary가 필요할 수 있다.

### Axis E — Mutation / failure semantics

state마다 같은 update rule을 쓰지 않는다.

후보 mutation semantics:

```text
append new source event
supersede / invalidate derived state
local provenance-scoped revision
rebuild projection
transactional operational transition
promotion / demotion
governed erasure
ephemeral replacement
```

그리고:

```text
fail-open
fail-close
retain-old-state-on-failed-revision
ask-user-before-authority-change
```

같은 failure policy가 다르면 실제 boundary의 근거가 될 수 있다.

---

## 41.3 Truth / State Map

아래는 **state family map**이다.
행 하나가 subsystem 하나를 뜻하지 않는다.

| State family | Epistemic provenance | Authority role | Lifecycle | Semantic domain | Mutation / failure semantics | Boundary reading |
|---|---|---|---|---|---|---|
| **Raw conversation / user action / environment event** | SOURCE EVIDENCE | SOURCE RECORD | DURABLE under ordinary operation | Epistemic source | append-oriented; correction is new evidence; governed erasure exception | Strong semantic provenance boundary. Physical unified ledger still OPEN. |
| **Tool / executor / system event evidence** | SOURCE EVIDENCE | SOURCE RECORD in owning domain | usually durable according to owning contract | Epistemic source + operational observation | append / receipt semantics; source-specific retention may apply | Can support memory without becoming memory state. |
| **Assumption / interpretation candidate** | ASSUMPTION | CANDIDATE | ephemeral or durable while unresolved | Epistemic memory | revise / reject / fork; never silently upgraded to evidence | Semantic distinction, likely same maintenance engine as hypotheses. |
| **Fork / hypothesis / prediction state** | DERIVED from evidence + assumptions | CANDIDATE or provisional derived state | may persist across interactions | Epistemic memory | new evidence → discriminate / revise / invalidate / unresolved | Strong collapse pressure with belief revision + reconsolidation; exact representation OPEN. |
| **Structured declarative memory / current User Model** | DERIVED ABSTRACTION | DERIVED CURRENT STATE | DURABLE, historical versions retained as needed | Epistemic memory | expansion / world update / correction / contradiction / temporal revision | Persistent derived state, not raw truth. Must retain provenance. |
| **Relationship / preference / routine / ranking / timeline views** | DERIVED ABSTRACTION | DERIVED CURRENT STATE / view | durable and rebuildable to varying degrees | Epistemic memory | formatter-specific update under shared provenance rules | Representation heterogeneity; not automatically separate services. |
| **Entity / alias assignment** | DERIVED from source mentions/context | DERIVED CURRENT STATE | durable with ambiguous/historical assignments | Epistemic memory | fail-close on collision; split/merge rebuilds derived links | Identity has stricter failure policy than ordinary semantic merge. |
| **Event membership / hierarchy / transition / association** | DERIVED ABSTRACTION | PROJECTION / current derived structure | materialized-but-rebuildable | Epistemic context structure | rebuild / re-segment; raw events unchanged | No independent truth authority. Session/thread is not the source. |
| **User Life / Shared / XION Self-History** | DERIVED from provenance-separated source events | DERIVED CURRENT/HISTORICAL PROJECTION | DURABLE | Epistemic/autobiographical projection | rebuild/redact on source correction/erasure | Preserve layers, but narrative is not evidence. |
| **User Core** | DERIVED from User Model / evidence | PRIVILEGED DERIVED PROJECTION | DURABLE, very conservative promotion | Cognitive context + memory projection | stricter promote/demote; not independent source | No separate truth store required by theory. |
| **Role Core / thread-local affinity** | configuration / derived view | local context authority only | durable config or local derived state | Cognitive context | switch / recompute | Specialist/session-local view, not shared truth. |
| **Working Set / handoff bridge** | ASSEMBLED / DERIVED | NON-AUTHORITATIVE | EPHEMERAL | Cognitive context | replace / rebuild every reasoning episode as needed | Must never become evidence merely through attention. |
| **Retrieval rank / accessibility / association expansion state** | DERIVED policy output | NON-AUTHORITATIVE | mostly ephemeral; some statistics may persist | Cognitive context / retrieval policy | recompute; no write permission from retrieval | Strong semantic boundary from validity/truth. |
| **Forgetting accessibility state** | DERIVED policy state | NON-AUTHORITATIVE wrt truth | durable soft state or computed | Cognitive context / retrieval policy | lower accessibility; exact cue can reactivate | Must remain separate from invalidity and erasure. |
| **Skill candidate** | DERIVED from instructions / episodes | CANDIDATE | durable while evaluating or discardable | Procedural knowledge | validate / replay / transfer / promote | One success is insufficient. |
| **Promoted Skill Contract / Skill Registry entry** | DERIVED ABSTRACTION | AUTHORITATIVE DOMAIN STATE for the skill contract | DURABLE + versioned | Procedural knowledge | version / supersede / deactivate; provenance retained | Important dual status: epistemically derived, operationally authoritative as contract. |
| **Executor-deployed macro / implementation** | DERIVED deployment projection | AUTHORITATIVE only for executor-local deployed implementation | durable or runtime-local | Operational capability / execution | deploy / invalidate on version/hash mismatch / fallback | Operational boundary from canonical skill contract. |
| **Current executor / capability state** | observed/configured operational state | AUTHORITATIVE DOMAIN STATE | current + history as needed | Operational capability | runtime update; fail-close/fallback on incompatibility | Current state outranks self-history for present capability truth. |
| **Confirmed task / reminder / prospective commitment** | user-confirmed decision, not inferred fact | AUTHORITATIVE DOMAIN STATE | DURABLE with active/closed/deleted lifecycle | Operational commitment | transactional state machine; confirmation before creation; completion deactivates trigger | **CLOSED operational boundary** from ordinary memory. |
| **Unconfirmed future-oriented statement / intention candidate** | SOURCE EVIDENCE + possible DERIVED candidate | CANDIDATE only | ephemeral or memory evidence | Epistemic memory / prospective candidate | must not create commitment without confirmation | Semantic + authority boundary. |
| **Governance permission / safety / authorization state** | explicit policy/config/user authority | AUTHORITATIVE DOMAIN STATE | DURABLE/current | Governance | only authorized transition; learned memory cannot override | Strong operational/authority boundary. |
| **Erasure request / deletion scope / no-resurrection state** | user/governance action | AUTHORITATIVE GOVERNANCE STATE | durable enough to enforce erasure; exact receipt OPEN | Governance | resolve scope → erase/rebuild → prevent resurrection | Ordinary append-only semantics have explicit governance exception. |
| **Outcome / opportunity / exposure / correction feedback event** | SOURCE EVIDENCE about system interaction | SOURCE RECORD for evaluation | durable enough for evaluation | Evaluation / learning | append; `unobserved != negative`; reward may be recomputed/versioned | Evaluation evidence, not memory truth. |
| **Memory policy decision trace** | SOURCE RECORD of controller action/context | evaluation provenance | durable trace candidate | Evaluation / learning | append/version behavior policy + propensity where meaningful | Required for unbiased-ish evaluation; not user memory. |
| **Learned write/retrieval/controller policy** | DERIVED from evaluation evidence | AUTHORITATIVE only as active policy version, never as truth/governance | versioned durable artifact | Evaluation / learning | shadow → validate constraints → promote / rollback | Natural place for experimental variants. |

---

## 41.4 The most important synthesis result: provenance and authority are different graphs

문서 전체에서 가장 자주 섞일 위험이 있는 것은:

```text
"where did this state come from?"
```

과:

```text
"which state wins / controls behavior now?"
```

이다.

둘은 다른 관계다.

### Provenance graph

```text
source evidence
→ assumptions / interpretation
→ derived memory
→ Core / history / skill / other projection
```

답하는 질문:

```text
why do we believe this?
what must be replayed on correction?
what must be rebuilt on erasure?
```

### Authority / precedence graph

```text
governance permission
current operational capability
confirmed commitment
active skill contract
derived memory / history
candidate hypothesis
```

답하는 질문:

```text
what is allowed?
what is actually committed?
what can the system do now?
which state controls present behavior?
```

예:

```text
XION Self-History:
"2026-07: capability X was deployed"
```

는 provenance-backed history로 참일 수 있다.

하지만 현재:

```text
CURRENT CAPABILITY STATE:
capability X = unavailable
```

이면 현재 행동은 후자가 결정한다.

따라서:

> **Provenance strength does not imply operational authority, and operational authority does not turn a state into evidence.**

---

## 41.5 Derived state can be authoritative without becoming evidence

이 distinction은 Skill 연구에서 특히 중요하다.

```text
execution episodes / explicit instruction
        ↓
derived skill contract
        ↓
validated / promoted Skill Registry entry
```

Promoted skill은:

```text
epistemically: DERIVED
operationally: authoritative contract for what the skill is
```

일 수 있다.

하지만:

```text
skill contract
≠ source evidence
≠ permission to execute
≠ current executor capability
```

이다.

같은 원리가 structured User Model에도 적용될 수 있다.

```text
current memory projection
= authoritative current derived state for retrieval/reasoning
≠ canonical source truth about the user
```

이 distinction을 유지하면
"모든 derived state는 cache라서 없어져도 된다"와
"derived state가 canonical truth가 된다"라는 두 극단을 모두 피할 수 있다.

---

## 41.6 Operational boundaries already strongly justified

현재 문서와 Galpi CLOSED contract를 합치면,
실험 없이도 boundary 근거가 강한 것은 다음이다.

```text
confirmed task/reminder commitment
≠ ordinary memory

governance / authorization
≠ learned memory or skill

skill contract
≠ executor-local deployment

current capability state
≠ self-history

Working Set
≠ persistent memory/evidence
```

이들은 별도 DB/service를 반드시 뜻하지는 않지만,
**authority와 lifecycle을 섞으면 correctness가 깨지는 경계**다.

---

## 41.7 Areas that should remain unified unless evidence forces a split

반대로 지금 단계에서 theory별 분리를 만들 이유가 약한 영역:

```text
Fork
Prediction
Belief Revision
Reconsolidation
Identity-local repair
```

→ shared hypothesis/revision semantics로 collapse 가능한지 계속 본다.

```text
Contextual Activation
Sparse Retrieval Routing
Event Context Reinstatement
Working Set Assembly
Accessibility / Forgetting
```

→ shared context-assembly/read-policy model로 collapse 가능한지 본다.

```text
Reflection
CLS
Formatter projection formation
event-boundary micro-consolidation
```

→ trigger 차이는 보존하되 shared formation/generalization machinery로
collapse 가능한지 본다.

---

## 41.8 Experimental uncertainty is concentrated in policy, not truth semantics

현재 map에서 R3 shadow/replay가 특히 자연스러운 곳은:

```text
retrieval gating / routing
write-no-write policy
formatter / specialization routing
elicitation threshold / VOI approximation
consolidation trigger / promotion threshold
learned controller policy
```

반대로 아래를 experiment로 결정하려고 하면 안 된다.

```text
WORLD UPDATE vs CORRECTION distinction
task confirmation authority
governance override prohibition
retrieval != truth
working set != evidence
erasure != forgetting
name != identity
```

이것들은 quality tuning보다 semantic / authority contract다.

---

## 41.9 Remaining open questions after this map

아직 닫지 않는다.

1. **Physical source organization**
   - 하나의 physical Evidence Ledger?
   - existing source stores + shared reference/provenance layer?
   - 다른 형태?
   - 이번 map은 답하지 않는다.

2. **Derived Current State durability**
   - 어떤 memory projection을 반드시 materialize할지,
   - 어떤 것은 on-demand rebuild로 둘지.

3. **Hypothesis representation**
   - Fork / prediction / justification을 얼마나 명시적으로 저장할지.

4. **Formation vs revision engine**
   - consolidation/generalization과 reconsolidation/local revision이
     하나의 generic transition engine으로 닫히는지.

5. **Event structure materialization**
   - segmentation/hierarchy/bridges를 얼마나 지속 저장할지.

6. **Exact promotion semantics**
   - candidate → current derived state / Core / skill promotion threshold.

7. **Evaluation-state storage**
   - policy decision trace / outcome event / controller artifact의 exact store.

---

## 41.10 Next step

다음 R2 단계는 새 subsystem 설계가 아니다.

이 truth/state map에서 반복되는 **shared invariants**를 뽑고,
서로 충돌하거나 아직 열린 부분만 user decision / experiment 후보로 남긴다.

특히 다음 질문을 먼저 검증한다.

> **Can XION use one provenance-aware transition model for most derived memory formation and revision, while keeping operational/governance authority outside that model?**

이 질문이 닫혀야 architecture skeleton을 그릴 가치가 생긴다.


## 41.11 User acceptance

이 truth/state classification은 R2의 **accepted foundation**으로 사용한다.

확정된 것은 architecture shape가 아니라 다음 meta-model이다.

```text
Epistemic provenance
Authority / source-of-truth role
Persistence / rebuildability
Semantic domain
Mutation / failure semantics
```

그리고:

```text
provenance graph
≠
authority / precedence graph
```

이라는 분리다.

이 이후의 architecture synthesis는 이 축들을 깨지 않는 범위에서 수행한다.
새 evidence가 나오면 축 자체를 다시 검토할 수 있지만,
현재로서는 R2의 working contract로 닫는다.


---

# 42. R2 Shared Invariants / Transition-Model Collapse Test — Pass 1

> 상태: **R2 SYNTHESIS ACCEPTED — CONTRACT LEVEL**
>
> 기준 Galpi `main`: `71025861d07521f88c21b8c88360280ec6f3c604`.
>
> 이 pass는 새 subsystem을 설계하지 않는다.
> R1/R1-X/Gap-Fill의 반복 계약을 먼저 invariant로 압축하고,
> formation / consolidation / reconsolidation / revision이
> 같은 **semantic transition protocol**로 닫히는지만 검토한다.

## 42.1 Extraction rule

Shared invariant는 단일 아이디어의 취향이 아니라,
다음 중 하나를 만족하는 것만 우선한다.

```text
- 여러 독립 research section에서 반복됨
- Research Contract에서 명시적으로 재사용됨
- 기존 Galpi CLOSED operational contract가 요구함
```

반대로 exact threshold, timer, model size, table layout,
worker count 같은 것은 invariant로 올리지 않는다.

## 42.2 Shared invariants

### SI-1 — Source evidence and interpretation remain distinct

근거:
`RC1`, Truth Maintenance, Event projection, Identity repair,
Longitudinal history, Privacy.

```text
source evidence
≠ assumption
≠ hypothesis
≠ derived abstraction
```

Derived state가 아무리 안정적이어도
그 자체가 과거 source event로 승격되지는 않는다.

### SI-2 — Ordinary memory mutation changes derived state, not source history

근거:
`RC3`, `RC18`, `RC27`, `RC46`, `RC89`.

일반 update / correction / reconsolidation / identity repair는:

```text
preserve source evidence
→ revise / invalidate / supersede / rebuild derived state
```

를 따른다.

유일한 큰 예외는 **governed erasure**다.

### SI-3 — Every durable derived claim needs replayable provenance

근거:
Justification DAG, `RC20`, `RC25`, `RC26`, `RC31`,
`RC46`, `RC68`, `RC90`.

Derived state는 최소한:

```text
what source supports it?
what assumptions were used?
what counterevidence matters?
what downstream state depends on it?
```

를 추적할 수 있어야 한다.

Exact physical graph/schema는 OPEN.

### SI-4 — Formation is conservative; abstraction never replaces experience

근거:
CLS, `RC14`, `RC15`, `RC16`, `RC29`, `RC52`, identity/event research.

```text
capture can be fast
stable abstraction/generalization is conservative
```

그리고:

> **Abstraction does not replace source experience.**

Single observation, frequency, salience, or retrieval heat만으로
stable abstraction을 자동 확정하지 않는다.

### SI-5 — New evidence must be classified before mutation

근거:
Truth Maintenance / Belief Revision, `RC2`, `RC16`, `RC24`, `RC64`.

최소 의미 구분:

```text
EXPANSION
WORLD_UPDATE
CORRECTION
ADDITIONAL_CONTEXT
CONTRADICTION
TEMPORAL_SCOPE_CHANGE
INTERPRETATION_REVISION
AMBIGUOUS / UNRESOLVED
```

모든 mismatch를 overwrite / contradiction으로 취급하지 않는다.

### SI-6 — Mutation is minimal and provenance-scoped

근거:
minimal epistemic change, `RC3`, `RC22`, `RC26`, identity repair.

```text
read neighborhood can be broad
mutation neighborhood must be narrow
```

Working maxim:

> **Write conservatively. Retrieve associatively. Mutate by provenance.**

### SI-7 — High-impact transition replays source + counterevidence, not summary-of-summary

근거:
CLS structured/contrastive replay, `RC15`, Reconsolidation, `RC25`.

Candidate replay package:

```text
new evidence
original support evidence
relevant historical evidence
known counterevidence / exceptions
active assumptions
```

Derived summary alone is insufficient for high-impact revision/generalization.

### SI-8 — Retrieval / attention does not reinforce truth or grant write permission

근거:
`RC23`, `RC50`, `RC59`, Reconsolidation, Forgetting.

```text
retrieved
≠ used
≠ useful
≠ correct
≠ evidence
≠ rewrite permission
```

Meaningful new evidence / mismatch / explicit correction is what can open
a revision path.

### SI-9 — Ambiguity may persist; unsafe merge is worse than unresolved state

근거:
Fork, event segmentation, identity collision, `RC43`, `RC45`.

```text
unknown
ambiguous
multiple hypotheses
```

are valid states.

Identity false merge and other high-cost merges may use a stricter
fail-close policy than ordinary memory interpretation.

### SI-10 — Derived-state revision is proposed, validated, then committed atomically

근거:
Reconsolidation transaction, `RC27`, fail-close identity repair.

```text
stable old state
→ candidate transition
→ validate
→ atomic commit
```

If validation fails:

```text
keep old stable state
+ preserve new evidence / unresolved candidate
```

rather than partially mutating the projection.

### SI-11 — Provenance and operational authority remain separate

Accepted R2 foundation.

```text
strongly supported history
≠ permission
≠ commitment
≠ current capability

authoritative task/permission state
≠ evidence
```

The epistemic memory transition model must not silently mutate:

```text
confirmed task/reminder commitments
governance / authorization
executor-local operational truth
```

### SI-12 — Temporal history is preserved rather than flattened into latest state

근거:
`RC62`–`RC70`, Belief Revision, relationship state.

```text
same entity
→ multiple temporal states
```

`WORLD_UPDATE` preserves a valid old state as history.
`CORRECTION` changes epistemic status of an earlier claim.
These are not interchangeable.

### SI-13 — Accessibility is not validity, and validity is not erasure

근거:
`RC56`–`RC61`, Privacy.

```text
not retrieved
≠ forgotten
≠ invalidated
≠ erased
```

Read-side accessibility policies do not own source deletion or semantic truth.

### SI-14 — Erasure propagates through provenance and is outside ordinary transition semantics

근거:
`RC89`–`RC94`.

```text
governed source erasure
→ dependency reachability
→ invalidate / rebuild derived state from survivors
→ verify no resurrection
```

The rebuild step may reuse ordinary projection machinery,
but authorization and source deletion are governance operations.

### SI-15 — Evaluation evidence and learned policy do not become user-memory truth

근거:
`RC5`–`RC13`, delayed/censored outcome research.

```text
policy trace / exposure / outcome
= evaluation evidence

learned controller policy
= active policy artifact
≠ user fact
≠ governance
```

And:

```text
unobserved ≠ negative
```

remains an evaluation invariant.

---

## 42.3 Collapse test — can formation and revision share one semantic protocol?

### Formation

No current derived state exists, or existing state is insufficient.

```text
evidence package
→ classify relation / scope
→ candidate derived state
→ validate support / ambiguity / domain constraints
→ commit
```

### Consolidation / generalization

Multiple episodes/evidence are selected for replay.

```text
trigger / scheduler
→ structured evidence selection
→ replay package
→ candidate abstraction
→ validate
→ commit
```

The **selection trigger is different**, but the final transition semantics
look the same as formation.

### Reconsolidation / local revision

Existing derived state receives meaningful new evidence / mismatch.

```text
mismatch / correction trigger
→ provenance-scoped target
→ canonical replay package
→ classify change
→ candidate revised state / Fork / invalidation
→ validate
→ atomic commit
```

Again, the trigger and target-selection policy differ,
but the proposal/validation/commit semantics are highly similar.

### Event-boundary micro-consolidation

```text
derived event-boundary signal
→ select recently closed context
→ run bounded formation/generalization evaluation
```

The boundary is a **trigger candidate**, not a new truth semantics.

### Preliminary synthesis

Current corpus strongly supports:

> **Formation, consolidation, and reconsolidation can share one provenance-aware derived-state transition protocol, while differing in trigger, evidence selection, target scope, and domain-specific validation gates.**

This is stronger and smaller than separate "formation subsystem",
"CLS subsystem", and "reconsolidation subsystem".

---

## 42.4 Candidate transition protocol

This is a semantic protocol, **not yet a proposed code class/service**.

```text
TRIGGER
  ↓
SELECT TARGET / SCOPE
  ↓
BUILD REPLAY PACKAGE
  - new evidence
  - current support
  - relevant history
  - counterevidence / exceptions
  - assumptions
  ↓
CLASSIFY CHANGE
  ↓
PROPOSE TRANSITION
  - NO_CHANGE
  - CREATE
  - EXPAND
  - SUPERSEDE
  - REVISE
  - FORK / KEEP_AMBIGUOUS
  - INVALIDATE
  ↓
DOMAIN-SPECIFIC VALIDATION / PROMOTION GATE
  ↓
ATOMIC COMMIT OF DERIVED STATE + PROVENANCE
```

Important:

```text
trigger does not force write
retrieval does not force trigger
classification does not bypass authority
failure does not partially mutate stable state
```

---

## 42.5 What must remain outside the generic epistemic transition protocol

The collapse has limits.

### Operational commitment

```text
task / reminder
```

has its own confirmed operational state machine.

Memory may supply context or a candidate,
but cannot commit on the user's behalf.

### Governance / authorization / erasure authority

Permission and deletion authority are external to learned memory transitions.

### Executor-local operational state

Skill memory may describe a procedure;
the executor owns actual runtime implementation/capability truth.

### Read-side context assembly

Retrieval routing, Working Set assembly, association expansion,
and ordinary forgetting/accessibility are read policy,
not epistemic mutation.

### Policy learning / evaluation

OPE, delayed outcomes, learned write/retrieval policy
operate on evaluation evidence and policy artifacts.

### Derived structural projections

Event segmentation / association graphs may use shared provenance/rebuild rules,
but a full rebuildable structural projection does not necessarily need the same
claim-level transition representation.

---

## 42.6 Domain-specific gates remain even if the transition protocol is shared

A shared protocol must not erase asymmetric error costs.

Examples:

```text
ordinary memory write
→ normal support / ambiguity gate

Identity merge
→ stricter fail-close gate

User Core promotion
→ stricter always-visible safety/stability gate

Skill promotion
→ transfer / verification / executor compatibility gate

Autobiographical narrative
→ provenance + anti-mythology gate
```

Thus:

> **Shared transition semantics do not imply shared thresholds or shared authority.**

---

## 42.7 Important implementation warning

This synthesis does **not** justify building one giant:

```text
MemoryTransitionEngine
```

that owns every memory feature.

That would risk replacing theory-level duplication with
software-level over-abstraction.

The current conclusion is only:

```text
one semantic transition contract
+ different trigger/selection policies
+ different domain validation gates
+ potentially different concrete implementations where useful
```

Implementation boundaries should follow actual code integration,
authority, lifecycle, performance, and testability.

---

## 42.8 What is now close to settled vs still open

### Strong synthesis candidate

```text
formation
consolidation
reconsolidation
ordinary derived-memory revision
```

share one provenance-aware transition **contract**.

### Still open

```text
exact change taxonomy
exact replay-package representation
hypothesis / Fork persistence shape
which transitions run synchronously
event-boundary trigger policy
background consolidation trigger
promotion thresholds
whether event projections reuse the same concrete machinery
physical evidence/provenance storage
```

### Explicitly outside

```text
task/reminder commitment transitions
governance / authorization
governed source erasure authority
executor runtime state
retrieval/Working Set mutation
evaluation-policy learning
```

## 42.9 User decision — ACCEPTED

사용자는 다음 합성을 채택했다.

> **Adopt a single provenance-aware semantic transition contract for derived epistemic memory formation/revision, while keeping triggers, evidence-selection policies, domain-specific gates, and operational/governance authority distinct.**

이 결정은 하나의 runtime subsystem/class/service를 강제하지 않는다.


---

# 43. R2 Semantic Collapse / Completion Pass — Pass 1

> 상태: **WORKING SYNTHESIS — INDIVIDUAL COLLAPSES NOT YET ALL CLOSED**
>
> 기준 Galpi `main`: `71025861d07521f88c21b8c88360280ec6f3c604`.
>
> 목적: theory 이름을 줄이는 것이 아니라,
> **같은 semantic object/process를 다른 이론이 설명하고 있는지,
> 또는 한 이론이 다른 이론의 missing field / transition / gate를 채우는지**
> 확인한다.

## 43.1 Verdict vocabulary

이 pass에서는 무조건 합치지 않는다.

```text
MERGE
→ 같은 semantic object/process로 설명 가능

COMPOSE
→ 서로 다른 개념이지만 한쪽이 다른 쪽의 missing stage/field를 채움

SPECIALIZE
→ generic semantic model을 재사용하되 domain-specific stricter gate/meaning이 필요

DECOMPOSE
→ 기존 하나의 개념이 실제로 둘 이상의 다른 semantics를 섞고 있었음

KEEP SEPARATE
→ meaning / authority / lifecycle / failure policy 때문에 합치면 안 됨
```

목표는 mechanism count 최소화가 아니라 **semantic distinction 손실 없이 vocabulary를 줄이는 것**이다.

---

## 43.2 Collapse matrix

| Existing concepts | Verdict | Semantic synthesis |
|---|---|---|
| Fork + Hypothesis + Justification | **MERGE** | `Hypothesis State`가 evidence/assumption justification과 status를 가진다. Fork는 별도 truth type이라기보다 동시에 유지되는 1..N hypothesis의 unresolved relation/view다. |
| Prediction + discriminator | **MERGE / COMPOSE** | Prediction은 hypothesis를 검증하기 위한 optional discriminating expectation이다. 모든 hypothesis에 materialize할 필요는 없다. |
| Active Elicitation + VOI | **COMPOSE** | Hypothesis/discriminator가 “무엇을 알면 갈리는가”를 제공하고, acquisition policy가 observe/opportunistic/ask 중 무엇을 할지 결정한다. State와 policy는 합치지 않는다. |
| Belief Revision + change taxonomy + Reconsolidation | **MERGE** | Belief revision이 transition semantics를 제공한다. Reconsolidation은 별도 memory type보다 **existing state를 reopen할 trigger/scope discipline**으로 해석한다. |
| CLS schema-congruence + reconsolidation mismatch gating | **MERGE / COMPOSE** | `congruent / novel / conflicting / ambiguous`는 derived transition을 fast integration, replay, Fork/revision으로 route하는 gate 후보로 합칠 수 있다. |
| Reflection + consolidation + structured replay | **COMPOSE** | Reflection은 replay 대상 선택/abstraction proposal 역할, CLS는 old/new/correction/exception을 함께 보는 replay discipline, shared transition contract가 commit semantics를 담당한다. |
| Event-boundary micro-consolidation + background consolidation | **COMPOSE** | 둘은 다른 trigger/timescale이다. 동일 formation/generalization evaluation을 깨울 수 있지만 같은 trigger로 합치지 않는다. |
| Formatter + adaptive specialization | **MERGE at contract level** | Formatter는 `derived projection type/contract`; adaptive specialization은 언제 어떤 projection contract를 materialize/activate할지에 대한 lifecycle/policy다. |
| Ranking + Timeline + Decision Ledger + Relationship + Routine + Preference Set + Event view | **MERGE at meta-level / KEEP typed semantics** | 모두 provenance-backed derived projection family로 묶을 수 있다. 하지만 각 representation의 query/update semantics는 보존한다. Generic EAV 하나로 평탄화하지 않는다. |
| General Temporal Graph | **DECOMPOSE** | `derivation/provenance dependency graph`와 `semantic association/entity/event graph`를 구분한다. 전자는 correction/erasure/replay의 cross-cutting provenance semantics, 후자는 rebuildable semantic projection/retrieval view다. |
| Justification DAG + correction dependency + erasure reachability | **MERGE** | 하나의 `Derivation / Dependency Provenance` 의미 모델로 합칠 수 있다. Exact physical graph/store는 OPEN. |
| Semantic graph + association levels + event transition links | **MERGE at projection level** | entity/relationship/event/association edges는 typed semantic association projection으로 묶을 수 있다. Provenance edge와 의미를 섞지 않는다. |
| Temporal validity + Timeline + Temporal User Model + Life/Shared/Self History | **COMPOSE** | 시간은 모든 derived state에 걸치는 validity dimension이고, Timeline/UserModel(t)/History는 그 time-indexed state/event를 읽는 projection이다. Timeline 자체를 temporal truth substrate로 만들지 않는다. |
| User Model + specialized projections | **COMPOSE** | User Model은 별도 “모든 것을 담는 profile engine”보다 user-related derived states/projections의 current/historical composition으로 볼 수 있다. Exact materialization은 OPEN. |
| Self-Concept Claim + behavioral trait inference | **KEEP SEPARATE under shared claim model** | explicit self-description은 typed source-backed claim; behavior-derived personality는 revisable hypothesis. 동일 trait slot으로 flatten하지 않는다. |
| Autobiographical narrative hypothesis + general Hypothesis | **MERGE** | unsupported life-story meaning은 특별한 truth class가 아니라 narrative-scoped hypothesis로 취급 가능하다. |
| Identity resolution + Fork/Revision/Elicitation | **SPECIALIZE** | referent assignment은 generic hypothesis/revision/acquisition semantics를 재사용하되 false merge 비용 때문에 stricter fail-close/clarification gate를 가진다. |
| Relationship closeness + relationship memory | **MERGE** | closeness는 Person entity의 intrinsic field가 아니라 `Relationship(USER, PERSON)` projection의 state다. |
| Conversational/reference salience + closeness | **KEEP SEPARATE / COMPOSE on read** | closeness는 relationship truth; salience는 current-context derived prior. Reference resolution에서 함께 사용할 수 있지만 같은 state가 아니다. |
| Event segmentation + context reinstatement + associative retrieval + sparse routing + Working Set | **COMPOSE into one read process** | 하나의 `Context Assembly` semantic process로 이어진다: context interpretation → candidate retrieval → bounded expansion → focus selection → Working Set. Event state 자체와 Working Set은 같은 state가 아니다. |
| Forgetting/accessibility + retrieval routing | **MERGE at read-policy level** | ordinary forgetting은 deletion이 아니라 candidate accessibility/prior 조정으로 context assembly 안에 들어간다. |
| User Core + Working Set | **KEEP SEPARATE / COMPOSE** | User Core는 tiny stable privileged derived projection/input, Working Set은 ephemeral compiled output이다. 둘 다 context assembly에 참여하지만 lifecycle/authority가 다르다. |
| User Core + System Core + Role Core + thread bias | **COMPOSE through privileged-context interface** | 모두 read context에 prior/anchor를 제공할 수 있으나 provenance/authority가 다르다. User Core는 derived user projection, System/Role Core는 declared/config/role contract가 포함될 수 있으므로 semantic merge 금지. |
| Specialist-local Working Set + thread-local context + handoff bridge | **MERGE at cognitive-state level** | 모두 scoped ephemeral/rebuildable cognitive context다. specialist/thread마다 scope가 다를 뿐 별도 long-term truth가 아니다. |
| Specialist-derived experience + ordinary derived memory | **MERGE with scope metadata** | specialist-specific interpretation은 shared evidence에서 파생된 domain/scoped projection으로 볼 수 있다. 별도 user-truth silo는 필요 없다. |
| Skill candidate + generic derived transition | **SPECIALIZE** | skill formation/revision도 evidence → candidate → validate → promote/revise contract를 재사용한다. Skill promotion에는 transfer/verification/executor-compatibility gate가 추가된다. |
| Explicit teaching + learned skill + registered skill | **MERGE as acquisition paths** | explicit instruction, repeated execution, composition은 서로 다른 evidence acquisition paths이고 최종 target은 같은 Skill Contract semantic family다. |
| Macro skill + primitive skill | **MERGE under executor-relative skill contract** | 서로 다른 memory type이 아니라 executor/interface boundary에 따른 granularity/implementation choice다. |
| Skill Contract + deployed executor macro | **KEEP SEPARATE** | reusable contract vs executor-local implementation/receipt. Version/hash boundary 유지. |
| Routine + Skill | **KEEP SEPARATE** | routine은 user/system behavior pattern에 대한 descriptive projection; skill은 executable procedure contract다. |
| Prospective intention + task/reminder | **COMPOSE, authority stays separate** | intention semantics는 WHAT/CUE/DEACTIVATION을 제공할 수 있지만 confirmed task/reminder는 기존 operational SoT가 authority를 가진다. |
| Prospective cue monitoring + Context Assembly | **COMPOSE** | context/event cue가 relevant할 때만 intention을 활성화하는 monitoring은 read/context gating과 재사용 가능하다. 실행/commit authority는 별도다. |
| Prediction + Prospective Intention | **KEEP SEPARATE** | prediction은 “무엇이 관측될 것인가”, intention은 “무엇을 다시 관련 있게 만들거나 수행할 것인가”. |
| Learned Memory Controller + write/retrieve/route/consolidate/ask/suppress policies | **MERGE as policy-implementation family** | controller는 memory content class가 아니라 여러 memory decision policy를 구현하는 optional learned mechanism이다. 하나의 neural model을 강제하지 않는다. |
| OPE + delayed/censored outcomes + usage attribution + policy traces | **MERGE as evaluation semantics** | policy decision → exposure/use/opportunity → outcome → evaluation의 instrumentation/evaluation loop로 합칠 수 있다. |
| Typed negative feedback + ordinary evidence | **MERGE as evidence typing** | rejection/cancel/correction/disable은 별도 memory subsystem이 아니라 semantic type이 명확한 source/outcome evidence다. `no response`는 자동 negative가 아니다. |
| Erasure propagation + dependency provenance + projection rebuild | **COMPOSE** | provenance reachability와 surviving-source replay는 ordinary machinery를 재사용할 수 있다. 하지만 authorization/source deletion/no-resurrection은 governance가 소유한다. |
| Forgetting + invalidation + erasure | **KEEP SEPARATE** | accessibility, epistemic validity, governed deletion은 계속 독립 semantics다. |

---

## 43.3 Strong result 1 — Fork is probably not a standalone primitive

R1에서는 `Memory Fork`가 독립 mechanism처럼 보였다.

Gap-Fill 이후 더 작은 model:

```text
Hypothesis State H
- claim / interpretation
- evidence support
- assumptions
- counterevidence
- temporal scope
- status
- optional discriminators / expectations
```

그리고:

```text
Fork
= 1..N simultaneously live hypotheses
  whose distinction has not been safely collapsed
```

즉 Fork는 별도 content store라기보다 **hypothesis set의 unresolved relation/state**일 가능성이 높다.

`Memory Prediction`도:

```text
Hypothesis
→ optional discriminator / expectation
```

으로 내려갈 수 있다.

Active Elicitation은 그 위의 별도 policy:

```text
discriminator available
      ↓
value of resolving?
      ↓
observe / opportunistic / explicit ask
```

이 구조는 기존 결론:

```text
Fork ≠ Active Acquisition
```

을 보존하면서도 mechanism 수를 줄인다.

---

## 43.4 Strong result 2 — Reconsolidation becomes reopening semantics

Accepted transition contract 위에서 reconsolidation을 다시 보면:

```text
retrieval
≠ reconsolidation

meaningful mismatch / correction
→ reopen affected derived state
→ provenance-scoped replay
→ transition
```

따라서 reconsolidation은 별도 state machine 전체라기보다:

```text
WHEN existing stable state is eligible to reopen
+
HOW its target scope is selected
```

를 제공한다.

Belief Revision이:

```text
WHAT kind of change is this?
```

를 제공하고,

CLS / structured replay가:

```text
WHAT evidence package should be considered before committing?
```

을 채운다.

세 이론은 같은 contract의 서로 다른 빈칸을 채운다.

---

## 43.5 Strong result 3 — “General Graph” must be decomposed

초기 hypothesis:

```text
General Temporal Graph
= semantic substrate
```

는 현재 R2 기준으로 너무 넓다.

“graph”라는 단어 아래 실제로 두 semantics가 섞여 있다.

### A. Derivation / Dependency Provenance

```text
evidence
→ assumption
→ derived claim
→ dependent projection
```

용도:

```text
explanation
correction reachability
minimal revision
canonical replay
erasure propagation
rebuild
```

### B. Semantic Association Projection

```text
entity
relationship
event membership
event transition
shared goal
semantic association
```

용도:

```text
retrieval
navigation
context reinstatement
history exploration
```

B는 rebuildable derived projection이다.

A와 B를 같은 edge semantics로 취급하면:

```text
"because derived from"
```

과:

```text
"semantically related to"
```

가 섞여 mutation/erasure scope가 오염될 수 있다.

따라서 현재 추천:

> **Keep provenance/dependency and semantic association as distinct semantics even if a future physical graph store can technically hold both.**

이는 physical DB 선택이 아니다.

---

## 43.6 Strong result 4 — Formatter becomes Projection Contract

Formatter 연구의 핵심은 유지하지만 이름의 의미를 좁힌다.

```text
Formatter
≈ Derived Projection Contract
```

예:

```text
Ranking Projection
Timeline Projection
Decision Projection
Relationship Projection
Routine Projection
Event Projection
Semantic Association Projection
```

공통으로:

```text
support provenance
scope
temporal semantics
validation
render/query behavior
```

를 가지되 representation-specific behavior는 다르다.

중요:

> **Common projection contract does not justify one generic schema/table.**

Adaptive Specialization은 별도 memory type이 아니라:

```text
when is a projection type useful enough
to instantiate/materialize/activate for this domain?
```

이라는 projection lifecycle/policy 문제로 내려간다.

---

## 43.7 Strong result 5 — Time is a dimension; Timeline is a view

다음은 합치면 안 된다.

```text
temporal validity
≠
Timeline formatter
```

Temporal validity:

```text
claim/state @ time interval / point
```

은 User Model, relationship, preference, system history 등
여러 derived state에 걸치는 cross-cutting semantic dimension이다.

Timeline / Life History / Shared History / Self-History는:

```text
time-indexed evidence / states / events
→ human/reasoning projection
```

이다.

따라서:

```text
UserModel(now)
UserModel(t)
```

도 별도 static profile을 복제하기보다
time-indexed derived state를 조합하는 logical projection으로 설명할 수 있는지 우선 본다.

Exact materialization은 계속 OPEN.

---

## 43.8 Strong result 6 — Context Assembly absorbs many read-side mechanisms

현재 read-side를 한 process로 구성할 수 있다.

```text
CURRENT INPUT / ACTIVE ROLE / THREAD CONTEXT
            ↓
CONTEXT / EVENT INTERPRETATION
            ↓
DIRECT RETRIEVAL / ROUTING
            ↓
BOUNDED ASSOCIATIVE + EVENT EXPANSION
            ↓
ACCESSIBILITY / SCOPE / CONTEXT PRIORS
            ↓
ACTIVATED CANDIDATE SET
            ↓
NARROW FOCUS SELECTION
            ↓
WORKING SET
```

여기에 들어가는 기존 mechanism:

```text
Sparse Routing
Contextual Memory Activation
Event-first Retrieval
Context Reinstatement
Associative Retrieval
ordinary Forgetting / Accessibility
specialist retrieval lens
thread-local bias
```

Core family는 input prior로 참여한다.

```text
Tiny User Core
→ stable derived prior

System / Role Core
→ declared/config/role prior

Working Set
→ output
```

따라서 같은 “context” interface를 공유할 수는 있지만
source/authority를 하나로 합치지는 않는다.

---

## 43.9 Strong result 7 — Identity is a specialized hypothesis domain

Identity collision:

```text
mention / alias
→ candidate referents
→ evidence clustering
→ discriminating evidence
→ assignment / unresolved
```

은 generic hypothesis/acquisition/revision model과 구조가 같다.

따라서 새 identity reasoning engine을 만들 필요는 약하다.

다만 identity의 false merge는 downstream contamination 비용이 크다.

```text
generic ambiguity
→ unresolved allowed

identity ambiguity
→ unresolved allowed
+ merge fail-close
+ stronger clarification priority
+ split/merge rebuild of dependent projections
```

즉:

> **Reuse the model; specialize the gate.**

Relationship memory도 별도 social engine이 아니라
entity pair에 대한 projection으로 내려간다.

---

## 43.10 Strong result 8 — Skill research collapses into one skill semantic family

다음은 별도 memory classes일 필요가 없다.

```text
user-taught skill
learned skill
registered skill
macro skill
primitive skill
```

더 작은 model:

```text
Skill Contract
- applicability
- inputs
- preconditions
- goal/procedure
- termination
- verification
- executor compatibility
- provenance / validation
- version
```

Acquisition path:

```text
explicit instruction
execution episodes
repeated composition
imported/registered procedure
```

Granularity:

```text
executor/interface-relative
```

Lifecycle:

```text
candidate
→ validate
→ promote
→ revise/deactivate/version
```

이 lifecycle은 accepted derived transition contract를 재사용한다.

하지만:

```text
Skill Contract
≠ authorization
≠ confirmed prospective commitment
≠ deployed executor implementation
≠ current capability state
```

은 유지한다.

---

## 43.11 Strong result 9 — Specialist and chat memory mostly collapse into scoped cognition

기존 specialist/session 연구의 long-term memory 관련 부분은 크게 줄일 수 있다.

```text
specialist Working Set
thread Working State
handoff bridge
retrieval lens
thread bias
active identity segment
```

은 대부분:

```text
scoped cognitive context
```

로 설명 가능하다.

Specialist-derived experience도:

```text
shared source evidence
→ scoped/domain derived projection
```

으로 처리할 수 있다.

따라서:

```text
specialist memory DB
thread memory DB
```

같은 별도 truth model은 필요 없다.

Conversational identity handoff는 product/interaction contract로 남지만
새 long-term memory primitive는 아니다.

---

## 43.12 Strong result 10 — Learned Memory Controller is an implementation, not a semantic memory type

R1의 `Neural Memory Controller`는 중요한 연구 축이지만
semantic architecture의 독립 memory class일 필요는 없다.

그 역할:

```text
write?
retrieve?
route?
consolidate?
ask?
suppress/accessibility?
```

은 각각 memory **policy decision**이다.

따라서:

```text
Memory Policy Contract
→ heuristic / rules / LLM / learned model
```

중 learned model은 implementation option으로 볼 수 있다.

OPE / delayed feedback / PU / attribution은:

```text
decision
→ opportunity / exposure / use
→ outcome
→ evaluation
→ next policy version
```

이라는 evaluation semantics를 제공한다.

중요:

> **One policy family does not imply one neural controller model.**

정책별로 서로 다른 learner를 쓰거나 일부는 deterministic contract로 남길 수 있다.

---

## 43.13 Semantic gaps that are now filled by composition

R1 mechanism들은 몇 곳에서 서로의 빈칸을 실제로 채운다.

### Gap A — Fork had no principled resolution action

```text
Fork / Hypothesis
+ Prediction / Discriminator
+ VOI / Active Elicitation
```

→ unresolved interpretation + discriminating evidence acquisition loop.

### Gap B — Belief revision said how to change, not what to replay

```text
Belief Revision
+ Justification/Provenance
+ CLS structured replay
```

→ minimal change with support/counterevidence replay.

### Gap C — Consolidation said how to generalize, not when to touch stable state

```text
CLS
+ Reconsolidation mismatch trigger
+ Event-boundary / background triggers
```

→ multi-trigger, conservative transition evaluation.

### Gap D — Formatter said how to represent, not how to decide relevance now

```text
Projection Contracts
+ Sparse Routing
+ Event/Association Retrieval
+ Context Assembly
```

→ representation separated from activation.

### Gap E — Identity said entity correctness matters, but needed a generic uncertainty model

```text
Identity
+ Hypothesis/Fork
+ Active Elicitation
+ Provenance-scoped revision
```

→ high-cost specialization of generic ambiguity/revision.

### Gap F — Skill memory needed both epistemic formation and operational deployment

```text
Derived Transition Contract
+ Skill Contract
+ Executor-relative Deployment
+ Governance boundary
```

→ learned/taught procedure can mature safely without memory owning machinery.

### Gap G — Privacy needed a way to find what derived artifacts must change

```text
Governed Erasure
+ Derivation/Dependency Provenance
+ Projection Replay/Rebuild
```

→ deletion authorization remains governance; propagation/rebuild reuses epistemic infrastructure.

---

## 43.14 Emerging minimal semantic vocabulary — not architecture

이 pass 이후 많은 theory names를 그대로 runtime noun으로 유지할 필요가 없어 보인다.

현재 최소 vocabulary 후보:

```text
1. SOURCE RECORD / EVIDENCE

2. DERIVED STATE
   - candidate hypothesis
   - current claim/state
   - historical/inactive state

3. DERIVATION / DEPENDENCY PROVENANCE

4. PROJECTION CONTRACT
   - ranking / timeline / relationship / event / routine / ...

5. DERIVED-STATE TRANSITION
   - create / expand / world-update / correct / revise /
     fork / invalidate / supersede

6. CONTEXT ASSEMBLY
   - routing / association / event reinstatement /
     accessibility / focus / Working Set

7. EVIDENCE-ACQUISITION POLICY
   - observe / opportunistic / ask

8. MEMORY POLICY + EVALUATION
   - write / route / retrieve / consolidate / accessibility /
     instrumentation / outcome evaluation

9. DOMAIN AUTHORITY STATE
   - commitment / capability / skill contract authority /
     governance
```

주의:

```text
vocabulary item
≠
runtime subsystem
≠
database
≠
service
```

특히 `DOMAIN AUTHORITY STATE`는 하나의 store라는 뜻이 아니라
accepted truth/state map에서 authority가 memory-derived truth와 다른
여러 operational/governance domain을 묶어 부르는 분석 용어다.

---

## 43.15 Where further collapse would be harmful

여기서는 줄이지 않는다.

```text
evidence ≠ interpretation
provenance relation ≠ semantic association
temporal validity ≠ timeline view
identity ≠ alias
closeness ≠ salience
routine ≠ skill
prediction ≠ intention
skill contract ≠ authorization ≠ deployment
memory ≠ confirmed commitment
Working Set ≠ persistent state
accessibility ≠ validity ≠ erasure
self-history ≠ current capability
policy reward ≠ user truth
```

이 구분들은 mechanism duplication이 아니라 correctness contract다.

---

## 43.16 Main challenge to the earlier R1 architecture

이 pass에서 가장 큰 수정 제안은 초기:

```text
General Temporal Graph
= common semantic substrate
```

를 그대로 유지하지 않는 것이다.

현재 문서 전체를 합치면 더 안전한 해석은:

```text
Source records / evidence
        ↓
Derivation & dependency provenance  ← epistemic support / mutation scope
        ↓
Derived state + typed projections
        ↓
Semantic association/event graph   ← one rebuildable projection family
```

이다.

즉 **graph는 하나의 보편 truth substrate라기보다 서로 다른 edge semantics를 가진 도구/representation**일 가능성이 높다.

이 변경은 Graphiti 아이디어를 버리는 것이 아니라,
Graphiti에서 얻은 temporal/entity/association 장점을
provenance authority와 분리하는 것이다.

---

## 43.17 Open items after this pass

아직 닫지 않는다.

```text
physical source/evidence organization
exact hypothesis persistence shape
whether discriminating predictions are materialized
exact Projection Contract interface
which projections are materialized vs query-time
exact User Model materialization
Context Assembly baseline algorithm
event segmentation trigger/algorithm
consolidation / promotion thresholds
Memory Policy learner decomposition
exact prospective agent-internal authority model
exact governance erasure machinery
```

다음 합성에서는 먼저 이 semantic collapse가 맞는지 검토한 뒤,
남은 **non-collapsible boundaries**와 **empirical variants**만 추린다.


## 43.18 User decision — General Graph decomposition ACCEPTED

사용자는 R1 초기의:

```text
General Temporal Graph
= common semantic substrate
```

가설을 그대로 유지하지 않고,
다음 semantic decomposition을 채택했다.

```text
DERIVATION / DEPENDENCY PROVENANCE
≠
SEMANTIC ASSOCIATION / EVENT PROJECTION
```

채택 이유:

- 이후 Truth Maintenance / correction / reconsolidation 연구는
  `derived from`, support, contradiction, dependency가
  **mutation scope와 replay scope를 결정하는 epistemic relation**임을 반복해서 요구했다.
- Event / associative retrieval / identity / relationship 연구는
  `related to`, event membership, transition, semantic association이
  **retrieval/context reconstruction을 위한 derived semantic relation**임을 요구했다.
- Privacy / governed erasure는 provenance/dependency reachability를 따라야 하며,
  semantic association을 deletion propagation authority로 쓰면 과삭제 위험이 있다.
- 따라서 두 relation family를 하나의 generic graph edge semantics로 합치면
  correction/erasure와 retrieval/navigation의 책임이 오염될 수 있다.

이 결정은 **graph storage technology를 금지하거나 두 physical databases를 강제하지 않는다.**
한 graph engine/store가 양쪽 edge type을 저장할 수도 있지만,
semantic contract와 traversal authority는 분리해야 한다.

R2 invariant로 채택:

> **A semantic association may help XION find related evidence; it does not by itself justify belief revision, dependency mutation, or erasure propagation.**

또한 반대 방향도 성립한다.

> **A provenance/dependency edge explains support or derivation; it does not automatically imply semantic retrieval relevance.**

이 결정은 R1의 Graphiti/temporal graph 연구를 폐기하는 것이 아니다.
그 연구의 entity/event/temporal/association 장점은
`Semantic Association / Event Projection` 쪽으로 보존하고,
epistemic support/mutation semantics만 별도 provenance relation으로 정규화한다.


---

# 44. R2 Semantic Decision Candidate — Hypothesis / Fork / Prediction / Elicitation

> 상태: **R2 SEMANTIC COLLAPSE ACCEPTED**
>
> 기준 Galpi `main`: `71025861d07521f88c21b8c88360280ec6f3c604`.
>
> 이 section은 `memory-architecture-survey.md`의 Truth Maintenance / Belief Revision,
> Active Elicitation / VOI, Reconsolidation / Prediction-Error findings와
> corresponding Research Contracts를 다시 대조한 결과다.

## 44.1 Prior research that must be preserved

기존 문서에서 이미 닫힌 의미:

```text
evidence ≠ assumption
hypothesis is derived from evidence + assumptions
Fork branches need not be mutually exclusive
prediction can validate / discriminate hypotheses
uncertainty ≠ value of resolving it
ask about discriminators, not Fork labels
observe → opportunistic → explicit ask
retrieval/access alone does not justify rewrite
```

따라서 단순한:

```text
Fork = A XOR B XOR C
```

모델은 기존 연구와 충돌한다.

## 44.2 Proposed semantic collapse

### A. Hypothesis State

하나의 해석/claim 후보를 나타내는 기본 derived epistemic state.

Logical fields:

```text
Hypothesis
- claim / interpretation
- supporting evidence references
- assumptions
- known counterevidence
- temporal / contextual scope
- status
- optional discriminators / expectations
```

정확한 schema는 여기서 고정하지 않는다.

### B. Ambiguity / Hypothesis Set

기존 `Memory Fork`는 별도 memory content type보다:

> **같은 unresolved question / interpretation space에 속하는 1..N live hypotheses의 relation/view**

로 내린다.

중요:

```text
set membership
≠ mutual exclusivity
≠ exhaustiveness
```

가능한 상태:

```text
H1 true
H2 true
H3 unresolved
```

도 허용한다.

따라서 `Fork`라는 이름은 연구 개념으로 남길 수 있지만,
runtime semantic primitive 후보는 `Hypothesis`이고
Fork는 hypothesis-set / ambiguity relation에 가깝다.

## 44.3 Prediction becomes a discriminator subtype

기존 `Memory Prediction`을 독립 memory type으로 두지 않는다.

더 작은 모델:

```text
Hypothesis
→ Discriminator
   ├─ expected future observation
   ├─ clarifying attribute
   ├─ contradictory observation
   └─ other evidence that changes hypothesis compatibility
```

`Prediction`은 이 중:

```text
if H is materially true,
what future/observable evidence should we expect?
```

라는 **prediction-shaped discriminator**다.

따라서 모든 hypothesis가 반드시 prediction row를 가져야 하는 것은 아니다.

강한 원칙:

> **A prediction is useful when it can discriminate or validate a live hypothesis; prediction materialization is not a requirement for hypothesis existence.**

## 44.4 Active Elicitation remains policy, not state

Hypothesis / discriminator model이:

```text
"What evidence would resolve this?"
```

를 제공한다.

Active Elicitation / VOI는:

```text
"Is resolving it worth doing now, and how?"
```

를 결정한다.

Candidate policy flow:

```text
live ambiguity / hypothesis set
        ↓
relevant discriminator exists?
        ↓
would branches materially change downstream answer/action?
        ↓
cheap natural evidence likely?
   ├─ yes → OBSERVE / DO_NOTHING
   └─ no
        ↓
opportunistic acquisition possible?
   ├─ yes → OPPORTUNISTIC
   └─ no
        ↓
VOI > interruption / answerability / error cost?
   ├─ yes → EXPLICIT ASK
   └─ no  → KEEP UNRESOLVED
```

이 separation은 기존:

```text
Fork ≠ Active Acquisition
```

contract를 보존한다.

## 44.5 How reconsolidation connects without becoming the same concept

새 evidence가 들어오면:

```text
discriminator / ordinary evidence
→ compare against live hypothesis / derived state
→ MATCH / compatible novelty / informative mismatch / large mismatch
→ shared derived-state transition contract
```

즉:

```text
Hypothesis model
= what interpretations are live?

Discriminator
= what evidence would distinguish / validate them?

Acquisition policy
= whether/how to seek that evidence?

Reconsolidation reopening
= when new evidence is strong enough to reopen stable derived state?

Belief revision / transition
= what change semantics to apply?
```

서로 합쳐지는 부분과 남겨야 하는 부분이 명확해진다.

## 44.6 Why not collapse further

다음은 하나로 만들면 안 된다.

```text
assumption ≠ hypothesis
```

Assumption은 interpretation을 가능하게 하는 premise이고,
Hypothesis는 evidence + assumptions에서 나온 derived claim이다.

또:

```text
discriminator ≠ acquisition action
```

무엇을 알면 구분되는지와
실제로 사용자에게 물을지는 다른 문제다.

그리고:

```text
hypothesis uncertainty ≠ probability requirement
```

모든 hypothesis에 calibrated probability를 강제하지 않는다.
`ACTIVE / WEAKENED / CONTRADICTED / UNRESOLVED` 같은 epistemic state와
support structure만으로 충분한 경우가 있다.

## 44.7 Identity becomes a specialization of this model

Identity ambiguity:

```text
mention / alias
→ candidate referent hypotheses
→ discriminators
→ observe / ask
→ assignment or unresolved
```

는 같은 model을 재사용할 수 있다.

차이는 gate:

```text
generic hypothesis
→ unresolved allowed

identity assignment
→ unresolved allowed
+ unsafe merge fail-close
+ stronger evidence / clarification requirement
```

따라서 별도 identity uncertainty engine보다:

> **shared hypothesis semantics + identity-specific stricter gate**

를 우선한다.

## 44.8 What remains open

이번 decision을 채택해도 다음은 아직 고정하지 않는다.

```text
exact persistent Hypothesis schema
whether Ambiguity Sets are materialized or query-time
whether discriminators/predictions are persisted
how hypothesis support strength is represented
whether probabilities are ever attached
exact VOI approximation
question cooldown / interruption policy
identity-specific threshold
```

## 44.9 User decision — ACCEPTED

사용자는 다음 semantic collapse를 채택했다.

> **MERGE Fork into a non-exclusive Hypothesis/Ambiguity model; treat Prediction as an optional discriminator on hypotheses; keep Active Elicitation/VOI as a separate evidence-acquisition policy that may observe, wait, act opportunistically, ask, or leave ambiguity unresolved.**

따라서 R2의 accepted semantics는:

```text
Hypothesis
= evidence + assumptions에서 파생된 live interpretation / claim

Fork
= 같은 ambiguity space에 속한 1..N live Hypotheses의 unresolved relation/view
  (mutual exclusivity / exhaustiveness를 강제하지 않음)

Prediction
= hypothesis를 검증하거나 구분하는 optional discriminator subtype

Active Elicitation / VOI
= discriminator를 실제로 얻을 가치와 획득 방식을 결정하는 policy
```

이다.

추가로 유지하는 경계:

```text
assumption ≠ hypothesis
discriminator ≠ acquisition action
uncertainty ≠ probability requirement
```

Identity ambiguity는 이 shared model을 재사용하되
false merge 비용 때문에 stricter fail-close / clarification gate를 둔다.

이 결정은 memory subsystem 수, concrete schema, storage, probability model을 결정하지 않는다.


---

# 45. R2 Semantic Decision Candidate — Projection / Formatter / User Model

> 상태: **R2 SEMANTIC COLLAPSE ACCEPTED**
>
> 기준 Galpi `main`: `71025861d07521f88c21b8c88360280ec6f3c604`.
>
> 근거 corpus: R1 representation heterogeneity, Domain-local Ranking,
> Adaptive Memory Specialization, Memory Formatter Architecture,
> Multi-Formatter Provenance, CLS multiple-representation findings,
> Relationship/Identity, Core/Working Memory, Temporal User Model,
> 그리고 R2에서 이미 채택한 provenance/authority 및 transition contracts.

## 45.1 Prior research that must be preserved

기존 연구의 반복 결론:

```text
no single representation wins everywhere
one evidence can contribute to 0..N representations
ranking is domain-local, not universal
one domain may need 0..N representation types
human memory taxonomy must not become software schema taxonomy
derived representations remain provenance-backed / rebuildable
Core is a projection, not truth
Timeline is a temporal view, not temporal truth itself
Relationship state is revisable
Routine != executable Skill
```

또한 R2에서 이미:

```text
Derivation / Dependency Provenance
!=
Semantic Association / Event Projection
```

을 채택했다.

## 45.2 Main correction — the old `MemoryFormatter` contract mixes three responsibilities

R1의 후보 contract:

```text
MemoryFormatter
- accepts(evidence)
- merge(state, evidence)
- render(state, query)
```

는 현재 R2 기준으로 서로 다른 semantics를 한 object에 묶고 있다.

### `accepts(...)`

질문:

```text
이 evidence / derived state가
어떤 representation에 기여할 가치가 있는가?
```

이는 **routing / materialization / specialization policy**에 가깝다.

### `merge(...)`

질문:

```text
new evidence 때문에 derived state를
어떻게 create / expand / revise / supersede 할 것인가?
```

이는 이미 채택한 **provenance-aware Derived-State Transition Contract**의 책임이다.

### `render(...)`

질문:

```text
이 representation은 어떤 질문에 답하고
어떤 computational view를 제공하는가?
```

이 부분이 진짜 **Projection Contract**의 책임이다.

따라서 추천 decomposition:

```text
old Formatter
    ↓
Projection Contract
+ Projection Routing / Materialization Policy
+ Shared Derived-State Transition Contract
```

> **Do not give each formatter its own private truth/update engine.**

## 45.3 Projection Contract

Projection은 source truth가 아니라
특정 질문/계산에 유용하도록 evidence와 derived state를 조직한
**typed computational view**다.

Conceptual contract:

```text
Projection Contract
- semantic purpose / questions answered
- admissible input state/evidence types
- output / representation semantics
- temporal semantics where applicable
- projection-specific invariants
- query / render behavior
- rebuild / invalidation dependencies
```

공통으로 외부에서 제공되는 것:

```text
source evidence preservation
derivation provenance
generic transition semantics
governance
routing / activation
```

정확한 software interface나 schema는 아직 결정하지 않는다.

## 45.4 Existing formatter candidates are not all the same semantic layer

초기 목록을 그대로 동급의 formatter type으로 두면 의미가 섞인다.

| Existing concept | R2 semantic reading | Why |
|---|---|---|
| **Ranking** | **PROJECTION** | pairwise/ordering evidence와 preference state를 ordering view로 계산한다. domain-local이다. |
| **Timeline** | **PROJECTION** | time-indexed events/states를 longitudinal view로 구성한다. temporal validity 자체는 아니다. |
| **Decision Ledger** | **PROJECTION / HISTORY VIEW** | decision evidence, reasons, changes를 읽기 좋은 history로 구성한다. confirmed task/commitment authority와는 다르다. |
| **Semantic Association / Event Graph** | **PROJECTION** | retrieval/navigation/context reinstatement용 typed semantic view다. provenance graph와 다르다. |
| **Relationship View** | **PROJECTION over RELATIONSHIP STATE** | relationship/closeness 자체는 revisable derived state이고, 사람용/검색용 view가 projection이다. |
| **Preference Set** | **PROJECTION over PREFERENCE CLAIMS/STATE** | explicit preference evidence 및 revisable preference states를 묶어 queryable view로 만든다. |
| **Routine** | **DERIVED PATTERN STATE + optional PROJECTION** | repeated behavioral pattern에 대한 descriptive abstraction이다. executable Skill이 아니다. |
| **General Fact** | **DERIVED CLAIM/STATE, not primarily a projection** | provenance-backed declarative claim 자체다. |
| **User Core** | **PRIVILEGED PROJECTION** | User Model/evidence의 tiny stable always-safe slice다. |
| **Life / Shared / Self History** | **TEMPORAL PROJECTIONS** | provenance-separated states/events를 longitudinally 읽는 views다. |

따라서:

> **Projection is a useful meta-family, but forcing every derived memory object to be a Projection would recreate the same over-generalization problem.**

## 45.5 User Model should not become a giant formatter

초기 문서에는:

```text
Canonical Evidence
→ Temporal User Model
→ Core / retrieval slices
```

가 있다.

현재 R2에서 더 작은 해석은:

```text
user-related evidence
        ↓
typed derived states
- preference
- relationship
- goal
- self-concept claim
- habit/routine
- entity assignment
- historical states
        ↓
projection composition
        ↓
User Model @ now / User Model @ t
```

즉 `User Model`을 별도의 all-knowing profile object나
하나의 giant formatter로 만들 필요는 약하다.

추천:

> **Treat User Model as a logical composition over provenance-backed user-related derived states and projections, with current/historical temporal views.**

이렇게 하면:

```text
Rich User Model
Tiny User Core
query-specific retrieval slice
Historical User Model(t)
```

가 서로 경쟁하는 truth copies가 아니라
동일 underlying state를 다른 scope로 조합한 views가 된다.

Exact materialization은 OPEN:

```text
fully query-time
partially materialized
cached current snapshot
```

중 무엇이 좋은지는 구현/성능 단계에서 결정할 수 있다.

## 45.6 Adaptive Memory Specialization must be decomposed

R1의 `Adaptive Memory Specialization`에는 사실 두 아이디어가 섞여 있었다.

### A. Adaptive projection instantiation — strong

```text
Movies
→ Ranking useful
→ instantiate/materialize Ranking projection

Projects
→ Decision History + Timeline useful
→ instantiate/materialize those projections
```

즉 이미 정의된 Projection Contract를
필요한 domain에 0..N개 적용하는 것.

이는 기존 연구와 매우 잘 맞는다.

### B. Adaptive invention of new projection types — much weaker

```text
system notices new domain
→ invents a brand-new schema / formatter contract
→ starts using it
```

이건 훨씬 강한 주장이다.

위험:

```text
schema drift
hard-to-audit semantics
duplicate projection types
migration/rebuild complexity
unstable routing labels
hidden authority changes
```

현재 corpus는 **A를 강하게 지지하지만 B를 충분히 검증하지 않았다.**

사용자 결정으로 여기서는 더 강하게 닫는다.

```text
default / current R2 contract:
developer-curated Projection Contract registry
+ adaptive 0..N domain instantiation / materialization

new Projection Contract:
explicit design/development change
+ review / tests / migration implications 확인

runtime autonomous projection-type invention:
OUT OF SCOPE
```

즉 XION이 실행 중에 새 schema/formatter contract를 발명하지 않는다.
새 projection 후보가 필요하면 **개발 과정에서 우리가 의미·입력·출력·invariant를 설계하고
registry에 추가**한다.

> **Adaptive specialization means adaptive use of registered projection semantics, not runtime schema invention.**

## 45.7 Projection routing and read routing are related but not identical

두 질문을 분리한다.

### Write / materialization routing

```text
Should this evidence/state contribute to Ranking?
Should a Timeline projection be materialized for this domain?
```

### Read / Context Assembly routing

```text
Which projections/states should be activated for this query?
```

같은 relevance signal을 공유할 수 있지만
failure mode가 다르다.

```text
wrong write/materialization
→ persistent derived noise / rebuild cost

wrong read activation
→ current-context omission or distraction
```

따라서 하나의 global router를 semantic contract로 강제하지 않는다.

## 45.8 Same evidence → 0..N projections survives, with a refinement

기존:

```text
Evidence E137
├─ Ranking
├─ Timeline
└─ Decision Ledger
```

는 유지한다.

다만 더 정확한 R2 표현:

```text
Source Evidence
      ↓
Derived State / Claims
      ↓
0..N typed Projections
```

그리고 필요하면 projection이 source evidence를 직접 참조할 수도 있다.

핵심 invariant:

```text
projection-specific copies of provenance
→ NO

shared derivation/dependency provenance
→ YES
```

한 projection이 invalidated/rebuilt되어도
source evidence와 다른 projection의 의미가 자동으로 같이 바뀌지 않는다.

## 45.9 Projection lifecycle is separate from epistemic validity

Projection은 다음 상태를 가질 수 있다.

```text
not materialized
materialized
stale / rebuild-needed
inactive / low-accessibility
rebuilt
```

이것은 underlying claim의:

```text
active
superseded
contradicted
invalidated
```

와 다른 axis다.

예:

```text
Ranking projection is stale
```

이라고 해서:

```text
user preference evidence is false
```

가 아니다.

## 45.10 What this collapse removes

채택하면 다음 architecture nouns는 독립 engine으로 유지할 필요가 줄어든다.

```text
Ranking Memory
Timeline Memory
Decision Memory
Relationship Memory Engine
User Profile Formatter
Formatter-private merge logic
```

대신:

```text
typed derived states
+ typed Projection Contracts
+ shared provenance
+ shared transition contract
+ routing/materialization policies
```

로 설명한다.

## 45.11 What must remain distinct

추가 collapse 금지:

```text
Projection != source evidence
Projection != underlying derived claim/state
Projection != operational commitment truth
Projection != provenance/dependency graph
Projection != Working Set

temporal validity != Timeline projection
Relationship State != Relationship View
Routine Pattern != Skill Contract
User Core != complete User Model
User Model != one static profile snapshot
```

## 45.12 Main recommendation

R2에서 다음을 채택하는 것을 추천한다.

> **Replace `Memory Formatter` as a mini-engine abstraction with `Projection Contract` as a typed computational-view abstraction. Keep projection routing/materialization and derived-state mutation outside the projection contract. Treat the User Model as a temporal composition over user-related derived states/projections rather than a giant formatter or independent truth copy. Adaptive Specialization means adaptive 0..N instantiation/materialization of developer-curated registered Projection Contracts; runtime invention of new projection types is out of scope.**

이 결정은:

```text
number of projections
exact projection schemas
physical tables
materialized vs query-time policy
routing algorithm
```

를 아직 고정하지 않는다.

## 45.13 User decision — ACCEPTED

사용자는 다음 semantic collapse를 채택했다.

```text
Formatter mini-engine
        ↓ replace with
Projection Contract

User Model
        ↓
logical temporal composition over user-related derived states/projections,
not a giant formatter or independent truth copy

Adaptive Specialization
        ↓
registered Projection Contracts 중 domain별 0..N adaptive instantiation/materialization
```

추가로 새 Projection Contract의 source of truth를 닫는다.

```text
Projection Contract vocabulary
= developer-curated / explicitly designed registry

runtime self-invention of new projection types
= OUT OF SCOPE
```

새 후보가 필요하면 개발 과정에서 사람이:

```text
semantic purpose
admissible inputs
representation/output semantics
temporal semantics
projection-specific invariants
query/render contract
rebuild dependencies
tests
```

를 정의하고 registry에 추가한다.

이 결정은 projection instance의 자동 생성/비활성화/재빌드까지 금지하는 것이 아니다.
**자동화되는 것은 registered type의 사용 여부와 materialization이고,
type semantics 자체의 발명은 자동화하지 않는다.**

아직 OPEN:

```text
initial Projection Contract set
exact contract interface
physical schemas/tables
materialized vs query-time policy
projection routing algorithm
per-projection performance policy
```


---

# 46. R2 Semantic Decision Candidate — Context Assembly / Retrieval / Working Set

> 상태: **R2 SEMANTIC COLLAPSE ACCEPTED**
>
> 기준 Galpi `main`: `71025861d07521f88c21b8c88360280ec6f3c604`.
>
> 근거 corpus:
> R1 Retrieval & Association,
> Event Segmentation / Context Reinstatement,
> Core / Working Memory,
> Forgetting / Accessibility,
> Multi-Specialist / Thread-Local Context,
> Prospective Context-Gating,
> 그리고 R2에서 이미 채택한 Projection / Provenance / Authority contracts.

## 46.1 Main synthesis

현재까지 별개 mechanism처럼 보였던:

```text
Contextual Memory Activation
Sparse Retrieval Routing
Event-first / Hierarchical Retrieval
Context Reinstatement
Associative Expansion
Forgetting / Accessibility
Tiny User Core input
Role / thread-local retrieval bias
Activated Candidate Set
Focus Selection
Working Set Assembly
specialist-local Working Set
handoff working bridge
```

은 대부분 하나의 질문을 서로 다른 단계에서 답한다.

> **What should be cognitively available to XION for this reasoning episode?**

따라서 추천:

> **Treat them as one semantic read process: `Context Assembly`, while preserving the different state/authority meanings of its inputs and outputs.**

`Context Assembly`은 source of truth나 persistent memory type이 아니다.
매 reasoning episode마다 필요한 context를 **compile**하는 ephemeral process다.

## 46.2 Candidate Context Assembly pipeline

```text
CURRENT REQUEST / INTERACTION
+ active conversational identity / role / thread
+ current operational state references
+ privileged context inputs
        ↓
1. CONTEXT FRAME / CUES
        ↓
2. SOURCE / PROJECTION ROUTING
        ↓
3. DIRECT ANCHOR RETRIEVAL
        ↓
4. BOUNDED CONTEXT REINSTATEMENT / ASSOCIATIVE EXPANSION
        ↓
5. VALIDITY + ACCESSIBILITY + SCOPE FILTERING
        ↓
6. RECONSTRUCT READER CONTEXT / EVIDENCE PACKAGE
        ↓
7. ACTIVATED CANDIDATE SET
        ↓
8. NARROW FOCUS / BUDGET SELECTION
        ↓
9. TYPED DYNAMIC WORKING SET
        ↓
READER / CONTROLLER / SPECIALIST COGNITION
```

이 단계 이름은 software module 이름이 아니다.
구현에서 일부를 합치거나 다른 ordering을 사용할 수 있다.

## 46.3 Stage 0 — privileged context inputs are composed, not merged

다음은 모두 current reasoning에 강한 prior/input을 줄 수 있다.

```text
Tiny User Core
System / Role Core
thread-local derived context
active specialist identity
current goal/task references
current operational capability state
prospective state
```

하지만 semantic authority가 다르다.

예:

```text
Tiny User Core
= provenance-backed privileged user projection

Role Core
= declared role/domain contract

current task
= operational commitment state

current capability
= operational runtime truth

thread-local context
= rebuildable local cognitive state
```

따라서 하나의 `Core` truth type으로 합치지 않는다.

추천 abstraction은 단지:

```text
PRIVILEGED / SCOPED CONTEXT INPUT
```

이라는 **read interface** 수준의 composition이다.

> **Common visibility does not imply common authority.**

## 46.4 Context frame is not event truth

현재 request를 읽을 때:

```text
query/topic cues
active entities
goal
role
thread affinity
time/location
current task
open question
```

등으로 initial context frame을 만들 수 있다.

이 frame은 기존 Event Projection을 사용할 수 있지만:

```text
current context interpretation
≠
canonical event boundary
```

이다.

Event segmentation은 계속:

```text
source history
→ rebuildable Event Projection
```

이며 `Context Assembly`이 event truth를 새로 canonicalize하지 않는다.

즉:

```text
Event Projection
→ read-side navigation/index input

Context Assembly
→ consumes it
```

관계가 기본이다.

## 46.5 Source / Projection Routing

R2에서 Projection Contract를 채택했으므로 read routing은:

```text
Which registered projections / state families are useful for this request?
```

를 판단할 수 있다.

예:

```text
movie comparison
→ Ranking projection likely useful

"언제 마음이 바뀌었지?"
→ Timeline / history projection useful

"저 민수가 누구였지?"
→ Entity + relationship + event context useful

"왜 이걸 기억하고 있지?"
→ Derivation provenance + source evidence useful
```

이것은 projection **materialization/write routing**과 구분한다.

```text
read routing
= what to activate now

materialization routing
= what persistent/rebuildable projection is worth maintaining
```

둘은 signal을 공유할 수 있지만 같은 policy일 필요는 없다.

## 46.6 Direct anchor retrieval remains first-class

Associative memory가 강해져도 direct exact/semantic anchors를 없애지 않는다.

Candidate anchor types:

```text
source evidence / QA chunk
derived claim/state
hypothesis
entity
event
decision
projection item
task/prospective reference
```

강한 기존 원칙:

```text
small retrieval anchor
≠
final reader context
```

을 유지한다.

## 46.7 Context Reinstatement + Association become bounded expansion

첫 anchor가 context cue가 되어 추가 evidence를 찾을 수 있다.

```text
anchor
  ↓
same event
event transition
shared entity
shared goal
typed semantic association
temporal context
explicit source/provenance link
  ↓
additional candidates
```

다만:

```text
typed path
+ relevance
+ budget
+ stop condition
```

이 있어야 한다.

Generic BFS / unlimited snowball은 계속 REJECT.

중요한 refinement:

> **Retrieval expansion may traverse both semantic-association and provenance relations, but those paths keep distinct semantics.**

예:

```text
via SHARED_ENTITY
→ related candidate

via DERIVED_FROM
→ supporting source candidate
```

둘 다 retrieval에 쓸 수 있지만
`SHARED_ENTITY`가 mutation/erasure authority를 얻지는 않는다.

## 46.8 Retrieval provenance is a third kind of provenance-like trace

R2는 이미:

```text
Derivation / Dependency Provenance
≠
Semantic Association
```

을 닫았다.

여기에 retrieval 연구의:

```text
source_anchor
why_retrieved
association_path
depth
```

가 있다.

이것은 또 다른 의미다.

```text
DERIVATION PROVENANCE
→ why does this belief/state exist?

SEMANTIC ASSOCIATION
→ how are memories/entities/events meaningfully related?

RETRIEVAL TRACE
→ why did this candidate enter this reasoning episode?
```

따라서 `retrieval provenance`라는 기존 표현은
R2 vocabulary에서는 가능하면 **Retrieval Trace / Access Trace**로 부르는 편이 덜 혼동된다.

Retrieval Trace는 기본적으로:

```text
ephemeral / evaluation-observability state
```

에 가깝고 user-memory truth가 아니다.

## 46.9 Forgetting collapses into accessibility policy — only ordinary forgetting

기존 Forgetting 연구의 세 의미:

```text
semantic invalidity
accessibility reduction
governed erasure
```

중 `Context Assembly`에 들어오는 것은 **accessibility**뿐이다.

```text
valid but usually low-relevance state
→ lower default activation prior
```

강한 cue가 있으면 다시 올라올 수 있다.

Candidate signals:

```text
current context relevance
relevant opportunities
retrieval opportunities
actual downstream use
explicit outcomes
supersession/currentness
weak recency signal
```

금지:

```text
old → delete
retrieval frequency → automatic importance
archive tier → semantic validity
```

따라서 semantic name도:

```text
ordinary forgetting
≈ Accessibility Policy
```

로 상당 부분 collapse할 수 있다.

단:

```text
semantic invalidation
→ Derived-State Transition / temporal validity

erasure
→ Governance
```

는 Context Assembly 밖이다.

## 46.10 Validity filtering is query-relative, not “hide all old state”

Context Assembly은 current state만 무조건 고르는 pipeline이 아니다.

예:

```text
"What do I like now?"
→ current valid states favored

"What did I like in 2025?"
→ historical state intentionally retrieved

"Why did I change?"
→ old + new + transition evidence together
```

따라서:

```text
superseded
≠ globally inaccessible
```

이다.

Validity/scope filtering은:

```text
query temporal intent
+ state validity interval/status
+ requested historical/current mode
```

를 함께 봐야 한다.

## 46.11 Anchor → reader-context reconstruction is part of Context Assembly

검색 hit 하나를 그대로 model context로 넣는 것보다:

```text
small high-signal anchor
→ locate source/event/context
→ reconstruct bounded evidence package
```

를 우선 후보로 둔다.

Reader package는 필요에 따라:

```text
source evidence
local conversational/event context
relevant current/historical derived state
counterevidence
relationship/entity identity context
operational state reference
```

를 포함할 수 있다.

하지만 package 자체는 새로운 memory truth가 아니다.

## 46.12 Activated Set and Working Set become two stages of the same read process

기존 Working Memory 연구:

```text
LONG-TERM MEMORY
→ ACTIVATED CANDIDATE SET
→ FOCUS / WORKING SET
```

은 Context Assembly 안에 그대로 들어간다.

### Activated Candidate Set

```text
recall-oriented
broader
typed candidates
retrieval traces retained
```

### Dynamic Working Set

```text
reasoning-oriented
small
budgeted
ephemeral
typed authority/provenance retained
```

강한 invariant:

> **Attention state is not evidence.**

Working Set에 들어갔다는 이유만으로:

```text
truth promotion
write
reinforcement
revision permission
```

을 만들지 않는다.

## 46.13 Working Set should be typed, not flattened text

R2의 truth/state boundary를 유지하려면 Working Set을 단순:

```text
[string, string, string]
```

으로 개념화하면 부족하다.

Logical input roles may include:

```text
SOURCE EVIDENCE
DERIVED STATE
HYPOTHESIS / AMBIGUITY
PROJECTION VIEW
OPERATIONAL COMMITMENT REFERENCE
CURRENT CAPABILITY REFERENCE
GOVERNANCE / ROLE CONSTRAINT REFERENCE
PROSPECTIVE CUE
```

Reader에게 모두 같은 “memory fact”처럼 보여주면
authority boundary가 무너진다.

따라서 원칙:

> **Context Assembly may co-locate heterogeneous state for reasoning, but must preserve its semantic type and authority.**

Exact context serialization은 OPEN.

## 46.14 Tiny User Core becomes a privileged input to Context Assembly

Tiny User Core의 의미는 유지한다.

```text
stable global user anchors
→ always-safe / almost-always-visible prior
→ Context Assembly
```

Core가 직접 final answer truth를 소유하는 게 아니다.

현재 R2 표현:

```text
user-related derived states
→ User Model logical composition
→ Tiny User Core Projection
→ privileged Context Assembly input
```

Core promotion은 일반 memory보다 stricter gate를 계속 가진다.

## 46.15 Role Core / specialist lens / thread bias collapse into scoped context policy — not shared truth

Specialist 연구의:

```text
Role Core
retrieval lens
thread-local retrieval bias
specialist-local Working Set
handoff bridge
```

는 대부분 Context Assembly의 scope/configuration/output으로 설명 가능하다.

```text
scope = specialist / thread / role
        ↓
context priors + source routing bias
        ↓
Context Assembly
        ↓
scoped Working Set
```

따라서:

```text
specialist memory system
thread memory system
```

을 별도로 만들 이유는 더 약해진다.

하지만:

```text
Role Core
≠ user-derived Tiny Core

role contract
≠ user truth
```

은 유지한다.

## 46.16 Handoff bridge is just a serialized/rebuildable working-context bridge

Specialist ↔ XION handoff의:

```text
topic
key evidence refs
current conclusion
user decision
unresolved questions
active task
```

는 새 long-term memory primitive가 아니라:

```text
scoped Working Set / working-context summary
```

의 rebuildable bridge로 설명 가능하다.

가능하면 canonical source/evidence references를 함께 유지한다.

## 46.17 Prospective context-gating composes with Context Assembly

Prospective Memory 연구의:

```text
all intentions
→ cheap routing
→ subset armed
→ cue evaluation
```

는 Context Assembly의 current-context signals를 재사용할 수 있다.

예:

```text
current location/entity/task/event
        ↓
relevant prospective candidates activated
        ↓
prospective monitor evaluates cue
```

하지만:

```text
context activation
≠ commitment creation
≠ action authorization
```

이다.

즉 Context Assembly은 prospective state를 **surface**할 수 있지만
task/reminder authority나 실행 authority를 소유하지 않는다.

## 46.18 Specialist routing is adjacent, but should not be collapsed into memory retrieval

여기서는 과도한 collapse를 막는다.

```text
memory/source routing
→ what information should be activated?

specialist routing
→ which cognitive worker / toolset should reason?
```

둘은 same context signals를 공유할 수 있지만 output과 failure mode가 다르다.

따라서:

```text
Context Assembly
→ may inform Specialist Routing

Specialist Routing
→ may request role-scoped Context Assembly
```

로 COMPOSE하고,
하나의 generic router semantic으로 MERGE하지 않는다.

## 46.19 What this collapse removes

채택하면 다음을 독립 semantic engine처럼 볼 필요가 줄어든다.

```text
Contextual Activation engine
Event Retrieval engine
Context Reinstatement engine
Associative Memory engine
Working Memory engine
Forgetting engine
Specialist Memory context engine
Thread Memory context engine
```

대신:

```text
Context Assembly process
+ Event / Association / Projection inputs
+ Accessibility policy
+ scoped priors
+ Working Set output
```

로 설명한다.

## 46.20 What remains outside Context Assembly

```text
source evidence storage
derived-state formation/revision
Projection materialization/update
event segmentation write/maintenance
semantic validity mutation
task/reminder commitment state machine
governance / erasure
executor runtime
specialist orchestration authority
policy learning/evaluation itself
```

Context Assembly은 read/compile path다.

## 46.21 Empirical variants remain concentrated inside stages

Semantic process는 하나로 닫혀도
R3에서 비교할 policy는 남는다.

예:

```text
flat retrieval
vs event-hierarchical retrieval

direct-only
vs bounded context reinstatement

association path types / expansion budgets

No Core
vs Tiny Stable Core
(product direction is Tiny Core, empirical baseline still useful)

Working Set:
raw hits only
vs event + hits
vs event + operational + unresolved relevant state

accessibility:
recency/frequency baseline
vs opportunity-adjusted signals
```

따라서:

> **One semantic read model does not imply that retrieval policy is already empirically solved.**

## 46.22 Main recommendation

R2에서 다음을 채택하는 것을 추천한다.

> **Collapse Contextual Activation, hierarchical/event retrieval, context reinstatement, typed associative expansion, ordinary forgetting/accessibility, activated-candidate selection, Working Set assembly, and specialist/thread-local cognitive context into one ephemeral `Context Assembly` semantic process. Treat Tiny User Core, Role/thread priors, event projections, operational/prospective references, and registered projections as typed inputs rather than shared truth. Preserve retrieval/access traces separately from derivation provenance, and keep specialist routing, mutation, commitment, governance, and execution outside the read process.**

## 46.23 User decision — ACCEPTED

사용자는 다음 read-side semantic collapse를 채택했다.

```text
READ-SIDE MEMORY SEMANTICS
→ one ephemeral Context Assembly process

ordinary forgetting
→ Accessibility Policy inside Context Assembly

Working Memory
→ Activated Candidate Set → Dynamic Working Set stages

Tiny User Core
→ privileged typed input

Role/thread/specialist local memory
→ scoped context priors + Working Set, not truth silos

Event / semantic association
→ Context Assembly inputs / expansion routes, not mutation authority

retrieval provenance
→ Retrieval / Access Trace
```

추가 invariant:

```text
Context Assembly may co-locate heterogeneous state,
but it must preserve semantic type and authority.

Context activation
≠ evidence
≠ commitment
≠ authorization
≠ mutation permission
```

이 결정은 retrieval algorithm, context serialization, budgets,
event-segmentation algorithm, or R3 policy winner를 고정하지 않는다.


---

# 47. R2 Semantic Decision Candidate — Skill / Prospective / Action Boundary

> 상태: **R2 SEMANTIC BOUNDARY ACCEPTED**
>
> 기준 Galpi `main`: `71025861d07521f88c21b8c88360280ec6f3c604`.
>
> 근거 corpus:
> Procedural / Skill Memory,
> User-Taught / Registered Skills,
> Prospective Memory,
> Executor-Relative Skill Amendment,
> Governance / Authority,
> accepted Context Assembly,
> 그리고 현재 Galpi task/reminder operational contract.
>
> 이 pass의 핵심 질문:
>
> **Action-facing research도 하나의 semantic object로 합쳐지는가,
> 아니면 여기서 처음으로 genuinely different authority domains가 나타나는가?**

## 47.1 Main result — this is the first strong non-collapse boundary

결론부터 말하면:

> **Skill / Prospective / Governance / Execution을 하나의 `Action Memory`로 MERGE하면 안 된다.**

하지만 각각 내부의 연구 mechanism은 크게 줄일 수 있고,
하나의 **Action Bridge composition**으로 연결할 수 있다.

현재 가장 작은 의미 구분:

```text
SKILL CONTRACT
→ HOW can XION perform a reusable procedure?

COMMITMENT STATE
→ WHAT remains promised / pending?

PROSPECTIVE ACTIVATION
→ WHEN / under what CUE should something become relevant again?

GOVERNANCE / AUTHORIZATION
→ WHETHER is this action allowed now?

EXECUTOR RUNTIME
→ DO the actual action and report what happened
```

이 차이는 theory taxonomy가 아니라
authority / lifecycle / failure semantics 차이다.

## 47.2 Skill research collapses strongly into one `Skill Contract` family

다음은 별도 memory classes로 둘 이유가 약하다.

```text
learned skill
user-taught skill
registered external skill
macro skill
primitive skill
```

R2 synthesis:

```text
Skill Contract
- applicability / trigger
- inputs
- preconditions
- semantic goal
- procedure / implementation reference
- termination
- verification
- executor compatibility
- side-effect / permission metadata
- provenance
- version
- validation state
```

Acquisition path만 다르다.

```text
BUILT_IN / SYSTEM
USER_REGISTERED / USER_TAUGHT
LEARNED_FROM_EPISODES
COMPOSED_FROM_EXISTING_SKILLS
```

Skill formation / revision은 이미 accepted한
provenance-aware Derived-State Transition Contract를 재사용한다.

```text
evidence / instruction / execution traces
→ candidate Skill Contract
→ transfer / variation / verification
→ promote
→ mismatch/failure/correction
→ reopen / revise / version / deactivate
```

따라서 별도 `Skill Reconsolidation Engine`은 필요하지 않다.

## 47.3 Macro vs primitive is not a memory-type split

Executor-relative amendment를 유지한다.

```text
macro
primitive
```

는 서로 다른 semantic memory classes가 아니라:

```text
same Skill Contract family
+ executor/interface-relative granularity
```

다.

강한 contract:

```text
XION primitive
= lowest reusable semantic/task-space action

NOT
= lowest actuator command
```

Planning:

```text
validated compatible macro available?
├─ yes → prefer macro
└─ no  → compose semantic primitives
```

R3에서 macro-first policy의 효과는 비교할 수 있지만
semantic type은 하나로 둔다.

## 47.4 Skill Registry authority is domain-relative

Promoted Skill Contract는 epistemically derived이지만:

```text
"what is this reusable skill contract?"
```

이라는 domain에서는 authoritative할 수 있다.

그러나:

```text
skill exists
≠ skill applicable now
≠ user committed to do it
≠ action authorized now
≠ executor can actually perform it now
```

이다.

따라서 `Skill Registry`의 authority를
global action authority로 확대하지 않는다.

## 47.5 Executor deployment is an executable projection, not the Skill Contract

Accepted executor boundary:

```text
XION Skill Registry
= reusable semantic contract

Executor Macro Registry / deployed implementation
= executor-local executable materialization
```

연결:

```text
Skill Contract @ version/hash
        ↓ deploy
Executor Implementation @ version/hash
        ↓ execute
Execution Trace / Outcome
```

Version/hash mismatch는 silent execution하지 않는다.

```text
re-deploy
fail-close
or allowed primitive fallback
```

중 하나다.

중요한 terminology refinement:

> **Executor deployment is a projection/materialization in the broad sense, but it is not a read-side `Projection Contract`.**

이유:
executor artifact는 실제 실행 semantics와 operational lifecycle을 가진다.

## 47.6 Prospective Memory should be decomposed rather than preserved as one memory type

R1 prospective research의 요소:

```text
intended content
cue / trigger
activation state
completion
selective intervention
task/reminder persistence
```

를 하나의 `Prospective Memory` object로 묶을 필요는 없다.

더 작은 R2 model:

```text
A. COMMITMENT / INTENTION CONTENT
   what remains to be done / remembered

B. ACTIVATION CONDITION
   when it becomes relevant again

C. ACTIVATION / ARMED STATE
   current cue relevance

D. INTERVENTION POLICY
   whether/how to surface or act

E. COMPLETION / DEACTIVATION
   stop future activation while preserving history
```

그리고 이 요소들의 authority는 동일하지 않을 수 있다.

## 47.7 User-facing task/reminder: operational commitment is the source of truth

현재 Galpi contract는 그대로 유지한다.

```text
candidate future-oriented statement
        ↓
explicit confirmation
        ↓
task/reminder operational state
        ↓
active / closed / deleted lifecycle
```

Memory research가 이 operational state를
derived graph/projection으로 대체하지 않는다.

따라서 user-facing prospective semantics는:

```text
Task / Reminder Operational State
        ↓
cue / time indexes
        ↓
Context Assembly / deterministic scheduler
        ↓
selective intervention
```

로 COMPOSE한다.

즉:

> **Prospective memory does not need to own the commitment if an operational commitment store already does.**

## 47.8 Time cue and context cue can share an `Activation Condition` concept without sharing the same evaluator

Candidate common vocabulary:

```text
Activation Condition
├─ TIME
├─ SYSTEM EVENT
├─ STRUCTURAL CONTEXT
├─ SEMANTIC CONTEXT
└─ INFERRED CONTEXT
```

그러나 evaluator와 automaticity는 다르다.

```text
TIME
→ deterministic scheduler

SYSTEM EVENT
→ deterministic / structural matcher

SEMANTIC CONTEXT
→ Context Assembly + cue evaluator

INFERRED CONTEXT
→ lower-confidence / higher-interruption-risk policy
```

따라서:

```text
common condition vocabulary
+ tier-specific evaluator / authority
```

를 추천한다.

## 47.9 Prospective monitoring composes directly with Context Assembly

Context Assembly은 현재 request/context에서:

```text
entities
events
goals
task state
role
location/time where available
semantic topic
```

를 이미 활성화한다.

Event/context prospective state는 이를 재사용할 수 있다.

```text
Context Assembly
→ prospective candidates become relevant / ARMED
→ cue evaluator
→ intervention candidate
```

즉 별도 full-memory scan을 매 turn 수행할 이유가 약하다.

하지만:

```text
Context Assembly
≠ commitment creator
≠ reminder authority
≠ intervention authority
```

다.

## 47.10 Skill applicability and prospective cue share condition machinery, not meaning

이 둘은 비슷해 보인다.

```text
Skill:
WHEN is this procedure applicable?

Prospective:
WHEN should this pending item become relevant?
```

따라서 predicate parsing/matching 같은
**Activation / Applicability Condition machinery**는 공유할 수 있다.

그러나 결과 의미는 다르다.

```text
skill condition matched
→ candidate procedure becomes applicable

prospective condition matched
→ pending intention becomes relevant / armed
```

따라서 MERGE가 아니라 COMPOSE다.

> **Shared condition language does not imply shared authority or lifecycle.**

## 47.11 Skill termination and commitment completion also share vocabulary, not state machines

Skill:

```text
termination / verification
→ did this execution achieve the procedure goal?
```

Commitment:

```text
completion
→ is this obligation no longer pending?
```

둘 다 outcome evidence를 사용할 수 있지만,
skill execution success가 task completion을 자동 의미하지 않는다.

예:

```text
skill "send draft email" executed successfully
≠
project task "finish sponsorship outreach" completed
```

따라서:

```text
shared Outcome / Verification evidence
+ separate lifecycle transitions
```

을 유지한다.

## 47.12 `Prediction`, `Prospective Intention`, and `Skill` remain distinct despite shared conditions

이미 research에서 닫힌 distinction:

```text
Prediction
→ what evidence would be expected if a hypothesis is true

Prospective intention
→ what should become relevant under a future cue

Skill
→ how to accomplish a reusable procedure
```

R2에서 condition vocabulary가 공유되어도
이 semantic split은 유지한다.

## 47.13 Governance is the hard action boundary

Skill과 commitment가 모두 맞아도:

```text
skill applicable
AND
commitment active
AND
cue matched
```

만으로 실행하지 않는다.

```text
candidate action
        ↓
GOVERNANCE / AUTHORIZATION
        ↓
allowed?
├─ no → do not execute
└─ yes → executor
```

특히:

```text
physical actuation
external writes
payments
trading
security-sensitive actions
```

은 memory-learned policy가 authorization을 재정의하면 안 된다.

강한 principle:

> **Memory may recommend HOW and recall WHAT/WHEN; governance owns WHETHER.**

## 47.14 Execution runtime owns actual capability truth

Skill / self-history / registration evidence가 존재해도:

```text
current executor unavailable
version mismatch
device offline
capability revoked
```

이면 실행할 수 없다.

우선순위:

```text
CURRENT CAPABILITY / EXECUTOR STATE
>
Skill Contract assumptions
>
Historical execution / XION Self-History
```

따라서 current capability는 memory projection으로 infer해서 덮지 않는다.

## 47.15 Action Bridge composition

이 pass의 가장 작은 connected process 후보:

```text
CURRENT REQUEST / CONTEXT
        ↓
CONTEXT ASSEMBLY
        ↓
relevant:
- commitments / prospective cues
- applicable skills
- current capability refs
        ↓
ACTION / INTERVENTION CANDIDATE
        ↓
GOVERNANCE / AUTHORIZATION
        ↓
SKILL / PROCEDURE SELECTION
        ↓
EXECUTOR
        ↓
EXECUTION TRACE / OUTCOME EVIDENCE
        ↓
- commitment lifecycle update when authorized/appropriate
- skill evaluation / revision candidate
- memory outcome / policy evaluation
```

`Action Bridge`는 architecture subsystem 이름이 아니다.
여러 authority domain을 연결하는 semantic composition이다.

## 47.16 First genuine hard boundaries discovered

지금까지 R2의 memory-theory mechanisms는 상당수가
하나의 model로 collapse했다.

여기서는 처음으로 분리 이유가 강하다.

```text
Skill Contract
≠
Commitment State
≠
Governance Authorization
≠
Current Capability / Executor State
```

이것은 연구 naming 때문이 아니라:

```text
different source of truth
different lifecycle
different mutation authority
different failure cost
```

때문이다.

따라서 여기서 분리를 유지하는 것이
R2 operating principle과 일치한다.

## 47.17 Agent-internal prospective state remains genuinely open

R1은:

```text
USER-FACING prospective state
AGENT-INTERNAL prospective state
```

둘을 후보로 두었다.

User-facing은 현재 task/reminder operational contract로 강하게 닫혀 있다.

Agent-internal:

```text
"later in this workflow, re-check provenance"
"after tool result arrives, verify X"
"when condition Y appears, resume step Z"
```

는 최소 두 경우로 나뉜다.

### A. Workflow-local obligation

```text
lifetime = current / resumable workflow
authority = controller/execution state
```

→ likely execution/workflow state, not long-term memory.

### B. Durable cross-session agent obligation

```text
must survive restart / long delay / context change
```

→ may require its own operational commitment semantics.

현재 corpus만으로 B의 source-of-truth / authorization / expiry를
확신을 갖고 결정하기엔 정보가 부족하다.

따라서:

> **Do not create a durable agent-internal prospective store until a concrete use case requires it.**

기본 추천:

```text
workflow-local
→ workflow/execution state

user-facing durable
→ existing task/reminder domain

durable agent-internal cross-session
→ OPEN; design only when product requirement appears
```

## 47.18 What collapses vs what remains separate

### MERGE

```text
learned / taught / registered skill
→ one Skill Contract semantic family

macro / primitive
→ same family, executor-relative granularity
```

### COMPOSE

```text
prospective monitoring
+ Context Assembly

skill applicability
+ shared activation-condition machinery

prospective cues
+ shared activation-condition machinery

outcome/verification evidence
+ skill evaluation
+ commitment completion checks
```

### DECOMPOSE

```text
Prospective Memory
→ commitment content
+ activation condition
+ armed/relevance state
+ intervention policy
+ completion/deactivation
```

### KEEP SEPARATE

```text
Skill Contract
≠ Commitment State
≠ Governance
≠ Executor Runtime

Prediction
≠ Prospective Intention
≠ Skill

Routine
≠ Skill

Skill execution success
≠ commitment completion
```

## 47.19 Empirical variants remain

Semantic boundary는 닫혀도 R3 후보는 남는다.

```text
skill routing:
macro-first vs composition-first

skill representation:
explicit textual contract vs hybrid learned representation

prospective monitoring:
always-monitor baseline vs context-gated

context cue:
structural-only vs semantic cue evaluator

intervention:
surface-always vs selective / interruption-aware

skill promotion:
episode / transfer / variation gates
```

다만 governance / confirmation / source-of-truth boundary는
실험으로 winner를 고르는 항목이 아니다.

## 47.20 Main recommendation

R2에서 다음을 채택하는 것을 추천한다.

> **Do not create one `Action Memory` type. Collapse procedural variants into one versioned `Skill Contract` family and decompose Prospective Memory into commitment content, activation conditions, relevance/armed state, selective intervention, and completion/deactivation. Reuse Context Assembly for context-based prospective activation and share condition-matching machinery with skill applicability where useful, but preserve separate authority for Skill Contract, operational Commitment State, Governance/Authorization, and Executor/Capability State. Keep durable agent-internal cross-session commitments out of scope until a concrete requirement exists.**

이것이 현재까지 처음 나타난
**genuine non-collapsible semantic boundary**다.

## 47.21 User decision — ACCEPTED

사용자는 다음 action-side synthesis를 채택했다.

```text
Skill
→ one versioned Skill Contract family

Prospective Memory
→ decompose; not a standalone memory type

User-facing durable commitment
→ existing task/reminder operational SoT

Context/event cue activation
→ compose with Context Assembly

Skill applicability + prospective cues
→ may share condition machinery, not semantics

Governance
→ external hard authority

Executor / current capability
→ external operational truth

durable agent-internal cross-session commitment
→ OUT OF SCOPE / OPEN until concrete requirement
```

따라서 R2는 `Action Memory`라는 하나의 truth type을 만들지 않는다.

강한 authority contract:

```text
Skill Contract
≠ Commitment State
≠ Governance / Authorization
≠ Current Capability / Executor State
```

이 구분은 subsystem 취향이 아니라 source of truth, lifecycle,
mutation authority, failure cost 차이 때문에 유지한다.


---

# 48. R2 Semantic Decision Candidate — Memory Policy / Evaluation

> 상태: **R2 SEMANTIC COLLAPSE ACCEPTED**
>
> 기준 Galpi `main`: `71025861d07521f88c21b8c88360280ec6f3c604`.
>
> 근거 corpus:
> first learned write/no-write decision,
> Neural Memory Controller,
> Contextual Bandits / OPE,
> Shadow-All-Write,
> delayed/censored feedback,
> PU / survival / recurrent-use views,
> outcome attribution,
> opportunity-adjusted forgetting,
> 그리고 accepted R2 Transition / Projection / Context Assembly contracts.
>
> 현재 Galpi도 retrieval shadow 관측과 실제 A2 retrieval 주입을
> 단계적으로 분리해 운영해 왔으므로,
> policy와 evaluation을 semantic truth와 분리하는 방향은 기존 integration과도 일치한다.

## 48.1 Main result — many learning mechanisms collapse into one policy-evaluation loop

기존 연구에는 다음 이름들이 따로 있었다.

```text
write / no-write learner
routing learner
retrieval learner
consolidation trigger learner
elicitation policy
accessibility / forgetting learner
prospective intervention policy
Neural Memory Controller
Shadow-All-Write
usage attribution
sampled LOO
IPS / DR / OPE
PU learning
survival / delayed feedback
reward model
```

이들을 각각 subsystem으로 만들 이유는 약하다.

더 작은 R2 model:

```text
LOCAL POLICY DECISION
        ↓
SEMANTIC / AUTHORITY GATE
        ↓
ACTUAL EXPOSURE / APPLICATION
        ↓
DOWNSTREAM USE / OUTCOME OBSERVATION
        ↓
DERIVED EVALUATION VIEW
        ↓
POLICY COMPARISON / CANDIDATE VERSION
        ↓
SHADOW / REPLAY / PROMOTION
```

강한 원칙:

> **Policy decides among allowed alternatives; it does not redefine truth, authority, or semantic contracts.**

## 48.2 `Memory Policy` is a family of local decisions, not one giant controller

공통 policy family 후보:

```text
WRITE / DO_NOT_PROMOTE
Projection materialization / routing
Read routing / retrieval gating
Context expansion budget / path policy
Consolidation / replay trigger
Evidence acquisition / ask-vs-wait
Accessibility adjustment
Prospective intervention
Skill selection preference
```

이 결정들은 모두 context-dependent selection이라는 공통점이 있다.

하지만:

```text
different action spaces
different error costs
different horizons
different observability
different authority boundaries
```

를 가진다.

따라서:

```text
one semantic Policy Decision contract
≠
one learned model
≠
one global scalar objective
```

이다.

`Neural Memory Controller`는 이 family의 일부 policy를 구현할 수 있는
**implementation option**으로 내린다.

```text
Policy Contract
→ deterministic rule
→ heuristic
→ LLM decision
→ classifier
→ learned neural model
```

중 어떤 구현도 가능하다.

## 48.3 Policy Decision Trace

평가 가능한 policy는 최소:

```text
decision context reference
policy type
policy version
available actions
chosen action
constraints / gates in force
shadow alternatives where available
```

를 남길 수 있어야 한다.

Stochastic/exploratory policy라면 추가:

```text
behavior propensity / chosen-action probability
```

가 필요할 수 있다.

하지만 deterministic policy에 가짜 probability를 강제로 만들지 않는다.

따라서 기존 `MemoryDecisionEvent` 아이디어를
더 일반적으로:

```text
Policy Decision Trace
```

로 부른다.

이 trace는:

```text
evaluation provenance
≠ user-memory truth
```

이다.

## 48.4 Decision, gate, and applied action must be separately observable

예:

```text
policy proposes WRITE
        ↓
false-memory / provenance gate rejects
        ↓
actual transition = NO_WRITE
```

또는:

```text
retrieval policy selects memory
        ↓
context budget drops it
        ↓
reader never sees it
```

따라서 evaluation에 필요한 구분:

```text
PROPOSED
ALLOWED / REJECTED BY GATE
APPLIED / EXPOSED
USED
OUTCOME
```

이다.

정책의 `chosen_action`만 기록하면
policy failure와 downstream gate behavior가 섞인다.

## 48.5 Outcome observations should be referenced from owning domains, not copied into one global truth ledger

R1의 `canonical outcome event` 표현은
현재 R2의 domain-relative authority 원칙에 맞게 정교화한다.

예:

```text
user correction
→ source evidence / memory transition signal
→ 동시에 policy-evaluation outcome signal

task completed
→ operational commitment event
→ 동시에 prospective/intervention evaluation signal

skill verification failed
→ executor/skill outcome
→ 동시에 skill-routing/promotion evaluation signal
```

추천:

> **One source/operational event may play multiple evaluation roles by reference; evaluation should not duplicate it into a second truth copy merely to call it an outcome.**

즉 필요한 것은 하나의 물리 `Outcome Ledger`가 아니라
**Evaluation Observation contract**다.

Logical examples:

```text
RELEVANT_OPPORTUNITY
POLICY_EXPOSURE
RETRIEVED
INJECTED
READER_USED
ANSWER_CHANGED
EXPLICIT_APPROVAL
EXPLICIT_REUSE
CORRECTED
SUPERSEDED
DELETED
TASK_COMPLETED
SKILL_VERIFIED / FAILED
```

일부는 evaluation 전용 trace일 수 있고,
일부는 다른 domain의 authoritative/source event reference일 수 있다.

Physical storage는 OPEN.

## 48.6 Outcome funnel becomes the common evaluation semantics

기존 delayed/censored 연구는 다음 selection chain을 제공한다.

```text
candidate/state exists
        ↓
relevant opportunity occurs
        ↓
policy exposes it
        ↓
reader / downstream system uses it
        ↓
answer/action changes
        ↓
human / operational outcome is observed
```

따라서:

```text
not retrieved
≠ not useful

retrieved
≠ used

used
≠ answer changed

answer changed
≠ better

no feedback
≠ negative
```

를 evaluation invariant로 둔다.

이 funnel은 write/read/consolidation/intervention 등
여러 policy evaluation에 공통으로 쓸 수 있다.

## 48.7 Opportunity is the denominator; wall-clock age is only one signal

같은 memory가 오래 안 쓰였더라도:

```text
relevant opportunity = 0
```

이면 negative evidence가 약하다.

반대로:

```text
many relevant opportunities
+ repeatedly exposed or eligible
+ never contributes
```

는 더 강한 policy/utility signal일 수 있다.

따라서 evaluation은 가능한 경우:

```text
calendar age
relevant opportunity count
policy exposure count
retrieval count
reader use count
answer/action divergence
explicit outcomes
```

를 분리한다.

`relevant opportunity`의 exact operational definition은
policy/domain별로 R3에서 검증한다.

## 48.8 Censoring is an observation state, not a memory label

최소 evaluation observation state:

```text
OBSERVED_POSITIVE
OBSERVED_NEGATIVE
UNOBSERVED / CENSORED
```

그리고 필요하면 원인:

```text
NO_RELEVANT_OPPORTUNITY
NOT_EXPOSED_BY_POLICY
EXPOSED_NOT_USED
USED_NO_HUMAN_FEEDBACK
OBSERVATION_WINDOW_OPEN
STATE_SUPERSEDED
USER_STATE_CHANGED
```

를 분석한다.

정확한 enum은 schema로 아직 고정하지 않는다.

강한 contract:

> **Unobserved is not negative.**

## 48.9 Reward / PU / survival / attribution are derived Evaluation Views

다음을 source-of-truth field로 고정하지 않는다.

```text
reward
PU label
survival label
utility score
importance score
```

이들은 versioned derived views다.

```text
Evaluation Observations
+ Decision / Exposure Traces
        ↓
Reward Definition vN
PU View vN
Survival View vN
Attribution View vN
Opportunity-adjusted Utility vN
```

이렇게 해야:

```text
reward definition changes
new censoring treatment
new opportunity definition
new attribution method
```

이 생겨도 raw observations를 다시 해석할 수 있다.

## 48.10 OPE / IPS / DR are estimators, not architecture components

Contextual bandit / OPE 연구의 위치를 좁힌다.

```text
IPS
DR
CRM
PU estimator
survival estimator
```

는:

```text
Evaluation View / Experiment method
```

이다.

Runtime memory architecture의 semantic primitive가 아니다.

또한:

```text
support = 0
```

인 action의 human outcome을 historical logs만으로 복구할 수 없다는
기존 contract를 유지한다.

따라서 estimator보다 먼저:

```text
support coverage
propensity validity
selection process
censoring
shadow observability
```

를 검증한다.

## 48.11 Shadow-All-Write is instrumentation, not alternate memory truth

Shadow lane:

```text
candidate existed?
could be written/retrieved?
would fit budget?
would answer differ?
LOO contribution?
```

같은 **system-side counterfactual observability**를 늘린다.

하지만:

```text
what would the user have felt?
would future conversation have changed?
would user have corrected it?
```

을 관측하지 못한다.

따라서:

> **Shadow produces counterfactual system traces, not human counterfactual truth.**

`Shadow-All-Write`도 별도 permanent memory universe가 아니라
evaluation instrumentation mode로 둔다.

## 48.12 Sampled LOO and attribution become Evaluation Views

실제 retrieval set에서:

```text
retrieved
→ answer uses?
```

를 cheap proxy로 보고,
일부 sample에 대해서만 LOO/counterfactual rerun을 수행하는
기존 방향을 유지한다.

이 역시:

```text
Retrieval / Access Trace
+ answer trace
+ sampled counterfactual
→ Attribution View
```

로 들어간다.

Attribution은 derived evaluation result이며
belief provenance로 승격되지 않는다.

## 48.13 Constraint-first evaluation is the common promotion gate

평균 utility가 좋아도:

```text
false-memory
authority violation
privacy failure
unsafe action
hard contract break
```

가 생기면 policy candidate를 승격시키지 않는다.

후보 promotion order:

```text
1. hard semantic / governance constraints
2. false-memory / correctness / safety bounds
3. support / observability validity
4. utility / latency / cost improvement
```

따라서 single scalar reward 하나로 모두 trade-off하지 않는다.

> **Policy optimization is lexicographic / constrained before it is scalar.**

Exact metric hierarchy는 R3에서 domain별로 operationalize한다.

## 48.14 Policy deployment is versioned operational configuration

학습 결과:

```text
Policy Candidate vN
```

가 좋다고 해서 자동으로 truth가 되지 않는다.

Lifecycle 후보:

```text
candidate
→ shadow
→ replay / offline evaluation
→ constraint validation
→ promoted active policy
→ monitor
→ rollback / supersede
```

Active policy version은:

```text
operational configuration authority
```

를 가질 수 있지만
user-memory fact나 governance rule이 아니다.

따라서:

```text
Learned Policy
≠ Memory Content
≠ Governance
```

를 유지한다.

## 48.15 Learned policy artifacts must satisfy erasure constraints

Privacy research와 직접 연결된다.

개인 memory/outcome data에서 policy/classifier/adapter를 학습한다면:

```text
source influence traceability
rebuild / retrain path
artifact invalidation
verification
```

이 필요하다.

없다면 그 artifact를
개인 memory의 permanent sink로 쓰지 않는다.

이 점은 다음 Governance / Erasure synthesis에서 다시 검토한다.

## 48.16 Current policy family after semantic collapse

현재 R2에서 남는 policy 의미는 대략:

```text
A. FORMATION / MATERIALIZATION
   write / promote?
   which registered projections to materialize?

B. READ / CONTEXT ASSEMBLY
   which sources/projections?
   which anchors / expansion?
   what accessibility / budget?

C. MAINTENANCE
   when to replay / consolidate / reopen?
   which scope?

D. ACQUISITION
   observe / wait / opportunistic / ask?

E. ACTION-FACING
   prospective intervention?
   which applicable skill/procedure candidate?

F. EXPERIMENT / DEPLOYMENT
   which policy version is active?
```

이들은 공통 Decision / Observation / Evaluation contracts를 공유할 수 있지만
하나의 global controller로 강제하지 않는다.

## 48.17 What collapses

### MERGE at semantic instrumentation level

```text
write-policy logging
retrieval-policy logging
consolidation-policy logging
elicitation-policy logging
intervention-policy logging
→ Policy Decision Trace
```

```text
opportunity
exposure
use
answer/action divergence
feedback
→ Evaluation Observation / Funnel
```

```text
reward
PU
survival
LOO attribution
OPE
→ versioned Evaluation Views / experiment methods
```

### DECOMPOSE

```text
Neural Memory Controller
→ local policy contracts
+ optional learned implementations
```

```text
"Outcome"
→ owning-domain source/operational event
+ evaluation role/reference
```

### KEEP SEPARATE

```text
policy proposal
≠ semantic transition

policy action
≠ authority permission

Decision Trace
≠ Derivation Provenance
≠ Retrieval Trace

Evaluation outcome
≠ user-memory truth by default

learned policy
≠ governance
```

## 48.18 Empirical uncertainty remains substantial — and belongs in R3

이 영역은 semantics보다 empirical comparison이 많이 남는다.

First-wave candidates already supported by R1:

```text
WRITE vs NO_WRITE derived promotion
hard-gated retrieval vs global-soft-prior
cheap usage proxies + sampled LOO
opportunity-adjusted accessibility vs age/frequency baseline
context-gated prospective monitoring vs broader monitoring
```

후속 후보:

```text
heuristic vs learned routing
IPS vs DR diagnostics where support allows
PU / survival views
factorized policy learning
```

즉 여기서는 R2가 알고리즘 winner를 정하면 안 된다.

## 48.19 Main recommendation

R2에서 다음을 채택하는 것을 추천한다.

> **Collapse memory-policy learning mechanisms into a family of local `Policy Decision` contracts with shared decision/exposure/outcome instrumentation and versioned Evaluation Views. Treat Neural Memory Controller as an optional implementation family, Shadow-All-Write as instrumentation, OPE/PU/survival/LOO as evaluation methods or derived views, and reward as derived rather than canonical. Reuse authoritative/source events from their owning domains as evaluation observations by reference instead of creating a duplicate global outcome truth. Policy proposals remain subordinate to semantic, governance, and authority gates, and learned policies are versioned operational configuration rather than memory truth.**

## 48.20 User decision — ACCEPTED

사용자는 다음 policy/evaluation synthesis를 채택했다.

```text
Memory Policy
→ family of local policy decisions, not one global controller

Policy Decision Trace
→ common evaluation instrumentation contract

Outcome
→ reference owning-domain source/operational observations
  + evaluation-only traces where necessary

Reward / PU / survival / attribution
→ versioned derived Evaluation Views

Shadow-All-Write
→ instrumentation only

OPE / IPS / DR
→ experiment/evaluation methods, not architecture components

Learned Controller
→ optional policy implementation

Policy deployment
→ versioned operational config

all policy proposals
→ semantic / authority / governance gates first
```

따라서 learned policy는 memory truth나 governance rule이 아니며,
R3가 policy winner를 정하더라도 accepted semantic/authority contracts를
재정의할 수 없다.


---

# 49. R2 Semantic Decision Candidate — Governance / Suppression / Governed Erasure

> 상태: **R2 SEMANTIC BOUNDARY ACCEPTED**
>
> 기준 Galpi `main`: `71025861d07521f88c21b8c88360280ec6f3c604`.
>
> 근거 corpus:
> Privacy / Governed Erasure,
> Forgetting / Retention,
> Truth Maintenance / Correction,
> Identity Resolution / Active Elicitation,
> Longitudinal / Shared / XION History,
> Erasability-by-Design,
> accepted Derivation-Provenance split,
> accepted Context Assembly / Policy / Action boundaries,
> 그리고 현재 Galpi의 task/reminder `deleted` operational contract.
>
> 핵심 질문:
>
> **Governance를 memory semantics 안으로 흡수할 수 있는가,
> 그리고 correction / suppression / deletion / erasure의 책임을
> 현재 R2 vocabulary로 얼마나 더 줄일 수 있는가?**

## 49.1 Main result — Governance is a cross-cutting authority contract, not memory content

현재까지의 연구를 합치면 Governance는:

```text
memory state
projection
learned policy
retrieval policy
skill
```

중 어느 것도 아니다.

Governance가 답하는 질문:

```text
Is this operation allowed?
Under whose authority?
Over exactly what target/scope?
What constraints must remain true?
What proof/receipt is required afterward?
```

따라서 추천:

> **Treat Governance as cross-cutting operational authority over sensitive state changes and external actions, not as a memory subsystem or learned policy.**

이것은 하나의 giant governance service/class를 강제하지 않는다.

## 49.2 Four user intents that must not share one `forget()` operation

Privacy research의 distinction을 R2 vocabulary에 맞춰 다시 배치한다.

```text
"그건 틀렸어"
→ CORRECTION
→ Derived-State Transition

"그건 옛날 얘기야"
→ WORLD_UPDATE / temporal supersession
→ Derived-State Transition

"앞으로 답할 때 그건 쓰지 마"
→ USE / PERSONALIZATION CONSTRAINT
→ authoritative governance/personalization state
→ Context Assembly must honor

"그 기록을 완전히 지워"
→ GOVERNED ERASURE
→ destructive operation over owning source domains
```

이 네 개를 하나의 `forget` lifecycle로 만들지 않는다.

특히 중요한 새 정리:

> **Explicit suppression is not merely a low accessibility score.**

사용자가:

```text
"이건 앞으로 답변에 쓰지 마"
```

라고 명시했다면 learned Accessibility Policy가 나중에
“이번에는 relevance가 높다”고 판단해 다시 올리면 안 된다.

따라서 explicit suppression은:

```text
learned accessibility preference
```

가 아니라:

```text
user-authoritative use constraint
```

로 보는 것을 추천한다.

## 49.3 Governance Constraint and Governance Decision can share a contract family

Action research와 Privacy research를 합치면 두 형태가 보인다.

### Durable Governance Constraint

예:

```text
do not use memory X for personalization
require confirmation before external write
do not execute trading action automatically
```

이는 persistent operational authority state다.

### Concrete Governance Decision

예:

```text
this email send → ALLOW / DENY
this erasure plan → AUTHORIZED / NOT AUTHORIZED
```

공통 logical vocabulary 후보:

```text
operation type
subject / actor
target / scope
authority basis
applicable constraints
decision
conditions
timestamp/version
non-content audit reference
```

하지만:

```text
one shared logical contract
≠ one physical table
≠ one universal policy engine
```

이다.

## 49.4 Governed Erasure is a special destructive operation

Erasure는 ordinary memory transition이 아니다.

Recommended semantic flow:

```text
ERASURE INTENT
        ↓
1. INTENT TYPE RESOLUTION
        ↓
2. TARGET / SCOPE RESOLUTION
        ↓
3. SOURCE TARGET PLAN
        ↓
4. DERIVATION IMPACT PLAN
        ↓
5. GOVERNANCE AUTHORIZATION
        ↓
6. DELETE / REVOKE SOURCE IN OWNING DOMAIN
        ↓
7. INVALIDATE DEPENDENT DERIVED STATE
        ↓
8. REPLAY / REBUILD FROM SURVIVING SOURCES
        ↓
9. INVALIDATE CACHES / INDEXES / QUEUES / LEARNED ARTIFACTS
        ↓
10. NO-RESURRECTION BARRIER
        ↓
11. VERIFY
        ↓
12. CONTENT-FREE ERASURE RECEIPT
```

단계 이름은 runtime modules가 아니다.

## 49.5 Scope resolution reuses Hypothesis / Identity / Elicitation semantics

다음 요청:

```text
"민수 관련 기억 다 지워"
```

에서:

```text
민수 A?
민수 B?
둘 다?
특정 기간?
특정 대화만?
```

이 결과를 바꾸면:

```text
candidate target hypotheses
→ discriminators
→ explicit clarification
```

을 재사용한다.

하지만 identity-erasure는 stricter gate:

```text
ambiguity
→ fail-close
→ do not erase yet
```

다.

강한 원칙:

> **Irreversibility increases the clarification threshold; it does not justify guessing.**

## 49.6 Source target selection and derivation propagation are two different traversals

여기서 과삭제를 막기 위한 중요한 distinction이 필요하다.

### Source Target Selection

질문:

```text
Which canonical/source records did the user actually ask to erase?
```

기준 후보:

```text
explicit record/conversation selection
resolved entity identity
resolved time interval
resolved topic/content scope
owning-domain semantics
```

### Derivation Propagation

질문:

```text
Which derived artifacts depend on those selected sources?
```

기준:

```text
Derivation / Dependency Provenance
```

따라서:

> **Semantic association may help discover candidate sources for scope review, but association alone must not authorize deletion propagation.**

예:

```text
E1 SHARED_ENTITY_WITH E2
```

라고 해서 E1 삭제 시 E2를 자동 삭제하지 않는다.

반면:

```text
Projection P DERIVED_FROM E1
```

이면 P는 rebuild/invalidation 대상이다.

이 결정은 accepted:

```text
Derivation Provenance
≠ Semantic Association
```

을 privacy failure mode에 직접 적용한다.

## 49.7 Multiple physical sources do not require one physical Erasure Ledger

현재 Galpi는 이미 domain별 source of truth가 다르다.

예:

```text
conversation source
topic QA source
structured memory state
task/reminder operational state
```

R2 erasure semantics는 이를 하나의 physical evidence table로 강제하지 않는다.

추천:

```text
Erasure Plan
→ references source records in their owning domains
```

그리고 각 owning domain이 자신의 source deletion/revocation semantics를 실행한다.

즉:

> **Cross-domain erasure requires logical addressability and ownership, not necessarily one physical source store.**

이 결론은 추후 physical source organization 결정과 호환된다.

## 49.8 Mixed-support derived state uses ordinary replay machinery

예:

```text
Preference P
support = E42 + E81 + E93
```

여기서 E42를 erase:

```text
delete E42
→ mark P affected
→ replay E81 + E93
→ rebuild / revise / invalidate P
```

즉 privacy를 위해 별도 derived-state semantics를 만들지 않는다.

재사용:

```text
Derivation reachability
+ accepted replay package
+ accepted Derived-State Transition / Projection rebuild
```

다만 trigger/authority는 Governance가 소유한다.

> **Governance chooses what source must disappear; epistemic machinery determines what surviving meaning can still be justified.**

## 49.9 Suppression uses Context Assembly as enforcement path, but policy cannot override it

Explicit use constraint:

```text
memory/state X
→ DO_NOT_USE_FOR_PERSONALIZATION
```

가 있다면 Context Assembly은 해당 constraint를 hard gate로 적용한다.

```text
retrieval relevance high
+ explicit suppression active
→ personalization exposure denied
```

단, exact semantics는 purpose-scoped일 수 있다.

예:

```text
do not proactively personalize with X
```

와:

```text
never reveal / never retrieve X
```

는 같은 scope가 아닐 수 있다.

따라서 suppression contract는 최소:

```text
target
purpose/scope
effective state
authority
```

를 구분할 필요가 있다.

Exact taxonomy/schema는 OPEN.

## 49.10 Existing Galpi `deleted` task lifecycle is NOT privacy erasure

현재 task/reminder design의 CLOSED contract:

```text
task delete
→ lifecycle = deleted
→ normal list/search/AI reference에서 제외
→ recovery 가능
→ C1에는 physical purge 없음
```

은 그대로 유지한다.

따라서 R2에서:

```text
task UI "삭제"
```

를 갑자기:

```text
privacy hard erase
```

로 재해석하지 않는다.

명확한 vocabulary:

```text
OPERATIONAL DELETE / SOFT DELETE
→ owning task domain lifecycle

GOVERNED ERASURE
→ explicit privacy/destructive operation
```

향후 사용자가 실제 task content erasure를 요구하면
그건 **별도 governed-erasure flow**가 task owning domain을 target하는 문제다.

> **Do not silently reopen C1's no-physical-purge contract.**

## 49.11 No-resurrection becomes a governance barrier, not a memory tombstone truth

Erased content가:

```text
old cache
embedding
summary
projection
queued job
snapshot restore
learned artifact
```

에서 되살아나면 hard failure다.

Candidate governance artifact:

```text
Erasure Barrier / Receipt
- non-content target identity/reference
- scope descriptor that does not reproduce erased content
- erased_at
- operation/version
- propagation/rebuild watermark
- verification status
```

목적:

```text
prevent stale replay
reject old queued work
detect incomplete rebuild
prove live propagation completed
```

이 artifact는 user-memory evidence가 아니다.

그리고 erased sensitive text를 receipt에 복제하지 않는다.

## 49.12 Learned artifacts reuse policy lifecycle with a stricter erasability requirement

개인 data를 학습한:

```text
retrieval classifier
routing model
adapter
personal embedding model
policy artifact
```

가 affected source를 포함한다면:

```text
identify affected artifact
→ invalidate active artifact
→ rebuild / retrain / unlearn from surviving data
→ verify
→ only then re-promote
```

를 우선한다.

만약 artifact가:

```text
source influence not traceable
AND
cannot rebuild / unlearn
AND
can retain personal content/influence
```

라면:

> **That artifact class must not be used as a durable sink for erasable personal memory.**

이는 accepted Policy Candidate lifecycle을 재사용한다.

## 49.13 Projection / User Model / Core / history all follow the same downstream rule

삭제 source에 의존하는:

```text
Projection
User Model composition
Tiny User Core
Relationship state/view
Routine pattern
Event projection
Shared History
User Life History
XION Self-History narrative
specialist-derived state
```

는 특별 면제되지 않는다.

```text
affected
→ invalidate/rebuild/redact from survivors
```

Core라서 보존되는 것도 아니고
history라서 “이미 있었던 사실”이라는 이유로 남는 것도 아니다.

> **Privileged visibility does not create erasure immunity.**

## 49.14 Non-personal system consequences are the main remaining semantic edge case

Privacy research가 OPEN으로 남긴 질문:

```text
user evidence erased
        ↓
a system consequence occurred because of it
```

예:

```text
personal instruction erased
but an external action really occurred
```

가능한 두 극단:

### Option A — erase every downstream consequence

장점:
- privacy 의미가 가장 강함.

문제:
- 실제 operational/audit history까지 거짓으로 만들 수 있음.
- 외부 세계에서 이미 일어난 사건을 XION 내부에서 없는 일로 처리할 수 있음.

### Option B — keep every system consequence

장점:
- operational history 보존.

문제:
- retained consequence가 erased personal content를 재구성하는 side channel이 될 수 있음.

현재 추천은 둘 다 아니다.

Working rule candidate:

```text
retain a non-personal consequence only if:
1. it has independent operational authority/provenance,
2. retaining it does not preserve or reconstruct the erased personal content,
3. content-bearing derived narrative is rebuilt/redacted.
```

하지만 `reconstruct`의 exact threshold와 audit obligations는
현재 corpus만으로 완전히 닫기 어렵다.

따라서 이 edge case의 exact retention policy는
**OPEN — later governance design decision**으로 남긴다.

## 49.15 Backup / snapshot retention remains deferred, but live no-resurrection is not deferred

기존 R1 결정을 유지한다.

OPEN / DEFER:

```text
exact backup retention duration
historical snapshot destruction schedule
storage-class-specific purge protocol
```

하지만 지금도 닫혀 있는 contract:

```text
live DB
derived indexes
caches
active queues
materialized projections
active learned artifacts
```

에서 erased content가 되살아나면 안 된다.

즉 backup implementation을 아직 정하지 않았다는 이유로
live no-resurrection requirement까지 미루지 않는다.

## 49.16 Erasure verification is not ordinary policy evaluation

정책 평가는:

```text
did this policy improve utility/correctness?
```

를 묻는다.

Erasure verification은:

```text
did prohibited content remain or resurrect?
```

를 묻는다.

따라서 evaluation infrastructure를 재사용할 수 있어도
erasure completion은 optimization metric이 아니다.

Pass/fail invariant 후보:

```text
target source absent/revoked as intended
no active derived artifact contains forbidden dependency/content
surviving independent evidence preserved
rebuild completed
stale replay rejected
receipt/barrier installed
```

False over-deletion도 함께 검증한다.

## 49.17 Governance and learned policy have an explicit precedence relation

Accepted policy synthesis:

```text
local policy proposal
→ semantic / authority / governance gate
```

를 privacy에도 적용한다.

```text
explicit user suppression
>
learned accessibility preference

erasure authorization
>
learned retention/utility score

action prohibition
>
skill-selection policy
```

즉:

> **Learned policies may optimize within governance constraints; they cannot learn their way around them.**

## 49.18 What collapses

### MERGE / COMPOSE

```text
identity ambiguity
+ hypothesis/discriminator/elicitation
→ erasure scope resolution

derivation provenance
+ replay/rebuild
→ erasure propagation

Context Assembly
+ explicit suppression constraint
→ use restriction enforcement

Policy artifact lifecycle
+ erasability requirement
→ invalidate/rebuild/re-promote learned artifacts

action authorization
+ erasure authorization
→ shared Governance Decision contract family
```

### DECOMPOSE

```text
"forget"
→ correction
+ world update
+ explicit use constraint
+ governed erasure
```

```text
erasure
→ source target selection
+ derivation impact propagation
+ no-resurrection verification
```

### KEEP SEPARATE

```text
Governance
≠ Memory Content
≠ Learned Policy
≠ Derivation Provenance

Operational Soft Delete
≠ Privacy Erasure

Semantic Association
≠ Erasure Propagation Authority

Suppression
≠ Accessibility Score

Erasure Receipt
≠ User Memory Truth
```

## 49.19 Main recommendation

R2에서 다음을 채택하는 것을 추천한다.

> **Keep Governance as a cross-cutting operational authority rather than a memory subsystem. Decompose `forget` into correction, temporal update, explicit use suppression, and governed erasure. Treat explicit suppression as an authoritative purpose-scoped use constraint enforced by Context Assembly, not as learned accessibility. Model erasure as a governed destructive workflow: resolve intent and scope fail-closed, select source records in their owning domains, propagate only through Derivation/Dependency Provenance, rebuild surviving meaning with existing transition/projection machinery, invalidate memory-bearing caches/queues/learned artifacts, install a non-content no-resurrection barrier/receipt, and verify completion. Preserve the existing Galpi task `deleted` lifecycle as operational soft deletion rather than silently redefining it as privacy erasure.**

## 49.20 User decision — ACCEPTED

사용자는 다음 governance / erasure synthesis를 채택했다.

```text
Governance
→ cross-cutting authority contract

explicit suppression
→ authoritative purpose-scoped Use Constraint
→ Context Assembly hard gate

governed erasure
→ destructive workflow outside ordinary memory transition

scope resolution
→ reuse Hypothesis / Identity / Elicitation, fail-close

source selection
→ owning-domain semantics

derived propagation
→ Derivation / Dependency Provenance only

surviving meaning
→ replay / rebuild from surviving evidence

learned artifacts
→ invalidate / rebuild / unlearn / verify

no resurrection
→ content-free Erasure Barrier / Receipt + verification

task `deleted`
→ existing operational soft delete, unchanged
```

다음은 아직 닫지 않는다.

```text
non-personal system consequence retention after personal-source erasure
exact backup / snapshot retention
exact suppression-purpose taxonomy
```

이들은 current R2 architecture를 막는 핵심 memory-semantic 질문이 아니라,
실제 governed-erasure product scope가 생길 때 닫아야 하는 governance policy다.


---

# 50. R2 Open-Decision Triage / Semantic-Collapse Exit Gate

> 상태: **R2 TRIAGE COMPLETE — SOURCE ADDRESSABILITY ACCEPTED**
>
> 기준 Galpi `main`: `71025861d07521f88c21b8c88360280ec6f3c604`.
>
> 목적:
> Semantic Collapse / Completion 이후 문서에 남아 있는 `OPEN`을
> 모두 같은 무게로 취급하지 않는다.
>
> 다음 네 bucket으로 분류한다.
>
> ```text
> A. USER / R2 ARCHITECTURE DECISION
> B. R3 EMPIRICAL DECISION
> C. IMPLEMENTATION / STORAGE DETAIL
> D. REQUIREMENT-TRIGGERED / DO NOT BUILD YET
> ```
>
> 이 pass는 새 theory를 추가하는 단계가 아니다.
> 이미 채택한 semantic contracts를 다시 열지 않고,
> **R2를 실제 architecture synthesis로 넘기기 전에 무엇이 정말 남았는지 정리**한다.

## 50.1 Already closed — do not reopen during triage

다음은 더 이상 OPEN으로 취급하지 않는다.

```text
evidence != assumption != derived state

provenance / dependency
!= semantic association
!= retrieval/access trace
!= policy-decision trace

one provenance-aware derived-state transition contract

Hypothesis as base uncertainty state
Fork as unresolved Hypothesis-set relation/view
Prediction as optional discriminator
Active Elicitation as evidence-acquisition policy

MemoryFormatter mini-engine
→ Projection Contract
+ shared transition
+ separate materialization/routing policy

Projection Contract vocabulary
→ developer-curated registry
runtime type invention
→ OUT OF SCOPE

User Model
→ temporal logical composition, not giant truth copy

read-side memory
→ Context Assembly

ordinary forgetting
→ Accessibility Policy

Skill
→ one versioned Skill Contract family

Prospective Memory
→ decomposed into commitment / activation / relevance /
  intervention / completion

Skill Contract
!= Commitment
!= Governance
!= Executor / Current Capability

Memory Policy
→ local policy family with shared instrumentation/evaluation

Governance
→ cross-cutting authority

explicit suppression
→ authoritative Use Constraint

governed erasure
→ source-scope + provenance propagation + rebuild + no-resurrection

task/reminder operational SoT and task `deleted` lifecycle
→ existing CLOSED Galpi contracts remain
```

이 항목들을 architecture option count를 늘리기 위해 다시 variation으로 만들지 않는다.

## 50.2 Bucket A — USER / R2 ARCHITECTURE DECISIONS

### A1. Physical source / evidence organization — **USER DECISION ACCEPTED**

사용자는 **Option B — Logical Evidence Registry / Address Layer over Existing SoTs**를 채택했다.

이 결정으로 현재 남은 R2 source-of-truth blocker는 닫혔다.

Accepted semantics는 이미:

```text
source evidence can live in owning domains
derived state must point back to replayable sources
governed erasure selects sources in owning domains
one physical Evidence Ledger is not semantically required
```

까지 닫혔다.

그러나 implementation architecture는 여전히 다음 중 무엇을 기준으로
source evidence를 address할지 결정해야 한다.

#### Option A — Unified Physical Evidence Ledger

```text
all evidence
→ one canonical evidence table/store
```

장점:

```text
one ID namespace
simple provenance traversal
simple cross-domain replay/erasure indexing
```

비용 / 위험:

```text
current Galpi SoTs와 중복 또는 migration
messages / QA-LOG / paper cache / operational events의 ownership 재정의
sync / dual-write / consistency burden
large blast radius
existing CLOSED contracts를 다시 열 가능성
```

R2의 "minimum change" 원칙과는 긴장이 크다.

#### Option B — Logical Evidence Registry / Address Layer over Existing SoTs

```text
EvidenceRef
- source_domain
- stable source identity
- source type/version/time metadata as needed

resolver
→ owning source store
```

예:

```text
conversation_message:<id>
topic_qa:<topic + qa identity>
paper_source:<document/hash + location>
task_event:<id>
executor_event:<id>
```

장점:

```text
existing SoTs 유지
raw evidence copy 최소화
domain ownership 보존
R2 provenance / replay / erasure semantics와 직접 호환
incremental adoption 가능
```

비용:

```text
cross-store resolver 필요
stable identity contract를 domain별로 정의해야 함
multi-store replay/erasure planning이 물리적으로 단일 DB보다 복잡
source move/rename/versioning 규칙 필요
```

#### Option C — Hybrid New-Memory Ledger

```text
existing evidence
→ external refs

new memory-native evidence
→ new Evidence Ledger
```

장점:

```text
기존 migration 회피
새 memory path에는 uniform schema 가능
```

위험:

```text
"old evidence"와 "new evidence"가 다른 존재론을 가짐
어떤 evidence를 copy하고 어떤 것은 ref만 둘지 새 경계가 필요
provenance/erasure rules가 오히려 복잡해질 수 있음
```

### Recommendation

현재는 **Option B — Logical Evidence Registry / Address Layer**를 추천한다.

이유:

1. 현재 Galpi는 이미 domain별 canonical/operational SoT가 명시돼 있다.
2. R2는 source ownership 자체보다 **stable addressability + provenance replayability**를 요구한다.
3. Unified Ledger가 주는 장점 대부분은 logical reference/index layer로 얻을 수 있다.
4. 현재 요청을 만족하기 위해 existing canonical stores를 migration하는 것은 범위가 크다.
5. future evidence domain을 추가해도 registry adapter만 추가하면 된다.

중요:

> **Logical registry is not another copy of the evidence. It is an address/identity contract over evidence owned elsewhere.**

사용자 결정으로 이 방향을 채택한다.

Accepted source-addressability contract:

```text
one global logical EvidenceRef / evidence identity layer

BUT

source bytes / canonical records remain in their natural owning stores
```

Memory/provenance code는 가능한 한 owning-store-specific key가 아니라
logical evidence identity를 사용하고,
resolver boundary가 owning source를 해석한다.

#### Attachment / binary-source compatibility

첨부파일은 Option B의 예외가 아니라 오히려 natural fit이다.

```text
Attachment Asset / File
= owning attachment/library/blob domain

EvidenceRef
= stable logical reference to that asset or an addressable region/span

parsed text / OCR-like extraction / page chunks / embeddings / summaries
= derived, rebuildable representations
```

따라서 registry가 PDF/image/audio bytes를 복제할 필요가 없다.

현재 Galpi의 기존 contract도 보존한다.

```text
temporary attachment
→ bounded conversation context
→ expires/deletes under its existing lifecycle
→ not silently promoted into durable memory evidence

explicitly promoted library attachment
→ durable owning source
→ may receive durable EvidenceRef(s)
```

정확한 attachment locator는 implementation 단계에서 정한다.

가능한 형태:

```text
whole-file reference
page / section / time range / region / byte or text span
content-hash-backed source identity
```

중 어떤 조합이 필요한지는 파일 유형과 parser/retrieval 요구를 보고 결정한다.

중요한 invariant:

> **Derived chunks do not become the canonical attachment merely because retrieval uses them.**

그리고 attachment가 삭제/만료되면
그 source를 참조하는 derived state/projections은
동일한 provenance-driven invalidation/rebuild rules를 따른다.

---

### A2. Erasure-retained non-personal system consequence — **USER DECISION LATER, DOES NOT BLOCK R2**

예:

```text
personal source erased
but an external action really occurred
```

현재 rule candidate:

```text
retain only if:
- independently authoritative operational fact
- retained form does not preserve/reconstruct erased personal content
- content-bearing narrative/projection is rebuilt/redacted
```

하지만 exact reconstruction threshold / audit policy는
실제 governed-erasure feature scope가 생길 때 사용자와 닫는다.

현재 architecture에는:

```text
"owning operational domain may have independent state"
```

라는 boundary만 남기면 충분하다.

---

### A3. Backup / snapshot erasure retention — **USER / GOVERNANCE DECISION LATER**

현재 R2에서는:

```text
live no-resurrection
→ CLOSED requirement
```

이지만:

```text
backup retention duration
offline snapshot purge SLA
disaster-recovery exception policy
```

는 실제 backup/erasure product contract가 생길 때 결정한다.

현재 minimal memory architecture를 막지 않는다.

## 50.3 Bucket B — R3 EMPIRICAL DECISIONS

다음은 의미/authority가 아니라
**어떤 policy가 실제로 더 잘 작동하는가**의 문제다.

### B1. Instrument validity / first retrieval comparison — first priority

이미 닫힌 first-wave scaffold를 유지한다.

```text
hard-gated
vs
global-soft-prior

same request
same budget
paired shadow
```

첫 질문은 router winner보다:

```text
can routing quality be measured reliably?
```

다.

기존 instrumentation requirements:

```text
cheap proxies
+ sampled LOO
+ shadow lanes
+ explicit correction gold
+ false-memory hard constraint
```

을 유지한다.

### B2. Formation / write / promotion policy

Empirical questions:

```text
derived WRITE vs NO_WRITE
candidate promotion threshold
Core promotion policy
consolidation trigger
schema-congruent fast integration vs replay
```

Semantic rules는 이미 닫혔다.

```text
raw evidence preserved
abstraction never replaces experience
explicit correction privileged
high-impact revision replays canonical support/counterevidence
```

R3는 threshold/policy만 비교한다.

### B3. Context Assembly policy

Candidate comparisons:

```text
flat retrieval
vs event/hierarchical retrieval

direct anchors only
vs bounded context reinstatement

association path types / expansion budgets

No Core baseline
vs Tiny Core product direction

raw hits
vs reconstructed event/evidence package

age/frequency accessibility
vs opportunity-adjusted accessibility
```

Event segmentation trigger/algorithm도
retrieval benefit을 실험적으로 보여줄 때 승격한다.

### B4. Evidence acquisition / uncertainty policy

Empirical questions:

```text
VOI approximation
observe vs opportunistic vs ask
question cooldown / interruption penalty
whether persistent discriminators improve outcomes
```

다만:

```text
ambiguity may remain unresolved
identity false merge is stricter fail-close
```

는 실험 대상이 아니다.

### B5. Skill / prospective action-facing policy

Candidate comparisons:

```text
macro-first vs composition-first
explicit textual skill vs hybrid learned implementation
skill promotion / transfer verification thresholds

context-gated prospective monitoring
vs broader monitoring

structural cue only
vs semantic cue evaluator

surface-all
vs interruption-aware intervention
```

여기서도:

```text
Skill != Commitment != Governance != Executor
```

는 고정이다.

### B6. Learned policy / evaluation method

Only after instrumentation validity:

```text
heuristic vs learned local policy
factorized learners vs broader shared model
opportunity definition
IPS / DR diagnostics where support exists
PU / survival evaluation views
```

`support = 0` 문제를 estimator로 해결했다고 간주하지 않는다.

## 50.4 Bucket C — IMPLEMENTATION / STORAGE DETAILS

다음은 현재 semantic/product meaning을 바꾸지 않는 한
사용자에게 선택을 요구하지 않는다.

### C1. Derived-state representation

```text
exact Hypothesis schema
whether Ambiguity Set is materialized or query-time
status enum / support representation
exact change-taxonomy enum names
replay-package serialization
```

단 empirical value가 걸리는 persistence/latency choice는
필요 시 R3/benchmark로 승격할 수 있다.

### C2. Provenance physical representation

```text
SQL adjacency tables
recursive CTE
graph engine
materialized dependency index
```

accepted semantic contract만 지키면 implementation detail이다.

```text
DERIVED_FROM / SUPPORTS / INVALIDATES ...
```

와 semantic-association edges를 의미상 분리해야 한다.

### C3. Projection implementation

```text
exact Projection Contract software interface
initial schema layout
table/file shape
cache strategy
User Model snapshot/cache shape
which simple views are query-time vs materialized
```

단 materialization 여부가 품질/latency에 실질적 영향을 주면
implementation benchmark로 결정한다.

### C4. Context Assembly representation

```text
typed Working Set serialization
internal candidate structure
retrieval-trace encoding
handoff summary format
local helper/module boundaries
```

semantic type/authority preservation만 필수다.

### C5. Evaluation storage

```text
Policy Decision Trace table shape
Evaluation Observation storage
active-policy config location
reward-view materialization
```

공통 logical contract를 만족하면 physical store는 implementation detail이다.

### C6. Governance machinery

```text
Erasure Plan schema
Erasure Barrier / Receipt schema
rebuild watermark representation
suppression table layout
per-store executor functions
```

governance semantics와 fail-close/no-resurrection을 바꾸지 않는 범위에서
implementation design이다.

## 50.5 Bucket D — REQUIREMENT-TRIGGERED / DO NOT BUILD YET

### D1. Runtime autonomous Projection-Type invention

Already closed:

```text
OUT OF SCOPE
```

새 projection type은 개발 과정에서 사람이 설계/검토/테스트한다.

### D2. Durable agent-internal cross-session commitment store

현재 concrete product requirement가 없다.

```text
workflow-local obligation
→ workflow/execution state

user-facing durable commitment
→ existing task/reminder SoT

durable agent-internal cross-session commitment
→ DO NOT BUILD
```

실제 use case가 생기면 authority/expiry/ownership을 새로 설계한다.

### D3. One universal neural memory controller

공통 Policy Decision / Evaluation contracts는 채택했지만:

```text
one model controls write + retrieval + consolidation + ask + action
```

은 요구되지 않는다.

여러 local policies가 실제 실험에서 하나의 learned model로 합쳐질 근거가 생기기 전에는
설계 목표로 두지 않는다.

### D4. Separate memory stores per specialist / thread

이미 semantic collapse로 필요성이 사라졌다.

```text
shared evidence / derived state
+ scoped Context Assembly
```

를 우선한다.

### D5. Generic `Action Memory` store

이미 rejected by boundary synthesis.

```text
Skill
Commitment
Governance
Capability
```

를 하나의 store/authority로 만들지 않는다.

### D6. Unified physical graph as universal truth substrate

General Graph decomposition으로 더 이상 architecture target이 아니다.

Graph technology는 필요한 projection/provenance implementation에서만
선택할 수 있다.

## 50.6 Open items from earlier R2 passes — disposition table

| Earlier OPEN | Disposition now |
|---|---|
| physical source/evidence organization | **ACCEPTED — Logical Evidence Registry / Address Layer over Existing SoTs** |
| exact hypothesis persistence shape | **C1**, with persistence value testable under B4 if needed |
| discriminating prediction materialization | **B4 / C1**; not a semantic blocker |
| exact Projection Contract interface | **C3** |
| initial Projection Contract set | **C3 design choice**, developer-curated; expand only from concrete use cases |
| projections materialized vs query-time | **C3**, benchmark if performance/quality matters |
| User Model materialization | **C3** |
| Context Assembly baseline algorithm | **B3** |
| event segmentation trigger/algorithm | **B3** |
| consolidation/promotion thresholds | **B2** |
| Core promotion exact policy | **B2** |
| exact VOI approximation/cooldown | **B4** |
| Memory Policy learner decomposition | **B6** |
| evaluation-state physical storage | **C5** |
| exact governance erasure machinery | **C6** |
| suppression-purpose exact taxonomy | **A2/A3-era governance decision + C6 schema later** |
| non-personal consequence retention | **A2 — later user governance decision** |
| backup/snapshot retention | **A3 — later user governance decision** |
| durable agent-internal prospective authority/store | **D2 — do not build until requirement** |
| graph/store technology | **C2**, not R2 semantics |
| exact specialist orchestration protocol | outside memory architecture; design when orchestration work begins |
| exact relationship/closeness scale | **C1/B2-style policy detail**, not architecture |
| exact context serialization | **C4** |

## 50.7 R2 exit-gate result — PASSED

Semantic Collapse / Completion은 사실상 끝났고,
마지막 blocking architecture decision도 닫혔다.

Accepted:

```text
heterogeneous canonical/source evidence
→ Logical Evidence Registry / Address Layer over Existing SoTs

registry
→ identity/address contract

owning domains
→ canonical/source bytes and records
```

이 선택은 현재 Galpi의:

```text
messages
QA-LOG
paper / attachment sources
structured/operational SQLite state
```

를 불필요하게 재정의하지 않으면서도,
R2가 요구하는:

```text
stable evidence identity
provenance
replay
cross-domain erasure planning
```

을 제공한다.

다음 순서:

```text
1. remaining non-collapsible boundaries final map
2. R3 experiment set reduction
3. minimal coherent architecture synthesis
```


---

# 51. R2 Hard Boundary Final Map

> 상태: **R2 BOUNDARY MAP — ACCEPTED CONTRACTS CONSOLIDATED**
>
> 기준 Galpi `main`: `71025861d07521f88c21b8c88360280ec6f3c604`.
>
> 이 절은 39~50절에서 채택한 R2 결정을 한 장의 normative map으로 압축한다.
> subsystem 수, class 수, table 수를 정하는 문서가 아니다.
>
> Visual companion: [XION R2 Hard Boundary Final Map](./xion-r2-hard-boundary-map.png)
>
> **이미지는 설명용이다. 이미지와 본문이 충돌하면 이 Markdown contract가 우선한다.**

## 51.1 Final semantic spine

현재 연구는 다음 중심 spine으로 수렴한다.

```text
OWNING SOURCES / CANONICAL SoTs
        ↓
LOGICAL EVIDENCE REGISTRY / ADDRESS LAYER
        ↓
DERIVATION / DEPENDENCY PROVENANCE
        ↓
PROVENANCE-AWARE DERIVED-STATE TRANSITION
        ↓
DERIVED STATES / HYPOTHESES
        ↓
0..N TYPED PROJECTIONS
        ↓
CONTEXT ASSEMBLY
        ↓
REASONING / INTERVENTION / ACTION CANDIDATES
```

옆에서 다음이 별도 authority로 결합한다.

```text
Operational Commitment State
Skill Contract
Governance / Use Constraints
Executor / Current Capability
Policy Decision + Evaluation
```

그리고 Governance는 source부터 action까지 cross-cutting하게 제약한다.

핵심 해석:

> **One coherent memory model does not mean one store, one graph, one controller, or one authority.**

## 51.2 Layer 1 — Owning Sources / Canonical SoTs

Source evidence와 authoritative operational state는 각 natural owner에 남는다.

현재/예상 owning domains:

```text
Conversation messages
Topic QA-LOG
Papers / library attachments / promoted durable files
Structured memory source records where applicable
Task / reminder operational state and events
Executor / telemetry / capability-owned events
Future domain-specific authoritative sources
```

Accepted rule:

```text
source ownership
!=
memory representation ownership
```

Memory architecture가 모든 원본을 하나의 physical ledger로 재소유하지 않는다.

첨부파일도 같은 원칙을 따른다.

```text
file/blob bytes
→ attachment/library owning domain

EvidenceRef
→ whole asset or immutable-version region/span

chunks / transcript / captions / embeddings / summaries
→ derived, rebuildable representations
```

Temporary attachment는 기존 lifecycle을 따르며 명시적 승격 없이 durable memory evidence가 되지 않는다.

## 51.3 Layer 2 — Logical Evidence Registry / Address Layer

Accepted Option B:

```text
one global logical evidence identity/address layer
+
multiple natural owning source stores
```

Conceptual `EvidenceRef`:

```text
evidence_id
source_domain
stable source identity
source version / content hash where required
optional stable locator/span
resolver contract
```

Memory/provenance code의 원칙:

```text
prefer EvidenceRef
not scattered owning-store-specific keys
```

Registry가 하지 않는 일:

```text
copy raw evidence
redefine source authority
turn operational state into evidence
silently promote temporary sources
```

## 51.4 Layer 3 — Epistemic / Derived Memory

### Source evidence and interpretation

```text
SOURCE EVIDENCE
!=
ASSUMPTION
!=
HYPOTHESIS / DERIVED STATE
```

사용자 발화/행동 자체는 evidence이고,
그 발화의 가능한 의미 해석이 assumption/hypothesis가 될 수 있다.

### Hypothesis model

```text
Hypothesis
= live derived claim / interpretation

Fork
= same ambiguity space의 1..N live Hypotheses relation/view

Prediction
= optional discriminator subtype

Active Elicitation
= separate evidence-acquisition policy
```

Fork membership은 mutual exclusivity나 exhaustiveness를 강제하지 않는다.

### Shared transition semantics

Formation / consolidation / reconsolidation / ordinary derived revision은 다음 contract를 공유한다.

```text
TRIGGER
→ SELECT TARGET / SCOPE
→ BUILD REPLAY PACKAGE
→ CLASSIFY CHANGE
→ PROPOSE TRANSITION
→ DOMAIN-SPECIFIC VALIDATION / PROMOTION
→ ATOMIC COMMIT
```

Candidate transition meanings:

```text
NO_CHANGE
CREATE
EXPAND
SUPERSEDE
REVISE
FORK / KEEP_AMBIGUOUS
INVALIDATE
```

강한 invariant:

```text
ordinary mutation changes derived state, not source evidence
```

Governed erasure만 이 ordinary rule의 별도 destructive exception이다.

## 51.5 Derivation Provenance vs Semantic Association vs Access/Evaluation Traces

다음 네 관계는 절대 하나의 generic graph semantics로 합치지 않는다.

```text
DERIVATION / DEPENDENCY PROVENANCE
→ why does this derived state exist?

SEMANTIC ASSOCIATION / EVENT RELATION
→ what is meaningfully related for retrieval/navigation?

RETRIEVAL / ACCESS TRACE
→ why did this candidate enter this reasoning episode?

POLICY DECISION TRACE
→ why did a policy propose/select this action?
```

Consequences:

```text
semantic association
!= mutation authority
!= erasure propagation authority

retrieval trace
!= belief support

policy trace
!= user truth
```

Physical graph technology may be shared, but semantic traversal authority must remain separate.

## 51.6 Projection layer

`MemoryFormatter` mini-engine abstraction은 폐기하고 다음으로 정리한다.

```text
Projection Contract
+ Projection routing / materialization policy
+ shared Derived-State Transition Contract
```

Projection은 source truth가 아니라 typed computational view다.

Representative semantics:

```text
Ranking
Timeline / longitudinal history
Decision history
Semantic Association / Event view
Relationship view
Preference view
Tiny User Core
Life / Shared / XION history views
```

다만:

```text
General Fact
→ derived claim/state, not primarily a projection

Relationship State
!= Relationship View

Routine Pattern
!= executable Skill Contract
```

Projection vocabulary는 developer-curated registry다.

```text
runtime autonomous projection-type invention
→ OUT OF SCOPE
```

## 51.7 User Model and Core

User Model은 giant profile truth copy가 아니다.

```text
user-related provenance-backed derived states
        ↓
temporal composition
        ↓
User Model @ now / User Model @ t
```

Tiny User Core:

```text
strictly promoted tiny stable projection
→ privileged Context Assembly input
```

강한 invariant:

> **Always-visible memory is privileged memory.**

Core promotion은 일반 derived memory보다 stricter gate를 가진다.

## 51.8 Context Assembly — one read-side process

다음 mechanism은 one ephemeral read process로 collapse했다.

```text
Contextual Activation
Sparse Retrieval Routing
Direct Anchor Retrieval
Event / Hierarchical Retrieval
Context Reinstatement
Typed Associative Expansion
ordinary Forgetting / Accessibility
Activated Candidate Set
Dynamic Working Set
role/thread/specialist-scoped cognitive context
```

Conceptual flow:

```text
CURRENT REQUEST + SCOPED PRIORS
→ CONTEXT FRAME
→ SOURCE / PROJECTION ROUTING
→ DIRECT ANCHORS
→ BOUNDED EVENT / ASSOCIATION EXPANSION
→ VALIDITY / ACCESSIBILITY / SCOPE FILTERING
→ READER-CONTEXT RECONSTRUCTION
→ ACTIVATED CANDIDATE SET
→ NARROW FOCUS
→ TYPED DYNAMIC WORKING SET
```

Working Set은 ephemeral이고 typed authority를 유지한다.

```text
attention / activation
!= evidence
!= truth promotion
!= mutation permission
```

Ordinary forgetting은:

```text
Accessibility Policy
```

로 read path에 속한다.

반면:

```text
semantic invalidity
→ transition / temporal state

governed erasure
→ Governance
```

다.

## 51.9 Action / operational hard boundaries

여기가 R2에서 처음 확인된 genuinely non-collapsible boundary다.

```text
Skill Contract
!=
Commitment State
!=
Governance / Authorization
!=
Executor / Current Capability
```

의미:

```text
Skill
→ HOW

Commitment
→ WHAT remains promised/pending

Prospective Activation
→ WHEN / under what CUE it becomes relevant

Governance
→ WHETHER allowed

Executor
→ DO / what can actually happen now
```

`Prospective Memory`라는 별도 truth type은 만들지 않는다.

```text
commitment content
+ activation condition
+ relevance / armed state
+ intervention policy
+ completion / deactivation
```

으로 분해한다.

User-facing durable commitment는 existing task/reminder operational SoT를 유지한다.

Context-based prospective activation은 Context Assembly와 compose한다.

Skill applicability와 prospective cue는 condition machinery를 공유할 수 있지만 semantics/lifecycle은 공유하지 않는다.

## 51.10 Policy / Evaluation loop

Memory policy는 one global controller가 아니다.

```text
local Policy Decisions
+ shared instrumentation
+ versioned Evaluation Views
```

Common lifecycle:

```text
POLICY DECISION
→ SEMANTIC / AUTHORITY / GOVERNANCE GATE
→ APPLICATION / EXPOSURE
→ DOWNSTREAM USE / OUTCOME
→ EVALUATION OBSERVATIONS
→ VERSIONED EVALUATION VIEW
→ SHADOW / REPLAY / POLICY PROMOTION
```

`Neural Memory Controller`는 optional implementation family다.

```text
rule / heuristic / LLM / classifier / learned model
```

모두 가능하다.

Reward / PU / survival / attribution은 canonical truth가 아니라 versioned derived Evaluation Views다.

```text
unobserved != negative
```

를 유지한다.

Shadow-All-Write는 instrumentation이고 human counterfactual truth가 아니다.

## 51.11 Governance / suppression / erasure

Governance는 cross-cutting authority다.

`forget`은 다음 네 semantics로 분해한다.

```text
CORRECTION
→ epistemic transition

WORLD UPDATE
→ temporal transition

EXPLICIT DO-NOT-USE
→ authoritative purpose-scoped Use Constraint

ERASURE
→ governed destructive operation
```

Explicit suppression은 learned accessibility score가 아니다.

```text
suppression active
→ Context Assembly hard gate
```

Governed erasure:

```text
INTENT / SCOPE RESOLUTION
→ SOURCE TARGET SELECTION IN OWNING DOMAINS
→ DERIVATION IMPACT PLAN
→ AUTHORIZATION
→ ERASE / REVOKE SOURCE
→ INVALIDATE / REBUILD DESCENDANTS FROM SURVIVORS
→ INVALIDATE CACHE / INDEX / QUEUE / LEARNED ARTIFACTS
→ NO-RESURRECTION BARRIER
→ VERIFY
→ CONTENT-FREE RECEIPT
```

삭제 영향 전파 authority는 Derivation / Dependency Provenance만 가진다.

Current Galpi task `deleted` lifecycle은 privacy erasure가 아니라 existing operational soft delete다.

## 51.12 Final MUST-STAY-SEPARATE list

```text
Evidence
!= Assumption
!= Derived State

Derivation Provenance
!= Semantic Association
!= Retrieval / Access Trace
!= Policy Decision Trace

Temporal Validity
!= Timeline Projection

Accessibility
!= Validity
!= Erasure

Projection
!= Source Evidence
!= Underlying Derived State
!= Working Set

Identity
!= Alias

Relationship Closeness
!= Conversational Salience

Routine Pattern
!= Skill Contract

Prediction
!= Prospective Intention
!= Skill

Skill Contract
!= Commitment State
!= Governance
!= Executor Capability

Operational Soft Delete
!= Governed Erasure

Learned Policy
!= Governance
!= User Truth
```

## 51.13 Allowed compositions that should remain cheap

분리는 silo를 의미하지 않는다.

다음 composition은 적극적으로 허용한다.

```text
EvidenceRef + Derivation Provenance
→ replay / truth maintenance / erasure impact

Semantic Association + Event Projection
→ Context Assembly expansion

Tiny User Core + Role/thread priors
→ typed privileged Context Assembly inputs

Commitment + Context Assembly
→ prospective relevance

Skill applicability + Prospective cue
→ shared condition-matching machinery

Owning-domain outcome events + Policy traces
→ Evaluation Views

Governance + existing replay/rebuild machinery
→ safe erasure propagation
```

핵심은:

> **Compose across boundaries; do not erase the boundaries.**

## 51.14 What this map does NOT decide

이 final map은 다음을 고정하지 않는다.

```text
number of runtime modules/services
number of SQLite tables
whether provenance uses SQL or a graph engine
exact Hypothesis schema
exact Projection interface
exact Context Assembly algorithm
exact learned policy model
exact erasure physical workflow
R3 experiment winners
```

따라서 이 map을 그대로 class/service diagram으로 번역하지 않는다.


---

# 52. R3 Experiment Set Reduction

> 상태: **R3 REDUCED QUEUE — P0 FEASIBILITY GATE ACCEPTED; POLICY WINNERS OPEN**
>
> 목적: R1에서 나온 모든 실험 아이디어를 병렬로 구현하지 않고,
> R2가 실제로 unresolved로 남긴 empirical questions만 최소 lane으로 줄인다.
>
> 기존 Locked Experimental Decisions D0~D6와 F1~F6는 유지한다.

## 52.1 Reduction principle

R3로 넘기는 질문은 다음 세 조건을 모두 만족해야 한다.

```text
1. semantic / authority contract만으로 답할 수 없다.
2. plausible alternatives가 실제 output / UX / correctness를 바꾼다.
3. 관측 가능한 comparison을 설계할 수 있다.
```

반대로 다음은 R3가 아니다.

```text
source of truth
identity semantics
Governance precedence
Skill != Commitment != Capability
suppression != accessibility
provenance != association
```

이런 항목은 이미 design contract다.

## 52.2 R3-P0 — Feasibility Preflight — **MANDATORY BEFORE R3-0**

R2 semantic closure를 다시 여는 단계가 아니다.

질문:

> **Does the current personal-use traffic generate enough informative cases to justify the planned R3 queue?**

F1 raw volume만으로 판단하지 않는다.

### P0.1 Online eligible volume

현재 read-only shadow/report 경로에서 가능한 한 먼저 측정한다.

```text
E = eligible requests / day
```

함께 기록:

```text
retrieval activation / abstention rate
context-size distribution
saturation rate
errors / missing traces
observation window length
```

이 값은 current production traffic의 feasibility input이지
memory quality 자체의 score가 아니다.

### P0.2 Historical evidence-set sensitivity

기존 A1b 77-query replay를 우선 재사용한다.

```text
ΔE = fraction of comparable queries
     whose retrieved evidence set differs between candidate policies
```

현재 `review:retrieval-policy` 계열처럼
same historical query / same temporal corpus / paired policy replay를 사용한다.

중요:

```text
evidence-set difference
!=
answer-level decision sensitivity
```

ΔE는 upper funnel signal이다.

### P0.3 Preliminary answer sensitivity

ΔE case에 대해서만 same-budget paired generation을 수행한다.

```text
ΔA = fraction of ΔE cases
     whose answer materially differs
```

`materially differs`의 exact rubric은 **paired answers를 보기 전에 preregister**한다.
최소한 style/wording-only 차이는 제외하고,
다음과 같은 memory-dependent output 차이를 대상으로 해야 한다.

```text
factual claim / remembered state
recommendation or chosen option
uncertainty / ambiguity handling
planned action / intervention
material rationale that changes downstream behavior
```

rubric 자체를 결과를 본 뒤 움직이지 않는다.

### P0.4 Informative-case throughput

Feasibility denominator:

```text
Projected informative cases / 28 days
= E × ΔE × ΔA × 28
```

여기서:

```text
E  = eligible requests / day
ΔE = evidence-set-sensitive fraction
ΔA = materially answer-sensitive fraction among ΔE cases
```

Activation rate를 별도 곱수로 중복 적용하지 않는다.
Eligibility/ΔE 정의 안에 실제 comparison funnel을 명시한다.

### P0.5 User-accepted preregistered gate

결과를 보기 전에 다음 project-feasibility cutoff를 고정한다.

```text
GREEN  >= 50 informative cases / 28 days
→ sequential online R3 queue is viable

AMBER  20..49 / 28 days
→ hybridize: offline replay + small online holdout
→ reduce parallel/one-variable queue
→ optional later lanes wait for more traffic

RED    < 20 / 28 days
→ do not execute the planned multi-lane online R3 queue
→ prioritize offline replay / targeted fixtures / data accumulation
→ defer optional mechanisms until evidence volume improves
```

이 숫자는 universal statistical truth가 아니라
**single-user research program feasibility cutoff**다.

강한 rule:

> **P0 may shrink, reorder, or defer R3 experiments; it does not reopen CLOSED R2 semantic/authority contracts.**

### P0.6 P0 receipt

P0 종료 시 최소 다음을 한 번의 read-only research receipt에 남긴다.

```text
observation window
E
historical comparable-query N
ΔE
paired-generation N
ΔA
projected informative cases / 28d
GREEN / AMBER / RED result
resulting R3 queue disposition
known measurement caveats
```

숫자가 낮아도 실패가 아니다.
그 경우 올바른 결과는 **실험 큐를 현실적인 데이터 속도에 맞게 줄이는 것**이다.

## 52.3 R3-0 — Instrument Validity Gate — **MANDATORY AFTER P0**

첫 실험은 policy winner를 찾는 실험이 아니다.

질문:

> **Can XION measure memory-policy quality well enough to trust later experiments?**

유지하는 locked setup:

```text
D0 hard-gated vs global-soft-prior routing
D1 cheap attribution all + sampled LOO
D2 shadow only
D3 same character budget, current baseline 8,000 chars
D4 false-memory as hard constraint
D5 explicit deterministic correction as high-precision user-detected incident signal
D6 Shadow-All-Write
```

D5의 역할을 정교화한다.

```text
explicit correction observed
→ high-precision incident / gold event

no explicit correction observed
→ NOT evidence that false-memory rate is low
```

사용자가 오류를 발견하고 정정할 확률이 unknown / selected이므로,
F4 correction frequency를 전체 false-memory-rate estimator로 사용하지 않는다.

필수 측정 F1~F7:

```text
F1 actual eligible request / retrieval volume
F2 position bias
F3 proxy vs sampled LOO agreement
F4 explicit correction incidents / sentinel behavior
F5 redundancy / marginal overlap
F6 multi-evidence interleaving validity research
F7 proactive memory-claim faithfulness audit
```

### F3 calibration rule

Proxy definition과 agreement metric이 아직 완전히 고정되지 않은 상태에서
임의의 숫자 threshold를 먼저 박지 않는다.

순서:

```text
small calibration pilot
→ freeze proxy definition + agreement metric
→ preregister acceptance threshold
→ evaluate on untouched holdout
```

결과를 본 뒤 threshold를 움직이는 것도 금지하고,
측정 정의가 없는 상태에서 arbitrary cutoff를 선행하는 것도 금지한다.

### F4 correction signal

F4는 다음을 본다.

```text
explicit deterministic corrections
policy/version/context linkage
incident severity / replayability
```

표본이 적으면:

```text
rate inference
→ DEFER

confirmed incident
→ immediate investigation / regression case
```

으로 사용한다.

### F7 proactive memory-claim faithfulness audit

D4+D5의 user-undetected false-memory blind spot을 줄이기 위해 추가한다.

sampled LOO / paired-answer batch에 대해
**사용자 반응과 독립적으로** memory-dependent claims를 검사한다.

Conceptual labels:

```text
SUPPORTED
UNSUPPORTED
CONTRADICTED
TEMPORALLY_STALE
NOT_MEMORY_DEPENDENT
```

Audit question:

> **Is this memory-dependent claim actually supported by the evidence/context that the reader was allowed to use?**

이는 world-truth benchmark가 아니다.

예:

```text
source: user said "I like X"
claim: "the user said/has expressed that they like X"
→ faithfulness question

claim: "X is objectively good"
→ not established merely by that memory evidence
```

Promotion / incident semantics:

```text
confirmed CONTRADICTED memory claim
→ hard incident
→ candidate policy promotion blocked pending investigation/regression test

UNSUPPORTED extrapolation
→ sampled false-memory / grounding-risk signal
→ track rate and examples; exact tolerance requires calibrated evaluation
```

F7 may reuse sampled LOO batches for cost efficiency,
but faithfulness and LOO contribution remain different measurements.

### R3-0 quantitative exit structure

`instrumentation blind spots are understood`만으로 PASS하지 않는다.

최소 exit structure:

```text
1. P0 has produced an explicit GREEN / AMBER / RED disposition.
2. F1 observation coverage is sufficient for that P0 disposition to be interpretable.
3. F3 proxy definition + agreement metric + preregistered threshold
   have passed an untouched holdout, OR proxy labels are not used downstream.
4. F4 is treated as an incident sentinel, not a denominator-free rate estimate.
5. F7 proactive faithfulness audit is runnable and confirmed contradictions
   can be traced back to exposed evidence / policy version.
6. paired replay can detect meaningful evidence-set / answer differences.
```

`blind spots`와 caveat는 receipt에 구체적으로 열거한다.

이 gate를 통과하지 못하면 learned routing/OPE 같은 후속 연구를 진행하지 않는다.

## 52.4 R3-1 — Retrieval / Context Assembly baseline — **FIRST POLICY COMPARISON**

Primary baseline remains:

```text
same request
same context budget

A: hard-gated retrieval
B: global-soft-prior retrieval
```

먼저 비교할 것:

```text
retrieval activation
relevant evidence-set difference
answer divergence
proxy contribution
sampled LOO contribution
F7 faithfulness / contradiction incidents
latency / context cost
```

여기서 routing winner를 고르는 것보다 중요한 것은:

```text
which requests are actually decision-sensitive to retrieval policy?
```

를 찾는 것이다.

## 52.5 R3-2 — Context Assembly value decomposition — **ONLY AFTER R3-1**

R3-1에서 retrieval policy가 실제 answer를 바꾸는 충분한 사례가 확인되면
Context Assembly 내부 mechanism을 하나씩 추가한다.

Recommended one-variable sequence:

```text
A. direct anchors only
   vs
   bounded context reconstruction

B. flat retrieval
   vs
   event / hierarchical cueing

C. direct only
   vs
   typed semantic-association expansion

D. age/frequency accessibility baseline
   vs
   opportunity-adjusted accessibility

E. No Core experimental baseline
   vs
   accepted product direction Tiny Stable Core
```

한 번에 `event + association + Core + accessibility`를 묶어 비교하지 않는다.

Event segmentation 자체도:

```text
retrieval / context benefit
```

을 보여줄 때만 architecture importance를 올린다.

## 52.6 R3-3 — Formation / Promotion / Maintenance — **SECOND REQUIRED MEMORY LANE**

Shadow-All-Write가 충분한 candidate coverage를 만든 뒤 비교한다.

First target:

```text
derived WRITE / PROMOTE
vs
NO_WRITE / KEEP AS SOURCE ONLY
```

후속 one-variable questions:

```text
candidate promotion threshold
Core promotion strictness
schema-congruent fast integration
vs replay-before-promotion

background consolidation trigger
vs event-boundary micro-consolidation trigger
```

고정 invariant:

```text
raw evidence always preserved
abstraction never replaces canonical episode/source
explicit correction privileged
high-impact revision replays canonical support/counterevidence
```

R3는 이 invariants를 trade-off하지 않는다.

## 52.7 R3-4 — Active Evidence Acquisition — **DATA / NEED TRIGGERED**

실제 unresolved ambiguities가 downstream behavior를 충분히 바꾸는 사례가 모일 때 시작한다.

Compare:

```text
DO_NOTHING / WAIT
NATURAL OBSERVATION
OPPORTUNISTIC ACQUISITION
EXPLICIT ASK
```

Candidate policy variables:

```text
cheap VOI approximation
answerability
interruption cost
question cooldown
identity-specific stricter gate
persistent discriminator value
```

다만:

```text
ambiguity may remain unresolved
identity false merge is fail-close
```

는 fixed contract다.

## 52.8 R3-5 — Skill / Prospective Action Policies — **FEATURE-TRIGGERED**

Skill/prospective infrastructure가 실제 사용량을 가질 때만 비교한다.

Skill:

```text
macro-first vs composition-first
explicit textual Skill Contract vs hybrid learned representation
promotion / transfer verification thresholds
```

Prospective:

```text
broad monitoring vs Context-Assembly-gated monitoring
structural cue only vs semantic cue evaluator
surface-all vs interruption-aware intervention
```

다음 경계는 실험 대상이 아니다.

```text
Skill != Commitment != Governance != Executor
```

## 52.9 R3-6 — Learned Policy / OPE — **LAST, SUPPORT-TRIGGERED**

다음이 먼저 충족되어야 한다.

```text
P0 feasibility supports enough informative cases
instrument validity
sufficient policy-decision volume
meaningful action overlap/support
valid exposure traces
observable delayed/censored outcomes
```

그 뒤에만:

```text
heuristic vs learned local policy
factorized local learners vs broader shared learned model
IPS / DR diagnostics
PU / survival Evaluation Views
```

을 비교한다.

강한 rule:

```text
support = 0
→ estimator cannot manufacture counterfactual truth
```

따라서 `Neural Memory Controller`를 먼저 구현하고 데이터를 나중에 맞추는 순서는 금지한다.

## 52.10 Reduced R3 execution order

```text
R3-P0 Feasibility Preflight
  ↓ GREEN / AMBER / RED disposition
R3-0  Instrument Validity Gate
  ↓ PASS
R3-1  Retrieval / Routing baseline
  ↓ enough decision-sensitive cases
R3-2  Context Assembly mechanism decomposition

parallel after sufficient Shadow-All-Write coverage:
R3-3  Formation / Promotion / Maintenance

triggered later by real use:
R3-4  Active Acquisition
R3-5  Skill / Prospective policies

last and support-triggered:
R3-6  Learned Policy / OPE
```

이 순서의 목적은:

```text
feasibility before queue commitment
instrumentation before optimization
simple policy before learned policy
one-variable experiments before architecture bundles
real use-case volume before subsystem-specific experimentation
```

이다.

## 52.11 Experiments explicitly removed from the immediate queue

다음은 흥미롭지만 지금 당장 experiment lane으로 만들지 않는다.

```text
new Projection type autonomous invention
one universal neural memory controller
specialist-specific truth stores
exact graph technology bake-off
physical unified Evidence Ledger
agent-internal durable commitment store
full ATMS / world lattice
exact retrieval-set action learning
```

이들은 이미 rejected/out-of-scope이거나,
concrete requirement가 없거나,
더 작은 experiment가 먼저 필요한 항목이다.

## 52.12 R3 exit target

R3의 목적은 모든 knob를 최적화하는 것이 아니다.

최소 성공 조건:

```text
1. P0 has shown that the retained experiment queue is feasible for current traffic,
   or the queue has been explicitly reduced to fit the measured traffic.
2. retrieval/context instrumentation is trustworthy enough.
3. at least one read-side policy direction is empirically justified.
4. derived write/promotion has an auditable conservative baseline.
5. false-memory constraints include both user-detected incidents (F4/D5)
   and proactive sampled faithfulness auditing (F7).
6. later learned-policy work has sufficient support or is explicitly deferred.
```

이 정도가 확보되면 minimal coherent architecture를
실험 가능한 baseline + swappable policy seams로 설계할 수 있다.


---

# 53. R3-P0 Measurement Contract — Code Reality Check

> 상태: **P0 MEASUREMENT CONTRACT — ACCEPTED FEASIBILITY GATE, IMPLEMENTATION HANDOFF READY**
>
> 기준 Galpi `main`: `71025861d07521f88c21b8c88360280ec6f3c604`.
>
> 목적: §52의 P0를 실제 current Galpi trace/replay 코드에 연결하면서,
> 기존 도구를 잘못 해석해 feasibility 숫자를 오염시키지 않도록 측정 계약을 고정한다.

## 53.1 Current-code finding — default shadow report does not measure current A2 traffic

현재 regular text-chat retrieval trace는 `getContextNotesForQuestion(...)`에서 기록되고,
mode는 개념적으로:

```text
chat:<runtimeGeneration>:a2
```

형태를 가진다.

반면 기존 `report:retrieval-shadow`의 default report는:

```text
mode LIKE '%:a1b'
```

만 포함한다.

따라서:

> **Do not use the default A1b report as current F1 / P0 online traffic.**

P0.1은 명시적으로 current text-chat A2 modes를 집계해야 한다.

Scope:

```text
include: regular text-chat retrieval invocations ending in :a2
exclude: retired council replays, manual preview calls, unrelated modes
```

Realtime/voice context lookup은 current trace path와 동일하게 기록되지 않을 수 있으므로
P0 v1의 traffic scope는 **regular text chat**으로 고정한다.
Voice memory evaluation은 별도 instrumentation이 생기기 전까지 P0 denominator에 조용히 섞지 않는다.

## 53.2 P0.1 fixed observation window

Accepted feasibility gate가 28-day throughput을 사용하므로
online volume도 moving denominator를 피하기 위해 다음으로 고정한다.

```text
observation window = most recent 28 complete calendar days
E = eligible regular-text-chat A2 retrieval invocations / 28
```

함께 보고:

```text
runs by runtime generation
active/selected-memory runs
abstentions
errors
missing query hashes
context-char distribution
saturated runs
```

같은 query text가 여러 번 실제 사용되었다면 각각 별도 eligible request다.
F1 volume에서는 query hash로 deduplicate하지 않는다.

Logging outage / mode discontinuity가 window를 오염시키면
그 기간을 임의로 삭제해서 rate를 높이지 말고 coverage caveat를 명시한다.

## 53.3 Current-code finding — existing `changedQueries` is NOT D0 sensitivity

기존 `review:retrieval-policy`는 historical queries를 point-in-time에 가깝게 재생하지만,
현재 `baseline`과 `replacement`는 둘 다 `buildGlobalShadowRetrieval(...)`을 사용하고
legacy/current threshold configuration을 비교한다.

즉 기존 `changedQueries`는:

```text
legacy global-soft policy
vs
current conservative global-soft policy
```

의 차이다.

R3 D0는:

```text
hard-gated retrieval
vs
global-soft-prior retrieval
```

이므로:

> **Existing `changedQueries` must not be reported as P0.2 D0 sensitivity.**

P0.2는 같은 historical query / same temporal corpus / same context budget에서
실제 D0 두 retrieval paths를 별도로 replay해야 한다.

## 53.4 Retrieval sensitivity variable refinement — `ΔR`, not ambiguous `ΔE`

기존 문서의 `ΔE`(evidence-set-sensitive fraction)는 구현상 애매하다.
현재 review code의 `changedQueries`는 ordered chunk-ID list를 비교하므로
membership은 같고 order만 달라도 changed로 센다.

모델이 실제로 받는 것은 unordered set이 아니라 bounded ordered context다.
따라서 P0에서는 primary variable을 다음으로 정교화한다.

```text
ΔR = retrieval-context-sensitive fraction
   = fraction of comparable historical queries
     whose final bounded retrieval context presented to the reader differs
```

가능하면 final injected retrieval-context string 또는 deterministic canonical form의 hash를 비교한다.

진단 breakdown은 별도 보고한다.

```text
ACTIVATION_CHANGE
- one side abstains, the other exposes memory

MEMBERSHIP_CHANGE
- exposed chunk membership differs

ORDER_ONLY_CHANGE
- same chunk membership, different order

SAME_VISIBLE_CONTEXT
- no reader-visible retrieval difference
```

score-only difference가 reader-visible context를 바꾸지 않으면 `ΔR`에 포함하지 않는다.

§52의 throughput formula는 의미상 다음으로 읽는다.

```text
Projected informative cases / 28d
= E × ΔR × ΔA × 28
```

기존 `ΔE` 표기는 이 `ΔR`의 초기 working name으로 supersede한다.

## 53.5 P0.2 exact comparison contract

Historical replay의 두 arms:

```text
A. HARD-GATED
- current hard-gated retrieval semantics
- candidate note gate first
- only gated-note chunks eligible for final bounded context

B. GLOBAL-SOFT-PRIOR
- current global soft-prior semantics
- global ready temporal chunk candidates
- note relevance remains soft prior, not eligibility gate
```

고정해야 하는 것:

```text
same historical query
same query embedding
same explicit active-note inputs where recoverable
same temporal cutoff
same source corpus
same current D0 limits except the gating difference
same final context character budget
no writes
```

Historical trace에 explicit active notes가 있으면 두 arms에 동일하게 적용한다.
Active-note state를 복원할 수 없는 query는 숨기지 말고 caveat/count로 보고한다.

## 53.6 Point-in-time replay caveat — note embedding leakage

기존 77-query replay는 future-created chunks를 temporal cutoff로 제외하고
historical topic body를 재구성하는 강점이 있다.

하지만 current note embedding을 그대로 재사용한다면,
query 이후 추가된 topic content의 영향이 note-ranking prior에 남을 수 있다.

P0는 policy winner를 정하는 실험이 아니라 feasibility preflight이므로
첫 pass에서 이를 **known approximation**으로 사용할 수 있다.

다만 다음 경우에는 GREEN/AMBER/RED를 강제로 확정하지 않는다.

```text
measurement caveat or plausible replay leakage
could move projected throughput across a gate boundary
```

그 경우:

```text
status = INDETERMINATE
→ refine point-in-time note ranking / embedding for boundary-sensitive cases
→ rerun P0 before queue disposition
```

> **Accepted cutoff does not justify false precision.**

## 53.7 P0 execution split — measure first, generate second

P0를 한 번에 큰 tool로 만들지 않는다.

### P0-A — zero/low-cost read-only measurement first

```text
P0.1 online E over fixed 28-day text-chat A2 window
P0.2 historical D0 ΔR over the existing replayable query corpus
```

No production mutation.
No new learned model.
No answer generation required.

Output determines how many historical cases actually require P0-B.

### P0-B — paired answer sensitivity only for ΔR cases

Only if P0-A finds reader-visible retrieval differences:

```text
same historical request
same non-memory context / history reconstruction
same fixed model snapshot
same reasoning setting
same tool policy
same final memory budget
only D0 retrieval context differs
```

Then estimate:

```text
ΔA = materially answer-sensitive fraction among ΔR cases
```

Material-difference rubric is preregistered in §52.2.
Style-only differences do not count.

P0-B must not perform normal conversation/topic/task writes.
Generated outputs are research artifacts only unless separately approved.

## 53.8 P0-A completion receipt

Before implementing P0-B, P0-A must produce a compact receipt containing:

```text
baseline commit
production DB observation window
included mode pattern(s)
excluded modes
eligible runs
E / day
activation / abstention
errors / missing hashes / saturation
historical comparable query count
D0 ΔR count/rate
activation-change count
membership-change count
order-only-change count
point-in-time caveats
number of cases forwarded to P0-B
```

No GREEN/AMBER/RED classification is made until `ΔA` exists.

## 53.9 Minimal-change implementation rule

P0 is research instrumentation, not a production memory feature.

Prefer:

```text
existing readonly DB access
existing retrieval functions
existing temporal replay logic
new opt-in research script / helper only where required
```

Avoid:

```text
schema migration
production write path changes
retrieval policy changes
A2 behavior changes
new runtime flag
new long-lived telemetry field unless P0 proves it is necessary
```

If existing scripts need reusable extraction helpers,
refactor only the minimum necessary and preserve current CLI/output compatibility.

## 53.10 P0-A go/no-go

Implementation may proceed without another product decision.

Next user decision occurs only if:

```text
P0 measurement cannot resolve GREEN / AMBER / RED without changing a semantic/product contract
OR
P0-B material-difference rubric proves ambiguous in a way that changes the result
```

Otherwise the preregistered §52 gate controls the queue disposition.
