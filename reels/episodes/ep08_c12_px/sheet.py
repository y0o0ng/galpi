"""검토용 접촉 인화지: media/frames/ep08_px/<장면>_*.png를 장면 캔버스만 잘라 3열로 이어 붙인다(_sheet_<장면>_<n>.png, 한 장 6컷).
실행: python sheet.py <장면 id>"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path(__file__).parents[2] / "media" / "frames" / "ep08_px"
sid = sys.argv[1]
files = sorted(p for p in OUT.glob(f"{sid}_*.png") if not p.name.startswith("_"))
cw, ch = 180 * 5 // 2, 300 * 5 // 2                       # 장면 캔버스 위 300줄을 0.5배로
for n in range(0, len(files), 6):
    sheet = Image.new("RGB", (cw * 3, (ch + 14) * 2), "#000000")
    d = ImageDraw.Draw(sheet)
    for k, p in enumerate(files[n:n + 6]):
        im = Image.open(p).crop((60, 200, 960, 1700)).resize((cw, ch), Image.NEAREST)
        x, y = k % 3 * cw, k // 3 * (ch + 14)
        sheet.paste(im, (x, y + 14))
        d.text((x + 2, y + 1), p.stem, fill="#ffffff")
    sheet.save(OUT / f"_sheet_{sid}_{n // 6}.png")
    print(f"_sheet_{sid}_{n // 6}.png", [p.stem for p in files[n:n + 6]])
