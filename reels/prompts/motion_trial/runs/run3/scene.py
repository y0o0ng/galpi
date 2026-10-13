"""13편 도트판(물에 의한 손끝 주름). 실행: reels/.venv/bin/python episodes/ep13_c27m_px/scene.py
무대: hook 욕조 물가, clue 욕조 단면(두 손가락 같은 물), inside 물속 손끝 세로 단면(핵심, 확대한 몸속), pillow 공기 속 베개(비유),
proof 두 칸(물 / 마른 크림), finale 물속 손가락. 카메라는 전부 고정이고 무대가 바뀌면 끊는다."""
import sys
from pathlib import Path

HERE = Path(__file__).parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(HERE))
from px import engine as E, templates  # noqa: E402
from px.templates import SPARKLE_MASCOT, Episode, cardt  # noqa: E402
from px.timeline import at, ease_in_out, ease_out, span, tween  # noqa: E402
import art as A  # noqa: E402

DRAW = {}
ep = Episode(HERE, ("hook", "clue", "inside", "pillow", "proof", "finale"), DRAW, "ep13_px_preview")
nar = ep.nar


def centered_label(img, cx, y, s, col):
    A.label(img, cx - E.text_w(s, "label") // 2, y, s, col)


# ---------------- hook: 욕조 물에서 손끝을 들어 올린다 ----------------
def hook(img, d, t, ta, T):
    lift = cardt(T, 0, 1)

    def art(img, d, t, ta):
        tip = round(tween(ta, lift, lift + 0.6, 238, 204, ease_out))
        A.water(img, d, ta, 0, 179, 224, 250, n=8)
        rows = A.finger(img, 50, tip, 36, wr=tween(ta, 1.2, lift + 0.4, 0.3, 1.0), top=tip - 104, fist=True)
        A.drops(d, ta, 54, tip, 224, lift + 0.7)
        A.surface(d, ta, 0, 179, 224)
        if 224 in rows:                                  # 손가락이 수면을 지나는 동안만 물결
            A.ripple(d, ta, rows[224][0], rows[224][1], 224, 1.2)

    templates.hook(img, d, t, ta, T, nar["hook"], ("WRINKLING",), art)


DRAW["hook"] = hook


# ---------------- clue: 같은 물에 두 손가락, 신경만 다르다 ----------------
CLUE_X = (46, 130)


def clue(img, d, t, ta, T):
    dip = cardt(T, 0, 1)
    tip = round(tween(ta, dip, dip + 0.8, 104, 196, ease_out))
    wr = ease_in_out(span(ta, dip + 0.9, cardt(T, 0, 2) + 1.6))
    A.tub(d)
    A.water(img, d, ta, 4, 175, 128, 245, n=14, seed=1)
    rows = [A.finger(img, cx, tip, 36, wr=w_) for cx, w_ in zip(CLUE_X, (wr, 0.0))]
    if t >= at(T, 2):                                    # 신경 신호: 위 손가락만 흐른다
        for cx, live in zip(CLUE_X, (True, False)):
            A.nerve_xray(d, ta, A.vline_path(cx - 3, 0, tip - 13), at(T, 2) + 0.2 if live else None)
    A.surface(d, ta, 4, 175, 128)
    for r in rows:
        if 128 in r:
            A.ripple(d, ta, r[128][0], r[128][1], 128, dip + 0.5)
    if t >= at(T, 0) + 0.3:
        centered_label(img, CLUE_X[0] + 2, 208, "NERVE OK", E.INK)
    if t >= at(T, 0) + 0.8:
        centered_label(img, CLUE_X[1] + 2, 208, "NERVE DAMAGED", E.PURPLE)
    if t >= at(T, 1) + 0.3:
        E.text(img, (157, 146), "?", "bold", E.PURPLE, scale=2)
    T.sfx = [(dip, "bubbles")]


DRAW["clue"] = clue


# ---------------- inside ★ 핵심: 손끝 세로 단면 ----------------
def inside(img, d, t, ta, T):
    s7, s8 = at(T, 1), at(T, 2)
    shrink = ease_in_out(span(ta, s7 + 0.3, s8 + 0.4))
    fold = ease_in_out(span(ta, cardt(T, 2, 1) - 0.2, cardt(T, 2, 2) + 0.6))
    t_sig = at(T, 0) + 0.5
    labels = set()
    if t >= t_sig:
        labels.add("NERVE")
    if t >= cardt(T, 0, 1):
        labels.add("VESSEL")
    if t >= s7 + 0.3:
        labels.add("PULP")
    if t >= s8:
        labels.add("SKIN")
    A.section(img, d, ta, t_sig, 0.45 * shrink, 0.2 * shrink + 0.35 * fold, cardt(T, 2, 1) - 0.3, labels)
    T.sfx = [(0.3, "pop"), (s7 + 0.3, "fall")]


DRAW["inside"] = inside


# ---------------- pillow: 같은 겉감, 속이 줄어든 베개 ----------------
def pillow(img, d, t, ta, T):
    k = ease_in_out(span(ta, 0.6, T.length - 0.2))
    A.pillow(img, 90, 74, 128, 62, 0.0)
    A.pillow(img, 90, 180, 128, 62, k, ghost=True)
    T.sfx = [(0.3, "pop")]


DRAW["pillow"] = pillow


# ---------------- proof: 물 칸 / 마른 크림 칸 ----------------
PX = (44, 134)


def proof(img, d, t, ta, T):
    dip = at(T, 0) + 0.2
    tip_w = round(tween(ta, dip, dip + 0.8, 70, 150, ease_out))
    cream = ease_in_out(span(ta, at(T, 0) + 0.5, cardt(T, 0, 1) + 1.0))
    wr = ease_in_out(span(ta, cardt(T, 0, 2), cardt(T, 0, 3) + 1.0))
    L = round(tween(ta, at(T, 1) + 0.1, at(T, 1) + 0.8, 0, 22))
    A.water(img, d, ta, 0, 88, 96, 232, n=8, seed=2)                  # 물 칸
    rows = A.finger(img, PX[0], tip_w, 36, wr)
    A.surface(d, ta, 0, 88, 96)
    if 96 in rows:
        A.ripple(d, ta, rows[96][0], rows[96][1], 96, dip + 0.5)
    d.rectangle((91, 0, 179, 232), fill=E.CARD)                         # 마른 칸(물 없음)
    A.finger(img, PX[1], 150, 36, wr, cream=cream)
    for cx, name in zip(PX, ("WATER", "EMLA")):
        E.text(img, (cx - E.text_w(name, "bold") // 2, 160), name, "bold", E.TEXT)
    centered_label(img, PX[1], 175, "NO WATER", E.LABEL)
    for cx, num in zip(PX, ("-2.29 cm/s", "-2.01 cm/s")):             # 혈류가 줄어든 정도: 같은 길이 화살표
        A.flow_arrow(d, ta, cx - 26, 190, L)
        if L:
            A.label(img, cx - 18, 190, "FLOW")
        if t >= at(T, 1) + 0.6:
            A.label(img, cx - 18, 204, num, E.TEXT)
    if t >= cardt(T, 1, 1):
        E.center_text(img, 236, "n = 25", "label", E.LABEL)
    T.sfx = [(0.3, "pop")]


DRAW["proof"] = proof


# ---------------- finale: 물속 손가락, 뿌리 → 끝 신호 ----------------
NERVE_F = A.vline_path(72, 0, 168, end=(75, 171))


def finale(img, d, t, ta, T):
    t0 = at(T, 0) + 0.3
    narrow = span(ta, t0 + 1.5, t0 + 2.2)
    wr = ease_in_out(span(ta, t0 + 2.2, t0 + 4.6))
    A.water(img, d, ta, 0, 179, 100, 250, n=16, seed=4)
    rows = A.finger(img, 82, 228, 56, wr)
    A.vessel_xray(d, 78, 172, 198, round(2 - 2 * narrow))
    A.nerve_xray(d, ta, NERVE_F, t0, period=1.0)
    A.surface(d, ta, 0, 179, 100)
    A.ripple(d, ta, rows[100][0], rows[100][1], 100, 0.0)
    if t >= cardt(T, 0, 1):
        for k, word in enumerate(("WRINKLE", "TEST")):
            E.text(img, (122, 10 + 15 * k), word, "bold", E.INK)
    if t >= at(T, 1):
        SPARKLE_MASCOT.paste(img, t - at(T, 1), (152, 249))
    T.sfx = [(0.3, "pop"), (at(T, 1), "sparkle")]


DRAW["finale"] = finale

if __name__ == "__main__":
    ep.main()
