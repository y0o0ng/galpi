"""Step 5A-1 실행 진입점 — PIT identity coverage inventory.

읽기 전용이다. manifest를 넓히지 않고, SEC를 부르지 않으며, ME를 계산하지 않고,
어떤 Phase 0 gate도 판정하지 않는다. 범용 research-run 프레임워크를 만들지 않는다.

    python3 -m selftest.qv_identity_inventory_run sources
    python3 -m selftest.qv_identity_inventory_run run \
        --index SP500 \
        --universe-source announcements --universe-version eodhd-15y-2026-08 \
        --calendar-source eodhd --calendar-version eodhd-15y-2026-08 \
        --identity-version qv-identity-sha256:... \
        [--from-year 2010] [--to-year 2026] [--out /tmp/inventory.json]

`sources`는 어떤 source/version이 있는지만 보여준다. **"최신"을 추측하지 않는다** —
정하지 못하면 실행하지 않는 것이 맞다.
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

from backtest import store  # noqa: E402
from backtest.qv_identity_inventory import build_inventory  # noqa: E402


def _git_commit() -> str | None:
    try:
        result = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=str(TRADING_ROOT.parent),
            capture_output=True,
            text=True,
            check=True,
        )
    except Exception:  # noqa: BLE001 — git이 없어도 inventory는 돌아야 한다
        return None
    return result.stdout.strip() or None


def stage_sources(connection) -> int:
    """고를 수 있는 source/version을 보여준다. 고르지 않는다."""
    print("universe_membership:")
    for row in connection.execute(
        "SELECT source, source_version, index_name, count(*) AS n,"
        "       min(valid_from) AS lo, max(valid_from) AS hi"
        " FROM universe_membership GROUP BY 1, 2, 3 ORDER BY 1, 2, 3"
    ):
        print(
            f"  {row['source']} / {row['source_version']} / {row['index_name']}"
            f"  rows={row['n']}  valid_from {row['lo']}..{row['hi']}"
        )
    print("calendar (bars_daily SPY):")
    for row in connection.execute(
        "SELECT source, source_version, count(*) AS n,"
        "       min(trade_date) AS lo, max(trade_date) AS hi"
        " FROM bars_daily WHERE symbol = 'SPY' GROUP BY 1, 2 ORDER BY 1, 2"
    ):
        print(
            f"  {row['source']} / {row['source_version']}"
            f"  sessions={row['n']}  {row['lo']}..{row['hi']}"
        )
    print("identity (qv_share_classes / qv_issuers):")
    for table in ("qv_share_classes", "qv_issuers"):
        rows = list(
            connection.execute(
                f"SELECT source_version, count(*) AS n FROM {table}"
                " GROUP BY 1 ORDER BY 1"
            )
        )
        if not rows:
            print(f"  {table}: (비어 있음 — materialize된 manifest 없음)")
        for row in rows:
            print(f"  {table}: {row['source_version']}  rows={row['n']}")
    return 0


def stage_run(connection, arguments) -> int:
    inventory = build_inventory(
        connection,
        index_name=arguments.index,
        universe_source=arguments.universe_source,
        universe_source_version=arguments.universe_version,
        calendar_source=arguments.calendar_source,
        calendar_source_version=arguments.calendar_version,
        identity_source_version=arguments.identity_version,
        from_year=arguments.from_year,
        to_year=arguments.to_year,
    )
    payload = inventory.as_json(git_commit=_git_commit())
    text = json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=False)
    if arguments.out:
        Path(arguments.out).write_text(text + "\n", encoding="utf-8")
        print(f"wrote {arguments.out}")
    for item in inventory.formations:
        print(
            f"{item.formation_year} {item.formation_session}"
            f"  members={item.member_count}"
            f"  resolved={item.resolved_count}"
            f"  missing={item.missing_count}"
            f"  ambiguous={item.ambiguous_count}"
            f"  issuers={item.resolved_issuer_count}"
            f"  multi_security_issuers={item.multi_security_issuer_count}"
        )
    unresolved = inventory.unresolved_symbols()
    print(f"unique unresolved symbols across formations: {len(unresolved)}")
    if not arguments.out:
        print("(--out 없이 실행하면 JSON을 파일로 남기지 않는다)")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="stage", required=True)
    sub.add_parser("sources")
    runner = sub.add_parser("run")
    runner.add_argument("--index", required=True)
    runner.add_argument("--universe-source", required=True)
    runner.add_argument("--universe-version", required=True)
    runner.add_argument("--calendar-source", required=True)
    runner.add_argument("--calendar-version", required=True)
    runner.add_argument("--identity-version", required=True)
    runner.add_argument("--from-year", type=int, default=None)
    runner.add_argument("--to-year", type=int, default=None)
    runner.add_argument("--out", default=None)
    arguments = parser.parse_args()

    connection = store.connect()
    try:
        if arguments.stage == "sources":
            return stage_sources(connection)
        return stage_run(connection, arguments)
    finally:
        connection.close()


if __name__ == "__main__":
    sys.exit(main())
