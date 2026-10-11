# 시온의 원리노트 — 카드뉴스 템플릿 초안

현재 기본은 **GPT-6.1 Sol 통합 제작**이다. Luna 후보→화제성 확인→사람 선택→6.1 Sol 대본+카드 생성→독립 출처·문구 검토→독립 시각 검토→수정으로 진행한다. 자세한 계약과 단계 프롬프트의 정본은 [통합 제작 지침](../prompts/cards_integrated_trial/README.md), 서버 실행 정본은 [pipeline.md](pipeline.md)다. 아래 9종 템플릿과 크기/슬롯은 콘텐츠 배치의 출발점이다. 공통 헤더/푸터를 제외한 편 전용 콘텐츠 코드는 조정할 수 있으며 실제 모바일 가독성은 시각 검토가 판단한다.
`examples/`는 가상 내용이며 게시용 뉴스가 아니다. 디자인 목표는 `design-v0.2.md`다.

## 역할과 범위

- 제작 GPT-6.1 Sol: 대본·그림·사진·배치를 함께 만들고 한 장씩 렌더·자가 검토·수정한다.
- 독립 출처·문구 검토 GPT-6.1 Sol: 사실·출처·문구만 확인하며 시각 요소는 제외한다.
- 독립 시각 검토 GPT-6.1 Sol: 실제 이미지와 모바일 축소본에서 글자 크기·배치·사진/그림·브랜드·가독성을 확인한다.
- 수정 GPT-6.1 Sol: MUST를 고치고 영향을 받은 독립 검토를 다시 받는다.
- 사람: 후보 주제/형식 선택과 최종 게시 승인. 공용 코드는 읽기 전용이고 헤더/푸터는 서버가 공통 프레임으로 유지한다.

## 조립 규칙

내용에 맞게 설명 단계를 정하고, 각 단계는 1~2페이지로 구성한다. 단계의 종류·개수·진행 순서는 주제와 독자의 질문에 맞게 대본 에이전트가 정한다.
독자가 알고 싶어하고 이해에 필요한 정보와 관심을 끄는 내용을 앞에 둔다. 표지는 단순 발표 안내를 넘어 근거 있는 후킹을 담고, 본문은 그 궁금증에 답한다. 부차적인 일정·사양은 핵심 설명을 밀어내지 않는다.
뉴스: 최소 4장, 권장 4~6장, 최대 7장.
비교: 최소 4장, 권장 5~6장, 최대 8장.
첫 페이지는 `cover`, 마지막 페이지는 `closing` 지면을 사용한다. 이 지면 형식이 본문의 내용 단계나 진행 순서를 정하지는 않는다.
한 장에 억지로 압축하거나 장수를 맞추려고 빈 페이지와 반복 설명을 만들지 않는다. 중요한 한계는 관련 주장 옆에 붙이거나 필요한 분량으로 설명한다. 전체 장수 상한은 유지한다.

| 고정 layout | 역할 | 입력 |
| --- | --- | --- |
| `cover` | 과감한 제목과 비대칭 표지 | title, body, 선택 art |
| `story` | 사실·배경·한계·시장 영향·관련 원리 | title, body, 선택 composition·statement·art |
| `points` | 핵심 변화 1~3개 | title, body, items[{title, body, 선택 art·emphasis}] |
| `numbers` | 두 대상의 지표 1~3개, 공통 0 기준 가로 막대 | title, body, labels[2], rows[{label, values[2], max, unit, 선택 criterion}], note |
| `compare` | 한눈 비교 또는 비교 축 하나 | title, columns[2]({name, body, 선택 art}) |
| `closing` | 의미·한 줄 정리 또는 누구에게 맞나 | title, statement, body |
| `stat` | 하나의 큰 숫자와 조건 | title, value(문자열), 선택 unit(문자열), label, body, note |
| `steps` | 순서가 있는 과정 2~4단계 | title, body, items[{title, body}] |
| `quote` | 중간 페이지의 인용과 맥락·해석 | title, statement, attribution, body |

9종은 선택 가능한 페이지 종류의 수이며 한 게시물의 장수가 아니다. 기존 뉴스 4~7장·비교 4~8장 계약은 유지한다.
같은 layout을 한 편이나 여러 편에서 반복해도 된다. 매번 다른 구도를 만들거나 9종을 모두 사용할 필요는 없다.
v0.2는 기존 9종의 역할을 유지하며 제목 위계·기본 배치·본문 크기·상자 사용을 수정한다. 이전 시안 이미지는 기존 출력 경로에 남아 있다.

모든 카드는 `eyebrow`(짧은 영문 분류)가 필수다. 출처는 전체 `source`를 기본으로 쓰고 카드별 `source`로 바꿀 수 있다.
확장 의미 슬롯마다 새 레이아웃을 만들지 않는다. 숫자가 없는 비교는 `compare`로, 숫자 근거가 있을 때만 `numbers`로 표현한다.
지표별 상한 `max`는 대본이 확정하며 같은 지표의 두 대상에 동일하게 적용한다. 선택 `criterion`은 각 지표 옆에 표시할 판단 기준(예: 높을수록 유리·낮을수록 유리)이며 확정 대본에서 받는다. 단위나 수치로 유리한 방향을 추정하지 않는다. 서로 다른 단위의 지표끼리 막대 길이로 비교하지 않는다.
실측·기업 주장·추정의 구분, 높고 낮음의 의미, 조건·날짜·원문 링크는 확정 대본에 남긴다.
`stat`의 숫자·단위는 확정 원고 그대로 넣고, `note`에 기준·조건을 적는다.
숫자와 단위의 위계를 나누려면 `value: "2.4", unit: "배"`처럼 입력한다. 숫자는 168px, 단위는 96px로 밑선을 맞추고, 지표명은 숫자 아래에 붙인다. unit이 없으면 기존 value 문자열 전체를 크게 표시한다.
`quote`의 발언은 원문 그대로 쓰며 `attribution`에 발언 주체·날짜를, `body`에 맥락이나 해석을 분리해 적는다.

## 지면의 질서와 가변 영역

머릿말은 위아래 선 사이에 릴스 별 실루엣의 픽셀 로고·브랜드명을 왼쪽에, 카테고리·진행 칸·페이지 번호를 오른쪽에 둔다. 진행 칸은 번호 왼쪽에 24px 간격으로 붙이며 현재 장은 잉크, 읽은 장은 보라, 남은 장은 보조선 테두리다. 카테고리와 번호의 오른쪽 끝을 맞춘다.
페이지 번호는 머릿말에만 둔다. 바닥말은 왼쪽 **짧은 출처**, 오른쪽 **발행일**을 y 1270 한 줄에 둔다. 별도 출처 줄은 없다. `topic`은 편의 메타데이터로 유지하되 지면에 반복하지 않는다. 긴 출처·링크·측정 조건은 확정 원고와 캡션에 둔다.
편 입력의 `topic`은 비어 있지 않은 주제 문자열, `date`는 실제 날짜 `YYYY-MM-DD`다. 날짜는 모델이 현재 시각으로 추정하지 않고 확정 대본에서 받는다.
출력 날짜는 `YYYY.MM.DD`다. 모든 장이 같은 주제·날짜를 공유한다.
제목은 같은 왼쪽 거터를 공유하되 역할에 따라 크기를 나눈다. 표지는 큰 제목, 설명은 단정한 제목,
숫자·인용·결론은 조용한 제목과 큰 콘텐츠를 사용한다. 모든 페이지가 다를 필요는 없다.
같은 레이아웃을 반복하되 한 편 안에서 그림 중심·텍스트 중심·데이터·분할·결론을 내용에 맞춰 조립한다.

| layout | 기본 제목 크기 | 기본 content top | 기본 끝 |
| --- | ---: | ---: | ---: |
| cover | 120px | 510 | 1140 |
| story | 72px | 334 | 1140 |
| points | 72px | 350 | 1120 |
| numbers | 60px | 318 | 1140 |
| compare | 72px | 390 | 1120 |
| closing | 60px | 350 | 1120 |
| stat | 60px | 334 | 1120 |
| steps | 72px | 334 | 1120 |
| quote | 60px | 334 | 1120 |

선택 필드 `title_style`은 `display`(120px)·`standard`(72px)·`quiet`(60px)다.
핵심 발표를 크게 보여줄 때는 display를 쓸 수 있다. 제목은 최대 두 줄이며 뜻 단위에서 자연스럽게 끊는다.
원본 비율 한글의 한 줄 기본 수용량(912px)은 표지 7자·설명 12자·조용한 제목 15자다. 공백·영문·숫자는 폭이 달라 실제 렌더 검증을 따른다.
불필요한 3~4줄이나 제목 넘침은 원고를 수정한다. 렌더러가 문구를 바꾸거나 글자를 줄이지 않는다.

콘텐츠 시작은 **실제로 렌더한 제목의 끝 + 32px** 아래여야 한다.
제목이 두 줄이거나 display이면 기본 top보다 내려갈 수 있고, 기본 끝은 유지한다.
선택 필드 `content: {"top": 370, "height": 700}`은 출력 픽셀 기준이다.
top·height는 정수, height는 양수, 영역 끝은 y 1160 이하다.
미지정 값은 위 기본값과 제목의 실제 높이로 계산한다. 이후 story·closing·stat·quote의 실제 그림/텍스트 묶음을 콘텐츠 영역의 광학적 중앙에 둔다. 묶음 위 여백은 남는 높이의 42%, 아래는 58%다. 표지는 본문을 콘텐츠 시작에 붙여 제목과 연결한다. 직접 `content`나 카드의 `art_box`를 지정하면 자동 이동 없이 해당 좌표를 보존한다.
콘텐츠의 위치·상자 높이·간격은 새 영역에 비례 배정하지만 **글자 크기는 유지한다**.
원고가 넘치거나 그래프 수치의 행간이 겹칠 만큼 좁으면 오류로 중단한다.

### 그림·텍스트 구도

story의 선택 필드 `composition`으로 내용에 맞는 구도를 선택한다.

| composition | 공간 규칙 | 필요한 내용 |
| --- | --- | --- |
| stacked | 본문 위·큰 그림 아래 | body, art |
| visual | 큰 그림 위·설명 아래 | body, art |
| split | 그림 왼쪽·설명 오른쪽 | body, art |
| text | 텍스트 중심, 그림 없음 | body, 선택 statement |

composition이 없으면 art가 있는 페이지는 stacked, 없는 페이지는 text를 쓴다.
그림 중심 구도에 art가 없거나 text 구도에 art를 넣으면 오류다.
text의 statement는 본문보다 큰 픽셀 문장으로, 아래 본문과 한 묶음으로 배치한다.
표지도 art 없이 사용할 수 있다. 장식 목적으로 그림을 넣을 필요는 없다.
큰 메인 일러스트·설명 도식은 story/cover, 작은 아이콘은 points, 대상별 그림은 compare의 공간 규칙을 쓴다.

그림의 선택 필드 `art_box: [x,y,width,height]`는 배정된 그림 슬롯 **안에서** 위치·크기·비율을 조정한다.
좌표는 최종 출력 픽셀 기준이며 본문 영역으로 이동할 수 없다.
표지·story는 카드에, points는 해당 item에, compare는 해당 column에 넣는다.
미지정이면 구도별 기본 슬롯 안에서 투명 PNG를 최근접 정수배로 확대·중앙 배치한다.
그림 원본의 비율·투명 여백까지 고려해 최종 이미지에서 글과의 관계를 확인한다.

작은 그림 예: stacked story의 `content: {"top": 370, "height": 700}`, `art_box: [300,760,480,260]`.
넓은 그래프 예: numbers의 `content: {"top": 318, "height": 842}`.
확정 대본의 명시 좌표·크기와 의미상 제약은 그대로 따른다. 미지정 영역은 Luna가 기본 배치로 시작해 이 필드로 공간을 조정할 수 있으며 바꾼 값과 이유를 보고한다. 공용 레이아웃·글자 크기·확정 layout·composition·title_style·카드 장수와 순서는 바꾸지 않는다.

## 고정 시각 규칙

- 1080×1350, 바깥 여백 84px. 아이보리 `#F4F1E8`, 잉크 `#120F1E`, 민트 `#8FE3B4`, 딥그린 `#2F6B57`, 보라 `#9D7CFF`, 다크 `#221C38`. 보조선 `#B9B3D6`.
- 도트 그래픽과 미니멀 에디토리얼을 결합한 독립 기술 매거진을 목표로 한다. 아이보리에 낮은 대비의 1px 종이 입자와 드문 2~4px 도트를 넣는다. 제목 끝 + 32px 위와 머릿말·바닥말은 깨끗하게 두고, 표지의 오른쪽 아래·결론의 오른쪽 바깥 여백에만 옅은 딥그린 도트가 모인다. 고정 seed로 매번 같은 질감을 출력하며 글자·그림·데이터 위에 질감을 덮지 않는다.
- 제목·큰 숫자·강조·번호 배지는 던파 비트비트체 v2(DNF Bit Bit v2)의 원본 Regular 한 굵기를 쓴다. 공용 렌더러가 실제 출력 크기에서 원본 가로·세로 비율로 1비트 렌더한다. 가로 확장은 이전 Mona 폰트에만 적용했던 규칙이며 던파체에는 적용하지 않는다. 폰트 파일과 획을 변형하거나 인위적으로 굵게 만들지 않는다. 제목 크기는 표지 120px, 설명 72px, 데이터·조용한 제목 60px다. 첫 줄은 딥그린, 나머지는 잉크다.
- 줄바꿈·숫자/단위 폭·번호 중앙 정렬은 원본 비율의 실제 잉크 폭으로 계산한다. 결론은 민트 강조·아이보리 나머지 두 색이며, 인용은 왼쪽 세로선으로 구분한다.
- 본문은 산세리프 Medium 40~46px·잉크색, 항목 설명은 Medium 38px·잉크색, 그래프 수치는 둘 다 잉크색 44px bold·지표명 36px·범례 32px다. 보라는 아이보리 위 글자색으로 쓰지 않고 막대·색 표식·그림 면에만 쓴다. 큰 숫자는 168px·단위 96px, 인용·결론 강조는 72px다.
- points는 1~3개 항목 수에 따라 간격을 배정하고 테두리 없이 같은 열 정렬과 여백으로 묶는다. points·steps의 번호 배지는 딥그린으로 통일한다. 번호는 실제 글자 잉크 기준으로 배지 중앙에 맞춘다. 아이콘은 묶음의 중심, 제목·본문은 같은 텍스트 열에 둔다. `emphasis: true`는 중요한 항목에만 연한 강조 면을 더한다. compare는 두 열과 짧은 구분선을 쓰며, 잉크색 라벨 앞의 A=민트·B=보라 표식으로 큐브와 연결한다.
- 그래프는 공통 0 기준을 유지하고 배경 막대의 무게를 낮춘다. 기준·조건·높고 낮음의 의미는 짧은 note와 확정 대본에 남긴다.
- 그림은 투명 RGBA PNG, 최근접 정수배 확대. 한 편의 설명 도식·작은 아이콘·비교 큐브는 출력 도트 크기를 맞춘다. 현재 샘플은 4px 격자이며 화살표도 계단형 도트다. 표지의 큰 그림은 별도 비례를 허용한다. 주인공은 외곽선·면별 명암·의미 있는 부품을 갖춘다. 배경 격자·반짝임을 장식으로 억지 추가하지 않는다.
- 브랜드 로고는 기존 `px/sprite.py`의 `body_mask()`를 원본 도트에서 딥그린 테두리와 민트 채움으로 만든 41×53px 원본을 사용한다. 기존 모서리를 유지하고 바깥에만 4단계 도트 그라데이션을 둔다(투명 자산 49×61px). 브랜드명은 sans bold 36px, 분류·페이지 번호는 bold 26px, 바닥말은 Medium 26px다. 페이지 번호는 실제 글자 폭으로 분류와 같은 오른쪽 끝에 맞춘다.
- 결론은 어두운 지면에 미세 도트와 **릴스의 `sprite("sparkle")` 캐릭터 원본**을 넣는다. 따옴표와 별도 십자 반짝이 장식은 쓰지 않는다. 캐릭터는 정확히 4배 확대하고 텍스트 옆 별도 열에 배치하며 사람 캐릭터로 대체하지 않는다.
- 출처는 짧은 이름·날짜를 카드에, 원문 전체 URL·발표 주체·조건은 캡션과 확정 대본에 남긴다. preview는 검토용이며 게시 카드가 아니다.

## 실행

Pillow는 기존 릴스 의존성이다. Pillow가 있는 Python을 사용한다. 새 패키지나 렌더 서비스는 필요 없다.
macOS 시안은 Apple SD Gothic Neo Medium/Bold(TTC index 2/6)를 사용한다. 이 시스템 폰트를 저장소에 복사하지 않는다.
카드 픽셀 폰트는 `px/fonts/DNFBitBitv2.otf`다. 없으면 `bash reels/px/fonts/fetch.sh`로 공식 원본을 받는다. SHA-256은 `ffa93fec1e4407156b04a1eb2aad3018746d4eb3ef3000c0720e49f068dda622`, 고지는 `px/fonts/LICENSE-dnfbitbitv2.txt`에 보존한다. [공식 안내](https://df.nexon.com/data/font/dnfbitbitv2)를 따른다. 릴스 갈무리11 자막은 독립이다.
서버 본문은 사용자 승인에 따라 Pretendard Medium/Bold를 사용한다. 서버가 파일 경로·collection index를 지정하고 macOS의 Apple 시스템 폰트는 복사하지 않는다. 설치와 서버 연결 상태는 `pipeline.md`가 정본이다.

```sh
python reels/cards/examples/art.py
python reels/cards/render.py reels/cards/examples/news.json --out reels/media/cards/news-pixel --font /System/Library/Fonts/AppleSDGothicNeo.ttc --bold-font /System/Library/Fonts/AppleSDGothicNeo.ttc --font-index 2 --bold-index 6
python reels/cards/render.py reels/cards/examples/compare.json --out reels/media/cards/compare-pixel --font /System/Library/Fonts/AppleSDGothicNeo.ttc --bold-font /System/Library/Fonts/AppleSDGothicNeo.ttc --font-index 2 --bold-index 6
python reels/cards/preview_templates.py --out reels/media/cards/template-library --font /System/Library/Fonts/AppleSDGothicNeo.ttc --bold-font /System/Library/Fonts/AppleSDGothicNeo.ttc --font-index 2 --bold-index 6
CARD_FONT=/System/Library/Fonts/AppleSDGothicNeo.ttc CARD_BOLD_FONT=/System/Library/Fonts/AppleSDGothicNeo.ttc CARD_FONT_INDEX=2 CARD_BOLD_INDEX=6 python reels/cards/test_render.py
```

`examples/layouts.json`은 9종 검토용 목록이며 게시용 deck 입력이 아니다.
`preview_templates.py`는 그림 없는 9종을 출력하며 `--with-art`면 샘플 그림도 넣는다.
`variants/`는 콘텐츠 크기 조정, `compositions/`는 story 구도 비교다. 그림 없는 비교본에는 슬롯 경계만 검토용으로 표시한다.
v0.2 후속 검증: 23개 테스트로 9종 렌더·콘텐츠 이동·넘침·장수·그래프 값/행간·정수 픽셀·가로 확대의 배율 비례/줄바꿈·배경 질감의 재현성/글자·그림·메타데이터 보존·그림 슬롯·단위·4개 story 구도·제목 위계·항목 수·섹션 3장 확장·머릿말 픽셀 격자·한 줄 바닥말 출처/날짜·배지 잉크 정렬·릴스 캐릭터의 픽셀 동일성·광학적 중앙 이동·항목 대비·인용부호 제거·샘플 도식/아이콘의 4px 도트 통일을 확인했다.
실제 디자인 인수는 개별 PNG와 390px 폭 모바일 미리보기를 보고 한다. 이 미리보기는 휴대폰 실기기나 Instagram 압축 검증을 대신하지 않는다.

실제 편은 `reels/work/cards/<편 ID>/` 안에 확정 대본, `deck.json`, `art.py`, 투명 그림 PNG, `caption.txt`, `report.md`를 둔다.
`deck.json`은 `{ "mode": "news" 또는 "compare", "topic": "편의 주제", "date": "YYYY-MM-DD", "source": "짧은 출처", "cards": [...] }`다.
`art`는 `deck.json` 기준 파일 경로다. 구조 예시는 `examples/news.json`·`compare.json`을 따른다.
원고 내용과 카드별 레이아웃·그림 제작 제약은 상위 모델이 확정하고 Luna가 임의 변경하지 않는다.
출력 디렉터리는 편별 전용 경로여야 한다. 같은 디렉터리 재렌더는 두 자리 번호 카드와 preview만 갱신하고 잔여 번호 카드는 제거한다.

이하 분리 조립 프롬프트 설명은 이전 실행의 참고 계약이다. 새 제작은 통합 제작 지침을 따른다. 이전 조립 프롬프트는 `../prompts/build_cards.md`다. PASS인 최종 원고와 선택된 mode를 받아 deck·그림·캡션·검토용 카드·390px 개별 축소본·보고서를 만든다. 보고서 상태는 READY_FOR_REVIEW/BLOCKED이며 전자는 독립 완성본 검토 준비 상태다. 기존 `../prompts/render.py`로 빈칸을 채울 수 있다.
후보 선정 초안은 `../prompts/candidates_cards.md`다. 최근 7일 기술 전반의 소식 중 일반인용 2개·실무자용 1개를 제안하고 각 후보의 `mode`(news/compare), 형식 추천 이유, 독자 질문을 표시한다. 독자 구분과 게시 형식은 독립이며 형식별 할당량은 없다. 비교는 새 소식에 연결된 두 대상과 근거 있는 비교 축을 요구한다.
선택된 후보의 형식별 대본 프롬프트 초안:

| 후보 mode | 게시 형식 | 대본 프롬프트 | 장수 |
| --- | --- | --- | --- |
| `news` | 뉴스 브리프 | `../prompts/script_cards_news.md` | 4~7장 (권장 4~6) |
| `compare` | 기술 비교 | `../prompts/script_cards_compare.md` | 4~8장 (권장 5~6) |

후보에서 선택한 mode를 편 정보와 deck까지 유지한다. 서버의 `lib/cards/production.js`가 해당 파일을 선택해 입력값을 치환하고 독립 세션으로 호출한다. 대본 에이전트는 형식을 임의 변경하지 않고, 선택된 형식으로 표현할 근거가 부족하면 그 이유를 보고한다. 편의 형식과 페이지별 layout은 다른 개념이므로 뉴스에서도 compare 지면을 사용할 수 있다.
두 대본 프롬프트 모두 본문·강조 문장·캡션은 담백한 해요체로, 제목·라벨은 짧은 명사구도 허용한다. 카드별 문구와 그림의 의미는 대본에서 정하고, 세부 위치·크기·여백은 조립 단계가 공용 템플릿의 허용 영역에서 조정한다. 독립 대본 검토 초안은 `../prompts/review_cards.md` 하나를 두 형식에 공통 사용한다. 선택된 후보와 mode를 함께 받아 편집·사실·제작 제약을 직접 수정하고 최종 원고에 PASS/BLOCKED 및 수정 내역을 남긴다. 서버의 호출·판정·확정 원고 대조는 `lib/cards/production.js`에 연결했고 첫 실제 실행 결과는 `pipeline.md`에 남긴다.
완성본 검토 초안은 `../prompts/review_visual_cards.md`다. 원고·deck·캡션·원본 및 390px 개별 축소본을 대조하고 MUST/NICE와 PASS/NEEDS_FIX/BLOCKED를 남긴다. 수정 초안은 `../prompts/fix_cards.md`이며 Luna가 MUST만 수정·재렌더한다. 수정 뒤에는 독립 완성본 검토를 새로 호출해 현재 이미지 전체를 다시 확인한다. 원고나 공용 템플릿 변경이 필요하면 BLOCKED로 남기며 조립이 임의 변경하지 않는다.
단계별 서버 연결·재시도·승인·게시 계약과 첫 실제 실행 결과는 [pipeline.md](pipeline.md)가 정본이다. 후보 선정·대본·대본 검토·완성본 검토는 Sol이고, 현재 새 제작은 전 단계 GPT-6.1 Sol medium이다. 첫 실행은 GPT-5.6 Sol이며 모델 비교는 이후다. 콘텐츠·미감 판단은 파이프라인 검토 에이전트가 맡고, 개발자는 서버 실행 오류만 처리한다.
