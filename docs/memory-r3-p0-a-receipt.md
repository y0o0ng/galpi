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
