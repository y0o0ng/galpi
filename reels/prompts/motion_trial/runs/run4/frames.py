"""검토용 프레임 뽑기: media/frames/ep13_px/<장면>_<순간>.png (영상과 같은 장면 함수·출력 배치).
실행: reels/.venv/bin/python episodes/ep13_c27m_px/frames.py [장면 id ...]"""
import sys
from pathlib import Path

HERE = Path(__file__).parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(HERE))
from PIL import Image  # noqa: E402
from px import engine as E  # noqa: E402
from px.timeline import at  # noqa: E402
import art as A  # noqa: E402
import scene as S  # noqa: E402

OUT = ROOT / "media" / "frames" / "ep13_px"
OUT.mkdir(parents=True, exist_ok=True)
ep = S.ep


def typed(T, i):
    """i번째 문장의 마지막 카드가 다 찍힌 시각."""
    card, start, dur = [p for p in T.plan if p[0] in E.split_cards(T.sents[i])][-1]
    return E.char_times(card, start, dur)[-1] + 0.08


def moments(T):
    k, c = T.id, lambda i, j=0: S.cardt(T, i, j)
    m = {"first": 0.0, "mid": T.length / 2, "end": T.length - 1 / 24, "last": T.length - 1 / 24}
    m.update({f"s{i + 1}_done": typed(T, i) for i in range(len(T.sents))})
    extra = {
        "hook": lambda: {"art_in": 1.2, "mascot": 2.9, "wrinkle_mid": 4.5, "drops": 5.1},
        "clue": lambda: {"pulses": 2.0, "wrinkle_mid": 5.5, "q_mark": c(1) + 0.9, "labels": at(T, 0) + 0.8},
        "inside": lambda: {"signal": at(T, 1) + 0.9, "arrive": at(T, 1) + 0.2 + A.ARRIVE + 0.3,
                           "narrow_mid": at(T, 1) + 0.2 + A.ARRIVE + 1.5, "narrow_done": at(T, 1) + 0.2 + A.ARRIVE + 3.2,
                           "pulp_mid": c(2, 1) + 1.5},
        "fold": lambda: {"blink": 0.5, "zoom": 1.0, "fold_mid": 2.6, "fold_done": 5.2, "skin": c(0, 1) + 0.3, "fold_label": c(0, 2) + 0.3},
        "proof": lambda: {"water_mid": 2.5, "cream": at(T, 1) + 0.6, "emla_mid": at(T, 1) + 3.5, "flow": c(2) + 0.9,
                          "numbers": c(2) + 2.0, "n25": c(2, 1) + 0.4},
        "finale": lambda: {"test": at(T, 0) + 0.6, "mascot": at(T, 1) + 0.3},
    }
    m.update(extra[k]())
    return m


want = set(sys.argv[1:])
for T, off in zip(ep.scenes, ep.starts):
    if T is ep.ending:
        if want and "ending" not in want:
            continue
        for name, t in (("ending_2.4", 2.4), ("ending_4.1", 4.1)):
            Image.fromarray(E.to_output(ep.frame(round((off + t) * E.FPS_OUT)))).save(OUT / f"{name}.png")
            print(f"{name}.png")
        continue
    if want and T.id not in want:
        continue
    for name, t in moments(T).items():
        i = round((off + min(t, T.length - 1 / 24)) * E.FPS_OUT)
        Image.fromarray(E.to_output(ep.frame(i))).save(OUT / f"{T.id}_{name}.png")
        print(f"{T.id}_{name}.png  scene t={t:.2f}  global {i / E.FPS_OUT:.2f}")
