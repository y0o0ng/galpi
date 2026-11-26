#!/usr/bin/env python3
"""Step 3a: general_fact path, zero-API scoring (build / predict / score / finalize / selftest).

Preregistration: docs/Memory research/xion-memory-research-docs/memory-storage-routing-design.md
("Step 3a - general_fact path, zero-API scoring"). Reader out-of-fold predictions pick the anchors read as
general_fact; the tuned Extractor (fold adapter that did not train on the anchor; 4b-all otherwise) writes the
proposal with the output prefilled up to semanticFamily=general_fact. No API calls.
Private rule: never print conversation text, values or raw outputs. Only counts, ids, keys and booleans are printed.
Run with the private train-env python, HF_HUB_OFFLINE=1, nice -n 19.
"""
import argparse
import importlib.util
import json
import os
import subprocess
import sys

os.environ.setdefault("HF_HUB_OFFLINE", "1")

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = "/home/rnlcksgxk/projects/galpi-private"
OUT = f"{ROOT}/step3a"
KEYS = ["primary_laptop", "academic_major", "affiliation", "residence_area", "primary_phone", "preference", "possession"]
PREFIX = '{"disposition":"EXTRACTED","semanticFamily":"general_fact",'
# The tuned model emits `,"` as one token, so a prefix ending at the bare comma makes it drop the opening quote of the
# next key (observed in the smoke). The prefill therefore ends with the opening quote.
PREFILL = PREFIX + '"'
ADAPTERS = ["4b-f0", "4b-f1", "4b-f2", "4b-f3", "4b-f4", "4b-all"]
MARKS = ("같음", "다름")


def load_E():
    spec = importlib.util.spec_from_file_location("extractor_tune", f"{HERE}/memory-extractor-tune.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def jl(path):
    return [json.loads(l) for l in open(path, encoding="utf-8") if l.strip()]


def write_jl(path, rows):
    with open(path, "w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    os.chmod(path, 0o600)


def ensure_out():
    os.makedirs(OUT, mode=0o700, exist_ok=True)
    os.chmod(OUT, 0o700)


def adapter_path(name):
    return f"{ROOT}/extractor-tuning/final/4b-all" if name == "4b-all" else f"{ROOT}/extractor-tuning/cv/{name}"


# --------------------------------------------------------------------------- build
def cmd_build(_):
    ensure_out()
    ext_instr = open(f"{ROOT}/extractor-tuning/data/instructions.txt", encoding="utf-8").read()
    ext = {s: {r["itemId"]: r for r in jl(f"{ROOT}/extractor-tuning/data/{s}.jsonl")} for s in ("train", "eval")}
    rdr = {s: jl(f"{ROOT}/reader-tuning/data/{s}.jsonl") for s in ("train", "eval")}
    # durability-queue gold: last label per item wins (same rule as the data builders)
    dur = {}
    for r in jl(f"{ROOT}/formation-tuning/labels-train-durability.jsonl"):
        dur[r["itemId"]] = r
    oof = {}
    for k in range(5):
        for r in jl(f"{ROOT}/reader-tuning/cv/f{k}.pred.jsonl"):
            oof[r["itemId"]] = r["label"]
    oof_eval = {r["itemId"]: r["label"] for r in jl(f"{ROOT}/reader-tuning/cv/eval.pred.jsonl")}
    pred_of = {"train": oof, "eval": oof_eval}
    items, gold_gf, byte_checked, byte_ok = [], {"train": [], "eval": []}, 0, 0
    for split in ("train", "eval"):
        for r in rdr[split]:
            iid = r["itemId"]
            fam = {"general_fact": "general_fact"}.get(r["label"], r["label"])
            if r["label"] == "general_fact":
                gold_gf[split].append(iid)
            if pred_of[split].get(iid) != "general_fact":
                continue
            sys_msg, user_msg = r["messages"][0]["content"], r["messages"][1]["content"]
            gkey = gval = None
            if r["queue"] == "extractor":
                e = ext[split].get(iid)
                if e is None:
                    raise SystemExit(f"EXTRACTOR_ROW_MISSING {iid[:8]}")
                byte_checked += 1
                if e["messages"][1]["content"] == user_msg and e["messages"][0]["content"] == ext_instr:
                    byte_ok += 1
                gold = json.loads(e["messages"][2]["content"])
                adapter = f"4b-f{e['fold']}" if split == "train" else "4b-all"
            else:
                gold = (dur[iid] or {}).get("gold") or {}
                adapter = "4b-all"
            if r["label"] == "general_fact":
                p = gold.get("payload") or {}
                gkey, gval = p.get("attributeKey"), p.get("value")
            items.append({"itemId": iid, "split": split, "queue": r["queue"], "adapter": adapter,
                          "goldFamily": r["label"], "goldKey": gkey, "goldValue": gval,
                          "messages": [{"role": "system", "content": ext_instr}, {"role": "user", "content": user_msg}]})
    if byte_ok != byte_checked:
        raise SystemExit(f"BYTE_CHECK_FAIL {byte_ok}/{byte_checked}")
    write_jl(f"{OUT}/items.jsonl", items)
    json.dump({"goldGeneralFactIds": gold_gf}, open(f"{OUT}/meta.json", "w"))
    os.chmod(f"{OUT}/meta.json", 0o600)
    cnt = {}
    for it in items:
        for k in (f"adapter:{it['adapter']}", f"family:{it['split']}:{it['goldFamily']}", f"queue:{it['queue']}"):
            cnt[k] = cnt.get(k, 0) + 1
    print(json.dumps({"proposals": len(items), "byteCheck": f"{byte_ok}/{byte_checked}", "counts": cnt,
                      "goldGeneralFact": {k: len(v) for k, v in gold_gf.items()}}, sort_keys=True))


# --------------------------------------------------------------------------- predict
def cmd_predict(a):
    ensure_out()
    items = jl(f"{OUT}/items.jsonl")
    if a.all:
        for name in ADAPTERS:
            if any(i["adapter"] == name for i in items):
                subprocess.run([sys.executable, __file__, "predict", "--adapter", name], check=True)
        return
    if a.adapter not in ADAPTERS:
        raise SystemExit("unknown adapter")
    pred_path = f"{OUT}/pred.jsonl"
    done = {r["itemId"] for r in jl(pred_path)} if os.path.exists(pred_path) else set()
    todo = [i for i in items if i["adapter"] == a.adapter and i["itemId"] not in done]
    if a.limit:
        todo = todo[:a.limit]
    if not todo:
        print(json.dumps({"adapter": a.adapter, "generated": 0}))
        return
    import torch
    E = load_E()
    tok, model = E.load_model("4b", adapter=adapter_path(a.adapter))
    model.eval()
    pre = tok(PREFILL, add_special_tokens=False, return_tensors="pt").input_ids
    n = 0
    with open(pred_path, "a", encoding="utf-8") as f:
        for it in todo:
            prompt = E.chat_ids(tok, it["messages"], True)
            x = tok(prompt, add_special_tokens=False, return_tensors="pt").input_ids
            x = torch.cat([x, pre], dim=1).to("cuda:0")
            with torch.no_grad():
                out = model.generate(input_ids=x, max_new_tokens=E.MAX_NEW, do_sample=False,
                                     pad_token_id=tok.pad_token_id or tok.eos_token_id)
            raw = PREFILL + tok.decode(out[0, x.shape[1]:], skip_special_tokens=True)
            f.write(json.dumps({"itemId": it["itemId"], "raw": raw}, ensure_ascii=False) + "\n")
            f.flush()
            n += 1
    os.chmod(pred_path, 0o600)
    print(json.dumps({"adapter": a.adapter, "generated": n}))


# --------------------------------------------------------------------------- score
def parse_proposal(raw):
    """Returns (status, key, value): status in ok|malformed|invalid_key."""
    try:
        obj = json.loads(raw)
    except Exception:
        return "malformed", None, None
    if not isinstance(obj, dict) or obj.get("disposition") != "EXTRACTED" or obj.get("semanticFamily") != "general_fact":
        return "malformed", None, None
    p = obj.get("payload")
    if not isinstance(p, dict) or "attributeKey" not in p or "value" not in p:
        return "malformed", None, None
    key = p["attributeKey"]
    if key not in KEYS:
        return "invalid_key", key if isinstance(key, str) else None, p["value"]
    return "ok", key, p["value"]


def classify(item, raw):
    """Mechanical verdict: (reason or 'NEEDS_OWNER', key, value). Order: gold family, parse, key validity, key match."""
    status, key, value = parse_proposal(raw)
    if item["goldFamily"] != "general_fact":
        return "gold_not_general_fact", key, value
    if status == "malformed":
        return "malformed", key, value
    if status == "invalid_key":
        return "invalid_key", key, value
    if key != item["goldKey"]:
        return "key_mismatch", key, value
    return "NEEDS_OWNER", key, value


def score_core(items, preds, gold_ids):
    out, review = {}, []
    for split in ("train", "eval"):
        its = [i for i in items if i["split"] == split]
        wrong, needs, missing = {}, 0, 0
        proposed = set()
        for it in its:
            if it["itemId"] not in preds:
                missing += 1
                continue
            proposed.add(it["itemId"])
            verdict, key, value = classify(it, preds[it["itemId"]])
            if verdict == "NEEDS_OWNER":
                needs += 1
                review.append({"split": split, "itemId": it["itemId"], "key": key, "gold": it["goldValue"], "pred": value})
            else:
                wrong[verdict] = wrong.get(verdict, 0) + 1
        out[split] = {"proposals": len(proposed), "unpredicted": missing, "wrongMechanical": wrong,
                      "wrongMechanicalTotal": sum(wrong.values()), "needsOwner": needs,
                      "misses": len([g for g in gold_ids[split] if g not in proposed])}
    return out, review


def cell(v):
    return str(v).replace("\\", "\\\\").replace("|", "\\|").replace("\n", " ")


def cmd_score(_):
    items = jl(f"{OUT}/items.jsonl")
    preds = {r["itemId"]: r["raw"] for r in jl(f"{OUT}/pred.jsonl")}
    gold_ids = json.load(open(f"{OUT}/meta.json"))["goldGeneralFactIds"]
    out, review = score_core(items, preds, gold_ids)
    ids = [r["itemId"][:8] for r in review]
    if len(set(ids)) != len(ids):
        raise SystemExit("SHORT_ID_COLLISION")
    json.dump(out, open(f"{OUT}/score.json", "w"), indent=1)
    os.chmod(f"{OUT}/score.json", 0o600)
    lines = ["# Step 3a owner review", "",
             "각 행의 마지막 칸에 `같음`(예측 값이 gold와 같은 뜻) 또는 `다름`을 적는다. 표현 차이는 같음이다.", "",
             "| split | id | attributeKey | gold value | predicted value | 같음/다름 |", "| --- | --- | --- | --- | --- | --- |"]
    for r in review:
        lines.append(f"| {r['split']} | {r['itemId'][:8]} | {r['key']} | {cell(r['gold'])} | {cell(r['pred'])} |  |")
    path = f"{OUT}/owner-review.md"
    open(path, "w", encoding="utf-8").write("\n".join(lines) + "\n")
    os.chmod(path, 0o600)
    print(json.dumps(out, sort_keys=True))


# --------------------------------------------------------------------------- finalize
def split_row(line):
    """Row cells honoring \\| escapes."""
    cells, cur, i = [], "", 0
    body = line.strip()
    if body.startswith("|"):
        body = body[1:]
    if body.endswith("|") and not body.endswith("\\|"):
        body = body[:-1]
    while i < len(body):
        c = body[i]
        if c == "\\" and i + 1 < len(body):
            cur += body[i:i + 2]
            i += 2
            continue
        if c == "|":
            cells.append(cur.strip())
            cur = ""
        else:
            cur += c
        i += 1
    cells.append(cur.strip())
    return cells


def read_marks(text):
    marks = {}
    for line in text.splitlines():
        if not line.startswith("|"):
            continue
        c = split_row(line)
        if len(c) != 6 or c[0] in ("split", "---") or c[0] not in ("train", "eval"):
            continue
        marks[(c[0], c[1])] = c[5]
    return marks


def finalize_core(score, marks):
    reviewed = {"train": [], "eval": []}
    bad, unmarked = 0, 0
    for (split, _), m in marks.items():
        if m in MARKS:
            reviewed[split].append(m)
        elif m == "":
            unmarked += 1
        else:
            bad += 1
    res = {"unmarked": unmarked, "invalidMarks": bad}
    for split in ("train", "eval"):
        s = score[split]
        different = reviewed[split].count("다름")
        wrong = s["wrongMechanicalTotal"] + different
        rate = wrong / s["proposals"] if s["proposals"] else None
        res[split] = {"proposals": s["proposals"], "wrongMechanical": s["wrongMechanicalTotal"], "ownerDifferent": different,
                      "ownerSame": reviewed[split].count("같음"), "wrong": wrong, "wrongRate": rate, "misses": s["misses"]}
    t = res["train"]
    res["pass"] = bool(t["proposals"] >= 20 and t["wrongRate"] is not None and t["wrongRate"] <= 0.20
                       and unmarked == 0 and bad == 0)
    return res


def cmd_finalize(a):
    score = json.load(open(f"{OUT}/score.json"))
    marks = read_marks(open(a.review, encoding="utf-8").read())
    res = finalize_core(score, marks)
    if res["unmarked"] or res["invalidMarks"]:
        print(json.dumps({"error": "INCOMPLETE_REVIEW", "unmarked": res["unmarked"], "invalidMarks": res["invalidMarks"]}))
        sys.exit(1)
    json.dump(res, open(f"{OUT}/final.json", "w"), indent=1)
    os.chmod(f"{OUT}/final.json", 0o600)
    print(json.dumps(res, sort_keys=True))


# --------------------------------------------------------------------------- selftest
def cmd_selftest(_):
    ok = lambda c, m: (_ for _ in ()).throw(AssertionError(m)) if not c else None
    # prefix is a valid JSON prefix that the model can complete
    full = PREFIX + '"reason":null,"payload":{"attributeKey":"preference","subject":"USER","value":"v"},"evidenceTurnIds":["t1"]}'
    ok(parse_proposal(full) == ("ok", "preference", "v"), "parse ok")
    ok(PREFIX.endswith(",") and PREFIX.startswith("{"), "prefix shape")
    ok(PREFILL == PREFIX + '"' and parse_proposal(PREFILL + 'evidenceTurnIds":["t"],"payload":{"attributeKey":"preference","subject":"USER","value":"v"}}') == ("ok", "preference", "v"), "prefill")
    ok(parse_proposal(PREFIX + '"payload":{"attributeKey":"hobby","value":"v"}}')[0] == "invalid_key", "invalid key")
    ok(parse_proposal(PREFIX + '"payload":{"attrib')[0] == "malformed", "truncated")
    ok(parse_proposal(PREFIX + '"payload":null}')[0] == "malformed", "null payload")
    ok(parse_proposal(PREFIX + '"payload":{"attributeKey":"possession","value":null}}') == ("ok", "possession", None), "null value ok")

    def mk(i, fam="general_fact", key="preference", split="train"):
        return {"itemId": i, "split": split, "goldFamily": fam, "goldKey": key, "goldValue": "g"}

    def raw(key, value="p"):
        return PREFIX + '"payload":{"attributeKey":"%s","subject":"USER","value":"%s"}}' % (key, value)
    ok(classify(mk("a", fam="project"), raw("preference"))[0] == "gold_not_general_fact", "gold not gf")
    ok(classify(mk("a"), PREFIX + "{")[0] == "malformed", "malformed")
    ok(classify(mk("a"), raw("zzz"))[0] == "invalid_key", "invalid")
    ok(classify(mk("a"), raw("possession"))[0] == "key_mismatch", "mismatch")
    ok(classify(mk("a"), raw("preference"))[0] == "NEEDS_OWNER", "needs owner")
    items = [mk("a"), mk("b", fam="project"), mk("c"), mk("e", split="eval")]
    preds = {"a": raw("preference", "x|y"), "b": raw("preference"), "c": raw("possession"), "e": raw("preference")}
    sc, review = score_core(items, preds, {"train": ["a", "c", "m"], "eval": ["e"]})
    ok(sc["train"]["proposals"] == 3 and sc["train"]["wrongMechanicalTotal"] == 2 and sc["train"]["needsOwner"] == 1, "score counts")
    ok(sc["train"]["misses"] == 1 and sc["eval"]["misses"] == 0, "misses")
    ok(sc["train"]["wrongMechanical"] == {"gold_not_general_fact": 1, "key_mismatch": 1}, "reasons")
    # review table round trip with escaped pipe
    row = f"| train | a | preference | g | {cell('x|y')} |  |"
    ok(split_row(row) == ["train", "a", "preference", "g", "x\\|y", ""], "split_row")
    text = "| split | id | k | g | p | m |\n| --- | --- | --- | --- | --- | --- |\n" + \
        f"| train | a | preference | g | {cell('x|y')} | 같음 |\n| eval | e | preference | g | p | 다름 |\n"
    marks = read_marks(text)
    ok(marks == {("train", "a"): "같음", ("eval", "e"): "다름"}, "marks")
    # finalize math: 20 proposals, 4 wrong -> exactly 0.20 passes; 5 wrong fails; <20 fails; unmarked fails
    def score_with(n, mech):
        return {"train": {"proposals": n, "wrongMechanicalTotal": mech, "misses": 0},
                "eval": {"proposals": 0, "wrongMechanicalTotal": 0, "misses": 0}}
    mk_marks = lambda same, diff: {("train", f"s{i}"): "같음" for i in range(same)} | {("train", f"d{i}"): "다름" for i in range(diff)}
    ok(finalize_core(score_with(20, 2), mk_marks(16, 2))["pass"] is True, "boundary pass")
    ok(finalize_core(score_with(20, 2), mk_marks(15, 3))["pass"] is False, "over rate")
    ok(finalize_core(score_with(19, 0), mk_marks(19, 0))["pass"] is False, "too few")
    ok(finalize_core(score_with(20, 0), {**mk_marks(19, 0), ("train", "u"): ""})["pass"] is False, "unmarked")
    print(json.dumps({"selftest": "ok"}))


def main():
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("build").set_defaults(fn=cmd_build)
    q = sub.add_parser("predict")
    q.add_argument("--adapter")
    q.add_argument("--all", action="store_true")
    q.add_argument("--limit", type=int, default=0)
    q.set_defaults(fn=cmd_predict)
    sub.add_parser("score").set_defaults(fn=cmd_score)
    f = sub.add_parser("finalize")
    f.add_argument("--review", required=True)
    f.set_defaults(fn=cmd_finalize)
    sub.add_parser("selftest").set_defaults(fn=cmd_selftest)
    a = p.parse_args()
    if a.cmd == "predict" and not a.all and not a.adapter:
        p.error("--adapter or --all required")
    a.fn(a)


if __name__ == "__main__":
    main()
