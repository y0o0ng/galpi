"""Step 5A-2c — **안전 자동 승격기**. 5A-2 제안 packet을 production manifest로 옮긴다.

승인 정책은 CLOSED다(설계 문서 5A-2c 절).

```text
AUTO_PROVABLE     결정론적 재검증을 통과하면 사람의 의미 승인 없이 승격된다
REVIEW_REQUIRED   승격 전에 사람의 판정이 필요하다 — 우회 경로가 없다
UNRESOLVED        승격 경로가 없다
```

**5A-2a/b는 manifest를 읽지도 쓰지도 않는다.** 승격은 여기서만 일어나고, 여기서도
`--apply`가 있어야 파일이 바뀐다.

## 이 모듈이 하지 않는 것

- **SEC를 다시 부르지 않는다.** proof packet은 5A-2b가 만들었다. 여기는 packet의
  자기 일관성과 manifest 호환성만 결정론적으로 확인한다.
- **`proposal_status`를 믿지 않는다.** JSON의 `AUTO_PROVABLE`은 입력이지 권한이 아니다.
- **DB를 건드리지 않는다.** materialize와 `usable_from_session`은 5A-3의 일이다.
- **fuzzy 추론·신뢰도 점수·휴리스틱 승격 경로를 만들지 않는다.**
- **다섯 번째 identity 파일을 만들지 않는다.** receipt는 run/audit 산출물이다.

## base version 규칙

제안이 고정한 `identity_source_version`이 **지금 bundle과 정확히 같아야** 한다.
다르면 `STALE_IDENTITY_BASE`이고, 바뀐 manifest에 대고 병합하거나 rebase하지 않는다 —
**새 정확한 bundle에서 다시 돌린다.** 어느 base에서 증명된 것인지가 사라지면 packet의
provenance가 거짓이 된다.

## 기존 행은 append/reuse 전용

정확히 같은 issuer/class/alias는 재사용하고 진짜 새 관계만 덧붙인다. 기존 semantic 행의
CIK·class_id·구간·심볼·REQUIRED 증거를 자동으로 바꾸지 않는다. **provenance를 위해
기존 행에 REQUIRED 증거를 더하는 것도 금지다** — 그것이 그 행의 파생
`usable_from_session`을 바꿀 수 있기 때문이다. 필요하면 fail-close다.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from pathlib import Path

from .qv_identity_proposals import (
    AUTO_PROVABLE,
    BRIDGE_KINDS,
    DIRECT,
    DISCOVERY_ORIGINS,
    HISTORICAL_ORIGINS,
    ORDINARY_COMMON_LISTED,
    REUSED_VENDOR_SERIES,
    CoverClass,
    CANONICAL_PROSE_BRIDGES,
    CLASS_CENSUS_COMPLETE,
    COVER_GROUP_LABEL,
    MECHANICALLY_COMPLETE_SEC_PROOF,
    PROSE_BRIDGE_TYPES,
    REVIEW_REQUIRED,
    UNRESOLVED,
    GOVERNING_INSTRUMENT,
    SECURITY_TITLE_FACT,
    census_status,
    class_id_for,
    class_role,
    cover_classes_for_symbol,
    cover_proof_from_json,
)
from .qv_manifest import (
    APPROVED_CLASS_AXIS_LOCALS,
    DERIVED_MEMBER_LOCALS,
    EVIDENCE_DEPENDENCIES,
    EVIDENCE_SOURCE_KINDS,
    MANIFEST_FILES,
    is_standard_family,
    load_manifest,
    normalize_cik,
    prose_key,
    qname_key,
    validate,
)

# ── 불투명 production class id — 사용자가 고른 Option A ──────────────────────
#
# **ticker · XBRL 축/member · 사람이 읽는 class 글자 · canonical bridge 계약 없는 표시
# 제목 · 제안 id · 삽입 순서 · 정수 시퀀스를 쓰지 않는다.** alias가 정체성이 되면
# taxonomy가 바뀌는 순간 economic class가 바뀐 것처럼 보인다.
CLASS_ID_SCHEME = "qv-class-id-v1"

STALE_IDENTITY_BASE = "STALE_IDENTITY_BASE"

EXPECTED_STAGE = "5A-2"
EXPECTED_PRODUCES = "SEC_IDENTITY_PROPOSALS"

REQUIRED_DEMAND_PROVENANCE = (
    "index_name",
    "universe_source",
    "universe_source_version",
    "calendar_source",
    "calendar_source_version",
    "reused_series_source",
    "reused_series_source_version",
    "identity_source_version",
)

# 승격 자격이 있는 유일한 사유 상태. 다른 사유가 하나라도 있으면 기계적 완결이 아니다.
ALLOWED_REASON_CODES = frozenset({MECHANICALLY_COMPLETE_SEC_PROOF})


class QVPromotionError(Exception):
    """승격 계약을 벗어날 때 올린다. **전부 fail-close다.**"""


# ── qv-class-id-v1 ────────────────────────────────────────────────────────────


def _canonical_json(value: object) -> str:
    """QV identity 해싱과 **같은** 결정론적 직렬화."""
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"))


def class_id_v1(
    *,
    cik: str,
    effective_from: str,
    canonical_bridge_type: str,
    canonical_bridge_key: str,
) -> str:
    """새 economic class의 **불투명 결정적 안정 키**.

    seed는 economic 사실만으로 이루어진다 — 등록인, class 탄생일, 그리고 그 탄생
    시점에 유효한 canonical bridge. XBRL member 이름이나 ticker가 바뀌어도 이 값은
    바뀌지 않는다.
    """
    if canonical_bridge_type not in CANONICAL_PROSE_BRIDGES:
        raise QVPromotionError(
            f"canonical bridge가 아닙니다: {canonical_bridge_type!r}"
        )
    clean_key = str(canonical_bridge_key or "").strip()
    if not clean_key:
        raise QVPromotionError("canonical_bridge_key가 비었습니다")
    clean_from = str(effective_from or "").strip()
    if not clean_from:
        raise QVPromotionError("effective_from이 비었습니다")
    base = normalize_cik(cik)
    seed = {
        "scheme": CLASS_ID_SCHEME,
        "cik": base,
        "effective_from": clean_from,
        "canonical_bridge_type": canonical_bridge_type,
        "canonical_bridge_key": clean_key,
    }
    digest = hashlib.sha256(_canonical_json(seed).encode("utf-8")).hexdigest()
    return f"us-cik-{base}-class-v1-{digest}"


def _bridge_rank(bridge_type: str) -> int:
    """탄생 bridge 선택 순서. **불투명 키의 seed에만 영향을 준다.**"""
    return 0 if bridge_type == GOVERNING_INSTRUMENT else 1


def select_birth_bridge(bridges: list[dict], effective_from: str) -> dict | None:
    """class 탄생 시점에 **명시로 유효한** canonical bridge 중 결정론적 하나.

    몇 년 뒤에야 증거가 생긴 제목이 class의 탄생 정체성을 조용히 정하지 못하게 한다.
    동률이면 `GOVERNING_INSTRUMENT` → `SECURITY_TITLE_FACT` → `comparison_key` 사전순.
    """
    eligible = [
        item
        for item in bridges
        if item["bridge_type"] in CANONICAL_PROSE_BRIDGES
        and item["effective_from"] <= effective_from
        and (item["effective_to"] is None or effective_from < item["effective_to"])
    ]
    if not eligible:
        return None
    return sorted(
        eligible,
        key=lambda item: (_bridge_rank(item["bridge_type"]), item["comparison_key"]),
    )[0]


# ── 5A-2 제안 산출물 읽기 ─────────────────────────────────────────────────────


@dataclass(frozen=True)
class ProposalRunInput:
    """저장된 5A-2 실행 JSON. **메타데이터를 DB나 저장소에서 보충하지 않는다.**"""

    path: str
    payload_sha256: str
    identity_source_version: str
    demand_provenance: dict
    proposals: tuple[dict, ...]

    def counts(self) -> dict[str, int]:
        tally = {AUTO_PROVABLE: 0, REVIEW_REQUIRED: 0, UNRESOLVED: 0}
        for item in self.proposals:
            status = str(item.get("proposal_status") or "")
            if status in tally:
                tally[status] += 1
        return tally


def load_proposal_run(path: str | Path) -> ProposalRunInput:
    """5A-2 산출물을 엄격하게 읽는다. 빠진 것을 채워 넣지 않는다."""
    clean = str(path)
    raw = Path(clean).read_bytes()
    try:
        payload = json.loads(raw.decode("utf-8"))
    except Exception as error:  # noqa: BLE001
        raise QVPromotionError(f"5A-2 산출물을 읽지 못했습니다: {error}") from error
    if not isinstance(payload, dict):
        raise QVPromotionError("5A-2 산출물이 객체가 아닙니다")

    if payload.get("stage") != EXPECTED_STAGE:
        raise QVPromotionError(f"5A-2 산출물이 아닙니다: stage={payload.get('stage')!r}")
    if payload.get("produces") != EXPECTED_PRODUCES:
        raise QVPromotionError(f"produces 계약 불일치: {payload.get('produces')!r}")
    if payload.get("mutates_production_manifest") is not False:
        raise QVPromotionError(
            "mutates_production_manifest가 false가 아닙니다 — 5A-2a/b 산출물이 아닙니다"
        )

    provenance = payload.get("demand_provenance")
    if not isinstance(provenance, dict):
        raise QVPromotionError("demand_provenance가 없습니다")
    clean_provenance: dict[str, str] = {}
    for name in REQUIRED_DEMAND_PROVENANCE:
        value = str(provenance.get(name) or "").strip()
        if not value:
            raise QVPromotionError(
                f"demand provenance가 비었습니다: {name} — 저장소·DB에서 채우지 않고 멈춥니다"
            )
        clean_provenance[name] = value

    top = str(payload.get("identity_source_version") or "").strip()
    if not top:
        raise QVPromotionError("identity_source_version이 비었습니다")
    if top != clean_provenance["identity_source_version"]:
        raise QVPromotionError(
            "identity_source_version이 demand provenance와 다릅니다: "
            f"{top} != {clean_provenance['identity_source_version']}"
        )

    proposals = payload.get("proposals")
    if not isinstance(proposals, list) or not proposals:
        raise QVPromotionError("proposals 목록이 없습니다")

    return ProposalRunInput(
        path=clean,
        payload_sha256="sha256:" + hashlib.sha256(raw).hexdigest(),
        identity_source_version=top,
        demand_provenance=clean_provenance,
        proposals=tuple(proposals),
    )


# ── packet 재검증 ─────────────────────────────────────────────────────────────


def _require_evidence(items, label: str) -> list[dict]:
    """Step 4의 SEC 자연키 모양 그대로인지 본다. DB row id를 받지 않는다."""
    if not isinstance(items, list) or not items:
        raise QVPromotionError(f"{label}: 증거가 최소 하나 필요합니다")
    out = []
    for item in items:
        if not isinstance(item, dict):
            raise QVPromotionError(f"{label}: 증거 항목이 객체가 아닙니다")
        kind = str(item.get("source_kind") or "").strip()
        if kind not in EVIDENCE_SOURCE_KINDS:
            raise QVPromotionError(f"{label}: 모르는 source_kind입니다: {kind!r}")
        dependency = str(item.get("dependency") or "").strip()
        if dependency not in EVIDENCE_DEPENDENCIES:
            raise QVPromotionError(f"{label}: 모르는 dependency입니다: {dependency!r}")
        entry = {
            "source_kind": kind,
            "cik": normalize_cik(item.get("cik")),
            "accession": str(item.get("accession") or "").strip(),
            "document_name": str(item.get("document_name") or "").strip(),
            "evidence_role": str(item.get("evidence_role") or "").strip(),
            "dependency": dependency,
        }
        if not (entry["accession"] and entry["document_name"] and entry["evidence_role"]):
            raise QVPromotionError(f"{label}: 증거 필수 항목이 비었습니다")
        locator = item.get("locator")
        if locator not in (None, ""):
            entry["locator"] = str(locator).strip()
        out.append(entry)
    if not any(item["dependency"] == "REQUIRED" for item in out):
        raise QVPromotionError(f"{label}: REQUIRED 증거가 최소 하나 필요합니다")
    return out


def _merge_evidence(relation: list[dict], interval: list[dict]) -> list[dict]:
    """관계 증거 + 구간 증거. **중복은 한 번만 남기고 순서는 결정론적이다.**"""
    out: list[dict] = []
    seen: set[str] = set()
    for item in list(relation) + list(interval):
        key = _canonical_json(item)
        if key in seen:
            continue
        seen.add(key)
        out.append(item)
    return out


def _interval(row: dict, label: str) -> dict:
    """**직렬화된 구간 객체에서 직접 확인한다.**

    `interval_proved` 같은 논리 flag를 믿지 않는다. 구간은 자기 증거를 들고 있어야
    하고, 그 증거에 REQUIRED가 하나는 있어야 한다. **표지 fact가 REQUIRED라는 이유로
    수명 경계 증거를 대신하지 못한다** — 관계 증거와 구간 증거는 다른 자리에 있다.
    """
    payload = row.get("interval")
    if not isinstance(payload, dict):
        raise QVPromotionError(
            f"{label}: 구간 객체가 없습니다 — 관계마다 자기 유효구간 증거가 필요합니다"
        )
    start = str(payload.get("effective_from") or "").strip()
    if not start:
        raise QVPromotionError(f"{label}: 구간 effective_from이 비었습니다")
    end = payload.get("effective_to")
    end = str(end).strip() if end not in (None, "") else None
    if end is not None and end <= start:
        raise QVPromotionError(f"{label}: 구간이 뒤집혔습니다 {start}..{end}")
    evidence = _require_evidence(payload.get("evidence"), f"{label} 구간")
    return {"effective_from": start, "effective_to": end, "evidence": evidence}


def _within(inner: dict, outer: dict) -> bool:
    """alias 구간이 class 수명 안에 들어가는가. **조용히 잘라 맞추지 않는다.**"""
    if inner["effective_from"] < outer["effective_from"]:
        return False
    if outer["effective_to"] is None:
        return True
    if inner["effective_to"] is None:
        return False
    return inner["effective_to"] <= outer["effective_to"]


def _cover_index(proof: dict, cik: str) -> tuple[dict[str, dict], dict[str, str]]:
    """`(member_key -> 표지 fact, 제안 class_id -> member_key)`.

    대응을 **앞으로** 만든다 — 표지 member에서 제안 id를 다시 계산해 맞춰 본다.
    제안 id 문자열을 파싱해 member 이름을 되뽑지 않는다.
    """
    by_member: dict[str, dict] = {}
    by_proposal_id: dict[str, str] = {}
    for item in proof.get("classes") or []:
        key = str(item.get("member_key") or "")
        if not key:
            raise QVPromotionError("표지 class에 member_key가 없습니다")
        if key in by_member:
            raise QVPromotionError(f"표지에 같은 member_key가 둘입니다: {key}")
        by_member[key] = item
        probe = CoverClass(
            member_key=key,
            axis_namespace=item.get("axis_namespace"),
            axis_local=item.get("axis_local"),
            member_namespace=item.get("member_namespace"),
            member_local=item.get("member_local"),
            security_title=item.get("security_title"),
            title_concept=item.get("title_concept"),
            trading_symbol=item.get("trading_symbol"),
            has_shares_fact=bool(item.get("has_shares_fact")),
        )
        proposal_id = class_id_for(cik, probe)
        if proposal_id in by_proposal_id:
            raise QVPromotionError(f"제안 id가 표지 member 둘에 겹칩니다: {proposal_id}")
        by_proposal_id[proposal_id] = key
    return by_member, by_proposal_id


@dataclass(frozen=True)
class PromotablePacket:
    """재검증을 통과한 packet. **여기서부터가 승격 후보다.**"""

    member_symbol: str
    identity_symbol: str
    selected_cik: str
    issuer_id: str
    proof_accession: str
    issuer_row: dict
    classes: tuple[dict, ...]          # proposal class_id -> 정규화된 class 행
    xbrl_aliases: tuple[dict, ...]
    prose_aliases: tuple[dict, ...]

    @property
    def label(self) -> str:
        if self.member_symbol == self.identity_symbol:
            return self.identity_symbol
        return f"{self.member_symbol}->{self.identity_symbol}"


def revalidate_packet(packet: dict) -> PromotablePacket:
    """**`proposal_status`를 믿지 않고** packet을 처음부터 다시 본다.

    표지에서 나온 관계는 파생된 제안 행이 아니라 **packet에 박힌 원본 표지 fact**와
    대조한다.
    """
    label = f"{packet.get('member_symbol')}->{packet.get('identity_symbol')}"

    status = str(packet.get("proposal_status") or "")
    if status != AUTO_PROVABLE:
        raise QVPromotionError(f"{label}: {status or '(없음)'}는 자동 승격 대상이 아닙니다")
    reasons = set(packet.get("reason_codes") or [])
    if reasons != ALLOWED_REASON_CODES:
        raise QVPromotionError(
            f"{label}: 기계적 완결 사유 상태가 아닙니다 — {sorted(reasons)}"
        )
    if packet.get("conflicts"):
        raise QVPromotionError(f"{label}: conflict가 남아 있습니다")
    if "usable_from_session" in _canonical_json(packet):
        raise QVPromotionError(f"{label}: usable_from_session은 5A-3의 파생값입니다")

    # ── 작업 항목 계약 — 상태 문자열이 아니라 원본 칸에서 다시 본다 ──────────
    member_symbol = str(packet.get("member_symbol") or "").strip()
    identity_symbol = str(packet.get("identity_symbol") or "").strip()
    bridge_kind = str(packet.get("symbol_bridge_kind") or "").strip()
    if not member_symbol or not identity_symbol:
        raise QVPromotionError(f"{label}: member/identity 심볼이 비었습니다")
    if bridge_kind not in BRIDGE_KINDS:
        raise QVPromotionError(f"{label}: 모르는 symbol_bridge_kind입니다: {bridge_kind!r}")
    if bridge_kind == DIRECT and member_symbol != identity_symbol:
        raise QVPromotionError(
            f"{label}: DIRECT인데 member/identity 심볼이 다릅니다"
        )

    # 승계·재편 판정이 걸린 packet은 기계가 고를 자리가 아니다. **명시 칸을 본다.**
    if packet.get("successor_judgement_required") is not False:
        raise QVPromotionError(
            f"{label}: 발행사 승계·재편 판정이 필요하거나 그 칸이 없습니다"
        )

    selected = normalize_cik(packet.get("selected_cik"))
    raw_candidates = packet.get("discovery_candidates") or []
    candidates = {normalize_cik(item.get("cik")) for item in raw_candidates}
    if candidates != {selected}:
        raise QVPromotionError(
            f"{label}: 발견 후보 CIK가 하나로 정해지지 않았습니다 {sorted(candidates)}"
        )
    origins = {str(item.get("origin") or "").strip() for item in raw_candidates}
    unknown = origins - DISCOVERY_ORIGINS
    if unknown:
        raise QVPromotionError(f"{label}: 모르는 발견 출처입니다: {sorted(unknown)}")

    # **재사용 벤더 계열인데 현재 티커 계열 출처뿐이면 자동 승격 대상이 아니다.**
    # 5A-2b와 같은 frozen 규칙을 여기서 다시 돌린다.
    if (
        bridge_kind == REUSED_VENDOR_SERIES
        and raw_candidates
        and not (origins & HISTORICAL_ORIGINS)
    ):
        raise QVPromotionError(
            f"{label}: 옛 계열인데 발견 후보가 현재 티커 계열 출처뿐입니다 — "
            "그 구간의 등록인 판정이 필요합니다"
        )

    proof = packet.get("proof")
    if not isinstance(proof, dict):
        raise QVPromotionError(f"{label}: 표지 증명이 없습니다")
    if normalize_cik(proof.get("cik")) != selected:
        raise QVPromotionError(f"{label}: 증명된 등록인이 선택 CIK와 다릅니다")
    if proof.get("anomalies"):
        raise QVPromotionError(f"{label}: 표지 anomaly가 남아 있습니다")
    accession = str(proof.get("accession") or "").strip()
    if not accession:
        raise QVPromotionError(f"{label}: 증명 accession이 비었습니다")

    # **원본 표지 구조를 되살려 5A-2b와 같은 순수 함수를 다시 돌린다.**
    # `class_census_status` 문자열을 권한으로 삼지 않는다.
    rebuilt = cover_proof_from_json(proof)
    recomputed_census, _notes = census_status(rebuilt)
    if recomputed_census != CLASS_CENSUS_COMPLETE:
        raise QVPromotionError(
            f"{label}: 표지에서 다시 센 sibling class census가 완결이 아닙니다 "
            f"({recomputed_census})"
        )
    if packet.get("class_census_status") != CLASS_CENSUS_COMPLETE:
        raise QVPromotionError(f"{label}: census 상태 칸이 완결이 아닙니다")

    # 요구된 경제적 심볼이 표지에서 **정확히 하나**로 잡혀야 한다. 5A-2b가 쓰는
    # 대조 함수를 그대로 쓴다 — 각 class가 자기 심볼과 맞는지만 보는 것으로는 모자란다.
    demanded = cover_classes_for_symbol(rebuilt, identity_symbol)
    if len(demanded) != 1:
        raise QVPromotionError(
            f"{label}: 표지에서 {identity_symbol}가 정확히 하나로 잡히지 않습니다 "
            f"({len(demanded)}건)"
        )
    target = demanded[0]
    if class_role(target) != ORDINARY_COMMON_LISTED:
        raise QVPromotionError(
            f"{label}: 요구 class가 표지에서 상장 보통주로 증명되지 않았습니다"
        )
    if not target.security_title:
        raise QVPromotionError(f"{label}: 요구 class에 명시 제목 bridge가 없습니다")

    cover, member_of = _cover_index(proof, selected)

    issuer = packet.get("issuer_proposal")
    if not isinstance(issuer, dict):
        raise QVPromotionError(f"{label}: issuer 제안이 없습니다")
    if normalize_cik(issuer.get("cik")) != selected:
        raise QVPromotionError(f"{label}: issuer 제안 CIK가 선택 CIK와 다릅니다")
    issuer_id = str(issuer.get("issuer_id") or "").strip()
    if issuer_id != f"us-cik-{selected}":
        raise QVPromotionError(f"{label}: issuer_id 규칙을 벗어났습니다: {issuer_id}")
    issuer_row = {
        "issuer_id": issuer_id,
        "cik": selected,
        "resolution_method": str(issuer.get("resolution_method") or "").strip(),
        "provenance": str(issuer.get("provenance") or "").strip(),
        "evidence": _require_evidence(issuer.get("evidence"), f"{label} issuer"),
    }
    if not issuer_row["resolution_method"] or not issuer_row["provenance"]:
        raise QVPromotionError(f"{label}: issuer 필수 항목이 비었습니다")

    # ── 보통주 class ────────────────────────────────────────────────────────
    class_rows: list[dict] = []
    proposal_ids: set[str] = set()
    for row in packet.get("share_class_proposals") or []:
        proposal_id = str(row.get("class_id") or "").strip()
        if not proposal_id or proposal_id in proposal_ids:
            raise QVPromotionError(f"{label}: 제안 class_id가 비었거나 중복입니다")
        proposal_ids.add(proposal_id)
        if str(row.get("issuer_id") or "") != issuer_id:
            raise QVPromotionError(f"{label}: class의 issuer_id가 다릅니다")
        if not row.get("is_ordinary_common"):
            raise QVPromotionError(f"{label}: 보통주가 아닌 class 제안입니다")
        interval = _interval(row, f"{label} class {proposal_id}")

        member_key = member_of.get(proposal_id)
        member = cover.get(member_key) if member_key else None
        if member is None:
            raise QVPromotionError(f"{label}: 표지에서 {proposal_id}를 찾지 못했습니다")
        symbol = row.get("symbol")
        symbol = str(symbol).strip() if symbol not in (None, "") else None
        if symbol != (member.get("trading_symbol") or None):
            raise QVPromotionError(f"{label}: class 심볼이 표지와 다릅니다")
        if bool(row.get("is_listed")) != bool(member.get("trading_symbol")):
            raise QVPromotionError(f"{label}: 상장 여부가 표지와 다릅니다")
        if not member.get("has_shares_fact"):
            raise QVPromotionError(
                f"{label}: {proposal_id}는 표지에서 보통주로 증명되지 않았습니다"
            )
        class_rows.append({
            "proposal_class_id": proposal_id,
            "issuer_id": issuer_id,
            "symbol": symbol,
            "is_ordinary_common": True,
            "is_listed": bool(symbol),
            "effective_from": interval["effective_from"],
            "effective_to": interval["effective_to"],
            "interval": interval,
            "provenance": str(row.get("provenance") or "").strip(),
            # production 행의 증거는 관계 증거 + **구간 증거**를 함께 담는다.
            "evidence": _merge_evidence(
                _require_evidence(row.get("evidence"), f"{label} class"),
                interval["evidence"],
            ),
        })
    if not class_rows:
        raise QVPromotionError(f"{label}: 승격할 보통주 class가 없습니다")

    # 표지가 증명한 보통주 class가 전부 packet에 있어야 한다(census 완결의 의미).
    proved_members = {
        key for key, item in cover.items() if item.get("has_shares_fact")
    }
    covered = {member_of[row["proposal_class_id"]] for row in class_rows}
    if proved_members - covered:
        raise QVPromotionError(
            f"{label}: 표지가 증명한 보통주 class가 packet에 빠졌습니다"
        )

    # ── XBRL alias ──────────────────────────────────────────────────────────
    xbrl_rows: list[dict] = []
    for row in packet.get("xbrl_alias_proposals") or []:
        proposal_id = str(row.get("class_id") or "").strip()
        if proposal_id not in proposal_ids:
            raise QVPromotionError(f"{label}: alias가 모르는 class를 가리킵니다")
        interval = _interval(row, f"{label} xbrl alias {proposal_id}")
        axis_local = str(row.get("axis_local") or "").strip()
        member_local = str(row.get("member_local") or "").strip()
        axis_key = qname_key(row.get("axis_namespace"), axis_local, selected)
        member_key = qname_key(row.get("member_namespace"), member_local, selected)
        if member_local in DERIVED_MEMBER_LOCALS:
            raise QVPromotionError(f"{label}: 파생/등가 member는 class가 아닙니다")
        if not is_standard_family(axis_key) or axis_local not in APPROVED_CLASS_AXIS_LOCALS:
            raise QVPromotionError(f"{label}: 승인되지 않은 class 축입니다: {axis_key}")
        if member_key not in cover:
            raise QVPromotionError(f"{label}: alias member가 표지에 없습니다: {member_key}")
        xbrl_rows.append({
            "proposal_class_id": proposal_id,
            "issuer_id": issuer_id,
            "axis_namespace": row.get("axis_namespace"),
            "axis_local": axis_local,
            "member_namespace": row.get("member_namespace"),
            "member_local": member_local,
            "axis_key": axis_key,
            "member_key": member_key,
            "effective_from": interval["effective_from"],
            "effective_to": interval["effective_to"],
            "interval": interval,
            "provenance": str(row.get("provenance") or "").strip(),
            "evidence": _merge_evidence(
                _require_evidence(row.get("evidence"), f"{label} xbrl alias"),
                interval["evidence"],
            ),
        })

    # ── prose alias ─────────────────────────────────────────────────────────
    prose_rows: list[dict] = []
    for row in packet.get("prose_alias_proposals") or []:
        proposal_id = str(row.get("class_id") or "").strip()
        if proposal_id not in proposal_ids:
            raise QVPromotionError(f"{label}: prose alias가 모르는 class를 가리킵니다")
        bridge = str(row.get("bridge_type") or "").strip()
        if bridge not in PROSE_BRIDGE_TYPES:
            raise QVPromotionError(f"{label}: 모르는 bridge_type입니다: {bridge!r}")
        interval = _interval(row, f"{label} prose alias {proposal_id}")
        raw_name = str(row.get("raw_prose_name") or "").strip()
        comparison = prose_key(raw_name)
        if str(row.get("prose_key") or "") != comparison:
            raise QVPromotionError(f"{label}: prose N1 정규화가 맞지 않습니다")
        if bridge == SECURITY_TITLE_FACT:
            member = cover.get(member_of.get(proposal_id, "")) or {}
            title = member.get("security_title")
            if not title or prose_key(title) != comparison:
                raise QVPromotionError(
                    f"{label}: SECURITY_TITLE_FACT가 표지 제목과 다릅니다"
                )
        prose_rows.append({
            "proposal_class_id": proposal_id,
            "issuer_id": issuer_id,
            "raw_prose_name": raw_name,
            "comparison_key": comparison,
            "bridge_type": bridge,
            "effective_from": interval["effective_from"],
            "effective_to": interval["effective_to"],
            "interval": interval,
            "provenance": str(row.get("provenance") or "").strip(),
            "evidence": _merge_evidence(
                _require_evidence(row.get("evidence"), f"{label} prose alias"),
                interval["evidence"],
            ),
        })

    # ── alias는 그 class의 수명 밖에서 유효할 수 없다 ────────────────────────
    class_span = {row["proposal_class_id"]: row["interval"] for row in class_rows}
    for alias in xbrl_rows + prose_rows:
        outer = class_span.get(alias["proposal_class_id"])
        if outer is None:
            raise QVPromotionError(f"{label}: alias가 모르는 class를 가리킵니다")
        if not _within(alias["interval"], outer):
            raise QVPromotionError(
                f"{label}: alias 구간이 class 수명 밖으로 나갑니다 — "
                f"{alias['proposal_class_id']} "
                f"alias {alias['effective_from']}..{alias['effective_to']} vs "
                f"class {outer['effective_from']}..{outer['effective_to']}"
            )

    # ── canonical bridge — 모든 보통주 class에 하나씩 ────────────────────────
    for row in class_rows:
        bridges = [
            item for item in prose_rows
            if item["proposal_class_id"] == row["proposal_class_id"]
        ]
        if select_birth_bridge(bridges, row["effective_from"]) is None:
            raise QVPromotionError(
                f"{label}: {row['proposal_class_id']}에 탄생 시점 canonical bridge가 "
                f"없습니다 (COVER_GROUP_LABEL은 정체성이 되지 못합니다)"
            )

    return PromotablePacket(
        member_symbol=str(packet.get("member_symbol") or "").strip(),
        identity_symbol=str(packet.get("identity_symbol") or "").strip(),
        selected_cik=selected,
        issuer_id=issuer_id,
        proof_accession=accession,
        issuer_row=issuer_row,
        classes=tuple(class_rows),
        xbrl_aliases=tuple(xbrl_rows),
        prose_aliases=tuple(prose_rows),
    )


# ── 기존 manifest와의 대조 — append/reuse 전용 ────────────────────────────────


def _overlaps(a_from: str, a_to: str | None, b_from: str, b_to: str | None) -> bool:
    return (a_to is None or a_to > b_from) and (b_to is None or b_to > a_from)


def _covers(row: dict, session: str) -> bool:
    return row["effective_from"] <= session and (
        row["effective_to"] is None or session < row["effective_to"]
    )


def resolve_class_id(
    state,
    *,
    issuer_id: str,
    cik: str,
    class_row: dict,
    bridges: list[dict],
) -> tuple[str, bool, dict]:
    """`(class_id, 새로 만들었는가, 쓴 탄생 bridge)`.

    **기존 class id를 함부로 다시 만들지 않는다.** 이미 있는 id는 안정적인 foreign
    key다. 정확히 안전한 재사용만 시도하고, 둘 이상 걸리면 fail-close다.

    `state`는 base manifest이거나 **base + 이번 batch가 이미 계획한 행**을 함께 든
    전망 상태다. 둘 다 `.rows` 하나만 읽는다.
    """
    birth = select_birth_bridge(bridges, class_row["effective_from"])
    if birth is None:
        raise QVPromotionError(
            f"{class_row['proposal_class_id']}: 탄생 시점 canonical bridge가 없습니다"
        )

    # 같은 issuer · **정확히 같은** canonical comparison_key · 그 관계가 제안 class의
    # 탄생 시점에 유효한 기존 prose alias만 후보다.
    matches: set[str] = set()
    for row in state.rows["prose_aliases.jsonl"]:
        if row["issuer_id"] != issuer_id:
            continue
        if row["bridge_type"] not in CANONICAL_PROSE_BRIDGES:
            continue
        if row["comparison_key"] != birth["comparison_key"]:
            continue
        if not _covers(row, class_row["effective_from"]):
            continue
        matches.add(row["class_id"])

    compatible: set[str] = set()
    for class_id in matches:
        segments = [
            row for row in state.rows["share_classes.jsonl"]
            if row["class_id"] == class_id
        ]
        # **정확히 같은 economic 구간과 속성일 때만 재사용한다.** 다르면 기존 행을
        # 늘리거나 고쳐야 하는데 자동 경로에는 그 권한이 없다.
        for row in segments:
            if (
                row["effective_from"] == class_row["effective_from"]
                and row["effective_to"] == class_row["effective_to"]
                and row["symbol"] == class_row["symbol"]
                and bool(row["is_listed"]) == bool(class_row["is_listed"])
                and bool(row["is_ordinary_common"]) is True
            ):
                compatible.add(class_id)
    if len(compatible) > 1:
        raise QVPromotionError(
            f"{class_row['proposal_class_id']}: 기존 class가 둘 이상 맞습니다 — "
            + ", ".join(sorted(compatible))
        )
    if len(compatible) == 1:
        return next(iter(compatible)), False, birth
    if matches:
        raise QVPromotionError(
            f"{class_row['proposal_class_id']}: 같은 canonical bridge를 든 기존 class가 "
            "있으나 economic 구간·속성이 다릅니다 — 자동으로 고치지 않습니다: "
            + ", ".join(sorted(matches))
        )

    new_id = class_id_v1(
        cik=cik,
        effective_from=class_row["effective_from"],
        canonical_bridge_type=birth["bridge_type"],
        canonical_bridge_key=birth["comparison_key"],
    )
    existing_ids = {row["class_id"] for row in state.rows["share_classes.jsonl"]}
    if new_id in existing_ids:
        raise QVPromotionError(f"새 class id가 기존 id와 충돌합니다: {new_id}")
    return new_id, True, birth


def _semantic_same(left: dict, right: dict, fields: tuple[str, ...]) -> bool:
    return all(left.get(name) == right.get(name) for name in fields)


class Prospective:
    """base manifest + **이번 batch가 이미 계획한 행**을 함께 보는 조회 상태.

    같은 batch의 앞 packet이 만든 class/alias를 뒤 packet이 **본다.** 그러지 않으면
    두 상장 심볼이 같은 발행사의 같은 sibling package를 들고 올 때 같은 관계가 두 번
    추가된다. 다중 증권 발행사에서 정확히 그 일이 일어난다.

    **production 파일을 쓰지 않는다.** 메모리 안의 전망 상태일 뿐이다.
    """

    def __init__(self, manifest):
        self.rows = {
            name: list(manifest.rows[name]) for name in MANIFEST_FILES
        }

    def add(self, filename: str, row: dict) -> None:
        self.rows[filename].append(row)


@dataclass
class PlannedRows:
    """실제로 파일에 덧붙일 행과 재사용한 행."""

    added: dict[str, list[dict]] = field(
        default_factory=lambda: {name: [] for name in MANIFEST_FILES}
    )
    reused: dict[str, list[tuple]] = field(
        default_factory=lambda: {name: [] for name in MANIFEST_FILES}
    )


@dataclass(frozen=True)
class PacketPlan:
    packet: PromotablePacket
    class_id_map: dict            # 제안 class_id -> production class_id
    generated_class_ids: tuple[str, ...]
    reused_class_ids: tuple[str, ...]

    def as_json(self) -> dict:
        return {
            "member_symbol": self.packet.member_symbol,
            "identity_symbol": self.packet.identity_symbol,
            "selected_cik": self.packet.selected_cik,
            "proof_accession": self.packet.proof_accession,
            "proposal_class_id_to_production_class_id": dict(
                sorted(self.class_id_map.items())
            ),
            "class_ids_generated": list(self.generated_class_ids),
            "class_ids_reused": list(self.reused_class_ids),
        }


@dataclass(frozen=True)
class PromotionPlan:
    """dry-run 산출물. **production 파일을 하나도 건드리지 않은 상태다.**"""

    proposal_run: ProposalRunInput
    base_identity_source_version: str
    candidate_identity_source_version: str
    packets: tuple[PacketPlan, ...]
    rows: PlannedRows
    left_untouched: dict

    def files_changed(self) -> tuple[str, ...]:
        return tuple(
            name for name in MANIFEST_FILES if self.rows.added[name]
        )

    def as_receipt(self, *, applied: bool) -> dict:
        return {
            "stage": "5A-2c",
            "produces": "IDENTITY_PROMOTION_RECEIPT",
            "note": (
                "automatic promotion of revalidated AUTO_PROVABLE packets only; "
                "REVIEW_REQUIRED needs human adjudication and UNRESOLVED cannot be "
                "promoted. usable_from_session stays a 5A-3 derivation."
            ),
            "proposal_run_path": self.proposal_run.path,
            "proposal_run_sha256": self.proposal_run.payload_sha256,
            "demand_provenance": dict(sorted(self.proposal_run.demand_provenance.items())),
            "base_identity_source_version": self.base_identity_source_version,
            "candidate_identity_source_version": self.candidate_identity_source_version,
            "applied": applied,
            "selected_work_items": [item.as_json() for item in self.packets],
            "left_untouched": dict(sorted(self.left_untouched.items())),
            "manifest_rows_added": {
                name: len(self.rows.added[name]) for name in MANIFEST_FILES
            },
            "manifest_rows_reused": {
                name: len(self.rows.reused[name]) for name in MANIFEST_FILES
            },
            "files_changed": list(self.files_changed()),
        }


# ── 계획 수립 ─────────────────────────────────────────────────────────────────

ISSUER_FIELDS = ("issuer_id", "cik", "resolution_method")
CLASS_FIELDS = (
    "class_id", "issuer_id", "symbol", "is_ordinary_common", "is_listed",
    "effective_from", "effective_to",
)
XBRL_FIELDS = ("class_id", "issuer_id", "axis_key", "member_key",
               "effective_from", "effective_to")
PROSE_FIELDS = ("class_id", "issuer_id", "comparison_key", "bridge_type",
                "effective_from", "effective_to")


def _select_packets(payload_proposals, select) -> list[dict]:
    """`--select MEMBER/IDENTITY`. 주지 않으면 `AUTO_PROVABLE` 전부다."""
    auto = [
        item for item in payload_proposals
        if str(item.get("proposal_status") or "") == AUTO_PROVABLE
    ]
    if select is None:
        return auto
    wanted = set()
    for token in select:
        clean = str(token).strip().upper()
        if not clean:
            continue
        member, _, identity = clean.partition("/")
        wanted.add((member, identity or member))
    picked, seen = [], set()
    for item in payload_proposals:
        key = (
            str(item.get("member_symbol") or "").upper(),
            str(item.get("identity_symbol") or "").upper(),
        )
        if key in wanted:
            picked.append(item)
            seen.add(key)
    missing = sorted(wanted - seen)
    if missing:
        raise QVPromotionError(
            "제안 실행에 없는 작업 항목입니다: "
            + ", ".join(f"{m}/{i}" for m, i in missing)
        )
    return picked


def plan_promotion(
    run: ProposalRunInput,
    *,
    manifest,
    select=None,
) -> PromotionPlan:
    """base를 확인하고 후보 bundle을 세운다. **파일을 건드리지 않는다.**

    선택된 `AUTO_PROVABLE` packet **하나라도** 실패하면 전체를 중단한다. 조용히
    건너뛰지 않는다 — `--force`도 `--skip-bad`도 없다.
    """
    if run.identity_source_version != manifest.identity_source_version:
        raise QVPromotionError(
            f"{STALE_IDENTITY_BASE}: 제안이 고정한 base와 지금 bundle이 다릅니다.\n"
            f"  pinned  {run.identity_source_version}\n"
            f"  current {manifest.identity_source_version}\n"
            "  바뀐 manifest에 병합·rebase하지 않습니다 — 새 bundle에서 다시 돌리세요."
        )

    selected = _select_packets(run.proposals, select)
    if not selected:
        raise QVPromotionError("승격할 AUTO_PROVABLE packet이 없습니다")

    counts = run.counts()
    plan_rows = PlannedRows()
    packet_plans: list[PacketPlan] = []

    # **base + 이번 batch가 이미 계획한 것**을 함께 보는 전망 상태. packet 하나를
    # 계획할 때마다 여기에 합치고, 다음 packet은 그 위에서 해석된다.
    prospective = Prospective(manifest)

    for raw in selected:
        packet = revalidate_packet(raw)

        # issuer — 정확히 같으면 재사용, 다르면 fail-close.
        existing_issuer = next(
            (row for row in prospective.rows["issuers.jsonl"]
             if row["issuer_id"] == packet.issuer_id),
            None,
        )
        if existing_issuer is None:
            clash = next(
                (row for row in prospective.rows["issuers.jsonl"]
                 if row["cik"] == packet.selected_cik),
                None,
            )
            if clash is not None:
                raise QVPromotionError(
                    f"{packet.label}: CIK {packet.selected_cik}가 이미 다른 issuer"
                    f"({clash['issuer_id']})에 붙어 있습니다"
                )
            plan_rows.added["issuers.jsonl"].append(packet.issuer_row)
            prospective.add("issuers.jsonl", packet.issuer_row)
        else:
            if not _semantic_same(existing_issuer, packet.issuer_row, ISSUER_FIELDS):
                raise QVPromotionError(
                    f"{packet.label}: 기존 issuer 행을 바꿔야 합니다 — 자동 경로에는 "
                    "그 권한이 없습니다"
                )
            plan_rows.reused["issuers.jsonl"].append((packet.issuer_id,))

        # class id 해석 — 기존 것 재사용 또는 불투명 v1 생성.
        class_id_map: dict[str, str] = {}
        generated: list[str] = []
        reused_ids: list[str] = []
        for class_row in packet.classes:
            bridges = [
                item for item in packet.prose_aliases
                if item["proposal_class_id"] == class_row["proposal_class_id"]
            ]
            class_id, is_new, _birth = resolve_class_id(
                prospective,
                issuer_id=packet.issuer_id,
                cik=packet.selected_cik,
                class_row=class_row,
                bridges=bridges,
            )
            class_id_map[class_row["proposal_class_id"]] = class_id
            (generated if is_new else reused_ids).append(class_id)

            production = {
                "class_id": class_id,
                "issuer_id": class_row["issuer_id"],
                "symbol": class_row["symbol"],
                "is_ordinary_common": True,
                "is_listed": class_row["is_listed"],
                "effective_from": class_row["effective_from"],
                "effective_to": class_row["effective_to"],
                "provenance": class_row["provenance"],
                "evidence": class_row["evidence"],
            }
            if is_new:
                plan_rows.added["share_classes.jsonl"].append(production)
                prospective.add("share_classes.jsonl", production)
            else:
                plan_rows.reused["share_classes.jsonl"].append(
                    (class_id, class_row["effective_from"])
                )

        packet_plans.append(
            PacketPlan(
                packet=packet,
                class_id_map=class_id_map,
                generated_class_ids=tuple(sorted(set(generated))),
                reused_class_ids=tuple(sorted(set(reused_ids))),
            )
        )

        # alias 관계 — semantic key가 같으면 내용이 정확히 같아야 재사용한다.
        for alias in packet.xbrl_aliases:
            row = {
                "class_id": class_id_map[alias["proposal_class_id"]],
                "issuer_id": alias["issuer_id"],
                "axis_namespace": alias["axis_namespace"],
                "axis_local": alias["axis_local"],
                "member_namespace": alias["member_namespace"],
                "member_local": alias["member_local"],
                "effective_from": alias["effective_from"],
                "effective_to": alias["effective_to"],
                "provenance": alias["provenance"],
                "evidence": alias["evidence"],
            }
            probe = {**row, "axis_key": alias["axis_key"], "member_key": alias["member_key"]}
            _plan_alias(
                prospective, plan_rows, "xbrl_aliases.jsonl", XBRL_FIELDS, probe, row,
                key=(row["class_id"], alias["axis_key"], alias["member_key"],
                     row["effective_from"]),
                label=packet.label,
            )

        for alias in packet.prose_aliases:
            row = {
                "class_id": class_id_map[alias["proposal_class_id"]],
                "issuer_id": alias["issuer_id"],
                "raw_prose_name": alias["raw_prose_name"],
                "bridge_type": alias["bridge_type"],
                "effective_from": alias["effective_from"],
                "effective_to": alias["effective_to"],
                "provenance": alias["provenance"],
                "evidence": alias["evidence"],
            }
            probe = {**row, "comparison_key": alias["comparison_key"]}
            _plan_alias(
                prospective, plan_rows, "prose_aliases.jsonl", PROSE_FIELDS, probe, row,
                key=(row["class_id"], alias["comparison_key"], row["bridge_type"],
                     row["effective_from"]),
                label=packet.label,
            )

    _assert_symbol_not_split(prospective)

    candidate = _build_candidate(manifest, plan_rows)

    return PromotionPlan(
        proposal_run=run,
        base_identity_source_version=manifest.identity_source_version,
        candidate_identity_source_version=candidate.identity_source_version,
        packets=tuple(packet_plans),
        rows=plan_rows,
        left_untouched={
            REVIEW_REQUIRED: counts[REVIEW_REQUIRED],
            UNRESOLVED: counts[UNRESOLVED],
            "AUTO_PROVABLE_not_selected": counts[AUTO_PROVABLE] - len(selected),
        },
    )


def _plan_alias(prospective, plan_rows, filename, fields, probe, row, *, key, label):
    """semantic key가 같은 행이 **전망 상태에** 있으면 내용 일치 확인 후 재사용한다.

    같은 batch의 앞 packet이 이미 계획한 관계도 여기서 보인다 — 두 번 덧붙이지 않는다.
    같은 semantic key인데 내용이 다르면 **batch 전체가 실패한다.**
    """
    existing = next(
        (
            item for item in prospective.rows[filename]
            if (
                item["class_id"] == key[0]
                and item.get("axis_key" if filename == "xbrl_aliases.jsonl" else "comparison_key") == key[1]
                and (
                    item["member_key"] == key[2]
                    if filename == "xbrl_aliases.jsonl"
                    else item["bridge_type"] == key[2]
                )
                and item["effective_from"] == key[3]
            )
        ),
        None,
    )
    if existing is None:
        plan_rows.added[filename].append(row)
        prospective.add(filename, probe)
        return
    if not _semantic_same(existing, probe, fields):
        raise QVPromotionError(
            f"{label}: {filename}에 같은 semantic key가 다른 내용으로 있습니다: {key}"
        )
    plan_rows.reused[filename].append(key)


def _assert_symbol_not_split(prospective) -> None:
    """같은 상장 심볼이 겹치는 구간에 두 class를 가리키면 fail-close다.

    `validate()`가 보지 않는 관계라 승격기가 직접 본다. 동률 선택을 하지 않는다.
    base 행과 이번 batch가 계획한 행을 **함께** 본다.
    """
    rows = [
        {
            "class_id": row["class_id"], "symbol": row["symbol"],
            "effective_from": row["effective_from"], "effective_to": row["effective_to"],
        }
        for row in prospective.rows["share_classes.jsonl"]
        if row.get("symbol")
    ]
    buckets: dict[str, list[dict]] = {}
    for row in rows:
        buckets.setdefault(row["symbol"], []).append(row)
    for symbol, items in sorted(buckets.items()):
        for i in range(len(items)):
            for j in range(i + 1, len(items)):
                left, right = items[i], items[j]
                if left["class_id"] == right["class_id"]:
                    continue
                if _overlaps(
                    left["effective_from"], left["effective_to"],
                    right["effective_from"], right["effective_to"],
                ):
                    raise QVPromotionError(
                        f"상장 심볼 {symbol}가 겹치는 구간에 두 class를 가리킵니다: "
                        f"{left['class_id']} vs {right['class_id']}"
                    )


# ── 후보 bundle 구성과 검증 ───────────────────────────────────────────────────


def _row_json(filename: str, row: dict) -> str:
    """파일에 덧붙일 한 줄. **manifest가 읽는 raw 모양 그대로** 쓴다."""
    if filename == "issuers.jsonl":
        payload = {
            "issuer_id": row["issuer_id"],
            "cik": row["cik"],
            "resolution_method": row["resolution_method"],
            "provenance": row["provenance"],
            "evidence": row["evidence"],
        }
    elif filename == "share_classes.jsonl":
        payload = {
            "class_id": row["class_id"],
            "issuer_id": row["issuer_id"],
            "symbol": row["symbol"],
            "is_ordinary_common": row["is_ordinary_common"],
            "is_listed": row["is_listed"],
            "effective_from": row["effective_from"],
            "effective_to": row["effective_to"],
            "provenance": row["provenance"],
            "evidence": row["evidence"],
        }
    elif filename == "xbrl_aliases.jsonl":
        payload = {
            "class_id": row["class_id"],
            "issuer_id": row["issuer_id"],
            "axis_namespace": row["axis_namespace"],
            "axis_local": row["axis_local"],
            "member_namespace": row["member_namespace"],
            "member_local": row["member_local"],
            "effective_from": row["effective_from"],
            "effective_to": row["effective_to"],
            "provenance": row["provenance"],
            "evidence": row["evidence"],
        }
    elif filename == "prose_aliases.jsonl":
        payload = {
            "class_id": row["class_id"],
            "issuer_id": row["issuer_id"],
            "raw_prose_name": row["raw_prose_name"],
            "bridge_type": row["bridge_type"],
            "effective_from": row["effective_from"],
            "effective_to": row["effective_to"],
            "provenance": row["provenance"],
            "evidence": row["evidence"],
        }
    else:
        raise QVPromotionError(f"모르는 manifest 파일입니다: {filename}")
    return json.dumps(payload, ensure_ascii=False)


def _sort_key(filename: str, row: dict) -> tuple:
    """새 행끼리의 결정론적 순서. **물리 줄 순서는 정확성 의존이 아니다** —
    bundle 해시가 semantic 순서로 정규화한다."""
    if filename == "issuers.jsonl":
        return (row["issuer_id"],)
    if filename == "share_classes.jsonl":
        return (row["class_id"], row["effective_from"])
    if filename == "xbrl_aliases.jsonl":
        return (row["class_id"], row["axis_local"], row["member_local"],
                row["effective_from"])
    return (row["class_id"], row["raw_prose_name"], row["bridge_type"],
            row["effective_from"])


def candidate_contents(manifest, rows: PlannedRows) -> dict[str, str]:
    """네 파일의 완성된 새 내용. **기존 줄을 그대로 두고 새 줄만 덧붙인다.**

    정렬·서식을 이유로 기존 행을 다시 쓰지 않는다 — git 차이를 최소로 둔다.
    """
    out: dict[str, str] = {}
    for filename in MANIFEST_FILES:
        original = (manifest.directory / filename).read_text(encoding="utf-8")
        additions = sorted(rows.added[filename], key=lambda r: _sort_key(filename, r))
        if not additions:
            out[filename] = original
            continue
        body = original if original.endswith("\n") or not original else original + "\n"
        out[filename] = body + "".join(
            _row_json(filename, row) + "\n" for row in additions
        )
    return out


def _build_candidate(manifest, rows: PlannedRows):
    """임시 디렉터리에 완전한 네 파일 bundle을 세우고 **정본 loader/validator로** 본다.

    private 정규화 헬퍼를 production 계약으로 쓰지 않는다. `load_manifest`가 내용을
    전부 메모리로 읽으므로 임시 디렉터리는 그 자리에서 정리한다.
    """
    import tempfile

    contents = candidate_contents(manifest, rows)
    with tempfile.TemporaryDirectory() as name:
        base = Path(name)
        for filename, text in contents.items():
            (base / filename).write_text(text, encoding="utf-8")
        candidate = load_manifest(base)
        validate(candidate)
        _assert_no_usable_from_session(candidate)
    return candidate


def _assert_no_usable_from_session(candidate) -> None:
    for filename in MANIFEST_FILES:
        for row in candidate.rows[filename]:
            if "usable_from_session" in row:
                raise QVPromotionError(
                    f"{filename}: usable_from_session은 5A-3이 증거에서 파생한다"
                )


# ── 적용 ──────────────────────────────────────────────────────────────────────


def apply_promotion(plan: PromotionPlan, *, directory: Path | str) -> dict:
    """네 파일을 실제로 바꾼다. **직전에 base version을 한 번 더 확인한다.**

    쓰기 전에 완성된 내용을 전부 메모리에 만들어 두고, 평범한 Python 예외가 나면
    **네 파일 전부를** 원래 바이트로 되돌린다. 쓰다가 실패한 파일 자신이 이미 잘리거나
    일부만 쓰였을 수 있으므로 "성공한 파일만 되돌리기"로는 모자란다.

    **그 이상의 파일시스템 crash-consistency를 주장하지 않는다** — 프로세스가 죽거나
    전원이 나가는 경우는 이 되돌리기가 다루지 않는다.
    """
    base = Path(directory)
    fresh = load_manifest(base)
    if fresh.identity_source_version != plan.base_identity_source_version:
        raise QVPromotionError(
            f"{STALE_IDENTITY_BASE}: 계획 수립 뒤 manifest가 바뀌었습니다.\n"
            f"  planned base {plan.base_identity_source_version}\n"
            f"  current      {fresh.identity_source_version}\n"
            "  병합하지 않습니다 — 새 bundle에서 다시 돌리세요."
        )

    contents = candidate_contents(fresh, plan.rows)
    original = {
        name: (base / name).read_bytes() for name in MANIFEST_FILES
    }
    try:
        for filename in MANIFEST_FILES:
            (base / filename).write_text(contents[filename], encoding="utf-8")
        after = load_manifest(base)
        validate(after)
        if after.identity_source_version != plan.candidate_identity_source_version:
            raise QVPromotionError(
                "적용된 bundle 해시가 계획과 다릅니다: "
                f"{after.identity_source_version} != "
                f"{plan.candidate_identity_source_version}"
            )
    except Exception:
        # **네 파일 전부를 되돌린다.** 쓰기가 터진 파일은 `written`에 들어가지 못했지만
        # 그 파일이야말로 잘려 있을 수 있다.
        for filename in MANIFEST_FILES:
            (base / filename).write_bytes(original[filename])
        raise
    return plan.as_receipt(applied=True)
