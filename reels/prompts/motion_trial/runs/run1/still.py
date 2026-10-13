"""멈춤 상한 검사: 출력 24fps 프레임마다 캔버스 y 0~251(그림 영역)이 앞 프레임과 같은지 보고, 엔딩 도장 장면을 뺀 가장 긴 같은 구간이
24프레임(1.0초)을 넘으면 실패한다. 0.5초(12프레임) 넘게 멈춘 구간의 비율도 함께 낸다(14편 47%와 비교할 값).
실행: reels/.venv/bin/python episodes/ep13_c27m_px/still.py"""
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(HERE))
from px import engine as E  # noqa: E402
import scene as S  # noqa: E402

ep = S.ep
ep._sfx_plan()                                       # 효과음 계획을 먼저 만든다(프레임 도중에 만들면 마스코트 위치가 지워진다)
n = round(ep.starts[-1] * E.FPS_OUT)                 # 엔딩 도장 장면 앞까지
prev, runs, run, run_start = None, [], 1, 0
for i in range(n):
    cur = np.asarray(ep.frame(i, card=False).convert("RGB"))[:252]
    if prev is not None and (cur == prev).all():
        run += 1
    else:
        if prev is not None:
            runs.append((run, run_start))
        run, run_start = 1, i
    prev = cur
runs.append((run, run_start))
frames_long = sum(r for r, _ in runs if r > 12)
longest = max(runs)
print(f"프레임 {n}, 같은 구간 최장 {longest[0]}프레임({longest[0] / E.FPS_OUT:.2f}초) 시작 {longest[1] / E.FPS_OUT:.2f}초")
print(f"0.5초 넘게 멈춘 구간의 비율 {frames_long / n:.1%}")
for r, s in sorted(runs, reverse=True)[:8]:
    print(f"  {r}프레임 @ {s / E.FPS_OUT:.2f}초")
sys.exit(1 if longest[0] > 24 else 0)
