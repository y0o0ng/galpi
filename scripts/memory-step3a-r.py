#!/usr/bin/env python3
"""Step 3a-R: general_fact path on refined bundles (train / items / predict / score / finalize / selftest).

Preregistration: docs/Memory research/xion-memory-research-docs/memory-storage-routing-design.md
("Step 3a-R - general_fact path on refined bundles"). Reuses scripts/memory-step3a.py (prefill, scoring, finalize)
and scripts/memory-extractor-tune.py (training) via importlib. Arms: R1 = Extractor retrained on refined bundles,
R2 = existing window-trained adapters on refined input. No API calls.
Private rule: never print conversation text, values or raw outputs. Only counts, ids, keys and booleans are printed.
"""
import argparse
import importlib.util
import json
import os
import sys
import tempfile

os.environ.setdefault("HF_HUB_OFFLINE", "1")
HERE = os.path.dirname(os.path.abspath(__file__))


def _load(name, fn):
    spec = importlib.util.spec_from_file_location(name, f"{HERE}/{fn}")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


S = _load("step3a", "memory-step3a.py")
ROOT = S.ROOT
A3 = f"{ROOT}/step3a"
OUT = f"{ROOT}/step3a-r"
DATA = f"{OUT}/data"
CKPT_EVERY = 5


def adapter_dir(arm, name):
    if arm == "R1":
        return f"{OUT}/cv/{name}"
    return S.adapter_path(name)


def paths(arm):
    return {k: f"{OUT}/{v.format(arm=arm)}" for k, v in
            dict(items="items-{arm}.jsonl", pred="pred-{arm}.jsonl", score="score-{arm}.json",
                 review="owner-review-{arm}.md", final="final-{arm}.json").items()}


# --------------------------------------------------------------------------- train
def cmd_train(a):
    E = S.load_E()
    E.DATA = DATA
    a.model, a.offload_activations, a.max_steps = "4b", False, 0
    a.checkpoint_every = CKPT_EVERY
    E.cmd_train(a)


# --------------------------------------------------------------------------- items
def cmd_items(a):
    refined = {}
    for s in ("train", "eval"):
        for r in S.jl(f"{DATA}/{s}.jsonl"):
            refined[r["itemId"]] = r["messages"][:2]
    items = S.jl(f"{A3}/items.jsonl")
    out = []
    for it in items:
        if it["itemId"] not in refined:
            raise SystemExit(f"REFINED_ROW_MISSING {it['itemId'][:8]}")
        out.append({**it, "messages": refined[it["itemId"]]})
    S.write_jl(paths(a.arm)["items"], out)
    print(json.dumps({"arm": a.arm, "items": len(out)}))


# --------------------------------------------------------------------------- predict
def cmd_predict(a):
    P = paths(a.arm)
    items = S.jl(P["items"])
    done = {r["itemId"] for r in S.jl(P["pred"])} if os.path.exists(P["pred"]) else set()
    todo = [i for i in items if i["itemId"] not in done]
    if a.limit:
        todo = todo[:a.limit]
    if not todo:
        print(json.dumps({"arm": a.arm, "generated": 0}))
        return
    import torch
    E = S.load_E()
    pre = None
    n = ok = valid = 0
    for name in S.ADAPTERS:
        mine = [i for i in todo if i["adapter"] == name]
        if not mine:
            continue
        tok, model = E.load_model("4b", adapter=adapter_dir(a.arm, name))
        model.eval()
        pre = tok(S.PREFILL, add_special_tokens=False, return_tensors="pt").input_ids
        with open(P["pred"], "a", encoding="utf-8") as f:
            for it in mine:
                x = tok(E.chat_ids(tok, it["messages"], True), add_special_tokens=False, return_tensors="pt").input_ids
                x = torch.cat([x, pre], dim=1).to("cuda:0")
                with torch.no_grad():
                    out = model.generate(input_ids=x, max_new_tokens=E.MAX_NEW, do_sample=False,
                                         pad_token_id=tok.pad_token_id or tok.eos_token_id)
                raw = S.PREFILL + tok.decode(out[0, x.shape[1]:], skip_special_tokens=True)
                st = S.parse_proposal(raw)[0]
                ok += st != "malformed"
                valid += st == "ok"
                f.write(json.dumps({"itemId": it["itemId"], "raw": raw}, ensure_ascii=False) + "\n")
                f.flush()
                n += 1
        del model
        torch.cuda.empty_cache()
    os.chmod(P["pred"], 0o600)
    print(json.dumps({"arm": a.arm, "generated": n, "parseOk": ok, "keyValid": valid}))


# --------------------------------------------------------------------------- review inheritance
def old_marks(text):
    """(split, id8) -> (pred cell, normalized mark or '') from a step3a owner-review table."""
    out = {}
    for line in text.splitlines():
        if not line.startswith("|"):
            continue
        c = S.split_row(line)
        if len(c) != 6 or c[0] not in ("train", "eval"):
            continue
        m = c[5]
        m = "같음" if m.startswith("같음") else "다름" if m.startswith("다름") else ""
        out[(c[0], c[1])] = (c[4], m)
    return out


def split_review(review, old):
    """review rows -> (needs owner, inherited with mark). Identical predicted value string keeps the old mark."""
    needs, inh = [], []
    for r in review:
        o = old.get((r["split"], r["itemId"][:8]))
        if o and o[1] and o[0] == S.cell(r["pred"]):
            inh.append({**r, "mark": o[1]})
        else:
            needs.append(r)
    return needs, inh


def render_review(needs, inh):
    head = ["| split | id | attributeKey | gold value | predicted value | 같음/다름 |", "| --- | --- | --- | --- | --- | --- |"]
    lines = ["# Step 3a-R owner review", "",
             "각 행의 마지막 칸에 `같음`(예측 값이 gold와 같은 뜻) 또는 `다름`을 적는다. 표현 차이는 같음이다.", ""] + head
    for r in needs:
        lines.append(f"| {r['split']} | {r['itemId'][:8]} | {r['key']} | {S.cell(r['gold'])} | {S.cell(r['pred'])} |  |")
    lines += ["", "## inherited (같은 itemId에서 step 3a가 이미 판정한 값과 문자열이 같아 표를 물려받음)", ""] + head
    for r in inh:
        lines.append(f"| {r['split']} | {r['itemId'][:8]} | {r['key']} | {S.cell(r['gold'])} | {S.cell(r['pred'])} | {r['mark']} |")
    return "\n".join(lines) + "\n"


def cmd_score(a):
    P = paths(a.arm)
    items = S.jl(P["items"])
    preds = {r["itemId"]: r["raw"] for r in S.jl(P["pred"])}
    gold_ids = json.load(open(f"{A3}/meta.json"))["goldGeneralFactIds"]
    out, review = S.score_core(items, preds, gold_ids)
    ids = [r["itemId"][:8] for r in review]
    if len(set(ids)) != len(ids):
        raise SystemExit("SHORT_ID_COLLISION")
    old = old_marks(open(f"{A3}/owner-review.md", encoding="utf-8").read())
    needs, inh = split_review(review, old)
    out["review"] = {"needsOwner": len(needs), "inherited": len(inh)}
    json.dump(out, open(P["score"], "w"), indent=1)
    os.chmod(P["score"], 0o600)
    open(P["review"], "w", encoding="utf-8").write(render_review(needs, inh))
    os.chmod(P["review"], 0o600)
    print(json.dumps(out, sort_keys=True))


def cmd_finalize(a):
    P = paths(a.arm)
    score = json.load(open(P["score"]))
    marks = S.read_marks(open(a.review, encoding="utf-8").read())
    if len(marks) != score["review"]["needsOwner"] + score["review"]["inherited"]:
        print(json.dumps({"error": "REVIEW_ROWS_MISMATCH", "rows": len(marks)}))
        sys.exit(1)
    res = S.finalize_core(score, marks)
    if res["unmarked"] or res["invalidMarks"]:
        print(json.dumps({"error": "INCOMPLETE_REVIEW", "unmarked": res["unmarked"], "invalidMarks": res["invalidMarks"]}))
        sys.exit(1)
    json.dump(res, open(P["final"], "w"), indent=1)
    os.chmod(P["final"], 0o600)
    print(json.dumps(res, sort_keys=True))


# --------------------------------------------------------------------------- selftest
def cmd_selftest(_):
    ok = lambda c, m: (_ for _ in ()).throw(AssertionError(m)) if not c else None
    old_text = ("| split | id | k | g | p | m |\n| --- | --- | --- | --- | --- | --- |\n"
                "| train | aaaaaaaa | preference | g | same value | 같음 (표현 차이) |\n"
                "| train | bbbbbbbb | preference | g | x\\|y | 다름 |\n"
                "| eval | cccccccc | preference | g | p | 같음 |\n")
    old = old_marks(old_text)
    ok(old[("train", "aaaaaaaa")] == ("same value", "같음") and old[("train", "bbbbbbbb")] == ("x\\|y", "다름"), "old marks")
    rv = [dict(split="train", itemId="aaaaaaaa" + "0" * 56, key="preference", gold="g", pred="same value"),
          dict(split="train", itemId="bbbbbbbb" + "0" * 56, key="preference", gold="g", pred="x|y"),
          dict(split="eval", itemId="cccccccc" + "0" * 56, key="preference", gold="g", pred="different"),
          dict(split="train", itemId="dddddddd" + "0" * 56, key="preference", gold="g", pred="new")]
    needs, inh = split_review(rv, old)
    ok([r["itemId"][:1] for r in inh] == ["a", "b"] and [r["mark"] for r in inh] == ["같음", "다름"], "inherit")
    ok([r["itemId"][:1] for r in needs] == ["c", "d"], "needs")
    txt = render_review(needs, inh)
    marks = S.read_marks(txt)
    ok(len(marks) == 4 and marks[("train", "aaaaaaaa")] == "같음" and marks[("eval", "cccccccc")] == "", "render/read")
    fixed = txt.replace("different |  |", "different | 다름 |").replace("new |  |", "new | 같음 |")
    m2 = S.read_marks(fixed)
    sc = {"train": {"proposals": 3, "wrongMechanicalTotal": 0, "misses": 0},
          "eval": {"proposals": 1, "wrongMechanicalTotal": 0, "misses": 0}}
    r = S.finalize_core(sc, m2)
    ok(r["unmarked"] == 0 and r["train"]["ownerDifferent"] == 1 and r["eval"]["ownerDifferent"] == 1, "finalize")
    # refinement filter (data builder)
    dspec = importlib.util.spec_from_file_location("d", f"{HERE}/memory-step3a-r-data.py")
    D = importlib.util.module_from_spec(dspec)
    dspec.loader.exec_module(D)
    u = {"anchor": {"text": "a", "turnId": "t2"}, "attributes": {}, "evidence": [{"turnId": f"t{i}", "text": "x"} for i in range(1, 6)]}
    nu, f1 = D.refine(u, {"evidenceTurnIds": ["t4", "t2"]})
    ok([t["turnId"] for t in nu["evidence"]] == ["t2", "t4"] and f1, "refine order")
    nu, f2 = D.refine(u, {"evidenceTurnIds": []})
    ok([t["turnId"] for t in nu["evidence"]] == ["t2"] and f2, "deferred anchor only")
    ok(D.ser(u) == json.dumps(u, ensure_ascii=False, separators=(",", ":")), "ser")
    print(json.dumps({"selftest": "ok"}))


def main():
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest="cmd", required=True)
    t = sub.add_parser("train")
    t.add_argument("--fold", required=True)
    t.add_argument("--out", required=True)
    t.set_defaults(fn=cmd_train)
    for name, fn in (("items", cmd_items), ("predict", cmd_predict), ("score", cmd_score), ("finalize", cmd_finalize)):
        q = sub.add_parser(name)
        q.add_argument("--arm", choices=["R1", "R2"], required=True)
        if name == "predict":
            q.add_argument("--limit", type=int, default=0)
        if name == "finalize":
            q.add_argument("--review", required=True)
        q.set_defaults(fn=fn)
    sub.add_parser("selftest").set_defaults(fn=cmd_selftest)
    a = p.parse_args()
    a.fn(a)


if __name__ == "__main__":
    main()
