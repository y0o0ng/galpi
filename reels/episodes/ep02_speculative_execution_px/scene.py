"""2편 도트판(hook~finale). 실행: reels/.venv/bin/python episodes/ep02_speculative_execution_px/scene.py"""
import sys
from pathlib import Path

HERE = Path(__file__).parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(HERE))
from px import engine as E, templates  # noqa: E402
from px.sprite_anim import Anim  # noqa: E402
from px.templates import SPARKLE_MASCOT, Episode, compare, kicker, mascot_frame, steps  # noqa: E402
from px.timeline import at, back, ease_in_out, ease_out, step, tween  # noqa: E402
import art as A  # noqa: E402

DRAW = {}
ep = Episode(HERE, ("hook", "wait_guess", "steps", "check", "predictor", "spectre", "finale"), DRAW, "ep02_px_preview")
nar = ep.nar

# ---------------- hook (승인됨) ----------------
T_RUN, RUN_SECS = 1.3, 1.0                       # 블록이 오른쪽 가지 끝으로 달리는 구간(? 가 풀리기 전)
T_ARRIVE = T_RUN + RUN_SECS
HOOK_FORK = A.Fork(56, 204, 40, 40)


def bob(ta):
    """도착 뒤 ? 가 2도트 통통(올라갈 때 back 곡선): 글자 크기는 2배 그대로."""
    up = tween(ta, T_ARRIVE, T_ARRIVE + 0.25, 0, -2, back, rnd=True)
    return up if ta < T_ARRIVE + 0.25 else tween(ta, T_ARRIVE + 0.25, T_ARRIVE + 0.5, -2, 0, ease_out, rnd=True)


def fork_art(img, d, t, ta):
    HOOK_FORK.draw(d)
    HOOK_FORK.mark(img, bob(ta))
    A.runner(d, HOOK_FORK, ta, T_RUN, T_ARRIVE)


def hook(img, d, t, ta, T):
    templates.hook(img, d, t, ta, T, nar["hook"], ("SPECULATIVE", "EXECUTION"), fork_art, [(T_ARRIVE, "pop")])


# ---------------- wait_guess ----------------
def wait_guess(img, d, t, ta, T):
    kicker(img, "BRANCH ?")
    c0, c1 = at(T, 0, 0.1), at(T, 0, 0.95)
    g0 = at(T, 1, 0.5)

    def wait(img, d, t, ta, y0):
        f = A.Fork(84, y0 + 52, 14, 28)
        f.draw(d)
        A.block(d, f.pos(0), E.LABEL)
        A.pause(d, 96, y0 + 49)
        E.text(img, (112, y0 + 46), f"CYCLE {tween(ta, c0, c1, 0, 300, rnd=True):03d}", "label", E.LABEL)

    def guess(img, d, t, ta, y0):
        f = A.Fork(84, y0 + 52, 14, 28)
        f.draw(d)
        A.runner(d, f, ta, g0, g0 + 1.0)

    compare(img, d, t, ta, (("WAIT", E.LABEL, wait), ("GUESS", E.INK, guess)), at(T, 1))
    T.sfx = [(0.3, "pop"), (at(T, 1), "pop")]


# ---------------- steps ----------------
def steps_scene(img, d, t, ta, T):
    kicker(img, "SPECULATE")
    s_save, s_flop, s_guess, s_check = at(T, 0, 0.05), at(T, 0, 0.2), at(T, 0, 0.45), at(T, 0, 0.78)
    s_fly, s_land = s_check + 0.3, s_check + 0.9
    f = A.Fork(90, 160, 50, 50)
    if t >= 0.3:
        f.draw(d, E.INK if t >= s_land else E.LABEL)
        if t < s_fly:
            f.mark(img)
        if t >= s_flop:
            A.floppy(d, 12, 152)
            A.dashes(d, 32, 32 + int(tween(ta, s_flop + 0.1, s_flop + 0.5, 0, 52)) // 4 * 4, 160)
        if t < s_save:
            A.block(d, f.pos(-0.7))
        elif t < s_guess:
            A.runner(d, f, ta, s_save, s_save + 0.5, -0.7, 0)
        else:
            A.runner(d, f, ta, s_guess, s_guess + 1.0)
    if s_fly <= t < s_land:
        A.dot(d, (tween(ta, s_fly, s_land, 160, 90, ease_out, True), tween(ta, s_fly, s_land, 140, 160, ease_out, True)), E.TEXT)
    steps(img, ("SAVE", "GUESS", "CHECK"), 2 if t >= s_check else 1 if t >= s_guess else 0 if t >= s_save else -1)
    T.sfx = [(s_save, "pop"), (s_flop, "pop"), (s_land, "pop")]


# ---------------- check ----------------
POINT = Anim([mascot_frame("pointing")], mode="once", flip=True)       # 거울상: 눈동자가 왼쪽(≈ WAIT 쪽)


def check(img, d, t, ta, T):
    kicker(img, "BRANCH")
    keep, u0, m0 = at(T, 0, 0.8), at(T, 1, 0.3), at(T, 2)
    m1 = at(T, 2, 0.8)

    def right(img, d, t, ta, y0):
        f = A.Fork(52, y0 + 52, 12, 26)
        f.draw(d)
        A.block(d, f.pos(1))
        if t >= keep:
            E.text(img, (96, y0 + 34), "KEEP", "bold", E.INK)

    def wrong(img, d, t, ta, y0):
        f = A.Fork(52, y0 + 52, 12, 26)
        f.draw(d)
        A.runner(d, f, ta, u0, u0 + 1.0, 1, 0, ease_in_out, E.LABEL if t >= u0 + 0.5 else E.DANGER)
        if t >= u0:
            E.text(img, (88, y0 + 18), "UNDO", "label", E.LABEL)
        if t >= m0:
            A.approx(d, 82, y0 + 40)
            E.text(img, (95, y0 + 38), "WAIT", "bold", E.INK)

    compare(img, d, t, ta, (("RIGHT", E.LABEL, right), ("WRONG", E.LABEL, wrong)), at(T, 1))
    if m0 <= t < m1 + 0.4:                           # 마스코트: 오른쪽에서 들어와 가리키고 퇴장
        x = tween(step(t), m0, m0 + 0.34, 190, 152, rnd=True) if t < m1 else tween(step(t), m1, m1 + 0.4, 152, 190, rnd=True)
        POINT.paste(img, 0, (x, 246))
    T.sfx = [(0.3, "pop"), (u0, "pop"), (m0, "sparkle")]


# ---------------- predictor ----------------
CHIP_X, CHIP_Y = 54, 114
PRED0, PANEL = (CHIP_X + 8 + 40, CHIP_Y + 8, CHIP_X + 23 + 40, CHIP_Y + 23), (16, 112, 164, 172)


def predictor(img, d, t, ta, T):
    kicker(img, "BRANCH")
    grow, led0 = at(T, 0, 0.4), at(T, 0, 0.62)
    if t < grow:
        A.chip_body(d, CHIP_X, CHIP_Y, 72)
        A.chip_cells(d, CHIP_X, CHIP_Y)
    else:                                            # 예측기 칸만 남고 사각형 크기를 바꿔 4단계로 키운다
        u = min(int((ta - grow) * 12), 3) / 3
        x0, y0, x1, y1 = (round(a + (b - a) * u) for a, b in zip(PRED0, PANEL))
        d.rectangle((x0 + 1, y0 + 1, x1 + 1, y1 + 1), fill=E.SHADOW)
        d.rectangle((x0, y0, x1, y1), fill=E.DEEP if u < 1 else E.CARD, outline=E.INK)
        if t >= grow + 0.4:
            E.center_text(img, 96, "BRANCH PREDICTOR", "label", E.INK)
            A.leds(d, 23, 142, int(max(ta - led0, -1) * 6) + 1)
    T.sfx = [(0.3, "pop"), (grow, "pop")]


# ---------------- spectre ----------------
def spectre(img, d, t, ta, T):
    kicker(img, "SPECTRE")
    E.text(img, (16 + E.text_w("SPECTRE", "bold", 2), 22), "2018", "bold", E.LABEL)
    w, cch, tr, land = at(T, 0, 0.15), at(T, 0, 0.4), at(T, 0, 0.65), at(T, 0, 0.65, 1.2)
    b1, b2, fix = at(T, 1, 0.1), at(T, 1, 0.55), at(T, 2, 0.1)
    f = A.Fork(43, 148, 12, 18)
    A.chip_body(d, 8, 100, 70)
    f.draw(d, E.DANGER if t >= w else E.LABEL)
    slot = (157, 145)
    if t >= cch:
        A.cache(d, img, 112, 118)
        d.line((83, 146, 111, 146), fill=E.LABEL)
    end = f.pos(1)
    if t >= land + 4 / 12:                           # 블록이 흩어져 사라진 뒤 점만 남는다
        pass
    elif t >= land:
        A.dissolve(img, end, int((ta - land) * 12) + 1)
    elif t >= w:
        A.runner(d, f, ta, w, w + 0.6)
    else:
        A.block(d, f.pos(0))
    if tr <= t < land:                               # 점: 블록 자리에서 생겨 잠시 머물다 CACHE 칸으로 날아간다
        A.dot(d, (tween(ta, tr + 0.3, land, end[0], slot[0], ease_in_out, True),
                  tween(ta, tr + 0.3, land, end[1], slot[1], ease_in_out, True)), E.DANGER)
    elif t >= land and not any(b <= t < b + 0.25 for b in (b1, b2)):
        A.dot(d, slot, E.DANGER)
    if t >= fix:
        f.barrier(d)
        if t >= fix + 0.5:
            A.runner(d, f, ta, fix + 0.5, fix + 1.3, 0, 0.4)
    steps(img, ("WRONG", "TRACE", "FIX"), 2 if t >= fix else 1 if t >= tr else 0 if t >= w else -1)
    T.sfx = [(0.3, "pop"), (land, "danger"), (fix, "pop")]


# ---------------- finale ----------------
def finale(img, d, t, ta, T):
    kicker(img, "SPECULATE")
    m0 = at(T, 0, 0.6)
    bars = lambda spec: lambda img, d, t, ta, y0: A.timebars(d, 108, y0 + 8, spec)
    compare(img, d, t, ta, (("IDLE", E.LABEL, bars("WIW.")), ("SPECULATE", E.INK, bars("WSWW"))), at(T, 0, 0.3))
    if t >= m0:
        SPARKLE_MASCOT.paste(img, t - m0, (36, 246))
    T.sfx = [(0.3, "pop"), (m0, "sparkle")]


DRAW.update(hook=hook, wait_guess=wait_guess, steps=steps_scene, check=check, predictor=predictor, spectre=spectre, finale=finale)

if __name__ == "__main__":
    ep.main()
