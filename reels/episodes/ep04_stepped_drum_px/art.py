"""4편 도트 그림: 펼친 계단 드럼(톱니 9줄·자리 눈금), 기어, 숫자창, 크랭크 아이콘, 훅 옆모습. 도식이며 실측 치수가 아니다.
좌표 계약(Manim판·설계 부록 5절): 드럼 높이 10칸(맨 아래 한 칸이 자리 0), 톱니 i(0..8)는 위끝에서 시작해 길이 (9-i)칸,
톱니는 드럼 둘레 약 절반(오른쪽 절반)에만 있다, 기어는 가로 가운데 고정, 자리 n의 기어 중심은 위끝에서 (9-n+0.5)칸 아래.
자리 n에서 기어에 닿는 톱니는 i < n인 n줄(길이가 기어 중심을 넘는 줄)이고, 한 바퀴에 그 줄이 기어 가운데를 지날 때마다 기어가 한 칸 돈다."""
from PIL import ImageDraw

from px import draw as D, engine as E
from px.templates import head

LIT, UNLIT = E.INK, E.DEEP                      # 기어에 닿는(밝은) 톱니 / 안 닿는 톱니 (Manim판 BRAND_INK / LABEL 흐림과 같은 뜻)
N = 9                                           # 톱니 줄 수
GEARS = {"hook": (9, 3, 8, 27), "big": (5, 2, 6, 17), "small": (3, 1, 4, 11)}    # 이름: (몸통 r, 톱니 높이, 톱니 수, 스프라이트 크기)


class Drum:
    """펼친 드럼. 안쪽은 x0..x0+18*sw-1 × top..top+10*c-1, 톱니는 슬롯(폭 sw)마다 폭 tw. 기어 중심 열 cx = 가로 가운데."""

    def __init__(self, x0, top, sw, tw, c):
        self.x0, self.top, self.sw, self.tw, self.c = x0, top, sw, tw, c
        self.W, self.H = 18 * sw, 10 * c
        self.cx = x0 + 9 * sw
        self.off = (sw - tw) // 2

    def gy(self, n):
        """자리 n 기어 중심 y."""
        return self.top + (9 - n) * self.c + self.c // 2

    def cross(self, i):
        """톱니 i의 가운데가 기어 가운데 열을 지나는 회전량(px). 이만큼 돌면 기어를 친다."""
        return self.sw * i + self.off + (self.tw - 1) / 2

    def frame(self, d, col=E.LABEL):
        d.rectangle((self.x0 - 1, self.top - 1, self.x0 + self.W, self.top + self.H), outline=col)

    def teeth(self, d, shift=0, lit=0, grow=None, flash=False):
        """톱니 9줄. shift: 왼쪽으로 지나간 px(둘레를 한 바퀴 돌면 W), lit: 밝은 줄 수(i < lit),
        grow: 줄마다 지금 길이 비율(0~1) 목록(처음 나타날 때), flash: 밝은 줄을 글자색으로."""
        for i in range(N):
            ln = round((9 - i) * self.c * (1 if grow is None else grow[i]))
            if ln <= 0:
                continue
            col = (E.TEXT if flash else LIT) if i < lit else UNLIT
            rel = (self.cx - self.x0 + self.sw * i + self.off - shift) % self.W
            for k in range(self.tw):
                x = self.x0 + (rel + k) % self.W
                d.line((x, self.top, x, self.top + ln - 1), fill=col)

    def scale(self, img, hot=None, col=E.LABEL):
        """왼쪽 자리 눈금 0~9(위가 9). hot번 눈금만 강조색."""
        for n in range(10):
            y = self.top + (9 - n) * self.c + self.c // 2
            s = str(n)
            E.text(img, (self.x0 - 12, y - 6), s, "label", E.INK if n == hot else col)
            ImageDraw.Draw(img).line((self.x0 - 4, y, self.x0 - 2, y), fill=col)

    def hits(self, n, s):
        """자리 n에서 회전량 s까지 기어를 친 횟수."""
        return sum(s >= self.cross(i) for i in range(n))

    def angle(self, n, s, px, step):
        """자리 n에서 회전량 s까지 기어가 돈 각도(°): 한 번 칠 때마다 step을 두 프레임에 걸쳐 반씩."""
        return sum(step / 2 * ((s >= self.cross(i)) + (s >= self.cross(i) + px)) for i in range(n))


def gear(img, cx, cy, kind, deg=0.0):
    """톱니 바퀴(블록 톱니, 한 톱니만 밝은 색 표시). deg만큼 시계 방향으로 돌린 각도 프레임을 캐시해 쓴다."""
    r, tooth, teeth, size = GEARS[kind]

    def paint(dd, c, k):
        D.gear(dd, c, c, r * k, teeth, tooth=tooth * k, fill=E.LABEL, outline=E.TEXT, width=k, mark=(0, E.INK))
        if r >= 5:                                                   # 큰 기어는 가운데에서 위로 뻗는 축 표시(작은 기어는 밝은 톱니 하나로 충분)
            dd.rectangle((c - k, c - (r - 1) * k, c + k - 1, c), fill=E.DEEP)

    f = D.baked(("gear", kind), size, paint, (E.LABEL, E.TEXT, E.INK, E.DEEP), angle=-round(deg % 360, 3))
    img.paste(f, (cx - size // 2, cy - size // 2), f)


def ink_xy(s, cx, cy, scale=1, font="bold"):
    """글자 잉크 가운데가 (cx, cy)에 오는 왼쪽 위 좌표."""
    l, t, r, b = E.FONT[font].getbbox(s)
    return round(cx - (l + r) / 2 * scale), round(cy - (t + b) / 2 * scale)


def centered(img, s, cx, cy, scale=1, font="bold", col=E.TEXT):
    E.text(img, ink_xy(s, cx, cy, scale, font), s, font, col, scale)


def counter(img, d, x, y, w, h, v, scale):
    """결과 숫자창: 테두리 보라, 한 자리 숫자."""
    d.rectangle((x, y, x + w, y + h), fill=E.CARD, outline=E.PURPLE)
    centered(img, str(v), x + w // 2, y + h // 2, scale)


def crank(d, x, y):
    """정지한 크랭크 아이콘: 가운데 축 (x, y), 오른쪽 위 45°로 팔, 끝에 손잡이."""
    D.line(d, (x, y), (x + 9, y - 9), E.TEXT, 2)
    D.circle(d, x, y, 3, fill=E.CARD, outline=E.TEXT)
    D.circle(d, x + 9, y - 9, 3, fill=E.INK)


def down_arrow(d, x, y0, y1, col=E.TEXT):
    """아래 방향 연결 화살표(세로 쌓은 카드 사이)."""
    d.line((x, y0, x, y1 - 3), fill=col)
    head(d, x, y1, 0, 1, col)
