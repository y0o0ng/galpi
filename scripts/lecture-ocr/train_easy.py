"""EasyOCR 한국어 인식기(VGG-BiLSTM-CTC)를 사용자 필체로 파인튜닝한다."""
import argparse
import json
import random
import unicodedata
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
from easyocr import Reader
from easyocr.utils import CTCLabelConverter
from PIL import Image

from common import OCR_HOME, cer, norm

H = 64

ap = argparse.ArgumentParser()
ap.add_argument("--train-dir", required=True)
ap.add_argument("--test-dir", required=True)
ap.add_argument("--limit", type=int, default=0, help="학습 원본 줄 수(id 순서 앞에서, 0=전부)")
ap.add_argument("--epochs", type=int, default=3)
ap.add_argument("--name", required=True)
ap.add_argument("--units", choices=["syllable", "jamo"], default="syllable")
ap.add_argument("--lr", type=float, default=3e-4)
ap.add_argument("--pretrain-dir", default=None, help="합성 줄 폴더(synth.py 출력)")
ap.add_argument("--pretrain-epochs", type=int, default=0)
a = ap.parse_args()

torch.manual_seed(0)
random.seed(0)


def load(d):
    d = Path(d).expanduser()
    return d, json.loads((d / "labels.json").read_text(encoding="utf-8"))


tr_dir, tr = load(a.train_dir)
te_dir, te = load(a.test_dir)
if a.limit:
    ids = list(dict.fromkeys(r["id"] for r in tr))[:a.limit]  # labels.json 은 id 순서
    tr = [r for r in tr if r["id"] in set(ids)]
pre_dir, pre = load(a.pretrain_dir) if a.pretrain_dir and a.pretrain_epochs else (None, [])
for r in tr + te + pre:
    r["text"] = norm(r["label"])
    if a.units == "jamo":
        r["text"] = unicodedata.normalize("NFD", r["text"])

reader = Reader(["ko", "en"], gpu=False, verbose=False, quantize=False)
model = reader.recognizer
model = model.module if hasattr(model, "module") else model
base = reader.character
if a.units == "jamo":  # 한글 음절은 빼고 자모로 쓴다
    kept = "".join(c for c in base if not "\uac00" <= c <= "\ud7a3")
else:
    kept = base
new = sorted({c for r in tr + te + pre for c in r["text"]} - set(kept))
character = kept + "".join(new)
old = model.Prediction
pred = nn.Linear(old.in_features, len(character) + 1)
with torch.no_grad():
    pred.weight[0] = old.weight[0]
    pred.bias[0] = old.bias[0]
    pos = {c: i + 1 for i, c in enumerate(base)}  # 0 = blank
    for i, c in enumerate(kept):
        pred.weight[i + 1] = old.weight[pos[c]]
        pred.bias[i + 1] = old.bias[pos[c]]
model.Prediction = pred
conv = CTCLabelConverter(character, {}, {})
print(f"글자 {len(kept)}/{len(base)} + 새 글자 {len(new)}: {''.join(new)}")


def tensor(path):
    im = Image.open(path).convert("L")
    w = min(max(int(im.width * H / im.height), 1), 1000)
    x = np.asarray(im.resize((w, H), Image.BICUBIC), dtype=np.float32)
    return torch.from_numpy((x / 255 - 0.5) / 0.5)


def batch(d, rows):
    xs = [tensor(d / r["file"]) for r in rows]
    out = torch.ones(len(xs), 1, H, max(x.shape[1] for x in xs))  # 오른쪽은 흰색 1.0
    for i, x in enumerate(xs):
        out[i, 0, :, :x.shape[1]] = x
    return out


def evaluate():
    model.eval()
    preds = []
    with torch.no_grad():
        for i in range(0, len(te), 16):
            rows = te[i:i + 16]
            out = model(batch(te_dir, rows), None)
            idx = out.argmax(2).numpy()
            for r, row in zip(rows, idx):
                preds.append(unicodedata.normalize("NFC", conv.decode_greedy(row, [len(row)])[0]))
    return preds


def report(tag):
    p = evaluate()
    pairs = [(x, r["label"]) for x, r in zip(p, te)]
    print(f"{tag}: 시험지 CER {cer(pairs):.3f} / 묶음 {cer(pairs, True):.3f}", flush=True)
    return p, cer(pairs), cer(pairs, True)


log = []
_, c0, f0 = report("학습 전")
log.append({"stage": "start", "epoch": 0, "cer": c0, "cerFold": f0})
opt = torch.optim.Adam(model.parameters(), lr=a.lr)
ctc = nn.CTCLoss(blank=0, zero_infinity=True)
preds = None


def stage(rows, d, epochs, name):
    global preds
    for ep in range(1, epochs + 1):
        model.train()
        random.shuffle(rows)
        total = 0.0
        for i in range(0, len(rows), 16):
            b = rows[i:i + 16]
            x = batch(d, b)
            target, tlen = conv.encode([r["text"] for r in b])
            out = model(x, None).log_softmax(2).permute(1, 0, 2)  # T,B,C
            loss = ctc(out, target, torch.full((len(b),), out.size(0), dtype=torch.int32), tlen)
            opt.zero_grad()
            loss.backward()
            nn.utils.clip_grad_norm_(model.parameters(), 5)
            opt.step()
            total += loss.item() * len(b)
        preds, c, f = report(f"{name} 에폭 {ep} (손실 {total / max(len(rows), 1):.3f})")
        log.append({"stage": name, "epoch": ep, "loss": total / max(len(rows), 1), "cer": c, "cerFold": f})


stage(pre, pre_dir, a.pretrain_epochs if pre else 0, "pretrain")
stage(tr, tr_dir, a.epochs, "finetune")

run = OCR_HOME / "runs" / a.name
run.mkdir(parents=True, exist_ok=True)
(run / "log.json").write_text(json.dumps(log, ensure_ascii=False, indent=1), encoding="utf-8")
preds = preds if preds is not None else evaluate()
(run / "predictions.txt").write_text(
    "".join(f"{r['file']} | {p}\n" for r, p in zip(te, preds)), encoding="utf-8")
torch.save({"state_dict": model.state_dict(), "character": character}, run / "model.pt")
print(f"저장: {run}")
