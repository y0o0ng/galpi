# 작업 지시: XION Reels {{episode}}편 도트판

저장소 `{{repo}}`. 앞 편 도트판들이 `reels/episodes/*_px/`에 있고 사용자가 승인했다. **가장 최근 편 도트판이 형식 기준이다.** 이번 편은 공용 엔진·템플릿을 재사용해서 만든다.

## 먼저 읽을 것
1. `reels/px/reels-pixel-handoff.md` — 도트 트랙 정본(화면·팔레트·자막 카드·시간·소리·마스코트·그림·"말한 변화는 화면에서 일어난다"·도트 그리기 규칙)
2. `reels/px/templates.py`와 앞 편 도트판 `scene.py`·`art.py` — 구조 기준
3. 이 편의 Manim판 `reels/episodes/{{manim_dir}}/` (`scene.py`·`art.py`·`narration.ko.json`·`scenes.json`) — **장면 흐름과 타이밍(`self.when(i, frac)` ↔ `at(T, i, frac)`)은 Manim판을 따른다**
4. 설계 문서 `{{doc_path}}`의 이 편 부록(대본 표, 사실 확인 목록, **제작 제약**, **화면 글자 목록**). 그림은 제작 제약의 물리·논리 조건을 어기면 안 되고, 화면 글자는 그 목록에 있는 것만 쓴다.

## 만들 것
`reels/episodes/{{episode_dir}}/` — `narration.ko.json`·`scenes.json`은 Manim판에서 복사(글자 바꾸지 않음), `art.py`(이 편 그림), `scene.py`(`Episode` 실행기). 출력 `reels/media/{{out_name}}.mp4`.

- 카드 분할은 엔진이 한다. 한두 마디만 혼자 뜨는 꼬리 카드가 생기면 쉼표 뒤 공백 자리에만 ` / `를 넣을 수 있다(글자는 그대로). 넣은 자리를 보고.
- 새 배치가 필요하면 `px/templates.py`에 이번 편이 실제로 쓰는 것만 더한다. 기존 함수의 동작은 바꾸지 않는다(새 인자는 기본값이 옛 동작).
- 새 효과음이 대본의 뜻 있는 소리로 필요하면 `px/audio.py` `sfx`에 종류만 더한다(사인파, 낮은 피치, 둥근 엔벌로프, 음량 상수 불변).
- 주인공 그림은 크게, 장면이 말하는 대상이 바로 눈에 들어오게. 마스코트는 역할이 있을 때만, 카드 글자·화면 라벨을 가리지 않게.

## 경계
- **앞 편 도트판의 화면·소리는 픽셀 하나도 안 바뀌어야 한다.** 작업 전에 HEAD 기준(`git archive HEAD`로 따로 풀기 등)으로 앞 편마다 전체 프레임 `frame(i).tobytes()`와 `sound()` 세 트랙 해시를 떠 두고, 끝나면 비교해 보고하라.
- Manim 트랙 파일(`reels/episodes/`의 `_px` 아닌 폴더, `reels/templates/`, `style.py`, `mascot.py`, 최상위 `timeline.py`, `sound.py`, `tts.py`, `render.sh`) 수정 금지. `reels/` 밖 금지. 패키지 설치·git 금지. `px/bgm.py`·`px/sprite.py`·`px/engine.py` 수정 금지. 쓰는 곳 없는 함수 금지.
- 렌더는 `nice -n 19`로 한 번에 하나, 파이썬은 `reels/.venv/bin/python`.

## 완료 조건
1. `reels/media/{{out_name}}.mp4` lint 통과. 앞 편 해시 전부 일치.
2. 프레임을 `{{frames_dir}}`에 뽑아라: 장면마다 mid·end, 문장마다 그 문장 카드가 다 찍힌 순간, 움직임의 중간 순간들, 마스코트가 나온 순간. 파일 이름은 `장면_순간.png`. **전부 직접 열어 보고** 겹침·잘림·제작 제약 위반·화면 글자 목록 밖 글자가 없는지 확인하고 고쳐라.
3. 보고서를 `{{report_path}}`에 써라(독립 시각 검토자가 읽는다): 장면별 길이(min 대비), 카드 표, 효과음 kept/dropped, 프레임 파일별 무엇이 보이는지 한 줄, 제작 제약 조건마다 어느 프레임에서 확인했는지, 새/바뀐 파일과 템플릿 API, 확신 없는 곳. 같은 내용을 최종 답으로도 한국어로 짧게.
