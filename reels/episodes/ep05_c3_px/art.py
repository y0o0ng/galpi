"""5편 도트 그림: 공통 위성(옆모습), 적외선 물결, 지상 랙, 점선 상자·사각 링, 온도계, 단면도 확대(cutaway). 도식이며 실측이 아니다."""
from px import draw as D, engine as E
from px.templates import flow, head
from px.timeline import ease_out, span

TRI = (0, 1, 2, 1, 0, -1, -2, -1)                # 물결 한 주기(8px): 진폭 2px, 반파장 2px의 45° 지그재그
STAGE = (14, 44, 166, 214)


def wave(d, x, y, length, ta, col, width=1, up=False, u=1.0):
    """적외선 물결: 시작 (x, y)에서 오른쪽(up이면 위쪽)으로 length만큼. u는 뻗은 진행도(1이면 끝에 화살촉).
    지그재그 위상은 12fps마다 1px씩 바깥쪽으로 민다. 선은 모두 45°."""
    n = round(length * u)
    body = n - 2 if u >= 1 else n
    if body < 1:
        return
    ph = round(ta * 12) % 8
    corners = [s for s in range(1, body) if (s - ph) % 4 == 2]
    ss = [0, *corners, body]
    pos = (lambda s: (x + TRI[(s - ph) % 8], y - s)) if up else (lambda s: (x + s, y + TRI[(s - ph) % 8]))
    for a, b in zip(ss, ss[1:]):
        D.line(d, pos(a), pos(b), col, width)
    if u >= 1:
        head(d, x, y - length, 0, -1, col) if up else head(d, x + length, y, 1, 0, col)


def dotted_rect(d, box, col):
    """1px 점선 사각(2px 켜고 2px 끔)."""
    x0, y0, x1, y1 = box
    for x in range(x0, x1 + 1):
        if x % 4 < 2:
            d.point((x, y0), fill=col)
            d.point((x, y1), fill=col)
    for y in range(y0, y1 + 1):
        if y % 4 < 2:
            d.point((x0, y), fill=col)
            d.point((x1, y), fill=col)


def panel(d, x0, y0, x1, y1):
    """태양전지판: 칸 무늬(보라 선)."""
    d.rectangle((x0, y0, x1, y1), fill=E.CARD, outline=E.PURPLE)
    for x in range(x0 + 6, x1, 6):
        d.line((x, y0, x, y1), fill=E.PURPLE)
    d.line((x0, (y0 + y1) // 2, x1, (y0 + y1) // 2), fill=E.PURPLE)


def satellite(d, bx, by, size, wing=None, chip=None, rad_w=4):
    """공통 위성(옆모습). 몸통 (bx, by) 왼쪽 위, 한 변 size. wing=(날개 폭, 날개 높이)이면 왼쪽에 막대로 이은 태양전지판,
    오른쪽 면에 1px 띄운 세로 방열판(높이 1.5배, 세로 가운데 맞춤). chip=None이면 몸통 안 칩 없음, 아니면 칩 색.
    반환: 방열판 오른쪽 끝 x, 방열판 위·아래 y."""
    cy = by + size // 2
    if wing:
        ww, wh = wing
        d.rectangle((bx - 8, cy - 1, bx - 1, cy), fill=E.LABEL)
        panel(d, bx - 8 - ww, cy - wh // 2, bx - 9, cy + wh // 2 - 1)
    d.rectangle((bx, by, bx + size - 1, by + size - 1), fill=E.CARD, outline=E.LABEL)
    if chip:
        c = size // 2 - 4
        d.rectangle((bx + c, by + c, bx + c + 7, by + c + 7), fill=chip)
    rh = size * 3 // 2
    top = cy - rh // 2
    rx = bx + size + 1
    d.rectangle((rx, top, rx + rad_w - 1, top + rh - 1), fill=E.DEEP, outline=E.LABEL)
    return rx + rad_w - 1, top, top + rh - 1


def rack(d, x, y, w, h):
    """지상 서버 랙: 상자 + 슬롯 줄 + 작은 불빛."""
    d.rectangle((x, y, x + w - 1, y + h - 1), fill=E.DEEP, outline=E.LABEL)
    for k in range(3):
        sy = y + 6 + k * (h - 10) // 3
        d.line((x + 4, sy, x + w - 9, sy), fill=E.LABEL)
        d.rectangle((x + w - 7, sy - 1, x + w - 5, sy), fill=E.INK)


def ground(img, d, ta, y0, u=1.0):
    """GROUND 카드 그림: 랙에서 오른쪽 바깥으로 AIR·WATER 흐름 점선(u는 뻗은 진행도, 0이면 흐름 없음)."""
    rack(d, 24, y0 + 22, 36, 42)
    E.text(img, (132, y0 + 25), "AIR", "label", E.LABEL)
    E.text(img, (132, y0 + 45), "WATER", "label", E.LABEL)
    if u > 0:
        for fy in (30, 50):
            flow(d, ta, ((62, y0 + fy), (126, y0 + fy)), E.INK, u)


RING = [(x, -10) for x in range(-10, 11)] + [(11, y) for y in range(-10, 11)] + \
       [(x, 11) for x in range(11, -10, -1)] + [(-10, y) for y in range(11, -10, -1)]    # 칩 둘레 사각 길(84칸)


def orbit_body(img, d, ta, y0, lit, n_dots):
    """ORBIT 카드 그림: 위성 몸통 + 칩 + 라벨 VACUUM. 열 점(2px)이 n_dots개 칩 둘레를 12fps로 한 칸씩 맴돈다(바깥으로 안 나간다)."""
    d.rectangle((24, y0 + 22, 60, y0 + 64), fill=E.CARD, outline=E.LABEL)
    cx, cy = 42, y0 + 43
    d.rectangle((cx - 5, cy - 4, cx + 4, cy + 3), fill=E.TEXT if lit else E.DEEP)
    E.text(img, (78, y0 + 38), "VACUUM", "label", E.LABEL)
    k = round(ta * 12) * 2
    for i in range(n_dots):
        rx, ry = RING[(14 * i + k) % len(RING)]
        d.rectangle((cx + rx, cy + ry, cx + rx + 1, cy + ry + 1), fill=E.INK)


def thermometer(img, d, y0, level, mark=None, hot=False, label=True):
    """온도계: 세로 막대 x 146~152, y0+14 ~ y0+62. level = 눈금 윗면의 y. mark = MAX 눈금선 y(없으면 안 그림). hot이면 눈금 DANGER."""
    d.rectangle((146, y0 + 14, 152, y0 + 62), outline=E.LABEL)
    d.rectangle((147, level, 151, y0 + 61), fill=E.DANGER if hot else E.TEXT)
    if label:
        E.text(img, (147, y0 + 3), "T", "label", E.LABEL)
    if mark is not None:
        d.line((138, mark, 154, mark), fill=E.LABEL)
        E.text(img, (116, mark - 6), "MAX", "label", E.LABEL)


def cutaway(img, d, t, ta, outer, inner, box, t_zoom, stage=STAGE, dur=0.5):
    """단면도 확대. t < t_zoom: outer(img, d, t, ta)를 그리고 box는 t_zoom 0.6초 전부터 INK 점선으로 깜빡인다(12fps, 3프레임 켬/끔).
    t_zoom~+dur: 바깥 모습을 지우고 box 테두리만 stage까지 ease_out으로 자란다(정수 좌표, 비트맵은 늘리지 않는다).
    그 뒤: stage 테두리(LABEL)와 inner(img, d, t, ta, stage)."""
    if t < t_zoom:
        outer(img, d, t, ta)
        if t >= t_zoom - 0.6 and int((ta - (t_zoom - 0.6)) * 12) % 6 < 3:
            dotted_rect(d, box, E.INK)
    elif t < t_zoom + dur:
        u = ease_out(span(ta, t_zoom, t_zoom + dur))
        dotted_rect(d, tuple(round(a + (b - a) * u) for a, b in zip(box, stage)), E.INK)
    else:
        d.rectangle(stage, outline=E.LABEL)
        inner(img, d, t, ta, stage)
