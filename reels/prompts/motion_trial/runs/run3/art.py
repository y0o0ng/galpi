"""13편 도트판 그림: 물 무대, 옆에서 본 손가락, 손끝 세로 단면(핵심 장면), 베개, FLOW 화살표.
좌표는 캔버스 정수 도트. 진행 중인 과정은 12fps로 끊은 시각 ta의 함수다. 같은 물건은 같은 함수로 그린다."""
import math
from functools import lru_cache

import numpy as np
from PIL import Image, ImageDraw

from px import engine as E
from px.templates import head

W, H = E.W, E.H
YY, XX = np.mgrid[0:H, 0:W]
BAYER = E.BAYER[YY % 4, XX % 4]


def paint(img, m, col):
    img.paste(col, (0, 0), Image.fromarray(m.astype(np.uint8) * 255, "L"))


def poly(pts):
    m = Image.new("L", (W, H), 0)
    ImageDraw.Draw(m).polygon([(round(x), round(y)) for x, y in pts], fill=255)
    return np.asarray(m) > 0


def grow(m):
    """상하좌우로 1도트 넓힌 마스크."""
    g = m.copy()
    g[1:] |= m[:-1]
    g[:-1] |= m[1:]
    g[:, 1:] |= m[:, :-1]
    g[:, :-1] |= m[:, 1:]
    return g


def erode(m):
    return ~grow(~m)


def label(img, x, y, s, col=E.LABEL):
    E.text(img, (x, y), s, "label", col)


# ---------------- 물 무대 ----------------
def water(img, d, ta, x0, x1, surface, bottom, n=12, seed=0):
    """물: DEEP 면 + 바닥 쪽 DITHER 결(정지) + 천천히 떠오르는 DITHER 입자(살아 있는 배경, 낮은 대비)."""
    d.rectangle((x0, max(surface, 0), x1, bottom), fill=E.DEEP)
    deep = (XX >= x0) & (XX <= x1) & (YY > bottom - 24) & (YY <= bottom)
    paint(img, deep & (BAYER < (YY - (bottom - 24)) / 24 * 7), E.DITHER)
    span_y = bottom - max(surface, 0) - 10
    for k in range(n):
        h = (k + 1) * 2654435761 + seed * 40503 & 0xFFFFFF
        px = x0 + 3 + h % max(1, x1 - x0 - 6)
        speed = 3 + (h >> 9) % 4
        py = bottom - 5 - int((h >> 4) % span_y + speed * ta) % span_y
        d.rectangle((px, py, px + 1, py), fill=E.DITHER)


def surface(d, ta, x0, x1, y):
    """수면선(LABEL) + 그 위로 천천히 흘러가는 낮은 물결(DEEP)."""
    d.line((x0, y, x1, y), fill=E.LABEL)
    off = int(ta * 6) % 24
    for c in range(x0 - 24 + off, x1, 24):
        a, b = max(c, x0), min(c + 3, x1)
        if a <= b:
            d.line((a, y - 1, b, y - 1), fill=E.DEEP)


def ripple(d, ta, xl, xr, y, t0, period=1.2):
    """손가락이 수면을 지나는 자리에서 양옆으로 퍼지는 물결 두 줄기(LABEL 2도트)."""
    if ta < t0:
        return
    for k in range(2):
        off = int(((ta - t0) + k * period / 2) % period * 10)
        if off < 9:
            d.line((xl - 4 - off, y - 1, xl - 3 - off, y - 1), fill=E.LABEL)
            d.line((xr + 3 + off, y - 1, xr + 4 + off, y - 1), fill=E.LABEL)


def drops(d, ta, x, tip, surf, t0, period=0.8):
    """손끝에서 물방울이 맺혀 떨어지고, 수면에 닿으면 물결이 퍼진다."""
    if ta < t0:
        return
    age = (ta - t0) % period
    fall = 0.3
    if age < fall:
        y = tip + 2 + round(180 * age * age)
        if y < surf - 2:
            d.rectangle((x, y, x + 1, y + 2), fill=E.LABEL)
    else:
        off = round((age - fall) * 20)
        if off < 9:
            d.line((x - 3 - off, surf - 1, x - 2 - off, surf - 1), fill=E.LABEL)
            d.line((x + 3 + off, surf - 1, x + 4 + off, surf - 1), fill=E.LABEL)
        if age > period - 0.25:
            d.rectangle((x, tip + 1, x + 1, tip + 1), fill=E.LABEL)


def tub(d):
    """욕조 벽·바닥: 구조물이라 CARD로 물러나고 윗변만 LABEL 1도트."""
    for box in ((0, 116, 3, 249), (176, 116, 179, 249), (0, 246, 179, 249)):
        d.rectangle(box, fill=E.CARD)
    d.line((0, 116, 3, 116), fill=E.LABEL)
    d.line((176, 116, 179, 116), fill=E.LABEL)


# ---------------- 손가락(바깥) ----------------
def _fist(cx, ft, w):
    """주먹(나머지 손가락을 쥔 손): 손가락 위에 붙어 '가리키는 손'으로 읽히게 한다. 반환: 마스크, 쥔 손가락 사이 줄 y들, 왼쪽 x, 바닥 y."""
    hl, fh, rr = w / 2, round(0.95 * w), round(0.3 * w)
    xa, xb, fb = round(cx - hl - 0.75 * w), round(cx + hl) - 1, ft + fh
    F = (XX >= xa) & (XX <= xb) & (YY >= ft) & (YY <= fb)
    for ccx, ccy, sx, sy in ((xa + rr, ft + rr, -1, -1), (xb - rr, ft + rr, 1, -1), (xa + rr, fb - rr, -1, 1)):
        F &= ~(((XX - ccx) * sx > 0) & ((YY - ccy) * sy > 0) & ((XX - ccx) ** 2 + (YY - ccy) ** 2 > rr * rr))
    return F, [ft + fh * k // 4 for k in (1, 2, 3)], xa, fb


def finger(img, cx, tip, w, wr=0.0, top=-1, cream=0.0, fist=False):
    """손가락(끝이 아래): 왼쪽이 지문 쪽 배, 오른쪽으로 비스듬히 손톱이 보인다. 비례는 전부 폭 w에 묶인다.
    wr: 끝마디 배 쪽 주름 0~1(골 4개, 윤곽이 패이고 안쪽으로 골 줄), cream: 끝마디 크림이 끝에서 위로 덮인 정도 0~1(LABEL 막),
    fist: top에 주먹을 그리고 손가락은 그 아래서 시작한다(가리키는 손). 반환: 행마다 (왼쪽 x, 오른쪽 x)."""
    d = ImageDraw.Draw(img)
    hl, ax = w / 2, cx + 0.1 * w
    yl, yr = tip - 0.75 * w, tip - 0.6 * w
    gys = [round(tip - 0.9 * w + k * 0.1875 * w) for k in range(4)]
    nd = round(wr * 0.08 * w)
    notch = {}
    for gy in gys:
        for dy in range(-2, 3):
            notch[gy + dy] = max(notch.get(gy + dy, 0), nd - abs(dy))
    rows, M = {}, np.zeros((H, W), bool)
    F = None
    if fist:
        F, gaps, xa, fb = _fist(cx, top, w)
        top = fb
    for y in range(max(top, 0), min(tip, H - 1) + 1):
        xl = cx - hl if y <= yl else ax - (ax - cx + hl) * math.sqrt(max(0.0, 1 - ((y - yl) / (tip - yl)) ** 2))
        xr = cx + hl if y <= yr else ax + (cx + hl - ax) * math.sqrt(max(0.0, 1 - ((y - yr) / (tip - yr)) ** 2))
        a, b = round(xl) + notch.get(y, 0), round(xr) - 1
        if b >= a:
            rows[y] = (a, b)
            M[y, max(a, 0):min(b, W - 1) + 1] = True
    body = M | F if fist else M
    if cream > 0:
        c_top = round(tip - cream * 1.15 * w)
        paint(img, grow(grow(grow(M))) & ~grow(M) & (YY >= c_top), E.LABEL)
    paint(img, grow(body) & ~body, E.OUTLINE)
    paint(img, body, E.TEXT)
    if fist:                                              # 쥔 손가락 사이 줄(배 쪽) + 등 쪽 그늘 + 쥔 손가락 밑면 그늘
        for gy in gaps:
            d.line((xa + 1, gy, xa + round(0.45 * w), gy), fill=E.OUTLINE)
            d.line((xa + 1, gy + 1, xa + round(0.45 * w) - 2, gy + 1), fill=E.LABEL)
        paint(img, F & ~grow(~F) & (YY > fb - 2) & (XX < cx - hl), E.LABEL)
        paint(img, F & (XX > round(cx + hl) - 4), E.LABEL)
    ny0, ny1 = round(tip - 0.95 * w), round(tip - 0.2 * w)
    nx = round(cx + 0.08 * w)
    for y, (a, b) in rows.items():                       # 등 쪽 그늘 띠
        d.line((max(a, b - (0 if ny0 <= y <= ny1 else 2)), y, b, y), fill=E.LABEL)
    if cream > 0 and c_top in rows:                       # 크림 막의 윗선
        a, b = rows[c_top]
        d.line((a, c_top, b, c_top), fill=E.LABEL)
    for yj in (round(tip - 1.3 * w), round(tip - 2.9 * w)):   # 관절 주름: 배 쪽 두 줄, 등 쪽 두 줄
        for y, col, side in ((yj, E.LABEL, 0), (yj + 3, E.LABEL, 0), (yj - 1, E.OUTLINE, 1), (yj + 2, E.OUTLINE, 1)):
            if y in rows:
                a, b = rows[y]
                if side == 0:
                    d.line((a + 1, y, a + round(0.2 * w), y), fill=col)
                else:
                    d.line((b - round(0.2 * w), y, b - 4, y), fill=col)
    nail = [(y, *rows[y]) for y in range(ny0, ny1 + 1) if y in rows and rows[y][1] - 2 > nx]
    for k, (y, a, b) in enumerate(nail):                 # 손톱(비스듬히 보이는 판): 둥근 뿌리, OUTLINE 테두리, 반사 줄, 흰 자유연
        inset = (3, 1, 1)[k] if k < 3 else 0
        x0, x1 = nx + inset, b - 1 - inset
        if x1 < x0:
            continue
        free = k >= len(nail) - 3
        d.line((x0, y, x1, y), fill=E.OUTLINE if k == 0 else (E.TEXT if free else E.LABEL))
        d.point((x0, y), fill=E.OUTLINE)
        d.point((x1, y), fill=E.OUTLINE)
        if 3 <= k <= 9 and x1 - x0 > 5:
            d.point((x0 + 2, y), fill=E.TEXT)
        if k == len(nail) - 4:
            d.line((x0, y, x1, y), fill=E.OUTLINE)
        if k == len(nail) - 1 and y + 1 in rows:
            d.line((x0, y + 1, min(x1, rows[y + 1][1] - 1), y + 1), fill=E.OUTLINE)
    L = round(wr * 0.36 * w)
    if L >= 2:                                            # 주름 골: OUTLINE 줄 + 아래 LABEL 그늘
        for gy in gys:
            if gy in rows:
                a, _ = rows[gy]
                d.line((a, gy, a + L, gy), fill=E.OUTLINE)
                d.line((a, gy + 1, a + max(L - 2, 0), gy + 1), fill=E.LABEL)
    return rows


def nerve_xray(d, ta, path, t0=None, period=0.9):
    """손가락 속 신경(DEEP 점선)과 그 위를 뿌리 → 끝으로 흐르는 신호(INK). path: 1도트 걸음 점 목록(뿌리부터)."""
    for i, (x, y) in enumerate(path):
        if i // 2 % 2 == 0:
            d.point((x, y), fill=E.DEEP)
    if t0 is None or ta < t0:
        return
    k = 0
    while t0 + k * period <= ta:
        i = round(100 * (ta - t0 - k * period))
        if i < len(path):
            x, y = path[i]
            d.rectangle((x - 1, y - 1, x + 1, y + 1), fill=E.INK)
            for j in (4, 7):
                if i - j >= 0:
                    px, py = path[i - j]
                    d.rectangle((px, py - 1, px, py), fill=E.INK)
        k += 1


def vline_path(x, y0, y1, end=None):
    """세로 줄(+끝에서 45° 꺾임) → 1도트 걸음 점 목록."""
    pts = [(x, y) for y in range(y0, y1 + 1)]
    if end:
        n = abs(end[0] - x)
        pts += [(x + (1 if end[0] > x else -1) * i, y1 + i) for i in range(1, n + 1)]
    return pts


def vessel_xray(d, x, y0, y1, r):
    """손가락 속 혈관: PURPLE 벽 두 줄과 피가 찬 속(LABEL). r이 줄면 관이 가늘어진다(벽이 안쪽으로)."""
    d.rectangle((x - r, y0, x + r, y1), fill=E.LABEL)
    d.line((x - r - 1, y0, x - r - 1, y1), fill=E.PURPLE)
    d.line((x + r + 1, y0, x + r + 1, y1), fill=E.PURPLE)


# ---------------- 손끝 세로 단면(핵심 장면) ----------------
SK = 5                                   # 피부 띠 두께(바깥 2도트 TEXT + 안 3도트 LABEL)
DEPTH = 11                               # 속살이 줄어드는 최대 깊이(골 바닥)
V_SIG = 100                              # 신호 속도(도트/초)
NERVE_X, NERVE_END = 55, 112             # 신경 2도트 줄 왼쪽 x, 끝 y
BRANCHES = (30, 70, 110)                 # 신경 → 혈관 가지가 갈라지는 y
VESSEL = ((74, -6), (74, 156), (88, 170), (88, 206))
SIG_PERIOD = 1.1
MIDDLE_BONE = ((98, -3), (144, -3), (144, 30), (140, 38), (130, 42), (121, 39), (112, 42), (102, 38), (98, 30))
DISTAL_BONE = ((100, 50), (142, 50), (142, 58), (135, 66), (131, 100), (129, 140), (135, 152), (138, 166), (132, 176),
               (120, 180), (108, 176), (103, 166), (106, 152), (111, 140), (109, 100), (106, 66), (100, 58))


@lru_cache(None)
def _sec_base():
    """FULL 윤곽(1도트 간격 점 P, 바깥 법선 N), 속살이 줄 수 있는 정도 g, 접히는 곳의 물결 wave, 골 위치 valleys."""
    ax, yl, yr = 108, 157.5, 174.0
    pts = [(42.0, y) for y in np.arange(-4.0, yl, 0.5)]
    pts += [(ax - 66 * math.cos(p), yl + 82.5 * math.sin(p)) for p in np.linspace(0, math.pi / 2, 400)[1:]]
    pts += [(ax + 44 * math.cos(p), yr + 66 * math.sin(p)) for p in np.linspace(math.pi / 2, 0, 300)[1:]]
    pts += [(152.0, y) for y in np.arange(yr, -4.5, -0.5)][1:]
    P = np.array(pts)
    s = np.concatenate([[0], np.cumsum(np.hypot(*np.diff(P, axis=0).T))])
    ss = np.arange(0, s[-1], 1.0)
    P = np.stack([np.interp(ss, s, P[:, 0]), np.interp(ss, s, P[:, 1])], 1)
    T = np.gradient(P, axis=0)
    T /= np.hypot(*T.T)[:, None]
    N = np.stack([-T[:, 1], T[:, 0]], 1)
    x, y = P.T
    pad = x < 107.5
    g = np.where(pad, np.clip((y - 100) / 50, 0, 1), np.clip((y - 214) / 16, 0, 1))
    g = g * g * (3 - 2 * g)
    h = np.where(pad, y > 140, y > 222)
    idx = np.nonzero(h)[0]
    ia, ib = idx[0], idx[-1]
    u = np.clip((np.arange(len(P)) - ia) / (ib - ia), 0, 1)
    wave = np.where(h, 0.5 - 0.5 * np.cos(2 * math.pi * 4 * u), 0.0)
    valleys = [round(ia + (k + 0.5) / 4 * (ib - ia)) for k in range(4)]
    return P, N, g, wave, valleys


@lru_cache(None)
def _vessel():
    """혈관 중심선까지의 거리장과 중심선 위 1도트 점들."""
    dist = np.full((H, W), 1e9)
    path = []
    for (x0, y0), (x1, y1) in zip(VESSEL, VESSEL[1:]):
        dx, dy = x1 - x0, y1 - y0
        u = np.clip(((XX - x0) * dx + (YY - y0) * dy) / (dx * dx + dy * dy), 0, 1)
        dist = np.minimum(dist, np.hypot(XX - (x0 + u * dx), YY - (y0 + u * dy)))
        n = max(abs(dx), abs(dy))
        path += [(x0 + dx * i // n, y0 + dy * i // n) for i in range(n)]
    return dist, tuple(path)


@lru_cache(None)
def _bones():
    m = poly(MIDDLE_BONE) | poly(DISTAL_BONE)
    return m, m & ~erode(m)


@lru_cache(None)
def _pulp_tex():
    return BAYER < 2


def lumen_r(ta, t_sig):
    """행마다 혈관 속 반지름: 신호가 지나간 뒤 0.7초 동안 4 → 1도트로 조인다(위에서 아래로 차례로)."""
    y = np.arange(H)
    u = np.clip((ta - (t_sig + (y + 6) / V_SIG + 0.25)) / 0.7, 0, 1)
    return 4 - 3 * u * u * (3 - 2 * u)


def section(img, d, ta, t_sig, b, f, arrows_at, labels):
    """손끝을 세로로 자른 단면(물속, 확대). 왼쪽이 지문 쪽 배, 오른쪽이 손톱.
    t_sig: 신경 신호가 뿌리에서 출발하는 시각(1.1초마다 다시), b: 속살이 고르게 줄어든 정도(0~0.45), f: 접혀 골이 깊어진 정도(0~0.55),
    arrows_at: 피부를 안쪽으로 당기는 화살표가 뜨는 시각, labels: 보일 이름표 집합."""
    P, N, g, wave, valleys = _sec_base()
    dist, vpath = _vessel()
    water(img, d, ta, 0, 179, 0, 250, n=22, seed=3)
    if b > 0.01:                                       # FULL 윤곽의 흔적(점선)
        for i in range(0, len(P), 3):
            if g[i] > 0.05:
                d.point((round(P[i, 0]), round(P[i, 1])), fill=E.LABEL)
    dd = DEPTH * g * (b + f * wave)
    O = P - N * dd[:, None]
    body = poly(O)
    pulp = poly(O - N * SK)
    epi = body & ~poly(O - N * 2)
    if "SKIN" in labels:
        row = O[(O[:, 0] < 108) & (np.abs(O[:, 1] - 201) < 0.6)]
        d.line((28, 201, round(row[:, 0].min()) - 2 if len(row) else 46, 201), fill=E.LABEL)
    paint(img, grow(body) & ~body, E.OUTLINE)
    paint(img, body, E.CARD)
    paint(img, pulp & _pulp_tex(), E.DITHER)
    paint(img, body & ~pulp, E.LABEL)
    paint(img, epi, E.TEXT)
    leaders = np.zeros((H, W), bool)                   # 지시선: 피부 띠는 건너뛰고 물·속살 구간만
    if "NERVE" in labels:
        leaders[19, 32:NERVE_X] = True
    if "VESSEL" in labels:
        leaders[133, 38:68] = True
    paint(img, leaders & ~(body & ~pulp), E.LABEL)
    if f > 0.12:                                       # 골 바닥의 접힌 자국
        for iv in valleys:
            for k in (0, 1):
                x, y = O[iv] - N[iv] * k
                d.point((round(x), round(y)), fill=E.OUTLINE)
    nail = [k for k in range(len(P)) if P[k, 0] > 108 and 112 <= P[k, 1] <= 229]
    for k in nail:                                     # 손톱: 등 쪽 바깥 판(LABEL 4도트, 바깥 가장자리 OUTLINE), 끝은 살보다 길게
        for j in range(1, 6):
            q = P[k] + N[k] * j
            d.point((round(q[0]), round(q[1])), fill=E.OUTLINE if j == 5 else E.LABEL)
    for j in range(1, 6):                              # 뿌리(큐티클)와 자유연 끝 마감
        for k, col in ((nail[0], E.OUTLINE), (nail[-1], E.TEXT)):
            q = P[k] + N[k] * j
            d.point((round(q[0]), round(q[1])), fill=col)
    bone, edge = _bones()                              # 뼈: 변하지 않는 구조물이라 어둡게, 가장자리만 DITHER
    paint(img, bone, E.BG)
    paint(img, edge, E.DITHER)
    d.line((104, 51, 116, 51), fill=E.LABEL)
    r = lumen_r(ta, t_sig)
    lumen = dist <= r[:, None]
    wall = (dist > r[:, None]) & (dist <= r[:, None] + 2)
    paint(img, lumen, E.BG)
    paint(img, wall, E.PURPLE)
    phase, k = 0.0, 0                                  # 피 알갱이: 관이 조일수록 느리고 성기다
    while k < int(ta * 12 + 1e-9):
        phase += (4 + 20 * (lumen_r(k / 12, t_sig)[100] - 1) / 3) / 12
        k += 1
    for i in range(0, 40):
        sp = (i * 7 + phase) % len(vpath)
        x, y = vpath[int(sp)]
        if 0 <= y < H and (r[y] > 2.5 or i % 2 == 0) and lumen[y, x]:
            d.rectangle((x - 1, y - 1, x, y), fill=E.LABEL)
    d.rectangle((NERVE_X, 0, NERVE_X + 1, NERVE_END), fill=E.DEEP)    # 신경(DEEP 2도트) + 혈관으로 가는 가지
    bpaths = {}
    for yb in BRANCHES:
        xw = round(74 - r[yb + 7] - 2) - 1
        bp = [(NERVE_X + 2 + i, yb + i) for i in range(8)] + [(x, yb + 7) for x in range(NERVE_X + 10, xw + 1)]
        bpaths[yb] = bp
        for x, y in bp:
            d.point((x, y), fill=E.DEEP)
    if ta >= t_sig:                                    # 신호: 뿌리 → 끝으로만 흐르고, 가지를 따라 혈관 벽에 닿는다
        k = 0
        while t_sig + k * SIG_PERIOD <= ta:
            tk = t_sig + k * SIG_PERIOD
            y = round(-6 + V_SIG * (ta - tk))
            if -6 <= y <= NERVE_END:
                if y >= 2:
                    d.rectangle((NERVE_X, max(0, y - 10), NERVE_X + 1, y - 2), fill=E.INK)
                d.rectangle((NERVE_X - 1, y - 2, NERVE_X + 2, y + 1), fill=E.TEXT)
            for yb in BRANCHES:
                q = round(V_SIG * (ta - tk - (yb + 6) / V_SIG))
                if 0 <= q < len(bpaths[yb]):
                    x, yy = bpaths[yb][q]
                    d.rectangle((x - 1, yy - 1, x, yy), fill=E.TEXT)
            k += 1
    if arrows_at is not None and ta >= arrows_at:     # 줄어든 속살이 피부를 안쪽으로 당긴다
        off = int(ta * 12) // 2 % 3
        for iv in valleys:
            n = N[iv]
            ax_, ay_ = (int(-np.sign(n[0])), 0) if abs(n[0]) > abs(n[1]) else (0, int(-np.sign(n[1])))
            sx, sy = (O[iv] - n * (SK + 2)).round().astype(int)
            sx, sy = sx + ax_ * off, sy + ay_ * off
            d.line((sx, sy, sx + ax_ * 4, sy + ay_ * 4), fill=E.INK)
            head(d, sx + ax_ * 7, sy + ay_ * 7, ax_, ay_, E.INK)
    if "NERVE" in labels:
        label(img, 3, 14, "NERVE")
    if "VESSEL" in labels:
        label(img, 2, 128, "VESSEL")
    if "PULP" in labels:
        label(img, 99, 194, "PULP")
    if "SKIN" in labels:
        label(img, 3, 196, "SKIN")


# ---------------- 베개(비유) ----------------
def _pillow_mask(cx, cy, w, h, k):
    """변이 bow만큼 휜 겉감 + 네 귀(모서리에서 바깥으로 3도트 뾰족). 귀 자리는 k와 상관없이 같다."""
    bow = 9 - 15 * k
    q, r = (XX - cx) / (w / 2), (YY - cy) / (h / 2)
    yt, yb = cy - h / 2 - bow * (1 - q * q), cy + h / 2 + bow * (1 - q * q)
    xl, xr = cx - w / 2 - 0.8 * bow * (1 - r * r), cx + w / 2 + 0.8 * bow * (1 - r * r)
    m = (YY >= yt) & (YY <= yb) & (XX >= xl) & (XX <= xr) & (np.abs(q) <= 1.15) & (np.abs(r) <= 1.3)
    for sx in (-1, 1):
        for sy in (-1, 1):
            ex, ey = cx + sx * w / 2, cy + sy * h / 2
            u, v = (XX - ex) * sx, (YY - ey) * sy                 # 귀 쪽이 양수
            m |= (u >= -6) & (v >= -6) & (u <= 3) & (v <= 3) & (np.abs(u - v) <= 2) & (u + v >= -10)
    return m, yb


def pillow(img, cx, cy, w, h, k, ghost=False):
    """베개: 네 귀가 뾰족한 겉감 + 안쪽 박음선. k=0 꽉 참(변이 바깥으로 불룩), 1 속이 줄어 변이 오목하고 귀에서 주름이 진다.
    겉감 크기(네 귀의 자리)는 그대로다. ghost면 꽉 찼을 때 윤곽을 점선으로 남긴다."""
    d = ImageDraw.Draw(img)
    M, yb = _pillow_mask(cx, cy, w, h, k)
    if ghost and k > 0.02:
        F, _ = _pillow_mask(cx, cy, w, h, 0.0)
        paint(img, (grow(F) & ~F) & ~grow(M) & ((XX + YY) % 3 == 0), E.LABEL)
    paint(img, grow(M) & ~M, E.OUTLINE)
    paint(img, M, E.TEXT)
    paint(img, M & (YY > yb - 5), E.LABEL)
    seam = erode(erode(M)) & ~erode(erode(erode(M)))
    paint(img, seam & (YY <= yb - 5), E.LABEL)
    if k > 0.05:
        x0, x1, y0, y1 = cx - w // 2, cx + w // 2, cy - h // 2, cy + h // 2
        for (px, py, sx, sy) in ((x0, y0, 1, 1), (x1, y0, -1, 1), (x0, y1, 1, -1), (x1, y1, -1, -1)):
            for off, ln in ((5, round(16 * k)), (11, round(10 * k))):
                a = (px + sx * off, py + sy * 4)
                if ln >= 2:
                    d.line((a[0], a[1], a[0] + sx * ln, a[1] + sy * ln), fill=E.OUTLINE)
                    d.line((a[0] + sx, a[1], a[0] + sx * ln, a[1] + sy * (ln - 1)), fill=E.LABEL)
        for yy in (cy - 6, cy + 4):
            ln = round(22 * k)
            if ln >= 2:
                d.line((cx - ln, yy, cx + ln, yy), fill=E.LABEL)


# ---------------- FLOW 화살표 ----------------
def flow_arrow(d, ta, x, y, length):
    """혈류 감소 화살표(아래로): 3도트 줄기 + 9폭 촉. 줄기에 1도트 틈이 아래로 흐른다."""
    if length < 1:
        return
    d.rectangle((x - 1, y, x + 1, y + length - 1), fill=E.INK)
    for yy in range(y + int(ta * 12) % 4, y + length - 1, 4):
        d.line((x - 1, yy, x + 1, yy), fill=E.DEEP)
    for k in range(5):
        d.line((x - 4 + k, y + length + k, x + 4 - k, y + length + k), fill=E.INK)
