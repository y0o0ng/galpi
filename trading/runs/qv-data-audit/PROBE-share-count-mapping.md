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

# Follow-up 3 correction — tier basis and event discovery (2026-08-28)

> **Status: RESEARCH EVIDENCE ONLY.** 위 네 절과 같다. 설계 승인·freeze가 아니고 production
> code/schema/test/roadmap의 의미를 바꾸지 않는다. Gate · `coverage_start` · B/M · rank ·
> returns는 이번에도 계산하지 않았고 production DB에 쓰지 않았다.
>
> **바로 위 `User decision — split basis`(P2 추천)는 이 correction 이전 연구다.** 그 추천은
> 두 가지를 검증하지 않은 채 쓰였다 — (1) A tier와 B tier의 basis anchor가 같은가,
> (2) "이벤트가 없었다"를 무엇으로 판정하는가. 이 절이 그 둘을 검증한다. 위 절은 지우거나
> 고치지 않았고, 이 절이 어느 부분을 확인하고 어느 부분을 뒤집는지 아래에 명시한다.

시작 main: `dabbec08d0a54f9c3c812ace339aa40d939f0ba6`
(`research(qv): share-count split basis를 검증한다` — 바로 위 절을 커밋한 지점이고
`origin/main`도 같았다.)

**이번에 다시 열지 않은 것.** December ME price = `raw_close` · freshness 경계
(`Jan 1(t-1) <= instant <= December 마지막 정규 세션`) · dimension scope D0 · A→B hierarchy와
`AMBIGUOUS` fail-close(A ambiguous일 때 B fallback 금지) · economic class ↔ XBRL alias 분리 ·
retirement = identity `effective_to` · QName 계약(parser raw URI+local · alias key standard
family+local · extension `ext:<CIK>`+local) · 한 accession 안의 `decimals` interval
consolidation · issued−treasury와 companyfacts 금지 · 발행사 단위 split 전파 금지.
**split basis guard 자체가 필요한가도 다시 논의하지 않았다** — P0/P1/P4 탈락은 그대로다.

## I1. 이번 질문 둘

> **결함 A.** A tier(`us-gaap:CommonStockSharesOutstanding`)와 B tier
> (`dei:EntityCommonStockSharesOutstanding`)는 basis anchor가 다른가?
> Follow-up 3의 P2는 **모든 fact에서** `regime(filing) == regime(December)`를 요구한다.
>
> **결함 B.** vendor feed에 row가 없다는 사실만으로 "이 class의 share basis를 바꾼 이벤트가
> 없었다"를 판정할 수 있는가?

## I2. B tier의 공식 semantics — 1차 자료

H2는 A tier의 anchor를 SAB Topic 4.C로 확정했다. B tier는 "표지 fact라 소급되지 않는다"고만
적고 근거를 달지 않았다. 이번에 1차 자료를 직접 읽었다.

**(1) Form 10-K 표지 요구사항.** 출처: [Form 10-K](https://www.sec.gov/files/form10-k.pdf),
표지 (APPLICABLE ONLY TO CORPORATE REGISTRANTS)

> "Indicate the number of shares outstanding of each of the registrant's classes of common
> stock, **as of the latest practicable date**."

**(2) Form 10-Q 표지 요구사항.** 출처: [Form 10-Q](https://www.sec.gov/files/form10-q.pdf),
표지 APPLICABLE ONLY TO CORPORATE ISSUERS

> "Indicate the number of shares outstanding of each of the issuer's classes of common stock,
> **as of the latest practicable date**."

**(3) dei element documentation.** 출처: SEC rendered filing의 element documentation
(`https://www.sec.gov/Archives/edgar/data/1045810/000104581026000021/R1.htm`, 조회 2026-08-28)

> "Indicate number of shares or other units outstanding of each of registrant's classes of
> capital or common stock or other ownership interests, **if and as stated on cover of related
> periodic report.** Where multiple classes or units exist define each class/interest by adding
> class of stock items such as Common Class A [Member], Common Class B [Member] …"

**(4) EDGAR XBRL Guide §3.1.15·§3.2.3.** B fact의 context 성격을 규정한다.

> "A context that has period type instant, no taxonomy-defined dimensions, and a date equal to
> or after the end date of the period of the required context is called a **Subsequent Event
> (se) context**." (§3.1.15)
> · §3.2.3의 세 case 모두 period가 "An instant on or after the end of the required context"이고
> "The validations apply to a subsequent event (se) context as defined above in 3.1.15."

**세 자료가 함께 말하는 것.** B는 **재무제표 금액이 아니라 표지 진술**이고, 그 instant는
회계기간 말이 아니라 "latest practicable date"다. SAB Topic 4.C가 소급 효과를 요구하는 대상은
`"the balance sheet"`이므로 문면상 표지는 그 대상이 아니다.

**따라서 작업지시 §4의 P2-B 가설은 합리적이다** — B의 basis anchor는 fact instant다.
**그런데 실측이 이 가설을 반증한다.** I4가 그것이다.

## I3. 실측 (1) — B tier fact는 소급 재보고되지 않는다

H2가 "표본에서 표지 fact가 뒤 filing에 재보고된 사례는 0건"이라고 적은 것을 정량화했다.
같은 `(issuer, economic class, instant)`를 몇 개의 accession이 보고했는지 tier별로 셌다.

| tier | 고유 (class, instant) | 2개 이상 accession이 보고 | 그중 값이 다른 것 |
|---|---|---|---|
| A `us-gaap:CommonStockSharesOutstanding` | 1,829 | **611 (33.4%)** | **138** |
| B `dei:EntityCommonStockSharesOutstanding` | 2,054 | **10 (0.5%)** | **0** |

**A tier의 소급 재작성은 예외가 아니라 구조다.** 같은 instant를 다시 보고한 611건 중 138건에서
값이 바뀐다. B tier는 애초에 같은 instant가 두 filing에 나오는 일이 거의 없고(표지 날짜가
filing마다 다르기 때문이다), 나온 10건도 값이 전부 같다.

**그래서 B의 anchor 문제는 "재보고"가 아니라 "최초 보고"의 문제로 좁혀진다.** 두 anchor는
**split ex-date가 표지 instant와 filing 보고일 사이에 정확히 들어올 때만** 갈린다.

## I4. 실측 (2) — counterexample shape가 실제로 있고, 가설을 반증한다

작업지시 §4가 찾으라고 한 shape를 20 발행사의 usable K/Q family 전체에서 검색했다.

```text
B fact instant  <  split ex-date  <=  filing acceptance  <=  formation
```

**실제로 있다. 2건이다.**

| issuer | class | tier | B fact instant | split ex-date | filing 보고일 | 값 | accession |
|---|---|---|---|---|---|---|---|
| NKE | A | B | **2012-11-30** | 2012-12-26 (×2) | **2013-01-09** | 179,784,496 (`INF`) | `0001193125-13-008172` |
| NKE | B | B | **2012-11-30** | 2012-12-26 (×2) | **2013-01-09** | 715,927,274 (`INF`) | 〃 |

(같은 검색의 A tier hit는 195건, 그중 확정 split이 106건이다. A tier에서는 이 shape가 흔하고,
그것이 바로 SAB 4.C 소급 재작성이다.)

**그 값이 어느 basis인가.** NKE Class A의 표지 시계열이 답한다.

| instant | 값 | 보고일 |
|---|---|---|
| 2012-07-19 | 89,892,248 | 2012-07-24 |
| 2012-08-31 | 89,892,248 | 2012-10-09 |
| **2012-11-30** | **179,784,496** | **2013-01-09** |
| 2013-02-28 | 177,957,876 | 2013-04-04 |

`179,784,496 = 2 × 89,892,248`이다. **instant가 split 이전인데 값은 post-split basis다.**

**원문이 그대로 말한다.** NIKE FY2013 Q2 10-Q `0001193125-13-008172`
(`d433378d10q.htm`, 제출 2013-01-09) 표지:

> "Shares of Common Stock outstanding **as of November 30, 2012** were:
> Class A **179,784,496** Class B **715,927,274**"

같은 문서 주석:

> "On November 15, 2012 the Company announced a two-for-one split of both NIKE Class A and
> Class B Common shares. The stock split was a 100 percent stock dividend payable on
> December 24, 2012 to shareholders of record at the close of business December 10, 2012.
> Common stock began trading at the split-adjusted price on December 26, 2012.
> **All share numbers and per share amounts presented reflect the stock split.**"

**"All share numbers … presented"에 표지가 포함된다.** 표지가 밝힌 날짜(11-30)는 split 이전인데
숫자는 split 이후 단위다.

> **이것이 이번 correction의 핵심이다.** B tier의 basis anchor는 **fact instant가 아니라
> filing이다.** 작업지시 §4가 예상한 방향(universal filing-anchor가 잘못 통과시킨다)과
> **반대다.** 여기서 잘못 판단하는 쪽은 instant anchor다.

## I5. 두 anchor의 전수 대조

확정 share-basis event 23건 각각에 대해, ex-date 전후 ±260일의 B tier 관측을 모두 꺼내
값의 basis(관측 수준의 도약으로 판정)와 두 anchor의 예측을 비교했다.

| | 값 |
|---|---|
| 검사한 (class, event) | 23 |
| 검사한 B tier 관측 | 129 |
| 두 anchor의 예측이 갈리는 관측 | **2** (NKE A·B 2012-11-30) |
| 그중 **instant anchor**가 맞은 것 | **0** |
| 그중 **filing anchor**가 맞은 것 | **2** |
| 둘 다 틀린 것 | 0 |

나머지 127건에서는 표지 instant와 filing 보고일이 split ex-date의 같은 쪽에 있어 두 anchor가
같은 답을 준다. **표지 instant는 보통 보고일 며칠 전이므로 두 anchor가 갈릴 창이 좁다.**
NKE는 표지 instant를 "latest practicable date"가 아니라 **분기 말(required context의 끝)**로
잡아서 그 창이 40일로 벌어진 경우다. Guide §3.2.3이 "An instant **on or after** the end of the
required context"를 허용하므로 이것은 규정 위반이 아니라 허용된 선택이다.

**가설이 참이려면 나와야 했던 반대 shape** — 표지 instant는 split 이후인데 값이 pre-split basis
— 는 **0건**이다. 구조적으로도 나올 수 없다: 표지 instant ≤ 보고일이므로 instant가 split 이후면
보고일도 split 이후다.

**결론.** `P2-B`(instant anchor)를 지지하는 관측은 이 표본에 하나도 없고, 반증하는 관측이 2건이다.

## I6. tier-specific P2/P3 재계산 — 같은 525 격자

정의는 작업지시 §4·§5 그대로다.

```text
P2-A   A tier fact:  regime(source filing 보고일) == regime(December session)
P2-B   B tier fact:  regime(fact instant)          == regime(December session)
P3-A   변환 origin = filing 보고일
P3-B   변환 origin = fact instant
```

격자·freshness·D0·hierarchy·`decimals` consolidation·tie-break는 위 절과 같다.
**`correct/wrong basis` 판정의 진실값은 I4·I5가 실증한 실제 anchor(=보고일)로 매긴다.**

| 지표 | P2 universal | **P2 tier-specific** | P3 universal | **P3 tier-specific** |
|---|---|---|---|---|
| correct basis | 520 | **520** | 519 | **519** |
| wrong basis | 0 | **0** | 0 | **0** |
| unknown basis | 0 | 0 | 0 | 0 |
| fail-close | 0 | 0 | 1 | 1 |
| missing | 5 | 5 | 5 | 5 |
| ambiguous | 0 | 0 | 0 | 0 |

**universal filing-anchor와 결과가 다른 관측은 525개 중 0개다.** 작업지시 §10이 요구한
"결과가 다른 관측 전수 기록"의 답은 **없음**이다.

### I6.1 왜 0인가 — hierarchy가 가린다

| | 값 |
|---|---|
| P2가 A tier fact를 고른 관측 | **458** |
| P2가 B tier fact를 고른 관측 | **62** |
| 아무것도 못 고른 관측(구조적 결측) | 5 |

**A→B hierarchy가 A를 먼저 쓰기 때문에**, tier 차이가 결과에 닿으려면 그 관측에서 A tier가
비어 있어야 한다. eligible pool 안에서 두 anchor의 판정이 갈리는 B fact는 3개뿐이고,

| issuer | class | formation | B instant | 보고일 | filing anchor | instant anchor |
|---|---|---|---|---|---|---|
| NKE | A | 2013 | 2012-11-30 | 2013-01-09 | `SAME` | `CONVERTIBLE`(배제) |
| NKE | B | 2013 | 2012-11-30 | 2013-01-09 | `SAME` | `CONVERTIBLE`(배제) |
| UA | C | 2017 | 2016-03-31 | 2016-04-29 | `SAME` | `UNKNOWN`(fail-close) |

**세 관측 모두 A tier fact가 이미 이겨서** 최종 선택이 바뀌지 않는다.

### I6.2 A tier가 없다고 가정한 반사실 — 여기서 차이가 드러난다

같은 525 격자에서 B tier만 쓰도록 강제했다(A tier 결측 발행사에서 실제로 일어나는 상황이다 —
F7.1·G11이 기록한 Ford·AbbVie가 그 예다).

| 지표 | universal filing anchor | **tier-specific (B=instant)** |
|---|---|---|
| correct basis | **517** | **515** |
| wrong basis | 0 | 0 |
| unknown basis | 0 | 0 |
| missing | 8 | **10** |

| 갈리는 관측 | universal | tier-specific |
|---|---|---|
| NKE A formation 2013 (dec 2012-12-31) | `OK` inst=2012-11-30 **179,784,496** (basis 맞음) | **`MISSING`** |
| NKE B formation 2013 (dec 2012-12-31) | `OK` inst=2012-11-30 **715,927,274** (basis 맞음) | **`MISSING`** |

**tier-specific P2-B는 정확도를 하나도 개선하지 않고 정확한 관측 2개를 `MISSING`으로 버린다.**
이것이 작업지시 §4가 요구한 regression scenario다. 방향은 fail-close 쪽이라 **조용히 틀리지는
않지만**, 근거가 틀린 계약이므로 얻는 것 없이 coverage만 잃는다.

### I6.3 same-day ordering

작업지시 §4의 fail-close 조건을 검사했다. 표본에서

| 검사 | 건수 |
|---|---|
| fact instant == ex-date | **0** |
| filing 보고일 == ex-date | **0** |
| December measurement session == ex-date | **0** |

**한 번도 발생하지 않았다.** same-day fail-close 규칙은 이 표본에서 **한 번도 집행되지 않았고
따라서 검증되지 않았다.** 계약으로 남기더라도 "표본이 지지한다"고 쓸 수 없다.

## I7. 결함 A의 결론

| | 결론 | 근거 |
|---|---|---|
| **A tier basis anchor** | **source filing release/acceptance** — Follow-up 3 그대로 유지 | SAB Topic 4.C(H2) · 같은 instant 재보고 611건 중 138건 값 변경(I3) · MA·NVDA·BRK 원문(H2) |
| **B tier basis anchor** | **source filing release/acceptance** — 작업지시 §4의 instant anchor 가설은 **반증됐다** | NKE 10-Q 표지 원문(I4) · 두 anchor 대조 2:0(I5) · 반대 shape 0건 · 반사실에서 −2 correct(I6.2) |

**따라서 tier-specific P2/P3를 도입할 근거가 없다.** 두 tier의 anchor는 같고, Follow-up 3의
universal filing-anchor 계약이 옳다. **다만 그 계약의 이유가 Follow-up 3이 적은 것과 다르다** —
"B는 소급되지 않으니 문제가 안 된다"가 아니라, **B도 filing 시점 basis로 표현되기 때문**이다.

> **함께 기억할 것.** 표지 숫자를 "그 날짜의 실제 주식수"로 읽으면 안 된다. **표지가 밝힌
> 날짜와 그 숫자의 단위는 다른 시점에 속할 수 있다.** NKE 2012-11-30이 그 사례다.

## I8. 결함 B — event discovery의 완전성

### I8.1 vendor feed의 구조적 맹점 — 정량

EODHD `splits` 전수(20 발행사 · 상장 심볼 26개)는 **63행**이다. 확정된 share-basis event
23건이 그 안에서 어떻게 발견되는지 셌다.

| | 건수 |
|---|---|
| 확정 share-basis event | **23** |
| 그 class **자신의** 심볼에 vendor row가 있음 | **17** |
| **자기 row가 없음** | **6** |

자기 row가 없는 6건은 전부 비상장 class다.

| issuer | class | ex-date | 비율 | 같은 날 vendor row가 있는 형제 |
|---|---|---|---|---|
| GOOGL | B | 2022-07-18 | ×20 | A, C |
| MA | **B** | 2014-01-22 | ×10 | **A 뿐** |
| NKE | **A** | 2012-12-26 | ×2 | **B 뿐** |
| NKE | **A** | 2015-12-24 | ×2 | **B 뿐** |
| UA | CONV | 2012-07-10 | ×2 | A |
| UA | CONV | 2014-04-15 | ×2 | A |

**6건 모두 같은 날 상장 형제의 row가 있어서 후보로 건져졌다. 그것은 계약이 아니라 운이다.**

- 표본 41개 class 중 **상장 심볼이 아예 없는 class가 15개(36.6%)**다
  (`CMCSA:B · F:B · GOOGL:B · MA:ADDLSERIES · MA:B · META:B · NKE:A · UA:CONV · V:B · V:B1 ·
  V:B2 · V:C · V:CSERIESI · V:CSERIESIII · V:CSERIESIV`).
  **이 class들에 대해 vendor discovery의 recall은 정의상 0이다.**
- **비상장 class가 단독으로, 또는 상장 형제와 다른 날/다른 비율로 basis를 바꾸면 후보 자체가
  생기지 않는다.** 그 shape는 이 표본에 **없지만**, 없다는 것이 불가능하다는 뜻은 아니다.
  **이 표본은 그 경우를 반증도 입증도 하지 못한다.**

### I8.2 형제 전파는 답이 아니라 후보다 — 같은 날 class마다 판정이 갈린다

| issuer | ex-date | class별 판정 |
|---|---|---|
| **BRK** | 2010-01-21 | A = 변화 없음 · **B = split ×50** |
| **CMCSA** | 2017-02-21 | **A = split ×2** · B = 변화 없음 · ASPECIAL = 증거 없음 |
| **V** | 2015-03-19 | **A = split ×4** · B·C = 변화 없음 · B1·B2·CSERIES* = 증거 없음 |
| MA | 2014-01-22 | **A = split ×10 · B = split ×10** · ADDLSERIES = 증거 없음 |
| UA | 2012-07-10 · 2014-04-15 | **A = split ×2 · CONV = split ×2** · C = 증거 없음 |
| UA | 2016-04-08 | A = 변화 없음 · CONV = 변화 없음 · C = 증거 없음 |
| CMCSA | 2026-01-05 | A = 변화 없음 · B = 변화 없음 · ASPECIAL = 증거 없음 |

**한 날짜에 class마다 답이 다르다.** vendor row의 존재는 "이 발행사에서 뭔가 있었다"까지만
말하고, "이 class의 basis가 바뀌었다"는 말하지 않는다. `MA` 행과 `BRK` 행이 정반대다 —
**하나는 형제로 전파해야 맞고 하나는 전파하면 틀린다. feed만 보고는 어느 쪽인지 알 수 없다.**

상장 class가 둘 이상인 발행사에서 **같은 날 한쪽 심볼에만 row가 있는 경우가 9건**이다
(BRK 2010 · CMCSA 2026 · GOOGL 2014-03-27·2014-04-03·2015-04-27 · UA 2012·2014·2016-04·2016-06).

### I8.3 reverse split은 이 표본에서 한 번도 검증되지 않았다

vendor feed 63행 중 **비율 < 1인 행은 0건**이다. 확정 event 23건도 전부 정방향이다.
**reverse split 경로는 코드로도 데이터로도 이 연구에서 시험되지 않았다.**

### I8.4 share-count 도약을 discovery로 쓸 수 없다 — 전환·교환이 같은 모양이다

B tier 연속 관측 2,014쌍의 비율 분포다. **이것은 진단 스캔이지 approval 규칙이 아니다.**

| 비율 구간 | 쌍 |
|---|---|
| < 0.5 | 2 |
| 0.5 ~ 0.83 | 10 |
| 0.83 ~ 0.95 | 33 |
| **0.95 ~ 1.05** | **1,924** |
| 1.05 ~ 1.20 | 19 |
| 1.20 ~ 2.0 | 6 |
| ≥ 2.0 | 20 |

`[0.83, 1.20]` 밖의 도약 **38건** 중 **vendor 후보가 구간 안에 전혀 없는 것이 17건**이다.
전수를 열어 보면 **하나도 share-basis event가 아니다.**

| 성격 | 건수 | 사례 | 원문 근거 |
|---|---|---|---|
| **class 간 전환**(1:1, basis 불변) | 4 | MA B 2010-04→07 (19,977,657 → 12,023,551) · 2010-07→10 · 2015 · 2020 | MA FY2010 Q2 10-Q `0001193125-10-174782` 대차대조표: Class A `109,793,439 → 118,813,127` 증가와 Class B `19,977,657 → 12,025,947` 감소가 대응 |
| **class 간 전환**(1:1, basis 불변) | 4 | META A 2012 ×1.63·×1.53 · META B 2012 ×0.73·×0.65 | META FY2012 Q3 10-Q `0001326801-12-000006`: "Shares of our Class B common stock are convertible into an **equivalent number** of shares of our Class A common stock and generally convert … upon transfer." |
| **교환 제안 / 전환비율 조정** | 7 | V B1 2024-04→07 (×0.0197) · V C 6건 | Visa FY2024 Q3 10-Q `0001403161-24-000041`: 자본변동표에 "**Class B-1 common stock exchange offer**" · "Conversions to class A common stock" · "Recovery through **conversion rate adjustment**" |
| **창(窓) 정렬 artifact** | 2 | NKE A·B 2012-08-31 → 2012-11-30 (×2.00) | vendor row는 있다(2012-12-26). instant 구간 `(2012-08-31, 2012-11-30]` 밖일 뿐이다 — **I4가 밝힌 filing anchor 때문에 값이 instant보다 먼저 움직인다** |

**두 방향 모두 막힌다.**

1. **basis event가 아닌데 주식수가 크게 움직인다** — Visa Class B-1은 한 분기에 ×0.0197이 된다.
   숫자만 보면 50:1 reverse split과 구별되지 않는다.
2. **basis event인데 주식수가 안 움직인다** — 형제 class가 split해도 이 class는 그대로다
   (BRK A · CMCSA B · V B·C).

> **§6이 세운 명제가 확인된다.** vendor row의 부재는 class-level share-basis event의 부재를
> 증명하지 못하고, share-count series의 도약도 그것을 증명하지 못한다.
> **둘 다 discovery signal이지 판정이 아니다.**

## I9. approval과 discovery의 분리 — 지금 approval은 임의 tolerance에 매달려 있다

작업지시 §8이 요구한 분리를 Follow-up 3의 하네스에 적용해 봤다. **위 절의 event 표는
`±5%` 백분율 tolerance로 만들어졌다** — 관측 비율이 1에서 5% 이내면 `NO_SHARE_EFFECT`,
vendor 비율에서 5% 이내면 `SHARE_SPLIT_CONFIRMED`, 나머지는 `UNRESOLVED`.

Follow-up 3의 `User decision`은 "**arbitrary numerical threshold가 없는가** … 규칙 자체에는
없다 — '이벤트가 있는가/없는가'만 본다"고 적었고, 괄호에서 "그것은 데이터 검증이고 selector의
손잡이가 아니다"라고 덧붙였다. **selector에 손잡이가 없다는 것은 맞다. 그러나 selector가
읽는 event 표 자체가 그 손잡이로 만들어진다.** 민감도는 이렇다.

| tolerance | SHARE_SPLIT_CONFIRMED | NO_SHARE_EFFECT | UNRESOLVED | 판정이 바뀐 event |
|---|---|---|---|---|
| ±1% | 15 | 8 | **11** | **10 / 34** |
| ±2% | 21 | 9 | 4 | 3 / 34 |
| **±5% (Follow-up 3이 쓴 값)** | **22** | **11** | **1** | — |
| ±10% | 23 | 11 | 0 | 1 / 34 |

**±1%에서 MA 2014 A·B가 `UNRESOLVED`가 된다.** 그 event가 바로 P0의 $96B → $960B 오류를
막아 주던 근거다(H10). tolerance를 한 칸 조이면 **P2는 그 관측에서 fail-close로 바뀐다.**

반대로 **±10%에서는 BRK B 2010이 기계적으로 `SHARE_SPLIT_CONFIRMED`가 되는데, 그것은
맞는 답을 틀린 이유로 얻은 것이다.** 관측 비율 ×54.86과 vendor ×50의 9.7% 차이는 반올림이
아니라 **2010-02-12 BNSF 인수 대가로 발행된 B주**다. Follow-up 3은 이것을 원문
(`0001193125-10-043450`)으로 덮는 수동 `OVERRIDE`로 처리했다 — **즉 표본에서 가장 큰 event
하나는 이미 기계 판정이 실패했고 사람이 원문으로 메꿨다.**

> **결론.** 지금의 event 표는 `DISCOVERY`(vendor row)와 `APPROVAL`(주식수 비율이 대략 맞는가)을
> 섞어 놓았고, approval은 임의 백분율에 의존하며 그 백분율에 대해 **안정적이지 않다.**
> 작업지시 §8이 금지한 바로 그 형태다.

## I10. 새로 찾은 discovery source — SEC XBRL의 split ratio 태그

**§7의 후보 C·D를 실제로 시험했다.** 발행사 자신의 XBRL instance에 split 비율이 태깅돼 있는지
확인했다. 확정 split 23건 각각에 대해 **ex-date 이후 첫 filing**의 raw instance를 읽고
concept local name에 `Split`이 들어간 fact를 전부 꺼냈다(16개 filing, `UA 2012-08-03`은
그 filing에 XBRL instance가 없다).

| issuer | form | 보고일 | ex-date | 확정 비율 | XBRL split 태그 | class 차원 | 값 |
|---|---|---|---|---|---|---|---|
| AAPL | 10-Q | 2014-07-23 | 2014-06-09 | ×7 | `StockholdersEquityNoteStockSplitConversionRatio1` | 없음 | 7 |
| AAPL | 10-K | 2020-10-29 | 2020-08-31 | ×4 | 〃 | 없음 | 4 |
| **BRK** | 10-K | 2010-03-01 | 2010-01-21 | ×50 | `StockSplitConversionRate` | **`class=CommonClassBMember`** | 50 |
| CMCSA | 10-Q | 2017-04-27 | 2017-02-21 | ×2 | `…ConversionRatio1` | **없음** | 2 |
| GOOGL | 10-Q | 2022-07-26 | 2022-07-18 | ×20 | `…ConversionRatio1` | `SubsequentEventTypeAxis` | 20 |
| **MA** | 10-K | 2014-02-14 | 2014-01-22 | ×10 | **숫자 태그 없음 (`StockSplitPolicyPolicyTextBlock` 텍스트뿐)** | — | — |
| **NKE** | 10-Q | 2013-01-09 | 2012-12-26 | ×2 | `StockholdersEquityNoteStockSplitConversionRatio` | **`class=CommonClassAMember` · `class=CommonClassBMember`** | 2 |
| NKE | 10-Q | 2016-01-06 | 2015-12-24 | ×2 | `…ConversionRatio1` | **없음** | 2 |
| NVDA | 10-Q | 2021-08-20 | 2021-07-20 | ×4 | `…ConversionRatio1` | 없음 | 4 |
| NVDA | 10-Q | 2024-08-28 | 2024-06-10 | ×10 | `…ConversionRatio1` (+ `StockSplitIndividualShareholderAdditionalSharesOfCommonStock`=9) | 없음 | 10 |
| TSLA | 10-Q | 2020-10-26 | 2020-08-31 | ×5 | `…ConversionRatio1` | 없음 | 5 |
| **TSLA** | 10-Q | 2022-10-24 | 2022-08-25 | ×3 | `…ConversionRatio1` | 없음 | **3, 5 (두 값)** |
| **UA** | 10-Q | 2014-05-06 | 2014-04-15 | ×2 | `StockIssuedDuringPeriodSharesStockSplits` | 없음 | **1.00 (비율이 아니다)** |
| **V** | 10-Q | 2015-04-30 | 2015-03-19 | ×4 | `…ConversionRatio1` | **`class=CommonClassAMember`** | 4 |
| WMT | 10-K | 2024-03-15 | 2024-02-26 | ×3 | `…ConversionRatio1` | `SubsequentEventTypeAxis` | 3 |

**얻은 것.**

- **15개 filing 중 14개에 숫자 split 태그가 있다.** vendor보다 훨씬 나은 1차 discovery 신호다.
- **class 차원이 붙은 3건이 전부 class 판정이 중요한 사례와 정확히 일치한다** —
  BRK는 `CommonClassBMember`만(실제로 B만 split), V는 `CommonClassAMember`만(실제로 A만),
  NKE 2013은 A·B 둘 다(실제로 둘 다). **여기서는 SEC 태그가 class-level 정답을 그대로 준다.**

**막히는 것.**

- **class 차원이 없는 경우가 다수이고, 그중 CMCSA 2017·GOOGL 2022는 multi-class 발행사다.**
  CMCSA 2017은 실제로 **Class A만** split인데 태그는 dimensionless `2`뿐이다.
  **dimensionless를 "모든 class"로 읽으면 Class B에 ×2를 잘못 적용한다** — §6.4.1의 함정이
  여기서도 그대로 재현된다.
- **MA 2014에는 숫자 태그가 아예 없다.** 텍스트 블록에 "Class A and Class B"가 산문으로만 있다.
  **표본에서 ME 오차가 가장 큰 event(10배)가 기계 판정 불가다.**
- **concept이 최소 3종(`…ConversionRatio1`, `…ConversionRatio`, `StockSplitConversionRate`)이고
  시대·filer마다 다르다.** `StockIssuedDuringPeriodSharesStockSplits`(UA)는 이름은 비슷한데
  비율이 아니고, `StockSplitIndividualShareholderAdditionalSharesOfCommonStock`(NVDA)은 `9`라
  ×10과 헷갈린다. **concept 이름 규칙으로 고르면 오답을 집는다.**
- **TSLA 2022 filing 하나에 `3`과 `5`가 같이 있다**(2022년과 2020년 split). 한 filing에서
  값 하나를 고르는 규칙이 필요하다.
- **effective/ex-date가 이 태그에 없다.** 비율만 있고 날짜는 산문이나 다른 태그에 있다.

### I10.1 전수 스캔 — SEC 태그도 완전하지 않다

위 16개는 "split이 있었다고 이미 아는" filing만 본 것이라 낙관 편향이 있다. **20 발행사의
usable filing 1,321개 전부**를 다시 훑어 concept local name에 `Split`이 들어간 fact를 모았다.

| | 값 |
|---|---|
| 스캔한 filing | **1,321** |
| instance 파싱 성공 | 1,185 |
| XBRL instance 없음 | 136 |
| 세 ratio concept의 숫자 fact | **109** |
| 그중 **class 차원이 붙은 것** | **27 (24.8%)** |
| ratio 태그가 하나라도 있는 발행사 | **9 / 20** |

**결정적인 줄은 이것이다.**

| | 발행사 |
|---|---|
| 확정 share-basis event가 있는 발행사 | AAPL · BRK · CMCSA · GOOGL · **MA** · NKE · NVDA · TSLA · **UA** · V · WMT (11) |
| ratio 태그가 있는 발행사 | AAPL · BRK · CMCSA · GOOGL · NKE · NVDA · TSLA · V · WMT (9) |
| **event는 있는데 ratio 태그가 전 기간에 하나도 없는 발행사** | **MA · UA (2)** |

**MA(×10)와 UA(×2 두 번)는 전체 filing 이력 어디에도 숫자 split 비율 태그가 없다.**
**SEC ratio-tag discovery의 발행사 단위 recall은 9/11이다.** 두 source 어느 쪽도 완전하지 않다.

### I10.2 vendor false-negative는 이 표본에서 발견되지 않았다 — 그러나 결론은 바뀌지 않는다

SEC 태그를 독립 증거로 삼아 "vendor가 놓친 event"를 찾았다. 발행사 자신의 vendor row와
±400일·비율 대조에 실패한 태그가 **20개(고유 조합 8개)**인데, **전수를 열어 보면 하나도
새 event가 아니다.**

| 성격 | 사례 | 왜 대조에 실패했나 |
|---|---|---|
| **다른 회사의 split 비율** | BRK `0.443332` 차원 `…EquityMethodInvesteeNameAxis=TheKraftHeinzCompanyMember` (7 fact) | **등록인이 아니라 지분법 피투자회사(Kraft Heinz)의 비율이다.** 발행사 event로 읽으면 **없는 event를 만든다** |
| **과거 split의 재공시** | BRK `50` `class=CommonClassBMember` (2011-02-28 10-K) · NKE `2` (2014-07-25 10-K) · V `4` `class=CommonClassAMember` (2016-11-15 10-K) · TSLA `5` (2022-10-24 10-Q) | **같은 비율이 몇 년 뒤 filing에도 계속 실린다. 태그에 effective date가 없다** |
| **비율의 다른 표현** | GOOGL `0.05` (2022-02-01 10-K, `SubsequentEventTypeAxis`) | ×20의 역수 형태 |

**두 가지가 여기서 확정된다.**

1. **이 표본에서 vendor feed가 놓친 share-basis event는 발견되지 않았다.** §7이 요구한
   silent false-negative의 **실례는 찾지 못했다.** 정직하게 기록한다.
2. **그러나 그것이 vendor 부재를 `NO_SHARE_BASIS_EVENT_CONFIRMED`로 쓸 근거가 되지는 못한다.**
   반증 도구로 쓴 SEC 태그 자체의 recall이 9/11이고, **vendor가 구조적으로 못 보는 15개
   비상장 class를 SEC 태그도 대부분 못 본다**(전체 109 fact 중 class 차원이 붙은 것이
   27개뿐이다). **두 source가 겹치는 사각이 그대로 남아 있으므로, "못 찾았다"를 "없다"로
   읽을 수 없다.**
3. **naive하게 쓰면 반대 방향 오류가 난다.** 태그 존재만으로 event를 만들면 Kraft Heinz
   비율이 Berkshire의 event가 되고, 2011·2014·2016년 재공시가 **그 해의 새 event**가 된다.
   **effective date 없는 비율 태그는 discovery 신호이지 event가 아니다.**

## I11. absence semantics — §9에 대한 답

**"vendor row가 없음"을 `NO_SHARE_BASIS_EVENT_CONFIRMED`로 쓸 수 없다**(I8.1·I8.2).
그러면 P2가 요구하는 "구간에 이벤트가 하나도 없다"를 무엇으로 채울 것인가.

최소 계약은 **세 상태가 아니라 네 상태**여야 한다. 세 상태로는 "확인했는데 없다"와
"확인한 적이 없다"가 같은 칸에 들어간다.

```text
EVENT_CONFIRMED                    이 class의 share basis를 바꾼 event다 (명시 공시로 승인)
NO_SHARE_BASIS_EVENT               candidate는 있었으나 이 class의 basis는 안 바꿨다 (명시 근거로 승인)
UNRESOLVED                         candidate는 있는데 이 class 적용 여부를 정할 수 없다  -> fail-close
NOT_SEARCHED                       이 (class, 구간)에 대해 discovery를 돌린 적이 없다   -> fail-close
```

**`NOT_SEARCHED`가 핵심이다.** P2가 "구간에 event가 없다"를 안전하게 쓰려면
**그 (class, 구간)이 discovery source에서 실제로 조회됐다는 기록**이 있어야 하고, 그 기록이
없을 때 기본값은 "없음"이 아니라 **fail-close**여야 한다. 지금 하네스는 조회 실패·미조회·
"정말 없음"을 모두 빈 목록으로 되돌려주므로 **셋을 구분할 수 없다.**

**그리고 그 discovery source가 무엇인지가 아직 없다.** I8이 vendor를 배제했고, I10이
SEC XBRL을 유망하지만 불완전한 것으로 만들었다. **비상장 class 15/36.6%에 대해 `NOT_SEARCHED`가
아닌 상태를 만들 결정적 경로가 지금 없다.**

## I12. §7의 후보 A~E에 대한 판정

| 후보 | 판정 | 근거 |
|---|---|---|
| **A. vendor candidates only** | **탈락** | 확정 event 23건 중 6건에 자기 row 없음 · 41 class 중 15개는 recall 0 · 같은 날 class마다 판정이 갈림(BRK·CMCSA·V) (I8.1·I8.2) |
| **B. vendor + SEC explicit disclosure** | **불충분** | vendor가 후보를 만들지 못하는 class에서는 SEC를 언제 열어볼지조차 정해지지 않는다 — discovery의 시작점이 여전히 vendor다 |
| **C. SEC를 primary discovery, vendor는 corroboration** | **방향은 맞지만 지금은 불완전** | 전수 스캔에서 **발행사 단위 recall 9/11 — MA·UA는 전 기간에 숫자 태그가 없다.** class 차원은 109 fact 중 27개뿐이라 multi-class 적용 범위를 못 정한다(CMCSA 2017·GOOGL 2022). concept 3종 · **태그에 effective date가 없어 과거 split 재공시가 새 event로 읽힌다** · 피투자회사 비율이 같은 concept으로 섞여 든다(BRK/Kraft Heinz) (I10·I10.1·I10.2) |
| **D. 다른 deterministic source** | **미확인** | 8-K Item 5.03 · 정관 개정 · SAB 4.C가 요구하는 주석("An appropriately cross-referenced note should disclose the retroactive treatment, explain the change made and **state the date the change became effective**")은 **의무 공시라 존재는 보장되지만 구조화돼 있지 않다.** 이번에 텍스트 파이프라인을 만들지 않았다 |
| **E. 현재 evidence로 complete discovery를 보장할 수 없음** | **이것이 이번 결론이다** | 위 넷. **두 source의 사각이 겹친다** — vendor가 못 보는 비상장 class 15개를 SEC class-차원 태그도 대부분 못 본다 |

## I13. ground truth 확인 범위

**525개 관측 전부를 사람이 원문과 1:1 대조하지 않았다.** §9·F14·G15·H14와 같은 기준이다.

이번에 사람이 원문과 직접 대조한 것:

| 대상 | 원문 | 결과 |
|---|---|---|
| 10-K 표지 주식수 요구사항 | `https://www.sec.gov/files/form10-k.pdf` | I2 인용 ("as of the latest practicable date") |
| 10-Q 표지 주식수 요구사항 | `https://www.sec.gov/files/form10-q.pdf` | I2 인용 |
| `dei:EntityCommonStockSharesOutstanding` 정의 | NVDA `0001045810-26-000021`의 `R1.htm` element documentation, 조회 2026-08-28 | I2 인용 ("if and as stated on cover of related periodic report") |
| Guide §3.1.15 se context · §3.2.3 | `xbrl-guide-2026-05-15.pdf` | I2 인용 |
| **NKE 표지가 split 이전 날짜에 post-split 숫자를 싣는다** | NKE `0001193125-13-008172` `d433378d10q.htm` 본문 | **I4 인용 — 이 correction의 핵심 반례** |
| MA Class B 감소가 전환임 | MA `0001193125-10-174782` 대차대조표 | I8.4 |
| META Class B가 1:1 전환임 | META `0001326801-12-000006` 본문 | I8.4 인용 |
| Visa Class B-1 교환 제안 | V `0001403161-24-000041` 자본변동표 | I8.4 인용 |
| split ratio XBRL 태그 (표적) | 16개 filing raw instance 직접 파싱, 조회 2026-08-28 | I10 표 |
| split ratio XBRL 태그 (전수) | 1,321 filing raw instance 직접 파싱, 조회 2026-08-28 | I10.1·I10.2. **대조 실패 20건은 사람이 전수로 성격을 확인했다** |

나머지는 SEC raw instance의 fact 시계열과 `bars_daily`로 기계 검증했다.
**I8.4의 도약 스캔에 쓴 `[0.83, 1.20]` 구간, I5의 `±260일` 창, I10.2의 `±400일` 대조 창은
전부 진단용 절단값이고 어떤 계약에도 들어가지 않는다.** I9의 tolerance 표도 기존 하네스의
민감도 측정이지 새 문턱 제안이 아니다.

## I14. 이번에 결정하지 않은 것

1. **`NOT_SEARCHED`를 포함한 4-state event ledger의 스키마**는 만들지 않았다. 상태 이름과
   fail-close 방향만 제안한다.
2. **SEC split 태그 파이프라인**(concept 3종의 정규화 · dimensionless의 multi-class 적용 규칙 ·
   effective date 결합 · 한 filing 안 복수 값 처리 · 등록인/피투자회사 구분 · 재공시 제거)은
   설계하지 않았다. **MA·UA처럼 태그가 없는 발행사를 위한 텍스트 경로도 만들지 않았다.**
3. **reverse split**은 표본에 0건이라 어떤 경로도 검증되지 않았다(I8.3).
4. **`SPLIT_RATIO_MISMATCH`·`UNEXPLAINED_NO_EVENT` 잔여 22건**(H11)의 처리 정책은 여전히 열려 있다.
5. **cross-accession tie-break(`acceptance DESC`)**는 이번에도 바꾸지 않았다.
6. **UA Class C `effective_from`**(H15-4)은 identity 책임 그대로 남는다.
7. **비상장 class 가격**(`CONVERSION_VALUE_PROXY`)은 범위 밖이다. 다만 I8.4의 Visa
   "conversion rate adjustment"가 그 결정에 직접 닿는다.

## User decision — correction

추천: **C — event discovery completeness가 부족해 아직 freeze 불가.**

§11의 두 조건을 각각 판정한다.

**조건 1 — A/B tier별 basis anchor가 공식 semantics와 일치하는가: 만족한다. 단 tier-specific이
아니라 universal로 만족한다.**

- A tier의 anchor는 filing이다(SAB Topic 4.C, H2). 이번에 정량으로 재확인했다 — 같은 instant
  재보고 611건 중 138건에서 값이 바뀐다(I3).
- **B tier의 anchor도 filing이다.** 작업지시 §4가 세운 instant-anchor 가설은 표지 원문으로
  반증됐다 — NKE는 "as of November 30, 2012"라고 쓰고 post-split 숫자를 실었고, 같은 문서가
  "All share numbers … presented reflect the stock split"이라고 밝힌다(I4).
  전수 대조에서 두 anchor가 갈리는 2건 모두 filing anchor가 맞았고 instant anchor는 0건이다(I5).
- **따라서 tier-specific P2/P3(A·B)는 추천하지 않는다.** 525 격자에서 universal과 결과가
  같고(차이 0건), A tier를 뺀 반사실에서는 **정확한 관측 2개를 `MISSING`으로 잃기만 한다**(I6.2).

**조건 2 — "no class-level event"를 silent false-negative 없이 판정할 production
source-of-truth 경로가 있는가: 없다.**

- vendor feed는 **41 class 중 15개(36.6%)에 대해 recall이 0**이고, 확정 event 23건 중 6건은
  자기 row 없이 상장 형제 덕에 우연히 건져졌다(I8.1).
- 형제 전파는 답이 아니다. 같은 날 class마다 판정이 갈리는 사례가 7개 발행사-날짜에 있고,
  **MA는 전파해야 맞고 BRK는 전파하면 틀린다**(I8.2).
- share-count 도약으로 대신할 수 없다. 후보 없는 큰 도약 17건이 전부 전환·교환이고, 반대로
  basis event인데 주식수가 안 변하는 class도 넷이다(I8.4).
- SEC XBRL split 태그는 **가장 유망한 경로이고 이번에 처음 확인했지만**, 1,321 filing 전수에서
  **발행사 단위 recall이 9/11이다 — MA와 UA는 숫자 비율 태그가 전 기간에 하나도 없다**(I10.1).
  class 차원은 109 fact 중 27개뿐이고, 태그에 effective date가 없어 **과거 split 재공시와
  피투자회사 비율이 새 event로 잘못 읽힌다**(I10.2).
- **SEC 태그를 독립 증거로 삼아 vendor false-negative를 찾았으나 이 표본에서는 나오지 않았다.**
  실례가 없다는 것을 정직하게 기록한다. **그러나 반증 도구 자체의 recall이 9/11이고 두 source의
  사각이 겹치므로, "못 찾았다"가 "없다"가 되지 않는다**(I10.2).
- **`NOT_SEARCHED`와 "정말 없음"을 구분하는 상태가 지금 없다**(I11). 그것이 없으면 P2의
  "이벤트가 하나도 없다"는 항상 조용히 참이 된다.

**§11이 요구한 대로 둘 중 하나라도 증명 못 하면 C다. 조건 2를 증명하지 못했으므로 C로 끝낸다.**

> **위 절의 P2 추천을 철회하지 않는다.** P2는 여전히 P0·P1·P4보다 낫고 이 격자에서 wrong basis
> 0건이다. **그러나 P2를 freeze할 수 없다** — P2의 정확도는 event 표가 완전하다는 가정 위에
> 서 있고, 이 correction이 그 가정을 지지하는 증거가 없음을 보였다. **P2가 틀리는 방식은
> "wrong basis"가 아니라 "없는 event를 없다고 믿고 통과시키는 것"이고, 그 실패는
> 이 격자의 어떤 지표에도 나타나지 않는다.**

**freeze 전에 필요한 것 셋.**

1. **event ledger에 `NOT_SEARCHED`를 넣고 기본값을 fail-close로 둔다**(I11).
   "조회한 적 없음"이 "없음"으로 읽히는 경로를 코드에서 없앤다.
2. **discovery를 SEC 명시 공시로 옮기고 vendor는 corroboration으로 강등한다**(I10·I12-C).
   최소한 `StockholdersEquityNoteStockSplitConversionRatio1`·`…ConversionRatio`·
   `StockSplitConversionRate` 세 concept을 명시 등록하되, 세 가지를 함께 풀어야 쓸 수 있다 —
   (a) **class 차원이 없으면 multi-class 발행사에서 `UNRESOLVED`로 둔다.** dimensionless를
   "모든 class"로 읽으면 CMCSA 2017에서 Class B에 ×2를 잘못 곱한다.
   (b) **태그에 effective date가 없으므로 비율만으로 event를 만들지 않는다.** 안 그러면
   BRK 2011·NKE 2014·V 2016의 재공시가 그 해의 새 event가 된다.
   (c) **등록인 자신의 비율인지 확인한다.** BRK의 `0.443332`는 Kraft Heinz의 비율이다.
   **그리고 이것을 다 해도 MA·UA는 태그가 없어 다른 경로가 필요하다**(I10.1).
3. **approval에서 백분율 tolerance를 없앤다**(I9). 지금 event 표는 `±5%`로 만들어졌고
   `±1%`면 34건 중 10건이 뒤집힌다. **명시 공시(비율·class 적용 범위·effective date)로 승인하고,
   share-count series는 corroboration으로만 쓰고, 명시 근거가 없으면 `UNRESOLVED`로 남긴다.**

**이 correction도 research 결과일 뿐 아직 CLOSED/FROZEN 계약이 아니다.**

# Follow-up 4 — corporate-action discovery completeness (2026-08-29)

> **Status: RESEARCH EVIDENCE ONLY.** 위 다섯 절과 같다. 설계 승인·freeze가 아니고 production
> code/schema/test/roadmap의 의미를 바꾸지 않는다. Gate · `coverage_start` · B/M · rank ·
> returns는 이번에도 계산하지 않았고 production DB에 쓰지 않았다.

시작 main: `71025861d07521f88c21b8c88360280ec6f3c604`
(`research(qv): share-count tier basis와 event discovery를 검증한다` — 바로 위 절을 커밋한
지점이고 `origin/main`도 같았다.)

**이번에 다시 열지 않은 것.** share basis anchor(A·B 모두 source filing acceptance/release
regime) · P0/P1/P4 탈락 · P2가 유일한 후보라는 것 · event ledger의 두 축 분리
(search coverage `NOT_SEARCHED`/`COMPLETE`/`INCOMPLETE`, event classification
`SHARE_BASIS_CHANGE_CONFIRMED`/`NO_SHARE_BASIS_EFFECT_CONFIRMED`/`UNRESOLVED`) · selector의
fail-close 방향 · vendor row 부재를 `NO EVENT`로 쓰지 않는다 · share-count 도약으로 event를
판정하지 않는다 · issuer-wide class 전파 금지 · percentage tolerance 금지.

## J1. 이번 질문 하나

> **어떤 source set을 어떤 범위까지 성공적으로 조사해야 `(class_id, date interval)`을
> `COMPLETE`라고 선언할 수 있는가?**

## J2. 공시 의무의 지도 — 무엇이 강제이고 무엇이 아닌가

**completeness의 핵심은 "흔히 나온다"가 아니라 "침묵이 정보인가"다.** 자발적 공시나 조건부
공시는 **없다고 해서 event가 없었다는 뜻이 아니므로** absence를 증명하는 데 쓸 수 없다.
그래서 각 form을 그 기준으로만 갈랐다.

### J2.1 강제 — 침묵이 정보다

**(1) Regulation S-X §210.3-04 — 자본계정 변동 분석.**
출처: [17 CFR 210.3-04](https://www.govinfo.gov/content/pkg/CFR-2024-title17-vol3/xml/CFR-2024-title17-vol3-sec210-3-04.xml)

> "An analysis of the changes in each caption of stockholders' equity and noncontrolling interests
> presented in the balance sheets **shall be given in a note or separate statement.** This analysis
> shall be presented in the form of a reconciliation of the beginning balance to the ending balance
> for each period ... **Also, state separately the adjustments to the balance at the beginning of
> the earliest period presented for items which were retroactively applied to periods prior to that
> period.** With respect to any dividends, state the amount per share and in the aggregate **for
> each class of shares.**"

세 가지가 여기서 나온다 — 자본계정 변동은 **반드시** 주석이나 별도 보고서로 나오고,
**소급 적용된 항목은 별도로 표시**해야 하며, 배당은 **class별로** 적어야 한다.

**(2) Regulation S-X §210.10-01(a)(7) — 그것이 10-Q에도 적용된다.**
출처: [17 CFR 210.10-01](https://www.govinfo.gov/content/pkg/CFR-2024-title17-vol3/xml/CFR-2024-title17-vol3-sec210-10-01.xml)

> "Provide the information required by **§ 210.3-04** for the current and comparative year-to-date
> periods, with subtotals for each interim period."

**(3) SAB Topic 4.C — 대차대조표일 이후·공표 이전의 자본구조 변경.**
출처: [SAB Codification Topic 4](https://www.sec.gov/interps/account/sabcodet4.htm) (H2에서 인용)

> "**Such changes in the capital structure must be given retroactive effect in the balance sheet.**
> An appropriately cross-referenced note should disclose the retroactive treatment, explain the
> change made and **state the date the change became effective.**"

**이 셋의 합집합이 정확히 K/Q family다.** 그리고 둘은 서로 다른 시점을 맡는다 — J4.2가 그 분업을
실측으로 보인다.

### J2.2 조건부 — 침묵이 정보가 아니다

**8-K Item 5.03.** 출처: [Form 8-K](https://www.sec.gov/files/form8-k.pdf)

> "If a registrant with a class of equity securities registered under Section 12 of the Exchange Act
> **amends its articles of incorporation or bylaws and a proposal for the amendment was not disclosed
> in a proxy statement or information statement filed by the registrant,** disclose the following
> information: (i) the effective date of the amendment; and (ii) a description of the provision
> adopted or changed by amendment ..."

**조건이 둘이고 둘 다 자주 깨진다.**

1. **정관 개정이 있어야 한다.** 수권주식이 충분한 상태에서 stock dividend 형태로 하는 forward
   split은 정관을 고치지 않으므로 Item 5.03 의무가 아예 없다.
2. **proxy에 이미 나왔으면 면제된다.** 규칙이 명시적으로 proxy 경로를 대체재로 인정한다.

**8-K Item 3.03(Material Modification to Rights of Security Holders).**

> "If the constituent instruments defining the rights of the holders of any class of **registered**
> securities of the registrant have been materially modified ..."

**등록된 class에만 걸린다.** 비상장·미등록 class는 대상이 아니다. split이 권리를 "materially
modify"하는지도 별개 판단이다.

**8-K Item 8.01(Other Events).**

> "The registrant **may, at its option,** disclose under this Item 8.01 any events, with respect to
> which information is not otherwise called for by this Form, that the registrant deems of importance
> to security holders."

**완전한 자발이다.**

**Schedule 14A Item 11·12.** 출처: [17 CFR 240.14a-101](https://www.govinfo.gov/content/pkg/CFR-2024-title17-vol4/xml/CFR-2024-title17-vol4-sec240-14a-101.xml)

> Item 11: "**If action is to be taken** with respect to the authorization or issuance of any
> securities otherwise than for exchange for outstanding securities of the registrant ..."
> Item 12: "**If action is to be taken** with respect to the modification of any class of securities
> of the registrant ..."

**주주 승인이 필요할 때만 존재한다.** 승인이 필요 없는 split에는 proxy가 없다.

### J2.3 강제이지만 EDGAR에 없다 — Rule 10b-17

출처: [17 CFR 240.10b-17](https://www.govinfo.gov/content/pkg/CFR-2024-title17-vol4/xml/CFR-2024-title17-vol4-sec240-10b-17.xml)

> "(a) It shall constitute a 'manipulative or deceptive device or contrivance' ... for any issuer of
> a class of securities **publicly traded** ... to fail to give notice ... of the following actions
> ... (2) **A stock split or reverse split** ..."
> "(b) Notice shall be deemed to have been given ... only if: (1) Given to the **National Association
> of Securities Dealers, Inc.**, no later than 10 days prior to the record date ... and such notice
> includes: ... (iii) Date of record ...; (iv) Date of payment or distribution ...;
> (v)(b) In the same security, **the amount of the security outstanding immediately prior to and
> immediately following the dividend or distribution and the rate** of the dividend or distribution ...
> (3) Given in accordance with procedures of the **national securities exchange** ... which contain
> requirements substantially comparable ..."

**우리가 원하는 정보가 정확히 여기 있다** — 이전·이후 주식수와 비율, 기준일, 지급일.
**그런데 수신처가 FINRA(구 NASD)나 거래소이지 SEC EDGAR가 아니다.** 그리고 **"publicly traded"
class에만 걸리므로 비상장 class에는 통지 의무가 없다.**

> **이것이 vendor feed의 정체다.** EODHD 같은 vendor가 파는 split feed의 상류가 이 통지다.
> **Follow-up 3의 I8이 실측으로 발견한 두 성질** — 비상장 class에 recall 0(41 class 중 15개),
> 가격 조정 계수와 주식수 변동이 섞임 — **이 그대로 이 규칙의 문언에서 예측된다.**
> vendor feed는 "SEC 공시의 요약"이 아니라 **거래소 통지 파이프의 하류**다.

### J2.4 요약 표

| source | 의무인가 | 침묵이 정보인가 | class를 명시하는가 | 비상장 class를 덮는가 |
|---|---|---|---|---|
| **10-K / 10-Q (S-X 3-04 · 10-01(a)(7) · SAB 4.C)** | **의무** | **예** | **예 — "for each class of shares"** | **예** |
| 8-K Item 5.03 | 정관 개정이 있고 proxy에 없을 때만 | 아니오 | 개정 내용에 따라 | 개정 대상이면 |
| 8-K Item 3.03 | 등록 class의 권리가 실질 변경될 때만 | 아니오 | 예 | **아니오(미등록 제외)** |
| 8-K Item 8.01 | **자발** | **아니오** | 문안에 따라 | 문안에 따라 |
| DEF 14A Item 11·12 | 주주 승인이 필요할 때만 | 아니오 | 예 | 대상이면 |
| Rule 10b-17 통지 | 의무 | — | 부분 | **아니오("publicly traded"만)** |
| **EDGAR 어디에도 없음** | — | — | — | — |

**절대적 결론 하나.** `COMPLETE`를 선언하려면 **침묵이 정보인 source**만 쓸 수 있다.
그런 SEC source는 **K/Q family 하나뿐이다.** 8-K·proxy는 후보를 더 일찍 올려줄 수 있어도
**없다는 사실로 아무것도 증명하지 못하므로 completeness의 근거가 될 수 없다.**

## J3. timing — K/Q만 보면 formation 전에 놓치는가

**§6이 요구한 나란히 놓기다.** 20 발행사 전체 form의 submissions 원장(전 form 55,224건)을
새로 받아, 확정 event 16건(고유 `(발행사, ex-date)`)마다 직전·직후 K/Q를 붙였다.

| issuer | ex-date | 직전 K/Q | **ex 이후 첫 K/Q** | 지연(일) | 그 사이 8-K | 그 사이 proxy |
|---|---|---|---|---|---|---|
| AAPL | 2014-06-09 | 2014-04-24 10-Q | **2014-07-23** 10-Q | 44 | 6 | 0 |
| AAPL | 2020-08-31 | 2020-07-30 10-Q | **2020-10-29** 10-K | 59 | 3 | 0 |
| BRK | 2010-01-21 | 2009-11-06 10-Q | **2010-03-01** 10-K | 39 | 7 | 2 |
| CMCSA | 2017-02-21 | 2017-02-03 10-K | **2017-04-27** 10-Q | 65 | 5 | 0 |
| GOOGL | 2022-07-18 | 2022-04-27 10-Q | **2022-07-26** 10-Q | 8 | 4 | 0 |
| MA | 2014-01-22 | 2013-10-31 10-Q | **2014-02-14** 10-K | 23 | 3 | 0 |
| NKE | 2012-12-26 | 2012-10-09 10-Q | **2013-01-09** 10-Q | 14 | 3 | 0 |
| NKE | 2015-12-24 | 2015-10-06 10-Q | **2016-01-06** 10-Q | 13 | 4 | 0 |
| NVDA | 2021-07-20 | 2021-05-26 10-Q | **2021-08-20** 10-Q | 31 | 4 | 0 |
| NVDA | 2024-06-10 | 2024-05-29 10-Q | **2024-08-28** 10-Q | 79 | 3 | 0 |
| TSLA | 2020-08-31 | 2020-07-28 10-Q | **2020-10-26** 10-Q | 56 | 6 | 5 |
| TSLA | 2022-08-25 | 2022-07-25 10-Q | **2022-10-24** 10-Q | 60 | 4 | 1 |
| UA | 2012-07-10 | 2012-05-04 10-Q | **2012-08-03** 10-Q | 24 | 5 | 0 |
| UA | 2014-04-15 | 2014-02-21 10-K | **2014-05-06** 10-Q | 21 | 2 | 2 |
| V | 2015-03-19 | 2015-01-29 10-Q | **2015-04-30** 10-Q | 42 | 5 | 0 |
| WMT | 2024-02-26 | 2023-11-30 10-Q | **2024-03-15** 10-K | 18 | 4 | 0 |

**지연은 8~79일이다.** 그 자체로는 "늦다"고 말할 수 없다 — 기준은 `formation 전인가` 하나다.

### J3.1 "관련 formation" 을 느슨하게 잡으면 실패로 보인다

`ex_date <= formation`인 모든 formation을 관련이라고 두면 **2건이 실패로 나온다.**

| issuer | ex-date | formation | formation session | ex 이후 첫 K/Q |
|---|---|---|---|---|
| AAPL | 2014-06-09 | 2014 | 2014-06-30 | 2014-07-23 (**23일 늦다**) |
| NVDA | 2024-06-10 | 2024 | 2024-06-28 | 2024-08-28 (**61일 늦다**) |

**그런데 이 둘은 P2 interval에 애초에 들어가지 않는다.** formation 2014의 December는
2013-12-31이고, 2014-06-09 event가 어떤 후보 fact의 구간에 들어가려면 **그 fact를 보고한
filing이 `[2014-06-09, 2014-06-30]`에 있어야 한다.** AAPL의 K/Q는 2014-04-24 다음이
2014-07-23이라 그 창에 filing이 없다. NVDA도 같다(2024-05-29 다음이 2024-08-28).

### J3.2 실제로 P2 interval에 걸리는 조합만 세면 실패는 0이다

각 `(class, formation)`의 후보 fact 전부에 대해 `(min(filing 보고일, December),
max(filing 보고일, December)]` 구간을 만들고, 그 안에 ex-date가 들어가는 조합만 골랐다.
**525 격자에서 23개다.**

| issuer | class | formation | December | ex-date | case | 걸린 fact의 최초 filing | ex 이후 첫 K/Q | formation session | 발견? |
|---|---|---|---|---|---|---|---|---|---|
| UA | A | 2013 | 2012-12-31 | 2012-07-10 | 2 | 2012-02-25 | 2012-08-03 | 2013-06-28 | 예 |
| UA | CONV | 2013 | 2012-12-31 | 2012-07-10 | 2 | 2012-02-25 | 2012-08-03 | 2013-06-28 | 예 |
| NKE | A | 2013 | 2012-12-31 | 2012-12-26 | 2 | 2012-04-06 | 2013-01-09 | 2013-06-28 | 예 |
| NKE | B | 2013 | 2012-12-31 | 2012-12-26 | 2 | 2012-04-06 | 2013-01-09 | 2013-06-28 | 예 |
| **MA** | **A** | **2014** | 2013-12-31 | 2014-01-22 | **1** | **2014-02-14** | **2014-02-14** | 2014-06-30 | 예 |
| **MA** | **B** | **2014** | 2013-12-31 | 2014-01-22 | **1** | **2014-02-14** | **2014-02-14** | 2014-06-30 | 예 |
| **UA** | **A** | **2014** | 2013-12-31 | 2014-04-15 | **1** | **2014-05-06** | **2014-05-06** | 2014-06-30 | 예 |
| UA | A | 2015 | 2014-12-31 | 2014-04-15 | 2 | 2014-02-21 | 2014-05-06 | 2015-06-30 | 예 |
| **UA** | **CONV** | **2014** | 2013-12-31 | 2014-04-15 | **1** | **2014-05-06** | **2014-05-06** | 2014-06-30 | 예 |
| UA | CONV | 2015 | 2014-12-31 | 2014-04-15 | 2 | 2014-02-21 | 2014-05-06 | 2015-06-30 | 예 |
| AAPL | SOLE | 2015 | 2014-12-31 | 2014-06-09 | 2 | 2014-01-28 | 2014-07-23 | 2015-06-30 | 예 |
| **V** | **A** | **2015** | 2014-12-31 | 2015-03-19 | **1** | **2015-04-30** | **2015-04-30** | 2015-06-30 | 예 |
| V | A | 2016 | 2015-12-31 | 2015-03-19 | 2 | 2015-01-29 | 2015-04-30 | 2016-06-30 | 예 |
| NKE | A | 2016 | 2015-12-31 | 2015-12-24 | 2 | 2015-01-07 | 2016-01-06 | 2016-06-30 | 예 |
| NKE | B | 2016 | 2015-12-31 | 2015-12-24 | 2 | 2015-01-07 | 2016-01-06 | 2016-06-30 | 예 |
| AAPL | SOLE | 2021 | 2020-12-31 | 2020-08-31 | 2 | 2020-01-28 | 2020-10-29 | 2021-06-30 | 예 |
| TSLA | SOLE | 2021 | 2020-12-31 | 2020-08-31 | 2 | 2020-02-13 | 2020-10-26 | 2021-06-30 | 예 |
| NVDA | SOLE | 2022 | 2021-12-31 | 2021-07-20 | 2 | 2021-02-26 | 2021-08-20 | 2022-06-30 | 예 |
| GOOGL | A·B·C | 2023 | 2022-12-30 | 2022-07-18 | 2 | 2022-02-02 | 2022-07-26 | 2023-06-30 | 예 (3건) |
| TSLA | SOLE | 2023 | 2022-12-30 | 2022-08-25 | 2 | 2022-02-05 | 2022-10-24 | 2023-06-30 | 예 |
| NVDA | SOLE | 2025 | 2024-12-31 | 2024-06-10 | 2 | 2024-02-21 | 2024-08-28 | 2025-06-30 | 예 |

**case 분포: case 1(filing > December) 5건 · case 2(filing ≤ December) 18건. K/Q-only로
formation 전에 발견 불가한 조합은 0건이다.**

### J3.3 case 1은 우연이 아니다 — 구조적으로 자기가 자기를 공시한다

**case 1 다섯 줄에서 `걸린 fact의 최초 filing`과 `ex 이후 첫 K/Q`가 같은 날짜다.**
MA `2014-02-14` · UA A·CONV `2014-05-06` · V `2015-04-30`.

우연이 아니라 정의상 그렇다.

```text
case 1은 filing 보고일 > December 인 경우이고 interval = (December, filing 보고일] 이다.
그 안의 event E는 E <= filing 보고일 이다.
즉 그 fact를 보고한 filing 자신이 E 이후에 나온 K/Q다.
그리고 그 fact의 instant <= December < E 이므로
E는 '그 filing이 보고한 대차대조표일 이후, 그 filing 공표 이전'에 일어났다
    -> SAB Topic 4.C의 사실관계 그대로다 -> 소급 효과 + effective date를 밝힌 주석이 의무다
```

> **case 1에서는 basis가 의심되는 바로 그 filing이 자기 basis가 왜 바뀌었는지를 스스로
> 공시할 의무를 진다.** P0가 조용히 10배 틀렸던 MA 2014가 정확히 이 구조다 —
> **틀린 값을 준 filing이 같은 문서 안에서 정답의 근거를 들고 있었다.**

### J3.4 case 2는 SAB 4.C가 아니라 S-X 3-04가 맡는다

`ex 이후 첫 K/Q`의 대차대조표일과 ex-date를 비교하면 **16건 중 8건에서 ex-date가 대차대조표일보다
앞선다.** 즉 그 8건에서 split은 `subsequent event`가 아니라 **그 filing이 보고하는 기간 안의
사건**이고, **SAB 4.C는 문언상 그 filing을 구속하지 않는다.**

| ex-date와 `ex 이후 첫 K/Q`의 대차대조표일 | 건수 | event |
|---|---|---|
| ex-date > 대차대조표일 — **subsequent event, SAB 4.C 사실관계** | **8** | BRK · GOOGL · MA · NKE(2회) · UA(2회) · WMT |
| ex-date <= 대차대조표일 — **보고 기간 안의 사건** | **8** | AAPL(2회) · CMCSA · NVDA(2회) · TSLA(2회) · V |

**그 8건을 맡는 것이 S-X 3-04다.** 기간 안에 자본계정이 바뀌었으므로 변동 분석에 나와야 하고,
10-Q에는 §210.10-01(a)(7)이 같은 요구를 그대로 옮긴다.

> **두 규칙이 ex-date의 위치를 나눠 맡아 빈틈 없이 덮는다.** 어느 쪽이든 **K/Q family 안이다.**
> Follow-up 3 correction이 "SAB 4.C가 의무 공시라 존재는 보장된다"고만 적고 넘어간 자리에,
> **왜 그것만으로는 절반이고 나머지 절반을 무엇이 맡는지**가 이제 들어간다.

## J4. class applicability — 강제 경로가 class를 명시하는가

**§8이 지목한 anchor 전부를 `ex 이후 첫 K/Q` 원문에서 직접 읽었다.** XBRL 태그가 아니라
사람이 읽는 본문이다.

| anchor | 원문 인용 (`ex 이후 첫 K/Q`) | effective date | ratio | **affected class** |
|---|---|---|---|---|
| **BRK 2010** `0001193125-10-043450` 10-K | "Adjusted for the **50-for-1 Class B stock split** that became effective on **January 21, 2010**." · "**The Class B stock split had no effect on the number of equivalent Class A common shares outstanding.**" | 2010-01-21 | 50 | **B만 — A는 영향 없음이 명시된다** |
| **CMCSA 2017** `0001166691-17-000009` 10-Q | "On January 24, 2017, our Board of Directors approved a **two-for-one stock split** in the form of a 100% stock dividend that was **distributed on February 17, 2017** to shareholders of record as of February 8, 2017. The stock split was in the form of one additional share for every share held and was **payable in shares of Class A common stock on the existing Class A common stock and Class B common stock.**" | 2017-02-17 | 2 | **A로 지급 · A와 B 보유분에 대해** |
| **V 2015** `0001403161-15-000007` 10-Q | "In January 2015, Visa's board of directors declared a **four-for-one split of its class A common stock** ... received a dividend of three additional shares on **March 18, 2015** ... Trading began on a split-adjusted basis on March 19, 2015. **Holders of class B and C common stock did not receive a stock dividend. Instead, the conversion rate for class B common stock increased to 1.6483** shares of class A ... **and the conversion rate for class C common stock increased to 4.0** ..." | 2015-03-18 | 4 | **A만 · B·C는 전환비율만 조정** |
| **MA 2014** `0001141391-14-000003` 10-K | "The number of shares and per share amounts below have been **retroactively restated** to reflect the **ten-for-one stock split of the Company's Class A and Class B common shares**, which was effected in the form of a common stock dividend **distributed on January 21, 2014**." | 2014-01-21 | 10 | **A와 B 둘 다** |
| **NKE 2012** `0001193125-13-008172` 10-Q | "On November 15, 2012 the Company announced a **two-for-one split of both NIKE Class A and Class B Common shares.** The stock split was a 100 percent stock dividend **payable on December 24, 2012** ... Common stock began trading at the split-adjusted price on **December 26, 2012**." | 2012-12-24 / 26 | 2 | **A와 B 둘 다** |
| **NKE 2015** `0000320187-16-000242` 10-Q | "On November 19, 2015, the Company announced a **two-for-one split of both NIKE Class A and Class B Common Stock** ... **payable on December 23, 2015** ... began trading at the split-adjusted price on **December 24, 2015**." | 2015-12-23 / 24 | 2 | **A와 B 둘 다** |
| **GOOGL 2022** `0001652044-22-000071` 10-Q | "the Board of Directors had approved and declared a **20-for-one stock split** in the form of a one-time special stock dividend **on each share of the company's Class A, Class B, and Class C stock.** The Stock Split had a record date of July 1, 2022 and an **effective date of July 15, 2022.**" | 2022-07-15 | 20 | **A·B·C 전부** |
| **UA 2012** `0001193125-12-335302` 10-Q | "On June 11, 2012 the Board of Directors declared a **two-for-one stock split of the Company's Class A and Class B common stock**, which was effected in the form of a 100% common stock dividend **distributed on July 9, 2012.**" | 2012-07-09 | 2 | **A와 B 둘 다** |
| **UA 2014** `0001336917-14-000020` 10-Q | "On March 17, 2014 the Board of Directors declared a **two-for-one stock split of the Company's Class A and Class B common stock** ... **distributed on April 14, 2014.**" | 2014-04-14 | 2 | **A와 B 둘 다** |

**16건 전부에서 `ex 이후 첫 K/Q`가 event를 공시한다. recall 16/16이다.**
그리고 **명시 범위가 Follow-up 3이 vendor·XBRL로는 만들 수 없었던 판정을 그대로 준다.**

- **BRK**: vendor는 `BRK-B` row만 주고 Class A row가 없다. 그것만으로는 "A는 split 안 함"과
  "A는 vendor가 안 실었을 뿐"을 구분할 수 없었다. **원문은 A가 영향 없음을 명시한다.**
- **V**: B·C가 split되지 않고 **전환비율이 조정됐다**는 것이 원문에 있다. 이것은 로드맵
  §4.4.2의 `CONVERSION_VALUE_PROXY`가 필요로 하는 바로 그 숫자다(1.6483 · 4.0).
- **MA**: **XBRL 숫자 비율 태그가 전 기간에 하나도 없는 발행사**(Follow-up 3 I10.1)인데
  **본문에는 비율·날짜·class가 다 있다.** 비상장 Class B도 문장 안에 들어 있다.
- **NKE·UA**: 비상장 class(NKE A · UA "Class B")가 상장 class와 **같은 문장**에서 이름으로 불린다.

> **비상장 class 문제가 여기서 풀린다.** vendor는 상장 심볼이 있어야 row를 만들고(J2.3의
> Rule 10b-17 "publicly traded"), XBRL class 차원은 109 fact 중 27개뿐이었다. **본문은 class를
> 이름으로 부르므로 상장 여부와 무관하다.**

### J4.1 CMCSA — Follow-up 3의 미해결 잔여 하나가 원문으로 풀린다

H11.1은 CMCSA Class A `2014·2015·2016-12-31`에서 관측 비율이 `×2.0037~2.0046`이라
`×2`와 어긋나고 "**0.2% 실질 차이. 반올림으로 설명되지 않는다**"며 `SPLIT_RATIO_MISMATCH`로
남겼다. 위 원문이 답이다 — 배당이 **Class A 주식으로, Class A와 Class B 보유분 모두에** 지급됐다.

```text
Class A 소급 재작성 값 4,742,159,011
      = 2 x 2,366,357,318 (Class A)  +  9,444,375 (Class B)
      = 4,732,714,636              +  9,444,375
차이 9,444,375주는 정확히 Class B 발행주식수다.
```

**세 가지가 여기서 나온다.**

1. **잔여가 데이터 오류가 아니라 실제 기업행동이었다.** 임의 tolerance를 만들지 않고 원문을
   찾은 것이 옳았다.
2. **"영향받는 class"는 하나가 아니라 둘로 갈린다** — 주식이 **늘어나는 class**(A)와
   그 배당을 **받는 class**(A·B). 비율 하나로 표현할 수 없는 구조다.
3. **P3(ratio normalization)에 대한 새 반대 근거다.** P3는 여기서 `×2`를 곱하는데
   실제 재작성 배수는 `×2.00399`다. **P2는 곱하지 않으므로 영향이 없다.**

### J4.2 명시되지 않으면 어떻게 하는가 — 실제 사례가 있다

keyword가 울렸지만 event가 아닌 것 중 **가장 중요한 것이 META 2016~2017이다.**
`0001326801-17-000007`(2017-02-03 10-K) 등 7개 filing에 이런 문장이 있다.

> "our board of directors intends to issue two shares of the Class C capital stock as a one-time
> **stock dividend** for each share of Class A and Class B common stock outstanding **as of a record
> date to be determined by our board of directors** ... For accounting purposes, we expect this
> transaction will be **treated as a stock split** in the form of a dividend ... **there can be no
> assurance as to the timing of such dates.**"

**비율(three-for-one 상당)도 있고 class(A·B)도 있는데 effective date가 없다.**
그리고 이 Reclassification은 **2017년 9월에 철회돼 실제로 일어나지 않았다.**

> **effective date가 명시 승인 요건에 반드시 들어가야 하는 이유가 이것이다.**
> 비율과 class만으로 승인하면 **일어나지 않은 event가 ledger에 들어간다.**
> META는 `UNRESOLVED`(effective date 없음)로 남아야 하고, 철회가 확인되면
> `NO_SHARE_BASIS_EFFECT_CONFIRMED`가 된다.

### J4.3 이름을 `class_id`로 옮기는 문제는 identity 층에 남는다

원문은 class를 **사람이 읽는 이름**으로 부른다. registry의 `class_id`와 1:1이 아니다.

| 원문의 이름 | 시점 | registry label | 문제 |
|---|---|---|---|
| UA "**Class B** common stock" | 2012·2014 | `CONV` | 이름이 다르다 |
| UA "Class C" | 2016~ | `C` | **2012년의 "Class B"와 2016년의 "Class C"는 다른 class다** |
| CMCSA "Class A Special" | ~2015 | `ASPECIAL` | 이름이 다르다 |
| V "class B" → "class B-1 / B-2" | 2024 교환 후 | `B` → `B1`·`B2` | 시점에 따라 갈라진다 |

**이것은 이미 CLOSED인 economic class ↔ XBRL alias 분리와 같은 문제이고, 같은 해법이 필요하다** —
**PIT 구간을 가진 명시 등록.** XBRL member alias 옆에 **prose class-name alias**가 붙어야 하며,
`effective_from/to`를 그대로 따른다. **이름 유사도로 매칭하지 않는다.**
매칭 실패는 `UNRESOLVED`다.

## J5. `COMPLETE`의 정의 — §9에 대한 답

**임의 window를 만들지 않는다.** 아래 정의의 모든 경계는 **P2 interval 자체**와
**J2.1의 강제 공시 규칙**에서 나온다.

```text
COMPLETE(class_id, (lo, hi], formation)  <=>  CLOSURE 와 SEARCH 를 둘 다 만족

  lo = min(그 관측의 후보 fact들의 filing 보고일, December measurement session)
  hi = max(그 관측의 후보 fact들의 filing 보고일, December measurement session)
       (두 끝점 모두 formation 이하다 — PIT는 이미 보장돼 있다)

  CLOSURE
      G := 그 issuer의 K/Q family filing 중
           acceptance_eastern_date >= hi 인 최초 filing
      G가 존재하고  G.acceptance_eastern_date <= formation

  SEARCH
      acceptance_eastern_date 가 (lo, G.acceptance] 안에 있는
      그 issuer의 K/Q family filing을 하나도 빠짐없이
      성공적으로 가져와 전문 검색했다
      (하나라도 fetch/parse 실패면 INCOMPLETE)
```

**왜 이 창이고 다른 창이 아닌가.**

```text
E를 (lo, hi] 안의 share-basis event라 하자.

1. acceptance < E 인 filing은 E를 공시할 수 없다 (아직 일어나지 않았다).
   -> 하한이 lo 여도 충분하다. E > lo 이므로 E를 공시할 수 있는 filing은 전부 acceptance > lo 다.

2. E를 공시할 의무를 지는 filing은 'acceptance >= E 인 최초 K/Q'다.
   - E가 그 filing의 대차대조표일 이후면      -> SAB Topic 4.C (소급 + effective date 주석)
   - E가 그 filing의 보고 기간 안이면          -> S-X 3-04 (자본계정 변동 분석, class별)
                                                 10-Q는 S-X 10-01(a)(7)이 그대로 요구한다
   두 경우가 ex-date의 위치를 남김없이 나눈다 (J3.4가 8:8로 실측한다).

3. E <= hi <= G.acceptance 이므로 그 filing은 반드시 (lo, G.acceptance] 안에 있다.
   -> 상한이 G 여도 충분하다.

4. G가 formation을 넘으면, E = hi 인 최악의 경우를 formation 시점에 확인할 방법이 없다.
   -> INCOMPLETE -> fail-close.  이것이 CLOSURE 조건이다.
```

**§9의 후보 A·B·C에 대한 판정.**

| 후보 | 판정 | 근거 |
|---|---|---|
| **A. interval 안의 모든 relevant filing + 직전 filing + 직후 confirming filing** | **채택(정제형)** | 위 정의가 A의 정제형이다. "직전 filing"은 불필요하다 — 그 filing은 E보다 앞서므로 E를 공시할 수 없다(위 1). "직후 confirming filing"이 `G`이고, **왜 하나면 충분한지가 SAB 4.C·S-X 3-04로 설명된다** |
| **B. event-specific forms only** | **탈락** | Item 5.03은 정관 개정 + proxy 미공시일 때만이고, Item 8.01은 자발이다(J2.2). **표본 8개 anchor 중 BRK·MA·NKE는 5.03 없이 자발 Item 8.01로만 8-K를 냈다.** 침묵이 정보가 아니므로 absence를 못 만든다 |
| **C. 다른 deterministic window** | **불필요** | 달력 기반 `±N일` 같은 창은 N이 임의다. 위 정의는 N을 쓰지 않는다 |

### J5.1 525 격자에서 이 정의를 돌린 결과

| 판정 | 관측 |
|---|---|
| **COMPLETE** | **520** |
| **INCOMPLETE** | **0** |
| N/A (후보 fact 자체가 없음 — 구조적 결측) | 5 |

`N/A` 5건은 Follow-up 3의 `missing` 5건과 같다(ABBV 2013 첫 10-K에 XBRL 없음 ·
Ford 2010 · FOX 2019에 usable filing 없음). **share-basis와 무관하다.**

**창의 크기.**

| | 값 |
|---|---|
| COMPLETE 관측 하나가 덮는 K/Q 수 | 최소 **1** · 중앙값 **5** · 최대 **7** |
| 격자 전체에서 조회해야 하는 **고유** K/Q accession | **1,225** |
| 20 발행사의 전체 K/Q accession | 1,959 |

**창이 관측마다 크게 겹치므로 실제 조회 대상은 그 발행사 K/Q의 63%다.**
그리고 **그 1,225건은 QV가 이미 `qv_sec_filings`에 적재하는 바로 그 filing들이다**(J7).

### J5.2 왜 4-state가 아니라 2축인가

Follow-up 3 correction의 I11은 `EVENT_CONFIRMED / NO_SHARE_BASIS_EVENT / UNRESOLVED /
NOT_SEARCHED` 4-state를 제안했다. **이번 작업지시가 정한 2축 분리가 더 낫고, 이 연구가 그 이유를
보인다.**

```text
search coverage      NOT_SEARCHED / COMPLETE / INCOMPLETE     <- (class, interval)에 붙는다
event classification CONFIRMED / NO_EFFECT / UNRESOLVED       <- (class, event)에 붙는다
```

**둘의 단위가 다르기 때문이다.** coverage는 구간의 성질이고 classification은 개별 event의
성질이다. 한 구간이 `COMPLETE`이면서 그 안에 `UNRESOLVED` event를 담을 수 있다 —
META 2016(J4.2)이 정확히 그 모양이다. **4-state로 합치면 그 상태를 표현할 수 없다.**

## J6. unstructured text — 후보를 빠짐없이 올릴 수 있는가

**§10대로 surface recall만 평가한다. keyword hit를 approval로 쓰지 않는다.**

### J6.1 표현 변형별 recall (확정 event 16건의 `ex 이후 첫 K/Q` 본문)

| 표현 | recall |
|---|---|
| **`stock split`** | **16 / 16** |
| **`N-for-one` 계열** (`two-for-one`, `20-for-one`, …) | **16 / 16** |
| `reclassification` | 16 / 16 |
| `stock dividend` | 15 / 16 (WMT 2024는 0) |
| `retroactively adjusted/restated` | 11 / 16 |
| `split of its/the/our …` | 10 / 16 |
| `recapitalization` | 8 / 16 |
| `reverse split` | 7 / 16 |
| `share dividend` | 6 / 16 |
| `100% stock dividend` | 5 / 16 |
| `reverse stock split` | 4 / 16 |
| `split-adjusted` | 3 / 16 |
| `conversion rate adjustment` | 2 / 16 |

**`stock split` 하나로 16/16이다.** `stock dividend`만 쓰면 WMT를 놓친다.
`reclassification`도 16/16이지만 **문서당 22~299회** 울린다 — "reclassified to conform to
current presentation" 같은 정형 문구라서다. **recall이 높다고 쓸 수 있는 것이 아니다.**

### J6.2 precision — event가 없는 K/Q에서는 얼마나 울리는가

표본 기간에 확정 share-basis event가 **없는** 발행사 6곳(XOM·HD·COST·INTC·META·ABBV)의
2010년 이후 K/Q **386건**을 같은 방식으로 훑었다.

| issuer | 검사 K/Q | `stock split`이 울린 건 | 비율 |
|---|---|---|---|
| COST | 69 | 0 | 0% |
| INTC | 67 | 0 | 0% |
| XOM | 68 | 0 | 0% |
| HD | 67 | 2 | 3% |
| ABBV | 56 | 2 | 4% |
| META | 59 | 7 | 12% |
| **합계** | **386** | **11** | **2.8%** |

**97.2%의 filing은 `stock split`이 한 번도 안 나온다.** 즉 강제 경로 위에서 keyword surface는
희소하고, 승인 단계가 실제로 읽어야 할 후보는 적다.

**울린 11건의 성격을 전수 확인했다.**

| 성격 | 건수 | 예 |
|---|---|---|
| **주식보상 plan의 반희석 조항**(가정법, 항상 exhibit 안) | 4 | HD `2012-05-24`·`2013-05-29`: "In the event of any stock dividend, stock split, … or other change in the capital structure" · ABBV `2026-05-08` · META `2020-04-30` |
| **XBRL 분류 안내문**(taxonomy 설명 텍스트) | 1 | ABBV `2024-02-20`: "revisions for stock splits, reverse stock splits, stock dividends, or other changes in capital structure" |
| **제안됐으나 실행되지 않은 기업행동** | 6 | META `2016-04-28` ~ `2017-07-27` Class C Reclassification (J4.2) |

**앞의 둘은 문법으로 걸러진다** — 가정법(`in the event of`)이고 **effective date가 없다.**
**세 번째는 걸러지면 안 되고 `UNRESOLVED`로 남아야 한다.** 실제로 일어나지 않았으므로
최종 판정은 `NO_SHARE_BASIS_EFFECT_CONFIRMED`인데, **그 판정을 내리려면 철회 공시를 읽어야 한다.**

### J6.3 그래서 approval에 필요한 것

```text
승인에 필요한 네 가지 (하나라도 없으면 UNRESOLVED)
    explicit effective date        <- META를 걸러내는 것이 이것이다
    explicit affected class        <- registry class_id로 매핑까지 끝나야 한다 (J4.3)
    explicit ratio / action        <- 비율 또는 "one additional share for every share held"
    원문 provenance                <- accession · form · acceptance · 문서명 · 인용문

keyword hit 자체는 approval이 아니다. 후보를 올릴 뿐이다.
share-count series는 corroboration으로만 쓴다.
percentage tolerance를 만들지 않는다.
```

**이 연구는 그 추출기를 만들지 않았다.** 16건을 사람이 읽어 네 가지가 전부 원문에 있음을
확인했을 뿐이다. **추출기가 없는 동안 모든 후보는 `UNRESOLVED`이고 selector는 fail-close한다** —
이것이 안전한 기본값이고, 그 대가는 J8이 적는다.

## J6b. source set별 recall — §7·§12

**§7이 요구한 표다.** `첫 SEC 공시`는 20 발행사 전 form에서 ex-date 기준 ±220일 창의
후보 filing(총 483건)을 전문 검색해 찾았고, **아래 세 건은 자동 판정이 옛 split의 재공시를
집어서 사람이 원문으로 고쳤다**(J6b.1).

| issuer | ex-date | **첫 SEC 공시** | form | items | acceptance | K/Q보다 앞선 일수 | S1 | S2 | S3 |
|---|---|---|---|---|---|---|---|---|---|
| BRK | 2010-01-21 | `0001193125-09-222271` | 8-K | 1.01,**8.01**,9.01 | 2009-11-03 | 118 | 예 | 예 | 예 |
| UA | 2012-07-10 | `0001193125-12-266373` | 8-K | **5.03**,8.01,9.01 | 2012-06-11 | 53 | 예 | 예 | 예 |
| NKE | 2012-12-26 | `0000320187-12-000158` | 8-K | **8.01**,9.01 | 2012-11-15 | 55 | 예 | 예 | 예 |
| MA | 2014-01-22 | `0001193125-13-468488` | 8-K | **8.01**,9.01 | 2013-12-10 | 66 | 예 | 예 | 예 |
| UA | 2014-04-15 | `0001336917-14-000011` | 8-K | **5.03**,8.01 | 2014-03-17 | 50 | 예 | 예 | 예 |
| AAPL | 2014-06-09 | `0001193125-14-154883` | 8-K | **7.01**,9.01 | 2014-04-23 | 91 | 예 | 예 | 예 |
| V | 2015-03-19 | `0001193125-15-025534` | 8-K | 2.02,**8.01**,9.01 | 2015-01-29 | 91 | 예 | 예 | 예 |
| NKE | 2015-12-24 | `0000320187-15-000226` | 8-K | **8.01**,9.01 | 2015-11-19 | 48 | 예 | 예 | 예 |
| CMCSA | 2017-02-21 | `0001104659-17-004122` | 8-K | **2.02**,9.01 | 2017-01-26 | 91 | 예 | 예 | 예 |
| AAPL | 2020-08-31 | `0000320193-20-000060` | 8-K | **2.02**,9.01 | 2020-07-30 | 91 | 예 | 예 | 예 |
| TSLA | 2020-08-31 | `0001564590-20-039353` | 8-K | **8.01**,9.01 | 2020-08-11 | 76 | 예 | 예 | 예 |
| NVDA | 2021-07-20 | `0001045810-21-000056` | 8-K | **8.01**,9.01 | 2021-05-21 | 91 | 예 | 예 | 예 |
| GOOGL | 2022-07-18 | `0001652044-22-000015` | 8-K | 2.02,**8.01**,9.01 | 2022-02-01 | 175 | 예 | 예 | 예 |
| TSLA | 2022-08-25 | `0001564590-22-011875` | 8-K | **8.01** | 2022-03-28 | 210 | 예 | 예 | 예 |
| WMT | 2024-02-26 | `0000104169-24-000004` | 8-K | **7.01**,9.01 | 2024-01-30 | 45 | 예 | 예 | 예 |
| NVDA | 2024-06-10 | `0001045810-24-000113` | 8-K | 2.02,**8.01**,9.01 | 2024-05-22 | 98 | 예 | 예 | 예 |

**16건 전부 첫 SEC 공시가 8-K다.** 그런데 **items를 보라.**

| 첫 공시 8-K가 쓴 item | 건수 |
|---|---|
| **Item 8.01 (자발)** | **9** |
| **Item 2.02 (실적 발표에 얹음)** | 2 |
| **Item 7.01 (Reg FD, 자발)** | 2 |
| **Item 5.03 (정관 개정)** | **2** (UA 2012 · UA 2014) |
| Item 1.01 (중요 계약 — BNSF 합병) | 1 |

> **Item 5.03을 구조적 trigger로 쓰면 16건 중 14건을 놓친다.** J2.2가 form instruction 문언에서
> 예측한 것이 그대로 나온다 — 수권주식이 충분한 stock-dividend 방식 split은 정관을 안 고치므로
> 5.03 의무가 없고, 나머지는 **자발 item으로만 나온다.**

### J6b.1 자동 판정이 틀린 세 건 — 옛 split의 재공시

`선언/승인 어휘 + N-for-one 비율`로 첫 공시를 자동 판정하면 **세 건이 엉뚱한 filing을 집는다.**

| event | 자동 판정이 집은 filing | 실제 내용 |
|---|---|---|
| UA `2014-04-15` | 10-K `0001336917-14-000008` (2014-02-21) | "On **June 11, 2012** the Board of Directors declared a two-for-one stock split …" — **2012년 split의 재공시** |
| NKE `2015-12-24` | 10-K `0000320187-15-000113` (2015-07-23) | "On **November 15, 2012**, we announced a two-for-one stock split …" — **2012년 split의 재공시** |
| TSLA `2022-08-25` | 10-Q `0000950170-22-006034` (2022-04-23) | "…as adjusted to give effect to the **five-for-one** stock split effected … **in August 2020**" — **2020년 split의 재공시** |

> **Follow-up 3 correction의 I10.2가 XBRL 태그에서 발견한 함정이 텍스트에서도 똑같이 난다.**
> 비율과 선언 어휘만으로는 **새 event와 옛 event의 재공시가 구별되지 않는다.**
> **구별하는 것은 effective date 하나다.** 세 건 모두 본문이 옛 날짜를 명시하고 있어서
> 사람이 즉시 잡아냈다 — J6.3이 effective date를 승인 필수 요건에 넣는 이유가 여기서도 나온다.

### J6b.2 source set별 판정

| source set | 모든 확정 event를 formation 이전에 발견 가능? | `COMPLETE`를 선언할 수 있는가 |
|---|---|---|
| **S1 = K/Q family** | **16/16 · P2 interval 조합 23/23** (J3.2·J4) | **가능** — 강제이고 class별이며 침묵이 정보다 (J2.1) |
| **S2 = K/Q + 8-K** | 16/16 (평균 **91일** 더 이르다) | **불가능** — 8-K가 없다는 사실이 event 부재를 뜻하지 않는다. 첫 공시 16건 중 **14건이 자발/조건부 item**이다 |
| **S3 = K/Q + 8-K + proxy** | 16/16 | **불가능** — proxy는 주주 승인이 필요할 때만 존재한다 (Schedule 14A "**If action is to be taken**") |
| **S4 = 최소 필요 set** | — | **S1이다** |

**S2·S3는 recall을 늘리지 않는다. 앞당길 뿐이다.** 그리고 **앞당김은 이 문제에 필요하지 않다** —
기준은 `formation 이전인가` 하나이고 S1이 이미 23/23으로 만족한다(J3.2).

> **자발 source를 completeness 규칙에 넣으면 규칙이 약해진다.** 강제 source만으로 `COMPLETE`를
> 정의하면 "찾지 못했다 = 없다"가 성립하지만, 자발 source를 섞는 순간 그 등식이 깨진다.
> **8-K·proxy는 corroboration과 조기 경보로 쓸 수 있어도 absence의 근거가 될 수 없다.**

## J7. `qv_sec_filings`와의 통합 — §11

**현재 계약을 읽었다.** `trading/backtest/schema.sql`의 `qv_sec_filings`는

```sql
form TEXT NOT NULL CHECK (form IN ('10-K', '10-K/A', '10-Q', '10-Q/A'))
```

로 form을 네 개에 **CHECK로 못박고**, 주석이 그 의미를 이렇게 적는다.

> "Quality + Value 전용 SEC filing 원장. CIK는 이 row의 filing-time SIC를 찾는 target
> registrant이고 issuer identity가 아니다. issuer_id를 두지 않아 submissions ingestion이
> SEC registrant를 내부 issuer로 승격하지 못하게 한다."

그리고 모든 row가 `filing_sic`·`sic_status`(§3.4 formation 시점 SIC)와
`historical_usable_session`(§3.2 acceptance 이후 첫 세션)을 함께 들고 있다.
`qv_submissions.ALLOWED_FORMS`도 같은 넷이다.

### J7.1 K/Q로 충분하면 이 계약을 건드릴 이유가 없다

**J5의 정의가 요구하는 filing 목록은 `qv_sec_filings`가 이미 가진 것과 정확히 같다.**
필요한 필드도 이미 다 있다 — `accession`·`form`·`acceptance_eastern_date`·
`historical_usable_session`. **새 form family도, CHECK 완화도, 새 ingestion 경로도 필요 없다.**

새로 필요한 것은 **읽기 관계 하나와 새 테이블 두 개**뿐이다(스키마는 이번에 만들지 않는다).

```text
corporate-action 후보/판정 ledger   (class_id, event, effective date, ratio, 판정, 원문 provenance)
    -> 근거 filing을 qv_sec_filings의 (cik, accession)으로 참조한다

search coverage ledger              (class_id, lo, hi, formation, closing accession, 판정)
    -> 창 안에서 실제로 조회·검색한 accession 집합을 함께 남긴다
       (NOT_SEARCHED와 '검색했는데 없음'을 구분하는 것이 이 테이블의 존재 이유다)
```

### J7.2 만약 8-K/proxy가 필요했다면 — 그래도 넓히지 않는 것이 맞다

이번 결론은 필요 없다는 쪽이지만, 작업지시가 요구한 tradeoff를 적는다.

| 선택 | 얻는 것 | 잃는 것 |
|---|---|---|
| **`qv_sec_filings`의 form CHECK를 넓힌다** | 테이블 하나로 끝난다 | **`qv_sec_filings`의 의미가 깨진다.** 지금 모든 row는 "accounting fact를 읽어도 되는 filing"이고 `filing_sic`·`historical_usable_session`이 그 계약에 묶여 있다. 8-K row가 섞이면 **회계 fact source로 잘못 쓰일 조용한 경로가 생긴다.** CHECK 하나 푸는 것이 §3.2·§3.4 계약을 동시에 흔든다 |
| **별도 corporate-action filing/discovery ledger** | 기존 계약 무손상 · 두 원장의 목적이 이름으로 갈린다 · 8-K/proxy를 넣어도 회계 경로에 안 닿는다 | 발행사별 submissions를 두 번 훑는다(같은 `submissions` JSON이라 추가 API 비용은 없다) |

**작업지시의 기본값과 같은 결론이다 — 별도 경로를 둔다.**
**그리고 이번 결론(K/Q로 충분)에서는 별도 원장에 담을 filing 목록조차 `qv_sec_filings`를
그대로 읽으면 되므로, 새로 만드는 것은 event·coverage 두 ledger뿐이다.**

## J8. 이 결론이 서 있지 못하는 자리

**정직하게 적는다.**

1. **추출기가 없다.** J4의 16건은 **사람이 읽었다.** "explicit effective date · class · ratio를
   본문에서 결정론적으로 뽑는다"는 코드가 없고, 그것 없이는 `COMPLETE`인 구간의 후보가 전부
   `UNRESOLVED`가 되어 **P2가 사실상 모든 곳에서 fail-close한다.** `COMPLETE`를 선언할 수 있다는
   것과 P2를 켤 수 있다는 것은 다르다.
2. **reverse split 관측이 0이다.** 규칙 쪽은 대칭이다 — SAB 4.C가 "stock dividend, stock split
   **or reverse split**"을 함께 적고 S-X 3-04는 자본계정 변동 전부를 덮는다. **하지만 실측이
   없다.** 이 표본으로 reverse split 경로가 동작한다고 말할 수 없다.
3. **`INCOMPLETE` 관측이 0이라 fail-close 경로가 한 번도 집행되지 않았다.** 20개 대형
   발행사는 전부 정시 제출자다. **연체 제출자·상장폐지 직전 발행사에서 `CLOSURE`가 깨지는
   모습을 이 표본은 보여주지 못한다.**
4. **recall 16/16은 "우리가 아는 event"에 대한 것이다.** Follow-up 3 correction의 I10.2와 같은
   한계다 — **아무도 모르는 event를 놓쳤는지는 이 표본으로 알 수 없다.** 이번 근거의 힘은
   통계가 아니라 **규정 문언**(J2.1)에서 나온다. 통계는 그 문언이 실제 filing에서 지켜지는지를
   16건에서 확인한 것뿐이다.
5. **표본이 20 발행사·전부 대형주다.** S&P 500 전체, 특히 소형·비정시 제출자에서 같은지는
   확인하지 않았다.
6. **`class_id` prose 매핑이 없다**(J4.3). 이름→class 등록이 없으면 J4의 명시 class 정보를
   쓸 수 없다.

## J9. ground truth 확인 범위

**§9·F14·G15·H14·I13과 같은 기준이다. 525 관측 전부를 사람이 원문과 1:1 대조하지 않았다.**

이번에 사람이 원문과 직접 대조한 것:

| 대상 | 원문 | 결과 |
|---|---|---|
| Regulation S-X 3-04 | `CFR-2024-title17-vol3-sec210-3-04` (govinfo), 조회 2026-08-29 | J2.1 인용 |
| Regulation S-X 10-01(a)(7) | `CFR-2024-title17-vol3-sec210-10-01`, 조회 2026-08-29 | J2.1 인용 |
| Form 8-K Item 5.03 · 3.03 · 8.01 | `https://www.sec.gov/files/form8-k.pdf`, 조회 2026-08-29 | J2.2 인용 |
| Schedule 14A Item 11 · 12 | `CFR-2024-title17-vol4-sec240-14a-101`, 조회 2026-08-29 | J2.2 인용 |
| Exchange Act Rule 10b-17 | `CFR-2024-title17-vol4-sec240-10b-17`, 조회 2026-08-29 | J2.3 인용 |
| SAB Topic 4.C | `https://www.sec.gov/interps/account/sabcodet4.htm` | H2에서 인용한 것을 재사용 |
| **확정 event 16건의 `ex 이후 첫 K/Q` 공시 본문** | 각 accession의 primary document 직접 파싱 | **J4 표 — 16건 전부 사람이 읽었다** |
| CMCSA Class A 소급 재작성 산식 | 10-Q `0001166691-17-000009` 본문 + 주식수 | J4.1 (`2A + B` 정확 일치) |
| META Class C Reclassification 철회 | 10-K `0001326801-17-000007` 등 7 filing 본문 | J4.2 — effective date 부재 |
| keyword 오탐 11건 | 6 발행사 386 K/Q 중 울린 것 전수 | J6.2 — 사람이 성격을 확인했다 |

기계로만 검증한 것: 전 form submissions 원장(20 발행사), `bite.py`의 P2 interval 계산,
`coverage.py`의 `CLOSURE`/`SEARCH` 판정, `phrases.py`의 표현별 recall.

**J6의 `stock split` 같은 표현 목록은 후보를 올리는 surface이고 계약이 아니다.**
J3의 `±220일` 스캔 창과 J6.2의 발행사 6곳 선택은 **진단용 절단이고 어떤 계약에도 안 들어간다.**

## J10. 이번에 결정하지 않은 것

1. **event·coverage ledger의 스키마**는 만들지 않았다(작업지시 §11대로). 참조 관계와
   두 테이블의 존재 이유만 적었다.
2. **명시 공시 추출기**(effective date · class · ratio 파싱)를 설계하지 않았다.
3. **prose class-name alias 등록**(J4.3)을 설계하지 않았다. identity 층의 책임이다.
4. **`SPLIT_RATIO_MISMATCH` 잔여**는 CMCSA 하나가 J4.1로 풀렸고 나머지는 여전히 열려 있다
   (GOOGL `decimals` 오기 · UA 1,000배 단위 오류 — H11.1).
5. **cross-accession tie-break(`acceptance DESC`)**는 이번에도 바꾸지 않았다.
6. **Visa Class B·C의 전환비율**(J4 표의 1.6483 · 4.0)은 로드맵 §4.4.2 `CONVERSION_VALUE_PROXY`
   입력이지만 이번 범위 밖이다. **다만 그 값이 강제 경로 본문에 있다는 사실은 기록해 둔다.**
7. **S&P 500 전체로의 확장 검증**을 하지 않았다.

## J11. 결과 요약 — §12

| 지표 | 값 |
|---|---|
| 확정 class-level share-basis event | **23** (고유 `(발행사, ex-date)` **16**) |
| 첫 SEC 공시가 8-K인 event | **16 / 16** |
| 그중 **자발·조건부 item에만 실린 것** | **14 / 16** (Item 8.01 · 7.01 · 2.02 · 1.01) |
| Item 5.03에 실린 것 | **2 / 16** (UA 2012 · UA 2014) |
| **S1(K/Q) recall — formation 이전 발견** | **16 / 16**, P2 interval 조합 **23 / 23** |
| S2(+8-K) recall | 16 / 16 (평균 91일 조기) |
| S3(+proxy) recall | 16 / 16 |
| **최소 source set** | **S1 = K/Q family** |
| `ex 이후 첫 K/Q`가 **effective date·ratio·affected class를 모두 명시** | **16 / 16** |
| **class scope가 `UNRESOLVED`로 남은 event** | **0 / 23** |
| 525 격자 coverage 판정 | `COMPLETE` **520** · `INCOMPLETE` **0** · N/A 5 |
| 격자 전체가 요구하는 고유 K/Q accession | **1,225** (20 발행사 전체 K/Q의 63%) |
| keyword `stock split` recall (event 있는 K/Q) | **16 / 16** |
| keyword `stock split` 오탐률 (event 없는 K/Q 386건) | **11건 = 2.8%** |

## User decision — corporate-action discovery completeness

추천: **A — K/Q family만으로 `COMPLETE`를 선언할 수 있다.**

```text
COMPLETE(class_id, (lo, hi], formation)  <=>  CLOSURE 와 SEARCH

  CLOSURE   G := 그 issuer의 K/Q family filing 중 acceptance >= hi 인 최초 filing
            G가 존재하고 G.acceptance <= formation
  SEARCH    acceptance가 (lo, G.acceptance] 안인 그 issuer의 K/Q family filing을
            하나도 빠짐없이 성공적으로 가져와 전문 검색했다

  둘 중 하나라도 아니면 INCOMPLETE -> selector fail-close
  조회한 적이 없으면 NOT_SEARCHED   -> selector fail-close

  8-K / proxy / vendor feed는 corroboration과 조기 경보로만 쓴다.
  이들의 부재는 event 부재의 근거가 되지 않는다.
```

§13의 조건별로 적는다.

- **formation 시점 PIT를 지키는가.** 지킨다. `lo`·`hi`가 정의상 formation 이하이고 `CLOSURE`가
  `G <= formation`을 명시적으로 요구한다. **미래 filing을 보면 조건이 성립하지 않는 것이 아니라
  `INCOMPLETE`가 된다** — 즉 fail-close 쪽으로 틀린다(J5).
- **listed·unlisted class를 모두 덮는가.** 덮는다. S-X 3-04가 "**for each class of shares**"를
  요구하고, 실제로 비상장 class가 상장 class와 같은 문장에서 이름으로 불린다 —
  MA Class B · NKE Class A · UA Class B · V class B·C · GOOGL Class B(J4).
  **vendor가 구조적으로 못 보는 자리가 여기서 메워진다.** Rule 10b-17이 "publicly traded"
  class에만 걸리는 것이 vendor 사각의 원인이었고(J2.3), K/Q는 그 제한이 없다.
- **reverse split을 포함할 수 있는가.** **규칙 쪽은 그렇다** — SAB 4.C가
  "stock dividend, stock split **or reverse split**"을 함께 적고 S-X 3-04는 자본계정 변동 전부를
  덮는다. **그러나 이 표본에 관측이 0건이라 실측 근거가 없다**(J8-2).
- **class-specific applicability를 보존하는가.** 보존한다. 한 class만 split한 BRK 2010과
  V 2015에서 원문이 **영향받지 않은 class를 명시**하고("The Class B stock split had no effect on
  the number of equivalent Class A common shares" · "Holders of class B and C common stock did not
  receive a stock dividend"), 두 class 모두 split한 MA·NKE·UA·GOOGL도 그대로 나온다.
  **23건 중 class scope가 `UNRESOLVED`인 것은 0건이다.**
  그리고 CMCSA 2017에서는 **비율 하나로 표현할 수 없는 구조**(Class A로 지급 · A와 B 보유분에)까지
  원문이 밝혀, Follow-up 3의 `SPLIT_RATIO_MISMATCH` 잔여 하나를 풀었다(J4.1).
- **vendor absence에 의존하지 않는가.** 의존하지 않는다. **이 정의에 vendor가 등장하지 않는다.**
- **arbitrary numeric threshold가 없는가.** 없다. 창의 두 끝점은 P2 interval과
  `첫 K/Q accepted >= hi`로 정해지고 **달력 상수도 백분율도 쓰지 않는다.** 승인 요건도
  `explicit effective date · class · ratio · provenance`의 유무이지 크기가 아니다.
- **Step 4에 필요한 최소 범위인가.** 그렇다. **필요한 filing이 `qv_sec_filings`가 이미 적재하는
  바로 그 넷이고**, form CHECK도 `ALLOWED_FORMS`도 건드리지 않는다(J7.1). 격자 전체 조회 대상이
  고유 accession 1,225건으로 유계다.

**B·C를 추천하지 않는 이유는 recall이 아니라 논리다.** S2·S3도 16/16이고 평균 91일 더 이르다.
**그런데 completeness는 "찾았다"가 아니라 "없으면 없는 것이다"를 요구한다.**
8-K Item 8.01은 문언 그대로 자발이고(`may, at its option`), Item 5.03은 정관 개정이 있고
proxy에 안 나왔을 때만이며, proxy Item 11·12는 `If action is to be taken`일 때만이다.
**표본의 첫 공시 16건 중 14건이 자발·조건부 item에만 실렸다.** 자발 source를 completeness
규칙에 넣으면 그 규칙은 "안 나왔다"를 근거로 쓸 수 없게 된다.

**D를 추천하지 않는 이유.** `COMPLETE`의 **결정론적** 정의가 실제로 나왔고
(`qv_sec_filings`의 acceptance만으로 계산된다), 525 격자에서 `INCOMPLETE` 0건으로 돌았다.
**"SEC filing만으로 deterministic COMPLETE를 보장 못 한다"는 이번 증거와 맞지 않는다.**

> **다만 A는 `COMPLETE`를 선언할 수 있다는 뜻이지 P2를 freeze할 수 있다는 뜻이 아니다.**
> 두 축 중 **search coverage 축만 이번에 닫혔다.** event classification 축은 그대로 열려 있고,
> 그것이 닫히기 전에는 모든 후보가 `UNRESOLVED`라 P2는 사실상 모든 곳에서 fail-close한다.

**P2 freeze까지 남은 것 셋.**

1. **명시 공시 추출기.** `explicit effective date · affected class · ratio/action · provenance`를
   K/Q 본문에서 결정론적으로 뽑아야 한다. **effective date가 핵심 판별자다** — 그것이 없으면
   META 2016의 미실행 Reclassification이 event가 되고(J4.2), 옛 split의 재공시가 새 event가
   된다(J6b.1). **후보 부담은 작다** — 강제 경로 위에서 `stock split`은 event 없는 K/Q의
   2.8%에서만 울린다(J6.2).
2. **prose class-name → `class_id` PIT 등록**(J4.3). UA의 "Class B"는 registry `CONV`이고
   2016년의 "Class C"와 다른 class다. XBRL member alias와 같은 방식의 명시 등록이 필요하고,
   매칭 실패는 `UNRESOLVED`다.
3. **`INCOMPLETE`·reverse split 경로의 실측.** 이 표본은 정시 제출 대형주 20곳이라
   `CLOSURE` 실패도 reverse split도 한 번도 나오지 않았다. 두 경로는 **코드로만 존재하고
   데이터로 확인되지 않은 상태**다.

**이 follow-up도 research 결과일 뿐 아직 CLOSED/FROZEN 계약이 아니다.**

# Follow-up 4 correction — amendment closure (2026-08-29)

> **Status: RESEARCH EVIDENCE ONLY.** 위 여섯 절과 같다. 설계 승인·freeze가 아니고 production
> code/schema/test/roadmap의 의미를 바꾸지 않는다. Gate · `coverage_start` · B/M · rank ·
> returns는 이번에도 계산하지 않았고 production DB에 쓰지 않았다.

시작 main: `62ad111861991f0a71ecd4133578240a6f86478f`
(`research(qv): corporate-action discovery completeness를 검증한다` — 바로 위 절을 커밋한
지점이고 `origin/main`도 같았다.)

**이번에 다시 열지 않은 것.** K/Q의 강제 공시를 completeness source로 쓰는 방향 ·
search coverage와 event classification의 두 축 분리 · A/B tier의 filing-basis anchor ·
P0/P1/P4 탈락 · P2를 아직 freeze하지 않는다는 것. **source-set 결론(S1 = K/Q family)도 그대로다.**
이 절은 그 안에서 **closing filing의 자격 하나만** 좁힌다.

## K1. 이번 질문 하나

> **`CLOSURE`의 `G`로 10-K/A · 10-Q/A를 인정해도 되는가?**

Follow-up 4의 J5는 이렇게 적었다.

```text
G := 그 issuer의 K/Q family filing 중 acceptance_eastern_date >= hi 인 최초 filing
```

`K/Q family`는 `qv_submissions.ALLOWED_FORMS`와 `schema.sql`의 `qv_sec_filings.form` CHECK가
정한 넷이다 — `10-K · 10-K/A · 10-Q · 10-Q/A`. **amendment가 그 안에 들어 있다.**

`CLOSURE`가 요구하는 성질은 하나다 — **`G`가 `(lo, hi]` 안의 event를 공시할 의무를 진다.**
J5는 그 의무의 근거로 SAB Topic 4.C와 S-X 3-04를 들었다. **둘 다 재무제표에 붙는 의무다.**
amendment가 재무제표를 들고 오지 않으면 그 근거가 성립하지 않는다.

## K2. Rule 12b-15와 Form 10-K/A · 10-Q/A의 공식 semantics

**(1) Exchange Act Rule 12b-15.**
출처: [17 CFR 240.12b-15](https://www.govinfo.gov/content/pkg/CFR-2024-title17-vol4/xml/CFR-2024-title17-vol4-sec240-12b-15.xml)

> "All amendments must be filed under cover of the form amended, marked with the letter 'A' to
> designate the document as an amendment, e.g., '10-K/A' ... Amendments filed pursuant to this
> section **must set forth the complete text of each item as amended.** Amendments must be
> numbered sequentially and be filed separately for each statement or report amended."

**"each item as amended"** — 고친 item만이다. **원 filing 전체를 다시 내라는 요구가 아니고,
원 filing 이후의 사건을 반영하라는 요구는 어디에도 없다.**

**(2) Form 10-K General Instruction G(3) — 재무제표 없는 amendment가 제도적으로 정상이다.**
출처: [Form 10-K](https://www.sec.gov/files/form10-k.pdf)

> "if such definitive proxy statement or information statement is not filed with the Commission in
> the l20-day period ... **the Items comprising the Part III information must be filed as part of
> the Form 10-K, or as an amendment to the Form l0-K,** not later than the end of the 120-day period."

**Part III만 담은 10-K/A는 규정이 예정한 정상 형태다.** 그 문서에는 재무제표가 아예 없다.
같은 Form의 General Instruction A(4)는 Article 12 S-X 명세서도 30일 안에 amendment로
낼 수 있게 한다.

> **여기서 `CLOSURE`의 전제가 깨진다.** S-X 3-04는 "자본계정 변동 분석을 주석이나 별도
> 보고서로 낼 것"을 요구하고 SAB 4.C는 "소급 효과와 effective date 주석"을 요구하는데,
> **재무제표가 없는 문서에는 걸 곳이 없다.** amendment가 `hi` 이후라는 사실만으로는
> event 부재를 닫지 못한다.

## K3. 표본의 amendment를 실제로 읽었다 — 25건 전수

20 발행사의 K/Q family에 amendment는 **62건**이다. 그중 **연구 시대(2009 이후)에 노출 구간을
가진 23건 + 후보 fact를 공급한 2건 = 25건**의 원문을 직접 읽었다.

**결과: 25건 중 재무제표를 재작성하면서 원 filing 이후 사건을 반영한 것은 0건이다.**

| 성격 | 건수 | 사례 |
|---|---|---|
| **Part III만**(General Instruction G(3)) | **8** | TSLA 10-K/A 2020·2021·2022·2025·2026 · MA 2010 · GOOGL 2016 · META 2016 |
| **증명서·동의서·exhibit만** | **8** | UA 2013 · WMT 2013 · COST 2013·2015 · META 2015 · GOOGL 2019 · XOM 2011 · ABBV 2013 |
| **XBRL detail-tagged footnote만**(Reg S-T 405(a)(2) 유예) | **1** | TSLA 10-K/A 2012 |
| **비연결 JV의 S-X 3-09 재무제표 추가** | **4** | F 10-K/A 2015·2016·2017·2018 (Changan Ford) |
| MD&A 표 오류 정정 | 1 | COST 10-K/A 2016 |
| Part II Item 4 주주총회 집계 정정 | 1 | AAPL 10-Q/A 2009 |
| 기타 exhibit 정정 | 1 | MA 10-K/A 2011 |
| **회계기준 소급 채택에 따른 재무제표 재작성** | **1** | **AAPL 10-K/A 2010-01-25** |

**원문이 스스로 그렇게 말한다.**

| filing | 인용 |
|---|---|
| **GOOGL 10-K/A** `0001193125-19-028757` | "this Amendment No. 1 does not modify or update in any way the financial position, results of operations, cash flows, or other disclosures in, or exhibits to, the Original Form 10-K, **nor does it reflect events occurring after the filing of the Original Form 10-K.**" |
| **TSLA 10-K/A** `0001193125-12-137560` | "The purpose of this Amendment No. 1 ... is to furnish detail-tagged footnotes in Exhibit 101 ... This Amendment No. 1 does not otherwise change or update the disclosures set forth in the Form 10-K as originally filed and **does not otherwise reflect events occurring after the original filing of the Form 10-K.**" |
| **XOM 10-K/A** `0001193125-11-050134` | "This Amendment No. 1 is being filed **solely for the purpose of inserting the conformed signature of independent auditors** ... **Except for these corrections, there have been no changes in any of the financial or other information contained in the report.** For convenience, the entire Annual Report on Form 10-K, as amended, is being re-filed." |
| **UA 10-K/A** `0001336917-13-000013` | "**solely to correct typographical errors in the certifications** ... Except as described above, the Amendment **does not modify or update the disclosures** presented in, or exhibits to, the Original Filing. The Original Filing as corrected is hereby refiled in its entirety." |
| **TSLA 10-K/A** `0001564590-21-022604` | "The Original Form 10-K **omitted Part III, Items 10 … 14** … **in reliance on General Instruction G(3)** to Form 10-K" |
| **META 10-K/A** `0001326801-16-000063` | "The **sole purpose** of this Amendment No. 1 is to include the information required by **Items 10 through 14 of Part III** of Form 10-K." |

> **XOM과 UA가 특히 위험하다.** 둘 다 "전체를 다시 낸다(refiled in its entirety)"라서
> **문서에 재무제표가 그대로 들어 있다.** 기계적으로 보면 자본 주석도 있고 대차대조표도 있다
> (XOM `자본 주석` 59회 · `대차대조표` 363회, UA 43회 · 149회). **그런데 explanatory note가
> "재무 정보에는 아무 변화가 없다"고 못박는다.** 즉 **재무제표의 존재는 그 문서가 새 사건을
> 반영했다는 증거가 아니다.** form 이름으로도 본문 유무로도 가를 수 없고, explanatory note를
> 읽어야만 안다.

### K3.1 유일한 재작성 amendment도 `CLOSURE`를 못 준다

**AAPL 10-K/A `0001193125-10-012091`(2010-01-25)** 하나만 실제로 재무제표를 재작성했다 —
수익인식 회계기준의 소급 채택 때문이다.

> "As amended by this Form 10-K/A, the Form 10-K reflects the Company's **retrospective adoption**
> of the ... amended accounting standards related to revenue recognition ..."
> "**This Form 10-K/A speaks as of September 26, 2009, unless otherwise noted.**"

**`speaks as of September 26, 2009`가 결정적이다.** `CLOSURE`가 `G`에게 요구하는 것은
**자기 접수일 시점으로 구간을 닫아주는 것**인데, 이 문서는 **원 대차대조표일 시점으로 말한다고
스스로 밝힌다.** 재작성 amendment조차 closing filing의 성질을 갖지 않는다.

> **부수 관측(이번에 열지 않는다).** 이 amendment는 `2009-09-26`·`2009-10-16` instant의
> share fact를 공급하고, filing-basis anchor 계약상 그 basis는 접수일 `2010-01-25` 시점으로
> 읽힌다. 그런데 문서는 `speaks as of 2009-09-26`이라고 적는다. **anchor 계약은 CLOSED이므로
> 다시 열지 않고, 관측만 K10에 남긴다.**

## K4. 525 격자에서 C0 vs C1

```text
C0 (현재)  G := 최초 10-K / 10-K/A / 10-Q / 10-Q/A  with acceptance >= hi
C1 (엄격)  G := 최초 10-K / 10-Q                     with acceptance >= hi
SEARCH     두 정의 모두 (lo, G.acceptance] 안의 K/K-A/Q/Q-A를 전부 검색한다 (좁히지 않는다)
```

**acceptance-date 규약 두 가지로 각각 돌렸다**(왜 둘인지는 K6).

| | C0 (amendment 인정) | C1 (original만) |
|---|---|---|
| **COMPLETE** | **520** | **520** |
| **INCOMPLETE** | **0** | **0** |
| closing accession이 바뀐 관측 | — | **0** |
| **amendment 때문에 C0만 COMPLETE** | — | **0** |
| C0 closing form 분포 | `10-Q` 350 · `10-K` 170 · **amendment 0** | `10-Q` 350 · `10-K` 170 |

**두 규약 모두에서 결과가 같다.** §3이 요구한 "기존 `G`가 10-K/A 또는 10-Q/A였던 관측 전수"의
답은 **0건**이다.

**C1의 비용은 이 격자에서 0이다** — `COMPLETE`가 하나도 줄지 않고 closing accession도 하나도
바뀌지 않는다.

## K5. 0은 계약이 아니라 격자 배치의 결과다

**왜 0인지를 구조로 설명해야 한다.** 그러지 않으면 "표본에서 안 났으니 괜찮다"가 된다.

`hi = max(후보 fact의 filing 보고일, December session)`이므로 `hi`는 둘 중 하나다.

| `hi`의 정체 | 관측 | `G`가 amendment가 될 수 있는가 |
|---|---|---|
| **후보 fact의 filing 보고일** | **394 / 520** | **구조적으로 불가**(그 filing 자신이 `acceptance >= hi`를 등호로 만족해 `G`가 된다). 단 **그 fact가 amendment에서 온 것이면 가능하다** — K5.2 |
| **December session** | **126 / 520** | **가능** — December와 다음 K/Q 사이에 amendment가 끼면 그것이 `G`가 된다 |

### K5.1 December 뒤의 창이 실제로 얼마나 넓은가

126개 관측이 쓰는 `(issuer, December)` 조합 **309개**를 전수로 봤다.

| | 값 |
|---|---|
| December 이후 첫 K/Q family filing이 **amendment**인 조합 | **0 / 309** |
| December → 다음 K/Q family filing 간격 | 최소 **3일** · 중앙값 **47일** · 최대 **91일** |

**중앙값 47일짜리 창이 매년 열려 있는데 이 표본에서는 한 번도 amendment가 거기 떨어지지
않았다.** 그것이 전부다. 20 발행사가 전부 정시 제출 대형주라서 amendment가 주로 원 filing
직후(며칠 안)나 Part III 기한(연차 후 120일)에 몰린 결과다.

### K5.2 amendment가 `hi`를 만드는 두 번째 경로 — 후보 fact 13건

**후보 fact 4,555개 중 13개가 amendment에서 왔다**(`10-K/A` 12 · `10-Q/A` 1, 관측 11개).

| issuer | class | formation | form | 보고일 | accession | instant |
|---|---|---|---|---|---|---|
| AAPL | SOLE | 2010 | 10-K/A | 2010-01-25 | `0001193125-10-012091` | 2009-09-26 · 2009-10-16 |
| TSLA | SOLE | 2013 | 10-K/A | 2012-03-28 | `0001193125-12-137560` | 2012-01-31 |
| TSLA | SOLE | 2021 | 10-K/A | 2020-04-28 | `0001564590-20-018984` | 2020-02-07 |
| TSLA | SOLE | 2022 | 10-K/A | 2021-04-30 | `0001564590-21-022604` | 2021-02-01 |
| TSLA | SOLE | 2023 | 10-K/A | 2022-04-29 | `0001564590-22-016871` | 2022-01-31 |
| TSLA | SOLE | 2026 | 10-K/A | 2025-04-30 | `0001104659-25-042659` | 2025-01-22 |
| UA | A · CONV | 2013 · 2014 | 10-K/A | 2013-02-25 | `0001336917-13-000013` | 2012-12-31 · 2013-01-31 |
| WMT | SOLE | 2014 | 10-Q/A | 2013-10-21 | `0000104169-13-000039` | 2013-10-17 |
| XOM | SOLE | 2012 | 10-K/A | 2011-02-28 | `0001193125-11-050134` | 2011-01-31 |

**그 fact가 후보 중 보고일이 가장 늦었다면 `hi`가 그 amendment의 접수일이 되고, `G`는 등호로
그 amendment 자신이 된다.** 13건 모두 뒤에 더 늦은 original filing이 있어서 그렇게 되지 않았고,
**P2가 최종 선택한 fact 520개 중 amendment에서 온 것은 0개다.** 그러나 이 경로는 살아 있다.

### K5.3 amendment가 `G`가 될 수 있는 날짜 구간의 총량

62개 amendment 각각에 대해 **`hi`가 그 안에 있으면 C0가 그 amendment로 닫게 되는 구간**
`(직전 K/Q family filing 접수일, 그 amendment 접수일]`을 계산했다.

| | 값 |
|---|---|
| 노출 구간이 **0일이 아닌** amendment | **56 / 62** |
| 노출 구간 총합 | **2,037일** (중앙값 25일 · 최대 182일) |
| 그중 연구 시대(2009~) | **23건 · 732일** |

**넓은 것 몇 개**(2009 이후): COST `10-Q/A` 2015-08-31 **88일** · TSLA `10-K/A` 2020-04-28
**75일** · F `10-K/A` 2016·2017·2018 각 **48일** · GOOGL `10-K/A` 2016-03-29 **47일** ·
WMT `10-Q/A` 2013-10-21 **46일** · MA `10-K/A` 2010-04-22 **63일**.

**격자의 실제 `hi`가 이 구간 안에 들어간 적은 0건이다.** 그러나 여러 건이 **구간 경계에
정확히 붙어 있다** — TSLA `hi=2021-04-28`은 노출 구간 `(2021-04-28, 2021-04-30]`의 **하한
바로 그 날**이고, 같은 모양이 TSLA 2022·2025·2026과 COST 2015에도 있다. META는 `hi=2016-04-28`,
노출 구간 상한은 `2016-04-27`로 **하루 차이**다.

> **즉 C0가 이 격자에서 무사한 이유는 "amendment가 closing filing이 되지 않는다"는 성질이
> 아니라, `hi`들이 우연히 노출 구간 밖에 떨어졌기 때문이다. 하루 단위의 여유다.**

## K6. acceptance-date 규약이 다르면 그 하루가 실제로 넘어간다

**이번에 부수적으로 발견했고, 그 자체가 K5의 실증이다.**

| 층 | 쓰는 값 |
|---|---|
| `qv_sec_filings.acceptance_eastern_date` · `qv_submissions._acceptance_eastern_date` | **America/New_York 변환** |
| Follow-up 3·4의 연구 하네스 (`sp.py`의 `acc_date = acceptance[:10]`) | **UTC 절단** |

20 발행사 K/Q family **1,959건 중 150건(7.7%)**에서 두 값이 하루 다르다
(장 마감 후 20:00 ET 이후 접수분).

**한쪽만 Eastern으로 바꾸면**(ledger는 Eastern, fact의 `hi`는 UTC 절단) 결과가 이렇게 바뀐다.

| | C0 | C1 |
|---|---|---|
| COMPLETE | 494 | 490 |
| INCOMPLETE | **26** | **30** |
| **amendment 때문에 C0만 COMPLETE** | — | **4** |

그 4건이 전부 **TSLA의 Part III 전용 `10-K/A`**다(formation 2021 · 2022 · 2025 · 2026).

```text
TSLA formation 2021 · hi=2021-04-28
    C0 -> G = 10-K/A 2021-04-30  (Part III만, General Instruction G(3))  <= formation  -> COMPLETE
    C1 -> G = 10-Q  2021-07-27                                            >  formation  -> INCOMPLETE
```

> **이 4건은 규약을 섞어서 생긴 artifact이고 실제 결함이 아니다** — 양쪽을 같은 규약으로
> 맞추면 K4처럼 0건으로 돌아온다. **그러나 그것이 정확히 K5의 논점이다.**
> **날짜 하루가 어긋나는 것만으로 C0의 closing filing이 "Part III만 담은 10-K/A"가 된다.**
> 그 문서에는 재무제표가 없고, 따라서 S-X 3-04도 SAB 4.C도 걸 곳이 없다.

**규약 불일치 자체는 이 correction의 범위 밖이라 고치지 않는다. K10에 열린 항목으로 남긴다.**

## K7. synthetic regression — 작업지시가 요구한 shape

실제 발행사 달력을 본뜬 **가상 원장**이다. 실제 데이터가 아니다.

```text
가상 발행사 SYN (12월 결산)
    2022-04-25  10-Q     FY2022 Q1  <- 후보 share fact를 준 original Q
    2022-07-25  10-Q     FY2022 Q2
    2022-10-24  10-Q     FY2022 Q3
    2023-01-09  10-Q/A   Q3의 증명서 exhibit만 수정. subsequent events 반영 안 함
    2023-07-05  10-K     FY2022 연차 — 연체 제출

    December  = 2022-12-30      formation = 2023-06-30
    후보 fact의 filing 보고일 = 2022-10-24   ->  interval (lo, hi] = (2022-10-24, 2022-12-30]
    실제 share-basis event   = 2022-11-14  x2   ->  interval 안이다
```

| | `G` | `G <= formation`? | 판정 |
|---|---|---|---|
| **C0** | `10-Q/A` **2023-01-09** | 예 | **`COMPLETE`** ← **틀렸다** |
| **C1** | `10-K` **2023-07-05** | 아니오 | **`INCOMPLETE` → fail-close** ← 옳다 |

**C0가 왜 틀렸는가.** `10-Q/A`는 Rule 12b-15의 "each item as amended"에 따라 증명서 item만
담고, GOOGL·TSLA 원문의 표준 문구대로 **"does not reflect events occurring after the filing of
the Original"이다. 2022-11-14의 event를 공시할 의무가 없다.** 그런데 C0는 그 문서가
`hi` 뒤에 있다는 사실만으로 구간을 닫는다.

**기대와 일치한다** — 작업지시가 예고한 그대로다.

## K8. `SEARCH`는 좁히지 않는다 — amendment는 evidence로 남는다

**C1은 `CLOSURE`의 자격만 좁히고 `SEARCH` 범위는 그대로다.** amendment가 실제로 event를
공시했다면(예: 전체 재제출형 XOM·UA) 그 증거는 그대로 쓴다. 다만 **그 문서의 침묵을
absence의 근거로 쓰지 않는다.**

| | 값 |
|---|---|
| `SEARCH` 창 안에 amendment가 하나라도 있는 관측 | **47 / 520** |
| 창 안에 등장하는 고유 amendment accession | **22** (`10-K/A` 19 · `10-Q/A` 3) |
| 격자 전체의 고유 조회 대상 K/Q accession | **1,225** (C0·C1 동일) |

**C1로 바꿔도 조회 부담이 늘지 않는다** — 이 격자에서 `G`가 하나도 안 바뀌므로 창도 같다.

## K9. ground truth 확인 범위

**§9·F14·G15·H14·I13·J9와 같은 기준이다. 525 관측 전부를 사람이 원문과 1:1 대조하지 않았다.**

| 대상 | 원문 | 결과 |
|---|---|---|
| Exchange Act Rule 12b-15 | `CFR-2024-title17-vol4-sec240-12b-15` (govinfo), 조회 2026-08-29 | K2 인용 |
| Form 10-K General Instruction G(3) · A(4) | `https://www.sec.gov/files/form10-k.pdf`, 조회 2026-08-29 | K2 인용 |
| **amendment 25건의 explanatory note** | 각 accession의 primary document 직접 파싱 | **K3 — 25건 전부 사람이 읽었다** |
| AAPL 10-K/A의 `speaks as of` 문구 | `0001193125-10-012091` 본문 | K3.1 인용 |
| acceptance-date 규약 차이 | `qv_submissions._acceptance_eastern_date`를 직접 호출해 1,959건 대조 | K6 (150건 불일치) |

기계로만 검증한 것: 전 form submissions 원장(20 발행사)의 amendment 62건 분류,
`c0c1b.py`의 C0/C1 판정(두 규약), `hazard.py`의 `hi` 유형 분해, `expose.py`의 노출 구간.

**K7의 원장은 합성이다.** 실제 발행사 데이터가 아니며 어떤 통계에도 들어가지 않는다.
K5.3의 `2009-01-01` 시대 절단은 진단용이고 계약에 안 들어간다.

## K10. 이번에 결정하지 않은 것

1. **acceptance-date 규약 통일**(K6). 연구 하네스는 `acceptance[:10]`(UTC 절단)을 쓰고
   `qv_sec_filings`는 `acceptance_eastern_date`를 쓴다. **1,959건 중 150건이 하루 다르다.**
   Follow-up 3·4의 숫자가 그 규약 위에서 계산됐다는 사실을 기록해 둔다.
   **production 계약은 이미 Eastern이므로 계약 변경이 아니라 하네스 정합 문제다.**
2. **재작성 amendment의 filing-basis anchor**(K3.1). AAPL 10-K/A는 `speaks as of` 원 대차대조표일이라고
   밝히는데 anchor 계약은 접수일 regime으로 읽는다. **anchor는 CLOSED이므로 열지 않는다.**
3. **`qv_sec_filings`의 form CHECK와 `ALLOWED_FORMS`는 건드리지 않는다.** amendment는 여전히
   적재·검색 대상이고, 이번 correction은 **`CLOSURE`의 자격만** 좁힌다. J7의 통합 결론
   (기존 원장을 그대로 읽고 event·coverage ledger 둘만 새로 둔다) 그대로다.
4. **`INCOMPLETE` 경로의 실측은 여전히 0건이다**(J8-3). C1로 좁혀도 이 표본에서는
   fail-close가 한 번도 집행되지 않는다.
5. **amendment가 실제로 event를 처음 공시한 사례**는 이 표본에 없다. C1이 evidence로서의
   amendment를 버리지 않는 것은 규정 논리이지 실측이 아니다.

## User decision — amendment closure

추천: **B — `CLOSURE`는 original `10-K` · `10-Q`만 인정한다.**

```text
CLOSURE   G := 그 issuer의 filing 중 form이 '10-K' 또는 '10-Q'이고
               acceptance_eastern_date >= hi 인 최초 filing
          G가 존재하고 G.acceptance_eastern_date <= formation

SEARCH    바뀌지 않는다 — (lo, G.acceptance] 안의
          10-K · 10-K/A · 10-Q · 10-Q/A를 전부 성공적으로 가져와 검색한다

즉 amendment는 evidence가 될 수 있지만 absence를 닫는 filing이 아니다.
```

- **규정이 그렇게 말한다.** Rule 12b-15는 "**each item as amended**"만 요구하고 원 filing 이후
  사건의 반영을 요구하지 않는다. Form 10-K General Instruction G(3)은 **재무제표가 전혀 없는
  Part III 전용 10-K/A**를 정상 형태로 예정한다. `CLOSURE`의 근거인 S-X 3-04와 SAB 4.C는
  **재무제표에 붙는 의무**라 그런 문서에는 걸 곳이 없다(K2).
- **표본이 그것을 확인한다.** 읽은 25건 중 **원 filing 이후 사건을 반영한 것은 0건**이고,
  여러 건이 "**nor does it reflect events occurring after the filing of the Original**"이라고
  명시한다(K3). 유일한 재작성 amendment조차 "**speaks as of**" 원 대차대조표일이라고 밝힌다(K3.1).
- **form 이름으로도 본문 유무로도 가를 수 없다.** XOM·UA는 전체를 재제출해 재무제표를 그대로
  담고 있지만 explanatory note가 "재무 정보 변화 없음"이라고 못박는다(K3).
  **그래서 개별 판독이 아니라 form 자격으로 잘라야 한다.**
- **비용이 0이다.** 525 격자에서 `COMPLETE` 520 유지, `INCOMPLETE` 0 유지, closing accession
  변경 0건, 조회 대상 1,225건 동일(K4·K8).
- **이득은 규정으로 뒷받침되는 구멍 하나를 닫는 것이다.** synthetic regression에서
  **C0는 잘못 `COMPLETE`, C1은 `INCOMPLETE` → fail-close**다(K7).
- **지금 0인 것은 여유가 아니다.** amendment가 closing filing이 될 수 있는 날짜 구간이
  56개 amendment에 걸쳐 **2,037일**(2009 이후 23건 · 732일) 열려 있고, 실제 `hi` 여러 개가
  그 경계에 **하루 차이**로 붙어 있다(K5.3). **규약을 하루 어긋나게 하는 것만으로
  TSLA의 Part III 전용 10-K/A가 4개 관측의 closing filing이 된다**(K6).

**A를 추천하지 않는 이유.** A는 "amendment도 `hi` 뒤에 있으면 닫는다"인데, **그 문서가 event를
공시할 의무를 지는지를 form이 보장하지 않는다.** completeness는 J2가 세운 기준 그대로
**침묵이 정보여야** 성립하고, Rule 12b-15 아래 amendment의 침묵은 정보가 아니다.
**표본에서 아직 사고가 안 났다는 것은 A의 근거가 되지 못한다** — K5가 그 0이 구조가 아니라
배치의 결과임을 보인다.

> **이 correction은 Follow-up 4의 source-set 결론(S1 = K/Q family)을 바꾸지 않는다.**
> `SEARCH`는 여전히 네 form 전부를 훑고 `qv_sec_filings`도 그대로다.
> **좁아지는 것은 `CLOSURE`의 자격 하나뿐이다.**

**이 correction도 research 결과일 뿐 아직 CLOSED/FROZEN 계약이 아니다.**

# Follow-up 5 — explicit corporate-action disclosure extraction (2026-08-29)

> **Status: RESEARCH EVIDENCE ONLY.** 위 일곱 절과 같다. 설계 승인·freeze가 아니고 production
> code/schema/test/roadmap의 의미를 바꾸지 않는다. Gate · `coverage_start` · B/M · rank ·
> returns는 이번에도 계산하지 않았고 production DB에 쓰지 않았다. **production extractor를
> 구현하지 않았고 enum/schema도 만들지 않았다.**

시작 main: `6b3087c2227b5ac2aa4a436ba013d1e2b9ae682e`
(`research(qv): amendment를 CLOSURE에서 제외해야 하는지 검증한다`)

**병렬 작업.** 작업 시작 시점에 로컬 `main`이 `d7b59a4 research(memory): measure R3 P0-A
feasibility` 하나만큼 `origin/main`보다 앞서 있었다. 그 커밋은 `lib/` · `scripts/` · `test/` ·
`package.json`만 건드리고 QV 파일을 하나도 건드리지 않는다. **수정·revert하지 않았고 이번
QV 커밋에 섞지 않았다.**

**이번에 다시 열지 않은 것.** A/B tier의 filing-basis anchor · P0/P1/P4 탈락 · P2가 유일 후보이고
아직 freeze 전 · P3 normalization · search coverage와 event classification의 두 축 분리 ·
`COMPLETE`의 source-of-truth가 K/Q family라는 것 · `CLOSURE`는 original `10-K`/`10-Q`만 ·
`SEARCH`는 네 form 전부 · amendment는 evidence이되 closure 아님 · 8-K/proxy/vendor는
corroboration only · `acceptance_eastern_date`가 시간 정본 · percentage tolerance 금지 ·
share-count jump만으로 approval 금지 · issuer-wide class 전파 금지 ·
**prose class-name → `class_id` 매핑은 OPEN이고 이번에 손대지 않았다.**

## L1. 이번 질문 하나

> **K/Q family 전문을 `COMPLETE`하게 검색했을 때, 어떤 결정론적 extraction 계약이면
> share-basis corporate-action 후보를 빠뜨리지 않고 surface하면서
> old-event 재공시 · boilerplate · 미실행 proposal을 구분할 수 있는가?**

`class_id` resolution은 하지 않는다. raw disclosure까지만 본다.

## L2. 두 단계를 절대 합치지 않는다

```text
Stage 1  DISCOVERY CANDIDATE
         K/Q 원문에서 corporate-action 가능성이 있는 문맥(span)을 surface한다.
         keyword hit 자체는 event가 아니다.

Stage 2  STRUCTURED DISCLOSURE EXTRACTION
         span에서 raw field만 뽑는다.
             action_type_raw · effective_date_raw · ratio_or_action_raw
             affected_class_names_raw[] · disclosure_status_raw
             accession · form · acceptance_datetime · document_name · source span
         affected_class_names_raw는 문자열 그대로다. class_id로 바꾸지 않는다.
```

이번 연구의 label은 **research label**이고 production enum이 아니다.

```text
EXTRACTABLE    필요한 explicit field가 원문에 전부 있고 결정론적으로 뽑힌다
INSUFFICIENT   candidate는 맞지만 required field가 하나 이상 없다
NON_EVENT      원문상 명시적으로 share-basis event가 아니다
```

## L3. Stage 1 — 후보 표면은 좁다

**대상은 Follow-up 4·correction이 정한 `COMPLETE SEARCH` 집합 그대로다.**
`acceptance_eastern_date`만 써서 다시 계산했고(§17), `CLOSURE`는 original `10-K`/`10-Q`만
인정했다(Follow-up 4 correction).

| | 값 |
|---|---|
| 관측 | 520 (`INCOMPLETE` 0) |
| **검색 대상 고유 K/Q accession** | **1,225** |
| form 분포 | `10-Q` 897 · `10-K` 306 · `10-K/A` 19 · `10-Q/A` 3 |

**후보 단위는 임의 window가 아니라 HTML block-level 경계다**(§9). `p`·`div`·`td`·`tr`·`li`·
`h1~h6`·`table` 등 block 태그로만 자르고, **문장 수·토큰 수 cutoff를 쓰지 않는다.**

known positive 16건의 문서에서 block 총수 대비 후보 block 수는 이렇다.

| event | 문서 block 수 | **후보 block** |
|---|---|---|
| NVDA 2021 | 2,689 | **1** |
| CMCSA 2017 · NKE 2015 · UA 2014 | 5,202 / 4,301 / 1,224 | **2** |
| AAPL 2014 · NKE 2012 · NVDA 2024 | 3,451 / 3,882 / 3,020 | **3** |
| BRK 2010 | 6,890 | **4** |
| AAPL 2020 | 3,826 | **5** |
| WMT 2024 | 4,337 | **6** |
| GOOGL 2022 · MA 2014 · V 2015 | 3,956 / 5,961 / 2,773 | **7** |
| UA 2012 | 12,336 | **12** |
| TSLA 2022 | 3,867 | **14** |
| TSLA 2020 | 4,051 | **18** |

**16/16에서 후보가 나오고, 문서당 1~18 block이다.** 사람이 읽어야 할 양이 아니라
기계가 field를 뽑아야 할 양으로도 작다.

### L3.1 표현군 census — `stock split` 하나로는 안 된다

§8이 요구한 의미군을 전부 따로 세었다. 열은 span이 실제로 무엇이었는지다.

| 표현군 | true current event | old-event 재공시 | proposed (META) | boilerplate 등 | **16 anchor recall** |
|---|---|---|---|---|---|
| **`stock split`** | 84 | 37 | 42 | 5 | **16/16** |
| **`N-for-one` / `N-for-1`** | 50 | 19 | 9 | — | **16/16** |
| `effected / effective` | 42 | 12 | 4 | — | 12/16 |
| `stock dividend` | 36 | 28 | 66 | 9 | 11/16 |
| `declared / approved / distributed` | 18 | 12 | 17 | 6 | 9/16 |
| `reclassification` | 5 | 11 | 32 | 3 | 3/16 |
| `recapitalization` | 3 | 8 | 6 | 4 | 3/16 |
| `share dividend` | 3 | 1 | — | — | 3/16 |
| `split-up / subdivision` | 3 | 4 | 11 | 7 | 2/16 |
| `additional share for each share held` | 2 | — | — | — | 2/16 |
| `reverse split` | 1 | 4 | 2 | — | 1/16 |
| `combination / consolidation of shares` | 1 | 4 | — | 2 | 1/16 |
| `reverse stock split` | — | 2 | 6 | 1 | **0/16** |
| **`one-for-N` / `1-for-N`** | — | — | — | — | **0/16** |

**forward split만 보면 `stock split`과 `N-for-one` 두 군이 각각 16/16이다.**
`reverse stock split`과 `one-for-N`은 이 표본에서 **0/16**이다 — reverse event가 없기 때문이다.

> **그런데 forward 표본만 보고 표현군을 고르면 안 된다** —
> §16의 CONTROL이 이유를 보인다. **Sirius XM의 10:1 주식수 변경은 본문에 split이라는 단어가
> 없고 `one-for-ten`이라는 비율 표현으로만 나온다**(L12). forward split 표본만 보고 고른
> 표현 집합은 reverse/consolidation 계열을 통째로 놓친다.
> **그래서 표현군은 action 명사와 비율 형태를 함께 켜야 하고, 그 근거는 16 anchor가 아니라
> CONTROL에서 나온다.**

## L4. Stage 2 — known positive 16건의 field 추출

**날짜는 전부 '역할 문구'에 앵커해서 뽑았다. 근접도·최근접 heuristic을 쓰지 않았다.**

```text
EFFECTIVE     "effective date of X" · "became effective on X" · "was effected on X"
              "On X, the Company effected" · "completed a … split … on X" · "the X 1-for-15 … split"
DISTRIBUTION  "distributed on X" · "payable on X" · "paid on X" · "distribution date of X"
RECORD        "record date of X" · "(share|stock)holders of record … X"
TRADING       "began trading … on a split-adjusted basis on X"
DECLARED      "On X, the Board … declared/approved/announced"
```

| event | ratio/action | class raw | **date role** |
|---|---|---|---|
| BRK 2010 | `50-for-1` | `Class B` (+ Class A 영향 없음 명시) | **EFFECTIVE** |
| UA 2012 | `two-for-one` · `100% common stock dividend` | `Class A and Class B common stock` | **EFFECTIVE** · DECLARED · DISTRIBUTION |
| NKE 2012 | `two-for-one` · `100 percent stock dividend` | `Class A and Class B` | DECLARED · DISTRIBUTION · RECORD · TRADING |
| MA 2014 | `ten-for-one` | `the Company's Class A and Class B common shares` | DECLARED · DISTRIBUTION |
| UA 2014 | `two-for-one` · `100% common stock dividend` | `Class A and Class B common stock` | **EFFECTIVE** · DECLARED · DISTRIBUTION |
| AAPL 2014 | `seven-for-one` | `its common stock` | **EFFECTIVE** · DECLARED · RECORD |
| V 2015 | `four-for-one` · `dividend of three additional shares` | `its class A common stock` · `class B` · `class C common stock` | DISTRIBUTION · RECORD · TRADING |
| NKE 2015 | `two-for-one` · `100 percent stock dividend` | `Class A and Class B` | DECLARED · DISTRIBUTION · RECORD · TRADING |
| CMCSA 2017 | `two-for-one` · `100% stock dividend` · `one additional share for every share held and was payable in shares of Class …` | `Class A common stock` · `Class B common stock` | DECLARED · DISTRIBUTION · RECORD |
| AAPL 2020 | `four-for-one` | `Common Stock` (문단이 아니라 **절 제목**에서만) | **EFFECTIVE** · DECLARED · RECORD |
| TSLA 2020 | `five-for-one` · `dividend of four additional shares` | `our common stock` | DECLARED · RECORD |
| NVDA 2021 | `four-for-one` · `three additional shares of common stock for every share held on the record date` | `our common stock` | DECLARED · RECORD |
| GOOGL 2022 | `20-for-one` | `Class A, Class B` · `Class C` | **EFFECTIVE** · DECLARED · RECORD |
| TSLA 2022 | `three-for-one` · `five-for-one` · `dividend of two additional shares` | `our common stock` | DECLARED · RECORD |
| WMT 2024 | `3-for-1` | `its common stock` | **EFFECTIVE** · DECLARED |
| NVDA 2024 | `ten-for-one` · `received nine additional shares` | `our issued common stock` | DECLARED · DISTRIBUTION · RECORD |

| field | 결과 |
|---|---|
| **candidate discovery** | **16 / 16** |
| **ratio/action 추출** | **16 / 16** |
| **raw affected-class 추출** | **16 / 16** |
| **explicit EFFECTIVE 날짜** | **7 / 16** |

## L5. §9 context boundary — 넓혀도 effective date는 안 나온다

```text
E0  hit 문장            (문장 경계)
E1  hit block           (HTML block-level 경계)
E2  그 문서의 후보 block 전체 합집합
E3  primary document 전문
```

| boundary | 날짜 하나라도 | **EFFECTIVE 역할** | ratio/action | class raw |
|---|---|---|---|---|
| **E0** | 15/16 | **7/16** | **16/16** | **16/16** |
| **E1** | 16/16 | **7/16** | 15/16 | 13/16 |
| **E2** | 16/16 | **7/16** | **16/16** | **16/16** |

**E0 → E1 → E2로 넓혀도 `EFFECTIVE`는 7/16에서 움직이지 않는다.**
class는 13 → 16, ratio는 15 → 16으로 나아진다.

**E3는 오히려 나쁘다.** 같은 16개 문서에서

| | E2 | **E3** |
|---|---|---|
| 추출된 날짜 총수 | 48 | **134** |
| 추출된 class 문구 총수 | 53 | **115** |

MA 2014는 날짜가 2개 → **23개**가 되고 GOOGL 2022는 class 문구가 4개 → 10개가 된다.
**전문을 읽으면 혼입만 늘고 빠진 field는 그대로다.**

> **§9의 답: `E2`(문서 안 후보 block의 합집합)가 최선이고, 그 경계는 HTML block 구조에서
> 나오므로 숫자 cutoff가 필요 없다.** `E3`는 추천하지 않는다.
> **그리고 어느 경계도 effective date 문제를 풀지 못한다 — 그것은 context 문제가 아니라
> 원문에 없는 문제다.**

**절 제목이 실제로 일한 사례가 하나 있다.** AAPL 2020의 공시 문단은
"On August 28, 2020, the Company effected a **four-for-one stock split** to shareholders of record
as of August 24, 2020"이고 **class를 한 번도 부르지 않는다.** 바로 앞 block이 절 제목
`Common Stock Split`이고, **거기서만 class scope가 나온다.** block 하나(E1)만 읽으면 class가
비고, 같은 문서의 후보 block을 합치면(E2) 제목이 들어와 채워진다.

## L6. effective date — 여기서 막힌다

### L6.1 9/16은 effective date를 아예 말하지 않는다

| event | 원문이 주는 날짜 역할 |
|---|---|
| MA 2014 | DECLARED · DISTRIBUTION |
| TSLA 2020 · TSLA 2022 · NVDA 2021 | DECLARED · RECORD |
| NVDA 2024 | DECLARED · DISTRIBUTION · RECORD |
| CMCSA 2017 | DECLARED · DISTRIBUTION · RECORD |
| V 2015 | DISTRIBUTION · RECORD · TRADING |
| NKE 2012 · NKE 2015 | DECLARED · DISTRIBUTION · RECORD · TRADING |

**NKE는 한 문단에 날짜가 네 개다** — 선언 11/15, 기준일 12/10, 지급일 12/24, 분할가 거래 개시
12/26. **원문은 그중 무엇이 share-basis regime 전환일인지 말하지 않는다.**
§10이 금지한 "가장 가까운 날짜" 같은 heuristic 없이는 고를 수 없다.
→ **`INSUFFICIENT`.**

### L6.2 명시된 7건조차 그 날짜가 price-basis 전환일이 아니다

| event | 원문의 EFFECTIVE 날짜 | 실제 price-basis 전환일 | 차이 |
|---|---|---|---|
| BRK 2010 | 2010-01-21 | 2010-01-21 | **0일** |
| UA 2012 | 2012-07-09 | 2012-07-10 | 1일 |
| UA 2014 | 2014-04-14 | 2014-04-15 | 1일 |
| AAPL 2014 | 2014-06-06 | 2014-06-09 | 3일 |
| AAPL 2020 | 2020-08-28 | 2020-08-31 | 3일 |
| GOOGL 2022 | 2022-07-15 | 2022-07-18 | 3일 |
| WMT 2024 | 2024-02-23 | 2024-02-26 | 3일 |

**7건 중 6건이 어긋난다(1~3일).** 원문의 "effective"는 **주식수 basis가 바뀐 날**이고,
`raw_close`의 단위가 바뀌는 날은 **그 다음 정규 세션**이다(Follow-up 3 H6).
**즉 추출한 `effective_date_raw`는 P2가 쓰는 regime 경계와 같은 값이 아니다.**

> P2의 구간 판정에서 1~3일 차이가 실제로 결과를 바꾸는 일은 드물지만,
> **`effective_date_raw`를 그대로 regime 경계로 쓰는 계약을 지금 freeze하면 그 어긋남이
> 조용히 들어간다.** 이 연구는 그 둘을 같은 것으로 취급하지 않는다.

## L7. §11 ratio / action semantics — 하나의 배수로 정규화되지 않는다

**16/16에서 ratio/action 문구가 나온다.** 형태는 다섯 가지다.

| 형태 | 예 | 건수 |
|---|---|---|
| `N-for-one` / `N-for-1` | `two-for-one` · `50-for-1` · `3-for-1` · `20-for-one` | 16 |
| `100% stock dividend` | `100 percent stock dividend` · `100% common stock dividend` | 5 |
| `dividend of N additional shares` | `dividend of three additional shares` | 4 |
| `N additional share(s) for each/every share held` | CMCSA · NVDA 2021 | 2 |
| `received N additional shares` | NVDA 2024 (`received nine additional shares`) | 1 |

**세 가지가 단일 배수 정규화를 막는다.**

1. **CMCSA 2017.** 원문은 "one additional share for every share held and was **payable in shares
   of Class A common stock on the existing Class A common stock and Class B common stock**"이다.
   **주식수가 늘어나는 class(A)와 배당을 받는 class(A·B)가 다르다.** Follow-up 4 J4.1이 실측한
   대로 Class A의 실제 소급 배수는 `2`가 아니라 `2.00399`(= `2×A + B`)다.
   **비율 하나로 이 event를 표현할 수 없다.** action text를 raw로 보존하고 `UNRESOLVED`로
   둘 수 있어야 한다.
2. **V 2015.** Class A는 `four-for-one`인데 **class B·C는 배당을 받지 않고 전환비율만
   1.6483·4.0으로 올랐다.** 한 event 안에 서로 다른 종류의 변화가 있다.
3. **TSLA 2022 문서에 비율이 둘이다** — `three-for-one`(2022 event)과 `five-for-one`(2020 event).
   **비율만으로는 어느 event인지 정해지지 않는다.** 반드시 같은 span의 날짜와 묶여야 한다.

**P3용 conversion factor는 이번에 만들지 않았다**(§11·§19).

## L8. §12 class wording — raw까지만, semantic shape는 사람이 판정

**수집한 raw 문구를 사람이 네 shape로 판정했다. `class_id`로 자동 매핑하지 않았다.**

| shape | 뜻 | 건수 | 예 |
|---|---|---|---|
| `EXACT_ONE` | 정확히 한 class를 지목 | **2** | BRK `Class B` (+ "Class A ... had no effect" 명시) · V `its class A common stock` (+ "Holders of class B and C ... did not receive") |
| `EXPLICIT_MULTI` | 둘 이상을 명시 | **6** | UA 2012·2014 `Class A and Class B common stock` · NKE 2012·2015 `Class A and Class B` · MA `Class A and Class B common shares` · GOOGL `Class A, Class B, and Class C stock` |
| `ALL_COMMON` | class 한정 없이 `common stock` | **7** | AAPL 2014 `its common stock` · AAPL 2020 `Common Stock`(절 제목) · TSLA 2020·2022 `our common stock` · NVDA 2021 `our common stock` · NVDA 2024 `our issued common stock` · WMT 2024 `its common stock` |
| `SPLIT_ROLE` | 늘어나는 class와 받는 class가 다름 | **1** | CMCSA 2017 |

**`ALL_COMMON` 7건이 이 계약의 숨은 의존이다.** `our common stock`은 **그 시점에 common class가
정확히 하나일 때만** 모호하지 않다. 이 표본에서는 7건 모두 단일 class 발행사(AAPL·TSLA·NVDA·WMT)라
문제가 없지만, **multi-class 발행사가 `our common stock`이라고 쓰면 shape는 `AMBIGUOUS`이고
`UNRESOLVED`여야 한다.** 판정 근거는 텍스트가 아니라 **identity 층의 class universe**다
(Follow-up 2 G7의 dimensionless 계약과 같은 자리).

**raw 문구가 registry 이름과 다르다는 것도 그대로 확인됐다.**
UA의 원문 `Class B common stock`은 registry의 `CONV`이고, UA가 2016년에 만든 `Class C`와
다른 class다. **string equality·fuzzy·ordinal 매칭을 하지 않았고 이번에 해결하지도 않았다**(§12·§19).

## L9. §13 issuer / investee scope

같은 문서 안에서 registrant 자신의 event가 아닌 언급을 무엇으로 가르는지 조사했다.

| 근거 | 신호 | 이 표본에서 |
|---|---|---|
| **문서 종류** | primary document vs exhibit | **가장 강한 구분자** — L10 |
| **주어** | `the Company` · `we` · `our` · `the registrant` | 16 anchor의 후보 block 전부에서 registrant 주어가 나온다 |
| **plan 어휘** | `the Plan` · `Award` · `Participant` · `the Committee` · `equity incentive` | TSLA 2022의 old-event span이 `PLAN` scope로 잡힌다 |
| **investee 어휘** | `equity method` · `investee` · `joint venture` · `subsidiary` · 회사명 | Follow-up 3 I10.2의 BRK/Kraft Heinz XBRL 오염과 같은 자리 |

**issuer scope가 명시적이지 않으면 `INSUFFICIENT`다**(§13). 다만 **이 표본에서 텍스트 쪽
investee 오염 사례는 나오지 않았다** — XBRL 태그에서는 났지만(BRK `0.443332` Kraft Heinz),
본문 후보 span에서는 registrant 주어가 항상 있었다. **없다는 것을 증명한 것이 아니라
이 표본에서 관측되지 않았다는 뜻이다.**

## L10. §7 false-positive anchor 전수 재분류

Follow-up 4 J6.2의 11건(event 없는 K/Q에서 `stock split`이 울린 것)과
J6b.1의 old-event 재공시 3건을 block 단위로 다시 열었다. **후보 span 145개**가 나온다.

| | primary document | **exhibit(비-primary)** |
|---|---|---|
| false positive span | **8** | **90** |
| old-event 재공시 span | **8** | **39** |

> **첫 번째 구분자는 문서 종류다.** false-positive span의 **92%(90/98)가 exhibit**에 있다 —
> 주식보상 plan 문서(EX-10.x)의 반희석 조항과 XBRL taxonomy 설명문이다.
> **primary document로 좁히면 후보 표면이 그만큼 사라진다.** 이것은 문턱이 아니라
> 문서 구조에 근거한 구분이다.

### L10.1 A · B — 가정법 boilerplate와 taxonomy 설명문

exhibit span 90개 중 status가 `HYPOTHETICAL`이거나 아무 status도 없는 것이 대부분이다.
전형 문구는 이렇다.

> HD `0000354950-12-...` EX-10: "**In the event of** any stock dividend, stock split, combination
> or exchange of shares, recapitalization or other change in the capital structure of the Company …"
> ABBV `0001551152-24-...`: "revisions for stock splits, reverse stock splits, stock dividends,
> or other changes in capital structure" (XBRL 분류 안내문)

**이들은 날짜가 없고 가정법이다.** required field(effective date)가 없으므로
`INSUFFICIENT`이고, 문서 종류·가정법 어휘로 `NON_EVENT`까지 갈 수 있다.

### L10.2 C — 실행되지 않은 proposal (META Class C Reclassification)

**primary document에 남는 false-positive span 8개는 전부 META다.**

| accession | block | status | **날짜** |
|---|---|---|---|
| `0001326801-16-000067` b1200 | | `INTENDED` `NO_ASSURANCE` | **없음** |
| `0001326801-16-000067` b1967 | | `ANNOUNCED` `NO_ASSURANCE` | **없음** |
| `0001326801-16-000082` b1287 · b1292 · b2408 | | `ANNOUNCED` `INTENDED` `NO_ASSURANCE` / `DECLARED` | **없음** |
| `0001326801-17-000024` b1049 · b1054 · b1957 | | 〃 | **없음** |

원문:

> "our board of directors **intends to** issue two shares of the Class C capital stock as a
> one-time stock dividend for each share of Class A and Class B common stock outstanding.
> **The record and payment dates for this dividend will be determined by our board of directors
> in its discretion and there can be no assurance as to the timing of such dates.**"

**8개 span 전부 날짜가 하나도 없다.** required field 규칙 하나로 `CONFIRMED`가 될 수 없다.
**따로 'proposal 탐지기'를 만들 필요가 없다** — effective date를 required로 두면 자동으로 걸린다.

### L10.3 D — old-event 재공시는 텍스트로 못 가른다. 날짜로 가른다

old-event 재공시 span은 **field가 전부 채워져 있다.** 현재 event와 텍스트로 구별되지 않는다.

| filing | 접수일 | 추출된 날짜 | 접수일과의 간격 |
|---|---|---|---|
| UA `0001336917-14-000008` 10-K b597 | 2014-02-21 | DECLARED 2012-06-11 · DISTRIBUTION 2012-07-09 | **620일 · 592일** |
| NKE `0000320187-15-000113` 10-K b959 | 2015-07-23 | DECLARED 2012-11-15 · RECORD 2012-12-10 · DISTRIBUTION 2012-12-24 · TRADING 2012-12-26 | **980 · 955 · 941 · 939일** |
| TSLA `0000950170-22-006034` 10-Q b1950 | 2022-04-22 | (날짜 없음) scope=`PLAN` | — |

> **§7이 요구한 설명이 이것이다.** old-event 재공시가 `NON_EVENT`가 되는 이유는 문체가 아니라
> **추출된 날짜가 그 관측의 `(lo, hi]` 구간 밖이기 때문**이다. 판정은 temporal linking이고,
> 그것은 **추출된 날짜가 있어야만 가능하다.** L6의 9/16이 여기서 두 번째로 아프다 —
> **날짜가 없으면 old-event와 새 event를 가를 방법도 없다.**

TSLA의 old-event span은 날짜조차 없지만 `PLAN` scope로 잡힌다(CEO 보상 약정 문맥).

## L11. §15 negative scan — `COMPLETE SEARCH` 전수 분류

**1,225 accession 전부를 훑었다.** 문턱으로 후보를 잘라내지 않았다.

| | 값 |
|---|---|
| searched accession | **1,225** (파싱 실패 0) |
| candidate accession | **1,000** (전체 문서 기준) · **349** (primary document만) |
| **candidate span** | **7,482** |
| ├ primary document | **714 (9.5%)** |
| └ exhibit | **6,768 (90.5%)** |

**후보의 90.5%가 exhibit에 있다.** L10이 14개 anchor에서 본 비율(92%)이 전수에서도 그대로다.

### L11.1 span 전수 분류

| 분류 | span | primary | exhibit |
|---|---|---|---|
| `INSUFFICIENT_NO_DATE` — 날짜가 하나도 없다 | **5,128** | 421 | 4,707 |
| `HYPOTHETICAL_BOILERPLATE` — 가정법 반희석 조항 | 1,384 | 5 | 1,379 |
| `UNRELATED_ENTITY_OR_PLAN` — registrant 주어 없이 plan/investee 문맥 | 358 | 98 | 260 |
| `PROPOSAL_NO_DATE` — `INTENDED`/`NO_ASSURANCE` + 날짜 없음 | 173 | 40 | 133 |
| `DATE_PRESENT_NO_KNOWN_EVENT` | 153 | 55 | 98 |
| `OLD_EVENT_REDISCLOSURE` — 날짜가 알려진 event지만 오래됐다 | 143 | 49 | 94 |
| **`TRUE_CURRENT_EVENT`** | **107** | 34 | 73 |
| `TRUE_EVENT_INSUFFICIENT_FIELDS` — event는 맞는데 ratio/class 결손 | 36 | 12 | 24 |

**분류 규칙에 숫자 문턱이 없다.** 문서 종류 · 가정법 어휘 · 주어 scope · **날짜의 유무와 값**만 쓴다.

### L11.2 `DATE_PRESENT_NO_KNOWN_EVENT` 153건을 끝까지 열었다

**이 칸이 유일하게 '모르는 event'가 숨을 수 있는 자리다.** 전수를 세분했다.

| 세분 | primary | exhibit |
|---|---|---|
| **알려진 event의 선(先)공시** — ex-date 이전에 이미 공시 | 22 | 34 |
| `ratio/action` 없음 — 현금배당 · 자사주매입 · 주주 수 등 잡음 | 22 | 46 |
| 2009 이전 event의 재공시(표본 밖) | 3 | 3 |
| **그 밖 — 사람이 확인** | 8 | 15 |

**세 가지가 여기서 나온다.**

1. **선(先)공시 56건은 오히려 좋은 소식이다.** AAPL `10-Q 2020-07-30`은 ex-date(08-31)보다
   32일 먼저 "announced a four-for-one split … to shareholders of record as of … August 24, 2020"을
   싣고, GOOGL `10-K 2022-02-01`·NVDA `10-Q 2021-05-26`·`10-Q 2024-05-29`·TSLA·V도 같다.
   **강제 K/Q 경로가 ex-date 전에도 event를 올린다.** 다만 그 시점 공시는 승인 조건부라
   `NO_ASSURANCE`·`INTENDED`를 달고 있어 `CONFIRMED`가 되면 안 된다 — L10.2의 META와 같은 규칙이
   그대로 작동한다.
2. **`ratio/action`이 없는 68건은 전부 share-basis와 무관하다** — WMT의 현금배당 증액
   ("declared an annual dividend for fiscal 2012 of $1.46 per share"), Ford의 자사주매입·
   전환권 종료·주주 수 등이다. `declared/approved/distributed` 표현군이 날짜와 함께 잡은 것이고,
   **ratio/action을 required로 두면 자동으로 걸러진다.**
3. **'그 밖' 23건은 전부 UA 하나의 공시다**(고유 문장 2개 · accession 7개).

> **UA `10-Q 2016-04-29`:** "On March 16, 2016, the Board of Directors approved the issuance of the
> Company's **new Class C non-voting common stock**. The Class C stock was **issued through a stock
> dividend on a one-for-one basis to all existing holders of the Company's Class A and Class B
> common stock**"

**이것이 Follow-up 3이 vendor feed로는 못 풀던 바로 그 사건이다.** H4·H5는 UA `2016-04-08`에
vendor가 `×2`를 실었지만 Class A 주식수는 `181,646,468 → 183,141,109`(×1.008)로 그대로여서
`NO_SHARE_EFFECT`로 판정했고, **왜 그런지는 주식수 시계열로만 추론했다.**
**본문은 이유를 직접 말한다 — 새 class를 1:1로 배당한 것이지 기존 class를 쪼갠 것이 아니다.**
가격은 조정되지만 기존 class의 share basis는 바뀌지 않는다.

> **§15의 결론: 전수 7,482 span 어디에도 '알려지지 않은 share-basis event'는 없었다.**
> 모두 (a) 알려진 event의 현재·선·과거 공시, (b) 2009 이전 event, (c) 새 class 배당 1건,
> (d) ratio 없는 잡음, (e) 가정법 boilerplate로 해소된다.
> **다만 이것은 detector가 완전하다는 증명이 아니라 이 표본에서 반증이 나오지 않았다는 뜻이다**
> (Follow-up 3 I10.2와 같은 한계).

### L11.3 required field를 켜면 남는 양

`ratio/action` + `날짜` + `registrant scope`를 required로 두고 primary document로 좁히면,
**7,482 span 중 사람이나 승인 규칙이 실제로 다뤄야 할 span은 primary 기준 150건 남짓**이다
(`TRUE_CURRENT_EVENT` 34 + `OLD_EVENT_REDISCLOSURE` 49 + `DATE_PRESENT_NO_KNOWN_EVENT` 55 +
`TRUE_EVENT_INSUFFICIENT_FIELDS` 12). **1,225 filing에 걸쳐 150건이면 문턱 없이 감당된다.**

## L12. §16 reverse-split CONTROL

**선정 기준을 결과보다 먼저 고정했다.** (스크래치 `CONTROL_CRITERIA.md`에 원문이 남아 있다.)

```text
1. 미국 등록인이고 EDGAR에 10-K/10-Q를 제출한다
2. reverse split의 effective date가 2009-01-01 ~ 2026-06-30
3. 시대를 넷으로 나눠 각 1개: 2009-2012 / 2013-2016 / 2017-2021 / 2022-2026
4. 기존 QV 20 issuer와 겹치지 않는다
5. 네 비율이 서로 다르다
6. 고른 뒤 결과를 보고 교체하지 않는다. 확인 실패면 '선정 실패'로 그대로 보고한다
7. CONTROL 결과를 525-grid 통계에 합치지 않는다
```

고정한 넷: **AIG(2009-2012) · Peabody Energy BTU(2013-2016) · GE(2017-2021) ·
Sirius XM SIRI(2022-2026).**

| control | 대역 filing | 후보 span | **EFFECTIVE span** | 결과 |
|---|---|---|---|---|
| **AIG** | 16 | 10 | **3** | **EXTRACTABLE** |
| **BTU** | 16 | 30 | **16** | **EXTRACTABLE** |
| **GE** | 20 | 4 | **0** | **INSUFFICIENT** |
| **SIRI** | 18 | 6 | **0** | **선정 실패 + INSUFFICIENT** |

**AIG** — `10-K 0001047469-10-001465`:
> "as adjusted for the **one-for-twenty reverse split** of AIG's Common Stock **effective
> June 30, 2009**"
→ ratio `one-for-twenty` · EFFECTIVE `2009-06-30` · class `common stock`. **필드가 다 나온다.**

**BTU** — `10-Q 0001064728-15-000098`:
> "Pursuant to the authorization provided at a special meeting of the Company's stockholders held
> on September 16, 2015, the Company **completed a 1-for-15 reverse stock split** of the shares of
> the Company's common stock **on September 30, 2015** (the Reverse Stock Split). As a result …
> **every 15 shares** of issued and outstanding common stock …"
→ ratio `1-for-15` · EFFECTIVE `2015-09-30` · class `common stock` · status `COMPLETED`·`RETROACTIVE`.

**BTU는 proposal 단계도 함께 보여준다.** 같은 발행사의 `10-Q 2015-08-07`은
> "the Board … approved **seeking shareholder approval** to implement a reverse stock split …
> **at a ratio to be determined later** … **there can be no assurance**"
→ **비율이 범위(`one-for-eight` ~ `one-for-20`)이고 날짜가 없다.** → `INSUFFICIENT`.
**META와 같은 모양이 reverse 계열에서도 그대로 재현된다.**

**GE** — `10-Q 0000040545-21-000064`:
> "we announced that we would proceed with the **1-for-8 reverse stock split**, as approved by
> shareholders, and filed an amendment to our certificate of incorporation **to effectuate the
> reverse stock split after the close of trading on July 30, 2021**. GE common stock **began
> trading on a split-adjusted basis on August 2, 2021**."
→ ratio `1-for-8` · class `common stock` · **TRADING 날짜만 있고 EFFECTIVE 역할이 없다.**
**L6.1의 9/16과 정확히 같은 모양이다.**

**SIRI — 선정 실패다.** 2024년 거래는 지주사 재편이고 본문은 split이 아니라 전환으로 적는다.
> "All share and per share amounts have been adjusted to reflect the **conversion of Old Sirius
> shares into SplitCo common stock on a one-for-ten basis.**"
→ **`split` 단어가 없고 `one-for-ten` 비율 표현으로만 잡힌다. 날짜도 action type도 없다.**
기준 6에 따라 교체하지 않고 그대로 보고한다.

> **CONTROL이 준 것 셋.**
> 1. **추출기 shape는 reverse wording에 그대로 적용된다** — `one-for-N`·`1-for-N`이 잡히고
>    `completed … on X`가 EFFECTIVE로 잡힌다(AIG·BTU).
> 2. **effective date 결손은 forward 전용 문제가 아니다** — GE가 4/4 중 하나로 같은 구멍을 낸다.
> 3. **표현군을 forward 표본으로 고르면 안 된다** — SIRI는 `stock split`·`reverse split` 어느
>    쪽에도 안 걸리고 **비율 표현으로만 surface된다.**

## L13. §14 amendment

`SEARCH` 대상 1,225건에 `10-K/A` 19 · `10-Q/A` 3이 들어 있다. **Follow-up 4 correction의 계약을
그대로 유지했다** — amendment는 evidence로 읽되 `CLOSURE`가 아니고, **amendment의 접수일이
event의 effective date를 재정의하지 않는다.**

이번 후보 분류에서도 amendment는 특별 취급하지 않았다. 다만 L10.3의 old-event 판정이
amendment에 그대로 걸린다 — **원 filing 내용을 그대로 재제출한 amendment의 span은 추출된 날짜가
과거이므로 새 event가 되지 않는다.**

## L14. ground truth 확인 범위

**§9·F14·G15·H14·I13·J9·K9와 같은 기준이다. 520 관측 전부를 사람이 원문과 1:1 대조하지 않았다.**

| 대상 | 원문 | 결과 |
|---|---|---|
| known positive 16건의 후보 span과 field | 각 accession primary document 직접 파싱 | L4 표 — **16건 전부 사람이 읽었다** |
| false-positive 11건 · old-event 3건의 span 145개 | 각 accession 전체 문서 직접 파싱 | L10 — **primary 16 span은 사람이 전수로 읽었다** |
| CONTROL 4개 | AIG·BTU·GE·SIRI의 대역 K/Q primary document | L12 — **인용문 전부 사람이 읽었다** |
| effective date와 ex-date의 차이 | Follow-up 3이 확정한 ex-date와 대조 | L6.2 |
| CMCSA의 `2×A + B` | Follow-up 4 J4.1을 그대로 인용 | L7 — 이번에 다시 계산하지 않았다 |

**기계로만 검증한 것**: 1,225 accession의 후보 span 7,482개 분류(L11), 표현군 count(L3.1),
E0~E3 field count(L5). **다만 L11.2의 `DATE_PRESENT_NO_KNOWN_EVENT` 153건은 세분 결과를
사람이 전수로 읽었고, 그중 '그 밖' 23건(UA 공시 1건)은 원문을 직접 확인했다.**

**이번 연구가 쓴 정규식은 전부 '역할 문구' 앵커이고 숫자 문턱이 없다.**
`text[:1800]` 같은 저장 길이 제한은 스크래치 파일 크기 문제이고 판정에 쓰이지 않는다.
**L3의 block 경계는 HTML block-level 태그이지 문장 수·토큰 수가 아니다.**

**정직하게 적을 한계 넷.**

1. **추출기는 연구용이다.** 정규식 집합은 이 표본을 보며 두 번 고쳤다
   (`3-for-1` 같은 숫자 비율, `completed … on X` 형태). **표본 밖에서 같은 recall이 나온다는
   보장이 없다.** 다만 두 수정 모두 *표현 형태*를 넓힌 것이고 문턱을 조정한 것이 아니다.
2. **`EFFECTIVE` 7/16은 이 정규식 집합 기준이다.** 더 넓은 패턴이 몇 건을 더 건질 가능성은
   남아 있다. **그러나 NKE·V·CMCSA는 사람이 읽어도 effective date라는 말이 없다** — 그 셋은
   패턴 문제가 아니다.
3. **표본이 20 발행사 + CONTROL 4개다.** S&P 500 전체, 특히 소형주에서 같은지 확인하지 않았다.
4. **텍스트 investee 오염 사례가 0건**인 것은 없다는 증명이 아니다(L9).

## L15. 이번에 결정하지 않은 것 (§19)

1. prose class-name → `class_id` PIT mapping schema — **손대지 않았다.**
2. event ledger SQL schema · production enum
3. production extractor 구현
4. P2 final freeze
5. P3 normalization · conversion factor
6. `SPLIT_RATIO_MISMATCH`·`UNEXPLAINED_NO_EVENT` 잔여 22건
7. `CONVERSION_VALUE_PROXY` (V 2015의 1.6483·4.0을 raw로 기록만 했다)
8. Gate C · `coverage_start` · B/M · rank · returns

## User decision — explicit corporate-action disclosure extraction

추천: **B — candidate discovery는 freeze 가능하지만 structured extraction의 일부 field가
아직 불충분하다.**

§18이 A에 요구한 항목별로 적는다.

| 요구 | 결과 |
|---|---|
| known positive 16/16 candidate discovery | **충족 (16/16)** |
| **effective date extraction 16/16** | **미충족 — 7/16** |
| action/ratio extraction 16/16 | **충족 (16/16)** |
| raw affected-class scope extraction 16/16 | **충족 (16/16)** |
| old-event 3건을 새 event로 승격하지 않음 | **충족** — 단, **추출된 날짜에 의존한다**(L10.3) |
| META 미실행 proposal을 confirmed로 승격하지 않음 | **충족** — 8 span 전부 날짜 0개(L10.2) |
| boilerplate를 confirmed로 승격하지 않음 | **충족** — 92%가 exhibit이고 가정법·무날짜(L10.1) |
| reverse-split controls에서 같은 구조가 작동 | **부분 충족** — AIG·BTU는 EXTRACTABLE, **GE는 forward와 똑같이 effective date가 없다**, SIRI는 선정 실패(L12) |

**A가 아닌 이유는 하나로 좁혀진다.**

> **네 required field 중 셋은 16/16이고, `effective_date_raw`만 7/16이다.**
> 그리고 그 결손은 **context를 넓혀서 해결되지 않는다** — E0·E1·E2 모두 7/16이고
> E3는 혼입만 늘린다(L5). **원문에 없는 것이다.**

**C가 아닌 이유.** "K/Q prose가 너무 비정형적"이라는 진단은 증거와 맞지 않는다.
후보 표면은 문서당 block 1~18개로 매우 희소하고(L3), ratio·class는 16/16이며,
boilerplate·proposal·old-event는 **문서 종류 · 가정법 어휘 · 날짜 부재 · temporal linking**이라는
**결정론적이고 문턱 없는** 규칙으로 갈린다(L10). **문제는 산문의 비정형성이 아니라
특정 field 하나가 원문에 자주 없다는 것이다.** 진단이 다르면 다음 작업도 달라진다.

### freeze할 수 있는 것 (discovery 계약)

```text
DISCOVERY
  단위      HTML block-level 경계 (p·div·td·tr·li·h1~h6·table …)
            문장 수·토큰 수 cutoff를 쓰지 않는다
  범위      COMPLETE SEARCH 대상 K/Q family의 문서
            primary document와 exhibit을 반드시 구분해 기록한다
  표현군    action 명사와 비율 형태를 함께 켠다
            stock split · reverse (stock) split · stock/share dividend
            split-up/subdivision · combination/consolidation of shares
            recapitalization · reclassification
            N-for-one / N-for-1 · one-for-N / 1-for-N
            additional share(s) for each/every share held
  성질      candidate는 event가 아니다. 문턱으로 잘라내지 않는다.
```

**비율 형태를 반드시 포함해야 하는 근거는 forward 표본이 아니라 CONTROL이다** —
SIRI의 10:1 주식수 변경은 `split`이라는 단어 없이 `one-for-ten`으로만 나온다(L12).

### freeze할 수 없는 것 (extraction 계약)

```text
required field 넷 중
    ratio_or_action_raw          16/16   OK
    affected_class_names_raw[]   16/16   OK  (단 semantic shape 판정은 identity 층 의존)
    disclosure_status_raw        OK      (COMPLETED/RETROACTIVE/INTENDED/NO_ASSURANCE/HYPOTHETICAL)
    effective_date_raw            7/16   **부족**
```

**effective date가 왜 부족한지 두 층이다.**

1. **9/16은 effective date를 아예 말하지 않는다.** 대신 DECLARED·RECORD·DISTRIBUTION·TRADING을
   섞어 주고 **어느 것이 share-basis 전환일인지 지목하지 않는다.** NKE는 한 문단에 네 개다.
   §10이 금지한 "가장 가까운 날짜" 없이는 못 고른다 → `INSUFFICIENT`.
2. **명시된 7건조차 그 날짜가 P2가 쓰는 경계와 다르다.** 6/7에서 1~3일 어긋난다 —
   원문의 "effective"는 주식수 basis 전환일이고 `raw_close` 단위는 그 다음 정규 세션에 바뀐다(L6.2).

### 그래서 다음에 결정해야 할 것

**이 연구는 답을 고르지 않는다. 선택지가 셋이고 성격이 다르다는 것까지만 적는다.**

1. **`effective_date_raw`를 required에서 빼고 `date_cluster_raw`(역할 라벨이 붙은 날짜 집합)를
   required로 둔다.** 그러면 16/16이 된다. 대신 **어느 날짜가 regime 경계인지를 정하는 규칙이
   따로 필요하고, 그 규칙은 텍스트 밖에서 와야 한다.**
2. **regime 경계를 텍스트가 아니라 다른 정본에서 가져온다.** Follow-up 3 H6이 `raw_close`의
   단위가 ex-date에 바뀐다는 것을 이미 실측했다. **다만 CLOSED 계약은 share-count jump와
   vendor ratio만으로 event를 *승인*하는 것을 금지한다** — 존재·비율·class는 명시 공시로
   승인하고 **경계 날짜만** 다른 정본에서 받는 것이 그 금지에 걸리는지는 **별도 결정이다.**
   이번에 그 선을 넘지 않았다.
3. **effective date가 없으면 그대로 `UNRESOLVED`로 두고 fail-close한다.** 가장 안전하지만
   **16 anchor 중 9건이 fail-close되고, 그중 MA 2014·CMCSA 2017처럼 P0가 조용히 10배·0.2%
   틀리던 관측이 포함된다.** 즉 P2의 실효 coverage가 크게 준다.

**셋 중 무엇을 고르든 그것은 extraction 계약이 아니라 regime-boundary 계약이다.**
그 결정 전에는 `event classification` 축을 freeze할 수 없다.

### 함께 기억할 것 넷

1. **후보 표면은 걱정할 만큼 넓지 않다.** 문서당 block 1~18개이고, event 없는 K/Q의 97.2%는
   `stock split`이 한 번도 안 나온다(Follow-up 4 J6.2). **문턱을 만들 이유가 없다.**
2. **false positive의 92%가 exhibit에 있다.** primary document 구분은 문턱이 아니라 문서
   구조이고, 가장 강한 단일 구분자다(L10).
3. **old-event 재공시는 문체로 못 가른다.** field가 전부 채워져 있고 **날짜만 다르다**(L10.3).
   **날짜 추출이 실패하면 old-event 방어도 함께 실패한다** — effective date 결손이 두 번 아프다.
4. **비율 하나로 정규화되지 않는 event가 실재한다.** CMCSA 2017은 늘어나는 class와 받는 class가
   다르고 실제 배수가 `2`가 아니라 `2.00399`이며, V 2015는 한 event 안에서 A는 split, B·C는
   전환비율 조정이다. **action text를 raw로 보존하고 `UNRESOLVED`로 둘 수 있어야 한다**(L7).

**이 follow-up도 research 결과일 뿐 아직 CLOSED/FROZEN 계약이 아니다.**

# Follow-up 6 — share / valuation regime boundary (2026-08-30)

> **Status: RESEARCH EVIDENCE ONLY.** 위 여덟 절과 같다. 설계 승인·freeze가 아니고 production
> code/schema/test/roadmap의 의미를 바꾸지 않는다. Gate · `coverage_start` · B/M · rank ·
> returns는 이번에도 계산하지 않았고 production DB에 쓰지 않았다. `eodhd.py`를 수정하지 않았고
> scratch에서 read-only 호출만 했다.

시작 main: `d853725ac45a487ae4adf5cb3a809fea017ef73b`
(`docs(memory): add XION research corpus`). 마지막 QV 커밋은
`2f113ed research(qv): corporate-action disclosure extraction을 검증한다`이고,
**그 뒤 `c323d15`·`d853725`는 `lib/assistant-retrieval-shadow.js` · `test/assistant-retrieval.test.js` ·
`docs/Memory research/**`만 건드렸다.** `git log 2f113ed..HEAD -- trading/ docs/trading/`이 비어 있음을
확인했고, memory 파일을 수정·정리·revert하지 않았다.

**이번에 다시 열지 않은 것.** ME 정의(listed = shares × December `raw_close`, unlisted은
fixed direct conversion mapping이 있을 때만 proxy, 그 외 MISSING, `adjusted_close` 금지) ·
share fact source와 A→B hierarchy · freshness · D0 · **share basis anchor = source filing
acceptance/release regime** · Follow-up 5의 DISCOVERY 계약 · `CLOSURE`/`SEARCH`와 amendment
evidence-only · event ledger 두 축 · vendor 부재를 no-event로 쓰는 것 금지 · vendor ratio나
share-count jump만으로 승인 금지 · issuer-wide 전파 금지 · percentage tolerance 금지 ·
P3 normalization.

## M1. 이번 질문 하나

> **confirmed class-level share-basis event에 대해, 어느 시점부터 December ME의 per-share
> valuation unit이 post-action basis라고 말할 수 있는가?**

이것을 `VALUATION_REGIME_BOUNDARY`라고 부른다.
**SEC legal/effective date와 raw market-price basis change date를 같은 것으로 가정하지 않는다.**

## M2. 두 종류의 시간을 분리한다

Follow-up 5가 뽑은 role-labeled date를 그대로 쓰되, **하나의 `event_date`로 뭉개지 않는다.**

```text
SEC 공시 쪽        DECLARED · RECORD · DISTRIBUTION/PAYMENT · EFFECTIVE · TRADING_SPLIT_ADJUSTED
market/vendor 쪽   vendor split_date · 그 이상의 첫 정규 세션 · 그 주변 raw bar
```

**Follow-up 5의 결과를 재현했고 더 강해졌다.** confirmed 16 event의 listed class 17행에서
SEC `EFFECTIVE`/`DISTRIBUTION`과 market boundary의 차이는 이렇다.

| 차이(일) | 건수 |
|---|---|
| **0** | **1** (BRK 2010만) |
| 1 | 6 |
| 2 | 1 |
| 3 | 6 |
| 4 | 1 |
| **−18** | **1 (오염 — M8.2)** |

**17건 중 16건에서 SEC의 share-side 날짜는 market boundary보다 1~4일 앞선다.**

## M3. semantic target과 그 source

§5의 target은 **"raw market price가 post-action per-share basis로 표현된 첫 정규 세션"**이다.
법적 효력일 자체가 아니라 **ME에서 곱하는 `raw_close`의 단위가 바뀐 첫 세션**이다.

> **그래서 SEC `EFFECTIVE`는 이 target의 답이 아니다.** SAB 4.C가 규율하는 것은
> **주식수(share-side) basis**이고, `raw_close`의 단위는 거래소가 split-adjusted 거래를 시작한
> 세션에 바뀐다. **두 날짜는 구조적으로 다른 사건이고 이 표본에서 16/17이 실제로 다르다.**

## M4. §6 EODHD split source — READ ONLY 확인

현재 credential로 직접 호출했다(조회일 **2026-08-30**).

| endpoint | 결과 |
|---|---|
| `GET https://eodhd.com/api/splits/{SYMBOL}.US` | **HTTP 200 · 사용 가능** |
| `GET https://eodhd.com/api/calendar/splits` | **HTTP 403 Forbidden — 이 plan에서 사용 불가** |

**작업지시 §6이 적은 필드명과 실제 응답이 다르다.**

```text
작업지시가 가정한 필드   split_date · old_shares · new_shares
실제 응답 필드           date · split      (split은 "new/old" 문자열)

예)  AAPL  {"date": "2014-06-09", "split": "7.000000/1.000000"}
     AIG   {"date": "2009-07-01", "split": "1.000000/20.000000"}   <- reverse
     GE    {"date": "2021-08-02", "split": "1.000000/8.000000"}    <- reverse
```

`old_shares`/`new_shares`는 이 endpoint가 주지 않는다. **`split` 문자열의 분자/분모가 new/old다**
(AIG `1/20` = 1-for-20 reverse로 확인).

**vendor row는 market-boundary candidate / corroboration으로만 썼다.** SEC가 승인하지 않은
event를 vendor row 하나로 승격한 곳은 없다.

## M5. §7 confirmed 16 event — listed boundary 전수

`boundary session`은 `bars_daily`(SPY) 정규 세션 달력에서 `vendor split_date` 이상의 첫 세션이다.
표본의 모든 `split_date`가 이미 정규 세션이라 둘이 같다.

| issuer | class | listed | SEC EFFECTIVE | SEC DISTRIB | SEC TRADING | vendor split_date | new/old | boundary session |
|---|---|---|---|---|---|---|---|---|
| AAPL | SOLE | O | 2014-06-06 | — | — | 2014-06-09 | 7/1 | 2014-06-09 |
| AAPL | SOLE | O | 2020-08-28 | — | — | 2020-08-31 | 4/1 | 2020-08-31 |
| BRK | B | O | **2010-01-21** | — | — | 2010-01-21 | 50/1 | 2010-01-21 |
| CMCSA | A | O | — | 2017-02-17 | — | 2017-02-21 | 2/1 | 2017-02-21 |
| GOOGL | A | O | 2022-07-15 | — | — | 2022-07-18 | 20/1 | 2022-07-18 |
| GOOGL | **B** | **—** | 2022-07-15 | — | — | **없음** | — | **없음** |
| GOOGL | C | O | 2022-07-15 | — | — | 2022-07-18 | 20/1 | 2022-07-18 |
| MA | A | O | — | 2014-01-21 | — | 2014-01-22 | 10/1 | 2014-01-22 |
| MA | **B** | **—** | — | 2014-01-21 | — | **없음** | — | **없음** |
| NKE | **A** | **—** | — | 2012-12-24 | **2012-12-26** | **없음** | — | **없음** |
| NKE | B | O | — | 2012-12-24 | **2012-12-26** | 2012-12-26 | 2/1 | 2012-12-26 |
| NKE | **A** | **—** | — | 2015-12-23 | **2015-12-24** | **없음** | — | **없음** |
| NKE | B | O | — | 2015-12-23 | **2015-12-24** | 2015-12-24 | 2/1 | 2015-12-24 |
| NVDA | SOLE | O | — | — | — | 2021-07-20 | 4/1 | 2021-07-20 |
| NVDA | SOLE | O | — | 2024-06-07 | — | 2024-06-10 | 10/1 | 2024-06-10 |
| TSLA | SOLE | O | — | — | — | 2020-08-31 | 5/1 | 2020-08-31 |
| TSLA | SOLE | O | — | — | — | 2022-08-25 | 3/1 | 2022-08-25 |
| UA | A | O | 2012-07-09 | 2012-07-09 | — | 2012-07-10 | 2/1 | 2012-07-10 |
| UA | **CONV** | **—** | 2012-07-09 | 2012-07-09 | — | **없음** | — | **없음** |
| UA | A | O | 2014-04-14 | 2014-04-14 | — | 2014-04-15 | 2/1 | 2014-04-15 |
| UA | **CONV** | **—** | 2014-04-14 | 2014-04-14 | — | **없음** | — | **없음** |
| V | A | O | — | 2015-03-18 | **2015-03-19** | 2015-03-19 | 4/1 | 2015-03-19 |
| WMT | SOLE | O | 2024-02-23 | — | — | 2024-02-26 | 3/1 | 2024-02-26 |

**두 source가 모두 있는 event에서 `SEC TRADING == vendor split_date`가 3/3으로 일치한다**
(NKE 2012 · NKE 2015 · V 2015). **불일치는 0건이다.**

**availability는 크게 다르다.**

| source | listed 17행 중 사용 가능 |
|---|---|
| SEC `EFFECTIVE` | **8** |
| SEC `TRADING` | **3** |
| vendor `split_date` | **17** |

## M6. §8 raw price diagnostic — 승인이 아니라 진단

각 listed class에서 boundary 직전 세션 · boundary 세션 · 그 다음 세션의 `raw_close`를 직접 읽었다.

| issuer | class | boundary | prev raw | **boundary raw** | prev/bound | 승인 ratio | prev adj | bound adj |
|---|---|---|---|---|---|---|---|---|
| AAPL | SOLE | 2014-06-09 | 645.57 | **93.70** | 6.89 | ×7 | 20.22 | 20.54 |
| AAPL | SOLE | 2020-08-31 | 499.23 | **129.04** | 3.87 | ×4 | 121.06 | 125.17 |
| BRK | B | 2010-01-21 | 3,476.00 | **72.72** | 47.80 | ×50 | 69.52 | 72.72 |
| CMCSA | A | 2017-02-21 | 75.32 | **37.89** | 1.99 | ×2 | 27.43 | 27.60 |
| GOOGL | A | 2022-07-18 | 2,235.55 | **109.03** | 20.50 | ×20 | 110.80 | 108.07 |
| GOOGL | C | 2022-07-18 | 2,255.34 | **109.91** | 20.52 | ×20 | 111.78 | 108.95 |
| MA | A | 2014-01-22 | 818.48 | **83.30** | 9.83 | ×10 | 75.81 | 77.15 |
| NKE | B | 2012-12-26 | 105.60 | **51.33** | 2.06 | ×2 | 22.06 | 21.44 |
| NKE | B | 2015-12-24 | 128.71 | **63.18** | 2.04 | ×2 | 55.75 | 54.74 |
| NVDA | SOLE | 2021-07-20 | 751.19 | **186.12** | 4.04 | ×4 | 18.72 | 18.55 |
| NVDA | SOLE | 2024-06-10 | 1,208.88 | **121.79** | 9.93 | ×10 | 120.68 | 121.58 |
| TSLA | SOLE | 2020-08-31 | 2,213.40 | **498.32** | 4.44 | ×5 | 147.56 | 166.11 |
| TSLA | SOLE | 2022-08-25 | 891.29 | **296.07** | 3.01 | ×3 | 297.10 | 296.07 |
| UA | A | 2012-07-10 | 95.35 | **48.49** | 1.97 | ×2 | 11.92 | 12.12 |
| UA | A | 2014-04-15 | 105.55 | **54.19** | 1.95 | ×2 | 26.39 | 27.09 |
| V | A | 2015-03-19 | 267.67 | **66.81** | 4.01 | ×4 | 61.81 | 61.71 |
| WMT | SOLE | 2024-02-26 | 175.56 | **59.60** | 2.95 | ×3 | 57.05 | 58.11 |

**17/17에서 boundary 세션의 `raw_close`가 이미 post-action 단위이고, 방향이 승인된 ratio와
경제적으로 일관된다.** `adj_close`는 같은 구간에서 연속이다.

> **tolerance rule을 만들지 않았다.** TSLA 2020은 `4.44` vs `×5`로 11% 떨어져 있는데
> **그날 실제로 주가가 올랐기 때문**이다. **numeric closeness는 진단이고 boundary 판정은
> source semantics로 한다.**

## M7. §9·§14 — R0~R4를 520 observation에서 평가

```text
R0  SEC EFFECTIVE만            (Follow-up 5 결과 때문에 baseline/control)
R1  explicit TRADING만
R2  SEC 승인 event + vendor split_date
R3  conservative transition interval  [min(EFFECTIVE, DISTRIBUTION), market boundary]
R4  vendor split_date, 없으면 explicit TRADING, 둘 다 없으면 fail-close
```

**판정의 truth는 M6이 검증한 market boundary다.** 그리고 CLOSED 계약대로
**`UNRESOLVED` candidate가 하나라도 있으면 그 observation은 fail-close다** — 다른 fact로
조용히 갈아타지 않는다.

| 지표 | R0 | R1 | R2 | R3 | **R4** |
|---|---|---|---|---|---|
| correct basis | 508 | 503 | 513 | 512 | **515** |
| **wrong basis** | **0** | **0** | **0** | **0** | **0** |
| unknown basis | 0 | 0 | 0 | 0 | 0 |
| **fail-close** | 12 | 17 | 7 | 8 | **5** |
| missing | 0 | 0 | 0 | 0 | 0 |

**어떤 정책도 wrong basis를 만들지 않는다. 차이는 전부 fail-close 양이다.**

| 정책 | fail-close | listed | unlisted |
|---|---|---|---|
| R0 | 12 | **9** | 3 |
| R1 | 17 | **12** | 5 |
| R2 | 7 | **0** | 7 |
| R3 | 8 | **3** | 5 |
| **R4** | **5** | **0** | **5** |

- **R0이 listed 9건을 잃는 이유는 SEC `EFFECTIVE`가 없기 때문이다**(MA · NKE×2 · NVDA×2 ·
  TSLA×2 · V×2). **가장 흔한 발행사들이 effective date를 안 쓴다.**
- **R1은 listed 12건을 잃는다** — `TRADING`을 명시한 event가 16 중 3뿐이다.
- **R2·R4는 listed를 하나도 잃지 않는다.** 남는 fail-close는 전부 unlisted다.
- **R4가 R2보다 나은 지점은 NKE A(비상장) 2건**이다. vendor row가 없지만 원문이
  `began trading at the split-adjusted price on December 26, 2012`를 명시해 그 날짜로 닫힌다.

### M7.1 §15가 지목한 기존 failure

| 관측 | R2 | R4 |
|---|---|---|
| MA A f2014 (P0가 10배 틀렸던 것) | **correct** (inst 2013-09-30) | **correct** |
| MA B f2014 | fail-close | fail-close |
| UA A f2014 | **correct** (inst 2013-12-31) | **correct** |
| UA CONV f2014 | fail-close | fail-close |
| NKE A f2013 | fail-close | **correct** |
| NKE B f2013 (P1이 1/2로 틀렸던 것) | **correct** | **correct** |
| NKE A f2016 | fail-close | **correct** |
| NKE B f2016 | **correct** | **correct** |
| NVDA f2022 (P1·P4가 1/4로 틀렸던 것) | **correct** | **correct** |
| NVDA f2025 (P1·P4가 1/10로 틀렸던 것) | **correct** | **correct** |

**여섯 기존 failure 전부 `correct` 아니면 `fail-close`이고 wrong basis는 하나도 없다.**

### M7.2 PIT

`(lo, hi]` 구간에 실제로 걸린 boundary 참조는 **16건**이고, **그중 formation 이후 날짜를 참조한
것은 0건**이다. 다만 **split feed를 오늘 조회하면 미래 event도 함께 오므로**,
구현에서는 `split_date <= formation` 필터를 코드 불변식으로 두어야 한다(Follow-up 3 H13과 같다).

## M8. §10 date_cluster_raw의 역할

**date_cluster 자체를 canonical boundary로 쓰지 않는다.** 이번에 두 가지를 확인했다.

### M8.1 어떤 role이 basis transition과 구조적으로 무관한가

| role | basis transition과의 관계 | transition endpoint로 쓸 수 있나 |
|---|---|---|
| `DECLARED` | 이사회 선언일. **이 시점에는 주식수도 가격 단위도 안 바뀐다** | **안 된다** |
| `RECORD` | 배당 수령 자격 확정일. **주식은 아직 구 단위로 거래된다** | **안 된다** |
| `DISTRIBUTION` / `PAYMENT` | 주식이 실제로 교부된다 → **share-side 전환** | interval의 **시작** |
| `EFFECTIVE` | 법적 효력(정관 개정/배당 효력) → 표본에서 `DISTRIBUTION`과 같거나 인접 | interval의 **시작** |
| `TRADING_SPLIT_ADJUSTED` | **`raw_close` 단위가 바뀐 첫 세션** | **valuation boundary 그 자체** |

> **`DECLARED`·`RECORD`를 "더 이르니까 안전하다"는 이유로 transition 시작으로 넣지 않았다.**
> 그 두 시점에는 주식수도 가격 단위도 바뀌지 않으므로 interval을 앞으로 늘리기만 하고
> 근거 없이 fail-close를 키운다.

### M8.2 date_cluster는 action에 묶어야 한다 — 실제 오염 사례

M2 표의 `−18일` 한 건이 그것이다. NVDA 2024 10-Q의 후보 block 합집합(E2)에서
`DISTRIBUTION 2024-06-28`이 나왔는데, 원문은

> "On June 7, 2024, we increased our **quarterly cash dividend** to $0.01 per share on a
> post-Stock Split basis to all shareholders of record on June 11, 2024. Our **quarterly cash
> dividend was paid on June 28, 2024.**"

**split이 아니라 현금배당의 지급일·기준일이다.** 같은 문서·같은 후보 집합 안에 다른
기업행동의 날짜가 섞인다.

> **결론: `date_cluster_raw`는 문서 단위가 아니라 action span 단위로 묶여야 한다.**
> Follow-up 5의 E2(문서 안 후보 block 합집합)를 그대로 date source로 쓰면
> **다른 기업행동의 날짜가 role에 들어온다.**

## M9. §11·§12 unlisted ordinary class

**listed sibling의 `split_date`를 자동 전파하지 않았다.** 각 unlisted anchor에서
그 class 자신의 판정과 같은 날 상장 sibling의 판정을 나란히 놓았다.

| issuer | unlisted class | ex-date | **그 class 판정** | 같은 날 상장 sibling | 같은 비율? |
|---|---|---|---|---|---|
| GOOGL | B | 2022-07-18 | **SPLIT ×20** | A ×20 · C ×20 | 예 |
| MA | B | 2014-01-22 | **SPLIT ×10** | A ×10 | 예 |
| NKE | A | 2012-12-26 | **SPLIT ×2** | B ×2 | 예 |
| NKE | A | 2015-12-24 | **SPLIT ×2** | B ×2 | 예 |
| UA | CONV | 2012-07-10 | **SPLIT ×2** | A ×2 | 예 |
| UA | CONV | 2014-04-15 | **SPLIT ×2** | A ×2 | 예 |
| **V** | **B** | 2015-03-19 | **NO_SHARE_EFFECT** | **A ×4** | — |
| **V** | **C** | 2015-03-19 | **NO_SHARE_EFFECT** | **A ×4** | — |
| **CMCSA** | **B** | 2017-02-21 | **NO_SHARE_EFFECT** | **A ×2** | — |
| UA | CONV | 2016-04-08 · 2016-06-13 | NO_SHARE_EFFECT | A 무영향 | — |
| CMCSA | B | 2026-01-05 | NO_SHARE_EFFECT | A 무영향 | — |

> **U0(sibling 전파)는 세 anchor에서 즉시 반증된다** — V B · V C · CMCSA B는 상장 sibling이
> ×4 / ×2로 split하는 동안 **자기 주식수는 그대로다.**

### M9.1 U0~U3 — unlisted 146 observation

| 지표 | U0 sibling 전파 | U1 shared-action | U3 fail-close |
|---|---|---|---|
| correct basis | 146 | **146** | 139 |
| wrong basis | 0 | **0** | 0 |
| fail-close | 0 | **0** | **7** |

**숫자로는 U0와 U1이 같다.** 이유는 P2가 **가장 늦은 instant**를 고르고 그 fact는 거의 항상
event 이후 filing에서 오기 때문이다 — **U0의 과잉 배제가 선택 결과까지 가지 않는다.**

**그러나 fact 수준에서는 이미 갈린다.** U0가 `DIFFERENT`라고 배제하지만 U1은 `SAME`인
후보 fact가 **4개**(V B 2 · V C 2)다. **선택에 닿지 않은 것은 설계가 아니라 배치의 결과다.**

## M10. §13 non-simple event — 여기서 silent wrong이 생긴다

### M10.1 Visa 2015 — 주식수는 그대로, 전환비율이 바뀐다

원문(Follow-up 4 J4):

> "Holders of **class B and C common stock did not receive a stock dividend.** Instead, the
> **conversion rate for class B common stock increased to 1.6483** shares of class A common stock
> per share of class B common stock, and the **conversion rate for class C common stock increased
> to 4.0**."

**unlisted class의 ME는 `shares × conversion_ratio × reference raw_close`다.** 이 event에서
`shares`는 안 바뀌고 `reference raw_close`는 ×1/4가 되며 `conversion_ratio`는 ×4가 된다.
**세 항 중 둘이 같은 순간에 반대로 움직인다.**

Class B 주식수 `245,513,385`로 실제 December 가격을 곱한 값이다.

| December | V `raw_close` | 전환비율 0.412075 (split 이전) | 전환비율 1.6483 (split 이후) |
|---|---|---|---|
| 2014-12-31 (split 이전) | 262.20 | **$26.5B** ← 맞다 | $106.1B (**4배 과대**) |
| 2015-12-31 (split 이후) | 77.55 | **$7.8B** (**1/4로 과소**) | **$31.4B** ← 맞다 |

> **conversion ratio가 PIT가 아니면 ME가 조용히 4배 틀린다.** 그리고 그 오류는
> **share selector 어디에도 나타나지 않는다** — 주식수는 정확하고 가격도 정확하다.
> **unlisted class의 valuation regime boundary는 share-side가 아니라 conversion-ratio side에 있다.**

**주의.** Visa의 class B 전환비율은 소송 escrow에 따라 변하는 값이므로,
로드맵 §4.4.2가 요구하는 `fixed direct conversion ratio` 요건을 만족하는지 **자체가 별도 판단**이다.
만족하지 못하면 그 class는 `CONVERSION_VALUE_PROXY`가 아니라 `MISSING`이다.

### M10.2 CMCSA 2017 — 단일 배수로 표현되지 않는다

Follow-up 4 J4.1이 확정한 대로, 배당이 **Class A 주식으로 Class A·B 보유분 모두에** 지급돼
Class A의 실제 소급 배수가 `2`가 아니라 `2.00399`(= `2×A + B`)다.
**Class B 자신의 주식수는 `9,444,375`로 불변이다.**

> **U0는 이 event를 "issuer-wide ×2"로 읽고 Class B의 basis가 바뀌었다고 주장한다. 틀렸다.**

## M11. §16 boundary-adjacent stress — 진단표

event 후보가 걸리는 **249 observation**에서, `filing acceptance`·`December session` 중
어느 것이든 **어떤 boundary 후보(SEC EFFECTIVE/DISTRIBUTION/TRADING 또는 vendor)**와
가장 가까운 거리를 전수로 계산했다.

| issuer | class | formation | 가장 가까운 endpoint | 그 날짜 | 경계 role | 경계 날짜 | **간격(일)** |
|---|---|---|---|---|---|---|---|
| NKE | A | 2013 | December session | 2012-12-31 | SEC TRADING | 2012-12-26 | **5** |
| NKE | B | 2013 | December session | 2012-12-31 | SEC TRADING | 2012-12-26 | **5** |
| NKE | A | 2016 | December session | 2015-12-31 | SEC TRADING | 2015-12-24 | **7** |
| NKE | B | 2016 | December session | 2015-12-31 | SEC TRADING | 2015-12-24 | **7** |
| GOOGL | A | 2023 | filing acceptance | 2022-07-26 | vendor | 2022-07-18 | **8** |
| GOOGL | C | 2023 | filing acceptance | 2022-07-26 | vendor | 2022-07-18 | **8** |
| NVDA | SOLE | 2025 | filing acceptance | 2024-05-29 | SEC DISTRIB | 2024-06-07 | **9** |
| GOOGL | B | 2023 | filing acceptance | 2022-07-26 | SEC EFFECTIVE | 2022-07-15 | **11** |
| NKE | A · B | 2017 | filing acceptance | 2016-01-06 | SEC TRADING | 2015-12-24 | **13** |
| WMT | SOLE | 2025 | filing acceptance | 2024-03-15 | vendor | 2024-02-26 | **18** |

간격 분포: **최소 5일** · 중앙값 1,111일 · 10일 이하 **7건** · 30일 이하 23건.

> **이것이 R0~R4가 wrong basis를 하나도 만들지 않은 이유다.** SEC 날짜와 market boundary의
> 차이는 1~4일인데 **격자에서 가장 가까운 endpoint-경계 간격이 5일이다.**
> **여유가 하루다.** 12월 마지막 세션이 이틀만 앞이었다면 NKE 2013에서 R0/R1과 R2/R4가 갈린다.
> **"3일 이내" 같은 숫자를 selector rule로 쓰지 않는다. 이 표는 edge-case 발견용이다.**

## M12. §17 reverse split CONTROL — 525 grid 통계에 합치지 않는다

| control | SEC 날짜(역할) | vendor split_date | new/old | boundary | prev raw | bound raw | prev/bound |
|---|---|---|---|---|---|---|---|
| **AIG** | `EFFECTIVE` 2009-06-30 | 2009-07-01 | 1/20 | 2009-07-01 | 1.16 | 18.08 | 0.064 |
| **BTU** | `EFFECTIVE` 2015-09-30 | **없음 (0 rows)** | — | **없음** | — | — | — |
| **GE** | `TRADING` **2021-08-02** | **2021-08-02** | 1/8 | 2021-08-02 | 12.95 | 100.60 | 0.129 |
| SIRI | (날짜 없음) | 2024-09-10 | 1/10 | 2024-09-10 | 2.67 | 27.38 | 0.098 |

**forward와 같은 계약이 그대로 성립한다.**

1. **GE에서 `SEC TRADING == vendor split_date`가 또 한 번 정확히 일치한다.** forward 3/3에
   reverse 1/1이 더해진다.
2. **AIG는 `EFFECTIVE`가 market boundary보다 하루 앞이다** — forward의 1~4일 패턴과 같다.
3. **BTU가 결정적이다.** SEC는 "completed a **1-for-15 reverse stock split** … **on September 30,
   2015**"로 명시하는데 **vendor `splits` 응답이 빈 배열이고, `bars_daily`의 BTU 시계열조차
   2017-04-03부터 시작한다**(파산·재상장으로 이전 이력이 없다).
   **→ vendor market boundary가 구조적으로 존재하지 않을 수 있다.**
   **vendor market boundary가 없을 때 fallback으로 쓸 수 있는 것은 명시된 SEC `TRADING`뿐이다.**
   **BTU는 `TRADING`이 없고 `EFFECTIVE`만 있으므로 valuation market boundary는 `UNRESOLVED`다.**
   `EFFECTIVE`는 share-side 날짜이지 raw-price valuation boundary가 아니다(M2·M6).
4. **SIRI는 별도 diagnostic이다.** 원문이 split이 아니라
   "conversion of Old Sirius shares into SplitCo common stock on a one-for-ten basis"이고
   SEC 날짜 role이 없다. vendor row는 있고 가격도 1/10로 끊긴다.
   **SEC 승인 없이 vendor row만으로 승격하지 않는다는 계약이 여기서 실제로 작동한다.**

## M13. §18 provenance

이번 연구가 모든 boundary evidence에 함께 보존한 항목이다.

```text
class / symbol            (issuer, class_id label, listed symbol 또는 없음)
source type               SEC filing 본문 | EODHD splits API | bars_daily
source URL / API          accession + document name | GET /api/splits/{SYMBOL}.US | (source, source_version)
retrieval date            SEC: Follow-up 5 파싱 시점 | EODHD: 2026-08-30
SEC accession             해당 event의 K/Q accession
raw source date role      DECLARED / RECORD / DISTRIBUTION / EFFECTIVE / TRADING (원문 문구 그대로)
market split_date         vendor date (원문 문자열 split = new/old 포함)
calendar source/version   ("eodhd", "eodhd-15y-2026-08") — bars_daily의 SPY 정규 세션 달력
derived first session     그 달력에서 split_date 이상의 첫 세션
```

**vendor 날짜를 SEC provenance처럼 쓰지 않았다.** M5 표에서 두 열이 끝까지 분리돼 있고,
승인(event 존재·action·class)은 전부 SEC 쪽에서만 왔다.

## M14. ground truth 확인 범위

**§9·F14·G15·H14·I13·J9·K9·L14와 같은 기준이다. 520 observation 전부를 사람이 원문과
1:1 대조하지 않았다.**

| 대상 | 원문 | 결과 |
|---|---|---|
| EODHD splits/calendar endpoint 가용성·필드 | 실제 credential로 직접 호출, 2026-08-30 | M4 |
| confirmed 16 event의 SEC date role | Follow-up 5가 사람이 읽은 결과를 그대로 사용 | M5 |
| boundary 전후 `raw_close`·`adj_close` | `bars_daily` 직접 조회 17 class-event | M6 |
| Visa class B/C 전환비율 문구 | Follow-up 4 J4의 인용을 그대로 사용 | M10.1 |
| CMCSA `2×A + B` | Follow-up 4 J4.1을 그대로 인용, 재계산하지 않았다 | M10.2 |
| NVDA 현금배당 날짜 오염 | NVDA 2024 10-Q 후보 block 원문 | M8.2 |
| reverse CONTROL 4건 | Follow-up 5가 읽은 원문 + 이번 vendor/price 조회 | M12 |

**기계로만 검증한 것**: 520 observation의 R0~R4·U0~U3 판정, 249 observation의 stress 거리,
PIT 위반 0건.

**정직하게 적을 한계 다섯.**

1. **`truth`가 vendor split_date다.** M6의 가격 불연속이 독립 corroboration이지만,
   **가격과 split feed는 같은 vendor·같은 source_version에서 온다.** 완전히 독립된 제3의
   market boundary source로 검증하지 않았다.
2. **`SEC TRADING == vendor` 일치는 4건(forward 3 + reverse 1)뿐이다.** 두 source가 항상
   일치한다고 말할 표본이 아니다.
3. **wrong basis 0건은 M11이 보여주듯 5일 여유의 결과다.** 정책 간 정확도 차이가 이 격자에서
   드러나지 않았을 뿐이다.
4. **unlisted의 U0와 U1이 숫자로 같다.** U0의 오류는 fact 4개와 event 3건에서만 드러나고
   선택 결과에는 닿지 않았다.
5. **M10.1의 Visa 수치는 시연이다.** 실제 PIT 전환비율 시계열을 구축하지 않았고
   `0.412075`는 `1.6483/4`로 역산한 값이다.

## M15. 이번에 결정하지 않은 것 (§20)

1. prose class-name → `class_id` mapping schema
2. production event extractor
3. event/coverage ledger DDL
4. P3 normalization
5. **`CONVERSION_VALUE_PROXY`의 실제 PIT conversion mapping 구축** — M10.1이 그 필요성을
   수치로 보였지만 mapping 자체를 만들지 않았다
6. unexplained cross-accession conflicts
7. Gate C · `coverage_start` · B/M · rank · returns

## User decision — share / valuation regime boundary

### listed class: **C — SEC-approved event + vendor market boundary** (종결 분기로 E를 포함한다)

```text
VALUATION_REGIME_BOUNDARY(listed class, confirmed event)

  event 존재 · action · 영향 class는 SEC 명시 공시로만 승인한다 (기존 CLOSED 계약 그대로)

  boundary는 그 class 자신의 상장 심볼에서 받는다
      1) vendor split_date  (그 이상의 첫 정규 세션 = boundary)
         calendar는 ME가 쓰는 것과 같은 (source, source_version)
         PIT 불변식: split_date <= formation 인 row만 본다
      2) SEC 원문이 TRADING_SPLIT_ADJUSTED를 명시하면 corroboration으로 대조한다
         불일치 -> UNRESOLVED
      3) vendor row가 없으면 명시된 SEC TRADING date로 닫는다
      4) 둘 다 없으면 UNRESOLVED -> fail-close

  SEC EFFECTIVE / DISTRIBUTION 을 valuation boundary로 쓰지 않는다.
  그 둘은 share-side 날짜이고 이 표본에서 17건 중 16건이 market boundary와 1~4일 다르다.

  transition safety guard  (D에서 가져온다)
      share-side transition date = EFFECTIVE, 또는 그 action에 연결된 DISTRIBUTION
      그것이 명시돼 있고 market boundary와 다를 때,
      반개구간 [share-side transition, market boundary) 안에
          share-filing basis anchor  또는  December valuation session
      이 하나라도 놓이면 same/different regime을 강제로 정하지 않는다
          -> UNRESOLVED -> fail-close

      DECLARED / RECORD 는 transition endpoint로 쓰지 않는다.
      임의의 +/-N일 window를 만들지 않는다.
```

§19 기준별로 적는다.

- **1. `raw_close`의 실제 unit과 맞는가.** 맞는다. boundary 세션의 `raw_close`가 이미
  post-action 단위임을 17/17에서 직접 확인했고(M6), `SEC TRADING`이 있는 4건(forward 3 +
  reverse GE 1)에서 vendor와 **정확히 일치**한다. **반대로 `EFFECTIVE`는 16/17에서 틀린 날짜다.**
- **2. SEC event approval 계약을 훼손하지 않는가.** 훼손하지 않는다. **vendor는 이미 승인된
  event의 boundary만 공급하고 승인에는 관여하지 않는다.** SIRI가 그 분리를 실제로 시험한다 —
  vendor row가 있고 가격도 1/10로 끊기지만 SEC 승인이 없어 event가 되지 않는다(M12-4).
- **3. listed/unlisted 차이를 보존하는가.** 보존한다. 이 계약은 **그 class 자신의 상장 심볼**에서만
  boundary를 받는다. 심볼이 없으면 unlisted 계약으로 넘어간다.
- **4. arbitrary time/price tolerance가 없는가.** 없다. 가격은 진단으로만 썼고 boundary는
  날짜 자체다. `±N일` window도 백분율도 쓰지 않았다.
- **5. PIT인가.** 그렇다. 격자에서 formation 이후 boundary 참조는 0건이고(M7.2),
  `split_date <= formation` 필터를 코드 불변식으로 요구한다.
- **6. silent wrong보다 fail-close인가.** 그렇다. 520 격자에서 **wrong basis 0 · fail-close 5**이고,
  기존 P0·P1 failure 여섯 건이 전부 `correct` 아니면 `fail-close`다(M7.1).
- **7. 최소 복잡도인가.** 그렇다. 필요한 것은 **class별 boundary 날짜 하나와 구간 포함 검사**뿐이고,
  ME가 이미 쓰는 같은 달력·같은 vendor version을 재사용한다.

**A(SEC date only)를 추천하지 않는 이유는 정확도가 아니라 semantic이다.** `EFFECTIVE`는
share-side 날짜라 §5의 target이 아니고, 게다가 16 event 중 8건에만 존재해 listed 9 observation을
잃는다. **B(explicit trading date hierarchy)는 방향이 옳지만 16 중 3건에만 존재해 listed 12건을
잃는다** — 단독 계약으로는 못 쓰고, C 안의 corroboration·fallback으로 살린다.
**D(conservative interval)는 가장 보수적이고 wrong basis도 0이지만, share-side 날짜가 없는
발행사(NVDA 2022 · TSLA 2021 · TSLA 2023)에서 interval 시작을 만들 수 없어 listed 3건을 더 잃는다.**
얻는 안전이 이 격자에서 0이다.

> **다만 D의 아이디어는 버리지 않는다.** M11이 보여주듯 **가장 가까운 endpoint-경계 간격이 5일**이고
> share-side와 market-side가 1~4일 벌어져 있다. **둘 사이에 endpoint가 떨어지는 관측이 실제로
> 생기면 C는 답을 하나로 정해버린다.** 그때는 D의 interval fail-close가 옳다.
> **그래서 위 계약에 transition safety guard를 얹었다** — 반개구간
> `[share-side transition, market boundary)`에 share-filing basis anchor나 December valuation
> session이 들어오면 `UNRESOLVED`다. 이 격자에서 비용이 0이다.

### unlisted ordinary class: **B — explicit shared-action reference boundary** (그 외 fail-close)

```text
unlisted class의 share-side boundary

  다음을 SEC 원문이 전부 명시할 때만 reference listed class의 market boundary를 공유한다
      1) 그 unlisted class가 reference class와 같은 action에 명시적으로 포함된다
      2) 같은 basis 변환(같은 비율)을 받는다
      3) 두 class의 conversion relation이 action 전후로 명확하다
  하나라도 아니면 UNRESOLVED -> fail-close

  listed sibling의 split_date를 자동 전파하지 않는다.
```

- **A(sibling propagation)는 세 anchor에서 직접 반증된다.** V B · V C · CMCSA B는 상장 sibling이
  ×4 / ×2로 split하는 동안 **자기 주식수가 그대로다**(M9). 숫자로는 U0와 U1이 146/146으로 같지만
  그것은 P2가 가장 늦은 instant를 고르는 덕에 과잉 배제가 선택까지 안 갔기 때문이고,
  **fact 수준에서는 이미 4개가 잘못 배제된다.**
- **B는 GOOGL B · MA B · NKE A · UA CONV를 원문 근거로 닫는다** — 넷 다 "Class A and Class B",
  "both … Class A and Class B", "Class A, Class B, and Class C"처럼 unlisted class를 문장 안에서
  이름으로 부른다. **NKE A는 vendor row가 없지만 원문의 `TRADING` 날짜로 닫힌다.**
- **C(conversion-regime boundary)를 지금 채택하지 않는다.** 필요하다는 것은 M10.1이 수치로
  보였지만 — Visa Class B에서 **전환비율이 PIT가 아니면 December ME가 조용히 4배 틀린다**
  ($31.4B vs $7.8B) — **이번 연구는 새 conversion mapping을 만들지 않았다.**
- **D(fail-close/mixed)는 B의 종결 분기로 이미 들어 있다.** 명시 근거가 없으면 unresolved다.

> **반드시 함께 기억할 것.** **B는 unlisted class의 share-side boundary만 정한다.**
> `CONVERSION_VALUE_PROXY`를 쓰는 class의 **valuation-side boundary는 conversion ratio 쪽에
> 있고 아직 열려 있다.** M10.1의 4배 오차는 주식수도 가격도 정확한 상태에서 발생하므로
> **share selector의 어떤 지표에도 나타나지 않는다.**
> 그 계약이 정해지기 전까지 `CONVERSION_VALUE_PROXY` class는 valuation 쪽에서 fail-close해야 하고,
> 로드맵 §4.4.2의 `fixed direct conversion ratio` 요건을 만족하지 못하면 애초에 `MISSING`이다
> (Visa class B/C가 그 요건을 만족하는지 자체가 별도 판단이다).

### 함께 기억할 것 넷

1. **SEC `EFFECTIVE`와 market boundary는 다른 사건이다.** 17건 중 16건이 1~4일 다르고
   같은 날인 것은 BRK 하나뿐이다. **하나를 다른 하나로 쓰면 안 된다.**
2. **`SEC TRADING`이 있으면 그것이 정답이다.** vendor와 4/4 일치(forward 3 · reverse GE 1).
   다만 16 event 중 3건에만 있다.
3. **vendor feed는 없을 수 있다.** BTU는 SEC가 `1-for-15 … on September 30, 2015`로 명시하는데
   vendor `splits`가 빈 배열이고 `bars_daily`의 시계열조차 2017년부터다.
   **fallback 없는 vendor 단독 계약은 그런 발행사에서 영구 unresolved다.**
   **다만 fallback은 명시된 SEC `TRADING`뿐이라, `EFFECTIVE`만 있는 BTU는 그 fallback으로도
   닫히지 않고 `UNRESOLVED`로 남는다.**
4. **여유가 5일이다.** M11의 stress 표에서 가장 가까운 endpoint-경계 간격이 NKE 2013의 5일이고,
   SEC와 market의 차이는 1~4일이다. **이 격자에서 정책 간 wrong basis 차이가 0인 것은
   설계의 결과가 아니라 배치의 결과다.**

**이 follow-up도 research 결과일 뿐 아직 CLOSED/FROZEN 계약이 아니다.**
# Follow-up 7 — PIT conversion-value mapping (2026-08-30)

**Status: RESEARCH EVIDENCE ONLY.** 로드맵 §4.4.2가 `CONVERSION_VALUE_PROXY`에 요구하는
`reliable fixed direct conversion ratio`의 뜻과 PIT 계약을 정하기 위한 연구다.
**production code · schema · tests · roadmap을 바꾸지 않았고 production DB에 쓰지 않았다.**
기존 520/525 격자 수치와 M6~M12 결과도 바꾸지 않았다.

## N1. 이번 질문 하나

> **어떤 원문 증거가 있을 때만 unlisted ordinary class의 conversion relation을
> `(reference_class_id, conversion_ratio, legal effective interval)`로 확정해
> `CONVERSION_VALUE_PROXY`에 쓸 수 있는가? 그리고 그 mapping을 historical formation에서
> 언제부터 쓸 수 있는가?**

## N2. §4 두 종류의 시간 — 이 표본에서 실제로 벌어진다

```text
LEGAL EFFECTIVE INTERVAL   conversion right/rate가 법적으로 유효한 기간
KNOWLEDGE / USABILITY TIME 그것을 증명하는 SEC 원문이 공개돼 backtest에서 쓸 수 있게 된 시점
```

**둘이 다르다는 것을 이 표본이 직접 보여준다.** Comcast Reclassification이 가장 선명하다.

| 축 | 값 | 근거 |
|---|---|---|
| legal effective | **2015-12-11 close of business** | 8-K 본문 "the New Articles and the Reclassification became effective as of the close of business that day" |
| acceptance | **2015-12-14 17:42:38** | `0000950103-15-009516` filing index |
| filing date | **2015-12-15** | 같은 index |

**세 날짜가 전부 다르다.** 그리고 acceptance가 filing date보다 **하루 앞**이다 — K6이 지적한
acceptance 규약 문제가 이 accession에서 실제로 발생한다(17:30 이후 접수 → 다음 영업일 filing date).
Visa FY2014 10-K도 같다: accepted `2014-11-20 18:57:50`, filed `2014-11-21`.

> **`historical_usable_session`은 filing date가 아니라 acceptance에서 파생해야 한다**(§3.2 CLOSED와 같은 자리).
> 이 표본에서 그 차이가 하루씩 실제로 존재한다.

## N3. §5 source-of-truth 후보 — S0가 필요하다는 것이 실측으로 나왔다

| family | 이 표본에서 관측된 것 | 판정 |
|---|---|---|
| **S0** SEC-filed governing instrument (certificate/charter/amendment) | **Alphabet·Google Inc·Facebook·Ford에서 ratio가 여기에만 있거나 여기서 확정된다** | **canonical** |
| **S1** 10-K/10-Q 본문의 explicit conversion-right 공시 | MA·NKE·UA·CMCSA·Ford 표지에서 ratio가 본문에 있다 | **canonical** |
| **S2** 8-K / proxy 등 explicit transaction 공시 | Comcast Reclassification, Visa 2015 rate 조정 | **canonical (event/interval boundary용)** |
| S3 issuer website / IR 요약 | 사용하지 않았다 | corroboration only |
| S4 vendor / secondary | 사용하지 않았다 | corroboration only |

**S1만으로는 부족하다는 반례가 GOOGL이다.** Alphabet 10-K는 전환의 **방향과 촉발조건만** 말하고
**비율을 말하지 않는다.**

> "Shares of Class B common stock may be converted **at any time at the option of the stockholder**
> and **automatically convert upon sale or transfer** to Class A common stock."
> — `0001652044-16-000012` · `-19-000004` · `-23-000016` · `-25-000014` 전부 같은 문장

비율은 charter에만 있다.

> "Each share of Class B Common Stock shall be convertible into **one (1)** fully paid and
> nonassessable share of Class A Common Stock at the option of the holder thereof at any time
> upon written notice to the transfer agent of the Corporation."
> — Alphabet EX-3.1 `0001193125-15-336577` (accepted 2015-10-02 16:17:13)

**같은 문장이 Google Inc charter(`0001193125-11-032930` 2011-02-11 · `0001193125-12-312575`
2012-07-24)와 Alphabet 2022 charter(`0001193125-22-167375` 2022-06-03)에도 글자 그대로 있다.**
**따라서 S1만 보는 계약(후보 B)은 Alphabet에서 ratio를 만들지 못한다.**

## N4. §6 `fixed direct conversion` 7요건 — anchor별 판정

| # | 요건 | GOOGL B | META B | F B | CMCSA B | MA B | NKE A | UA CONV | V B | V C |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | subject가 actual ordinary common | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 2 | reference가 같은 issuer의 listed ordinary common | ✅ A | ✅ A | ✅ Common | **❌ A / A Special 둘** | ✅ A | ✅ **B** | ✅ A | ✅ A | ✅ A |
| 3 | 1주 → reference 몇 주인지 explicit | ✅ S0 | ✅ S0 | ✅ S0+표지 | ✅ | ✅ S1 | ✅ S1 | ✅ S1 | ✅ 수치는 있다 | ⚠ 2015 이후만 |
| 4 | interval 안에서 deterministic | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **❌** | ⚠ |
| 5 | holder/board 재량 없이 계산 가능 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **❌** | ⚠ |
| 6 | litigation/escrow/formula에 의존하지 않음 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **❌** | ✅ |
| 7 | security price·future event에 연동되지 않음 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **❌** | ✅ |

**요건 5의 해석을 하나 고정한다.** UA·GOOGL·META·F의 전환은 **holder의 선택이나 transfer로
촉발**되지만 **비율 자체에는 재량이 없다.** §6이 막으려는 것은 **ratio의 재량**이지 trigger의
재량이 아니다. **trigger 재량을 ratio 재량으로 읽으면 1:1 charter 전부가 탈락하고 §4.4.2의
`CONVERSION_VALUE_PROXY`가 구조적으로 빈 규칙이 된다.**

## N5. §7 unlisted anchor 전수 — 원문 표

`raw wording`은 원문 그대로다. `usable_from`은 acceptance 기준이다.

| issuer | class | ref listed | source form | accession | acceptance | raw conversion wording | ratio | ratio type | fixed? | direct? | contingent? | eligible? |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **GOOGL** | B | A (`GOOGL`) | **EX-3.1 charter (S0)** | `0001193125-15-336577` | 2015-10-02 16:17:13 | "shall be convertible into **one (1)** fully paid and nonassessable share of Class A Common Stock at the option of the holder thereof at any time" | **1** | explicit integer | ✅ | ✅ | ❌ | **YES** |
| GOOGL(Google Inc) | B | A | EX-3.01 charter (S0) | `0001193125-11-032930` · `0001193125-12-312575` | 2011-02-11 17:13:29 · 2012-07-24 17:29:19 | 동일 문장 | **1** | explicit integer | ✅ | ✅ | ❌ | YES |
| **META** | B | A (`META`) | **EX-3.1 charter (S0)** | `0001193125-12-325997` | 2012-07-31 16:39:19 | "3.8 Conversion of Class B Common Stock. (a) **Voluntary Conversion**. Each share of Class B Common Stock shall be convertible into **one (1)** fully paid and nonassessable share of Class A Common Stock at the option of the holder thereof at any time" | **1** | explicit integer | ✅ | ✅ | ❌ | **YES** |
| META | B | A | 10-K (S1) | `0001326801-25-000017` | 2025-01-30 | "convertible into **an equivalent number of shares** of our Class A common stock and generally convert into shares of our Class A common stock upon transfer" | (1) | **share-count equivalence** | ⚠ S1 단독은 약하다 | ✅ | ❌ | S0로 확정 |
| **F** | B | Common (`F`) | **EX-3.A restated certificate (S0)** + 10-K 표지 | `0000037996-01-000014` | 2001-03-22 | "shares of Class B Stock may be converted at any time into **an equal number of shares of Common Stock** for the purpose of effecting the sale or other disposition of such shares" | **1** | equal-number | ✅ | ✅ | ❌ | **YES** |
| F | B | Common | EX-4.B description (S1) | `0000037996-20-000010` | 2020-02-05 12:01:22 | "A holder of shares of Class B Stock can convert those shares into **an equal number of shares of Common Stock** for the purpose of selling or disposing of those shares" | 1 | equal-number | ✅ | ✅ | ❌ | YES (corroboration) |
| **CMCSA** | B | **A 또는 A Special** | 10-K (S1) | `0001193125-09-033975` · `0001193125-14-047522` | 2009-02-20 · 2014-02-12 | "Our Class B common stock is convertible, **share for share, into Class A or Class A Special common stock**, subject to certain restrictions." | 1 | share-for-share | ✅ | **❌ ref 2개** | ❌ | **NO (~2015)** |
| CMCSA | B | A (`CMCSA`) | 10-K (S1) | `0001166691-20-000008` · `0001166691-25-000011` | 2020-01-30 · 2025-01-31 | "The Class B common stock can be converted, **on a share for share basis, into Class A common stock**." | 1 | share-for-share | ✅ | ✅ | ❌ | **YES (2016~)** |
| **MA** | B | A (`MA`) | 10-K (S1) | `0001141391-14-000003` | 2014-02-14 11:26:02 | "Shares of Class B common stock are convertible **on a one-for-one basis** into shares of Class A common stock." | **1** | one-for-one | ✅ | ✅ | ❌ | **YES** |
| **NKE** | A | **B** (`NKE`) | 10-K (S1) | `0000320187-14-000097` | 2014-07-25 16:22:20 | "The Class A Common Stock is not publicly traded but **each share is convertible upon request of the holder into one share of Class B Common Stock**." | **1** | one share | ✅ | ✅ | ❌ | **YES** |
| **UA** | CONV | A (`UAA`) | 10-K (S1) | `0001336917-14-000008` | 2014-02-21 15:05:19 | "the shares automatically convert into shares of Class A Common Stock **on a one-for-one basis**" | **1** | one-for-one | ✅ | ✅ | ❌ | **ratio는 OK · identity 미해결** |
| **V** | B | A (`V`) | 10-K (S1) | `0001193125-09-239249` | 2009-11-20 | "the conversion rate applicable to the Company's class B common stock outstanding **was reduced to 0.7143** class A shares" | **0.7143** | **escrow 조정 변수** | **❌** | ✅ | **✅** | **NO** |
| V | B | A | 10-K (S1) | `0001403161-14-000017` | 2014-11-20 18:57:50 | "Conversion rate of class B common stock to class A common stock after deposits **0.4121**" · "Effective price per share calculated using the **volume-weighted average price of the Company's class A common stock** over a pricing period in accordance with the Company's current certificate of incorporation" | **0.4121** | **VWAP 공식** | **❌** | ✅ | **✅** | **NO** |
| V | C | A | 10-Q (S1) | `0001403161-15-000007` | (Follow-up 4 J4 인용) | "the conversion rate for class C common stock **increased to 4.0**" | 4.0 | split 조정 | ⚠ | ✅ | ❌ | **interval 미완성** |

**BRK를 대조군으로 함께 적는다.** A·B 둘 다 상장이라 이 census에 들어가지 않지만
**fixed direct ratio가 1:1이 아닐 수 있다는 증거**다.

> "Each share of Class A common stock is convertible, at the option of the holder,
> **into 1,500 shares of Class B common stock**. **Class B common stock is not convertible
> into Class A common stock.**"
> — `0001193125-17-056969` · `0001564590-22-007322` · `0001193125-26-083899`

**전환은 단방향이다.** `reference_class_id`는 대칭 관계가 아니고 역수를 취해 뒤집을 수 없다.

## N6. §8 대비 확인 — 여섯 개를 전부 원문으로 봤다

### A. Alphabet B — 1:1이 맞지만 근거가 10-K에 없다

- **법적으로 direct 1:1이다.** charter가 `one (1)`을 명시한다.
- **holder의 선택**(voluntary)과 **transfer 시 자동** 둘 다다. 비율은 두 경우 모두 1:1이다.
- **기간 전체에서 1:1이다.** Google Inc 2011·2012 charter, Alphabet 2015·2022 charter가 같은 문장이다.
- **split 전후에도 ratio가 1:1로 유지된다.** 2022-07-15 20-for-1이 **A·B·C 전부**에 적용됐고
  (J4의 `0001652044-22-000071` 원문), split 직전인 2022-06-03 charter도 여전히 `one (1)`이다.
- **"1:1처럼 보인다"로 승인하지 않았다.** 승인 근거는 charter 문장이다.

### B. Mastercard B — A와 direct 1:1, transfer 제약은 ratio를 흔들지 않는다

- "convertible **on a one-for-one basis**"가 2009·2014·2020·2025 10-K에 모두 있다.
- **transfer/ownership 제약은 존재한다** — "Entities eligible to hold ... are defined in our
  amended and restated certificate of incorporation (generally our principal or affiliate customers),
  and they are **restricted from retaining ownership of shares of Class A common stock**."
  2009년에는 "conversion transactions ... **in amounts and at times to be designated by the Company**,
  ... **subject to annual aggregate and other limits**"였고, "**After May 31, 2010**, holders ...
  will have the option to convert **all** of their shares ... **without aggregate amounts or similar limitations**."
- **그러나 이 제약은 전부 "언제·얼마나" 전환할 수 있는지에 걸리고, 1주가 몇 주가 되는지에는 걸리지 않는다.**
  ratio는 전 구간 1이다.
- **split은 A와 B에 같은 비율로 적용됐다**(J4의 MA 2014 "ten-for-one stock split of the Company's
  **Class A and Class B** common shares"). 따라서 ratio 자체가 유지된다 — N7의 TYPE A다.

### C. Nike A — explicit direct conversion이고, reference가 Class B다

- "each share is convertible upon request of the holder into **one share of Class B Common Stock**"
  (2009·2014·2020·2025 동일) · "Each share of Class A Common Stock is convertible into one share of
  Class B Common Stock" (재무제표 주석).
- **transfer 시 자동이 아니라 holder request다.** 그래도 ratio는 deterministic 1이다.
- **reference가 Class A가 아니라 Class B다.** 상장 심볼 `NKE`가 Class B이므로 방향이 맞다.
  **"unlisted는 항상 Class A를 참조한다"는 가정이 여기서 깨진다.**

### D. Under Armour — ratio는 명확한데 class identity가 막는다

- ratio는 전 기간 "**on a one-for-one basis**"로 명시된다(2009·2014·2020·2025).
- **그러나 원문이 부르는 이름은 `Class B Convertible Common Stock`이고 registry label은 `CONV`다.**
  그리고 **UA가 2016년에 만든 `Class C`는 2012년의 "Class B"와 다른 class다**(L8·J4.3).
- 2020·2025 10-K에는 관계가 하나 더 있다 — "the Class B common stock automatically converts to
  Class A common stock, **which would also result in the conversion of our Class C common stock into
  Class A common stock**." **Class C는 상장(`UA`, 2016-03-23~)이고 Class A도 상장(`UAA`)이다.**
- **이번 연구는 fuzzy resolution을 하지 않는다.** explicit source가 어느 economic class를
  말하는지만 기록하고 `IDENTITY_UNRESOLVED`로 둔다.

### E. Visa B / C — 핵심 negative control, 구조적으로 부적격

**세 문장이 각각 독립적으로 실격시킨다.**

1. **escrow 연동** — "when Visa funds the Escrow Account, the shares of class B common stock ...
   are subject to dilution through **an adjustment to the conversion rate**" (FY2009).
2. **가격 연동 공식** — "**Effective price per share calculated using the volume-weighted average
   price of the Company's class A common stock over a pricing period** in accordance with the
   Company's current certificate of incorporation" (FY2014). **§6-7 위반이 원문에 있다.**
3. **미래 사건 연동** — "any amounts remaining in the escrow account **after the date on which all
   of the covered litigation is resolved** will be released back to us and that **the conversion rate
   ... will be adjusted in favor of the holders**. The adjustment would be **through a formula based
   on the released escrow amount and the market price of our class A common stock**." (FY2009)

**그리고 애초에 전환 자체가 막혀 있었다** — "The class B common stock is **not convertible or
transferable until the date on** ..." (FY2014).

**"fixed direct conversion ratio 요건을 만족하는 기간이 실제로 존재하는가?"에 대한 답은 아니오다.**
비율은 escrow 입금마다 바뀌고 그 값이 VWAP에 의존한다. 관측된 값만 해도
`0.7143`(FY2009) → `0.4121`(FY2014) → `1.6483`(2015 split 이후, J4) 이고,
2024년에는 class B가 **B-1 / B-2로 갈라져** 각각 따로 하향 조정된다
("downward adjustments of the **class B-1 and B-2** common stock conversion rates during the period",
`0001403161-24-000058`).

> **Visa를 살리기 위한 예외를 만들지 않는다.** interval을 아무리 잘게 잘라도 다음 escrow 입금
> 시점을 formation 시점에 알 수 없으므로 PIT freeze가 불가능하다. **`MISSING`이 맞다.**

**Class C는 별개로 판정한다.** escrow 조정 대상이 아니고 2015 split 때 `4.0`으로 올랐다는
원문이 있다(J4). **그러나 2015 이전 구간의 rate를 이번에 확인하지 않았다.**
§14의 gap 규칙에 따라 현재 rate를 과거로 backfill하지 않으므로 **`INTERVAL_INCOMPLETE`다.**

### F. Comcast B — 여기서 진짜 문제가 드러난다: reference가 하나가 아니다

**2015-12-11 이전 원문은 전환 대상을 둘로 준다.**

> "Our Class B common stock is convertible, **share for share, into Class A or Class A Special
> common stock**, subject to certain restrictions."
> — `0001193125-09-033975`(2009) · `0001193125-14-047522`(2014)

**그리고 두 class는 같은 날 다른 가격에 거래됐다.** `bars_daily` 직접 조회다.

| trade_date | `CMCSA` raw_close | `CMCSK` raw_close | 차이 |
|---|---|---|---|
| 2012-12-31 | 37.3599 | 35.92 | **+4.01%** |
| 2013-12-31 | 51.9699 | 49.88 | **+4.19%** |
| 2014-12-31 | 58.01 | 57.565 | +0.77% |
| 2015-12-10 | 59.6701 | 59.69 | −0.03% |

> **`reference_class_id`를 어느 쪽으로 잡느냐가 ME를 4% 넘게 바꾼다.** ratio는 1로 확정돼 있는데
> **곱할 가격이 둘이다.** 이것은 ratio 문제가 아니라 **reference 문제**이고, 지금 schema는
> `reference_class_id`를 **하나만** 받는다. **원문이 둘을 주면 `UNRESOLVED`가 맞다.**

**2015-12-11에 이 모호성이 사라진다.**

> "the shareholders of Comcast approved a proposal to amend and restate the Company's Amended and
> Restated Articles of Incorporation ... in order to **reclassify each issued share of Class A Special
> common stock into one share of Class A common stock** ... the New Articles and the Reclassification
> **became effective as of the close of business** that day. As result of the Reclassification,
> **there are no longer outstanding any shares of Class A Special common stock** ... NASDAQ has
> notified Comcast that trading of the Class A Special common stock **has ceased as of the close of
> business on December 11, 2015**."
> — 8-K `0000950103-15-009516`, accepted 2015-12-14 17:42:38

**`bars_daily`의 `CMCSK` 시계열이 정확히 `2015-12-11`에 끝난다**(n=2,504, 2006-01-03 ~ 2015-12-11).
**vendor 가격이 SEC 원문과 독립적으로 같은 날짜를 확인해준다.**

2016 formation 이후 원문은 단수다 — "The Class B common stock can be converted, **on a share for
share basis, into Class A common stock**." (`0001166691-20-000008` · `0001166691-25-000011`)

## N7. §9 ratio change event — Visa 2015 전수 분리

| 축 | 값 | 근거 |
|---|---|---|
| old ratio (class B) | **0.4121** | FY2014 10-K `0001403161-14-000017` |
| new ratio (class B) | **1.6483** | 2015 10-Q `0001403161-15-000007` (J4) |
| old ratio (class C) | **미확인** | 이번에 확인하지 않았다 |
| new ratio (class C) | **4.0** | 같은 10-Q |
| legal effective date | **2015-03-18** (dividend 지급일) | "received a dividend of three additional shares on March 18, 2015" |
| first public disclosure | 2015 Q2 10-Q | 같은 accession |
| **reference listed class market boundary** | **2015-03-19** | "Trading began on a split-adjusted basis on March 19, 2015" + vendor `split_date` (M5) |
| **subject shares boundary** | **없음** | class B·C 주식수 불변 (M9 `NO_SHARE_EFFECT`) |

**`0.4121 × 4 = 1.6484`이고 원문은 `1.6483`이다.** 반올림 차이이며 **원문 값을 쓰고 역산하지 않는다**
(M14의 `0.412075`가 역산값이었던 것과 같은 이유다).

> **conversion valuation boundary는 셋 중 무엇인가?**
>
> **reference market boundary(2015-03-19)다.** 이유는 semantic이지 편의가 아니다.
> `ME_unlisted = shares × ratio × reference의 December raw_close`인데
> **`raw_close`의 단위를 바꾸는 것은 reference class의 market boundary**이고(M2·M6 CLOSED),
> **`ratio`는 그 단위 변화를 상쇄하기 위해 바뀐다.** 두 항이 같은 사건의 양면이므로
> **같은 경계에서 함께 넘어가야 곱이 보존된다.**
>
> `legal effective date`(2015-03-18)를 쓰면 **하루 동안 새 ratio × 옛 단위 가격**이 곱해져
> ME가 4배 틀린다. **"split date니까 아마 그날"이 아니라, 곱의 단위 정합이 근거다.**
>
> **다만 이 표본에서 두 날짜는 하루 차이이고 12월 valuation session이 그 사이에 없다.**
> 따라서 **이 격자에서는 선택의 비용이 0이다.** 설계로 0인 것이 아니라 배치로 0이다(M11과 같은 한계).

## N8. §10 split과 conversion ratio의 독립성 — 세 모양이 다 관측된다

| type | 모양 | 관측 | ratio |
|---|---|---|---|
| **TYPE A** | subject·reference 둘 다 같은 비율로 split | **GOOGL 2022 ×20 (A·B·C)** · MA 2014 ×10 (A·B) · NKE 2012·2015 ×2 (A·B) · UA 2012·2014 ×2 (A·B) | **불변** (1 → 1) |
| **TYPE B** | reference만 basis 변화, subject 주식수 불변 | **V 2015 (A ×4, B·C 불변)** | **반대 방향으로 변경** (0.4121 → 1.6483) |
| **TYPE C** | subject/reference 관계 자체 변경 | **CMCSA 2015-12-11 Reclassification** (ref 후보 2개 → 1개) · **V 2024 B → B-1/B-2** | **새 legal interval 필요** |

> **issuer-wide multiplier 하나로 처리할 수 없다는 것이 여기서 확정된다.**
> GOOGL 2022와 V 2015는 둘 다 "그 issuer의 split"이지만 **ratio에 대한 효과가 정반대다.**
> TYPE 판정은 `event × class` 단위이지 issuer 단위가 아니다 — **M9가 shares 쪽에서 보인 것과 같은 구조다.**

## N9. §11 historical usability / lookahead

**legal interval만 맞으면 충분하지 않다.** 이 표본에서 legal effective가 evidence acceptance보다
**수년 앞서는 경우가 실제로 있다.**

- **Alphabet Class B의 1:1은 Google Inc 시절부터 법적으로 유효했다.** 그러나 **Alphabet(CIK 1652044)
  이름으로 그것을 증명하는 charter는 2015-10-02에야 접수됐다.** 2015 이전 formation에서
  Alphabet accession을 근거로 쓰면 lookahead다. **그 구간의 근거는 Google Inc charter
  (`0001193125-11-032930`, accepted 2011-02-11)여야 한다.**
- **Ford Class B의 1:1은 2001-03-22 restated certificate에 있다.** EX-4.B description(2020-02-05)은
  같은 내용을 **19년 뒤에** 다시 적은 것이다. **2010 formation에서 2020 accession을 쓰면 lookahead다.**

따라서 계약을 이렇게 둔다.

```text
usable_at(formation, mapping) iff
    historical_usable_session(source accession) <= formation      (acceptance에서 파생, §3.2)
  AND December valuation instant ∈ [legal_effective_from, legal_effective_to)
```

**두 조건은 AND이고 서로를 대체하지 않는다.** 앞은 knowledge 축, 뒤는 legal 축이다.

## N10. §12 retrospective disclosure — GROUND TRUTH와 USABLE DATA를 가른다

**later filing이 과거부터 존재한 conversion right를 명확히 기술하는 사례가 이 표본에 있다.**
Ford EX-4.B(2020)와 Alphabet 10-K(2016~)가 그것이다. 둘 다 **그 이전부터 유효했던 권리**를 적는다.

> **그 filing을 formation 이전으로 소급해 쓸 수 없다.** §3.2의 acceptance 불변식과 정확히 같은 이유다.
> **그러나 research ground truth로는 쓸 수 있다** — 이번 연구가 실제로 그렇게 했다.
> Ford 2020 EX-4.B를 읽고 "1:1이 맞다"를 확인한 뒤, **historical selector가 쓸 근거는 2001 charter로 따로 찾았다.**

**두 용도를 문서에 분리해 적는 것이 이 계약의 핵심이다.** 하나의 표에 섞으면 나중에
"우리가 이미 확인했다"가 "그때 알 수 있었다"로 조용히 바뀐다.

## N11. §13 amendment / restatement — 두 축을 합치지 않는다

Comcast Reclassification이 그대로 예제다.

```text
old interval 종료   legal effective 2015-12-11 close of business   <- legal 축
new interval 개시   legal effective 2015-12-11 close of business   <- legal 축
historical 사용 가능  acceptance 2015-12-14 17:42:38 이후            <- knowledge 축
```

**interval boundary는 acceptance가 아니라 legal effective date다.** 그러나 **그 새 interval을
historical backtest에서 쓰려면 formation이 acceptance 이후여야 한다.**
이 사례에서는 두 축이 3일 차이이고 다음 12월 valuation session(2015-12-31)이 둘 다 지난 뒤라
**이 격자에서 비용이 0이다.** 다시 말하지만 배치의 결과다.

## N12. §14 interval completeness — 현재 ratio를 gap에 backfill하지 않는다

**V Class C가 실제 gap 사례다.**

```text
ratio evidence   [2015-03-19, ?)   = 4.0        (원문 확인)
ratio evidence   [?, 2015-03-19)   = 미확인      <- 이번에 열지 않았다
```

**여기에 4.0을 backfill하면 2015 이전 전 구간이 조용히 4배 틀린다.**
§14 규칙대로 그 구간은 `MISSING interval`이고, 그래서 V Class C는 `INTERVAL_INCOMPLETE`다.

**연속성 없는 구간을 자동으로 채우지 않는다**는 규칙이 이 표본에서 실제로 무언가를 막는다는 뜻이다.

## N13. §15 provenance — 보존해야 할 항목

이번 연구가 anchor마다 실제로 들고 다닌 것이다. **정확한 SQL DDL은 만들지 않았다**(§19).

```text
subject_class_id              unlisted ordinary class
reference_class_id            같은 issuer의 listed ordinary class (단수여야 한다)
conversion_ratio              원문 수치 그대로 (역산 금지)
ratio_semantics               explicit-integer | one-for-one | share-for-share | equal-number
                              | escrow-adjusted | split-adjusted
legal_effective_from / to     원문이 말하는 법적 유효 구간
source_accession              그 근거 accession
source_form                   EX-3.x charter | 10-K | 10-Q | 8-K | EX-4.x description
acceptance_datetime           filing index 기준 (filing date가 아니다)
historical_usable_session     acceptance에서 파생 (§3.2)
source_document               문서 파일명
exact_source_span             인용 문장 원문
governing_instrument_ref      S1이 charter를 지시하면 그 charter accession
source / source_version       calendar·price와 같은 축
retrieval_date                2026-08-30
mapping_status                ELIGIBLE | INELIGIBLE | INTERVAL_INCOMPLETE | IDENTITY_UNRESOLVED
missing_reason                위 셋일 때 필수
```

**`ratio_semantics`를 따로 두는 이유가 META다.** 10-K는 "**an equivalent number of shares**"라고
쓰는데 charter는 "**one (1)**"이라고 쓴다. **둘 다 1이지만 근거의 강도가 다르다.**
semantics를 지우고 `1.0`만 남기면 **어느 것이 charter 확정이고 어느 것이 서술 문구인지 사라진다.**

## N14. §16 현재 `qv_class_valuation` fit check — **표현할 수 없다**

**결론만 적는다. schema는 수정하지 않았다.**

현재 구조는 이렇다(`trading/backtest/schema.sql` · `qv_identity.ClassValuation`).

```text
class_id · valuation_method · reference_class_id · conversion_ratio
effective_from · effective_to · source_accession · missing_reason
source · source_version · provenance
```

| 이번 semantics | 현재 표현 가능? | 근거 |
|---|---|---|
| **legal interval** | ⚠ **부분** | `effective_from/to`가 하나뿐이다 |
| **knowledge / usability time** | **❌ 불가** | acceptance·`historical_usable_session` 칼럼이 없다 |
| reference class 단수성 | ✅ | `reference_class_id` 하나 + CHECK |
| ratio 값 | ✅ | `conversion_ratio > 0` |
| ratio semantics | ❌ | 칼럼 없음 — `provenance` 자유텍스트에 섞인다 |
| exact source span | ❌ | 칼럼 없음 |
| missing 사유 | ✅ | `missing_reason` |

**세 가지를 지적한다.**

1. **`effective_from/to` 하나가 두 의미를 겸하고 있다.** `valuation_at(connection, class_id, as_of,
   source_version)`은 `as_of` **하나**로 조회한다. **legal 축과 knowledge 축이 다를 때 어느 것으로
   질의하는지 코드가 말하지 않는다.** N9가 보인 대로 Alphabet은 두 축이 4년, Ford는 19년 벌어진다.
   **지금 구조로 legal interval을 넣으면 lookahead가 열리고, usability interval을 넣으면
   legal 질문에 답할 수 없다.**
2. **`source_accession`은 있는데 `acceptance_datetime`이 없다.** accession에서 acceptance를 다시
   찾아와야 하고, **`qv_sec_filings`는 form을 `10-K/10-K/A/10-Q/10-Q/A` 넷으로 제한하므로
   charter가 실린 8-K accession을 그 표로 해석할 수 없다.** N3이 보인 대로 **canonical 근거의
   상당수가 8-K exhibit이다.**
3. **`CHECK`가 `conversion_ratio > 0`만 본다.** Visa처럼 값 자체는 양수인데 **deterministic이
   아닌** 경우를 막지 못한다. 막는 것은 schema가 아니라 등록 절차여야 한다.

> **권고는 "지금 고치자"가 아니라 "지금 넣지 말자"다.** 이 semantics를 현재 두 칼럼에 밀어넣으면
> **의미가 섞인 채로 데이터가 쌓이고 나중에 어느 행이 legal이고 어느 행이 usable인지 복원할 수 없다.**
> 실제 DDL 변경은 §19대로 이번 범위 밖이다.

## N15. §17 20-issuer impact — class/year · issuer/year diagnostic

**격자는 H7과 같다** — 20 발행사 × formation `2010`~`2026`(17개).
**unlisted ordinary class는 11개**이고 class-formation 관측은 **146개**다.

> **이 146이 M9.1의 `unlisted 146 observation`과 정확히 일치한다.** 독립적으로 재구성한 수가
> 맞은 것이므로 **같은 class universe를 보고 있다는 corroboration이다.** 증명은 아니다.

| issuer | class | formation 구간 | n | 판정 | 사유 |
|---|---|---|---|---|---|
| GOOGL | B | 2016~2026 | 11 | **ELIGIBLE** | S0 charter 1:1, ref = Class A (listed) |
| META | B | 2013~2026 | 14 | **ELIGIBLE** | S0 charter 1:1, ref = Class A (listed) |
| F | B | 2010~2026 | 17 | **ELIGIBLE** | S0 restated certificate 1:1, ref = Common (listed) |
| CMCSA | B | 2010~2015 | 6 | **INELIGIBLE** | reference 후보 2개(A / A Special), 가격 4% 상이 |
| CMCSA | B | 2016~2026 | 11 | **ELIGIBLE** | A Special 소멸(2015-12-11) 후 reference 단수 |
| MA | B | 2010~2026 | 17 | **ELIGIBLE** | S1 `one-for-one`, ref = Class A (listed) |
| NKE | A | 2010~2026 | 17 | **ELIGIBLE** | S1 `one share`, ref = **Class B** (listed) |
| UA | CONV | 2010~2026 | 17 | **IDENTITY_UNRESOLVED** | prose `Class B` ≠ registry `CONV`; 2016 `Class C`는 다른 class |
| V | B | 2010~2024 | 15 | **INELIGIBLE** | escrow·VWAP 공식 연동, 미전환기 존재 |
| V | B-1 | 2025~2026 | 2 | **INELIGIBLE** | 같은 구조 승계 |
| V | B-2 | 2025~2026 | 2 | **INELIGIBLE** | 같은 구조 승계 |
| V | C | 2010~2026 | 17 | **INTERVAL_INCOMPLETE** | 2015 이후 `4.0`만 확인, 이전 구간 미확인 |

| 판정 | class/year | 비율 |
|---|---|---|
| **ELIGIBLE** | **87** | 59.6% |
| INELIGIBLE | 25 | 17.1% |
| IDENTITY_UNRESOLVED | 17 | 11.6% |
| INTERVAL_INCOMPLETE | 17 | 11.6% |
| 합계 | **146** | 100% |

**issuer/year diagnostic** — unlisted ordinary class를 가진 **8개 발행사만**이 분모다.
**Gate C를 계산하지 않았고 B/M · rank · returns도 계산하지 않았다.**

| issuer | issuer-year | conversion mapping 때문에 `MISSING` |
|---|---|---|
| CMCSA | 17 | **6** (2010~2015) |
| F | 17 | 0 |
| GOOGL | 11 | 0 |
| MA | 17 | 0 |
| META | 14 | 0 |
| NKE | 17 | 0 |
| UA | 17 | **17** |
| V | 17 | **17** |
| **합계** | **127** | **40 (31.5%)** |

> **issuer 하나가 통째로 막히는 방식이 둘이다.** **V는 ratio가 구조적으로 부적격**이라 영구적이고,
> **UA는 ratio가 멀쩡한데 identity 층이 막는다** — 후자는 prose class-name 매핑이 열리면 풀린다.
> **`CONVERSION_VALUE_PROXY`의 남은 실패 대부분이 valuation 문제가 아니라 identity 문제라는 뜻이다.**

## N16. ground truth 확인 범위

**§9·F14·G15·H14·I13·J9·K9·L14·M14와 같은 기준이다. 146 관측 전부를 사람이 원문과 1:1 대조하지 않았다.**

| 대상 | 원문 | 결과 |
|---|---|---|
| 6 anchor의 conversion wording | 발행사별 10-K 4개(early/mid/recent) 직접 조회, 총 24건 | N5 |
| Alphabet · Google Inc · Facebook charter | EX-3.x 원문 직접 조회 4건 | N3·N5 |
| Ford restated certificate + EX-4.B | `0000037996-01-000014-0002.txt` · `f12312019exhibit4-b.htm` | N5 |
| Comcast Reclassification | 8-K `0000950103-15-009516` 원문 | N6-F |
| `CMCSA` / `CMCSK` 가격 | `bars_daily` 직접 조회 | N6-F |
| Visa conversion rate 값 | FY2009 · FY2014 10-K 원문 + Follow-up 4 J4 인용 | N5·N7 |
| BRK 1,500:1 대조군 | 10-K 3건 원문 | N5 |
| acceptance datetime | EDGAR filing index 직접 조회 12건 | N2·N5 |

**정직하게 적을 한계 다섯.**

1. **발행사별로 10-K을 4개만 읽었다.** 중간 연도에 문구가 바뀌었을 가능성을 배제하지 않았다.
   특히 **MA의 2009 → 2014 사이에 문구가 실제로 바뀌었다**(conversion transaction 제한 →
   무제한). 다른 발행사에도 비슷한 변화가 있을 수 있다.
2. **V Class C의 2015 이전 rate를 확인하지 않았다.** `INTERVAL_INCOMPLETE` 판정의 근거가
   "없다"가 아니라 "이번에 찾지 않았다"이다.
3. **formation 활동 구간(GOOGL 2016~ · META 2013~)은 재구성이다.** 146이 M9.1과 일치한 것이
   방증이지만 probe의 원래 격자 행을 그대로 대조하지는 않았다.
4. **CMCSA 2010~2015 `INELIGIBLE` 판정은 보수적 선택이다.** 원문이 `A 또는 A Special`을 주고
   두 가격이 다르다는 것까지가 실측이고, **"그러므로 UNRESOLVED"는 이번 연구의 판단이다.**
   전환 실적이 어느 쪽으로 갔는지는 조사하지 않았다.
5. **META를 `ELIGIBLE`로 놓은 근거는 charter 한 건이다.** 2012-07-31 이후 charter 개정
   (`0001326801-20-000084` 2020 · `0001326801-21-000071` 2021 · `0001326801-24-000069` 2024)의
   본문을 읽지 않았다. **1:1이 유지됐다고 가정하지 않았고, 그 구간을 확인하지 않았다고 적는다.**

## N17. 이번에 결정하지 않은 것 (§19)

1. prose class-name → `class_id` schema
2. `qv_share_class_xbrl_aliases` exact DDL
3. event ledger DDL
4. production extractor · production identity ingest
5. shares observation storage
6. unexplained cross-accession conflict
7. Gate C · `coverage_start`
8. B/M · rank · returns
9. **`qv_class_valuation` 실제 schema 변경** — N14가 필요성을 보였지만 이번에 만들지 않았다

## User decision — PIT conversion-value mapping

### 추천: **A — SEC-filed governing/legal evidence의 fixed direct ratio만 허용하고 PIT usability를 별도로 강제한다**

```text
CONVERSION_VALUE_PROXY(unlisted ordinary class, formation)

  1) evidence는 SEC-filed explicit disclosure만 쓴다
        S0 governing instrument (certificate / charter / amendment / 법적 효력 exhibit)
        S1 10-K · 10-Q 본문의 explicit conversion-right 공시
        S2 8-K · proxy 등 explicit transaction 공시   (interval boundary용)
     S3 issuer website · S4 vendor는 corroboration으로만 쓰고 단독 근거로 쓰지 않는다

  2) reference_class_id는 단수여야 한다
        같은 issuer의 listed ordinary common class 하나
        원문이 둘 이상을 주면 (CMCSA ~2015형) UNRESOLVED -> fail-close
        reference가 Class A라고 가정하지 않는다 (NKE는 Class B다)

  3) ratio는 원문 수치를 그대로 쓴다
        explicit-integer | one-for-one | share-for-share | equal-number 만 fixed로 인정
        역산하지 않는다 (0.4121 x 4 를 1.6483으로 쓰지 않는다)
        ratio_semantics를 함께 보존한다

  4) 다음은 fixed로 인정하지 않는다 -> MISSING
        economically equivalent · voting equivalence · derived equivalent shares
        liquidation equivalence · approximate ratio · board discretion
        litigation / escrow adjustment · security price 연동 공식 (V형)
        transfer 조건만 보고 추정한 것

  5) PIT usability (두 조건 AND)
        historical_usable_session(source accession) <= formation      (acceptance 파생)
        December valuation instant  in  [legal_effective_from, legal_effective_to)

  6) interval은 자동으로 잇지 않는다
        근거 없는 구간은 MISSING interval
        현재 ratio를 과거 gap에 backfill하지 않는다 (V C형)

  7) ratio change event의 conversion valuation boundary는
        reference listed class의 market boundary다  (Follow-up 6 계약 그대로)
        legal effective date나 임의 +/-N일 window를 쓰지 않는다

  8) class identity가 미해결이면 ratio가 맞아도 UNRESOLVED -> fail-close
        prose class-name -> class_id는 아직 OPEN이다 (UA형)
```

**A를 고른 이유는 coverage가 아니라 실측이다.**

- **B(periodic filing의 descriptive wording으로 충분)를 단독으로 쓸 수 없다.** **Alphabet 10-K에는
  비율이 없다**(N3). B만 쓰면 GOOGL Class B가 전 구간 `MISSING`이 되고, 이 표본에서 **11 class-year**를
  잃는다. **S0를 canonical에 넣는 것이 A의 핵심이고, 그것이 실제로 무언가를 살린다.**
- **C(formula/contingent도 deterministic하게 계산 가능하면 허용)를 채택하지 않는다.** Visa가
  반증이다. **rate가 escrow 입금과 class A VWAP에 의존하므로 formation 시점에 다음 값을 알 수 없다.**
  "계산 가능"이 "PIT로 계산 가능"을 뜻하지 않는다. **C를 열면 이 표본에서 유일하게 늘어나는 것이
  Visa 19 class-year인데, 그것이 정확히 silent wrong이 나는 자리다.**
- **D(proxy 자체를 포기하고 전부 MISSING)는 비용이 크고 근거가 없다.** A에서 **87/146 (59.6%)이
  원문으로 닫힌다.** D를 고르면 그 87을 근거 없이 버리고, §4.4.2가 경고한 **multi-class 발행사만
  `B/M`이 체계적으로 높아지는 왜곡**을 그대로 남긴다.
- **A의 비용이 이 격자에서 40 issuer-year(8개 다중 class 발행사의 31.5%)다.** 그중 **17이 UA이고
  valuation이 아니라 identity 때문**이라, prose class-name 매핑이 열리면 되찾는다.

### 함께 기억할 것 다섯

1. **비율은 10-K에 없을 수 있다.** Alphabet은 4개 회계연도 10-K 전부가 방향과 촉발조건만 말하고
   **`one (1)`은 charter에만 있다.** **S1 전용 계약은 이 발행사에서 조용히 실패한다.**
2. **reference가 하나라는 보장이 없다.** Comcast Class B는 2015-12-11까지 **`Class A 또는
   Class A Special`** 둘로 전환됐고 **두 가격이 같은 날 4% 넘게 달랐다.** ratio가 1로 확정돼
   있어도 **곱할 가격이 둘이면 ME가 정해지지 않는다.**
3. **reference가 항상 Class A인 것도 아니다.** **NKE는 Class A(비상장) → Class B(상장)다.**
   방향을 이름으로 추정하면 뒤집힌다. 그리고 **BRK는 1,500:1 단방향**이라 역수로 뒤집을 수도 없다.
4. **legal 시간과 knowledge 시간이 이 표본에서 최대 19년 벌어진다**(Ford: 2001 charter vs
   2020 EX-4.B). **하나의 `effective_from/to`로 둘을 표현하면 lookahead가 열리거나 legal 질문에
   답할 수 없어진다** — 현재 `qv_class_valuation`이 정확히 그 상태다(N14).
5. **남은 실패의 절반은 valuation이 아니라 identity다.** 막힌 40 issuer-year 중 **17(UA)이 ratio는
   1:1로 명확한데 prose 이름과 `class_id`가 연결되지 않아서 막힌다.** **다음에 열어야 할 것은
   conversion 연구가 아니라 prose class-name 매핑이다.**

**이 follow-up도 research 결과일 뿐 아직 CLOSED/FROZEN 계약이 아니다.**
