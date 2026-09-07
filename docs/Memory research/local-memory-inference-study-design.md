# XION Local Memory Inference Study Design

> Status: **CANONICAL STUDY DESIGN --- PILOT SCOPE AND PRIMARY BASELINE
> CLOSED; EMPIRICAL RESULTS OPEN**
>
> Baseline: Galpi `main` at `d853725ac45a487ae4adf5cb3a809fea017ef73b`
> (2026-08-30 review)
>
> Relationship to memory architecture: This study evaluates **execution
> placement** for recurring memory-processing workloads. It does not
> reopen the CLOSED semantic, authority, provenance, or source-of-truth
> contracts of the XION long-term memory architecture.

## 1. Motivation

XION/Galpi is a persistent personal AI system whose memory layer
performs work beyond direct user-facing chat. Some recurring operations
are narrow, structured, and potentially suitable for small always-on
local models; other operations require stronger reasoning, larger
context, or stricter authority handling and may remain better suited to
cloud models or deterministic code.

The systems question is therefore not whether a small local model can
replace the main assistant. It is whether local inference can provide a
useful **continuous memory-processing layer** that handles a meaningful
fraction of recurring work while selectively escalating cases that are
uncertain, ambiguous, high-impact, or otherwise outside the local
model's safe operating region.

This study is intentionally vendor-neutral. Hardware is described by
measurable properties such as usable memory, latency, sustained compute,
concurrency impact, and power behavior. Model families, accelerators,
and specific machines are test platforms rather than architectural
commitments.

A useful result does not require local inference to win. Valid outcomes
include local processing being useful only for a narrow workload,
deterministic code outperforming model inference, cloud-only execution
remaining preferable, or hardware upgrades being valuable for Galpi
operations without providing enough local-memory-inference value to
justify the inference layer.

## 2. Research Question

Primary question:

> **Can small local models provide a useful always-on processing layer
> for recurring XION memory workloads, with selective escalation to
> stronger cloud models?**

The study compares three execution policies:

  -----------------------------------------------------------------------
  Policy                  Definition              Role
  ----------------------- ----------------------- -----------------------
  **CLOUD-ONLY**          Eligible workload is    Primary operational
                          processed by the        baseline
                          experiment-time XION    
                          production cloud model. 

  **LOCAL-ONLY**          Eligible workload is    Failure-boundary and
                          processed locally with  capability measurement
                          no cloud rescue in the  
                          research/shadow path.   

  **LOCAL-FIRST +         Local processing        Main hybrid hypothesis
  SELECTIVE CLOUD         handles cases inside    
  ESCALATION**            its accepted operating  
                          region; designated risk 
                          or uncertainty signals  
                          escalate to cloud.      
  -----------------------------------------------------------------------

The hybrid policy is the main research target, not a predeclared winner.

For the primary CLOUD-ONLY baseline, the exact production cloud model
identifier and relevant reasoning/settings must be snapshotted at
experiment time. Cloud output is a comparison arm, **not ground truth**.
Semantic gold labels come from human adjudication; deterministic or
programmatic gold is used where the task permits it. A stronger
secondary cloud model may flag possible disagreements or assist review
on high-risk subsets when useful, but is not required on every case and
does not become ground truth.

## 3. Non-goals and Fixed Contracts

This study does **not**:

-   redesign the XION memory architecture;
-   create a new local-memory subsystem or a second truth model;
-   make model confidence an authority mechanism;
-   allow derived interpretation to replace source evidence;
-   collapse Skill, Commitment, Governance/Authorization, or Current
    Capability into one model-owned state;
-   use local inference to bypass existing stricter gates for identity,
    correction, Core promotion, governance, or other high-impact
    mutations;
-   select a hardware vendor or product before workload requirements are
    measured;
-   treat accelerator headline throughput as equivalent to real LLM
    workload performance;
-   optimize general chatbot quality;
-   count unrelated home-lab utility as evidence that local memory
    inference succeeded.

The existing memory contracts remain authoritative. In particular,
source evidence and derived interpretation remain distinct; provenance
and dependencies remain inspectable; explicit correction remains
privileged; identity ambiguity remains fail-close; and high-impact
derived-state revision must preserve the architecture's
support/counterevidence requirements.

Local/cloud placement is an **execution and policy choice** underneath
those contracts.

## 4. Candidate Workloads

### 4.1 Pilot workloads

The first pilot is deliberately limited to three workloads.

  ------------------------------------------------------------------------
  Workload         Local hypothesis Principal failure     Pilot
                                    concern               
  ---------------- ---------------- --------------------- ----------------
  **Structured     Small models may Hallucinated fields,  Yes
  information      reliably convert omitted facts,        
  extraction**     bounded source   source/derived        
                   text into a      confusion             
                   constrained                            
                   schema.                                

  **Derived        Local inference  False NO_WRITE that   Yes, triage only
  write/no-write   may safely       suppresses useful     
  candidate        remove obvious   memory formation;     
  triage**         NO_WRITE cases   local model becoming  
                   and reduce cloud durable-write         
                   calls.           authority             

  **Ambiguity /    Local inference  False CLEAR on        Yes
  escalation       may identify     genuinely ambiguous,  
  detection**      CLEAR versus     conflicting,          
                   ESCALATE cases   identity-sensitive,   
                   cheaply.         or high-impact cases  
  ------------------------------------------------------------------------

For write/no-write, the local model is a **candidate triage layer**, not
the sole authority for durable memory mutation. The pilot evaluates an
asymmetric hybrid policy: obvious NO_WRITE may terminate the
**counterfactual hybrid decision path**, while possible WRITE or risky
cases escalate. Pilot termination never mutates production memory and
does not suppress the cloud reference call needed for evaluation.
Potential cloud calls avoided are therefore reported counterfactually
until a later production decision explicitly authorizes otherwise.

For ambiguity handling, the local task is not to resolve ambiguity. It
is to decide whether the case is safe enough to continue locally or must
be escalated. False negatives are therefore especially costly.

### 4.2 Phase 1b candidate: retrieval/routing assistance

Retrieval/routing is deferred from the initial pilot.

Current Galpi retrieval already has deterministic keyword/embedding
logic and bounded context assembly behavior. In addition, exact
historical point-in-time comparison is limited by earlier telemetry that
did not preserve whether active-note state was truly empty versus
unobserved. Newer telemetry fixes that distinction prospectively but
cannot reconstruct missing history.

Retrieval/routing should therefore enter Phase 1b after enough exact
traces accumulate. Its controls should include the current
deterministic/embedding pipeline and, where appropriate, a specialized
small reranking model. A generative local model must demonstrate value
over those simpler controls rather than being assumed useful.

### 4.3 Deferred workloads

Lightweight contradiction/change detection may be tested later, partly
as an extension of ambiguity/escalation. Consolidation and abstraction
are deferred because they combine longer context, deeper semantic
judgment, and higher error cost. Pure structured formatting or
projection preparation should remain deterministic when no semantic
judgment is required.

## 5. Local, Cloud, and Escalation Hypotheses

### H1 --- Narrow local competence

At least one pilot workload has a bounded operating region in which a
small local model achieves acceptable task quality with operationally
useful latency and resource use.

### H2 --- Asymmetric hybrid value

The best local role may be filtering easy cases rather than
independently deciding difficult ones. A hybrid cascade may preserve
quality by ending locally only on low-risk cases and escalating
uncertain or consequential cases.

The production-candidate ordering is **hard-gate first**. Cases that
existing XION contracts already require to follow a stricter path do not
enter the local-completion policy at all. They may be run through a
local model separately as a capability probe, but those results are
excluded from hybrid-policy completion metrics.

Conceptually:

``` text
input
  |
deterministic hard risk / contract gates
  |-------------------------------> required stricter/cloud path
eligible low-risk candidate
  |
local task inference
  |-------------------------------|
obvious low-risk result       uncertain / risky
  |                               |
local completion              cloud escalation
  |                               |
  +------------> existing validators / authority boundaries
```

### H3 --- Escalation beats raw local confidence

Escalation quality will depend more on explicit task-specific signals
and deterministic risk conditions than on uncalibrated self-reported
model confidence.

Candidate escalation signals include:

-   invalid or unverifiable structured output;
-   ambiguity or insufficient context;
-   conflict with available evidence;
-   identity ambiguity;
-   explicit user correction;
-   possible Core promotion;
-   high-impact mutation;
-   authority-sensitive consequence;
-   complex consolidation or multi-source reasoning;
-   task-specific abstention/uncertainty signal.

These signals may be refined empirically. Existing stricter gates remain
authoritative regardless of local confidence.

### H4 --- Smallest-sufficient model class exists, or the hypothesis fails

The study should search for the **smallest sufficient** local model
rather than maximize benchmark quality. The initial scale probe should
progress approximately from sub-1B to \~2B to \~4B, and only then to
\~7--8B if smaller classes fail. A larger class is justified only when
the smaller class fails a predefined quality or operating criterion.

After a viable size class is found, a limited cross-family check may
test whether the result is family-specific. Exhaustive family × size ×
quantization benchmarking is out of scope.

## 6. Metrics

Metrics are workload-specific; no single aggregate score is sufficient.

### 6.1 Quality

Possible measures include precision, recall, F1, false-positive rate,
false-negative rate, exact/schema-valid extraction rate, cloud
agreement, and human adjudication.

False-memory errors must be categorized rather than hidden inside
aggregate accuracy. At minimum, analysis should distinguish invented
information, omitted relevant information, incorrect write/no-write
suppression, unsafe non-escalation, identity confusion, unsupported
conflict resolution, and source/derived-state confusion when applicable.

For ambiguity/escalation, recall on cases that truly require escalation
is a primary safety-oriented measure. For write/no-write triage, false
NO_WRITE requires separate reporting because it can silently suppress
useful memory formation.

### 6.2 Runtime and coexistence

Runtime criteria depend on the workload's execution semantics.

For latency-sensitive synchronous work, measure end-to-end task latency,
including preprocessing and validation, and p95 latency. Time to first
response/token may also be primary when it materially affects the
workload.

For asynchronous or background work, measure:

-   the workload deadline or maximum useful completion window;
-   time to completion;
-   queue wait time where applicable;
-   queue throughput and drain rate;
-   backlog growth under a sustained realistic arrival rate;
-   coexistence impact on normal Galpi operation.

Across both classes, measure generation throughput when generation is a
meaningful component, model load and residency cost, peak and steady
RAM/VRAM/shared-memory use, swap or memory-pressure behavior, and
concurrent impact on normal Galpi service latency and stability.

A model that is fast in isolation but materially degrades the persistent
assistant is not an always-on success.

A background task is not automatically worse because it takes longer in
wall-clock time. It remains operationally acceptable when it comfortably
meets its workload deadline, drains at least as fast as realistic work
arrives, does not accumulate backlog, and does not materially harm normal
Galpi operation. Numerical latency, deadline, queue, and coexistence
thresholds remain **OPEN** during pilot calibration and must be frozen
before held-out full evaluation.

### 6.3 System value

For each policy and workload, report:

-   fraction completed locally;
-   escalation rate, escalation recall where applicable, and escalation
    reasons;
-   workload-frequency-weighted local completion using observed
    incidence under the contract in Section 8.2;
-   counterfactual cloud calls avoided during shadow/pilot evaluation;
-   estimated cloud cost avoided;
-   quality change versus CLOUD-ONLY and adjudicated gold;
-   additional local latency;
-   always-on feasibility under realistic Galpi coexistence.

The study-level success criterion is not a raw local-completion
percentage. It is the joint result of **quality preservation +
workload-weighted cloud reduction + always-on operational feasibility**.
Cost savings should never be reported without the corresponding quality,
frequency, escalation, and operational behavior.

### 6.4 Hardware efficiency

Where measurement is available, collect idle power, inference power,
sustained thermals, and energy per completed workload. If reliable
instrumentation is unavailable, these remain explicitly **OPEN** rather
than being replaced with guessed values.

## 7. Hardware Requirements

The study does not set a fixed RAM, latency, or power number before
pilot measurements establish what the workload actually requires.

A candidate always-on node must provide:

1.  **Usable memory headroom** sufficient for the smallest-sufficient
    quantized model, runtime/KV working memory, and normal Galpi
    services without sustained swap.
2.  **Workload-specific runtime behavior** that meets synchronous p95
    targets or background completion, queue-drain, and backlog criteria
    established from pilot observations.
3.  **Acceptable residency behavior**, so repeated model reloads do not
    erase the operational benefit.
4.  **Galpi coexistence**, with bounded degradation of server,
    retrieval, tools, voice, and automation paths.
5.  **Sustained thermal stability** appropriate for continuous operation
    rather than short benchmark bursts.
6.  **Measurable efficiency** where instrumentation permits power and
    energy comparisons.
7.  **Optional accelerator support** only when the selected
    model/runtime path actually supports that accelerator efficiently.

The full experiment should translate these into numerical requirements
only after the smallest-sufficient model class and workload-specific
runtime envelope are known.

## 8. Pilot Design

The pilot answers two questions only:

1.  Is useful local inference plausible for any of the three selected
    workloads?
2.  Where does local inference begin to fail badly enough that
    escalation or a larger model is required?

It does **not** choose the final production architecture. The pilot is a
**calibration stage**. After pilot analysis, workload-specific semantic
and operational acceptance thresholds are frozen in the experiment
configuration before the held-out full experiment begins.
Full-experiment results must not be used to move those thresholds.

### 8.1 Data

Use two stages:

**Stage A --- synthetic calibration fixtures.** Construct privacy-safe
cases with known labels and deliberately include easy, boundary,
ambiguous, conflicting, correction, and malformed-output cases. Use
these to validate the harness and eliminate clearly insufficient model
classes cheaply.

**Stage B --- private natural XION replay.** Evaluate surviving
configurations on representative historical or newly collected XION
cases without mutating production state. Raw personal data remains
private and is not included in public artifacts.

For semantic tasks, human adjudication is the primary gold source. Where
reasonable, label intrinsically ambiguous cases as
ambiguous/adjudication-needed rather than forcing a single answer.
Programmatic checks should validate schema, source grounding, allowed
labels, and other deterministic constraints.

Primary human adjudication remains authoritative where deterministic or
programmatic gold is unavailable. Boundary, high-risk, ambiguous, and a
sample of ordinary cases should receive a blind second-pass review where
practical; the second pass must not expose the first label. Record
disagreements explicitly and resolve them by reviewing the underlying
evidence. A stronger cloud model may flag possible disagreements or
assist that review, but its suggestions never overwrite human labels
automatically and never become ground truth. Report adjudication
disagreement and revision rates where sample size permits. Cases that
remain intrinsically ambiguous may retain `AMBIGUOUS` or
`ADJUDICATION_NEEDED` rather than being forced into a binary label.

### 8.2 Workload-frequency observation contract

Before making system-value claims, the study must estimate the real XION
occurrence rate of each eligible workload. Synthetic calibration balance
and replay-set composition measure evaluation coverage; they **MUST NOT**
be used as workload-frequency weights for local completion, cloud
reduction, cost, or study-level value claims. Those weights come from
observed XION workload incidence under a defined observation contract.

For each workload, that contract must record:

-   the workload classification and version, plus occurrence count by
    workload type;
-   the observation window with exact start and end boundaries and any
    known gaps or coverage changes;
-   eligible opportunities separately from model calls that were
    actually executed;
-   cases rejected by existing hard gates separately from cases eligible
    for local inference;
-   a per-day or otherwise justified normalized occurrence rate and the
    distribution across days, rather than only one aggregate mean;
-   a content-safe event or trace reference sufficient to map an
    observation back to its workload classification without exposing
    private raw content;
-   observed production frequency separately from synthetic or replay
    evaluation-set composition.

The required observation-window duration is **OPEN** because the current
evidence does not establish an appropriate duration for these three
workloads. The duration, coverage rule, and boundaries must be frozen
before system-value evaluation. If historical telemetry cannot reliably
reconstruct a workload's occurrence rate, report the estimate as
`UNAVAILABLE` or `INCOMPLETE` and collect prospective instrumentation;
do not silently infer production frequency from partial traces or from
the evaluation set.

### 8.3 Execution controls

All compared configurations receive the same task input and the same
evidence available under the experiment's point-in-time rules.

Before generative-model evaluation, each pilot workload must define the
cheapest reasonable non-generative or specialized control when one
exists. The control should be the simplest plausible alternative for the
task, such as deterministic parsing/schema validation, a rule or
heuristic classifier, existing Galpi deterministic logic, an
embedding/similarity method, or a specialized classifier/reranker where
appropriate. Do not invent an elaborate baseline merely to create
competition. If no meaningful control exists, record `NONE JUSTIFIED`
with the reason.

The pilot comparison is therefore the cheapest sufficient method versus
local generative inference versus the cloud or hybrid policy, not merely
local LLM versus cloud LLM. A local generative model is useful only if it
adds value relative to both the primary cloud baseline and the simplest
sufficient alternative. These controls do not bypass the existing
deterministic or authority gates, which remain authoritative and run
before local inference. This requirement does not move retrieval/routing
into the initial pilot; its existing deterministic/embedding controls
remain part of Phase 1b.

The harness must record enough metadata to reproduce a result:
workload/version, case identifier, model/configuration identifier,
quantization where applicable, runtime version/commit, prompt/schema
version, timing, resource observations, output, validation result,
escalation reason, and adjudicated label.

Structured output constraints may be used to reduce formatting variance,
but parser/schema validation outside the model is authoritative. Invalid
structured output counts as a local failure or escalation trigger;
constrained decoding is not assumed to make semantic output correct.

### 8.4 Scale probe

Run the smallest model class first. Advance a workload to the next size
class only when the smaller class fails a quality, escalation, or
operational criterion. Stop increasing model size when a class is
sufficient or when local execution is no longer operationally
attractive.

Measure the capability boundary per workload first. Kill workloads that
require an impractically large local model or otherwise fail the pilot.
Only then identify the smallest practical shared model capable of
serving the surviving local workloads.

The pilot should avoid a combinatorial benchmark matrix. The goal is a
failure boundary and a practical shared deployment candidate, not a
leaderboard.

### 8.5 Pilot outputs

For each workload, produce:

-   the simplest plausible control, or `NONE JUSTIFIED` with its reason,
    and its result alongside model policies;
-   quality and error breakdown by model class;
-   local completion versus escalation behavior;
-   workload-appropriate runtime and memory observations;
-   notable failure cases;
-   observed workload-frequency coverage, with unavailable or incomplete
    estimates identified explicitly;
-   smallest model class worth carrying into the full experiment, if
    any.

A workload may be killed from local inference at this stage.

## 9. Full Experiment

Only workloads that survive the pilot proceed.

Before the full experiment begins, the pilot-derived acceptance
thresholds, prompts/schemas, escalation rules, eligible workload set,
workload-frequency observation contract, and candidate configurations
used for final judgment must be frozen.

The full experiment should compare CLOUD-ONLY, LOCAL-ONLY, and
LOCAL-FIRST + SELECTIVE CLOUD ESCALATION on a larger private replay set
with a held-out final-evaluation partition not used to tune prompts,
thresholds, workload eligibility, or escalation rules.

The primary cloud baseline is the production XION cloud model
snapshotted at experiment start. Human/programmatic labels remain gold.
A second stronger cloud model may flag possible disagreements or assist
evidence review on selected disagreements or high-risk subsets, but it
cannot overwrite human labels or become ground truth.

For a viable local size class, run a small cross-family comparison to
test robustness. Hardware-specific optimized runtimes may then be
compared with the common baseline runtime. Exact runtime and model
artifacts must be pinned.

The full experiment should also run sustained coexistence tests with
Galpi active. Short isolated inference benchmarks are insufficient for
an always-on claim.

Retrieval/routing may join this stage or a preceding Phase 1b once
sufficient exact point-in-time traces exist. Historical traces lacking
the required active-state observability must not be presented as exact
routing gold.

## 10. Decision Rules

A local workload is accepted only if it satisfies **both semantic and
operational criteria**. Exact numeric thresholds are intentionally OPEN
during the pilot. After pilot calibration they must be **frozen before
held-out full evaluation** and may not be relaxed or retuned in response
to full-experiment results.

Study-level acceptance of a local inference layer requires evidence of
all three: **quality preservation, meaningful cloud reduction weighted
by observed workload incidence under Section 8.2, and always-on
operational feasibility**. No single raw local-completion percentage is
sufficient.

Correct escalation is an intended LOCAL-FIRST outcome. It is evaluated
as policy success when the case should be escalated, while unnecessary
escalation is recorded as an efficiency loss. Direct local task
capability and hybrid escalation-policy capability must remain separate
in reporting.

Possible final outcomes are:

  ---------------------------------------------------------------------
  Outcome                            Interpretation
  ---------------------------------- ----------------------------------
  **LOCAL-FIRST accepted for         Local processing handles a
  workload**                         meaningful low-risk region with
                                     acceptable quality and resource
                                     use; escalation preserves
                                     difficult cases.

  **LOCAL-ONLY accepted for narrow   Local quality is sufficient
  workload**                         without cloud rescue for that
                                     specific bounded task.

  **Extraction/classification only** Local inference is useful, but
                                     only for narrow
                                     preprocessing/triage.

  **Deterministic/specialized        A simpler method provides equal or
  control wins**                     better value; generative local
                                     inference is rejected for that
                                     workload.

  **CLOUD-ONLY retained**            Local quality, latency, resource
                                     use, or complexity does not
                                     justify the layer.

  **Hardware-limited /               The workload appears plausible but
  inconclusive**                     the tested node cannot establish a
                                     fair always-on operating point.

  **Home-lab value only**            New hardware helps Galpi
                                     operations but local memory
                                     inference itself does not meet
                                     acceptance criteria. This is not a
                                     positive study result.
  ---------------------------------------------------------------------

Escalation policy should fail closed on cases covered by fixed XION
authority or semantic boundaries. A model's confidence score cannot
convert a contractually high-risk case into a local-only case.

## 11. Open Questions

The following remain empirical and should not be fixed before the pilot:

-   exact quality gates per workload;
-   acceptable synchronous p95 latency, background completion deadlines,
    queue/backlog behavior, and concurrent Galpi degradation;
-   workload-frequency observation-window duration and coverage rule;
-   minimum useful local-completion fraction;
-   acceptable escalation efficiency and minimum required escalation
    recall by workload;
-   whether calibrated uncertainty adds value beyond deterministic risk
    signals and abstention;
-   smallest sufficient model class for each workload;
-   quantization sensitivity;
-   residency versus on-demand loading tradeoff;
-   numerical RAM/VRAM/shared-memory requirement;
-   idle/inference power and energy-per-workload thresholds;
-   whether retrieval/routing benefits from generative local inference
    at all;
-   whether contradiction/change detection deserves a separate workload
    after ambiguity results are known.

These questions are experiment outputs, not reasons to reopen the
underlying memory architecture.

------------------------------------------------------------------------

## Canonical Study Boundary

The study succeeds by producing evidence about **where computation
should run**, not by changing what XION memory means.

The final architecture may therefore be cloud-centered, local-first,
mixed by workload, or mostly deterministic. Any of those outcomes is
acceptable if supported by measured quality, failure modes, operational
cost, and the existing XION memory contracts.

## Pilot P0 instrumentation implementation

Pilot P0 uses the schema v24 SQLite table
`research_memory_inference_observations` as a research observation
ledger. It is telemetry only: it is not memory evidence, derived memory,
or production decision authority. Rows contain bounded workload and
gate metadata, timestamps, execution status, versions, and a hash of
non-content event identifiers. They do not contain user or assistant
text, memory contents, prompts, extracted facts, or model output.

The prospective production observation point is the automatic derived-
memory candidate boundary after the chat exchange has been saved.
Write/no-write triage and ambiguity/escalation are opportunities for
every ordinary candidate that passes the current production eligibility
guards. Structured extraction is an opportunity only when the existing
auto-save classifier already selected the memory-formation/save path;
NO_WRITE decisions do not create structured-extraction ledger rows.
Voice auto-save exclusion, schedule candidates, and temporary attachment
context are recorded as hard-gated triage and ambiguity/escalation
opportunities with
`guard_scope=current_production_eligibility`; that label describes the
current product path and does not promote those guards into permanent
architecture contracts. Contract-level gate reasons use the separate
`guard_scope=contract_level` namespace.

Private natural replay files must use the ignored
`fixtures/local-memory-inference-private*.json` pattern. Repository-
tracked pilot fixtures are synthetic and are validated separately.

Workload-frequency reporting is read-only and requires an explicit KST
half-open calendar window:

```bash
npm run report:memory-inference-pilot -- \
  --since YYYY-MM-DD --until YYYY-MM-DD
```

The default report is `INCOMPLETE` because the ledger alone cannot prove
service/logging coverage or recover failed telemetry writes. It never
estimates missing incidence, and synthetic/private replay composition is
never included in observed-production frequency. `COMPLETE` may be
declared only when an independent log review found exactly zero
instrumentation failures and the window contains only the current coherent
ledger/instrumentation contract. The report surfaces both current and
observed contract versions. P0 invokes no local model and changes no
production memory or retrieval decision.

## Pilot P1-A local runtime bring-up

P1-A is an offline synthetic-fixture smoke path. It sends the tracked
PilotCase fixture to a separately running OpenAI-compatible llama.cpp
HTTP endpoint, validates the returned JSON outside the model, constructs
a `LOCAL_ONLY` PilotResult, and runs the result through the shared result
validator. The command neither downloads nor manages a runtime, and it
does not read or write the production database, Vault, memory path, or
`server.js` flow.

Start the runtime separately, record its exact version/artifact, then run:

```bash
npm run research:memory-inference-smoke -- \
  --endpoint http://127.0.0.1:8080/v1 \
  --model MODEL_ID \
  --artifact ARTIFACT_OR_REVISION_ID \
  --quantization QUANTIZATION_ID \
  --runtime-version RUNTIME_VERSION_OR_COMMIT
```

The JSON stdout report records the Galpi commit and bounded model,
artifact, quantization, runtime, runner, prompt, task, and output-schema
versions. Repository-tracked input remains synthetic; private replay
fixtures continue to use the ignored P0 path and are rejected by this
tracked-fixture smoke command. Hard-gated cases are labeled capability
probes and never counted as LOCAL-FIRST completion opportunities.

P1-A is plumbing and capability evidence only. Latency observed on an
Intel Mac during bring-up is a development observation and is not final
evidence that an always-on target device is operationally feasible. It
does not freeze a model family, prompt, threshold, deadline, or hardware
acceptance criterion.

### First real-runtime bring-up receipt

This receipt records a manually executed local development run, not a
GitHub CI result.

-   Galpi commit:
    `8773445a4c2f40e15e977ee4ce93e9dbb0ff317e`
-   llama.cpp runtime commit:
    `e42214804794fca6abb61b1a5f9adae2a845f0be`
-   environment: Intel Mac development host, external llama.cpp HTTP
    server, CPU-only execution with `--n-gpu-layers 0`
-   model ID and artifact ID: `ggml-org/Qwen3-0.6B-GGUF:BF16`
-   quantization: `BF16`
-   policy: `LOCAL_ONLY`
-   report version:
    `xion-local-memory-inference-p1a-smoke-report-v1`

The completed three-case run reported:

```text
cases: 3
schemaValid: 2
invalidStructuredOutput: 1
runnerFailures: 0
semanticScored: 1
capabilityProbes: 1
localFirstCompletionOpportunities: 1
directTaskOutcomes: SUCCESS 1 / FAILURE 1 / UNKNOWN 1 / NOT_RUN 0
```

Per-case observations:

1.  `synthetic-extraction-001` (`structured_extraction`) was a
    `LOCAL_ELIGIBLE` case. Its output was `schemaStatus=INVALID`,
    `taskOutcome=FAILURE`, with `MODEL_OUTPUT_INVALID_JSON`; semantic
    scoring was `NOT_SCORED / INVALID_JSON`. End-to-end latency was
    `728.482 ms`. The smoke runner did not preserve the raw invalid model
    content, so this receipt does not attribute the failure to a Markdown
    fence or any other unrecorded raw-output shape. A separate earlier
    diagnostic request producing fenced JSON does not establish the cause
    of this smoke-run failure.
2.  `synthetic-triage-001` (`write_candidate_triage`) was
    `ELIGIBILITY_UNKNOWN` and returned `{"decision":"ESCALATE"}` with
    `schemaStatus=VALID` and `taskOutcome=UNKNOWN`. Semantic scoring was
    `NOT_SCORED / ADJUDICATION_UNAVAILABLE`; end-to-end latency was
    `1180.54 ms`. The case intentionally has no resolved gold label, so
    this is neither a semantic success nor a semantic failure.
3.  `synthetic-ambiguity-001` (`ambiguity_escalation`) was a hard-gated
    `CAPABILITY_PROBE`, not a LOCAL-FIRST completion opportunity. It
    returned `{"decision":"ESCALATE"}` with `schemaStatus=VALID`,
    `taskOutcome=SUCCESS`, and `SCORED / MATCH`; end-to-end latency was
    `1212.12 ms`.

This run exercised the complete real-local path:

```text
PilotCase
→ external llama.cpp HTTP inference
→ model output
→ external JSON/schema validation
→ PilotResult validation
```

It includes both a valid-result path and a fail-closed invalid-output
path. The measured latencies are Intel Mac CPU-only development
observations, not final always-on hardware feasibility evidence.

### Qwen3.5-0.8B compatibility observations

The same development environment and llama.cpp runtime commit were used
for an earlier Qwen3.5-0.8B bring-up attempt.

-   The Q8_0 artifact produced repeated `@` token degeneration.
-   The BF16 artifact answered trivial short prompts such as `OK` and a
    simple short JSON request normally, but reproducibly degenerated into
    repeated `@` tokens on the workload-shaped P1-A extraction prompt.
-   The workload-shaped failure reproduced after a fresh llama-server
    restart with `cached_tokens: 0`, so prompt-cache reuse was not a
    sufficient explanation.
-   Increasing maximum output from 128 to 512 produced more repeated `@`
    tokens rather than recovery.
-   Removing `response_format` did not eliminate the workload-shaped
    failure.
-   A JSON-schema-constrained diagnostic request caused llama.cpp HTTP
    500 with
    `Unexpected empty grammar stack after accepting piece: @ (31)`.

These are model/runtime/environment compatibility observations for the
tested Qwen3.5-0.8B artifacts on this Intel CPU-only llama.cpp setup.
They do not establish that Qwen3.5-0.8B lacks semantic capability for the
pilot workloads, and they are not a general rejection of Qwen3.5,
Q8_0, or the host hardware. They are not hardware-feasibility evidence
and provide no basis to alter the XION memory architecture.

### P1-A closure

**P1-A real-runtime bring-up is COMPLETE.** The milestone demonstrates
that the external local-runtime experimental path can be exercised
end-to-end and that invalid model output fails closed under the existing
research contract.

The tracked three-case synthetic fixture is plumbing/smoke coverage
only. It is insufficient for model-family acceptance or rejection,
prompt calibration, threshold selection, quantization conclusions,
LOCAL-FIRST acceptance, production deployment, or always-on hardware
feasibility. Qwen3-0.6B BF16 is the artifact that completed this smoke
run; it is not a canonical or frozen model choice.

P1-B1 synthetic capability calibration is now the active/open stage.
Private natural replay remains **UNOPENED** until P1-B1 results are
reviewed. No prompt tuning, Markdown-fence stripping, JSON parser
relaxation, schema change, or other three-case harness adaptation is part
of the P1-A closeout.

## Pilot P1-B1 synthetic capability calibration

P1-B1 is an offline, repository-tracked synthetic capability calibration
stage. It expands beyond the closed three-case P1-A plumbing fixture to
measure workload-specific capability and failure boundaries for one
external local-model configuration at a time. It is not final model
acceptance, private natural replay, held-out evaluation, production
LOCAL-FIRST authorization, prompt optimization, quantization comparison,
or always-on hardware-feasibility evidence.

The tracked fixture is
`fixtures/local-memory-inference-p1b1-synthetic.json`. Its envelope keeps
calibration metadata keyed by `caseId` outside the existing exact-validated
PilotCase objects. The 90 constructed synthetic cases are fixed as:

-   structured extraction: 30 cases, split equally across exact-key date,
    text-scalar, and quantity-plus-unit schemas (10 each);
-   write/no-write triage: 10 `NO_WRITE`, 10 `WRITE_CANDIDATE`, five
    non-hard-gated `ESCALATE`, and five hard-gated `ESCALATE` capability
    probes;
-   ambiguity/escalation: 12 `CLEAR`, 10 non-hard-gated `ESCALATE`, and
    eight hard-gated `ESCALATE` capability probes. The `CLEAR` cases are
    four easy, four distractor-but-resolvable, and four near-boundary but
    uniquely resolvable cases. Contract-level probes cover identity
    ambiguity, explicit correction, Core/high-impact, and
    authority-sensitive boundaries.

### P1-B1 pre-run primary adjudication receipt

Before any P1-B1 model calibration output was observed, a blind primary
human review under protocol `xion-p1b1-human-primary-v1` was frozen against
fixture commit `4e8375fcc1e2d7c75db405ea7c2f127ac42d4d2d`.
The review completed all 47 selected non-hard-gated semantic cases: 25
write/no-write triage and 22 ambiguity/escalation cases. Human primary
labels disagreed with the preregistered constructed labels on 0/47 cases.

Those 47 reviewed cases now use `HUMAN` primary gold. The 30 structured
extraction cases and 13 hard-gated capability probes retain
`PROGRAMMATIC` gold. This was primary adjudication, not a blind second
pass; `blindSecondPass` remains null and disagreement state remains
`NOT_ASSESSED`. P1-B1 model calibration has not yet been run.

P1-B1 structured extraction uses **Option A**: every case asks for one
fact that is explicitly present and unambiguous in bounded evidence.
Missing-value, conflicting-answer, and intrinsically ambiguous extraction
cases are excluded. A later, separately preregistered experiment may
compare Option A plus the separate ambiguity detector against an Option C
self-abstaining extraction contract such as
`EXTRACTED / NOT_FOUND / ESCALATE`. Introducing Option C must not
retroactively reinterpret or retune P1-B1 results.

The model receives only the task specification, strict output schema, and
synthetic input. Gold labels, strata, screening categories, and expected
decisions are not included in the prompt. Thinking remains disabled for
these bounded tasks. JSON parsing and exact-key schema validation remain
external and authoritative; fenced JSON, prose around JSON, inferred
fields, and extra keys fail closed. Invalid JSON or schema-invalid output
is a direct local model failure.

The preregistered P1-B1 model-size progression screens are:

-   structured extraction: zero critical wrong-value semantic mismatches
    and at least 90% exact local completion, which is at least 27/30;
-   write/no-write triage: zero eligible false `NO_WRITE` results and at
    least 80% `NO_WRITE` recall, which is at least 8/10;
-   ambiguity/escalation: zero eligible false `CLEAR` results and at least
    85% `CLEAR` recall. With 12 `CLEAR` cases the finite fixture boundary
    is 11/12 (91.7%); 10/12 (83.3%) fails.

These screens decide only whether a workload passes the current size or
advances in the P1-B1 capacity probe. They are not production or final
study acceptance thresholds and are not CLI tuning knobs. Hard-gated
capability probes are reported separately: their mismatches do not enter
critical unsafe counts or LOCAL-FIRST completion metrics because the
existing authority gates prevent those cases from entering local-policy
completion. Endpoint unavailability, timeout, malformed runtime envelope,
and HTTP/runtime failure make the affected workload
`INDETERMINATE_RUNTIME`; they must not be converted into semantic model
insufficiency or `ADVANCE_SIZE`.

Capacity probing begins with BF16 to avoid mixing model capacity and
quantization. The progression is sub-1B, then approximately 2B only for
workloads that fail screening, then approximately 4B only for workloads
that still fail. There is no automatic step to 7–8B. If approximately 4B
remains insufficient, human/design review must decide whether to stop the
local workload or explicitly justify a larger test. P1-B1 freezes no model
family and performs no quantization comparison.

The registered non-generative controls are `NONE_JUSTIFIED` with
`TASK_REQUIRES_SEMANTIC_JUDGMENT` for structured extraction and triage,
and `EXISTING_LOGIC_IS_AUTHORITY_GATE` for ambiguity/escalation. Existing
deterministic hard gates remain authoritative, but they are not relabeled
as a competing semantic classifier or experimental gold.

Run one separately managed external configuration with:

```bash
npm run research:memory-inference-calibration -- \
  --endpoint http://127.0.0.1:8080/v1 \
  --model MODEL_ID \
  --artifact ARTIFACT_OR_REVISION_ID \
  --quantization BF16 \
  --model-size-class sub-1B \
  --runtime-version RUNTIME_VERSION_OR_COMMIT
```

The JSON stdout report records the Galpi commit, fixture identity, model,
artifact, quantization, size class, runtime, runner, prompt, task, and
output-schema versions. Per-workload output keeps schema failures,
runtime failures, semantic outcomes, confusion counts, capability probes,
critical failures, metric numerators/denominators, thresholds, and the
`PASS_CURRENT_SIZE`, `ADVANCE_SIZE`, or `INDETERMINATE_RUNTIME` decision
separate. The command does not download or manage a model and does not
read or write the production DB, Vault, memory path, retrieval, routing,
or `server.js` flow. Private natural replay remains unopened until the
P1-B1 results receive separate review and approval.

### P1-B1 sub-1B calibration receipt

This receipt records the completed P1-B1 `LOCAL_ONLY` synthetic
calibration run. It is a model-size progression result, not final model
acceptance, production authorization, or always-on hardware-feasibility
evidence.

Run identity:

-   report version:
    `xion-local-memory-inference-p1b1-report-v1`
-   Galpi commit:
    `5a789d7193b08e84b18b39efe1e146ad8af39355`
-   model ID and artifact ID: `ggml-org/Qwen3-0.6B-GGUF:BF16`
-   quantization and size class: `BF16`, `sub-1B`
-   runtime and version: `llama.cpp`,
    `e42214804794fca6abb61b1a5f9adae2a845f0be`
-   runner and prompt:
    `xion-local-memory-inference-p1b1-runner-v1`,
    `xion-local-memory-inference-p1b1-prompt-v1`
-   fixture: `xion-local-memory-inference-p1b1-synthetic-v1`, 90 cases
-   policy: `LOCAL_ONLY`
-   runtime failures: 0

Frozen workload screening results:

1.  **Structured extraction:** 30 cases with zero runtime failures
    produced two schema-valid exact matches and 28 invalid structured
    outputs, all recorded as
    `MODEL_OUTPUT_INVALID_JSON`. There were zero schema-valid wrong-value
    failures and zero critical unsafe failures. Exact local completion
    was 2/30 (6.67%), below the preregistered 27/30 (90%) boundary, so
    the decision is `ADVANCE_SIZE`. This establishes failure of the
    current strict structured-output completion screen at sub-1B. It
    does not establish that underlying semantic extraction capability is
    only 2/30, because the observed failure was dominated by invalid
    structured output and both schema-valid answers were exact matches.
2.  **Write/no-write triage:** all 30 outputs were schema-valid, with
    zero runtime failures, 11 semantic successes, and 19 semantic
    failures. The five hard-gated
    capability probes all matched, with zero probe mismatches. Among
    non-probe cases, gold `NO_WRITE` produced one `NO_WRITE` and nine
    `ESCALATE`; gold `WRITE_CANDIDATE` produced two `NO_WRITE` and eight
    `ESCALATE`; and all five gold `ESCALATE` cases produced `ESCALATE`.
    `NO_WRITE` recall was 1/10 (10%), below the preregistered 8/10 (80%)
    boundary. The two eligible false `NO_WRITE` results are two critical
    unsafe failures, so the decision is `ADVANCE_SIZE`.
3.  **Ambiguity/escalation:** all 30 outputs were schema-valid, with zero
    runtime failures, 24 semantic successes, and six semantic failures.
    The set contained 22
    non-hard-gated cases and eight hard-gated capability probes; four
    probe outputs mismatched. `CLEAR` recall was 12/12 (100%), which
    passes the preregistered 11/12 finite boundary, but two eligible gold
    `ESCALATE` cases were classified `CLEAR`. Those two critical unsafe
    failures violate the preregistered critical-unsafe-zero condition,
    so the decision is `ADVANCE_SIZE`. The four hard-gated probe
    mismatches remain diagnostic and are excluded from LOCAL-FIRST
    critical unsafe counts.

No sub-1B workload passes its current preregistered screen. All three
workloads therefore advance to the preregistered approximately 2B size
class. The next run changes model size only as far as practical: it uses
Qwen3-1.7B as the approximately 2B candidate with BF16, the same fixture,
prompt/schema contracts, and llama.cpp runtime version. That approximately
2B run is recorded in the following receipt. The
fixture, gold labels and provenance, parser and `response_format`
behavior, screening thresholds, critical-unsafe-zero rules, hard-gate
handling, and model-size progression remain unchanged.

### P1-B1 ~2B calibration receipt

This receipt records the completed P1-B1 `LOCAL_ONLY` synthetic
calibration run at the approximately 2B size class. It remains a
model-size screening result, not production acceptance or authorization.

Run identity:

-   report version:
    `xion-local-memory-inference-p1b1-report-v1`
-   Galpi run commit:
    `8bbc1f71bac37c0ecdecae1fcd2077b9a8e6a7e5`
-   model ID: `xion-p1b1-qwen3-1.7b-bf16`
-   artifact: `unsloth/Qwen3-1.7B-GGUF:BF16`
-   quantization and size class: `BF16`, `~2B`
-   runtime and version: `llama.cpp`,
    `e42214804794fca6abb61b1a5f9adae2a845f0be`
-   runner and prompt:
    `xion-local-memory-inference-p1b1-runner-v1`,
    `xion-local-memory-inference-p1b1-prompt-v1`
-   fixture: `xion-local-memory-inference-p1b1-synthetic-v1`, 90 cases
-   policy: `LOCAL_ONLY`
-   runtime failures: 0

Frozen workload screening results:

1.  **Structured extraction:** all 30 outputs were schema-valid, with
    zero runtime failures, 29 semantic successes, and one semantic
    failure. Exact local completion was 29/30 (96.67%), above the
    preregistered 27/30 (90%) completion boundary, but the one
    schema-valid wrong value violates the preregistered
    critical-wrong-value-zero requirement. The decision is therefore
    `ADVANCE_SIZE`. The single mismatch was
    `p1b1-extraction-018`: gold `{"preferredMode":"조용히"}` versus
    observed `{"preferredMode":"조용"}`. Although the outputs are
    semantically close and the difference resembles normalization, this
    remains a wrong-value failure under the frozen exact extraction
    contract. The gold, parser, equality rule, and threshold are not
    relaxed in response.
2.  **Write/no-write triage:** all 30 outputs were schema-valid, with
    zero runtime failures, 18 semantic successes, and 12 semantic
    failures. The set contained 25 non-hard-gated cases and five
    hard-gated capability probes; one probe matched and four mismatched.
    In the non-probe confusion counts, gold `NO_WRITE` produced eight
    `NO_WRITE` and two `WRITE_CANDIDATE`; gold `WRITE_CANDIDATE`
    produced one `NO_WRITE` and nine `WRITE_CANDIDATE`; and gold
    `ESCALATE` produced two `NO_WRITE` and three `WRITE_CANDIDATE`.
    The model emitted no `ESCALATE` for any of the five non-hard-gated
    gold `ESCALATE` cases. `NO_WRITE` recall was 8/10 (80%), exactly the
    preregistered efficiency boundary, but three eligible false
    `NO_WRITE` results violate the critical-unsafe-zero requirement.
    The decision is `ADVANCE_SIZE`. The four hard-gated probe mismatches
    remain diagnostic and separate from LOCAL-FIRST critical unsafe
    counts.
3.  **Ambiguity/escalation:** all 30 outputs were schema-valid, with zero
    runtime failures, 27 semantic successes, and three semantic failures.
    The set contained 22 non-hard-gated cases and eight hard-gated
    capability probes, all eight of which matched. Among non-probe
    cases, gold `CLEAR` produced nine `CLEAR` and three `ESCALATE`, while
    all 10 gold `ESCALATE` cases produced `ESCALATE`. Eligible false
    `CLEAR` and critical unsafe failures were both zero, so the safety
    condition passes. `CLEAR` recall was 9/12 (75%), below the
    preregistered 11/12 finite boundary, so the decision is
    `ADVANCE_SIZE`. This is a conservative over-escalation failure under
    the frozen efficiency/completion rule, not a safety failure.

Compared with the sub-1B run, structured extraction moved from 2/30
exact completions with 28 invalid outputs to 29/30 exact completions with
all outputs schema-valid. Triage `NO_WRITE` recall moved from 1/10 to
8/10, but its error pattern changed and critical false-`NO_WRITE`
failures remained. Ambiguity eliminated eligible false `CLEAR` failures
(2 to 0), while `CLEAR` recall moved from 12/12 to 9/12 through
conservative `ESCALATE` outputs. These are workload-specific observations
and do not establish monotonic improvement with parameter count.

No workload passes the complete approximately 2B screen. All three
therefore advance to the preregistered approximately 4B size class. The
approximately 4B run preserved, as far as practical, the Qwen3 family,
BF16, the same 90-case fixture, prompt, output schemas, parser,
`response_format` behavior, screening thresholds, critical-zero rules,
and llama.cpp runtime version; its result is recorded in the following
receipt. There is no automatic advance to a 7B/8B model: if a
workload still fails at approximately 4B, automatic size escalation
stops and human/design review is required.

### P1-B1 ~4B calibration receipt

This receipt records the completed P1-B1 `LOCAL_ONLY` synthetic
calibration run at the approximately 4B size class. It remains a
model-size screening result, not production acceptance or authorization.

Run identity:

-   report version:
    `xion-local-memory-inference-p1b1-report-v1`
-   generated at: `2026-08-31T10:35:41.713Z`
-   Galpi run commit:
    `97ee1058b696d5782bcc6b52469cd5841bfb67ff`
-   model ID: `xion-p1b1-qwen3-4b-bf16`
-   artifact: `unsloth/Qwen3-4B-GGUF:BF16`
-   quantization and size class: `BF16`, `~4B`
-   runtime and version: `llama.cpp`,
    `e42214804794fca6abb61b1a5f9adae2a845f0be`
-   runner and configuration:
    `xion-local-memory-inference-p1b1-runner-v1`,
    `xion-local-memory-inference-p1b1-config-v1`
-   prompt: `xion-local-memory-inference-p1b1-prompt-v1`
-   fixture: `xion-local-memory-inference-p1b1-synthetic-v1`, 90 cases
-   policy: `LOCAL_ONLY`
-   runtime failures: 0 across all 90 cases
-   schema-valid outputs: 30/30 for each workload

Frozen workload screening results:

1.  **Structured extraction:** all 30 outputs were schema-valid, with
    zero runtime failures, 29 semantic successes, and one semantic
    failure. Exact local completion was 29/30 (96.67%), above the
    preregistered 27/30 (90%) completion boundary, but the one wrong
    value is one critical wrong-value and critical unsafe failure. It
    violates the preregistered wrong-value-zero requirement, so the
    report decision is `ADVANCE_SIZE`. The failing case was
    `p1b1-extraction-023`. Its evidence distinguished a monthly target
    of 20 pages from the requested weekly target of 8 pages. The model
    returned `{"weeklyTarget":20,"unit":"pages"}` instead of gold
    `{"weeklyTarget":8,"unit":"pages"}`. This is a substantive
    distractor-selection error, not formatting or surface normalization.
    Exact matching, gold, parser, threshold, and the critical-zero rule
    remain unchanged.
2.  **Write/no-write triage:** all 30 outputs were schema-valid, with
    zero runtime failures, 16 semantic successes, and 14 semantic
    failures. The set contained 25 non-hard-gated cases and five
    hard-gated capability probes; two probes matched and three
    mismatched. In the non-probe confusion counts, gold `NO_WRITE`
    produced four `NO_WRITE` and six `WRITE_CANDIDATE`; gold
    `WRITE_CANDIDATE` produced one `NO_WRITE` and nine
    `WRITE_CANDIDATE`; and gold `ESCALATE` produced three `NO_WRITE`,
    one `WRITE_CANDIDATE`, and one `ESCALATE`. `NO_WRITE` recall was
    4/10 (40%), below the preregistered 8/10 (80%) boundary. Four
    eligible false `NO_WRITE` results are four critical unsafe failures.
    The workload therefore fails both the recall threshold and the
    critical-false-`NO_WRITE`-zero requirement, and the report decision
    is `ADVANCE_SIZE`. Hard-gated probe mismatches remain diagnostic and
    separate from LOCAL-FIRST critical unsafe counts.
3.  **Ambiguity/escalation:** all 30 outputs were schema-valid, with zero
    runtime failures, 18 semantic successes, and 12 semantic failures.
    The set contained 22 non-hard-gated cases and eight hard-gated
    capability probes, all eight of which matched. Among non-probe
    cases, all 12 gold `CLEAR` cases produced `ESCALATE`, and all 10 gold
    `ESCALATE` cases produced `ESCALATE`. Eligible false `CLEAR` and
    critical unsafe failures were both zero, so the safety condition
    passes. `CLEAR` recall was 0/12 (0%), below the preregistered 11/12
    finite boundary, so the report decision is `ADVANCE_SIZE`. This is
    extreme conservative over-escalation and decision-boundary collapse
    under the frozen configuration, not a safety failure.

Compared with the approximately 2B run, structured extraction remained
at 29/30 exact completion, but the error changed from the
normalization-like `조용히` to `조용` mismatch to a substantive weekly
8-pages versus monthly 20-pages distractor selection. Triage `NO_WRITE`
recall moved from 8/10 to 4/10, while eligible false `NO_WRITE` moved
from three to four. Ambiguity `CLEAR` recall moved from 9/12 to 0/12,
while eligible false `CLEAR` remained zero and all eight hard-gated
ambiguity probes continued to match. These are factual workload-specific
observations; the approximately 4B result does not improve monotonically
over approximately 2B and does not support a general claim of monotonic
improvement with parameter count.

Although the fixed runner vocabulary reports `ADVANCE_SIZE` for all three
failed workloads, the preregistered study progression ends automatic
size escalation at approximately 4B. No workload passes its complete
approximately 4B screen, and no shared viable model size was established
at or below approximately 4B. **Automatic model-size progression is now
STOPPED.** A 7B/8B model must not be tested automatically. The next
approved activity is a separate human/design decision-boundary review,
not another automatic size step.

That separate review should inspect, case by case, extraction distractor
selection and field-target adherence; triage separation among
`NO_WRITE`, `WRITE_CANDIDATE`, and `ESCALATE`; and the ambiguity
`CLEAR`/`ESCALATE` boundary and conservative collapse. This receipt does
not design or implement a follow-up experiment. The review order is:

1.  preserve the safety and critical-zero requirements;
2.  inspect whether task contracts, evidence framing, or decision
    boundaries can be improved in a separately preregistered follow-up;
3.  only if reasonable decision-boundary improvements cannot solve the
    problem, consider a separate empirical review of
    efficiency/completion thresholds.

The extraction critical wrong-value count, triage eligible false
`NO_WRITE` count, and ambiguity eligible false `CLEAR` count must each
remain zero. Any future efficiency/completion-threshold change requires a
separately justified empirical decision and cannot retroactively rescue
these P1-B1 results.

### P1-B2a structured-extraction decision-boundary diagnostic preregistration

P1-B2a is a diagnostic characterization of the cross-size error observed
on P1-B1 case `p1b1-extraction-023`. In the historical approximately 2B
run, the model returned the requested weekly target of 8 pages; in the
approximately 4B run, it selected the monthly 20-page distractor. This
diagnostic tests whether that approximately 4B error reproduces and whether
bounded single-factor changes reveal field-target selection sensitivity.
It is not a new P1-B1 screen, threshold review, model-size progression, or
production-acceptance step, and it cannot change or rescue any historical
P1-B1 result.

The fixed fixture is
`xion-local-memory-inference-p1b2a-extraction-boundary-v1`. It contains
exactly eight synthetic `structured_extraction` cases using the existing
`p1b1_quantity_unit_v1` schema and PROGRAMMATIC gold:

-   D0 (`p1b2a-extraction-d0`) exactly reproduces the P1-B1 023 evidence
    and gold.
-   D1 reverses target/distractor order; D2 adds an explicit requested
    cue; D3 expresses the target lexically in Korean; D4 aligns the target
    phrase with the `weeklyTarget` schema key; and D5 changes the monthly
    distractor's unit while preserving the requested weekly target.
-   C1 and C2 exactly reproduce P1-B1 cases `p1b1-extraction-022` and
    `p1b1-extraction-029` as frozen controls.

No cases may be added after observing outputs. Diagnostic metadata remains
outside model-visible PilotCase input. Each call uses the fixed compatible
P1-B1 calibration metadata (`quantity_unit`, `EXACT_VALUE`, `distractor`,
not a capability probe).

The diagnostic is preregistered for exactly two BF16 configurations:

-   approximately 2B: Qwen3-1.7B,
    `unsloth/Qwen3-1.7B-GGUF:BF16`;
-   approximately 4B: Qwen3-4B,
    `unsloth/Qwen3-4B-GGUF:BF16`.

Both use external `llama.cpp`; the intended runtime version is
`e42214804794fca6abb61b1a5f9adae2a845f0be`. Sub-1B, 7B/8B, other model
families, and quantized variants are outside this diagnostic. The separate
diagnostic runner/report identities are
`xion-local-memory-inference-p1b2a-extraction-boundary-runner-v1` and
`xion-local-memory-inference-p1b2a-extraction-boundary-report-v1`.
Actual model requests continue through `runCalibrationCase()` so the frozen
P1-B1 prompt and version, task/output-schema versions, request settings,
`response_format`, JSON parsing, schema validation, and semantic exact-match
behavior remain unchanged.

Interpretation is frozen before any real P1-B2a run:

1.  The historical approximately 4B baseline failure is reproduced only if
    D0 again returns exactly `{"weeklyTarget":20,"unit":"pages"}`. Gold
    `{"weeklyTarget":8,"unit":"pages"}` means
    `BASELINE_NOT_REPRODUCED`; another wrong value is extraction
    instability, not reproduction of the historical distractor error. D0
    is not rerun to recover the historical error; a replication experiment
    would require a separate decision.
2.  C1 and C2 should remain exact matches. Failure of either control makes
    factor-level interpretation for that model unstable or weak and must be
    reported explicitly.
3.  A result may be described as "supports sensitivity to <factor>" only
    when the approximately 4B D0 reproduces the exact historical 20-page
    error, both controls remain stable, and the corresponding D1-D5 variant
    changes from that mismatch to the exact gold. This does not prove the
    factor caused the error. If multiple variants repair D0, each supported
    sensitivity is reported without ranking them.
4.  Stability across D0-D5 at approximately 2B combined with variation at
    approximately 4B supports size/checkpoint-specific calibration
    sensitivity. Variation under the same manipulations in both models
    supports broader prompt/representation sensitivity. Neither pattern
    establishes a monotonic parameter-count effect.
5.  A D0 or control runtime failure makes that model's diagnostic
    uninterpretable. A runtime or schema failure isolated to one variant
    makes only that factor unassessable; other valid observations may still
    be described.
6.  There is deliberately no N/8 acceptance threshold, no P1-B1 screening
    decision, and no automatic diagnostic conclusion. Exact-match totals
    are descriptive only. Semantic mismatches are observations; runtime
    failures remain separately represented and make the CLI fail.

There are no automatic reruns. The P1-B1 critical-zero requirements remain
frozen: extraction wrong value, eligible triage false `NO_WRITE`, and
eligible ambiguity false `CLEAR` must each remain zero. P1-B2a does not open
those requirements, model-size progression, Option C, private replay, or
production routing. Triage and ambiguity follow-up diagnostics are not
designed by this task. No real P1-B2a model result existed when this
preregistration was committed.

### P1-B2a structured-extraction decision-boundary diagnostic receipt

P1-B2a ran on 2026-09-01 under the preregistered frozen configuration.
The approximately 2B report was generated at
`2026-09-01T03:32:06.082Z`; the approximately 4B report was generated at
`2026-09-01T03:34:23.094Z`.

Shared provenance recorded directly by both reports:

-   report version:
    `xion-local-memory-inference-p1b2a-extraction-boundary-report-v1`
-   fixture: `xion-local-memory-inference-p1b2a-extraction-boundary-v1`,
    synthetic, eight cases
-   Galpi commit:
    `729f1fedb8e67b6bb00daf6fdd526834b5007836`
-   policy and quantization: `LOCAL_ONLY`, `BF16`
-   runtime and version: `llama.cpp`,
    `e42214804794fca6abb61b1a5f9adae2a845f0be`
-   diagnostic runner:
    `xion-local-memory-inference-p1b2a-extraction-boundary-runner-v1`
-   P1-B1 runner and prompt:
    `xion-local-memory-inference-p1b1-runner-v1`,
    `xion-local-memory-inference-p1b1-prompt-v1`
-   task contract, task specification, and output schema:
    `xion-local-memory-inference-case-v1`,
    `p1b1-structured-extraction-quantity-unit-v1`, and
    `p1b1-structured-extraction-quantity-unit-output-v1`

The approximately 2B configuration was
`xion-p1b1-qwen3-1.7b-bf16`,
`unsloth/Qwen3-1.7B-GGUF:BF16`, size class `~2B`. The approximately 4B
configuration was `xion-p1b1-qwen3-4b-bf16`,
`unsloth/Qwen3-4B-GGUF:BF16`, size class `~4B`. Both reports recorded the
fixture identity above without substitution.

Descriptive summaries:

-   **Approximately 2B:** 8 total, 8 schema-valid, 0 invalid structured
    outputs, 0 runtime failures, 8 exact matches, and 0 mismatches.
-   **Approximately 4B:** 8 total, 8 schema-valid, 0 invalid structured
    outputs, 0 runtime failures, 5 exact matches, and 3 mismatches.

Per-case results (`expected` is PROGRAMMATIC gold):

| Case | Diagnostic factor | Expected | ~2B actual | ~4B actual |
| --- | --- | --- | --- | --- |
| D0 `p1b2a-extraction-d0` | baseline reproduction | `{"weeklyTarget":8,"unit":"pages"}` | same, MATCH | `{"weeklyTarget":20,"unit":"pages"}`, MISMATCH |
| D1 | target/distractor order | `{"weeklyTarget":8,"unit":"pages"}` | same, MATCH | same, MATCH |
| D2 | explicit requested cue | `{"weeklyTarget":8,"unit":"pages"}` | same, MATCH | same, MATCH |
| D3 | target lexical language / phrasing | `{"weeklyTarget":8,"unit":"pages"}` | same, MATCH | same, MATCH |
| D4 | schema-key lexical alignment | `{"weeklyTarget":8,"unit":"pages"}` | same, MATCH | `{"weeklyTarget":20,"unit":"pages"}`, MISMATCH |
| D5 | same-unit competition | `{"weeklyTarget":8,"unit":"pages"}` | same, MATCH | `{"weeklyTarget":20,"unit":"items"}`, MISMATCH |
| C1 `p1b2a-extraction-c1` | frozen control | `{"weeklyTarget":5,"unit":"sessions"}` | same, MATCH | same, MATCH |
| C2 `p1b2a-extraction-c2` | frozen control | `{"weeklyTarget":4,"unit":"hours"}` | same, MATCH | same, MATCH |

D0 at approximately 4B reproduced the exact historical P1-B1
`p1b1-extraction-023` error, including
`{"weeklyTarget":20,"unit":"pages"}`. This is not
`BASELINE_NOT_REPRODUCED`. C1 and C2 remained exact matches, so the
approximately 4B factor-level diagnostic is interpretable under the
preregistered control rule.

Because D0 reproduced that exact historical error, both controls stayed
stable, and each paired variant changed to exact gold, the approximately
4B result **supports sensitivity to** target/distractor order, explicit
requested cues, and target lexical language or phrasing. These three
sensitivities are not ranked, and the diagnostic does not prove that any
one factor caused the failure.

D4 is a negative diagnostic observation: merely aligning the evidence
token with the schema key `weeklyTarget` did not repair the approximately
4B error. D5 is also negative evidence: removing same-unit competition
did not repair it, and the model returned the complete monthly distractor
fact `{"weeklyTarget":20,"unit":"items"}`. This weakens a simple
"same unit caused the confusion" explanation and is consistent with
incorrect field/target selection rather than merely attaching the wrong
number to the requested unit. It is diagnostic evidence, not proof of an
internal model mechanism.

The approximately 2B configuration was stable across D0-D5 and both
controls, while the approximately 4B configuration varied under the
bounded manipulations and reproduced the historical D0 failure. Under the
preregistered rule, this supports **size/checkpoint-specific calibration
sensitivity**. It does not show that parameter count caused the
difference, that larger models are generally worse, a monotonic size
effect, an underlying architecture mechanism, or generalization beyond
this bounded diagnostic.

Bounded conclusion:

> Under the frozen P1-B1 extraction contract, the Qwen3-4B BF16
> `p1b1-extraction-023` wrong-value failure is reproducible and sensitive
> to bounded changes in target/distractor order, explicit requested cues,
> and target lexical phrasing. The same eight-case diagnostic was stable
> for Qwen3-1.7B BF16. The evidence supports size/checkpoint-specific
> field-target selection calibration sensitivity; it does not establish a
> monotonic model-size effect or prove a causal internal mechanism.

This diagnostic characterization does not retroactively rescue P1-B1 or
change any P1-B1 score. It does not relax extraction critical wrong value
`= 0`, introduce an N/8 acceptance threshold, reopen automatic model-size
progression, justify 7B/8B, open quantization, modify the prompt, schema,
parser, runtime, or model configuration, establish production acceptance
or target-hardware feasibility, open private natural replay, or open
Option C. The original P1-B1 approximately 4B screening failure remains
exactly as recorded, and production memory decisions, retrieval, and model
routing remain unchanged.

**P1-B2a is CLOSED / COMPLETE.**

### P1-B2b write-candidate-triage label-semantics paired diagnostic preregistration

P1-B2b is a post-hoc paired diagnostic of the write-candidate-triage
decision semantics used in the completed P1-B1 model-size screen. The
frozen P1-B1 instruction names three output labels but does not define
their operational meanings:

```text
Classify the input as WRITE_CANDIDATE, NO_WRITE, or ESCALATE. This is advisory triage only and does not authorize a durable write.
```

The historical non-hard-gated P1-B1 observations motivate this diagnostic
and remain unchanged. At approximately 2B, gold `NO_WRITE` produced
8 `NO_WRITE`, 2 `WRITE_CANDIDATE`, and 0 `ESCALATE`; gold
`WRITE_CANDIDATE` produced 1, 9, and 0 respectively; and gold `ESCALATE`
produced 2, 3, and 0. Eligible false `NO_WRITE` was 3 and correct eligible
`ESCALATE` was 0/5. At approximately 4B, those rows were 4/6/0,
1/9/0, and 3/1/1 respectively. Eligible false `NO_WRITE` was 4 and
correct eligible `ESCALATE` was 1/5. P1-B2b cannot rerate or rescue either
historical result.

The fixed diagnostic fixture is
`xion-local-memory-inference-p1b2b-triage-label-semantics-v1`. It is an
exact deep-copy snapshot of the 25 non-hard-gated P1-B1
`write_candidate_triage` PilotCase objects, in frozen fixture order:

-   `p1b1-triage-no-write-001` through `-010`;
-   `p1b1-triage-write-001` through `-010`;
-   `p1b1-triage-escalate-001` through `-005`.

The distribution is 10 `NO_WRITE`, 10 `WRITE_CANDIDATE`, and five
eligible `ESCALATE`. All 25 retain their existing HUMAN primary
adjudication. The five `p1b1-triage-probe-001` through `-005` hard-gated
capability probes are excluded, as are all extraction and ambiguity cases.
Evidence, gold, adjudication, ambiguity state, hard-gate expectation, task
contract, and workload are unchanged. Cases may not be added or
re-adjudicated after observing outputs.

Each case is run under exactly two paired conditions:

1.  **`FROZEN_P1B1`:** use the exact frozen P1-B1 prompt through
    `runCalibrationCase()`, with prompt identity
    `xion-local-memory-inference-p1b1-prompt-v1`.
2.  **`DEFINED_LABEL_SEMANTICS`:** clone the frozen scaffold from
    `buildCalibrationPrompt()` and replace only the `INSTRUCTION:` content
    with the following exact text, identified as
    `xion-local-memory-inference-p1b2b-triage-defined-labels-prompt-v1`:

```text
Classify the supplied evidence into exactly one advisory triage label.
NO_WRITE: the evidence is clearly transient, request-local, or otherwise not a durable memory candidate.
WRITE_CANDIDATE: the evidence clearly states a sufficiently persistent fact, preference, goal, constraint, or state that may be worth durable-memory review.
ESCALATE: the supplied evidence is insufficient or ambiguous in persistence, scope, reference, or meaning in a way that prevents safely deciding between NO_WRITE and WRITE_CANDIDATE. Do not resolve that ambiguity yourself.
This classification is advisory only and does not authorize a durable write.
```

The defined instruction is frozen as written. It adds no examples,
few-shot demonstrations, rationales, chain-of-thought request, confidence,
new output fields, or case-specific hints. Examples are deliberately
excluded so operational label definitions are not confounded with
few-shot pattern teaching.

Both conditions preserve the same system message, workload line, task
specification, output schema, input JSON, model, runtime request fields,
parser, schema validator, and semantic exact-match behavior. Runtime
requests remain `temperature: 0`, `max_tokens: 128`, `stream: false`,
`chat_template_kwargs: { enable_thinking: false }`, and
`response_format: { type: "json_object" }`. The existing
`p1b1-write-candidate-triage-v1` task specification and
`p1b1-write-candidate-triage-output-v1` schema remain authoritative. The
frozen P1-B1 library receives no generic prompt override or tuning knob.

Exactly two BF16 configurations are registered:

-   approximately 2B: `xion-p1b1-qwen3-1.7b-bf16`, artifact
    `unsloth/Qwen3-1.7B-GGUF:BF16`;
-   approximately 4B: `xion-p1b1-qwen3-4b-bf16`, artifact
    `unsloth/Qwen3-4B-GGUF:BF16`.

Both use external `llama.cpp` at
`e42214804794fca6abb61b1a5f9adae2a845f0be`. Sub-1B, 7B/8B, other model
families, and quantized variants are excluded. The diagnostic runner and
report identities are
`xion-local-memory-inference-p1b2b-triage-label-semantics-runner-v1` and
`xion-local-memory-inference-p1b2b-triage-label-semantics-report-v1`.

For each case in fixture order, the runner executes `FROZEN_P1B1` once,
then `DEFINED_LABEL_SEMANTICS` once, then moves to the next case. There are
no automatic reruns, including for semantic mismatches. Each model makes
25 × 2 = 50 calls; the complete planned experiment is 100 calls. A failed
request is recorded and execution continues under the bounded diagnostic
failure semantics.

Each condition reports total cases, schema-valid outputs, invalid
structured outputs, runtime failures, exact matches, and mismatches. Its
confusion matrix uses gold rows `NO_WRITE`, `WRITE_CANDIDATE`, and
`ESCALATE`, with actual columns for those labels plus `INVALID` and
`RUNTIME_FAILURE`. It separately reports correct `NO_WRITE` out of 10,
correct `WRITE_CANDIDATE` out of 10, correct `ESCALATE` out of 5, and
eligible false `NO_WRITE` where gold is `WRITE_CANDIDATE` or `ESCALATE`.

Each pair receives exactly one descriptive transition:

-   `UNCHANGED_CORRECT`: A and B are both correct;
-   `FIXED`: A is wrong and B is correct;
-   `REGRESSION`: A is correct and B is wrong;
-   `UNCHANGED_WRONG`: A and B are both wrong;
-   `NONCOMPARABLE_RUNTIME_OR_SCHEMA`: either side cannot be compared
    semantically because of runtime or schema failure.

Interpretation is frozen before any real P1-B2b output exists:

1.  **Historical baseline continuity.** Condition A is compared with the
    historical P1-B1 confusion pattern. Any difference is reported without
    rerunning A to recover the old matrix. Historical non-reproduction alone
    does not invalidate the current within-run A/B pairing, which is the
    primary diagnostic comparison.
2.  **Case-level evidence.** `FIXED` supports only the narrow statement
    that explicit label semantics moved that case in the correct direction
    while evidence, HUMAN gold, model, runtime contract, schema, and request
    scaffold were fixed. It does not prove an internal causal mechanism.
    `REGRESSION` receives equal prominence.
3.  **Overall definition usefulness.** For one model, the result supports
    the underspecification/usefulness hypothesis only when fixes exceed
    regressions, B exact matches exceed A exact matches, and B eligible
    false `NO_WRITE` does not exceed A. This is a directional diagnostic
    rule, not an acceptance threshold. If all three do not hold, the result
    is mixed or not supportive.
4.  **ESCALATE semantics.** More correct B `ESCALATE` decisions among the
    five gold `ESCALATE` cases than in A supports the narrower hypothesis
    that explicit operational semantics improved escalation recognition for
    that model. Equal or worse does not support it.
5.  **Safety.** A reduction in eligible false `NO_WRITE` is improvement on
    the frozen safety-relevant error dimension. An increase is negative even
    if overall exact match improves. The false-`NO_WRITE`-zero requirement
    never changes.
6.  **Cross-size interpretation.** Similar improvements and class patterns
    at both sizes support a prompt-contract underspecification explanation
    across these two checkpoints. Material change in only one model while
    the other stays stable supports checkpoint-specific sensitivity to
    label-semantics framing. Neither pattern establishes a monotonic
    parameter-count effect.
7.  **Post-hoc limitation.** These 25 cases were already used and inspected
    in P1-B1. P1-B2b is not fresh held-out evidence. Even a strong positive
    result cannot establish revised-prompt capability, replace P1-B1, or
    authorize production use. A fresh, separately preregistered validation
    fixture is required before a revised task contract can be accepted.

There is deliberately no N/25 threshold, `screeningDecision`,
`PASS_CURRENT_SIZE`, `ADVANCE_SIZE`, automatic prompt adoption, model-size
progression, or automatic conclusion. P1-B2b is diagnostic
characterization only: it is not P1-B1 rerating, a new screen, threshold
review, production acceptance, held-out validation, 7B/8B justification,
or quantization experiment. The P1-B1 prompt, schema, scores, thresholds,
and critical eligible-false-`NO_WRITE = 0` requirement remain frozen.
Production memory decisions, retrieval, routing, DB, and Vault remain
unchanged; private natural replay and Option C remain unopened. No real
P1-B2b model output existed when this preregistration was committed.

### P1-B2b write-candidate-triage label-semantics paired diagnostic receipt

The two completed raw reports were read directly. The approximately 4B
report was generated at `2026-09-01T06:18:02.144Z`; the approximately 2B
report was generated at `2026-09-01T06:22:41.699Z`.

Shared provenance was:

-   report
    `xion-local-memory-inference-p1b2b-triage-label-semantics-report-v1`;
-   fixture
    `xion-local-memory-inference-p1b2b-triage-label-semantics-v1`, 25
    synthetic cases;
-   Galpi commit
    `29d22b45f168ef5e6a82e1b6fc81d2309a853f09`;
-   BF16 under `llama.cpp` commit
    `e42214804794fca6abb61b1a5f9adae2a845f0be`, `LOCAL_ONLY`;
-   runner
    `xion-local-memory-inference-p1b2b-triage-label-semantics-runner-v1`
    and frozen P1-B1 runner `xion-local-memory-inference-p1b1-runner-v1`;
-   frozen prompt `xion-local-memory-inference-p1b1-prompt-v1` and defined
    prompt
    `xion-local-memory-inference-p1b2b-triage-defined-labels-prompt-v1`;
-   PilotCase task contract `xion-local-memory-inference-case-v1`, task
    specification `p1b1-write-candidate-triage-v1`, and output schema
    `p1b1-write-candidate-triage-output-v1`; fixture identity in provenance
    matches the fixture named above.

The approximately 2B configuration was
`xion-p1b1-qwen3-1.7b-bf16`, artifact
`unsloth/Qwen3-1.7B-GGUF:BF16`, size class `~2B`. Its descriptive results
were:

| Condition | Total | Schema valid | Invalid | Runtime failures | Exact | Mismatches | Correct NO_WRITE | Correct WRITE_CANDIDATE | Correct ESCALATE | Eligible false NO_WRITE |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `FROZEN_P1B1` | 25 | 25 | 0 | 0 | 17 | 8 | 8/10 | 9/10 | 0/5 | 3 |
| `DEFINED_LABEL_SEMANTICS` | 25 | 24 | 1 | 0 | 19 | 5 | 10/10 | 7/10 | 2/5 | 5 |

Condition A exactly reproduced the historical non-hard-gated P1-B1
confusion pattern. Condition B's one invalid structured output was
`p1b1-triage-escalate-003`, with
`MODEL_OUTPUT_INVALID_JSON`. The paired counts were 14
`UNCHANGED_CORRECT`, five `FIXED`, three `REGRESSION`, two
`UNCHANGED_WRONG`, and one `NONCOMPARABLE_RUNTIME_OR_SCHEMA`.

For approximately 2B, fixes exceeded regressions and B exact matches
exceeded A, but B eligible false `NO_WRITE` did not stay at or below A:
it increased from 3 to 5. Therefore the preregistered overall
underspecification/usefulness rule is **not supported** at this checkpoint;
the overall result is mixed. Correct `ESCALATE` increased from 0/5 to 2/5,
which supports the narrower hypothesis that explicit `ESCALATE`
operational semantics improved escalation recognition at this checkpoint.
The false-`NO_WRITE` increase is a negative result on the frozen
safety-relevant dimension and cannot be traded away for the higher overall
exact-match count. The defined prompt is not an accepted approximately 2B
contract.

The approximately 4B configuration was
`xion-p1b1-qwen3-4b-bf16`, artifact
`unsloth/Qwen3-4B-GGUF:BF16`, size class `~4B`. Its descriptive results
were:

| Condition | Total | Schema valid | Invalid | Runtime failures | Exact | Mismatches | Correct NO_WRITE | Correct WRITE_CANDIDATE | Correct ESCALATE | Eligible false NO_WRITE |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `FROZEN_P1B1` | 25 | 23 | 0 | 2 | 14 | 9 | 4/10 | 9/10 | 1/5 | 4 |
| `DEFINED_LABEL_SEMANTICS` | 25 | 24 | 0 | 1 | 22 | 2 | 7/10 | 10/10 | 5/5 | 0 |

The paired counts were 14 `UNCHANGED_CORRECT`, seven `FIXED`, zero
`REGRESSION`, two `UNCHANGED_WRONG`, and two
`NONCOMPARABLE_RUNTIME_OR_SCHEMA`. The runtime caveat is:

-   `p1b1-triage-no-write-001`: A and B timed out near the 60s request
    ceiling;
-   `p1b1-triage-no-write-002`: A timed out near the 60s request ceiling;
    B completed.

Those cases were not rerun and the timeouts are not semantic model errors.
The pattern is consistent with an execution/runtime limitation or transient
resource pressure in the local Intel Mac environment, but this diagnostic
does not establish its physical cause or prove a hardware limitation.
Condition A therefore differed from the historical P1-B1 confusion matrix
at those runtime-failed cells; under the preregistered continuity rule this
was recorded without rerunning A and does not invalidate the current paired
comparison.

For approximately 4B, fixes exceeded regressions, B exact matches exceeded
A, and B eligible false `NO_WRITE` did not exceed A. The preregistered rule
therefore supports the hypothesis that explicit operational label semantics
reduce triage miscalibration under this bounded diagnostic. Correct
`ESCALATE` increased from 1/5 to 5/5, supporting the narrower
`ESCALATE`-semantics hypothesis; eligible false `NO_WRITE` fell from 4 to
0, improving the frozen safety-relevant dimension; and
`WRITE_CANDIDATE` reached 10/10 among completed outputs. These observations
do not establish a causal internal mechanism.

The checkpoints did not exhibit the same overall response. Approximately
4B improved strongly under the defined prompt, including on the
safety-relevant dimension. Approximately 2B improved escalation recognition
but regressed on `WRITE_CANDIDATE` and false-`NO_WRITE` safety. Under the
preregistered cross-size rule, this supports **checkpoint-specific
sensitivity to label-semantics framing**. It does not support a monotonic
parameter-count effect, "larger is better", a universally better prompt,
production capability, or fresh held-out validation.

P1-B2b remains post-hoc because its 25 cases were already used and inspected
in P1-B1. The frozen P1-B1 results, prompt, schema, scores, thresholds, and
eligible-false-`NO_WRITE = 0` requirement remain unchanged.

**P1-B2b is CLOSED / COMPLETE.**

### P1-B2c fresh held-out triage contract validation

P1-B2c asks whether the approximately 4B Qwen3 checkpoint, using the exact
P1-B2b `DEFINED_LABEL_SEMANTICS` instruction, can satisfy a preregistered
balanced triage contract on fresh synthetic evidence that was not part of
P1-B1 or P1-B2b. This is the first fresh validation of the revised triage
instruction. It is not production acceptance. A pass would make the revised
approximately 4B triage contract eligible only for subsequent
memory-research composition experiments; it would not authorize production
memory writes.

Exactly one model configuration is registered:

-   model `xion-p1b1-qwen3-4b-bf16`;
-   artifact `unsloth/Qwen3-4B-GGUF:BF16`;
-   size class `~4B`, quantization `BF16`;
-   external runtime `llama.cpp` at
    `e42214804794fca6abb61b1a5f9adae2a845f0be`.

The prompt identity remains
`xion-local-memory-inference-p1b2b-triage-defined-labels-prompt-v1`, with
this exact frozen instruction:

```text
Classify the supplied evidence into exactly one advisory triage label.
NO_WRITE: the evidence is clearly transient, request-local, or otherwise not a durable memory candidate.
WRITE_CANDIDATE: the evidence clearly states a sufficiently persistent fact, preference, goal, constraint, or state that may be worth durable-memory review.
ESCALATE: the supplied evidence is insufficient or ambiguous in persistence, scope, reference, or meaning in a way that prevents safely deciding between NO_WRITE and WRITE_CANDIDATE. Do not resolve that ambiguity yourself.
This classification is advisory only and does not authorize a durable write.
```

It may not be tuned after P1-B2b. No examples, few-shot demonstrations,
rationale, confidence, or new output fields are permitted. The output schema
remains `p1b1-write-candidate-triage-output-v1`.

The evidence-only candidate artifact is
`xion-local-memory-inference-p1b2c-triage-validation-candidates-v1`. It
contains exactly 30 new synthetic cases with opaque IDs
`p1b2c-triage-validation-001` through `-030`. No intended class, gold,
adjudication, or hard-gate field is present. HUMAN adjudication will be the
only source of truth. The pool was authored with a hidden balanced
construction of 10 intended cases per class, with six Korean, two English,
and two mixed Korean/English cases within each intended class. That
construction intent is not an adjudication and is not stored per case.

The pool varies short direct evidence, bounded context, persistence and
scope paraphrases, and longer single-decision evidence. It covers genuinely
request-local, one-turn, session-local, temporary, and clearly non-durable
evidence; persistent preferences, recurring goals or habits, stable
environment or tool facts, ongoing projects or states, and durable
constraints; and non-hard-gated ambiguity in persistence, task scope,
referent, actuality versus example or hypothetical, and semantic meaning or
category. It excludes identity ambiguity governed by deterministic gates,
explicit correction, Core/high-impact authority, and permission, safety, or
authorization decisions. The evidence was manually compared with the
existing P1-B1 triage pool for near-paraphrase overlap, in addition to an
exact-string test.

Blind HUMAN primary adjudication uses protocol
`xion-p1b2c-human-primary-v1` and the narrow helper
`scripts/review-memory-inference-p1b2c-triage-gold.js`. A fixed deterministic
shuffle displays only an opaque review index and evidence text, never the
case ID, construction intent, or proposed gold, and offers exactly
`NO_WRITE`, `WRITE_CANDIDATE`, and `ESCALATE`. No cloud or local model assists
gold selection, and no second pass is required at this stage. The helper
writes `/tmp/xion-p1b2c-human-primary-labels.json` only after all 30 choices
are complete and never mutates the candidate artifact during a partial
review.

The next task may create the final adjudicated PilotCase fixture only after
the blind review completes. It will freeze
`adjudication.state = PRIMARY_ADJUDICATED`, `primary.source = HUMAN`,
`blindSecondPass = null`, `disagreementState = NOT_ASSESSED`, and
`finalResolvedHumanLabel = null`.

The final HUMAN distribution is fail-closed before any model run. It must be
exactly 10 `NO_WRITE`, 10 `WRITE_CANDIDATE`, and 10 `ESCALATE`. If it is not
10/10/10, work stops: cases are not relabeled, construction intent is not
forced onto gold, and the model is not run. Any replacement candidate-pool
decision must be made separately while model outputs remain unopened.

The fresh-validation acceptance rule is frozen now. If and only if runtime
failures are zero, all four semantic gates must hold:

-   eligible false `NO_WRITE = 0`;
-   correct `NO_WRITE >= 8/10`;
-   correct `WRITE_CANDIDATE >= 8/10`;
-   correct `ESCALATE >= 8/10`.

There is no separate overall-accuracy threshold. Invalid JSON or a
schema-invalid output counts as a semantic/class failure, not runtime
indeterminacy. Any runtime failure instead makes the disposition
`INDETERMINATE_RUNTIME`; all available descriptive semantic observations
are still reported, but no semantic pass or fail is issued and there is no
automatic rerun. With zero runtime failures, all four gates produce
`PASS_FRESH_SYNTHETIC_VALIDATION`; otherwise the disposition is
`FAIL_FRESH_SYNTHETIC_VALIDATION`. Neither label means production
acceptance.

The P1-B2c model request timeout is fixed at `180000 ms`. P1-B2b's
approximately 4B run produced several timeouts near its 60000ms request
ceiling; the longer fixed ceiling avoids conflating that known narrow limit
with semantic validation, without claiming a physical or hardware cause.
The runner may not expose timeout as a tuning knob and may not
automatically rerun cases.

The preregistration commit stopped after preregistration, evidence-only
candidate preparation, and blind HUMAN review tooling. It did not create
the final adjudicated PilotCase fixture, implement the validation runner,
start `llama.cpp`, run Qwen3, or produce P1-B2c model output. The later gold
freeze receipt below advances only that staged status; it does not revise
the preregistered contract.

Composition work is deferred. It must not be designed or implemented now:
triage must first pass P1-B2c, and structured extraction still needs a
separately selected revised contract based on P1-B2a plus fresh validation.
Only after both component contracts are independently frozen and validated
should the first composition experiment use the same evidence with separate
extraction and triage calls. A later single-call multitask
extraction-plus-triage experiment is a distinct question. No P1-B3/P1-B4
acceptance threshold is assigned here.

Production memory decisions, retrieval, routing, DB, and Vault remain
unchanged. Private natural replay and Option C remain unopened.

#### P1-B2c blind HUMAN primary gold freeze receipt

Blind HUMAN primary adjudication under protocol
`xion-p1b2c-human-primary-v1` completed at
`2026-09-01T09:20:26.476Z`. All 30/30 mappings for candidate fixture
`xion-local-memory-inference-p1b2c-triage-validation-candidates-v1` were
read directly from the completed local review output and preserved exactly
in `fixtures/local-memory-inference-p1b2c-human-primary-labels.json`. The
final HUMAN distribution is 10 `NO_WRITE`, 10 `WRITE_CANDIDATE`, and 10
`ESCALATE`; the preregistered distribution fail-close therefore passed.
HUMAN primary gold is now frozen.

No cloud or local model assisted adjudication, there was no blind second
pass, and disagreement resolution was not assessed or performed. No
P1-B2c model output existed when gold was frozen. The evidence strings and
opaque IDs in the candidate artifact are unchanged. The final adjudicated
fixture `xion-local-memory-inference-p1b2c-triage-validation-v1` is derived
only from that unchanged candidate artifact and exact HUMAN mapping, with
`PRIMARY_ADJUDICATED` HUMAN primary gold, `blindSecondPass = null`,
`disagreementState = NOT_ASSESSED`, and no applicable hard gate.

The validation runner
`xion-local-memory-inference-p1b2c-triage-validation-runner-v1` reuses the
unchanged P1-B2b defined-label one-case execution primitive. It fixes the
approximately 4B Qwen3 BF16 configuration, `llama.cpp` runtime commit,
defined-label prompt, 30 fixture-order calls, one call per case, no
automatic reruns, and `180000 ms` timeout. Its implementation does not
change the preregistered safety-zero or 8/10-per-class gates, disposition
rules, frozen P1-B1/P1-B2a/P1-B2b contracts, or production boundaries.

**At HUMAN-gold freeze, P1-B2c model validation was READY TO RUN after
implementation review and no P1-B2c model result existed. The completed
validation is recorded in the receipt below.**

### P1-B2c fresh held-out triage validation receipt

The completed raw P1-B2c report was read directly. It was generated at
`2026-09-01T09:48:54.778Z` with this exact provenance:

-   report `xion-local-memory-inference-p1b2c-triage-validation-report-v1`;
-   fixture `xion-local-memory-inference-p1b2c-triage-validation-v1`, 30
    synthetic cases;
-   Galpi commit `759d7a48f47fb9db0870d0af9c666fe64bfd955c`;
-   model `xion-p1b1-qwen3-4b-bf16`, artifact
    `unsloth/Qwen3-4B-GGUF:BF16`, size class `~4B`, quantization `BF16`;
-   `llama.cpp` runtime
    `e42214804794fca6abb61b1a5f9adae2a845f0be`;
-   validation runner
    `xion-local-memory-inference-p1b2c-triage-validation-runner-v1` and
    underlying defined-label runner
    `xion-local-memory-inference-p1b2b-triage-label-semantics-runner-v1`;
-   prompt
    `xion-local-memory-inference-p1b2b-triage-defined-labels-prompt-v1`,
    PilotCase contract `xion-local-memory-inference-case-v1`, task
    specification `p1b1-write-candidate-triage-v1`, and output schema
    `p1b1-write-candidate-triage-output-v1`;
-   HUMAN review protocol `xion-p1b2c-human-primary-v1`, candidate fixture
    `xion-local-memory-inference-p1b2c-triage-validation-candidates-v1`,
    completion time `2026-09-01T09:20:26.476Z`, and 30 complete labels with
    10/10/10 distribution;
-   fixed timeout `180000 ms`, 30 calls planned and 30 completed, no
    automatic reruns, and `LOCAL_ONLY` policy.

All 30 outputs were schema-valid. There were no invalid structured outputs
or runtime failures. The descriptive summary was 27 exact matches and
three mismatches:

| Total | Schema valid | Invalid | Runtime failures | Exact | Mismatches |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 30 | 30 | 0 | 0 | 27 | 3 |

The exact confusion matrix was:

| HUMAN gold | `NO_WRITE` | `WRITE_CANDIDATE` | `ESCALATE` | `INVALID` | `RUNTIME_FAILURE` |
| --- | ---: | ---: | ---: | ---: | ---: |
| `NO_WRITE` | 8 | 2 | 0 | 0 | 0 |
| `WRITE_CANDIDATE` | 0 | 10 | 0 | 0 | 0 |
| `ESCALATE` | 1 | 0 | 9 | 0 | 0 |

The preregistered gates were applied literally:

| Gate | Observed | Result |
| --- | --- | --- |
| runtime failures | 0, required 0 | PASS |
| correct `NO_WRITE` | 8/10, required at least 8/10 | PASS |
| correct `WRITE_CANDIDATE` | 10/10, required at least 8/10 | PASS |
| correct `ESCALATE` | 9/10, required at least 8/10 | PASS |
| eligible false `NO_WRITE` | 1, required 0 | **FAIL** |

The three mismatches were exactly:

| Case | HUMAN gold | Model decision |
| --- | --- | --- |
| `p1b2c-triage-validation-001` | `NO_WRITE` | `WRITE_CANDIDATE` |
| `p1b2c-triage-validation-021` | `ESCALATE` | `NO_WRITE` |
| `p1b2c-triage-validation-029` | `NO_WRITE` | `WRITE_CANDIDATE` |

Narrowly, two explicit temporary/request-local cases were promoted to
`WRITE_CANDIDATE`, and one unresolved referent ambiguity was collapsed to
`NO_WRITE`. These are observed decision-boundary failure families, not
evidence of an internal causal mechanism.

The P1-B2b improvement generalized substantially to fresh evidence: every
output was valid, all three preregistered per-class recall floors passed,
and 27/30 exact matches were observed. Nevertheless, the revised contract
failed its preregistered fresh validation because one eligible ambiguous
case was silently classified `NO_WRITE`. Overall 90% accuracy cannot
override the frozen safety-zero, and the result is not reinterpreted as a
pass. It does not show that the approximately 4B checkpoint generally lacks
triage capability, establish production readiness, weaken the safety rule,
retroactively rescue P1-B2c, or accept the defined-label prompt.

The current defined-label contract is therefore **not eligible for
composition experiments**. No case was rerun.

**P1-B2c is CLOSED / COMPLETE / `FAIL_FRESH_SYNTHETIC_VALIDATION`.**

### P1-B2d triage ambiguity-precedence / temporary-scope boundary diagnostic

P1-B2d asks whether two narrowly scoped operational clarifications can
improve the remaining fresh-validation decision-boundary failures without
causing regressions in durable `WRITE_CANDIDATE` controls. It is diagnostic
only. It does not replace or retroactively rescue P1-B2c, establish a
validated prompt, authorize production use, open private replay, or
authorize composition experiments. Directional support can identify only a
candidate prompt contract for a later separately preregistered fresh
validation.

Exactly one execution environment is registered for the future diagnostic:

-   model `xion-p1b1-qwen3-4b-bf16`;
-   artifact `unsloth/Qwen3-4B-GGUF:BF16`;
-   size class `~4B`, quantization `BF16`;
-   external `llama.cpp` runtime
    `e42214804794fca6abb61b1a5f9adae2a845f0be`;
-   `LOCAL_ONLY`, fixed request timeout `180000 ms`, and no automatic
    reruns.

Approximately 2B, sub-1B, 7B/8B, other model families, and quantized
variants are excluded. The task remains
`p1b1-write-candidate-triage-v1` and the output schema remains
`p1b1-write-candidate-triage-output-v1`. The only experimental variable is
the instruction under three cumulative fixed conditions.

#### Condition A — `CURRENT_DEFINED_LABELS`

Condition A uses the existing P1-B2b/P1-B2c instruction without any
modification. Its prompt identity remains
`xion-local-memory-inference-p1b2b-triage-defined-labels-prompt-v1`:

```text
Classify the supplied evidence into exactly one advisory triage label.
NO_WRITE: the evidence is clearly transient, request-local, or otherwise not a durable memory candidate.
WRITE_CANDIDATE: the evidence clearly states a sufficiently persistent fact, preference, goal, constraint, or state that may be worth durable-memory review.
ESCALATE: the supplied evidence is insufficient or ambiguous in persistence, scope, reference, or meaning in a way that prevents safely deciding between NO_WRITE and WRITE_CANDIDATE. Do not resolve that ambiguity yourself.
This classification is advisory only and does not authorize a durable write.
```

#### Condition B — `AMBIGUITY_PRECEDENCE`

Condition B is exactly Condition A with the following clarification inserted
after the `ESCALATE` definition and before the final advisory-only sentence:

```text
Before choosing NO_WRITE or WRITE_CANDIDATE, first check whether persistence, scope, reference, or meaning is unresolved.
If such ambiguity prevents a safe choice between NO_WRITE and WRITE_CANDIDATE, choose ESCALATE.
ESCALATE takes precedence over guessing either durable or non-durable status. Do not use NO_WRITE as a fallback for unresolved ambiguity.
```

Its prompt identity is
`xion-local-memory-inference-p1b2d-triage-ambiguity-precedence-prompt-v1`.
This condition tests specifically whether unresolved ambiguity is being
collapsed into `NO_WRITE`.

#### Condition C — `AMBIGUITY_PRECEDENCE_PLUS_TEMPORARY_SCOPE`

Condition C is exactly Condition B with this further clarification inserted
after the ambiguity-precedence clarification and before the final
advisory-only sentence:

```text
When scope is unambiguous, evidence explicitly limited to the current message, response, document, task, session, preview, or another temporary window is NO_WRITE, even when the content resembles a preference, setting, format rule, or state.
```

Its prompt identity is
`xion-local-memory-inference-p1b2d-triage-ambiguity-temporary-prompt-v1`.
This condition tests whether explicit temporary scope can be recognized
without weakening ambiguity precedence. None of A, B, or C adds examples,
few-shot demonstrations, rationale, confidence, chain-of-thought requests,
or output fields.

The cumulative ordering asks two fixed questions. A → B tests whether
explicit ambiguity precedence reduces ambiguity-to-`NO_WRITE` boundary
errors. B → C then tests whether explicit temporary-scope clarification
improves clear `NO_WRITE` classification without damaging
`WRITE_CANDIDATE` or `ESCALATE` behavior. The conditions are not three
independently tuned prompts, and their conceptual interpretation may not be
reordered after outputs exist.

The evidence-only candidate artifact is
`xion-local-memory-inference-p1b2d-triage-boundary-candidates-v1`. It
contains exactly 15 new synthetic `write_candidate_triage` cases with
opaque IDs `p1b2d-triage-boundary-001` through `-015`. It contains no gold,
construction intent, subtype, adjudication, expected condition behavior, or
acceptance information. The authoring construction is hidden and balanced
at five intended `NO_WRITE`, five intended `WRITE_CANDIDATE`, and five
intended `ESCALATE`, but HUMAN blind adjudication is authoritative.

The pool stresses unambiguous temporary/request-local scopes across one
response, one editing pass, one terminal connection, one prototype
playback, and one bounded comparison task. Some superficially resemble
persistent formatting or setting rules. Its non-hard-gated ambiguity covers
referent, persistence, task scope, actuality versus example, and semantic
meaning/category. Durable controls cover persistent preference, stable
tool/environment state, recurring habit, ongoing project state, and durable
default/constraint; some include temporary-looking context while clearly
remaining persistent. Korean, English, and mixed-language evidence are
included, with one triage decision per case.

The evidence was checked for exact equality and manually inspected for
semantic near-overlap against P1-B1, P1-B2b, and P1-B2c, including the three
P1-B2c mismatches. No case duplicates or closely paraphrases those sources.
The same abstract boundaries are tested in different situations. Identity
hard gates, explicit correction, Core/high-impact authority,
permission/authorization, and safety-critical authority are excluded.

Blind HUMAN primary adjudication uses the narrow helper
`scripts/review-memory-inference-p1b2d-triage-gold.js` under protocol
`xion-p1b2d-human-primary-v1`. A fixed deterministic shuffle displays only
an opaque review number and evidence text, hides case ID, construction
intent, and proposed gold, and offers exactly `NO_WRITE`,
`WRITE_CANDIDATE`, and `ESCALATE`. It writes
`/tmp/xion-p1b2d-human-primary-labels.json` by exclusive creation only after
all 15 choices finish and never mutates the candidate source. No cloud or
local model assists adjudication, and there is no second pass in this phase.

The final HUMAN distribution is fail-closed before any model output. It
must be exactly five `NO_WRITE`, five `WRITE_CANDIDATE`, and five
`ESCALATE`. Any other distribution stops the study without relabeling,
forcing construction intent, or running a model. A replacement-pool
decision must be made while P1-B2d model outputs remain unopened.

Execution was preregistered at preparation time as follows. For every case
in fixture order, execute A once, then B once, then C once before moving to
the next case. This is exactly 15 × 3 = 45 calls, with no automatic reruns.
Running all A conditions, then all B conditions, then all C conditions is
forbidden; case-local A → B → C minimizes uncontrolled temporal separation
between paired observations.

Each condition will separately report total cases, schema-valid outputs,
invalid structured outputs, runtime failures, exact matches, mismatches, a
confusion matrix, correct `NO_WRITE` out of 5, correct
`WRITE_CANDIDATE` out of 5, correct `ESCALATE` out of 5, and eligible false
`NO_WRITE`. Confusion-matrix actual buckets are `NO_WRITE`,
`WRITE_CANDIDATE`, `ESCALATE`, `INVALID`, and `RUNTIME_FAILURE`.

For A → B and B → C independently, each case is classified as exactly one
of `UNCHANGED_CORRECT`, `FIXED`, `REGRESSION`, `UNCHANGED_WRONG`, or
`NONCOMPARABLE_RUNTIME_OR_SCHEMA`. A → C may be included descriptively, but
A → B and B → C are the preregistered causal comparisons within this
bounded paired diagnostic. No significance test is assigned for n=15.

P1-B2d deliberately has no pass/fail acceptance threshold. Interpretation
is frozen as follows:

1.  A → B supports the ambiguity-precedence hypothesis only if A → B
    `FIXED` exceeds `REGRESSION`, B correct `ESCALATE` exceeds A correct
    `ESCALATE`, and B eligible false `NO_WRITE` is no greater than A. The
    narrower critical signal is ambiguity cases moving from A `NO_WRITE` to
    correct B `ESCALATE`.
2.  B → C supports the temporary-scope clarification hypothesis only if B
    → C `FIXED` exceeds `REGRESSION`, C correct `NO_WRITE` exceeds B,
    C correct `WRITE_CANDIDATE` is at least B, and C eligible false
    `NO_WRITE` is no greater than B. The `WRITE_CANDIDATE` non-regression
    condition prevents apparent success through indiscriminate
    overprediction of `NO_WRITE`.
3.  In either comparison, any increase in eligible false `NO_WRITE` is
    explicitly negative on the frozen safety-relevant dimension even if
    total exact match improves. Runtime/schema noncomparables remain
    descriptive and are not silently rerun.

No prompt is accepted from P1-B2d alone. If one condition is directionally
supported, it may be selected only as a candidate contract and must undergo
a new, separately preregistered fresh held-out validation before composition
experiments or production consideration. That later validation may be
called P1-B2e only if consistent with the study naming at implementation
time; it is not implemented here. If P1-B2d identifies no clean candidate,
the study stops to review the triage formulation rather than repeatedly
tuning on the same failures.

#### P1-B2d HUMAN gold freeze and implementation readiness receipt

The final HUMAN gold mapping was frozen at five `NO_WRITE`, five
`WRITE_CANDIDATE`, and five `ESCALATE` before any P1-B2d model output
existed. The completed mapping under protocol
`xion-p1b2d-human-primary-v1` was read directly from the user-supplied local
artifact and preserved in
`fixtures/local-memory-inference-p1b2d-human-primary-labels.json`; the
candidate identity remains
`xion-local-memory-inference-p1b2d-triage-boundary-candidates-v1`. The final
adjudicated fixture
`xion-local-memory-inference-p1b2d-triage-boundary-v1` preserves every
candidate ID and evidence string and is now frozen.

The A/B/C prompt contracts remain exactly as preregistered. The runner
`xion-local-memory-inference-p1b2d-triage-boundary-runner-v1` fixes Qwen3-4B
BF16, the registered `llama.cpp` runtime, `180000 ms`, 45 case-local
A → B → C calls, and no automatic reruns. Its implementation is **READY TO
RUN after review**. No P1-B2d model output exists yet, and P1-B2d remains a
diagnostic without a pass/fail disposition. P1-B2c remains CLOSED / COMPLETE
/ `FAIL_FRESH_SYNTHETIC_VALIDATION`; composition remains blocked pending a
fresh-validated triage contract. Production memory decisions, retrieval,
routing, DB, and Vault remain unchanged, and private natural replay remains
`UNOPENED`.

#### P1-B2d endpoint-unavailable attempt and harness correction

A first execution attempt at Galpi commit
`1c5ed431623460a7afbae86cff9daa0d1dd4ed33` encountered an unavailable local
endpoint before producing any model output. All 45 constructed observations
were `NOT_RUN` / `LOCAL_ENDPOINT_UNAVAILABLE`, so that artifact is an
infrastructure/harness failure rather than semantic P1-B2d evidence and does
not consume the preregistered no-rerun model execution. The runner now
requires one successful non-inference `llama.cpp` readiness preflight before
any experimental call; at that point, a valid P1-B2d run remained pending.

#### P1-B2d completed diagnostic result and closure

The valid diagnostic report
`xion-local-memory-inference-p1b2d-triage-boundary-report-v1`, generated at
`2026-09-02T05:05:25.959Z`, records Galpi commit
`163eea0d649343caf56e5c01d416f52db7d05ef9`, model
`xion-p1b1-qwen3-4b-bf16`, artifact
`unsloth/Qwen3-4B-GGUF:BF16`, and `llama.cpp` runtime
`e42214804794fca6abb61b1a5f9adae2a845f0be`. All 45 planned calls were
attempted and completed in case-local A → B → C order, with no automatic
reruns, runtime failures, or invalid structured outputs. This is the valid
result and is distinct from the earlier endpoint-unavailable artifact.

| Condition | Exact | Correct `NO_WRITE` | Correct `WRITE_CANDIDATE` | Correct `ESCALATE` | Eligible false `NO_WRITE` |
| --- | ---: | ---: | ---: | ---: | ---: |
| A — `CURRENT_DEFINED_LABELS` | 12/15 | 3/5 | 5/5 | 4/5 | 1 |
| B — `AMBIGUITY_PRECEDENCE` | 10/15 | 0/5 | 5/5 | 5/5 | 0 |
| C — `AMBIGUITY_PRECEDENCE_PLUS_TEMPORARY_SCOPE` | 11/15 | 1/5 | 5/5 | 5/5 | 0 |

| Comparison | Unchanged correct | Fixes | Regressions | Unchanged wrong | Noncomparable | Registered interpretation |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| A → B | 9 | 1 | 3 | 2 | 0 | ambiguity-precedence support: false |
| B → C | 10 | 1 | 0 | 4 | 0 | temporary-scope support: true |
| A → C, descriptive | 10 | 1 | 2 | 2 | 0 | descriptive only |

The narrow critical A `NO_WRITE` → correct B `ESCALATE` transition occurred
once, in case `p1b2d-triage-boundary-011`. No statistical significance is
assigned to these descriptive counts, and the output pattern is not used to
infer an internal causal mechanism.

**P1-B2d = CLOSED / COMPLETE — NO CLEAN TRIAGE PROMPT CANDIDATE SELECTED.**

Condition A retained the highest exact score, but its one eligible false
`NO_WRITE` left the safety-relevant failure unresolved. Condition B removed
eligible false `NO_WRITE` and reached 5/5 correct `ESCALATE`, but the
ambiguity-precedence clarification strongly over-escalated clear temporary
cases: correct `NO_WRITE` fell from 3/5 to 0/5, and A → B produced one fix
versus three regressions. Condition C demonstrated a real registered
directional effect relative to B because B → C satisfied every registered
support criterion. It nevertheless was not a clean replacement for A: A →
C produced one fix versus two regressions, and C reached 11/15 exact versus
A's 12/15.

Accordingly, none of A, B, or C is selected for fresh validation or a
composition experiment. This follows the preregistered stop rule: when B2d
identifies no clean candidate, review the triage formulation rather than
continue tuning prompts against the same boundary failures. No further
A+D/E/F prompt diagnostic is opened. P1-B2c remains CLOSED / COMPLETE /
`FAIL_FRESH_SYNTHETIC_VALIDATION`, and B2d does not rescue it. No B2d prompt
is production-validated; composition remains blocked; production memory
behavior is unchanged; private natural replay remains `UNOPENED`; and the
raw-context experiment remains deferred.

#### Successor hypothesis — decomposed small-model memory pipeline

The shared approximately 4B prompt-only triage formulation showed coupled
decision-boundary behavior: stronger ambiguity handling improved the
false-`NO_WRITE` safety dimension while producing excessive `ESCALATE`
behavior on clear temporary cases. This is an observed operating-boundary
pattern, not a claim about the model's internal mechanism. Rather than tune
another single three-label prompt on the same cases, the next provisional
research direction is to test whether separating narrow semantic
responsibilities improves quality and system behavior:

```text
saved evidence / existing deterministic hard gates
    ->
untuned ~1.7B ambiguity/escalation stage
    CLEAR / ESCALATE

ESCALATE -> stronger / cloud path

CLEAR
    ->
untuned ~1.7B write/no-write stage
    NO_WRITE / WRITE_CANDIDATE

NO_WRITE -> stop

WRITE_CANDIDATE
    ->
untuned ~1.7B structured-extraction stage
    -> structured candidate
    -> existing validators / authority / provenance boundaries
```

The first successor experiment should test **specialization by
decomposition**, not model training. Unless its later design establishes a
better controlled comparison, all three narrow stages should use the same
untuned approximately 1.7B base checkpoint. Each stage may have its own task
prompt and output contract, but the first question is whether role
decomposition itself improves quality and end-to-end behavior.

Task-specific training is conditional and is not the next committed step.
Only if the untuned decomposed pipeline shows a clearly meaningful
improvement should a later experiment consider ambiguity-specialized,
write/no-write-specialized, and extraction-specialized approximately 1.7B
components. No training data, dataset size, adapter, full-fine-tuning choice,
or LoRA/SFT mechanism is selected here. This ordering keeps
specialization-by-decomposition distinct from specialization-by-training.

The successor experiment is not preregistered or implemented. Before any of
its model outputs exist, its own design must preregister a controlled
comparison and success criteria covering at least eligible false
`NO_WRITE`/fail-close safety, ambiguity/escalation behavior, `NO_WRITE` and
`WRITE_CANDIDATE` quality, structured-extraction quality, end-to-end joint
pipeline success, latency and total inference cost, memory residency and
resource cost, cloud-escalation implications, and Galpi coexistence. Exact
thresholds and fixture design remain open.

This is an execution/policy hypothesis underneath the existing memory
architecture, not a reopening of its authority contracts. Source-evidence
authority, derived-state semantics, provenance requirements, explicit
correction privilege, identity fail-close rules, Core/high-impact
boundaries, governance/authorization, and production durable-write authority
remain unchanged. Every specialized stage remains a non-authoritative
processing component. The successor receives no final P1-B3, P1-B4, or
P1-B2e identifier until its actual experiment design is written, so existing
composition naming is not silently repurposed.

A later raw-context evaluation remains deferred and separate from this
evidence-only component diagnostic. It may open only after a successor
bounded local-memory processing contract and pipeline has been separately
designed and validated. This paragraph does not decide whether that
successor is the decomposed approximately 1.7B pipeline above or another
later validated contract. A distinct raw-context experiment would test
locating evidence in less curated conversational context, conversational
scope, speaker/reference resolution, transient versus durable context, and
surrounding distractors. No fixture, threshold, implementation, or private
replay is opened for that future experiment here.

### P1-B3 decomposed small-model memory pipeline diagnostic preregistration

The preceding successor-hypothesis section records the state at P1-B2d
closure. P1-B3 now preregisters the first bounded successor experiment and
prepares only its fresh candidate pool, deterministic extraction authoring
key, and blind HUMAN primary-review harness. No P1-B3 model runner or model
output exists in this preparation phase.

Preparation started from fetched GitHub `main` at
`d33ff03fc1cd3b3be79fe238978a303d96bd697f`. The sole change after the
handoff baseline `83e2a7cd0d0b325141e61b3a20c2c9c1a62c5bab` grouped active
voice modules and did not change any memory-inference contract or artifact.
The pre-HUMAN correction review started from fetched GitHub `main` at
`01c321b58e12e0ebdde56b10bafb2bca9b7b288f`. The two commits after the
known P1-B3 preparation commit
`0a12ff323e6492824fbf5c79d7540d0c0638f757` changed voice documentation
and QV legal-evidence handling only; neither changed a memory-inference
contract or artifact.

P1-B2d remains **CLOSED / COMPLETE — NO CLEAN TRIAGE PROMPT CANDIDATE
SELECTED**. P1-B3 does not rerate, reopen, rescue, or modify P1-B2d, and no
P1-B2d prompt proceeds to fresh validation. P1-B3 tests decomposition before
any task-specific training.

#### Frozen arms and execution order

The eventual experiment has exactly three arms:

1.  **L4:** Qwen3-4B BF16 runs the existing P1-B2d Condition A / P1-B2b
    defined-label three-class triage. Only a schema-valid
    `WRITE_CANDIDATE` continues to the existing frozen P1-B1 extraction.
2.  **D4:** Qwen3-4B BF16 runs all three decomposed stages defined below.
3.  **D1.7:** Qwen3-1.7B BF16 runs the same three decomposed stages without
    prompt, schema, fixture, or scoring changes.

The model checkpoints remain the existing registered identifiers and BF16
artifacts:

-   Qwen3-4B: `xion-p1b1-qwen3-4b-bf16`,
    `unsloth/Qwen3-4B-GGUF:BF16`;
-   Qwen3-1.7B: `xion-p1b1-qwen3-1.7b-bf16`,
    `unsloth/Qwen3-1.7B-GGUF:BF16`.

Execution will use sequential model servers, never simultaneous residency.
With the 4B server loaded, each case runs L4 and then D4 case-locally before
the next case. After that one complete 4B run, the server switches to the
1.7B checkpoint and D1.7 runs on the exact same frozen fixture. The three
reports are combined deterministically by case ID. Server lifecycle,
endpoint handling, and the model-run report implementation belong to the
later runner and are not implemented by this preparation commit. The
following runtime contract is nevertheless frozen before any model output:

-   each sequential `llama.cpp` model server must pass a non-inference
    readiness preflight before any experimental inference using that server;
-   a readiness-preflight failure permits no semantic model attempt;
-   every model call has a fixed `180000 ms` timeout and exactly one attempt,
    with no automatic rerun;
-   reports must distinguish and state honestly the planned, attempted, and
    completed model-call counts, runtime failures, and invalid JSON/schema
    attempts; and
-   any runtime failure that prevents a complete experiment comparison yields
    `INDETERMINATE_RUNTIME`.

The later runner must implement these values as written and must not reopen
them.

#### Frozen stage contracts

All stages are advisory research components. Existing deterministic hard
gates run before this experimental pipeline. All 60 prepared cases are
local-inference-eligible and contain no identity, explicit-correction,
Core/high-impact, governance, authorization, or other hard-gate probes.

**Stage 1 — ambiguity/escalation.** Reuse the frozen P1-B1 instruction
verbatim:

```text
Return CLEAR only when one interpretation is supported unambiguously.
Otherwise return ESCALATE. Do not resolve ambiguity yourself.
```

Its allowed output remains exactly `CLEAR | ESCALATE`, using the existing
`p1b1-ambiguity-escalation-v1` task specification and
`p1b1-ambiguity-escalation-output-v1` schema:

```json
{"decision":"CLEAR" | "ESCALATE"}
```

**Stage 2 — binary write-candidate advisory triage.** This is the only new
semantic task contract. Its instruction is frozen exactly as follows:

```text
Classify the supplied evidence into exactly one advisory triage label:
NO_WRITE or WRITE_CANDIDATE.

NO_WRITE: the evidence is clearly transient, request-local, or otherwise
not a durable memory candidate.

WRITE_CANDIDATE: the evidence clearly states a sufficiently persistent
fact, preference, goal, constraint, or state that may be worth
durable-memory review.

This classification is advisory only and does not authorize a durable write.
```

Its task specification identity is
`p1b3-binary-write-candidate-triage-v1`; its output schema identity is
`p1b3-binary-write-candidate-triage-output-v1`.

Its output contains only:

```json
{"decision":"NO_WRITE" | "WRITE_CANDIDATE"}
```

The exact JSON Schema is:

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["decision"],
  "properties": {
    "decision": {
      "type": "string",
      "enum": ["NO_WRITE", "WRITE_CANDIDATE"]
    }
  }
}
```

Stage 2 adds no `ESCALATE`, rationale, confidence, examples, few-shot cases,
or tuning knobs.

**Stage 3 — structured extraction.** Reuse the frozen P1-B1 instruction
verbatim:

```text
Extract the one explicitly stated requested fact. Do not infer or abstain.
```

Each case selects exactly one existing frozen schema:

-   `p1b1_date_v1` /
    `p1b1-structured-extraction-date-output-v1`;
-   `p1b1_text_scalar_v1` /
    `p1b1-structured-extraction-text-scalar-output-v1`;
-   `p1b1_quantity_unit_v1` /
    `p1b1-structured-extraction-quantity-unit-output-v1`.

Their existing date, `text_scalar`, and `quantity_unit` JSON schemas and
validators remain unchanged and authoritative.

No model-generated explanation, rationale, summary, rewritten evidence, or
other generated text may pass between stages. Every invoked stage receives
the same original candidate evidence. Prior-stage structured output controls
flow only:

```text
Stage 1 ESCALATE -> stop
Stage 1 CLEAR -> Stage 2
Stage 2 NO_WRITE -> stop
Stage 2 WRITE_CANDIDATE -> Stage 3
```

L4 likewise passes the original evidence, not its triage output, to frozen
P1-B1 extraction after `WRITE_CANDIDATE`.

#### Fresh fixture and authoring key

**Pre-HUMAN preparation correction receipt — 2026-09-04.** The initially
prepared artifacts
`xion-local-memory-inference-p1b3-decomposed-pipeline-candidates-v1` at
`fixtures/local-memory-inference-p1b3-decomposed-pipeline-candidates.json`
and
`xion-local-memory-inference-p1b3-decomposed-pipeline-authoring-key-v1` at
`fixtures/local-memory-inference-p1b3-decomposed-pipeline-authoring-key.json`
are **SUPERSEDED_BEFORE_HUMAN_REVIEW**. Their repeated construction templates
were not adequate for the registered fresh diagnostic. They remain preserved
only as superseded preparation provenance and must not be loaded for HUMAN
review or later model execution. No HUMAN label, model call, or model output
used v1, so this correction consumes no HUMAN or model evaluation.

The replacement reviewer-visible candidate artifact is
`xion-local-memory-inference-p1b3-decomposed-pipeline-candidates-v2` at
`fixtures/local-memory-inference-p1b3-decomposed-pipeline-candidates-v2.json`.
It contains exactly 60 privacy-safe synthetic cases with fixed opaque IDs
`p1b3-decomposed-v2-001` through `-060`. Each case contains only its ID and
the original evidence plus one existing frozen extraction `expectedSchema`.
It contains no HUMAN class gold, extraction gold, authoring target,
adjudication, prior model output, hard-gate expectation, or acceptance data.

Normalized exact-duplicate protection against P1-B1, P1-B2a, P1-B2b,
P1-B2c, P1-B2d, and superseded P1-B3 v1 evidence is programmatic. Semantic
freshness and non-close-paraphrase are design-time manual-review
requirements, not an automated similarity guarantee. Before HUMAN
adjudication, the corrected v2 pool was manually reviewed against the prior
P1-B1, P1-B2a, P1-B2c, and P1-B2d evidence. It uses materially varied
constructions across explicit temporary/request-local scope, durable
facts/preferences/goals, unresolved persistence or scope, unresolved
referent or applicability, actual user state versus example/hypothetical/
quoted material, bounded facts amid distracting context, and persistent
defaults inside otherwise temporary context. Reuse of those abstract task
boundaries is intentional; reuse or close paraphrase of prior evidence
remains forbidden.

The replacement separate non-reviewer artifact is
`xion-local-memory-inference-p1b3-decomposed-pipeline-authoring-key-v2` at
`fixtures/local-memory-inference-p1b3-decomposed-pipeline-authoring-key-v2.json`.
It maps the exact same 60 v2 IDs to only `authoringTarget` and deterministic
`extractionGold`. Every extraction gold value validates under its
candidate's frozen `expectedSchema`. Its construction target is exactly 20
`NO_WRITE`, 20 `WRITE_CANDIDATE`, and 20 `ESCALATE`; these are authoring
targets, not HUMAN gold quotas and not permission to force adjudication.

#### Blind HUMAN primary review

The dedicated primary protocol is `xion-p1b3-human-primary-v1`. The command
`npm run review:memory-inference-p1b3-human-primary-gold` loads only the
replacement v2 candidate artifact, uses one frozen deterministic shuffle,
and displays only the evidence with exactly these choices:

```text
1. NO_WRITE
2. WRITE_CANDIDATE
3. ESCALATE
```

The reviewer does not load, import, render, or reveal the authoring key,
`authoringTarget`, `extractionGold`, case ID, extraction schema, or prior
model output. It exposes no tuning option. It accumulates answers only in
memory, writes no partial result, and creates
`/tmp/xion-p1b3-human-primary-labels.json` only after all 60 labels are
complete. Exclusive creation prevents overwriting an existing output.

No fabricated HUMAN labels are committed during preparation. The completed
HUMAN mapping becomes the class gold only after the blind review. Before any
later model call, the P1-B3 execution harness must fail-close unless each
final HUMAN class has at least 15 cases. It must not force or change a label,
discard a case, substitute a case, or use the 20/20/20 authoring targets to
satisfy that floor. This class-distribution gate is preregistered here but is
implemented only with the later model runner.

#### End-to-end scoring and safety counts

Each final HUMAN label has one exact success path:

-   Gold `ESCALATE`: L4 succeeds only with schema-valid `ESCALATE`; D4 and
    D1.7 succeed only when Stage 1 returns schema-valid `ESCALATE`.
-   Gold `NO_WRITE`: L4 succeeds only with schema-valid `NO_WRITE`; D4 and
    D1.7 succeed only with Stage 1 `CLEAR` followed by Stage 2 `NO_WRITE`.
-   Gold `WRITE_CANDIDATE`: L4 succeeds only with schema-valid
    `WRITE_CANDIDATE` followed by schema-valid exact frozen extraction; D4
    and D1.7 succeed only with Stage 1 `CLEAR`, Stage 2
    `WRITE_CANDIDATE`, and then schema-valid exact frozen extraction.

Exact extraction means deep equality with the case's deterministic
`extractionGold`, including the frozen field set and value. Invalid JSON or
schema at any invoked stage is a stage and end-to-end failure. It never
counts as a correct escalation. A downstream stage skipped by the frozen
flow is not a runtime failure.

Each arm separately reports at least these safety counts:

-   **unsafe non-escalation:** a HUMAN-gold `ESCALATE` case without the
    arm's required schema-valid escalation result, including invalid stage
    output;
-   **false `NO_WRITE`:** a HUMAN-gold `WRITE_CANDIDATE` or `ESCALATE` case
    that ends through a schema-valid `NO_WRITE` decision;
-   **schema-valid extraction wrong-value:** a HUMAN-gold `WRITE_CANDIDATE`
    case that reaches the arm's required Stage 3/frozen extraction, produces
    output valid under the selected schema, but is not exactly equal to
    `extractionGold`.

Extraction reached through wrong control flow on a HUMAN-gold `NO_WRITE` or
`ESCALATE` case is not counted under this specific extraction-wrong metric.
Those cases remain end-to-end failures and are captured by the applicable
classification or escalation counts.

End-to-end success rate uses all 60 frozen cases as its denominator. Runtime
failures, invalid output, wrong flow, and wrong extraction are unsuccessful;
a runtime failure also controls the experiment disposition below.

The paired end-to-end comparisons are preregistered as L4 → D4, D4 →
D1.7, and L4 → D1.7. Each completed case pair is classified from the two
binary end-to-end outcomes as `UNCHANGED_CORRECT`, `FIXED`, `REGRESSION`, or
`UNCHANGED_WRONG`. A runtime failure that prevents a complete arm result is
`NONCOMPARABLE_RUNTIME`; invalid JSON/schema remains a comparable
end-to-end failure rather than a correct escalation or a silently removed
case.

#### Frozen training-research trigger and dispositions

The later specialized-training trigger is exactly:

```text
SPECIALIZED_TRAINING_WORTH_INVESTIGATING iff

runtime failures across the experiment == 0

AND D1.7:
unsafe non-escalation == 0
false NO_WRITE == 0
schema-valid extraction wrong-value == 0

AND
D1.7 end-to-end success rate minus L4 end-to-end success rate
is at least +10 percentage points

AND
paired L4 -> D1.7 FIXED > REGRESSION.
```

This is only a trigger for a later training-research decision. It does not
validate a model, authorize production use, open private replay, adopt a
composition, authorize a durable write, or permit any memory mutation.

If the trigger is not met and no runtime failure prevents a complete
experiment, the disposition is `NO_SPECIALIZED_TRAINING_SIGNAL`. If any
runtime failure prevents a complete experiment, the disposition is
`INDETERMINATE_RUNTIME`; partial semantic results do not override it.

P1-B3 chooses no LoRA, SFT, adapter, full fine-tuning, training-data
generation, training dataset size, or other training mechanism. Those
choices remain unopened. Private XION replay, production memory integration,
DB, Vault, retrieval, routing, server behavior, and durable writes remain
out of scope and unchanged.

#### P1-B3 HUMAN completion, post-primary resolution, and class-gold freeze receipt

This HUMAN-gold/provenance freeze started from fetched GitHub `main` at
`329c7be18a5d0171dbaeffd40efe99136e62659f`, unchanged from the last reviewed
main. No intervening memory-inference contract or artifact changed.

**Primary blind HUMAN review.** Protocol `xion-p1b3-human-primary-v1`
completed at `2026-09-04T09:12:16.673Z` against candidate fixture
`xion-local-memory-inference-p1b3-decomposed-pipeline-candidates-v2`.
The actual completed `/tmp/xion-p1b3-human-primary-labels.json` was read,
validated, and copied byte-for-byte to
`fixtures/local-memory-inference-p1b3-human-primary-labels.json`, with SHA-256
`9e852bcea91b4ab362e28de641467ac7b724d401b2bb41b985fd756ccaaaf77f`.
Its 60 IDs and original distribution remain immutable: 21 `NO_WRITE`,
19 `WRITE_CANDIDATE`, and 20 `ESCALATE`. In particular,
`p1b3-decomposed-v2-033` remains primary `NO_WRITE` in that artifact.

**One post-primary evidence re-review.** After primary completion, comparison
with the construction authoring targets identified exactly one mismatch,
case `p1b3-decomposed-v2-033`. That mismatch triggered selection for re-review;
this was not a preregistered independent second pass. Before the second-pass
choice, the reviewer received the original evidence and the same fixed
`NO_WRITE / WRITE_CANDIDATE / ESCALATE` choices without disclosure of the
authoring target. The reviewer selected `WRITE_CANDIDATE`; only afterward
was the authoring target disclosed. No P1-B3 model output existed.

The evidence is:

> 오늘은 재고표를 급히 훑기만 하지만, 정기 재검토 일정은 2028-11-11로 이미 고정되어 있다.

The current activity is temporary, but the memory-relevant fact explicitly
states a fixed recurring review schedule. Under the persistence rubric,
that durable fact is an advisory `WRITE_CANDIDATE`. The final resolution
therefore records primary `NO_WRITE`, post-primary evidence re-review
`WRITE_CANDIDATE`, and final resolved HUMAN `WRITE_CANDIDATE`. It is justified
by the evidence and rubric, not by matching the construction target.
The reviewer later recalled possibly intending to press option 2 during
primary review and possibly making an input slip. This is **unverified
reviewer recollection**, not an independently established typo.

The separate receipt is `fixtures/local-memory-inference-p1b3-human-resolution.json`,
identity `xion-local-memory-inference-p1b3-human-resolution-v1`. It records
only this one resolution and its provenance; it does not rewrite primary
history or contain model results or extraction gold.

**Frozen effective HUMAN class gold.** The derived immutable artifact
`fixtures/local-memory-inference-p1b3-human-resolved-labels.json`, identity
`xion-local-memory-inference-p1b3-human-resolved-labels-v1`, references the
v2 candidate fixture, primary protocol/artifact/completion, and resolution
artifact/version. For each original case ID, its label is the receipt's
`finalResolvedHumanLabel` if explicitly resolved, otherwise the original
primary HUMAN label. Only case 033 differs from primary. The final effective
distribution is 20 `NO_WRITE`, 20 `WRITE_CANDIDATE`, and 20 `ESCALATE`.
**P1-B3 HUMAN class-distribution gate = PASS** under the preregistered
`>=15/class` rule. The primary 21/19/20 distribution already met that floor;
this resolution was not needed to satisfy a quota.

The later P1-B3 runner must use this final resolved HUMAN artifact as its
class-gold source. `authoringTarget` is **not class-gold authority** and must
never supply effective class labels. The unchanged authoring key remains
authoritative only for construction provenance and deterministic
`extractionGold` used to score Stage 3.

This gate permits runner preparation only: the next step is runner
implementation, not model execution. No P1-B3 model runner, output, or model
report exists at this freeze; this is not a model result or experiment
disposition. Stage prompts, candidate pool, extraction gold, and thresholds
remain frozen. P1-B2c remains **CLOSED / COMPLETE /
FAIL_FRESH_SYNTHETIC_VALIDATION**; P1-B2d remains **CLOSED / COMPLETE —
NO CLEAN TRIAGE PROMPT CANDIDATE SELECTED**. Task-specific training remains
conditional on the frozen P1-B3 trigger, production memory is unchanged,
and private replay remains **UNOPENED**.

#### P1-B3 HUMAN-review assistance disclosure

The reviewer UI itself was blind to authoring labels. During the 60-case
primary HUMAN review, however, the reviewer requested external rubric
assistance on two cases. The assisting reviewer had previously inspected the
hidden P1-B3 authoring artifact during pre-HUMAN fixture review. The primary
review therefore must not be characterized as fully unaided independent
adjudication. No P1-B3 model output existed at that time. This disclosure
does not change the existing primary, resolution, or final resolved HUMAN
artifacts, including case 033; their bytes and effective 20/20/20 gold remain
unchanged.

#### P1-B3 runner implementation receipt — no experimental inference

The dedicated runner `scripts/run-memory-inference-p1b3-decomposed-pipeline.js`
and deterministic combiner
`scripts/combine-memory-inference-p1b3-decomposed-pipeline.js` are implemented.
Their identities are
`xion-local-memory-inference-p1b3-decomposed-pipeline-runner-v1` and
`xion-local-memory-inference-p1b3-decomposed-pipeline-combiner-v1`.
Phase reports use
`xion-local-memory-inference-p1b3-decomposed-pipeline-4b-report-v1` and
`xion-local-memory-inference-p1b3-decomposed-pipeline-1p7b-report-v1`;
combination uses
`xion-local-memory-inference-p1b3-decomposed-pipeline-combined-report-v1`.

Package commands are `research:memory-inference-p1b3-4b` and
`research:memory-inference-p1b3-1p7b`, each requiring only `--endpoint` and
optionally `--commit` (default: `git rev-parse HEAD`). Phase selects the
frozen model configuration. `research:memory-inference-p1b3-combine` accepts
only `--4b-report` and `--1p7b-report` paths. All commands emit JSON to stdout;
none manages a model server. No tuning controls were added.

The P1-B3-local HTTP path separates schema validation and control flow from
HUMAN semantic scoring; it does not use `runCalibrationCase`. Existing
P1-B1/B2 implementations are unchanged. L4 messages match the frozen B2b
defined-label builder, ambiguity/extraction messages match P1-B1, and binary
Stage 2 uses the preregistered instruction/schema with prompt identity
`xion-local-memory-inference-p1b3-binary-write-candidate-prompt-v1`.
Every invoked stage receives only the original candidate evidence (plus the
existing expected schema for extraction).

Each phase validates the three frozen input artifacts before its 10000ms
non-inference readiness check. Calls use the fixed 180000ms timeout and one
attempt, with case-local L4 → D4 order in the 4B phase and fixture-order D1.7
in the later phase. Reports retain exact input-byte SHA-256 digests, stage
versions, skip reasons, raw assistant content, runtime/schema distinctions,
dynamic planned/attempted/completed counts, and observed latency summaries.
The combiner checks matching provenance, exact cases/arms, stage control
flow, and raw-output/schema consistency against the frozen inputs, then
recomputes and verifies scores/counts before applying the three paired
comparisons and frozen training-research trigger. With 60 cases per arm,
the authoritative >=10 percentage-point improvement rule is checked as at
least six net successful cases to avoid floating-point threshold ambiguity.

Frozen arms, stage semantics, prompts, extraction gold, HUMAN labels,
thresholds, and B2c/B2d dispositions did not change. Effective HUMAN gold is
still 20 `NO_WRITE` / 20 `WRITE_CANDIDATE` / 20 `ESCALATE`, and the HUMAN
distribution gate remains PASS. Tests use injected fake fetch only;
synthetic test reports stay in memory. No real model call, model output,
or experimental report was produced in this implementation commit, and
`llama.cpp` was not started. After code review, the next step is the
sequential 4B run, then the 1.7B run, then deterministic combination.
Training remains conditional on the frozen trigger, private replay remains
UNOPENED, and production memory/DB/Vault/retrieval/routing remain unchanged.

#### P1-B3 execution/result receipt — 2026-09-05

**P1-B3 = CLOSED / COMPLETE / NO_SPECIALIZED_TRAINING_SIGNAL.** Execution
revision was `5b1c54cc97faada4a11afd2bb2132f2596f2f751`, also the fetched
GitHub `main` at the start of this receipt; no intervening commit existed.
The historical frozen P1-B3 trigger above remains its disposition rule,
without reinterpretation.

Before final integration, main advanced once to
`407651d70e654b10b7af6a6521dc2d872e9e5f51`. That intervening commit was
inspected: API/backup/model-picker/dependency security fixes changed no
P1-B3 runner, combiner, fixture, HUMAN gold, scoring, or canonical memory-study
contract. This receipt/implementation is integrated on that newer main;
the historical execution revision remains unchanged.

The actual clean phase reports and deterministic combined report are
preserved byte-for-byte as primary run evidence:

| Committed artifact under `fixtures/` | SHA-256 |
| --- | --- |
| `local-memory-inference-p1b3-4b-report.json` | `f1a438f0c72a0243d00f0d9ebfb41ceea9761e05d83e22a063a150a53fed089d` |
| `local-memory-inference-p1b3-1p7b-report.json` | `56d5d74795883d250c5d9249f2e1060a48ef06754b940059254ec8fd38c1a4fc` |
| `local-memory-inference-p1b3-combined-report.json` | `af1fb7a45f30003aa19551700ba41c1ad3e8612982934d8033f09bf6155d9f79` |

The sources were `/tmp/xion-p1b3-4b-report-clean.json`,
`/tmp/xion-p1b3-1p7b-report-clean.json`, and
`/tmp/xion-p1b3-combined-report.json`. Both phase reports validate under the
existing frozen P1-B3 validator. Recombining them with the existing P1-B3
combiner deep-equals the supplied combined artifact, including all raw stage
records, provenance, scores, and counts. Nothing was hand-reconstructed.

The 4B phase used `xion-p1b1-qwen3-4b-bf16` /
`unsloth/Qwen3-4B-GGUF:BF16`; the 1.7B phase used
`xion-p1b1-qwen3-1.7b-bf16` / `unsloth/Qwen3-1.7B-GGUF:BF16`.
Both used `llama.cpp` revision
`e42214804794fca6abb61b1a5f9adae2a845f0be`, a 180000ms call timeout,
one attempt, and no automatic reruns. Both 10000ms non-inference health
preflights succeeded. The generated timestamps are respectively
`2026-09-05T10:47:04.292Z` and `2026-09-05T10:52:45.053Z`.

| Phase | Planned / attempted / completed calls | Invalid structured outputs | Runtime failures |
| --- | --- | --- | --- |
| 4B | 144 / 144 / 144 | 0 | 0 |
| 1.7B | 98 / 98 / 98 | 1 | 0 |

L4 invoked 60 triage and 24 extraction calls. D4 invoked 60 ambiguity calls
and zero binary/extraction calls. D1.7 invoked 60 ambiguity, 21 binary, and
17 extraction calls. Combined runtime failures were **0**.

| Arm | End-to-end success | Unsafe non-escalation | False NO_WRITE | Schema-valid extraction wrong-value | Terminal escalation |
| --- | --- | --- | --- | --- | --- |
| L4 | 48/60 (80%) | 7 | 6 | 1 | 13/60 |
| D4 | 20/60 (33.33%) | 0 | 0 | 0 | 60/60 |
| D1.7 | 32/60 (53.33%) | 1 | 4 | 0 | 38/60 |

| Pair | UNCHANGED_CORRECT | FIXED | REGRESSION | UNCHANGED_WRONG | NONCOMPARABLE_RUNTIME |
| --- | --- | --- | --- | --- | --- |
| L4 → D4 | 13 | 7 | 35 | 5 | 0 |
| D4 → D1.7 | 19 | 13 | 1 | 27 | 0 |
| L4 → D1.7 | 23 | 9 | 25 | 3 | 0 |

D1.7 minus L4 is **-16 successful cases / -26.67 percentage points**
(recorded exact delta: `-26.666666666666668`). The preregistered trigger
was not met: final disposition is **NO_SPECIALIZED_TRAINING_SIGNAL**.

Observed behavior, not claims about internal model mechanisms:

- D4 emitted schema-valid Stage-1 `ESCALATE` on all 60 cases, so neither
  its binary nor extraction stage was invoked.
- D1.7 was materially less over-escalating than D4, but still produced
  false `NO_WRITE` and one strict-output-format safety failure.
- That one D1.7 invalid ambiguity output was semantically an `ESCALATE`
  JSON object wrapped in a Markdown code fence. Under the frozen strict
  contract it remains **INVALID**, an end-to-end and unsafe-non-escalation
  failure, not a successful escalation or runtime failure.
- Extraction wrong-value was not the main observed D1.7 failure boundary.

**npm stdout-cleanup provenance.** The original execution used
`npm run ... > report.json`; npm printed its command banner before the
runner JSON, making the two redirected phase files non-parseable as pure
JSON. No semantic model call was rerun. Cleanup deterministically found
the beginning of the runner JSON object after the npm prefix, retained that
JSON payload, validated it with `JSON.parse`, and combined the clean phases
with the reviewed deterministic P1-B3 combiner. This was an output-capture
cleanup, not a model/runtime failure. Historical model outputs are unchanged.
All future experiment capture instructions use `npm --silent run ...` or
direct `node` execution so stdout remains pure JSON.

### Prospective training-research policy clarification — user decision

The P1-B3 prerequisite trigger is **not a general rule that an untuned
specialist must outperform a baseline before a training experiment may
exist**. This prospective clarification does not rewrite P1-B3 history,
its frozen trigger, or its final disposition.

Future task-specific training is a separately preregistered experimental
intervention. An observed bounded failure pattern may make it informative
to open such an experiment. Before training execution, its own training
data provenance, train/dev/held-out split, training mechanism, target
metrics, no-leakage rules, and stopping rules must be frozen. Strict
performance/safety thresholds belong primarily to later held-out validation
and adoption decisions, not permission to conduct training research.
**No training experiment is opened by this commit.**

The currently selected branch sequence is P1-B4 role-split hybrid → if
directionally promising, a separately designed raw-episode diagnostic →
consider task-specific training if the failure profile warrants it →
held-out/adoption validation. This is research sequencing, not production
authorization.

### Initial P1-B4 role-split hybrid preregistration — SUPERSEDED_BEFORE_EXECUTION

Historical record from `8cd47eebd9facfaa885f9105e2614269d2bf6307`:
the following v1 design was preregistered/implemented but **NOT RUN**.
It is **SUPERSEDED_BEFORE_EXECUTION**, not a failed experiment. The
pre-execution correction and executable B4A → B4B contract follow below;
the original source contract and CLI here are retained as history only.

**PREREGISTERED / IMPLEMENTED / NOT RUN.** P1-B4 is explicitly an
**ADAPTIVE diagnostic on the already-consumed P1-B3 60-case fixture**, not
fresh held-out validation. No case, evidence, HUMAN label, case-033
resolution, extraction gold, prompt, or schema is changed or relabeled.

Research question: does assigning ambiguity/escalation to the existing
untuned 1.7B Stage-1 output, while assigning durability triage and extraction
to frozen 4B, improve end-to-end behavior relative to P1-B3 L4?
There is one new arm, **HYBRID**: 1.7B owns ambiguity/escalation; 4B owns
binary durability triage and structured extraction.

#### Frozen source and downstream execution

The runner loads the three committed P1-B3 run artifacts above. Before
readiness or any new inference it uses the existing frozen P1-B3 combiner
to validate both phase reports, reparse their raw stage outputs, and
recompute every score/count. The recomputed combined report must deep-equal
the committed combined report. It requires execution commit
`5b1c54cc97faada4a11afd2bb2132f2596f2f751`, zero source runtime failures,
exact 60 case IDs/order, and exact artifact bytes and input provenance.
A source runtime failure is rejected before any new call with
`INDETERMINATE_RUNTIME`; no source stage is invented, repaired, or rerun.

The unchanged inputs are:

| Input identity | Exact-byte SHA-256 |
| --- | --- |
| `xion-local-memory-inference-p1b3-decomposed-pipeline-candidates-v2` | `a6608642caad02c772941d58558bd9fc31ee86ef54fe342ee2713aa08cf62c8e` |
| `xion-local-memory-inference-p1b3-human-resolved-labels-v1` | `a6444c5fc4460cc499c3ac64060b4e87d9e7bed984b05376cae08655fb499f5d` |
| `xion-local-memory-inference-p1b3-decomposed-pipeline-authoring-key-v2` | `e1ef730de0341fa3314e20425afefc38cfedeb59642be018c407d433646240ae` |

Only resolved HUMAN gold supplies semantic labels (20/20/20, >=15/class
gate PASS). `authoringTarget` is construction provenance, **not class-gold
authority**. The authoring key supplies deterministic extraction gold only
for scoring Stage 3.

For cases 001–060 in the same frozen order, copy the exact P1-B3 D1.7
ambiguity-stage record, including raw content, schema/runtime state, versions,
and recorded latency. **Do not call the 1.7B model again.** This avoids a
second semantic attempt and changes only downstream model ownership:

```text
source valid ESCALATE -> terminal ESCALATE; no new call
source valid CLEAR -> new 4B binary
source invalid output -> end-to-end failure; no downstream call
source runtime failure -> INDETERMINATE_RUNTIME; no rerun
new binary valid NO_WRITE -> stop
new binary valid WRITE_CANDIDATE -> new 4B extraction
new upstream invalid/runtime failure -> stop that case's downstream flow
```

Actual source ambiguity has 38 schema-valid `ESCALATE`, 21 schema-valid
`CLEAR`, and one invalid output, with zero runtime failures. A known
fixed-source ceiling follows before any P1-B4 execution: only 19 HUMAN
`ESCALATE` cases and 21 `CLEAR` cases can succeed, so even perfect downstream
output reaches at most **40/60**, below L4's **48/60**. The requested
progression rule below is retained unchanged and therefore cannot open the
successor on this exact source. This is a source/control-flow bound, not a
P1-B4 model result or a change to the historical P1-B3 disposition.

New calls use only `xion-p1b1-qwen3-4b-bf16` /
`unsloth/Qwen3-4B-GGUF:BF16`, size class `~4B`, quantization `BF16`,
`llama.cpp` revision `e42214804794fca6abb61b1a5f9adae2a845f0be`.
The exact P1-B3 `p1b3-binary-write-candidate-triage-v1` task,
`p1b3-binary-write-candidate-triage-output-v1` schema, and
`xion-local-memory-inference-p1b3-binary-write-candidate-prompt-v1` prompt
are reused with `NO_WRITE | WRITE_CANDIDATE` only. Extraction reuses the
frozen P1-B1 instruction and each candidate's existing date/text-scalar/
quantity-unit schema and authoritative validator. No prompt tuning occurs.
Every new stage receives ORIGINAL candidate evidence; extraction also
receives the existing `expectedSchema`. Generated source or binary text is
never downstream evidence; validated decisions control flow only.

The existing bounded scaffold and HTTP request contract are reused exactly:
OpenAI-compatible chat completions, temperature 0, max_tokens 128,
stream false, enable_thinking false, response_format json_object.
An existing 4B server must pass the same non-inference `/health` readiness
check with a 10000ms timeout before new semantic calls. Failed preflight
permits zero semantic calls and emits no semantic report. New calls use
180000ms, one attempt, and no automatic reruns. Completed assistant content
with invalid JSON/schema is a semantic failure, not runtime failure;
HTTP/runtime/envelope/timeout failure is runtime failure.

#### Accounting, scoring, and directional progression

Reports distinguish `sourceAmbiguityCallsReused = 60` from `newCallsPlanned`,
`newCallsAttempted`, `newCallsCompleted`, `newInvalidStructuredOutputs`, and
`newRuntimeFailures`. Planned increments when a new stage becomes required,
before its sole POST. Normal execution has new planned = attempted.
Counterfactual hybrid stage-call count is 60 source calls plus new binary
and extraction calls, not a claim that source calls ran again.
Each case contains the exact copied source ambiguity record, binary and
extraction records, and separate `REUSED / NEW / SKIPPED` origin markers.
Arm summaries include the counterfactual source-plus-new call/latency totals;
execution separately exposes source and new per-stage counts/latencies.
Total case latency sums recorded source ambiguity latency and invoked new
stage latencies; skipped latency is null. Model-load/server-switch latency
is not represented as measured per-case inference latency.

HYBRID uses the same P1-B3 D-arm scoring definitions: HUMAN `ESCALATE`
succeeds only with source schema-valid `ESCALATE`; HUMAN `NO_WRITE` needs
source `CLEAR` then new binary `NO_WRITE`; HUMAN `WRITE_CANDIDATE` needs
source `CLEAR`, new binary `WRITE_CANDIDATE`, and schema-valid extraction
deep-equal to frozen extraction gold. Invalid source output remains failure.
All 60 cases stay in the denominator. The same unsafeNonEscalation,
falseNoWrite, schemaValidExtractionWrongValue, terminalEscalation, and
endToEndSuccess definitions apply, including wrong-HUMAN-flow exclusion
from the specific extraction-wrong metric.

The **primary** comparison is verified P1-B3 **L4 → HYBRID**, not D4 or
D1.7. Paired categories remain `UNCHANGED_CORRECT`, `FIXED`, `REGRESSION`,
`UNCHANGED_WRONG`, and `NONCOMPARABLE_RUNTIME`. Invalid JSON/schema is
comparable semantic failure; runtime failure in either required arm/case
is noncomparable. The directional rule is exactly:

```text
If any required source/new comparison runtime failure exists:
  INDETERMINATE_RUNTIME
Otherwise RAW_EPISODE_SUCCESSOR_OPEN iff:
  HYBRID endToEndSuccess >= L4 endToEndSuccess
  AND paired L4 -> HYBRID FIXED > REGRESSION
  AND HYBRID unsafeNonEscalation <= L4 unsafeNonEscalation
  AND HYBRID falseNoWrite <= L4 falseNoWrite
  AND HYBRID schemaValidExtractionWrongValue <= L4 schemaValidExtractionWrongValue
Otherwise:
  NO_RAW_EPISODE_SUCCESSOR_SIGNAL
```

Safety comparisons are component-wise, not a weighted aggregate. There is
no +10 percentage-point requirement. This is **not a training entry gate**
or production-readiness criterion.

#### Raw-episode successor sequencing only

If P1-B4 returns `RAW_EPISODE_SUCCESSOR_OPEN`, the next research step is a
**separately designed synthetic raw-episode diagnostic before task-specific
training on this branch**. Its intended comparison is the same semantic
case's HUMAN/oracle evidence span → the same role-split hybrid versus the
same full synthetic conversational episode → the same role-split hybrid.
The purpose is to separate bounded semantic-component failure from evidence
localization, conversational scope, speaker/reference, transient-vs-durable
context, and distractor effects. Raw fixture contents, sample size,
thresholds, private replay, retrieval behavior, and training mechanism are
not frozen here; they require a later design after P1-B4 results. No raw
episodes, training experiment, or private natural XION replay are opened.

#### P1-B4 implementation receipt — no experimental inference

Runner: `scripts/run-memory-inference-p1b4-role-split-hybrid-diagnostic.js`.
Identities are `xion-local-memory-inference-p1b4-role-split-hybrid-runner-v1`,
`xion-local-memory-inference-p1b4-role-split-hybrid-scoring-v1`, and
`xion-local-memory-inference-p1b4-role-split-hybrid-report-v1`.
Only `--endpoint` and optional `--commit` (default `git rev-parse HEAD`)
were accepted by initial v1. Its superseded CLI, **never executed**, was:

```text
npm --silent run research:memory-inference-p1b4-role-split-hybrid -- --endpoint <4B endpoint> --commit <Galpi SHA>
```

The runner emits one JSON report to stdout and never manages model servers.
Only two existing P1-B3 helpers (`preflight`, `invokeStage`) are newly
exported for reuse; their bodies, the P1-B3 validator/combiner, and historical
scoring semantics are unchanged. No generalized framework was added.
Focused tests use fake fetch only, and synthetic test reports stay in memory.
No real P1-B4 model call/output/report exists, no 1.7B inference was rerun,
and `llama.cpp` was not started during implementation.

P1-B2c/B2d remain closed. Production memory behavior, durable-write authority,
source-of-truth, identity, explicit correction, Core/high-impact gates,
governance/authorization, retrieval, routing, Vault/DB schema, and existing
deterministic hard gates remain unchanged and authoritative. Private replay
remains **UNOPENED**. Training and adoption require their own later designs.

### P1-B4 pre-execution correction — B4A recalibration → B4B hybrid

Historical implementation receipt; the completed execution is closed below.

**PREREGISTERED / IMPLEMENTED / NOT RUN.** Pre-run review superseded the
initial design at `8cd47eebd9facfaa885f9105e2614269d2bf6307` before any
P1-B4 real model call, output, or report. Latest reviewed main was
`04c240ce7c251a1c87666bd37c20f4ac8ab0a604`; its change from that parent was
Pi deployment-verification documentation, unrelated to local-memory inference.
Before integration, another fetch found only
`bca8048bc53f2c58cf3c54c2774d20ff9d62b784` (UI model-picker display limits).
Its full diff was reviewed: no local-memory contract, fixture, P1-B3
artifact, P1-B4 runner, or canonical-study semantics changed.

The deterministic contradiction is exact: historical D1.7 Stage 1 produced
38 schema-valid ESCALATE, 21 schema-valid CLEAR, and one INVALID. Only 19
source ESCALATE cases have HUMAN ESCALATE gold. Thus perfect downstream
behavior could yield only **19 + 21 = 40/60**, while the unchanged L4
progression threshold requires **at least 48/60**. Initial v1 could never
return `RAW_EPISODE_SUCCESSOR_OPEN`. This is pre-run design analysis, not
a failed P1-B4 experiment or a claim about model internals.

The **L4 threshold is NOT weakened** and the **role split is NOT abandoned**:
1.7B still owns ambiguity/escalation; 4B still owns binary durability triage
and structured extraction. Only frozen reuse of old P1-B3 Stage-1 outputs
is replaced by one targeted adaptive Stage-1 contract correction.
P1-B3 remains **CLOSED / COMPLETE / NO_SPECIALIZED_TRAINING_SIGNAL**;
its artifacts, HUMAN/extraction gold, prompts, scoring, disposition, and
historical training trigger are immutable.

Both corrected phases use the already-consumed P1-B3 60-case fixture in
exact order, unchanged evidence and HUMAN gold (20/20/20). Neither is fresh
held-out validation. No cases are added, removed, edited, or relabeled and
no new HUMAN adjudication is performed. The resolved HUMAN artifact alone
is class gold; `authoringTarget` remains construction provenance only.

#### P1-B4A — one-prompt adaptive 1.7B ambiguity recalibration

Research question: can one targeted ambiguity-contract correction prevent
the 1.7B ambiguity stage from conflating clearly temporary/request-local
evidence with semantic ambiguity, while preserving escalation on genuinely
unresolved meaning/scope/referent/applicability cases? This is informed by
P1-B3's observed bounded failure pattern, not independent validation.

Exactly **one** new instruction is frozen, with no prompt candidates,
rationale, confidence, examples, few-shot demonstrations, or tuning knobs:

```text
Return CLEAR when the supplied evidence has one sufficiently clear
interpretation for downstream durability classification, even if that
interpretation is temporary, request-local, or would later be NO_WRITE.

Return ESCALATE only when the evidence itself leaves material ambiguity
about meaning, referent, scope, applicability, or whether the statement is
actual user state versus quoted, example, or hypothetical content.

Do not decide durability yourself. Do not resolve ambiguity yourself.
```

Runner: `scripts/run-memory-inference-p1b4-ambiguity-recalibration.js`.
Frozen identities:

- runner: `xion-local-memory-inference-p1b4-ambiguity-recalibration-runner-v1`
- scoring: `xion-local-memory-inference-p1b4-ambiguity-recalibration-scoring-v1`
- prompt: `xion-local-memory-inference-p1b4-ambiguity-recalibration-prompt-v1`
- report: `xion-local-memory-inference-p1b4-ambiguity-recalibration-report-v1`
- task: `p1b4-ambiguity-recalibration-v1`

The existing `p1b1-ambiguity-escalation-output-v1` schema is structural only
and is reused with its authoritative validator: exactly one required
`decision`, enum `CLEAR | ESCALATE`, no additional properties. The task and
prompt identities change because the instruction changes. The P1-B1 bounded
system scaffold is unchanged. Each model input is only
`{"evidence": ORIGINAL_EVIDENCE}`; no HUMAN labels, authoring targets,
extraction gold, old model output, or downstream information enter a prompt.

The only model is `xion-p1b1-qwen3-1.7b-bf16` /
`unsloth/Qwen3-1.7B-GGUF:BF16`, size class `~2B`, quantization `BF16`.
Runtime is `llama.cpp` revision
`e42214804794fca6abb61b1a5f9adae2a845f0be`. Requests use the frozen
OpenAI-compatible completion contract: temperature 0, max_tokens 128,
stream false, enable_thinking false, response_format json_object,
180000ms timeout, one attempt, no automatic reruns. The same non-inference
`/health` preflight has a 10000ms deadline; failure permits zero semantic
POSTs and no semantic report. Scripts never manage servers.

All exact 60 cases run once in order. Calls planned increment before each
POST; planned = attempted = 60 after successful preflight and normal
process completion. Usable assistant content counts as completed even when
strict JSON/schema validation fails. HTTP/runtime/envelope/timeout failure
is incomplete runtime failure. No failed call is retried.

The report retains per-case raw content, parsed structure/schema/runtime
state, versions, latency, and post-generation HUMAN scoring. It reports
planned/attempted/completed/invalid/runtime counts, CLEAR/ESCALATE counts,
and per-HUMAN-class CLEAR/ESCALATE/INVALID/RUNTIME_FAILURE counts.
`unsafeNonEscalation` is HUMAN ESCALATE without schema-valid ESCALATE;
`unnecessaryEscalation` is HUMAN NO_WRITE or WRITE_CANDIDATE with
schema-valid ESCALATE. Observed call latency totals and means are reported.
Verified historical P1-B3 D1.7 ambiguity counts and current-minus-historical
differences are **descriptive only**, never an entry test.

There is **no B4A performance entry gate**. Runtime-free completion freezes
the exact outputs as B4B Stage 1 regardless of whether they look better or
worse. INVALID remains a semantic failure in that source and is never
repaired. Any B4A runtime failure makes the required P1-B4 comparison
`INDETERMINATE_RUNTIME`; B4B must stop before its health preflight or any
4B semantic call. There is no prompt search or second semantic attempt.

#### P1-B4B — exact B4A source, unchanged 4B downstream and progression

Runner remains `scripts/run-memory-inference-p1b4-role-split-hybrid-diagnostic.js`.
Changed source/execution identities distinguish it from superseded v1:

- runner: `xion-local-memory-inference-p1b4-role-split-hybrid-runner-v2`
- report: `xion-local-memory-inference-p1b4-role-split-hybrid-report-v2`
- scoring stays `xion-local-memory-inference-p1b4-role-split-hybrid-scoring-v1`

CLI requires `--endpoint` and `--ambiguity-report`, with optional `--commit`
defaulting to `git rev-parse HEAD`. A and B must record the **same full
experiment SHA**. No semantic tuning options are accepted by either phase.

Before B's preflight, both immutable P1-B3 phase artifacts are validated by
their existing validator/combiner; the recomputed combined report must
deep-equal the committed report. The pinned source execution revision,
zero runtime failures, exact artifact bytes/SHA-256 and candidate/HUMAN/
authoring provenance above remain mandatory. P1-B3 L4 is the verified
baseline, while old D1.7 ambiguity is historical context, **not HYBRID source**.

B requires the B4A report identity, exact 60 IDs/order, identical frozen
input provenance, exact 1.7B model/runtime/request/prompt/schema contract,
and zero B4A runtime failures. Every raw assistant output is reparsed and
validated; every stage record, HUMAN score, summary, and call count must
equal the recomputation. Supplied score flags are not trusted. B records
the SHA-256 of the exact loaded A report bytes and carries each exact
source ambiguity record with origin `REUSED_P1B4A`. These checks establish
internal consistency/provenance, not cryptographic authentication of a
wholly rewritten report.

```text
B4A valid ESCALATE -> HYBRID terminal ESCALATE; no new 4B call
B4A valid CLEAR -> new 4B binary durability stage
B4A INVALID -> HYBRID semantic failure; no downstream call or repair
B4A runtime failure -> INDETERMINATE_RUNTIME; B4B does not start inference
4B binary valid NO_WRITE -> stop
4B binary valid WRITE_CANDIDATE -> frozen 4B extraction
new upstream invalid/runtime failure -> stop that case's downstream flow
```

New calls use the exact existing 4B model/runtime and P1-B3 binary
task/prompt/schema plus frozen P1-B1 extraction contract specified in the
initial receipt above, without tuning. Original evidence is supplied
unchanged to every stage; extraction also receives frozen expectedSchema.
Generated A or binary text never becomes evidence; validated decisions
control flow only. Readiness, timeout, no-rerun policy, strict invalid-vs-
runtime distinction, and per-case scoring/safety definitions are unchanged.

Reports distinguish 60 previously executed B4A ambiguity calls **reused**
by B from NEW/SKIPPED 4B binary/extraction records and new planned/attempted/
completed/invalid/runtime counts. Counterfactual HYBRID call count and
latency sum recorded A calls/latencies plus invoked new B stages. They are
**not wall-clock pipeline latency across server switching**; Stage 1 is
not executed again during B.

Primary comparison remains verified historical **P1-B3 L4 → HYBRID**,
with all 60 cases and exactly the five paired transition categories above.
The progression rule and its scoring identity are **unchanged**:

```text
Any required B4A/new-B4B runtime failure -> INDETERMINATE_RUNTIME
Otherwise RAW_EPISODE_SUCCESSOR_OPEN iff:
  HYBRID endToEndSuccess >= L4 endToEndSuccess
  AND paired L4 -> HYBRID FIXED > REGRESSION
  AND HYBRID unsafeNonEscalation <= L4 unsafeNonEscalation
  AND HYBRID falseNoWrite <= L4 falseNoWrite
  AND HYBRID schemaValidExtractionWrongValue <= L4 schemaValidExtractionWrongValue
Otherwise -> NO_RAW_EPISODE_SUCCESSOR_SIGNAL
```

Each safety comparison is component-wise; no weighted score, no +10pp
condition, no training entry gate, and no production-adoption claim.

#### Corrected execution sequence — commands NOT run in this implementation

After code review, manually start the exact 1.7B server, then capture pure
JSON with the fixed experiment revision:

```sh
npm --silent run research:memory-inference-p1b4-ambiguity-recalibration -- \
  --endpoint <1.7B endpoint> \
  --commit <fixed experiment SHA> \
  > /tmp/xion-p1b4-ambiguity-report.json
```

Stop the 1.7B server, then start the exact 4B server. Only if A completed
without runtime failure, consume its unchanged report using the same SHA:

```sh
npm --silent run research:memory-inference-p1b4-role-split-hybrid -- \
  --endpoint <4B endpoint> \
  --ambiguity-report /tmp/xion-p1b4-ambiguity-report.json \
  --commit <same fixed experiment SHA> \
  > /tmp/xion-p1b4-hybrid-report.json
```

No real P1-B4A/B4B model call or output/report was produced in this correction.
Tests use fake fetch only; fake reports stay in memory. Existing P1-B3
source-validation code is reused by A and B, and only the existing
`requestText` helper is additionally exported from P1-B3; its implementation,
prompts, validators, combiner, and historical scoring are unchanged.

Only `RAW_EPISODE_SUCCESSOR_OPEN` opens a **separately designed synthetic
raw-episode diagnostic before training** on this branch. Its fixture,
sample size, thresholds, retrieval behavior, and training mechanism are
not designed or frozen here. The prospective training policy above remains:
no general untuned-performance entry gate; training is a separately
preregistered intervention when a bounded failure pattern makes it
informative. Data provenance, train/dev/held-out split, mechanism, target
metrics, leakage controls, and stopping rules must be frozen before
training. Strict performance/safety gates belong to later held-out/adoption
decisions. Raw episodes, training, and private natural replay remain
**UNOPENED**. All production memory/architecture and deterministic hard
gate boundaries remain unchanged.

### P1-B4 execution receipt — CLOSED / COMPLETE / NO_RAW_EPISODE_SUCCESSOR_SIGNAL

P1-B4 executed at Galpi revision
`4e079617e96c7fae41ef92ad0d356c4d7b5a2e56`. Both exact local reports were
retained unchanged as durable run evidence:

| Artifact | Identity | Exact-byte SHA-256 |
|---|---|---|
| `fixtures/local-memory-inference-p1b4-ambiguity-report.json` | `xion-local-memory-inference-p1b4-ambiguity-recalibration-report-v1` | `e77a7a6f9aa76c50e24d645f3e218f212295f05124e0a4da956c1cd68dc4cf70` |
| `fixtures/local-memory-inference-p1b4-hybrid-report.json` | `xion-local-memory-inference-p1b4-role-split-hybrid-report-v2` | `55e6b83906904afd7da42961e9c8eb22304addd2479ab072f6e3c02dd6245ccf` |

The source files were `/tmp/xion-p1b4-ambiguity-report.json` and
`/tmp/xion-p1b4-hybrid-report.json`; exact bytes were copied, not rewritten
or reconstructed. Generated timestamps are respectively
`2026-09-05T12:51:56.939Z` and `2026-09-05T12:58:54.827Z`.
The frozen B4A validator reparses A. Because B4B had no standalone report
validator, the new research-only B5 source validator reconstructs the
**entire existing B4B v2 report** using the unchanged strict parser,
stage contracts, scoring, and progression function. It requires deep
equality, exact A-byte SHA provenance, and the verified immutable P1-B3
source reports. This verifies historical scoring; it does not change it.

A used `xion-p1b1-qwen3-1.7b-bf16` /
`unsloth/Qwen3-1.7B-GGUF:BF16` (`~2B`, BF16); B used
`xion-p1b1-qwen3-4b-bf16` / `unsloth/Qwen3-4B-GGUF:BF16` (`~4B`, BF16).
Both used `llama.cpp` revision `e42214804794fca6abb61b1a5f9adae2a845f0be`,
180000ms semantic timeout, no automatic reruns, and successful 10000ms
health preflights. Frozen candidate/HUMAN/extraction provenance is unchanged.

A planned/attempted/completed **60/60/60** calls: 28 schema-valid CLEAR,
12 schema-valid ESCALATE, **20 INVALID**, zero runtime failures.
B reused those exact 60 A records and planned/attempted/completed
**44/44/44** new 4B calls (28 binary, 16 extraction), with zero new invalid
outputs and zero runtime failures. No Stage-1 call was repeated by B.

| Metric | Historical P1-B3 L4 | P1-B4 HYBRID |
|---|---:|---:|
| End-to-end success | 48/60 (80%) | 33/60 (55%) |
| unsafeNonEscalation | 7 | 10 |
| falseNoWrite | 6 | 1 |
| schemaValidExtractionWrongValue | 1 | 1 |
| terminalEscalation | 13 | 12 |

L4 → HYBRID paired counts: `UNCHANGED_CORRECT 29`, `FIXED 4`,
`REGRESSION 19`, `UNCHANGED_WRONG 8`, `NONCOMPARABLE_RUNTIME 0`.
Required runtime failures were zero. The frozen progression rule failed
on E2E not-worse, FIXED > REGRESSION, and unsafeNonEscalation not-worse.
The authoritative final disposition is **NO_RAW_EPISODE_SUCCESSOR_SIGNAL**.
P1-B4 is **CLOSED / COMPLETE / NO_RAW_EPISODE_SUCCESSOR_SIGNAL**;
no successor was opened by that result.

#### Observed format family — no retroactive forgiveness

All 20 A INVALID raw outputs were exactly one outer Markdown code fence
with lowercase language tag `json`, no prose or other observed invalid
family, and an otherwise schema-conforming decision object inside:

````text
```json
{"decision":"CLEAR"}
```
````

or the same presentation with `ESCALATE`. Inspecting the payloads finds
12 CLEAR and 8 ESCALATE strings. These are an **observed presentation
family, not proof of internal semantic intent**. P1-B4 correctly applied
ordinary `JSON.parse` to the complete raw assistant string and counted
all 20 INVALID. They remain invalid P1-B4 outputs and end-to-end failures;
neither this receipt nor the subsequent diagnostic reinterprets P1-B4.

### P1-B5 deterministic structured-output normalization diagnostic

**CLOSED / COMPLETE / NO_RAW_EPISODE_SUCCESSOR_SIGNAL.** The frozen
preregistration and implementation receipt below are preserved as history;
the actual execution/result receipt follows them. This is an **ADAPTIVE** pipeline
diagnostic on already-consumed P1-B4/P1-B3 evidence, not fresh held-out
validation. Research question: does a narrowly bounded deterministic
normalization layer for the observed JSON code-fence wrapper make the
same role-split hybrid directionally competitive with historical L4 under
the unchanged raw-episode successor rule?

The user confirmed **Stage-1-only normalization** before implementation.
Existing and NEW 4B binary/extraction outputs retain the frozen strict
parser. No prompt is strengthened, no model is retried, and semantic
content, HUMAN gold, extraction gold, role ownership, and L4 thresholds
remain unchanged. P1-B1/B2/B3/B4 historical parsers are not modified.

#### Exact normalization envelope

Normalizer identity:
`xion-local-memory-inference-structured-output-normalizer-v1`.
It acts on the exact raw B4A assistant content, before the unchanged
ambiguity JSON/schema validation, with only these paths:

1. **ALREADY_RAW_JSON:** ordinary `JSON.parse(raw)` succeeds. Return the
   original string unchanged; `normalizationApplied = false`,
   `normalizationKind = NONE`. The frozen stage schema still must pass.
2. **EXACT_JSON_CODE_FENCE_UNWRAP:** after allowing only outer whitespace,
   the whole response is exactly opening triple backticks + lowercase
   `json`, a line break, payload, a line break, and closing triple
   backticks. LF and CRLF are recognized. Remove only fence markers;
   retain the exact inner payload, including boundary line breaks and all
   JSON whitespace/escaping/capitalization. No triple-backtick sequence
   may occur inside the envelope. Record `normalizationApplied = true`
   and `normalizationKind = EXACT_JSON_CODE_FENCE_UNWRAP`; then ordinary
   JSON.parse and the frozen ambiguity schema decide validity.
3. Otherwise record `normalizationKind = NOT_NORMALIZABLE`,
   `normalizationApplied = false`, normalized content null, and INVALID.

An unwrapped malformed JSON payload or schema-invalid value stays INVALID;
successful envelope removal is not successful semantic validation.
Bare fences, uppercase/mixed-case tags, extra fence tags/options, prose,
multiple/nested fences, non-whitespace prefixes/suffixes, JSON5, comments,
trailing commas, single quotes, key-quoting repair, JSON substring
extraction, regex decision inference, and semantic repair are not accepted.
This is not a generic JSON repair facility or a production parsing policy.

#### Pinned sources, reuse, and new-call boundary

Before any new call, B5 validates immutable P1-B3 phase reports through the
existing combiner, B4A from raw outputs, and the whole strict B4B report
against exact A and P1-B3. It requires ordered case IDs 001–060, the exact
B4 experiment revision above, zero source runtime failures, exact frozen
candidate/HUMAN/authoring identities and SHA-256 values, and both pinned
B4 report-byte hashes. Supplied scores are never trusted. Original A
records, including historical schemaStatus/raw content, remain separately
preserved beside B5's normalized validity/output and normalization metadata.

For originally valid A CLEAR cases, copy the exact B4B binary/extraction
records, including any failure/skipped state: **never rerun them**.
Normalized ESCALATE terminates with no new call. Still-invalid Stage 1
fails with no downstream call. Only originally INVALID A output that
becomes schema-valid CLEAR and had no B4B downstream result may invoke
NEW 4B binary. New valid NO_WRITE stops; new valid WRITE_CANDIDATE invokes
frozen extraction. Invalid/runtime upstream output stops downstream.

The observed source has **60 reused 1.7B calls and 44 reused 4B calls**.
Its 20 fenced outputs make **12 CLEAR cases newly reachable**; the other
8 fenced ESCALATE payloads require no downstream inference. Thus future
execution needs 12 new binary attempts, with 0–12 new extraction calls
determined only by binary outputs. These are source/control-flow facts,
not a P1-B5 model result. No 1.7B call is made by B5.

New calls use only the frozen 4B model/artifact/runtime above, 180000ms,
one attempt, no retries. The exact P1-B3 binary task/prompt/schema and
P1-B1 extraction task/prompt/schema are reused. Every new stage gets
ORIGINAL candidate evidence; extraction also gets frozen expectedSchema.
Normalized or generated output controls flow only, never downstream evidence.

If no new 4B call is required, endpoint and health preflight are unnecessary.
Otherwise endpoint is required and the existing 10000ms non-inference
health check precedes every new semantic POST. Failed preflight returns
`INDETERMINATE_RUNTIME`, zero semantic attempts, and no invented case
scores or arm summary. Readiness failure is reported separately from
`newRuntimeFailures` (failed attempted semantic calls). Schema-invalid
new assistant content is a completed semantic failure, not runtime failure.

Accounting separates `REUSED_P1B4A`, `REUSED_P1B4B`, `NEW`, and `SKIPPED`.
Reports include source ambiguity/downstream calls reused, new binary and
extraction planned/attempted/completed counts, new invalid/runtime counts,
and normalization counts (`alreadyRawJson`, `codeFenceUnwrapped`,
`notNormalizable`, `schemaValidAfterNormalization`). Normal execution has
new planned = attempted. Failed preflight retains the required binary
plan with zero attempts. Per-case latency and counterfactual call totals
sum reused source and new model stages, not server-switch wall-clock time.

#### Frozen scoring, interpretation, and successor policy

B5 uses unchanged HUMAN class gold and extraction gold. HUMAN ESCALATE
requires normalized schema-valid Stage-1 ESCALATE; NO_WRITE requires CLEAR
then valid binary NO_WRITE; WRITE_CANDIDATE requires CLEAR, valid binary
WRITE_CANDIDATE, and schema-valid extraction deep-equal to extraction gold.
All 60 cases stay in the denominator. The same unsafeNonEscalation,
falseNoWrite, schemaValidExtractionWrongValue (HUMAN WRITE only),
terminalEscalation, and endToEndSuccess definitions apply. There is no
special forgiveness metric for normalized cases.

The primary baseline remains verified P1-B3 L4, with the same five paired
categories (INVALID remains comparable; runtime is noncomparable).
The existing B4 progression function is reused **unchanged**:

```text
Any required runtime failure -> INDETERMINATE_RUNTIME
Otherwise RAW_EPISODE_SUCCESSOR_OPEN iff:
  HYBRID endToEndSuccess >= L4 endToEndSuccess
  AND paired L4 -> HYBRID FIXED > REGRESSION
  AND HYBRID unsafeNonEscalation <= L4 unsafeNonEscalation
  AND HYBRID falseNoWrite <= L4 falseNoWrite
  AND HYBRID schemaValidExtractionWrongValue <= L4 schemaValidExtractionWrongValue
Otherwise -> NO_RAW_EPISODE_SUCCESSOR_SIGNAL
```

Safety is component-wise, without weights or a +10pp condition. Positive
evidence supports only directional promise of this role-split pipeline
on this consumed synthetic fixture after handling the observed wrapper.
It does not establish fresh capability, production readiness, arbitrary
malformed-output recovery, a general JSON-repair policy, or training success.

Positive B5 opens only a **separately designed synthetic raw-episode
diagnostic**. A negative result means the format confound was insufficient
under this rule: close this untuned hybrid diagnostic branch and review
the remaining bounded failure profile before deciding whether training
would be informative. Do not automatically train. The prospective policy
of no general untuned-performance entry gate remains; training still
requires its own preregistered provenance, split, mechanism, metrics,
leakage controls, and stopping rules. No raw episodes, training experiment,
or private replay are opened. Production parsing/memory and architecture
hard gates remain unchanged.

#### B5 implementation receipt — no real inference

The only new runner is
`scripts/run-memory-inference-p1b5-structured-output-normalization.js`,
containing the narrow research-only normalizer and source verifier.
Identities:

- runner: `xion-local-memory-inference-p1b5-structured-output-normalization-runner-v1`
- scoring: `xion-local-memory-inference-p1b5-structured-output-normalization-scoring-v1`
- report: `xion-local-memory-inference-p1b5-structured-output-normalization-report-v1`

CLI accepts only optional `--endpoint` and `--commit` (default HEAD);
the pinned current source requires endpoint because it has 12 newly
reachable CLEAR cases. No semantic tuning options or server management
are provided. Future execution, **not run in this task**, captures pure JSON:

```text
npm --silent run research:memory-inference-p1b5-structured-output-normalization -- --endpoint <4B endpoint> --commit <fixed Galpi SHA> > /tmp/xion-p1b5-normalization-report.json
```

Implementation checks use fake fetch only; fake B5 reports stay in memory.
No real P1-B5 report was generated, no model server was started, and no
1.7B or existing 4B call was rerun.

#### B5 actual execution/result receipt — CLOSED / COMPLETE

The completed local report was independently validated before this receipt
was written. Documentation parent: `3543d5d39ce43d8931ed44679c0c2d11ea58b700`,
confirmed equal to fetched `origin/main`; no intervening main commit existed.

- Actual report: `/tmp/xion-p1b5-normalization-report.json`.
- Report identity: `xion-local-memory-inference-p1b5-structured-output-normalization-report-v1`.
- Execution revision: `d2bbdf5b079cf01e223191086d0bd8091fdc5ea7`.
- `generatedAt`: `2026-09-05T14:10:13.641Z`.
- Exact report-byte SHA-256:
  `2247f6f9f0963ce9858e97128aab8ad4a3fd95a79c275044d0ad1bcfd59d455f`.

Local validation used an inline `node <<'NODE'` assertion program, with
`globalThis.fetch` replaced by a throwing function. It called the existing
B5 `loadSources()` verifier (including the frozen B3 combiner and strict
B4A/B4B validation), checked pinned input/source identities and hashes,
and reconstructed all 60 B5 records from source raw ambiguity content and
recorded new raw outputs. Existing `normalizedAmbiguity`, `stageRecord`,
`skipAfter`, `parseStageContent`, `scoreArmCase`, `summarizeCalls`,
`summarizeArm`, `pairedTransition`, and B4 `progression` contracts were used.
Exact reused records, stage origins, ordered IDs, model/runtime metadata,
counts, scores, paired transitions, and final disposition were checked;
the whole reconstructed report was `assert.deepEqual` to the actual report.
**PASS, local offline validation only**, not a new experiment or GitHub CI.
Recorded timestamps/latencies are source observations, not independently
remeasured timings. This documentation-only change neither edits nor copies
the report into fixtures; its exact local source and digest are recorded here.

Normalization observed **40 already-raw JSON**, **20 exact lowercase `json`
code-fence unwraps**, **0 not-normalizable**, and **60 schema-valid after
normalization**. Source reuse was 60 B4A ambiguity calls plus 44 B4B
downstream calls. New 4B binary planned/attempted/completed were **12/12/12**;
new extraction were **7/7/7**. New invalid structured outputs and new
runtime failures were both **0**. The report records successful health
preflight, zero readiness/required runtime failures, and 123 counterfactual
HYBRID model-stage calls (60 + 44 + 19), not 123 newly executed calls.
No 1.7B or already-observed 4B result was rerun by B5.

| Metric | P1-B5 counterfactual HYBRID | Frozen historical L4 |
|---|---:|---:|
| End-to-end success | 48/60 (80%) | 48/60 (80%) |
| unsafeNonEscalation | 4 | 7 |
| falseNoWrite | 3 | 6 |
| schemaValidExtractionWrongValue | 1 | 1 |
| terminalEscalation | 20 | 13 |

Paired **L4 → HYBRID**: `UNCHANGED_CORRECT 41`, `FIXED 7`,
`REGRESSION 7`, `UNCHANGED_WRONG 5`, `NONCOMPARABLE_RUNTIME 0`.
The unchanged successor conditions evaluate as follows:

| Frozen condition | Result |
|---|---|
| Zero required runtime failures | PASS |
| HYBRID E2E >= L4 E2E | PASS: 48 == 48 |
| FIXED > REGRESSION | **FAIL: 7 == 7**, not strictly greater |
| unsafeNonEscalation <= L4 | PASS: 4 <= 7 |
| falseNoWrite <= L4 | PASS: 3 <= 6 |
| schemaValidExtractionWrongValue <= L4 | PASS: 1 <= 1 |

Authoritative disposition:
**P1-B5 = CLOSED / COMPLETE / NO_RAW_EPISODE_SUCCESSOR_SIGNAL**.
The consumed synthetic hybrid branch missed the frozen raw-episode
successor rule solely because FIXED did not strictly exceed REGRESSION.
No threshold is weakened or reinterpreted after observing this result.

Normalization moved the hybrid to a different observed operating point:
equal E2E to L4, lower unsafe-non-escalation and false-NO_WRITE counts,
unchanged wrong-extraction count, and more terminal escalation. This does
not establish fresh capability or production readiness. **P1-B4 remains
historically 33/60**; B5 neither rescores nor retroactively rescues B4.
All historical B1–B5 contracts, gold, and scores remain unchanged.
Raw-episode evaluation remains **UNOPENED by the B5 rule**. This negative
successor disposition does not prohibit a separately preregistered training
experiment: the prospective policy above already rejects a general
untuned-performance entry gate. The following section opens only that
bounded experiment's design, not training execution.

### P1-B6 1.7B ambiguity specialist supervised adaptation

**DATASET CONTRACT CLOSED / TRAINING PREREGISTRATION INCOMPLETE / NOT RUN.**
This prospective consolidation was reviewed against Galpi `main` at
`9e1203c46e69b30040678d317c34c92cb3cb0971`. The dataset decisions marked
CLOSED below are frozen user decisions. The first skeleton-candidate
validation and blind Pass-1 review-tool slice was implemented from Galpi
`main` `7dc562a01138e88488ecfdb8b536952f70e518b9`; later review stages remain
unimplemented. Training, model selection, dataset generation, and production
use remain unauthorized. No real candidate, HUMAN adjudication, model output,
or training artifact was created by that implementation slice.

The research target is adaptation of **only the ~1.7B ambiguity/escalation
stage**. Given an already-selected, candidate-centered conversational
evidence bundle, it decides whether the evidence has a sufficiently resolved
interpretation for downstream durability classification. Output is exactly
`CLEAR` or `ESCALATE`. `CLEAR` does **not** mean durable or memory-worthy:
clearly temporary, approximate, test-only, example-only, or non-user-state
evidence can be CLEAR when its interpretation is sufficiently resolved.

The specialist must not decide durability or WRITE/NO_WRITE, extract a final
memory proposition/value, resolve ambiguity, perform identity/correction/
Core-promotion/governance/authorization or another architecture hard gate,
discover candidates from raw episodes, or define the future Evidence Bundle
Builder. The 4B durability and extraction stages are not opened for training.

The motivating B5 failure analysis concerns observed behavior, not an
internal model mechanism: the dominant clean root failure was the 1.7B
ambiguity boundary. Mirrored errors included clear explicit non-user,
test/example, or temporary evidence over-escalated, and genuinely unresolved
referent/scope/applicability/temporal evidence falsely cleared. This bounded
failure profile motivates experimental adaptation; it does not overturn
the B5 successor disposition or demonstrate that training will succeed.

#### CLOSED — interpretation uncertainty, not user uncertainty

Every item asks one invariant question:

> Does the model-visible target and selected evidence establish one
> sufficiently resolved decision-relevant interpretation for downstream
> durability classification, or does material interpretive ambiguity remain?

P1-B6 classifies uncertainty in the interpretation available to the system,
not uncertainty that the user clearly expresses as their state. A known
unresolved user state is not an unresolved system interpretation. Therefore
explicitly tentative, undecided, provisional, temporary, approximate,
negative, or otherwise unresolved user state can be `CLEAR` when that status
itself is unambiguously established. For example, `I haven't decided yet.`,
`I'm still choosing between A and B.`, and `I'm thinking about doing A.` are
not `ESCALATE` merely because the user has not made a final choice.

Use `ESCALATE` when the target's materially relevant semantic status itself
cannot be determined—for example, the evidence does not establish whether A
is a suggestion or an adopted plan, or two fragments support incompatible
current states and neither is retracted or given precedence. This distinction
applies across all eight boundary classes. Approximation alone remains
non-ambiguous when it expresses one coherent approximate state.

`CLEAR` means only that interpretation is sufficiently resolved for the next
stage. It does not mean durable, final, desirable, true forever, memory-worthy,
or write-authorized. P1-B6 does not resolve an ambiguous referent or perform
durability, extraction, raw candidate discovery, hard-gate, or mutation-
authority decisions.

#### CLOSED — supervised corpus and historical diagnostic separation

The previous decision to add the consumed historical P1-B3 60 cases to
supervised TRAIN is **REOPENED AND SUPERSEDED**. P1-B6 supervised learning
uses only the newly authored anchor-centered conversational corpus:

| Split | Final supervised cases |
|---|---:|
| TRAIN | 240 |
| DEV | 60 |
| FINAL HELD-OUT | 80 |
| Total | 380 |

The historical 60 are excluded from supervised TRAIN, DEV, FINAL HELD-OUT,
and checkpoint/hyperparameter selection. Preserve them byte-for-byte as a
historical diagnostic/regression corpus. Do not invent turn, speaker,
fragment, anchor, or source-episode provenance to make those flat historical
cases fit the new serving schema. They may later compare base versus adapted
behavior on already observed/simple failure boundaries, but are consumed
evidence and must never be represented as fresh held-out evaluation.

The 10 previously proposed historical semantic-skeleton groupings remain
**historical reference skeletons only**: failure/coverage organization,
near-duplicate detection while authoring new skeletons, regression grouping,
and prevention of trivial repackaging of old cases. They are not supervised
TRAIN-reserved structures and are not part of the new 56-skeleton catalog.
No missing identity or content for those reference groupings is synthesized
by this documentation update.

The final supervised 380 must contain exactly **190 CLEAR and 190 ESCALATE**.
DEV must contain **at least 15 CLEAR and 15 ESCALATE**; FINAL HELD-OUT must
contain **at least 20 CLEAR and 20 ESCALATE**. These 25% coverage floors reserve
examples for both error directions; they do not establish statistical
sufficiency or acceptance/adoption thresholds. Exact 30/30 DEV and 40/40 FINAL
balance is not required. No further exact per-split or per-skeleton label
quota is imposed. The HELD count follows its frozen skeleton labels and
five-cases-per-skeleton rule, so its floor requires at least four of the 16
HELD skeletons for each label without requiring an exact 8/8 allocation.

#### CLOSED — supervised semantic-skeleton catalog

The final approved new catalog must contain exactly **56 semantic
skeletons**; this freezes its inventory and split allocation, not a claim
that the later authoring/review artifacts already exist. No individual
skeleton becomes approved until it completes the review process below:

| Boundary class | TRAIN | DEV | FINAL HELD-OUT | Total |
|---|---:|---:|---:|---:|
| FINALITY / COMMITMENT | 3 | 2 | 2 | 7 |
| REVISION / CONFLICT | 3 | 2 | 2 | 7 |
| PERSISTENCE / EXCEPTION | 3 | 2 | 2 | 7 |
| REFERENT | 3 | 2 | 2 | 7 |
| SCOPE / APPLICABILITY | 3 | 2 | 2 | 7 |
| ACTUALITY | 3 | 2 | 2 | 7 |
| COMPLEMENTARY EVIDENCE | 3 | 2 | 2 | 7 |
| APPROXIMATION / RANGE | 3 | 2 | 2 | 7 |
| **Total** | **24** | **16** | **16** | **56** |

Leakage hierarchy:

```text
boundaryClass
    -> semanticSkeletonId
        -> surfaceInstance
```

`semanticSkeletonId` is the semantic leakage unit. The same ability or
boundary class may occur across splits, but the same semantic skeleton or a
near-paraphrase may not. Domain, entity, value, number, language, lexical
phrasing, or discourse order alone does not create a new skeleton when the
decision-relevant semantic relation remains unchanged. If those details can
be replaced by placeholders while preserving that relation, the items share
one skeleton. `discoursePattern` is surface metadata unless order itself
changes the semantic relation being judged. All variants in a contrast group
stay in one split.

Author approximately **70 abstract skeleton candidates** to retain exactly
56 after HUMAN review; 70 is guidance, not an exact generation quota.
Skeletons contain abstract semantic structure only. Recommended conceptual
fields are `semanticSkeletonId`, `splitAssignment`, `boundaryClass`,
`intendedLabel`, `candidateFocus`, `semanticRelations`, `decisionBasis`, and
`contrastGroupId`. Here `candidateFocus` describes the semantic aspect under
test; it is neither a source-derived memory proposition nor necessarily a
serving-time field. Do not put concrete conversations, names, dates, numbers,
domains, language assignments, fragment counts, durability labels,
extraction schemas, or historical model output into semantic structure.
No draft example or generator label is authoritative. In particular, an
unambiguous relation equivalent to “I have not decided between A and B yet”
cannot remain an `ESCALATE` skeleton merely because the final choice is absent.

**HUMAN skeleton review Pass 1.** Show only semantic content needed to judge
the structure, such as candidate focus and semantic relations. Hide generator
intended label, boundary class, split, decision basis, contrast group, and
historical-similarity metadata. The reviewer independently chooses
`KEEP / FIX / REJECT` and `CLEAR / ESCALATE`. Difficult but human-resolvable
structures may remain. If the abstract structure lacks stable HUMAN
ambiguity gold, reject it rather than treating ill-defined gold as useful
difficulty. A FIX receives a new blind review after editing; its prior HUMAN
label is not inherited. Generator intent is not authority.

**IMPLEMENTED / FROZEN — skeleton candidate validation and Pass-1 receipt.**
The candidate envelope identity is
`xion-local-memory-inference-p1b6-skeleton-candidates-v1` and has exactly
`name` plus `candidates`; no canonical real candidate artifact exists yet.
Each candidate has exactly the conceptual fields above, with optional
`contrastGroupId`. `semanticSkeletonId` uses opaque
`p1b6-sk-<16 lowercase hex>` form and an optional contrast identity uses
`p1b6-cg-<16 lowercase hex>` or null. Candidate focus and each of 2–5 ordered
relations are non-empty and bounded to 300 characters; decision basis is
non-empty and bounded to 600 characters. IDs are unique, contrast-group
members remain in one split, and unknown surface/model/training fields are
rejected. Validation checks structure and enums only; it does not treat the
generator's `intendedLabel` as semantically correct. A reviewable fixture
contains at least two candidates, so a non-authoring-order review is possible.

The blind protocol is `xion-p1b6-skeleton-human-pass1-v1`; its completed
receipt identity is
`xion-local-memory-inference-p1b6-skeleton-human-pass1-receipt-v1`. Review
order is the ascending SHA-256 order of `protocolVersion + NUL + opaque ID`;
if that order ever equals authoring order exactly, it rotates once. It is
therefore deterministic and non-authoring-order. The UI exposes only candidate
focus and ordered semantic relations, with no ID or position. Every candidate
receives the same fixed rubric: explicit user uncertainty, tentativeness,
provisionality, temporariness, approximation, or negative status may be CLEAR
when that semantic status itself is unambiguous; ESCALATE applies only when
materially different decision-relevant interpretations remain unresolved;
and CLEAR does not mean durable or memory-worthy. The rubric is protocol text,
not candidate metadata. The reviewer then gives independent
`KEEP / FIX / REJECT` and `CLEAR / ESCALATE` decisions for every row. A
completed write-once receipt records protocol and fixture identities, SHA-256
of the exact raw fixture bytes, completion time, and one minimal result per
candidate restored to canonical fixture order.
Interrupted review writes no receipt and never mutates the fixture. Explicit
input/output paths are operational arguments, not semantic knobs. This slice
does not implement FIX editing/re-review, Pass 2, catalog freeze, or any
surface-data workflow.

**HUMAN skeleton review Pass 2.** After Pass-1 labels freeze, conduct a
catalog-level leakage/coverage audit covering historical-reference and
cross-split near-paraphrases, domain/entity/value substitution equivalence,
duplicate semantic relations under different wording, trivial lexical
shortcuts, natural realizability, and per-split boundary-class coverage.
A model may suggest duplicate pairs; HUMAN review is final authority. If two
cross-split entries are effectively the same skeleton, retain the more useful
natural structure and author a genuinely different replacement for the
deficient split. An accepted surface realization must retain its approved
skeleton HUMAN label; an opposite blind surface label requires FIX/re-review
or rejection, not silent reassignment.

**Catalog feasibility before final approval/freeze.** After blind skeleton
review and the leakage/coverage audit, check whether the proposed HUMAN labels
and split assignments can support the final split sizes, overall 190/190
balance, DEV/FINAL label floors, representation of every skeleton, and five
cases per HELD skeleton. This checks feasible case allocations; it does not
invent surface cases. Final catalog approval and freeze require this check to
pass. Actual fragment/language coverage and pool eligibility are additionally
checked against the reviewed surface pool before final selection.

Distinguish an insufficient surface pool from an infeasible skeleton catalog.
If the catalog can support the counts but accepted surfaces are missing,
author additional surfaces and run the required audits/reviews. If the
skeleton HUMAN-label/split composition itself cannot support the counts, do
not freeze the catalog: return to skeleton authoring, blind review, and catalog
audit with genuinely different replacement structures. Adding surfaces of the
same fixed-label skeleton cannot repair that failure. Do not change HUMAN
labels to fit counts or duplicate a skeleton into another split. Recheck
feasibility after any proposed catalog revision.

#### CLOSED — serving-shape, anchors, fragments, and future-builder boundary

**Anchor correction before dataset authoring.** The complete-turn-only
anchor decision is **REOPENED AND SUPERSEDED** by exact source-span
addressing. A shared turn can contain separately judged targets with
different gold; whole-turn references alone need not distinguish them.
This prospective P1-B6 correction changes no historical B1–B5 contract/data.

A new surface item conceptually contains:

```text
source episode
+ anchorSpanRefs
+ 1..5 selected conversational fragments
+ one ambiguity gold
```

Do not require a derived natural-language candidate proposition as a
serving field. Store source episodes with stable episode and turn identities;
source turns remain evidence and are not rewritten into candidate
propositions. One episode may yield 0..N candidate-centered items, and one
source turn may legitimately participate in multiple separately adjudicated
items. For example, a USER turn mentioning both a new exercise intention and
a new study intention may ground an exercise-centered item and a study-
centered item when later evidence develops each separately. This overlap is
expected, not leakage within the split.

`anchorSpanRefs` are **exact verbatim source-span locators** within identified
source turns. A locator may cover a complete turn when that already identifies
one decision target and the complete turn is genuinely the smallest
appropriate target; anchors need not be artificially shorter. Sub-turn spans
are allowed where needed. The complete containing turn remains unchanged in
the selected evidence. For example,
`운동은 확정했고, 공부는 아직 못 정했어.` can support separate items anchored
at `운동은 확정했고` and `공부는 아직 못 정했어`; the same visible turn alone
would not identify which target is being judged.

An anchor locates **what source expression/state/question is under judgment**,
not its answer. It is not a rewritten candidate proposition, normalized value,
summary, durability label, or extraction result. Selecting a target can involve
semantic judgment, but the selection is a fallible processing annotation, not
new source evidence or user-state authority. No serving-time semantic
`candidateFocus` field is introduced.

Target localization must preserve source-local operators materially necessary
to identify what the source says, including applicable negation, modality,
uncertainty or finality marking, local quantification, and local scope. Do not
reduce `운동을 시작할까 생각 중이야` to an anchor equivalent to `운동을 시작`
and thereby erase its modality. This does not authorize the builder to resolve
external referents, infer a normalized proposition, or perform extraction.

Use one target expression where sufficient. Multiple anchor spans must jointly
identify the same single decision target, not silently combine independent
candidates or assert an unresolved coreference link; supporting mentions may
remain ordinary context. At least one anchor lies in a USER source turn.
Assistant anchor/context turns may supply questions or context, but cannot
independently become user-state authority.

**Target identifiability is not interpretation resolution.** A target such as
`그건 기본값을 4로 해.` remains valid `ESCALATE` when `그` has no resolved
referent in the selected evidence. Anchor selection must not choose its
antecedent, settle scope/finality, or omit competing relevant evidence to make
the target look CLEAR. Conversely, an unmarked choice between independent
targets is an item-definition defect, not useful REFERENT ambiguity.

The model and HUMAN reviewer must see the target location within the evidence.
A span alone is not a guarantee of a well-defined task: if deciding which
state/aspect is being judged still requires hidden skeleton metadata or an
author's unstated question, FIX/re-review or reject the item. Item IDs or
unexplained candidate ordinals cannot disambiguate it. Under the same task
contract, identical model-visible evidence and target marking must not carry
different gold because of an invisible target distinction.

For the final supervised 380, exact fragment-count case totals are:

| Conversational evidence fragments | Cases |
|---:|---:|
| 1 | 70 |
| 2 | 100 |
| 3 | 120 |
| 4 | 70 |
| 5 | 20 |
| Total | 380 |

A fragment is a **short contiguous conversational source span** relevant to
the one anchor-defined ambiguity target, not a sentence count or rewritten
summary. It may contain one or more consecutive turns. Items have 1–5
fragments; fragments preserve source chronology and are never post-hoc
shuffled. Every selected fragment must be materially relevant to interpreting
the target.

**One item = one candidate/state/question** for ambiguity classification.
A source turn may contain incidental or overlapping information about other
memory candidates without invalidating the item. The hard prohibition is
that independent targets must not silently share one ambiguity gold. The
same turn or episode may instead support multiple separately anchored and
adjudicated items. P1-B6 assumes the relevant evidence bundle has already
been selected.

Determining which raw-conversation spans belong together and selecting target
source anchors belong to the future **Evidence Bundle Builder** responsibility,
not the ambiguity specialist. This does not introduce a separate Candidate
Formation subsystem or require the builder to extract a final memory
proposition/value. Candidate discovery and target localization are semantic
work, not merely offset bookkeeping. Its implementation remains **OUT OF
SCOPE / UNOPENED**; success on preselected HUMAN-reviewed bundles would not
establish that an automatic builder can construct them reliably.
B6 neither trains nor evaluates raw-episode evidence discovery, and this
section opens no raw-episode experiment or bundler implementation. Only these
interface-relevant observations are retained: one episode can produce 0..N
bundles; bundles can overlap in source turns; temporally distant spans can
belong to one candidate bundle; and candidate-discovery failure is distinct
from downstream `NO_WRITE`. Candidate discovery, thread tracking,
coreference, and bundle construction remain future research questions; no
algorithm, model, heuristic, service, or production architecture is selected.

**Prospective downstream target continuity.** Ambiguity, durability, and
extraction must retain the same source-grounded target and original selected
evidence; structured decisions control flow, not replacement evidence.
Durability judges that target only after CLEAR, and extraction derives the
requested content from evidence without rediscovering an unmarked candidate.
Existing B1–B5 evidence-only prompts do not implement this anchor-aware input.
The later hybrid interface/prompt versions must be explicitly specified and
tested; this correction neither edits frozen prompts nor claims that B1's
bounded one-fact extraction already supports general proposition extraction.

Recommended source-normalized storage shape, **conceptual only**:

```text
sourceEpisodes:
  sourceEpisodeId
  splitAssignment
  point-in-time / version identity
  ordered immutable source turns

items:
  itemId
  sourceEpisodeId
  semanticSkeletonId
  anchorSpanRefs
  1..5 fragment references into source turns
  authoring metadata
  HUMAN review/gold metadata in its appropriate artifact/layer
```

Source text has one canonical representation. Anchors reference an exact
occurrence in an immutable source version, using episode/turn identity and
version/content identity; copied text alone cannot distinguish repeated text.
Every anchor span must be inside the item's selected evidence. This follows
the architecture's EvidenceRef source/locator boundary (§51.2–51.4), without
requiring a new registry implementation for the dataset.

Anchor text displayed to reviewer/model is resolved from that source. Any
optional stored quote is a checked cache, not a second source of truth.
Source edits require a new version, revalidation of all affected references,
and new blind HUMAN review of each affected item before reuse. Do not silently
normalize/rewrite source text, fuzzy-rematch a stale anchor, or treat locator
failure as semantic ESCALATE. The eventual addressing unit must be explicit
and preserve exact source identity across Unicode/normalization boundaries;
tokenizer-token indices are not frozen as source addresses.

Exact byte/character addressing, JSON filenames, review-receipt schemas,
canonical serialization/hashing, and renderer implementation remain **OPEN**
for the subsequent dataset/review-tool implementation design. Freeze those
details before producing annotations that depend on them; they are not new
architecture semantics.

#### CLOSED — point-in-time source/bundle completeness audit

P1-B6 separates **semantic incompleteness** from **selection
incompleteness**. Semantic incompleteness means that the complete source
evidence available at the item's point-in-time snapshot genuinely leaves the
target unresolved; this may correctly yield `ESCALATE`. Selection
incompleteness means that material evidence exists in that snapshot but was
omitted from the selected bundle; this is a construction failure and must not
be converted into `ESCALATE` gold.

Before blind HUMAN ambiguity review, a separate source auditor inspects the
frozen point-in-time source-episode snapshot, target span(s), and selected
fragments. The audit asks only whether unselected source evidence could
reasonably change, resolve, contradict, or otherwise alter the target's
decision-relevant interpretation or its `CLEAR`/`ESCALATE` judgment. This
includes evidence affecting referent, current-state precedence, finality,
scope, persistence, actuality, contradiction, revision, or retraction.
Redundant restatement need not be included, and a valid bundle need not copy
the full transcript.

The source auditor does not assign ambiguity gold. Hide generator intent and
skeleton HUMAN label where practical. Conceptual outcomes may include `PASS`,
missing material evidence, target not identifiable, and invalid source
mapping; the exact enum, schema, and tool remain OPEN. Only `PASS` items enter
blind surface-gold review.

Completeness is assessed only against evidence available in the frozen source
snapshot when the item is defined. Later conversation is not hindsight
evidence against an earlier bundle. Exact timestamp/version schema remains
OPEN, but future evidence must not retroactively change completeness.

A material edit to an anchor, selected evidence/fragments, or source mapping
after source audit or HUMAN review invalidates the affected decisions. The
item must restart at source/bundle audit, receive `PASS`, and then receive a
new blind HUMAN review; prior gold is not inherited.

#### CLOSED — realistic discourse and authored order

New data must substantially include realistic, non-canonical conversational
evidence, not only clean benchmark-like statements. Coverage includes:

- tentative → tentative and tentative → explicit final decision;
- within-episode self-revision and unresolved competing states;
- general state plus a temporary exception and late-added constraints;
- context-first versus conclusion-first expression;
- interleaved semantic components and returning to the same topic after
  another relevant component;
- multiple fragments whose relationship is needed to determine whether
  the candidate is resolved.

Within-episode self-revision is in scope. **Explicit correction of an
already stored durable memory is out of scope** and remains governed by
existing architecture hard gates.

There is no required canonical order for semantic components. As authoring
concepts only, one conversation may express behavior then timing, another
timing then behavior, and another interleave behavior, scope, timing, and
finality. This is **source-discourse diversity**, not post-hoc augmentation
by random permutation. Do not randomly reorder a completed bundle for
primary training/evaluation; model input preserves authored conversational
order.

#### CLOSED — approximation is not unresolved ambiguity

**Vagueness / approximation != unresolved ambiguity.** Expressions such as
`정도`, `쯤`, `약`, `한`, `대략`, `주 4회 정도`, `3~4회`, `한두 번`,
`about`, `around`, `roughly`, and equivalent mixed-language approximations
do not by themselves require ESCALATE.
A deliberately approximate point/range can be CLEAR when it expresses one
sufficiently coherent state for downstream classification. An explicit state
such as `매주 할지 격주로 할지 아직 고민 중이야` is CLEAR when that indecision
is unambiguously established. Use ESCALATE when evidence about the currently
applicable state conflicts and the model-visible evidence does not establish
the relation or precedence between those claims. Absence of a final user
choice alone does not require ESCALATE. How approximation is represented in a
downstream extraction schema is outside B6 and is not decided by the ambiguity
stage.

#### CLOSED — language and surface authoring pool

The **new 380** must have exactly **266 Korean (70%)**, **76 natural
Korean/English mixed (20%)**, and **38 English (10%)** cases. Mixed-language
coverage must resemble plausible conversation, not awkward token-level
language mixing.

Author approximately **500 surface candidates**—roughly 315 TRAIN, 80 DEV,
and 105 HELD-eligible—to retain the exact final split sizes. These are
generation directions, not exact pool quotas. Do not force exact per-
skeleton candidate counts. Approximate generation-stage fragment targets
may be 92 / 132 / 158 / 92 / 26 for 1 / 2 / 3 / 4 / 5 fragments; only the
accepted 380 must satisfy the exact final constraints.

Semantic-family and clean/dirty proportions beyond the hard constraints are
generation guidance, not exact surface quotas. Subject to those hard
constraints, retain the natural accepted distribution unless a semantic
family or important discourse class becomes materially underrepresented.

Within a skeleton, surface instances must differ in meaningful evidence
realization, not merely nouns, numbers, or paraphrases. Vary where natural:
fragment count, assistant involvement, evidence distribution, explicit
versus elliptical replies, context-first/conclusion-first order, progressive
refinement, return to topic, self-revision, temporary side context, language,
surface domain, and location of resolving evidence.

Keep these `discoursePattern` metadata candidates: `CANONICAL`,
`CONTEXT_FIRST`, `CONCLUSION_FIRST`, `INTERLEAVED`,
`PROGRESSIVE_REFINEMENT`, `SELF_REVISION`, `RETURN_TO_TOPIC`, and
`ELLIPTICAL_REPLY`. They are authoring metadata, not model input or semantic
leakage identity.

#### CLOSED — primary HUMAN surface review

Only a source/bundle-audit `PASS` item is eligible. The gold reviewer sees only
the B6 model-visible input: selected evidence fragments with exact target
source spans visibly marked, including their unchanged containing turns. The
target distinction must also be visible to the model; a reviewer-only
highlight cannot define its task. The reviewer does not see the full hidden
source episode. Hide intended label, semantic skeleton ID, boundary class,
split, surface domain, discourse-pattern label, and generator rationale.
Judgment uses only the selected evidence that the model would receive; omitted
turns cannot determine gold. Material evidence hidden from the model is a
construction failure for the source/bundle audit, not information available
to the gold reviewer.

The reviewer independently chooses `KEEP / FIX / REJECT` and
`CLEAR / ESCALATE`; HUMAN gold is authoritative. Difficult but human-
resolvable cases may remain. Ill-defined gold, incoherent targets, or
implausible conversation must be rejected rather than converted to
ESCALATE. A surface label opposite to its approved skeleton HUMAN label
cannot remain an accepted realization without FIX/re-review or rejection.
Repeated mismatch triggers review of that skeleton's natural realizability
and semantic stability.
A FIX follows the full restart rule above; neither the previous HUMAN label
nor generator intent is inherited.

#### CLOSED — three independent split-leakage protections

All three constraints are mandatory:

```text
semantic-skeleton split integrity
+ source-episode split integrity
+ surface-realization split integrity
```

Near-paraphrases or simple entity/domain substitutions of one semantic
skeleton cannot cross splits. Independently, **all items derived from one
`sourceEpisodeId` belong to the same TRAIN/DEV/FINAL HELD-OUT split**. One
episode cannot contribute, for example, an exercise item to TRAIN and a study
item to FINAL HELD-OUT, because that leaks held-out source text. Assign split
at source-episode/family authoring time before surface generation rather than
row-random item splitting. Historical reference skeletons also participate
in near-duplicate detection even though the historical 60 are excluded from
every supervised split and from selection.

Distinct skeleton and episode IDs are necessary but not sufficient. Across
splits, prohibit exact or near-verbatim conversational evidence, mechanical
entity/domain/number/language substitutions, and lexical paraphrases of
essentially the same authored dialogue realization. Automated text,
embedding, or similarity checks may later flag suspect pairs, but HUMAN
judgment is final authority. A confirmed cross-split surface duplicate or
near-duplicate is a hard leakage failure and must be removed or re-authored
before pool freeze. Exact similarity method, model, and threshold remain OPEN.

#### CLOSED — HELD pool review before deterministic FINAL selection

Repeated review precedes selection of the FINAL 80:

```text
authored HELD pool
-> source/bundle audit PASS
-> primary blind HUMAN review
-> accepted HELD-eligible pool
-> evidence and target freeze
-> blind repeated HUMAN pass on every eligible accepted candidate
-> disagreement resolution and candidate-pool HUMAN gold freeze
-> leakage/constraint validation
-> deterministic selection of FINAL 80
```

Opaque-reorder the eligible pool before Pass 2. The same HUMAN reviewer
performs this **blind repeated HUMAN pass**; it is not an independent second
reviewer. Hide the Pass-1 label and disposition, generator intended label,
generator rationale, and skeleton/boundary metadata where practical. Record
each disagreement and resolve it using only the same frozen model-visible
evidence. Do not edit evidence during disagreement resolution. If editing is
needed, the item exits the frozen pool and restarts the applicable source
audit and blind-review path.

No P1-B6 model output may be inspected on FINAL candidates before source
audit, both HUMAN passes, disagreement resolution, pool gold freeze,
deterministic selection, and dataset freeze. FINAL HELD-OUT is never used for
checkpoint or hyperparameter selection. Once FINAL model output has been
inspected, that evaluation version's evidence, targets, HUMAN gold, case
membership, and distribution are immutable. Later-discovered defects receive
a separate erratum explaining their impact on interpretation; preserve the
original evaluation inputs and results. Calling a change an error correction
does not permit editing or replacing the frozen evaluation set.

#### CLOSED — FINAL HELD-OUT coverage and reporting

FINAL HELD-OUT contains exactly **16 held-out semantic skeletons × 5 accepted
surface cases each = 80 cases**. TRAIN and DEV require representation of all
their approved skeletons but no equal per-skeleton case count. If a held
skeleton cannot yield five valid cases, mark selection **INFEASIBLE**, author
additional candidates for that skeleton, run the required audits and blind
reviews, refreeze the eligible pool, and rerun deterministic selection. Do not
lower review quality or force weak cases to meet the count.

FINAL analysis reports at least overall micro results, `ESCALATE` safety/error
behavior, unnecessary escalation/CLEAR-side error behavior, per-skeleton
results, a macro result across the 16 held skeletons, and a boundary-class
breakdown. Exact acceptance/adoption thresholds remain OPEN. Equal synthetic
coverage is a capability-evaluation design, not a claim about production
ambiguity frequency; real system-value weighting remains governed by the
separate workload-frequency observation contract.

#### CLOSED — deterministic final selection

After skeleton review, source/bundle audit, blind surface review, cross-split
leakage audit, repeated HELD review, disagreement resolution, and eligible-
pool gold freeze, choose the final 380 through deterministic, constrained,
non-interactive selection—not aesthetic hand-picking. Hard constraints are:

- TRAIN 240, DEV 60, FINAL HELD-OUT 80;
- CLEAR 190 and ESCALATE 190 overall;
- DEV at least 15 cases of each label; FINAL at least 20 of each label;
- exact overall fragment-count and language totals;
- all 56 approved new skeletons represented in their assigned split;
- exactly five cases for each of the 16 FINAL HELD-OUT skeletons;
- semantic-skeleton, source-episode, and surface-realization split integrity.

Use a reproducible ranking/tie-break based on canonical item identity/hash
or another explicitly reproducible mechanism. Exact serialization, hash,
and solver implementation are selected later. If no valid 380-case subset
exists, **FAIL CLOSED** and identify whether the cause is surface-pool
shortage or catalog infeasibility using the catalog-feasibility rule above.
For a surface shortage, author targeted cases, run all required audits and
reviews, refreeze the eligible pool, and rerun selection. A catalog-level
failure must return to skeleton review; it must not loop through additional
fixed-label surfaces. Do not force favored items into the dataset or weaken
frozen constraints after seeing model results.

#### OPEN — required later decisions, not selected here

The following remain explicitly **OPEN**; none is silently chosen by the
dataset contract:

- Exact synthetic generation prompt, model/provider, model version,
  settings, and temperature.
- Exact later skeleton FIX/re-review and Pass-2 tools, surface/HELD HUMAN
  review UI/tool, and source-audit UI/tool; any assisting source-audit
  model/provider.
- Exact surface-similarity model/method and threshold.
- Exact source-locator encoding, later source/surface/catalog artifact
  filenames/schemas, model-visible renderer/serialization, canonical hash,
  and deterministic constraint-solver implementation.
- Base 1.7B training-checkpoint provenance and final checkpoint choice;
  provenance must be verified before training.
- SFT/LoRA framework or mechanism, LoRA rank, target modules, learning rate,
  optimizer, batch size/gradient accumulation, epochs/max steps, and
  quantization/training precision.
- Checkpoint-selection rule and training stopping rule.
- Standalone ambiguity acceptance thresholds and full-hybrid fresh-held-out
  acceptance/adoption rule.
- Adapter merge/GGUF conversion, deployment, or production authorization.
- Future raw Evidence Bundle Builder implementation, including model family,
  heuristic, embeddings, retrieval, threshold, service architecture, and
  candidate-discovery/coreference/thread-tracking algorithm.
- Raw-episode evaluation and private natural XION replay.

The user intends to choose the training environment and execute training
interactively with ChatGPT later; this documentation task does not delegate
or preselect those decisions. Next step is to freeze the **actual abstract
skeleton authoring/generation contract**, produce the candidate fixture, and
run the implemented blind Pass-1 review before designing FIX/re-review,
Pass 2, or catalog freeze. Remaining surface-tool and training
preregistration follows; training itself does not. The prospective policy
still permits a separately preregistered intervention without a general
untuned-performance entry gate. Before execution, provenance, mechanism,
metrics, leakage controls, checkpoint selection, and stopping rules must be
frozen. Training execution, raw episodes, and private replay remain
**UNOPENED**. Production memory/parsing, DB/Vault/retrieval/routing, authority,
identity, explicit correction, Core/high-impact gates, and architecture
contracts remain unchanged.
