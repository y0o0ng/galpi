# XION Memory R3-P0-B Operational Replay Census Freeze Receipt

> **P0-B PREPARATION COMPLETE — OPERATIONAL REPLAY CENSUS FROZEN**
>
> **ANSWER GENERATION NOT STARTED — STRICT HISTORICAL EXACT S UNPROVEN**

## Scope and authority

- Implementation baseline (latest GitHub `main` after fetch/pull): `ced1c3c46ac4ea42565c0de5809e65d3e356b47e`
- Execution code commit: `6f2be97` (`Freeze best-available R3-P0-B replay census semantics`)
- Fixed organic window: `2026-08-31 00:00 KST <= trace < 2026-09-28 00:00 KST`
- Source of invocation universe: `assistant_retrieval_shadow_runs`, regular `/api/chat` `chat:<runtimeGeneration>:a2` only; **409 / 409** eligible invocations, including repeated questions as separate cases.
- §53.7 retrospective replay execution amendment authorizes this best-available operational census for P0-B. Original strict exact-historical `S`/ΔR trigger and census remain historical preregistration, **unproven** by retained telemetry. This artifact does not estimate `ΔA` or determine GREEN/AMBER/RED.

Schema v26 `retrieval_query_resolution_trace` was applied at Unix `1789648367` (`2026-09-17 21:32:47 KST`). `server.js` runs migrations before serving requests, and no eligible trace shares that timestamp. Earlier traces use original user-query semantics; later traces use their recorded resolution outcome. The message-save path stores the retrieval embedding for searchable turns, generated from the same query input/model; rewritten-query plaintext is not retained and was not regenerated.

## Frozen census

| Top-level disposition | Invocations |
| --- | ---: |
| `NO_D0_BY_PRODUCTION_SEMANTICS` | 7 |
| `REPLAY_SAME` | 301 |
| `REPLAY_SENSITIVE` | 79 |
| `PIT_UNCERTAIN` | 22 |
| **Total** | **409** |

`REPLAY_SENSITIVE` subtypes: `ACTIVATION_CHANGE` **42**, `MEMBERSHIP_CHANGE` **36**, `ORDER_ONLY_CHANGE` **1**. `PIT_UNCERTAIN` reasons: `PIT_UNCERTAIN_CORPUS_REPLAY` **19**, `PIT_UNCERTAIN_QUERY_RESOLUTION` **3**. No other reason occurred in this run. The 7 no-D0 cases are 5 `no_retrieval` and 2 `ambiguous`; the 3 unresolved query cases are `resolved` turns without durable rewritten-query plaintext. `active_notes_json` was observed for **409 / 409** cases.

For searchable turns the replay uses the preserved active-note input, original query and stored embedding for legacy/`pass`, temporal `chunk.created_at < trace.created_at`, and the existing D0 scorer/limits/budget with only the gate policy changed. Known missing, post-trace-updated, or actual-versus-replay selected chunk discrepancies fail closed as corpus uncertainty. The 79 replay-sensitive cases, not an exact historical `S`, are the operational primary generation set; the 22 uncertain cases were neither guessed into nor silently removed from that set. The latter remain visible in the 409-case manifest.

Study-wide residual PIT caveats remain even for cases with a replay disposition: current note embeddings and note bodies may contain later information; deleted/changed historical chunks may have influenced unobserved candidate ranking; a stored message embedding has matching input/model semantics but cannot prove a byte-identical historical embedding response. Therefore `79..101` is **not** asserted as a conservative historical-`S` bound, and exact historical ΔR membership remains unproven.

## Artifact and safety

- Frozen manifest: `fixtures/memory-r3-p0b-replay-census-freeze.json`
- SHA256: `ba19370db20cad2e3793ffea6650598f3b8edf007d73f7009d900a35ec2671d6`
- Two Pi runs on the same retained state produced byte-identical artifact output. The manifest contains IDs, hashes, classifications and reason codes, with no raw question, answer, note title/filename/body, rewritten query or retrieval context.
- Execution streamed the research script over SSH and wrote the artifact locally; no script or artifact was installed on Pi. SQLite opened with `readonly=true`, `query_only=true`; `total_changes()` delta **0**. Pi DB/WAL/SHM combined byte fingerprint and Vault file byte fingerprint were unchanged before/after the repeat run. Production service was not restarted; schema, DB and Vault were not mutated by the study.
- External API calls **0**; question-text external transmission **0**; P0-B answer generations **0**.
- Local focused P0-B tests **5/5**; full `npm test` **1,639 passed / 0 failed / 3 skipped** (1,642 total). `git diff --check` and manifest privacy/determinism checks passed.

Next: freeze one experiment-time answer stack, reconstruct each frozen `REPLAY_SENSITIVE` case's historical prefix and allowable non-memory context, then execute the separately preregistered two-generations-per-arm, blind HUMAN P0-B protocol. This receipt does not start that phase.
