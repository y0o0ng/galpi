"""4편 전용 도형: 펼친 계단 드럼(톱니 9줄·기어·눈금), 결과 숫자창, 크랭크 아이콘, 훅 옆모습. 도식이며 실측 치수가 아니다.
좌표 계약(대본 5절): 드럼 높이 10칸(맨 아래 한 칸이 자리 0), 톱니 i(0..8)는 위끝에서 시작해 길이 (9-i)칸,
가로 위치 u_i = 0.5 + (i+0.5)/18(오른쪽 절반), 기어는 u=0.5 고정. 자리 n의 접점 높이는 위끝에서 (9-n+0.5)칸 아래."""
import numpy as np
from manim import (VGroup, Rectangle, RoundedRectangle, Circle, Line, AnimationGroup, ManimColor, TAU, UP, DOWN, RIGHT, ORIGIN)
from reels import style as S

N, ROWS = 9, 10
T = 4.5                     # 크랭크 한 바퀴(초). 딸깍 간격 = T/18
STEP = TAU / 10             # 기어 한 칸(톱니 10개)
UNLIT, FADE = 0.6, 0.03     # 기어에 안 닿는 줄의 불투명도, 드럼 양 끝 투명 구간(폭 비율)
LIT_COLOR = ManimColor(S.BRAND_INK)


def passes(i):
    """줄 i가 기어 밑을 지나는 위상 φ."""
    return (i + 0.5) / 18


class Gear(VGroup):
    """바깥 톱니 10개 + 한 줄 표시(돌았는지 보이게). 정지 상태에서 표시는 위쪽."""

    def __init__(self, r):
        ticks = [Line(0.78 * r * d, r * d, color=S.TEXT, stroke_width=6)
                 for d in (np.array([np.sin(a), np.cos(a), 0.0]) for a in np.arange(10) * STEP)]
        super().__init__(Circle(radius=0.78 * r, color=S.TEXT, stroke_width=4), *ticks,
                         Line(0.3 * r * UP, 0.7 * r * UP, color=S.TEXT, stroke_width=4))


class Drum(VGroup):
    def __init__(self, c=0.5, W=4.4, digits=False):
        super().__init__()
        self.frame = Rectangle(width=W, height=ROWS * c, color=S.LABEL, stroke_width=S.HAIRLINE, stroke_opacity=S.HAIRLINE_OPACITY)
        self.teeth = [Rectangle(width=0.6 * W / 18, height=(9 - i) * c, stroke_width=0).set_fill(S.LABEL, UNLIT) for i in range(N)]
        self.gear = Gear(0.75 * c)
        self.digits = VGroup(*[S.txt(str(n), S.LABEL_SIZE, S.LABEL).move_to(
            np.array([-W / 2 - 0.35, self.frame.get_top()[1] - (9 - n + 0.5) * c, 0])) for n in range(10)]) if digits else VGroup()
        self.add(self.frame, *self.teeth, self.gear, self.digits)
        self.counter, self.base, self.angle, self._cur = None, 0, 0.0, 0.0   # 숫자창, 숫자창 기준값, 확정된 기어 각도
        self.layout(0)
        self.gear.move_to(self.gear_point(0))

    def _geo(self):
        return self.frame.get_left()[0], self.frame.get_top()[1], self.frame.width, self.frame.height / ROWS

    def gear_point(self, n):
        left, top, W, c = self._geo()
        return np.array([left + W / 2, top - (9 - n + 0.5) * c, 0.0])

    def light(self, n, anim=False):
        """i < n인 줄(가장 긴 n줄)만 밝힌다."""
        ops = [(t, S.BRAND_INK, 1.0) if i < n else (t, S.LABEL, UNLIT) for i, t in enumerate(self.teeth)]
        if anim:
            return AnimationGroup(*[t.animate.set_fill(c, o) for t, c, o in ops])
        for t, c, o in ops:
            t.set_fill(c, o)

    def layout(self, phi):
        left, top, W, c = self._geo()
        for i, t in enumerate(self.teeth):
            u = (0.5 + passes(i) - phi) % 1
            t.move_to(np.array([left + u * W, top - (9 - i) * c / 2, 0]))
            t.set_fill(opacity=(1.0 if t.get_fill_color() == LIT_COLOR else UNLIT) * min(1, u / FADE, (1 - u) / FADE))

    def _hits(self):
        """기어 높이에 끝이 닿는 줄(기하로 판정: 자리 n이면 i < n)."""
        _, top, _, c = self._geo()
        gy = self.gear.get_center()[1]
        return [i for i in range(N) if top - (9 - i) * c <= gy]

    def wheel(self, phi):
        """위상 φ(0..1)의 한 프레임: 줄이 왼쪽으로 지나가고, 닿는 줄이 기어를 칠 때마다 기어가 한 칸·숫자창이 1 오른다."""
        self.layout(phi)
        hits = self._hits()
        k = sum(phi >= passes(i) for i in hits)
        kf = sum(min(1, max(0, (phi - passes(i)) / (0.1 / T))) for i in hits)
        if self.counter is not None:
            self.counter.show(self.base + k)
        target = self.angle + kf * STEP
        self.gear.rotate(-(target - self._cur), about_point=self.gear.get_center())
        self._cur = target

    def commit(self):
        """한 바퀴(φ=1)를 끝낸 상태를 새 기준(φ=0)으로 확정한다."""
        k = len(self._hits())
        self.base += k
        self.angle += k * STEP
        self.layout(0)


class Counter(VGroup):
    """결과 숫자창: 한 자리, 0~6. 숫자는 겹쳐 두고 show(v)가 하나만 켠다."""

    def __init__(self, v=0, w=1.5, h=1.7):
        super().__init__()
        box = RoundedRectangle(corner_radius=S.CONTROL_RADIUS, width=w, height=h, color=S.TEXT, stroke_width=S.HAIRLINE,
                               fill_color=S.BRAND, fill_opacity=1)
        self.digs = [S.txt(str(k), 96, S.TEXT).move_to(box) for k in range(7)]
        self.add(box, *self.digs)
        self.show(v)

    def show(self, v):
        for k, d in enumerate(self.digs):
            d.set_fill(opacity=1 if k == v else 0)


def drum_card(n, value=None):
    """카드용 작은 드럼: 기어가 n 자리, 그 n줄 밝음. value가 있으면 오른쪽에 숫자창(.ctr)."""
    d = Drum()
    d.light(n)
    d.gear.move_to(d.gear_point(n))
    if value is None:
        return VGroup(d)
    g = VGroup(d, Counter(value).next_to(d, RIGHT, buff=0.4))
    g.ctr = g[1]
    return g


def crank():
    """정지한 크랭크 아이콘(회전 방향 표시 없음)."""
    end = 0.9 * np.array([np.cos(np.pi / 4), np.sin(np.pi / 4), 0])
    return VGroup(Line(ORIGIN, end, color=S.TEXT, stroke_width=8), Circle(radius=0.22, color=S.TEXT, stroke_width=5, fill_color=S.BG, fill_opacity=1),
                  Circle(radius=0.16, color=S.BRAND_INK, fill_opacity=1, stroke_width=0).move_to(end))


def turns(text, size=34):
    """크랭크 아이콘 + 글자(`12 TURNS`, `×2`)."""
    return VGroup(crank(), S.txt(text, size, S.TEXT)).arrange(DOWN, buff=0.3)


def hook_art():
    """옆모습 실루엣: 톱니가 덮은 반쪽이 보이는 쪽. 가로 축 방향 줄 9개가 위끝(맨 위가 가장 긴 9칸)에서 아래로 짧아지는 계단, 왼쪽 끝은 모두 같은 선, 옆에 작은 기어."""
    cell, th, gap = 0.6, 0.3, 0.08
    x0 = 0.0
    bars = VGroup(*[Rectangle(width=(9 - i) * cell, height=th, stroke_width=0).set_fill(S.BRAND_INK, 1).move_to(
        np.array([x0 + (9 - i) * cell / 2, -i * (th + gap), 0])) for i in range(N)])
    cap = Rectangle(width=0.22, height=9 * (th + gap) + 0.12, stroke_width=0).set_fill(S.LABEL, 1)
    cap.move_to(np.array([x0 - 0.11 - 0.04, bars.get_center()[1], 0]))
    gear = Gear(0.38).move_to(np.array([x0 + 3 * cell + 0.45, bars[8].get_center()[1], 0]))
    g = VGroup(cap, bars, gear)
    g.bars, g.gear = bars, gear
    return g


def divider():
    return Line(DOWN * 0.4, UP * 0.4, color=S.LABEL, stroke_width=S.HAIRLINE, stroke_opacity=S.HAIRLINE_OPACITY)
