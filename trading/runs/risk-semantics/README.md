# PR #19 — Risk Semantics

> **결과를 계산하기 전에 작성한 사전등록 문서다.** 결과를 본 뒤 이 문서의 판정 기준을
> 고치지 않는다.

로드맵은 `docs/momentum-v2-roadmap.md`이고 이 PR은 그 **Phase 4**다.

**이것은 alpha 개입이 아니다.** 알파 개입 예산 네 번(시장 상태 · 종목 absolute momentum ·
signal-aligned exit · FIP) 중 셋을 썼고 남은 하나는 FIP다. Phase 4는 **이미 쓰고 있는
숫자의 의미를 바로잡는 단계**이지 새 alpha를 더하는 단계가 아니다. 그래서 이 PR의 결과와
무관하게 **남은 alpha 개입 수는 여전히 하나(FIP)다.**

---

## 1. 묻는 것

> **현재 `J126 + SMA200 신규진입 gate + fixed K42` 전략에서 sizing에 사용하는 `2ATR`를
> 실제 hard stop으로 집행해야 하는가, 아니면 이것은 손절 위험이 아니라 단순한
> volatility-based position scale인가?**

### 왜 이것이 문제인가

현재 sizing은 대략 이렇다(`backtest/sizing.py`).

```
stop_distance  = stop_atr_multiple × ATR14          (= 2 × ATR14)
risk_budget    = equity × risk_per_trade            (= equity × 0.25%)
shares_by_risk = floor(risk_budget / stop_distance)
planned_risk   = shares × stop_distance
```

그리고 살아남은 청산 모드는 `FIXED_HOLD`다 — **K42 만기 청산만 집행한다.** PR #14의 실측
exit 분포가 `MAX_HOLD` 505 · `DELISTED_EXIT` 8 · `UNRESOLVED_EXIT` 1로 **손절 청산이
0건**이었다.

즉 **현재 `2ATR`는 실제 청산 boundary가 아니다.** 따라서 지금 코드·보고서·문서가 쓰는
다음 표현들은 전략의 실제 최대손실 위험으로 읽으면 **틀리다.**

```
"거래당 위험 0.25%"
"planned risk"
"open risk"
"R"
```

이번 PR은 그 모순을 해결한다.

### 가능한 최종 결론은 정확히 둘뿐이다

|verdict|뜻|
|---|---|
|**A** `STOP_DEFINED_RISK`|`2ATR` initial hard stop을 실제로 집행한다. 그러면 0.25%가 **planned stop risk**라는 실제 행동 의미를 갖는다. 단 gap-through·fees 때문에 실제 손실이 반드시 1R 이하라는 뜻은 **아니다**|
|**B** `VOLATILITY_SCALED_POSITION`|hard stop을 쓰지 않는다. fixed K42를 유지한다. `2ATR`와 0.25%는 실제 손실위험이 아니라 **position-size volatility normalization unit**으로 해석한다|

**세 번째 구조를 만들지 않는다.**

---

## 2. 고정 control

```
J126 + skip 5 + TOP5 + SMA200 신규진입 gate + K42 + S5
+ 현재 sizing / execution / costs + FIXED_HOLD
= `jt-j126-k42-sma200`  (PR #16의 gated 팔, PR #18의 control)
```

**PR #18 challenger(`jt-j126-k42-sma200-exit`)를 control로 쓰지 않는다.** Signal
Invalidation Exit은 `RISK_ONLY`로 종료됐고 alpha stack에 들어가지 않았다. ABS도 없다.

**LAST_CLOSE 기준 checksum — 이 값이 재현돼야 challenger를 해석한다.**

|항목|기대|
|---|---:|
|거래 수|**445**|
|`S` 비용 후 총수익|**+47.84%**|
|기대값|**+0.343** (2ATR-unit, §9 참고)|
|PF|**1.47**|
|Sharpe|**0.46**|
|MDD|**12.0%**|
|평균 노출|**16.4%**|
|`G = S − B` 격차|**+4.99%**|

**drift가 있으면 challenger를 해석하지 말고 원인부터 찾는다.**

---

## 3. 유일한 treatment — exact semantics

challenger는 control과 **모든 것이 동일하고** `2ATR` initial hard stop **하나만** 실제로
집행한다.

```
hard stop price = entry fill price − stop_atr_multiple × (entry-time ATR14)
                = fill_price − 2.0 × atr14
```

청산은 **hard stop OR K42 중 먼저 발생한 것**이다.

### 반드시 `initial_stop`을 쓴다 — `stop_price`가 아니다

`Position.stop_price`는 `trailing_active`(최고 종가가 진입가 +1 ATR 이상)가 되면
**trailing stop으로 바뀐다.** 그것을 그대로 쓰면 처치가 둘이 된다.

> 이 모드의 장중 stop 검사는 **`position.initial_stop`만** 읽는다.
> `position.stop_price`를 읽지 않는다.

`initial_stop`은 `entry_price − stop_atr_multiple × atr14`이고 두 값 모두 진입 시점에
고정된다. 기업행동 조정(`adjust_for_corporate_action`)은 `entry_price`와 `atr14`를 같은
배율로 옮기므로 stop distance가 올바른 가격 단위로 유지된다.

### CORE exit를 통째로 켜지 않는다

**이것이 이 PR에서 가장 쉽게 망가지는 지점이다.** 기존 `CORE` exit 경로를 쓰면 initial
stop과 함께 trailing stop · time stop · earnings exit이 같이 살아나 처치가 하나가 아니게
된다. `runs/jt-jk/`가 그 묶음을 이미 반증했다 — `jt-core-exit`는 총수익 **−23.07%**다.

그래서 **새 청산 모드 하나를 명시적으로 만든다.**

```
FIXED_HOLD_HARD_STOP  =  FIXED_HOLD(K42 만기) + initial hard stop
```

허용되는 청산은 **정확히 둘**이다.

|살아 있는 것|꺼져 있는 것|
|---|---|
|`INITIAL_STOP` (2ATR, 진입 시점 고정)|trailing stop · trailing activation|
|`MAX_HOLD` (K42)|time stop|
||earnings exit · earnings overdue|
||market trend break (PR #18)|
||rank exit · ABS exit|

`DELISTED_EXIT`·`UNRESOLVED_EXIT`는 청산 규칙이 아니라 데이터 계층의 종료 처리이므로 두
팔 모두에 그대로 있다.

### 체결 semantics — 기존 모델을 재사용한다

`execution.try_stop_exit()`를 그대로 부른다. **새 stop fill engine을 만들지 않는다.**

|바|체결|사유|
|---|---|---|
|`raw_open <= stop`|실제 **시초가**|`GAP_FILL`|
|`raw_low <= stop`|**stop price**|`STOP_FILL`|
|둘 다 아님|유지|—|

### 진입 당일 stop도 기존 계약 그대로다

`loop`의 2단계가 체결 직후 같은 바로 `run_session`을 한 번 돌리므로 **진입 당일 바에도
stop이 검사된다.** 일봉 모델은 그 저가가 우리 체결보다 앞선 시각이었을 가능성을 알 수
없어서 실제보다 자주 손절될 수 있고, `positions.py`가 그것을 **보수적 편향**으로 이미
명시하고 있다. **그 계약을 이번 PR에서 바꾸지 않는다.**

### 순서도 그대로다

`run_session`의 1~6번 순서를 바꾸지 않는다. 특히 **stop 검사(3번)가 오늘 종가 반영(4번)보다
먼저**다 — 오늘 종가로 갱신한 상태를 오늘 저가에 대고 검사하면 look-ahead다. 이 모드는
trailing이 없어서 stop이 움직이지 않지만, **순서를 바꿀 이유가 없으므로 바꾸지 않는다.**

### 진입 게이트·랭킹·sizing은 그대로다

`TREND_GATE` 신규진입 게이트 유지. J·K·TOP5·슬롯·`risk_per_trade`·`stop_atr_multiple`
전부 그대로. **바뀌는 것은 청산 하나뿐이다.**

---

## 4. "0.25% risk"를 최대손실이라고 부르지 않는다

**A가 살아남더라도** 다음은 여전히 가능하다.

```
overnight gap below stop     →  GAP_FILL이 stop보다 낮은 가격에 체결된다
fees / sell tax              →  실현 손실에 더해진다
slippage / spread            →  같은 방향
```

그래서 A에서도 허용되는 표현은 이것뿐이다.

```
planned stop risk
intended stop risk
planned stop-risk budget
```

**다음처럼 쓰지 않는다.**

```
guaranteed max loss = 0.25%
maximum loss is capped at 0.25%
```

**실제 stop loss가 planned risk를 초과할 수 있는지 §8에서 반드시 값으로 진단한다.**

---

## 5. Primary comparison

**LAST_CLOSE가 main이다.**

각 arm에서

```
S = 비용 후 전략 총수익
B = 노출 일치 SPY 총수익
G = S − B
```

그리고 반드시 함께 보고한다.

```
ΔS = S_stop − S_control
ΔB = B_stop − B_control
ΔG = G_stop − G_control

ΔS = ΔB + ΔG      (G ≡ S − B이므로 정의상 닫힌다. 잔차가 없다)
```

**PR #16의 helper(`selftest.market_gate_run.decompose`)를 그대로 부른다.** 복제하면 두
실험의 정의가 갈린다. 항등식 잔차도 값으로 남긴다.

**이번 PR은 risk semantics 연구지만 risk control이라는 이유로 portfolio economics를
무시하지 않는다.** §13의 verdict A가 economics 조건을 요구하는 이유가 그것이다.

---

## 6. Secondary economics

반드시 두 팔 모두 보고한다.

total return · CAGR · Sharpe · Sortino · Calmar · MDD · PF · win rate · avg exposure ·
turnover · fees · trade count · entry count · avg holding sessions · exit reason
distribution · matched-SPY gap · `F`/`T` benchmark decomposition.

```
F = 평균 노출 고정 SPY
T = B − F        (노출 타이밍의 몫)
ΔB = ΔF + ΔT
```

**`F`/`T`는 새 promotion criterion이 아니다.** `ΔB`를 타이밍 그 자체로 읽지 않기 위한
보조 분해이고 PR #16·#18에서 쓰던 정의 그대로다.

---

## 7. R의 의미를 arm별로 명시한다

`metrics.expectancy_r`·`Trade.return_r`은 두 팔에서 **같은 식**으로 계산된다.

```
return_r = pnl / (shares × stop_atr_multiple × entry-time ATR14)
```

**그런데 그 분모의 의미가 두 팔에서 다르다.**

|arm|`2ATR`의 실제 역할|보고서에서 부르는 이름|
|---|---|---|
|control (`FIXED_HOLD`)|집행되지 않는다. 수량을 정하는 단위일 뿐|**legacy R-unit** / **2ATR volatility-unit return**|
|challenger (`FIXED_HOLD_HARD_STOP`)|실제 initial stop distance|**planned-stop-risk R**|

**control의 `expectancy_r`·`return_r`을 "실제 stop-defined risk multiple"이라고 부르지
않는다.** 그리고 **A arm에서도 "maximum-loss R"이라고 부르지 않는다** — §4의 이유로
실현 손실이 1R을 넘을 수 있다.

보고서는 두 팔의 R을 같은 표에 나란히 놓되 **의미가 다르다는 것을 그 자리에서 적는다.**

---

## 8. Hard-stop mechanism diagnostics

challenger에서 **반드시 별도 표를 낸다.**

### 8.1 exit / fill 분포

|항목|
|---|
|`INITIAL_STOP` exit count|
|`STOP_FILL` count|
|`GAP_FILL` count|
|`MAX_HOLD` count|
|`DELISTED_EXIT` count|
|`UNRESOLVED_EXIT` count|

`STOP_FILL`·`GAP_FILL`은 **stop 청산 안에서** 센다 — `exit_fill_reason`이지 전체 fill
분포가 아니다.

### 8.2 planned stop risk 대비 실현 손실

initial-stop 청산 각각에 대해

```
planned_stop_risk_dollars = shares × stop_atr_multiple × entry-time ATR14
                          = 엔진의 `_OpenTrade.risk_dollars`
realized_net_loss_dollars = −pnl        (비용 포함. 이익이면 음수)
ratio                     = realized_net_loss_dollars / planned_stop_risk_dollars
                          = −return_r
```

**진단용 sizing 계산기를 만들지 않는다.** 엔진이 진입 시점에 쓴 값을 `entry_observer`의
`SizedIntent`에서 그대로 읽고, `ratio = −return_r`과 일치하는지 **잔차로 확인한다.**
복제하면 그 복제본이 엔진과 갈릴 자리가 생긴다.

세 분포 각각에 대해 **count · mean · median · p90 · p95 · max**를 낸다.

그리고

```
realized_net_loss > planned_stop_risk   인 stop exit의 건수와 비율
```

을 보고한다. **이것은 오류가 아니다** — gap-through와 비용 때문에 발생할 수 있다.
`STOP_FILL`과 `GAP_FILL`을 갈라 세고, **exceedance가 `GAP_FILL`에 집중되는지** 본다.

---

## 9. 처치가 실제로 binding인지 확인

hard stop이 거의 발동하지 않으면 A/B 선택의 증거가 충분하지 않다. 그래서 다음을 낸다.

|지표|
|---|
|`hard_stop_exit_count`|
|closed trade 대비 비율|
|stop 청산까지의 보유 세션 (median 포함 분포)|
|entry count 변화 (일찍 빈 슬롯이 다음 진입을 만들었는가)|
|평균 보유 세션 변화|

**이것을 새 promotion threshold로 만들지 않는다.** §13 A의 조건 8은 "한 번 이상
binding"이라는 최소 확인이고, 위 나머지 값들은 **"처치가 작동했는가"를 확인하는 mechanism
diagnostic**이다.

---

## 10. 포트폴리오 경로가 달라지는 것을 인정한다

hard stop은 슬롯을 일찍 비운다. 그래서 challenger는 control이 진입하지 않은 종목에
진입할 수 있고 **entry set 자체가 갈린다.**

**따라서 결과를 이렇게 설명하지 않는다.**

```
"같은 거래를 stop만 다르게 청산한 결과"
```

**정확한 해석은 이것이다.**

> hard stop rule을 추가했을 때 **전체 portfolio path**가 어떻게 달라졌는가.

**trade-by-trade matched attribution을 억지로 만들지 않는다.**

---

## 11. 데이터 경계

`HOLDOUT_START = 2025-08-07` 이후를 **읽지 않는다.** 기존 `research_window()`를 그대로
쓴다(`2007-01-04 ~ 2025-08-06`).

산출물에 **`HOLDOUT_CONSUMED = false`**를 남긴다.

**개발 구간이다. formal OOS라고 부르지 않는다.** 이 구간은 PR #9~#18에서 반복
사용됐고 로드맵 §7 C3-3이 `2025-08-07` 이후를 `CONTAMINATED_FOR_FORMAL_OOS`로 이미
규정했다.

---

## 12. 폐지 가정

**`LAST_CLOSE`가 primary다.** `ZERO`는 secondary sensitivity이고 **ZERO 결과 때문에 A/B
판정을 뒤집지 않는다.**

다만 계좌가 **구조적으로 붕괴**하는 경우는 명확히 보고한다.

---

## 13. 사전등록 verdict — 결과 전에 고정

**이번 PR은 반드시 A 또는 B를 고른다. 결과를 본 뒤 새 중간 label을 만들지 않는다.**

### A — `STOP_DEFINED_RISK`

**다음 여덟 가지를 모두 만족할 때만** A다.

|#|조건|
|---|---|
|1|challenger의 matched-SPY 격차 `G > 0`|
|2|challenger의 비용 후 total return > 0|
|3|control이 이미 통과하던 경제 최소조건을 깨지 않음 (`G > 0` · `expectancy > 0` · `PF ≥ 1.15` · `MDD ≤ 15%` 중 **control이 통과한 것**)|
|4|`PF ≥ 1.15`|
|5|`MDD ≤ 15%`|
|6|`Sharpe_challenger ≥ Sharpe_control`|
|7|`MDD_challenger ≤ MDD_control`|
|8|hard stop이 **한 번 이상 binding**하여 행동 차이가 확인됨|

즉 **stop을 실제 risk boundary로 만들었는데 risk-adjusted quality를 후퇴시키지 않고
기존 positive relative edge도 보존해야 한다.**

**A가 되면**

```
J126 + SMA200 gate + 2ATR initial hard stop + K42
```

를 이후 전략 후보로 유지하고, 0.25%를 **`planned stop-risk budget`**이라고 부를 수 있다.
**단 "maximum loss"라고는 하지 않는다**(§4).

### B — `VOLATILITY_SCALED_POSITION`

**A 조건 중 하나라도 실패하면 B다.**

그 경우

- hard-stop challenger는 **연구 기록·재현용으로만** 남긴다
- **alpha / strategy stack에 넣지 않는다**
- **fixed K42를 유지한다**
- `2ATR` 기반 sizing은 유지할 수 있으나 **이것을 actual loss risk라고 부르지 않는다**
- 0.25%는 **volatility sizing budget / normalization budget**으로 해석한다

**그리고 다음을 열지 않는다.**

```
hard stop 배수 1.5 / 2.5 / 3ATR 재탐색   금지
trailing stop 대안                        금지
stop confirmation                         금지
```

**`2ATR` hard stop이 실패하면 "다른 stop 숫자를 찾아보자"가 아니라 stop-defined risk 모델
자체를 이번 전략에서 포기한다.**

---

## 14. B가 나오면 하는 semantic cleanup — 범위도 미리 정한다

**B verdict가 나왔을 때 허용되는 후속 수정은 행동 변화 없는 이름·문서 정리뿐이다.**

목표는 다음 거짓 표현을 없애는 것이다.

> "0.25%가 실제 거래당 최대손실 위험이다"

### 절차

1. **먼저 조사한다** — reports · docs · comments · runner labels · roadmap · diagnostics
   중 어디에서 user-facing / research-facing 의미가 잘못 쓰이는지 목록으로 만든다.
2. 문구만 고친다.
3. **행동·수량·체결 결과가 byte-identical임을 테스트로 확인한다.**

### 하지 않는 것

- **shared architecture 전체를 무리하게 rename하지 않는다.** `planned_risk` ·
  `open_risk` · `risk_dollars` · `return_r` 같은 공유 dataclass field를 대규모로 바꿔야
  한다면 **이번 PR에서 억지로 하지 않고 명확한 compatibility plan을 제시한다.**
- 이미 배포된 실행 산출물(JSON·results.md)을 소급 수정하지 않는다.

**중요한 것은 하나다.**

> PAPER 후보 전략 설명에서 **실제 집행되지 않는 stop을 실제 loss cap처럼 부르지 않는 것.**

---

## 15. A가 나오면 테스트로 잠글 invariant

|invariant|
|---|
|initial hard stop은 정확히 `entry fill − 2ATR`|
|trailing은 **절대** 활성화되지 않음 (`+1 ATR` 이후에도 stop이 올라가지 않음)|
|time stop 없음|
|earnings exit 없음|
|K42 `MAX_HOLD`는 그대로 살아 있음|
|`GAP_FILL` semantics 기존과 동일|
|`STOP_FILL` semantics 기존과 동일|
|corporate action 조정 후 stop distance가 올바른 가격 단위로 유지|
|기존 `CORE` mode 결과 불변|
|기존 `FIXED_HOLD` mode 결과 불변|
|기존 `SIGNAL_INVALIDATION` mode 결과 불변|

**새 모드 추가 때문에 #10~#18의 과거 결과가 바뀌면 안 된다.** 위 세 줄은 B가 나오더라도
확인한다 — 회귀는 verdict와 무관하게 깨지면 안 되는 것이다.

---

## 16. 이번 PR에서 절대 하지 않을 것

```
FIP 구현                    금지
TrendQuality 부활           금지
ABS 부활                    금지
SMA 변경                    금지
J 변경                      금지
K 변경                      금지
TOP5 변경                   금지
slots 변경                  금지
risk_per_trade 0.25% 변경   금지
stop ATR multiple 변경      금지
1.5 / 2.5 / 3ATR sweep      금지
trailing stop               금지
time stop                   금지
earnings exit 추가          금지
market-break exit 재시험    금지
sizing optimization         금지
volatility target 연구      금지
holdout 사용                금지
```

**질문은 오직 하나다.**

> 현재 이미 sizing에 쓰고 있는 `2ATR`를 실제 initial hard stop으로 집행할 것인가?

---

## 17. 구조 — 처치가 하나임을 증명 가능하게

|항목|control|challenger|
|---|---|---|
|`exit_mode`|`FIXED_HOLD`|**`FIXED_HOLD_HARD_STOP`** (새 모드)|
|`regime_mode`|`TREND_GATE`|`TREND_GATE` (같음)|
|`entry_mode`|`RS_ONLY`|`RS_ONLY` (같음)|
|policy 파라미터·한도·프로필|—|**같음**|
|`require_earnings_calendar` · `require_sector`|—|**같음**|
|`policy_id`|`research-jt-j126-k42-sma200`|**다름**|

**`policy_id`만 다르고 행동 규칙은 `exit_mode` 하나만 다르다.** 서명을 갈라 두는 이유는
PR #16·#18과 같다 — `record_holdout_run`이 정책 서명으로 홀드아웃 소모를 세므로 공유하면
두 팔이 같은 행으로 덮어써진다(로드맵 §7 C3-1). **감사 identity는 갈라야 하고 행동
규칙은 같아야 한다.** 테스트가 dataclass 비교로 잠근다.

---

## 18. 산출물

```
trading/runs/risk-semantics/README.md      ← 이 문서 (결과 전 커밋)
trading/runs/risk-semantics/control-last_close.json
trading/runs/risk-semantics/stop-last_close.json
trading/runs/risk-semantics/control-zero.json
trading/runs/risk-semantics/stop-zero.json
trading/runs/risk-semantics/results.md     ← 생성물
```

`results.md`의 구조는 다음 13절이다.

1. 질문
2. prereg checksum
3. control reproduction
4. treatment exact semantics
5. `S`/`B`/`G` + Δ decomposition
6. secondary economics
7. hard-stop mechanism
8. gap-through / planned-stop-risk exceedance
9. exit distribution
10. ZERO sensitivity
11. verdict A or B
12. semantic consequence
13. limitations

---

## 19. 개발 표본이다

이 구간은 PR #9~#18에서 반복 사용됐다. 결과를 **"OOS 검증"이라고 부르지 않는다.**

그리고 이 계열에는 이미 경고가 붙어 있다 — 연구 코어는 전부
`require_earnings_calendar=False`라 `EARNINGS_GATE_DISABLED` blocker가 항상 붙고(로드맵
§7 C5), 최종 경제 게이트는 두 팔 모두 Sharpe에서 미달일 가능성이 높다(control 0.46 <
0.60). **§13의 A는 "최종 전략 완성"이 아니라 "`2ATR`를 stop이라고 부를 자격이
있는가"를 묻는다.**
