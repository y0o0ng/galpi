"""Quality + Value의 raw SEC XBRL accession 파서.

이 모듈은 **DB를 모른다.** accession에서 읽은 raw bytes를 받아 fact · context ·
presentation graph · FilingSummary report로만 바꾼다. 회계 계약(무엇이 Revenue인지,
어떤 role이 연결 대차대조표인지)은 `qv_accounting.py`가 정한다.

QName은 prefix 문자열이 아니라 **namespace URI + local name**으로 다룬다. issuer custom
prefix 이름에 의존하지 않는다.
"""

from __future__ import annotations

import hashlib
import io
import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation

XBRLI_NS = "http://www.xbrl.org/2003/instance"
LINK_NS = "http://www.xbrl.org/2003/linkbase"
XLINK_NS = "http://www.w3.org/1999/xlink"
XBRLDI_NS = "http://xbrl.org/2006/xbrldi"

# 공식 US-GAAP taxonomy namespace. 연도가 붙으므로 접두로 판정한다.
US_GAAP_NAMESPACE_PREFIXES = (
    "http://fasb.org/us-gaap/",
    "http://xbrl.us/us-gaap/",
)
DEI_NAMESPACE_PREFIXES = (
    "http://xbrl.sec.gov/dei/",
    "http://xbrl.us/dei/",
)

_INSTANT_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}$")


class QVXbrlError(Exception):
    """raw XBRL 원자료가 파싱 계약을 만족하지 못할 때 올린다."""


def is_us_gaap(namespace: str) -> bool:
    """공식 US-GAAP taxonomy namespace인가. prefix 문자열로 판정하지 않는다."""
    return any(str(namespace).startswith(p) for p in US_GAAP_NAMESPACE_PREFIXES)


def is_dei(namespace: str) -> bool:
    return any(str(namespace).startswith(p) for p in DEI_NAMESPACE_PREFIXES)


def normalize_cik(value: object) -> str | None:
    """entity identifier를 10자리 CIK로 정규화한다. 숫자가 아니면 None."""
    clean = str(value if value is not None else "").strip()
    if not clean.isdigit() or len(clean) > 10:
        return None
    return clean.zfill(10)


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


@dataclass(frozen=True)
class Context:
    context_id: str
    entity_scheme: str | None
    entity_identifier: str | None
    instant: str | None
    start: str | None
    end: str | None
    dimensions: tuple[tuple[str, str], ...]
    typed_dimensions: tuple[str, ...]

    @property
    def dimensionless(self) -> bool:
        return not self.dimensions and not self.typed_dimensions

    @property
    def cik(self) -> str | None:
        return normalize_cik(self.entity_identifier)


@dataclass(frozen=True)
class Fact:
    namespace: str
    local_name: str
    context_id: str
    unit_id: str | None
    unit: str | None
    raw_value: str
    value: Decimal | None
    decimals: str | None
    precision: str | None
    source_file: str

    @property
    def qname(self) -> str:
        return f"{{{self.namespace}}}{self.local_name}"


@dataclass(frozen=True)
class PresentationArc:
    role: str
    parent_namespace: str | None
    parent_local: str | None
    child_namespace: str | None
    child_local: str | None
    order: str | None


@dataclass(frozen=True)
class PresentationRole:
    role: str
    arcs: tuple[PresentationArc, ...]
    source_file: str

    def concepts(self) -> frozenset[tuple[str, str]]:
        out: set[tuple[str, str]] = set()
        for arc in self.arcs:
            if arc.parent_namespace and arc.parent_local:
                out.add((arc.parent_namespace, arc.parent_local))
            if arc.child_namespace and arc.child_local:
                out.add((arc.child_namespace, arc.child_local))
        return frozenset(out)

    def ancestors(self, namespace: str, local: str) -> frozenset[tuple[str, str]]:
        """(namespace, local)의 presentation 조상 집합. 순환은 방문 집합으로 막는다."""
        parents: dict[tuple[str, str], set[tuple[str, str]]] = {}
        for arc in self.arcs:
            if not (arc.parent_namespace and arc.child_namespace):
                continue
            child = (arc.child_namespace, arc.child_local)
            parents.setdefault(child, set()).add(
                (arc.parent_namespace, arc.parent_local)
            )
        seen: set[tuple[str, str]] = set()
        stack = list(parents.get((namespace, local), ()))
        while stack:
            node = stack.pop()
            if node in seen:
                continue
            seen.add(node)
            stack.extend(parents.get(node, ()))
        return frozenset(seen)


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


def _split_qname(tag: str) -> tuple[str | None, str]:
    if tag.startswith("{") and "}" in tag:
        end = tag.index("}")
        return tag[1:end], tag[end + 1 :]
    return None, tag


def _parse_xml(data: bytes, source_file: str) -> tuple[ET.Element, list[tuple[str, str]]]:
    """root element와 문서에 선언된 prefix->namespace 목록을 함께 돌려준다."""
    prefixes: list[tuple[str, str]] = []
    root: ET.Element | None = None
    try:
        for event, payload in ET.iterparse(io.BytesIO(data), events=("start-ns", "start")):
            if event == "start-ns":
                prefixes.append((payload[0], payload[1]))
            elif root is None:
                root = payload
        if root is not None:
            # iterparse는 start 이벤트에서 자식을 채우지 않으므로 전체를 다시 읽는다.
            root = ET.fromstring(data)
    except ET.ParseError as error:
        raise QVXbrlError(f"XML을 파싱할 수 없습니다: {source_file} ({error})") from error
    if root is None:
        raise QVXbrlError(f"XML root가 없습니다: {source_file}")
    return root, prefixes


def looks_like_instance(data: bytes, source_file: str) -> bool:
    """파일명이 아니라 XML root로 instance 여부를 판정한다."""
    try:
        root, _ = _parse_xml(data, source_file)
    except QVXbrlError:
        return False
    return root.tag == f"{{{XBRLI_NS}}}xbrl"


def looks_like_presentation(data: bytes, source_file: str) -> bool:
    """linkbase 안에 presentationLink가 실제로 있는지로 판정한다."""
    try:
        root, _ = _parse_xml(data, source_file)
    except QVXbrlError:
        return False
    if root.tag != f"{{{LINK_NS}}}linkbase":
        return False
    return root.find(f"{{{LINK_NS}}}presentationLink") is not None


def _decimal_or_none(raw: str) -> Decimal | None:
    clean = raw.strip()
    if not clean:
        return None
    try:
        return Decimal(clean)
    except (InvalidOperation, ValueError):
        return None


def parse_instance(data: bytes, source_file: str) -> InstanceDocument:
    """XBRL instance에서 context와 fact를 뽑는다."""
    root, prefixes = _parse_xml(data, source_file)
    if root.tag != f"{{{XBRLI_NS}}}xbrl":
        raise QVXbrlError(f"XBRL instance root가 아닙니다: {source_file}")

    contexts: list[Context] = []
    for node in root.findall(f"{{{XBRLI_NS}}}context"):
        context_id = (node.get("id") or "").strip()
        if not context_id:
            continue
        entity = node.find(f"{{{XBRLI_NS}}}entity")
        scheme = identifier = None
        dims: list[tuple[str, str]] = []
        typed: list[str] = []
        if entity is not None:
            ident = entity.find(f"{{{XBRLI_NS}}}identifier")
            if ident is not None:
                scheme = ident.get("scheme")
                identifier = (ident.text or "").strip()
            segment = entity.find(f"{{{XBRLI_NS}}}segment")
            for holder in (segment,):
                if holder is None:
                    continue
                for member in holder.findall(f"{{{XBRLDI_NS}}}explicitMember"):
                    axis = (member.get("dimension") or "").strip()
                    dims.append((axis, (member.text or "").strip()))
                for member in holder.findall(f"{{{XBRLDI_NS}}}typedMember"):
                    typed.append((member.get("dimension") or "").strip())
        scenario = node.find(f"{{{XBRLI_NS}}}scenario")
        if scenario is not None:
            for member in scenario.findall(f"{{{XBRLDI_NS}}}explicitMember"):
                axis = (member.get("dimension") or "").strip()
                dims.append((axis, (member.text or "").strip()))
            for member in scenario.findall(f"{{{XBRLDI_NS}}}typedMember"):
                typed.append((member.get("dimension") or "").strip())

        period = node.find(f"{{{XBRLI_NS}}}period")
        instant = start = end = None
        if period is not None:
            instant_node = period.find(f"{{{XBRLI_NS}}}instant")
            start_node = period.find(f"{{{XBRLI_NS}}}startDate")
            end_node = period.find(f"{{{XBRLI_NS}}}endDate")
            if instant_node is not None and instant_node.text:
                instant = instant_node.text.strip()
            if start_node is not None and start_node.text:
                start = start_node.text.strip()
            if end_node is not None and end_node.text:
                end = end_node.text.strip()
        contexts.append(
            Context(
                context_id=context_id,
                entity_scheme=scheme,
                entity_identifier=identifier,
                instant=instant,
                start=start,
                end=end,
                dimensions=tuple(sorted(dims)),
                typed_dimensions=tuple(sorted(typed)),
            )
        )

    units: dict[str, str] = {}
    for node in root.findall(f"{{{XBRLI_NS}}}unit"):
        unit_id = (node.get("id") or "").strip()
        if not unit_id:
            continue
        measures = [
            (m.text or "").strip()
            for m in node.iter(f"{{{XBRLI_NS}}}measure")
            if (m.text or "").strip()
        ]
        divide = node.find(f"{{{XBRLI_NS}}}divide")
        if divide is not None and len(measures) >= 2:
            units[unit_id] = f"{measures[0]}/{measures[1]}"
        elif measures:
            units[unit_id] = measures[0]

    facts: list[Fact] = []
    for node in root:
        namespace, local = _split_qname(node.tag)
        if namespace in (XBRLI_NS, LINK_NS) or namespace is None:
            continue
        context_ref = (node.get("contextRef") or "").strip()
        if not context_ref:
            continue
        if node.get(f"{{{XBRLI_NS}}}nil") == "true" or node.get("nil") == "true":
            continue
        raw = (node.text or "").strip()
        unit_ref = (node.get("unitRef") or "").strip() or None
        facts.append(
            Fact(
                namespace=namespace,
                local_name=local,
                context_id=context_ref,
                unit_id=unit_ref,
                unit=units.get(unit_ref) if unit_ref else None,
                raw_value=raw,
                value=_decimal_or_none(raw) if unit_ref else None,
                decimals=(node.get("decimals") or "").strip() or None,
                precision=(node.get("precision") or "").strip() or None,
                source_file=source_file,
            )
        )

    return InstanceDocument(
        source_file=source_file,
        sha256=sha256(data),
        prefixes=tuple(sorted(set(prefixes))),
        contexts=tuple(contexts),
        facts=tuple(facts),
    )


def resolve_locator(href: str, prefix_map: dict[str, str]) -> tuple[str | None, str | None]:
    """presentation locator href의 fragment를 (namespace, local)로 푼다.

    fragment는 `{prefix}_{LocalName}` 형태이고, prefix는 instance가 선언한 것과 같다.
    알 수 없는 prefix면 (None, None)이다 — 추정하지 않는다.
    """
    if "#" not in str(href):
        return None, None
    fragment = str(href).rsplit("#", 1)[-1].strip()
    if "_" not in fragment:
        return None, None
    prefix, local = fragment.split("_", 1)
    namespace = prefix_map.get(prefix)
    if not namespace or not local:
        return None, None
    return namespace, local


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
        locators: dict[str, tuple[str | None, str | None]] = {}
        for loc in link.findall(f"{{{LINK_NS}}}loc"):
            label = (loc.get(f"{{{XLINK_NS}}}label") or "").strip()
            href = loc.get(f"{{{XLINK_NS}}}href") or ""
            if label:
                locators[label] = resolve_locator(href, prefix_map)
        arcs: list[PresentationArc] = []
        for arc in link.findall(f"{{{LINK_NS}}}presentationArc"):
            source = (arc.get(f"{{{XLINK_NS}}}from") or "").strip()
            target = (arc.get(f"{{{XLINK_NS}}}to") or "").strip()
            parent = locators.get(source, (None, None))
            child = locators.get(target, (None, None))
            arcs.append(
                PresentationArc(
                    role=role,
                    parent_namespace=parent[0],
                    parent_local=parent[1],
                    child_namespace=child[0],
                    child_local=child[1],
                    order=(arc.get("order") or "").strip() or None,
                )
            )
        roles.append(
            PresentationRole(role=role, arcs=tuple(arcs), source_file=source_file)
        )
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

    reports: list[SummaryReport] = []
    for node in root.iter("Report"):
        reports.append(
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
        )
    input_files = tuple(
        (node.text or "").strip()
        for node in root.iter("File")
        if (node.text or "").strip()
    )
    return FilingSummaryDocument(
        source_file=source_file,
        sha256=sha256(data),
        reports=tuple(reports),
        input_files=input_files,
    )


def candidate_xml_names(index_payload: dict, summary: FilingSummaryDocument | None) -> tuple[str, ...]:
    """accession index에서 instance/linkbase 후보 XML 파일명을 고른다.

    FilingSummary가 report 파일이라고 **선언한** 이름만 제외한다. 파일명 규칙으로 의미를
    추정하지 않고, 남은 후보의 실제 XML root/content로 판정한다.

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
    xml_names = [n for n in names if n.lower().endswith(".xml")]
    if summary is not None:
        declared_reports = {
            name for report in summary.reports for name in report.report_file_names
        }
        xml_names = [n for n in xml_names if n not in declared_reports]
        xml_names = [n for n in xml_names if n != summary.source_file]
    return tuple(sorted(xml_names))
