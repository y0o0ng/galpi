# XION R2 Storage Routing — Implementation Design

This is an implementation design subordinate to [the canonical R2 architecture](memory-architecture-design.md), especially §§42, 45–47, 50–51 and 54. It does not change semantic authority. The accepted choice is one **logical** EvidenceRef/address layer over existing owning stores (Option B); SQLite is the Phase-1 physical implementation of that layer, not a unified evidence ledger.

## Agreed formation front-end and storage flow — 2026-10-01

This records the end-to-end responsibility boundaries, not a claim that every stage is implemented. The canonical transition semantics remain in §§42.2–42.6; the family-specific v1 constraints below still apply.

```text
Local-memory / formation front-end

source episode
↓
Bundle Builder
    - candidate/topic discovery
    - source-grounded anchor selection
    - relevant evidence bundle selection
↓
Ambiguity / Escalation
    - can this visible bundle sufficiently determine the candidate's meaning?
    - CLEAR → next stage
    - ESCALATE → stronger path / unresolved
↓
Durability
    - is this a candidate worth remembering long-term?
    - WRITE candidate / NO_WRITE
↓
Extractor
    - source-grounded structured representation
↓
accepted structured candidate
    - semantic family
    - subject
    - attribute / relation
    - value
    - source refs

────────── R2 LTM storage boundary ──────────
↓
Storage Router
    - EvidenceRef binding
    - semantic-family handler dispatch
↓
Target Lookup
    - does the same state identity already exist?
    - NEW / no target → initial formation evaluation
↓
Build Replay Package
    - new evidence
    - current state
    - original support
    - relevant history
    - counterevidence / exceptions
    - assumptions, where applicable
↓
Change Classification
    - EXPANSION
    - WORLD_UPDATE
    - CORRECTION
    - ADDITIONAL_CONTEXT
    - CONTRADICTION
    - TEMPORAL_SCOPE_CHANGE
    - INTERPRETATION_REVISION
    - AMBIGUOUS / UNRESOLVED
↓
Propose Transition
    - NO_CHANGE
    - CREATE
    - EXPAND
    - SUPERSEDE
    - REVISE
    - FORK / KEEP_AMBIGUOUS
    - INVALIDATE
↓
Domain-specific validation
↓
atomic commit
    - derived state
    - derivation / dependency provenance
```

Front-end ambiguity concerns whether the source/bundle determines the candidate's meaning; change classification concerns that structured candidate's relationship to an existing derived state. `WRITE` admits a candidate to durable formation evaluation, not state-mutation authority. `NEW / no target` is a lookup outcome, not an additional change class or automatic CREATE; justified initial formation uses `changeClass = null` under the existing General Fact contract.

The front-end stages are not implemented by the manual candidate-input UI. The current General Fact storage path supports only the executable transitions documented below, with separate owner HUMAN semantic approval before atomic commit. This flow does not open arbitrary subjects, attributes/relations, assumptions or unsupported transitions in v1, and does not connect production ingress.

### Agreed development execution boundary — 2026-10-03

Design outside-in: the existing pipeline's processing order is not the order in
which this track must implement its components. Ambiguity inference belongs to
the separate local-memory track. Preserve the existing Builder contracts and
storage implementation; first establish their outer execution boundary.

The owner accepted **one explicit source episode in → per-bundle processing
results out**. Each result keeps the same bundle identity, anchor and original
evidence references throughout the run. The result explains where processing
stopped and why, rather than returning only whole-run success/failure:

| Outcome | Retained information |
| --- | --- |
| Meaning judgment deferred | Original bundle and deferral reason |
| NO_WRITE | Original bundle and durability reason |
| Extraction deferred | Original bundle and representation-deferral reason; no candidate |
| Processing error | Original bundle and failed stage |
| Storage review prepared | Original bundle, extracted candidate and existing review identity |

These are execution outcomes, not new Derived-State statuses or semantic labels.
The first development connection ends at HUMAN review preparation; actual state
mutation continues to require the existing approval path. The initial agreement
was an outer contract only; the development runner below now implements its wiring
with explicit callbacks and synthetic connection tests. Internal model design,
new families and production integration remain separate work; no additional model
call is authorized by this design step.

### Agreed stage inputs and advisory durability reason — 2026-10-03

Stage execution order does not imply forwarding every preceding judgment to the
next model. The runner retains each result against the unchanged bundle identity,
anchor and source references, and uses gate outcomes to control progression.

| Stage | Judgment input | Output responsibility |
| --- | --- | --- |
| Ambiguity | Anchor and evidence bundle | CLEAR / ESCALATE and reason |
| Durability | The same anchor and evidence bundle, without the Ambiguity judgment/reason | WRITE / NO_WRITE and a short durability reason |
| Extractor | The same anchor and evidence bundle, plus the WRITE durability reason | Source-grounded structured representation of that one target |

The durability reason is advisory context for extraction, not source evidence or
authority to broaden the anchor. Every extracted claim must remain supported by
the original bundle; source references point to original evidence, never to the
durability explanation. Durability does not produce the extracted claim or choose
its semantic family/attribute. Conditions and uncertainty belonging to the target
must survive extraction even if the advisory reason misstates or omits them.

This is an accepted interface design, not an implementation or measured quality
improvement. An explanation may help preserve relevant conditions, but may also
propagate an upstream interpretation error; its performance benefit remains
unverified. Ambiguity, Durability and Extractor remain unimplemented here.

### Agreed extraction success / deferral boundary — 2026-10-03

After CLEAR and WRITE, extraction has two semantic outcomes:

- Success: one structured candidate faithfully representing the anchor, with
  original source references and the target's conditions/uncertainty preserved.
- Deferral: no candidate, with a specific reason why faithful representation
  could not be produced within the supported extraction contract. Retain the
  original bundle, anchor and evidence references for review.

Extraction deferral is not NO_WRITE and does not overturn the earlier judgments.
Do not force an unsupported target into an unrelated registered family/attribute
or omit material conditions merely to produce a valid candidate. A malformed
response or execution failure remains a processing error, not a semantic deferral.
Success does not authorize state mutation or bypass Router/transition validation
and HUMAN review. The development callback shape is specified below; this
agreement adds no family, storage schema or model call.

### Agreed direction for attribute proposals — 2026-10-03

New attribute creation belongs to a separate proposal/review path, not inline
runtime invention by the Extractor. Preserve an unsupported bundle as deferred;
a future proposal path checks existing attributes for overlap and presents the
proposed meaning, value shape and need to the owner through a notification/review
flow. Initial authority is HUMAN approval, modification, hold or rejection.
After a definition is supported and registered, the original bundle can be
extracted again. Attribute approval is not approval to store an individual fact.

Not every representation failure is a missing attribute: unsupported cardinality,
conditional structure or semantic family requires its own implementation design,
not a new name that bypasses existing constraints. Current developer-registered
attributes remain the executable contract. Model-assisted registration and its
notification UI are future work; later automation requires a separate decision
based on observed proposal/review quality. No automatic registration, semantic
family expansion or notification implementation is adopted by this direction.

### Agreed extraction output / source binding responsibility — 2026-10-03

Successful extraction reuses the existing candidate-v1 Router shape rather than
introducing a second storage ingress. The model returns the semantic family,
family-specific payload and the IDs of evidence it used from the supplied bundle.
Code verifies those IDs against that bundle and maps them to owning-source
addresses to construct `sources`; the model does not invent database addresses or
EvidenceRef IDs. The runner preserves the original bundle identity and anchor
outside the fixed candidate shape. EvidenceRef registration remains the Router's
responsibility.

The initial supported payload remains `general_fact` with `subject: USER`,
`attributeKey: primary_laptop` and the existing string/no-replacement-null value
contract. Deferral produces no candidate and retains its reason; a missing
attribute may later enter the separate proposal path above. Structural and
source-ID validation does not establish semantic faithfulness. This records the
accepted division of responsibility; the outer runner below implements the
connection, while the three semantic-stage model adapters remain unimplemented.

### Development formation runner — 2026-10-03

`lib/memory-storage/formation-runner.js` exports
`runFormationEpisode(episode, { selectBundles, assessAmbiguity, assessDurability,
extractCandidate, prepareReview })`. Every callback is explicitly supplied by
trusted development code; there is no default model, CLI, provider, retry,
production connection or automatic approval. It reuses `discoverEvidenceBundles`
and the existing Router candidate validator. The review callback is the existing
Router composed with `createGeneralFactReviewHandler`, not the committing handler.

The runner snapshots the explicit episode, selects bundles once, then processes
each bundle sequentially. Each semantic callback receives a fresh copy of
`{ bundle, evidence }`; evidence contains only selected source turns with IDs,
roles, text and source timestamps. Extraction alone additionally receives
`durabilityReason`. Previous decisions/reasons remain in the returned execution
record and are not otherwise forwarded into judgment inputs.

- Ambiguity returns exactly `{ disposition: CLEAR | ESCALATE, reason }`.
- Durability returns exactly `{ disposition: WRITE | NO_WRITE, reason }`.
- Extraction returns `{ disposition: EXTRACTED, semanticFamily, payload,
  evidenceTurnIds }` or `{ disposition: DEFERRED, reason }`.

These callbacks return objects; future model adapters must parse their own
responses. Unknown/additional fields, empty reasons, malformed candidates and
empty/duplicate/out-of-bundle evidence IDs fail closed. The code derives source
addresses in original source order, never accepts model-supplied addresses, and
passes a separate candidate copy to review preparation. Original bundle/span
identity remains outside the fixed Router candidate shape. Owning-source and
family validation remain in the existing storage modules; no semantic correctness
is inferred from the structural checks.

Per-bundle outcomes are `MEANING_DEFERRED`, `NO_WRITE`, `EXTRACTION_DEFERRED`,
`REVIEW_PREPARED` or `PROCESSING_ERROR` with the failed stage. The existing
handler's idempotent return for an already HUMAN-committed candidate is reported
as `ALREADY_COMMITTED`, not as a new commit or review. A stopped bundle does not
stop unrelated bundles, and no callback is retried. Invalid source/configuration
or failed discovery rejects the episode before downstream stages; zero bundles
returns zero results, not NO_WRITE. Exceptions are sanitized rather than copying
provider/private error bodies into results. The report is returned in memory and
contains private source/candidate material; it is not a public artifact or durable
resume journal. The Builder's `NOT_VALIDATED` completeness marker is preserved;
this connection does not replace the separate bundle audit or create an audit gate.

Validation uses synthetic stage judgments and an in-memory SQLite development
database with existing migrations explicitly applied. The existing Router/review
path creates a pending HUMAN review, leaves messages and derived state unchanged,
and only an explicit synthetic approval in the test commits a fact. Tests also
cover gates, extraction deferral, error isolation, input-copy protection, selected
source binding, idempotent prior commits and malformed callback outputs. No real
HUMAN judgment, external/model call, Pi access, schema change or production write
occurs. The three semantic-stage implementations and attribute proposal workflow
remain future work.

Validation at baseline `80e7210e3cce89d7667e2ffb7f6355d375886578`: new runner
tests **6/6 PASS**; focused Builder/storage/proposer/review tests **163/163 PASS**.
`npm test -- --test-concurrency=2`: **1,989 PASS / 2 FAIL / 3 SKIP** (1,994 tests).
The failures are the existing theme assertions at
`test/assistant-task-ui.test.js:219` and `:312`; that test and its `public/app.js`
and `public/style.css` inputs are byte-identical to the baseline. No UI fix is
included. `git diff --check` and AGENTS/CLAUDE body equality pass. These are local
mechanical tests with synthetic judgments, not a semantic model evaluation.

## Storage topology and authority

| Current code/store | Present authority | Phase-1 treatment |
| --- | --- | --- |
| `messages` (`server.js`) | Durable conversation source; only embeddings are updated after insert | First and only EvidenceRef resolver |
| Topic Markdown QA-LOG (`lib/topic-store.js`) | Saved Q/A source with stable `qaId` | No resolver yet |
| `note_chunks` (`lib/topic-chunk-store.js`) | Rebuildable retrieval/index representation | Not an owning source |
| Promoted library attachment blob (`lib/attachment-library.js`) | Durable attachment source after explicit promotion | No resolver yet; temporary attachments remain temporary |
| `attachment_documents` / `attachment_chunks` | Parsed, rebuildable representations | Not owning sources |
| `assistant_tasks`, reminders, series | Operational commitments and lifecycle truth | No resolver; router cannot grant commitment |
| `schedule_history` Markdown | Projection from task DB state | Not an owning source |
| `note_edges` | Semantic association | Not derivation provenance |
| `auto_save_decisions`, retrieval shadows, memory-inference observations | Policy/access/evaluation traces | Not memory truth or ingress candidates |
| `_system/memory.md` | Legacy privileged memory state | Not this registry |

Canonical constraints: source evidence remains separate from interpretation and derived state; ordinary revisions do not rewrite source history; provenance differs from semantic association and access traces. Direct source/QA anchor retrieval and bounded reader-context reconstruction remain available without EvidenceRef registration. The read path is untouched.

## Phase-1 boundary

Schema v29 adds `memory_evidence_refs(evidence_id, source_domain, source_key, locator, source_version, content_sha256, created_at)`. Its address tuple is unique and non-null; v1 conversation addresses use empty locator/version. `evidence_id` is `ev1_` plus lowercase SHA-256 of UTF-8 `xion-evidence-ref-v1\0domain\0key\0locator\0version`. It is independent of SQLite rowid. `content_sha256` is SHA-256 of the owning message's exact UTF-8 content. It is integrity metadata; neither content nor embeddings are copied into the registry. `created_at` records registry materialization time, not a canonical valid/knowledge-time model (§54.4 remains open).

The only registered source resolver is `conversation_message`. Its key is the canonical positive decimal form of `messages.id`. It reads `id`, `session_id`, `role`, `content`, and `created_at`, computes the content hash, and rejects missing messages. Registration is idempotent for the same address and unchanged content. A changed owning message, conflicting registered hash/address, unsupported domain, noncanonical key, or nonempty conversation locator/version fails closed; no silent rebind occurs. The resolver returns content to its in-process caller for future replay, but the registry table never stores it. This phase does not migrate existing messages into EvidenceRefs.

## Accepted candidate and router

The post-extraction ingress is an **already accepted** candidate, distinct from `research_memory_inference_observations`:

```json
{
  "schemaVersion": 1,
  "semanticFamily": "developer_registered_family",
  "payload": {},
  "sources": [{ "sourceDomain": "conversation_message", "sourceKey": "1234" }]
}
```

The router validates the fixed top-level shape, bounded family name, plain JSON-compatible payload, and nonempty source list. It requires a developer-supplied `Map` handler, resolves/registers **all** sources in one SQLite transaction, then dispatches `{ candidate, evidenceRefs }`. A bad source prevents all source bindings and handler execution. An unregistered family fails before registration; there is no generic fact or other fallback. No production semantic-family handler is registered in Phase 1. Neither extraction nor this router selects transition target/change, projection, memory-worthiness, or operational permission. Handler-side derived-state/provenance commit semantics remain for the next phase.

This is deliberately not wired into chat, auto-save, attachment, task, mail/news, or Local Memory Inference research paths. No Derived-State, hypothesis, provenance-edge, or projection table is added. The first real semantic family should determine the minimum persistent state/provenance shape; its producer adapter can later call this router. The existing direct retrieval path remains independent.

## Checks and failure behavior

Focused tests cover canonical IDs and addresses, migration/unique constraints, idempotent and integrity-checked conversation resolution, atomic multi-source binding, fail-closed candidate/handler dispatch, and unchanged owning message rows. `npm test` checks existing production behavior. These tests use only local SQLite and synthetic candidates; no model, network, Vault, or production DB is involved.

## Phase 2 — General Fact storage core

The Phase-1 statements above preserve that phase's boundary. Phase 2 adds a narrow `general_fact` core under canonical §§42.2–42.4, 50.4 C1/C2 and 51.4–51.5. It is a provenance-backed derived claim/state, not a Projection or an unrestricted memory bucket. Preferences, routines, relationships and operational commitments are not routed into this family.

All storage modules live together in `lib/memory-storage/`: `evidence-registry.js`, `router.js`, `general-fact.js`, the Phase-3 `general-fact-review.js`, and the Phase-4 `review-ui.js`. Existing schema v29/v31/v32 remain in `lib/database-migrations.js`; future storage changes follow the migration boundary below. No production candidate producer or registered production handler is connected; existing retrieval and source ownership are unchanged.

### Future migration boundary — owner decision, 2026-09-30

Unconnected LTM development must not require a Pi schema upgrade or block lecture-note deployment. Existing shared migrations v29, v31 and v32 retain their SQL, numbers and application history; they are not removed, renumbered or skipped. V31/v32 add family-local tables and indexes only, without rewriting existing conversation/lecture data or activating a production memory path. Their actual Pi application status is not established by this decision.

Starting with the next LTM schema change, migrations and an independent module-version record belong under `lib/memory-storage/`, rather than consuming another shared `schema_version` number. Apply them explicitly to a separate development/test SQLite DB. Do not import or execute that migration runner from production server startup. A Pi application path requires a separately approved production-integration step; deploying unrelated features must not apply these future LTM changes.

This separates schema release timing, not source authority or the selected production storage topology. It does not require a second production database or copy owning evidence. Development fixtures remain synthetic or separately authorized. No empty migration runner/version table is introduced now; implement the narrow module runner with the first actual module migration. Production migration numbering remains available to lecture-note and other production work.

### Accepted ingress and target identity

The upstream flow remains source episode → Bundle Builder → Ambiguity/Escalation → Durability → Extractor → accepted structured candidate. Source/bundle ambiguity concerns the candidate's meaning; later change classification concerns its relationship to an existing derived state. `WRITE` is permission to enter durable formation evaluation, not permission to mutate state. This phase implements only the handler boundary after extraction, not those upstream stages.

```json
{
  "schemaVersion": 1,
  "semanticFamily": "general_fact",
  "payload": {
    "subject": "USER",
    "attributeKey": "primary_laptop",
    "value": "Intel MacBook Pro"
  },
  "sources": [{ "sourceDomain": "conversation_message", "sourceKey": "1234" }]
}
```

V1 accepts only `USER`, developer-registered **SINGLE** attributes and string claim values. The initial registry contains only `primary_laptop`: the device the user identifies as their primary laptop. This does not establish a separate device/entity identity. Strings are preserved without inferred aliases or semantic normalization. Generic scope, arbitrary subjects, SET-valued/contextual/conditional facts and runtime-invented attributes are unsupported. Additional attribute-specific semantic validation remains open.

The identity key is `(general_fact, USER, attributeKey)`; value is excluded. A target without a current state proceeds to formation evaluation, not automatic CREATE. A target with a current state requires replay/change evaluation. An incompatible or broken state history fails closed rather than selecting a latest row.

By owner decision, `payload.value = null` is also accepted as a **no-replacement review candidate** (for example a retraction). Null is never persisted as a fact value. CREATE, SUPERSEDE and REVISE require a nonblank string (maximum 2,000 JS characters); null does not automatically select INVALIDATE. The registry and SQLite timestamps are materialization/source metadata only; §54.4 remains open/unadopted.

### Replay, proposal and validation

`createGeneralFactHandler` requires explicitly supplied `proposeTransition` and `validateTransition` functions. There is no default model, heuristic classifier, automatic approval, API call, or generic fallback. Local-model use remains an open implementation direction. A valid proposal JSON object is not proof that its semantic judgment is correct; tests inject synthetic judgments only.

The handler binds sources via the existing router and persists a pending candidate. Its immutable in-process replay package contains the candidate, current state, original support, slot transition/state history, other unresolved candidates, and the actual owning-message content resolved through EvidenceRefs. Correction/invalidation evidence is identified separately. Replay reads the complete slot history in v1; bounded selection can be added if measured input size requires it. V1 does not represent assumption-bearing claims, so `assumptions` is empty; this is not a replacement for the canonical assumption/provenance model.

Proposal shape is `{ changeClass, transition, evidenceIds, rationale }`; validation returns `{ approved, reason }`. Selected support must be present in the replay and include at least one incoming candidate EvidenceRef. This is structural binding, not proof of independent evidence or semantic support. The configured domain validator must judge support and change meaning. All canonical change distinctions remain named: EXPANSION, WORLD_UPDATE, CORRECTION, ADDITIONAL_CONTEXT, CONTRADICTION, TEMPORAL_SCOPE_CHANGE, INTERPRETATION_REVISION, AMBIGUOUS and UNRESOLVED. No string comparison chooses a class.

| Executable proposal | V1 constraint / effect after approval |
| --- | --- |
| CREATE | No current state; `changeClass = null` means initial formation, not a new change class; create string claim |
| SUPERSEDE | WORLD_UPDATE; preserve earlier state as valid history |
| REVISE | CORRECTION with replacement; earlier claim is corrected, not valid previous-world history |
| INVALIDATE | CORRECTION; invalidate current claim without fabricating a replacement |
| NO_CHANGE | Explicit non-null change classification and approval; record evaluation while preserving current state and its original support |

EXPAND, FORK and KEEP_AMBIGUOUS execution is not implemented. Such proposals fail closed and remain pending with their actual classification; they are not silently mapped to overwrite or a different change class. Future family extensions must decide their representations. The SINGLE implementation is not a claim that canonical R2 disallows multiple hypotheses.

### Initial development approval boundary — owner decision, 2026-09-30

For the first connected General Fact development workflow, the semantic proposer produces an evidence-backed transition proposal; code checks its shape, EvidenceRef bindings, supported transition constraints and replay snapshot integrity; the repository owner reviews and approves the **semantic judgment** before atomic commit. A model proposal, structurally valid JSON or successful mechanical checks alone must not authorize commit. Until that HUMAN approval is supplied, the candidate remains pending and the stable state is unchanged.

Approval applies to the reviewed proposal and replay snapshot. A changed snapshot requires fresh review rather than carrying approval to a different target/evidence package. The existing stale-replay check remains mandatory.

This selects the initial development authority boundary, not a permanent requirement to manually approve every future memory. Automatic semantic approval conditions remain OPEN and must be evaluated against the actual proposer/validator before adoption. Local-model use remains an option. Phase 3 implements the review persistence/decision backend and Phase 4 adds its development-only browser interface; Phase 5 adds the provider-neutral mock-tested proposal path; Phase 6 adds the explicitly invoked Luna development adapter. Production remains unconnected. Synthetic test callbacks are not production approval authority. This decision instantiates canonical §42.2 SI-10 / §42.6 without changing their shared transition semantics.

The owner has also accepted three development review choices:

| HUMAN choice | Meaning and effect |
| --- | --- |
| Approve | Accept the proposed semantic judgment and transition for the reviewed snapshot; commit is permitted only after the existing mechanical and snapshot checks pass |
| Hold | Evidence is insufficient to judge; preserve the stable state and pending candidate/evidence without commit |
| Reject proposal | Judge this transition proposal wrong; preserve the stable state and pending candidate/evidence for possible later evaluation without commit |

Hold and rejection remain distinguishable review decisions, even though both leave the candidate pending. Rejection is not source deletion, candidate disposal, a new NO_WRITE triage decision, or automatic INVALIDATE of the existing claim. These are review-contract choices, not new derived-state statuses; their persistence is implemented in Phase 3 and their development browser interface in Phase 4.

The owner has accepted four information groups for each proposal review:

| Review information | Required content |
| --- | --- |
| Incoming candidate and evidence | The accepted structured candidate and inspectable owning-source text for its bound EvidenceRefs |
| Existing fact and support | The current claim (or explicit absence of a current claim) and inspectable original support evidence |
| Proposed change and resulting state | The proposed change class/transition and the state that would result if approved and committed; clearly marked as a proposal, not an already-written fact |
| Judgment rationale | Why the proposer classified this as a world update, correction or other named class; rationale is a proposed interpretation, not approval authority |

These are presentation groups, not a reduction of the replay package. Relevant history, unresolved candidates and known counterevidence already present in the replay must remain inspectable, consistent with canonical §42.2 SI-7: derived summaries alone are insufficient. The reviewer must be able to check original source evidence rather than having only a model summary available. Phase 3 binds a review to the replay fingerprint without copying source text; Phase 4 presents these groups and the remaining replay details.

### Physical state and provenance — schema v31

| Family-local table | Responsibility |
| --- | --- |
| `memory_general_fact_candidates` | Accepted candidate/address JSON, bound EvidenceRef IDs, PENDING/COMMITTED status, latest pending diagnostic, proposal and validation record |
| `memory_general_fact_states` | Immutable string claim versions; one version per creating candidate |
| `memory_general_fact_transitions` | Ordered slot revisions, previous/next state identity, operation/change class, replay SHA-256 |
| `memory_general_fact_transition_evidence` | EvidenceRefs supporting that transition |

No owning message content is copied into these tables. Candidate/state values are derived representations; evidence content is resolved in memory only. Candidate identity is `gf_candidate_` plus SHA-256 of `xion-general-fact-candidate-v1\0` and recursively key-sorted canonical candidate JSON (array order preserved, source address defaults explicit). Identical accepted candidates are idempotent. State/transition UUIDs are opaque family-local identities, not evidence addresses.

State status is reconstructed from the validated transition chain: CURRENT, HISTORICAL after SUPERSEDE, CORRECTED after REVISE, INVALIDATED after INVALIDATE. Invalidation leaves no current claim; earlier versions remain. NO_CHANGE has no new claim version and does not silently attach additional support to the current claim. The original support of a state is the evidence of its introducing transition. This narrow source→claim and prior-state→transition lineage does not implement a cross-family dependency graph, projections, or downstream invalidation propagation.

Commit re-reads and compares the complete canonical replay snapshot, including owning-source integrity, before writing. A stale or tampered package fails closed. State version, transition, supporting EvidenceRefs and terminal candidate status commit in one SQLite transaction. Provenance failure rolls all those writes back; the pending candidate and bound source remain. Denied validation or evaluation exceptions preserve the stable state and unresolved candidate. A replay failure also preserves the already-bound candidate. Pending diagnostics retain the latest evaluation, not a multi-attempt audit engine.

### Verification and remaining integration

Synthetic SQLite tests cover USER/attribute/value boundaries; null retraction; source binding and unchanged owning rows; replay of original support and counterevidence; required semantic callbacks; CREATE/SUPERSEDE/REVISE/INVALIDATE/NO_CHANGE; unsupported proposals; idempotence; stale/tampered replay; source integrity; atomic provenance rollback; and invalid slot histories. Migration tests cover schema-30 upgrade, repeat migration, uniqueness, foreign keys and transition mapping constraints.

## Phase 3 — Durable proposal review and HUMAN decision backend

`createGeneralFactReviewStore(db, evidenceRegistry)` in `lib/memory-storage/general-fact-review.js` reuses the family core for replay, structural proposal checks and atomic commit. Schema v32 adds only `memory_general_fact_reviews`; no production route, model/provider, browser UI or source adapter is added.

The review row stores an opaque review UUID, candidate ID, canonical proposal JSON, replay SHA-256, proposal SHA-256, and package SHA-256. The package hash binds schema version 1, candidate ID, replay hash and proposal hash using the core's key-sorted canonical JSON. It also stores materialization time, optional HUMAN reason, decision time and the approved transition ID. It does not store owning-message text or a raw replay-content copy; proposal values/rationale are derived representations, not a second owning source.

| Backend operation | Contract |
| --- | --- |
| `create({ candidateId, replaySha256, proposal })` | Require an existing pending candidate, current exact replay hash and mechanically valid/supported proposal; persist a new review attempt without commit |
| `get(reviewId)` | Return integrity-checked review metadata and proposal; approved records must match their own committed candidate/transition/snapshot |
| `read(reviewId)` | Reconstruct the replay from owning sources, require the stored replay hash, and return the full in-process replay plus a clearly marked proposed-state preview |
| `listPending()` | List undecided review IDs for pending candidates, ordered by materialization time and review ID |
| `decide(reviewId, { choice, packageSha256, reason? })` | Accept only APPROVE, HOLD or REJECT_PROPOSAL for the exact reviewed package; no proposal/validation override fields |

Pending review resumes after SQLite reconnect without calling a proposer again. If the current replay no longer reproduces the stored fingerprint, `read` and approval fail closed: they do not substitute current content into an old review. The old fingerprint/proposal remains audit metadata; a fresh review must be created against the changed snapshot. The v1 full-slot replay fingerprint includes unresolved-candidate context as well as state/source integrity, so changes there may also invalidate a pending review.

APPROVE rechecks the current replay and executes the existing commit in the same outer SQLite transaction as the HUMAN decision/transition link. A failed provenance insert or decision write rolls back all state, transition, candidate-terminal and decision changes. No successful approval record can be left without its committed transition, and no review-path transition can survive failure to record approval.

HOLD and REJECT_PROPOSAL record distinct decisions and leave the candidate pending with `HUMAN_HOLD` or `HUMAN_REJECT_PROPOSAL`; they do not mutate stable state or remove evidence. They may be recorded against the reviewed fingerprint without granting mutation authority, even if that snapshot has since become stale. Every submitted review decision is immutable through this backend. An identical choice/reason/package retransmission returns the existing record without another commit; a conflicting retransmission fails closed. A held/rejected attempt can be followed by an explicitly created new review; old decisions are retained, and no automatic requeue or proposer retry occurs. Other undecided reviews for an already-committed candidate cannot grant a second approval.

The `decide` entry point is for a trusted repository-owner review adapter. It records HUMAN choices; it does not authenticate a caller or establish that an arbitrary program's boolean came from a human. A future UI/adapter must enforce owner authority and route initial development commits through this review boundary. The existing lower-level core/callback seam remains available for synthetic tests and trusted code, and is still not wired into production.

Focused synthetic tests cover no-write review creation, restart/resume, source-copy absence, proposal/package integrity, choices, immutable/idempotent decisions, current/stale snapshots, source integrity, competing reviews, proposed invalidation, approval/transition audit binding, and transaction rollback in both directions. Migration tests cover schema-31 upgrade, repeat migration, foreign keys and complete decision constraints.

The Phase-4 interface below implements the development review adapter. Evaluation of the actual semantic proposer (local model remains an option) remains next, followed by production ingress only after its gates are specified. Automatic semantic approval, active elicitation, Projection and Context Assembly remain outside this implementation.

## Phase 4 — Development-only owner review UI

`lib/memory-storage/review-ui.js` is a standalone Node HTTP server bound to `127.0.0.1:8766`, using the existing Phase-3 store. It opens an explicitly supplied, existing development database; it neither runs migrations nor constructs candidates/proposals. There are no model/provider calls, production routes, Pi deployment, new schema or production DB/Vault integration.

```sh
npm run review:memory-general-fact -- \
  --development-db /private/development-directory/general-fact-development.db
```

The example directory is operator-supplied, not a new default runtime path. The DB must live outside the repository in an owner-private directory (0700), be an owner-private regular file (0600, no hard links), and have that explicit development filename. Real paths are checked, and only the seven existing development `messages`/LTM tables are permitted. Missing schemas and production-shaped DBs are rejected without automatic repair or migration. Synthetic fixtures are used for UI verification; pointing at a production DB is not authorized by this command. Existing developer setup must prepare the LTM schema, owning-message fixtures and persisted proposals before review.

The Korean browser view presents incoming candidate/source evidence, current claim/original support, an explicitly uncommitted transition/result preview, and the proposal rationale. Full history, counterevidence, unresolved candidates and all resolved original evidence remain inspectable in an expandable section. All source/proposal text uses `textContent`, not HTML interpolation; no external assets or browser storage are used.

The operator selects a pending review and confirms APPROVE, HOLD or REJECT_PROPOSAL with an optional reason. The browser supplies only those HUMAN choices plus the displayed review/package identity. The server requires that the same package was displayed in that process, validates local Host/Origin/fetch-site and a per-process request token, and delegates to the existing transactional `decide` operation. Conflicting submissions, integrity failures and stale approval fail closed without leaking exception/source text. A rejected or held attempt disappears from the undecided queue, while its candidate and recorded choice remain; a new attempt must be explicitly prepared elsewhere. No edit, automatic re-proposal, semantic classifier or approval heuristic is provided.

Progress/decisions persist in the existing development SQLite review rows and resume after browser/server restart. The local process and private OS account are the authority boundary; this is an owner-operated development adapter, not multiuser authentication or proof that every arbitrary local program is a HUMAN. It must not be exposed as a production approval endpoint.

Focused synthetic HTTP/SQLite tests cover private DB eligibility, absent-schema/production rejection, source/state preservation on display, all three durable choices, restart, immutable/idempotent decisions, exact displayed-package binding, stale/source failure, CSRF/rebinding guards and safe rendering. Synthetic Chromium validation covers desktop/mobile reading, cancellation before commit, approval, reload, and literal rendering of hostile-looking source text. These verify mechanics and ergonomics, not semantic accuracy of a real proposer. Phase 5 provides the development proposal path below. Next is selecting/evaluating an actual proposer against source-grounded change distinctions; the production accepted-candidate producer remains unconnected.


## Phase 5 — Provider-neutral proposal → HUMAN review preparation

`lib/memory-storage/general-fact-proposer.js` adds the development transition-handler seam without connecting a model/provider or production candidate producer. It reuses the existing candidate/replay store and review backend. A developer explicitly supplies `proposeTransition(request)` and may register the returned review handler with the existing Storage Router; there is no automatic family registration, default model, semantic validator or approval fallback.

`buildGeneralFactProposalRequest` returns immutable `promptVersion`, `instructions` and canonical JSON `input` strings. The input includes the registered attribute contract and the complete integrity-checked replay package: candidate, target/current state, new/original support, history, counterevidence, unresolved candidates and original owning-source evidence. Source text and earlier proposals are evidence to inspect, not instructions to execute. The prompt distinguishes WORLD_UPDATE from CORRECTION, preserves unresolved/unsupported classifications, and prohibits selecting new target/value/family or granting mutation authority. This instantiates canonical §42.2 SI-5/SI-7/SI-10 and §42.4; prompt wording is not a semantic correctness guarantee.

Each explicit attempt calls the supplied proposer once. The callback returns a parsed proposal object or a complete JSON string with exactly `changeClass`, `transition`, `evidenceIds`, `rationale`. No fenced-output repair, field inference, retry, fallback or coercion is performed. Existing `normalizeProposal` and review creation validate the schema, source IDs (including incoming evidence), supported transition/target mapping and unchanged replay fingerprint. Success returns PENDING / HUMAN_REVIEW_REQUIRED with the persisted review identity/package hash; it never calls `decide` or `commit`. The existing development UI can display and decide that review. Already-committed candidates return their prior result without calling the proposer again.

Malformed/call-failed/unsupported/stale attempts preserve the bound candidate/evidence and old stable state. Valid unsupported proposals retain their actual classification as pending diagnostics. Callback failures use only PROPOSER_CALL_FAILED rather than persisting provider error bodies; malformed output is not persisted. No raw source replay copy is added to review rows. Existing HOLD/REJECT records remain immutable; a fresh proposal requires an explicit new attempt. The callback's transport, timeout, model/runtime contract and semantic evaluation are not implemented in this phase.

Synthetic SQLite/router/mock tests cover deterministic full replay input, all five executable transitions awaiting HUMAN approval, malformed output and binding/mapping failures, unsupported classifications, call failure without retry, source/replay changes, committed-candidate idempotency and explicit re-proposal after HOLD. These validate plumbing and mutation authority, not a model's ability to distinguish WORLD_UPDATE from CORRECTION. No new migration, Pi deployment, production input, network/model call or automatic approval is introduced. Next is choosing an actual proposer/runtime and evaluating source-grounded semantic judgments before connecting it.


## Phase 6 — Luna development proposer / synthetic smoke, 2026-09-30

Owner decision: start with `gpt-6-luna` / reasoning `medium` as the development semantic proposer; permit at most ten synthetic API calls to verify the connection. This does not select permanent production approval authority or close local-model alternatives. The existing HUMAN approval boundary and semantic/storage contracts are unchanged.

`lib/memory-storage/general-fact-openai.js` supplies `createOpenAIGeneralFactProposer({ apiKey })`, passed explicitly to `createGeneralFactReviewHandler`. Imports do not load credentials or dispatch requests. The existing OpenAI SDK makes Responses requests with fixed model `gpt-6-luna`, reasoning `medium` / `current_turn`, maximum output 4096, `store:false`, no tools or streaming, a 60-second timeout, and SDK/request `maxRetries:0`. The endpoint is fixed to the default OpenAI API; no production model selection, catalog refresh, current-context injection or fallback model is used. Optional `fetch` injection exists for SDK transport tests. Credentials and raw provider errors are never logged or persisted by the adapter.

The strict output JSON schema is generated from the existing core's change/transition vocabulary and exported as `GENERAL_FACT_PROPOSAL_SCHEMA`. It does not change the accepted proposal shape or semantic mappings. Existing `normalizeProposal` still verifies output locally, and the review backend still checks evidence/target/mapping/replay integrity. Non-completed, refusal, empty, malformed or call-failed responses fail closed without retry; the preparation handler records PROPOSER_CALL_FAILED for callback failures and preserves pending evidence/stable state. Strict JSON is shape enforcement, not proof of semantic support or authority to commit. See [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs) and [GPT-6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna).

### Observed synthetic smoke — eight planned, one-shot calls

All eight inputs were fixed before dispatch, in separate owner-private development DBs outside Git. Only authored synthetic owning-message text and replay packages were transmitted. Existing migrations were explicitly applied to these scratch fixtures, without a new migration or Pi/startup connection. Deterministic synthetic initial states were seeded before calls with SYNTHETIC_FIXTURE_SETUP_ONLY; these setup records are not HUMAN judgments or approved model outputs. The development DB privacy/schema validator accepted every fixture. Every resulting stable state/history and owning message remained unchanged after proposal processing.

| Authored scenario (not adjudicated gold) | Observed change class / transition | Preparation outcome |
| --- | --- | --- |
| Initial fact | null / CREATE | HUMAN_REVIEW_REQUIRED |
| Explicit device replacement | WORLD_UPDATE / SUPERSEDE | HUMAN_REVIEW_REQUIRED |
| Explicit earlier statement correction | CORRECTION / REVISE | HUMAN_REVIEW_REQUIRED |
| Retraction without replacement | CORRECTION / INVALIDATE | HUMAN_REVIEW_REQUIRED |
| Same device reaffirmed | ADDITIONAL_CONTEXT / NO_CHANGE | HUMAN_REVIEW_REQUIRED |
| Uncertain replacement vs correction relation | AMBIGUOUS / KEEP_AMBIGUOUS | UNSUPPORTED_TRANSITION / pending |
| Uncertain current device | AMBIGUOUS / KEEP_AMBIGUOUS | UNSUPPORTED_TRANSITION / pending |
| Extra device detail | EXPANSION / EXPAND | UNSUPPORTED_TRANSITION / pending |

Actual provider dispatches: **8**; completed responses: **8**; review-pending: **5**; unsupported-pending: **3**; other failures: **0**. No ninth/tenth call, retry, answer-based adjustment or model substitution occurred. Every response reported `gpt-6-luna`. Input tokens **17,245**, output tokens **2,287** (including **732** reasoning tokens). Observed per-call latency **3,099..4,174 ms**, median **3,512 ms**; this small local measurement is not a production latency/quality estimate.

The private plan, responses, development DBs and summary are retained at `/private/tmp/galpi-general-fact-luna-mRmA9s` (directories 0700, files 0600), outside Git. Plan SHA256: `75d9bc7e0186436994e9f80adf520b48ac6b869af0397ddbcbe6165f3d28c9f7`; summary SHA256: `97a76c682abdf651c7af32647a858d6da160dc11f0b636a55aba16772f269535`. Real HUMAN decisions **0**, model-derived state commits **0**, production DB/Vault/Pi reads/writes **0**. No production integration or schema change occurred.

SDK fetch-mock tests verify fixed request bytes/config, strict schema/local normalization, automatic retry disabled on HTTP/network/timeout failures, refusal/incomplete/empty/malformed responses, explicit-key/prompt requirements and the proposal→pending review/no-commit invariant. These are mechanics tests. The eight authored probes do not establish semantic accuracy, ambiguity calibration, robustness or automatic approval safety. Next is a separately designed source-grounded semantic evaluation and owner review of actual proposals; production ingress and automatic approval remain unconnected.


Validation: inspected latest-main baseline `1ef34bd26c0ab6e7d3d136e1c7441ceb938e2c02` and intervening lecture/documentation commits. Focused storage/SDK/review tests **84 PASS**. Full `npm test -- --test-concurrency=2`: **1,831 PASS / 2 FAIL / 3 SKIP**. Both failures are existing UI color assertions in `test/assistant-task-ui.test.js`, expecting pre-theme-change `#151A18` in `public/app.js` and `public/style.css`; running that untouched test separately reproduces them. They do not import the LTM adapter or storage modules, and no UI/test change is included in this LTM scope. `git diff --check` and AGENTS/CLAUDE body equality pass. Full-suite success is not claimed.

### Owner review follow-up — 2026-09-30

After the eight-call smoke, the owner used the existing development review UI to approve its five executable proposals: CREATE, SUPERSEDE, REVISE, INVALIDATE and NO_CHANGE. Backend integrity/transition-link checks independently verified all five durable APPROVE records; none remains an undecided review. These decisions authorize only their synthetic development states. The three unsupported proposals remain pending without owner approval. No proposer call or production integration was added during this review.

The original smoke plan/summary bytes and its generation-time HUMAN-decision count of zero are preserved. The later verification is retained privately at `/private/tmp/galpi-general-fact-luna-owner-review-verification.json`, SHA256 `1978670aee129217087664f68d12b1f9e8fb6f12fc888eb5764416a5c6b90259`. Five authored, explicit cases with owner approval do not establish population accuracy or automatic semantic approval safety.

### Six source-grounded follow-up probes — preregistered before calls

Owner authorization: continue using the same Luna development adapter for six additional synthetic cases, one attempt per case, at most six Responses calls, no retry or model substitution. Inspected latest-main baseline: `56e61fe7ea703da3edcd6cb1fbf9e923999e3634`; subsequent P1-B6 changes are outside this scope. Existing source-address, candidate, replay, snapshot and HUMAN-approval rules are unchanged. No new migration, attribute, transition implementation, production/Pi connection or evaluation framework is added.

All source texts, candidate values, replay requests and review criteria are fixed in an owner-private plan before the first call. Criteria are not provided to the model and are not HUMAN gold or a numeric pass/fail gate. Some probes deliberately supply a candidate value whose source support needs scrutiny: accepted ingress does not establish a claim's truth or permit state mutation.

| Probe | Source-grounded review criterion |
| --- | --- |
| Less explicit replacement | Ongoing replacement may preserve the previously valid claim as history; do not mark it as an earlier error without support. |
| Model-number/purchase-record check | A misidentified existing device supports correction, not an invented purchase/replacement. |
| Temporary loan | Preserve the temporary/contextual qualification; borrowed use does not justify an unqualified durable replacement. |
| Unexecuted purchase plan | A plan is not a realized current-device change; preserve the actual current state. |
| Unexplained current difference | A conflicting present claim does not by itself establish world update versus prior-claim correction; do not invent that relation. |
| Misattributed statement without replacement | Retract the misattributed claim without inventing a replacement or persisting null as a fact. |

Use separate private development DBs and the existing proposal/review path. Before any owner decision, every stable state/history and owning message must remain unchanged. Supported proposals may enter the existing owner review UI; unsupported ones preserve their actual classification as pending diagnostics. The owner supplies semantic judgments; code checks mechanics only. This is a small diagnostic follow-up, not a representative accuracy estimate or a prerequisite gate for canonical R2 implementation.

#### Observed follow-up — six calls, awaiting owner review

All six one-shot Responses calls completed and reported `gpt-6-luna`; all six proposals passed mechanical checks into HUMAN_REVIEW_REQUIRED, with no unsupported/call failures. Stable states, their histories and owning-message content remained unchanged. HUMAN decisions and model-derived state commits were **0 at preparation completion**. No retry, prompt adjustment, extra call or automatic approval occurred.

| Probe | Observed proposal, not a correctness judgment |
| --- | --- |
| Less explicit replacement | WORLD_UPDATE / SUPERSEDE |
| Model-number/purchase-record check | CORRECTION / REVISE |
| Temporary loan | ADDITIONAL_CONTEXT / NO_CHANGE |
| Unexecuted purchase plan | ADDITIONAL_CONTEXT / NO_CHANGE |
| Unexplained current difference | WORLD_UPDATE / SUPERSEDE |
| Misattributed statement without replacement | CORRECTION / INVALIDATE |

The unexplained-current-difference proposal needs particular owner scrutiny against the pre-call criterion: its source states a present device but does not explicitly establish how it relates to the prior claim. Mechanical acceptance does not resolve that semantic question. No automatic pass/fail count or accuracy estimate is assigned; the source and proposed rationale are shown through the unchanged review UI.

Private artifacts/development DBs: `/private/tmp/galpi-general-fact-luna-six-CIA9BP` (directories 0700, files 0600). Plan SHA256 `b89c6edd1d374157de095180543f976e0fa6b20b52fd5d0c039e8fc06f0f03b7`; summary SHA256 `3fb11a8344c3c6c171939ac777c393cc4b04c03e165163a6e29525eb63a12ea5`. Input tokens **13,611**, output tokens **2,495**, including **1,252** reasoning tokens. Production DB/Vault/Pi access and writes: **0**. A private exclusive dispatch marker prevents rerunning this six-call runner; each dispatch is durably marked before the SDK call. An interrupted/failed attempt is not automatically repeated.

Validation: existing registry/router/General Fact/proposer/SDK/UI focused tests **93 PASS**; every new development review passed integrity/snapshot validation with its original stable revision unchanged. This follow-up changes documentation/current-state pointers only; no module/test/schema/production code changed. Full `npm test` was not repeated for these documentation-only changes; the earlier full-suite failures above remain historical observations. `git diff --check` and AGENTS/CLAUDE body equality pass. Next is owner review of these six proposals, starting with the unspecified change relation, before any further integration or approval-policy decision.

#### Owner review completed — six follow-up cases, 2026-09-30

The owner submitted all six judgments through the unchanged development UI: **5 APPROVE / 1 REJECT_PROPOSAL / 0 HOLD**. The unexplained-current-difference SUPERSEDE proposal was rejected; its prior stable state remains unchanged and its candidate/evidence remains pending. The other five proposals were approved: SUPERSEDE, REVISE, two NO_CHANGE decisions and INVALIDATE. Backend verification checked each immutable decision/transition link and the resulting state. The two NO_CHANGE commits add no fact state; INVALIDATE leaves no current value and does not store null as a fact. Owning-message content is unchanged throughout.

Private verification: `/private/tmp/galpi-general-fact-luna-six-CIA9BP/owner-review-verification.json`, SHA256 `01ae03f5080a68c9e1ba18e6816f749698df3f7496bb301faf15219450286a01`. The earlier plan/summary and their preparation-time zero-HUMAN-decision facts remain unchanged. No additional API call, retry, automatic approval or production DB/Vault/Pi access occurred; the review server was stopped after completion.

The rejected case is one concrete development concern: a mechanically valid proposal chose WORLD_UPDATE without an explicit source-grounded relation to the prior claim. This owner decision is not a representative accuracy estimate, an independent model evaluation, or a new semantic rule for all later claims. Handling such unspecified relations remains an implementation issue for further discussion; no prompt or semantic contract was changed here. Production ingress and automatic semantic approval remain unconnected/open.

Recording baseline `ba71d5655e2ddcbcb8cf4a9a92cc4997b4589f10` includes the separate P1-B6 batch-005 top-up, preserved unchanged. This completion record changes only this document and the matching AGENTS/CLAUDE current-state line. Decision effects and source integrity were checked against all six private development DBs; `git diff --check` and AGENTS/CLAUDE body equality pass. Existing focused-test results above remain historical; no full test suite is claimed for this documentation-only follow-up.

#### Preservation clarification and owner reconsideration — 2026-09-30

Following clarification of SUPERSEDE, the owner reconsidered the unexplained-current-difference rejection and requested a correction. Both values and their owning-source evidence are preserved: the new value becomes current, and the previous value remains historical. SINGLE restricts the current slot, not the number of historical states. CORRECTION also retains the earlier claim/evidence, with corrected epistemic status rather than valid previous-world history. These are existing canonical §42.2 SI-12 and family contracts, not new storage semantics.

The source's present-time qualification (`요즘`) and ongoing use can support the model's WORLD_UPDATE interpretation without an explicit replacement verb. The earlier development concern must therefore not be treated as an established model error or as a general requirement for explicit change wording. This reconsideration is specific to the reviewed source/proposal; it does not create an always-prefer-latest rule, automatic approval authority, or a semantic accuracy estimate. The original six-call outputs and first-pass **5 APPROVE / 1 REJECT_PROPOSAL** remain historical records.

Submitted review decisions remain immutable. The existing rejection was not edited; the same proposal and integrity-checked replay were explicitly used to create a new pending review through the existing backend, with identical package/proposal hashes. No new model call or state transition occurred during preparation. The owner must submit the fresh review's decision through the development UI before commit. Private preparation record: `/private/tmp/galpi-general-fact-luna-six-CIA9BP/unexplained-current-difference/owner-reconsideration-preparation.json`, SHA256 `cd2678cbff00499709ee2a279a2775d69a3eef5f550f7d87638e6e5f32e03bb3`.

The UI now names the before/after values explicitly as **current** values. SUPERSEDE displays and repeats in its approval confirmation that the old value/source evidence is preserved as history, not deleted or judged erroneous. No source/storage/proposer behavior, schema, prompt, production/Pi integration or review immutability rule changed. Regression checks exercise the rendered explanation/confirmation and a new review after REJECT_PROPOSAL preserving its previous decision.

Validation at baseline `08fd47d9c477ee3d6391ebd2ef59a0772f51b1ee`: focused storage/proposer/SDK/review/UI **95 PASS**; full `npm test -- --test-concurrency=2` **1,842 PASS / 2 FAIL / 3 SKIP**. Both failures are the existing schedule UI color assertions in `test/assistant-task-ui.test.js` already identified above; that test and production UI files are unchanged in this scope. Localhost HTTP startup, the reopened exact review package, `git diff --check` and AGENTS/CLAUDE body equality pass. Full-suite success is not claimed. The concurrent P1-B6 source-audit packet commit `99328e4` is preserved separately during integration.

#### Reconsidered owner review completed — 2026-09-30

The owner submitted APPROVE for the fresh unexplained-current-difference review through the UI. Integrity checks confirm the same replay/proposal/package hashes as the original attempt, a linked SUPERSEDE transition at revision 2, **M5 MacBook Air CURRENT** and **Intel MacBook Pro HISTORICAL**, with both source messages unchanged. The original REJECT_PROPOSAL and its first-pass verification remain intact. Each of the six follow-up cases now has one approved transition and no undecided review; there are seven immutable review decisions across those six cases, not seven independent cases. This closes the reconsideration without altering the original outputs or claiming a model accuracy rate.

Private verification: `/private/tmp/galpi-general-fact-luna-six-CIA9BP/unexplained-current-difference/owner-reconsideration-verification.json`, SHA256 `47557577c8e6ef2ba2697098c60efdc1bed3b3296df00e626f8ad4d42cefef35`. Additional API calls **0**, production DB/Vault/Pi access/writes **0**; the development review server was stopped. At recording baseline `f46b3894876d188debae3c76356f805af4ec6682`, only this completion record and matching AGENTS/CLAUDE pointers change. Existing test results above remain historical; this documentation-only completion did not rerun the full suite. `git diff --check` and body equality pass. Production candidate ingress, automatic semantic approval and local-model selection remain unconnected/open; no next implementation contract is selected by this small review.


## Phase 7 — Explicit development candidate preparation command, 2026-10-01

`lib/memory-storage/prepare-general-fact-review.js` connects the existing Router, verified replay, Luna adapter and HUMAN review backend. It accepts one already-accepted candidate JSON and an existing private development DB. It does not discover/extract/triage candidates, insert owning messages, create a DB, run migrations, or connect production/Pi/chat. The candidate shape remains Phase 1's schemaVersion/semanticFamily/payload/sources contract; General Fact supports only USER/primary_laptop under the existing family rules. An operator must prepare the accepted candidate and owning messages separately.

```bash
npm run prepare:memory-general-fact -- \
  --development-db /private/path/general-fact-development.db \
  --candidate /private/path/accepted-candidate.json

npm run review:memory-general-fact -- \
  --development-db /private/path/general-fact-development.db
```

Both files must be owner-private, outside the repository and production directory, with parent directory 0700 and regular single-link file 0600. The DB uses the existing UI validator and must contain only the expected development source/storage/review tables. Candidate JSON is validated without repair. The CLI reads the repository `.env` with process-environment overrides only for this explicit invocation; missing credentials or a nonempty OPENAI_BASE_URL fail before source binding/provider dispatch. Credentials, source text, values and proposal rationale are not printed. Success output contains only status, identifiers and integrity hashes; failures print a diagnostic code without raw provider errors or stack traces.

Each explicit pending-candidate invocation makes at most one existing `gpt-6-luna` proposal call, with the unchanged Phase-6 request configuration and no automatic retry/fallback. A supported proposal becomes a pending HUMAN review, never an automatic state commit. Unsupported/malformed/failing proposals retain pending evidence under the existing handler semantics. A previously committed candidate returns its existing result without a model call; explicitly invoking an uncommitted candidate again is a new proposal attempt, not an automatic retry. The command closes its DB on success/failure. The existing UI is still required to approve/hold/reject. Later proposals against the same development DB replay its committed current state, original support and history, consistent with canonical §42.2 SI-7/SI-10/SI-12 and §42.4.

Validation at baseline `a2be3ae` uses only synthetic development DBs and injected proposal callbacks: focused registry/router/storage/proposer/SDK/UI/command tests **101 PASS**. Full `npm test -- --test-concurrency=2`: **1,858 PASS / 2 FAIL / 3 SKIP** (1,863 tests). Both failures remain the existing schedule UI color assertions in `test/assistant-task-ui.test.js`; no production UI change belongs to this command. Tests cover one-call/no-commit preparation, independent source resolution, invalid/private/schema boundaries, credentials/custom endpoint rejection, sanitized CLI output, committed-candidate idempotency and subsequent replay of the approved state/support. Actual API calls in this implementation validation **0**; production DB/Vault/Pi access/mutation **0**; no new schema. `git diff --check` and matching AGENTS/CLAUDE bodies pass. Production accepted-candidate ingress and automatic semantic approval remain unconnected/open.


### First explicit command execution — synthetic reaffirmation, 2026-10-01

At baseline `a110f000496dd231bd613c433504dddcea6f2e11`, the owner authorized using the development command. An SQLite read-only backup of the previously owner-approved synthetic unexplained-current-difference DB seeded a new private fixture. Original DB/WAL/SHM fingerprints remained unchanged. Copied historical HUMAN decisions are inherited records, not new judgments. One authored synthetic reaffirmation source and accepted USER/primary_laptop candidate were added only to the copy; no new migration, owning-source adapter or production input was used.

The plan and candidate bytes were recorded before one explicit `npm run prepare:memory-general-fact` invocation. Actual Luna proposal calls **1**, retries **0**: `ADDITIONAL_CONTEXT / NO_CHANGE`, registered as one pending HUMAN review. This observed proposal is not a correctness judgment. Stable current state/history, all pre-call owning-message rows, and inherited review decisions remain unchanged; new HUMAN decisions/state commits **0**. The initial whole-target hash check included unresolved candidates and therefore changed on expected candidate registration; subsequent verification separately matched stable state/history against the unchanged source DB and checked exactly one new unresolved candidate. The plan was not rewritten.

Private directory: `/private/tmp/galpi-general-fact-command-nYnVkb` (0700; candidate/plan/result/summary/DB 0600). Plan SHA256 `9dc8b8d07a33b9fe7b2dc0ec70eceddf13b40429d0a6f4a16aaf86719288047d`; summary SHA256 `42c5b0eeca68af1401674b1128d73ddfd3af817569875985c19aaa852ad375e4`. The development UI at `http://127.0.0.1:8766` awaits the owner's decision against that DB. The command's six focused tests pass; this follow-up changes documentation only and does not claim a new full-suite run. Production DB/Vault/Pi access/mutation **0**. Prior implementation CI run `36736120145` was directly observed as completed/failure, separately from the local test results above.


#### First explicit command owner review completed — 2026-10-01

The owner submitted APPROVE for the exact pending `ADDITIONAL_CONTEXT / NO_CHANGE` review. Backend integrity checks verified the original package hash and linked transition at revision 3. The current state, both existing fact states and the original two-transition history remain unchanged; NO_CHANGE adds its judgment/evidence transition without creating a new fact state. Owning-message bytes and the source development DB/WAL/SHM fingerprints are unchanged. New owner decisions **1**; pending reviews **0**. This closes the single synthetic command/UI exercise, not semantic accuracy validation or production ingress.

Private verification: `/private/tmp/galpi-general-fact-command-nYnVkb/owner-review-verification.json`, SHA256 `aa13a3d264b24f33b1d5952d792dddc69366486a80b4de8981a20faef16d5b60`. The pre-call plan and preparation-time summary remain intact. Additional API calls **0**; production DB/Vault/Pi access/mutation **0**. The development review server was stopped. This is a documentation-only completion at baseline `655eb3b2f0a630db736e303796b0a8769c6a5d53`; no new full-suite run is claimed. `git diff --check` and AGENTS/CLAUDE body equality pass.


## Phase 8 — Manual development candidate-input UI, 2026-10-01

The owner approved a form on the existing development review server for directly entering a user-source text and an already-accepted General Fact candidate. Enable it explicitly:

```bash
npm run review:memory-general-fact -- \
  --development-db /private/path/general-fact-development.db --candidate-input
```

Without the flag, the review server retains its no-model/no-candidate-producer behavior. With it, `lib/memory-storage/candidate-input.js` reuses core normalization, the EvidenceRef registry, Router, verified replay and existing one-shot Luna proposer/review backend. The operator supplies the accepted candidate manually; this does not implement Bundle Builder, Ambiguity/Escalation, Durability or Extractor. Only USER, registered SINGLE attributes (currently primary_laptop) and existing string/null candidate semantics are accepted. No transition/class is selected upstream, no attribute is invented and no approval is inferred from valid input.

Confirmation names the OpenAI transmission and distinguishes proposal preparation from fact approval. The exact input text is inserted as a new user message in the private development owning-source table, then bound to the candidate/EvidenceRef in one preflight transaction before dispatch. Its timestamp records development message insertion, not reconstructed historical authorship or adopted dual-time semantics. Invalid input/preflight rolls back without a source orphan or model call. A durable submission UUID in the development message session identity rejects duplicate POSTs across restart; interrupted dispatch is not automatically retried. A single in-process preparation lock rejects parallel inputs before writes. This is one localhost writer, not a multi-process ingress protocol. Model failures and unsupported proposals preserve pending source/candidate data under the existing fail-close contract; a fresh attempt requires explicit operator action.

The form uses the registered attribute contract, preserves raw strings and supports no-replacement review candidates. It disables submitted fields, exposes no raw credentials/provider errors, and shows the resulting proposal through the unchanged source-grounded HUMAN review flow. Approve/hold/reject and exact displayed-package binding remain separate. Existing localhost-only binding, origin/token checks, safe text rendering, no-store/CSP and decision-body limits remain; input POST is bounded to 32 KiB with source text limited to 8,000 JS characters. Credentials/default-endpoint validation is reused from the preparation CLI only when the flag is present. No model call occurs on page load/reload or server startup; no auto-save/production route is connected.

At implementation baseline `d9f6ffc2d274bacb100d42a503bf6c2e6500cbc8`, focused storage/SDK/CLI/UI tests **107 PASS**. Final local `npm test -- --test-concurrency=2`: **1,876 PASS / 2 FAIL / 3 SKIP** (1,881 tests); both failures remain the existing schedule UI color assertions in `test/assistant-task-ui.test.js`. Concurrent lecture work is separate and excluded from this change. Synthetic Chrome checks verify confirmation cancellation makes zero calls, one mock proposal creates an undecided review, separate test approval is needed for state creation, literal source rendering, desktop/mobile reading without overflow, null-field controls, reload and no browser errors. These mock/test decisions are not owner semantic judgments. Actual external API calls during implementation validation **0**, production DB/Vault/Pi access/mutation **0**, migrations/new dependencies **0**. `git diff --check` and matching AGENTS/CLAUDE bodies pass.

An owner-controlled UI DB is a read-only backup of the completed synthetic command fixture at `/private/tmp/galpi-general-fact-manual-ui-h6fg18/general-fact-development.db` (directory 0700, DB/provenance 0600). Source DB/WAL/SHM fingerprints are unchanged; copied historical decisions are not new judgments. It starts with zero pending reviews. Earlier frozen plans/results/reviews remain intact. This is a manual development ingress, not completed production local-memory integration or automatic semantic approval.

### Unsupported proposal presentation correction — 2026-10-01

During manual input at baseline `5f960439a83236e8e9c6b3709b8527209a9005ea`, the development DB retained a pending `AMBIGUOUS / KEEP_AMBIGUOUS` proposal with `UNSUPPORTED_TRANSITION`. The one-shot proposer returned a proposal; the existing v1 transition boundary prevented HUMAN review-card creation. The UI had misleadingly collapsed this expected unsupported/pending outcome into a generic open/save error. It now preserves the safe response code and explains that source/candidate/proposal remain pending, the current fact is unchanged, and no review card or automatic retry is created. No semantic correctness judgment, supported-transition expansion, state mutation, provider retry or new API call is performed by this correction. A synthetic HTTP/frontend regression verifies the message, retained proposal, unchanged state and one-call behavior.

Validation: focused storage/SDK/CLI/UI tests **108 PASS** (UI **17 PASS**); synthetic mobile Chrome smoke confirms the hold message and disabled repeat submission. The development server was restarted, with identical logical content fingerprints for all source/candidate/proposal/state/review rows before/after; no existing input was resubmitted. Actual external API calls by this correction **0**. `git diff --check` passes; no full-suite rerun is claimed for this presentation-only correction. Previous full-suite results above remain historical.


## Phase 9 — Explicit local Qwen development proposer, 2026-10-01

Owner decision: try the already-installed Qwen3-4B family locally, using Q4_K_M rather than BF16 to reduce the MacBook memory burden. This selects a development probe, not production semantic authority or automatic approval. The existing source-grounded replay, supported-transition boundaries, pending preservation and separate owner HUMAN approval remain unchanged.

`lib/memory-storage/general-fact-qwen.js` reuses the existing proposal schema and `normalizeProposal`. It makes one Chat Completions request to fixed `http://127.0.0.1:18767/v1/chat/completions`, alias `qwen3-4b-q4-k-m`, non-streaming, thinking disabled, temperature 0.7 / top-p 0.8, output limit 1,024 and timeout 15 minutes. Original instructions and full verified replay are supplied unchanged. There are no credentials, redirects, external endpoints, tools, retry, JSON repair, provider fallback or commit. HTTP/network failure, model mismatch, incomplete/empty output and invalid proposals fail closed. Schema-constrained output validates shape, not semantic judgment.

The existing review command gains an explicit optional selection:

```sh
npm run review:memory-general-fact -- --development-db <private-dir>/general-fact-development.db --candidate-input --proposer qwen
```

Without the selection, candidate input retains Luna behavior; without candidate input, the review server still makes no model calls. Qwen startup does not load `.env` or OpenAI settings. The input form names its configured provider and explains local processing time and the unchanged separate approval. The existing preparation CLI remains Luna-only.

The model is `unsloth/Qwen3-4B-GGUF`, revision `22c9fc8a8c7700b76a1789366280a6a5a1ad1120`, `Qwen3-4B-Q4_K_M.gguf`, 2,497,281,312 bytes, verified SHA256 `f6f851777709861056efcdad3af01da38b31223a3ba26e61a4f8bf3a2195813a`. It is cached outside Git under `~/.cache/galpi-models/`. The retained llama.cpp binary is commit `e42214804794fca6abb61b1a5f9adae2a845f0be` / build 10702. Initial server settings are localhost-only port 18767, CPU generation/batch threads 2, one slot, 4,096-token context, GPU layers 0, batch 256 / microbatch 128, thinking off, web UI off and CORS limited to localhost. These are low-load development settings, not a production latency claim. No BF16 file or previous study protocol was changed.

### Observed connection checks

A short synthetic JSON test passed; model load took 30.38 seconds, request 15.30 seconds, sampled peak process RSS 4,801.8 MiB. A separate source-grounded General Fact scratch case then made one local model call in 170.917 seconds. It returned a structurally valid `EXPANSION / EXPAND` proposal for an initial-formation input; the existing unsupported-transition guard retained it pending with `UNSUPPORTED_TRANSITION`, with zero owner judgments and zero derived-state commits. This verifies the transport and fail-close plumbing; it does not establish acceptable semantic performance. The proposal was neither changed into CREATE nor approved by the agent.

The existing Luna development replay measured 12,732 tokens before chat-template overhead, so it cannot fit the initial 4,096-token server. Evidence/history is not truncated to make it fit. A separate empty private Qwen development DB is prepared for the small-input workflow while all Luna records remain intact; its first input begins with no current fact. Context growth beyond server capacity must fail closed, not silently replace full replay with a summary. Using the larger retained history requires an explicitly larger runtime context and a separate memory/latency check.

Validation at baseline `63e5524ed0815137a7d1903007c5a278a264891f`: initial focused storage/router/proposer/SDK/UI tests **123 PASS**; subsequent Qwen/UI tests, including no-OpenAI-config startup, **33 PASS**; final complete focused run **124 PASS**. Full `npm test -- --test-concurrency=2` on the shared working tree: **1,893 PASS / 2 FAIL / 3 SKIP** (1,898 tests); both failures are the pre-existing schedule UI color assertions in `test/assistant-task-ui.test.js`. The later startup test is covered by the subsequent focused run. No unrelated lecture code was changed by this task. Live HTTP checks confirm Qwen input mode and model health without a user submission; browser automation is unavailable in this session, so real-browser pixel validation is not claimed. External API calls **0**, production DB/Vault/Pi access/mutation **0**, schema changes **0**, agent approvals **0**. Next is owner review of actual Qwen proposals, with semantic quality still open.


### Transition-target blocker presentation / first-formation inspection — 2026-10-01

At baseline `df4ac4ea2a5c3cc81beaf7f11e99fd710fda4d4e`, the first owner-submitted Qwen input had no current fact. Its proposal combined `EXPANSION / SUPERSEDE`; `checkTransition` rejected it as `INVALID_TRANSITION_TARGET` before review-card creation. Source, candidate and proposal remain pending; there is no state/provenance commit. The UI had displayed this mechanical guard rejection as a generic open/save error. It now explains the target/class mismatch and pending preservation for both Luna and Qwen, while retaining the existing unsupported-transition explanation. No classification or proposal is rewritten.

Inspection confirmed that the original request instructions already specify `CREATE / changeClass=null` for justified first formation and prohibit automatic CREATE merely because current state is absent. The existing Qwen adapter supplies those instructions and the full replay unchanged. Therefore this observation cannot be treated as a missing-instruction or connection failure, or as proof that schema-valid output validates semantic judgment. No prompt, model configuration, validation/approval rule or supported-transition set was changed, and no model retry/re-proposal was made. Semantic proposer improvement remains a separate next task.

Validation: synthetic HTTP/frontend reproduction first fails on both providers, then the complete storage/proposer/SDK/UI focused set passes **126/126**. Checks cover the displayed cause, original retained proposal, unchanged stable state, absent review card and no repeated submission. Development UI restart preserves the logical content hash of every source/candidate/state/transition/evidence/review row, and model dispatch-log count is unchanged. Additional model/external API calls **0**; production/Pi access **0**. `git diff --check` and AGENTS/CLAUDE body equality pass. Full-suite testing was not repeated for this presentation-only change; the Phase-9 full-suite result above remains the last local full run. Browser automation remains unavailable; synthetic frontend validation and localhost script/config checks are used, without submitting the owner's input again.


### Current Qwen probe paused / Luna development restored — 2026-10-01

After the transition-target failure, the repository owner paused adoption of the current Qwen3-4B Q4_K_M non-thinking configuration. This is a narrow development suitability decision, not an accuracy estimate or a conclusion about every 4B/quantized/local model. The local model process was stopped to release its memory, and the review UI returned to the retained Luna development DB. Model files, Qwen source/candidate/proposal records and the local adapter remain preserved. No failed proposal was repaired, retried or approved; restoring the UI dispatched no new model call. Current development continues with Luna under the same HUMAN approval boundary; local-model alternatives remain OPEN as separate evaluations.

## Phase 10 — Development Evidence Bundle Builder, 2026-10-01

Owner decision: implement the formation front-end's Bundle Builder while the separate local-memory track develops ambiguity inference. Use accumulated conversation as private development material; permit one Luna call on one source episode fixed before dispatch. This does not connect the ambiguity specialist, Durability, Extractor or Storage Router, and does not modify the P1-B6 corpus, labels or study protocol.

### Current user-centered scope / one-bundle boundary — 2026-10-01

After the initial probe, the owner clarified the current formation contract:
**one anchor ↔ one evaluation bundle → one logical storage candidate**, if the
ambiguity, durability and extraction gates pass. An episode may yield multiple
independently anchored bundles that reuse evidence; a bundle's judgment does not
authorize extraction/storage of other independently judged facts. This is not a
one-SQL-row constraint or a change to Derived State → 0..N Projections.

TARGET judgment concerns the user's own state, stance, plan or relationship.
An acquaintance's reported statement being clear does not make the user's
adoption of it clear. The owner's early-meeting example is ESCALATE for the
user's stance, whereas the cheaper-place example gives a CLEAR user visit plan.
A missing adoption statement is not automatically a denial or an explicitly
undecided user state. CLEAR still does not mean WRITE, and a remembered plan
does not confer authority to create a task/reminder.

Do not discover/store acquaintances' statements or personal states as standalone
memory candidates in the current implementation. Preserve their words in source
evidence/context when needed; do not strip them from the episode. User-involving
relationships remain eligible for candidate discovery, subject to later gates.
No Relationship handler or arbitrary-entity identity resolver is opened here;
the existing General Fact implementation remains within its registered v1 scope.

The development request is now versioned
`memory-evidence-bundle-selection-user-centered-v1`; the adapter rejects the old
request version before dispatch. Its prompt carries these scope rules without
adding interpreted propositions or judgment labels to the selection schema.
Mechanical validation cannot prove user-centered semantic compliance; results
remain NOT_VALIDATED. Ambiguity, Durability, Extractor and production storage are
still unconnected. No new model call or reclassification of the retained eight
bundles is performed. The initial probe below retains its exact original bytes
and request hash. The [local-memory design clarification](../local-memory-inference/local-memory-inference-p1b6-design.md#user-centered-target-clarification--2026-10-01)
records the distinction from the frozen v3 catalog; no research labels change.

Validation: Bundle Builder/adapter focused tests **19/19 PASS**, including full
source preservation, the new prompt contract and rejection of the old request
version before dispatch. `git diff --check` and AGENTS/CLAUDE body equality pass.
These checks do not establish semantic model quality. The full suite was not
repeated for this prompt/document change; the initial probe's full-suite result
below remains historical. New external/model calls and storage commits: **0**.

### Current independent-target granularity — 2026-10-01

Further owner clarification: **anchor = adjudication target = storage target**.
These identify the same user-centered semantic item across stages; the
Extractor changes its representation, not its identity or scope. A bundle
contains one such target, and only that target can proceed to storage after its
own gates. Evidence may mention other targets without authorizing their storage.

The former broad-topic merge rule is superseded for the development Builder.
Independent user states require separate anchors/bundles even within one topic,
turn or sentence. In the housing example, search status, lease-choice status,
budget, university and walking-distance preference are separate targets. Their
source evidence may overlap. Conditions, exceptions and corrections that
determine one target's meaning remain its evidence; they must not be discarded
or promoted into unrelated claims. This is not keyword-level splitting.

The current request is `memory-evidence-bundle-selection-user-state-v1`, with the
same source/selection schema. Earlier request versions fail before dispatch.
The whole-message evidence view contains exactly one TARGET marker per bundle;
another bundle can mark another occurrence in that same source message. No
interpreted claim value, storage attribute/family, ambiguity verdict or WRITE
decision is produced by discovery. Prompt compliance remains a semantic question.

This development clarification does not edit the separate, now-frozen P1-B6 v4
catalog, dataset, labels or review protocol. The original eight- and six-bundle
probe artifacts below remain immutable historical attempts, not approved
examples of this latest granularity.

Owner-approved next probe: first freeze five operator-authored housing reference
bundles from the same retained 30-message episode, then make one Luna discovery
call on that episode under the new request. The reference covers these five
targets only; it is not an exhaustive episode gold set and has no CLEAR/ESCALATE
or WRITE labels. Compare raw anchor/evidence selections and preserve any defect;
no retry or storage execution. Local-model comparison remains a later phase.

Pre-dispatch validation: Builder/adapter tests **20/20 PASS**; complete focused
storage/router/proposer/review set **146/146 PASS**. The same-message regression
checks distinct bundle identities, shared evidence and one marker per rendered
view, not semantic model quality. Full-suite testing is not repeated for this
prompt-only implementation change. `git diff --check` and handoff-body equality
pass; no study fixtures or storage schema change.

### Existing development mechanics and initial probe

`lib/memory-storage/bundle-builder.js` reads an explicitly selected inclusive message range in one session from a `readonly:true` / `query_only=ON` connection and a single SQLite read transaction. Ordering is the current conversation ordering `(created_at, id)`, including same-second ID tie-breaking. Both endpoints must exist in that session; other sessions and messages after the endpoint are excluded. No automatic session/topic segmentation, semantic search, DB migration, evidence registration or state write is performed. Message text is preserved verbatim, including multiline content, and roles remain explicit. Source timestamps are metadata, not adoption of §54.4.

The private development episode has schema version 1, `sourceDomain: conversation_message`, session/range identities and ordered turns with message IDs, timestamps, roles and original text. This is a development source snapshot, not a new owning store or canonical production episode/address schema. `freeze:memory-source-episode` writes canonical JSON only to an owner-private directory outside Git; files are created exclusively with mode 0600 and fsynced. Existing freezes are not overwritten. Episode length, automatic boundaries and retrieval of context outside the declared episode remain OPEN.

The provider-neutral `discoverEvidenceBundles(episode, selectBundles)` supplies the full frozen episode to one explicitly provided selector. Its output is only `{bundles: [{anchor: {turnId, text}, evidenceTurnIds}]}`. The first development selection granularity is whole messages; proper subranges remain a later extension. An anchor must be one unique verbatim occurrence in a selected turn; ambiguous occurrence locations fail closed rather than choosing the first. Source text containing reserved TARGET marker syntax also fails closed. No generated topic label, resolved referent, family, attribute, value, ambiguity label, durability verdict or transition is accepted from this step.

The initial-probe prompt followed P1-B6's coarse-topic Candidate Granularity / Evidence Bundle Builder / Anchors contracts: use the coarsest coherent independently adjudicable topic/state/decision thread; keep its conditions, exceptions and unresolved parts together; merge uncertain boundaries; select one source-grounded representative anchor. That broad merge instruction is superseded for the current development Builder by the independent-target clarification above. A source episode may yield 0..N bundles and independent bundles may share source turns. Zero discovered bundles does not constitute NO_WRITE. Assistant statements remain attributed conversation evidence, not automatically user facts or independent support.

Mechanical validation rejects nonexistent/duplicate evidence IDs, an unselected/invented/repeated anchor, malformed output and exact duplicate bundles. Selected turns are canonically ordered, UTF-8 anchor offsets are computed from the actual source, and existing pure P1-B6 `decodeSpan` / `computeFragments` helpers are reused without invoking research corpus validation or importing labels/splits. Visible text uses role prefixes, one `[TARGET]...[/TARGET]` pair and `\n---\n` between disjoint selected regions. Private result IDs/hashes are deterministic for the same source and selection. Discovery and evidence completeness are semantic questions: results explicitly remain `semanticCompleteness: NOT_VALIDATED`. Selection omission must not be relabeled as legitimate ambiguity.

`lib/memory-storage/bundle-openai.js` is the explicitly invoked development selector: fixed `gpt-6-luna`, Responses API, reasoning `medium/current_turn`, max output 4096, `store:false`, no tools/streaming, default OpenAI endpoint, 60-second timeout and SDK/request `maxRetries:0`. Import/startup does not read credentials or call a model. `build:memory-bundles` requires the private episode's expected raw SHA256 before dispatch. It durably creates an exclusive private attempt record first; existing/failed/orphaned attempts at that output path cannot be dispatched again. Output is strictly schema-checked and source-bound, without JSON repair or fallback. This is not semantic approval or source/bundle audit PASS.

### Fixed one-episode probe — before dispatch

Implementation baseline: `a4caee6638e92cd294fe902fe26f31cd72bc9313`. Read-only Pi inventory found 1,575 messages in `shared-main`; `query_only=1`, `total_changes=0`, and DB/WAL/SHM SHA256 fingerprints matched before/after inspection. The operator chose the latest 30 messages as one bounded development fixture, fixed to message IDs **1706–1735**, before any model call. This is not an automatic production episode policy or a claim that earlier context is unnecessary.

Private directory: `/private/tmp/galpi-bundle-builder-lip_s6c5` (0700). `episode.json` raw SHA256: `553759bb83a6144caf096af8a2716ceb3d6cd0ee94d83b43e49a930a9585760e`; frozen `selection-request.json` SHA256: `d0d6c33d648b0fa59580ddf5254108fbb4c2d325a2ecf80d5f10398c7a424983`. The episode and request validate; the complete request input is 10,196 UTF-8 bytes. Source/provenance files are private 0600. DB/WAL/SHM fingerprints also matched before/after this export; Vault was not read or written. No raw conversation or proposed bundle is committed. Planned model calls **1**; no retry, other episode, downstream classification or state commit is authorized by this probe.

Pre-dispatch validation: new bundle tests **17/17 PASS**; complete focused storage/proposer/review/bundle set **143/143 PASS**. Local `npm test -- --test-concurrency=2` on the shared working tree: **1,921 PASS / 2 FAIL / 3 SKIP** (1,926 tests). Both failures remain the existing dark-theme color assertions in `test/assistant-task-ui.test.js`; concurrent lecture changes are excluded from this commit. An initial sandbox run of the wider focused set could not bind localhost; the authorized localhost-enabled rerun passed. `git diff --check` passes. These synthetic tests verify mechanics and fail-closed paths, not semantic candidate granularity or evidence completeness.

### Observed one-episode probe

Execution code commit: `0791e4c`. The pre-dispatch private plan recorded the code hashes, frozen input/request hashes, fixed model/config and one-call budget. The owner-authorized call completed with **1 provider dispatch / 0 retries**, reported model `gpt-6-luna`, and produced **8 bundles**. All eight passed mechanical source/anchor/reference validation; selected message counts were **2 / 4 / 2 / 2 / 2 / 2 / 12 / 2**, with one contiguous fragment per bundle. These counts do not establish correct topic separation, complete evidence selection or a memory-quality result. All results remain **NOT_VALIDATED** for semantic completeness; no source/bundle audit or owner semantic review occurred in this probe.

Observed request usage: 3,461 input tokens / 1,279 output tokens (855 reasoning tokens), 4,740 total; elapsed 12,980 ms for this single local probe, not a production performance estimate. The private `bundles.json` SHA256 is `1b78b348b736caca26142034283c8eda3056b454d655fa4f533e3c97b16cb5cf`; raw `provider-response.json` SHA256 is `d01ae457e4b67d3a4299a8d5762e667ed8e39ea0b0c2d4f98eb5fd83c9b11829`; `probe-summary.json` SHA256 is `482638d7eae4074cd9073d21535a63c252190fb1ca4fcf55cd855c151d4fab10`. All are 0600 under the same 0700 private directory outside Git. Rebuilding from the frozen source and retained selection produced byte-identical bundle output with **0 additional calls**.

Production DB writes, Vault reads/writes, migrations, Pi deployment/restart, EvidenceRef registrations, derived-state commits and downstream ambiguity/durability/extraction judgments were all **0**. Generation used the already-frozen local episode and did not reread production inputs. Next: review candidate granularity and source/bundle completeness against this full episode before feeding any bundle into the ambiguity path; episode-boundary adequacy and selection quality remain OPEN.

### Same-episode user-centered discovery probe — 2026-10-01

The owner authorized one additional Luna discovery call using the same retained
episode bytes and the new user-centered request. Execution code commit:
`c3c32fb`; episode SHA256 remains
`553759bb83a6144caf096af8a2716ceb3d6cd0ee94d83b43e49a930a9585760e`.
The previous request/result were not overwritten. Before dispatch, a new request
and one-call plan were frozen under
`/private/tmp/galpi-bundle-user-centered-z2u43qpi` (0700; files 0600).
Request SHA256:
`896029fc55c790b3fac80ee84740b55ac1db113781f9cfc03ee00385915deb51`.

Observed: **1 completed provider dispatch / 0 retries**, `gpt-6-luna`, **6
bundles**, selected-turn counts **1 / 1 / 1 / 1 / 9 / 1**, fragment counts
**1 / 1 / 1 / 1 / 3 / 1**. Input/output tokens: **3,594 / 1,544** (1,193
reasoning), total **5,138**; elapsed **15,546 ms** for this probe. Bundle SHA256:
`1425873c20f79839759406d06dd0b11570748b59560ab73c657b379a8bd99596`;
retained provider-response SHA256:
`824e005739eb451d8e8bf0d934eca6a6aea7207cba3528e34ab5ec5a58d842c4`.
Rebuilding from retained source/selection was byte-identical, with no new calls.

All six pass mechanical source/anchor validation and remain **NOT_VALIDATED**.
Operator comparison flags evidence-completeness concerns in the third and
fourth bundles: their one-turn selections omit available preceding object or
question context. This is not formal source-audit PASS/FAIL, owner semantic
approval or a downstream CLEAR/ESCALATE verdict. The former seventh candidate
is now the fifth, still one coherent decision-thread proposal with contextual
properties; those properties are not independently authorized storage items.
The change from eight to six does not establish improved discovery quality or
NO_WRITE for omitted candidates; prompt change and generation variation are
not disentangled by this one probe.

Focused bundle/adapter tests **19/19 PASS** and `git diff --check` pass. Current
probe: production DB/Vault reads/writes, deployment, migrations, downstream
judgments and storage commits **0**. Next: inspect and correct evidence selection
against the full frozen episode before ambiguity/durability/extraction; no
further model dispatch is covered by this probe's exhausted one-call budget.

### Independent-user-state discovery / partial reference comparison — 2026-10-01

Latest inspected baseline: `3e0fe03`; implementation/execution code commit:
`62a85ec`. Five operator-authored housing reference bundles were source-validated
and frozen before the call under `/private/tmp/galpi-bundle-user-state-Wcrxmn`
(0700; files 0600), reference SHA256:
`4cfc40320717a9c61ccd1daabad227d09bff34d85d960e990ba7a022a474d567`.
This is a partial development reference, not an exhaustive gold set, semantic
adjudication or a study fixture. The full original 30-message episode was reused
byte-for-byte; no DB/Vault reread. The revised instructions contain the known
housing-target example, so this is a development probe, not a blind/held-out
generalization measurement.

One preplanned `gpt-6-luna` call completed, **1 dispatch / 0 retries**, yielding
**12 bundles**. Each mechanically validated bundle has one fragment; selected
turn counts are **1 / 1 / 1 / 1 / 1 / 1 / 1 / 1 / 1 / 1 / 2 / 1**.
There are **6 housing anchors**: all five reference source locations appear as
separate selections, plus a separate location-confirmation response. This is
an observed location-level correspondence, not 5/5 semantic accuracy or
exhaustive discovery coverage. The current output does not include one personal
comparison present in the previous six-bundle proposal; neither inclusion nor
omission is a WRITE/NO_WRITE result.

Operator inspection flags that the budget and walking-preference bundles omit
their preceding questions/context, the completion bundle still omits its object
context, and the lease-choice anchor remains wider than the reference and needs
review. No result is repaired or assigned a downstream label. More individual
anchors do not establish adequate evidence selection; all outputs remain
**NOT_VALIDATED**. Local-model comparison and storage execution were not started.

Private hashes: request
`83a73b9488e50fb809d904066509d4bb47ed22c54ccc8345ffe85bf0118ab271`;
bundles `4ce523c2ac125a0165bdea044e07b4efd54089adc6070cd1861f21e1582d6ca2`;
retained provider response
`9a650c96a1438f5809e5c7a4903cb2c5c19d0aefe80d010853026744ba192131`.
Reproduction from retained source/selection was byte-identical with no new call.
Usage: **3,750 input / 1,489 output tokens** (1,034 reasoning), total **5,239**;
latency **16,138 ms** for this probe. Production DB/Vault reads/writes, migrations,
deployment, EvidenceRef binding and state commits: **0**.

Focused Builder/adapter tests **20/20 PASS**; complete focused storage/SDK/UI set
**146/146 PASS**, diff check and handoff-body equality pass. Full suite was not
repeated. Next: inspect target-specific evidence completeness before feeding
these candidates downstream or comparing a local selector; the one-call budget
is exhausted and no automatic retry is permitted.

### Fixed-anchor evidence selection — 2026-10-01

The owner authorized separating anchor selection from evidence selection for one
development case. The existing discovery API/CLI retains its behavior. Passing
an explicit source-grounded `anchor` to `buildBundleSelectionRequest` and
`discoverEvidenceBundles` instead uses
`memory-fixed-anchor-evidence-selection-v1`: the whole retained episode is
visible, but the selector may only select evidence for that already-fixed target.
The existing bundle schema, source validation and constructor are reused. An
invalid/nonunique anchor fails before dispatch; a changed anchor, zero bundles
or additional bundles fails after selection. There is no repair/retry or
downstream judgment, and semantic completeness remains NOT_VALIDATED.

This is not a conclusion that anchor-first evidence selection is impossible.
The earlier combined discovery probes exposed omissions; they did not test a
separate fixed-target evidence-selection step. Full-episode evidence remains a
possible comparison, not the adopted replacement for target-specific selection.

Pre-dispatch scope: use the same private 30-message episode (1706–1735), with raw
SHA256 `553759bb83a6144caf096af8a2716ceb3d6cd0ee94d83b43e49a930a9585760e`,
and fix the budget anchor at message 1726 before the call. One Luna call is
authorized, with the existing model/config and maxRetries=0. No expected
evidence-turn list is supplied to the model. Inspect whether relevant preceding
question/context is retained against the original episode; this is a known
development example, not held-out evaluation. No DB/Vault reread, automatic
anchor discovery, Ambiguity/Durability/Extractor judgment or state commit is in
scope. Mechanical tests do not establish evidence completeness.

Pre-dispatch validation: Bundle Builder/adapter **24/24 PASS**; complete focused
storage/SDK/UI regression **150/150 PASS**. `git diff --check` passes. The full
repository suite was not repeated for this isolated development path.

#### Observed fixed-budget-anchor probe

Execution code commit: `c3b939cabd066bdf8994cb51e5abb682ee6222fe`.
Before dispatch the source/request/code hashes, fixed anchor and one-call budget
were frozen under `/private/tmp/galpi-bundle-fixed-anchor-qeuaqm4q` (0700; files
0600). Plan SHA256:
`256b83f131685d85c65ef75e473852fd89a6f63db37b02715c539a498011baa0`;
request SHA256:
`08b7787811e67b3213af042ddaeb8150d1b49de369c020320627584a25468b15`.

Observed: **1 completed provider dispatch / 0 retries**, `gpt-6-luna`, but **0
accepted bundles**. The provider widened the fixed budget span to include the
following school question in the same message. The wrapper rejected this with
`FIXED_ANCHOR_CHANGED`. Its selected evidence IDs were 1725–1728, including the
preceding budget question absent from the combined-discovery selection. This
presence check is not evidence-completeness approval or a downstream label.
No output was repaired, adopted or automatically retried. This single rejected
attempt does not establish that anchor-first selection is infeasible; the model
was unnecessarily required to echo the immutable target as well as choose its
evidence. Returning evidence IDs only is a possible next interface simplification,
not implemented or tested by this attempt.

Retained provider-response SHA256:
`14ae33de27d2d00af1a8df23561e19059303cc1b7776eda83ce5e403bd63ac62`;
retained selection SHA256:
`1710d0d281663dbbcb5723f6889ea8512836a2f8c6ab11df95fcdb49374b55e6`.
Usage: **3,491 input / 508 output tokens** (432 reasoning), total **3,999**.
The original episode bytes/hash remain unchanged. Production DB/Vault
reads/writes, EvidenceRef registration, downstream judgments and state commits
were **0**. The one-call budget is exhausted. Next: remove target rewriting from
the selector's responsibility before another separately authorized probe; no
local selector or downstream pipeline execution has begun.

### Evidence-IDs-only interface / low–medium comparison — 2026-10-01

Owner-approved scope: retain the fixed-anchor-first pipeline, return only
`{evidenceTurnIds: [...]}` from the selector, then compare low/medium on the same
known budget target. The current fixed-anchor request is
`memory-fixed-anchor-evidence-ids-v1`; the earlier anchor-echo request above is
historical and rejected before new provider dispatch. The code keeps the
validated immutable anchor from the frozen request and constructs exactly one
bundle using the returned IDs. Extra fields, including an echoed/replaced anchor,
fail closed. Existing nonempty/unique/source-bound evidence and mandatory anchor
turn checks remain; omitted evidence is not silently added. Discovery behavior
and the default CLI/selector reasoning effort remain medium. The development
adapter accepts explicit low/medium for this comparison, with no production
configuration or model-selection change.

Before answers, fix the same retained 30-message episode/hash and message-1726
budget anchor, common prompt/schema/model/config and execution order **low then
medium**, one independent call per effort. Only `reasoning.effort` differs in the
API bodies. Maximum total dispatches **2**, no retries, additional cases or
output repair. Inspect selected source turns for the preceding question,
referents/units, relevant conditions/corrections and unrelated context; preserve
both selections. Do not supply an expected evidence list to the provider.

This is a two-call development comparison on a known example, not a causal
quality estimate or a model/effort winner. Generation variation is not controlled
by one sample per effort. No Ambiguity/Durability/Extractor labels or storage
commits are produced; evidence completeness remains NOT_VALIDATED. The previous
failed attempt and earlier discovery probes remain unchanged. No current
DB/Vault access, Pi deployment or local-model run is in scope.

Pre-dispatch validation: Builder/adapter **25/25 PASS**, complete focused
storage/SDK/UI regression **151/151 PASS**, and `git diff --check` PASS. Synthetic
transport tests compare entire low/medium API bodies and the unchanged default
medium body. The full repository suite was not repeated for this isolated
development change; these checks do not establish semantic selection quality.

#### Observed low–medium fixed-budget comparison

Execution code commit: `85f23e4fc9cd9b4603c97a5c9da2b21b95634503`;
baseline: `1d7a89436d7c2de05d7d44ba7caf9596da971cd7`. The common
episode/anchor/request, both complete API bodies and low-then-medium call order
were frozen before dispatch under
`/private/tmp/galpi-bundle-anchor-effort-356htlug` (0700; files 0600).
Plan SHA256:
`e671bb93654bb937b307ac36508b462b3b374ff7a1d6956002605e5621d59196`;
common request SHA256:
`0598efedeba2f254d4da01d7c4316dc92b47ac95a7301712743c7a995d0d8dd5`.
Pre-dispatch mock capture and actual transport body checks established that
only reasoning effort differed. No expected evidence list was supplied.

Observed: **2 completed provider dispatches / 0 retries**, both `gpt-6-luna`.
Each produced one mechanically valid bundle with the original fixed anchor
preserved by code, without output repair. Source IDs/counts are observations,
not semantic accuracy scores:

| Effort | Selected message IDs | Count / fragments | Input / output / reported reasoning tokens | Call latency |
|---|---|---|---|---|
| low | 1723–1726 | 4 / 1 | 3,433 / 35 / 0 | 1,986 ms |
| medium | 1724–1730 | 7 / 1 | 3,433 / 540 / 491 | 7,691 ms |

Operator comparison against the retained source: both include the immediate
preceding budget question and the user's tentative lease-choice context. Low
selects a narrower preceding-context view; medium also selects subsequent
school/campus confirmation. This does not establish that the extra context is
always unnecessary or that low is generally better. The whole anchor message
still includes another question as evidence, without adding another storage
target. Assistant interpretation of monetary units is not independently adopted
as a user fact. No ambiguity/durability/extraction verdict was made.

Bundle SHA256: low
`a056725d2419a19aeae8070506e5601a13b9a27bf563b168778b5fc6498ebe03`;
medium `83ac26dc85c359a153fcba473803c1ca45775613e48f92f89c1a7c1e27a1e67d`.
Provider-response SHA256: low
`bbc40368546c6e68ecf85e0bfb822bc2929053fa4062db4490e218fb432e463a`;
medium `092f9d193e2a2db179097e576fe4120a17cd87838b7461ca9af817df9009b1a4`.
Comparison summary SHA256:
`e4a581ab09e36f6a5306c470e8098a097c5f8f2ad97eae49096d7c4755f6ebfa`.
Both bundles reproduced byte-identically from retained IDs/source with **0
additional calls**. Original episode bytes/hash are unchanged. Production
DB/Vault reads/writes, EvidenceRef registrations, downstream judgments and state
commits: **0**. Both results remain **NOT_VALIDATED** for evidence completeness;
the two-call budget is exhausted. Default medium is unchanged, and no effort
winner/production policy is selected. Next: owner inspection of these two
target-specific views before any downstream or separately budgeted probe.

### Fixed-target low probes / formation walkthrough — 2026-10-02

The owner authorized two additional development selections, one each for the
walking-distance preference and tentative rental-choice targets in the same
retained 30-message episode. Baseline: `5c60a088566799e7813cd7b605bfe2c3418817fd`;
selector implementation remains `85f23e4`. No code change is required.

Before dispatch freeze both source-grounded anchors (messages 1732 and 1724),
requests, complete API bodies and execution order **walking then lease choice**.
Use gpt-6-luna/low, current_turn, 4096 output tokens, store:false, tools absent
and maxRetries:0. Maximum dispatches **2**, one per target, no retry, repair or
additional case. Reuse the original episode raw hash
`553759bb83a6144caf096af8a2716ceb3d6cd0ee94d83b43e49a930a9585760e`;
do not reread current DB/Vault. The selector receives no expected evidence list.
Inspect referent/question context for walking distance and conditional/tentative
lease-choice context against the full source.

After inspecting the retained selections, trace one bundle through the agreed
Ambiguity → Durability → Extractor responsibility boundaries as an **operator
design walkthrough**, not execution of those model stages, owner gold or an
accepted ingress candidate. No separate downstream calls or semantic labels in
Builder output are authorized. Preserve the one-target boundary, conditions
and attribution. Current USER/primary_laptop storage does not accept contextual
housing preferences/choice states; do not invent an attribute, generic scope or
family registration to make the example writable. Source binding and actual
commit remain unperformed. The separate P1-B6 research contract is unchanged.

Pre-dispatch validation: existing Builder/adapter **25/25 PASS**. The full suite
is not repeated for this no-code development probe; previous regression results
remain historical. Source/anchor/body checks will also run in private preflight.

#### Observed selections and operator walkthrough

The two-call plan/request/code hashes were frozen before dispatch in
`/private/tmp/galpi-bundle-referent-condition-f4920s4a` (0700; files 0600).
Plan SHA256:
`be0dd86e5ebc46b0ccca147edf48d7e69ceb01ebcb64355b6d4c4913dfd45879`.
Request SHA256: walking
`714c8fabb75f510748bd7181ffb2741c8f71a9e9554f8cd5d6d52fe59bcde0a9`;
lease choice `70ecbededa2745451eb2f8d780f422788042f69d22fb53f1f857535317ab026d`.

Observed: **2 completed gpt-6-luna/low dispatches / 0 retries**. Both produced
one mechanically valid, fixed-anchor bundle without output repair:

| Target | Selected message IDs | Count / fragments | Input / output / reported reasoning tokens | Call latency |
|---|---|---|---|---|
| Walking preference | 1730–1732 | 3 / 1 | 3,432 / 31 / 0 | 13,422 ms |
| Tentative lease choice | 1722–1725 | 4 / 1 | 3,432 / 35 / 0 | 1,943 ms |

Operator source comparison: walking includes the school-distance choice
question and user reply, but retains the earlier affirmation without its
available antecedent question (1729). The destination mention in assistant
context does not independently prove the user's campus confirmation. This is a
retained evidence-link concern, not automatic ESCALATE for the narrower walking
preference target. No omitted turn was patched into the frozen output.

Lease choice includes the preceding question and the original tentative status,
conditional graduate-school possibility and possible stay duration. These
conditions inform the single target; they do not authorize separate confirmed
education/duration/contract claims. Assistant advice remains attributed context.
These are operator observations, not formal bundle-audit PASS or owner gold.

The private **operator design walkthrough** uses the lease-choice bundle. Under
the given-status rule (retained in the frozen P1-B6 v4 contract), a supplied
tentative/undecided choice can illustrate CLEAR without resolving the eventual
choice. Durability is illustrated as a candidate for the ongoing search, not a
lifelong preference or mutation authority. Extraction must preserve that one
tentative choice and its conditions, with owning-source/span references; it
must not convert conditions into separate confirmed claims. No downstream model
stage, accepted candidate, EvidenceRef registration or semantic approval was
performed. The illustrative readings are not Builder labels or research gold.

This exposes an unimplemented representation boundary: the current General Fact
handler supports only USER/primary_laptop, not contextual/conditional housing
choice states. No family, attribute, generic scope or candidate schema is opened
by this walkthrough. Before a real Extractor/Router connection, its output must
distinguish a representable supported candidate from an unsupported target while
preserving the original target/evidence. This is the next design question, not
an adopted new ingress shape or a request to implement another family now.

Bundle SHA256: walking
`d549f1276990f85324a743a077d9806a961e49281a7469f14c6e692c64392947`;
lease choice `055f526ac9b0fbaddc540122f7e2b9b368cf0302b9e897f190823af50f62acc6`.
Provider-response SHA256: walking
`014f870398317367ff60884506dcf6b5e5059bba24ee7be964d3990618a6137a`;
lease choice `c4b96bafabe85b481332611f5bdaa03f8e3c3855204b76bee0dbe4c4e1b4b5fb`.
Probe summary SHA256:
`48fe858881850e508da297f4dfd21579950ae723b6df0502e6fbd534f49cc3d1`.
Private operator-observation SHA256:
`c76b7b94febdda1a37a59124d80c0ebfa8765e5950a5aebb107cbdb8b60df905`;
private illustrative walkthrough SHA256:
`576546ca87e19186a45825608b13472306576fdf5adc84345463a9ac771f1b2f`.
Both bundles reproduced byte-identically from retained selections with **0
additional calls**. Original episode bytes/hash remain unchanged. Production
DB/Vault reads/writes, downstream model calls, state commits, migrations and Pi
deployment: **0**. Both outputs remain NOT_VALIDATED; the two-call budget is
exhausted. No general low-effort quality/latency claim or default-setting change
follows from these examples.

#### Owner-requested unchanged repeat — 2026-10-02

At owner request, repeat both preceding targets once, walking then lease choice,
from baseline `d64cd117053626e6e74ce6e0a81728da9f6bb82c`. The intervening OCR
commit did not change this selector. This is a separately authorized development
repeat, not an automatic retry or repair of the preceding frozen selections.
Before dispatch, the private plan fixed a new two-call budget and verified that
both request files, complete API bodies and selector code hashes matched the
preceding trial exactly. Source bytes, anchors, low configuration and no-retry
policy were unchanged; no expected evidence IDs were supplied to the model.

Private directory: `/private/tmp/galpi-bundle-referent-condition-repeat-_lgzuh7z`.
Plan SHA256: `44df844a9c2ce14002190d504d1dfe21d582007492e91e17afc2baec85b99476`.
Observed: **2 completed dispatches / 0 retries**, walking 2,062 ms and lease choice
2,113 ms. Walking again selected 1730–1732; lease choice again selected 1722–1725.
Both frozen bundle files are byte-identical to their predecessors, with the same
bundle hashes. Offline reconstruction from the new retained selections also
reproduced both bundles byte-identically without further calls. The walking
antecedent omission therefore remains; repeated identical output does not prove
semantic completeness. Neither output was repaired or promoted to semantic gold.
Summary SHA256: `0087b69216805d7288435fb42f0b24df5a4d365a473ce42c2df5b46f6f8818b2`.
Production DB/Vault access, downstream model calls and storage commits remain
**0**. No code or default changed; semantic completeness remains NOT_VALIDATED.
No full-suite rerun was needed for this documentation-only probe record; the
private request/body/source and offline reconstruction checks above were run.

### Development bundle-completeness audit seam — 2026-10-02

Owner-approved scope at baseline `771f7b03121affbe8699671f2d07a7fdb477f5af`:
add the audit request/result boundary and synthetic tests only, with actual model
calls **0**. Reuse `lib/memory-storage/bundle-builder.js`; no new provider, CLI,
production route, schema or automatic pipeline connection is introduced.

`buildBundleAuditRequest(episode, bundle)` reconstructs the exact existing bundle
through the source/anchor constructor before accepting it. Edited source, spans,
selection order, context, identity or fragment metadata fail before the auditor
is invoked. The immutable request contains the full frozen source and one exact
selected bundle under `memory-evidence-bundle-audit-v1`.

The audit asks whether omitted evidence or another selection defect materially
changes the interpretation of **this TARGET**. An omitted preceding question is
not automatically a failure; target-relevant interpretation is the criterion.
This follows the source-completeness question already used in the separate
local-memory study, without importing that study's labels, authority or gate.

`auditEvidenceBundle(episode, bundle, auditBundle)` requires an explicit auditor
callback and invokes it once. It accepts only `disposition` (PASS / FAIL /
UNCERTAIN), `missingEvidenceTurnIds` and a nonempty diagnostic `reason`. Missing
IDs must exist in the frozen episode, be absent from the selection, and be unique;
PASS requires an empty list. FAIL may describe another selection defect without
a missing ID. The report binds source/bundle hashes and canonicalizes IDs in source
order. Malformed results/provider failure fail closed without retry or repair.

The original selection and `semanticCompleteness: NOT_VALIDATED` are preserved.
An audit PASS is not semantic approval, HUMAN gold, CLEAR/ESCALATE, WRITE or
storage authority; FAIL/UNCERTAIN must not be silently promoted for downstream
use. Actual auditor/provider evaluation and downstream wiring remain OPEN. No
current private bundle was adjudicated by these synthetic tests. Audit reasons
may contain private source details and belong in private artifacts, not Git/logs.
Next is an explicitly bounded audit probe on the retained walking/lease bundles;
selection repair and later Ambiguity/Durability/Extractor are separate work.

Validation: added six synthetic audit tests (the initial red run failed on the
absent helpers), then the complete focused Builder/storage/proposer/review set
passed **157/157**, including all **31** Builder/audit tests. Local
`npm test -- --test-concurrency=2`: **1,958 PASS / 2 FAIL / 3 SKIP** (1,963 total).
Failures are the existing dark-theme assertions in `test/assistant-task-ui.test.js`
(lines 219 and 312); the test and checked app/CSS bytes match the pre-edit baseline.
No unrelated UI repair is included. `git diff --check` and AGENTS/CLAUDE body
equality pass. Synthetic callback results validate mechanics, not audit judgment
quality. Actual external/model calls, production DB/Vault/Pi access, source binding
and state commits: **0**.

#### Retained two-bundle audit probe — 2026-10-02

The owner authorized a bounded actual audit of the retained walking/lease-choice
bundles and requested their exact selected views. Baseline: `92228e29ef48390965864d2d40217741bd8adecc`.
A private runner reused the existing audit request/result functions and OpenAI SDK
transport; no repository adapter, production connection or prompt change was made.
Before dispatch, freeze source/bundle/request/body/code hashes and walking-then-lease
order: gpt-6-luna, medium/current_turn, 4096 output tokens, store:false, tools absent,
60-second timeout and SDK/request maxRetries:0. Budget **2**, one call per bundle,
no retry, selection repair, downstream classification or storage.

Private directory: `/private/tmp/galpi-bundle-audit-Cpbqd8` (0700; files 0600).
Plan SHA256: `ffe3fb53a3667f0b6aa89c31bc7980a54929e80bcf9ee49fc09e5b0d968c2746`.
Two synthetic transport preflight checks passed before actual calls. Requests:
walking `5fdec4532f75d7fd8e76c3a19e83c54e19a1cfd562b5133cdf4886df99794b33`;
lease `cd2e99d4406dbd3c1aab0e40938d4dbaf2bd4b53dc5b32acb0d6462ce0bbe3f7`.

Observed **2 completed dispatches / 0 retries**, both **PASS**, neither reporting
missing evidence IDs. Walking: 3,720 input / 239 output (154 reasoning) tokens,
4,183 ms. Lease: 4,085 input / 687 output (587 reasoning) tokens, 6,658 ms.
The auditor considered the selected immediate question/context sufficient for
the walking target; the earlier affirmation's omitted antecedent was not judged
material to that target. Lease conditions were judged preserved; other later
independent details were not required for this target. These are model audit
observations, not independently validated completeness, ambiguity labels or owner
gold. No omitted evidence was inserted and no original output was changed.

Report SHA256: walking `5b90277621424d1ab75712e539d0990c1d59d2549876cee47a409880ef2095fe`;
lease `7761e4dc4971795039a5aaf1c2811679cbefb2c820a271c6803424af0f83dad0`.
Summary SHA256: `bc0fd682ce7c9106b85ac1dec9b986e586267cd8844e37c0a090125c6cbb5668`.
Original source and both bundle raw hashes remain unchanged. Production DB/Vault
access, Pi access, EvidenceRef registrations, downstream model calls and state
commits: **0**. Raw source, bundle views, provider responses and audit reasons
remain private outside Git. No full regression rerun was required for this no-code
probe receipt; the previous implementation validation remains historical.
