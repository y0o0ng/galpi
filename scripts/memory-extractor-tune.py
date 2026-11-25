#!/usr/bin/env python3
"""Extractor LoRA tuning: probe / train / predict / score / selftest.

Preregistration: docs/Memory research/xion-memory-research-docs/memory-storage-routing-design.md
("Extractor tuning - preregistration"). Run with the private train-env python, HF_HUB_OFFLINE=1, nice -n 19.
Private rule: never print conversation text, anchors or values. Only aggregates and itemIds are printed.
"""
import argparse
import json
import math
import os
import random
import sys
import time

os.environ.setdefault("HF_HUB_OFFLINE", "1")

ROOT = "/home/rnlcksgxk/projects/galpi-private"
DATA = f"{ROOT}/extractor-tuning/data"
MODELS = {"4b": f"{ROOT}/models/Qwen3.5-4B", "9b": f"{ROOT}/models/Qwen3.5-9B"}
SEED = 20261125
LORA = dict(r=16, lora_alpha=32, lora_dropout=0.05)
LR, EPOCHS, ACCUM, MAX_NEW = 1e-4, 3, 8, 1024
LORA_LEAVES = ["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj",
               "in_proj_qkv", "in_proj_z", "in_proj_a", "in_proj_b", "out_proj"]


# --------------------------------------------------------------------------- data
def load_split(split, fold=None, exclude_fold=None):
    rows = [json.loads(l) for l in open(f"{DATA}/{split}.jsonl", encoding="utf-8") if l.strip()]
    if fold is not None:
        rows = [r for r in rows if r.get("fold") == fold]
    if exclude_fold is not None:
        rows = [r for r in rows if r.get("fold") != exclude_fold]
    return rows


def parse_fold(v):
    return None if v is None else (v if v == "all" else int(v))


def chat_ids(tok, messages, add_gen):
    kw = dict(tokenize=False, add_generation_prompt=add_gen)
    try:
        return tok.apply_chat_template(messages, enable_thinking=False, **kw)
    except TypeError:
        return tok.apply_chat_template(messages, **kw)


def encode_example(tok, row):
    """Return (input_ids, n_completion). Loss only on assistant tokens (JSON + <|im_end|>)."""
    prompt = chat_ids(tok, row["messages"][:2], True)
    completion = row["messages"][2]["content"] + "<|im_end|>\n"
    p = tok(prompt, add_special_tokens=False)["input_ids"]
    c = tok(completion, add_special_tokens=False)["input_ids"]
    return p + c, len(c)


# --------------------------------------------------------------------------- model
def load_model(name, adapter=None, trainable=False):
    import torch
    from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig
    path = MODELS[name]
    tok = AutoTokenizer.from_pretrained(path)
    kw = dict(dtype=torch.bfloat16, device_map={"": 0}, attn_implementation="sdpa")
    if name == "9b":
        kw["quantization_config"] = BitsAndBytesConfig(
            load_in_4bit=True, bnb_4bit_quant_type="nf4", bnb_4bit_use_double_quant=True,
            bnb_4bit_compute_dtype=torch.bfloat16)
    model = AutoModelForCausalLM.from_pretrained(path, **kw)
    if trainable:
        from peft import LoraConfig, get_peft_model
        names = [n for n, m in model.named_modules()
                 if m.__class__.__name__ in ("Linear", "Linear4bit") and "visual" not in n
                 and n.split(".")[-1] in LORA_LEAVES]
        cfg = LoraConfig(target_modules=names, task_type="CAUSAL_LM", **LORA)
        model.gradient_checkpointing_enable(gradient_checkpointing_kwargs={"use_reentrant": False})
        model.enable_input_require_grads()
        model = get_peft_model(model, cfg)
        leaf = {}
        for n in names:
            leaf[n.split(".")[-1]] = leaf.get(n.split(".")[-1], 0) + 1
        print(json.dumps({"loraTargets": len(names), "byLeaf": leaf,
                          "trainableParams": sum(p.numel() for p in model.parameters() if p.requires_grad)}),
              file=sys.stderr, flush=True)
    elif adapter and adapter != "none":
        from peft import PeftModel
        model = PeftModel.from_pretrained(model, adapter)
    return tok, model


def step_loss(model, ids, n_comp, device):
    import torch
    import torch.nn.functional as F
    x = torch.tensor([ids], device=device)
    out = model(input_ids=x, logits_to_keep=n_comp + 1, use_cache=False)
    logits = out.logits[0, :-1].float()
    target = x[0, -n_comp:]
    return F.cross_entropy(logits, target)


# --------------------------------------------------------------------------- probe
def cmd_probe(a):
    import torch
    tok, model = load_model(a.model, trainable=True)
    rows = load_split("train")
    enc = [(encode_example(tok, r), r["itemId"]) for r in rows]
    (ids, nc), item = max(enc, key=lambda e: len(e[0][0]))
    torch.cuda.reset_peak_memory_stats()
    t = time.time()
    res = {"model": a.model, "maxTokens": len(ids), "completionTokens": nc, "itemId": item}
    try:
        model.train()
        loss = step_loss(model, ids, nc, "cuda:0")
        loss.backward()
        torch.cuda.synchronize()
        res.update(status="OK", loss=round(float(loss), 4))
    except torch.cuda.OutOfMemoryError as e:
        res.update(status="OOM", error=str(e).splitlines()[0][:200])
    res["peakGpuMiB"] = round(torch.cuda.max_memory_allocated() / 2**20)
    res["seconds"] = round(time.time() - t, 2)
    print(json.dumps(res))


# --------------------------------------------------------------------------- train
def cmd_train(a):
    import torch
    from transformers import get_cosine_schedule_with_warmup
    random.seed(SEED)
    torch.manual_seed(SEED)
    fold = parse_fold(a.fold)
    rows = load_split("train", exclude_fold=None if fold == "all" else fold)
    os.makedirs(a.out, exist_ok=True)
    tok, model = load_model(a.model, trainable=True)
    data = [encode_example(tok, r) for r in rows]
    params = [p for p in model.parameters() if p.requires_grad]
    opt = torch.optim.AdamW(params, lr=LR, weight_decay=0.0)
    steps_per_epoch = math.ceil(len(data) / ACCUM)
    total = steps_per_epoch * EPOCHS
    sched = get_cosine_schedule_with_warmup(opt, 0, total)
    rng = random.Random(SEED)
    model.train()
    log, step, t0 = [], 0, time.time()
    for ep in range(EPOCHS):
        order = list(range(len(data)))
        rng.shuffle(order)
        for g in range(0, len(order), ACCUM):
            group = order[g:g + ACCUM]
            tot = 0.0
            for i in group:
                ids, nc = data[i]
                loss = step_loss(model, ids, nc, "cuda:0") / len(group)
                loss.backward()
                tot += float(loss)
            torch.nn.utils.clip_grad_norm_(params, 1.0)
            opt.step()
            sched.step()
            opt.zero_grad(set_to_none=True)
            step += 1
            log.append({"step": step, "epoch": ep + 1, "loss": round(tot, 4), "lr": sched.get_last_lr()[0]})
            print(json.dumps(log[-1]), flush=True)
            if a.max_steps and step >= a.max_steps:
                break
        if a.max_steps and step >= a.max_steps:
            break
    model.save_pretrained(a.out)
    summary = {"model": a.model, "fold": a.fold, "items": len(data), "optimizerSteps": step,
               "plannedSteps": total, "seconds": round(time.time() - t0),
               "peakGpuMiB": round(torch.cuda.max_memory_allocated() / 2**20), "log": log}
    json.dump(summary, open(f"{a.out}/train-log.json", "w"))
    print(json.dumps({k: v for k, v in summary.items() if k != "log"}))


# --------------------------------------------------------------------------- predict
def parse_output(raw):
    """Strict parse: no fences stripping, no repair."""
    try:
        obj = json.loads(raw)
    except Exception:
        return False, None
    return isinstance(obj, dict), (obj if isinstance(obj, dict) else None)


def cmd_predict(a):
    import torch
    fold = parse_fold(a.fold)
    rows = load_split(a.split, fold=fold if isinstance(fold, int) else None)
    if a.limit:
        rows = rows[:a.limit]
    tok, model = load_model(a.model, adapter=a.adapter)
    model.eval()
    n_ok = 0
    with open(a.out, "w", encoding="utf-8") as f:
        for r in rows:
            prompt = chat_ids(tok, r["messages"][:2], True)
            x = tok(prompt, add_special_tokens=False, return_tensors="pt").input_ids.to("cuda:0")
            with torch.no_grad():
                out = model.generate(input_ids=x, max_new_tokens=MAX_NEW, do_sample=False,
                                     pad_token_id=tok.pad_token_id or tok.eos_token_id)
            raw = tok.decode(out[0, x.shape[1]:], skip_special_tokens=True)
            ok, obj = parse_output(raw)
            n_ok += ok
            f.write(json.dumps({"itemId": r["itemId"], "raw": raw, "parsed": ok, "obj": obj},
                               ensure_ascii=False) + "\n")
            f.flush()
            print(json.dumps({"itemId": r["itemId"], "parsed": ok, "genTokens": int(out.shape[1] - x.shape[1])}),
                  flush=True)
    print(json.dumps({"items": len(rows), "parsed": n_ok}))


# --------------------------------------------------------------------------- score
GF_KEYS = {"attributeKey", "subject", "value"}
PJ_KEYS = {"kind", "status", "claimText", "projectMention", "subject"}


def normalize(obj):
    """Map a gold/Luna/model object to a comparable dict, or None if schema-invalid."""
    if not isinstance(obj, dict):
        return None
    d = obj.get("disposition")
    if d == "DEFERRED":
        return {"disposition": "DEFERRED", "reason": obj.get("reason")}
    if d != "EXTRACTED":
        return None
    fam, pl, ev = obj.get("semanticFamily"), obj.get("payload"), obj.get("evidenceTurnIds")
    if fam not in ("project", "general_fact") or not isinstance(pl, dict) or not isinstance(ev, list):
        return None
    if fam == "general_fact" and not GF_KEYS <= set(pl):
        return None
    if fam == "project" and not PJ_KEYS <= set(pl):
        return None
    return {"disposition": "EXTRACTED", "semanticFamily": fam, "payload": pl, "evidenceTurnIds": ev}


def structure_match(g, p):
    if g is None or p is None or g["disposition"] != p["disposition"]:
        return False
    if g["disposition"] == "DEFERRED":
        return True
    if g["semanticFamily"] != p["semanticFamily"]:
        return False
    if g["semanticFamily"] == "general_fact":
        return g["payload"].get("attributeKey") == p["payload"].get("attributeKey")
    return g["payload"].get("kind") == p["payload"].get("kind") and g["payload"].get("status") == p["payload"].get("status")


def mechanical(row, p):
    """Only meaningful for a normalized EXTRACTED prediction; returns (applicable, ok)."""
    if p is None:
        return True, False
    if p["disposition"] != "EXTRACTED":
        return False, True
    ev = p["evidenceTurnIds"]
    ids_ok = all(isinstance(i, str) and i in row["evidenceTurnIds"] for i in ev) and row["anchorTurnId"] in ev
    m = p["payload"].get("projectMention") if p["semanticFamily"] == "project" else None
    ment_ok = m is None or (isinstance(m, str) and any(m in t for t in row["evidenceText"]))
    return True, bool(ids_ok and ment_ok)


def family_key(g):
    if g["disposition"] == "DEFERRED":
        return "DEFERRED"
    if g["semanticFamily"] == "project":
        return "project"
    return "general_fact:" + str(g["payload"].get("attributeKey"))


def score_items(rows, preds):
    """rows: dataset rows; preds: itemId -> (parsed_ok, raw object or None). Returns (summary, per_item, pairs)."""
    per, fam, keyed = [], {}, []
    for r in rows:
        g = normalize(json.loads(r["messages"][2]["content"]))
        ok, obj = preds.get(r["itemId"], (False, None))
        p = normalize(obj) if ok else None
        prim = structure_match(g, p)
        app, mech = mechanical(r, p)
        fk = family_key(g)
        per.append({"itemId": r["itemId"], "family": fk, "parsed": bool(ok), "schemaValid": p is not None,
                    "primary": prim, "mechApplicable": app, "mechanical": mech})
        s = fam.setdefault(fk, {"n": 0, "primary": 0})
        s["n"] += 1
        s["primary"] += prim
        if prim and g["disposition"] == "EXTRACTED":
            keyed.append((r["itemId"], g, p))
    n = len(rows)
    app = [x for x in per if x["mechApplicable"]]
    summary = {"items": n, "parsed": sum(x["parsed"] for x in per), "schemaValid": sum(x["schemaValid"] for x in per),
               "primary": sum(x["primary"] for x in per),
               "primaryRate": round(sum(x["primary"] for x in per) / n, 4) if n else None,
               "mechApplicable": len(app), "mechanicalOk": sum(x["mechanical"] for x in app),
               "byFamily": {k: {**v, "rate": round(v["primary"] / v["n"], 4)} for k, v in sorted(fam.items())}}
    return summary, per, keyed


def value_of(o):
    pl = o["payload"]
    if o["semanticFamily"] == "general_fact":
        return {"subject": pl.get("subject"), "value": pl.get("value")}
    return {"subject": pl.get("subject"), "claimText": pl.get("claimText"), "projectMention": pl.get("projectMention")}


def write_pairs(keyed, path, seed=SEED):
    """Blind pairs for owner judging: random order, random A/B; the answer key goes to a separate file."""
    rng = random.Random(seed)
    items = list(keyed)
    rng.shuffle(items)
    blind, key = [], []
    for item_id, g, p in items:
        gold_first = rng.random() < 0.5
        a, b = (g, p) if gold_first else (p, g)
        blind.append({"itemId": item_id, "family": g["semanticFamily"], "A": value_of(a), "B": value_of(b)})
        key.append({"itemId": item_id, "A": "gold" if gold_first else "pred"})
    with open(path, "w", encoding="utf-8") as f:
        for x in blind:
            f.write(json.dumps(x, ensure_ascii=False) + "\n")
    json.dump(key, open(path + ".key.json", "w"))


def load_preds(path, rows):
    if path == "luna":
        return {r["itemId"]: (True, r["lunaDraft"]) for r in rows}
    out = {}
    for l in open(path, encoding="utf-8"):
        if l.strip():
            d = json.loads(l)
            out[d["itemId"]] = (d["parsed"], d["obj"])
    return out


def cmd_score(a):
    fold = parse_fold(a.fold)
    rows = load_split(a.split, fold=fold if isinstance(fold, int) else None)
    preds = load_preds(a.pred, rows)
    if a.pred != "luna":
        rows = [r for r in rows if r["itemId"] in preds]
    luna_shapes = None
    if a.pred == "luna":
        luna_shapes = {}
        for r in rows:
            k = ",".join(sorted(r["lunaDraft"].keys()))
            luna_shapes[k] = luna_shapes.get(k, 0) + 1
    summary, per, keyed = score_items(rows, preds)
    if luna_shapes:
        summary["lunaDraftKeyShapes"] = luna_shapes
        summary["lunaDraftNote"] = ("DEFERRED drafts omit semanticFamily/payload/evidenceTurnIds; "
                                    "normalised by disposition before comparing")
    summary["pred"] = "luna" if a.pred == "luna" else os.path.basename(a.pred)
    summary["split"] = a.split
    json.dump({"summary": summary, "items": per}, open(a.out, "w"), indent=1)
    write_pairs(keyed, a.out + ".pairs.jsonl")
    summary["pairsExported"] = len(keyed)
    print(json.dumps(summary))


# --------------------------------------------------------------------------- selftest
def cmd_selftest(_):
    def row(gold, ev=("t1", "t2", "t3"), text=("hello project alpha", "b", "c")):
        return {"itemId": "x", "anchorTurnId": "t2", "evidenceTurnIds": list(ev), "evidenceText": list(text),
                "messages": [{}, {}, {"content": json.dumps(gold)}]}

    gold = {"disposition": "EXTRACTED", "reason": "r", "semanticFamily": "project", "evidenceTurnIds": ["t2"],
            "payload": {"kind": "STATUS", "status": "PLANNED", "claimText": None, "projectMention": "project alpha",
                        "subject": "USER"}}
    r = row(gold)
    good = json.loads(json.dumps(gold))
    wrong = json.loads(json.dumps(gold))
    wrong["payload"]["status"] = "DONE"
    badment = json.loads(json.dumps(gold))
    badment["payload"]["projectMention"] = "not there"
    outside = json.loads(json.dumps(gold))
    outside["evidenceTurnIds"] = ["t2", "zz"]
    noanchor = json.loads(json.dumps(gold))
    noanchor["evidenceTurnIds"] = ["t1"]
    deferred = {"disposition": "DEFERRED", "reason": "opinion"}
    gf = {"disposition": "EXTRACTED", "semanticFamily": "general_fact", "evidenceTurnIds": ["t2"],
          "payload": {"attributeKey": "primary_phone", "subject": "USER", "value": "v"}}
    cases = [
        ("correct", r, (True, good), dict(primary=True, mech=True)),
        ("structure wrong", r, (True, wrong), dict(primary=False, mech=True)),
        ("parse failure", r, (False, None), dict(primary=False, mech=False)),
        ("mention mismatch", r, (True, badment), dict(primary=True, mech=False)),
        ("evidence outside bundle", r, (True, outside), dict(primary=True, mech=False)),
        ("anchor missing", r, (True, noanchor), dict(primary=True, mech=False)),
        ("deferred vs extracted", r, (True, deferred), dict(primary=False, mech=True)),
        ("deferred correct (luna shape)", row(deferred), (True, deferred), dict(primary=True, mech=True)),
        ("general_fact attr", row(gf), (True, gf), dict(primary=True, mech=True)),
        ("general_fact attr wrong", row(gf), (True, {**gf, "payload": {**gf["payload"], "attributeKey": "x"}}),
         dict(primary=False, mech=True)),
        ("schema invalid", r, (True, {"disposition": "EXTRACTED"}), dict(primary=False, mech=False)),
    ]
    fails = 0
    for name, rw, pred, exp in cases:
        s, per, _ = score_items([rw], {"x": pred})
        got = dict(primary=per[0]["primary"], mech=per[0]["mechanical"])
        ok = got == exp
        fails += not ok
        print(("PASS " if ok else "FAIL ") + name, got)
    # strict parse: fenced JSON must fail
    ok = parse_output('```json\n{"a":1}\n```')[0] is False and parse_output('{"a":1}')[0] is True
    fails += not ok
    print(("PASS " if ok else "FAIL ") + "strict parse (no fence repair)")
    print(json.dumps({"selftestFailures": fails}))
    sys.exit(1 if fails else 0)


def main():
    ap = argparse.ArgumentParser()
    sp = ap.add_subparsers(dest="cmd", required=True)
    p = sp.add_parser("probe"); p.add_argument("--model", choices=MODELS, required=True); p.set_defaults(f=cmd_probe)
    p = sp.add_parser("train"); p.add_argument("--model", choices=MODELS, required=True)
    p.add_argument("--fold", required=True, help="0..4 or all"); p.add_argument("--out", required=True)
    p.add_argument("--max-steps", type=int, default=0, help="debug only"); p.set_defaults(f=cmd_train)
    p = sp.add_parser("predict"); p.add_argument("--model", choices=MODELS, required=True)
    p.add_argument("--adapter", default="none"); p.add_argument("--split", choices=["train", "eval"], required=True)
    p.add_argument("--fold"); p.add_argument("--out", required=True)
    p.add_argument("--limit", type=int, default=0, help="debug only: first N items"); p.set_defaults(f=cmd_predict)
    p = sp.add_parser("score"); p.add_argument("--pred", required=True); p.add_argument("--split", choices=["train", "eval"], required=True)
    p.add_argument("--fold"); p.add_argument("--out", required=True); p.set_defaults(f=cmd_score)
    p = sp.add_parser("selftest"); p.set_defaults(f=cmd_selftest)
    a = ap.parse_args()
    a.f(a)


if __name__ == "__main__":
    main()
