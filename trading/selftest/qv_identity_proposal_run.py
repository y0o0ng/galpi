"""Step 5A-2a/b 실행 진입점 — SEC identity 제안/증명 packet.

**production manifest를 바꾸지 않는다.** `trading/qv/identity/*.jsonl`은 이 실행
경로에서 읽지도 쓰지도 않는다. 산출물은 사람이 검토할 제안 packet JSON 하나다.

    DISCOVERY_HINT  !=  SEC_PROOF  !=  PRODUCTION_MANIFEST

`AUTO_PROVABLE`은 "승인된 규칙 아래 SEC 증거가 기계적으로 완결됐다"는 뜻이고
manifest 승격은 5A-2c에서 사람이 따로 한다.

    python3 -m selftest.qv_identity_proposal_run demand --inventory <5A-1.json>
    python3 -m selftest.qv_identity_proposal_run run \
        --inventory <5A-1.json> \
        --symbols AAA,BBB [--limit 5] [--browse] [--historical] \
        [--contact "이름 <메일>"] [--out /tmp/proposals.json]

`run`은 **실제 SEC를 부른다.** 대상은 `--symbols`로 명시하거나 `--limit`으로 5A-1
수요의 앞에서 잘라 고른다. "전부 돌리기"는 기본값이 아니다.

`--historical`은 폐지·재편 종목을 위한 3층 발견을 켠다. 이름은 **이미 있는 명시
source**인 `trading/universe/<index>-changes.csv`의 `security` 칸에서 오고(EDGAR
수집 경로의 `selftest.real_run.security_names()`와 같은 자료다), 멤버십 구간은 5A-1
inventory가 명시한 `universe_source`/`universe_source_version`/`index_name`으로
`universe_membership`에서 읽는다. **지금 ticker 주인의 이름으로 과거를 추정하지
않는다.** 이름 색인은 40MB 한 번이고 선행 등록인 확인은 종목당 제출 이력을 훑는다 —
비싸므로 기본이 아니다.
"""

from __future__ import annotations

import argparse
import csv
import json
import subprocess
import sys
from pathlib import Path

TRADING_ROOT = Path(__file__).resolve().parents[1]
if str(TRADING_ROOT) not in sys.path:
    sys.path.insert(0, str(TRADING_ROOT))

from backtest import store  # noqa: E402
from backtest.edgar import EdgarClient  # noqa: E402
from backtest.qv_identity_proposals import (  # noqa: E402
    AUTO_PROVABLE,
    REVIEW_REQUIRED,
    UNRESOLVED,
    DemandInput,
    DiscoveryHints,
    read_mapping_demand,
    run_proposals,
)

UNIVERSE_DIR = TRADING_ROOT / "universe"


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


def _select(demand_input: DemandInput, arguments) -> DemandInput:
    if arguments.symbols:
        wanted = [item.strip().upper() for item in arguments.symbols.split(",") if item.strip()]
        return demand_input.select(wanted)
    if arguments.limit:
        return demand_input.select(sorted(demand_input.demand)[: arguments.limit])
    raise SystemExit("--symbols 또는 --limit 중 하나가 필요합니다(전부 돌리기는 기본이 아닙니다)")


def historical_names(index_name: str) -> dict[str, str]:
    """티커 → **그 구간의** 회사 이름. 지수 변경 이력 CSV가 정본이다.

    EDGAR 수집 경로가 이미 쓰는 자료와 같다(`selftest.real_run.security_names()`).
    같은 티커에 이름이 여럿이면 가장 이른 것을 쓴다 — 폐지 종목의 CIK를 찾는 것이
    목적이라 그 티커가 지수를 떠날 때의 회사가 알고 싶은 쪽이다.
    """
    path = UNIVERSE_DIR / f"{index_name.lower()}-changes.csv"
    if not path.exists():
        raise SystemExit(f"지수 변경 이력 CSV가 없습니다: {path}")
    found: dict[str, tuple[str, str]] = {}
    for row in csv.DictReader(path.read_text(encoding="utf-8").splitlines()):
        name = (row.get("security") or "").strip()
        symbol = (row.get("symbol") or "").strip().upper()
        date = (row.get("date") or "").strip()
        if not name or not symbol or not date:
            continue
        if symbol not in found or date < found[symbol][0]:
            found[symbol] = (date, name)
    return {symbol: name for symbol, (_, name) in found.items()}


def membership_spans(connection, demand_input: DemandInput) -> dict[str, tuple[str, str]]:
    """티커 → 멤버십 전 구간. **5A-1이 명시한 source/version만** 읽는다."""
    rows = connection.execute(
        "SELECT symbol, MIN(valid_from) AS first,"
        "       MAX(COALESCE(valid_to, valid_from)) AS last"
        "  FROM universe_membership"
        " WHERE index_name = ? AND source = ? AND source_version = ?"
        " GROUP BY symbol",
        (
            demand_input.index_name,
            demand_input.universe_source,
            demand_input.universe_source_version,
        ),
    ).fetchall()
    return {row["symbol"]: (row["first"], row["last"]) for row in rows}


def build_hints(demand_input: DemandInput, data_dir=None) -> DiscoveryHints:
    """3층 발견 입력. 이름과 구간 둘 다 **명시 source**에서만 온다."""
    names = historical_names(demand_input.index_name)
    connection = store.connect(data_dir) if data_dir else store.connect()
    try:
        spans = membership_spans(connection, demand_input)
    finally:
        connection.close()
    if not spans:
        raise SystemExit(
            "universe_membership에 그 source/version 행이 없습니다: "
            f"{demand_input.index_name} / {demand_input.universe_source}"
            f" / {demand_input.universe_source_version}"
        )
    return DiscoveryHints(
        source=demand_input.universe_source,
        source_version=demand_input.universe_source_version,
        provenance=(
            f"이름: trading/universe/{demand_input.index_name.lower()}-changes.csv"
            " (security 칸) / 구간: universe_membership"
        ),
        names=names,
        spans=spans,
    )


def _print_provenance(demand_input: DemandInput) -> None:
    for key, value in demand_input.provenance_json().items():
        print(f"  {key}: {value}")


def stage_demand(arguments) -> int:
    demand_input = read_mapping_demand(arguments.inventory)
    print("5A-1 provenance:")
    _print_provenance(demand_input)
    demand = demand_input.demand
    print(f"5A-1 mapping demand symbols: {len(demand)}")
    for symbol in sorted(demand)[: arguments.limit or 20]:
        print(f"  {symbol}  formations={len(demand[symbol])}  first={demand[symbol][0]}")
    return 0


def stage_run(arguments) -> int:
    demand_input = read_mapping_demand(arguments.inventory)
    selected = _select(demand_input, arguments)
    hints = build_hints(selected, arguments.data_dir) if arguments.historical else None
    client = EdgarClient(arguments.contact) if arguments.contact else EdgarClient()
    companies = client.ticker_map()
    run = run_proposals(
        client,
        selected,
        companies=companies,
        use_browse=arguments.browse,
        hints=hints,
    )
    payload = run.as_json()
    payload["git_commit"] = _git_commit()
    payload["sec_calls"] = client.calls
    if arguments.out:
        Path(arguments.out).write_text(
            json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        print(f"wrote {arguments.out}")

    print("5A-1 provenance:")
    _print_provenance(selected)
    print("stage: 5A-2 proposals — production manifest는 바뀌지 않았다")
    if hints is not None:
        print(f"discovery hints: {hints.source}/{hints.source_version} — {hints.provenance}")
    counts = run.counts()
    print(
        f"{AUTO_PROVABLE}={counts[AUTO_PROVABLE]}"
        f"  {REVIEW_REQUIRED}={counts[REVIEW_REQUIRED]}"
        f"  {UNRESOLVED}={counts[UNRESOLVED]}"
    )
    for item in run.proposals:
        origins = ",".join(sorted({c.origin for c in item.discovery_candidates})) or "-"
        print(
            f"  {item.symbol:6s} {item.proposal_status:16s}"
            f" cik={item.selected_cik or '-'}"
            f" classes={len(item.share_class_proposals)}"
            f" origins={origins}"
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
    runner.add_argument("--historical", action="store_true")
    runner.add_argument("--data-dir", default=None)
    runner.add_argument("--contact", default=None)
    runner.add_argument("--out", default=None)
    arguments = parser.parse_args()
    if arguments.stage == "demand":
        return stage_demand(arguments)
    return stage_run(arguments)


if __name__ == "__main__":
    sys.exit(main())
