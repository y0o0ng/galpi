"""8편 도트 그림: 단면도 확대(cutaway, 5편 것에 keep_outer를 더함), 바위 면·우물·틈·지상 발전소·시추탑, 아이콘 칸 카드.
도식이며 실측이 아니다(깊이·온도·거리 숫자 없음). 무대 좌표는 한 곳에 두고 장면마다 상태만 바꾼다."""
from functools import lru_cache

from PIL import Image, ImageDraw

from px import detail as DT, draw as D, engine as E
from px.templates import flow
from px.timeline import ease_out, span

BAYER = E.BAYER
FLOW_STEP = 2                                           # templates.flow의 12fps당 전진 px


# ---------------- 기본 부품 ----------------
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


def label(img, x, y, s, col=E.LABEL):
    E.text(img, (x, y), s, "label", col)


def tag(img, d, x, y, s, col=E.LABEL):
    """디더 바위 위에서도 읽히도록 CARD 판을 깐 라벨."""
    d.rectangle((x - 2, y, x + E.text_w(s, "label") + 1, y + 10), fill=E.CARD)
    label(img, x, y, s, col)


def cutaway(img, d, t, ta, outer, inner, box, t_zoom, stage, dur=0.6, keep_outer=False):
    """단면도 확대(5편 cutaway + keep_outer). t < t_zoom: outer를 그리고 box는 t_zoom 0.6초 전부터 INK 점선으로 깜빡인다(점이면 생략).
    t_zoom~+dur: box 테두리만 stage까지 ease_out으로 자란다(정수 좌표). 그 뒤: stage 테두리(LABEL)와 inner.
    keep_outer면 확대 중·후에도 outer를 계속 그린다. inner는 별도 RGBA 캔버스에 그려 stage로 잘라 붙인다."""
    if outer and (t < t_zoom or keep_outer):
        outer(img, d, t, ta)
    if t < t_zoom:
        if (box[0] != box[2] or box[1] != box[3]) and t >= t_zoom - 0.6 and int((ta - (t_zoom - 0.6)) * 12) % 6 < 3:
            dotted_rect(d, box, E.INK)
    elif t < t_zoom + dur:
        u = ease_out(span(ta, t_zoom, t_zoom + dur))
        dotted_rect(d, tuple(round(a + (b - a) * u) for a, b in zip(box, stage)), E.INK)
    else:
        layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
        inner(layer, ImageDraw.Draw(layer), t, ta, stage)
        x0, y0, x1, y1 = stage
        crop = layer.crop((x0 + 1, y0 + 1, x1, y1))
        img.paste(crop, (x0 + 1, y0 + 1), crop)
        d.rectangle(stage, outline=E.LABEL)


# ---------------- 바위 면: 깊을수록 PURPLE 디더가 같거나 짙다 ----------------
def dens(knots, y):
    """((y, 밀도 16분율), ...) 선형 보간. 끝 밖은 끝 값(깊어져도 줄지 않는다)."""
    if y <= knots[0][0]:
        return knots[0][1]
    for (y0, d0), (y1, d1) in zip(knots, knots[1:]):
        if y <= y1:
            return d0 + (d1 - d0) * (y - y0) / (y1 - y0)
    return knots[-1][1]


@lru_cache(None)
def rock_img(box, knots):
    """바위 면 한 장: CARD 바탕 + 밝은 가장자리 1도트(위·왼쪽) / 그림자 1도트와 체크 디더(아래·오른쪽) + 깊이에 따른 PURPLE Bayer 디더."""
    x0, y0, x1, y1 = box
    img = Image.new("RGB", (x1 - x0 + 1, y1 - y0 + 1), E.CARD)
    DT.shaded(ImageDraw.Draw(img), (0, 0, x1 - x0, y1 - y0), E.CARD, E.LABEL, E.OUTLINE)
    px, purple = img.load(), tuple(int(E.PURPLE[i:i + 2], 16) for i in (1, 3, 5))
    for y in range(y0 + 2, y1 - 3):
        lv = dens(knots, y)
        for x in range(x0 + 2, x1 - 3):
            if BAYER[y % 4][x % 4] < lv:
                px[x - x0, y - y0] = purple
    return img


# ---------------- 우물·틈·흐름 ----------------
def thick(d, p0, p1, w, color):
    """w두께 선(w=2·4): 세로에 가까우면 가로로, 아니면 세로로 두껍게. w=4는 중심을 맞추려고 한 도트 위·왼쪽으로 옮긴다."""
    off = (w - 2) // 2
    if abs(p1[1] - p0[1]) > abs(p1[0] - p0[0]):
        D.line(d, (p0[0] - off, p0[1]), (p1[0] - off, p1[1]), color, w)
    else:
        D.line(d, (p0[0], p0[1] - off), (p1[0], p1[1] - off), color, w)


def part(pts, u):
    """꺾은선의 처음 u(길이 비율)만. 마지막 마디는 비율로 자른다."""
    segs = [(a, b, max(abs(b[0] - a[0]), abs(b[1] - a[1]))) for a, b in zip(pts, pts[1:])]
    left, out = round(u * sum(s[2] for s in segs)), [pts[0]]
    for a, b, n in segs:
        if left <= 0:
            break
        f = min(1, left / n)
        out.append(b if f >= 1 else (a[0] + round((b[0] - a[0]) * f), a[1] + round((b[1] - a[1]) * f)))
        left -= n
    return out


def cracks(d, items):
    """items: [(꺾은선, 자란 비율 u, 굵게?)]. 굵은 틈은 OUTLINE 4px 길 + TEXT 2px 속(전부 길을 먼저 깐다), 얇은 틈은 LABEL 1px."""
    bold, fine = [], []
    for pts, u, strong in items:
        pp = part(pts, u)
        if len(pp) >= 2:
            (bold if strong else fine).append(pp)
    for core in (False, True):                       # 얇은 틈: OUTLINE 가장자리를 먼저 깔고 LABEL 1px
        for pp in fine:
            for a, b in zip(pp, pp[1:]):
                if core:
                    D.line(d, a, b, E.LABEL)
                else:
                    s = (1, 0) if abs(b[1] - a[1]) > abs(b[0] - a[0]) else (0, 1)
                    for k in (-1, 1):
                        D.line(d, (a[0] + s[0] * k, a[1] + s[1] * k), (b[0] + s[0] * k, b[1] + s[1] * k), E.OUTLINE)
    for w, col in ((4, E.OUTLINE), (2, E.TEXT)):
        for pp in bold:
            for a, b in zip(pp, pp[1:]):
                thick(d, a, b, w, col)


def pipe_v(d, x, y0, y1, u=1.0, t=0.0):
    """세로 우물 관(굵기 4, x..x+3): BG 속 + 왼쪽 LABEL 하이라이트 + 오른쪽 OUTLINE 그림자 + 22px마다 이음 고리. 흐름 점선은 x+1에 놓는다.
    u<1이면 자라는 중: 끝에 TEXT 드릴 끝이 12fps로 깜빡인다."""
    ye = y0 + round((y1 - y0) * u)
    if ye <= y0:
        return
    DT.pipe(d, ((x, y0), (x, ye)), 4, E.BG, E.LABEL, E.OUTLINE, ring=E.LABEL)
    for y in range(y0 + 22, ye - 2, 22):
        d.line((x - 1, y, x + 4, y), fill=E.LABEL)
    d.line((x, ye + 1, x + 3, ye + 1), fill=E.TEXT if u < 1 and int(t * 12) % 2 == 0 else E.LABEL)


def bore(d, pts, u=1.0, t=0.0):
    """굽는 우물(수평·수직·45°): 굵기 4 — 수평·수직은 pipe, 45° 토막은 LABEL / BG 2줄 / OUTLINE 네 줄. 끝에 드릴 끝."""
    pp = part(pts, u)
    for a, b in zip(pp, pp[1:]):
        if a[0] == b[0]:
            DT.pipe(d, (a, b), 4, E.BG, E.LABEL, E.OUTLINE, ring=E.LABEL)
        elif a[1] == b[1]:
            DT.pipe(d, (a, b), 4, E.BG, E.LABEL, E.OUTLINE, ring=E.LABEL)
        else:
            for dy, col in ((0, E.LABEL), (1, E.BG), (2, E.BG), (3, E.OUTLINE)):
                D.line(d, (a[0], a[1] + dy), (b[0], b[1] + dy), col)
    if u < 1 and len(pp) > 1:
        x, y = pp[-1]
        d.rectangle((x, y, x + 3, y + 3), fill=E.TEXT if int(t * 12) % 2 == 0 else E.LABEL)


def plant(img, d, box, t, lit):
    """지상 발전소: 명암 면 + 지붕 + 굴뚝 + 표시등(lit이면 12fps로 깜빡, 아니면 꺼진 LABEL) + 이름 PLANT."""
    x0, y0, x1, y1 = box
    d.line((x0 - 1, y0 - 1, x1 + 1, y0 - 1), fill=E.LABEL)
    DT.shaded(d, box, E.CARD, E.LABEL, E.OUTLINE)
    DT.shaded(d, (x1 - 9, y0 - 6, x1 - 5, y0 - 1), E.CARD, E.LABEL, E.OUTLINE)
    d.line((x1 - 10, y0 - 6, x1 - 4, y0 - 6), fill=E.TEXT)
    if lit:
        DT.led(d, x1 - 8, y0 - 9, t, E.INK, E.DEEP, 0.5)
    else:
        d.rectangle((x1 - 8, y0 - 9, x1 - 7, y0 - 8), fill=E.LABEL)
    label(img, x0 + (x1 - x0 + 1 - 29) // 2, y0 + (y1 - y0 + 1 - 10) // 2, "PLANT")


def rig(d, ta, x):
    """시추탑(높이 22): 두 다리 + 가로대 3줄 + 오르내리는 블록 + 꼭대기 표시등 + 받침판. 밑면이 x~x+22, 지표 y 96."""
    d.rectangle((x - 4, 96, x + 26, 99), fill=E.CARD)
    DT.shaded(d, (x - 4, 96, x + 26, 99), E.CARD, E.LABEL, E.OUTLINE)
    ax = x + 11
    thick(d, (x, 95), (ax, 73), 2, E.LABEL)
    thick(d, (x + 22, 95), (ax, 73), 2, E.LABEL)
    for y in (90, 84, 78):
        half = (96 - y) // 2
        d.line((x + half + 2, y, x + 22 - half - 2, y), fill=E.LABEL)
    k = round(ta * 12) % 12
    yb = 80 + (k if k < 6 else 12 - k)
    d.rectangle((ax - 2, yb, ax + 2, yb + 2), fill=E.TEXT)
    DT.led(d, ax - 1, 69, ta, E.INK, E.DEEP, 0.5)


# ---------------- 큰 단면(make·loop) ----------------
STAGE_BIG = (4, 30, 175, 246)
SURF = 64                                               # 지표선 y
INJ, PRO = 48, 132                                      # 주입정·생산정 흐름 x(관은 x-1~x+2)
INJ_BOT, PRO_BOT = 191, 180
ZONE = (6, 150, 173, 215)                               # HOT ROCK 구역
BIG_KNOTS = ((66, 1), (150, 7), (151, 10))
THROUGH = ((48, 190), (60, 178), (78, 178), (90, 190), (102, 190), (114, 178), (132, 178))   # 틈을 지나는 흐름(위 8+... 정확히 84칸)
DOWN = ((48, 66), (48, 190))
UP = ((132, 176), (132, 57), (108, 57))
BACK = ((73, 57), (48, 57), (48, 62))
NEW_MAIN = THROUGH                                      # 새 틈의 가장 긴 줄기는 흐름 길과 같은 길
NEW_BRANCH = (((69, 178), (79, 168)), ((96, 190), (106, 200)), ((120, 178), (128, 170)), ((54, 184), (62, 192)))
BRANCH_AT = (21, 48, 72, 6)                              # 가지가 돋는 줄기 위 걸음 수
ORIG = (((79, 168), (91, 162)), ((106, 200), (118, 206)), ((128, 170), (116, 164)), ((62, 192), (50, 198)))   # 원래 있던 틈(가지 끝에서 이어진다)


def through(d, ta, u, thick=False, phase=None):
    """틈을 지나는 흐름: 앞 절반 INK(차가운 물), 뒤 절반 PURPLE(데워진 물). 점선 위상이 이어지게 뒤쪽 위상을 42칸 당긴다."""
    ph = round(ta * 12) * FLOW_STEP if phase is None else phase
    flow(d, ta, THROUGH[:4], E.INK, min(u * 2, 0.999), thick, phase=ph)
    if u > 0.5:
        flow(d, ta, THROUGH[3:], E.PURPLE, (u - 0.5) * 2, thick, phase=ph - 42)


def big_stage(img, d, t, ta, st):
    """make·loop 공용 큰 단면. st 키: lit, inj, prod, new, thick, zone_blink, labels(집합), flows{down, through, up, back}(진행도),
    dim(흐름을 LABEL로 낮춤), bold(틈 흐름 3px)."""
    x0, y0, x1, y1 = STAGE_BIG
    d.line((x0 + 1, SURF, x1 - 1, SURF), fill=E.INK)
    d.line((x0 + 1, SURF + 1, x1 - 1, SURF + 1), fill=E.INK)
    img.paste(rock_img((x0 + 1, SURF + 2, x1 - 1, y1 - 1), BIG_KNOTS), (x0 + 1, SURF + 2))
    if st.get("zone_blink"):
        dotted_rect(d, ZONE, E.INK)
    # 틈: 원래 있던 것(얇게 → 굵게)과 새로 생긴 것(굵게)
    n = st.get("new", 0.0)
    items = [(p, 1.0, st.get("thick", False)) for p in ORIG]
    if n > 0:
        items.append((NEW_MAIN, n, True))
        for p, at in zip(NEW_BRANCH, BRANCH_AT):
            items.append((p, min(1.0, max(0.0, (n * 84 - at) / 14)), True))
    cracks(d, items)
    # 지표 관과 우물
    DT.pipe(d, ((74, 56), (47, 56), (47, SURF)), 4, E.BG, E.LABEL, E.OUTLINE, ring=E.LABEL)
    pipe_v(d, INJ - 1, SURF, INJ_BOT, st.get("inj", 0.0), t)
    if st.get("prod", 0.0) > 0:
        DT.pipe(d, ((107, 56), (131, 56), (131, SURF)), 4, E.BG, E.LABEL, E.OUTLINE, ring=E.LABEL)
        pipe_v(d, PRO - 1, SURF, PRO_BOT, st["prod"], t)
    plant(img, d, (74, 46, 106, 63), t, st.get("lit", False))
    # 흐름
    fl = st.get("flows", {})
    dim = st.get("dim", False)
    if "down" in fl:
        flow(d, ta, DOWN, E.LABEL if dim else E.INK, fl["down"])
    if "through" in fl:
        through(d, ta, fl["through"], st.get("bold", False))
    if "up" in fl:
        flow(d, ta, UP, E.LABEL if dim else E.PURPLE, fl["up"])
    if "back" in fl:
        flow(d, ta, BACK, E.LABEL if dim else E.INK, fl["back"])
    lb = st.get("labels", ())
    if "hot" in lb:
        tag(img, d, 58, 140, "HOT ROCK")
    if "inj" in lb:
        label(img, 54, 70, "INJECTION")
    if "prod" in lb:
        label(img, 124 - 56, 82, "PRODUCTION")
    if "frac" in lb:
        label(img, 56, 218, "FRACTURES")
    if "legend" in lb:
        for k, (name, col) in enumerate((("COLD", E.INK), ("HOT", E.PURPLE))):
            d.rectangle((8, 35 + 10 * k, 11, 38 + 10 * k), fill=col)
            label(img, 15, 32 + 10 * k, name)


# ---------------- cape: 멀리서 본 넓은 단면 ----------------
STAGE_CAPE = (4, 36, 175, 246)
CAPE_SURF = 96
WELL_A = ((30, 98), (30, 196), (36, 202), (160, 202))
WELL_B = ((38, 98), (38, 170), (44, 176), (160, 176))
CAPE_KNOTS = ((98, 1), (150, 7), (151, 10))


def cape_stage(img, d, t, ta, st):
    """st: grow(우물 자란 길이 px), lit(PLANT 표시등), horiz(라벨 HORIZONTAL), mw(33 MW + NET)."""
    x0, y0, x1, y1 = STAGE_CAPE
    d.line((x0 + 1, CAPE_SURF, x1 - 1, CAPE_SURF), fill=E.INK)
    d.line((x0 + 1, CAPE_SURF + 1, x1 - 1, CAPE_SURF + 1), fill=E.INK)
    img.paste(rock_img((x0 + 1, CAPE_SURF + 2, x1 - 1, y1 - 1), CAPE_KNOTS), (x0 + 1, CAPE_SURF + 2))
    tag(img, d, 58, 140, "HOT ROCK")
    rig(d, ta, 24)
    for w in (WELL_A, WELL_B):
        total = sum(max(abs(b[0] - a[0]), abs(b[1] - a[1])) for a, b in zip(w, w[1:]))
        u = min(1.0, st["grow"] / total)
        if u > 0:
            bore(d, w, u, t)
    plant(img, d, (128, 78, 160, 95), t, st.get("lit", False))
    if st.get("horiz"):
        label(img, 60, 222, "HORIZONTAL")
    if st.get("mw"):
        E.text(img, (86, 39), "33 MW", "bold", E.TEXT, 2)
        label(img, 86 + (88 - E.text_w("NET", "label")) // 2, 65, "NET")


# ---------------- limit: 단층 확대 ----------------
LIMIT_BOX = (36, 84, 46, 94)
LIMIT_STAGE = (14, 108, 166, 246)
FAULT = ((60, 116), (124, 244))
WELL_X = 36                                             # 확대 상자 안 우물 흐름 x(관은 35~38)
TIP_CRACKS = (((38, 172), (50, 166)), ((38, 178), (54, 186)), ((36, 182), (46, 192)))
ARC_C = (73, 142)                                       # 떨림 호 중심(단층선 위)


def mini_section(img, d, ta, phase):
    """왼쪽 위 작은 전체 단면 (10, 40, 70, 98): 지표선, 우물 하나(INK 흐름), 짙어지는 디더."""
    d.rectangle((10, 40, 70, 98), outline=E.LABEL)
    img.paste(rock_img((11, 50, 69, 97), ((50, 1), (97, 12))), (11, 50))
    d.line((11, 48, 69, 48), fill=E.INK)
    d.line((11, 49, 69, 49), fill=E.INK)
    pipe_v(d, 39, 50, 90)
    flow(d, ta, ((40, 52), (40, 86)), E.INK, phase=phase)


def limit_stage(img, d, t, ta, st):
    """st: crack(새 틈 자란 비율), shake(떨림 호 보이는지), danger(단층 DANGER), quake(QUAKE 라벨), ctrl(CONTROLLED), phase(흐름 위상)."""
    x0, y0, x1, y1 = LIMIT_STAGE
    img.paste(rock_img((x0 + 1, y0 + 1, x1 - 1, y1 - 1), ((108, 6), (160, 9), (246, 10))), (x0 + 1, y0 + 1))
    for w, col in ((4, E.OUTLINE), (2, E.DANGER if st.get("danger") else E.LABEL)):
        thick(d, FAULT[0], FAULT[1], w, col)
    cracks(d, [(p, st.get("crack", 0.0), True) for p in TIP_CRACKS])
    pipe_v(d, WELL_X - 1, y0 + 1, 176)
    flow(d, ta, ((WELL_X, y0 + 3), (WELL_X, 170)), E.INK, phase=st["phase"])
    if st.get("shake"):
        cx, cy = ARC_C
        for r in (6, 10, 14):
            D.circle(d, cx, cy, r, outline=E.DANGER, arc=(1.9, 2.9))
            D.circle(d, cx, cy, r, outline=E.DANGER, arc=(-0.8, 0.2))
    if st.get("quake"):
        tag(img, d, 96, 132, "QUAKE", E.DANGER)
    if st.get("ctrl"):
        tag(img, d, 18, 196, "CONTROLLED")


# ---------------- hook 그림 ----------------
def hook_art(img, d, t, ta):
    """작은 땅 단면 (6, 152, 112, 246): 지표선, 아래로 짙어지는 바위, 우물 두 개(왼쪽 INK 아래로 / 오른쪽 PURPLE 위로)와 그 사이 틈. 점선이 돈다."""
    img.paste(rock_img((6, 166, 112, 246), ((166, 2), (246, 10))), (6, 166))
    d.line((6, 164, 112, 164), fill=E.INK)
    d.line((6, 165, 112, 165), fill=E.INK)
    main = ((29, 214), (41, 226), (77, 226), (89, 214))
    cracks(d, [(main, 1.0, True), (((50, 226), (58, 234)), 1.0, True), (((68, 226), (76, 218)), 1.0, True),
               (((44, 238), (56, 244)), 1.0, False), (((14, 236), (26, 230)), 1.0, False)])
    for cx in (29, 89):
        pipe_v(d, cx - 1, 166, 216)
        DT.shaded(d, (cx - 5, 158, cx + 6, 163), E.CARD, E.LABEL, E.OUTLINE)
        DT.led(d, cx - 1, 154, ta, E.INK if cx == 29 else E.PURPLE, E.DEEP, 0.5, 0.0 if cx == 29 else 0.25)
    ph = round(ta * 12) * FLOW_STEP
    flow(d, ta, ((29, 168), (29, 214), (41, 226), (59, 226)), E.INK, 0.999, phase=ph)
    flow(d, ta, ((59, 226), (77, 226), (89, 214), (89, 170)), E.PURPLE, phase=ph - 74)


# ---------------- deep: 땅속 기둥 ----------------
DEEP_BOX = (90, 60, 90, 60)
DEEP_STAGE = (18, 60, 162, 240)
DEEP_DENS = (1, 2, 4, 8, 12)


def deep_outer(img, d, t, ta):
    """지표 풍경: 하늘 + 지표선 y 60(2px) + 지표 위 PLANT(표시등 꺼짐)."""
    d.line((4, 60, 175, 60), fill=E.INK)
    d.line((4, 61, 175, 61), fill=E.INK)
    plant(img, d, (120, 44, 150, 59), t, False)


def deep_inner(img, d, t, ta, stage, t_on):
    """층 5줄(각 36px): 위에서 아래로 t_on[k]부터 켜지고 아래로 갈수록 PURPLE 디더가 짙다. 라벨 DEEPER·HOTTER는 줄이 켜지면 뜬다."""
    x0, y0, x1, y1 = stage
    for k in range(5):
        if t < t_on[k]:
            continue
        ya, yb = y0 + 36 * k, y0 + 36 * (k + 1)
        img.paste(rock_img((x0, ya, x1, yb), ((ya, DEEP_DENS[k]), (yb, DEEP_DENS[k]))), (x0, ya))
    if t >= t_on[0]:
        tag(img, d, 158 - E.text_w("DEEPER", "label"), 66, "DEEPER")
    if t >= t_on[4]:
        tag(img, d, 158 - E.text_w("HOTTER", "label"), 226, "HOTTER")


# ---------------- 아이콘 칸 카드(three·finale) ----------------
CELL_X = (16, 68, 120)
CELL_W = 48


def card(img, d, y0, h, name, border):
    d.rectangle((8, y0, 171, y0 + h - 1), fill=E.CARD, outline=border)
    E.text(img, (16, y0 + 5), name, "bold")


def volcano(d, x, y):
    """작은 화산 아이콘(14x8): 45° 경사, 분화구 홈, 밝은 왼쪽·그림자 오른쪽 (용암·불꽃 없음)."""
    for i in range(8):
        a, b = x + 6 - i, x + 7 + i
        d.line((a, y + i, b, y + i), fill=E.LABEL)
        d.point((a, y + i), fill=E.TEXT)
        d.point((b, y + i), fill=E.OUTLINE)
    d.rectangle((x + 5, y, x + 8, y + 1), fill=E.CARD)


def icon_heat(img, d, cx, y, ih, ta):
    """HEAT: PURPLE 디더 바위(명암 면) + 위로 오르는 열 점들."""
    rh = ih // 2
    box = (cx - 18, y + ih - rh, cx + 17, y + ih - 1)
    DT.shaded(d, box, E.CARD, E.LABEL, E.OUTLINE)
    for yy in range(box[1] + 2, box[3] - 1):
        for xx in range(box[0] + 2, box[2] - 2):
            if BAYER[yy % 4][xx % 4] < 12:
                d.point((xx, yy), fill=E.PURPLE)
    k, span_h = round(ta * 12), ih - rh - 3
    for c in (cx - 10, cx, cx + 10):
        for j in range(span_h // 6 + 1):
            yy = y + ih - rh - 4 - ((j * 6 + k + c) % span_h)
            d.rectangle((c + (1 if yy % 8 < 4 else 0), yy, c + (1 if yy % 8 < 4 else 0) + 1, yy + 1), fill=E.PURPLE)


def icon_water(img, d, cx, y, ih, ta):
    """WATER: INK 물방울(오른쪽 그림자 DEEP, 왼쪽 반사 줄) + 아래 물결 고리가 퍼진다."""
    r = round(ih * 0.25)
    bob = (0, 1, 2, 1)[(round(ta * 12) // 3) % 4]
    cy = y + ih - r - 6 + bob - 2
    ty = cy - 2 * r
    for yy in range(ty, cy):
        half = (yy - ty) // 2
        d.line((cx - half, yy, cx + half, yy), fill=E.INK)
        d.line((cx + half - 1, yy, cx + half, yy), fill=E.DEEP)
    D.circle(d, cx, cy, r, fill=E.INK)
    D.circle(d, cx, cy, r, outline=E.DEEP, width=2, arc=(4.4, 6.5))
    DT.glint(d, cx - r // 2 - 1, cy + r // 2, 4, E.TEXT)
    rx = 6 + (round(ta * 12) // 2 % 3) * 4
    D.ellipse(d, cx, y + ih - 3, rx, 2, outline=E.LABEL)


def icon_paths(img, d, cx, y, ih, ta):
    """PATHS: 명암 바위 + TEXT 갈라진 틈(굵은 줄기와 가지 둘)."""
    bh = ih - ih * 3 // 10
    box = (cx - 20, y + ih - bh, cx + 19, y + ih - 1)
    DT.shaded(d, box, E.CARD, E.LABEL, E.OUTLINE)
    m, by, bx = max(6, ih // 6), y + ih - bh + 1, cx - 10
    main = ((bx, by), (bx + m, by + m), (bx + m, by + 2 * m), (bx + 2 * m, by + 3 * m), (bx + 2 * m, y + ih - 2))
    cracks(d, [(main, 1.0, True), (((bx + m, by + m), (bx + 3 * m, by + m + m // 2)), 1.0, True),
               (((bx + m, by + 2 * m), (bx - m, by + 2 * m + m // 2)), 1.0, True)])


def cell(img, d, ta, x, y, ih, name, icon, on):
    """아이콘 칸(48 x ih+20): 켜지면 BG 바탕 + INK 테두리 + 아이콘, 아니면 LABEL 점선 빈 칸. 이름은 칸 맨 아래."""
    ch = ih + 20
    if on:
        d.rectangle((x, y, x + CELL_W - 1, y + ch - 1), fill=E.BG, outline=E.INK)
        icon(img, d, x + CELL_W // 2, y + 2, ih, ta)
    else:
        dotted_rect(d, (x, y, x + CELL_W - 1, y + ch - 1), E.LABEL)
    label(img, x + (CELL_W - E.text_w(name, "label")) // 2, y + ih + 8, name, E.TEXT if on else E.LABEL)
