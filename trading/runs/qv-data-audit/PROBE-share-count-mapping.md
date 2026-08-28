# QV Phase 0 — PIT ordinary-share count mapping probe

> **Status: RESEARCH EVIDENCE ONLY.** 이 문서는 설계 승인·freeze가 아니다. production
> code/schema/test/roadmap의 의미를 바꾸지 않는다. coverage Gate C · coverage_start ·
> formation rank · B/M · returns는 계산하지 않았다.

시작 main: `030070c5fe677ade304c99723cceeb75e1379d74`
(정찰 중 `origin/main`이 `fd936cd6e3bcad6acff0104e8725a6995945edca`로 진행했으나
그 커밋은 `server.js`·`test/codex-organizer-server.test.js`만 건드리는 Codex 정리 수정이라
이 계약과 무관하다.)

## 1. 질문과 결론 요약

질문은 "raw XBRL instance에서 formation용 PIT ordinary-common shares를 어떤 concept /
context shape로 canonical하게 식별할 것인가"였다.

결론 다섯 가지다.

1. **`us-gaap:CommonStockSharesOutstanding`과 `dei:EntityCommonStockSharesOutstanding`은
   같은 경제량을 서로 다른 instant에 보고한다.** 전자는 재무제표 instant(회계기간 말),
   후자는 표지 날짜(기간 말 **이후**)다. 표본에서 둘이 같은 scope·instant에 함께 나타난
   cell은 전체 약 400개 중 **5개뿐**이다. 즉 둘은 겹치는 값이 아니라 **거의 분리된 두 시계열**이다.
2. **둘 중 어느 하나도 단독으로 충분하지 않다.** Ford와 AbbVie는 10-K·10-Q 어디에서도
   `us-gaap:CommonStockSharesOutstanding`을 **한 번도 태깅하지 않는다**(2012~2026 확인).
   반대로 Alphabet 2018 formation에서는 us-gaap class fact가 December instant에 있는데
   DEI에는 December 이하 instant가 아예 없다.
3. **dimensionless fact를 "class가 하나니까 그 class"로 읽는 것은 공식 semantics 위반이다.**
   EDGAR XBRL Guide §6.4.1은 dimensionless context를 "**모든** class of stock에 적용되는 fact"로
   정의한다. Alphabet은 dimensionless total과 class children을 **동시에** 보고하고 총합이
   정확히 일치한다(4개 instant 모두). dimensionless는 sole-class 매핑이 아니라 **총계**다.
4. **Candidate D(issued − treasury)는 generic fallback으로 쓸 수 없다.** 같은 scope에
   `TreasuryStockCommonShares`가 함께 있는 관측은 104개 중 **5개**뿐이고, 16개는
   `TreasuryStockShares`만 있는데 그 concept의 공식 정의는 "common **and preferred**"라
   common 재구성에 쓰면 preferred treasury를 빼게 된다.
5. **December selector에는 지금 계약에 없는 구멍이 하나 있다.** "December 이하 latest instant"만
   보면 그 concept을 오래전에 그만 태깅한 발행사에서 **MISSING이 아니라 그럴듯한 옛 숫자**가
   나온다. Walmart는 세 formation 모두 2012-01-31 값(3,418,000,000)을 돌려주고,
   Visa `CommonClassBMember`는 2026 formation에서 2017-09-30 값을 돌려준다.
   staleness 상한이나 "가장 최근 usable annual filing에서 와야 한다"는 조건이 없으면
   이 오류는 조용히 통과한다.

추천은 마지막 `User decision`의 **C — direct reported outstanding concepts의 명시적
structural hierarchy**다. 이 추천은 research 결과일 뿐 아직 CLOSED/FROZEN 계약이 아니다.

## 2. 표본과 방법

### 2.1 표본

로드맵 §4.4가 요구한 10개 발행사에 10개를 더한 20개다. 결과를 보기 전에 고정했고
발행사별로 early / middle / recent 각 1개 10-K을 뽑았다.

| issuer | CIK | 구조 |
|---|---|---|
| AAPL | 0000320193 | single · 9월 결산 |
| GOOGL | 0001652044 | multi A/B/C · dimensionless total 공존 |
| BRK | 0001067983 | multi A/B · derived member |
| NVDA | 0001045810 | single · 1월 결산 · split |
| TSLA | 0001318605 | single · 대규모 발행 · split |
| XOM | 0000034088 | single |
| WMT | 0000104169 | single · 1월 결산 |
| INTC | 0000050863 | single |
| ABBV | 0001551152 | single · 2013 spin-off |
| FOX | 0001754301 | multi A/B · 2019 신설 |
| META | 0001326801 | multi A/B |
| F | 0000037996 | multi common / Class B |
| CMCSA | 0001166691 | multi A/B/Special |
| NWS | 0001564708 | multi A/B/Series |
| UA | 0001336917 | multi A/C/Convertible |
| V | 0001403161 | multi A/B(→B1,B2)/C |
| MA | 0001141391 | multi A/B |
| NKE | 0000320187 | multi A/B · 5월 결산 |
| COST | 0000909832 | single · 8월 결산 |
| HD | 0000354950 | single · 1월 결산 |

56개 accession의 raw instance를 production 파서 `trading/backtest/qv_xbrl.parse_instance()`로
그대로 읽었다. 대상 concept은 `dei:EntityCommonStockSharesOutstanding`,
`us-gaap:CommonStockSharesOutstanding`, `us-gaap:CommonStockSharesIssued`,
`us-gaap:TreasuryStockCommonShares`, `us-gaap:TreasuryStockShares` 다섯이고 instant context만 봤다.
`entity` identifier가 대상 CIK가 아닌 fact(예: Comcast 파일 안의 NBCUniversal)는 버렸다.

### 2.2 formation-style selection 재현

각 (issuer, formation year, class scope)마다 §10 절차를 그대로 돌렸다.

1. formation = 그 해 6월 마지막 정규 세션
2. December = t-1년 12월 마지막 정규 세션 (둘 다 `bars_daily` 세션 달력)
3. `acceptance_datetime <= formation`인 filing만
4. candidate별로 `instant <= December session`인 fact만
5. latest instant 선택
6. 같은 instant에 값·`decimals`·unit·dimension이 갈리면 `TIE_UNRESOLVED`
7. 미래 filing 미사용

관측 단위는 (issuer, formation year, **class scope**)다. 초기 집계에서 class를 섞어
한 pool로 고르는 실수를 했고 그때 tie가 27건으로 부풀었다. class별로 분리하니 6건이다.
아래 숫자는 전부 class 분리 후 값이다.

### 2.3 이 표본의 한계 — 반드시 읽을 것

**10-K instance만 받았다.** 계약이 허용하는 10-Q를 표본에 넣지 않았으므로 아래
staleness·`NO_INSTANT_ON_OR_BEFORE_DECEMBER` 숫자는 **실제 계약보다 나쁜 쪽으로 치우쳐 있다.**
특히 12월 결산 발행사의 DEI는 10-Q 표지(4·7·10월)가 들어오면 훨씬 덜 낡는다.
따라서 이 숫자들은 **coverage 추정이 아니라 구조 비교용**이다. §14 통계도 그 목적으로만 읽는다.

단, Ford / AbbVie의 `us-gaap:CommonStockSharesOutstanding` 부재는 이 한계에 걸리지 않는다.
두 발행사의 10-Q(각 3개, 2012~2026)를 따로 확인했고 거기에도 없다(§12.4).

## 3. 공식 semantics

### 3.1 EDGAR XBRL Guide

출처: [SEC EDGAR XBRL Guide 2026-05-15](https://www.sec.gov/files/edgar/filer-information/specifications/xbrl-guide-2026-05-15.pdf)

**§3.2.3 Common Stock Shares Outstanding**

> "Common stock shares, like public float, appears in a context that is an instant period,
> not a duration."

> "Depending on whether the entity represented in the required context has zero, one, or more
> than one, class of common shares or ownership units outstanding, the instance will have
> exactly one of the following permitted sets of facts:"

| Case | Axis in any standard namespace | Members in distinct contexts | Period |
|---|---|---|---|
| 1 | No dimensions | N/A | An instant on or after the end of the required context |
| 2 | `StatementClassOfStockAxis` | At least two | An instant on or after the end of the required context |
| 3 | `ClassesOfShareCapitalAxis` | At least two | An instant on or after the end of the required context |

> "The cases are mutually exclusive."

§3.2.3 Notes:

> "A filer having no common stock will have 0 common stock shares outstanding under case 1, not nil."

§3.2.4 Note 3:

> "The presence of members on axes other than `StatementClassOfStockAxis` or
> `ClassesOfShareCapitalAxis` does not change which of the three cases is being represented
> in an instance."

**§6.4.1 Contexts for all classes of stock**

> "Facts that apply to all classes of stock in an instance must have an `i:context` element
> without a dimension attribute equal to `StatementClassOfStockAxis` or
> `ClassesOfShareCapitalAxis` in a standard namespace."

**§6.4.2 Contexts for a single class of stock**

> "An instance containing facts that are only specific to distinct stock classes in a statement
> must distinguish those facts using `i:context` elements whose `xbrldi:explicitMember` elements
> have a dimension attribute of `StatementClassOfStockAxis` or `ClassesOfShareCapitalAxis` in a
> standard namespace. Many "generic" stock class domain members appear in standard namespaces
> (for example, `CommonClassAMember`), but filers may also create new domain members to refer
> to specific classes."

§6.4.1이 이 probe의 핵심 근거다. **dimensionless는 "class 정보 없음"이 아니라 "모든 class에
적용됨"이다.** class가 실제로 하나면 그 하나와 총계가 같으므로 결과적으로 일치하지만,
class가 여럿이면 dimensionless는 **총계**이고 class로 쓰면 안 된다.

§6.4.2는 issuer-extension member가 공식적으로 허용됨을 명시한다. 따라서 member 이름 규칙으로
class를 고르는 방식은 표준 밖 member(`CapitalClassCMember`, `ClassaSpecialCommonStockMember` 등)를
놓치거나 잘못 매핑한다. 이 계약이 이미 요구하는 **명시 등록 axis/member exact match**가 맞다.

### 3.2 element documentation

출처: SEC rendered filing의 element documentation
(예: `https://www.sec.gov/Archives/edgar/data/1551152/000155115226000026/R4.htm`의 `- Definition`).

- `us-gaap:CommonStockSharesOutstanding` —
  > "Number of shares of common stock outstanding. Common stock represent the ownership interest in a corporation."
- `us-gaap:CommonStockSharesIssued` —
  > "Total number of common shares of an entity that have been sold or granted to shareholders
  > (includes common shares that were issued, repurchased and remain in the treasury). ...
  > **Shares issued include shares outstanding and shares held in the treasury.**"
- `us-gaap:TreasuryStockCommonShares` —
  > "Number of previously issued **common** shares repurchased by the issuing entity and held in treasury."
- `us-gaap:TreasuryStockShares` —
  > "Number of **common and preferred** shares that were previously issued and that were repurchased
  > by the issuing entity and held in treasury on the financial statement date."

`TreasuryStockShares`가 preferred를 포함한다는 점이 Candidate D의 판정을 가른다(§12.7).

`dei:EntityCommonStockSharesOutstanding`의 표준 label은 "Entity Common Stock, Shares Outstanding"이고
Guide §3.2.3이 이를 표지(cover) fact로 규정한다. 따라서 그 instant는 **회계기간 말이 아니라
표지 기준일**이며, Guide 표대로 "required context 종료일 **이후**"다.

## 4. dimension shape 검증

### 4.1 Case 1 — dimensionless

§6.4.1의 정의상 dimensionless는 총계다. 표본에서 dimensionless outstanding을 쓰는 발행사는
AAPL · NVDA · TSLA · XOM · WMT · INTC · COST · HD — 전부 실제로 ordinary class가 하나다.
이 경우에만 "총계 == 그 하나의 class"가 성립한다.

**그래서 매핑 조건은 "class가 하나로 보인다"가 아니라 "identity에 등록된 실제 ordinary class가
정확히 하나이고, 그 filing에 class-dimensional outstanding fact가 없다"여야 한다.**
Alphabet(§4.2)과 Nike(§12.8)가 반례다.

### 4.2 Case 2 — dimensionless total + class children 공존

Alphabet 표본에서 4개 instant 모두 dimensionless total이 class children과 공존하고 합이 정확히 맞는다.

| accession | instant | dimensionless total | A | B | C | 합 == total |
|---|---|---|---|---|---|---|
| 0001652044-18-000007 | 2016-12-31 | 691,293,000 | 296,992,000 | 47,437,000 | 346,864,000 | 예 |
| 0001652044-18-000007 | 2017-12-31 | 694,783,000 | 298,470,000 | 46,972,000 | 349,341,000 | 예 |
| 0001652044-26-000018 | 2024-12-31 | 12,211,000,000 | 5,835,000,000 | 861,000,000 | 5,515,000,000 | 예 |
| 0001652044-26-000018 | 2025-12-31 | 12,088,000,000 | 5,822,000,000 | 837,000,000 | 5,429,000,000 | 예 |

결론: **총계를 class로 취급하지 않는다. class children이 있으면 총계는 무시한다. 총계를 다시
더하지 않는다.** ME_issuer는 등록된 ordinary class의 class-level 값 합이지 이 총계 fact가 아니다
(값이 같더라도 경로를 섞지 않는다).

### 4.3 Case 3 — class-dimensional fact

axis namespace는 taxonomy 연도마다 바뀐다(§10). member는 표준 386회, issuer-extension 29회다.

표본의 issuer-extension member: `CapitalClassCMember`(GOOGL) · `ClassaSpecialCommonStockMember`(CMCSA) ·
`CommonClassB1Member`/`CommonClassB2Member`/`CommonClassB1AndB2Member`(V) ·
`EquivalentClassAMember`(BRK) · `SeriesCommonStockMember`(NWS).

두 가지가 **canonical class share count로 쓰이면 안 된다.**

- **derived member** — BRK `EquivalentClassAMember`는 Class B를 Class A 환산한 파생량이다
  (2024-12-31에 1,438,223). 실제 class가 아니다.
- **aggregate member** — Visa `CommonClassB1AndB2Member`는 같은 axis에 자기 children과 함께 있다.
  2024-09-30과 2025-09-30 모두 `B1AndB2 = 125,000,000 = B1 5,000,000 + B2 120,000,000`이다.
  axis의 member를 전부 더하면 Class B가 두 번 들어간다.

즉 **class 집합은 axis에 나타난 member 목록에서 유도하면 안 되고, identity에 실제 ordinary class로
명시 등록된 member만 써야 한다**는 기존 계약이 이 표본에서 그대로 필요하다.

또 하나, **축의 조합이 중요하다.** 표본의 outstanding fact 중:

- `StatementEquityComponentsAxis`만 붙은 것 80회 (AAPL · NVDA · INTC · COST · HD · META · V)
- `StatementClassOfStockAxis` + `StatementEquityComponentsAxis` 두 축이 같이 붙은 것 44회
  (FOX 8 · NKE 16 · NWS 8 · UA 12)

뒤쪽이 함정이다. **class 축을 들고 있지만 class-scope fact가 아니다.** 자본변동표의 특정
equity component 열 안에서의 주식 수라, 그 class의 발행주식수와 같다는 보장이 없다.
§3.2.4 Note 3이 "다른 축의 member 존재는 어느 case인지를 바꾸지 않는다"고 한 것과 같은 얘기다.

따라서 **"dimension이 없으면 총계, 있으면 class"도, "class 축이 있으면 class fact"도 둘 다 틀렸다.**
class fact의 조건은 **class 축이 있고 그 외 축이 없는 것**이어야 하고, dimensionless fact의 조건은
**축이 하나도 없는 것**이어야 한다. shape을 exact하게 봐야 한다.

## 5. 결과 표

104개 (issuer, formation year, class scope) 관측이다. derived member(`EquivalentClassAMember`)와
aggregate member(`CommonClassB1AndB2Member`)는 class 목록에서 제외했다.

값이 `—`이면 그 candidate가 해결하지 못한 것이고 옆 칸이 사유다.
D 칸은 같은 scope·같은 instant의 issued/treasury로만 계산했다.

| issuer | formation | class scope | Dec session | A value | A instant/status | B value | B instant/status | D (issued−treasury) |
|---|---|---|---|---|---|---|---|---|
| AAPL | 2013 | dimensionless | 2012-12-31 | 939,208,000 | 2012-09-29 | 940,692,000 | 2012-10-19 | issued only |
| AAPL | 2018 | dimensionless | 2017-12-29 | 5,126,201,000 | 2017-09-30 | 5,134,312,000 | 2017-10-20 | issued only |
| AAPL | 2026 | dimensionless | 2025-12-31 | 14,773,260,000 | 2025-09-27 | 14,776,353,000 | 2025-10-17 | issued only |
| GOOGL | 2018 | class:CapitalClassCMember | 2017-12-29 | 346,864,000 | 2016-12-31 | — | NO_INSTANT_ON_OR_BEFORE_DECEMBER | issued only |
| GOOGL | 2018 | class:CommonClassAMember | 2017-12-29 | 296,992,000 | 2016-12-31 | — | NO_INSTANT_ON_OR_BEFORE_DECEMBER | issued only |
| GOOGL | 2018 | class:CommonClassBMember | 2017-12-29 | 47,437,000 | 2016-12-31 | — | NO_INSTANT_ON_OR_BEFORE_DECEMBER | issued only |
| GOOGL | 2026 | class:CapitalClassCMember | 2025-12-31 | 5,429,000,000 | 2025-12-31 | 349,843,717 | 2018-01-31 | issued only |
| GOOGL | 2026 | class:CommonClassAMember | 2025-12-31 | 5,822,000,000 | 2025-12-31 | 298,492,525 | 2018-01-31 | issued only |
| GOOGL | 2026 | class:CommonClassBMember | 2025-12-31 | 837,000,000 | 2025-12-31 | 46,961,288 | 2018-01-31 | issued only |
| BRK | 2013 | class:CommonClassAMember | 2012-12-31 | 894,955 | 2012-12-31 | — | NO_INSTANT_ON_OR_BEFORE_DECEMBER | 894,955 (TreasuryStockShares) |
| BRK | 2013 | class:CommonClassBMember | 2012-12-31 | 1,121,985,472 | 2012-12-31 | — | NO_INSTANT_ON_OR_BEFORE_DECEMBER | 1,121,985,472 (TreasuryStockShares) |
| BRK | 2018 | class:CommonClassAMember | 2017-12-29 | 776,378 | 2016-12-31 | 892,722 | 2013-02-18 | 776,378 (TreasuryStockShares) |
| BRK | 2018 | class:CommonClassBMember | 2017-12-29 | 1,301,914,165 | 2016-12-31 | 1,125,695,637 | 2013-02-18 | 1,301,914,165 (TreasuryStockShares) |
| BRK | 2026 | class:CommonClassAMember | 2025-12-31 | 515,835 | 2025-12-31 | 748,745 | 2018-02-13 | 515,835 |
| BRK | 2026 | class:CommonClassBMember | 2025-12-31 | 1,383,582,639 | 2025-12-31 | 1,344,332,039 | 2018-02-13 | 1,383,582,639 |
| NVDA | 2013 | dimensionless | 2012-12-31 | 612,191,412 | 2012-01-29 | 616,028,107 | 2012-03-09 | 612,191,412 (TreasuryStockShares) |
| NVDA | 2018 | dimensionless | 2017-12-29 | 585,000,000 | 2017-01-29 | 588,632,086 | 2017-02-24 | 585,000,000 (TreasuryStockShares) |
| NVDA | 2026 | dimensionless | 2025-12-31 | 24,477,000,000 | 2025-01-26 | 24,400,000,000 | 2025-02-21 | issued only |
| TSLA | 2013 | dimensionless | 2012-12-31 | 114,214,274 | 2012-12-31 | — | NO_INSTANT_ON_OR_BEFORE_DECEMBER | issued only |
| TSLA | 2018 | dimensionless | 2017-12-29 | 161,561,000 | 2016-12-31 | 114,517,973 | 2013-01-31 | issued only |
| TSLA | 2026 | dimensionless | 2025-12-31 | 3,751,000,000 | 2025-12-31 | 168,919,941 | 2018-02-14 | issued only |
| XOM | 2013 | dimensionless | 2012-12-31 | — | NO_INSTANT_ON_OR_BEFORE_DECEMBER | — | NO_INSTANT_ON_OR_BEFORE_DECEMBER | 4,502,000,000 (TreasuryStockShares) |
| XOM | 2018 | dimensionless | 2017-12-29 | 4,148,000,000 | 2016-12-31 | 4,480,449,635 | 2013-01-31 | 4,148,000,000 (TreasuryStockShares) |
| XOM | 2026 | dimensionless | 2025-12-31 | 4,179,000,000 | 2025-12-31 | 4,237,462,159 | 2018-01-31 | 4,179,000,000 |
| WMT | 2013 | dimensionless | 2012-12-31 | 3,418,000,000 | 2012-01-31 | 3,404,538,468 | 2012-03-22 | issued only |
| WMT | 2018 | dimensionless | 2017-12-29 | 3,418,000,000 | 2012-01-31 | 3,033,009,079 | 2017-03-29 | issued only |
| WMT | 2026 | dimensionless | 2025-12-31 | 3,418,000,000 | 2012-01-31 | 8,016,849,444 | 2025-03-12 | issued only |
| INTC | 2013 | dimensionless | 2012-12-31 | 4,944,000,000 | 2012-12-29 | — | NO_INSTANT_ON_OR_BEFORE_DECEMBER | issued only |
| INTC | 2018 | dimensionless | 2017-12-29 | 4,730,000,000 | 2016-12-31 | 4,946,000,000 | 2013-02-08 | issued only |
| INTC | 2026 | dimensionless | 2025-12-31 | 4,994,000,000 | 2025-12-27 | 4,668,000,000 | 2018-02-07 | issued only |
| ABBV | 2013 | dimensionless | 2012-12-31 | — | NO_INSTANT_ON_OR_BEFORE_DECEMBER | — | NO_INSTANT_ON_OR_BEFORE_DECEMBER | unavailable |
| ABBV | 2018 | dimensionless | 2017-12-29 | — | NO_INSTANT_ON_OR_BEFORE_DECEMBER | 1,583,729,114 | 2013-03-31 | 1,592,512,724 (TreasuryStockShares) |
| ABBV | 2026 | dimensionless | 2025-12-31 | — | NO_INSTANT_ON_OR_BEFORE_DECEMBER | 1,478,821,109 | 2019-10-29 | 1,767,876,035 |
| FOX | 2026 | class:CommonClassAMember | 2025-12-31 | 210,754,900 | 2025-06-30 | 209,954,934 | 2025-08-01 | issued only |
| FOX | 2026 | class:CommonClassBMember | 2025-12-31 | 235,581,025 | 2025-06-30 | 235,581,025 | 2025-08-01 | issued only |
| META | 2013 | class:CommonClassAMember | 2012-12-31 | 1,671,277,621 | 2012-12-31 | — | NO_INSTANT_ON_OR_BEFORE_DECEMBER | issued only |
| META | 2013 | class:CommonClassBMember | 2012-12-31 | 701,427,574 | 2012-12-31 | — | NO_INSTANT_ON_OR_BEFORE_DECEMBER | issued only |
| META | 2018 | class:CommonClassAMember | 2017-12-29 | 2,354,000,000 | 2016-12-31 | 1,684,185,170 | 2013-01-29 | issued only |
| META | 2018 | class:CommonClassBMember | 2017-12-29 | 538,000,000 | 2016-12-31 | 697,948,924 | 2013-01-29 | issued only |
| META | 2026 | class:CommonClassAMember | 2025-12-31 | 2,187,000,000 | 2025-12-31 | 2,395,921,635 | 2018-01-29 | issued only |
| META | 2026 | class:CommonClassBMember | 2025-12-31 | 343,000,000 | 2025-12-31 | 509,079,123 | 2018-01-29 | issued only |
| F | 2013 | class:CommonClassBMember | 2012-12-31 | — | NO_INSTANT_ON_OR_BEFORE_DECEMBER | 70,852,076 | 2012-04-27 | issued only |
| F | 2013 | class:CommonStockMember | 2012-12-31 | — | NO_INSTANT_ON_OR_BEFORE_DECEMBER | 3,745,515,422 | 2012-04-27 | issued only |
| F | 2018 | class:CommonClassBMember | 2017-12-29 | — | NO_INSTANT_ON_OR_BEFORE_DECEMBER | 70,852,076 | 2013-02-01 | issued only |
| F | 2018 | class:CommonStockMember | 2017-12-29 | — | NO_INSTANT_ON_OR_BEFORE_DECEMBER | 3,851,395,591 | 2013-02-01 | issued only |
| F | 2026 | class:CommonClassBMember | 2025-12-31 | — | NO_INSTANT_ON_OR_BEFORE_DECEMBER | 70,852,076 | 2019-07-19 | issued only |
| F | 2026 | class:CommonStockMember | 2025-12-31 | — | NO_INSTANT_ON_OR_BEFORE_DECEMBER | 3,918,991,225 | 2019-07-19 | issued only |
| CMCSA | 2013 | class:ClassaSpecialCommonStockMember | 2012-12-31 | 507,769,463 | 2012-12-31 | 507,769,463 | 2012-12-31 | 507,769,463 (TreasuryStockShares) |
| CMCSA | 2013 | class:CommonClassAMember | 2012-12-31 | 2,122,278,635 | 2012-12-31 | 2,122,278,635 | 2012-12-31 | 2,122,278,635 (TreasuryStockShares) |
| CMCSA | 2013 | class:CommonClassBMember | 2012-12-31 | 9,444,375 | 2012-12-31 | 9,444,375 | 2012-12-31 | issued only |
| CMCSA | 2018 | class:ClassaSpecialCommonStockMember | 2017-12-29 | 0 | 2016-12-31 | 507,769,463 | 2012-12-31 | 507,769,463 (TreasuryStockShares) |
| CMCSA | 2018 | class:CommonClassAMember | 2017-12-29 | — | TIE_UNRESOLVED | 2,122,278,635 | 2012-12-31 | 4,742,159,011 (TreasuryStockShares) |
| CMCSA | 2018 | class:CommonClassBMember | 2017-12-29 | — | TIE_UNRESOLVED | 9,444,375 | 2012-12-31 | issued only |
| CMCSA | 2026 | class:ClassaSpecialCommonStockMember | 2025-12-31 | 0 | 2017-12-31 | 507,769,463 | 2012-12-31 | 507,769,463 (TreasuryStockShares) |
| CMCSA | 2026 | class:CommonClassAMember | 2025-12-31 | — | TIE_UNRESOLVED | 4,635,063,642 | 2017-12-31 | issued only |
| CMCSA | 2026 | class:CommonClassBMember | 2025-12-31 | — | TIE_UNRESOLVED | 9,444,375 | 2017-12-31 | issued only |
| NWS | 2018 | class:CommonClassAMember | 2017-12-29 | 382,294,262 | 2017-06-30 | 382,305,541 | 2017-08-07 | unavailable |
| NWS | 2018 | class:CommonClassBMember | 2017-12-29 | 199,630,240 | 2017-06-30 | 199,630,240 | 2017-08-07 | unavailable |
| NWS | 2018 | class:SeriesCommonStockMember | 2017-12-29 | 0 | 2017-06-30 | — | NO_INSTANT_ON_OR_BEFORE_DECEMBER | unavailable |
| NWS | 2026 | class:CommonClassAMember | 2025-12-31 | — | TIE_UNRESOLVED | 376,442,848 | 2025-08-01 | unavailable |
| NWS | 2026 | class:CommonClassBMember | 2025-12-31 | — | TIE_UNRESOLVED | 188,528,838 | 2025-08-01 | unavailable |
| NWS | 2026 | class:SeriesCommonStockMember | 2025-12-31 | 0 | 2025-06-30 | — | NO_INSTANT_ON_OR_BEFORE_DECEMBER | unavailable |
| UA | 2013 | class:CommonClassAMember | 2012-12-31 | 83,461,106 | 2012-12-31 | — | NO_INSTANT_ON_OR_BEFORE_DECEMBER | issued only |
| UA | 2013 | class:CommonClassCMember | 2012-12-31 | — | NO_INSTANT_ON_OR_BEFORE_DECEMBER | — | NO_INSTANT_ON_OR_BEFORE_DECEMBER | unavailable |
| UA | 2013 | class:ConvertibleCommonStockMember | 2012-12-31 | 21,300,000 | 2012-12-31 | — | NO_INSTANT_ON_OR_BEFORE_DECEMBER | issued only |
| UA | 2018 | class:CommonClassAMember | 2017-12-29 | 183,814,911 | 2016-12-31 | 83,469,813 | 2013-01-31 | issued only |
| UA | 2018 | class:CommonClassCMember | 2017-12-29 | 220,174,048 | 2016-12-31 | — | NO_INSTANT_ON_OR_BEFORE_DECEMBER | issued only |
| UA | 2018 | class:ConvertibleCommonStockMember | 2017-12-29 | 34,450,000 | 2016-12-31 | 21,300,000 | 2013-01-31 | issued only |
| UA | 2026 | class:CommonClassAMember | 2025-12-31 | 188,822,726 | 2025-03-31 | 188,822,726 | 2025-05-15 | issued only |
| UA | 2026 | class:CommonClassCMember | 2025-12-31 | 202,720,745 | 2025-03-31 | 202,847,601 | 2025-05-15 | issued only |
| UA | 2026 | class:ConvertibleCommonStockMember | 2025-12-31 | 34,450,000 | 2025-03-31 | 34,450,000 | 2025-05-15 | issued only |
| V | 2013 | class:CommonClassAMember | 2012-12-31 | 535,000,000 | 2012-09-30 | 535,517,788 | 2012-11-08 | issued only |
| V | 2013 | class:CommonClassB1Member | 2012-12-31 | — | NO_INSTANT_ON_OR_BEFORE_DECEMBER | — | NO_INSTANT_ON_OR_BEFORE_DECEMBER | unavailable |
| V | 2013 | class:CommonClassB2Member | 2012-12-31 | — | NO_INSTANT_ON_OR_BEFORE_DECEMBER | — | NO_INSTANT_ON_OR_BEFORE_DECEMBER | unavailable |
| V | 2013 | class:CommonClassBMember | 2012-12-31 | 245,000,000 | 2012-09-30 | 245,513,385 | 2012-11-08 | issued only |
| V | 2013 | class:CommonClassCMember | 2012-12-31 | 31,000,000 | 2012-09-30 | 29,576,710 | 2012-11-08 | issued only |
| V | 2018 | class:CommonClassAMember | 2017-12-29 | 1,818,000,000 | 2017-09-30 | 1,813,463,251 | 2017-11-10 | issued only |
| V | 2018 | class:CommonClassB1Member | 2017-12-29 | — | NO_INSTANT_ON_OR_BEFORE_DECEMBER | — | NO_INSTANT_ON_OR_BEFORE_DECEMBER | unavailable |
| V | 2018 | class:CommonClassB2Member | 2017-12-29 | — | NO_INSTANT_ON_OR_BEFORE_DECEMBER | — | NO_INSTANT_ON_OR_BEFORE_DECEMBER | unavailable |
| V | 2018 | class:CommonClassBMember | 2017-12-29 | 245,000,000 | 2017-09-30 | 245,513,385 | 2017-11-10 | issued only |
| V | 2018 | class:CommonClassCMember | 2017-12-29 | 13,000,000 | 2017-09-30 | 12,665,935 | 2017-11-10 | issued only |
| V | 2026 | class:CommonClassAMember | 2025-12-31 | 1,691,000,000 | 2025-09-30 | 1,687,629,770 | 2025-10-30 | issued only |
| V | 2026 | class:CommonClassB1Member | 2025-12-31 | 5,000,000 | 2025-09-30 | 4,835,384 | 2025-10-30 | unavailable |
| V | 2026 | class:CommonClassB2Member | 2025-12-31 | 120,000,000 | 2025-09-30 | 120,338,948 | 2025-10-30 | unavailable |
| V | 2026 | class:CommonClassBMember | 2025-12-31 | 245,000,000 | 2017-09-30 | 245,513,385 | 2017-11-10 | issued only |
| V | 2026 | class:CommonClassCMember | 2025-12-31 | 9,000,000 | 2025-09-30 | 8,938,707 | 2025-10-30 | issued only |
| MA | 2013 | class:CommonClassAMember | 2012-12-31 | 118,405,075 | 2012-12-31 | — | NO_INSTANT_ON_OR_BEFORE_DECEMBER | issued only |
| MA | 2013 | class:CommonClassBMember | 2012-12-31 | 4,838,840 | 2012-12-31 | — | NO_INSTANT_ON_OR_BEFORE_DECEMBER | issued only |
| MA | 2018 | class:CommonClassAMember | 2017-12-29 | 1,062,000,000 | 2016-12-31 | 117,961,825 | 2013-02-07 | issued only |
| MA | 2018 | class:CommonClassBMember | 2017-12-29 | 19,000,000 | 2016-12-31 | 4,808,789 | 2013-02-07 | issued only |
| MA | 2026 | class:CommonClassAMember | 2025-12-31 | 887,000,000 | 2025-12-31 | 1,037,246,307 | 2018-02-09 | issued only |
| MA | 2026 | class:CommonClassBMember | 2025-12-31 | 7,000,000 | 2025-12-31 | 14,138,629 | 2018-02-09 | issued only |
| NKE | 2013 | class:CommonClassAMember | 2012-12-31 | 90,000,000 | 2012-05-31 | 89,892,248 | 2012-07-19 | unavailable |
| NKE | 2013 | class:CommonClassBMember | 2012-12-31 | 368,000,000 | 2012-05-31 | 365,977,972 | 2012-07-19 | unavailable |
| NKE | 2018 | class:CommonClassAMember | 2017-12-29 | 329,000,000 | 2017-05-31 | 329,245,752 | 2017-07-17 | unavailable |
| NKE | 2018 | class:CommonClassBMember | 2017-12-29 | 1,314,000,000 | 2017-05-31 | 1,313,949,313 | 2017-07-17 | unavailable |
| NKE | 2026 | class:CommonClassAMember | 2025-12-31 | 290,000,000 | 2025-05-31 | 288,887,752 | 2025-07-09 | unavailable |
| NKE | 2026 | class:CommonClassBMember | 2025-12-31 | 1,186,000,000 | 2025-05-31 | 1,188,015,740 | 2025-07-09 | unavailable |
| COST | 2013 | dimensionless | 2012-12-31 | 432,350,000 | 2012-09-02 | 432,424,379 | 2012-10-05 | issued only |
| COST | 2018 | dimensionless | 2017-12-29 | 437,204,000 | 2017-09-03 | 436,989,606 | 2017-10-10 | issued only |
| COST | 2026 | dimensionless | 2025-12-31 | 443,237,000 | 2025-08-31 | 443,179,176 | 2025-09-30 | issued only |
| HD | 2013 | dimensionless | 2012-12-31 | 1,537,000,000 | 2012-01-29 | 1,523,263,533 | 2012-03-14 | 1,537,000,000 (TreasuryStockShares) |
| HD | 2018 | dimensionless | 2017-12-29 | 1,203,000,000 | 2017-01-29 | 1,202,918,166 | 2017-03-03 | 1,203,000,000 (TreasuryStockShares) |
| HD | 2026 | dimensionless | 2025-12-31 | 994,000,000 | 2025-02-02 | 994,032,168 | 2025-03-05 | 994,000,000 |

rows=104

## 6. 통계

| 지표 | Candidate A (us-gaap) | Candidate B (DEI) |
|---|---|---|
| resolved | 83 / 104 | 81 / 104 |
| December 세션과 instant 정확히 일치 | **23** | **3** |
| `NO_INSTANT_ON_OR_BEFORE_DECEMBER` | 15 | 23 |
| `TIE_UNRESOLVED` | 6 | 0 |
| staleness median | 182일 | 297일 |
| staleness p90 | 363일 | 2,891일 |
| staleness max | 5,083일 | 4,748일 |
| 400일 초과 stale | 4 | 36 |

A/B 동일 scope·instant 비교(모든 accession의 scope×instant cell 기준):

| 지표 | 값 |
|---|---|
| A와 B가 같은 scope·instant에 함께 존재 | **5** |
| 그중 값이 정확히 같음 | 3 |
| 그중 값이 다름 | 2 (모두 CMCSA, §12.1) |
| B만 있는 cell | 89 |
| A만 있는 cell | 306 |

Candidate D 가용성(104개 관측 기준):

| 지표 | 값 |
|---|---|
| 같은 scope에 `TreasuryStockCommonShares`가 있어 정의대로 재구성 가능 | **5** |
| `TreasuryStockShares`(common+preferred)만 있음 | 16 |
| issued는 있는데 같은 scope에 treasury 없음 | 63 |
| 같은 scope에 issued 자체가 없음 | 20 |

별도로 전체 scope×instant cell에서 issued가 있는 184개를 보면, 재구성 가능한 43개 중
42개가 direct outstanding과 일치하고 1개가 어긋난다(§12.6).

**이 숫자로 coverage Gate C를 판정하지 않는다.** §2.3의 10-K-only 한계가 A·B 양쪽의
`NO_INSTANT`와 staleness를 모두 부풀린다.

## 7. 반례

로드맵 작업지시 §12가 요구한 10개를 순서대로 확인했다.

### 7.1 DEI와 us-gaap이 같은 class·instant인데 값이 다름 — 있다 (CMCSA)

`0001166691-18-000004`, instant 2017-12-31:

| concept | member | value | `decimals` |
|---|---|---|---|
| us-gaap:CommonStockSharesOutstanding | CommonClassAMember | 4,635,063,642 | INF |
| us-gaap:CommonStockSharesOutstanding | CommonClassAMember | 4,635,000,000 | -6 |
| dei:EntityCommonStockSharesOutstanding | CommonClassAMember | 4,635,063,642 | INF |
| us-gaap:CommonStockSharesOutstanding | CommonClassBMember | 9,444,375 | INF |
| us-gaap:CommonStockSharesOutstanding | CommonClassBMember | 9,000,000 | -6 |
| dei:EntityCommonStockSharesOutstanding | CommonClassBMember | 9,444,375 | INF |

**ground truth**: 같은 accession의 rendered cover page(`R1.htm`, "Document and Entity Information")는
Class A `4,635,063,642`, Class B `9,444,375`로 표시한다. 즉 `-6` 값은 백만 단위로 반올림한
대차대조표 부기(parenthetical) 표시이고 정확값은 INF 쪽이다.

주의할 점은 **불일치가 A와 B 사이가 아니라 A 안에 있다**는 것이다. us-gaap 쪽이 같은
class·instant에 정밀도가 다른 두 fact를 갖고, DEI는 정확한 것 하나만 갖는다. 현재 계약의
semantic uniqueness(`값·decimals·unit·기간·dimension` 중 하나라도 갈리면 AMBIGUOUS)로는
**A가 AMBIGUOUS이고 B가 유일**이다. 표본의 A `TIE_UNRESOLVED` 6건은 전부 이 형태다
(CMCSA 4건, NWS 2건 — NWS는 376,718,696 대 377,000,000, 188,666,990 대 189,000,000).

### 7.2 DEI instant가 표지 날짜라 December selector의 의미가 달라짐 — 있다 (구조적)

| issuer | filing | us-gaap outstanding instant | DEI instant |
|---|---|---|---|
| BRK | FY2012 10-K | 2012-12-31 | 2013-02-18 |
| BRK | FY2017 10-K | 2017-12-31 | 2018-02-13 |
| BRK | FY2025 10-K | 2025-12-31 | 2026-01-31 |
| GOOGL | FY2017 10-K | 2017-12-31 | 2018-01-31 |
| F | FY2025 10-K | (없음) | 2026-02-06 |
| AAPL | FY2025 10-K | 2025-09-27 | 2025-10-17 |

12월 결산 발행사에서 이 차이는 치명적이다. FY t-1 10-K의 DEI instant는 t년 2월이라
**t-1년 12월 세션 이하가 아니다.** 그래서 그 filing이 usable해도(acceptance 2월 ≤ formation 6월)
DEI fact는 December cut에서 탈락하고 더 옛 filing으로 떨어진다. 표본에서:

- BRK 2018 formation: A는 2016-12-31(FY2016 10-K), B는 **2013-02-18**
- GOOGL 2026 formation: A는 2025-12-31, B는 **2018-01-31**
- META 2026 formation: A는 2025-12-31, B는 **2018-01-29**

반대로 us-gaap fact는 12월 결산 발행사에서 **December 측정일에 정확히 앉는다**.
표본의 `exact_December` 23건은 대부분 이 경우다. 10-Q를 넣으면 B의 낙폭은 줄지만
**B가 December 세션에 정확히 앉는 일은 구조적으로 없다**(표본 3/104).

### 7.3 multi-class filing인데 us-gaap outstanding이 dimensionless total뿐 — 이 표본에는 없다

Alphabet은 total과 children이 **공존**한다(§4.2). total만 있고 children이 없는
multi-class outstanding 사례는 이 20개 표본에서 찾지 못했다. **없다고 단정하지 않는다** —
표본 밖에 존재할 수 있고, §4.1의 조건("class-dimensional fact가 없을 때만 dimensionless를
sole class로 매핑")은 그런 filing을 fail-close로 만든다.

### 7.4 class-dimensional DEI는 있는데 us-gaap class fact가 없음 — 있다 (Ford, AbbVie)

**Ford**는 10-K 3개(2013·2018·2026 accession)에서 `us-gaap:CommonStockSharesOutstanding` fact가
**0개**다. 대신 `CommonStockSharesIssued`를 class scope로, outstanding을 DEI로만 보고한다.

| accession | concept | instant | member | value |
|---|---|---|---|---|
| 0000037996-18-000015 | CommonStockSharesIssued | 2017-12-31 | CommonStockMember | 3,987,000,000 |
| 0000037996-18-000015 | CommonStockSharesIssued | 2017-12-31 | CommonClassBMember | 71,000,000 |
| 0000037996-18-000015 | EntityCommonStockSharesOutstanding | 2018-01-31 | CommonStockMember | 3,902,499,580 |
| 0000037996-18-000015 | EntityCommonStockSharesOutstanding | 2018-01-31 | CommonClassBMember | 70,852,076 |

**ground truth**: 같은 accession의 rendered `R1.htm`이 "Common Stock [Member] · Entity Common
Stock, Shares Outstanding · 3,902,499,580 · Class B Stock [Member] · ... · 70,852,076"으로 표시한다.

이것이 10-K 표본 편향인지 확인하려고 Ford와 AbbVie의 10-Q를 각각 3개(초기·중간·최근) 더 읽었다.

| issuer | 10-Q accession | report | 발견된 concept |
|---|---|---|---|
| F | 0000037996-12-000023 | 2012-03-31 | CommonStockSharesIssued, EntityCommonStockSharesOutstanding |
| F | 0000037996-19-000067 | 2019-06-30 | CommonStockSharesIssued, EntityCommonStockSharesOutstanding |
| F | 0000037996-26-000156 | 2026-06-30 | (대상 concept 없음) |
| ABBV | 0001104659-13-038917 | 2013-03-31 | CommonStockSharesIssued, TreasuryStockShares, EntityCommonStockSharesOutstanding |
| ABBV | 0001551152-19-000030 | 2019-09-30 | CommonStockSharesIssued, TreasuryStockShares, EntityCommonStockSharesOutstanding |
| ABBV | 0001551152-26-000026 | 2026-06-30 | CommonStockSharesIssued, TreasuryStockCommonShares, EntityCommonStockSharesOutstanding |

**두 발행사 모두 10-Q에서도 `us-gaap:CommonStockSharesOutstanding`을 태깅하지 않는다.**
Candidate A 단독은 이 발행사들에 대해 **전 기간 영구 MISSING**이다. 표본 20개 중 2개(10%)이고,
"어느 해에 놓친다"가 아니라 "그 발행사가 존재하는 내내 못 쓴다"는 성질이다.

또 Ford의 ordinary class member 이름이 `CommonStockMember`라는 점도 기록해 둔다.
`CommonClassAMember` 같은 이름 규칙으로 ordinary class를 찾으면 Ford의 주력 class를 놓친다.

### 7.5 반대 상황 — 있다 (Alphabet)

`0001652044-18-000007`에서 us-gaap class fact는 2016-12-31·2017-12-31에 있는데 DEI는
2018-01-31에만 있다. 2018 formation의 December cut(2017-12-29)에서 A는 2016-12-31로 해결되고
B는 `NO_INSTANT_ON_OR_BEFORE_DECEMBER`다. Berkshire 2013 formation, Meta 2013 formation,
Intel 2013 formation, Mastercard 2013 formation도 같은 형태다.

### 7.6 issued − treasury가 direct outstanding과 다름 — 있다 (NVIDIA)

`0001045810-17-000027`, dimensionless, instant 2016-01-31:
issued − `TreasuryStockShares` = **538,000,000**, direct outstanding = **539,000,000**.
두 fact 모두 `decimals=-6`이라 백만 단위 반올림 잔차다. 재구성 가능한 43개 중 42개는 일치하고
이 1개가 어긋난다. **재구성이 direct와 동치가 아님을 보이는 데는 1개로 충분하다** —
반올림된 두 값을 빼면 오차가 합쳐진다.

### 7.7 treasury가 aggregate뿐이라 class 재구성 불가 — 있다

`TreasuryStockCommonShares`가 같은 scope에 있는 관측은 104개 중 5개다. 16개는
`TreasuryStockShares`만 있다. 그 concept의 공식 정의는 "common **and preferred** shares"라
common 재구성에 쓰면 preferred treasury까지 빼게 된다. Berkshire는 이 concept만 쓴다.

Nike·News Corp·Visa B1/B2는 같은 class scope에 issued 자체가 없어 재구성이 시작조차 안 된다.

### 7.8 dimensionless sole-class 매핑이 공식 semantic과 충돌 — 있다 (Nike)

`0001193125-12-312306`(FY2012 10-K)의 DEI:

| instant | scope | value |
|---|---|---|
| 2012-07-19 | dimensionless | 455,870,220 |
| 2012-07-19 | CommonClassAMember | 89,892,248 |
| 2012-07-19 | CommonClassBMember | 365,977,972 |

`89,892,248 + 365,977,972 = 455,870,220`. dimensionless는 총계다. Guide §3.2.3이 case 1과
case 2를 "mutually exclusive"라고 못박았으므로 이 filing은 그 규칙을 어긴 것이고, 동시에
**"dimensionless가 있으면 sole class"라는 추정이 실제 filing에서 깨진다는 증거**다.
Nike는 이후 filing(2017·2025)에서는 class fact만 낸다.

### 7.9 unknown/derived member가 direct shares concept에 붙음 — 있다 (BRK, Visa)

§4.3에 적었다. BRK `EquivalentClassAMember`(2024-12-31에 1,438,223)가
`us-gaap:CommonStockSharesOutstanding`에 직접 붙고, Visa `CommonClassB1AndB2Member`가
자기 children과 같은 axis에 공존한다.

### 7.10 같은 class·instant의 duplicate concept가 `decimals`/값 충돌 — 있다

§7.1과 같다. 6건 전부 "정확값(INF) + 백만 단위 반올림(-6)" 쌍이다.

### 7.11 추가로 발견한 것 — stale value trap (작업지시에 없던 반례)

`December 이하 latest instant` 규칙만 쓰면 **MISSING이 아니라 그럴듯한 옛 값**이 나온다.

- **Walmart**: `us-gaap:CommonStockSharesOutstanding` dimensionless fact가 표본 전체에서 2개뿐이고
  전부 2012 filing에 있다. 2013·2018·2026 formation 모두 **2012-01-31의 3,418,000,000**을 돌려준다.
  2026 formation 기준 staleness 5,083일이다.
- **Visa `CommonClassBMember`**: Visa는 2024년에 Class B를 B1/B2로 재편했다. 2026 formation에서
  B1(2025-09-30, 5,000,000)·B2(2025-09-30, 120,000,000)와 함께 **옛 B(2017-09-30, 245,000,000)**가
  같이 해결된다. identity에서 B를 은퇴 처리하지 않으면 ME_issuer가 Class B를 이중 계상한다.

400일 초과 stale은 A 4건, B 36건이다(§2.3 한계 반영해서 읽어야 한다).
**이 실패는 값이 그럴듯해서 조용하다.** 현재 계약에는 이를 막는 조건이 없다.

## 8. Candidate별 평가

### 8.1 Candidate A — us-gaap outstanding only

- **경제적 의미**: 정확하다. "Number of shares of common stock outstanding".
- **PIT / December 정합**: 가장 좋다. 재무제표 instant라 12월 결산 발행사에서 측정일에 정확히 앉는다(23/104, 10-Q 없이).
- **class scope**: 좋다. class-dimensional 보고가 일반적이다.
- **치명적 결함 둘**: (1) Ford·AbbVie처럼 이 concept을 아예 쓰지 않는 발행사가 있고 그 부재는 영구적이다.
  (2) 같은 class·instant에 정밀도 다른 duplicate가 있어 현재 uniqueness 규칙에서 AMBIGUOUS가 된다(6/104).

### 8.2 Candidate B — DEI cover-page outstanding only

- **경제적 의미**: 정확하다. 표지에 기재된 실제 발행주식수다.
- **PIT / December 정합**: **구조적으로 나쁘다.** instant가 기간 말 이후라 December cut에서
  해당 연도 10-K의 fact가 탈락한다. 10-Q를 넣어도 December 세션에 정확히 앉지 않는다.
- **class scope**: 좋다. Guide가 case 2/3를 강제한다.
- **강점**: duplicate 충돌이 없었고(0/104), us-gaap을 안 쓰는 발행사도 덮는다.
- **결론**: 단독으로 December denominator를 정의하기엔 instant 의미가 맞지 않는다.

### 8.3 Candidate C — direct reported outstanding concepts의 명시적 hierarchy

작업지시가 요구한 조사 네 가지에 대한 답이다.

- **같은 class·instant에서 A와 B가 정확히 같은 값인가**: 함께 나타나는 5개 cell 중 3개가 정확히 같고
  2개가 다르다. 다른 2개의 차이는 A 내부의 반올림 duplicate 때문이지 A와 B의 semantic 차이가 아니다.
- **값이 다르면 어느 semantic 때문인가**: `decimals` 정밀도다. 표지 값이 정확값이고 부기 표시가 반올림값이다.
- **same-instant conflict를 결정론적으로 풀 구조적 근거가 있는가**: **있다.** 두 fact가 `decimals`
  구간으로 서로 모순되지 않으면(현재 코드의 `half_width()` 의미) 더 정밀한 쪽이 같은 값의 더 정확한 표현이다.
  이것은 임의 tolerance가 아니라 XBRL `decimals`의 정의다. 구간이 모순되면 fail-close한다.
- **source concept precedence가 필요한가**: **필요하다.** 하지만 그 이유는 값 충돌이 아니라 **instant 의미**다.
  A와 B는 사실상 겹치지 않으므로(5/400) "둘을 모아 latest instant를 고르는" union은 관측마다
  measurement instant의 의미를 조용히 바꾼다. 그래서 union이 아니라 **class별 precedence**여야 한다.

정리하면 C는 "A ∪ B에서 최신"이 아니라 다음 형태여야 한다.

1. 그 class에 대해 `us-gaap:CommonStockSharesOutstanding`이 usable filing 어디엔가 있으면 A만 쓴다.
2. 같은 class·instant에 A fact가 여럿이면 `decimals` 구간 일관성으로 검사해 더 정밀한 것을 쓰고,
   모순이면 MISSING.
3. 그 class에 A fact가 **하나도 없을 때만** `dei:EntityCommonStockSharesOutstanding`을 쓰고,
   그 관측을 별도 `share_source`로 표시해 나중에 분리·배제할 수 있게 한다.
4. §4.1·§4.2·§4.3의 dimension shape 규칙은 두 concept에 동일하게 적용한다.

### 8.4 Candidate D — issued − treasury fallback

- 정의대로(`TreasuryStockCommonShares`) 같은 scope·instant에서 재구성 가능한 관측은 104개 중 5개다.
- 16개는 `TreasuryStockShares`만 있는데 그 concept은 preferred를 포함하므로 **대체 불가**다.
- 63개는 issued만 있고 treasury가 같은 scope에 없다.
- 재구성이 되는 곳에서도 direct와 어긋나는 사례가 있다(§7.6).
- **판정: generic fallback으로 쓰지 않는다.** 진단용으로도 `TreasuryStockCommonShares`가
  같은 class·instant에 있을 때만 의미가 있다.

## 9. ground truth 확인 범위

정직하게 적는다. **104개 행 전부를 사람이 rendered SEC 출력과 1:1 대조하지 않았다.**

사람이 원문과 직접 대조한 것:

| 대상 | 대조한 원문 | 결과 |
|---|---|---|
| CMCSA FY2017 Class A/B | `0001166691-18-000004` rendered `R1.htm` 표지 | 4,635,063,642 / 9,444,375 — DEI(INF)와 일치, us-gaap `-6` 값은 반올림 표시 |
| Ford FY2012 class | `0000037996-13-000014` rendered `R1.htm` | 3,851,395,591 / 70,852,076 |
| Ford FY2017 class | `0000037996-18-000015` rendered `R1.htm` | Common Stock 3,902,499,580 / Class B 70,852,076 |
| Ford FY2025 표지 | `0000037996-26-000015` rendered `R1.htm` | Common Stock 3,918,623,149 (12(b) 등록증권 표에 Class B 없음) |

산술로 tie-out한 것:

- Alphabet 4개 instant: dimensionless total == class children 합 (§4.2)
- Visa 2개 instant: `CommonClassB1AndB2Member` == B1 + B2 (§4.3)
- Nike FY2012: DEI dimensionless == Class A + Class B (§7.8)
- Berkshire: issued − treasury == direct outstanding (§5 표의 D 칸)

나머지 행은 **구조 분류(concept·instant·axis·member·status)만 검증했고 값의 경제적 정확성을
개별 확인하지 않았다.** §6 통계는 그 전제에서 읽어야 한다. 특히 "correct / wrong" 칸을
따로 만들지 않은 이유가 이것이다 — 104개를 전부 대조하지 않은 상태에서 그 칸을 채우면
Candidate 결과를 ground truth로 재사용하는 셈이 된다(작업지시 §11 금지사항).

## 10. QName representation 권고

**표본에서 확인한 사실**: axis QName의 namespace는 taxonomy 연도마다 바뀐다.

| axis namespace | 출현 |
|---|---|
| `http://fasb.org/us-gaap/2011-01-31` | 31 |
| `http://fasb.org/us-gaap/2012-01-31` | 61 |
| `http://fasb.org/us-gaap/2016-01-31` | 37 |
| `http://fasb.org/us-gaap/2017-01-31` | 87 |
| `http://fasb.org/us-gaap/2024` | 59 |
| `http://fasb.org/us-gaap/2025` | 140 |

member도 마찬가지다(표준 386회 / issuer-extension 29회).

`qv_xbrl.QName`은 `namespace URI + local`을 보존하고, `qv_identity.resolve_member()`는
`xbrl_axis`·`xbrl_member`를 **exact TEXT 비교**한다. 현재 fixture는
`"us-gaap:StatementClassOfStockAxis"`(prefix 포함)와 `"ClassACommonStockMember"`(prefix 없음)를
섞어 쓴다. 둘 다 그대로는 파서 출력과 연결되지 않는다.

- **prefix 문자열(`us-gaap:...`)은 쓰면 안 된다.** prefix는 문서 로컬 alias라 같은 namespace를
  `usgaap:`·`us-gaap:`로 쓰는 filing이 있으면 매칭이 깨진다. 이 계약이 이미 채택한 원칙이다.
- **full namespace URI + local을 그대로 exact match해도 안 된다.** 위 표처럼 URI가 해마다 바뀌므로
  class 하나당 taxonomy 연도 수만큼 identity 행이 필요해진다. 2011~2026이면 class당 10행 이상이다.

**권고**: 두 칸으로 나누고 namespace는 URI가 아니라 **정규화된 family token**을 저장한다.

```
xbrl_axis_ns      TEXT   -- 'us-gaap' | 'dei' | 'ext:<CIK>'
xbrl_axis_local   TEXT   -- 'StatementClassOfStockAxis'
xbrl_member_ns    TEXT   -- 'us-gaap' | 'ext:<CIK>'
xbrl_member_local TEXT   -- 'CapitalClassCMember'
```

- `us-gaap` / `dei` 판정은 이미 있는 `qv_xbrl.is_us_gaap()` · `is_dei()`(namespace prefix 집합 기반)를
  재사용한다. 새 판정 로직을 만들지 않는다.
- 표준 namespace가 아니면 `ext:<발행사 CIK>`로 둔다. issuer-extension member는 발행사 안에서만
  의미가 있으므로 CIK로 scope를 잠가야 다른 발행사의 동명 member와 섞이지 않는다.
  같은 local name이 서로 다른 발행사의 extension namespace에 각각 선언될 수 있으므로
  CIK 없이 local name만 맞추면 다른 회사의 class와 섞인다.
- 표준 family로 정규화되지 않는 namespace가 나오면 **추정하지 않고 unresolved**로 둔다.

이 probe에서는 schema를 바꾸지 않았다. 위는 Step 4 본구현 때의 권고다.

## 11. 미해결로 남긴 것

1. **staleness 상한이 계약에 없다**(§7.11). "December 이하 latest instant"만으로는 concept을
   그만 태깅한 발행사에서 조용히 옛 값이 나온다. 후보는 (a) 절대 일수 상한, (b) "가장 최근
   usable annual filing에 그 fact가 있어야 한다"는 조건, (c) 둘 다. **이 probe는 어느 것도 고르지 않는다** —
   기준을 결과를 보고 정하면 그 자체가 결과 조정이다.
2. **은퇴한 class를 identity가 어떻게 표시하는지**(§7.11 Visa B). ME_issuer 이중 계상을 막는
   책임이 identity에 있는지 share selector에 있는지 정해지지 않았다.
3. **multi-class인데 us-gaap outstanding이 total뿐인 filing**을 이 표본에서 못 찾았다(§7.3).
   존재하지 않는다는 증거가 아니다.
4. **`decimals` 구간 일관성으로 정밀도 높은 fact를 고르는 규칙**은 §8.3의 제안일 뿐 아직 계약이 아니다.
   현재 코드의 uniqueness는 `decimals`가 다르면 AMBIGUOUS다. 바꾸려면 별도 freeze가 필요하다.

## User decision

추천: **C — direct reported outstanding concepts의 명시적 structural hierarchy.**

근거를 작업지시 §17이 요구한 항목별로 적는다.

- **economic meaning**: A와 B 모두 공식 정의상 "actual shares outstanding"이다. 어느 쪽도
  파생·근사가 아니다. D만 재구성이고, 재구성은 §7.6·§7.7에서 동치가 아님이 확인됐다.
- **PIT correctness**: A는 재무제표 instant, B는 표지 instant다. 둘 다 filing acceptance가
  formation 이전이면 look-ahead가 아니다. PIT 자체는 둘 다 안전하다.
- **class scope correctness**: 둘 다 Guide §6.4.2의 class axis를 쓴다. 차이가 없다.
- **December denominator alignment**: **A가 명백히 우월하다.** December 세션 정확 일치가
  A 23건 / B 3건이고, B는 표지 instant라 12월 결산 발행사에서 구조적으로 December에 앉지 못한다.
  그래서 hierarchy의 1순위는 A여야 한다.
- **old/recent compatibility**: 두 concept 모두 2011 taxonomy부터 2025 taxonomy까지 표본 전 구간에서
  나타난다. 어느 쪽도 시기 편향이 없다.
- **deterministic tie semantics**: A는 `decimals` duplicate로 6/104가 AMBIGUOUS다. 이 충돌은
  XBRL `decimals` 정의로 결정론적으로 풀 수 있고(더 정밀한 fact가 같은 값의 더 정확한 표현),
  구간이 모순되면 fail-close한다. 임의 규칙이 아니다. B는 duplicate 충돌이 0이었다.
- **arbitrary fallback 여부**: C의 fallback은 "A가 그 class에 **하나도 없을 때만** B"라는
  concept-level 규칙이고, 발행사 이름이나 결과 숫자에 의존하지 않는다. issuer whitelist가 아니다.
  D처럼 없는 값을 component로 만들어내지도 않는다.
- **expected missingness**: A 단독은 Ford·AbbVie 같은 발행사를 **영구히** 잃는다(표본 20개 중 2개).
  이것은 "coverage가 나쁘다"가 아니라 **선택한 concept이 그 발행사의 보고 관행과 맞지 않는다**는
  문제다. B는 그 발행사들을 덮지만 December 정합을 전부에서 포기한다. C는 각 class마다
  더 잘 맞는 쪽을 결정론적으로 고른다.
- **issuer-specific exception 필요 여부**: C는 필요 없다. 규칙이 concept 존재 여부만 본다.

**C를 고르는 이유가 coverage가 아니라는 점을 분명히 한다.** A와 B는 같은 경제량을 보고하는
두 공식 concept이고, 어느 쪽도 다른 쪽을 지배하지 않는다 — A는 instant가 맞고 B는 가용성이 넓다.
단일 concept을 고르면 둘 중 하나의 결함을 전부 떠안는다. C는 **관측마다 임의로 고르는 것이
아니라, class 단위로 A를 우선하고 A가 구조적으로 존재하지 않을 때만 B로 내려가는 고정 순서**다.
그리고 B에서 온 관측은 `share_source`로 구분되므로 나중에 "B-sourced만 빼고 다시 본다"가 가능하다.
A 단독을 택하면 그 관측들은 존재 자체가 사라져 그런 재검토가 불가능하다.

**다만 반대 선택도 방어 가능하다는 점을 적어 둔다.** "December denominator는 재무제표 instant여야
한다"를 절대 조건으로 두면 A 단독 + Ford/AbbVie MISSING이 일관된 선택이다. 그 경우 잃는 것은
표본 기준 발행사 10%이고, 얻는 것은 measurement instant 의미의 단일성이다. 이 trade-off는
데이터가 아니라 설계 판단이므로 사용자가 정할 문제다.

**C를 채택할 경우 함께 정해야 하는 것**(§11):

1. `decimals` duplicate 해소 규칙을 별도로 freeze한다. 지금 계약대로면 CMCSA·NWS는 A에서
   AMBIGUOUS라 자동으로 B로 내려가는데, 그것은 fallback의 의도가 아니다.
   fallback 조건은 "AMBIGUOUS일 때"가 아니라 "**fact가 없을 때**"여야 한다.
2. staleness 상한을 정한다. C를 택하든 A를 택하든 §7.11의 조용한 오류는 그대로 남는다.

**Candidate D는 채택하지 않는다.** 진단 목적으로 `TreasuryStockCommonShares`가 같은
class·instant에 있을 때 direct outstanding과 대조하는 것까지만 의미가 있다.

---

# Follow-up — December shares selector의 freshness boundary (2026-08-27)

> **Status: RESEARCH EVIDENCE ONLY.** 위 본문과 같다. 설계 승인·freeze가 아니고 production
> code/schema/test/roadmap의 의미를 바꾸지 않는다. coverage Gate C · `coverage_start` ·
> formation rank · B/M · returns는 이번에도 계산하지 않았다.

시작 main: `eb739d7378b28483dbab8af41bd3108bb0e209d2`
(`research(qv): PIT share-count mapping을 검증한다` — 위 본문을 커밋한 그 지점이고
`origin/main`도 같았다.)

**이번에 다시 열지 않은 것.** 승인된 Candidate C의 방향(`us-gaap:CommonStockSharesOutstanding`
우선, 그 class에서 구조적으로 absent일 때만 `dei:EntityCommonStockSharesOutstanding`)은
그대로 두고 재비교하지 않았다. `AMBIGUOUS`인 A를 이유로 B로 내려가지 않는다는 규칙,
issued − treasury 재구성 금지, companyfacts 금지, dimension shape 규칙(dimensionless =
전 class 총계 · class fact는 exact axis/member · derived/aggregate member 제외)도 고정으로 뒀다.

## F1. 이번 질문 하나

> **December t-1 shares selector가 과거의 stale share count를 조용히 재사용하지 않도록
> 어떤 freshness boundary를 둘 것인가?**

§7.11이 남긴 구멍이다. `December 이하 latest instant`만 보면 그 concept을 오래전에 그만
쓴 발행사에서 `MISSING`이 아니라 **그럴듯한 옛 숫자**가 나온다. §11의 미해결 1번이다.

## F2. 가장 중요한 방법 수정 — 10-K-only를 버렸다

§2.3이 스스로 적어둔 한계를 이번에 없앴다. **production contract가 허용하는 네 form을 전부
넣었다**: `10-K` · `10-K/A` · `10-Q` · `10-Q/A`. 각 formation에서 `historical_usable_session`이
그 formation 이하인 filing만 쓰고 acceptance 이후 정보만 썼다. §14 통계의 10-K-only 숫자를
그대로 재사용하지 않았다.

표본은 §2.1의 20개 발행사와 early/middle/recent 세 formation(`2013` · `2018` · `2026`)을
그대로 재사용했다. **새 성과 표본을 고르지 않았다.**

| formation | formation session | December session (t-1) |
|---|---|---|
| 2013 | 2013-06-28 | 2012-12-31 |
| 2018 | 2018-06-29 | 2017-12-29 |
| 2026 | 2026-06-30 | 2025-12-31 |

세션 달력은 본구현과 같은 `bars_daily` SPY `eodhd/eodhd-15y-2026-08`이다.

### F2.1 실제로 읽은 양

| 항목 | 수 |
|---|---|
| `filed_date >= 2009-01-01`인 K/Q family filing | 1,321 |
| 그중 2026 formation까지 usable | **1,303** (10-Q 955 · 10-K 323 · 10-K/A 21 · 10-Q/A 4) |
| instance를 실제로 파싱한 accession | **1,248** |
| XBRL instance가 없는 accession | 55 |
| 뽑은 direct outstanding fact | **8,758** (A 6,622 · B 2,136) |

instance는 `qv_xbrl.parse_instance()`로 그대로 읽었고 `entity` identifier가 대상 CIK가 아닌
fact는 버렸다. **XBRL이 없는 55건은 결함이 아니다** — 2009~2011 phase-in 이전 filing,
XBRL을 붙이지 않은 Part III 성격의 `10-K/A`, 그리고 신설 발행사의 첫 10-K
(ABBV `0001047469-13-002827`, NWS `0001193125-13-373501`)다. ABBV 첫 10-K는 accession
디렉터리에 `.xml`이 한 개도 없음을 원문에서 확인했다.

> **파서 함정 하나.** `index.json`이 일부 accession에서 파일 목록을 전부 주지 않는다.
> Apple FY2021 10-K(`0000320193-21-000105`)의 `index.json`은 item이 4개뿐인데 실제 filing에는
> 문서가 88개 있고 `aapl-20210925_htm.xml`도 있다. `-index.html`로 다시 읽는 fallback을
> 넣기 전에는 이 filing들이 통째로 `NO_XBRL`로 빠졌다. **본구현에서 accession 파일 목록을
> `index.json` 하나로만 판정하면 안 된다.**

## F3. 관측 단위 — 124개 (§5의 104와 다른 이유)

관측 단위는 §2.2와 같은 (issuer, formation, class scope)다. 이번에는 pool이 10-Q까지 넓어져
**§5에 없던 class scope가 더 드러났다.** §5의 104행을 재현한 것이 아니라 같은 표본을 더 넓은
filing pool로 다시 센 것이다.

- `dimensionless`는 §4.1 그대로 **총계**로 본다. 그 발행사에 class-dimensional direct
  outstanding fact가 하나라도 있으면 `dimensionless`를 class 관측으로 세지 않았다.
- derived/aggregate member(`EquivalentClassAMember` · `CommonClassB1AndB2Member`)는 제외했다.
- 남은 124개가 아래 표의 행이다.

**새로 드러난 scope의 정체가 이번 연구의 절반이다.** 대부분이 **같은 class의 옛 member 표기**다.

| issuer | 한 class를 가리키는 member 표기들 | 각 표기가 쓰인 instant 구간 |
|---|---|---|
| CMCSA (Class A Special) | `ClassSpecialCommonStockMember` | 2007-12-31 .. 2011-09-30 |
| | `CommonClassASpecialMember` | 2008-12-31 .. 2010-03-31 |
| | `ClassASpecialCommonStockMember` | 2008-12-31 .. 2012-03-31 |
| | `ClassaSpecialCommonStockMember` | 2009-12-31 .. 2017-12-31 |
| V (Class C) | `ClassCCommonStockMember` | 2008-09-30 .. 2016-06-21 |
| | `CommonClassCMember` | 2010-09-30 .. 2026-04-21 |
| V (Class B → B1/B2) | `CommonClassBMember` | 2008-09-30 .. 2024-01-17 |
| | `CommonClassB1Member` / `CommonClassB2Member` | 2023-09-30 .. 2026-04-21 |

**이것은 freshness가 아니라 identity 문제다.** §4.4.1이 이미 요구하는 명시적 axis/member 등록이
정본이고, 등록되지 않은 표기는 관측이 되면 안 된다. 다만 **freshness rule이 이 표기들을 어떻게
다루는지가 아래 결과를 지배하므로** 여기 적어 둔다.

## F4. Candidate 정의

결과를 보기 전에 고정했고 결과를 본 뒤 조건을 바꾸지 않았다.

```text
S0  baseline        instant <= December last session 중 latest instant. staleness 제한 없음.
                    tier 판정도 현재의 naive 해석 그대로 — 그 class에 A fact가
                    usable filing 어디엔가 하나라도 있으면 A tier로 본다.

S1  calendar-year   January 1 of t-1 <= instant <= December last session of t-1 인
                    관측만 eligible. 일수 knob 없음.

S2  annual-presence formation 시점 가장 최근 usable 10-K family accession에
                    그 class scope의 해당 concept이 존재해야 그 tier가 active.
                    실제 December 관측 선택은 K/Q 전체 pool에서 한다.

S3  = S1 AND S2

S4  absolute day cap   diagnostic only. 366 / 400 / 456 / 731일.
```

**hierarchy와 freshness의 결합**(작업지시 §12)은 이렇게 구현했다.

```text
S0     : "A가 없다" = history 전체에 A fact가 없다        (현재 naive 해석)
S1~S4  : "A가 없다" = freshness boundary 안에 usable A가 없다

어느 candidate에서든
    eligible fresh A 있음        -> A 사용
    eligible fresh A가 AMBIGUOUS -> fail-close. B로 내려가지 않는다.
    eligible fresh A 없음        -> 그때만 B를 본다. B도 같은 freshness rule을 만족해야 한다.
```

`AMBIGUOUS` 판정은 §13의 현재 contract 그대로다 — **같은 instant에 값 또는 `decimals`가
다른 fact가 있으면 AMBIGUOUS**이고, 더 정밀한 값으로 임의 해결하지 않았다.

## F5. 결과 표 — 124개 관측

`A` = `us-gaap:CommonStockSharesOutstanding`, `B` = `dei:EntityCommonStockSharesOutstanding`.
`FAIL_CLOSE` = 그 candidate의 freshness rule을 만족하는 관측이 A·B 어디에도 없어 멈춘 것,
`NO_INSTANT` = December 이하 instant 자체가 없는 것, `AMBIGUOUS` = §13 contract대로 fail-close.
December session은 F2의 표대로 formation에서 결정된다.

| issuer | formation | class scope | S0 baseline | S1 calendar-year | S2 annual-presence | S3 combined |
|---|---|---|---|---|---|---|
| AAPL | 2013 | dimensionless | A 2012-12-29 938,973,000 | A 2012-12-29 938,973,000 | A 2012-12-29 938,973,000 | A 2012-12-29 938,973,000 |
| AAPL | 2018 | dimensionless | A 2017-09-30 5,126,201,000 | A 2017-09-30 5,126,201,000 | A 2017-09-30 5,126,201,000 | A 2017-09-30 5,126,201,000 |
| AAPL | 2026 | dimensionless | A 2025-12-27 14,702,703,000 | A 2025-12-27 14,702,703,000 | A 2025-12-27 14,702,703,000 | A 2025-12-27 14,702,703,000 |
| GOOGL | 2018 | CapitalClassCMember | A 2017-09-30 349,473,000 | A 2017-09-30 349,473,000 | A 2017-09-30 349,473,000 | A 2017-09-30 349,473,000 |
| GOOGL | 2018 | CommonClassAMember | A 2017-09-30 298,263,000 | A 2017-09-30 298,263,000 | A 2017-09-30 298,263,000 | A 2017-09-30 298,263,000 |
| GOOGL | 2018 | CommonClassBMember | A 2017-09-30 47,054,000 | A 2017-09-30 47,054,000 | A 2017-09-30 47,054,000 | A 2017-09-30 47,054,000 |
| GOOGL | 2026 | CapitalClassCMember | A 2025-12-31 5,429,000,000 | A 2025-12-31 5,429,000,000 | A 2025-12-31 5,429,000,000 | A 2025-12-31 5,429,000,000 |
| GOOGL | 2026 | CommonClassAMember | A 2025-12-31 5,822,000,000 | A 2025-12-31 5,822,000,000 | A 2025-12-31 5,822,000,000 | A 2025-12-31 5,822,000,000 |
| GOOGL | 2026 | CommonClassBMember | A 2025-12-31 837,000,000 | A 2025-12-31 837,000,000 | A 2025-12-31 837,000,000 | A 2025-12-31 837,000,000 |
| BRK | 2013 | CommonClassAMember | A 2012-12-31 894,955 | A 2012-12-31 894,955 | A 2012-12-31 894,955 | A 2012-12-31 894,955 |
| BRK | 2013 | CommonClassBMember | A 2012-12-31 1,121,985,472 | A 2012-12-31 1,121,985,472 | A 2012-12-31 1,121,985,472 | A 2012-12-31 1,121,985,472 |
| BRK | 2018 | CommonClassAMember | A 2017-09-30 754,684 | A 2017-09-30 754,684 | A 2017-09-30 754,684 | A 2017-09-30 754,684 |
| BRK | 2018 | CommonClassBMember | A 2017-09-30 1,335,048,578 | A 2017-09-30 1,335,048,578 | A 2017-09-30 1,335,048,578 | A 2017-09-30 1,335,048,578 |
| BRK | 2026 | CommonClassAMember | A 2025-12-31 515,835 | A 2025-12-31 515,835 | A 2025-12-31 515,835 | A 2025-12-31 515,835 |
| BRK | 2026 | CommonClassBMember | A 2025-12-31 1,383,582,639 | A 2025-12-31 1,383,582,639 | A 2025-12-31 1,383,582,639 | A 2025-12-31 1,383,582,639 |
| NVDA | 2013 | dimensionless | A 2012-01-29 612,191,412 | A 2012-01-29 612,191,412 | A 2012-01-29 612,191,412 | A 2012-01-29 612,191,412 |
| NVDA | 2018 | dimensionless | A 2017-01-29 585,000,000 | A 2017-01-29 585,000,000 | A 2017-01-29 585,000,000 | A 2017-01-29 585,000,000 |
| NVDA | 2026 | dimensionless | A 2025-01-26 24,477,000,000 | A 2025-01-26 24,477,000,000 | A 2025-01-26 24,477,000,000 | A 2025-01-26 24,477,000,000 |
| TSLA | 2013 | dimensionless | A 2012-12-31 114,214,274 | A 2012-12-31 114,214,274 | A 2012-12-31 114,214,274 | A 2012-12-31 114,214,274 |
| TSLA | 2018 | dimensionless | A 2017-09-30 168,017,000 | A 2017-09-30 168,017,000 | A 2017-09-30 168,017,000 | A 2017-09-30 168,017,000 |
| TSLA | 2026 | dimensionless | A 2025-12-31 3,751,000,000 | A 2025-12-31 3,751,000,000 | B 2025-10-16 3,325,819,167 | B 2025-10-16 3,325,819,167 |
| XOM | 2013 | dimensionless | A 2012-09-30 4,559,342,639 | A 2012-09-30 4,559,342,639 | B 2012-09-30 4,559,342,639 | B 2012-09-30 4,559,342,639 |
| XOM | 2018 | dimensionless | A 2017-09-30 4,237,000,000 | A 2017-09-30 4,237,000,000 | A 2017-09-30 4,237,000,000 | A 2017-09-30 4,237,000,000 |
| XOM | 2026 | dimensionless | A 2025-12-31 4,179,000,000 | A 2025-12-31 4,179,000,000 | A 2025-12-31 4,179,000,000 | A 2025-12-31 4,179,000,000 |
| WMT | 2013 | dimensionless | A 2012-01-31 3,418,000,000 | A 2012-01-31 3,418,000,000 | B 2012-11-30 3,345,237,845 | B 2012-11-30 3,345,237,845 |
| WMT | 2018 | dimensionless | A 2012-01-31 3,418,000,000 | B 2017-11-29 2,962,381,445 | B 2017-11-29 2,962,381,445 | B 2017-11-29 2,962,381,445 |
| WMT | 2026 | dimensionless | A 2012-01-31 3,418,000,000 | B 2025-12-02 7,970,166,964 | B 2025-12-02 7,970,166,964 | B 2025-12-02 7,970,166,964 |
| INTC | 2013 | dimensionless | A 2012-12-29 4,944,000,000 | A 2012-12-29 4,944,000,000 | A 2012-12-29 4,944,000,000 | A 2012-12-29 4,944,000,000 |
| INTC | 2018 | dimensionless | A 2017-09-30 4,680,000,000 | A 2017-09-30 4,680,000,000 | A 2017-09-30 4,680,000,000 | A 2017-09-30 4,680,000,000 |
| INTC | 2026 | dimensionless | A 2025-12-27 4,994,000,000 | A 2025-12-27 4,994,000,000 | A 2025-12-27 4,994,000,000 | A 2025-12-27 4,994,000,000 |
| ABBV | 2013 | dimensionless | NO_INSTANT | NO_INSTANT | NO_INSTANT | NO_INSTANT |
| ABBV | 2018 | dimensionless | B 2017-10-24 1,596,429,740 | B 2017-10-24 1,596,429,740 | B 2017-10-24 1,596,429,740 | B 2017-10-24 1,596,429,740 |
| ABBV | 2026 | dimensionless | B 2025-10-27 1,767,384,632 | B 2025-10-27 1,767,384,632 | B 2025-10-27 1,767,384,632 | B 2025-10-27 1,767,384,632 |
| FOX | 2026 | CommonClassAMember | A 2025-12-31 200,553,435 | A 2025-12-31 200,553,435 | A 2025-12-31 200,553,435 | A 2025-12-31 200,553,435 |
| FOX | 2026 | CommonClassBMember | A 2025-12-31 224,702,222 | A 2025-12-31 224,702,222 | A 2025-12-31 224,702,222 | A 2025-12-31 224,702,222 |
| META | 2013 | CommonClassAMember | AMBIGUOUS | AMBIGUOUS | AMBIGUOUS | AMBIGUOUS |
| META | 2013 | CommonClassBMember | AMBIGUOUS | AMBIGUOUS | AMBIGUOUS | AMBIGUOUS |
| META | 2018 | CommonClassAMember | A 2017-09-30 2,385,000,000 | A 2017-09-30 2,385,000,000 | A 2017-09-30 2,385,000,000 | A 2017-09-30 2,385,000,000 |
| META | 2018 | CommonClassBMember | A 2017-09-30 521,000,000 | A 2017-09-30 521,000,000 | A 2017-09-30 521,000,000 | A 2017-09-30 521,000,000 |
| META | 2026 | CommonClassAMember | A 2025-12-31 2,187,000,000 | A 2025-12-31 2,187,000,000 | A 2025-12-31 2,187,000,000 | A 2025-12-31 2,187,000,000 |
| META | 2026 | CommonClassBMember | A 2025-12-31 343,000,000 | A 2025-12-31 343,000,000 | A 2025-12-31 343,000,000 | A 2025-12-31 343,000,000 |
| F | 2013 | CommonClassBMember | B 2012-10-26 70,852,076 | B 2012-10-26 70,852,076 | B 2012-10-26 70,852,076 | B 2012-10-26 70,852,076 |
| F | 2013 | CommonStockMember | B 2012-10-26 3,741,809,920 | B 2012-10-26 3,741,809,920 | B 2012-10-26 3,741,809,920 | B 2012-10-26 3,741,809,920 |
| F | 2018 | CommonClassBMember | B 2017-10-19 70,852,076 | B 2017-10-19 70,852,076 | FAIL_CLOSE | FAIL_CLOSE |
| F | 2018 | CommonStockMember | B 2017-10-19 3,901,450,116 | B 2017-10-19 3,901,450,116 | FAIL_CLOSE | FAIL_CLOSE |
| F | 2026 | CommonClassBMember | B 2025-10-21 70,852,076 | B 2025-10-21 70,852,076 | B 2025-10-21 70,852,076 | B 2025-10-21 70,852,076 |
| F | 2026 | CommonStockMember | B 2025-10-21 3,913,646,490 | B 2025-10-21 3,913,646,490 | B 2025-10-21 3,913,646,490 | B 2025-10-21 3,913,646,490 |
| CMCSA | 2013 | ClassASpecialCommonStockMember | A 2012-03-31 577,031,322 | A 2012-03-31 577,031,322 | FAIL_CLOSE | FAIL_CLOSE |
| CMCSA | 2013 | ClassSpecialCommonStockMember | A 2011-09-30 622,816,473 | FAIL_CLOSE | FAIL_CLOSE | FAIL_CLOSE |
| CMCSA | 2013 | ClassaSpecialCommonStockMember | A 2012-12-31 507,769,463 | A 2012-12-31 507,769,463 | A 2012-12-31 507,769,463 | A 2012-12-31 507,769,463 |
| CMCSA | 2013 | CommonClassAMember | A 2012-12-31 2,122,278,635 | A 2012-12-31 2,122,278,635 | A 2012-12-31 2,122,278,635 | A 2012-12-31 2,122,278,635 |
| CMCSA | 2013 | CommonClassASpecialMember | A 2010-03-31 745,871,969 | FAIL_CLOSE | FAIL_CLOSE | FAIL_CLOSE |
| CMCSA | 2013 | CommonClassBMember | A 2012-12-31 9,444,375 | A 2012-12-31 9,444,375 | A 2012-12-31 9,444,375 | A 2012-12-31 9,444,375 |
| CMCSA | 2018 | ClassASpecialCommonStockMember | A 2012-03-31 577,031,322 | FAIL_CLOSE | FAIL_CLOSE | FAIL_CLOSE |
| CMCSA | 2018 | ClassSpecialCommonStockMember | A 2011-09-30 622,816,473 | FAIL_CLOSE | FAIL_CLOSE | FAIL_CLOSE |
| CMCSA | 2018 | ClassaSpecialCommonStockMember | A 2016-12-31 0 | FAIL_CLOSE | A 2016-12-31 0 | FAIL_CLOSE |
| CMCSA | 2018 | CommonClassAMember | A 2017-09-30 4,664,327,455 | A 2017-09-30 4,664,327,455 | A 2017-09-30 4,664,327,455 | A 2017-09-30 4,664,327,455 |
| CMCSA | 2018 | CommonClassASpecialMember | A 2010-03-31 745,871,969 | FAIL_CLOSE | FAIL_CLOSE | FAIL_CLOSE |
| CMCSA | 2018 | CommonClassBMember | A 2017-09-30 9,444,375 | A 2017-09-30 9,444,375 | A 2017-09-30 9,444,375 | A 2017-09-30 9,444,375 |
| CMCSA | 2026 | ClassASpecialCommonStockMember | A 2012-03-31 577,031,322 | FAIL_CLOSE | FAIL_CLOSE | FAIL_CLOSE |
| CMCSA | 2026 | ClassSpecialCommonStockMember | A 2011-09-30 622,816,473 | FAIL_CLOSE | FAIL_CLOSE | FAIL_CLOSE |
| CMCSA | 2026 | ClassaSpecialCommonStockMember | A 2017-12-31 0 | FAIL_CLOSE | FAIL_CLOSE | FAIL_CLOSE |
| CMCSA | 2026 | CommonClassAMember | AMBIGUOUS | AMBIGUOUS | AMBIGUOUS | AMBIGUOUS |
| CMCSA | 2026 | CommonClassASpecialMember | A 2010-03-31 745,871,969 | FAIL_CLOSE | FAIL_CLOSE | FAIL_CLOSE |
| CMCSA | 2026 | CommonClassBMember | AMBIGUOUS | AMBIGUOUS | AMBIGUOUS | AMBIGUOUS |
| NWS | 2018 | CommonClassAMember | A 2017-09-30 382,976,281 | A 2017-09-30 382,976,281 | A 2017-09-30 382,976,281 | A 2017-09-30 382,976,281 |
| NWS | 2018 | CommonClassBMember | A 2017-09-30 199,630,240 | A 2017-09-30 199,630,240 | A 2017-09-30 199,630,240 | A 2017-09-30 199,630,240 |
| NWS | 2018 | SeriesCommonStockMember | A 2017-06-30 0 | A 2017-06-30 0 | A 2017-06-30 0 | A 2017-06-30 0 |
| NWS | 2026 | CommonClassAMember | A 2025-12-31 371,777,267 | A 2025-12-31 371,777,267 | A 2025-12-31 371,777,267 | A 2025-12-31 371,777,267 |
| NWS | 2026 | CommonClassBMember | A 2025-12-31 185,853,935 | A 2025-12-31 185,853,935 | A 2025-12-31 185,853,935 | A 2025-12-31 185,853,935 |
| NWS | 2026 | SeriesCommonStockMember | A 2025-06-30 0 | A 2025-06-30 0 | A 2025-06-30 0 | A 2025-06-30 0 |
| UA | 2013 | CommonClassAMember | A 2012-12-31 83,461,106 | A 2012-12-31 83,461,106 | A 2012-12-31 83,461,106 | A 2012-12-31 83,461,106 |
| UA | 2013 | ConvertibleCommonStockMember | A 2012-12-31 21,300,000 | A 2012-12-31 21,300,000 | A 2012-12-31 21,300,000 | A 2012-12-31 21,300,000 |
| UA | 2018 | CommonClassAMember | A 2017-09-30 185,128,757 | A 2017-09-30 185,128,757 | A 2017-09-30 185,128,757 | A 2017-09-30 185,128,757 |
| UA | 2018 | CommonClassCMember | A 2017-09-30 222,050,824 | A 2017-09-30 222,050,824 | A 2017-09-30 222,050,824 | A 2017-09-30 222,050,824 |
| UA | 2018 | ConvertibleCommonStockMember | A 2017-09-30 34,450,000 | A 2017-09-30 34,450,000 | A 2017-09-30 34,450,000 | A 2017-09-30 34,450,000 |
| UA | 2026 | CommonClassAMember | A 2025-12-31 188,834,386 | A 2025-12-31 188,834,386 | A 2025-12-31 188,834,386 | A 2025-12-31 188,834,386 |
| UA | 2026 | CommonClassCMember | A 2025-12-31 202,487,254 | A 2025-12-31 202,487,254 | A 2025-12-31 202,487,254 | A 2025-12-31 202,487,254 |
| UA | 2026 | ConvertibleCommonStockMember | A 2025-12-31 34,450,000 | A 2025-12-31 34,450,000 | A 2025-12-31 34,450,000 | A 2025-12-31 34,450,000 |
| V | 2013 | ClassCCommonStockMember | A 2011-03-31 64,000,000 | FAIL_CLOSE | FAIL_CLOSE | FAIL_CLOSE |
| V | 2013 | ClassCSeriesICommonStockMember | A 2009-09-30 0 | FAIL_CLOSE | FAIL_CLOSE | FAIL_CLOSE |
| V | 2013 | ClassCSeriesIIICommonStockMember | A 2009-09-30 0 | FAIL_CLOSE | FAIL_CLOSE | FAIL_CLOSE |
| V | 2013 | ClassCSeriesIVCommonStockMember | A 2009-09-30 0 | FAIL_CLOSE | FAIL_CLOSE | FAIL_CLOSE |
| V | 2013 | CommonClassAMember | A 2012-12-31 530,000,000 | A 2012-12-31 530,000,000 | A 2012-12-31 530,000,000 | A 2012-12-31 530,000,000 |
| V | 2013 | CommonClassBMember | A 2012-12-31 245,000,000 | A 2012-12-31 245,000,000 | A 2012-12-31 245,000,000 | A 2012-12-31 245,000,000 |
| V | 2013 | CommonClassCMember | A 2012-12-31 29,000,000 | A 2012-12-31 29,000,000 | A 2012-12-31 29,000,000 | A 2012-12-31 29,000,000 |
| V | 2018 | ClassCCommonStockMember | A 2016-06-21 550,000 | FAIL_CLOSE | FAIL_CLOSE | FAIL_CLOSE |
| V | 2018 | ClassCSeriesICommonStockMember | A 2009-09-30 0 | FAIL_CLOSE | FAIL_CLOSE | FAIL_CLOSE |
| V | 2018 | ClassCSeriesIIICommonStockMember | A 2009-09-30 0 | FAIL_CLOSE | FAIL_CLOSE | FAIL_CLOSE |
| V | 2018 | ClassCSeriesIVCommonStockMember | A 2009-09-30 0 | FAIL_CLOSE | FAIL_CLOSE | FAIL_CLOSE |
| V | 2018 | CommonClassAMember | A 2017-09-30 1,818,000,000 | A 2017-09-30 1,818,000,000 | A 2017-09-30 1,818,000,000 | A 2017-09-30 1,818,000,000 |
| V | 2018 | CommonClassBMember | A 2017-09-30 245,000,000 | A 2017-09-30 245,000,000 | A 2017-09-30 245,000,000 | A 2017-09-30 245,000,000 |
| V | 2018 | CommonClassCMember | A 2017-09-30 13,000,000 | A 2017-09-30 13,000,000 | A 2017-09-30 13,000,000 | A 2017-09-30 13,000,000 |
| V | 2026 | ClassCCommonStockMember | A 2016-06-21 550,000 | FAIL_CLOSE | FAIL_CLOSE | FAIL_CLOSE |
| V | 2026 | ClassCSeriesICommonStockMember | A 2009-09-30 0 | FAIL_CLOSE | FAIL_CLOSE | FAIL_CLOSE |
| V | 2026 | ClassCSeriesIIICommonStockMember | A 2009-09-30 0 | FAIL_CLOSE | FAIL_CLOSE | FAIL_CLOSE |
| V | 2026 | ClassCSeriesIVCommonStockMember | A 2009-09-30 0 | FAIL_CLOSE | FAIL_CLOSE | FAIL_CLOSE |
| V | 2026 | CommonClassAMember | A 2025-12-31 1,683,000,000 | A 2025-12-31 1,683,000,000 | A 2025-12-31 1,683,000,000 | A 2025-12-31 1,683,000,000 |
| V | 2026 | CommonClassB1Member | A 2025-12-31 5,000,000 | A 2025-12-31 5,000,000 | A 2025-12-31 5,000,000 | A 2025-12-31 5,000,000 |
| V | 2026 | CommonClassB2Member | A 2025-12-31 120,000,000 | A 2025-12-31 120,000,000 | A 2025-12-31 120,000,000 | A 2025-12-31 120,000,000 |
| V | 2026 | CommonClassBMember | A 2023-12-31 245,000,000 | FAIL_CLOSE | FAIL_CLOSE | FAIL_CLOSE |
| V | 2026 | CommonClassCMember | A 2025-12-31 9,000,000 | A 2025-12-31 9,000,000 | A 2025-12-31 9,000,000 | A 2025-12-31 9,000,000 |
| V | 2026 | CommonStockMember | A 2023-12-31 1,836,000,000 | FAIL_CLOSE | FAIL_CLOSE | FAIL_CLOSE |
| MA | 2013 | CommonClassAMember | A 2012-12-31 118,405,075 | A 2012-12-31 118,405,075 | A 2012-12-31 118,405,075 | A 2012-12-31 118,405,075 |
| MA | 2013 | CommonClassBMember | A 2012-12-31 4,838,840 | A 2012-12-31 4,838,840 | A 2012-12-31 4,838,840 | A 2012-12-31 4,838,840 |
| MA | 2013 | CommonStockAdditionalSeriesMember | A 2010-12-31 0 | FAIL_CLOSE | FAIL_CLOSE | FAIL_CLOSE |
| MA | 2018 | CommonClassAMember | A 2017-09-30 1,045,000,000 | A 2017-09-30 1,045,000,000 | A 2017-09-30 1,045,000,000 | A 2017-09-30 1,045,000,000 |
| MA | 2018 | CommonClassBMember | A 2017-09-30 15,000,000 | A 2017-09-30 15,000,000 | A 2017-09-30 15,000,000 | A 2017-09-30 15,000,000 |
| MA | 2018 | CommonStockAdditionalSeriesMember | A 2010-12-31 0 | FAIL_CLOSE | FAIL_CLOSE | FAIL_CLOSE |
| MA | 2026 | CommonClassAMember | AMBIGUOUS | AMBIGUOUS | AMBIGUOUS | AMBIGUOUS |
| MA | 2026 | CommonClassBMember | AMBIGUOUS | AMBIGUOUS | AMBIGUOUS | AMBIGUOUS |
| MA | 2026 | CommonStockAdditionalSeriesMember | A 2010-12-31 0 | FAIL_CLOSE | FAIL_CLOSE | FAIL_CLOSE |
| NKE | 2013 | CommonClassAMember | A 2012-11-30 180,000,000 | A 2012-11-30 180,000,000 | A 2012-11-30 180,000,000 | A 2012-11-30 180,000,000 |
| NKE | 2013 | CommonClassBMember | A 2012-11-30 716,000,000 | A 2012-11-30 716,000,000 | A 2012-11-30 716,000,000 | A 2012-11-30 716,000,000 |
| NKE | 2018 | CommonClassAMember | A 2017-11-30 329,000,000 | A 2017-11-30 329,000,000 | A 2017-11-30 329,000,000 | A 2017-11-30 329,000,000 |
| NKE | 2018 | CommonClassBMember | A 2017-11-30 1,295,000,000 | A 2017-11-30 1,295,000,000 | A 2017-11-30 1,295,000,000 | A 2017-11-30 1,295,000,000 |
| NKE | 2026 | CommonClassAMember | A 2025-11-30 289,000,000 | A 2025-11-30 289,000,000 | A 2025-11-30 289,000,000 | A 2025-11-30 289,000,000 |
| NKE | 2026 | CommonClassBMember | A 2025-11-30 1,191,000,000 | A 2025-11-30 1,191,000,000 | A 2025-11-30 1,191,000,000 | A 2025-11-30 1,191,000,000 |
| COST | 2013 | dimensionless | A 2012-11-25 434,824,000 | A 2012-11-25 434,824,000 | A 2012-11-25 434,824,000 | A 2012-11-25 434,824,000 |
| COST | 2018 | dimensionless | A 2017-11-26 439,185,000 | A 2017-11-26 439,185,000 | A 2017-11-26 439,185,000 | A 2017-11-26 439,185,000 |
| COST | 2026 | dimensionless | A 2025-11-23 443,919,000 | A 2025-11-23 443,919,000 | A 2025-11-23 443,919,000 | A 2025-11-23 443,919,000 |
| HD | 2013 | dimensionless | A 2012-10-28 1,496,000,000 | A 2012-10-28 1,496,000,000 | A 2012-10-28 1,496,000,000 | A 2012-10-28 1,496,000,000 |
| HD | 2018 | dimensionless | A 2017-10-29 1,168,000,000 | A 2017-10-29 1,168,000,000 | A 2017-10-29 1,168,000,000 | A 2017-10-29 1,168,000,000 |
| HD | 2026 | dimensionless | A 2025-11-02 995,000,000 | A 2025-11-02 995,000,000 | A 2025-11-02 995,000,000 | A 2025-11-02 995,000,000 |

## F6. 통계

**이 숫자는 Gate C가 아니다.** 20개 적대적 표본의 구조 비교이고 coverage 추정이 아니다.

| 지표 | S0 baseline | S1 calendar-year | S2 annual-presence | S3 combined |
|---|---|---|---|---|
| resolved | 117 | 90 | 88 | 87 |
| — A tier | 109 | 80 | 77 | 76 |
| — B tier | 8 | 10 | 11 | 11 |
| `AMBIGUOUS` (fail-close, B 금지) | 6 | 6 | 6 | 6 |
| fail-close missing | 1 | 28 | 30 | 31 |
| — fresh A 없고 B fact 자체가 없음 | 0 | 10 | 10 | 10 |
| — 양쪽에 관측은 있으나 fresh가 없음 | 0 | 17 | 19 | 20 |
| — December 이하 instant 자체가 없음 | 1 | 1 | 1 | 1 |
| **선택된 값의 age > 366일** | **28** | **0** | **0** | **0** |
| age median (일) | 90 | 33 | 31 | 31 |
| age max (일) | **5,936** | 339 | 363 | 339 |

`AMBIGUOUS` 6건은 네 candidate에서 **완전히 같은 집합**이다(META 2013 A/B, CMCSA 2026 A/B,
MA 2026 A/B). **freshness rule은 ambiguity를 만들지도 없애지도 않는다.**

### F6.1 A stale-only 때문에 fresh B가 막히는 사례

작업지시 §12가 명시적으로 세라고 한 failure다.

```text
S0 (history 전체로 "A가 있다"를 판정)  -> 2건   WMT 2018 · WMT 2026
S1 / S2 / S3 (boundary 안에서 판정)   -> 0건
```

두 건 모두 **A는 stale-only인데 같은 formation에 fresh B가 실제로 있었다.** boundary를
hierarchy **앞**에 두면 사라지고, 뒤에 두면 남는다. F10에서 다시 쓴다.

### F6.2 10-Q가 실제로 무엇을 고쳤나

§2.3이 "10-K-only라 staleness가 부풀어 있다"고 적었는데, **stale trap에 대해서는 거의 틀렸다.**

| 비교 | 값 |
|---|---|
| 같은 표본을 10-K family만으로 S0 실행했을 때 age > 366일 | 30 |
| 10-K + 10-Q 전량으로 S0 실행했을 때 age > 366일 | **28** |
| 10-Q 추가가 없앤 stale case | **2** (둘 다 F 2026, 1,430일 → 71일) |
| 10-Q 추가로 instant가 더 최근이 된 관측 | 64 |
| 10-K family만으로는 아예 해결되지 않던 관측 | 8 |

**10-Q는 instant의 최신성을 크게 개선하지만(64건) 조용한 stale trap은 2건밖에 못 고친다.**
stale trap의 원인이 "그 분기 filing이 표본에 없어서"가 아니라 **"그 발행사·그 class가 그
concept·그 member 표기를 아예 그만 썼기 때문"**이기 때문이다.

## F7. WMT — motivating failure는 10-Q를 넣어도 그대로다

`us-gaap:CommonStockSharesOutstanding`을 class/dimensionless context에 태깅한 WMT filing은
**1,303개 usable filing 전체에서 세 개뿐**이다.

| instant | value | `decimals` | accession | form | acceptance |
|---|---|---|---|---|---|
| 2009-01-31 | 3,925,000,000 | -6 | 0001193125-10-071652 | 10-K | 2010-03-30 |
| 2010-01-31 | 3,786,000,000 | -6 | 0001193125-10-071652 · 0001193125-11-083157 | 10-K | 2010-03-30 · 2011-03-30 |
| 2011-01-31 | 3,516,000,000 | -6 / INF | 0001193125-11-083157 · 0001193125-12-134679 | 10-K | 2011-03-30 · 2012-03-27 |
| 2012-01-31 | **3,418,000,000** | INF | 0001193125-12-134679 | 10-K | 2012-03-27 |

**2012-03-27 이후 14년 동안 한 번도 없다.** 같은 기간 DEI fact는 70개이고 가장 최근이
2026-05-27이다.

원문 대조(§15 요구):

- WMT FY2012 10-K rendered `R4.htm`(`0001193125-12-134679`)의 대차대조표 부기에
  `Common stock, shares outstanding 3,418,000,000 / 3,516,000,000`이 있고 element는
  `us-gaap_CommonStockSharesOutstanding`이다. **값 자체는 옳다.**
- WMT FY2026 10-K rendered `R1.htm`(`0000104169-26-000055`)의 표지는
  `Entity Common Stock, Shares Outstanding 7,972,402,501`이다.

결과:

| formation | S0 | S1 | S2 | S3 |
|---|---|---|---|---|
| 2013 | A 2012-01-31 3,418,000,000 | A 2012-01-31 3,418,000,000 | B 2012-11-30 3,345,237,845 | B 2012-11-30 3,345,237,845 |
| 2018 | **A 2012-01-31 3,418,000,000** (2,159일) | B 2017-11-29 2,962,381,445 | B 2017-11-29 2,962,381,445 | B 2017-11-29 2,962,381,445 |
| 2026 | **A 2012-01-31 3,418,000,000** (5,083일) | B 2025-12-02 7,970,166,964 | B 2025-12-02 7,970,166,964 | B 2025-12-02 7,970,166,964 |

**2026 formation의 오차는 단순한 낡음이 아니다.** 2024-02 3:1 split 이전 단위의 수량을
split 이후 raw close에 곱하게 되므로 ME가 약 2.3배 축소되고, `B/M`은 그만큼 부풀어
**WMT가 value 랭크 상위로 잘못 올라간다.** 값이 그럴듯해서 어떤 검증도 울리지 않는다.

### F7.1 WMT 사례에서 새로 드러난 것 — dimension shape가 진짜 원인의 절반이다

WMT FY2026 10-K instance(`wmt-20260131_htm.xml`)를 직접 열어보면
`us-gaap:CommonStockSharesOutstanding`이 **살아 있다.**

```text
CommonStockSharesOutstanding  instant=2023-01-31  8,080,000,000  StatementEquityComponentsAxis / CommonStockMember
CommonStockSharesOutstanding  instant=2024-01-31  8,054,000,000  StatementEquityComponentsAxis / CommonStockMember
CommonStockSharesOutstanding  instant=2025-01-31  8,024,000,000  StatementEquityComponentsAxis / CommonStockMember
CommonStockSharesOutstanding  instant=2026-01-31  7,969,000,000  StatementEquityComponentsAxis / CommonStockMember
```

**class 축도 dimensionless도 아니고 자본변동표 축이다.** 즉 WMT는 concept을 버린 것이 아니라
**context shape를 옮겼다.** 표본 전체에서 이 모양이 적지 않다.

| A fact의 dimension shape | 수 |
|---|---|
| class axis 단독 | 3,286 |
| dimensionless | 1,121 |
| **그 밖의 축(자본변동표 축 등)** | **2,215** |

가장 많은 조합이 `StatementEquityComponentsAxis / CommonStockMember` 1,804개다.

**이번 연구는 dimension shape 계약을 CLOSED로 받고 시작했으므로 여기서 바꾸지 않았다.**
다만 두 가지는 기록해 둔다.

1. 이 shape를 관측으로 인정했다면 WMT 2026의 S0는 `2012-01-31`이 아니라 `2025-10-31`이
   됐을 것이다(28개 stale 관측 중 **이 완화로 달라지는 것은 WMT 2026 하나뿐**이다).
2. 그래도 **freshness boundary는 여전히 필요하다.** 나머지 27개 stale 관측은 완화해도
   더 최근 관측이 생기지 않는다(F8).

**둘은 독립한 결정이고, 이번 결론이 dimension shape 결정을 대신하지 않는다.**

## F8. S0의 stale 28건 전수

`age`는 December session − 선택된 instant다. `완화 shape`는 F7.1의 자본변동표 축·복수 축까지
인정했을 때 더 최근 관측이 생기는지다.

| issuer | formation | class scope | S0 선택 | value | age(일) | S1/S2/S3 | 완화 shape로 개선? |
|---|---|---|---|---|---|---|---|
| WMT | 2018 | dimensionless | A 2012-01-31 | 3,418,000,000 | 2,159 | 전부 B로 교정 | 아니오 |
| WMT | 2026 | dimensionless | A 2012-01-31 | 3,418,000,000 | 5,083 | 전부 B로 교정 | **예** (2025-10-31) |
| CMCSA | 2013 | ClassSpecialCommonStockMember | A 2011-09-30 | 622,816,473 | 458 | 전부 fail-close | 아니오 |
| CMCSA | 2013 | CommonClassASpecialMember | A 2010-03-31 | 745,871,969 | 1,006 | 전부 fail-close | 아니오 |
| CMCSA | 2018 | ClassASpecialCommonStockMember | A 2012-03-31 | 577,031,322 | 2,099 | 전부 fail-close | 아니오 |
| CMCSA | 2018 | ClassSpecialCommonStockMember | A 2011-09-30 | 622,816,473 | 2,282 | 전부 fail-close | 아니오 |
| CMCSA | 2018 | CommonClassASpecialMember | A 2010-03-31 | 745,871,969 | 2,830 | 전부 fail-close | 아니오 |
| CMCSA | 2026 | ClassASpecialCommonStockMember | A 2012-03-31 | 577,031,322 | 5,023 | 전부 fail-close | 아니오 |
| CMCSA | 2026 | ClassSpecialCommonStockMember | A 2011-09-30 | 622,816,473 | 5,206 | 전부 fail-close | 아니오 |
| CMCSA | 2026 | ClassaSpecialCommonStockMember | A 2017-12-31 | 0 | 2,922 | 전부 fail-close | 아니오 |
| CMCSA | 2026 | CommonClassASpecialMember | A 2010-03-31 | 745,871,969 | 5,754 | 전부 fail-close | 아니오 |
| V | 2013 | ClassCCommonStockMember | A 2011-03-31 | 64,000,000 | 641 | 전부 fail-close | 아니오 |
| V | 2013 | ClassCSeriesICommonStockMember | A 2009-09-30 | 0 | 1,188 | 전부 fail-close | 아니오 |
| V | 2013 | ClassCSeriesIIICommonStockMember | A 2009-09-30 | 0 | 1,188 | 전부 fail-close | 아니오 |
| V | 2013 | ClassCSeriesIVCommonStockMember | A 2009-09-30 | 0 | 1,188 | 전부 fail-close | 아니오 |
| V | 2018 | ClassCCommonStockMember | A 2016-06-21 | 550,000 | 556 | 전부 fail-close | 아니오 |
| V | 2018 | ClassCSeriesICommonStockMember | A 2009-09-30 | 0 | 3,012 | 전부 fail-close | 아니오 |
| V | 2018 | ClassCSeriesIIICommonStockMember | A 2009-09-30 | 0 | 3,012 | 전부 fail-close | 아니오 |
| V | 2018 | ClassCSeriesIVCommonStockMember | A 2009-09-30 | 0 | 3,012 | 전부 fail-close | 아니오 |
| V | 2026 | ClassCCommonStockMember | A 2016-06-21 | 550,000 | 3,480 | 전부 fail-close | 아니오 |
| V | 2026 | ClassCSeriesICommonStockMember | A 2009-09-30 | 0 | 5,936 | 전부 fail-close | 아니오 |
| V | 2026 | ClassCSeriesIIICommonStockMember | A 2009-09-30 | 0 | 5,936 | 전부 fail-close | 아니오 |
| V | 2026 | ClassCSeriesIVCommonStockMember | A 2009-09-30 | 0 | 5,936 | 전부 fail-close | 아니오 |
| V | 2026 | CommonClassBMember | A 2023-12-31 | 245,000,000 | 731 | 전부 fail-close | 아니오 |
| V | 2026 | CommonStockMember | A 2023-12-31 | 1,836,000,000 | 731 | 전부 fail-close | 아니오 |
| MA | 2013 | CommonStockAdditionalSeriesMember | A 2010-12-31 | 0 | 731 | 전부 fail-close | 아니오 |
| MA | 2018 | CommonStockAdditionalSeriesMember | A 2010-12-31 | 0 | 2,555 | 전부 fail-close | 아니오 |
| MA | 2026 | CommonStockAdditionalSeriesMember | A 2010-12-31 | 0 | 5,479 | 전부 fail-close | 아니오 |

**28건 중 26건이 "은퇴했거나 옛 표기인 class scope"다.** WMT 2건만이 살아 있는 class에서
값이 낡은 경우다. 세 freshness candidate 모두 28건 전부를 잘라낸다.

**살아 있는 ordinary class를 잃은 건은 S1에서 0건이다.**

## F9. Ford / AbbVie — S2가 깨지는 지점

**Ford**: `us-gaap:CommonStockSharesOutstanding`을 한 번도 쓰지 않는다는 §12.4 결론은 10-Q까지
넣은 이번에도 유지된다. B tier로 세 formation 모두 정상 해결된다 — **S0·S1에서는.**

**S2에서 Ford 2018이 통째로 사라진다.** 원인은 Ford가 아니라 `10-K/A`다.

```text
formation 2018-06-29 시점 가장 최근 usable 10-K family accession
    = 0000037996-18-000025   10-K/A   filed 2018-03-28
    이 accession의 파일 목록에 .xml이 하나도 없다 (원문 index.json 확인)
    -> direct outstanding fact 0개 -> A도 B도 active가 아님
    -> Ford 2018의 살아 있는 두 class(CommonStock, ClassB)가 fail-close missing
```

**TSLA 2026도 같은 함정을 다른 모양으로 밟는다.**

```text
formation 2026-06-30 시점 가장 최근 usable 10-K family accession
    = 0001104659-26-053166   10-K/A   filed 2026-04-30
    이 accession에는 DEI 표지 fact 하나뿐이다 (instant 2026-01-23)
    -> A tier가 active가 아니게 되어 S2는 2025-12-31 A 대신 2025-10-16 B를 고른다
```

TSLA는 실제로 FY2025 10-K과 이후 10-Q에서 A를 정상 태깅한다. **S2가 틀린 것이다.**

표본 56개 (issuer, formation) 중 가장 최근 usable annual accession이 `10-K/A`인 경우가
이렇게 존재하고, Part III 보충이나 재제출은 XBRL이 없거나 표지만 있는 것이 정상이다.
**`10-K family의 가장 최근 accession`이라는 정의 자체가 이 함정을 구조적으로 만든다.**

> **정의를 고쳐 다시 돌리지 않았다.** 작업지시 §10이 "S1이나 S2 결과를 본 뒤 조건을
> 변경하지 않는다"고 못박았고, 결과를 보고 `10-K만` 또는 `fact가 있는 가장 최근 annual`로
> 바꾸는 것은 정확히 그 금지다. 이 실패는 숨기지 않고 그대로 센다.

**AbbVie**: 세 candidate 모두 같다. 2018·2026은 B tier로 정상 해결되고
(`2017-10-24 1,596,429,740` · `2025-10-27 1,767,384,632`), **2013은 네 candidate 전부
`NO_INSTANT`다.** freshness 때문이 아니라 AbbVie의 첫 10-K(2013-03-15)에 XBRL이 없고
그 다음 10-Q의 표지 instant가 이미 December 2012보다 뒤이기 때문이다. **구조적 결측이고
어떤 freshness rule도 이것을 만들거나 고치지 않는다.**

## F10. non-calendar fiscal year — S1이 systematic false missing을 만드는가

**만들지 않는다.** 비12월 결산 발행사가 S1에서 잃은 살아 있는 class는 0이다.

| issuer | 회계연도 말 | S1 결과 (관측 3 formation 합) |
|---|---|---|
| AAPL | 9월 | A 3 |
| V | 9월 | A 10 · 나머지 14는 전부 은퇴 scope |
| COST | 8/9월 | A 3 |
| NWS | 6월 | A 6 |
| FOX | 6월 | A 2 |
| NKE | 5월 | A 6 |
| NVDA | 1월 | A 3 |
| HD | 1/2월 | A 3 |
| WMT | 1월 | A 1 · B 2 |
| UA | 12월 → 3월 (결산 변경) | A 8 |

이유는 구조적이다. **calendar-year boundary는 회계연도와 무관하게 "t-1년 중에 보고된
share state"만 요구**하는데, 어떤 결산월이든 t-1년 안에 최소 한 번은 대차대조표 instant
또는 표지 instant가 찍힌다. 1월 결산(NVDA·HD·WMT)은 그해 1월 말 instant가 t-1년 안에
들어오고, 52/53주 발행사(AAPL 2025-12-27 · INTC 2025-12-27 · HD 2025-11-02)도 마찬가지다.

**S1이 만드는 가장 낡은 관측은 339일이다.** 그 상한이 회계연도 구조에서 자동으로 나온다는
점이 중요하다 — 일수를 정해서 얻은 것이 아니다.

한 가지는 정직하게 적는다. **S1은 "그 해 안이지만 그 해 초의" 관측을 막지 않는다.**
NVDA 2013·2018·2026은 각각 1월 말 A instant(337·335·339일)를 고르고 같은 formation에
11월 DEI 표지가 있다. WMT 2013도 A `2012-01-31`(3,418,000,000)을 고르고 11월 DEI
`3,345,237,845`가 있다(차이 2.2%). **이것은 freshness 결함이 아니라 Candidate C의
"A 우선" 자체가 만드는 성질**이고, A가 재무제표 instant라 December 정렬이 낫다는 §8.3의
근거와 맞바꾼 것이다. 이번 연구는 그 hierarchy를 다시 열지 않는다.

## F11. hierarchy와 freshness의 정확한 결합 (작업지시 §12)

**결론: boundary는 hierarchy보다 앞에 있어야 한다.** "A가 없다"의 의미가 갈리는 지점이다.

| "A가 없다"의 의미 | WMT 2018 | WMT 2026 |
|---|---|---|
| history 전체에 A fact가 없다 (S0) | A 2012-01-31 3,418,000,000 · **B 영구 차단** | A 2012-01-31 3,418,000,000 · **B 영구 차단** |
| boundary 안에 usable A가 없다 (S1~) | B 2017-11-29 2,962,381,445 | B 2025-12-02 7,970,166,964 |

**stale A 때문에 fresh B가 막히는 구조는 S0에서 2건, S1/S2/S3에서 0건이다.**
Candidate C를 채택하면서 boundary를 hierarchy 뒤에 두면 WMT형 발행사는 **B가 있어도 영원히
옛 A를 쓴다.** 그래서 결합 순서는 이렇게 고정돼야 한다.

```text
1. 그 class scope에서 A의 eligible-fresh 집합을 만든다.
2. 비어 있지 않으면 A를 쓴다.
     같은 instant에 값·decimals가 갈리면 AMBIGUOUS -> fail-close. B로 내려가지 않는다.
3. 비어 있을 때만 B의 eligible-fresh 집합을 본다. B도 같은 boundary를 만족해야 한다.
4. 둘 다 비면 그 issuer-year는 MISSING이다. 옛 값을 쓰지 않는다.
```

2번의 `AMBIGUOUS`가 `fact 없음`과 다르다는 `User decision` 1번 주석은 이번에도 지켰다.
6건의 `AMBIGUOUS`는 네 candidate에서 모두 fail-close이고 **B로 내려간 건은 0이다.**

## F12. Candidate S4 — absolute day cap (diagnostic only)

같은 hierarchy에 boundary만 일수 상한으로 바꿔 돌렸다. **추천 후보로 쓰지 않는다.**

| cutoff | resolved | AMBIGUOUS | fail-close | S1과 다른 관측 |
|---|---|---|---|---|
| 366일 | 91 | 6 | 27 | 1 |
| 400일 | 91 | 6 | 27 | 1 |
| 456일 | 91 | 6 | 27 | 1 |
| 731일 | 97 | 6 | 21 | 7 |
| (S1) | 90 | 6 | 28 | — |

**366 · 400 · 456이 결과가 완전히 같다.** 이 표본은 그 구간 안에서 숫자를 식별하지 못한다.
S0의 age 분포에도 `339 · 363` 다음이 `458`이라 넓은 빈 구간이 있다. 즉 **여러 cutoff를
훑어 가장 coverage 좋은 값을 고르는 일이 가능하고, 그래서 하면 안 된다.**

366일 계열이 S1과 다른 단 하나는 CMCSA 2018 `ClassaSpecialCommonStockMember`
(A 2016-12-31, 값 0, 363일)를 **되살린다**는 것이다. 은퇴 표기이므로 되살리는 쪽이 나쁘다.
731일은 은퇴 scope 7개를 되살린다.

**외부 accounting/reporting semantic으로 독립 정당화되는 일수 근거를 찾지 못했다.**
`365`나 `366`은 "1년"이라는 직관에서 오는 숫자이지 SEC 보고 규칙이 정하는 경계가 아니다.
반면 `January 1 of t-1 ~ December last session of t-1`은 **December denominator의 정의 자체**에서
나온다. 그래서 S4는 추천하지 않는다.

## F13. 이번에 새로 드러난 반례들

1. **`10-K/A`가 annual-presence guard를 무력화한다** (F9). Ford 2018은 살아 있는 두 class를
   잃고 TSLA 2026은 더 정확한 A 대신 B를 고른다. S2·S3의 구조적 결함이다.
2. **member 표기 변경이 은퇴 class처럼 보인다** (F3). CMCSA Class A Special은 네 가지 표기,
   Visa Class C는 두 가지 표기를 갖는다. **freshness rule이 이것을 대부분 잘라내지만
   그것은 부수 효과이지 해법이 아니다** — 해법은 §4.4.1의 명시적 axis/member 등록이다.
3. **S1도 옛 표기를 완전히 막지는 못한다.** CMCSA 2013에서 `ClassASpecialCommonStockMember`
   (A 2012-03-31, 577,031,322)와 `ClassaSpecialCommonStockMember`(A 2012-12-31, 507,769,463)가
   **둘 다 in-year라 둘 다 통과한다.** 같은 class를 두 번 세게 된다. S2·S3는 이 한 건을 잡지만
   그 대가가 Ford 2018이다. **이 잔여 결함의 정본 해결은 identity 등록이지 freshness가 아니다.**
4. **`decimals` duplicate의 모양이 10-Q 때문에 달라진다** (§13은 열지 않지만 증거는 남긴다).
   CMCSA FY2025 10-K(`0001628280-26-004994`)은 같은 instant에 `INF 3,594,768,252`와
   `-6 3,595,000,000`을 함께 담고, 뒤이은 10-Q(`0001628280-26-026805`)는 `INF`만 담는다.
   반대로 META 2013은 10-K이 `INF 1,671,277,621`, 뒤의 10-Q가 `-6 1,671,000,000`이다.
   **roadmap §4.4.1의 `acceptance가 가장 늦은 filing` tie-break를 그대로 쓰면 META에서
   반올림값이 정밀값을 이긴다.** 이번 연구는 §13 contract대로 6건 전부 `AMBIGUOUS`로 두고
   해결하지 않았다. **이 반례는 decimals 결정에 넘긴다.**
5. **`index.json`이 accession 파일 목록을 다 주지 않는 경우가 있다** (F2.1).
6. **direct outstanding fact의 3분의 1이 class 축 밖에 있다** (F7.1).

## F14. ground truth 확인 범위

정직하게 적는다. **124개 행 전부를 사람이 rendered SEC 출력과 1:1 대조하지 않았다.**
§9와 같은 기준이다.

사람이 원문과 직접 대조한 것:

| 대상 | 대조한 원문 | 결과 |
|---|---|---|
| WMT FY2012 A 값 | `0001193125-12-134679` rendered `R4.htm` | `Common stock, shares outstanding 3,418,000,000 / 3,516,000,000`, element `us-gaap_CommonStockSharesOutstanding` |
| WMT FY2026 표지 | `0000104169-26-000055` rendered `R1.htm` | `Entity Common Stock, Shares Outstanding 7,972,402,501` |
| WMT FY2026 A의 실제 위치 | `wmt-20260131_htm.xml` instance | `StatementEquityComponentsAxis / CommonStockMember`, instant 2023-01-31 ~ 2026-01-31 |
| AAPL 2025-12-27 값 | `0000320193-26-000006` rendered `R4.htm` | `14,702,703 and 14,773,260 shares issued and outstanding` (천 단위) |
| Ford FY2017 `10-K/A` | `0000037996-18-000025` index.json | `.htm`·`.pdf`만 있고 XBRL 파일 0개 |
| TSLA FY2025 `10-K/A` | `0001104659-26-053166` 추출 fact | DEI 표지 fact 1개뿐 |
| ABBV 첫 10-K | `0001047469-13-002827` index.json | `.xml` 0개 |
| CMCSA `decimals` duplicate | `0001628280-26-004994` · `0001628280-26-026805` 추출 fact | INF/-6 공존 → 후속 10-Q는 INF만 |

filing 원장으로 확인한 것(사람이 rendered 출력을 열지는 않았다):

- WMT의 A fact가 1,303개 usable filing 중 세 accession에만 있다는 것
- CMCSA·Visa의 member 표기별 instant 구간 (F3 표)
- Visa `CommonClassBMember`의 마지막 관측이 A `2023-12-31` · B `2024-01-17`이고
  B1/B2는 `2023-09-30`부터라는 것

나머지 행은 **구조 분류(concept · instant · axis/member · status)만 검증했고 값의 경제적
정확성을 개별 확인하지 않았다.** §6·F6 통계는 그 전제에서 읽어야 한다.

## F15. 선택된 관측의 provenance — S1 기준 90건

작업지시 §15가 요구한 항목이다. **추천 candidate(S1)가 실제로 고른 관측만** 싣는다.
S0 대비 달라진 지점은 F5의 결과 표에서 candidate별로 바로 비교된다.

| issuer | formation | class scope | Dec session | concept | instant | value | form | accession | report_date | acceptance (UTC) | usable session |
|---|---|---|---|---|---|---|---|---|---|---|---|
| AAPL | 2013 | dimensionless | 2012-12-31 | us-gaap:CommonStockSharesOutstanding | 2012-12-29 | 938,973,000 | 10-Q | 0001193125-13-022339 | 2012-12-29 | 2013-01-24T22:01:37Z | 2013-01-25 |
| AAPL | 2018 | dimensionless | 2017-12-29 | us-gaap:CommonStockSharesOutstanding | 2017-09-30 | 5,126,201,000 | 10-K | 0000320193-17-000070 | 2017-09-30 | 2017-11-03T12:01:37Z | 2017-11-06 |
| AAPL | 2026 | dimensionless | 2025-12-31 | us-gaap:CommonStockSharesOutstanding | 2025-12-27 | 14,702,703,000 | 10-Q | 0000320193-26-000006 | 2025-12-27 | 2026-01-30T11:01:32Z | 2026-02-02 |
| GOOGL | 2018 | CapitalClassCMember | 2017-12-29 | us-gaap:CommonStockSharesOutstanding | 2017-09-30 | 349,473,000 | 10-Q | 0001652044-17-000042 | 2017-09-30 | 2017-10-26T21:49:09Z | 2017-10-27 |
| GOOGL | 2018 | CommonClassAMember | 2017-12-29 | us-gaap:CommonStockSharesOutstanding | 2017-09-30 | 298,263,000 | 10-Q | 0001652044-17-000042 | 2017-09-30 | 2017-10-26T21:49:09Z | 2017-10-27 |
| GOOGL | 2018 | CommonClassBMember | 2017-12-29 | us-gaap:CommonStockSharesOutstanding | 2017-09-30 | 47,054,000 | 10-Q | 0001652044-17-000042 | 2017-09-30 | 2017-10-26T21:49:09Z | 2017-10-27 |
| GOOGL | 2026 | CapitalClassCMember | 2025-12-31 | us-gaap:CommonStockSharesOutstanding | 2025-12-31 | 5,429,000,000 | 10-K | 0001652044-26-000018 | 2025-12-31 | 2026-02-05T02:56:03Z | 2026-02-05 |
| GOOGL | 2026 | CommonClassAMember | 2025-12-31 | us-gaap:CommonStockSharesOutstanding | 2025-12-31 | 5,822,000,000 | 10-K | 0001652044-26-000018 | 2025-12-31 | 2026-02-05T02:56:03Z | 2026-02-05 |
| GOOGL | 2026 | CommonClassBMember | 2025-12-31 | us-gaap:CommonStockSharesOutstanding | 2025-12-31 | 837,000,000 | 10-K | 0001652044-26-000018 | 2025-12-31 | 2026-02-05T02:56:03Z | 2026-02-05 |
| BRK | 2013 | CommonClassAMember | 2012-12-31 | us-gaap:CommonStockSharesOutstanding | 2012-12-31 | 894,955 | 10-K | 0001193125-13-087679 | 2012-12-31 | 2013-03-01T21:10:21Z | 2013-03-04 |
| BRK | 2013 | CommonClassBMember | 2012-12-31 | us-gaap:CommonStockSharesOutstanding | 2012-12-31 | 1,121,985,472 | 10-K | 0001193125-13-087679 | 2012-12-31 | 2013-03-01T21:10:21Z | 2013-03-04 |
| BRK | 2018 | CommonClassAMember | 2017-12-29 | us-gaap:CommonStockSharesOutstanding | 2017-09-30 | 754,684 | 10-Q | 0001193125-17-332829 | 2017-09-30 | 2017-11-03T20:17:23Z | 2017-11-06 |
| BRK | 2018 | CommonClassBMember | 2017-12-29 | us-gaap:CommonStockSharesOutstanding | 2017-09-30 | 1,335,048,578 | 10-Q | 0001193125-17-332829 | 2017-09-30 | 2017-11-03T20:17:23Z | 2017-11-06 |
| BRK | 2026 | CommonClassAMember | 2025-12-31 | us-gaap:CommonStockSharesOutstanding | 2025-12-31 | 515,835 | 10-K | 0001193125-26-083899 | 2025-12-31 | 2026-03-02T11:02:28Z | 2026-03-03 |
| BRK | 2026 | CommonClassBMember | 2025-12-31 | us-gaap:CommonStockSharesOutstanding | 2025-12-31 | 1,383,582,639 | 10-K | 0001193125-26-083899 | 2025-12-31 | 2026-03-02T11:02:28Z | 2026-03-03 |
| NVDA | 2013 | dimensionless | 2012-12-31 | us-gaap:CommonStockSharesOutstanding | 2012-01-29 | 612,191,412 | 10-K | 0001045810-12-000013 | 2012-01-29 | 2012-03-13T20:56:38Z | 2012-03-14 |
| NVDA | 2018 | dimensionless | 2017-12-29 | us-gaap:CommonStockSharesOutstanding | 2017-01-29 | 585,000,000 | 10-K | 0001045810-17-000027 | 2017-01-29 | 2017-03-01T22:30:49Z | 2017-03-02 |
| NVDA | 2026 | dimensionless | 2025-12-31 | us-gaap:CommonStockSharesOutstanding | 2025-01-26 | 24,477,000,000 | 10-K | 0001045810-25-000023 | 2025-01-26 | 2025-02-26T21:48:33Z | 2025-02-27 |
| TSLA | 2013 | dimensionless | 2012-12-31 | us-gaap:CommonStockSharesOutstanding | 2012-12-31 | 114,214,274 | 10-K | 0001193125-13-096241 | 2012-12-31 | 2013-03-07T22:10:43Z | 2013-03-08 |
| TSLA | 2018 | dimensionless | 2017-12-29 | us-gaap:CommonStockSharesOutstanding | 2017-09-30 | 168,017,000 | 10-Q | 0001564590-17-021343 | 2017-09-30 | 2017-11-02T23:56:36Z | 2017-11-03 |
| TSLA | 2026 | dimensionless | 2025-12-31 | us-gaap:CommonStockSharesOutstanding | 2025-12-31 | 3,751,000,000 | 10-K | 0001628280-26-003952 | 2025-12-31 | 2026-01-29T01:55:03Z | 2026-01-29 |
| XOM | 2013 | dimensionless | 2012-12-31 | us-gaap:CommonStockSharesOutstanding | 2012-09-30 | 4,559,342,639 | 10-Q | 0000034088-12-000050 | 2012-11-06 | 2012-11-06T17:14:21Z | 2012-11-07 |
| XOM | 2018 | dimensionless | 2017-12-29 | us-gaap:CommonStockSharesOutstanding | 2017-09-30 | 4,237,000,000 | 10-Q | 0000034088-17-000052 | 2017-09-30 | 2017-11-01T19:51:48Z | 2017-11-02 |
| XOM | 2026 | dimensionless | 2025-12-31 | us-gaap:CommonStockSharesOutstanding | 2025-12-31 | 4,179,000,000 | 10-K | 0000034088-26-000045 | 2025-12-31 | 2026-02-18T21:06:52Z | 2026-02-19 |
| WMT | 2013 | dimensionless | 2012-12-31 | us-gaap:CommonStockSharesOutstanding | 2012-01-31 | 3,418,000,000 | 10-K | 0001193125-12-134679 | 2012-01-31 | 2012-03-27T21:22:22Z | 2012-03-28 |
| WMT | 2018 | dimensionless | 2017-12-29 | dei:EntityCommonStockSharesOutstanding | 2017-11-29 | 2,962,381,445 | 10-Q | 0000104169-17-000081 | 2017-10-31 | 2017-12-01T21:29:29Z | 2017-12-04 |
| WMT | 2026 | dimensionless | 2025-12-31 | dei:EntityCommonStockSharesOutstanding | 2025-12-02 | 7,970,166,964 | 10-Q | 0000104169-25-000191 | 2025-10-31 | 2025-12-03T21:45:34Z | 2025-12-04 |
| INTC | 2013 | dimensionless | 2012-12-31 | us-gaap:CommonStockSharesOutstanding | 2012-12-29 | 4,944,000,000 | 10-K | 0001193125-13-065416 | 2012-12-29 | 2013-02-19T22:06:31Z | 2013-02-20 |
| INTC | 2018 | dimensionless | 2017-12-29 | us-gaap:CommonStockSharesOutstanding | 2017-09-30 | 4,680,000,000 | 10-Q | 0000050863-17-000048 | 2017-09-30 | 2017-10-26T20:30:26Z | 2017-10-27 |
| INTC | 2026 | dimensionless | 2025-12-31 | us-gaap:CommonStockSharesOutstanding | 2025-12-27 | 4,994,000,000 | 10-K | 0000050863-26-000011 | 2025-12-27 | 2026-01-22T23:43:06Z | 2026-01-23 |
| ABBV | 2018 | dimensionless | 2017-12-29 | dei:EntityCommonStockSharesOutstanding | 2017-10-24 | 1,596,429,740 | 10-Q | 0001551152-17-000035 | 2017-09-30 | 2017-11-07T16:27:57Z | 2017-11-08 |
| ABBV | 2026 | dimensionless | 2025-12-31 | dei:EntityCommonStockSharesOutstanding | 2025-10-27 | 1,767,384,632 | 10-Q | 0001551152-25-000049 | 2025-09-30 | 2025-11-04T19:05:49Z | 2025-11-05 |
| FOX | 2026 | CommonClassAMember | 2025-12-31 | us-gaap:CommonStockSharesOutstanding | 2025-12-31 | 200,553,435 | 10-Q | 0001628280-26-005285 | 2025-12-31 | 2026-02-04T14:18:20Z | 2026-02-05 |
| FOX | 2026 | CommonClassBMember | 2025-12-31 | us-gaap:CommonStockSharesOutstanding | 2025-12-31 | 224,702,222 | 10-Q | 0001628280-26-005285 | 2025-12-31 | 2026-02-04T14:18:20Z | 2026-02-05 |
| META | 2018 | CommonClassAMember | 2017-12-29 | us-gaap:CommonStockSharesOutstanding | 2017-09-30 | 2,385,000,000 | 10-Q | 0001326801-17-000053 | 2017-09-30 | 2017-11-02T20:37:43Z | 2017-11-03 |
| META | 2018 | CommonClassBMember | 2017-12-29 | us-gaap:CommonStockSharesOutstanding | 2017-09-30 | 521,000,000 | 10-Q | 0001326801-17-000053 | 2017-09-30 | 2017-11-02T20:37:43Z | 2017-11-03 |
| META | 2026 | CommonClassAMember | 2025-12-31 | us-gaap:CommonStockSharesOutstanding | 2025-12-31 | 2,187,000,000 | 10-K | 0001628280-26-003942 | 2025-12-31 | 2026-01-29T00:13:46Z | 2026-01-29 |
| META | 2026 | CommonClassBMember | 2025-12-31 | us-gaap:CommonStockSharesOutstanding | 2025-12-31 | 343,000,000 | 10-K | 0001628280-26-003942 | 2025-12-31 | 2026-01-29T00:13:46Z | 2026-01-29 |
| F | 2013 | CommonClassBMember | 2012-12-31 | dei:EntityCommonStockSharesOutstanding | 2012-10-26 | 70,852,076 | 10-Q | 0000037996-12-000049 | 2012-09-30 | 2012-11-02T11:33:11Z | 2012-11-05 |
| F | 2013 | CommonStockMember | 2012-12-31 | dei:EntityCommonStockSharesOutstanding | 2012-10-26 | 3,741,809,920 | 10-Q | 0000037996-12-000049 | 2012-09-30 | 2012-11-02T11:33:11Z | 2012-11-05 |
| F | 2018 | CommonClassBMember | 2017-12-29 | dei:EntityCommonStockSharesOutstanding | 2017-10-19 | 70,852,076 | 10-Q | 0000037996-17-000092 | 2017-09-30 | 2017-10-26T11:35:06Z | 2017-10-27 |
| F | 2018 | CommonStockMember | 2017-12-29 | dei:EntityCommonStockSharesOutstanding | 2017-10-19 | 3,901,450,116 | 10-Q | 0000037996-17-000092 | 2017-09-30 | 2017-10-26T11:35:06Z | 2017-10-27 |
| F | 2026 | CommonClassBMember | 2025-12-31 | dei:EntityCommonStockSharesOutstanding | 2025-10-21 | 70,852,076 | 10-Q | 0000037996-25-000186 | 2025-09-30 | 2025-10-23T19:12:04Z | 2025-10-24 |
| F | 2026 | CommonStockMember | 2025-12-31 | dei:EntityCommonStockSharesOutstanding | 2025-10-21 | 3,913,646,490 | 10-Q | 0000037996-25-000186 | 2025-09-30 | 2025-10-23T19:12:04Z | 2025-10-24 |
| CMCSA | 2013 | ClassASpecialCommonStockMember | 2012-12-31 | us-gaap:CommonStockSharesOutstanding | 2012-03-31 | 577,031,322 | 10-Q | 0001193125-12-203863 | 2012-03-31 | 2012-05-02T17:55:44Z | 2012-05-03 |
| CMCSA | 2013 | ClassaSpecialCommonStockMember | 2012-12-31 | us-gaap:CommonStockSharesOutstanding | 2012-12-31 | 507,769,463 | 10-K | 0001193125-13-067658 | 2012-12-31 | 2013-02-20T23:48:53Z | 2013-02-21 |
| CMCSA | 2013 | CommonClassAMember | 2012-12-31 | us-gaap:CommonStockSharesOutstanding | 2012-12-31 | 2,122,278,635 | 10-K | 0001193125-13-067658 | 2012-12-31 | 2013-02-20T23:48:53Z | 2013-02-21 |
| CMCSA | 2013 | CommonClassBMember | 2012-12-31 | us-gaap:CommonStockSharesOutstanding | 2012-12-31 | 9,444,375 | 10-K | 0001193125-13-067658 | 2012-12-31 | 2013-02-20T23:48:53Z | 2013-02-21 |
| CMCSA | 2018 | CommonClassAMember | 2017-12-29 | us-gaap:CommonStockSharesOutstanding | 2017-09-30 | 4,664,327,455 | 10-Q | 0001166691-17-000031 | 2017-09-30 | 2017-10-26T19:54:55Z | 2017-10-27 |
| CMCSA | 2018 | CommonClassBMember | 2017-12-29 | us-gaap:CommonStockSharesOutstanding | 2017-09-30 | 9,444,375 | 10-Q | 0001166691-17-000031 | 2017-09-30 | 2017-10-26T19:54:55Z | 2017-10-27 |
| NWS | 2018 | CommonClassAMember | 2017-12-29 | us-gaap:CommonStockSharesOutstanding | 2017-09-30 | 382,976,281 | 10-Q | 0001193125-17-339122 | 2017-09-30 | 2017-11-10T00:02:27Z | 2017-11-10 |
| NWS | 2018 | CommonClassBMember | 2017-12-29 | us-gaap:CommonStockSharesOutstanding | 2017-09-30 | 199,630,240 | 10-Q | 0001193125-17-339122 | 2017-09-30 | 2017-11-10T00:02:27Z | 2017-11-10 |
| NWS | 2018 | SeriesCommonStockMember | 2017-12-29 | us-gaap:CommonStockSharesOutstanding | 2017-06-30 | 0 | 10-K | 0001193125-17-257248 | 2017-06-30 | 2017-08-14T20:10:24Z | 2017-08-15 |
| NWS | 2026 | CommonClassAMember | 2025-12-31 | us-gaap:CommonStockSharesOutstanding | 2025-12-31 | 371,777,267 | 10-Q | 0001564708-26-000029 | 2025-12-31 | 2026-02-06T12:02:31Z | 2026-02-09 |
| NWS | 2026 | CommonClassBMember | 2025-12-31 | us-gaap:CommonStockSharesOutstanding | 2025-12-31 | 185,853,935 | 10-Q | 0001564708-26-000029 | 2025-12-31 | 2026-02-06T12:02:31Z | 2026-02-09 |
| NWS | 2026 | SeriesCommonStockMember | 2025-12-31 | us-gaap:CommonStockSharesOutstanding | 2025-06-30 | 0 | 10-K | 0001564708-25-000419 | 2025-06-30 | 2025-08-06T11:03:06Z | 2025-08-07 |
| UA | 2013 | CommonClassAMember | 2012-12-31 | us-gaap:CommonStockSharesOutstanding | 2012-12-31 | 83,461,106 | 10-K | 0001336917-13-000011 | 2012-12-31 | 2013-02-25T13:06:11Z | 2013-02-26 |
| UA | 2013 | ConvertibleCommonStockMember | 2012-12-31 | us-gaap:CommonStockSharesOutstanding | 2012-12-31 | 21,300,000 | 10-K | 0001336917-13-000011 | 2012-12-31 | 2013-02-25T13:06:11Z | 2013-02-26 |
| UA | 2018 | CommonClassAMember | 2017-12-29 | us-gaap:CommonStockSharesOutstanding | 2017-09-30 | 185,128,757 | 10-Q | 0001336917-17-000049 | 2017-09-30 | 2017-11-08T22:34:24Z | 2017-11-09 |
| UA | 2018 | CommonClassCMember | 2017-12-29 | us-gaap:CommonStockSharesOutstanding | 2017-09-30 | 222,050,824 | 10-Q | 0001336917-17-000049 | 2017-09-30 | 2017-11-08T22:34:24Z | 2017-11-09 |
| UA | 2018 | ConvertibleCommonStockMember | 2017-12-29 | us-gaap:CommonStockSharesOutstanding | 2017-09-30 | 34,450,000 | 10-Q | 0001336917-17-000049 | 2017-09-30 | 2017-11-08T22:34:24Z | 2017-11-09 |
| UA | 2026 | CommonClassAMember | 2025-12-31 | us-gaap:CommonStockSharesOutstanding | 2025-12-31 | 188,834,386 | 10-Q | 0001336917-26-000027 | 2025-12-31 | 2026-02-06T14:04:57Z | 2026-02-09 |
| UA | 2026 | CommonClassCMember | 2025-12-31 | us-gaap:CommonStockSharesOutstanding | 2025-12-31 | 202,487,254 | 10-Q | 0001336917-26-000027 | 2025-12-31 | 2026-02-06T14:04:57Z | 2026-02-09 |
| UA | 2026 | ConvertibleCommonStockMember | 2025-12-31 | us-gaap:CommonStockSharesOutstanding | 2025-12-31 | 34,450,000 | 10-Q | 0001336917-26-000027 | 2025-12-31 | 2026-02-06T14:04:57Z | 2026-02-09 |
| V | 2013 | CommonClassAMember | 2012-12-31 | us-gaap:CommonStockSharesOutstanding | 2012-12-31 | 530,000,000 | 10-Q | 0001384108-13-000004 | 2012-12-31 | 2013-02-06T21:17:56Z | 2013-02-07 |
| V | 2013 | CommonClassBMember | 2012-12-31 | us-gaap:CommonStockSharesOutstanding | 2012-12-31 | 245,000,000 | 10-Q | 0001384108-13-000004 | 2012-12-31 | 2013-02-06T21:17:56Z | 2013-02-07 |
| V | 2013 | CommonClassCMember | 2012-12-31 | us-gaap:CommonStockSharesOutstanding | 2012-12-31 | 29,000,000 | 10-Q | 0001384108-13-000004 | 2012-12-31 | 2013-02-06T21:17:56Z | 2013-02-07 |
| V | 2018 | CommonClassAMember | 2017-12-29 | us-gaap:CommonStockSharesOutstanding | 2017-09-30 | 1,818,000,000 | 10-K | 0001403161-17-000044 | 2017-09-30 | 2017-11-17T01:07:25Z | 2017-11-17 |
| V | 2018 | CommonClassBMember | 2017-12-29 | us-gaap:CommonStockSharesOutstanding | 2017-09-30 | 245,000,000 | 10-K | 0001403161-17-000044 | 2017-09-30 | 2017-11-17T01:07:25Z | 2017-11-17 |
| V | 2018 | CommonClassCMember | 2017-12-29 | us-gaap:CommonStockSharesOutstanding | 2017-09-30 | 13,000,000 | 10-K | 0001403161-17-000044 | 2017-09-30 | 2017-11-17T01:07:25Z | 2017-11-17 |
| V | 2026 | CommonClassAMember | 2025-12-31 | us-gaap:CommonStockSharesOutstanding | 2025-12-31 | 1,683,000,000 | 10-Q | 0001403161-26-000045 | 2025-12-31 | 2026-01-29T23:08:26Z | 2026-01-30 |
| V | 2026 | CommonClassB1Member | 2025-12-31 | us-gaap:CommonStockSharesOutstanding | 2025-12-31 | 5,000,000 | 10-Q | 0001403161-26-000045 | 2025-12-31 | 2026-01-29T23:08:26Z | 2026-01-30 |
| V | 2026 | CommonClassB2Member | 2025-12-31 | us-gaap:CommonStockSharesOutstanding | 2025-12-31 | 120,000,000 | 10-Q | 0001403161-26-000045 | 2025-12-31 | 2026-01-29T23:08:26Z | 2026-01-30 |
| V | 2026 | CommonClassCMember | 2025-12-31 | us-gaap:CommonStockSharesOutstanding | 2025-12-31 | 9,000,000 | 10-Q | 0001403161-26-000045 | 2025-12-31 | 2026-01-29T23:08:26Z | 2026-01-30 |
| MA | 2013 | CommonClassAMember | 2012-12-31 | us-gaap:CommonStockSharesOutstanding | 2012-12-31 | 118,405,075 | 10-K | 0001141391-13-000003 | 2012-12-31 | 2013-02-14T22:02:29Z | 2013-02-15 |
| MA | 2013 | CommonClassBMember | 2012-12-31 | us-gaap:CommonStockSharesOutstanding | 2012-12-31 | 4,838,840 | 10-K | 0001141391-13-000003 | 2012-12-31 | 2013-02-14T22:02:29Z | 2013-02-15 |
| MA | 2018 | CommonClassAMember | 2017-12-29 | us-gaap:CommonStockSharesOutstanding | 2017-09-30 | 1,045,000,000 | 10-Q | 0001141391-17-000152 | 2017-09-30 | 2017-10-31T14:23:17Z | 2017-11-01 |
| MA | 2018 | CommonClassBMember | 2017-12-29 | us-gaap:CommonStockSharesOutstanding | 2017-09-30 | 15,000,000 | 10-Q | 0001141391-17-000152 | 2017-09-30 | 2017-10-31T14:23:17Z | 2017-11-01 |
| NKE | 2013 | CommonClassAMember | 2012-12-31 | us-gaap:CommonStockSharesOutstanding | 2012-11-30 | 180,000,000 | 10-Q | 0001193125-13-008172 | 2012-11-30 | 2013-01-09T21:16:23Z | 2013-01-10 |
| NKE | 2013 | CommonClassBMember | 2012-12-31 | us-gaap:CommonStockSharesOutstanding | 2012-11-30 | 716,000,000 | 10-Q | 0001193125-13-008172 | 2012-11-30 | 2013-01-09T21:16:23Z | 2013-01-10 |
| NKE | 2018 | CommonClassAMember | 2017-12-29 | us-gaap:CommonStockSharesOutstanding | 2017-11-30 | 329,000,000 | 10-Q | 0000320187-18-000007 | 2017-11-30 | 2018-01-05T21:11:45Z | 2018-01-08 |
| NKE | 2018 | CommonClassBMember | 2017-12-29 | us-gaap:CommonStockSharesOutstanding | 2017-11-30 | 1,295,000,000 | 10-Q | 0000320187-18-000007 | 2017-11-30 | 2018-01-05T21:11:45Z | 2018-01-08 |
| NKE | 2026 | CommonClassAMember | 2025-12-31 | us-gaap:CommonStockSharesOutstanding | 2025-11-30 | 289,000,000 | 10-Q | 0000320187-25-000151 | 2025-11-30 | 2025-12-30T21:20:45Z | 2025-12-31 |
| NKE | 2026 | CommonClassBMember | 2025-12-31 | us-gaap:CommonStockSharesOutstanding | 2025-11-30 | 1,191,000,000 | 10-Q | 0000320187-25-000151 | 2025-11-30 | 2025-12-30T21:20:45Z | 2025-12-31 |
| COST | 2013 | dimensionless | 2012-12-31 | us-gaap:CommonStockSharesOutstanding | 2012-11-25 | 434,824,000 | 10-Q | 0001193125-12-512914 | 2012-11-25 | 2012-12-21T21:05:04Z | 2012-12-24 |
| COST | 2018 | dimensionless | 2017-12-29 | us-gaap:CommonStockSharesOutstanding | 2017-11-26 | 439,185,000 | 10-Q | 0000909832-17-000022 | 2017-11-26 | 2017-12-21T00:55:05Z | 2017-12-21 |
| COST | 2026 | dimensionless | 2025-12-31 | us-gaap:CommonStockSharesOutstanding | 2025-11-23 | 443,919,000 | 10-Q | 0000909832-25-000169 | 2025-11-23 | 2025-12-17T22:12:42Z | 2025-12-18 |
| HD | 2013 | dimensionless | 2012-12-31 | us-gaap:CommonStockSharesOutstanding | 2012-10-28 | 1,496,000,000 | 10-Q | 0000354950-12-000035 | 2012-10-28 | 2012-11-21T21:06:49Z | 2012-11-23 |
| HD | 2018 | dimensionless | 2017-12-29 | us-gaap:CommonStockSharesOutstanding | 2017-10-29 | 1,168,000,000 | 10-Q | 0000354950-17-000046 | 2017-10-29 | 2017-11-20T23:13:00Z | 2017-11-21 |
| HD | 2026 | dimensionless | 2025-12-31 | us-gaap:CommonStockSharesOutstanding | 2025-11-02 | 995,000,000 | 10-Q | 0001628280-25-053868 | 2025-11-02 | 2025-11-24T22:52:00Z | 2025-11-25 |

## F16. 이번에 결정하지 않은 것

작업지시 §13·§14대로 그대로 열어 둔다.

1. **`decimals` duplicate는 OPEN이다.** `INF` exact vs `-6` rounded 충돌은 현재 contract대로
   `AMBIGUOUS`로 뒀고 "더 정밀한 값"으로 임의 해결하지 않았다. `AMBIGUOUS`인 A를 B로
   내리지도 않았다. F13-4가 이 결정에 넘기는 새 증거다.
2. **은퇴한 class의 책임은 OPEN이다.** freshness candidate가 Visa 옛 `CommonClassBMember`와
   CMCSA 옛 Class A Special 표기를 실제로 제거하지만, **"staleness가 class retirement를
   해결했다"고 결론 내리지 않는다.** 이중 계상을 막는 정본은 identity의 `effective_to`와
   명시적 axis/member 등록이고, freshness는 그것을 대신하지 못한다(F13-3의 CMCSA 2013이
   반례다).
3. **dimension shape는 이번 계약에서 CLOSED로 받았다.** F7.1이 드러낸
   `StatementEquityComponentsAxis` 관측(A fact의 33%)을 인정할지는 **별도 결정**이고,
   이번 추천은 그 결정과 독립적으로 성립한다(27/28 stale 관측은 완화해도 그대로다).

## User decision — follow-up

추천: **B — measurement-calendar-year boundary (S1).**

```text
January 1 of t-1  <=  share instant  <=  December last regular session of t-1
```

이 조건을 만족하는 direct observation만 eligible로 보고, **hierarchy 판정보다 먼저** 적용한다.
즉 Candidate C의 "A가 구조적으로 absent일 때만 B"에서 **`absent`를 history 전체가 아니라
이 boundary 안에서 판정한다.**

작업지시 §18의 기준별로 적는다.

- **silent wrong stale observation을 막는가**: 막는다. S0의 28건을 **전부** 잘라내고
  age > 366일인 관측이 0이 된다. 그중 WMT 2건은 fresh B로 정확히 교정되고 26건은
  fail-close된다. **살아 있는 ordinary class를 잃은 건은 0이다.**
- **numeric tuning knob가 필요한가**: 필요 없다. 일수가 없다. F12에서 366·400·456이
  구분되지 않는다는 것을 확인했으므로, 숫자를 쓰는 순간 그 숫자는 증거가 아니라 선택이 된다.
- **December denominator 의미와 맞는가**: 가장 잘 맞는다. denominator가 "t-1년 12월 말의
  issuer market equity"이므로 그 share state가 t-1년 안에서 보고된 것이어야 한다는 조건은
  **정의를 다시 쓴 것이지 새 가정이 아니다.**
- **10-Q / non-calendar issuer와 맞는가**: 맞는다(F10). 비12월 결산 10개 발행사에서
  systematic false missing이 0이고 52/53주 발행사도 정상이다. 최대 age 339일이 회계연도
  구조에서 자동으로 나온다.
- **deterministic한가**: 완전히 결정론적이다. instant와 December session만 비교한다.
  발행사 이름·결과 숫자·whitelist가 들어가지 않는다.
- **fail-close가 가능한가**: 가능하다. eligible 집합이 비면 `MISSING`이고 옛 값을 쓰지 않는다.
  `AMBIGUOUS`는 그대로 fail-close이며 B로 내려가지 않는다.
- **Candidate C hierarchy와 자연스럽게 결합되는가**: 결합된다. 오히려 **결합 순서를
  고쳐야 한다는 것이 이번 연구의 핵심 발견**이다(F11). boundary가 hierarchy 뒤에 있으면
  WMT형 발행사에서 stale A가 fresh B를 영원히 막는다.

**C(annual-presence guard)를 추천하지 않는 이유**를 분명히 적는다. S2가 잡는 것이 S1보다
많지도 않다 — 둘 다 age > 366일 관측을 0으로 만든다. S2가 추가로 잡는 것은 CMCSA 2013의
옛 표기 **한 건**이고, 그 대가로 **Ford 2018의 살아 있는 두 class를 통째로 잃고 TSLA 2026에서
더 나쁜 tier를 고른다.** 원인은 발행사가 아니라 `10-K/A`라는 구조라서 표본을 늘리면
같은 실패가 늘어난다. **D(둘 다)는 그 대가를 그대로 물려받는다.**

**E(외부 semantic으로 정당화된 fixed age rule)도 추천하지 않는다.** 그런 근거를 찾지 못했고
(F12), 이 표본에서 366~456일이 구분되지 않는다.

**F(증거 부족)로 닫지 않는 이유**: 이번 표본은 20개 적대적 발행사 × 3 formation × 124 관측을
**1,303개 usable filing 전량**으로 돌린 것이고, S0의 실패가 10-Q 부족 때문이 아니라는 것까지
확인했다(F6.2). boundary의 필요성 자체는 충분히 재현됐다.

**함께 기억할 것 셋.**

1. **이 추천은 coverage 때문이 아니다.** S1은 S0보다 resolved가 27건 적다. 그 27건은
   전부 은퇴·옛 표기 scope이고, 하나도 잃으면 안 되는 살아 있는 class가 아니다.
2. **S1의 잔여 결함은 identity가 닫는다.** 같은 class의 두 표기가 둘 다 in-year면 S1은
   둘 다 통과시킨다(F13-3). §4.4.1의 명시적 axis/member 등록이 정본이다.
3. **dimension shape 결정은 여전히 남아 있다**(F7.1·F16-3). 이 추천은 그 결정과 독립이지만,
   그 결정을 하지 않으면 WMT처럼 concept을 자본변동표 축으로 옮긴 발행사에서
   A tier가 조용히 비게 된다.

**이 follow-up도 research 결과일 뿐 아직 CLOSED/FROZEN 계약이 아니다.**

---

# Follow-up 2 — direct outstanding fact의 dimension scope (2026-08-28)

> **Status: RESEARCH EVIDENCE ONLY.** 위 두 절과 같다. 설계 승인·freeze가 아니고 production
> code/schema/test/roadmap의 의미를 바꾸지 않는다. coverage Gate · `coverage_start` ·
> formation rank · B/M · returns는 이번에도 계산하지 않았다.

시작 main: `9c6b447e6f7acdb5220c5dcce2ede1cef8a05bee`
(`research(qv): share-count freshness boundary를 검증한다` — 바로 위 절을 커밋한 지점이고
`origin/main`도 같았다.)

**이번에 다시 열지 않은 것.** share source(raw XBRL instance) · 허용 form 네 가지 ·
A/B hierarchy와 `AMBIGUOUS` fail-close · measurement-calendar-year freshness boundary와
그것을 hierarchy보다 먼저 적용한다는 순서 · `decimals` consolidation 규칙 ·
retired class의 정본은 identity `effective_to`라는 것 · economic class와 XBRL alias를
분리하는 identity 모델 · issued−treasury·companyfacts·current-shares backfill·derived member 금지.

## G1. 이번 질문 하나

> **direct outstanding fact의 XBRL context가 어떤 dimension shape일 때
> actual ordinary share class의 PIT share count로 인정할 수 있는가?**

Follow-up 1의 F7.1이 남긴 것이다. WMT는 `us-gaap:CommonStockSharesOutstanding`을 버린 것이
아니라 **context shape를 자본변동표 축으로 옮겼고**, 그런 fact가 A tier 전체의 3분의 1이었다.
그 shape를 인정할지는 freshness와 독립한 별도 결정이라 그때 열지 않았다.

## G2. 방법과 데이터

Follow-up 1이 쓴 **1,303개 usable K/Q family filing 캐시를 그대로 재사용**했고, dimension
분석에 필요한 필드를 넣어 instance를 다시 파싱했다. 표본(20 발행사 × formation 2013·2018·2026)은
바꾸지 않았다.

| 항목 | 값 |
|---|---|
| 2026 formation까지 usable한 filing | 1,303 (10-Q 955 · 10-K 323 · 10-K/A 21 · 10-Q/A 4) |
| instance를 실제로 파싱한 accession | 1,248 |
| 뽑은 direct outstanding fact | **8,758** (A 6,622 · B 2,136) |
| context의 unique explicit dimension **set** | **205** |
| explicit dimension 개수 | 0개 1,775 · 1개 5,879 · 2개 1,104 · 3개 이상 **0** |
| typed dimension을 쓴 fact | **0** |
| context entity identifier가 대상 CIK가 아닌 fact | **0** |

**첫 dimension 하나가 아니라 context의 전체 explicit dimension set을 보존해 집계했다.**
axis/member QName은 §19 계약대로 standard는 `us-gaap`/`dei` family로, 그 밖은 raw namespace
URI 그대로 두고, 원 URI는 provenance로 전부 보존했다.

> `entity identifier` 오염이 0이라는 것이 곧 안전을 뜻하지 않는다. **법인 범위 오염은
> identifier가 아니라 dimension으로 들어온다**(G9).

## G3. 공식 semantics — 근거 원문

### G3.1 SEC EDGAR XBRL Guide

출처: [SEC EDGAR XBRL Guide 2026-05-15](https://www.sec.gov/files/edgar/filer-information/specifications/xbrl-guide-2026-05-15.pdf)
(§3.2.3·§3.2.4·§6.4.1·§6.4.2는 이 문서 §3.1에 이미 인용했다. 이번에 추가로 읽은 절이다.)

**§3.1 Expected Facts in the Required Context** (p.15)

> "The context of the fact will have: 1. an entity identifier matching the filing CIK, and
> 2. either a. no taxonomy-defined dimensions, or b. a dimension from a standard taxonomy …"

> "For example, some expected facts for multi-series filers expect a context with an explicit
> member of `dei:LegalEntityAxis` and otherwise identical to the Required Context."

**§5.7 Custom Domain Member Declarations** (p.104) — dimensionless의 의미를 못박는 절이다.

> "Do not declare "Total" domain members. The domain default member of an explicit axis serves
> that purpose … In the WXY example, if there were a fact that represented (say) the total market
> capitalization of common classes A and B combined for the reporting period, **that fact would be
> in the Required Context, with no Class of Stock member at all.**"

**§6.3.3 Contexts for different reporting assumptions** (p.118)

> "An instance containing multiple reports about the same entity for the same periods under
> different reporting assumptions must distinguish the facts in different reports using
> `i:context` elements whose `xbrldi:explicitMember` elements have a dimension attribute of
> `StatementScenarioAxis` in a standard namespace."

**§7.13 Statements of Changes in Shareholder Equity** (p.141) — 자본변동표의 축 순서다.

> "These axes (if present) are shown on the columns, in this nesting order:
> a. Legal Entity (`LegalEntityAxis`) b. Equity Components (`StatementEquityComponentsAxis`)
> c. Partner Capital Components (`PartnerCapitalComponentsAxis`) d. Class of Stock
> (`StatementClassOfStockAxis`) e. (All other axes present) f. Unit"

**§3.2.4 Note 3** (p.55, 재인용)

> "The presence of members on axes other than `StatementClassOfStockAxis` or
> `ClassesOfShareCapitalAxis` does not change which of the three cases is being represented
> in an instance."

세 가지가 여기서 나온다.

1. **class 범위를 정하는 축은 class-of-stock 축 둘뿐이다**(§3.2.3·§3.2.4 Note 3·§6.4.2).
2. **class 축 member가 없는 fact는 "class 정보 없음"이 아니라 전 class 총계다**(§5.7·§6.4.1).
3. **자본변동표에서 `StatementEquityComponentsAxis`와 `StatementClassOfStockAxis`는 공존하는
   서로 다른 축이다**(§7.13). 앞의 것이 class를 대신하지 않는다.

### G3.2 taxonomy definition

출처: `https://xbrl.fasb.org/us-gaap/2025/elts/us-gaap-doc-2025.xml` ·
`https://xbrl.fasb.org/srt/2025/elts/srt-doc-2025.xml` (documentation label role).

| element | documentation |
|---|---|
| `us-gaap:StatementClassOfStockAxis` | "Information by the different classes of stock of the entity." |
| `us-gaap:ClassOfStockDomain` | "Share of stock differentiated by the voting rights the holder receives. Examples include, but are not limited to, common stock, redeemable preferred stock, nonredeemable preferred stock, and convertible stock." |
| `us-gaap:StatementEquityComponentsAxis` | **"Information by component of equity."** |
| `us-gaap:EquityComponentDomain` | **"Components of equity are the parts of the total Equity balance including that which is allocated to common, preferred, treasury stock, retained earnings, etc."** |
| `us-gaap:CommonStockMember` | **"Stock that is subordinate to all other stock of the issuer."** |
| `us-gaap:CommonStockIncludingAdditionalPaidInCapitalMember` | "Common stock held by shareholders with par value plus amounts in excess of par value or issuance value (in cases of no-par value stock)." |
| `us-gaap:CommonClassAMember` | "Classification of common stock representing ownership interest in a corporation." |
| `us-gaap:CommonClassBMember` | "Classification of common stock that has different rights than Common Class A, representing ownership interest in a corporation." |
| `us-gaap:CommonStockSharesOutstanding` | "Number of shares of common stock outstanding. Common stock represent the ownership interest in a corporation." |
| `srt:StatementScenarioAxis` | "Information by scenario reported, distinguishing information from actual fact. Includes, but is not limited to, pro forma and forecast. **Excludes actual facts.**" |
| `srt:ConsolidatedEntitiesAxis` | "Information by consolidated entity or group of entities." |
| `srt:SubsidiariesMember` | "Entity in which controlling financial interest is held. …" |

**`CommonStockMember`의 정의가 이번 판정의 핵심이다.** "Stock that is subordinate to all other
stock of the issuer" — **발행사의 보통주 전체**이지 그중 한 class가 아니다. 표준 라벨도
`Common Stock [Member]`이고 `StatementEquityComponentsAxis`의 표준 라벨은
`Equity Components [Axis]`다. **class 축의 라벨은 `Class of Stock [Axis]`로 따로 있다.**

## G4. dimension shape 전수 분류

### G4.1 shape category

`freshness 통과`는 세 formation의 measurement-calendar-year boundary와 usable 조건을 모두
만족한 fact다. **coverage 비율이 아니라 구조 분포다.**

| category | 전체 fact | freshness 통과 |
|---|---|---|
| dimensionless — 그 시점 class가 1개인 발행사 | 1,647 | 223 |
| dimensionless — class가 2개 이상인 발행사 | 128 | 12 |
| class 축 단독 | 4,759 | 609 |
| `StatementEquityComponentsAxis` 단독 | 1,110 | 86 |
| `dei:EntityListingsInstrumentAxis` 단독 | 2 | 0 |
| 그 밖 single axis | 8 | 0 |
| explicit dimension 2개 | 1,104 | 120 |
| **합계** | **8,758** | **1,050** |

### G4.2 상위 shape (전체 fact 기준)

| fact | A | B | 발행사 | filing | dimension set |
|---|---|---|---|---|---|
| 1,934 | 1,357 | 577 | 10 | 581 | `ClassOfStock/CommonClassA` |
| 1,775 | 1,121 | 654 | 18 | 683 | `[]` |
| 1,730 | 1,160 | 570 | 10 | 571 | `ClassOfStock/CommonClassB` |
| 728 | 728 | 0 | 5 | 132 | `EquityComponents/CommonStock` |
| 501 | 501 | 0 | 4 | 83 | `ClassOfStock/CommonClassA` + `EquityComponents/CommonStock` |
| 428 | 428 | 0 | 3 | 71 | `ClassOfStock/CommonClassB` + `EquityComponents/CommonStock` |
| 377 | 275 | 102 | 2 | 103 | `ClassOfStock/CommonClassC` |
| 330 | 330 | 0 | 4 | 60 | `EquityComponents/CommonStockIncludingAdditionalPaidInCapital` |
| 221 | 157 | 64 | 1 | 64 | `ClassOfStock/ConvertibleCommonStock` |
| 74 | 12 | 62 | 2 | 68 | `ClassOfStock/CommonStock` |

나머지 195개 shape는 issuer-extension member가 taxonomy 연도마다 다른 namespace URI를 갖기
때문에 쪼개진 것이 대부분이다(G15).

### G4.3 axis 전수

| axis | fact | 발행사 | namespace | 관측된 member |
|---|---|---|---|---|
| `StatementClassOfStockAxis` | 5,849 | 11 | us-gaap | `CommonClassA` 2,438 · `CommonClassB` 2,164 · `CommonClassC` 450 · `ConvertibleCommonStock` 294 · `CapitalClassC` 130 · `CommonStock` 77 · `EquivalentClassA` 68 · `ClassaSpecialCommonStock` 59 … |
| `StatementEquityComponentsAxis` | 2,199 | 13 | us-gaap | `CommonStock` 1,804 · `CommonStockIncludingAdditionalPaidInCapital` 343 · `Outstanding`(ext) 32 · `CommonClassB` 8 · `CommonClassA` 8 · `TreasuryStock` 4 |
| `CumulativeEffectPeriodOfAdoptionAxis` | 12 | 1 | srt | `CumulativeEffectPeriodOfAdoptionAdjustedBalance` |
| `LegalEntityAxis` | 12 | 1 | dei | `Subsidiaries` |
| `SubsequentEventTypeAxis` | 6 | 1 | us-gaap | `SubsequentEvent` |
| `BusinessAcquisitionAxis` | 5 | 1 | us-gaap | `Allerganplc`(ext) |
| `StatementScenarioAxis` | 2 | 2 | us-gaap | `ScenarioPreviouslyReported` |
| `dei:EntityListingsInstrumentAxis` | 2 | 1 | dei | `ClassA`(ext) · `ClassB`(ext) |

`ClassesOfShareCapitalAxis`는 이 표본에 **한 번도 나오지 않는다.**

## G5. dimension의 semantic 분류

**axis 이름 패턴으로 자동 추정하지 않았다.** taxonomy definition(G3.2) + Guide 절(G3.1) +
filing 원문(G8·G9)을 근거로 붙였다.

| axis | 분류 | 근거 |
|---|---|---|
| `us-gaap:StatementClassOfStockAxis` | **CLASS_IDENTIFYING** | taxonomy "Information by the different classes of stock of the entity" · Guide §6.4.2 |
| `us-gaap:ClassesOfShareCapitalAxis` | **CLASS_IDENTIFYING** | Guide §3.2.3 case 3 · §6.4.1 (표본 미출현) |
| `dei:EntityListingsInstrumentAxis` | **CLASS_IDENTIFYING** | 등록증권(instrument)별 축. BRK 2009 표지가 Class A/B 수량을 여기에 실었다(G9.5) |
| `us-gaap:StatementEquityComponentsAxis` | **STATEMENT_SCOPE** | taxonomy "Information by component of equity" · domain "parts of the total Equity balance … common, preferred, treasury stock, retained earnings" · Guide §7.13이 class 축과 별개 축으로 둔다 |
| `dei:LegalEntityAxis` | **ENTITY_SCOPE** | Guide §3.1·§3.2.5·§3.2.7 (series·branch·plan 구분) · §7.13 최상위 열 축 |
| `us-gaap:BusinessAcquisitionAxis` | **ENTITY_SCOPE** | 피취득기업 범위. ABBV 원문에서 Allergan plc 수량(G9.2) |
| `srt:StatementScenarioAxis` | **OTHER (non-actual)** | taxonomy "distinguishing information from actual fact … Excludes actual facts" · Guide §6.3.3 |
| `us-gaap:SubsequentEventTypeAxis` | **OTHER (period marker)** | 보고기간 이후 사건 표시. instant가 이미 그 날짜를 들고 있다 |
| `srt:CumulativeEffectPeriodOfAdoptionAxis` | **STATEMENT_SCOPE** | 회계기준 채택 조정 후 잔액 열 |

**같은 member local name이 축에 따라 뜻이 정반대인 사례가 실제로 있다**(G8.3). 그래서 분류는
member가 아니라 **(axis, member) 쌍**, 그것도 발행사 단위로만 성립한다.

## G6. ground truth class universe — 표지 case로 확정한다

Guide §3.2.3이 표지의 `dei:EntityCommonStockSharesOutstanding` 배치를 case 1/2/3으로 강제하므로,
**표지 자체가 "그 시점에 유통 중인 보통주 class가 몇 개인가"의 공식 답이다.** 각
(issuer, formation)마다 December measurement date에 instant가 가장 가까운 usable filing의
표지 case를 ground truth로 썼다. **candidate 결과를 ground truth로 쓰지 않았다.**

표본 20 발행사 × 3 formation 중 실재하는 56개 (issuer, formation)에서 나온
**ground truth class-formation 관측은 94개**다. 대표 확인:

| issuer | formation | 표지 accession | ground truth class |
|---|---|---|---|
| GOOGL | 2026 | 0001652044-26-000018 (10-K) | A · B · C |
| CMCSA | 2013 | 0001193125-13-067658 (10-K) | A · **A Special** · B |
| CMCSA | 2018 · 2026 | 0001166691-18-000004 · 0001628280-26-004994 | A · B (A Special 소멸) |
| V | 2013 · 2018 | 0001384108-13-000004 · 0001403161-18-000009 | A · B · C |
| V | 2026 | 0001403161-26-000045 (10-Q) | A · **B1** · **B2** · C (옛 B 소멸) |
| F | 전 formation | 0000037996-{13,18,26}-… | Common Stock · Class B |
| UA | 2013 | 0001336917-13-000011 | A · Convertible |
| UA | 2018 · 2026 | 0001336917-18-000009 · 0001336917-26-000027 | A · C · Convertible |
| WMT · AAPL · NVDA · TSLA · XOM · INTC · ABBV · COST · HD | 전 formation | (각 표지) | case 1 = class 1개 |

## G7. dimensionless 판정 (Case A / Case B)

### G7.1 Case B — class가 2개 이상이면 dimensionless는 총계다

**공식 근거는 Guide §5.7이다**: 두 class 합계를 나타내는 fact는 "Required Context, with no Class
of Stock member at all"에 놓인다. **원문 tie-out으로도 정확히 맞는다.**

| issuer | instant | dimensionless | class children 합 | 일치 |
|---|---|---|---|---|
| GOOGL | 2025-12-31 | 12,088,000,000 | A 5,822,000,000 + B 837,000,000 + C 5,429,000,000 = 12,088,000,000 | **정확히 일치** |
| NKE (표지 tier) | 2012-11-30 | 895,711,770 | A 179,784,496 + B 715,927,274 = 895,711,770 | **정확히 일치** |

freshness를 통과한 multi-class dimensionless fact는 12건이고(GOOGL 8 · NKE 4)
**전부 총계다. 어느 candidate도 이것을 class로 매핑하지 않는다.** GOOGL 2026에서 이 값을
Class A로 읽으면 **2.08배 과대**가 된다.

### G7.2 Case A — class가 정확히 1개일 때만 sole class로 쓴다

Guide §3.2.3 case 1이 "zero, one … class"의 경우에 dimensionless를 요구하므로, **class가 하나면
총계와 그 class가 같다.** 조건은 "class 축 fact가 안 보인다"가 아니라 **"identity에 등록된 실제
ordinary class가 정확히 하나"**여야 한다 — 이미 §4.1이 적어둔 그대로이고, G7.1이 그 이유다.

freshness 통과 dimensionless fact 223건이 여기 해당하고, 이 표본에서 반례는 없었다.

## G8. `StatementEquityComponentsAxis` 집중 검증

전체 2,199 fact(발행사 13곳). 단순 count로 끝내지 않고 다섯 가지를 원문으로 확인했다.

### G8.1 무엇이 태깅돼 있는가 — 자본변동표 roll-forward 행이다

WMT FY2026 10-K rendered `R6.htm`(`0000104169-26-000055`)의 열 구성은
`Total | Total Walmart Shareholders' Equity | Common Stock | Capital in Excess of Par Value |
Retained Earnings | Accumulated Other Comprehensive Loss | Nonredeemable Noncontrolling Interest`이고,
행은 `Beginning balances (in shares) at Jan. 31, 2023 … 8,080`이다. element documentation은
`us-gaap_CommonStockSharesOutstanding`이다.

즉 이 축의 fact는 **"보통주 자본 열의 기초·기말 주식수"**이지 class별 유통주식수 보고가 아니다.
taxonomy 정의(G3.2)와 정확히 일치한다.

### G8.2 single-class 발행사 — 값은 맞지만 계열이 오염돼 있다

같은 filing 안에서는 dimensionless 값과 일치한다(INTC 38/38, COST 38/40, AAPL 13/16, XOM 14/14).
**그러나 같은 instant가 뒤 filing에서 다른 값으로 다시 나온다**(G14). 이 축은 filing마다 비교연도
3개의 기초·기말 잔액을 함께 실어 **소급 재작성 표면이 표지·대차대조표 부기보다 훨씬 넓다.**

### G8.3 multi-class 발행사 — aggregate다

META는 class A/B와 `EquityComponents/CommonStock`을 **같은 instant에 함께** 보고하고 합이 정확히 맞는다.

| instant | Class A | Class B | A+B | `EquityComponents/CommonStock` |
|---|---|---|---|---|
| 2024-12-31 | 2,190,000,000 | 344,000,000 | 2,534,000,000 | **2,534,000,000** |
| 2025-06-30 | 2,173,000,000 | 343,000,000 | 2,516,000,000 | **2,516,000,000** |
| 2025-12-31 | 2,187,000,000 | 343,000,000 | 2,530,000,000 | **2,530,000,000** |

표본의 7개 instant 전부 정확히 일치한다. **multi-class에서 이 shape는 총계이고 class가 아니다.**

### G8.4 같은 (axis, member)가 발행사마다 다른 뜻인 사례 — class 축에서도 일어난다

`StatementClassOfStockAxis` + `us-gaap:CommonStockMember`:

| issuer | instant | 값 | 뜻 |
|---|---|---|---|
| **F** | 2026-02-06 (표지) | 3,918,623,149 | **실제 class**. Ford의 보통주는 Class B와 구분되는 별도 class다 |
| **V** | 2023-12-31 | 1,836,000,000 | **총계**. A 1,582,000,000 + B 245,000,000 + C 9,000,000 = 1,836,000,000 정확히 일치 |

**표준 axis · 표준 member · 같은 concept인데 한쪽은 class, 한쪽은 합계다.**
member 이름으로 판정하는 어떤 전역 규칙도 이 둘을 동시에 맞힐 수 없다.

### G8.5 class-specific member가 자본 축 아래 있는 사례

NKE는 2009~2013 filing에서 `EquityComponents/CommonClassAMember` · `.../CommonClassBMember`를 쓴다
(각 8건). class 정보를 담고 있지만 **class 축이 아니다.** 이후 NKE는 `ClassOfStock` + `EquityComponents`
2축 조합으로 옮겼다(G9.1).

### G8.6 zero/retired component가 같은 shape로 존재하는 사례

HD FY2011 10-K(`0000354950-12-000003`)는 `EquityComponents/TreasuryStockMember`에
`CommonStockSharesOutstanding`을 태깅한다.

| instant | 값 | 같은 시점 HD 실제 유통주식수 |
|---|---|---|
| 2009-02-01 | 11,000,000 | 1,696,000,000 |
| 2012-01-29 | 196,000,000 | 1,537,000,000 |

**자기주식 수량이다.** 축 이름만 믿고 member를 검증하지 않으면 유통주식수 자리에 자기주식이 들어간다.
`CommonStockIncludingAdditionalPaidInCapitalMember`(343건)도 결합 열이라 같은 성질이다.

## G9. 복수 dimension context 집중 검증

explicit dimension이 2개인 fact는 1,104개(3개 이상은 0개)다. freshness 통과분 120건의 내역:

| 조합 | 건수 |
|---|---|
| `ClassOfStock` + `EquityComponents` | 116 |
| `ClassOfStock` + `SubsequentEventType` | 2 |
| `CumulativeEffectPeriodOfAdoption` + `EquityComponents` | 2 |

### G9.1 class 축 + 자본 축 — 유일하게 "무해해 보이는" 조합

NKE · NWS · UA · FOX가 자본변동표를 class별로 쪼갠 것이다. class 축이 identity를 들고 있고
자본 축은 열 표시다. **그런데 무해하지 않다** — G11.2의 정밀도 역행이 정확히 이 조합에서 나온다.

### G9.2 class 축 밖의 법인 범위 — Alphabet과 AbbVie

**Alphabet FY2015 10-K(`0001652044-16-000012`) 표지**, rendered `R1.htm` 원문 확인:

```text
Class A Common Stock   Entity Common Stock, Shares Outstanding   292,580,627
Class B Common Stock   Entity Common Stock, Shares Outstanding    50,199,837
Class C Capital Stock  Entity Common Stock, Shares Outstanding   345,539,303
Google Inc.            Entity Common Stock, Shares Outstanding             0
```

마지막 행의 context는 `dei:LegalEntityAxis / SubsidiariesMember` 하나뿐이다.
**이 dimension을 "직교하니 무시"하면 그 fact는 class 없는 total이 되고, Alphabet의 유통주식수가
0이 된다.** 같은 filing은 `LegalEntity/Subsidiaries` + class 축 2축 fact도
(A 286,560,000 · B 53,213,000 · C 340,399,000, instant 2014-12-31) 함께 싣는다.

**AbbVie**: `BusinessAcquisitionAxis / AllerganplcMember`에 `CommonStockSharesOutstanding`
**330,000,000** (instant 2020-05-08, 5개 filing). AbbVie 자신의 유통주식수는 같은 시기 약
1.77십억이다. **다른 회사의 주식수다.** AbbVie는 `us-gaap:CommonStockSharesOutstanding`을
자기 자신에 대해서는 한 번도 쓰지 않으므로(§12.4), 축을 가리지 않는 규칙은 AbbVie의 A tier를
**다른 회사 숫자로 채운다.**

### G9.3 non-actual scope

`StatementScenarioAxis / ScenarioPreviouslyReportedMember`: INTC 2006-12-30 5,766,000,000 ·
COST 2007-09-02 437,013,000. taxonomy가 "Excludes actual facts"라고 못박은 축이다.

### G9.4 period marker

Ford는 표지 수량을 `ClassOfStock/CommonStock` + `SubsequentEventType/SubsequentEvent`로 싣는다
(2023-01-30 3,915,329,785 · 2024-02-02 3,902,781,032 · 2025-02-03 3,892,595,628).
**값 자체는 그 instant의 실제 수량이다.** 이 축은 무해하지만, **무해함이 축 이름에서 나오지 않고
발행사별 확인에서 나온다**는 점이 중요하다.

### G9.5 class 축 밖의 class-identifying 축

BRK 2009 10-Q(`0001157523-09-005813`) 표지는 `dei:EntityListingsInstrumentAxis`의
extension member `ClassAMember`·`ClassBMember`에 수량을 싣는다(1,057,259 · 14,834,062,
instant 2009-07-31). **표준 class 축이 아니지만 실제 class를 특정한다.**
표본에서 2건뿐이고 세 formation의 freshness 창 밖이라 이번 결과에는 영향이 없다.

## G10. Candidate 정의

결과를 보기 전에 고정했고, 결과를 본 뒤 조건을 늘리지 않았다. 다섯 candidate 모두
**dimensionless 규칙(G7)과 CLOSED된 freshness·hierarchy·decimals 규칙을 공유**하고
dimension shape만 다르다.

```text
D0  strict                class 축 단독 + exact 등록 member. 그 밖 shape는 unusable.
D1  axis whitelist        표준 axis whitelist{class 축, EquityComponents 축} 안에서
                          member를 alias로 등록할 수 있게 한다. single dimension만.
D2  one-pair alias        축 종류를 가리지 않되 exact (axis, member) 쌍이 PIT alias로
                          등록됐을 때만 사용. unknown alias는 fail-close. single dimension만.
D3  full-set alias        alias key가 context의 전체 explicit dimension set이다.
D4  identifying subset    context에서 CLASS_IDENTIFYING dimension 하나를 찾아 class를 정하고,
                          나머지 dimension이 허용된 직교 축이면 무시한다.
                          허용 직교 축은 결과를 보기 전에 {EquityComponents, SubsequentEventType}로 고정했다.
```

**등록(registration)은 candidate가 아니라 사람이 한다.** 이 연구의 alias 등록은 G6의 표지
ground truth와 G8·G9의 원문 확인으로만 만들었고, candidate 출력으로 만들지 않았다.

## G11. 결과 표 — ground truth class-formation 94개

`FAIL_CLOSE` = 그 candidate가 그 class에 쓸 수 있는 fact를 하나도 인정하지 못한 것.
December session은 formation에서 결정된다(2013 → 2012-12-31, 2018 → 2017-12-29, 2026 → 2025-12-31).

| issuer | formation | GT class | D0 strict | D1 axis-whitelist | D2 pair-alias | D3 full-set alias | D4 identifying-subset | 선택 fact의 dimension set (D3 기준) |
|---|---|---|---|---|---|---|---|---|
| AAPL | 2013 | SOLE | A 2012-12-29 938,973,000 | A 2012-12-29 938,973,000 | A 2012-12-29 938,973,000 | A 2012-12-29 938,973,000 | A 2012-12-29 938,973,000 | [] |
| AAPL | 2018 | SOLE | A 2017-09-30 5,126,201,000 | A 2017-09-30 5,126,201,000 | A 2017-09-30 5,126,201,000 | A 2017-09-30 5,126,201,000 | A 2017-09-30 5,126,201,000 | [] |
| AAPL | 2026 | SOLE | A 2025-12-27 14,702,703,000 | A 2025-12-27 14,702,703,000 | A 2025-12-27 14,702,703,000 | A 2025-12-27 14,702,703,000 | A 2025-12-27 14,702,703,000 | [] |
| GOOGL | 2018 | A | A 2017-09-30 298,263,000 | A 2017-09-30 298,263,000 | A 2017-09-30 298,263,000 | A 2017-09-30 298,263,000 | A 2017-09-30 298,263,000 | ClassOfStock/CommonClassA |
| GOOGL | 2018 | B | A 2017-09-30 47,054,000 | A 2017-09-30 47,054,000 | A 2017-09-30 47,054,000 | A 2017-09-30 47,054,000 | A 2017-09-30 47,054,000 | ClassOfStock/CommonClassB |
| GOOGL | 2018 | C | A 2017-09-30 349,473,000 | A 2017-09-30 349,473,000 | A 2017-09-30 349,473,000 | A 2017-09-30 349,473,000 | A 2017-09-30 349,473,000 | ClassOfStock/CapitalClassC |
| GOOGL | 2026 | A | A 2025-12-31 5,822,000,000 | A 2025-12-31 5,822,000,000 | A 2025-12-31 5,822,000,000 | A 2025-12-31 5,822,000,000 | A 2025-12-31 5,822,000,000 | ClassOfStock/CommonClassA |
| GOOGL | 2026 | B | A 2025-12-31 837,000,000 | A 2025-12-31 837,000,000 | A 2025-12-31 837,000,000 | A 2025-12-31 837,000,000 | A 2025-12-31 837,000,000 | ClassOfStock/CommonClassB |
| GOOGL | 2026 | C | A 2025-12-31 5,429,000,000 | A 2025-12-31 5,429,000,000 | A 2025-12-31 5,429,000,000 | A 2025-12-31 5,429,000,000 | A 2025-12-31 5,429,000,000 | ClassOfStock/CapitalClassC |
| BRK | 2013 | A | A 2012-12-31 894,955 | A 2012-12-31 894,955 | A 2012-12-31 894,955 | A 2012-12-31 894,955 | A 2012-12-31 894,955 | ClassOfStock/CommonClassA |
| BRK | 2013 | B | A 2012-12-31 1,121,985,472 | A 2012-12-31 1,121,985,472 | A 2012-12-31 1,121,985,472 | A 2012-12-31 1,121,985,472 | A 2012-12-31 1,121,985,472 | ClassOfStock/CommonClassB |
| BRK | 2018 | A | A 2017-09-30 754,684 | A 2017-09-30 754,684 | A 2017-09-30 754,684 | A 2017-09-30 754,684 | A 2017-09-30 754,684 | ClassOfStock/CommonClassA |
| BRK | 2018 | B | A 2017-09-30 1,335,048,578 | A 2017-09-30 1,335,048,578 | A 2017-09-30 1,335,048,578 | A 2017-09-30 1,335,048,578 | A 2017-09-30 1,335,048,578 | ClassOfStock/CommonClassB |
| BRK | 2026 | A | A 2025-12-31 515,835 | A 2025-12-31 515,835 | A 2025-12-31 515,835 | A 2025-12-31 515,835 | A 2025-12-31 515,835 | ClassOfStock/CommonClassA |
| BRK | 2026 | B | A 2025-12-31 1,383,582,639 | A 2025-12-31 1,383,582,639 | A 2025-12-31 1,383,582,639 | A 2025-12-31 1,383,582,639 | A 2025-12-31 1,383,582,639 | ClassOfStock/CommonClassB |
| NVDA | 2013 | SOLE | A 2012-01-29 612,191,412 | A 2012-01-29 612,191,412 | A 2012-01-29 612,191,412 | A 2012-01-29 612,191,412 | A 2012-01-29 612,191,412 | [] |
| NVDA | 2018 | SOLE | A 2017-01-29 585,000,000 | A 2017-01-29 585,000,000 | A 2017-01-29 585,000,000 | A 2017-01-29 585,000,000 | A 2017-01-29 585,000,000 | [] |
| NVDA | 2026 | SOLE | A 2025-01-26 24,477,000,000 | A 2025-10-26 24,305,000,000 | A 2025-10-26 24,305,000,000 | A 2025-10-26 24,305,000,000 | A 2025-01-26 24,477,000,000 | EquityComponents/CommonStock |
| TSLA | 2013 | SOLE | A 2012-12-31 114,214,274 | A 2012-12-31 114,214,274 | A 2012-12-31 114,214,274 | A 2012-12-31 114,214,274 | A 2012-12-31 114,214,274 | [] |
| TSLA | 2018 | SOLE | A 2017-09-30 168,017,000 | A 2017-09-30 168,017,000 | A 2017-09-30 168,017,000 | A 2017-09-30 168,017,000 | A 2017-09-30 168,017,000 | [] |
| TSLA | 2026 | SOLE | A 2025-12-31 3,751,000,000 | A 2025-12-31 3,751,000,000 | A 2025-12-31 3,751,000,000 | A 2025-12-31 3,751,000,000 | A 2025-12-31 3,751,000,000 | [] |
| XOM | 2013 | SOLE | A 2012-09-30 4,559,342,639 | A 2012-09-30 4,559,342,639 | A 2012-09-30 4,559,342,639 | A 2012-09-30 4,559,342,639 | A 2012-09-30 4,559,342,639 | [] |
| XOM | 2018 | SOLE | A 2017-09-30 4,237,000,000 | A 2017-09-30 4,237,000,000 | A 2017-09-30 4,237,000,000 | A 2017-09-30 4,237,000,000 | A 2017-09-30 4,237,000,000 | [] |
| XOM | 2026 | SOLE | A 2025-12-31 4,179,000,000 | A 2025-12-31 4,179,000,000 | A 2025-12-31 4,179,000,000 | A 2025-12-31 4,179,000,000 | A 2025-12-31 4,179,000,000 | [] |
| WMT | 2013 | SOLE | A 2012-01-31 3,418,000,000 | A 2012-01-31 3,418,000,000 | A 2012-01-31 3,418,000,000 | A 2012-01-31 3,418,000,000 | A 2012-01-31 3,418,000,000 | [] |
| WMT | 2018 | SOLE | B 2017-11-29 2,962,381,445 | B 2017-11-29 2,962,381,445 | B 2017-11-29 2,962,381,445 | B 2017-11-29 2,962,381,445 | B 2017-11-29 2,962,381,445 | [] |
| WMT | 2026 | SOLE | B 2025-12-02 7,970,166,964 | A 2025-10-31 7,972,000,000 | A 2025-10-31 7,972,000,000 | A 2025-10-31 7,972,000,000 | B 2025-12-02 7,970,166,964 | EquityComponents/CommonStock |
| INTC | 2013 | SOLE | A 2012-12-29 4,944,000,000 | A 2012-12-29 4,944,000,000 | A 2012-12-29 4,944,000,000 | A 2012-12-29 4,944,000,000 | A 2012-12-29 4,944,000,000 | [] |
| INTC | 2018 | SOLE | A 2017-09-30 4,680,000,000 | A 2017-09-30 4,680,000,000 | A 2017-09-30 4,680,000,000 | A 2017-09-30 4,680,000,000 | A 2017-09-30 4,680,000,000 | [] |
| INTC | 2026 | SOLE | A 2025-12-27 4,994,000,000 | A 2025-12-27 4,994,000,000 | A 2025-12-27 4,994,000,000 | A 2025-12-27 4,994,000,000 | A 2025-12-27 4,994,000,000 | [] |
| ABBV | 2013 | SOLE | FAIL_CLOSE | FAIL_CLOSE | FAIL_CLOSE | FAIL_CLOSE | FAIL_CLOSE | — |
| ABBV | 2018 | SOLE | B 2017-10-24 1,596,429,740 | B 2017-10-24 1,596,429,740 | B 2017-10-24 1,596,429,740 | B 2017-10-24 1,596,429,740 | B 2017-10-24 1,596,429,740 | [] |
| ABBV | 2026 | SOLE | B 2025-10-27 1,767,384,632 | B 2025-10-27 1,767,384,632 | B 2025-10-27 1,767,384,632 | B 2025-10-27 1,767,384,632 | B 2025-10-27 1,767,384,632 | [] |
| FOX | 2026 | A | A 2025-12-31 200,553,435 | A 2025-12-31 200,553,435 | A 2025-12-31 200,553,435 | A 2025-12-31 201,000,000 | A 2025-12-31 201,000,000 | ClassOfStock/CommonClassA + EquityComponents/CommonStock |
| FOX | 2026 | B | A 2025-12-31 224,702,222 | A 2025-12-31 224,702,222 | A 2025-12-31 224,702,222 | A 2025-12-31 224,000,000 | A 2025-12-31 224,000,000 | ClassOfStock/CommonClassB + EquityComponents/CommonStock |
| META | 2013 | A | A 2012-12-31 1,671,000,000 | A 2012-12-31 1,671,000,000 | A 2012-12-31 1,671,000,000 | A 2012-12-31 1,671,000,000 | A 2012-12-31 1,671,000,000 | ClassOfStock/CommonClassA |
| META | 2013 | B | A 2012-12-31 701,000,000 | A 2012-12-31 701,000,000 | A 2012-12-31 701,000,000 | A 2012-12-31 701,000,000 | A 2012-12-31 701,000,000 | ClassOfStock/CommonClassB |
| META | 2018 | A | A 2017-09-30 2,385,000,000 | A 2017-09-30 2,385,000,000 | A 2017-09-30 2,385,000,000 | A 2017-09-30 2,385,000,000 | A 2017-09-30 2,385,000,000 | ClassOfStock/CommonClassA |
| META | 2018 | B | A 2017-09-30 521,000,000 | A 2017-09-30 521,000,000 | A 2017-09-30 521,000,000 | A 2017-09-30 521,000,000 | A 2017-09-30 521,000,000 | ClassOfStock/CommonClassB |
| META | 2026 | A | A 2025-12-31 2,187,000,000 | A 2025-12-31 2,187,000,000 | A 2025-12-31 2,187,000,000 | A 2025-12-31 2,187,000,000 | A 2025-12-31 2,187,000,000 | ClassOfStock/CommonClassA |
| META | 2026 | B | A 2025-12-31 343,000,000 | A 2025-12-31 343,000,000 | A 2025-12-31 343,000,000 | A 2025-12-31 343,000,000 | A 2025-12-31 343,000,000 | ClassOfStock/CommonClassB |
| F | 2013 | COMMON | B 2012-10-26 3,741,809,920 | B 2012-10-26 3,741,809,920 | B 2012-10-26 3,741,809,920 | B 2012-10-26 3,741,809,920 | B 2012-10-26 3,741,809,920 | ClassOfStock/CommonStock |
| F | 2013 | B | B 2012-10-26 70,852,076 | B 2012-10-26 70,852,076 | B 2012-10-26 70,852,076 | B 2012-10-26 70,852,076 | B 2012-10-26 70,852,076 | ClassOfStock/CommonClassB |
| F | 2018 | COMMON | B 2017-10-19 3,901,450,116 | B 2017-10-19 3,901,450,116 | B 2017-10-19 3,901,450,116 | B 2017-10-19 3,901,450,116 | B 2017-10-19 3,901,450,116 | ClassOfStock/CommonStock |
| F | 2018 | B | B 2017-10-19 70,852,076 | B 2017-10-19 70,852,076 | B 2017-10-19 70,852,076 | B 2017-10-19 70,852,076 | B 2017-10-19 70,852,076 | ClassOfStock/CommonClassB |
| F | 2026 | COMMON | B 2025-10-21 3,913,646,490 | B 2025-10-21 3,913,646,490 | B 2025-10-21 3,913,646,490 | B 2025-10-21 3,913,646,490 | B 2025-10-21 3,913,646,490 | ClassOfStock/CommonStock |
| F | 2026 | B | B 2025-10-21 70,852,076 | B 2025-10-21 70,852,076 | B 2025-10-21 70,852,076 | B 2025-10-21 70,852,076 | B 2025-10-21 70,852,076 | ClassOfStock/CommonClassB |
| CMCSA | 2013 | A | A 2012-12-31 2,122,278,635 | A 2012-12-31 2,122,278,635 | A 2012-12-31 2,122,278,635 | A 2012-12-31 2,122,278,635 | A 2012-12-31 2,122,278,635 | ClassOfStock/CommonClassA |
| CMCSA | 2013 | ASPECIAL | A 2012-12-31 507,769,463 | A 2012-12-31 507,769,463 | A 2012-12-31 507,769,463 | A 2012-12-31 507,769,463 | A 2012-12-31 507,769,463 | ClassOfStock/ClassaSpecialCommonStock |
| CMCSA | 2013 | B | A 2012-12-31 9,444,375 | A 2012-12-31 9,444,375 | A 2012-12-31 9,444,375 | A 2012-12-31 9,444,375 | A 2012-12-31 9,444,375 | ClassOfStock/CommonClassB |
| CMCSA | 2018 | A | A 2017-09-30 4,664,327,455 | A 2017-09-30 4,664,327,455 | A 2017-09-30 4,664,327,455 | A 2017-09-30 4,664,327,455 | A 2017-09-30 4,664,327,455 | ClassOfStock/CommonClassA |
| CMCSA | 2018 | B | A 2017-09-30 9,444,375 | A 2017-09-30 9,444,375 | A 2017-09-30 9,444,375 | A 2017-09-30 9,444,375 | A 2017-09-30 9,444,375 | ClassOfStock/CommonClassB |
| CMCSA | 2026 | A | A 2025-12-31 3,594,768,252 | A 2025-12-31 3,594,768,252 | A 2025-12-31 3,594,768,252 | A 2025-12-31 3,594,768,252 | A 2025-12-31 3,594,768,252 | ClassOfStock/CommonClassA |
| CMCSA | 2026 | B | A 2025-12-31 9,444,375 | A 2025-12-31 9,444,375 | A 2025-12-31 9,444,375 | A 2025-12-31 9,444,375 | A 2025-12-31 9,444,375 | ClassOfStock/CommonClassB |
| NWS | 2018 | A | A 2017-09-30 382,976,281 | A 2017-09-30 382,976,281 | A 2017-09-30 382,976,281 | A 2017-09-30 382,976,281 | A 2017-09-30 382,976,281 | ClassOfStock/CommonClassA |
| NWS | 2018 | B | A 2017-09-30 199,630,240 | A 2017-09-30 199,630,240 | A 2017-09-30 199,630,240 | A 2017-09-30 199,630,240 | A 2017-09-30 199,630,240 | ClassOfStock/CommonClassB |
| NWS | 2026 | A | A 2025-12-31 371,777,267 | A 2025-12-31 371,777,267 | A 2025-12-31 371,777,267 | A 2025-12-31 372,000,000 | A 2025-12-31 372,000,000 | ClassOfStock/CommonClassA + EquityComponents/CommonStock |
| NWS | 2026 | B | A 2025-12-31 185,853,935 | A 2025-12-31 185,853,935 | A 2025-12-31 185,853,935 | A 2025-12-31 186,000,000 | A 2025-12-31 186,000,000 | ClassOfStock/CommonClassB + EquityComponents/CommonStock |
| UA | 2013 | A | A 2012-12-31 83,461,106 | A 2012-12-31 83,461,106 | A 2012-12-31 83,461,106 | A 2012-12-31 83,461,106 | A 2012-12-31 83,461,106 | ClassOfStock/CommonClassA |
| UA | 2013 | CONV | A 2012-12-31 21,300,000 | A 2012-12-31 21,300,000 | A 2012-12-31 21,300,000 | A 2012-12-31 21,300,000 | A 2012-12-31 21,300,000 | ClassOfStock/ConvertibleCommonStock |
| UA | 2018 | A | A 2017-09-30 185,128,757 | A 2017-09-30 185,128,757 | A 2017-09-30 185,128,757 | A 2017-09-30 185,128,757 | A 2017-09-30 185,128,757 | ClassOfStock/CommonClassA |
| UA | 2018 | C | A 2017-09-30 222,050,824 | A 2017-09-30 222,050,824 | A 2017-09-30 222,050,824 | A 2017-09-30 222,050,824 | A 2017-09-30 222,050,824 | ClassOfStock/CommonClassC |
| UA | 2018 | CONV | A 2017-09-30 34,450,000 | A 2017-09-30 34,450,000 | A 2017-09-30 34,450,000 | A 2017-09-30 34,450,000 | A 2017-09-30 34,450,000 | ClassOfStock/ConvertibleCommonStock |
| UA | 2026 | A | A 2025-12-31 188,834,386 | A 2025-12-31 188,834,386 | A 2025-12-31 188,834,386 | A 2025-12-31 188,834,386 | A 2025-12-31 188,834,386 | ClassOfStock/CommonClassA |
| UA | 2026 | C | A 2025-12-31 202,487,254 | A 2025-12-31 202,487,254 | A 2025-12-31 202,487,254 | A 2025-12-31 202,487,254 | A 2025-12-31 202,487,254 | ClassOfStock/CommonClassC |
| UA | 2026 | CONV | A 2025-12-31 34,450,000 | A 2025-12-31 34,450,000 | A 2025-12-31 34,450,000 | A 2025-12-31 34,450,000 | A 2025-12-31 34,450,000 | ClassOfStock/ConvertibleCommonStock |
| V | 2013 | A | A 2012-12-31 530,000,000 | A 2012-12-31 530,000,000 | A 2012-12-31 530,000,000 | A 2012-12-31 530,000,000 | A 2012-12-31 530,000,000 | ClassOfStock/CommonClassA |
| V | 2013 | B | A 2012-12-31 245,000,000 | A 2012-12-31 245,000,000 | A 2012-12-31 245,000,000 | A 2012-12-31 245,000,000 | A 2012-12-31 245,000,000 | ClassOfStock/CommonClassB |
| V | 2013 | C | A 2012-12-31 29,000,000 | A 2012-12-31 29,000,000 | A 2012-12-31 29,000,000 | A 2012-12-31 29,000,000 | A 2012-12-31 29,000,000 | ClassOfStock/CommonClassC |
| V | 2018 | A | A 2017-09-30 1,818,000,000 | A 2017-09-30 1,818,000,000 | A 2017-09-30 1,818,000,000 | A 2017-09-30 1,818,000,000 | A 2017-09-30 1,818,000,000 | ClassOfStock/CommonClassA |
| V | 2018 | B | A 2017-09-30 245,000,000 | A 2017-09-30 245,000,000 | A 2017-09-30 245,000,000 | A 2017-09-30 245,000,000 | A 2017-09-30 245,000,000 | ClassOfStock/CommonClassB |
| V | 2018 | C | A 2017-09-30 13,000,000 | A 2017-09-30 13,000,000 | A 2017-09-30 13,000,000 | A 2017-09-30 13,000,000 | A 2017-09-30 13,000,000 | ClassOfStock/CommonClassC |
| V | 2026 | A | A 2025-12-31 1,683,000,000 | A 2025-12-31 1,683,000,000 | A 2025-12-31 1,683,000,000 | A 2025-12-31 1,683,000,000 | A 2025-12-31 1,683,000,000 | ClassOfStock/CommonClassA |
| V | 2026 | B1 | A 2025-12-31 5,000,000 | A 2025-12-31 5,000,000 | A 2025-12-31 5,000,000 | A 2025-12-31 5,000,000 | A 2025-12-31 5,000,000 | ClassOfStock/CommonClassB1 |
| V | 2026 | B2 | A 2025-12-31 120,000,000 | A 2025-12-31 120,000,000 | A 2025-12-31 120,000,000 | A 2025-12-31 120,000,000 | A 2025-12-31 120,000,000 | ClassOfStock/CommonClassB2 |
| V | 2026 | C | A 2025-12-31 9,000,000 | A 2025-12-31 9,000,000 | A 2025-12-31 9,000,000 | A 2025-12-31 9,000,000 | A 2025-12-31 9,000,000 | ClassOfStock/CommonClassC |
| MA | 2013 | A | A 2012-12-31 118,405,075 | A 2012-12-31 118,405,075 | A 2012-12-31 118,405,075 | A 2012-12-31 118,405,075 | A 2012-12-31 118,405,075 | ClassOfStock/CommonClassA |
| MA | 2013 | B | A 2012-12-31 4,838,840 | A 2012-12-31 4,838,840 | A 2012-12-31 4,838,840 | A 2012-12-31 4,838,840 | A 2012-12-31 4,838,840 | ClassOfStock/CommonClassB |
| MA | 2018 | A | A 2017-09-30 1,045,000,000 | A 2017-09-30 1,045,000,000 | A 2017-09-30 1,045,000,000 | A 2017-09-30 1,045,000,000 | A 2017-09-30 1,045,000,000 | ClassOfStock/CommonClassA |
| MA | 2018 | B | A 2017-09-30 15,000,000 | A 2017-09-30 15,000,000 | A 2017-09-30 15,000,000 | A 2017-09-30 15,000,000 | A 2017-09-30 15,000,000 | ClassOfStock/CommonClassB |
| MA | 2026 | A | A 2025-12-31 887,000,000 | A 2025-12-31 887,000,000 | A 2025-12-31 887,000,000 | A 2025-12-31 887,000,000 | A 2025-12-31 887,000,000 | ClassOfStock/CommonClassA |
| MA | 2026 | B | A 2025-12-31 7,000,000 | A 2025-12-31 7,000,000 | A 2025-12-31 7,000,000 | A 2025-12-31 7,000,000 | A 2025-12-31 7,000,000 | ClassOfStock/CommonClassB |
| NKE | 2013 | A | A 2012-11-30 180,000,000 | A 2012-11-30 180,000,000 | A 2012-11-30 180,000,000 | A 2012-11-30 180,000,000 | A 2012-11-30 180,000,000 | ClassOfStock/CommonClassA |
| NKE | 2013 | B | A 2012-11-30 716,000,000 | A 2012-11-30 716,000,000 | A 2012-11-30 716,000,000 | A 2012-11-30 716,000,000 | A 2012-11-30 716,000,000 | ClassOfStock/CommonClassB |
| NKE | 2018 | A | A 2017-11-30 329,000,000 | A 2017-11-30 329,000,000 | A 2017-11-30 329,000,000 | A 2017-11-30 329,000,000 | A 2017-11-30 329,000,000 | ClassOfStock/CommonClassA |
| NKE | 2018 | B | A 2017-11-30 1,295,000,000 | A 2017-11-30 1,295,000,000 | A 2017-11-30 1,295,000,000 | A 2017-11-30 1,295,000,000 | A 2017-11-30 1,295,000,000 | ClassOfStock/CommonClassB |
| NKE | 2026 | A | A 2025-11-30 289,000,000 | A 2025-11-30 289,000,000 | A 2025-11-30 289,000,000 | A 2025-11-30 289,000,000 | A 2025-11-30 289,000,000 | ClassOfStock/CommonClassA + EquityComponents/CommonStock |
| NKE | 2026 | B | A 2025-11-30 1,191,000,000 | A 2025-11-30 1,191,000,000 | A 2025-11-30 1,191,000,000 | A 2025-11-30 1,191,000,000 | A 2025-11-30 1,191,000,000 | ClassOfStock/CommonClassB + EquityComponents/CommonStock |
| COST | 2013 | SOLE | A 2012-11-25 434,824,000 | A 2012-11-25 434,824,000 | A 2012-11-25 434,824,000 | A 2012-11-25 434,824,000 | A 2012-11-25 434,824,000 | [] |
| COST | 2018 | SOLE | A 2017-11-26 439,185,000 | A 2017-11-26 439,185,000 | A 2017-11-26 439,185,000 | A 2017-11-26 439,185,000 | A 2017-11-26 439,185,000 | [] |
| COST | 2026 | SOLE | A 2025-11-23 443,919,000 | A 2025-11-23 443,919,000 | A 2025-11-23 443,919,000 | A 2025-11-23 443,919,000 | A 2025-11-23 443,919,000 | EquityComponents/CommonStock |
| HD | 2013 | SOLE | A 2012-10-28 1,496,000,000 | A 2012-10-28 1,496,000,000 | A 2012-10-28 1,496,000,000 | A 2012-10-28 1,496,000,000 | A 2012-10-28 1,496,000,000 | [] |
| HD | 2018 | SOLE | A 2017-10-29 1,168,000,000 | A 2017-10-29 1,168,000,000 | A 2017-10-29 1,168,000,000 | A 2017-10-29 1,168,000,000 | A 2017-10-29 1,168,000,000 | [] |
| HD | 2026 | SOLE | A 2025-11-02 995,000,000 | A 2025-11-02 995,000,000 | A 2025-11-02 995,000,000 | A 2025-11-02 995,000,000 | A 2025-11-02 995,000,000 | [] |

### G11.1 통계

| 지표 | D0 | D1 | D2 | D3 | D4 |
|---|---|---|---|---|---|
| ground truth class 해결 | 93 / 94 | 93 / 94 | 93 / 94 | 93 / 94 | 93 / 94 |
| — A tier | 83 | 84 | 84 | 84 | 83 |
| — B tier | 10 | 9 | 9 | 9 | 10 |
| `AMBIGUOUS` | 0 | 0 | 0 | 0 | 0 |
| fail-close missing | 1 | 1 | 1 | 1 | 1 |
| ground truth에 없는 class 산출 | 2 | 2 | 2 | 2 | 2 |
| 거절한 fact(사유별) | shape 206 · 미등록 member 11 · multi-class total 12 | 미등록 member 37 · shape 120 · multi-class total 12 | 미등록 member 37 · multi-dim 120 · multi-class total 12 | 미등록 member 37 · 미등록 alias 2 · multi-class total 12 | identifying dim 없음 88 · 미등록 member 11 · multi-class total 12 |

**다섯 candidate의 coverage가 같다.** 유일한 미해결은 ABBV 2013이고 이유는 dimension이 아니라
AbbVie 첫 10-K에 XBRL이 없다는 구조적 결측이다(Follow-up 1 F9). ground truth에 없는 2건은
NWS `SeriesCommonStockMember`(2018·2026)로 **값이 0**이라 ME에 기여하지 않는다.

**즉 이 결정은 coverage로 가릴 수 없다.** 가르는 것은 (1) 어떤 값이 선택되는가와
(2) structural gate가 잘못된 fact를 얼마나 막는가 둘뿐이다.

### G11.2 candidate 간 선택이 갈리는 6개 관측 — 전부 자본 축 때문이다

| issuer | formation | class | D0 | D1 · D2 | D3 · D4 | 판정 |
|---|---|---|---|---|---|---|
| WMT | 2026 | SOLE | **B 2025-12-02 7,970,166,964** (표지, exact) | A 2025-10-31 7,972,000,000 (자본 축, `decimals -6`) | = D0 | **D0이 낫다.** 자본 축을 받으면 A tier가 이겨서 60일 더 오래되고 백만 단위로 반올림된 값이 December denominator가 된다 |
| NVDA | 2026 | SOLE | A 2025-01-26 24,477,000,000 | **A 2025-10-26 24,305,000,000** | = D0 | **D1·D2가 낫다.** NVDA는 부기 부분을 10-K에만 싣고 분기 수량은 자본변동표에만 있다 |
| FOX | 2026 | A | **A 2025-12-31 200,553,435** (`INF`) | = D0 | A 2025-12-31 201,000,000 (`-6`) | **D3·D4가 나쁘다** |
| FOX | 2026 | B | **A 2025-12-31 224,702,222** (`INF`) | = D0 | A 2025-12-31 224,000,000 (`-6`) | 〃 |
| NWS | 2026 | A | **A 2025-12-31 371,777,267** (`INF`) | = D0 | A 2025-12-31 372,000,000 (`-6`) | 〃 |
| NWS | 2026 | B | **A 2025-12-31 185,853,935** (`INF`) | = D0 | A 2025-12-31 186,000,000 (`-6`) | 〃 |

**FOX·NWS 역행의 기전을 정확히 적는다.** 2월 10-Q(`0001628280-26-005285`)는 같은 instant에
class 축 단독 `INF` 정확값과 class+자본 2축 `-6` 반올림값을 **함께** 싣는다. 같은 accession
안이라면 CLOSED된 rounding-interval consolidation이 `INF`를 고른다. 그런데 5월 10-Q
(`0001628280-26-033172`)는 그 instant에 대해 **2축 `-6` fact만** 싣고, CLOSED된 cross-accession
tie-break(`acceptance DESC`)가 그 filing을 먼저 고른다. **결과적으로 5월의 반올림값이 2월의
정확값을 이긴다.** D0·D1·D2는 2축 fact를 아예 인정하지 않으므로 이 경로가 생기지 않는다.

이것은 dimension-scope 결정과 CLOSED된 tie-break의 상호작용이지 tie-break 자체의 문제가 아니다.

## G12. structural gate만으로 충분한가 — naive 변형 진단

위 결과가 다섯 candidate에서 같은 이유는 **등록이 모든 일을 하고 있기 때문**이다. 그래서
등록을 뺀 naive 변형을 따로 돌려 **gate 자체의 방어력**을 쟀다. 세 formation의 freshness 통과
fact만 대상이다.

| naive gate | class로 받은 fact | 그중 실제 class | **class가 아닌데 받은 fact** | 내역 |
|---|---|---|---|---|
| D1n — 축 whitelist만, member 등록 없음 | 695 | 648 | **47** | 자본 구성요소 27 · 합계 15 · derived 5 |
| D2n — single dimension이면 무조건 | 695 | 648 | **47** | 〃 |
| D4n — class 축이 있으면 나머지 dimension 전부 무시 | 790 | 766 | **24** | 자본 구성요소 13 · derived 5 · 합계 6 |

D1n·D2n이 class로 받아버린 대표 fact:

| issuer | instant | 값 | dimension | 실제 뜻 |
|---|---|---|---|---|
| HD | 2012-01-29 | 196,000,000 | `EquityComponents/TreasuryStock` | 자기주식 (실제 유통 1,537,000,000) |
| META | 2012-12-31 | 2,372,000,000 | `EquityComponents/CommonStock` | A+B 합계 |
| INTC | 2012-12-29 | 4,944,000,000 | `EquityComponents/CommonStockIncludingAdditionalPaidInCapital` | 결합 자본 열 |
| V | 2025-03-31 | 125,000,000 | `ClassOfStock/CommonClassB1AndB2` | B1+B2 합계 |
| BRK | 2025-03-31 | 1,438,223 | `ClassOfStock/EquivalentClassA` | Class B의 A 환산 memo |
| NKE | 2012-05-31 | 90,000,000 / 368,000,000 | `EquityComponents/CommonClassA` · `.../CommonClassB` | 자본 열 |

D4n은 class 축이 identity를 들고 있는 만큼 덜 틀리지만, **class 축이 없는 context에서 dimension을
전부 무시해 총계로 만드는 경로**가 새로 생긴다. INTC의
`CumulativeEffectPeriodOfAdoption` + `EquityComponents` fact(2025-03-29, 4,362,000,000)가
두 dimension을 모두 잃고 INTC의 issuer total로 들어간다. G9.2의 Alphabet `Google Inc.` 행이
바로 이 경로이며, Alphabet은 multi-class라 total 규칙에 막혔을 뿐이다 — **single-class 발행사에
공동등록 자회사가 있으면 막을 것이 없다.**

**결론은 분명하다. axis 이름 whitelist도, "class 축이 있으면 나머지는 직교" 규칙도,
그 자체로는 structural evidence가 되지 못한다.** 방어하는 것은 언제나 **exact alias 등록**이다.
G9.2의 Alphabet `Google Inc. = 0`과 AbbVie `Allergan plc = 330,000,000`은 세 formation의
freshness 창 밖이라 위 숫자에는 안 잡히지만, 같은 gate가 그 fact들도 그대로 통과시킨다.

## G13. 이번에 새로 드러난 것 — 소급 재작성은 shape를 가리지 않는다

**`PROBE-me-source.md` §8.5의 "split은 PIT 규칙이 이미 막아준다"는 이 표본에서 성립하지 않는다.**
그 절은 "당시 filing만 그 시점 수량을 들고 있고 이후 filing은 그 instant를 아예 갖지 않는다"고
적었는데, **자본변동표와 비교연도 부기는 옛 instant를 다시 싣고 split 비율로 소급 조정한다.**

같은 (issuer, shape, instant)에 값이 1.5배 이상 어긋나는 조합이 **표본 전체에서 71개** 나왔다.

| shape | 건수 | 대표 |
|---|---|---|
| `EquityComponents/CommonStock` | 21 | NVDA 2022-01-30 : 2,506,000,000 (2024-02-21 수리) → **25,064,000,000** (2025-02-26 수리, 10:1 split 소급) |
| class 축 단독 | 31 | GOOGL 2021-12-31 Class A : 300,737,000 → **6,015,000,000** (20:1) · MA 2012-12-31 Class A : 118,405,075 → **1,184,050,750** (10:1) |
| class 축 + 자본 축 | 6 | NKE 2013-05-31 Class B : 716,000,000 → 1,433,000,000 (2:1) |
| `EquityComponents/CommonClassA·B` | 6 | NKE 2010-05-31 |
| dimensionless | 7 | AAPL 2013-09-28 : 899,213,000 → **6,294,494,000** (7:1) · TSLA 2019-12-31 : 181,000,000 → 905,000,000 (5:1) |

**소급 조정은 dimensionless·class 축·자본 축 전부에서 일어난다. dimension scope 결정으로 막을 수
있는 문제가 아니다.** 다만 자본 축은 filing마다 비교연도 3개의 기초·기말 잔액을 다시 실으므로
**노출 표면이 가장 넓다**(21건, 그리고 NVDA는 같은 instant가 4년에 걸쳐 12개 filing에 반복된다).

같은 검사에서 **filer 단위 오류**도 드러났다.

| issuer | shape | instant | 값 | 오류 |
|---|---|---|---|---|
| COST | `EquityComponents/CommonStock` | 2018-09-02 · 2018-11-25 · 2019-09-01 · 2019-11-24 | 438,189,000 → **438,189,000,000** | 10-Q `0000909832-19-000033` 한 건에서만 1,000배. `decimals`·unit은 그대로 |
| UA | `ClassOfStock/CommonClassA` | 2011-06-30 · 2011-12-31 | 39,669,162 → **78,338,324,000** | 2:1 split 소급과 1,000배 단위 오류가 겹쳤다 |

**COST 오류는 자본 축에만 있고 UA 오류는 class 축에 있다.** 어느 shape도 filer 오류에서 자유롭지
않지만, **cross-accession tie-break가 `acceptance DESC`라서 나중에 들어온 잘못된 값이 이긴다**는
점은 공통이다.

> **이것은 이번 연구가 닫는 문제가 아니다.** split basis / 소급 재작성 처리와
> cross-accession tie-break는 별도 OPEN decision이고, 여기서는 증거만 남긴다.
> **다만 `PROBE-me-source.md` §8.5의 근거가 이 표본에서 반증됐다는 사실은 기록해야 한다.**

## G14. QName contract를 문자 그대로 적용한 결과

§19 계약(standard는 `us-gaap`/`dei` family, issuer extension은 raw namespace URI exact)을
그대로 적용해 집계했다. 두 가지가 드러났다.

**1. issuer-extension namespace URI는 filing 기간마다 바뀐다.** 표본에서 비표준 namespace URI가
**154개**이고, 같은 member local name이 다음처럼 쪼개진다.

| extension member local | 서로 다른 namespace URI 수 | 예 |
|---|---|---|
| `CapitalClassCMember` (Alphabet Class C) | **43** | `http://www.google.com/20150930` |
| `EquivalentClassAMember` (Berkshire) | 34 | `http://www.berkshirehathaway.com/20171231` |
| `ClassaSpecialCommonStockMember` (Comcast) | 17 | `http://www.comcast.com/20120630` |
| `ClassCCommonStockMember` (Visa) | 9 | `http://usa.visa.com/20090630` |
| `SeriesCommonStockMember` (News Corp) | 9 | `http://newscorp.com/20170630` |
| `CommonClassB1Member` (Visa) | 9 | `http://wwww.visa.com/20240331` |

**raw URI를 alias identity key로 쓰면 Alphabet Class C 하나에 alias row가 43개 필요하고,
분기마다 하나씩 늘어난다.** 그 registry는 원리상 완성될 수 없고, 미등록 alias는 fail-close이므로
**새 분기 filing이 들어올 때마다 그 class가 조용히 사라진다.**

이미 이 문서 §10이 권고한 `ext:<발행사 CIK>` family token이 이 데이터가 지지하는 해법이다.
raw URI는 provenance로 계속 보존한다.

**2. `srt` family가 계약에 없다.** 표본의 `CumulativeEffectPeriodOfAdoptionAxis`는
`http://fasb.org/srt/2020-01-31` … `http://fasb.org/srt/2025`의 **5개 URI**로 나타난다.
`srt`는 표준 namespace인데 family 목록에 없어서 지금 계약대로면 issuer extension처럼 취급되고
taxonomy 연도마다 다른 축으로 세어진다. `LegalEntityAxis`·`StatementScenarioAxis`도 최신
taxonomy에서는 `srt`에 있다(이 표본에서는 `dei`·`us-gaap` 판이 나왔다).

> **어느 것도 이번 결정을 바꾸지 않는다.** 다만 alias row의 key를 정할 때 반드시 함께 정해야 한다.

## G15. ground truth 확인 범위

**94개 행 전부를 사람이 rendered SEC 출력과 1:1 대조하지 않았다.** §9·F14와 같은 기준이다.

사람이 원문(rendered 또는 raw instance)과 직접 대조한 것:

| 대상 | 원문 | 결과 |
|---|---|---|
| WMT FY2026 자본변동표 | `0000104169-26-000055` rendered `R6.htm` | 열이 `Total · Total Walmart Shareholders' Equity · Common Stock · Capital in Excess of Par Value · Retained Earnings · AOCI · Nonredeemable NCI`, 행이 `Beginning balances (in shares) at Jan. 31, 2023 = 8,080`(백만), element `us-gaap_CommonStockSharesOutstanding` |
| Alphabet FY2015 표지 | `0001652044-16-000012` rendered `R1.htm` | `Class A 292,580,627 · Class B 50,199,837 · Class C 345,539,303 · Google Inc. 0` |
| Comcast FY2012 표지 | `0001193125-13-067658` rendered `R1.htm` | `Class A Common Stock [Member] · ClassA Special Common Stock [Member] · Class B Common Stock [Member]` 세 열 |
| Visa FY2026 Q1 표지 | `0001403161-26-000045` rendered `R1.htm` | `Class A 1,681,093,942 · Class B-1 4,835,384 · Class B-2 120,338,948 · Class C 8,904,197`. 옛 Class B 없음 |
| Berkshire FY2025 | `0001193125-26-083899` rendered `R4.htm` | `Equivalent Class A [Member]`가 `Net earnings per average equivalent` 행에 붙는다 — EPS 분모 memo |
| Alphabet 2025-12-31 tie-out | raw instance | dimensionless 12,088,000,000 = A 5,822,000,000 + B 837,000,000 + C 5,429,000,000 |
| META tie-out | raw instance | `EquityComponents/CommonStock` = Class A + Class B, 7개 instant 전부 정확히 일치 |
| Visa tie-out | raw instance | `ClassOfStock/CommonStock` = A+B+C · `CommonClassB1AndB2` = B1+B2, 각 instant 정확히 일치 |
| NKE 2012-11-30 tie-out | raw instance | 표지 dimensionless 895,711,770 = A 179,784,496 + B 715,927,274 |
| HD 자기주식 | `0000354950-12-000003` raw instance | `EquityComponents/TreasuryStock`에 `CommonStockSharesOutstanding` |
| AbbVie Allergan | `0001551152-20-000023` 외 4건 raw instance | `BusinessAcquisition/Allerganplc` 330,000,000 |
| taxonomy 정의 | `us-gaap-doc-2025.xml` · `srt-doc-2025.xml` | G3.2 표 |
| Guide 절 | `xbrl-guide-2026-05-15.pdf` p.15·55·104·118·141 | G3.1 인용 |

나머지 행은 **구조 분류(concept · instant · 전체 dimension set · semantic · status)만 검증했고
값의 경제적 정확성을 개별 확인하지 않았다.**

## G16. 이번에 결정하지 않은 것

1. **split basis / 소급 재작성**(G13)은 OPEN이다. `PROBE-me-source.md` §8.5의 근거가
   반증됐다는 사실만 기록하고 처리 규칙은 정하지 않았다.
2. **cross-accession tie-break**(`acceptance DESC`)가 반올림값·오류값을 이기게 하는 문제(G11.2·G13)는
   `decimals` OPEN decision과 함께 봐야 한다. 여기서 바꾸지 않았다.
3. **alias key의 namespace 표현**(G14)은 이번 추천과 독립이지만 alias row를 만들 때 함께 정해야 한다.
4. **`dei:EntityListingsInstrumentAxis`**(G9.5)를 class-identifying 축으로 등록할지는 열어 둔다.
   표본에서 2건뿐이고 세 formation의 freshness 창 밖이라 판정에 쓸 근거가 얇다.
5. **retired class**는 여전히 identity `effective_to`의 책임이다. 이번 dimension 결정이
   그것을 대신하지 않는다.

## User decision — dimension scope

추천: **A — strict class-axis + dimensionless only (D0).**
그리고 §18이 물은 alias row의 최소 identity는 **A — one exact axis/member**다.

```text
direct outstanding fact를 actual ordinary class의 PIT share count로 인정하는 shape는 둘뿐이다.

  (1) explicit dimension이 하나도 없는 context
        -> 그 시점 identity에 등록된 ordinary-common class가 정확히 1개일 때만
           그 class의 수량으로 쓴다. 2개 이상이면 총계이므로 어떤 class에도 배분하지 않는다.

  (2) explicit dimension이 정확히 하나이고, 그 축이 class-of-stock 축이며,
      그 (axis, member)가 그 발행사·그 시점에 PIT alias로 등록돼 있을 때

그 밖의 모든 shape는 unusable이고 fail-close다.
```

§23이 요구한 기준별로 적는다.

- **actual economic class identity를 정확히 보존하는가.** 보존한다. 공식 semantics가
  class 범위를 정하는 축을 class-of-stock 축으로 한정하고(Guide §3.2.3·§3.2.4 Note 3·§6.4.2),
  class 축 없는 fact를 총계로 정의한다(§5.7·§6.4.1). D0는 그 정의를 그대로 옮긴 것이다.
- **multi-class double count를 막는가.** 막는다. dimensionless를 class에 배분하지 않고
  (GOOGL 2025-12-31에서 2.08배 과대를 막는다), 자본 축 aggregate도 받지 않는다
  (META `EquityComponents/CommonStock` = A+B, 7개 instant 정확히 일치). 합계 member는
  class 축에 있어도 등록되지 않으므로 막힌다(V `CommonClassB1AndB2`·`CommonStockMember`).
- **subsidiary / segment / entity scope 오염을 막는가.** 막는다. `LegalEntityAxis`·
  `BusinessAcquisitionAxis`·`StatementScenarioAxis`가 붙은 context는 shape 자체로 탈락한다.
  Alphabet 표지의 `Google Inc. = 0`과 AbbVie의 `Allergan plc = 330,000,000`이 D0에서
  구조적으로 들어올 수 없다. **D4의 "직교 축은 무시" 규칙은 이 두 축이 직교가 아님을
  증명해야 하는데, 증명해야 할 목록이 열려 있다.**
- **issuer-specific numeric exception이 필요한가.** 필요 없다. 규칙은 shape와 등록 여부만 본다.
  발행사 이름·숫자·whitelist가 들어가지 않는다.
- **taxonomy 연도 변화에 안정적인가.** 안정적이다. 판정에 쓰는 것은 `us-gaap` family +
  local name이고 URI 연도는 provenance로만 남는다. 다만 **issuer-extension member의
  namespace 표현은 G14대로 따로 정해야 한다** — 그 결정은 다섯 candidate 전부에 똑같이 걸린다.
- **alias history / retirement와 자연스럽게 결합하는가.** 결합한다. 한 class에 여러
  (axis, member) alias를 기간별로 매다는 이미 승인된 모델이 그대로 쓰인다 —
  Comcast Class A Special의 표기 4개, Visa Class C의 표기 2개, Berkshire 2009 표기가
  전부 alias row로 표현되고, 은퇴는 class의 `effective_to`가 정한다.
- **구현 복잡도.** 가장 낮다. alias key가 `(axis, member)` 한 쌍이고 축이 두 개로 고정된다.
  D3는 alias key가 dimension **집합**이라 registry가 shape 수만큼 늘고(표본에서 205개),
  D4는 축마다 "직교인가"를 증명해 유지해야 한다.
- **deterministic fail-close인가.** 그렇다. 미등록 member·미허용 shape·multi-class
  dimensionless는 전부 값 없이 멈춘다. 조용히 다른 값으로 대체되지 않는다.

**coverage로 고른 것이 아니라는 점을 분명히 한다.** 다섯 candidate 모두 ground truth class
94개 중 93개를 해결했고 유일한 결측(ABBV 2013)은 dimension과 무관하다. 갈린 것은 **어떤 값이
선택되는가** 6건뿐이고, 그중 **4건(FOX·NWS 2026)에서 D3·D4가 정확값 대신 백만 단위 반올림값을
고른다.** 나머지 2건은 서로 반대 방향이다 — WMT 2026은 D0가 더 정확한 표지 값을 쓰고(D1·D2는
60일 더 오래되고 반올림된 자본 축 값을 A tier로 올린다), NVDA 2026은 D1·D2가 더 최신
instant를 얻는다. **1승 1패에 4패다.**

**B(축 whitelist)를 추천하지 않는 이유.** 축 이름은 structural evidence가 아니다.
`StatementEquityComponentsAxis` 아래에는 자기주식(HD)·결합 자본 열(INTC·V·META)·합계(META·V)가
같이 들어 있고, 방어하는 것은 축이 아니라 member 등록이다(G12에서 등록을 빼면 47건이 통과한다).
등록을 요구하는 순간 B는 C의 부분집합이 되고, 축 목록만 남아 `dei:EntityListingsInstrumentAxis`
같은 실제 class 축을 놓친다.

**C(one-pair alias, 축 무제한)를 추천하지 않는 이유는 조금 다르다.** C는 D0보다 표현력이 넓고
NVDA 2026 한 건을 개선한다. 하지만 자본 축 member를 "이 발행사는 class가 하나니까 그 class"로
등록하는 것은 **alias 자체의 성질이 아니라 class universe에 의존하는 매핑**이다 — 그 발행사가
class를 하나 더 만드는 순간 같은 alias가 조용히 합계로 바뀐다. 게다가 그 계열은 소급 재작성
표면이 가장 넓고(G13에서 21건) filer 단위 오류도 그 축에서 나왔다(COST 1,000배).
**얻는 것이 관측 1건이고 잃는 것이 그 구조적 위험이면 지금은 열지 않는 쪽이 맞다.**

**D(full dimension-set alias)를 추천하지 않는 이유.** §13이 요구한 대로 실제 반례를 찾았는데,
**2축 context가 추가로 만들어내는 class 관측이 0이다.** freshness를 통과한 2축 fact 120건은
전부 이미 1축 class fact가 같은 class를 커버하는 경우였고, 대신 G11.2의 정밀도 역행 4건을
만들었다. **필요를 증명하는 반례가 없으므로 채택하지 않는다.**

**E(identifying subset + 직교 규칙)를 추천하지 않는 이유.** D와 같은 정밀도 역행을 그대로 안으면서,
"어떤 축이 무해한가"를 축마다 증명해야 한다. 이 표본만으로도 무해하지 않은 축이 셋
(`LegalEntityAxis`·`BusinessAcquisitionAxis`·`StatementScenarioAxis`) 나왔고, 목록은 발행사가
새 축을 쓸 때마다 늘어난다. **허용 목록을 나중에 넓히는 압력이 구조적으로 생기는 규칙이다.**

**F(증거 부족)로 닫지 않는 이유.** 공식 semantics가 이 질문에 직접 답하고(Guide §3.2.3·§3.2.4
Note 3·§5.7·§6.4.1·§6.4.2 + taxonomy 정의), 표본에서 각 shape의 실제 의미를 tie-out과
rendered 원문으로 확인했다. 판단에 필요한 것은 다 나왔다.

**함께 기억할 것 셋.**

1. **`us-gaap:CommonStockSharesOutstanding`이 있다고 그것이 class 수량인 것은 아니다.**
   같은 concept이 자기주식(HD)·합계(META·V)·다른 회사(ABBV)·비실제 시나리오(INTC·COST)에도
   붙는다. 판정하는 것은 concept이 아니라 **context**다.
2. **`CommonStockMember`는 축에 따라 뜻이 갈리고, class 축 위에서도 발행사마다 갈린다**
   (F는 class, V는 합계). member 이름 기반 규칙을 만들지 않는다.
3. **WMT의 A tier 공백은 dimension scope로 메우지 않는다.** 이미 승인된 A→B hierarchy가
   더 정확한 표지 값을 준다(2025-12-02 7,970,166,964, exact). 자본 축을 열면 오히려
   더 오래되고 반올림된 값이 A tier로 올라온다.

**이 follow-up도 research 결과일 뿐 아직 CLOSED/FROZEN 계약이 아니다.**

---

# Follow-up 3 — split basis / retrospective restatement (2026-08-28)

> **Status: RESEARCH EVIDENCE ONLY.** 위 세 절과 같다. 설계 승인·freeze가 아니고 production
> code/schema/test/roadmap의 의미를 바꾸지 않는다. Gate · `coverage_start` · B/M · rank ·
> returns는 이번에도 계산하지 않았고 production DB에 쓰지 않았다.

시작 main: `637caf04bb8accbb91486dc543e8ba23b6d749d2`
(`research(qv): share-count dimension scope를 검증한다` — 바로 위 절을 커밋한 지점이고
`origin/main`도 같았다.)

**이번에 다시 열지 않은 것.** December class price = `bars_daily.raw_close`(조정가 금지) ·
share source = raw XBRL instance · 허용 form 네 가지 · A/B hierarchy와 `AMBIGUOUS` fail-close ·
measurement-calendar-year freshness boundary(hierarchy보다 먼저) · dimension scope D0 ·
identity의 economic class ↔ XBRL alias 분리와 `effective_to` 정본 · QName alias key ·
한 accession 안의 `decimals` interval consolidation · companyfacts·issued−treasury·
조정가 ME·발행사 숫자 whitelist 금지.

## H1. 이번 질문 하나

> **SEC filing이 과거 instant의 shares를 stock split에 맞춰 소급 재작성했을 때,
> December t-1 raw price와 같은 share basis를 어떻게 보장할 것인가?**

Follow-up 2의 G13이 남긴 것이다. 같은 `(issuer, shape, instant)`에 값이 배수로 어긋나는 조합이
71개였고, `PROBE-me-source.md` §8.5의 "split은 PIT 규칙이 이미 막아준다"가 그 표본에서
반증됐다는 사실만 기록하고 처리 규칙은 열어 뒀다.

**보장해야 하는 것은 하나다.**

```text
ME = shares_on_December_price_basis × December_raw_close
```

## H2. 가설의 공식 근거 — SAB Topic 4.C

§9가 세운 가설("filing 안의 과거 주식수는 그 filing이 발행되는 시점의 split basis로 표현된다")은
추측이 아니라 SEC 공식 해석이다.

출처: [SEC Codification of Staff Accounting Bulletins, Topic 4: Equity Accounts](https://www.sec.gov/interps/account/sabcodet4.htm),
**C. Change In Capital Structure**

> "**Facts**: A capital structure change to a stock dividend, stock split or reverse split occurs
> after the date of the latest reported balance sheet but before the release of the financial
> statements or the effective date of the registration statement, whichever is later.
> **Question**: What effect must be given to such a change?
> **Interpretive Response**: **Such changes in the capital structure must be given retroactive
> effect in the balance sheet.** An appropriately cross-referenced note should disclose the
> retroactive treatment, explain the change made and state the date the change became effective."

**filing 원문에서도 그대로 확인된다.**

| filing | 인용 |
|---|---|
| Mastercard FY2013 10-K `0001141391-14-000003` (제출 2014-02-14, ex-date 2014-01-22 **이후**) | "The number of shares and per share amounts below have been **retroactively restated** to reflect the ten-for-one stock split of the Company's **Class A and Class B** common shares, which was effected in the form of a common stock dividend distributed on January 21, 2014." |
| NVIDIA FY2022 10-K `0001045810-22-000036` (제출 2022-03-18, ex-date 2021-07-20 이후) | "On July 19, 2021, we executed a four-for-one stock split … **All share, equity award, and per share amounts and related shareholders' equity balances presented herein have been retroactively adjusted to reflect the Stock Split.**" |
| Berkshire FY2009 10-K `0001193125-10-043450` (제출 2010-03-01, ex-date 2010-01-21 이후) | "Adjusted for the **50-for-1 Class B stock split** that became effective on January 21, 2010." · "Net earnings per Class B common share is equal to one-fifteen-hundredth (1/1,500) of such amount … after giving effect to the 50-for-1 Class B stock split" |

세 가지가 여기서 확정된다.

1. **share amount의 basis는 fact instant가 아니라 filing 시점이다.**
2. **split은 발행사가 아니라 class에 적용된다** — MA는 "Class A and Class B", BRK는 "Class B" 한쪽뿐이다.
3. **A tier(재무제표)만의 이야기다.** B tier(표지 `dei:EntityCommonStockSharesOutstanding`)는
   instant가 filing 직전 날짜라 소급 대상이 되지 않는다. 표본에서 표지 fact가 뒤 filing에
   재보고된 사례는 **0건**이다.

## H3. explicit split-event source — EODHD Historical Splits

현재 credential로 **READ-ONLY** 확인했다. `eodhd.py`·`data.py`·schema·DB는 건드리지 않았다.

```text
endpoint   GET https://eodhd.com/api/splits/{SYMBOL}.US?from=1990-01-01&to=2026-08-28&fmt=json
필드       date (ex-date) · split ("7.000000/1.000000" 형식)
조회일     2026-08-28
현재 plan  접근 가능. 1990년대 이벤트까지 내려온다(HD 1990-07-06, NKE 1990-10-08 확인)
```

표본 20 발행사의 class별 상장 심볼 26개를 조회해 **이벤트 후보 55개**를 얻었다. 각 이벤트는
`symbol · ex_date · ratio · source(EODHD splits API) · 조회일`로 기록했다.

**단, 이 feed는 그대로 쓸 수 없다.** 다음 절이 이유다.

## H4. vendor split feed는 share-count event 목록이 아니다

**가장 중요한 발견이다.** EODHD `splits`가 주는 것은 **가격 조정 계수**이고, 그 안에는
주식수를 전혀 바꾸지 않는 기업행동이 섞여 있다.

| issuer | vendor 이벤트 | 실제 성격 | 그 class의 주식수 변화 |
|---|---|---|---|
| UA (UAA) | 2016-04-08 ×2 | **Class C 신주 배당**(A·B 보유자에게 C 1주씩) | Class A 181,646,468 → 183,141,109 = **×1.008 (변화 없음)** |
| CMCSA | 2026-01-05 ×1.067 | Versant 분사 | Class A 3,634,450,130 → 3,588,401,619 = **×0.987 (변화 없음)** |
| UA (UA) | 2016-06-13 ×1.0071 | Class C 관련 조정 | Class C 217,591,109 → 219,454,106 = **×1.009 (변화 없음)** |
| F | 1998·2000 세 건 | 분사·자본재편 계수 | (표본 구간 밖) |
| GOOG/GOOGL | 2014-03-27 ×2.002 · 2014-04-03 ×1.998 · 2015-04-27 ×1.0027 | Class C 배당과 집단소송 합의 조정 | Alphabet CIK 이전이라 관측 불가 |

**UA 2016-04-08이 결정적이다.** 가격은 실제로 반토막 났고(88.82 → 43.54, ×2.04) vendor는 2:1
split이라고 적지만, **Class A의 주식수는 그대로다.** 늘어난 것은 새로 만들어진 Class C다.
이 계수를 Class A 주식수에 곱하면 정확히 2배 틀린다.

> 이것은 §6이 금지한 `raw_close/adj_close` 추론과 같은 종류의 함정이다.
> **가격이 반토막 났다는 사실은 주식수가 두 배가 됐다는 증거가 아니다.**

그래서 이 연구는 vendor 이벤트를 **후보**로만 쓰고, **승인은 그 class 자신의 SEC 주식수
증거로만** 했다. 판정 기준은 이렇다.

```text
ex_date 이전에 '보고된' 마지막 관측  vs  ex_date 이후에 '보고된' 첫 관측   (SAB 4.C: 보고 시점이 basis를 정한다)
표지(B tier)를 1순위 증거로 쓴다 — instant가 보고일에 붙어 있어 basis 전환을 직접 보여준다

관측 비율 ≈ 1                     -> NO_SHARE_EFFECT   (주식수를 바꾸지 않는 이벤트)
관측 비율 ≈ vendor 비율            -> SHARE_SPLIT_CONFIRMED
그 밖                              -> UNRESOLVED
그 시점에 class가 없으면            -> NO_EVIDENCE
```

**비상장 class에는 vendor 이벤트가 아예 없다.** 그래서 같은 날 같은 발행사의 상장 class 비율을
**후보로만** 빌려오고, 승인은 그 비상장 class 자신의 SEC 표지 관측으로만 했다.
**발행사 단위 자동 전파는 하지 않았다.**

## H5. class-level 판정 결과

| issuer | class | 상장 심볼 | ex-date | vendor 비율 | SEC 주식수 증거 (표지 tier B 우선) | 판정 |
|---|---|---|---|---|---|---|
| BRK | A | BRK-A | 2010-01-21 | — | 2009-10-29 1,056,884 → 2010-02-18 1,103,764 = ×1.044 | 주식수 변화 없음 · 원문 확인 |
| BRK | B | BRK-B | 2010-01-21 | ×50 | 2009-10-29 14,845,356 → 2010-02-18 814,349,921 = ×54.856 | **주식수 split 확정** · 원문 확인 |
| UA | A | UAA | 2012-07-10 | ×2 | 2012-04-30 41,032,837 → 2012-07-31 82,662,728 = ×2.015 | **주식수 split 확정** |
| UA | C | UA | 2012-07-10 | — | 관측 없음 (그 시점 class 미존재) | 증거 없음 |
| UA | CONV | 비상장 | 2012-07-10 | — | 2012-04-30 11,100,000 → 2012-07-31 21,800,000 = ×1.964 | **주식수 split 확정** |
| NKE | A | 비상장 | 2012-12-26 | — | 2012-08-31 89,892,248 → 2012-11-30 179,784,496 = ×2.000 | **주식수 split 확정** |
| NKE | B | NKE | 2012-12-26 | ×2 | 2012-08-31 360,660,170 → 2012-11-30 715,927,274 = ×1.985 | **주식수 split 확정** |
| MA | A | MA | 2014-01-22 | ×10 | 2013-10-24 115,800,964 → 2014-02-06 1,141,285,340 = ×9.856 | **주식수 split 확정** |
| MA | ADDLSERIES | 비상장 | 2014-01-22 | — | 관측 없음 (그 시점 class 미존재) | 증거 없음 |
| MA | B | 비상장 | 2014-01-22 | — | 2013-10-24 4,576,623 → 2014-02-06 45,255,390 = ×9.888 | **주식수 split 확정** |
| GOOGL | A | GOOGL | 2014-03-27 | — | 관측 없음 (그 시점 class 미존재) | 증거 없음 |
| GOOGL | B | 비상장 | 2014-03-27 | — | 관측 없음 (그 시점 class 미존재) | 증거 없음 |
| GOOGL | C | GOOG | 2014-03-27 | ×2.002 | 관측 없음 (그 시점 class 미존재) | 증거 없음 |
| GOOGL | A | GOOGL | 2014-04-03 | ×1.9981 | 관측 없음 (그 시점 class 미존재) | 증거 없음 |
| GOOGL | B | 비상장 | 2014-04-03 | — | 관측 없음 (그 시점 class 미존재) | 증거 없음 |
| GOOGL | C | GOOG | 2014-04-03 | — | 관측 없음 (그 시점 class 미존재) | 증거 없음 |
| UA | A | UAA | 2014-04-15 | ×2 | 2014-01-31 85,828,707 → 2014-04-30 173,959,046 = ×2.027 | **주식수 split 확정** |
| UA | C | UA | 2014-04-15 | — | 관측 없음 (그 시점 class 미존재) | 증거 없음 |
| UA | CONV | 비상장 | 2014-04-15 | — | 2014-01-31 20,000,000 → 2014-04-30 39,155,000 = ×1.958 | **주식수 split 확정** |
| AAPL | SOLE | AAPL | 2014-06-09 | ×7 | 2014-04-11 861,381,000 → 2014-07-11 5,987,867,000 = ×6.951 | **주식수 split 확정** |
| V | A | V | 2015-03-19 | ×4 | 2015-01-23 490,962,259 → 2015-04-27 1,957,430,803 = ×3.987 | **주식수 split 확정** |
| V | B | 비상장 | 2015-03-19 | — | 2015-01-23 245,513,385 → 2015-04-27 245,513,385 = ×1.000 | 주식수 변화 없음 |
| V | B1 | 비상장 | 2015-03-19 | — | 관측 없음 (그 시점 class 미존재) | 증거 없음 |
| V | B2 | 비상장 | 2015-03-19 | — | 관측 없음 (그 시점 class 미존재) | 증거 없음 |
| V | C | 비상장 | 2015-03-19 | — | 2015-01-23 21,762,506 → 2015-04-27 21,198,427 = ×0.974 | 주식수 변화 없음 |
| V | CSERIESI | 비상장 | 2015-03-19 | — | 관측 없음 (그 시점 class 미존재) | 증거 없음 |
| V | CSERIESIII | 비상장 | 2015-03-19 | — | 관측 없음 (그 시점 class 미존재) | 증거 없음 |
| V | CSERIESIV | 비상장 | 2015-03-19 | — | 관측 없음 (그 시점 class 미존재) | 증거 없음 |
| GOOGL | A | GOOGL | 2015-04-27 | — | 관측 없음 (그 시점 class 미존재) | 증거 없음 |
| GOOGL | B | 비상장 | 2015-04-27 | — | 관측 없음 (그 시점 class 미존재) | 증거 없음 |
| GOOGL | C | GOOG | 2015-04-27 | ×1.0027 | 관측 없음 (그 시점 class 미존재) | 증거 없음 |
| NKE | A | 비상장 | 2015-12-24 | — | 2015-10-01 177,457,876 → 2016-01-04 353,251,752 = ×1.991 | **주식수 split 확정** |
| NKE | B | NKE | 2015-12-24 | ×2 | 2015-10-01 674,735,884 → 2016-01-04 1,349,896,678 = ×2.001 | **주식수 split 확정** |
| UA | A | UAA | 2016-04-08 | ×2 | 2016-01-31 181,646,468 → 2016-03-31 183,141,109 = ×1.008 | 주식수 변화 없음 |
| UA | C | UA | 2016-04-08 | — | 관측 없음 (그 시점 class 미존재) | 증거 없음 |
| UA | CONV | 비상장 | 2016-04-08 | — | 2016-01-31 34,450,000 → 2016-03-31 34,450,000 = ×1.000 | 주식수 변화 없음 |
| UA | A | UAA | 2016-06-13 | — | 2016-03-31 183,141,109 → 2016-06-30 183,388,910 = ×1.001 | 주식수 변화 없음 |
| UA | C | UA | 2016-06-13 | ×1.0071 | 2016-03-31 217,591,109 → 2016-06-30 219,454,106 = ×1.009 | 주식수 변화 없음 |
| UA | CONV | 비상장 | 2016-06-13 | — | 2016-03-31 34,450,000 → 2016-06-30 34,450,000 = ×1.000 | 주식수 변화 없음 |
| CMCSA | A | CMCSA | 2017-02-21 | ×2 | 2016-12-31 2,366,357,318 → 2017-03-31 4,733,512,494 = ×2.000 | **주식수 split 확정** |
| CMCSA | ASPECIAL | CMCSK | 2017-02-21 | ×2 | 관측 없음 (그 시점 class 미존재) | 증거 없음 |
| CMCSA | B | 비상장 | 2017-02-21 | — | 2016-12-31 9,444,375 → 2017-03-31 9,444,375 = ×1.000 | 주식수 변화 없음 |
| AAPL | SOLE | AAPL | 2020-08-31 | ×4 | 2020-07-17 4,275,634,000 → 2020-10-16 17,001,802,000 = ×3.976 | **주식수 split 확정** |
| TSLA | SOLE | TSLA | 2020-08-31 | ×5 | 2020-07-20 186,361,726 → 2020-10-20 947,900,733 = ×5.086 | **주식수 split 확정** |
| NVDA | SOLE | NVDA | 2021-07-20 | ×4 | 2021-05-21 623,000,000 → 2021-08-13 2,500,000,000 = ×4.013 | **주식수 split 확정** |
| GOOGL | A | GOOGL | 2022-07-18 | ×20 | 2022-04-19 300,763,622 → 2022-07-22 5,996,000,000 = ×19.936 | **주식수 split 확정** |
| GOOGL | B | 비상장 | 2022-07-18 | — | 2022-04-19 44,359,838 → 2022-07-22 885,000,000 = ×19.950 | **주식수 split 확정** |
| GOOGL | C | GOOG | 2022-07-18 | ×20 | 2022-04-19 313,376,417 → 2022-07-22 6,163,000,000 = ×19.666 | **주식수 split 확정** |
| TSLA | SOLE | TSLA | 2022-08-25 | ×3 | 2022-07-19 1,044,490,015 → 2022-10-18 3,157,752,449 = ×3.023 | **주식수 split 확정** |
| WMT | SOLE | WMT | 2024-02-26 | ×3 | 2023-11-28 2,692,233,703 → 2024-03-13 8,058,048,674 = ×2.993 | **주식수 split 확정** |
| NVDA | SOLE | NVDA | 2024-06-10 | ×10 | 2024-05-24 2,460,000,000 → 2024-08-23 24,530,000,000 = ×9.972 | **주식수 split 확정** |
| CMCSA | A | CMCSA | 2026-01-05 | ×1.067 | 2025-10-15 3,634,450,130 → 2026-01-15 3,588,401,619 = ×0.987 | 주식수 변화 없음 |
| CMCSA | ASPECIAL | CMCSK | 2026-01-05 | — | 관측 없음 (그 시점 class 미존재) | 증거 없음 |
| CMCSA | B | 비상장 | 2026-01-05 | — | 2025-10-15 9,444,375 → 2026-01-15 9,444,375 = ×1.000 | 주식수 변화 없음 |

**판정 분포**: 주식수 split 확정 22 · 주식수 변화 없음 11 · 증거 없음 20(대부분 "그 시점에
class가 존재하지 않음") · UNRESOLVED 0(BRK B는 원문으로 해소).

### H5.1 class마다 다르다는 것이 실측으로 확인됐다

| 사례 | 결과 |
|---|---|
| **BRK 2010-01-21 50:1** | **Class B만** split. Class A는 그대로(×1.044, BNSF 인수분). 원문이 "50-for-1 Class B stock split"으로 명시 |
| **CMCSA 2017-02-21 2:1** | Class A는 ×2.000, **Class B는 ×1.000**. Comcast Class B는 정관상 9,444,375주 고정이다 |
| **V 2015-03-19 4:1** | Class A는 ×3.987, **Class B·C는 ×1.000**. Visa의 B/C는 주식수가 아니라 전환비율이 조정된다 |
| **GOOGL 2022-07-18 20:1** | A ×19.94 · **비상장 B ×19.95** · C ×19.67 — **비상장 class도 split됐고, 그 증거는 SEC 표지에서 나온다** |
| **MA 2014-01-22 10:1** | A ×9.856 · **비상장 B ×9.888**. 원문이 "Class A and Class B"로 명시 |
| **NKE 2012·2015 2:1** | 상장 Class B와 **비상장 Class A 모두** split |

**즉 "비상장이라 모른다"는 일반화는 틀렸다.** 비상장 ordinary class도 표지에 수량이 실리므로
(Guide §3.2.3 case 2) split 여부를 SEC 원문만으로 판정할 수 있다. 이 표본에서 비상장 class의
split 판정이 불가능했던 경우는 **그 class가 그 시점에 존재하지 않았을 때뿐**이다.

## H6. price validation — `raw_close`는 그날의 실제 거래 단위를 보존한다

§20 확인이다. `bars_daily`(`eodhd/eodhd-15y-2026-08`)에서 대표 split 전후 세션을 직접 읽었다.

| symbol | ex-date | 직전 세션 `raw_close` | 직후 세션 `raw_close` | raw 비율 | 같은 구간 `adj_close` |
|---|---|---|---|---|---|
| AAPL | 2014-06-09 (×7) | 2014-06-06 **645.57** | 2014-06-09 **93.70** | 6.89 | 20.22 → 20.54 (연속) |
| AAPL | 2020-08-31 (×4) | 2020-08-28 499.23 | 2020-08-31 129.04 | 3.87 | 121.06 → 125.17 |
| NVDA | 2021-07-20 (×4) | 2021-07-19 751.19 | 2021-07-20 186.12 | 4.04 | 18.72 → 18.55 |
| NVDA | 2024-06-10 (×10) | 2024-06-07 1,208.88 | 2024-06-10 121.79 | 9.93 | 120.68 → 121.58 |
| TSLA | 2020-08-31 (×5) | 2020-08-28 2,213.40 | 2020-08-31 498.32 | 4.44 | 147.56 → 166.11 |
| MA | 2014-01-22 (×10) | 2014-01-21 818.48 | 2014-01-22 83.30 | 9.83 | 75.81 → 77.15 |
| GOOGL | 2022-07-18 (×20) | 2022-07-15 2,235.55 | 2022-07-18 109.03 | 20.50 | 110.80 → 108.07 |
| NKE | 2012-12-26 (×2) | 2012-12-24 105.60 | 2012-12-26 51.33 | 2.06 | 22.06 → 21.44 |
| WMT | 2024-02-26 (×3) | 2024-02-23 175.56 | 2024-02-26 59.60 | 2.95 | 57.05 → 58.11 |
| BRK-B | 2010-01-21 (×50) | 2010-01-20 3,476.00 | 2010-01-21 72.72 | 47.80 | 69.52 → 72.72 |
| **CMCSA** | **2026-01-05 (vendor ×1.067)** | 2026-01-02 29.54 | 2026-01-05 28.13 | **1.05** | 26.69 → 27.12 |

**`raw_close`는 split 즉시 단위가 바뀐다.** 따라서 December ME의 shares도 December 세션의
regime으로 표현돼 있어야 한다. `adj_close`는 split을 통과해 연속이므로 진단으로만 쓰고
ME 후보로 쓰지 않는다(계약 그대로). 마지막 행은 H4의 반례로, **가격 계수가 움직였지만 주식수는
움직이지 않은** 경우다.

## H7. 평가 격자와 후보 정의

**표본(20 발행사)은 그대로 두고 formation 연도를 전부 열었다.** Follow-up 1·2가 쓴
`2013 · 2018 · 2026` 세 개만으로는 **December와 formation 사이에 split이 들어오는 경우가
한 번도 없어** 이 질문을 시험할 수 없다. §16이 지목한 anchors(AAPL·GOOGL·NVDA·TSLA·MA·NKE)의
split은 전부 다른 formation에 붙는다. 그래서 **`2010`부터 `2026`까지 17개 formation을 모두**
평가했다. 결과를 보고 고른 것이 아니라 격자 전체를 연 것이다.

```text
formation session   그 해 6월 마지막 정규 세션
December session    t-1년 12월 마지막 정규 세션
freshness           Jan 1 of t-1 <= instant <= December session      (CLOSED)
dimension           D0                                              (CLOSED)
hierarchy           fresh A -> A, 없으면 B                           (CLOSED)
decimals            한 accession 안은 interval consolidation          (CLOSED)
cross-accession     acceptance DESC -> accession DESC                (CLOSED, 이번에 바꾸지 않는다)
```

class-formation 관측은 **525개**다. 그중 관측 창(t-1년 1월 1일 ~ formation)에 그 class의
이벤트가 하나라도 있는 관측은 **52개**다.

후보는 다섯이다.

```text
P0  현재 baseline        split basis guard 없음
P1  filing <= December   source filing의 historical_usable_session이 December 이하인 fact만
P2  same split regime    regime(filing 보고일) == regime(December session) 인 fact만.
                         값을 변환하지 않는다. 같은 regime의 다른 fact를 찾고, 없으면 MISSING.
                         구간 안에 판정 불가(UNRESOLVED/증거 없음) 이벤트가 있으면 fail-close.
P3  ratio normalization  P0 선택을 유지하되 확정된 class-level ratio로 December basis로 변환.
                         ratio를 모르면 fail-close.
P4  first-report lineage 선택된 instant에서 '최초로 usable하게 보고된' fact를 쓴다.
```

## H8. 결과 — basis가 갈리는 11개 관측

525개 중 후보 사이에 **basis 판정이 갈리는 관측은 11개**다. `⚠`는 선택된 값의 basis가
December raw price의 basis와 다르다는 뜻이다.

| issuer | class | formation | Dec session | raw close | 창 안의 event | P0 instant / 보고 filing | P0 | P1 | P2 | P3 | P4 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| NKE | A | 2013 | 2012-12-31 | — | 2012-12-26 split ×2 | 2012-11-30 / 2013-01-09 10-Q 0001193125-13-008172 | 180,000,000 | **90,000,000** ⚠ | 180,000,000 | 180,000,000 (×1) | 180,000,000 |
| NKE | B | 2013 | 2012-12-31 | 51.60 | 2012-12-26 split ×2 | 2012-11-30 / 2013-01-09 10-Q 0001193125-13-008172 | 716,000,000 | **361,000,000** ⚠ | 716,000,000 | 716,000,000 (×1) | 716,000,000 |
| MA | A | 2014 | 2013-12-31 | 835.46 | 2014-01-22 split ×10 | 2013-12-31 / 2014-05-01 10-Q 0001141391-14-000017 | **1,148,838,370** ⚠ | 115,796,250 | 115,796,250 | 114,883,837 (×1/10) | **1,148,838,370** ⚠ |
| MA | B | 2014 | 2013-12-31 | — | 2014-01-22 split ×10 | 2013-12-31 / 2014-05-01 10-Q 0001141391-14-000017 | **45,350,070** ⚠ | 4,577,623 | 4,577,623 | 4,535,007 (×1/10) | **45,350,070** ⚠ |
| UA | A | 2014 | 2013-12-31 | 90.19 | 2014-04-15 split ×2 | 2013-12-31 / 2014-05-06 10-Q 0001336917-14-000020 | **171,628,708** ⚠ | 85,302,799 | 85,814,354 | 85,814,354 (×1/2) | 85,814,354 |
| UA | CONV | 2014 | 2013-12-31 | — | 2014-04-15 split ×2 | 2013-12-31 / 2014-05-06 10-Q 0001336917-14-000020 | **40,000,000** ⚠ | 20,325,000 | 20,000,000 | 20,000,000 (×1/2) | 20,000,000 |
| NKE | A | 2016 | 2015-12-31 | — | 2015-12-24 split ×2 | 2015-11-30 / 2016-01-06 10-Q 0000320187-16-000242 | 353,000,000 | **177,000,000** ⚠ | 353,000,000 | 353,000,000 (×1) | 353,000,000 |
| NKE | B | 2016 | 2015-12-31 | 62.50 | 2015-12-24 split ×2 | 2015-11-30 / 2016-01-06 10-Q 0000320187-16-000242 | 1,354,000,000 | **677,000,000** ⚠ | 1,354,000,000 | 1,354,000,000 (×1) | 1,354,000,000 |
| UA | C | 2016 | 2015-12-31 | — | 2016-04-08 NO_EVIDENCE · 2016-06-13 주식수 변화 없음 | 2015-12-31 / 2016-04-29 10-Q 0001336917-16-000077 | 216,096,468 ? | 0 | 0 | **FAIL_CLOSE** | 0 |
| NVDA | SOLE | 2022 | 2021-12-31 | 294.11 | 2021-07-20 split ×4 | 2021-01-31 / 2022-03-18 10-K 0001045810-22-000036 | 2,479,000,000 | **620,000,000** ⚠ | 2,479,000,000 | 2,479,000,000 (×1) | **620,000,000** ⚠ |
| NVDA | SOLE | 2025 | 2024-12-31 | 134.29 | 2024-06-10 split ×10 | 2024-01-28 / 2025-02-26 10-K 0001045810-25-000023 | 24,643,000,000 | **2,464,000,000** ⚠ | 24,643,000,000 | 24,643,000,000 (×1) | **2,464,000,000** ⚠ |

나머지 514개에서는 다섯 후보가 모두 같은 basis를 고른다(선택 instant는 P1만 자주 다르다, H9.2).

## H9. 통계

### H9.1 후보 비교 (class-formation 관측 525개)

| 지표 | P0 current | P1 filing≤Dec | P2 same-regime | P3 ratio-normalize | P4 first-report |
|---|---|---|---|---|---|
| **correct basis** | 515 | 513 | **520** | 519 | 516 |
| **wrong basis** | **4** | **6** | **0** | **0** | **4** |
| unknown basis | 1 | 0 | 0 | 0 | 0 |
| fail-close (판정 불가 이벤트) | 0 | 0 | 0 | 1 | 0 |
| missing | 5 | 6 | 5 | 5 | 5 |
| ambiguous | 0 | 0 | 0 | 0 | 0 |

`missing` 5건은 전부 dimension·split과 무관한 구조적 결측이다(ABBV 2013 첫 10-K에 XBRL 없음,
Ford 2010·FOX 2019는 그 시점에 usable filing이 없음).

### H9.2 각 후보가 틀리는 방식

- **P0**: split이 **December와 formation 사이**에 있을 때 틀린다. 그 사이에 제출된 filing이
  December 이전 instant를 **post-split basis로 소급 재작성**하고, `acceptance DESC` tie-break가
  그 filing을 고른다. MA 2014(A·B) · UA 2014(A·CONV) 4건.
- **P1**: split이 **관측 instant와 December 사이**에 있을 때 틀린다. December 이전 filing만 쓰면
  그 값은 **pre-split basis**인데 December 가격은 post-split이다. NKE 2013·2016(A·B) ·
  NVDA 2022·2025 6건. **P0보다 많다.**
- **P4**: 두 실패를 모두 물려받는다. December instant를 **처음** 보고한 filing이 이미 split
  이후일 수 있고(MA FY2013 10-K는 제출 2014-02-14로 ex-date 2014-01-22 뒤다), 반대로 처음 보고가
  split 이전이면 P1과 같은 실패가 난다(NVDA). **단순함이 정확도를 주지 않는다.**
- **P2 · P3**: 0건.

### H9.3 P2가 치르는 비용

| 지표 | 값 |
|---|---|
| P0와 **같은 instant**를 고른 관측 | 518 / 520 |
| P0보다 과거 instant를 고른 관측 | **2** (MA A·B 2014, 92일) |
| P0 대비 늘어난 missing | **0** |
| P0 대비 늘어난 ambiguous | **0** |

**P1과 대조된다.** P1은 520개 중 **290개**에서 instant가 달라지고 중앙값 **92일**, 최대 **275일**
더 과거를 고른다. December denominator의 최신성을 크게 잃으면서 정확도는 더 나쁘다.

## H10. basis 오류가 ME에 미치는 크기

상장 class에서 December `raw_close`를 곱한 실제 값이다.

| issuer | class | formation | Dec `raw_close` | P0 ME | P1 ME | P2 ME | P3 ME | 실제 시가총액 대비 |
|---|---|---|---|---|---|---|---|---|
| MA | A | 2014 | 835.46 | **$959.8B** ⚠ | $96.7B | $96.7B | $96.0B | Mastercard의 2013년 말 시가총액은 약 $97B. **P0는 10배** |
| UA | A | 2014 | 90.19 | **$15.5B** ⚠ | $7.69B | $7.74B | $7.74B | **P0는 2배** |
| NKE | B | 2013 | 51.60 | $36.9B | **$18.6B** ⚠ | $36.9B | $36.9B | **P1은 1/2** |
| NKE | B | 2016 | 62.50 | $84.6B | **$42.3B** ⚠ | $84.6B | $84.6B | **P1은 1/2** |
| NVDA | SOLE | 2022 | 294.11 | $729.1B | **$182.4B** ⚠ | $729.1B | $729.1B | NVIDIA의 2021년 말 시가총액은 약 $733B. **P1·P4는 1/4** |
| NVDA | SOLE | 2025 | 134.29 | $3,309B | **$330.9B** ⚠ | $3,309B | $3,309B | NVIDIA의 2024년 말 시가총액은 약 $3.3T. **P1·P4는 1/10** |

**이 오차는 조용하다.** 값이 그럴듯한 자릿수이고 어떤 검증도 울리지 않으며, `B/M`을 통해
value 랭크를 통째로 뒤집는다. MA 2014는 ME가 10배 부풀어 **B/M이 1/10이 되고 value 랭크
최하위로 밀린다.** NVDA 2025는 P1에서 ME가 1/10이 되어 **거꾸로 value 최상위로 올라온다.**

## H11. split로 설명되는 변화와 설명되지 않는 변화 (§17)

같은 `(class, instant)`에 값이 다른 조합이 **197개**다. `decimals` 구간만으로 판정했고
임의 tolerance를 만들지 않았다.

| 분류 | 건수 | 뜻 |
|---|---|---|
| `ROUNDING_COMPATIBLE` | **140** | `decimals` 구간이 겹친다. 충돌이 아니라 정밀도 차이다 (예: CMCSA A `2,122,278,635(INF)` vs `2,122,000,000(-6)`) |
| `EXACT_RATIO` | **6** | 양쪽 `decimals=INF`이고 확정 split 비율과 정확히 일치 (MA A `118,405,075 → 1,184,050,750 = ×10`) |
| `WITHIN_DISCLOSED_PRECISION` | **16** | 확정 split 비율이 양쪽의 `decimals` 구간 안에서 성립 (AAPL `899,213,000(-3) → 6,294,494,000(-3) = ×7`) |
| `SPLIT_RATIO_MISMATCH` | **13** | split 방향은 맞지만 크기가 공시 정밀도 밖 |
| `UNKNOWN_EVENT` | **4** | 구간 안에 판정 불가 이벤트가 있다 |
| `UNEXPLAINED_NO_EVENT` | **18** | 구간에 이벤트가 없는데 값이 다르다 |

**split-basis 규칙을 적용해도 남는 것이 22건(`SPLIT_RATIO_MISMATCH` 13 + `UNEXPLAINED_NO_EVENT`
18 중 rounding 밖의 것들)이다.** §17이 요구한 대로 이 잔여를 그대로 보고한다.

### H11.1 `SPLIT_RATIO_MISMATCH` — 임의 tolerance를 만들지 않는다

| issuer | class | instant | 먼저 보고 | 나중 보고 | 관측 비율 / 확정 비율 | 성격 |
|---|---|---|---|---|---|---|
| GOOGL | A | 2021-12-31 | 300,737,000 (`-3`) | 6,015,000,000 (`-3`) | ×20.0009 / ×20 | 나중 값이 실제로는 백만 단위인데 `decimals=-3`으로 태깅됐다. **filer의 `decimals` 오기** |
| GOOGL | B · C | 2021-12-31 | 44,665,000 · 316,719,000 | 893,000,000 · 6,334,000,000 | ×19.9933 · ×19.9988 | 〃 |
| CMCSA | A | 2014·2015·2016-12-31 | 2,131,137,862 등 | 4,272,000,000 등 | ×2.0037~2.0046 / ×2 | **0.2% (약 470만 주) 실질 차이.** 반올림으로 설명되지 않는다 |
| UA | A · CONV | 2011-06-30 등 | 39,669,162 등 | 78,338,324,000 등 | ×1974.79 · ×2000 | **1,000배 filer 단위 오류**가 split과 겹쳤다 |

**여기에 "2% 이내면 같다" 같은 규칙을 만들지 않는다.** §18대로 상태를 나눠 남기고,
`SPLIT_RATIO_MISMATCH`가 남은 조합은 fail-close 대상으로 취급해야 하는지를 별도 결정으로 넘긴다.

### H11.2 `UNEXPLAINED_NO_EVENT` 18건 전수

| issuer | class | instant | 먼저 보고 | 나중 보고 | 비율 |
|---|---|---|---|---|---|
| AAPL | SOLE | 2009-06-27 | 895,816,758 (`0`, 2009-07-22) | 895,735,210 (`0`, 2009-07-22) | ×0.9999 |
| COST | SOLE | 2016-08-28 | 437,524,000 (`-3`, 2016-10-11) | 437,542,000 (`-3`, 2016-12-16) | ×1.0000 |
| HD | SOLE | 2011-01-30 | 1,623,000,000 (`-6`, 2011-03-24) | 1,537,000,000 (`-6`, 2012-05-24) | **×0.9470** |
| TSLA | SOLE | 2014-12-31 | 125,687,607 (`INF`, 2015-02-26) | 125,688,000 (`INF`, 2016-02-24) | ×1.0000 |
| UA | A | 2012-06-30 | 82,499,396,000 (`-3`, 2012-08-03) | 82,499,396 (`0`, 2013-08-06) | **×0.0010** |
| UA | A | 2014-09-30 | 174,528,423 (`INF`, 2014-11-05) | 176,021,944 (`0`, 2015-11-04) | ×1.0086 |
| UA | A | 2015-12-31 | 181,646,468 (`INF`, 2016-02-19) | 181,629,641 (`0`, 2017-02-23) | ×0.9999 |
| UA | A | 2016-03-31 | 183,141,109 (`0`, 2016-04-29) | 180,115,884 (`0`, 2017-05-09) | ×0.9835 |
| UA | A | 2016-12-31 | 183,814,911 (`INF`, 2017-02-23) | 181,629,641 (`0`, 2017-05-09) | ×0.9881 |
| UA | A | 2017-03-31 | 183,814,911 (`0`, 2017-05-09) | 184,667,304 (`INF`, 2018-05-09) | ×1.0046 |
| UA | A | 2017-12-31 | 185,257,423 (`0`, 2018-02-28) | 185,685,853 (`INF`, 2019-05-09) | ×1.0023 |
| UA | C | 2016-03-31 | 217,591,109 (`0`, 2016-04-29) | 215,815,884 (`0`, 2017-05-09) | ×0.9918 |
| UA | C | 2016-12-31 | 220,174,048 (`0`, 2017-02-23) | 216,079,641 (`0`, 2017-05-09) | ×0.9814 |
| UA | C | 2017-03-31 | 220,174,048 (`0`, 2017-05-09) | 221,148,991 (`INF`, 2018-05-09) | ×1.0044 |
| UA | CONV | 2012-06-30 | 21,900,000,000 (`-3`, 2012-08-03) | 21,900,000 (`0`, 2013-08-06) | **×0.0010** |
| UA | CONV | 2014-09-30 | 38,750,000 (`INF`, 2014-11-05) | 37,675,000 (`0`, 2015-11-04) | ×0.9723 |
| UA | CONV | 2016-03-31 | 34,450,000 (`0`, 2016-04-29) | 35,700,000 (`0`, 2017-05-09) | ×1.0363 |
| V | B | 2008-09-30 | 245,513,385 (`0`, 2009-07-30) | 245,000,000 (`-6`, 2009-11-20) | ×0.9979 |

**세 덩어리다.** (1) UA·COST의 1,000배 단위 오류(Follow-up 2 G13에서 이미 별도 OPEN으로 남긴 것),
(2) UA가 2016~2017년에 instant를 한 칸씩 밀려 태깅한 것으로 보이는 계열, (3) HD 2011-01-30의
5.3% 차이. **어느 것도 split로 설명되지 않으며 split-basis 규칙이 고칠 대상이 아니다.**
generic cross-accession conflict 정책은 이번에 만들지 않는다.

## H12. rounding / fractional (§18)

split 소급 재작성이 비율과 정확히 맞는지는 **`decimals`가 선언한 정밀도로만** 판정했다.

- `EXACT_RATIO` 6건: 양쪽이 `INF`이고 정확히 일치. **fractional 잔여가 없다** —
  MA `118,405,075 × 10 = 1,184,050,750` · UA `85,814,354 × 2 = 171,628,708`.
- `WITHIN_DISCLOSED_PRECISION` 16건: 한쪽이 반올림이라 구간으로만 확인된다.
  NVDA `2,506,000,000(-6) × 10` 구간 `[25,055,000,000, 25,065,000,000]`에
  `25,064,000,000(-6)`이 들어간다.
- `SPLIT_RATIO_MISMATCH` 13건: 구간 밖. **여기에 백분율 tolerance를 만들지 않는다.**

표본의 확정 split은 전부 정수 또는 단순 분수 비율이었고 fractional share / cash-in-lieu가
주식수 자체를 흐린 사례는 없었다. **`DISCLOSED_FRACTIONAL_DIFFERENCE`로 분류해야 할 건은
0건**이고, 대신 `decimals` 오기(GOOGL)와 filer 단위 오류(UA)가 그 자리를 차지했다.

## H13. point-in-time (§19)

**미래 이벤트를 쓰지 않는다는 것을 코드 수준에서 확인했다.**

P2·P3가 참조하는 구간은 항상 `(min(filing 보고일, December), max(filing 보고일, December)]`이고
두 끝점 모두 formation 이하다. 따라서 참조되는 이벤트의 `ex_date`는 언제나 formation 이하다.
**격자 525개 관측에서 formation 이후 `ex_date` 이벤트를 참조한 사례는 0건이다.**

**"이미 effective된 과거 split을 historical basis normalization에 쓰는 것"은 허용 가능하다고
판정한다.** 근거는 두 가지다.

1. formation 시점에 그 split은 **이미 공개된 사실**이다(가격에도, filing 본문에도 있다).
   미래 정보가 아니다.
2. December 가격 자체가 그 regime으로 관측된 것이므로, **basis를 맞추는 일은 새 정보를 쓰는
   것이 아니라 단위를 맞추는 것**이다.

다만 **완전한 split DB를 오늘 조회한다는 사실 자체가 PIT를 깨지 않도록**, 구현에서는
`ex_date <= formation`(더 좁게는 `ex_date <= December` 또는 `<= filing 보고일`) 필터를 코드
불변식으로 두어야 한다. 이 연구의 하네스가 그렇게 돼 있다.

## H14. ground truth 확인 범위

**525개 관측 전부를 사람이 원문과 1:1 대조하지 않았다.** §9·F14·G15와 같은 기준이다.

사람이 원문과 직접 대조한 것:

| 대상 | 원문 | 결과 |
|---|---|---|
| SAB Topic 4.C | `https://www.sec.gov/interps/account/sabcodet4.htm` | H2 인용 |
| Mastercard 10:1 소급·class 범위 | FY2013 10-K `0001141391-14-000003` 본문 | "retroactively restated … Class A and Class B" |
| NVIDIA 4:1 소급 | FY2022 10-K `0001045810-22-000036` 본문 | "All share … balances presented herein have been retroactively adjusted" |
| Berkshire 50:1 Class B 한정 | FY2009 10-K `0001193125-10-043450` 본문 | "50-for-1 Class B stock split" |
| split 전후 raw 가격 | `bars_daily` 11개 종목 세션 직접 조회 | H6 표 |
| vendor split feed 필드·깊이 | EODHD `/api/splits/{SYMBOL}.US`, 조회일 2026-08-28 | H3 |
| UA Class C 배당이 Class A 주식수를 안 바꾼다 | UA 10-Q/10-K raw instance 시계열 | Class A 181,646,468 → 183,141,109 |
| Comcast Versant 분사가 주식수를 안 바꾼다 | CMCSA raw instance + 표지 | Class A ×0.987 · Class B ×1.000 |

나머지는 **SEC raw instance의 fact 시계열(표지 tier 우선)과 `bars_daily`로 기계 검증**했고,
개별 값의 경제적 정확성을 사람이 다시 확인하지는 않았다. `실제 시가총액 대비`(H10) 비교는
공개적으로 알려진 시가총액 규모와의 자릿수 대조이며, 별도 벤더 시가총액 데이터를 쓰지 않았다.

## H15. 이번에 결정하지 않은 것

1. **`PROBE-me-source.md` §8.5는 이 연구로 확정적으로 반증됐다.** 그 절은
   "당시 filing만 그 시점 수량을 들고 있고, 이후 filing은 그 instant를 아예 갖지 않는다.
   formation 시점에 usable했던 filing에서 읽는다는 PIT 규칙을 지키면 raw close와 단위가
   자동으로 맞는다. 소급 조정본을 잘못 집는 경로가 구조적으로 생기지 않는다"고 적었다.
   **MA formation 2014에서 정확히 그 경로가 생겨 ME가 10배가 된다**(H8·H10).
   Follow-up 2 G13이 fact 수준에서 처음 반증했고, 이번에 ME 수준에서 재현했다.
   **§8.5의 결론은 더 이상 근거로 쓸 수 없다.**
2. **cross-accession tie-break(`acceptance DESC`)는 이번에 바꾸지 않았다.** 이 연구는
   그 tie-break를 그대로 두고 eligible 집합만 좁힌다. 다만 H11이 보여주듯 그 규칙은
   반올림값·오류값도 이기게 하므로 `decimals` OPEN decision과 함께 봐야 한다.
3. **`SPLIT_RATIO_MISMATCH`·`UNEXPLAINED_NO_EVENT` 잔여 22건의 처리 정책**은 만들지 않았다.
4. **신설 class의 `effective_from`**: UA Class C는 2016-04-07 배당으로 생겼는데 이후 filing이
   2015-12-31 instant에 216,096,468주를 소급 표시한다. **December 2015 가격에는 Class C가
   존재하지 않았으므로 그 관측은 ME에 들어가면 안 된다.** 이것은 identity의 `effective_from`
   책임이고 split-basis 규칙이 대신 막아준 것은 우연이다(H8의 UA C 2016 행).
5. **비상장 class 가격**(로드맵 §4.4.2의 `CONVERSION_VALUE_PROXY`)은 이 연구 범위 밖이다.
   Visa Class B/C처럼 **주식수는 그대로 두고 전환비율이 조정되는 class**가 있다는 사실은
   그 결정에 직접 영향을 주므로 여기 기록한다.

## User decision — split basis

추천: **P2 — same split-regime, fail-close.**

```text
share fact를 December denominator에 쓸 수 있는 조건 (freshness · D0 · hierarchy 뒤에 붙는다)

    그 fact를 보고한 filing의 보고일과 December measurement session 사이에
    그 economic class의 share-basis를 바꾼 이벤트가 하나도 없어야 한다.

    - filing이 December보다 앞이든 뒤든 같은 규칙이다.
    - 값을 변환하지 않는다. 같은 regime의 다른 eligible fact를 찾고, 없으면 MISSING이다.
    - 구간 안에 판정 불가(UNRESOLVED / 증거 없음) 이벤트가 있으면 fail-close한다.
    - same-day ordering이 확실하지 않으면 fail-close한다.

이벤트 목록은 vendor feed가 아니라 class-level SEC 증거로 승인한 것만 쓴다 (H4).
```

§22가 요구한 기준별로 적는다.

- **December raw price와 shares basis를 보장하는가.** 보장한다. SAB Topic 4.C가
  "share amount의 basis = filing 시점"을 정하므로, `regime(filing) == regime(December)`는
  그 정의를 그대로 옮긴 조건이다. 격자 525개에서 **wrong basis 0건**이고, P0가 틀린 4건과
  P1이 틀린 6건을 모두 잡는다.
- **PIT를 지키는가.** 지킨다. 참조 구간의 두 끝점이 모두 formation 이하라 formation 이후
  이벤트를 볼 수 없다(H13, 위반 0건).
- **class-level split 차이를 보존하는가.** 보존한다. 이벤트가 class에 붙는다.
  BRK 2010(Class B만) · CMCSA 2017(Class A만) · V 2015(Class A만) · GOOGL 2022(A·B·C 모두) ·
  MA 2014(A·B 모두)가 전부 다르게 처리되고, **비상장 class도 SEC 표지 증거로 판정된다.**
- **arbitrary numerical threshold가 없는가.** 규칙 자체에는 없다 — "이벤트가 있는가/없는가"만
  본다. **비율의 크기를 쓰지 않는다.** (이벤트를 *승인*하는 단계에서 SEC 증거와 vendor 비율을
  대조하지만, 그것은 데이터 검증이고 selector의 손잡이가 아니다. 그리고 그 대조는 사람이
  원문으로 재확인할 수 있다.)
- **silent wrong ME보다 fail-close를 우선하는가.** 우선한다. 판정 불가 이벤트가 걸리면 값을
  만들지 않는다. **그 대가가 이 격자에서 0건이다** — P0 대비 missing이 늘지 않는다(H9.3).
- **source/provenance를 감사할 수 있는가.** 있다. 각 이벤트가
  `class · ex_date · vendor 비율 · SEC 증거(표지 instant·값·보고일) · 판정`으로 남고(H5),
  선택된 fact는 accession·form·보고일까지 그대로 남는다.
- **Step 4에 필요한 최소 복잡도인가.** 그렇다. 필요한 것은 **class-level 이벤트 표 하나와
  구간 포함 검사**뿐이다. 비율을 곱하지 않으므로 반올림·fractional 처리를 만들 필요가 없고,
  §18이 경고한 tolerance가 아예 등장하지 않는다.

**P3(ratio normalization)를 추천하지 않는 이유는 정확도가 아니다.** P3도 wrong basis 0건이고
MA 2014에서는 오히려 P2보다 92일 최신인 instant를 지킨다(P2 `2013-09-30`, P3 `2013-12-31`).
그런데 P3는 **곱셈을 하는 순간 세 가지를 추가로 떠안는다.**

1. **비율의 정확도 문제가 selector 안으로 들어온다.** H11.1에서 확정 split인데도 공시 정밀도
   밖으로 어긋나는 조합이 13개다(CMCSA 0.2%, GOOGL `decimals` 오기). 곱한 값이 원문 어디에도
   없는 수가 되고, 그 차이를 어떻게 볼지 정하려면 결국 tolerance를 만들게 된다.
2. **비율 자체가 vendor에서 온다.** H4가 보였듯 vendor feed에는 주식수를 안 바꾸는 이벤트가
   섞여 있고, 비율을 **쓰는** 순간 그 오염이 값에 곱해진다. P2는 비율을 쓰지 않고
   "있었나 없었나"만 보므로 오염의 영향이 한 단계 약하다.
3. **얻는 것이 이 격자에서 관측 2건의 instant 92일**이다. 위험 대비 이득이 작다.

**P3는 버리지 않고 P2의 상위 옵션으로 남길 만하다.** P2가 fail-close하거나 지나치게 과거
instant로 밀리는 것이 실제로 문제가 되면, 그때 확정 비율이 `EXACT_RATIO`인 경우에만 여는
방식으로 다시 열 수 있다. **지금 열 근거는 없다.**

**P1을 추천하지 않는 이유는 분명하다.** §11이 예고한 실패가 실제로 나온다 —
split이 관측 instant와 December 사이에 있으면 December 이전 filing의 값은 pre-split이고
December 가격은 post-split이다. **wrong basis가 6건으로 P0(4건)보다 많고**, 게다가
520개 중 290개에서 instant를 중앙값 92일 더 과거로 밀어 December denominator의 최신성을
크게 잃는다. **basis alignment를 보장하지 못하므로 §11의 조건대로 탈락이다.**

**P4를 추천하지 않는 이유.** P0의 실패(MA 2014)와 P1의 실패(NVDA 2022·2025)를 **둘 다**
물려받는다. December instant를 처음 보고한 filing이 이미 split 이후일 수 있기 때문이다.
단순함이 정확도를 주지 않는다는 것을 이 격자가 보여준다.

**P0를 그대로 두지 않는 이유.** MA 2014에서 ME가 $96B → $960B가 되고 어떤 검증도 울리지 않는다.
드물지만(525개 중 4건) 조용하고 크다.

**함께 기억할 것 넷.**

1. **vendor의 `splits`는 가격 조정 계수이지 주식수 이벤트가 아니다.** UA 2016-04-08은
   가격이 정확히 반토막 났는데 Class A 주식수는 그대로다. **이벤트 표는 반드시 class별
   SEC 주식수 증거로 승인해야 한다.**
2. **split은 발행사가 아니라 class에 붙는다.** 한 class만 split한 사례가 셋(BRK·CMCSA·V)이고,
   비상장 class가 함께 split한 사례도 셋(GOOGL·MA·NKE)이다. **symbol → issuer 자동 전파는 금지다.**
3. **표지(B tier) fact는 소급되지 않는다.** 이 문제는 A tier 고유다. 표본에서 표지 fact가
   뒤 filing에 재보고된 사례는 0건이다.
4. **`PROBE-me-source.md` §8.5는 폐기해야 한다**(H15-1). 그 절의 "PIT 규칙이 split을 자동으로
   막아준다"가 이 연구의 근거가 아니라 반례다.

**이 follow-up도 research 결과일 뿐 아직 CLOSED/FROZEN 계약이 아니다.**
