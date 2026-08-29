# XION Memory R3-P0-A Feasibility Measurement Receipt

> 상태: **P0-A COMPLETE — P0-B NOT STARTED**
>
> 측정 기준 시각: 2026-08-29 KST

## Baseline

- 요청 후 첫 최신 `main` 재확인: `62ad111861991f0a71ecd4133578240a6f86478f`
- 구현 직전 추가된 최신 GitHub `main`: `6b3087c2227b5ac2aa4a436ba013d1e2b9ae682e`
  - `62ad111…` 이후 QV READ-ONLY probe 문서만 바뀌었고 retrieval/server/schema/tests/roadmap 관련 diff는 0이었다.
- implementation parent: `6b3087c2227b5ac2aa4a436ba013d1e2b9ae682e`
- implementation commit: `d7b59a41bf6e49b156c7b645e45e27cb66399c1c`
- implementation changed files:
  - `lib/assistant-retrieval-shadow.js`
  - `lib/memory-p0-research.js`
  - `scripts/measure-memory-p0-a.js`
  - `scripts/review-retrieval-policy.js`
  - `test/memory-p0-research.test.js`
  - `package.json`
- `server.js`와 production schema는 바꾸지 않았다.

## P0.1 — Online eligible volume

- 정의: `regular /api/chat A2 eligible retrieval invocations`
- window: `2026-08-01 00:00 KST <= trace < 2026-08-29 00:00 KST` — 최근 완전한 28 calendar days
- included mode: `chat:<runtimeGeneration>:a2`
- included channels: typed chat, 같은 `/api/chat` A2 retrieval path를 타는 half-duplex voice
- excluded: 별도 realtime/voice retrieval path, council, manual preview/eval, unrelated modes
- eligible runs: **181**
- `E`: **181 / 28 = 6.46 eligible requests/day**
- runtime generation: `gpt-single-v1` 181
- activation: **33 / 181 = 18.23%**
- abstention: **148 / 181 = 81.77%**
- errors: 0
- missing query hashes: 0
- invalid trace JSON: 0
- context chars: average **408.34**, p50 **0**, p95 **3,013**, max **6,853**
- saturation: **2 / 181 = 1.10%** — 6-chunk 상한 도달, 8,000자 도달은 0
- eligible run이 있었던 날: 19 / 28

확인 당시 A2 trace 총 189건은 fixed window의 denominator가 아니다. 7건은 window 시작 전, 1건은 window 종료 뒤인 2026-08-29 당일, 181건만 window 안이었다. 실행이 없는 9일은 실제 무사용과 logging outage를 trace만으로 구분할 수 없어 임의로 제외하지 않았다.

## P0.2 — Historical D0 retrieval sensitivity

- source corpus: 기존 A1b trace 79 runs / 77 unique historical queries
- comparable: **77 / 77**
- final D0 scorer/budget 고정:
  - Arm A `HARD-GATED`: 현재 candidate-note gate로 eligible chunk corpus를 먼저 제한
  - Arm B `GLOBAL-SOFT-PRIOR`: 전역 ready temporal chunk corpus 사용
  - 두 arm 모두 같은 current global scorer, score thresholds, note/chunk limits, per-chunk 1,400자, final 8,000자 context builder를 사용했다. 의도적으로 다른 것은 candidate-note hard gate뿐이다.
- `ΔR`: **3 / 77 = 3.90%**
- breakdown:
  - `ACTIVATION_CHANGE`: **3**
  - `MEMBERSHIP_CHANGE`: **0**
  - `ORDER_ONLY_CHANGE`: **0**
  - `SAME_VISIBLE_CONTEXT`: **74**
- P0-B forwarded query count: **3**
- P0-B candidate hashes:
  - `2967660800b25ecf4fe2f50988e392091712d9b77ae889176fe5842004b99e8c`
  - `01c5b85765a777cd963af29fddd5c351486000e63c78cfc97813c3f1007e7514`
  - `5685f1c7d73d44cbaabae4eea1e4ad5b983c4f2fbb5d14961642656404263f94`

기존 `review:retrieval-policy.changedQueries`는 사용하지 않았다. 그것은 legacy/current global-soft threshold 비교이고, 위 `ΔR`는 final reader-visible bounded context의 exact equality를 기준으로 D0를 새로 replay한 값이다. 구현 중 기존 `retrieve()`와 `retrieveGlobal()`을 그대로 비교하면 chunk threshold 차이까지 섞인다는 점을 발견해 그 preliminary result는 폐기했고, 최종 측정은 위 one-variable D0로 다시 실행했다.

### Query embeddings

- final accepted run generated count: **32**
- model: `text-embedding-3-small`
- input: historical query text만, production과 같은 8,000자 truncation과 `encoding_format: float`
- failures: **0**
- lifetime: in-memory only, replay 종료 후 폐기
- DB persistence: none
- Vault persistence: none
- 구현 중 threshold confound 보정과 최종 safety 출력 재확인 때문에 같은 32개 query batch를 총 3회 호출했다. 따라서 실제 외부 호출은 3 batches / returned embeddings 96개이며 OpenAI 비용·provider-side request logging 가능성은 있다. Galpi persistent state에는 저장하지 않았다.

### Point-in-time caveats

- 양 arm 모두 `chunk.created_at < historical trace.created_at`인 현재 `ready` topic chunks만 사용했다. cutoff 뒤 chunk는 양 arm에서 제외하는 테스트가 있다.
- 현재 note embedding을 재사용하므로 query 이후 topic content가 note-ranking prior에 섞였을 수 있다.
- 현재 corpus에서 사라졌거나 이후 내용이 바뀐 historical chunk는 원시점 상태로 복원하지 못한다.
- historical active-note input은 trace에 완전 저장되지 않는다. output의 `explicit=true` notes만 복원하고 나머지는 빈 목록으로 두는 approximation을 77건 모두에 적용했다. final corpus에서 explicit output note는 0건이었다.
- P0-A는 feasibility preflight이므로 위 approximation을 숨기지 않고 유지한다. GREEN/AMBER/RED 경계 판단은 `ΔA`가 필요한 P0-B 전에는 하지 않는다.

## Safety and verification

- Galpi persistent state: **read-only**
- production DB write: **no**
- Vault write: **no**
- schema change: **no**
- production retrieval behavior change: **no**
- P0-B answer generation: **no**
- research DB connection: SQLite `readonly=true`, `query_only=true`, `total_changes() delta=0`
- production service restart: **no** — 측정 뒤에도 PID `336573`, start `2026-08-27 01:16:12 KST`, active/running
- Pi on-disk에는 opt-in research CLI/helper/tests와 기존 helper export만 복사했다. 실행 중인 server process에는 reload하지 않았다.
- 외부 effect: 위 OpenAI embedding 호출. `zero external side effect`라고 주장하지 않는다.
- 운영 안전 백업:
  - DB `/home/pi/backups/galpi/galpi-20260829-2208.db`
  - Vault `/home/pi/backups/galpi/vault-20260829-2208.tar.gz`
  - code `/home/pi/backups/galpi/code-memory-p0-a-pre-20260829-2210.tar.gz`
  - threshold 보정 전 code `/home/pi/backups/galpi/code-memory-p0-a-threshold-pre-20260829-2220.tar.gz`
  - 기존 backup prune 0
- 배포 파일 SHA-256은 로컬/Pi가 일치했다.

실제로 실행한 테스트:

- local focused retrieval/P0 regression: 47 / 47
- local full regression, final code: **960 / 960**
- Pi focused retrieval/P0 regression: **47 / 47**
- Pi full regression, final code: **960 / 960**
- 세 파일 `node --check`, CLI `--help`, local/Pi SHA-256 대조
- 최초 local full 재실행 한 번은 sandbox가 `127.0.0.1` listener를 `EPERM`으로 막아 유효한 test result로 세지 않았고, 승인된 정상 권한 재실행 960/960으로 대체했다.

추론만 하고 실행하지 않은 테스트: **없음**.

## Stop condition

P0-A 완료 조건까지만 수행했다. GREEN / AMBER / RED를 판정하지 않았고, paired answer generation과 `ΔA` 측정은 시작하지 않았다.

## Follow-up — Current A2 invocation-weighted D0 sensitivity

> 상태: **CONDITIONAL MEASUREMENT COMPLETE — `INDETERMINATE_PIT`**
>
> P0-B: **NOT STARTED**
>
> 측정·배포 확인일: 2026-08-30 KST

### Baseline

- 작업 시작과 종료 직전에 확인한 latest GitHub `main`: `f0d825311708b19e23d899f46cc40f53baed3222`
- implementation commit: `a7f89dda4775a563412d6884a225c32d015fb4db`
- parent commit: `f0d825311708b19e23d899f46cc40f53baed3222`
- implementation changed files:
  - `lib/assistant-retrieval-shadow.js`
  - `lib/database-migrations.js`
  - `lib/memory-p0-research.js`
  - `scripts/measure-memory-p0-a.js`
  - `scripts/review-retrieval-policy.js`
  - `server.js`
  - `test/assistant-retrieval.test.js`
  - `test/database-migrations.test.js`
  - `test/memory-p0-research.test.js`

### A. Current 181-invocation conditional measurement

- fixed window: `2026-08-01 00:00 KST <= trace < 2026-08-29 00:00 KST`
- denominator: 기존 P0.1과 같은 `regular /api/chat A2 eligible retrieval invocations`
- eligible invocations `N`: **181** — repeated query도 invocation마다 세었고 unique-query dedupe를 하지 않았다.
- query resolution:
  - `RESOLVED`: **181**
  - `AMBIGUOUS`: **0**
  - `MISSING`: **0**
  - coverage: **100%**
- exact resolver contract: 같은 `session_id`, exact `query_sha256`, 인접한 user/assistant pair, assistant `runtime_generation`, trace와 다음 regular A2 trace 사이 timestamp interval을 모두 만족해야 한다. SQLite의 초 단위 timestamp 때문에 cross-table ordering을 증명할 수 없는 same-second 후보는 임의 선택하지 않고 `AMBIGUOUS`로 분류한다.
- query embeddings:
  - stored embeddings used: **181**
  - generated embeddings: **0**
  - external API batches: **0**
  - failures: **0**
  - DB/Vault persistence: **none**
- D0 arms:
  - Arm A `HARD-GATED`: current candidate-note gate로 corpus를 제한한 뒤 final scorer/budget 적용
  - Arm B `GLOBAL-SOFT-PRIOR`: global ready temporal corpus에 같은 final scorer/budget 적용
  - query, embedding, cutoff, source corpus, scorer, thresholds, note/chunk limits, per-chunk limit, final 8,000-char context budget은 같고 candidate-note hard gate만 다르다.
- point-in-time source cutoff: 양 arm 모두 `chunk.created_at < trace.created_at`
- active-note input: historical trace에 실제 invocation input이 저장되지 않아 **181 / 181을 `activeNotes=[]`로 replay**했다. output `notes_json`은 input active notes의 증거로 사용하지 않았다.

이 결과의 이름은 **`conditional ΔR under empty-activeNotes approximation`**이며 exact current ΔR가 아니다.

- conditional sensitive count: **25 / 181 = 13.81%**
- `ACTIVATION_CHANGE`: **15**
- `MEMBERSHIP_CHANGE`: **9**
- `ORDER_ONLY_CHANGE`: **1**
- `SAME_VISIBLE_CONTEXT`: **156**
- query-resolution-only bounds:
  - sensitive count: **25 .. 25**
  - `ΔR`: **13.81% .. 13.81%**
- active-note/PIT uncertainty를 포함한 conservative bounds:
  - sensitive count: **0 .. 181**
  - `ΔR`: **0% .. 100%**
- gate result: **`INDETERMINATE_PIT`**

Query resolution은 완전하지만, 실제 active-note input을 181건 모두 복원할 수 없다. 그 input은 hard gate의 candidate corpus를 바꿀 수 있고 conditional sensitive count 25를 RED boundary 20 아래로도 바꿀 수 있으므로, 이 approximation만으로 exact current ΔR나 RED를 주장하지 않는다. P0-B paired answer generation과 `ΔA` 측정은 시작하지 않았다. 다음 판단에는 future exact-window trace가 필요하다.

그 밖의 PIT 한계도 남는다. current note embedding 재사용에는 trace 이후 topic 내용이 prior에 섞일 수 있고, 현재 corpus에서 삭제·수정된 당시 chunk를 원형대로 복원하지 못할 수 있다. Accepted cutoff가 이 한계를 없애지는 않는다.

Traffic represents current development-stage organic usage and is not assumed to represent mature XION usage.

### B. Future exact active-note instrumentation

- schema v23 migration `retrieval_trace_active_notes_input`이 `assistant_retrieval_shadow_runs.active_notes_json TEXT NULL` column 하나를 추가했다.
- 새 trace의 의미:
  - `[]`: 실제 invocation input에 active note가 정확히 없었음
  - `["<filename>", ...]`: 실제 input의 stable note filename 목록
  - `NULL`: historical / not observed / unknown
- historical row를 빈 배열로 backfill하지 않았다. 배포·재시작 뒤 전체 287 rows와 fixed-window 181 rows가 모두 `NULL`임을 read-only query로 확인했다.
- `notes_json`은 reader에게 노출된 output retrieval notes라는 기존 의미를 유지하고, `active_notes_json`은 input active notes만 기록한다.
- 새 field에는 query 원문, note body/content, note title을 넣지 않는다. filename도 사용자 자료의 존재를 드러낼 수 있는 metadata이므로 기존 assistant retrieval shadow trace와 같은 DB 접근·retention/privacy 경계 안에만 둔다.
- current retrieval result/context와 thresholds는 바꾸지 않았다. trace insert는 기존처럼 best-effort이고 serialization/DB write 실패가 assistant request를 실패시키지 않는다.
- synthetic production chat은 만들지 않았다. 따라서 재시작 직후 `observedRows=0`은 정상이며, 새 row의 `[]`/filename 기록 경로는 unit/regression tests로 검증했다.

### Safety and verification

#### A. Read-only measurement

- Galpi persistent state: **read-only**
- production DB research write: **no**
- research connection: SQLite `readonly=true`, `query_only=true`, `total_changes() delta=0`
- Vault write: **no**
- Vault tree SHA-256 before/after: `91a56154bf9ec7b59e1868e9661b89da90b395264fcf8a6ec6f8b543f0d094d1`
- OpenAI/external API calls: **0**
- normal message/topic/task/memory write: **no**
- P0-B answer generation: **no**

#### B. Instrumentation deployment

- production DB write: **yes — schema v23 migration only**
- schema change: **yes — nullable column 1개, historical backfill 없음**
- Vault write: **no**
- production retrieval result/context behavior change: **no**
- telemetry behavior change: **yes — future trace input filenames 기록**
- service restart: **yes** — 2026-08-30 00:05:40 KST, PID `348404`, active/running
- health check: `GET /api/config` **200**
- pre-deploy backups:
  - DB `/home/pi/backups/galpi/galpi-20260829-2342.db`
  - Vault `/home/pi/backups/galpi/vault-20260829-2342.tar.gz`
  - code `/home/pi/backups/galpi/code-memory-p0-current-pre-20260829-2342.tar.gz`

실제로 실행한 테스트:

- local focused P0/retrieval/migration regression, final code: **64 / 64**
- local full regression, final code: **968 / 968**
- Pi focused P0/retrieval/migration regression, final code: **69 / 69**
- Pi full regression, final code: **968 / 968**
- Pi read-only measurement: **executed**
- Pi post-restart schema/query-only inspection and health check: **executed**
- source/schema wiring inspection and local/Pi file hash comparison: **executed**

실행하지 않은 것:

- P0-B paired answer generation / `ΔA`: **not executed**
- synthetic production invocation으로 새 telemetry row 생성: **not executed** — normal user data write를 만들지 않기 위해 의도적으로 생략했다.
- GitHub CI: **확인되지 않음**

Local/Pi PASS로 기록됐으며 GitHub CI에서 독립적으로 재현된 것은 확인되지 않았다.
