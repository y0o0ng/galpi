# Phase 0 정찰 — point-in-time issuer market equity source

> **실행 전에 쓴 계약이다.** 이 probe는 **버리는 spike**다. production schema를 만들지 않고
> DB ingestion을 만들지 않으며 **수익률을 0번 계산한다.** 결과를 본 뒤 아래 승인 규칙을
> 고치지 않는다.

Phase 0 사전등록(`README.md`)의 작업 5번 `point-in-time common shares / issuer market-equity
source 결정`을 **먼저** 떼어 정찰한다. 이 항목이 `DATA_NOT_READY`의 최우선 후보이기 때문이다 —
identity·submissions·accounting을 다 만들고 나서 여기서 막히면 그 셋이 통째로 버려진다.

**Phase 0 계약을 어기지 않는다.** 로드맵 §3.1이 이 source를 Phase 0에서 확정하도록 두고 있고,
수익률을 계산하지 않으므로 `alpha_intervention_budget = 0`을 태우지 않는다.

---

## 1. 묻는 것

> **formation 직전 12월 마지막 거래일 기준 issuer market equity를, 그 시점 이후 정보를 쓰지 않고
> 복원할 실제 경로가 존재하는가?**

로드맵 §4.4가 요구하는 것은 이 형태다.

```text
ME_class,dec(t-1)  = PIT common shares of class × raw close of class
ME_issuer,dec(t-1) = Σ ordinary-common share-class market equity of the issuer
```

`raw close`다. adjusted가 아니다. 따라서 shares도 **그 시점 단위**여야 하고, 나중 split로
소급 조정된 수량을 쓰면 raw 가격과 단위가 어긋난다.

---

## 2. 승인 규칙 — 여기서 새면 전부 샌다

**이 probe의 성공 조건은 표본 적중률이 아니다.**

```text
승인 = 최종 Gate C(issuer ME reconstruction coverage >= 95%)에 도달할 수 있는
       데이터 semantics와 경로가 실제로 존재함을 확인한 것

불승인 = 그 경로를 막는 systematic blocker가 있음
```

작은 표본에서 보는 것은 **systematic blocker의 유무**이지 coverage 비율이 아니다.

- `12개 중 11개 됐네` 같은 임시 threshold로 SEC route를 승인하지 않는다.
- 반대로 표본 몇 건이 실패했다고 바로 `DATA_NOT_READY`로 닫지도 않는다. 그 실패가
  **구조적인지 개별적인지**를 구분해 적는다.
- 이 probe는 Gate C를 **대신 통과하지 않는다.** Gate C는 본구현에서 전수로만 판정한다.

---

## 3. 반드시 확인하는 여섯 가지

|축|확인 내용|blocker가 되는 모양|
|---|---|---|
|**as-of date**|fact가 실제 instant 날짜를 들고 있는가. 그 날짜가 12월 말인가 filing 표지 날짜인가|instant가 없거나 12월과 무관하면 12월 ME를 만들 수 없다|
|**class scope**|multi-class issuer의 **class별** 수량이 나오는가|합산 하나만 나오면 §4.4의 class별 ME 합산이 불가능|
|**split basis**|보고된 수량이 그 시점 단위인가, 소급 조정본인가|소급 조정이면 raw close와 단위 불일치|
|**issuer aggregation**|CIK 하나에서 ordinary common classes를 빠짐없이/중복없이 모을 수 있는가|우선주·treasury·비상장 class를 못 가르면 ME가 틀린다|
|**provenance**|accession까지 역추적되는가 (Gate H)|안 되면 Gate H 자체가 불가|
|**오래된 연도**|초기 formation year에도 위 다섯이 성립하는가|XBRL 의무화 초기에 끊기면 `coverage_start`가 밀린다|

---

## 4. 후보 경로

```text
P1. dei:EntityCommonStockSharesOutstanding        표지 fact. as-of는 filing 직전 날짜
P2. us-gaap:CommonStockSharesOutstanding          대차대조표 instant. as-of = 회계기말
P3. us-gaap:CommonStockSharesIssued               issued - treasury 경로
P4. raw filing XBRL instance                      companyfacts가 못 주는 축을 직접 읽기
X.  weighted-average shares 계열                   **금지.** PIT 수량이 아니다
```

**P2가 의미상 정답에 가장 가깝다** — instant가 12월 말이고, 그 값은 10-K acceptance 시점에
공개되므로 `usable_on(formation)`을 만족한다. as-of는 과거이고 usable은 미래인 구조라
look-ahead가 아니다. P1은 usable 판정은 쉽지만 as-of가 12월이 아니다.

**미리 의심하는 blocker 하나**: `companyfacts` API는 dimension(axis)이 붙은 fact를 돌려주지
않는 것으로 알려져 있다. multi-class issuer의 class별 수량은 `StatementClassOfStockAxis`
member에 실려 있으므로, 사실이면 P2를 companyfacts만으로는 class별로 못 쪼갠다. 이 경우
P4(raw instance)가 필요한지, 그 경로가 전 기간 성립하는지가 승인의 핵심이 된다.
**이 의심을 결과 전에 적어둔다.**

---

## 5. 표본 — 무작위가 아니라 적대적으로 고른다

blocker를 찾는 probe이므로 무작위 추출을 쓰지 않는다. **비율을 추정하는 게 아니라 깨질 만한
곳을 일부러 밟는다.** 표본은 아래로 고정하고 실행 중에 바꾸지 않는다.

|issuer|CIK|고르는 이유|
|---|---|---|
|Apple|320193|split 2회(2014 7:1, 2020 4:1) · 대규모 buyback · single-class · 초기~최근 전 구간|
|Alphabet|1652044|multi-class(GOOGL/GOOG) · 2014 class 재편 · 중기~최근|
|Berkshire Hathaway|1067983|multi-class(A/B) · 수량 규모가 극단적으로 다름|
|NVIDIA|1045810|split 2회(2021 4:1, 2024 10:1) · 최근 급변|
|Tesla|1318605|split 2회(2020 5:1, 2022 3:1) · 대규모 issuance · 최근 편입|
|Exxon Mobil|34088|초기 구간 · single-class · 대규모 buyback|
|Walmart|104169|초기 구간 · single-class · 안정적 대조군|
|Intel|50863|초기 구간 · single-class · 최근 대규모 issuance|
|AbbVie|1551152|2013 spinoff 신설 issuer · identity 경계|
|Fox Corp|1754301|2019 신설 multi-class(FOXA/FOX) · 최근 구간 경계|

formation year는 **초기 `2011` · 중기 `2016` · 최근 `2023`** 세 개를 본다. 각 issuer가 그해에
존재하지 않으면 그 칸은 `N/A`로 적고 실패로 세지 않는다.

`DATA_NOT_READY` 판정을 위한 coverage 비율을 이 표본으로 계산하지 않는다.

---

## 6. 하지 않는 것

```text
production schema 생성          DB ingestion            trading/backtest 수정
수익률 계산                     factor 값 산출          coverage_start 결정
Gate C 판정                     30건 수동 audit 실행
```

산출물은 이 문서의 §8 결과 표 하나다. 코드는 `trading/probes/`에 두고 본구현에서 재사용하지
않는다 — 재사용하려면 그때 정식으로 다시 쓴다.

---

## 7. 판정과 다음

|라벨|뜻|다음|
|---|---|---|
|`SEC_ROUTE_VIABLE`|SEC만으로 여섯 축이 성립|Phase 0 원래 순서로 복귀 (identity → submissions → accounting → shares/ME 본구현 → snapshot)|
|`SEC_ROUTE_PARTIAL`|일부 축이 SEC로 안 됨|licensed source 조사. **상품명이 아니라 정확한 의미·시점·class 범위를 검증한다**|
|`NO_VIABLE_SOURCE`|licensed 포함해 95% 가망 없음|`DATA_NOT_READY`. **1~3을 구현하지 않고 닫는다**|

`SEC_ROUTE_PARTIAL`에서 licensed source를 볼 때도 `historical shares` 같은 상품명으로 승인하지
않는다. 로드맵 §3.1이 EODHD `shares`/`sharesMln`을 weighted-average diluted일 수 있다는 이유로
이미 막아놨고, 같은 기준을 모든 벤더에 적용한다.

---

## 8. 결과 — 2026-08-22

```text
판정        SEC_ROUTE_VIABLE
```

**§2의 승인 규칙과 §3의 여섯 축을 고치지 않았다.** 아래는 "표본에서 몇 개 맞았다"가 아니라
여섯 축 각각에 systematic blocker가 있는지의 판정이다. **Gate C(95%)는 여기서 판정하지 않았고
본구현 전수에서만 판정한다.**

### 8.1 API 경로는 구조적으로 불충분하다 — P1·P2·P3 기각

`companyfacts` / `companyconcept`가 돌려주는 fact의 키는 다음이 전부다.

```text
['accn', 'end', 'filed', 'form', 'fp', 'frame', 'fy', 'val']
```

**dimension(axis)이 없다.** §4에서 미리 의심한 blocker가 실제로 존재한다. 더 나쁜 것은
비차원 값의 **의미가 발행사마다 다르다**는 점이다.

|issuer|`us-gaap:CommonStockSharesOutstanding`|`dei:EntityCommonStockSharesOutstanding`|
|---|---|---|
|Apple (단일 class)|fact 144개 · 분기 instant|fact 70개|
|Alphabet|`12,088,000,000` = **A+B+C 합계**|**HTTP 404**|
|Berkshire|**HTTP 404**|fact 7개 · **2011에서 끊김** · 값이 **Class A만**|

Alphabet의 합계에는 **상장되지 않은 Class B**가 섞여 있어 한 가격에 곱하면 ME가 부풀고,
Berkshire는 A와 B의 가격이 1,500배 넘게 차이 나므로 합계를 써도 class를 몰라도 파탄난다.
`비차원 값 = 전체 합계`라는 규칙조차 세울 수 없다.

### 8.2 raw XBRL instance 경로는 살아 있다 — P4 채택

Berkshire FY2025 10-K(`accn 0001193125-26-083899`)의 인스턴스를 직접 파싱한 결과:

```text
CommonStockSharesOutstanding  instant=2023-12-31            567,775  ClassA
CommonStockSharesOutstanding  instant=2023-12-31      1,310,561,508  ClassB
CommonStockSharesOutstanding  instant=2024-12-31            547,562  ClassA
CommonStockSharesOutstanding  instant=2024-12-31      1,335,992,139  ClassB
```

`StatementClassOfStockAxis`로 class가 갈리고 **instant가 정확히 12월 31일**이다.

**오래된 연도도 막히지 않는다.** inline XBRL 도입 이전인 2012-02-27 제출 10-K는 독립 인스턴스
`brka-20111231.xml`을 갖고 있고, 같은 축으로 **2008-12-31 instant까지** 나온다.

### 8.3 여섯 축 판정

|축|판정|근거|
|---|---|---|
|as-of date|**성립**|instant가 실제 날짜로 붙는다. 단 8.4 참조|
|class scope|**성립**|`StatementClassOfStockAxis` member로 갈린다 (raw instance 한정)|
|split basis|**성립**|8.5 참조. PIT 규칙 자체가 단위를 지켜준다|
|issuer aggregation|**조건부 성립**|8.6의 member whitelist가 필요하다|
|provenance|**성립**|accession → 인스턴스 파일 → fact로 역추적된다|
|오래된 연도|**성립**|2008-12-31 instant 확인|

`acceptanceDateTime`은 `submissions`에 실제로 존재한다(2012년 filing에도 있다). §3.2의
`historical_usable_session`을 만들 수 있다.

### 8.4 12월 결산이 아닌 발행사는 10-K에 12월 instant가 없다

Apple FY2011 10-K(`aapl-20110924.xml`)에는 **12-31 instant fact가 0개**다. 9월 결산이라
대차대조표 instant가 9월이다. Apple의 12월 수량은 **10-Q**에 있고 instant도 `2019-12-28`처럼
정확히 말일이 아니다.

즉 ME용 shares는 10-K만으로 못 모은다. **이것은 blocker가 아니라 규칙이 필요한 지점이다**
(8.7 (3)(4)).

### 8.5 split은 PIT 규칙이 이미 막아준다

Apple 2020-08 4:1 split을 사이에 두고 `2019-12` instant를 찾으면:

```text
10-Q filed 2020-01-29   2019-12-28   4,384,959,000   ← split 이전 단위
10-K filed 2020-10-30   (없음)
10-Q filed 2021-01-28   (없음)
```

**당시 filing만 그 시점 수량을 들고 있고, 이후 filing은 그 instant를 아예 갖지 않는다.**
formation 시점에 usable했던 filing에서 읽는다는 PIT 규칙을 지키면 raw close와 단위가 자동으로
맞는다. 소급 조정본을 잘못 집는 경로가 구조적으로 생기지 않는다.

### 8.6 발견한 함정 — 파생 member를 합산하면 이중계산이다

Berkshire 인스턴스에는 이런 fact가 같이 있다.

```text
CommonStockSharesOutstanding  instant=2025-12-31   1,438,223  EquivalentClassAMember
```

Class B를 **A 환산한 메모 값**이다. `StatementClassOfStockAxis`의 member를 전부 더하면
같은 지분을 두 번 센다. **member를 whitelist로 고정해야 하고, 발견되지 않은 member는 조용히
포함하지 않고 missing으로 센다.**

### 8.7 본구현 전에 고정해야 하는 규칙

probe가 만들어낸 새 규칙이다. **여기서 정하지 않고 목록만 남긴다** — 정하는 자리는 Phase 0
본구현 prereg이고, 그때 filing 원문 대조와 함께 `accounting_definition_version`에 박는다.

```text
(1) shares 정본은 raw XBRL instance다. companyfacts API를 ME 정본으로 쓰지 않는다.
(2) StatementClassOfStockAxis member whitelist. Equivalent*/파생 member 제외.
(3) 12월 shares instant 선택 규칙:
    formation 시점 usable한 filing들 중 instant <= 12월 마지막 거래일인 가장 늦은 instant
(4) 10-Q를 shares source로 허용하는지 명시.
    §4.1의 10-Q 배제는 accounting factor 입력에 대한 것이고 ME용 수량은 다른 입력이다.
    로드맵이 이 구분을 적지 않았다.
(5) 상장되지 않은 ordinary class 처리. Alphabet Class B는 가격이 없다.
    §4.4의 "가능한 범위에서 class별 market equity를 합산"이 이 경우를 정하지 않는다.
```

**(4)와 (5)는 로드맵의 진짜 빈칸이다.** 내가 임의로 메우지 않는다.

### 8.8 이 probe가 하지 않은 것

```text
Gate C 95% 판정          multi-class 비중 실측       coverage_start 결정
전수 인스턴스 파싱        production ingestion        수익률 계산
```

표본은 §5의 적대적 10개 중 Apple·Alphabet·Berkshire 세 곳까지만 실제로 밟았다. **여섯 축
전부에서 blocker 유무가 갈렸고 P4가 세 곳 모두에서 성립했으므로 더 밟지 않고 멈췄다.**
나머지 일곱은 본구현 전수에서 자연히 검사된다.
