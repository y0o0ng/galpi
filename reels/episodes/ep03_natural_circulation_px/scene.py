"""3편 도트판(hook~finale). 실행: reels/.venv/bin/python episodes/ep03_natural_circulation_px/scene.py"""
import sys
from pathlib import Path

HERE = Path(__file__).parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(HERE))
from px import engine as E, templates  # noqa: E402
from px.templates import SPARKLE_MASCOT, Episode, compare, flow, kicker, pointer  # noqa: E402
from px.timeline import at, ease_out, span  # noqa: E402
import art as A  # noqa: E402

DRAW = {}
ep = Episode(HERE, ("hook", "pump", "flow", "finale"), DRAW, "ep03_px_preview")
nar = ep.nar
COLOR = {"rise": A.LIGHT, "steam_out": A.LIGHT, "down_left": A.HEAVY, "down_right": A.HEAVY, "fw_in": A.HEAVY}
CYCLE = ("rise", "down_left", "down_right")


# ---------------- hook ----------------
HV = A.Vessel(56, 128, 244, 50, 12)
HOOK_RING = HV.ring(.86, .80)
T_RING = 0.9                                      # 마지막 낱말 0.3초 뒤 = 그림이 뜨는 때


def hook_art(img, d, t, ta):
    HV.body(img, d)
    u = span(ta, T_RING, T_RING + 1.5)
    for name in CYCLE:
        flow(d, ta, HOOK_RING[name], COLOR[name], u)
    A.bubbles(d, ta, HV.cx, HV.P(0, .86)[1] + 4, HV.P(0, .22)[1], HV.bot - u * (HV.bot - HV.P(0, .86)[1]) if u < 1 else None, 16)
    A.label(img, d, (94, 208), "BWRX-300", (84, 213))


def hook(img, d, t, ta, T):
    templates.hook(img, d, t, ta, T, nar["hook"], ("NATURAL", "CIRCULATION"), hook_art)


# ---------------- pump ----------------
PX, PXR = 74, 108                                 # 카드 안 고리 가운데·오른쪽 줄 x


def loop(img, d, ta, y0, u):
    r = A.ring_card(PX, y0 + 21, y0 + 63, 34)
    for name in CYCLE:
        flow(d, ta, r[name], COLOR[name], u)


def pump_scene(img, d, t, ta, T):
    kicker(img, "NATURAL CIRCULATION", scale=1)    # bold 2배면 292px라 1배(146px)
    t1 = at(T, 1, 0.2)                            # NATURAL 카드가 뜨는 때(문장 1)

    def forced(img, d, t, ta, y0):
        loop(img, d, ta, y0, span(ta, 0.8, 1.8))
        A.pump(img, d, PXR, y0 + 42, ta)
        E.text(img, (PXR + 10, y0 + 37), "PUMP", "label", E.TEXT)

    def natural(img, d, t, ta, y0):
        loop(img, d, ta, y0, span(ta, t1 + 0.5, t1 + 1.5))
        A.dashed_box(d, PXR - 7, y0 + 35, PXR + 7, y0 + 49, E.LABEL)
        E.text(img, (PXR + 12, y0 + 37), "NO PUMP", "label", E.LABEL)

    compare(img, d, t, ta, (("FORCED", E.LABEL, forced), ("NATURAL", E.INK, natural)), t1)
    T.sfx = [(0.3, "pop"), (t1, "pop")]


# ---------------- flow ----------------
SHORT = 30                                        # 문장 6 전까지의 짧은 굴뚝: 지금 높이보다 30px 낮다(용기 맨 위도 함께)


def flow_scene(img, d, t, ta, T):
    kicker(img, "NATURAL CIRCULATION", scale=1)    # bold 2배면 292px라 1배(146px)
    r0, s0, d0 = at(T, 0, 0.7), at(T, 2, 0.1), at(T, 3, 0.2)
    f0, lg, hl, g0, h0, x0 = d0 + 1.4, at(T, 4), at(T, 5, 0.1), at(T, 6, 0.05), at(T, 6, 0.3), at(T, 6, 0.85)
    grow = lambda s: ease_out(span(s, g0, g0 + 1.3))             # 문장 6: 굴뚝이 지금 높이로 늘어난다(1.3초)
    V = A.Vessel(92, 30, 246, 68, 18, round(SHORT * (1 - grow(ta))))
    paths = V.paths(179)
    adv = sum(1 + round(grow(f / 12)) for f in range(round(ta * 12)))   # 점선 전진: 늘어난 만큼 칸당 1px → 2px
    V.body(img, d, True)
    u = {"rise": span(ta, r0, r0 + 1.6), "steam_out": span(ta, s0, s0 + 1.0), "down_left": span(ta, d0, f0),
         "down_right": span(ta, d0, f0), "fw_in": span(ta, f0, f0 + 1.0)}
    thick = ta >= hl
    blink = 0 <= ta - hl < 0.34 and int((ta - hl) * 12) % 2 == 0
    for name in ("down_left", "down_right", "fw_in", "steam_out", "rise"):
        if u[name] > 0:
            hot = name in CYCLE
            flow(d, ta, paths[name], E.TEXT if blink and hot else COLOR[name], u[name], thick and hot, adv)
    if u["rise"] > 0:
        yb, yt = paths["rise"][0][1], paths["rise"][1][1]
        A.bubbles(d, ta, V.cx, yt + 4, V.P(0, .22)[1], yb - u["rise"] * (yb - yt) if u["rise"] < 1 else None, adv=adv)
    A.label(img, d, (80, 194), "CORE", None, E.TEXT, bg=E.DEEP)
    chim = E.TEXT if h0 + 0.5 <= ta < h0 + 1.3 and int((ta - h0 - 0.5) * 12) % 4 < 2 else E.LABEL
    A.label(img, d, (133, 129), "CHIMNEY", (106, 134), chim)
    if u["steam_out"] > 0.3:
        E.text(img, (146, V.P(0, .92)[1] - 12), "STEAM", "label", A.LIGHT)
    if t >= d0:
        A.label(img, d, (3, 144), "DOWNCOMER", (69, 149))
    if u["fw_in"] > 0.3:
        E.text(img, (3, V.P(0, .76)[1] - 17), "FEEDWATER", "label", A.HEAVY)
    if t >= lg:
        for y, name, col in ((222, "LIGHT", A.LIGHT), (234, "HEAVY", A.HEAVY)):
            d.rectangle((4, y + 3, 13, y + 5), fill=col)
            E.text(img, (18, y), name, "label", E.TEXT)
    if t >= g0:                                   # 높이 막대: 굴뚝과 함께 늘어난다
        A.height_bar(d, 175, V.P(0, .72)[1], V.P(0, .32)[1])
    pointer(img, t, h0, x0, 152, 195)             # 마스코트: 늘어난 뒤 오른쪽에서 CHIMNEY 라벨 바로 아래로 들어와 가리키고 퇴장
    T.sfx = [(0.3, "pop"), (r0, "bubbles"), (s0, "pop"), (d0, "pop"), (h0, "sparkle")]


# ---------------- finale ----------------
BOB = (0, 2, 4, 5, 6, 6, 5, 4, 2, 0, 0, 0)        # 방울이 12fps 12칸으로 통통(정수 px)


def finale(img, d, t, ta, T):
    kicker(img, "NATURAL CIRCULATION", scale=1)    # bold 2배면 292px라 1배(146px)
    m0 = at(T, 1, 0.1)
    k = BOB[round(ta * 12) % 12]

    def light(img, d, t, ta, y0):
        A.drop(d, 68, y0 + 44 - k, A.LIGHT, True)
        A.drop_arrow(d, 108, y0 + 22, y0 + 64, A.LIGHT, True)

    def heavy(img, d, t, ta, y0):
        A.drop(d, 68, y0 + 44 + k, A.HEAVY, False)
        A.drop_arrow(d, 108, y0 + 22, y0 + 64, A.HEAVY, False)

    compare(img, d, t, ta, (("LIGHT", A.LIGHT, light), ("HEAVY", A.HEAVY, heavy)), at(T, 0, 0.6))
    if t >= m0:
        SPARKLE_MASCOT.paste(img, t - m0, (148, 247))
    T.sfx = [(0.3, "pop"), (m0, "sparkle")]


DRAW.update(hook=hook, pump=pump_scene, flow=flow_scene, finale=finale)

if __name__ == "__main__":
    ep.main()
