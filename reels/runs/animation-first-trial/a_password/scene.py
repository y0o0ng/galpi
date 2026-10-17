"""형식 2 시험 장면 A: 추상 정보(비밀번호 탐색 공간). 실행: reels/.venv/bin/python reels/runs/animation-first-trial/a_password/scene.py
결과는 reels/media/animation-first-trial/(gitignore)에 쓴다. 게시용이 아니다."""
import sys
from pathlib import Path

HERE = Path(__file__).parent
ROOT = HERE.parents[2]
sys.path.insert(0, str(ROOT))
from px import engine as E  # noqa: E402
from px.templates import SPARKLE_MASCOT, Episode, dotted_rect, pointer  # noqa: E402
from px.timeline import span, tween  # noqa: E402

DRAW = {}
ep = Episode(HERE, ("hook", "grow", "search", "wide"), DRAW, "ep99_trial_a", media=ROOT / "media" / "animation-first-trial")


def star(d, cx, cy, col):
    """비밀번호 칸 속 가림표: 점 5개 십자."""
    d.point([(cx, cy - 2), (cx - 2, cy), (cx, cy), (cx + 2, cy), (cx, cy + 2)], fill=col)


def box(d, x, y, w, h, col, fill=E.CARD):
    d.rectangle((x, y, x + w - 1, y + h - 1), fill=fill, outline=col)


def cells(d, x0, y0, n_cols, n_rows, pitch, size, on, col, off=E.DEEP):
    """n_cols x n_rows 칸 중 앞 on개(왼쪽→오른쪽, 위→아래)를 col로, 나머지는 off로."""
    for k in range(n_cols * n_rows):
        x, y = x0 + (k % n_cols) * pitch, y0 + (k // n_cols) * pitch
        d.rectangle((x, y, x + size - 1, y + size - 1), fill=col if k < on else off)


def hook(img, d, t, ta, T):
    ev = T.events
    T.say(img, t, "비밀번호는 한 자리 늘면 얼마나 어려워질까?")
    xs = [30, 66, 102, 138]
    for k, x in enumerate(xs):
        box(d, x, 150, 30, 40, E.INK)
        star(d, x + 15, 170, E.INK if (int(ta * 12) // 6 + k) % 2 else E.TEXT)
    if t >= ev["fifth_box"]:
        u = span(ta, ev["fifth_box"], ev["fifth_box"] + 0.5)
        w = max(2, round(30 * u))
        box(d, 174, 150, w, 40, E.PURPLE)
        if u >= 1:
            star(d, 189, 170, E.PURPLE)
    if t >= ev["mascot"]:
        SPARKLE_MASCOT.paste(img, t - ev["mascot"], (112, 290))
    T.sfx = [(ev["fifth_box"], "pop", "event"), (ev["mascot"], "sparkle", "accent")]


DRAW["hook"] = hook


def grow(img, d, t, ta, T):
    ev = T.events
    T.say(img, t, "1자리", "label", (112, 60))
    T.say(img, t, "10가지", "number", (112, 94))
    T.say(img, t, "2자리", "label", (112, 130))
    T.say(img, t, "100가지", "number", (112, 220))
    T.say(img, t, "3자리", "label", (112, 256))
    T.say(img, t, "1,000가지", "number", (112, 322))
    T.say(img, t, "자리가 하나 늘 때마다 경우의 수는 10배")
    # 1자리: 열 칸이 차례로 켜진다
    n1 = round(tween(ta, ev["row"], ev["row"] + 1.0, 0, 10, rnd=True)) if t >= ev["row"] else 0
    cells(d, 32, 76, 10, 1, 16, 14, n1, E.INK)
    # 2자리: 열 칸 줄이 열 줄이 된다(10 x 10)
    if t >= ev["grid"]:
        n2 = round(tween(ta, ev["grid"], ev["grid"] + 1.5, 0, 100, rnd=True))
        cells(d, 77, 146, 10, 10, 7, 6, n2, E.INK)
    # 3자리: 100칸 묶음이 열 개(5 x 2)
    if t >= ev["stack"]:
        k_on = round(tween(ta, ev["stack"], ev["stack"] + 1.5, 0, 10, rnd=True))
        for k in range(10):
            x, y = 49 + (k % 5) * 24, 272 + (k // 5) * 24
            cells(d, x, y, 10, 10, 2, 2, 100 if k < k_on else 0, E.PURPLE, E.DEEP)
    T.sfx = [(ev["row"] + 0.9, "click", "event"), (ev["grid"] + 1.4, "click", "event"), (ev["stack"] + 1.4, "click", "event")]


DRAW["grow"] = grow


def search(img, d, t, ta, T):
    ev = T.events
    T.say(img, t, "4자리 숫자 비밀번호는 10,000가지")
    T.say(img, t, "시도한 경우", "label", (112, 82))
    for s in ("2,500", "5,000", "7,500", "10,000"):
        T.say(img, t, s, "number", (112, 316), fill=E.PURPLE if s == "10,000" else E.INK)
    p = span(ta, ev["start"], ev["p100"]) if t >= ev["start"] else 0.0
    done = round(p * 10000)
    x0, y0 = 13, 100
    d.rectangle((x0 - 1, y0 - 1, x0 + 200, y0 + 200), outline=E.LABEL)
    d.rectangle((x0, y0, x0 + 199, y0 + 199), fill=E.DEEP)
    full = done // 100
    if full:
        d.rectangle((x0, y0, x0 + 199, y0 + full * 2 - 1), fill=E.INK)       # 시도를 마친 줄
    if 0 < done < 10000:
        if done % 100:
            d.rectangle((x0, y0 + full * 2, x0 + (done % 100) * 2 - 1, y0 + full * 2 + 1), fill=E.INK)
        d.rectangle((x0, y0 + full * 2 - 1 if full else y0, x0 + 199, y0 + full * 2 + 2), outline=E.PURPLE)   # 지금 훑는 줄
    T.sfx = [(ev["p25"], "click", "event"), (ev["p50"], "click", "event"), (ev["p75"], "click", "event"), (ev["p100"], "sparkle", "accent")]


DRAW["search"] = search


def wide(img, d, t, ta, T):
    ev = T.events
    x0, y0 = 13, 100
    if t < ev["cut"]:                                           # 앞 장면의 마지막 화면 그대로(4자리 전부 시도 끝)
        d.rectangle((x0 - 1, y0 - 1, x0 + 200, y0 + 200), outline=E.LABEL)
        d.rectangle((x0, y0, x0 + 199, y0 + 199), fill=E.INK)
        return
    T.say(img, t, "8자리가 되면")
    T.say(img, t, "100,000,000", "number", (112, 56))
    d.rectangle((x0 - 1, y0 - 1, x0 + 200, y0 + 200), outline=E.LABEL)
    d.rectangle((x0, y0, x0 + 199, y0 + 199), fill=E.DEEP)   # 칸 하나 = 4자리 전체(10,000가지); 100 x 100칸이 8자리 전체
    for k in range(0, 200, 2):                                # 칸 사이 격자선
        d.line((x0 + k, y0, x0 + k, y0 + 199), fill=E.BG)
        d.line((x0, y0 + k, x0 + 199, y0 + k), fill=E.BG)
    cx, cy = x0 + 100, y0 + 100
    d.rectangle((cx, cy, cx + 1, cy + 1), fill=E.INK)
    if t >= ev["point"] and int(ta * 12) // 3 % 2 == 0:
        dotted_rect(d, (cx - 5, cy - 5, cx + 6, cy + 6), E.PURPLE)
    T.say(img, t, "4자리 전체", "label", (112, 312))
    pointer(img, t, ev["point"], 6.5, 176, 266, face="left")
    T.sfx = [(ev["cut"], "pop", "event"), (ev["point"], "sparkle", "accent")]


DRAW["wide"] = wide

if __name__ == "__main__":
    ep.main()
