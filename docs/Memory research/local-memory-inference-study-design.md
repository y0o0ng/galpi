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
prompt/schema contracts, and llama.cpp runtime version. That run has not
yet occurred, so no approximately 2B result is recorded here. The
fixture, gold labels and provenance, parser and `response_format`
behavior, screening thresholds, critical-unsafe-zero rules, hard-gate
handling, and model-size progression remain unchanged.
