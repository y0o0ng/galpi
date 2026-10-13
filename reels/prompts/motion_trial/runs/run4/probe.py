"""정적 구간 검사: 그림 영역(y 0~250)이 24fps로 연달아 똑같은 프레임인 가장 긴 구간(초)을 장면마다 출력한다.
실행: reels/.venv/bin/python episodes/ep13_c27m_px/probe.py"""
import sys
from pathlib import Path

HERE = Path(__file__).parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(HERE))
import numpy as np  # noqa: E402
from px import engine as E  # noqa: E402
import scene as S  # noqa: E402

ep = S.ep
ep._sfx_plan()                                   # 효과음 계획을 먼저 만들어 둔다(프레임을 그리는 도중에 만들면 마스코트 위치가 지워진다)
for T, off in zip(ep.scenes, ep.starts):
    if T is ep.ending:
        continue
    n, prev, run, worst, worst_at, frozen = round(T.length * E.FPS_OUT), None, 0, 0, 0, 0
    for k in range(n):
        a = np.asarray(ep.frame(round(off * E.FPS_OUT) + k, card=False).convert("RGB"))[:250]
        if prev is not None and (a == prev).all():
            run += 1
            frozen += 1
            if run > worst:
                worst, worst_at = run, k
        else:
            run = 0
        prev = a
    print(f"{T.id}: 가장 긴 정지 {worst / E.FPS_OUT:.2f}초 (장면 {worst_at / E.FPS_OUT:.1f}초 무렵), 같은 프레임 비율 {frozen / n:.0%}")
