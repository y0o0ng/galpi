"""1편 장면 연출. 장면 길이·문장 시각은 timeline.json(tts.py)에서 오고, 그림은 templates/와 gears.py가 그린다. 한국어는 narration.ko.json에만 있다."""
import sys
from pathlib import Path
import numpy as np
from manim import *

sys.path.insert(0, str(Path(__file__).parent))
import gears as G
from reels import style as S
from reels.timeline import TimedScene
from reels.mascot import mascot, at, sparkle
from reels.templates import steps as steps_t, cutaway as cutaway_t
from reels.templates.hook_card import hook_card
from reels.templates.compare import compare
from reels.templates.steps import Steps
from reels.templates.cutaway import Cutaway

config.frame_width, config.frame_height = S.FRAME_W, S.FRAME_H
config.background_color = S.BG

MECH_SCALE = 0.66


def v3(xy):
    return np.array([xy[0], xy[1], 0.0])


class Ep01(TimedScene):
    timeline = Path(__file__).parent / "timeline.json"

    def hook(self):
        joint = G.robot_joint()
        card = hook_card("HARMONIC\nDRIVE", joint, mascot("surprised", 3.2))
        self.play(FadeIn(card.term, shift=UP * 0.3), run_time=0.6)
        self.play(FadeIn(card.art), FadeIn(card.mascot, scale=0.5), run_time=0.6)
        for _ in range(2):
            self.play(Rotate(joint.lower, PI / 3, about_point=joint.joint.get_center(),
                             rate_func=there_and_back, run_time=1.2))
        self.play(Indicate(joint.joint, color=S.COUNCIL, scale_factor=1.25), run_time=0.8)

    def motor(self):
        arrow = VGroup(Arrow(LEFT * 0.6, RIGHT * 0.6, buff=0, color=S.BRAND_INK, stroke_width=S.STROKE),
                       S.txt("GEARS", S.SMALL_SIZE, S.LABEL)).arrange(DOWN, buff=0.1)
        c = compare([("MOTOR", G.bar_pair(0.95, 0.2)), ("JOINT", G.bar_pair(0.2, 0.95))], [arrow], "SPEED vs FORCE")
        self.play(FadeIn(c.kicker), FadeIn(c.cards[0]), run_time=0.6)
        self.until(self.when(1))  # "그래서 기어로…" 문장에서 화살표와 관절 카드
        self.play(GrowArrow(arrow[0]), FadeIn(arrow[1]), run_time=0.5)
        self.play(FadeIn(c.cards[1], shift=RIGHT * 0.3), run_time=0.7)

    def stack(self):
        st = Steps(["1 STAGE", "2 STAGES", "3 STAGES"], "100 : 1")
        stages = G.gear_stages()
        self.play(FadeIn(st), run_time=0.4)
        for i, (stage, t) in enumerate(zip(stages, (0.4, 1.7, 3.0))):
            self.until(self.when(0, t))
            p, b = stage[0], stage[1]
            for g, w in ((p, 1.5), (b, -1.5 * 0.3 / 0.72)):
                c = g[1].get_center()
                g.add_updater(lambda m, dt, w=w, c=c: m.rotate(w * dt, about_point=c))
            self.play(st.activate(i), FadeIn(stage), run_time=0.6)
        self.until(self.when(0, 3.8))
        heavy = S.txt("BIG +\nHEAVY", 30, S.DANGER).move_to(v3((-2.9, -0.1)))
        self.play(FadeIn(heavy), run_time=0.4)

    def parts(self):
        mech = G.Mechanism(center=v3(cutaway_t.ART_CENTER), scale=MECH_SCALE)
        cut = Cutaway([("WAVE GENERATOR", S.COUNCIL), ("FLEXSPLINE  30 TEETH", S.BRAND_INK),
                       ("CIRCULAR SPLINE  32 TEETH", S.LABEL)], "3 PARTS")
        big = S.txt("3 PARTS", 120, S.BRAND_INK)
        big.set_width(6).move_to(v3(cutaway_t.ART_CENTER))
        self.add(mech.group())
        self.play(FadeIn(big, scale=0.8), run_time=0.6)
        self.until(self.when(1, -0.2))
        self.play(FadeOut(big), FadeIn(cut.kicker), run_time=0.2)
        m = at(mascot("pointing", 1.7, aim=v3(cutaway_t.ART_CENTER) - v3((3.5, -2.7))), (3.5, -2.7))
        # 캠·컵·링을 나열하는 문장 안에서 글자 수 비율(7·14·11자)로 차례로 켠다
        for i, (name, f) in enumerate((("cam", 0), ("flex", 0.22), ("ring", 0.66))):
            self.until(self.when(1, frac=f))
            anims = [mech.show[name].animate.set_value(1), cut.reveal(i)]
            if i == 0:
                anims.append(FadeIn(m))
            self.play(*anims, run_time=0.8)
        self.play(FadeOut(m), run_time=0.4)
        self.until(self.when(2))
        eq = S.txt(f"{G.RING_TEETH} - {G.FLEX_TEETH} = {G.TOOTH_DIFF}", S.KICKER_SIZE, S.BRAND_INK)
        eq.move_to(cut.kicker, aligned_edge=LEFT)
        self.play(Transform(cut.kicker, eq), Indicate(cut.rows[1].text, color=S.BRAND_INK), Indicate(cut.rows[2].text, color=S.BRAND_INK), run_time=1.0)

    def turn(self):
        mech = G.Mechanism(center=v3(steps_t.STAGE_CENTER), scale=MECH_SCALE + 0.02, shown=1)
        st = Steps(["CAM  ↺ 1 TURN", "CUP  ↻ 2 TEETH"], "ONE TURN")
        self.add(mech.group())
        self.play(FadeIn(st), FadeIn(mech.ref_mark()), run_time=0.5)
        self.play(st.activate(0), run_time=0.2)
        # 캠은 "한 바퀴 돌면"에서 출발해 장면이 끝나기 1초 전에 한 바퀴를 마치고, 컵 칩은 두 칸 문장에서 켜진다
        t0 = self.renderer.time - self.sc["start"]
        self.play(AnimationGroup(
            mech.cam.animate(rate_func=linear, run_time=self.sc["end"] - self.sc["start"] - 1.0 - t0).set_value(TAU),
            Succession(Wait(self.when(1) - t0), st.activate(1))))
        arc = mech.travel_arc()
        label = S.txt(f"{G.TOOTH_DIFF} TEETH", S.SMALL_SIZE, S.TEXT).move_to(mech.travel_label_pos())
        self.play(Create(arc), FadeIn(label), run_time=0.8)

    def ratio(self):
        link = lambda s: S.txt(s, 64, S.LABEL)
        c = compare([("TEETH", S.txt(str(G.REAL_FLEX_TEETH), 110, S.TEXT)),
                     ("SHIFT", S.txt(str(G.TOOTH_DIFF), 110, S.TEXT)),
                     ("RATIO", S.txt(str(G.REAL_RATIO), 110, S.BRAND_INK))],
                    [link("÷"), link("=")], "ONE STAGE", y=1.7, h=3.2)
        c.cards[2][0].set_stroke(S.BRAND_INK, opacity=1)
        self.play(FadeIn(c.kicker), FadeIn(c.cards[0]), run_time=0.5)
        self.until(self.when(0, frac=0.36))
        self.play(FadeIn(c.links[0]), FadeIn(c.cards[1]), run_time=0.5)
        self.until(self.when(0, frac=0.73))
        self.play(FadeIn(c.links[1]), FadeIn(c.cards[2]), run_time=0.5)
        self.until(self.when(1))
        m = at(mascot("sparkle", 2.4), (0, -1.6))
        self.play(FadeIn(m, scale=0.6), run_time=0.4)
        self.play(sparkle(m))
        self.wait(1.0)
        self.play(sparkle(m))
