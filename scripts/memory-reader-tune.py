#!/usr/bin/env python3
"""First-stage reader LoRA tuning: train / predict / score / selftest (Qwen3.5 4B, Extractor recipe).

Preregistration: docs/Memory research/xion-memory-research-docs/memory-storage-routing-design.md
("First-stage reader - preregistration"). Reuses scripts/memory-extractor-tune.py (training loop, checkpointing,
model loading) with DATA pointed at reader-tuning/data. Run with the private train-env python,
HF_HUB_OFFLINE=1, nice -n 19.
Private rule: never print conversation text, anchors or labels per item. Only aggregates and itemIds are printed.
"""
import argparse
import importlib.util
import json
import os
import sys

os.environ.setdefault("HF_HUB_OFFLINE", "1")

HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location("extractor_tune", f"{HERE}/memory-extractor-tune.py")
E = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(E)
E.DATA = f"{E.ROOT}/reader-tuning/data"
E.MAX_NEW = 8

CLASSES = ["general_fact", "DEFERRED", "project"]
MIN_OVERALL, MIN_RECALL = 0.85, 0.75


def parse_label(raw):
    s = raw.strip()
    return s if s in CLASSES else None


def cmd_train(a):
    a.model = "4b"
    a.offload_activations = False
    E.cmd_train(a)


def cmd_predict(a):
    import torch
    fold = E.parse_fold(a.fold)
    rows = E.load_split(a.split, fold=fold if isinstance(fold, int) else None)
    if a.limit:
        rows = rows[:a.limit]
    tok, model = E.load_model("4b", adapter=a.adapter)
    model.eval()
    counts = {}
    with open(a.out, "w", encoding="utf-8") as f:
        for r in rows:
            prompt = E.chat_ids(tok, r["messages"][:2], True)
            x = tok(prompt, add_special_tokens=False, return_tensors="pt").input_ids.to("cuda:0")
            with torch.no_grad():
                out = model.generate(input_ids=x, max_new_tokens=E.MAX_NEW, do_sample=False,
                                     pad_token_id=tok.pad_token_id or tok.eos_token_id)
            raw = tok.decode(out[0, x.shape[1]:], skip_special_tokens=True)
            label = parse_label(raw)
            counts[str(label)] = counts.get(str(label), 0) + 1
            f.write(json.dumps({"itemId": r["itemId"], "raw": raw, "label": label}, ensure_ascii=False) + "\n")
            f.flush()
    print(json.dumps({"items": len(rows), "parsedLabels": counts}))


def score_rows(gold, preds, split):
    """gold: itemId -> class; preds: itemId -> label or None. Aggregates only."""
    cols = CLASSES + [None]
    conf = {g: {str(p): 0 for p in cols} for g in CLASSES}
    for i, g in gold.items():
        conf[g][str(preds.get(i))] += 1
    n = len(gold)
    correct = sum(conf[g][g] for g in CLASSES)
    recall = {g: (conf[g][g] / sum(conf[g].values()) if sum(conf[g].values()) else None) for g in CLASSES}
    res = {"split": split, "items": n, "correct": correct, "accuracy": round(correct / n, 4) if n else None,
           "recall": {g: (round(v, 4) if v is not None else None) for g, v in recall.items()},
           "support": {g: sum(conf[g].values()) for g in CLASSES}, "confusion": conf}
    if split == "train":
        res["pass"] = bool(n and correct / n >= MIN_OVERALL and all(v is not None and v >= MIN_RECALL for v in recall.values()))
    return res


def cmd_score(a):
    rows = E.load_split(a.split)
    preds = {}
    for path in a.pred.split(","):
        for l in open(path, encoding="utf-8"):
            if l.strip():
                d = json.loads(l)
                preds[d["itemId"]] = d["label"]
    gold = {r["itemId"]: r["label"] for r in rows}
    missing = [i for i in gold if i not in preds]
    if missing and a.split == "train" and len(a.pred.split(",")) > 1:
        raise SystemExit(f"MISSING_PREDICTIONS {len(missing)}")
    if missing:
        gold = {i: g for i, g in gold.items() if i in preds}
    res = score_rows(gold, preds, a.split)
    json.dump(res, open(a.out, "w"), indent=1)
    print(json.dumps(res))


def cmd_selftest(_):
    fails = 0

    def check(name, ok):
        nonlocal fails
        fails += not ok
        print(("PASS " if ok else "FAIL ") + name)

    check("parse exact", parse_label("project") == "project" and parse_label(" DEFERRED\n") == "DEFERRED")
    check("parse rejects", parse_label("Project") is None and parse_label("project.") is None
          and parse_label("project general_fact") is None and parse_label("") is None)

    def mk(n_gf, n_df, n_pj, wrong):
        gold, preds, k = {}, {}, 0
        for cls, n in (("general_fact", n_gf), ("DEFERRED", n_df), ("project", n_pj)):
            for j in range(n):
                k += 1
                gold[str(k)] = cls
                preds[str(k)] = cls
        for i, p in wrong:
            preds[i] = p
        return gold, preds

    # 100 items: 30/30/40. 15 wrong overall -> exactly 0.85 accuracy.
    g, p = mk(30, 30, 40, [(str(i), "project") for i in range(1, 6)] + [(str(i), "general_fact") for i in range(31, 36)]
              + [(str(i), "DEFERRED") for i in range(61, 66)])
    r = score_rows(g, p, "train")
    check("pass at exactly 0.85 overall", r["accuracy"] == 0.85 and r["pass"] is True)
    g, p = mk(30, 30, 40, [(str(i), "project") for i in range(1, 6)] + [(str(i), "general_fact") for i in range(31, 36)]
              + [(str(i), "DEFERRED") for i in range(61, 67)])
    check("fail just under 0.85", score_rows(g, p, "train")["pass"] is False)
    # recall boundary: DEFERRED recall exactly 0.75 (8 of 32 wrong would break); use 40/40/20, DEFERRED 10 wrong of 40 = 0.75
    g, p = mk(40, 40, 20, [(str(i), None) for i in range(41, 51)])
    r = score_rows(g, p, "train")
    check("class recall exactly 0.75 with accuracy 0.90 passes", r["recall"]["DEFERRED"] == 0.75 and r["accuracy"] == 0.9 and r["pass"] is True)
    g, p = mk(40, 40, 20, [(str(i), None) for i in range(41, 52)])
    r = score_rows(g, p, "train")
    check("class recall under 0.75 fails despite accuracy 0.89", r["recall"]["DEFERRED"] < 0.75 and r["accuracy"] >= 0.85 and r["pass"] is False)
    check("null counted in confusion", r["confusion"]["DEFERRED"]["None"] == 11)
    g, p = mk(1, 1, 1, [])
    check("eval has no pass field", "pass" not in score_rows(g, p, "eval"))
    print(json.dumps({"selftestFailures": fails}))
    sys.exit(1 if fails else 0)


def main():
    ap = argparse.ArgumentParser()
    sp = ap.add_subparsers(dest="cmd", required=True)
    p = sp.add_parser("train"); p.add_argument("--fold", required=True, help="0..4 or all"); p.add_argument("--out", required=True)
    p.add_argument("--max-steps", type=int, default=0, help="debug only")
    p.add_argument("--checkpoint-every", type=int, default=0); p.set_defaults(f=cmd_train)
    p = sp.add_parser("predict"); p.add_argument("--adapter", default="none")
    p.add_argument("--split", choices=["train", "eval"], required=True); p.add_argument("--fold"); p.add_argument("--out", required=True)
    p.add_argument("--limit", type=int, default=0, help=argparse.SUPPRESS); p.set_defaults(f=cmd_predict)
    p = sp.add_parser("score"); p.add_argument("--pred", required=True); p.add_argument("--split", choices=["train", "eval"], required=True)
    p.add_argument("--out", required=True); p.set_defaults(f=cmd_score)
    p = sp.add_parser("selftest"); p.set_defaults(f=cmd_selftest)
    a = ap.parse_args()
    a.f(a)


if __name__ == "__main__":
    main()
