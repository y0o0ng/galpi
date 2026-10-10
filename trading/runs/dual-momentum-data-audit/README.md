# Dual Momentum Phase 0 — Data Readiness Gate (결과 전 사전등록)

> 상태: **DRAFT — NOT RUN / NOT APPROVED** · 2026-10-11
>
> 폴더 하나, 질문 하나: **갈피의 현재 실제 데이터와 추가로 검증 가능한 공개 데이터만으로 12개월 GEM 스위칭의 PIT 월간 포트폴리오를 경제성 측정 전 재현할 수 있는가?**
>
> 전략 family 계약: `docs/trading/strategies/dual-momentum-roadmap.md`. 이 Phase에서는 수익률·CAGR·Sharpe·MDD를 계산하지 않는다.

## 1. 사전등록 입력

| role | 요청 시계열 | 잠정 실거래 proxy | 함정 |
|---|---|---|---|
| US equity | S&P 500 total return | SPY | 배당 재투자와 수정 시점 |
| Ex-US equity | MSCI ACWI ex-US total return | VEU | EFA는 동일 범위가 아님; VEU inception 이전 데이터 불가 |
| Defensive | US aggregate bonds total return | AGG | 채권에도 손실이 발생할 수 있음 |
| hurdle | 관측 가능한 미국 단기 국채의 12개월 누적 수익 | 사전검증된 PIT Treasury bill rate/price | 사후 공개 월간 RF값과 당시 가용값의 차이 |

- `data_sources`의 source, source_version, PIT/survivorship flags와 `bars_daily`의 실제 SPY/VEU/AGG 행을 DB에 **readonly** 질의.
- 연구 신호는 동일 월말 기준 12개월 비교. 월말 누락과 교차 휴장일을 명시 처리하지 않으면 fail-close.
- 최초 적격 월은 **모든 고정 입력이 사용 가능해진 뒤 처음으로 12개월 완전 이력이 생긴 월말**로 기계적으로 결정. 시작일을 성과에 맞춰 고르지 않는다.
- 달력은 `trading/backtest/holdout.py`의 2025-08-07 미만 전체 달력으로 고정; 마지막 보유 기간의 모든 거래일과 배당도 경계 미만.
- `eodhd-15y-2026-08` 적재는 보존하고, 기존 DB의 write/DDL 변경 금지.

## 2. Preflight gate

| # | 기준 | 실패 시 |
|---|---|---|
| A | 시그널 두 주식 지수/ETF, AGG, T-bill의 source·버전·보정·타임스탬프 추적 가능 | DATA_NOT_READY |
| B | 과거 관측 중 조정 가격이 임의 사후 가격/배당 정보를 부적절하게 사용하는 오류 없음 | DATA_NOT_READY |
| C | 월말 신호와 익월 최초 세션 실제 체결에 필요한 가격 결측 0 | DATA_NOT_READY |
| D | 12개월 warmup 이후 120개 이상의 연속된 완전한 월간 신호와 보유 결과 | DATA_NOT_READY |
| E | 이전 trading 홀드아웃의 경계 밖 정보가 신호, 거래, 결과에 0개 | DATA_NOT_READY |
| F | ETF/지수 proxy 불일치와 inception-date 처리 명시; 다른 자산으로 임의 fallback 0 | DATA_NOT_READY |
| G | T-bill의 시점 가용성과 월간 총수익 누적 방식 검증 | DATA_NOT_READY |

전부 PASS일 때 `DATA_READY`. 다른 모든 경우 `DATA_NOT_READY`; 지수/ETF input selection이 다르게 필요하면 사용자 검토용 별도 정책 변경부터.

## 3. 측정하되 성과 계산은 금지

- 첫/마지막 가능 관측일, 상품별 거래일 수, 완전 월말 수, 12개월 lookback 가능 월 수.
- 필요한 월말·다음 시가 누락 수, 중복 월말 수, source 불일치, 배당/분할 조정 방식, T-bill 시계열 발표 지연.
- 오래된 데이터 복원에 필요한 API 호출/예상 비용, 로컬에 이미 있는 데이터와 신규로 필요한 데이터의 구분.
- 결과 JSON에는 `research_family: dual-momentum`, `phase: 0`, `economic_results_computed: false`, `HOLDOUT_START: 2025-08-07`, `HOLDOUT_CONSUMED: false`, input/source hashes, gates A-G를 기록.

## 4. 다음 행동

`DATA_READY`라도 자동으로 Phase 1을 돌리지 않는다. 사용자에게 데이터 범위와 입력 series 계약, 변동 없는 신호 구현 및 사전등록 경제성 게이트 승인을 요청한다.

`DATA_NOT_READY`라면 품질 우위/수익 부재라고 쓰지 않는다. 데이터 준비 문제를 기록하고 중단한다.

### 실행 여부
- [x] 사전등록 문서 작성
- [ ] 사용자 승인
- [ ] read-only 환경 조사
- [ ] 월간 가용성·PIT audit 구현 및 자체 테스트
- [ ] Phase 0 Gate A-G 판정

**본 PR은 문서만 추가한다. 데이터베이스 변경, 수익률 실행, PAPER/LIVE 연결은 없다.**
