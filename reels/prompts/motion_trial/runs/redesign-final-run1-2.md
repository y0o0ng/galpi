# 13편 최종 대본 — 물에 의한 손끝 주름 (유입용 주제, 뉴스 계기 없음)

## 0. 검토 결과

### A. 편집 판단 (초안 메모 "확신 없는 곳"과 길이)

1. **`secs.py` 미실행(메모 1) → 실행해 확정.** 최종 13문장 전 조각 `PASS`, 종료 코드 0(합계 57.43초). 본편 **62.8초**, 도장 포함 **67.0초**다. 손 계산의 빠듯한 곳(S3 146px, S1 둘째 조각 143px)도 실측으로 한 카드라서 S3은 끊지 않는다.
2. **원문 대조 미실행(메모 2) → `factcheck.py` 0 missing으로 확정.** PMC 두 논문은 코드가 받는다. PubMed 페이지는 코드가 못 받아서 각 행에 Europe PMC 초록 JSON URL을 함께 둔다(PubMed URL은 캡션용으로 남긴다).
3. **"불어서가 아니라"(메모 3-2) → 약하게 고친다.** Sáez & Zöllner 2017 초록이 "아래층 수축과 윗층 팽윤은 동시에 일어나고, 둘이 함께 작용해야 주름이 된다"고 써서, 팽윤을 부정하는 단정은 출처 범위를 넘는다. 그래서 훅·S13은 "불어서**만이** 아니라", S2는 "**핵심은** 속이 줄어드는 거예요", S5는 "**불기만 해서** 생긴다면"으로 고친다. 역설(불어나는 줄 알았는데 줄어든다)은 그대로 남는다.
4. **피부를 끌어당기는 단계가 "postulated"(메모 3-1) → S8만 "주름이 진다고 봐요"로 한 번 낮춘다.** 원인이 신경이 일으키는 혈관 수축이라는 점은 신경 손상 관찰과 EMLA 실험이 받쳐서 단정으로 둔다. 다만 "음압이 피부를 당긴다"는 역학은 Wilder-Smith 2015가 가정이라고 쓴 모형이다.
5. **진화 논쟁 장면 `debate`(S12·S13, 메모 3-3) → 통째로 뺀다.** "왜 그렇게 진화했나"(기능)는 이 편의 개념("어떻게 생기나", 메커니즘)과 다른 두 번째 질문이다. 결론 없이 10초를 쓰고, 빼도 이해에 지장이 없다. 이 때문에 사실 확인 10·11·12·G2 행과 Kareklas의 12% 숫자도 같이 빠진다.
6. **신경이 다친 손가락(메모 3-4) → 초안대로 둔다.** Haseleu 서론의 정중신경 마비·재접합 손가락 정리로 충분하다. "거의 안 생겨요"는 출처("absence", "failed to wrinkle")보다 약한 표현이라 범위 안이다.
7. **G1 숫자 배정(메모 4) → EMLA 2.01, 물 2.29로 화면에 둔다.** 두 값 모두 cm/s라 "respectively"는 앞의 "EMLA and water immersion"에 걸리는 것으로만 읽힌다. 화살표 길이는 같게 그리므로, 설령 바뀌어도 그림의 뜻("거의 같다")은 변하지 않는다.
8. **베개 비유 S9(메모 5) → 남긴다.** 한 문장·그림 하나이고, "속은 줄고 겉면은 그대로라 접힌다"는 원리와 같은 쪽으로 이끈다. 피가 덜 차서 속이 줄어드는 것과 솜이 빠지는 것도 방향이 같다. S8 뒤에만 둔다.
9. **S11 "피가 줄어든" → "혈류가 줄어든".** 출처가 잰 것은 손끝 혈류(cm/s)의 감소이고 피의 양이 아니다.
10. **S14 "몸이 일으키는" → "신경이 일으키는".** 검사에 쓰이는 이유가 신경 의존이라는 점(출처의 "test of sympathetic nerve function")을 문장이 바로 말하게 했다.
11. **길이와 삭제 순서.** 67.0초로 60~90초 안이고 개념은 하나다. 더 줄여야 하면 S9(비유) → S11(혈류) → S3을 S4에 합치는 순서로 뺀다. 지금은 빼지 않는다. S11은 "혈관 수축만으로 같은 결과"를 숫자로 받치는 깊이이고, S12는 신경이 원인이라는 점의 쓸모라서 남긴다.

### B. 사실 확인 재검증 (초안 16행 기준)

원문은 이 검토에서 다시 받았다. [HAS]는 PMC·PLoS, [KAR]은 PMC(본문)와 Europe PMC(초록), [WS03]·[WS15]·[SZ]는 Europe PMC 초록 JSON이다. 최종 목록은 `factcheck.py` 0 missing이다.

| 초안 # | 판정 | 내용 |
| --- | --- | --- |
| 1 | PASS | 원문 그대로이고 S1을 받친다 |
| 2 | WEAKEN | 인용은 원문에 있다. 다만 "osmotic swelling … in fact due to"가 S2 "사실은 속이 줄어서"를 받쳐도, [SZ] "will happen simultaneously"와 부딪친다. S2·훅을 "핵심은 / 만이 아니라"로 낮추고 [SZ] 인용을 더했다. KAR 둘째 인용은 원문이 "caused by vasoconstriction" 뒤에서 이어지지 않아(인용 표시 추정) 거기서 끊었다 |
| 3 | PASS | 원문 그대로이고 S3·S4를 받친다 |
| 4 | WEAKEN | 인용은 PASS. S5를 "불기만 해서 생긴다면"으로 고치고, 그 추론을 직접 받치는 [SZ] "can not exceed this swelling level … patients with such neurological disorders"를 더했다 |
| 5 | PASS(인용 1개 FAIL → 교체) | [WS15]는 PASS. [HAS] "induces sympathetic nervous system-dependent vasoconstriction"은 원문에서 "they suggested that dyselectrolytemia caused by water entry through sweat ducts …"의 일부라, 대본이 뺀 땀구멍 가설의 문장이다. 그래서 [HAS] "showed that water-induced skin wrinkling is directly linked to vasoconstriction"으로 바꿨다 |
| 6 | PASS | [KAR] 본문(단정형)과 [WS15](postulated)가 함께 받친다 |
| 7 | WEAKEN | [WS15]는 "postulated"이고, [HAS] 인용도 같은 땀구멍 가설 문단의 이어지는 문장이다. [HAS] 인용은 빼고 S8을 "주름이 진다고 봐요"로 낮췄다 |
| 8 | PASS | 원문 그대로 |
| 9 | WEAKEN | 인용은 PASS. "피가 줄어든"을 "혈류가 줄어든"으로 고쳤다 |
| 10 | 삭제(편집) | `debate` 장면 삭제. [HAS] 인용 "Furthermore, the finding …"은 원문에 "Furthermore,"가 없었다(원문은 "The finding that …"). 삭제와 무관하게 고쳐야 했던 곳이다 |
| 11 | 삭제(편집) | `debate` 장면 삭제 |
| 12 | 삭제(편집) | `debate` 장면 삭제 |
| 13 | PASS | 원문 그대로. S12를 "신경이 일으키는"으로 바꾼 것도 받친다 |
| 14 | WEAKEN | S13을 "불어서만이 아니라"로 고쳤다. [KAR] 인용도 2번과 같은 자리에서 끊었다 |
| G1 | PASS | 원문 그대로. 배정은 A-7 |
| G2 | 삭제(편집) | `debate` 장면 삭제 |

합계: **PASS 7(1·3·5·6·8·13·G1), WEAKEN 5(2·4·7·9·14), FAIL 0행**(5번 행의 인용 1개만 FAIL이라 교체했다), 편집 삭제 4행(10·11·12·G2). 새로 더한 출처는 [SZ] Sáez & Zöllner 2017이다.

### C. 제작 제약 수정

- **`debate` 삭제**에 따라 장면은 6개다. 화면 글자 `2013`·`2014`·`WET GRIP`·`-12% TIME`·`NO CHANGE`를 목록에서 뺐다. `?`는 `clue` S5에 남는다.
- **`proof` 모순 수정:** 초안은 `WATER` 카드에 처음부터 `FLOW`·숫자를 두면서 "S11에서 두 카드 함께 켜진다"고도 썼다. → `FLOW` 화살표·숫자는 **S11 시작에 두 카드 동시에**만 켠다. `n = 25`의 자리도 정했다(카드 아래 y 224~236 가운데).
- **`clue` 지목 위치:** `pointer(face="left")`를 아래 카드 오른쪽 끝 안쪽(x 150 안팎, y 165 안팎)에 세운다. 카드 이름 `NERVE DAMAGED`(카드 왼쪽 위)와 자막 상자(y 252~)를 가리지 않는다. 들어오는 시각은 S4 둘째 조각 시작(`cardt(T, 1, 1)`), 나가는 시각은 S5 끝이다.
- **땀구멍 가설 문단 금지 범위를 넓혔다:** 물이 땀구멍·피부로 들어가 신호를 만들거나 부풀리는 그림은 어느 장면에도 없다. [SZ]대로 겉층 팽윤이 실제로 조금 있더라도, 이 편은 그쪽을 그리지 않는다(개념 하나).
- **오늘의 원리:** 3줄 130/106/154px로 180px 이내다. 행 5·6·7이 받치고, 라벨 `WATER-INDUCED WRINKLING`은 화면 글자 목록에 있다. 그대로 둔다.
- **HUD 없음 유지:** `proof`의 혈류 값은 두 조건의 결과 비교이고 장면 안에서 바뀌는 변수가 아니다. **위 띠 없음 유지:** `squeeze`·`fold`는 단계 칩이 잇는다(선택 템플릿이라 안 써도 규칙 위반이 아니다).
- **효과음:** 뜻 있는 소리는 `fall` 하나다(`squeeze` S7 시작, 장면 시각 4.0초). 같은 장면의 첫 그림 `pop`(0.3초)과 3.7초 떨어져 `SFX_GAP` 2초에 걸리지 않는다. 확대(0.6초)·칩·신호 점선에는 소리를 달지 않는다. `finale`의 `sparkle`(S13 시작 4.8초)도 `pop`과 4.5초 떨어진다.
- **비유:** S9 한 문장, 베개 그림 한 쌍이다. 원인(솜이 어디로 가는지)은 그리지 않는다(아래 제약).

### 초안 대비 바꾼 곳

- 훅 제목: `물에 불어서가 아니라, 줄어들어서 쭈글해진다` → `물에 불어서만이 아니라, 속이 줄어서 쭈글해진다`(134/130px, 두 줄)
- S2: `사실은 속이 줄어서 생겨요.` → `핵심은 속이 줄어드는 거예요.`
- S5: `물을 먹어서라면,` → `불기만 해서 생긴다면,`
- S8: `주름이 져요.` → `주름이 진다고 봐요.`
- S11: `피가 줄어든` → `혈류가 줄어든`
- S12(구 S14): `몸이 일으키는` → `신경이 일으키는`
- S13(구 S15): `물에 불어서가 아니라,` → `물에 불어서만이 아니라,`
- 구 S12·S13과 `debate` 장면 삭제. 장면 시간 전부 다시 계산(본편 70.6 → 62.8초)
- 사실 확인: [SZ] 추가, [HAS] 문맥 이탈 인용 2개 교체·삭제, [KAR] 인용 끝 조정, 모든 행에 대조 가능한 URL
- 제작 제약: `proof` 표시 시각 모순, `clue` 지목 위치, 화면 글자 목록, 효과음 간격

## 1. 훅 카드

**물에 불어서만이 아니라, 속이 줄어서 쭈글해진다** / WATER-INDUCED WRINKLING / 물에 의한 손끝 주름

- `narration.ko.json`의 `hook`: `{"title": "물에 불어서만이 아니라, 속이 줄어서 쭈글해진다", "sub": "물에 의한 손끝 주름"}`
- 제목은 쉼표에서 두 줄로 나뉜다: `물에 불어서만이 아니라,`(134px) / `속이 줄어서 쭈글해진다`(130px). `secs.py` 실측이다.
- 큰 영문 제목 `words`: `["WATER-", "INDUCED", "WRINKLING"]`. `WATER-INDUCED`는 13자라 bold 2배 한계(11자)를 넘는다.

## 2. 오늘의 원리 · 배경음악

- `principle`: `["혈관이 조여", "속이 줄면", "피부가 접힌다"]` (bold 2배 130 / 106 / 154px, 마지막 줄 INK)
- `principle_label`: `WATER-INDUCED WRINKLING`
- `bgm`: `calm`. 몸 안에서 신호 → 혈관 → 속살 → 피부로 천천히 이어지는 메커니즘이고, 긴장이 있는 주제가 아니다.

## 3. 대본

`secs.py` 실측(전 조각 PASS, 종료 코드 0). 문장 합계 57.43초, 장면 **5개** 여백 각 0.9초(`LEAD` 0.4 + `TAIL` 0.5), 본편 **61.93초**, 엔딩 도장 4.2초를 더해 **66.13초**다. 원본(장면 6개, 62.8/67.0초)보다 0.9초 짧은 것은 `squeeze`·`fold`를 한 장면 `inside`로 합쳐 여백 하나가 빠져서다(문장·문장 시간은 그대로). `scenes.json`은 `[{"id": "hook", "min": 6.0}, {"id": "clue", "min": 6.0}, {"id": "inside", "min": 6.0}, {"id": "proof", "min": 6.0}, {"id": "finale", "min": 6.0}]`이다(모든 장면이 넘는다). `narration.ko.json`의 `scenes`는 `hook` = S1·S2, `clue` = S3~S5, `inside` = S6~S9, `proof` = S10·S11, `finale` = S12·S13이다.

```
/home/pi/galpi/reels/.venv/bin/python /home/pi/galpi/reels/px/secs.py "목욕을 오래 하고 나오면, / 손끝이 건포도처럼 쭈글쭈글하죠?" "흔히 물에 불어서라고 하지만, / 핵심은 속이 줄어드는 거예요." "단서는, 신경이 다친 손가락이에요." "물에 똑같이 오래 담가도, / 주름이 거의 안 생겨요." "불기만 해서 생긴다면, / 이 손가락도 쭈글해져야 하죠." "물에 오래 닿으면, / 신경이 혈관을 조여요." "그러면 손끝 속살의 부피가 줄어요." "줄어든 속살이 겉피부를 / 안쪽으로 끌어당겨서, / 주름이 진다고 봐요." "솜이 빠진 베개 커버가 쭈글해지듯이요." "물 대신 혈관을 조이는 크림을 발랐더니, / 손끝이 거의 똑같이 쭈글해졌어요." "혈류가 줄어든 정도도 거의 같았고요." "신경이 일으키는 반응이라, / 신경 검사에도 쓰여요." "물에 불어서만이 아니라, / 신경이 혈관을 조여서 생기는 주름이에요."
```

**세계 — 욕조 하나의 옆 단면.** 무대는 물이 담긴 욕조를 옆에서 자른 단면 하나다. 세계 좌표는 480×310단위이고 배율 1에서 1단위 = 캔버스 1도트라, 캔버스 그림 영역(180×250)의 가로 약 2.7배·세로 약 1.2배다. 왼쪽부터 ① 욕조 밖 마른 공기에 매달린 손가락 **C**(가운데 x 40, `EMLA`), ② 욕조 왼쪽 벽(x 88~98, 테두리 위 y 118), ③ 물(수면 y 128, 바닥 y 300) 위에서 한 손으로 함께 내려오는 두 손가락 **A**(x 160, `NERVE OK`)·**B**(x 245, `NERVE DAMAGED`), ④ 훅의 손가락 **H**(x 380), ⑤ 오른쪽 벽(x 460~470)이 있다. 손가락은 모두 위(화면 밖의 손)에서 곧게 내려와 끝이 아래를 향하고, 지문면이 왼쪽·손톱이 오른쪽이다. 세계는 위로 공기가 계속되고 손가락도 위로 계속 이어진다(손은 그리지 않는다). **A 끝마디의 속(세로 단면)도 이 세계의 일부**다: 카메라가 A 끝마디에 배율 3~5로 다가가면 단면이 열려 피부·속살·혈관·신경·뼈·손톱이 보인다. 카메라는 훅 그림 칸 안에서 H 끝을 보며 시작해 → 왼쪽으로 패닝·축소해 A·B 한 쌍 → A 끝마디로 확대해 속으로 → 빠져나오며 왼쪽 벽 너머 C까지 축소·패닝 → A 위쪽으로 올라가 신호를 따라 손가락 뿌리에서 끝까지 내려간 뒤 A 전체를 보는 데서 끝난다. 하드 컷은 마지막 장면 → 엔딩 도장(엔진) 하나뿐이다. 세계는 비트맵 한 장이 아니라 세계 좌표로 그리는 도형 함수 묶음이고, 카메라 `(cx, cy, z)`(화면 (90, 125)에 오는 세계 점과 배율)가 매 프레임 다시 그린다(5절 새 부품). 카메라·세계 상태는 **편 절대 시각** 하나의 함수라 장면 경계에서 저절로 이어진다. 장면 시작 절대 시각: `hook` 0 · `clue` 11.3 · `inside` 24.2 · `proof` 40.33 · `finale` 50.83. 아래 표의 시각은 장면 시각이다.

**★ 손가락 `finger()` (모든 장면 공용, 핵심 장면 주인공).** 세계 단위. 두께 44(가운데 ±22), 위로 곧게 이어지고 끝은 아래. ① 끝: 아래로 둥근 반타원(가로 반지름 22·세로 16, 중점 타원). ② 끝마디: 끝에서 30단위 구간의 손톱 쪽(오른쪽) 윤곽이 3단위 안으로 들어와 살짝 가늘다. ③ 지문면(왼쪽): 끝에서 10~40단위 구간이 바깥으로 3단위 볼록하다. ④ 손톱: 오른쪽 윤곽을 따라 끝에서 3단위 안쪽에서 시작해 위로 26단위(두께의 0.6배), 두께 3단위 LABEL 판. 아래 끝(자유연) 1도트 TEXT, 위 끝(큐티클) 1줄 OUTLINE. ⑤ 첫마디 관절(DIP): 끝에서 55단위에 양쪽 윤곽 2단위 홈 + 지문면 쪽에서 안으로 짧은 OUTLINE 가로줄 2개. ⑥ 명암: INK 면, 왼쪽 가장자리 1도트 TEXT, 오른쪽 가장자리 1도트 DEEP. ⑦ 주름: 지문면 끝에서 16·26·36·46단위 자리에서 윤곽이 안쪽으로 최대 2.5단위 파이고(OUTLINE 2도트 골 + 아래쪽 1도트 TEXT 마루), 골에서 안쪽으로 두께의 1/3까지 OUTLINE 가로선. 실루엣은 **"위에서 내려온 손가락 끝, 오른쪽 아래에 손톱"**으로 읽혀야 하고, 막대·캡슐·잠수함으로 읽히면 실패다. 물에 잠긴 부분도 같은 색이고, 수면이 손가락을 가로지르는 자리에 LABEL 1도트 선(수면 고리)을 긋는다. 배율이 바뀌어도 선은 1도트이고 면만 커진다.

| 시간 | 화면 (템플릿) | 내레이션 |
| --- | --- | --- |
| 0–11.3초 `hook` | **훅 템플릿 + 세계 창.** 템플릿 `hook` 그대로(제목 두 줄·부제·큰 영문 `WATER-` / `INDUCED` / `WRINKLING` y 68·96·124·시온 놀람). 장면 함수가 템플릿보다 먼저 세계를 **창 (0, 152)~(179, 319)** 안에만 그리고, 템플릿 `art`는 빈 함수다. 세계는 0초부터 움직인다.<br>**카메라**(창 중심 (90, 201)이 보는 세계 점, 배율. `cam.py`에는 cy − 76/z로 바꿔 넣는다): 0–2.0 (412, 165) ×1.3(수면선이 창 위쪽, H 끝이 창 아래쪽) → 2.0–3.1 H를 따라 위로 (412, 104) ×1.3(`ease_out`) → 3.1–5.6 (410, 104) ×1.35 → 5.6–10.8 주름진 지문면으로 다가감 (402, 104) ×1.8(`ease_in_out`) → 10.8–11.3 같은 방향으로 ×1.85. 끝 화면이 `clue`의 첫 화면이다.<br>**진행 중인 과정:** ① 0.4(S1)부터 물속 H 지문면에 주름 4줄이 위에서 아래로 차례로 깊어진다(0.4·0.8·1.2·1.6 시작, 각 0.6초). 물속 시간이 원인, 주름이 결과다. ② 2.0("나오면" 무렵)부터 0.9초 동안 손이 H를 끌어올린다(끝 y 200 → 110, `ease_out`). 끝이 수면을 빠져나가는 자리에서 물결 고리 한 쌍이 퍼진다(2.6–3.8). ③ 3.0·4.2·5.6에 손끝에서 물방울이 하나씩 떨어져 수면에 작은 물결을 만든다(간격이 점점 길어진다). ④ S2 동안 새로 생기는 것은 없고 카메라가 주름진 지문면으로 다가간다. 불어나는 그림은 없다.<br>**카드/라벨:** 없음(템플릿 글자만).<br>**살아 있는 배경:** 수면선 1도트 물결(12fps로 한 칸씩 옆으로), 물속 CARD 티끌(2×1)이 손가락 뒤에서 느리게 떠다님, 공기 중 DITHER 김이 위로 올라감, 벽 타일 CARD 1도트 선(세계에 붙어 있어 카메라 이동이 보인다). | S1 목욕을 오래 하고 나오면, / 손끝이 건포도처럼 쭈글쭈글하죠? S2 흔히 물에 불어서라고 하지만, / 핵심은 속이 줄어드는 거예요. |
| 11.3–24.2초 `clue` **★ 핵심(근거)** | **같은 세계, A·B 한 쌍.** 0초에 제목·큰 영문이 사라지고 세계가 캔버스 전체로 넓어진다(같은 변환이라 H는 제자리).<br>**카메라:** 0 = 훅 끝 → 0–2.4 왼쪽으로 패닝하며 축소 (202, 150) ×1.0(`ease_in_out`. H는 오른쪽으로 빠지고 A(화면 x 26~70)·B(111~155)가 들어온다) → 4.6–7.8 (202, 150) ×1.1 천천히 밀기 → 7.8–9.8 B 쪽으로 (225, 150) ×1.4(`ease_in_out`. B가 가운데, A는 왼쪽 가장자리에 반쯤 남아 주름이 보인다) → 9.8–12.4 (228, 150) ×1.45 → 12.4–12.9 A 끝마디 쪽으로 출발 (205, 156) ×1.7(`ease_in`, `inside`로 이어진다).<br>**진행 중인 과정:** ① 0–3.6 A·B는 수면 위에 들려 있고(끝 y 120, 수면보다 8단위 위) 둘 다 매끈하다. ② 3.7–4.6(S4 첫 조각 "똑같이 오래 담가도") A·B가 **한 손으로 함께** 내려가 같은 깊이(끝 y 200)에 잠긴다(`ease_out`). 두 손가락이 수면을 뚫는 자리에서 같은 모양의 물결 고리가 같은 순간 퍼지고, 그 뒤로는 수면선 하나가 두 손가락을 같은 높이에서 가로지른다. ③ 5.9–7.5(S4 둘째 조각) A 지문면에만 주름 4줄이 차례로 깊어진다(5.9·6.3·6.7·7.1 시작, 각 0.4초). B는 끝까지 매끈하다. ④ 9.8(S5 둘째 조각) A와 B 사이 물속(화면 x 60·y 170 안팎)에 `?`가 0.7초 깜빡인 뒤(`blinking`) S5 끝까지 떠 있다.<br>**카드/라벨:** 2.0(S3 "신경이 다친" 무렵)에 두 손가락 위쪽(화면 y 4~16)에 이름표가 붙는다: A `NERVE OK`(CARD 판, INK 테두리), B `NERVE DAMAGED`(CARD 판, PURPLE 테두리 = 대비되는 쪽). 이름표는 자기 손가락의 화면 x를 따라가고, 캔버스 안(x 2~177)으로 밀어 넣는다. 5.8에 시온 가리키기(`pointer`, face `left`)가 오른쪽 밖에서 들어와 (168, 215)에서 B를 보고 12.4에 나간다. 이름표·`?`·자막을 가리지 않는다.<br>**주인공 형태:** 위 `finger()` 그대로, 배율 1.0~1.45(두께 44~64도트). 주름이 "있다/없다"가 폰에서 보이게 골 깊이는 배율 1에서 2.5도트 이상이다.<br>**살아 있는 배경:** 수면 물결·티끌·김·타일. | S3 단서는, 신경이 다친 손가락이에요. S4 물에 똑같이 오래 담가도, / 주름이 거의 안 생겨요. S5 불기만 해서 생긴다면, / 이 손가락도 쭈글해져야 하죠. |
| 24.2–40.33초 `inside` **★ 핵심** | **A 끝마디 속(세로 단면).** 공수의 대부분을 여기에 쓴다.<br>**카메라:** 0 = `clue` 끝 (205, 156) ×1.7 → 0–1.6 (159, 170) ×3.6(`ease_out`. A 끝마디가 화면을 채운다: 왼쪽 x 0~14 물, 14~21 피부, 21~104 속살(신경 x 40, 혈관 x 65), 104~140 뼈, 140~173 손톱 바탕·손톱, 끝 y 233, 관절 y 35) → 1.6–7.0 (159, 171) ×3.7 → 7.0–8.4 지문면 피부로 (146, 172) ×5.0(`ease_in_out`. 물 쪽이 x 0~62로 넓어진다) → 8.4–10.43 ×5.1 → 10.43–11.6 물러나 끝마디 전체 (158, 170) ×3.0(`ease_in_out`) → 11.6–15.63 ×3.1 → 15.63–16.13 빠져나오기 시작 (150, 165) ×2.6(`ease_in`).<br>**단면 열기:** 0.8–1.6 동안 LABEL 1도트 점선 가로줄이 화면 위에서 아래로 내려가고, 줄 위쪽은 단면, 아래쪽은 아직 바깥 모습이다. 보는 방식이 바뀌는 것이고, 바깥 주름이 펴지는 애니메이션은 그리지 않는다. 단면은 주름 전 상태에서 시작한다.<br>**진행 중인 과정(원인 → 결과):** ① 1.0~ 혈관 속 피 흐름: LABEL 2×2 점이 혈관 안을 손끝 쪽(아래)으로 행진한다(`flow`, 5도트 주기, 프레임당 2도트). 장면 내내 흐른다. ② 2.0(S6 둘째 조각) `NERVE`가 밝아지고, 신호(INK 3×3 점선)가 화면 위 가장자리(뿌리 쪽)에서 신경을 따라 내려온다(2.0–2.6). 끝에서 40단위 자리의 45° 갈래를 지나 혈관 벽에 닿는다(2.6–2.8). 그 뒤로도 신호 점은 0.8초 간격으로 장면 끝까지 계속 내려온다. ③ 2.8 `VESSEL`이 밝아지고, 혈관이 접점에서 시작해 위·아래로 퍼지며 가늘어진다(지름 3 → 1.5단위, 2.8–3.8, `ease_out`, 손끝 쪽 갈래 3개도 같이). 그만큼 피 점 간격이 8도트로 벌어지고 전진이 프레임당 1도트로 느려진다(3.0–3.8). S6이 끝나기(4.0) 전에 다 가늘어진다. ④ 4.0(S7) `fall`, `PULP`가 밝아진다. 속살이 줄어든다: 지문면 피부 띠가 모양·두께 그대로 안쪽(오른쪽, 뼈 쪽)으로 옮겨 간다(4.0–6.4, `ease_in_out`. 볼록 가운데에서 최대 2.5단위 ≈ 9도트, 위 관절과 끝으로 갈수록 0). 원래 겉면 자리에는 LABEL 1도트 점선 윤곽(유령선)이 장면 끝까지 남아 "여기서 줄었다"를 보여 준다. 속살의 DITHER 지방 덩이 무늬가 줄어든 폭에 맞춰 촘촘해지고, 지문면 가까이 속살 안에 뼈 쪽을 가리키는 도트 화살표 2개가 있다(4.0–7.0). ⑤ 7.0(S8 첫 조각) 카메라가 피부로 다가가고 `SKIN`이 뜬다. ⑥ 8.43(S8 둘째 조각 "끌어당겨서") 피부가 당겨져 접힌다: 위에서 아래로 4자리(끝에서 46·36·26·16단위)에 차례로(8.5·8.9·9.3·9.7) 먼저 속살 안쪽에 작은 안쪽 화살표가 생기고(원인, 한 칸 앞서), 이어서 그 자리 피부 띠가 안쪽으로 1.5단위 파여 골이 된다(각 0.5초). 띠의 두께·길이는 그대로라 골 사이는 마루로 남고, 마루는 유령선 안쪽에 머문다. ⑦ 10.43(S8 셋째 조각) 물러난 화면에서 골 4개가 지문면 전체의 물결로 보이고 `FOLD`가 뜬다. ⑧ 12.23(S9) 베개 카드가 뜨고 베개가 꺼진다(아래).<br>**카드/라벨:** 이름표는 CARD 판 + Galmuri9 + 1도트 지시선. `NERVE`(2.0, (22, 4)), `VESSEL`(2.8, (56, 4)), `PULP`(4.0, 혈관과 뼈 사이 (78, 120)), `SKIN`(7.0, 물 쪽 (8, 20)), `FOLD`(10.43, 물 쪽 x 4~30, 둘째 골로). 처음엔 LABEL 글자이고 자기 부품이 움직이는 순간 TEXT로 바뀌어 그대로 남는다(깜빡이지 않는다). 이름표 자리는 카메라 구간마다 화면 좌표로 정하고, 지시선 끝은 부품의 현재 화면 위치에 붙인다. **베개 카드:** 12.23에 화면 (100, 14)~(174, 72)에 CARD 판(LABEL 테두리, 글자 없음)이 2프레임 동안 펼쳐진다(뼈·손톱 쪽 위를 덮고 지문면 골은 가리지 않는다). 가운데 베개 48×28: 12.23–12.9 꽉 찬 베개(모서리 귀 1~2도트, 네 변 가운데 2도트 볼록, 왼쪽 위 TEXT 하이라이트, 오른쪽 아래 OUTLINE 그림자, 가운데 이음선 1줄) → 12.9–14.3 네 모서리 자리는 그대로 두고 네 변 가운데가 0 → 3도트 오목해지며, V자 OUTLINE 주름 3개가 13.3·13.7·14.1에 하나씩 생기고 하이라이트가 줄어든다 → 15.63–15.9 카드가 접혀 사라진다.<br>**★ 주인공 형태(단면):** 실루엣은 **"세로로 자른 손가락 끝"**이다. 아래로 둥근 끝, 오른쪽에 끝 쪽으로 휘어 손끝을 덮는 손톱 판(LABEL, 자유연 TEXT), 그 안쪽 끝마디뼈(위는 관절 면, 아래는 버섯 모양으로 퍼진 끝. LABEL 면 + TEXT 하이라이트 + OUTLINE 그림자, 관절 틈 1단위), 왼쪽 피부 띠(INK 2단위, 바깥 1도트 TEXT, 안쪽 1도트 DEEP), 그 사이 속살(CARD 바탕 + DITHER 지방 덩이 원 무늬, 선 사이 2도트 이상). 혈관: INK 1도트 벽 + DEEP 속, 손끝 가까이에서 지문면 쪽으로 45° 갈래 3개. 신경: LABEL 1도트 두 줄(4도트 간격), 혈관보다 피부 쪽. 신경 → 혈관 갈래 하나(45°).<br>**살아 있는 배경:** 왼쪽 물 띠의 CARD 티끌(피부와 나란히 위아래로만 떠다니고 피부에 닿지 않는다), 피 흐름, 신호 점, 지방 덩이 무늬. | S6 물에 오래 닿으면, / 신경이 혈관을 조여요. S7 그러면 손끝 속살의 부피가 줄어요. S8 줄어든 속살이 겉피부를 / 안쪽으로 끌어당겨서, / 주름이 진다고 봐요. S9 솜이 빠진 베개 커버가 쭈글해지듯이요. |
| 40.33–50.83초 `proof` | **같은 세계, 왼쪽 벽 너머 C.** 비교·수치는 이름표와 작은 표로 둔다.<br>**카메라:** 0 = `inside` 끝 (150, 165) ×2.6 → 0–2.4 (100, 145) ×1.0(`ease_out`, 배율은 로그 보간. A 단면이 닫히며 바깥 A(물속, 주름 4줄, 화면 x 128~172)가 보이고, 왼쪽으로 패닝해 욕조 왼쪽 벽(화면 x 78~88)과 그 너머 마른 공기 속 C(화면 x 8~52)가 들어온다) → 2.4–10.0 (100, 148) ×1.08 천천히 밀기 → 10.0–10.5 (118, 128) ×1.2(`ease_in`, `finale`로).<br>**단면 닫기:** 0.4–1.0 동안 점선 가로줄이 아래에서 위로 올라가며 단면이 바깥 모습으로 바뀐다. 바깥 주름 4줄은 단면 골 4개와 같은 높이다.<br>**진행 중인 과정:** ① 2.4–3.6(S10 첫 조각 "크림을 발랐더니") C 끝마디에 크림 막이 손끝에서 첫마디 관절(끝에서 55단위)까지 아래에서 위로 번져 덮인다(LABEL 바탕에 CARD 체크 점무늬로 손톱 판과 구별, 두께 2단위, 끝 1도트 TEXT 광택). 원인이다. ② 3.9–5.5(S10 둘째 조각) C 지문면에 주름 4줄이 A와 같은 자리에 차례로 깊어진다(3.9·4.3·4.7·5.1 시작, 각 0.4초, 크림 위에 골을 그린다). 결과다. A는 이미 같은 4줄이다. ③ 6.8(S11) 두 손끝 아래에 동시에 `FLOW` 표가 뜨고, 도트 아래 화살표가 두 표에서 0 → 8도트로 같이 자란다(6.8–7.3).<br>**카드/라벨:** 1.8 `WATER`(CARD 판 bold, INK 테두리, 오른쪽 위 A 위쪽). 2.2 `EMLA`(CARD 판 bold, PURPLE 테두리, 왼쪽 위 C 위쪽)와 그 바로 아래 Galmuri9 `NO WATER`(y 20 안팎). 6.8 C 아래(x 4~86, y 190~214)에 `FLOW` + 아래 화살표 / `-2.01 cm/s`, A 아래(x 94~176, 같은 y)에 `FLOW` + 아래 화살표 / `-2.29 cm/s`, 같은 순간 아래 가운데 y 236~246에 `n = 25`. `NO WATER`와 `FLOW`는 170도트 넘게 떨어져 한 덩어리로 읽히지 않는다.<br>**살아 있는 배경:** A 쪽 물(수면 물결·티끌), 공기 김, 벽 타일. C 쪽에는 물·물방울이 없다. | S10 물 대신 혈관을 조이는 크림을 발랐더니, / 손끝이 거의 똑같이 쭈글해졌어요. S11 혈류가 줄어든 정도도 거의 같았고요. |
| 50.83–61.93초 `finale` | **A 전체, 신호 따라가기.**<br>**카메라:** 0 = `proof` 끝 (118, 128) ×1.2 → 0–1.0 A 손가락 위쪽 (158, 20) ×2.0(`ease_in_out`) → 1.0–2.6 **신호를 따라 내려간다**: cy = 신호의 세계 y + 12(20 → 172), ×2.0. 신호는 화면 같은 높이에 머물고 타일·수면선이 위로 지나간다 → 2.6–2.8 (158, 174)에서 멈춤 → 2.8–4.4 물러나 A 전체 (160, 112) ×1.3(`ease_in_out`. 손가락 위쪽부터 끝까지, 수면 y 146) → 4.4–10.6 (160, 126) ×1.45 천천히 밀기 → 10.6–11.1 ×1.47.<br>**진행 중인 과정:** ① 0.4–1.0 A에 단면이 다시 열린다(점선 가로줄이 위에서 아래로, 손가락 전체 길이). 몸통 단면은 가운데마디뼈(LABEL 막대)와 관절 틈, 그 옆을 손가락 길이 따라 곧게 이어지는 신경 두 줄·혈관이고, 끝마디는 `inside` 끝 상태 그대로다(혈관 가늚, 속살 줄어듦, 골 4개, 유령선). ② 1.0–2.6 신호 하나가 화면 위(손 쪽)에서 신경을 따라 내려가고(세계 y 8 → 160) 카메라가 따라간다. 2.6–2.8 갈래를 지나 혈관 벽에 닿는다. ③ 2.8(S12 둘째 조각) 골 4개의 마루가 TEXT로 밝아져 그대로 남는다(검사에서 보는 것이 이 주름이다). ④ 3.4부터 장면 끝까지 신호가 1.2초 간격으로 뿌리에서 끝까지 계속 내려오고, 혈관 속 피 점은 느린 그대로 흐른다(조인 상태가 이어진다).<br>**카드/라벨:** 1.0 `NERVE` 이름표(신경 옆, 화면 고정, 처음부터 TEXT). 2.8 맨 위 가운데(y 4~16) `WRINKLE TEST`(CARD 판). 4.8(S13) 시온 반짝임(`SPARKLE_MASCOT`, 발밑 (152, 249), 물속 오른쪽 아래. A(화면 x 61~119)를 가리지 않는다).<br>**살아 있는 배경:** 수면 물결·티끌·김·타일. | S12 신경이 일으키는 반응이라, / 신경 검사에도 쓰여요. S13 물에 불어서만이 아니라, / 신경이 혈관을 조여서 생기는 주름이에요. |
| 61.93–66.13초 | 엔딩 도장(엔진이 자동으로 붙인다. 마지막 장면에서 그냥 컷) | — |

문장별 실측(초): S1 5.20(2.2+3.0) · S2 5.20(2.6+2.6) · S3 3.20 · S4 4.20(2.2+2.0) · S5 4.60(2.0+2.6) · S6 3.60(1.6+2.0) · S7 3.00 · S8 5.23(1.43 중간 카드+2.0+1.8) · S9 3.40 · S10 6.40(3.4+3.0) · S11 3.20 · S12 4.40(2.4+2.0) · S13 5.80(2.2+3.6).

장면 안 문장 시작(장면 시각): `hook` S1 0.4(둘째 조각 2.6) · S2 5.6(둘째 조각 8.2) / `clue` S3 0.4 · S4 3.6(둘째 조각 5.8) · S5 7.8(둘째 조각 9.8) / `inside` S6 0.4(둘째 조각 2.0) · S7 4.0 · S8 7.0(둘째 조각 8.43, 셋째 10.43) · S9 12.23 / `proof` S10 0.4(둘째 조각 3.8) · S11 6.8 / `finale` S12 0.4(둘째 조각 2.8) · S13 4.8(둘째 조각 7.0). 연출은 `cardt`(절대 시각은 장면 시작 + `cardt`)로 묶고 숫자를 박지 않는다. 표의 초 값은 설계 확인용이다.

HUD: 쓰지 않는다(장면 안에서 바뀌는 측정 변수가 없다). 위 띠: 쓰지 않는다. 단계 칩: 쓰지 않는다(부품 이름표가 신경 → 혈관 → 속살 → 피부 순서로 밝아지며 대신한다). 상태값: 없음(혈류 숫자는 두 조건의 결과 비교이고, 장면 안에서 연속으로 바뀌는 값이 아니다).

## 4. 사실 확인 목록

출처 약칭
- **[HAS]** Haseleu J, Omerbašić D, Frenzel H, Gross M, Lewin GR, "Water-Induced Finger Wrinkles Do Not Affect Touch Acuity or Dexterity in Handling Wet Objects", *PLoS ONE* 9(1): e84949, 2014. https://pmc.ncbi.nlm.nih.gov/articles/PMC3885627/
- **[KAR]** Kareklas K, Nettle D, Smulders TV, "Water-induced finger wrinkles improve handling of wet objects", *Biology Letters* 9(2), 2013. 본문 https://pmc.ncbi.nlm.nih.gov/articles/PMC3639753/ · 초록 https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=DOI:10.1098/rsbl.2012.0999&resultType=core&format=json
- **[WS03]** Wilder-Smith E, Chow A, "Water immersion and EMLA cause similar digit skin wrinkling and vasoconstriction", *Microvascular Research* 66:68–72, 2003. https://pubmed.ncbi.nlm.nih.gov/12826076/ (대조는 Europe PMC 초록 JSON)
- **[WS15]** Wilder-Smith EP, "Stimulated skin wrinkling as an indicator of limb sympathetic function", *Clinical Neurophysiology*, 2015. https://pubmed.ncbi.nlm.nih.gov/25216595/ (대조는 Europe PMC 초록 JSON)
- **[SZ]** Sáez P, Zöllner AM, "Mechanics Reveals the Biological Trigger in Wrinkly Fingers", *Annals of Biomedical Engineering* 45(4):1039–1047, 2017. https://pubmed.ncbi.nlm.nih.gov/27913950/ (대조는 Europe PMC 초록 JSON)

인용은 원문 텍스트에서 그대로 옮겼다. PubMed 페이지는 코드가 받지 못해, 그 출처 행에는 같은 초록의 Europe PMC JSON URL을 함께 둔다. [KAR] 본문 인용은 "caused by vasoconstriction" 뒤에서 끊었다(원문이 거기서 바로 이어지지 않는다). [HAS]의 신경 손상 관찰(Lewis & Pickering, Hsieh 등)은 [HAS] 서론이 그 연구들을 정리한 문장이다. 한 칸에 인용이 둘 이상이면 각각 원문의 다른 자리에 있다.

| # | 주장 (대본 문장) | 출처 | 원문 인용 |
| --- | --- | --- | --- |
| 1 | (S1) 물에 오래 닿으면 손끝(손가락·손바닥·발바닥의 털 없는 피부)이 쭈글쭈글해진다 | [HAS] https://pmc.ncbi.nlm.nih.gov/articles/PMC3885627/ | "Human non-hairy (glabrous) skin of the fingers, palms and soles wrinkles after prolonged exposure to water." |
| 2 | (S2·훅) 흔히 겉피부가 물에 불어서라고 여겼지만, 핵심은 손끝 속살의 부피가 줄어드는 것이다. 겉층 팽윤도 함께 일어난다(그래서 "만이 아니라") | [KAR] https://pmc.ncbi.nlm.nih.gov/articles/PMC3639753/ / [SZ] https://pubmed.ncbi.nlm.nih.gov/27913950/ · https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=EXT_ID:27913950%20AND%20SRC:MED&resultType=core&format=json | "This wrinkling was previously thought to be the result of osmotic swelling of the stratum corneum, the outermost layer of skin" / "However, more recent evidence has shown that it is in fact due to a reduction in the volume of the fingertip pulp, caused by vasoconstriction" / "In reality, contraction of the lower layers of the skin and swelling of the upper layers will happen simultaneously." |
| 3 | (S3·S4) 신경이 다친 손가락은 물에 똑같이 담가도 주름이 (거의) 안 생긴다 | [HAS] https://pmc.ncbi.nlm.nih.gov/articles/PMC3885627/ | "In the 1930s, Lewis and Pickering first described the absence of wrinkling in patients with median nerve palsy which suggested that the nervous system plays a central role in wrinkling" / "They observed that upon water immersion the skin of replanted fingers failed to wrinkle" |
| 4 | (S5) 불기만 해서 생긴다면 신경이 다친 손가락도 쭈글해져야 한다. 주름은 신경에 달린 능동적 반응이다 | [SZ] https://pubmed.ncbi.nlm.nih.gov/27913950/ · https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=EXT_ID:27913950%20AND%20SRC:MED&resultType=core&format=json / [HAS] https://pmc.ncbi.nlm.nih.gov/articles/PMC3885627/ / [KAR] https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=DOI:10.1098/rsbl.2012.0999&resultType=core&format=json | "Therefore, the upper layers can not exceed this swelling level in order to not contradict in vivo observations in patients with such neurological disorders." / "Wrinkling is a sympathetic nervous system-dependent process" / "The formation of these wrinkles is known to be an active process, controlled by the autonomic nervous system." |
| 5 | (S6) 물에 오래 닿으면 신경(교감신경)이 손끝 혈관을 조인다 | [WS15] https://pubmed.ncbi.nlm.nih.gov/25216595/ · https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=EXT_ID:25216595%20AND%20SRC:MED&resultType=core&format=json / [HAS] https://pmc.ncbi.nlm.nih.gov/articles/PMC3885627/ | "The process underlying stimulated skin wrinkling has been recently identified as dependent on digital vasoconstriction mediated via sympathetic nerve fibers." / "showed that water-induced skin wrinkling is directly linked to vasoconstriction" |
| 6 | (S7) 혈관이 조이면 손끝 속살의 부피가 줄어든다 | [KAR] https://pmc.ncbi.nlm.nih.gov/articles/PMC3639753/ / [WS15] https://pubmed.ncbi.nlm.nih.gov/25216595/ · https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=EXT_ID:25216595%20AND%20SRC:MED&resultType=core&format=json | "a reduction in the volume of the fingertip pulp, caused by vasoconstriction" / "Vasoconstriction is postulated to drive wrinkling through loss of digit volume" |
| 7 | (S8) 줄어든 속살이 겉피부를 안쪽으로 끌어당겨 주름이 진다고 본다(가정된 역학) | [WS15] https://pubmed.ncbi.nlm.nih.gov/25216595/ · https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=EXT_ID:25216595%20AND%20SRC:MED&resultType=core&format=json | "Vasoconstriction is postulated to drive wrinkling through loss of digit volume, which induces a negative pressure in the digit pulp and exerts a downward pull on the overlying skin and ultimately results in wrinkles." |
| 8 | (S10) 물 대신 혈관을 조이는 크림(EMLA)을 손끝에 발랐더니 주름이 물에 담갔을 때와 거의 같았다 | [WS03] https://pubmed.ncbi.nlm.nih.gov/12826076/ · https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=EXT_ID:12826076%20AND%20SRC:MED&resultType=core&format=json | "we applied vasoconstrictive cream (EMLA) to the distal digit and compared the degree of skin wrinkling and digit blood flow reduction with those after water immersion." / "both clinical wrinkling scores and reduction in digit blood flow (mean of 2.01 and 2.29 cm/s, respectively) were nearly identical." |
| 9 | (S11) 손끝 혈류가 줄어든 정도도 거의 같았다. 주름이 혈관 수축으로 생긴다는 근거다 | [WS03] https://pubmed.ncbi.nlm.nih.gov/12826076/ · https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=EXT_ID:12826076%20AND%20SRC:MED&resultType=core&format=json | "reduction in digit blood flow (mean of 2.01 and 2.29 cm/s, respectively) were nearly identical." / "These data further support that water immersion skin wrinkling is mediated by vasoconstriction." |
| 10 | (S12) 신경이 일으키는 반응이라 신경 기능 검사에 쓰인다 | [HAS] https://pmc.ncbi.nlm.nih.gov/articles/PMC3885627/ / [WS15] https://pubmed.ncbi.nlm.nih.gov/25216595/ · https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=EXT_ID:25216595%20AND%20SRC:MED&resultType=core&format=json | "These discoveries led to the implementation of the wrinkling test as a bedside test of sympathetic nerve function" / "There is reasonable evidence allowing the test to be employed as a simple and effective marker for small fiber neuropathy and cystic fibrosis." |
| 11 | (S13·훅) 요약: 물에 불어서만이 아니라, 신경이 혈관을 조여(속이 줄어) 생기는 주름이다 | [KAR] https://pmc.ncbi.nlm.nih.gov/articles/PMC3639753/ / [WS15] https://pubmed.ncbi.nlm.nih.gov/25216595/ · https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=EXT_ID:25216595%20AND%20SRC:MED&resultType=core&format=json / [SZ] https://pubmed.ncbi.nlm.nih.gov/27913950/ · https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=EXT_ID:27913950%20AND%20SRC:MED&resultType=core&format=json | "it is in fact due to a reduction in the volume of the fingertip pulp, caused by vasoconstriction" / "dependent on digital vasoconstriction mediated via sympathetic nerve fibers." / "the combined effect of both mechanisms leads to pronounced wrinkles even at low levels of swelling and contraction when individually they do not." |
| G1 | (그림 `proof`) 실험 인원 25명, 혈류 감소 평균 EMLA 2.01 cm/s, 물 2.29 cm/s | [WS03] https://pubmed.ncbi.nlm.nih.gov/12826076/ · https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=EXT_ID:12826076%20AND%20SRC:MED&resultType=core&format=json | "In 25 healthy volunteers (6 male, 19 female; mean age, 35 yr) subjected to EMLA and water immersion" / "(mean of 2.01 and 2.29 cm/s, respectively)" |

S9(베개)는 비유라서 행이 없다. S1의 "목욕", "건포도처럼"은 일상 장면 묘사이고, 사실 주장은 1번 행까지다.

화면 표기와 행의 연결: `WATER-INDUCED WRINKLING`은 1번, `NERVE OK`·`NERVE DAMAGED`는 3번, `?`는 4번, `NERVE`·`VESSEL`은 5번, `PULP`·`↓`는 6번, `SKIN`·`FOLD`·`FULL`·`SHRUNK`은 7번, `WATER`·`EMLA`·`NO WATER`는 8번, `FLOW`·`-2.29 cm/s`·`-2.01 cm/s`·`n = 25`는 9번과 G1, `WRINKLE TEST`는 10번이다. 훅 "물에 불어서만이 아니라, 속이 줄어서 쭈글해진다"는 2·11번이다.

## 5. 제작 제약

### 그림이 틀리면 안 되는 조건

- **`clue`: 두 손끝은 같은 물, 같은 수면 높이에 잠겨 있다.** A·B는 한 손으로 같은 순간 같은 깊이(끝 y 200)까지 내려가고, 그 뒤 수면선 하나가 두 손가락을 같은 높이에서 가로지른다. 다른 조건은 신경뿐이다. B(`NERVE DAMAGED`)를 물 밖에 두거나, 덜 잠기게 하거나, 늦게 넣으면 논리가 깨진다. 주름은 A에만 생기고 B는 끝까지 매끈하다(3번). B에 상처·붕대·꿰맨 자국·다른 색은 넣지 않는다(출처는 신경 마비·재접합 손가락이고, 외상 모양을 말하지 않는다. 다른 것은 이름표 테두리 색뿐이다). 두 손가락은 같은 `finger()`로 크기·모양이 같다.
- **`inside`: 순서는 신경 신호 → 혈관이 가늘어짐 → 속살 부피가 줄어듦 → 피부가 당겨져 접힘이다**(5·6·7번). 신호 점선은 화면 위(뿌리 쪽)의 `NERVE` 선 위에서 시작해 갈래를 거쳐 `VESSEL` 쪽으로만 흐른다. 혈관은 **가늘어진다**(넓어지거나 터지면 안 된다). 관이 다 가늘어진 뒤에 속살이 줄기 시작한다(S6 안에 관, S7에 속살). 속살 경계와 피부는 **안쪽(뼈 쪽)으로만** 움직인다(바깥으로 부풀면 안 된다). 안쪽 화살표는 속살 안에만 있고 뼈 쪽을 가리키며, 골마다 화살표가 골보다 먼저 생긴다(당김이 원인).
- **`inside`: 주름은 피부가 안쪽으로 당겨지면서 생긴다**(7번). 줄어든 속살 면적은 원래보다 작고(유령선이 원래 자리를 남긴다), 피부 띠는 물결 모양으로 접힌다. **피부 띠의 길이·두께는 바꾸지 않는다**(줄어드는 건 속이고, 피부는 접힌다). 골 사이 마루는 유령선 밖으로 나가지 않는다(나가면 불어나는 것으로 읽힌다). 골은 디테일 규칙대로 4개이고 실제 주름 수를 뜻하지 않는다.
- **단면 열기·닫기는 보는 방식이 바뀌는 것이다.** 점선 가로줄이 지나가며 바깥 모습과 단면이 바뀔 뿐, 바깥 주름이 펴지거나 다시 생기는 애니메이션은 그리지 않는다. 단면의 골 4개와 바깥 주름 4줄은 같은 높이다.
- **물이 피부·땀구멍·속살 안으로 들어가는 그림, 물 때문에 무언가 부푸는 그림은 어느 장면에도 그리지 않는다.** 땀구멍으로 들어간 물이 신호를 만든다는 것은 [HAS]가 "suggested"로만 전하는 가설이라 대본에 없다. 겉층 팽윤은 [SZ]대로 실제로 조금 있지만, 이 편이 설명하는 개념이 아니다. 물속 티끌·물결은 피부와 나란히 움직이고 피부에 닿거나 넘지 않는다. 피부가 안쪽으로 물러난 자리에는 바깥 물이 그대로 있을 뿐, 물이 밀고 들어오는 화살표·흐름은 없다. 물에서 신경으로 가는 화살표(무엇이 신호를 켜는지)도 그리지 않는다. 신호는 `NERVE` 선 위에서 시작한다.
- **훅:** H는 물속에서 주름이 생기고 물 밖으로 나와 주름을 보여 줄 뿐이다. 물방울은 손끝에서 떨어져 수면으로만 간다(피부로 들어가는 방울 없음). S2 "물에 불어서라고"에 불어나는 그림을 그리지 않는다.
- **베개(S9):** 처음 0.6초 이상 꽉 찬 베개를 보여 준 뒤 꺼진다. 네 모서리 자리(겉감 크기)는 그대로이고, 속이 줄어 겉감에 주름이 진다. 솜이 빠져나가는 구멍·흩날리는 솜·지퍼·바람이 새는 선처럼 "어디로 빠지나"를 보여 주는 것은 그리지 않는다(손끝에서는 무언가 새어 나가는 게 아니라 혈관이 조여 피가 덜 찬다). 물·물방울도 없다.
- **`proof`: `EMLA` 손가락 C에는 물(수면선·물방울·물결)이 없다**(8번). C는 욕조 벽 밖 마른 공기에 있고, A 쪽 물결이 벽을 넘지 않는다. 두 손끝의 주름 수(4)·자리와 `FLOW` 화살표 길이는 같다(8·9번 "nearly identical"). 숫자 배정은 `WATER` = `-2.29 cm/s`, `EMLA` = `-2.01 cm/s`다(G1). 화살표 길이를 숫자 비율로 맞추지 않는다. 크림은 손끝 끝마디(끝 ~ 첫마디 관절)에만 바른다("distal digit"). 크림 막은 LABEL 색이고 위험색(DANGER)이 아니다. 크림이 먼저 덮이고 주름이 뒤에 생긴다. `NO WATER`는 `FLOW`와 세로 8도트 이상 떨어뜨린다.
- **`finale`: 신호는 손가락 뿌리 쪽(위)에서 손끝 혈관 쪽(아래)으로만 흐른다**(5번). 물방울이 피부로 들어가는 화살표는 없다. `WRINKLE TEST`에 병원·기계·사람 그림을 더하지 않는다(출처는 검사의 존재만 말한다).
- **같은 물건은 같은 모양이다.** 손가락 넷(H·A·B·C)은 한 함수이고 배율만 다르다. 신경(LABEL 두 줄 + INK 신호)·혈관(INK 벽 + DEEP 속 + LABEL 피 점)·뼈(LABEL)는 `inside`와 `finale`에서 같은 색·모양이다. 카메라는 회전하지 않는다.
- 진화·영장류·원시인·구슬 집기 그림은 넣지 않는다(이 편에서 다루지 않는다).

### 화면 글자 목록

`WATER-`, `INDUCED`, `WRINKLING`, `WATER-INDUCED WRINKLING`(오늘의 원리 라벨), `NERVE OK`, `NERVE DAMAGED`, `?`, `NERVE`, `VESSEL`, `PULP`, `SKIN`, `FOLD`, `WATER`, `EMLA`, `NO WATER`, `FLOW`, `-2.29 cm/s`, `-2.01 cm/s`, `n = 25`, `WRINKLE TEST`만 쓴다. 원본 목록의 `FULL`·`SHRUNK`은 쓰지 않는다(카드 두 장 대신 유령선이 "원래 / 줄어든 뒤"를 보여 준다). 원본의 `↓`(6번)는 속살 안 안쪽 화살표로 쓰고, 손가락이 세로라 방향은 뼈 쪽(오른쪽)이다. `FLOW` 아래 화살표도 도트 도형이다. 한국어는 자막과 훅 제목·부제만 쓴다.

### 템플릿

- **공용 템플릿(수정 없음):** `hook`(`art`는 빈 함수, 세계는 장면 함수가 먼저 그린다), `pointer`(clue), `blinking`(clue `?`), `flow`(신호·피 점. 속도가 바뀌는 피 점은 `phase`에 누적값을 넘긴다), `SPARKLE_MASCOT`(finale), `cardt`. `compare`·`cutaway`·`steps`·`hud`·`band`·`kicker`는 쓰지 않는다. 엔딩 도장은 엔진이 붙인다.
- **편 폴더 새 부품 `cam.py`:**
  - `Cam(cx, cy, z)`: 화면 (90, 125)에 오는 세계 점과 배율. 회전 없음.
  - `KEYS`: 편 절대 시각 키 목록 `[(te, Cam, ease)]`(3절 표의 장면 시각 + 장면 시작 절대 시각). `cam_at(te)`는 12fps로 끊은 `te`에서 앞뒤 키를 보간한다. cx·cy는 그 구간 `ease`로 선형 보간, z는 로그 보간(확대 속도가 일정하게 보인다). 한 트랙이라 장면 경계에서 값이 끊기지 않는다. 불러올 때 키 시각이 늘어나는지, 표의 장면 경계 값과 같은지 `assert`한다.
  - `P(cam, wx, wy) -> (x, y)`: `round((wx − cx)·z + 90)`, `round((wy − cy)·z + 125)`. `S(cam, w)`: `round(w·z)`(크기). 훅 창은 같은 변환을 쓰고 그리기만 창으로 자른다.
  - `te(T, t)`: `ep.starts[장면 번호] + t`. `TA(T, i, k=0)`: `te(T, cardt(T, i, k))`.
- **편 폴더 새 부품 `world.py`:**
  - `draw_world(img, te, cam, clip=(0, 0, 179, 319))`: RGBA 층에 세계를 그려 `clip`으로 잘라 붙인다. 순서: 공기(BG) + 벽 타일(CARD 1도트, 24단위 간격) → 김(DITHER) → 욕조 벽(CARD 면, LABEL 테두리 하이라이트, OUTLINE 그림자) → 물 몸체(DEEP, 아래쪽 절반 세계에 붙은 DITHER Bayer) → 물속 티끌(CARD 2×1, 손가락 뒤) → 손가락(바깥 `finger()` 또는 단면 `section()`) → 수면선(INK 1도트 물결)·수면 고리(LABEL)·물결 고리·물방울. 캔버스 전체(y 0~319)를 세계가 채우고 엔진이 그 위에 자막 카드를 그린다(이음매 없음). 주요 그림은 y 250 위에 둔다.
  - `fstate(name, te) -> dict`: 손가락마다 상태를 절대 시각의 함수로 돌려준다. `tip_y`(들어 올림·담그기), `creases[4]`(0~1), `cream`(0~1), `wipe`(단면 0~1과 방향), `pulp`(0~1, 줄어듦), `vessel`(지름 비율 1 → 0.5), `grooves[4]`(0~1), `pulses`(신호 점 위치 목록), `flow_phase`(피 점 누적 전진량), `lit`(마루 밝힘). 표의 시각은 이 함수 한 곳에만 쓴다.
  - `finger(d, cam, f, st)`: 3절 ★ 손가락 사양. `section(d, cam, f, st)`: 3절 `inside` ★ 단면 사양(손가락 몸통 단면 포함, `finale`이 쓴다).
  - 그리기 규칙: 모든 도형은 세계 좌표에서 변환한 뒤 도트로 그린다(다각형 스캔라인, 원·타원 `draw.circle`·`ellipse`, 직선은 0°·45°·90°만). 확대는 비트맵을 늘리는 것이 아니라 다시 그리는 것이라 정수배 아닌 배율에서도 도트 크기가 섞이지 않는다. 선은 배율과 상관없이 1도트이고, 변환 뒤 2도트보다 작은 부품은 그리지 않는다(최소 형체 2px). 디더·무늬는 세계 좌표에 붙여 카메라를 따라 움직인다(화면에 붙이면 패닝 때 무늬가 미끄러진다). 45° 갈래는 변환 뒤 |dx| = |dy|가 되게 끝점을 맞춰 `flow`의 기울기 검사를 통과시킨다.
  - `tag(img, x, y, text, font, border, lit)`: CARD 판 이름표(Galmuri9 또는 bold), `lit`이면 글자 TEXT, 아니면 LABEL. 지시선 끝은 부품의 현재 화면 좌표를 받는다.
  - `pillow(d, x, y, u)`: 48×28 베개, `u` 0(꽉 참) → 1(꺼짐). 모서리 네 점은 `u`와 상관없이 같은 자리다.
  - `arrow(d, x, y, dx, dy, n)`: 도트 화살표(머리 `templates.head` 모양, 몸통 n도트).
- **편 폴더 검사 도구 `still.py`:** 출력 24fps 프레임마다 캔버스 y 0~251이 앞 프레임과 같은지 보고, 엔딩 도장 장면을 뺀 가장 긴 같은 구간이 24프레임(1.0초)을 넘으면 실패한다. 0.5초 넘게 멈춘 구간의 비율도 함께 출력한다(14편 47%와 비교할 값).
- 손가락은 `figure.py`의 반신상·얼굴 아이콘 대상이 아니다. 피부 면은 사람 색(`PEOPLE_COLORS`)이 아니라 팔레트 의미 색(INK 면 + 명암 2단, 하이라이트 TEXT / 그림자 DEEP)으로 그린다. 물은 DEEP 면 + INK 수면선이다.

### 효과음

| 장면 | 소리 | 시각(장면) | 이유 |
| --- | --- | --- | --- |
| `hook` | `pop`·`sparkle` | 템플릿(0.3·2.4) | 훅 템플릿 기본 |
| `clue` | `pop` | 이름표가 붙는 2.0 | 장면 첫 새 그림. 0초는 훅에서 이어지는 화면이라 소리를 두지 않는다 |
| `inside` | `pop` | 단면이 열리기 시작하는 0.8 | 장면 첫 새 그림 |
| `inside` | **`fall`(뜻 있는 소리)** | S7 시작 = `at(T, 1)` = 4.0 | 내려가는 음이 "부피가 줄어든다"를 들려준다. 이 편의 반전(불어나는 게 아니라 줄어든다)이 일어나는 순간이다. `pop` 0.8과 3.2초 떨어진다 |
| `proof` | `pop` | `WATER` 이름표 1.8 | 장면 첫 새 그림 |
| `finale` | `pop` | 단면이 열리기 시작하는 0.4 | 장면 첫 새 그림 |
| `finale` | `sparkle` | S13 시작 = 4.8 | 결론 반짝임. `pop`과 4.4초 간격 |

뜻 있는 소리는 `fall` 하나다. 절대 시각으로 이웃한 소리 간격은 최소 3.2초(`inside` `pop` 25.0 → `fall` 28.2)라 `SFX_GAP` 2초에 걸리지 않는다. 카메라 이동, 단면 닫기, 주름이 한 줄씩 생기는 연출, 담그기 물결, 물방울, 신호 점선, 크림, 베개, `pointer`, 이름표가 밝아지는 것에는 소리를 달지 않는다(반복 연출).

## 6. 메모

1. **시간 앞뒤가 어긋나는 곳(가장 확신 없음).** `clue` 끝에서 A는 이미 주름져 있는데, `inside` 단면은 주름 전 상태부터 과정을 보여 준다. 단면을 여는 점선 가로줄로 "보는 방식이 바뀐다"를 표시하고 바깥 주름이 펴지는 그림은 그리지 않기로 했지만, 시청자가 "다시 처음부터 본다"로 읽을지 프레임으로 확인해야 한다. 어색할 때 대안은 두 가지다. ① 단면이 열리는 0.8초 동안 수면 물결과 티끌을 잠깐 거꾸로 흘려 "되감기"를 보인다. "물이 주름을 편다"로 읽힐 위험이 있어 지금은 넣지 않았다. ② 아직 담그지 않은 손가락을 하나 더 두고 그 속으로 들어간다. 세계가 복잡해지고 `finale`이 A로 돌아오는 흐름이 끊긴다.
2. **연속 확대의 도트 떨림.** 정수배가 아닌 배율을 매 프레임 다시 그리면 윤곽이 1도트씩 들썩인다. 12fps로 끊어 줄였지만, 확대 구간(`clue` 0–2.4, `inside` 0–1.6·7.0–8.4·10.43–11.6, `proof` 0–2.4, `finale` 0–1.0·2.8–4.4)이 지글거리면 확대 키를 배율 1·1.5·2·3·4 근처에서 잠깐 머물게 바꾼다. Pi에서 프레임마다 세계를 다시 그리는 렌더 시간도 재 봐야 한다.
3. **세로 손가락.** 같은 수면 높이를 한 줄로 보이고 세로 캔버스를 채우려고 손가락을 세웠다. 그래서 "안쪽"이 아래가 아니라 오른쪽(뼈 쪽)이고, 원본의 `↓`가 오른쪽 화살표가 되며, `fall`은 방향이 아니라 "줄어든다"는 음높이로만 맞는다. 단면에서 피부가 오른쪽으로 물러나는 것이 "줄어든다"로 읽히는지는 유령선에 기대고 있다.
4. **단계 칩을 뺐다.** 이름표가 신경 → 혈관 → 속살 → 피부 순서로 밝아지는 것으로 대신했다. 자막을 가렸을 때 순서가 칩만큼 분명한지는 확인이 필요하다. 약하면 칩을 `inside`에만 되살린다(그림은 y 221 위로 다시 맞춘다).
5. **`pop` 자리.** 장면 경계가 하드 컷이 아니라서 `pop`을 장면 0.3초가 아니라 첫 새 그림(이름표·단면 열기)에 달았다. 관례와 다르다.
6. **0절과 길이 숫자.** 0절은 바이트 그대로 복사해 "본편 62.8초, 도장 포함 67.0초, 장면 6개"가 남아 있지만, 이 설계는 장면 5개, 61.93/66.13초다(문장·문장 시간은 같다).
7. **훅 창.** 세계를 y 152 아래에만 그려서, H가 `WRINKLING` 바로 아래에서 잘려 내려오는 것처럼 보인다. 훅 그림 칸 높이(약 98도트) 때문에 H가 원본 훅 손끝보다 작게(두께 57~79도트) 보인다.
8. **손 없는 손가락.** 손가락이 위 화면 밖에서 곧게 내려오고 손은 그리지 않는다. `clue`의 이름표가 손가락 위쪽을 덮어 "매단 이름표"처럼 보이는 것은 의도지만, 손가락 넷이 막대처럼 보이면 손톱·관절·지문면 볼록이 충분한지가 관건이다(원본 MUST 1의 교훈).
9. **C의 자리.** EMLA 손가락이 욕조 밖 공기에 매달린 것이 "물 없이 크림만"으로 읽히도록 벽을 경계로 썼다. 크림(LABEL + CARD 점무늬)과 손톱(LABEL 단색)이 같은 계열 색이라 크림이 손톱을 덮는 끝부분에서 구별되는지 봐야 한다.
10. **멈춤 상한을 배경에 기대는 구간.** `proof` 7.3–10.0과 `inside` S9(베개가 다 꺼진 14.3 이후)은 주인공이 다 변한 뒤라 물결·티끌·피 점·신호 점과 카메라 미세 이동으로 멈춤을 메운다. 낮은 대비 배경도 `still.py`에서는 "변함"으로 잡히지만, 사람 눈에는 멈춘 화면으로 보일 수 있다.
11. **단면 해부 단순화.** 실제 손가락에는 신경·동맥이 양옆에 하나씩 있지만 세로 단면에 한 쌍만 그렸고, 신경에서 혈관 벽으로 가는 45° 갈래는 교감신경 섬유를 도식으로 줄인 것이다. 출처는 "sympathetic nerve fibers"가 혈관 수축을 매개한다는 데까지만 말한다.
12. **`clue`의 `pointer`.** `pointer`는 화면 고정 좌표라, 카메라가 7.8–9.8에 B 쪽으로 다가가는 동안 시온과 B 사이 거리가 조금 바뀐다(B 오른쪽 끝 화면 x 155 → 149). 시온 왼쪽 끝(약 153)이 B와 살짝 겹칠 수 있다(겹침은 허용 범위).

## 게시 문구

물에 불어서만이 아니라, 속이 줄어서 쭈글해진다
목욕 뒤 쭈글한 손끝은 신경이 손끝 혈관을 조여 속살이 줄면서 생기는 주름이에요.

출처:
Haseleu et al. 2014, PLoS ONE https://pmc.ncbi.nlm.nih.gov/articles/PMC3885627/
Kareklas et al. 2013, Biology Letters https://pmc.ncbi.nlm.nih.gov/articles/PMC3639753/
Wilder-Smith & Chow 2003, Microvascular Research https://pubmed.ncbi.nlm.nih.gov/12826076/
Wilder-Smith 2015, Clinical Neurophysiology https://pubmed.ncbi.nlm.nih.gov/25216595/
Sáez & Zöllner 2017, Annals of Biomedical Engineering https://pubmed.ncbi.nlm.nih.gov/27913950/

#시온의원리노트 #손끝주름 #인체과학 #과학릴스
