"""3편 전용 도형: 원자로 용기 단면(비율 좌표), 흐름 경로 명세, 사각 고리, 물방울. 도식 비율이며 실측 치수가 아니다."""
import numpy as np
from manim import VGroup, RoundedRectangle, Rectangle, Line, Dot, Polygon, Circle, DashedVMobject, Arrow, DoubleArrow, UP, DOWN, LEFT, RIGHT
from reels import style as S

LIGHT, HEAVY = S.BRAND_INK, S.COUNCIL
RATIO = 2.6   # 용기 높이 : 폭


class Vessel:
    """원점 (ox, oy)는 용기 바닥 가운데. P(x, y)는 폭 W·높이 H 비율 좌표를 화면 좌표로 바꾼다."""

    def __init__(self, H, ox=0.0, oy=0.0):
        self.H, self.W, self.ox, self.oy = H, H / RATIO, ox, oy

    def P(self, x, y):
        return (self.ox + x * self.W, self.oy + y * self.H)

    def p3(self, x, y):
        return np.array([*self.P(x, y), 0.0])

    def body(self):
        """벽·노심·안쪽 원통(shroud+chimney)·노즐. 라벨은 labels()."""
        line = dict(color=S.LABEL, stroke_width=S.HAIRLINE + 0.5)
        wall = RoundedRectangle(corner_radius=0.12 * self.W, width=self.W, height=self.H, **line).move_to(self.p3(0, 0.5))
        core = Rectangle(width=0.6 * self.W, height=0.2 * self.H, color=S.BRAND, fill_opacity=1, stroke_width=0).move_to(self.p3(0, 0.22))
        shroud = [Line(self.p3(s * 0.3, 0.12), self.p3(s * 0.3, 0.72), **line) for s in (-1, 1)]
        nozzles = [Rectangle(width=0.2, height=0.28, **line).move_to(self.p3(s * 0.5, y) + np.array([s * 0.1, 0, 0]))
                   for s, y in ((1, 0.92), (-1, 0.76))]
        return VGroup(core, wall, *shroud, *nozzles)

    def labels(self):
        """CORE(노심 안), CHIMNEY(오른쪽 바깥), DOWNCOMER(왼쪽 바깥) — 장면이 따로 켠다."""
        core = S.txt("CORE", S.LABEL_SIZE, S.TEXT).move_to(self.p3(0, 0.22)).set_stroke(S.BRAND, 8, background=True)
        out = {"core": VGroup(core)}
        for key, s, y, x_end, name in (("chimney", 1, 0.52, 0.3, "CHIMNEY"), ("downcomer", -1, 0.45, -0.45, "DOWNCOMER")):
            t = S.txt(name, S.LABEL_SIZE, S.LABEL)
            t.move_to(self.p3(s * 0.5, y) + np.array([s * (0.25 + t.width / 2), 0, 0]))
            end = self.p3(x_end, y)
            out[key] = VGroup(t, Line(t.get_edge_center(-s * RIGHT), end, color=S.LABEL, stroke_width=S.HAIRLINE, stroke_opacity=0.6),
                              Dot(end, radius=0.05, color=S.LABEL))
        return out

    def height_bar(self, x=3.7):
        """굴뚝 높이(y = 0.32H~0.72H) 막대."""
        return DoubleArrow(np.array([x, self.P(0, 0.32)[1], 0]), np.array([x, self.P(0, 0.72)[1], 0]),
                           buff=0, color=S.TEXT, stroke_width=4, tip_length=0.2)

    def ring(self, bubbles=True):
        """안쪽 상승(rise)과 좌우 하강(down_left/right) 고리."""
        P = self.P
        down = [(0.1, 0.80), (0.40, 0.80), (0.40, 0.06), (0.05, 0.06), (0, 0.08)]
        return {
            "rise": dict(points=[P(0, 0.08), P(0, 0.86)], color=LIGHT, particles=(0.14 / 0.78, 1.0) if bubbles else False),
            "down_right": dict(points=[P(x, y) for x, y in down], color=HEAVY),
            "down_left": dict(points=[P(-x, y) for x, y in down], color=HEAVY),
        }

    def paths(self):
        """고리 + 증기 배출(steam_out)·급수 유입(fw_in). 흐름 속도는 모두 같다."""
        P, edge = self.P, S.FRAME_W / 2
        ring = self.ring()
        ring["steam_out"] = dict(points=[P(0, 0.86), P(0.2, 0.92), P(0.5, 0.92), (edge, P(0, 0.92)[1])], color=LIGHT,
                                 label="STEAM →", label_at="end")
        ring["fw_in"] = dict(points=[(-edge, P(0, 0.76)[1]), P(-0.5, 0.76), P(-0.4, 0.76), P(-0.4, 0.72)], color=HEAVY,
                             label="FEEDWATER", label_at="start")
        return ring


def loop_card(pump):
    """비교 카드용 사각 고리. pump: 'PUMP'(채운 상자) | 'NO PUMP'(점선 빈 상자). 상자는 오른쪽 하강 줄 위에 놓는다."""
    v = Vessel(3.0, 0, -1.5)
    v.W = 2.5   # 고리만 그리므로 폭을 용기 비율에서 떼어낸다
    dashed = pump == "NO PUMP"
    box = RoundedRectangle(corner_radius=S.CONTROL_RADIUS, width=1.55, height=0.55, color=S.LABEL if dashed else S.TEXT,
                           stroke_width=S.HAIRLINE + 1, fill_color=S.BG, fill_opacity=0 if dashed else 1).move_to(v.p3(0.4, 0.43))
    if dashed:
        box = DashedVMobject(box, num_dashes=24)
    text = S.txt(pump, S.SMALL_SIZE, S.LABEL if dashed else S.TEXT).move_to(v.p3(0.4, 0.43)).set_stroke(S.BG, 10, background=True)
    return v.ring(bubbles=False), VGroup(box, text)


def drop(color, bubbles):
    """물방울. bubbles면 안에 빈 원(기포)."""
    r = 0.55
    d = VGroup(Polygon(np.array([0, 2 * r, 0]), np.array([0.866 * r, 0.5 * r, 0]), np.array([-0.866 * r, 0.5 * r, 0]),
                       color=color, fill_opacity=1, stroke_width=0),
               Circle(radius=r, color=color, fill_opacity=1, stroke_width=0))
    if bubbles:
        for (x, y), br in (((-0.18, -0.12), 0.13), ((0.2, 0.05), 0.1), ((-0.02, 0.3), 0.08)):
            d.add(Circle(radius=br, color=S.BG, stroke_width=3).move_to(np.array([x, y, 0])))
    return d


def drop_art(color, up):
    """물방울 옆에 위/아래 화살표."""
    a = Arrow(DOWN * 0.8, UP * 0.8, buff=0, color=color, stroke_width=7) if up else Arrow(UP * 0.8, DOWN * 0.8, buff=0, color=color, stroke_width=7)
    return VGroup(drop(color, up), a).arrange(RIGHT, buff=0.5)


def divider():
    return Line(DOWN * 0.4, UP * 0.4, color=S.LABEL, stroke_width=S.HAIRLINE, stroke_opacity=S.HAIRLINE_OPACITY)
