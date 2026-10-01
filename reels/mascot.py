"""시온: xion-mark.svg 별 몸 + Manim 도형 표정 4종. 좌표는 별 중심 기준 svg 단위."""
from pathlib import Path
import numpy as np
from manim import (SVGMobject, VGroup, Circle, Arc, Star, Dot, ScaleInPlace, Succession,
                   UP, ORIGIN, PI)
from reels import style as S

SVG = Path(__file__).resolve().parent.parent / "public/lib/icons/Xion/xion-mark.svg"
BBOX_H, STAR_BELOW_CENTER = 92, 16  # 꼬리 -62 ~ 아래 30, bbox 중심은 별 중심보다 16 위


def mascot(expression="base", height=2.0, aim=None):
    """aim: 가리킬 방향 벡터. 위쪽 긴 꼬리를 그쪽으로 돌린다(몸만 돌리고 눈은 선 채 그쪽을 본다)."""
    s = height / BBOX_H
    P = lambda x, y: np.array([x * s, -y * s, 0.0])
    body = SVGMobject(str(SVG)).set_fill(S.BRAND_INK, 1).set_stroke(width=0)
    body.set_height(height).move_to(ORIGIN).shift(UP * STAR_BELOW_CENTER * s)
    look = np.zeros(3)
    if aim is not None:
        aim = np.array(aim, dtype=float)
        body.rotate(np.arctan2(aim[1], aim[0]) - PI / 2, about_point=ORIGIN)
        look = aim / np.linalg.norm(aim)

    dark = lambda m: m.set_fill(S.BG, 1).set_stroke(width=0)
    face = VGroup()
    if expression == "sparkle":
        for sx in (-7.5, 7.5):  # ^ ^ 눈
            face.add(Arc(radius=4.5 * s, start_angle=PI / 6, angle=2 * PI / 3,
                         arc_center=P(sx, 0), color=S.BG, stroke_width=6))
        face.add(Arc(radius=5 * s, start_angle=7 * PI / 6, angle=2 * PI / 3,
                     arc_center=P(0, 3), color=S.BG, stroke_width=5))
        for k, (x, y) in enumerate([(-30, -22), (28, -30), (34, 10)]):
            face.add(Star(4, outer_radius=(9 - 2 * k) * s, inner_radius=2.2 * s, color=S.TEXT,
                          fill_opacity=1, stroke_width=0).move_to(P(x, y)))
    else:
        r, hl = {"surprised": (6.6, 2.6)}.get(expression, (5.4, 1.9))
        for sx in (-7.5, 7.5):
            face.add(dark(Circle(radius=r * s)).move_to(P(sx, -3)))
            off = look * 1.6 * s if expression == "pointing" else np.array([0.9, 0.9, 0]) * s
            face.add(Dot(P(sx, -3) + off, radius=hl * s, color=S.TEXT))
        if expression == "surprised":
            face.add(dark(Circle(radius=2.4 * s)).move_to(P(0, 7)))
        else:
            face.add(Arc(radius=4 * s, start_angle=7 * PI / 6, angle=2 * PI / 3,
                         arc_center=P(0, 3.5), color=S.BG, stroke_width=5))
    m = VGroup(body, face)
    m.anchor = Dot(ORIGIN, radius=0, fill_opacity=0)  # 별 중심 추적용
    m.add(m.anchor)
    return m


def at(m, point):
    """별 중심을 point에 둔다."""
    p = np.array([point[0], point[1], 0.0])
    return m.shift(p - m.anchor.get_center())


def sparkle(m):
    """결론 장면: 살짝 커졌다 작아짐."""
    return Succession(ScaleInPlace(m, 1.25, run_time=0.25), ScaleInPlace(m, 1 / 1.25, run_time=0.25))
