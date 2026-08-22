# PR #15 — Confirmatory Market Conditioning Signal Study

> **이것은 discovery study가 아니라 confirmatory market re-cut이다.**
> 결과를 계산하기 **전에** 작성한 사전등록 문서다. 결과를 본 뒤 이 문서의 판정 기준을
> 고치지 않는다.

로드맵은 `docs/trading/momentum-v2-roadmap.md`이고 이 PR은 그 **Phase 1**이다.

---

## 1. 묻는 것

> `RS(126,5)` TOP5의 **+42 forward excess return**이 시장이 SPY의 SMA200 **위**에 있을 때와
> **아래**에 있을 때 구조적으로 다른가?

더 구체적으로:

> J126의 signal-level alpha가 `SPY close > SMA200`인 시장 상태에 **안정적으로** 집중되는가?

**이것은 아직 아니다:**

- entry gate backtest가 아니다
- portfolio experiment가 아니다
- 새 strategy core가 아니다

**신호 층 confirmatory diagnostic이다.**

---

## 2. 왜 discovery가 아닌가 (로드맵 §7 C2)

`runs/signal-j-study/all.json`에 J별 레짐 결과가 **이미 저장돼 있고**,
`classify_market_regime`의 정의상

```
BULL, CORRECTION  ⟺  SPY > SMA200
RECOVERY, BEAR    ⟺  SPY ≤ SMA200
```

이므로 **헤드라인 split의 일부 정보는 이미 알려져 있다.** `CLAUDE.md`도 한 칸을 공개하고
있다 — "`RECOVERY/HIGH_VOL`에서 J189 −2.77% · J126 −0.55%".

**그래서 반드시 `CONFIRMATORY MARKET RE-CUT`이라고 표현한다.**

**금지 표현:**

- "새로운 시장 상태 효과를 발견했다"
- "처음으로 확인했다"
- "독립 OOS replication"

**이 PR의 추가 가치는 다음 다섯 축이다** — 이것들은 `all.json`에 없다.

1. **J63 frozen control**
2. **same-size random control** (기존 시드 20개)
3. **non-overlapping temporal stability** (+42 위상)
4. **calendar-year distribution** (+ leave-one-year-out)
5. **NDX100 sub-universe replication / robustness**

**NDX100도 `ALL`과 완전히 독립적인 OOS 표본이 아니다.** `ALL`과 중첩되는
**sub-universe robustness check**라고 정확히 쓴다.

---

## 3. 데이터 경계 — 홀드아웃을 아예 읽지 않는다

`HOLDOUT_START = 2025-08-07` 이후는 `CONTAMINATED_FOR_FORMAL_OOS`이고 **이 PR에서는 아예
읽지 않는다.**

기존 계열을 그대로 재사용한다 — `backtest.holdout.research_sessions` ·
`assert_no_holdout` · `selftest.signal_study.research_calendar`.

**신호 날짜만 제한하는 것으로는 부족하다.** forward +42 target도 홀드아웃으로 넘어가면 안
되므로 **달력 자체가 잘려 있어야 한다.** 러너는 `index + 42 >= len(calendar)`에서 멈춘다.

`--consume-holdout` 같은 경로를 만들지 않는다.

산출물에 다음을 명시해 감사 가능하게 한다.

```
HOLDOUT_CONSUMED = false
HOLDOUT_START = 2025-08-07
max_signal_date
max_forward_target_date
```

**둘 다 cutoff 이전이어야 한다.**

---

## 4. 정의를 복제하지 않는다

정본 helper를 재사용한다. **새 RS 공식·새 SMA helper·새 forward 정의를 만들지 않는다.**

|쓰는 것|출처|
|---|---|
|`relative_strength` 기반 J별 RS|`selftest.j_signal_study.formation_strengths`|
|7.2 자격 판정|`selftest.j_signal_study._eligible`|
|forward 수익률 + stale 판정|`selftest.funnel_run.forward_return`|
|시장 상태|`backtest.regime.classify_market_regime`|
|버킷·유니버스 평균·무작위 누적|`backtest.study.Study`|
|연구 달력|`selftest.signal_study.research_calendar`|
|무작위 점수|`backtest.candidates.random_score`|

**시장 split 정의는 정확히 이것이다.**

```
UP    :  SPY adjusted close  >  SPY SMA200
DOWN  :  SPY adjusted close  <=  SPY SMA200
```

`classify_market_regime(...).above_sma200`을 **읽는다.** SMA50을 쓰지 않는다. realized vol을
쓰지 않는다. **`BULL`/`CORRECTION`/`RECOVERY`/`BEAR` 문자열을 primary grouping logic으로
다시 파싱하지 않는다** — `above_sma200`이라는 실제 축을 쓴다.

---

## 5. 고정 변수 — 결과를 보고 바꾸지 않는다

|항목|값|
|---|---|
|J primary|**126**|
|J control|**63**|
|skip|5|
|selection|TOP5|
|primary horizon|**+42 sessions**|
|primary universe|**ALL** (SP500 + NDX100)|
|robustness universe|NDX100|
|random seeds|기존 **0~19** 20개|
|phase offsets|**42**|

유니버스 자격 조건은 기존 J signal study와 동일하다 — PIT membership · min history ·
min raw close · min dollar volume · 현재 폐지/stale 처리.

forward 정의도 PR #9/#12와 동일하다.

```
signal-date adjusted close  →  t+42 adjusted close

excess = TOP5 forward return − 같은 날 자격 유니버스 평균 forward return
```

**전략의 t+1 진입 수익률로 바꾸지 않는다. 이 PR은 signal study다.**

---

## 6. Primary estimand

`J ∈ {63, 126}` 각각에 대해

```
E_J_UP    = SPY>SMA200  날짜의 TOP5 +42 mean excess
E_J_DOWN  = SPY<=SMA200 날짜의 TOP5 +42 mean excess
C_J       = E_J_UP − E_J_DOWN
```

**이 PR의 단 하나의 primary endpoint는 `C_126` (ALL universe, +42)이다.**

나머지는 전부 robustness / interpretation이다.

**결과를 보고 하지 않는 것:** +21이나 +63으로 primary 변경 · 변동성 조건 추가 · SMA50 추가.

---

## 7. 표본 크기를 반드시 함께 보고한다

각 (J, market group)에서 최소 다음을 낸다.

- signal dates
- TOP5 observations
- valid +42 observations
- stale/frozen forward observations
- eligible population summary

**UP/DOWN의 표본 크기가 크게 다르면 평균만 보고 해석하지 않는다.**

불변식 테스트: `UP observations + DOWN observations == valid total observations`.

---

## 8. J63 frozen control의 역할

J63도 동일하게 `E_63_UP` · `E_63_DOWN` · `C_63`을 계산한다.

**`C_126 > C_63`을 PR #16 승격 필수조건으로 만들지 않는다.** 시장 조건이 J126만의 현상이
아니라 cross-sectional momentum family 전체에 작동해도 시장 gate 가설은 여전히 의미가 있다.

대신 다음으로 해석한다.

|경우|관측|읽는 법|
|---|---|---|
|**A**|J63·J126 모두 UP 집중|family-level market conditioning과 일관|
|**B**|J126만 강한 UP 집중|J126-specific interaction 가능성|
|**C**|J63만 안정적이고 J126은 불안정|frozen alpha under test에 대한 시장 gate 근거 약화|
|**D**|둘 다 불안정|market conditioning hypothesis 약화|

---

## 9. same-size random control

기존 시드 **0~19 스무 개를 그대로** 쓴다. **결과를 보고 시드 수를 늘리지 않는다.**

각 날짜에서 **동일 eligible universe · 동일 TOP5 크기 5 · 동일 market group · 동일 +42
forward 정의**로 random TOP5를 만든다. **시장 전체에서 뽑고 나중에 group을 나누지 않는다** —
그날의 group study에 직접 넣는다.

시드 `s`마다

```
C_random_s = E_random_s_UP − E_random_s_DOWN
```

을 계산하고, 실제 `C_126`이 20개 중 몇 개를 이기는지 기록한다.

`E_126_UP`이 같은 UP 날짜의 random TOP5 excess 분포에서 어디에 있는지도 기록한다
(기록만 하고 hard 기준으로 쓰지 않는다).

**random은 J와 무관하다** — 자격 유니버스와 날짜가 같으면 같은 시드가 같은 종목을 뽑으므로
공통 baseline 하나를 두 J가 공유한다.

---

## 10. temporal stability — +42만 본다

+42 horizon에 대해서만 **42개 phase offset**을 쓴다. phase의 forward window는 서로 겹치지
않는다.

각 phase에서 `E_126_UP_phase` · `E_126_DOWN_phase` · `C_126_phase`를 계산하되,
**그 phase에 UP과 DOWN 양쪽 모두 유효 표본이 있을 때만 contrast를 유효하게 센다.**

보고: valid phase count · positive C phase count · positive share · median C · min / max C.
J63도 같은 표를 낸다.

**다른 horizon의 phase 분석을 추가하지 않는다.**

---

## 11. calendar-year distribution

연도별로 `UP dates` · `DOWN dates` · `J63 UP/DOWN/C63` · `J126 UP/DOWN/C126` 표를 만든다.
**한쪽 group에 표본이 없으면 0으로 채우지 않고 `None`으로 둔다.**

추가로 J126에 대해 **leave-one-year-out** primary contrast `C_126_without_y`를 연도마다
보고한다.

**결과를 보고 특정 연도를 별도로 제거하지 않는다.** 2008·2020 등을 사후 선택해 새 headline을
만들지 않는다.

**연도 집중도는 robustness diagnostic이지 단독 promotion veto가 아니다.** 시장 상태 효과는
본질적으로 드문 위기 구간과 연결될 수 있으므로 특정 연도 집중만으로 자동 폐기하지 않고
`CONCENTRATED`라고 표시한다.

---

## 12. NDX100 robustness

동일한 모든 계산을 NDX100에 반복한다. **primary는 여전히 `ALL / J126 / +42 / C_126`이다.**

NDX100은 **sub-universe replication / robustness**라고 부르고 **독립 OOS라고 부르지
않는다.**

---

## 13. PR #16 승격 규칙 — 결과 전에 고정한다

PR #16을 **"SMA200 gate가 좋아 보인다"로 열지 않는다.**

### HARD A — primary direction

ALL / J126 / +42에서

```
E_126_UP > 0     AND     C_126 > 0
```

UP 상태의 signal edge 자체가 양수이고, DOWN보다 실제로 강해야 한다.

### HARD B — random discrimination

`C_126`이 20개 same-size random contrast 중 **≥ 18 / 20**을 이겨야 한다.

경험적 90% 수준의 coarse control이고 **formal p-value라고 부르지 않는다.**

### HARD C — temporal direction

유효한 +42 phase에서

```
positive(C_126_phase) share >= 60%     AND     median(C_126_phase) > 0
```

60%는 새 최적화 숫자가 아니라 로드맵 robustness 철학의 최소 방향 안정성 기준이다.

### HARD D — NDX direction

NDX100에서도 `C_126_NDX > 0`. **NDX의 절대 크기가 ALL보다 클 필요는 없다.**

---

## 14. promotion verdict

**A~D를 모두 통과하면 `PROMOTE_TO_PR16`.**

그 의미는 **오직** 이것이다.

> `SPY>SMA200`을 실제 신규진입 gate로 넣어 portfolio economics를 **한 번 검증할 근거**가
> 생겼다.

**"전략이 검증됐다"가 아니다.**

**하나라도 실패하면 `DO_NOT_PROMOTE`.** 그 경우 다음을 **전부 하지 않는다.**

- SMA150 · SMA250 · 10개월 이동평균 시도
- `BULL`만 시도
- volatility gate 추가
- SMA50 추가

로드맵대로 **Phase 1 market-condition hypothesis가 현재 단일 처치에서는 지지되지 않은
것으로 기록한다.** **사용자 검토 없이 다음 대안을 열지 않는다.**

---

## 15. year concentration label — 기준을 결과 전에 정의한다

promotion과 **별도로** 붙이는 정성 label이다. **HARD A~D를 사후 변경하지 않는다.**

|label|기준|
|---|---|
|**BROAD**|leave-one-year-out `C_126`이 **전부 같은 양의 방향**이고, 연도별 양의 contrast가 여러 해에 분산|
|**CONCENTRATED**|특정 **1개 연도** 제거로 full-sample `C_126` 부호가 뒤집히거나, headline contrast의 대부분이 극소수 연도에 위치|
|**MIXED**|그 중간|

---

## 16. reproduction checksum

새 분석이 기존 신호 정의를 바꾸지 않았는지 확인한다. **market group을 다시 합쳤을 때 PR
#12의 aggregate +42 결과를 재현해야 한다.**

```
ALL TOP5 +42
  J63  ≈ +0.48%
  J126 ≈ +1.03%
```

**재현되지 않으면 결과를 해석하기 전에 원인을 찾는다.** 새 숫자가 "더 좋아 보여서" 그냥
넘어가지 않는다.

---

## 17. 이번 PR에서 바꾸지 않는 것

`trading/core/*` · `backtest/loop.py` · `backtest/sizing.py` · execution · exit · policy ·
regime gating behavior.

`backtest/regime.py`의 `classify_market_regime(...).above_sma200`을 **읽기만** 한다.
**새 `regime_mode`는 PR #16의 일이다.**

**이 PR에서 "SPY>SMA200이면 entry 차단" 코드를 만들면 scope violation이다.**

---

## 18. 결과가 나온 뒤 하지 않을 것

결과가 좋든 나쁘든 이 PR에서 하지 않는다.

PR #16 구현 · SMA200 gate backtest · `ABS(126,5)` · dynamic exit · hard stop · sizing 변경 ·
FIP · 다른 SMA · 다른 horizon · volatility split · 추가 J · 추가 random seed ·
holdout consumption.

**로드맵을 확장하지 않는다.**

---

## 19. 실행

```
python3 selftest/market_condition_signal.py ALL
python3 selftest/market_condition_signal.py NDX100
python3 selftest/market_condition_signal.py report
```

산출물: `all.json` · `ndx100.json` · `results.md`.
