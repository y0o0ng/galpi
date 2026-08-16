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
|**A** `ALPHA_AND_TIMING_IMPROVED`|`ΔS > 0` AND `ΔG > 0`|SMA200 gate를 다음 momentum strategy construction 단계에 **유지**|
|**B** `TIMING_BENEFIT_ONLY`|`ΔS > 0` · `ΔG ≤ 0` · MDD 감소 + Sharpe 상승 + Calmar 상승 + exposure 감소|**alpha conversion 개선으로 보지 않는다.** alpha stack에 자동 승격하지 않고 `PARKED_TIMING_OVERLAY_CANDIDATE`로 **보존**한다. 향후 alpha strategy가 경제성 허들을 통과했을 때 risk/timing overlay 단계에서 다시 검토|
|**C** `RISK_ONLY`|`ΔS ≤ 0`인데 MDD·Sharpe·Calmar만 개선|현재의 낮은 수익 문제를 해결하지 못하므로 **alpha stack에서 탈락.** risk overlay 후보로만 기록|
|**D** `FAIL`|전체 economics와 matched gap 모두 개선 없음|**SMA200 market gate 종료**|

**`D`인 경우 alternate SMA · SMA150 · SMA250 · 10개월 이동평균 · volatility gate ·
BULL-only 탐색을 하지 않는다.** 사용자 검토 없이 다음 대안을 열지 않는다.

**`B`는 실패가 아니라 보존이다.** 다만 **alpha stack 승격은 아니다** — 그 구분을 흐리면
"게이트가 전략을 살렸다"는 문장이 만들어진다.

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
