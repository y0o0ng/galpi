"""4편 장면 연출. 장면 길이·문장 시각은 timeline.json(tts.py)에서 오고, 그림은 templates/와 art.py가 그린다. 한국어는 narration.ko.json에만 있다."""
import sys
from pathlib import Path
import numpy as np
from manim import *

sys.path.insert(0, str(Path(__file__).parent))
import art as A
from reels import style as S, sound
from reels.timeline import TimedScene
from reels.mascot import mascot, at, sparkle
from reels.templates.hook_card import hook_card
from reels.templates.compare import compare
from reels.templates.steps import Steps, STAGE_CENTER
from reels.templates.cutaway import Cutaway, ROW_Y0

config.frame_width, config.frame_height = S.FRAME_W, S.FRAME_H
config.background_color = S.BG

TITLE = "STEPPED DRUM"
DRUM_XY, COUNTER_XY = (-0.9, 0.9), (3.0, 0.9)   # 펼친 드럼 중심(y -1.6~3.4), 숫자창 중심


def v3(xy):
    return np.array([xy[0], xy[1], 0.0])


def big(s, color=S.TEXT, size=84):
    return S.txt(s, size, color)


class Spin(Animation):
    """드럼의 위상 φ를 alpha로 돌린다. 드럼·숫자창이 이 애니메이션의 대상이라 렌더러가 프레임마다 다시 그린다."""

    def __init__(self, targets, drum, **kw):
        super().__init__(targets, **kw)
        self.drum = drum

    def interpolate_mobject(self, alpha):
        self.drum.wheel(alpha)


class Ep04(TimedScene):
    timeline = Path(__file__).parent / "timeline.json"

    def stage(self):
        """drum·set 장면이 같은 자리에 두는 드럼과 숫자창."""
        d = A.Drum(digits=True).move_to(v3(DRUM_XY))
        d.counter = A.Counter(0).move_to(v3(COUNTER_XY))
        return d

    def spin(self, d, extra=None):
        """크랭크 한 바퀴(T초). 위상 φ를 0→1로 선형으로 돌리고, 끝나면 그 상태를 새 기준으로 확정한다."""
        spin = Spin(Group(d, d.counter), d, run_time=A.T, rate_func=linear)
        self.play(AnimationGroup(*([extra] if extra else []), spin))
        d.commit()

    def hook(self):
        art = A.hook_art()
        card = hook_card("STEPPED\nDRUM", art, mascot("surprised", 3.2))
        self.play(FadeIn(card.term, shift=UP * 0.3), run_time=0.5)
        self.play(FadeIn(card.art), FadeIn(card.mascot, scale=0.5), run_time=0.5)
        self.until(self.when(1, 0.5))
        self.play(LaggedStart(*[Indicate(b, color=S.TEXT, scale_factor=1.08) for b in art.bars], lag_ratio=0.15), run_time=2.2)
        self.until(self.when(2))
        self.play(Rotate(art.gear, -A.TAU / 2, about_point=art.gear.get_center()), run_time=1.5)

    def problem(self):
        a, b = big("3 × 2"), VGroup(big("3"), big("+"), big("3")).arrange(RIGHT, buff=0.25)
        c = compare([("", a), ("", b)], [big("=", size=64)], TITLE)
        self.play(FadeIn(c.kicker), FadeIn(c.cards[0]), run_time=0.6)
        self.until(self.when(1))
        self.play(FadeIn(c.links[0]), FadeIn(c.cards[1], shift=RIGHT * 0.3), run_time=0.6)
        self.until(self.when(2, 0.3))
        for _ in range(2):
            self.play(Indicate(VGroup(b[0], b[2]), color=S.BRAND_INK, scale_factor=1.3), run_time=0.7)

    def drum(self):
        d = self.stage()
        cut = Cutaway([("STEPPED DRUM", S.LABEL), ("GEAR", S.TEXT), ("COUNTER", S.BRAND)], TITLE)
        self.play(FadeIn(cut.kicker), run_time=0.3)
        self.until(self.when(0, 0.2))
        self.play(FadeIn(d.frame), cut.reveal(0), run_time=0.6)
        self.until(self.when(1, 0.1))
        self.play(LaggedStart(*[FadeIn(t, shift=RIGHT * 0.2) for t in d.teeth], lag_ratio=0.2), FadeIn(d.digits), run_time=2.2)
        self.until(self.when(2, 0.2))
        self.play(FadeIn(d.gear, scale=0.5), cut.reveal(1), run_time=0.6)
        self.until(self.when(3, 0.2))
        self.play(FadeIn(d.counter), cut.reveal(2), run_time=0.6)

    def set(self):
        st, d = Steps(["SET 3", "TURN", "+3"], TITLE), self.stage()
        self.play(FadeIn(st), FadeIn(d), FadeIn(d.counter), run_time=0.4)
        self.until(self.when(0))
        self.play(st.activate(0), d.gear.animate.move_to(d.gear_point(3)), run_time=0.9)
        self.until(self.when(1))
        tip = v3((3.2, 2.9))
        m = at(mascot("pointing", 1.7, aim=d.teeth[1].get_center() - tip), tip)
        self.play(FadeIn(m), d.light(3, anim=True), run_time=0.5)
        self.until(self.when(2))
        sound.cue("ticks3", off=0.125)  # 밝은 줄 3개가 기어를 칠 때마다 딸깍
        self.spin(d, st.activate(1))
        self.play(st.activate(2), run_time=0.4)
        self.until(self.when(3))
        self.play(d.gear.animate.move_to(d.gear_point(0)), d.light(0, anim=True), run_time=0.6)  # 0 자리: 닿는 줄 없음
        self.spin(d)
        self.play(d.gear.animate.move_to(d.gear_point(3)), d.light(3, anim=True), run_time=0.6)

    def repeat(self):
        l, r = A.drum_card(3, 3), A.drum_card(3, 3)
        c = compare([("TURN ×1", l), ("TURN ×2", r)], [big("→", size=64)], TITLE)
        self.play(FadeIn(c.kicker), FadeIn(c.cards[0]), FadeIn(c.cards[1]), FadeIn(c.links[0]), run_time=0.6)
        self.until(self.when(1))
        sound.cue("ticks3", off=0.125)  # 같은 세 번이 다시: 또 3
        for k, v in enumerate((4, 5, 6)):
            self.until(self.when(1, 0.125 + k * 0.25))
            r.ctr.show(v)
        self.until(self.when(1, 1.5))
        self.play(Indicate(r.ctr, color=S.TEXT, scale_factor=1.15), run_time=0.7)

    def shift(self):
        left = A.turns("12 TURNS")
        l2, l1, eq = (S.txt(s, 34, S.TEXT) for s in ("2 TURNS → 6", "1 TURN → 30", ""))
        eq = big("= 36", S.BRAND_INK, 56)
        right = VGroup(VGroup(l2, l1).arrange(DOWN, buff=0.3), eq).arrange(DOWN, buff=0.5)
        for x in (l2, l1, eq):
            x.set_opacity(0)
        c = compare([("NO SHIFT", left), ("SHIFT", right)], [A.divider()], "× 12")
        self.play(FadeIn(c.kicker), FadeIn(c.cards[0]), run_time=0.6)
        self.until(self.when(1))
        self.play(FadeIn(c.links[0]), FadeIn(c.cards[1], shift=RIGHT * 0.3), run_time=0.6)
        self.until(self.when(2, frac=0.3))
        self.play(l2.animate.set_opacity(1), run_time=0.4)
        self.until(self.when(2, frac=0.6))
        self.play(l1.animate.set_opacity(1), run_time=0.4)
        self.until(self.when(3))
        self.play(eq.animate.set_opacity(1), run_time=0.4)

    def finale(self):
        s, t = A.drum_card(3).set_height(2.2), A.turns("×2", 44)
        c = compare([("SET", s), ("TURN", t)], [big("×", size=64)], TITLE, y=1.7, h=3.2)
        self.play(FadeIn(c.kicker), FadeIn(c.cards[0]), FadeIn(c.cards[1]), FadeIn(c.links[0]), run_time=0.6)
        self.until(self.when(1))
        res = big("= 6", S.BRAND_INK, 80).move_to(v3((0, -0.9)))
        self.play(FadeIn(res, shift=UP * 0.2), run_time=0.5)
        self.until(self.when(2, 0.3))
        m = at(mascot("sparkle", 2.4), (2.9, -1.9))
        self.play(FadeIn(m, scale=0.6), run_time=0.4)
        self.play(sparkle(m))
