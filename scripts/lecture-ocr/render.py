"""표본 획을 PIL로 그려 PNG와 labels.json 을 만든다."""
import argparse
import json
import math
import random

from PIL import Image, ImageDraw

from common import OCR_HOME, TEST_ROWS

S = 1000  # 좌표 1 = 1000px


def transform(strokes, rng):
    """증강: 기울임·가로 배율·회전·점 흔들림. 굵기·여백은 호출부가 정한다."""
    shear, sx, rot = rng.uniform(-.25, .25), rng.uniform(.85, 1.15), rng.uniform(-.05, .05)
    jit = rng.uniform(0, .0015)
    c, s = math.cos(rot), math.sin(rot)
    out = []
    for st in strokes:
        pts = []
        for x, y, *_ in st["points"]:
            x, y = (x + shear * y) * sx, y
            x, y = x * c - y * s, x * s + y * c
            pts.append([x + rng.uniform(-jit, jit), y + rng.uniform(-jit, jit)])
        out.append({"width": st["width"], "points": pts})
    return out


def draw(strokes, line_scale=1.0, margin=0.02):
    pts = [p for st in strokes for p in st["points"]]
    x0, x1 = min(p[0] for p in pts) - margin, max(p[0] for p in pts) + margin
    y0, y1 = min(p[1] for p in pts) - margin, max(p[1] for p in pts) + margin
    img = Image.new("RGB", (max(int((x1 - x0) * S), 1), max(int((y1 - y0) * S), 1)), "white")
    d = ImageDraw.Draw(img)
    for st in strokes:
        w = max(st["width"] * S * line_scale, 1)
        xy = [((p[0] - x0) * S, (p[1] - y0) * S) for p in st["points"]]
        r = w / 2
        if len(xy) > 1:
            d.line(xy, fill="black", width=round(w), joint="curve")
        for x, y in xy:
            d.ellipse([x - r, y - r, x + r, y + r], fill="black")
    return img


ap = argparse.ArgumentParser()
ap.add_argument("--split", choices=["test", "train"], required=True)
ap.add_argument("--augment", type=int, default=0, help="train: 줄마다 변형 N장(0번은 원본)")
ap.add_argument("--line-scale", type=float, default=1.0)
ap.add_argument("--seed", type=int, default=0)
ap.add_argument("--out", required=True)
a = ap.parse_args()

rows = json.loads((OCR_HOME / "samples.json").read_text(encoding="utf-8"))
rows = rows[:TEST_ROWS] if a.split == "test" else rows[TEST_ROWS:]
rng = random.Random(a.seed)
from pathlib import Path
out = Path(a.out).expanduser()
out.mkdir(parents=True, exist_ok=True)
labels = []
for r in rows:
    strokes = [s for s in r["strokes"] if s.get("points")]
    if not strokes:
        continue
    n = max(a.augment, 1) if a.split == "train" else 1
    for k in range(n):
        if k == 0:
            img = draw(strokes, a.line_scale)
        else:
            st = [{**s, "width": s["width"] * rng.uniform(.6, 1.8)} for s in strokes]
            img = draw(transform(st, rng), a.line_scale, rng.uniform(.01, .04))
        name = f"{r['id']}_{k}.png"
        img.save(out / name)
        labels.append({"file": name, "id": r["id"], "promptId": r["promptId"], "label": r["label"]})
(out / "labels.json").write_text(json.dumps(labels, ensure_ascii=False, indent=1), encoding="utf-8")
print(f"{a.split}: 줄 {len(rows)} / 이미지 {len(labels)} -> {out}")
