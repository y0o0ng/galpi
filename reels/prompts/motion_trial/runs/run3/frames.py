"""검토용 프레임 뽑기: media/frames/ep13_px/<장면>_<순간>.png (영상과 같은 장면 함수·출력 배치, 인코딩 전 프레임).
실행: reels/.venv/bin/python episodes/ep13_c27m_px/frames.py [장면 id ...]"""
import sys
from pathlib import Path

HERE = Path(__file__).parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(HERE))
from PIL import Image  # noqa: E402
from px import engine as E  # noqa: E402
from px.templates import cardt  # noqa: E402
from px.timeline import at  # noqa: E402
import scene as S  # noqa: E402

OUT = ROOT / "media" / "frames" / "ep13_px"
OUT.mkdir(parents=True, exist_ok=True)
ep = S.ep
ep._sfx_plan()                       # 소리 계획을 먼저 만든다(처음 부르는 순간 장면을 훑으며 마스코트 위치를 지운다)
SENT = {"hook": (1, 2), "clue": (3, 4, 5), "inside": (6, 7, 8), "pillow": (9,), "proof": (10, 11), "finale": (12, 13)}


def typed(T, i):
    """i번째 문장의 마지막 카드가 다 찍힌 시각."""
    card, start, dur = [p for p in T.plan if p[0] in E.split_cards(T.sents[i])][-1]
    return E.char_times(card, start, dur)[-1] + 0.08


def moments(T):
    c = lambda i, j=0: cardt(T, i, j)  # noqa: E731
    m = {"first": 0.0, "mid": T.length / 2, "end": T.length - 0.3, "last": T.length - 1 / 24}
    m.update({f"s{n}_done": typed(T, i) for i, n in enumerate(SENT[T.id])})
    extra = {
        "hook": lambda: {"under": 1.6, "lift_mid": c(0, 1) + 0.25, "drop": c(0, 1) + 0.85, "mascot": 2.9},
        "clue": lambda: {"dip_mid": c(0, 1) + 0.3, "wrinkle_mid": c(0, 2) + 0.2, "question": at(T, 1) + 0.6,
                         "signal_mid": at(T, 2) + 0.9},
        "inside": lambda: {"signal_top": at(T, 0) + 0.8, "signal_mid": at(T, 0) + 1.6, "vessel_mid": at(T, 0) + 2.4,
                           "vessel_done": at(T, 1) + 0.2, "shrink_mid": at(T, 1) + 1.8, "shrunk": at(T, 2) + 0.4,
                           "arrows": c(2, 1) + 0.1, "fold_mid": c(2, 1) + 1.2, "folded": c(2, 2) + 0.8},
        "pillow": lambda: {"deflate_mid": T.length * 0.55},
        "proof": lambda: {"dip_mid": at(T, 0) + 0.5, "cream_mid": at(T, 0) + 1.4, "cream_done": c(0, 1) + 1.1,
                          "wrinkle_mid": c(0, 2) + 0.9, "arrow_mid": at(T, 1) + 0.4, "numbers": at(T, 1) + 0.8},
        "finale": lambda: {"signal_mid": at(T, 0) + 1.2, "narrow": at(T, 0) + 2.2, "wrinkle_mid": at(T, 0) + 3.6,
                           "mascot": at(T, 1) + 0.6},
    }
    m.update(extra[T.id]())
    return m


want = set(sys.argv[1:])
for T, off in zip(ep.scenes, ep.starts):
    if T is ep.ending:
        if not want or "ending" in want:
            for name, t in (("stamp", 2.4), ("final", 4.1)):
                Image.fromarray(E.to_output(ep.frame(round((off + t) * E.FPS_OUT)))).save(OUT / f"ending_{name}.png")
        continue
    if want and T.id not in want:
        continue
    for name, t in moments(T).items():
        i = -(-round((off + t) * E.FPS_OUT * 1000) // 1000)        # 그 시각 이후 첫 출력 프레임
        if name == "last":
            i = -(-round((off + T.length) * E.FPS_OUT * 1000) // 1000) - 1
        Image.fromarray(E.to_output(ep.frame(i))).save(OUT / f"{T.id}_{name}.png")
        print(f"{T.id}_{name}.png  scene t={t:.2f}  global {i / E.FPS_OUT:.2f}")
