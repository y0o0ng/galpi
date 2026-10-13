"""13편 도트판(hook~finale): 물에 의한 손끝 주름. 실행: reels/.venv/bin/python episodes/ep13_c27m_px/scene.py
무대 셋 — 욕조 옆 단면(손가락 H·A·B), 손끝 세로 단면(확대한 몸속, A), 마른 공기(EMLA를 바른 손가락 C, proof에서 옆 칸으로 밀려 들어온다).
카메라와 무대 상태는 편 절대 시각 te 하나의 함수라 같은 무대 안의 장면 경계에서 저절로 이어진다. 확대는 정수배다(욕조는 배율 1로 그려
최근접으로 키우고, 단면은 그 배율에서 바로 그린다). 단면은 점선 가로줄이 지나가며 열리고 닫힌다(보는 방식이 바뀔 뿐 바깥 주름은 펴지지 않는다)."""
import math
import sys
from functools import lru_cache
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(HERE))
from px import engine as E, templates  # noqa: E402
from px.templates import SPARKLE_MASCOT, Episode, blinking, cardt, pointer  # noqa: E402
from px.timeline import ease_in_out, ease_out, span, tween  # noqa: E402
import art as A  # noqa: E402

IDS = ("hook", "clue", "inside", "proof", "finale")
DRAW = {}
ep = Episode(HERE, IDS, DRAW, "ep13_px_preview")
nar = ep.nar
SC = {T.id: (T, off) for T, off in zip(ep.scenes, ep.starts)}
HK, CL, IN, PR, FI = (SC[k][1] for k in IDS)
END = FI + SC["finale"][0].length


def K(sid, i, k=0, d=0.0):
    """sid 장면 i번째 문장 k번째 카드가 시작하는 편 절대 시각 + d."""
    T, off = SC[sid]
    return off + cardt(T, i, k) + d


# ---------------- 시각표(편 절대 시각; 장면 시각은 cardt로만 묶는다) ----------------
FX = {"H": 330, "A": 110, "B": 180}                      # 손가락 가운데 세계 x(C는 마른 칸 x 44)
LIFT = (K("hook", 0, 0, 1.6), K("hook", 0, 0, 2.5))      # "나오면": H를 물 밖으로
H_CR = [K("hook", 0, 0, 0.4 * i) for i in range(4)]     # 물속 H의 주름 4줄(위 → 아래)
DROPS = [LIFT[1] + 0.1 + 1.2 * j for j in range(9)]       # 손끝 물방울(수면으로만)
CL_TAG = CL + 2.0
DIP_T = (K("clue", 1, 0, 0.1), K("clue", 1, 0, 1.0))      # "똑같이 오래 담가도": A·B 한 손으로 같이 잠김
A_CR = [K("clue", 1, 1, 0.1 + 0.4 * i) for i in range(4)]
Q_T = K("clue", 2, 1)
SIG0 = K("inside", 0, 1)                                   # "신경이 혈관을 조여요": 첫 신호
TC = SIG0 + 0.75                                           # 신호가 혈관 벽에 닿는 때 → 혈관이 가늘어지기 시작
SHR = (K("inside", 1), K("inside", 1, 0, 2.4))             # "속살의 부피가 줄어요"
PAN = (SHR[1], SHR[1] + 1.0)                               # 피부 쪽으로 옆 패닝
G_AR = [K("inside", 2, 1, 0.07 + 0.4 * i) for i in range(4)]   # "끌어당겨서": 화살표(원인) → 0.2초 뒤 골(결과)
FOLD_T = K("inside", 2, 2)
PIL_T = K("inside", 3)
WATER_T, EMLA_T = PR + 2.2, PR + 2.4
CREAM = (PR + 2.5, PR + 3.7)
C_CR = [K("proof", 0, 1, 0.1 + 0.4 * i) for i in range(4)]
FLOW_T = K("proof", 1)
SIGF = (FI + 1.2, FI + 2.7)                                # 신호를 따라 내려가는 카메라
LIT = K("finale", 0, 1)
assert TC + 1.0 < SHR[0] and SHR[1] <= K("inside", 2) and SIGF[1] <= LIT and CREAM[1] <= C_CR[0]

SIGS_IN = [SIG0 + 0.8 * k for k in range(40) if SIG0 + 0.8 * k < PR + 1.0]
SIGS_FI = [FI + 3.4 + 1.2 * k for k in range(20) if FI + 3.4 + 1.2 * k < END]
IN_OY, FI_Y0 = 141, 30
CA4 = (110.5, 172.25)                                      # 단면 배율 4의 화면 가운데 세계 점(o = (88, 141))


def tip(name, te):
    if name == "H":
        return round(tween(te, *LIFT, 205, 112, ease_out))
    return round(tween(te, *DIP_T, 120, 200, ease_out))


def creases(name, te):
    if name == "H":
        return tuple(ease_out(span(te, t, t + 0.6)) for t in H_CR)
    if name == "A":
        return tuple(ease_out(span(te, t, t + 0.4)) for t in A_CR)
    if name == "C":
        return tuple(ease_out(span(te, t, t + 0.4)) for t in C_CR)
    return (0, 0, 0, 0)


def _cross(name, lo, hi):
    """tip이 수면을 지나는 첫 시각(물결 고리가 퍼지기 시작하는 때)."""
    above = tip(name, lo) < A.SURF
    return next(lo + (hi - lo) * k / 200 for k in range(201) if (tip(name, lo + (hi - lo) * k / 200) < A.SURF) != above)


_t_ab = _cross("A", *DIP_T)
RIPPLES = [(_cross("H", *LIFT), FX["H"], 20), (_t_ab, FX["A"], 20), (_t_ab, FX["B"], 20)]
RIPPLES += [(td + 0.3 + math.sqrt(2 * (A.SURF - 114) / 300), FX["H"] - 1, 1) for td in DROPS]


def ripples(te):
    return [(x0, round(r0 + 16 * (te - t0)), A.INK if te - t0 < 0.6 else A.DEEP) for t0, x0, r0 in RIPPLES if 0 <= te - t0 < 1.4]


def drops(te):
    out, ty = [], tip("H", te)
    for td in DROPS:
        dt = te - td
        if 0 <= dt < 0.3:
            out.append((FX["H"] - 1, ty, 1 if dt < 0.15 else 2))
        elif dt >= 0.3:
            y = ty + 2 + 150 * (dt - 0.3) ** 2
            if y < A.SURF - 1:
                out.append((FX["H"] - 1, round(y), 2))
    return out


def fingers(te):
    return [(FX[n], tip(n, te), creases(n, te)) for n in "HAB"]


# ---------------- 단면 상태 ----------------
def narrow(te):
    """혈관이 신호가 닿은 자리(CONTACT_U)에서 시작해 위·아래로 퍼지며 가늘어진다(0 → 1)."""
    return lambda u: ease_out(np.clip((te - TC - np.abs(u - A.CONTACT_U) / 50) / 0.5, 0, 1))


def phase(te):
    """피 점 누적 전진(세계 단위): 초당 6 → 혈관이 조인 뒤 3(느려진다)."""
    a, b = TC + 0.2, TC + 1.0
    if te <= a:
        return 6 * te
    if te <= b:
        return 6 * a + 6 * (te - a) - 1.5 * (te - a) ** 2 / (b - a)
    return 6 * a + 4.5 * (b - a) + 3 * (te - b)


def signals(te, z):
    ty, out = tip("A", te), []
    runs = [(s, IN_OY, 0.75) for s in SIGS_IN] + [(SIGF[0], FI_Y0, SIGF[1] - SIGF[0])]
    runs += [(s, 82, (SIGF[1] - SIGF[0]) * A.signal_len(ty, 82) / A.signal_len(ty, FI_Y0)) for s in SIGS_FI]
    for t0, y0, dur in runs:
        if t0 <= te < t0 + dur + 0.2:
            out += A.signal_pts(FX["A"], ty, y0, (te - t0) / dur * A.signal_len(ty, y0), z)
    return out


def grooves(te):
    return [ease_out(span(te, t + 0.2, t + 0.7)) for t in G_AR]


def sec_state(te, z):
    return {"shrink": ease_in_out(span(te, *SHR)), "grooves": grooves(te), "narrow": narrow(te), "phase": phase(te),
            "signals": signals(te, z), "lit": te >= LIT}


def skin_x(u, te):
    """지금 지문면 피부 겉면의 세계 x(끝에서 u단위)."""
    u = np.array(float(u))
    prof = math.sin(math.pi * (u - 4) / 46) if 4 < u < 50 else 0
    grv = sum(1.5 * g * float(A._bump(u, uc, 2.2)) for uc, g in zip(A.CREASES, grooves(te)))
    return FX["A"] - float(A.half_l(u)) + 2.5 * ease_in_out(span(te, *SHR)) * prof + grv


PULP_DX = 82 + 68 / 4 - skin_x(16.5, PAN[1])               # PULP 지시선 끝: 패닝 뒤 화면 x 68, 줄어드는 겉면을 따라 움직인다


# ---------------- 카메라: (o, z) 화면 = (세계 − o)·z, 정수 배율 ----------------
def _snap(v, z):
    return round(v * z) / z


def _zoom(te, a, b, c0, z0, c1, z1):
    """화면 가운데 (90, 125)에 오는 세계 점 c와 배율을 함께 옮긴다. 배율은 가장 가까운 정수."""
    u = ease_in_out(span(te, a, b))
    z = int(round(z0 + (z1 - z0) * u))
    cx, cy = c0[0] + (c1[0] - c0[0]) * u, c0[1] + (c1[1] - c0[1]) * u
    return {"o": (_snap(cx - 90 / z, z), _snap(cy - 125 / z, z)), "z": z}


def view(te):
    """sec: 단면이 보이는 위쪽 비율(점선 가로줄 자리), div: 마른 칸 경계 x(0이면 칸 없음)."""
    if te < CL:                                                             # hook: 창 안, H를 따라 위로
        return {"o": (round(tween(te, HK + 5.6, CL, 270, 262)), round(tween(te, *LIFT, -35, -110, ease_out))), "z": 1}
    if te < IN:                                                             # clue: H에서 A·B로 패닝 → 끝에 A로
        t, n = te - CL, IN - CL
        if t < 2.8:
            u = ease_in_out(t / 2.8)
            return {"o": (round(262 - 207 * u), round(-110 + 140 * u)), "z": 1}
        if t < n - 0.5:                                                     # S5 "이 손가락도": B 쪽으로 천천히(A 주름도 화면에 남는다)
            return {"o": (round(tween(te, K("clue", 2), CL + n - 0.5, 55, 62, ease_in_out)), 30), "z": 1}
        return {"o": (round(tween(t, n - 0.5, n, 62, 20, ease_in_out)), 30), "z": 1}
    if te < PR:                                                             # inside: A 끝마디로 확대 → 단면
        if te < IN + 1.0:
            return _zoom(te, IN, IN + 1.0, (110, 155), 1, CA4, 4)
        return {"o": (_snap(tween(te, *PAN, 88, 82, ease_in_out), 4), IN_OY), "z": 4, "sec": span(te, IN + 1.0, IN + 1.6)}
    if te < FI:                                                             # proof: 단면 닫기 → 축소 → 마른 칸이 밀고 들어온다
        if te < PR + 1.0:
            return {"o": (_snap(tween(te, PR, PR + 0.5, 82, 88, ease_in_out), 4), IN_OY), "z": 4,
                    "sec": 1 - span(te, PR + 0.5, PR + 1.0)}
        if te < PR + 1.6:
            return _zoom(te, PR + 1.0, PR + 1.6, CA4, 4, (110, 175), 1)
        u = ease_in_out(span(te, PR + 1.6, PR + 2.2))
        return {"o": (round(20 - 45 * u), 50), "z": 1, "div": round(90 * u)}
    if te < FI + 0.6:                                                       # finale: 칸이 빠지고 → A 위쪽으로 확대 → 단면 → 신호 따라 내려감
        u = 1 - ease_in_out(span(te, FI, FI + 0.6))
        return {"o": (round(20 - 45 * u), 50), "z": 1, "div": round(90 * u)}
    if te < FI + 1.0:
        return _zoom(te, FI + 0.6, FI + 1.0, (110, 175), 1, (110, 92.5), 2)
    oy = FI_Y0 + 52 * ease_in_out(span(te, *SIGF)) + 4 * span(te, SIGF[1], END)
    return {"o": (65, _snap(oy, 2)), "z": 2, "sec": span(te, FI + 1.0, FI + 1.3)}


def bath_view(te, ox, oy, z):
    """욕조 무대를 배율 1로 그려 (ox, oy)에서 잘라 z배 최근접으로 키운 캔버스 크기 배열."""
    X0, Y0 = math.floor(ox), math.floor(oy)
    sx, sy = round((ox - X0) * z), round((oy - Y0) * z)
    w, h = -(-(E.W + sx) // z) + 1, -(-(E.H + sy) // z) + 1
    arr = A.bath(te, X0, Y0, w, h, fingers(te), drops(te), ripples(te))
    if z > 1:
        arr = arr.repeat(z, 0).repeat(z, 1)
    return arr[sy:sy + E.H, sx:sx + E.W]


@lru_cache(maxsize=4)
def world(te):
    v = view(te)
    (ox, oy), z = v["o"], v["z"]
    if v.get("div"):                                                        # 마른 칸(왼쪽) | 욕조(오른쪽)
        div = v["div"]
        out = bath_view(te, ox, oy, 1).copy()
        left = A.dry(te, 89, E.H, 44, 150, creases("C", te), ease_in_out(span(te, *CREAM)))
        if div >= 2:
            out[:, :div - 1] = left[:, 90 - div:]
        out[:, div - 1] = A.LABEL
        out[:, min(div, E.W - 1)] = A.OUTLINE
        return out
    f = v.get("sec", 0)
    if f <= 0:
        return bath_view(te, ox, oy, z)
    out = A.section_bg(te, z, ox, oy, E.W, E.H)
    sec, a = A.section(z, ox, oy, E.W, E.H, FX["A"], tip("A", te), sec_state(te, z))
    out[a] = sec[a]
    wy = round(f * E.H)
    if wy < E.H:
        out[wy:] = bath_view(te, ox, oy, z)[wy:]
    if 0 < wy < E.H:
        out[wy, np.arange(E.W) % 4 < 2] = A.LABEL                          # 점선 가로줄: 위는 단면, 아래는 바깥 모습
    return out


def paste(img, te, y0=0):
    arr = world(round(te * 12) / 12)
    img.paste(Image.fromarray(arr[y0:]), (0, y0))


# ---------------- 화면 위 이름표·화살표·카드 ----------------
def fade(te, t_end):
    """거둘 때 판 → 테두리만(12fps 2칸) → 없음."""
    r = t_end - te
    return 0 if r <= 0 else 1 if r <= 2 / 12 else 2


def centered(img, cx, y, text, font, border, lit=True, level=2):
    w = E.text_w(text, font) + 5
    x = min(max(round(cx - w / 2), 2), E.W - 3 - w)
    return A.tag(img, x, y, text, font, border, lit, level)


def overlays(img, d, te):
    v = view(te)
    (ox, oy), z = v["o"], v["z"]
    t_off = IN - 0.25                                                       # A로 패닝(IN − 0.5)이 시작되면 거둔다(B 이름표가 화면 끝에 밀려 겹치지 않게)
    if CL_TAG <= te < t_off:                                                # clue: 손가락에 매단 이름표(손가락 화면 x를 따라간다)
        lv = fade(te, t_off)
        centered(img, (FX["A"] - ox) * z, 4, "NERVE OK", "label", E.INK, True, lv)
        centered(img, (FX["B"] - ox) * z, 4, "NERVE DAMAGED", "label", E.PURPLE, True, lv)
    if Q_T <= te < t_off and (te >= Q_T + 0.7 or blinking(te, Q_T)) and fade(te, t_off) == 2:
        E.text(img, (round((142 - ox) * z), round((190 - oy) * z)), "?", "bold", E.TEXT, 2)
    if IN + 1.0 <= te < PR + 0.4:                                           # inside: 부품 이름표(지금 변하는 부품만 TEXT)
        lv = fade(te, PR + 0.4)
        sxw = lambda X: round((X - ox) * 4)
        syw = lambda Y: round((Y - IN_OY) * 4)
        fx = FX["A"]
        if te >= SIG0:
            x1 = sxw(fx + A.XN - 0.5) - 3
            A.tag(img, x1 - 33, 6, "NERVE", lit=SIG0 <= te < TC + 0.3, level=lv)
        if te >= TC:
            cx = sxw(fx + A.XV)                                             # 이름표 왼쪽 끝이 혈관 오른쪽 벽에 닿는다
            wall = cx + math.ceil(2 * max(A.VESSEL_D - 1.5 * float(narrow(te)(56.0)), 1.0))
            x0 = cx + 16
            if lv == 2:
                A.leader(d, (wall, 12), (x0 - 1, 12))
            A.tag(img, x0, 6, "VESSEL", lit=TC <= te < SHR[0], level=lv)
        if te >= SHR[0]:
            cx = sxw(fx + A.XV)
            x0 = sxw(fx - 2)                                                # 손끝 속살(뼈 아래)에 놓고, 줄어드는 지방 덩이 띠로 45° 지시선
            ex = sxw(skin_x(16.5, te) + PULP_DX)                            # (혈관 갈래 끝 사이를 지나도록 혈관 가운데에서 y = 193 + dx)
            if lv == 2:
                A.leader(d, (cx + 13, 206), (ex, 193 + ex - cx))
            A.tag(img, x0, 207, "PULP", lit=SHR[0] <= te < SHR[1] + 0.2, level=lv)
        if te >= K("inside", 2):
            if lv == 2:
                A.leader(d, (27, 49), (sxw(skin_x(200 - (IN_OY + 49.5 / 4), te)) - 2, 49))
            A.tag(img, 2, 44, "SKIN", lit=G_AR[0] <= te < FOLD_T, level=lv)
        if te >= FOLD_T:
            y = syw(200 - A.CREASES[1])
            if lv == 2:
                A.leader(d, (30, y), (sxw(skin_x(A.CREASES[1], te)) - 2, y))
            A.tag(img, 2, y - 5, "FOLD", lit=True, level=lv)
        if SHR[0] <= te < K("inside", 2):                                   # 속살이 줄어드는 쪽(뼈 쪽)을 가리키는 화살표
            for u in (33, 19):
                A.arrow_h(d, sxw(skin_x(u, te) + 2) + 3, syw(200 - u), 5)
        if te < PR:
            for t0, u in zip(G_AR, A.CREASES):                              # 골마다 당기는 화살표가 골보다 먼저
                if te >= t0:
                    A.arrow_h(d, sxw(skin_x(u, te) + 2) + 3, syw(200 - u), 5)
        if PIL_T <= te < PIL_T + 3.4 + 2 / 12:                              # 베개 카드(뼈·손톱 쪽 위, 지문면 골은 가리지 않는다)
            k = min(te - PIL_T, PIL_T + 3.4 + 2 / 12 - te)
            hh = 29 if k >= 2 / 12 else 14
            d.rectangle((100, 51 - hh, 174, 51 + hh), fill=E.CARD, outline=E.LABEL)
            if hh == 29:
                u = ease_in_out(span(te, PIL_T + 0.67, PIL_T + 2.07))
                A.pillow(img, 137, 51, u, [span(te, PIL_T + 1.07 + 0.35 * i, PIL_T + 1.37 + 0.35 * i) for i in range(4)])
    if te >= WATER_T:                                                       # proof: 칸 이름표와 FLOW 표(마른 칸 것은 칸과 함께 밀려 나간다)
        div = v.get("div", 0)
        lv = fade(te, FI + 0.3)
        shift = div - 90
        if div or te < FI:
            centered(img, FX["A"] - ox, 4, "WATER", "bold", E.INK, True, lv)
        if te >= EMLA_T and div > 20:
            A.tag(img, 44 + shift - 20, 4, "EMLA", "bold", E.PURPLE)
            A.tag(img, 44 + shift - 25, 22, "NO WATER")
        if te >= FLOW_T:
            g = span(te, FLOW_T, FLOW_T + 0.5)
            rows = [(94, "-2.29 cm/s", lv)] + ([(4 + shift, "-2.01 cm/s", 2)] if div > 0 else [])
            for x0, val, lvl in rows:
                if lvl == 2:                                                # 두 표의 아래 화살표는 같은 길이로 같이 자라고, 다 자란 뒤에도 흐른다
                    d.rectangle((x0, 168, x0 + 82, 206), fill=E.CARD, outline=E.LABEL)
                    E.text(img, (x0 + 4, 172), "FLOW", "label", E.LABEL, shadow=False)
                    A.down_arrow(d, x0 + 36, 171, round(10 * g), te)
                    E.text(img, (x0 + 4, 190), val, "bold", E.TEXT, shadow=False)
                elif lvl == 1:
                    d.rectangle((x0, 168, x0 + 82, 206), outline=E.LABEL)
            centered(img, 90, 234, "n = 25", "label", E.LABEL, True, lv)
    if te >= FI + 1.3:                                                      # finale: 신경 이름표, 검사 이름표
        nx = math.floor((FX["A"] + A.XN - 0.5 - ox) * z)
        A.leader(d, (36, 45), (nx - 2, 45))
        A.tag(img, 2, 40, "NERVE")
    if te >= LIT:
        centered(img, 90, 4, "WRINKLE TEST", "bold", E.INK)


# ---------------- 장면 ----------------
def hook(img, d, t, ta, T):
    paste(img, HK + ta, 152)
    d.line((0, 151, E.W - 1, 151), fill=E.OUTLINE)
    templates.hook(img, d, t, ta, T, nar["hook"], ("WATER-", "INDUCED", "WRINKLING"), lambda *a: None)


def clue(img, d, t, ta, T):
    te = CL + ta
    paste(img, te)
    overlays(img, d, te)
    pointer(img, t, cardt(T, 1, 1), T.length - 0.9, 163, 215, face="left")
    T.sfx = [(CL_TAG - CL, "pop")]


def inside(img, d, t, ta, T):
    te = IN + ta
    paste(img, te)
    overlays(img, d, te)
    T.sfx = [(1.0, "pop"), (cardt(T, 1), "fall")]                         # fall: 속살 부피가 줄어드는 순간(뜻 있는 소리)


def proof(img, d, t, ta, T):
    te = PR + ta
    paste(img, te)
    overlays(img, d, te)
    T.sfx = [(WATER_T - PR, "pop")]


def finale(img, d, t, ta, T):
    te = FI + ta
    paste(img, te)
    overlays(img, d, te)
    s13 = cardt(T, 1)
    if t >= s13:
        SPARKLE_MASCOT.paste(img, t - s13, (152, 249))
    T.sfx = [(1.0, "pop"), (s13, "sparkle")]


DRAW.update(hook=hook, clue=clue, inside=inside, proof=proof, finale=finale)

if __name__ == "__main__":
    ep.main()
