"""작은 XBRL fixture를 문자열로 만든다. 실제 filing을 통째로 복사하지 않는다."""

from __future__ import annotations

US_GAAP_NS = "http://fasb.org/us-gaap/2023"
DEI_NS = "http://xbrl.sec.gov/dei/2023"
CUSTOM_NS = "http://example.com/20231231"
SCHEMA = "acme-20231231.xsd"

CIK_SCHEME = "http://www.sec.gov/CIK"


def context(
    context_id: str,
    *,
    cik: str,
    instant: str | None = None,
    start: str | None = None,
    end: str | None = None,
    dimensions: tuple[tuple[str, str], ...] = (),
    typed: tuple[str, ...] = (),
) -> str:
    if instant is not None:
        period = f"<xbrli:instant>{instant}</xbrli:instant>"
    else:
        period = (
            f"<xbrli:startDate>{start}</xbrli:startDate>"
            f"<xbrli:endDate>{end}</xbrli:endDate>"
        )
    segment = ""
    if dimensions or typed:
        parts = [
            f'<xbrldi:explicitMember dimension="{axis}">{member}</xbrldi:explicitMember>'
            for axis, member in dimensions
        ]
        parts += [
            f'<xbrldi:typedMember dimension="{axis}"><t>x</t></xbrldi:typedMember>'
            for axis in typed
        ]
        segment = f"<xbrli:segment>{''.join(parts)}</xbrli:segment>"
    return (
        f'<xbrli:context id="{context_id}">'
        f"<xbrli:entity>"
        f'<xbrli:identifier scheme="{CIK_SCHEME}">{cik}</xbrli:identifier>'
        f"{segment}</xbrli:entity>"
        f"<xbrli:period>{period}</xbrli:period>"
        f"</xbrli:context>"
    )


def fact(
    prefix: str,
    local: str,
    context_id: str,
    value: str,
    *,
    unit: str | None = "usd",
    decimals: str | None = "-6",
) -> str:
    attrs = [f'contextRef="{context_id}"']
    if unit:
        attrs.append(f'unitRef="{unit}"')
    if decimals is not None:
        attrs.append(f'decimals="{decimals}"')
    return f"<{prefix}:{local} {' '.join(attrs)}>{value}</{prefix}:{local}>"


def instance(contexts: list[str], facts: list[str], *, extra_units: str = "") -> bytes:
    body = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<xbrli:xbrl xmlns:xbrli="http://www.xbrl.org/2003/instance"'
        ' xmlns:xbrldi="http://xbrl.org/2006/xbrldi"'
        ' xmlns:link="http://www.xbrl.org/2003/linkbase"'
        f' xmlns:us-gaap="{US_GAAP_NS}"'
        f' xmlns:dei="{DEI_NS}"'
        f' xmlns:acme="{CUSTOM_NS}">'
        '<xbrli:unit id="usd">'
        "<xbrli:measure>iso4217:USD</xbrli:measure></xbrli:unit>"
        '<xbrli:unit id="shares">'
        "<xbrli:measure>xbrli:shares</xbrli:measure></xbrli:unit>"
        f"{extra_units}"
        + "".join(contexts)
        + "".join(facts)
        + "</xbrli:xbrl>"
    )
    return body.encode("utf-8")


def presentation(roles: dict[str, list[tuple[str, str]]]) -> bytes:
    """role -> [(parent_fragment, child_fragment), ...]"""
    links = []
    for role, arcs in roles.items():
        labels = {}
        locs = []
        for parent, child in arcs:
            for fragment in (parent, child):
                if fragment in labels:
                    continue
                label = f"loc_{len(labels)}"
                labels[fragment] = label
                locs.append(
                    f'<link:loc xlink:type="locator"'
                    f' xlink:href="{SCHEMA}#{fragment}" xlink:label="{label}"/>'
                )
        arc_xml = [
            f'<link:presentationArc xlink:type="arc"'
            f' xlink:arcrole="http://www.xbrl.org/2003/arcrole/parent-child"'
            f' xlink:from="{labels[parent]}" xlink:to="{labels[child]}"'
            f' order="{index + 1}"/>'
            for index, (parent, child) in enumerate(arcs)
        ]
        links.append(
            f'<link:presentationLink xlink:type="extended" xlink:role="{role}">'
            + "".join(locs)
            + "".join(arc_xml)
            + "</link:presentationLink>"
        )
    body = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<link:linkbase xmlns:link="http://www.xbrl.org/2003/linkbase"'
        ' xmlns:xlink="http://www.w3.org/1999/xlink">'
        + "".join(links)
        + "</link:linkbase>"
    )
    return body.encode("utf-8")


def filing_summary(reports: list[dict], *, input_files: list[str] | None = None) -> bytes:
    entries = []
    for report in reports:
        fields = []
        for tag in (
            "LongName",
            "ReportType",
            "Role",
            "ShortName",
            "MenuCategory",
            "HtmlFileName",
            "XmlFileName",
        ):
            value = report.get(tag)
            if value is not None:
                fields.append(f"<{tag}>{value}</{tag}>")
        entries.append("<Report>" + "".join(fields) + "</Report>")
    files = ""
    if input_files:
        files = "<InputFiles>" + "".join(f"<File>{n}</File>" for n in input_files) + "</InputFiles>"
    body = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        "<FilingSummary>"
        f"{files}"
        "<MyReports>" + "".join(entries) + "</MyReports>"
        "</FilingSummary>"
    )
    return body.encode("utf-8")
