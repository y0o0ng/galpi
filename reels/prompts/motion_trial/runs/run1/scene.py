"""13편 도트판(hook~finale) — 움직임 문법 시험. 세계는 욕조 하나의 옆 단면이고, 장면은 그 안의 카메라 위치·확대 수준이다.
실행: reels/.venv/bin/python episodes/ep13_c27m_px/scene.py"""
import sys
from pathlib import Path

HERE = Path(__file__).parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(HERE))
from px import engine as E, templates  # noqa: E402
from px.templates import SPARKLE_MASCOT, Episode, blinking, cardt, pointer  # noqa: E402
from px.timeline import at, ease_in_out, span  # noqa: E402
import art as A  # noqa: E402
import cam as C  # noqa: E402

DRAW = {}
IDS = ("hook", "clue", "inside", "proof", "finale")
ep = Episode(HERE, IDS, DRAW, "ep13_px_preview")
nar = ep.nar
START = {k: ep.starts[i] for i, k in enumerate(IDS)}
A.set_starts(START)
C.init(START)


def te_of(k, ta):
    return START[k] + ta


# ---------------- hook ----------------
def hook(img, d, t, ta, T):
    """세계를 창 (0, 152)~(179, 319) 안에만 그린 뒤 훅 템플릿(제목·큰 영문·시온 놀람)을 얹는다."""
    tmp = img.copy()
    A.world(tmp, te_of("hook", ta))
    img.paste(tmp.crop((0, 152, E.W, E.H)), (0, 152))
    templates.hook(img, d, t, ta, T, nar["hook"], ("WATER-", "INDUCED", "WRINKLING"), lambda *a: None)


DRAW["hook"] = hook


# ---------------- clue ----------------
def clue(img, d, t, ta, T):
    te = te_of("clue", ta)
    cam = C.cam_at(te)
    A.world(img, te, cam)
    if t >= 2.0:                                                    # 이름표는 자기 손가락의 화면 x를 따라간다
        for name, text, col in (("A", "NERVE OK", E.INK), ("B", "NERVE DAMAGED", E.PURPLE)):
            w = E.text_w(text, "label") + 6
            A.tag(img, A.fit(C.P(cam, A.FX[name], 0)[0] - w // 2, w), 4, text, True, col)
    if t >= 9.8 and (t >= 10.5 or blinking(t, 9.8)):                 # A와 B 사이 물속의 ?
        E.text(img, (82, 170), "?", "bold", E.TEXT, scale=2)
    pointer(img, t, cardt(T, 1, 1), 12.4, 168, 215, face="left")     # 대상(B)의 오른쪽에 서면 left
    T.sfx = [(2.0, "pop")]


DRAW["clue"] = clue


# ---------------- inside ----------------
def _skin_x(cam, sy):
    """화면 행 sy에서 A 겉면(원래 윤곽)의 화면 x."""
    u = 200 - ((sy - 125) / cam.z + cam.cy)
    return round(90 + (A.FX["A"] + A.outline_x(u)[0] - cam.cx) * cam.z)


def _lit_tag(img, x, y, text, t, t_on):
    """이름표: 처음 LABEL, 자기 부품이 움직이는 순간 TEXT로 바뀌어 그대로 남는다."""
    return A.tag(img, x, y, text, t >= t_on + 0.3) if t >= t_on else None


def inside(img, d, t, ta, T):
    te = te_of("inside", ta)
    cam = C.cam_at(te)
    A.world(img, te, cam)
    z = cam.z
    row = lambda u: C.P(cam, 0, 200 - u)[1]
    X = lambda dx: C.P(cam, A.FX["A"] + dx, 0)[0]
    if t >= 2.0:                                                    # NERVE: 신경 옆, 지시선은 신경까지
        b = _lit_tag(img, 2, 4, "NERVE", t, 2.0)
        A.leader(d, b[2], 10, X(A.NERVE_DX), 10)
    if t >= 2.8:
        w = E.text_w("VESSEL", "label") + 6
        _lit_tag(img, A.fit(X(A.VESSEL_DX) - w // 2, w), 4, "VESSEL", t, 2.8)
    if t >= 4.0:
        w = E.text_w("PULP", "label") + 6
        _lit_tag(img, A.fit(X(-2.5) - w // 2, w), row(28), "PULP", t, 4.0)
    if t >= 7.0:                                                    # SKIN: 물 쪽, 지시선은 겉면까지
        y = 22
        b = _lit_tag(img, 2, y, "SKIN", t, 7.0)
        sx = _skin_x(cam, y + 6)
        if sx > b[2] + 2:
            A.leader(d, b[2], y + 6, sx - 2, y + 6)
    if t >= 10.43:                                                  # FOLD: 둘째 골(끝에서 36단위)
        gy = row(36)
        b = _lit_tag(img, 2, max(gy - 30, 28), "FOLD", t, 10.43)
        sx = _skin_x(cam, gy)
        mx = (b[0] + b[2]) // 2                                     # 이름표 아래 가운데에서 내려와 겉면 쪽으로 꺾는다
        d.line((mx, b[3], mx, gy), fill=E.LABEL)
        if sx - 3 > mx:
            d.line((mx, gy, sx - 3, gy), fill=E.LABEL)
    s9 = at(T, 3)                                                   # 베개 카드(S9): 펼침 → 꽉 찬 베개 → 꺼짐 → 접혀 사라짐
    close = 15.63
    if s9 <= t < close + 0.27:
        k = span(ta, s9, s9 + 0.17) if t < close else 1 - span(ta, close, close + 0.27)
        x0, y0, x1, y1 = 100, 14, 174, 72
        cx, cy = (x0 + x1) // 2, (y0 + y1) // 2
        hw, hh = max(2, round((x1 - x0) / 2 * k)), max(2, round((y1 - y0) / 2 * k))
        d.rectangle((cx - hw, cy - hh, cx + hw, cy + hh), fill=E.CARD, outline=E.LABEL)
        if k >= 1:
            u = ease_in_out(span(ta, s9 + 0.67, s9 + 2.07))
            A.pillow(d, cx, cy, u, sum(ta >= s9 + dt for dt in (1.07, 1.47, 1.87)))
    T.sfx = [(0.8, "pop"), (at(T, 1), "fall")]                      # fall: 속살이 줄어든다(S7 시작)


DRAW["inside"] = inside


# ---------------- proof ----------------
def proof(img, d, t, ta, T):
    te = te_of("proof", ta)
    cam = C.cam_at(te)
    A.world(img, te, cam)
    if t >= 1.8:                                                    # WATER: 오른쪽 위 A 위쪽
        w = E.text_w("WATER", "bold") + 6
        A.tag(img, A.fit(C.P(cam, A.FX["A"], 0)[0] - w // 2, w), 4, "WATER", True, E.INK, "bold")
    if t >= 2.2:                                                    # EMLA + NO WATER: 왼쪽 위 C 위쪽
        w = E.text_w("EMLA", "bold") + 6
        x = A.fit(C.P(cam, A.FX["C"], 0)[0] - w // 2, w)
        A.tag(img, x, 4, "EMLA", True, E.PURPLE, "bold")
        A.tag(img, A.fit(x - 4, E.text_w("NO WATER", "label") + 6), 21, "NO WATER", False, E.LABEL)
    s11 = at(T, 1)
    if s11 <= t < 10.0:                                             # FLOW 두 표가 같이 켜지고 아래 화살표가 같이 자란다(10.0부터 카메라가 내려와 손끝을 가려서 거둔다)
        n = round(8 * span(ta, s11, s11 + 0.5))
        A.flow_card(img, d, 4, 190, 82, "FLOW", "-2.01 cm/s", E.PURPLE, n)
        A.flow_card(img, d, 94, 190, 82, "FLOW", "-2.29 cm/s", E.INK, n)
        E.center_text(img, 236, "n = 25", "label", E.TEXT)
    T.sfx = [(1.8, "pop")]


DRAW["proof"] = proof


# ---------------- finale ----------------
def finale(img, d, t, ta, T):
    te = te_of("finale", ta)
    cam = C.cam_at(te)
    A.world(img, te, cam)
    if t >= 1.0:                                                    # NERVE: 화면 고정, 처음부터 TEXT
        b = A.tag(img, 2, 40, "NERVE", True)
        A.leader(d, b[2], 46, C.P(cam, A.FX["A"] + A.NERVE_DX, 0)[0] - 4, 46)
    if t >= 2.8:
        w = E.text_w("WRINKLE TEST", "label") + 6
        A.tag(img, (E.W - w) // 2, 4, "WRINKLE TEST", True, E.INK)
    s13 = at(T, 1)
    if t >= s13:
        SPARKLE_MASCOT.paste(img, t - s13, (152, 249))
    T.sfx = [(0.4, "pop"), (s13, "sparkle")]


DRAW["finale"] = finale

if __name__ == "__main__":
    ep.main()
