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
READ_RATE = 7.0                                  # 읽기 하한: 초당 7음절(사용자 2026-11-12, 첫 편을 보고 조정)
TAIL = 0.5                                       # 말·읽기가 끝난 뒤 바로 넘어가지 않고 남기는 여유(사용자 2026-11-12)
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


DIGIT = "영일이삼사오육칠팔구"
NATIVE_ONES = ["", "한", "두", "세", "네", "다섯", "여섯", "일곱", "여덟", "아홉"]
NATIVE_TENS = ["", "열", "스물", "서른", "마흔", "쉰", "예순", "일흔", "여든", "아흔"]
COUNTERS = ("시간", "마리", "사람", "가지", "군데", "그루", "송이", "켤레", "대", "개", "명", "번", "살", "시", "장", "잔", "달", "권", "척", "벌", "채", "줄", "칸", "곳", "통", "판", "알", "쌍")
SINO_BEFORE = ("개월", "번지", "번호", "시즌", "장면", "대역")   # 고유어 단위로 시작하지만 한자어로 읽는 말
UNITS = {"km": "킬로미터", "cm": "센티미터", "mm": "밀리미터", "nm": "나노미터", "kg": "킬로그램", "mg": "밀리그램",
         "GB": "기가바이트", "MB": "메가바이트", "TB": "테라바이트", "KB": "킬로바이트", "Hz": "헤르츠", "kHz": "킬로헤르츠",
         "MHz": "메가헤르츠", "GHz": "기가헤르츠", "kW": "킬로와트", "kWh": "킬로와트시", "ms": "밀리초", "dB": "데시벨"}
AFTER_NUMBER = {"m": "미터", "g": "그램", "t": "톤", "W": "와트", "V": "볼트", "A": "암페어", "L": "리터", "s": "초", "K": "케이"}
SYMBOLS = {"%": "퍼센트", "℃": "도", "°C": "도", "°": "도"}
LETTERS = dict(zip("ABCDEFGHIJKLMNOPQRSTUVWXYZ", "에이 비 씨 디 이 에프 지 에이치 아이 제이 케이 엘 엠 엔 오 피 큐 알 에스 티 유 브이 더블유 엑스 와이 지".split()))
EN_CHO = dict(zip("bcdfghjklmnpqrstvwxz", "ㅂㅋㄷㅍㄱㅎㅈㅋㄹㅁㄴㅍㅋㄹㅅㅌㅂㅇㅅㅈ"))
EN_VOWEL = {"a": 0, "e": 5, "i": 20, "o": 8, "u": 4, "y": 20}               # 첫 모음 글자 → 녹음 모음(중성 번호)


def _sino(n):
    """정수 → 한자어 읽기(1980 → 천구백팔십). 십·백·천과 단독 만 앞의 일은 읽지 않는다."""
    if n == 0:
        return "영"
    out, big = "", ["", "만", "억", "조", "경"]
    for g in range(len(big) - 1, -1, -1):
        part = (n // 10 ** (4 * g)) % 10000
        if not part:
            continue
        s = ""
        for i, unit in ((3, "천"), (2, "백"), (1, "십"), (0, "")):
            d = part // 10 ** i % 10
            if d:
                s += ("" if d == 1 and unit else DIGIT[d]) + unit
        out += ("" if s == "일" and g == 1 else s) + big[g]
    return out


def _number(m):
    raw, after = m.group(1).replace(",", ""), m.string[m.end():]
    word = after.lstrip(" ")
    if "." not in raw and 0 < int(raw) < 100 and not word.startswith(SINO_BEFORE):
        if word.startswith("번째"):
            return "첫 " if raw == "1" else NATIVE_TENS[int(raw) // 10] + NATIVE_ONES[int(raw) % 10] + " "
        if word.startswith(COUNTERS):
            n = int(raw)
            tens, ones = NATIVE_TENS[n // 10], NATIVE_ONES[n % 10]
            return ("스무" if n == 20 else tens + ones) + " "
    whole, _, frac = raw.partition(".")
    return _sino(int(whole)) + ("점" + "".join(DIGIT[int(d)] for d in frac) if frac else "")


def _english(m):
    w = m.group(0)
    if w in UNITS:
        return UNITS[w]
    if w in AFTER_NUMBER and re.search(r"\d\s?$", m.string[:m.start()]):
        return AFTER_NUMBER[w]
    if w.isupper() or len(w) == 1:                       # 약어·한 글자는 알파벳 이름(SNR → 에스엔알)
        return "".join(LETTERS[c] for c in w.upper())
    w = w.lower()                                        # 그 밖의 낱말은 모음 덩어리마다 한 음절(동물말이라 음절 수와 모음 모양만 맞춘다)
    if len(w) > 3 and w.endswith("e") and w[-2] not in "aeiouy":
        w = w[:-1]
    w = re.sub(r"(.)\1", r"\1", re.sub(r"ph|th|ch|sh|ck|ng$", lambda d: {"ph": "f", "th": "s", "ch": "ㅊ", "sh": "s", "ck": "k", "ng": ""}[d.group(0)], w))
    syl = lambda cho, v: chr(0xAC00 + CHO.index(cho) * 588 + v * 28)
    out, cho = "", "ㅇ"
    for c in re.findall(r"[aeiouy]+|[^aeiouy]+", w):
        if c[0] in EN_VOWEL:
            out += syl(cho, EN_VOWEL[c[0]])
            cho = "ㅇ"
        else:                                            # 자음 덩어리: 마지막 자음만 다음 모음에 붙고 앞 자음은 '으' 음절(str → 스트)
            chos = [c_ if c_ in CHO else EN_CHO.get(c_, "ㅇ") for c_ in c]
            out += "".join(syl(x, 18) for x in chos[:-1] if x != "ㅇ")
            cho = chos[-1]
    if cho != "ㅇ":                                     # 자음으로 끝나면 '으' 한 음절
        out += syl(cho, 18)
    return out


def read_aloud(text):
    """소리로 읽을 글만 한글 발음으로 바꾼다(화면 글자는 그대로): 숫자·단위·기호·영어."""
    for k, v in SYMBOLS.items():
        text = text.replace(k, v)
    text = re.sub(r"[A-Za-z]+", _english, text)
    return re.sub(r"(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)(?: (?=[가-힣]))?", _number, text)


def _units(word):
    """어절 → [(녹음 음절 이름)]. read_aloud를 거친 한글만 읽고 남은 글자는 건너뛴다."""
    out = []
    for c in word:
        if '가' <= c <= '힣':
            code = ord(c) - 0xAC00
            cho = PLAIN.get(CHO[code // 588], CHO[code // 588])
            out.append(chr(0xAC00 + CHO.index(cho) * 588 + VOWELS[JUNG_END[(code // 28) % 21]] * 28))
    return out


def _sentences(text):
    out, text = [], read_aloud(text)
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


def need(text):
    """진술이 화면에 머물러야 하는 최소 시간 = max(말 길이, 읽기 하한) + TAIL."""
    n = sum(1 for c in read_aloud(text) if '가' <= c <= '힣')
    return max(secs(text), n / READ_RATE) + TAIL


def plan(ep):
    """[(절대 시각, 문장, 말 길이, 여유)] — 훅 질문은 0.3초, 진술(screen_text)은 표시 시작에 말한다. 수치(numbers)·라벨은 말하지 않는다.
    여유 = (그 장면의 다음 진술 시작과 이 진술 표시 끝 중 이른 쪽) - 시작 - need(문장). 0 이상이어야 한다."""
    statements = {s for sc in ep.nar["scenes"].values() for s in sc.get("screen_text", [])}
    rows = [(0.3, ep.nar["hook"], secs(ep.nar["hook"]), ep.scenes[0].length - 0.3 - need(ep.nar["hook"]))]
    for T, off in zip(ep.scenes, ep.starts):
        said = sorted((a, b, t) for t, a, b in getattr(T, "texts", ()) if t in statements)
        for k, (a, b, t) in enumerate(said):
            nxt = said[k + 1][0] if k + 1 < len(said) else T.length
            rows.append((off + a, t, secs(t), min(b, nxt) - a - need(t)))
    return rows


def timing(final_md):
    """확정 대본(final.md)의 훅과 진술마다 {text, voice, need} — 서버가 빌드 전에 만들어 빌드에 넘긴다."""
    from px.textfit import screen_texts
    import re as _re
    hook = _re.search(r"hook_words`?\**\s*[:：]\s*((?:`[^`]+`\s*/?\s*)+)", final_md)   # "- `hook_words`: `a` / `b`" — 이은 것이 훅 질문(계약)
    texts = [s for k, s in screen_texts(final_md) if k == "statement"]
    if hook:
        texts = [" ".join(_re.findall(r"`([^`]+)`", hook.group(1)))] + texts
    return [{"text": t, "voice": round(secs(t), 2), "need": round(need(t), 2)} for t in dict.fromkeys(texts)]


if __name__ == "__main__":
    if sys.argv[1] == "--final":                 # python px/voice.py --final final.md --out voice_timing.json
        import json
        rows = timing(Path(sys.argv[2]).read_text())
        Path(sys.argv[4]).write_text(json.dumps(rows, ensure_ascii=False, indent=1))
        print(f"{len(rows)} lines, longest need {max((r['need'] for r in rows), default=0)}s")
        sys.exit(0)
    sys.path.insert(0, str(Path(sys.argv[1]).resolve()))
    sys.argv = sys.argv[:1]
    import scene  # noqa: E402  편 폴더의 scene.py가 만든 Episode(ep)
    for t0, text, s, room in plan(scene.ep):
        print(f"{'OK  ' if room >= 0 else 'OVER'} {t0:6.2f}s 말 {s:4.2f}s 여유 {room:5.2f}s  {text}")
