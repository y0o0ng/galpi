# XION R2 Storage Routing — Phase 1 Implementation Design

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

Schema v28 adds `memory_evidence_refs(evidence_id, source_domain, source_key, locator, source_version, content_sha256, created_at)`. Its address tuple is unique and non-null; v1 conversation addresses use empty locator/version. `evidence_id` is `ev1_` plus lowercase SHA-256 of UTF-8 `xion-evidence-ref-v1\0domain\0key\0locator\0version`. It is independent of SQLite rowid. `content_sha256` is SHA-256 of the owning message's exact UTF-8 content. It is integrity metadata; neither content nor embeddings are copied into the registry. `created_at` records registry materialization time, not a canonical valid/knowledge-time model (§54.4 remains open).

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
