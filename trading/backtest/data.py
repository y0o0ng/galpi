"""데이터 계약: 적재와 point-in-time 조회.

설계 3.1은 "동일한 데이터·전략 버전·계좌 상태를 넣으면 항상 같은 결과"를 요구하고,
14.3은 point-in-time 구성원과 당시 공개 시각 사용을 요구한다. 이 모듈은 그 두 가지를
구조로 지킨다.

- 적재된 `source_version`은 불변이다. 개정본은 기존 행을 덮지 못하고 새 버전으로만
  들어온다. 그래서 어제 만든 스냅샷이 오늘 조용히 달라지지 않는다.
- `PointInTimeSnapshot`은 `as_of` 이후의 행을 아예 돌려주지 않는다. 미래 정보 누출을
  호출자의 조심이 아니라 조회 경로가 막는다.
"""

from __future__ import annotations

import csv
import hashlib
import io
import re
import sqlite3
from bisect import bisect_right
from dataclasses import dataclass
from functools import cached_property
from pathlib import Path

DATE_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}$")

# 상대모멘텀의 기준이자 시장 상태 판정 대상이고, 거래일 달력의 정본이다.
REFERENCE_SYMBOL = "SPY"

BARS_CSV_COLUMNS = (
    "symbol",
    "trade_date",
    "open",
    "high",
    "low",
    "close",
    "volume",
    "adj_close",
)
UNIVERSE_CSV_COLUMNS = ("symbol", "index_name", "valid_from", "valid_to")
EARNINGS_CSV_COLUMNS = ("symbol", "event_at", "published_at", "confidence")
SECURITIES_CSV_COLUMNS = ("symbol", "sector")

# 기업행동으로 볼 조정 배율(`Bar.price_scale`) 변화의 하한. 벤더가 `adjusted_close`를
# 소수 4자리로 반올림해 주므로 배당락 사이에도 배율이 1e-6 수준으로 흔들린다. 그 잡음을
# 기업행동으로 읽으면 진입이 통째로 취소되고(`CORPORATE_ACTION`) 보유 수량이 조용히
# 깎인다. 2026-08-07 실데이터 1년 실행에서 시도한 intent의 80%가 그렇게 취소됐고,
# 그 취소가 사라지자 이번에는 1주 포지션이 `PositionError`로 죽었다.
#
# 실측이 두 덩어리로 갈렸다(21종목 250세션, 배율이 움직인 3,965일).
#
#   < 1e-5      3,889일   4자리 반올림 잡음
#   1e-5 ~ 1e-4     3일
#   >= 1e-4        73일   실제 배당락 (배당주 19종목 × 분기 4회 = 76에 대응)
#
# 1e-4는 왕복 비용 62.2bp의 1/60이라 이보다 작은 조정으로 지정가·수량·손절을 다시
# 계산해도 결과가 바뀌지 않는다. 대신 배당이 주가의 1bp 미만인 종목의 배당락은 잡히지
# 않고, 그 크기는 잡아도 의미가 없어 수용한다.
#
# 이 값은 전략 손잡이가 아니라 벤더 데이터 계약의 사실이라 `StrategyParameters`가 아니라
# `price_scale` 옆에 둔다. `DEFAULT_INDEXES`를 정책으로 옮기지 않은 것과 같은 이유다.
CORPORATE_ACTION_REL_TOL = 1e-4


class DataContractError(Exception):
    """데이터가 계약을 만족하지 못할 때 올린다."""


@dataclass(frozen=True)
class Bar:
    """하루치 바. raw는 그날 주문 가능했던 가격, adj는 분할·배당 조정가다."""

    symbol: str
    trade_date: str
    raw_open: float
    raw_high: float
    raw_low: float
    raw_close: float
    raw_volume: float
    adj_open: float
    adj_high: float
    adj_low: float
    adj_close: float

    @property
    def price_scale(self) -> float:
        """조정가 기준 값을 그날 실제 주문 가격 기준으로 되돌리는 배율."""
        return self.raw_close / self.adj_close

    @property
    def dollar_volume(self) -> float:
        """실제 오간 달러 금액. 분할과 무관하게 raw로 계산한다."""
        return self.raw_close * self.raw_volume

    @classmethod
    def from_row(cls, row: sqlite3.Row) -> "Bar":
        return cls(
            symbol=row["symbol"],
            trade_date=row["trade_date"],
            raw_open=row["raw_open"],
            raw_high=row["raw_high"],
            raw_low=row["raw_low"],
            raw_close=row["raw_close"],
            raw_volume=row["raw_volume"],
            adj_open=row["adj_open"],
            adj_high=row["adj_high"],
            adj_low=row["adj_low"],
            adj_close=row["adj_close"],
        )


def assert_date(value: str, field: str = "날짜") -> str:
    text = str(value or "").strip()
    if not DATE_PATTERN.match(text):
        raise DataContractError(f"{field}는 YYYY-MM-DD여야 합니다: {value!r}")
    return text


def register_source(
    connection: sqlite3.Connection,
    source: str,
    source_version: str,
    kind: str,
    *,
    point_in_time: bool = False,
    survivorship_biased: bool = True,
    note: str | None = None,
) -> None:
    """데이터 출처를 선언한다. 선언하지 않은 버전은 적재할 수 없다.

    `survivorship_biased`의 기본값이 참인 것은 의도다. 편향이 없다는 것은 당시 구성원과
    상장폐지 종목을 모두 갖췄다는 뜻이고, 그건 증명해야 하는 주장이다.
    """
    if kind not in ("bars", "universe", "earnings", "securities"):
        raise DataContractError(f"알 수 없는 데이터 종류입니다: {kind!r}")
    with connection:
        connection.execute(
            "INSERT OR REPLACE INTO data_sources"
            " (source, source_version, kind, point_in_time, survivorship_biased, note)"
            " VALUES (?, ?, ?, ?, ?, ?)",
            (
                source,
                source_version,
                kind,
                int(point_in_time),
                int(survivorship_biased),
                note,
            ),
        )


def _assert_registered(
    connection: sqlite3.Connection, source: str, source_version: str, kind: str
) -> None:
    row = connection.execute(
        "SELECT 1 FROM data_sources WHERE source = ? AND source_version = ? AND kind = ?",
        (source, source_version, kind),
    ).fetchone()
    if row is None:
        raise DataContractError(
            f"선언되지 않은 출처입니다: {source}/{source_version}/{kind}."
            " register_source로 편향 여부를 먼저 선언하세요."
        )


def _read_rows(text: str, columns: tuple[str, ...]) -> list[dict[str, str]]:
    reader = csv.DictReader(io.StringIO(text))
    header = set(reader.fieldnames or ())
    missing = [name for name in columns if name not in header]
    if missing:
        raise DataContractError("CSV에 없는 열입니다: " + ", ".join(missing))
    return [row for row in reader if any((value or "").strip() for value in row.values())]


def _read_text(source_text: str | Path) -> str:
    if isinstance(source_text, Path):
        return source_text.read_text(encoding="utf-8")
    return source_text


def _number(row: dict[str, str], key: str, symbol: str, date: str) -> float:
    raw = (row.get(key) or "").strip()
    try:
        return float(raw)
    except ValueError as error:
        raise DataContractError(f"{symbol} {date}의 {key} 값이 숫자가 아닙니다: {raw!r}") from error


def load_bars_csv(
    connection: sqlite3.Connection,
    csv_text: str | Path,
    source: str,
    source_version: str,
) -> int:
    """일봉 CSV를 적재한다. 열은 `BARS_CSV_COLUMNS`다.

    무료 데이터는 보통 조정 종가 하나만 준다. 그래서 조정가는 그날의 단일 배율
    `adj_close / close`를 raw OHLC에 곱해 만든다. 분할과 배당 조정이 모두 하루 단위
    단일 배율이라는 가정이고, 이 가정이 틀린 소스를 쓰게 되면 조정 OHLC를 직접 받는
    경로를 추가해야 한다.
    """
    _assert_registered(connection, source, source_version, "bars")
    rows = _read_rows(_read_text(csv_text), BARS_CSV_COLUMNS)

    payload = []
    for row in rows:
        symbol = (row.get("symbol") or "").strip().upper()
        if not symbol:
            raise DataContractError("symbol이 빈 행이 있습니다.")
        trade_date = assert_date(row.get("trade_date", ""), "trade_date")
        close = _number(row, "close", symbol, trade_date)
        adj_close = _number(row, "adj_close", symbol, trade_date)
        if close <= 0 or adj_close <= 0:
            raise DataContractError(f"{symbol} {trade_date}의 종가가 0 이하입니다.")
        factor = adj_close / close
        raw_open = _number(row, "open", symbol, trade_date)
        raw_high = _number(row, "high", symbol, trade_date)
        raw_low = _number(row, "low", symbol, trade_date)
        payload.append(
            (
                symbol,
                trade_date,
                raw_open,
                raw_high,
                raw_low,
                close,
                _number(row, "volume", symbol, trade_date),
                # 양수 배율은 순서를 뒤집지 않으므로 high >= low 같은 CHECK가 그대로 산다.
                raw_open * factor,
                raw_high * factor,
                raw_low * factor,
                close * factor,
                source,
                source_version,
            )
        )

    return _insert_immutable(
        connection,
        "INSERT INTO bars_daily"
        " (symbol, trade_date, raw_open, raw_high, raw_low, raw_close, raw_volume,"
        "  adj_open, adj_high, adj_low, adj_close, source, source_version)"
        " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        payload,
    )


def load_universe_csv(
    connection: sqlite3.Connection,
    csv_text: str | Path,
    source: str,
    source_version: str,
) -> int:
    """당시 지수 구성원 CSV를 적재한다. `valid_to`가 비면 아직 구성원이다."""
    _assert_registered(connection, source, source_version, "universe")
    rows = _read_rows(_read_text(csv_text), UNIVERSE_CSV_COLUMNS)

    payload = []
    for row in rows:
        symbol = (row.get("symbol") or "").strip().upper()
        valid_to = (row.get("valid_to") or "").strip()
        payload.append(
            (
                symbol,
                (row.get("index_name") or "").strip(),
                assert_date(row.get("valid_from", ""), "valid_from"),
                assert_date(valid_to, "valid_to") if valid_to else None,
                source,
                source_version,
            )
        )

    return _insert_immutable(
        connection,
        "INSERT INTO universe_membership"
        " (symbol, index_name, valid_from, valid_to, source, source_version)"
        " VALUES (?, ?, ?, ?, ?, ?)",
        payload,
    )


def load_earnings_csv(
    connection: sqlite3.Connection,
    csv_text: str | Path,
    source: str,
    source_version: str,
) -> int:
    """실적 일정 CSV를 적재한다. `published_at`이 없으면 그 일정은 몰랐던 것이다."""
    _assert_registered(connection, source, source_version, "earnings")
    rows = _read_rows(_read_text(csv_text), EARNINGS_CSV_COLUMNS)

    payload = []
    for row in rows:
        confidence = (row.get("confidence") or "").strip() or "estimated"
        if confidence not in ("confirmed", "estimated"):
            raise DataContractError(f"confidence는 confirmed/estimated여야 합니다: {confidence!r}")
        published_at = (row.get("published_at") or "").strip()
        event_at = (row.get("event_at") or "").strip()
        if not published_at or not event_at:
            raise DataContractError("event_at과 published_at은 비울 수 없습니다.")
        payload.append(
            (
                (row.get("symbol") or "").strip().upper(),
                event_at,
                published_at,
                confidence,
                source,
                source_version,
            )
        )

    return _insert_immutable(
        connection,
        "INSERT INTO earnings_calendar"
        " (symbol, event_at, published_at, confidence, source, source_version)"
        " VALUES (?, ?, ?, ?, ?, ?)",
        payload,
    )


def load_securities_csv(
    connection: sqlite3.Connection,
    csv_text: str | Path,
    source: str,
    source_version: str,
) -> int:
    """종목 분류 CSV를 적재한다. 9.2의 섹터 한도가 이 값을 쓴다."""
    _assert_registered(connection, source, source_version, "securities")
    rows = _read_rows(_read_text(csv_text), SECURITIES_CSV_COLUMNS)

    payload = []
    for row in rows:
        sector = (row.get("sector") or "").strip()
        if not sector:
            raise DataContractError("sector는 비울 수 없습니다.")
        payload.append(
            ((row.get("symbol") or "").strip().upper(), sector, source, source_version)
        )

    return _insert_immutable(
        connection,
        "INSERT INTO securities (symbol, sector, source, source_version)"
        " VALUES (?, ?, ?, ?)",
        payload,
    )


def _insert_immutable(
    connection: sqlite3.Connection, statement: str, payload: list[tuple]
) -> int:
    """이미 있는 (키, source_version)을 덮지 않는다. 개정본은 새 버전으로 넣어야 한다."""
    try:
        with connection:
            connection.executemany(statement, payload)
    except sqlite3.IntegrityError as error:
        raise DataContractError(
            f"이 source_version에 이미 있는 행입니다 ({error})."
            " 개정본은 기존 버전을 덮지 않고 새 source_version으로 적재하세요."
        ) from error
    return len(payload)


class BarCache:
    """심볼별 전체 바를 한 번만 읽어 세션마다 재사용한다.

    `as_of` 이후를 자르는 책임이 SQL에서 여기로 오므로, 캐시 경로와 직접 조회 경로가 같은
    결과를 주는지 테스트로 고정한다. 여기서 새면 미래정보 누출이 조용히 들어온다.

    전체를 들고 있으므로 종목 수 × 기간만큼 메모리를 쓴다. 수십 종목이면 문제없지만
    유니버스 500종목 × 15년이면 수백 MB가 되므로, 그 규모에서는 창을 미는 방식이 필요하다.
    캐시를 넘기지 않으면 예전처럼 세션마다 조회한다.
    """

    def __init__(self, connection: sqlite3.Connection, source_version: str) -> None:
        self.connection = connection
        self.source_version = source_version
        self._bars: dict[str, list[Bar]] = {}
        self._dates: dict[str, list[str]] = {}

    def _load(self, symbol: str) -> tuple[list[Bar], list[str]]:
        if symbol not in self._bars:
            rows = self.connection.execute(
                "SELECT * FROM bars_daily WHERE symbol = ? AND source_version = ?"
                " ORDER BY trade_date",
                (symbol, self.source_version),
            ).fetchall()
            self._bars[symbol] = [Bar.from_row(row) for row in rows]
            self._dates[symbol] = [bar.trade_date for bar in self._bars[symbol]]
        return self._bars[symbol], self._dates[symbol]

    def bars(self, symbol: str, as_of: str, count: int | None = None) -> list[Bar]:
        bars, dates = self._load(symbol)
        end = bisect_right(dates, as_of)
        if count is None:
            return bars[:end]
        return bars[max(0, end - count) : end]


class PointInTimeSnapshot:
    """`as_of` 종료 시점에 알 수 있었던 것만 보여주는 조회 창구.

    `as_of`는 기준 심볼의 거래일이어야 한다. 휴장일로 스냅샷을 만들려는 시도는 거부한다.
    """

    def __init__(
        self,
        connection: sqlite3.Connection,
        as_of: str,
        source_version: str,
        reference_symbol: str = REFERENCE_SYMBOL,
        cache: BarCache | None = None,
    ) -> None:
        self.connection = connection
        self.as_of = assert_date(as_of, "as_of")
        self.source_version = source_version
        self.reference_symbol = reference_symbol
        if cache is not None and cache.source_version != source_version:
            raise DataContractError(
                f"캐시의 데이터 버전이 다릅니다: {cache.source_version} != {source_version}"
            )
        self.cache = cache

        session = connection.execute(
            "SELECT 1 FROM bars_daily"
            " WHERE symbol = ? AND trade_date = ? AND source_version = ?",
            (reference_symbol, self.as_of, source_version),
        ).fetchone()
        if session is None:
            raise DataContractError(
                f"{self.as_of}는 {reference_symbol}({source_version})의 거래일이 아닙니다."
                " 휴장일이나 데이터 공백으로 스냅샷을 만들 수 없습니다."
            )

    @cached_property
    def survivorship_biased(self) -> bool:
        """편향 없음이 선언된 경우에만 거짓이다. 선언이 없으면 편향 있음으로 본다."""
        rows = self.connection.execute(
            "SELECT survivorship_biased FROM data_sources WHERE source_version = ?",
            (self.source_version,),
        ).fetchall()
        if not rows:
            return True
        return any(row["survivorship_biased"] for row in rows)

    def bars(self, symbol: str, count: int | None = None) -> list[Bar]:
        """`as_of`까지의 바를 오름차순으로 준다. `count`면 최근 것부터 그 개수만."""
        if self.cache is not None:
            return self.cache.bars(symbol, self.as_of, count)
        statement = (
            "SELECT * FROM bars_daily"
            " WHERE symbol = ? AND source_version = ? AND trade_date <= ?"
            " ORDER BY trade_date DESC"
        )
        params: list = [symbol, self.source_version, self.as_of]
        if count is not None:
            statement += " LIMIT ?"
            params.append(int(count))
        rows = self.connection.execute(statement, params).fetchall()
        rows.reverse()
        return [Bar.from_row(row) for row in rows]

    def sessions(self, count: int | None = None) -> list[str]:
        """거래일 달력. 기준 심볼이 바를 가진 날이 거래일이다."""
        return [bar.trade_date for bar in self.bars(self.reference_symbol, count)]

    def members(self, index_name: str | None = None) -> frozenset[str]:
        """`as_of`에 지수 구성원이었던 종목."""
        statement = (
            "SELECT DISTINCT symbol FROM universe_membership"
            " WHERE source_version = ? AND valid_from <= ?"
            "   AND (valid_to IS NULL OR valid_to > ?)"
        )
        params: list = [self.source_version, self.as_of, self.as_of]
        if index_name is not None:
            statement += " AND index_name = ?"
            params.append(index_name)
        return frozenset(
            row["symbol"] for row in self.connection.execute(statement, params)
        )

    def next_earnings(self, symbol: str) -> str | None:
        """이미 공개된 일정 중 `as_of` 이후 가장 이른 실적 시각.

        `published_at`은 날짜 부분으로 비교한다. 장 마감 후 결정에서는 그날 낮에 공개된
        일정을 이미 알고 있기 때문이다. 여기서 보수적으로 굴면 실적을 못 보고 포지션을
        들고 가게 되므로, 안전한 방향이 아니다.
        """
        row = self.connection.execute(
            "SELECT MIN(event_at) AS event_at FROM earnings_calendar"
            " WHERE symbol = ? AND source_version = ?"
            "   AND substr(published_at, 1, 10) <= ?"
            "   AND substr(event_at, 1, 10) > ?",
            (symbol, self.source_version, self.as_of, self.as_of),
        ).fetchone()
        return row["event_at"] if row and row["event_at"] else None

    def sector(self, symbol: str) -> str | None:
        """종목의 섹터. 분류를 모르면 None이고, 그때 섹터 한도는 판정할 수 없다."""
        row = self.connection.execute(
            "SELECT sector FROM securities WHERE symbol = ? AND source_version = ?",
            (symbol, self.source_version),
        ).fetchone()
        return row["sector"] if row else None

    @cached_property
    def snapshot_id(self) -> str:
        """이 스냅샷이 본 데이터의 지문. 설계 19.3의 `data_snapshot_id`다.

        데이터가 조용히 바뀌면 값이 달라진다. 전체를 훑기 때문에 하루하루 부르는 값이
        아니라 실행 시작·감사 기록 같은 지점에서 부르는 값이다.
        """
        digest = hashlib.sha256()
        digest.update(
            f"as_of={self.as_of}\n"
            f"source_version={self.source_version}\n"
            f"reference={self.reference_symbol}\n".encode("utf-8")
        )
        for row in self.connection.execute(
            "SELECT symbol, COUNT(*) AS n, MAX(trade_date) AS last_date"
            " FROM bars_daily WHERE source_version = ? AND trade_date <= ?"
            " GROUP BY symbol ORDER BY symbol",
            (self.source_version, self.as_of),
        ):
            last_close = self.connection.execute(
                "SELECT adj_close FROM bars_daily"
                " WHERE symbol = ? AND trade_date = ? AND source_version = ?",
                (row["symbol"], row["last_date"], self.source_version),
            ).fetchone()["adj_close"]
            digest.update(
                f"bars|{row['symbol']}|{row['n']}|{row['last_date']}|{last_close:.10g}\n".encode(
                    "utf-8"
                )
            )
        for row in self.connection.execute(
            "SELECT symbol, index_name, valid_from, valid_to FROM universe_membership"
            " WHERE source_version = ? AND valid_from <= ?"
            " ORDER BY symbol, index_name, valid_from",
            (self.source_version, self.as_of),
        ):
            digest.update(
                f"universe|{row['symbol']}|{row['index_name']}|{row['valid_from']}|"
                f"{row['valid_to'] or ''}\n".encode("utf-8")
            )
        for row in self.connection.execute(
            "SELECT symbol, sector FROM securities WHERE source_version = ?"
            " ORDER BY symbol",
            (self.source_version,),
        ):
            digest.update(f"securities|{row['symbol']}|{row['sector']}\n".encode("utf-8"))
        for row in self.connection.execute(
            "SELECT symbol, event_at, published_at, confidence FROM earnings_calendar"
            " WHERE source_version = ? AND substr(published_at, 1, 10) <= ?"
            " ORDER BY symbol, event_at, published_at",
            (self.source_version, self.as_of),
        ):
            digest.update(
                f"earnings|{row['symbol']}|{row['event_at']}|{row['published_at']}|"
                f"{row['confidence']}\n".encode("utf-8")
            )
        return digest.hexdigest()
