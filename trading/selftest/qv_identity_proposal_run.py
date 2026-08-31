"""Step 5A-2a/b 실행 진입점 — SEC identity 제안/증명 packet.

**production manifest를 바꾸지 않는다.** `trading/qv/identity/*.jsonl`은 이 실행
경로에서 읽지도 쓰지도 않는다. 산출물은 사람이 검토할 제안 packet JSON 하나다.

    DISCOVERY_HINT  !=  SEC_PROOF  !=  PRODUCTION_MANIFEST

`AUTO_PROVABLE`은 "승인된 규칙 아래 SEC 증거가 기계적으로 완결됐다"는 뜻이고
manifest 승격은 5A-2c에서 사람이 따로 한다.

    python3 -m selftest.qv_identity_proposal_run demand --inventory <5A-1.json>
    python3 -m selftest.qv_identity_proposal_run run \
        --inventory <5A-1.json> \
        --symbols AAA,BBB [--limit 5] [--browse] \
        [--contact "이름 <메일>"] [--out /tmp/proposals.json]

`run`은 **실제 SEC를 부른다.** 대상은 `--symbols`로 명시하거나 `--limit`으로 5A-1
수요의 앞에서 잘라 고른다. "전부 돌리기"는 기본값이 아니다.
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

from backtest.edgar import EdgarClient  # noqa: E402
from backtest.qv_identity_proposals import (  # noqa: E402
    AUTO_PROVABLE,
    REVIEW_REQUIRED,
    UNRESOLVED,
    read_mapping_demand,
    run_proposals,
)


def _git_commit() -> str | None:
    try:
        result = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=str(TRADING_ROOT.parent),
            capture_output=True,
            text=True,
            check=True,
        )
    except Exception:  # noqa: BLE001 — git이 없어도 실행은 돼야 한다
        return None
    return result.stdout.strip() or None


def _select(demand: dict, arguments) -> dict:
    if arguments.symbols:
        wanted = [item.strip().upper() for item in arguments.symbols.split(",") if item.strip()]
        missing = [item for item in wanted if item not in demand]
        if missing:
            raise SystemExit(f"5A-1 수요에 없는 심볼입니다: {', '.join(missing)}")
        return {symbol: demand[symbol] for symbol in wanted}
    if arguments.limit:
        return {symbol: demand[symbol] for symbol in sorted(demand)[: arguments.limit]}
    raise SystemExit("--symbols 또는 --limit 중 하나가 필요합니다(전부 돌리기는 기본이 아닙니다)")


def stage_demand(arguments) -> int:
    demand, version = read_mapping_demand(arguments.inventory)
    print(f"identity bundle: {version}")
    print(f"5A-1 mapping demand symbols: {len(demand)}")
    for symbol in sorted(demand)[: arguments.limit or 20]:
        print(f"  {symbol}  formations={len(demand[symbol])}  first={demand[symbol][0]}")
    return 0


def stage_run(arguments) -> int:
    demand, version = read_mapping_demand(arguments.inventory)
    selected = _select(demand, arguments)
    client = EdgarClient(arguments.contact) if arguments.contact else EdgarClient()
    companies = client.ticker_map()
    run = run_proposals(
        client,
        selected,
        companies=companies,
        identity_source_version=version,
        demand_source=str(arguments.inventory),
        use_browse=arguments.browse,
    )
    payload = run.as_json()
    payload["git_commit"] = _git_commit()
    payload["sec_calls"] = client.calls
    if arguments.out:
        Path(arguments.out).write_text(
            json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        print(f"wrote {arguments.out}")

    print(f"identity bundle: {version}")
    print("stage: 5A-2 proposals — production manifest는 바뀌지 않았다")
    counts = run.counts()
    print(
        f"{AUTO_PROVABLE}={counts[AUTO_PROVABLE]}"
        f"  {REVIEW_REQUIRED}={counts[REVIEW_REQUIRED]}"
        f"  {UNRESOLVED}={counts[UNRESOLVED]}"
    )
    for item in run.proposals:
        print(
            f"  {item.symbol:6s} {item.proposal_status:16s}"
            f" cik={item.selected_cik or '-'}"
            f" classes={len(item.share_class_proposals)}"
            f" reasons={','.join(item.reason_codes) or '-'}"
        )
    print(f"SEC calls: {client.calls}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="stage", required=True)
    lister = sub.add_parser("demand")
    lister.add_argument("--inventory", required=True)
    lister.add_argument("--limit", type=int, default=None)
    runner = sub.add_parser("run")
    runner.add_argument("--inventory", required=True)
    runner.add_argument("--symbols", default=None)
    runner.add_argument("--limit", type=int, default=None)
    runner.add_argument("--browse", action="store_true")
    runner.add_argument("--contact", default=None)
    runner.add_argument("--out", default=None)
    arguments = parser.parse_args()
    if arguments.stage == "demand":
        return stage_demand(arguments)
    return stage_run(arguments)


if __name__ == "__main__":
    sys.exit(main())
