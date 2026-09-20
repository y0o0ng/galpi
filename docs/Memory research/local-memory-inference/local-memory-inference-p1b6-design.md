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
changed again, and full source-audit attempt 004 completed at 32 PASS / 0 FAIL /
0 UNCERTAIN. The current source/bundle gate is PASS. Focused primary HUMAN
re-review attempt 002 completed for the three changed visible bundles at 3 KEEP
/ 0 FIX / 0 REJECT and 2 CLEAR / 1 ESCALATE. The effective current primary
HUMAN set is 32 KEEP / 0 FIX / 0 REJECT and 20 CLEAR / 12 ESCALATE. Frozen
exact56 reconciliation found 30 matches and 2 opposite-label realization
mismatches. The repository owner chose dataset-acceptance rejection rather than
another surface repair cycle, without changing any historical HUMAN judgment or
frozen skeleton label. Smoke batch-001 acceptance is therefore closed at 30
accepted / 2 rejected / 0 unresolved, and its primary HUMAN review and
reconciliation workflow is complete. The 30 accepted candidates are eligible
existing members for adaptive growth of the roughly 400-ish reviewed pool; the
two rejected candidates do not count toward accepted-pool coverage. Adaptive-
growth batch-002 is now authored with 64 new candidates, including at least one
attempt for every frozen skeleton with zero accepted-smoke coverage. Before
audit, repeated non-selected side-context turns were rewritten for source
naturalness without changing any item definition or canonical visible bundle.
Source-audit attempt 001 then completed at 64 PASS / 0 FAIL / 0 UNCERTAIN, so
the batch-002 source/bundle gate is PASS. Primary blind HUMAN review completed
for all 64 presented rows at 60 KEEP / 4 FIX / 0 REJECT and 55 CLEAR / 9
ESCALATE; that attempt remains immutable historical evidence. Its four FIX
anchors received the prescribed minimum `anchorSpanRef`-only repair, with no
source-text or evidence-selection change. Incremental source re-audit attempt
002 is COMPLETE_PASS: 60 rows inherited PASS only after exact `sourceEpisode`
and `selectedBundle` equality with attempt 001, and the four changed rows
received fresh PASS judgments. The repaired current source/bundle gate is PASS.
Focused blind HUMAN re-review attempt 002 then completed for exactly the four
changed surfaces at 4 KEEP / 0 FIX / 0 REJECT and 4 CLEAR / 0 ESCALATE, so the
focused repair review is resolved and no unresolved FIX remains. Overlaying the
four focused decisions on the 60 inherited historical decisions gives a
pre-reconciliation effective HUMAN aggregate of 64 KEEP / 0 FIX / 0 REJECT and
55 CLEAR / 9 ESCALATE. That aggregate was then materialized as the
effective-current decision artifact and reconciled against the frozen exact56
skeleton HUMAN labels, which produced 40 matches and 24 mismatches out of 64.
That artifact's own status is therefore `RECONCILIATION_NEEDS_FIX`, and
`humanReviewCompleted` was false at that point. Both describe the historical
64-row artifact, not the accepted batch-002 successor materialized later. Every mismatch runs in one direction: the
authoritative current HUMAN decision is CLEAR where the frozen skeleton HUMAN
label is ESCALATE. Neither side was relabeled; the mismatched identities live
only in the separate non-HUMAN-facing diagnostic artifact and must never enter
a blind HUMAN review packet. A mismatch does not itself authorize acceptance,
rejection, or surface repair, so resolution of the 24 mismatched realizations
is a repository-owner decision. The repository owner has since approved the
`CONSERVATIVE_PRAGMATIC_INTERPRETATION` rule below, including the refinement
that a competing reading counts only when the visible evidence positively
licenses it, and item-level semantic adjudication of all 24 mismatches is now
COMPLETE at 10 `SKELETON_SEMANTICS_NEEDS_REVISION` / 11
`SURFACE_COLLAPSES_AMBIGUITY` / 3 `HUMAN_DECISION_NEEDS_REREVIEW` / 0
`UNRESOLVED`. That step is routing, not HUMAN relabeling: no HUMAN decision,
frozen skeleton label, or surface changed. The fresh blind HUMAN re-review of
the 3 routed rows (attempt-003) is now **complete at 3 ESCALATE**, so the
effective HUMAN state is 64 KEEP / 52 CLEAR / 12 ESCALATE and reconciliation
moved to 43 match / 21 mismatch. The reconciliation therefore remained
unresolved at that point, and two blockers stood — a targeted Exact56 semantic
amendment decision for the affected frozen skeletons, and a
repair-versus-rejection decision for the surface-collapse realizations. The
**targeted skeleton semantic amendment is now complete**:
`p1b6-sk-8dd28ec6b22a18ad` and
`p1b6-sk-155420007d75f36f` are amended to effective `CLEAR`,
`p1b6-sk-2fa39ece4157b2b8` was deliberately **not** amended and stays
`ESCALATE`, and items `059`/`063` are reclassified as surface-collapse
realizations. Against the effective-current catalog batch-002 reconciles at
**51 match / 13 mismatch**, and all 13 remaining mismatches are
surface-realization cases. **Phase A is CLOSED.** The **Phase B semantic
adjudication of those 13 was completed** at 12 REPAIR / 1 REJECT, and 12
repaired candidate surfaces were materialized; `p1b6-item-b002-050` is
rejected at its current surface realization. At that point a fresh source audit
and a fresh blind HUMAN review of the repaired text both remained pending, no
repaired row was accepted, batch-002 corpus acceptance had not occurred, and the
accepted pool stood at 30. **All of that has since been completed** — see
"Fresh Source Audit Result and Blind HUMAN Review Packet", "Fresh Blind HUMAN
Review Result" and "Batch-002 Finalization and Acceptance" below.

**Authoritative current state.** Phase A semantic amendment CLOSED; Phase B
repair resolution CLOSED; the fresh repair source audit COMPLETE_PASS at 12/12;
the fresh repair HUMAN review COMPLETE at 12 KEEP / 12 ESCALATE. The
effective-current successor holds **63 rows — 51 inherited + 12 repaired, with
item `050` absent**; the effective HUMAN successor is **63 KEEP / 39 CLEAR /
24 ESCALATE**; reconciliation against the effective-current skeleton catalog is
**63 match / 0 mismatch**; batch-002 acceptance is **63 accepted / 1 rejected /
0 unresolved**; and the cumulative accepted surface pool is **93**. Item `050`
has no replacement and its skeleton is unchanged. The repaired HUMAN review is
**not reviewer-independent**, and a separate provenance correction fixes the
inaccurate literal-authorship claim without changing the historical HUMAN
receipt or any decision. **Final corpus HUMAN-gold freeze, repeated HELD review,
FINAL_HELD_OUT release, deterministic FINAL selection, and training all remain
UNOPENED, and the full 380-item P1-B6 corpus is NOT complete.** The contracts
are in "Batch-002 Finalization and Acceptance" below.

Do not redesign the frozen skeleton catalog, generate training output, expose a
model to FINAL surface items, or start training in this phase.

## Conservative Pragmatic Interpretation

This rule was opened because batch-002 reconciliation produced 24 mismatches
out of 64 and every one of them runs in a single direction — current HUMAN
`CLEAR` against a frozen skeleton `ESCALATE`. The strongly one-directional
24/64 disagreement is strong evidence of a possible ambiguity-boundary
definition problem and justified reopening that boundary for targeted
clarification. Individual cases may still prove to be surface realization
defects or HUMAN-review errors; the direction of the disagreement does not
prove that all 24 mismatches are contract defects.

`CLEAR`: visible evidence, interpreted as ordinary cooperative conversation,
supports one materially relevant semantic status as the natural dominant
reading. A competing materially different status would require introducing an
unstated event, fact, intention, exception, preference, or other additional
premise not supplied by the visible evidence.

`ESCALATE`: two or more materially different semantic statuses remain naturally
licensed by the visible evidence itself, such that choosing one requires
additional information.

Allowed inference: ordinary lexical and grammatical meaning; discourse
coherence and normal conversational implicature; tense, temporal ordering,
bounded interval and condition relations; limited generic world/causal
knowledge required for ordinary language understanding.

Not allowed: hidden user intentions or preferences; personality inference;
typicality alone ("people usually…"); inventing an event that was not
evidenced; assuming a condition became true when that is not stated or
pragmatically established; resolving a genuinely live referential or semantic
alternative by guessing what was probably meant; treating mere
logical compatibility as a live competing reading.

The operational counter-reading test is one question: can a materially
different competing reading be sustained using only the visible evidence, or
does it require adding a new unstated premise? A visible-evidence-only
competing reading is `ESCALATE`; a competing reading that requires a new
unstated premise is `CLEAR`.

**Refinement — a competing reading counts only when the visible evidence
positively licenses it.** Mere logical compatibility does not preserve
ambiguity. If maintaining a counter-reading requires constructing an unstated
category rule, event, identity continuity, possibility, or other premise, that
counter-reading does not by itself force `ESCALATE`. Treating bare logical
compatibility as a live competing reading is not allowed inference.

Pragmatic inference may establish semantic status without establishing a
separate real-world event. `매주 일요일마다 달렸다. 시험 기간에는 멈췄다. 시험은
지난주에 끝났다.` may support `CLEAR` for the status of the recurring routine
under this rule, without asserting that a post-exam run has already physically
occurred.

This clarification reopens only the ambiguity-interpretation boundary needed to
resolve the batch-002 evidence. It does not reopen B6 ownership boundaries,
durability, extraction, identity/correction/Core/governance, source-bundle
rules, the renderer, the anchor contract, the split contract, corpus-size
targets, or production behavior.

The clarification is prospective and applies to targeted re-adjudication only.
Existing HUMAN decisions and frozen skeleton labels remain historical immutable
evidence until an explicit resolution is recorded. No mismatch is silently
relabeled, and Exact56 labels are unchanged.

## Targeted Pragmatic Adjudication Packet

`fixtures/local-memory-inference-p1b6-pragmatic-adjudication-batch-002.json`
holds exactly the 24 mismatched current items, grouped by their 10 unique
`semanticSkeletonId` values. It is a diagnostic adjudication packet, **not** a
HUMAN blind-review packet: it is derived mechanically by
`buildBatch002PragmaticAdjudicationPacket` from the current batch, Exact56, the
mismatch diagnostic, and the canonical renderer.

Each skeleton group carries `semanticSkeletonId`, `splitAssignment`,
`boundaryClass`, `candidateFocus`, `semanticRelations`, and its associated
mismatch items; each item carries only `itemId` and the rendered
`selectedBundle` exactly as the HUMAN reviewer saw it. The packet deliberately
omits the current HUMAN decision, the frozen skeleton `humanLabel`, any
generator intended label, any model-generated adjudication, and any
acceptance/rejection recommendation, so that semantic comparison is possible
without priming the adjudicator with the existing disagreement direction.

The builder fails closed when the mismatch count is not exactly 24, the unique
mismatch skeleton count is not exactly 10, a mismatch item is absent from the
current batch, a skeleton is absent or duplicated, renderer output differs from
the canonical HUMAN surface, or a non-mismatch item enters the packet. One
mismatch item (`p1b6-item-b002-050`) is also one of the four repaired anchors,
so the canonical surface for that item comes from the focused re-review packet
rather than the original HUMAN packet.

Adjudication outcomes are documented here but **not assigned**, in code or by
heuristic; they require semantic adjudication:

- `SKELETON_SEMANTICS_NEEDS_REVISION` — the surface faithfully realizes the
  skeleton relations, and under Conservative Pragmatic Interpretation the
  skeleton semantic status itself should be reconsidered.
- `SURFACE_COLLAPSES_AMBIGUITY` — the frozen skeleton can remain `ESCALATE`;
  the authored surface added pragmatic cues that eliminate the intended
  ambiguity.
- `HUMAN_DECISION_NEEDS_REREVIEW` — the current surface still contains a
  genuinely live competing interpretation under the clarified rule, so the
  existing HUMAN `CLEAR` decision requires a new blind re-review rather than
  silent relabeling.
- `UNRESOLVED` — evidence is insufficient to classify confidently; fail closed.

## Item-Level Semantic Adjudication Receipt

`fixtures/local-memory-inference-p1b6-pragmatic-adjudication-batch-002-receipt.json`
records the repository owner's item-level routing of all 24 mismatches under
Conservative Pragmatic Interpretation:

| outcome | count |
| --- | --- |
| `SKELETON_SEMANTICS_NEEDS_REVISION` | 10 |
| `SURFACE_COLLAPSES_AMBIGUITY` | 11 |
| `HUMAN_DECISION_NEEDS_REREVIEW` | 3 |
| `UNRESOLVED` | 0 |

Each row carries only `itemId` and `outcome`. **Semantic adjudication is
routing, not HUMAN relabeling**: the receipt assigns no replacement
`CLEAR`/`ESCALATE` gold, amends no frozen skeleton, and repairs no surface. It
binds to the current batch, Exact56, the effective-current artifact, the
canonical mismatch diagnostic, the pragmatic adjudication packet, and the
interpretation rule identity.

The 10 `SKELETON_SEMANTICS_NEEDS_REVISION` items span only three unique frozen
skeletons. That routing has since been resolved by the targeted semantic
amendment below, which amended two of the three and reclassified the third
skeleton's two items as surface-collapse realizations. This receipt is
historical evidence of the decision state when it was written; its
`10 / 11 / 3 / 0` routing is **not** rewritten. The
`SURFACE_COLLAPSES_AMBIGUITY` realizations remain untouched:
repair-versus-dataset-rejection is a separate repository-owner resolution.

Historical note: before attempt-003 the repository owner's non-blind read of the
three `HUMAN_DECISION_NEEDS_REREVIEW` rows was `ESCALATE`. Those provisional
judgments were correctly **not** treated as HUMAN gold, because the owner
already knew the rows came from the reconciliation mismatch; they justified one
thing only — routing the rows to a fresh blind HUMAN review. Attempt-003 has
since completed that review, and its receipt is the authoritative HUMAN decision
source.

`validateBatch002PragmaticAdjudicationReceipt` fails closed unless the receipt
binds to every canonical artifact, holds exactly one sorted row per canonical
mismatch item, matches the 10/11/3/0 summary, and claims no authority it does
not have. Item-level outcomes live in the committed receipt, never in script
source.

## Canonical Mismatch Binding

`buildBatch002PragmaticAdjudicationPacket` and the receipt validator consume
the canonical mismatch diagnostic's **raw bytes**, not a diagnostic recomputed
from a supplied effective object. `validateBatch002MismatchDiagnostic` fails
closed unless the bytes hash to
`9a02ecfec486a6b5f5d1f586b2a2482dafc94a8b2f642e71e23f3653020129f5`, carry the
expected identity, bind to the current batch / effective artifact / Exact56,
hold exactly 24 unique mismatch `itemId`s across exactly the canonical 10
skeleton IDs, and agree mechanically with the diagnostic recomputed from the
current effective rows and Exact56.

The canonical diagnostic is source-of-truth for **which** reconciliation
mismatches are adjudicated. A caller cannot mutate effective rows to substitute
a different 24-item mismatch set while preserving the counts: flipping one
clean row into a mismatch and one mismatch row back into a match keeps the
count at 24 but breaks the mechanical agreement, so the build fails.

## Fresh Blind HUMAN Re-Review — attempt 003

`buildBatch002RereviewAttempt003Packet` builds the blind packet for exactly the
`HUMAN_DECISION_NEEDS_REREVIEW` rows. **Selection is derived from the canonical
semantic adjudication receipt**, not from a hard-coded item list, and the
builder fails closed unless exactly three rows are selected and the receipt
binds to the current batch, Exact56, and the mismatch diagnostic.

**The receipt itself is raw-byte bound before it may drive that selection.**
Both consumers — `validateBatch002PragmaticAdjudicationReceipt` and
`buildBatch002RereviewAttempt003Packet` — refuse any receipt whose bytes do not
hash to
`cf05f5073fc30f19078aab1a0c081b59face607a041387bf5421ffa2af8bbdaa`. The
canonical item set and the 10/11/3/0 aggregate are not sufficient on their own:
swapping one `HUMAN_DECISION_NEEDS_REREVIEW` row with one
`SURFACE_COLLAPSES_AMBIGUITY` row preserves every item ID, every count, and all
artifact metadata while silently changing which rows face the blind reviewer.
Only the raw-byte binding closes that path.

HUMAN-facing rows expose only `reviewRowId` and `selectedBundle`, where
`selectedBundle` is exactly the canonical renderer output. The packet carries
no `itemId`, `semanticSkeletonId`, split, boundary class, previous HUMAN
decision, frozen skeleton `humanLabel`, mismatch direction, adjudication
outcome, model recommendation, or expected answer; no `p1b6-item-` or
`p1b6-sk-` identifier appears anywhere in it.

Following repository convention, HUMAN review packets are generated rather than
committed — only their decision receipts are committed. The attempt-003 packet
is deterministic at raw SHA-256
`165d8d02ca6f5d36a22f4a8baa4d5ee7d19b059b6e2a944cbc5e1a19554973c2`.

**The blind review is complete.** All three rows were decided `ESCALATE`, at
`fixtures/local-memory-inference-p1b6-primary-human-rereview-batch-002-attempt-003.json`
(3 KEEP / 0 FIX / 0 REJECT, 0 CLEAR / 3 ESCALATE). The receipt follows the
attempt-002 schema and `validateBatch002Attempt003Receipt` fails closed on a
wrong attempt ID, batch or blind-packet binding, a missing, extra, duplicate or
unknown opaque row, a decision outside the HUMAN vocabulary, or any row the
canonical blind packet did not present.

Attempt-003 is an **additional HUMAN provenance layer**, not a rewrite:
attempt-001 and attempt-002 receipts and their packets stay byte-identical, and
the semantic adjudication receipt remains a routing artifact that does not
encode these decisions.
`buildBatch002EffectiveHumanDecisionSetWithAttempt003` layers it onto the
existing overlay, mapping each opaque review ID back to its batch item
mechanically and refusing to move any decision outside the reviewed population.

Because the frozen mismatch diagnostic and the whole semantic adjudication
chain bind to the pre-attempt-003 effective artifact
(`d0e5dc…`, 40 match / 24 mismatch), that artifact stays byte-identical and the
post-attempt-003 state is a successor artifact,
`fixtures/local-memory-inference-p1b6-primary-human-effective-current-batch-002-v2.json`,
which names what it supersedes. Its effective distribution is **64 KEEP / 52
CLEAR / 12 ESCALATE** and it reconciles at **43 match / 21 mismatch**.

`humanReviewCompleted` stayed **false** at this point: it tracks zero remaining
reconciliation mismatches for the whole batch, not completion of one re-review
attempt, and 21 mismatches remained. The fresh-HUMAN-re-review portion of the
semantic adjudication was resolved; the remaining semantic follow-ups were the
separate Exact56 amendment (since completed, see "Targeted Skeleton Semantic
Amendment") and the repair-or-rejection decision for the surface-collapse
realizations (since completed, see "Phase B Surface Repair Materialization"). No
acceptance, gold freeze, HELD review, training, or downstream gate was opened at
this point, and the accepted pool stood at 30. Batch-002 has since been accepted;
see "Batch-002 Finalization and Acceptance".

## Targeted Skeleton Semantic Amendment

Five layers are distinct and must not be collapsed:

1. **Historical Exact56 freeze** — `fixtures/local-memory-inference-p1b6-skeleton-exact56.json`,
   raw SHA-256 `772f07bd…`, `CLOSED / FROZEN`, 32 CLEAR / 24 ESCALATE. Immutable,
   and still the provenance base. It is not erroneous and is not overwritten.
2. **Targeted semantic amendment** —
   `fixtures/local-memory-inference-p1b6-skeleton-semantic-amendment-receipt.json`,
   the committed authority for which amendments were approved and for their
   replacement semantics.
3. **Effective-current skeleton catalog** —
   `fixtures/local-memory-inference-p1b6-skeleton-effective-current.json`,
   built mechanically as historical Exact56 + exactly the two approved
   amendments. This is the **prospective current semantic authority**; future
   authoring reads it rather than the frozen historical labels.
4. **Historical HUMAN evidence** — attempt-001/002/003 receipts and both
   effective HUMAN artifacts, all unchanged. No HUMAN decision was relabeled.
5. **Current reconciliation impact** — recomputed, never written back onto a
   HUMAN artifact.

`p1b6-sk-8dd28ec6b22a18ad` (TRAIN, PERSISTENCE / EXCEPTION) becomes `CLEAR`. Its
`CLEAR` does **not** assert a new physical occurrence after the bounded
interruption; it says the recurring status is sufficiently resolved once a
recurring default, a bounded interruption, and the end of the interrupting
condition are established and the visible evidence does not positively license
continuation, cancellation, or replacement.

`p1b6-sk-155420007d75f36f` (FINAL_HELD_OUT, FINALITY / COMMITMENT) becomes
`CLEAR`. The classifier resolves the plan's visible semantic status; it is not
required to establish that the condition fired. An explicitly maintained
conditional plan can be `CLEAR` while remaining conditional and unexecuted.

`p1b6-sk-2fa39ece4157b2b8` (FINAL_HELD_OUT, SCOPE / APPLICABILITY) is
**explicitly preserved at `ESCALATE`**. A rule is stated over items inside a
container, an item later moves in, and the evidence does not settle whether the
rule extends to it. That ambiguity is intended. `p1b6-item-b002-061` is a
faithful realization — its wording limits the rule to the folder's `기존 파일`
— and the fresh blind HUMAN decision there is `ESCALATE`.

Items `059` and `063` instead collapsed that intended ambiguity into a generic
membership-triggered container rule, so they are **surface-realization defects,
not skeleton defects**. The amendment receipt records the routing correction
`SKELETON_SEMANTICS_NEEDS_REVISION` → `SURFACE_COLLAPSES_AMBIGUITY` for exactly
those two items without mutating the historical routing receipt. Their source
text is **not** repaired here; the selected minimum repair direction scopes the
original rule to the current item set with `지금`, and executing it will require
a fresh source audit and a fresh blind HUMAN review.

The effective-current catalog holds 56 candidates with identical IDs, order,
splits, boundary classes and contrast groups; exactly two rows differ
semantically; the label distribution is **34 CLEAR / 22 ESCALATE**; split
coverage stays TRAIN 24 / DEV 16 / FINAL_HELD_OUT 16 with unchanged per-boundary
split counts.

Reconciliation impact, recomputed from unchanged HUMAN decisions:

| | historical Exact56 | effective-current |
| --- | --- | --- |
| batch-002 | 43 match / 21 mismatch | **51 match / 13 mismatch** |
| batch-001 | 30 match / 2 mismatch | 31 match / 1 mismatch |

The batch-002 HUMAN aggregate is unchanged at 64 KEEP / 52 CLEAR / 12 ESCALATE.
All 13 remaining batch-002 mismatches are current surface-collapse
realizations: `022`, `024`, `029`, `032`, `034`, `037`, `039`, `047`, `049`,
`050`, `051`, `059`, `063`. Zero `SKELETON_SEMANTICS_NEEDS_REVISION`, zero
`HUMAN_DECISION_NEEDS_REREVIEW`, and zero `UNRESOLVED` items remain.

Batch-001's single remaining mismatch is `p1b6-item-b001-019`;
`p1b6-item-b001-009` now agrees with the amended `8dd28…`. The closed smoke
acceptance is **not** reopened — it stays at 30 accepted / 2 rejected /
0 unresolved with `b001-009` historically rejected, so batch-001's contribution
to the accepted pool stays exactly 30.

`humanReviewCompleted` remains **false**, and no dataset acceptance, HUMAN gold
freeze, HELD repeated review, training, raw-episode evaluation, private replay,
or production change was performed. Final corpus contracts (380 items, TRAIN 240
/ DEV 60 / FINAL_HELD_OUT 80, gold target 190 CLEAR / 190 ESCALATE, coverage,
language, fragment and HELD contracts) are unchanged. Historical authoring
allocation metadata stays historical.

`scripts/build-memory-inference-p1b6-skeleton-semantic-amendment.js` validates
the receipt, applies exactly the two authorized changes, rebuilds the catalog
and recomputes impact, failing closed on a third amendment, an amendment of the
preserved skeleton, a wrong base or target label, split/boundary drift, a
missing routing correction, or any authority the receipt may not claim. The
historical Exact56 builder is untouched.

## Phase B Surface Repair Materialization

Phase A closed the skeleton-semantics blocker and left one: repair versus
rejection for the 13 current batch-002 surface realizations that still mismatch
the effective-current catalog. That decision is now recorded in
`fixtures/local-memory-inference-p1b6-surface-repair-resolution-batch-002-receipt.json`
at **12 REPAIR / 1 REJECT**, and the repaired rows are materialized in
`fixtures/local-memory-inference-p1b6-surface-repair-candidate-batch-002.json`.
Per-item repaired text, rationale and intended unresolved readings live in the
resolution receipt as auditable data; they are not restated here.

**REPAIR**: `022`, `024`, `029`, `032`, `034`, `037`, `039`, `047`, `049`,
`051`, `059`, `063`. **REJECT**: `050`, scoped
`CURRENT_SURFACE_REALIZATION_ONLY` — minimal repair attempts either collapse
into ordinary context-conditioned measurements or introduce a
referent/instance-identity ambiguity that is not the intended
complementary-evidence boundary. The skeleton `p1b6-sk-aebbf047d6864a35` is
**not** amended and no replacement surface is authored; if that coverage slot is
needed later, it is a separate new-authoring task followed by fresh review.

The candidate artifact is **not** an effective-current successor. It holds
exactly the 12 authorized repaired rows and nothing else: no 63-row or 64-row
batch, none of the 51 unaffected rows, and no placeholder for the rejected item.
Its status is
`REPAIR_CANDIDATE_AWAITING_FRESH_SOURCE_AUDIT_AND_FRESH_BLIND_HUMAN_REVIEW`.
Item IDs, semantic-skeleton IDs, source-episode IDs and family IDs are carried
from the historical rows so provenance stays explicit, and every
`anchorSpanRef` / `evidenceSpanRefs` offset is recomputed from the repaired
source text — no historical offset is reused. Unrelated interruption turns are
preserved except where the approved repair required restructuring the semantic
turn (`032`, `037`), and where the discourse pattern changed with the structure
the historical pattern is retained alongside it.

**Old HUMAN labels do not transfer.** The batch-002 effective HUMAN artifact and
the attempt-003 receipt are evidence for the OLD surface text only. No HUMAN
decision was relabeled, reused, or synthesized here, no repaired row was
accepted at this step, no HUMAN gold was frozen, no HELD_OUT release occurred,
and no training occurred.

**Historical snapshot of this step.** When the repair candidates were
materialized, the accepted pool stood at 30, `humanReviewCompleted` was false,
and a fresh source audit plus a fresh blind HUMAN review of the repaired text
were the next steps and both still pending. **Both have since completed and
batch-002 has since been accepted** — see "Fresh Source Audit Result and Blind
HUMAN Review Packet", "Fresh Blind HUMAN Review Result" and "Batch-002
Finalization and Acceptance".

`scripts/build-memory-inference-p1b6-surface-repair-candidate.js` verifies every
canonical historical input by identity AND pinned raw SHA before deriving
anything, then derives the open mismatch set mechanically by reconciling
batch-002 against the effective-current catalog with the unchanged HUMAN
decisions. It fails closed on identity drift, raw-byte drift, coordinated
source-plus-receipt drift, a missing or duplicate decision, a fourteenth
decision, an omitted decision, a repaired row remapped to a different semantic
skeleton, the rejected row or any unauthorized row appearing in the candidate,
stale or invalid byte offsets, and any authority the receipt may not claim.
Phase B validation is a narrow validator in that builder:
`lib/memory-inference-p1b6-surfaces.js` stays pointed at the frozen historical
Exact56 and the historical batch shape, so historical and prospective validation
remain separate.

## Fresh Source Audit of the Repaired Candidates

`scripts/build-memory-inference-p1b6-surface-repair-source-audit-packet.js`
deterministically constructs the blind source/bundle completeness audit packet
for exactly the 12 repaired candidates. **Constructing the packet is not the
audit.** No disposition is assigned, no HUMAN label is created or transferred,
no row is accepted, no gold is frozen, no HELD_OUT release occurred, and nothing
was trained. The auditor runs later in a separate fresh strong-model session.

The protocol at `fixtures/local-memory-inference-p1b6-source-audit-protocol.json`
is **unamended and authoritative**: the same question, the same `PASS` / `FAIL` /
`UNCERTAIN` dispositions, and the same gate where only `PASS` proceeds to blind
HUMAN semantic review while `FAIL` and `UNCERTAIN` fail closed. The source
auditor does not assign `CLEAR` or `ESCALATE`. The builder verifies that gate
rather than rewriting it.

**All 12 rows require fresh judgments.** The repaired source text is new
evidence, so no historical batch-002 source-audit `PASS` carries forward. The
opaque row IDs therefore live in their own `p1b6-repair-audit-` namespace,
derived from the protocol identity, the canonical repair-candidate raw SHA and
the internal item ID, so they are disjoint from the historical `p1b6-audit-`
IDs and any candidate byte change moves the whole namespace. The item ID is a
hash input only and never appears in a blind row.

Each row exposes exactly three fields: the opaque `auditRowId`, the complete
repaired source episode turns, and the exact selected model-visible bundle with
its single source-grounded `[TARGET]…[/TARGET]` marker. No item ID, episode or
family ID, `semanticSkeletonId`, boundary class, split, discourse pattern,
language quota, HUMAN or skeleton label, repair rationale, intended unresolved
reading, adjudication routing, or acceptance recommendation appears anywhere in
the packet, and the rejected `050` realization is absent entirely.

The builder pins the repair candidate, the Phase B resolution receipt, the
effective-current catalog and the audit protocol by identity AND raw SHA, then
re-runs `validateRepairCandidateBatch` before rendering, so identity drift,
raw-byte drift, coordinated drift, a drifted row set and stale span offsets all
fail closed. Rendering reuses the shared span primitives and reproduces the
canonical renderer's visible-bundle semantics exactly; the historical
`validateSurfaceBatch` contract in `lib/memory-inference-p1b6-surfaces.js` is
untouched and still refuses the repair candidate's shape.

Following repository convention the packet is **generated, not committed** —
only decision receipts are committed. Report the generated packet's raw SHA-256
so the later audit receipt binds to exactly the reviewed bytes.

**The fresh source audit is now COMPLETE at 12/12 `PASS`**; see the next section.

## Fresh Source Audit Result and Blind HUMAN Review Packet

The fresh audit ran in a separate session and returned **12 PASS / 0 FAIL /
0 UNCERTAIN**, committed at
`fixtures/local-memory-inference-p1b6-surface-repair-source-audit-batch-002-attempt-001.json`
(attempt `p1b6-surface-repair-source-audit-batch-002-attempt-001`). The receipt
binds by identity and raw SHA to the blind audit packet
(`9586be2f…`), the repair candidate (`d59d0dec…`), the unamended protocol
(`63a2c70c…`), and the external raw result artifact by filename and SHA. Raw
model output stays outside the repository by convention; the committed receipt
retains its exact filename and SHA so the reviewed bytes remain identifiable.

**Execution provenance is recorded conservatively.** The result artifact is a
user-supplied file from a fresh/separate ChatGPT source-audit session. Exact
model and reasoning-setting metadata are not independently recoverable from it,
so the receipt records that explicitly rather than guessing. Every row received
a fresh judgment and no historical batch-002 audit result was inherited.

The receipt's authority records only that the source/bundle gate passed for
these 12 repaired candidates. **HUMAN semantic review did not occur, no HUMAN
gold was assigned or frozen, no dataset acceptance happened, no HELD_OUT release
occurred, and nothing was trained.**

`scripts/build-memory-inference-p1b6-surface-repair-human-review-packet.js` then
builds the fresh blind primary HUMAN review packet for exactly those 12
audit-PASS candidates. It rebuilds the canonical audit packet mechanically and
refuses to proceed unless the receipt binds to it, covers exactly its 12 opaque
audit IDs, is all `PASS` with non-empty reasons, inherits no historical result,
and claims no authority it does not have. A single `FAIL` or `UNCERTAIN` closes
the gate.

Each HUMAN-facing row exposes **exactly two fields**: an opaque `reviewRowId`
and the canonical `selectedBundle`. The reviewer sees the selected visible
bundle, not the full source episode. No item, episode, family or skeleton ID,
split, boundary class, discourse pattern, old or effective HUMAN label,
source-audit reason, repair rationale, intended unresolved reading, mismatch
direction, adjudication routing, REPAIR/REJECT metadata, expected answer, or the
rejected `050` realization appears anywhere. **Source-audit reasons are
construction diagnostics and are deliberately withheld so they cannot prime the
semantic reviewer.** Rows are sorted deterministically by opaque review ID,
matching the primary-HUMAN convention.

Review IDs live in their own `p1b6-repair-review-` namespace derived from the
packet identity, the canonical repair-candidate raw SHA and the internal item
ID, so no historical `p1b6-review-` identity is reused for the changed source
text and any candidate byte change moves the namespace. The item ID is a hash
input only. Each row's `selectedBundle` is taken from the audited packet itself,
so it is byte-for-byte what was source-audited.

**This step makes no HUMAN decision.** The subsequent blind review uses the
established schema — disposition `KEEP` / `FIX` / `REJECT` and semantic decision
`CLEAR` / `ESCALATE`, with `FIX` optionally carrying a short construction reason.
No expected semantic label is embedded in code and no authoritative decision map
exists before the review happens. The packet is generated, not committed: the
builder writes only to a caller-specified path, refuses overwrite, and reports
the raw SHA-256 so the later HUMAN receipt binds to exactly the reviewed bytes.

**The fresh blind HUMAN review is now COMPLETE**; see the next section.

## Fresh Blind HUMAN Review Result — and What It Does Not Establish

The repository owner's blind review of the 12 repaired candidates is committed at
`fixtures/local-memory-inference-p1b6-surface-repair-primary-human-review-batch-002-attempt-001.json`
(attempt `p1b6-surface-repair-primary-human-review-batch-002-attempt-001`),
binding by identity and raw SHA to the exact reviewed packet `a6059bb7…`, the
repair candidate `d59d0dec…`, and the `COMPLETE_PASS` source-audit prerequisite.
The result is **12 KEEP / 0 FIX / 0 REJECT and 0 CLEAR / 12 ESCALATE**.

**Recomputed observation only**: against the effective-current catalog those 12
decisions reconcile at **12 match / 0 mismatch**. This is reported, never written
back onto a HUMAN artifact, and it is not acceptance. The 12 repaired rows and
the 51 unaffected historical rows are still separate artifacts; combining them
into an effective-current successor batch is a distinct step that has **not**
been performed.

**The independence limitation is recorded, not hidden.** The packet was blind at
row level — opaque IDs, no labels, no rationale, no source-audit reasons — but
the reviewer knew the entire presented population consisted of repairs intended
to restore ambiguity. A uniform ESCALATE outcome is the expected direction, so
**this attempt does not establish reviewer-independent confirmation that the
repairs restored the intended ambiguity.** The receipt carries that statement in
a `reviewIndependence` block and the validator refuses any receipt that erases it
or claims independence it does not have. The repository owner has accepted this
limitation and treats the blind HUMAN review gate as passed; the limitation
stands on the record so a later reader does not over-read the result.

**Provenance correction.** The receipt's `reviewIndependence.reviewerAuthoredTheRepairs: true`
is not an accurate record of the workflow: the repository owner performed the
final HUMAN judgments and knew every presented row was a repair, but did **not**
personally author all 12 repaired surface texts. The already-pushed receipt is
not rewritten; the narrow correction is committed separately at
`fixtures/local-memory-inference-p1b6-surface-repair-human-review-provenance-correction.json`,
which names the receipt by identity and raw SHA, states that the flag must not be
read as literal surface-text authorship, and preserves the limitation unchanged.
All 12 decisions stand. **Correcting the authorship claim narrows what is
asserted about the reviewer's role; it does not create independence.**

`validateHumanReviewReceipt` checks shape, never answers. It binds the receipt to
the rebuilt packet, requires exactly the 12 presented rows in packet order with
no invented, duplicated, reordered, or historical row ID, restricts dispositions
to `KEEP`/`FIX`/`REJECT` and decisions to `CLEAR`/`ESCALATE`, allows a short
reason only on a `FIX` row, derives the status from the dispositions, and refuses
any downstream authority. **No CLEAR/ESCALATE distribution is privileged**: the
opposite answer validates just as well, and no review row identity appears
anywhere in the builder source, so no answer can be attached to a specific
reviewed surface.

**The batch-002 repair/reconciliation cycle is now CLOSED**; see the next section.

## Batch-002 Finalization and Acceptance

`scripts/build-memory-inference-p1b6-batch-002-finalization.js` materializes the
three artifacts that close the cycle, deterministically and from raw bytes:

| artifact | identity | raw SHA-256 |
| --- | --- | --- |
| surface successor | `…-surface-effective-current-batch-002-v1` | `9701db8902ae99dc5c08cffb176bf9247443884910e3002b77548ac5436157d1` |
| effective HUMAN successor | `…-primary-human-accepted-current-batch-002-v1` | `32b2221e2cefdb9a1a7e47efa1f5accd3d2a915c3f418578dc8f1c314b5281c4` |
| batch-002 acceptance | `…-batch-002-acceptance-v1` | `c03b8dcf4ddcb2c5f8b193cde8247b9ad64b8ea676da51cab1d709795b273598` |

The surface successor holds exactly **63 rows: 51 inherited + 12 repaired**, with
no row for the rejected `050`. Inherited rows are carried byte-identically from
the historical 64-row batch, repaired rows byte-identically from the repair
candidate including their recomputed offsets, and **the historical batch is not
modified**. The opaque fresh HUMAN review IDs are mapped back to item IDs
mechanically through the packet builder; **no historical HUMAN decision travels
onto repaired source text**, which the builder enforces structurally by requiring
each row's `humanDecisionSource` to be the correct artifact.

The effective HUMAN successor is **63 KEEP / 0 FIX / 0 REJECT and 39 CLEAR /
24 ESCALATE**, derived rather than copied. Reconciliation is against the
**effective-current skeleton catalog, not historical Exact56**, at **63 match /
0 mismatch**; Exact56 stays immutable provenance. Acceptance is **64 reviewed /
63 accepted / 1 rejected / 0 unresolved**, and the single rejected row keeps its
existing Phase B current-surface-realization reason with no amended skeleton and
no authored replacement.

With smoke batch-001's closed 30, the cumulative accepted surface pool is **93**.
That is corpus-growth state, not final corpus completion.

**Current state: Phase A semantic amendment CLOSED; Phase B surface resolution
CLOSED; repaired candidate materialization CLOSED; fresh source audit
COMPLETE_PASS; fresh HUMAN review COMPLETE with its independence limitation and
authorship correction on the record; repaired-row reconciliation COMPLETE;
batch-002 acceptance CLOSED at 63 accepted / 1 rejected / 0 unresolved;
cumulative accepted pool 93. Item `050` has no replacement. Final corpus HUMAN
gold, repeated HELD review, FINAL_HELD_OUT release, deterministic FINAL
selection, and training all remain UNOPENED. The 380-item P1-B6 corpus is NOT
complete; construction continues later from the accepted pool of 93.**

## Batch-003 Adaptive Corpus Growth

Batch-002 remains **CLOSED** at 63 accepted / 1 rejected / 0 unresolved. The
accepted surface pool is **93**, reconstructed mechanically from the batch-001
smoke acceptance and the batch-002 acceptance rather than carried as a constant:
TRAIN 56 / DEV 16 / FINAL_HELD_OUT 21, HUMAN 57 CLEAR / 36 ESCALATE, KO 65 /
MIXED 18 / EN 10, fragments 18 / 26 / 27 / 17 / 5, and **55 of 56 skeletons
covered**. Exactly one skeleton has no accepted surface:
`p1b6-sk-aebbf047d6864a35` (DEV, ESCALATE, COMPLEMENTARY EVIDENCE).

`scripts/build-memory-inference-p1b6-batch-003-authoring-plan.js` derives the
tranche from that seed against the frozen 380 constraints and **fails closed if
canonical main stops reproducing the baseline**, rather than silently
redesigning the tranche. The no-loss shortage is **287**; batch-003 authors
**304** candidates, leaving a **17-candidate buffer**. With the 96 attempts
already authored across batch-001 and batch-002 this reaches the existing
"roughly 400-ish reviewed pool, then measure shortages and top up" contract.
**304 is an authoring-tranche size, not a corpus-size contract: the exact final
corpus remains 380, and the 17 buffer candidates are review/rejection headroom,
not automatic final members.**

Derived tranche marginals — split **195 / 47 / 62**, authoring semantic label
**141 CLEAR / 163 ESCALATE**, language **KO 213 / MIXED 61 / EN 30**, fragments
**55 / 78 / 99 / 56 / 16**, and all eight discourse patterns **38 each**. The
HELD contract takes precedence over an independent label split: each held
skeleton's `max(0, 5 - currentAccepted)` shortage is mandatory first, totalling
**59** (45 CLEAR / 14 ESCALATE), and the three remaining HELD candidates are
buffer allocated **+2 CLEAR / +1 ESCALATE**, giving HELD **47 CLEAR / 15
ESCALATE**. After reserving those, TRAIN is **76 CLEAR / 119 ESCALATE** and DEV
is **18 CLEAR / 29 ESCALATE**.

**The authoring semantic authority is the effective-current skeleton catalog**,
not historical Exact56: `p1b6-sk-8dd28ec6b22a18ad` and
`p1b6-sk-155420007d75f36f` are authoring-target `CLEAR`, and
`p1b6-sk-2fa39ece4157b2b8` stays `ESCALATE`. These per-item labels are
**generator targets, not HUMAN gold**, and must never enter a blind HUMAN
packet. `lib/memory-inference-p1b6-surfaces.js` is unchanged and still points at
Exact56 for historical callers; batch-003 supplies the effective-current catalog
at its own boundary.

The zero-covered skeleton receives entirely new DEV/ESCALATE realizations with
new source text and new IDs. **This is not a repair or replacement of historical
item `p1b6-item-b002-050`**, which stays rejected with no replacement.

The committed authoring plan is
`fixtures/local-memory-inference-p1b6-surface-batch-003-authoring-protocol.json`.
It binds the seed inputs and the semantic authority by identity and raw SHA,
records the full derivation including per-skeleton `needTo5` and planned counts,
marks unavailable generator sampling controls as unavailable rather than
inventing them, and states that **no gate has run**. It is written once and is
not rewritten later to pretend downstream gates completed; audit and review
results get their own receipts.

**Batch-003 authoring is now COMPLETE at 304 candidates.** The frozen plan and
protocol above are unchanged; the surfaces were authored against them, not the
other way round. `fixtures/local-memory-inference-p1b6-surface-batch-003.json`
holds 304 items over 304 source episodes, one candidate per episode, with
sequential `p1b6-item-b003-001`…`304` / `p1b6-se-b003-001`…`304` IDs and unique
batch-003 source and surface families. Every marginal matches the derived plan
exactly — split 195 / 47 / 62, authoring label 141 / 163, language 213 / 61 / 30,
fragments 55 / 78 / 99 / 56 / 16, 38 per discourse pattern, and the per-skeleton
`plannedSkeletonCounts`. The previously zero-covered `p1b6-sk-aebbf047d6864a35`
receives its 5 new DEV/ESCALATE realizations, which are **new surfaces with new
source text and new IDs, not a repair or replacement of historical item
`p1b6-item-b002-050`**.

Episode content is committed at
`scripts/data/memory-inference-p1b6-batch-003-content.js`; every byte offset, ID
and family ID is computed mechanically by
`scripts/build-memory-inference-p1b6-batch-003-materialize.js`, which also
assigns each slot's language / fragment / discourse spec deterministically from
the frozen plan so the batch cannot drift from it.

**Leakage checks are batch-003-specific and extend nothing historical.**
`validateBatch003Leakage` reuses the same normalization the batch-002 growth
tests already use and refuses any exact normalized conversation reused from the
anchor-marker pilot, batch-001, historical batch-002 or the batch-002 successor,
any non-trivial (≥12 character) exact turn reused from those sources or within
batch-003, any reused item / episode / family identity, and any family crossing
splits. `templateReuseDiagnostic` is a **report, not a gate**: it surfaces the
most repeated short turns for HUMAN eyeballing, and obvious essential-dialogue
paraphrase leakage still requires HUMAN or code review judgment rather than a
fuzzy automatic rejection.

The canonical generic `scripts/build-memory-inference-p1b6-source-audit-packet.js`
builds a fresh batch-003 packet unchanged — 304 unique opaque audit rows, each
carrying the complete source episode and a `selectedBundle` byte-identical to
renderer output, with no item, episode or skeleton ID, no split, boundary class
or discourse pattern, and no generator target or expected answer. Audit packets
stay transient by convention and are not committed; the run receipt records the
generated packet's path and raw SHA.

Authoring provenance is recorded separately from planning provenance in
`fixtures/local-memory-inference-p1b6-surface-batch-003-materialization-receipt.json`,
which binds the frozen protocol, the semantic authority and the completed batch
by identity and raw SHA. **The frozen authoring protocol is not rewritten.** The
per-item ESCALATE ambiguity self-check performed during authoring is recorded as
authoring QA only — it is explicitly **not** HUMAN gold, not a source audit, and
not independent validation.

### Pre-audit authoring repair

The initial batch-003 materialization was **structurally correct** against the
frozen plan, but a pre-audit semantic construction review of the ESCALATE
surfaces found systematic **surface collapse** under
`CONSERVATIVE_PRAGMATIC_INTERPRETATION`: the visible evidence resolved to one
status instead of positively licensing two materially different ones. A valid
ESCALATE surface licenses the competing reading from visible evidence alone; a
reading that needs an unstated event, a grandfathering rule, a hidden preference
or any other new premise does not count, and neither does a character saying the
situation is unclear.

**This is an authoring defect caught before any gate — not a HUMAN relabel and
not an audit disposition.** 53 surfaces over 8 skeletons were re-authored:
`p1b6-sk-135ab77919a554dc` (038–042), `p1b6-sk-2da4e54e6609e34b` (079),
`p1b6-sk-38c426bb2e0bff42` (093–104), `p1b6-sk-5229ea237196499d` (130–141),
`p1b6-sk-59c8f51891ab4996` (146–149), `p1b6-sk-a19bb9e94e9a416b` (220),
`p1b6-sk-be0efa305956d111` (241–249) and `p1b6-sk-cc054a4227cdafef` (254–262).
Per-defect collapse and repair are tabulated in the run receipt.

The repair changed source dialogue, selected evidence and anchors only. Every
repaired item keeps its `semanticSkeletonId`, `splitAssignment`, item ID,
source-episode ID, `sourceFamilyId`, `surfaceFamilyId`, language, discourse
pattern and fragment count, so all frozen marginals and `plannedSkeletonCounts`
are unchanged and the batch is still exactly 304 items / 304 episodes. **All
byte offsets were recomputed mechanically from the new text**; none was
hand-edited. The frozen authoring protocol stays byte-identical.

`buildBatch003()` now **fails closed on leakage**: after structural validation it
runs the batch-003 leakage validator before the batch can be written, so a
leakage-invalid authored batch never reaches the fixture whatever a separate test
does. That behavior stays at the batch-003 boundary and is not pushed into the
historical shared surface library.

The pre-repair transient audit packet is **stale and was never adjudicated**. A
fresh 304-row packet was regenerated from the repaired batch with the unchanged
canonical generic builder.

A **second** pre-audit construction review found a smaller residual set and
repaired 15 more rows before any gate: six `p1b6-sk-be0efa305956d111`
realizations whose two rules were **orthogonal** rather than overlapping (so
attaching the second changed nothing about the target), seven
`p1b6-sk-cc054a4227cdafef` realizations whose alignment clause was predicated of
the report and so scoped over all of it, plus `079` (the target still read as
having gone through the ER) and `147` (discourse recency selected the real alarm
over the dry run). The repair puts the second rule on the **same dimension** over
a **cross-cutting** category, replaces the whole-report alignment clause with an
act or decision whose scope is not lexically fixed, gives `079` one visible
property pulling into the exception and one pulling out, and makes `147`'s two
timings parallel members of one enumerated clause. The other 38 rows from the
first repair were not reopened, and all frozen slots are preserved.

The construction-shape regression test pins the **known structural
anti-patterns** both reviews found. It deliberately does **not** claim to
establish semantic validity: lexical matching cannot prove that two readings are
licensed, the first review's phrase list already missed semantic equivalents such
as `같은 말을 했어` and `맞는 말이라고 했어`, and any list will miss the next
paraphrase. **Semantic authoring QA remains a review judgment, and the source
audit remains a separate completeness question.**

A **third** pass repaired two residual `p1b6-sk-cc054a4227cdafef` rows (255, 257)
whose alignment clause was still predicated of the report as a whole. They now
follow the accepted partial-alignment shape: the user explicitly aligns with one
identifiable aspect of the multi-aspect report, and nothing establishes whether
the whole reported target was adopted.

**Current state: batch-003 authoring COMPLETE at 304 candidates, with 53, then a
residual 15, then a final 2 ESCALATE surfaces repaired before any gate; the frozen plan and protocol
unchanged; a fresh source-audit packet regenerated from the repaired batch. The
fresh source audit of all 304 repaired rows is the next gate and has NOT been
executed. No batch-003 HUMAN review has happened and no batch-003 acceptance has
happened. Final corpus HUMAN-gold freeze, repeated HELD review, FINAL_HELD_OUT
release, deterministic FINAL selection, and training all remain UNOPENED, and the
380-item P1-B6 corpus is not complete.**

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

## Large-Batch Review Authority (prospective amendment)

The intended large-batch workflow is **not** exhaustive manual HUMAN labeling of
roughly 300 newly authored surfaces. The canonical design had generalized the
small batch-001/batch-002 HUMAN-review workflow into blanket requirements — that
every final item receives primary blind HUMAN review, that HUMAN gold is
authoritative for every surface, and that every eligible HELD candidate receives
a repeated HUMAN pass. **Those three clauses are superseded prospectively for
batch-003 and later large-batch growth** by an explicit repository-owner
decision, recorded narrowly in
`fixtures/local-memory-inference-p1b6-large-batch-review-authority-amendment.json`.

Batch-001 and batch-002 HUMAN provenance remains **valid and immutable**. No
historical receipt is rewritten, no historical HUMAN decision is renamed, and no
retroactive relabel is authorized.

For newly authored surfaces from batch-003 onward:

1. the effective-current semantic skeleton catalog defines the intended
   **reference label**;
2. source/bundle audit validates evidence completeness;
3. a fresh separate strong model performs blind semantic realization review;
4. agreement between the blind strong-model decision and the reference label
   validates the realization **provisionally**;
5. HUMAN review is reserved for strong-model/reference disagreement,
   strong-model `FIX`, strong-model `REJECT`, and a small deterministic
   calibration sample of otherwise clean agreements;
6. unreviewed clean agreements are **not** HUMAN gold.

### Reference-label provenance

Blanket prospective `HUMAN gold` wording is replaced by explicit provenance:

| category | meaning |
| --- | --- |
| `HISTORICAL_HUMAN_CONFIRMED` | carried from batch-001/batch-002 HUMAN review and acceptance |
| `CATALOG_STRONG_MODEL_CONFIRMED` | audit `PASS` + blind strong-model `KEEP` + decision equal to the reference label; provisional, **not** HUMAN gold |
| `HUMAN_ADJUDICATED` | the repository owner actually reviewed and adjudicated the row |

The final corpus may legitimately mix all three. **The 190 CLEAR / 190 ESCALATE
constraint is over the frozen reference labels**, not a claim that 380 surfaces
each received direct HUMAN labeling. No item is described as HUMAN-reviewed
unless the owner actually reviewed it.

The effective-current catalog stays the semantic authority. A strong-model
disagreement never relabels a skeleton or a surface by itself.

### HUMAN adjudication semantics

When a routed row later reaches HUMAN adjudication:

- HUMAN `KEEP` whose decision matches the reference label may make the row
  eligible as `HUMAN_ADJUDICATED`;
- HUMAN `FIX` or `REJECT` makes the current realization ineligible;
- HUMAN `KEEP` whose decision **opposes** the reference label must not silently
  override the catalog. Treat the realization as a semantic mismatch requiring
  surface repair or rejection; repeated same-skeleton mismatch may trigger an
  explicit skeleton-realizability review. The effective-current catalog is never
  amended automatically.

### Prospective reconciliation

A row becomes `CATALOG_STRONG_MODEL_CONFIRMED` and provisionally eligible when
source audit is `PASS`, strong-model disposition is `KEEP`, and the strong-model
decision equals the effective-current reference label. A row routes to mandatory
HUMAN adjudication on `FIX`, `REJECT`, a decision differing from the reference
label, or a missing/invalid result. **The HUMAN-facing packet never exposes the
routing reason, the model decision, or the reference label.**

Alongside that, **32** clean-agreement rows are selected for blind HUMAN
calibration by a deterministic rule: form cells by
`boundaryClass × reference label`, use only cells present in the clean-agreement
population, take one row from every non-empty cell first, rank rows inside a cell
by `sha256("p1b6-large-batch-human-calibration-v1" + NUL + itemId)`, allocate the
remaining slots up to 32 by largest remainder over each cell's remaining
population with canonical `(boundaryClass, label)` ordering for ties, then take
the next lowest hashes inside each cell. It **fails closed** if 32 clean
agreements do not exist. At the current pre-review population 15 boundary × label
cells are populated, but that count is **not a permanent invariant** — a
strong-model disagreement can empty a cell.

Calibration is QA of the pipeline. Its results are **not** extrapolated as HUMAN
gold to unreviewed rows: a calibration-row defect is recorded as calibration
evidence about that row, and a clean sample never proves that every unreviewed
row is human-confirmed.

## Batch-003 Source Audit — COMPLETE_NEEDS_FIX at 301 PASS / 3 FAIL / 0 UNCERTAIN

The whole 304-row audit ran against the canonical packet and is complete. The
receipt is
`fixtures/local-memory-inference-p1b6-source-audit-batch-003-attempt-001.json`,
bound to the batch, the audit packet, the audit protocol and the raw result
artifact by identity and raw SHA. Opaque audit IDs were mapped back to items
mechanically rather than from any hard-coded table. The raw artifact carried only
per-row dispositions and reasons, so **no auditor model or runtime setting is
recorded** — none was supplied and none is invented.

Three rows fail closed and are ineligible for semantic review:
`p1b6-item-b003-002` (omitted lease-end context narrows the otherwise generic
undecided timing), `p1b6-item-b003-006` (an omitted teammate instruction adds a
material deferral constraint) and `p1b6-item-b003-109` (an omitted prior turn
resolves the referent the anchored report needs). The auditor's reasons are
preserved verbatim in the receipt.

**They are intentionally excluded, not repaired now, and batch-003 is not
mutated.** The 17-candidate tranche buffer exists to absorb review loss; any
shortage or top-up is measured after semantic review, not here.

Exactly **301** rows are eligible for the next gate. No HUMAN review, no
strong-model semantic review, no acceptance, no reference-label freeze and no
training or evaluation has occurred.

## Closed Selection and Freeze Constraints

The accepted surface pool is selected through a deterministic, constrained,
reproducible procedure after review and leakage validation. It is not aesthetic
hand-selection. The selection procedure must freeze its serialization,
identity/hash tie-break, and constraint implementation before final selection.

**Prospective order, from batch-003 large-batch growth onward** (see the
review-authority amendment below):

```text
authored surface
  -> source/bundle audit PASS
  -> blind strong-model semantic realization review
  -> disagreement/FIX/REJECT HUMAN adjudication
     + 32-row deterministic HUMAN calibration sample
  -> reviewed eligible pool with explicit label provenance
  -> deterministic constrained provisional selection
  -> second independent strong-model review of selected HELD
  -> HUMAN adjudication only for HELD conflicts
  -> final constraint/leakage validation
  -> reference-label + dataset freeze
```

Top-up is driven by actual shortages measured after these review losses, not
planned in advance.

The order used for the small batch-001 and batch-002 pools was:

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

That historical order produced the batch-001/batch-002 receipts and their
HUMAN provenance, which remain valid and immutable. It is **not** the order for
large-batch growth.

No FINAL model output may be inspected before source audit, semantic review,
adjudication of every routed row, provisional selection, the second independent
strong-model review of the selected HELD rows, and dataset freeze. FINAL is
never used for training, checkpoint selection, or hyperparameter selection.

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

**Prospective scope (batch-003 onward):** this exhaustive per-surface HUMAN
pass is superseded for large-batch growth. The blind reviewer of every PASS row
is a fresh separate strong model under
`fixtures/local-memory-inference-p1b6-strong-model-semantic-review-protocol.json`,
and the section below applies to the rows that review routes to the repository
owner. The blind-field list above still governs both reviewers.

The reviewer independently chooses `KEEP / FIX / REJECT` and
`CLEAR / ESCALATE`. For historical batch-001/batch-002 review, HUMAN gold was
authoritative and model suggestions advisory. Prospectively the
**effective-current skeleton catalog** is the reference-label authority: a
strong-model decision never relabels it, and a HUMAN `KEEP` whose decision
opposes the reference label does not silently override it either. Ill-defined gold, incoherent candidate focus, or implausible
conversation is `REJECT`, not automatic `ESCALATE`. If the blind HUMAN label
opposes the approved skeleton HUMAN label, it cannot be silently accepted or
relabeled: it requires FIX plus new review or rejection. Repeated mismatch
triggers review of that skeleton's realizability.

Any evidence edit restarts the applicable source audit and blind review. No
previous HUMAN label or generator intent is inherited after an evidence edit.
No FINAL surface item is used for training or tuning.

## HELD Second-Pass Validation

**Prospective (batch-003 onward).** The repository owner does not perform two
manual passes over every eligible HELD candidate. After the reviewed eligible
pool can support deterministic corpus selection:

1. perform provisional deterministic constrained selection;
2. freeze the selected HELD evidence and targets;
3. run a **second independent fresh strong-model blind semantic review** over
   the provisionally selected 80 `FINAL_HELD_OUT` rows, hiding the first
   strong-model result, the reference label, and all provenance/routing;
4. a selected HELD row stays eligible only when **both** independent
   strong-model reviews are `KEEP` and both decisions equal the reference label;
5. any second-review disagreement, `FIX` or `REJECT` routes to HUMAN
   adjudication;
6. remove or reject defective rows and rerun deterministic selection if needed;
7. only when no unresolved selected HELD row remains may the dataset freeze
   occur.

This is a second independent model review plus targeted adjudication. It is
**not** repeated HUMAN review, and it must not be described as one.

### Historical HELD repeated HUMAN pass (batch-001 / batch-002)

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
