"""2편 장면 순서와 시간 배치. 그림은 templates/와 art.py가 그린다. 한국어는 subtitles.ko.ass에만 있다."""
import sys
from pathlib import Path
import numpy as np
from manim import *

sys.path.insert(0, str(Path(__file__).parent))
import art as A
from reels import style as S
from reels.mascot import mascot, at, sparkle
from reels.templates import steps as steps_t, cutaway as cutaway_t
from reels.templates.hook_card import hook_card
from reels.templates.compare import compare
from reels.templates.steps import Steps
from reels.templates.cutaway import Cutaway

config.frame_width, config.frame_height = S.FRAME_W, S.FRAME_H
config.background_color = S.BG

# 장면 끝 시각(초) — 자막과 맞춘다
T_HOOK, T_WAIT, T_STEPS, T_CHECK, T_PRED, T_SPEC, T_END = 4, 11, 15, 23, 27, 40, 45


def v3(xy):
    return np.array([xy[0], xy[1], 0.0])


class Ep02(Scene):
    def until(self, t):
        """장면 끝 시각까지 남은 시간을 wait로 채운다."""
        d = t - self.renderer.time
        if d < -0.05:
            print(f"WARN: {t}s 장면이 {-d:.2f}s 넘침")
        if d > 0.07:  # 15fps 한 프레임보다 짧은 wait는 manim이 경고한다
            self.wait(d)

    def construct(self):
        for seg, end in ((self.hook, T_HOOK), (self.wait_guess, T_WAIT), (self.steps, T_STEPS),
                         (self.check, T_CHECK), (self.predictor, T_PRED), (self.spectre, T_SPEC),
                         (self.finale, T_END)):
            seg()
            self.until(end)
            self.clear()

    def hook(self):
        f = A.Fork(2.0, mark=True).at(0)
        card = hook_card("SPECULATIVE\nEXECUTION", f, mascot("surprised", 3.2))
        self.play(FadeIn(card.term, shift=UP * 0.3), run_time=0.5)
        self.play(FadeIn(card.art), FadeIn(card.mascot, scale=0.5), run_time=0.5)
        self.wait(0.3)
        self.play(f.blk.animate.move_to(f.pos(1)), run_time=1.0)  # "?"가 풀리기 전에 블록이 먼저 달린다
        self.play(Indicate(f.mark, color=S.BRAND_INK, scale_factor=1.3), run_time=0.8)

    def wait_guess(self):
        w, g = A.wait_art(), A.guess_art()
        c = compare([("WAIT", w), ("GUESS", g)], [A.divider()], "BRANCH ?")
        self.play(FadeIn(c.kicker), FadeIn(c.cards[0]), run_time=0.6)
        self.until(6.0)
        self.play(Indicate(w.cycles, color=S.BRAND_INK, scale_factor=1.15), run_time=0.8)
        self.until(8.6)
        self.play(FadeIn(c.links[0]), FadeIn(c.cards[1], shift=RIGHT * 0.3), run_time=0.6)
        self.until(9.4)
        self.play(g.blk.animate.move_to(g.pos(1)), run_time=1.0)

    def steps(self):
        st = Steps(["SAVE", "GUESS +\nRUN", "CHECK"], "SPECULATIVE EXECUTION")
        f = A.Fork(3.0, mark=True).move_to(v3(steps_t.STAGE_CENTER)).at(-0.7)
        snap = A.snapshot().move_to(v3((-2.6, 1.3)))
        tie = DashedLine(snap.get_right(), f.pos(0), color=S.LABEL, stroke_width=S.HAIRLINE)
        val = Dot(v3((3.6, 0.2)), radius=0.14, color=S.TEXT)
        self.play(FadeIn(st), FadeIn(f), run_time=0.4)
        self.until(11.5)
        self.play(st.activate(0), f.blk.animate.move_to(f.pos(0)), run_time=0.5)
        self.play(FadeIn(snap, shift=RIGHT * 0.3), Create(tie), run_time=0.6)
        self.until(12.6)
        self.play(st.activate(1), f.blk.animate.move_to(f.pos(1)), run_time=1.0)
        self.until(13.7)
        self.play(st.activate(2), FadeIn(val), run_time=0.3)
        self.play(val.animate.move_to(f.pos(0)), FadeOut(f.mark), run_time=0.6)
        self.play(f.right.animate.set_color(S.BRAND_INK), FadeOut(val), run_time=0.3)

    def check(self):
        r, w = A.right_art(), A.wrong_art()
        r.keep.set_opacity(0)
        c = compare([("RIGHT", r), ("WRONG", w)], [A.divider()], "BRANCH")
        self.play(FadeIn(c.kicker), FadeIn(c.cards[0]), run_time=0.6)
        self.until(16.0)
        self.play(r.keep.animate.set_opacity(1), run_time=0.4)
        self.until(18.0)
        self.play(FadeIn(c.links[0]), FadeIn(c.cards[1], shift=RIGHT * 0.3), run_time=0.6)
        self.until(19.0)
        self.play(w.undo.animate.set_opacity(1), w.fork.blk.animate.move_to(w.fork.pos(0)).set_color(S.LABEL), run_time=1.0)
        self.until(20.5)
        target = w.approx.get_center()
        m = at(mascot("pointing", 1.7, aim=target - v3((3.3, -2.4))), (3.3, -2.4))
        self.play(w.approx.animate.set_opacity(1), FadeIn(m), run_time=0.5)
        self.play(Indicate(w.approx, color=S.TEXT, scale_factor=1.2), run_time=0.8)
        self.until(22.6)
        self.play(FadeOut(m), run_time=0.4)

    def predictor(self):
        cut = Cutaway([("BRANCH PREDICTOR", S.BRAND_INK)], "BRANCH")
        chip = A.chip_cells(3.8).move_to(v3(cutaway_t.ART_CENTER))
        rec = A.records()
        self.play(FadeIn(cut.kicker), FadeIn(chip), run_time=0.5)
        self.until(23.8)
        big = RoundedRectangle(corner_radius=S.CARD_RADIUS, width=7.6, height=2.4, color=S.BRAND_INK, stroke_width=S.HAIRLINE + 1,
                               fill_color=S.BRAND, fill_opacity=0.3).move_to(v3(cutaway_t.ART_CENTER))
        rec.move_to(big)
        self.play(FadeOut(chip.rest), Transform(chip.pred, big), run_time=0.9)
        self.play(cut.reveal(0), run_time=0.5)
        self.play(LaggedStart(*[FadeIn(d, scale=0.3) for d in rec.dots], lag_ratio=0.25), run_time=1.4)

    def spectre(self):
        st = Steps(["WRONG\nPATH", "CACHE\nTRACE", "FIX"], "SPECTRE 2018")
        cy = steps_t.STAGE_CENTER[1]
        chip = A.chip_body(3.4).move_to(v3((-1.9, cy)))
        f = A.Fork(2.2).move_to(chip).at(0)
        cache = A.cache_box(2.4).move_to(v3((2.6, cy - 0.2)))
        bus = Line(v3((chip.get_right()[0] + 0.2, cache[0].get_left()[1])), cache[0].get_left(), color=S.LABEL, stroke_width=S.HAIRLINE, stroke_opacity=0.6)
        dot = Dot(radius=0.16, color=S.DANGER)
        self.play(FadeIn(st), FadeIn(chip), FadeIn(f), run_time=0.4)
        self.until(27.4)
        self.play(st.activate(0), f.blk.animate.move_to(f.pos(1)), f.right.animate.set_color(S.DANGER), run_time=0.6)
        self.until(28.0)
        self.play(FadeIn(cache, shift=LEFT * 0.3), Create(bus), run_time=0.6)
        self.until(29.4)
        dot.move_to(f.blk)
        self.play(st.activate(1), FadeIn(dot), run_time=0.3)
        self.play(dot.animate.move_to(cache.slot), run_time=0.9)
        self.play(FadeOut(f.blk), run_time=0.5)  # 블록은 지워지는데 점은 남는다
        self.until(31.5)
        self.play(Indicate(dot, color=S.DANGER, scale_factor=1.8), run_time=0.8)
        self.until(34.0)
        self.play(Indicate(dot, color=S.DANGER, scale_factor=1.8), run_time=0.8)
        self.until(36.3)
        bar = A.barrier(f)
        blk = A.block(f.blk.width).move_to(f.pos(0))
        self.play(st.activate(2), Create(bar), run_time=0.6)
        self.play(FadeIn(blk), run_time=0.2)
        self.play(blk.animate.move_to(f.pos(0.55)), run_time=0.8)

    def finale(self):
        i, s = A.timeline("WIW."), A.timeline("WSWW")
        c = compare([("IDLE", i), ("SPECULATE", s)], [A.divider()], "SPECULATIVE EXECUTION", y=1.7, h=3.2)
        self.play(FadeIn(c.kicker), FadeIn(c.cards[0]), run_time=0.5)
        self.until(40.9)
        self.play(FadeIn(c.links[0]), FadeIn(c.cards[1]), run_time=0.5)
        self.until(42.3)
        m = at(mascot("sparkle", 2.4), (0, -1.9))
        self.play(FadeIn(m, scale=0.6), run_time=0.4)
        self.play(sparkle(m))
        self.wait(1.0)
        self.play(sparkle(m))
