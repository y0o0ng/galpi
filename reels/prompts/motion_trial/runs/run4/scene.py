"""13편 도트판(움직임 문법 시험): 물에 의한 손끝 주름. 실행: reels/.venv/bin/python episodes/ep13_c27m_px/scene.py
카메라는 서 있고, fold 장면에서 한 번만 ×2로 컷 확대한다. 진행 중인 과정은 장면 시각의 연속 함수(art.py)고 문장 박자는 시작 신호로만 쓴다."""
import sys
from pathlib import Path

HERE = Path(__file__).parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(HERE))
from px import engine as E, templates  # noqa: E402
from px.templates import SPARKLE_MASCOT, Episode, blinking, cardt, compare, dotted_rect  # noqa: E402
from px.timeline import at, ease_in_out, tween  # noqa: E402
import art as A  # noqa: E402

DRAW = {}
IDS = ("hook", "clue", "inside", "fold", "proof", "finale")
ep = Episode(HERE, IDS, DRAW, "ep13_px_preview")
nar = ep.nar
INSIDE = ep.scenes[IDS.index("inside")]


def wrinkle(ta, a, b):
    """주름 단계 0..12: a~b초에 걸쳐 차츰 잡힌다."""
    return round(12 * tween(ta, a, b, 0, 1, ease_in_out))


# ---------------- hook: 물 위로 솟은 손끝 둘, 왼쪽만 주름이 잡힌다 ----------------
def hook(img, d, t, ta, T):
    templates.hook(img, d, t, ta, T, nar["hook"], ("WRINKLING",),
                   lambda im, dd, tt, tta: A.hook_art(im, dd, tta, wrinkle(tta, 0.6, 8.0)))


DRAW["hook"] = hook


# ---------------- clue: 같은 물, 같은 수면. 신경 신호가 지난 손끝만 주름이 잡힌다 ----------------
def clue(img, d, t, ta, T):
    c1 = cardt(T, 1, 0)
    A.bath(img, d, ta, wrinkle(ta, 0.6, 9.8), pulse_t=ta - 0.2 if ta >= 0.2 else None, labels=t >= at(T, 0) + 0.2)
    if t >= c1 + 0.7 or blinking(t, c1, 0.7):
        E.text(img, (142, 60), "?", "bold", E.TEXT, scale=2)
    T.sfx = [(0.3, "pop")]


DRAW["clue"] = clue


# ---------------- inside(핵심): 신호 → 혈관이 가늘어짐 → 속살이 줄어듦 ----------------
def inside(img, d, t, ta, T):
    st = A.section_state(ta, at(T, 1) + 0.2, cardt(T, 2, 1))
    A.section(img, d, ta, st)
    names = set()
    if t >= cardt(T, 1, 1):
        names.add("NERVE")
    if t >= cardt(T, 1, 1) + 0.8:
        names.add("VESSEL")
    if t >= cardt(T, 2, 1):
        names.add("PULP")
    A.section_labels(img, d, st, names)
    T.sfx = [(0.3, "pop"), (at(T, 1) + 0.2 + A.ARRIVE, "zap"), (cardt(T, 2, 1), "fall")]


DRAW["inside"] = inside


# ---------------- fold(핵심): 같은 단면을 ×2로 더 가까이, 피부가 접힌다 ----------------
T_ZOOM = 0.9


def fold(img, d, t, ta, T):
    st = A.section_state(ta + INSIDE.length, at(INSIDE, 1) + 0.2, cardt(INSIDE, 2, 1))
    zoom = t >= T_ZOOM
    A.section(img, d, ta, st, zoom)
    if not zoom:
        A.section_labels(img, d, st, {"NERVE", "VESSEL", "PULP"})
        if blinking(t, T_ZOOM - 0.6, 0.6):
            x0, y0 = A.VIEW2
            dotted_rect(d, (x0, y0, x0 + E.W // 2, y0 + A.STAGE_H // 2), E.INK)
    else:
        names = set()
        if t >= cardt(T, 0, 1):
            names.add("SKIN")
        if t >= cardt(T, 0, 2):
            names.add("FOLD")
        A.section_labels(img, d, st, names, zoom=True)
    T.sfx = []


DRAW["fold"] = fold


# ---------------- proof: 물 무대(WATER)와 크림 무대(EMLA)를 나란히 ----------------
def proof(img, d, t, ta, T):
    t1, c2a, c2b = at(T, 1), cardt(T, 2, 0), cardt(T, 2, 1)
    s_w, s_e = wrinkle(ta, 0.6, 4.6), wrinkle(ta, t1 + 1.6, t1 + 5.6)
    cream = t - (t1 + 0.2) if t >= t1 + 0.2 else None
    fu = tween(ta, c2a, c2a + 0.8, 0, 1) if t >= c2a else None
    num_w = "-2.29 cm/s" if t >= c2a + 0.3 else None
    num_e = "-2.01 cm/s" if t >= c2a + 1.1 else None
    rows = [("WATER", E.INK, lambda im, dd, tt, tta, y: A.proof_card(im, dd, tta, y, s_w, True, None, fu, num_w)),
            ("EMLA", E.PURPLE, lambda im, dd, tt, tta, y: A.proof_card(im, dd, tta, y, s_e, False, cream, fu, num_e))]
    compare(img, d, t, ta, rows, t1)
    if t >= c2b:
        E.text(img, (14, 28), "n = 25", "label", E.LABEL)
    T.sfx = [(0.3, "pop")]


DRAW["proof"] = proof


# ---------------- finale: 욕조로 돌아와, 주름이 신경 작동의 표시 ----------------
def finale(img, d, t, ta, T):
    s1 = at(T, 1)
    A.bath(img, d, ta, 12, pulse_t=ta + 1.0)
    if t >= at(T, 0) + 0.1:                                  # 손가락 위에 얹는 이름표(CARD 판)
        w = E.text_w("WRINKLE TEST", "bold") + 12
        d.rectangle(((E.W - w) // 2, 6, (E.W + w) // 2, 26), fill=E.CARD, outline=E.INK)
        E.center_text(img, 10, "WRINKLE TEST", "bold", E.TEXT)
    if t >= s1:
        SPARKLE_MASCOT.paste(img, t - s1, (160, 116))
    T.sfx = [(0.3, "pop"), (s1, "sparkle")]


DRAW["finale"] = finale

if __name__ == "__main__":
    ep.main()
