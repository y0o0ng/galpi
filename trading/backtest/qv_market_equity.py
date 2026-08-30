"""formation 시점 valuation resolution과 class/issuer 시가총액.

Step 4는 여기서 끝난다. B/M을 계산하지 않고 issuer를 랭킹하지 않는다.

모든 금액·주식수 연산은 `Decimal`이다. 이진 float를 쓰지 않는다.
issuer ME는 D에 활성인 **모든** actual ordinary-common class가 풀렸을 때만 나온다.
아는 부분만 더해 완전한 척하지 않는다.
"""

from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation

from . import qv_conversion

OBSERVED_MARKET_PRICE = "OBSERVED_MARKET_PRICE"
CONVERSION_VALUE_PROXY = "CONVERSION_VALUE_PROXY"
MISSING = "MISSING"
RESOLVED = "RESOLVED"


class QVMarketEquityError(Exception):
    """ME 계약을 벗어날 때 올린다."""


def _decimal(text: str, field: str) -> Decimal:
    try:
        return Decimal(str(text).strip())
    except (InvalidOperation, ValueError) as error:
        raise QVMarketEquityError(f"{field}를 Decimal로 읽을 수 없습니다: {text!r}") from error


def _plain(value: Decimal) -> str:
    """지수 표기 없이, 소수부 뒤쪽 0만 떨어뜨린 정확한 표현.

    `bars_daily.raw_close`가 REAL이라 float 경계가 한 번 있다. `Decimal(str(...))`로
    가장 짧은 왕복 표현을 받은 뒤부터는 전부 Decimal 연산이다.
    """
    text = format(value, "f")
    if "." in text:
        text = text.rstrip("0").rstrip(".")
    return text or "0"


@dataclass(frozen=True)
class ValuationResolution:
    class_id: str
    issuer_id: str
    valuation_method: str
    price_symbol: str | None = None
    price_date: str | None = None
    raw_close_text: str | None = None
    price_source_version: str | None = None
    relation_id: str | None = None
    conversion_ratio_text: str | None = None
    reference_class_id: str | None = None
    c3_pre_accession: str | None = None
    c3_pre_document: str | None = None
    c3_post_accession: str | None = None
    c3_post_document: str | None = None
    continuity_status: str = qv_conversion.CONTINUITY_NOT_REQUIRED
    amendment_search_status: str = qv_conversion.AMENDMENT_NOT_REQUIRED
    amendment_searched_accessions: str | None = None
    evidence_cutoff_session: str | None = None
    missing_reason: str | None = None


def _raw_close(
    connection: sqlite3.Connection,
    symbol: str,
    valuation_date: str,
    price_source: str,
    price_source_version: str,
) -> str | None:
    row = connection.execute(
        "SELECT raw_close FROM bars_daily"
        " WHERE symbol = ? AND trade_date = ? AND source = ? AND source_version = ?",
        (symbol, valuation_date, price_source, price_source_version),
    ).fetchone()
    if row is None or row["raw_close"] is None:
        return None
    return format(Decimal(str(row["raw_close"])), "f")


def _active_class(
    connection: sqlite3.Connection,
    class_id: str,
    valuation_date: str,
    identity_source_version: str,
) -> sqlite3.Row | None:
    rows = connection.execute(
        "SELECT * FROM qv_share_classes"
        " WHERE class_id = ? AND source_version = ?"
        "   AND effective_from <= ? AND (effective_to IS NULL OR effective_to > ?)",
        (class_id, identity_source_version, valuation_date, valuation_date),
    ).fetchall()
    if len(rows) != 1:
        return None
    return rows[0]


def resolve_valuation(
    connection: sqlite3.Connection,
    *,
    class_id: str,
    issuer_id: str,
    formation_session: str,
    valuation_date: str,
    identity_source_version: str,
    price_source: str,
    price_source_version: str,
    continuity: qv_conversion.Continuity | None = None,
) -> ValuationResolution:
    """이 formation에서 이 class를 어떻게 값매길지 결정한다."""
    active = _active_class(connection, class_id, valuation_date, identity_source_version)
    if active is None:
        return ValuationResolution(
            class_id, issuer_id, MISSING,
            missing_reason="D 시점에 활성인 class 구간이 정확히 하나가 아니다",
        )
    if active["usable_from_session"] > formation_session:
        return ValuationResolution(
            class_id, issuer_id, MISSING,
            missing_reason="class identity 증거가 formation 시점에 아직 usable하지 않다",
        )

    if active["is_listed"]:
        close = _raw_close(
            connection, active["symbol"], valuation_date, price_source, price_source_version
        )
        if close is None:
            return ValuationResolution(
                class_id, issuer_id, MISSING,
                missing_reason=f"{active['symbol']}의 {valuation_date} raw_close가 없다",
            )
        return ValuationResolution(
            class_id, issuer_id, OBSERVED_MARKET_PRICE,
            price_symbol=active["symbol"], price_date=valuation_date,
            raw_close_text=close, price_source_version=price_source_version,
            evidence_cutoff_session=formation_session,
        )

    # 비상장 -> conversion proxy 자격을 본다.
    relation = qv_conversion.active_relation(
        connection,
        subject_class_id=class_id,
        valuation_date=valuation_date,
        formation_session=formation_session,
        source_version=identity_source_version,
    )
    if relation is None:
        return ValuationResolution(
            class_id, issuer_id, MISSING,
            missing_reason="PIT-usable한 고정 직접 전환 관계가 없다",
        )
    if continuity is None or continuity.status != qv_conversion.CONTINUITY_CONFIRMED:
        reason = (
            continuity.reason
            if continuity is not None and continuity.reason
            else "C3 continuity 증명이 없다"
        )
        return ValuationResolution(
            class_id, issuer_id, MISSING,
            relation_id=relation["relation_id"],
            continuity_status=(
                continuity.status if continuity is not None
                else qv_conversion.CONTINUITY_UNRESOLVED
            ),
            amendment_search_status=(
                continuity.amendment_status if continuity is not None
                else qv_conversion.AMENDMENT_UNRESOLVED
            ),
            missing_reason=f"C3 continuity 미확인: {reason}",
        )

    reference = _active_class(
        connection, relation["reference_class_id"], valuation_date, identity_source_version
    )
    if (
        reference is None
        or not reference["is_listed"]
        or not reference["is_ordinary_common"]
        or reference["issuer_id"] != active["issuer_id"]
    ):
        return ValuationResolution(
            class_id, issuer_id, MISSING,
            relation_id=relation["relation_id"],
            missing_reason="reference class가 D에 같은 issuer의 상장 ordinary class가 아니다",
        )
    if reference["usable_from_session"] > formation_session:
        # subject만 PIT로 보고 reference를 그냥 받으면 lookahead가 열린다.
        return ValuationResolution(
            class_id, issuer_id, MISSING,
            relation_id=relation["relation_id"],
            missing_reason="reference class identity가 formation 시점에 아직 usable하지 않다",
        )
    close = _raw_close(
        connection, reference["symbol"], valuation_date, price_source, price_source_version
    )
    if close is None:
        return ValuationResolution(
            class_id, issuer_id, MISSING,
            relation_id=relation["relation_id"],
            missing_reason=f"reference {reference['symbol']}의 {valuation_date} raw_close가 없다",
        )
    return ValuationResolution(
        class_id, issuer_id, CONVERSION_VALUE_PROXY,
        price_symbol=reference["symbol"], price_date=valuation_date,
        raw_close_text=close, price_source_version=price_source_version,
        relation_id=relation["relation_id"],
        conversion_ratio_text=relation["conversion_ratio_text"],
        reference_class_id=relation["reference_class_id"],
        c3_pre_accession=continuity.pre.accession if continuity.pre else None,
        c3_pre_document=continuity.pre.document_name if continuity.pre else None,
        c3_post_accession=continuity.post.accession if continuity.post else None,
        c3_post_document=continuity.post.document_name if continuity.post else None,
        continuity_status=continuity.status,
        amendment_search_status=continuity.amendment_status,
        amendment_searched_accessions=json.dumps(list(continuity.searched_accessions)),
        evidence_cutoff_session=formation_session,
    )


def store_valuation(
    connection: sqlite3.Connection,
    resolution: ValuationResolution,
    *,
    formation_session: str,
    valuation_date: str,
    source: str,
    source_version: str,
    identity_source_version: str,
    provenance: str,
) -> None:
    with connection:
        connection.execute(
            "INSERT OR REPLACE INTO qv_class_valuation_resolutions"
            " (formation_session, valuation_date, class_id, issuer_id, valuation_method,"
            "  price_symbol, price_date, raw_close_text, price_source_version,"
            "  relation_id, conversion_ratio_text, reference_class_id,"
            "  c3_pre_accession, c3_pre_document, c3_post_accession, c3_post_document,"
            "  continuity_status, amendment_search_status, amendment_searched_accessions,"
            "  evidence_cutoff_session,"
            "  missing_reason, source, source_version, identity_source_version, provenance)"
            " VALUES (" + ", ".join("?" * 25) + ")",
            (
                formation_session, valuation_date, resolution.class_id,
                resolution.issuer_id, resolution.valuation_method,
                resolution.price_symbol, resolution.price_date,
                resolution.raw_close_text, resolution.price_source_version,
                resolution.relation_id, resolution.conversion_ratio_text,
                resolution.reference_class_id,
                resolution.c3_pre_accession, resolution.c3_pre_document,
                resolution.c3_post_accession, resolution.c3_post_document,
                resolution.continuity_status, resolution.amendment_search_status,
                resolution.amendment_searched_accessions,
                resolution.evidence_cutoff_session, resolution.missing_reason,
                source, source_version, identity_source_version, provenance,
            ),
        )


# ── class / issuer 시가총액 ───────────────────────────────────────────────────


@dataclass(frozen=True)
class ClassMarketEquity:
    class_id: str
    issuer_id: str
    status: str
    market_equity_text: str | None
    share_value_text: str | None
    conversion_ratio_text: str | None
    raw_close_text: str | None
    price_symbol: str | None
    valuation_method: str
    selector_path: str
    missing_reason: str | None


def compute_class_market_equity(
    shares, valuation: ValuationResolution
) -> ClassMarketEquity:
    """listed는 shares x raw_close, proxy는 shares x ratio x reference raw_close다."""
    if shares.selector_path == "MISSING" or shares.share_value_text is None:
        return ClassMarketEquity(
            valuation.class_id, valuation.issuer_id, MISSING, None, None, None, None,
            valuation.price_symbol, valuation.valuation_method, shares.selector_path,
            shares.missing_reason or "주식수가 해결되지 않았다",
        )
    if valuation.valuation_method == MISSING:
        return ClassMarketEquity(
            valuation.class_id, valuation.issuer_id, MISSING, None,
            shares.share_value_text, None, None, valuation.price_symbol,
            MISSING, shares.selector_path,
            valuation.missing_reason or "valuation이 해결되지 않았다",
        )

    share_count = _decimal(shares.share_value_text, "share_value_text")
    close = _decimal(valuation.raw_close_text, "raw_close_text")
    if valuation.valuation_method == CONVERSION_VALUE_PROXY:
        ratio = _decimal(valuation.conversion_ratio_text, "conversion_ratio_text")
        equity = share_count * ratio * close
    else:
        ratio = None
        equity = share_count * close
    return ClassMarketEquity(
        valuation.class_id, valuation.issuer_id, RESOLVED, _plain(equity),
        shares.share_value_text,
        valuation.conversion_ratio_text if ratio is not None else None,
        valuation.raw_close_text, valuation.price_symbol,
        valuation.valuation_method, shares.selector_path, None,
    )


@dataclass(frozen=True)
class IssuerMarketEquity:
    issuer_id: str
    status: str
    market_equity_text: str | None
    class_count: int
    resolved_class_count: int
    component_class_ids: tuple[str, ...]
    missing_reason: str | None


def active_ordinary_class_ids(
    connection: sqlite3.Connection,
    *,
    issuer_id: str,
    valuation_date: str,
    identity_source_version: str,
) -> tuple[str, ...]:
    """D에 활성인 actual ordinary-common class 전부. 파생/등가 member는 애초에 없다."""
    rows = connection.execute(
        "SELECT DISTINCT class_id FROM qv_share_classes"
        " WHERE issuer_id = ? AND source_version = ? AND is_ordinary_common = 1"
        "   AND effective_from <= ? AND (effective_to IS NULL OR effective_to > ?)"
        " ORDER BY class_id",
        (issuer_id, identity_source_version, valuation_date, valuation_date),
    ).fetchall()
    return tuple(row["class_id"] for row in rows)


def aggregate_issuer_market_equity(
    issuer_id: str,
    expected_class_ids: tuple[str, ...],
    components: list[ClassMarketEquity],
) -> IssuerMarketEquity:
    """활성 class가 하나라도 미해결이면 issuer ME는 통째로 MISSING이다."""
    by_class = {item.class_id: item for item in components}
    missing = [
        class_id
        for class_id in expected_class_ids
        if class_id not in by_class or by_class[class_id].status != RESOLVED
    ]
    resolved_count = len(expected_class_ids) - len(missing)
    if not expected_class_ids:
        return IssuerMarketEquity(
            issuer_id, MISSING, None, 0, 0, (),
            "D에 활성인 ordinary common class가 없다",
        )
    if missing:
        return IssuerMarketEquity(
            issuer_id, MISSING, None, len(expected_class_ids), resolved_count,
            tuple(expected_class_ids),
            "미해결 active ordinary class: " + ", ".join(sorted(missing)),
        )
    total = sum(
        (_decimal(by_class[class_id].market_equity_text, "market_equity_text")
         for class_id in expected_class_ids),
        Decimal(0),
    )
    return IssuerMarketEquity(
        issuer_id, RESOLVED, _plain(total), len(expected_class_ids),
        resolved_count, tuple(expected_class_ids), None,
    )


def store_market_equity(
    connection: sqlite3.Connection,
    *,
    formation_session: str,
    valuation_date: str,
    classes: list[ClassMarketEquity],
    issuer: IssuerMarketEquity,
    source: str,
    source_version: str,
    identity_source_version: str,
    provenance: str,
) -> None:
    with connection:
        connection.executemany(
            "INSERT OR REPLACE INTO qv_class_market_equity"
            " (formation_session, valuation_date, class_id, issuer_id, status,"
            "  market_equity_text, share_value_text, conversion_ratio_text,"
            "  raw_close_text, price_symbol, valuation_method, selector_path,"
            "  missing_reason, source, source_version, identity_source_version, provenance)"
            " VALUES (" + ", ".join("?" * 17) + ")",
            [
                (
                    formation_session, valuation_date, item.class_id, item.issuer_id,
                    item.status, item.market_equity_text, item.share_value_text,
                    item.conversion_ratio_text, item.raw_close_text, item.price_symbol,
                    item.valuation_method, item.selector_path, item.missing_reason,
                    source, source_version, identity_source_version, provenance,
                )
                for item in classes
            ],
        )
        connection.execute(
            "INSERT OR REPLACE INTO qv_issuer_market_equity"
            " (formation_session, valuation_date, issuer_id, status, market_equity_text,"
            "  class_count, resolved_class_count, component_class_ids, missing_reason,"
            "  source, source_version, identity_source_version, provenance)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                formation_session, valuation_date, issuer.issuer_id, issuer.status,
                issuer.market_equity_text, issuer.class_count,
                issuer.resolved_class_count,
                json.dumps(list(issuer.component_class_ids)),
                issuer.missing_reason, source, source_version,
                identity_source_version, provenance,
            ),
        )
