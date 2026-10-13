"""검토용 프레임 뽑기: media/frames/ep13_px/<장면>_<순간>.png (영상과 같은 장면 함수·출력 배치, 인코딩 전 프레임).
실행: reels/.venv/bin/python episodes/ep13_c27m_px/frames.py [장면 id ...]
      reels/.venv/bin/python episodes/ep13_c27m_px/frames.py --still   (그림 영역 y 0~250이 완전히 같은 채로 이어진 가장 긴 구간, 엔딩 제외)"""
import sys
from pathlib import Path

import numpy as np

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
ep = S.ep
SENT = {"hook": (1, 2), "clue": (3, 4, 5), "inside": (6, 7, 8), "fold": (9,), "proof": (10, 11, 12), "finale": (13, 14)}


def typed(T, i):
    """i번째 문장의 마지막 카드가 다 찍힌 시각."""
    card, start, dur = [p for p in T.plan if p[0] in E.split_cards(T.sents[i])][-1]
    return E.char_times(card, start, dur)[-1] + 0.08


def moments(T):
    c = lambda i, j=0: cardt(T, i, j)
    m = {"first": 0.03, "mid": T.length / 2, "end": T.length - 1 / 24, "last": T.length - 1 / 24}
    m.update({f"s{n}_done": typed(T, i) for i, n in enumerate(SENT[T.id])})
    extra = {
        "hook": lambda: {"wrinkle_mid": 1.6, "lift_mid": 3.1, "drop_fall": 4.2, "cover": T.length - 1 / 24},
        "clue": lambda: {"dip_mid": 0.7, "wrinkle_mid": c(0, 1) + 2.0, "question": at(T, 1) + 0.5, "nerve_mid": at(T, 2) + 0.5},
        "inside": lambda: {"zoom_mid": S.T_ZOOM + 0.3, "open": S.T_ZOOM + 0.8, "signal_mid": c(1, 1) + 0.7,
                           "narrow_mid": c(1, 1) + 1.5, "shrink_mid": S.shrink_start(T) + 1.3},
        "fold": lambda: {"pick": 0.3, "cut": S.T_CUT + 0.05, "pull_mid": c(0, 1) + 0.5, "fold_mid": c(0, 2) + 0.2,
                         "fold_done": c(0, 2) + 1.6},
        "proof": lambda: {"panels": 1.3, "cream_mid": c(1, 0) + 1.0, "wrinkle_mid": c(1, 2) + 0.8, "flow_mid": at(T, 2) + 0.8,
                          "numbers": at(T, 2) + 1.6},
        "finale": lambda: {"dip_mid": 0.8, "signal_mid": 2.0, "wrinkle_mid": 3.4, "mascot": at(T, 1) + 0.6},
    }
    m.update(extra[T.id]())
    return m


def save(i, name):
    img = ep.frame(i)
    Image.fromarray(E.to_output(img)).save(OUT / f"{name}.png")


def still():
    """그림 영역(y 0~250)이 완전히 같은 프레임이 이어진 가장 긴 구간(엔딩 도장 제외)과 0.5초 넘게 서 있는 비율."""
    n_end = round(ep.starts[-1] * E.FPS_OUT) if ep.ending else round(ep.total * E.FPS_OUT)
    prev, run, best, where, held = None, 0, 0, 0, 0
    for i in range(n_end):
        a = np.asarray(ep.frame(i, card=False))[:251]
        run = run + 1 if prev is not None and np.array_equal(a, prev) else 0
        if run > best:
            best, where = run, i
        held += run >= E.FPS_OUT // 2
        prev = a
    print(f"가장 긴 완전 멈춤 {(best + 1) / E.FPS_OUT:.2f}초 (끝 {where / E.FPS_OUT:.2f}초), 0.5초 넘게 서 있는 프레임 {held / n_end:.1%}")


if __name__ == "__main__":
    ep._sfx_plan()                       # 렌더(main)처럼 소리 계획을 먼저 세운다 — 도중에 세우면 그 프레임의 마스코트 위치가 지워진다
    if "--still" in sys.argv:
        still()
        sys.exit()
    OUT.mkdir(parents=True, exist_ok=True)
    want = set(sys.argv[1:])
    for T, off in zip(ep.scenes, ep.starts):
        if T is ep.ending:
            if not want or "ending" in want:
                for s in (2.4, 4.1):
                    save(round((off + s) * E.FPS_OUT), f"ending_{s}")
            continue
        if want and T.id not in want:
            continue
        for name, t in moments(T).items():
            i = round((off + min(t, T.length - 1 / 24)) * E.FPS_OUT)
            save(i, f"{T.id}_{name}")
            print(f"{T.id}_{name}.png  scene t={t:.2f}  global {i / E.FPS_OUT:.2f}")
