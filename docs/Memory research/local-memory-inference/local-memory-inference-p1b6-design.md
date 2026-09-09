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

The next step is to author source episodes and surface items, then run the
source/bundle audit and HUMAN review. Do not redesign the frozen skeleton
catalog, generate training output, expose a model to FINAL surface items, or
start training in this phase.

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

A source episode may produce zero or more B6 items. Most episodes may produce
one item; multi-item episodes are allowed when they test candidate and anchor
separation. The minimal research representation is:

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
  anchorSpanRefs
  fragmentRefs
  authoring/review metadata as required
```

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

## Fragments

A fragment is a maximal contiguous source range among evidence selected by the
Bundle Builder. Selected `t1, t2, t3, t5, t6` therefore yields `t1..t3` and
`t5..t6`; selected `t1, t3, t5, t6` yields `t1`, `t3`, and `t5..t6`. Fragment
count measures disjoint source regions that must be integrated, not turns, and
contiguous evidence must not be artificially split.

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
(20%), and 38 English (10%). Author roughly 500 candidates to retain the exact
final split sizes. Vary evidence realization, discourse order, progressive
refinement, return to topic, self-revision, temporary side context, language,
and evidence location. Do not treat simple entity, number, domain, or language
substitution as a new semantic skeleton.

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

The audit checks that every selected fragment and anchor is source-grounded,
that omitted evidence cannot change the target judgment, and that a source
episode's split and authored chronology are preserved. Missing persistence or
durability evidence is not ambiguity when the current semantic state is
otherwise uniquely established.

## HUMAN Review and HELD Freeze

Only source/bundle-audit PASS items are reviewable. HUMAN sees only the
model-visible selected evidence with target source spans visibly marked,
including unchanged containing turns; hidden full episodes and generator
metadata are unavailable. HUMAN independently decides KEEP/FIX/REJECT and
CLEAR/ESCALATE. HUMAN is final authority; model suggestions remain advisory.

Any evidence edit restarts the applicable source audit and blind review. No
previous HUMAN label or generator intent is inherited after an evidence edit.
No FINAL surface item is used for training or tuning.

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

## Remaining OPEN Decisions

Repeated explicit mentions of the same candidate/topic in one bundle are
deliberately OPEN. Do not yet choose between one representative anchor and
multiple/all explicit mentions.

Before full surface authoring, run a small paired pilot on identical evidence
bundles comparing representative single anchors with repeated explicit topic
mentions. Measure target identification and CLEAR/ESCALATE changes, and
whether any benefit justifies greater grouping/coreference burden. Do not
expand this into arbitrary pronoun/coreference annotation. The default
hypothesis may be that one representative anchor is sufficient, but that is
not CLOSED.

Other later decisions include exact generation/review tooling, source-locator
encoding, similarity method/threshold, model-visible serialization, training
mechanism and checkpoint rule, acceptance thresholds, and future Bundle
Builder implementation. None is selected by this document.

## Training Preregistration Still Required

Before training, freeze the base checkpoint provenance, SFT/LoRA mechanism,
optimizer and schedule, precision, checkpoint selection/stopping rule,
evaluation metrics, leakage checks, and fresh held-out acceptance rule.
Training execution, raw source episodes, and private replay remain UNOPENED.
