"""픽셀 에디토리얼 시연용 그림. 실제 뉴스·제품·측정값이 아니다."""
from pathlib import Path
import sys
from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from px.detail import shaded

ROOT = Path(__file__).parent
GREEN, MINT, INK, PURPLE, WHITE = "#2F6B57", "#8FE3B4", "#120F1E", "#9D7CFF", "#F4F1E8"
LIGHT, DARK, LABEL = "#C9F5DA", "#221C38", "#B9B3D6"


def star(d, x, y, size, color):
    d.polygon([(x, y-size), (x+2, y-2), (x+size, y), (x+2, y+2),
               (x, y+size), (x-2, y+2), (x-size, y), (x-2, y-2)], fill=color)


def cube(d, x, y, radius, height, color):
    top = [(x, y), (x+radius, y+radius//2), (x, y+radius), (x-radius, y+radius//2)]
    left = [top[3], top[2], (x, y+radius+height), (x-radius, y+radius//2+height)]
    right = [top[2], top[1], (x+radius, y+radius//2+height), (x, y+radius+height)]
    d.polygon([(x, y+radius+height+7), (x+radius+8, y+radius//2+height+5),
               (x, y+radius//2+height-3), (x-radius-8, y+radius//2+height+5)], fill=LABEL)
    d.polygon(left, fill=color, outline=INK, width=2)
    d.polygon(right, fill=GREEN if color == MINT else DARK, outline=INK, width=2)
    d.polygon(top, fill=LIGHT if color == MINT else PURPLE, outline=INK, width=2)
    d.line((x-radius+3, y+radius//2, x, y+radius-3, x+radius-3, y+radius//2), fill=WHITE)
    # 옆면에만 디더를 넣어 윤곽과 앞면의 가독성을 유지한다.
    mask = Image.new("1", (x+radius+2, y+radius+height+1))
    ImageDraw.Draw(mask).polygon(right, fill=1)
    for yy in range(y+radius//2, y+radius+height):
        for xx in range(x+2, x+radius-1):
            if mask.getpixel((xx, yy)) and (xx+yy) % 4 == 0:
                d.point((xx, yy), fill=MINT if color == MINT else PURPLE)
    for offset in (height//3, 2*height//3):
        d.line((x+4, y+radius+offset, x+radius-4, y+radius//2+offset), fill=LABEL)
        d.rectangle((x+7, y+radius+offset-6, x+8, y+radius+offset-5), fill=WHITE)
    star(d, x, y+radius//2, max(5, radius//3), GREEN if color == MINT else WHITE)


def device(color):
    image = Image.new("RGBA", (180, 174))
    d = ImageDraw.Draw(image)
    # 바닥 격자 위에 세 겹의 판을 쌓아 단말의 깊이를 만든다.
    for i in range(8):
        d.line((12+i*12, 119+i*3, 65+i*12, 96+i*3), fill=LABEL)
        d.line((12+i*9, 119-i*4, 119+i*9, 148-i*4), fill=LABEL)
    for x, y, edge in ((67, 18, PURPLE), (52, 31, LABEL), (32, 49, color)):
        d.polygon(((x, y), (x+84, y+26), (x+84, y+98), (x, y+72)), fill=edge, outline=INK, width=2)
        d.polygon(((x+84, y+26), (x+90, y+23), (x+90, y+95), (x+84, y+98)), fill=DARK, outline=INK)
        d.line((x+3, y+4, x+81, y+28), fill=WHITE, width=2)
        for yy in range(y+30, y+66, 4):
            d.point((x+87, yy+25), fill=edge)
        if x == 32:
            d.polygon(((x+8, y+15), (x+75, y+35), (x+75, y+83), (x+8, y+63)), fill=DARK, outline=INK)
            for n in range(6):
                d.line((x+14+n*8, y+22+n*2, x+14+n*8, y+64+n*2), fill=GREEN)
            star(d, x+43, y+51, 17, MINT)
            star(d, x+43, y+51, 7, LIGHT)
        else:
            d.line((x+12, y+20, x+24, y+24), fill=WHITE, width=2)
            d.line((x+12, y+31, x+58, y+45), fill=INK, width=4)
            d.line((x+12, y+41, x+49, y+52), fill=INK, width=3)
            d.rectangle((x+68, y+54, x+74, y+60), fill=WHITE)
    for x, y, size, c in ((28, 29, 6, GREEN), (158, 16, 9, GREEN), (158, 118, 7, PURPLE), (26, 151, 6, PURPLE)):
        star(d, x, y, size, c)
    return image


def workflow():
    image = Image.new("RGBA", (225, 110))
    d = ImageDraw.Draw(image)
    for i, color in enumerate((PURPLE, MINT, PURPLE)):
        cube(d, 32+i*80, 16, 24, 36, color)
    # 큐브와 같은 4px 출력 도트를 가진 계단형 화살표.
    for x in (67, 147):
        d.rectangle((x-6, 54, x+7, 55), fill=INK)
        for offset in range(5):
            d.rectangle((x+3+offset, 50+offset, x+4+offset, 51+offset), fill=INK)
            d.rectangle((x+3+offset, 58-offset, x+4+offset, 59-offset), fill=INK)
    return image


def icon(kind):
    image = Image.new("RGBA", (40, 36))
    d = ImageDraw.Draw(image)
    if kind == "document":
        d.rectangle((11, 6, 31, 30), fill=INK)
        shaded(d, (8, 4, 28, 28), PURPLE, WHITE, DARK)
        for y in (10, 16, 22):
            d.rectangle((13, y, 23, y+1), fill=INK)
    elif kind == "terminal":
        d.rectangle((5, 8, 35, 28), fill=INK)
        shaded(d, (4, 5, 32, 25), DARK, LABEL, INK)
        d.rectangle((5, 6, 31, 10), fill=PURPLE)
        for x, y in ((10, 14), (12, 16), (10, 18)):
            d.rectangle((x, y, x+1, y+1), fill=MINT)
        d.rectangle((17, 20, 23, 21), fill=WHITE)
        d.rectangle((10, 7, 11, 8), fill=WHITE)
    else:
        d.polygon(((20, 3), (33, 8), (30, 21), (20, 32), (10, 21), (7, 8)), fill=INK)
        d.polygon(((20, 6), (29, 10), (27, 20), (20, 27), (13, 20), (11, 10)), fill=MINT)
        d.line((14, 16, 18, 20, 25, 12), fill=GREEN, width=2)
    return image


if __name__ == "__main__":
    device(MINT).save(ROOT / "device-mint.png")
    device(PURPLE).save(ROOT / "device-purple.png")
    workflow().save(ROOT / "workflow.png")
    for name, color in (("mint", MINT), ("purple", PURPLE)):
        image = Image.new("RGBA", (60, 76))
        cube(ImageDraw.Draw(image), 30, 6, 24, 36, color)
        image.save(ROOT / f"cube-{name}.png")
    pair = Image.new("RGBA", (260, 130))
    d = ImageDraw.Draw(pair)
    cube(d, 59, 6, 43, 62, MINT)
    cube(d, 201, 6, 43, 62, PURPLE)
    d.line((124, 55, 124, 82), fill=INK, width=2)
    d.line((135, 55, 135, 82), fill=INK, width=2)
    pair.save(ROOT / "pair.png")
    for name in ("document", "terminal", "shield"):
        icon(name).save(ROOT / f"icon-{name}.png")
