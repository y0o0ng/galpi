"""검토용 프레임 뽑기: media/frames/ep13_px/<장면>_<순간>.png (영상과 같은 장면 함수·출력 배치, 인코딩 전 프레임).
실행: reels/.venv/bin/python episodes/ep13_c27m_px/frames.py [장면 id ...]   (장면 id:초 는 그 장면 시각 한 장, 이름 t<초>)"""
import math
import sys
from pathlib import Path

HERE = Path(__file__).parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(HERE))
from PIL import Image  # noqa: E402
from px import engine as E  # noqa: E402
from px.templates import cardt  # noqa: E402
import scene as S  # noqa: E402

OUT = ROOT / "media" / "frames" / "ep13_px"
OUT.mkdir(parents=True, exist_ok=True)
ep = S.ep
SENT = {"hook": (1, 2), "clue": (3, 4, 5), "inside": (6, 7, 8, 9), "proof": (10, 11), "finale": (12, 13)}
LAST = 1 / 24


def typed(T, i):
    """i번째 문장의 마지막 카드가 다 찍힌 시각."""
    card, start, dur = [p for p in T.plan if p[0] in E.split_cards(T.sents[i])][-1]
    return E.char_times(card, start, dur)[-1] + 0.08


def moments(T):
    k, c = T.id, lambda i, j=0: cardt(T, i, j)
    m = {"mid": T.length / 2, "end": T.length - LAST, "first": 0.0, "last": T.length - LAST}
    m.update({f"s{n}_done": typed(T, i) for i, n in enumerate(SENT[k])})
    extra = {
        "hook": {"crease_mid": 0.9, "lift_mid": 2.45, "ripple": 3.2, "drop": 3.3, "mascot": 2.9, "zoom_mid": 8.0},
        "clue": {"pan_mid": 1.2, "tags": 2.3, "dip_mid": 4.1, "dipped": 4.8, "wrinkle_mid": 6.3, "wrinkled": 7.6, "push": 9.0,
                 "question": 10.0, "pointer": 6.5, "to_inside": 12.7},
        "inside": {"zoom_mid": 0.9, "wipe_mid": 1.2, "section": 1.9, "signal": 2.3, "vessel_mid": 3.2, "vessel_done": 4.0,
                   "shrink_mid": 5.2, "shrunk": 6.6, "skin_zoom": 7.7, "groove1": 8.9, "groove3": 9.6, "grooves": 10.4,
                   "pulled_back": 11.2, "pillow_full": 12.6, "pillow_mid": 13.6, "pillow_done": 14.6, "exit": 16.0},
        "proof": {"wipe_mid": 0.7, "pan_mid": 1.6, "cream_mid": 3.0, "cream_done": 3.8, "creases_mid": 4.5, "creases_done": 5.5,
                  "flow": 7.0, "flow_done": 7.6, "late": 9.5, "to_finale": 10.4},
        "finale": {"open_mid": 0.7, "signal_top": 1.2, "signal_mid": 2.0, "signal_end": 2.7, "test": 3.0, "pull_back": 3.6,
                   "pulse": 6.0, "mascot": 5.2, "late": 9.0},
    }
    m.update(extra[k])
    return m


args = sys.argv[1:]
single = [a for a in args if ":" in a]
want = {a for a in args if ":" not in a}
for T, off in zip(ep.scenes, ep.starts):
    if T is ep.ending:
        continue
    todo = {} if single else moments(T)
    for a in single:
        sid, sec = a.split(":")
        if sid == T.id:
            todo[f"t{sec}"] = float(sec)
    if want and T.id not in want and not single:
        continue
    for name, t in todo.items():
        i = math.ceil((off + min(t, T.length - LAST)) * E.FPS_OUT - 1e-6)     # 장면 경계 first가 앞 장면으로 밀리지 않게 올림
        img = ep.frame(i)
        Image.fromarray(E.to_output(img)).save(OUT / f"{T.id}_{name}.png")
        print(f"{T.id}_{name}.png  scene t={t:.2f}  global {i / E.FPS_OUT:.2f}")
if not single and not want:
    T, off = ep.scenes[-1], ep.starts[-1]               # 엔딩 도장 직후(2.4초)·마지막(4.1초)
    for name, t in (("stamp", 2.4), ("final", 4.1)):
        i = round((off + t) * E.FPS_OUT)
        Image.fromarray(E.to_output(ep.frame(i))).save(OUT / f"ending_{name}.png")
        print(f"ending_{name}.png  global {i / E.FPS_OUT:.2f}")
