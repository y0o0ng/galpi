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


def _sweep(f0, f1, dur):
    t = np.arange(int(dur * SR)) / SR
    return np.sin(2 * np.pi * np.cumsum(f0 + (f1 - f0) * t / dur) / SR) * np.hanning(len(t))


def _click():
    n = int(0.04 * SR)
    out = np.zeros(int(0.12 * SR))
    out[:n] += np.sin(2 * np.pi * 392 * np.arange(n) / SR) * np.hanning(n)
    i = int(0.06 * SR)
    out[i:i + n] += np.sin(2 * np.pi * 262 * np.arange(n) / SR) * np.hanning(n) * 0.8
    return out


def _thud():
    t = np.arange(int(0.3 * SR)) / SR
    ph = 2 * np.pi * np.cumsum(110 + 150 * np.exp(-t * 20)) / SR
    return (np.sin(ph) + 0.5 * np.sin(2 * ph)) * np.exp(-t * 10) * np.minimum(1, t / 0.005)


def _zap():
    t = np.arange(int(0.3 * SR)) / SR
    return np.sin(2 * np.pi * 440 * t + 6 * np.sin(2 * np.pi * 30 * t)) * np.hanning(len(t))


def _radiate():
    n = int(0.35 * SR)
    t = np.arange(n) / SR
    one = np.sin(2 * np.pi * np.cumsum(196 - 21 * t / 0.35) / SR) * np.hanning(n)
    out = np.zeros(int(1.4 * SR))
    for k, g in enumerate((1.0, 0.75, 0.5)):
        out[int(0.5 * k * SR):int(0.5 * k * SR) + n] += one * g
    return out


def _crack():
    n = int(0.05 * SR)
    out = np.zeros(int(0.3 * SR))
    for k, (f, g) in enumerate(((349, 1.0), (294, 0.85), (233, 0.7))):
        i = int(0.09 * k * SR)
        out[i:i + n] += np.sin(2 * np.pi * f * np.arange(n) / SR) * np.hanning(n) * g
    return out


def _hit(wave, f, dur, decay):
    """기계음 한 타: 삼각파 또는 사각파, 2ms 어택 뒤 지수 감쇠."""
    n = int(dur * SR)
    ph = (np.arange(n) * f / SR) % 1
    w = 4 * np.abs(ph - 0.5) - 1 if wave == "tri" else np.where(ph < 0.5, 1.0, -1.0)
    t = np.arange(n) / SR
    return w * np.minimum(1, t / 0.002) * np.exp(-t * decay)


def _switch(up):
    """레버가 슥(사인 스윕 0.09초) 움직이고 삼각파 딸깍 두 겹이 걸린다. 올림 523Hz, 내림 330Hz."""
    out = np.zeros(int(0.3 * SR))
    f0, f1, fc = (180, 300, 523) if up else (300, 180, 330)
    out[:int(0.09 * SR)] += _sweep(f0, f1, 0.09) * 0.3
    for t, f, g in ((0.08, fc, 1.0), (0.10, fc * 0.75, 0.5)):
        x = _hit("tri", f, 0.06, 60) * g
        out[int(t * SR):int(t * SR) + len(x)] += x
    return out


def _ratchet():
    """째깍째깍: 사각파 12ms 톱니 7개, 0.18초 간격, 624Hz·463Hz 교대. 1.2초."""
    out = np.zeros(int(1.2 * SR))
    for k in range(7):
        x = _hit("square", (624, 463)[k % 2], 0.012, 300)
        out[int(k * 0.18 * SR):int(k * 0.18 * SR) + len(x)] += x
    return out


# 2026-10 추가분: 사용자가 BGM 위에서 귀로 확정. 체감 크기는 pop과 같게(소리 구간 RMS) 맞춘다.
LOUD = {"rise": lambda: _sweep(220, 440, 0.4), "fall": lambda: _sweep(440, 220, 0.4), "click": _click,
        "thud": _thud, "zap": _zap, "radiate": _radiate, "crack": _crack,
        "switch_up": lambda: _switch(True), "switch_down": lambda: _switch(False), "ratchet": _ratchet}


def sfx(kind):
    """사인파, 느린 어택·릴리즈. pop: 250→600Hz 상승, sparkle: 659Hz→880Hz 두 음, danger: 330Hz→247Hz 낮고 내려가는 두 음,
    bubbles: 300~520Hz 짧은 방울 다섯 개, ticks: 262·330·392Hz 딸깍 세 번(0.25초 간격), ticks_slow: 같은 소리를 0.5초 간격으로.
    rise/fall: 220↔440Hz 스윕 0.4초(값이 오름/내림), click: 392·262Hz 짧은 두 음(스위치), thud: 260→110Hz 하강+2배음(떨어져 부딪힘),
    zap: 440Hz에 30Hz 떨림(전기·신호), radiate: 196→175Hz 세 번 0.5초 간격(열·파동이 차례로 떠남, 5편),
    crack: 349·294·233Hz 딱 세 번 0.09초 간격(갈라짐, 8편), switch_up/switch_down: 레버 슥 + 삼각파 딸깍(스위치 올림/내림),
    ratchet: 사각파 째깍 7번 0.18초 간격(기어·톱니, 1.2초).
    jingle·stamp: 엔딩 도장 장면 전용(완성 징글 / 도장 쾅)."""
    if kind in LOUD:
        x = LOUD[kind]()
        return x * 10 ** ((rms_db(sfx("pop"), True) - rms_db(x, True)) / 20)
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
