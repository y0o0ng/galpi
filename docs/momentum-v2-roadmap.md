# Conditional Cross-Sectional Momentum v2 — 전략 구축 로드맵

> **이 문서는 작업 명세가 아니라 계약이다.** 무엇을 만들지, 몇 번까지 시도할지, 언제
> 그만둘지를 미리 못박는다. 각 Phase는 **독립 PR + 사전등록 + 사용자 검토 후 승인**으로만
> 진행하고, 결과를 보고 로드맵을 확장하지 않는다.

기준 문서는 `docs/Swing Trading Agent Design v2 2.md`이고 실측 기록은 그 20.0절이다. 이
문서는 그것을 대체하지 않고 **연구 예산과 종료 조건**을 추가한다.

---

## 0. 우리가 지금 어디에 있는가

PR #9~#14에서 확인한 것을 착각 없이 적는다.

**우리는 모멘텀 전략을 만들지 않았다. 모멘텀 신호를 분리하고 검증했다.** 그 신호를 돈 버는
전략으로 조립하는 단계는 아직 제대로 시작하지 않았다.

|알아낸 것|근거|
|---|---|
|RS 극단 상위에 미래 초과수익 정보가 있다|PR #9 (`runs/signal-rs63/`)|
|형성기간 J에는 구조가 있고 J126이 J63보다 강하다|PR #12 (`runs/signal-j-study/`)|
|긴 K는 포트폴리오 수익이 되지 않는다|PR #10 (`runs/jt-k-lifetime/`)|
|5슬롯은 그 원인이 아니다|PR #11 (`runs/jt-slot-capacity/`)|
|J126 신호 우위가 포트폴리오로 번역되지 않는다|PR #13 (`runs/j126-portfolio-translation/`)|
|번역이 어디서 끊기는지 특정하지 못했다|PR #14 (`runs/signal-to-portfolio-funnel/`)|

그리고 현재 연구 코어 `jt-k42`의 실제 성적은 이렇다.

|항목|값|
|---|---:|
|총수익 (2007-01-04 ~ 2025-08-06, 18.6년)|+35.39%|
|CAGR|1.65%|
|노출 일치 SPY|+48.09% (격차 **−12.7%p**)|
|**SPY 100% 매수보유**|**+531.69%**|
|평균 노출|17.9%|

설계 14.7 게이트에서도 **하드 최소를 셋 미달**한다 — Sharpe 0.375(최소 0.6) · Sortino
0.525(최소 0.9) · Calmar 0.176(최소 0.6).

**그래서 이 로드맵의 전제는 "지금 것을 조금 고치면 된다"가 아니다.** 검증된 신호에서
출발해 **필요한 부품만 하나씩** 다시 붙이되, **네 번까지만** 시도한다.

---

## 1. 동결하는 것 — 전략이 아니라 알파 신호

|역할|고정값|
|---|---|
|**주 알파 신호 (frozen alpha under test)**|`RS(126, 5)`|
|**비교 신호 (frozen control)**|`RS(63, 5)`|
|선택|cross-sectional TOP5|
|연구용 보유|K42|
|슬롯|5|
|실행|t일 종가 신호 → t+1 이후 체결|
|유니버스·유동성·PIT|현재 구현 그대로|
|홀드아웃|`HOLDOUT_START = 2025-08-07` 이후 봉인 유지|

**J126을 주 신호로 두는 이유.** 개발 표본에서 signal-level forward excess 증거가 가장 좋았다
(ALL TOP5 +42: J63 +0.48% · J126 +1.03%, 두 유니버스·여섯 지평·common anchor·위상 안정성).
포트폴리오에서 개선이 없었다는 것은 J126을 폐기할 이유가 아니라 **이 로드맵이 풀려는
signal → strategy conversion 문제 그 자체**다.

> **주의 — 기록된 결정과의 관계.** PR #13은 "**개발 기준선은 J63을 유지한다**"로 끝났고
> `CLAUDE.md`가 그렇게 적고 있다. 이 로드맵은 그 결정을 **뒤집지 않는다.** 두 개념을
> 분리한다.
>
> - **개발 기준선(baseline)**: 포트폴리오 비교의 기준점 = **J63 유지**
> - **동결 알파(alpha under test)**: 이 로드맵이 조립 대상으로 삼는 신호 = **J126**
>
> J63은 모든 Phase에서 **frozen control**로 함께 돈다. 두 역할을 한 단어로 합쳐 "기준선을
> J126으로 바꿨다"고 쓰지 않는다.

---

## 2. 최종 전략의 형태

```
Point-in-time Universe
        ↓
[Market Condition]          ← Phase 1 통과 시에만
        ↓
RS126,5 Ranking
        ↓
[Candidate Condition]       ← Phase 2 통과 시에만
        ↓
TOP5
        ↓
t+1 Execution
        ↓
Position Sizing
        ↓
Portfolio Limits
        ↓
[Signal Invalidation] OR K42
        ↓
Earnings & Event Risk
        ↓
Costs / Delisting / Execution Reality
```

**상자를 처음부터 다 켜지 않는다.** 각 상자는 "있으면 좋아 보여서"가 아니라 **직전 버전
대비 독립적인 marginal contribution**을 증명해야 살아남는다.

설계 v2.2는 이미 `RS + trend quality + breakout + market regime + ATR stop/trailing/time
exit`라는 완결된 모양을 갖고 있었다. 문제는 그걸 **한 번에 묶어놔서** 무엇이 alpha이고
무엇이 alpha를 죽였는지 알 수 없었다는 것이다. 이번에는 반대로 간다.

---

## 3. 연구 예산 — 알파 개입 네 번

```
1. 시장 상태 진입조건
2. 종목 자체 absolute momentum 조건
3. signal-aligned exit
4. 마지막 signal-quality filter 하나 (FIP)
```

**이 네 가족을 다 써도 경제성 허들을 못 넘으면 long-only cross-sectional momentum 단독
전략은 종료한다.**

**금지:** J·K·슬롯·랭크 cutoff 재탐색. 여러 필터 동시 투입. 52주 신고가·MACD·ADX·RSI·
거래량·돌파·실적 모멘텀 — 전부 parking lot.

**복잡성을 추가하지 않는 것도 성공이다.** PR #16에서 시장 게이트 하나로 허들을 넘으면
Phase 2·6은 하지 않는다.

---

## 4. 1차 합격선 — 모든 전략 실험에 공통

**Primary (하나로 고정):**

```
after-cost exposure-matched SPY gap > 0
```

같은 정도만 시장에 노출됐을 때 SPY보다 더 벌어야 한다. **총수익만 보면 착시가 너무 크다.**

**최소 조건 (설계 14.7 게이트와 같은 값):**

|항목|최소|
|---|---|
|비용 후 total return|> 0|
|expectancy|> 0R (목표 0.2R)|
|profit factor|≥ 1.15|
|Sharpe|≥ 0.6|
|MDD|≤ 15%|
|random ranking 대비|우위|
|ZERO 시나리오|계좌가 구조적으로 붕괴하지 않을 것|

matched-SPY를 못 이긴 것은 **"아직 전략 아님"**으로 본다.

---

## 5. Phase별 계약

### Phase 0 — PR #14를 닫는다 ✅

결론은 그대로다.

> 신호는 실제 거래 종목까지 전달된다. 그런데 현재 포트폴리오 구조에서는 경제적 우위로
> 충분히 변환되지 않는다. **원인은 특정하지 못했다.**

공식 판정 `Q1 = NO_CLEAR_STAGE` · `Q2 = INCONCLUSIVE`. **U자 구조·allocation tail을 더
파지 않는다.**

### Phase 1 — 시장 상태 (PR #15 · #16)

우선순위 1번인 이유: K42의 레짐별 성과가 실제로 크게 갈렸고, 외부 연구 방향과도 맞는다
(Cooper·Gutierrez·Hameed의 market-state 의존성, Daniel·Moskowitz의 momentum crash).
**다만 그 연구들은 주로 winner-minus-loser momentum이라 우리 long-only TOP5에 그대로
적용된다는 뜻이 아니다.** 우리 데이터에서 따로 검증한다.

**첫 처치는 딱 하나: `SPY close > SMA200`일 때만 신규 진입.**

계좌 낙폭 제외 · 변동성 조건 제외 · `BULL`/`RECOVERY` 같은 복합 label 사용 안 함.

**PR #15 — Market Conditioning Signal Study.** RS126,5 TOP5의 +42 excess를 `SPY > SMA200`과
`SPY ≤ SMA200` 두 집단으로만 가른다. 포트폴리오를 건드리지 않는다.

**PR #16 — Market Gate Portfolio Translation.** J126 / TOP5 / K42 / S5 / 현재 sizing /
현재 execution 전부 고정. **신규 진입 허용 여부만** 바꾼다. 기존 포지션은 게이트가 꺼져도
K42까지 들고 간다 — 그래야 entry timing 효과만 잰다.

### Phase 2 — 종목 absolute momentum (PR #17)

시장 게이트가 의미는 있지만 허들을 못 넘을 때만 쓴다.

RS는 상대적 신호다. 시장이 −30%인데 어떤 종목이 −10%면 그게 RS winner가 된다. 그래서
두 번째 질문은 **"시장보다 강한 것뿐 아니라 이 종목 자체도 상승 추세여야 하지 않는가"**다.

**새 기간을 튜닝하지 않는다.** J126과 같은 formation window를 쓴다.

```
ABS(126,5)(i,t) = log(P[i, t-5] / P[i, t-126])
조건: ABS(126,5) > 0
```

Moskowitz·Ooi·Pedersen의 time-series momentum과 연결된 개념이지만, 그 논문은 주로 선물·
다자산이라 **우리의 126,5 조건은 논문 복제가 아니라 adaptation이다.**

**하나만으로 충분하면 하나만 쓴다.** 두 필터가 독립적으로 기여하는 증거가 있을 때만 둘 다.

### Phase 3 — Signal Invalidation Exit (PR #18)

**예전 CORE exit를 그대로 되살리는 것은 금지.** `runs/jt-jk/`가 이미 반증했다 —
`jt-core-exit`(RS-only + CORE exits 전부)는 총수익 **−23.07%** · 기대값 −0.075다.

이번 탈출 논리는 **entry hypothesis의 반증**이어야 한다.

|진입 가설|자연스러운 exit|
|---|---|
|시장이 상승 추세이고 이 주식은 RS winner다|시장 상승 추세가 깨지면 청산|
|(ABS가 살아남았다면) 종목 자체도 상승 추세다|`ABS(126,5) ≤ 0`이면 청산|

**새 숫자가 하나도 없다.** rank 17 아래면 팔기·5일 연속·trailing 2.7ATR 같은 새 knob 없음.

Control은 fixed K42. **dynamic exit가 못 이기면 그냥 K42를 쓴다.** 고정 보유기간도 완결된
exit rule이다.

### Phase 4 — 위험의 의미를 바로잡는다 (PR #19)

지금까지 묻혀 있던 문제다. 현재 sizing은 `shares ∝ 0.25% equity / 2ATR`이고
`planned_risk = shares × 2ATR`로 R을 계산한다. **그런데 `FIXED_HOLD` 모드는 K 만기 청산만
남긴다** — PR #14의 실측 exit 분포가 `MAX_HOLD` 505 · `DELISTED_EXIT` 8 · `UNRESOLVED_EXIT`
1로, **손절 청산이 0건이다.**

즉 **2ATR는 실제 손절선이 아니고, "거래당 0.25% 위험"은 엄밀히 틀린 표현이다.** 0.25%는
실제 최대손실이 아니라 포지션 크기를 정하는 volatility normalization unit이다.

둘 중 하나를 골라야 한다.

|구조|내용|
|---|---|
|**A — Stop-defined risk**|2ATR stop을 실제로 집행한다. 그러면 "거래당 계획 위험 0.25%"가 진짜 뜻을 갖는다. **trailing도 time stop도 없이 2ATR hard stop만 K42에 붙여 한 번 잰다.**|
|**B — Volatility-scaled position**|hard stop을 쓰지 않는다. 2ATR를 **position volatility scale**로 이름을 바꾸고, 진짜 risk control은 max position weight · max gross exposure · no leverage · sector/correlation caps · market risk-off · event block이 담당한다.|

**실행하지 않는 stop으로 "0.25% risk"라고 부르는 전략은 PAPER로 올리지 않는다.**

### Phase 5 — Sizing은 여기까지 와서야 건드린다

PR #14가 sizing 관계를 깊이 팠지만 결론은 `INCONCLUSIVE`였고, 정렬 진단도 X3(mixed)였다.
**지금 sizing을 먼저 뜯으면 또 미궁이다.**

원칙: **진입 + 탈출 구조만으로 matched-SPY alpha가 만들어진 뒤에만** sizing을 최적화한다.

- 수익성과 위험을 이미 만족하면 → **sizing을 건드리지 않는다. 끝.**
- 퍼센트 return edge는 좋은데 dollar/R 변환만 계속 약하면 → 그때 sizing PR **하나**를
  별도로 사전등록한다.

Barroso·Santa-Clara와 Moreira·Muir의 volatility management 결과가 있지만 **momentum factor·
광범위 factor portfolio의 결과이고 우리 개별주 long-only sizing에 바로 적용되는 증거가
아니다.** 아이디어 후보일 뿐이다.

**sizing은 alpha 제조기가 아니라 마지막 risk allocator다.**

### Phase 6 — 마지막 카드 하나 (PR #20)

여기까지 와도 matched-SPY를 못 넘으면 **J나 K로 돌아가지 않는다.** 딱 하나의 momentum
quality filter만 허용한다: **Information Discreteness / Frog-in-the-Pan**.

현재 RS는 "얼마나 올랐나"를 보고, ID는 **"어떤 경로로 올랐나"**를 본다. Da·Gurun·Warachka는
같은 누적 momentum이라도 작은 상승이 지속적으로 쌓인 종목이 큰 몇 번의 jump로 오른 종목보다
이후 continuation이 강하다고 보고했다.

예전 `trend_quality` 아이디어와 직관은 비슷하지만 이번에는 **학술적으로 정의된 별개 신호로
단독 ablation**한다.

**이것이 마지막 alpha filter다.** 실패하면 `Long-only cross-sectional momentum strategy
construction = CLOSED`를 선언한다.

### Phase 7 — Reality Hardening (PR #21)

여기까지 통과한 후보는 아직 백테스트 아이디어다. 실전 제약을 전부 켠다.

t+1 체결 · gap cancellation · 실제 거래비용 · 비용 ×2 · ×3 · 정수 주식 · liquidity cap ·
sector/correlation limit · corporate actions · LAST_CLOSE / ZERO · delisting · **실적
blackout(`require_earnings_calendar=True`)** · 남은 open position · PIT constituents ·
stale price.

**LLM은 아직 없다.** Quant Core가 혼자 돈을 벌지 못하는데 LLM을 붙여 구조를 구제하려 하면
원인을 영영 알 수 없어진다.

### Phase 8 — Robustness gate (PR #22)

"더 좋은 숫자 찾기"가 아니라 **망가뜨려 보는** 단계다.

|검증|요구|
|---|---|
|chronological folds|최소 60% 같은 방향, 목표 80%|
|2× cost|기대값 여전히 양수|
|3× cost|파괴적이지 않을 것|
|LAST_CLOSE / ZERO|결론 방향 유지|
|random controls|RS가 random보다 우위|
|parameter neighbors|**새로 도입한 숫자만** 인접값 확인|
|exposure-matched SPY|**gap > 0 필수**|
|MDD / PF / Sharpe|≤15% / ≥1.15 / ≥0.6|

**여기서 실패하면 파라미터를 고쳐 다시 제출하지 않는다. 직전 단계로 탈락.**

### Phase 9 — 홀드아웃을 한 번 연다 (PR #23)

전략을 코드·hash·config까지 완전히 freeze한 뒤 처음으로 `2025-08-07` 이후를 연다.
**튜닝 데이터가 아니라 판결 데이터다.**

|기준|값|
|---|---|
|after-cost return|> 0|
|expectancy|≥ 0|
|profit factor|> 1|
|exposure-matched SPY gap|≥ 0|
|MDD|dev 대비 비정상 폭증 없음|
|거래 수 부족|`PASS`가 아니라 `INSUFFICIENT_SAMPLE`|

**홀드아웃이 나빴다고 규칙을 고쳐 다시 돌리면 그 순간 홀드아웃은 개발 데이터다.** 그
전략 버전은 실패로 기록하고 끝.

> ⚠️ **이 Phase에는 미해결 구조 문제가 있다. 아래 §7 C3을 반드시 먼저 읽는다.**

### Phase 10 — Shadow → PAPER

기존 운영 설계로 돌아간다(연구 → Shadow → `PAPER_AUTONOMOUS` → 제한적 LIVE). 여기까지 온
Quant 전략에 LLM을 붙인다.

**LLM은 alpha engine이 아니라 risk layer로 시작한다** — 좋은 종목을 더 찾는 게 아니라
실적·기업행동·회계 이상·비정상 위험 때문에 **검증된 거래를 줄이거나 막는** 역할이다.
설계대로 `PASS`/`REDUCE`/`BLOCK`/`REVIEW`만 하고 위험을 늘리지 못한다.

---

## 6. PR 순서

|PR|이름|질문|상태|
|---|---|---|---|
|14|Funnel 종료|변환 실패 위치를 특정할 수 있는가|**INCONCLUSIVE · 종료**|
|15|Market condition signal|RS alpha가 market uptrend에 집중되는가|다음|
|16|Market entry gate|시장 게이트가 실제 portfolio economics를 개선하는가|—|
|17|Candidate absolute momentum|relative + absolute가 둘 다 필요한가|조건부|
|18|Signal invalidation exit|신호가 깨질 때 나가는 것이 K42보다 나은가|조건부|
|19|Risk semantics|hard stop인가 volatility sizing인가|—|
|20|FIP quality|마지막 momentum quality filter|조건부|
|21|Reality hardening|비용·실적·delisting·체결을 견디는가|—|
|22|Robustness|folds/random/cost stress에서 버티는가|—|
|23|ONE-SHOT HOLDOUT|처음 보는 데이터에서도 살아남는가|—|

**"조건부"는 앞 단계가 허들을 넘으면 하지 않는다는 뜻이다.**

---

## 7. 검토에서 나온 충돌과 미해결 항목

> 2026-08-16 기준 repo·설계·실험 기록과 이 로드맵을 대조한 결과다. **Phase 1을 시작하기
> 전에 C2·C3은 결정이 필요하다.**

### C1. J126 승격은 기록된 결정과 부딪힌다 → §1에서 해소

PR #13은 "개발 기준선은 J63을 유지한다"로 끝났다. §1이 **baseline(J63)**과 **alpha under
test(J126)**를 분리해 해소했다. **"기준선을 J126으로 바꿨다"고 쓰지 않는다.**

### C2. PR #15의 결과가 이미 저장소에 부분적으로 있다 ⚠️

`runs/signal-j-study/all.json`의 `by_j["126"]["by_regime"]`에 **8개 레짐 상태별 +42
초과수익이 이미 저장돼 있다.** 그리고 `classify_market_regime`의 정의상

```
BULL, CORRECTION  ⟺  SPY > SMA200
RECOVERY, BEAR    ⟺  SPY ≤ SMA200
```

이므로 **PR #15의 헤드라인 분할은 이미 발표된 숫자의 산술이다.** 게다가 `CLAUDE.md`가 이미
한 칸을 공개하고 있다 — "`RECOVERY/HIGH_VOL`에서 J189 −2.77% · J126 −0.55%".

**결론: PR #15는 "발견"이 아니라 명시적 confirmatory re-cut이다.** 사전등록은 여전히 의미가
있지만(무엇을 primary로 볼지, 어떤 결과에서 PR #16으로 갈지) **"새로 발견했다"고 쓰면
안 된다.**

PR #15가 실제로 더할 수 있는 새 정보는 이것들이다.

- J63 frozen control과의 대조 (all.json은 J별 by_regime을 갖고 있으나 이 축으로 접은 표는 없다)
- 두 집단의 **비중첩 위상 안정성**
- 같은 크기 **무작위 대조군**
- 집단별 **표본 수·연도 분포** (한두 해가 만든 결과인지)
- NDX100 재현

### C3. "ONE-SHOT HOLDOUT"이 현재 코드로는 보장되지 않는다 ⚠️

세 가지가 겹쳐 있다.

1. `holdout_runs` 표에 행이 **1개**뿐이고 그것은 `paper-core-v1` 서명이다. 그런데
   `CLAUDE.md`는 **홀드아웃이 두 번 소모됐다**고 기록한다 — 2026-08-14 신호 연구는
   백테스트가 아니라 계수기에 잡히지 않았다.
2. `evaluate_gate`는 `holdout_run_count > 1`일 때만 `HOLDOUT_REUSED`를 단다. 위 1 때문에
   **실제로는 재사용인데 blocker가 뜨지 않는다.**
3. **계수기가 정책 서명별이다.** Momentum v2가 Phase 1~6에서 새 코어를 여러 개 만들면
   **각 코어가 공짜로 "처음 여는 홀드아웃"이 된다.** 이건 정확히 이 로드맵이 막으려는
   multiple-comparisons 누수다.

**결정이 필요하다. 두 갈래다.**

- **(a) 홀드아웃 보호를 실험 계열 단위로 바꾼다.** Phase 9 전에 작은 PR로
  `record_holdout_run`을 정책 서명이 아니라 **연구 계열(Momentum v2 전체)** 기준으로
  세도록 고친다. 그러면 "네 번의 알파 개입 전체에 홀드아웃 한 번"이 코드 불변식이 된다.
- **(b) 홀드아웃이 이미 오염됐음을 받아들인다.** 설계 문서와 `CLAUDE.md`는 이미 **"진짜
  경제적 검증은 앞으로의 paper·live shadow 데이터의 몫"**이라고 적고 있다. 이 경우 Phase 9는
  "판결"이 아니라 "마지막 sanity check"로 격하되고, 진짜 판결은 Phase 10의 shadow 기간이 된다.

**추천은 (a) + (b) 병행이다.** (a)로 남은 오염을 막고, 판결의 무게는 (b)에 둔다.

### C4. Primary metric이 게이트에 없다

`evaluate_gate`의 12행에 **exposure-matched SPY gap 행이 없다.** §4가 그것을 primary로
올렸으므로 둘 중 하나를 골라야 한다.

- 게이트에 행을 추가한다 → **기존 실행들의 판정이 소급 변경된다**
- primary는 실험 러너가 들고 게이트는 그대로 둔다 → **최소 변경. 추천.**

### C5. 연구 코어는 구조적으로 `UNDETERMINED`를 벗어날 수 없다

JT 코어는 전부 `require_earnings_calendar=False`라 `EARNINGS_GATE_DISABLED` blocker가 항상
붙는다. **Phase 1~6의 모든 실행은 blocker를 달고 나온다.** 이것은 버그가 아니라 설계
의도이지만, §4의 1차 합격선이 **게이트 verdict와 다른 층**이라는 것을 각 PR이 명시해야 한다.
blocker가 사라지는 것은 Phase 7이다.

### C6. `jt-core-exit` 결과를 "stop이 나쁘다"의 증거로 쓰지 않는다

`jt-core-exit`는 −23.07%지만 그것은 **2ATR stop · 트레일링 · 20일 time stop · 실적 청산이
한 묶음**인 결과다. **2ATR stop 단독의 효과는 아직 재지 않았다.** Phase 4 구조 A는 그래서
정당한 질문이고, 로드맵이 "trailing도 time stop도 없이"라고 정확히 쓴 것이 맞다.

### C7. 시장 게이트는 새 `regime_mode`와 새 코어 파일이 필요하다

`MARKET`은 아무것도 막지 않고(`new_entries` 항상 `allow`), `CORE`는 계좌 낙폭을 본다
(`CLAUDE.md`의 자기 잠금 경고). SPY>SMA200 진입 게이트는 **제3의 모드**다.

- `regime_mode`는 정책 서명 **밖**이므로 `paper-core-v1` 동결을 깨지 않는다 ✅
- `RULE_FIELDS`에 `regime_mode`가 있으므로 **새 코어 파일 하나**가 된다
- `CLAUDE.md` 규칙 유지: **레짐 게이팅은 상태 이름이 아니라 `new_entries`를 본다**

### C8. `ABS(126,5)`는 새 피처지만 새 파라미터는 아니다

`relative_strength`가 내부에서 이미 `own = log(P[t-5]/P[t-126])`을 계산한다. ABS는 그
항이므로 **로드맵의 "새 숫자를 도입하지 않는다"는 주장이 맞다.** 다만 `Features`에 필드를
더하면 `feature_hash`가 바뀐다 — 정책 서명은 안 바뀌지만 `features_daily` 캐시가 무효가 된다.

### C9. 합격선은 기존 게이트와 정확히 일치한다 ✅

expectancy 0.0/0.2 · PF 1.15 · Sharpe 0.6 · MDD 0.15가 `evaluate_gate`와 같다. 새 문턱을
만들지 않았다.

---

## 8. 종료 조건

**이번에는 끝이 있다.**

```
Market condition → Candidate absolute momentum → Signal-aligned exit → FIP quality
```

네 개입을 모두 거쳤는데도 **after-cost exposure-matched SPY gap ≤ 0**이면
**Momentum v2 standalone strategy는 종료한다.**

그때도 지금까지의 연구는 버려지지 않는다. RS126은 다음으로 남는다.

- 다른 전략의 ranking component
- regime-dependent component
- future multi-strategy ensemble
- LLM/Quant hybrid의 deterministic evidence

그 다음은 Strategy Family #2로 standalone absolute/time-series momentum을 연구한다.
time-series momentum은 cross-sectional ranking과 **다른 종류의 현상**이고 학술적으로도
독립적인 근거가 있다.

---

## 9. 이 문서를 읽는 법

- 광맥은 찾았다. 광석에 금이 있다는 것은 확인했다. **제련 공정이 형편없어서 금괴가 안 나온
  상황**이지 광맥이 가짜였다고 결론낼 상황이 아니다.
- 다만 **제련 공정을 50개 시험하지 않는다.** 네 번이다.
- 각 Phase는 독립 PR + 사전등록 + 사용자 검토 후 승인. **결과를 보고 자동 진행하지 않는다.**
- 이 로드맵의 목적은 **최종 전략의 방향과 종료 조건을 고정하는 것**이지, 결과를 보고
  로드맵을 확장하는 것이 아니다.
