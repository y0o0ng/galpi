"""timeline.json(tts.py가 만든다) 길이대로 장면 메서드를 차례로 부르는 Scene. 장면 id와 같은 이름의 메서드가 그 장면을 그린다."""
import json
from manim import Scene
from reels import sound


class TimedScene(Scene):
    timeline = None  # 서브클래스가 timeline.json 경로를 지정한다

    def construct(self):
        sound.bind(self)
        for sc in json.loads(self.timeline.read_text())["scenes"]:
            self.sc = sc
            getattr(self, sc["id"])()
            self.until(sc["end"] - sc["start"])
            self.clear()

    def play(self, *animations, **kw):
        sound.cue_for(animations)
        super().play(*animations, **kw)

    def when(self, i, off=0.0, frac=0.0):
        """장면 시작 기준 초: i번째 문장 시작 + 문장 길이의 frac + off."""
        s = self.sc["sentences"][i]
        return s["start"] - self.sc["start"] + frac * (s["end"] - s["start"]) + off

    def until(self, t):
        """장면 시작 기준 t초까지 wait로 채운다."""
        d = self.sc["start"] + t - self.renderer.time
        if d < -0.1:  # 15fps 반올림 한 프레임(0.07s)은 넘쳐도 정상
            print(f"WARN: {self.sc['id']} {t:.2f}s 지점이 {-d:.2f}s 넘침")
        if d > 0.07:  # 한 프레임보다 짧은 wait는 manim이 경고한다
            self.wait(d)
