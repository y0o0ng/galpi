# Dual Momentum Switching — 독립 전략 family 연구 계약 (초안)

> 상태: **DRAFT / NOT APPROVED / NO BACKTEST EXECUTED** (2026-10-11). 이 문서와 데이터 사전등록은 결과를 보기 전에 사용자 검토를 받는다. 승인·데이터 게이트 이전에는 수익률을 계산하거나 PAPER/LIVE에 연결하지 않는다.
>
> 기존 `momentum-v2`는 **CLOSED/FROZEN** 상태 그대로다. 이 연구는 개별 주식의 RS(126,5) TOP5를 다시 튜닝하지 않고 **자산군 간 월간 스위칭**을 처음부터 정의한다. `quality-value`의 `DATA_NOT_READY` 기록도 변경하지 않는다.

## 0. 연구 질문과 실패 가능성

> 매월 하나의 주식시장 또는 종합채권에 100% 배분하는 12개월 듀얼 모멘텀 전략이, 기존에 관측된 공개 시장 데이터로 구성한 정적 60/40 포트폴리오보다 **실행 비용 후** 높은 복리 성과와 나쁘지 않은 낙폭/위험조정 성과를 제공하는가?

유명 전략이라는 사실은 수익성 증명이 아니다. 2014년 책 출간 이후 구간의 약화, 시그널 교차로 인한 잦은 스위칭, 주식 급락 후 뒤늦은 방어, 채권 하락이 가능한 실패 메커니즘이다. 연구 결과가 나쁘면 6/9/10개월 탐색, 여러 채권 대체재, 대체 SMA, 임계값 최적화로 구제하지 않는다.

## 1. 출처와 규칙 동일성

- Gary Antonacci, *Dual Momentum Investing* 제8장의 GEM 설명: 미국(S&P 500)과 미국 제외 글로벌 주식(MSCI ACWI ex-US)의 **지난 12개월 총수익률을 비교해 승자를 고르고**, 그 승자가 같은 기간 미국 T-bills보다 높을 때만 승자를 보유; 아니면 미국 종합채권. 매월 재판정.
- 2012/2017 Antonacci 논문 및 본인 사이트는 듀얼 모멘텀의 학술적 배경을 제공하지만, 수익률 숫자는 실거래 수익이 아닌 백테스트다.
- 주의: 2026년의 일부 재현에서는 **미국 주식만** T-bills와 비교한다. 이는 여기서 고정한 *winner-versus-T-bills*와 다른 알고리즘이다. 다른 방식을 몰래 원형으로 취급하지 않고 이번 primary 실험에는 넣지 않는다.
- ETF proxy는 지수 자체가 아니며 VEU/VXUS를 EFA와 혼용하지 않는다. EFA는 MSCI EAFE(캐나다·신흥국 제외)라 원형 ACWI ex-US와 다르다.

출처:
- https://www.optimalmomentum.com/global-equities-momentum/
- https://www.optimalmomentum.com/faq/
- https://www.optimalmomentum.com/dual-relative-absolute-momentum/
- https://doi.org/10.2139/SSRN.2042750
- https://github.com/Petitmarius/Backtest_Strategies (검증 보조 자료; 독립적인 OOS가 아님)

## 2. 첫 번째 평가 정책 — `GEM_W12_TBILL_WINNER_v0` (검토 전 잠정 동결)

| 항목 | 사전 고정 규칙 |
|---|---|
| 신호 결정 | 미국 거래 달력의 **각 월 마지막 거래일 종가를 관측한 뒤** 한 번 |
| 주식 후보 | 미국 S&P 500 총수익 지수 / 미국 제외 ACWI 총수익 지수; 실제 실행 가능성은 SPY / VEU ETF proxy로 별도 표기 |
| 안전자산 | 미국 종합채권 지수; 거래 proxy AGG |
| 절대 비교 | 같은 12개월 동안의 미 국채 단기무위험자산(T-bills) **누적 총수익** |
| lookback | 직전 월말 대비 12개월 전 월말의 총수익; **skip-month 없음** |
| winner | 미국/미국 제외 중 12개월 수익률이 큰 쪽; 동률은 미국 |
| switch | winner_return > tbill_12m_return 이면 winner에 100%; 그 외 AGG 100% |
| 주문 시점 | t월 말 신호를 t+1월 **첫 미국 거래일 시가 이후**에 집행; 신호일 종가 체결 금지 |
| 거래 | 주식 롱온리, 무차입, 동시 한 자산, 월중 재판정/임의 청산 없음 |
| 결측 | 필요한 시점 가격, T-bill 시점 정보 또는 다음 개장 체결 기준가 결측이면 **fail-close**. 다른 proxy 자동 대체나 forward-fill로 통과 금지 |
| 모드 | 리서치 전용, 읽기 전용 데이터, 주문 API 미사용 |

이 표의 '지수 신호·ETF 실행' 결합이 동일한 전략을 의미하는지는 **Phase 0에서 가용 시계열과 타임스탬프를 확인**한다. 지수 total-return 데이터가 없다면 ETF-total-return 신호 버전을 이름으로 분리하고, 규칙 변경 승인 전에 수행하지 않는다. 뒤늦게 더 잘 나온 입력을 선택하지 않는다.

## 3. 연구 단계와 중단 계약

### Phase 0 — `dual-momentum-data-audit` (지금 착수할 유일한 단계)

목적: 사용 가능한 실제 데이터로 가격·배당·T-bill·체결·시간 정합성을 검증한다. 성공 전에는 포트폴리오 수익률, Sharpe, 최적 파라미터를 계산하지 않는다.

정본: `trading/runs/dual-momentum-data-audit/README.md`.

- 요구 자산: 미국 주식, 미국 제외 ACWI, 미국 종합채권, T-bill/단기 무위험 수익률.
- `bars_daily`의 현존 유효 행과 source_version을 확인하되, 기존 `eodhd-15y-2026-08`의 `bars_daily`는 삭제·덮어쓰기 금지.
- 조정 종가가 배당 재투자 총수익을 올바르게 대리하는지 검증하고, ETF inception 이전의 수익을 해당 ETF에서 합성하지 않는다.
- T-bill **그 월 신호 시점에 알 수 있었던 값**만 사용한다. 사후 발표된 월간 RF 시계열을 신호에 사후 주입하지 않는다. 검증용 RF 시계열과 실거래 가능한 시점 데이터는 분리한다.
- 12개월 warmup 뒤 연속된 완전 월간 신호/체결/수익 관측이 **최소 120개월**, 각 월말·다음 첫 거래일에 필수 데이터 결측 0개여야 `DATA_READY`. 그렇지 않으면 `DATA_NOT_READY`.
- 연구 표본은 기존 `HOLDOUT_START = 2025-08-07` **전에서 자른 전체 달력**에 한정. 최종 월간 보유 수익률도 그 경계 밖을 읽지 않는다. 2025-08-07 이후는 **이미 오염된 역사적 구간**이며 새 OOS로 취급하지 않는다.
- 자료원, 조정 방식, ETF/지수 불일치, 현금흐름, 배당, 시차, 비용, source hash, 가능한 시작/종료일을 receipt로 남긴다.
- 데이터가 모자라면 `DATA_NOT_READY`로 **전략 수익성 미판정** 후 중단; 결과에 따라 시작일이나 proxy를 바꾸지 않는다.

### Phase 1 — 단 한 번의 사전등록 GEM portfolio translation (Phase 0 승인 후)

- 고정된 `GEM_W12_TBILL_WINNER_v0` 하나만 실행. 기존 `momentum-v2`의 `jt_*` 코어를 수정하지 않는다.
- 동일 데이터·동일 거래 시점·동일 비용으로 비교: (a) SPY 100% buy/hold, (b) SPY/AGG 60/40 월말 리밸런싱, (c) SPY/VEU/AGG 동등 비교를 위한 정적 자산배분 대조군(비율은 실행 전 승인), (d) GEM.
- 1차 지표: 비용 후 GEM CAGR − 비용 후 60/40 CAGR. 필수 공동 보고: Sharpe, Sortino, MDD, 월별 초과수익, 회전율, 거래 횟수, 총 거래비용, 자산별 체류시간, 연도별 기여, 신호 지연.
- 판정 후보(Phase 1 실행 전 승인 필요): `ECONOMIC_AND_RISK_PASS` = CAGR gap > 0 **AND** Sharpe >= 60/40 **AND** MDD 악화 없음; `RISK_ONLY` = CAGR gap <= 0 이나 MDD 개선; 나머지 `REJECT`. 실제 값에 맞춰 기준을 나중에 고치지 않는다.
- 기본 원시 거래비용 가정 **매수/매도 각각 거래대금의 10bp**; 0bp, 25bp/side를 **사전등록 민감도**로 보고, 계좌에서의 실제 브로커 수수료/스프레드와 차이는 기록. ETF expense ratio가 total-return 가격에 이미 반영됐으면 중복 차감 금지.
- 거래 시가 체결과 전일 종가 신호를 혼합한 낙관적 look-ahead를 금지한다. 수수료·배당·자금 잔액과 체결 불가를 감사한다.
- 2015년 이후(post-publication) 결과는 별도로 보고하되 **우리의 새 미사용 OOS라고 부르지 않는다**. 정식 OOS는 전략과 엔진을 freeze한 뒤 새로 쌓이는 미래 관측으로만 주장한다.
- 전체 지표가 좋지 않으면 가족을 종료. 2차 파라미터 수색/새 alpha 필터로 자동 진행하지 않는다.

### Phase 2 — 실행 현실성 / Shadow (Phase 1 통과 후 별도 승인)

- 초기 계좌 가정 500만 원, 정수 주식 제약, 원화 환산·환전 스프레드·세금은 USD alpha와 별도로 재구성.
- 소액 계좌에서 100% 스위칭의 체결·현금 예치·세금·거래소/브로커 제약을 확인한다.
- **LIVE 경로 금지**. 기존 `PAPER` 서비스와 비밀키를 공유하지 않고 별도 명시적 승인 없이 연결 금지.

## 4. 기존 인프라와의 경계

현재 `trading/backtest/data.py` / `schema.sql`에는 일봉 `bars_daily`의 원시 OHLC 및 조정 OHLC 저장 기능이 있다. 이 자체가 GEM용 모든 시계열을 확보했다는 뜻은 아니다. 기존 `benchmark.py`의 노출 일치 SPY 대비 primary는 **저노출 개별주식 전략에 맞춘 지표**라 100% 주식/채권 스위칭의 유일한 합격선으로 그대로 재사용하면 안 된다. 이 가족에서는 정적 멀티자산 대조군과 리스크 메트릭을 별도로 평가한다.

변경 금지: `paper-core-v1`, `momentum-v2` 종료·실험 기록, `quality-value` 종료·실험 기록, 홀드아웃 날짜, `bars_daily` 데이터, 운영 서비스 / 비밀키 / 주문 루프.

## 5. 승인 전 확인 사항

1. 고정 primary 규칙: **승자 vs T-bills** (책 설명 기준). 다른 GEM 구현과 혼동하지 않는다.
2. 지수 총수익과 ETF 총수익 중 어떤 입력이 실제로 확보되는지 Phase 0에서 객관적으로 확인한다.
3. Phase 1의 primary/리스크 합격선과 거래비용 가정을 사용자 검토한 뒤에만 고정한다.

**이 문서 추가 자체는 어떤 매매 성과도 증명하지 않는다.**
