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
