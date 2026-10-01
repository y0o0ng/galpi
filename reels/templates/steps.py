"""단계: 위쪽 무대(stage) + 아래 번호 칩 줄. 칩을 하나씩 켜며 순서를 보여준다."""
import numpy as np
from manim import VGroup, RoundedRectangle, Circle, AnimationGroup
from reels import style as S
from reels.templates import kicker

STAGE_CENTER, CHIP_Y, CHIP_H = (0, 1.3), -2.4, 0.9


class Steps(VGroup):
    def __init__(self, labels, title):
        super().__init__()
        n, gap = len(labels), 0.2
        w = (S.FRAME_W - 2 * S.MARGIN - gap * (n - 1)) / n
        self.chips = []
        for i, label in enumerate(labels):
            box = RoundedRectangle(corner_radius=S.CONTROL_RADIUS, width=w, height=CHIP_H, color=S.LABEL,
                                   stroke_width=S.HAIRLINE, fill_color=S.BRAND, fill_opacity=0.0)
            x = -S.FRAME_W / 2 + S.MARGIN + w / 2 + i * (w + gap)
            box.move_to(np.array([x, CHIP_Y, 0]))
            badge = S.txt(str(i + 1), S.LABEL_SIZE, S.BG)
            disc = Circle(radius=0.27, color=S.LABEL, fill_opacity=1, stroke_width=0).move_to(box.get_left() + np.array([0.4, 0, 0]))
            badge.move_to(disc)
            text = S.txt(label, S.LABEL_SIZE, S.LABEL)
            text.set_width(min(text.width, w - 1.1))
            text.move_to(box.get_center() + np.array([0.4, 0, 0]))
            chip = VGroup(box, disc, badge, text)
            chip.box, chip.disc, chip.text = box, disc, text
            self.chips.append(chip), self.add(chip)
        self.kicker = kicker(title)
        self.add(self.kicker)

    def activate(self, i):
        """i번 칩만 켠다(나머지는 흐리게)."""
        return AnimationGroup(*[
            AnimationGroup(c.box.animate.set_stroke(color=S.BRAND_INK if j == i else S.LABEL).set_fill(opacity=0.3 if j == i else 0),
                           c.disc.animate.set_fill(color=S.BRAND_INK if j == i else S.LABEL),
                           c.text.animate.set_color(S.TEXT if j == i else S.LABEL))
            for j, c in enumerate(self.chips)])
