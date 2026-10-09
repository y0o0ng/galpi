"""도트 트랙 BGM: 곡 세 개를 코드로 합성한다(라이선스 걱정 없음, seed 고정). 대본이 분위기로 고르고(narration.ko.json `bgm`), 없으면 bright.
셋 다 사용자가 귀로 확정했다. 악기는 같은 칩튠 구성이고 곡마다 템포·진행·리프·밀도·아르페지오만 다르다.

- bright(기본): 120 BPM, F장조 7화음 진행. 리드 멜로디 없이 FM 일렉피아노 컴핑 + 삼각파 베이스 + 킥·셰이커·클라베 림을 깔고,
  그 위에 키치 아르페지오(12.5% 펄스, C5~A5)와 통통 튀는 2마디 리프(25% 펄스, G5~C6, 음 길이 75%)를 얹는다.
- calm: 100 BPM, F maj9 진행, 리프·클라베 없음, 드럼 작게. 아르페지오는 부드러운 삼각파로 카페풍 — 스윙 8분음, 근음 대신 3·5·7·9음,
  쉼표로 숨 쉬는 2마디 프레이즈, 마디 끝 반음 접근음. 피아노보다 6dB 작게.
- tense: 120 BPM, D단조, 8분음 베이스 연타 + 리프, 베이스 -6dB·피아노 -3dB. **유일하게 곡의 끝이 있다** — 엔딩 도장 장면 전 마지막 두 마디를
  100 BPM까지 늦추고 다음 첫 박에 F장조 화음을 길게 울린 뒤 징글 직전에 끝난다(징글·도장은 곡이 끝난 빈자리에서 나온다).
  D장조가 아니라 F장조로 끝내는 건 징글(F-A-C-F)과 F#이 부딪히지 않게다.
고음 피로를 줄이려고 트랙마다 저역 통과를 건다. 영상이 길면 A·B 구간을 더 돌려 길이를 채운다.
"""
import numpy as np
from scipy.signal import lfilter

SR = 44100
NOTE = {n: i for i, n in enumerate("C C# D D# E F F# G G# A A# B".split())}
Q = {"maj7": [0, 4, 7, 11], "m7": [0, 3, 7, 10], "7": [0, 4, 7, 10], "m7b5": [0, 3, 6, 10],
     "m6": [0, 3, 7, 9], "9": [0, 4, 10, 14], "6": [0, 4, 7, 9],
     "m": [0, 3, 7], "m9": [0, 3, 7, 10, 14], "7b9": [0, 4, 7, 10, 13], "maj9": [0, 4, 7, 11, 14], "sus4": [0, 5, 7, 10], "": [0, 4, 7]}
FINALE_LEAD, FINALE_CUT = 0.3, 1.45   # tense: 마지막 화음은 엔딩 장면 0.3초 전까지 떨어지고, 장면 1.45초(징글 T_JINGLE 1.55 직전)에 끝난다


def ch(root, q):
    return (NOTE[root], Q[q])


def midi_hz(m):
    return 440 * 2 ** ((m - 69) / 12)


# ---------------- bright ----------------
A = [[ch("F", "maj7")], [ch("E", "m7b5"), ch("A", "7")], [ch("D", "m7")], [ch("C", "m7"), ch("F", "7")],
     [ch("A#", "maj7")], [ch("A#", "m6"), ch("D#", "9")], [ch("A", "m7"), ch("D", "7")], [ch("G", "m7"), ch("C", "7")]]
B = [[ch("A#", "maj7")], [ch("A", "7")], [ch("D", "m7")], [ch("D", "m7")],
     [ch("G", "m7")], [ch("C", "7")], [ch("F", "6")], [ch("G", "m7"), ch("C", "7")]]
INTRO = [[ch("F", "maj7")], [ch("D", "m7")], [ch("G", "m7")], [ch("C", "7")]]
OUTRO = [[ch("F", "maj7")], [ch("D", "m7")], [ch("G", "m7"), ch("C", "7")], [ch("F", "6")]]
# 리프: (16분 칸, 화음 구성음 순번) 2마디 고정 리듬
RIFF = [(0, 0), (3, 2), (6, 1), (8, 3), (11, 2), (14, 4), (18, 1), (22, 3), (26, 0), (28, 2)]
BRIGHT = dict(bpm=120, A=A, B=B, intro=INTRO, outro=OUTRO, riff=RIFF, bass="root5",
              comp=(0, 3, 6, 8, 11, 14), kick=(0, 2), clave=True, gain={})


# ---------------- calm: 카페풍 아르페지오 ----------------
CAFE_EVEN = [(0, 0), (1, 1), (2, 2), (3, 3), (5, 2), (7, 1)]   # (8분 칸, 음 번호 또는 "app"=다음 화음으로 반음 아래 접근)
CAFE_ODD = [(0, 3), (2, 2), (3, 1), (4, 0), (7, "app")]
SWING = 0.62   # 8분음 한 쌍에서 앞 음이 차지하는 몫


def _voicing(chord):
    """근음은 베이스에 맡기고 3·5·7·9음을 A4~C6 안에서."""
    root, iv = chord
    xs = [x for x in iv if x != 0] if len(iv) >= 4 else iv
    return sorted({m for x in xs for m in range(69, 85) if m % 12 == (root + x) % 12})


def _soft_tri(f):
    t = np.arange(int(0.5 * SR)) / SR
    return (4 * np.abs((f * t) % 1 - 0.5) - 1) * np.minimum(1, t / 0.004) * np.exp(-t * 6)


def _cafe_arp(add, bt, chords, nxt, BEAT, bi):
    for slot, deg in (CAFE_EVEN if bi % 2 == 0 else CAFE_ODD):
        chord = chords[0] if slot < 4 or len(chords) == 1 else chords[-1]
        m = _voicing(nxt[0])[0] - 1 if deg == "app" else _voicing(chord)[deg % len(_voicing(chord))]
        add(bt + (slot // 2) * BEAT + (slot % 2) * SWING * BEAT, _soft_tri(midi_hz(m)) * 0.5225 * (0.85 if slot % 2 else 1.0))


CALM = dict(BRIGHT, bpm=100, riff=None, arp_fn=_cafe_arp, comp=(0, 6, 8, 14), clave=False,
            gain={"drum": 0.6, "arp": 0.8, "ep": 1.2},
            A=[[ch("F", "maj9")], [ch("D", "m9")], [ch("A#", "maj9")], [ch("C", "9")]] * 2,
            B=[[ch("A#", "maj9")], [ch("A", "m7")], [ch("G", "m9")], [ch("C", "sus4"), ch("C", "9")]] * 2,
            intro=[[ch("F", "maj9")], [ch("D", "m9")], [ch("A#", "maj9")], [ch("C", "9")]],
            outro=[[ch("A#", "maj9")], [ch("C", "9")], [ch("F", "maj9")], [ch("F", "maj9")]])

# ---------------- tense ----------------
TENSE = dict(BRIGHT, bass="drive", gain={"bass": 10 ** (-6 / 20), "ep": 10 ** (-3 / 20)}, finale=ch("F", ""),
             A=[[ch("D", "m")], [ch("D", "m")], [ch("A#", "maj7")], [ch("A", "7")]] * 2,
             B=[[ch("G", "m")], [ch("G", "m")], [ch("D#", "maj7")], [ch("A", "7b9")]] * 2,
             intro=[[ch("D", "m")], [ch("D", "m")], [ch("A#", "maj7")], [ch("A", "7")]],
             outro=[[ch("A#", "maj7")], [ch("C", "7")], [ch("F", "maj7")], [ch("F", "6")]])

# level: 곡마다 밀도가 달라 피크 정규화만으로는 체감 크기가 달라진다 → bright와 같은 RMS가 되게 곱하는 값(30초 본문으로 잼)
SONGS = {"bright": dict(BRIGHT, level=1.0), "calm": dict(CALM, level=0.98), "tense": dict(TENSE, level=1.374)}


def form(secs, s, BAR):
    """인트로·A·B·A·브레이크·B·A 다음, 길이가 모자라면 B·A를 더 돌리고 아웃트로."""
    A, B, INTRO, OUTRO = s["A"], s["B"], s["intro"], s["outro"]
    f = [("intro", INTRO, 0.6), ("A", A, 1.0), ("B", B, 1.0), ("A", A, 1.0), ("break", INTRO, 1.0),
         ("B", B, 1.0), ("A", A, 1.0)]
    while (sum(len(c) for _, c, _ in f) + len(OUTRO)) * BAR < secs:
        f += [("B", B, 1.0), ("A", A, 1.0)]
    return f + [("outro", OUTRO, 0.5)]


def song(secs, name="bright", end_at=None):
    """secs초 길이의 곡(피크 1.0 정규화, 끝 0.5초 페이드아웃). end_at: 엔딩 도장 장면 시작 시각 — 곡의 끝이 있는 곡(tense)만 쓴다."""
    s = SONGS[name]
    BAR = 4 * 60 / s["bpm"]
    if s.get("finale") and end_at is not None:
        v_end, Rm = 100 / s["bpm"], 2 * BAR                       # 마지막 두 마디 동안 속도 1 → 100 BPM(반코사인)
        speed = lambda x: 1 - (1 - v_end) * (1 - np.cos(np.pi * x)) / 2
        xs = np.linspace(0, 1, 2001)
        k = np.trapezoid(1 / speed(xs), xs)                       # 늦춘 두 마디가 실제로 걸리는 시간 / 원래 시간
        tb = np.floor((end_at - FINALE_LEAD - Rm * (k - 1)) / BAR) * BAR   # 마지막 화음의 악보 시각: 실제로 제때 떨어지는 마지막 첫 박
        a = tb - Rm

        def warp(t):
            if t <= a:
                return t
            x = np.linspace(0, min((t - a) / Rm, 1), 400)
            return a + Rm * np.trapezoid(1 / speed(x), x) + max(t - tb, 0) / v_end
        mix = _render(secs, s, form(secs, s, BAR), warp, tb)
        i0, i1 = int((end_at + FINALE_CUT - 0.4) * SR), int((end_at + FINALE_CUT) * SR)
        mix[i0:i1] *= np.linspace(1, 0, len(mix[i0:i1]))
        mix[i1:] = 0
    else:
        mix = _render(secs, s, form(secs, s, BAR))
    fade = min(int(0.5 * SR), len(mix))
    mix[len(mix) - fade:] *= np.linspace(1, 0, fade)
    return mix / (np.abs(mix).max() or 1)


def _render(secs, s, sections, warp=None, stop=None):
    """sections를 secs초까지 합성한 믹스(정규화 전). warp: 악보 시각 → 실제 시각, stop: 이 악보 시각부터 곡의 마지막 화음."""
    BEAT = 60 / s["bpm"]
    BAR = 4 * BEAT
    gain = {"arp": 1, "riff": 1, "ep": 1, "bass": 1, "drum": 1, **s["gain"]}
    rng = np.random.default_rng(16)
    total = sum(len(c) for _, c, _ in sections) * BAR + 2.0
    tr = {k: np.zeros(int(total * SR) + SR) for k in ("arp", "riff", "ep", "bass", "drum")}
    warp = warp or (lambda t: t)

    def add(name, t, w, final=False):
        if stop is not None and t >= stop - 1e-9 and not final:
            return
        i = int(warp(t) * SR)
        if i >= len(tr[name]):
            return
        tr[name][i:i + len(w)] += w[: len(tr[name]) - i]

    def adsr(n, a, d, s, r):
        e = np.full(n, float(s))
        na, nd, nr = int(a * SR), int(d * SR), min(int(r * SR), n)
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

    def fm_ep(f, dur, decay=2.2, rel=0.05):
        n = int(dur * SR)
        t = np.arange(n) / SR
        idx = 1.8 * np.exp(-t * 6) + 0.25
        return np.sin(2 * np.pi * f * t + idx * np.sin(2 * np.pi * f * t)) * np.exp(-t * decay) * adsr(n, 0.004, 0, 1, rel)

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

    def ep_tones(root, iv):
        for x in iv:
            m = 53 + (root - 5) % 12 + x
            while m > 66:
                m -= 12
            yield m

    t0 = 0.0
    for name, chart, drum in sections:
        sparse = name in ("intro", "break", "outro")
        for bi, chords in enumerate(chart):
            bt = t0 + bi * BAR
            for half, (root, iv) in enumerate(halves(chords)):
                ht = bt + half * 2 * BEAT
                if s["bass"] == "root5":
                    add("bass", ht, tri(midi_hz(41 + (root - 5) % 12), 0.75 * BEAT))           # 근음(1)
                    add("bass", ht + 1.5 * BEAT, tri(midi_hz(41 + (root + 2) % 12), 0.45 * BEAT))  # 5도(2&)
                else:                                                                       # drive: 8분음 근음 연타
                    for e in range(4):
                        add("bass", ht + e * BEAT / 2, tri(midi_hz(41 + (root - 5) % 12), 0.4 * BEAT))
                if sparse and bi % 2:
                    continue
                if s.get("arp_fn"):                                                         # 곡이 정한 아르페지오(마디 단위)
                    if half == 0:
                        s["arp_fn"](lambda t, w: add("arp", t, w), bt, chords, chart[(bi + 1) % len(chart)], BEAT, bi)
                else:                                                                       # 키치 아르페지오
                    tones = sorted({m for x in iv for m in range(72, 82) if m % 12 == (root + x) % 12})
                    pattern = tones + tones[-2:0:-1]
                    for k in range(8):
                        add("arp", ht + k * BEAT / 4, pulse(midi_hz(pattern[k % len(pattern)]), BEAT / 8, 0.125, False) * 0.07)
            for pos in s["comp"]:                                                           # FM 컴핑(2마디 패턴)
                if pos // 8 != bi % 2:
                    continue
                p = pos % 8
                root, iv = chords[0] if p < 4 or len(chords) == 1 else chords[-1]
                for m in ep_tones(root, iv):
                    add("ep", bt + p * BEAT / 2, fm_ep(midi_hz(m), 0.9 * BEAT) * 0.22)
            for k in s["kick"]:
                add("drum", bt + k * BEAT, kick() * 0.55 * drum)
            for e in range(8):
                add("drum", bt + e * BEAT / 2, shaker() * (0.035 if e % 2 else 0.018) * drum)
            for c in (((0, 3, 6) if bi % 2 == 0 else (2, 4)) if s["clave"] else ()):        # 클라베 3-2
                add("drum", bt + c * BEAT / 2, rim() * 0.16 * drum)
        if s["riff"] and name in ("A", "B"):                                                # 맨 위 리프
            for bi in range(0, len(chart), 2):
                for slot, deg in s["riff"]:
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

    if stop is not None:   # 곡의 마지막 화음: 위로 굴리는 아르페지오 + 길게 울리는 피아노 + 베이스 근음 + 리프 마지막 음 + 킥
        root, iv = s["finale"]
        for m in ep_tones(root, iv):
            add("ep", stop, fm_ep(midi_hz(m), 4.0, 0.9, 0.3) * 0.22, True)
        add("bass", stop, tri(midi_hz(41 + (root - 5) % 12), 3.5) * np.exp(-np.arange(int(3.5 * SR)) / SR * 0.8), True)
        for j, m in enumerate(sorted({m for x in iv for m in range(72, 90) if m % 12 == (root + x) % 12})):
            add("arp", stop + j * 0.05, pulse(midi_hz(m), 0.6, 0.125, False) * 0.07, True)
        add("riff", stop, pulse(midi_hz(77 + (root - 5) % 12), 1.2, 0.25, True) * 0.06, True)
        add("drum", stop, kick() * 0.55, True)

    def lp(x, fc):
        a = np.exp(-2 * np.pi * fc / SR)
        return lfilter([1 - a], [1, -a], x)

    mix = lp(tr["arp"], 4500) * gain["arp"] + lp(tr["riff"], 4000) * gain["riff"] + lp(tr["ep"], 4200) * gain["ep"] \
        + lp(tr["bass"], 1200) * 0.9 * gain["bass"] + lp(tr["drum"], 6000) * 0.8 * gain["drum"]
    return np.tanh(mix[: int(secs * SR)] * 1.4) / np.tanh(1.4)
