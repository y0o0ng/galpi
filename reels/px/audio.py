"""합성 칩튠: BGM, 타자음, 효과음. 음량 상수는 여기 한 곳."""
import wave

import numpy as np

from .bgm import song

SR = 44100
BGM_VOL, SFX_VOL, TYPE_VOL = 0.14, 0.11, 0.05   # 진폭(피크 기준). BGM > 효과음 ≥ 타자음은 RMS로 확인한다
SFX_GAP = 2.0                                    # 효과음 최소 간격(초; 도트 트랙)
SFX_EXEMPT = ("jingle", "stamp")                 # 엔딩 도장 장면 전용: SFX_GAP 규칙에서 빠진다(다른 소리에 밀려 사라지면 안 된다)


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


BUBBLES = ((420, .050), (520, .045), (350, .055), (480, .045), (300, .060))   # (Hz, 길이 초); 사이 75ms, 갈수록 작게


def _bubbles():
    """낮은 사인파 방울 다섯 개: 각자 살짝 오르는 음, 둥근(hann) 엔벌로프, 아래로 갈수록 작게."""
    out = np.zeros(int(0.6 * SR))
    for k, (f, dur) in enumerate(BUBBLES):
        n = int(dur * SR)
        t = np.arange(n) / SR
        w = np.sin(2 * np.pi * np.cumsum(f * (1 + 0.25 * t / dur)) / SR) * np.hanning(n) * (1 - 0.15 * k)
        i = int(sum(d + 0.075 for _, d in BUBBLES[:k]) * SR)
        out[i:i + n] += w
    return out * SFX_VOL


TICKS = ((262, .06), (330, .06), (392, .06))   # (Hz, 길이 초); 사이 0.25초(12fps 3프레임), 숫자창이 오를 때마다 한 음씩


def _ticks(gap=0.25):
    """낮은 사인파 딸깍 세 번(gap초 간격): 둥근(hann) 엔벌로프, 한 음씩 올라간다."""
    out = np.zeros(int((2 * gap + 0.1) * SR))
    for k, (f, dur) in enumerate(TICKS):
        n = int(dur * SR)
        i = int(gap * k * SR)
        out[i:i + n] += np.sin(2 * np.pi * f * np.arange(n) / SR) * np.hanning(n)
    return out * SFX_VOL


def tone(f, dur, amp, fm=0.0):
    """짧은 종소리: 사인(+약한 FM), 빠른 어택, 지수 감쇠."""
    t = np.arange(int(dur * SR)) / SR
    return amp * np.minimum(1, t / 0.008) * np.exp(-t * 7) * np.sin(2 * np.pi * f * t + fm * np.sin(2 * np.pi * f * 2 * t))


def _jingle():
    """완성 징글: F5-A5-C6을 0.11초 간격으로, 그 뒤 F6."""
    out = np.zeros(int(0.95 * SR))
    for k, f in enumerate((698.46, 880.0, 1046.5)):
        i = int(k * 0.11 * SR)
        x = tone(f, 0.35, 0.10, 0.6)
        out[i:i + len(x)] += x
    i = int(3 * 0.11 * SR)
    x = tone(1396.9, 0.6, 0.07, 0.4)
    out[i:i + len(x)] += x
    return out


def _stamp():
    """도장 쾅: 내려가는 저음 + 짧은 노이즈."""
    t = np.arange(int(0.35 * SR)) / SR
    thud = np.sin(2 * np.pi * np.cumsum(110 * np.exp(-t * 12) + 45) / SR) * np.exp(-t * 11) * 0.45
    return thud + np.random.default_rng(5).standard_normal(len(t)) * np.exp(-t * 60) * 0.06


def sfx(kind):
    """사인파, 느린 어택·릴리즈. pop: 250→600Hz 상승, sparkle: 659Hz→880Hz 두 음, danger: 330Hz→247Hz 낮고 내려가는 두 음,
    bubbles: 300~520Hz 짧은 방울 다섯 개, ticks: 262·330·392Hz 딸깍 세 번(0.25초 간격), ticks_slow: 같은 소리를 0.5초 간격으로.
    jingle·stamp: 엔딩 도장 장면 전용(완성 징글 / 도장 쾅)."""
    if kind == "jingle":
        return _jingle()
    if kind == "stamp":
        return _stamp()
    if kind == "bubbles":
        return _bubbles()
    if kind == "ticks":
        return _ticks()
    if kind == "ticks_slow":
        return _ticks(0.5)
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
    """events: [(시각, 종류)]. 최소 간격 SFX_GAP 안의 것은 버린다(SFX_EXEMPT 종류는 항상 넣고 간격 계산에도 안 쓴다)."""
    out, last = np.zeros(int(secs * SR)), -99
    kept = []
    for t, kind in sorted(events):
        exempt = kind in SFX_EXEMPT
        if t - last < SFX_GAP and not exempt:
            continue
        s = sfx(kind)
        i = int(t * SR)
        out[i:i + len(s)] += s[:len(out) - i]
        if not exempt:
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
