"""(실행 금지 지시) 시험지 이미지를 OpenAI Responses API로 옮겨 적게 한다. 힌트 파일이 있으면 붙인다."""
import argparse
import base64
import json
import re
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from common import OCR_HOME, env_value

PROMPT = ("이 이미지는 사용자가 Apple Pencil로 쓴 손글씨 한 줄이다. 사용자는 대학 공학(동역학) 수업을 듣는다. "
          "적힌 내용을 한 줄 텍스트로 그대로 옮겨라. 첫 글자가 `?`나 `ㄴ`이면 그대로 쓴다. "
          "수식은 평문 기호(√, ², θ, ∫, ω, ₂)로 쓴다. 답하거나 설명하지 말고 옮긴 글만 출력한다.")
HINT = "\nOCR이 읽은 후보(틀릴 수 있다. `?`를 7로, `ㄴ`을 L이나 [로 읽기 쉽다): "

ap = argparse.ArgumentParser()
ap.add_argument("--test-dir", default=str(OCR_HOME / "test"))
ap.add_argument("--hint", default=None, help="predictions.txt")
ap.add_argument("--out", required=True)
ap.add_argument("--model", default="gpt-6-luna")
a = ap.parse_args()
key = env_value("OPENAI_API_KEY")
test = Path(a.test_dir).expanduser()
files = [r["file"] for r in json.loads((test / "labels.json").read_text(encoding="utf-8"))]
hints = {}
if a.hint:
    for line in Path(a.hint).read_text(encoding="utf-8").splitlines():
        f, _, t = line.partition(" | ")
        hints[f] = t


def call(f):
    text = PROMPT + (HINT + hints[f] if hints.get(f) else "")
    img = base64.b64encode((test / f).read_bytes()).decode()
    body = json.dumps({
        "model": a.model, "store": False, "max_output_tokens": 4096, "reasoning": {"effort": "medium"},
        "input": [{"role": "user", "content": [
            {"type": "input_text", "text": text},
            {"type": "input_image", "image_url": f"data:image/png;base64,{img}", "detail": "high"}]}],
    }).encode()
    for attempt in range(2):  # 실패 시 1회 재시도
        try:
            req = urllib.request.Request("https://api.openai.com/v1/responses", body, {
                "Content-Type": "application/json", "Authorization": f"Bearer {key}"})
            data = json.load(urllib.request.urlopen(req, timeout=300))
            out = "".join(c.get("text", "") for o in data.get("output", []) if o.get("type") == "message"
                          for c in o.get("content", []))
            return f, re.sub(r"\s*\n\s*", " ", out).strip()
        except Exception as e:  # 키는 출력하지 않는다
            err = type(e).__name__
    return f, f"[실패:{err}]"


with ThreadPoolExecutor(4) as ex:
    res = list(ex.map(call, files))
Path(a.out).expanduser().write_text("".join(f"{f} | {t}\n" for f, t in res), encoding="utf-8")
print(f"{len(res)}줄 -> {a.out}")
