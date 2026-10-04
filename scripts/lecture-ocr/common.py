"""포스트잇 OCR 도구 공용 함수. 표준 라이브러리만 쓴다."""
import os
import re
import unicodedata
from pathlib import Path

OCR_HOME = Path(os.environ.get("OCR_HOME", "~/galpi-ocr")).expanduser()
REPO = Path(__file__).resolve().parents[2]
TEST_ROWS = 140  # id 순서 처음 140행 = 1회차 시험지(평가 전용)

# 시험지 문장에 통째로 든 구절. 학습 표본 라벨에 실제로 들어간 것만 제외에 쓴다.
LEAK_PHRASES = ["F = ma", "p = mv", "ω = v/r", "F = -kx", "I = ∫r² dm", "k = 200 N/m",
                "tan θ = μ", "√(x² + y²)", "d²x/dt²", "시험에 나올 듯", "부호 조심",
                "다시 풀기", "공식 외우기", "그림 다시"]


def env_value(key, path=None):
    """저장소 .env에서 키 하나만 읽는다. 다른 줄은 보지 않는다."""
    path = Path(path) if path else REPO / ".env"
    for line in path.read_text(encoding="utf-8").splitlines():
        m = re.match(r"\s*(?:export\s+)?" + re.escape(key) + r"\s*=\s*(.*)$", line)
        if m:
            return m.group(1).strip().strip("'\"")
    return None


def norm(s):
    return re.sub(r"\s+", "", unicodedata.normalize("NFC", s or ""))


def fold(s):
    """l·1·I·| 를 한 글자로 접는다."""
    return re.sub(r"[l1I|]", "l", s)


def edit_distance(a, b):
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


def line_errors(pred, truth):
    """정규화 후 편집 거리. 한 줄 오류는 그 줄 정답 길이에서 자른다."""
    t = norm(truth)
    return min(edit_distance(norm(pred), t), len(t)), len(t)


def cer(pairs, folded=False):
    err = tot = 0
    for pred, truth in pairs:
        if folded:
            pred, truth = fold(norm(pred)), fold(norm(truth))
        e, n = line_errors(pred, truth)
        err += e
        tot += n
    return err / tot if tot else 0.0


def route(text):
    t = (text or "").lstrip()
    if t[:1] in ("?", "？"):
        return "?"
    return "ㄴ" if t[:1] == "ㄴ" else "other"
