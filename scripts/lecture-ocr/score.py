"""predictions.txt(`파일 | 글`)를 시험지 정답과 채점한다."""
import argparse
import json
from pathlib import Path

from common import LEAK_PHRASES, OCR_HOME, TEST_ROWS, cer, norm, route

ap = argparse.ArgumentParser()
ap.add_argument("preds", nargs="+")
ap.add_argument("--test-dir", default=None, help="시험지 labels.json 폴더(기본 $OCR_HOME/test)")
ap.add_argument("--fold", action="store_true", help="l·1·I·| 묶음 접기")
ap.add_argument("--exclude-leaked", action="store_true")
a = ap.parse_args()

labels = json.loads((Path(a.test_dir).expanduser() if a.test_dir else OCR_HOME / "test") .joinpath("labels.json").read_text(encoding="utf-8"))
truth = {r["file"]: r for r in labels}
if a.exclude_leaked:
    # 학습 표본 라벨에 실제로 들어간 구절만 제외에 쓴다
    train_text = norm("".join(r["label"] for r in json.loads((OCR_HOME / "samples.json").read_text(encoding="utf-8"))[TEST_ROWS:]))
    leak = [norm(p) for p in LEAK_PHRASES if norm(p) in train_text]
    truth = {k: r for k, r in truth.items() if not any(p in norm(r["label"]) for p in leak)}

for path in a.preds:
    got = {}
    for line in Path(path).read_text(encoding="utf-8").splitlines():
        f, _, t = line.partition(" | ")
        got[f] = t
    rows = [(got.get(f, ""), r) for f, r in truth.items()]
    pairs = [(p, r["label"]) for p, r in rows]
    exact = sum(norm(p) == norm(r["label"]) for p, r in rows)
    path_ok = sum(route(p) == route(r["label"]) for p, r in rows)
    print(f"{path}: {len(rows)}줄 CER {cer(pairs, a.fold):.3f} / 문장 일치 {exact} / 경로 일치 {path_ok}")
    for g in "qfncme":
        sub = [(p, r["label"]) for p, r in rows if str(r["promptId"])[:1] == g]
        if sub:
            print(f"  {g}: {len(sub)}줄 CER {cer(sub, a.fold):.3f}")
