"""유료 EODHD로 15년치 실데이터를 적재한다. 14.7 판정을 위한 정본 적재분이다.

`first_real_run.py`는 무료 티어 1년·20종목 스모크였고 처음부터 판정용이 아니었다. 이쪽은
SP500·NDX100의 당시 구성원 전체를 2008-01-02부터 받는다.

## 삭제 의무가 이 스크립트를 단계별로 만든다

EODHD 약관은 해지 후 1개월 안에 가격 복사본을 지우라고 요구한다. 그래서 **언젠가 지우고
다시 받아야 하고**, 그때 같은 순서를 손으로 되짚을 수 없다. 각 단계는 몇 번을 다시 돌려도
같은 결과를 내야 한다. `bars`는 이미 들어간 심볼을 건너뛰고(적재가 불변이라 두 번 넣으면
실패한다), `universe`·`edgar`는 같은 내용을 덮어쓴다.

## 편향 없음은 세 그물을 다 통과해야 선언한다

`survivorship_biased=False`는 `check`가 셋을 모두 비운 뒤에만 붙는다.

1. `unlisted_symbols` — 벤더 목록에 아예 없는 심볼(개명 누락)
2. `missing_universe_symbols` — 구성원인데 바가 하나도 없는 심볼
3. `uncovered_intervals` — 바는 있는데 구간을 못 덮는 심볼(티커 재사용)

셋 중 하나라도 남으면 `check`는 선언하지 않고 목록만 준다.

## 실행 순서

    python3 selftest/real_run.py universe   # 호출 없음
    python3 selftest/real_run.py bars       # EODHD 908회 (중단되면 다시 돌려도 된다)
    python3 selftest/real_run.py check      # EODHD 2회
    python3 selftest/real_run.py edgar      # SEC EDGAR, 무료
    python3 selftest/real_run.py status
"""

from __future__ import annotations

import argparse
import csv
import sys
from pathlib import Path

TRADING_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TRADING_ROOT))

from backtest import store  # noqa: E402
from backtest.data import register_source  # noqa: E402
from backtest.edgar import collect  # noqa: E402
from backtest.eodhd import (  # noqa: E402
    EodhdClient,
    load_prices,
    missing_universe_symbols,
    uncovered_intervals,
    unlisted_symbols,
)
from backtest.membership import (  # noqa: E402
    parse_changes_csv,
    parse_members_csv,
    reconstruct,
)

SOURCE_VERSION = "eodhd-15y-2026-08"
INDEX_NAMES = ("SP500", "NDX100")
UNIVERSE_DIR = TRADING_ROOT / "universe"

# 변경 이력이 시작되는 날. 그 이전의 구성원 여부는 알 수 없다.
FLOOR_DATE = "2008-01-02"
AS_OF = "2026-08-08"
# 마지막 완전한 세션.
WINDOW_END = "2026-08-07"
# **바는 floor보다 먼저 받는다.** 규칙이 252세션 이력을 요구하므로 floor부터 받으면 첫
# 1년이 통째로 워밍업에 먹힌다. 심볼당 호출은 어차피 1회라 더 받는 값이 공짜다.
BARS_START = "2006-01-03"

# 시장 상태 판정의 기준 심볼. 구성원이 아니라 따로 받는다.
REFERENCE_SYMBOL = "SPY"

# 구성원 수 불변식을 확인할 날짜. 18.5년치 매주다.
CHECK_STRIDE_DAYS = 7


def _read_csv(name: str) -> str:
    return (UNIVERSE_DIR / name).read_text(encoding="utf-8")


def universe_symbols() -> list[str]:
    """구간에 등장하는 모든 심볼. 기준 심볼을 더한다."""
    symbols: set[str] = set()
    for index in INDEX_NAMES:
        for name in (f"{index.lower()}-members.csv", f"{index.lower()}-changes.csv"):
            for row in csv.DictReader(_read_csv(name).splitlines()):
                symbols.add(row["symbol"].strip().upper())
    symbols.add(REFERENCE_SYMBOL)
    return sorted(symbols)


def check_dates() -> list[str]:
    import datetime as dt

    start, end = dt.date.fromisoformat(FLOOR_DATE), dt.date.fromisoformat(AS_OF)
    dates, cursor = [], start
    while cursor <= end:
        dates.append(cursor.isoformat())
        cursor += dt.timedelta(days=CHECK_STRIDE_DAYS)
    return dates


def reconstructions() -> list:
    members, changes = {}, []
    for index in INDEX_NAMES:
        members.update(parse_members_csv(_read_csv(f"{index.lower()}-members.csv")))
        changes.extend(parse_changes_csv(_read_csv(f"{index.lower()}-changes.csv")))
    return [
        reconstruct(
            index, members[index], changes, floor_date=FLOOR_DATE, as_of=AS_OF
        )
        for index in INDEX_NAMES
    ]


def stage_universe(connection) -> int:
    """커밋된 CSV에서 구간을 만들어 넣는다. **위반이 있으면 거부한다.**

    스모크 실행과 달리 `accept_violations_because`를 주지 않는다. 이 적재분은 판정에
    쓸 것이므로 불변식을 넘길 이유가 없다.
    """
    from backtest.membership import load_universe

    summary = load_universe(
        connection,
        reconstructions(),
        "announcements",
        SOURCE_VERSION,
        check_dates=check_dates(),
        note=(
            f"S&P·Nasdaq 공고 색인에서 {FLOOR_DATE} 이후 변경으로 재구성."
            f" 출처는 universe/SOURCES.md"
        ),
    )
    print(f"구간 {summary['intervals']}개, 위반 {len(summary['violations'])}건")
    return 0 if summary["clean"] else 1


def pending_symbols(connection, symbols: list[str]) -> list[str]:
    """아직 바가 없는 심볼. 적재가 불변이라 중간에 끊겨도 다시 돌릴 수 있어야 한다."""
    loaded = {
        row["symbol"]
        for row in connection.execute(
            "SELECT DISTINCT symbol FROM bars_daily WHERE source_version = ?",
            (SOURCE_VERSION,),
        ).fetchall()
    }
    return [symbol for symbol in symbols if symbol not in loaded]


def stage_bars(connection) -> int:
    symbols = universe_symbols()
    remaining = pending_symbols(connection, symbols)
    if not remaining:
        print(f"{len(symbols)}종목이 이미 다 적재돼 있습니다.")
        return 0
    print(
        f"유니버스 {len(symbols)}종목 중 {len(remaining)}종목을 받습니다"
        f" ({BARS_START} ~ {WINDOW_END})."
    )
    summary = load_prices(
        connection, remaining, SOURCE_VERSION, start=BARS_START, end=WINDOW_END
    )
    print(
        f"{summary['loaded']}/{summary['symbols']}종목 {summary['rows']:,}행 적재,"
        f" 버린 행 {summary['dropped']}, 호출 {summary['calls']}회"
    )
    if summary["empty"]:
        print(f"빈 응답 {len(summary['empty'])}종목: {summary['empty']}")
    for symbol, warning in summary["warnings"].items():
        print(f"경고 {symbol}: {warning}")
    # `gaps`는 심볼 이력이 BARS_START보다 늦게 시작하는 것을 센다. 2006년 이후 상장한
    # 회사가 많으므로 여기서는 정상이고, 진짜 판정은 `check`의 구간 커버리지다.
    print(f"{BARS_START}를 못 덮는 심볼 {len(summary['gaps'])}개 (구간 커버리지는 check에서 본다)")
    return 0


def stage_check(connection) -> int:
    """세 그물. 다 비어야 편향 없음을 선언한다."""
    symbols = [s for s in universe_symbols() if s != REFERENCE_SYMBOL]

    client = EodhdClient()
    unlisted = unlisted_symbols(client, symbols)
    print(f"1. 벤더 목록에 없는 심볼: {len(unlisted)}개")
    for symbol in unlisted:
        print(f"   {symbol}")

    missing = missing_universe_symbols(
        connection, SOURCE_VERSION, start=FLOOR_DATE, end=AS_OF
    )
    print(f"2. 구성원인데 바가 없는 심볼: {len(missing)}개")
    for symbol in missing:
        print(f"   {symbol}")

    uncovered = uncovered_intervals(connection, SOURCE_VERSION, end=WINDOW_END)
    print(f"3. 구간을 못 덮는 심볼: {len(uncovered)}개")
    for item in uncovered:
        print(f"   {item.describe()}")

    if unlisted or missing or uncovered:
        print(
            "\n편향 없음을 선언하지 않습니다. 위 목록을 해결하기 전에는"
            " `SURVIVORSHIP_BIASED` blocker가 남는 것이 맞습니다."
        )
        return 1

    register_source(
        connection,
        "eodhd",
        SOURCE_VERSION,
        "bars",
        point_in_time=True,
        survivorship_biased=False,
        note=(
            "EODHD EOD. 조정가는 adjusted_close/close 단일 배율."
            " 벤더 목록 대조·구성원 커버리지·구간 커버리지 세 검사를 모두 통과했다"
        ),
    )
    print("\n세 검사를 모두 통과해 `survivorship_biased=False`로 선언했습니다.")
    return 0


def stage_edgar(connection) -> int:
    """실적일과 섹터. 공공 자료라 호출 한도·삭제 의무와 무관하다."""
    symbols = [s for s in universe_symbols() if s != REFERENCE_SYMBOL]
    summary = collect(connection, symbols, SOURCE_VERSION, window_start=FLOOR_DATE)
    print(
        f"실적 {summary['earnings_rows']:,}행, 섹터 {summary['sectors']}종목,"
        f" 호출 {summary['calls']}회"
    )
    if summary["missing"]:
        print(f"CIK를 못 찾은 종목 {len(summary['missing'])}개: {summary['missing']}")
    if summary["gaps"]:
        print(f"구간 미달 {len(summary['gaps'])}개: {[i.symbol for i in summary['gaps']]}")
    return 0


def stage_status(connection) -> int:
    for table in (
        "bars_daily",
        "universe_membership",
        "earnings_calendar",
        "securities",
    ):
        count = connection.execute(
            f"SELECT COUNT(*) AS n FROM {table} WHERE source_version = ?",
            (SOURCE_VERSION,),
        ).fetchone()["n"]
        print(f"{table:<22} {count:>10,}")
    rows = connection.execute(
        "SELECT source, kind, survivorship_biased, note FROM data_sources"
        " WHERE source_version = ? ORDER BY kind",
        (SOURCE_VERSION,),
    ).fetchall()
    for row in rows:
        bias = "편향 있음" if row["survivorship_biased"] else "편향 없음"
        print(f"  {row['kind']:<10} {row['source']:<14} {bias}  {row['note']}")
    span = connection.execute(
        "SELECT MIN(trade_date) AS first, MAX(trade_date) AS last,"
        "       COUNT(DISTINCT symbol) AS symbols"
        "  FROM bars_daily WHERE source_version = ?",
        (SOURCE_VERSION,),
    ).fetchone()
    if span["first"]:
        print(f"  바 {span['symbols']}종목 {span['first']} ~ {span['last']}")
    return 0


STAGES = {
    "universe": stage_universe,
    "bars": stage_bars,
    "check": stage_check,
    "edgar": stage_edgar,
    "status": stage_status,
}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("stage", choices=sorted(STAGES))
    arguments = parser.parse_args()
    connection = store.connect()
    try:
        return STAGES[arguments.stage](connection)
    finally:
        connection.close()


if __name__ == "__main__":
    sys.exit(main())
