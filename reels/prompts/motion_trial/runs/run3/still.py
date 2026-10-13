"""멈춤 검사: 그림 영역(캔버스 y 0~250, 자막 카드 없이)이 똑같은 프레임으로 이어진 가장 긴 구간과, 0.5초 넘게 멈춘 시간 비율(엔딩 도장 제외).
실행: reels/.venv/bin/python episodes/ep13_c27m_px/still.py"""
import sys
from pathlib import Path

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE.parents[1]))
sys.path.insert(0, str(HERE))
import numpy as np  # noqa: E402
from px import engine as E  # noqa: E402
import scene as S  # noqa: E402

ep = S.ep
ep._sfx_plan()                       # 소리 계획을 먼저 만든다(처음 부르는 순간 장면을 훑으며 마스코트 위치를 지운다)
end = round(ep.starts[-1] * E.FPS_OUT) if ep.ending else round(ep.total * E.FPS_OUT)
prev, run, runs = None, 0, []
for i in range(end):
    a = np.asarray(ep.frame(i, card=False))[:251].tobytes()
    if a == prev:
        run += 1
    else:
        if run:
            runs.append((run + 1, i - run - 1))
        run = 0
    prev = a
if run:
    runs.append((run + 1, end - run - 1))
runs.sort(reverse=True)
held = sum(n for n, _ in runs if n > E.FPS_OUT // 2)
print(f"프레임 {end}개, 가장 긴 멈춤 {runs[0][0] / E.FPS_OUT if runs else 0:.2f}초")
print(f"0.5초 넘게 멈춘 시간: {held / E.FPS_OUT:.2f}초 ({100 * held / end:.1f}%)")
for n, i in runs[:8]:
    T, t = ep.which(i / E.FPS_OUT)
    print(f"  {n / E.FPS_OUT:.2f}초  [{T.id}] {t:.2f}s~  (절대 {i / E.FPS_OUT:.2f}s)")
