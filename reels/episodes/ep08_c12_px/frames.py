"""검토용 프레임 뽑기: media/frames/ep08_px/<장면>_<순간>.png (영상과 같은 장면 함수·출력 배치, 인코딩 전 프레임).
실행: reels/.venv/bin/python episodes/ep08_c12_px/frames.py [장면 id ...]"""
import sys
from pathlib import Path

HERE = Path(__file__).parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(HERE))
from PIL import Image  # noqa: E402
from px import engine as E  # noqa: E402
from px.timeline import at  # noqa: E402
import scene as S  # noqa: E402

OUT = ROOT / "media" / "frames" / "ep08_px"
OUT.mkdir(parents=True, exist_ok=True)
ep = S.ep
SENT = {"hook": (1, 2), "deep": (3, 4), "three": (5, 6, 7), "make": (8, 9, 10), "loop": (11, 12, 13, 14), "cape": (15, 16),
        "limit": (17, 18, 19), "finale": (20, 21)}


def typed(T, i):
    """i번째 문장의 마지막 카드가 다 찍힌 시각."""
    card, start, dur = [p for p in T.plan if p[0] in E.split_cards(T.sents[i])][-1]
    return E.char_times(card, start, dur)[-1] + 0.08


def moments(T):
    k, c = T.id, lambda i, j=0: S.cardt(T, i, j)
    m = {"mid": T.length / 2, "end": T.length - 1 / 24}
    m.update({f"s{n}_done": typed(T, i) for i, n in enumerate(SENT[k])})
    extra = {
        "hook": lambda: {"art_in": 1.2, "mascot": 2.9, "flow_mid": 5.0},
        "deep": lambda: {"surface": 0.5, "zoom_mid": at(T, 0) + 0.55, "layers_mid": at(T, 0) + 1.3, "layers_done": at(T, 0) + 2.4,
                         "arrow": at(T, 0) + 3.0, "plant_off": at(T, 1) + 1.5},
        "three": lambda: {"heat": S.typed_at(T, 0, "바위") + 0.3, "water": S.typed_at(T, 0, "그 속의 물") + 0.3,
                          "paths": S.typed_at(T, 0, "틈") + 0.3, "volcano": S.typed_at(T, 1, "화산") + 0.4, "card2": at(T, 2) + 0.6},
        "make": lambda: {"hot_label": at(T, 0) + 0.4, "zone_blink": at(T, 0) + 0.7, "inj_mid": c(1) + 1.0, "inj_done": c(1) + 2.2,
                         "down_mid": c(1, 1) + 0.8, "down_done": c(1, 1) + 1.8, "crack_start": c(2) + 0.1, "crack_mid": c(2) + 0.4,
                         "crack_done": c(2) + 1.0, "thick": c(2, 1) + 0.5},
        "loop": lambda: {"prod_mid": c(0) + 1.0, "prod_done": c(0, 1) + 1.3, "through_mid": at(T, 1) + 1.5, "through_done": at(T, 1) + 3.5,
                         "up_mid": c(2) + 0.8, "led": c(2, 1) + 0.3, "back_mid": c(2, 2) + 0.4, "back_done": c(2, 2) + 1.3,
                         "highlight": at(T, 3) + 0.4, "pointer": at(T, 3) + 1.2},
        "cape": lambda: {"start": 0.6, "grow_mid": c(0, 1) + 1.5, "horiz": c(0, 2) + 0.8, "grown": c(0, 2) + 2.0, "mw": at(T, 1) + 0.6},
        "limit": lambda: {"zoom_mid": 0.55, "stage": 1.4, "cracks_mid": S.typed_at(T, 0, "틈") + 0.5, "quake_on": c(0, 1) + 0.03,
                          "quake_off": c(0, 1) + 0.2, "quake_late": c(0, 1) + 0.6, "after_quake": at(T, 1) + 0.3, "controlled": at(T, 2) + 0.6},
        "finale": lambda: {"cards": at(T, 0) + 0.6, "flow_start": c(0, 1) + 0.6, "flow_mid": c(0, 1) + 1.0, "flow_full": c(0, 1) + 2.2,
                           "mascot": at(T, 1) + 0.25, "mascot2": at(T, 1) + 1.0},
    }
    m.update(extra[k]())
    return m


want = set(sys.argv[1:])
for T, off in zip(ep.scenes, ep.starts):
    if T is ep.ending or (want and T.id not in want):
        continue
    for name, t in moments(T).items():
        i = round((off + min(t, T.length - 1 / 24)) * E.FPS_OUT)
        img = ep.frame(i)
        Image.fromarray(E.to_output(img)).save(OUT / f"{T.id}_{name}.png")
        print(f"{T.id}_{name}.png  scene t={t:.2f}  global {i / E.FPS_OUT:.2f}")
