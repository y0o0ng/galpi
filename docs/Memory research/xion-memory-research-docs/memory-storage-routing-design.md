# XION R2 Storage Routing — Implementation Design

This is an implementation design subordinate to [the canonical R2 architecture](memory-architecture-design.md), especially §§42, 45–47, 50–51 and 54. It does not change semantic authority. The accepted choice is one **logical** EvidenceRef/address layer over existing owning stores (Option B); SQLite is the Phase-1 physical implementation of that layer, not a unified evidence ledger.

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
