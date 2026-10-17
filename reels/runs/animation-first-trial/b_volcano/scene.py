"""형식 2 시험 장면 B: 실제 환경·재질(화산 단면). 실행: reels/.venv/bin/python reels/runs/animation-first-trial/b_volcano/scene.py
결과는 reels/media/animation-first-trial/(gitignore)에 쓴다. 게시용이 아니다. 내용은 시험용 일반 상식이고 출처 검토를 거치지 않았다."""
import sys
from pathlib import Path

HERE = Path(__file__).parent
ROOT = HERE.parents[2]
sys.path.insert(0, str(ROOT))
from px import draw, engine as E  # noqa: E402
from px.templates import Episode, hook2  # noqa: E402
from px.timeline import ease_in_out, ease_out, span, tween  # noqa: E402

SKY, SOIL, CRUST, ROCK, ASH, GAS, MAGMA, MAGMA_HI, MAGMA_GLOW = "#26324A", "#4D3B2C", "#7A6350", "#3A3F4F", "#8A8478", "#CFE9F2", "#8F3A27", "#B8573A", "#D0703F"
DRAW = {}
ep = Episode(HERE, ("hook", "rise", "erupt"), DRAW, "ep99_trial_b", media=ROOT / "media" / "animation-first-trial")

PANEL = (8, 70, 216, 372)             # 단면도 상자
CONE_Y, GROUND_Y, CHAMBER = 110, 230, (112, 328, 52, 28)
CX0, CX1 = 106, 117                    # 화도 가로
CHAMBER_TOP = CHAMBER[1] - CHAMBER[3]  # 300


def stage(img, d, ta):
    """고정 무대: 하늘 · 원뿔 화산 · 흙/지각/심부 암석 층 · 화도 · 마그마방. 층마다 질감이 다르다(흙은 성긴 점, 지각은 가로 줄, 심부는 촘촘한 체크)."""
    x0, y0, x1, y1 = PANEL
    d.rectangle(PANEL, fill=SKY)
    d.polygon([(88, CONE_Y), (136, CONE_Y), (196, GROUND_Y), (28, GROUND_Y)], fill=CRUST)
    d.rectangle((x0 + 1, GROUND_Y, x1 - 1, 250), fill=SOIL)
    d.rectangle((x0 + 1, 251, x1 - 1, 290), fill=CRUST)
    d.rectangle((x0 + 1, 291, x1 - 1, y1 - 1), fill=ROCK)
    for y in range(GROUND_Y + 2, 250, 4):                              # 흙: 성긴 점
        for x in range(x0 + 2 + (y // 4 % 2) * 2, x1 - 1, 6):
            d.point((x, y), fill=CRUST)
    for y in range(256, 290, 6):                                       # 지각: 층 줄
        d.line((x0 + 1, y, x1 - 1, y), fill=SOIL)
    for y in range(292, y1 - 1):                                       # 심부: 체크 디더
        for x in range(x0 + 1 + (y % 2), x1 - 1, 2):
            d.point((x, y), fill=E.OUTLINE if (x // 2 + y) % 5 == 0 else ROCK)
    d.rectangle((x0, y0, x1, y1), outline=E.LABEL)
    d.rectangle((CX0 - 1, CONE_Y - 1, CX1 + 1, CHAMBER_TOP + 4), fill=E.OUTLINE)            # 화도 벽
    d.rectangle((CX0, CONE_Y, CX1, CHAMBER_TOP + 4), fill=E.BG)
    draw.ellipse(d, *CHAMBER, fill=E.OUTLINE)
    draw.ellipse(d, CHAMBER[0], CHAMBER[1], CHAMBER[2] - 1, CHAMBER[3] - 1, fill=MAGMA)
    for k in range(18):                                                # 마그마방 안 일렁임: 12fps로 밝은 점이 자리를 옮긴다
        step = int(ta * 12)
        x = CHAMBER[0] - 38 + (k * 29 + step * 3) % 76
        y = CHAMBER[1] - 18 + (k * 17 + step * (1 if k % 2 else 2)) % 36
        if ((x - CHAMBER[0]) / 50) ** 2 + ((y - CHAMBER[1]) / 26) ** 2 < 1:
            d.point((x, y), fill=MAGMA_HI)


def column_top(t, ev):
    """화도 속 마그마 윗면 y. 마그마방 위에서 시작해 화구 높이까지 천천히 오른다(rise 장면), 이후 화구 끝에 머문다."""
    return round(tween(t, ev["rise"], ev["top"], CHAMBER_TOP, CONE_Y + 4, ease_in_out))


def magma_column(d, top):
    d.rectangle((CX0, top, CX1, CHAMBER_TOP + 4), fill=MAGMA)
    for y in range(top + 2, CHAMBER_TOP, 6):
        d.line((CX0 + 2, y, CX1 - 2, y), fill=MAGMA_HI)


def bubbles(d, ta, top, t0):
    """기포: 압력이 낮은 위쪽(y < 270)에서 생기고 올라올수록 커진다. 위치는 번호로 정해 결정론적이다."""
    for k in range(7):
        by = 268 - 24 * k + (int(ta * 12) + k) % 3 - 1
        if by < top + 4 or by > 270 or ta < t0 + k * 0.15:
            continue
        r = 1 + (270 - by) // 40
        bx = CX0 + 3 + (k * 5) % 6
        draw.circle(d, bx, by, r, fill=GAS)


def hook(img, d, t, ta, T):
    def art(img, d, t, ta):
        stage(img, d, ta)
        T.say(img, t, "마그마방", "label", (112, 358))
        T.say(img, t, "지각", "label", (44, 268))

    hook2(img, d, t, ta, T, ep.nar, art)


DRAW["hook"] = hook


def rise(img, d, t, ta, T):
    ev = T.events
    stage(img, d, ta)
    top = column_top(ta, ev)
    magma_column(d, top)
    if t >= ev["bubbles"]:
        bubbles(d, ta, top, ev["bubbles"])
    T.say(img, t, "올라올수록 압력이 낮아져 가스가 기포가 된다")
    T.say(img, t, "압력 높음", "label", (172, 292), fill=E.TEXT)
    T.say(img, t, "압력 낮음", "label", (172, 160), fill=E.TEXT)
    T.say(img, t, "기포", "label", (150, 224), fill=E.TEXT)
    # 압력 눈금: 위로 갈수록 선이 짧고 성겨진다(높음 → 낮음)
    for k in range(6):
        y = 280 - sum(range(k + 1)) * 4
        d.line((CX1 + 8, y, CX1 + 8 + max(2, 16 - 3 * k), y), fill=E.LABEL)
    T.sfx = [(ev["rise"], "rise", "motion"), (ev["bubbles"], "bubbles", "event")]


DRAW["rise"] = rise


def erupt(img, d, t, ta, T):
    ev = T.events
    stage(img, d, ta)
    magma_column(d, CONE_Y + 4)
    b = ev["burst"]
    if t >= b:
        for k in range(26):                                            # 마그마 방울: 화구에서 위로 쏘아져 포물선으로 떨어진다
            vx, vy = ((k * 7) % 13 - 6) * 0.8, -(40 + (k * 13) % 30)
            tt = max(0.0, ta - b - k * 0.03)
            x = round(112 + vx * tt * 4)
            y = round(CONE_Y + vy * tt + 60 * tt * tt)
            if y < CONE_Y + 4 and PANEL[1] < y < PANEL[3] and PANEL[0] < x < PANEL[2]:
                d.rectangle((x, y, x + 2, y + 2), fill=MAGMA_GLOW if k % 2 else MAGMA_HI)
        u = ease_out(span(ta, b, b + 3.0))                              # 화산재 구름이 부풀며 오른쪽으로 흐른다
        for k, (dx, dy, r) in enumerate(((0, 0, 9), (-10, 4, 7), (11, 3, 7), (2, -9, 8), (-6, -12, 6), (9, -11, 6))):
            draw.circle(d, round(112 + dx * (1 + u) + u * 22), round(CONE_Y - 8 + dy * (1 + u) - u * 22), round(r * (0.4 + 0.6 * u)), fill=ASH)
    T.say(img, t, "기포가 커지면 마그마가 밀려 나온다")
    T.sfx = [(b, "thud", "event"), (b + 0.2, "radiate", "motion")]


DRAW["erupt"] = erupt

if __name__ == "__main__":
    ep.main()
