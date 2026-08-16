# 실험 산출물 색인

**폴더 하나가 질문 하나다.** 각 폴더의 `README.md`가 무엇을 물었고 무엇이 답이었는지 적고,
이 파일은 그 목록을 PR 번호·층·상태로 잇는다.

전략 구축 계약은 `docs/momentum-v2-roadmap.md`이고, 실측·완료 기록의 정본은
`docs/Swing Trading Agent Design v2 2.md` 20.0절이다.

## 층을 구분해서 읽는다

|층|무엇을 재는가|
|---|---|
|**신호(signal)**|포트폴리오 없이 신호만. 슬롯·수량·비용·청산을 뺀 자리에서 forward excess를 본다|
|**포트폴리오(portfolio)**|슬롯·수량·비용·체결·청산이 붙은 실제 실행|
|**진단(diagnostic)**|둘 사이가 어디서 끊기는지|

**신호 층 결과를 포트폴리오 결론으로 읽지 않는다.** PR #10·#11·#13·#14가 반복해서 보여준
것이 정확히 그 번역 실패다.

## 목록

|폴더|PR|층|물은 것|답|
|---|---|---|---|---|
|`baseline/`|—|포트폴리오|동결된 `paper-core-v1` 기준선 보고서|2026-08-10 기록. **지금 엔진과 다른 숫자라 견주지 않는다**|
|`signal-rs63/`|#9|신호|`RS(63,5)` 극단 상위에 미래 초과수익 정보가 있는가|긴 지평·평균의 성질로만 있다. 유니버스 폭에 의존|
|`jt-jk/`|—|포트폴리오|K21/K42와 CORE exit 조합|`jt-core-exit` −23.07%. **CORE exit 일괄 부활 금지의 근거**|
|`jt-k-lifetime/`|#10|포트폴리오|긴 신호 수명(K=42/63/84)이 수익이 되는가|되지 않는다. **K42를 기준선으로 유지**|
|`jt-random/`|—|포트폴리오|무작위 랭킹 대조군|양수 기대값은 아무것도 증명하지 않는다|
|`jt-slot-capacity/`|#11|포트폴리오|5슬롯이 긴 K의 병목이었는가|**아니다.** 병목은 슬롯이 아니라 후보 공급|
|`jt-slot-capacity/diagnostic/`|#11|진단|TOP5 churn과 진입 랭크 집중도|**사전등록 아님.** 랭크 집중도 축은 닫았다|
|`signal-j-study/`|#12|신호|형성기간 J가 TOP5 초과수익을 어떻게 바꾸는가|구조가 있고 긴 J가 우세. challenger는 J126 하나|
|`j126-portfolio-translation/`|#13|포트폴리오|J126 신호 우위가 포트폴리오로 번역되는가|**되지 않는다.** 개발 기준선은 J63 유지|
|`signal-to-portfolio-funnel/`|#14|진단|우위가 어느 단계에서 사라지는가|**`NO_CLEAR_STAGE` · `INCONCLUSIVE`**|
|`market-condition-signal/`|#15|신호|RS alpha가 `SPY > SMA200`에 집중되는가 (**confirmatory re-cut**)|`PROMOTE_TO_PR16` · 연도 `CONCENTRATED`|
|`market-gate-portfolio/`|#16|포트폴리오|SMA200 신규진입 게이트가 economics를 개선하는가|`ECONOMICS_AND_RELATIVE_IMPROVED` · 최종 게이트는 여전히 미달|
|`absolute-momentum-signal/`|#17|신호|`ABS(126,5)>0` 후보 조건이 TOP5 +42 excess를 높이는가|**`NON_BINDING`** — 3,385일 중 구성 변경 0일 · `DO_NOT_PROMOTE`|
|`signal-invalidation-exit/`|#18|포트폴리오|시장 추세가 깨질 때 나가는 것이 fixed K42보다 나은가|**`RISK_ONLY`** — `ΔS -15.57%p` · MDD만 개선 · **fixed K42 유지**|

## 폴더를 층별 하위 디렉터리로 옮기지 않은 이유

각 러너가 `RUNS_DIR / EXPERIMENT`로 경로를 만들고(`selftest/*_run.py`의 `EXPERIMENT` 상수),
각 폴더 `README.md`와 `CLAUDE.md`가 그 경로를 이름으로 인용한다. 옮기면 러너 6개와 문서
10곳 이상을 함께 고쳐야 하고, **과거 보고서의 상호 참조가 전부 어긋난다.** 분석적으로 얻는
것은 없고 재현 경로만 흔들리므로 물리적 이동 대신 이 색인을 둔다.

## 새 폴더를 만들 때

- 폴더 하나에 질문 하나. `README.md`가 **결과를 보기 전에** 사전등록을 담고, `results.md`가
  생성물이다.
- 사전등록과 탐색적 후속 진단을 **같은 문서 안에서 반드시 분리한다**(`#11`·`#14`가 선례다).
- 이 색인에 한 줄 추가한다.
