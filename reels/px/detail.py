"""큰 그림 디테일 키트: 면 명암 2단, 이음선·나사, 통풍구, 파이프 이음매, 표시등, 반사 줄, 태양전지 셀, 칩 기판, 방열판 핀.
**상한:** 디테일 선과 선 사이는 최소 2도트, 폭 6도트 이하 작은 면엔 디더 음영 없음, 한 부품에 디테일 종류는 최대 2~3개, 폰 화면에서 읽혀야 한다(하이라이트·그림자 짝은 선 하나로 센다).
전부 팔레트 안의 색만 쓰고(호출자가 색을 넘긴다), 좌표는 정수 도트다. d는 ImageDraw. 색 짝 예: INK 면 → (밝음 TEXT·C9F5DA, 그림자 DEEP) / CARD 면 → (밝음 LABEL, 그림자 OUTLINE)."""
from px.timeline import step


def shaded(d, box, base, light, dark, dither=True):
    """명암 2단 면: 바탕 + 위·왼쪽 가장자리 1도트 하이라이트 + 아래·오른쪽 1도트 그림자. 넓은 면(두 변 24도트 이상)은 그림자 안쪽에 체크 디더 2줄."""
    x0, y0, x1, y1 = box
    d.rectangle(box, fill=base)
    if dither and x1 - x0 >= 24 and y1 - y0 >= 24:
        for y in range(y0 + 1, y1):
            for x in range(x0 + 1, x1):
                if (x1 - x < 4 or y1 - y < 4) and (x + y) % 2 == 0:
                    d.point((x, y), fill=dark)
    d.line((x0, y0, x1, y0), fill=light)
    d.line((x0, y0, x0, y1), fill=light)
    d.line((x0, y1, x1, y1), fill=dark)
    d.line((x1, y0, x1, y1), fill=dark)


def rivets(d, pts, light, dark):
    """나사(리벳): 2x2 — 왼쪽 위 하이라이트 1도트, 나머지 그림자."""
    for x, y in pts:
        d.rectangle((x, y, x + 1, y + 1), fill=dark)
        d.point((x, y), fill=light)


def seams(d, box, cols, rows, line, light=None):
    """패널 이음선: box를 cols x rows로 가르는 1도트 선(옆에 하이라이트 줄이 있으면 light)."""
    x0, y0, x1, y1 = box
    for i in range(1, cols):
        x = x0 + (x1 - x0) * i // cols
        d.line((x, y0 + 1, x, y1 - 1), fill=line)
        if light:
            d.line((x + 1, y0 + 1, x + 1, y1 - 1), fill=light)
    for j in range(1, rows):
        y = y0 + (y1 - y0) * j // rows
        d.line((x0 + 1, y, x1 - 1, y), fill=line)
        if light:
            d.line((x0 + 1, y + 1, x1 - 1, y + 1), fill=light)


def vents(d, box, dark, light, gap=3):
    """통풍구·그릴: 어두운 가로 줄 + 바로 아래 하이라이트 1도트 줄, gap 간격."""
    x0, y0, x1, y1 = box
    for y in range(y0, y1 + 1, gap):
        d.line((x0, y, x1, y), fill=dark)
        if y + 1 <= y1:
            d.line((x0, y + 1, x1, y + 1), fill=light)


def pipe(d, pts, w, base, light, dark, ring=None):
    """수평·수직 파이프(꺾임 허용): 굵기 w, 한쪽 하이라이트·반대쪽 그림자, 꺾임과 끝에 이음매 고리(ring 색, 기본 dark)."""
    ring = ring or dark
    for (ax, ay), (bx, by) in zip(pts, pts[1:]):
        if ay == by:                                  # 수평
            x0, x1 = sorted((ax, bx))
            d.rectangle((x0, ay, x1, ay + w - 1), fill=base)
            d.line((x0, ay, x1, ay), fill=light)
            d.line((x0, ay + w - 1, x1, ay + w - 1), fill=dark)
        else:                                         # 수직
            y0, y1 = sorted((ay, by))
            d.rectangle((ax, y0, ax + w - 1, y1), fill=base)
            d.line((ax, y0, ax, y1), fill=light)
            d.line((ax + w - 1, y0, ax + w - 1, y1), fill=dark)
    for (x, y), (nx, ny) in zip(pts, pts[1:]):         # 이음매: 시작점마다 파이프를 가로지르는 1도트 고리
        if y == ny:
            d.line((x + (2 if nx > x else -2), y - 1, x + (2 if nx > x else -2), y + w), fill=ring)
        else:
            d.line((x - 1, y + (2 if ny > y else -2), x + w, y + (2 if ny > y else -2)), fill=ring)


def led(d, x, y, t, on, off, period=0.5, phase=0.0):
    """작은 표시등 2x2: period초 주기로 켜졌다 꺼진다(12fps 단계). 켜지면 위 1도트 하이라이트 없이 on 색 한 덩어리."""
    lit = int((step(t) + phase) / (period / 2)) % 2 == 0
    d.rectangle((x, y, x + 1, y + 1), fill=on if lit else off)


def glint(d, x, y, n, color, gap=2):
    """금속·유리 반사 줄: (x, y)에서 오른쪽 위로 45° 짧은 줄 두 토막(길이 n, 토막 사이 gap)."""
    for k in range(n):
        d.point((x + k, y - k), fill=color)
    for k in range(n // 2):
        d.point((x + n + gap + k, y - n - gap - k), fill=color)


def solar_cells(d, box, cols, rows, base, line, light):
    """태양전지 격자: 셀마다 위·왼쪽 하이라이트, 칸 사이 선(line), 대각 반사 줄 하나."""
    x0, y0, x1, y1 = box
    d.rectangle(box, fill=line)
    cw, ch = (x1 - x0 + 1) / cols, (y1 - y0 + 1) / rows
    for c in range(cols):
        for r in range(rows):
            ax, ay = x0 + round(c * cw) + 1, y0 + round(r * ch) + 1
            bx, by = x0 + round((c + 1) * cw) - 1, y0 + round((r + 1) * ch) - 1
            d.rectangle((ax, ay, bx, by), fill=base)
            d.line((ax, ay, bx, ay), fill=light)
    glint(d, x0 + 3, y1 - 3, 5, light)


def board(d, box, fill, trace, pin, pins=4):
    """칩 기판: 바탕 + 안쪽 회로선(ㄱ자 몇 줄) + 사방 가장자리 핀(2도트 길이)."""
    x0, y0, x1, y1 = box
    d.rectangle(box, fill=fill)
    w, h = x1 - x0, y1 - y0
    for k in range(pins):
        px = x0 + (k + 1) * w // (pins + 1)
        py = y0 + (k + 1) * h // (pins + 1)
        d.line((px, y0 - 2, px, y0 - 1), fill=pin)
        d.line((px, y1 + 1, px, y1 + 2), fill=pin)
        d.line((x0 - 2, py, x0 - 1, py), fill=pin)
        d.line((x1 + 1, py, x1 + 2, py), fill=pin)
    for k in range(1, 4):                              # 회로선: 바깥 핀에서 중앙 쪽으로 꺾이는 선
        sx, sy = x0 + 2 + k * 3, y0 + 2 + k * 3
        d.line((sx, y0 + 1, sx, sy), fill=trace)
        d.line((sx, sy, x1 - 3 - k * 2, sy), fill=trace)


def fins(d, box, base, light, dark, step_px=3):
    """방열판 핀: 세로 줄무늬(밝음·바탕·그림자 반복) + 위아래 가장자리 하이라이트."""
    x0, y0, x1, y1 = box
    d.rectangle(box, fill=base)
    for x in range(x0 + 1, x1, step_px):
        d.line((x, y0 + 1, x, y1 - 1), fill=light)
        if x + 1 < x1:
            d.line((x + 1, y0 + 1, x + 1, y1 - 1), fill=dark)
    d.line((x0, y0, x1, y0), fill=light)
    d.line((x0, y1, x1, y1), fill=dark)
