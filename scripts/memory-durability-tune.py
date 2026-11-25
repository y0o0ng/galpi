#!/usr/bin/env python3
"""Preregistered full fine-tune of Laya for Durability (WRITE / NO_WRITE), long-context states.

Usage: memory-durability-tune.py self-check | probe | cv | base | final | eval
Root (private): durability-tuning/ holds data-train.jsonl, data-eval.jsonl (scripts/memory-durability-tuning-data.js)
and receives probe.json, cv-scores.json, threshold.json, base-train.json, final/, eval-result.json.
Hidden: smoke [--limit N] runs a 1-epoch fit+score on N train rows into <root>/smoke.
"""
import importlib.util
import json
import os
import shutil
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("laya_durability", os.path.join(HERE, "memory-laya-durability.py"))
LD = importlib.util.module_from_spec(spec)
spec.loader.exec_module(LD)

ROOT = "/home/rnlcksgxk/projects/galpi-private/durability-tuning"
BASE = "/home/rnlcksgxk/projects/galpi-private/formation-tuning/laya/base"
QID = LD.QID
INSTRUCTIONS = ("[ANCHOR]로 표시된 발언에 오래 기억할 가치가 있는 사용자 자신의 정보가 있는가? "
                "예: 목표, 계획, 구매 계획, 결정, 진행 단계, 막힌 점, 소속, 전공, 취향, 소유물, 성향, 어시스턴트에게 주는 지속 지시. "
                "아니오: 날짜·시각이 붙은 일정과 그 등록·변경 요청, 메일·뉴스 알림 같은 다른 시스템의 설정, 지나가는 반응과 감정, "
                "산출물의 세부 내용, 이유나 감정만 말하는 발언.")
QUESTIONS = {QID: {"type": "noul", "instructions": INSTRUCTIONS}}
MAX_LEN, HEAD_MAX_LEN = 8192, 256
STATE_BUDGET = MAX_LEN - HEAD_MAX_LEN  # 7936
EPOCHS = 4
EFFECTIVE_BATCH = 8
LADDER = [(8, 1), (4, 2), (2, 4), (1, 8)]


def config(micro_batch=8, grad_accum=1, epochs=EPOCHS):
    from laya.train import TrainConfig
    return TrainConfig(freeze_encoder=False, epochs=epochs, micro_batch=micro_batch, grad_accum=grad_accum,
                       max_len=MAX_LEN, head_max_len=HEAD_MAX_LEN, seed=0)


def config_record(micro_batch, grad_accum, epochs=EPOCHS):
    return {"freeze_encoder": False, "epochs": epochs, "micro_batch": micro_batch, "grad_accum": grad_accum,
            "max_len": MAX_LEN, "head_max_len": HEAD_MAX_LEN, "seed": 0, "stateBudget": STATE_BUDGET}


def batching(root):
    path = os.path.join(root, "probe.json")
    if not os.path.exists(path):
        return 8, 1
    with open(path, encoding="utf-8") as f:
        fit = json.load(f)["fit"]
    return fit["micro_batch"], fit["grad_accum"]


def prepare(path, base=BASE):
    from transformers import AutoTokenizer
    tok = AutoTokenizer.from_pretrained(os.path.join(base, "tokenizer"))
    count = lambda text: len(tok(text, add_special_tokens=False)["input_ids"])
    rows = LD.read_rows(path)
    built = {row["itemId"]: LD.build_state(row, count, STATE_BUDGET) for row in rows}
    tokens = {k: count(v[0]) for k, v in built.items()}
    return rows, {k: v[0] for k, v in built.items()}, sum(v[1] for v in built.values()), tokens


def write_training(rows, states, data):
    with open(os.open(data, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), "w", encoding="utf-8") as f:
        for row in rows:
            f.write(json.dumps({"state": states[row["itemId"]], "questions": QUESTIONS, "expected": {QID: row["write"]}}, ensure_ascii=False) + "\n")


def fit(rows, states, out, batch, epochs=EPOCHS):
    import functools
    import laya.train as lt
    from laya.train import finetune
    # Calibration scores 16 states per fp32 forward with no fused attention, which needs ~16 GB at 7k tokens.
    # One state per forward gives the same per-item logits (padding is masked) within memory.
    if not isinstance(lt.calibration_records, functools.partial):
        lt.calibration_records = functools.partial(lt.calibration_records, batch_size=1)
    data = out + ".jsonl"
    write_training(rows, states, data)
    try:
        finetune(data, BASE, out, config(batch[0], batch[1], epochs), device="cuda")
    finally:
        os.remove(data)


def score(rows, states, checkpoint):
    import laya
    agent = laya.load(checkpoint, device="cuda")
    return [agent.predict(states[r["itemId"]], QUESTIONS, max_len=MAX_LEN, head_max_len=HEAD_MAX_LEN)["answers"][QID]["noul"] for r in rows]


def probe(root):
    import torch
    rows, states, truncated, tokens = prepare(os.path.join(root, "data-train.jsonl"))
    values = sorted(tokens.values())
    result = {"states": len(rows), "maxStateTokens": values[-1], "meanStateTokens": sum(values) / len(values),
              "truncated": truncated, "stateBudget": STATE_BUDGET}
    longest = sorted(rows, key=lambda r: -tokens[r["itemId"]])[:8]
    out = os.path.join(root, "probe-ckpt")
    attempts = []
    for micro, accum in LADDER:
        torch.cuda.empty_cache()
        torch.cuda.reset_peak_memory_stats()
        start = time.time()
        try:
            fit(longest, states, out, (micro, accum), epochs=1)
            attempts.append({"micro_batch": micro, "grad_accum": accum, "ok": True, "peakMiB": torch.cuda.max_memory_allocated() / 2**20,
                             "seconds": time.time() - start})
            result["fit"] = {"micro_batch": micro, "grad_accum": accum}
            break
        except torch.cuda.OutOfMemoryError:
            attempts.append({"micro_batch": micro, "grad_accum": accum, "ok": False, "error": "OOM", "seconds": time.time() - start})
        finally:
            shutil.rmtree(out, ignore_errors=True)
            if os.path.exists(out + ".jsonl"):
                os.remove(out + ".jsonl")
    result["attempts"] = attempts
    LD.write_json(os.path.join(root, "probe.json"), result)
    print(json.dumps(result))
    if "fit" not in result:
        raise SystemExit("NO_BATCHING_FITS")


def load_json(path, default=None):
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    return default


def cv(root, limit=None):
    rows, states, truncated, _ = prepare(os.path.join(root, "data-train.jsonl"))
    batch = batching(root)
    folds = LD.assign_folds(rows)
    path = os.path.join(root, "cv-scores.json")
    scored = load_json(path, {})
    for fold in range(LD.FOLDS):
        held = [r for r in rows if folds[r["episodeId"]] == fold]
        if all(r["itemId"] in scored for r in held):
            continue
        out = os.path.join(root, "fold-%d" % fold)
        fit([r for r in rows if folds[r["episodeId"]] != fold], states, out, batch)
        scored.update(zip((r["itemId"] for r in held), score(held, states, out)))
        shutil.rmtree(out)
        LD.write_json(path, scored)
        print(json.dumps({"fold": fold, "scored": len(scored)}), flush=True)
    scores = [scored[r["itemId"]] for r in rows]
    labels = [r["write"] for r in rows]
    threshold = LD.pick_threshold(scores, labels)
    result = {"truncated": truncated, "config": config_record(*batch), **LD.summary(scores, labels, threshold)}
    LD.write_json(os.path.join(root, "threshold.json"), result)
    print(json.dumps(result))


def base_scores(root):
    import laya
    rows, states, truncated, _ = prepare(os.path.join(root, "data-train.jsonl"))
    agent = laya.load(BASE, device="cuda")
    scores = [agent.predict(states[r["itemId"]], QUESTIONS, max_len=MAX_LEN, head_max_len=HEAD_MAX_LEN)["answers"][QID]["noul"] for r in rows]
    labels = [r["write"] for r in rows]
    threshold = LD.pick_threshold(scores, labels)
    result = {"truncated": truncated, "reference": "untuned base on train, threshold picked on the same scores", **LD.summary(scores, labels, threshold)}
    LD.write_json(os.path.join(root, "base-train.json"), result)
    print(json.dumps(result))


def final(root):
    rows, states, _, _ = prepare(os.path.join(root, "data-train.jsonl"))
    fit(rows, states, os.path.join(root, "final"), batching(root))
    print(json.dumps({"final": len(rows)}))


def evaluate(root):
    result_path = os.path.join(root, "eval-result.json")
    if os.path.exists(result_path):
        raise SystemExit("EVAL_ALREADY_SCORED")
    import laya
    threshold = load_json(os.path.join(root, "threshold.json"))["threshold"]
    base_threshold = load_json(os.path.join(root, "base-train.json"))["threshold"]
    rows, states, truncated, _ = prepare(os.path.join(root, "data-eval.jsonl"))
    scores = score(rows, states, os.path.join(root, "final"))
    labels = [r["write"] for r in rows]
    base = laya.load(BASE, device="cuda")
    base_s = [base.predict(states[r["itemId"]], QUESTIONS, max_len=MAX_LEN, head_max_len=HEAD_MAX_LEN)["answers"][QID]["noul"] for r in rows]
    result = {"truncated": truncated, "tuned": LD.summary(scores, labels, threshold),
              "baseReference": LD.summary(base_s, labels, base_threshold),
              "items": [{"itemId": r["itemId"], "write": r["write"], "score": s, "baseScore": b} for r, s, b in zip(rows, scores, base_s)]}
    LD.write_json(result_path, result)
    print(json.dumps({k: v for k, v in result.items() if k != "items"}))


def smoke(root, limit):
    rows, states, _, _ = prepare(os.path.join(root, "data-train.jsonl"))
    rows = rows[:limit]
    out = os.path.join(root, "smoke", "ckpt")
    os.makedirs(os.path.dirname(out), mode=0o700, exist_ok=True)
    batch = batching(root)
    try:
        fit(rows, states, out, batch, epochs=1)
        scores = score(rows[:4], states, out)
        assert len(scores) == 4 and all(0 <= s <= 1 for s in scores), scores
        print(json.dumps({"smoke": "ok", "fitRows": len(rows), "scored": len(scores), "batch": batch,
                          "scoreRange": [min(scores), max(scores)]}))
    finally:
        shutil.rmtree(os.path.join(root, "smoke"), ignore_errors=True)


def self_check():
    assert STATE_BUDGET == 7936 and MAX_LEN - HEAD_MAX_LEN == STATE_BUDGET
    assert INSTRUCTIONS.startswith("[ANCHOR]로 표시된") and "구매 계획" in INSTRUCTIONS and "이유나 감정만 말하는 발언." in INSTRUCTIONS
    assert QUESTIONS[QID]["type"] == "noul"
    c = config()
    assert (c.freeze_encoder, c.epochs, c.micro_batch, c.grad_accum, c.max_len, c.head_max_len, c.seed) == (False, 4, 8, 1, 8192, 256, 0)
    assert all(m * a == EFFECTIVE_BATCH for m, a in LADDER)
    words = lambda text: len(text.split())
    row = {"anchor": {"turnId": "b", "text": "앵커"},
           "turns": [{"turnId": "a", "role": "user", "text": "하나 둘"}, {"turnId": "b", "role": "user", "text": "앵커 말"}]}
    state, truncated = LD.build_state(row, words, STATE_BUDGET)
    assert "[ANCHOR]앵커[/ANCHOR]" in state and not truncated
    assert batching("/nonexistent") == (8, 1)
    print("ok")


if __name__ == "__main__":
    os.environ.setdefault("HF_HUB_OFFLINE", "1")
    os.environ.setdefault("PYTORCH_CUDA_ALLOC_CONF", "expandable_segments:True")
    command = sys.argv[1] if len(sys.argv) > 1 else ""
    if command == "self-check":
        self_check()
    elif command == "smoke":
        smoke(ROOT, int(sys.argv[sys.argv.index("--limit") + 1]) if "--limit" in sys.argv else 16)
    elif command in ("probe", "cv", "base", "final", "eval") and len(sys.argv) == 2:
        {"probe": probe, "cv": cv, "base": base_scores, "final": final, "eval": evaluate}[command](ROOT)
    else:
        raise SystemExit(__doc__)
