"""7편 도트판(hook~finale). 실행: reels/.venv/bin/python episodes/ep07_c7_px/scene.py"""
import sys
from pathlib import Path

HERE = Path(__file__).parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(HERE))
from px import engine as E, templates  # noqa: E402
from px.templates import SPARKLE_MASCOT, Episode, compare, flow, kicker, pointer  # noqa: E402
from px.timeline import at, ease_in_out, ease_out, span  # noqa: E402
import art as A  # noqa: E402

DRAW = {}
ep = Episode(HERE, ("hook", "stop", "numbers", "vm", "swap", "fault", "gc", "limit", "finale"), DRAW, "ep07_px_preview")
nar = ep.nar
DESC = 1.4                                          # 페이지가 RAM ↔ DISK로 오가는 시간(swap)
BROKEN_U = 0.6                                      # 끊긴 점선: V3 흐름이 표를 막 벗어난 데까지만


def cardt(T, i, k=0):
    """i번째 문장의 k번째 카드가 시작하는 장면 시각."""
    return at(T, i) + sum(E.card_secs(c) for c in E.split_cards(T.sents[i])[:k])


def blinking(t, t0, secs=0.7):
    """t0부터 secs 동안 12fps로 2프레임씩 켜졌다 꺼진다(켜짐이면 True)."""
    return t0 <= t < t0 + secs and int((t - t0) * 12 + 1e-6) // 2 % 2 == 0


# ---------------- hook ----------------
def hook(img, d, t, ta, T):
    read = span(ta, 0.9, 1.9)                                                # READ가 빈칸으로
    hit = 1.9                                                                # 빈칸에 닿는 시각
    rise = span(ta, 2.8, T.length - 1.0)                                     # 디스크에서 천천히 올라온다

    def art(img, d, t, ta):
        A.box(img, d, (38, 118, 112, 168), "RAM", 40, 106)
        for k in range(1, 4):
            A.page(d, 44 + 16 * k, 130, 13, 26)
        A.slot(d, 44, 130, 13, 26, E.DANGER if blinking(t, hit, 0.5) else E.LABEL)
        A.label(img, 4, 130, "READ")
        flow(d, ta, ((4, 143), (41, 143)), E.INK, read)
        A.box(img, d, (38, 194, 112, 246), "DISK", 80, 200, E.PURPLE)
        A.page(d, 44, 214, 13, 26, "disk")
        if t >= hit + 0.5:
            flow(d, ta, ((50, 211), (50, 160)), E.PURPLE, rise)

    templates.hook(img, d, t, ta, T, nar["hook"], ("PAGE FAULT",), art)


DRAW["hook"] = hook


# ---------------- stop ----------------
def stop(img, d, t, ta, T):
    kicker(img, "GO GC")
    stop0 = cardt(T, 0, 2)

    def run(img, d, t, ta, y0):
        for k in range(3):
            flow(d, ta, ((22, y0 + 28 + 13 * k), (156, y0 + 28 + 13 * k)), E.INK)

    def halt(img, d, t, ta, y0):
        for k in range(3):
            flow(d, 0, ((22, y0 + 28 + 13 * k), (156, y0 + 28 + 13 * k)), E.LABEL, phase=0)
        d.rectangle((88, y0 + 20, 91, y0 + 66), fill=E.TEXT, outline=E.OUTLINE)

    compare(img, d, t, ta, (("RUN", E.INK, run), ("STOP", E.LABEL, halt)), stop0)
    T.sfx = [(0.3, "pop")]


DRAW["stop"] = stop


# ---------------- numbers ----------------
def numbers(img, d, t, ta, T):
    kicker(img, "STOP THE WORLD", 1)
    s5, x800 = at(T, 1), cardt(T, 1, 1)

    def median(img, d, t, ta, y0):
        E.text(img, (22, y0 + 32), "51 µs", "bold", E.TEXT, 2)

    def worst(img, d, t, ta, y0):
        E.text(img, (22, y0 + 32), "40 ms", "bold", E.TEXT, 2)
        if t >= x800:
            E.text(img, (96, y0 + 3), "×800", "bold", E.PURPLE, 2)

    compare(img, d, t, ta, (("MEDIAN", E.LABEL, median), ("WORST", E.INK, worst)), s5, t0=at(T, 0))
    T.sfx = [(0.3, "pop")]


DRAW["numbers"] = numbers


# ---------------- vm ----------------
def vm(img, d, t, ta, T):
    kicker(img, "VIRTUAL MEMORY", 1)
    c2, s7, c7b = cardt(T, 0, 1), at(T, 1), cardt(T, 1, 1)
    flash = cardt(T, 1, 0) + 1.2 <= t < cardt(T, 1, 0) + 1.8                # "페이지라는 조각": 칸들이 한 번 밝아진다
    lit = E.TEXT if flash else E.LABEL
    A.ram(img, d, {0: "lit" if flash else "ram", 1: "lit" if flash else "ram", 3: "lit" if flash else "ram", 4: "lit" if flash else "ram"})
    A.virtual(img, d, {i: lit for i in range(4)})
    if t >= c2 and t < c7b:
        for i in range(4):
            A.vflow(d, ta, i, E.INK, ease_out(span(ta, c2 + 0.3 * i, c2 + 0.3 * i + 0.9)))
    if t >= s7:
        A.table(img, d, {i: lit for i in range(4)})
    if t >= c7b:
        for i in range(4):
            A.vflow(d, ta, i, E.INK, ease_out(span(ta, c7b + 0.3 * i, c7b + 0.3 * i + 0.9)))
    T.sfx = [(0.3, "pop")]


DRAW["vm"] = vm


# ---------------- swap ----------------
def swap(img, d, t, ta, T):
    kicker(img, "SWAP")
    fade0, down0 = at(T, 0) + 0.3, cardt(T, 0, 2)
    arrive, s9 = down0 + DESC, at(T, 1)
    u = ease_in_out(span(ta, down0, arrive))
    moving = down0 <= t
    old = "faded" if t >= fade0 else "ram"
    A.ram(img, d, {0: "ram", 1: "ram", 3: "ram", 4: ("slot", E.LABEL) if moving else old})
    A.virtual(img, d)
    for i in range(4):
        if i == 3 and moving:
            A.vflow(d, ta, 3, E.LABEL, BROKEN_U, phase=0)                    # 표의 그 줄은 RAM 칸으로 이어지지 않는다
        else:
            A.vflow(d, ta, i, E.INK)
    A.table(img, d)
    A.disk(img, d)
    if moving:
        flow(d, ta, A.swap_path(True), E.PURPLE, u)
        y = A.ry(4) + round((A.DPAGE_Y - A.ry(4)) * u)
        A.page(d, A.RX, y, A.RW, A.RH, "disk" if ta >= arrive else "faded")
    if t >= s9:
        A.label(img, A.ARROW_X - 28, 190, "SWAP")
    T.sfx = [(0.3, "pop")]


DRAW["swap"] = swap


# ---------------- fault ----------------
def fault(img, d, t, ta, T):
    kicker(img, "PAGE FAULT")
    c_rd, s11 = cardt(T, 0, 1), at(T, 1)
    arr = at(T, 1, 0.85)
    waiting = s11 <= ta < arr                        # READ·표 줄·WAIT·페이지 도착이 모두 같은 12fps 시각(ta)으로 바뀐다 (C5)
    done = ta >= arr
    u = span(ta, s11, arr)
    y_page = A.DPAGE_Y + round((A.ry(4) - A.DPAGE_Y) * u)
    (_, y_tail), (_, y_tip) = A.swap_path(False)
    lead = min(1.0, (y_tail - (y_page - 6)) / (y_tail - y_tip))              # 화살표가 페이지보다 6px 앞서 올라간다
    A.ram(img, d, {0: "ram", 1: "ram", 3: "ram", 4: "ram" if done else ("slot", E.LABEL)})
    on = blinking(t, c_rd)
    A.virtual(img, d, {3: E.DANGER} if on else None)
    for i in range(3):
        A.vflow(d, ta, i, E.INK)
    if done:
        A.vflow(d, ta, 3, E.INK)
    else:
        A.vflow(d, ta, 3, E.DANGER if on else E.LABEL, BROKEN_U, phase=0)
    A.table(img, d, {3: E.DANGER} if on else None)
    A.disk(img, d)
    read_col = E.LABEL if waiting else E.INK
    A.label(img, 3, A.READ_Y + 5, "READ")
    flow(d, 0 if waiting else ta, A.read_path(), read_col, span(ta, c_rd - 2.0, c_rd), phase=0 if waiting else None)
    if c_rd <= t < s11:
        A.label(img, A.VX, A.READ_Y + 14, "FAULT", E.DANGER)
    if waiting:
        A.label(img, A.VX, A.READ_Y + 14, "WAIT")
        flow(d, ta, A.swap_path(False), E.PURPLE, lead)
    if not done:
        A.page(d, A.RX, y_page, A.RW, A.RH, "disk")
    pointer(img, t, c_rd, s11 - 0.4, 44, 246, x_out=-25)
    T.sfx = [(0.3, "pop"), (s11, "ticks_slow")]


DRAW["fault"] = fault


# ---------------- gc ----------------
CELLS = ("ram", "ram", "disk", "ram", "disk", "ram")                         # 장부 6칸: 4칸 RAM, 2칸 스왑(일부만)
CX = [8 + 28 * k for k in range(6)]
GC_PATH = ((26, 80), (26, 108), (76, 108))                                   # GC → 장부 줄 위를 오른쪽으로, 스왑 칸(셋째) 가운데까지
BAR = (9, 182, 170, 193)                                                    # 시간 막대: 테두리 안쪽 160px = 40 ms, 그중 39/40 = 156px(PURPLE) + 4px(INK)


def gc(img, d, t, ta, T):
    kicker(img, "GO GC")
    s13, s14, s15, s16 = at(T, 0), at(T, 1), at(T, 2), at(T, 3)
    hit = cardt(T, 1, 1)                                                     # 장부를 읽다가 폴트: GC 흐름이 스왑 칸에 닿는다
    sweep0 = s13 + 0.5
    stopped = t >= s13
    # 프로그램 흐름 줄 3개: 장면 시작에 행진, S13 시작(정지 구간)부터 끝까지 멈춰 있다
    for k in range(3):
        flow(d, 0 if stopped else ta, ((58, 48 + 12 * k), (168, 48 + 12 * k)), E.LABEL if stopped else E.INK, phase=0 if stopped else None)
    A.box(img, d, (8, 42, 44, 78), "GC", 8 + (36 - E.text_w("GC", "label")) // 2, 54)
    if t >= s16:
        A.label(img, 142, 34, "STOP")
    # 장부 6칸
    u = span(ta, sweep0, hit)
    run = u * 78 - 28                                                        # 경로 78px 중 세로 28px 뒤부터 장부 줄 위를 간 거리
    for k, st in enumerate(CELLS):
        x = CX[k]
        scan = sweep0 <= t < hit and run > 0 and x <= GC_PATH[1][0] + run < x + 24
        if st == "disk" and k == 2 and blinking(t, hit):
            A.page(d, x, 118, 24, 16, "danger")
        elif scan:
            A.page(d, x, 118, 24, 16, "lit")
        else:
            A.page(d, x, 118, 24, 16, st)
    A.label(img, 8, 139, "METADATA")
    d.rectangle((96, 141, 102, 147), fill=E.DEEP, outline=E.INK)
    A.label(img, 106, 139, "RAM")
    d.rectangle((134, 141, 140, 147), fill=E.DEEP, outline=E.PURPLE)
    A.label(img, 144, 139, "DISK")
    if t >= sweep0:
        flow(d, 0 if t >= hit else ta, GC_PATH, E.LABEL if t >= hit else E.INK, u, phase=0 if t >= hit else None)
    if hit <= t < s15:
        A.label(img, 62, 94, "FAULT", E.DANGER)
    # S15: 시간 막대와 폴트 횟수
    if t >= s15:
        x0, y0, x1, y1 = BAR
        fill = round(156 * span(ta, s15 + 0.2, cardt(T, 2, 1)))
        d.rectangle(BAR, fill=E.CARD, outline=E.LABEL)
        if fill:
            d.rectangle((x0 + 1, y0 + 1, x0 + fill, y1 - 1), fill=E.PURPLE)
        if fill >= 156:
            d.rectangle((x0 + 157, y0 + 1, x1 - 1, y1 - 1), fill=E.INK)
            A.label(img, 132, 168, "39 ms", E.PURPLE)
        A.label(img, 10, 168, "40 ms", E.TEXT)
        c2 = cardt(T, 2, 1)
        card2, st2, dur2 = T.plan[[p[0] for p in T.plan].index(E.split_cards(T.sents[2])[1])]
        typed2 = E.char_times(card2, st2, dur2)[-1]                                  # 둘째 카드가 다 찍히는 시각: 숫자도 이 안에 228에 닿는다
        n = round(228 * span(ta, c2 + 0.4, typed2)) if t >= c2 else 0
        w_all = E.text_w("228", "bold", 2)                                      # 세 자리 칸에 오른쪽 맞춤: 자릿수가 늘어도 FAULTS가 흔들리지 않는다
        E.text(img, (10 + w_all - E.text_w(str(n), "bold", 2), 208), str(n), "bold", E.TEXT, 2)
        A.label(img, 10 + w_all + 6, 218, "FAULTS")
    T.sfx = [(0.3, "pop")]


DRAW["gc"] = gc


# ---------------- limit ----------------
def limit(img, d, t, ta, T):
    kicker(img, "MOCK RUN")
    s18 = at(T, 1)

    def test(img, d, t, ta, y0):
        d.rectangle((22, y0 + 26, 54, y0 + 62), fill=E.CARD, outline=E.LABEL)
        for k in range(2):
            d.rectangle((26, y0 + 31 + 12 * k, 50, y0 + 38 + 12 * k), fill=E.DEEP, outline=E.INK)
        d.rectangle((44, y0 + 33, 46, y0 + 35), fill=E.INK)
        d.rectangle((44, y0 + 45, 46, y0 + 47), fill=E.INK)
        A.label(img, 66, y0 + 30, "KERNEL 6.8", E.TEXT)
        A.label(img, 66, y0 + 46, "SWAP: NVMe", E.TEXT)

    def pair(img, d, t, ta, y0):
        A.box(img, d, (20, y0 + 26, 52, y0 + 60), "RAM", 20 + (32 - E.text_w("RAM", "label")) // 2 + 1, y0 + 38)
        A.box(img, d, (90, y0 + 26, 122, y0 + 60), "DISK", 90 + (32 - E.text_w("DISK", "label")) // 2 + 1, y0 + 38, E.PURPLE)
        flow(d, ta, ((56, y0 + 37), (86, y0 + 37)), E.PURPLE)
        flow(d, ta, ((86, y0 + 49), (56, y0 + 49)), E.PURPLE)
        if t >= s18 + 0.6:
            A.label(img, 130, y0 + 38, "STALL")

    compare(img, d, t, ta, (("TEST", E.LABEL, test), ("SWAP + GC", E.INK, pair)), s18, t0=at(T, 0))
    T.sfx = [(0.3, "pop")]


DRAW["limit"] = limit


# ---------------- finale ----------------
def finale(img, d, t, ta, T):
    kicker(img, "PAGE FAULT")
    s19, s20 = at(T, 0), at(T, 1)
    go = s19 + 0.3
    A.label(img, 4, 62, "READ")
    A.label(img, 4, 132, "READ")
    A.box(img, d, (126, 46, 176, 92), "RAM", 126 + (50 - E.text_w("RAM", "label")) // 2 + 1, 62, E.INK)
    A.box(img, d, (126, 116, 176, 162), "DISK", 126 + (50 - E.text_w("DISK", "label")) // 2 + 1, 132, E.PURPLE)
    if t >= go:
        el = max(0.0, ta - go)
        flow(d, ta, ((32, 69), (122, 69)), E.INK, min(1.0, el / 1.0), thick=True)       # 같은 순간 출발: 위는 금방 닿고
        flow(d, ta, ((32, 139), (122, 139)), E.PURPLE, 0.07 * el, thick=True)            # 아래는 같은 시간에 훨씬 짧게
    if t >= s20:
        SPARKLE_MASCOT.paste(img, t - s20, (150, 247))
    T.sfx = [(0.3, "pop"), (s20, "sparkle")]


DRAW["finale"] = finale

if __name__ == "__main__":
    ep.main()
