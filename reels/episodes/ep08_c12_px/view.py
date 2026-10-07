"""프레임 PNG의 장면 좌표 일부를 잘라 크게 보기. 실행: python view.py <png 이름(확장자 제외)> x0 y0 x1 y1 [배율]
결과: media/frames/ep08_px/_crop.png (검토용 임시 파일)"""
import sys
from pathlib import Path

from PIL import Image

OUT = Path(__file__).parents[2] / "media" / "frames" / "ep08_px"
name, x0, y0, x1, y1 = sys.argv[1], *map(int, sys.argv[2:6])
k = int(sys.argv[6]) if len(sys.argv) > 6 else 2
im = Image.open(OUT / f"{name}.png")
im.crop(((12 + x0) * 5, (40 + y0) * 5, (12 + x1) * 5, (40 + y1) * 5)).resize(((x1 - x0) * 5 * k // 5 * 1, (y1 - y0) * 5 * k // 5 * 1), Image.NEAREST).save(OUT / "_crop.png")
