# PR #16 — Market Gate Portfolio Translation

> **결과를 계산하기 전에 작성한 사전등록 문서다.** 결과를 본 뒤 이 문서의 판정 기준을
> 고치지 않는다.

로드맵은 `docs/momentum-v2-roadmap.md`이고 이 PR은 그 **Phase 1의 두 번째 단계**다.
앞 단계는 PR #15(`runs/market-condition-signal/`)이고 판정은 `PROMOTE_TO_PR16`이었다.

---

## 1. 묻는 것

> **J126이 SMA200 아래에서도 양의 signal edge를 갖는 상황에서, 그 구간의 신규진입을
> 포기하는 것이 현재 K42/S5 포트폴리오의 after-cost economics를 개선하는가?**
>
> 그리고 개선이 있다면 그것이 **노출·타이밍 기여(ΔB)**인지 **matched-SPY 상대
> 기여(ΔG)**인지 분해한다.

### 이 질문이 "나쁜 거래 제거"가 아닌 이유

PR #15의 측정값이다.

|J|UP excess|DOWN excess|
|---|---:|---:|
|J63 (frozen control)|+1.111%|**−1.640%**|
|**J126 (alpha under test)**|+1.188%|**+0.507%**|

**J63은 DOWN에서 alpha가 음수로 반전되지만 J126은 양수가 남는다.** 그래서 J126에
SMA200 게이트를 넣는 것은 **신호 층에서 이미 양수인 구간을 통째로 버리는 것**이다.

**"나쁜 DOWN 거래를 제거한다"라고 쓰지 않는다.** 정확히는 **더 약하지만 여전히 양의
alpha를 가진 구간을 포기했을 때 전체가 좋아지는가**를 묻는다.

> 다만 PR #15는 그 DOWN 평균 자체도 안정적이지 않다는 것을 함께 기록했다 — 연도별 J126
> DOWN이 −9.140% ~ +17.788%로 흩어져 있다. **+0.507%를 상시적인 양의 edge로 읽지 않는다.**

---

## 2. 처치는 하나다

|항목|값|
|---|---|
|신호|`RS(126, 5)` (frozen alpha under test)|
|control|게이트 없는 `jt-j126-k42`|
|challenger|**`SPY close > SMA200`일 때만 신규진입**|
|선택|TOP5|
|보유|K42|
|슬롯|S5|
|sizing · execution · exit · costs · regime 나머지 · 폐지 처리|**전부 현재 그대로**|

**바꾸는 것은 신규진입 허용 여부 하나뿐이다.**

**기존 포지션은 게이트가 꺼져도 K42까지 들고 간다.** 그래야 entry timing 효과만 잰다 —
청산까지 바꾸면 진입 효과와 청산 효과가 섞인다.

**계좌 낙폭을 게이트에 넣지 않는다.** `CLAUDE.md`의 자기 잠금 경고 그대로다 — 손실 →
방어 → 진입 없음 → 자산 정지 → 낙폭 영구 고정의 고리가 닫힌다. SMA50도 realized vol도
쓰지 않는다.

**레짐 게이팅은 상태 이름이 아니라 `new_entries`를 본다.** 이름으로 가르면 분류기를
바꾸는 순간 진입 상한이 조용히 0이 된다.

---

## 3. Primary — 분해해서 본다

각 팔(control · gated)에 대해 계산한다.

```
S = after-cost strategy return
B = exposure-matched SPY return
G = S − B
```

그리고 **반드시 함께 보고한다.**

```
ΔS = S_gate − S_control
ΔB = B_gate − B_control
ΔG = G_gate − G_control

ΔS = ΔB + ΔG      (G ≡ S − B이므로 정의상 정확히 닫힌다. 잔차가 없다)
```

**왜 분해하는가.** 노출 일치 벤치마크는 정의상 타이밍을 상쇄한다 — 전략이 게이트로 노출을
끄면 벤치마크도 같이 꺼지므로 `G`는 *선택 능력*만 재고 *타이밍 능력*은 보지 못한다.
PR #13이 이미 그 현상을 보였다("격차 +1.88%p 개선 중 87%가 벤치마크 쪽"). market-timing
처치에서는 그 효과가 훨씬 커진다.

**로드맵 §4의 최종 합격 기준(`G > 0`)은 완화하지 않는다.** 이 분해는 component를 alpha
stack에 넣을지 timing overlay 후보로 보존할지를 가르는 데만 쓴다.

---

## 4. 사전등록 secondary

- total return / CAGR
- MDD
- Sharpe
- Calmar
- average exposure
- exposure reduction
- **100% SPY 매수보유 비교**

**SPY 매수보유는 opportunity-cost reference로만 보고 promotion criterion으로 쓰지
않는다.**

---

## 5. 결과 해석 label — 결과 전에 고정

|label|조건|처리|
|---|---|---|
|**A** `ECONOMICS_AND_RELATIVE_IMPROVED`|`ΔS > 0` AND `ΔG > 0`|SMA200 gate를 다음 momentum strategy construction 단계에 **유지**. **이 label은 `ΔB > 0`을 요구하지 않으므로 "타이밍이 좋아졌다"로 읽지 않는다** — `ΔB`는 따로 본다|
|**B** `TIMING_BENEFIT_ONLY`|`ΔS > 0` · `ΔG ≤ 0` · MDD 감소 + Sharpe 상승 + Calmar 상승 + exposure 감소|**alpha conversion 개선으로 보지 않는다.** alpha stack에 자동 승격하지 않고 `PARKED_TIMING_OVERLAY_CANDIDATE`로 **보존**한다. 향후 alpha strategy가 경제성 허들을 통과했을 때 risk/timing overlay 단계에서 다시 검토|
|**C** `RISK_ONLY`|`ΔS ≤ 0`인데 MDD·Sharpe·Calmar만 개선|현재의 낮은 수익 문제를 해결하지 못하므로 **alpha stack에서 탈락.** risk overlay 후보로만 기록|
|**D** `FAIL`|전체 economics와 matched gap 모두 개선 없음|**SMA200 market gate 종료**|

**`D`인 경우 alternate SMA · SMA150 · SMA250 · 10개월 이동평균 · volatility gate ·
BULL-only 탐색을 하지 않는다.** 사용자 검토 없이 다음 대안을 열지 않는다.

**`B`는 실패가 아니라 보존이다.** 다만 **alpha stack 승격은 아니다** — 그 구분을 흐리면
"게이트가 전략을 살렸다"는 문장이 만들어진다.

### 잔여 칸 둘 — **결과 전에 채웠다**

위 A~D는 `(ΔS, ΔG, 위험)` 공간을 **완전히 덮지 않는다.** 구현하면서 발견했고 **어떤 실행도
하기 전에** 채운다. 둘 다 **alpha stack 승격이 아니다.**

|label|조건|왜 A~D에 없었나|처리|
|---|---|---|---|
|**B′** `TIMING_BENEFIT_UNCONFIRMED`|`ΔS > 0` · `ΔG ≤ 0` · **위험 네 항목이 다 개선되지는 않음**|B는 네 항목 전부를 요구한다. 일부만 개선된 칸이 비어 있었다|총수익은 올랐지만 overlay 근거가 B보다 약하다. **기록만** 남긴다|
|**C′** `RELATIVE_ONLY`|`ΔS ≤ 0` · **`ΔG > 0`**|C는 `ΔS ≤ 0`에 `ΔG ≤ 0`을 전제했고 D도 "둘 다 개선 없음"이다. 총수익은 나빠졌는데 상대 위치만 좋아진 칸이 비어 있었다|**현재의 낮은 수익 문제를 해결하지 못하므로 alpha stack 승격이 아니다**|

**승격하는 label은 `A` 하나뿐이라는 원래 구조는 바뀌지 않았다.** 잔여 칸을 채운 것은
분류를 완결시킨 것이지 문턱을 낮춘 것이 아니다.

세부 조건도 문구 그대로 구현했다 — **B는 네 항목 전부**(MDD 감소 + Sharpe 상승 +
Calmar 상승 + exposure 감소), **C는 위험 품질 세 항목**(MDD/Sharpe/Calmar)이다.

### label 이름에 대한 주의

`A`의 조건은 **`ΔS > 0` AND `ΔG > 0`뿐이고 `ΔB > 0`을 요구하지 않는다.** 그래서 `ΔB < 0`
(타이밍 기여가 **음수**)이면서도 `A`가 나올 수 있다. 이름을 `ALPHA_AND_TIMING_IMPROVED`로
두면 그 경우를 "타이밍이 좋아졌다"로 읽게 되므로 **`ECONOMICS_AND_RELATIVE_IMPROVED`로
바꿨다.** `ΔB`는 label과 별개로 항상 따로 보고한다.

---

## 5.5 다음 단계 규칙 — **결과 전에 고정**

label과 **로드맵 §4의 최종 경제 게이트**(after-cost exposure-matched SPY gap > 0 및 최소
조건)를 함께 읽어 다음 행동을 정한다.

|경우|조건|다음 단계|
|---|---|---|
|**1**|`A` **AND** gated 팔이 최종 경제 게이트 통과|**불필요한 추가 alpha filter를 열지 않는다.** Phase 2(`ABS`)·Phase 6(FIP)로 자동 진행하지 않는다|
|**2**|`A` **인데** 최종 경제 게이트 미달|**SMA200을 유지한 채** 다음 alpha construction으로 간다. 이후 Phase는 gated 구조 위에서 쌓는다|
|**3**|그 외 **모든** label|**SMA200은 alpha stack에서 제외한다.** timing/risk 후보로 보존할 수는 있으나, **다음 alpha construction은 ungated J126에서 시작한다**|

**경우 3에서 "보존"과 "alpha stack 포함"을 섞지 않는다.** 보존은 나중에 risk/timing
overlay 단계에서 다시 볼 수 있다는 뜻일 뿐, 다음 Phase의 기준선이 된다는 뜻이 아니다.

**경우 1이 나와도 "전략이 완성됐다"가 아니다.** Phase 7(Reality Hardening) · Phase 8
(Robustness) · Phase 9가 그대로 남아 있고, 연구 코어는 `require_earnings_calendar=False`라
14.7 게이트에서 여전히 `UNDETERMINED`다.

---

## 6. 데이터 경계

`HOLDOUT_START = 2025-08-07` 이후는 **읽지 않는다.** 기존 `research_window`를 그대로
쓴다(PR #10~#14와 같은 구간 `2007-01-04 ~ 2025-08-06`).

산출물에 `HOLDOUT_CONSUMED = false`를 남긴다.

---

## 7. 재현 먼저

**새 결과를 해석하기 전에 control이 재현돼야 한다.** 게이트 없는 `jt-j126-k42`가 PR #13·#14의
값과 일치해야 한다.

|항목|기대|
|---|---|
|거래|512|
|기대값R|0.233|
|총수익|+35.63%|
|MDD|10.8%|
|평균 노출|17.8%|

**재현이 깨지면 게이트 결과를 해석하지 말고 drift부터 설명한다.**

---

## 8. 폐지 가정

`LAST_CLOSE`가 main attribution이고 `ZERO`는 보조 민감도다. **둘을 섞지 않는다.**
PR #13에서 J126이 ZERO에 크게 민감했으므로(총수익 +35.6% → +4.7%) 게이트가 그 민감도를
어떻게 바꾸는지도 함께 본다 — 다만 **main 판정은 `LAST_CLOSE`로 한다.**

---

## 9. 이번 PR에서 하지 않을 것

- alternate SMA · volatility gate · BULL-only
- `ABS(126,5)` (Phase 2)
- dynamic exit (Phase 3) · hard stop (Phase 4) · sizing 변경 (Phase 5) · FIP (Phase 6)
- J · K · 슬롯 · 후보 수 재탐색
- 무작위 시드 확장
- holdout 소모
- production / paper 정책 변경

**결과가 좋든 나쁘든 로드맵을 확장하지 않는다.**

---

## 10. 개발 표본이다

이 구간은 PR #9~#15에서 반복 사용됐다. 결과를 **"OOS 검증"이라고 부르지 않는다.**

그리고 PR #15의 신호 층 근거에는 이미 경고가 붙어 있다 — 연도 label이 `CONCENTRATED`이고
(2009 또는 2011을 빼면 full-sample 부호가 뒤집힌다), frozen control J63의 시장 대비가
J126보다 크다(+2.751% vs +0.681%). **PR #16의 결과 기대를 높게 잡지 않는다.**
