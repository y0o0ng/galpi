#!/usr/bin/env python3
"""Preregistered frozen-backbone Laya check for Durability (routing design, 2026-11-05).

Usage: memory-laya-durability.py self-check | cv <dir> | final <dir> | eval <dir>
<dir> is private: it holds base/, data-train.jsonl and, for eval only, data-eval.jsonl.
"""
import json
import os
import shutil
import sys

QID = "keep"
INSTRUCTIONS = ("[ANCHOR]로 표시된 발언에 오래 기억할 가치가 있는 사용자 자신의 정보가 있는가? "
                "예: 목표, 계획, 결정, 진행 단계, 막힌 점, 소속, 전공, 취향, 소유물. "
                "아니오: 일회성 일정과 명령, 지나가는 반응, 산출물의 세부 내용.")
QUESTIONS = {QID: {"type": "noul", "instructions": INSTRUCTIONS}}
MAX_LEN, HEAD_MAX_LEN = 1024, 256
STATE_BUDGET = MAX_LEN - HEAD_MAX_LEN
MAX_MISS = 0.30
FOLDS = 5


def build_state(row, count_tokens, budget=STATE_BUDGET):
    """The anchor plus the turns nearest it that fit; returns (state, truncated)."""
    turns = row["turns"]
    at = next(i for i, t in enumerate(turns) if t["turnId"] == row["anchor"]["turnId"])
    text = turns[at]["text"]
    start = text.index(row["anchor"]["text"])
    end = start + len(row["anchor"]["text"])
    left, right = 0, len(text)
    def anchor_line():
        return "%s: %s[ANCHOR]%s[/ANCHOR]%s" % (turns[at]["role"], text[left:start], text[start:end], text[end:right])
    cropped = False
    while count_tokens(anchor_line()) > budget and (left < start or right > end):
        left += (start - left + 1) // 2
        right -= (right - end + 1) // 2
        cropped = True
    lines = {at: anchor_line()}
    used = count_tokens(lines[at])
    for distance in range(1, len(turns)):
        full = True
        for i in (at - distance, at + distance):
            if 0 <= i < len(turns):
                line = "%s: %s" % (turns[i]["role"], turns[i]["text"])
                cost = count_tokens(line)
                if used + cost > budget:
                    full = False
                    break
                lines[i] = line
                used += cost
        if not full:
            break
    return "\n".join(lines[i] for i in sorted(lines)), cropped or len(lines) < len(turns)


def assign_folds(rows, folds=FOLDS):
    """Whole episodes, largest first, each into the currently smallest fold."""
    sizes = {}
    for row in rows:
        sizes[row["episodeId"]] = sizes.get(row["episodeId"], 0) + 1
    totals, out = [0] * folds, {}
    for episode in sorted(sizes, key=lambda e: (-sizes[e], e)):
        fold = totals.index(min(totals))
        out[episode] = fold
        totals[fold] += sizes[episode]
    return out


def rates(scores, labels, threshold):
    writes = sum(labels)
    misses = sum(1 for s, w in zip(scores, labels) if w and s < threshold)
    false_writes = sum(1 for s, w in zip(scores, labels) if not w and s >= threshold)
    return misses, writes, false_writes, len(labels) - writes


def pick_threshold(scores, labels, max_miss=MAX_MISS):
    """Lowest false-WRITE rate with misses within the bar; the lowest such threshold on ties."""
    best = None
    for threshold in sorted(set(scores)):
        misses, writes, false_writes, _ = rates(scores, labels, threshold)
        if misses / writes <= max_miss and (best is None or false_writes < best[1]):
            best = (threshold, false_writes)
    return best[0]


def calibration_error(scores, labels, bins=10):
    total = 0.0
    for b in range(bins):
        hit = [(s, w) for s, w in zip(scores, labels) if b / bins <= s < (b + 1) / bins or (b == bins - 1 and s == 1)]
        if hit:
            total += abs(sum(s for s, _ in hit) / len(hit) - sum(w for _, w in hit) / len(hit)) * len(hit)
    return total / len(scores)


def summary(scores, labels, threshold):
    misses, writes, false_writes, no_writes = rates(scores, labels, threshold)
    return {"threshold": threshold, "misses": misses, "writes": writes, "falseWrites": false_writes, "noWrites": no_writes,
            "correct": len(labels) - misses - false_writes, "total": len(labels),
            "brier": sum((s - w) ** 2 for s, w in zip(scores, labels)) / len(labels),
            "calibrationError": calibration_error(scores, labels)}


def read_rows(path):
    with open(path, encoding="utf-8") as f:
        return [json.loads(line) for line in f]


def write_json(path, value):
    with open(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), "w", encoding="utf-8") as f:
        json.dump(value, f, ensure_ascii=False, indent=1)


def fit(rows, states, base, out):
    from laya.train import TrainConfig, finetune
    data = out + ".jsonl"
    with open(os.open(data, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), "w", encoding="utf-8") as f:
        for row in rows:
            f.write(json.dumps({"state": states[row["itemId"]], "questions": QUESTIONS, "expected": {QID: row["write"]}}, ensure_ascii=False) + "\n")
    # Small data: every micro-batch updates. Fixed up front, not searched.
    config = TrainConfig(freeze_encoder=True, epochs=8, micro_batch=8, grad_accum=1, max_len=MAX_LEN, head_max_len=HEAD_MAX_LEN, seed=0)
    finetune(data, base, out, config, device="cpu")
    os.remove(data)


def score(rows, states, checkpoint):
    import laya
    agent = laya.load(checkpoint)
    return [agent.predict(states[row["itemId"]], QUESTIONS)["answers"][QID]["noul"] for row in rows]


def prepare(path, base):
    from transformers import AutoTokenizer
    tok = AutoTokenizer.from_pretrained(os.path.join(base, "tokenizer"))
    count = lambda text: len(tok(text, add_special_tokens=False)["input_ids"])
    rows = read_rows(path)
    built = {row["itemId"]: build_state(row, count) for row in rows}
    return rows, {k: v[0] for k, v in built.items()}, sum(v[1] for v in built.values())


def cv(root):
    base = os.path.join(root, "base")
    rows, states, truncated = prepare(os.path.join(root, "data-train.jsonl"), base)
    folds = assign_folds(rows)
    scored = {}
    for fold in range(FOLDS):
        out = os.path.join(root, "fold-%d" % fold)
        fit([r for r in rows if folds[r["episodeId"]] != fold], states, base, out)
        held = [r for r in rows if folds[r["episodeId"]] == fold]
        scored.update(zip((r["itemId"] for r in held), score(held, states, out)))
        shutil.rmtree(out)
        write_json(os.path.join(root, "cv-scores.json"), scored)
    scores = [scored[r["itemId"]] for r in rows]
    labels = [r["write"] for r in rows]
    threshold = pick_threshold(scores, labels)
    result = {"truncated": truncated, **summary(scores, labels, threshold)}
    write_json(os.path.join(root, "threshold.json"), result)
    print(json.dumps(result))


def final(root):
    base = os.path.join(root, "base")
    rows, states, _ = prepare(os.path.join(root, "data-train.jsonl"), base)
    fit(rows, states, base, os.path.join(root, "final"))
    print(json.dumps({"final": len(rows)}))


def evaluate(root):
    result_path = os.path.join(root, "eval-result.json")
    if os.path.exists(result_path):
        raise SystemExit("EVAL_ALREADY_SCORED")
    with open(os.path.join(root, "threshold.json"), encoding="utf-8") as f:
        threshold = json.load(f)["threshold"]
    rows, states, truncated = prepare(os.path.join(root, "data-eval.jsonl"), os.path.join(root, "base"))
    scores = score(rows, states, os.path.join(root, "final"))
    labels = [r["write"] for r in rows]
    result = {"truncated": truncated, **summary(scores, labels, threshold),
              "items": [{"itemId": r["itemId"], "write": r["write"], "score": s} for r, s in zip(rows, scores)]}
    write_json(result_path, result)
    print(json.dumps({k: v for k, v in result.items() if k != "items"}))


def self_check():
    words = lambda text: len(text.split())
    row = {"anchor": {"turnId": "b", "text": "앵커"},
           "turns": [{"turnId": "a", "role": "user", "text": "하나 둘"}, {"turnId": "b", "role": "user", "text": "앵커 말"},
                     {"turnId": "c", "role": "assistant", "text": "셋"}, {"turnId": "d", "role": "user", "text": "넷 다섯 여섯 일곱"}]}
    state, truncated = build_state(row, words, budget=9)
    assert state == "user: 하나 둘\nuser: [ANCHOR]앵커[/ANCHOR] 말\nassistant: 셋" and truncated, state
    assert build_state(row, words, budget=99)[1] is False
    long_row = {"anchor": {"turnId": "a", "text": "앵커"}, "turns": [{"turnId": "a", "role": "user", "text": "가 " * 20 + "앵커" + " 나" * 20}]}
    state, truncated = build_state(long_row, words, budget=6)
    assert "[ANCHOR]앵커[/ANCHOR]" in state and truncated and words(state) <= 6, state
    folds = assign_folds([{"episodeId": e} for e in "aaaabbc"], folds=2)
    assert folds["a"] != folds["b"] and folds["b"] == folds["c"]
    scores, labels = [0.9, 0.8, 0.7, 0.6, 0.5, 0.1], [True, False, True, True, False, False]
    assert pick_threshold(scores, labels, max_miss=0.34) == 0.6  # 0.6 and 0.7 tie on one false WRITE; 0.6 misses fewer
    assert rates(scores, labels, 0.7) == (1, 3, 1, 3)
    assert calibration_error([1.0, 0.0], [True, False]) == 0
    print("ok")


if __name__ == "__main__":
    command = sys.argv[1] if len(sys.argv) > 1 else ""
    if command == "self-check":
        self_check()
    elif command in ("cv", "final", "eval") and len(sys.argv) == 3:
        {"cv": cv, "final": final, "eval": evaluate}[command](sys.argv[2])
    else:
        raise SystemExit(__doc__)
