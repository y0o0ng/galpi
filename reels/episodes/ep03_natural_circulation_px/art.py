"""3편 도트 그림: 원자로 용기 단면(비율 좌표), 흐름 경로, 기포, 펌프, 높이 막대, 물방울. 도식 비율이며 실측 치수가 아니다."""
import random

from PIL import Image, ImageDraw

from px import draw as D, engine as E
from px.templates import head

LIGHT, HEAVY = E.INK, E.PURPLE                    # 가벼운(증기 섞인) 물 / 무거운 물 (Manim판 BRAND_INK / COUNCIL과 같은 뜻)


def capsule(img, cx, top, bot, rx, ry, col):
    """세로 캡슐 외곽선(1px): 위·아래 끝은 중점 타원, 가운데는 곧은 벽."""
    w, h = 2 * rx + 1, bot - top + 1
    m = Image.new("1", (w, h), 0)
    md = ImageDraw.Draw(m)
    cap = Image.new("1", (w, 2 * ry + 1), 0)
    D.ellipse(ImageDraw.Draw(cap), rx, ry, rx, ry, outline=1)
    m.paste(cap.crop((0, 0, w, ry + 1)), (0, 0))                        # 위 반쪽(중심 줄 포함)
    m.paste(cap.crop((0, ry, w, 2 * ry + 1)), (0, h - ry - 1))          # 아래 반쪽
    md.line((0, ry, 0, h - ry - 1), fill=1)
    md.line((w - 1, ry, w - 1, h - ry - 1), fill=1)
    img.paste(col, (cx - rx, top), m)


class Vessel:
    """바닥 가운데 아래가 (cx, bot), 맨 위가 top. P(fx, fy)는 폭 W 기준 가로 비율(가운데 0)·높이 H 기준 세로 비율(바닥 0)."""

    def __init__(self, cx, top, bot, w, ry, D=0):
        """D: 굴뚝 짧은 상태에서 줄어든 px. 노심 위쪽(fy>.5)의 모든 것과 용기 맨 위가 D만큼 내려온다."""
        self.cx, self.top, self.bot, self.W, self.ry, self.D = cx, top, bot, w, ry, D
        self.H = bot - top

    def P(self, fx, fy):
        return self.cx + round(fx * self.W), self.bot - round(fy * self.H) + (self.D if fy > .5 else 0)

    def body(self, img, d, nozzles=False):
        """벽·노심(연료봉)·안쪽 원통(shroud+굴뚝)과 선택 노즐. 라벨은 따로."""
        capsule(img, self.cx, self.top + self.D, self.bot, self.W // 2, self.ry, E.LABEL)
        (x0, y0), (x1, y1) = self.P(-.3, .32), self.P(.3, .12)
        d.rectangle((x0, y0, x1, y1), fill=E.DEEP)
        for fx in (-.27, -.21, .21, .27) if self.W > 60 else (-.18, .18):
            x = self.cx + round(fx * self.W)
            d.rectangle((x, y0 + 2, x + 1, y1 - 2), fill=E.INK)
        top = self.P(0, .72)[1]
        for fx in (-.3, .3):
            x = self.P(fx, 0)[0]
            d.line((x, top, x, y1), fill=E.LABEL)
        d.line((x0, y0, x1, y0), fill=E.LABEL)                           # 노심 윗면(굴뚝 바닥)
        d.line((x0, y1, x1, y1), fill=E.LABEL)
        if nozzles:                                                      # 증기(오른쪽 위)·급수(왼쪽) 노즐: 벽에서 6px 밖으로
            for side, fy in ((1, .92), (-1, .76)):
                wx, y = self.cx + side * (self.W // 2), self.P(0, fy)[1]
                d.line((wx, y - 3, wx, y + 3), fill=E.BG)
                for yy in (y - 3, y + 3):
                    d.line((wx, yy, wx + side * 6, yy), fill=E.LABEL)

    def ring(self, rise_top, down_top, half=.4, off=7):
        """안쪽 상승(rise)과 좌우 하강(down_left/right) 고리. 점은 (x, y) 도트, 끝은 수평·수직."""
        (cx, yb), yt, dt, hx = self.P(0, .06), self.P(0, rise_top)[1], self.P(0, down_top)[1], round(half * self.W)
        return {"rise": [(cx, yb), (cx, yt)],
                "down_right": [(cx + off, dt), (cx + hx, dt), (cx + hx, yb), (cx + 4, yb)],
                "down_left": [(cx - off, dt), (cx - hx, dt), (cx - hx, yb), (cx - 4, yb)]}

    def paths(self, edge_r, edge_l=0):
        """고리 + 증기 배출(steam_out)·급수 유입(fw_in). 흐름 속도는 모두 같다."""
        r = self.ring(.86, .80)
        cx, y = self.cx, self.P(0, .92)[1]
        yn = self.P(0, .86)[1] - 3
        r["steam_out"] = [(cx, yn), (cx + (yn - y), y), (self.cx + self.W // 2 + 6, y), (edge_r, y)]
        yf, hx = self.P(0, .76)[1], round(.4 * self.W)
        r["fw_in"] = [(edge_l, yf), (cx - hx, yf), (cx - hx, self.P(0, .72)[1])]
        return r


def label(img, d, xy, s, to, col=E.LABEL, bg=None):
    """라벨(왼쪽 위 xy)과 그림을 잇는 1px 지시선 + 끝 점. to=(x, y)는 그림 위 끝점, 선은 라벨 가운데 높이에서 수평."""
    x, y = xy
    w = E.text_w(s, "label")
    if bg:
        d.rectangle((x, y - 1, x + w, y + 10), fill=bg)
    E.text(img, xy, s, "label", col)
    if to:
        ly = to[1]
        if to[0] > x:
            d.line((x + w + 2, ly, to[0] - 2, ly), fill=E.LABEL)
        else:
            d.line((x - 2, ly, to[0] + 2, ly), fill=E.LABEL)
        d.rectangle((to[0] - 1, ly - 1, to[0], ly), fill=E.LABEL)


RNG = random.Random(3)
BUB = [(RNG.choice((-7, -4, 4, 7)), RNG.random()) for _ in range(12)]    # 기포: 가로 어긋남과 위상(고정 seed)


def bubbles(d, ta, cx, y_top, y_bot, front=None, gap=22, adv=None):
    """상승 흐름 안 TEXT 2×2 기포: 12fps마다 2px씩 위로(흐름 점선과 같은 속도). front=지금 뻗어 나온 선 끝 y(그 아래만 보인다). adv=지금까지 올라간 px(기본 프레임당 2px)."""
    adv = round(ta * 12) * 2 if adv is None else adv
    n = max(1, (y_bot - y_top) // gap)
    span = y_bot - y_top
    for k in range(n):
        dx, ph = BUB[k % len(BUB)]
        y = y_bot - (k * span // n + adv + int(ph * 5)) % span
        if front is None or y > front + 2:
            d.rectangle((cx + dx, y, cx + dx + 1, y + 1), fill=E.TEXT)


def ring_card(cx, y_top, y_bot, half=26, off=6):
    """비교 카드용 사각 고리(펌프 장면): 가운데 위로, 좌우 바깥 아래로. 오른쪽 아래 줄 위에 펌프 자리."""
    return {"rise": [(cx, y_bot), (cx, y_top + 3)],
            "down_right": [(cx + off, y_top), (cx + half, y_top), (cx + half, y_bot), (cx + 4, y_bot)],
            "down_left": [(cx - off, y_top), (cx - half, y_top), (cx - half, y_bot), (cx - 4, y_bot)]}


def _impeller(d, c, k):
    import math
    for i in range(3):
        a = math.pi / 2 + i * 2 * math.pi / 3
        d.line([(c, c), (c + 4.6 * k * math.cos(a), c - 4.6 * k * math.sin(a))], fill=E.TEXT, width=2 * k)
    d.ellipse((c - 1.5 * k, c - 1.5 * k, c + 1.5 * k, c + 1.5 * k), fill=E.TEXT)


def pump(img, d, x, y, ta):
    """펌프: 원(지름 15) + 3날개 임펠러. 12fps마다 15°씩, 8프레임이 날개 한 칸(120°)."""
    D.circle(d, x, y, 7, fill=E.CARD, outline=E.TEXT)
    f = D.baked("impeller", 11, _impeller, (E.TEXT,), angle=(round(ta * 12) % 8) * 15)
    img.paste(f, (x - 5, y - 5), f)


def dashed_box(d, x0, y0, x1, y1, col):
    """점선 빈 상자: 2px 선, 2px 간격."""
    for x in range(x0, x1 + 1, 4):
        for yy in (y0, y1):
            d.line((x, yy, min(x + 1, x1), yy), fill=col)
    for y in range(y0, y1 + 1, 4):
        for xx in (x0, x1):
            d.line((xx, y, xx, min(y + 1, y1)), fill=col)


def height_bar(d, x, y0, y1, col=E.TEXT):
    """굴뚝 높이 표시: 세로선 + 양 끝 가로 괄호(7px) + 위아래 화살촉."""
    d.line((x, y0 + 3, x, y1 - 3), fill=col)
    for y in (y0, y1):
        d.line((x - 3, y, x + 3, y), fill=col)
    head(d, x, y0 + 1, 0, -1, col)
    head(d, x, y1 - 1, 0, 1, col)


def drop(d, cx, cy, col, bubbles_inside, hole=E.CARD):
    """물방울(위 꼭지 cy-17, 아래 둥근 몸통 반지름 9, 몸통 중심 cy). 가벼운 쪽은 안에 기포 구멍."""
    for i in range(10):
        d.line((cx - i // 2, cy - 17 + i, cx + i // 2, cy - 17 + i), fill=col)
    D.circle(d, cx, cy, 9, fill=col)
    if bubbles_inside:
        for bx, by, r in ((-3, -1, 2), (3, 3, 1), (0, -6, 1)):
            D.circle(d, cx + bx, cy + by, r, fill=hole)


def drop_arrow(d, x, top, bot, col, up):
    """위(up) 또는 아래 화살표(top~bot): 굵은 3px 세로선 + 큰 도트 화살촉(폭 11, 깊이 6)."""
    d.rectangle((x - 1, top + 5, x + 1, bot) if up else (x - 1, top, x + 1, bot - 5), fill=col)
    for i in range(6):
        y = top + 5 - i if up else bot - 5 + i
        d.line((x - 5 + i, y, x + 5 - i, y), fill=col)
