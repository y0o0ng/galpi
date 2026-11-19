"""확정 대본(final.md) 장면 표의 화면 문구가 형식 2 화면에 들어가는지 렌더와 같은 E.say로 잰다.
훅 큰 글자(`hook_words`·`hook_sub`)는 templates._check_hook과 같은 폭·안전 영역으로 잰다.

검토 단계가 쓰고 서버가 검토 게이트로 다시 돌린다. 빌드는 문구를 못 고치므로 폭 문제는 여기서 끝나야 한다.
사용: python px/textfit.py final.md   (통과 0, 넘침 1, 표를 못 읽음 2)
"""
import re
import sys
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from px import engine as E  # noqa: E402

KINDS = {"진술": "statement", "라벨": "label", "수치": "number"}
ITEM = re.compile(r"(진술|라벨|수치)(?:\([^)]*\))?\s*:?\s*`([^`]+)`")
HOOK = re.compile(r"^\s*-\s*\**`?(hook_words|hook_sub)`?\**\s*:\s*\**(.*)$", re.M)


def screen_texts(md):
    """장면 표 행(| `id` |)의 화면 문구 칸에서 (종류, 문구)를 뽑는다."""
    out = []
    for line in md.splitlines():
        if not re.match(r"\|\s*`[^`]+`\s*\|", line):
            continue
        cells = line.split("|")
        if len(cells) > 3:
            out += [(KINDS[k], s) for k, s in ITEM.findall(cells[3])]
    return out


def hook_texts(md):
    """훅 절의 `- hook_words: `줄` / `줄`` · `- hook_sub: `부제`` 줄에서 (종류, 문구)를 뽑는다(종류마다 첫 줄만)."""
    out, seen = [], set()
    for key, rest in HOOK.findall(md):
        if key not in seen:
            seen.add(key)
            out += [("hook" if key == "hook_words" else "hook_sub", s) for s in re.findall(r"`([^`]+)`", rest)]
    return out


def misfits(items):
    E.use_format(2)
    E.start_texts(None)
    img = Image.new("RGB", (E.W, E.H))
    bad = []
    lo, hi = E.TEXT_SAFE[0], E.TEXT_SAFE[2]
    for kind, s in items:
        if kind in ("hook", "hook_sub"):  # templates._check_hook과 같은 측정(훅은 bold 2배, 부제는 label 1배)
            w = E.text_w(s, *(("bold", 2) if kind == "hook" else ("label", 1)))
            x = E.W // 2 - w // 2
            if x < lo or x + w - 1 > hi:
                bad.append((kind, s, f"훅 줄 {w}px > 안전 폭 {hi - lo + 1}px"))
            continue
        try:
            E.say(img, s, kind, xy=(E.W // 2, E.STMT_Y) if kind == "label" else None)
        except ValueError as e:
            bad.append((kind, s, str(e).replace(repr(s), "").strip(" :")))
    return bad


def main(path):
    md = Path(path).read_text(encoding="utf-8")
    items = screen_texts(md)
    if not items:
        print("장면 표에서 화면 문구(진술·라벨·수치)를 하나도 못 읽었다")
        return 2
    items += hook_texts(md)
    bad = misfits(items)
    for kind, s, why in bad:
        print(f"넘침 {kind}: {s} ({why})")
    print(f"{len(items)} texts, {len(bad)} misfit")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1]))
