"""Quality + Value의 raw SEC XBRL accession 파서.

이 모듈은 **DB를 모른다.** accession에서 읽은 raw bytes를 받아 fact · context ·
presentation graph · FilingSummary report로만 바꾼다. 회계 계약(무엇이 Revenue인지,
어떤 role이 연결 대차대조표인지)은 `qv_accounting.py`가 정한다.

**모든 QName은 prefix 문자열이 아니라 `QName(namespace_uri, local)`이다.** concept뿐 아니라
dimension axis·member·typed axis·unit measure까지 그 요소 시점의 namespace 선언으로 푼다.
풀 수 없는 prefix는 raw 문자열로 조용히 남기지 않고 `namespace=None`인 **명시적 unresolved**
QName이 된다.
"""

from __future__ import annotations

import hashlib
import io
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation

XBRLI_NS = "http://www.xbrl.org/2003/instance"
LINK_NS = "http://www.xbrl.org/2003/linkbase"
XLINK_NS = "http://www.w3.org/1999/xlink"
XBRLDI_NS = "http://xbrl.org/2006/xbrldi"
ISO4217_NS = "http://www.xbrl.org/2003/iso4217"
XSD_NS = "http://www.w3.org/2001/XMLSchema"
SUMMATION_ITEM_ARCROLE = "http://www.xbrl.org/2003/arcrole/summation-item"

# QName-valued attribute/text를 가진 요소. 이 값들은 **그 요소 자신의** in-scope
# namespace 선언으로 풀어야 한다. 부모 scope로 풀면 child-local 선언을 놓친다.
_QNAME_BEARING_TAGS = frozenset(
    {
        f"{{{XBRLDI_NS}}}explicitMember",
        f"{{{XBRLDI_NS}}}typedMember",
        f"{{{XBRLI_NS}}}measure",
    }
)

# 공식 US-GAAP taxonomy namespace. 연도가 붙으므로 접두로 판정한다.
US_GAAP_NAMESPACE_PREFIXES = (
    "http://fasb.org/us-gaap/",
    "http://xbrl.us/us-gaap/",
)
DEI_NAMESPACE_PREFIXES = (
    "http://xbrl.sec.gov/dei/",
    "http://xbrl.us/dei/",
)


class QVXbrlError(Exception):
    """raw XBRL 원자료가 파싱 계약을 만족하지 못할 때 올린다."""


@dataclass(frozen=True, order=True)
class QName:
    """namespace URI + local name. prefix 문자열은 identity가 아니다."""

    namespace: str | None
    local: str

    @property
    def resolved(self) -> bool:
        return self.namespace is not None

    def __str__(self) -> str:
        return f"{{{self.namespace}}}{self.local}" if self.namespace else f"?:{self.local}"

    def as_json(self) -> list[str | None]:
        return [self.namespace, self.local]


USD_QNAME = QName(ISO4217_NS, "USD")
SHARES_QNAME = QName(XBRLI_NS, "shares")


@dataclass(frozen=True)
class Unit:
    """unit measure를 QName으로 푼 형태. `iso4217:USD` 문자열 비교를 쓰지 않는다."""

    unit_id: str
    numerator: tuple[QName, ...]
    denominator: tuple[QName, ...]

    @property
    def simple_measure(self) -> QName | None:
        if len(self.numerator) == 1 and not self.denominator:
            return self.numerator[0]
        return None

    @property
    def resolved(self) -> bool:
        return all(q.resolved for q in self.numerator + self.denominator)

    def as_json(self) -> dict:
        return {
            "unit_id": self.unit_id,
            "numerator": [q.as_json() for q in self.numerator],
            "denominator": [q.as_json() for q in self.denominator],
        }


def is_usd(unit: Unit | None) -> bool:
    """ISO4217 namespace의 `USD` 단일 measure인가. prefix alias와 무관하다."""
    return unit is not None and unit.simple_measure == USD_QNAME


def is_us_gaap(namespace: str | None) -> bool:
    """공식 US-GAAP taxonomy namespace인가. prefix 문자열로 판정하지 않는다."""
    if namespace is None:
        return False
    return any(str(namespace).startswith(p) for p in US_GAAP_NAMESPACE_PREFIXES)


def is_dei(namespace: str | None) -> bool:
    if namespace is None:
        return False
    return any(str(namespace).startswith(p) for p in DEI_NAMESPACE_PREFIXES)


def normalize_cik(value: object) -> str | None:
    """entity identifier를 10자리 CIK로 정규화한다. 숫자가 아니면 None."""
    clean = str(value if value is not None else "").strip()
    if not clean.isdigit() or len(clean) > 10:
        return None
    return clean.zfill(10)


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def resolve_qname(lexical: str | None, prefixes: dict[str, str]) -> QName | None:
    """`prefix:local` 또는 default-namespace `local`을 QName으로 푼다.

    prefix를 모르면 `namespace=None`인 **명시적 unresolved** QName이다. raw 문자열을
    semantic identity로 쓰지 않는다.
    """
    clean = str(lexical or "").strip()
    if not clean:
        return None
    if ":" in clean:
        prefix, local = clean.split(":", 1)
        if not local:
            return None
        return QName(prefixes.get(prefix), local)
    return QName(prefixes.get(""), clean)


@dataclass(frozen=True)
class Context:
    context_id: str
    entity_scheme: str | None
    entity_identifier: str | None
    instant: str | None
    start: str | None
    end: str | None
    dimensions: tuple[tuple[QName, QName], ...]
    typed_dimensions: tuple[QName, ...]

    @property
    def dimensionless(self) -> bool:
        return not self.dimensions and not self.typed_dimensions

    @property
    def cik(self) -> str | None:
        return normalize_cik(self.entity_identifier)

    def dimensions_json(self) -> list[list[list[str | None]]]:
        return [[axis.as_json(), member.as_json()] for axis, member in self.dimensions]


@dataclass(frozen=True)
class Fact:
    concept: QName
    context_id: str
    unit_id: str | None
    unit: Unit | None
    raw_value: str
    value: Decimal | None
    decimals: str | None
    precision: str | None
    source_file: str

    @property
    def namespace(self) -> str | None:
        return self.concept.namespace

    @property
    def local_name(self) -> str:
        return self.concept.local


@dataclass(frozen=True)
class PresentationArc:
    role: str
    parent: QName | None
    child: QName | None
    order: str | None


@dataclass(frozen=True)
class PresentationRole:
    role: str
    arcs: tuple[PresentationArc, ...]
    source_file: str

    def concepts(self) -> frozenset[QName]:
        out: set[QName] = set()
        for arc in self.arcs:
            if arc.parent is not None:
                out.add(arc.parent)
            if arc.child is not None:
                out.add(arc.child)
        return frozenset(out)

    def ancestors(self, concept: QName) -> frozenset[QName]:
        """presentation 조상 집합. 순환은 방문 집합으로 막는다."""
        parents: dict[QName, set[QName]] = {}
        for arc in self.arcs:
            if arc.parent is None or arc.child is None:
                continue
            parents.setdefault(arc.child, set()).add(arc.parent)
        seen: set[QName] = set()
        stack = list(parents.get(concept, ()))
        while stack:
            node = stack.pop()
            if node in seen:
                continue
            seen.add(node)
            stack.extend(parents.get(node, ()))
        return frozenset(seen)


@dataclass(frozen=True)
class CalculationArc:
    """`calculationArc` 하나.

    `order`·`weight`·`priority`·`use`는 **raw lexical이 아니라 typed semantic 값**으로 둔다.
    XBRL effective-relationship equivalence는 post-schema-validation 값으로 비교해야 하므로
    `order="1"`과 `order="1.0"`은 같은 값이다. float를 쓰지 않는다.

    필수 속성이 없거나 형식이 잘못됐으면 `malformed`에 남기고 **effective 관계로 승격하지
    않는다.** malformed를 기본값으로 조용히 바꾸지 않는다.
    """

    role: str
    arcrole: str | None
    parent: QName | None
    child: QName | None
    order: Decimal | None
    weight: Decimal | None
    use: str | None
    priority: int | None
    malformed: tuple[str, ...]

    @property
    def is_summation_item(self) -> bool:
        return self.arcrole == SUMMATION_ITEM_ARCROLE

    @property
    def resolved(self) -> bool:
        return self.parent is not None and self.child is not None

    @property
    def usable(self) -> bool:
        return not self.malformed

    def equivalence_key(self) -> tuple:
        """XBRL 2.1 §3.5.3.9.7의 equivalent relationship 키.

        `use`와 `priority`는 exempt다. `order`·`weight`는 non-exempt semantic attribute라
        typed 값으로 키에 들어간다.
        """
        return (self.role, self.arcrole, self.parent, self.child, self.order, self.weight)


@dataclass(frozen=True)
class CalculationRole:
    """하나의 exact role URI에 속한 arc 전체.

    **한 accession의 같은 role arc는 문서가 나뉘어 있어도 하나의 base-set network다.**
    prohibition·override·transitive reachability를 문서별로 계산하지 않는다.
    """

    role: str
    arcs: tuple[CalculationArc, ...]
    source_files: tuple[str, ...]

    def unusable_pairs(self) -> frozenset[tuple[QName, QName]]:
        """malformed arc가 하나라도 붙은 (parent, child). 그 관계는 fail-close한다."""
        return frozenset(
            (arc.parent, arc.child)
            for arc in self.arcs
            if arc.is_summation_item and arc.resolved and not arc.usable
        )

    def effective_arcs(self) -> tuple[CalculationArc, ...]:
        """equivalent 관계에서 highest-priority prohibition을 반영한 effective 관계.

        raw arc의 존재 자체를 근거로 세지 않는다. resolved QName · `summation-item` ·
        malformed 없음인 것만 남는다.
        """
        unusable = self.unusable_pairs()
        groups: dict[tuple, list[CalculationArc]] = {}
        for arc in self.arcs:
            if not arc.resolved or not arc.is_summation_item or not arc.usable:
                continue
            if (arc.parent, arc.child) in unusable:
                continue
            groups.setdefault(arc.equivalence_key(), []).append(arc)
        effective: list[CalculationArc] = []
        for group in groups.values():
            top = max(arc.priority or 0 for arc in group)
            winners = [arc for arc in group if (arc.priority or 0) == top]
            if any(arc.use == "prohibited" for arc in winners):
                continue
            effective.append(winners[0])
        return tuple(effective)

    def sources(self) -> frozenset[QName]:
        """effective 관계에서 summation concept(= `from`)인 concept."""
        return frozenset(arc.parent for arc in self.effective_arcs() if arc.parent)

    def descendants(self, concept: QName) -> frozenset[QName]:
        """effective summation-item graph의 transitive 하위 concept. 순환은 방문 집합이 막는다."""
        children: dict[QName, set[QName]] = {}
        for arc in self.effective_arcs():
            children.setdefault(arc.parent, set()).add(arc.child)
        seen: set[QName] = set()
        stack = list(children.get(concept, ()))
        while stack:
            node = stack.pop()
            if node in seen:
                continue
            seen.add(node)
            stack.extend(children.get(node, ()))
        return frozenset(seen)


def merge_calculation_roles(roles: list[CalculationRole]) -> CalculationRole | None:
    """같은 exact role URI의 arc를 **DTS 범위에서 하나의 network로** 합친다.

    문서 순서로 precedence를 만들지 않는다. standalone/embedded 같은 tier도 없다.
    """
    if not roles:
        return None
    uris = {r.role for r in roles}
    if len(uris) != 1:
        raise QVXbrlError(f"서로 다른 role을 합칠 수 없습니다: {sorted(uris)}")
    arcs: list[CalculationArc] = []
    files: list[str] = []
    for role in roles:
        arcs.extend(role.arcs)
        files.extend(role.source_files)
    return CalculationRole(
        role=uris.pop(),
        arcs=tuple(arcs),
        source_files=tuple(dict.fromkeys(files)),
    )


@dataclass(frozen=True)
class CalculationDocument:
    source_file: str
    sha256: str
    roles: tuple[CalculationRole, ...]


@dataclass(frozen=True)
class SummaryReport:
    role: str | None
    long_name: str | None
    short_name: str | None
    report_type: str | None
    menu_category: str | None
    html_file_name: str | None
    xml_file_name: str | None
    instance: str | None

    @property
    def is_statement(self) -> bool:
        """SEC가 선언한 report 종류로만 판정한다. 제목 유사도를 쓰지 않는다.

        최근 filing은 `MenuCategory`가 있고, 초기 XBRL filing에는 없어서
        `LongName`의 `{sort} - {kind} - {title}` 중 kind를 쓴다. 둘 다 없으면 False다.
        """
        if self.menu_category:
            return self.menu_category.strip().lower() == "statements"
        kind = self.long_name_kind
        return kind is not None and kind.lower() == "statement"

    @property
    def long_name_kind(self) -> str | None:
        if not self.long_name:
            return None
        parts = [p.strip() for p in self.long_name.split(" - ")]
        return parts[1] if len(parts) >= 3 else None

    @property
    def report_file_names(self) -> tuple[str, ...]:
        return tuple(n for n in (self.html_file_name, self.xml_file_name) if n)


@dataclass(frozen=True)
class InstanceDocument:
    source_file: str
    sha256: str
    prefixes: tuple[tuple[str, str], ...]
    contexts: tuple[Context, ...]
    facts: tuple[Fact, ...]

    def prefix_map(self) -> dict[str, str]:
        return {prefix: uri for prefix, uri in self.prefixes}

    def context_map(self) -> dict[str, Context]:
        return {c.context_id: c for c in self.contexts}


@dataclass(frozen=True)
class PresentationDocument:
    source_file: str
    sha256: str
    roles: tuple[PresentationRole, ...]


@dataclass(frozen=True)
class FilingSummaryDocument:
    source_file: str
    sha256: str
    reports: tuple[SummaryReport, ...]
    input_files: tuple[str, ...]


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1] if "}" in tag else tag


def _split_tag(tag: str) -> QName:
    if tag.startswith("{") and "}" in tag:
        end = tag.index("}")
        return QName(tag[1:end], tag[end + 1 :])
    return QName(None, tag)


def _walk(data: bytes, source_file: str):
    """(event, element, in-scope prefix map)을 흘린다.

    QName-valued 값은 **그 요소 시점의 namespace 선언**으로 풀어야 하므로 스코프를 쌓는다.
    """
    stack: list[dict[str, str]] = [{}]
    pending: list[tuple[str, str]] = []
    try:
        for event, payload in ET.iterparse(
            io.BytesIO(data), events=("start-ns", "end-ns", "start", "end")
        ):
            if event == "start-ns":
                pending.append(payload)
            elif event == "start":
                scope = dict(stack[-1])
                scope.update(dict(pending))
                pending = []
                stack.append(scope)
                yield "start", payload, scope
            elif event == "end":
                yield "end", payload, stack[-1]
                if len(stack) > 1:
                    stack.pop()
    except ET.ParseError as error:
        raise QVXbrlError(
            f"XML을 파싱할 수 없습니다: {source_file} ({error})"
        ) from error


def _parse_xml(data: bytes, source_file: str) -> tuple[ET.Element, dict[str, str]]:
    """root element와 root에서 in-scope인 prefix map."""
    scope: dict[str, str] = {}
    for event, _element, element_scope in _walk(data, source_file):
        if event == "start":
            scope = element_scope
            break
    try:
        root = ET.fromstring(data)
    except ET.ParseError as error:
        raise QVXbrlError(
            f"XML을 파싱할 수 없습니다: {source_file} ({error})"
        ) from error
    return root, scope


def looks_like_instance(data: bytes, source_file: str) -> bool:
    """파일명이 아니라 XML root로 instance 여부를 판정한다."""
    try:
        for event, element, _ in _walk(data, source_file):
            if event == "start":
                return element.tag == f"{{{XBRLI_NS}}}xbrl"
    except QVXbrlError:
        return False
    return False


def looks_like_presentation(data: bytes, source_file: str) -> bool:
    """linkbase 안에 presentationLink가 실제로 있는지로 판정한다."""
    try:
        root, _ = _parse_xml(data, source_file)
    except QVXbrlError:
        return False
    if root.tag != f"{{{LINK_NS}}}linkbase":
        return False
    return root.find(f"{{{LINK_NS}}}presentationLink") is not None


def _calculation_links(root: ET.Element) -> list[ET.Element]:
    """문서 어디에 있든 `calculationLink`를 찾는다.

    standalone linkbase의 자식일 수도, issuer XSD의 `annotation/appinfo` 안일 수도 있다.
    파일명 접미사로 판정하지 않는다.
    """
    return list(root.iter(f"{{{LINK_NS}}}calculationLink"))


def looks_like_calculation(data: bytes, source_file: str) -> bool:
    """standalone linkbase든 XSD embedded든 `calculationLink`가 실제로 있는지로 판정한다."""
    try:
        root, _ = _parse_xml(data, source_file)
    except QVXbrlError:
        return False
    if root.tag not in (f"{{{LINK_NS}}}linkbase", f"{{{XSD_NS}}}schema"):
        return False
    return bool(_calculation_links(root))


DEFAULT_ARC_ORDER = Decimal("1")
_ARC_USE_VALUES = frozenset({"optional", "prohibited"})


def _arc_semantics(element: ET.Element) -> tuple[Decimal | None, Decimal | None, str | None, int | None, tuple[str, ...]]:
    """`calculationArc` 속성을 typed semantic 값으로 정규화한다.

    `order` 누락은 schema default `1`이다. `weight`는 required non-zero decimal이고,
    `priority` 누락은 `0`, `use` 누락은 `optional`이다. **형식이 잘못된 값을 기본값으로
    조용히 바꾸지 않고** malformed로 남긴다.
    """
    malformed: list[str] = []

    raw_order = element.get("order")
    if raw_order is None or not raw_order.strip():
        order = DEFAULT_ARC_ORDER
    else:
        try:
            order = Decimal(raw_order.strip())
        except InvalidOperation:
            order = None
            malformed.append("order")

    raw_weight = element.get("weight")
    if raw_weight is None or not raw_weight.strip():
        weight = None
        malformed.append("weight")
    else:
        try:
            weight = Decimal(raw_weight.strip())
        except InvalidOperation:
            weight = None
            malformed.append("weight")
        else:
            if weight == 0:
                weight = None
                malformed.append("weight")

    raw_use = element.get("use")
    if raw_use is None or not raw_use.strip():
        use = "optional"
    elif raw_use.strip() in _ARC_USE_VALUES:
        use = raw_use.strip()
    else:
        use = None
        malformed.append("use")

    raw_priority = element.get("priority")
    if raw_priority is None or not raw_priority.strip():
        priority = 0
    else:
        try:
            priority = int(raw_priority.strip())
        except ValueError:
            priority = None
            malformed.append("priority")

    return order, weight, use, priority, tuple(malformed)


def parse_calculation(
    data: bytes, source_file: str, prefix_map: dict[str, str]
) -> CalculationDocument:
    """`calculationLink`에서 role별 arc를 뽑는다. standalone과 XSD embedded를 함께 다룬다."""
    root, _ = _parse_xml(data, source_file)
    links = _calculation_links(root)
    if not links:
        raise QVXbrlError(f"calculationLink가 없습니다: {source_file}")

    by_role: dict[str, list[CalculationArc]] = {}
    for link in links:
        role = (link.get(f"{{{XLINK_NS}}}role") or "").strip()
        locators: dict[str, QName | None] = {}
        for loc in link.findall(f"{{{LINK_NS}}}loc"):
            label = (loc.get(f"{{{XLINK_NS}}}label") or "").strip()
            href = loc.get(f"{{{XLINK_NS}}}href") or ""
            if label:
                locators[label] = resolve_locator(href, prefix_map)
        for arc in link.findall(f"{{{LINK_NS}}}calculationArc"):
            order, weight, use, priority, malformed = _arc_semantics(arc)
            by_role.setdefault(role, []).append(
                CalculationArc(
                    role=role,
                    arcrole=(arc.get(f"{{{XLINK_NS}}}arcrole") or "").strip() or None,
                    parent=locators.get((arc.get(f"{{{XLINK_NS}}}from") or "").strip()),
                    child=locators.get((arc.get(f"{{{XLINK_NS}}}to") or "").strip()),
                    order=order,
                    weight=weight,
                    use=use,
                    priority=priority,
                    malformed=malformed,
                )
            )
    roles = tuple(
        CalculationRole(role=role, arcs=tuple(arcs), source_files=(source_file,))
        for role, arcs in sorted(by_role.items())
    )
    return CalculationDocument(
        source_file=source_file, sha256=sha256(data), roles=roles
    )


def _decimal_or_none(raw: str) -> Decimal | None:
    clean = raw.strip()
    if not clean:
        return None
    try:
        return Decimal(clean)
    except (InvalidOperation, ValueError):
        return None


def _scope_for(
    element: ET.Element, scopes: dict[int, dict[str, str]], fallback: dict[str, str]
) -> dict[str, str]:
    """그 요소 자신의 in-scope namespace map. 없으면 부모 scope로 떨어진다."""
    return scopes.get(id(element), fallback)


def _context_from(
    element: ET.Element,
    scope: dict[str, str],
    scopes: dict[int, dict[str, str]],
) -> Context:
    context_id = (element.get("id") or "").strip()
    entity = element.find(f"{{{XBRLI_NS}}}entity")
    scheme = identifier = None
    dims: list[tuple[QName, QName]] = []
    typed: list[QName] = []
    holders: list[ET.Element] = []
    if entity is not None:
        ident = entity.find(f"{{{XBRLI_NS}}}identifier")
        if ident is not None:
            scheme = ident.get("scheme")
            identifier = (ident.text or "").strip()
        segment = entity.find(f"{{{XBRLI_NS}}}segment")
        if segment is not None:
            holders.append(segment)
    scenario = element.find(f"{{{XBRLI_NS}}}scenario")
    if scenario is not None:
        holders.append(scenario)
    for holder in holders:
        for member in holder.findall(f"{{{XBRLDI_NS}}}explicitMember"):
            member_scope = _scope_for(member, scopes, scope)
            axis = resolve_qname(member.get("dimension"), member_scope)
            value = resolve_qname(member.text, member_scope)
            if axis is not None and value is not None:
                dims.append((axis, value))
        for member in holder.findall(f"{{{XBRLDI_NS}}}typedMember"):
            axis = resolve_qname(member.get("dimension"), _scope_for(member, scopes, scope))
            if axis is not None:
                typed.append(axis)

    period = element.find(f"{{{XBRLI_NS}}}period")
    instant = start = end = None
    if period is not None:
        node = period.find(f"{{{XBRLI_NS}}}instant")
        if node is not None and node.text:
            instant = node.text.strip()
        node = period.find(f"{{{XBRLI_NS}}}startDate")
        if node is not None and node.text:
            start = node.text.strip()
        node = period.find(f"{{{XBRLI_NS}}}endDate")
        if node is not None and node.text:
            end = node.text.strip()
    return Context(
        context_id=context_id,
        entity_scheme=scheme,
        entity_identifier=identifier,
        instant=instant,
        start=start,
        end=end,
        dimensions=tuple(sorted(dims)),
        typed_dimensions=tuple(sorted(typed)),
    )


def _measures(
    holder: ET.Element | None,
    scope: dict[str, str],
    scopes: dict[int, dict[str, str]],
) -> tuple[QName, ...]:
    if holder is None:
        return ()
    out = []
    for node in holder.findall(f"{{{XBRLI_NS}}}measure"):
        qname = resolve_qname(node.text, _scope_for(node, scopes, scope))
        if qname is not None:
            out.append(qname)
    return tuple(out)


def _unit_from(
    element: ET.Element,
    scope: dict[str, str],
    scopes: dict[int, dict[str, str]],
) -> Unit | None:
    unit_id = (element.get("id") or "").strip()
    if not unit_id:
        return None
    divide = element.find(f"{{{XBRLI_NS}}}divide")
    if divide is not None:
        return Unit(
            unit_id=unit_id,
            numerator=_measures(
                divide.find(f"{{{XBRLI_NS}}}unitNumerator"), scope, scopes
            ),
            denominator=_measures(
                divide.find(f"{{{XBRLI_NS}}}unitDenominator"), scope, scopes
            ),
        )
    return Unit(
        unit_id=unit_id, numerator=_measures(element, scope, scopes), denominator=()
    )


def _fact_from(element: ET.Element, tag: QName, source_file: str) -> Fact | None:
    context_ref = (element.get("contextRef") or "").strip()
    if not context_ref:
        return None
    if element.get(f"{{{XBRLI_NS}}}nil") == "true" or element.get("nil") == "true":
        return None
    unit_ref = (element.get("unitRef") or "").strip() or None
    raw = (element.text or "").strip()
    return Fact(
        concept=tag,
        context_id=context_ref,
        unit_id=unit_ref,
        unit=None,
        raw_value=raw,
        value=_decimal_or_none(raw) if unit_ref else None,
        decimals=(element.get("decimals") or "").strip() or None,
        precision=(element.get("precision") or "").strip() or None,
        source_file=source_file,
    )


def parse_instance(data: bytes, source_file: str) -> InstanceDocument:
    """XBRL instance에서 context와 fact를 뽑는다. QName은 전부 URI+local로 푼다."""
    contexts: list[Context] = []
    units: dict[str, Unit] = {}
    staged: list[Fact] = []
    root_prefixes: dict[str, str] = {}
    root_seen = False
    depth = 0
    # QName-valued 요소의 in-scope 선언. 부모의 end 시점에는 이미 pop됐으므로 미리 모은다.
    qname_scopes: dict[int, dict[str, str]] = {}

    for event, element, scope in _walk(data, source_file):
        if event == "start":
            depth += 1
            if not root_seen:
                if element.tag != f"{{{XBRLI_NS}}}xbrl":
                    raise QVXbrlError(f"XBRL instance root가 아닙니다: {source_file}")
                root_seen = True
                root_prefixes = dict(scope)
            continue

        depth -= 1
        if element.tag in _QNAME_BEARING_TAGS:
            qname_scopes[id(element)] = scope
        if depth != 1:
            continue

        tag = _split_tag(element.tag)
        if tag == QName(XBRLI_NS, "context"):
            contexts.append(_context_from(element, scope, qname_scopes))
        elif tag == QName(XBRLI_NS, "unit"):
            unit = _unit_from(element, scope, qname_scopes)
            if unit is not None:
                units[unit.unit_id] = unit
        elif tag.namespace is not None and tag.namespace not in (XBRLI_NS, LINK_NS):
            fact = _fact_from(element, tag, source_file)
            if fact is not None:
                staged.append(fact)
        qname_scopes.clear()
        element.clear()

    if not root_seen:
        raise QVXbrlError(f"XML root가 없습니다: {source_file}")

    facts = tuple(
        Fact(
            concept=f.concept,
            context_id=f.context_id,
            unit_id=f.unit_id,
            unit=units.get(f.unit_id) if f.unit_id else None,
            raw_value=f.raw_value,
            value=f.value,
            decimals=f.decimals,
            precision=f.precision,
            source_file=f.source_file,
        )
        for f in staged
    )
    return InstanceDocument(
        source_file=source_file,
        sha256=sha256(data),
        prefixes=tuple(sorted(root_prefixes.items())),
        contexts=tuple(contexts),
        facts=facts,
    )


def resolve_locator(href: str, prefix_map: dict[str, str]) -> QName | None:
    """presentation locator href의 fragment를 QName으로 푼다.

    fragment는 `{prefix}_{LocalName}` 형태이고, prefix는 instance가 선언한 것과 같다.
    알 수 없는 prefix면 None이다 — 추정하지 않는다.
    """
    if "#" not in str(href):
        return None
    fragment = str(href).rsplit("#", 1)[-1].strip()
    if "_" not in fragment:
        return None
    prefix, local = fragment.split("_", 1)
    namespace = prefix_map.get(prefix)
    if not namespace or not local:
        return None
    return QName(namespace, local)


def parse_presentation(
    data: bytes, source_file: str, prefix_map: dict[str, str]
) -> PresentationDocument:
    """presentation linkbase에서 role별 parent/child arc를 뽑는다."""
    root, _ = _parse_xml(data, source_file)
    if root.tag != f"{{{LINK_NS}}}linkbase":
        raise QVXbrlError(f"linkbase root가 아닙니다: {source_file}")

    roles: list[PresentationRole] = []
    for link in root.findall(f"{{{LINK_NS}}}presentationLink"):
        role = (link.get(f"{{{XLINK_NS}}}role") or "").strip()
        locators: dict[str, QName | None] = {}
        for loc in link.findall(f"{{{LINK_NS}}}loc"):
            label = (loc.get(f"{{{XLINK_NS}}}label") or "").strip()
            href = loc.get(f"{{{XLINK_NS}}}href") or ""
            if label:
                locators[label] = resolve_locator(href, prefix_map)
        arcs = tuple(
            PresentationArc(
                role=role,
                parent=locators.get((arc.get(f"{{{XLINK_NS}}}from") or "").strip()),
                child=locators.get((arc.get(f"{{{XLINK_NS}}}to") or "").strip()),
                order=(arc.get("order") or "").strip() or None,
            )
            for arc in link.findall(f"{{{LINK_NS}}}presentationArc")
        )
        roles.append(PresentationRole(role=role, arcs=arcs, source_file=source_file))
    return PresentationDocument(
        source_file=source_file, sha256=sha256(data), roles=tuple(roles)
    )


def parse_filing_summary(data: bytes, source_file: str) -> FilingSummaryDocument:
    """FilingSummary에서 report 목록과 InputFiles를 뽑는다."""
    root, _ = _parse_xml(data, source_file)
    if _local(root.tag) != "FilingSummary":
        raise QVXbrlError(f"FilingSummary root가 아닙니다: {source_file}")

    def child_text(node: ET.Element, name: str) -> str | None:
        found = node.find(name)
        if found is None or found.text is None:
            return None
        return found.text.strip() or None

    reports = tuple(
        SummaryReport(
            role=child_text(node, "Role"),
            long_name=child_text(node, "LongName"),
            short_name=child_text(node, "ShortName"),
            report_type=child_text(node, "ReportType"),
            menu_category=child_text(node, "MenuCategory"),
            html_file_name=child_text(node, "HtmlFileName"),
            xml_file_name=child_text(node, "XmlFileName"),
            instance=(node.get("instance") or "").strip() or None,
        )
        for node in root.iter("Report")
    )
    input_files = tuple(
        (node.text or "").strip()
        for node in root.iter("File")
        if (node.text or "").strip()
    )
    return FilingSummaryDocument(
        source_file=source_file,
        sha256=sha256(data),
        reports=reports,
        input_files=input_files,
    )


def candidate_xml_names(
    index_payload: dict, summary: FilingSummaryDocument | None
) -> tuple[str, ...]:
    """accession index에서 instance/linkbase 후보 XML 파일명을 고른다.

    FilingSummary가 report 파일이라고 **선언한** 이름만 제외한다. 파일명 규칙으로 의미를
    추정하지 않고, 남은 후보의 실제 XML root/content로 판정한다. `.xsd`도 후보에 넣는다 —
    issuer schema 안에 `calculationLink`가 embedded될 수 있다.

    `InputFiles`로 좁히지 않는다. 그것은 발행사가 **제출한** 파일 목록이라, inline XBRL
    filing에서 SEC renderer가 만든 추출 instance(`*_htm.xml`)가 빠진다.
    """
    directory = index_payload.get("directory") if isinstance(index_payload, dict) else None
    items = directory.get("item") if isinstance(directory, dict) else None
    if not isinstance(items, list):
        raise QVXbrlError("accession index에 directory.item이 없습니다.")
    names = [
        str(item.get("name") or "").strip()
        for item in items
        if isinstance(item, dict)
    ]
    # `.xsd`도 후보다 — issuer schema에 calculationLink가 embedded될 수 있다.
    xml_names = [n for n in names if n.lower().endswith((".xml", ".xsd"))]
    if summary is not None:
        declared_reports = {
            name for report in summary.reports for name in report.report_file_names
        }
        xml_names = [n for n in xml_names if n not in declared_reports]
        xml_names = [n for n in xml_names if n != summary.source_file]
    return tuple(sorted(xml_names))
