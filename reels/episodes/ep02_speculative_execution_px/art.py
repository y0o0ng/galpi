"""2편 도트 그림: 갈림길과 명령 블록(달리기·잔상), ⏸, 플로피, 칩, LED, CACHE, 시간 막대, 차단 막대."""
from PIL import Image, ImageDraw

from px import draw as D, engine as E
from px.timeline import ease_out, tween

LED_PATTERN = "1101110111"                       # 켜짐 8 / 꺼짐 2


class Fork:
    """갈림점 (jx, jy), 줄기 길이 stem, 가지의 가로·세로 br(45°). 줄기·가지 굵기 2px, 1px 그림자."""

    def __init__(self, jx, jy, stem, br):
        self.jx, self.jy, self.stem, self.br = jx, jy, stem, br

    def pos(self, t, side="right"):
        """Manim Fork.pos와 같은 뜻: 0 갈림점, 1 가지 끝, -1 줄기 아래 끝. 정수 도트."""
        if t < 0:
            return self.jx, self.jy + round(-t * self.stem)
        return self.jx + round(t * self.br) * (1 if side == "right" else -1), self.jy - round(t * self.br)

    def draw(self, d, right=E.LABEL):
        jx, jy, st, br = self.jx, self.jy, self.stem, self.br
        for off, col in ((1, E.SHADOW), (0, None)):
            D.line(d, (jx + off, jy + st + off), (jx + off, jy + off), col or E.LABEL, 2)
            D.line(d, (jx + off, jy + off), (jx - br + off, jy - br + off), col or E.LABEL, 2)
            D.line(d, (jx + off, jy + off), (jx + br + off, jy - br + off), col or right, 2)

    def mark(self, img, bob=0):
        """`?`: 갈림점 위, bold 2배, 보라. bob은 위아래 도트."""
        E.text(img, (self.jx + 1 - E.text_w("?", "bold", 2) // 2, self.jy - self.br - 12 + bob), "?", "bold", E.PURPLE, 2)

    def barrier(self, d, t=0.75, half=7):
        """오른쪽 가지를 가로지르는 INK 3px 차단 막대(가지와 수직인 45°)."""
        x, y = self.pos(t)
        D.line(d, (x - half, y - half), (x + half, y + half), E.INK, 3)


def _cut(d, x, y, col):
    """8×8 네모, 네 모서리 한 점 깎기."""
    d.rectangle((x + 1, y, x + 6, y + 7), fill=col)
    d.rectangle((x, y + 1, x + 7, y + 6), fill=col)


def block(d, c, fill=E.INK, outline=E.OUTLINE):
    """명령 블록: c는 가운데 도트(줄기 가운데가 jx와 jx+1 사이라 왼쪽 위는 c-3). outline=None이면 그림자·외곽선 없는 잔상 모양."""
    x, y = c[0] - 3, c[1] - 3
    if outline is None:
        return _cut(d, x, y, fill)
    _cut(d, x + 1, y + 1, E.SHADOW)
    _cut(d, x, y, outline)
    d.rectangle((x + 1, y + 1, x + 6, y + 6), fill=fill)


def runner(d, f, ta, t0, t1, a=0, b=1, ease=ease_out, fill=E.INK, outline=E.OUTLINE):
    """블록이 [t0, t1] 동안 가지 위치 a→b로 간다(ta는 12fps로 끊은 시각). 도착 전엔 DEEP 잔상 두 칸이 한 칸씩 뒤처져 따라온다."""
    p = lambda s: f.pos(tween(s, t0, t1, a, b, ease))
    if ta < t1:
        for k in (1, 2):
            block(d, p(ta - k / 12), E.DEEP, None)
    block(d, p(ta), fill, outline)


def pause(d, x, y):
    """⏸: 2px 세로 막대 둘(높이 8), 1px 그림자."""
    for off, col in ((1, E.SHADOW), (0, E.LABEL)):
        for bx in (x, x + 5):
            d.rectangle((bx + off, y + off, bx + off + 1, y + off + 7), fill=col)


def dot(d, c, col):
    """4×4 점."""
    d.rectangle((c[0] - 2, c[1] - 2, c[0] + 1, c[1] + 1), fill=col)


def dashes(d, x0, x1, y, col=E.LABEL):
    """가로 점선: 2px 점, 2px 간격."""
    for x in range(x0, x1 - 1, 4):
        d.rectangle((x, y, min(x + 1, x1), y), fill=col)


def floppy(d, x, y):
    """16×16 플로피 디스크(셔터·라벨 칸)."""
    d.rectangle((x + 1, y + 1, x + 16, y + 16), fill=E.SHADOW)
    d.rectangle((x, y, x + 15, y + 15), fill=E.OUTLINE)
    d.rectangle((x + 1, y + 1, x + 14, y + 14), fill=E.INK)
    d.rectangle((x + 4, y + 1, x + 11, y + 5), fill=E.LABEL)
    d.rectangle((x + 8, y + 2, x + 9, y + 4), fill=E.DEEP)
    d.rectangle((x + 3, y + 8, x + 12, y + 14), fill=E.TEXT)


def chip_body(d, x, y, n):
    """n×n 사각 몸체 + 사방 1px 핀 다섯 개(길이 4)."""
    d.rectangle((x + 1, y + 1, x + n + 1, y + n + 1), fill=E.SHADOW)
    d.rectangle((x, y, x + n, y + n), fill=E.CARD, outline=E.LABEL)
    for k in range(1, 6):
        o = n * k // 6
        d.line((x + o, y - 4, x + o, y - 1), fill=E.LABEL); d.line((x + o, y + n + 1, x + o, y + n + 4), fill=E.LABEL)
        d.line((x - 4, y + o, x - 1, y + o), fill=E.LABEL); d.line((x + n + 1, y + o, x + n + 4, y + o), fill=E.LABEL)


def chip_cells(d, x, y, rest=True):
    """칩 몸체(x, y, 72) 안 3×3 칸(16px, 피치 20). 오른쪽 위 칸이 예측기. rest=False면 예측기 칸만."""
    for j in range(3):
        for i in range(3):
            box = (x + 8 + i * 20, y + 8 + j * 20, x + 23 + i * 20, y + 23 + j * 20)
            if (i, j) == (2, 0):
                d.rectangle(box, fill=E.DEEP, outline=E.INK)
            elif rest:
                d.rectangle(box, outline=E.LABEL)


def leds(d, x, cy, n):
    """LED 10개 중 앞 n개: 켜짐 INK 채움 / 꺼짐 LABEL 테두리(지름 9, 피치 14)."""
    for i, c in enumerate(LED_PATTERN[:n]):
        D.circle(d, x + i * 14 + 4, cy, 4, fill=E.INK if c == "1" else None, outline=None if c == "1" else E.LABEL)


def cache(d, img, x, y):
    """CACHE 상자(54×54, 3×3 칸) + 위 라벨. 반환: 점이 남는 칸(가운데 줄 오른쪽)의 가운데 도트."""
    d.rectangle((x + 1, y + 1, x + 55, y + 55), fill=E.SHADOW)
    d.rectangle((x, y, x + 54, y + 54), fill=E.CARD, outline=E.LABEL)
    for k in (18, 36):
        d.line((x + k, y + 1, x + k, y + 53), fill=E.DEEP); d.line((x + 1, y + k, x + 53, y + k), fill=E.DEEP)
    E.text(img, (x + (55 - E.text_w("CACHE", "label")) // 2, y - 13), "CACHE", "label", E.LABEL)
    return x + 45, y + 27


def dissolve(img, c, k):
    """블록이 Bayer 순서로 흩어진다: k=1~3단계, 4면 사라짐."""
    if k >= 4:
        return
    x, y = c[0] - 3, c[1] - 3
    tmp = Image.new("RGBA", (10, 10))
    block(ImageDraw.Draw(tmp), (3, 3))
    px = tmp.load()
    for j in range(10):
        for i in range(10):
            if E.BAYER[(y + j) % 4][(x + i) % 4] < 4 * k:
                px[i, j] = (0, 0, 0, 0)
    img.paste(tmp, (x, y), tmp)


def approx(d, x, y):
    """≈ 도트 도형(9×7): 2px 높이 조각 세 개씩 두 줄."""
    for oy in (0, 5):
        for ox, dy in ((0, 1), (3, 0), (6, 1)):
            d.rectangle((x + ox, y + oy + dy, x + ox + 2, y + oy + dy + 1), fill=E.INK)


def timebars(d, x, y, spec):
    """세로 시간 막대 4칸(12px, 간격 3) + 왼쪽 화살표 레일. W 일(DEEP), I 쉼(빈 칸), S 추측(INK), . 없음."""
    d.line((x - 8, y, x - 8, y + 56), fill=E.LABEL)
    d.polygon([(x - 11, y + 53), (x - 5, y + 53), (x - 8, y + 57)], fill=E.LABEL)
    for i, ch in enumerate(spec):
        r = (x, y + i * 15, x + 48, y + i * 15 + 11)
        if ch == "W":
            d.rectangle(r, fill=E.DEEP, outline=E.INK)
        elif ch == "S":
            d.rectangle(r, fill=E.INK, outline=E.OUTLINE)
        elif ch == "I":
            d.rectangle(r, outline=E.LABEL)
