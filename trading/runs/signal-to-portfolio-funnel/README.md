# 변환 퍼널 진단 — RS 신호는 포트폴리오의 어느 단계에서 사라지는가

**이번은 새로운 전략 실험이 아니다. 파라미터를 하나도 바꾸지 않는다.**

PR #12에서 관찰된 J126의 신호 층 우위가 PR #13의 실제 포트폴리오에서는 거의 사라진
이유를, 변환 단계별로 따라가는 **read-only diagnostic**이다.

## 물은 것

> PR #12의 J126 signal advantage는
> `signal → admission → fill → realized trade → R → dollar PnL`
> 중 **어느 단계에서** 사라지는가?

특히 sizing 가설의 핵심:

> J126의 우위가 실제 체결된 종목의 raw 퍼센트 수익률까지는 남아 있는데
> R 또는 달러 기여에서만 사라지는가?

## 배경 — PR #12와 PR #13

**PR #12 신호 층** (`runs/signal-j-study/`), TOP5 · +42 · 유니버스 대비 초과수익:

|유니버스|J63|J126|
|---|---:|---:|
|ALL (primary)|+0.48%|+1.03%|
|NDX100|+1.01%|+1.75%|

두 유니버스·여섯 지평·common anchor·위상 안정성에서 J126이 반복적으로 J63 이상이었고,
그래서 신호 challenger를 J126 하나로 좁혔다.

**PR #13 포트폴리오 층** (`runs/j126-portfolio-translation/`), K42 / S5 / skip5 / TOP5 ·
동일 risk·cost·execution 구조 · LAST_CLOSE:

|지표|J63|J126|
|---|---:|---:|
|총수익|+35.39%|+35.63%|
|기대값|0.229R|0.233R|
|MDD|9.4%|10.8%|

**신호 층의 큰 차이에 비해 포트폴리오 층 차이는 사실상 사라졌다.** ZERO 가정에서는 J126이
크게 악화됐다.

가능한 원인이 여럿이다 — portfolio admission·슬롯 · 익일 체결 · 실제 체결된 부분집합 ·
고정 K42 청산 · ATR 정규화 위험 표현 · 수량·notional 가중 · 폐지 상호작용. **어느 단계가
주원인인지 아직 모르므로 바로 sizing rule을 바꾸지 않는다.**

## 이 PR은 intervention이 아니라 measurement다

**변경하지 않은 것:** J · K · skip · slots · `risk_per_trade` · stop multiple ·
`max_position_weight` · max exposure · TOP5 · candidate count · sizing formula ·
execution · exit · costs · regime · delisting logic.

**새 코어를 만들지 않았다.** 읽은 것은 기존 둘뿐이다.

    jt-k42          # J63
    jt-j126-k42     # J126

production·paper 정책 동작을 바꾸지 않았다.

## 계측 — 관찰자는 읽기만 한다

PR #11이 넣은 read-only `observer(날짜, 랭크, 종목, 결과)`를 그대로 재사용하고, 수량·상한·
체결을 보려고 `entry_observer(EntryEvent)`를 더했다. `EntryEvent`는 게이트를 통과한 주문
하나가 **다음 세션에서** 어떻게 끝났는지를 `SizedIntent`·`Caps`·체결·취소 사유와 함께
넘긴다.

**진단용 sizing 계산기를 따로 만들지 않았다.** §10의 요구대로 엔진이 실제로 계산한 값을
그 자리에서 읽는다. 복제하면 그 복제본이 엔진과 갈릴 자리가 생기고, 그러면 진단이 실험을
설명하지 못한다.

관찰자가 ranking·sizing·gate·execution·exit 결과를 바꾸지 않는다는 것은
`tests/test_funnel.py`의 `EntryObserverTest`가 잠근다 — `observer=None`과 켠 실행의
`trades`·`fills`·`equity_curve`·`open_positions`·`skip_counts`·`fill_counts`·
`exit_counts`가 전부 같아야 한다.

## 퍼널 단계 정의

|단계|뜻|
|---|---|
|**STAGE 0** ELIGIBLE TOP5|신호일 유니버스·필터 통과 후 RS 랭킹 TOP5 전체|
|**STAGE 1** PORTFOLIO ACCEPTED|포트폴리오 게이트를 통과한 후보. **체결이 아니다**|
|**STAGE 2** FILLED|다음 세션에 실제로 체결되어 포지션이 열린 후보|
|**STAGE 3** CLOSED TRADE|실제로 청산까지 끝난 거래|
|**STAGE 4** RAW RETURN|`청산가 / 진입가 - 1`|
|**STAGE 5** R MULTIPLE|엔진의 `pnl / (수량 × 2 ATR)`. **새 R 정의를 만들지 않았다**|
|**STAGE 6** DOLLAR|실제 주식 수가 적용된 달러 손익|

`ACCEPTED`는 엔진이 이미 쓰던 용어를 그대로 썼다.

## 신호 척도는 단계마다 같다

STAGE 0·1·2의 후보 전부에 PR #12과 **같은** +42 척도를 붙인다.

    신호일 adj_close  →  신호일 +42세션 adj_close
    그리고 그날 자격 유니버스 평균 대비 초과

단계마다 정의를 바꾸면 "TOP5에서는 우위 → accepted에서 감소 → filled에서 소멸" 같은 변화를
직접 읽을 수 없다.

**자격 유니버스는 J와 무관하다.** `compute_features`가 요구하는 것은 이력 252세션이고
`RS(126, 5)`는 127바면 되므로 J63과 J126의 자격 집합이 같다. 그래서 유니버스 기준선
(`universe-forward.json`)은 **한 번만** 계산해 두 J가 공유한다. 유니버스는 백테스트가 쓰는
`rank_candidates`가 그대로 낸다 — 후보 TOP5와 `BELOW_TOP_N` 스킵을 합치면 그날 자격을 갖춘
전체다. 간이 구현을 만들면 진단과 실험의 유니버스가 갈린다.

## LAST_CLOSE가 main이고 ZERO는 보조다

**퍼널의 main attribution은 LAST_CLOSE다.** ZERO 재실행은 data-exit·sizing 민감도를 **같은
계측으로** 재기 위한 보조 진단이고, **ZERO 결과를 main 퍼널과 섞지 않는다.**

두 층의 폐지 정의도 섞지 않는다 — 신호 층 forward는 PR #12의 stale·마지막 종가 고정
정의이고, 실제 거래 결과는 포트폴리오의 `LAST_CLOSE` / `ZERO` 시나리오 가격이다. "신호
forward에서 ZERO였다" 같은 문장은 만들지 않는다.

## 홀드아웃

forward +42를 다시 계산하므로 PR #9/#12 규칙을 그대로 쓴다. `research_calendar`가 **달력
자체를** `HOLDOUT_START = 2025-08-07` 전에서 자르고, 신호일도 forward 목표일도 그 잘린
달력에서만 나온다. 실제 포트폴리오 실행은 기존 `research_window`를 그대로 쓴다.

## 사전 판정 기준 A~L — 결과를 본 뒤 바꾸지 않는다

- **A.** PR #12의 TOP5 J126 우위가 이 러너에서도 재현되는가
- **B.** ACCEPTED 단계에서도 유지되는가
- **C.** FILLED 단계에서도 유지되는가
- **D.** 실제 raw 퍼센트 거래 수익률에서도 유지되는가
- **E.** R 배수에서 유지되는가
- **F.** 달러 손익 기여에서도 유지되는가
- **G.** J63/J126 정규화 ATR 분포가 실제로 다른가
- **H.** 진입 notional 비중 분포가 다른가
- **I.** 실제 sizing 구속 제약이 무엇인가
- **J.** data-exit 거래가 큰 notional·낮은 변동성 꼬리에 위치하는가
- **K.** 신호 우위의 가장 큰 소실이 어느 단계 사이에서 나타나는가
- **L.** 현재 증거로 sizing을 다음 intervention target으로 올릴 수 있는가

## 사전 해석 규칙 — PATTERN A/E/S/N

`selftest/funnel_run.py`의 `classify_pattern`이 이 표를 그대로 코드로 들고 있고
`tests/test_funnel.py`의 `PatternTest`가 각 줄을 값으로 잠근다.

|패턴|관측|읽는 법|
|---|---|---|
|**A** ADMISSION|TOP5는 J126 > J63인데 FILLED +42에서 사라짐|sizing 이전에 이미 소실. **sizing은 주원인이 아니다**|
|**E** EXECUTION_EXIT|FILLED +42는 유지되는데 raw 거래 수익률에서 사라짐|익일 체결 · 고정 K42 청산 · 경로 문제|
|**S** SIZING|raw는 유지되는데 R 또는 달러에서 축소·역전 **+ sizing 분포 차이 실재**|sizing 가설 강화|
|**N** NO_CLEAR_STAGE|그 외 전부 — 우위가 애초에 없거나, 모든 층에서 유지되거나, 분포 차이가 문턱 미만|특정 구성요소를 범인으로 지목하지 않는다|

PATTERN S가 성립하려면 §20의 네 조건이 **대체로 함께** 보여야 한다.

1. J126의 TOP5 우위가 FILLED까지 남아 있다
2. 실제 raw·net 퍼센트 수익률에서도 방향이 남아 있다
3. 그런데 R 또는 달러 기여에서 크게 축소되거나 역전된다
4. 동시에 정규화 ATR·notional 비중 분포에 실제 차이가 있다

**`correlation != causation`이다.** sizing 분포 차이가 있어도 raw-return 우위가 이미
sizing 이전에 사라졌다면 sizing을 주원인으로 올리지 않는다. 그래서 코드가 raw 우위 생존을
**먼저** 요구한다.

분포 차이의 문턱도 결과 전에 못박았다 — 정규화 ATR 또는 진입 notional 비중 **중앙값이
상대적으로 5% 이상** 다를 때만 "다르다"고 적는다(`DISTRIBUTION_TOLERANCE`).

## 단위가 다른 행을 하나의 척도로 읽지 않는다

decay 표의 행은 단위가 다르다 — 유니버스 대비 초과 % · raw % · notional 대비 % · R · 달러.
크기를 그대로 빼서 하나의 연속 척도처럼 해석하지 않고 **각 층에서 방향과 차이만** 본다.

예외는 STAGE 0·1·2다. 셋 다 같은 "유니버스 대비 +42 초과수익"이라 그 안에서는 뺄 수 있고,
`admission_loss`와 §22 기준 K의 "가장 큰 소실 구간"도 그 세 층 안에서만 계산한다.

## 중첩과 표본 크기

일별 TOP5는 강하게 겹치고 +42 forward 수익률은 41/42가 겹친다. **관측 수를 독립 표본 수로
읽지 않고 이 진단에서 p-value를 만들지 않는다.** data-exit는 J당 한 자릿수 표본이므로
일반적인 분포 결론으로 확장하지 않는다. §14의 상관도 Spearman 순위 상관 하나이고 formal
significance test는 하지 않는다.

## 이 PR에서 하지 않은 것

새로운 J · J189 · K 변경 · slot 변경 · candidate 폭 변경 · **sizing 변경** · stop 변경 ·
exit 변경 · regime gate · BULL-only · random seed 확장 · production policy 변경 · LLM.

무작위 대조군도 이번에는 새로 돌리지 않았다. PR #13에서 무작위 대비 상대 위치가 J63·J126
동일함을 이미 확인했고, 이번 질문은 alpha significance가 아니라 **information loss
location**이다.

**diagnostic 결과가 sizing 가설을 지지하면 그때 별도 PR로 단 하나의 sizing ablation을
사전등록한다.** 이 PR은 범인을 찾는 PR이지 고치는 PR이 아니다.

## 개발 표본이다

이 구간은 PR #9~#13에서 반복 사용됐다. 결과를 "OOS 검증"이라고 부르지 않는다.

## 실행

    python3 selftest/funnel_run.py plan
    python3 selftest/funnel_run.py universe
    python3 selftest/funnel_run.py trace jt-k42 LAST_CLOSE
    python3 selftest/funnel_run.py trace jt-j126-k42 LAST_CLOSE
    python3 selftest/funnel_run.py trace jt-k42 ZERO
    python3 selftest/funnel_run.py trace jt-j126-k42 ZERO
    python3 selftest/funnel_run.py report

## 산출물

|파일|내용|
|---|---|
|`universe-forward.json`|날짜별 자격 유니버스의 +42 평균·종목 수·stale 수. **J와 무관**|
|`j63-funnel.json` · `j126-funnel.json`|LAST_CLOSE 추적. 후보 행 전체 + 재현 지표|
|`j63-funnel-zero.json` · `j126-funnel-zero.json`|ZERO 보조 진단|
|`results.md`|생성된 보고서. 답은 여기 있다|

각 후보 행은 신호일·랭크·종목·게이트 결과 · (통과 시) 수량·ATR·손절폭·계획 위험·실효
위험 비율·구속 제약·상한 네 벌·신호 시점 자산 · (체결 시) 진입일·체결가·주식 수·수수료·
notional · (청산 시) 청산일·청산가·사유·손익·R·보유 세션 · 그리고 신호 층 forward +42다.
