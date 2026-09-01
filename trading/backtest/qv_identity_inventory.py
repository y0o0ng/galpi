"""Step 5A-1 — **static explicit identity mapping coverage demand** inventory.

한 가지 질문만 결정론적으로 답한다.

> 각 6월 formation에서, PIT S&P 500 구성 종목 중 **선택된 manifest에 명시적 economic
> share-class/issuer 매핑이 존재하는 것**은 무엇이고, 어떤 것이 5A-2 identity 작업을
> 필요로 하는가?

**이것은 PIT identity resolution이 아니다.** 매핑의 **존재/수요**를 재는 것이지 그
매핑이 과거에 실제로 사용 가능했는지를 재는 것이 아니다.

`usable_from_session` · `resolved_usable_session` · `qv_identity_evidence` ·
`qv_sec_filings`를 **여기서 보지 않는다.** 그것들은 5A-3이 증거를 materialize한 뒤에야
존재하고, 그때 Step 4의 PIT 계약이 정본이 된다. 5A-1이 그것에 기대면 순환 의존이 된다 —
materialize 전에 돌리면 "매핑이 없다"와 "manifest가 아직 DB에 안 들어갔다"를 구분하지
못한다.

따라서 이 단계는 **manifest 내용에서 직접** 읽는다. `qv_share_classes` /
`qv_issuers` 행이 하나도 없어도 돌아야 한다.

production 매핑 정본은 네 manifest 파일뿐이다. `securities` · 현재 SEC ticker map ·
`edgar.resolve_cik` · `CIK_OVERRIDES` · 회사명/fuzzy 매칭 · ticker 연속성 추정 ·
현재 identity의 과거 소급은 여기서 authoritative가 아니다.

**universe/bar 심볼은 SEC 경제적 심볼이 아니다.** production 과거 유니버스는 재사용된
과거 티커 일부를 벤더 계열 코드로 바꿔 `universe_membership`에 넣는다. 그래서 이 단계는
두 값을 끝까지 구분해서 들고 다닌다.

```text
member_symbol / data_symbol   universe_membership에 저장된 심볼(시장 데이터 계열)
identity_symbol               SEC identity / manifest 조회에 쓰는 실제 거래 심볼
```

manifest 조회는 **`identity_symbol`로만** 한다. 다리는
`trading/universe/reused-tickers.csv`(`qv_symbol_bridge`) 하나가 정본이고 접미사
휴리스틱을 쓰지 않는다.
"""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass

from .qv_symbol_bridge import (
    BRIDGE_PROVENANCE_KIND,
    BRIDGE_PROVENANCE_NOTE,
    DIRECT,
    REUSED_VENDOR_SERIES,
    SymbolBridge,
)

# 상태 어휘를 production PIT identity resolution과 **의도적으로 다르게** 둔다.
MAPPED = "MAPPED"
UNMAPPED = "UNMAPPED"
AMBIGUOUS_MAPPING = "AMBIGUOUS_MAPPING"

# 사유는 열거값이다. 자유 문장으로 남기면 나중에 집계할 수 없다.
NO_CLASS_MAPPING_FOR_SYMBOL = "NO_CLASS_MAPPING_FOR_SYMBOL"
CLASS_NOT_ACTIVE_AT_FORMATION = "CLASS_NOT_ACTIVE_AT_FORMATION"
CLASS_NOT_LISTED_ORDINARY = "CLASS_NOT_LISTED_ORDINARY"
ISSUER_MAPPING_MISSING = "ISSUER_MAPPING_MISSING"
MULTIPLE_CLASS_MAPPINGS = "MULTIPLE_CLASS_MAPPINGS"
CONTRADICTORY_MANIFEST_STATE = "CONTRADICTORY_MANIFEST_STATE"

DEFAULT_REFERENCE_SYMBOL = "SPY"


class QVInventoryError(Exception):
    """inventory 입력이 계약을 벗어날 때 올린다."""


@dataclass(frozen=True)
class MembershipRow:
    """`universe_membership` 한 줄에서 identity 판정에 필요한 것만.

    `member_symbol`은 저장된 시장 데이터 계열 심볼이고 `identity_symbol`은 명시 다리가
    돌려준 실제 거래 심볼이다. 둘을 합치지 않는다.
    """

    member_symbol: str
    identity_symbol: str
    symbol_bridge_kind: str
    valid_from: str
    valid_to: str | None


@dataclass(frozen=True)
class SecurityRow:
    formation_session: str
    member_symbol: str
    identity_symbol: str
    symbol_bridge_kind: str
    status: str
    class_id: str | None
    issuer_id: str | None
    reason: str

    def as_json(self) -> dict:
        return {
            "formation_session": self.formation_session,
            "member_symbol": self.member_symbol,
            "identity_symbol": self.identity_symbol,
            "symbol_bridge_kind": self.symbol_bridge_kind,
            "status": self.status,
            "class_id": self.class_id,
            "issuer_id": self.issuer_id,
            "reason": self.reason,
        }


@dataclass(frozen=True)
class IssuerGroup:
    """issuer 단위 묶음. **추적을 위해 데이터 계열 심볼도 함께 남긴다.**

    identity 판정 자체는 `identity_symbols`로 이미 끝났고, `member_symbols`는 그 줄이
    어느 시장 데이터 계열에서 왔는지를 되짚기 위한 것이다.
    """

    formation_session: str
    issuer_id: str
    member_symbols: tuple[str, ...]
    identity_symbols: tuple[str, ...]
    member_class_ids: tuple[str, ...]

    def as_json(self) -> dict:
        return {
            "formation_session": self.formation_session,
            "issuer_id": self.issuer_id,
            "member_symbols": list(self.member_symbols),
            "identity_symbols": list(self.identity_symbols),
            "member_class_ids": list(self.member_class_ids),
        }


@dataclass(frozen=True)
class FormationSummary:
    formation_year: int
    formation_session: str
    member_count: int
    mapped_count: int
    unmapped_count: int
    ambiguous_count: int
    mapped_issuer_count: int
    multi_security_issuer_count: int

    def as_json(self) -> dict:
        return {
            "formation_year": self.formation_year,
            "formation_session": self.formation_session,
            "member_count": self.member_count,
            "mapped_count": self.mapped_count,
            "unmapped_count": self.unmapped_count,
            "ambiguous_count": self.ambiguous_count,
            "mapped_issuer_count": self.mapped_issuer_count,
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
    # universe/market-data 심볼 provenance. **identity bundle의 일부가 아니다.**
    reused_series_source: str
    reused_series_source_version: str
    translated_membership_rows: int
    formations: tuple[FormationSummary, ...]
    securities: tuple[SecurityRow, ...]
    issuer_groups: tuple[IssuerGroup, ...]

    def as_json(self, *, git_commit: str | None = None) -> dict:
        """결정론적 semantic payload. 시각 정보를 넣지 않는다."""
        return {
            "stage": "5A-1",
            "measures": "STATIC_MAPPING_COVERAGE_DEMAND",
            "note": (
                "static manifest mapping coverage only — not PIT identity usability. "
                "usable_from_session is materialized in 5A-3."
            ),
            "starting_git_commit": git_commit,
            "index_name": self.index_name,
            "universe_source": self.universe_source,
            "universe_source_version": self.universe_source_version,
            "calendar_source": self.calendar_source,
            "calendar_source_version": self.calendar_source_version,
            "identity_source_version": self.identity_source_version,
            # 재사용 계열 다리는 universe/market-data 심볼 provenance다. identity 증거가
            # 아니므로 identity bundle과 같은 자리에 두지 않는다.
            "reused_series_source": self.reused_series_source,
            "reused_series_source_version": self.reused_series_source_version,
            "symbol_bridge": {
                "kind": BRIDGE_PROVENANCE_KIND,
                "note": BRIDGE_PROVENANCE_NOTE,
                "reused_series_source": self.reused_series_source,
                "reused_series_source_version": self.reused_series_source_version,
                "translated_membership_rows": self.translated_membership_rows,
            },
            "formation_sessions": [
                {"formation_year": item.formation_year,
                 "formation_session": item.formation_session}
                for item in self.formations
            ],
            "formations": [item.as_json() for item in self.formations],
            "securities": [item.as_json() for item in self.securities],
            "issuer_groups": [item.as_json() for item in self.issuer_groups],
        }

    def mapping_demand_work_items(self) -> tuple[tuple[str, str], ...]:
        """5A-2 작업 단위 — `(member_symbol, identity_symbol)`.

        **identity 심볼 하나로 뭉개지 않는다.** 같은 티커를 서로 다른 발행사가 겹치지
        않는 기간에 쓸 수 있고, 그 episode를 가르는 것이 데이터 계열 심볼이다.
        """
        return tuple(
            sorted(
                {
                    (row.member_symbol, row.identity_symbol)
                    for row in self.securities
                    if row.status != MAPPED
                }
            )
        )

    def mapping_demand_symbols(self) -> tuple[str, ...]:
        """수요의 고유 **경제적** 심볼. 작업량은 `mapping_demand_work_items()`가 준다."""
        return tuple(
            sorted({row.identity_symbol for row in self.securities if row.status != MAPPED})
        )


# ── canonical 입력 (DB) ───────────────────────────────────────────────────────


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


def pit_membership_rows(
    connection: sqlite3.Connection,
    formation_session: str,
    *,
    index_name: str,
    universe_source: str,
    universe_source_version: str,
    symbol_bridge: SymbolBridge,
) -> tuple[MembershipRow, ...]:
    """`[valid_from, valid_to)` 구간으로 본 formation 시점 구성 종목.

    **스키마를 바꾸지 않는다.** 저장된 심볼을 그대로 읽되 `valid_from`을 함께 들고 와서
    `(member_symbol, valid_from)`으로 경제적 심볼을 명시 다리에서 푼다. 구간 정체성이
    다리의 grain이므로 심볼만 `DISTINCT`로 뽑으면 그것을 물어볼 수 없다.
    """
    rows = connection.execute(
        "SELECT DISTINCT symbol, valid_from, valid_to FROM universe_membership"
        " WHERE index_name = ? AND source = ? AND source_version = ?"
        "   AND valid_from <= ?"
        "   AND (valid_to IS NULL OR valid_to > ?)"
        " ORDER BY symbol, valid_from",
        (index_name, universe_source, universe_source_version,
         formation_session, formation_session),
    ).fetchall()
    out: list[MembershipRow] = []
    for row in rows:
        identity, kind = symbol_bridge.resolve(row["symbol"], row["valid_from"])
        out.append(
            MembershipRow(
                member_symbol=row["symbol"],
                identity_symbol=identity,
                symbol_bridge_kind=kind,
                valid_from=row["valid_from"],
                valid_to=row["valid_to"],
            )
        )
    return tuple(out)


# ── manifest 인덱스 ───────────────────────────────────────────────────────────


@dataclass(frozen=True)
class ManifestIndex:
    """manifest 내용을 심볼 기준으로 한 번만 훑어 만든 조회 구조."""

    identity_source_version: str
    by_symbol: dict            # symbol -> list[share_class row]
    class_owners: dict         # class_id -> set[issuer_id]
    issuer_ids: frozenset


def index_manifest(manifest) -> ManifestIndex:
    """`qv_manifest.load_manifest()`가 돌려준 bundle을 조회용으로 편다."""
    by_symbol: dict[str, list[dict]] = {}
    class_owners: dict[str, set[str]] = {}
    for row in manifest.rows["share_classes.jsonl"]:
        class_owners.setdefault(row["class_id"], set()).add(row["issuer_id"])
        symbol = row.get("symbol")
        if symbol:
            by_symbol.setdefault(symbol, []).append(row)
    return ManifestIndex(
        identity_source_version=manifest.identity_source_version,
        by_symbol=by_symbol,
        class_owners=class_owners,
        issuer_ids=frozenset(
            row["issuer_id"] for row in manifest.rows["issuers.jsonl"]
        ),
    )


# ── static 매핑 판정 ──────────────────────────────────────────────────────────


def map_security(
    index: ManifestIndex,
    member_symbol: str,
    formation_session: str,
    *,
    identity_symbol: str | None = None,
    symbol_bridge_kind: str = DIRECT,
) -> SecurityRow:
    """구성 종목 하나에 대한 **static** manifest 매핑을 본다.

    조회 키는 **`identity_symbol`이다.** 벤더 계열 심볼(`TFCFA`·`MON_OLD`…)로 manifest를
    찾지 않는다 — manifest는 SEC 경제적 identity 정본이고 벤더 코드를 담지 않는다.
    `identity_symbol`을 주지 않으면 다리를 거치지 않은 직접 심볼로 본다.

    `usable_from_session`을 보지 않는다. 이 단계는 매핑이 **존재하는가**를 재고,
    그 매핑이 그때 실제로 쓸 수 있었는가는 5A-3이 증거를 materialize한 뒤에 정한다.

    모호한 집합에서 하나를 고르지 않는다.
    """
    symbol = identity_symbol if identity_symbol is not None else member_symbol

    def row(status, class_id, issuer_id, reason):
        return SecurityRow(
            formation_session, member_symbol, symbol, symbol_bridge_kind,
            status, class_id, issuer_id, reason,
        )

    segments = index.by_symbol.get(symbol, ())
    if not segments:
        return row(UNMAPPED, None, None, NO_CLASS_MAPPING_FOR_SYMBOL)

    active = [
        item
        for item in segments
        if item["effective_from"] <= formation_session
        and (item["effective_to"] is None or formation_session < item["effective_to"])
    ]
    if not active:
        return row(UNMAPPED, None, None, CLASS_NOT_ACTIVE_AT_FORMATION)

    eligible = [
        item for item in active if item["is_listed"] and item["is_ordinary_common"]
    ]
    if not eligible:
        return row(UNMAPPED, None, None, CLASS_NOT_LISTED_ORDINARY)

    class_ids = {item["class_id"] for item in eligible}
    if len(class_ids) > 1:
        return row(AMBIGUOUS_MAPPING, None, None, MULTIPLE_CLASS_MAPPINGS)
    if len(eligible) > 1:
        # 같은 class_id의 활성 구간이 겹친다. 결정론적 매핑을 세울 수 없다.
        return row(AMBIGUOUS_MAPPING, None, None, CONTRADICTORY_MANIFEST_STATE)

    selected = eligible[0]
    class_id = selected["class_id"]
    owners = index.class_owners.get(class_id, set())
    if len(owners) != 1:
        return row(AMBIGUOUS_MAPPING, class_id, None, CONTRADICTORY_MANIFEST_STATE)

    issuer_id = selected["issuer_id"]
    if issuer_id not in index.issuer_ids:
        return row(UNMAPPED, class_id, None, ISSUER_MAPPING_MISSING)

    return row(MAPPED, class_id, issuer_id, MAPPED)


def build_inventory(
    connection: sqlite3.Connection,
    *,
    manifest,
    index_name: str,
    universe_source: str,
    universe_source_version: str,
    calendar_source: str,
    calendar_source_version: str,
    identity_source_version: str,
    symbol_bridge: SymbolBridge,
    reference_symbol: str = DEFAULT_REFERENCE_SYMBOL,
    from_year: int | None = None,
    to_year: int | None = None,
) -> Inventory:
    """formation × PIT 구성 종목 격자를 manifest 내용으로 훑는다.

    요청된 `identity_source_version`은 실제로 읽은 bundle 해시와 **정확히** 같아야 한다.
    다르면 fail-close다 — 조용히 다른/현재/최신 manifest를 재지 않는다.

    `symbol_bridge`는 `universe_membership`에 저장된 시장 데이터 계열 심볼을 SEC 경제적
    심볼로 옮긴다. **manifest 조회는 옮긴 뒤의 심볼로만 한다.**
    """
    if identity_source_version != manifest.identity_source_version:
        raise QVInventoryError(
            "요청한 identity_source_version이 읽은 manifest bundle과 다릅니다: "
            f"requested={identity_source_version} "
            f"manifest={manifest.identity_source_version}"
        )
    index = index_manifest(manifest)

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

    translated = 0
    for year, session in formations:
        members = pit_membership_rows(
            connection, session,
            index_name=index_name,
            universe_source=universe_source,
            universe_source_version=universe_source_version,
            symbol_bridge=symbol_bridge,
        )
        translated += sum(
            1 for item in members if item.symbol_bridge_kind == REUSED_VENDOR_SERIES
        )
        rows = [
            map_security(
                index,
                item.member_symbol,
                session,
                identity_symbol=item.identity_symbol,
                symbol_bridge_kind=item.symbol_bridge_kind,
            )
            for item in members
        ]
        security_rows.extend(rows)

        # 같은 issuer가 여러 구성 종목으로 나타나는 것은 매핑 오류가 아니다.
        # security 행은 그대로 두고 issuer 단위 묶음을 따로 만든다. 순위는 매기지 않는다.
        grouped: dict[str, list[SecurityRow]] = {}
        for item in rows:
            if item.status != MAPPED or item.issuer_id is None:
                continue
            grouped.setdefault(item.issuer_id, []).append(item)
        groups = [
            IssuerGroup(
                session,
                issuer_id,
                tuple(sorted(entry.member_symbol for entry in entries)),
                tuple(sorted({entry.identity_symbol for entry in entries})),
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
                mapped_count=sum(1 for item in rows if item.status == MAPPED),
                unmapped_count=sum(1 for item in rows if item.status == UNMAPPED),
                ambiguous_count=sum(
                    1 for item in rows if item.status == AMBIGUOUS_MAPPING
                ),
                mapped_issuer_count=len(groups),
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
        identity_source_version=manifest.identity_source_version,
        reused_series_source=symbol_bridge.source,
        reused_series_source_version=symbol_bridge.source_version,
        translated_membership_rows=translated,
        formations=tuple(summaries),
        securities=tuple(
            sorted(
                security_rows,
                key=lambda item: (
                    item.formation_session, item.member_symbol, item.identity_symbol
                ),
            )
        ),
        issuer_groups=tuple(
            sorted(issuer_groups, key=lambda item: (item.formation_session, item.issuer_id))
        ),
    )
