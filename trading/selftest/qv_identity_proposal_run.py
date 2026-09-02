"""Step 5A-2a/b 실행 진입점 — SEC identity 제안/증명 packet.

**production manifest를 바꾸지 않는다.** `trading/qv/identity/*.jsonl`은 이 실행
경로에서 읽지도 쓰지도 않는다. 산출물은 사람이 검토할 제안 packet JSON 하나다.

    DISCOVERY_HINT  !=  SEC_PROOF  !=  PRODUCTION_MANIFEST

`AUTO_PROVABLE`은 "승인된 규칙 아래 SEC 증거가 기계적으로 완결됐다"는 뜻이고
manifest 승격은 5A-2c가 따로 한다 — 결정론적 재검증을 통과한 `AUTO_PROVABLE`은 사람의
의미 승인 없이 승격될 수 있고, `REVIEW_REQUIRED`만 사람의 판정을 요구한다.

    python3 -m selftest.qv_identity_proposal_run demand --inventory <5A-1.json>
    python3 -m selftest.qv_identity_proposal_run run \
        --inventory <5A-1.json> \
        --symbols AAA,BBB [--limit 5] [--browse] [--historical] \
        [--legal-evidence] \
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

`--legal-evidence`는 5A-2 법적 증거 공급기를 켠다. 표지 증명이 선 뒤 선언된 지평
(8-K · 10-K · 10-Q 계열)의 accession index를 전부 읽고 governing instrument 후보를
분류·해석해 **명시 법적 사실만** `ClassEvidence`로 만든다. **SEC 호출이 크게 늘어난다**
— 기본값은 더 싼 표지 전용 경로 그대로다. 후보 CIK가 확정되지 않았거나 쓸 만한 표지
제목 anchor가 없으면 돌지 않는다.

**universe/bar 심볼은 SEC 경제적 심볼이 아니다.** 작업 항목은 `member_symbol`(저장된
시장 데이터 계열)과 `identity_symbol`(실제 거래 심볼)을 둘 다 들고 다니고 SEC에는
`identity_symbol`만 던진다. `--symbols`는 둘 중 어느 쪽으로도 고를 수 있고
`MEMBER/IDENTITY` 쌍으로 정확히 하나를 집을 수도 있다.
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
        return demand_input.select(
            f"{item.member_symbol}/{item.identity_symbol}"
            for item in demand_input.work_items[: arguments.limit]
        )
    raise SystemExit("--symbols 또는 --limit 중 하나가 필요합니다(전부 돌리기는 기본이 아닙니다)")


def historical_names(index_name: str) -> dict[str, str]:
    """**경제적** 티커 → 그 구간의 회사 이름. 지수 변경 이력 CSV가 정본이다.

    EDGAR 수집 경로가 이미 쓰는 자료와 같다(`selftest.real_run.security_names()`).
    **키가 경제적 심볼인 이유**는 지수 공고가 `FOXA`라고 적지 벤더 계열 코드
    `TFCFA`라고 적지 않기 때문이다. 벤더 코드로 찾으면 언제나 빈손이다.

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
    """**데이터 계열 심볼** → 그 계열의 멤버십 구간. 5A-1이 명시한 source/version만 읽는다.

    **경제적 심볼로 묶지 않는다.** 재사용된 티커의 옛 episode는 이미 벤더 계열 심볼로
    저장돼 있으므로 저장된 심볼로 묶으면 episode가 그대로 갈라진다. 경제적 심볼로 묶으면
    서로 다른 발행사의 구간이 하나의 `MIN(valid_from)`/`MAX(valid_to)`로 합쳐진다.
    """
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
    """3층 발견 입력. 이름과 구간 둘 다 **명시 source**에서만 온다.

    이름은 경제적 심볼로, 구간은 데이터 계열 심볼로 키를 잡는다.
    """
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
            f"이름(identity_symbol 키): trading/universe/"
            f"{demand_input.index_name.lower()}-changes.csv (security 칸)"
            " / 구간(member_symbol 키): universe_membership"
        ),
        names=names,
        spans=spans,
    )


def _print_legal(item) -> None:
    """법적 증거 receipt를 한 줄씩 보인다. **없으면 아무것도 찍지 않는다.**"""
    legal = item.legal_evidence_proof
    if not legal:
        return
    print(
        f"      legal search={legal['search_status']}"
        f" accessions={len(legal['searched_accessions'])}"
        f" outside_horizon={legal['accessions_outside_horizon']}"
        f" documents={len(legal['documents'])}"
        f" failures={len(legal['failures'])}"
    )
    for entry in legal["classes"]:
        print(
            f"      {entry['member_key']:34s} {entry['status']:11s}"
            f" birth={entry['birth_date'] or '-'}"
            f" end={entry['termination_date'] or ('null' if entry['open_ended'] else '-')}"
            f" snapshot={entry['snapshot_accession'] or '-'}"
            f" findings={len(entry['findings'])}"
        )
        for note in entry["notes"]:
            print(f"        - {note}")


def _print_provenance(demand_input: DemandInput) -> None:
    for key, value in demand_input.provenance_json().items():
        print(f"  {key}: {value}")


def stage_demand(arguments) -> int:
    demand_input = read_mapping_demand(arguments.inventory)
    print("5A-1 provenance:")
    _print_provenance(demand_input)
    items = demand_input.work_items
    reused = [item for item in items if item.symbol_bridge_kind != "DIRECT"]
    print(f"5A-1 mapping demand work items: {len(items)}")
    print(f"  reused vendor series: {len(reused)}")
    print(
        "  unique economic identity symbols: "
        + str(len({item.identity_symbol for item in items}))
    )
    for item in items[: arguments.limit or 20]:
        print(
            f"  {item.member_symbol:10s} -> {item.identity_symbol:10s}"
            f" {item.symbol_bridge_kind:22s}"
            f" formations={len(item.formation_sessions)}"
            f" first={item.formation_sessions[0]}"
        )
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
        legal_evidence=arguments.legal_evidence,
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
        bridged = (
            f"{item.member_symbol}->{item.identity_symbol}"
            if item.member_symbol != item.identity_symbol
            else item.identity_symbol
        )
        print(
            f"  {bridged:18s} {item.proposal_status:16s}"
            f" cik={item.selected_cik or '-'}"
            f" classes={len(item.share_class_proposals)}"
            f" origins={origins}"
            f" reasons={','.join(item.reason_codes) or '-'}"
        )
        _print_legal(item)
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
    runner.add_argument("--legal-evidence", action="store_true")
    runner.add_argument("--data-dir", default=None)
    runner.add_argument("--contact", default=None)
    runner.add_argument("--out", default=None)
    arguments = parser.parse_args()
    if arguments.stage == "demand":
        return stage_demand(arguments)
    return stage_run(arguments)


if __name__ == "__main__":
    sys.exit(main())
