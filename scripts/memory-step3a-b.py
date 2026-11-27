#!/usr/bin/env python3
"""Step 3a-B: general_fact path on contract bundles (build / predict-reader / predict / score / finalize / selftest).

Preregistration: docs/Memory research/xion-memory-research-docs/memory-storage-routing-design.md
("Step 3a-B - general_fact path on contract bundles"). Same reader, Extractor, instructions, prefill, adapter
assignment and scoring as step 3a (scripts/memory-step3a.py, imported via importlib); the only change is the user
JSON `evidence` list, which becomes the owner-reviewed contract bundle (galpi-private/bundle-gold) in episode order.
Value marks are inherited from the step 3a owner review when the predicted string for the same anchor is identical.
No API calls, no DB writes.
Private rule: never print conversation text, values or raw outputs. Only counts, ids, keys and booleans are printed.
Run with the private train-env python, HF_HUB_OFFLINE=1, nice -n 19.
"""
import argparse
import importlib.util
import json
import os
import sys

os.environ.setdefault("HF_HUB_OFFLINE", "1")
HERE = os.path.dirname(os.path.abspath(__file__))


def _load(name, fn):
    spec = importlib.util.spec_from_file_location(name, f"{HERE}/{fn}")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


S = _load("step3a", "memory-step3a.py")
RR = _load("step3a_r", "memory-step3a-r.py")
ROOT = S.ROOT
OUT = f"{ROOT}/step3a-b"
A3 = f"{ROOT}/step3a"
READER_CLASSES = ["general_fact", "DEFERRED", "project"]


def ser(u):
    return json.dumps(u, ensure_ascii=False, separators=(",", ":"))


def ensure_out():
    os.makedirs(OUT, mode=0o700, exist_ok=True)
    os.chmod(OUT, 0o700)


def swap_evidence(u, episode_turns, keep_ids):
    """Replace only u['evidence'] by the episode turns in keep_ids, in episode order, with the original per-turn
    key order. Every id must exist in the episode. Returns a new dict with unchanged key order."""
    by_id = {t["turnId"]: t for t in episode_turns}
    missing = [i for i in keep_ids if i not in by_id]
    if missing:
        raise ValueError(f"TURN_NOT_FOUND {len(missing)}")
    keys = list(u["evidence"][0].keys()) if u["evidence"] else ["turnId", "role", "text", "createdAt"]
    ev = [{k: t[k] for k in keys} for t in episode_turns if t["turnId"] in set(keep_ids)]
    if len(ev) != len(set(keep_ids)):
        raise ValueError("DUPLICATE_TURN_IDS")
    return {k: (ev if k == "evidence" else v) for k, v in u.items()}


# --------------------------------------------------------------------------- build
def cmd_build(_):
    ensure_out()
    bundles = S.jl(f"{ROOT}/bundle-gold/bundles-reviewed.jsonl")
    rdr = {r["itemId"]: r for r in S.jl(f"{ROOT}/reader-tuning/data/train.jsonl")}
    ext = {r["itemId"]: r for r in S.jl(f"{ROOT}/extractor-tuning/data/train.jsonl")}
    ext_instr = open(f"{ROOT}/extractor-tuning/data/instructions.txt", encoding="utf-8").read()
    dur = {r["itemId"]: r for r in S.jl(f"{ROOT}/formation-tuning/labels-train-durability.jsonl")}
    old_adapter = {r["itemId"]: r["adapter"] for r in S.jl(f"{A3}/items.jsonl")}
    episodes = {}
    items, resolved, rebuild_ok, user_same, adapter_checked = [], 0, 0, 0, 0
    for b in bundles:
        iid = b["itemId"]
        r = rdr[iid]
        if r["anchorTurnId"] != b["anchorTurnId"]:
            raise SystemExit(f"ANCHOR_MISMATCH {iid[:8]}")
        ep = episodes.get(r["episodeId"]) or json.load(open(f"{ROOT}/formation-tuning/episodes/{r['episodeId']}.json"))
        episodes[r["episodeId"]] = ep
        turns = ep["turns"]
        raw = r["messages"][1]["content"]
        u = json.loads(raw)
        if ser(u) != raw:
            raise SystemExit(f"SERIALIZATION_NOT_REPRODUCED {iid[:8]}")
        # control: rebuilding the ORIGINAL window evidence from the episode must reproduce the original bytes
        orig_ids = [t["turnId"] for t in u["evidence"]]
        try:
            rebuilt = swap_evidence(u, turns, orig_ids)
        except ValueError:
            raise SystemExit(f"WINDOW_TURN_NOT_IN_EPISODE {iid[:8]}")
        if ser(rebuilt) == raw:
            rebuild_ok += 1
        else:
            raise SystemExit(f"WINDOW_REBUILD_DIFFERS {iid[:8]}")
        bundle_ids = b["bundleTurnIds"]
        if b["anchorTurnId"] not in bundle_ids:
            raise SystemExit(f"ANCHOR_NOT_IN_BUNDLE {iid[:8]}")
        nu = swap_evidence(u, turns, bundle_ids)
        resolved += len(nu["evidence"])
        if [t["turnId"] for t in nu["evidence"]] != [t["turnId"] for t in turns if t["turnId"] in set(bundle_ids)]:
            raise SystemExit(f"ORDER {iid[:8]}")
        if {k: v for k, v in nu.items() if k != "evidence"} != {k: v for k, v in u.items() if k != "evidence"} \
                or list(nu.keys()) != list(u.keys()):
            raise SystemExit(f"NON_EVIDENCE_CHANGED {iid[:8]}")
        new_user = ser(nu)
        # reader / extractor inputs
        e = ext.get(iid)
        if r["queue"] == "extractor":
            if e is None:
                raise SystemExit(f"EXTRACTOR_ROW_MISSING {iid[:8]}")
            if e["messages"][1]["content"] != raw or e["messages"][0]["content"] != ext_instr:
                raise SystemExit(f"EXTRACTOR_INPUT_DIFFERS {iid[:8]}")
            user_same += 1
        reader_msgs = [dict(r["messages"][0]), {"role": r["messages"][1]["role"], "content": new_user}]
        ext_msgs = [{"role": "system", "content": ext_instr}, {"role": "user", "content": new_user}]
        if r["queue"] == "extractor":
            gold = json.loads(e["messages"][2]["content"])
            adapter = f"4b-f{e['fold']}"
        else:
            gold = (dur[iid] or {}).get("gold") or {}
            adapter = "4b-all"
        if iid in old_adapter:
            adapter_checked += 1
            if old_adapter[iid] != adapter:
                raise SystemExit(f"ADAPTER_DIFFERS_FROM_STEP3A {iid[:8]}")
        radapter = f"{ROOT}/reader-tuning/cv/f{r['fold']}"
        if not os.path.isdir(radapter):
            raise SystemExit(f"READER_ADAPTER_MISSING f{r['fold']}")
        p = gold.get("payload") or {}
        gkey, gval = (p.get("attributeKey"), p.get("value")) if r["label"] == "general_fact" else (None, None)
        items.append({"itemId": iid, "readerAdapter": f"f{r['fold']}", "extractorAdapter": adapter,
                      "goldFamily": r["label"], "goldKey": gkey, "goldValue": gval,
                      "goldEvidenceTurnIds": gold.get("evidenceTurnIds") or [], "bundleTurnIds": bundle_ids,
                      "readerMessages": reader_msgs, "extractorMessages": ext_msgs})
    S.write_jl(f"{OUT}/items.jsonl", items)
    cnt = {}
    for it in items:
        for k in (f"readerAdapter:{it['readerAdapter']}", f"extractorAdapter:{it['extractorAdapter']}",
                  f"goldFamily:{it['goldFamily']}"):
            cnt[k] = cnt.get(k, 0) + 1
    print(json.dumps({"items": len(items), "bundleTurnsResolved": resolved,
                      "windowRebuildByteEqual": f"{rebuild_ok}/{len(items)}",
                      "extractorQueueInputUserEqualsReaderUser": f"{user_same}/{sum(1 for i in items if i['extractorAdapter'] != '4b-all')}",
                      "adapterMatchesStep3a": f"{adapter_checked} checked", "counts": cnt}, sort_keys=True))


# --------------------------------------------------------------------------- predict-reader
def cmd_predict_reader(a):
    ensure_out()
    items = S.jl(f"{OUT}/items.jsonl")
    path = f"{OUT}/reader.pred.jsonl"
    done = {r["itemId"] for r in S.jl(path)} if os.path.exists(path) else set()
    todo = [i for i in items if i["itemId"] not in done]
    if a.limit:
        todo = todo[:a.limit]
    if not todo:
        print(json.dumps({"generated": 0}))
        return
    import torch
    R = _load("reader_tune", "memory-reader-tune.py")
    E = R.E
    n, counts = 0, {}
    for name in sorted({i["readerAdapter"] for i in todo}):
        mine = [i for i in todo if i["readerAdapter"] == name]
        tok, model = E.load_model("4b", adapter=f"{ROOT}/reader-tuning/cv/{name}")
        model.eval()
        with open(path, "a", encoding="utf-8") as f:
            for it in mine:
                x = tok(E.chat_ids(tok, it["readerMessages"], True), add_special_tokens=False,
                        return_tensors="pt").input_ids.to("cuda:0")
                with torch.no_grad():
                    out = model.generate(input_ids=x, max_new_tokens=E.MAX_NEW, do_sample=False,
                                         pad_token_id=tok.pad_token_id or tok.eos_token_id)
                raw = tok.decode(out[0, x.shape[1]:], skip_special_tokens=True)
                label = R.parse_label(raw)
                counts[str(label)] = counts.get(str(label), 0) + 1
                f.write(json.dumps({"itemId": it["itemId"], "raw": raw, "label": label}, ensure_ascii=False) + "\n")
                f.flush()
                n += 1
        del model
        torch.cuda.empty_cache()
    os.chmod(path, 0o600)
    print(json.dumps({"generated": n, "parsedLabels": counts}))


# --------------------------------------------------------------------------- predict (extractor)
def cmd_predict(a):
    ensure_out()
    items = S.jl(f"{OUT}/items.jsonl")
    reader = {r["itemId"]: r["label"] for r in S.jl(f"{OUT}/reader.pred.jsonl")}
    if len(reader) != len(items):
        raise SystemExit(f"READER_PRED_INCOMPLETE {len(reader)}/{len(items)}")
    path = f"{OUT}/pred.jsonl"
    done = {r["itemId"] for r in S.jl(path)} if os.path.exists(path) else set()
    todo = [i for i in items if reader.get(i["itemId"]) == "general_fact" and i["itemId"] not in done]
    if a.limit:
        todo = todo[:a.limit]
    if not todo:
        print(json.dumps({"generated": 0}))
        return
    import torch
    E = S.load_E()
    n = 0
    for name in S.ADAPTERS:
        mine = [i for i in todo if i["extractorAdapter"] == name]
        if not mine:
            continue
        tok, model = E.load_model("4b", adapter=S.adapter_path(name))
        model.eval()
        pre = tok(S.PREFILL, add_special_tokens=False, return_tensors="pt").input_ids
        with open(path, "a", encoding="utf-8") as f:
            for it in mine:
                x = tok(E.chat_ids(tok, it["extractorMessages"], True), add_special_tokens=False,
                        return_tensors="pt").input_ids
                x = torch.cat([x, pre], dim=1).to("cuda:0")
                with torch.no_grad():
                    out = model.generate(input_ids=x, max_new_tokens=E.MAX_NEW, do_sample=False,
                                         pad_token_id=tok.pad_token_id or tok.eos_token_id)
                raw = S.PREFILL + tok.decode(out[0, x.shape[1]:], skip_special_tokens=True)
                f.write(json.dumps({"itemId": it["itemId"], "raw": raw}, ensure_ascii=False) + "\n")
                f.flush()
                n += 1
        del model
        torch.cuda.empty_cache()
    os.chmod(path, 0o600)
    print(json.dumps({"generated": n}))


# --------------------------------------------------------------------------- score
def cited_ids(raw):
    try:
        v = json.loads(raw).get("evidenceTurnIds")
    except Exception:
        return None
    return [x for x in v if isinstance(x, str)] if isinstance(v, list) else None


def evidence_report(items, preds):
    """Aggregate overlap of cited evidenceTurnIds with the owner's train-label evidence and the bundle."""
    rep = {"proposalsWithCitations": 0, "citedTotal": 0, "citedInBundle": 0, "citedOutsideBundle": 0,
           "goldTotal": 0, "goldCited": 0, "citedInGold": 0, "uncitedProposals": 0}
    for it in items:
        raw = preds.get(it["itemId"])
        if raw is None:
            continue
        c = cited_ids(raw)
        if c is None:
            rep["uncitedProposals"] += 1
            continue
        rep["proposalsWithCitations"] += 1
        cs, gs, bs = set(c), set(it["goldEvidenceTurnIds"]), set(it["bundleTurnIds"])
        rep["citedTotal"] += len(cs)
        rep["citedInBundle"] += len(cs & bs)
        rep["citedOutsideBundle"] += len(cs - bs)
        rep["goldTotal"] += len(gs)
        rep["goldCited"] += len(gs & cs)
        rep["citedInGold"] += len(cs & gs)
    return rep


def old_value_marks(items):
    """step 3a owner marks for these ids: itemId -> normalized mark (matches by 8-char id, train rows)."""
    old = RR.old_marks(open(f"{A3}/owner-review.md", encoding="utf-8").read())
    return {it["itemId"]: old.get(("train", it["itemId"][:8]), (None, ""))[1] for it in items}


def by_type(wrong_mech, different):
    return {"reader": wrong_mech.get("gold_not_general_fact", 0),
            "key": sum(wrong_mech.get(k, 0) for k in ("key_mismatch", "invalid_key", "malformed")),
            "value": different}


def cmd_score(_):
    items = S.jl(f"{OUT}/items.jsonl")
    for it in items:
        it["split"] = "train"
    ids = {it["itemId"] for it in items}
    gold_gf = [it["itemId"] for it in items if it["goldFamily"] == "general_fact"]
    gold_ids = {"train": gold_gf, "eval": []}
    reader = {r["itemId"]: r["label"] for r in S.jl(f"{OUT}/reader.pred.jsonl")}
    preds = {r["itemId"]: r["raw"] for r in S.jl(f"{OUT}/pred.jsonl")}
    # reader confusion over all 72 (gold label -> read label)
    conf = {g: {str(p): 0 for p in READER_CLASSES + [None]} for g in READER_CLASSES}
    for it in items:
        conf[it["goldFamily"]][str(reader.get(it["itemId"]))] += 1
    out, review = S.score_core(items, preds, gold_ids)
    sid = [r["itemId"][:8] for r in review]
    if len(set(sid)) != len(sid):
        raise SystemExit("SHORT_ID_COLLISION")
    # the reader gate: preds must only exist for reader-general_fact items
    stray = [i for i in preds if reader.get(i) != "general_fact"]
    if stray:
        raise SystemExit(f"PRED_WITHOUT_READER_GENERAL_FACT {len(stray)}")
    old = RR.old_marks(open(f"{A3}/owner-review.md", encoding="utf-8").read())
    needs, inh = RR.split_review(review, old)
    out["review"] = {"needsOwner": len(needs), "inherited": len(inh)}
    # step 3a on the same anchors (side-by-side, report only)
    s3_items = [dict(i, split="train") for i in S.jl(f"{A3}/items.jsonl") if i["itemId"] in ids]
    s3_preds = {r["itemId"]: r["raw"] for r in S.jl(f"{A3}/pred.jsonl") if r["itemId"] in ids}
    s3_out, s3_review = S.score_core(s3_items, s3_preds, gold_ids)
    marks3 = old_value_marks(items)
    s3_diff = sum(1 for r in s3_review if marks3.get(r["itemId"]) == "다름")
    s3_unmarked = sum(1 for r in s3_review if not marks3.get(r["itemId"]))
    t3 = s3_out["train"]
    side = {"step3a": {"proposals": t3["proposals"], "misses": t3["misses"], "wrongMechanical": t3["wrongMechanical"],
                       "ownerDifferent": s3_diff, "unmarkedKeyMatching": s3_unmarked,
                       "wrongByType": by_type(t3["wrongMechanical"], s3_diff)},
            "step3aB": {"proposals": out["train"]["proposals"], "misses": out["train"]["misses"],
                        "wrongMechanical": out["train"]["wrongMechanical"],
                        "wrongByTypeMechanicalOnly": by_type(out["train"]["wrongMechanical"], 0),
                        "valuesAwaitingOwner": len(needs), "valuesInheritedMark": len(inh),
                        "inheritedDifferent": sum(1 for r in inh if r["mark"] == "다름")}}
    report = {"readerConfusionGoldToRead": conf,
              "readerGeneralFactAmongGoldGeneralFact": f"{conf['general_fact']['general_fact']}/{sum(conf['general_fact'].values())}",
              "readerDeferredPassedAsGeneralFact": f"{conf['DEFERRED']['general_fact']}/{sum(conf['DEFERRED'].values())}",
              "sideBySide": side, "evidence": evidence_report(items, preds)}
    out["report"] = report
    json.dump(out, open(f"{OUT}/score.json", "w"), indent=1)
    os.chmod(f"{OUT}/score.json", 0o600)
    head = ["| split | id | attributeKey | gold value | predicted value | 같음/다름 |", "| --- | --- | --- | --- | --- | --- |"]
    lines = ["# Step 3a-B owner review", "",
             "각 행의 마지막 칸에 `같음`(예측 값이 gold와 같은 뜻) 또는 `다름`을 적는다. 표현 차이는 같음이다.", ""] + head
    for r in needs:
        lines.append(f"| {r['split']} | {r['itemId'][:8]} | {r['key']} | {S.cell(r['gold'])} | {S.cell(r['pred'])} |  |")
    lines += ["", "## inherited (같은 itemId에서 step 3a가 이미 판정한 값과 문자열이 같아 표를 물려받음)", ""] + head
    for r in inh:
        lines.append(f"| {r['split']} | {r['itemId'][:8]} | {r['key']} | {S.cell(r['gold'])} | {S.cell(r['pred'])} | {r['mark']} |")
    path = f"{OUT}/owner-review.md"
    open(path, "w", encoding="utf-8").write("\n".join(lines) + "\n")
    os.chmod(path, 0o600)
    print(json.dumps(out, sort_keys=True))


# --------------------------------------------------------------------------- finalize
def cmd_finalize(a):
    score = json.load(open(f"{OUT}/score.json"))
    marks = S.read_marks(open(a.review, encoding="utf-8").read())
    if len(marks) != score["review"]["needsOwner"] + score["review"]["inherited"]:
        print(json.dumps({"error": "REVIEW_ROWS_MISMATCH", "rows": len(marks)}))
        sys.exit(1)
    res = S.finalize_core(score, marks)
    if res["unmarked"] or res["invalidMarks"]:
        print(json.dumps({"error": "INCOMPLETE_REVIEW", "unmarked": res["unmarked"], "invalidMarks": res["invalidMarks"]}))
        sys.exit(1)
    res["wrongByType"] = by_type(score["train"]["wrongMechanical"], res["train"]["ownerDifferent"])
    json.dump(res, open(f"{OUT}/final.json", "w"), indent=1)
    os.chmod(f"{OUT}/final.json", 0o600)
    print(json.dumps(res, sort_keys=True))


# --------------------------------------------------------------------------- selftest
def cmd_selftest(_):
    ok = lambda c, m: (_ for _ in ()).throw(AssertionError(m)) if not c else None
    turns = [{"turnId": f"m{i}", "messageId": i, "role": "user" if i % 2 else "assistant", "text": f"t{i} |x", "createdAt": f"c{i}"}
             for i in range(1, 8)]
    u = {"anchor": {"text": "t4", "turnId": "m4"}, "attributes": {"k": 1},
         "evidence": [{"turnId": f"m{i}", "role": turns[i - 1]["role"], "text": turns[i - 1]["text"], "createdAt": f"c{i}"}
                      for i in range(2, 7)]}
    ok(ser(swap_evidence(u, turns, [t["turnId"] for t in u["evidence"]])) == ser(u), "window rebuild is byte-equal")
    nu = swap_evidence(u, turns, ["m4", "m3"])
    ok([t["turnId"] for t in nu["evidence"]] == ["m3", "m4"], "episode order")
    ok(list(nu.keys()) == list(u.keys()) and nu["anchor"] == u["anchor"] and nu["attributes"] == u["attributes"], "only evidence differs")
    ok(list(nu["evidence"][0].keys()) == ["turnId", "role", "text", "createdAt"], "per-turn key order")
    ok(json.loads(ser(nu))["evidence"][1] == {"turnId": "m4", "role": "assistant", "text": "t4 |x", "createdAt": "c4"}, "turn fields")
    try:
        swap_evidence(u, turns, ["m4", "m99"])
        ok(False, "missing turn must raise")
    except ValueError:
        pass
    # pass boundary (step 3a rule): 20 proposals, 4 wrong passes; 5 fails; <20 fails
    sc = lambda n, mech: {"train": {"proposals": n, "wrongMechanicalTotal": mech, "misses": 0},
                          "eval": {"proposals": 0, "wrongMechanicalTotal": 0, "misses": 0}}
    mk = lambda same, diff: {("train", f"s{i}"): "같음" for i in range(same)} | {("train", f"d{i}"): "다름" for i in range(diff)}
    ok(S.finalize_core(sc(20, 2), mk(16, 2))["pass"] is True, "boundary 4/20 passes")
    ok(S.finalize_core(sc(20, 2), mk(15, 3))["pass"] is False, "5/20 fails")
    ok(S.finalize_core(sc(19, 0), mk(19, 0))["pass"] is False, "19 proposals fails")
    # mark inheritance: identical string inherits, changed string needs the owner
    old = RR.old_marks("| train | aaaaaaaa | k | g | same | 같음 |\n| train | bbbbbbbb | k | g | x\\|y | 다름 |\n")
    rv = [dict(split="train", itemId="aaaaaaaa" + "0" * 56, key="k", gold="g", pred="same"),
          dict(split="train", itemId="bbbbbbbb" + "0" * 56, key="k", gold="g", pred="x|y"),
          dict(split="train", itemId="cccccccc" + "0" * 56, key="k", gold="g", pred="new"),
          dict(split="train", itemId="aaaaaaaa" + "1" * 56, key="k", gold="g", pred="changed")]
    needs, inh = RR.split_review(rv, old)
    ok([r["mark"] for r in inh] == ["같음", "다름"] and [r["pred"] for r in needs] == ["new", "changed"], "inheritance")
    # evidence report and type split
    it = {"itemId": "i", "goldEvidenceTurnIds": ["m1", "m2"], "bundleTurnIds": ["m2", "m3"]}
    raw = S.PREFIX + '"evidenceTurnIds":["m2","m9"],"payload":{}}'
    rep = evidence_report([it], {"i": raw})
    ok(rep["citedTotal"] == 2 and rep["citedInBundle"] == 1 and rep["citedOutsideBundle"] == 1 and rep["goldCited"] == 1, "evidence report")
    ok(by_type({"gold_not_general_fact": 2, "key_mismatch": 1, "malformed": 1}, 3) == {"reader": 2, "key": 2, "value": 3}, "by type")
    print(json.dumps({"selftest": "ok"}))


def main():
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("build").set_defaults(fn=cmd_build)
    for name, fn in (("predict-reader", cmd_predict_reader), ("predict", cmd_predict)):
        q = sub.add_parser(name)
        q.add_argument("--limit", type=int, default=0)
        q.set_defaults(fn=fn)
    sub.add_parser("score").set_defaults(fn=cmd_score)
    f = sub.add_parser("finalize")
    f.add_argument("--review", required=True)
    f.set_defaults(fn=cmd_finalize)
    sub.add_parser("selftest").set_defaults(fn=cmd_selftest)
    a = p.parse_args()
    a.fn(a)


if __name__ == "__main__":
    main()
