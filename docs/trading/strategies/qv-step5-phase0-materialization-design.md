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

## 0. universe/bar 심볼 != SEC 경제적 심볼

**이것을 섞으면 5A 전체가 틀린 대상을 잰다.** 아래 두 절이 그 위에 서 있다.

production 과거 유니버스는 재사용된 과거 티커 일부를 `universe_membership`에 넣기 전에
**벤더 계열 코드**로 바꾼다.

```text
reconstruction -> apply_reused(...) -> universe_membership
```

```text
ABI  -> ABI_OLD1     FOXA -> TFCFA      MON  -> MON_OLD
FOX  -> TFCF         SNDK -> SNDK_OLD   SUN  -> SUN1       CC -> CCTYQ
```

오른쪽 값은 **시장 데이터 계열 locator**다. SEC 경제적 거래 심볼이 아니고 SEC 표지에
실릴 수도 없다. manifest는 SEC 경제적 identity 정본이므로 그 코드를 **담지 않는다** —
담게 하는 것이 해답이 아니다.

그래서 5A는 두 값을 끝까지 구분해서 들고 다닌다.

```text
member_symbol / data_symbol   universe_membership에 저장된 심볼 = 시장 데이터 계열
identity_symbol               SEC identity / manifest 조회에 쓰는 실제 거래 심볼
```

```text
평범한 구성원 행       member_symbol == identity_symbol
명시로 다시 쓰인 행    member_symbol = vendor_symbol,  identity_symbol = 원 심볼
                       예: member TFCFA / identity FOXA
```

`symbol_bridge_kind`는 고정 어휘 둘뿐이다 — `DIRECT` · `REUSED_VENDOR_SERIES`.
**신뢰도 점수를 만들지 않는다.**

### 다리의 정본

`trading/universe/reused-tickers.csv` **하나뿐이다**(`backtest/qv_symbol_bridge.py`).
원 심볼을 이렇게 유도하지 않는다.

```text
접미사 떼기 · `_OLD` 관례 · 현재 ticker 조회 · 이름 매칭 · fuzzy 매칭 ·
임의의 벤더 코드 해석
```

`SUN1` · `CCTYQ` · `TFCFA` · `MIICF`가 접미사 휴리스틱이 정본이 될 수 없다는 것을 그대로
보여준다. **정확한 매핑 줄이 권한이다.**

파일의 grain은 `(원 심볼, valid_from) → 벤더 계열`이다. QV의 역방향 해석은 멤버십 구간
정체성을 그대로 뒤집는다.

```text
(vendor_symbol, valid_from) -> identity_symbol
```

**fail-close 조건**은 넷이다 — 역관계가 모호할 때(같은 `(계열, 구간)`이 두 원 심볼을
가리킴) · 한 심볼이 원 심볼이면서 동시에 벤더 계열일 때 · 자기 자신을 가리킬 때 ·
**벤더 계열로는 아는데 그 구간에 대한 명시 줄이 없을 때.** 마지막 것을 자기 자신으로
되돌리면 벤더 코드가 SEC 심볼로 조용히 새어 나간다. 매핑에 벤더 계열로 아예 없는 심볼의
identity 심볼은 자기 자신이다.

### provenance — identity 증거가 아니다

실행 산출물은 그 실행에 쓴 매핑의 **내용 해시**를 남긴다.

```text
reused_series_source            trading/universe/reused-tickers.csv
reused_series_source_version    reused-tickers-sha256:<64 hex>
```

**이것은 SEC identity bundle의 일부가 아니다.** universe/market-data 심볼 provenance일
뿐이고, 산출물의 `symbol_bridge` 블록이 그 문장을 직접 들고 다닌다. 5A-2는 이 두 칸이
비면 fail-close다 — 어느 재사용 매핑을 거쳐 만든 수요인지 모르면 제안의 대상이 무엇인지
모른다.

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
symbol bridge        = reused-tickers.csv 하나 (§0)
```

**`universe_membership` 스키마를 바꾸지 않는다.** 저장된 심볼을 그대로 읽되
`valid_from`·`valid_to`를 함께 들고 와서 `(member_symbol, valid_from)`으로 경제적 심볼을
푼다 — 구간 정체성이 다리의 grain이라 심볼만 `DISTINCT`로 뽑으면 그것을 물어볼 수 없다.
**manifest 조회는 푼 뒤의 `identity_symbol`로만 한다.**

security 행의 모양은 이렇다.

```text
formation_session · member_symbol · identity_symbol · symbol_bridge_kind
                  · status · class_id · issuer_id · reason
```

issuer 묶음은 추적을 위해 `member_symbols`와 `identity_symbols`를 둘 다 남기되,
**identity 판정 자체는 경제적 심볼로 이미 끝나 있다.**

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

5A-2의 작업량은 inventory가 직접 준다. **작업 단위는 경제적 심볼 하나가 아니다.**

```text
mapping demand work item = MAPPED가 아닌 고유 (member_symbol, identity_symbol)
```

같은 티커를 서로 다른 발행사가 겹치지 않는 기간에 쓸 수 있고, 그 episode를 가르는 것이
데이터 계열 심볼이다. **경제적 심볼 하나로 뭉개면 옛 발행사와 새 발행사가 하나의
`selected_cik`로 밀려 들어간다.**

```text
member TFCFA / identity FOXA   2008~2018 formations   옛 발행사 · 옛 계열
member FOXA  / identity FOXA   2019~2026 formations   새 발행사 · 새 계열
```

고유 경제적 심볼 수도 함께 적는다 — 둘은 다른 숫자이고 둘 다 사실이다.

**`MAPPED`가 PIT 안전을 뜻하지 않는다.** 5A-3이 REQUIRED 증거를 materialize하면
그중 일부는 `usable_from_session` 때문에 그 formation에서 여전히 쓸 수 없을 수 있다.

구현은 `trading/backtest/qv_identity_inventory.py`와 다리 하나
(`trading/backtest/qv_symbol_bridge.py`)이고 실행 진입점은
`trading/selftest/qv_identity_inventory_run.py`다. 범용 research-run 프레임워크를
만들지 않았고 스키마도 바꾸지 않았다.

### 5A-2 — 명시 identity 증거 / manifest 확장

5A-1이 보여준 미해결 집합을 **원문 SEC 증거로** 채운다. Step 4 설계 §1.2의 구조화
증거 계약과 §1.6의 canonical prose bridge 규칙이 그대로 적용되고,
`usable_from_session`은 REQUIRED 증거에서 파생한다.

**5A-1의 결과를 보고 identity 규칙을 바꾸지 않는다.** coverage가 아쉽다고 fuzzy
매칭이나 수동 예외를 만들지 않는다 — 그것이 정확히 Follow-up 9가 닫은 자리다.

#### 승인 정책 — B

```text
발견(discovery)은 넓게, 증명(proof)은 좁게.
```

후보 CIK와 후보 filing을 찾는 층은 넓어도 된다. **아래 다섯이 실제로 배선된 전부다.**

```text
CURRENT_TICKER_FILE     company_tickers.json
EXISTING_CIK_OVERRIDE   edgar.CIK_OVERRIDES
BROWSE_EDGAR            edgar.resolve_by_browse           (--browse)
HISTORICAL_NAME_LOOKUP  edgar.resolve_by_name             (--historical)
PREDECESSOR_HINT        edgar.find_predecessor            (--historical)
```

그러나 **production identity로 들어가는 것은 명시 SEC 증거뿐이다.** 세 층의 권한이
다르고, 이름이 그 경계를 계속 말해야 한다.

```text
DISCOVERY_HINT   어디를 볼지 가리킨다.        production identity가 아니다.
SEC_PROOF        원문이 실제로 말한 것.        제안의 근거가 된다.
PRODUCTION_MANIFEST  사람이 승격시킨 것.       trading/qv/identity/*.jsonl
```

`AUTO_PROVABLE`은 **"승인된 규칙 아래 SEC 증거가 기계적으로 완결돼 보인다"**는 뜻일
뿐이고 manifest가 이미 바뀌었다는 뜻이 **아니다.** 자동 승격은 없다.

#### 5A-2a — 제안 후보 발견

5A-1의 static 매핑 수요(작업 항목 → 요구 formation 세션)를 받아 항목마다 후보 CIK를
모은다. 후보가 0개면 `UNRESOLVED`, 둘 이상이면 `CIK_CONFLICT`로 **증명을 시도하지
않는다** — 어느 등록인의 표지를 읽어야 하는지가 정해지지 않은 상태에서 읽으면 그 선택
자체가 근거 없는 판정이 된다.

> **모든 SEC 발견·증명은 `identity_symbol`로 한다.** `company_tickers.json` · browse ·
> 구간 이름 색인 · 표지 `TradingSymbol` 대조 전부 그렇다. `TFCFA`를 과거 거래소
> 티커인 것처럼 SEC에서 **절대 찾지 않는다** — 벤더 코드는 SEC 표지에 실릴 수 없으므로
> 그것으로 대조하면 언제나 `SYMBOL_NOT_ON_COVER_PAGE`다. `member_symbol`은 어느
> episode의 수요인지를 가르는 데만 쓰이고 SEC에 던져지지 않는다.

**층 순서는 `edgar.collect`와 같다.** 3층(구간 이름 색인)은 앞 층이 빈손일 때만 돌고,
선행 등록인은 후속이 하나로 정해졌고 **그 후속의 제출이 멤버십 구간 앞부분을 덮지
못할 때만** 찾는다. 항상 돌리면 건강한 종목까지 동명 등록인과 부딪혀 전부
`REVIEW_REQUIRED`가 되고, 그러면 1층이 무의미해진다.

**`REUSED_VENDOR_SERIES` 항목만 예외다.** 그 행이 벤더 계열로 다시 쓰인 이유가 바로
"그 구간의 그 티커는 지금 주인의 것이 아니다"이므로, 현재 ticker 파일의 답은 구조적으로
**다른 경제적 사용**에 대한 것이다. 1층에 멈추면 옛 episode가 조용히 지금 주인의 CIK를
받는다. 그래서 3층을 함께 돌리고 둘이 갈리면 `CIK_CONFLICT`로 사람에게 넘긴다.

그래도 발견이 현재 티커 계열 출처(`CURRENT_TICKER_FILE` · `BROWSE_EDGAR` ·
`EXISTING_CIK_OVERRIDE`)뿐이면 `REUSED_SERIES_ONLY_CURRENT_TICKER_CANDIDATE`가 붙어
**기계적 완결이 되지 못한다.** 구간 증거가 다 들어와도 마찬가지다 — 지금 주인의 표지로
옛 economic identity를 완결시키면 그것이 정확히 이 fix가 막는 사고다. `DIRECT` 항목의
판정은 그대로이고 회귀가 아니다.

historical 입력은 **이미 있는 명시 source**를 쓰되 **두 칸의 키가 다르다.**

```text
names  identity_symbol -> 그 구간의 회사 이름   trading/universe/<index>-changes.csv
spans  member_symbol   -> 그 데이터 계열의 구간 universe_membership (5A-1 명시 source)
```

이름을 경제적 심볼로 찾는 이유는 지수 공고가 `FOXA`라고 적지 `TFCFA`라고 적지 않기
때문이고, 구간을 데이터 계열 심볼로 찾는 이유는 그것이 재사용 episode를 이미 갈라
놓았기 때문이다. **경제적 심볼로 구간을 묶으면 서로 다른 발행사의 구간이 하나의
`MIN(valid_from)`/`MAX(valid_to)`로 합쳐진다.** 지금 ticker 주인의 이름으로 과거를
추정하지 않고, 새 회사 이름 source도 새 fuzzy resolver도 만들지 않는다.

선행 등록인이 나오면 그것은 그대로 `SUCCESSOR_JUDGEMENT_REQUIRED`다 — 과거와 현재
등록인 중 어느 쪽이 그 자리의 회사였는지는 기계가 고르지 않는다.

#### 5A-2b — SEC proof packet

확정된 CIK의 정기보고서 표지에서 **정확한 dei local name만** 읽는다
(`Security12bTitle` · `Security12gTitle` · `TradingSymbol` ·
`EntityCommonStockSharesOutstanding`).

> **나중 문서가 더 오래된 상태를 증명할 수 있다.** Step 4의 CLOSED 계약이 그것이고,
> 5A-2는 static identity 증거를 모으는 단계다. 그래서 **수리 시각이 요구 formation보다
> 늦다는 이유로 문서를 거르지 않는다.** 그 증거를 과거 formation에서 실제로 쓸 수
> 있었는지는 5A-3이 REQUIRED 증거에서 `usable_from_session`을 파생시켜 가른다.
> 여기서 두 번째 look-ahead 규칙을 만들지 않고 `usable_from_session`을 지어내지도
> 않는다. 문서의 자연스러운 SEC 증거 정체성을 그대로 보존한다.

```text
보통주 여부는 member 이름이 아니라 EntityCommonStockSharesOutstanding의 존재로 정한다.
```

`CommonClassAMember` 같은 이름으로 추론하면 표지의 notes·warrant 줄이 보통주로
승격된다. 반대로 제목·심볼만 있는 줄은 `REGISTERED_NOT_PROVED_COMMON`으로 남고
class 제안이 되지 않되, **조용히 사라지지 않고** packet의 질문으로 남는다.

등록인이 아닌 entity의 context(자회사 co-registrant 블록)는 제외하고, class 축 말고
다른 축이 붙은 표지 fact는 **버리지 않고 anomaly로 적는다** — 조용히 버리면 census가
빈 채로 완결돼 보인다.

**표지는 class의 유효구간을 증명하지 않는다.** `effective_from`/`effective_to`는
5A-2b에서 추론하지 않고, 명시 증거가 따로 들어올 때만 채워진다. 그래서 실제 SEC
표지만으로는 대부분 `CLASS_INTERVAL_NOT_EXPLICIT`가 붙은 `REVIEW_REQUIRED`가 된다.
**이것은 결함이 아니라 계약이다.**

#### 5A-2c — 판정과 manifest 승격

사람이 packet을 읽고 `trading/qv/identity/*.jsonl`에 반영하는 단계다. 구간 증거를
붙이는 것도, 승계·재편 판정도, 제안 id(`prop-<cik>-<member>`)를 정식 `class_id`로
바꾸는 것도 여기서 한다. **5A-2a/b는 이 파일들을 읽지도 쓰지도 않는다.**

#### 상태 어휘 — 정확히 셋

```text
AUTO_PROVABLE     승인된 규칙 아래 SEC 증거가 기계적으로 완결됐다(승격은 아니다)
REVIEW_REQUIRED   증거가 있으나 사람의 판정이 필요하다
UNRESOLVED        증명을 시작할 후보조차 없다
```

**이 셋뿐이다.** 이번 fix가 사유 코드
`REUSED_SERIES_ONLY_CURRENT_TICKER_CANDIDATE` 하나를 더했을 뿐 상태 어휘는 그대로다.

#### 입력 provenance — fail-close

5A-2는 5A-1 산출물의 **semantic source 정체성을 전부** 받아 그대로 들고 다닌다.

```text
stage == "5A-1"       measures == "STATIC_MAPPING_COVERAGE_DEMAND"
index_name            universe_source / universe_source_version
calendar_source       calendar_source_version
identity_source_version
reused_series_source  reused_series_source_version        (§0 — identity 증거가 아니다)
```

securities 행도 `member_symbol` · `identity_symbol` · `symbol_bridge_kind`를 다 들고
있어야 한다. `symbol` 하나만 들고 있던 이 구분 이전의 5A-1 산출물은 **받지 않는다** —
그것을 조용히 받으면 벤더 코드가 SEC 심볼로 새어 나간다.

하나라도 비면 멈춘다. **버전을 추측하지 않고, 빠진 값을 지금 DB에서 캐다 채우지도
않는다** — 그러면 어느 유니버스를 상대로 만든 제안인지 알 수 없게 된다. inventory 파일
경로는 부가 provenance일 뿐 이 필드들을 대신하지 못하고, 산출물의 `demand_provenance`가
그것을 그대로 재현한다.

구현은 `trading/backtest/qv_identity_proposals.py`이고 실행 진입점은
`trading/selftest/qv_identity_proposal_run.py`다. 스키마를 바꾸지 않았고 SEC HTML
본문을 DB에 넣지 않는다. **coverage를 늘리려고 문턱을 낮추지 않는다** — 이 단계의
목적은 상태 어휘가 실제 filing에서 옳게 갈리는지를 확인하는 것이지 숫자를 키우는
것이 아니다.

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
