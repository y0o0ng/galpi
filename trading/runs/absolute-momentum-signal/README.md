# PR #17 — Candidate Absolute Momentum Signal Study

> **결과를 계산하기 전에 작성한 사전등록 문서다.** 결과를 본 뒤 이 문서의 판정 기준을
> 고치지 않는다. **이 PR에서 포트폴리오 백테스트를 하지 않는다.**

로드맵은 `docs/momentum-v2-roadmap.md`이고 이 PR은 그 **Phase 2의 첫 단계**다.

---

## 1. 묻는 것

### Phase 2 전체 질문

> **`J126 + SMA200`이라는 이미 양의 matched-SPY edge를 가진 구조에서,
> `ABS(126,5) > 0` candidate eligibility가 종목 선택의 상대 edge를 추가로 개선하면서
> 현재 경제성을 훼손하지 않는가?**

### PR #17 질문 (이 문서)

> **`SPY > SMA200`인 개발표본에서, ABS-positive 후보 안에서 다시 뽑은 RS126 TOP5가
> 동일 날짜의 기존 RS126 TOP5보다 +42 forward excess를 높이는가?**

---

## 2. Phase 2의 역할은 "마이너스 전략을 살리는 것"이 아니다

PR #16이 남긴 구조와 성적이다.

```
RS(126,5) + SPY > SMA200 신규진입 gate + TOP5 + K42 + S5 + 현재 sizing/execution/costs
```

|지표|게이트 없음|SMA200 게이트|
|---|---:|---:|
|비용 후 총수익|+35.63%|**+47.84%**|
|노출 일치 격차 `G`|−10.82%|**+4.99%**|
|기대값|0.233R|**0.343R**|
|PF|1.31|**1.47**|
|**Sharpe**|0.35|**0.46** (최소 0.60 **미달**)|
|**MDD**|10.8%|**12.0%**|

**격차가 이미 양수다.** 그래서 ABS의 역할은 마이너스를 플러스로 만드는 것이 아니라
**이미 있는 상대 edge를 더 키우거나, 반대로 좋은 거래까지 잘라먹는가**다. 판정이 Phase 1
보다 엄격한 이유가 그것이다.

---

## 3. ABS 정의는 고정 — 새 horizon을 탐색하지 않는다

```
ABS(126,5)(i,t) = log(P[i, t-5] / P[i, t-126])
조건: ABS(126,5) > 0
```

J126과 **같은 formation window와 skip=5**를 쓴다. 가격은 `relative_strength`와 같은
**배당 조정 종가(`adj_close`)**다 — 두 신호가 다른 가격 계열을 보면 비교가 성립하지 않는다.

**새 파라미터가 아니다.** `relative_strength`가 내부에서 이미
`own = log(values[-(skip+1)] / values[-(lookback+1)])`을 계산하고, ABS는 정확히 그 항이다.

**금지:** `ABS63` · `ABS189` · skip 변경 · 문턱 0.02/0.05 탐색 · SMA 기반 종목 필터로 교체 ·
여러 absolute-momentum 정의 비교.

**이번 intervention은 정확히 `ABS(126,5) > 0` 하나다.**

---

## 4. 필터 위치 — candidate eligibility 후 TOP5

```
PIT eligible universe
      ↓
RS(126,5) 계산
      ↓
ABS(126,5) > 0  candidate condition
      ↓
살아남은 후보를 RS 순으로 정렬
      ↓
TOP5
```

**기존 RS TOP5를 먼저 뽑고 ABS 미달만 지우는 방식이 아니다.** ABS 음수인 RS 2등이 탈락하면
**ABS 양수인 RS 6등이 새 TOP5에 들어온다.**

**ABS 양수 후보가 5개 미만이면 그날 TOP5는 5개 미만이다.** ABS 음수 종목으로 backfill하지
않는다.

> **유용한 성질 하나.** 필터는 후보를 빼기만 하고 살아남은 후보들의 RS 순서를 바꾸지
> 않으므로, **control TOP5 중 ABS 양수인 종목은 반드시 ABS TOP5에도 남는다.** 따라서
> "ABS 때문에 빠진 종목"과 "ABS 미달 종목"이 같은 집합이고, 아래 교체율 정의가 유일하다.

---

## 5. control은 gated J126 하나다

PR #16의 사전등록된 **경우 2**를 따른다.

|팔|내용|
|---|---|
|**control**|`J126` (+ 신호 층에서는 `SPY > SMA200` 날짜만 봄)|
|**treatment**|`J126` + `ABS(126,5) > 0` candidate condition|

**`ungated J126 + ABS` 팔을 열지 않는다.** 이번 질문은 *이미 살아남은 SMA200 구조 위에서
ABS가 marginal contribution을 하는가*이고, `SMA200 vs ABS vs joint interaction`은 **새
연구**다. 로드맵의 "두 필터가 독립적으로 기여하는 증거가 있을 때만 둘 다"는 여기서
**"ABS가 이미 승격된 SMA200 구조 위에서 추가 marginal contribution을 보여야 한다"**로
적용한다.

**시장 조건을 다시 비교하지 않는다.** 신호 층도 `SPY > SMA200` 날짜만 본다.

---

## 6. 재현 checksum

ABS를 적용하지 않은 control은 **PR #15의 J126 UP 결과를 재현해야 한다.**

```
J126 · SPY > SMA200 · +42 forward excess  ≈  +1.188%
```

기존 signal definition · PIT universe · eligibility · forward return · last-close freeze ·
holdout calendar를 **그대로 재사용한다.**

**checksum이 깨지면 ABS 결과를 해석하지 말고 definition drift부터 찾는다.**

### 집계 방식이 둘이고, 둘 다 보고한다 (2026-08-16 결정)

**checksum을 date-weighted로 재정의하지 않는다.** PR #15의 `+1.188%`는 기존 정의 그대로
**observation-weighted reproduction checksum**으로 유지한다.

|값|집계|쓰임|
|---|---|---|
|observation-weighted control excess|날짜마다 TOP5 다섯 종목이 각각 한 관측|**PR #15 checksum**|
|date-weighted control excess|날짜마다 한 값|**paired 분석의 기준선**|

**primary는 날짜 단위 `D_t = ABS_t − Control_t`의 `mean(D_t)` 그대로다.**

**결과를 본 뒤 둘 중 유리한 쪽을 고르지 않는다.**

> **정정 (결과 후, 2026-08-16).** 이 문단은 원래 "날짜마다 유효 관측 수가 달라 둘이 다를
> 수 있다"고 적었는데 **이 러너의 control 표본 구조에서는 그렇지 않다.** forward가 없는
> 종목을 **랭킹 전에** 빼고 `min_score_population`을 통과한 날짜만 세므로 **control TOP5가
> 항상 정확히 5관측**이고, 같은 크기 집단의 평균의 평균은 전체 평균과 같다. 실측
> 관측 수가 `3,385 × 5 = 16,925`인 것이 그 확인이다.
>
> **두 estimand를 개념적으로 구분하는 것은 유지한다** — 표본 구조가 달라지면 갈릴 수 있는
> 값이다. **판정 기준은 바뀌지 않았고 checksum `+1.188%`도 그대로다.** 코드 서술의 사실
> 오류를 고친 것이지 골대를 옮긴 것이 아니다.

---

## 7. Primary estimand — paired date comparison

같은 날짜 `t`에서

```
Control_t = 기존 RS126 TOP5의 +42 excess (날짜 평균)
ABS_t     = ABS-positive 후보에서 다시 뽑은 RS126 TOP5의 +42 excess (날짜 평균)

D_t = ABS_t − Control_t
```

**primary는 `mean(D_t)` 하나다.**

**두 평균을 따로 내서 빼지 않는다.** 같은 날짜 · 같은 시장 상태 · 같은 유니버스에서
**candidate condition 하나만** 바뀐 paired comparison이 primary다.

**반드시 함께 보고한다.**

- `mean(D)` · `median(D)`
- 양수 `D` 날짜 비율
- 유효 paired 날짜 수
- control excess (관측 단위 · 날짜 단위 둘 다)
- ABS excess (날짜 단위)

**유효 paired 날짜의 정의:** 두 팔 모두 TOP5가 비어 있지 않고 각각 +42 forward가 하나
이상 있는 날짜. **ABS 양수 후보가 0개인 날짜는 `D_t`가 정의되지 않으므로 제외하고 그
건수를 따로 센다.**

---

## 8. 필터 구속력(binding)을 반드시 측정한다

SMA200 게이트가 이미 켜져 있으므로 **ABS가 거의 아무 일도 안 할 가능성이 있다.** 그러면
"개선 없음"과 "애초에 안 걸림"이 구별되지 않는다.

**필수 지표 둘**

|지표|정의|
|---|---|
|`composition_changed_dates`|control TOP5와 ABS TOP5의 구성 종목이 **하나라도** 달라진 날짜 비율|
|`candidate_replacement_rate`|전체 control TOP5 candidate-day 중 ABS 때문에 탈락·교체된 candidate 비율|

**추가 보고**

- 평균 overlap (control TOP5 ∩ ABS TOP5)
- TOP5가 **완전히 같은** 날짜 비율
- ABS eligible candidate 수 분포
- ABS eligible candidate가 **5개 미만**인 날짜 수 · **0개**인 날짜 수

---

## 9. binding 판정 — 해석 label이지 hard cutoff가 아니다

**5% 같은 임의 문턱으로 자동 탈락시키지 않는다.** ABS가 드물게만 걸려도 그 소수 거래가 큰
손실을 제거한다면 경제적으로 중요할 수 있기 때문이다.

|label|조건|
|---|---|
|`NON_BINDING`|`composition_changed_dates == 0`|
|`LOW_BINDING`|`0 < composition_changed_dates < 5%`|
|`BINDING`|`composition_changed_dates >= 5%`|

**5%는 promotion threshold가 아니라 해석 label일 뿐이다.**

**단 `NON_BINDING`이면 처치가 실제로 아무것도 바꾸지 않았으므로 ABS Portfolio
Translation으로 승격하지 않는다.** `LOW_BINDING`이라도 신호 증거가 강하면 자동 탈락시키지 않는다.

**`LOW_BINDING`에 추가 promotion threshold를 만들지 않는다.** 대신 희소한 몇 날짜에
의존하는지가 드러나도록 다음을 보고한다.

- `changed_dates_n` (구성이 바뀐 날짜의 **절대 수**)
- **구성이 바뀐 날짜만의 `D` 분포** (평균 · 중앙 · 최소 · 최대)
- 연도 분포 · leave-one-year-out · 위상 안정성

> ⚠️ **`LOW_BINDING`에서 `median(D) >= 0`을 강한 robustness 증거로 읽지 않는다.**
> 구성이 안 바뀐 날짜는 `D_t = 0`이므로, 바뀐 날짜가 적으면 **0이 다수가 되어 중앙값이
> 자동으로 0 이상**이 된다. 기준 C는 부호가 뒤집히지 않았다는 최소 확인일 뿐이고,
> **시간 안정성 판단은 사전등록한 위상 기준(D)이 담당한다.**

---

## 10. Robustness

**primary는 `ALL` · `+42` · paired `mean(D)` 하나다.** 나머지는 전부 robustness다.

1. **위상 안정성** — 42개 비중첩 phase에서 paired `D` 방향. 보고: 유효 phase 수 · 양수
   `mean-D` phase 비율 · phase `D` 중앙값
2. **연도별 paired `D`** — 연도 · 유효 paired 날짜 · `mean(D)` · `median(D)`
3. **leave-one-year-out** `mean(D)`
4. **NDX100 sub-universe** — **독립 OOS가 아니다.** `ALL`과 중첩되는 robustness check다
5. **paired random control** — 아래 §10.1

**새 horizon을 추가하지 않는다.**

### 10.1 paired random control (2026-08-16 결정 · secondary diagnostic)

**기존 시드 `0..19` 스무 개만 재사용한다.** 새 시드를 만들지 않고 결과를 보고 늘리지도
않는다.

각 날짜 `t`와 시드 `s`에서 **같은 random ranking을 두 풀에 적용한다.**

|팔|풀|랭킹|
|---|---|---|
|control-random|기존 eligible **full pool**|`random_score(s, t, symbol)`|
|ABS-random|`ABS(126,5) > 0`을 적용한 pool|**같은** `random_score(s, t, symbol)`|

**각 팔은 실제 intervention과 같은 TOP5 규칙을 따른다** — ABS eligible이 5개 미만이면
**억지로 basket size를 맞추지 않는다.**

```
D_random(s,t) = ABS-random_t − control-random_t      (날짜 paired)
mean_s = mean over t of D_random(s,t)
```

**보고:** 실제 `mean(D)`가 무작위 20개 중 몇 개를 이기는지 · 무작위 `mean_s`의 중앙과 범위.

**HARD A~E에 넣지 않는다. promotion criterion이 아니다.**

**해석 목적은 하나다** — 실제 개선이 **RS-specific interaction**인지 **generic
ABS-positive pool effect**인지 구분하는 것이다. 랭킹과 무관하게 "ABS 양수 종목 풀이 원래
더 좋다"면 무작위 팔에서도 같은 개선이 나온다.

**어느 쪽이든 그 자체로 자동 탈락 사유가 아니다.** generic pool effect라도 그것이 실재하면
후보 조건으로서의 가치는 남는다 — 다만 그 경우 "RS 랭킹과 ABS의 상호작용"이라고 쓰지
않는다.

---

## 11. ABS Portfolio Translation 승격 규칙 — 결과 전에 고정

|기준|조건|
|---|---|
|**A**|`NON_BINDING`이 아닐 것|
|**B**|primary `mean(D) > 0`|
|**C**|`median(D) >= 0`|
|**D**|+42 비중첩 phase에서 양수 `mean-D` 비율 **≥ 60%**|
|**E**|NDX100 paired `mean(D) >= 0`|

**하나라도 실패하면 `DO_NOT_PROMOTE_ABS_TO_PORTFOLIO`다.**

> **기준 C는 최소 확인이지 robustness 증거가 아니다.** `LOW_BINDING`에서는 구성이 안
> 바뀐 날짜의 `D_t = 0`이 다수라 중앙값이 자동으로 0 이상이 된다(§9). **시간 안정성은
> 기준 D가 담당한다.**

그 경우 **전부 하지 않는다** — ABS 문턱 변경 · horizon 변경 · ABS를 ranking weight로 변경 ·
SMA/price breakout 대안 · "조금만 바꿔서 다시". **ABS candidate intervention은 종료한다.**

연도 집중도는 `BROAD` / `CONCENTRATED` / `MIXED` 별도 label로 보고하되 **단독 hard veto로
쓰지 않는다**(PR #15와 같은 취급).

---

## 12. 데이터 경계

Phase 1~8 계약 그대로. `HOLDOUT_START = 2025-08-07` 이후를 **읽지 않는다.**

**신호일뿐 아니라 +42 forward target도 cutoff 이전이어야 한다** — 달력 자체를 자르고
`index + 42`가 달력 밖이면 멈춘다.

산출물에 남긴다.

```
HOLDOUT_CONSUMED = false
HOLDOUT_START
max_signal_date
max_forward_target_date
```

**`--consume-holdout` 경로를 만들지 않는다.**

---

## 13. 이 PR에서 하지 않을 것

portfolio backtest · 새 `CoreDefinition` · sizing 변경 · exit 변경 · SMA200 변경 ·
J/K/슬롯 변경 · ABS 문턱 사다리 · ABS horizon 사다리 · FIP · hard stop · dynamic exit ·
holdout 소모.

**결과가 좋아도 ABS Portfolio Translation을 자동 구현하지 않는다.** 결과를 보여주고 **사용자 승인을
기다린다.**

---

## 14. ABS Portfolio Translation 판정 철학 — 지금 미리 기록한다

**PR #16의 market-timing용 6-label을 그대로 재사용하지 않는다.** ABS는 market-timing
intervention이 아니라 **candidate-selection intervention**이라 핵심이 matched-SPY relative
contribution이다.

각 팔에서 `S` · `B` · `G = S − B`를 내고 `ΔS` · `ΔB` · `ΔG`를 그대로 보고하되,
**ABS alpha component의 hard rule은 하나다.**

```
ΔG <= 0   ⇒   ABS alpha component 탈락
```

**control의 `G`가 이미 +4.99%이므로 candidate filter가 상대 edge를 깎으면 alpha stack에
넣을 이유가 없다.**

### 판정 우선순위

|순위|label|조건|처리|
|---|---|---|---|
|**1**|`FINAL_GATE_PASS`|challenger가 로드맵 최종 economic gate **전체** 통과|**ABS 유지. 추가 alpha filter 자동 진행 금지**(FIP 등을 더 붙이지 않는다)|
|**2**|`PROMOTE_ABS`|final gate는 미달이지만 `ΔG > 0` AND `ΔS > 0` AND `Sharpe_gate >= Sharpe_control`, 그리고 control이 이미 통과하던 `G > 0`·`expectancy > 0`·`PF ≥ 1.15`·`MDD ≤ 15%`를 **하나도 깨지 않음**|ABS를 alpha stack에 유지하고 다음 strategy construction 단계로|
|**3**|`RISK_TRADEOFF_ONLY`|`ΔG > 0`인데 `ΔS ≤ 0`, 또는 상대 edge는 좋아졌지만 현재 economics를 훼손|**alpha stack 승격 안 함.** 단 challenger가 `FINAL_GATE_PASS`면 항상 1번이 우선|
|**4**|`NON_ALPHA_BENEFIT`|`ΔG ≤ 0`인데 MDD·Sharpe 같은 risk metric만 개선|**ABS는 alpha filter로 탈락.** 필요하면 risk-filter 후보 메모만 남긴다|
|**5**|`FAIL`|나머지|—|

### 왜 Sharpe 비악화를 요구하는가

현재 살아남은 SMA200 구조의 **명확한 마지막 경제성 미달이 `Sharpe = 0.46 < 0.60`**이다.
그래서 ABS가 `G`를 +4.99% → +8%로 올려도 Sharpe를 0.35로 낮추면 **최종 전략 목표에서는
후퇴**다.

반대로 총수익이 조금 달라져도 challenger가 최종 gate 전체를 통과하면 `FINAL_GATE_PASS`가
우선한다. **개별 metric 하나를 최적화하지 않고 최종 strategy qualification을 우선한다.**

---

## 15. 개발 표본이다

이 구간은 PR #9~#16에서 반복 사용됐다. 결과를 **"OOS 검증"이라고 부르지 않는다.**

그리고 이 계열의 신호 층 근거에는 이미 경고가 붙어 있다 — PR #15의 연도 label이
`CONCENTRATED`였고(2009 또는 2011을 빼면 full-sample 부호가 뒤집힌다) frozen control J63의
시장 대비가 J126보다 컸다. **PR #17의 결과 기대를 높게 잡지 않는다.**
