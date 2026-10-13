"""claims.json ↔ narration.ko.json 대조: 문장 순서·글자 일치, 사실 행 번호 존재, 훅·원리 글자 일치."""
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).parent
nar = json.loads((HERE / "narration.ko.json").read_text())
claims = json.loads((HERE / "claims.json").read_text())
facts = {"1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "G1"}
bad = []
expected = [(sid, s) for sid, ss in nar["scenes"].items() for s in ss]
got = [(c["scene"], c["text"]) for c in claims["sentences"]]
if expected != got:
    bad.append("sentences가 narration의 장면·문장 순서·글자와 다르다")
for c in claims["sentences"]:
    if c["kind"] == "fact" and not c["facts"]:
        bad.append(f"fact인데 facts가 비었다: {c['text']}")
    bad += [f"없는 행 번호 {f}: {c['text']}" for f in c["facts"] if f not in facts]
if claims["hook"]["title"] != nar["hook"]["title"] or claims["hook"]["sub"] != nar["hook"]["sub"]:
    bad.append("hook 글자가 다르다")
if claims["principle"]["lines"] != nar["principle"] or claims["principle"]["label"] != nar["principle_label"]:
    bad.append("principle 글자가 다르다")
scene_src = (HERE / "scene.py").read_text() + (HERE / "art.py").read_text()
shown = set(re.findall(r'"((?:[A-Z?][A-Z0-9 \-?=.]*|-?\d[\d.]* cm/s|n = 25))"', scene_src))
listed = {x["text"] for x in claims["screen_text"]}
bad += [f"screen_text에 없는 화면 글자: {s}" for s in sorted(shown - listed) if s not in {"RGBA", "RGB", "L", "A"}]
print("OK" if not bad else "\n".join(bad))
sys.exit(1 if bad else 0)
