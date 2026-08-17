# PR #19 — Risk Semantics

## 1. 질문

> **현재 `J126 + SMA200 신규진입 gate + fixed K42` 전략에서 sizing에 사용하는 `2ATR`를 실제 hard stop으로 집행해야 하는가, 아니면 이것은 손절 위험이 아니라 단순한 volatility-based position scale인가?**

**alpha를 개선하려는 실험이 아니다.** 현재 `FIXED_HOLD`는 K42 만기만 집행하므로 `2ATR`는 실제 청산 boundary가 아니고, 그래서 "거래당 위험 0.25%" · `planned risk` · `open risk` · `R`은 전략의 실제 최대손실 위험으로 읽으면 **틀리다.** 이 PR은 그 모순을 해결한다.

**가능한 결론은 정확히 둘이다** — `STOP_DEFINED_RISK`(A) 또는 `VOLATILITY_SCALED_POSITION`(B). 세 번째 구조를 만들지 않는다.

**개발 표본이다.** 이 구간은 PR #9~#18에서 반복 사용됐고 OOS 검증이 아니다.

## 2. prereg checksum · 3. control 재현 (PR #16 gated LAST_CLOSE)

**drift가 있으면 challenger를 해석하지 말고 원인부터 찾는다.**

|항목|사전등록 기대|이번|
|---|---|---|
|거래|445|**445**|
|기대값 (2ATR-unit)|0.343|**0.343**|
|총수익|+47.84%|**+47.84%**|
|PF|1.47|**1.47**|
|Sharpe|0.46|**0.46**|
|MDD|12.0%|**12.0%**|
|평균 노출|16.4%|**16.4%**|
|격차 `G`|+4.99%|**+4.99%**|

구간 2007-01-04 ~ 2025-08-06 · `HOLDOUT_CONSUMED = false` (`HOLDOUT_START = 2025-08-07`)

control의 `INITIAL_STOP` 청산 수 **0건** — 0이어야 한다. 0이 아니면 처치가 control로 샌 것이다.

## 3.1 control 불변 — PR #18 산출물과 값 대조

**새 청산 모드를 더하고(§15) 문서 표현을 고친 뒤에도(§14) control이 그대로여야 한다.** 같은 코어 `jt-j126-k42-sma200`을 같은 구간으로 돌린 PR #18의 산출물과 대조한다.

**LAST_CLOSE** — **여덟 값 전부 일치**

|지표|PR #18|이번|
|---|---|---|
|`trade_count`|445|445|
|`total_return`|0.4783539447017875|0.4783539447017875|
|`expectancy_r`|0.3425001144613798|0.3425001144613798|
|`profit_factor`|1.4670976016856723|1.4670976016856723|
|`sharpe`|0.4636298044480277|0.4636298044480277|
|`max_drawdown`|0.12022689311262125|0.12022689311262125|
|`avg_exposure`|0.1642066188354821|0.1642066188354821|
|`fees_paid`|10993.03919319703|10993.03919319703|

**ZERO** — **여덟 값 전부 일치**

|지표|PR #18|이번|
|---|---|---|
|`trade_count`|445|445|
|`total_return`|0.30541212886449|0.30541212886449|
|`expectancy_r`|0.13201240498707725|0.13201240498707725|
|`profit_factor`|1.2959615839809429|1.2959615839809429|
|`sharpe`|0.2873966760074847|0.2873966760074847|
|`max_drawdown`|0.16439608973272168|0.16439608973272168|
|`avg_exposure`|0.16390018931535089|0.16390018931535089|
|`fees_paid`|9684.217310320386|9684.217310320386|

**`control-zero`는 semantic cleanup 뒤에 돌았다.** 그 값이 정리 전 PR #18과 같다는 것이 "이름만 고쳤고 행동은 안 바꿨다"의 실행 증거다. 값 비교는 부동소수 표현 그대로(`repr`) 한다 — 반올림해서 보면 미세한 drift가 숨는다.

## 4. treatment exact semantics

|항목|control|challenger|
|---|---|---|
|`exit_mode`|`FIXED_HOLD`|**`FIXED_HOLD_HARD_STOP`**|
|`regime_mode`|`TREND_GATE`|`TREND_GATE`|
|손절가|없음|`entry fill − 2 × 진입 시점 ATR14` (`initial_stop`)|
|추적손절·시간손절·실적 청산|없음|**없음**|
|만기|K42|K42 (그대로)|

**장중 검사는 `position.initial_stop`만 읽는다.** `stop_price`는 최고 종가가 진입가 +1 ATR을 넘으면 추적손절로 바뀌므로 그것을 읽으면 처치가 둘이 된다.

**체결 모델은 기존 `try_stop_exit`이다** — 시초가가 손절가 아래면 실제 시초가에 `GAP_FILL`, 장중 저가가 닿으면 손절가에 `STOP_FILL`이다. 새 stop fill engine을 만들지 않았다. 진입 당일 손절 검사도 기존 일봉 모델의 **보수적 편향 계약** 그대로다.

**`policy_id`만 다르고 행동 규칙은 `exit_mode` 하나만 다르다.** 서명을 갈라 두는 이유는 `record_holdout_run`이 서명으로 홀드아웃 소모를 세기 때문이다(로드맵 §7 C3-1).

## 5. Primary — `S`/`B`/`G` + Δ 분해 (LAST_CLOSE)

**PR #16의 분해 헬퍼를 그대로 부른다.** 복제하면 두 실험의 정의가 갈린다.

|값|fixed K42|2ATR 초기 손절|**Δ**|
|---|---|---|---|
|`S` 비용 후 전략 총수익|+47.84%|+0.95%|**-46.89%**|
|`B` 노출 일치 SPY|+42.85%|+30.05%|**-12.80%**|
|`G = S − B` 격차|+4.99%|-29.10%|**-34.09%**|

항등식: -46.89% = -12.80% + -34.09% (잔차 +0.0000000000%p)

**잔차가 0인 것은 `G ≡ S − B`라는 정의의 결과이지 발견이 아니다.**

### `F` / `T` 보조 분해 (새 criterion 아님)

|값|fixed K42|2ATR 초기 손절|Δ|
|---|---|---|---|
|`F` 평균 노출 고정|+42.37%|+36.61%|-5.75%|
|`T = B − F` 타이밍|+0.48%|-6.56%|-7.05%|

**risk semantics 연구라는 이유로 portfolio economics를 무시하지 않는다.**

## 6. Secondary economics

|지표|fixed K42|2ATR 초기 손절|Δ|
|---|---|---|---|
|총수익|+47.84%|+0.95%|**-46.89%**|
|CAGR|+2.13%|+0.05%|**-2.08%**|
|Sharpe|0.46|0.03|**-0.43**|
|Sortino|0.66|0.05|**-0.61**|
|Calmar|0.18|0.00|**-0.17**|
|MDD|12.0%|12.5%|**0.5%**|
|PF|1.47|1.00|**-0.46**|
|승률|53.0%|32.0%|**-21.0%**|
|평균 노출|16.4%|14.5%|**-2.0%**|
|회전|1.01|1.51|**0.51**|
|평균 보유|41.8|23.4|**-18.4**|
|노출 일치 격차 `G`|+4.99%|-29.10%|**-34.09%**|
|거래 수|445|740|**+295**|
|진입 수|450|744|**+294**|
|비용|$10,993|$13,853|**$2,860**|

### R 단위의 의미는 두 팔에서 다르다 (사전등록 §7)

|arm|`2ATR`의 실제 역할|기대값|부르는 이름|
|---|---|---|---|
|fixed K42|집행되지 않는다. 수량 단위일 뿐|0.343|**legacy R-unit** / **2ATR volatility-unit return**|
|2ATR 초기 손절|실제 initial stop distance|0.008|**planned-stop-risk R**|

**control의 기대값을 "실제 stop-defined risk multiple"이라고 부르지 않는다.** 그리고 challenger에서도 **"maximum-loss R"이라고 부르지 않는다** — §8이 보여주듯 실현 손실이 1R을 넘을 수 있다.

### 100% SPY 매수보유 (opportunity-cost reference)

**promotion criterion으로 쓰지 않는다.**

|기준|총수익|
|---|---|
|100% SPY 매수보유|+531.69%|

## 7. Hard-stop mechanism — 처치가 실제로 binding인가

**이 표는 promotion threshold가 아니다**(§9 조건 8의 "한 번 이상"만 판정에 들어간다). 처치가 작동했는지 확인하는 mechanism diagnostic이다.

|지표|값|
|---|---|
|`INITIAL_STOP` exit count|**472**|
|closed trades|740|
|손절이 차지하는 비율|**63.8%**|
|`STOP_FILL`|395|
|`GAP_FILL`|77|

**손절까지 보유한 세션 (K42 만기 전에 잘린 길이)** (sessions)

|값|결과|
|---|---|
|건수|472|
|평균|13.2|
|중앙|10.0|
|p90|30.0|
|p95|35.0|
|최대|41.0|

그중 **진입 당일 손절 41건** (손절의 8.7%). 일봉 모델은 그 저가가 우리 체결보다 앞선 시각이었는지 알 수 없어 실제보다 자주 걸릴 수 있다 — **기존 코드가 명시한 보수적 편향이고 이번 PR에서 바꾸지 않은 계약이다.**

**슬롯을 일찍 비운 결과는 진입 수 변화로 §6에 있다.** 조기 청산이 다음 후보를 들여보내므로 **두 팔의 entry set이 갈린다** — §11의 해석 규칙을 함께 읽는다.

## 8. gap-through / planned-stop-risk 초과

**hard stop이 생겨도 실현 손실이 planned stop risk를 넘을 수 있다** — overnight gap · 수수료 · 제세금 때문이다. **이것은 오류가 아니다.** 그래서 A가 살아남더라도 0.25%를 `planned stop risk`라고 부르고 **`guaranteed max loss`라고 부르지 않는다.**

**planned stop risk** (달러 = `수량 × 2 × 진입 시점 ATR14`)

|값|결과|
|---|---|
|건수|472|
|평균|$238|
|중앙|$243|
|p90|$252|
|p95|$253|
|최대|$261|

**실현 순손실** (달러 = `−pnl`, 비용 포함. 음수는 손절가에서 이익으로 끝난 것)

|값|결과|
|---|---|
|건수|472|
|평균|$273|
|중앙|$264|
|p90|$298|
|p95|$340|
|최대|$1,182|

**실현 손실 / planned stop risk** (배수 = `−return_r`)

|값|결과|
|---|---|
|건수|472|
|평균|1.150|
|중앙|1.089|
|p90|1.235|
|p95|1.431|
|최대|4.778|

**초과 건수** (`실현 손실 > planned stop risk`)

|항목|값|
|---|---|
|건수|**472**|
|손절 청산 대비 비율|**100.0%**|
|그중 `STOP_FILL`|395|
|그중 `GAP_FILL`|77|
|최악 배수|4.778|

### 체결 경로별 배수 — 두 경로는 다른 이유로 1R을 넘는다

**`STOP_FILL`이 1R을 넘는 것은 갭이 아니라 산술이다.** 손절가에서 정확히 체결돼도 주당 총손실은 `2ATR`이고 그 **위에** 매도 슬리피지·수수료· 제세금과 진입 쪽 비용이 얹힌다. planned stop risk는 `수량 × 2ATR`로 비용을 포함하지 않으므로 **비용이 있는 한 손절 체결의 배수는 구조적으로 1을 넘는다.** `GAP_FILL`은 거기에 시초가와 손절가의 거리가 더해진다.

|체결|건수|평균|중앙|p90|p95|최대|
|---|---|---|---|---|---|---|
|`STOP_FILL`|395|1.097|1.079|1.147|1.183|2.110|
|`GAP_FILL`|77|1.423|1.223|1.994|2.174|4.778|

**이것이 §4를 값으로 뒷받침한다** — hard stop을 실제로 집행해도 0.25%는 실현 최대손실의 상한이 아니다. 허용되는 표현은 `planned stop risk`다.

**`planned stop risk`는 다시 계산하지 않았다** — 엔진이 진입 시점에 쓴 `SizedIntent.stop_distance × shares`를 관찰자로 읽었고, 그것이 `Trade.return_r`의 분모와 같은지 항목마다 대조했다(다르면 실행이 멈춘다).

## 9. exit reason 분포

|사유|fixed K42|2ATR 초기 손절|
|---|---|---|
|`INITIAL_STOP`|0|472|
|`MAX_HOLD`|442|264|
|`DELISTED_EXIT`|2|3|
|`UNRESOLVED_EXIT`|1|1|

**`DELISTED_EXIT`·`UNRESOLVED_EXIT`는 청산 규칙이 아니라 데이터 계층의 종료 처리다.** 두 팔 모두에 있고 처치와 무관하다 — 다만 조기 손절이 포트폴리오 경로를 바꾸므로 건수는 갈릴 수 있다.

## 10. ZERO 민감도 (secondary)

**primary 판정은 `LAST_CLOSE`다.** ZERO 결과 때문에 A/B 판정을 뒤집지 않는다. 다만 계좌가 구조적으로 붕괴하는 경우는 명확히 적는다.

|시나리오|fixed K42 총수익|손절 총수익|Δ|fixed 기대값|손절 기대값|fixed MDD|손절 MDD|
|---|---|---|---|---|---|---|---|
|LAST_CLOSE|+47.84%|+0.95%|**-46.89%**|0.343|0.008|12.0%|12.5%|
|ZERO|+30.54%|-12.47%|**-43.01%**|0.132|-0.150|16.4%|22.1%|

## 11. 사전등록 verdict

**A는 여덟 조건 전부를 요구하고, 하나라도 실패하면 B다.** 결과를 본 뒤 중간 label을 만들지 않는다.

|조건|만족|값|
|---|---|---|
|1. challenger 격차 `G > 0`|아니오|-29.10%|
|2. challenger 비용 후 총수익 > 0|**예**|+0.95%|
|3. control이 이미 통과하던 경제 최소조건을 깨지 않음|아니오|깨진 항목 `gap`, `profit_factor` (본 항목 `gap`, `expectancy_r`, `profit_factor`, `max_drawdown`)|
|4. `PF ≥ 1.15`|아니오|1.00|
|5. `MDD ≤ 15%`|**예**|12.5%|
|6. `Sharpe_ch ≥ Sharpe_ctl`|아니오|0.46 → 0.03|
|7. `MDD_ch ≤ MDD_ctl`|아니오|12.0% → 12.5%|
|8. hard stop이 한 번 이상 binding|**예**|472건|

### verdict — **VOLATILITY_SCALED_POSITION**

**hard stop을 쓰지 않고 fixed K42를 유지한다.** hard-stop challenger는 연구 기록·재현용으로만 남기고 strategy stack에 넣지 않는다. 2ATR 기반 sizing은 유지하되 **이것을 actual loss risk라고 부르지 않는다** — 0.25%는 volatility sizing budget이다. **1.5 / 2.5 / 3ATR 재탐색 · trailing stop 대안 · stop confirmation을 열지 않는다.**

**실패한 조건**

- 1. challenger 격차 `G > 0`
- 3. control이 이미 통과하던 경제 최소조건을 깨지 않음
- 4. `PF ≥ 1.15`
- 6. `Sharpe_ch ≥ Sharpe_ctl`
- 7. `MDD_ch ≤ MDD_ctl`

**결과가 나쁘다고 다른 stop을 시도하지 않는다.** 사전등록 §16의 금지 목록이고 결과를 보고 확장하지 않는다.

## 12. semantic consequence

**B이므로 semantic cleanup을 한다**(사전등록 §14). 목표는 다음 거짓 표현을 없애는 것 하나다.

> "0.25%가 실제 거래당 최대손실 위험이다"

### 12.1 범위는 코어가 아니라 `exit_mode`가 정한다

**"JT 코어는 손절을 집행하지 않는다"로 일반화하지 않는다.** `jt_policy`를 쓰는 코어 중에도 `jt-core-exit`은 `CORE_EXITS`라 초기·추적·시간·실적 청산을 실제로 집행한다.

|`exit_mode`|집행되는 손절|`risk_per_trade = 0.25%`의 뜻|
|---|---|---|
|`CORE` (`core1` · `jt-core-exit`)|초기 2ATR · 추적 · 시간 · 실적|**planned stop risk**|
|`FIXED_HOLD_HARD_STOP` (`jt-j126-k42-sma200-stop`)|초기 2ATR만|planned stop risk|
|`FIXED_HOLD` · `SIGNAL_INVALIDATION`|**없음**|**volatility sizing budget**|

**현재 살아남은 strategy candidate `jt-j126-k42-sma200`는 마지막 칸이다.** 거기서 `2ATR`는 실제 stop boundary가 아니라 position scale 단위다. `paper-core-v1`·`jt-core-exit`을 설명할 때의 "계획 stop risk"는 그대로 맞는 표현이므로 지우지 않는다.

### 12.2 `FIXED_HOLD` 계열의 위험 회계는 legacy volatility-budget accounting이다

집행되는 손절이 없어도 공유 아키텍처에는 이 이름들이 그대로 남아 있다.

```
planned_risk · planned_risk_fraction · open_risk · risk_dollars
max_total_planned_risk · TOTAL_PLANNED_RISK_EXCEEDED · return_r
```

**`FIXED_HOLD` 계열에서 이 값들을 "실제 stop-defined loss risk"로 읽지 않는다.** `2ATR` 기반 position scale과 그 합의 portfolio budget을 나타내는 **legacy volatility-budget accounting**이고, 집행되는 손절선도 최대손실 한도도 뜻하지 않는다. `TOTAL_PLANNED_RISK_EXCEEDED`도 "손실 한도를 넘었다"가 아니라 "volatility budget 합계가 한도에 닿았다"로 읽는다 — **control에서 이 사유는 실제 결과를 구속하지 않았다**(§9의 skip 사유에 나타나지 않는다).

### 12.3 바꾸지 않은 것

**이름은 이번 PR에서 바꾸지 않았다.** `paper-core-v1`·DB 스키마·배포된 산출물·과거 보고서가 같은 field를 공유하므로 rename은 별도 PR의 compatibility plan이다. `risk.py`의 행동도 `max_total_planned_risk` 계산도 그대로다 — 바꾼 것은 **읽는 법**뿐이다. 이미 배포된 실행 산출물도 소급 수정하지 않는다.

**중요한 것은 하나다** — PAPER 후보 전략 설명에서 **실제 집행되지 않는 stop을 실제 loss cap처럼 부르지 않는 것.**

## 13. Limitations

- **개발 표본이다.** 이 구간은 PR #9~#18에서 반복 사용됐고 OOS 검증이 아니다
- **두 팔의 entry set이 다르다.** hard stop이 슬롯을 일찍 비워 challenger가 control이 사지 않은 종목에 진입한다. 이 결과를 **"같은 거래를 stop만 다르게 청산한 결과"라고 설명하지 않는다** — 잰 것은 **portfolio path 전체의 차이**다. trade-by-trade matched attribution을 억지로 만들지 않았다
- **인과를 증명하지 않는다** — 한 구간의 한 처치를 잰 것이다
- **`ΔS = ΔB + ΔG`의 잔차 0은 정의의 결과다** — 발견이 아니다
- **`LAST_CLOSE`가 primary이고 `ZERO`는 secondary다** — 두 층을 섞지 않았다
- **연구 코어는 `require_earnings_calendar=False`라** `EARNINGS_GATE_DISABLED` blocker가 항상 붙는다(로드맵 §7 C5). 이 PR의 판정은 그 게이트와 다른 층이다
- **잰 것은 2ATR 하나다.** 다른 배수에서 무엇이 일어나는지 재지 않았고, 재지 않은 것을 근거로 다른 배수를 열지도 않는다

