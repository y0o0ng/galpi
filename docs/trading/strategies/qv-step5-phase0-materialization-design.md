# QV Step 5 — Phase 0 실행 설계

**이 문서는 실행 순서만 명시한다.** factor semantics도 Phase 0 gate도 바꾸지 않는다.
바꾸는 것은 "무엇을 먼저 해야 다음이 가능한가"라는 의존 관계를 드러내는 것뿐이다.

- **Step 4는 CLOSED다.** 정본은 `docs/trading/strategies/qv-step4-shares-me-design.md`이고
  이 문서가 그 계약을 다시 열지 않는다.
- **Phase 0는 DATA ONLY다.** 로드맵 §6 그대로다.
- **Phase 0를 통과하기 전에는 어떤 수익률도 계산하지 않는다.**
- **명시 manifest가 production identity 정본이다**(Step 4 설계 §1).
  `securities` · 현재 SEC ticker map · `edgar.resolve_cik` · 회사명 매칭 ·
  `CIK_OVERRIDES` · fuzzy matching · ticker 연속성 추정은 production identity가 아니다.

---

## 1. 실행 단계

```text
5A-1  identity coverage inventory
5A-2  explicit identity evidence / manifest expansion
5A-3  production SEC / accounting / shares / ME materialization
5B    formation snapshot + coverage_start + Gate A~H + sentinel
```

각 단계는 **앞 단계가 끝나야 의미 있는 측정이 된다.** Step 4 코드가 issuer market
equity까지 완성됐지만 Phase 0는 아직 실행되지 않았고, 그 직접적인 병목이 identity
coverage다. manifest가 수동으로 원문 확인한 anchor만 담고 있는 상태에서 downstream
materializer를 돌리면 **"데이터 계약이 어떤가"가 아니라 "manifest가 아직 안 만들어졌다"를
측정하게 된다.**

### 5A-1 — identity coverage inventory (이번 단계)

한 가지 질문만 결정론적으로 답한다.

> 각 6월 formation에서, PIT S&P 500 구성 종목 중 명시 QV identity manifest로 이미
> 풀리는 것은 무엇이고, 풀리지 않는 것과 모호한 것은 무엇인가?

**inventory/preflight일 뿐이다.** manifest를 넓히지 않고, SEC 문서를 받지 않으며,
submissions/accounting/shares를 ingest하지 않고, 사건 탐색·C3·ME를 돌리지 않고,
historical SIC 필터·Q·V·B/M·랭킹·상위 20%·execution security·`coverage_start`를
계산하지 않으며, **어떤 gate도 판정하지 않는다.**

입력은 전부 명시적이다.

```text
formation_session(t) = 그 해 6월의 마지막 정규 SPY 세션
                       (6월 30일 같은 달력 날짜를 직접 쓰지 않는다)
membership           = [valid_from, valid_to) 반개구간
                       index_name · universe source/version을 명시로 받는다
identity             = 요청된 identity_source_version 하나
```

해석 grain은 `formation_session × PIT 구성 종목 심볼`이고 결과는 셋뿐이다.

```text
RESOLVED    PIT-usable한 상장 ordinary class가 정확히 하나 + PIT-usable issuer
MISSING     0개
AMBIGUOUS   둘 이상
```

**모호한 집합에서 하나를 고르지 않는다.** precedence·최신 행 선택·ticker 휴리스틱·
수동 override가 없다. 나중에 알게 된 class/issuer를 `usable_from_session` 이전에
보이게 하지 않는다. 내부적으로 모순된 상태는 fail-close다.

사유는 열거값이라 집계할 수 있다.

```text
NO_CLASS_SEGMENT_FOR_SYMBOL     심볼에 대한 class 구간이 아예 없다
CLASS_NOT_ACTIVE_AT_FORMATION   구간은 있으나 formation에 활성이 아니다
CLASS_NOT_LISTED_ORDINARY       활성이지만 상장 ordinary common이 아니다
CLASS_NOT_YET_USABLE            경제적으로는 활성인데 증거가 아직 usable하지 않다
ISSUER_MISSING                  class는 풀렸는데 issuer 행이 없다
ISSUER_NOT_YET_USABLE           class는 풀렸는데 issuer가 아직 usable하지 않다
MULTIPLE_CLASS_RESOLUTIONS      유효한 class 해석이 둘 이상이다
CONTRADICTORY_IDENTITY_STATE    같은 class의 구간이 겹치는 등 모순 상태다
```

**같은 issuer가 여러 S&P 500 종목으로 나타나는 것은 identity 오류가 아니다.**
security 행은 그대로 두고 issuer 단위 묶음을 따로 만든다. 그것이 나중에 Gate G를
증명할 입력이고, 여기서 **순위를 매기거나 execution security를 고르지 않는다.**

구현은 `trading/backtest/qv_identity_inventory.py` 하나이고 실행 진입점은
`trading/selftest/qv_identity_inventory_run.py`다. 범용 research-run 프레임워크를
만들지 않았고 스키마도 바꾸지 않았다.

### 5A-2 — 명시 identity 증거 / manifest 확장

5A-1이 보여준 미해결 집합을 **원문 SEC 증거로** 채운다. Step 4 설계 §1.2의 구조화
증거 계약과 §1.6의 canonical prose bridge 규칙이 그대로 적용되고,
`usable_from_session`은 REQUIRED 증거에서 파생한다.

**5A-1의 결과를 보고 identity 규칙을 바꾸지 않는다.** coverage가 아쉽다고 fuzzy
매칭이나 수동 예외를 만들지 않는다 — 그것이 정확히 Follow-up 9가 닫은 자리다.

### 5A-3 — production materialization

submissions · accounting · shares 관측 · 사건 탐색 · boundary · C3 · class/issuer ME를
Step 4 계약대로 실제 데이터에 돌린다. 이 단계가 되어야 §11 issuer market equity가
실제 숫자를 갖는다.

### 5B — snapshot · coverage_start · Gate A~H · sentinel

Step 4 설계 §12가 이미 Step 5 소유로 못박은 것들이다. 최종 formation snapshot ·
accounting과 issuer ME의 join · Q/V raw value · 백분위 랭크 · 50:50 QV score ·
상위 20% 선택 · execution security 선택 · `coverage_start` · Gate A~H 판정 ·
look-ahead audit/sentinel · 수익률.

---

## 2. 이 단계가 하지 않는 것

**5A-1은 identity coverage를 바꾸지 않고 어떤 gate도 통과시키지 않는다.**
현재 coverage를 **보이게** 만들 뿐이다. 미해결과 모호가 조용히 추측되는 대신
숫자로 남는 것이 이 단계의 전부다.

Gate A~H와 Phase 0 판정은 여전히 **평가되지 않았다.**
