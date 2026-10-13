"""13편 그림 부품. 무대: 물(water_back·water_front), 손(hand — 손바닥 쪽, 손가락이 아래로), 손끝 세로 단면(section — 카메라 cam=(ox, oy, k)).
같은 손은 hand(f) 한 함수에서 나오고 f는 크기만 바꾼다(비례·색 같음). 단면은 세계 좌표(k=1이면 캔버스 좌표)로 정의하고,
카메라는 세계를 잘라 k배(정수)로 다시 그린다 — 선은 언제나 1도트라 배율이 바뀌어도 도트 크기가 섞이지 않는다."""
import bisect
import math
from functools import lru_cache

import numpy as np
from PIL import Image, ImageDraw

from px import engine as E
from px.timeline import step

SKIN, SHADE = "#D9A88A", "#A87562"          # 사람 피부 두 단(PEOPLE_COLORS warm)
NAIL, SLEEVE = "#C9A08E", "#4E6A9C"          # 손톱(피부 muted 밝은 단), 소매(옷 blue)
SS = 4                                       # 윤곽 4배 그려 줄이기


def rgb(c):
    return tuple(int(c[i:i + 2], 16) for i in (1, 3, 5))


def _sh(m, dy, dx, edge=False):
    """out[y, x] = m[y+dy, x+dx]. 밖은 False(edge면 가장자리 값을 늘인다)."""
    p = np.pad(m, ((abs(dy), abs(dy)), (abs(dx), abs(dx))), mode="edge" if edge else "constant")
    h, w = m.shape
    return p[abs(dy) + dy:abs(dy) + dy + h, abs(dx) + dx:abs(dx) + dx + w]


N4 = ((1, 0), (-1, 0), (0, 1), (0, -1))
N8 = N4 + ((1, 1), (1, -1), (-1, 1), (-1, -1))


def erode(m, r, edge=True):
    """팔각형 침식(4·8이웃을 번갈아): 반지름 r 도트 안쪽만 남긴다."""
    for i in range(r):
        m = m & np.logical_and.reduce([_sh(m, dy, dx, edge) for dy, dx in (N8 if i % 2 else N4)])
    return m


def dilate(m, r, edge=False):
    for i in range(r):
        m = m | np.logical_or.reduce([_sh(m, dy, dx, edge) for dy, dx in (N8 if i % 2 else N4)])
    return m


def _down(big, w, h):
    return np.asarray(big, np.float32).reshape(h, SS, w, SS).mean((1, 3)) >= 128


# ---------------- 물 ----------------
def water_back(d, box, surf, t, seed=0):
    """물 면(DEEP)과 그 안을 천천히 떠도는 결(DITHER 짧은 줄). 손보다 먼저 그린다."""
    x0, y0, x1, y1 = box
    d.rectangle((x0, surf, x1, y1), fill=E.DEEP)
    ph = int(step(t) * 12)
    wdt, hgt = x1 - x0 - 4, y1 - surf - 8
    if hgt <= 4:
        return
    for j in range(max(3, wdt * hgt // 700)):
        x = x0 + 2 + (j * 37 + seed * 11 + ph // 3) % wdt
        y = surf + 5 + (j * 23 + seed * 7 + (ph // 8 if j % 2 else 0)) % hgt
        d.line((x, y, x + 3, y), fill=E.DITHER)


def water_front(d, x0, x1, surf, t):
    """수면 선과 옆으로 흘러가는 물결 마루(DEEP). 손 위에도 지나가서 손가락이 물에 잠긴 높이가 보인다."""
    d.line((x0, surf, x1, surf), fill=E.DEEP)
    ph = int(step(t) * 12)
    for x in range(x0, x1 + 1):
        if (x + ph) % 22 < 6:
            d.point((x, surf - 1), fill=E.DEEP)


# ---------------- 손 ----------------
FINGERS = ((-28, 40), (-14, 50), (0, 54), (14, 50))     # (왼쪽 x, 길이): 새끼·약지·가운데·검지. 단위 좌표, 원점은 손바닥 위 가운데
FW = 13                                                  # 손가락 폭(단위)
HAND_BOX = (-31, -90, 52, 94)                            # 그릴 범위(단위)


class Hand:
    """손 그림(RGBA)과 앵커. ox, oy: 그림 안에서 원점(손바닥 위 가운데)의 픽셀. fingers: [(xa, xb, crease_d, tip)] 그림 픽셀."""

    def __init__(self, f):
        self.f = f
        x0u, y0u, x1u, y1u = HAND_BOX
        self.ox, self.oy = round(-x0u * f), round(-y0u * f)
        w, h = round((x1u - x0u) * f) + 2, round((y1u - y0u) * f) + 2
        P = lambda x, y: ((x * f + self.ox) * SS, (y * f + self.oy) * SS)

        def mask(paint):
            m = Image.new("L", (w * SS, h * SS), 0)
            paint(ImageDraw.Draw(m))
            return _down(m, w, h)

        def skin_shapes(dd):
            dd.rectangle((*P(-18, -300), *P(18, 8)), fill=255)                                    # 팔뚝
            dd.rounded_rectangle((*P(-28, 0), *P(28, 42)), radius=10 * f * SS, fill=255)             # 손바닥
            for x0, ln in FINGERS:
                dd.rounded_rectangle((*P(x0, 30), *P(x0 + FW, 36 + ln)), radius=6.5 * f * SS, fill=255)
            (ax, ay), (bx, by), r = (21, 10), (39, 38), 7                                            # 엄지: 손바닥 옆에서 비스듬히
            L = math.hypot(bx - ax, by - ay)
            nx, ny = -(by - ay) / L * r, (bx - ax) / L * r
            dd.polygon([P(ax + nx, ay + ny), P(bx + nx, by + ny), P(bx - nx, by - ny), P(ax - nx, ay - ny)], fill=255)
            dd.ellipse((*P(bx - r, by - r), *P(bx + r, by + r)), fill=255)

        skin = mask(skin_shapes)
        sleeve = mask(lambda dd: dd.rectangle((*P(-21, -300), *P(21, -26)), fill=255))
        body = skin | sleeve
        vis = skin & ~sleeve
        s = max(2, round(1.6 * f))
        a = np.zeros((h, w, 4), np.uint8)
        a[vis] = (*rgb(SKIN), 255)
        a[vis & ~_sh(skin, s, s)] = (*rgb(SHADE), 255)                 # 빛은 왼쪽 위: 오른쪽·아래 그늘 띠
        a[sleeve] = (*rgb(SLEEVE), 255)
        a[sleeve & _sh(vis, 1, 0)] = (*rgb(E.OUTLINE), 255)           # 소맷부리
        a[dilate(body, 1) & ~body] = (*rgb(E.OUTLINE), 255)
        img = Image.fromarray(a, "RGBA")
        dd = ImageDraw.Draw(img)
        self.fingers = []
        for x0, ln in FINGERS:
            xa, xb = round(x0 * f + self.ox), round((x0 + FW) * f + self.ox) - 1
            cx = (xa + xb) // 2
            tip = int(np.nonzero(skin[:, cx])[0].max())
            cd, cm = tip - round(0.36 * ln * f), tip - round(0.68 * ln * f)
            for y in (cd, cm):                                          # 마디 주름(손바닥 쪽 손가락 마디)
                dd.line((xa + 2, y, xb - 3, y), fill=SHADE)
            self.fingers.append((xa, xb, cd, tip))
        tx, ty = P(20, 14)
        bx, by = P(25, 34)
        dd.line((tx / SS, ty / SS, bx / SS, by / SS), fill=SHADE)        # 엄지 두덩 금
        self.img, self.skin, self.vis = img, skin, vis

    def paste(self, img, hx, hy):
        img.paste(self.img, (hx - self.ox, hy - self.oy), self.img)

    def tip_xy(self, hx, hy, i):
        xa, xb, cd, tip = self.fingers[i]
        return hx - self.ox + (xa + xb) // 2, hy - self.oy + tip

    def wrinkles(self, d, hx, hy, i, w, col=SHADE):
        """i번째 손가락 끝마디(마디 주름 ~ 끝)에 물결 주름 줄. w(0~1): 줄이 가운데에서 양옆으로 자라고, 다 자라면 윤곽까지 닿아 끝이 울퉁불퉁해진다.
        줄 수는 디테일 규칙대로 3~4개(실제 주름 수가 아니다)."""
        if w <= 0:
            return
        xa, xb, cd, tip = self.fingers[i]
        big = self.f >= 1.6
        n = 4 if big else 3
        dx, dy = hx - self.ox, hy - self.oy
        cx, full = (xa + xb) // 2, (xb - xa) // 2 + 1
        for k in range(n):
            row = cd + round((tip - cd) * (k + 1) / (n + 1)) - (1 if big else 0)
            u = min(1.0, max(0.0, w * 1.8 - k * 0.25))
            hl = round(full * u)
            for x in range(cx - hl, cx + hl + 1):
                off = (0, 1, 2, 1)[((x - xa) // 2) % 4] if big else ((x - xa) // 2) % 2
                y = row + off
                if 0 <= y < self.skin.shape[0] and 0 <= x < self.skin.shape[1] and self.skin[y, x]:
                    d.point((x + dx, y + dy), fill=col)

    def cream(self, d, hx, hy, i, c):
        """i번째 손가락 끝마디에만 바른 크림 막(LABEL): 끝에서 마디 주름 쪽으로 c(0~1)만큼 덮고, 윤곽 밖으로 1도트 두껍다. 다 바르면 TEXT 광택 1줄."""
        if c <= 0:
            return
        xa, xb, cd, tip = self.fingers[i]
        dx, dy = hx - self.ox, hy - self.oy
        top = tip - round(c * (tip - cd))
        skin = self.skin
        fat = dilate(skin, 1)
        for y in range(top, tip + 2):
            for x in range(xa - 1, xb + 2):
                if 0 <= y < skin.shape[0] and fat[y, x]:
                    d.point((x + dx, y + dy), fill=E.LABEL)
        for y in range(top, tip + 3):                          # 크림 바깥 윤곽
            for x in range(xa - 2, xb + 3):
                if 0 <= y < skin.shape[0] and not fat[y, x] and fat[max(0, y - 1):y + 2, x - 1:x + 2].any() and y >= top:
                    d.point((x + dx, y + dy), fill=E.OUTLINE)
        if c >= 1:
            d.line((xa + 1 + dx, cd + 3 + dy, xa + 1 + dx, tip - 4 + dy), fill=E.TEXT)


@lru_cache(None)
def hand(f):
    return Hand(f)


def nerve_paths(H, hx, hy, top, fingers=(0, 1, 2, 3)):
    """손목 쪽 줄기에서 손가락마다 끝마디로 내려가는 신경 길(수평·수직·45°만). 신호는 위(뿌리)에서 아래(손끝)로만 흐른다."""
    f = H.f
    tx = hx + round(-2 * f)
    yb = hy + round(40 * f)
    out = []
    for i in fingers:
        xa, xb, cd, tip = H.fingers[i]
        fx = hx - H.ox + (xa + xb) // 2
        ye = hy - H.oy + cd + 2
        dxy = abs(fx - tx)
        out.append(((tx, top), (tx, yb - dxy), (fx, yb), (fx, ye)) if dxy else ((tx, top), (fx, ye)))
    return out


def dotted_line(d, pts, col, on=2, off=2):
    """수평·수직 점선(2켜고 2끔)."""
    (x0, y0), (x1, y1) = pts
    n = max(abs(x1 - x0), abs(y1 - y0))
    for i in range(n + 1):
        if i % (on + off) < on:
            d.point((x0 + (x1 - x0) * i // max(n, 1), y0 + (y1 - y0) * i // max(n, 1)), fill=col)


def label(img, x, y, s, col=E.LABEL, font="label"):
    E.text(img, (x, y), s, font, col)


# ---------------- 손끝 단면(세계 좌표) ----------------
# 손가락이 아래를 향한 세로 단면: 왼쪽이 손바닥 쪽 지문면(속살이 두툼), 오른쪽이 손등 쪽(뼈·손톱). 위가 손가락 뿌리.
SEC_L, SEC_CX, SEC_CY, SEC_RX, SEC_RX_BACK, SEC_RY = 40, 100, 160, 60, 56, 72
PAD_BULGE = 9
SKIN_T = 7                          # 피부 띠 두께(세계 단위) — 접혀도 바뀌지 않는다
SHRINK, FOLD_A, FOLD_P, FOLD_A0 = 8, 6, 34, 104
NERVE_X, VES_X, VES_W, VES_END = 76, 95, 12, 204
BRANCH_Y = (60, 115, 170)
BONE_MID = ((114, -100), (146, -100), (147, 24), (141, 31), (119, 31), (113, 24))             # 가운데마디뼈 머리
BONE_DIST = ((115, 37), (145, 37), (143, 48), (137, 56), (135, 148), (140, 162), (138, 175), (130, 181), (121, 181),
             (113, 175), (112, 162), (120, 148), (123, 56), (117, 48))                         # 끝마디뼈(끝이 살짝 넓다)
NAIL_PTS = ((157, 82), (163, 88), (162, 130), (160, 160), (156, 184), (150, 198), (146, 195), (150, 184), (153, 160),
            (155, 130), (157, 92))                                                             # 손등 쪽 손톱 판(반쯤 밖으로)


def _smooth(u):
    u = min(max(u, 0.0), 1.0)
    return u * u * (3 - 2 * u)


@lru_cache(None)
def _outline_base():
    """윤곽 표본 [(x, y, 안쪽 nx, ny, 줄어드는 정도 g, 접히는 정도 gw, 호 길이)]: 지문면을 따라 내려가 끝을 돌아 손등 쪽으로 올라간다."""
    pts = []
    for i in range(0, (160 + 100) * 2):                           # 지문면: 끝마디에서 두툼하게 부풀었다(PAD_BULGE)
        y = -100 + i / 2
        g = _smooth((y - 40) / 60)
        bulge = PAD_BULGE * math.sin(math.pi * (y - 60) / 100) if 60 <= y <= 160 else 0.0
        pts.append((SEC_L - bulge, y, 1.0, 0.0, g, g * _smooth((y - 90) / 30)))
    for i in range(1, 721):                                       # 끝: 지문면 쪽 반은 rx, 손등 쪽 반은 rx_back
        th = math.pi + math.pi * i / 720
        rx = SEC_RX if th <= 1.5 * math.pi else SEC_RX_BACK
        x, y = SEC_CX + rx * math.cos(th), SEC_CY - SEC_RY * math.sin(th)
        gx, gy = (x - SEC_CX) / rx ** 2, (y - SEC_CY) / SEC_RY ** 2
        n = math.hypot(gx, gy)
        g = 1.0 if th <= 1.5 * math.pi else 1 - _smooth((th - 1.5 * math.pi) / (0.3 * math.pi))
        pts.append((x, y, -gx / n, -gy / n, g, g))
    for i in range(1, (160 + 100) * 2 + 1):                       # 손등 쪽: 끝으로 갈수록 살짝 가늘어진다
        y = SEC_CY - i / 2
        pts.append((SEC_CX + SEC_RX_BACK + (SEC_RX - SEC_RX_BACK) * (1 - _smooth((y - 100) / 60)), y, -1.0, 0.0, 0.0, 0.0))
    out, arc = [], 0.0
    for j, p in enumerate(pts):
        if j:
            arc += math.hypot(p[0] - pts[j - 1][0], p[1] - pts[j - 1][1])
        out.append((*p, arc))
    return tuple(out)


def outline(s, a):
    """줄어든(s)·접힌(a) 윤곽 점들과 골(안쪽으로 가장 깊이 끌려간 자리) 점들. 마루는 s만큼만, 골은 s + a만큼 안쪽으로 간다."""
    base = _outline_base()
    pts = []
    for x, y, nx, ny, g, gw, arc in base:
        wave = 0.5 - 0.5 * math.cos(2 * math.pi * (arc - FOLD_A0) / FOLD_P)
        D = g * s * SHRINK + gw * a * FOLD_A * wave
        pts.append((x + nx * D, y + ny * D))
    arcs = [p[6] for p in base]
    valleys, arc_v = [], FOLD_A0 + FOLD_P / 2
    while arc_v < arcs[-1]:
        j = bisect.bisect_left(arcs, arc_v)
        if base[j][5] >= 0.5:
            valleys.append((j, pts[j], (base[j][2], base[j][3])))
        arc_v += FOLD_P
    return pts, valleys


def to_cam(cam, clip, wx, wy):
    ox, oy, k = cam
    return (wx - ox) * k, (wy - oy) * k


def _poly_mask(pts, cam, clip):
    x0, y0, x1, y1 = clip
    w, h = x1 - x0 + 1, y1 - y0 + 1
    big = Image.new("L", (w * SS, h * SS), 0)
    q = [((cx - x0) * SS, (cy - y0) * SS) for cx, cy in (to_cam(cam, clip, x, y) for x, y in pts)]
    ImageDraw.Draw(big).polygon(q, fill=255)
    return _down(big, w, h)


@lru_cache(64)
def _static_masks(cam, clip):
    bone = _poly_mask(BONE_MID, cam, clip) | _poly_mask(BONE_DIST, cam, clip)
    nail = _poly_mask(NAIL_PTS, cam, clip)
    return bone, nail


@lru_cache(256)
def _finger_masks(s, a, cam, clip):
    pts, _ = outline(s, a)
    M = _poly_mask(pts, cam, clip)
    k = cam[2]
    inner = erode(M, SKIN_T * k)
    return M, inner


@lru_cache(8)
def _ghost_pts(cam, clip):
    """줄기 전 지문면 윤곽(점선 유령선) 캔버스 점들."""
    out, last = [], None
    for x, y, nx, ny, g, gw, arc in _outline_base():
        if g < 0.05:
            continue
        p = tuple(round(v) for v in to_cam(cam, clip, x, y))
        if p != last and int(arc * cam[2]) % 4 < 2:
            out.append(p)
        last = p
    return tuple(out)


def vessel_width(wy, n):
    """세계 y에서 혈관 바깥 폭. n: 가지 세 곳의 조임 정도(0~1) — 가지 사이는 선형으로 잇는다."""
    ys = BRANCH_Y
    if wy <= ys[0]:
        u = n[0]
    elif wy >= ys[-1]:
        u = n[-1]
    else:
        j = 0 if wy < ys[1] else 1
        r = (wy - ys[j]) / (ys[j + 1] - ys[j])
        u = n[j] * (1 - r) + n[j + 1] * r
    w = VES_W - 6 * u
    if wy > VES_END - w / 2:                                    # 끝은 둥글게 닫힌다
        r = w / 2
        w = 2 * math.sqrt(max(0.0, r * r - (wy - (VES_END - r)) ** 2))
    return w


def section(img, cam, clip, st, t):
    """손끝 단면을 clip(캔버스 박스) 안에 cam으로 그린다. st: s(줄어듦)·a(접힘)·n(가지 세 곳 조임)·ghost(유령선)·blood(피 점 전진 세계 px)·
    pulses(신경 위 신호의 세계 y 목록)·bpulses([(가지 번호, 0~1)])."""
    ox, oy, k = cam
    x0, y0, x1, y1 = clip
    sq = round(st["s"], 3), round(st["a"], 3)
    M, inner = _finger_masks(*sq, cam, clip)
    bone, nail = _static_masks(cam, clip)
    h, w = M.shape
    arr = np.empty((h, w, 3), np.uint8)
    arr[:] = rgb(E.DEEP)
    layer = Image.fromarray(arr)
    water_back(ImageDraw.Draw(layer), (0, 0, w - 1, h - 1), 0, t, seed=3)
    arr = np.array(layer)
    yy, xx = np.mgrid[y0:y1 + 1, x0:x1 + 1]
    if st.get("ghost"):
        for px, py in _ghost_pts(cam, clip):
            if 0 <= py - y0 < h and 0 <= px - x0 < w and not M[py - y0, px - x0]:
                arr[py - y0, px - x0] = rgb(E.LABEL)
    ring = dilate(M, 1) & ~M
    arr[ring] = rgb(E.OUTLINE)
    band = M & ~inner
    arr[band] = rgb(SKIN)
    arr[band & dilate(inner, 2 if k == 1 else 3, edge=True)] = rgb(SHADE)
    pulp = inner & ~bone
    arr[pulp] = rgb(E.CARD)
    arr[pulp & ((xx + 2 * yy) % 7 == 0) & (yy % 3 == 0)] = rgb(E.DITHER)   # 속살 결
    arr[bone] = rgb(E.BG)                                                    # 뼈는 변하지 않아 어둡게 물러난다
    arr[bone & ~(_sh(bone, 0, 1, True) & _sh(bone, 1, 0, True))] = rgb(E.OUTLINE)
    arr[bone & ~(_sh(bone, 0, -1, True) & _sh(bone, -1, 0, True))] = rgb(E.LABEL)   # 빛 쪽 가장자리 1도트만 밝게
    arr[dilate(nail, 1) & ~nail] = rgb(E.OUTLINE)
    arr[nail] = rgb(NAIL)
    arr[nail & ~_sh(nail, 0, 1, True)] = rgb(E.TEXT)                         # 손톱 바깥 광택
    img.paste(Image.fromarray(arr), (x0, y0))
    d = ImageDraw.Draw(img)

    def row_of(wy):
        return round((wy - oy) * k)

    def col_of(wx):
        return round((wx - ox) * k)

    # 혈관: 줄마다 벽(PURPLE)·속(OUTLINE). 조이면 바깥 폭이 줄어든다(넓어지거나 터지지 않는다).
    vc, wall = col_of(VES_X), (2 if k == 1 else 3)
    lumen_rows = {}
    for py in range(y0, y1 + 1):
        wy = oy + (py + 0.5) / k
        if wy > VES_END:
            continue
        half = vessel_width(wy, st["n"]) * k / 2
        a_, b_ = round(vc - half), round(vc + half) - 1
        if b_ < a_:
            continue
        d.line((max(a_, x0), py, min(b_, x1), py), fill=E.PURPLE)
        la, lb = a_ + wall, b_ - wall
        if lb >= la:
            d.line((max(la, x0), py, min(lb, x1), py), fill=E.OUTLINE)
            lumen_rows[py] = (la, lb)
    # 피 점: 혈관 속을 손끝 쪽으로 흐른다. 조이면 느려진다(전진량은 장면이 넘긴다).
    bs = 2 if k == 1 else 3
    for j in range(24):
        wy = -100 + (st["blood"] + j * 14) % 300
        py = row_of(wy)
        if py in lumen_rows and py + bs - 1 in lumen_rows:
            la, lb = lumen_rows[py]
            if lb - la + 1 >= bs:
                cx = (la + lb + 1) // 2 - bs // 2
                d.rectangle((cx, py, cx + bs - 1, py + bs - 1), fill=E.TEXT)
    # 신경: 위(뿌리)에서 내려오는 INK 줄과 혈관 벽에 닿는 가지 세 개.
    nx, tn = col_of(NERVE_X), (2 if k == 1 else 3)
    top, bot = max(y0, row_of(-100)), min(y1, row_of(198))
    if bot >= top:
        d.rectangle((nx, top, nx + tn - 1, bot), fill=E.INK)
    for b, yb in enumerate(BRANCH_Y):
        py = row_of(yb)
        if y0 <= py <= y1 - 1:
            vl = round(vc - vessel_width(yb, st["n"]) * k / 2) - 1
            d.rectangle((nx + tn, py, max(nx + tn, vl), py + (0 if k == 1 else 1)), fill=E.INK)
    ps = 3 if k == 1 else 4
    for wy in st.get("pulses", ()):
        py = row_of(wy)
        if y0 <= py <= y1 - ps:
            d.rectangle((nx + tn // 2 - ps // 2, py, nx + tn // 2 - ps // 2 + ps - 1, py + ps - 1), fill=E.TEXT)
    for b, u in st.get("bpulses", ()):
        py = row_of(BRANCH_Y[b])
        vl = round(vc - vessel_width(BRANCH_Y[b], st["n"]) * k / 2) - 1
        px = round(nx + tn + (vl - nx - tn) * u) - ps // 2
        if y0 <= py - 1 <= y1 - ps:
            d.rectangle((px, py - 1, px + ps - 1, py - 1 + ps - 1), fill=E.TEXT)


def valleys_canvas(s, a, cam, clip):
    """골 자리의 캔버스 좌표(피부 띠 안쪽 끝)와 안쪽 방향. 끌어당김 화살표가 여기서 시작한다."""
    _, vs = outline(s, a)
    k = cam[2]
    out = []
    for j, (x, y), (nx, ny) in vs:
        ix, iy = x + nx * (SKIN_T + 2), y + ny * (SKIN_T + 2)
        cx, cy = to_cam(cam, clip, ix, iy)
        out.append((round(cx), round(cy), nx, ny))
    return out
