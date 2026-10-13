"""13편 도트 그림. 무대 셋: 욕조 옆 단면(bath, 공기 BG + 물 DEEP), 마른 공기(dry, BG + DITHER 벽지), 손끝 세로 단면(section, CARD 속살 + DITHER 지방 무늬).
세계 단위 1 = 배율 1의 1도트. bath·dry는 배율 1로 그리고 카메라가 잘라 정수배 최근접으로 키운다. section은 '확대한 몸속' 무대라 그 정수 배율에서 바로 그린다.
손가락 바깥 finger()와 단면 section()은 같은 윤곽 함수(half_l·half_r)를 쓴다 — 단면 골 4개와 바깥 주름 4줄이 같은 높이다."""
import math

import numpy as np
from PIL import Image, ImageDraw

from px import draw as D, engine as E
from px.templates import head


def _rgb(h):
    return np.array([int(h[i:i + 2], 16) for i in (1, 3, 5)], np.uint8)


BG, DITHER, INK, DEEP, TEXT, LABEL, PURPLE, CARD, OUTLINE = map(_rgb, (E.BG, E.DITHER, E.INK, E.DEEP, E.TEXT, E.LABEL, E.PURPLE,
                                                                       E.CARD, E.OUTLINE))
LIGHT = _rgb(E.SPRITE_COLORS[1])    # INK 면의 밝은 짝(#C9F5DA)
BAYER = E.BAYER

# ---------------- 손가락 윤곽(세계 단위, u = 끝에서 위로 잰 거리) ----------------
R, RY = 18, 13                     # 반폭, 둥근 끝의 세로 반지름
DIP, PIP = 50, 100                 # 첫마디·둘째마디 관절
CREASES = (37, 29, 21, 13)         # 주름(골) 자리, 위 → 아래
NAIL0, NAIL1 = 3.0, 27.0           # 손톱 판(자유연 → 큐티클)


def _base(u, ry=RY):
    """둥근 끝(세로 반지름 ry) + 손끝 쪽으로 살짝 가늘어지는 몸통."""
    return np.where(u < ry, R * np.sqrt(np.clip(1 - ((ry - u) / ry) ** 2, 0, 1)), R) + np.clip((u - 20) * 0.03, 0, 3)


def _bump(u, c, half):
    return np.clip(1 - np.abs(u - c) / half, 0, None)


def half_l(u, creases=(0, 0, 0, 0)):
    """지문면(왼쪽) 반폭: 둥근 끝 + 볼록한 지문면 − 관절 홈 − 주름 골(깊이 2.5단위)."""
    w = _base(u) + np.where((u > 6) & (u < 44), 2.2 * np.sin(np.pi * (u - 6) / 38), 0)
    w = w - 1.5 * _bump(u, DIP, 2.5) - 1.2 * _bump(u, PIP, 3)
    for uc, k in zip(CREASES, creases):
        if k:
            w = w - 3.0 * k * _bump(u, uc, 2.2)
    return w


def half_r(u):
    """손톱 쪽(오른쪽) 반폭: 지문면보다 덜 둥글게 끝 가까이까지 곧게 내려오고(손톱이 놓이는 등), 손톱 판이 0.8단위 도드라지며, 관절 홈이 있다."""
    w = _base(u, 7) - np.where((u > 28) & (u < 46), 0.8 * np.sin(np.pi * (u - 28) / 18), 0)
    w = w + np.where((u >= NAIL0) & (u <= NAIL1), 0.8, 0)
    return w - 1.0 * _bump(u, DIP, 2.5) - 1.0 * _bump(u, PIP, 3)


# ---------------- 마스크 도구 ----------------
def nb(m, dx, dy):
    """out[y, x] = m[y+dy, x+dx] (밖은 False)."""
    h, w = m.shape
    out = np.zeros_like(m)
    out[max(0, -dy):h - max(0, dy), max(0, -dx):w - max(0, dx)] = m[max(0, dy):h - max(0, -dy), max(0, dx):w - max(0, -dx)]
    return out


def grow(m):
    return m | nb(m, 1, 0) | nb(m, -1, 0) | nb(m, 0, 1) | nb(m, 0, -1)


def erode(m, r):
    """r도트 깎기(정사각·십자를 번갈아 → 팔각형에 가까운 두께)."""
    for i in range(r):
        k = m & nb(m, 1, 0) & nb(m, -1, 0) & nb(m, 0, 1) & nb(m, 0, -1)
        if i % 2 == 0:
            k &= nb(m, 1, 1) & nb(m, -1, 1) & nb(m, 1, -1) & nb(m, -1, -1)
        m = k
    return m


def edge_out(m):
    return m & ~(nb(m, 1, 0) & nb(m, -1, 0) & nb(m, 0, 1) & nb(m, 0, -1))


# ---------------- 손가락 바깥 모습(배율 1) ----------------
def finger(arr, X0, Y0, fx, ty, creases=(0, 0, 0, 0), cream=0.0, surf=None):
    """arr(배율 1 세계 조각, 왼쪽 위 = 세계 (X0, Y0))에 손가락을 그린다. 위에서 곧게 내려와 끝이 아래, 지문면 왼쪽·손톱 오른쪽.
    INK 면, 왼쪽 가장자리 TEXT, 오른쪽·아래 DEEP, OUTLINE 테두리. 손톱 LABEL 판(자유연 TEXT, 큐티클 OUTLINE). 주름은 윤곽 골 + 짧은 OUTLINE 선(≤5도트) + 아래 TEXT 마루.
    cream 0~1: 끝에서 첫마디 관절까지 아래에서 위로 덮이는 크림 막(LABEL 4도트, 바깥 TEXT 광택). surf: 수면 줄(손가락을 가로지르는 LABEL 고리)."""
    P = 5                                                                       # 잘린 가장자리가 윤곽으로 잡히지 않게 둘레를 넓혀 계산
    h0, w0 = arr.shape[:2]
    X, Y = np.meshgrid(X0 - P + np.arange(w0 + 2 * P) + 0.5, Y0 - P + np.arange(h0 + 2 * P) + 0.5)
    u = ty - Y
    hl, hr = half_l(u, creases), half_r(u)
    ins = (u >= 0) & (X >= fx - hl) & (X <= fx + hr)
    if not ins[P:-P, P:-P].any() and not grow(ins)[P:-P, P:-P].any():
        return
    full, arr = arr, np.zeros(ins.shape + (3,), np.uint8)
    arr[grow(ins) & ~ins] = OUTLINE
    arr[ins] = INK
    rim_r = ins & ~erode(ins, 4) & (X > fx + 4)                                 # 둥근 몸통: 오른쪽 4도트 체크 디더 그늘
    arr[rim_r & ((X + Y) % 2 < 1)] = DEEP
    arr[ins & ~nb(ins, 1, 0)] = DEEP
    arr[ins & ~nb(ins, 0, 1)] = DEEP
    arr[ins & ~erode(ins, 3) & (X < fx - 4)] = LIGHT                           # 왼쪽 위 빛: 밝은 띠 + 가장자리 TEXT
    arr[ins & ~nb(ins, -1, 0)] = TEXT
    nail = ins & (u >= NAIL0) & (u <= NAIL1) & (X >= fx + hr - 3.5)
    arr[nail] = LABEL
    arr[nail & (np.abs(X - (fx + hr - 1.5)) < 0.5) & (u > 9) & (u < 20)] = TEXT  # 손톱 반사 줄
    arr[nail & ~nb(nail, -1, 0)] = OUTLINE
    arr[nail & ~nb(nail, 0, -1)] = OUTLINE
    arr[nail & (u < NAIL0 + 1.5)] = TEXT
    if cream > 0:
        cov = ins & (u <= cream * (DIP - 2))
        arr[cov & ~erode(ins, 4)] = LABEL
        arr[cov & ~erode(ins, 1)] = TEXT
    left = np.floor(fx - hl).astype(int)                        # 행마다 왼쪽 윤곽 도트의 세계 x
    right = np.floor(fx + hr).astype(int)
    for uj in (DIP, PIP):                                       # 관절: 지문면 접힘선 1줄(+ 아래 빛) + 등쪽 마디 주름 2줄
        arr[ins & (np.abs(u - (uj - 0.5)) < 0.5) & (X - 0.5 <= left + 6)] = OUTLINE
        arr[ins & (np.abs(u - (uj - 1.5)) < 0.5) & (X - 0.5 <= left + 3)] = TEXT
        for du in (1.0, -2.0):
            arr[ins & ~nail & (np.abs(u - (uj + du)) < 0.5) & (X - 0.5 >= right - 3)] = OUTLINE
    for uc, k in zip(CREASES, creases):
        if k > 0.1:
            n = round(1 + 5 * k)
            arr[ins & (np.abs(u - uc) < 0.5) & (X - 0.5 <= left + n)] = OUTLINE
            arr[ins & (np.abs(u - (uc - 1)) < 0.5) & (X - 0.5 <= left + 3)] = TEXT
    if surf is not None:
        arr[ins & (np.abs(Y - 0.5 - surf) < 0.5)] = LABEL
    m = grow(ins)[P:-P, P:-P]
    full[m] = arr[P:-P, P:-P][m]


# ---------------- 욕조 옆 단면(배율 1) ----------------
SURF, RIM, FLOOR = 130, 112, 306        # 수면, 욕조 테두리 위, 욕조 바닥
WALLS = ((40, 48), (470, 478))
_rng = np.random.default_rng(13)
STEAM = [(int(x), float(p)) for x, p in zip(_rng.integers(52, 466, 46), _rng.random(46))]
MOTES = [(int(x), int(y), float(p)) for x, y, p in zip(_rng.integers(52, 466, 70), _rng.integers(140, 300, 70), _rng.random(70))]
DUST = [(int(x), int(y), float(p)) for x, y, p in zip(_rng.integers(2, 86, 16), _rng.integers(0, 320, 16), _rng.random(16))]


def _put(arr, X0, Y0, x, y, w, h, col):
    h0, w0 = arr.shape[:2]
    a, b = max(0, y - Y0), min(h0, y - Y0 + h)
    c, d = max(0, x - X0), min(w0, x - X0 + w)
    if a < b and c < d:
        arr[a:b, c:d] = col


def bath(te, X0, Y0, w, h, fingers, drops=(), ripples=()):
    """세계 조각 (X0, Y0, w, h)를 배율 1로 그린다. 살아 있는 배경(김·티끌·수면 아래 결)은 te의 함수이고 낮은 대비다.
    fingers: [(fx, ty, creases)], drops: [(x, y, 크기)], ripples: [(x0, r, 색)]."""
    X, Y = np.meshgrid(X0 + np.arange(w), Y0 + np.arange(h))
    arr = np.empty((h, w, 3), np.uint8)
    arr[:] = BG
    tub = (X > WALLS[0][1]) & (X < WALLS[1][0]) & (Y >= SURF) & (Y < FLOOR)
    arr[((Y % 24 == 0) | (X % 24 == 0)) & ~tub] = CARD                       # 벽 타일
    for x0, p in STEAM:                                                      # 김: 위로 천천히
        y = int(SURF - 6 - (te * 5 + p * 84) % 84)
        _put(arr, X0, Y0, x0 + round(2 * math.sin(te * 0.8 + p * 6)), y, 1, 2, DITHER)
    arr[tub] = DEEP
    deep = tub & (Y >= SURF + 30) & (BAYER[Y % 4, X % 4] < (Y - SURF - 30) / 150 * 16)   # 깊을수록 보라 디더(한 톤으로 뭉개지지 않게)
    arr[deep] = DITHER
    for x0, y0, p in MOTES:                                                  # 물속 티끌(손가락 뒤)
        _put(arr, X0, Y0, x0 + round(6 * math.sin(te * 0.25 + p * 9)), y0 + round(3 * math.sin(te * 0.35 + p * 5)), 2, 1, CARD)
    arr[tub & (Y == SURF + 1) & ((X + int(te * 4)) % 13 < 4)] = CARD          # 수면 아래 흐르는 결
    arr[tub & (Y == SURF)] = INK
    for a, b in WALLS:
        wall = (X >= a) & (X <= b) & (Y >= RIM)
        arr[wall] = CARD
        arr[wall & ((X == a) | (Y == RIM))] = LABEL
        arr[wall & (X == b) & (Y > RIM)] = OUTLINE
    floor = (X > WALLS[0][1]) & (X < WALLS[1][0]) & (Y >= FLOOR)
    arr[floor] = CARD
    arr[floor & (Y == FLOOR)] = LABEL
    for x0, r, col in ripples:                                               # 물결 고리: 수면 위 한 줄 볼록
        for x in (x0 - r, x0 + r):
            if WALLS[0][1] < x - 1 and x + 1 < WALLS[1][0]:
                _put(arr, X0, Y0, x - 1, SURF - 1, 3, 1, col)
    for fx, ty, cr in fingers:
        finger(arr, X0, Y0, fx, ty, cr, surf=SURF)
    for x, y, n in drops:
        _put(arr, X0, Y0, x, y, 1, n, TEXT)
    return arr


# ---------------- 마른 공기(배율 1, EMLA 칸) ----------------
def dry(te, w, h, fx, ty, creases, cream):
    """물 없는 무대: BG + DITHER 세로 벽지 줄 + 내려앉는 먼지. 손가락 C(같은 finger())에 크림."""
    X, Y = np.meshgrid(np.arange(w), np.arange(h))
    arr = np.empty((h, w, 3), np.uint8)
    arr[:] = BG
    arr[(X % 11 == 5) & (Y % 3 != 0)] = DITHER
    for x0, y0, p in DUST:
        _put(arr, 0, 0, x0 + round(3 * math.sin(te * 0.5 + p * 7)), int(y0 + te * 3) % h, 2, 1, DITHER)
    finger(arr, 0, 0, fx, ty, creases, cream)
    return arr


# ---------------- 손끝 세로 단면(배율 z에서 바로) ----------------
XN, XV, XB = -9.0, -5.0, 5.0        # 손가락 가운데에서 신경·혈관·뼈 가운데까지(세계 단위)
VESSEL_D = 3.0
BRANCH_U = (24, 17, 10)              # 혈관 → 지문면 갈래 뿌리
NERVE_END, NERVE_BR = 30, 36          # 신경 아래 끝, 신경 → 혈관 갈래 자리
CONTACT_U = NERVE_BR - (XV - VESSEL_D / 2 - XN)   # 갈래가 혈관 벽에 닿는 자리(45°)


def bone_half(u):
    """끝마디뼈(버섯 모양 끝, 관절 면) · 관절 틈 · 가운데마디뼈 · 둘째 틈 · 첫마디뼈의 반폭(0이면 뼈 없음)."""
    d = (u >= 8) & (u < 47)
    tuft = 3 + 1.5 * np.clip(1 - (u - 10) / 5, 0, 1)
    cap = np.sqrt(np.clip((u - 8) / 1.5, 0, 1))
    hb = np.where(d, np.maximum(tuft, 3 + 1.5 * np.clip((u - 40) / 7, 0, 1)) * cap, 0.0)
    head_ = lambda u0: np.minimum(4.5 * np.sqrt(np.clip((u - u0) / 3, 0, 1)), np.maximum(3.5, 4.5 - (u - u0 - 3) / 5))
    m = (u >= 48.5) & (u < 96)
    hb = np.where(m, np.maximum(head_(48.5), np.where(u > 90, 3.5 + (u - 90) / 6, 0)), hb)
    return np.where(u >= 97.5, head_(97.5), hb)


def section(z, ox, oy, w, h, fx, ty, st):
    """세로로 자른 손가락(배율 z, 화면 = (세계 − o)·z). 반환 (rgb, alpha).
    st: shrink 0~1(속살이 줄어 지문면 피부 띠가 안쪽으로 평행 이동), grooves[4](당겨져 파이는 골), narrow(u → 0~1, 혈관이 가늘어진 정도),
    phase(피 점 누적 전진, 세계 단위), signals([(세계 x, 세계 y)] 신호 머리 + 꼬리), lit(골 사이 마루를 TEXT로).
    밝기 순서: 변하는 피부 띠(지문면)·혈관·신호가 밝고, 뼈·손톱·등쪽 피부·속살은 어둡게 물러난다(가장자리 1도트만 밝게)."""
    pad = 2 * z + 2
    xs = ox + (np.arange(-pad, w + pad) + 0.5) / z
    ys = oy + (np.arange(-pad, h + pad) + 0.5) / z
    X, Y = np.meshgrid(xs, ys)
    u = ty - Y
    hl0, hr = half_l(u), half_r(u)
    prof = np.where((u > 4) & (u < 50), np.sin(np.pi * (u - 4) / 46), 0)
    grv = sum(1.5 * g * _bump(u, uc, 2.2) for uc, g in zip(CREASES, st["grooves"]))
    xl = fx - hl0 + 2.5 * st["shrink"] * prof + grv
    S = (u >= 0) & (X >= xl) & (X <= fx + hr)
    band = S & ~erode(S, 2 * z)
    inner = S & ~band
    arr = np.zeros(S.shape + (3,), np.uint8)
    arr[S] = CARD
    xin, xlim = xl + 2, fx - 10.5                                             # 지방 덩이: 줄어든 폭에 맞춰 눌린다
    width0 = (fx - 10.5) - (fx - hl0 + 2)
    p = (X - xin) / np.maximum(xlim - xin, 0.5)
    lob = np.zeros_like(S)
    for col, pc in enumerate((0.3, 0.75)):
        for uc in np.arange(8 + 3 * col, 48, 6):
            dd = np.sqrt(((p - pc) * width0) ** 2 + (u - uc) ** 2)
            lob |= (dd >= 1.1 - 1 / z) & (dd < 1.1)
    arr[lob & inner & (X < xlim) & (p > 0) & (z >= 3)] = DITHER
    hb = bone_half(u)                                                         # 뼈: DITHER 면, 왼쪽·위 LABEL, 오른쪽·아래 OUTLINE
    bone = inner & (np.abs(X - (fx + XB)) <= hb) & (hb > 0)
    arr[bone] = DITHER
    arr[bone & (~nb(bone, 1, 0) | ~nb(bone, 0, 1))] = OUTLINE
    arr[bone & (~nb(bone, -1, 0) | ~nb(bone, 0, -1))] = LABEL
    out1 = edge_out(S)
    in1 = band & grow(inner)
    padz = (X < fx - 2) & (u < 54)
    arr[band] = DEEP                                                          # 등쪽 피부: 어둡게, 바깥 1도트 INK
    arr[band & out1] = INK
    arr[band & in1] = OUTLINE
    hot = band & padz                                                         # 지문면 피부 띠: INK, 바깥 TEXT, 안쪽 DEEP
    arr[hot] = INK
    arr[hot & in1] = DEEP
    arr[hot & out1] = TEXT
    if st.get("lit"):
        ridge = hot & (u > 9) & (u < 41) & (grv < 0.4) & ~in1
        arr[ridge] = TEXT
    nail = S & (u >= NAIL0) & (u <= NAIL1) & (X >= fx + hr - 2.0)               # 손톱 판: DITHER 면 + 안팎 LABEL 선(판으로 읽히게), 자유연 TEXT, 큐티클 OUTLINE
    arr[nail] = DITHER
    arr[nail & (~nb(nail, -1, 0) | out1)] = LABEL
    arr[nail & ~nb(nail, 0, -1)] = OUTLINE
    arr[nail & (u < NAIL0 + 0.6)] = TEXT
    sx = lambda wx: int(math.floor((wx - ox) * z)) + pad                     # 세계 x → 확장 배열 열
    sy = lambda wy: int(math.floor((wy - oy) * z)) + pad
    H2, W2 = S.shape
    ncol = (sx(fx + XN - 0.5), sx(fx + XN + 0.5))                             # 신경: LABEL 1도트 두 줄 + 45° 갈래
    rows = np.arange(H2)
    nrow = rows[(ty - (oy + (rows - pad + 0.5) / z) >= NERVE_END)]
    for c in ncol:
        if 0 <= c < W2:
            arr[nrow, c] = np.where(inner[nrow, c][:, None], LABEL, arr[nrow, c])
    bx, by, nbr = sx(fx + XN), sy(ty - NERVE_BR), round((XV - VESSEL_D / 2 - XN) * z)
    for i in range(nbr + 1):
        if 0 <= by + i < H2 and 0 <= bx + i < W2:
            arr[by + i, bx + i] = LABEL
    n = st["narrow"](u)                                                       # 혈관: INK 1도트 벽 + DEEP 속, 가늘어진다(넓어지지 않는다)
    dv = np.maximum(VESSEL_D - 1.5 * n, 4 / z)
    dx = np.abs(X - (fx + XV))
    vz = inner & (u >= 8) & (dx < dv / 2)
    arr[vz] = INK
    lumen = vz & (dx < dv / 2 - 1 / z) & (u >= 8 + 1 / z)
    arr[lumen] = DEEP
    for ub in BRANCH_U:                                                       # 지문면 쪽 45° 갈래 3개
        nr = float(st["narrow"](np.array(ub)))
        root = fx + XV - (VESSEL_D - 1.5 * nr) / 2
        a, b = root - X, ub - u
        hw = max(0.7 * (1.5 - 0.75 * nr), 1.5 / z)
        tube = inner & (np.abs(a - b) < hw) & (a + b >= -1) & (a + b <= 6)
        arr[tube & ~vz] = INK
        arr[tube & (np.abs(a - b) < hw - 1 / z) & (a + b >= 0)] = DEEP
    cx = sx(fx + XV)                                                          # 피 점: 혈관 가운데를 손끝 쪽으로
    per, ph = 2 * z, int(round((st["phase"] - oy) * z))                       # 세계에 붙은 점(카메라가 움직여도 미끄러지지 않는다)
    for r in range(H2 - 1):
        if lumen[r, cx] and lumen[r, cx - 1] and lumen[r + 1, cx - 1] and (r - pad - ph) % per == 0:
            arr[r:r + 2, cx - 1:cx + 1] = LABEL
    for kx, ky, sz in st["signals"]:                                         # 신호: INK 점(머리 3×3, 꼬리 2×2)
        c0, r0 = sx(kx) - sz // 2, sy(ky) - sz // 2
        arr[max(0, r0):max(0, r0 + sz), max(0, c0):max(0, c0 + sz)] = INK
    ghost = np.zeros_like(S)                                                  # 유령선: 원래 겉면 자리(LABEL 점선)
    gcol = np.floor((fx - hl0[:, 0] - ox) * z).astype(int) + pad
    moved = (2.5 * st["shrink"] * prof[:, 0] + grv[:, 0]) * z > 0.6
    for r in np.nonzero(moved & ((rows // 2) % 2 == 0))[0]:
        c = gcol[r]
        if 0 <= c < W2 and not S[r, c]:
            ghost[r, c] = True
    arr[ghost] = LABEL
    a = S | ghost
    return arr[pad:pad + h, pad:pad + w], a[pad:pad + h, pad:pad + w]


def section_bg(te, z, ox, oy, w, h):
    """단면을 볼 때의 둘레(배율 z에서 바로): 공기 BG + 1도트 타일, 수면 INK, 물 DEEP + 깊을수록 DITHER(세계에 붙은 1도트 Bayer),
    물속 티끌은 피부와 나란히 위아래로만 떠다닌다(피부에 닿지 않게 손가락이 위에 덮인다)."""
    px = np.floor(ox * z).astype(int) + np.arange(w)
    py = np.floor(oy * z).astype(int) + np.arange(h)
    PX, PY = np.meshgrid(px, py)
    Y = (PY + 0.5) / z
    arr = np.empty((h, w, 3), np.uint8)
    arr[:] = BG
    air = Y < SURF
    arr[air & ((PY % (24 * z) == 0) | (PX % (24 * z) == 0))] = CARD
    water = ~air
    arr[water] = DEEP
    arr[water & (BAYER[PY % 4, PX % 4] < (Y - SURF - 30) / 150 * 16)] = DITHER
    arr[water & (PY // z == SURF) & (PY % z == 0)] = INK
    for x0, y0, p in MOTES[::2]:
        x = round((x0 * 0.4 + 40 - ox) * z)                                   # 세계 x 40~226에 흩어 둔다
        y = round((y0 + 6 * math.sin(te * 0.4 + p * 9) - oy) * z)
        if 0 <= x < w - 1 and 0 <= y < h and y0 + 6 * math.sin(te * 0.4 + p * 9) > SURF + 2:
            arr[y, x:x + 2] = CARD
    return arr


def signal_pts(fx, ty, y0, s, z):
    """신경 위 y0에서 출발해 s(세계 단위)만큼 내려온 신호: 머리 + 꼬리 두 점의 (세계 x, 세계 y, 크기). 갈래에서 45°로 혈관 벽까지 간다."""
    L1 = (ty - NERVE_BR) - y0
    L2 = (XV - VESSEL_D / 2 - XN) * math.sqrt(2)
    out = []
    for back, sz in ((0, 3), (5 / z, 2), (10 / z, 2)):
        q = s - back
        if q < 0 or q > L1 + L2:
            continue
        if q <= L1:
            out.append((fx + XN, y0 + q, sz))
        else:
            e = (q - L1) / math.sqrt(2)
            out.append((fx + XN + e, ty - NERVE_BR + e, sz))
    return out


def signal_len(ty, y0):
    return (ty - NERVE_BR) - y0 + (XV - VESSEL_D / 2 - XN) * math.sqrt(2)


# ---------------- 화면 부품 ----------------
def tag(img, x, y, text, font="label", border=E.LABEL, lit=True, level=2):
    """이름표: CARD 판 + 테두리 + 글자(lit이면 TEXT, 아니면 LABEL). level 1은 테두리만, 0은 없음(거둘 때 판 → 테두리 → 없음)."""
    if level <= 0:
        return None
    th = 10 if font == "label" else 12
    box = (x, y, x + E.text_w(text, font) + 5, y + th + 3)
    d = ImageDraw.Draw(img)
    if level >= 2:
        d.rectangle(box, fill=E.CARD, outline=border)
        E.text(img, (x + 3, y + 1), text, font, E.TEXT if lit else E.LABEL, shadow=False)
    else:
        d.rectangle(box, outline=border)
    return box


def leader(d, p0, p1):
    D.line(d, p0, p1, E.LABEL)


def arrow_h(d, x, y, n, col=E.INK):
    """오른쪽(뼈 쪽)을 가리키는 도트 화살표: 1도트 몸통 n + 머리(깊이 3, 폭 5)."""
    d.line((x, y, x + n - 1, y), fill=col)
    head(d, x + n + 2, y, 1, 0, col)


def down_arrow(d, x, y, n, te):
    """아래 화살표(혈류 감소): 2도트 몸통 n + 폭 8·깊이 4 머리. 다 자란 뒤 몸통 안을 TEXT 점이 12fps 1도트씩 내려간다(흐름)."""
    if n < 1:
        return
    d.rectangle((x, y, x + 1, y + n - 1), fill=E.INK)
    for k in range(4):
        d.line((x - 3 + k, y + n + k, x + 4 - k, y + n + k), fill=E.INK)
    if n >= 6:
        k = int(te * 12) % (n - 1)
        d.rectangle((x, y + k, x + 1, y + k + 1), fill=E.TEXT)


def pillow(img, cx, cy, u, folds):
    """베개 48×28: 네 모서리 자리는 그대로이고(겉감 크기), u 0(꽉 참: 네 변이 2도트 볼록) → 1(꺼짐: 3도트 오목). TEXT 면, 아래·오른쪽 LABEL 그늘
    (꺼질수록 넓어진다), OUTLINE 테두리. folds[4]: 귀에서 가운데로 자라는 45° OUTLINE 주름(0~1)."""
    a, b = 24, 14
    xs, ys = np.meshgrid(np.arange(-a - 3, a + 4) + 0.5, np.arange(-b - 3, b + 4) + 0.5)
    bt, bs = 2 * (1 - u) - 3 * u, 1.5 * (1 - u) - 3 * u
    ins = (np.abs(ys) <= b + bt * (1 - (xs / a) ** 2)) & (np.abs(xs) <= a + bs * (1 - (ys / b) ** 2))
    arr = np.zeros(ins.shape + (3,), np.uint8)
    arr[ins] = TEXT
    sh = round(2 + 2 * u)
    shade = ins & ~(nb(ins, sh, 0) & nb(ins, 0, sh) & nb(ins, sh, sh))
    arr[shade & ((xs + ys) % 2 < 1) | (shade & ~(nb(ins, 2, 0) & nb(ins, 0, 2)))] = LABEL
    ring = grow(ins) & ~ins
    arr[ring] = OUTLINE
    alpha = ins | ring
    pic = Image.fromarray(arr)
    mask = Image.fromarray((alpha * 255).astype(np.uint8))
    img.paste(pic, (cx - a - 3, cy - b - 3), mask)
    d = ImageDraw.Draw(img)
    for (sxn, syn), k in zip(((-1, -1), (1, -1), (-1, 1), (1, 1)), folds):
        n = round(6 * k)
        if n >= 2:
            x0, y0 = cx + sxn * (a - 3), cy + syn * (b - 3)
            d.line((x0, y0, x0 - sxn * (n - 1), y0 - syn * (n - 1)), fill=E.OUTLINE)
