"""Quality + Value의 point-in-time issuer/share-class identity.

이 모듈은 **economic** identity mapping만 다룬다. shares fact, 가격, formation
snapshot, factor와 수익률은 여기서 계산하지 않는다. 모든 mapping은 명시적으로 등록하며
이름 유사도나 현재 ticker/CIK로 과거를 추정하지 않는다.

**filing-local 의미는 여기 들어오지 않는다.** 옛 시간 구간 XBRL alias 해석기
(`resolve_member`)는 은퇴했다 — accession 단위 binding은 `qv_xbrl_binding`이 맡는다.
"""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass
from datetime import date


OBSERVED_MARKET_PRICE = "OBSERVED_MARKET_PRICE"
CONVERSION_VALUE_PROXY = "CONVERSION_VALUE_PROXY"
MISSING = "MISSING"
VALUATION_METHODS = frozenset(
    {OBSERVED_MARKET_PRICE, CONVERSION_VALUE_PROXY, MISSING}
)


class QVIdentityError(Exception):
    """Identity 계약을 만족하지 못할 때 올린다."""


class UnresolvedIdentityError(QVIdentityError):
    """명시적 mapping이 없어 추정하지 않고 멈출 때 올린다."""


class AmbiguousIdentityError(QVIdentityError):
    """한 시점에 mapping이 둘 이상이라 하나를 고를 수 없을 때 올린다."""


@dataclass(frozen=True)
class Issuer:
    issuer_id: str
    cik: str
    resolution_method: str
    usable_from_session: str
    source: str
    source_version: str
    provenance: str


@dataclass(frozen=True)
class ShareClass:
    class_id: str
    issuer_id: str
    symbol: str | None
    is_ordinary_common: bool
    is_listed: bool
    effective_from: str
    effective_to: str | None
    usable_from_session: str
    source: str
    source_version: str
    provenance: str


@dataclass(frozen=True)
class ResolvedSecurity:
    share_class: ShareClass
    issuer: Issuer


def _required(value: str, field: str) -> str:
    clean = str(value).strip()
    if not clean:
        raise QVIdentityError(f"{field}는 비울 수 없습니다.")
    return clean


def _optional(value: str | None) -> str | None:
    if value is None:
        return None
    clean = str(value).strip()
    return clean or None


def _date(value: str, field: str) -> str:
    clean = _required(value, field)
    try:
        date.fromisoformat(clean)
    except ValueError as error:
        raise QVIdentityError(f"{field}가 YYYY-MM-DD 날짜가 아닙니다: {clean!r}") from error
    return clean


def _period(effective_from: str, effective_to: str | None) -> tuple[str, str | None]:
    start = _date(effective_from, "effective_from")
    end = _date(effective_to, "effective_to") if effective_to else None
    if end is not None and end <= start:
        raise QVIdentityError("effective_to는 effective_from보다 뒤여야 합니다.")
    return start, end


def _normalize_cik(cik: str) -> str:
    clean = _required(cik, "cik")
    if not clean.isdigit() or len(clean) > 10:
        raise QVIdentityError(f"cik는 10자리 이하 숫자여야 합니다: {clean!r}")
    return clean.zfill(10)


def _assert_identity_source(
    connection: sqlite3.Connection, source: str, source_version: str
) -> None:
    row = connection.execute(
        "SELECT 1 FROM data_sources"
        " WHERE source = ? AND source_version = ? AND kind = 'securities'"
        " AND point_in_time = 1 AND survivorship_biased = 0",
        (source, source_version),
    ).fetchone()
    if row is None:
        raise QVIdentityError(
            f"QV identity 출처가 PIT·비생존편향 securities로 선언되지 않았습니다: "
            f"{source}/{source_version}"
        )


def _overlap_sql() -> str:
    return (
        " (? IS NULL OR effective_from < ?)"
        " AND (effective_to IS NULL OR effective_to > ?)"
    )


def _issuer_from_row(row: sqlite3.Row) -> Issuer:
    return Issuer(**dict(row))


def _class_from_row(row: sqlite3.Row) -> ShareClass:
    values = dict(row)
    values["is_ordinary_common"] = bool(values["is_ordinary_common"])
    values["is_listed"] = bool(values["is_listed"])
    return ShareClass(**values)
def register_issuer(
    connection: sqlite3.Connection,
    *,
    issuer_id: str,
    cik: str,
    resolution_method: str,
    usable_from_session: str,
    source: str,
    source_version: str,
    provenance: str,
) -> Issuer:
    """내부 issuer와 외부 SEC registrant identifier를 명시적으로 연결한다."""
    issuer_id = _required(issuer_id, "issuer_id")
    cik = _normalize_cik(cik)
    resolution_method = _required(resolution_method, "resolution_method")
    usable_from_session = _date(usable_from_session, "usable_from_session")
    source = _required(source, "source")
    source_version = _required(source_version, "source_version")
    provenance = _required(provenance, "provenance")
    _assert_identity_source(connection, source, source_version)
    with connection:
        connection.execute(
            "INSERT INTO qv_issuers"
            " (issuer_id, cik, resolution_method, usable_from_session,"
            "  source, source_version, provenance)"
            " VALUES (?, ?, ?, ?, ?, ?, ?)",
            (issuer_id, cik, resolution_method, usable_from_session,
             source, source_version, provenance),
        )
    return get_issuer(connection, issuer_id, source_version)


def get_issuer(
    connection: sqlite3.Connection,
    issuer_id: str,
    source_version: str,
    *,
    usable_by: str | None = None,
) -> Issuer:
    """issuer 매핑 하나. `usable_by`를 주면 그때 아직 못 쓰는 매핑은 보이지 않는다."""
    statement = "SELECT * FROM qv_issuers WHERE issuer_id = ? AND source_version = ?"
    params: list[object] = [issuer_id, source_version]
    if usable_by is not None:
        statement += " AND usable_from_session <= ?"
        params.append(_date(usable_by, "usable_by"))
    row = connection.execute(statement, params).fetchone()
    if row is None:
        raise UnresolvedIdentityError(
            f"issuer mapping이 없습니다: {issuer_id}/{source_version}"
            + (f" (usable_by={usable_by})" if usable_by else "")
        )
    return _issuer_from_row(row)


def get_issuer_by_cik(
    connection: sqlite3.Connection,
    cik: str,
    source_version: str,
    *,
    usable_by: str | None = None,
) -> Issuer:
    normalized = _normalize_cik(cik)
    statement = "SELECT * FROM qv_issuers WHERE cik = ? AND source_version = ?"
    params: list[object] = [normalized, source_version]
    if usable_by is not None:
        statement += " AND usable_from_session <= ?"
        params.append(_date(usable_by, "usable_by"))
    row = connection.execute(statement, params).fetchone()
    if row is None:
        raise UnresolvedIdentityError(
            f"CIK mapping이 없습니다: {normalized}/{source_version}"
            + (f" (usable_by={usable_by})" if usable_by else "")
        )
    return _issuer_from_row(row)


def register_share_class(
    connection: sqlite3.Connection,
    *,
    class_id: str,
    issuer_id: str,
    symbol: str | None,
    is_ordinary_common: bool,
    is_listed: bool,
    effective_from: str,
    effective_to: str | None,
    usable_from_session: str,
    source: str,
    source_version: str,
    provenance: str,
) -> ShareClass:
    """economic share class의 PIT 구간을 등록한다.

    prose alias는 여기 들어오지 않는다. alias는 별도 관계이고 economic class가
    아니다(`qv_share_class_prose_aliases`).

    **XBRL QName은 identity 관계가 아니다.** QName이 어느 class를 뜻하는지는 그 관계를
    등록인이 명시로 세운 accession 안에서만 참이고, 그것은
    `qv_xbrl_binding.resolve_accession_member`가 답한다.
    """
    class_id = _required(class_id, "class_id")
    issuer_id = _required(issuer_id, "issuer_id")
    symbol = _optional(symbol)
    start, end = _period(effective_from, effective_to)
    usable_from_session = _date(usable_from_session, "usable_from_session")
    source = _required(source, "source")
    source_version = _required(source_version, "source_version")
    provenance = _required(provenance, "provenance")
    _assert_identity_source(connection, source, source_version)

    if is_listed and symbol is None:
        raise QVIdentityError("listed class에는 symbol이 필요합니다.")

    issuer = get_issuer(connection, issuer_id, source_version)
    owner = connection.execute(
        "SELECT issuer_id FROM qv_share_classes"
        " WHERE class_id = ? AND source_version = ? AND issuer_id <> ?",
        (class_id, source_version, issuer.issuer_id),
    ).fetchone()
    if owner is not None:
        raise QVIdentityError(
            f"class_id {class_id!r}는 이미 다른 issuer에 속합니다: {owner['issuer_id']}"
        )

    overlap = connection.execute(
        "SELECT 1 FROM qv_share_classes"
        " WHERE class_id = ? AND source_version = ? AND" + _overlap_sql(),
        (class_id, source_version, end, end, start),
    ).fetchone()
    if overlap is not None:
        raise QVIdentityError(f"class_id {class_id!r}의 활성 기간이 겹칩니다.")

    if symbol is not None:
        clash = connection.execute(
            "SELECT class_id FROM qv_share_classes"
            " WHERE symbol = ? AND source_version = ? AND class_id <> ? AND"
            + _overlap_sql(),
            (symbol, source_version, class_id, end, end, start),
        ).fetchone()
        if clash is not None:
            raise QVIdentityError(
                f"symbol {symbol!r}가 같은 시점에 두 class를 가리킵니다: {clash['class_id']}"
            )

    with connection:
        connection.execute(
            "INSERT INTO qv_share_classes"
            " (class_id, issuer_id, symbol, is_ordinary_common, is_listed,"
            "  effective_from, effective_to, usable_from_session,"
            "  source, source_version, provenance)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                class_id,
                issuer.issuer_id,
                symbol,
                int(bool(is_ordinary_common)),
                int(bool(is_listed)),
                start,
                end,
                usable_from_session,
                source,
                source_version,
                provenance,
            ),
        )
    return _active_class_by_id(connection, class_id, start, source_version)


def active_classes(
    connection: sqlite3.Connection,
    issuer_id: str,
    as_of: str,
    source_version: str,
    *,
    ordinary_common_only: bool = False,
) -> tuple[ShareClass, ...]:
    """한 issuer의 시점 기준 active class를 class_id 순으로 돌려준다."""
    as_of = _date(as_of, "as_of")
    statement = (
        "SELECT * FROM qv_share_classes"
        " WHERE issuer_id = ? AND source_version = ?"
        " AND effective_from <= ? AND (effective_to IS NULL OR effective_to > ?)"
    )
    params: list[object] = [issuer_id, source_version, as_of, as_of]
    if ordinary_common_only:
        statement += " AND is_ordinary_common = 1"
    statement += " ORDER BY class_id"
    classes = tuple(
        _class_from_row(row) for row in connection.execute(statement, params)
    )
    class_ids = [item.class_id for item in classes]
    symbols = [item.symbol for item in classes if item.symbol is not None]
    if len(class_ids) != len(set(class_ids)) or len(symbols) != len(set(symbols)):
        raise AmbiguousIdentityError(
            f"issuer의 active class identity가 겹칩니다: {issuer_id}, as_of={as_of}"
        )
    return classes


def _one_class(rows: list[sqlite3.Row], description: str) -> ShareClass:
    if not rows:
        raise UnresolvedIdentityError(f"identity mapping이 없습니다: {description}")
    if len(rows) != 1:
        raise AmbiguousIdentityError(
            f"identity mapping이 한 시점에 {len(rows)}개입니다: {description}"
        )
    return _class_from_row(rows[0])


def _active_class_by_id(
    connection: sqlite3.Connection,
    class_id: str,
    as_of: str,
    source_version: str,
) -> ShareClass:
    rows = connection.execute(
        "SELECT * FROM qv_share_classes"
        " WHERE class_id = ? AND source_version = ?"
        " AND effective_from <= ? AND (effective_to IS NULL OR effective_to > ?)",
        (class_id, source_version, as_of, as_of),
    ).fetchall()
    return _one_class(rows, f"class_id={class_id}, as_of={as_of}")


def resolve_symbol(
    connection: sqlite3.Connection,
    symbol: str,
    as_of: str,
    source_version: str,
) -> ResolvedSecurity:
    """ticker를 그 시점의 class로 먼저 푼 뒤 issuer를 찾는다."""
    symbol = _required(symbol, "symbol").upper()
    as_of = _date(as_of, "as_of")
    rows = connection.execute(
        "SELECT * FROM qv_share_classes"
        " WHERE symbol = ? AND source_version = ?"
        " AND effective_from <= ? AND (effective_to IS NULL OR effective_to > ?)",
        (symbol, source_version, as_of, as_of),
    ).fetchall()
    share_class = _one_class(rows, f"symbol={symbol}, as_of={as_of}")
    return ResolvedSecurity(
        share_class=share_class,
        issuer=get_issuer(connection, share_class.issuer_id, source_version),
    )


def resolve_prose_name(
    connection: sqlite3.Connection,
    issuer_id: str,
    comparison_key: str,
    as_of: str,
    source_version: str,
    *,
    usable_by: str | None = None,
) -> ShareClass:
    """canonical bridge가 있는 prose alias만 class로 푼다.

    `COVER_GROUP_LABEL`은 corroborating이라 단독으로 여기 걸리지 않는다.
    """
    comparison_key = _required(comparison_key, "comparison_key")
    as_of = _date(as_of, "as_of")
    statement = (
        "SELECT class_id FROM qv_share_class_prose_aliases"
        " WHERE issuer_id = ? AND comparison_key = ? AND source_version = ?"
        " AND bridge_type IN ('SECURITY_TITLE_FACT', 'GOVERNING_INSTRUMENT')"
        " AND effective_from <= ? AND (effective_to IS NULL OR effective_to > ?)"
    )
    params: list[object] = [issuer_id, comparison_key, source_version, as_of, as_of]
    if usable_by is not None:
        statement += " AND usable_from_session <= ?"
        params.append(_date(usable_by, "usable_by"))
    rows = connection.execute(statement, params).fetchall()
    description = f"issuer={issuer_id}, prose={comparison_key!r}, as_of={as_of}"
    if not rows:
        raise UnresolvedIdentityError(f"canonical prose bridge가 없습니다: {description}")
    class_ids = {row["class_id"] for row in rows}
    if len(class_ids) != 1:
        raise AmbiguousIdentityError(
            f"prose alias가 한 시점에 {len(class_ids)}개 class로 갑니다: {description}"
        )
    return _active_class_by_id(
        connection, next(iter(class_ids)), as_of, source_version
    )

def resolve_symbols_to_issuers(
    connection: sqlite3.Connection,
    symbols: list[str] | tuple[str, ...] | frozenset[str] | set[str],
    as_of: str,
    source_version: str,
) -> tuple[Issuer, ...]:
    """모든 security를 fail-close로 resolve하고 issuer 단위로 정확히 한 번 돌려준다."""
    resolved = {
        item.issuer.issuer_id: item.issuer
        for item in (
            resolve_symbol(connection, symbol, as_of, source_version)
            for symbol in symbols
        )
    }
    return tuple(resolved[key] for key in sorted(resolved))


def _class_segments(
    connection: sqlite3.Connection,
    class_id: str,
    source_version: str,
    start: str,
    end: str | None,
) -> list[ShareClass]:
    rows = connection.execute(
        "SELECT * FROM qv_share_classes"
        " WHERE class_id = ? AND source_version = ? AND" + _overlap_sql()
        + " ORDER BY effective_from",
        (class_id, source_version, end, end, start),
    ).fetchall()
    return [_class_from_row(row) for row in rows]