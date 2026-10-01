"""2편 전용 도형: 갈림길·명령 블록, 상태 스냅샷, CPU 칩·예측기, CACHE 상자, 타임라인 막대."""
import numpy as np
from manim import VGroup, RoundedRectangle, Rectangle, Line, Dot, UP, DOWN, LEFT, RIGHT
from reels import style as S

v3 = lambda x, y: np.array([x, y, 0.0])


def block(side, color=S.BRAND_INK):
    return RoundedRectangle(corner_radius=side * 0.25, width=side, height=side, color=color,
                            fill_opacity=1, stroke_width=0)


class Fork(VGroup):
    """Y자 갈림길 하나와 명령 블록 하나. 위치는 매번 선에서 읽어서 템플릿이 크기를 바꿔도 맞는다."""

    def __init__(self, h=2.0, mark=False):
        stem = Line(v3(0, -h / 2), v3(0, 0), color=S.LABEL, stroke_width=6)
        left = Line(v3(0, 0), v3(-0.45 * h, h / 2), color=S.LABEL, stroke_width=6)
        right = Line(v3(0, 0), v3(0.45 * h, h / 2), color=S.LABEL, stroke_width=6)
        self.stem, self.left, self.right = stem, left, right
        self.blk = block(0.17 * h).move_to(stem.get_end())
        super().__init__(stem, left, right, self.blk)
        if mark:
            self.mark = S.txt("?", 36, S.COUNCIL).move_to(v3(0, 0.3 * h))
            self.add(self.mark)

    def pos(self, t, side="right"):
        """t=0 갈림점, 1 가지 끝, -1 줄기 아래 끝."""
        j = self.stem.get_end()
        end = self.stem.get_start() if t < 0 else (self.right if side == "right" else self.left).get_end()
        return j + abs(t) * (end - j)

    def at(self, t, side="right"):
        self.blk.move_to(self.pos(t, side))
        return self


def barrier(f, t=0.75):
    """오른쪽 가지를 가로지르는 차단 막대."""
    d = f.right.get_end() - f.stem.get_end()
    d = d / np.linalg.norm(d)
    p, perp = f.pos(t), v3(-d[1], d[0]) * 0.17 * f.stem.get_length() * 2
    return Line(p - perp, p + perp, color=S.BRAND_INK, stroke_width=14)


def wait_art():
    """멈춘 블록 + 100s OF CYCLES."""
    f = Fork(1.7).at(0)
    f.blk.set_color(S.LABEL)
    for dx in (0.3, 0.46):
        f.add(Rectangle(width=0.06, height=0.26, color=S.LABEL, fill_opacity=1, stroke_width=0)
              .move_to(f.blk.get_center() + v3(dx, 0)))
    g = VGroup(f, S.txt("100s OF CYCLES", S.LABEL_SIZE, S.LABEL)).arrange(DOWN, buff=0.3)
    g.fork, g.cycles = f, g[1]
    return g


def guess_art():
    return Fork(1.7).at(0)


def right_art():
    f = Fork(1.7).at(1)
    g = VGroup(f, S.txt("KEEP", S.LABEL_SIZE, S.BRAND_INK)).arrange(DOWN, buff=0.3)
    g.fork, g.keep = f, g[1]
    return g


def wrong_art():
    """오른쪽 가지 끝의 틀린 블록, 아래에 UNDO와 ≈ WAIT(처음엔 숨김)."""
    f = Fork(1.7).at(1)
    f.blk.set_color(S.DANGER)
    g = VGroup(f, S.txt("UNDO", S.LABEL_SIZE, S.LABEL), S.txt("≈ WAIT", S.LABEL_SIZE, S.BRAND_INK)).arrange(DOWN, buff=0.22)
    g.fork, g.undo, g.approx = f, g[1], g[2]
    g.undo.set_opacity(0), g.approx.set_opacity(0)
    return g


def snapshot(w=1.0, h=0.9):
    """저장한 상태: 레지스터 막대 세 줄이 든 상자."""
    box = RoundedRectangle(corner_radius=S.CONTROL_RADIUS, width=w, height=h, color=S.LABEL, stroke_width=S.HAIRLINE,
                           fill_color=S.BRAND, fill_opacity=S.CARD_FILL_OPACITY)
    bars = VGroup(*[Rectangle(width=w * 0.6, height=0.08, color=S.BRAND_INK, fill_opacity=1, stroke_width=0)
                    for _ in range(3)]).arrange(DOWN, buff=0.14).move_to(box)
    return VGroup(box, bars)


def divider():
    return Line(DOWN * 0.4, UP * 0.4, color=S.LABEL, stroke_width=S.HAIRLINE, stroke_opacity=S.HAIRLINE_OPACITY)


def chip_body(size):
    """CPU 칩: 둥근 사각형 + 사방 핀."""
    body = RoundedRectangle(corner_radius=S.CARD_RADIUS, width=size, height=size, color=S.LABEL, stroke_width=S.HAIRLINE + 0.5,
                            fill_color=S.BRAND, fill_opacity=S.CARD_FILL_OPACITY)
    pins = VGroup()
    for k in range(-2, 3):
        o = k * size / 6
        for a, b in ((v3(o, size / 2), v3(0, 0.2)), (v3(o, -size / 2), v3(0, -0.2)),
                     (v3(size / 2, o), v3(0.2, 0)), (v3(-size / 2, o), v3(-0.2, 0))):
            pins.add(Line(a, a + b, color=S.LABEL, stroke_width=S.HAIRLINE + 1))
    return VGroup(body, pins)


def chip_cells(size=3.8):
    """칩 안 3x3 칸. 오른쪽 위 한 칸이 분기 예측기(pred)."""
    step = size * 0.27
    cells = VGroup(*[RoundedRectangle(corner_radius=S.CONTROL_RADIUS * 0.6, width=step * 0.85, height=step * 0.85,
                                      color=S.LABEL, stroke_width=S.HAIRLINE).move_to(v3((i - 1) * step, (1 - j) * step))
                     for j in range(3) for i in range(3)])
    pred = cells[2]
    pred.set_stroke(S.BRAND_INK, 4).set_fill(S.BRAND, 0.6)
    g = VGroup(chip_body(size), cells)
    g.pred, g.rest = pred, VGroup(g[0], *[c for c in cells if c is not pred])
    return g


def records(n=10):
    """지난 갈림길 기록: 채운 점 = 오른쪽, 빈 점 = 왼쪽. 점 하나씩 켜지게 리스트로도 준다."""
    pattern = [1, 1, 0, 1, 1, 1, 0, 1, 1, 1][:n]
    dots = [Dot(radius=0.14, color=S.BRAND_INK, fill_opacity=1 if p else 0, stroke_width=4) for p in pattern]
    g = VGroup(*dots).arrange(RIGHT, buff=0.34)
    g.dots = dots
    return g


def cache_box(size=2.4):
    """CACHE 상자: 3x3 칸 + 윗글자. slot은 점이 남을 한 칸."""
    step = size / 3
    cells = VGroup(*[Rectangle(width=step, height=step, color=S.LABEL, stroke_width=S.HAIRLINE, stroke_opacity=0.7)
                     .move_to(v3((i - 1) * step, (1 - j) * step)) for j in range(3) for i in range(3)])
    frame = RoundedRectangle(corner_radius=S.CONTROL_RADIUS, width=size, height=size, color=S.LABEL, stroke_width=S.HAIRLINE + 0.5,
                             fill_color=S.BRAND, fill_opacity=S.CARD_FILL_OPACITY)
    label = S.txt("CACHE", S.LABEL_SIZE, S.LABEL).next_to(frame, UP, buff=0.25)
    g = VGroup(frame, cells, label)
    g.slot = cells[5]
    return g


def timeline(spec):
    """세로 시간 막대 4칸. W 일, I 쉼(빈 칸), S 추측, . 비어 있음. 길이는 수치가 아닌 도식."""
    sh = 0.42
    rows = VGroup()
    for ch in spec:
        r = Rectangle(width=1.0, height=sh, stroke_width=S.HAIRLINE, color=S.LABEL if ch in "I." else S.BRAND_INK,
                      fill_color=S.BRAND_INK if ch in "WS" else S.BG, fill_opacity={"W": 0.55, "S": 1.0}.get(ch, 0))
        if ch == ".":
            r.set_stroke(opacity=0)
        rows.add(r)
    rows.arrange(DOWN, buff=0.06)
    rail = Line(rows.get_top() + LEFT * 0.7, rows.get_bottom() + LEFT * 0.7, color=S.LABEL, stroke_width=S.HAIRLINE).add_tip(tip_length=0.15)
    return VGroup(rail, rows)
