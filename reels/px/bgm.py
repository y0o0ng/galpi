"""도트 트랙 BGM: 16비트 키치 곡을 코드로 합성한다(라이선스 걱정 없음, seed 고정).

120 BPM, F장조 7화음 진행. 리드 멜로디 없이 FM 일렉피아노 컴핑 + 삼각파 베이스 + 킥·셰이커·클라베 림을 깔고,
그 위에 키치 아르페지오(12.5% 펄스, C5~A5)와 통통 튀는 2마디 리프(25% 펄스, G5~C6, 음 길이 75%)를 얹는다.
고음 피로를 줄이려고 트랙마다 저역 통과를 건다. 영상이 길면 A·B 구간을 더 돌려 길이를 채운다.
"""
import numpy as np
from scipy.signal import lfilter

SR, BPM = 44100, 120
BEAT = 60 / BPM
BAR = 4 * BEAT
NOTE = {n: i for i, n in enumerate("C C# D D# E F F# G G# A A# B".split())}
Q = {"maj7": [0, 4, 7, 11], "m7": [0, 3, 7, 10], "7": [0, 4, 7, 10], "m7b5": [0, 3, 6, 10],
     "m6": [0, 3, 7, 9], "9": [0, 4, 10, 14], "6": [0, 4, 7, 9]}


def ch(root, q):
    return (NOTE[root], Q[q])


A = [[ch("F", "maj7")], [ch("E", "m7b5"), ch("A", "7")], [ch("D", "m7")], [ch("C", "m7"), ch("F", "7")],
     [ch("A#", "maj7")], [ch("A#", "m6"), ch("D#", "9")], [ch("A", "m7"), ch("D", "7")], [ch("G", "m7"), ch("C", "7")]]
B = [[ch("A#", "maj7")], [ch("A", "7")], [ch("D", "m7")], [ch("D", "m7")],
     [ch("G", "m7")], [ch("C", "7")], [ch("F", "6")], [ch("G", "m7"), ch("C", "7")]]
INTRO = [[ch("F", "maj7")], [ch("D", "m7")], [ch("G", "m7")], [ch("C", "7")]]
OUTRO = [[ch("F", "maj7")], [ch("D", "m7")], [ch("G", "m7"), ch("C", "7")], [ch("F", "6")]]
# 리프: (16분 칸, 화음 구성음 순번) 2마디 고정 리듬
RIFF = [(0, 0), (3, 2), (6, 1), (8, 3), (11, 2), (14, 4), (18, 1), (22, 3), (26, 0), (28, 2)]


def midi_hz(m):
    return 440 * 2 ** ((m - 69) / 12)


def form(secs):
    """인트로·A·B·A·브레이크·B·A 다음, 길이가 모자라면 B·A를 더 돌리고 아웃트로."""
    f = [("intro", INTRO, 0.6), ("A", A, 1.0), ("B", B, 1.0), ("A", A, 1.0), ("break", INTRO, 1.0),
         ("B", B, 1.0), ("A", A, 1.0)]
    while (sum(len(c) for _, c, _ in f) + len(OUTRO)) * BAR < secs:
        f += [("B", B, 1.0), ("A", A, 1.0)]
    return f + [("outro", OUTRO, 0.5)]


def song(secs):
    """secs초 길이의 곡(피크 1.0 정규화, 끝 0.5초 페이드아웃)."""
    rng = np.random.default_rng(16)
    sections = form(secs)
    total = sum(len(c) for _, c, _ in sections) * BAR + 2.0
    tr = {k: np.zeros(int(total * SR) + SR) for k in ("arp", "riff", "ep", "bass", "drum")}

    def add(name, t, w):
        i = int(t * SR)
        tr[name][i:i + len(w)] += w[: len(tr[name]) - i]

    def adsr(n, a, d, s, r):
        e = np.full(n, float(s))
        na, nd, nr = int(a * SR), int(d * SR), int(r * SR)
        e[:na] = np.linspace(0, 1, na)
        e[na:na + nd] = np.linspace(1, s, len(e[na:na + nd]))
        if nr:
            e[-nr:] *= np.linspace(1, 0, nr)
        return e

    def pulse(f, dur, duty, vib):
        n = int(dur * SR)
        t = np.arange(n) / SR
        fm = f * (1 + 0.006 * np.sin(2 * np.pi * 5.5 * t) * np.clip(t / 0.25, 0, 1)) if vib else np.full(n, f)
        return np.where(np.cumsum(fm) / SR % 1 < duty, 1.0, -1.0) * adsr(n, 0.008, 0.1, 0.55, 0.06)

    def fm_ep(f, dur):
        n = int(dur * SR)
        t = np.arange(n) / SR
        idx = 1.8 * np.exp(-t * 6) + 0.25
        return np.sin(2 * np.pi * f * t + idx * np.sin(2 * np.pi * f * t)) * np.exp(-t * 2.2) * adsr(n, 0.004, 0, 1, 0.05)

    def tri(f, dur):
        n = int(dur * SR)
        return (4 * np.abs((np.arange(n) * f / SR) % 1 - 0.5) - 1) * adsr(n, 0.004, 0.05, 0.8, 0.04)

    def kick():
        t = np.arange(int(0.18 * SR)) / SR
        return np.sin(2 * np.pi * np.cumsum(110 * np.exp(-t * 18) + 45) / SR) * np.exp(-t * 14)

    def shaker():
        n = int(0.06 * SR)
        return np.diff(rng.standard_normal(n), prepend=0) * np.exp(-np.arange(n) / SR * 70)

    def rim():
        t = np.arange(int(0.05 * SR)) / SR
        return (np.sin(2 * np.pi * 1700 * t) * 0.6 + np.sin(2 * np.pi * 820 * t)) * np.exp(-t * 90)

    def halves(chords):
        return chords if len(chords) == 2 else chords * 2

    t0 = 0.0
    for name, chart, drum in sections:
        sparse = name in ("intro", "break", "outro")
        for bi, chords in enumerate(chart):
            bt = t0 + bi * BAR
            for half, (root, iv) in enumerate(halves(chords)):
                ht = bt + half * 2 * BEAT
                add("bass", ht, tri(midi_hz(41 + (root - 5) % 12), 0.75 * BEAT))           # 근음(1)
                add("bass", ht + 1.5 * BEAT, tri(midi_hz(41 + (root + 2) % 12), 0.45 * BEAT))  # 5도(2&)
                if not (sparse and bi % 2):                                                 # 키치 아르페지오
                    tones = sorted({m for x in iv for m in range(72, 82) if m % 12 == (root + x) % 12})
                    pattern = tones + tones[-2:0:-1]
                    for k in range(8):
                        add("arp", ht + k * BEAT / 4, pulse(midi_hz(pattern[k % len(pattern)]), BEAT / 8, 0.125, False) * 0.07)
            for pos in (0, 3, 6, 8, 11, 14):                                                # FM 컴핑(2마디 패턴)
                if pos // 8 != bi % 2:
                    continue
                p = pos % 8
                root, iv = chords[0] if p < 4 or len(chords) == 1 else chords[-1]
                for x in iv:
                    m = 53 + (root - 5) % 12 + x
                    while m > 66:
                        m -= 12
                    add("ep", bt + p * BEAT / 2, fm_ep(midi_hz(m), 0.9 * BEAT) * 0.22)
            for k in (0, 2):
                add("drum", bt + k * BEAT, kick() * 0.55 * drum)
            for e in range(8):
                add("drum", bt + e * BEAT / 2, shaker() * (0.035 if e % 2 else 0.018) * drum)
            for c in ((0, 3, 6) if bi % 2 == 0 else (2, 4)):                                # 클라베 3-2
                add("drum", bt + c * BEAT / 2, rim() * 0.16 * drum)
        if name in ("A", "B"):                                                              # 맨 위 리프
            for bi in range(0, len(chart), 2):
                for slot, deg in RIFF:
                    bar = bi + slot // 16
                    if bar >= len(chart):
                        continue
                    chords = chart[bar]
                    root, iv = chords[0] if slot % 16 < 8 or len(chords) == 1 else chords[-1]
                    tones = sorted({m for x in iv for m in range(79, 85) if m % 12 == (root + x) % 12})
                    tones += [t + 12 for t in tones if t + 12 <= 86]
                    add("riff", t0 + bar * BAR + (slot % 16) * BEAT / 4,
                        pulse(midi_hz(tones[deg % len(tones)]), BEAT / 4 * 0.75, 0.25, True) * 0.06)
        t0 += len(chart) * BAR

    def lp(x, fc):
        a = np.exp(-2 * np.pi * fc / SR)
        return lfilter([1 - a], [1, -a], x)

    mix = lp(tr["arp"], 4500) + lp(tr["riff"], 4000) + lp(tr["ep"], 4200) + lp(tr["bass"], 1200) * 0.9 \
        + lp(tr["drum"], 6000) * 0.8
    mix = np.tanh(mix[: int(secs * SR)] * 1.4) / np.tanh(1.4)
    fade = min(int(0.5 * SR), len(mix))
    mix[len(mix) - fade:] *= np.linspace(1, 0, fade)
    return mix / (np.abs(mix).max() or 1)
