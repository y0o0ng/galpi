"""Step-4 결정론 테스트용 network-free fixture.

합성 XBRL instance와 달력/원장 seeding만 담당한다. 실제 SEC 호출은 하지 않는다.
"""

from __future__ import annotations

import sqlite3
from datetime import date, timedelta

USG = "http://fasb.org/us-gaap/2024"
DEI = "http://xbrl.sec.gov/dei/2024"
XBRLI = "http://www.xbrl.org/2003/instance"
XBRLDI = "http://xbrl.org/2006/xbrldi"

CALENDAR_SOURCE = "synthetic-calendar"
CALENDAR_VERSION = "cal-v1"


def seed_calendar(
    connection: sqlite3.Connection,
    start: str = "2018-01-01",
    end: str = "2027-12-31",
) -> None:
    """평일을 정규 세션으로 갖는 SPY 달력."""
    connection.execute(
        "INSERT OR REPLACE INTO data_sources"
        " (source, source_version, kind, point_in_time, survivorship_biased, note)"
        " VALUES (?, ?, 'bars', 1, 0, 'synthetic SPY calendar')",
        (CALENDAR_SOURCE, CALENDAR_VERSION),
    )
    current = date.fromisoformat(start)
    stop = date.fromisoformat(end)
    rows = []
    while current <= stop:
        if current.weekday() < 5:
            rows.append(
                (
                    "SPY", current.isoformat(), 100.0, 100.0, 100.0, 100.0, 1000,
                    100.0, 100.0, 100.0, 100.0, CALENDAR_SOURCE, CALENDAR_VERSION,
                )
            )
        current += timedelta(days=1)
    connection.executemany(
        "INSERT OR REPLACE INTO bars_daily"
        " (symbol, trade_date, raw_open, raw_high, raw_low, raw_close, raw_volume,"
        "  adj_open, adj_high, adj_low, adj_close, source, source_version)"
        " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        rows,
    )
    connection.commit()


def seed_price(
    connection: sqlite3.Connection,
    symbol: str,
    trade_date: str,
    raw_close: float,
    *,
    source: str = CALENDAR_SOURCE,
    source_version: str = CALENDAR_VERSION,
) -> None:
    connection.execute(
        "INSERT OR REPLACE INTO bars_daily"
        " (symbol, trade_date, raw_open, raw_high, raw_low, raw_close, raw_volume,"
        "  adj_open, adj_high, adj_low, adj_close, source, source_version)"
        " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (symbol, trade_date, raw_close, raw_close, raw_close, raw_close, 1000,
         raw_close, raw_close, raw_close, raw_close, source, source_version),
    )
    connection.commit()


def seed_filing(
    connection: sqlite3.Connection,
    *,
    cik: str,
    accession: str,
    form: str,
    acceptance_datetime: str,
    source: str,
    source_version: str,
    primary_document: str = "primary.htm",
) -> str:
    """qv_sec_filings 한 행. usable session은 실제 규칙과 같게 계산한다."""
    from backtest.qv_submissions import _acceptance_eastern_date, _historical_usable_session

    eastern = _acceptance_eastern_date(acceptance_datetime)
    usable = _historical_usable_session(
        connection, eastern, CALENDAR_SOURCE, CALENDAR_VERSION
    )
    connection.execute(
        "INSERT OR REPLACE INTO qv_sec_filings"
        " (cik, accession, form, filed_date, report_date, acceptance_datetime,"
        "  acceptance_eastern_date, historical_usable_session, filing_sic, sic_status,"
        "  primary_document, submissions_file, calendar_source, calendar_source_version,"
        "  source, source_version, provenance)"
        " VALUES (?, ?, ?, ?, NULL, ?, ?, ?, NULL, 'MISSING', ?, 'fixture.json', ?, ?,"
        "         ?, ?, 'fixture://filing')",
        (cik, accession, form, eastern, acceptance_datetime, eastern, usable,
         primary_document, CALENDAR_SOURCE, CALENDAR_VERSION, source, source_version),
    )
    connection.commit()
    return usable


def instance_xml(facts: list[dict], *, cik: str) -> bytes:
    """합성 XBRL instance. facts 항목은 아래 키를 쓴다.

        concept   ("us-gaap"|"dei", local)
        instant   YYYY-MM-DD
        value     문자열
        decimals  문자열 또는 None
        member    (namespace, local) 또는 None
        axis      local 이름 (기본 StatementClassOfStockAxis)
        typed     True면 typed dimension을 만든다
        extra_dim (axis_local, member_local) 추가 차원
    """
    contexts: dict[str, str] = {}
    fact_xml: list[str] = []
    for index, item in enumerate(facts):
        ctx_id = item.get("context_id") or f"c{index}"
        if ctx_id not in contexts:
            segment = ""
            if item.get("typed"):
                segment = (
                    f'<xbrldi:typedMember dimension="us-gaap:{item.get("axis","StatementClassOfStockAxis")}">'
                    "<x>1</x></xbrldi:typedMember>"
                )
            else:
                parts = []
                if item.get("member"):
                    ns, local = item["member"]
                    prefix = "us-gaap" if ns == USG else "ext"
                    axis_local = item.get("axis", "StatementClassOfStockAxis")
                    parts.append(
                        f'<xbrldi:explicitMember dimension="us-gaap:{axis_local}">'
                        f"{prefix}:{local}</xbrldi:explicitMember>"
                    )
                if item.get("extra_dim"):
                    axis_local, member_local = item["extra_dim"]
                    parts.append(
                        f'<xbrldi:explicitMember dimension="us-gaap:{axis_local}">'
                        f"us-gaap:{member_local}</xbrldi:explicitMember>"
                    )
                segment = "".join(parts)
            seg_xml = f"<xbrli:segment>{segment}</xbrli:segment>" if segment else ""
            contexts[ctx_id] = (
                f'<xbrli:context id="{ctx_id}">'
                f"<xbrli:entity>"
                f'<xbrli:identifier scheme="http://www.sec.gov/CIK">{cik}</xbrli:identifier>'
                f"{seg_xml}</xbrli:entity>"
                f"<xbrli:period><xbrli:instant>{item['instant']}</xbrli:instant></xbrli:period>"
                f"</xbrli:context>"
            )
        prefix, local = item["concept"]
        decimals = (
            f' decimals="{item["decimals"]}"' if item.get("decimals") is not None else ""
        )
        fact_xml.append(
            f'<{prefix}:{local} contextRef="{ctx_id}" unitRef="shares"{decimals}>'
            f"{item['value']}</{prefix}:{local}>"
        )
    return (
        '<?xml version="1.0" encoding="UTF-8"?>'
        f'<xbrli:xbrl xmlns:xbrli="{XBRLI}" xmlns:xbrldi="{XBRLDI}"'
        f' xmlns:us-gaap="{USG}" xmlns:dei="{DEI}" xmlns:ext="http://example.com/ext">'
        '<xbrli:unit id="shares"><xbrli:measure>xbrli:shares</xbrli:measure></xbrli:unit>'
        + "".join(contexts.values())
        + "".join(fact_xml)
        + "</xbrli:xbrl>"
    ).encode("utf-8")
