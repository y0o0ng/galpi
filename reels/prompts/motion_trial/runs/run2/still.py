"""멈춤 검사: 출력 24fps 프레임마다 그림 영역(캔버스 y 0~251)이 앞 프레임과 같은지 보고, 엔딩 도장을 뺀 가장 긴 같은 구간과
0.5초 넘게 멈춘 시간 비율을 낸다. 1초(24프레임)를 넘는 같은 구간이 있으면 종료 코드 1.
실행: reels/.venv/bin/python episodes/ep13_c27m_px/still.py"""
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE.parents[1]))
sys.path.insert(0, str(HERE))
from px import engine as E  # noqa: E402
import scene as S  # noqa: E402

ep = S.ep
ep._sfx_plan()                                  # 효과음 계획을 먼저(프레임 안에서 처음 계산하면 마스코트 위치 기록이 비워진다)
n =round(ep.starts[-1] * E.FPS_OUT) if ep.ending else round(ep.total * E.FPS_OUT)
runs, prev, run, start = [], None, 1, 0
for i in range(n):
    a = np.asarray(ep.frame(i).convert("RGB"))[:252]
    if prev is not None and np.array_equal(a, prev):
        run += 1
    else:
        if prev is not None:
            runs.append((run, start))
        run, start = 1, i
    prev = a
runs.append((run, start))
longest = max(runs)
still = sum(r for r, _ in runs if r > E.FPS_OUT // 2)
print(f"frames {n}; longest identical run {longest[0]} frames ({longest[0] / E.FPS_OUT:.2f}s) at t={longest[1] / E.FPS_OUT:.2f}s")
print(f"time in runs > 0.5s: {still / n * 100:.1f}%")
for r, s in sorted(runs, reverse=True)[:5]:
    print(f"  run {r} frames from t={s / E.FPS_OUT:.2f}s")
sys.exit(1 if longest[0] > E.FPS_OUT else 0)
