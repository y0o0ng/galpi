"""검토용 프레임 뽑기: media/frames/ep06_px/<장면>_<순간>.png (영상과 같은 장면 함수·출력 배치, 인코딩 전 프레임). 실행: reels/.venv/bin/python episodes/ep06_c5_px/frames.py"""
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

OUT = ROOT / "media" / "frames" / "ep06_px"
OUT.mkdir(parents=True, exist_ok=True)
ep = S.ep
by = {T.id: (T, off) for T, off in zip(ep.scenes, ep.starts)}
SENT = {"hook": (1, 2), "stream": (3, 4, 5), "lost": (6, 7, 8, 9), "resend": (11,), "datacenter": (12, 13), "homa": (14, 15),
        "evidence": (16, 17, 18), "finale": (19, 20)}


def typed(T, i):
    """i번째 문장의 마지막 카드가 다 찍힌 시각."""
    card, start, dur = [p for p in T.plan if p[0] in E.split_cards(T.sents[i])][-1]
    return E.char_times(card, start, dur)[-1] + 0.08


def moments(T):
    k, c = T.id, lambda i, j=0: S.cardt(T, i, j)
    m = {"mid": T.length / 2, "end": T.length - 1 / 24}
    m.update({f"s{n}_done": typed(T, i) for i, n in enumerate(SENT[k])})
    extra = {
        "hook": lambda: {"blink": at(T, 1) + 0.3, "mascot": 2.9, "art_in": 1.2},
        "stream": lambda: {"bar_mid": c(0, 1) + 0.6, "split": at(T, 1) + 0.6, "lit_mid": c(1, 1) + 0.4, "march_mid": c(1, 1) + 1.75,
                   "march_end": c(1, 1) + 2.6, "s5_desc1": at(T, 2) + 0.7, "s5_desc2": at(T, 2) + 1.2, "s5_desc3": at(T, 2) + 1.7,
                   "s5_follow": at(T, 2) + 2.5},
        "lost": lambda: {"start": 0.5, "creep": c(0, 1) - 0.1, "danger": c(0, 1) + 0.2, "label": c(0, 1) + 0.8, "s7_mid": at(T, 1) + 1.05,
                 "s7_arrived": at(T, 2) - 0.1, "s8_gap": at(T, 2) + 0.3, "s9_pointer": at(T, 3) + 0.3, "s9_in": at(T, 3) + 0.6,
                 "s9_blink_on": at(T, 3) + 0.34 + 0.01, "s9_blink_off": at(T, 3) + 0.34 + 0.2},
        "resend": lambda: {"start": 0.3, "hop_road": 1.0, "hop_up": 1.6, "hop_top": 2.1, "hop_down": 2.7, "landed": S.cardt(T, 0, 2) - 0.05,
                   "deliver3": S.cardt(T, 0, 2) + 0.25, "t4": S.cardt(T, 0, 2) + 0.75, "t5": S.cardt(T, 0, 2) + 1.0,
                   "t6": S.cardt(T, 0, 2) + 1.25},
        "datacenter": lambda: {"blocks": c(0, 1) + 1.0, "long_early": at(T, 1) + 1.0, "long_mid": at(T, 1) + 2.6, "third_card": c(1, 2) + 0.4,
                       "long_end": at(T, 1) + 4.55, "short_mid": at(T, 1) + 5.2,
                       "long_late": at(T, 1) + 4.9, "short_start": at(T, 1) + 5.4},
        "homa": lambda: {"top_only": 1.0, "bottom": c(0, 2) + 0.6, "b_mid": c(1, 2) + 0.7, "c_mid": c(1, 2) + 1.7, "bc_end": c(1, 2) + 2.8},
        "evidence": lambda: {"top_only": 1.2, "bottom": c(0, 1) + 0.6, "number": c(0, 2) + 0.6, "dotted": at(T, 1) + 0.6, "api": at(T, 2) + 0.6},
        "finale": lambda: {"blink": c(0, 1) + 1.0, "mascot": at(T, 1) + 0.25, "mascot2": at(T, 1) + 1.0},
    }
    m.update(extra[k]())
    return m


for T, off in zip(ep.scenes, ep.starts):
    for name, t in moments(T).items():
        i = round((off + min(t, T.length - 1 / 24)) * E.FPS_OUT)
        img = ep.frame(i)
        Image.fromarray(E.to_output(img)).save(OUT / f"{T.id}_{name}.png")
        print(f"{T.id}_{name}.png  scene t={t:.2f}  global {i / E.FPS_OUT:.2f}")
