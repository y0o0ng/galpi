"""Step 5A-2c 실행 진입점 — 안전 자동 승격기.

**기본은 dry-run이다.** `--apply`가 없으면 후보 bundle을 세워 검증하고 무엇이 일어날지
보고만 하며 production 파일을 하나도 바꾸지 않는다.

    python3 -m selftest.qv_identity_promotion_run plan \
        --proposal-run <5A-2.json> [--select TFCFA/FOXA ...] [--receipt <path>]

    python3 -m selftest.qv_identity_promotion_run apply \
        --proposal-run <5A-2.json> [--select ...] --apply [--receipt <path>]

승인 정책은 CLOSED다. `AUTO_PROVABLE`만 자동 승격 대상이고 `REVIEW_REQUIRED`는 사람의
판정을, `UNRESOLVED`는 아무것도 받지 못한다. **`--force`도 `--skip-bad`도 없다** —
선택된 packet 하나가 실패하면 전체를 중단한다. 필요하면 더 작은 batch로 다시 고른다.

제안이 고정한 `identity_source_version`이 지금 bundle과 정확히 같아야 한다. 다르면
멈춘다 — 바뀐 manifest에 병합·rebase하지 않고 새 bundle에서 다시 돌린다.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

TRADING_ROOT = Path(__file__).resolve().parents[1]
if str(TRADING_ROOT) not in sys.path:
    sys.path.insert(0, str(TRADING_ROOT))

from backtest.qv_identity_promotion import (  # noqa: E402
    apply_promotion,
    load_proposal_run,
    plan_promotion,
)
from backtest.qv_manifest import DEFAULT_MANIFEST_DIR, load_manifest  # noqa: E402


def _git_commit() -> str | None:
    try:
        result = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=str(TRADING_ROOT.parent),
            capture_output=True, text=True, check=True,
        )
    except Exception:  # noqa: BLE001 — git이 없어도 승격은 돌아야 한다
        return None
    return result.stdout.strip() or None


def _report(plan, *, applied: bool) -> None:
    print(f"base      {plan.base_identity_source_version}")
    print(f"candidate {plan.candidate_identity_source_version}")
    print(f"applied   {applied}")
    for item in plan.packets:
        packet = item.packet
        label = (
            packet.identity_symbol
            if packet.member_symbol == packet.identity_symbol
            else f"{packet.member_symbol}->{packet.identity_symbol}"
        )
        print(
            f"  {label:18s} cik={packet.selected_cik} proof={packet.proof_accession}"
            f" new={len(item.generated_class_ids)} reused={len(item.reused_class_ids)}"
        )
        for proposal_id, production_id in sorted(item.class_id_map.items()):
            print(f"      {proposal_id}  ->  {production_id}")
    added = plan.rows.added
    print("rows added: " + ", ".join(
        f"{name}={len(added[name])}" for name in sorted(added)
    ))
    print("left untouched: " + ", ".join(
        f"{key}={value}" for key, value in sorted(plan.left_untouched.items())
    ))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="stage", required=True)
    for name in ("plan", "apply"):
        runner = sub.add_parser(name)
        runner.add_argument("--proposal-run", required=True)
        runner.add_argument("--select", action="append", default=None)
        runner.add_argument("--manifest", default=None)
        runner.add_argument("--receipt", default=None)
        if name == "apply":
            runner.add_argument("--apply", action="store_true")
    arguments = parser.parse_args()

    directory = Path(arguments.manifest or DEFAULT_MANIFEST_DIR)
    run = load_proposal_run(arguments.proposal_run)
    plan = plan_promotion(
        run, manifest=load_manifest(directory), select=arguments.select
    )

    applied = bool(getattr(arguments, "apply", False))
    if applied:
        receipt = apply_promotion(plan, directory=directory)
    else:
        receipt = plan.as_receipt(applied=False)
    receipt["git_commit"] = _git_commit()

    if arguments.receipt:
        Path(arguments.receipt).write_text(
            json.dumps(receipt, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        print(f"wrote {arguments.receipt}")
    _report(plan, applied=applied)
    if not applied:
        print("dry-run — production manifest는 바뀌지 않았다")
    return 0


if __name__ == "__main__":
    sys.exit(main())
