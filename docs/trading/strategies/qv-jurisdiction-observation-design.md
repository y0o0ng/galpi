# QV Phase 0 — 설립관할 관측 source 계약

**이 문서가 Phase 0 설립관할 OBSERVATION의 정본이다.**

```text
status   CLOSED / FROZEN for Phase 0 jurisdiction-observation source selection
근거     trading/runs/qv-data-audit/README.md §10.43 · §10.44 · §10.45 · §10.46 · §10.47
전수     같은 README §10.48 (승인된 계약으로 다시 잰 전수 census)
```

**이 문서는 Step 4 설계도 5A-2 법적 증거 설계도 대체하지 않는다.** 두 문서는 그대로다.
여기서 정하는 것은 **"어느 SEC source가 관할 관측을 말하는가"** 하나다.

> **이것은 법적 설립 발효일 계약이 아니다.** 아래 §1의 비목표를 그 자리에서 읽는다.

---

## 1. 관측의 의미

정의하는 관측은 하나다.

```text
SEC_FILING_JURISDICTION_OBSERVATION
  = "이 선택된 SEC accession에서 제출물이 관할 code X를 보고한다."
```

관측의 가용 시점은 **새로 만들지 않는다.** 선택된 accession이 이미 갖고 있는
`historical_usable_session`을 그대로 쓴다. 새 timestamp를 도입하지 않는다.

**이 관측이 세우지 않는 것** — 하나도 예외가 없다.

```text
법적 설립 발효 시점        주 제출(state filing) 시점        재설립 발효 경계
filing 앞뒤의 관할 연속성   class 탄생                        RelationInterval
B2 연대기                  Option A 유효성
```

filing이 **무엇을 적었는지**만 판정한다. 그 이상으로 키우지 않는다.

---

## 2. source 계약 — 승인된 정책 B

정확한 선택 accession 하나에 대해 **XBRL이 먼저다.**

```text
FIRST   SAME_ACCESSION_XBRL
        target   dei:EntityIncorporationStateCountryCode
```

fact 요건은 §10.44~§10.47에서 쓰던 것 그대로이고 **하나도 완화하지 않는다.**

```text
공식 DEI namespace            context.cik == selected_cik
context.dimensionless == True fact.unit_id is None
정규화 후 비어 있지 않은 raw_value
정규화 = 공백 strip + ASCII 대문자화 (퍼지 매핑 없음)
서로 다른 정규화 code가 정확히 하나
```

```text
XBRL_EXACT                -> jurisdiction_code = XBRL code · authority = XBRL_EXACT
XBRL_ABSENT_NO_INSTANCE       사용 가능한 instance가 없다
XBRL_ABSENT_FACT_MISSING      instance는 있으나 요건을 만족하는 fact가 0개
XBRL_AMBIGUOUS                서로 다른 정규화 code가 2개 이상
XBRL_FETCH_INCOMPLETE         전송 / 파서 불완전
```

**discovery 경로는 동결된 production 읽기 전용 기계를 그대로 쓴다.**

```text
accession index JSON -> FilingSummary(있으면) -> candidate_xml_names()
  -> looks_like_instance() -> parse_instance()
```

```text
금지   companyconcept · companyfacts · 현재 SEC company profile · 다른 accession
금지   파일명만으로 instance 여부를 추정하는 것
```

`qv_xbrl` semantics는 **바꾸지 않는다.**

### SGML header는 XBRL이 있을 때 진단용이다

`XBRL_EXACT`가 났는데 header exact가 **다른** 값을 말하면, 최종 관측은 **XBRL 값 그대로**다.

```text
source_disagreement = true 로 기록하고 양쪽 raw 값과 provenance를 모두 보존한다
그 accession에서 header 값을 canonical이라고 부르지 않는다
```

---

## 3. header fallback — provisional 전용

header로 내려가는 것은 **XBRL이 명시적으로 부재할 때뿐이다.**

```text
허용   XBRL_ABSENT_NO_INSTANCE · XBRL_ABSENT_FACT_MISSING
그때 HEADER_EXACT이면
  jurisdiction_code = header code
  authority         = HEADER_ONLY_PROVISIONAL
```

이 값은 **조달·노출 측정에 쓸 수 있는 관측**이지만 `XBRL_EXACT`와 **권위가 같지 않다.**

> **header-only 값은 모든 산출물과 집계에서 provisional로 눈에 보이게 표시한다.**
> 하나의 뭉뚱그린 신뢰도 주장 안에 provisional coverage를 숨기지 않는다.

---

## 4. 모호·전송 실패는 fallback하지 않는다 — fail-close

**부재 ≠ 모호 ≠ 전송 실패.** 셋을 접어 합치지 않는다.

```text
XBRL_AMBIGUOUS        -> JURISDICTION_UNRESOLVED_XBRL_AMBIGUOUS
XBRL_FETCH_INCOMPLETE -> JURISDICTION_SOURCE_INCOMPLETE
```

둘 다 **exact header가 있어도 그리로 내려가지 않는다.** 상위 증거가 모호하거나 못 받은 것은
"자료가 없다"가 아니라 "판정할 수 없다"이고, 하위 source로 덮으면 그 구분이 사라진다.

반대 방향도 고정한다 — **`XBRL_EXACT`가 이미 관측을 확정했으면**, 하위 header 증거가
없거나·모호하거나·못 받았다는 사실은 그 exact XBRL 관측을 **무효로 만들지 않는다.**

---

## 5. 최종 상태 모델과 진단 필드

```text
JURISDICTION_XBRL_EXACT
JURISDICTION_HEADER_ONLY_PROVISIONAL
JURISDICTION_UNRESOLVED
JURISDICTION_SOURCE_INCOMPLETE
```

두 source의 raw 관측은 **서로 덮지 않는다.** 아래를 각각 따로 보존한다.

```text
xbrl_status · xbrl_code · header_status · header_code · source_disagreement
```

**confidence score를 만들지 않는다.** 권위는 위 네 상태와 `authority`로만 말한다.

---

## 6. 제출 표지는 production source가 아니다

§10.47의 `FILED_PRIMARY_COVER`는 **연구용 adjudication source**였다. 이 설계가 왜 선택됐는지에
대한 **검증 증거**로 남고, 승인된 census / production cascade에는 **들어가지 않는다.**

```text
구현하지 않는다   XBRL -> 표지 -> header cascade
만들지 않는다     일반화된 표지 parser
재사용하지 않는다 160자 guard를 production semantics로
```

§10.47의 표지 증거로 전수 census의 개별 행을 **조용히 승격시키지 않는다.**

---

## 7. transition semantics

**관측된 code 변화를 법적 재설립이라고 부르지 않는다.** 한 번도 예외가 없다.

CIK마다 최종 resolved 관측을 기존 관측 시점 / accession 순서로 정렬하고, 인접한 collapsed code가
다르면 기록한다.

```text
OBSERVED_JURISDICTION_CODE_CHANGE   (+ authority pair)
```

```text
XBRL_EXACT -> XBRL_EXACT                     => XBRL_OBSERVED_CHANGE
그 외 (HEADER_ONLY_PROVISIONAL이 한쪽이라도) => PROVISIONAL_OBSERVED_CHANGE
```

`XBRL_EXACT -> XBRL_EXACT`만 `XBRL_OBSERVED_CHANGE`로 부를 수 있다.
provisional이 낀 전이는 **"corroborated transition"이 아니다.** 그렇게 적지 않는다.

---

## 8. 이 계약을 고른 근거 — §10.47 측정치

결정론적 화해 population에서 잰 값이다. 추론이 아니라 관측이다.

```text
header·XBRL 둘 다 exact          61건 → 일치 46 · 불일치 15
그 불일치 15건의 제출 표지        표지 사용가능 15 / 15
  표지 == XBRL      15            표지 == header     0        표지 == 둘 다 아님   0
일치 46건 중 표지가 있는 42건     42 / 42 표지도 같은 값
header-only vs 표지               불일치 3건
```

**표지가 header 편을 든 충돌 사례는 그 population에서 하나도 없었다.**
불일치 15건에서 header가 가리킨 값은 대부분 그 등록인의 **본사 주(州)**였다.

그래서 header는 **과거 구간 coverage에는 여전히 유용하지만**, 같은 accession의 exact DEI XBRL과
**권위가 같지 않다.** 이것이 정책 B의 근거 전부다.

한계도 같이 고정한다.

```text
1  population이 transition 주변으로 편향돼 있다 — 전수 비율로 읽지 않는다.
2  표지 판독 87 / 138이 MODEL_ASSISTED이고, guard 없이는 3건을 틀리게 읽었다.
3  XBRL이 없는 구간(초기 전체)에서는 header가 여전히 유일한 source다.
4  §10.47의 guard 정정은 결론에 **유리한** 방향으로 작용했으므로 독립 확인이 아니다.
```

---

## 9. 이 문서가 하지 않는 것

```text
production 관할 코드 · schema · qv_xbrl · qv_submissions semantics 변경   전부 NO
표지 parser productionization                                            NO
주 등록부 · 상용 vendor · 유료 조달                                       NO
법적 발효일 · 관할 interval · 재설립 법적 경계                            NO
O2 / O2-C · B2 · RelationInterval · class 탄생 / class-id · Option A     NO
5A-3 / Gates · accounting · returns / ranking / portfolio                 NO
```

**Phase 0 DATA ONLY다.** 이 계약은 관측 source 선택을 얼리는 것이고, 그것을 production에
넣는 것은 별도 작업이다.
