"""형식 2 효과음 키트: 대상 하나 = 소리 하나. 칩튠 재료(삼각파·저역 통과 노이즈)만, 낮은 음역, 소리마다 꼬리.
44편 시제품에서 사용자가 귀로 고른 방향(2026-11-12): 금속성 노이즈·사각파 고음은 귀를 찔렀고("공사장 소리") 사인 블립 돌려쓰기는
상황에 안 맞았다. 그래서 모든 소리를 저역 통과(-12dB/oct)하고, 기본음은 폰 스피커가 내는 150~800Hz에 둔다.
반환값은 전부 numpy 배열(44.1kHz, 모노)이고 장면에서 `T.kit.append((장면 시각, 배열, "대상 이름"))`으로 놓는다.
크기 기준: BGM ≈ -25dB, 지속음 -30 ~ -41dB, 짧은 음 -26 ~ -30dB(소리 구간 RMS)."""
import numpy as np
from scipy.signal import lfilter

from .audio import SR, rms_db

C4, E4, G4, A4, C5, E5, G5 = 262, 330, 392, 440, 523, 659, 784


# ---------------- 재료 ----------------
def lp(x, fc):
    """1차 저역 통과 두 번(-12dB/oct)."""
    a = 1 - np.exp(-2 * np.pi * fc / SR)
    for _ in range(2):
        x = lfilter([a], [1, a - 1], x)
    return x


def tri(f, dur):
    """삼각파. f는 숫자 또는 길이 dur*SR의 배열(음높이가 변하는 소리)."""
    ph = np.cumsum(np.broadcast_to(f, int(dur * SR)) / SR) % 1
    return 4 * np.abs(ph - 0.5) - 1


def env(n, a=0.005, r=0.08):
    """a초 어택, 끝 r초 지수 감쇠 — 뚝 끊기지 않게."""
    e = np.ones(n)
    na, nr = min(int(a * SR), n), min(int(r * SR), n)
    e[:na] = np.linspace(0, 1, na)
    if nr:
        e[-nr:] *= np.exp(-np.linspace(0, 5, nr))
    return e


def tail(x, delay=0.12, fb=0.3, taps=3):
    """짧은 메아리: 소리가 공간에 남았다 사라진다(하드게이트 대신)."""
    out = np.zeros(len(x) + int(delay * taps * SR))
    for k in range(taps + 1):
        out[int(delay * k * SR):int(delay * k * SR) + len(x)] += x * fb ** k
    return out


def level(x, db):
    """소리 구간 RMS를 db로."""
    return x * 10 ** ((db - rms_db(x, True)) / 20)


def fade(x, a, r):
    e = np.ones(len(x))
    na, nr = int(a * SR), int(r * SR)
    e[:na] = np.linspace(0, 1, na)
    e[len(x) - nr:] = np.minimum(e[len(x) - nr:], np.linspace(1, 0, nr))
    return x * e


def swell(x, ramp, db0, db1):
    """x(아무 크기)를 ramp초 동안 db0 → db1로 키운 뒤 db1 유지."""
    t = np.arange(len(x)) / SR
    return level(x, 0) * 10 ** ((db0 + (db1 - db0) * np.minimum(1, t / ramp)) / 20)


# ---------------- 소리 ----------------
def notes(freqs, each=0.07, gap=0.02, db=-28, fc=1800):
    """짧은 음 몇 개(신호·도착·확인·실패). 오르면 성공·도착, 내리면 실패·꺼짐으로 읽힌다."""
    parts = []
    for f in freqs:
        n = int(each * SR)
        parts += [tri(f, each) * env(n, 0.004, each * 0.7), np.zeros(int(gap * SR))]
    return tail(level(lp(np.concatenate(parts), fc), db))


def hum(dur, f=150, chop=24, db=-32):
    """모터·프로펠러·회전: 움직이는 동안만 놓는다(dur = 움직임 길이)."""
    t = np.arange(int(dur * SR)) / SR
    x = tri(f, dur) * (0.6 + 0.4 * (0.5 + 0.5 * np.sin(2 * np.pi * chop * t)))
    return fade(level(lp(x, 700), db), 0.3, 0.5)


def stutter(f=150, dur=0.8, db=-29, seed=0):
    """돌던 것이 멈칫: hum이 몇 번 끊기며 내려앉는다."""
    t = np.arange(int(dur * SR)) / SR
    gate = (np.random.default_rng(seed).random(int(dur * 20) + 1) > 0.4)[(t * 20).astype(int)]
    return level(lp(tri(f * (1 - 0.35 * t / dur), dur) * gate * np.exp(-t * 2), 600), db)


def tone(dur, f=C4, db=-31):
    """지속되는 신호·상태(켜져 있는 동안)."""
    t = np.arange(int(dur * SR)) / SR
    return fade(level(lp(tri(f, dur) * (0.92 + 0.08 * np.sin(2 * np.pi * 4 * t)), 900), db), 0.4, 0.6)


def wobble(dur, db=-38, f=C4):
    """잡음·방해·불안정: 맥놀이(7Hz)하는 저음 두 개. 지직거리는 노이즈 대신 쓴다. 같은 f의 tone을 덮으면 '묻힘'이 들린다."""
    t = np.arange(int(dur * SR)) / SR
    drift = 1 + 0.02 * np.sin(2 * np.pi * 0.7 * t)
    return fade(level(lp(tri(f * 0.97 * drift, dur) + tri((f * 0.97 + 7) * drift, dur), 500), db), 0.3, 0.5)


def drop(f=220, db=-26):
    """맞음·떨어짐·충돌: 저음 '둥' 하강."""
    t = np.arange(int(0.35 * SR)) / SR
    return tail(level(lp(tri(f * np.exp(-t * 2.5), 0.35) * env(len(t), 0.003, 0.3), 700), db))


def whoosh(dur=0.45, db=-33, seed=7):
    """확대·전환: 저역 통과 노이즈 '후'(부드러운 것만 — 노이즈는 이것 외에 쓰지 않는다)."""
    n = int(dur * SR)
    return level(lp(np.random.default_rng(seed).standard_normal(n) * np.hanning(n), 500), db)
