"""1편 전용 도형(캠·플렉스 컵·링, 기어, 관절, 막대)과 기구학 숫자. 비율·방향은 여기 상수에서만 나온다."""
import numpy as np
from manim import (VGroup, VMobject, Polygon, Ellipse, Circle, Annulus, Arc, RoundedRectangle, Rectangle,
                   Line, ValueTracker, always_redraw, PI, TAU, UP, DOWN, LEFT, RIGHT, ORIGIN)
from reels import style as S

# ---- 기구학: 서큘러 스플라인 고정, 웨이브 제너레이터(캠) 입력, 플렉스플라인 출력 ----
FLEX_TEETH = 30            # 그림의 톱니 수(실제 200은 한 바퀴 3.6°라 안 보인다)
RING_TEETH = 32
TOOTH_DIFF = RING_TEETH - FLEX_TEETH          # 안쪽이 2개 적다
REAL_FLEX_TEETH = 200
REAL_RATIO = REAL_FLEX_TEETH // TOOTH_DIFF    # 200 ÷ 2 = 100


def flex_angle(cam):
    """캠이 cam만큼 돌 때 플렉스플라인 회전: 반대 방향, 톱니 TOOTH_DIFF개 피치 / 캠 한 바퀴."""
    return -cam * TOOTH_DIFF / FLEX_TEETH


FLEX_PITCH = TAU / FLEX_TEETH
RING_PITCH = TAU / RING_TEETH
MARKER_K = 7                                  # 표시점 톱니 번호
MARKER_START = MARKER_K * FLEX_PITCH          # 캠 0°일 때 표시점 각도
MARKER_END = MARKER_START + flex_angle(TAU)   # 캠 한 바퀴 뒤(= 2칸 반대로)

# ---- 스케일 1 기준 치수 ----
RING_OUT, RING_ROOT, TOOTH_LEN = 3.6, 3.1, 0.17
FLEX_R, FLEX_A = 2.52, 0.3
CAM_A, CAM_B = 2.70, 2.12
BASE_HALF, TIP_HALF = 0.30, 0.17              # 톱니 반폭(피치 비율)


def _poly(pts, color, fill, a, width=3):
    return Polygon(*pts, color=color, fill_color=color, fill_opacity=fill * a,
                   stroke_opacity=a, stroke_width=width)


class Mechanism:
    """캠 각도 하나(cam)로 세 부품이 모두 정해진다. show_*는 0~1 등장 정도."""

    def __init__(self, center=ORIGIN, scale=1.0, shown=0.0):
        self.c, self.k = np.array(center, dtype=float), scale
        self.cam = ValueTracker(0)
        self.show = {n: ValueTracker(shown) for n in ("cam", "flex", "ring")}
        self.parts = {"cam": always_redraw(self._cam), "flex": always_redraw(self._flex),
                      "ring": always_redraw(self._ring)}

    def group(self):
        return VGroup(self.parts["ring"], self.parts["flex"], self.parts["cam"])

    def _p(self, r, a):
        return self.c + self.k * r * np.array([np.cos(a), np.sin(a), 0])

    def _tooth(self, ang, pitch, r_base, sign):
        pts = []
        for da, rr in ((-BASE_HALF, 0), (-TIP_HALF, TOOTH_LEN), (TIP_HALF, TOOTH_LEN), (BASE_HALF, 0)):
            a = ang + da * pitch
            pts.append(self._p(r_base(a) + sign * rr, a))
        return pts

    def _cam(self):
        a, th = self.show["cam"].get_value(), self.cam.get_value()
        e = Ellipse(width=2 * CAM_A * self.k, height=2 * CAM_B * self.k, color=S.COUNCIL,
                    fill_opacity=0.9 * a, stroke_opacity=a, stroke_width=S.STROKE).move_to(self.c)
        hub = Circle(radius=0.3 * self.k, color=S.BG, fill_opacity=a, stroke_width=0).move_to(self.c)
        dot = Circle(radius=0.2 * self.k, color=S.TEXT, fill_opacity=a, stroke_width=0).move_to(self._p(CAM_A - 0.45, 0))
        g = VGroup(e, dot)
        g.rotate(th, about_point=self.c)  # 타원+장축 표시점이 같이 돈다
        return VGroup(g, hub)

    def _r(self, th):
        return lambda phi: FLEX_R + FLEX_A * np.cos(2 * (phi - th))

    def _flex(self):
        a, th = self.show["flex"].get_value(), self.cam.get_value()
        r, psi0 = self._r(th), flex_angle(th)
        curve = VMobject(color=S.BRAND_INK, stroke_width=S.STROKE, stroke_opacity=a)
        phis = np.linspace(0, TAU, 121)
        curve.set_points_as_corners([self._p(r(p), p) for p in phis])
        g = VGroup(curve)
        for i in range(FLEX_TEETH):
            marker = i == MARKER_K
            g.add(_poly(self._tooth(psi0 + i * FLEX_PITCH, FLEX_PITCH, r, +1),
                        S.TEXT if marker else S.BRAND_INK, 1 if marker else 0.55, a))
            if marker:  # 표시점: 톱니 바깥에 흰 점을 붙여 캠에 가려지지 않고 보이게
                ang = psi0 + i * FLEX_PITCH
                g.add(Circle(radius=0.13 * self.k, color=S.TEXT, fill_opacity=a, stroke_width=0)
                      .move_to(self._p(r(ang) + TOOTH_LEN + 0.14, ang)))
        return g

    def _ring(self):
        a = self.show["ring"].get_value()
        body = Annulus(inner_radius=RING_ROOT * self.k, outer_radius=RING_OUT * self.k, color=S.LABEL,
                       fill_opacity=0.3 * a, stroke_width=0).move_to(self.c)
        out = Circle(radius=RING_OUT * self.k, color=S.LABEL, stroke_width=S.HAIRLINE, stroke_opacity=a).move_to(self.c)
        g = VGroup(body, out)
        for j in range(RING_TEETH):  # 틈이 j*피치, 이빨은 그 사이 — 캠 0°일 때 플렉스 톱니 0번이 틈 중앙에 든다
            g.add(_poly(self._tooth((j + 0.5) * RING_PITCH, RING_PITCH, lambda _: RING_ROOT, -1),
                        S.LABEL, 0.55, a))
        return g

    def ref_mark(self):
        """서큘러 스플라인 쪽 고정 기준 표시(표시점의 출발 각도)."""
        a = MARKER_START
        pts = [self._p(RING_OUT + 0.02, a), self._p(RING_OUT + 0.3, a - 0.05), self._p(RING_OUT + 0.3, a + 0.05)]
        return Polygon(*pts, color=S.TEXT, fill_opacity=1, stroke_width=0)

    def travel_arc(self):
        """표시점이 출발점에서 실제로 간 각도(MARKER_END 기준)만큼의 호."""
        return Arc(radius=(RING_OUT + 0.55) * self.k, start_angle=MARKER_START, angle=MARKER_END - MARKER_START,
                   arc_center=self.c, color=S.TEXT, stroke_width=S.STROKE)

    def travel_label_pos(self):
        return self._p(RING_OUT + 1.15, (MARKER_START + MARKER_END) / 2)


# ---- 기어열(단계) ----
def gear(r, center, color=S.BRAND_INK):
    n = max(6, round(TAU * r / 0.3))
    pts = []
    for i in range(n):
        a = TAU * i / n
        for da, rr in ((-0.28, 0), (-0.16, 0.14), (0.16, 0.14), (0.28, 0)):
            ang = a + da * TAU / n
            pts.append(center + (r + rr) * np.array([np.cos(ang), np.sin(ang), 0]))
    g = Polygon(*pts, color=color, fill_color=S.BRAND, fill_opacity=0.7, stroke_width=4)
    return VGroup(g, Circle(radius=r * 0.25, color=color, fill_opacity=1, stroke_width=0).move_to(center))


def gear_stages(top_y=2.9, r_pinion=0.3, r_big=0.72, dy=1.5):
    """감속 한 단 = 작은 기어 + 큰 기어. 큰 기어 바로 아래 축에 다음 단의 작은 기어가 달린다."""
    d = r_pinion + r_big + 0.02
    out, x = [], -1.7
    for i in range(3):
        y = top_y - i * dy
        p, b = gear(r_pinion, np.array([x, y, 0])), gear(r_big, np.array([x + d, y, 0]))
        parts = [p, b]
        if i:
            parts.append(Line(np.array([x, y + dy - 0.0, 0]), np.array([x, y, 0]), color=S.LABEL, stroke_width=4))
        out.append(VGroup(*parts))
        x += d
    return out


# ---- 장면 소품 ----
def robot_joint():
    box = lambda: RoundedRectangle(corner_radius=0.3, width=0.9, height=2.2, color=S.BRAND_INK,
                                   fill_color=S.BRAND, fill_opacity=1, stroke_width=S.STROKE)
    upper, lower = box().move_to(UP * 1.1), box().move_to(DOWN * 1.1)
    joint = Circle(radius=0.62, color=S.COUNCIL, fill_color=S.BG, fill_opacity=1, stroke_width=S.STROKE + 2)
    core = Circle(radius=0.26, color=S.TEXT, fill_opacity=1, stroke_width=0)
    art = VGroup(lower, upper, joint, core)
    art.lower, art.joint = lower, joint
    return art


def bar_pair(speed, torque, width=3.1):
    """SPEED / TORQUE 막대 두 줄 (0~1)."""
    rows = VGroup()
    for name, v, col in (("SPEED", speed, S.BRAND_INK), ("TORQUE", torque, S.COUNCIL)):
        lab = S.txt(name, S.SMALL_SIZE, S.LABEL).align_to(ORIGIN, LEFT)
        track = Rectangle(width=width, height=0.3, color=S.LABEL, stroke_width=S.HAIRLINE, stroke_opacity=S.HAIRLINE_OPACITY)
        fill = Rectangle(width=max(width * v, 0.05), height=0.3, color=col, fill_opacity=1, stroke_width=0)
        fill.align_to(track, LEFT)
        rows.add(VGroup(lab, VGroup(track, fill).next_to(lab, DOWN, buff=0.12, aligned_edge=LEFT)))
    return rows.arrange(DOWN, buff=0.5, aligned_edge=LEFT)
