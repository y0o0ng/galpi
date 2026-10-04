"""한글 손글씨 폰트(OFL)로 합성 줄 이미지를 만든다. 시험지 오염 필터 포함."""
import argparse
import json
import random
import re
from pathlib import Path

from fontTools.ttLib import TTFont
from PIL import Image, ImageDraw, ImageFilter, ImageFont

from common import LEAK_PHRASES, OCR_HOME, REPO, TEST_ROWS, norm

ap = argparse.ArgumentParser()
ap.add_argument("--count", type=int, required=True)
ap.add_argument("--seed", type=int, default=0)
ap.add_argument("--out", default=str(OCR_HOME / "synth"))
a = ap.parse_args()
rng = random.Random(a.seed)

# --- 폰트 ---
fonts = {}  # 이름 -> (경로, cmap)
for p in sorted((OCR_HOME / "fonts").glob("*/*.ttf")):
    fonts[p.stem] = (str(p), set(TTFont(p, lazy=True).getBestCmap()))
print(f"폰트 {len(fonts)}개")

# --- 시험지 오염 필터 ---
test_labels = [norm(r["label"]) for r in json.loads((OCR_HOME / "samples.json").read_text(encoding="utf-8"))[:TEST_ROWS]]
K = 8
test_grams = {t[i:i + K] for t in test_labels for i in range(len(t) - K + 1)}
leaks = [norm(p) for p in LEAK_PHRASES]
dropped = 0


def contaminated(s):
    n = norm(s)
    return (any(t in n for t in test_labels) or any(l in n for l in leaks)
            or any(n[i:i + K] in test_grams for i in range(len(n) - K + 1)))


# --- 출처 A: 문서 한국어 조각 ---
pool_a = []
for f in (REPO / "docs").rglob("*.md"):
    in_code = False
    for line in f.read_text(encoding="utf-8", errors="ignore").splitlines():
        if line.lstrip().startswith("```"):
            in_code = not in_code
            continue
        if in_code:
            continue
        line = re.sub(r"`[^`]*`|https?://\S+|\[([^\]]*)\]\([^)]*\)", " ", line)
        line = re.sub(r"[*#>|_~\-=]+|[A-Za-z]{6,}", " ", line)
        for m in re.finditer(r"[가-힣][가-힣0-9 ,.?()%]*", line):
            seg = m.group().strip()
            if len(seg) >= 5:
                pool_a.append(seg)


def src_a():
    seg = rng.choice(pool_a)
    n = rng.randint(5, 22)
    if len(seg) <= n:
        return seg
    i = rng.randint(0, len(seg) - n)
    return seg[i:i + n].strip()


# --- 출처 B: 강의 낱말·수식 ---
js = (REPO / "public/lecture/lecture-handwriting.js").read_text(encoding="utf-8")
arr = {k: re.findall(r"'([^']*)'", re.search(r"const %s = \[(.*?)\];" % k, js, re.S).group(1))
       for k in ("TERMS", "SYMBOLS", "EQUATIONS", "MEMOS")}
T, S, E, M = arr["TERMS"], arr["SYMBOLS"], arr["EQUATIONS"], arr["MEMOS"]
pick = rng.choice
tmpl_b = [lambda: f"? {pick(T)} 언제 써?", lambda: f"? {pick(T)}, {pick(T)} 차이", lambda: f"? 여기서 {pick(S)} 뭐야?",
          lambda: f"? {pick(E)} 맞아?", lambda: f"? {pick(E)} 에서 {pick(S)} 의미", lambda: f"? {pick(T)} 방향 어떻게 정해?",
          lambda: f"ㄴ {pick(S)} 아니고 {pick(S)}", lambda: f"ㄴ 그럼 {pick(T)} 두 배면?", lambda: f"ㄴ {pick(E)} 다시 써줘",
          lambda: f"{pick(M)}. {pick(T)}", lambda: f"{pick(E)} {pick(M)}", lambda: f"{pick(T)} {pick(S)} {pick(M)}"]

# --- 출처 C: KS X 1001 음절 ---
ks = [bytes([hi, lo]).decode("euc-kr", "ignore") for hi in range(0xB0, 0xC9) for lo in range(0xA1, 0xFF)]
ks = [c for c in ks if len(c) == 1 and "가" <= c <= "힣"]


def src_c():
    return " ".join("".join(rng.choice(ks) for _ in range(rng.randint(2, 4))) for _ in range(rng.randint(2, 5)))


def sentence():
    r = rng.random()
    if r < .5:
        return "A", src_a()
    if r < .75:
        return "B", rng.choice(tmpl_b)()
    return "C", src_c()


def render(text, font_path):
    size = rng.randint(28, 52)
    font = ImageFont.truetype(font_path, size)
    sw = 1 if rng.random() < .3 else 0
    l, t, r, b = font.getbbox(text, stroke_width=sw)
    m = rng.randint(4, 16)
    img = Image.new("L", (r - l + 2 * m, b - t + 2 * m), 255)
    ImageDraw.Draw(img).text((m - l, m - t), text, font=font, fill=0, stroke_width=sw, stroke_fill=0)
    sh = rng.uniform(-.2, .2)
    img = img.transform(img.size, Image.AFFINE, (1, sh, -sh * img.height / 2, 0, 1, 0), Image.BICUBIC, fillcolor=255)
    img = img.rotate(rng.uniform(-2, 2), Image.BICUBIC, expand=True, fillcolor=255)
    if rng.random() < .3:
        img = img.filter(ImageFilter.GaussianBlur(rng.uniform(.2, .8)))
    return img.convert("RGB")


out = Path(a.out).expanduser()
out.mkdir(parents=True, exist_ok=True)
labels, counts, n = [], {"A": 0, "B": 0, "C": 0}, 0
while len(labels) < a.count:
    src, s = sentence()
    r = rng.random()
    s = ("? " + s) if r < .25 else ("ㄴ " + s) if r < .37 else s
    s = re.sub(r"\s+", " ", s).strip()
    if len(norm(s)) < 3:
        continue
    if contaminated(s):
        dropped += 1
        continue
    ok = [k for k, (_, cm) in fonts.items() if all(ord(c) in cm for c in s if not c.isspace())]
    if not ok:
        continue
    name = rng.choice(ok)
    n += 1
    file = f"s{n}.png"
    render(s, fonts[name][0]).save(out / file)
    labels.append({"file": file, "id": n, "promptId": f"s-{name}", "label": s})
    counts[src] += 1
(out / "labels.json").write_text(json.dumps(labels, ensure_ascii=False, indent=1), encoding="utf-8")
print(f"합성 {len(labels)}줄 출처 {counts} / 오염 필터로 버림 {dropped} -> {out}")
