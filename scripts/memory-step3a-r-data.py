#!/usr/bin/env python3
"""Step 3a-R data: refined-bundle Extractor data (evidence = turns in gold evidenceTurnIds; DEFERRED = anchor only).

Mirrors galpi-private/extractor-tuning/data/{train,eval}.jsonl row-for-row; only the user JSON `evidence` list changes.
Private rule: prints counts and booleans only.
"""
import json
import os
import shutil
import statistics
import sys

ROOT = "/home/rnlcksgxk/projects/galpi-private"
SRC = f"{ROOT}/extractor-tuning/data"
OUT = f"{ROOT}/step3a-r/data"


def ser(u):
    return json.dumps(u, ensure_ascii=False, separators=(",", ":"))


def refine(u, gold):
    """Return (new user dict, anchor_found)."""
    ids = set(gold.get("evidenceTurnIds") or [])
    aid = u["anchor"]["turnId"]
    keep = ids if ids else {aid}
    ev = [t for t in u["evidence"] if t["turnId"] in keep]
    return {**u, "evidence": ev}, any(t["turnId"] == aid for t in ev)


def main():
    os.makedirs(OUT, mode=0o700, exist_ok=True)
    os.chmod(f"{ROOT}/step3a-r", 0o700)
    os.chmod(OUT, 0o700)
    stats = {}
    for split in ("train", "eval"):
        rows = [json.loads(l) for l in open(f"{SRC}/{split}.jsonl", encoding="utf-8") if l.strip()]
        before, after, miss, outrows = [], [], 0, []
        for r in rows:
            raw = r["messages"][1]["content"]
            u = json.loads(raw)
            if ser(u) != raw:
                raise SystemExit(f"BYTE_CHECK_FAIL {split} {r['itemId'][:8]}")
            gold = json.loads(r["messages"][2]["content"])
            nu, found = refine(u, gold)
            miss += not found
            before.append(len(u["evidence"]))
            after.append(len(nu["evidence"]))
            msgs = [dict(m) for m in r["messages"]]
            msgs[1]["content"] = ser(nu)
            outrows.append({**r, "messages": msgs})
        p = f"{OUT}/{split}.jsonl"
        with open(p, "w", encoding="utf-8") as f:
            for r in outrows:
                f.write(json.dumps(r, ensure_ascii=False) + "\n")
        os.chmod(p, 0o600)
        stats[split] = {"rows": len(rows), "byteCheck": f"{len(rows)}/{len(rows)}",
                        "medianEvidenceBefore": statistics.median(before),
                        "medianEvidenceAfter": statistics.median(after), "anchorMissing": miss}
        if miss:
            raise SystemExit(f"ANCHOR_MISSING {split} {miss}")
    for fn in os.listdir(SRC):
        if fn not in ("train.jsonl", "eval.jsonl"):
            shutil.copy(f"{SRC}/{fn}", f"{OUT}/{fn}")
            os.chmod(f"{OUT}/{fn}", 0o600)
    print(json.dumps(stats, sort_keys=True))


if __name__ == "__main__":
    main()
