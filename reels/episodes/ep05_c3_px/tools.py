"""5편 확인 도구. 실행: reels/.venv/bin/python episodes/ep05_c3_px/tools.py cards | frames <장면>_<순간>=<장면>:<시각> ...
cards: 장면별 길이·카드 표. frames: 장면 시각의 프레임을 media/frames/ep05_px/<이름>.png로 쓴다(시각 'end'는 카드가 다 찍힌 마지막 순간)."""
import sys
from pathlib import Path

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE.parents[1]))
sys.path.insert(0, str(HERE))
from PIL import Image  # noqa: E402
from px import engine as E  # noqa: E402
import scene  # noqa: E402

ep = scene.ep
OUT = HERE.parents[1] / "media" / "frames" / "ep05_px"


def cards():
    for T in ep.scenes:
        print(f"[{T.id}] length {T.length:.2f} (min {ep.mins[T.id]})")
        for c, s, du in T.plan:
            print(f"   {s:6.2f} {du:4.2f}  {' | '.join(c)}")


def frames(specs):
    OUT.mkdir(parents=True, exist_ok=True)
    for spec in specs:
        name, where = spec.split("=")
        sid, tv = where.split(":")
        T = next(s for s in ep.scenes if s.id == sid)
        off = ep.starts[ep.scenes.index(T)]
        t = {"mid": T.length / 2, "end": T.length - 0.05}.get(tv) or float(tv)
        Image.fromarray(E.to_output(ep.frame(round((off + t) * E.FPS_OUT)))).save(OUT / f"{name}.png")


if __name__ == "__main__":
    cards() if sys.argv[1] == "cards" else frames(sys.argv[2:])
