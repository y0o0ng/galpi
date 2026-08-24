"""Quality + Value의 point-in-time issuer/share-class identity.

이 모듈은 identity mapping만 다룬다. shares fact, 가격, formation snapshot, factor와
수익률은 여기서 계산하지 않는다. 모든 mapping은 명시적으로 등록하며 이름 유사도나
현재 ticker/CIK로 과거를 추정하지 않는다.
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
    source: str
    source_version: str
    provenance: str


@dataclass(frozen=True)
class ShareClass:
    class_id: str
    issuer_id: str
    symbol: str | None
    xbrl_axis: str | None
    xbrl_member: str | None
    is_ordinary_common: bool
    is_listed: bool
    effective_from: str
    effective_to: str | None
    source: str
    source_version: str
    provenance: str


@dataclass(frozen=True)
class ClassValuation:
    class_id: str
    valuation_method: str
    reference_class_id: str | None
    conversion_ratio: float | None
    effective_from: str
    effective_to: str | None
    source_accession: str | None
    missing_reason: str | None
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
        " WHERE source = ? AND source_version = ? AND kind = 'securities'",
        (source, source_version),
    ).fetchone()
    if row is None:
        raise QVIdentityError(
            f"QV identity 출처가 securities kind로 선언되지 않았습니다: "
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


def _valuation_from_row(row: sqlite3.Row) -> ClassValuation:
    return ClassValuation(**dict(row))


def register_issuer(
    connection: sqlite3.Connection,
    *,
    issuer_id: str,
    cik: str,
    resolution_method: str,
    source: str,
    source_version: str,
    provenance: str,
) -> Issuer:
    """내부 issuer와 외부 SEC registrant identifier를 명시적으로 연결한다."""
    issuer_id = _required(issuer_id, "issuer_id")
    cik = _normalize_cik(cik)
    resolution_method = _required(resolution_method, "resolution_method")
    source = _required(source, "source")
    source_version = _required(source_version, "source_version")
    provenance = _required(provenance, "provenance")
    _assert_identity_source(connection, source, source_version)
    with connection:
        connection.execute(
            "INSERT INTO qv_issuers"
            " (issuer_id, cik, resolution_method, source, source_version, provenance)"
            " VALUES (?, ?, ?, ?, ?, ?)",
            (issuer_id, cik, resolution_method, source, source_version, provenance),
        )
    return get_issuer(connection, issuer_id, source_version)


def get_issuer(
    connection: sqlite3.Connection, issuer_id: str, source_version: str
) -> Issuer:
    row = connection.execute(
        "SELECT * FROM qv_issuers WHERE issuer_id = ? AND source_version = ?",
        (issuer_id, source_version),
    ).fetchone()
    if row is None:
        raise UnresolvedIdentityError(
            f"issuer mapping이 없습니다: {issuer_id}/{source_version}"
        )
    return _issuer_from_row(row)


def get_issuer_by_cik(
    connection: sqlite3.Connection, cik: str, source_version: str
) -> Issuer:
    normalized = _normalize_cik(cik)
    row = connection.execute(
        "SELECT * FROM qv_issuers WHERE cik = ? AND source_version = ?",
        (normalized, source_version),
    ).fetchone()
    if row is None:
        raise UnresolvedIdentityError(
            f"CIK mapping이 없습니다: {normalized}/{source_version}"
        )
    return _issuer_from_row(row)


def register_share_class(
    connection: sqlite3.Connection,
    *,
    class_id: str,
    issuer_id: str,
    symbol: str | None,
    xbrl_axis: str | None,
    xbrl_member: str | None,
    is_ordinary_common: bool,
    is_listed: bool,
    effective_from: str,
    effective_to: str | None,
    source: str,
    source_version: str,
    provenance: str,
) -> ShareClass:
    """원문으로 확인된 실제 share class의 PIT 구간 하나를 등록한다."""
    class_id = _required(class_id, "class_id")
    issuer_id = _required(issuer_id, "issuer_id")
    symbol = _optional(symbol)
    symbol = symbol.upper() if symbol else None
    xbrl_axis = _optional(xbrl_axis)
    xbrl_member = _optional(xbrl_member)
    start, end = _period(effective_from, effective_to)
    source = _required(source, "source")
    source_version = _required(source_version, "source_version")
    provenance = _required(provenance, "provenance")
    _assert_identity_source(connection, source, source_version)
    get_issuer(connection, issuer_id, source_version)

    if (xbrl_axis is None) != (xbrl_member is None):
        raise QVIdentityError("xbrl_axis와 xbrl_member는 함께 있거나 함께 없어야 합니다.")
    if is_listed and symbol is None:
        raise QVIdentityError("listed class에는 symbol이 필요합니다.")

    prior_issuers = {
        row["issuer_id"]
        for row in connection.execute(
            "SELECT DISTINCT issuer_id FROM qv_share_classes"
            " WHERE class_id = ? AND source_version = ?",
            (class_id, source_version),
        )
    }
    if prior_issuers and prior_issuers != {issuer_id}:
        raise QVIdentityError(
            f"class_id {class_id!r}를 다른 issuer에 재사용할 수 없습니다."
        )

    params = (end, end, start)
    overlap = connection.execute(
        "SELECT class_id FROM qv_share_classes"
        " WHERE class_id = ? AND source_version = ? AND" + _overlap_sql(),
        (class_id, source_version, *params),
    ).fetchone()
    if overlap is not None:
        raise QVIdentityError(f"class_id {class_id!r}의 active period가 겹칩니다.")

    if symbol is not None:
        overlap = connection.execute(
            "SELECT class_id FROM qv_share_classes"
            " WHERE symbol = ? AND source_version = ? AND" + _overlap_sql(),
            (symbol, source_version, *params),
        ).fetchone()
        if overlap is not None:
            raise QVIdentityError(
                f"symbol {symbol!r}이 같은 시점에 여러 share class를 가리킵니다."
            )

    if xbrl_axis is not None:
        overlap = connection.execute(
            "SELECT class_id FROM qv_share_classes"
            " WHERE issuer_id = ? AND xbrl_axis = ? AND xbrl_member = ?"
            " AND source_version = ? AND" + _overlap_sql(),
            (issuer_id, xbrl_axis, xbrl_member, source_version, *params),
        ).fetchone()
        if overlap is not None:
            raise QVIdentityError(
                f"{issuer_id}의 XBRL member가 같은 시점에 여러 class를 가리킵니다: "
                f"{xbrl_axis}/{xbrl_member}"
            )

    with connection:
        connection.execute(
            "INSERT INTO qv_share_classes"
            " (class_id, issuer_id, symbol, xbrl_axis, xbrl_member,"
            "  is_ordinary_common, is_listed, effective_from, effective_to,"
            "  source, source_version, provenance)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                class_id,
                issuer_id,
                symbol,
                xbrl_axis,
                xbrl_member,
                int(is_ordinary_common),
                int(is_listed),
                start,
                end,
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
    members = [
        (item.xbrl_axis, item.xbrl_member)
        for item in classes
        if item.xbrl_axis is not None
    ]
    if (
        len(class_ids) != len(set(class_ids))
        or len(symbols) != len(set(symbols))
        or len(members) != len(set(members))
    ):
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


def resolve_member(
    connection: sqlite3.Connection,
    issuer_id: str,
    xbrl_axis: str,
    xbrl_member: str,
    as_of: str,
    source_version: str,
) -> ShareClass:
    """명시적으로 등록된 exact axis/member만 class로 푼다."""
    axis = _required(xbrl_axis, "xbrl_axis")
    member = _required(xbrl_member, "xbrl_member")
    as_of = _date(as_of, "as_of")
    rows = connection.execute(
        "SELECT * FROM qv_share_classes"
        " WHERE issuer_id = ? AND xbrl_axis = ? AND xbrl_member = ?"
        " AND source_version = ?"
        " AND effective_from <= ? AND (effective_to IS NULL OR effective_to > ?)",
        (issuer_id, axis, member, source_version, as_of, as_of),
    ).fetchall()
    return _one_class(
        rows, f"issuer={issuer_id}, member={axis}/{member}, as_of={as_of}"
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


def _covers_period(
    segments: list[ShareClass], start: str, end: str | None
) -> bool:
    cursor = start
    for segment in segments:
        if segment.effective_from > cursor:
            return False
        if segment.effective_to is None:
            return True
        if segment.effective_to > cursor:
            cursor = segment.effective_to
        if end is not None and cursor >= end:
            return True
    return False


def register_class_valuation(
    connection: sqlite3.Connection,
    *,
    class_id: str,
    valuation_method: str,
    reference_class_id: str | None,
    conversion_ratio: float | None,
    effective_from: str,
    effective_to: str | None,
    source_accession: str | None,
    missing_reason: str | None,
    source: str,
    source_version: str,
    provenance: str,
) -> ClassValuation:
    """class의 시점별 observed/proxy/missing valuation 계약을 등록한다."""
    class_id = _required(class_id, "class_id")
    valuation_method = _required(valuation_method, "valuation_method")
    reference_class_id = _optional(reference_class_id)
    source_accession = _optional(source_accession)
    missing_reason = _optional(missing_reason)
    start, end = _period(effective_from, effective_to)
    source = _required(source, "source")
    source_version = _required(source_version, "source_version")
    provenance = _required(provenance, "provenance")
    _assert_identity_source(connection, source, source_version)
    if valuation_method not in VALUATION_METHODS:
        raise QVIdentityError(f"모르는 valuation_method입니다: {valuation_method!r}")

    subject_segments = _class_segments(
        connection, class_id, source_version, start, end
    )
    if not _covers_period(subject_segments, start, end):
        raise QVIdentityError(
            f"valuation 기간 전체를 덮는 class identity가 없습니다: {class_id}"
        )
    if not all(item.is_ordinary_common for item in subject_segments):
        raise QVIdentityError("valuation은 actual ordinary common class에만 붙일 수 있습니다.")
    subject = subject_segments[0]

    overlap = connection.execute(
        "SELECT 1 FROM qv_class_valuation"
        " WHERE class_id = ? AND source_version = ? AND" + _overlap_sql(),
        (class_id, source_version, end, end, start),
    ).fetchone()
    if overlap is not None:
        raise QVIdentityError(f"class_id {class_id!r}의 valuation 기간이 겹칩니다.")

    if valuation_method == OBSERVED_MARKET_PRICE:
        if not all(item.is_listed for item in subject_segments):
            raise QVIdentityError("OBSERVED_MARKET_PRICE는 listed class에만 쓸 수 있습니다.")
        if reference_class_id is not None or conversion_ratio is not None or missing_reason:
            raise QVIdentityError("observed valuation에는 reference/ratio/missing reason이 없습니다.")
    elif valuation_method == CONVERSION_VALUE_PROXY:
        if any(item.is_listed for item in subject_segments):
            raise QVIdentityError("listed class에 conversion proxy를 붙일 수 없습니다.")
        if reference_class_id is None or conversion_ratio is None or conversion_ratio <= 0:
            raise QVIdentityError("conversion proxy에는 reference class와 양수 ratio가 필요합니다.")
        if source_accession is None:
            raise QVIdentityError("conversion proxy에는 원문 source_accession이 필요합니다.")
        reference_segments = _class_segments(
            connection, reference_class_id, source_version, start, end
        )
        if not _covers_period(reference_segments, start, end):
            raise QVIdentityError("reference class가 conversion 기간 전체에 active하지 않습니다.")
        if any(
            item.issuer_id != subject.issuer_id
            or not item.is_listed
            or not item.is_ordinary_common
            for item in reference_segments
        ):
            raise QVIdentityError(
                "reference class는 같은 issuer의 listed ordinary common class여야 합니다."
            )
        if missing_reason is not None:
            raise QVIdentityError("conversion proxy에는 missing reason을 붙이지 않습니다.")
    else:
        if any(item.is_listed for item in subject_segments):
            raise QVIdentityError("listed class는 MISSING valuation으로 등록할 수 없습니다.")
        if reference_class_id is not None or conversion_ratio is not None:
            raise QVIdentityError("MISSING valuation에는 reference나 ratio를 넣지 않습니다.")
        if missing_reason is None:
            raise QVIdentityError("MISSING valuation에는 coverage용 missing reason이 필요합니다.")

    with connection:
        connection.execute(
            "INSERT INTO qv_class_valuation"
            " (class_id, valuation_method, reference_class_id, conversion_ratio,"
            "  effective_from, effective_to, source_accession, missing_reason,"
            "  source, source_version, provenance)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                class_id,
                valuation_method,
                reference_class_id,
                conversion_ratio,
                start,
                end,
                source_accession,
                missing_reason,
                source,
                source_version,
                provenance,
            ),
        )
    return valuation_at(connection, class_id, start, source_version)


def valuation_at(
    connection: sqlite3.Connection,
    class_id: str,
    as_of: str,
    source_version: str,
) -> ClassValuation:
    """한 class의 시점 기준 valuation 관계 하나를 돌려주고 ambiguity는 거부한다."""
    as_of = _date(as_of, "as_of")
    rows = connection.execute(
        "SELECT * FROM qv_class_valuation"
        " WHERE class_id = ? AND source_version = ?"
        " AND effective_from <= ? AND (effective_to IS NULL OR effective_to > ?)",
        (class_id, source_version, as_of, as_of),
    ).fetchall()
    if not rows:
        raise UnresolvedIdentityError(
            f"valuation mapping이 없습니다: class_id={class_id}, as_of={as_of}"
        )
    if len(rows) != 1:
        raise AmbiguousIdentityError(
            f"valuation mapping이 한 시점에 {len(rows)}개입니다: "
            f"class_id={class_id}, as_of={as_of}"
        )
    valuation = _valuation_from_row(rows[0])
    subject = _active_class_by_id(connection, class_id, as_of, source_version)
    if valuation.valuation_method == OBSERVED_MARKET_PRICE and not subject.is_listed:
        raise QVIdentityError("unlisted class의 observed valuation은 사용할 수 없습니다.")
    if valuation.valuation_method == CONVERSION_VALUE_PROXY:
        if subject.is_listed or valuation.reference_class_id is None:
            raise QVIdentityError("잘못된 conversion valuation relation입니다.")
        reference = _active_class_by_id(
            connection, valuation.reference_class_id, as_of, source_version
        )
        if (
            reference.issuer_id != subject.issuer_id
            or not reference.is_listed
            or not reference.is_ordinary_common
        ):
            raise QVIdentityError("conversion reference class identity가 유효하지 않습니다.")
    return valuation
