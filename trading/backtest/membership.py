"""당시 지수 구성원을 공개 변경 이력에서 재구성한다.

12.4가 지시한 경로다. "Point-in-time 지수 구성원 | 상용 데이터는 고가 | 지수 변경 공고
아카이브로 자체 구축, `universe_membership`에 출처 기록".

## 잘못 만든 목록은 없는 것보다 나쁘다

구성원 목록이 틀리면 생존편향을 되돌리면서도 **유효한 것처럼 보인다.** 실행은 정상으로
끝나고 숫자도 그럴싸하게 나온다. 그래서 이 모듈은 세 가지를 한다.

1. **재구성 논리를 순수 함수로 분리한다.** 데이터 취득(위키·공고 아카이브)은 CSV 계약
   밖에 두고, 여기서는 그 CSV만 받는다. 논리는 손으로 확인할 수 있는 테스트로 고정한다.
2. **구성원 수 불변식을 검사한다.** S&P 500은 모든 날짜에 약 500, Nasdaq-100은 정확히
   100이어야 한다. 2015년에 487이 나오면 재구성이 틀린 것이다.
3. **위반을 목록으로 돌려준다.** 조용히 넘기지 않는다. 위반이 있으면 `load_universe`가
   거부하고, 넘기려면 사유를 명시해야 한다.

## 뒤로 걸어가며 재구성한다

오늘의 구성원 목록은 알고 있고, 변경 이력은 "D일에 X 추가, Y 제거"의 나열이다. 오늘에서
과거로 걸어가며 각 변경을 거꾸로 적용한다.

- D일에 **추가**된 심볼은 D 이전에는 구성원이 아니었다 → 그 심볼의 구간을 `[D, 지금까지)`로
  닫는다
- D일에 **제거**된 심볼은 D 이전에는 구성원이었다 → 끝이 D인 새 구간을 열고 작업 집합에
  다시 넣는다

구간은 `[valid_from, valid_to)`다. 지수 변경은 효력일 개장 전에 반영되므로 "D일 효력으로
X가 Y를 대체"면 D일에 X는 구성원이고 Y는 아니다. 반열린 구간이 그대로 맞다.

## 변경 이력이 시작되는 날 이전은 모른다

이력이 2010년부터면 그 이전의 구성원 여부는 알 수 없다. 그 이전부터 구성원이던 심볼은
`floor_date`에서 시작하는 것으로 기록한다. `floor_date` 이후 어느 날짜의 구성원 판정에는
영향이 없지만, **`floor_date` 이전 구간을 백테스트에 쓰면 안 된다.**
"""

from __future__ import annotations

import csv
import io
import sqlite3
from dataclasses import dataclass, field

from .data import UNIVERSE_CSV_COLUMNS, load_universe_csv, register_source

CHANGES_CSV_COLUMNS = ("date", "index_name", "action", "symbol")
MEMBERS_CSV_COLUMNS = ("index_name", "symbol")

ADD = "add"
REMOVE = "remove"

# 지수별 기대 구성원 수와 허용 오차. **날짜별로 다르다.**
#
# 지수는 회사를 세고 우리 목록은 증권을 센다. 그 차이가 이중상장 클래스(GOOG/GOOGL 등)이고,
# Nasdaq-100은 2014-12-22에 "NASDAQ revised the index methodology allowing multiple share
# classes of index participants to be included"로 그 규칙 자체가 바뀌었다. 2008~2013년
# 재구성은 정확히 100이고 2015년 이후는 101~107이다. 2016-05의 107은 초과분이 전부
# 이중 클래스 쌍(BATRA/BATRK, DISCA/DISCK, FOX/FOXA, GOOG/GOOGL, LBTYA/LBTYK, LMCA/LMCK)으로
# 설명된다.
#
# **하나의 넓은 밴드로 합치지 않는다.** ±4로 뭉뚱그리면 정확히 100이어야 하는 2008~2013년의
# 편출 누락을 놓친다. 이 검사의 존재 이유가 그것이다.
EXPECTED_MEMBERS = {
    "SP500": ((None, 500, 6),),
    "NDX100": ((None, 100, 1), ("2014-12-22", 104, 4)),
}


class MembershipError(Exception):
    """재구성을 신뢰할 수 없을 때 올린다."""


@dataclass(frozen=True)
class Change:
    date: str
    index_name: str
    action: str
    symbol: str


@dataclass(frozen=True)
class Interval:
    symbol: str
    index_name: str
    valid_from: str
    valid_to: str | None

    def contains(self, date: str) -> bool:
        return self.valid_from <= date and (self.valid_to is None or date < self.valid_to)


@dataclass(frozen=True)
class Reconstruction:
    index_name: str
    floor_date: str
    as_of: str
    intervals: tuple[Interval, ...]
    violations: tuple[str, ...] = field(default_factory=tuple)

    def members_on(self, date: str) -> frozenset[str]:
        return frozenset(
            interval.symbol for interval in self.intervals if interval.contains(date)
        )

    def counts(self, dates: list[str]) -> dict[str, int]:
        return {date: len(self.members_on(date)) for date in dates}


def parse_changes_csv(text: str) -> list[Change]:
    """변경 이력 CSV. 한 줄에 한 변경이라 행마다 출처를 확인할 수 있다."""
    reader = csv.DictReader(io.StringIO(text))
    header = set(reader.fieldnames or ())
    missing = [name for name in CHANGES_CSV_COLUMNS if name not in header]
    if missing:
        raise MembershipError("변경 이력 CSV에 없는 열입니다: " + ", ".join(missing))
    changes = []
    for row in reader:
        action = str(row.get("action", "")).strip().lower()
        symbol = str(row.get("symbol", "")).strip().upper()
        if not symbol:
            continue
        if action not in (ADD, REMOVE):
            raise MembershipError(f"action은 add 또는 remove여야 합니다: {action!r}")
        changes.append(
            Change(
                date=str(row["date"]).strip(),
                index_name=str(row["index_name"]).strip(),
                action=action,
                symbol=symbol,
            )
        )
    return changes


def parse_members_csv(text: str) -> dict[str, frozenset[str]]:
    """기준일의 구성원 목록 CSV. 재구성의 출발점이다."""
    reader = csv.DictReader(io.StringIO(text))
    header = set(reader.fieldnames or ())
    missing = [name for name in MEMBERS_CSV_COLUMNS if name not in header]
    if missing:
        raise MembershipError("구성원 CSV에 없는 열입니다: " + ", ".join(missing))
    members: dict[str, set[str]] = {}
    for row in reader:
        symbol = str(row.get("symbol", "")).strip().upper()
        if not symbol:
            continue
        members.setdefault(str(row["index_name"]).strip(), set()).add(symbol)
    return {index: frozenset(values) for index, values in members.items()}


def _drop_same_day_reuse(changes: list[Change]) -> list[Change]:
    """같은 날 같은 심볼의 편출·편입 쌍을 지운다. **심볼 기준 멤버십은 끊기지 않았다.**

    21세기폭스가 디즈니에 인수되며 빠진 2019-03-19에 폭스코퍼레이션이 `FOXA`·`FOX`라는
    같은 티커로 같은 날 들어왔다. 실체는 바뀌었지만 그 티커는 하루도 지수를 벗어나지
    않았고, 유니버스가 심볼로 열리는 이상 그것이 우리가 답할 수 있는 사실이다.

    지우지 않으면 뒤로 걷기가 편출을 먼저 만나 "그 이후에도 구성원으로 잡혀 있습니다"로
    걸린다. 정렬 순서를 바꿔 편입을 먼저 처리하면 구간이 하루짜리로 쪼개져 더 나쁘다.
    """
    paired = {
        (change.date, change.symbol)
        for change in changes
        if change.action == ADD
    } & {
        (change.date, change.symbol)
        for change in changes
        if change.action == REMOVE
    }
    return [
        change
        for change in changes
        if (change.date, change.symbol) not in paired
    ]


def reconstruct(
    index_name: str,
    current_members: frozenset[str] | set[str],
    changes: list[Change],
    *,
    floor_date: str,
    as_of: str,
) -> Reconstruction:
    """오늘의 구성원과 변경 이력으로 구간을 만든다. 모듈 설명의 뒤로 걷기다."""
    relevant = sorted(
        _drop_same_day_reuse(
            [change for change in changes if change.index_name == index_name]
        ),
        key=lambda change: (change.date, change.action, change.symbol),
        reverse=True,
    )
    working = set(current_members)
    # 뒤로 걸으며 누적 중인 구간의 끝. None이면 아직 구성원이다.
    open_end: dict[str, str | None] = {symbol: None for symbol in working}
    intervals: list[Interval] = []
    violations: list[str] = []

    for change in relevant:
        if change.date > as_of:
            violations.append(
                f"{change.date} {change.symbol}: 기준일({as_of}) 이후 변경은 쓸 수 없습니다"
            )
            continue
        if change.action == ADD:
            if change.symbol not in working:
                violations.append(
                    f"{change.date} {change.symbol} 추가: 그 이후 구성원 기록이 없습니다"
                    " (제거 기록 누락 가능)"
                )
                continue
            intervals.append(
                Interval(change.symbol, index_name, change.date, open_end[change.symbol])
            )
            working.discard(change.symbol)
            open_end.pop(change.symbol, None)
        else:
            if change.symbol in working:
                violations.append(
                    f"{change.date} {change.symbol} 제거: 그 이후에도 구성원으로 잡혀 있습니다"
                    " (추가 기록 누락 가능)"
                )
                continue
            working.add(change.symbol)
            open_end[change.symbol] = change.date

    # 이력 시작 이전부터 구성원이던 심볼. floor_date에서 시작한 것으로 기록한다.
    for symbol in sorted(working):
        intervals.append(Interval(symbol, index_name, floor_date, open_end.get(symbol)))

    intervals.sort(key=lambda interval: (interval.symbol, interval.valid_from))
    violations.extend(_overlap_violations(intervals))
    return Reconstruction(
        index_name=index_name,
        floor_date=floor_date,
        as_of=as_of,
        intervals=tuple(intervals),
        violations=tuple(violations),
    )


def _overlap_violations(intervals: list[Interval]) -> list[str]:
    """같은 심볼의 구간이 겹치면 재구성이 틀린 것이다."""
    found = []
    by_symbol: dict[str, list[Interval]] = {}
    for interval in intervals:
        if interval.valid_to is not None and interval.valid_to <= interval.valid_from:
            found.append(
                f"{interval.symbol}: 구간이 뒤집혔습니다"
                f" [{interval.valid_from}, {interval.valid_to})"
            )
        by_symbol.setdefault(interval.symbol, []).append(interval)
    for symbol, items in by_symbol.items():
        ordered = sorted(items, key=lambda interval: interval.valid_from)
        for earlier, later in zip(ordered, ordered[1:]):
            if earlier.valid_to is None or earlier.valid_to > later.valid_from:
                found.append(
                    f"{symbol}: 구간이 겹칩니다"
                    f" [{earlier.valid_from}, {earlier.valid_to}) 와"
                    f" [{later.valid_from}, {later.valid_to})"
                )
    return found


def expected_members_on(index_name: str, date: str) -> tuple[int, int] | None:
    """그 날짜에 기대하는 구성원 수와 허용 오차. 지수 규칙이 바뀐 날을 넘으면 밴드도 바뀐다."""
    bands = EXPECTED_MEMBERS.get(index_name)
    if not bands:
        return None
    chosen: tuple[int, int] | None = None
    for effective_from, target, tolerance in bands:
        if effective_from is None or date >= effective_from:
            chosen = (target, tolerance)
    return chosen


def count_violations(
    reconstruction: Reconstruction,
    dates: list[str],
    expected: tuple[int, int] | None = None,
) -> list[str]:
    """구성원 수 불변식. 이 검사가 재구성 오류를 잡는 마지막 그물이다.

    `expected`를 주면 모든 날짜에 그 밴드를 쓴다. 주지 않으면 `EXPECTED_MEMBERS`의
    날짜별 밴드를 쓴다.
    """
    if expected is None and EXPECTED_MEMBERS.get(reconstruction.index_name) is None:
        return [f"{reconstruction.index_name}: 기대 구성원 수를 모릅니다"]
    found = []
    for date, count in reconstruction.counts(dates).items():
        band = expected or expected_members_on(reconstruction.index_name, date)
        if band is None:
            found.append(f"{date}: {reconstruction.index_name}의 기대 구성원 수를 모릅니다")
            continue
        target, tolerance = band
        if abs(count - target) > tolerance:
            found.append(
                f"{date}: 구성원 {count}개 (기대 {target}±{tolerance})"
            )
    return found


def to_csv(intervals: tuple[Interval, ...]) -> str:
    lines = [",".join(UNIVERSE_CSV_COLUMNS)]
    for interval in intervals:
        lines.append(
            f"{interval.symbol},{interval.index_name},{interval.valid_from},"
            f"{interval.valid_to or ''}"
        )
    return "\n".join(lines) + "\n"


def load_universe(
    connection: sqlite3.Connection,
    reconstructions: list[Reconstruction],
    source: str,
    source_version: str,
    *,
    check_dates: list[str],
    note: str,
    accept_violations_because: str | None = None,
) -> dict[str, object]:
    """재구성 결과를 저장소에 넣는다. 불변식 위반이 있으면 거부한다.

    `accept_violations_because`에 사유를 적으면 넘길 수 있지만, 그 사유가 `note`에 함께
    기록되고 `survivorship_biased`가 참으로 남는다. **위반을 안고 넣은 데이터로 낸 결과는
    전략 판정에 쓸 수 없다.**
    """
    violations: list[str] = []
    for reconstruction in reconstructions:
        violations.extend(
            f"[{reconstruction.index_name}] {item}" for item in reconstruction.violations
        )
        violations.extend(
            f"[{reconstruction.index_name}] {item}"
            for item in count_violations(reconstruction, check_dates)
        )
    if violations and accept_violations_because is None:
        raise MembershipError(
            f"불변식 위반 {len(violations)}건이라 적재를 거부합니다. 처음 5건:\n  "
            + "\n  ".join(violations[:5])
        )

    clean = not violations
    full_note = note if clean else f"{note} | 위반 {len(violations)}건 수용: {accept_violations_because}"
    register_source(
        connection,
        source,
        source_version,
        "universe",
        point_in_time=True,
        survivorship_biased=not clean,
        note=full_note,
    )
    intervals = tuple(
        interval
        for reconstruction in reconstructions
        for interval in reconstruction.intervals
    )
    load_universe_csv(connection, to_csv(intervals), source, source_version)
    return {
        "intervals": len(intervals),
        "violations": violations,
        "clean": clean,
    }
