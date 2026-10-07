"""6편 도트판(hook~finale). 실행: reels/.venv/bin/python episodes/ep06_c5_px/scene.py"""
import sys
from pathlib import Path

HERE = Path(__file__).parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(HERE))
from px import engine as E, templates  # noqa: E402
from px.templates import SPARKLE_MASCOT, Episode, compare, flow, kicker, pointer, steps  # noqa: E402
from px.timeline import at, ease_in_out, ease_out, span, tween  # noqa: E402
import art as A  # noqa: E402

DRAW = {}
ep = Episode(HERE, ("hook", "stream", "lost", "resend", "datacenter", "homa", "evidence", "finale"), DRAW, "ep06_px_preview")
nar = ep.nar
HOL = "HEAD-OF-LINE"
DESC = 0.45                                        # 블록이 RECV에서 APP로 내려가는 시간(초)


def cardt(T, i, k=0):
    """i번째 문장의 k번째 카드가 시작하는 장면 시각."""
    return at(T, i) + sum(E.card_secs(c) for c in E.split_cards(T.sents[i])[:k])


def tw(ta, a, b, v0, v1, ease=None):
    return tween(ta, a, b, v0, v1, ease, True)


def drop(img, d, ta, n, x0, x1, t0, style):
    """RECV 칸 x0의 블록 n을 t0부터 DESC초 동안 APP 칸 x1으로 내린다. 내려가기 전이면 그리지 않는다."""
    u = ease_in_out(span(ta, t0, t0 + DESC))
    A.block(img, d, round(x0 + (x1 - x0) * u), round(A.ROW_Y + (A.APP_Y - A.ROW_Y) * u), n, style)


# ---------------- hook ----------------
def hook(img, d, t, ta, T):
    blink = at(T, 1) + 0.1 <= t < at(T, 1) + 0.6                      # S2 시작: 이미 와 있는 4·5·6이 한 번 깜빡

    def art(img, d, t, ta):
        A.box(img, d, (22, 164, 90, 196), "RECV", 22, 152)               # 라벨은 상자 위(오른쪽은 시온 자리)
        flow(d, 0, ((78, 199), (78, 211)), E.LABEL, 1.0, phase=0)          # RECV→APP: 멈춘 길(맨 앞 빈칸 아래)
        A.box(img, d, (22, 214, 90, 245), "APP", 94, 224)
        for n, x in ((6, 26), (5, 41), (4, 56)):
            A.block(img, d, x, 172, n, "blink" if blink else "deep")
        A.gap(d, 71, 172)
        A.block(img, d, A.app_x(1) - 83, 222, 1)
        A.block(img, d, A.app_x(2) - 83, 222, 2)

    big = E.text_w("HEAD-OF-LINE", "bold") * 2 <= 170
    words = ("HEAD-OF-LINE", "BLOCKING") if big else ("HEAD-OF-", "LINE", "BLOCKING")
    templates.hook(img, d, t, ta, T, nar["hook"], words, art)


# ---------------- stream ----------------
def stream(img, d, t, ta, T):
    kicker(img, "TCP")
    s4, s5 = at(T, 1), at(T, 2)
    bar0, split, lit0 = cardt(T, 0, 1), s4 + 0.4, cardt(T, 1, 1)
    march0 = lit0 + 1.0
    shift = tw(ta, march0, march0 + 1.5, 0, 52, ease_in_out)
    desc = {n: cardt(T, 2, 1) + 0.5 * (n - 1) for n in (1, 2, 3)}      # "프로그램에 넘겨줘요." 동안 1, 2, 3 순서로 내려간다
    follow0 = desc[3] + 0.5                                         # 3이 내려간 뒤 4·5·6이 앞으로 따라온다
    follow = tw(ta, follow0, follow0 + 0.6, 0, 45, ease_out)
    on = round(ta * 12) * 2
    A.stage(img, d, A.RECV_X_STREAM,
            track=(ease_out(span(ta, split, split + 0.8)), shift, E.INK) if t >= split else None,
            arrow=(ease_out(span(ta, s5, s5 + 0.5)), on, E.INK) if t >= s5 else None, send=False)
    if bar0 <= t < split:                                           # 바이트 한 줄: 막대 하나
        w = round(90 * ease_out(span(ta, bar0, bar0 + 1.0)))
        d.rectangle((27, A.ROW_Y, 27 + w - 1, A.ROW_Y + A.BH - 1), fill=E.INK)
    if t >= split:
        for n in range(6, 0, -1):
            x = 27 + A.PITCH * (6 - n) + shift + (follow if n > 3 else 0)
            num = n if t >= lit0 + 0.15 * (n - 1) else None
            if n in desc and t >= desc[n]:
                drop(img, d, ta, n, x, x, desc[n], "ink")
            else:
                A.block(img, d, x, A.ROW_Y, num, "ink")
    A.send_box(img, d)
    T.sfx = [(0.3, "pop")]


# ---------------- lost ----------------
def lost(img, d, t, ta, T):
    c62, s7, s8, s9 = cardt(T, 0, 1), at(T, 1), at(T, 2), at(T, 3)
    gone = c62 + 0.5
    if t >= s9:
        kicker(img, HOL, 1)
    else:
        kicker(img, "TCP")
    adv = round(tween(ta, 0.4, c62, 0, 12) + tween(ta, c62, s7 + 0.2, 0, 8) + tween(ta, s7 + 0.2, s7 + 1.7, 0, 74, ease_out))
    held = t >= s8
    ph_arrow = round((s8 if held else ta) * 12) * 2
    A.stage(img, d, A.RECV_X_LOST, track=(1.0, adv, E.LABEL if held else E.INK),
            arrow=(1.0, ph_arrow, E.LABEL if held else E.INK), send=False)
    for k in (1, 2):
        A.block(img, d, A.app_x(k), A.APP_Y, k, "ink")
    if held:
        k = int((t - (s9 + 0.34)) * 12 + 1e-6)                     # 시온이 멈추는 순간 빈칸이 TEXT↔DANGER로 2번 깜빡
        if t >= s9 + 0.34 and k < 8 and k % 4 < 2:
            A.dotted_rect(d, (154, A.ROW_Y, 154 + A.BW - 1, A.ROW_Y + A.BH - 1), E.TEXT)
        else:
            A.gap(d, 154, A.ROW_Y)
    for n in (6, 5, 4):
        A.block(img, d, 45 - 15 * (n - 4) + adv, A.ROW_Y, n, "deep" if held else "ink")
    if t < gone:
        A.block(img, d, 60 + adv, A.ROW_Y, 3, "danger" if t >= c62 else "ink")
    A.send_box(img, d)
    if gone <= t < gone + 1.6:
        E.text(img, (68, 76), "LOST", "label", E.DANGER)
    pointer(img, t, s9, 1e9, 162, 82)
    T.sfx = [(c62, "danger"), (s9, "sparkle")]


# ---------------- resend ----------------
HOP = ((14, A.ROW_Y), (80, A.ROW_Y), (120, 58), (154, 58), (154, A.ROW_Y))      # 새 3: 길 → 위로 뛰어 → RECV 위를 지나 → 빈칸으로


def hop_pos(u):
    """HOP 경로를 u(0~1)만큼 간 위치(마디마다 길이를 가로·세로 중 큰 쪽으로 쟀다)."""
    lens = [max(abs(b[0] - a[0]), abs(b[1] - a[1])) for a, b in zip(HOP, HOP[1:])]
    s = u * sum(lens)
    for (a, b), n in zip(zip(HOP, HOP[1:]), lens):
        if s <= n:
            return round(a[0] + (b[0] - a[0]) * s / n), round(a[1] + (b[1] - a[1]) * s / n)
        s -= n
    return HOP[-1]


def resend(img, d, t, ta, T):
    c0, c2, c3 = at(T, 0), cardt(T, 0, 1), cardt(T, 0, 2)
    go, land = c0 + 0.2, c2 + 1.2
    deliver = t >= c3
    steps(img, ("LOST", "RESEND", "DELIVER"), 2 if deliver else 1 if t >= c0 else 0)
    A.stage(img, d, A.RECV_X_LOST, track=(1.0, 0, E.LABEL),
            arrow=(1.0, round(ta * 12) * 2, E.INK) if deliver else (1.0, 0, E.LABEL), send=False)
    for k in (1, 2):
        A.block(img, d, A.app_x(k), A.APP_Y, k, "ink")
    if t < land:
        A.gap(d, 154, A.ROW_Y)
    slot = {3: 154, 4: 139, 5: 124, 6: 109}
    start = {3: c3, 4: c3 + 0.3, 5: c3 + 0.55, 6: c3 + 0.8}              # 0.25초 간격으로 APP에 닿는다(4는 c3+0.75)
    for n in (6, 5, 4, 3):
        if n == 3 and t < land:
            if t >= go:
                x, y = hop_pos(ease_in_out(span(ta, go, land)))
                A.block(img, d, x, y, 3, "ink")
        elif t >= start[n]:
            drop(img, d, ta, n, slot[n], A.app_x(n), start[n], "ink")
        else:
            A.block(img, d, slot[n], A.ROW_Y, n, "ink" if n == 3 else "deep")
    A.send_box(img, d)
    T.sfx = [(0.3, "pop"), (c3 + 0.75, "ticks")]


# ---------------- datacenter ----------------
APP_DC = (128, 96, 172, 156)
ROAD_Y, MSG_Y, MSG_H = 126, 112, 28


def clipped(d, x, n, w, fill, y=MSG_Y, h=MSG_H):
    """메시지 띠를 APP 왼쪽 면(x 127)에서 잘라 그린다 = APP로 들어가는 중."""
    for i in range(n):
        x0 = x + i * w
        if x0 <= 127:
            d.rectangle((x0, y, min(x0 + w - 1, 127), y + h - 1), fill=fill, outline=E.BG)


def datacenter(img, d, t, ta, T):
    kicker(img, "ONE STREAM")
    long0, short0 = cardt(T, 0, 1), cardt(T, 0, 1) + 0.5
    m0 = cardt(T, 1, 1)                                              # "짧은 메시지도" 카드에서 LONG이 들어가기 시작
    m1 = m0 + 3.28                                                   # 다 들어간 뒤(장면 약 9.9초) SHORT가 들어간다
    lx = 52 + tw(ta, m0, m1, 0, 76)
    sx = 28 + tw(ta, m1, m1 + 0.8, 0, 100, ease_in_out)
    moving = m0 <= t < m1 + 0.8
    A.box(img, d, APP_DC, "APP", 141, 84, E.INK if moving else E.LABEL)
    flow(d, 0, ((8, ROAD_Y), (126, ROAD_Y)), E.LABEL, 1.0, phase=0)
    if t >= long0:
        clipped(d, lx, 7, 10, E.INK)
        if t < m1:                                                   # 라벨은 다 들어갈 때까지 보이는 띠를 따라간다
            lw, vis0, vis1 = E.text_w("LONG", "label"), lx, min(lx + 69, 127)
            if vis1 - vis0 + 1 >= lw:
                E.text(img, ((vis0 + vis1 - lw) // 2 + 1, 100), "LONG", "label", E.LABEL)
            else:
                E.text(img, (128 - lw, 100), "LONG", "label", E.LABEL)
    if t >= m1:                                                      # 받은 메시지는 APP 안에 작게 남는다
        A.message(d, 133, 103, 7, 5, 8, E.INK)
    if t >= m1 + 0.8:
        A.message(d, 133, 117, 1, 10, 8, E.INK)
    if t >= short0:
        clipped(d, sx, 1, 20, E.INK)
        if sx + E.text_w("SHORT", "label") <= 126:
            E.text(img, (sx, 143), "SHORT", "label", E.LABEL)
    T.sfx = [(0.3, "pop")]


# ---------------- homa ----------------
def homa(img, d, t, ta, T):
    kicker(img, "HOMA")
    c14 = cardt(T, 0, 2)
    c3 = cardt(T, 1, 2)                                              # B·C가 각자 APP로
    prog = lambda a: ease_in_out(span(ta, a, a + 1.4))

    def tcp(img, d, t, ta, y0):
        A.box(img, d, (126, y0 + 24, 160, y0 + 52), "APP", 135, y0 + 6)
        flow(d, 0, ((24, y0 + 56), (122, y0 + 56)), E.LABEL, 1.0, phase=0)
        for n, x in ((6, 61), (5, 76), (4, 91)):
            A.block(img, d, x, y0 + 30, n, "deep")
        A.gap(d, 106, y0 + 30)

    def lanes(img, d, t, ta, y0):
        A.box(img, d, (126, y0 + 18, 160, y0 + 62), "APP", 135, y0 + 6)
        ys = [y0 + 20 + 14 * i for i in range(3)]
        for lab, y in zip("ABC", ys):
            E.text(img, (22, y), lab, "label", E.LABEL)
            flow(d, 0, ((32, y + 5), (122, y + 5)), E.LABEL, 1.0, phase=0)
        A.message(d, 77, ys[0], 2, 14, 12, E.DEEP, E.LABEL)         # A: 빈칸 하나 때문에 통째로 멈춤
        A.gap(d, 107, ys[0], 14, 12)
        A.message(d, 40 + round(89 * prog(c3)), ys[1], 2, 14, 12, E.INK)
        A.message(d, 52 + round(77 * prog(c3 + 0.5)), ys[2], 2, 14, 12, E.INK)

    compare(img, d, t, ta, (("TCP", E.LABEL, tcp), ("HOMA", E.INK, lanes)), c14)
    T.sfx = [(0.3, "pop"), (c14, "pop")]


# ---------------- evidence ----------------
def evidence(img, d, t, ta, T):
    kicker(img, "HOMA")
    t1, t_num, s17, s18 = cardt(T, 0, 1), cardt(T, 0, 2), at(T, 1), at(T, 2)

    def tcp(img, d, t, ta, y0):
        A.box(img, d, (132, y0 + 34, 160, y0 + 58), "APP", 137, y0 + 41)
        flow(d, 0, ((46, y0 + 45), (128, y0 + 45)), E.LABEL, ease_out(span(ta, 0.5, 2.0)), phase=0)   # 긴 대기
        E.text(img, (24, y0 + 21), "SHORT", "label", E.LABEL)
        A.message(d, 24, y0 + 35, 1, 20, 20, E.DEEP, E.LABEL)

    def homa(img, d, t, ta, y0):
        A.box(img, d, (44, y0 + 34, 72, y0 + 58), "APP", 49, y0 + 41)
        E.text(img, (24, y0 + 21), "SHORT", "label", E.LABEL)
        A.message(d, 24, y0 + 35, 1, 20, 20, E.INK)
        if t >= t_num:
            E.text(img, (78, y0 + 14), "7–83×", "bold", E.TEXT, 2)
            E.text(img, (80, y0 + 46), "TAIL LATENCY", "label", E.LABEL)
            if t >= s17:
                A.dotted_rect(d, (74, y0 + 10, 164, y0 + 40), E.LABEL)

    compare(img, d, t, ta, (("TCP, DCTCP", E.LABEL, tcp), ("HOMA", E.INK, homa)), t1)
    if t >= s18:
        E.text(img, (37, 229), "TCP API", "label", E.LABEL)
        A.sign_ne(img, d, 37 + 36 + 13, 234, E.TEXT)
        E.text(img, (37 + 36 + 26, 229), "HOMA API", "label", E.INK)
    T.sfx = [(0.3, "pop")]


# ---------------- finale ----------------
def finale(img, d, t, ta, T):
    kicker(img, HOL, 1)
    s20, b0 = at(T, 1), cardt(T, 0, 1) + 0.8                         # S19 둘째 카드 안에서 4·5·6이 한 번 깜빡
    A.stage(img, d, A.RECV_X_LOST, track=(1.0, 0, E.LABEL), arrow=(1.0, 0, E.LABEL), send=False)
    for k in (1, 2):
        A.block(img, d, A.app_x(k), A.APP_Y, k, "ink")
    A.gap(d, 154, A.ROW_Y)
    for n, x in ((6, 109), (5, 124), (4, 139)):
        A.block(img, d, x, A.ROW_Y, n, "text" if b0 <= t < b0 + 0.5 else "deep")
    A.send_box(img, d)
    if t >= s20:
        SPARKLE_MASCOT.paste(img, t - s20, (160, 247))                   # APP 라벨(x 114~132)에서 반짝이가 떨어지게 오른쪽으로
    T.sfx = [(0.3, "pop"), (s20, "sparkle")]


DRAW.update(hook=hook, stream=stream, lost=lost, resend=resend, datacenter=datacenter, homa=homa, evidence=evidence, finale=finale)

if __name__ == "__main__":
    ep.main()
