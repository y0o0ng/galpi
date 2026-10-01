"""흐름 화살표: 경로 위를 같은 속도로 흐르는 대시 + 끝점 화살표 머리. 경로·방향·색·라벨은 인자로 받는다.
경로는 점 목록(화면 좌표)이고 첫 점에서 끝 점으로 흐른다. 대시는 장면이 진행되는 동안 늘 흐른다(updater)."""
import numpy as np
from manim import VGroup, VMobject, Triangle, Circle, Rectangle, ValueTracker, AnimationGroup, linear, PI
from reels import style as S
from reels.templates import kicker

DASH, GAP, SPEED = 0.30, 0.24, 1.0   # 대시 길이·간격(화면 단위), 모든 경로 공통 속도(단위/초)
BUBBLE_GAP, BUBBLE_R, HEAD = 0.62, 0.09, 0.2


def _unit(v):
    return v / np.linalg.norm(v)


class Flow(VGroup):
    def __init__(self, paths, title=None, legend=None):
        """paths: {이름: {"points": [(x,y)…], "color", "label"=None, "label_at"="start"|"end",
        "particles"=False | True | (시작 비율, 끝 비율)}}. legend: [(라벨, 색)] — 그룹 밖 self.legend, 장면이 켠다."""
        super().__init__()
        self.t, self.p = 0.0, {}
        for name, spec in paths.items():
            pts = [np.array([x, y, 0.0]) for x, y in spec["points"]]
            guide = VMobject().set_points_as_corners(pts).set_stroke(opacity=0)
            col = spec["color"]
            n = int(guide.get_arc_length() / (DASH + GAP)) + 2
            dashes = VGroup(*[VMobject().set_points_as_corners(pts[:2]).set_stroke(col, S.STROKE, 0) for _ in range(n)])
            d = _unit(pts[-1] - pts[-2])
            head = Triangle().scale(HEAD).rotate(np.arctan2(d[1], d[0]) - PI / 2).set_fill(col, 0).set_stroke(width=0)
            head.shift(pts[-1] - head.get_vertices()[0])
            parts = spec.get("particles")
            parts = (0, 1) if parts is True else parts
            bubbles = VGroup(*[Circle(radius=BUBBLE_R, color=S.TEXT, stroke_width=3).set_stroke(opacity=0)
                               for _ in range(14)]) if parts else VGroup()
            label = None
            if spec.get("label"):
                label = S.txt(spec["label"], S.LABEL_SIZE, col).set_opacity(0)
                label.has_been_placed = False
            self.p[name] = dict(guide=guide, dashes=dashes, head=head, bubbles=bubbles, parts=parts, label=label,
                                at=spec.get("label_at", "start"), rv=ValueTracker(0), al=ValueTracker(1))
            self.add(guide, dashes, head, bubbles, *([label] if label else []))
        self.kicker = kicker(title) if title else None
        if self.kicker:
            self.add(self.kicker)
        self.legend = None
        if legend:
            rows = [VGroup(Rectangle(width=0.5, height=0.14, color=c, fill_opacity=1, stroke_width=0),
                           S.txt(l, S.LABEL_SIZE, S.TEXT)).arrange(buff=0.2) for l, c in legend]
            self.legend = VGroup(*rows).arrange(buff=0.7)
        self.add_updater(self._tick)

    def show(self, names, run_time=1.0):
        """지정 경로를 첫 점에서 끝 점 방향으로 그려 나타낸다."""
        return AnimationGroup(*[self.p[n]["rv"].animate(rate_func=linear).set_value(1) for n in names], run_time=run_time)

    def highlight(self, names):
        """목록의 경로는 불투명도 1, 나머지는 0.3."""
        return AnimationGroup(*[q["al"].animate.set_value(1 if n in names else 0.3) for n, q in self.p.items()])

    def _tick(self, _, dt):
        self.t += dt
        for q in self.p.values():
            self._draw(q)

    def _draw(self, q):
        g, rv, al = q["guide"], q["rv"].get_value(), q["al"].get_value()
        L = g.get_arc_length()
        per, off = DASH + GAP, (self.t * SPEED) % (DASH + GAP)
        for k, dash in enumerate(q["dashes"]):
            a = max(k * per - per + off, 0.0)
            b = min(k * per - per + off + DASH, rv * L)
            if b - a > 0.02:
                dash.pointwise_become_partial(g, a / L, b / L).set_stroke(opacity=al)
            else:
                dash.set_stroke(opacity=0)
        q["head"].set_fill(opacity=al * np.clip((rv - 0.92) / 0.08, 0, 1))
        if q["parts"] and rv >= 1:
            self._bubbles(q, L, al)
        if q["label"]:
            if not q["label"].has_been_placed:
                self._place(q, g)
            q["label"].set_opacity(al * np.clip((rv - 0.3) / 0.4, 0, 1))

    def _bubbles(self, q, L, al):
        g, (pa, pb) = q["guide"], q["parts"]
        span = (pb - pa) * L
        n = max(1, round(span / BUBBLE_GAP))
        for k, c in enumerate(q["bubbles"]):
            if k >= n:
                c.set_stroke(opacity=0)
                continue
            s = (k * span / n + self.t * SPEED) % span
            f = pa + s / L
            d = _unit(g.point_from_proportion(min(f + 0.005, 1)) - g.point_from_proportion(max(f - 0.005, 0)))
            side = np.array([-d[1], d[0], 0.0]) * ((k % 3) - 1) * 0.3
            c.move_to(g.point_from_proportion(f) + side)
            c.set_stroke(opacity=al * min(1, s / 0.3, (span - s) / 0.3))

    def _place(self, q, g):
        lab = q["label"]
        lab.has_been_placed = True
        p = g.point_from_proportion(0.12 if q["at"] == "start" else 0.88)
        lab.move_to(p + np.array([0, 0.3, 0]))
        lim = S.FRAME_W / 2 - S.MARGIN
        lab.shift(np.array([max(0, -lim - lab.get_left()[0]) - max(0, lab.get_right()[0] - lim), 0, 0]))
