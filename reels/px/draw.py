"""도트 그리기 규칙을 코드로: 중점 원·타원, 깔끔한 기울기 선, 정수배 확대, 블록 톱니 기어, 회전 프레임 캐시."""
import math

import numpy as np
from PIL import Image

TAU = 2 * math.pi
MIN_PITCH = 4                    # 톱니 둘레 간격 하한(도트): 최소 형체 2px + 간격 1px에 여유


def p(cx, cy, r, a):
    """극좌표 → 화면 좌표(각도는 반시계, 화면 y는 아래로)."""
    return (cx + r * math.cos(a), cy - r * math.sin(a))


def scale(img, k):
    """정수배 최근접 확대만 허용."""
    if k != int(k) or k < 1:
        raise ValueError(f"정수배만 허용: {k}")
    return img.resize((img.width * int(k), img.height * int(k)), Image.NEAREST)


def _spans(rx, ry):
    """중점 알고리즘: 행 y(-ry..ry)마다 오른쪽 끝 x. 4방향 대칭."""
    xm = {}

    def put(x, y):
        for yy in (y, -y):
            xm[yy] = max(xm.get(yy, 0), x)

    x, y, rx2, ry2 = 0, ry, rx * rx, ry * ry
    p1 = ry2 - rx2 * ry + rx2 / 4
    while ry2 * x < rx2 * y:
        put(x, y)
        x += 1
        if p1 < 0:
            p1 += 2 * ry2 * x + ry2
        else:
            y -= 1
            p1 += 2 * ry2 * x - 2 * rx2 * y + ry2
    p2 = ry2 * (x + .5) ** 2 + rx2 * (y - 1) ** 2 - rx2 * ry2
    while y >= 0:
        put(x, y)
        y -= 1
        if p2 > 0:
            p2 += rx2 - 2 * rx2 * y
        else:
            x += 1
            p2 += 2 * ry2 * x - 2 * rx2 * y + rx2
    return xm


def ellipse(d, cx, cy, rx, ry, fill=None, outline=None, width=1):
    """축에 맞춘 타원(중심 정수 도트). outline은 안쪽으로 width만큼 두껍다."""
    cx, cy = int(cx), int(cy)
    outer = _spans(rx, ry)
    inner = _spans(rx - width, ry - width) if outline and min(rx, ry) > width else {}
    for y, xo in outer.items():
        if fill is not None:
            d.line((cx - xo, cy + y, cx + xo, cy + y), fill=fill)
        if outline:
            xi = inner.get(y)
            if xi is None:
                d.line((cx - xo, cy + y, cx + xo, cy + y), fill=outline)
            else:
                d.line((cx - xo, cy + y, cx - xi - 1, cy + y), fill=outline)
                d.line((cx + xi + 1, cy + y, cx + xo, cy + y), fill=outline)


def circle(d, cx, cy, r, fill=None, outline=None, width=1, arc=None):
    """원. arc=(a0, a1)(라디안, 반시계)이면 그 각도 구간의 테두리 도트만 찍는다."""
    if arc is None:
        return ellipse(d, cx, cy, r, r, fill, outline, width)
    cx, cy = int(cx), int(cy)
    outer, inner = _spans(r, r), _spans(r - width, r - width)
    lo, hi = arc
    for y, xo in outer.items():
        xi = inner.get(y, -1)
        for x in [*range(-xo, -xi), *range(xi + 1, xo + 1)] if xi >= 0 else range(-xo, xo + 1):
            a = math.atan2(-y, x) % TAU
            if (a - lo) % TAU <= (hi - lo) % TAU:
                d.point((cx + x, cy + y), fill=outline)


def line(d, p0, p1, fill, width=1):
    """직선: 0°·45°·90°·1:2·2:1 중 가장 가까운 기울기로 끝점을 맞추고, 1px 선의 L자 겹침 점을 지운다."""
    (x0, y0), (x1, y1) = (round(p0[0]), round(p0[1])), (round(p1[0]), round(p1[1]))
    dx, dy = x1 - x0, y1 - y0
    sx, sy = (1 if dx >= 0 else -1), (1 if dy >= 0 else -1)
    adx, ady = abs(dx), abs(dy)
    a = math.atan2(ady, adx)
    targets = (0, math.atan(.5), math.pi / 4, math.atan(2), math.pi / 2)
    k = min(range(5), key=lambda i: abs(a - targets[i]))
    m = max(adx, ady)
    adx, ady = ((m, 0), (m, m // 2), (m, m), (m // 2, m), (0, m))[k]
    x1, y1 = x0 + sx * adx, y0 + sy * ady
    n = max(adx, ady)
    pts = [(x0 + round((x1 - x0) * i / n), y0 + round((y1 - y0) * i / n)) for i in range(n + 1)] if n else [(x0, y0)]
    if width == 1:
        pts = [q for i, q in enumerate(pts) if not (0 < i < len(pts) - 1 and abs(pts[i - 1][0] - pts[i + 1][0]) == 1
                                                    and abs(pts[i - 1][1] - pts[i + 1][1]) == 1)]
    for qx, qy in pts:
        for w in range(width):
            d.point((qx + (w if ady > adx else 0), qy + (w if ady <= adx else 0)), fill=fill)


def gear(d, cx, cy, r, teeth, angle=0.0, tooth=4.0, radius=None, inward=False,
         fill=None, outline=None, width=1, mark=None):
    """블록(사다리꼴) 톱니 윤곽. radius(phi)로 타원 같은 둘레, inward면 톱니가 안쪽, mark=(톱니 번호, 색)은 그 톱니 하나를 칠한다.
    둘레(2πr) ÷ MIN_PITCH보다 톱니가 많으면 ValueError."""
    if teeth > 2 * math.pi * r / MIN_PITCH:
        raise ValueError(f"톱니 {teeth}개는 r={r}에 너무 많다(상한 {int(2 * math.pi * r / MIN_PITCH)})")
    rr = radius or (lambda phi: r)
    s = -1 if inward else 1
    teeth_pts = []
    for i in range(teeth):
        a = angle + TAU * i / teeth
        teeth_pts.append([p(cx, cy, rr(a + da * TAU / teeth) + s * tooth * h, a + da * TAU / teeth)
                          for da, h in ((-.28, 0), (-.16, 1), (.16, 1), (.28, 0))])
    d.polygon([q for t in teeth_pts for q in t], fill=fill, outline=outline, width=width)
    if mark:
        d.polygon(teeth_pts[mark[0]], fill=mark[1], outline=mark[1], width=width)


_CACHE = {}


def baked(key, size, paint, palette, angle=0.0, k=5):
    """size×size 투명 레이어에 paint(d, c, k)로 k배 크게 그리고(c는 큰 레이어의 중심 도트), angle(도)만큼 돌린 뒤
    k×k 블록 다수결로 팔레트 색만 남겨 줄인다. key가 같으면 다시 만들지 않는다. size는 홀수."""
    from PIL import ImageDraw
    ck = (key, round(angle, 3))
    if ck in _CACHE:
        return _CACHE[ck]
    big = Image.new("RGBA", (size * k, size * k), (0, 0, 0, 0))
    paint(ImageDraw.Draw(big), (size * k) // 2, k)
    if angle:
        big = big.rotate(angle, resample=Image.NEAREST)
    a = np.asarray(big)
    cols = np.array([[int(c[i:i + 2], 16) for i in (1, 3, 5)] for c in palette])
    idx = np.full(a.shape[:2], -1)
    for i, c in enumerate(cols):
        idx[(a[..., :3] == c).all(-1) & (a[..., 3] > 0)] = i
    if ((a[..., 3] > 0) & (idx < 0)).any():
        raise ValueError("팔레트 밖 색")
    blk = lambda m: m.reshape(size, k, size, k).sum((1, 3))
    counts = np.stack([blk(idx == i) for i in range(len(cols))])
    opaque = counts.sum(0) * 2 >= k * k
    out = np.zeros((size, size, 4), np.uint8)
    out[opaque, :3] = cols[counts.argmax(0)][opaque]
    out[opaque, 3] = 255
    _CACHE[ck] = Image.fromarray(out, "RGBA")
    return _CACHE[ck]
