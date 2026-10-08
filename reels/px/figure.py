"""사람 도트 부품: 반신상 figure(옆얼굴 side·앞모습 front, 150x200 + 앵커)와 작은 얼굴 아이콘 icon(20x22, woman·man·girl·boy).
마스코트처럼 사람 전용 색 면 + OUTLINE 테두리, 피부만 그늘 한 단(디더 없음). 눈동자가 흰자 위아래를 채운다(사백안 방지).
반신상 윤곽은 조절점을 지나는 매끈한 곡선(Catmull-Rom)을 4배로 그려 줄인 뒤 튀는 도트를 지운다 — 다각형 직선 계단이 생기지 않게.
오른쪽을 보게 하려면 flip=True(거울상, 반신상 앵커 x도 뒤집힌다). 미리보기: reels/.venv/bin/python -m px.figure out.png"""
from functools import lru_cache

import numpy as np
from PIL import Image, ImageDraw

from px import engine as E

W, H, SS = 150, 200, 4

# 사람 전용 색(engine.PEOPLE_COLORS와 같아야 한다 — 미리보기 실행이 확인). 의미 색(INK·PURPLE·DANGER…)은 사람에게 쓰지 않는다. 테두리·눈동자는 마스코트처럼 OUTLINE.
SCHEMES = {
    # warm: 사람이 장면의 주인공일 때(잘 읽힌다). muted: 도식 옆 조연일 때(배경에 묻혀 도식을 안 가린다).
    "warm": {"skin": ("#D9A88A", "#A87562"), "hair": {"black": "#2E2438", "brown": "#6B4A3A", "gray": "#9A93A8"},
             "cloth": {"blue": "#4E6A9C", "mustard": "#C9A25A", "plum": "#8A5A7E"}},
    "muted": {"skin": ("#C9A08E", "#946A66"), "hair": {"black": "#2E2438", "brown": "#5E4438", "gray": "#8C8598"},
              "cloth": {"blue": "#4A5E86", "mustard": "#8A7A4E", "plum": "#7A5070"}},
}


def _spline(pts, n=12):
    """닫힌 Catmull-Rom: 조절점을 모두 지난다."""
    out, k = [], len(pts)
    for i in range(k):
        p0, p1, p2, p3 = (np.array(pts[(i + j) % k], float) for j in (-1, 0, 1, 2))
        for t in np.linspace(0, 1, n, endpoint=False):
            out.append(0.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t
                              + (3 * p1 - p0 - 3 * p2 + p3) * t ** 3))
    return out


def _mask(*shapes):
    """조절점 목록(곡선) 또는 ("poly", 점들)(직선 다각형)을 합친 불리언 마스크. 4배로 그려 절반 이상 찬 칸만 남긴다."""
    m = Image.new("L", (W * SS, H * SS), 0)
    d = ImageDraw.Draw(m)
    for s in shapes:
        pts = s[1] if s[0] == "poly" else _spline(s)
        d.polygon([(x * SS, y * SS) for x, y in pts], fill=255)
    a = np.asarray(m, float).reshape(H, SS, W, SS).mean((1, 3)) >= 128
    return _clean(a)


def _sh(m, dy, dx):
    """out[y, x] = m[y+dy, x+dx] (밖은 False)."""
    o = np.zeros_like(m)
    h, w = m.shape
    o[max(0, -dy):h - max(0, dy), max(0, -dx):w - max(0, dx)] = m[max(0, dy):h - max(0, -dy), max(0, dx):w - max(0, -dx)]
    return o


def _clean(m):
    """가로·세로 이웃이 하나 이하인 튀는 도트를 지우고, 셋 이상 둘러싸인 빈 칸을 메운다(윤곽 지글거림 제거)."""
    for _ in range(2):
        n = sum(_sh(m, dy, dx).astype(int) for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)))
        m = (m & (n >= 2)) | (~m & (n >= 3))
    return m


def _edge(m):
    """마스크 안쪽 가장자리(상하좌우 중 하나라도 밖)."""
    return m & ~(_sh(m, 1, 0) & _sh(m, -1, 0) & _sh(m, 0, 1) & _sh(m, 0, -1))


def _ring(m):
    """마스크 바깥 1도트 테두리."""
    return ~m & (_sh(m, 1, 0) | _sh(m, -1, 0) | _sh(m, 0, 1) | _sh(m, 0, -1))


def _lit(out, m, base, shade, dark=3):
    """면 + 오른쪽 아래 그늘 띠(빛은 왼쪽 위, 디더 없음)."""
    out[m] = base
    out[m & ~_sh(m, dark, dark)] = shade


def _paint(out, d_fn):
    a = np.zeros((H, W, 4), np.uint8)
    for c in set(out[out != ""].tolist()):
        a[out == c] = (*(int(c[i:i + 2], 16) for i in (1, 3, 5)), 255)
    img = Image.fromarray(a, "RGBA")
    d_fn(ImageDraw.Draw(img))
    return img


def _eye(d, ex, ey, brow, outer):
    """정면 눈: 흰자 9x7 위를 윗눈꺼풀 선이 덮고, 검은 눈동자 5x7이 위아래를 꽉 채운다(흰자는 양옆에만 — 사백안 방지).
    outer: 눈꼬리 쪽(-1 왼쪽, 1 오른쪽) — 그쪽 눈꺼풀이 한 도트 더 길게 내려온다. 눈썹은 머리색."""
    d.rectangle((ex - 4, ey - 3, ex + 4, ey + 3), fill=E.TEXT)
    d.line((ex - 4, ey - 4, ex + 4, ey - 4), fill=E.OUTLINE)
    d.point((ex + 5 * outer, ey - 3), fill=E.OUTLINE)
    d.rectangle((ex - 2, ey - 3, ex + 2, ey + 3), fill=E.OUTLINE)
    d.rectangle((ex - 2, ey - 3, ex - 1, ey - 2), fill=E.TEXT)
    d.line((ex - 4, ey - 8, ex + 4, ey - 8), fill=brow)
    d.point((ex + 5 * outer, ey - 7), fill=brow)


def _eye_side(d, ex, ey, brow):
    """옆 눈(왼쪽 보기): 눈동자 4x7이 앞쪽(왼쪽)에 붙고 흰자는 뒤쪽에만 보인다. 윗눈꺼풀 선과 눈썹."""
    d.rectangle((ex - 2, ey - 3, ex + 3, ey + 3), fill=E.TEXT)
    d.line((ex - 3, ey - 4, ex + 4, ey - 4), fill=E.OUTLINE)
    d.point((ex + 4, ey - 3), fill=E.OUTLINE)
    d.rectangle((ex - 2, ey - 3, ex + 1, ey + 3), fill=E.OUTLINE)
    d.rectangle((ex - 2, ey - 3, ex - 1, ey - 2), fill=E.TEXT)
    d.line((ex - 3, ey - 8, ex + 4, ey - 8), fill=brow)
    d.point((ex + 5, ey - 7), fill=brow)


def _smile(d, x0, x1, y, col):
    """가운데가 한 도트 내려간 작은 웃는 입."""
    d.point((x0, y), fill=col)
    d.line((x0 + 1, y + 1, x1 - 1, y + 1), fill=col)
    d.point((x1, y), fill=col)


# ---------------- 옆얼굴(왼쪽 보기) ----------------
SIDE_HEAD = [(58, 28), (82, 15), (110, 15), (130, 26), (140, 48), (141, 72), (134, 94), (120, 108), (104, 114),
             (92, 120), (78, 128), (64, 135), (54, 137), (48, 130), (46, 118), (46, 104), (44, 102), (35, 98), (45, 82),
             (47, 70), (46, 54), (50, 40)]
SIDE_NECK = ("poly", [(62, 128), (110, 102), (116, 140), (122, 168), (54, 168), (58, 148)])
SIDE_BODY = [(64, 152), (46, 160), (36, 174), (30, 200), (148, 200), (146, 180), (138, 164), (118, 152), (92, 150)]
SIDE_HAIR = [(20, 0), (150, 0), (150, 108), (116, 106), (108, 94), (106, 74), (96, 68), (88, 74), (86, 62),
             (76, 50), (60, 42), (20, 40)]
SIDE_EAR = [(95, 76), (103, 74), (107, 82), (105, 94), (99, 100), (94, 96), (93, 86)]
SIDE_ANCHORS = {"eye": (56, 78), "brain": (96, 50), "ear": (100, 87), "mouth": (49, 112), "nose": (39, 96),
                "throat": (72, 146), "chest": (60, 180), "back": (132, 70)}


def _side(sc, hair, cloth):
    skin, shade = sc["skin"]
    head, neck, body = _mask(SIDE_HEAD), _mask(SIDE_NECK), _mask(SIDE_BODY)
    hm, ear = head & _mask(SIDE_HAIR), _mask(SIDE_EAR)
    out = np.full((H, W), "", object)
    _lit(out, neck, skin, shade)
    out[neck & ~head & _sh(head, -1, 0)] = shade                         # 턱선
    out[body] = sc["cloth"][cloth]
    _lit(out, head, skin, shade)
    out[hm] = sc["hair"][hair]
    out[ear] = skin
    out[_edge(ear)] = shade
    out[_ring(head | neck | body)] = E.OUTLINE

    def face(d):
        _eye_side(d, *SIDE_ANCHORS["eye"], sc["hair"][hair])
        _smile(d, 47, 52, 111, E.OUTLINE)
        ax, ay = SIDE_ANCHORS["ear"]
        d.rectangle((ax, ay - 1, ax + 1, ay + 1), fill=shade)                # 귓구멍
    return _paint(out, face)


# ---------------- 앞모습 ----------------
FRONT_HEAD = [(75, 16), (98, 20), (110, 38), (113, 62), (110, 86), (102, 104), (90, 116), (75, 121), (60, 116),
              (48, 104), (40, 86), (37, 62), (40, 38), (52, 20)]
FRONT_NECK = ("poly", [(62, 110), (88, 110), (91, 156), (59, 156)])
FRONT_BODY = [(75, 148), (98, 150), (126, 158), (142, 172), (148, 200), (2, 200), (8, 172), (24, 158), (52, 150)]
FRONT_HAIR = [(75, 8), (102, 13), (117, 34), (117, 64), (111, 58), (108, 46), (96, 44), (86, 48), (75, 46), (64, 48),
              (54, 44), (42, 46), (39, 58), (33, 64), (33, 34), (48, 13)]
FRONT_EARS = ([(40, 70), (33, 68), (30, 77), (33, 88), (41, 92)], [(110, 70), (117, 68), (120, 77), (117, 88), (109, 92)])
FRONT_ANCHORS = {"eye_l": (64, 78), "eye_r": (86, 78), "brain": (75, 36), "nose": (75, 88), "mouth": (75, 98),
                 "throat": (75, 136), "chest": (75, 178), "heart": (86, 178)}


def _front(sc, hair, cloth):
    skin, shade = sc["skin"]
    head, neck, body = _mask(FRONT_HEAD), _mask(FRONT_NECK), _mask(FRONT_BODY)
    hm, ears = _mask(FRONT_HAIR), _mask(*FRONT_EARS)
    out = np.full((H, W), "", object)
    out[neck] = skin
    out[neck & ~head & _sh(head, -4, 0)] = shade                         # 턱 밑 그늘
    out[body] = sc["cloth"][cloth]
    out[ears] = skin
    out[_edge(ears)] = shade
    _lit(out, head, skin, shade)
    out[hm] = sc["hair"][hair]
    out[_ring(head | neck | body | hm | ears)] = E.OUTLINE

    def face(d):
        _eye(d, *FRONT_ANCHORS["eye_l"], sc["hair"][hair], -1)
        _eye(d, *FRONT_ANCHORS["eye_r"], sc["hair"][hair], 1)
        mx, my = FRONT_ANCHORS["mouth"]
        _smile(d, mx - 4, mx + 4, my, E.OUTLINE)
        d.line((60, 156, 75, 164), fill=E.OUTLINE)                           # 옷깃(둥근 목)
        d.line((75, 164, 90, 156), fill=E.OUTLINE)
    return _paint(out, face)


@lru_cache(None)
def figure(view="side", hair="black", cloth="blue", flip=False, scheme="warm"):
    """(RGBA 150x200, 앵커 {이름: (x, y)}). 장면에는 img.paste(fig, (x, y), fig)로 붙이고 앵커에 같은 (x, y)를 더한다."""
    sc = SCHEMES[scheme]
    img, anchors = (_side(sc, hair, cloth), SIDE_ANCHORS) if view == "side" else (_front(sc, hair, cloth), FRONT_ANCHORS)
    if flip:
        img = img.transpose(Image.FLIP_LEFT_RIGHT)
        anchors = {k: (W - 1 - x, y) for k, (x, y) in anchors.items()}
    return img, dict(anchors)


# ---------------- 작은 얼굴 아이콘(20x22, 정면) ----------------
# 손으로 찍은 격자. O 테두리 · H 머리카락 · S 얼굴 · E 눈 · M 입 · C 옷 · K 옷 테두리
ICONS = {
    "woman": [
        "......OOOOOOOO......",
        "....OOHHHHHHHHOO....",
        "...OHHHHHHHHHHHHO...",
        "..OHHHHHHHHHHHHHHO..",
        "..OHHHHHHHHHHHHHHO..",
        ".OHHHHOOOOOOOOHHHHO.",
        ".OHHHOSSSSSSSSOHHHO.",
        ".OHHHOSSSSSSSSOHHHO.",
        ".OHHHOSESSSSESOHHHO.",
        ".OHHHOSESSSSESOHHHO.",
        ".OHHHOSSSSSSSSOHHHO.",
        ".OHHHOSSSMMSSSOHHHO.",
        ".OHHHHOSSSSSSOHHHHO.",
        ".OHHHHHOOOOOOHHHHHO.",
        ".OHHHHHOSSSSOHHHHHO.",
        ".OHHHHOOSSSSOOHHHHO.",
        "..OOKKKKKSSKKKKKOO..",
        ".KCCCCCCCKKCCCCCCCK.",
        ".KCCCCCCCCCCCCCCCCK.",
        ".KCCCCCCCCCCCCCCCCK.",
        ".KKKKKKKKKKKKKKKKKK.",
        "....................",
    ],
    "man": [
        "....................",
        "......OOOOOOOO......",
        "....OOHHHHHHHHOO....",
        "...OHHHHHHHHHHHHO...",
        "...OHHHHHHHHHHHHO...",
        "...OHOOOOOOOOOOHO...",
        "...OHOSSSSSSSSOHO...",
        "...OOOSSSSSSSSOOO...",
        "..OSSOSESSSSESOSSO..",
        "..OSSOSESSSSESOSSO..",
        "...OOOSSSSSSSSOOO...",
        ".....OSSSMMSSSO.....",
        ".....OSSSSSSSSO.....",
        "......OOSSSSOO......",
        ".......OOOOOO.......",
        ".......OSSSSO.......",
        "...KKKKOSSSSOKKKK...",
        "..KCCCCKKSSKKCCCCK..",
        ".KCCCCCCCKKCCCCCCCK.",
        ".KCCCCCCCCCCCCCCCCK.",
        ".KKKKKKKKKKKKKKKKKK.",
        "....................",
    ],
    "girl": [
        "....................",
        "....................",
        "......OOOOOOOO......",
        "....OOHHHHHHHHOO....",
        "...OHHHHHHHHHHHHO...",
        "...OHOOOOOOOOOOHO...",
        "..OOHOSSSSSSSSOHOO..",
        ".OHHOOSSSSSSSSOOHHO.",
        ".OHHHOSESSSSESOHHHO.",
        ".OHHHOSESSSSESOHHHO.",
        ".OHHOOSSSMMSSSOOHHO.",
        "..OO..OSSSSSSO..OO..",
        ".......OOOOOO.......",
        "........OSSO........",
        "......KKOSSOKK......",
        ".....KCCKKKKCCK.....",
        "....KCCCCCCCCCCK....",
        "....KCCCCCCCCCCK....",
        "....KKKKKKKKKKKK....",
        "....................",
        "....................",
        "....................",
    ],
    "boy": [
        "....................",
        "..........O.........",
        "......OOOOHOOO......",
        "....OOHHHHHHHHOO....",
        "...OHHHHHHHHHHHHO...",
        "...OHOOOOOOOOOOHO...",
        "...OOOSSSSSSSSOOO...",
        "..OSSOSSSSSSSSOSSO..",
        "..OSSOSESSSSESOSSO..",
        "...OOOSESSSSESOOO...",
        ".....OSSSMMSSSO.....",
        "......OSSSSSSO......",
        ".......OOOOOO.......",
        "........OSSO........",
        "......KKOSSOKK......",
        ".....KCCKKKKCCK.....",
        "....KCCCCCCCCCCK....",
        "....KCCCCCCCCCCK....",
        "....KKKKKKKKKKKK....",
        "....................",
        "....................",
        "....................",
    ],
}


ICON_LOOKS = {"woman": ("brown", "blue"), "man": ("black", "mustard"), "girl": ("black", "plum"), "boy": ("brown", "blue")}


@lru_cache(None)
def icon(name, hair=None, cloth=None, flip=False, scheme="warm"):
    """작은 얼굴 아이콘 RGBA 20x22(woman·man·girl·boy). 바닥 줄이 같아서 나란히 두면 아이가 작게 선다. 키울 땐 정수배 최근접만.
    격자의 O 중 바깥에 닿지 않은 것(머리·얼굴 경계, 턱선)은 테두리가 아니라 머리색 또는 피부 그늘로 칠한다."""
    sc = SCHEMES[scheme]
    h0, c0 = ICON_LOOKS[name]
    skin, shade = sc["skin"]
    cols = {"H": sc["hair"][hair or h0], "S": skin, "E": E.OUTLINE, "M": shade, "C": sc["cloth"][cloth or c0], "K": E.OUTLINE}
    rows = ICONS[name]
    at = lambda x, y: rows[y][x] if 0 <= y < len(rows) and 0 <= x < len(rows[0]) else "."
    img = Image.new("RGBA", (len(rows[0]), len(rows)), (0, 0, 0, 0))
    for y, row in enumerate(rows):
        for x, ch in enumerate(row):
            if ch == ".":
                continue
            nb = [at(x + dx, y + dy) for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))]
            col = E.OUTLINE if ch == "O" and "." in nb else sc["hair"][hair or h0] if ch == "O" and "H" in nb else shade if ch == "O" else cols[ch]
            img.putpixel((x, y), (*(int(col[i:i + 2], 16) for i in (1, 3, 5)), 255))
    return img.transpose(Image.FLIP_LEFT_RIGHT) if flip else img


if __name__ == "__main__":
    import sys
    from px import lint
    assert {c for sc in SCHEMES.values() for c in (*sc["skin"], *sc["hair"].values(), *sc["cloth"].values())} == set(E.PEOPLE_COLORS)
    assert all(len(r) == 20 for v in ICONS.values() for r in v) and all(len(v) == 22 for v in ICONS.values())
    sheet = Image.new("RGB", (E.W * 3, E.H * len(SCHEMES)), E.BG)
    for j, k in enumerate(SCHEMES):                       # 행: 시안, 열: 옆 · 앞 · 아이콘(1·2·3배)
        cs = [E.background() for _ in range(3)]
        for c, (view, hair, cloth) in zip(cs, (("side", "black", "blue"), ("front", "brown", "mustard"))):
            fig, _ = figure(view, hair, cloth, scheme=k)
            c.paste(fig, (15, 40), fig)
        for i, name in enumerate(ICONS):
            ic = icon(name, scheme=k)
            cs[2].paste(ic, (4 + i * 44, 20), ic)
            for n, y in ((2, 60), (3, 130 + 70 * (i // 2))):
                big = ic.resize((20 * n, 22 * n), Image.NEAREST)
                cs[2].paste(big, (i * 44 if n == 2 else 20 + (i % 2) * 80, y), big)
        for i, c in enumerate(cs):
            assert lint.check_canvas(c, E.PALETTE, ignore=(E.BG, E.DITHER))[0] == 0, k
            sheet.paste(c, (i * E.W, j * E.H))
    sheet.resize((sheet.width * 2, sheet.height * 2), Image.NEAREST).save(sys.argv[1] if len(sys.argv) > 1 else "figure_preview.png")
