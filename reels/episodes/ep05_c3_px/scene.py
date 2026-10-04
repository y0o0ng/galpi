"""5편 도트판(hook~finale). 실행: reels/.venv/bin/python episodes/ep05_c3_px/scene.py"""
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(HERE))
from px import audio, draw as D, engine as E, templates  # noqa: E402
from px.templates import SPARKLE_MASCOT, Episode, compare, flow, kicker, pointer, steps  # noqa: E402
from px.timeline import at, ease_out, span, tween  # noqa: E402
import art as A  # noqa: E402

DRAW = {}
ep = Episode(HERE, ("hook", "problem", "ways", "inside", "area", "sun", "finale"), DRAW, "ep05_px_preview")
nar = ep.nar
KICK = "RADIATIVE COOLING"


# ---------------- 소리: radiate(방열판에서 열이 파동으로 차례로 떠나는 소리) ----------------
def _radiate():
    """낮은 사인파 세 번, 0.5초 간격. 한 번은 0.35초 hann 엔벌로프, 196Hz→175Hz로 내려가고 세기는 1.0·0.75·0.5."""
    sr, n = audio.SR, int(0.35 * audio.SR)
    out = np.zeros(int(1.4 * sr))
    t = np.arange(n) / sr
    one = np.sin(2 * np.pi * np.cumsum(196 - 21 * t / 0.35) / sr) * np.hanning(n)
    for k, g in enumerate((1.0, 0.75, 0.5)):
        i = int(0.5 * k * sr)
        out[i:i + n] += one * g
    return out * audio.SFX_VOL


_sfx = audio.sfx
audio.sfx = lambda kind: _radiate() if kind == "radiate" else _sfx(kind)       # place_sfx가 모듈 전역 sfx를 부른다


def cardt(T, i, k=0):
    """i번째 문장의 k번째 카드가 시작하는 장면 시각."""
    return at(T, i) + sum(E.card_secs(c) for c in E.split_cards(T.sents[i])[:k])


# ---------------- hook ----------------
def hook(img, d, t, ta, T):
    chip_on = at(T, 1) <= t < at(T, 1) + 0.5

    def art(img, d, t, ta):
        E.text(img, (16, 138), "-270°C", "label", E.LABEL)
        A.satellite(d, 46, 170, 34, wing=(24, 24), chip=E.TEXT if chip_on else E.DEEP)
        for i, wy in enumerate((173, 187, 201)):
            A.wave(d, 86, wy, 22, ta, E.INK, u=ease_out(span(ta, 1.0 + 0.3 * i, 2.8 + 0.3 * i)))

    templates.hook(img, d, t, ta, T, nar["hook"], ("RADIATIVE", "COOLING"), art)


# ---------------- problem ----------------
def problem(img, d, t, ta, T):
    kicker(img, KICK, 1)
    t1, f0, dot0, lit0 = at(T, 2), at(T, 1), at(T, 2, 0.1), cardt(T, 2, 1)

    def ground(img, d, t, ta, y0):
        A.ground(img, d, ta, y0, ease_out(span(ta, f0, f0 + 1.0)))

    def orbit(img, d, t, ta, y0):
        A.orbit_body(img, d, ta, y0, t >= lit0, min(6, max(0, int((ta - lit0) / 0.15) + 1)) if t >= lit0 else 0)

    compare(img, d, t, ta, (("GROUND", E.LABEL, ground), ("ORBIT", E.INK, orbit)), t1)
    T.sfx = [(0.3, "pop"), (t1, "pop")]


# ---------------- ways ----------------
HX0, HX1, HY0, HY1 = 76, 116, 108, 160             # 뜨거운 블록
WALL = (26, 90, 128, 176)


def ways(img, d, t, ta, T):
    kicker(img, KICK, 1)
    s_cond, s_conv, s_rad = at(T, 1), at(T, 2), at(T, 3)
    w1, w2, w3 = cardt(T, 4, 0), cardt(T, 4, 1), cardt(T, 4, 2)
    d.rectangle((HX0, HY0, HX1, HY1), fill=E.DEEP, outline=E.TEXT)
    E.text(img, (HX0 + (HX1 - HX0 - E.text_w("HEAT", "label")) // 2 + 1, HY0 + 4), "HEAT", "label", E.TEXT)
    if t >= s_cond:                                 # 전도: 맞닿은 블록(틈 없이 붙는다) + 건너가는 점
        d.rectangle((36, HY0, HX0 - 1, HY1), fill=E.CARD, outline=E.LABEL)
        stop = t >= w2                              # S11 ②: 벽 안(블록 끝)에서 멈춘다
        flow(d, ta, ((106, 134), (46, 134)), E.DEEP if stop else E.INK, ease_out(span(ta, s_cond + 0.2, s_cond + 1.0)),
             phase=round((w2 if stop else ta) * 12) * 2)
    if s_conv <= t < w1:                            # 대류: 블록 위로 올라가 오른쪽으로 빠진다(S11 ①에서 지워진다)
        flow(d, ta, ((96, 106), (96, 68), (156, 68)), E.INK, ease_out(span(ta, s_conv + 0.2, s_conv + 1.4)))
    if t >= w1:                                     # S11 ①: 위성 벽 + 바깥 VACUUM
        A.dotted_rect(d, WALL, E.LABEL)
        E.text(img, (130, 160), "VACUUM", "label", E.LABEL)
    if t >= s_rad:                                  # 복사: 물결 세 줄. S11 ③에서 2px로 벽을 지나 무대 끝까지
        for i, wy in enumerate((122, 134, 146)):
            if t >= w3:
                A.wave(d, HX1 + 2, wy, 46, ta, E.INK, 2, u=ease_out(span(ta, w3, w3 + 0.7)))
            else:
                A.wave(d, HX1 + 2, wy, 28, ta, E.INK, u=ease_out(span(ta, s_rad + 0.3 + 0.2 * i, s_rad + 1.0 + 0.2 * i)))
    steps(img, ("CONDUCT", "CONVECT", "RADIATE"), -1 if t < s_cond else 0 if t < s_conv else 1 if t < s_rad else 2)
    T.sfx = [(0.3, "pop")]


# ---------------- inside ----------------
def X(f):
    return round(14 + f * 152)


def Y(f):
    return round(44 + f * 170)


def inside(img, d, t, ta, T):
    kicker(img, KICK, 1)
    t_zoom, lit0, s13, s14 = at(T, 0, 0) + 1.0, cardt(T, 0, 1), at(T, 1), at(T, 2)
    w1 = cardt(T, 1, 1) + 7 / 12                    # 첫 물결 줄이 방열판을 떠나는 프레임; 0.5초 간격으로 둘째·셋째
    arrive = lit0 + 1.0                             # 히트파이프 점선이 방열판에 닿는 때

    def outer(img, d, t, ta):
        A.satellite(d, 70, 104, 40, wing=(38, 22), chip=E.DEEP)
        for i, wy in enumerate((106, 124, 142)):
            A.wave(d, 116, wy, 34, ta, E.INK, u=ease_out(span(ta, 0.4 + 0.2 * i, 1.0 + 0.2 * i)))

    def inner(img, d, t, ta, st):
        d.rectangle((X(.08), Y(.12), X(.62), Y(.72)), outline=E.LABEL, width=2)         # 위성 벽
        pipe_y = Y(.42)
        d.rectangle((X(.34) + 1, pipe_y - 1, X(.68) - 1, pipe_y + 1), fill=E.LABEL)     # 히트파이프: 벽을 뚫고 방열판까지
        d.rectangle((X(.2), Y(.38), X(.34), Y(.46)), fill=E.TEXT if t >= lit0 else E.DEEP)
        if t >= lit0:
            flow(d, ta, ((X(.34) + 2, pipe_y - 1), (X(.68) - 2, pipe_y - 1)), E.INK, span(ta, lit0, lit0 + 1.0))
        d.rectangle((X(.68), Y(.06), X(.71), Y(.94)), fill=E.DEEP, outline=E.INK if t >= arrive else E.LABEL)
        for i, f in enumerate((.2, .4, .6)):
            col = E.LABEL if t >= s14 else E.INK
            A.wave(d, X(.72), Y(f), X(.98) - X(.72), ta, col, u=ease_out(span(ta, w1 + 0.5 * i, w1 + 0.5 * i + 0.5)))
        lit = lambda a, b: E.TEXT if a <= t < b else E.LABEL
        E.text(img, (X(.2), Y(.46) + 3), "CHIP", "label", lit(lit0, lit0 + 1.2))
        E.text(img, (X(.2) + 4, Y(.38) - 11), "HEAT PIPE", "label", lit(lit0, lit0 + 1.2))
        E.text(img, (X(.68) - 4 - E.text_w("RADIATOR", "label"), Y(.06) - 1), "RADIATOR", "label", lit(arrive, arrive + 1.2))
        if t >= s14:
            E.text(img, (X(.98) - 18, Y(.2) - 16), "IR", "label", E.LABEL)

    if t >= 0.3:
        A.cutaway(img, d, t, ta, outer, inner, (65, 88, 121, 160), t_zoom)
    pointer(img, t, s13, s14, 128, 236)
    T.sfx = [(0.3, "pop"), (s13, "sparkle"), (w1, "radiate")]


# ---------------- area ----------------
def area(img, d, t, ta, T):
    kicker(img, "RADIATOR")
    a_t, t_t, s16, grow = cardt(T, 0, 0) + 0.6, cardt(T, 0, 1), at(T, 1), cardt(T, 1, 1)
    rise, blink0 = s16 + 0.3, s16 + 1.3
    hit = blink0

    def card(bottom):
        def art(img, d, t, ta, y0):
            on2 = bottom and t >= s16                                     # 아래 카드의 둘째 칩: S16 첫 카드에서 켜진다
            chips = (y0 + 22, y0 + 38) if bottom else (y0 + 30,)
            cys = [c + 4 for c in chips]
            end = 89 + (round(40 * ease_out(span(ta, grow, grow + 1.0))) if bottom else 0)
            for k, c in enumerate(chips):
                d.rectangle((22, c, 33, c + 7), fill=E.TEXT if (k == 0 or on2) else E.DEEP)
                d.rectangle((34, cys[k] - 1, 52, cys[k] + 1), fill=E.LABEL)
            d.rectangle((50, cys[0] - 1, 52, y0 + 58), fill=E.LABEL)
            u = ease_out(span(ta, 0.5, 1.5))
            flow(d, ta, ((35, cys[0] - 1), (50, cys[0] - 1), (50, y0 + 57)), E.INK, u)
            if on2:
                flow(d, ta, ((35, cys[1] - 1), (50, cys[1] - 1)), E.INK, ease_out(span(ta, s16, s16 + 0.5)))
            d.rectangle((50, y0 + 58, end, y0 + 61), fill=E.DEEP, outline=E.INK)
            for xl in (60, 80, 100, 120):
                if end > xl:
                    tc = 0.8 if xl < 89 else grow + (1 - (1 - (xl - 89) / 40) ** (1 / 3)) * 1.0
                    A.wave(d, xl, y0 + 57, 27, ta, E.INK, up=True, u=span(ta, tc, tc + 0.5))
            if not bottom and t >= a_t:                                   # AREA: 방열판 길이 괄호
                d.line((50, y0 + 65, 89, y0 + 65), fill=E.LABEL)
                d.line((50, y0 + 63, 50, y0 + 65), fill=E.LABEL)
                d.line((89, y0 + 63, 89, y0 + 65), fill=E.LABEL)
                E.text(img, (94, y0 + 59), "AREA", "label", E.TEXT)
            if t >= t_t:
                base = y0 + 44
                level, hot = base, False
                if bottom and t >= rise:
                    level = tween(ta, rise, rise + 1.0, base, y0 + 22, ease_out, True)
                    hot = blink0 <= ta < blink0 + 1.0 and int((ta - blink0) * 12) % 6 < 3
                    if t >= grow:
                        level = tween(ta, grow, grow + 1.0, y0 + 22, base, ease_out, True)
                A.thermometer(img, d, y0, level, y0 + 22 if t >= s16 else None, hot)
        return art

    compare(img, d, t, ta, (("HEAT", E.LABEL, card(False)), ("MORE HEAT", E.INK, card(True))), 0.3)
    T.sfx = [(0.3, "pop"), (hit, "danger")]


# ---------------- sun ----------------
BODY = (78, 122, 121, 165)                          # 몸통 44x44(날개 없음)


def sun(img, d, t, ta, T):
    kicker(img, KICK, 1)
    l0, r0 = at(T, 1, 0.1), at(T, 2)
    touch = l0 + 1.2
    x1, y1, x2, y2 = BODY
    if t >= 0.3:
        D.circle(d, 26, 98, 14, fill=E.TEXT, outline=E.TEXT)
        E.text(img, (16, 116), "SUN", "label", E.LABEL)
    hit = t >= touch
    if t >= 0.3:
        d.rectangle(BODY, fill=E.CARD, outline=E.LABEL)
    if t >= l0:
        flow(d, ta, ((36, 112), (68, 144), (76, 144)), E.TEXT, span(ta, l0, touch))
    if hit:
        d.rectangle((x1, y1, x1 + 1, y2), fill=E.DANGER)                  # 해 쪽 면만
    if t >= r0:
        top = (y1 + y2) // 2 - 33
        d.rectangle((x2 + 2, top, x2 + 5, top + 65), fill=E.DEEP, outline=E.INK)
        for i, wy in enumerate((125, 144, 163)):
            A.wave(d, x2 + 7, wy, 36, ta, E.INK, u=ease_out(span(ta, r0 + 0.3 + 0.2 * i, r0 + 1.0 + 0.2 * i)))
        if t >= r0 + 1.2:
            E.text(img, (166 - E.text_w("DEEP SPACE", "label"), 184), "DEEP SPACE", "label", E.LABEL)
    T.sfx = [(0.3, "pop"), (touch, "danger")]


# ---------------- finale ----------------
def finale(img, d, t, ta, T):
    kicker(img, KICK, 1)
    t1, m0 = cardt(T, 0, 1), cardt(T, 1, 2)
    c2, dur = E.split_cards(T.sents[1])[1], E.card_secs(E.split_cards(T.sents[1])[1])
    chars = [c for ln in c2 for c in ln]
    ct = E.char_times(c2, cardt(T, 1, 1), dur)
    lab = [ct[chars.index(c)] for c in "칩방전"]                             # CHIP·RADIATOR·POWER가 켜지는 시각

    def ground(img, d, t, ta, y0):
        A.ground(img, d, ta, y0)

    def orbit(img, d, t, ta, y0):
        A.panel(d, 22, y0 + 39, 42, y0 + 56)
        d.rectangle((43, y0 + 47, 51, y0 + 48), fill=E.LABEL)
        d.rectangle((52, y0 + 29, 91, y0 + 64), fill=E.CARD, outline=E.LABEL)
        d.rectangle((58, y0 + 41, 67, y0 + 48), fill=E.TEXT)
        d.rectangle((68, y0 + 43, 96, y0 + 45), fill=E.LABEL)
        flow(d, ta, ((69, y0 + 43), (95, y0 + 43)), E.INK)
        d.rectangle((97, y0 + 26, 100, y0 + 65), fill=E.DEEP, outline=E.INK)
        for wy in (y0 + 34, y0 + 46, y0 + 58):
            A.wave(d, 104, wy, 36, ta, E.INK)
        for (x, y, s), a in zip(((55, y0 + 51, "CHIP"), (97, y0 + 8, "RADIATOR"), (19, y0 + 26, "POWER")), lab):
            if t >= a:
                E.text(img, (x, y), s, "label", E.TEXT if t < a + 1.0 else E.LABEL)
        if t >= m0:                                                       # 세 부품을 하나로 묶는다
            d.rectangle((16, y0 + 22, 102, y0 + 68), outline=E.INK)

    compare(img, d, t, ta, (("GROUND", E.LABEL, ground), ("ORBIT", E.INK, orbit)), t1)
    if t >= m0:
        SPARKLE_MASCOT.paste(img, t - m0, (153, 247))
    T.sfx = [(0.3, "pop"), (t1, "pop"), (m0, "sparkle")]


DRAW.update(hook=hook, problem=problem, ways=ways, inside=inside, area=area, sun=sun, finale=finale)

if __name__ == "__main__":
    ep.main()
