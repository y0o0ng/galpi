# XION Memory R3-P0-B Operational Replay Census Freeze Receipt

> **P0-B 2×2 GENERATION COMPLETE — PRIMARY HUMAN ADJUDICATION NOT STARTED**
>
> **STRICT HISTORICAL EXACT S UNPROVEN**

## Scope and authority

- Implementation baseline (latest GitHub `main` after fetch/pull): `ced1c3c46ac4ea42565c0de5809e65d3e356b47e`
- Same-second boundary re-freeze baseline (latest GitHub `main` after fetch/pull): `3693b7cd41075bb68cfff2ea6f72c760ec2f4766`
- Execution code commit: `87f0bd4` (`Fail closed on same-second P0-B chunk updates`); initial execution code commit was `6f2be97`.
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

For searchable turns the replay uses the preserved active-note input, original query and stored embedding for legacy/`pass`, temporal `chunk.created_at < trace.created_at`, and the existing D0 scorer/limits/budget with only the gate policy changed. Known missing, same-second-or-later-updated (`chunk.updated_at >= trace.created_at`), or actual-versus-replay selected chunk discrepancies fail closed as corpus uncertainty. The 79 replay-sensitive cases, not an exact historical `S`, are the operational primary generation set; the 22 uncertain cases were neither guessed into nor silently removed from that set. The latter remain visible in the 409-case manifest.

Study-wide residual PIT caveats remain even for cases with a replay disposition: current note embeddings and note bodies may contain later information; deleted/changed historical chunks may have influenced unobserved candidate ranking; a stored message embedding has matching input/model semantics but cannot prove a byte-identical historical embedding response. Therefore `79..101` is **not** asserted as a conservative historical-`S` bound, and exact historical ΔR membership remains unproven.

## Artifact and safety

- Frozen manifest: `fixtures/memory-r3-p0b-replay-census-freeze.json`
- SHA256: `1be22e876918cf890bed6cf64755c554663c353d09e60a0ef5f49fe40598a01d`
- Same-second boundary re-freeze: the 409 per-case dispositions and counts did not change; the prior artifact SHA256 was `ba19370db20cad2e3793ffea6650598f3b8edf007d73f7009d900a35ec2671d6`. The new artifact differs from it only in the recorded `baselineCommit` field.
- Two Pi runs on the same retained state produced byte-identical artifact output. The manifest contains IDs, hashes, classifications and reason codes, with no raw question, answer, note title/filename/body, rewritten query or retrieval context.
- Execution streamed the research script over SSH and wrote the artifact locally; no script or artifact was installed on Pi. SQLite opened with `readonly=true`, `query_only=true`; `total_changes()` delta **0**. Pi DB/WAL/SHM combined byte fingerprint and Vault file byte fingerprint were unchanged before/after the repeat run. Production service was not restarted; schema, DB and Vault were not mutated by the study.
- External API calls **0**; question-text external transmission **0**; P0-B answer generations **0**.
- Local focused P0 tests **23/23**, including same-second and strictly-later chunk updates; full `npm test` **1,648 passed / 0 failed / 3 skipped** (1,651 total). The first sandboxed full run hit `listen EPERM` on localhost; the unrestricted rerun passed. `git diff --check` and manifest privacy/determinism checks passed.

At the census freeze, the next step was to freeze one experiment-time answer stack, reconstruct each frozen `REPLAY_SENSITIVE` case's historical prefix and allowable non-memory context, then execute the separately preregistered two-generations-per-arm, blind HUMAN P0-B protocol. This census-stage receipt did not start that phase.

## Generation-input preflight follow-up — 2026-09-28

> **INPUT PREFLIGHT COMPLETE — 0 GENERATION_READY / 79 INDETERMINATE_TOOL_REPLAY**
>
> **ANSWER GENERATION NOT STARTED — STRICT HISTORICAL EXACT S UNPROVEN**

- Latest GitHub `main` baseline before this work: `3475843c431cd118c19112fb669ca70ddc479cb7`. Read-only execution code commit: `e5bbf773ddcc2c20ccb9e3047a15f975215f00d3`. The original 409-case census artifact and §53 P0 contract were not changed.
- Input universe: all **79 / 79** frozen `REPLAY_SENSITIVE` cases from `fixtures/memory-r3-p0b-replay-census-freeze.json` (SHA256 `1be22e876918cf890bed6cf64755c554663c353d09e60a0ef5f49fe40598a01d`). Each canonical user message ID, session, query hash, trace identity and preceding same-session DB order was checked. The experiment-time history window is 20 messages including the target; target request time, not execution time, drives the prompt's KST time line. Cross-session past-message candidates and their assistant replies are cut off by target ID and time.
- One answer-stack snapshot: `chat.model_selection=gpt-6-luna`, resolved exact model `gpt-6-luna`, retained OpenAI catalog generation **125**, runtime `gpt-single-v1`, reasoning effort `medium`, Responses API, `max_output_tokens=8192`, `store=false`, reasoning context `current_turn`. Primary tool policy is `LIVE_TOOLS_DISABLED` with no tool definitions or tool rounds; no live web, attachment, schedule, mail, news, paper or GitHub tools were run. `CONTEXT_N=10`, history messages **20**, memory limit **20 items / 1,200 chars**, active notes **8**, note context **5,000 chars**. D0 limits remain the existing **3 notes / 6 chunks / 8,000 final context chars**; source and configuration hashes are in the manifest. Answer-stack snapshot SHA256: `d2e59c58eb76fe987a43a4653afbbe905f1080ce0c7ff60b9e92493796f49981`.
- Both D0 context strings were reconstructed with the frozen census policy and matched their HARD-GATED and GLOBAL-SOFT-PRIOR census hashes for **79 / 79** cases. Historical active-note filename selection came from each trace; current note content and `_system/memory.md` were read only for shared experiment-time inputs. No new ranking or changed context was accepted in place of a census hash.

| Input-freeze disposition | Cases |
| --- | ---: |
| `GENERATION_READY` | 0 |
| `INDETERMINATE_HISTORY_REPLAY` | 0 |
| `INDETERMINATE_TOOL_REPLAY` | 79 |
| `INDETERMINATE_RETRIEVAL_RECONSTRUCTION` | 0 |
| **Total** | **79** |

The Pi runtime has `ASSISTANT_TASKS_ENABLED=true`, so production `buildContextMessage(...)` receives `getActiveScheduleContext()` on every chat turn. All 79 historical targets have earlier task state, while `assistant_task_events` does not retain the earlier title, detail, due and reminder values needed to reconstruct that model-visible schedule block. Under the repository owner's explicit strict replay decision, today's task state is not substituted for the historical block. Every case therefore fails closed as `INDETERMINATE_TOOL_REPLAY`; the 79 D0 hash matches do **not** make any case generation-ready. Attachment and other tool dependencies were not claimed to be fully resolved after this sufficient blocker. The existing study-wide census PIT caveats and unproven exact historical `S` remain unchanged.

- Privacy-safe manifest: `fixtures/memory-r3-p0b-generation-input-freeze.json`, SHA256 `bff69b5fe672e2319d7484323c33cc90a689626e956d54bb71c9e8f6054b314e`. It contains IDs, hashes, dispositions and stack settings, with no raw question, answer, note title/filename/body, attachment name/content, tool output or schedule text.
- Private bundle: `/private/tmp/galpi-p0b-generation-inputs-final.json` (outside Git, mode `0600`), SHA256 `8d17df7e789e9e8c7646fff2299c92699788a1f17e88ae580adeba5065f91c68`. It has **0** generation-ready case payloads; there is no hidden 79-case generation set.
- The committed script was streamed over SSH; no script, artifact, schema, production config or service was installed or changed on Pi. Two final Pi executions were byte-identical. SQLite `readonly=true`, `query_only=true`, `total_changes()` delta **0**; the final paired-run interval left DB, WAL, SHM and all **108** Vault file bytes unchanged. Earlier preflight intervals saw WAL/SHM drift while the live service continued, so those intervals were not used as the byte-invariance claim. External API calls **0**, live tool executions **0**, answer generations **0**, DB/Vault research writes **0**, service restarts **0**.
- Final focused P0 tests: **29 passed**. Final full `npm test`: **1,654 passed / 0 failed / 3 skipped** (1,657 total). A sandboxed run hit `listen EPERM` on localhost; the unrestricted rerun passed.

P0-B remains **OPEN / ANSWER GENERATION NOT STARTED**. Under the chosen strict historical-context rule, the ready set is empty and the frozen 2×2 generation protocol cannot begin. The next decision requires a faithful durable recovery of historical schedule context or an explicitly approved prospective amendment for that shared input; this receipt makes neither change.

## Historical schedule replay refinement — 2026-09-28

> **CURRENT INPUT FREEZE — 18 GENERATION_READY / 61 INDETERMINATE_TOOL_REPLAY**
>
> **ANSWER GENERATION NOT STARTED — STRICT HISTORICAL EXACT S UNPROVEN**

The preceding **0/79** preflight is preserved as the historical first attempt but is **superseded**: it treated any task created before a target as an unreconstructable schedule. Production actually exposes only `status='active' AND lifecycle='active'` tasks. This follow-up retains the same strict faithful-reconstruction rule and the same frozen 79-case operational census; it changes only historical schedule reconstruction.

- Latest GitHub `main` baseline: `e2b68f2ab4fc3348997c49ca9c4ce637e7608f11`; execution code commit: `8fb933bd5a04f1eefb1267bebc8a6ce479b15ffc`. Pi schedule/task/series/server source hashes matched that baseline. The frozen 409-case census, D0 policy and P0 contract were unchanged.
- Each retained task's `assistant_task_events` chronology reconstructs target-time status and lifecycle. A target-time active task uses its retained title, detail and due fields only when no later `updated` event can have changed them. Reminder creation, firing, acknowledgement and cancellation timestamps reconstruct the target-time live `pending`/`fired` reminder. Relevant same-second mutations fail closed. `buildActiveScheduleContext(...)` receives the reconstructed task list in production all-view order, including series collapse and the 20-task limit.
- A later series edit/end can physically remove untouched occurrence rows and their events. Without a durable historical rule/occurrence snapshot, the affected earlier targets remain `INDETERMINATE_TOOL_REPLAY`; later targets are not blocked solely because the series existed. Current schedule values were not substituted for historical values.

| Historical schedule reconstruction | Cases |
| --- | ---: |
| Exact empty schedule | 0 |
| Exact active schedule | 20 |
| Unrecoverable schedule | 59 |
| **Total** | **79** |

| Current input-freeze disposition | Cases |
| --- | ---: |
| `GENERATION_READY` | 18 |
| `INDETERMINATE_HISTORY_REPLAY` | 0 |
| `INDETERMINATE_TOOL_REPLAY` | 61 |
| `INDETERMINATE_RETRIEVAL_RECONSTRUCTION` | 0 |
| **Total** | **79** |

The 61 tool-indeterminate cases are 59 schedule-unrecoverable cases and 2 cases with a reconstructable schedule but attachment-dependent target/prefix input. The existing target, bounded history, historical request time, shared-input equality and both frozen D0 context-hash checks still apply before a case becomes ready. Non-ready cases stay in the 79-case denominator; no answer was generated and no final ΔA or GREEN/AMBER/RED result is claimed.

- Frozen privacy-safe manifest: `fixtures/memory-r3-p0b-generation-input-freeze.json`, SHA256 `af674739a1cdf5b74e2b4f52994955fec4c84c48bbcb5434f9ffe3194beaf338`. It holds IDs, hashes, schedule/disposition codes and answer-stack settings, with no raw question, answer, note or schedule text.
- Private generation bundle: `/private/tmp/galpi-p0b-generation-inputs-schedule-freeze.json` (outside Git, mode `0600`), SHA256 `b94b4927d3707e017b6fef90479c72a7c8989e431e527f3c0392296eba3b349f`; it contains exactly the 18 ready cases. The fixed `gpt-6-luna` Responses answer stack still uses catalog generation **125**, reasoning effort `medium`, 8,192 max output tokens, `store=false`, `current_turn` reasoning context and `LIVE_TOOLS_DISABLED`; the refreshed snapshot SHA256 is `b3d720a359079b6115454abe1dc501bd1e0440a7d50d8ff437482877166e0b1e` because its source hashes now also pin the task, series and schedule-context modules.
- Two final Pi read-only executions produced byte-identical outputs. SQLite was opened with `readonly=true`, `query_only=true`, `total_changes()` delta **0**. DB, WAL, SHM and Vault fingerprints all matched before/after that final paired-run interval. An earlier interval saw live-service WAL/SHM drift and was not used for the invariance claim. No Pi script/artifact installation, production write, service restart, external API call, live tool execution or answer generation occurred.
- Focused P0-B tests: **20 passed**. Full `npm test`: **1,663 passed / 0 failed / 3 skipped** (1,666 total). `git diff --check` passed.

P0-B remains **OPEN / ANSWER GENERATION NOT STARTED**. The next phase may apply the frozen 2×2 generation protocol only to the 18 `GENERATION_READY` inputs; the 61 indeterminate cases remain visible for final bounds. Strict exact historical `S` and census membership remain unproven under the retained-telemetry limits.

## Generation-input blocker diagnostic — 2026-09-28

The latest GitHub `main` baseline was `6cf5a6ef0c6be040a5b953a3285f2a9c25ca9c75`; diagnostic execution code is `aa0429d033307438ab0c37634b3a1ca9acf8f725`. The frozen input manifest (SHA256 `af674739a1cdf5b74e2b4f52994955fec4c84c48bbcb5434f9ffe3194beaf338`) still has **18 `GENERATION_READY` / 61 `INDETERMINATE_TOOL_REPLAY`**. This read-only pass records reasons only; it neither changes those dispositions nor starts generation.

| First preflight blocker (attachment check precedes schedule check) | Cases |
| --- | ---: |
| `SERIES_ENDED_AFTER_TARGET` | 48 |
| `PREFIX_ATTACHMENT_UNREPLAYABLE` | 11 |
| `TARGET_AND_PREFIX_ATTACHMENT_UNREPLAYABLE` | 1 |
| `TARGET_ATTACHMENT_UNREPLAYABLE` | 1 |
| **Blocked total** | **61** |

The schedule result is a separate, overlapping diagnostic: **all 59 / 59** `UNRECOVERABLE` schedules first fail in `historicalSchedule(...)` at `SERIES_ENDED_AFTER_TARGET`. Of these, **11** also have an attachment blocker that the original preflight checks first (10 prefix-only, one target-and-prefix); the other **48** have schedule as their first blocker. The **two attachment-only** cases have reconstructable schedules: one target attachment, one bounded-prefix attachment. Their retained temporary attachment originals and blobs are `deleted` (one target original, two prefix originals). Thus 59 schedule-unrecoverable plus two attachment-only cases accounts for the 61 without hiding the overlap. No further failure reason is inferred after the first schedule fail-close.

Recovery assessment for the **current retained DB/Vault**: **A 0 / B 61 / C 0**. The 59 schedule cases all depend on the same post-target series end: the retained series is `ended`, version **3**, and the end path can physically delete untouched future occurrence tasks, reminders and events; there is no durable historical rule/occurrence snapshot in these tables. The two attachment-only cases have deleted originals and blobs. Consequently none is safely promotable from retained state by a narrower deterministic reconstruction. A separately preserved historical backup, if one exists, would require its own provenance and faithful-replay assessment; this diagnostic did not inspect or substitute one.

- Privacy-safe artifact: `fixtures/memory-r3-p0b-generation-blocker-diagnostic.json`, SHA256 `f79634918b3870b264f5c241cd328335408c3421c7e16f92cf6b2cda4a758f46`. It records trace/message IDs, disposition, first blocker, overlapping schedule blocker and attachment counts/status counts, without raw question, schedule text, title/detail, attachment name/content or note text.
- Two Pi executions streamed the diagnostic code over SSH and yielded byte-identical artifact bytes. SQLite `readonly=true`, `query_only=true`, `total_changes()` delta **0**; DB, WAL, SHM and Vault byte fingerprints matched before and after the paired run. No Pi script/artifact installation, production write, external API call or answer generation occurred.
- Focused P0-B tests: **19 passed**. Full `npm test`: **1,674 passed / 0 failed / 3 skipped** (1,677 total). A first sandboxed full run hit localhost `listen EPERM`; the unrestricted run passed. `git diff --check` passed.

The P0 protocol, 79-case census, 18 ready inputs, and strict historical replay rule are unchanged. The only possible next recovery avenue worth separate review is an independently preserved historical series/attachment snapshot; no recovery or generation was performed here.

## Schedule-context omission amendment and amended input freeze — 2026-09-29

> **CURRENT P0-B GENERATION INPUTS FROZEN — 66 GENERATION_READY / 13 INDETERMINATE_TOOL_REPLAY**
>
> **ANSWER GENERATION NOT STARTED — STRICT HISTORICAL EXACT S UNPROVEN**

The repository owner adopted the §53.7 pre-generation amendment after strict replay found 59/79 schedules unrecoverable (`SERIES_ENDED_AFTER_TARGET`), narrower retained-data reconstruction failed, and no relevant historical DB/Vault snapshot was found. The schedule-context channel is **omitted identically from all 79 operational cases and both arms**; no `활성 일정: 없음` block or historical empty-schedule claim is synthesized. Attachment replay remains strict. The prior 18/61 strict manifest (SHA256 `af674739a1cdf5b74e2b4f52994955fec4c84c48bbcb5434f9ffe3194beaf338`) and blocker diagnostic (SHA256 `f79634918b3870b264f5c241cd328335408c3421c7e16f92cf6b2cda4a758f46`) remain unchanged historical evidence.

- Latest GitHub `main` baseline: `58b55211886ad06008e78bd83d14edd96a5b948d`; execution code commit: `c07d496cd59aefd83352d4e73ed10190d41904dc`. The fixed 79-case operational census, target/history/time checks, both frozen D0 hashes, and D0-only arm invariant remain in force. The CLI defaults to the prior strict policy; this artifact used `--schedule-context omit`.
- Amended privacy-safe generation source of truth: `fixtures/memory-r3-p0b-generation-input-freeze-schedule-omitted.json`, SHA256 `c03332b19dc5158e9e866033b689f6538ec554719b168fea1aa0405090ee3455`. All **79** cases have `scheduleReplay=OMITTED_BY_AMENDMENT`; **66** are `GENERATION_READY`, **13** are `INDETERMINATE_TOOL_REPLAY` because their target or bounded prefix depends on unreplayable attachments; history and retrieval indeterminate counts are **0**. The 13 match the attachment-affected cases in the prior diagnostic. Non-ready cases remain in the denominator.
- Private 66-case bundle: `/private/tmp/galpi-p0b-generation-inputs-schedule-omitted.json` (outside Git, mode `0600`), SHA256 `08441a3c683b69e09a4bea91e82bee2deee235c613e2b95d456061996661db54`. Answer-stack SHA256 `c092d529cbcf41636cb45aa00e964056037db44cd9ca6f9f8764dc3b8b5af201`: exact model `gpt-6-luna`, frozen catalog generation **125**, Responses API, `medium`, 8,192 max output tokens, `store=false`, `current_turn`, `LIVE_TOOLS_DISABLED`, and schedule policy `OMITTED_IDENTICALLY_FOR_ALL_P0B_CASES`. Pi's current catalog generation **126** was observed read-only and was not substituted for the frozen generation 125 setting.
- Two final Pi executions produced byte-identical privacy-safe manifests and private bundles. SQLite `readonly=true`, `query_only=true`, `total_changes()` delta **0**. DB, WAL, SHM and Vault fingerprints matched before and after the final paired-run interval. No Pi script/artifact installation, production DB/Vault write, service restart, external API call, live tool execution or answer generation occurred.
- Focused P0-B tests: **22 passed**. Full `npm test`: **1,687 passed / 0 failed / 3 skipped** (1,690 total). `git diff --check` and manifest privacy/determinism checks passed.

This amended freeze estimates later ΔA only for the frozen answer stack **with schedule context omitted**, narrowing external validity relative to full production context. It does not imply that the historical schedule was empty or irrelevant, reproduce historical production answers, prove strict historical `S`/ΔR, or determine ΔA or GREEN/AMBER/RED. Next: run the frozen 2×2 generation protocol on the 66 ready inputs, with blind HUMAN adjudication and the 13 indeterminate cases retained for final bounds.

## Frozen 2×2 answer generation and blind packet — 2026-09-29

> **264/264 PLANNED SLOTS SUCCEEDED — 66 FOUR-ANSWER CASES FROZEN**
>
> **PRIMARY HUMAN ADJUDICATION NOT STARTED — NO ΔA OR GREEN/AMBER/RED RESULT**

- Latest GitHub `main` baseline: `0d42368c67c627b0338eb80d1f0106764bc90980`; generation implementation commit: `28ff11104b05f2581a7281a6e828764653309081`. The §53.7 generation-failure clarification applies the existing no-retry fail-close rule; no threshold, D0, schedule, census or materiality rule changed.
- Frozen committed input manifest SHA256 `c03332b19dc5158e9e866033b689f6538ec554719b168fea1aa0405090ee3455`; 66-case private bundle SHA256 `08441a3c683b69e09a4bea91e82bee2deee235c613e2b95d456061996661db54`; answer-stack SHA256 `c092d529cbcf41636cb45aa00e964056037db44cd9ca6f9f8764dc3b8b5af201`. Exact request model was `gpt-6-luna` for every call (Responses API, `medium`/`current_turn`, 8,192 max output tokens, `store=false`, no tools); the frozen catalog-generation provenance remained **125**. The provider reported `gpt-6-luna` on all successful responses. `OPENAI_BASE_URL` was empty, and SDK/client and per-request `maxRetries=0` were tested against 429, 500 and transport failures.
- The frozen 66-case private bundle was retained on the local research host rather than the Pi at generation start. Before generation it was transferred byte-for-byte to the Pi private research path `/home/pi/p0b-research-private/galpi-p0b-generation-inputs-schedule-omitted.json`; source, transferred temporary file, and final Pi file all matched SHA256 `08441a3c683b69e09a4bea91e82bee2deee235c613e2b95d456061996661db54`. The bundle was **not regenerated** from current DB/Vault state. Pi `/private/tmp` did not exist and required unavailable sudo access, so the repository owner approved the Pi home private path. The directory is mode `0700`, the bundle and all private artifacts mode `0600`.
- Before the first API call, the deterministic 264-slot interleaved plan (SHA256 `e7608b7ea4303b5f13498b7a7e6906e5bd9461c28be79510f3078c3b2fc75e8d`) and secret X/Y mapping (SHA256 `397fb6944d505f4ed004248afb8cd02a147d1c94f54dbf6f7013b2b8fad57363`) were durably frozen. The mapping and arm identities are private and are not disclosed in this receipt or the blind packet. Calls ran sequentially, one attempt per planned slot, with no replacement generation or early stopping.

| Generation result | Count |
| --- | ---: |
| Planned logical slots / SDK dispatches | 264 / 264 |
| Successful / failed / ambiguous slots | 264 / 0 / 0 |
| Complete four-answer cases | 66 |
| `INDETERMINATE_GENERATION_FAILURE` cases | 0 |
| Pre-existing `INDETERMINATE_TOOL_REPLAY` cases | 13 |

- Raw result artifact remains private on Pi at `/home/pi/p0b-research-private/generation/galpi-p0b-generation-results.json`, SHA256 `4bd2a6a43bef5817c1786d6d9ad06bc00339e807d54c1929b803f0c095387ff8`. The private blind HUMAN packet at `/home/pi/p0b-research-private/generation/galpi-p0b-generation-packet.json` contains 66 cases with original request, bounded historical conversation context and two responses per neutral X/Y group; decision fields are null. Packet SHA256 `092a91d11c9ee2d8c235ed59051d60fbfc9a4b9d1a7797f91c5b08cef6d4c707`. The privacy-safe committed [generation manifest](../fixtures/memory-r3-p0b-generation-freeze.json) has SHA256 `885481e55e0ece3beccdbaa104d237b088af0be17f2bbcd3507de2c82ec1d192` and contains no raw request, history, answer, mapping or retrieval context.
- A private Pi audit verified 264 unique planned slots, exactly one durable `DISPATCHING` and one `SUCCESS` per slot in planned order, request and response hashes, 66 complete packet cases, neutral packet structure and unfilled HUMAN fields. Generation read only the frozen private bundle, committed manifest, code and `.env`; it did not read or write production DB/Vault, run live tools, mutate chat/task/note state or restart the service. The only external provider calls were the **264** frozen OpenAI Responses requests. Focused P0-B tests: **28 passed**; full `npm test`: **1,693 passed / 0 failed / 3 skipped** (1,696 total); `git diff --check` passed.

Next: the repository owner performs the primary blind HUMAN adjudication on the private packet. No `MATERIAL_CHANGE`/`NO_MATERIAL_CHANGE` label, ΔA, policy winner or GREEN/AMBER/RED feasibility result is assigned here. The 13 attachment/tool-indeterminate cases remain in the operational 79-case denominator.
