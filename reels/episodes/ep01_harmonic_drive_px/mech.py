"""1편 도트 그림: 링·플렉스·캠 기구(블록 톱니). 톱니 수는 도트 디테일 규칙으로 정했다(안 16 / 밖 18, 안쪽이 2개 적음)."""
import math
import sys
from pathlib import Path

ROOT = Path(__file__).parents[2]
sys.path.insert(0, str(ROOT))
from PIL import Image, ImageDraw

from px import draw as D, engine as E  # noqa: E402
from px.sprite_anim import Anim  # noqa: E402

TAU = 2 * math.pi
FLEX_TEETH, RING_TEETH = 16, 18
TOOTH_DIFF = RING_TEETH - FLEX_TEETH                 # 안쪽이 2개 적다
REAL_FLEX_TEETH, REAL_RATIO = 200, 200 // TOOTH_DIFF  # 실제 수치 200 ÷ 2 = 100
FLEX_PITCH = TAU / FLEX_TEETH
RING_PITCH = TAU / RING_TEETH
MARKER_K = 4                                         # 표시점 톱니 번호(캠 0°에서 위쪽 90°)
MARKER_START = MARKER_K * FLEX_PITCH
MARKER_END = MARKER_START - TAU * TOOTH_DIFF / FLEX_TEETH
# 단위(u 도트) 기준 치수
RING_OUT, RING_ROOT, TOOTH = 3.6, 3.1, 0.25
FLEX_R, FLEX_A, CAM_A, CAM_B = 2.42, 0.3, 2.15, 1.55


def flex_angle(cam):
    """캠이 cam만큼 돌 때 플렉스 회전: 반대 방향, 톱니 TOOTH_DIFF개 피치 / 캠 한 바퀴."""
    return -cam * TOOTH_DIFF / FLEX_TEETH


def marker_angle(cam):
    return flex_angle(cam) + MARKER_START


def _layer(name, u, cam, k=5):
    """한 부품의 팔레트 레이어와 그 중심까지의 반지름 R(도트). 같은 (부품, u, 캠 각도)는 캐시에서 온다."""
    R = int(RING_OUT * u) + 3
    size = 2 * R + 1

    def ring(d, c, k):
        D.circle(d, c, c, round(RING_OUT * u * k), fill=E.LABEL)
        D.gear(d, c, c, RING_ROOT * u * k, RING_TEETH, angle=RING_PITCH / 2, tooth=TOOTH * u * k, inward=True,
               fill=E.BG)

    def flex(d, c, k):
        D.gear(d, c, c, FLEX_R * u * k, FLEX_TEETH, angle=flex_angle(cam), tooth=TOOTH * u * k,
               radius=lambda phi: (FLEX_R + FLEX_A * math.cos(2 * (phi - cam))) * u * k,
               fill=E.DEEP, outline=E.INK, width=k, mark=(MARKER_K, E.TEXT))

    def cam_body(d, c, k):
        D.ellipse(d, c, c, round(CAM_A * u * k), round(CAM_B * u * k), fill=E.PURPLE)

    if name == "ring":
        return D.baked(("ring", u), size, ring, E.PALETTE, k=k), R
    if name == "flex":
        return D.baked(("flex", u, round(cam, 4)), size, flex, E.PALETTE, k=k), R
    return D.baked(("cam", u), size, cam_body, E.PALETTE, angle=math.degrees(cam), k=k), R


def draw_mech(img, cx, cy, u, cam, show):
    """링·플렉스·캠을 겹쳐 붙인다. cam: 캠 각도(라디안), show: 그릴 부품 {'ring','flex','cam'}."""
    for name in ("ring", "flex", "cam"):
        if name in show:
            layer, R = _layer(name, u, cam)
            img.paste(layer, (cx - R, cy - R), layer)
    if "cam" in show:                                  # 캠 표시점과 중심축은 정수 도트로 직접
        d = ImageDraw.Draw(img)
        x, y = (round(v) for v in D.p(cx, cy, (CAM_A - 0.5) * u, cam))
        d.rectangle((x - 1, y - 1, x + 1, y + 1), fill=E.TEXT)
        d.rectangle((cx - 2, cy - 2, cx + 2, cy + 2), fill=E.BG)


def turn_anim(cx, cy, u, n):
    """캠이 한 바퀴(0→360°)를 12fps n칸으로 도는 합성 프레임 재생기(once, 끝은 360°에서 멈춤). 앵커는 기구 중심."""
    R = int(RING_OUT * u) + 3
    frames = []
    for i in range(n + 1):
        f = Image.new("RGBA", (2 * R + 1, 2 * R + 1), (0, 0, 0, 0))
        draw_mech(f, R, R, u, TAU * i / n, {"ring", "flex", "cam"})
        frames.append(f)
    return Anim(frames, fps=E.FPS_ANIM, mode="once", anchor=(R, R))


def ref_mark(d, cx, cy, u):
    a = MARKER_START
    d.polygon([D.p(cx, cy, (RING_OUT + 0.02) * u, a), D.p(cx, cy, (RING_OUT + 0.3) * u, a - 0.07),
               D.p(cx, cy, (RING_OUT + 0.3) * u, a + 0.07)], fill=E.TEXT)


def travel_arc(d, cx, cy, u):
    """표시점이 실제로 간 호(MARKER_START→MARKER_END, 시계 방향)와 라벨 위치."""
    D.circle(d, cx, cy, round((RING_OUT + 0.55) * u), outline=E.TEXT, width=2, arc=(MARKER_END % TAU, MARKER_START))
    return D.p(cx, cy, (RING_OUT + 1.15) * u, (MARKER_START + MARKER_END) / 2)
