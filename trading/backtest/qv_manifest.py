"""QV identity manifest — production mapping의 운영 정본.

증거력의 정본은 원본 SEC 자료다. 이 모듈은 그 증거를 가리키는 **명시 manifest**를
읽어 결정론적으로 해시하고, 검증하고, DB에 materialize한다.

세 파일은 **하나의 bundle**이다. 편의를 위해 네 번째 identity 파일을 만들지 않는다.

    trading/qv/identity/issuers.jsonl
    trading/qv/identity/share_classes.jsonl
    trading/qv/identity/prose_aliases.jsonl

**XBRL QName은 economic identity가 아니다.** 옛
`(issuer, QName, effective_from/effective_to) -> class` 관계는 은퇴했다. QName이 어느
class를 뜻하는지는 **그 관계를 등록인이 명시로 세운 SEC accession 안에서만** 참이고,
그것은 파생 관측 관계(`qv_xbrl_class_bindings`)이지 identity manifest 행이 아니다.

`identity_source_version`은 Git commit이 아니라 **manifest 내용**에서 나온다.
무관한 commit이 값을 바꾸면 안 되고, 의미 있는 내용이 바뀌면 반드시 바뀌어야 한다.
bundle **스키마 자체**가 바뀐 것도 값에 들어가야 하므로 해시 입력 맨 앞에 bundle
판별자를 넣는다 — 그래서 옛 네 파일 bundle의 version과는 절대 같아질 수 없다.
"""

from __future__ import annotations

import hashlib
import json
import sqlite3
import unicodedata
from dataclasses import dataclass
from pathlib import Path

DEFAULT_MANIFEST_DIR = Path(__file__).resolve().parents[1] / "qv" / "identity"

# 고정 파일 순서. 이 순서가 해시의 일부다.
MANIFEST_FILES = (
    "issuers.jsonl",
    "share_classes.jsonl",
    "prose_aliases.jsonl",
)

# **bundle 스키마 판별자.** 해시 입력 맨 앞에 들어가므로 파일 구성이 바뀌면 내용이
# 같아도 version이 달라진다. 옛 네 파일 receipt는 설계상 stale이 된다.
BUNDLE_SCHEMA = "qv-identity-bundle-v2"

IDENTITY_SOURCE = "qv-identity-manifest"
IDENTITY_VERSION_PREFIX = "qv-identity-sha256:"

# 표준 taxonomy family. prefix 문자열이 아니라 namespace URI로 판정한다.
STANDARD_FAMILIES = (
    ("us-gaap", ("http://fasb.org/us-gaap/", "http://xbrl.us/us-gaap/")),
    ("dei", ("http://xbrl.sec.gov/dei/", "http://xbrl.us/dei/")),
    ("srt", ("http://fasb.org/srt/",)),
    ("ifrs-full", ("http://xbrl.ifrs.org/taxonomy/",)),
)

# D0가 허용하는 표준 주식 class 축. 이름만 맞으면 되는 것이 아니라 표준 family여야 한다.
APPROVED_CLASS_AXIS_LOCALS = frozenset(
    {"StatementClassOfStockAxis", "ClassesOfShareCapitalAxis"}
)

# 파생·등가 member는 실제 economic class가 아니다.
DERIVED_MEMBER_LOCALS = frozenset(
    {
        "EquivalentClassAMember",
        "EquivalentClassBMember",
        "ConversionEquivalentMember",
    }
)

PROSE_BRIDGE_TYPES = ("SECURITY_TITLE_FACT", "GOVERNING_INSTRUMENT", "COVER_GROUP_LABEL")
# 단독으로 canonical bridge가 될 수 있는 종류.
CANONICAL_PROSE_BRIDGES = frozenset({"SECURITY_TITLE_FACT", "GOVERNING_INSTRUMENT"})

EVIDENCE_SOURCE_KINDS = frozenset({"KQ_FILING", "SEC_EVIDENCE_DOCUMENT"})
EVIDENCE_DEPENDENCIES = frozenset({"REQUIRED", "CORROBORATING"})

RELATION_KINDS = {
    "issuers.jsonl": "ISSUER",
    "share_classes.jsonl": "SHARE_CLASS",
    "prose_aliases.jsonl": "PROSE_ALIAS",
}

# 옛 스키마의 어휘. **새 행을 쓰지 않는다** — 기존 DB의 CHECK 제약을 파괴적으로
# 다시 쓰지 않으려고 legacy 값으로만 남긴다.
RETIRED_RELATION_KINDS = frozenset({"XBRL_ALIAS"})


class QVManifestError(Exception):
    """manifest가 계약을 벗어날 때 올린다."""


# ── 정규화 ────────────────────────────────────────────────────────────────────


def qname_key(namespace: str | None, local: str, target_cik: str | None = None) -> str:
    """alias 비교 키. 표준은 family+local, 발행사 확장은 ext:<CIK>+local이다.

    local 이름만으로 추론하지 않는다. namespace를 모르면 오류다.
    """
    clean_local = str(local or "").strip()
    if not clean_local:
        raise QVManifestError("QName local이 비었습니다")
    if namespace is None or not str(namespace).strip():
        raise QVManifestError(
            f"namespace 없는 QName은 alias 키가 될 수 없습니다: {clean_local}"
        )
    ns = str(namespace).strip()
    for family, prefixes in STANDARD_FAMILIES:
        if any(ns.startswith(p) for p in prefixes):
            return f"{family}:{clean_local}"
    if target_cik is None:
        raise QVManifestError(
            f"발행사 확장 namespace에는 target CIK가 필요합니다: {ns}"
        )
    return f"ext:{normalize_cik(target_cik)}:{clean_local}"


def is_standard_family(key: str) -> bool:
    return not key.startswith("ext:")


def prose_key(raw: str) -> str:
    """N1 정규화만 한다. 구두점·하이픈·서수·단어는 보존한다."""
    text = unicodedata.normalize("NFKC", str(raw or ""))
    text = " ".join(text.split())
    if not text:
        raise QVManifestError("prose alias가 비었습니다")
    return text.casefold()


def normalize_cik(value: object) -> str:
    clean = str(value if value is not None else "").strip()
    if not clean.isdigit() or len(clean) > 10:
        raise QVManifestError(f"CIK가 아닙니다: {value!r}")
    return clean.zfill(10)


# ── 정규 직렬화 / 해시 ────────────────────────────────────────────────────────


def _canonical_json(value: object) -> str:
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"))


def _semantic_key(filename: str, row: dict) -> tuple:
    if filename == "issuers.jsonl":
        return (row.get("issuer_id"),)
    if filename == "share_classes.jsonl":
        return (row.get("class_id"), row.get("effective_from"))
    if filename == "prose_aliases.jsonl":
        return (
            row.get("class_id"),
            row.get("comparison_key"),
            row.get("bridge_type"),
            row.get("effective_from"),
        )
    raise QVManifestError(f"모르는 manifest 파일입니다: {filename}")


@dataclass(frozen=True)
class Manifest:
    directory: Path
    rows: dict          # filename -> tuple[dict, ...]  (semantic key 정렬됨)
    identity_source_version: str


def _read_jsonl(path: Path) -> list[dict]:
    if not path.exists():
        raise QVManifestError(f"manifest 파일이 없습니다: {path}")
    out = []
    for lineno, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        stripped = line.strip()
        if not stripped or stripped.startswith("//"):
            continue
        try:
            obj = json.loads(stripped)
        except json.JSONDecodeError as error:
            raise QVManifestError(f"{path.name}:{lineno} JSON이 아닙니다: {error}") from error
        if not isinstance(obj, dict):
            raise QVManifestError(f"{path.name}:{lineno} 객체가 아닙니다")
        out.append(obj)
    return out


def load_manifest(directory: Path | str = DEFAULT_MANIFEST_DIR) -> Manifest:
    """네 파일을 읽고 정규화·중복검사한 뒤 bundle 해시를 계산한다."""
    base = Path(directory)
    rows: dict[str, tuple[dict, ...]] = {}
    digest = hashlib.sha256()
    # bundle 스키마를 먼저 먹인다. 파일 구성이 달라지면 내용이 같아도 값이 달라진다.
    digest.update(BUNDLE_SCHEMA.encode("utf-8"))
    digest.update(b"\x02")
    for filename in MANIFEST_FILES:
        raw_rows = _read_jsonl(base / filename)
        normalized = [_normalize_row(filename, row) for row in raw_rows]
        seen: dict[tuple, int] = {}
        for index, row in enumerate(normalized):
            key = _semantic_key(filename, row)
            if key in seen:
                raise QVManifestError(
                    f"{filename}에 의미가 같은 행이 둘입니다: {key!r}"
                )
            seen[key] = index
        ordered = tuple(
            sorted(normalized, key=lambda r: _canonical_json(_semantic_key(filename, r)))
        )
        rows[filename] = ordered
        digest.update(filename.encode("utf-8"))
        digest.update(b"\x00")
        for row in ordered:
            digest.update(_canonical_json(row).encode("utf-8"))
            digest.update(b"\x00")
        digest.update(b"\x01")
    return Manifest(
        directory=base,
        rows=rows,
        identity_source_version=IDENTITY_VERSION_PREFIX + digest.hexdigest(),
    )


def _require(row: dict, field: str, filename: str) -> object:
    if field not in row or row[field] in (None, ""):
        raise QVManifestError(f"{filename}: 필수 항목 {field}가 없습니다")
    return row[field]


def _normalize_evidence(row: dict, filename: str) -> list[dict]:
    items = row.get("evidence")
    if not isinstance(items, list) or not items:
        raise QVManifestError(f"{filename}: evidence가 최소 하나 필요합니다")
    out = []
    for item in items:
        if not isinstance(item, dict):
            raise QVManifestError(f"{filename}: evidence 항목이 객체가 아닙니다")
        kind = str(item.get("source_kind", "")).strip()
        if kind not in EVIDENCE_SOURCE_KINDS:
            raise QVManifestError(f"{filename}: 모르는 source_kind입니다: {kind!r}")
        dependency = str(item.get("dependency", "")).strip()
        if dependency not in EVIDENCE_DEPENDENCIES:
            raise QVManifestError(f"{filename}: 모르는 dependency입니다: {dependency!r}")
        entry = {
            "source_kind": kind,
            "cik": normalize_cik(item.get("cik")),
            "accession": str(item.get("accession", "")).strip(),
            "document_name": str(item.get("document_name", "")).strip(),
            "evidence_role": str(item.get("evidence_role", "")).strip(),
            "dependency": dependency,
        }
        if not entry["accession"] or not entry["document_name"] or not entry["evidence_role"]:
            raise QVManifestError(f"{filename}: evidence 필수 항목이 비었습니다")
        locator = item.get("locator")
        entry["locator"] = str(locator).strip() if locator not in (None, "") else None
        out.append(entry)
    if not any(item["dependency"] == "REQUIRED" for item in out):
        raise QVManifestError(f"{filename}: REQUIRED 증거가 최소 하나 필요합니다")
    return out


def _normalize_row(filename: str, row: dict) -> dict:
    if "usable_from_session" in row:
        raise QVManifestError(
            f"{filename}: usable_from_session은 증거에서 파생한다. 손으로 넣지 않는다."
        )
    if filename == "issuers.jsonl":
        return {
            "issuer_id": str(_require(row, "issuer_id", filename)).strip(),
            "cik": normalize_cik(_require(row, "cik", filename)),
            "resolution_method": str(_require(row, "resolution_method", filename)).strip(),
            "provenance": str(_require(row, "provenance", filename)).strip(),
            "evidence": _normalize_evidence(row, filename),
        }

    common = {
        "class_id": str(_require(row, "class_id", filename)).strip(),
        "issuer_id": str(_require(row, "issuer_id", filename)).strip(),
        "effective_from": str(_require(row, "effective_from", filename)).strip(),
        "effective_to": (
            str(row["effective_to"]).strip()
            if row.get("effective_to") not in (None, "")
            else None
        ),
        "provenance": str(_require(row, "provenance", filename)).strip(),
        "evidence": _normalize_evidence(row, filename),
    }

    if filename == "share_classes.jsonl":
        symbol = row.get("symbol")
        is_listed = bool(_require(row, "is_listed", filename) in (1, True, "1", "true"))
        if is_listed and not symbol:
            raise QVManifestError(f"{filename}: 상장 class에는 symbol이 필요합니다")
        return {
            **common,
            "symbol": str(symbol).strip() if symbol not in (None, "") else None,
            "is_ordinary_common": bool(
                row.get("is_ordinary_common") in (1, True, "1", "true")
            ),
            "is_listed": is_listed,
        }

    if filename == "prose_aliases.jsonl":
        bridge = str(_require(row, "bridge_type", filename)).strip()
        if bridge not in PROSE_BRIDGE_TYPES:
            raise QVManifestError(f"{filename}: 모르는 bridge_type입니다: {bridge!r}")
        raw_name = str(_require(row, "raw_prose_name", filename)).strip()
        return {
            **common,
            "raw_prose_name": raw_name,
            "comparison_key": prose_key(raw_name),
            "bridge_type": bridge,
        }

    raise QVManifestError(f"모르는 manifest 파일입니다: {filename}")


# ── 증거 해석 ─────────────────────────────────────────────────────────────────


def _evidence_usable_session(
    connection: sqlite3.Connection,
    item: dict,
    filings_source_version: str,
) -> str | None:
    if item["source_kind"] == "KQ_FILING":
        row = connection.execute(
            "SELECT historical_usable_session FROM qv_sec_filings"
            " WHERE cik = ? AND accession = ? AND source_version = ?",
            (item["cik"], item["accession"], filings_source_version),
        ).fetchone()
    else:
        row = connection.execute(
            "SELECT historical_usable_session FROM qv_sec_evidence_documents"
            " WHERE cik = ? AND accession = ? AND document_name = ?"
            " AND source_version = ?",
            (
                item["cik"],
                item["accession"],
                item["document_name"],
                filings_source_version,
            ),
        ).fetchone()
    if row is None:
        return None
    return row["historical_usable_session"]


def resolve_usable_from_session(
    connection: sqlite3.Connection,
    evidence: list[dict],
    filings_source_version: str,
) -> tuple[str, list[dict]]:
    """REQUIRED 증거의 usable session 최대값을 구한다.

    CORROBORATING은 사용 가능 시점을 늦추지 않는다. REQUIRED 하나라도 못 풀면 오류다.
    """
    resolved: list[dict] = []
    required_sessions: list[str] = []
    for item in evidence:
        session = _evidence_usable_session(connection, item, filings_source_version)
        resolved.append({**item, "resolved_usable_session": session})
        if item["dependency"] != "REQUIRED":
            continue
        if session is None:
            raise QVManifestError(
                "REQUIRED 증거를 원장에서 찾지 못해 materialize할 수 없습니다: "
                f"{item['source_kind']} {item['accession']} {item['document_name']}"
            )
        required_sessions.append(session)
    if not required_sessions:
        raise QVManifestError("REQUIRED 증거가 없습니다")
    return max(required_sessions), resolved


# ── materialize ───────────────────────────────────────────────────────────────


def _overlaps(a_from: str, a_to: str | None, b_from: str, b_to: str | None) -> bool:
    return (a_to is None or a_to > b_from) and (b_to is None or b_to > a_from)


def _assert_no_alias_ambiguity(
    rows: tuple[dict, ...], key_field: str, label: str
) -> None:
    """같은 issuer·같은 키가 겹치는 기간에 두 class로 가면 fail-close다."""
    buckets: dict[tuple[str, str], list[dict]] = {}
    for row in rows:
        buckets.setdefault((row["issuer_id"], row[key_field]), []).append(row)
    for (issuer_id, key), items in sorted(buckets.items()):
        for i in range(len(items)):
            for j in range(i + 1, len(items)):
                left, right = items[i], items[j]
                if left["class_id"] == right["class_id"]:
                    continue
                if _overlaps(
                    left["effective_from"],
                    left["effective_to"],
                    right["effective_from"],
                    right["effective_to"],
                ):
                    raise QVManifestError(
                        f"{label} alias가 같은 시점에 두 class로 갑니다: "
                        f"issuer={issuer_id} key={key!r} "
                        f"{left['class_id']} vs {right['class_id']}"
                    )


def validate(manifest: Manifest) -> None:
    """DB 없이 확인할 수 있는 계약을 전부 본다."""
    issuers = {row["issuer_id"] for row in manifest.rows["issuers.jsonl"]}
    ciks = {}
    for row in manifest.rows["issuers.jsonl"]:
        if row["cik"] in ciks:
            raise QVManifestError(f"CIK가 두 issuer에 붙었습니다: {row['cik']}")
        ciks[row["cik"]] = row["issuer_id"]

    classes: dict[str, list[dict]] = {}
    for row in manifest.rows["share_classes.jsonl"]:
        if row["issuer_id"] not in issuers:
            raise QVManifestError(
                f"share class의 issuer가 manifest에 없습니다: {row['issuer_id']}"
            )
        classes.setdefault(row["class_id"], []).append(row)

    for class_id, segments in classes.items():
        owners = {segment["issuer_id"] for segment in segments}
        if len(owners) > 1:
            raise QVManifestError(
                f"class_id가 두 issuer에 걸쳐 있습니다: {class_id} {sorted(owners)}"
            )
        for i in range(len(segments)):
            for j in range(i + 1, len(segments)):
                if _overlaps(
                    segments[i]["effective_from"],
                    segments[i]["effective_to"],
                    segments[j]["effective_from"],
                    segments[j]["effective_to"],
                ):
                    raise QVManifestError(f"class 구간이 겹칩니다: {class_id}")

    for filename, key_field, label in (
        ("prose_aliases.jsonl", "comparison_key", "prose"),
    ):
        for row in manifest.rows[filename]:
            if row["class_id"] not in classes:
                raise QVManifestError(
                    f"{filename}: 모르는 class_id입니다: {row['class_id']}"
                )
            if row["issuer_id"] not in issuers:
                raise QVManifestError(f"{filename}: 모르는 issuer_id입니다")
        _assert_no_alias_ambiguity(manifest.rows[filename], key_field, label)


def materialize(
    connection: sqlite3.Connection,
    manifest: Manifest,
    *,
    filings_source_version: str,
) -> str:
    """manifest를 DB에 원자적으로 반영하고 identity_source_version을 돌려준다."""
    validate(manifest)
    version = manifest.identity_source_version

    prepared: dict[str, list[tuple[dict, str, list[dict]]]] = {}
    for filename in MANIFEST_FILES:
        items = []
        for row in manifest.rows[filename]:
            usable, resolved = resolve_usable_from_session(
                connection, row["evidence"], filings_source_version
            )
            items.append((row, usable, resolved))
        prepared[filename] = items

    try:
        connection.execute("BEGIN IMMEDIATE")
        connection.execute(
            "INSERT OR REPLACE INTO data_sources"
            " (source, source_version, kind, point_in_time, survivorship_biased, note)"
            " VALUES (?, ?, 'securities', 1, 0, ?)",
            (
                IDENTITY_SOURCE,
                version,
                "QV identity manifest bundle (4 files, canonical SHA-256)",
            ),
        )
        for table in (
            "qv_identity_evidence",
            "qv_share_class_prose_aliases",
            "qv_share_classes",
            "qv_issuers",
        ):
            connection.execute(f"DELETE FROM {table} WHERE source_version = ?", (version,))

        for row, usable, resolved in prepared["issuers.jsonl"]:
            connection.execute(
                "INSERT INTO qv_issuers"
                " (issuer_id, cik, resolution_method, usable_from_session,"
                "  source, source_version, provenance)"
                " VALUES (?, ?, ?, ?, ?, ?, ?)",
                (
                    row["issuer_id"],
                    row["cik"],
                    row["resolution_method"],
                    usable,
                    IDENTITY_SOURCE,
                    version,
                    row["provenance"],
                ),
            )
            _insert_evidence(
                connection, "ISSUER", row["issuer_id"], resolved, version,
                row["provenance"],
            )

        for row, usable, resolved in prepared["share_classes.jsonl"]:
            connection.execute(
                "INSERT INTO qv_share_classes"
                " (class_id, issuer_id, symbol, is_ordinary_common, is_listed,"
                "  effective_from, effective_to, usable_from_session,"
                "  source, source_version, provenance)"
                " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    row["class_id"],
                    row["issuer_id"],
                    row["symbol"],
                    int(row["is_ordinary_common"]),
                    int(row["is_listed"]),
                    row["effective_from"],
                    row["effective_to"],
                    usable,
                    IDENTITY_SOURCE,
                    version,
                    row["provenance"],
                ),
            )
            _insert_evidence(
                connection, "SHARE_CLASS",
                f"{row['class_id']}|{row['effective_from']}", resolved, version,
                row["provenance"],
            )

        for row, usable, resolved in prepared["prose_aliases.jsonl"]:
            connection.execute(
                "INSERT INTO qv_share_class_prose_aliases"
                " (class_id, issuer_id, raw_prose_name, comparison_key, bridge_type,"
                "  effective_from, effective_to, usable_from_session,"
                "  source, source_version, provenance)"
                " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    row["class_id"], row["issuer_id"], row["raw_prose_name"],
                    row["comparison_key"], row["bridge_type"],
                    row["effective_from"], row["effective_to"], usable,
                    IDENTITY_SOURCE, version, row["provenance"],
                ),
            )
            _insert_evidence(
                connection, "PROSE_ALIAS",
                f"{row['class_id']}|{row['comparison_key']}|{row['bridge_type']}|{row['effective_from']}",
                resolved, version, row["provenance"],
            )
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    return version


def _insert_evidence(
    connection: sqlite3.Connection,
    relation_kind: str,
    relation_key: str,
    resolved: list[dict],
    version: str,
    provenance: str,
) -> None:
    connection.executemany(
        "INSERT INTO qv_identity_evidence"
        " (relation_kind, relation_key, evidence_ordinal, source_kind, cik, accession,"
        "  document_name, evidence_role, locator, dependency, resolved_usable_session,"
        "  source, source_version, provenance)"
        " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [
            (
                relation_kind, relation_key, ordinal, item["source_kind"], item["cik"],
                item["accession"], item["document_name"], item["evidence_role"],
                item["locator"], item["dependency"], item["resolved_usable_session"],
                IDENTITY_SOURCE, version, provenance,
            )
            for ordinal, item in enumerate(resolved)
        ],
    )
