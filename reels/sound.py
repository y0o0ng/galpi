"""효과음 표: 이벤트 → (파일, 상대 음량 dB). 템플릿·마스코트·scene이 이벤트 이름으로만 부른다(style.py가 색을 한 곳에 두는 것처럼).
내레이션 평균 -18.5dB·피크 -3.2dB, 효과음 파일은 피크 약 -1dB라 SFX_DB -16이면 내레이션 피크보다 약 14dB 아래다."""
from pathlib import Path
from manim import FadeIn

DIR = Path(__file__).resolve().parent / "sfx"
SFX_DB, MIN_GAP = -16.0, 3.0   # 공통 음량(한 곳), 효과음 시작 사이 최소 간격(초)
# 효과음은 박자에만: 장면의 첫 그림, 마스코트 지목·결론, 위험 표시, 대본이 정한 뜻 있는 소리(보글보글 등).
# 점선 그리기·단계 칩·범례 줄처럼 한 장면에서 여러 번 일어나는 연출에는 달지 않는다(짧은 간격 반복이 거슬린다).
EVENTS = {
    "pop": ("maximize_006.ogg", 0),      # 카드·그림 등장
    "select": ("select_001.ogg", 2),     # 강조·지목
    "chime": ("glass_002.ogg", 0),       # 결론 반짝임
    "danger": ("glitch_001.ogg", -4),    # 위험 표시 (파일이 큰 편)
    "bubbles": ("bubbles.wav", -6),       # 끓음·기포 (sfx/bubbles.py로 합성)
    "ticks3": ("ticks3.wav", -6),         # 딸깍 3번 (sfx/ticks.py로 합성)
}
_scene, _times = None, []


def bind(scene):
    global _scene, _times
    _scene, _times = scene, []


def cue(name, off=0.0):
    """현재 시각 + off초에 효과음. 직전 효과음과 MIN_GAP 안이면 건너뛴다."""
    t = _scene.renderer.time + off
    if any(abs(t - u) < MIN_GAP for u in _times):
        return
    _times.append(t)
    f, rel = EVENTS[name]
    _scene.add_sound(str(DIR / f), time_offset=off, gain=SFX_DB + rel)


def cue_for(animations):
    """play에 넘어온 애니메이션 중 mobject에 .sfx가 붙은 FadeIn은 그 소리."""
    for a in animations:
        tag = getattr(getattr(a, "mobject", None), "sfx", None)
        if isinstance(a, FadeIn) and tag:
            cue(tag)
