"""4편 도트판(hook~finale). 실행: reels/.venv/bin/python episodes/ep04_stepped_drum_px/scene.py"""
import math
import sys
from pathlib import Path

HERE = Path(__file__).parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(HERE))
from px import engine as E, templates  # noqa: E402
from px.sprite_anim import Anim  # noqa: E402
from px.templates import SPARKLE_MASCOT, Episode, compare, kicker, mascot_frame, steps  # noqa: E402
from px.timeline import at, ease_in_out, ease_out, span, step, tween  # noqa: E402
import art as A  # noqa: E402

DRAW = {}
ep = Episode(HERE, ("hook", "problem", "drum", "set", "repeat", "shift", "finale"), DRAW, "ep04_px_preview")
nar = ep.nar
TURN, PX = 4.0, 1                                 # 큰 무대 크랭크 한 바퀴(초)와 느린 구간의 프레임당 px(아래 set_shift)
TURN_SMALL, PX_SMALL = 4.5, 1                     # 카드 안 작은 드럼: 54px ÷ 1 ÷ 12 = 4.5초


def kick(img):
    E.text(img, (10, 10), "STEPPED DRUM", "bold", E.INK)


# ---------------- hook ----------------
BX, BY, UNIT, THICK, PITCH = 15, 132, 10, 9, 12   # 옆모습 계단: 줄 9개(위가 가장 긴 9칸), 줄 두께 9·간격 3


def hook_art(img, d, t, ta, T):
    b0, p0, g0 = 0.9, at(T, 1, 0.5), at(T, 2)
    d.rectangle((10, BY, 13, BY + 8 * PITCH + THICK - 1), fill=E.LABEL)      # 줄 왼쪽 끝이 닿는 축 쪽 판
    for i in range(9):
        u = ease_out(span(ta, b0 + 0.12 * i, b0 + 0.12 * i + 0.4))           # 줄이 길이만큼 차례로 뻗는다(길이가 서로 다르다)
        ln = round((9 - i) * UNIT * u)
        if ln > 0:
            pulse = p0 + 0.25 * i <= ta < p0 + 0.25 * i + 0.25                # 문장 2: 줄이 위에서 아래로 차례로 번쩍
            d.rectangle((BX, BY + i * PITCH, BX + ln - 1, BY + i * PITCH + THICK - 1), fill=E.TEXT if pulse else E.INK)
    if t >= 2.3:                                                              # 작은 기어: 문장 3에서 반 바퀴
        A.gear(img, 53, BY + 8 * PITCH + THICK // 2, "hook", round(tween(ta, g0, g0 + 1.5, 0, 180, ease_in_out) / 15) * 15)


def hook(img, d, t, ta, T):
    templates.hook(img, d, t, ta, T, nar["hook"], ("STEPPED", "DRUM"), lambda img, d, t, ta: hook_art(img, d, t, ta, T),
                   [(at(T, 2), "pop")])


# ---------------- problem ----------------
def problem(img, d, t, ta, T):
    kick(img)
    t1, b0 = at(T, 1), at(T, 2, 0.3)

    def left(img, d, t, ta, y0):
        A.centered(img, "3 × 2", 90, y0 + 37, 3)

    def right(img, d, t, ta, y0):
        s, f = "3 + 3", E.FONT["bold"]
        x0 = 90 - E.text_w(s, "bold", 3) // 2
        x, y = A.ink_xy(s, 90, y0 + 37, 3)
        on = b0 <= ta < b0 + 1.4 and int((ta - b0) * 12) % 6 < 3             # 두 3이 같은 색으로 두 번 깜빡
        for k, ch in ((0, "3"), (2, "+"), (4, "3")):
            gx = x0 + int(f.getlength(s[:k])) * 3
            hot = on and ch == "3"
            if hot:
                d.rectangle((gx - 2, y + 5, gx + int(f.getlength(ch)) * 3 + 1, y + 34), fill=E.DEEP)
            E.text(img, (gx, y), ch, "bold", E.INK if hot else E.TEXT, 3)

    compare(img, d, t, ta, (("", E.LABEL, left), ("", E.INK, right)), t1)
    if t >= t1:
        A.centered(img, "=", 90, 132, 2)
    T.sfx = [(0.3, "pop"), (t1, "pop"), (b0, "pop")]


# ---------------- 큰 드럼 무대(drum·set 공통) ----------------
BIG = A.Drum(20, 36, 6, 4, 17)                    # 안쪽 가로 108(슬롯 6, 톱니 4), 세로 170(한 칸 17)
CNT = (134, 60, 36, 52)                           # 숫자창 x, y, w, h


def stage(img, d, *, gy, lit=0, shift=0, deg=0, value=0, frame_col=E.LABEL, hot=None, grow=None, flash=False,
          scale=True, gear=True, counter=True, frame_u=1.0, border=E.PURPLE):
    if frame_u >= 1:
        BIG.frame(d, frame_col)
    elif frame_u > 0:                                                         # 위에서 아래로 자라는 틀
        d.rectangle((BIG.x0 - 1, BIG.top - 1, BIG.x0 + BIG.W, BIG.top - 1 + round((BIG.H + 1) * frame_u)), outline=frame_col)
    if frame_u >= 1:
        if scale:
            BIG.scale(img, hot)
        BIG.teeth(d, shift, lit, grow, flash)
        if gear:
            A.gear(img, BIG.cx, gy, "big", deg)
        if counter:
            x, y, w, h = CNT
            A.counter(img, d, x, y, w, h, value, 3)
            if border != E.PURPLE:
                d.rectangle((x, y, x + w, y + h), outline=border)


def frame_time(s0, k):
    """12fps 프레임 번호가 처음 k에 닿는 화면 시각(소리를 그림에 맞춘다)."""
    return math.ceil(s0 * 12 + k - 0.5 - 1e-9) / 12


def set_shift(k):
    """큰 드럼 한 바퀴의 k번째 프레임까지 지나간 px: 밝은 3줄이 기어를 치는 앞 18px는 프레임당 1px(한 번 칠 때마다 6프레임=0.5초),
    나머지 90px는 프레임당 3px(30프레임). 한 바퀴 48프레임 = 4.0초."""
    return k if k <= 18 else min(18 + 3 * (k - 18), BIG.W)


def spin_set(ta, s0):
    k = min(max(round((ta - s0) * 12), 0), 48) if ta >= s0 else 0
    return k, set_shift(k)


def spin(ta, s0, turn=TURN, px=PX, w=BIG.W):
    """s0에 시작한 한 바퀴의 12fps 프레임 번호 k와 지나간 px. 시작 전이면 (0, 0), 끝나면 w(= 한 바퀴)."""
    k = min(max(round((ta - s0) * 12), 0), round(turn * 12)) if ta >= s0 else 0
    return k, min(px * k, w)


# ---------------- drum ----------------
def drum(img, d, t, ta, T):
    kick(img)
    f0, g0, ge, ce = at(T, 0, 0.2), at(T, 1, 0.1), at(T, 2, 0.2), at(T, 3, 0.2)
    grow = [ease_out(span(ta, g0 + 0.2 * i, g0 + 0.2 * i + 0.6)) for i in range(9)]    # 톱니 아홉 개가 길이만큼 차례로 자란다
    if t >= f0:
        stage(img, d, gy=BIG.gy(0), grow=grow, scale=t >= g0, gear=t >= ge, counter=t >= ce, value=0,
              frame_col=E.INK if t < ge else E.LABEL, frame_u=ease_out(span(ta, f0, f0 + 0.5)))
    cur = 0 if t < ge else 1 if t < ce else 2                                  # 범례: 지금 말하는 것만 글자색
    if t >= f0:
        E.text(img, (20, 211), "STEPPED DRUM", "label", E.TEXT if cur == 0 else E.LABEL)
    if t >= ge:
        y = BIG.gy(0)
        d.line((BIG.cx + 10, y, 131, y), fill=E.LABEL)
        d.rectangle((BIG.cx + 9, y - 1, BIG.cx + 10, y), fill=E.LABEL)
        E.text(img, (134, y - 6), "GEAR", "label", E.TEXT if cur == 1 else E.LABEL)
    if t >= ce:
        E.text(img, (152 - E.text_w("COUNTER", "label") // 2, 46), "COUNTER", "label", E.TEXT if cur == 2 else E.LABEL)
    T.sfx = [(f0, "pop"), (g0, "pop"), (ge, "pop"), (ce, "pop")]


# ---------------- set ----------------
POINT = Anim([mascot_frame("pointing")], mode="once", flip=True)               # 거울상: 눈동자가 왼쪽(밝아진 톱니 쪽)


def set_scene(img, d, t, ta, T):
    kick(img)
    s0 = at(T, 0, 0.3)                                                        # 문장 1: 기어가 3번 자리로 미끄러진다
    s1 = s0 + 1.0
    lit0 = m0 = at(T, 1)                                                      # 문장 2: 가장 긴 세 줄이 밝아지고 시온이 가리킨다
    card, st, du = T.plan[3]                                                  # 문장 3 카드 `크랭크를…/그 세 개만…`: "세"가 찍히는 때 바퀴 시작
    sp1, to0 = E.char_times(card, st, du)[14], at(T, 3)                                             # 문장 3 시작: 한 바퀴 / 문장 4: 0 자리로 옮긴 뒤 한 바퀴
    to0e = sp2 = to0 + 0.5
    back0 = sp2 + TURN - 0.5                                                  # 두 번째 바퀴가 끝나기 직전에 3 자리로 되돌린다
    back1 = back0 + 0.5
    lit_on = (lit0 <= t < to0) or t >= back0
    y3, y0 = BIG.gy(3), BIG.gy(0)
    if t < s0:
        gy, hot = y0, 0
    elif t < s1:
        gy, hot = tween(ta, s0, s1, y0, y3, ease_in_out, True), None
    elif t < to0:
        gy, hot = y3, 3
    elif t < to0e:
        gy, hot = tween(ta, to0, to0e, y3, y0, ease_in_out, True), None
    elif t < back0:
        gy, hot = y0, 0
    elif t < back1:
        gy, hot = tween(ta, back0, back1, y0, y3, ease_in_out, True), None
    else:
        gy, hot = y3, 3
    _, s_1 = spin_set(ta, sp1)
    _, s_2 = spin_set(ta, sp2)
    if t < sp2:                                                               # 첫 바퀴(자리 3) 동안과 그 뒤
        shift, value, deg = s_1 % BIG.W, BIG.hits(3, s_1), BIG.angle(3, s_1, PX, 60)
    else:                                                                     # 둘째 바퀴(자리 0): 닿는 톱니가 없다
        shift, value, deg = s_2 % BIG.W, 3, 180
    flash = lit0 <= t < lit0 + 0.25 and int((t - lit0) * 12) % 2 == 0
    stage(img, d, gy=gy, lit=3 if lit_on else 0, shift=shift, deg=deg, value=value, hot=hot, flash=flash)
    cur = (0 if t >= back1 else -1) if t >= to0 else 2 if t >= sp1 + TURN else 1 if t >= sp1 else 0 if t >= 0.4 else -1   # S14: 0 자리라 +3도 꺼 둔다
    steps(img, ("SET 3", "TURN", "+3"), cur)
    if m0 <= t < sp1 + 0.4:                                                   # 시온: 오른쪽에서 들어와 가리키고 한 바퀴 시작에 퇴장
        x = tween(step(t), m0, m0 + 0.34, 200, 152, rnd=True) if t < sp1 else tween(step(t), sp1, sp1 + 0.4, 152, 200, rnd=True)
        POINT.paste(img, 0, (x, 208))
    T.sfx = [(0.3, "pop"), (m0, "sparkle"), (frame_time(sp1, next(k for k in range(49) if set_shift(k) >= BIG.cross(0))), "ticks_slow")]


# ---------------- repeat ----------------
def small_drum(img, d, y0, lit=3, shift=0, deg=0, value=3, border=E.PURPLE):
    """카드 안 작은 펼친 드럼 + 숫자창(기어 3 자리, 밝은 3줄)."""
    dr = A.Drum(82, y0 + 5, 3, 2, 6)
    dr.frame(d)
    dr.teeth(d, shift, lit)
    A.gear(img, dr.cx, dr.gy(3), "small", deg)
    A.counter(img, d, 141, y0 + 17, 22, 36, value, 2)
    if border != E.PURPLE:
        d.rectangle((141, y0 + 17, 163, y0 + 53), outline=border)
    return dr


def repeat(img, d, t, ta, T):
    kick(img)
    sp, ind = at(T, 1), at(T, 2, 0.1)
    k, s = spin(ta, sp, TURN_SMALL, PX_SMALL, 54)
    dr = A.Drum(82, 0, 3, 2, 6)
    hits = dr.hits(3, s)

    def once(img, d, t, ta, y0):
        small_drum(img, d, y0, deg=270)

    def twice(img, d, t, ta, y0):
        blink = ind <= ta < ind + 1.0 and int((ta - ind) * 12) % 6 < 3          # 문장 3: 결과 숫자창이 두 번 번쩍
        small_drum(img, d, y0, shift=s % 54, deg=270 + dr.angle(3, s, PX_SMALL, 90), value=3 + hits,
                   border=E.TEXT if blink else E.PURPLE)

    compare(img, d, t, ta, (("TURN ×1", E.LABEL, once), ("TURN ×2", E.INK, twice)), 0.3)
    if t >= 0.3:
        A.down_arrow(d, 90, 118, 144)
    T.sfx = [(0.3, "pop"), (frame_time(sp, math.ceil(dr.cross(0) / PX_SMALL)), "ticks")]


# ---------------- shift ----------------
def shift_scene(img, d, t, ta, T):
    kicker(img, "× 12")
    t1, l1, l2, e0 = at(T, 1), at(T, 2, 0.3), at(T, 2, 0.62), at(T, 3)

    def left(img, d, t, ta, y0):
        A.crank(d, 44, y0 + 44)
        E.text(img, (66, A.ink_xy("12", 0, y0 + 40, 3)[1]), "12", "bold", E.INK, 3)
        E.text(img, (118, y0 + 38), "TURNS", "bold")

    def right(img, d, t, ta, y0):
        if t >= l1:
            E.text(img, (28, y0 + 19), "2 TURNS", "bold")
            E.text(img, (90, y0 + 19), "→", "bold", E.LABEL)
            E.text(img, (104, y0 + 19), "6", "bold", E.INK)
        if t >= l2:
            E.text(img, (28, y0 + 31), "1 TURN", "bold")
            E.text(img, (90, y0 + 31), "→", "bold", E.LABEL)
            u = span(ta, l2 + 0.3, l2 + 0.5)                                  # 한 자리 옮김: 3이 왼쪽으로 한 칸 밀리고 0이 들어온다
            E.text(img, (104 + round(7 * (1 - u)), y0 + 31), "3", "bold", E.INK)
            if u >= 1:
                E.text(img, (111, y0 + 31), "0", "bold", E.INK)
        if t >= e0:
            E.text(img, (28, y0 + 43), "= 36", "bold", E.INK, 2)

    compare(img, d, t, ta, (("NO SHIFT", E.LABEL, left), ("SHIFT", E.INK, right)), t1)
    if t >= t1:
        d.line((70, 132, 110, 132), fill=E.LABEL)
    T.sfx = [(0.3, "pop"), (t1, "pop"), (l1, "pop"), (l2, "pop"), (e0, "pop")]


# ---------------- finale ----------------
def finale(img, d, t, ta, T):
    kick(img)
    r0, m0 = at(T, 1), at(T, 2)

    def setting(img, d, t, ta, y0):
        dr = A.Drum(90, y0 + 5, 3, 2, 6)
        dr.frame(d)
        dr.teeth(d, 0, 3)
        A.gear(img, dr.cx, dr.gy(3), "small", 270)

    def turning(img, d, t, ta, y0):
        A.crank(d, 60, y0 + 44)
        E.text(img, (84, A.ink_xy("×2", 0, y0 + 40, 3)[1]), "×2", "bold", E.TEXT, 3)

    compare(img, d, t, ta, (("SET", E.LABEL, setting), ("TURN", E.INK, turning)), 0.3)
    if t >= 0.3:
        A.centered(img, "×", 90, 132, 2)
    if t >= r0:
        A.centered(img, "= 6", 62, 237, 2, col=E.INK)
    if t >= m0:
        SPARKLE_MASCOT.paste(img, t - m0, (148, 247))
    T.sfx = [(0.3, "pop"), (r0, "pop"), (m0, "sparkle")]


DRAW.update(hook=hook, problem=problem, drum=drum, set=set_scene, repeat=repeat, shift=shift_scene, finale=finale)

if __name__ == "__main__":
    ep.main()
