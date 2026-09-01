"""accession 단위 XBRL class binding — **filing-local 파생 관측**.

```text
economic class / prose identity   production identity (오래 살고 버전 관리된다)
XBRL QName binding                파생 filing-local 관측 (accession 안에서만 참이다)
```

옛 모델은 은퇴했다.

```text
(issuer, QName, effective_from/effective_to) -> economic class      RETIRED
```

**QName은 economic identity가 아니다.** accession A에서 본 QName은 accession B에
대해 아무것도 말하지 않는다. 같은 exact QName이 두 accession에서 다르게 묶일 수 있고,
그것은 오류가 아니라 정상이다.

```text
최초/최종 관측 수명 없음 · filing 사이 외삽 없음 · 연속성 가정 없음
```

binding의 권한은 **raw SEC K/Q accession + 고정된 economic identity bundle** 둘뿐이고,
그 둘에서 재생산 가능한 파생 데이터다. 손으로 유지하는 새 매핑 파일이 아니다.

## 자동 binding은 좁다

등록인이 **그 filing 안에서 명시로** 관계를 세웠을 때만 자동으로 묶는다. 구체적으로는
표지의 `Security12bTitle` / `Security12gTitle`이 그 member에 실려 있고, 그 제목의 N1
prose 키가 고정된 bundle에서 **정확히 하나의** economic class로 풀릴 때다.

**governing instrument만으로는 QName을 묶지 못한다.** charter가 "Class B가 존재한다"를
증명해도 "accession X의 `CommonClassBMember`가 그 Class B다"는 증명하지 않는다.
빠진 member→class 다리를 다음으로 만들어내지 않는다.

```text
XBRL member 철자 · class 글자 · COVER_GROUP_LABEL · sibling 순서 · 주식수 ·
ticker 유사도 · governing instrument의 class 이름 유사도
```

명시 filing-local 다리가 없으면 **`UNRESOLVED`이고 그것으로 괜찮다.**

`TradingSymbol`은 **교차 확인**이지 정체성이 아니다. ticker만으로 묶지 않는다.

## 해석 grain — 어느 축도 뺄 수 없다

```text
정확한 SEC accession
+ 정확한 instance 문서
+ 정확한 QName
+ 고정된 identity bundle
+ 개별 fact instant
```

한 accession 안에도 instance 문서가 여럿일 수 있고, **문서마다 같은 QName이 다르게
묶일 수 있다.** 문서 이름을 빼고 조회하면 다른 문서의 binding이 새거나 멀쩡한
문서-지역 매핑이 `AMBIGUOUS`가 된다. 문서를 순서로 고르지 않고, 문서 이름 없는
조회를 지원하지 않는다.

**fact instant마다 다시 확인한다.** binding 행을 찾은 뒤에도 그 행이 저장한 canonical
prose 키가 **그 instant에** 같은 class로 풀리고 그 class가 활성이며 같은 issuer의
보통주여야 한다. 하나라도 어긋나면 다른 class로 바꾸지 않고 `UNRESOLVED`다.

## provenance는 caller가 쓰지 않는다

```text
instance_document_name   = document.source_file
instance_sha256          = document.sha256
filing usable session    = qv_sec_filings의 그 accession 행
```

binding의 권한이 raw accession + 고정 bundle이므로 그 값들을 호출자가 지어낼 수
없다. canonical K/Q filing 원장에 그 accession이 없으면 **fail-close**다 — binding은
그 기록과 독립해서 존재할 수 없다.
"""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass

from .qv_manifest import (
    APPROVED_CLASS_AXIS_LOCALS,
    DERIVED_MEMBER_LOCALS,
    QVManifestError,
    is_standard_family,
    normalize_cik,
    prose_key,
    qname_key,
)
from .qv_xbrl import InstanceDocument

# 자동 경로는 하나뿐이다. 어휘를 늘리는 것이 곧 다리를 만들어내는 일이 된다.
COVER_SECURITY_TITLE_FACT = "COVER_SECURITY_TITLE_FACT"

BINDING_SOURCE = "qv-xbrl-class-binding"

SECURITY_12B_TITLE = "Security12bTitle"
SECURITY_12G_TITLE = "Security12gTitle"
TRADING_SYMBOL = "TradingSymbol"
TITLE_LOCALS = frozenset({SECURITY_12B_TITLE, SECURITY_12G_TITLE})

RESOLVED = "RESOLVED"
UNRESOLVED = "UNRESOLVED"
AMBIGUOUS = "AMBIGUOUS"


class QVBindingError(Exception):
    """binding 계약을 벗어날 때 올린다. **전부 fail-close다.**"""


class QVBindingAmbiguity(QVBindingError):
    """한 시점에 둘 이상으로 풀려 하나를 고를 수 없을 때.

    "없다"와 "둘이다"를 문자열로 구분하지 않으려고 형으로 가른다.
    """


@dataclass(frozen=True)
class ClassBinding:
    """accession 하나 안에서 확인된 `QName -> economic class` 관계."""

    cik: str
    accession: str
    instance_document_name: str
    axis_key: str
    member_key: str
    issuer_id: str
    class_id: str
    raw_axis_namespace: str | None
    raw_axis_local: str
    raw_member_namespace: str | None
    raw_member_local: str
    canonical_prose_comparison_key: str
    binding_method: str
    # **불변 source 정체성.** 전부 실제 입력에서 파생하고 호출자가 따로 넣지 않는다.
    instance_sha256: str
    filing_source_version: str
    identity_source_version: str
    filing_historical_usable_session: str
    identity_usable_from_session: str
    usable_from_session: str
    provenance: str


@dataclass(frozen=True)
class MemberFacts:
    """표지에서 한 class 축 member에 실린 fact들. 관측이지 판정이 아니다."""

    axis_namespace: str | None
    axis_local: str
    member_namespace: str | None
    member_local: str
    titles: tuple[str, ...]
    symbols: tuple[str, ...]
    instants: tuple[str, ...]
    anomalies: tuple[str, ...]


# ── 표지에서 member fact 모으기 ───────────────────────────────────────────────


def member_facts(
    document: InstanceDocument, *, cik: str
) -> tuple[dict[tuple[str, str], MemberFacts], tuple[str, ...]]:
    """`(axis_key, member_key) -> MemberFacts`와 문서 수준 anomaly.

    등록인이 아닌 entity의 context(자회사 co-registrant)는 제외하고, class 축 말고
    다른 축이 붙은 fact는 **버리지 않고 anomaly로 적는다.** 두 번째 표지 parser를
    만들지 않고 `qv_xbrl`의 파싱 결과를 그대로 읽는다.
    """
    from .qv_xbrl import is_dei

    target = normalize_cik(cik)
    contexts = document.context_map()
    collected: dict[tuple[str, str], dict] = {}
    anomalies: set[str] = set()

    for fact in document.facts:
        if not is_dei(fact.concept.namespace):
            continue
        local = fact.concept.local
        if local not in TITLE_LOCALS and local != TRADING_SYMBOL:
            continue
        context = contexts.get(fact.context_id)
        if context is None:
            anomalies.add("MISSING_CONTEXT")
            continue
        if context.cik is not None and context.cik != target:
            continue
        if context.typed_dimensions:
            anomalies.add("TYPED_DIMENSION_ON_COVER_FACT")
            continue
        if len(context.dimensions) != 1:
            # 차원 없는 표지 fact는 member binding의 대상이 아니다(D0 참조).
            continue
        axis, member = context.dimensions[0]
        if not axis.resolved or not member.resolved:
            anomalies.add("UNPARSEABLE_CLASS_DIMENSION")
            continue
        if axis.local not in APPROVED_CLASS_AXIS_LOCALS:
            continue
        try:
            axis_key = qname_key(axis.namespace, axis.local, target)
            member_key = qname_key(member.namespace, member.local, target)
        except QVManifestError:
            anomalies.add("UNPARSEABLE_QNAME")
            continue
        if not is_standard_family(axis_key):
            anomalies.add("NON_STANDARD_CLASS_AXIS")
            continue
        if member.local in DERIVED_MEMBER_LOCALS:
            anomalies.add("DERIVED_MEMBER_ON_COVER")
            continue

        slot = collected.setdefault(
            (axis_key, member_key),
            {
                "axis_namespace": axis.namespace,
                "axis_local": axis.local,
                "member_namespace": member.namespace,
                "member_local": member.local,
                "titles": [],
                "symbols": [],
                "instants": [],
            },
        )
        value = " ".join(str(fact.raw_value or "").split())
        if not value:
            continue
        if local in TITLE_LOCALS:
            slot["titles"].append(value)
        else:
            slot["symbols"].append(value)
        if context.instant:
            slot["instants"].append(context.instant)

    out = {
        key: MemberFacts(
            axis_namespace=slot["axis_namespace"],
            axis_local=slot["axis_local"],
            member_namespace=slot["member_namespace"],
            member_local=slot["member_local"],
            titles=tuple(sorted(set(slot["titles"]))),
            symbols=tuple(sorted(set(slot["symbols"]))),
            instants=tuple(sorted(set(slot["instants"]))),
            anomalies=(),
        )
        for key, slot in sorted(collected.items())
    }
    return out, tuple(sorted(anomalies))


# ── 고정 bundle에서 canonical prose 해석 ──────────────────────────────────────


def _canonical_class(
    connection: sqlite3.Connection,
    *,
    issuer_id: str,
    comparison_key: str,
    identity_source_version: str,
    instant: str,
) -> tuple[str, str]:
    """`(class_id, prose usable_from_session)`.

    **canonical bridge만** 본다(`SECURITY_TITLE_FACT` · `GOVERNING_INSTRUMENT`).
    `COVER_GROUP_LABEL`은 corroborating이라 여기 걸리지 않는다. 그 시점에 정확히 하나로
    풀리지 않으면 fail-close다.
    """
    rows = connection.execute(
        "SELECT class_id, usable_from_session FROM qv_share_class_prose_aliases"
        " WHERE issuer_id = ? AND comparison_key = ? AND source_version = ?"
        "   AND bridge_type IN ('SECURITY_TITLE_FACT', 'GOVERNING_INSTRUMENT')"
        "   AND effective_from <= ? AND (effective_to IS NULL OR effective_to > ?)",
        (issuer_id, comparison_key, identity_source_version, instant, instant),
    ).fetchall()
    if not rows:
        raise QVBindingError(
            f"canonical prose bridge가 없습니다: {issuer_id} {comparison_key!r} @ {instant}"
        )
    class_ids = {row["class_id"] for row in rows}
    if len(class_ids) != 1:
        raise QVBindingAmbiguity(
            f"prose 키가 한 시점에 {len(class_ids)}개 class로 갑니다: {comparison_key!r}"
        )
    return next(iter(class_ids)), max(row["usable_from_session"] for row in rows)


def filing_usable_session(
    connection: sqlite3.Connection,
    *,
    cik: str,
    accession: str,
    filing_source_version: str,
) -> str:
    """canonical K/Q filing 원장에서 그 accession의 `historical_usable_session`.

    **호출자가 준 값을 받지 않는다.** binding은 그 filing 기록과 독립해서 존재할 수
    없으므로 행이 없거나 둘이면 fail-close다.
    """
    rows = connection.execute(
        "SELECT historical_usable_session FROM qv_sec_filings"
        " WHERE cik = ? AND accession = ? AND source_version = ?",
        (normalize_cik(cik), accession, filing_source_version),
    ).fetchall()
    if len(rows) != 1:
        raise QVBindingError(
            f"canonical K/Q filing 기록이 정확히 하나가 아닙니다: {cik}/{accession}"
            f"/{filing_source_version} ({len(rows)}건)"
        )
    session = rows[0]["historical_usable_session"]
    if not session:
        raise QVBindingError(
            f"filing의 historical_usable_session이 비었습니다: {accession}"
        )
    return str(session)


def _active_class(
    connection: sqlite3.Connection,
    *,
    class_id: str,
    issuer_id: str,
    identity_source_version: str,
    instant: str,
) -> sqlite3.Row:
    rows = connection.execute(
        "SELECT * FROM qv_share_classes"
        " WHERE class_id = ? AND source_version = ?"
        "   AND effective_from <= ? AND (effective_to IS NULL OR effective_to > ?)",
        (class_id, identity_source_version, instant, instant),
    ).fetchall()
    if len(rows) != 1:
        raise QVBindingError(
            f"economic class가 그 시점에 정확히 하나로 활성이 아닙니다: "
            f"{class_id} @ {instant} ({len(rows)}건)"
        )
    row = rows[0]
    if row["issuer_id"] != issuer_id:
        raise QVBindingError(
            f"풀린 class가 다른 issuer의 것입니다: {class_id} -> {row['issuer_id']}"
        )
    if not row["is_ordinary_common"]:
        raise QVBindingError(f"보통주로 등록된 class가 아닙니다: {class_id}")
    return row


def bind_member(
    connection: sqlite3.Connection,
    facts: MemberFacts,
    *,
    axis_key: str,
    member_key: str,
    cik: str,
    accession: str,
    instance_document_name: str,
    instance_sha256: str,
    issuer_id: str,
    filing_source_version: str,
    identity_source_version: str,
    instant: str,
    filing_historical_usable_session: str,
) -> ClassBinding:
    """member 하나를 accession 안에서 economic class에 묶는다. 조건은 좁다.

    표지가 그 member에 제목을 싣지 않았으면 **자동으로 묶지 않는다** — governing
    instrument가 같은 이름의 class를 정의해도 마찬가지다.
    """
    if len(facts.titles) != 1:
        raise QVBindingError(
            f"{member_key}: 표지 제목 fact가 정확히 하나가 아닙니다({len(facts.titles)}건)"
            " — 명시 filing-local 다리가 없으면 묶지 않습니다"
        )
    comparison_key = prose_key(facts.titles[0])
    class_id, prose_usable = _canonical_class(
        connection,
        issuer_id=issuer_id,
        comparison_key=comparison_key,
        identity_source_version=identity_source_version,
        instant=instant,
    )
    row = _active_class(
        connection,
        class_id=class_id,
        issuer_id=issuer_id,
        identity_source_version=identity_source_version,
        instant=instant,
    )

    # TradingSymbol은 **교차 확인**이다. 정체성을 만들지 못하지만 어긋나면 멈춘다.
    if len(facts.symbols) > 1:
        raise QVBindingError(f"{member_key}: 표지 심볼이 서로 다릅니다 {facts.symbols}")
    if facts.symbols:
        observed = facts.symbols[0]
        production = row["symbol"]
        if production is None or prose_key(production) != prose_key(observed):
            raise QVBindingError(
                f"{member_key}: 표지 심볼 {observed!r}가 production class 심볼 "
                f"{production!r}과 맞지 않습니다"
            )

    identity_usable = max(str(row["usable_from_session"]), str(prose_usable))
    usable = max(str(filing_historical_usable_session), identity_usable)
    return ClassBinding(
        cik=normalize_cik(cik),
        accession=accession,
        instance_document_name=instance_document_name,
        axis_key=axis_key,
        member_key=member_key,
        issuer_id=issuer_id,
        class_id=class_id,
        raw_axis_namespace=facts.axis_namespace,
        raw_axis_local=facts.axis_local,
        raw_member_namespace=facts.member_namespace,
        raw_member_local=facts.member_local,
        canonical_prose_comparison_key=comparison_key,
        binding_method=COVER_SECURITY_TITLE_FACT,
        instance_sha256=instance_sha256,
        filing_source_version=filing_source_version,
        identity_source_version=identity_source_version,
        filing_historical_usable_session=str(filing_historical_usable_session),
        identity_usable_from_session=identity_usable,
        usable_from_session=usable,
        provenance=(
            f"cover {SECURITY_12B_TITLE}/{SECURITY_12G_TITLE} -> canonical prose "
            f"{comparison_key!r} @ {instant} ({accession}/{instance_document_name})"
        ),
    )


def derive_bindings(
    connection: sqlite3.Connection,
    document: InstanceDocument,
    *,
    cik: str,
    accession: str,
    issuer_id: str,
    filing_source_version: str,
    identity_source_version: str,
    default_instant: str,
) -> tuple[tuple[ClassBinding, ...], tuple[tuple[str, str], ...]]:
    """한 accession/문서의 자동 binding 전부와 **묶지 못한 이유**를 함께 돌려준다.

    묶지 못하는 것은 실패가 아니다 — 명시 filing-local 다리가 없으면 `UNRESOLVED`다.

    **문서 이름·해시·filing usable session을 호출자에게서 받지 않는다.** 앞의 둘은
    실제 `InstanceDocument`가, 마지막은 canonical K/Q filing 원장이 권한이다.
    """
    instance_document_name = document.source_file
    instance_sha256 = document.sha256
    filing_historical_usable_session = filing_usable_session(
        connection, cik=cik, accession=accession,
        filing_source_version=filing_source_version,
    )
    facts, anomalies = member_facts(document, cik=cik)
    if anomalies:
        raise QVBindingError(
            f"{accession}: 표지 anomaly가 있어 binding을 세우지 않습니다 {anomalies}"
        )
    bound: list[ClassBinding] = []
    unresolved: list[tuple[str, str]] = []
    seen: dict[str, str] = {}
    for (axis_key, member_key), item in facts.items():
        instant = item.instants[0] if item.instants else default_instant
        try:
            binding = bind_member(
                connection, item,
                axis_key=axis_key, member_key=member_key, cik=cik,
                accession=accession, instance_document_name=instance_document_name,
                instance_sha256=instance_sha256, issuer_id=issuer_id,
                filing_source_version=filing_source_version,
                identity_source_version=identity_source_version,
                instant=instant,
                filing_historical_usable_session=filing_historical_usable_session,
            )
        except QVBindingError as error:
            unresolved.append((member_key, str(error)))
            continue
        # **같은 accession 안에서** 한 QName이 두 class로 가면 fail-close다.
        previous = seen.get(member_key)
        if previous is not None and previous != binding.class_id:
            raise QVBindingError(
                f"{accession}: {member_key}가 이 accession 안에서 두 class로 갑니다: "
                f"{previous} vs {binding.class_id}"
            )
        seen[member_key] = binding.class_id
        bound.append(binding)
    return tuple(bound), tuple(unresolved)


# ── 저장과 조회 ───────────────────────────────────────────────────────────────


# semantic 내용 — 정확히 같은 자연키에서 이 값들이 다르면 fail-close다.
_BINDING_CONTENT = (
    "issuer_id", "class_id", "canonical_prose_comparison_key", "binding_method",
    "instance_sha256", "raw_axis_namespace", "raw_axis_local",
    "raw_member_namespace", "raw_member_local",
    "filing_historical_usable_session", "identity_usable_from_session",
    "usable_from_session",
)


def store_bindings(
    connection: sqlite3.Connection,
    bindings: tuple[ClassBinding, ...] | list[ClassBinding],
) -> int:
    """binding을 저장한다. **정확히 같은 자연키를 조용히 덮어쓰지 않는다.**

    같은 자연키에 같은 내용이면 멱등 재사용이고, 내용이 다르면 fail-close다.
    `instance_document_name`이 다르면 **다른 자연키**이므로 같은 QName이 다르게
    묶여도 정상이다.

    provenance 값은 전부 `ClassBinding`이 들고 온다 — 호출자가 따로 넣지 않는다.
    """
    rows: list[tuple] = []
    for item in bindings:
        key = (
            item.cik, item.accession, item.instance_document_name,
            item.axis_key, item.member_key,
            item.filing_source_version, item.identity_source_version,
        )
        existing = connection.execute(
            "SELECT * FROM qv_xbrl_class_bindings"
            " WHERE cik = ? AND accession = ? AND instance_document_name = ?"
            "   AND axis_key = ? AND member_key = ?"
            "   AND filing_source_version = ? AND identity_source_version = ?",
            key,
        ).fetchone()
        if existing is not None:
            differing = [
                name for name in _BINDING_CONTENT
                if existing[name] != getattr(item, name)
            ]
            if differing:
                raise QVBindingError(
                    "같은 binding 자연키에 다른 내용이 이미 있습니다 — 덮어쓰지 "
                    f"않습니다: {key} / 다른 칸 {differing}"
                )
            continue  # 정확히 같다 — 멱등 재사용
        rows.append((
            item.cik, item.accession, item.instance_document_name,
            item.axis_key, item.member_key, item.filing_source_version,
            item.identity_source_version, item.issuer_id, item.class_id,
            item.raw_axis_namespace, item.raw_axis_local,
            item.raw_member_namespace, item.raw_member_local,
            item.canonical_prose_comparison_key, item.binding_method,
            item.instance_sha256, item.filing_historical_usable_session,
            item.identity_usable_from_session, item.usable_from_session,
            BINDING_SOURCE, item.provenance,
        ))
    if rows:
        with connection:
            connection.executemany(
                "INSERT INTO qv_xbrl_class_bindings"
                " (cik, accession, instance_document_name, axis_key, member_key,"
                "  filing_source_version, identity_source_version, issuer_id, class_id,"
                "  raw_axis_namespace, raw_axis_local, raw_member_namespace,"
                "  raw_member_local, canonical_prose_comparison_key, binding_method,"
                "  instance_sha256, filing_historical_usable_session,"
                "  identity_usable_from_session, usable_from_session, source, provenance)"
                " VALUES (" + ", ".join("?" * 21) + ")",
                rows,
            )
    return len(rows)


def resolve_accession_member(
    connection: sqlite3.Connection,
    *,
    cik: str,
    accession: str,
    instance_document_name: str,
    axis_key: str,
    member_key: str,
    filing_source_version: str,
    identity_source_version: str,
    fact_instant: str,
    usable_by: str | None = None,
) -> tuple[str | None, str]:
    """`(class_id, 상태)`. **어느 축도 뺄 수 없다.**

    ```text
    정확한 accession + 정확한 instance 문서 + 정확한 QName
    + 고정된 identity bundle + 개별 fact instant
    ```

    자연키 전체로 조회한다 — 문서 이름을 빼고 찾거나 순서로 문서를 고르는 폴백이
    없다. 다른 accession·다른 문서의 binding으로 새지 않는다.

    행을 찾은 뒤에도 **그 fact instant에** 다시 확인한다. 저장된 canonical prose 키가
    그 시점에 같은 `class_id`로 풀리고, 그 class가 활성이며 같은 issuer의 보통주여야
    한다. 하나라도 어긋나면 **다른 class로 바꾸지 않는다** — 더 오래되거나 더 새로운
    prose 구간을 대신 쓰지도 않는다.

    `usable_by`를 주면 그때 아직 쓸 수 없는 binding은 보이지 않는다.
    """
    statement = (
        "SELECT issuer_id, class_id, canonical_prose_comparison_key"
        " FROM qv_xbrl_class_bindings"
        " WHERE cik = ? AND accession = ? AND instance_document_name = ?"
        "   AND axis_key = ? AND member_key = ?"
        "   AND filing_source_version = ? AND identity_source_version = ?"
    )
    params: list[object] = [
        normalize_cik(cik), accession, instance_document_name, axis_key, member_key,
        filing_source_version, identity_source_version,
    ]
    if usable_by is not None:
        statement += " AND usable_from_session <= ?"
        params.append(usable_by)
    rows = connection.execute(statement, params).fetchall()
    if not rows:
        return None, UNRESOLVED
    if len({row["class_id"] for row in rows}) != 1:
        return None, AMBIGUOUS
    row = rows[0]

    # ── fact instant에서 economic/prose identity를 다시 확인한다 ─────────────
    try:
        resolved, _usable = _canonical_class(
            connection,
            issuer_id=row["issuer_id"],
            comparison_key=row["canonical_prose_comparison_key"],
            identity_source_version=identity_source_version,
            instant=fact_instant,
        )
    except QVBindingAmbiguity:
        return None, AMBIGUOUS
    except QVBindingError:
        return None, UNRESOLVED
    if resolved != row["class_id"]:
        # 그 시점에는 같은 철자가 **다른 class**의 것이다. 바꿔치지 않는다.
        return None, UNRESOLVED
    try:
        _active_class(
            connection,
            class_id=row["class_id"],
            issuer_id=row["issuer_id"],
            identity_source_version=identity_source_version,
            instant=fact_instant,
        )
    except QVBindingAmbiguity:
        return None, AMBIGUOUS
    except QVBindingError:
        return None, UNRESOLVED
    return row["class_id"], RESOLVED
