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

**B는 두 짝으로 이루어진다.** 하나는 증거를 모으는 방식이고 하나는 승격 경계다.

```text
발견(discovery)은 넓게, 증명(proof)은 좁게.
승격(promotion)은 상태가 정한다 — 보편적 사람 승인이 아니다.
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
PRODUCTION_MANIFEST  승격된 것.               trading/qv/identity/*.jsonl
```

**승격은 5A-2c에서만 일어난다.** 승격이 사람의 손을 거치는지 아닌지는 packet의
**상태가 정한다** — 바로 아래 절이 그 경계다.

> **economic identity 승격은 XBRL binding 완결성과 무관하다.** QName -> class는
> production identity 관계가 아니라 accession 단위 파생 관측이다(Step 4 §1.4).
> K/Q member를 아직 못 묶는 economic class package도 `AUTO_PROVABLE`이 될 수 있다.
> 표지의 exact axis/member는 `CoverClass`에 **SEC 증명 자료**로 남지만 production
> identity 행이 되지 않는다.

`AUTO_PROVABLE`은 **"승인된 규칙 아래 SEC 증거가 기계적으로 완결됐다"**는 뜻이고
manifest가 이미 바뀌었다는 뜻이 **아니다.** **5A-2a/b에는 승격 자체가 없다** —
그 단계에서 `AUTO_PROVABLE`은 제안 상태일 뿐이다. 자동 승격의 경계는 5A-2c다.

#### 승인 경계 — 상태가 정한다

```text
AUTO_PROVABLE     5A-2c가 사람의 의미 판단 없이 승격할 수 있다(아래 fail-close 관문 통과 시)
REVIEW_REQUIRED   승격 전에 사람의 판정이 필요하다
UNRESOLVED        승격하지 않는다
```

**보편적 사람 승인이 아니다.** 모든 packet을 사람이 읽어야 한다는 규칙은 이 문서의
계약이 아니었고, 지금 명시로 못박는다 — 기계적으로 완결된 증거를 사람이 다시 읽는
것은 판단을 더하지 않고 처리량만 없앤다. 사람의 판단이 실제로 필요한 자리는
`REVIEW_REQUIRED`이고, 그 자리를 정하는 것은 사람의 재량이 아니라 **얼어붙은 SEC
증명 규칙**이다.

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

##### 표지 탐색은 요구 심볼을 알고 들어간다

**target-blind 탐색은 같은 등록인의 티커 변경에서 체계적 위음성을 만든다.**

```text
같은 등록인 CIK
  더 오래된 filing -> TradingSymbol OLD
  더 최신 filing   -> TradingSymbol NEW
work item identity_symbol = OLD
```

"표지에 class fact가 있으면 그것"으로 멈추면 최신 NEW 표지를 돌려주고, 대조는 그
뒤에야 일어나 `SYMBOL_NOT_ON_COVER_PAGE`가 난다. **OLD를 명시로 증명하는 더 오래된
표지는 읽히지도 않는다.** fail-closed이긴 하지만 기계적으로 증명 가능한 과거 매핑을
수동 검토로 보내버리므로 5A-2b의 목적 자체를 무너뜨린다.

그래서 탐색이 `target_symbol = work_item.identity_symbol`을 받는다. 수리 시각이 늦은
것부터 결정론적으로 훑되 판정 기준이 이렇다.

```text
표지에 요구 심볼이 정확히 있다   -> 그 표지가 증명이다. 즉시 멈춘다.
다른 증권만 실려 있다            -> 더 오래된 filing을 계속 본다.
쓸 만한 표지 fact가 없다         -> 계속 본다.
```

**`proof.classes`가 비어 있지 않다는 이유만으로 멈추지 않는다.** 대조 함수는
`cover_classes_for_symbol` 하나이고 제안 판정이 쓰는 것과 **같은 함수**다 — 둘이
갈리면 "증명으로 고른 표지"와 "증명으로 인정하는 표지"가 달라진다. 정규화는 manifest
prose 계약의 `prose_key` 하나뿐이고 **fuzzy ticker 매칭이 없다.**

##### 탐색 지평 — 임의의 상한이 없다

옛 `DEFAULT_MAX_PROOF_ATTEMPTS = 3`을 **없앴다.** 과거 티커가 "현재로부터 네 번째·
스무 번째 제출"이라는 이유로 증명 불가가 되면 안 된다. 정확한 증명을 찾거나 적격 제출
이력이 바닥날 때까지 보고, 찾는 즉시 멈춘다.

**신뢰도 점수·연도 cutoff·사용자 조절 correctness 문턱을 만들지 않는다.** 성능
최적화는 탐색 결과가 정확히 같을 때만 허용한다. **formation cutoff를 되살리지
않는다** — 나중 SEC 문서가 더 오래된 경제적 상태를 증명할 수 있고, 그것을 그때 쓸 수
있었는지는 5A-3의 `usable_from_session`이 가른다.

대가는 SEC 호출이다. 표지 XBRL이 아예 없는 옛 등록인은 이제 제출 이력 전체를 훑는다
(실측: LEH 3건 → 53건). **그 값으로 사는 것은 "최신 3건에 표지가 없다"가 아니라
"이 등록인의 어느 정기보고서도 그 심볼을 증명하지 않는다"라는 결정론적 사실이다.**

##### 못 찾았을 때 — 무관한 표지를 증명으로 삼지 않는다

```text
NO_PERIODIC_FILINGS                 정기보고서가 없다
NO_COVER_FACTS                      어느 filing도 표지 class fact를 만들지 못했다
NO_EXPLICIT_COVER_SYMBOL_ANYWHERE   class fact는 있으나 어느 표지도 제목·심볼을 싣지
                                    않았다 (2019 표지 XBRL 의무화 이전 서명)
NO_TARGET_SYMBOL_COVER_PROOF        다른 증권은 명시로 증명되는데 요구 심볼이 없다
```

뒤의 둘은 제안의 **사유 코드**로도 남는다(`NO_TARGET_SYMBOL_COVER_PROOF`, 그리고
pre-inline 모양이면 `PRE_INLINE_XBRL_NO_EXPLICIT_BRIDGE`가 함께). 현재 심볼의 무관한
표지를 그 심볼의 canonical proof로 돌려주지 않는다.

**후보 CIK가 있으면 `UNRESOLVED`로 내리지 않는다** — 후보는 여전히 DISCOVERY_HINT로
남고 제안은 `REVIEW_REQUIRED`다. 시도한 accession은 전부 provenance로 남아 검토자가
무엇을 뒤졌는지 본다.

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

##### 관계마다 자기 유효구간이 필요하다

**두 production 관계의 수명은 서로 다른 PIT 사실이다.**

```text
economic class 수명   !=   prose alias 수명
```

class가 X부터 존재한다는 것은 특정 prose 철자가 **X부터 그 class를 가리켰다**는
증명이 아니다. 그래서 두 제안이 각자 `effective_from` · `effective_to` ·
`interval_proved` · `evidence`를 따로 들고 다닌다.

```text
class 구간을 alias 구간으로 복사하지 않는다.
최초/최종 관측 filing을 alias 수명으로 쓰지 않는다.
수리 시각(acceptance date)을 경제적 유효성으로 바꾸지 않는다.
```

**구간은 별도로 직렬화된 증명 객체다.** `interval_proved = true` 하나가 아니다.

```json
{
  "... 관계 칸 ...": "...",
  "interval": {
    "effective_from": "2016-04-08",
    "effective_to": null,
    "evidence": [ ... ]
  }
}
```

구간 증거를 관계 증거에 평평하게 섞지 않는다 — 섞으면 **어느 증거가 수명 경계를
증명했는지**가 사라진다. 표지 fact는 "그 filing 시점에 이 관계가 있었다"를 증명하지
경계를 증명하지 않는다. **그 fact가 REQUIRED라는 이유로 구간 증거를 대신하지 못한다.**

두 production 관계(economic class · prose alias) 모두 `AUTO_PROVABLE`이
되려면 구간 객체가 있어야 하고, 그 객체는 비어 있지 않은 증거와 **REQUIRED SEC
자연키 증거 하나 이상**을 들고 `[effective_from, effective_to)` 순서가 맞아야 한다.
`RelationInterval`은 그 조건을 만드는 자리에서 fail-close한다.

##### alias는 class 수명 밖에서 유효할 수 없다

```text
class.effective_from <= alias.effective_from
class.effective_to가 유한하면 alias.effective_to가 그것을 넘지 않는다
```

밖으로 나가면 `ALIAS_INTERVAL_OUTSIDE_CLASS_LIFETIME`으로 멈춘다. **조용히 잘라
맞추지 않는다.**

production manifest에 쓰일 관계가 자기 구간을 증명하지 못하면 나머지가 아무리
완결돼도 `AUTO_PROVABLE`이 아니다.

```text
CLASS_INTERVAL_NOT_EXPLICIT             economic class 구간이 없다
PROSE_ALIAS_INTERVAL_NOT_EXPLICIT       prose alias 구간이 없다
CANONICAL_CLASS_BRIDGE_NOT_EXPLICIT     canonical class bridge가 없다
ALIAS_INTERVAL_OUTSIDE_CLASS_LIFETIME   alias 구간이 class 수명 밖으로 나간다
```

**XBRL alias 구간 사유는 없다.** 그것은 production 관계가 아니다.

##### 모든 보통주 class에 canonical bridge가 필요하다

Step 4 §1.6의 canonical bridge는 **둘뿐**이다.

```text
SECURITY_TITLE_FACT    Security12bTitle / Security12gTitle
GOVERNING_INSTRUMENT   governing instrument의 명시 class 정의
```

`COVER_GROUP_LABEL`은 **corroborating 전용**이다. class 정체성을 세우지 못하고
**production class-ID seed도 되지 못한다.** XBRL member 이름은 alias이지 정체성이
아니다.

이 요구는 **요구된 상장 심볼만이 아니라 발행사 package의 sibling 보통주 전부**에
적용된다.

```text
Class A   Security12bTitle "Class A Common Stock" · symbol AAA · shares fact
Class B   shares fact 뿐 · 12(b)/12(g) 제목 없음 · governing instrument 정의 없음
```

이 packet은 **두 class 구간을 다 넣어도 `AUTO_PROVABLE`이 되지 않는다.** Class B에
canonical bridge가 없기 때문이고, 남는 상태는 `REVIEW_REQUIRED`다.
`CommonClassBMember` · 표지 그룹 라벨 · sibling 순서 · 티커 · 주식수 · class 글자
유사도로 "Class B"를 추론하지 않는다. 나중에 governing instrument 증거가 Class B를
명시로 정의하면 그때 canonical bridge 요건을 만족한다.

##### B1 — 표지 제목은 filing 관측이지 temporal production alias가 아니다 (**CLOSED**)

```text
Security12bTitle = "Class A Common Stock"
```

이 표지가 증명하는 것은 **그 accession이 그 증권을 그렇게 불렀다**이다. 증명하지 않는
것은 **"그 철자가 economic class 탄생부터 지금까지 유효한 alias였다"**이다.

```text
표지 제목이 있다   !=   production prose alias 행이 있어야 한다
```

그래서 표지 제목은 **자기 구간이 독립적으로 증명됐을 때만** production prose 제안이
된다.

```text
제목 있음 + cover_title_interval 있음   -> SECURITY_TITLE_FACT production 제안
제목 있음 + cover_title_interval 없음   -> CoverPageProof에만 남고 제안 행이 없다
```

구간 없는 제목은 **제안되지 않으므로 `PROSE_ALIAS_INTERVAL_NOT_EXPLICIT`도 붙지
않는다.** 애초에 production 관계가 될 자격이 없던 것에 "구간이 없다"는 가짜 사유를
만들지 않는다. 그 사유는 **실제로 제안된** production prose 관계에만 적용된다.

제목은 사라지지 않는다. `CoverPageProof`에 남아 계속 다음을 증명한다.

```text
요구 심볼 · 그 accession의 등록 증권 정체성 · filing-local 제목 ·
법적 증거 공급기가 쓰는 anchor
```

그 결과 canonical bridge가 없어져 package가 `REVIEW_REQUIRED`로 남을 수 있다.
**그것은 결함이 아니라 계약이다.**

#### 5A-2 법적 증거 공급기 (`qv_identity_legal_evidence`)

```text
SEC submission/accession 문서
      -> 명시 legal/governing 사실
      -> 구조화된 legal proof
      -> ClassEvidence
```

**읽기 전용 5A-2 경로다.** production manifest를 바꾸지 않는다. 일반 legal NLP 엔진 ·
범용 SEC 문서 창고 · LLM parser · embedding/fuzzy 검색을 만들지 않는다. 결정론적 구조
파싱과 **열거된 semantic family**뿐이다.

##### 자동 class 연결의 anchor는 정확한 N1 동일성 하나다

```text
표지에 Security12bTitle / Security12gTitle이 있고
N1(표지 증권 제목) == N1(governing class 이름)
```

다음으로는 **절대** 잇지 않는다.

```text
XBRL member 철자 · CommonClassBMember · class 글자 유사도 · sibling 순서 ·
ticker 유사도 · 액면가 유사도 · 주식수 · COVER_GROUP_LABEL · 근사 prose 유사도
```

**결과**: 제목 없는 sibling(`CommonClassBMember` + 주식수 fact)은 charter가 "Class B
Common Stock"을 정의한다는 이유로 기계적으로 연결되지 않는다. 그대로
`REVIEW_REQUIRED`다. **AUTO 비율을 올리려고 이 규칙을 약화하지 않는다.**

##### P2 — 액면가 정규화는 **연결 경계에만** 있다 (**CLOSED**)

실 pilot에서 지배적 차단 요인은 표지 제목의 액면가 수식이었다(FOXA가 가장 깨끗한
사례다 — 탐색이 거의 닫혔고 완전 snapshot이 3건인데 findings가 0이었다).

```text
표지    "Class A Common Stock, par value $0.01 per share"
charter "Class A Common Stock"
```

사용자 결정으로 **연결 판단에서만** 액면가 수식을 무시한다.

```text
전역 N1(qv_manifest.prose_key)          바뀌지 않는다
qv-class-id-v1                          바뀌지 않는다
production identity JSONL               다시 쓰지 않는다
액면가 변형                             전역 alias 동치가 **아니다**
```

**인식하는 것은 끝에 붙은 숫자 액면가 수식 하나뿐이다.**

```text
..., par value $0.01 per share      ..., par value $0.01
..., $0.01 par value per share      ..., $.01 par value
```

숫자는 Decimal로 정확히 읽는다. float도 허용 오차도 일반 통화 정규화도 없다. 다음은
**벗기지 않는다** — 맞지 않으면 P2 정규화가 아예 없고 exact N1만 남는다.

```text
no par value · without par value · stated/liquidation/redemption/conversion value ·
Series/Class 지정 · 의결권 표현 · 우선주/보통주 표현 · 괄호 법적 수식 ·
그 밖의 뒤 산문 · 종단이 아닌 par value 산문
```

**연결 규칙.**

```text
1. exact N1을 먼저 본다            cover N1 == governing N1  ->  EXACT_N1
2. 실패했을 때만 core를 본다       core designation이 정확히 같아야 한다
   한쪽만 숫자 액면가              -> 연결 허용
   양쪽 숫자 액면가가 Decimal 동일 -> 연결 허용
   양쪽 숫자 액면가가 다르다       -> 연결하지 않는다
```

**모호성은 fail-close다.** 한 표지 class가 서로 다른 governing designation 여럿에
닿거나, 같은 core가 서로 다른 숫자 액면가로 나타나거나, 같은 표지의 다른 보통주
제목이 같은 core로 줄어들면 자동 연결이 꺼진다. 문서 날짜·등장 순서·ticker·class
글자·주식수·액면가 근접도로 하나를 고르지 않는다. **exact N1이 있으면 그것이 이긴다** —
stripped core가 다른 무언가에도 맞는다는 이유로 P2 후보를 덧붙이지 않는다.

**governing 이름은 실제로 일치한 산문 그대로 보존한다.** 정규화된 core로 바꿔치지
않고, 그 자리의 액면가 원문도 함께 남긴다. 구조화된 proof가 드는 것은 다음이다.

```text
raw cover title · cover prose_key · cover 액면가
raw governing name · governing prose_key · 그 자리의 액면가 원문
association method(EXACT_N1 | NUMERIC_PAR_VALUE_SUFFIX) · designation key
```

**연결 전용 designation key는 production class-ID seed에 들어가지 않는다.**

###### 연결 동치 != production prose alias 동치

이 구분이 이 결정의 핵심이다.

```text
표지    "Class A Common Stock, par value $0.01 per share"
charter "Class A Common Stock"
```

P2가 세우는 것은 **둘이 같은 경제적 class를 가리킨다**이지 **두 철자의 temporal alias
수명이 같다**가 아니다. 그래서 P2로 연결된 class는 이렇게 나온다.

```text
governing 이름   구간이 증명되면 GOVERNING_INSTRUMENT canonical bridge가 된다
표지 제목        cover_title_interval을 자동으로 받지 못한다(B1 그대로)
                 자기 수명이 독립으로 증명되기 전에는 SECURITY_TITLE_FACT 행이 없다
class 수명       표지 제목 alias 수명으로 복사되지 않는다
```

exact N1로 연결된 경우는 지금까지와 같다 — 표지 제목이 곧 governing 이름이므로
`cover_title_interval`을 갖고 중복 `GOVERNING_INSTRUMENT` 행을 만들지 않는다.

###### governing 문서 안에서의 매칭

일반 class 이름 추출기를 만들지 않았다. 탐색 target은 여전히 **표지 증권 제목에서
결정론적으로 파생한 하나**이고, P2가 걸릴 때 그것이 core designation이 된다. 일치
자리에서는 다음을 본다.

```text
바로 앞이 더 긴 designation의 꼬리다(`Class A ` + `Common Stock`)  -> 그 class가 아니다
바로 뒤가 인식된 숫자 액면가 수식이다                              -> 원문을 함께 남긴다
바로 뒤가 값 수식처럼 보이는데 동결 문법에 없다                    -> 같다고 보지 않고 버린다
```

임의 부분문자열 매칭·fuzzy·토큰 유사도가 없다.

###### 생성기와 승격기가 같은 판정을 쓴다

연결 판정의 정의는 `associate_class_designation()` **하나**다. 5A-2 제안 생성과 5A-2c
승격 offline 재검증이 같은 함수를 돌리고, 승격기는 직렬화된 `association_method` ·
`designation_key` · 액면가 파생값을 권한으로 삼지 않는다 — **표지 제목 원문과 finding이
남긴 governing 이름·액면가 원문에서 다시 판정한다.** 직렬화된 칸은 receipt이고,
그것이 재판정과 어긋나면 `assert_proof_integrity()`가 fail-close한다.

P2는 **탄생·snapshot·종료 규칙을 하나도 바꾸지 않는다.** 정의 != 탄생, open-ended는
탄생 + current 완전 snapshot + COMPLETE 탐색 + 미해결 영향 없음, 종료는 명시 실행 +
명시 발효일 그대로다.

##### 탐색 지평은 선언된 form 계열이다 — 건수·연도 상한이 아니다

```text
GOVERNING_SEARCH_FORMS = 8-K 계열 · 10-K 계열 · 10-Q 계열
```

그 지평 안의 **모든** accession header 색인을 읽고 후보 문서를 하나도 건너뛰지 않는다.
`최근 3건` · `최근 5년` · `최신 charter만`을 correctness 규칙으로 쓰지 않는다.

지평 밖 form에만 존재하는 governing instrument는 이 증분의 **선언된 한계**이고 proof의
`accessions_outside_horizon`에 수량으로 남는다 — 조용히 흡수하지 않는다.

##### 후보 discovery — 구조화된 metadata의 정본은 header 색인이다

**`index.json`의 `type`은 문서 종류가 아니라 아이콘 이름이다**(`text.gif`). 문서별
`<TYPE>`(`EX-3.1`)·`<FILENAME>`·`<SEQUENCE>`와 8-K `<ITEMS>`는 accession의 SGML header
색인(`<accession>-index-headers.html`)에만 구조화돼 있다.

```text
선언된 종류가 Exhibit 3 계열   -> governing exhibit 후보
8-K이고 ITEMS에 5.03이 있다    -> 그 8-K의 primary(SEQUENCE 1) 문서도 후보
```

**전시번호를 문자열 prefix로 비교하지 않는다.** `EX-3`으로 startswith 비교를 하면 SOX
인증서 `EX-31.1`·`EX-32.1`이 전부 governing 후보가 되고 분류에 실패해 멀쩡한 등록인이
통째로 INCOMPLETE가 된다(실측: ABMD 385 accession 중 102건).

discovery는 힌트일 뿐 **권위가 아니다.** 파일명에 `charter`가 있다는 이유로 문서가
권위를 갖지 않는다 — 본문이 아래 semantic 규칙을 만족해야 한다.

##### filing 서술은 governing instrument가 아니다

**discovery와 proof authority는 다른 축이다.**

```text
실제 Exhibit 3 문서        -> 본문 분류 뒤 법적 증명 권한을 갖는다
Item 5.03 PRIMARY 8-K      -> filing 서술 / discovery / corroborating receipt 전용
                              GOVERNING_CLASS_DEFINITION · CLASS_BIRTH_ACTION ·
                              CLASS_BIRTH_EFFECTIVE_DATE · CURRENT_GOVERNING_SNAPSHOT ·
                              CLASS_TERMINATION_EFFECTIVE_DATE · PROSE_ALIAS_LIFETIME을
                              **하나도** 만들지 못한다
```

`우리는 Certificate of Amendment를 제출했다`라고 말하는 서술은 그 instrument가
**아니다.** 첨부물 이름을 말한다는 이유로 economic identity 사실을 파싱하지 않는다.
권한 판정은 선언된 문서 종류 하나로 정해지고(`document_proof_authority()`) 그 정의는
코드에 한 곳뿐이다 — 수집기와 투영기가 같은 함수를 쓴다.

**Item 5.03은 정관이 바뀌었다는 구조화된 신고다.** 그 accession에 주소 지정 가능한
Exhibit 3이 하나도 없으면 그 governing 변경을 읽을 길이 없으므로
`governing_exhibit_missing` 탐색 실패다. primary 서술로 대신하지 않는다. 이 증분에서
embedded 문서 parser를 만들지 않는다.

`classify_document()`는 첫 일치 하나만 돌려주므로 bylaws를 먼저 말하고 charter
amendment를 나중에 말하는 서술은 뒤가 조용히 사라진다. 그래서 문서가 언급한 family
**전부**를 `classification_families`로 함께 남긴다. 어느 쪽도 governing instrument
증명이 되지 않지만 무엇을 봤는지는 receipt에 남아야 한다.

##### 탐색 closure — COMPLETE / INCOMPLETE

`COMPLETE`는 선언된 지평이 요구하는 모든 accession/문서를 실제로 열거하고 모든
governing 후보를 받아 분류했다는 뜻이다. 다음 중 하나라도 있으면 `INCOMPLETE`다.

```text
submissions archive 실패 · accession header 색인 실패 · 후보 문서 fetch 실패 ·
열거된 family로 분류할 수 없는 **증명 권한 있는** 후보 ·
Item 5.03인데 주소 지정 가능한 Exhibit 3이 없다 · 파일 이름 없이 선언된 문서
```

분류 실패는 **증명 권한이 있는 문서**에만 탐색 실패다. 권한 없는 서술이 열거된 family에
안 맞는 것은 그 자체로 증거 공백이 아니다 — 진짜 공백은 `governing_exhibit_missing`이
잡는다.

마지막이 **2001년 이전 flat layout**이다. 그 시기 accession은 문서를 개별 파일로 두지
않아 문서 자연키로 가리킬 수 없다. 후보가 0건인 것과 구분해 `legacy_layout` 실패로
적는다 — 조용히 넘어가면 그 시기 governing instrument를 하나도 안 본 채 무기한 수명이
만들어진다.

##### 열거된 legal semantic family

**명시 역할 텍스트에서만 나온다.** 토큰 창 점수 · 최근접 날짜 · "가장 그럴듯한 class"를
쓰지 않는다. block 분해는 `qv_events.html_blocks`를 그대로 쓴다.

```text
class 정의   authorized to issue ... shares of <NAME>
             ... divided into ... <NAME> ...
             ... designated <NAME>
탄생 행위    hereby created/established ... <NAME>
             <NAME> is hereby created/established
             new class ... designated <NAME>
             reclassified into ... <NAME>
발효일       effective as of D · shall become/became effective on D ·
             effective date of/is D · effective on D
종료         <NAME> 주식이 reclassified / eliminated / cancelled /
             (전체 class) converted — **명시로 실행된** 것만
```

단순 언급은 정의가 아니다. 맞지 않으면 `UNRESOLVED`다.

##### 법적 연대기는 operative date로만 세운다 — SEC 수리 시각이 아니다

**이미 CLOSED인 구분이 여기에도 그대로 적용된다.**

```text
governing instrument의 operative date  ->  경제적/법적 연대기
SEC acceptance                          ->  5A-3의 증거 지식 가용성
```

SEC 수리 시각은 그 증거를 **언제 알 수 있었는가**를 정하지, 그 governing 행위가
**언제 법적으로 발효했는가**를 정하지 않는다. **EDGAR가 늦게 받았다는 이유로 문서가
경제적으로 더 나중이 되지 않는다.**

그래서 이 공급기의 모든 경제적/법적 순서는 문서 본문에서 읽은 명시 operative date
하나에서 나온다. 다음은 **순서 근거로 쓰지 않는다.**

```text
acceptance_datetime · acceptance date · filed date · accession 순서 · report date
```

그것들은 provenance로 receipt에 그대로 남고 5A-3의 지식 가용성 입력이다.

operative date는 문서 수준 사실 하나다(`governing_operative_date()`). 기존 좁은
`EFFECTIVE_DATE_PATTERNS`를 그대로 쓴다.

```text
명시 발효일 하나        -> RESOLVED   그 문서의 법적 as-of가 정해진다
하나도 없다             -> MISSING    그 문서의 법적 연대기는 미해결이다
서로 다른 둘 이상       -> AMBIGUOUS  법적 연대기가 모호하다
```

가장 가까운/이른/늦은 날짜를 고르지 않고 **SEC 수리 시각으로 되돌아가지 않는다.**
`CLASS_BIRTH_EFFECTIVE_DATE`와 `CLASS_TERMINATION_EFFECTIVE_DATE`도 같은 값에서
나오므로 **경제적 날짜의 원천은 문서마다 하나다.** 문서의 operative date가 있다고
class 탄생이 증명되는 것은 아니다 — 탄생은 여전히 `CLASS_BIRTH_ACTION`이 함께 있어야
한다.

##### O2 — 주(州) filing은 **instrument가 그렇게 만들 때만** 법적 시점을 세운다 (**CLOSED**)

실 pilot에서 governing exhibit의 operative-date recall이 매우 낮았다(AAPL 22/22 ·
CELG 14/14 · ABMD 9/10 MISSING). 실제 charter는 열거된 네 표현으로 자기 발효일을
말하지 않고 **주 filing/증명 의미론**으로 말한다. 사용자 결정으로 그 두 경로만 열었다.

**늘어난 것은 문법이지 원칙이 아니다.** 다음은 그대로다.

```text
economic/legal validity  !=  SEC knowledge availability
SEC acceptance · EDGAR 접수 · filed date · report date  ->  발효일이 아니다
signature / execution / attestation / notary / 서명일 단독  ->  발효일이 아니다
```

**직접 출처 둘 — 법적 발효를 스스로 진술한다.**

```text
EXPLICIT_EFFECTIVE_DATE          기존 좁은 EFFECTIVE_DATE_PATTERNS 그대로
STATE_CERTIFIED_EFFECTIVE_DATE   같은 authoritative Exhibit 3 안의 주 증명이
                                 effective date / effective date-time을 명시한다
```

**제출 발효 출처 하나 — 직접 진술이 없을 때만 쓰인다.**

```text
STATE_FILED_UPON_FILING   instrument가 "주 filing 기관에 제출하면 발효한다"를
                          명시하고 + **같은 문서**의 주 FILED 스탬프가 제출일 D를
                          명시하면  ->  법적 operative date = D
```

이것은 **법적 문서 안의 관계**이지 SEC 수리 폴백이 아니다. 주 스탬프가 시점을 세울 수
있는 이유는 그 instrument 자신이 제출을 발효 사건으로 만들었기 때문이다.

**주 기관 어휘는 작고 열거돼 있다.** `FILED`라는 낱말만으로는 부족하고, block이 그
기관을 명시로 말하면서 filing/증명 표지(`filed` · `do hereby certify`)를 함께 들어야
주 filing 자료로 인정된다.

```text
Secretary of State · Division of Corporations · Department of State
```

**우선순위와 모호성.**

```text
직접 발효일 하나                    -> RESOLVED (그 직접 family)
직접 발효일 둘 이상                 -> AMBIGUOUS
직접 하나 + 제출 파생 날짜가 다르다 -> AMBIGUOUS
직접 없음 + 제출 파생 하나          -> RESOLVED (STATE_FILED_UPON_FILING)
직접 없음 + 제출 파생 둘 이상       -> AMBIGUOUS
제출 발효 조항만 있고 스탬프 없음   -> MISSING
스탬프만 있고 제출 발효 조항 없음   -> MISSING
```

"가장 이른 날짜가 이긴다"를 만들지 않았다. **지연 발효**(state FILED 6/1 · 명시 발효
6/15)는 명시 발효일이 지배한다 — 그 문서에 제출 발효 조항이 없으므로 스탬프는 애초에
후보가 아니다. 문서가 제출 발효를 말하면서 다른 명시 발효일까지 들면 법이 모순이므로
`AMBIGUOUS`다.

**구조화된 proof가 출처를 드러낸다.**

```text
status · date · source_family · supporting_locators · observed
```

`source_family`는 위 셋뿐이고 신뢰도 점수가 아니다. `STATE_FILED_UPON_FILING`은 제출
발효 조항 locator와 주 스탬프 locator를 **둘 다** 남긴다 — 그래서 왜 D가 나왔는지
receipt만 보고 되짚을 수 있다. `acceptance_datetime`은 별도 provenance로 남는다.

`assert_proof_integrity()`가 이 모양을 fail-close로 잠근다 — `RESOLVED`는 날짜·동결
family·그 family가 요구하는 locator 개수를 모두 갖춰야 하고, 탄생일 finding의 locator는
그 문서 operative date의 근거와 같아야 한다. 같은 날짜를 남긴 채 출처만 바꿔치면 걸린다.

**두 번째 법적 날짜 해석기를 만들지 않았다.** `CLASS_BIRTH_EFFECTIVE_DATE` ·
`CLASS_TERMINATION_EFFECTIVE_DATE` · B2 연대기가 전부 이 하나의 구조에서 나온다.

##### governing snapshot의 발효일은 그 안 class의 탄생일이 아니다

**정의와 탄생은 다른 사실이다.**

```text
authorized to issue Class A Common Stock
this Certificate becomes effective on 2020-01-01
```

이것이 증명하는 것은 둘이다.

```text
그 snapshot에 Class A가 정의돼 있다
그 snapshot이 2020-01-01에 operative하다
```

증명하지 **않는** 것은 하나다.

```text
Class A가 2020-01-01에 만들어졌다
```

class는 나중 amended-and-restated certificate보다 수십 년 앞설 수 있다. 그래서
`CLASS_BIRTH_EFFECTIVE_DATE`는 그 class를 실제로 세우는 **명시 실행 행위**
(`CLASS_BIRTH_ACTION`)가 같은 instrument에 있고 operative date가 그 행위에 모호함 없이
묶일 때만 나온다. 완전 restatement의 발효일 단독 · snapshot 발효일 · 수리 시각 ·
filed date · 최초 관측을 탄생일로 쓰지 않고 가까운 날짜를 고르지도 않는다.

원본 governing instrument도 그 언어가 명시로 있을 때만 탄생을 증명한다. **결과적으로,
정의만 든 restatement가 둘이어도 그 발효일들은 탄생일 후보가 아니므로 서로 충돌하지
않는다.**

**경제적 발효일로 쓰지 않는 것**: SEC 수리 시각 · filed date · accession 날짜 · report
date · 서명일 단독 · 최초 관측 filing · 최초 XBRL 등장 · 최초 ticker 등장.

**instrument의 발효일은 문서 수준으로 정확히 하나여야 한다.** 둘 이상이면 어느 것이 그
행위의 발효일인지 기계로 정할 수 없으므로 아무것도 증명하지 못한다.

명시 미실행 표현(제안 · 승인 대기 · 장래 의사 · 주주총회 대기 · 기준일 · 공고)이 있는
block은 어떤 finding도 만들지 못한다.

**종료가 아닌 것**: ticker 소멸 · 주식수 0 · 피인수 · 나중 표지에서의 부재 · 현재 SEC
메타데이터의 부재. 넓은 합병 종료 parser는 이 증분에 없고, 과거 피인수·상장폐지 사례는
`REVIEW_REQUIRED`로 남아도 된다.

##### B2 — 탄생 증거만으로는 `effective_to = null`이 되지 않는다 (**CLOSED**)

```text
명시 탄생일 + 발견된 종료 없음   =>   effective_to = null      **금지**
```

**종료를 못 찾았다는 것은 연속성의 증거가 아니다.** open-ended economic lifetime은 다섯
조건을 **전부** 만족할 때만 나온다. C3가 이미 쓰는 fail-close continuity 철학과 같다.

```text
A  명시 CLASS_BIRTH_ACTION + 거기 묶인 operative date가 정확히 하나
   (탄생일이 충돌하면 UNRESOLVED)
B  current-in-effect **완전** governing snapshot이 그 정확한 N1 class를 정의하고,
   그 snapshot 뒤에 governing amendment가 없다
C  governing amendment 탐색이 COMPLETE
D  탄생 이후 모든 governing 후보의 class 영향이 해소됐다
E  명시 종료가 없다 (있으면 effective_to = 그 종료일이다)
```

**B의 뒷부분이 핵심이다 — amendment는 complete snapshot이 아니다.** 가장 늦은 완전
snapshot 뒤에 governing amendment가 하나라도 있으면 그 snapshot은 현재 상태를 닫지
못하므로 open-ended continuity는 `UNRESOLVED`다. 그 amendment가 대상 class 정의를
되풀이한다는 이유로 snapshot을 "현재"로 올려주지 않는다 — 그러면 Certificate/Articles
of Amendment를 complete snapshot으로 승격하는 셈이다. 그 상태를 흡수한 **나중 완전
restated snapshot**이 나와야 다시 열린다.

**"뒤"는 법적 operative date로 센다.** 예컨대

```text
restated snapshot   법적 2020-05-15 / SEC 수리 2020-07-01
amendment           법적 2020-06-01 / SEC 수리 2020-06-03
```

수리 순서로는 amendment가 앞이지만 **법적으로는 뒤다.** 그러므로
`effective_to = null`은 막힌다. 반대로 법적으로 앞인 amendment는 SEC가 나중에
받았더라도 나중 완전 snapshot이 흡수할 수 있다.

##### 연대기가 없거나 모호하면 fail-close다

open-ended continuity에 필요한 governing 문서 중 하나라도 유일한 명시 operative date가
없으면 자동 open-ended는 `UNRESOLVED`다. **SEC timestamp로 순서를 추론하지 않는다.**

두 governing 문서의 operative date가 같고 그 선후가 B2 결과를 바꾸면 그 연대기는
미해결이다.

```text
같은 날짜의 완전 snapshot이 둘  -> 어느 것이 current인지 정할 수 없다
amendment가 snapshot과 같은 날  -> 앞인지 뒤인지 정할 수 없다
탄생일과 같은 날의 미해소 문서  -> 탄생 앞뒤를 정할 수 없다
```

**accession tie-break를 만들지 않는다** — 그것은 semantic 순서가 아니다. 결정론적
자연키 정렬은 직렬화·표시에만 쓴다.

유한 명시 종료는 그 독립된 규칙(E)으로 그대로 처리된다.

D의 해소 기준이 좁다. **대상 class 이름이 없다는 것은 영향이 없다는 증명이 아니므로**,
탄생 뒤의 governing 문서는 그 class를 **명시로 정의해야만** 해소된 것으로 센다. 그래서
중간에 해석되지 않는 amendment가 하나라도 있으면 무기한 수명이 나오지 않는다.

**의도적으로 보수적이다.** 멀쩡한 등록인이 charter 이력 때문에 `REVIEW_REQUIRED`로
남아도 괜찮다. **coverage 결과로 이 규칙을 약화하지 않는다.**

##### prose alias 구간은 class 수명과 **다른** 사실이다

class 구간을 title 구간으로 복사하지 않는다. 표지 제목의 구간은 **독립된** 법적 사슬이
만든다.

```text
탄생 정의에 그 정확한 N1 이름이 있고
current 완전 governing snapshot에도 같은 정확한 N1 이름이 있고
amendment 탐색이 COMPLETE
    -> 그 이름의 open-ended 구간
```

legal class 이름이 표지 제목과 N1으로 다르면 **동등하다고 추론하지 않고** title 구간을
만들지 않는다 — 사람 눈에 아무리 관련돼 보여도 그렇다.

표지 제목과 governing 이름이 exact N1으로 같으므로 별도 `GOVERNING_INSTRUMENT` 행은
**provenance만 다른 중복 production row**다. 이 증분은 그것을 만들지 않는다. 지켜야 하는
불변식은 하나다 — **class `effective_from`을 덮는, 자기 유효성이 독립적으로 증명된
canonical bridge가 최소 하나 있다.**

##### 구조화된 legal proof는 packet에 그대로 남는다

SEC 원문을 `RelationInterval`로 바꾼 뒤 **그것이 어떻게 나왔는지를 버리지 않는다.**
제안 packet에 `legal_evidence_proof`가 기계가 읽는 구조로 실린다.

```text
LegalEvidenceProof
    target cik · cover accession/document
    search status · searched accession receipt · horizon forms
    documents  (cik · accession · form · document_name · document_role ·
                acceptance_datetime · source_url · document_sha256 · classification)
    failures   (실패한 필수 source)
    classes    (cover class별 legal proof)
```

SEC HTML 본문은 넣지 않는다. semantic finding마다 결정론적 locator(`block:<ordinal>`)가
있고 `EvidenceRef.locator`가 그것을 가리킨다.

증거 역할은 정확히 이 이름들이다. 동의어를 늘리지 않는다.

```text
GOVERNING_CLASS_DEFINITION · CLASS_BIRTH_ACTION · CLASS_BIRTH_EFFECTIVE_DATE ·
CURRENT_GOVERNING_SNAPSHOT · CLASS_TERMINATION_EFFECTIVE_DATE · PROSE_ALIAS_LIFETIME
```

문서 receipt는 `classification`(첫 일치) 말고 `classification_families`(언급한 family
전부)와 `proof_authority`(`GOVERNING_EXHIBIT` / `FILING_NARRATIVE`)를 함께 남긴다.
법적 연대기 사실도 문서 자연키와 locator를 달고 여기 산다.

```text
legal_operative_status · legal_operative_date · legal_operative_locator ·
legal_operative_observed
```

`acceptance_datetime`은 같은 receipt에 provenance로 남되 **순서 근거가 아니다.**
제안 생성과 승격 재검증이 이 하나의 구조화된 연대기를 쓴다 — 두 번째 구현이 없다.

`usable_from_session`은 여기서 더하지 않는다. 5A-3이 자연키를
`qv_sec_evidence_documents`에 맞춰 풀고 knowledge availability를 파생시킨다.

##### 생성기와 승격기가 **같은 함수**를 쓴다

```text
class_evidence_from_legal_proof(legal_evidence_proof, cover_proof) -> ClassEvidence
```

5A-2 제안 생성과 5A-2c 승격 재검증이 이 순수 함수 하나를 쓴다. 두 곳이 각자 법 규칙을
들고 있으면 조용히 갈라지고, 그러면 재검증이 아무것도 확인하지 못한다.

이 함수는 저장된 **결론 칸을 믿지 않는다.** `proposal_status` · `reason_codes` ·
`interval_proved` · `search_status` · `status` · `birth_date`가 아니라
`documents` · `findings` · `failures`에서 다시 계산한다.

##### 재검증은 날짜가 아니라 **증거 provenance까지** 비교한다

production 행은 나중에 packet의 구간 증거를 합쳐 넣고, 5A-3가 그 REQUIRED 자연키에서
`usable_from_session`을 파생시킨다. **경계만 대조하면 같은 구간에 다른 증거를 끼워
넣는 변조가 통과하고 그 파생이 조용히 바뀐다.**

그래서 정규화된 `ClassEvidence` 전체를 비교한다.

```text
class_interval · cover_title_interval · extra_prose_bridges
    effective_from · effective_to
    각 EvidenceRef의 source_kind · cik · accession · document_name ·
                     evidence_role · dependency · locator
```

**순서만 결정론적으로 정규화한다.** 증거를 더하거나 빼거나 바꿔치는 것은 전부 실패이고,
중복을 지우지 않는다 — 하나를 지우면 치환을 못 잡는다. 정규 직렬화·비교 정의는 legal
증거 모듈 한 곳(`canonical_class_evidence` · `canonical_interval` ·
`canonical_evidence_refs`)에 있고 승격기가 그것을 그대로 쓴다.

같은 경계에서 구조화된 proof 자체의 정합성도 fail-close다.

```text
legal proof의 cik != 표지 증명 CIK
cover_accession != CoverPageProof.accession
cover_document_name != CoverPageProof.document_name
finding이 legal_evidence_proof.documents에 없는 문서를 가리킨다
finding의 경제적 날짜 != 그 문서의 법적 operative date
```

마지막이 **경제적 날짜의 단일 원천**을 잠근다. 생성기가 탄생일·종료일과 문서
operative date를 같은 `OperativeDate` 하나에서 만들므로, packet에서 둘이 갈라져 있으면
어느 쪽이 참인지 알 수 없다 — 고르지 않고 멈춘다.

그래서 packet에서 다음을 고쳐도 승격이 실패한다.

```text
class effective_from / effective_to · 표지 제목 구간 · governing bridge 구간 ·
구간 증거의 accession/문서/역할/locator · REQUIRED 증거 추가·삭제 ·
탐색 COMPLETE 상태 · finding의 발효일 · GOVERNING_CLASS_DEFINITION finding 삭제 ·
다른 등록인/다른 표지의 legal proof 끼워 넣기
```

**승격기는 여전히 네트워크를 부르지 않는다.** 박혀 있는 SEC 문서 SHA와 자연키를 실제
문서와 맞춰 보는 것은 5A-3 ingest의 일이다.

##### K/Q accession 안의 governing exhibit

governing instrument는 10-K/10-Q accession의 **exhibit**으로 올 수 있다. 그때 중요한 것은
그 문서의 정확한 정체성과 SHA이므로 `qv_sec_evidence_documents`에 들어간다.

```text
10-K / 10-K/A / 10-Q / 10-Q/A  PRIMARY   -> 거부 (qv_sec_filings가 filing 정본이다)
10-K / 10-K/A / 10-Q / 10-Q/A  EXHIBIT   -> 허용 (SEC_EVIDENCE_DOCUMENT)
```

**`qv_sec_filings`를 넓히지 않는다.** submission row 열거만 form 필터를 선택적으로 받고,
적재 경로는 기본값(K/Q 계열)을 그대로 쓴다.

#### 5A-2c — 승격 (**CLOSED 정책 · 승격기 코어 구현됨 · production 확장은 아직 없다**)

packet을 `trading/qv/identity/*.jsonl`에 반영하는 유일한 단계다. **5A-2a/b는 이
파일들을 읽지도 쓰지도 않는다.**

정책은 아래 일곱 줄로 얼린다. 코어 구현은 `backtest/qv_identity_promotion.py`이고,
**이 커밋에서 production manifest 행을 하나도 늘리지 않았다.**

##### 1. `AUTO_PROVABLE`은 사람의 의미 승인 없이 승격될 수 있다

기계적 완결의 기준은 얼어붙은 SEC 증명 규칙이지 사람의 재량이 아니다. 그 규칙 아래
완결된 packet을 사람이 다시 읽는 것은 판단을 더하지 않는다.

##### 2. 자동 승격 전 fail-close 관문 — 넷 다 통과해야 한다

```text
a. packet이 **정확히 그 pinned identity_source_version**에서 생성됐다
b. 현재 세 파일 manifest bundle이 **여전히 그 정확한 base version**이다
c. 증거·제안 불변식이 결정론적으로 **재검증**된다
d. REVIEW_REQUIRED / UNRESOLVED 사유나 conflict가 **하나도 없다**
```

하나라도 어긋나면 승격하지 않는다. **추측으로 메우지 않고, 부분 승격도 하지 않는다.**
재검증은 제안 생성 때 쓴 규칙을 다시 돌리는 것이지 결과를 신뢰하는 것이 아니다 —
packet은 입력이지 권한이 아니다.

##### 3. base가 바뀌었으면 새 상태에 merge하지 않는다

제안 생성 이후 manifest base가 달라졌으면 **그 새 bundle에서 다시 돌린다.** 새 상태에
대고 병합하면 어느 base에서 증명된 것인지가 사라지고, 그 순간 packet의 provenance가
거짓이 된다. **rebase가 아니라 rerun이다.**

##### 4. `REVIEW_REQUIRED`는 사람의 판정을 요구한다

구간 증거를 붙이는 것도, 승계·재편 판정도, 재사용 계열의 등록인 판정도 여기다.
제안 id(`prop-<cik>-<member>`)를 정식 `class_id`로 바꾸는 것도 사람이 한다.

##### 5. `UNRESOLVED`는 승격되지 않는다

증명을 시작할 후보조차 없는 상태다. 승격 경로가 아예 없다.

##### 6. fuzzy 추론 · 신뢰도 점수 · 휴리스틱 승격 경로를 만들지 않는다

"거의 맞다"로 넘어가는 문이 하나라도 생기면 나머지 관문이 전부 무의미해진다.

##### 7. 5A-2a/b는 읽기 전용 제안/증명 단계로 남는다

manifest를 읽지도 쓰지도 않는다. 이 경계는 자동 승격이 생겨도 바뀌지 않는다 —
제안을 만드는 코드와 승격하는 코드가 같은 자리에 있으면 "증명했으니 바로 쓴다"가
언젠가 관문을 우회한다.

##### 구현 — `backtest/qv_identity_promotion.py`

**세 파일 economic identity bundle만** 계획하고 쓴다. `xbrl_aliases.jsonl`을 다시
만들지 않는다. 실행 진입점은 `selftest/qv_identity_promotion_run.py`이고 **기본은
dry-run**이다.

```text
plan    후보 bundle을 세워 검증하고 보고만 한다. production 파일을 바꾸지 않는다.
apply   base를 다시 확인한 뒤에만 세 파일을 바꾼다.
```

`--force`도 `--skip-bad`도 없다. 한 apply에서 고른 `AUTO_PROVABLE` 중 **하나라도
실패하면 전체를 중단한다** — 조용히 건너뛰지 않는다. `REVIEW_REQUIRED`·`UNRESOLVED`는
보고만 하고 건드리지 않으며, 그것은 부분 승격이 아니라 **얼어붙은 상태 경계**다.

**`AUTO_PROVABLE`은 상태·사유 문자열로 재구성되지 않는다.** JSON의
`proposal_status`와 `reason_codes`는 입력이지 권한이 아니다. 승격기는 packet의
**구조화된 fact**에서 5A-2b의 상태 결정 규칙을 전부 다시 계산한다.

```text
작업 항목 계약   member/identity 비어 있지 않음 · symbol_bridge_kind 유효 ·
                 DIRECT면 member == identity
요구 심볼        원본 표지를 되살려 5A-2b와 **같은** 대조 함수
                 (`cover_classes_for_symbol`)로 정확히 하나 · 상장 보통주로 증명 ·
                 명시 제목 bridge 존재
발견 조건        출처 어휘 유효 · REUSED_VENDOR_SERIES인데 historical 출처가 하나도
                 없으면 자동 승격 대상이 아니다
승계 판정        `successor_judgement_required` **명시 칸**을 본다.
                 자유 문장 질문에서 추론하지 않는다
census           `class_census_status` 문자열을 믿지 않고 원본 표지에서 **같은 순수
                 함수**(`census_status`)로 다시 센다. 결과가 COMPLETE여야 한다
구간             직렬화된 `interval` 객체에서 직접 확인한다
```

두 곳이 표지를 따로 해석하면 정의가 조용히 갈라지므로 승격기는 제안기의 순수 함수를
**공유해서 쓴다**(`cover_proof_from_json` · `cover_classes_for_symbol` ·
`class_role` · `census_status`). 두 번째 조금 다른 정의를 만들지 않는다.

SEC를 다시 부르지 않는다 — 증거 수집은 5A-2b가 끝냈고 여기는 자기 일관성과 manifest
호환성만 결정론적으로 본다.

후보 bundle은 임시 디렉터리에 완전한 세 파일로 세우고 **정본 `load_manifest()` ·
`validate()`로** 검사한다. private 정규화 헬퍼를 production 계약으로 쓰지 않는다.

**append/reuse 전용이다.**

```text
할 수 있다   정확히 같은 issuer/class/alias 재사용 · 진짜 새 관계 추가
할 수 없다   기존 issuer CIK 변경 · class_id 개명 · effective_from 변경 ·
             effective_to 늘이기/줄이기 · 심볼 교체 · 기존 REQUIRED 증거 수정 ·
             provenance를 위해 기존 행에 REQUIRED 증거 추가 · 행 삭제 · 과거 구간 재작성
```

마지막 것이 특히 중요하다 — 기존 행에 REQUIRED 증거를 더하면 그 행의 파생
`usable_from_session`이 바뀔 수 있다. 기존 semantic 행을 바꿔야 하면 **fail-close**다.

정확히 같은 semantic 관계는 재사용·중복제거하고, **같은 semantic key가 다른 내용이면
fail-close**다. 같은 상장 심볼이 겹치는 구간에 두 class를 가리켜도 fail-close이고
tie-break를 두지 않는다.

##### 계획은 base + 이번 batch의 전망 상태 위에서 돈다

한 batch의 packet들은 **하나의 누적된 전망 상태**에 대고 해석된다. packet 하나를
계획할 때마다 그 행들이 상태에 합쳐지고 다음 packet은 그 위에서 풀린다.

```text
A와 B가 정확히 같은 production issuer/class/alias를 말한다
  -> 앞 packet이 추가하고 뒤 packet은 **이미 계획된 관계를 재사용한다**
같은 semantic key인데 내용이 다르다
  -> 고른 batch 전체가 실패한다
```

다중 증권 발행사에서 실제로 필요하다 — 같은 발행사의 같은 sibling package를 두 상장
심볼이 각자 들고 오면 base만 보는 계획이 같은 관계를 두 번 추가한다. **계획 중에
production 파일을 쓰지 않는다.** receipt는 두 작업 항목 모두에 대해 제안 id → **같은**
production id 매핑을 그대로 보인다.

기존 JSONL 줄을 정렬·서식 때문에 다시 쓰지 않는다. 새 줄만 결정론적 순서로 덧붙인다 —
**물리 줄 순서는 정확성 의존이 아니다.** bundle 해시가 semantic 순서로 정규화한다.

##### 쓰기 실패 시 세 파일 전부를 되돌린다

쓰기 직전에 base version을 한 번 더 확인한다. 평범한 Python 예외가 나면 **세 파일
전부를** 원래 바이트로 되돌린다 — 쓰다가 터진 파일 자신이 이미 잘려 있을 수 있어
"성공한 파일만 되돌리기"로는 모자란다. **그 이상의 파일시스템 crash-consistency를
주장하지 않는다** — 프로세스가 죽거나 전원이 나가는 경우는 이 되돌리기가 다루지 않는다.

receipt는 `stage = 5A-2c` JSON 하나이고 **네 번째 identity 파일이 아니다.**
run/audit 산출물로 남는다. DB는 건드리지 않는다 — materialize와
`usable_from_session`은 5A-3의 일이다.

#### production `class_id` — `qv-class-id-v1` (Option A)

**production class_id는 불투명 결정적 안정 키다.** 다음을 쓰지 않는다.

```text
ticker · XBRL 축/member · 사람이 읽는 class 글자 · canonical bridge 계약 없는 표시 제목 ·
제안 id · 삽입 순서 · 정수 시퀀스
```

`prop-<CIK>-<member>`는 **packet 안에서만 쓰는 임시 참조**이고 production foreign
key로 새어 나가면 안 된다. XBRL member 이름에서 왔기 때문에 그것을 정체성으로 쓰면
taxonomy가 바뀌는 순간 economic class가 바뀐 것처럼 보인다.

진짜 새 economic class의 seed는 economic 사실뿐이다.

```json
{
  "scheme": "qv-class-id-v1",
  "cik": "<정규화된 10자리 CIK>",
  "effective_from": "<명시 economic class effective_from>",
  "canonical_bridge_type": "<GOVERNING_INSTRUMENT|SECURITY_TITLE_FACT>",
  "canonical_bridge_key": "<N1 prose 비교 키>"
}
```

QV identity 해싱과 **같은** 직렬화(`sort_keys=True` · `ensure_ascii=False` ·
`separators=(",", ":")`)로 정규화한 뒤,

```text
class_id = "us-cik-" + CIK + "-class-v1-" + SHA256(canonical_seed_json).hexdigest()
```

**전체 SHA-256 hex를 쓰고 자르지 않는다.**

##### seed bridge 선택

**class의 정확한 `effective_from`을 자기 구간이 덮는 canonical bridge만** 새 class의
seed가 될 수 있다. 몇 년 뒤에야 증거가 생긴 제목이 class의 탄생 정체성을 조용히
정하지 못하게 한다. 여럿이면 결정론적으로 고른다.

```text
1. GOVERNING_INSTRUMENT
2. SECURITY_TITLE_FACT
3. 정확한 comparison_key 사전순
```

이 순서는 **불투명 키의 seed에만** 영향을 주고 economic semantics를 바꾸지 않는다.
탄생 시점에 명시로 유효한 canonical bridge가 없으면 **새 자동 production class를
만들지 않는다** — packet은 검토 대상으로 남는다.

##### 기존 class는 안정적 foreign key다

이미 manifest에 있는 id를 무턱대고 다시 만들지 않는다. 새 id를 만들기 전에 **정확히
안전한 재사용만** 시도한다.

```text
같은 issuer · 정확히 같은 canonical prose comparison_key ·
그 관계가 제안 class의 effective_from에 유효 · economic 구간·속성이 호환 ·
정확히 하나만 일치
```

하나면 그 `class_id`를 그대로 쓴다. 0개면 production 불변식과 충돌하지 않을 때만 새로
만든다. **둘 이상이면 fail-close이고 고르지 않는다.**

`nke-b` · `googl-c` 같은 기존 사람이 읽는 anchor id는 **개명하지 않는다.** 여전히
유효한 foreign key이고, 불투명 v1 id는 **새로 만드는 class에만** 적용된다.

#### 상태 어휘 — 정확히 셋

```text
AUTO_PROVABLE     승인된 규칙 아래 SEC 증거가 기계적으로 완결됐다
                  (5A-2a/b에서는 제안 상태일 뿐이고 manifest 변경이 아니다.
                   5A-2c의 fail-close 관문을 통과하면 사람 승인 없이 승격될 수 있다)
REVIEW_REQUIRED   증거가 있으나 사람의 판정이 필요하다 — 승격 전에 사람이 본다
UNRESOLVED        증명을 시작할 후보조차 없다 — 승격 경로가 없다
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
