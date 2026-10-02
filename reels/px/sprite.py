"""시온 도트 스프라이트: 둥근 몸통 + 네 갈래(위쪽 긴 꼬리), 1px 외곽선, 명암 한 단계, 표정 4종."""
from pathlib import Path
from PIL import Image, ImageDraw

D = Path(__file__).parent
BG, INK, SHADE, LIGHT, OUT, WHITE = "#120F1E", "#8FE3B4", "#4FA77C", "#C9F5DA", "#05080A", "#F4F1E8"
W, H = 39, 51
SCALE = 0.54                      # xion-mark.svg 단위 → 도트
CX, CY = 19, 34                   # 별 중심(svg의 0,0)


def _bez(p0, p1, p2, p3, n=24):
    return [tuple((1 - t) ** 3 * a + 3 * (1 - t) ** 2 * t * b + 3 * (1 - t) * t * t * c + t ** 3 * d
                  for a, b, c, d in zip(p0, p1, p2, p3)) for t in (i / n for i in range(n))]


def body_mask():
    """public/lib/icons/Xion/xion-mark.svg의 경로 그대로(오목한 네 갈래)."""
    segs = [((0, -62), (3, -11), (11, -3), (36, 0)), ((36, 0), (11, 3), (3, 11), (0, 30)),
            ((0, 30), (-3, 11), (-11, 3), (-36, 0)), ((-36, 0), (-11, -3), (-3, -11), (0, -62))]
    pts = [pt for seg in segs for pt in _bez(*seg)]
    m = Image.new("1", (W, H), 0)
    ImageDraw.Draw(m).polygon([(CX + x * SCALE, CY + y * SCALE) for x, y in pts], fill=1)
    return m


def sprite(mood):
    m = body_mask()
    img = Image.new("RGBA", (W + 2, H + 2), (0, 0, 0, 0))
    px = m.load()
    out = img.load()

    def put(x, y, c):
        img.paste(c, (x + 1, y + 1, x + 2, y + 2))

    for y in range(H):
        for x in range(W):
            if px[x, y]:
                # 명암: 오른쪽 아래는 그늘, 왼쪽 위 가장자리는 하이라이트
                edge_lt = (x == 0 or not px[x - 1, y]) or (y == 0 or not px[x, y - 1])
                shade = (x - CX) + (y - CY) > 9
                put(x, y, LIGHT if edge_lt and (x - CX) + (y - CY) < 0 else SHADE if shade else INK)
    for y in range(-1, H + 1):                                                    # 외곽선
        for x in range(-1, W + 1):
            inside = 0 <= x < W and 0 <= y < H and px[x, y]
            if not inside and any(0 <= x + dx < W and 0 <= y + dy < H and px[x + dx, y + dy]
                                  for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))):
                img.paste(OUT, (x + 1, y + 1, x + 2, y + 2))

    def rect(x0, y0, x1, y1, c):
        img.paste(c, (x0 + 1, y0 + 1, x1 + 2, y1 + 2))

    FACE_Y = CY - 2                      # 얼굴 기준 줄(가로 갈래보다 2px 위)
    ey, lx, rx = FACE_Y - 2, CX - 5, CX + 3
    if mood == "sparkle":                    # ^ ^ 눈
        for ex in (lx, rx):
            rect(ex, ey + 1, ex, ey + 1, OUT); rect(ex + 1, ey, ex + 1, ey, OUT); rect(ex + 2, ey + 1, ex + 2, ey + 1, OUT)
        rect(CX - 2, FACE_Y + 3, CX + 1, FACE_Y + 3, OUT); rect(CX - 1, FACE_Y + 4, CX, FACE_Y + 4, OUT)
    else:
        tall = mood == "surprised"
        for ex in (lx, rx):
            rect(ex, ey - (1 if tall else 0), ex + 2, ey + 2, OUT)
            hx = ex + (2 if mood == "pointing" else 0)
            rect(hx, ey - (1 if tall else 0), hx, ey - (1 if tall else 0), WHITE)
        if tall:
            rect(CX - 1, FACE_Y + 4, CX, FACE_Y + 5, OUT)
        else:
            rect(CX - 2, FACE_Y + 4, CX - 2, FACE_Y + 4, OUT); rect(CX - 1, FACE_Y + 5, CX, FACE_Y + 5, OUT); rect(CX + 1, FACE_Y + 4, CX + 1, FACE_Y + 4, OUT)
    return img


def sparkles(canvas, x, y):
    d = ImageDraw.Draw(canvas)
    for sx, sy in ((x - 6, y + 6), (x + W + 4, y + 2), (x + W + 2, y + 24)):
        d.point([(sx, sy - 1), (sx - 1, sy), (sx, sy), (sx + 1, sy), (sx, sy + 1)], fill=WHITE)


if __name__ == "__main__":
    moods = ["base", "surprised", "pointing", "sparkle"]
    sheet = Image.new("RGB", (4 * 48, 64), BG)
    for i, mood in enumerate(moods):
        s = sprite(mood)
        sheet.paste(s, (i * 48 + 6, 8), s)
        if mood == "sparkle":
            sparkles(sheet, i * 48 + 7, 9)
    sheet.resize((sheet.width * 6, sheet.height * 6), Image.NEAREST).save(D / "sprite_sheet.png")
    print("ok")
