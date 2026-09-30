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

All storage modules live together in `lib/memory-storage/`: `evidence-registry.js`, `router.js`, and `general-fact.js`. The shared migration runner remains `lib/database-migrations.js`. No production candidate producer or registered production handler is connected; existing retrieval and source ownership are unchanged.

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

This selects the initial development authority boundary, not a permanent requirement to manually approve every future memory. Automatic semantic approval conditions remain OPEN and must be evaluated against the actual proposer/validator before adoption. Local-model use remains an option. The HUMAN review/resume interface and provider adapter are not implemented by the current storage core; synthetic test callbacks are not production approval authority. This decision instantiates canonical §42.2 SI-10 / §42.6 without changing their shared transition semantics.

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

Next is to design the proposal review workflow under the initial HUMAN approval boundary and choose/evaluate the actual semantic proposer (local model remains an option), then connect a production accepted-candidate adapter only after its gates are specified. No model provider, HUMAN review interface, production integration, active elicitation, Projection or Context Assembly is delivered by this core; automatic semantic approval remains OPEN.
