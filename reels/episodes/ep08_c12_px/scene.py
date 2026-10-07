"""8편 도트판(hook~finale). 실행: reels/.venv/bin/python episodes/ep08_c12_px/scene.py"""
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(HERE))
from px import audio, engine as E, templates  # noqa: E402
from px.templates import SPARKLE_MASCOT, Episode, flow, kicker, pointer  # noqa: E402
from px.timeline import at, span  # noqa: E402
import art as A  # noqa: E402

DRAW = {}
ep = Episode(HERE, ("hook", "deep", "three", "make", "loop", "cape", "limit", "finale"), DRAW, "ep08_px_preview")
nar = ep.nar
BAND = "물길 만들기"


# ---------------- 소리: crack(바위가 갈라지는 소리) ----------------
def _crack():
    """낮은 사인파 딱 세 번, 0.09초 간격. 349 → 294 → 233 Hz(한 음씩 내려감), 각 0.05초 hann 엔벌로프, 세기는 1.0·0.85·0.7."""
    sr, n = audio.SR, int(0.05 * audio.SR)
    out = np.zeros(int(0.3 * sr))
    for k, (f, g) in enumerate(((349, 1.0), (294, 0.85), (233, 0.7))):
        i = int(0.09 * k * sr)
        out[i:i + n] += np.sin(2 * np.pi * f * np.arange(n) / sr) * np.hanning(n) * g
    return out * audio.SFX_VOL


_sfx = audio.sfx
audio.sfx = lambda kind: _crack() if kind == "crack" else _sfx(kind)             # place_sfx가 모듈 전역 sfx를 부른다


def cardt(T, i, k=0):
    """i번째 문장의 k번째 카드가 시작하는 장면 시각."""
    return at(T, i) + sum(E.card_secs(c) for c in E.split_cards(T.sents[i])[:k])


def typed_at(T, i, word):
    """i번째 문장에서 word(공백 무시)의 마지막 글자가 찍히는 장면 시각."""
    cards = E.split_cards(T.sents[i])
    pairs = []
    for card, start, dur in T.plan:
        if card in cards:
            pairs += [(c, ct) for c, ct in zip((c for ln in card for c in ln), E.char_times(card, start, dur)) if c != " "]
    s, w = "".join(c for c, _ in pairs), word.replace(" ", "")
    return pairs[s.index(w) + len(w) - 1][1]


def blinking(t, t0, secs):
    """t0부터 secs 동안 12fps로 2프레임씩 켜졌다 꺼진다(켜짐이면 True)."""
    return t0 <= t < t0 + secs and int((t - t0) * 12 + 1e-6) // 2 % 2 == 0


# ---------------- hook ----------------
def hook(img, d, t, ta, T):
    templates.hook(img, d, t, ta, T, nar["hook"], ("ENHANCED", "GEOTHERMAL", "SYSTEM"), A.hook_art)


DRAW["hook"] = hook


# ---------------- deep ----------------
def deep(img, d, t, ta, T):
    t_zoom = at(T, 0) + 0.3
    t_on = [t_zoom + 0.6 + 0.2 * k for k in range(5)]
    A.cutaway(img, d, t, ta, A.deep_outer, lambda im, dd, tt, tta, stg: A.deep_inner(im, dd, tt, tta, stg, t_on),
              A.DEEP_BOX, t_zoom, A.DEEP_STAGE, keep_outer=True)
    if t >= t_on[0]:
        flow(d, ta, ((168, 66), (168, 236)), E.INK, span(ta, t_on[0], t_on[4] + 0.4))    # 아래로 갈수록 뜨겁다
    T.sfx = [(0.3, "pop")]


DRAW["deep"] = deep


# ---------------- three ----------------
IH3, CARD_H3 = 44, 99
CARD_Y3 = (37, 139)
ICONS = (("HEAT", A.icon_heat), ("WATER", A.icon_water), ("PATHS", A.icon_paths))


def three(img, d, t, ta, T):
    kicker(img, "GEOTHERMAL")
    on1 = [typed_at(T, 0, "바위"), typed_at(T, 0, "그 속의 물"), typed_at(T, 0, "틈")]
    s6, s7 = typed_at(T, 1, "화산"), at(T, 2)
    y1, y2 = CARD_Y3
    if t >= 0.3:
        A.card(img, d, y1, CARD_H3, "HYDROTHERMAL", E.INK)
        for k, (name, icon) in enumerate(ICONS):
            A.cell(img, d, ta, A.CELL_X[k], y1 + 32, IH3, name, icon, t >= on1[k])
        if t >= s6:
            A.volcano(d, 16, y1 + 20)
            A.label(img, 34, y1 + 19, "PLATE EDGES")
    if t >= s7:
        A.card(img, d, y2, CARD_H3, "HOT ROCK", E.LABEL)
        for k, (name, icon) in enumerate(ICONS):
            A.cell(img, d, ta, A.CELL_X[k], y2 + 32, IH3, name, icon, k == 0)
    T.sfx = [(0.3, "pop")]


DRAW["three"] = three


# ---------------- make ----------------
def make(img, d, t, ta, T):
    templates.band(img, BAND)
    s8, c9a, c9b, c10a, c10b = at(T, 0), cardt(T, 1, 0), cardt(T, 1, 1), cardt(T, 2, 0), cardt(T, 2, 1)
    labels = {"hot"} if t >= s8 + 0.2 else set()
    if t >= c9a:
        labels.add("inj")
    if t >= c10a:
        labels.add("frac")
    flows = {"down": span(ta, c9b, c9b + 1.6)} if t >= c9b else {}
    st = {"inj": span(ta, c9a, c9a + 2.0), "new": span(ta, c10a, c10a + 0.8), "thick": t >= c10b, "labels": labels, "flows": flows,
          "zone_blink": s8 + 0.6 <= t < s8 + 0.85 or s8 + 1.0 <= t < s8 + 1.4}
    A.cutaway(img, d, t, ta, None, lambda im, dd, tt, tta, stg: A.big_stage(im, dd, tt, tta, st), (0, 0, 0, 0), -1, A.STAGE_BIG)
    T.sfx = [(0.3, "pop"), (c10a, "crack")]


DRAW["make"] = make


# ---------------- loop ----------------
def loop(img, d, t, ta, T):
    templates.band(img, BAND)
    c11a, c11b, s12 = cardt(T, 0, 0), cardt(T, 0, 1), at(T, 1)
    c13a, c13b, c13c, s14 = cardt(T, 2, 0), cardt(T, 2, 1), cardt(T, 2, 2), at(T, 3)
    prod = span(ta, c11a + 0.2, c11b + 1.0)
    labels = {"hot", "inj", "frac"}
    if t >= c11a + 0.2:
        labels.add("prod")
    if t >= s12:
        labels.add("legend")
    flows = {"down": 1.0}
    if t >= s12 + 0.1:
        flows["through"] = span(ta, s12 + 0.1, s12 + 3.2)
    if t >= c13a:
        flows["up"] = span(ta, c13a, c13a + 1.5)
    if t >= c13c:
        flows["back"] = span(ta, c13c, c13c + 0.9)
    st = {"inj": 1.0, "prod": prod, "new": 1.0, "thick": True, "lit": t >= c13b, "labels": labels, "flows": flows,
          "dim": t >= s14, "bold": t >= s14}
    A.cutaway(img, d, t, ta, None, lambda im, dd, tt, tta, stg: A.big_stage(im, dd, tt, tta, st), (0, 0, 0, 0), -1, A.STAGE_BIG)
    pointer(img, t, s14 + 0.2, T.length, 156, 248)
    T.sfx = [(0.3, "pop")]


DRAW["loop"] = loop


# ---------------- cape ----------------
def cape(img, d, t, ta, T):
    kicker(img, "UTAH")
    c2, c3, s16 = cardt(T, 0, 1), cardt(T, 0, 2), at(T, 1)
    st = {"grow": 230 * span(ta, c2, c3 + 1.6), "lit": t >= s16, "horiz": t >= c3, "mw": t >= s16}
    A.cutaway(img, d, t, ta, None, lambda im, dd, tt, tta, stg: A.cape_stage(im, dd, tt, tta, st), (0, 0, 0, 0), -1, A.STAGE_CAPE)
    T.sfx = [(0.3, "pop")]


DRAW["cape"] = cape


# ---------------- limit ----------------
def limit(img, d, t, ta, T):
    s17, c2, s18, s19 = at(T, 0), cardt(T, 0, 1), at(T, 1), at(T, 2)
    k, k19 = round(ta * 12), round(s19 * 12)
    phase = A.FLOW_STEP * k if ta < s19 else A.FLOW_STEP * k19 + (k - k19)             # S19부터 점선 전진 속도가 절반
    t_crack = typed_at(T, 0, "틈")
    st = {"crack": span(ta, t_crack, t_crack + 1.2), "shake": blinking(t, c2, s18 - c2), "danger": t >= c2, "quake": t >= c2,
          "ctrl": t >= s19, "phase": phase}
    A.cutaway(img, d, t, ta, lambda im, dd, tt, tta: A.mini_section(im, dd, tta, phase),
              lambda im, dd, tt, tta, stg: A.limit_stage(im, dd, tt, tta, st), A.LIMIT_BOX, 0.3, A.LIMIT_STAGE, keep_outer=True)
    if t >= s18:
        kicker(img, "POHANG 2017")
    T.sfx = [(0.3, "pop"), (c2, "danger")]


DRAW["limit"] = limit


# ---------------- finale ----------------
IHF, CARD_HF = 34, 77
CARD_YF = (36, 116)


def finale(img, d, t, ta, T):
    kicker(img, "EGS")
    s21, c2 = at(T, 1), cardt(T, 0, 1)
    y1, y2 = CARD_YF
    if t >= at(T, 0):
        A.card(img, d, y1, CARD_HF, "HOT ROCK", E.LABEL)
        A.card(img, d, y2, CARD_HF, "EGS", E.INK)
        for k, (name, icon) in enumerate(ICONS):
            A.cell(img, d, ta, A.CELL_X[k], y1 + 20, IHF, name, icon, k == 0)
            A.cell(img, d, ta, A.CELL_X[k], y2 + 20, IHF, name, icon, k == 0 or t >= c2)
    if t >= c2 + 0.3:
        u, yf, ph = span(ta, c2 + 0.3, c2 + 1.5), y2 + 20 + IHF + 4, round(ta * 12) * A.FLOW_STEP
        flow(d, ta, ((20, yf), (94, yf)), E.INK, min(u * 2, 0.999), phase=ph)
        if u > 0.5:
            flow(d, ta, ((94, yf), (164, yf)), E.PURPLE, (u - 0.5) * 2, phase=ph - 74)
    if t >= s21:
        SPARKLE_MASCOT.paste(img, t - s21, (152, 249))
    T.sfx = [(0.3, "pop"), (s21, "sparkle")]


DRAW["finale"] = finale

if __name__ == "__main__":
    ep.main()
