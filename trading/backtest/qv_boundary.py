"""share-side 전환일과 상장 market boundary — 두 개의 다른 사건이다.

SEC가 기업행동의 존재·action·영향 class를 증명하고, vendor는 **상장 시장 가격
경계**만 준다. vendor row가 SEC 승인을 대신하지 않는다.

DECLARED/RECORD는 share-side 전환일로 쓰지 않는다. ±N일 tolerance도 가격 변화
tolerance도 없다.
"""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass

UNRESOLVED = "UNRESOLVED"
RESOLVED = "RESOLVED"

# share-side 전환일로 인정하는 역할. 이 둘 뿐이다.
SHARE_SIDE_ROLES = ("EFFECTIVE", "DISTRIBUTION")


class QVBoundaryError(Exception):
    """boundary 계약을 벗어날 때 올린다."""


@dataclass(frozen=True)
class MarketBoundary:
    status: str
    boundary_session: str | None
    vendor_split_date: str | None
    sec_trading_date: str | None
    basis: str
    reason: str | None = None


def first_session_on_or_after(
    connection: sqlite3.Connection,
    calendar_date: str,
    calendar_source: str,
    calendar_source_version: str,
) -> str | None:
    row = connection.execute(
        "SELECT MIN(trade_date) AS trade_date FROM bars_daily"
        " WHERE symbol = 'SPY' AND source = ? AND source_version = ?"
        " AND trade_date >= ?",
        (calendar_source, calendar_source_version, calendar_date),
    ).fetchone()
    return row["trade_date"] if row and row["trade_date"] else None


def resolve_market_boundary(
    connection: sqlite3.Connection,
    *,
    symbol: str,
    formation_session: str,
    sec_trading_date: str | None,
    vendor_source_version: str,
    calendar_source: str,
    calendar_source_version: str,
) -> MarketBoundary:
    """확인된 SEC 사건 **하나**에 대응하는 상장 시장 경계를 정한다.

    vendor row가 그 사건의 것임을 증명해야 한다. "formation 이전 마지막 split"을
    묵시적 연결 규칙으로 쓰지 않는다.

    연결이 성립하는 경우는 둘뿐이다.

    1. PIT scope 안 vendor row가 **정확히 하나**다 — 후보가 하나뿐이라 모호하지 않다.
    2. explicit SEC `TRADING_SPLIT_ADJUSTED`가 vendor row 하나와 **정확히 일치**한다.

    그 밖에는 `UNRESOLVED`다. ±N일도 가격 tolerance도 비율 추정도 쓰지 않는다.
    """
    rows = connection.execute(
        "SELECT split_date FROM qv_vendor_split_events"
        " WHERE symbol = ? AND source_version = ? AND split_date <= ?"
        " ORDER BY split_date, raw_split",
        (symbol, vendor_source_version, formation_session),
    ).fetchall()
    candidates = sorted({row["split_date"] for row in rows})

    if not candidates:
        if sec_trading_date is None:
            return MarketBoundary(
                UNRESOLVED, None, None, None, "NONE",
                "vendor split도 explicit SEC TRADING_SPLIT_ADJUSTED도 없다",
            )
        basis, vendor_date, calendar_date = "SEC_TRADING_FALLBACK", None, sec_trading_date
    elif sec_trading_date is not None:
        matched = [date for date in candidates if date == sec_trading_date]
        if not matched:
            return MarketBoundary(
                UNRESOLVED, None, candidates[-1], sec_trading_date, "CONFLICT",
                f"explicit SEC trading({sec_trading_date})과 일치하는 vendor row가 없다"
                f" (후보 {candidates})",
            )
        basis, vendor_date, calendar_date = (
            "VENDOR_CORROBORATED", matched[0], matched[0]
        )
    elif len(candidates) == 1:
        basis, vendor_date, calendar_date = "VENDOR", candidates[0], candidates[0]
    else:
        return MarketBoundary(
            UNRESOLVED, None, None, None, "AMBIGUOUS_VENDOR",
            "이 사건에 대응하는 vendor split row를 유일하게 정할 수 없다"
            f" (후보 {candidates}) — explicit SEC TRADING_SPLIT_ADJUSTED가 없다",
        )

    session = first_session_on_or_after(
        connection, calendar_date, calendar_source, calendar_source_version
    )
    if session is None:
        return MarketBoundary(
            UNRESOLVED, None, vendor_date, sec_trading_date, basis,
            f"{calendar_date} 이상 첫 정규 세션을 달력에서 찾지 못했다",
        )
    return MarketBoundary(RESOLVED, session, vendor_date, sec_trading_date, basis)


def mismatch_interval(
    share_side_transition: str, market_boundary: str
) -> tuple[str, str] | None:
    """두 경계가 다르면 그 사이 반개구간 [lo, hi)를 만든다. 같으면 없다."""
    if share_side_transition == market_boundary:
        return None
    lo, hi = sorted((share_side_transition, market_boundary))
    return lo, hi


def guard_mismatch(
    *,
    share_side_transition: str,
    market_boundary: str,
    anchor_session: str,
    valuation_date: str,
) -> tuple[bool, str | None]:
    """anchor나 December D가 mismatch 구간 안에 있으면 fail-close다.

    ±N일 tolerance를 만들지 않는다. 구간 자체가 판정이다.
    """
    interval = mismatch_interval(share_side_transition, market_boundary)
    if interval is None:
        return True, None
    lo, hi = interval
    for label, session in (("anchor", anchor_session), ("December D", valuation_date)):
        if lo <= session < hi:
            return False, (
                f"{label}({session})이 share-side/market 경계 불일치 구간 "
                f"[{lo}, {hi}) 안에 있다"
            )
    return True, None


def store_vendor_splits(
    connection: sqlite3.Connection,
    events,
    *,
    retrieved_at: str,
    source: str,
    source_version: str,
    provenance: str,
) -> int:
    rows = [
        (item.symbol, item.split_date, item.raw_split, retrieved_at,
         source, source_version, provenance)
        for item in events
    ]
    with connection:
        connection.executemany(
            "INSERT OR REPLACE INTO qv_vendor_split_events"
            " (symbol, split_date, raw_split, retrieved_at, source, source_version, provenance)"
            " VALUES (?, ?, ?, ?, ?, ?, ?)",
            rows,
        )
    return len(rows)
