"""검토용 프레임 뽑기: media/frames/ep07_px/<장면>_<순간>.png (영상과 같은 장면 함수·출력 배치, 인코딩 전 프레임).
실행: reels/.venv/bin/python episodes/ep07_c7_px/frames.py"""
import math
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

OUT = ROOT / "media" / "frames" / "ep07_px"
OUT.mkdir(parents=True, exist_ok=True)
ep = S.ep
SENT = {"hook": (1, 2), "stop": (3,), "numbers": (4, 5), "vm": (6, 7), "swap": (8, 9), "fault": (10, 11, 12),
        "gc": (13, 14, 15, 16), "limit": (17, 18), "finale": (19, 20)}


def typed(T, i):
    """i번째 문장의 마지막 카드가 다 찍힌 시각."""
    card, start, dur = [p for p in T.plan if p[0] in E.split_cards(T.sents[i])][-1]
    return E.char_times(card, start, dur)[-1] + 0.08


def moments(T):
    k, c = T.id, lambda i, j=0: S.cardt(T, i, j)
    m = {"mid": T.length / 2, "end": T.length - 1 / 24}
    m.update({f"s{n}_done": typed(T, i) for i, n in enumerate(SENT[k])})
    arr = at(T, 1, 0.85) if len(T.sents) > 1 else 0
    down0 = c(0, 2) if len(T.sents[0].split(" / ")) > 2 else 0
    extra = {
        "hook": lambda: {"art_in": 1.2, "read_mid": 1.5, "blink_on": 1.95, "blink_off": 2.3, "mascot": 2.9, "rise_mid": 6.0},
        "stop": lambda: {"run_only": 1.0, "stop_in": c(0, 2) + 0.4},
        "numbers": lambda: {"median": 1.0, "worst": at(T, 1) + 0.8, "x800": c(1, 1) + 0.6},
        "vm": lambda: {"cells": 1.0, "flows_mid": c(0, 1) + 0.6, "flows_done": c(0, 1) + 2.4, "table": at(T, 1) + 0.3,
                       "flash": c(1, 0) + 1.5, "redraw_mid": c(1, 1) + 0.5, "redraw_done": c(1, 1) + 2.6},
        "swap": lambda: {"disk_in": 0.6, "faded": at(T, 0) + 1.2, "desc_start": down0 + 0.3, "desc_mid": down0 + 0.7,
                         "desc_late": down0 + 1.2, "arrived": down0 + 1.6, "label": at(T, 1) + 0.5},
        "fault": lambda: {"start": 0.6, "read_mid": c(0, 1) - 1.0, "blink_on": c(0, 1) + 0.05, "blink_off": c(0, 1) + 0.25,
                          "pointer_in": c(0, 1) + 0.6, "pointer_hold": c(0, 1) + 1.3, "wait_start": at(T, 1) + 0.1,
                          "wait_mid": at(T, 1, 0.4), "before_arrive": arr - 0.12, "arrive": arr + 0.01, "last_wait": math.ceil(arr * 12) / 12 - 1 / 24, "first_arrived": math.ceil(arr * 12) / 12,
                          "after_arrive": arr + 0.5,
                          "pointer_out": at(T, 1) - 0.2, "s12": at(T, 2) + 0.5},
        "gc": lambda: {"program_run": 0.2, "stopped": at(T, 0) + 0.3, "sweep_mid": c(0, 2) + 0.2, "sweep_late": c(1, 1) - 0.4,
                       "hit_on": c(1, 1) + 0.05, "hit_off": c(1, 1) + 0.25, "fault_label": c(1, 1) + 1.2, "bar_mid": at(T, 2) + 1.2,
                       "bar_full": c(2, 1) + 0.1, "count_mid": c(2, 1) + 1.2, "count_done": c(2, 1) + 2.6, "stop_label": at(T, 3) + 0.4},
        "limit": lambda: {"test_only": 1.0, "swap_gc": at(T, 1) + 0.3, "stall": at(T, 1) + 1.2},
        "finale": lambda: {"go_early": at(T, 0) + 0.7, "go_mid": at(T, 0) + 2.5, "go_late": at(T, 1) - 0.1, "mascot": at(T, 1) + 0.25,
                           "mascot2": at(T, 1) + 1.0},
    }
    m.update(extra[k]())
    return m


for T, off in zip(ep.scenes, ep.starts):
    if T is ep.ending:
        continue
    for name, t in moments(T).items():
        i = round((off + min(t, T.length - 1 / 24)) * E.FPS_OUT)
        img = ep.frame(i)
        Image.fromarray(E.to_output(img)).save(OUT / f"{T.id}_{name}.png")
        print(f"{T.id}_{name}.png  scene t={t:.2f}  global {i / E.FPS_OUT:.2f}")
