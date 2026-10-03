"""합성 칩튠: BGM, 타자음, 효과음. 음량 상수는 여기 한 곳."""
import wave

import numpy as np

from .bgm import song

SR = 44100
BGM_VOL, SFX_VOL, TYPE_VOL = 0.14, 0.11, 0.05   # 진폭(피크 기준). BGM > 효과음 ≥ 타자음은 RMS로 확인한다
SFX_GAP = 2.0                                    # 효과음 최소 간격(초; 도트 트랙)


def _sq(f, n, duty=0.5):
    ph = (np.arange(n) * f / SR) % 1
    return np.where(ph < duty, 1.0, -1.0)


def _env(n, a=0.005, r=0.03):
    e = np.ones(n)
    na, nr = int(a * SR), int(r * SR)
    e[:na] = np.linspace(0, 1, na)
    e[-nr:] = np.minimum(e[-nr:], np.linspace(1, 0, nr))
    return e


def bgm(secs):
    """코드로 합성한 16비트 키치 곡(bgm.py)을 피크 BGM_VOL로."""
    return song(secs) * BGM_VOL


def typing(times, secs):
    """times: 소리 낼 글자의 시각들. 짧은 사각파 비프."""
    out = np.zeros(int(secs * SR))
    n = int(0.03 * SR)
    for k, t in enumerate(times):
        i = int(t * SR)
        if i + n <= len(out):
            out[i:i + n] += _sq((1320, 1480, 1175)[k % 3], n) * _env(n, 0.002, 0.015)
    return out * TYPE_VOL


def sfx(kind):
    """사인파, 느린 어택·릴리즈. pop: 250→600Hz 상승, sparkle: 659Hz→880Hz 두 음, danger: 330Hz→247Hz 낮고 내려가는 두 음."""
    n = int(0.26 * SR)
    t = np.arange(n) / SR
    if kind == "pop":
        w = np.sin(2 * np.pi * np.cumsum(250 + 350 * t / 0.26) / SR)
    elif kind == "danger":
        w = np.sin(2 * np.pi * np.where(t < 0.12, 330, 247) * t)
    else:
        w = np.sin(2 * np.pi * np.where(t < 0.13, 659, 880) * t)
    return w * _env(n, 0.012, 0.12) * SFX_VOL


def place_sfx(events, secs):
    """events: [(시각, 종류)]. 최소 간격 SFX_GAP 안의 것은 버린다."""
    out, last = np.zeros(int(secs * SR)), -99
    kept = []
    for t, kind in sorted(events):
        if t - last < SFX_GAP:
            continue
        s = sfx(kind)
        i = int(t * SR)
        out[i:i + len(s)] += s[:len(out) - i]
        last = t
        kept.append((t, kind))
    return out, kept


def rms_db(x, active_only=False):
    if active_only:
        x = x[np.abs(x) > 1e-6]
    return 20 * np.log10(np.sqrt(np.mean(x ** 2)) + 1e-12)


def write_wav(path, x):
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes((np.clip(x, -1, 1) * 32767).astype(np.int16).tobytes())
