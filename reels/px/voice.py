"""시온 목소리(형식 2): 사용자가 녹음한 한국어 98음절(14 자음 × 7 모음)을 동물말처럼 빠르게 재생해 화면 진술을 '말한다'.
2026-11-12 사용자가 귀로 확정: 2.2배(높이·속도 함께), 초당 10음절, 어절 쉼 0.02~0.04초 무작위, 쉼표 0.18초, 문장 사이 0.3초.
읽기 규칙: 어절의 둘째 음절과 어절 끝이 살짝 오르고(서울말 강세구), 문장 안에서 어절마다 조금씩 내려간다.
문장 끝 음절은 1.5배 길고, 평서는 내리고 물음은 올리고 느낌은 높고 세게 끝난다.
녹음은 git 밖이다(사용자 결정): `REELS_VOICE_DIR`(없으면 reels/media/syl)의 `<음절>.wav` 98개. 없으면 실패한다 — 목소리 없이 몰래 렌더하지 않는다.
제작용: `python px/voice.py <편 폴더>`가 진술마다 말 길이와 표시 구간 여유를 보여 준다."""
import os
import re
import sys
import wave
from functools import lru_cache
from pathlib import Path

import numpy as np
from scipy.signal import butter, lfilter

if __package__ in (None, ""):                    # `python px/voice.py <편>`로 직접 돌릴 때(빌드 셸 규칙)
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from px.audio import SR, rms_db
else:
    from .audio import SR, rms_db

RATIO, RATE, DB = 2.2, 10.0, -30
GAP_WORD, GAP_COMMA, GAP_SENTENCE = (0.02, 0.04), 0.18, 0.3
MARGIN = 0.2                                     # 말이 끝난 뒤 다음 진술·표시 끝까지 남길 최소 여유(초)
CHO = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ"
RECORDED_CHO = "ㄱㄴㄷㄹㅁㅂㅅㅇㅈㅊㅋㅌㅍㅎ"
VOWELS = {"a": 0, "eo": 4, "o": 8, "u": 13, "eu": 18, "i": 20, "e": 5}      # 녹음한 모음 7개(중성 번호)
JUNG_END = ["a", "e", "a", "e", "eo", "e", "eo", "e", "o", "a", "e", "e", "o", "u", "eo", "e", "i", "u", "eu", "i", "i"]  # 이중모음은 끝 모음
PLAIN = {"ㄲ": "ㄱ", "ㄸ": "ㄷ", "ㅃ": "ㅂ", "ㅆ": "ㅅ", "ㅉ": "ㅈ"}           # 된소리는 예사소리 녹음으로
NAMES = [chr(0xAC00 + CHO.index(c) * 588 + v * 28) for c in RECORDED_CHO for v in (0, 4, 8, 13, 18, 20, 5)]


def voice_dir():
    return Path(os.environ.get("REELS_VOICE_DIR") or Path(__file__).resolve().parents[1] / "media" / "syl")


@lru_cache(maxsize=None)
def _sample(name):
    p = voice_dir() / f"{name}.wav"
    if not p.exists():
        raise FileNotFoundError(f"시온 목소리 녹음이 없다: {p} (REELS_VOICE_DIR, 98음절 필요)")
    with wave.open(str(p)) as w:
        y = np.frombuffer(w.readframes(w.getnframes()), np.int16) / 32768.0
    b, a = butter(2, 120 / (SR / 2), "highpass")                       # 녹음의 낮은 웅웅
    return lfilter(b, a, y)


def _units(word):
    """어절 → [(녹음 음절 이름)]. 한글이 아닌 글자·숫자는 '에'로 읽는다."""
    out = []
    for c in word:
        if '가' <= c <= '힣':
            code = ord(c) - 0xAC00
            cho = PLAIN.get(CHO[code // 588], CHO[code // 588])
            out.append(chr(0xAC00 + CHO.index(cho) * 588 + VOWELS[JUNG_END[(code // 28) % 21]] * 28))
        elif c.isalnum():
            out.append("에")
    return out


def _sentences(text):
    out = []
    for body, end in re.findall(r"([^.?!…]+)([.?!…]*)", text):
        words = []
        for w in body.replace(",", " , ").split():
            if w == ",":
                if words:
                    words[-1][1] = True
            elif _units(w):
                words.append([_units(w), False])
        if words:
            out.append((words, (end or ".")[0]))
    return out


def speak(text, seed=None):
    """text를 말한 배열(44.1kHz 모노). seed가 없으면 문장에서 정해져 같은 문장은 늘 같은 소리다."""
    if seed is None:
        seed = int.from_bytes(text.encode()[:8].ljust(8, b"\0"), "little") ^ len(text)
    rng = np.random.default_rng(seed)
    d, out = 1 / RATE, []

    def syl(name, pitch, length, gain):
        y = _sample(name)
        y = np.interp(np.arange(0, len(y) - 1, RATIO * pitch), np.arange(len(y)), y)
        y = y[np.argmax(np.abs(y) > np.abs(y).max() * 0.08):]          # 녹음 앞 무음은 버린다
        n = int(length * SR)
        y = y[:n] if len(y) >= n else np.concatenate([y, np.zeros(n - len(y))])
        f, r = int(0.006 * SR), max(int(0.006 * SR), n // 5)
        y[:f] *= np.linspace(0, 1, f)
        y[-r:] *= np.linspace(1, 0, r)
        return y * gain

    sents = _sentences(text)
    for si, (words, end) in enumerate(sents):
        decl = 1.0
        for wi, (us, comma) in enumerate(words):
            last_word = wi == len(words) - 1
            for k, name in enumerate(us):
                p = decl * (1 + (0.04 if k == 1 else 0.02 if 0 < k < len(us) - 1 else 0.0)) * (1 + rng.uniform(-0.02, 0.02))
                if k == len(us) - 1 and not last_word:
                    p *= 1.05
                length, gain = d, 1.0
                if last_word:
                    tail = len(us) - k
                    if end == "?":
                        p *= {1: 1.18, 2: 1.08}.get(tail, 1.0)
                    elif end == "!":
                        p *= {1: 1.10, 2: 1.04}.get(tail, 1.0)
                        gain = 1.25 if tail == 1 else 1.0
                    else:
                        p *= {1: 0.92, 2: 0.96}.get(tail, 1.0)
                    if tail == 1:
                        length = d * 1.5
                out.append(syl(name, p, length, gain))
            decl *= 0.985
            if not last_word:
                out.append(np.zeros(int((GAP_COMMA if comma else rng.uniform(*GAP_WORD)) * SR)))
        if si < len(sents) - 1:
            out.append(np.zeros(int(GAP_SENTENCE * SR)))
    if not out:
        return np.zeros(0)
    x = np.concatenate(out)
    return x * 10 ** ((DB - rms_db(x, True)) / 20)


def secs(text):
    return len(speak(text)) / SR


def plan(ep):
    """[(절대 시각, 문장, 말 길이, 여유)] — 훅 질문은 0.3초, 진술은 표시 시작에 말한다. 라벨은 말하지 않는다.
    여유 = (그 장면의 다음 진술 시작과 이 진술 표시 끝 중 이른 쪽) - 시작 - 말 길이."""
    statements = {s for sc in ep.nar["scenes"].values() for s in sc.get("screen_text", [])}
    rows = [(0.3, ep.nar["hook"], secs(ep.nar["hook"]), ep.scenes[0].length - 0.3 - secs(ep.nar["hook"]))]
    for T, off in zip(ep.scenes, ep.starts):
        said = sorted((a, b, t) for t, a, b in getattr(T, "texts", ()) if t in statements)
        for k, (a, b, t) in enumerate(said):
            nxt = said[k + 1][0] if k + 1 < len(said) else T.length
            s = secs(t)
            rows.append((off + a, t, s, min(b, nxt) - a - s))
    return rows


if __name__ == "__main__":
    sys.path.insert(0, str(Path(sys.argv[1]).resolve()))
    sys.argv = sys.argv[:1]
    import scene  # noqa: E402  편 폴더의 scene.py가 만든 Episode(ep)
    for t0, text, s, room in plan(scene.ep):
        print(f"{'OK  ' if room >= MARGIN else 'OVER'} {t0:6.2f}s 말 {s:4.2f}s 여유 {room:5.2f}s  {text}")
