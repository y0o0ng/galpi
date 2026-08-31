"""Step 5A-1 — PIT identity coverage inventory.

한 가지 질문만 결정론적으로 답한다.

> 각 6월 formation에서, PIT S&P 500 구성 종목 중 **명시 QV identity manifest로 이미
> 풀리는 것**은 무엇이고, 풀리지 않는 것과 모호한 것은 무엇인가?

**inventory/preflight일 뿐이다.** manifest를 넓히지 않고, SEC 문서를 받지 않으며,
ME를 계산하지 않고, 어떤 Phase 0 gate도 판정하지 않는다.

production identity 정본은 버전 관리되는 manifest와 그것을 materialize한 표뿐이다.
`securities` · 현재 SEC ticker map · `edgar.resolve_cik` · 회사명 매칭 ·
`CIK_OVERRIDES` · fuzzy matching · ticker 연속성 추정 · 현재 issuer identity의 과거
소급은 **여기서 authoritative가 아니다.**
"""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass

RESOLVED = "RESOLVED"
MISSING = "MISSING"
AMBIGUOUS = "AMBIGUOUS"

# 사유는 열거값이다. 자유 문장으로 남기면 나중에 집계할 수 없다.
NO_CLASS_SEGMENT_FOR_SYMBOL = "NO_CLASS_SEGMENT_FOR_SYMBOL"
CLASS_NOT_ACTIVE_AT_FORMATION = "CLASS_NOT_ACTIVE_AT_FORMATION"
CLASS_NOT_LISTED_ORDINARY = "CLASS_NOT_LISTED_ORDINARY"
CLASS_NOT_YET_USABLE = "CLASS_NOT_YET_USABLE"
ISSUER_MISSING = "ISSUER_MISSING"
ISSUER_NOT_YET_USABLE = "ISSUER_NOT_YET_USABLE"
MULTIPLE_CLASS_RESOLUTIONS = "MULTIPLE_CLASS_RESOLUTIONS"
CONTRADICTORY_IDENTITY_STATE = "CONTRADICTORY_IDENTITY_STATE"

DEFAULT_REFERENCE_SYMBOL = "SPY"


class QVInventoryError(Exception):
    """inventory 입력이 계약을 벗어날 때 올린다."""


@dataclass(frozen=True)
class SecurityRow:
    formation_session: str
    symbol: str
    status: str
    class_id: str | None
    issuer_id: str | None
    reason: str

    def as_json(self) -> dict:
        return {
            "formation_session": self.formation_session,
            "symbol": self.symbol,
            "status": self.status,
            "class_id": self.class_id,
            "issuer_id": self.issuer_id,
            "reason": self.reason,
        }


@dataclass(frozen=True)
class IssuerGroup:
    formation_session: str
    issuer_id: str
    member_symbols: tuple[str, ...]
    member_class_ids: tuple[str, ...]

    def as_json(self) -> dict:
        return {
            "formation_session": self.formation_session,
            "issuer_id": self.issuer_id,
            "member_symbols": list(self.member_symbols),
            "member_class_ids": list(self.member_class_ids),
        }


@dataclass(frozen=True)
class FormationSummary:
    formation_year: int
    formation_session: str
    member_count: int
    resolved_count: int
    missing_count: int
    ambiguous_count: int
    resolved_issuer_count: int
    multi_security_issuer_count: int

    def as_json(self) -> dict:
        return {
            "formation_year": self.formation_year,
            "formation_session": self.formation_session,
            "member_count": self.member_count,
            "resolved_count": self.resolved_count,
            "missing_count": self.missing_count,
            "ambiguous_count": self.ambiguous_count,
            "resolved_issuer_count": self.resolved_issuer_count,
            "multi_security_issuer_count": self.multi_security_issuer_count,
        }


@dataclass(frozen=True)
class Inventory:
    index_name: str
    universe_source: str
    universe_source_version: str
    calendar_source: str
    calendar_source_version: str
    identity_source_version: str
    formations: tuple[FormationSummary, ...]
    securities: tuple[SecurityRow, ...]
    issuer_groups: tuple[IssuerGroup, ...]

    def as_json(self, *, git_commit: str | None = None) -> dict:
        """결정론적 semantic payload. 시각 정보를 넣지 않는다."""
        return {
            "starting_git_commit": git_commit,
            "index_name": self.index_name,
            "universe_source": self.universe_source,
            "universe_source_version": self.universe_source_version,
            "calendar_source": self.calendar_source,
            "calendar_source_version": self.calendar_source_version,
            "identity_source_version": self.identity_source_version,
            "formation_sessions": [
                {"formation_year": item.formation_year,
                 "formation_session": item.formation_session}
                for item in self.formations
            ],
            "formations": [item.as_json() for item in self.formations],
            "securities": [item.as_json() for item in self.securities],
            "issuer_groups": [item.as_json() for item in self.issuer_groups],
        }

    def unresolved_symbols(self) -> tuple[str, ...]:
        """formation을 가로질러 한 번이라도 풀리지 않은 심볼."""
        return tuple(
            sorted({row.symbol for row in self.securities if row.status != RESOLVED})
        )


# ── canonical 입력 ────────────────────────────────────────────────────────────


def june_formation_sessions(
    connection: sqlite3.Connection,
    *,
    calendar_source: str,
    calendar_source_version: str,
    reference_symbol: str = DEFAULT_REFERENCE_SYMBOL,
    from_year: int | None = None,
    to_year: int | None = None,
) -> tuple[tuple[int, str], ...]:
    """각 연도 6월의 **마지막 정규 세션**. 6월 30일 같은 달력 날짜를 직접 쓰지 않는다."""
    rows = connection.execute(
        "SELECT substr(trade_date, 1, 4) AS year, MAX(trade_date) AS session"
        " FROM bars_daily"
        " WHERE symbol = ? AND source = ? AND source_version = ?"
        "   AND substr(trade_date, 6, 2) = '06'"
        " GROUP BY substr(trade_date, 1, 4)"
        " ORDER BY year",
        (reference_symbol, calendar_source, calendar_source_version),
    ).fetchall()
    out = []
    for row in rows:
        year = int(row["year"])
        if from_year is not None and year < from_year:
            continue
        if to_year is not None and year > to_year:
            continue
        out.append((year, row["session"]))
    if not out:
        raise QVInventoryError(
            "달력에서 6월 정규 세션을 찾지 못했습니다: "
            f"{reference_symbol} {calendar_source}/{calendar_source_version}"
        )
    return tuple(out)


def pit_members(
    connection: sqlite3.Connection,
    formation_session: str,
    *,
    index_name: str,
    universe_source: str,
    universe_source_version: str,
) -> tuple[str, ...]:
    """`[valid_from, valid_to)` 구간으로 본 formation 시점 구성 종목."""
    rows = connection.execute(
        "SELECT DISTINCT symbol FROM universe_membership"
        " WHERE index_name = ? AND source = ? AND source_version = ?"
        "   AND valid_from <= ?"
        "   AND (valid_to IS NULL OR valid_to > ?)"
        " ORDER BY symbol",
        (index_name, universe_source, universe_source_version,
         formation_session, formation_session),
    ).fetchall()
    return tuple(row["symbol"] for row in rows)


# ── 해석 ──────────────────────────────────────────────────────────────────────


def resolve_security(
    connection: sqlite3.Connection,
    symbol: str,
    formation_session: str,
    identity_source_version: str,
) -> SecurityRow:
    """한 구성 종목이 명시 identity로 풀리는지 본다.

    모호한 집합에서 하나를 고르지 않는다. precedence·최신 행 선택·ticker 휴리스틱·
    수동 override를 쓰지 않는다. 나중에 알게 된 class/issuer를 `usable_from_session`
    이전에 보이게 하지 않는다.
    """
    segments = connection.execute(
        "SELECT class_id, issuer_id, is_listed, is_ordinary_common,"
        "       effective_from, effective_to, usable_from_session"
        " FROM qv_share_classes"
        " WHERE symbol = ? AND source_version = ?"
        " ORDER BY class_id, effective_from",
        (symbol, identity_source_version),
    ).fetchall()

    def row(status, class_id, issuer_id, reason):
        return SecurityRow(
            formation_session, symbol, status, class_id, issuer_id, reason
        )

    if not segments:
        return row(MISSING, None, None, NO_CLASS_SEGMENT_FOR_SYMBOL)

    active = [
        item
        for item in segments
        if item["effective_from"] <= formation_session
        and (item["effective_to"] is None or formation_session < item["effective_to"])
    ]
    if not active:
        return row(MISSING, None, None, CLASS_NOT_ACTIVE_AT_FORMATION)

    ordinary_listed = [
        item
        for item in active
        if item["is_listed"] and item["is_ordinary_common"]
    ]
    if not ordinary_listed:
        return row(MISSING, None, None, CLASS_NOT_LISTED_ORDINARY)

    usable = [
        item
        for item in ordinary_listed
        if item["usable_from_session"] <= formation_session
    ]
    if not usable:
        # 경제적으로는 활성인데 그 시점에 증거가 아직 usable하지 않다.
        return row(MISSING, None, None, CLASS_NOT_YET_USABLE)

    class_ids = {item["class_id"] for item in usable}
    if len(class_ids) > 1:
        return row(AMBIGUOUS, None, None, MULTIPLE_CLASS_RESOLUTIONS)
    if len(usable) > 1:
        # 같은 class_id의 활성 구간이 겹친다. 등록 경로가 막는 상태이므로 fail-close다.
        return row(AMBIGUOUS, None, None, CONTRADICTORY_IDENTITY_STATE)

    selected = usable[0]
    class_id = selected["class_id"]
    owners = {item["issuer_id"] for item in segments if item["class_id"] == class_id}
    if len(owners) != 1:
        return row(AMBIGUOUS, class_id, None, CONTRADICTORY_IDENTITY_STATE)
    issuer_id = selected["issuer_id"]

    issuers = connection.execute(
        "SELECT issuer_id, usable_from_session FROM qv_issuers"
        " WHERE issuer_id = ? AND source_version = ?",
        (issuer_id, identity_source_version),
    ).fetchall()
    if not issuers:
        return row(MISSING, class_id, None, ISSUER_MISSING)
    if len(issuers) > 1:
        return row(AMBIGUOUS, class_id, None, CONTRADICTORY_IDENTITY_STATE)
    if issuers[0]["usable_from_session"] > formation_session:
        return row(MISSING, class_id, None, ISSUER_NOT_YET_USABLE)

    return row(RESOLVED, class_id, issuer_id, RESOLVED)


def build_inventory(
    connection: sqlite3.Connection,
    *,
    index_name: str,
    universe_source: str,
    universe_source_version: str,
    calendar_source: str,
    calendar_source_version: str,
    identity_source_version: str,
    reference_symbol: str = DEFAULT_REFERENCE_SYMBOL,
    from_year: int | None = None,
    to_year: int | None = None,
) -> Inventory:
    """formation × PIT 구성 종목 격자를 결정론적으로 훑는다."""
    formations = june_formation_sessions(
        connection,
        calendar_source=calendar_source,
        calendar_source_version=calendar_source_version,
        reference_symbol=reference_symbol,
        from_year=from_year,
        to_year=to_year,
    )

    security_rows: list[SecurityRow] = []
    issuer_groups: list[IssuerGroup] = []
    summaries: list[FormationSummary] = []

    for year, session in formations:
        members = pit_members(
            connection, session,
            index_name=index_name,
            universe_source=universe_source,
            universe_source_version=universe_source_version,
        )
        rows = [
            resolve_security(connection, symbol, session, identity_source_version)
            for symbol in members
        ]
        security_rows.extend(rows)

        # 같은 issuer가 여러 구성 종목으로 나타나는 것은 identity 오류가 아니다.
        # security 행은 그대로 두고 issuer 단위 묶음을 따로 만든다. 순위는 매기지 않는다.
        grouped: dict[str, list[SecurityRow]] = {}
        for item in rows:
            if item.status != RESOLVED or item.issuer_id is None:
                continue
            grouped.setdefault(item.issuer_id, []).append(item)
        groups = [
            IssuerGroup(
                session,
                issuer_id,
                tuple(sorted(entry.symbol for entry in entries)),
                tuple(sorted({entry.class_id for entry in entries if entry.class_id})),
            )
            for issuer_id, entries in sorted(grouped.items())
        ]
        issuer_groups.extend(groups)

        summaries.append(
            FormationSummary(
                formation_year=year,
                formation_session=session,
                member_count=len(members),
                resolved_count=sum(1 for item in rows if item.status == RESOLVED),
                missing_count=sum(1 for item in rows if item.status == MISSING),
                ambiguous_count=sum(1 for item in rows if item.status == AMBIGUOUS),
                resolved_issuer_count=len(groups),
                multi_security_issuer_count=sum(
                    1 for group in groups if len(group.member_symbols) > 1
                ),
            )
        )

    return Inventory(
        index_name=index_name,
        universe_source=universe_source,
        universe_source_version=universe_source_version,
        calendar_source=calendar_source,
        calendar_source_version=calendar_source_version,
        identity_source_version=identity_source_version,
        formations=tuple(summaries),
        securities=tuple(
            sorted(security_rows, key=lambda item: (item.formation_session, item.symbol))
        ),
        issuer_groups=tuple(
            sorted(issuer_groups, key=lambda item: (item.formation_session, item.issuer_id))
        ),
    )
