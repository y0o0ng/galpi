# 작업 지시: XION Reels {{episode}}편 Manim 미리보기

저장소: `{{repo}}`. 앞 편들이 이미 `reels/`에 있다. 이번 편은 **공용 모듈과 템플릿을 재사용**해서 만든다.

## 먼저 읽을 것
1. 확정 대본(유일한 내용 정본): `{{final_path}}`
   — 훅 카드, 시간·화면·내레이션 표, **제작 제약** 절을 그대로 따른다. 검토 결과·사실 확인 목록은 배경이다.
   대본 문장·시간·화면 글자 목록을 바꾸지 않는다. 그림으로 안 되는 게 있으면 바꾸지 말고 보고하라.
2. 기존 코드 전체: `reels/style.py`, `reels/mascot.py`, `reels/templates/*.py`, `reels/episodes/*/*`, `reels/render.sh`.
3. 설계 문서 `{{doc_path}}`의 2장, 5장, 6장.

## 경계 (어기면 실패)
- `reels/` 밖의 파일을 만들거나 고치지 않는다. `.venv`는 건드리지 않는다. 패키지 설치·git 조작 금지. 고화질 렌더 금지.
- 이 저장소에는 너와 무관한 미커밋 변경이 있을 수 있다. 절대 건드리지 않는다.
- **앞 편 결과가 바뀌면 안 된다.** 공용 모듈(`style.py`·`mascot.py`·`templates/`)을 고쳐야 하면 하위 호환으로만 고치고, 끝난 뒤 앞 편을 모두 다시 렌더해 길이·WARN 없음을 확인한다. 고치지 않고 되면 고치지 않는다.
- 새 템플릿은 제작 제약에 명세가 있는 것만 `reels/templates/`에 만든다. 템플릿은 에피소드 내용을 모르고 인자로 받는다(에피소드 전용 그림은 `art.py`). 그 외 새 템플릿이 필요하면 만들지 말고 보고하라.
- **제작 제약 절의 모든 항목을 지킨다.** 그리면 안 된다고 적힌 것은 그리지 않는다.
- 화면 안에 한국어 없음. 화면 글자는 대본의 화면 글자 목록의 영어·숫자·기호만.
- 마스코트는 대본에 적힌 곳만(훅 놀람, 가리키기, 결론 반짝임 — 시각은 대본 표). 다음 편 예고 없음.
- 효과음: 공용 계층(`reels/sound.py`, `timeline.py`)이 내는 소리는 그대로 두고, 제작 제약의 **뜻 있는 효과음**만 `scene.py`에서 `sound.cue(이벤트)`로 해당 문장 시점에 단다. 새 소리는 `reels/sfx/`에 합성 코드(예: `bubbles.py`)로 만들거나 CC0 파일과 라이선스 파일을 함께 두고 `sound.py` EVENTS에 등록한다. 반복되는 연출에는 소리를 달지 않는다.
- 쓰는 곳 없는 코드를 만들지 않는다.

## 파일
```
reels/episodes/{{episode_dir}}/
  narration.ko.json   장면 id별 내레이션 문장 + 훅 역설·부제 (글자만; 대본 표 그대로)
  scenes.json         장면 id 순서와 장면별 최소 길이(연출에 필요한 초)
  scene.py            `reels.timeline.TimedScene`을 상속, 장면 id와 같은 이름의 메서드. 연출 시각은 `self.when(문장번호, ...)`로 문장에 묶는다
  art.py              이번 편 전용 그림
  (timeline.json·subtitles.ko.ass는 `reels/tts.py`가 만든다 — 손으로 쓰지 않는다)
reels/render.sh       고치지 않는다(에피소드 폴더와 Scene 클래스를 인자로 받고, tts → manim → 자막·음성 합성까지 한다).
```

## 완료 조건
1. `bash reels/render.sh {{episode_dir}} <Scene>`로 `reels/media/{{episode_dir}}_preview.mp4`가 나온다. 길이는 timeline.json 총길이(±0.3초), 9:16, 렌더 로그에 WARN 없음.
2. 앞 편이 여전히 같은 길이·WARN 없음:
{{regression}}
3. 각 구간 중간 시각과 구간 끝 직전 프레임을 `reels/media/frames/{{episode_dir}}/`에 뽑아 직접 보고, 글자 잘림·겹침·한글 깨짐·색 오류·폰에서 안 읽힐 만큼 작은 글자가 없는지, 제작 제약의 물리·논리 조건(방향·순서·위치)이 프레임에서 맞는지 확인한다.
4. 보고(한국어): 파일별 역할 한 줄, 공용 모듈을 고쳤다면 무엇을 왜, 프레임 확인 결과, 대본과 다르게 한 곳, 확신 없는 곳.

환경: `reels/.venv/bin/python`, `reels/.venv/bin/manim`, ffmpeg는 `reels/.venv/bin/python -c "import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())"`.
렌더 → 프레임 확인 → 수정을 반복해서 완료 조건을 실제로 만족시킨 뒤 끝내라. 만족하지 못한 항목은 숨기지 말고 보고에 그대로 적어라.
