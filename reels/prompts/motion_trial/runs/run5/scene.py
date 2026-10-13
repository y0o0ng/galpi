"""13편 도트판(hook~finale): 물에 오래 닿은 손끝이 쭈글해지는 이유. 실행: reels/.venv/bin/python episodes/ep13_c27m_px/scene.py
무대: hook 욕실 창 · clue 물통(한 손, 검지만 신경이 다침) · inside 손끝 세로 단면(핵심) · fold 같은 단면 ×2(핵심) · proof 물/마른 공기 두 칸 · finale 물통.
카메라는 서 있다. 같은 대상을 더 가까이 볼 때만(clue→inside 단면 열기, inside→fold ×2) 앞 장면 끝 화면에서 이어 들어가고, 배율이 바뀌는 순간은 컷이다."""
import sys
from pathlib import Path

from PIL import Image, ImageDraw

HERE = Path(__file__).parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(HERE))
from px import engine as E, templates  # noqa: E402
from px.templates import SPARKLE_MASCOT, Episode, cardt, cutaway, dotted_rect, flow  # noqa: E402
from px.timeline import at, ease_out, span, tween  # noqa: E402
import art as A  # noqa: E402

DRAW = {}
ep = Episode(HERE, ("hook", "clue", "inside", "fold", "proof", "finale"), DRAW, "ep13_px_preview")
nar = ep.nar
SC = {T.id: T for T in ep.scenes}


# ---------------- hook: 욕실 창 — 물속 손끝에 주름이 지고, 들어 올린 손끝에서 물방울이 떨어진다 ----------------
HOOK_WIN = (6, 98, 118, 246)
HOOK_F, HOOK_HX, HOOK_HY, HOOK_SURF = 1.1, 52, 34, 106
DROP_OFF, DROP_P = (0.0, 0.55, 0.95, 0.3), 1.3
T_LIFT = (2.7, 3.5)


def drops(d, H, hx, hy, surf, ta, t0):
    """들어 올린 손끝마다 물방울이 맺혀(0.55초) 떨어지고(0.3초) 수면에 물결이 퍼진다(0.45초)."""
    for i in range(4):
        u = ta - t0 - DROP_OFF[i]
        if u < 0:
            continue
        tau = u % DROP_P
        x, ty = H.tip_xy(hx, hy, i)
        if tau < 0.55:
            sz = 1 + int(tau / 0.55 * 3)
            d.rectangle((x - 1, ty + 1, x, ty + sz), fill=E.LABEL)
            d.point((x - 1, ty + 1), fill=E.TEXT)
        elif tau < 0.85:
            y = ty + 3 + round((surf - ty - 6) * ((tau - 0.55) / 0.3) ** 2)
            d.rectangle((x - 1, y, x, y + 2), fill=E.LABEL)
            d.point((x - 1, y), fill=E.TEXT)
        else:
            r = 2 + int((tau - 0.85) / 0.45 * 9)
            for sx in (-1, 1):
                d.line((x + sx * r, surf - 1, x + sx * (r + 1), surf - 1), fill=E.DEEP)


def hook_art(img, d, t, ta):
    x0, y0, x1, y1 = HOOK_WIN
    win = Image.new("RGB", (x1 - x0 - 1, y1 - y0 - 1), E.BG)
    wd = ImageDraw.Draw(win)
    w_, h_ = win.size
    for x in range(8, w_, 16):                                       # 욕실 타일(낮은 대비)
        wd.line((x, 0, x, HOOK_SURF - 1), fill=E.DITHER)
    for y in range(12, HOOK_SURF, 16):
        wd.line((0, y, w_ - 1, y), fill=E.DITHER)
    A.water_back(wd, (0, 0, w_ - 1, h_ - 1), HOOK_SURF, t)
    H = A.hand(HOOK_F)
    hy = HOOK_HY + tween(ta, *T_LIFT, 0, -40, ease_out, rnd=True)
    H.paste(win, HOOK_HX, hy)
    for i in range(4):
        H.wrinkles(wd, HOOK_HX, hy, i, span(ta, 0.7, 2.6))
    A.water_front(wd, 0, w_ - 1, HOOK_SURF, t)
    drops(wd, H, HOOK_HX, hy, HOOK_SURF, ta, T_LIFT[1])
    img.paste(win, (x0 + 1, y0 + 1))
    d.rectangle(HOOK_WIN, outline=E.LABEL)


def hook(img, d, t, ta, T):
    templates.hook(img, d, t, ta, T, nar["hook"], ("WRINKLING",), hook_art)


DRAW["hook"] = hook


# ---------------- clue: 같은 물통, 한 손 — 검지(신경이 다침)만 매끈하다 ----------------
CLUE_F, CLUE_HX, CLUE_HY, CLUE_SURF = 1.8, 78, 0, 112
DAMAGED = 3                                                       # 검지


def tank(img, d, t, ta, st):
    """st: dy(손 높이), w(주름), tags(이름표), q(?), nerve(신호 진행 0~1, None이면 안 그림)."""
    A.water_back(d, (0, 0, E.W - 1, 250), CLUE_SURF, t, seed=1)
    H = A.hand(CLUE_F)
    hy = CLUE_HY + st["dy"]
    H.paste(img, CLUE_HX, hy)
    for i in range(4):
        H.wrinkles(d, CLUE_HX, hy, i, 0 if i == DAMAGED else st["w"])
    if st["nerve"] is not None:
        for p in A.nerve_paths(H, CLUE_HX, hy, 0, (0, 1, 2)):
            flow(d, ta, p, E.INK, st["nerve"])
        flow(d, 0, A.nerve_paths(H, CLUE_HX, hy, 0, (DAMAGED,))[0], E.DEEP, 0.999, phase=0)    # 신호 없는 신경(흐르지 않음)
    A.water_front(d, 0, E.W - 1, CLUE_SURF, t)
    if st["splash"] is not None:                                   # 손가락이 물에 들어간 자리에서 퍼지는 물결
        r = 2 + int(st["splash"] * 14)
        for i in range(4):
            x, _ = H.tip_xy(CLUE_HX, hy, i)
            for sx in (-1, 1):
                d.line((x + sx * (r + 8), CLUE_SURF - 1, x + sx * (r + 10), CLUE_SURF - 1), fill=E.DEEP)
    if st["tags"]:
        (xa, _), (xb, yb), (xd, yd) = (H.tip_xy(CLUE_HX, hy, i) for i in (0, 2, DAMAGED))
        y = yb + 5
        d.line((xa, y, xb, y), fill=E.INK)
        d.line((xa, y - 2, xa, y), fill=E.INK)
        d.line((xb, y - 2, xb, y), fill=E.INK)
        cx = (xa + xb) // 2
        A.label(img, cx - E.text_w("NERVE OK", "label") // 2, y + 3, "NERVE OK", E.INK)
        d.line((xd, yd + 4, xd, y + 20), fill=E.PURPLE)
        wdm = E.text_w("NERVE DAMAGED", "label")
        A.label(img, min(xd - wdm // 2, E.W - 4 - wdm), y + 22, "NERVE DAMAGED", E.PURPLE)
    if st["q"]:
        E.text(img, (138, 118), "?", "bold", E.PURPLE, 2)


def clue_state(T, ta):
    c3b, s4, s5 = cardt(T, 0, 1), at(T, 1), at(T, 2)
    return {"dy": tween(ta, 0.4, 1.4, -60, 0, ease_out, rnd=True), "w": span(ta, c3b, s4 + 2.6),
            "tags": ta >= c3b, "q": ta >= s4, "nerve": span(ta, s5, s5 + 1.0) if ta >= s5 else None,
            "splash": span(ta, 0.45, 1.25) if 0.45 <= ta < 1.25 else None}


def clue(img, d, t, ta, T):
    tank(img, d, t, ta, clue_state(T, ta))
    T.sfx = [(0.45, "bubbles")]


DRAW["clue"] = clue


# ---------------- inside(핵심 1): 손끝 세로 단면 — 신호 → 혈관이 가늘어짐 → 속살이 줄어듦 ----------------
STAGE, CLIP = (2, 2, 177, 249), (3, 3, 176, 248)
CAM1 = (0.0, 0.0, 1)
INS_BOX = (73, 128, 106, 168)                                     # clue 화면의 가운데손가락 끝
T_ZOOM = 0.9
PULSE_GAP, PULSE_V, BRANCH_T, NARROW_T = 0.9, 110, 0.2, 0.7      # 신호 간격·속도(세계 px/초), 가지 지나는 시간, 한 구간이 조이는 시간
BLOOD_V = 34


def signals(ta, t0):
    """t0부터 PULSE_GAP마다 신경 위(뿌리)에서 출발하는 신호들: (신경 위 세계 y 목록, [(가지, 진행)])."""
    pulses, bp = [], []
    j = 0
    while t0 + j * PULSE_GAP <= ta:
        u = ta - (t0 + j * PULSE_GAP)
        y = -20 + PULSE_V * u
        if y <= 200:
            pulses.append(y)
        for b, yb in enumerate(A.BRANCH_Y):
            v = (u - (yb + 20) / PULSE_V) / BRANCH_T
            if 0 <= v < 1:
                bp.append((b, v))
        j += 1
    return pulses, bp


def narrow_times(T):
    t0 = cardt(T, 1, 1)
    return t0, [t0 + (yb + 20) / PULSE_V + BRANCH_T for yb in A.BRANCH_Y]


def shrink_start(T):
    """속살은 관이 다 가늘어진 뒤에 줄기 시작한다(S7 시작 이후)."""
    _, tb = narrow_times(T)
    return max(at(T, 2) + 0.2, tb[-1] + NARROW_T + 0.1)


def blood(T, ta):
    """피 점 전진량: 조인 만큼 느려진다(12fps 단계로 더한다)."""
    _, tb = narrow_times(T)
    pos, k = 0.0, 0
    while k / 12 < ta:
        n = sum(span(k / 12, b, b + NARROW_T) for b in tb) / 3
        pos += BLOOD_V * (1 - 0.65 * n) / 12
        k += 1
    return pos


def inside_state(T, ta):
    t0, tb = narrow_times(T)
    ts = shrink_start(T)
    pulses, bp = signals(ta, t0)
    return {"s": span(ta, ts, ts + 2.6), "a": 0.0, "n": tuple(span(ta, b, b + NARROW_T) for b in tb), "ghost": ta >= ts,
            "blood": blood(T, ta), "pulses": pulses, "bpulses": bp}


def section_labels(img, d, k1_tags):
    """k=1 단면의 이름표(왼쪽 물 띠)와 점선 지시선."""
    if "NERVE" in k1_tags:
        A.label(img, 6, 30, "NERVE", E.INK)
        A.dotted_line(d, ((36, 34), (74, 34)), E.LABEL)
    if "VESSEL" in k1_tags:
        A.label(img, 5, 14, "VESSEL", E.PURPLE)
        A.dotted_line(d, ((38, 18), (87, 18)), E.LABEL)
    if "PULP" in k1_tags:
        A.label(img, 8, 122, "PULP")
        A.dotted_line(d, ((33, 126), (64, 126)), E.LABEL)


def inside_tags(T, ta):
    t0, _ = narrow_times(T)
    return {name for name, on in (("NERVE", T_ZOOM + 0.9), ("VESSEL", t0 + 0.2), ("PULP", shrink_start(T))) if ta >= on}


def inside(img, d, t, ta, T):
    clue_end = clue_state(SC["clue"], SC["clue"].length)
    st = inside_state(T, ta)
    cutaway(img, d, t, ta, lambda im, dd, tt, tta: tank(im, dd, tt, tta, clue_end),
            lambda im, dd, tt, tta, stg: A.section(im, CAM1, CLIP, st, tt), INS_BOX, T_ZOOM, STAGE, keep_outer=True)
    if t >= T_ZOOM + 0.6:
        section_labels(img, d, inside_tags(T, ta))
    T.sfx = [(T_ZOOM + 0.6, "pop"), (narrow_times(T)[0], "zap")]


DRAW["inside"] = inside


# ---------------- fold(핵심 2): 같은 단면 ×2 — 줄어든 속살이 피부를 안쪽으로 끌어당겨 접힌다 ----------------
T_CUT = 0.5
CAM2 = (16.5, 98.5, 2)                                            # 세계 (18, 100)이 캔버스 (3, 3)
FOLD_BOX = (18, 100, 104, 222)                                    # ×1 화면에서 ×2로 볼 자리


def fold_state(T, ta):
    Ti = SC["inside"]
    c1, c2 = cardt(T, 0, 1), cardt(T, 0, 2)
    pulses, bp = signals(ta + Ti.length, narrow_times(Ti)[0])
    return {"s": 1 + 0.25 * span(ta, c1, c2 + 1.0), "a": span(ta, c1 + 0.4, c2 + 1.4), "n": (1, 1, 1), "ghost": True,
            "blood": blood(Ti, Ti.length) + BLOOD_V * 0.35 * ta, "pulses": pulses, "bpulses": bp}


def fold(img, d, t, ta, T):
    st = fold_state(T, ta)
    c1, c2 = cardt(T, 0, 1), cardt(T, 0, 2)
    if t < T_CUT:                                                  # 앞 장면 끝 화면에서 이어, ×2로 볼 자리를 짚는다
        A.section(img, CAM1, CLIP, st, t)
        d.rectangle(STAGE, outline=E.LABEL)
        section_labels(img, d, {"NERVE", "VESSEL", "PULP"})
        if int(ta * 12) % 4 < 2:
            dotted_rect(d, FOLD_BOX, E.INK)
    else:
        A.section(img, CAM2, CLIP, st, t)
        d.rectangle(STAGE, outline=E.LABEL)
        nerve_x = round((A.NERVE_X - CAM2[0]) * CAM2[2])
        vs = [v for v in A.valleys_canvas(st["s"], st["a"], CAM2, CLIP) if 12 <= v[1] <= 236 and v[2] > 0.6 and v[0] + 18 < nerve_x]
        if ta >= c1:                                               # 끌어당김(원인)이 먼저 움직이고 골(결과)이 뒤따른다
            for x, y, _, _ in vs:
                flow(d, ta, ((x, y), (x + 16, y)), E.INK, span(ta, c1, c1 + 0.6))
        A.label(img, 4, 20, "PULP")
        A.dotted_line(d, ((30, 24), (100, 24)), E.LABEL)
        if ta >= c1:
            A.label(img, 4, 64, "SKIN", E.TEXT)
            A.dotted_line(d, ((26, 68), (56, 68)), E.LABEL)
        if ta >= c2 + 0.3 and len(vs) > 1:
            x, y, _, _ = vs[1]
            sx = x - 2 * (A.SKIN_T + 2) - 3                         # 골의 겉면(피부 띠 바깥)
            A.label(img, 4, y - 4, "FOLD", E.TEXT)
            A.dotted_line(d, ((28, y), (sx, y)), E.LABEL)
    T.sfx = [(T_CUT, "pop")]


DRAW["fold"] = fold


# ---------------- proof: 두 무대 — 물속(WATER)과 마른 공기(EMLA 크림) ----------------
PANELS = ((3, 3, 87, 143), (92, 3, 176, 143))
P_HX, P_HY, P_SURF = 32, 18, 72


def dust(d, box, t):
    """마른 공기 속 먼지(낮은 대비, 천천히 내려앉는다)."""
    x0, y0, x1, y1 = box
    ph = int(t * 12)
    for j in range(7):
        x = x0 + 3 + (j * 29 + ph // 6) % (x1 - x0 - 6)
        y = y0 + 3 + (j * 41 + ph // 4) % (y1 - y0 - 6)
        d.line((x, y, x, y + 1), fill=E.DITHER)


def proof(img, d, t, ta, T):
    c11a, c11b, s12, c12b = cardt(T, 1, 0), cardt(T, 1, 1), at(T, 2), cardt(T, 2, 1)
    H = A.hand(1.0)
    dy = tween(ta, 0.4, 1.2, -14, 0, ease_out, rnd=True)
    w_done = s12 - 0.3
    for k, (x0, y0, x1, y1) in enumerate(PANELS):
        if t < 0.3:
            break
        pan = Image.new("RGB", (x1 - x0 - 1, y1 - y0 - 1), E.BG)
        pd = ImageDraw.Draw(pan)
        pw, ph = pan.size
        hy = P_HY + dy
        if k == 0:
            A.water_back(pd, (0, 0, pw - 1, ph - 1), P_SURF, t, seed=4)
        else:
            dust(pd, (0, 0, pw - 1, ph - 1), t)
        H.paste(pan, P_HX, hy)
        for i in range(4):
            if k == 0:
                H.wrinkles(pd, P_HX, hy, i, span(ta, 1.2, w_done))
            else:
                H.cream(pd, P_HX, hy, i, span(ta, c11a + 0.3 + 0.15 * i, c11b + 0.3 + 0.15 * i))
                H.wrinkles(pd, P_HX, hy, i, span(ta, c11b + 0.9, w_done), E.CARD)
        if k == 0:
            A.water_front(pd, 0, pw - 1, P_SURF, t)
            A.label(pan, 5, 122, "WATER", E.TEXT, "bold")
        else:
            A.label(pan, 5, 127, "NO WATER")
            if ta >= c11a:
                A.label(pan, 5, 113, "EMLA", E.TEXT, "bold")
        img.paste(pan, (x0 + 1, y0 + 1))
        d.rectangle((x0, y0, x1, y1), outline=E.LABEL)
    if ta >= s12:                                                  # 혈류가 줄어든 정도: 두 화살표는 같은 길이(거의 같았다)
        d.rectangle((3, 148, 176, 246), fill=E.CARD, outline=E.LABEL)
        E.center_text(img, 152, "FLOW", "bold")
        u = span(ta, s12 + 0.2, s12 + 1.4)
        for x, num in ((45, "-2.29 cm/s"), (134, "-2.01 cm/s")):
            flow(d, ta, ((x, 168), (x, 198)), E.INK, u, thick=True)
            if ta >= s12 + 1.4:
                E.text(img, (x - E.text_w(num, "bold") // 2, 206), num, "bold")
        if ta >= c12b:
            E.center_text(img, 228, "n = 25", "label", E.LABEL)
    T.sfx = [(0.3, "pop")]


DRAW["proof"] = proof


# ---------------- finale: 물통 — 신호가 손가락 뿌리에서 손끝으로 가면 주름이 진다(WRINKLE TEST) ----------------
F_F, F_HX, F_HY, F_SURF = 1.9, 72, 28, 140
T_SIG = (1.4, 2.6)


def finale(img, d, t, ta, T):
    A.water_back(d, (0, 0, E.W - 1, 250), F_SURF, t, seed=2)
    H = A.hand(F_F)
    hy = F_HY + tween(ta, 0.4, 1.2, -44, 0, ease_out, rnd=True)
    H.paste(img, F_HX, hy)
    for i in range(4):
        H.wrinkles(d, F_HX, hy, i, span(ta, T_SIG[1] + 0.2 * i, T_SIG[1] + 2.4 + 0.2 * i))
    if ta >= T_SIG[0]:
        for p in A.nerve_paths(H, F_HX, hy, 0):
            flow(d, ta, p, E.INK, span(ta, *T_SIG))
    A.water_front(d, 0, E.W - 1, F_SURF, t)
    if t >= 0.3:
        d.rectangle((38, 4, 141, 22), fill=E.CARD, outline=E.LABEL)
        E.center_text(img, 8, "WRINKLE TEST", "bold")
    s2 = at(T, 1)
    if t >= s2:
        SPARKLE_MASCOT.paste(img, t - s2, (152, 249))
    T.sfx = [(0.3, "pop"), (s2, "sparkle")]


DRAW["finale"] = finale

if __name__ == "__main__":
    ep.main()
