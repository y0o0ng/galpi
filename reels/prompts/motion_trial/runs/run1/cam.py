"""13편 카메라: 편 절대 시각 하나의 함수. Cam(cx, cy, z) = 화면 (90, 125)에 오는 세계 점과 배율(회전 없음).
키는 장면 시각(초)로 적고 장면 시작 시각을 더해 한 트랙으로 잇는다 — 장면 경계에서 값이 끊기지 않는다."""
import math
from collections import namedtuple

from px.timeline import ease_in_out, ease_out, linear, step

Cam = namedtuple("Cam", "cx cy z")
HOOK_DY = 76                        # 훅 창 (0, 152)~(179, 319)의 가운데 (90, 201)이 화면 (90, 125)보다 76 아래다


def ease_in(u):
    return u * u


def _hook(cx, cy, z):
    """훅 창 가운데가 보는 세계 점 → 화면 가운데 기준 카메라."""
    return Cam(cx, cy - HOOK_DY / z, z)


# (장면 id, 장면 시각, 카메라, 이 키까지 오는 구간의 감속곡선)
SCENE_KEYS = [
    ("hook", 0.0, _hook(412, 165, 1.3), linear),
    ("hook", 2.0, _hook(412, 165, 1.3), linear),
    ("hook", 3.1, _hook(412, 104, 1.3), ease_out),
    ("hook", 5.6, _hook(408, 92, 1.25), linear),
    ("hook", 10.8, _hook(404, 89, 1.2), ease_in_out),      # ×1.2: 손끝(창 아래)부터 첫마디 관절 위까지 보여서 손가락으로 읽힌다
    ("hook", 11.3, _hook(403, 89, 1.2), linear),
    ("clue", 2.4, Cam(202, 150, 1.0), ease_in_out),
    ("clue", 7.8, Cam(202, 150, 1.1), linear),
    ("clue", 9.8, Cam(201, 150, 1.3), ease_in_out),        # A 지문면 주름과 B 손톱 쪽이 둘 다 화면 안에 남는다
    ("clue", 12.4, Cam(203, 150, 1.32), linear),
    ("clue", 12.9, Cam(205, 156, 1.7), ease_in),
    ("inside", 1.6, Cam(159, 170, 3.6), ease_out),
    ("inside", 7.0, Cam(159, 171, 3.7), linear),
    ("inside", 8.4, Cam(146, 172, 5.0), ease_in_out),
    ("inside", 10.43, Cam(146, 172, 5.1), linear),
    ("inside", 11.6, Cam(158, 170, 3.0), ease_in_out),
    ("inside", 15.63, Cam(158, 170, 3.1), linear),
    ("inside", 16.13, Cam(150, 165, 2.6), ease_in),
    ("proof", 2.4, Cam(100, 145, 1.0), ease_out),
    ("proof", 10.0, Cam(100, 148, 1.08), linear),
    ("proof", 10.5, Cam(118, 128, 1.2), ease_in),
    ("finale", 1.0, Cam(158, 20, 2.0), ease_in_out),
    ("finale", 2.6, Cam(158, 172, 2.0), linear),       # 신호(세계 y 8 → 160)를 화면 같은 높이에서 따라 내려간다
    ("finale", 2.8, Cam(158, 174, 2.0), linear),
    ("finale", 4.4, Cam(160, 112, 1.3), ease_in_out),
    ("finale", 10.6, Cam(160, 126, 1.45), linear),
    ("finale", 11.1, Cam(160, 126, 1.47), linear),
]

KEYS = []


def init(starts):
    """starts: {장면 id: 편 절대 시작 시각}. 키 시각이 늘어나는지 검사한다."""
    KEYS.clear()
    KEYS.extend((starts[k] + t, c, e) for k, t, c, e in SCENE_KEYS)
    assert all(a[0] < b[0] for a, b in zip(KEYS, KEYS[1:])), "카메라 키 시각이 늘어나야 한다"


def cam_at(te):
    """12fps로 끊은 te의 카메라. cx·cy는 구간 곡선으로 선형, z는 로그 보간(확대 속도가 일정하게 보인다)."""
    te = step(te)
    if te <= KEYS[0][0]:
        return KEYS[0][1]
    for (t0, c0, _), (t1, c1, ease) in zip(KEYS, KEYS[1:]):
        if te <= t1:
            u = ease((te - t0) / (t1 - t0))
            return Cam(c0.cx + (c1.cx - c0.cx) * u, c0.cy + (c1.cy - c0.cy) * u, math.exp(math.log(c0.z) + (math.log(c1.z) - math.log(c0.z)) * u))
    return KEYS[-1][1]


def P(cam, wx, wy):
    """세계 점 → 화면 도트."""
    return round((wx - cam.cx) * cam.z + 90), round((wy - cam.cy) * cam.z + 125)
