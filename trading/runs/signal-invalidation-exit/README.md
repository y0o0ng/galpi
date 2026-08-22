# PR #18 — Signal Invalidation Exit

> **결과를 계산하기 전에 작성한 사전등록 문서다.** 결과를 본 뒤 이 문서의 판정 기준을
> 고치지 않는다.

로드맵은 `docs/trading/momentum-v2-roadmap.md`이고 이 PR은 그 **Phase 3**이다. 알파 개입 네 번 중
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

### 예약 위치 — loop의 어디에서 표시하는가

**`positions.run_session`이 예약하지 않는다.** `run_session`은 그날 **장중** 처리이고 그
시점에는 오늘 시장 종가를 아직 모른다. 오늘 시장 정보를 포지션의 장중 처리보다 앞으로
끌어오면 look-ahead다.

정확한 순서는 이렇다 (`backtest/loop.py`의 세 단계).

```
t일 1단계  기존 포지션 처리 완료          run_session / hold_untraded
t일 2단계  전일 pending entry 체결 완료   execute_entry
t일 3단계  마크·자산 → classify_market_regime(...) → regime 확정
           ↓ 그 직후, ranking 전에
           모든 open position을 순회해서
             exit_mode == signal-invalidation
             AND market.above_sma200 == false
             AND position.pending_exit is None
           이면  pending_exit = MARKET_TREND_BREAK
           ↓
           ranking · 게이트 · 다음 intent

t+1일 1단계  기존 pending-exit 경로로 OPEN 체결
```

**같은 market-level invalidation을 모두가 받는다** — 오늘 새로 체결된 포지션도, 오늘
개별 종목 바가 없는 stale 포지션도(그쪽은 1단계에서 `hold_untraded`를 지나 `pending_exit`이
`None`인 상태로 온다).

`market`을 판정할 수 없는 세션(`FeatureUnavailable`)에는 **아무 표시도 하지 않는다.**
`gate_new_entries`는 `above_sma200` 필드를 건드리지 않으므로 게이트 적용 전후로 같은 값이다.

**표시가 그날 자산곡선을 바꾸지 않는다** — 마크와 자산은 3단계 시작에서 이미 계산됐고,
청산은 `t+1`에만 일어난다.

### 전일 pending entry는 사후 취소하지 않는다

```
t-1 종가:  entry intent 생성 (그때는 SPY > SMA200이었다)
t일:       기존 규칙대로 entry 실행 (갭 취소·미체결 판정 그대로)
t일 종가:  market break 판정
t+1 시초:  MARKET_TREND_BREAK 청산
```

**이미 승인된 pending entry를 오늘 장 마감 후 시장이 내려갔다는 이유로 취소하지 않는다.**
그러면 **exit intervention이 entry execution까지 바꾸게 되고** 처치가 둘이 된다. 그런
포지션은 하루 들고 다음 시초에 나간다 — 규칙의 정직한 결과다.

**오늘 종가로 판정하고 오늘 종가로 체결하지 않는다.** 체결은 `MAX_HOLD`와 **같은
pending-exit 경로**를 쓴다(`run_session` 2번이 시초로 내보낸다). **새 체결 경로를 만들지
않는다.**

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

그리고 이 규칙은 **market break가 예약을 미룰 수 없다**는 것도 보장한다 — 이미 예약된
청산을 덮지 않기 때문이다.

**다만 "예약이 더 이르다"와 "체결이 더 이르다"는 다르다.** 거래정지·미체결·폐지로 체결이
원래 K42 deadline 뒤로 밀릴 수 있으므로, **실제 단축 여부는 §8의 체결 기준으로 따로
센다.**

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

> **`MARKET_TREND_BREAK`를 "정의상 실제 단축"으로 읽지 않는다.** `pending_exit is None`은
> **그 순간 `MAX_HOLD`가 아직 예약되지 않았다**는 것만 보장한다. 거래정지·미체결·폐지로
> 실제 체결이 **원래 K42 deadline 뒤로** 밀릴 수 있다. 그래서 신호와 체결을 갈라 센다.

|지표|정의|
|---|---|
|`market_break_signals_scheduled`|`pending_exit = MARKET_TREND_BREAK`를 표시한 횟수|
|`MARKET_TREND_BREAK` fills|그 사유로 실제 청산된 거래 수|
|**`fills before original K42 deadline`**|그중 체결 시점 `sessions_held < max_hold_sessions`인 것 — **이것만 "actual K42 shortening"이라고 부른다**|
|`untradeable-delayed market-break exits`|`EXIT_PENDING_UNTRADEABLE`를 거친 market-break 청산|
|`sessions remaining to K42 at signal`|표시 시점의 `max_hold_sessions − sessions_held` 분포|
|`signal→fill delay sessions`|표시부터 체결까지 걸린 세션 분포|

### 예약된 신호의 최종 outcome은 넷으로 갈린다

**"market break가 먼저 찍혔으면 최종적으로도 `MARKET_TREND_BREAK`로 기록된다"는 일반화를
하지 않는다.** loop 1단계에서 **delisting 판정이 `run_session`·`hold_untraded`보다 먼저**이고
`_terminal_fill`이 최종 사유를 `DELISTED_EXIT` 또는 `UNRESOLVED_EXIT`로 기록한다. 예약된
market break는 그 자리에서 **선점(preempt)된다.**

|outcome|뜻|
|---|---|
|**1** normal `MARKET_TREND_BREAK` fill|다음 세션 시초에 정상 체결|
|**2** untradeable-delayed `MARKET_TREND_BREAK` fill|`EXIT_PENDING_UNTRADEABLE`를 거쳐 재개 후 체결|
|**3** `DELISTED_EXIT` preemption|예약됐으나 폐지 판정이 먼저 와서 최종 사유가 덮였다|
|**4** `UNRESOLVED_EXIT` preemption|예약됐으나 미해결로 끝나 구간 끝에서 시나리오 가격으로 청산됐다|

추가 지표로 **`market_break_signals_terminally_preempted`**를 낸다 — 그중 `DELISTED_EXIT`
건수와 `UNRESOLVED_EXIT` 건수를 **따로** 센다.

**3·4는 `MARKET_TREND_BREAK` fill로도, `actual K42 shortening`으로도 세지 않는다.**
그 거래의 청산가와 시점을 정한 것은 market break가 아니라 폐지·미해결 처리이기 때문이다.

따라서 항등식은 이렇게 닫힌다.

```
market_break_signals_scheduled
  = normal fills + untradeable-delayed fills + DELISTED preempted + UNRESOLVED preempted
```

**`sessions_held < max_hold_sessions`로 판정하는 이유.** `hold_untraded`는
`exit_pending_untradeable`면 원래 사유를 그대로 들고 나이만 먹인다. 그래서 표시가 30세션에
있었고 20세션 거래정지가 끼면 체결 시 `sessions_held`가 50이 되고 **K42 deadline은 이미
지난 것**이다. 그 경우를 단축으로 세면 진단이 거짓말한다.

그리고 **거래 수 · 진입 수 · 노출 · 비용의 변화**와 **exit reason 분포 전체**를 낸다
(control은 `MAX_HOLD` 442 · `DELISTED_EXIT` 2 · `UNRESOLVED_EXIT` 1).

---

## 9. 판정 우선순위 — 결과 전에 고정

### 9.1 strategy gate는 별도 flag다 — component 판정과 섞지 않는다

```
CURRENT_ECONOMIC_GATE_PASS =
    G > 0 AND total > 0 AND expectancy > 0
    AND PF >= 1.15 AND Sharpe >= 0.60 AND MDD <= 15%
```

**이것은 component 승격 조건이 아니다.** 문턱을 낮추지 않는다.

> **2026-08-17 표기 정정 — 판정은 바꾸지 않는다.** 위 두 줄은 원래 "challenger가 **최종
> 전략 자격**을 갖췄는지를 재는 flag이고 로드맵 §4의 **최종 경제 게이트와 같은 값**"이라고
> 적었는데 **부정확하다.** §4의 최종 합격선에는 위 여섯 줄 말고도 **random ranking 대비
> 우위**와 **ZERO 시나리오에서 구조적 붕괴 없음**이 있고 **이 러너는 그 둘을 재지
> 않는다.** 그래서 이 flag은 §4의 **numeric economic subset**이지 최종 전략 합격 판정이
> 아니다. 보고서는 이것을 **`CURRENT_ECONOMIC_MINIMUMS_PASS`**로 적는다. **사전등록한
> 여섯 조건도, 아래 §9.2의 label 정의도, 이번 판정도 그대로다** — 이번 challenger는
> `ΔS < 0` AND `ΔG < 0`이라 이름과 무관하게 `RISK_ONLY`다. 사전등록 문구를 지우지 않고
> 정정을 덧붙인다.

**이 flag만으로 component를 승격시키지 않는다.** 이번 연구 질문은 **fixed K42 대비 marginal
improvement**이므로, gate를 통과했더라도 `ΔS`·`ΔG`가 악화된 exit은 "이 exit이 기여했다"는
뜻이 아니다.

### 9.2 component verdict — 결과 전에 고정

|label|조건|처리|
|---|---|---|
|**A** `PROMOTE_EXIT_AND_GATE_PASS`|`CURRENT_ECONOMIC_GATE_PASS` AND `ΔG > 0` AND `ΔS > 0`|**signal exit 유지.** 최종 자격과 marginal 기여가 함께 확인됐다|
|**B** `PROMOTE_EXIT`|gate는 미달이지만 `ΔG > 0` AND `ΔS > 0` AND `Sharpe_ch >= Sharpe_ctl`, 그리고 control이 이미 통과하던 `G > 0` · `expectancy > 0` · `PF ≥ 1.15` · `MDD ≤ 15%`를 **하나도 깨지 않음**|**signal exit 유지**|
|**C** `RISK_ONLY`|위 marginal 조건은 실패하지만 **Sharpe 상승 · MDD 감소 · Sortino 상승 · Calmar 상승 중 하나 이상**|**alpha stack에 넣지 않는다.** risk-overlay 후보 메모만 남긴다|
|**D** `FAIL`|나머지|**fixed K42 유지**|

**`CURRENT_ECONOMIC_GATE_PASS`는 A의 조건 중 하나일 뿐이고 단독 승격 사유가 아니다.**
gate를 통과했는데 `ΔS ≤ 0` 또는 `ΔG ≤ 0`이면 A가 아니라 C나 D로 간다 — 그 경우 "게이트를
넘은 것은 control이 이미 하던 일이지 이 exit이 한 일이 아니다"가 정확한 읽기다.

> **`Sharpe ≥ 0.60`이 현재 유일한 명확한 미달이다**(control 0.46). 그래서 B가
> `Sharpe_ch >= Sharpe_ctl`을 요구한다 — 상대 edge를 올려도 Sharpe를 떨어뜨리면 최종
> 목표에서는 후퇴다.

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
