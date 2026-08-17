# PR #20 — Frog-in-the-Pan / Information Discreteness

> **결과를 계산하기 전에 작성한 사전등록 문서다.** 결과를 본 뒤 이 문서의 판정 기준을
> 고치지 않는다. **Stage A와 Stage B의 규칙을 Stage A 결과가 나오기 전에 전부 적는다.**

로드맵은 `docs/momentum-v2-roadmap.md`이고 이 PR은 그 **Phase 6**이다. 알파 개입 예산
네 번 중 **마지막 카드**다.

|개입|결과|
|---|---|
|1. 시장 상태 (PR #15·#16)|**유지** — `G` −10.82% → +4.99%|
|2. 종목 absolute momentum (PR #17)|`NON_BINDING` · 종료|
|3. signal-aligned exit (PR #18)|`RISK_ONLY` · 종료|
|**4. FIP quality (이 PR)**|—|

**이 PR이 실패하면 long-only cross-sectional momentum 단독 전략의 alpha construction을
종료한다.** 다른 quality indicator를 찾지 않는다.

---

## 1. 묻는 것

> **같은 RS126 momentum이라도, 많은 작은 움직임으로 연속적으로 형성된 momentum을
> 선호하면 현재 gated J126 전략의 signal quality와 portfolio economics가 개선되는가?**

### 현재 살아남은 strategy candidate

```
J126 · skip 5 · SPY > SMA200 신규진입 gate · RS TOP5 · K42 fixed hold · S5
현재 volatility-scaled sizing · 현재 execution / costs / delisting handling
```

**PR #19에 따라 `2ATR`·0.25%는 volatility sizing budget으로 읽는다.** hard stop은 전략
stack에 없다.

---

## 2. 논문 아이디어와 이번 adaptation의 차이

Da·Gurun·Warachka(2014)의 Frog-in-the-Pan 가설은, 같은 누적 momentum이라도 **작고 잦은
움직임으로 쌓인**(continuous) 종목이 **몇 번의 큰 jump로 오른**(discrete) 종목보다 이후
continuation이 강하다고 본다. 투자자가 연속적인 작은 정보에 덜 반응하기 때문이라는 설명이다.

**논문의 전략을 그대로 복제한다고 쓰지 않는다.** 차이를 먼저 적는다.

|항목|논문|이번|
|---|---|---|
|formation|12−1 개월|**frozen RS와 동일한 `lookback=126, skip=5`**|
|포지션|winner−loser 스프레드|**long-only TOP5**|
|선택|ID 십분위 등|**`ID < 0` 이진 조건 하나**|
|시장 조건|없음|**`SPY > SMA200` 게이트 위에서**|

**새 formation window를 열지 않는다.** RS와 정확히 같은 두 endpoint를 쓰는 것이 이번
설계의 핵심이다 — window가 다르면 "같은 momentum의 경로를 본다"는 주장 자체가 성립하지
않는다.

---

## 3. `ID(126,5)` exact formula

### PRET — RS의 자기 항을 그대로 재사용한다

```
PRET = absolute_momentum(adjusted_closes, lookback=126, skip=5)
     = log(P[t-5] / P[t-126])
```

**산술을 복제하지 않는다.** `features.absolute_momentum`이 정본이고, `relative_strength`가
이미 그 함수의 자기 항을 쓴다. 복제하면 언젠가 한쪽만 바뀌어 "같은 formation interval"이라던
두 값이 조용히 달라진다.

### 부호 빈도

formation interval **안**의 일별 adjusted-close return 부호를 센다.

```
n_pos  = 양의 daily return 개수
n_neg  = 음의 daily return 개수
n_zero = 0 return 개수        (분모에서 제외)
```

### ID

```
sign(PRET) = +1  if PRET > 0
              0  if PRET = 0
             -1  if PRET < 0

ID = sign(PRET) × (n_neg − n_pos) / (n_pos + n_neg)

단  n_pos + n_neg == 0  이면  ID = 0
```

범위는 `-1 <= ID <= +1`이다.

|ID|뜻|
|---|---|
|낮음(음수)|**continuous information** — 부호가 PRET 방향으로 자주 반복됐다|
|높음(양수)|**discrete information** — 몇 번의 큰 움직임이 누적을 만들었다|

**daily return의 크기로 가중하지 않는다.** 부호의 **빈도**만 본다. 크기로 가중하면 RS의
magnitude 정보와 역할이 겹쳐 ablation의 뜻이 흐려진다.

### 왜 `n_neg − n_pos`인가

winner(`PRET > 0`)가 작은 양의 수익을 자주 쌓으면 `n_pos > n_neg`라 분자가 음수가 되고
`sign(PRET) = +1`이므로 **ID가 음수**다 — continuous. loser가 작은 음의 수익을 자주
쌓으면 `n_neg > n_pos`로 분자가 양수인데 `sign(PRET) = -1`이라 역시 **ID가 음수**다.
부호가 방향과 무관하게 "연속성"을 재도록 하는 것이 `sign(PRET)` 인자의 역할이다.

---

## 4. 가격 데이터 계약

**ID는 반드시 adjusted close로 계산한다.** raw close를 쓰면 분할·배당이 daily sign을
왜곡해서 "정보 경로"가 아니라 corporate action을 재게 된다.

formation interval은 RS와 **정확히 동일**해야 한다. 다음 window를 열지 않는다.

```
252 · 21 · 60 · 120 · 6개월 · 12개월 — 전부 금지
FIP window sweep 금지
```

---

## 5. threshold — 결과 전에 하나로 고정

```
ID < 0   → CONTINUOUS → 후보 통과
ID >= 0  → 후보에서 제외
```

`0`은 새로 최적화한 숫자가 아니라 **ID의 자연스러운 부호 경계**다.

**금지 목록**

```
ID median threshold          tercile / quintile / decile sweep
-0.1 / -0.2 / +0.1 탐색      percentile threshold
z(ID)                        RS와 ID의 weighted sum
RS − λ×ID                    λ 탐색
top-N 변경
```

**FIP가 실패하면 threshold를 바꿔 재시험하지 않는다.**

---

## 6. ABS를 몰래 되살리지 않는다

FIP는 **`ID < 0`만** 본다. 다음 조건을 **추가하지 않는다.**

```
PRET > 0
ABS(126,5) > 0
```

PR #17에서 ABS candidate condition은 `NON_BINDING`으로 끝났다. 그 조건을 FIP에 묶으면
intervention이 둘이 되어 이 PR이 무엇을 잰 것인지 말할 수 없게 된다.

**다만 진단으로는 반드시 보고한다.**

- FIP treatment TOP5 중 `PRET <= 0`인 비율
- 실제 FIP portfolio entry 중 `PRET <= 0`인 비율

**0이 아니어도 post-hoc ABS filter를 추가하지 않는다.** limitation으로만 기록한다.

---

## 7. helper 구현 계약

`backtest/features.py`에 순수 helper를 추가한다.

```python
information_discreteness(values: list[float], lookback: int, skip: int) -> float
```

지켜야 할 것:

- `absolute_momentum()`을 PRET에 **재사용**
- **adjusted closes만** 입력받음
- deterministic · 미래 데이터 없음
- RS와 **same formation endpoints**
- zero-return correction

### `Features` dataclass와 `features_daily` schema를 건드리지 않는다

**FIP field를 억지로 추가하지 않는다.** 추가하면 `feature_hash`가 바뀌어 기존 캐시와 과거
연구 산출물까지 흔들린다. FIP는 현재 **마지막 연구 intervention**이므로 필요한 곳에서
helper로 계산하는 최소 변경을 택한다.

---

## 8. 두 Stage

```
Stage A — Signal Quality
Stage B — Portfolio Translation   ← Stage A가 PASS일 때만
```

**Stage A가 실패하면 Stage B를 실행하지 않는다.** Stage A 결과를 보고 Stage B의 threshold나
규칙을 바꾸지 않는다. 아래 §17~§26이 Stage B의 전문이고 **지금 확정한다.**

러너가 Stage A 결과 파일을 읽어 promotion이 아니면 treatment run을 **거부하도록** 만든다 —
실수로 signal failure 뒤 portfolio를 돌릴 수 없게 한다.

---

## 9. Stage A — 질문

> `SPY > SMA200`인 개발표본에서, `ID(126,5) < 0`인 후보 안에서 다시 뽑은 RS126 TOP5가
> **같은 날짜의** 기존 RS126 TOP5보다 +42 forward excess를 높이는가?

**포트폴리오를 아직 돌리지 않는다.**

---

## 10. Stage A — control / treatment

|팔|정의|
|---|---|
|**control**|current J126 · `SPY > SMA200` 날짜 · eligible universe · RS126 ranking · TOP5|
|**treatment**|**same** eligible universe · **same** RS values · `ID(126,5) < 0` candidate condition · 살아남은 이름을 **SAME RS**로 정렬 · TOP5|

### 필터 위치

```
PIT universe
  → liquidity / history eligibility
  → RS / ID 계산
  → ID < 0 candidate condition
  → SAME RS ordering
  → TOP5
```

**기존 score population을 FIP 때문에 다시 정의하지 않는다.** z-score 모집단은 기존
eligible universe이고 FIP는 **후보 조건**이다.

**survivor가 5개보다 적으면 그날 treatment basket은 5개보다 적어도 된다.** `ID >= 0`
이름으로 강제 backfill하지 않는다.

---

## 11. Stage A — primary

PR #17과 **동일한 날짜 paired 구조**를 재사용한다.

```
Control_t = 기존 RS126 TOP5의 +42 forward excess 평균
FIP_t     = ID < 0 후보에서 뽑은 RS126 TOP5의 +42 forward excess 평균
D_t       = FIP_t − Control_t

primary   = mean(D_t)
```

**두 전체 평균을 따로 계산하고 빼지 않는다.** 같은 날짜의 paired difference다.

|항목|값|
|---|---|
|primary universe|`ALL` = SP500 ∪ NDX100|
|replication|`NDX100`|
|primary horizon|**+42**|

**새 horizon을 승격 criterion으로 추가하지 않는다.**

---

## 12. Stage A — checksum

`SPY > SMA200` / J126 / +42에서 기존 observation-weighted control이 재현되어야 한다.

|유니버스|기존 reference|
|---|---:|
|ALL|약 **+1.188%**|
|NDX100|약 **+2.043%**|

**정확한 값은 기존 JSON(`runs/absolute-momentum-signal/*.json`)을 source of truth로 읽어
비교한다.** drift가 있으면 FIP 결과를 해석하지 않는다.

---

## 13. Stage A — diagnostics

최소 보고 항목.

- valid paired dates
- control TOP5 observation count
- FIP pool size
- treatment basket size
- empty treatment dates
- composition changed dates · changed-date share
- mean TOP5 overlap
- candidate replacement rate
- **ID distribution**: count · mean · median · p10 · p25 · p75 · p90
- control TOP5 중 `ID < 0` 비율
- treatment TOP5 중 `PRET <= 0` 비율
- by-year `D`
- 42-phase non-overlap stability
- leave-one-year-out
- changed-only `D`

**overlapping forward observations를 독립 표본처럼 읽지 않는다. p-value를 새로 만들지
않는다.**

---

## 14. Stage A — random diagnostic

PR #17 방식대로 deterministic random seeds **`0..19`**를 쓴다. 같은 날짜·같은 eligible
pool·같은 FIP condition에서 paired random을 만든다.

목적은 hard criterion을 새로 만드는 것이 아니라 **FIP 자체의 효과와 RS ranking과의 결합
효과를 가르는 것**이다. **20 seeds를 formal p-value라고 부르지 않는다.**

---

## 15. Stage A — hard verdict (A~E)

**새 기준을 만들지 않고 PR #17 ABS signal study의 HARD A~E를 그대로 재사용한다.**

|기준|조건|
|---|---|
|**A**|`NON_BINDING`이 아닐 것|
|**B**|primary `mean(D) > 0`|
|**C**|`median(D) >= 0`|
|**D**|42-phase positive share ≥ **60%**|
|**E**|NDX100 paired `mean(D) >= 0`|

정확히 다섯 개다.

```
모두 PASS      → PROMOTE_FIP_TO_PORTFOLIO
하나라도 FAIL  → DO_NOT_TRANSLATE_FIP
```

### Stage A가 FAIL이면

- portfolio core를 **만들지 않는다**
- Stage B를 **실행하지 않는다**
- 다른 FIP threshold를 시험하지 않는다
- TrendQuality를 부활시키지 않는다
- 다른 quality filter를 열지 않는다

그리고 다음을 기록한다.

```
momentum alpha intervention 4/4 consumed
standalone momentum alpha construction terminated
```

---

## 16. Stage B — 조건부 실행

**Stage A가 `PROMOTE_FIP_TO_PORTFOLIO`일 때만 실행한다.**

---

## 17. Stage B — control

control은 현재 살아남은 코어 **`jt-j126-k42-sma200`**이다.

LAST_CLOSE expected checksum:

|항목|기대|
|---|---:|
|trade_count|**445**|
|total return|**+47.84%**|
|expectancy|**+0.343** (legacy 2ATR volatility-unit)|
|PF|**1.47**|
|Sharpe|**0.46**|
|MDD|**12.0%**|
|avg exposure|**16.4%**|
|`G`|**+4.99%**|
|fees|약 **$10,993**|

**PR #19 이후 risk semantics를 그대로 따른다** — `0.343`을 actual stop-risk R이라고 부르지
않는다.

---

## 18. Stage B — treatment

새 코어 **`jt-j126-k42-sma200-fip`**. control과 **정확히 하나만** 다르다.

```
candidate condition:  ID(126,5) < 0
```

나머지 — J126 · skip5 · SMA200 new-entry gate · RS ordering · TOP5 · K42 · S5 ·
volatility sizing · portfolio limits · execution · costs · delisting ·
LAST_CLOSE/ZERO — **전부 동일하다.**

**FIP 때문에 다음을 하지 않는다.**

```
score weight 변경 금지    RS score 수정 금지    slots 변경 금지
sizing 변경 금지          exit 변경 금지
```

---

## 19. Stage B — entry mode 구현

최소 변경을 우선한다.

```
FIP_ENTRY        = "RS_ONLY_FIP"      ID < 0 gate + 기존 RS_ONLY score
FIP_RANDOM_ENTRY = "RANDOM_FIP"       동일 ID < 0 gate + 기존 deterministic random_score
```

**두 모드의 FIP candidate pool이 정확히 같아야 한다.** random 쪽이 다른 필터를 쓰면 비교가
불가능하다.

**기존 `CORE`·`RS_ONLY`·`RANDOM`의 behavior는 bit-identical해야 한다.**

---

## 20. `rank_candidates`의 invariant

FIP condition이 들어와도 다음은 control과 같다.

```
eligible universe · score_population · RS 계산 · z-score 모집단
```

그 뒤 ID condition으로 **passed candidate만** 제한한다. 즉 **FIP filter 때문에 RS z-score를
filtered subset에서 다시 계산하지 않는다.**

현재 single-RS score에서는 순위가 같더라도 **실험 의미와 감사 기록을 분리하기 위해** 이
invariant를 지킨다.

skip reason은 명확히 남긴다.

```
FIP_NOT_CONTINUOUS
```

---

## 21. Stage B — random control

최종 전략의 "random ranking 대비 우위"를 확인하려면 **FIP treatment와 같은 candidate
pool의 random**이 필요하다.

```
FIP_RANDOM_ENTRY · seeds 0..9 · LAST_CLOSE portfolio run 10개
```

기존 `RandomStats`를 재사용한다. **새 random 통계를 구현하지 않는다.**

primary random comparison은 **exposure-matched gap `G`**로 한다. 실제 FIP strategy의 `G`가
random-FIP 10개의 `G`를 몇 개 이기는지 보고하고, 저장소의 기존 의미대로 **`10/10`이어야
random distribution 밖**이라고 부른다. total-return random position도 같이 보고하되
**primary는 `G`다.**

---

## 22. Stage B — primary economics

**LAST_CLOSE가 primary.**

```
S = after-cost strategy total return
B = exposure-matched SPY total return
G = S − B

ΔS = S_fip − S_control
ΔB = B_fip − B_control
ΔG = G_fip − G_control

ΔS = ΔB + ΔG      (정의상 닫힌다. 잔차도 출력한다)
```

**PR #16 helper를 재사용한다.** `F`/`T` decomposition도 보조로 유지한다.

---

## 23. Stage B — secondary

control vs FIP — total return · CAGR · expectancy · PF · win rate · Sharpe · Sortino ·
Calmar · MDD · avg exposure · turnover · fees · trade count · entry count · avg hold ·
exit distribution · matched-SPY `G` · `F`/`T` decomposition.

**FIP mechanism**

- `FIP_NOT_CONTINUOUS` skip count
- candidate composition changed share
- actual entries blocked by FIP
- control vs treatment entry-set overlap
- entry-day ID distribution
- `PRET <= 0` treatment-entry count / share

---

## 24. component marginal criterion

PR #18의 marginal 철학을 재사용한다. **다음을 모두 만족**해야 한다.

|#|조건|
|---|---|
|1|`ΔG > 0`|
|2|`ΔS > 0`|
|3|`Sharpe_FIP >= Sharpe_control`|
|4|control이 이미 통과하던 numeric minimum을 깨지 않을 것 — `G > 0` · total > 0 · expectancy > 0 · `PF ≥ 1.15` · `MDD ≤ 15%`|

```
모두 만족   → MARGINAL_PASS
하나라도 실패 → MARGINAL_FAIL
```

---

## 25. final strategy gate

FIP는 alpha budget의 **마지막 카드**다. 따라서 marginal improvement만 보고 또 다음 alpha
실험으로 넘어가면 안 된다. **FIP treatment 자체가 최종 §4 경제성 허들을 만족하는지** 본다.

### 필수 numeric

```
G > 0
total return > 0
expectancy > 0
PF >= 1.15
Sharpe >= 0.60
MDD <= 15%
```

### Random

```
FIP strategy G beats random-FIP G  10/10
```

### ZERO

**ZERO scenario도 반드시 실행한다.** "구조적 붕괴 없음"은 새 임의 수익률 threshold를
만들지 않고 **literal structural condition**으로 고정한다.

```
- run이 정상 종료
- equity가 0 이하가 되지 않음
- non-finite metric 없음
- engine / account failure 없음
```

ZERO의 total · `G` · MDD · PF · Sharpe는 **별도로 보고한다.** **ZERO 결과가 나쁘면 숨기지
않는다.**

---

## 26. 최종 outcome — 결과 전에 고정

가능한 결과는 **정확히 넷**이다.

### A. `FIP_SIGNAL_REJECTED`

Stage A HARD A~E 중 하나라도 FAIL.

- portfolio translation 없음
- FIP 폐기
- **alpha interventions 4/4 소진**
- standalone long-only momentum construction **종료**
- **Phase 7로 가지 않음**

### B. `FIP_PORTFOLIO_REJECTED`

Stage A PASS, Stage B `MARGINAL_FAIL`.

- FIP signal evidence는 연구 기록으로 남음
- strategy component로는 폐기
- **alpha interventions 4/4 소진**
- standalone momentum construction **종료**
- **Phase 7로 가지 않음**

### C. `FIP_IMPROVES_BUT_STRATEGY_FAILS`

Stage A PASS, Stage B `MARGINAL_PASS`, final strategy gate FAIL.

- FIP의 marginal contribution은 **인정**
- 그러나 전체 전략은 아직 기준 미달
- **결과가 좋다고 fifth alpha card를 만들지 않음**
- standalone momentum strategy family **종료**
- **Phase 7로 가지 않음**

### D. `FIP_PROMOTED_STRATEGY_QUALIFIES`

Stage A PASS, Stage B `MARGINAL_PASS`, final strategy gate PASS.

- FIP를 strategy stack에 포함
- strategy candidate freeze 준비
- 다음은 **PR #21 Reality Hardening**

> **final gate만 통과하고 marginal이 FAIL하는 경우도 D가 아니다.** component가 자기
> 기여를 증명하지 못하면 넣지 않는다.

---

## 27. Holdout

**`2025-08-07` 이후를 절대 읽지 않는다.** 기존 `research_calendar()` · `research_window()` ·
`assert_no_holdout()`을 재사용한다.

**signal forward target도 `<= 2025-08-06`이어야 한다.** 달력 자체가 잘려 있어 `t+42`가
넘어갈 수 없다.

모든 JSON에 **`HOLDOUT_CONSUMED = false`**를 남기고 **개발 표본**이라고 명시한다.
**formal OOS라고 부르지 않는다.**

---

## 28. 절대 하지 않을 것

```
J 변경            K 변경            skip 변경         TOP5 변경
slots 변경        sizing 변경       risk budget 변경
hard stop 부활    signal invalidation exit 부활       ABS 조건 결합
TrendQuality 부활 slope × R² 재시험  breakout          52-week high
ADX               RSI               MACD              volume filter
earnings momentum FIP threshold sweep                 FIP window sweep
ID percentile optimization           composite score
RS × ID           RS − λID          new regime        SMA 변경
holdout 사용
```

**FIP가 실패하면 끝이다.**

---

## 29. 산출물

```
trading/runs/fip-quality/README.md          ← 이 문서 (결과 전 커밋)
trading/runs/fip-quality/signal-all.json
trading/runs/fip-quality/signal-ndx100.json
```

Stage B를 실행했다면 추가로:

```
control-last_close.json · control-zero.json
fip-last_close.json     · fip-zero.json
random-fip-seed00-last_close.json … random-fip-seed09-last_close.json
results.md
```

`results.md` 구조는 19절이다 — 질문 · academic idea vs adaptation · prereg checksum ·
Stage A signal result · binding/ID distribution · stability/NDX/random · Stage A A~E verdict ·
Stage B 실행 여부 · control reproduction · portfolio S/B/G · secondary economics ·
FIP mechanism · random-FIP distribution · ZERO · MARGINAL · final gate · final outcome ·
limitations · holdout statement.

---

## 30. 개발 표본이다

이 구간은 PR #9~#19에서 반복 사용됐다. 결과를 **"OOS 검증"이라고 부르지 않는다.**

연구 코어는 `require_earnings_calendar=False`라 `EARNINGS_GATE_DISABLED` blocker가 항상
붙는다(로드맵 §7 C5). 이 PR의 판정은 그 게이트와 다른 층이다.
