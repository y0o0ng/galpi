"""13편 도트 그림: 손끝(finger — 훅·욕조·비교 카드가 같은 함수·같은 비례), 욕조 무대(bath), 손끝 속 단면 무대(section), 비교 카드 무대(proof_card).
무대마다 바탕이 다르다: 공기 BG · 물 DEEP · 몸속 CARD+DITHER 결. 진행 중인 과정은 12fps로 끊은 시각 ta의 연속 함수다."""
import math
from functools import lru_cache

import numpy as np
from PIL import Image

from px import draw as D, engine as E
from px.templates import flow, head
from px.timeline import ease_in_out, span

STAGE_H = 250                                    # 자막 상자(y 252~) 위 그림 영역
SKIN, SKIN_D = E.PEOPLE_COLORS[0], E.PEOPLE_COLORS[1]      # 사람 몸은 피부색(warm)
NAIL, NAIL_D = E.PEOPLE_COLORS[8], E.PEOPLE_COLORS[9]      # 손톱은 muted 짝


def _rgb(c):
    return np.array([int(c[i:i + 2], 16) for i in (1, 3, 5)], np.uint8)


RGB = {c: _rgb(c) for c in (E.BG, E.DITHER, E.INK, E.DEEP, E.TEXT, E.LABEL, E.PURPLE, E.CARD, E.OUTLINE, SKIN, SKIN_D, NAIL, NAIL_D)}


# ---------------- 손끝: 같은 물건은 같은 함수·같은 비례 ----------------
GROOVES, LEVELS = 4, 3                            # 홈 4개, 홈마다 깊이 3단 → 주름 단계 s = 0..12


@lru_cache(None)
def finger_layer(w, h, s):
    """끝이 아래인 손끝 RGBA (너비 w+6, 높이 h+1). 위는 잘려 손가락 뿌리로 이어진다. 끝은 반원, 오른쪽에 손톱.
    주름 단계 s: 아래 홈부터 가로 주름 선이 생기고(1단), 선 밑에 그늘 점줄(2단), 윤곽이 1도트 파인다(3단)."""
    rx = w // 2
    yc = h - 1 - rx
    sp = max(6, round(rx * 0.55))
    base = h - 1 - max(4, round(rx * 0.4))
    deps = [min(LEVELS, max(0, s - LEVELS * k)) for k in range(GROOVES)]
    ind = [0] * h
    for k, dep in enumerate(deps):
        if dep == LEVELS:
            ind[base - k * sp] = 1
    px = np.zeros((h + 1, w + 6, 4), np.uint8)
    cx = rx + 3
    skin, dark, nail, nail_d = (*RGB[SKIN], 255), (*RGB[SKIN_D], 255), (*RGB[NAIL], 255), (*RGB[NAIL_D], 255)
    spans = []
    for y in range(h):
        hw = rx if y <= yc else max(1, int(math.sqrt(rx * rx - (y - yc) ** 2) + .5))
        l, r = cx - hw + ind[y], cx + hw - 1 - ind[y]
        spans.append((l, r))
        px[y, l:r + 1] = skin
        px[y, max(l, r - 2):r + 1] = dark                  # 오른쪽 그림자 3도트
        if y >= h - 3:
            px[y, l:r + 1] = dark
    y0, y1 = max(0, yc - 16), min(h - 1, yc + 4)           # 손톱: 윤곽선이 있는 얇은 판
    for y in range(y0, y1 + 1):
        r = spans[y][1]
        px[y, r - 7] = nail_d
        px[y, r - 6:r - 2] = nail
    for x in range(spans[y0][1] - 7, spans[y0][1] - 2):
        px[y0 - 1, x] = nail_d
    for x in range(spans[y1][1] - 7, spans[y1][1] - 2):
        px[y1 + 1, x] = nail_d
    for k, dep in enumerate(deps):                         # 가로 주름: 4도트마다 한 줄씩 어긋나는 선 + 밑에 그늘 점줄
        if dep:
            yk = base - k * sp
            l, r = spans[yk]
            for x in range(l + 2, r - 2):
                yy = yk + ((x - l) // 4) % 2
                px[yy, x] = dark
                if dep >= 2 and (x - l) % 2 == 0 and yy + 2 < h:
                    px[yy + 2, x] = dark
    a = px[..., 3] > 0
    n = np.zeros_like(a)
    n[1:] |= a[:-1]
    n[:-1] |= a[1:]
    n[:, 1:] |= a[:, :-1]
    n[:, :-1] |= a[:, 1:]
    px[n & ~a] = (*RGB[E.OUTLINE], 255)
    return Image.fromarray(px, "RGBA")


def finger(w, h, s, orient="down"):
    """orient: down(끝이 아래) · up(끝이 위, 물 위로 솟음) · right(끝이 오른쪽, 손톱이 위)."""
    im = finger_layer(w, h, s)
    if orient == "up":
        return im.transpose(Image.FLIP_TOP_BOTTOM)
    if orient == "right":
        return im.transpose(Image.ROTATE_90)
    return im


def train(head, period, n):
    """신호 점열: 맨 앞이 head까지 나아간 뒤 간격 period로 n개가 이어진다. 다 차면 같은 간격으로 끝없이 이어 흐른다."""
    if head >= (n - 1) * period:
        return [head % period + j * period for j in range(n)]
    return [head - j * period for j in range(n) if head - j * period >= 0]


def ripples(d, ta, x0, x1, y0, y1, gap, col):
    """물 안의 낮은 대비 물결 줄: 짧은 줄이 12fps로 천천히 옆으로 흐른다."""
    for n, y in enumerate(range(y0, y1, gap)):
        off = (n * 13 + round(ta * 12)) % 34
        for x in range(x0 - 34 + off, x1, 34):
            a, b = max(x0, x), min(x1, x + 7)
            if a <= b:
                d.line((a, y, b, y), fill=col)


def surface(d, ta, x0, x1, y):
    """수면 선: LABEL 점선이 천천히 흐른다."""
    for x in range(x0, x1 + 1):
        if (x + round(ta * 12)) % 12 < 5:
            d.point((x, y), fill=E.LABEL)


# ---------------- 훅: 물 위로 솟은 손끝 둘 ----------------
HOOK_X, HOOK_W, HOOK_H, HOOK_TIP, HOOK_WATER = (30, 76), 30, 76, 122, 190


def hook_art(img, d, ta, s):
    """왼쪽 손끝은 주름이 차츰 잡히고 오른쪽은 매끈하다. 손끝에서 물방울이 옆으로 흘러 물에 떨어지고 물결이 인다."""
    for cx, ss in zip(HOOK_X, (s, 0)):
        layer = finger(HOOK_W, HOOK_H, ss, "up")
        img.paste(layer, (cx - HOOK_W // 2 - 3, HOOK_TIP), layer)
    d.rectangle((0, HOOK_WATER, E.W - 1, STAGE_H - 1), fill=E.DEEP)
    ripples(d, ta, 0, E.W - 1, HOOK_WATER + 12, STAGE_H - 4, 14, E.CARD)
    surface(d, ta, 0, E.W - 1, HOOK_WATER)
    for i, cx in enumerate(HOOK_X):
        local = (ta + 0.9 * i) % 1.9
        x = cx + HOOK_W // 2 + 2
        if local < 1.0:
            y = HOOK_TIP + 14 + round(local * 50)
            d.rectangle((x, y, x + 1, y + 2), fill=E.DEEP)
            d.point((x, y), fill=E.INK)
        elif local < 1.5:
            r = 3 + round((local - 1.0) * 14)
            D.ellipse(d, x, HOOK_WATER + 4, r, 2, outline=E.CARD)


# ---------------- 욕조 무대: 같은 물, 같은 수면 높이에 손끝 둘 ----------------
WATER_Y = 118
BATH_X = (46, 112)                                # 왼쪽(신경 정상)·오른쪽(신경 다침)
F_W, F_H, CH_END = 40, 190, 146                  # 손끝 너비·길이, 신경 길 끝


def bath(img, d, ta, s_left, pulse_t=None, labels=True):
    """공기 BG 위, 물 DEEP 아래. 두 손끝은 같은 물에 같은 깊이로 잠긴다. 안쪽 신경 길에서 신호(INK 점)가 손끝 쪽으로 내려가는 것은 왼쪽만이고,
    주름은 신호가 지난 뒤 왼쪽 끝에서만 잡힌다. pulse_t: 신호가 시작된 뒤 지난 초(None이면 아직)."""
    d.rectangle((0, 0, E.W - 1, STAGE_H - 1), fill=E.BG)
    d.rectangle((0, WATER_Y, E.W - 1, STAGE_H - 1), fill=E.DEEP)
    ripples(d, ta, 0, E.W - 1, WATER_Y + 14, STAGE_H - 4, 16, E.CARD)
    surface(d, ta, 0, E.W - 1, WATER_Y)
    for k, (cx, s) in enumerate(zip(BATH_X, (s_left, 0))):
        layer = finger(F_W, F_H, s)
        img.paste(layer, (cx - F_W // 2 - 3, 0), layer)
        d.rectangle((cx - 2, 0, cx + 1, CH_END), fill=E.CARD)             # 신경 길
        if k == 0 and pulse_t is not None:
            for y in train(round(48 * pulse_t), 26, 6):
                if y <= CH_END - 2:
                    d.rectangle((cx - 1, y, cx, y + 2), fill=E.INK)
        else:
            for y in range(1, CH_END, 4):
                d.point((cx - 1, y), fill=E.DEEP)
                d.point((cx, y + 2), fill=E.DEEP)
    if labels:
        for cx, name, col in zip(BATH_X, ("NERVE OK", "NERVE DAMAGED"), (E.INK, E.LABEL)):
            E.text(img, (cx - E.text_w(name, "label") // 2, 206), name, "label", col)


# ---------------- 손끝 속 단면 무대(핵심): 신경 신호 → 혈관 가늘어짐 → 속살 줄어듦 → 피부 접힘 ----------------
CX, RX, TH = 90, 54, 8                            # 손끝 가운데, 바깥 반너비, 피부 두께
YC, RY, TAPER = 186, 46, 4                        # 끝 반타원 시작·반높이, 끝으로 좁아지는 양
GROOVE_Y = (70, 104, 138, 172)                    # 피부가 접히는 골 자리
VX, V_END, BX = 72, 192, 98                       # 혈관 x, 혈관 끝, 뼈 x
NERVE_PATH = [(126, y) for y in range(0, 41)] + [(x, 40) for x in range(125, VX, -1)]
PULSE_V, PULSE_P, FRONT_V = 60, 22, 55           # 신호 속도(px/s)·간격, 혈관이 가늘어지는 앞쪽의 속도
ARRIVE = len(NERVE_PATH) / PULSE_V                # 첫 신호가 혈관에 닿는 데 걸리는 초
VIEW2 = (16, 44)                                  # ×2 확대 시점 왼쪽 위(세계 좌표), 90x125를 보여 준다


def _sh(m, dy, dx):
    p = np.pad(m, 3, mode="edge")
    return p[3 - dy:3 - dy + m.shape[0], 3 - dx:3 - dx + m.shape[1]]


def _dil(m):
    return m | _sh(m, 1, 0) | _sh(m, -1, 0) | _sh(m, 0, 1) | _sh(m, 0, -1)


def _edge(m):
    return m & ~(_sh(m, 1, 0) & _sh(m, -1, 0) & _sh(m, 0, 1) & _sh(m, 0, -1))


def pad_off(ys, c, A):
    """발바닥 쪽(왼쪽) 피부가 안쪽으로 들어간 정도: c는 전체가 같이 내려간 양, A는 골 깊이(45° 경사라 골 너비도 따라 커진다)."""
    taper = np.clip((ys - 8) / 40, 0, 1)
    fade = np.where(ys <= YC, 1.0, np.clip(1 - (ys - YC) / RY, 0, 1))
    g = np.zeros(len(ys), int)
    for gy in GROOVE_Y:
        g += np.maximum(0, A - np.abs(ys - gy))
    return np.round(c * taper * fade).astype(int) + np.where(ys <= YC, g, 0)


def section_state(tau, t_sig, t_pulp0):
    """장면 시각 tau의 단면 상태. 신호(t_sig) → 혈관 앞쪽이 아래로 가늘어짐 → 속살이 줄어듦(t_pulp0) → 골이 깊어지며 접힘."""
    t_arr = t_sig + ARRIVE
    front = None if tau < t_arr else 40 + FRONT_V * (tau - t_arr)
    c = 5 * ease_in_out(span(tau, t_pulp0, t_pulp0 + 3.0))
    A = 12 * ease_in_out(span(tau, t_pulp0 + 1.5, t_pulp0 + 5.5))
    return {"c": round(c), "A": round(A), "front": front, "sig": None if tau < t_sig else tau - t_sig, "arrive": t_arr}


def section_arr(ta, st):
    ys = np.arange(STAGE_H)
    yy = ys[:, None]
    xs = np.arange(E.W)[None, :]
    c, A, front = st["c"], st["A"], st["front"]
    a = np.empty((STAGE_H, E.W, 3), np.uint8)
    a[:] = RGB[E.CARD]
    a[E.BAYER[yy % 4, xs % 4] < 4] = RGB[E.DITHER]
    k = round(ta * 12)
    for i in range(14):                                          # 조직 사이 떠다니는 입자(낮은 대비)
        a[(i * 47 - 2 * k) % STAGE_H, (i * 53 + 17) % E.W + (k // 6 + i) % 2] = RGB[E.DEEP]
    body = RX - np.round(TAPER * np.minimum(ys, YC) / YC).astype(int)          # 끝으로 갈수록 살짝 좁아진다
    rt = RX - TAPER
    hw = np.where(ys <= YC, body, np.round(rt * np.sqrt(np.clip(1 - ((ys - YC) / RY) ** 2, 0, 1))).astype(int))
    hw = np.where(ys > YC + RY - 1, 0, hw)
    hwi = np.where(ys <= YC, body - TH, np.round((rt - TH) * np.sqrt(np.clip(1 - ((ys - YC) / (RY - TH)) ** 2, 0, 1))).astype(int))
    hwi = np.where(ys > YC + RY - TH - 1, 0, hwi)
    off = pad_off(ys, c, A)
    L, R = CX - hw + off, CX + hw - 1
    Li, Ri = CX - hwi + off, CX + hwi - 1
    outer = (xs >= L[:, None]) & (xs <= R[:, None]) & (hw[:, None] > 0)
    pulp = (xs >= Li[:, None]) & (xs <= Ri[:, None]) & (hwi[:, None] > 0)
    skin = outer & ~pulp
    if c:                                                        # 원래 손끝 자리(점선): 부피가 얼마나 줄었는지
        a[(yy % 4 < 2) & (xs == CX - RX - 1) & (yy >= 12) & (yy <= 205)] = RGB[E.DEEP]
    nail = (xs > R[:, None]) & (xs <= (R + 3)[:, None]) & (yy >= 128) & (yy <= 204) & (hw[:, None] > 0)    # 손톱: 등 쪽에 얹힌 판
    a[_dil(outer | nail) & ~(outer | nail)] = RGB[E.OUTLINE]
    a[skin] = RGB[SKIN]
    a[skin & (xs >= (R - 2)[:, None])] = RGB[SKIN_D]
    a[skin & ~_sh(outer, -3, 0)] = RGB[SKIN_D]
    a[skin & _dil(pulp)] = RGB[SKIN_D]
    a[nail] = RGB[NAIL]
    a[nail & (xs == (R + 3)[:, None])] = RGB[NAIL_D]
    a[pulp] = RGB[E.DEEP]
    shade = pulp & (~_sh(pulp, 0, -3) | ~_sh(pulp, -3, 0)) & ((xs + yy) % 2 == 0)
    a[shade] = RGB[E.CARD]
    a[_edge(pulp)] = RGB[E.INK]                                  # 속살 경계: 줄어드는 것이 이 선이다
    hwb = np.zeros(len(ys), int)                                 # 뼈: 어둡게 물러난 구조물
    for y in range(62, 180):                                     # 끝마디뼈: 위는 둥근 머리, 허리, 아래는 넓은 끝
        if y < 78:
            hwb[y] = round(16 * math.sqrt(max(0, 1 - ((78 - y) / 16) ** 2)))
        elif y < 94:
            hwb[y] = 16
        elif y < 100:
            hwb[y] = 16 - (y - 94)
        elif y < 140:
            hwb[y] = 10
        elif y < 145:
            hwb[y] = 10 + (y - 140)
        elif y < 166:
            hwb[y] = 15
        else:
            hwb[y] = round(15 * math.sqrt(max(0, 1 - ((y - 166) / 14) ** 2)))
    bone = (xs >= (BX - hwb)[:, None]) & (xs <= (BX + hwb - 1)[:, None]) & (hwb[:, None] > 0)
    a[bone] = RGB[E.CARD]
    a[bone & (~_sh(bone, 0, 1) | ~_sh(bone, 1, 0))] = RGB[E.LABEL]
    a[bone & (~_sh(bone, 0, -1) | ~_sh(bone, -1, 0))] = RGB[E.OUTLINE]
    n = np.clip(((front if front is not None else -99) - ys) / 14, 0, 1)      # 혈관: 앞쪽이 지나간 곳부터 가늘어진다
    half = (3 + 2 * np.round(3 * (1 - n)).astype(int)) // 2
    half = np.where(ys > V_END - 3, half - (ys - (V_END - 3)), half)
    vess = (np.abs(xs - VX) <= half[:, None]) & (yy <= V_END) & (half[:, None] >= 0)
    a[_dil(vess) & ~vess & pulp] = RGB[E.OUTLINE]
    a[vess] = RGB[E.PURPLE]
    ph = k * 3
    for j in range(14):                                          # 피 흐름: 혈관 안 밝은 점이 아래로
        y = (ph + 14 * j) % 196
        if y <= V_END - 4:
            ww = max(1, 2 * int(half[y]) + 1 - 4)
            a[y:y + 2, VX - ww // 2:VX - ww // 2 + ww] = RGB[E.TEXT]
    for i, (x, y) in enumerate(NERVE_PATH):                      # 신경 길(점선) + 신호
        if i % 2 == 0:
            a[y, x] = RGB[E.LABEL]
    if st["sig"] is not None:
        for i in train(int(PULSE_V * st["sig"]), PULSE_P, 5):
            if i < len(NERVE_PATH):
                x, y = NERVE_PATH[i]
                a[y - 1:y + 2, x - 1:x + 2] = RGB[E.INK]
    return a


def section(img, d, ta, st, zoom=False):
    """단면을 img에 붙인다. zoom이면 VIEW2에서 정수 2배 확대한 것을 붙인다(배율이 바뀌는 순간은 호출하는 쪽에서 컷)."""
    a = section_arr(ta, st)
    if zoom:
        x0, y0 = VIEW2
        a = a[y0:y0 + STAGE_H // 2, x0:x0 + E.W // 2].repeat(2, 0).repeat(2, 1)
    img.paste(Image.fromarray(a), (0, 0))


def _dots(d, x0, x1, y, col):
    for x in range(x0, x1 + 1, 2):
        d.point((x, y), fill=col)


def section_labels(img, d, st, names, zoom=False):
    """names: 지금까지 나온 라벨 이름 집합. 글자·지시선은 화면 좌표(확대하지 않는다)."""
    if not zoom:
        if "NERVE" in names:
            E.text(img, (148, 11), "NERVE", "label", E.INK)
            _dots(d, 129, 146, 18, E.INK)
        if "VESSEL" in names:
            E.text(img, (1, 96), "VESSEL", "label", E.PURPLE)
            _dots(d, 40, 66, 103, E.PURPLE)
        if "PULP" in names:
            E.text(img, (148, 96), "PULP", "label", E.INK)
            _dots(d, 122, 146, 103, E.INK)
            if st["c"]:
                d.line((162, 114, 162, 126), fill=E.INK)
                head(d, 162, 130, 0, 1, E.INK)
        return
    ys = np.array([87, 104])
    offs = pad_off(ys, st["c"], st["A"])
    for name, y, o, ly in zip(("SKIN", "FOLD"), ys, offs, (82, 116)):
        if name in names:
            sx, sy = (CX - RX + int(o) + 3 - VIEW2[0]) * 2, (int(y) - VIEW2[1]) * 2
            E.text(img, (2, ly - 5), name, "label", E.TEXT)
            _dots(d, 30, sx, sy, E.TEXT)


# ---------------- 비교 카드 무대: WATER / EMLA ----------------
def proof_card(img, d, ta, y, s, wet, cream_t=None, flow_u=None, number=None):
    """카드(152x70) 안 무대. wet이면 아래쪽이 물(DEEP), 아니면 공기(BG)뿐이다. 손끝은 가로로 누워 끝이 오른쪽.
    cream_t: 크림을 바른 뒤 지난 초(손끝 끝마디에만 번진다, LABEL 색 점무늬). flow_u: FLOW 화살표가 뻗은 정도(None이면 안 보임)."""
    d.rectangle((15, y + 1, 165, y + 69), fill=E.BG)
    if wet:
        d.rectangle((15, y + 22, 165, y + 69), fill=E.DEEP)
        ripples(d, ta, 15, 165, y + 30, y + 68, 12, E.CARD)
        surface(d, ta, 15, 165, y + 22)
    arr = np.array(finger(28, 100, s, "right"))
    if cream_t is not None and cream_t >= 0.3:
        u = ease_in_out(span(cream_t, 0.3, 1.5))
        lo = 100 - round(38 * u)
        yy, xx = np.mgrid[0:arr.shape[0], 0:arr.shape[1]]
        m = (xx >= lo) & (arr[..., :3] == RGB[SKIN]).all(-1) & ((xx + yy) % 2 == 0)
        arr[m, :3] = RGB[E.LABEL]
    layer = Image.fromarray(arr, "RGBA")
    img.paste(layer, (16, y + 23), layer)
    if cream_t is not None and 0 <= cream_t < 0.3:
        by = y + 6 + round(cream_t / 0.3 * 16)
        d.rectangle((102, by, 106, by + 3), fill=E.LABEL)
    if flow_u is not None:
        d.rectangle((24, y + 39, 98, y + 41), fill=E.CARD)
        flow(d, ta, ((28, y + 40), (94, y + 40)), E.INK, flow_u)
        E.text(img, (121, y + 35), "FLOW", "label", E.LABEL)
    if number:
        E.text(img, (162 - E.text_w(number, "label"), y + 8), number, "label", E.TEXT)
    if not wet:
        E.text(img, (22, y + 57), "NO WATER", "label", E.LABEL)
