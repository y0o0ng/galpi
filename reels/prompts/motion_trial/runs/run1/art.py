"""13편 그림: 욕조 하나의 옆 단면 세계. 세계는 도형 함수 묶음이고, 카메라(cam.py)가 매 프레임 세계 좌표에서 도트로 다시 그린다
(비트맵을 늘리는 게 아니라 다시 그려서 정수배가 아닌 배율에서도 도트 크기가 섞이지 않는다 — 선은 늘 1도트, 면만 커진다).
손가락 하나(바깥 `outer`, 단면 `section`)·베개·이름표가 이 편의 부품이다. 모든 시각은 편 절대 시각이다."""
import math

import numpy as np
from PIL import Image, ImageDraw

from cam import P, cam_at
from px import draw, engine as E
from px.templates import head
from px.timeline import ease_in_out, ease_out, span

FX = {"C": 40, "A": 160, "B": 245, "H": 380}            # 손가락 가운데 x(세계). 위(화면 밖의 손)에서 곧게 내려오고 끝이 아래다
SURF, TUB_TOP, TUB_BOTTOM = 128, 118, 300               # 수면·욕조 벽 위·물 바닥
WALLS = ((88, 98), (460, 470))
CREASE_U = (46, 36, 26, 16)                             # 주름·골의 끝에서부터 높이, 위에서 아래 순서
NERVE_DX, VESSEL_DX = -15, -8                           # 단면 안 신경·혈관 x(손가락 가운데 기준)
T0 = {}                                                 # 장면 id → 편 절대 시작 시각


def set_starts(starts):
    T0.update(starts)


def _smooth(x):
    x = min(max(x, 0.0), 1.0)
    return x * x * (3 - 2 * x)


# ---------------------------------------------------------------- 상태(편 절대 시각의 함수)
def _creases(t, t0, gap, dur):
    return [span(t, t0 + gap * k, t0 + gap * k + dur) for k in range(4)]


def state(te):
    """손가락별 바깥 상태: tip(끝 세계 y), creases[4](0~1), cream(0~1)."""
    h, c, p = te - T0["hook"], te - T0["clue"], te - T0["proof"]
    tip = 120 + 80 * ease_out(span(c, 3.7, 4.6))        # A·B: 한 손으로 같은 순간 같은 깊이까지
    return {"H": dict(tip=200 - 90 * ease_out(span(h, 2.0, 2.9)), creases=_creases(h, 0.4, 0.4, 0.6), cream=0.0),
            "A": dict(tip=tip, creases=_creases(c, 5.9, 0.4, 0.4), cream=0.0),
            "B": dict(tip=tip, creases=[0.0] * 4, cream=0.0),
            "C": dict(tip=200, creases=_creases(p, 3.9, 0.4, 0.4), cream=span(p, 2.4, 3.6))}


def sec_state(te):
    """A 끝마디 단면 상태(inside 시각 i 기준)."""
    i, f = te - T0["inside"], te - T0["finale"]
    return dict(shrink=ease_in_out(span(i, 4.0, 6.4)),
                grooves=[ease_out(span(i, 8.68 + 0.4 * k, 9.18 + 0.4 * k)) for k in range(4)],
                arrows=[8.43 + 0.4 * k <= i < 16.13 for k in range(4)],
                pre_arrows=4.0 <= i < 7.0,
                constrict=ease_out(span(i, 2.8, 3.8)),
                nerve_lit=i >= 2.0 or te >= T0["proof"],
                crest_lit=f >= 2.8)


def wipe_line(te):
    """단면 가로줄의 화면 y: 이 줄 위쪽은 단면, 아래쪽은 바깥 모습. inside에서 열리고 proof에서 닫히고 finale에서 다시 열린다."""
    i, p, f = te - T0["inside"], te - T0["proof"], te - T0["finale"]
    if te < T0["proof"] + 0.4:
        return 330 * span(i, 0.8, 1.6)
    if te < T0["finale"] + 0.4:
        return 330 * (1 - span(p, 0.4, 1.0))
    return 330 * span(f, 0.4, 1.0)


_PH = [0.0]


def blood(te):
    """피 점의 (누적 전진 도트, 주기). 조이기 전엔 프레임당 2도트·5도트 간격, 조인 뒤엔 1도트·8도트 간격으로 느려진다."""
    k = max(0, int((te - T0["inside"]) * 12 + 1e-6))
    while len(_PH) <= k:
        j = len(_PH) - 1
        _PH.append(_PH[-1] + ((2 - span(j / 12, 3.0, 3.8)) if j >= 12 else 0))
    ct = span(k / 12, 3.0, 3.8)
    return _PH[k], round(5 + 3 * ct)


def pulses(te):
    """신호 점선 목록: [(시작 절대 시각, 길이 초, 출발 세계 y 또는 None=화면 위 가장자리)]."""
    i, f = T0["inside"], T0["finale"]
    out = [(i + 2.0 + 0.8 * k, 0.8, None) for k in range(18)]
    out += [(f + 1.0, 1.6, 8)] + [(f + 3.4 + 1.2 * k, 1.6, 8) for k in range(7)]
    return out


# ---------------------------------------------------------------- 손가락 윤곽(세계 단위, 가운데 기준)
def _tipe(u):
    return math.sqrt(max(0.0, 1 - ((16 - u) / 16) ** 2)) if u < 16 else 1.0


def outline_x(u, cr=None):
    """끝에서 u 위의 (왼쪽, 오른쪽) x. 두께 44, 지문면(왼쪽)이 끝에서 10~40 구간 3단위 볼록, 끝마디 손톱 쪽 3단위 가늘다,
    첫마디 관절(u 55)에 양쪽 2단위 홈, cr(깊이 0~1 네 개)이면 지문면에 최대 3단위 주름 홈."""
    e = _tipe(u)
    bulge = 3 * _smooth((u - 10) / 6) * _smooth((40 - u) / 6)
    inset = 3 * _smooth((36 - u) / 6)
    notch = 2 * max(0.0, 1 - min(abs(u - 55), abs(u - 125), abs(u - 195)) / 3)
    xl, xr = -(22 + bulge) * e + notch, (22 - inset) * e - notch
    for uk, c in zip(CREASE_U, cr or ()):
        xl += 3.0 * c * max(0.0, 1 - abs(u - uk) / 2.5)
    return xl, xr


def _layer():
    return Image.new("RGBA", (E.W, E.H), (0, 0, 0, 0))


def _paste(img, lay, y0, y1):
    y0, y1 = max(0, int(y0)), min(E.H, int(y1))
    if y1 > y0:
        c = lay.crop((0, y0, E.W, y1))
        img.paste(c, (0, y0), c)


def outer(cam, fx, tip, cr, cream):
    """★ 손가락 바깥 모습(RGBA 층). INK 면, 왼쪽 가장자리 TEXT·오른쪽 가장자리 DEEP, 바깥 OUTLINE 1도트, 끝마디 오른쪽 손톱(LABEL 판),
    첫마디 관절 홈·가로줄, 지문면 주름 4줄(홈 + 안쪽 가로선). cream: 끝에서 첫마디 관절까지 번지는 크림 막."""
    lay = _layer()
    d = ImageDraw.Draw(lay)
    z = cam.z
    base = 90 + (fx - cam.cx) * z
    X = lambda dx: round(base + dx * z)
    row = lambda u: round((tip - u - cam.cy) * z + 125)           # 높이 u의 화면 행
    ymax = min(E.H - 1, row(-2.5))
    nw = max(4, round(3 * z))                                       # 손톱 판 두께(도트)
    glints = [r_ for r_ in (8, 16, 24) if r_ <= 55 * cream]
    for sy in range(0, ymax + 1):
        u = tip - ((sy - 125) / z + cam.cy)
        if u >= 0:
            xl, xr = outline_x(u, cr)
            l, r = X(xl), X(xr)
            d.line((l - 1, sy, r + 1, sy), fill=E.OUTLINE)
            d.line((l, sy, r, sy), fill=E.INK)
            d.point((l, sy), fill=E.TEXT)
            d.point((r, sy), fill=E.DEEP)
            if z >= 2 and r - l >= 24:                              # 넓은 면은 오른쪽 그림자 안쪽에 체크 디더
                for x in range(r - 4, r):
                    if (x + sy) % 2 == 0:
                        d.point((x, sy), fill=E.DEEP)
            if 3 <= u <= 29:                                        # 손톱: 오른쪽 윤곽 안쪽에 두께 4도트 판
                d.line((r - nw + 1, sy, r, sy), fill=E.LABEL)
            if 3 <= u < 3 + 2 / z:
                d.line((r - nw + 1, sy, r, sy), fill=E.TEXT)        # 자유연 2줄
        if cream > 0 and -4 / z <= u <= 55 * cream:                 # 크림 막: 윤곽 위에 얹은 LABEL 단색, 두께 4도트
            xl, xr = outline_x(max(u, 1.0), cr)
            l, r = X(xl), X(xr)
            if u < 0:                                               # 손끝 아래 마감
                d.line((l, sy, r, sy), fill=E.LABEL)
                continue
            d.line((l - 2, sy, l - 2, sy), fill=E.TEXT)             # 지문면: 바깥 TEXT 광택 · 안쪽 OUTLINE
            d.line((l - 1, sy, l, sy), fill=E.LABEL)
            d.point((l + 1, sy), fill=E.OUTLINE)
            if 3 <= u <= 29:                                        # 손톱 쪽은 판과 구별되게 윤곽 밖 2도트 얇은 막
                d.line((r + 1, sy, r + 2, sy), fill=E.LABEL)
                if any(abs(u - g) < 1.0 / z + 0.5 for g in glints):
                    d.line((r + 1, sy, r + 2, sy), fill=E.TEXT)
            else:
                d.point((r + 1, sy), fill=E.TEXT)
                d.line((r - 1, sy, r, sy), fill=E.LABEL)
                d.point((r - 2, sy), fill=E.OUTLINE)
            if u > 55 * cream - 1.0 / z - 0.5:                      # 번져 올라가는 앞 가장자리
                d.line((l - 2, sy, r + 1, sy), fill=E.TEXT)
    for uk, c in zip(CREASE_U, cr):
        if c <= 0.05:
            continue
        y = row(uk)
        xl, _ = outline_x(uk, cr)
        d.line((X(xl), y, X(xl) + min(6, round(14 * c * z)), y), fill=E.OUTLINE)       # 홈에서 안쪽으로 최대 6도트
    for uj in (53.5, 56.5, 123.5, 126.5, 193.5, 196.5):             # 관절(55·125·195) 가로줄 2개씩
        xl, _ = outline_x(uj, cr)
        d.line((X(xl), row(uj), X(xl + 8), row(uj)), fill=E.OUTLINE)
    _, xr = outline_x(29.5, cr)                                     # 큐티클: 손톱 위 끝 1줄
    d.line((X(xr) - nw, row(29.5), X(xr), row(29.5)), fill=E.OUTLINE)
    return lay


# ---------------------------------------------------------------- 단면
def _bone(u):
    """끝마디뼈(위는 관절면, 아래는 버섯 모양) + 가운데마디뼈. (왼쪽, 오른쪽) 또는 관절 틈이면 None."""
    if u < 7:
        return None
    if u >= 54.5:                                                   # 관절 틈은 윤곽 홈(55·125·195)과 같은 높이, 1단위
        g = (u - 54.0) % 70
        if g < 1:
            return None
        f = max(_smooth((5 - (g - 1)) / 5), _smooth((5 - (70 - g)) / 5))
        return 3 - f, 13 + f
    if u >= 18:
        f = _smooth((u - 49) / 5.5)
        return 3 - f, 13 + f
    k = _smooth((18 - u) / 9)
    bl, br = 3 - 3 * k, 13 + 1 * k
    if u < 9:
        s = math.sqrt(max(0.0, 1 - ((9 - u) / 2) ** 2))
        mid, hw = (bl + br) / 2, (br - bl) / 2 * s
        return mid - hw, mid + hw
    return bl, br


def _tri(u, uk, hw=2.5):
    return max(0.0, 1 - abs(u - uk) / hw)


def _shift(u, shrink):
    """속살이 줄어 지문면 피부 띠가 안쪽으로 옮겨 간 양(세계 단위): 볼록 가운데 최대 2.5, 관절과 끝으로 갈수록 0."""
    return 2.5 * shrink * math.sin(math.pi * (u - 8) / 42) if 8 < u < 50 else 0.0


def _arrow(d, x, y, n, color=E.INK):
    d.line((x, y, x + n, y), fill=color)
    head(d, x + n + 1, y, 1, 0, color)


def section(cam, fx, tip, sc, te):
    """★ 손가락 세로 단면(RGBA 층). 바깥 윤곽은 바깥 모습과 같고, 왼쪽 피부 띠(INK 2단위)·속살(CARD + DITHER 지방 덩이)·뼈(LABEL)·
    혈관(INK 벽 + DEEP 속)·신경(LABEL 두 줄)·오른쪽 손톱 판. 속살이 줄면 피부 띠가 모양·두께 그대로 안쪽으로 옮겨 가고 원래 자리에 점선 유령선이 남는다."""
    lay = _layer()
    d = ImageDraw.Draw(lay)
    z = cam.z
    base = 90 + (fx - cam.cx) * z
    X = lambda dx: round(base + dx * z)
    row = lambda u: round((tip - u - cam.cy) * z + 125)
    uof = lambda sy: tip - ((sy - 125) / z + cam.cy)
    ymax = min(E.H - 1, row(0) + 2)
    sw = max(2, round(2 * z))
    gr = lambda u: sum(1.5 * g * _tri(u, uk) for g, uk in zip(sc["grooves"], CREASE_U))
    ph, per = blood(te)
    ct = sc["constrict"]
    reach = 80 * ct if ct < 1 else 1e4                              # 접점(u 40)에서 위·아래로 퍼지고, 다 조이면 손가락 전체
    vessel_r = lambda u: 1.5 * (1 - 0.5 * min(max((reach - abs(u - 40)) / 8, 0.0), 1.0))
    blood_rows = []
    for sy in range(0, ymax + 1):
        u = uof(sy)
        if u < 0:
            continue
        xl0, xr = outline_x(u)
        sh = _shift(u, sc["shrink"])
        xs = xl0 + sh + gr(u)
        l, r = X(xs), X(xr)
        d.line((l - 1, sy, r + 1, sy), fill=E.OUTLINE)
        d.line((l, sy, r, sy), fill=E.CARD)
        if u < 2.2:                                                 # 아래 끝 피부
            d.line((l, sy, r, sy), fill=E.INK)
            d.point((l, sy), fill=E.TEXT)
            continue
        crest = sc["crest_lit"] and gr(u) < 0.3 and u < 56
        d.line((l, sy, l + sw - 1, sy), fill=E.TEXT if crest else E.INK)
        d.point((l, sy), fill=E.TEXT)
        if sw >= 3:
            d.point((l + sw - 1, sy), fill=E.DEEP)
        if 3 <= u <= 29:                                            # 손톱 판
            nw = max(2, round(3 * z))
            d.line((r - nw + 1, sy, r, sy), fill=E.LABEL)
            d.point((r, sy), fill=E.OUTLINE)
        else:
            dw = max(2, round(2 * z))
            d.line((r - dw + 1, sy, r, sy), fill=E.INK)
            d.point((r, sy), fill=E.DEEP)
        b = _bone(u)
        if b:
            bl, br = X(b[0]), X(b[1])
            d.line((bl, sy, br, sy), fill=E.LABEL)
            d.point((bl, sy), fill=E.TEXT)
            d.point((br, sy), fill=E.OUTLINE)
            if br - bl >= 24 and sy % 2 == 0:
                d.point((br - 2, sy), fill=E.OUTLINE)
        if u > 8:                                                   # 혈관: INK 1도트 벽 + DEEP 속
            vx = X(VESSEL_DX)
            n = max(3, round(2 * vessel_r(u) * z))
            a = vx - n // 2
            d.line((a, sy, a + n - 1, sy), fill=E.DEEP)
            d.point((a, sy), fill=E.INK)
            d.point((a + n - 1, sy), fill=E.INK)
            if (sy - round(ph)) % per == 0:
                blood_rows.append((vx, sy, n))
        if u > 47:                                                  # 신경: LABEL 1도트 두 줄(4도트 간격)
            nx = X(NERVE_DX)
            col = E.TEXT if sc["nerve_lit"] else E.LABEL
            d.point((nx - 2, sy), fill=col)
            d.point((nx + 2, sy), fill=col)
    for vx, sy, n in blood_rows:                                    # 혈관 속 피 점 LABEL 2×2(좁은 관은 1×2), 행 루프가 끝난 뒤 얹는다
        d.rectangle((vx - 1 if n >= 5 else vx, sy, vx, sy + 1), fill=E.LABEL)
    # 지방 덩이 무늬(속살이 줄면 가로로 촘촘해진다)
    for col, (bx, r_, shr) in enumerate(((-1.0, 2.5, 0.1), (-19.0, 2.2, 0.6))):
        for k in range(14):
            u = 14 + 8 * k + (4 if col else 0)
            if u > 50:
                continue
            cx_, cy_ = X(bx + _shift(u, sc["shrink"]) * shr), row(u)
            rx, ry = max(2, round(r_ * z * (1 - 0.15 * sc["shrink"]))), max(2, round(r_ * z))
            if -ry < cy_ < E.H + ry:
                draw.ellipse(d, cx_, cy_, rx, ry, fill=E.DITHER)
    # 유령선: 원래 겉면 자리
    for sy in range(0, ymax + 1, 2):
        u = uof(sy)
        if u > 8 and round(_shift(u, sc["shrink"]) * z) >= 2:
            d.point((X(outline_x(u)[0]), sy), fill=E.LABEL)
    # 속살 안 안쪽 화살표(원인): 속살 줄어드는 동안 2개, 골마다 골보다 먼저 1개
    ax = lambda u: X(outline_x(u)[0] + _shift(u, sc["shrink"]) + gr(u)) + max(2, round(2 * z)) + 3
    if sc["pre_arrows"]:
        for ua in (31, 21):
            _arrow(d, ax(ua), row(ua), max(5, round(1.6 * z)))
    for on, uk in zip(sc["arrows"], CREASE_U):
        if on:
            _arrow(d, ax(uk), row(uk), max(5, round(1.6 * z)))
    # 신경 → 혈관 갈래(45°)와 혈관의 손끝 쪽 갈래 3개
    nx, vx = X(NERVE_DX), X(VESSEL_DX)
    yb, yc = row(47), row(40)
    n = yc - yb
    for off in (-2, 2):
        draw.line(d, (nx + off, yb), (nx + off + n, yc), E.TEXT if sc["nerve_lit"] else E.LABEL)
    for ub in (34, 24, 14):
        k = max(4, round(5 * z))
        y0 = row(ub)
        draw.line(d, (vx - 2, y0), (vx - 2 - k, y0 + k), E.INK)
        if ct < 0.5:
            draw.line(d, (vx - 2, y0 + 1), (vx - 2 - k + 1, y0 + k + 1), E.DEEP)
    # 신호 점선
    for t0, dur, ys in pulses(te):
        p = (te - t0) / dur
        if not 0 <= p <= 1:
            continue
        y_start = (cam.cy - 125 / z - 4) if ys is None else ys
        yb_w, yc_w = tip - 47, tip - 40
        ysig = y_start + (yc_w - y_start) * p
        for k in range(3):
            yq = ysig - k * 6 / z
            if yq <= yb_w:
                sx, sy_ = X(NERVE_DX), round((yq - cam.cy) * z + 125)
            else:
                dx = min(yq, yc_w) - yb_w
                sx, sy_ = X(NERVE_DX + dx), round((yb_w + dx - cam.cy) * z + 125)
            d.rectangle((sx - 1, sy_ - 1, sx + 1, sy_ + 1), fill=E.INK)
    return lay


# ---------------------------------------------------------------- 세계
def _water(img, d, cam):
    z = cam.z
    x0, x1 = P(cam, WALLS[0][1], 0)[0], P(cam, WALLS[1][0], 0)[0]
    y0, y1 = P(cam, 0, SURF)[1], P(cam, 0, TUB_BOTTOM)[1]
    X0, X1, Y0, Y1 = max(x0, 0), min(x1, E.W - 1), max(y0, 0), min(y1, E.H - 1)
    if X0 > X1 or Y0 > Y1:
        return
    d.rectangle((X0, Y0, X1, Y1), fill=E.DEEP)
    ys, xs = np.arange(Y0, Y1 + 1), np.arange(X0, X1 + 1)
    level = np.clip(((ys - 125) / z + cam.cy - SURF) / 172, 0, 1) * 3 + 1             # 아래로 갈수록 DITHER 점이 늘어난다(세계에 붙은 Bayer, 낮은 대비)
    ox, oy = round(cam.cx * z), round(cam.cy * z)
    mask = E.BAYER[((ys + oy) % 4)[:, None], ((xs + ox) % 4)[None, :]] < level[:, None]
    img.paste(E.DITHER, (X0, Y0, X1 + 1, Y1 + 1), Image.fromarray((mask * 255).astype(np.uint8)))


def _surface_line(d, cam, te):
    """수면 INK 1도트 물결: 12fps로 한 칸씩 옆으로."""
    y = P(cam, 0, SURF)[1]
    if not 0 <= y < E.H + 1:
        return
    x0, x1 = max(P(cam, WALLS[0][1], 0)[0], 0), min(P(cam, WALLS[1][0], 0)[0], E.W - 1)
    k = int(te * 12 + 1e-6)
    for x in range(x0, x1 + 1):
        if 0 <= y - ((x + k) // 3) % 2 < E.H:
            d.point((x, y - ((x + k) // 3) % 2), fill=E.INK)


def _decor(img, d, cam, te):
    z = cam.z
    for k in range(math.floor((cam.cx - 90 / z) / 24), math.ceil((cam.cx + 90 / z) / 24) + 1):   # 벽 타일 CARD 1도트 선
        x = P(cam, k * 24, 0)[0]
        d.line((x, 0, x, E.H - 1), fill=E.CARD)
    for k in range(math.floor((cam.cy - 125 / z) / 24), math.ceil((cam.cy + 195 / z) / 24) + 1):
        y = P(cam, 0, k * 24)[1]
        d.line((0, y, E.W - 1, y), fill=E.CARD)
    for k in range(16):                                              # 공기 중 DITHER 김이 위로 올라간다
        wx = 30 + 29 * k
        wy = SURF - 6 - (te * 9 + 41 * k) % 130
        x, y = P(cam, wx, wy)
        if 0 <= x < E.W - 1 and 0 <= y < E.H:
            d.rectangle((x, y, x + 1, y), fill=E.DITHER)
    for x0, x1 in WALLS:                                             # 욕조 벽
        a, b, t = P(cam, x0, TUB_TOP)[0], P(cam, x1, 0)[0], P(cam, 0, TUB_TOP)[1]
        t = max(t, -1)
        if t > E.H - 1 or b < 0 or a > E.W - 1:
            continue
        d.rectangle((a, t, b, E.H - 1), fill=E.CARD)
        d.line((a, t, b, t), fill=E.LABEL)
        d.line((a, t, a, E.H - 1), fill=E.LABEL)
        d.line((b, t, b, E.H - 1), fill=E.OUTLINE)
    _water(img, d, cam)
    for k in range(120):                                             # 물속 CARD 티끌(2×1): 위로 천천히, 가로로는 안 움직인다
        wx = 100 + (k * 97) % 358
        wy = SURF + 4 + (k * 53 - te * 3.5) % 164
        x, y = P(cam, wx, wy)
        if 0 <= x < E.W - 1 and 0 <= y < E.H:
            d.rectangle((x, y, x + 1, y), fill=E.CARD)


def _rings(d, cam, te):
    """수면에 퍼지는 물결 고리: (x, 시작, 반지름 끝, 길이)."""
    h, c = T0["hook"], T0["clue"]
    ev = [(380, h + 2.5, 30, 0.9), (380, h + 2.9, 30, 0.9)]
    ev += [(x, c + 3.73 + dt, 30, 0.9) for x in (160, 245) for dt in (0, 0.35)]
    ev += [(374, h + t + 0.38, 11, 0.5) for t in (3.0, 4.2, 5.6)]
    for x, t0, reach, dur in ev:
        a = te - t0
        if not 0 <= a <= dur:
            continue
        r = 3 + reach * ease_out(a / dur)
        cx, cy = P(cam, x, SURF)
        rx = round(r * cam.z)
        if cx - rx > E.W or cx + rx < 0 or not 0 <= cy < E.H:
            continue
        draw.ellipse(d, cx, cy, rx, max(2, rx // 5), outline=E.LABEL if a < dur * 0.6 else E.DITHER)


def _drops(d, cam, te):
    h = T0["hook"]
    for t0 in (3.0, 4.2, 5.6):
        a = te - h - t0
        if 0 <= a <= 0.38:
            x, y = P(cam, 374, 112 + 110 * a * a)
            d.rectangle((x, y, x + 1, y + 1), fill=E.LABEL)


def world(img, te, cam=None):
    """세계 전체를 img에 그린다(카메라는 te의 함수). 순서: 타일·김·욕조·물·티끌 → 손가락(바깥/단면) → 수면 고리·물결·물방울."""
    cam = cam or cam_at(te)
    d = ImageDraw.Draw(img)
    _decor(img, d, cam, te)
    _rings(d, cam, te)                                               # 물결 고리는 손가락 뒤 수면에 퍼진다
    sts, sc, wl = state(te), sec_state(te), wipe_line(te)
    for name in ("H", "B", "A", "C"):
        fx, s = FX[name], sts[name]
        x = 90 + (fx - cam.cx) * cam.z
        if x + 28 * cam.z < 0 or x - 28 * cam.z > E.W:
            continue
        if name == "A" and wl > 0:
            if wl < E.H:
                _paste(img, outer(cam, fx, s["tip"], s["creases"], 0), wl, E.H)
            _paste(img, section(cam, fx, s["tip"], sc, te), 0, wl)
            if 0 < wl < E.H:
                for xx in range(max(0, round(x - 30 * cam.z)), min(E.W, round(x + 30 * cam.z))):
                    if xx % 4 < 2:
                        d.point((xx, round(wl)), fill=E.LABEL)
        else:
            _paste(img, outer(cam, fx, s["tip"], s["creases"], s["cream"]), 0, E.H)
        if name != "C" and s["tip"] > SURF + 1:                      # 수면이 손가락을 가로지르는 자리의 LABEL 1도트 고리
            y = P(cam, 0, SURF)[1]
            xl, xr = outline_x(s["tip"] - SURF, s["creases"])
            if 0 <= y < E.H:
                d.line((round(x + xl * cam.z), y, round(x + xr * cam.z), y), fill=E.LABEL)
    _surface_line(d, cam, te)
    _drops(d, cam, te)


# ---------------------------------------------------------------- 이름표·베개·표
def tag(img, x, y, text, lit=True, border=E.LABEL, font="label"):
    """CARD 판 이름표. lit이면 글자 TEXT, 아니면 LABEL. 반환: (x0, y0, x1, y1)."""
    w = E.text_w(text, font) + 6
    h = 14 if font == "bold" else 12
    box = (x, y, x + w, y + h)
    d = ImageDraw.Draw(img)
    d.rectangle(box, fill=E.CARD, outline=border)
    E.text(img, (x + 3, y + 1), text, font, E.TEXT if lit else E.LABEL, shadow=False)
    return box


def fit(x, w, lo=2, hi=177):
    """이름표 왼쪽 x를 캔버스 안으로 밀어 넣는다."""
    return min(max(x, lo), hi - w)


def leader(d, x0, y0, x1, y1, col=E.LABEL):
    """이름표에서 부품까지 1도트 지시선(가로 → 세로)."""
    d.line((x0, y0, x1, y0), fill=col)
    d.line((x1, y0, x1, y1), fill=col)


def pillow(d, cx, cy, u, nv):
    """베개 겉감 48×28(귀 포함 52×30). u 0(꽉 참) → 1(꺼짐): 네 변 가운데가 4도트 볼록에서 3도트 오목으로, V 주름 nv개(0~3).
    네 모서리(귀)는 u와 상관없이 같은 자리다. TEXT 면(가장 밝은 쪽이 면 자체), 오른쪽·아래 LABEL 그림자 2도트, OUTLINE 윤곽, 가운데 이음선."""
    b = 4 - 7 * u
    edge = lambda s: round(b * (1 - (s / 6) ** 2))
    pts = [(cx - 26, cy - 15)]
    pts += [(cx + 4 * s, cy - 14 - edge(s)) for s in range(-5, 6)] + [(cx + 26, cy - 15)]
    pts += [(cx + 24 + round(0.6 * edge(s)), cy + round(14 * s / 5)) for s in range(-4, 5)] + [(cx + 26, cy + 15)]
    pts += [(cx + 4 * s, cy + 14 + edge(s)) for s in range(5, -6, -1)] + [(cx - 26, cy + 15)]
    pts += [(cx - 24 - round(0.6 * edge(s)), cy + round(14 * s / 5)) for s in range(4, -5, -1)]
    ox, oy = cx - 34, cy - 22
    m = Image.new("L", (68, 44), 0)
    ImageDraw.Draw(m).polygon([(x - ox, y - oy) for x, y in pts], fill=255)
    a = np.asarray(m) > 0
    pad = np.pad(a, 3)
    sh = lambda dy, dx: pad[3 + dy:3 + dy + a.shape[0], 3 + dx:3 + dx + a.shape[1]]
    rim = a & ~(sh(0, 1) & sh(0, -1) & sh(1, 0) & sh(-1, 0))
    shade = a & ~rim & ~(sh(2, 2) & sh(1, 1))
    for mask, col in ((a & ~rim & ~shade, E.TEXT), (shade, E.LABEL), (rim, E.OUTLINE)):
        ys, xs = np.nonzero(mask)
        d.point([(int(x) + ox, int(y) + oy) for x, y in zip(xs, ys)], fill=col)
    d.line((cx, cy - 10 + max(0, round(4 * u)), cx, cy + 10 - max(0, round(4 * u))), fill=E.LABEL)      # 가운데 이음선
    for k, vx in enumerate((-13, 0, 13)[:nv]):                       # V 주름
        y = cy + (4 if k == 1 else -3)
        draw.line(d, (cx + vx - 4, y - 2), (cx + vx, y + 2), E.OUTLINE)
        draw.line(d, (cx + vx, y + 2), (cx + vx + 4, y - 2), E.OUTLINE)


def flow_card(img, d, x, y, w, label, value, border, arrow_n):
    """FLOW 표: 위 줄 `FLOW` + 아래 화살표(도트 도형), 아래 줄 값."""
    d.rectangle((x, y, x + w, y + 24), fill=E.CARD, outline=border)
    E.text(img, (x + 4, y + 2), label, "label", E.LABEL, shadow=False)
    ax = x + 4 + E.text_w(label, "label") + 8
    if arrow_n > 0:
        d.line((ax, y + 4, ax, y + 4 + arrow_n), fill=E.INK)
        head(d, ax, y + 5 + arrow_n, 0, 1, E.INK)
    E.text(img, (x + 4, y + 12), value, "label", E.TEXT, shadow=False)
