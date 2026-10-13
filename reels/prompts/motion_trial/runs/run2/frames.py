"""검토용 프레임 뽑기: media/frames/ep13_px/<장면>_<순간>.png (영상과 같은 장면 함수·출력 배치, 인코딩 전 프레임).
장면마다 first(0초)·last(마지막 프레임)를 뽑아 장면 경계의 이음을 본다. 실행: reels/.venv/bin/python episodes/ep13_c27m_px/frames.py [장면 id ...]"""
import sys
from pathlib import Path

HERE = Path(__file__).parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(HERE))
from PIL import Image  # noqa: E402
from px import engine as E  # noqa: E402
import scene as S  # noqa: E402

OUT = ROOT / "media" / "frames" / "ep13_px"
OUT.mkdir(parents=True, exist_ok=True)
ep = S.ep
ep._sfx_plan()                                  # 효과음 계획을 먼저(프레임 안에서 처음 계산하면 마스코트 위치 기록이 비워진다)
SENT ={"hook": (1, 2), "clue": (3, 4, 5), "inside": (6, 7, 8, 9), "proof": (10, 11), "finale": (12, 13)}


def typed(T, i):
    """i번째 문장의 마지막 카드가 다 찍힌 시각."""
    card, start, dur = [p for p in T.plan if p[0] in E.split_cards(T.sents[i])][-1]
    return E.char_times(card, start, dur)[-1] + 0.08


def moments(T, off):
    r = lambda te: te - off                                       # 절대 시각 → 장면 시각
    m = {"mid": T.length / 2, "end": T.length - 1 / 24}
    m.update({f"s{n}_done": typed(T, i) for i, n in enumerate(SENT[T.id])})
    extra = {
        "hook": lambda: {"crease_mid": 1.0, "lift_mid": r(sum(S.LIFT) / 2), "ripple": r(S.RIPPLES[0][0] + 0.4),
                         "drop": r(S.DROPS[0] + 0.45), "mascot": 2.9},
        "clue": lambda: {"pan_mid": 1.4, "tags": r(S.CL_TAG + 0.5), "dip_mid": r(sum(S.DIP_T) / 2), "dipped": r(S.DIP_T[1] + 0.3),
                         "crease_mid": r(S.A_CR[1] + 0.2), "creased": r(S.A_CR[3] + 0.5), "pointer": S.cardt(T, 1, 1) + 0.6,
                         "question": r(S.Q_T + 0.3), "to_inside": T.length - 0.25},
        "inside": lambda: {"zoom_mid": 0.5, "wipe_mid": 1.3, "section": 1.8, "signal": r(S.SIG0 + 0.3), "vessel_mid": r(S.TC + 0.4),
                           "vessel_done": r(S.TC + 1.1), "shrink_mid": r(sum(S.SHR) / 2), "shrunk": r(S.SHR[1] + 0.1),
                           "pan_done": r(S.PAN[1] + 0.1), "groove1": r(S.G_AR[0] + 0.45), "groove3": r(S.G_AR[2] + 0.45),
                           "grooves": r(S.G_AR[3] + 0.8), "fold": r(S.FOLD_T + 0.3), "pillow_full": r(S.PIL_T + 0.4),
                           "pillow_mid": r(S.PIL_T + 1.4), "pillow_done": r(S.PIL_T + 2.5)},
        "proof": lambda: {"pan_back": 0.3, "wipe_mid": 0.75, "zoom_mid": 1.3, "split_mid": 1.9, "split_done": 2.3,
                          "cream_mid": r(sum(S.CREAM) / 2), "cream_done": r(S.CREAM[1] + 0.1), "creases_mid": r(S.C_CR[1] + 0.3),
                          "creases_done": r(S.C_CR[3] + 0.5), "flow": r(S.FLOW_T + 0.25), "flow_done": r(S.FLOW_T + 1.0)},
        "finale": lambda: {"unsplit_mid": 0.3, "zoom": 0.8, "wipe_mid": 1.15, "signal_top": r(S.SIGF[0] + 0.3),
                           "signal_mid": r(S.SIGF[0] + 0.8), "signal_end": r(S.SIGF[1] - 0.1), "test": r(S.LIT + 0.3),
                           "pulse": r(S.SIGS_FI[0] + 0.5), "mascot": S.cardt(T, 1) + 0.25, "mascot2": S.cardt(T, 1) + 1.0},
    }
    m.update(extra[T.id]())
    return m


def save(i, name):
    Image.fromarray(E.to_output(ep.frame(i))).save(OUT / f"{name}.png")
    print(f"{name}.png  frame {i}  t {i / E.FPS_OUT:.2f}")


want = set(sys.argv[1:])
for T, off in zip(ep.scenes, ep.starts):
    if want and T.id not in want and not (T is ep.ending and "ending" in want):
        continue
    first, last = round(off * E.FPS_OUT), round((off + T.length) * E.FPS_OUT) - 1
    if T is ep.ending:
        save(round((off + 2.4) * E.FPS_OUT), "ending_stamp")
        save(min(round((off + 4.1) * E.FPS_OUT), last), "ending_final")
        continue
    save(first, f"{T.id}_first")
    save(last, f"{T.id}_last")
    for name, t in moments(T, off).items():
        save(round((off + min(max(t, 0), T.length - 1 / 24)) * E.FPS_OUT), f"{T.id}_{name}")
