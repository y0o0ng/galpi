# Quality + Value — 전략 구축 로드맵

> **이 문서는 작업 명세가 아니라 연구 계약이다.** 무엇을 측정할지, 어떤 데이터만 쓸지,
> 무엇을 합격으로 볼지, 언제 멈출지를 **수익률을 보기 전에** 고정한다. 각 Phase는 독립 PR,
> 사전등록, 사용자 검토 후 승인으로만 진행한다. 결과를 본 뒤 threshold·factor·보유기간을
> 늘려서 전략을 구제하지 않는다.
>
> 상태: **Phase 0 승인·사전등록 완료 (2026-08-22) — 미실행.** 사전등록은 `trading/runs/qv-data-audit/README.md`다. Phase 1 이후는 아직 승인 전이다.  
> 작성일: 2026-08-18 · 최종 검토: 2026-08-22  
> 작성 시점 `main` 확인 기준: `a58961bd38a4d7e250f6f519be9bd8f65ff82cef`

이 로드맵은 `../momentum-v2-roadmap.md`의 후속 수정판이 아니다. `momentum-v2`는
CLOSED/FROZEN 상태로 유지하고, 이 문서는 **별도 전략 family인 `quality-value`**의 연구
계약만 정의한다.

---

## 0. 출발점 — 이번에는 무엇을 검증하는가

이번 질문은 단순하다.

> **공개 시점이 보존된 재무정보만 사용해, 싸고 수익성이 좋은 미국 대형주 집단을 장기간
> 보유하면 S&P 500보다 비용 후 수익·위험 특성이 좋아지는가?**

이번 연구의 경제적 가설은 두 축뿐이다.

```text
Quality      = Gross Profit / Total Assets
Value        = Book Equity / Market Equity
Combined QV  = 0.5 × percentile(Quality) + 0.5 × percentile(Value)
```

새로운 기술적 지표, 가격 모멘텀, 시장 타이밍, 머신러닝은 넣지 않는다.

### 0.1 비용 벽과 경제적 메커니즘 — 이게 왜 돈이 되어야 하는가

**working hypothesis는 정보 독점이 아니라 가격이 천천히 잘못 붙는 이유와 낮은 구현비용의 결합이다.**
Value 쪽은 투자자가 최근 성장·좋은 서사를 과도하게 외삽해 비싼 glamour를 선호하고 보기 싫거나
지루한 회사를 싸게 두는 behavioral-mispricing 가설을 둔다. Quality 쪽은 수익성 높은 기업이 실제로 더
비싸게 거래되더라도 그 가격 프리미엄이 business quality를 전부 반영하지 못할 수 있다는 가설을 둔다.
둘을 결합하는 이유는 단순히 "싼 회사"가 아니라 **싸면서 현재 영업경제가 망가지지 않은 회사**를 사기
위해서다. 다만 risk-based explanation도 열려 있고 이 메커니즘 자체는 아직 증거가 아니라 검증 대상이다.
더 중요한 실전 가설은 **momentum-v2가 부딪힌 비용 벽을 다른 방식으로 넘는가**다. 그 lineage에서는
K42 기준 비용이 약 `$11,965`였고, 최종적으로 selection이 더한 경제적 값은 비용·배분을 넘길 만큼 크지
않았다. 이번 QV는 세 escape route 중 **(1) 훨씬 적게 거래한다**와 **(2) 한 번의 annual rebalance가
가져가는 gross edge가 비용보다 충분히 크다**만 선택한다. **(3) 남들이 못 보는 데이터**는 선택하지
않는다 — SEC 공개정보와 대형 유동성 종목을 쓰기 때문이다. 따라서 Phase 2는 gross active return,
BASE 비용 총액·bps, turnover, after-cost active return, `implementation_drag = gross - net`을 반드시 같이
보고한다. after-cost exposure-matched SPY gap이 양수가 아니면 "factor는 유명하지만 비용 벽은 못 넘었다"로
판정하고 종료한다.

### 0.2 Evidence / Interpretation / Hypothesis를 분리한다

**Evidence — 선행연구가 실제로 말하는 것**

- Novy-Marx는 gross profits-to-assets가 평균수익의 횡단면을 예측하는 힘이 book-to-market과
  비슷하며, profitability가 value 전략을 보완한다고 보고했다.
- Fama/French 연구 포트폴리오에는 book-to-market과 operating profitability를 이용한 factor가
  장기간 공개되어 있다. 이는 value·profitability가 표준적인 자산가격 연구 축이라는 근거이지,
  우리의 구현이 자동으로 돈을 번다는 증거는 아니다.
- Novy-Marx·Velikov는 거래비용을 포함하면 anomaly 수익성이 감소하며, 낮은 turnover와
  buy/hold spread가 비용 내성에 중요하다고 보고했다.
- McLean·Pontiff는 97개 예측변수의 portfolio return이 표본 밖과 논문 발표 후 약해졌다고
  보고했다. 유명한 anomaly를 그대로 구현하는 것만으로는 충분하지 않다.
- Ball·Gerakos·Linnainmaa·Nikolaev는 gross profitability의 해석에 반론을 제기하고
  operating profitability가 더 강할 수 있다고 보고했다.

**Interpretation — 이 로드맵이 그 근거를 어떻게 읽는가**

- Quality와 Value는 **검증할 가치가 높은 오래된 후보**이지, 보장된 alpha가 아니다.
- 우리가 찾는 것은 논문의 수익률 재현이 아니라 **현재 갈피 데이터·비용·브로커 조건에서도
  실제 보유 가능한 포트폴리오의 경제성**이다.
- gross profitability에 반대 근거가 있으므로 `GP/A`를 진리로 취급하지 않는다. 다만 첫
  연구에서 profitability 정의를 여러 개 열면 결과를 보고 골라잡게 되므로 이번 lineage에서는
  `GP/A` 하나만 동결한다.

**Hypothesis — 아직 확인되지 않은 것**

- PIT S&P 500 ex-financials에서 높은 `GP/A`와 높은 `B/M`을 함께 가진 종목은 이후 수익률이
  더 높다.
- 두 신호를 50:50 percentile로 합친 단순한 score가 비용 후에도 S&P 500을 이길 수 있다.
- 이 수익원은 frozen momentum 연구와 충분히 다른 return path를 가질 수 있다.

이 세 문장을 섞지 않는다.

### 0.3 사전 의심 — 결과 보기 전에 적어두는 실패 가설

이 lineage가 실패할 가능성도 꽤 있다고 본다. 그 의심을 결과 뒤 해설로 소급하지 않기 위해 지금 고정한다.

- S&P 500 대형주는 정보 반영이 빠르고 경쟁이 세서, 고전적인 value/profitability premium이 너무 작아졌을 수 있다.
- `GP/A`가 operating profitability보다 약하다는 반대 연구가 맞다면 Quality 축이 충분한 독립 정보를 못 줄 수 있다.
- Book Equity는 무형자산 비중이 큰 현대 기업을 제대로 측정하지 못해 `B/M`이 구조적으로 둔해졌을 수 있다.
- 50:50 결합이 두 약한 신호를 보완하는 대신 한쪽의 효과를 다른 쪽이 희석할 수 있다.
- annual rebalance는 비용을 줄여도 **gross edge 자체가 너무 작으면** momentum-v2와 똑같이 net alpha가 0 근처로 수렴한다.
- long-only top quintile의 성과가 진짜 QV selection이 아니라 equal-weight·sector·size exposure로 설명될 수 있다.
- 공개 SEC 데이터만 쓰므로 정보 우위는 없다. 살아남는다면 저회전과 지속적인 behavioral/risk premium 덕분이어야 한다.

이 목록은 나중에 실패를 "설명한 척"하기 위한 면피가 아니다. 실제 결과가 이 실패 모양과 맞는지
사후 attribution에 사용할 **사전 기록된 반증 후보**다.

---

## 1. 가정 · 더 단순한 대안 · 트레이드오프

### 1.1 가정

1. **시장:** 첫 연구 시장은 미국 주식이다.
2. **유니버스:** 기존 갈피가 이미 point-in-time membership을 가진 S&P 500을 쓴다.
3. **보유기간:** 스윙이라는 제약은 없다. 이번 전략은 저회전 factor 전략으로 설계한다.
4. **방향:** 이번 전략은 long-only다. 공매도가 금지라서가 아니라 이 hypothesis에 short가 필요하지
   않기 때문이다.
5. **통화:** 연구 alpha는 USD 기준으로 판정한다. 실제 한국 투자자의 KRW 수익은 Reality
   단계에서 별도로 보고한다.
6. **formal OOS:** 기존 `HOLDOUT_START = 2025-08-07`은 이미 오염된 historical 구간으로 취급한다.
   이 전략은 새 historical holdout을 만들지 않고, 최종 freeze 뒤 PAPER/shadow로 처음 실행되는 미래
   formation부터만 진짜 forward OOS라고 부른다.

### 1.2 왜 미국 S&P 500부터인가

이 선택은 "미국이 제일 잘 오른다"는 전망이 아니다. 현재 갈피에는 이미:

- `bars_daily` raw/adjusted 가격,
- `universe_membership` point-in-time 구성원,
- delisting 처리,
- 비용·체결 backtest 계층,
- SEC EDGAR CIK/실적일/SIC 수집 경로

가 있다. 새 전략을 위해 가장 적게 바꿔도 되는 시장이 미국 대형주다.

### 1.3 더 단순한 대안

**대안 A — Quality/Value ETF를 그냥 산다.**

가장 단순한 실제 투자 대안이다. 하지만 이것으로는 갈피가 어떤 종목을 왜 선택했는지,
selection edge가 있는지, 데이터 누수가 있는지를 검증할 수 없다. ETF는 최종 benchmark나
실행 대안이 될 수 있지만 research substitute로 쓰지 않는다.

**대안 B — Quality만 또는 Value만 한다.**

더 단순하다. 그래서 둘 다 **control**로 반드시 같이 계산한다. 그러나 primary hypothesis는
처음부터 50:50 결합으로 고정한다. 결과를 보고 더 잘 나온 한쪽으로 이름만 바꾸지 않는다.

**대안 C — operating profitability를 쓴다.**

후속 연구에서 더 강하다는 근거가 있다. 하지만 이번 lineage에서 GP/A와 OP를 동시에 열면 profitability
정의 자체가 tuning knob가 된다. `operating profitability`는 parking lot에 두고 이번 lineage 결과와
관계없이 별도 lineage에서만 열 수 있다.

### 1.4 트레이드오프

- 장점: turnover가 낮고, 큰 유동성 종목을 넓게 보유하므로 체결모델 민감도가 HFT·reversal보다
  작을 가능성이 높다.
- 단점: 재무정보 PIT 복원이 어렵고, annual factor라 학습 속도가 느리다.
- 단점: 50~100개 이상을 보유할 수 있어 소액 계좌는 1주 단위 주문 때문에 구현이 어려울 수 있다.
- 단점: book value는 무형자산 중심 기업을 싸지 않다고 판단할 수 있다. 이번 lineage에서는 이를 보정하지
  않는다. intangible-adjusted value는 별도 연구다.

### 1.5 홀드아웃 계약 — 기존 경계를 새 OOS처럼 재사용하지 않는다

현재 전역 코드 불변식은 그대로다.

```text
HOLDOUT_START = 2025-08-07
```

`trading/backtest/holdout.py`가 이 경계를 코드로 고정하고 있고, 프로젝트 기록상 이 구간은 이미
**두 번 소모됐다.** 따라서 `2025-08-07` 이후 historical data는 `CONTAMINATED_FOR_FORMAL_OOS`이며,
QV가 이 구간을 통과해도 **"out-of-sample 검증 통과"라고 쓰지 않는다.** 이 전략 때문에 전역
`HOLDOUT_START`를 뒤로 옮기거나 리셋하지도 않는다. frozen momentum lineage의 역사적 계약은 그대로 둔다.

이번 QV는 두 선택지 중 **"새 historical holdout 없이 개발하고, 진짜 표본 밖은 PAPER/shadow로 대체"**를
선택한다. 따라서 모든 historical 결과는 `Historical Development` 또는 `Historical Post-Publication
Robustness`다. 2025-08-07 이후 데이터를 historical development에 포함할 수는 있지만 run-card에
`CONTAMINATED_FOR_FORMAL_OOS`를 명시하며, 기존 holdout을 다시 소비한 것을 검증 근거로 세지 않는다.

진짜 forward OOS의 경계는 날짜를 과거에 새로 긋지 않고 **strategy freeze commit**으로 만든다.

```text
forward_contract_start = freeze commit timestamp
first_performance_oos_cohort = freeze 이후 처음 도착하는 정규 June formation
```

annual 전략이므로 freeze와 첫 June formation 사이의 새 filing/price는 ingestion·PIT·execution sanity만
검증한다. **수익률 OOS cohort는 freeze 이후 실제로 처음 형성된 포트폴리오부터**다. 이 주장을 하려면
`Swing Trading Agent Design` 20.1의 PAPER/shadow 실행 인프라가 선행 조건이다. PAPER 경로가 준비되지
않았으면 historical qualification까지만 말하고 OOS claim이나 실자금 승격을 열지 않는다.

---

## 2. 기존 갈피와 연결되는 부분 — 새로 만들 것보다 먼저 재사용한다

작성 시점 repo를 확인하면 `trading/backtest/schema.sql`에는 이미 가격·PIT membership·실적일·
증권 분류·run/trade/equity·holdout 관련 표가 있지만 **PIT 재무제표 fact 원장**은 없다.
`trading/backtest/edgar.py`는 SEC 제출 이력, 8-K Item 2.02, SIC와 CIK mapping을 이미 다루고
있다. `trading/backtest/store.py`는 research DB를 PAPER/LIVE DB와 분리한다.

따라서 이번에 필요한 최소 연결은 이것이다.

```text
기존 PIT S&P500 membership
          +
기존 adjusted/raw price
          +
새 PIT annual fundamentals ledger
          ↓
Quality / Value formation snapshot
          ↓
기존 backtest execution / cost / delisting infrastructure
```

### 2.1 바꾸지 않는 것

- `momentum-v2` strategy·run artifact·결과는 수정하지 않는다.
- 기존 `features_daily`에 QV를 억지로 추가하지 않는다. momentum feature hash와 새 fundamental
  lineage를 결합하지 않는다.
- PAPER/LIVE DB에 research fundamentals를 먼저 넣지 않는다.
- 기존 가격·membership source version을 덮어쓰지 않는다.

### 2.2 필요한 새 데이터 층의 최소 불변식

정확한 DDL은 Phase 0 probe 후 결정하되 최소한 다음 provenance를 잃으면 안 된다.

```text
symbol / entity identity
fiscal period end
filed_at
acceptance_datetime
accession / filing identity
form
concept / semantic field
value + unit
source + source_version
```

파생 factor를 저장하더라도 **어떤 filing이 그 숫자를 만들었는지 역추적 가능**해야 한다.

### 2.3 장기 보유의 기업행동·총수익 회계는 기존 momentum loop를 그대로 재사용하지 않는다

최종 검토에서 현재 `main`의 보유·평가 경로를 다시 확인했다. 기존 momentum 백테스터는
`raw_close`로 보유 포지션을 평가하고 `cash + raw market value`로 equity를 만든다. 동시에
`positions.adjust_for_corporate_action()`은 `raw_close / adjusted_close` 배율 변화가 일정 문턱을
넘으면 포지션 수량과 진입가격을 조정한다. 현재 EODHD `adjusted_close`는 **split과 dividend를
둘 다 반영**하므로, 1년 보유 QV에서 이 경로를 그대로 쓰면 배당락과 분할을 같은 종류의
기업행동으로 읽을 수 있다. 실제 기존 테스트도 배당 adjustment를 `CORPORATE_ACTION`으로
인식하는 동작을 잠그고 있다.

이 동작은 짧은 momentum 연구의 보수적 진입 취소 규칙과는 양립할 수 있지만, **배당을 받으며
1년 보유하는 factor portfolio의 total return 원장으로는 충분하지 않다.** 따라서 Phase 2를 열기
전에 다음 회계 불변식을 별도로 사전등록한다.

```text
split       -> share quantity / price unit만 조정, wealth 자체는 바꾸지 않음
dividend    -> ex-date/지급 규칙에 따른 cash 또는 receivable 증가, share quantity는 바꾸지 않음
raw marking -> explicit dividend cash와 함께 사용
adjusted TR -> signal-return 계산에서만 사용 가능하며 explicit dividend cash와 중복 사용 금지
```

- QV, eligible-EW, random control은 **같은 split/dividend/delisting 회계**를 써야 한다.
- SPY 비교도 배당을 포함한 total-return reference여야 한다.
- 배당을 현금으로 더하면서 dividend-adjusted price로 다시 평가하는 이중계산은 금지한다.
- 기존 momentum 엔진을 고쳐야 한다면 그 PR은 기존 momentum 결과가 bit/metric 수준에서 변하지 않는
  regression을 먼저 요구한다. 더 단순하면 QV 전용의 좁은 total-return/accounting layer를 둔다.
- 어느 구현을 택할지는 Phase 2 설계에서 결정하되, **수익률 결과를 보고 선택하지 않는다.**

Phase 1의 signal study는 체결 원장이 아니라 ranking 정보량을 보는 단계이므로 EODHD의
`adjusted_close` 기반 12개월 total return을 사용할 수 있다. Phase 2의 실제 보유 포트폴리오는
raw execution price와 명시적인 split/dividend cash semantics를 사용한다.

### 2.4 외부 오픈소스 레포 참고 원칙

이번 lineage는 아래 레포를 **전략 아이디어의 증거가 아니라 연구·검증·실행 설계의 참고 구현**으로만
본다. 외부 레포의 alpha, optimizer, agent가 성과를 냈다는 이유로 `quality-value`의 factor 정의나
hard gate를 바꾸지 않는다.

|레포|참고할 층|이번 lineage에서 가져올 것|이번 lineage에서 가져오지 않을 것|
|---|---|---|---|
|`HKUDS/Vibe-Trading`|연구 provenance·재현성·look-ahead 방지|stable hypothesis identity, run-card의 config/code/data/artifact hash 개념, 미래 입력을 오염시켜 과거 factor 불변성을 검사하는 sentinel test|Alpha Zoo 대량 탐색, autopilot이 새 factor를 추가하는 구조, 결과 후 hypothesis 확장|
|`skfolio/skfolio`|포트폴리오 검증·배분|향후 독립 sleeve가 여러 개 살아남은 뒤 walk-forward/CPCV·risk/portfolio tooling을 비교 기준으로 검토|Phase 1~2 primary QV에 optimizer·HRP·risk parity를 붙여 성과를 구제하는 것|
|`nautechsystems/nautilus_trader`|event-driven backtest/live execution parity|향후 intraday·futures·market-making처럼 체결 semantics가 전략 자체가 되는 lineage에서 엔진 benchmark로 검토|annual QV 때문에 현재 갈피 백테스터를 교체하거나 나노초 execution stack을 선행 구축하는 것|
|`shiyu-coder/Kronos`|금융 시계열 foundation model 연구|별도 ML lineage에서 가격계열 예측력이 clean forward sample에 남는지 검토할 후보로만 기록|QV score에 Kronos prediction을 feature로 섞기, pretrained model의 historical prediction을 QV 근거로 사용|

**채택 원칙은 최소 변경이다.** 지금 즉시 QV 계약에 들어오는 것은 Vibe-Trading에서 참고한
`future-perturbation look-ahead sentinel`과 `run card` 두 패턴뿐이다. 나머지 세 레포는 해당 문제가
실제로 열릴 때까지 dependency도 코드도 추가하지 않는다.

---

## 3. 데이터 계약 — 수익률보다 먼저 통과해야 한다

### 3.1 기본 소스

**재무제표:** SEC EDGAR XBRL `companyfacts` / submissions.

SEC는 `data.sec.gov`의 submissions와 XBRL API를 공개하고 있고, 10-Q·10-K·8-K 등의 XBRL
데이터를 JSON으로 제공한다. `companyfacts`의 fact는 accession으로 filing identity를 잡고,
`submissions` 계층의 `acceptanceDateTime`과 결합해 historical availability boundary를 복원한다.
`filed` 날짜만으로 공개 가능 시점을 결정하지 않는다.

**가격:** 현재 갈피의 등록된 EODHD daily source를 그대로 사용한다.

**과거 point-in-time common shares / market equity:** Phase 0에서 source를 확정한다.

우선순위는:

1. SEC filing facts와 filing 원문에서 **해당 시점의 실제 common shares outstanding**을
   issuer/share-class 단위로 신뢰성 있게 복원할 수 있는지 확인한다.
2. 부족하면 당시 시점의 common shares 또는 market capitalization을 직접 제공하고 그 의미·시점·
   share-class 범위를 검증할 수 있는 별도 licensed source를 사용한다.
3. 둘 다 coverage gate를 못 넘으면 `DATA_NOT_READY`다.

**EODHD Fundamentals의 `outstandingShares`라는 필드명만 보고 fallback으로 승인하지 않는다.**
현재 EODHD glossary는 그 history의 `shares`/`sharesMln`을 *weighted average diluted shares
outstanding*이라고 설명한다. 이는 연중 평균 EPS denominator와 같은 개념일 수 있어 **12월 말
point-in-time market equity의 common shares 수량과 동일하다고 가정할 수 없다.** 반면
`SharesStats.SharesOutstanding`은 현재 시점의 ticker-specific class 수량이라 과거 전체에 복사할
수 없다. Phase 0에서 field-level semantics와 실제 filing을 대조해 point-in-time common shares임이
확인되지 않는 한 market-equity 정본으로 사용하지 않는다.

EODHD의 별도 historical market-cap endpoint는 미국 주식에서 2021-07-09부터 주간 값만 제공하므로
긴 historical development 표본의 정본이 될 수 없다. **유효한 point-in-time share/ME source를
확보하지 못하면 근사치로 전략 수익률을 열지 않는다.**

### 3.2 절대 불변식 — acceptance 이전 숫자와 당일 숫자를 쓰지 않는다

`filed_at` 날짜만으로 공개 가능 시점을 판정하지 않는다. SEC filing의 시간 경계는
`acceptance_datetime`을 정본으로 삼고, historical backtest에서는 더 보수적으로 **acceptance가
끝난 뒤 첫 regular trading session부터** 그 filing을 사용할 수 있다고 정의한다.

```text
historical_usable_session(filing)
    = acceptance_datetime 이후 첫 regular trading session

usable_on(session_t)
    iff historical_usable_session(filing) <= session_t
```

따라서 장전·장중·장후 제출 여부와 관계없이 **acceptance 당일에는 새 filing을 사용하지 않는다.**
연간 factor 전략에서 하루 늦게 쓰는 비용보다 look-ahead를 차단하는 가치가 크다.

`period_end <= t`나 `filed_at <= date(t)`만으로는 부족하다. 예를 들어 2020-12-31 재무제표가
2021-02-20 장후에 acceptance되었다면 2021-02-20의 어떤 historical decision도 그 숫자를 볼 수
없고, 다음 regular trading session부터만 사용할 수 있다.

`acceptance_datetime`을 신뢰성 있게 복원하지 못하는 filing은 그 시점의 PIT factor 입력으로
사용하지 않는다. 이를 `filed_at`으로 조용히 대체하지 않는다.

### 3.3 현재 SEC API로 가능한 PIT의 한계

현재 `companyfacts`는 **오늘 조회한 현재 EDGAR 데이터베이스**다. `acceptance_datetime`과
`historical_usable_session`을 이용하면 당시 공개 이전의 filing을 차단할 수 있지만, 이후 SEC가
correction/deletion한 옛 filing의 완전한 historical vintage를 되살리는 데이터베이스는 아니다.

따라서 개발 데이터의 정확한 이름은:

```text
PIT_BY_ACCEPTANCE
```

이지 `perfect historical vintage`가 아니다.

SEC는 acceptance 후 실제 웹 공개까지 짧은 전파 지연이 있을 수 있다고 설명한다. 이번 전략은
동일 세션 사용 자체를 금지하므로 그 분 단위 지연을 별도로 모델링하지 않는다.

이 한계는 보고서마다 유지한다. 최종 freeze 이후 forward shadow는 우리가 그날 실제로 받은
fact와 ingestion timestamp를 append-only로 보존하므로 이 한계가 사라진다.

### 3.4 금융업 제외 — 현재 SIC가 아니라 formation 시점 분류를 쓴다

Primary universe는:

```text
PIT S&P500 issuer
AND historical_SIC_at_formation first digit != 6
```

이다.

현재 갈피 `securities.sic` / `edgar.py`의 SIC는 **현재 값이며 과거 재분류 이력이 아니다.**
따라서 그것을 2009년 formation에도 그대로 적용하면 미래 분류정보를 과거에 복사할 수 있다.
Phase 0에서는 선택된 annual filing의 EDGAR submission header 등 **그 filing에 붙어 있던 historical
SIC**를 우선 복원한다. SEC submission header에는 filing 시점의 `STANDARD INDUSTRIAL
CLASSIFICATION`이 포함될 수 있다.

- historical SIC를 신뢰성 있게 못 구한 issuer-year는 current SIC로 조용히 대체하지 않는다.
- 해당 observation은 financial-classification missing으로 coverage denominator에 남기고 missing으로 센다.
- current SIC는 진단/reference로만 기록할 수 있다.

금융업 제외 자체는 결과를 보고 붙이는 필터가 아니다. Novy-Marx의 주 표본이 금융업을 제외했고,
financial firm의 revenue/COGS·자산·레버리지 의미가 일반 제조·서비스업과 크게 다르기 때문이다.

**금융업 포함 결과는 robustness diagnostic일 수 있지만 primary를 대체하지 않는다.**

---

## 4. factor 정의 — 수익률을 보기 전에 완전히 고정한다

### 4.1 Formation calendar

매년 `t`년 6월의 **마지막 정규 거래일 종가 이후** formation snapshot을 만든다.
실제 포트폴리오 체결은 다음 정규 거래일부터만 가능하다.

각 formation year `t`에서 accounting data는:

```text
fiscal period end가 calendar year t-1 안에 있고
historical_usable_session(filing) <= formation session인 annual 10-K
```

만 사용한다.

Quarterly TTM, 10-Q, 8-K preliminary earnings는 이번 factor에 넣지 않는다.

**이 배제는 accounting factor 입력(Quality·Book Equity)에만 적용된다.** Market Equity
denominator의 shares는 회계 factor가 아니라 **stock-state 입력**이므로 별도 규칙(§4.4.1)을
따른다. 12월 결산이 아닌 발행사는 10-K에 12월 instant가 아예 없어서, 이 구분이 없으면
`B/M`을 만들 수 없다.

### 4.2 Gross Profitability

경제적 정의:

```text
Revenue      = consolidated total revenue
Gross Profit = consolidated total revenue - Cost of Goods Sold
GPA          = Gross Profit / Total Assets
```

- `Total Assets <= 0`은 invalid.
- Gross Profit이 음수인 것은 허용한다.
- issuer custom tag를 이름 유사도로 자동 연결하지 않는다. 표준 taxonomy와 filing 원문으로
  회계적으로 같은 항목임을 확인할 수 있는 mapping만 허용한다.

#### 4.2.1 accounting mapping — CLOSED / FROZEN

**이 절이 열어두었던 `direct GrossProfit vs Revenue − COGS` 결정은 닫혔다.** 정찰 근거는
`trading/runs/qv-data-audit/PROBE-gross-profit-mapping.md`이고, Phase 0이 지켜야
할 형태는 `trading/runs/qv-data-audit/README.md` §3.6이다. **결과를 본 뒤 아래를 되돌리지
않는다.**

```text
canonical Revenue    consolidated total revenue
canonical GP         consolidated total revenue - COGS   (항상 이 식 하나)
direct GrossProfit   canonical source 아님. diagnostic 전용
tie-out              exact equality. tolerance 없음
fact 선택            연결 손익계산서 role 안의 무차원 standard-taxonomy fact만
dimension-only COGS  MISSING. member 합산 금지
```

**Revenue는 consolidated total revenue다.** issuer-defined net sales나 COGS와 직접
대응되는 좁은 revenue를 canonical Revenue로 쓰지 않는다. 이 선택은 §0.2가 근거로 든
Novy-Marx 계열의 `REVT − COGS` 정의에 가까운 경제적 신호를 재현하기 위한 것이다. 따라서
**membership fee나 금융자회사 revenue처럼 직접 대응 COGS가 없는 수익이 분자에 포함될 수
있다는 사실을 의도적으로 받아들인다.** 결과를 보고 net-sales 정의로 되돌리지 않는다.

**canonical 값은 언제나 `total revenue − COGS`다.** `us-gaap:GrossProfit` 직접 fact는
canonical source가 아니다. direct fact가 있는 해는 direct를, 없는 해는 reconstruction을
쓰는 식의 **정의 전환을 허용하지 않는다** — 그렇게 하면 같은 발행사가 연도에 따라 다른
정의로 계산된다.

**direct `GrossProfit`은 validation / diagnostic evidence로만 쓴다.** 같은 연결 손익계산서
context에서 비교 가능하면 `direct GrossProfit == total revenue − COGS`를 **exact equality**로
검사하고 **tolerance를 두지 않는다.** 작은 차이가 나와도 `0.1%`·`0.5%` 같은 문턱을 임의로
만들지 말고 단위·기간·부호·statement scope·중단사업·rounding provenance부터 조사한다.

**diagnostic mismatch는 canonical 값을 무효로 만들지 않는다.** total revenue와 COGS가
명확히 식별되면 canonical reconstruction이 그대로 정본이고, mismatch는 명시적인
diagnostic/audit 상태로 보존한다. 반대로 **total revenue 또는 COGS 자체의 statement 의미가
ambiguous하면** 그것은 별개의 mapping failure이므로 fail-close한다.

**fact 선택은 presentation linkbase / filing statement structure를 쓴다.**

```text
formation까지 usable한 annual 10-K family filing 선택
        ↓
그 accession의 consolidated income statement role 식별
        ↓
그 role 안의 standard-taxonomy · 무차원 total revenue / COGS fact 사용
        ↓
Gross Profit = total revenue - COGS
```

연결 손익계산서 role을 신뢰성 있게 특정할 수 없으면 **추측하지 않고** unresolved/missing으로
둔다. 주석·segment·geographic subtotal·중단사업처럼 **role 밖의 fact는 이름이 같아도
canonical 후보가 아니다.** `fy`·`fp`·`frame`이나 companyfacts의 태그 이름만으로 statement
의미를 추측하지 않는다.

**consolidated COGS가 무차원 fact로 없고 dimension member에만 있으면 `MISSING`이다.**
member를 합산해 consolidated COGS를 재구성하지 않는다. coverage를 올리려고 member
whitelist·issuer별 합산 예외·derived member 추정·사후 mapping을 추가하지 않는다. 해당
issuer-year는 denominator에서 조용히 빠지지 않고 missing reason으로 남는다(§6 데이터 gate).

`Book Equity` · preferred stock · deferred tax mapping은 **이 결정에 포함되지 않는다.**
그것들은 §4.3.1에서, GPA denominator인 `Total Assets`는 §4.2.2에서 각각 따로 닫혔다.

#### 4.2.2 Total Assets mapping — CLOSED / FROZEN

**GPA denominator의 mapping도 닫혔다.** 정찰 근거는
`trading/runs/qv-data-audit/PROBE-total-assets-mapping.md`이고, Phase 0이 지켜야 할 형태는
`trading/runs/qv-data-audit/README.md` §3.7이다. **결과를 본 뒤 아래를 되돌리지 않는다.**

```text
canonical concept   us-gaap:Assets                       (fallback hierarchy 없음)
fact 선택            연결 대차대조표 Statement role 안의 무차원 fact만
period anchor       dei:DocumentPeriodEndDate            (canonical)
cross-check         qv_sec_filings.report_date           (불일치하면 MISSING / UNRESOLVED)
validation          Assets == LiabilitiesAndStockholdersEquity, exact. tolerance 없음
                    mismatch -> fail-close
                    계산 불가 -> mismatch와 합치지 않고 별도 상태
fallback            금지 -> MISSING
dimension-only      금지 -> MISSING. member 합산 금지
Total Assets <= 0   invalid (§4.2 그대로)
```

**canonical concept은 `us-gaap:Assets` 하나다.** issuer custom Assets 태그, 이름 유사도
mapping, 임의 fallback hierarchy를 쓰지 않는다.

**fact 선택은 filing의 presentation structure를 쓴다.**

```text
formation까지 usable한 annual 10-K family filing 선택
        ↓
그 accession의 연결 대차대조표 Statement role 식별
        ↓
그 role 안의 무차원 us-gaap:Assets 만 후보
        ↓
canonical fiscal-period-end instant와 일치하는 fact 선택
```

**Statement role만으로는 충분하지 않다.** 같은 Statement role 안에 co-registrant·자회사·
guarantor·segment 값이 함께 있을 수 있으므로 **무차원 조건을 반드시 함께 강제한다.**
role을 신뢰성 있게 특정할 수 없으면 추측하지 않고 unresolved/missing으로 둔다.
Disclosure·주석·segment·guarantor·VIE·disposal처럼 **role 밖의 fact는 개념이
`us-gaap:Assets`여도 canonical 후보가 아니다.** `fy`·`fp`·`frame`으로 statement 의미를
추측하지 않는다.

**회계기간 앵커의 정본은 `dei:DocumentPeriodEndDate`다.** `qv_sec_filings.report_date`는
정본이 아니라 cross-check다.

```text
dei:DocumentPeriodEndDate == qv_sec_filings.report_date   -> 정상
불일치                                                     -> MISSING / UNRESOLVED
```

둘이 어긋날 때 **조용히 한쪽을 고르지 않는다.** `submissions.reportDate`를 단독 정본으로
쓰지 않고, accession 안에서 **가장 늦은 instant를 회계연도 말로 추정하지 않으며**,
companyfacts의 `fy`·`fp`·`frame`을 period-end source로 쓰지 않는다.

**가능한 경우 `Assets == LiabilitiesAndStockholdersEquity` exact tie-out을 필수 검증으로
쓴다. tolerance를 두지 않는다.** 세 상태를 반드시 구분한다.

```text
계산 가능 + exact      -> VALIDATED
계산 가능 + mismatch   -> fail-close (TIEOUT_MISMATCH 등 명시 상태)
계산 불가              -> TIEOUT_UNAVAILABLE / UNVERIFIED  (mismatch와 합치지 않는다)
```

**"tie-out 계산 불가"를 자동으로 mismatch라고 부르지 않는다.** 이 계약은 상태만 고정하고,
unavailable의 빈도와 최종 coverage 해석은 본구현 전수에서 본다. `0.1%`·`0.5%` 같은 문턱을
새로 만들지 않는다.

**canonical context에 `us-gaap:Assets`가 없으면 `MISSING`이다.**
`AssetsCurrent + AssetsNoncurrent`나 유동자산·유형자산·영업권 등의 component 합산을
canonical fallback으로 쓰지 않는다. 정찰 표본에서 `us-gaap:Assets` 결손이 0건이었고
component 합산은 계산 가능 구간 자체가 좁고 정확하지도 않았다. **없는 문제를 위해 새 hierarchy를
만들지 않는다.**

**무차원 consolidated `us-gaap:Assets`가 없고 dimension member에만 있으면 `MISSING`이다.**
member 합산으로 consolidated Assets를 재구성하지 않는다. member whitelist·issuer별 합산
예외·parent/subsidiary/guarantor member 조합·elimination member 계산·derived member 추정·
coverage를 올리기 위한 사후 mapping을 만들지 않는다. 해당 issuer-year는 denominator에서
조용히 빠지지 않고 missing reason으로 남는다(§6 데이터 gate).

### 4.3 Book Equity

이번 lineage의 canonical 정의:

```text
Book Equity = Parent Stockholders' Equity - Preferred Stock
```

- `Book Equity <= 0`은 Value ranking에서 제외한다.
- 결과를 본 뒤 negative BE를 다른 방식으로 살리지 않는다.

#### 4.3.1 accounting mapping — CLOSED / FROZEN

**이 절이 열어두었던 `StockholdersEquity` fallback 순서 · preferred · deferred-tax mapping
결정은 닫혔다.** 정찰 근거는 `trading/runs/qv-data-audit/PROBE-book-equity-mapping.md`이고,
Phase 0이 지켜야 할 형태는 `trading/runs/qv-data-audit/README.md` §3.8이다. **결과를 본 뒤
아래를 되돌리지 않는다.**

```text
canonical BE       Parent Stockholders' Equity - Preferred Stock
DT / ITC           이번 lineage에서 항상 0. when available 로 되돌리지 않는다
공통 context       formation까지 usable한 annual 10-K family filing (README §3.1)
                   -> 그 accession의 연결 대차대조표 role
                   -> canonical fiscal-period-end instant
                   -> 무차원 fact
period anchor      dei:DocumentPeriodEndDate (canonical)
                   qv_sec_filings.report_date (cross-check) · 불일치 -> MISSING / UNRESOLVED
Parent SE 1순위     us-gaap:StockholdersEquity                     (direct)
Parent SE 2순위     StockholdersEquityIncluding...NCI - MinorityInterest
                   두 fact가 같은 accession · role · instant · unit · 무차원일 때만
scope guard        redeemable NCI / temporary equity 증거가 있으면 2순위 fail-close
금지 fallback      Assets - Liabilities · common equity + preferred · component 합산
                   · equity roll-forward ending balance · custom reconstruction
preferred 순위      liquidation preference value -> par / carrying value
preferred ZERO     SharesIssued == 0 · SharesOutstanding == 0
                   · 연결 대차대조표 role에 PreferredStockValue 요소가 차원 포함해서도 부재
tie-out            SE(i) == Parent SE + NCI 를 raw XBRL decimals 로 판정
                   VALIDATED / ROUNDING_COMPATIBLE / TIEOUT_MISMATCH / TIEOUT_UNAVAILABLE
```

##### DT / ITC 제외는 의도적인 경제적 정의 축소다

**이 정의를 Fama/French·Novy-Marx 원형과 같다고 쓰지 않는다.** 원형에는
`+ Deferred Taxes / Investment Tax Credit when available` 항이 있고, **이번 lineage는 그 항을
제거한 축소 정의다.** 이유는 그 수량을 SEC/XBRL에서 issuer-independent한 결정론적 규칙으로
복원할 수 없기 때문이다. 정찰이 확인한 것은 이렇다.

- 표준 `us-gaap:DeferredIncomeTaxLiabilitiesNet`은 정의상 **DTA를 차감하고 관할별 netting을
  거친** 표시 금액이라 원형의 credit 잔액과 같지 않다.
- DTA 포지션 발행사에는 같은 개념이 대칭적으로 존재하지 않는다.
- Caterpillar의 custom 값은 **이연법인세자산 + 환급채권의 결합**이고, Southern Company의
  custom 값은 **규제자산·규제부채**다. 둘 다 원형 수량이 아니다.
- 대차대조표에 세금 라인이 아예 없는 발행사가 있다.
- custom 동일성 판정에 구조화된 신호가 없어 **issuer별 회계 해석으로 퇴화**한다.
- 부분 가산은 업종·공시방식에 따라 **서로 다른 BE 정의를 한 cross-section에 섞는다.**

따라서 **DT/ITC가 명확해 보이는 발행사만 골라 더하지 않고**, 표준 태그가 있을 때만 더하지도
않으며, custom whitelist를 만들지 않고, **DT 결손을 이유로 issuer-year를 MISSING으로 만들지도
않는다.** 언제나 `DT/ITC contribution = 0`이다.

##### Parent Stockholders' Equity

**1순위는 direct `us-gaap:StockholdersEquity`다.** selected accession · 연결 대차대조표 role ·
canonical fiscal-end instant · 무차원 · USD monetary이고 scope가 지배주주지분으로 명확할 때
그대로 쓴다. **equity roll-forward Statement · Disclosure · 주석 · guarantor · 자회사 ·
co-registrant · segment의 동일 concept은 후보가 아니다.**

**direct가 없을 때만 2순위를 쓴다.**

```text
Parent SE = StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest
          - MinorityInterest
```

두 fact가 **같은 accession · 같은 연결 대차대조표 role · 같은 instant · 같은 unit · 무차원**일
때만 성립한다. **`MinorityInterest`가 없다고 NCI를 0으로 추정하지 않는다** — `IncludingNCI`만
있고 `MinorityInterest`가 없으면 MISSING / UNRESOLVED다.

**scope guard**: 선택된 대차대조표 scope에 redeemable NCI / temporary equity가 있어
`IncludingNCI`의 범위가 `parent + 통상 NCI`와 다를 수 있으면 **2순위를 쓰지 않는다.**
`us-gaap:RedeemableNoncontrollingInterestEquityCarryingAmount`나 `TemporaryEquity` 계열이 그
증거다. 이때는 `PARENT_EQUITY_SCOPE_AMBIGUOUS`로 fail-close한다. **equity roll-forward의
`IncludingNCI`를 가져와 redeemable NCI까지 포함시키는 것을 금지한다.**

**쓰지 않는 fallback**: `Assets - Liabilities` · `common equity + preferred` · issuer custom
reconstruction · component 합산 · equity roll-forward ending balance · 오늘 companyfacts 값 ·
issuer별 예외. 특히 `Assets - Liabilities`는 SFAS 160 이후 **NCI를 포함한 총자본**으로
기울고, 정찰에서 NCI가 있는 관측 중 지배주주지분과 일치한 사례가 **0건**이었다.
**결과가 아쉽다고 이 fallback을 되살리지 않는다.**

##### Preferred Stock

```text
1. liquidation preference value 가 있으면 그것
2. 없으면 par / carrying value
3. 둘 다 신뢰성 있게 얻지 못했는데 우선주 존재 증거가 있으면 PREF_UNRESOLVED -> BE MISSING
```

**문헌의 redemption tier는 이번 lineage에서 쓰지 않는다.** 우선주 redemption value에 해당하는
신뢰할 표준 XBRL 개념이 없고, 상환조건을 산문에서 issuer-by-issuer로 해석해야 하기 때문이다.
**prose parsing이나 manual whitelist로 redemption tier를 복원하지 않는다.** 상위 tier가
태깅되지 않았다는 이유로 **미래 filing의 liquidation value를 과거 accession에 backfill하지
않는다.**

**`PREF_TIER_UNSTABLE`**: 같은 발행사의 인접 회계연도에서 사용 가능한 tier가
`par/carrying ↔ liquidation`으로 바뀌면 그 진단을 반드시 보존한다. **이 상태로 값을 바꾸지
않고, fail-close하지 않으며, 과거 값을 미래 tier로 재작성하지 않고, smoothing·carry-forward·
backfill을 하지 않으며, 결과를 보고 더 안정적으로 보이는 tier 하나로 통일하지 않는다.**
각 연도는 그 시점 selected filing에서 결정론적으로 얻을 수 있는 위 순서를 그대로 쓴다.

**ZERO 판정은 연결 대차대조표 role을 기준으로 한다.**

```text
PreferredStockSharesIssued == 0
PreferredStockSharesOutstanding == 0
연결 대차대조표 role 전체에 us-gaap:PreferredStockValue 요소가 차원 포함해서도 부재
```

마지막 규칙은 **"0이라는 numeric fact"가 아니라 감사받은 연결 대차대조표의 표시 완결성에
기반한 ZERO inference**다. 그 성격을 그대로 적는다.

**companyfacts에 우선주 태그가 없다는 이유만으로 ZERO라고 하지 않는다.** 정찰에서 P&G의
실제 우선주 `756,000,000`이 **종류별 차원 fact로만 존재해** 무차원 조회에서 사라지는 반례를
확인했다.

**금액 계산에 쓰는 canonical fact는 무차원이 원칙이다. 단 하나의 예외는 우선주가 존재하는지
판정할 때 같은 대차대조표 role의 차원 fact 존재 여부까지 보는 것이다.** 이것은 **차원 member
값을 합산해 금액을 만드는 것이 아니다.** dimensional preferred 값 합산 · class/member
whitelist 재구성 · elimination 계산 · issuer별 member 조합 · derived total은 전부 금지한다.
따라서 P&G처럼 요소는 차원으로 존재하는데 canonical 무차원 금액을 정할 수 없으면 **ZERO가
아니라 `PREF_UNRESOLVED`다.**

**모순되는 증거는 ZERO가 아니다.** `PreferredStockValue == 0`이면서
`PreferredStockSharesIssued > 0`이면 우선주가 실재하므로 위 순서를 적용하고, usable한 금액을
얻지 못하면 `PREF_UNRESOLVED`다.

##### NCI tie-out validation

`SE(i) == Parent SE + MinorityInterest`를 **raw XBRL instance가 선언한 `decimals`**로 판정한다.
**임의 tolerance를 쓰지 않는다.**

```text
hw(f) = 10^(-decimals(f)) / 2        decimals가 유한 정수일 때
hw(f) = 0                            decimals가 없거나 "INF"일 때

gap = |SE(i) - (Parent SE + MinorityInterest)|

gap == 0                                   VALIDATED
0 < gap <= hw(SEi) + hw(SEp) + hw(NCI)     ROUNDING_COMPATIBLE
gap  > 허용 반폭 합                          TIEOUT_MISMATCH
independent fact 중 하나라도 없음            TIEOUT_UNAVAILABLE
```

**`ROUNDING_COMPATIBLE`을 `VALIDATED`에 합치지 않는다.** 고정 `$1M`·백분율·`0.1%`·`0.5%` 같은
임의 cutoff와 issuer별 tolerance를 만들지 않고, 관측된 mismatch를 본 뒤 문턱을 조정하지 않는다.

**direct parent 경로에서 tie-out은 진단이다.** direct `us-gaap:StockholdersEquity`가
canonical인데 `SE(i)`·`MinorityInterest`도 independent fact로 있으면 위 판정을 계산하되,
`TIEOUT_MISMATCH`여도 **direct parent 값을 버리지 않는다.** direct parent가 명확히 있는데 다른
scope의 `IncludingNCI`가 어긋난다고 해서 멀쩡한 값을 지우지 않는다.

**복원 경로에서는 순환 검증을 하지 않는다.** `Parent SE = SE(i) - NCI`로 복원한 경우 같은 식을
다시 검사하는 것은 항등식이라 독립 검증이 아니다. **가짜 `VALIDATED exact` 상태를 만들지
않는다.** 이 경로의 신뢰성은 위 scope guard가 책임지고, 상태는 `TIEOUT_UNAVAILABLE` 또는
`PARENT_RECONSTRUCTED`로 명시한다. **이 `TIEOUT_UNAVAILABLE`만으로 복원을 무효화하지 않는다** —
그렇게 하면 2순위 자체가 항상 불가능해진다. 반대로 복원 입력이 모호하거나 scope guard가
실패하면 fail-close한다.

##### statement scope

**generic `Statement` role만으로 충분하지 않고 반드시 연결 대차대조표를 특정한다.**
`StockholdersEquity` · `StockholdersEquityIncluding...NCI` · `MinorityInterest`의 canonical
monetary value는 selected accession · 연결 대차대조표 role · fiscal-end instant · 무차원에서만
가져온다. **equity roll-forward도 `Statement`이므로 role 종류만 보고 허용하지 않는다.**
role을 신뢰성 있게 특정할 수 없으면 MISSING / UNRESOLVED다.

##### 최종 계산과 보존

```text
Book Equity = Parent Stockholders' Equity - Preferred Stock
Parent SE 또는 Preferred 가 unresolved -> Book Equity MISSING / UNRESOLVED
Preferred = ZERO 확정                  -> Book Equity = Parent SE
Book Equity <= 0                       -> Value ranking 제외 (기존 규칙 유지)
```

negative BE를 살리려고 DT를 다시 더하거나 preferred를 무시하거나 다른 equity fallback을 열거나
issuer별 예외를 만들지 않는다.

구현이 최소한 보존해야 할 provenance는 selected accession · form · `acceptance_datetime` ·
`historical_usable_session` · `dei:DocumentPeriodEndDate`와 `report_date` cross-check 결과 ·
statement role · parent equity의 source path(`DIRECT_PARENT_SE` / `INCLUDING_NCI_MINUS_NCI`)와
concept·value·unit·dimension·raw `decimals`·validation 상태 · preferred의 zero/present/unresolved
상태와 tier(`LIQUIDATION` / `PAR_CARRYING` / `ZERO`)·선택 concept·value·instant·dimension 상태·
`PREF_TIER_UNSTABLE` 진단 · Book Equity의 `accounting_definition_version`·component 상태·최종
값 또는 missing 사유다. **정확한 schema/DDL은 이 결정에 포함되지 않는다.**

### 4.4 Market Equity와 Book-to-Market — ranking unit은 security가 아니라 issuer다

`B/M`의 denominator는 **formation 직전 12월 마지막 거래일의 issuer market equity**를 사용한다.

```text
ME_class,dec(t-1)  = PIT common shares of class × raw close of class
ME_issuer,dec(t-1) = Σ ordinary-common share-class market equity of the issuer
B/M                = Book Equity_issuer(fiscal year t-1) / ME_issuer,dec(t-1)
```

formation 당일 가격을 denominator로 쓰지 않는다. 원 논문의 six-month lag 취지를 따라 최근 가격
움직임을 value score에 불필요하게 섞는 것을 줄인다.

회계 fact와 Book Equity는 issuer/CIK 수준인데 S&P 500 membership과 주문은 security/ticker 수준일 수
있다. 따라서 **한 issuer를 GOOG/GOOGL처럼 두 개의 독립 alpha observation으로 세지 않는다.**

- ranking/selection unit은 stable issuer identity다.
- issuer의 ordinary common share class가 여러 개면 ME는 가능한 범위에서 class별 market equity를 합산한다.
- 같은 issuer의 Book Equity를 각 class에 따로 복사해 두 번 ranking하는 것은 금지한다.
- selected issuer가 실제로 보유할 security는 **수익률을 보기 전에** 다음 결정론적 rule로 하나만 고정한다.

```text
execution-security candidates
    = formation 시점 PIT S&P500 member인 ordinary-common classes of issuer
      AND 최근 20 regular sessions의 raw price/volume가 모두 존재

execution security
    = dollar_volume_median20가 가장 큰 class
      (exact tie: stable symbol 오름차순)
```

  이 값은 미래수익 예측 feature가 아니라 같은 issuer의 어느 share class를 실제 주문할지 정하는 execution
  identity rule이다. 현재 갈피가 이미 쓰는 20-session median dollar-volume 정의를 재사용하며 새 window를
  탐색하지 않는다. 후보 class가 하나면 그대로 쓰고, 유효한 후보가 0이면 그 issuer-year는 missing이다.
  현재 KIS tradability를 과거 formation에 소급해 class를 고르지 않는다. KIS 가능 여부는 forward/Reality
  단계에서만 검사한다.
- 같은 issuer가 portfolio에서 두 자리를 차지하면 data-contract failure다.
- split/share-class/corporate action이 반영된 point-in-time common shares를 써야 한다.
- 오늘의 SharesOutstanding을 과거 전체에 복사하는 것은 금지한다.

### 4.4.1 ME shares source — 무엇을 어디서 읽는가

**정찰(`trading/runs/qv-data-audit/PROBE-me-source.md`) 결과를 계약으로 고정한다.**

**shares 정본은 raw XBRL instance다.** SEC `companyfacts` / `companyconcept` API를 shares/ME
정본으로 쓰지 않는다. 그 API가 돌려주는 fact에는 dimension이 없어 multi-class를 분해할 수
없고, 비차원 값의 의미가 발행사마다 다르다(한쪽은 전체 합계, 한쪽은 Class A만, 한쪽은 404).
**결과가 아쉽다고 이 경로를 되살리지 않는다.**

허용하는 form은 넷이다.

```text
10-K   10-K/A   10-Q   10-Q/A
```

모든 shares fact는 다음을 전부 만족해야 사용할 수 있다.

```text
raw XBRL instance에서 읽는다
formation 시점에 이미 usable한 filing에서만 읽는다
acceptance_datetime을 보존한다
historical_usable_session(filing) 이전에는 사용하지 않는다 (§3.2)
accession · form · acceptance_datetime · instant · axis/member · provenance가 역추적된다
```

12월 shares 선택 규칙은 이렇다.

```text
formation 시점까지 usable한 filing들 중,
t-1년 12월 마지막 거래일 이하인 shares instant 가운데
가장 늦은 instant를 쓴다.

tie-break (같은 instant가 여러 filing에 있을 때, 순서대로):
  1. acceptance_datetime이 가장 늦은 filing
  2. 그래도 같으면 accession 사전순 마지막
```

**tie-break를 결과를 보고 정하지 않는다.** 값이 서로 다른데 위 규칙으로 하나가 정해지지
않으면 그 issuer-year는 `MISSING`이고, 조용히 아무거나 고르지 않는다.

#### derived member를 실제 class로 등록하지 않는다

`EquivalentClassAMember`처럼 conversion-equivalent · derived · memorandum 성격의 member는
실제 share class가 아니다. Berkshire 인스턴스에는 Class A · Class B와 함께 이 member가 있고,
`StatementClassOfStockAxis`의 member를 전부 더하면 같은 지분을 두 번 센다.

```text
member를 이름 패턴으로 일괄 합산하는 구현을 금지한다.
실제 outstanding ordinary class임이 원문으로 확인된 member만
명시적 mapping/whitelist로 identity에 연결한다.
알 수 없는 member는 조용히 포함하지 않고 unresolved/missing으로 기록한다.
```

### 4.4.2 비상장 ordinary class — 버리지도, 값을 지어내지도 않는다

상장되지 않은 ordinary class를 **그냥 빼면 안 된다.** consolidated Book Equity는 그 지분을
포함하는데 ME denominator에서만 빠지면 `B/M`이 체계적으로 높아지고, 그 왜곡은 multi-class
발행사에만 걸리므로 V 랭크가 한쪽으로 기운다. 반대로 시장가격이 없다고 **임의 가격을 만들지도
않는다.**

```text
1. listed ordinary class
   ME_class = shares × 그 class의 raw close
   valuation_method = OBSERVED_MARKET_PRICE

2. unlisted ordinary class 중, 그 시점에 유효한 SEC filing·charter 등 신뢰 가능한 원문으로
   특정 listed ordinary class에 대한 고정된 직접 conversion ratio가 확인되는 경우
   ME_class = shares × conversion_ratio × reference listed class의 raw close
   valuation_method = CONVERSION_VALUE_PROXY

3. unlisted ordinary class인데 방어 가능한 fixed conversion ratio가 없는 경우
   가격을 추정하지 않는다
   그 issuer의 ME = MISSING → Value/QV ranking 불가
   단 coverage denominator에서 제거하지 않고 missing reason으로 센다
```

세 가지를 금지한다.

```text
unlisted라는 이유로 조용히 제외
비슷해 보인다는 이유로 listed class 가격을 대입
결과를 보고 conversion mapping을 추가
```

Alphabet Class B는 **실제 법적 1:1 conversion 권리가 원문으로 확인되는 경우에만** Class A의
conversion value proxy를 쓸 수 있다. **`CONVERSION_VALUE_PROXY`는 관측된 시장가격이 아니므로**
`valuation_method`와 provenance를 결과 artifact까지 끌고 간다. 두 방법을 섞어 하나의 ME로
보고하면서 어느 쪽인지 지우지 않는다.

conversion ratio는 시간에 따라 바뀔 수 있다. **현재 ratio를 과거에 소급하지 않는다.**

---

### 4.5 Cross-sectional score — rank 수학을 고정한다

Q-only, V-only, QV, bottom20, eligible-EW, random control은 **매 formation마다 동일한 joint-eligible
issuer universe**를 사용한다. Q 또는 V가 없는 issuer를 어떤 control에서만 살려 넣지 않는다.

각 factor의 exact raw value 동률에는 average rank를 주고, 높은 raw value가 높은 rank가 되게 다음으로
고정한다.

```text
N > 1:
    rank_pct(x_i) = (average_rank_ascending(x_i) - 1) / (N - 1)
N = 1:
    rank_pct = 0.5

Q_rank = rank_pct(GPA)
V_rank = rank_pct(B/M)
QV     = 0.5 * Q_rank + 0.5 * V_rank
```

raw factor 동률을 symbol로 억지로 갈라 percentile 값을 다르게 만들지 않는다. 최종 `QV`가 정확히
동률이고 selection boundary에 걸릴 때만 **stable issuer id → execution symbol** 오름차순으로
결정론적으로 끊는다. 임의 noise를 넣지 않는다.

percentile을 쓰므로 raw ratio의 극단값을 winsorize하지 않는다. S&P 500 대형주 universe에서
outlier 하나가 score 크기를 무한히 밀어 올리지 못하도록 **순위가 이미 영향도를 제한**한다.

### 4.6 Primary candidate set

```text
N = joint-eligible issuer count
k = max(1, floor(0.20 * N))
Primary = QV 상위 k issuers
```

딱 하나다. random control도 같은 formation에서 같은 `k`를 뽑는다.

Top 10%, 15%, 25%, 30%를 discovery 단계에서 비교하지 않는다. 20%는 quintile이라는 넓고
표준적인 컷이며 보통 수십~100개 안팎의 분산 포트폴리오를 의도한다.

### 4.7 규칙 표면 — 기존 `RULE_FIELDS`로는 QV를 표현할 수 없다

현재 `trading/core/definition.py`의 전역 규칙 표면은 다음 여섯 칸뿐이다.

```text
policy
entry_mode
exit_mode
regime_mode
require_earnings_calendar
require_sector
```

이 구조는 momentum `paper-core-v1`과 그 연구 코어를 위해 동결되어 있고, QV의 annual formation·fundamental
정의·issuer ranking·equal-weight rebalance를 표현하지 못한다. **QV 때문에 기존 `RULE_FIELDS`나
`paper-core-v1`을 늘리거나 바꾸지 않는다.** Phase 2가 실제로 열릴 때만 별도 QV core 파일 하나에
아래 rule surface를 명시하고 자체 signature/freeze test로 잠근다.

```text
QV_RULE_FIELDS = (
    universe_rule,
    financial_exclusion_rule,
    formation_rule,
    accounting_definition_version,
    market_equity_rule,
    score_rule,
    selection_rule,
    weight_rule,
    rebalance_rule,
    execution_security_rule,
    holding_rule,
    corporate_action_accounting_mode,
)
```

이름은 구현 시 기존 스타일에 맞춰 조정할 수 있지만 **의미상 칸을 숨기거나 runner 상수로 빼지 않는다.**
반대로 `source_version`, historical date range, cost stress, random seed는 전략 규칙이 아니라 실행·검증 조건이므로
QV core rule field에 넣지 않는다. accounting mapping은 결과를 바꾸는 의미론이라
`accounting_definition_version`으로 반드시 core signature에 포함한다.

---

## 5. 연구 예산 — 이번 lineage에서 열 수 있는 것은 여기까지다

이번 연구의 alpha 정의는 이미 완결됐다.

```text
Control Q : GPA percentile only
Control V : B/M percentile only
Primary   : 50/50 QV percentile
```

추가 alpha intervention budget은 **0**이다. 이번에는 "네 번까지 살려본다"가 아니라 처음부터
한 벌을 고정하고 한 번만 번역한다.

```text
alpha_intervention_budget        = 0
portfolio_translation_budget     = 1
economic_hurdle_attempt_budget   = 1
```

- Phase 0에서 **첫 forward return을 보기 전** accounting mapping·data source를 고치는 것은 alpha 개입으로
  세지 않는다. 그것은 데이터를 만들 수 있느냐의 문제다.
- Phase 1에서 QV signal gate가 실패하면 그 자리에서 종료한다.
- Phase 1이 통과해도 Phase 2의 **단 한 번의 primary portfolio translation**이 §8의 공통 경제성 허들을
  못 넘으면 standalone `quality-value` 구축을 종료한다.
- 결과를 본 뒤 두 번째 portfolio construction, 다른 rebalancing, 다른 weight, 다른 factor를 열지 않는다.
- 결과 이후 허용되는 것은 prereg와 의미가 같은 명백한 data/code bug fix뿐이며, 수정 전후 결과와 영향 범위를
  모두 남긴다. bug fix를 새 research attempt로 위장하지 않는다.

다음은 `quality-value`에서 금지한다.

- operating profitability로 교체
- cash profitability
- ROE / ROA
- Piotroski F-score
- accruals
- asset growth / investment factor
- FCF yield
- EV/EBITDA / earnings yield
- intangible-adjusted book equity
- R&D capitalization
- debt quality
- momentum / absolute momentum
- SMA200 / ADX / RSI / market regime
- sector-neutral score
- volatility target을 alpha ranking에 삽입
- machine learning weight
- 50:50 weight 재탐색
- top percentile cutoff 재탐색
- rebalance month 재탐색

이 중 좋은 아이디어가 있어도 **새 lineage**다. 이번 lineage 결과가 아쉬워서 열 수 없다.

---

## 6. Phase 0 — PIT Fundamentals Data Gate

### 질문

> **수익률을 보지 않고도 QV factor를 과거 시점 기준으로 재현할 수 있는가?**

Phase 0에서는 strategy return을 계산하지 않는다.

### 작업

1. SEC annual fact ingestion/provenance.
2. CIK ↔ historical issuer/security/share-class identity 연결 재사용/보강.
3. Revenue / COGS / Assets / Book Equity mapping.
4. historical filing-time SIC 복원 규칙 결정.
5. point-in-time common shares / issuer market-equity source 결정.
6. multiple share class의 issuer aggregation + execution-security rule 결정.
7. formation-year snapshot 생성.
8. direct filing 숫자와 30개 firm-year 수동 대조.
9. missingness reason과 sector/era/identity-path coverage 보고.
10. future-perturbation look-ahead sentinel test.
11. 각 probe/run의 reproducibility run card 생성.

### 6.1 Historical research start를 사람이 고르지 않는다

Phase 1의 시작 연도는 결과나 차트를 보고 정하지 않는다. 먼저 `coverage_start`를 다음처럼
결정론적으로 계산한다.

```text
coverage_start
    = joint QV coverage >= 85%인 formation year가
      3년 연속 처음 나타나는 구간의 첫 formation year
```

그런 구간이 하나도 없으면 `DATA_NOT_READY`다. `coverage_start` 이후 final historical cut까지
어떤 formation year든 joint QV coverage가 75% 미만으로 떨어지면 그 해를 조용히 제외하지 않고
**data-contract failure**로 보고한다.

이 규칙은 수익률 계산 전에 freeze한다. `2010은 애매하니 2011부터` 같은 수동 시작점 선택을
허용하지 않는다.

### 데이터 gate

**coverage denominator를 먼저 고정한다.** 각 formation year에서 denominator는 Q/V availability를 보기
전의 `PIT S&P500 issuer` 중 historical SIC로 non-financial이라고 판정 가능한 issuer다. Q 또는 V가
없다고 denominator에서 사라지게 하지 않는다. historical SIC 자체가 없으면 별도
`classification_missing`으로 보고하며 전체 PIT membership 기준 coverage도 함께 제시한다.

`coverage_start`를 정한 뒤, 그 시점부터 final historical cut까지 다음을 전부 만족해야 Phase 1을 연다.

```text
A. PIT non-financial S&P500 issuer formation observations의 aggregate joint QV coverage >= 85%
B. 어떤 formation year도 joint QV coverage < 75%가 아님
C. issuer market-equity reconstruction coverage >= 95%
D. 수동 audit 30 issuer-years에서 look-ahead 0건
E. 동일 fiscal-year를 서로 다른 filing으로 이중 사용 0건
F. split/share-class 때문에 명백한 market-cap 배수 오류 0건
G. 한 issuer를 여러 security로 중복 ranking/selection한 건 0건
H. source/version/provenance에서 factor 원자료까지 역추적 가능
```

coverage report는 aggregate 숫자만 내지 않고 **formation year, sector, identity-resolution path,
missing reason, single/multi-class**별로 분해한다. 특정 시대나 특정 mapping path의 결손을 전체 평균이
가리지 못하게 한다.

30건 audit sample은 **return을 보기 전에** 고정하고, 초기·중기·최근 시기와 여러 sector를 포함한다.
표본 안에는 최소한 split, 대규모 buyback/issuance, multiple share class 사례를 의도적으로 포함해
historical market equity 복원이 실제 corporate-action 경계에서도 맞는지 확인한다.

### 허용되는 반복

Phase 0에서는 accounting tag mapping과 source choice를 고칠 수 있다. **단, forward return을
한 번이라도 계산하기 전까지만** 허용한다.

Phase 0이 실패하면:

```text
DATA_NOT_READY
```

로 닫는다. 수익률이 아예 없으므로 alpha 실패라고 부르지 않는다.

대안 데이터 소스를 확보하지 못하면 다음 strategy family로 이동한다.

### 6.2 Future-perturbation look-ahead sentinel

Vibe-Trading의 factor look-ahead test 패턴을 QV의 PIT 특성에 맞게 더 좁게 적용한다. 핵심은
**미래 데이터를 망가뜨려도 이미 형성된 과거 snapshot이 한 비트도 달라지지 않아야 한다**는 것이다.

각 audit 대상 formation session `t`에 대해:

```text
1. baseline DB에서 formation snapshot(t)을 계산한다.
2. t 이후의 filing / share fact / price / membership 입력만 복제본에서 오염시킨다.
   - absurd numeric sentinel
   - NULL / missing
   - 미래 filing의 수정값
   를 섞어 사용한다.
3. 같은 코드로 formation snapshot(t)을 다시 계산한다.
4. t 시점의 eligible set, selected fiscal filing identity, GPA, B/M, Q/V/QV rank,
   provenance reference를 canonical serialization한다.
5. baseline과 corrupted 결과의 SHA-256이 정확히 같아야 한다.
```

이번 factor는 단순 annual accounting arithmetic와 cross-sectional rank라서 Vibe-Trading처럼
rolling floating aggregation의 `1e-9` tolerance를 둘 이유가 없다. **canonical snapshot hash exact
match**를 요구한다. exact match가 불가능한 nondeterminism이 발견되면 tolerance를 늘리는 대신 먼저
그 nondeterminism의 원인을 제거한다.

sentinel은 최소 다음 경계를 각각 포함한다.

- acceptance 직전/직후 filing
- 10-K/A 또는 amended fact
- split / reverse split 이후 share count
- multiple share class
- membership 진입/이탈 이후 미래 변경
- formation 이후 가격 급변

이 테스트가 실패한 상태에서는 forward return 계산을 열지 않는다.

### 6.3 Research run card

Vibe-Trading의 `run_card`가 config hash, strategy hash, data source, metrics, warnings, artifact hash를
한 실행에 묶는 방식을 참고하되 갈피에는 별도 범용 프레임워크를 만들지 않는다. 각 QV run directory에
최소한 다음 **작은 sidecar artifact**만 둔다.

```text
run-card.json
run-card.md
```

필수 필드:

```text
research_id              = quality-value
phase / run_id
hypothesis_status         = draft | testing | promoted | rejected | frozen
prereg_commit_or_hash
code_commit
config_hash
source + source_version
historical_input_cutoff
formation_range
formal_oos_status
result_label
warnings
artifact path + sha256
```

`formal_oos_status`는 historical run에서 항상 `NOT_FORMAL_OOS`이고, run range가 `2025-08-07` 이후를
건드리면 별도 `legacy_holdout_status = CONTAMINATED_FOR_FORMAL_OOS`도 남긴다. Phase 5 freeze 이후 실제
PAPER/shadow에서 새로 형성된 cohort만 `FORWARD_SHADOW_OOS`가 될 수 있다. run card는 결과를 예쁘게
요약하는 보고서가 아니라 **어떤 계약·코드·데이터로 그 숫자가 나왔는지 다시 찾는 인덱스**다.

새 전역 Hypothesis Registry나 UI를 이번 PR에서 만들지 않는다. `quality-value`이라는 stable research id와
기존 `trading/runs/...` 디렉터리만으로 충분하다. 여러 strategy family가 실제로 쌓여 중복 문제가 생길 때
별도 인프라 PR로 일반화한다.

### 6.4 첫 forward return 전에 historical input window를 봉인한다

Phase 1에서 첫 미래수익을 계산하기 직전에 별도 prereg artifact에 다음을 **정확한 값**으로 기록한다.

```text
source_version(s)
accounting_mapping_hash
identity_mapping_hash
coverage_start
final_historical_cut
last_completed_12m_cohort
random_seed_set
```

`final_historical_cut` 이후에 벤더/SEC 데이터가 더 들어와도 primary historical window를 뒤로 늘리지
않는다. 새 데이터 refresh가 과거 source revision을 바꾸면 새 source hash로 별도 재현성 비교는 할 수
있지만, 더 좋아진 기간을 primary에 슬쩍 추가하지 않는다. 최신 formation cohort가 12개월을 다 채우지
못했으면 HARD gate에서 제외한다는 규칙도 이때 봉인한다.

---

## 7. Phase 1 — Quality + Value Signal Study

### 질문

> **포트폴리오 체결·risk rule을 붙이기 전에 QV 상위 quintile 자체에 미래수익 정보가 있는가?**

### 표본

- Phase 0에서 결정론적으로 고정한 `coverage_start`부터 final historical cut까지.
- HARD 판정에는 **완결된 12개월 cohort만** 사용한다. 아직 12개월이 끝나지 않은 최신 cohort는
  관찰용으로만 보고한다.
- `HOLDOUT_START = 2025-08-07` 이후 구간은 이미 `CONTAMINATED_FOR_FORMAL_OOS`다. QV가 사용해도
  새 formal OOS가 되지 않는다.
- 모든 historical 결과는 development / post-publication robustness다. 진짜 OOS는 freeze 이후 PAPER/shadow다.

### 방법

formation 당시 QV score를 1년 동안 고정한다. 월별 return은 경로 진단용으로 저장하지만,
**primary statistical unit은 formation year cohort 하나**다. 같은 연간 포트폴리오를 12개월
관측치로 쪼개 표본 수가 많은 것처럼 세지 않는다.

Primary annual series:

```text
R_QVk,y        = formation y의 QV 상위 k issuer equal-weight 12개월 total return
R_eligible,y   = 같은 formation joint-eligible issuer universe equal-weight 12개월 total return
Active_y       = R_QVk,y - R_eligible,y
```

Phase 1의 `total return`은 EODHD `adjusted_close`를 사용해 split과 dividend를 포함한 보유수익률로
계산한다. 이 단계에서는 체결 현금원장을 만들지 않으므로 adjusted series를 쓰되, Phase 2에서는
§2.3의 raw execution + explicit corporate-action accounting으로 다시 번역한다. 두 방식의 차이도
Phase 2 preflight에서 기록한다.

Diagnostic monthly series:

```text
Active_monthly,t = R_QVk,t - R_eligible,t
```

동시에 Quality-only top20, Value-only top20, bottom20, 100개 deterministic random same-size
portfolio를 같은 formation year 단위로 계산한다. **전부 Q와 V가 동시에 존재하는 동일 joint-eligible
issuer universe와 동일 k를 사용한다.** random control의 비교 통계량은 각 random portfolio의
`mean(Active_y)`로 고정한다.

**Signal 단계에서는 매매비용을 promotion 근거로 쓰지 않는다.** 이 단계는 ranking 정보량을
본다. 비용은 Phase 2에서 실제 turnover와 함께 적용한다.

### HARD gate

Primary hypothesis는 **고정된 50:50 QV 결합 자체**다. Quality-only와 Value-only는 attribution control이지
각각 독립 전략으로 동시에 합격해야 하는 전제는 아니다. 둘 중 하나가 약해도 고정 결합의 우위가 사전등록된
방식으로 존재할 수 있으므로 Q/V 단독 sign은 HARD gate에서 내리고 반드시 보고하는 diagnostic으로 둔다.

세 조건을 전부 통과해야 Phase 2로 간다.

```text
A. mean(Active_y) > 0
B. 2014년 이후 post-publication historical subset의 mean(Active_y) > 0
C. 실제 mean(Active_y)가 deterministic random 100개 중 최소 95개를 이김
```

반드시 보고하지만 HARD가 아닌 attribution/statistical diagnostics:

```text
Quality-only mean annual active return
Value-only mean annual active return
monthly Newey-West/HAC t-stat
```

작은 annual cohort 표본에서 `t >= 1.96`과 random 95/100을 동시에 HARD로 걸어 같은 우연성 문제를
중복 심사하지 않는다. Q-only/V-only가 음수여도 숨기지 않고 결합 성과가 어느 축에서 왔는지 해석에
명시한다.

### 7.1 검정력 / Type II 오류의 사전 해석 계약

이번 설계는 **위양성(Type I)을 줄이는 대신 위음성(Type II)을 감수하는 보수적 연구 계약**이다.
`primary statistical unit = formation-year cohort`를 유지하므로 같은 1년 포트폴리오를 월 12개 표본처럼
세지 않는다. 설계 시점 예상으로 SEC XBRL 실질 coverage가 2010년 전후부터 안정된다면 HARD gate의
완결 cohort 수는 대략 `n ≈ 15`, 조건 B의 2014년 이후 subset은 대략 `n ≈ 11` 수준이다. **이 숫자는
사전 예상치일 뿐이고**, 실제 `n`은 Phase 0의 결정론적 `coverage_start`와 §6.4의
`last_completed_12m_cohort`가 정한 값을 첫 forward return 전에 봉인한다.

따라서 조건 A/B/C 중 하나가 실패해 `QV_SIGNAL_REJECTED`가 되더라도 그 결론의 의미를 과장하지 않는다.
이 label은 **"Quality + Value에 우위가 없다"가 아니라 "이 표본과 사전등록한 문턱으로 탐지 가능한
크기의 우위를 확인하지 못했다"**는 뜻이다. 예를 들어 연간 active-return tracking error가 8% 안팎이고
`n = 15`라면 평균의 표준오차는 약 2%p 수준이라, 경제적으로 의미 있어도 작은 연 1~2%p 우위는
검정력이 낮을 수 있다. 이 수치는 효과 크기를 설명하는 예시이지 gate나 사후 구제 기준이 아니다.

조건 B는 **post-publication decay를 일부러 엄격하게 묻는 조건**이다. 그 subset에는 2014~2020의
value 부진 구간이 포함되므로 B 단독 실패를 `QV 자체의 부재`와 `era-specific weakness`로 분리해
식별할 수 없다고 기록한다. 그렇다고 B를 빼거나 기간을 바꾸지 않는다. **낮은 검정력은 재도전권이
아니다.** signal gate가 실패하면 이번 lineage는 예정대로 종료하며, threshold·factor·표본 시작점을
바꾸지 않는다.

모든 Phase 1 결과에는 HARD 조건별 PASS/FAIL과 함께 실제 annual cohort `n`, 2014+ subset `n`,
`mean(Active_y)`, annual active-return 표준편차/표준오차, random percentile을 반드시 보고한다.
§13 Case B와 §14에서도 `QV는 작동하지 않는다`라는 표현을 금지하고 **탐지 가능한 효과 크기의
증거 부족**으로만 기록한다.

추가 stability report는 판정과 별도로 반드시 낸다.

- 4개 non-overlap calendar block별 mean annual active return
- formation year별 contribution
- leave-one-year-out full-sample mean sign
- QV quintile 1→5의 평균 annual return 순서
- monthly Active의 Newey-West/HAC t-stat
- sector contribution
- candidate 수와 missingness

이 diagnostic을 보고 gate를 변경하지 않는다.

### 판정

- 전부 통과: `SIGNAL_PROMOTED`
- 하나라도 실패: `QV_SIGNAL_REJECTED`

실패하면 top 10%, OP, F-score를 열지 않고 `quality-value` alpha 연구를 종료한다.

---

## 8. Phase 2 — Portfolio Translation

Phase 1이 `SIGNAL_PROMOTED`일 때만 연다.

### 질문

> **넓게 분산한 아주 단순한 실제 보유 포트폴리오로 번역해도 SPY보다 경제성이 좋은가?**

### 포트폴리오 규칙 — 한 벌만

```text
Universe         PIT S&P500 non-financial joint-eligible issuers at formation
Formation        June last regular session
Entry            next regular session
Selection        QV top k issuers (k = floor(20% × N), min 1)
Weight           equal weight
Rebalance        once per year
Mid-year add     없음
Index deletion   보유 중 강제 청산하지 않음
Delisting        기존 realistic delisting path 사용
Leverage         없음
Short            없음
Cash target      0%, 단 주문/정수수량 제약으로 남는 cash는 허용
```

S&P 500에서 빠졌다고 mid-year 즉시 파는 규칙을 만들지 않는다. **membership은 formation 시점의
selection universe**이고, 보유 후에는 다음 annual rebalance 또는 실제 delisting까지 유지한다.
그래야 index reconstitution을 별도 alpha로 섞지 않는다.

### 왜 monthly rebalance가 아닌가

accounting signal이 annual이고, 선행연구도 annual formation을 중심으로 한다. 월별로 market cap을
다시 계산해 rank를 흔들면 value와 단기 가격 움직임을 섞고 turnover가 늘어난다.

이번 전략은 **느리게 틀릴 수 있는 전략**을 먼저 본다. annual로 안 되면 monthly로 구조를 구제하지 않는다.

### 기업행동·총수익 회계 preflight

Phase 2에서 첫 portfolio return을 계산하기 전에 §2.3의 규칙을 fixture와 작은 real-data probe로 검증한다.
최소 다음 항등식이 닫혀야 한다.

```text
split-only case:    split 전후 economic wealth가 비용 전 동일
cash dividend case: ex-date price drop + dividend cash가 total return에 한 번만 반영
multi-class case:   issuer selection 1개 -> execution security 1개
benchmark parity:   QV / eligible-EW / random이 같은 corporate-action semantics 사용
```

현재 momentum의 `adjust_for_corporate_action()`을 무비판적으로 재사용하지 않는다. 이 preflight가
통과하지 않으면 `PORTFOLIO_DATA_NOT_READY`이고 Phase 2 수익률을 열지 않는다.

### 비용

기존 갈피 cost/execution 계층의 **주문 가격·commission/slippage 계산 기반부**는 재사용하되 QV에 맞지
않는 stop-risk semantics는 가져오지 않는다. 기업행동/보유 원장은 위 preflight에서 승인된 경로만 쓴다.

최소 세 시나리오를 기록한다.

```text
NO_COST   비용 0 — arithmetic reference only
BASE      현재 research standard commission/slippage
STRESS2X  BASE의 가변 거래비용 2배
```

`NO_COST`는 promotion 근거가 아니다. **`ZERO`라는 이름은 기존 갈피의 unresolved terminal recovery=0
민감도와 충돌하므로 비용 0 시나리오에 쓰지 않는다.** QV에서도 미해결 terminal position이 생기면 기존
`LAST_CLOSE`와 `ZERO` recovery sensitivity를 별도로 보고한다.

### Benchmark 네 개 — primary는 exposure-matched SPY다

1. **after-cost exposure-matched SPY** — momentum-v2 §4와 같은 primary benchmark다. QV의 세션별 실제
   long market exposure fraction만큼 SPY dividend-inclusive total return에 노출되고 나머지는 cash로 둔
   counterfactual을 만든다. `G = S - B_exposure`가 primary gap이다. QV가 거의 fully invested라 해도 cash drag를
   전략 alpha로 착각하지 않기 위해 그대로 계산한다.
2. **SPY buy-and-hold total return** — 사용자가 그냥 시장을 100% 보유한 대안. secondary economic reference다.
3. **joint-eligible issuer universe equal-weight** — equal-weight·size tilt와 진짜 QV selection을 분리한다.
4. **same-size random equal-weight ×100** — 종목 선택 우위가 실제인지 확인한다.

eligible-EW와 random은 QV와 동일하게 **formation 시점, 다음 세션 진입, integer sizing/cash drag, 비용,
split/dividend accounting, delisting, annual rebalance**를 적용한다. benchmark만 이상적으로 fractional/no-cost로
만들어 QV selection과 implementation 차이를 섞지 않는다. random은 동일 joint-eligible issuer universe에서
동일 `k`를 뽑는다.

Phase 2는 비용 벽을 직접 보이기 위해 반드시 다음을 함께 출력한다.

```text
annual turnover
BASE trading costs ($ and bps of average equity)
gross exposure-matched SPY gap
after-cost exposure-matched SPY gap
implementation_drag = gross_gap - net_gap
```

"gross에서는 되는데 비용 후 0"이면 selection을 성공으로 포장하지 않는다. 그것이 momentum-v2에서 이미
배운 실패 모양이다.

### Final historical economic gate — 공통 전략 허들을 낮추지 않는다

이번 lineage의 최종 standalone qualification은 momentum-v2 §4의 핵심 문턱을 그대로 가져온다.
**primary 하나는 `after-cost exposure-matched SPY gap > 0`**이다. Phase 1 signal이 좋아도 이 문턱을
못 넘으면 전략은 아니다.

```text
S = BASE after-cost QV total return
B = exposure-matched SPY total return
G = S - B

Primary: G > 0
```

HARD 최소 조건은 다음이다.

```text
A. BASE after-cost total return > 0
B. after-cost exposure-matched SPY gap G > 0
C. Sharpe >= 0.60
D. MDD <= 15%
E. QV cohort profit factor >= 1.15
F. mean net issuer-year expectancy > 0
G. ActiveCAGR_EW = CAGR_QV - CAGR_eligible_EW > 0
H. actual BASE `G`가 same-size random 100개의 BASE `G` 중 최소 95개보다 우위
I. STRESS2X에서도 exposure-matched SPY gap > 0
J. unresolved `ZERO` recovery sensitivity에서 계좌가 구조적으로 붕괴하지 않음
```

`Profit Factor`는 기존 momentum의 round-trip trade PF를 억지로 재사용하지 않는다. QV에서는 annual formation
cohort가 자연스러운 경제 단위이므로 다음처럼 **결과를 보기 전에** 정의한다.

```text
net_issuer_year_pnl
    = 각 selected issuer의 formation-to-next-formation total PnL
      + dividend cash
      - 그 issuer-year에 귀속되는 실제 execution costs

QV cohort PF
    = sum(positive net_issuer_year_pnl) / abs(sum(negative net_issuer_year_pnl))

net_issuer_year_return
    = net_issuer_year_pnl / beginning allocated capital

issuer-year expectancy
    = mean(net_issuer_year_return)
```

손실 cohort가 하나도 없어 PF 분모가 0이면 무한대로 만들어 자동 PASS시키지 않고 `UNDEFINED`로 두며
HARD gate는 판정 불가다. 같은 issuer가 다음 해에도 남더라도 formation boundary에서 **측정 cohort만** 새로 시작할 뿐, PF를 만들려고
실제 포지션을 강제 청산·재진입하지 않는다. 비용은 실제 체결에만 발생하고 cohort PnL에 결정론적으로 귀속한다.
이 귀속 규칙은 Phase 2 prereg에서 return 계산 전에 고정한다.

기존 §4의 `expectancy > 0R`만은 문자 그대로 복사하지 않는다. QV는 stop-defined per-trade risk가 없으므로
`R`을 새로 발명하면 숫자 단위가 임의적이 된다. 대신 **같은 경제 단위인 issuer-year net expectancy > 0**을
HARD로 둔다. 이것은 결과를 본 뒤 기준을 낮추는 것이 아니라, 결과를 보기 전에 서로 다른 전략의 risk unit이
같지 않음을 명시하는 contract exception이다.

다음은 반드시 보고하지만 HARD gate는 아니다.

```text
Sortino
Calmar
annualized volatility
SPY buy-and-hold CAGR gap
NO_COST vs BASE implementation drag
```

이 gate는 기존 문서보다 느슨해지지 않는다. 오히려 QV 고유의 `ActiveCAGR_EW > 0`과 `STRESS2X G > 0`를
추가로 요구한다. **한 번의 Phase 2 translation에서 하나라도 실패하면 두 번째 construction은 없다.**

### 세 가지 outcome

**1. `PORTFOLIO_QUALIFIED`**  
Signal과 standalone portfolio economics가 둘 다 통과했다. Phase 3으로 간다.

**2. `COMPONENT_ONLY`**  
Signal gate는 통과했지만 위 HARD 경제성 조건 중 하나라도 실패했다. QV selection은 연구 자산으로
보존하되 standalone strategy 구축은 종료한다. **두 번째 portfolio construction attempt는 없다.** 나중에
다른 독립 sleeve와 합성하는 별도 portfolio 연구에서만 다시 사용할 수 있다.

**3. `PORTFOLIO_REJECTED`**  
Signal translation 자체가 무너졌다. 종료한다.

annual → quarterly, equal-weight → score-weight로 바꿔 구제하지 않는다.

---

## 9. Phase 3 — Reality Hardening / Broker Executability

`PORTFOLIO_QUALIFIED`일 때만 연다.

이 단계는 alpha를 더하는 곳이 아니다.

### 9.1 KIS 실행 가능성

한국투자증권 공식 Open API는 현재 해외주식 시세·주문·잔고 카테고리를 제공한다. 하지만
실제 실행 전에 다음을 **그 시점의 공식 API와 계좌 조건으로 다시 확인**한다.

- 미국 주식 주문 가능 거래소
- 시장가/지정가 지원
- 정수주 / 소수점 주문 지원 여부
- 최소 주문 단위
- 모의계좌에서 같은 주문 경로를 검증할 수 있는지
- 주문 정정/취소·체결 통보
- 환전/외화잔고 처리

지금 문서에 2026년 수수료·소수점 지원을 영구 상수로 박지 않는다. 바뀔 수 있는 broker rule은
Phase 3 실행 시 snapshot으로 저장한다.

### 9.2 자본 규모

Primary portfolio는 약 80~100개 이상일 수 있다.

브로커가 fractional share를 지원하지 않고 승인된 자본으로 각 종목 최소 1주를 살 수 없다면:

```text
RESEARCH_VALID_BUT_NOT_EXECUTABLE_AT_APPROVED_CAPITAL
```

이다.

이 경우 "돈이 적으니 TOP20 종목만"으로 전략을 바꾸지 않는다. 그건 다른 portfolio다.

### 9.3 USD alpha와 KRW investor return을 분리

Research gate는 USD로 유지한다.

Reality report에는 별도로:

```text
USD strategy return
USDKRW contribution
KRW unhedged investor return
```

을 분해한다.

환헤지를 추가하면 새로운 전략 component이므로 이번 lineage에서 하지 않는다.

### 9.4 세금

개인 세금은 법·계좌·다른 거래 손익에 따라 달라질 수 있다. historical alpha gate에 개인 세율을
숨겨 넣지 않는다. PAPER/LIVE 승인 직전 당시 한국 세법 기준의 after-tax scenario를 별도
보고한다.

### 9.5 Reality gate

- broker 주문 경로 검증
- annual rebalance 주문 전량을 실현 가능한 수량으로 생성
- corporate action / delisting / symbol change가 포지션 정합성을 깨지 않음
- current commission/FX cost를 적용해도 historical gate A의 부호가 유지
- paper mode에서 동일 snapshot → 동일 주문 의도

하나라도 실패하면 alpha를 수정하지 않는다.

---

## 10. Phase 4 — Robustness, 단 rescue는 금지

Primary가 이미 모든 hard gate를 통과한 뒤에만 robustness를 연다.

목적은 **성공한 숫자가 한 점에만 서 있는지 깨보는 것**이다.

### 사전 허용 diagnostic

1. Selection cutoff: top 10 / 20 / 30%.
2. Weight split: Q:V = 25:75 / 50:50 / 75:25.
3. Formation month: May / June / July.
4. Financials 포함 sensitivity.
5. BASE / 2X / 3X trading-cost stress.
6. subperiod / leave-one-year-out.
7. 2008, 2020, 2022 등 stress period contribution.
8. sector exposure concentration.
9. Ken French HML/RMW monthly factor loading의 부호.
10. frozen momentum candidate와 월별 active-return correlation.

**Primary가 실패한 뒤 이 표에서 잘 나온 셀을 골라 새 primary로 삼는 것은 금지한다.**

Robustness는:

```text
BROAD
FRAGILE
```

만 판정한다.

`FRAGILE`이면 역사적 hard gate를 통과했어도 forward deployment로 승격하지 않는다.

### BROAD의 최소 의미

정확한 모든 숫자가 같을 필요는 없다. 하지만 최소한:

- top 10/20/30 중 2개 이상에서 SPY 대비 CAGR gap이 양수,
- Q/V weight 3개 중 2개 이상에서 SPY 대비 CAGR gap이 양수,
- cost 2X에서 primary 부호 유지,
- 특정 1개 formation year 제거로 full-sample SPY gap 부호가 뒤집히지 않음

을 만족해야 한다.

이 조건은 이 문서가 승인되는 순간 함께 freeze된다.

---

## 11. Historical result를 OOS라고 부르지 않는다

이 전략은 논문으로도 알려져 있고, 우리는 이미 2007~현재 시장의 큰 사건들을 알고 있다. 더구나 기존
코드의 `HOLDOUT_START = 2025-08-07` 구간은 프로젝트 기록상 이미 두 번 소모되어
`CONTAMINATED_FOR_FORMAL_OOS`다. **그 날짜를 다시 통과했다고 QV OOS가 새로 생기지 않는다.**

이번 lineage는 과거에 새 경계를 그어 "홀드아웃"이라고 부르는 선택을 하지 않는다. 모든 historical data는
개발·강건성 확인에만 쓴다. 다음 용어만 쓴다.

```text
Historical Development
Historical Post-Publication Robustness
CONTAMINATED_FOR_FORMAL_OOS   # legacy 2025-08-07+ historical segment
Forward Shadow OOS            # freeze 이후 PAPER/shadow에서 새로 형성된 cohort only
```

`Forward Shadow OOS`는 **strategy freeze commit 이후 처음 도착하는 정규 June formation**에서 시작한다.
과거 날짜(예: 2026-01-01)를 새 경계로 소급 지정하지 않는다. 그리고 PAPER/shadow 인프라가 준비되지
않았으면 OOS 판정을 시작하지 않는다.

---

## 12. Phase 5 — Freeze & Forward Shadow OOS

Phase 4까지 `PORTFOLIO_QUALIFIED + BROAD`면 전략을 freeze한다.

### Freeze artifact

최소 다음을 hash/commit으로 고정한다.

- universe rule
- financial exclusion
- accounting field mapping
- source versions
- formation calendar
- factor formulas
- score weights
- `k=max(1,floor(0.20*N))` selection cutoff
- portfolio weighting
- rebalance rule
- execution/cost assumptions
- benchmark definitions
- freeze commit timestamp
- first eligible forward formation session

그 뒤 과거 데이터를 다시 돌려 숫자를 바꾸지 않는다.

### Forward shadow

`Swing Trading Agent Design` 20.1의 PAPER/shadow 경로가 준비된 뒤에만 연다. 실제 새 filing이 도착하는
시점에 그때의 원문/fact를 append-only로 저장하고, freeze 이후 첫 정규 June formation에서 실제 shadow
portfolio를 만든다.

Forward 기간에는:

- factor definition 변경 금지
- 누락 company를 수익률 보고 나서 수동 보정 금지
- score weight 변경 금지
- cutoff 변경 금지
- 다른 factor 추가 금지

문제가 data bug라면 bug를 고치되 **이전 forward decisions가 어떻게 달라졌는지 전부 재계산해
영향을 공개**한다.

### 기간

이 전략은 annual formation이라 3개월 잘 됐다고 OOS 성공이라 부를 수 없다.

- 최소 1개 완결 12개월 cohort: **execution sanity**만 평가.
- 최소 2개 완결 annual cohort: small-live 승격 검토 가능.
- 2년으로 alpha의 존재가 통계적으로 증명됐다고 표현하지 않는다.

Paper/shadow는 기다리는 시간이 아니라 **계약이 미래에서도 그대로 실행되는지 확인하는 단계**다.

---

## 13. 종료 조건 — 성공보다 먼저 쓴다

이번 lineage의 숫자 예산은 고정이다.

```text
alpha interventions      0회
primary signal study     1회
portfolio translation    1회
economic hurdle attempt  1회
```

Phase 2에서 §8 HARD gate를 못 넘겼다고 두 번째 construction을 열지 않는다. 이것이 이번 lineage의
가장 중요한 종료 장치다.

### Case A — Phase 0 data gate 실패

```text
DATA_NOT_READY
```

수익률을 계산하지 않는다. data provider를 확보하지 못하면 `quality-value`을 보류하고
다음 family로 간다.

### Case B — Phase 1 signal gate 실패

```text
QV_SIGNAL_REJECTED
```

`operating profitability`, 다른 value metric, top10을 열지 않는다. 이번 lineage 종료. **단, 종료의
해석은 §7.1에 묶인다.** `QV_SIGNAL_REJECTED`는 `QV에 우위가 없다`의 동의어가 아니다.
정확한 기록은 **"이 historical sample과 preregistered gate에서 탐지 가능한 크기의 QV 우위를
확인하지 못했다"**다. 특히 조건 B만 실패했다면 2014+ post-publication subset의 era composition과
QV 자체 효과를 이 설계만으로 분리할 수 없다고 함께 적는다. 이 불확실성을 이유로 재시험하지 않는다.

### Case C — Phase 1 통과, Phase 2 실패

```text
COMPONENT_ONLY
또는 PORTFOLIO_REJECTED
```

QV factor 연구 기록은 보존한다. standalone strategy를 구제하지 않는다.

### Case D — Portfolio 통과, Reality 실패

```text
RESEARCH_VALID_BUT_NOT_EXECUTABLE
```

broker/capital 문제를 alpha rule 변경으로 해결하지 않는다.

### Case E — Historical + Robustness 통과

```text
FROZEN_FORWARD_SHADOW
```

여기서부터는 미래가 심사한다.

---

## 14. 이 전략이 실패해도 다시 하지 않을 것

`quality-value`이 실패했을 때 다음 행동은 "Quality를 조금 고친다"가 아니다.

현재 strategy-family tournament의 다음 후보는 별도 연구계약으로 넘어간다.

```text
1. Quality + Value          ← current
2. Futures Carry
3. PEAD / earnings surprise
4. Pairs / Statistical Arbitrage
5. Short-term Reversal
```

이 순위 자체도 영구 진리가 아니다. 데이터·브로커 환경이 바뀌면 새 근거로 다시 평가한다.
다만 **QV 실패 결과를 보고 QV의 조건을 늘리는 것보다 독립된 경제적 수익원으로 이동하는 것**을
우선한다.

실패 ledger에도 `QV는 작동하지 않는다`, `Value/Quality anomaly는 없다`처럼 범위를 넓힌 문장을
남기지 않는다. §7.1의 실제 `n`과 실패한 HARD 조건을 함께 남기고, **"이 표본에서 탐지 가능한
크기의 우위를 확인하지 못함"**까지만 말한다. 이것은 QV를 다시 열기 위한 예외가 아니라, 한 번의
저검정력 연구 결과를 보편 명제로 오기억하지 않기 위한 기록 규칙이다.

---

## 15. 예상 repo 작업 단위 — 아직 구현 지시가 아니다

이 절은 연결부를 보여주기 위한 roadmap이며 실제 파일·함수 이름은 Phase별 설계 승인 후 최소
변경으로 확정한다.

### Phase 0 예상 산출물

```text
docs/quality-value-roadmap.md
trading/runs/qv-data-audit/...
PIT fundamental raw/normalized data layer
coverage + manual-audit report
```

### Phase 1

```text
trading/runs/qv-signal-study/
preregistration
run-card.json / run-card.md
result JSON
README / interpretation
```

### Phase 2

```text
trading/runs/qv-portfolio-translation/
run-card.json / run-card.md
new QV research policy/core only if required
benchmark/random controls
```

### Phase 3~5

통과한 단계만 연다. **미리 production code를 만들지 않는다.**

각 Phase는:

```text
assumption → prereg → implementation → result → interpretation → user approval
```

순서를 지킨다.

---

## 16. 검증 체크리스트

### 데이터

- [ ] formation session보다 늦게 usable해진 filing fact가 0건인가
- [ ] fiscal year 선택이 결정론적인가
- [ ] acceptance_datetime과 historical_usable_session 규칙이 고정됐는가
- [ ] amended filing 처리 규칙이 고정됐는가
- [ ] historical share count를 current share count로 대체하지 않았는가
- [ ] issuer-level ME가 ordinary common share classes를 중복 없이 합산하는가
- [ ] 같은 issuer가 두 security로 중복 ranking/selection되지 않는가
- [ ] execution-security rule이 return을 보기 전에 고정됐는가
- [ ] negative book equity 처리 규칙이 고정됐는가
- [ ] financial exclusion이 historical filing-time SIC로 결정론적인가
- [ ] current SIC가 historical missing을 조용히 대체하지 않는가
- [ ] source version이 결과 artifact에 기록되는가
- [ ] point-in-time common shares/ME source의 field semantics가 filing과 대조됐는가
- [ ] shares를 raw XBRL instance에서 읽었고 companyfacts API를 정본으로 쓰지 않았는가
- [ ] 12월 shares instant 선택과 tie-break가 결과 전에 고정된 규칙대로인가
- [ ] derived/equivalent member가 실제 share class로 등록되지 않았는가
- [ ] 비상장 ordinary class가 조용히 제외되거나 임의 가격을 받지 않았는가
- [ ] `valuation_method`가 결과 artifact까지 보존되는가
- [ ] coverage denominator가 Q/V missing 이전 PIT issuer universe로 고정됐는가
- [ ] future-perturbation sentinel에서 과거 formation snapshot hash가 exact match인가
- [ ] sentinel이 filing/share/split/share-class/membership/price 미래 경계를 모두 건드리는가

### 신호

- [ ] Q/V/QV 정의와 average-rank percentile 수학이 prereg와 byte-level로 같은가
- [ ] Q/V/QV/eligible-EW/random이 동일 joint-eligible issuer universe를 쓰는가
- [ ] `k=max(1,floor(0.20*N))` cutoff가 결과 후 바뀌지 않았는가
- [ ] random control이 same-size/same-date universe를 쓰는가
- [ ] post-publication subset을 OOS라고 부르지 않는가

### 포트폴리오

- [ ] annual formation만 하는가
- [ ] 다음 세션 이전 체결이 없는가
- [ ] mid-year index change가 새 alpha로 들어오지 않는가
- [ ] SPY / eligible EW / random benchmark가 모두 있는가
- [ ] 비용 스트레스가 있는가
- [ ] 정수수량/cash drag가 기록되는가
- [ ] split은 수량만, dividend는 cash/receivable로 한 번만 반영되는가
- [ ] adjusted price와 explicit dividend cash가 이중계산되지 않는가
- [ ] QV/eligible-EW/random의 기업행동·비용·delisting semantics가 동일한가
- [ ] SPY가 dividend-inclusive total return reference인가

### 연구 계약

- [ ] Primary 실패 후 sensitivity winner를 승격하지 않는가
- [ ] 새 profitability/value 정의를 같은 lineage에서 열지 않는가
- [ ] Phase를 결과 보고 추가하지 않는가
- [ ] forward start 이후 rule mutation이 없는가
- [ ] 각 결과 run이 prereg/code/config/data/artifact hash를 가진 run card와 연결되는가
- [ ] historical run의 `formal_oos_status`가 `NOT_FORMAL_OOS`로 명시되는가
- [ ] Phase 1 첫 return 전에 source/historical cut/completed cohort/random seed가 봉인됐는가
- [ ] 참고 레포의 optimizer/alpha/agent를 결과 구제용으로 끌어오지 않았는가
- [ ] `alpha_intervention_budget=0`, `portfolio_translation_budget=1`이 결과 후 늘어나지 않았는가
- [ ] 기존 `RULE_FIELDS`/`paper-core-v1`을 QV 때문에 변경하지 않았는가
- [ ] QV core가 열리면 모든 QV rule semantics가 별도 freeze/signature에 포함되는가
- [ ] `2025-08-07+` historical result를 OOS라고 부르지 않았는가
- [ ] forward OOS claim이 freeze 이후 실제 PAPER/shadow cohort에만 붙는가
- [ ] gross gap, BASE 비용, turnover, implementation drag, after-cost gap을 같이 보고했는가

---

## 17. 원문 근거와 반대 근거

아래 인용은 연구 방향을 정당화하기 위한 것이지 갈피 전략의 성과를 보증하지 않는다.

### Lakonishok, Shleifer, Vishny — Value의 behavioral mechanism 후보

> “exploit the mistakes of the typical investor”

- NBER Working Paper 4360, *Contrarian Investment, Extrapolation, and Risk*.
- Published: Journal of Finance 49(5), 1994.
- https://www.nber.org/papers/w4360

이 논문은 value premium의 원인을 typical investor의 extrapolation/mistake 쪽으로 해석한다. 이번 QV는 이를
**확정된 원인**이 아니라 "왜 싼 가격이 남아 있을 수 있는가"의 working mechanism 후보로만 쓴다.

### Asness, Frazzini, Pedersen — Quality가 가격에 충분히 반영되는가

> “the ‘quality margin’ is puzzlingly modest”

- *Quality Minus Junk*, 2017 working-paper version.
- https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2312432
- https://www.aqr.com/Insights/Research/Working-Paper/Quality-Minus-Junk

저자들도 quality return을 특정 risk factor로 깔끔하게 설명하지 못한다고 적는다. 따라서 이번 문서의
"quality가 충분히 가격에 반영되지 않을 수 있다"는 문장은 **가설**이지 확정된 시장 비효율이 아니다.

### Robert Novy-Marx — Gross Profitability

> “Profitability, as measured by gross profits-to-assets, has roughly the same power as book-to-market...”

- NBER Working Paper 15940, *The Other Side of Value: Good Growth and the Gross Profitability Premium*.
- Published: Journal of Financial Economics 108(1), 2013, 1–28.
- https://www.nber.org/papers/w15940
- DOI: 10.1016/j.jfineco.2013.01.003

### Ray Ball et al. — Contrary profitability evidence

> “operating profitability ... exhibits a far stronger link with expected returns”

- Ball, Gerakos, Linnainmaa, Nikolaev, *Deflating profitability*, JFE 117(2), 2015.
- DOI: 10.1016/j.jfineco.2015.02.004
- https://www.sciencedirect.com/science/article/pii/S0304405X15000203

이 반대 근거 때문에 이번 전략은 `GP/A`를 **검증 대상**으로 두며, 실패 시 OP로 즉시 갈아타지 않는다.

### Novy-Marx & Velikov — Trading costs

> “Introducing a buy/hold spread ... is the single most effective simple cost mitigation strategy.”

- NBER Working Paper 20721 / Review of Financial Studies 29(1), 2016.
- https://www.nber.org/papers/w20721
- DOI: 10.1093/rfs/hhv063

이번 전략은 더 단순한 annual rebalance를 먼저 써 turnover 자체를 낮춘다. buy/hold spread는 이번
primary의 rescue knob가 아니다.

### McLean & Pontiff — Publication decay

> “Portfolio returns are 26% lower out-of-sample and 58% lower post-publication.”

- Journal of Finance 71(1), 2016.
- DOI: 10.1111/jofi.12365
- https://onlinelibrary.wiley.com/doi/10.1111/jofi.12365

따라서 2014+ historical result를 별도 보고하지만 formal OOS라고 부르지 않는다.

### SEC filing acceptance / dissemination timing

- SEC Webmaster FAQ는 EDGAR acceptance date/time과 실제 sec.gov 공개 사이에 보통 짧은
  전파 지연이 있을 수 있음을 설명한다.
- https://www.sec.gov/about/webmaster-frequently-asked-questions

이번 전략은 historical filing을 acceptance 당일에 사용하지 않고 다음 regular trading
session부터만 사용해 이 분 단위 지연을 보수적으로 흡수한다.

### SEC EDGAR APIs

> “These APIs do not require any authentication or API keys to access.”

- SEC, EDGAR Application Programming Interfaces.
- https://www.sec.gov/search-filings/edgar-application-programming-interfaces

SEC는 submissions와 10-Q/10-K/8-K 등의 XBRL facts를 제공하고 실시간으로 업데이트한다.

### Kenneth French Data Library

- Fama/French 5-factor portfolios는 size × book-to-market, size × operating profitability,
  size × investment portfolio에서 구성된다.
- https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/Data_Library/f-f_5_factors_2x3.html

이 자료는 QV가 알려진 factor family와 방향상 맞는지 확인하는 외부 sanity reference이지,
우리 전략의 benchmark return을 복사하는 데이터가 아니다.

### EODHD price adjustment / shares / market-cap semantics

- EODHD EOD 문서는 raw OHLC가 split/dividend 미조정이고 `adjusted_close`는 **split과 dividend 모두**
  반영한다고 설명한다.
- https://eodhd.com/financial-apis/api-for-historical-data-and-volumes
- EODHD Fundamentals glossary는 `SharesStats.SharesOutstanding`을 **현재 ticker-specific class의
  outstanding shares**로 설명하지만, historical `outstandingShares.shares`/`sharesMln`은 **weighted average
  diluted shares outstanding, split-adjusted**라고 설명한다.
- https://eodhd.com/financial-academy/financial-faq/fundamentals-glossary-common-stock
- Historical Market Capitalization API의 미국 주식 시계열은 2021-07-09부터 주간 값이다.
- https://eodhd.com/financial-apis/historical-market-capitalization-api

따라서 `outstandingShares`라는 이름만으로 12월 말 point-in-time common shares라고 간주하지 않는다.
Phase 0에서 실제 filing과 field semantics를 대조해 승인되지 않으면 market-equity 정본으로 쓰지 않는다.

### 현재 갈피 core rule surface / holdout 구현 감사

- `trading/core/definition.py`는 `RULE_FIELDS = (policy, entry_mode, exit_mode, regime_mode,
  require_earnings_calendar, require_sector)`로 두고 **"여기 없는 것은 규칙이 아니다"**라고 명시한다.
- `trading/tests/test_core.py`는 이 목록과 `BacktestConfig` 연결을 값으로 잠근다. QV는 이 frozen momentum
  rule surface를 억지로 늘리지 않고 별도 core 계약을 사용한다.
- `trading/backtest/holdout.py`는 `HOLDOUT_START = "2025-08-07"`을 전역 코드 불변식으로 둔다. QV는
  이 상수를 리셋하지 않으며, 이미 오염된 이후 historical 구간을 formal OOS로 재명명하지 않는다.

### 현재 갈피 corporate-action/SIC 구현 감사

- `trading/backtest/edgar.py`는 현재 저장하는 SIC가 **현재 값이고 과거 재분류 이력이 아님**을 명시한다.
  QV의 historical financial exclusion에는 이 값을 그대로 쓰지 않는다.
- `trading/backtest/loop.py`는 보유 포지션을 raw close로 mark하고 `cash + exposure`로 equity를 계산한다.
- `trading/backtest/positions.py`의 기존 corporate-action 조정은 raw/adjusted scale 변화로 share quantity를
  조정하고, 기존 execution test는 실제 dividend adjustment도 `CORPORATE_ACTION`으로 인식하는 동작을
  잠근다.

이 세 사실 때문에 annual QV Phase 2에는 explicit dividend/split total-return semantics가 먼저 필요하다.
기존 momentum 동작을 깨뜨리면서 공용화하지 않는다.

### Korea Investment & Securities Open API

- 공식 `koreainvestment/open-trading-api` repository는 `overseas_stock` category에 해외주식
  시세·주문·잔고 예제를 제공한다.
- https://github.com/koreainvestment/open-trading-api

실전 승인 때는 당시 API와 계좌 조건을 다시 확인한다.

### 참고 오픈소스 레포 — 전략 근거가 아니라 구현·검증 참고

#### HKUDS/Vibe-Trading

- https://github.com/HKUDS/Vibe-Trading
- durable hypothesis registry는 hypothesis id, thesis, universe, signal definition, data source, linked run card,
  invalidation note, lifecycle status를 별도 연구 객체로 보존한다.
- `agent/backtest/run_card.py`는 config hash, optional strategy hash, data sources, scalar metrics, warnings,
  validation, artifact path/size/SHA-256을 한 실행에 묶는다.
- `agent/tests/factors/test_lookahead.py`는 미래 row를 NaN/absurd sentinel로 오염시킨 뒤 과거 factor
  값이 변하지 않는지 비교해 look-ahead를 잡는다.

이번 QV에서는 이 세 개념 중 **stable research identity, run-card provenance, future-perturbation sentinel**만
좁게 참고한다. Alpha Zoo나 agent-driven factor discovery는 사용하지 않는다.

#### skfolio/skfolio

- https://github.com/skfolio/skfolio
- scikit-learn 호환 portfolio optimization/risk-management framework로 equal weight, mean-risk, risk budgeting,
  HRP/NCO 계열, Walk Forward, Combinatorial Purged Cross-Validation 등을 제공한다.
- 프로젝트 문서 자체도 MVO의 parameter sensitivity, concentration, turnover, poor OOS 문제와 naive allocation의
  강한 OOS benchmark를 명시한다.

따라서 이번 QV primary에는 optimizer를 넣지 않는다. 여러 독립 sleeve가 먼저 살아남은 뒤 **portfolio-layer
검증 후보**로만 다시 본다.

#### nautechsystems/nautilus_trader

- https://github.com/nautechsystems/nautilus_trader
- Rust-native event-driven engine으로 research, deterministic simulation, live execution에 같은 execution semantics와
  time model을 쓰는 research-to-live parity를 목표로 한다.
- quote/trade tick, bar, order book, custom data를 이용한 다중 venue backtest와 live adapter 구조를 제공한다.

annual QV에는 필요 이상의 복잡성이다. 향후 intraday/reversal/market-making/futures처럼 **체결 모델이 alpha와
분리되지 않는 lineage**가 열릴 때 갈피 자체 엔진을 계속 확장할지 판단하는 benchmark로 사용한다.

#### shiyu-coder/Kronos

- https://github.com/shiyu-coder/Kronos
- OHLCV K-line을 hierarchical discrete token으로 양자화하고 autoregressive Transformer로 처리하는 금융 시계열
  foundation model family다.
- 공개 README의 fine-tuning/backtest pipeline도 스스로 simplified demonstration이며 production-ready quantitative
  system이 아니라고 명시한다.

이번 QV에서는 사용하지 않는다. pretrained model을 historical QV feature로 섞으면 factor hypothesis와 ML model
history가 한 번에 섞여 무엇이 기여했는지 분리할 수 없다. 필요하면 별도 ML research lineage에서 clean forward
contract와 함께 검증한다.

---

## 18. 최종 한 줄 계약

> **`quality-value`은 PIT S&P500 ex-financials에서 Novy-Marx식 GP/A와 Book-to-Market을
> 50:50 percentile로 결합한 annual long-only factor 전략 한 벌만 검증한다. 이 전략이 살아남는 경로는
> 비밀정보가 아니라 낮은 turnover와 비용보다 큰 persistent edge뿐이다. alpha 개입은 0회, portfolio
> translation은 1회만 허용하며, after-cost exposure-matched SPY gap·Sharpe 0.60·MDD 15% 등 §8 HARD
> gate를 한 번에 넘지 못하면 종료한다. `2025-08-07+` historical 구간은 OOS가 아니고, 진짜 OOS는
> freeze 이후 PAPER/shadow에서 새로 형성된 cohort뿐이다. 결과를 본 뒤 새로운 factor·threshold·construction으로
> 구제하지 않는다.**
