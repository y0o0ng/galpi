# PR #18 — Signal Invalidation Exit

> **결과를 계산하기 전에 작성한 사전등록 문서다.** 결과를 본 뒤 이 문서의 판정 기준을
> 고치지 않는다.

로드맵은 `docs/momentum-v2-roadmap.md`이고 이 PR은 그 **Phase 3**이다. 알파 개입 네 번 중
**세 번째**다(시장 상태 = 유지 · absolute momentum = 종료).

---

## 1. 묻는 것

> **이미 살아남은 `J126 + SMA200 신규진입 gate + K42 + S5` 구조에서, 보유 중
> entry hypothesis가 깨졌을 때 즉시 나가는 것이 fixed K42보다 after-cost portfolio
> economics를 개선하는가?**

### 왜 이 exit인가

**exit은 entry hypothesis의 반증이어야 한다.** PR #16이 승격한 진입 가설은 하나다.

> 시장이 SMA200 위이고, 이 종목은 RS126 상위다.

그 가설의 자연스러운 반증은 **시장이 SMA200 아래로 내려가는 것**이다. 새 숫자가 하나도
없고 이미 승격된 조건의 거울상이다.

**예전 CORE exit를 되살리는 것이 아니다.** `runs/jt-jk/`가 이미 반증했다 —
`jt-core-exit`(RS-only + CORE exits 전부)는 총수익 **−23.07%** · 기대값 −0.075다.

---

## 2. 고정 control

```
J126 + SMA200 신규진입 gate + K42 + S5 + 현재 sizing/execution/costs
= PR #16의 gated 팔 (`jt-j126-k42-sma200`)
```

**PR #16 gated LAST_CLOSE를 정확히 재현해야 한다.**

|항목|기대|
|---|---:|
|`S` 비용 후 총수익|**+47.84%**|
|`G = S − B` 격차|**+4.99%**|
|기대값|**0.343R**|
|PF|**1.47**|
|Sharpe|**0.46**|
|MDD|**12.0%**|
|평균 노출|**16.4%**|
|거래 수|**445**|

**drift가 있으면 treatment를 해석하지 않는다.** 원인부터 찾는다.

---

## 3. 유일한 treatment — exact semantics

보유 중 **`classify_market_regime(...).above_sma200 == false`**(= `SPY adjusted close <=
SMA200`)가 된 **최초 종가**에 청산을 **예약**하고, **다음 거래가능 session의 OPEN**에
청산한다.

### 판정 시점과 체결 시점을 분리한다

```
t일 종가:   SPY adj close <= SMA200  →  pending_exit = MARKET_TREND_BREAK 예약
t+1 시초:   execute_market_exit(price_kind="OPEN")
```

**오늘 종가로 판정하고 오늘 종가로 체결하지 않는다.** 이 경로는 `MAX_HOLD`가 쓰는 것과 **정확히 같다** — `positions.run_session` 6번이 예약하고 다음
세션 2번이 시초로 내보낸다. 새 체결 경로를 만들지 않는다.

### 거래 불가능하면 기존 상태 기계를 따른다

예약된 세션에 바가 없으면 `hold_untraded`가 `EXIT_PENDING_UNTRADEABLE`로 넘기고, 거래가
재개되면 **첫 실제 거래 가능 가격**으로 나간다. **가짜 체결을 만들지 않는다.** 명시적
폐지·era 종료는 기존 `delistings` 판정 그대로다.

### SMA200 계산을 복제하지 않는다

PR #16이 쓰는 **canonical helper `classify_market_regime(...).above_sma200`을 그대로
읽는다.** 새 SMA 계산도, 라벨 문자열 파싱도 하지 않는다. 진입 게이트와 청산이 **같은
축**을 보는 것이 이 실험의 전제다.

### 진입 게이트는 그대로다

`TREND_GATE` 신규진입 게이트를 유지한다. **바뀌는 것은 보유 포지션의 청산 하나뿐이다.**

---

## 4. reason precedence — 결과 전에 고정

같은 종가에 `MAX_HOLD`와 market break가 **동시에** 청산을 예약하게 될 수 있다. 그때
**`MAX_HOLD`를 유지한다.**

**규칙은 하나로 표현된다.**

> market break는 `pending_exit`이 **`None`일 때만** 예약한다.

**왜 이것으로 충분한가.** `run_session`이 `MAX_HOLD`를 이미 예약했다면 청산일이 어느
쪽이든 **t+1 시초로 같다** — market break가 실제 보유기간을 **단축하지 않았다.** 그런
경우에 사유를 `MARKET_TREND_BREAK`로 덮으면 진단 표가 "이 exit이 보유를 줄였다"고 거짓말을
한다.

그리고 이 규칙은 **market break가 보유기간을 늘릴 수 없다**는 것도 보장한다 — 이미
예약된 청산을 미루지 않기 때문이다. **단축했을 때만 새 사유가 붙는다.**

---

## 5. 이번 PR에서 하지 않을 것

- **ABS exit 없음** — PR #17이 `NON_BINDING`으로 종료했다
- **RS rank exit 없음** ("rank 17 아래면 판다" 같은 것)
- **initial / trailing / time / earnings stop 부활 금지**
- **새 knob 금지** — confirmation days · buffer · alternate SMA · ATR threshold
- sizing · slots · risk · costs · universe · execution 변경 금지
- 신규진입 게이트 변경 금지
- J · K · TOP5 · 후보 수 재탐색 금지
- FIP (Phase 6)
- holdout 소모

**결과가 좋든 나쁘든 로드맵을 확장하지 않는다.**

---

## 6. Primary reporting

각 팔에서

```
S = 비용 후 전략 총수익
B = 노출 일치 SPY 총수익
G = S − B
```

그리고 **반드시 함께 보고한다.**

```
ΔS = S_exit − S_control
ΔB = B_exit − B_control
ΔG = G_exit − G_control

ΔS = ΔB + ΔG      (G ≡ S − B이므로 정의상 닫힌다. 잔차가 없다)
```

---

## 7. Secondary

Sharpe · Sortino · Calmar · MDD · 기대값 R · PF · 평균 노출 · 회전 · 비용 · 거래 수 ·
진입 수 · 평균 보유기간.

**`F` / `T` 분해도 유지한다** — PR #16과 같은 정의다.

```
F = 평균 노출 고정 SPY
T = B − F        (노출 타이밍의 몫)
ΔB = ΔF + ΔT
```

**단 새 promotion criterion으로 만들지 않는다.** `ΔB`를 타이밍 그 자체로 읽지 않기 위한
보조 분해이고, PR #16에서 이미 쓰던 것을 그대로 이어간다.

---

## 8. Mechanism diagnostics

처치가 **실제로 무엇을 했는지** 재는 표다.

- `MARKET_TREND_BREAK` 청산 건수와 비중
- **실제로 K42보다 보유기간을 단축한 거래 수** (§4의 precedence 때문에
  `MARKET_TREND_BREAK`로 기록된 거래는 정의상 전부 여기 해당한다)
- **단축 세션 분포** (평균 · 중앙 · 최소 · 최대)
- 거래 수 · 진입 수 · 노출 · 비용의 변화
- **exit reason 분포** 전체 (control은 `MAX_HOLD` 442 · `DELISTED_EXIT` 2 ·
  `UNRESOLVED_EXIT` 1)

---

## 9. 판정 우선순위 — 결과 전에 고정

|순위|label|조건|처리|
|---|---|---|---|
|**1**|`CURRENT_ECONOMIC_GATE_PASS`|challenger가 현재 numeric economic gate **전체** 통과 — `G > 0` · `total > 0` · `expectancy > 0` · `PF ≥ 1.15` · **`Sharpe ≥ 0.60`** · `MDD ≤ 15%`|**signal exit 유지**|
|**2**|`PROMOTE_EXIT`|전체 gate는 미달이지만 `ΔG > 0` AND `ΔS > 0` AND `Sharpe_challenger >= Sharpe_control`, 그리고 control이 이미 통과하던 `G > 0` · `expectancy > 0` · `PF ≥ 1.15` · `MDD ≤ 15%`를 **하나도 깨지 않음**|**signal exit 유지**|
|**3**|`RISK_ONLY`|`ΔG ≤ 0` 또는 `ΔS ≤ 0`인데 risk metric만 의미 있게 개선|**alpha stack에 넣지 않는다.** risk-overlay 후보 메모만 남긴다|
|**4**|`FAIL`|나머지|**fixed K42 유지**|

**1번이 2번보다 우선한다.** 개별 metric 하나를 최적화하지 않고 최종 strategy
qualification을 우선한다 — PR #18의 판정 철학과 같다.

> **`Sharpe ≥ 0.60`이 현재 유일한 명확한 미달이다.** control이 0.46이다. 그래서 순위 2가
> `Sharpe_challenger >= Sharpe_control`을 요구한다 — 상대 edge를 올려도 Sharpe를 떨어뜨리면
> 최종 목표에서는 후퇴다.

---

## 10. 폐지 가정

**`LAST_CLOSE`가 main이다.** `ZERO`는 secondary sensitivity이고 **promotion criterion이
아니다.** 두 층을 섞지 않는다.

---

## 11. 데이터 경계

`HOLDOUT_START = 2025-08-07` 이후를 **읽지 않는다.** 기존 `research_window`를 그대로 쓴다
(`2007-01-04 ~ 2025-08-06`).

산출물에 `HOLDOUT_CONSUMED = false`를 남긴다.

---

## 12. 구조 — 처치가 하나임을 증명 가능하게

새 exit 모드 하나와 새 코어 하나로 표현한다.

|항목|control|challenger|
|---|---|---|
|`exit_mode`|`FIXED_HOLD`|**새 모드**(K42 만기 + market break)|
|`regime_mode`|`TREND_GATE`|`TREND_GATE` (같음)|
|policy 파라미터·한도·프로필|—|**같음**|
|`entry_mode` · `require_earnings_calendar` · `require_sector`|—|**같음**|

**`policy_id`만 다르고 행동 규칙은 `exit_mode` 하나만 다르다.** PR #16과 같은 이유로 서명은
갈라 둔다 — `record_holdout_run`이 서명으로 홀드아웃 소모를 세므로 공유하면 두 팔이 같은
행으로 덮어써진다(로드맵 §7 C3-1). 테스트가 dataclass 비교로 잠근다.

**기존 `FIXED_HOLD`·`CORE` 모드의 동작이 바뀌면 안 된다** — PR #10~#17의 결과가 전부 비교
불가가 된다. 회귀 테스트가 실제 실행으로 확인한다.

---

## 13. 개발 표본이다

이 구간은 PR #9~#17에서 반복 사용됐다. 결과를 **"OOS 검증"이라고 부르지 않는다.**

그리고 이 계열에는 이미 경고가 붙어 있다 — PR #15의 연도 label이 `CONCENTRATED`였고,
PR #16은 `ΔB`가 음수(노출 경로 기여가 마이너스)였으며 MDD는 오히려 나빠졌다.
**PR #18의 결과 기대를 높게 잡지 않는다.**
