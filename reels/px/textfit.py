"""확정 대본(final.md) 장면 표의 화면 문구가 형식 2 화면에 들어가는지 렌더와 같은 E.say로 잰다.

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


def misfits(items):
    E.use_format(2)
    E.start_texts(None)
    img = Image.new("RGB", (E.W, E.H))
    bad = []
    for kind, s in items:
        try:
            E.say(img, s, kind, xy=(E.W // 2, E.STMT_Y) if kind == "label" else None)
        except ValueError as e:
            bad.append((kind, s, str(e).replace(repr(s), "").strip(" :")))
    return bad


def main(path):
    items = screen_texts(Path(path).read_text(encoding="utf-8"))
    if not items:
        print("장면 표에서 화면 문구(진술·라벨·수치)를 하나도 못 읽었다")
        return 2
    bad = misfits(items)
    for kind, s, why in bad:
        print(f"넘침 {kind}: {s} ({why})")
    print(f"{len(items)} texts, {len(bad)} misfit")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1]))
