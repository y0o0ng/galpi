# PR #20 Stage A — FIP / Information Discreteness Signal Study

**물은 것:** `SPY > SMA200`인 개발표본에서, `ID(126,5) < 0` 후보 안에서 다시 뽑은 RS126 TOP5가 **동일 날짜의** 기존 RS126 TOP5보다 +42 forward excess를 높이는가.

**이 Stage는 포트폴리오를 건드리지 않는다.** 사전등록은 결과 전에 커밋했고 (`README.md`) HARD A~E·binding label·Stage B 규칙을 **그때 전부** 박았다.

**FIP는 alpha 예산의 마지막 카드다.** 실패하면 long-only cross-sectional momentum 단독 전략의 alpha construction을 종료한다.

## 1. 논문 아이디어와 이번 adaptation

Da·Gurun·Warachka(2014)의 Frog-in-the-Pan은 **같은 누적 momentum이라도 작고 잦은 움직임으로 쌓인 종목**(continuous)이 **몇 번의 큰 jump로 오른 종목**(discrete)보다 이후 continuation이 강하다고 본다.

**논문 복제라고 쓰지 않는다.**

|항목|논문|이번|
|---|---|---|
|formation|12−1 개월|**frozen RS와 같은 `126 / skip 5`**|
|포지션|winner−loser 스프레드|**long-only TOP5**|
|선택|ID 십분위 등|**`ID < 0` 이진 조건 하나**|
|시장 조건|없음|**`SPY > SMA200` 게이트 위에서**|

```
PRET = absolute_momentum(adj_close, 126, 5)
ID   = sign(PRET) × (n_neg − n_pos) / (n_pos + n_neg)
       n_pos + n_neg == 0 이면 ID = 0
```

**크기로 가중하지 않는다** — 부호의 빈도만 본다. 크기를 넣으면 RS의 magnitude 정보와 역할이 겹친다. `PRET`은 `absolute_momentum` 정본을 그대로 부르므로 RS와 **같은 두 endpoint**를 쓴다.

## 2. 데이터 경계

|항목|값|
|---|---|
|`HOLDOUT_START`|`2025-08-07`|
|`HOLDOUT_CONSUMED`|`false`|
|마지막 신호일|`2025-06-05`|
|마지막 forward 목표일|`2025-08-06`|

**둘 다 cutoff 이전이다.** 달력 자체가 잘려 있어 forward 목표일도 넘어갈 수 없다.

유효 paired 날짜 **3,385개** · `SPY <= SMA200`이라 제외한 날짜 1,027개 · ID<0 통과 후보가 0개인 날짜 0개

## 3. 재현 checksum

**PR #17이 같은 날짜·유니버스·지평으로 낸 control을 source of truth로 읽어 대조한다.** drift가 있으면 FIP 결과를 해석하지 않는다.

|유니버스|PR #17 (관측 가중)|이번 (관측 가중)|일치|
|---|---|---|---|
|ALL|+1.188%|**+1.188%**|**예**|
|NDX100|+2.043%|**+2.043%**|**예**|

관측 수 16,925개 = 날짜 3,385 × 5.

**checksum은 관측 가중이고 paired 분석은 날짜 가중이다.** 두 estimand는 개념적으로 다르지만 이 러너의 control 표본 구조에서는 정의상 같게 닫힌다 — forward가 없는 종목을 랭킹 전에 빼므로 control TOP5가 항상 정확히 5관측이다.

## 4. Primary — 날짜 단위 paired `D_t` (`ALL` · +42)

**두 평균을 따로 내서 빼지 않았다.** 같은 날짜·같은 시장 상태·같은 유니버스에서 후보 조건 하나만 바뀐 비교다.

|값|결과|
|---|---|
|control (날짜 가중)|+1.188%|
|FIP (날짜 가중)|+1.242%|
|**`mean(D)`**|**+0.055%**|
|`median(D)`|+0.000%|
|양수 `D` 날짜 비율|11.7%|
|`D` 최소 / 최대|-13.709% / +21.227%|
|유효 paired 날짜|3,385|

**유니버스 평균은 두 팔에서 같다** — FIP는 후보 조건이지 유니버스 변경이 아니다. 그래서 `D_t`에서 유니버스 평균이 상쇄되고 두 바구니의 raw forward 평균 차이가 된다.

## 5. 필터 구속력

**PR #17의 ABS는 3,385일 중 구성 변경이 0일이라 `NON_BINDING`으로 끝났다.** 그러면 "개선 없음"과 "애초에 안 걸림"이 구별되지 않는다. 먼저 그것부터 본다.

|지표|값|
|---|---|
|`composition_changed_dates`|**21.7%** (736일)|
|`candidate_replacement_rate`|5.0% (840 / 16,925)|
|TOP5가 완전히 같은 날짜|78.3%|
|평균 overlap|4.75 / 5|
|ID<0 통과 후보 수 (평균 / 최소 / 최대)|358.4 / 226 / 467|
|통과 후보가 5개 미만인 날짜|0|
|treatment basket 크기 (평균 / 최소)|5.00 / 5|

### binding label — **BINDING**

`NON_BINDING` = 0% · `LOW_BINDING` = 0~5% · `BINDING` ≥ 5%. **5%는 해석 label이지 promotion threshold가 아니다.**

### 구성이 바뀐 날짜만의 `D` 분포

**희소한 몇 날짜에 의존하는지 드러내는 표다.**

|값|결과|
|---|---|
|날짜|736|
|`mean(D)`|+0.251%|
|`median(D)`|+0.323%|
|최소 / 최대|-13.709% / +21.227%|

## 6. ID 분포

|집단|건수|평균|중앙|p10|p25|p75|p90|
|---|---|---|---|---|---|---|---|
|자격 유니버스 전체|1,584,335|-0.063|-0.059|-0.174|-0.117|-0.008|0.041|
|control TOP5|16,925|-0.134|-0.133|-0.240|-0.190|-0.074|-0.026|

**control TOP5 중 `ID < 0`인 비율 95.0%** (16,085 / 16,925) — 이 값이 100%에 가까우면 필터가 걸릴 일이 거의 없다.

### §6 진단 — ABS를 되살리지 않았다

**FIP는 `ID < 0`만 본다.** `PRET > 0`을 함께 걸지 않았다. 그 결과 treatment TOP5에 `PRET <= 0`인 이름이 남을 수 있고, **남더라도 post-hoc ABS filter를 추가하지 않는다** — limitation으로만 적는다.

|값|결과|
|---|---|
|treatment TOP5 이름 수|16,925|
|그중 `PRET <= 0`|**0** (0.0%)|

## 7. +42 위상 안정성

매일 뽑으면 +42 수익률이 41/42 겹친다. **관측 수를 독립 표본 수로 읽지 않는다. p-value를 만들지 않았다.**

|값|결과|
|---|---|
|유효 위상|42/42|
|양수 위상|25|
|**양수 비율**|**59.5%** (최소 60%)|
|위상 `mean-D` 중앙|+0.057%|
|최소 / 최대|-0.406% / +0.411%|

## 8. 연도 분포

|연도|paired 날짜|`mean(D)`|`median(D)`|leave-one-year-out|
|---|---|---|---|---|
|2008|5|+0.041%|+0.000%|+0.055%|
|2009|151|-0.149%|+0.000%|+0.064%|
|2010|192|+0.112%|+0.000%|+0.051%|
|2011|160|-0.119%|+0.000%|+0.063%|
|2012|247|+0.583%|+0.000%|+0.013%|
|2013|252|+0.163%|+0.000%|+0.046%|
|2014|247|+0.102%|+0.000%|+0.051%|
|2015|198|-0.386%|+0.000%|+0.082%|
|2016|204|+0.120%|+0.000%|+0.050%|
|2017|251|+0.134%|+0.000%|+0.048%|
|2018|210|-0.030%|+0.000%|+0.060%|
|2019|225|+0.553%|+0.000%|+0.019%|
|2020|194|-0.265%|+0.000%|+0.074%|
|2021|252|-0.193%|+0.000%|+0.075%|
|2022|47|+1.951%|+0.000%|+0.028%|
|2023|234|+0.120%|+0.000%|+0.050%|
|2024|252|+0.242%|+0.000%|+0.040%|
|2025|64|-2.907%|-2.020%|+0.112%|

### 연도 집중도 — **BROAD**

leave-one-year-out이 전부 같은 방향이고 양의 연도가 11/18

**단독 hard veto로 쓰지 않는다.**

## 9. paired random control (secondary diagnostic)

deterministic 시드 **20개**(`0..19`)를 같은 random ranking으로 full pool과 ID<0 pool에 적용해 **날짜 paired**로 뺐다.

**HARD A~E에 넣지 않았다. promotion criterion이 아니고 formal p-value도 아니다.**

|값|결과|
|---|---|
|실제 `mean(D)`|**+0.055%**|
|무작위 `mean(D)` 중앙|+0.014%|
|무작위 최소 / 최대|-0.078% / +0.087%|
|**이김**|**14/20**|

**해석 목적은 하나다** — 개선이 **RS-specific interaction**인지 **generic continuous-pool effect**인지 가르는 것이다. 랭킹과 무관하게 `ID < 0` 풀이 원래 더 좋다면 무작위 팔에서도 같은 개선이 나온다. **어느 쪽도 자동 탈락 사유가 아니다.**

## 10. NDX100 robustness

**`ALL`과 중첩되는 sub-universe다. 독립 OOS가 아니다.**

|값|결과|
|---|---|
|control (날짜 가중)|+2.043%|
|FIP (날짜 가중)|+2.045%|
|**`mean(D)`**|**+0.002%**|
|`median(D)`|+0.000%|
|paired 날짜|3,385|
|binding|BINDING (25.1%)|

## 11. 사전등록 판정 (HARD A~E)

**PR #17 ABS signal study의 다섯 기준을 그대로 재사용했다.** 새 평가 철학을 만들지 않았다.

|기준|조건|결과|판정|
|---|---|---|---|
|**A**|`NON_BINDING`이 아닐 것|BINDING (21.7%)|**PASS**|
|**B**|primary `mean(D) > 0`|+0.055%|**PASS**|
|**C**|`median(D) >= 0`|+0.000%|**PASS**|
|**D**|위상 양수 비율 ≥ 60%|59.5% (25/42)|**FAIL**|
|**E**|NDX100 paired `mean(D) >= 0`|+0.002%|**PASS**|

### Stage A 판정 — **DO_NOT_TRANSLATE_FIP**

**Stage B를 실행하지 않는다.** portfolio core를 만들지 않고, 다른 FIP threshold를 시험하지 않으며, TrendQuality를 부활시키지 않고, 다른 quality filter를 열지 않는다.

```
momentum alpha intervention 4/4 consumed
standalone momentum alpha construction terminated
```

## 12. Stage B 실행 여부 — **실행하지 않음**

Stage A가 **`DO_NOT_TRANSLATE_FIP`**이므로 사전등록 §16에 따라 portfolio translation을 실행하지 않았다.

**만들지 않은 것** — FIP portfolio core · `RS_ONLY_FIP` / `RANDOM_FIP` 진입 모드 · Stage B 러너 · random-FIP 10시드 실행. `test_fip_signal.py`의 `StageGateTest`가 **Stage A가 승격이 아닐 때 그것들이 저장소에 없다는 것**을 값으로 잠근다 — 신호가 죽은 뒤 포트폴리오를 도는 사고를 코드 수준에서 막는다.

따라서 아래 절들(control reproduction · portfolio S/B/G · secondary economics · FIP mechanism · random-FIP · ZERO · MARGINAL · final strategy gate)은 **해당 없음**이다. 재지 않은 것을 잰 것처럼 적지 않는다.

## 13~17. Stage B 절 — 해당 없음

|절|상태|
|---|---|
|control reproduction|해당 없음|
|portfolio `S`/`B`/`G`|해당 없음|
|secondary economics|해당 없음|
|FIP mechanism|해당 없음|
|random-FIP distribution|해당 없음|
|ZERO|해당 없음|
|`MARGINAL_PASS` / `FAIL`|해당 없음|
|final strategy gate|해당 없음|

## 18. 최종 outcome — **FIP_SIGNAL_REJECTED**

사전등록 §26의 네 결과 중 **A**다.

- portfolio translation 없음
- FIP 폐기
- **alpha interventions 4/4 소진**
- **standalone long-only momentum construction 종료**
- **Phase 7로 가지 않음**

```
momentum alpha intervention 4/4 consumed
standalone momentum alpha construction terminated
```

**다른 threshold·window·quality filter를 시험하지 않는다.** 사전등록 §5·§28의 금지 목록이고 결과가 아쉽다고 확장하지 않는다.

## 19. Limitations · holdout statement

- **개발 표본이다.** 이 구간은 PR #9~#19에서 반복 사용됐고 OOS 검증이 아니다
- **NDX100은 독립 OOS가 아니다** — `ALL`과 중첩되는 sub-universe다
- **portfolio economics를 재지 않았다** — 이 Stage는 신호 층이다
- **중첩 표본이다** — 관측 수를 독립 표본 수로 읽지 않았고 p-value를 만들지 않았다
- 무작위 20시드는 coarse control이고 formal test가 아니다
- **`PRET <= 0`인 treatment 이름을 제거하지 않았다** — ABS 조건을 묶으면 intervention이 둘이 된다(§6). 건수는 위에 값으로 남겼다
- **인과를 증명하지 않는다**

**holdout** — `HOLDOUT_START = 2025-08-07` 이후를 읽지 않았다. 신호일도 forward 목표일도 그 이전이고 모든 산출물이 `HOLDOUT_CONSUMED = false`다. **formal OOS라고 부르지 않는다.**

