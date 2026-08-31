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
5A-1  static explicit identity mapping coverage-demand inventory
5A-2  explicit SEC evidence + manifest expansion
5A-3  production SEC/evidence ingest
        -> identity materialization
        -> PIT identity usability
        -> accounting / shares / events / C3 / ME materialization
5B    formation snapshot + coverage_start + Gate A~H + sentinel
```

> **두 가지를 절대 섞지 않는다.**
>
> ```text
> 5A-1  static mapping coverage demand   — 매핑이 manifest에 있는가
> 5A-3  PIT identity usability           — 그 매핑이 그때 실제로 쓸 수 있었는가
> ```
>
> `usable_from_session`은 REQUIRED 증거에서 파생하고 그 증거는 5A-3이 ingest한다.
> **5A-1이 그것에 기대면 순환 의존이 된다** — materialize 전에 돌리면 "매핑이 없다"와
> "manifest가 아직 DB에 안 들어갔다"를 구분하지 못한다. Step 4의 PIT 계약은 그대로이고
> **5A-3에서 identity가 실제로 materialize된 뒤 정본이 된다.**

각 단계는 **앞 단계가 끝나야 의미 있는 측정이 된다.** Step 4 코드가 issuer market
equity까지 완성됐지만 Phase 0는 아직 실행되지 않았고, 그 직접적인 병목이 identity
coverage다. manifest가 수동으로 원문 확인한 anchor만 담고 있는 상태에서 downstream
materializer를 돌리면 **"데이터 계약이 어떤가"가 아니라 "manifest가 아직 안 만들어졌다"를
측정하게 된다.**

### 5A-1 — static explicit identity mapping coverage demand (이번 단계)

한 가지 질문만 결정론적으로 답한다.

> 각 6월 formation에서, PIT S&P 500 구성 종목 중 **선택된 manifest에 명시적 economic
> share-class/issuer 매핑이 존재하는 것**은 무엇이고, 어떤 것이 5A-2 identity 작업을
> 필요로 하는가?

**5A-1은 어떤 매핑이 과거에 사용 가능했다고 주장하지 않는다.** 매핑 coverage/수요를
재는 것이지 PIT 증거 가용성을 재는 것이 아니다.

**manifest 내용에서 직접 읽는다.** `qv_share_classes` / `qv_issuers`가 비어 있어도
돌아야 한다. materialize된 identity는 5A-1의 전제가 아니다.

```text
formation_session(t) = 그 해 6월의 마지막 정규 SPY 세션
                       (6월 30일 같은 달력 날짜를 직접 쓰지 않는다)
membership           = [valid_from, valid_to) 반개구간
                       index_name · universe source/version을 명시로 받는다
identity             = qv_manifest.load_manifest()가 돌려준 bundle 하나
```

요청된 `identity_source_version`은 읽은 bundle 해시와 **정확히** 같아야 한다.
다르면 fail-close다 — 조용히 다른/현재/최신 manifest를 재지 않는다.

static 매핑 후보 조건은 이것뿐이다.

```text
symbol = PIT 구성 종목 심볼
is_listed = true
is_ordinary_common = true
effective_from <= formation_session
effective_to IS NULL OR formation_session < effective_to
```

**여기서 보지 않는 것**: `usable_from_session` · `resolved_usable_session` ·
`qv_identity_evidence` · `qv_sec_filings`. 전부 5A-3의 책임이다.

상태 어휘는 production PIT identity resolution과 **의도적으로 다르다.**

```text
MAPPED             활성 상장 ordinary class 매핑이 정확히 하나 + manifest issuer 하나
UNMAPPED           그 formation에 적격 static class 매핑이 없다
AMBIGUOUS_MAPPING  둘 이상이거나 소유 충돌·구간 모순 등으로 결정론적 매핑을 세울 수 없다
```

**승자를 고르지 않는다.** precedence·최신 행 선택·ticker 휴리스틱·수동 override가 없다.
사유는 열거값이라 집계할 수 있다.

```text
NO_CLASS_MAPPING_FOR_SYMBOL     심볼에 대한 class 매핑이 manifest에 없다
CLASS_NOT_ACTIVE_AT_FORMATION   매핑은 있으나 그 formation에 활성이 아니다
CLASS_NOT_LISTED_ORDINARY       활성이지만 상장 ordinary common이 아니다
ISSUER_MAPPING_MISSING          class는 잡혔는데 참조된 issuer가 manifest에 없다
MULTIPLE_CLASS_MAPPINGS         적격 class 매핑이 둘 이상이다
CONTRADICTORY_MANIFEST_STATE    구간이 겹치거나 한 class가 두 issuer에 걸린다
```

**같은 issuer가 여러 S&P 500 종목으로 나타나는 것은 매핑 오류가 아니다.**
security 행은 그대로 두고 issuer 단위 묶음을 따로 만든다. 그것이 나중에 Gate G를
증명할 입력이고, 여기서 **순위를 매기거나 execution security를 고르지 않는다.**

5A-2의 작업량은 inventory가 직접 준다.

```text
mapping demand = MAPPED가 아닌 고유 심볼
```

**`MAPPED`가 PIT 안전을 뜻하지 않는다.** 5A-3이 REQUIRED 증거를 materialize하면
그중 일부는 `usable_from_session` 때문에 그 formation에서 여전히 쓸 수 없을 수 있다.

구현은 `trading/backtest/qv_identity_inventory.py` 하나이고 실행 진입점은
`trading/selftest/qv_identity_inventory_run.py`다. 범용 research-run 프레임워크를
만들지 않았고 스키마도 바꾸지 않았다.

### 5A-2 — 명시 identity 증거 / manifest 확장

5A-1이 보여준 미해결 집합을 **원문 SEC 증거로** 채운다. Step 4 설계 §1.2의 구조화
증거 계약과 §1.6의 canonical prose bridge 규칙이 그대로 적용되고,
`usable_from_session`은 REQUIRED 증거에서 파생한다.

**5A-1의 결과를 보고 identity 규칙을 바꾸지 않는다.** coverage가 아쉽다고 fuzzy
매칭이나 수동 예외를 만들지 않는다 — 그것이 정확히 Follow-up 9가 닫은 자리다.

### 5A-3 — production ingest → identity materialization → PIT usability → 나머지

SEC/evidence ingest가 먼저다. 그것이 있어야 manifest가 materialize되고,
`usable_from_session`이 REQUIRED 증거에서 파생되며, **그때부터 Step 4의 PIT identity
계약이 정본이 된다.** 이어서 accounting · shares 관측 · 사건 탐색 · boundary · C3 ·
class/issuer ME를 Step 4 계약대로 실제 데이터에 돌린다. 이 단계가 되어야 §11 issuer
market equity가 실제 숫자를 갖는다.

**5A-1의 `MAPPED`가 여기서 PIT로 걸러질 수 있다.** 두 측정은 다른 질문이고 서로를
대신하지 않는다.

### 5B — snapshot · coverage_start · Gate A~H · sentinel

Step 4 설계 §12가 이미 Step 5 소유로 못박은 것들이다. 최종 formation snapshot ·
accounting과 issuer ME의 join · Q/V raw value · 백분위 랭크 · 50:50 QV score ·
상위 20% 선택 · execution security 선택 · `coverage_start` · Gate A~H 판정 ·
look-ahead audit/sentinel · 수익률.

---

## 2. 이 단계가 하지 않는 것

**5A-1은 identity coverage를 바꾸지 않고 어떤 gate도 통과시키지 않는다.**
현재 **static 매핑** coverage를 보이게 만들 뿐이다. 미매핑과 모호가 조용히 추측되는
대신 숫자로 남는 것이 이 단계의 전부다.

**5A-1을 PIT identity resolution이라고 기술하지 않는다.** 그것은 5A-3의 일이다.

Gate A~H와 Phase 0 판정은 여전히 **평가되지 않았다.**
