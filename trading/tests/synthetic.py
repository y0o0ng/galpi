"""결정론적 합성 바.

무료 가격 데이터는 아직 사지 않았다. 엔진 검증에는 실데이터보다 손으로 기대값을 낼 수
있는 경로가 낫다. 여기서 만드는 경로는 값이 닫힌 형태로 나와서 규칙 위반이 바로
드러난다.

- 가격이 일정하면 ATR = 2 × range_pct × 가격, 변동성 0, 추세 품질 0, RS 0
- 로그가격이 정확히 선형이면 R² = 1이므로 추세 품질 = 일간 로그수익률 × 252
"""

from __future__ import annotations

import csv
import io
import math
from datetime import date, timedelta

DEFAULT_START = "2018-01-02"
DEFAULT_VOLUME = 5_000_000.0
DEFAULT_RANGE_PCT = 0.02


def sessions(count: int, start: str = DEFAULT_START) -> list[str]:
    """주말만 제외한 가상 거래일. 공휴일은 없다고 본다."""
    current = date.fromisoformat(start)
    dates: list[str] = []
    while len(dates) < count:
        if current.weekday() < 5:
            dates.append(current.isoformat())
        current += timedelta(days=1)
    return dates


def constant_closes(count: int, price: float) -> list[float]:
    return [price] * count


def growth_closes(count: int, start_price: float, daily_log_return: float) -> list[float]:
    """로그가격이 정확히 선형인 경로."""
    return [start_price * math.exp(daily_log_return * i) for i in range(count)]


def rows(
    symbol: str,
    dates: list[str],
    closes: list[float],
    *,
    range_pct: float = DEFAULT_RANGE_PCT,
    volume: float = DEFAULT_VOLUME,
    adj_factors: list[float] | None = None,
) -> list[dict[str, str]]:
    """CSV 계약(`BARS_CSV_COLUMNS`)에 맞는 행. `closes`는 raw 종가다."""
    if len(dates) != len(closes):
        raise ValueError("날짜와 종가 개수가 다릅니다.")
    factors = adj_factors or [1.0] * len(dates)
    made = []
    for trade_date, close, factor in zip(dates, closes, factors):
        made.append(
            {
                "symbol": symbol,
                "trade_date": trade_date,
                "open": f"{close:.10f}",
                "high": f"{close * (1 + range_pct):.10f}",
                "low": f"{close * (1 - range_pct):.10f}",
                "close": f"{close:.10f}",
                "volume": f"{volume:.2f}",
                "adj_close": f"{close * factor:.10f}",
            }
        )
    return made


def to_csv(*row_groups: list[dict[str, str]]) -> str:
    from backtest.data import BARS_CSV_COLUMNS

    buffer = io.StringIO()
    writer = csv.DictWriter(buffer, fieldnames=list(BARS_CSV_COLUMNS))
    writer.writeheader()
    for group in row_groups:
        writer.writerows(group)
    return buffer.getvalue()


def staircase_closes(
    count: int, start_price: float, step_pct: float, period: int = 5
) -> list[float]:
    """`period`마다 한 번 `step_pct`씩 뛰고 나머지는 쉬는 경로.

    매끄러운 지수 성장 경로는 다음 날 시초가가 항상 지정가(신호 종가 + 0.25 ATR) 위라서
    영원히 미체결이 된다. 실제 모멘텀 종목에는 눌림이 있다. 뛰는 날에만 20일 최고가를
    넘어 신호가 나고, 그 다음 날 시초가는 신호 종가와 같아 체결된다.
    """
    closes = []
    level = start_price
    for index in range(count):
        if index > 0 and index % period == 0:
            level *= 1 + step_pct
        closes.append(level)
    return closes
