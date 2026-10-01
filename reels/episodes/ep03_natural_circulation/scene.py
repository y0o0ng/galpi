"""3편 장면 연출. 장면 길이·문장 시각은 timeline.json(tts.py)에서 오고, 그림은 templates/와 art.py가 그린다. 한국어는 narration.ko.json에만 있다."""
import sys
from pathlib import Path
import numpy as np
from manim import *

sys.path.insert(0, str(Path(__file__).parent))
import art as A
from reels import style as S, sound
from reels.timeline import TimedScene
from reels.mascot import mascot, at, sparkle
from reels.templates import kicker
from reels.templates.hook_card import hook_card
from reels.templates.compare import compare
from reels.templates.flow_arrow import Flow

config.frame_width, config.frame_height = S.FRAME_W, S.FRAME_H
config.background_color = S.BG

TITLE = "NATURAL CIRCULATION"


class Ep03(TimedScene):
    timeline = Path(__file__).parent / "timeline.json"

    def hook(self):
        v = A.Vessel(3.6, 0, -2.7)
        f = Flow(v.ring())
        card = hook_card("NATURAL\nCIRCULATION", VGroup(v.body(), f), mascot("surprised", 3.2))
        k = kicker("BWRX-300").move_to(np.array([-2.9, -0.9, 0]))
        self.add(f)
        self.play(FadeIn(k), FadeIn(card.term, shift=UP * 0.3), run_time=0.5)
        self.play(FadeIn(card.art[0]), FadeIn(card.mascot, scale=0.5), run_time=0.5)
        self.play(f.show(["rise", "down_left", "down_right"], run_time=1.5))

    def pump(self):
        (pf, pb), (nf, nb) = A.loop_card("PUMP"), A.loop_card("NO PUMP")
        forced, natural = Flow(pf), Flow(nf)
        c = compare([("FORCED", VGroup(forced, pb)), ("NATURAL", VGroup(natural, nb))], [A.divider()], TITLE)
        self.add(forced, natural)
        self.play(FadeIn(c.kicker), FadeIn(c.cards[0][0]), FadeIn(c.cards[0][1]), FadeIn(pb), run_time=0.5)
        self.play(forced.show(list(pf)), run_time=1.0)
        self.until(self.when(1, 0.2))
        self.play(FadeIn(c.links[0]), FadeIn(c.cards[1][0]), FadeIn(c.cards[1][1]), FadeIn(nb), run_time=0.5)
        self.play(natural.show(list(nf)), run_time=1.0)

    def flow(self):
        v = A.Vessel(6.0, 0, -2.4)
        f, lab = Flow(v.paths(), TITLE, legend=[("LIGHT", A.LIGHT), ("HEAVY", A.HEAVY)]), v.labels()
        f.legend.move_to(np.array([-S.FRAME_W / 2 + S.MARGIN, -3.05, 0]), aligned_edge=LEFT)
        self.add(f)
        self.play(FadeIn(v.body()), FadeIn(lab["core"]), FadeIn(lab["chimney"]), run_time=0.5)
        self.until(self.when(0, 0.7))
        sound.cue("bubbles")  # 끓어서 기포가 생기는 순간 (대본이 정한 뜻 있는 소리)
        self.play(f.show(["rise"], run_time=1.6))
        self.until(self.when(2, 0.1))
        self.play(f.show(["steam_out"], run_time=1.0))
        self.until(self.when(3, 0.2))
        self.play(f.show(["down_left", "down_right"], run_time=1.4), FadeIn(lab["downcomer"]))
        self.play(f.show(["fw_in"], run_time=1.0))
        self.until(self.when(4))
        self.play(FadeIn(f.legend), run_time=0.5)
        self.until(self.when(5, 0.1))
        self.play(f.highlight(["rise", "down_left", "down_right"]), run_time=0.5)
        self.until(self.when(6, 0.2))
        bar = v.height_bar()
        aim = lab["chimney"][0].get_center() - v3((3.4, -1.6))
        m = at(mascot("pointing", 1.7, aim=aim), (3.4, -1.6))
        self.play(FadeIn(bar), FadeIn(m), run_time=0.5)
        self.play(Indicate(lab["chimney"][0], color=S.TEXT, scale_factor=1.15), run_time=0.8)

    def finale(self):
        l, h = A.drop_art(A.LIGHT, True), A.drop_art(A.HEAVY, False)
        c = compare([("LIGHT ↑", l), ("HEAVY ↓", h)], [A.divider()], TITLE, y=1.7, h=3.2)
        self.play(FadeIn(c.kicker), FadeIn(c.cards[0]), run_time=0.5)
        self.until(self.when(0, frac=0.6))
        self.play(FadeIn(c.links[0]), FadeIn(c.cards[1]), run_time=0.5)
        self.until(self.when(1, 0.1))
        m = at(mascot("sparkle", 2.4), (0, -1.9))
        self.play(FadeIn(m, scale=0.6), run_time=0.4)
        self.play(sparkle(m))


def v3(xy):
    return np.array([xy[0], xy[1], 0.0])
