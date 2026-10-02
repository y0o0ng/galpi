"""시간축: 장면은 "시각 t → 그 순간 그림" 함수다. 진행도·문장 시작 묶기·12fps 끊기·값 보간·감속곡선."""
import math


def span(t, a, b):
    """t가 [a, b]에서 0→1로 가는 진행도. 구간 밖은 0/1."""
    return min(max((t - a) / (b - a), 0.0), 1.0)


def at(scene, i, frac=0.0, off=0.0):
    """i번째 문장의 시작(+ 문장 시간의 frac 비율 + off초). scene은 sstart·sdur를 가진 장면."""
    return scene.sstart[i] + frac * scene.sdur[i] + off


def step(t, fps=12):
    """fps 단계로 끊은 시각(도트 움직임은 12fps)."""
    return math.floor(t * fps + 1e-9) / fps


def tween(t, a, b, v0, v1, ease=None, rnd=False):
    """[a, b] 동안 v0→v1. ease는 0→1 곡선(기본 linear). rnd면 정수로 반올림."""
    v = v0 + (v1 - v0) * (ease or linear)(span(t, a, b))
    return round(v) if rnd else v


def linear(u):
    return u


def ease_out(u):
    return 1 - (1 - u) ** 3


def ease_in_out(u):
    return u * u * (3 - 2 * u)


def back(u, c=1.70158):
    """살짝 넘쳤다가 돌아오는 팝."""
    return 1 + (c + 1) * (u - 1) ** 3 + c * (u - 1) ** 2


def bounce(u):
    """바닥에 닿아 통통 튀며 멈추는 곡선."""
    n, d = 7.5625, 2.75
    if u < 1 / d:
        return n * u * u
    if u < 2 / d:
        u -= 1.5 / d
        return n * u * u + 0.75
    if u < 2.5 / d:
        u -= 2.25 / d
        return n * u * u + 0.9375
    u -= 2.625 / d
    return n * u * u + 0.984375
