"""7편 도트 그림: 페이지 칸·이름 붙은 상자, 가상 칸 → 표 → RAM 무대(vm·swap·fault 공용), DISK 상자와 스왑 화살표.
도식이며 실측이 아니다. 무대 좌표는 한 곳에 두고 장면마다 상태만 바꾼다."""
from px import engine as E
from px.templates import flow


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


PAGE = {"ram": (E.DEEP, E.INK), "faded": (E.CARD, E.LABEL), "disk": (E.DEEP, E.PURPLE),
        "danger": (E.DANGER, E.DANGER), "lit": (E.DEEP, E.TEXT)}


def page(d, x, y, w, h, style="ram"):
    """페이지 칸. ram: RAM에 있는 페이지(INK 테두리), faded: 오래 안 써 바램(LABEL), disk: 스왑된 페이지(PURPLE)."""
    fill, line = PAGE[style]
    d.rectangle((x, y, x + w - 1, y + h - 1), fill=fill, outline=line)


def slot(d, x, y, w, h, col):
    """페이지가 없는 빈칸: 점선 사각."""
    dotted_rect(d, (x, y, x + w - 1, y + h - 1), col)


def box(img, d, rect, label, lx, ly, col=E.LABEL):
    """이름 붙은 상자(CARD 바탕). 라벨은 (lx, ly)에 왼쪽 위를 맞춘다."""
    d.rectangle(rect, fill=E.CARD, outline=col)
    E.text(img, (lx, ly), label, "label", E.LABEL)


def label(img, x, y, s, col=E.LABEL):
    E.text(img, (x, y), s, "label", col)


# ---------------- vm·swap·fault 무대 ----------------
VX, VW, VH, VP, VY = 32, 26, 20, 26, 54                  # 가상 칸 4개: x, 폭, 높이, 간격, 첫 칸 y
TBX, TBW = 74, 26                                         # 페이지 표 상자 x, 폭 (줄은 가상 칸과 같은 높이)
RBOX = (132, 48, 176, 174)                                # RAM 상자
RX, RW, RH, RP, RY = 140, 28, 18, 24, 54                  # RAM 칸 5개
MAP = (1, 0, 3, 4)                                        # 가상 i번째 칸이 가는 RAM 칸(높이가 다르게 섞인다)
DBOX = (112, 204, 176, 248)                               # DISK 상자
DPAGE_Y = 224                                             # DISK 안 페이지 칸의 y
ARROW_X = RX + RW // 2                                    # RAM ↔ DISK 스왑 화살표 x
READ_Y = VY + VP * 3 + VH // 2                            # 마지막(4번째) 가상 칸 가운데 높이


def vy(i):
    return VY + VP * i


def ry(k):
    return RY + RP * k


def v_path(i):
    """가상 i번째 칸 → (표 줄) → RAM 칸. 수평 → 45° → 수평."""
    y0, y1 = vy(i) + VH // 2, ry(MAP[i]) + RH // 2
    xa = 103
    return ((VX + VW + 1, y0), (xa, y0), (xa + abs(y1 - y0), y1), (RX - 3, y1))


def vflow(d, ta, i, color, u=1.0, phase=None, thick=False):
    flow(d, ta, v_path(i), color, u, thick=thick, phase=phase)


def virtual(img, d, lit=None):
    """VIRTUAL 열. lit: {칸 번호: 테두리색}."""
    label(img, VX, 36, "VIRTUAL")
    for i in range(4):
        d.rectangle((VX, vy(i), VX + VW - 1, vy(i) + VH - 1), fill=E.CARD, outline=(lit or {}).get(i, E.LABEL))


def table(img, d, lit=None):
    """PAGE TABLE 상자와 4줄(가상 칸과 같은 높이). lit: {줄 번호: 테두리색}."""
    label(img, TBX + 2, 36, "PAGE TABLE")
    d.rectangle((TBX - 3, 48, TBX + TBW + 2, vy(3) + VH + 5), fill=E.CARD, outline=E.LABEL)
    for i in range(4):
        d.rectangle((TBX, vy(i), TBX + TBW - 1, vy(i) + VH - 1), fill=E.CARD, outline=(lit or {}).get(i, E.LABEL))


def ram(img, d, pages):
    """RAM 상자와 칸 5개. pages: {칸 번호: 페이지 스타일 또는 'slot'(빈칸)}; 없는 칸은 자리만."""
    box(img, d, RBOX, "RAM", RBOX[0] + (RBOX[2] - RBOX[0] - E.text_w("RAM", "label")) // 2 + 1, 36)
    for k in range(5):
        st = pages.get(k)
        if st is None:
            d.rectangle((RX, ry(k), RX + RW - 1, ry(k) + RH - 1), outline=E.CARD)
        elif isinstance(st, tuple):                        # ("slot", 색)
            slot(d, RX, ry(k), RW, RH, st[1])
        else:
            page(d, RX, ry(k), RW, RH, st)


def disk(img, d, col=E.PURPLE):
    box(img, d, DBOX, "DISK", DBOX[0] + 6, DBOX[1] + 4, col)


def swap_path(down):
    """RAM 4번째 칸 ↔ DISK 페이지: 내릴 때 위 → 아래, 올릴 때 아래 → 위(마지막 구간은 수직)."""
    a, b = (ARROW_X, ry(4) + RH + 2), (ARROW_X, DPAGE_Y - 3)
    return (a, b) if down else (b, a)


def read_path():
    """READ 흐름: 왼쪽 끝에서 마지막 가상 칸으로."""
    return ((3, READ_Y), (VX - 3, READ_Y))
