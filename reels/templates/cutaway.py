"""단면도 확대: 그림(장면이 ART_CENTER에 그린다) 아래에 부품 범례 줄이 하나씩 켜진다."""
import numpy as np
from manim import VGroup, RoundedRectangle, FadeIn, LEFT
from reels import style as S
from reels.templates import kicker

ART_CENTER, ROW_Y0, ROW_DY = (0, 1.1), -2.0, 0.65


class Cutaway(VGroup):
    def __init__(self, parts, title):
        """parts: [(라벨, 색)]"""
        super().__init__()
        self.rows = []
        for i, (label, color) in enumerate(parts):
            sw = RoundedRectangle(corner_radius=0.06, width=0.34, height=0.34, color=color,
                                  fill_opacity=1, stroke_width=0)
            t = S.txt(label, S.LABEL_SIZE, S.TEXT)
            row = VGroup(sw, t.next_to(sw, np.array([1, 0, 0]), buff=0.25))
            row.move_to(np.array([-S.FRAME_W / 2 + S.MARGIN, ROW_Y0 - i * ROW_DY, 0]), aligned_edge=LEFT)
            row.text = t
            self.rows.append(row)
        self.kicker = kicker(title)
        self.add(self.kicker)  # 줄은 reveal 때 장면에 들어온다

    def reveal(self, i):
        return FadeIn(self.rows[i], shift=np.array([0.3, 0, 0]))
