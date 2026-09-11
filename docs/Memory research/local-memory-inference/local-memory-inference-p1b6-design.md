# P1-B6 Ambiguity Specialist Design

> Status: **ACTIVE DESIGN CONTRACT**
>
> The semantic-skeleton catalog is CLOSED/FROZEN. This document contains the
> current contracts for the next surface/source-episode phase; historical
> review and execution evidence is in
> [`local-memory-inference-run-receipts.md`](local-memory-inference-run-receipts.md).

## Status / Current Next Step

P1-B6 asks whether the visible target and evidence uniquely determine the
target's decision-relevant semantic status. It classifies interpretation
uncertainty, not durability, memory worthiness, or authorization to write.

The anchor-marker paired pilot is complete and the representation is CLOSED
as `SINGLE_REPRESENTATIVE`. Surface smoke batch-001 is authored. Its separate
strong-model source-audit attempt 001 completed at 30 PASS / 2 FAIL / 0
UNCERTAIN; both failures were source/bundle construction failures, not HUMAN
ambiguity judgments. After repair, attempt 002 completed at 32 PASS / 0 FAIL /
0 UNCERTAIN for the prior batch. Primary blind HUMAN review attempt 001 then
completed at 31 KEEP / 1 FIX / 0 REJECT and 21 CLEAR / 11 ESCALATE. The one
dialogue-role correction was applied, and source-audit attempt 003 completed at
31 PASS / 1 FAIL / 0 UNCERTAIN. Its source/bundle completeness construction
issue was repaired by the minimum evidence-selection change. The current batch
changed again, so full source-audit attempt 004 is prepared but NOT RUN and
HUMAN review remains open with no HUMAN gold frozen. Training, raw-episode
evaluation, private replay, and production remain UNOPENED/unchanged. Do not
redesign the frozen skeleton catalog, generate training output, expose a model
to FINAL surface items, or start training in this phase.

## Task Boundary

P1-B6 returns `CLEAR` when the target's materially relevant semantic status is
unambiguously established in the visible evidence. An explicitly tentative,
undecided, temporary, approximate, negative, example-only, or non-user state
can therefore be CLEAR when that status itself is clear.

`ESCALATE` is reserved for a materially relevant semantic status that cannot
be determined from the visible evidence. Missing persistence evidence is not
automatically semantic ambiguity. B6 does not decide durability, extraction,
identity/correction/Core/governance hard gates, or production writes.

## Historical Corpus Separation

The historical P1-B3 60 cases are diagnostic/reference-only. They do not enter
supervised TRAIN, DEV, or FINAL_HELD_OUT and must not receive invented
conversation, source-episode, or anchor provenance.

## Frozen Semantic-Skeleton Catalog

The canonical artifact is
`fixtures/local-memory-inference-p1b6-skeleton-exact56.json`, frozen at raw
SHA-256 `772f07bd679a9c98ea65feaa164ec7a9c1f3e3fb33632052ef076f8301999602`
by commit `8bc6da38e1baf770827bbb84ee189e5821fe2f07`.

It contains exactly 56 skeletons:

- TRAIN 24, DEV 16, FINAL_HELD_OUT 16;
- each of the eight boundary classes has exact TRAIN/DEV/HELD coverage 3/2/2;
- HUMAN skeleton labels are CLEAR 32 and ESCALATE 24.

The catalog is semantic-skeleton data only. It contains no durability labels,
extraction schemas, surface dialogue, source-episode provenance,
`intendedLabel`, or `decisionBasis`. Existing contrast groups are inherited;
new groups are not invented by later materialization.

## Supervised Corpus

The new supervised corpus has exactly 380 surface items:

- TRAIN 240;
- DEV 60;
- FINAL_HELD_OUT 80;
- CLEAR 190 and ESCALATE 190 overall;
- DEV has at least 15 CLEAR and 15 ESCALATE;
- FINAL_HELD_OUT has at least 20 CLEAR and 20 ESCALATE.

The balanced 190/190 target is an evaluation/training construction constraint,
not a claim about production ambiguity prevalence. All items from one source
episode stay in one split. FINAL_HELD_OUT is never used for checkpoint or
hyperparameter selection.

All 56 approved semantic skeletons are represented in their assigned split.
TRAIN and DEV represent every approved skeleton assigned to those splits.
FINAL_HELD_OUT contains exactly 16 held-out semantic skeletons, with exactly
five accepted surface cases per held skeleton, for 80 cases total.

The final fragment totals are exactly 70 / 100 / 120 / 70 / 20 for 1 / 2 / 3
/ 4 / 5 fragments. The final language totals are exactly KO266, natural
KO-EN mixed76, and EN38.

## Closed Selection and Freeze Constraints

The accepted surface pool is selected through a deterministic, constrained,
reproducible procedure after review and leakage validation. It is not aesthetic
hand-selection. The selection procedure must freeze its serialization,
identity/hash tie-break, and constraint implementation before final selection.

The required order is:

```text
authored HELD pool
  -> source/bundle audit PASS
  -> primary blind HUMAN review
  -> accepted HELD-eligible pool
  -> evidence and target freeze
  -> repeated blind HUMAN review of every eligible accepted candidate
  -> disagreement resolution and pool HUMAN-gold freeze
  -> leakage and constraint validation
  -> deterministic FINAL selection
  -> dataset freeze
```

Repeated HELD review therefore occurs before deterministic FINAL selection, and
the evidence/target freeze precedes that repeated blind HUMAN review. No FINAL model output may be inspected before source audit, both HUMAN passes,
disagreement resolution, pool gold freeze, deterministic selection, and dataset
freeze. FINAL is never used for training, checkpoint selection, or
hyperparameter selection.

After FINAL model output has been inspected, that evaluation version's
membership, evidence, targets, and HUMAN gold are immutable. A later defect
may be recorded only through an explicit erratum path that preserves the
original evaluation inputs and results; it does not silently replace the
frozen set.

If no valid 380-item subset exists, FAIL CLOSED. The failure must distinguish
a surface-pool shortage from catalog infeasibility. A surface shortage may
receive newly authored candidates followed by the full audit/review/refreeze
path. Catalog infeasibility must return to skeleton review. Do not weaken a
frozen constraint, hand-pick favored items, or relabel HUMAN gold to satisfy
counts.

## Source Episodes and Items

A source episode may produce 0..N B6 items/bundles. Most episodes may produce
one item; multi-item episodes are allowed when they test candidate and anchor
separation. Items from one episode may overlap in source turns, so one source
turn may participate in multiple separately anchored candidate items.
Temporally separated source regions may belong to one candidate bundle. All
items from one source episode still remain in the same split. This overlap
supports multi-topic evidence and does not create a separate candidate or
anchor subsystem.

The minimal research representation is:

```text
sourceEpisode:
  sourceEpisodeId
  splitAssignment
  turns:
    - turnId
      role
      text

item:
  itemId
  sourceEpisodeId
  semanticSkeletonId
  anchorSpanRef
  evidenceSpanRefs
  authoring/review metadata as required
```

For this P1-B6 research corpus, a source locator is frozen as `turnId` plus
zero-based raw UTF-8 byte offsets `[startByte, endByte)`. Both offsets must be
code-point boundaries and the selected bytes must decode losslessly to
non-empty text. This is a research-fixture representation only, not a frozen
production Evidence DB or source-address interface. Evidence selection may
use a proper subrange of a turn.

Do not introduce production-storage machinery solely for research fidelity:
no syntheticEvidence table, per-turn hashes, dataset-local PIT cutoff, replica
Evidence DB, or storage/service abstraction is required by this contract.
Fixture-level freeze and raw-byte hashing are sufficient unless a concrete
requirement later proves otherwise.

## Candidate Granularity

A candidate is the coarsest coherent state or decision thread centered on a
source-visible topic for which one meaningful CLEAR/ESCALATE judgment can be
made. Properties, conditions, exceptions, ranges, partial decisions, and
explicitly unresolved subparts in that same topic/thread normally remain one
candidate. When the boundary is uncertain, merge.

Split only when the source contains genuinely independent topic/state/
decision threads that can be adjudicated independently. The Bundle Builder
must not perform downstream extraction merely to create finer candidates.

Examples:

- `운동 횟수는 주 3회로 정했고, 요일은 아직 못 정했어.` is one exercise-plan
  candidate; settled frequency and undecided weekday can be one CLEAR state.
- `커피는 평일엔 한 잔만 마시고, 주말에는 아직 어떻게 할지 모르겠어.` is
  normally one coffee candidate.
- An exercise plan with a knee-pain exception is normally one candidate.
- An exercise plan plus an independently undecided study plan is two candidates.
- Coffee consumption and a possible coffee-machine purchase are independent
  decision threads despite sharing a broad domain.

Perfect semantic decomposition is not the aim. The target is the lowest
realistically implementable granularity that still gives B6 a meaningful
ambiguity judgment.

## Evidence Bundle Builder

The conceptual pipeline is:

```text
source conversation / evidence
  -> Evidence Bundle Builder
  -> source-grounded anchor + selected evidence bundle
  -> P1-B6 ambiguity specialist
  -> downstream durability
  -> downstream extraction
```

There is no separate Anchor Extractor, Candidate Formation subsystem, or
separate Fragment Builder in this contract. The Evidence Bundle Builder owns,
conceptually, candidate/topic discovery, source-grounded anchor selection, and
selection of the evidence needed to judge that focus. Its future model,
heuristics, retrieval, threshold, service architecture, and coreference/
thread-tracking implementation remain OPEN.

## Anchors

An anchor tells B6 which topic/candidate to judge within a multi-candidate
visible bundle. It is a focus marker, not a semantic interpretation,
extracted proposition, attribute/slot/value selector, durability decision,
resolved referent, or hidden gold hint.

Every anchor is a verbatim word, phrase, or source span that exists in the
selected model-visible evidence. Do not invent a semantic topic label that is
absent from the source. The anchor need not contain the full proposition and
must follow the candidate/topic rather than an internal extraction attribute.

An unresolved source expression can still be an anchor. Anchoring `그건`, for
example, does not resolve its referent; if the referent remains materially
unresolved, B6 may correctly return `ESCALATE`.

Anchors primarily distinguish independently adjudicable candidates in one
bundle. They do not force B6 to inspect an arbitrary sub-slot of a single
topic. Anchor success is semantic candidate discrimination, not a minimum
token or character count. Exact locator serialization is a fixture detail;
`turnId` plus a UTF-8 byte range is only one possible future representation,
not a frozen production interface.

Anchor-marker representation is **CLOSED — `SINGLE_REPRESENTATIVE`**. Each B6
item marks exactly one representative verbatim source-grounded occurrence of
its candidate/topic. Other explicit mentions of that same topic are not
additionally marked, and marker generation does not expand through pronouns,
synonyms, semantic matching, or coreference. The one marker remains only a
topic/focus marker; it does not become a proposition, slot, attribute, value,
referent resolution, or semantic answer.

## Fragments

A fragment is a maximal contiguous source range among evidence selected by the
Bundle Builder. Selected `t1, t2, t3, t5, t6` therefore yields `t1..t3` and
`t5..t6`; selected `t1, t3, t5, t6` yields `t1`, `t3`, and `t5..t6`. Fragment
count measures disjoint source regions that must be integrated, not turns, and
contiguous evidence must not be artificially split.

With span-level selection, overlapping same-turn spans are invalid and
directly adjacent spans are one canonical span. Omitted bytes between two
same-turn spans create a fragment boundary. Selection continues across
consecutive turns as one fragment only when the previous span reaches exactly
the end of its turn and the next span starts at byte zero with no intervening
turn. Fragment count is computed from evidence spans and is never authored as
an item field.

The frozen surface renderer identity is
`xion-local-memory-inference-p1b6-surface-renderer-v1`. It renders only selected
span text in source chronology with `USER` / `ASSISTANT` prefixes and exactly
one `[TARGET]...[/TARGET]` pair around the anchor. Distinct fragments use the
exact separator `\n---\n`. It emits no generated omission marker, turn or
item ID, skeleton/split/language/discourse/family metadata, rationale, or
unselected source text. The later HUMAN-visible review text is exactly this
same rendered text.

The frozen final coverage target is:

| Fragments | Items |
| ---: | ---: |
| 1 | 70 |
| 2 | 100 |
| 3 | 120 |
| 4 | 70 |
| 5 | 20 |

## Surface Realization / Language / Discourse

The 380 items target exactly 266 Korean (70%), 76 natural Korean/English mixed
(20%), and 38 English (10%). Pool growth is adaptive: first calibrate
representation, audit, and review on the 32-item smoke batch; if healthy, grow
an initial reviewed pool to roughly 400-ish items without freezing that number;
measure actual shortages against every frozen 380-item constraint; then author
only targeted top-ups for missing split/skeleton/label/language/fragment cells.
Stop when the reviewed pool can support deterministic final selection. This
reduces unnecessary HUMAN review but does not exempt any final item from
primary blind HUMAN review or any eligible HELD item from its repeated-review
path. The final 380 is the only exact corpus-size contract.

Vary evidence realization, discourse order, progressive refinement, return to
topic, self-revision, temporary side context, language, and evidence location.
Do not treat simple entity, number, domain, or language substitution as a new
semantic skeleton.

Useful authoring metadata includes `CANONICAL`, `CONTEXT_FIRST`,
`CONCLUSION_FIRST`, `INTERLEAVED`, `PROGRESSIVE_REFINEMENT`, `SELF_REVISION`,
`RETURN_TO_TOPIC`, and `ELLIPTICAL_REPLY`. It is not model input or semantic
leakage identity.

## Source and Bundle Audit

The audit protects two different states:

- **Semantic incompleteness:** the full frozen PIT source genuinely leaves the
  candidate's materially relevant status unresolved; this may be valid
  `ESCALATE`.
- **Selection incompleteness:** relevant evidence exists in that source but the
  Bundle Builder omitted it; this is a bundle/dataset construction failure, not
  a legitimate B6 ambiguity case.

Before blind HUMAN surface review, a separate strong-model source auditor in a
fresh session inspects the full frozen point-in-time source-episode snapshot,
the selected source-grounded single anchor, and the selected fragments. The
auditor determines only whether omitted source evidence could materially
change, resolve, contradict, or otherwise alter the candidate interpretation
or its `CLEAR`/`ESCALATE` judgment. The source auditor does not assign HUMAN
ambiguity gold and is not HUMAN authority.

The canonical audit protocol is
`fixtures/local-memory-inference-p1b6-source-audit-protocol.json`. A blind
packet contains one opaque row per item with only the complete source episode
and exact rendered selected bundle. Audit dispositions are `PASS`, `FAIL`, or
`UNCERTAIN`; only `PASS` proceeds. `FAIL` and `UNCERTAIN` fail closed. Audit
generation and execution remain separate passes.

Only audit `PASS` items proceed to blind HUMAN review. Audit uncertainty fails
closed; it must not be silently treated as semantic `ESCALATE`. The audit also
checks that every selected fragment and anchor is source-grounded and that a
source episode's split and authored chronology are preserved. Missing
persistence or durability evidence is not ambiguity when the current semantic
state is otherwise uniquely established.

Any material change to source mapping, selected evidence, or anchor after the
audit requires the item to restart source audit and blind HUMAN review. Prior
gold or audit disposition is not inherited.

## HUMAN Review and HELD Freeze

Only source/bundle-audit `PASS` items are reviewable. The HUMAN ambiguity
reviewer sees only the model-visible selected evidence plus the
model-visible, source-grounded anchor marking. The reviewer does not see the
full unselected source episode or:

- generator intended label;
- semantic skeleton ID;
- boundary class;
- split;
- surface domain;
- `discoursePattern` metadata;
- generator rationale.

The reviewer independently chooses `KEEP / FIX / REJECT` and
`CLEAR / ESCALATE`; HUMAN gold is authoritative and model suggestions remain
advisory. Ill-defined gold, incoherent candidate focus, or implausible
conversation is `REJECT`, not automatic `ESCALATE`. If the blind HUMAN label
opposes the approved skeleton HUMAN label, it cannot be silently accepted or
relabeled: it requires FIX plus new review or rejection. Repeated mismatch
triggers review of that skeleton's realizability.

Any evidence edit restarts the applicable source audit and blind review. No
previous HUMAN label or generator intent is inherited after an evidence edit.
No FINAL surface item is used for training or tuning.

## HELD Repeated HUMAN Pass

After primary review, opaque-reorder the eligible frozen HELD pool before the
repeated HUMAN pass. The same HUMAN reviewer performs this repeated blind pass;
it is not an independent second reviewer. Where practical, hide the Pass-1
label and disposition, generator intended label and rationale, and
skeleton/boundary metadata.

Resolve disagreements using only the same frozen model-visible evidence. Do
not edit evidence during disagreement resolution. If an edit is required, the
item exits the frozen pool and restarts the source-audit plus blind-review
path.

## Leakage Controls

All three split boundaries are mandatory:

```text
semantic-skeleton split integrity
+ source-episode split integrity
+ surface-realization split integrity
```

Reject exact, near-verbatim, mechanical-substitution, or essential-dialogue
paraphrase leakage across splits. Historical reference skeletons participate
in duplicate detection even though their 60 cases remain outside supervised
splits. HUMAN judgment is final on suspected near-duplicates.

## Completed Anchor-Marker Paired Pilot

This pilot resolves only whether repeated explicit mentions of one
candidate/topic should all receive model-visible anchor markers. It is a
representation/interface calibration, not a B6 capability benchmark,
training experiment, Bundle Builder evaluation, DEV/FINAL evaluation, or
production authorization.

The canonical fixture is
`fixtures/local-memory-inference-p1b6-anchor-marker-pilot.json`, identity
`xion-local-memory-inference-p1b6-anchor-marker-pilot-v1`. Its 20 approved
conversations are calibration-only, have no `semanticSkeletonId`, remain
outside the supervised 380, satisfy no skeleton coverage, consume no held-out
candidate, and must never be reused as TRAIN/DEV/FINAL surface items. For each
case the full source episode is the complete model-visible evidence bundle;
there is no evidence omission or fragment selection.

Variant A marks the first declared representative explicit occurrence.
Variant B marks every predeclared explicit same-topic occurrence. Both use
`[TARGET]...[/TARGET]` in plain role-prefixed conversation. Marker locations
come only from the fixture: do not discover synonyms, pronouns, stems, semantic
matches, or coreference. Removing the tags from A and B must produce
byte-identical visible conversation text.

The fixed probe is `xion-p1b1-qwen3-1.7b-bf16`
(`unsloth/Qwen3-1.7B-GGUF:BF16`, ~2B, BF16) on llama.cpp runtime
`e42214804794fca6abb61b1a5f9adae2a845f0be`. This freezes only the pilot probe;
future P1-B6 training-base provenance and selection remain OPEN.

Use one 10,000 ms health preflight, then exactly 40 semantic calls in order
`001A, 001B, ... 020A, 020B`, with no semantic rerun. Requests use temperature
0, `max_tokens` 128, non-streaming JSON-object response, thinking disabled,
and a 180,000 ms semantic timeout. The fixed prompt explains that markers
identify only the topic/candidate and provide no proposition, referent,
attribute/value, durability, or semantic answer. Output is the existing strict
structural `CLEAR`/`ESCALATE` decision object with no rationale.

For each variant report exact schema-valid agreement with HUMAN gold, invalid
structured output, runtime failure, total correct, and CLEAR/ESCALATE counts.
For each pair report whether valid decisions changed and classify
`STABLE_CORRECT`, `STABLE_WRONG`, `FIXED`, or `REGRESSION`. Invalid structured
output is a semantic failure and is not repaired or rerun. Any required runtime
failure makes the pilot `INDETERMINATE_RUNTIME`; no representation is chosen
from incomplete execution. No statistical-significance claim is permitted
from N=20.

The completed report is
`fixtures/local-memory-inference-p1b6-anchor-marker-pilot-report.json`, raw
SHA-256 `ce43e493cb037779a52e682498769ec87e2ae614846a769e3eebe4b561da49e1`.
All 40 calls completed, with zero invalid structured outputs and zero runtime
failures. A and B each scored 13/20; both returned CLEAR on all 20 cases. The
pairs were 13 `STABLE_CORRECT`, 7 `STABLE_WRONG`, 0 `FIXED`, and 0
`REGRESSION`, with zero schema-valid decision changes. The preregistered
mechanical disposition was therefore `SINGLE_REQUIRED` because repeated
marking did not meet the required minimum of two fixes.

The representation consequence is **CLOSED — `SINGLE_REPRESENTATIVE`**. No
changed-case HUMAN attribution review was required because no decision
changed. This does not show that single marking was more accurate or repeated
marking harmful. The untrained/pre-training probe's all-CLEAR behavior—every
CLEAR-gold case correct and every ESCALATE-gold case wrong in both variants—is
diagnostic only; this pilot was not a B6 capability benchmark and did not
select or accept a training base.

Other later decisions include remaining generation/review tooling, production
source addressing, similarity method/threshold, training
mechanism and checkpoint rule, acceptance thresholds, and future Bundle
Builder implementation. None is selected by this document.

## Training Preregistration Still Required

Before training, freeze the base checkpoint provenance, SFT/LoRA mechanism,
optimizer and schedule, precision, checkpoint selection/stopping rule,
evaluation metrics, leakage checks, and fresh held-out acceptance rule.
Training execution, raw source episodes, and private replay remain UNOPENED.
