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

셋 중 하나라도 남으면 `check`는 선언하지 않고 목록만 준다. 셋째에서 **편출일 지연**은
`accept_exit_lag`가 갈라내 인정한다 — 스냅샷이 낸 편출 날짜는 효력일이 아니라 상한이라
회사가 거래를 멈춘 뒤로 구간이 더 이어지고, 그 꼬리에는 바가 없어 못 고른다.

## 실행 순서

    python3 selftest/real_run.py csvs       # 위키 2회. 개명은 여기서만 걸린다
    python3 selftest/real_run.py snapshots  # SP500 위키 과거 판에서 빠진 사건 복구
    python3 selftest/real_run.py qqq        # NDX100은 EDGAR의 QQQ 보유종목에서
    python3 selftest/real_run.py universe   # 호출 없음
    python3 selftest/real_run.py bars       # EODHD 908회 (중단되면 다시 돌려도 된다)
    python3 selftest/real_run.py remap      # 재사용 티커의 옛 계열을 찾아 받는다
    python3 selftest/real_run.py universe   # 매핑을 반영해 다시 적재한다
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
from backtest.edgar import CIK_OVERRIDES, collect  # noqa: E402
from backtest.eodhd import (  # noqa: E402
    REUSE_SUFFIXES,
    EodhdClient,
    accept_exit_lag,
    find_reused_series,
    load_prices,
    missing_universe_symbols,
    parse_reused_csv,
    reused_csv,
    uncovered_intervals,
    unlisted_symbols,
)
from backtest.membership import (  # noqa: E402
    parse_changes_csv,
    parse_members_csv,
    reconstruct,
)
from backtest.wikipedia import identity_changes_for  # noqa: E402

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


def snapshot_changes_rows() -> list:
    """스냅샷 diff가 낸 변경 사건. **지수마다 파일이 하나씩이다.**

    개명은 `snapshots` 단계가 diff 전에 걸어 CSV에 넣는다. `announced_changes`와 같은
    이유로 여기서 다시 걸지 않는다.
    """
    rows: list = []
    for index in INDEX_NAMES:
        path = UNIVERSE_DIR / snapshot_name(index)
        if path.exists():
            rows.extend(csv.DictReader(path.read_text(encoding="utf-8").splitlines()))
    return rows


def merge_changes(announced: list, snapshot_rows: list) -> tuple[list, int]:
    """공고 사건에 스냅샷 사건을 **보강**한다. 공고가 우선이다.

    변경 이력 표는 S&P 보도자료를 행마다 인용하므로 효력일이 정확하다. 스냅샷은 "늦어도
    이 판에는 반영돼 있었다"까지만 안다. 그래서 같은 사건이 양쪽에 있으면 공고를 쓰고,
    **공고에 없는 것만** 스냅샷에서 가져온다.

    ## 같은 사건인지를 날짜 창으로 가르지 않는다

    위키 편집자가 표를 늦게 고치므로 스냅샷 사건은 효력일보다 뒤에 나타난다. 실측 분포는
    중앙값 14일·90% 40일인데 꼬리가 길어 `NFLX`가 103일, `ACN`이 148일이었다. 그렇다고
    창을 넓히면 진짜 재편입(최대 4,946일 차이)까지 같은 사건으로 삼켜버린다.

    대신 **그 사이에 반대 동작이 있었는지**를 본다. 늦게 기록된 같은 사건이면 사이에
    아무 일도 없고, 재편입이면 사이에 반드시 편출이 있다. 창을 고를 필요가 없어진다.
    """
    import datetime as dt
    from backtest.membership import Change

    def days(value):
        return dt.date.fromisoformat(value).toordinal()

    opposite = {"add": "remove", "remove": "add"}
    # 두 소스를 합친 시간선으로 본다. 사이의 반대 동작이 공고에만 있으란 법이 없다.
    timeline: dict[tuple[str, str], list[tuple[int, str]]] = {}
    for change in announced:
        timeline.setdefault((change.index_name, change.symbol), []).append(
            (days(change.date), change.action)
        )
    for row in snapshot_rows:
        timeline.setdefault((row["index_name"], row["symbol"]), []).append(
            (days(row["date"]), row["action"])
        )
    for events in timeline.values():
        events.sort()

    announced_at: dict[tuple[str, str, str], list[int]] = {}
    for change in announced:
        announced_at.setdefault(
            (change.index_name, change.action, change.symbol), []
        ).append(days(change.date))

    def already_announced(index_name, action, symbol, when):
        events = timeline.get((index_name, symbol), [])
        for other in announced_at.get((index_name, action, symbol), []):
            low, high = min(other, when), max(other, when)
            blocked = any(
                low < stamp < high and kind == opposite[action] for stamp, kind in events
            )
            if not blocked:
                return True
        return False

    added = 0
    merged = list(announced)
    for row in snapshot_rows:
        if already_announced(
            row["index_name"], row["action"], row["symbol"], days(row["date"])
        ):
            continue
        merged.append(
            Change(date=row["date"], index_name=row["index_name"],
                   action=row["action"], symbol=row["symbol"])
        )
        added += 1
    return merged, added


def announced_changes() -> list:
    """공고 색인에서 옮긴 변경 사건. 효력일이 정확한 쪽이다.

    **개명은 여기서 걸지 않는다.** CSV는 `csvs` 단계가 `apply_renames`를 한 번 걸어
    만든 것이고, 적재하면서 한 번 더 걸면 **개명 대상이 다른 개명의 출발점인 쌍에서
    회사가 뒤집힌다.** `HANS`→`MNST`가 만든 2009-12-21 행을 `MNST`→`MWW`가 다시 집어
    한센을 몬스터월드와이드로 바꿨다. 규칙 하나하나는 원래 티커에만 맞는다.
    """
    changes = []
    for index in INDEX_NAMES:
        changes.extend(parse_changes_csv(_read_csv(f"{index.lower()}-changes.csv")))
    return changes


def snapshot_closed_exits() -> set[tuple[str, str, str]]:
    """스냅샷만으로 닫힌 편출 `(지수, 심볼, 날짜)`.

    `merge_changes`가 공고를 우선하므로, 병합 결과에서 공고를 빼면 남는 것이 스냅샷이
    혼자 만든 사건이다. 그 편출 날짜만 상한이고, 공고가 이긴 날짜는 효력일이다.
    """
    announced = announced_changes()
    merged, _ = merge_changes(announced, snapshot_changes_rows())
    return {
        (change.index_name, change.symbol, change.date)
        for change in set(merged) - set(announced)
        if change.action == "remove"
    }


def reconstructions() -> list:
    members = {}
    for index in INDEX_NAMES:
        members.update(parse_members_csv(_read_csv(f"{index.lower()}-members.csv")))
    changes, added = merge_changes(announced_changes(), snapshot_changes_rows())
    if added:
        print(f"스냅샷 사건 {added}건 보강")
    return [
        reconstruct(
            index,
            members[index],
            changes,
            floor_date=FLOOR_DATE,
            as_of=AS_OF,
            identity_changes=identity_changes_for(index),
        )
        for index in INDEX_NAMES
    ]


REUSED_NAME = "reused-tickers.csv"


def reused_mapping() -> dict[tuple[str, str], str]:
    """`(심볼, 구간 시작) → 벤더 계열`. 없으면 빈 매핑이다.

    **공고 CSV와 따로 둔다.** `universe/*.csv`는 S&P·Nasdaq 공고를 옮긴 공개 기록이고
    벤더 코드가 섞이면 안 된다. 이 파일은 그 기록을 벤더 계열에 맞추는 별도 층이다.
    """
    path = UNIVERSE_DIR / REUSED_NAME
    return parse_reused_csv(path.read_text(encoding="utf-8")) if path.exists() else {}


def reused_rows() -> list:
    """매핑 파일의 줄 전체. `vendor_name`에 손으로 넣은 줄의 근거가 들어 있다."""
    from backtest.eodhd import ReusedSeries

    path = UNIVERSE_DIR / REUSED_NAME
    if not path.exists():
        return []
    return [
        ReusedSeries(
            symbol=(row.get("symbol") or "").strip().upper(),
            valid_from=(row.get("valid_from") or "").strip(),
            vendor_symbol=(row.get("vendor_symbol") or "").strip().upper(),
            vendor_name=(row.get("vendor_name") or "").strip(),
            first="",
            last="",
        )
        for row in csv.DictReader(path.read_text(encoding="utf-8").splitlines())
        if (row.get("symbol") or "").strip()
    ]


def apply_reused(reconstructions: list, mapping: dict[tuple[str, str], str]) -> list:
    """재사용된 티커의 구간을 벤더 계열 심볼로 바꾼다.

    **다른 회사이므로 다른 심볼이다.** 합치면 한 계열에 두 회사가 섞여 새 회사의 첫
    252세션이 옛 회사 바로 피처를 계산한다.
    """
    from dataclasses import replace as _replace

    if not mapping:
        return reconstructions
    changed = 0
    result = []
    for reconstruction in reconstructions:
        intervals = []
        for interval in reconstruction.intervals:
            vendor = mapping.get((interval.symbol, interval.valid_from))
            if vendor:
                changed += 1
                intervals.append(_replace(interval, symbol=vendor))
            else:
                intervals.append(interval)
        result.append(_replace(reconstruction, intervals=tuple(intervals)))
    print(f"재사용 티커 매핑 {changed}구간 적용")
    return result


def reset_universe(connection) -> int:
    """구성원 적재분만 지운다. 커밋된 CSV에서 언제든 다시 만들 수 있다."""
    with connection:
        return connection.execute(
            "DELETE FROM universe_membership WHERE source_version = ?", (SOURCE_VERSION,)
        ).rowcount


def stage_universe(connection) -> int:
    """커밋된 CSV에서 구간을 만들어 넣는다. **위반이 있으면 거부한다.**

    스모크 실행과 달리 `accept_violations_because`를 주지 않는다. 이 적재분은 판정에
    쓸 것이므로 불변식을 넘길 이유가 없다.
    """
    from backtest.membership import load_universe

    cleared = reset_universe(connection)
    if cleared:
        print(f"이전 구성원 적재분 {cleared}구간을 비웠습니다.")
    summary = load_universe(
        connection,
        apply_reused(reconstructions(), reused_mapping()),
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
    # 적재된 구성원 기준이다. 스냅샷 보강으로 들어온 심볼과 재사용 티커의 벤더 계열은
    # 공고 CSV에 없으므로, CSV만 보면 그 종목들의 바를 영영 안 받는다.
    symbols = sorted(set(membership_symbols(connection)) | {REFERENCE_SYMBOL})
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
    if summary.get("failed"):
        print(f"실패 {len(summary['failed'])}종목:")
        for symbol, reason in sorted(summary["failed"].items()):
            print(f"  {symbol:<10}{reason}")
    for symbol, warning in summary["warnings"].items():
        print(f"경고 {symbol}: {warning}")
    # `gaps`는 심볼 이력이 BARS_START보다 늦게 시작하는 것을 센다. 2006년 이후 상장한
    # 회사가 많으므로 여기서는 정상이고, 진짜 판정은 `check`의 구간 커버리지다.
    print(f"{BARS_START}를 못 덮는 심볼 {len(summary['gaps'])}개 (구간 커버리지는 check에서 본다)")
    return 0


def stage_csvs(_connection) -> int:
    """위키 문서에서 구성원·변경 이력 CSV와 출처 기록을 다시 만든다.

    **개명이 여기서 한 번만 걸린다.** `SYMBOL_RENAMES`에 규칙을 더하면 이 단계를 다시
    돌려야 반영되고, 적재 쪽에서 다시 걸면 안 된다 — 개명 대상이 다른 개명의 출발점인
    쌍(`HANS`→`MNST`→`MWW`)에서 회사가 뒤집힌다.

    호출 2회이고 위키는 무료다. 문서가 그 사이 바뀌었으면 새 사건이 함께 들어오므로
    **줄 수 변화를 찍어 준다.** 이번 변경과 무관한 사건이 섞였는지 눈으로 본다.
    """
    from backtest.wikipedia import build_csvs

    result = build_csvs(since=FLOOR_DATE)
    for name, text in result["files"].items():
        path = UNIVERSE_DIR / name
        before = len(path.read_text(encoding="utf-8").splitlines()) if path.exists() else 0
        path.write_text(text, encoding="utf-8")
        after = len(text.splitlines())
        mark = "" if before == after else f"  ← {after - before:+d}줄"
        print(f"  {name:<28}{after}줄{mark}")
    print(f"호출 {result['calls']}회. `snapshots`와 `universe`를 다시 돌려야 반영된다.")
    return 0


def stage_qqq(_connection) -> int:
    """QQQ 보유종목에서 NDX100의 과거 구성원 사건을 만든다.

    NDX100은 위키에 과거 구성원 표가 없어서 `snapshots`가 못 다룬다(`SNAPSHOT_PAGES`의
    주석). 대신 나스닥100을 완전복제하는 Invesco QQQ Trust의 SEC 제출을 쓴다 — 공개·무료에
    삭제 의무가 없고, 기준일이 감사받은 회계연도 말이라 위키의 "늦어도 이 판"보다 정확하다.

    **문서를 캐시한다.** 49건에 11MB이고, 파서를 한 줄 고칠 때마다 다시 받을 이유가 없다.
    `trading/data/`는 gitignore이므로 저장소에는 파생 사건만 들어간다.
    """
    import json

    from backtest.edgar import EdgarClient
    from backtest import qqq

    client = EdgarClient()
    cache_path = TRADING_ROOT / "data" / "qqq-filings.json"
    cache = json.loads(cache_path.read_text()) if cache_path.exists() else {}
    filings = qqq.parse_filings(client._get(qqq.SUBMISSIONS_URL))
    print(f"보유 명세 제출 {len(filings)}건, 캐시 {len(cache)}건")
    for filing in filings:
        if filing.accession in cache:
            continue
        raw = client._read(filing.url)
        cache[filing.accession] = {
            "form": filing.form, "filed": filing.filed, "document": filing.document,
            "body": raw.decode("utf-8", "replace") if isinstance(raw, bytes) else raw,
        }
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        cache_path.write_text(json.dumps(cache), encoding="utf-8")

    snapshots, dropped = {}, []
    for filing in filings:
        item = cache.get(filing.accession)
        if not item:
            continue
        try:
            holdings = qqq.holdings_from(filing, item["body"])
        except qqq.QqqError as error:
            dropped.append((filing.report_date, filing.form, str(error)))
            continue
        # 같은 기준일에 둘이면 구조화된 NPORT를 쓴다.
        current = snapshots.get(holdings.as_of)
        if current is None or holdings.form == "NPORT-P":
            snapshots[holdings.as_of] = holdings
    print(f"쓸 수 있는 스냅샷 {len(snapshots)}개, 버린 판 {len(dropped)}개")
    for item in dropped:
        print(f"   버림 {item[0]} {item[1]}")

    ordered = [snapshots[key] for key in sorted(snapshots)]
    # **간격을 찍는다.** 연 1회 구간에서는 같은 해에 들어왔다 나간 종목이 안 잡힌다.
    gaps = [
        (later.as_of, (dt_days(later.as_of) - dt_days(earlier.as_of)))
        for earlier, later in zip(ordered, ordered[1:])
    ]
    worst = sorted(gaps, key=lambda item: -item[1])[:3]
    print(f"스냅샷 간격 최대 {worst[0][1]}일 ({worst[0][0]}), 상위 3 {worst}")

    dictionary = name_dictionary()
    events, unresolved = qqq.snapshot_changes(ordered, dictionary)
    names = {name for item in ordered for name in item.names}
    print(f"이름 {len(names)}개, 못 푼 것 {len(unresolved)}개")
    for name in unresolved:
        print(f"   미해석 {name}")
    # 가격을 구할 수 없어 뺀 심볼은 여기서도 뺀다. 제외는 소스가 아니라 심볼에 걸린다.
    from backtest.wikipedia import EXCLUDED_CHANGES, EXCLUDED_SYMBOLS

    excluded = {symbol for _, index, _, symbol, _ in EXCLUDED_CHANGES if index == "NDX100"}
    excluded |= {symbol for index, symbol, _ in EXCLUDED_SYMBOLS if index == "NDX100"}
    events = [item for item in events if item[3] not in excluded]

    name = snapshot_name("NDX100")
    (UNIVERSE_DIR / name).write_text(qqq.snapshot_changes_csv(events), encoding="utf-8")
    print(f"{name}에 사건 {len(events)}건을 썼습니다. `universe`를 다시 돌리세요.")
    return 0


def dt_days(value: str) -> int:
    import datetime as dt

    return dt.date.fromisoformat(value).toordinal()


def name_dictionary() -> dict[str, tuple]:
    """`정규화 이름 → 관측들`. 공고 표의 사건 한 줄이 관측 하나다.

    공고 표는 **그 시절 이름과 그날의 티커**를 함께 담아서 시간축을 만들 수 있다. 벤더
    목록은 날짜가 없고 **현재 주인 이름**이라 기준일 오늘로 둔다. 그래도 안 풀리는 것은
    `qqq.NAME_OVERRIDES`가 근거와 함께 받는다.

    **사전이 날짜를 알아야 하는 이유**는 `Baker Hughes`가 2017-07-07에 `BHI`로 빠지고
    같은 날 `BKR`로 들어오기 때문이다. 날짜 없이 하나로 붙이면 2022년 보유가 옛 티커로
    풀려 있지도 않은 편입 사건이 생긴다.
    """
    from backtest.eodhd import EodhdClient
    from backtest import qqq

    observed: dict[str, list] = {}
    for index in INDEX_NAMES:
        for row in csv.DictReader(_read_csv(f"{index.lower()}-changes.csv").splitlines()):
            if not row.get("security"):
                continue
            observed.setdefault(qqq.normalize(row["security"]), []).append(
                qqq.NameObservation(
                    date=row["date"], action=row["action"], symbol=row["symbol"]
                )
            )
    client = EodhdClient()
    for delisted in (False, True):
        for listing in client.listings("US", delisted=delisted):
            if listing.name:
                observed.setdefault(qqq.normalize(listing.name), []).append(
                    qqq.NameObservation(date=AS_OF, action="add", symbol=listing.symbol)
                )
    return {key: tuple(items) for key, items in observed.items()}


def stage_snapshots(_connection) -> int:
    """문서의 과거 판에서 구성원 목록을 뽑아 빠진 변경 사건을 되찾는다.

    변경 이력 표는 **사건 목록**이라 빠질 수 있고 제목이 "Selected changes"다. 구성원
    표는 **그 시점의 전체 목록**이라 빠질 수가 없다. 2026-08-09 실측에서 2008~2014
    사건 375건 중 196건이 변경 이력 표에 없었고, 빠진 편출에 베어스턴스·워싱턴뮤추얼·
    메릴린치·GM이 들어 있었다.

    스냅샷 자체는 커밋하지 않고 **파생 사건과 판 ID만** 남긴다. 판 ID가 불변이라 언제든
    같은 결과를 다시 만들 수 있고, 11만 줄 대신 몇백 줄이면 된다.
    """
    import datetime as dt

    from backtest.wikipedia import SNAPSHOT_PAGES, WikipediaClient

    client = WikipediaClient()
    months, cursor = [], dt.date.fromisoformat(FLOOR_DATE).replace(day=1)
    last = dt.date.fromisoformat(AS_OF)
    while cursor <= last:
        months.append(cursor.isoformat())
        cursor = (cursor.replace(day=28) + dt.timedelta(days=8)).replace(day=1)

    # **위키로 스냅샷을 뜰 수 있는 지수만 돈다.** NDX100은 과거 구성원 표가 아예 없어서
    # 여기 없고, 대신 `qqq` 단계가 EDGAR에서 같은 일을 한다.
    for index in SNAPSHOT_PAGES:
        if snapshots_for_index(index, months, client):
            return 1
    print("`universe`를 다시 돌려야 반영됩니다.")
    return 0


# 구성원 수가 이 밖이면 파싱이 틀린 것이다. 그 스냅샷으로 만든 diff는 못 믿는다.
# 불변식(`EXPECTED_MEMBERS`)보다 느슨하게 잡는다 — 위키 편집자의 반영 지연이 몇 종목을
# 흔드는 것은 정상이고, 여기서 걸러야 할 것은 **표를 잘못 읽은 판**이다.
SNAPSHOT_COUNT_BAND = {"SP500": (480, 520)}


def snapshot_name(index_name: str) -> str:
    return f"{index_name.lower()}-snapshot-changes.csv"


def snapshots_for_index(index: str, months: list[str], client) -> int:
    """한 지수의 과거 판을 모아 사건 CSV를 쓴다. 0이면 성공."""
    import json

    from backtest.wikipedia import (
        SNAPSHOT_PAGES, SNAPSHOT_TABLE_SIZE, Snapshot, canonical_spelling,
        constituent_symbols, snapshot_changes, snapshot_changes_csv,
    )


    # 판 본문을 캐시한다. 판 ID가 불변이라 같은 내용이 다시 오고, 220개를 받는 데 위키
    # 429 백오프까지 겹쳐 40분이 걸린다. 캐시가 없으면 파싱을 한 줄 고칠 때마다 40분을
    # 다시 쓴다. `trading/data/`는 gitignore이므로 저장소에는 들어가지 않는다.
    cache_path = TRADING_ROOT / "data" / "wiki-revisions.json"
    cache = json.loads(cache_path.read_text()) if cache_path.exists() else {}
    minimum, maximum = SNAPSHOT_TABLE_SIZE[index]
    print(f"[{index}] 캐시된 판 {len(cache)}개 ({cache_path.name})")

    snapshots, unreadable = [], []
    for when in months:
        if when not in cache:
            found = client.revision_at(SNAPSHOT_PAGES[index], when)
            if not found:
                continue
            revid, stamp = found
            cache[when] = {"revid": revid, "date": stamp,
                           "wikitext": client.fetch_revision(revid)}
            cache_path.parent.mkdir(parents=True, exist_ok=True)
            cache_path.write_text(json.dumps(cache), encoding="utf-8")
        entry = cache[when]
        symbols = constituent_symbols(entry["wikitext"], minimum=minimum, maximum=maximum)
        if not symbols:
            unreadable.append((when, entry["revid"]))
            continue
        snapshots.append(Snapshot(index, entry["revid"], entry["date"], symbols))
        if len(snapshots) % 24 == 0:
            print(f"  {when} 까지 {len(snapshots)}개 (호출 {client.calls})", flush=True)

    if not snapshots:
        print(f"[{index}] 읽은 스냅샷이 없습니다 — 문서 제목과 표 크기 창을 확인하세요")
        return 1
    counts = [len(item.symbols) for item in snapshots]
    print(f"[{index}] 스냅샷 {len(snapshots)}개, 구성원 수 {min(counts)}~{max(counts)}")
    if unreadable:
        print(f"[{index}] 표를 못 읽은 판 {len(unreadable)}개: {unreadable[:5]}")
    low, high = SNAPSHOT_COUNT_BAND[index]
    odd = [item for item in snapshots if not (low <= len(item.symbols) <= high)]
    if odd:
        print(f"[{index}] 구성원 수가 {low}~{high} 밖인 스냅샷 {len(odd)}개"
              f" — 파싱을 먼저 확인하세요")
        for item in odd[:5]:
            print(f"  {item.date} 판 {item.revid} {len(item.symbols)}개")
        return 1

    # 클래스주 표기의 기준은 현재 구성원 목록이다.
    spelling = canonical_spelling(
        parse_members_csv(_read_csv(f"{index.lower()}-members.csv"))[index]
    )
    events = snapshot_changes(snapshots, spelling)
    name = snapshot_name(index)
    (UNIVERSE_DIR / name).write_text(snapshot_changes_csv(events), encoding="utf-8")
    print(f"[{index}] {name}에 사건 {len(events)}건을 썼습니다.")
    return 0


def stage_remap(connection) -> int:
    """재사용된 티커의 옛 계열을 찾아 매핑 파일을 쓰고 바를 받는다.

    `unlisted_symbols`가 0을 주는데도 구간이 비는 이유가 여기 있었다. 현재 티커는 벤더
    목록에 멀쩡히 있고 그 시절 회사는 `_OLD` 아래 따로 있다. 이 단계를 돌린 뒤 `universe`를
    다시 돌려야 매핑이 `universe_membership`에 반영된다.
    """
    uncovered = uncovered_intervals(connection, SOURCE_VERSION, end=WINDOW_END)
    if not uncovered:
        print("못 덮는 구간이 없습니다.")
        return 0
    client = EodhdClient()
    found, remaining = find_reused_series(
        client, uncovered, start=BARS_START, end=WINDOW_END
    )
    print(f"못 덮는 구간 {len(uncovered)}개 중 {len(found)}개에 옛 계열을 찾았습니다"
          f" (호출 {client.calls}회)")
    for item in found:
        print(f"  {item.symbol:<7}{item.valid_from} → {item.vendor_symbol:<12}"
              f" {item.first}~{item.last}")
    if remaining:
        print(f"\n옛 계열을 못 찾은 구간 {len(remaining)}개:")
        for item in remaining:
            print(f"  {item.describe()}")

    # 이미 있는 줄은 그대로 둔다. `_OLD` 규칙으로 못 찾아 손으로 넣은 줄(`TFCFA`·`SUN1`
    # 처럼 규칙 밖의 코드)과 그 근거가 여기서 지워지면 안 된다.
    path = UNIVERSE_DIR / REUSED_NAME
    rows = reused_rows()
    have = {(row.symbol, row.valid_from) for row in rows}
    rows.extend(item for item in found if (item.symbol, item.valid_from) not in have)
    path.write_text(reused_csv(rows), encoding="utf-8")
    print(f"\n{REUSED_NAME}에 {len(rows)}줄을 썼습니다"
          f" (기존 {len(have)}줄 보존, 새로 {len(rows) - len(have)}줄).")

    vendor_symbols = sorted({item.vendor_symbol for item in found})
    pending = pending_symbols(connection, vendor_symbols)
    if pending:
        summary = load_prices(
            connection, pending, SOURCE_VERSION, start=BARS_START, end=WINDOW_END
        )
        print(f"옛 계열 {summary['loaded']}/{len(pending)}종목 {summary['rows']:,}행 적재")
    print("\n`universe`를 다시 돌려야 매핑이 반영됩니다.")
    return 0


def stage_check(connection) -> int:
    """세 그물. 다 비어야 편향 없음을 선언한다."""
    # 적재된 구성원 기준이다. 스냅샷 보강 심볼이 공고 CSV에 없어 CSV만 보면 빠진다.
    symbols = [s for s in membership_symbols(connection) if s != REFERENCE_SYMBOL]

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

    base = base_symbols()
    lagged, uncovered = accept_exit_lag(
        uncovered_intervals(connection, SOURCE_VERSION, end=WINDOW_END),
        snapshot_closed_exits(),
        index_symbol=lambda symbol: base_symbol(symbol, base),
    )
    print(f"3. 구간을 못 덮는 심볼: {len(uncovered)}개")
    for item in uncovered:
        print(f"   {item.describe()}")
    # 인정분도 전부 찍는다. 문턱이 없으므로 지연이 커지는 것은 눈으로 봐야 보인다.
    if lagged:
        print(f"   편출일 지연으로 인정한 구간 {len(lagged)}개 (꼬리에 바가 없어 못 고른다):")
        for item in sorted(lagged, key=lambda item: -(item.tail_days or 0)):
            print(f"     {item.tail_days:>4}일 {item.describe()}")

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


def base_symbols() -> dict[str, str]:
    """벤더 계열 → 지수 티커. 이름·CIK는 벤더 규칙과 무관하게 지수 티커로 묶여 있다.

    **접미사를 떼는 것으로는 모자란다.** `SUN1`·`NIHDQ`처럼 `_OLD` 규칙 밖의 코드가 있어서
    매핑 파일 자체를 뒤집어 쓴다. 접미사 규칙은 매핑에 없는 코드의 폴백으로만 남긴다.
    """
    mapping = {vendor: symbol for (symbol, _), vendor in reused_mapping().items()}
    return mapping


def base_symbol(symbol: str, mapping: dict[str, str] | None = None) -> str:
    if mapping and symbol in mapping:
        return mapping[symbol]
    for suffix in REUSE_SUFFIXES:
        if symbol.endswith(suffix):
            return symbol[: -len(suffix)]
    return symbol


def membership_symbols(connection) -> list[str]:
    """실제로 적재된 구성원 심볼. 재사용 매핑 뒤에는 CSV의 티커와 다를 수 있다."""
    return [
        row["symbol"]
        for row in connection.execute(
            "SELECT DISTINCT symbol FROM universe_membership"
            " WHERE source_version = ? ORDER BY symbol",
            (SOURCE_VERSION,),
        ).fetchall()
    ]


def security_names() -> dict[str, str]:
    """티커 → **당시** 회사 이름. 3층 CIK 해석의 단서다.

    같은 티커에 이름이 여럿이면 가장 이른 것을 쓴다. 폐지 종목의 CIK를 찾는 것이 목적이라
    그 티커가 지수를 떠날 때의 회사가 알고 싶은 쪽이고, 개명이 이미 적용돼 있어서 한 티커에
    두 회사가 남는 경우는 드물다.
    """
    names: dict[str, tuple[str, str]] = {}
    for index in INDEX_NAMES:
        for row in csv.DictReader(_read_csv(f"{index.lower()}-changes.csv").splitlines()):
            name = (row.get("security") or "").strip()
            symbol, date = row["symbol"].strip().upper(), row["date"]
            if not name:
                continue
            if symbol not in names or date < names[symbol][0]:
                names[symbol] = (date, name)
    return {symbol: name for symbol, (_, name) in names.items()}


def membership_spans(connection) -> dict[str, tuple[str, str]]:
    """티커 → 멤버십 전 구간. 3층 후보를 제출 이력으로 검증할 때 쓴다."""
    rows = connection.execute(
        "SELECT symbol, MIN(valid_from) AS first, MAX(COALESCE(valid_to, ?)) AS last"
        "  FROM universe_membership WHERE source_version = ? GROUP BY symbol",
        (AS_OF, SOURCE_VERSION),
    ).fetchall()
    return {row["symbol"]: (row["first"], row["last"]) for row in rows}


def reset_edgar(connection) -> tuple[int, int]:
    """EDGAR 적재분만 지운다. **`bars_daily`는 절대 건드리지 않는다.**

    적재가 불변이라 다시 넣으려면 먼저 비워야 한다. 그래도 되는 이유는 EDGAR가 공짜이고
    공개 자료라 언제든 같은 값을 다시 만들 수 있어서다. 가격은 그렇지 않다 — 908회 호출과
    삭제 의무가 걸려 있어서 같은 이유로 지우면 안 된다.
    """
    with connection:
        earnings = connection.execute(
            "DELETE FROM earnings_calendar WHERE source_version = ?", (SOURCE_VERSION,)
        ).rowcount
        securities = connection.execute(
            "DELETE FROM securities WHERE source_version = ?", (SOURCE_VERSION,)
        ).rowcount
    return earnings, securities


def stage_edgar(connection) -> int:
    """실적일과 섹터. 공공 자료라 호출 한도·삭제 의무와 무관하다."""
    cleared = reset_edgar(connection)
    if any(cleared):
        print(f"이전 적재분을 비웠습니다: 실적 {cleared[0]:,}행, 섹터 {cleared[1]}행")
    # 구성원 심볼로 돈다. 재사용 매핑 뒤에는 `CEG_OLD`처럼 CSV의 티커와 다르고,
    # `securities`·`earnings_calendar`는 멤버십과 같은 심볼로 묶여야 한다.
    symbols = [s for s in membership_symbols(connection) if s != REFERENCE_SYMBOL]
    # 이름·CIK는 지수 티커로 묶여 있으므로 벤더 접미사를 떼고 찾는다.
    bases = base_symbols()
    names = security_names()
    names.update({s: names[base_symbol(s, bases)] for s in symbols
                  if s not in names and base_symbol(s, bases) in names})
    overrides = dict(CIK_OVERRIDES)
    overrides.update({s: overrides[base_symbol(s, bases)] for s in symbols
                      if s not in overrides and base_symbol(s, bases) in overrides})
    summary = collect(
        connection,
        symbols,
        SOURCE_VERSION,
        window_start=FLOOR_DATE,
        overrides=overrides,
        security_names=names,
        spans=membership_spans(connection),
    )
    counts: dict[str, int] = {}
    for layer in summary["resolved_by"].values():
        counts[layer] = counts.get(layer, 0) + 1
    print(
        f"실적 {summary['earnings_rows']:,}행, 섹터 {summary['sectors']}종목,"
        f" 호출 {summary['calls']}회"
    )
    print(f"2·3층으로 푼 종목: {counts or '없음'}")
    if summary["ambiguous"]:
        print(f"\n후보가 여럿이라 고르지 않은 종목 {len(summary['ambiguous'])}개"
              " — CIK_OVERRIDES에 근거와 함께 넣어야 합니다:")
        for ticker, candidates in sorted(summary["ambiguous"].items()):
            print(f"  {ticker}")
            for item in candidates:
                print(
                    f"    {item.cik} {item.name[:44]:<44} SIC={item.sic}"
                    f" 제출 {item.first_filing}~{item.last_filing}"
                )
    if summary["missing"]:
        print(f"\nCIK를 못 찾은 종목 {len(summary['missing'])}개: {summary['missing']}")
    if summary["gaps"]:
        print(f"\n구간 미달 {len(summary['gaps'])}개: {[i.symbol for i in summary['gaps']]}")
    return 0


# 워크포워드 구간. fold·홀드아웃은 최대 보유(40세션)의 두 배 이상이어야 한다.
# 252세션(약 1년)이면 그 조건을 넉넉히 넘고, 15년이 fold 여러 개로 갈린다.
FOLD_SESSIONS = 252
HOLDOUT_SESSIONS = 252

# 21.2의 인접 파라미터. 스모크와 같은 값을 쓴다 — 무엇이 인접값인지는 데이터가 아니라
# 전략이 정하는 것이라 적재분이 달라도 같아야 한다.
NEIGHBOURHOODS = {
    "breakout_window": (18, 22),
    "rs_lookback": (57, 69),
    "trend_window": (54, 66),
    "atr_window": (12, 16),
}


def stage_run(connection) -> int:
    """15년 적재분으로 loop를 돌리고 14.7까지 판정한다.

    `first_real_run.py`의 `run`은 20종목 1년 스모크였다. 이쪽은 SP500·NDX100의 당시
    구성원 전체를 쓰고 **`survivorship_biased=False`로 판정한다** — `check`가 세 그물을
    통과해 선언한 뒤에만 여기까지 온다.
    """
    from dataclasses import asdict

    from backtest.loop import BacktestConfig, run_backtest, save_run
    from backtest.metrics import compute_metrics
    from backtest.policy import DEFAULT_PAPER_POLICY
    from backtest.validation import (
        evaluate_gate, neighbourhood_report, parameter_variant, plan_walk_forward,
        run_walk_forward, stress_config,
    )

    policy = DEFAULT_PAPER_POLICY
    all_sessions = [
        row[0] for row in connection.execute(
            "SELECT DISTINCT trade_date FROM bars_daily"
            "  WHERE source_version = ? AND symbol = ? AND trade_date >= ?"
            "  ORDER BY trade_date",
            (SOURCE_VERSION, REFERENCE_SYMBOL, BARS_START),
        )
    ]
    warmup = policy.parameters.min_history_sessions
    if len(all_sessions) <= warmup:
        print(f"{REFERENCE_SYMBOL} 세션이 {len(all_sessions)}개뿐입니다.")
        return 1
    config = BacktestConfig(
        source_version=SOURCE_VERSION,
        start=all_sessions[warmup],
        end=all_sessions[-1],
        policy=policy,
        index_names=INDEX_NAMES,
        require_earnings_calendar=True,
        require_sector=True,
    )
    print(f"구간 {config.start} ~ {config.end} ({len(all_sessions) - warmup}세션)")
    print(f"정책 {config.policy.policy_id}")

    result = run_backtest(connection, config)
    save_run(connection, result, f"real-{config.start}", survivorship_biased=False)
    print(f"\n거래 {len(result.trades)}건, 체결 {len(result.fills)}건")
    _print_counter("건너뛴 이유", result.skip_counts)
    _print_counter("체결 방식", result.fill_counts)
    _print_counter("청산 사유", result.exit_counts)

    # 현금 항등식. 이것이 어긋나면 나머지 숫자는 전부 못 믿는다.
    expected = config.initial_capital + sum(fill.cash_delta for fill in result.fills)
    actual = result.equity_curve[-1].cash if result.equity_curve else config.initial_capital
    print(f"\n현금 항등식: 기대 {expected:,.2f} / 실제 {actual:,.2f}"
          f" — {'일치' if abs(expected - actual) < 1e-6 else '불일치'}")
    print(f"마지막 자산 {result.final_equity:,.2f}")

    metrics = compute_metrics(result)
    print("\n지표")
    for key, value in asdict(metrics).items():
        print(f"  {key}: {value}")

    print("\n워크포워드")
    plan = plan_walk_forward(
        connection, SOURCE_VERSION,
        parameters=policy.parameters,
        fold_sessions=FOLD_SESSIONS,
        holdout_sessions=HOLDOUT_SESSIONS,
        start=BARS_START,
        reference_symbol=REFERENCE_SYMBOL,
    )
    print(f"  fold {len(plan.folds)}개, 홀드아웃 {plan.holdout.start}~{plan.holdout.end}")
    walk = run_walk_forward(connection, config, plan)
    for fold, fold_metrics in walk.fold_metrics:
        print(f"    {fold.start}~{fold.end}  거래 {fold_metrics.trade_count:>4}"
              f"  기대값 {fold_metrics.expectancy_r}")

    print("\n비용 스트레스")
    stressed = compute_metrics(run_backtest(connection, stress_config(result, 2.0)))
    print(f"  2배: 거래 {stressed.trade_count}건, 기대값 {stressed.expectancy_r}")

    print("\n인접 파라미터")
    reports = []
    for field, values in NEIGHBOURHOODS.items():
        neighbours = {
            value: compute_metrics(
                run_backtest(connection, parameter_variant(config, **{field: value}))
            )
            for value in values
        }
        report = neighbourhood_report(
            field, metrics, neighbours,
            center_value=getattr(config.policy.parameters, field),
        )
        reports.append(report)
        cells = ", ".join(f"{value}={item.expectancy_r:.4f}"
                          for value, item in neighbours.items())
        print(f"  {field:<18} 중심 {report.center_value}: {cells}"
              f"  붕괴비율 {report.collapse_ratio}")

    # 게이트에는 가장 나쁜 하나를 넘긴다. 한 파라미터만 무너져도 plateau가 아니다.
    ranked = [item for item in reports if item.collapse_ratio is not None]
    neighbourhood = min(ranked, key=lambda item: item.collapse_ratio) if ranked else reports[0]

    report = evaluate_gate(
        result, metrics,
        survivorship_biased=False,
        walk_forward=walk,
        stressed=stressed,
        neighbourhood=neighbourhood,
    )
    print(f"\n14.7 판정: {report.verdict}")
    print(f"blocker: {', '.join(report.blockers) or '없음'}")
    for row in report.rows:
        print(f"  {row.name:<26} {row.value} → {row.verdict}")
    return 0


def _print_counter(label: str, counts) -> None:
    if not counts:
        return
    items = sorted(counts.items(), key=lambda item: -item[1])
    print(f"{label}: " + ", ".join(f"{name} {value}" for name, value in items[:8]))


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
    "csvs": stage_csvs,
    "qqq": stage_qqq,
    "universe": stage_universe,
    "snapshots": stage_snapshots,
    "bars": stage_bars,
    "remap": stage_remap,
    "check": stage_check,
    "run": stage_run,
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
