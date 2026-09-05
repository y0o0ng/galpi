"""Step 5A-2a/b 실행 진입점 — SEC identity 제안/증명 packet.

**production manifest를 바꾸지 않는다.** `trading/qv/identity/*.jsonl`은 이 실행
경로에서 읽지도 쓰지도 않는다. 산출물은 사람이 검토할 제안 packet JSON 하나다.

    DISCOVERY_HINT  !=  SEC_PROOF  !=  PRODUCTION_MANIFEST

`AUTO_PROVABLE`은 "승인된 규칙 아래 SEC 증거가 기계적으로 완결됐다"는 뜻이고
manifest 승격은 5A-2c가 따로 한다 — 결정론적 재검증을 통과한 `AUTO_PROVABLE`은 사람의
의미 승인 없이 승격될 수 있고, `REVIEW_REQUIRED`만 사람의 판정을 요구한다.

    python3 -m selftest.qv_identity_proposal_run demand --inventory <5A-1.json>
    python3 -m selftest.qv_identity_proposal_run run \
        --inventory <5A-1.json> \
        --symbols AAA,BBB [--limit 5] [--browse] [--historical] \
        [--legal-evidence] \
        [--contact "이름 <메일>"] [--out /tmp/proposals.json]

`run`은 **실제 SEC를 부른다.** 대상은 `--symbols`로 명시하거나 `--limit`으로 5A-1
수요의 앞에서 잘라 고른다. "전부 돌리기"는 기본값이 아니다.

`--checkpoint-dir`는 **작업 항목 하나 단위**로 결과를 durable하게 적는 실행 모드다.
전송 실패(HTTP 503 등)로 프로세스가 죽어도 이미 끝난 항목은 남고 `--resume`이 첫
미완료 항목부터 다시 시작한다. **실행 인프라일 뿐 증거가 아니다** — 발견·증명·법적
증거·승격 semantics를 하나도 바꾸지 않고, 전송 실패를 `UNRESOLVED`나
`REVIEW_REQUIRED` 같은 의미 상태로 바꿔 적지 않는다. 체크포인트 디렉터리는 **정확히
한 실행 정체성**에 속하고 `--resume`에서 전부 다시 계산해 대조한다 — 하나라도 다르면
멈춘다. `--force`도 `--ignore-version`도 없다. 자동 재시도도 이 증분에 없다.

`--historical`은 폐지·재편 종목을 위한 3층 발견을 켠다. 이름은 **이미 있는 명시
source**인 `trading/universe/<index>-changes.csv`의 `security` 칸에서 오고(EDGAR
수집 경로의 `selftest.real_run.security_names()`와 같은 자료다), 멤버십 구간은 5A-1
inventory가 명시한 `universe_source`/`universe_source_version`/`index_name`으로
`universe_membership`에서 읽는다. **지금 ticker 주인의 이름으로 과거를 추정하지
않는다.** 이름 색인은 40MB 한 번이고 선행 등록인 확인은 종목당 제출 이력을 훑는다 —
비싸므로 기본이 아니다.

`--legal-evidence`는 5A-2 법적 증거 공급기를 켠다. 표지 증명이 선 뒤 선언된 지평
(8-K · 10-K · 10-Q 계열)의 accession index를 전부 읽고 governing instrument 후보를
분류·해석해 **명시 법적 사실만** `ClassEvidence`로 만든다. **SEC 호출이 크게 늘어난다**
— 기본값은 더 싼 표지 전용 경로 그대로다. 후보 CIK가 확정되지 않았거나 쓸 만한 표지
제목 anchor가 없으면 돌지 않는다.

**universe/bar 심볼은 SEC 경제적 심볼이 아니다.** 작업 항목은 `member_symbol`(저장된
시장 데이터 계열)과 `identity_symbol`(실제 거래 심볼)을 둘 다 들고 다니고 SEC에는
`identity_symbol`만 던진다. `--symbols`는 둘 중 어느 쪽으로도 고를 수 있고
`MEMBER/IDENTITY` 쌍으로 정확히 하나를 집을 수도 있다.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

TRADING_ROOT = Path(__file__).resolve().parents[1]
if str(TRADING_ROOT) not in sys.path:
    sys.path.insert(0, str(TRADING_ROOT))

from backtest import store  # noqa: E402
from backtest.edgar import EdgarClient  # noqa: E402
from backtest.qv_identity_proposals import (  # noqa: E402
    AUTO_PROVABLE,
    REVIEW_REQUIRED,
    UNRESOLVED,
    DemandInput,
    DiscoveryHints,
    ProposalRun,
    read_mapping_demand,
    run_proposals,
)

UNIVERSE_DIR = TRADING_ROOT / "universe"


def _git_commit() -> str | None:
    try:
        result = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=str(TRADING_ROOT.parent),
            capture_output=True,
            text=True,
            check=True,
        )
    except Exception:  # noqa: BLE001 — git이 없어도 실행은 돼야 한다
        return None
    return result.stdout.strip() or None


def _select(demand_input: DemandInput, arguments) -> DemandInput:
    if arguments.symbols:
        wanted = [item.strip().upper() for item in arguments.symbols.split(",") if item.strip()]
        return demand_input.select(wanted)
    if arguments.limit:
        return demand_input.select(
            f"{item.member_symbol}/{item.identity_symbol}"
            for item in demand_input.work_items[: arguments.limit]
        )
    raise SystemExit("--symbols 또는 --limit 중 하나가 필요합니다(전부 돌리기는 기본이 아닙니다)")


def historical_names(index_name: str) -> dict[str, str]:
    """**경제적** 티커 → 그 구간의 회사 이름. 지수 변경 이력 CSV가 정본이다.

    EDGAR 수집 경로가 이미 쓰는 자료와 같다(`selftest.real_run.security_names()`).
    **키가 경제적 심볼인 이유**는 지수 공고가 `FOXA`라고 적지 벤더 계열 코드
    `TFCFA`라고 적지 않기 때문이다. 벤더 코드로 찾으면 언제나 빈손이다.

    같은 티커에 이름이 여럿이면 가장 이른 것을 쓴다 — 폐지 종목의 CIK를 찾는 것이
    목적이라 그 티커가 지수를 떠날 때의 회사가 알고 싶은 쪽이다.
    """
    path = UNIVERSE_DIR / f"{index_name.lower()}-changes.csv"
    if not path.exists():
        raise SystemExit(f"지수 변경 이력 CSV가 없습니다: {path}")
    found: dict[str, tuple[str, str]] = {}
    for row in csv.DictReader(path.read_text(encoding="utf-8").splitlines()):
        name = (row.get("security") or "").strip()
        symbol = (row.get("symbol") or "").strip().upper()
        date = (row.get("date") or "").strip()
        if not name or not symbol or not date:
            continue
        if symbol not in found or date < found[symbol][0]:
            found[symbol] = (date, name)
    return {symbol: name for symbol, (_, name) in found.items()}


def membership_spans(connection, demand_input: DemandInput) -> dict[str, tuple[str, str]]:
    """**데이터 계열 심볼** → 그 계열의 멤버십 구간. 5A-1이 명시한 source/version만 읽는다.

    **경제적 심볼로 묶지 않는다.** 재사용된 티커의 옛 episode는 이미 벤더 계열 심볼로
    저장돼 있으므로 저장된 심볼로 묶으면 episode가 그대로 갈라진다. 경제적 심볼로 묶으면
    서로 다른 발행사의 구간이 하나의 `MIN(valid_from)`/`MAX(valid_to)`로 합쳐진다.
    """
    rows = connection.execute(
        "SELECT symbol, MIN(valid_from) AS first,"
        "       MAX(COALESCE(valid_to, valid_from)) AS last"
        "  FROM universe_membership"
        " WHERE index_name = ? AND source = ? AND source_version = ?"
        " GROUP BY symbol",
        (
            demand_input.index_name,
            demand_input.universe_source,
            demand_input.universe_source_version,
        ),
    ).fetchall()
    return {row["symbol"]: (row["first"], row["last"]) for row in rows}


def build_hints(demand_input: DemandInput, data_dir=None) -> DiscoveryHints:
    """3층 발견 입력. 이름과 구간 둘 다 **명시 source**에서만 온다.

    이름은 경제적 심볼로, 구간은 데이터 계열 심볼로 키를 잡는다.
    """
    names = historical_names(demand_input.index_name)
    connection = store.connect(data_dir) if data_dir else store.connect()
    try:
        spans = membership_spans(connection, demand_input)
    finally:
        connection.close()
    if not spans:
        raise SystemExit(
            "universe_membership에 그 source/version 행이 없습니다: "
            f"{demand_input.index_name} / {demand_input.universe_source}"
            f" / {demand_input.universe_source_version}"
        )
    return DiscoveryHints(
        source=demand_input.universe_source,
        source_version=demand_input.universe_source_version,
        provenance=(
            f"이름(identity_symbol 키): trading/universe/"
            f"{demand_input.index_name.lower()}-changes.csv (security 칸)"
            " / 구간(member_symbol 키): universe_membership"
        ),
        names=names,
        spans=spans,
    )


# ── 체크포인트 실행 (실행 인프라 — 증거가 아니다) ──────────────────────────────
#
# **작업 항목 하나가 체크포인트 단위다**(`(member_symbol, identity_symbol)`).
# 티커 하나로 묶지 않는다 — 재사용 벤더 계열 episode가 그 자리에서 합쳐진다.
#
# 여기 있는 것은 전송/실행 회복력뿐이다. 발견·증명·법적 증거·승격 semantics를
# 하나도 바꾸지 않고, **전송 실패를 의미 상태로 바꿔 적지 않는다** — HTTP 503은
# `UNRESOLVED`가 아니라 실패다.

CHECKPOINT_SCHEMA = "qv-5a2-checkpoint-v1"
SESSION_RUNNING = "RUNNING"
SESSION_COMPLETE = "COMPLETE"
SESSION_FAILED = "FAILED"
# 프로세스가 급사하면 그 session의 SEC 호출 수는 **알 수 없다.** 추정치를 지어내지
# 않고 이 표식으로 남긴다.
CALLS_UNKNOWN = "unknown"


class CheckpointError(RuntimeError):
    """체크포인트 정체성·무결성 위반. **fail-close다 — 우회 플래그가 없다.**"""


def _sha256_bytes(raw: bytes) -> str:
    return "sha256:" + hashlib.sha256(raw).hexdigest()


def _sha256_file(path: Path) -> str:
    return _sha256_bytes(Path(path).read_bytes())


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _atomic_write_json(path: Path, payload: dict) -> None:
    """부분 파일이 완료된 항목처럼 보이지 않게 원자적으로 쓴다.

    같은 디렉터리 임시 파일 -> flush -> fsync -> `os.replace`. `os.replace`는 같은
    파일시스템 안에서 원자적이다.
    """
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    body = json.dumps(payload, ensure_ascii=False, indent=2) + "\n"
    with open(temporary, "w", encoding="utf-8") as handle:
        handle.write(body)
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temporary, path)


def _historical_source_digest(index_name: str) -> str:
    path = UNIVERSE_DIR / f"{index_name.lower()}-changes.csv"
    if not path.exists():
        raise SystemExit(f"지수 변경 이력 CSV가 없습니다: {path}")
    return _sha256_file(path)


def run_identity(selected: DemandInput, arguments, *, inventory_digest: str) -> dict:
    """이 체크포인트 디렉터리가 속한 **정확히 하나의 실행 정체성.**

    경로는 정체성이 아니다. `--resume`에서 전부 다시 계산해 대조하고 하나라도
    다르면 멈춘다 — 새 manifest로 rebase하지도, best-effort merge도 하지 않는다.
    """
    identity = {
        "checkpoint_schema": CHECKPOINT_SCHEMA,
        "git_commit": _git_commit(),
        "inventory_sha256": inventory_digest,
        "demand_provenance": selected.provenance_json(),
        "identity_source_version": selected.identity_source_version,
        "work_item_keys": [
            [item.member_symbol, item.identity_symbol] for item in selected.work_items
        ],
        "use_browse": bool(arguments.browse),
        "use_historical": bool(arguments.historical),
        "use_legal_evidence": bool(arguments.legal_evidence),
        "historical_source_sha256": (
            _historical_source_digest(selected.index_name)
            if arguments.historical
            else None
        ),
    }
    return identity


def identity_digest(identity: dict) -> str:
    return _sha256_bytes(
        json.dumps(identity, ensure_ascii=False, sort_keys=True).encode("utf-8")
    )


def _identity_mismatch(stored: dict, fresh: dict) -> list[str]:
    """어느 칸이 갈렸는지 전부 모은다. 첫 불일치에서 멈추지 않는다."""
    differences: list[str] = []
    for name in sorted(set(stored) | set(fresh)):
        if stored.get(name) != fresh.get(name):
            differences.append(
                f"{name}: 체크포인트={stored.get(name)!r} 지금={fresh.get(name)!r}"
            )
    return differences


class Checkpoint:
    """작업 항목 단위 durable 실행 상태. **읽기·쓰기 모두 fail-close다.**"""

    def __init__(self, directory: Path, identity: dict) -> None:
        self.directory = Path(directory)
        self.items_dir = self.directory / "items"
        self.sessions_dir = self.directory / "sessions"
        self.metadata_path = self.directory / "run.json"
        self.identity = identity
        self.digest = identity_digest(identity)

    # ── 정체성 ────────────────────────────────────────────────────────────
    def create(self) -> None:
        if self.metadata_path.exists():
            raise CheckpointError(
                f"이미 체크포인트가 있습니다: {self.metadata_path}"
                " — 이어서 하려면 --resume, 새로 하려면 다른 디렉터리를 쓰세요"
            )
        self.items_dir.mkdir(parents=True, exist_ok=True)
        self.sessions_dir.mkdir(parents=True, exist_ok=True)
        _atomic_write_json(
            self.metadata_path,
            {
                "checkpoint_schema": CHECKPOINT_SCHEMA,
                "created_at": _now(),
                "run_identity": self.identity,
                "run_identity_sha256": self.digest,
            },
        )

    def open_existing(self) -> None:
        if not self.metadata_path.exists():
            raise CheckpointError(
                f"체크포인트 메타데이터가 없습니다: {self.metadata_path}"
                " — --resume은 기존 실행에만 씁니다"
            )
        try:
            payload = json.loads(self.metadata_path.read_text(encoding="utf-8"))
        except Exception as error:  # noqa: BLE001
            raise CheckpointError(f"체크포인트 메타데이터를 읽지 못했습니다: {error}") from error
        if payload.get("checkpoint_schema") != CHECKPOINT_SCHEMA:
            raise CheckpointError(
                f"체크포인트 schema가 다릅니다: {payload.get('checkpoint_schema')!r}"
            )
        stored = payload.get("run_identity")
        if not isinstance(stored, dict):
            raise CheckpointError("체크포인트에 run_identity가 없습니다")
        differences = _identity_mismatch(stored, self.identity)
        if differences:
            raise CheckpointError(
                "체크포인트 실행 정체성이 다릅니다 — 같은 코드·같은 수요로만 이어집니다:\n  "
                + "\n  ".join(differences)
            )
        if payload.get("run_identity_sha256") != self.digest:
            raise CheckpointError("run_identity_sha256이 다시 계산한 값과 다릅니다")

    # ── 항목 ─────────────────────────────────────────────────────────────
    def item_path(self, order: int) -> Path:
        return self.items_dir / f"{order:05d}.json"

    def write_item(self, order: int, work_item, run: ProposalRun) -> dict:
        """한 항목의 결과를 durable하게 적는다. **정상 직렬화 정보를 깎지 않는다.**

        `--legal-evidence`의 legal proof 구조도 그대로 들어간다 — 체크포인트는
        전송 산출물이지 새 증거 source가 아니다.
        """
        if len(run.proposals) != 1:
            raise CheckpointError(
                f"작업 항목 하나에 제안이 {len(run.proposals)}개입니다: {work_item.key}"
            )
        payload = {
            "checkpoint_schema": CHECKPOINT_SCHEMA,
            "run_identity_sha256": self.digest,
            "order": order,
            "member_symbol": work_item.member_symbol,
            "identity_symbol": work_item.identity_symbol,
            "demand_provenance": self.identity["demand_provenance"],
            "completed_at": _now(),
            "proposal": run.proposals[0].as_json(),
            "attempted_accessions": [
                {
                    "member_symbol": member,
                    "identity_symbol": identity,
                    "accessions": list(accessions),
                }
                for member, identity, accessions in run.attempted_accessions
            ],
        }
        _atomic_write_json(self.item_path(order), payload)
        return payload

    def read_item(self, order: int, work_item) -> dict | None:
        """완료된 항목을 **검증하고** 읽는다. 파일이 있다는 것만으로 건너뛰지 않는다.

        없으면 `None`. 있는데 조금이라도 어긋나면 예외다 — 조용히 다시 돌리면
        손상된 체크포인트가 정상 결과인 척한다.

        **같은 작업 항목이 둘일 수는 없다.** 항목 파일은 순번으로 열고 그 순번의
        작업 항목 키와 정확히 같기를 요구하는데 작업 항목 키는 서로 다르다 —
        중복은 여기서 키 불일치로 먼저 걸린다.
        """
        path = self.item_path(order)
        if not path.exists():
            return None
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except Exception as error:  # noqa: BLE001
            raise CheckpointError(f"체크포인트 항목이 JSON이 아닙니다: {path} — {error}") from error
        if not isinstance(payload, dict):
            raise CheckpointError(f"체크포인트 항목이 객체가 아닙니다: {path}")
        if payload.get("checkpoint_schema") != CHECKPOINT_SCHEMA:
            raise CheckpointError(f"체크포인트 항목 schema가 다릅니다: {path}")
        if payload.get("run_identity_sha256") != self.digest:
            raise CheckpointError(
                f"체크포인트 항목이 다른 실행의 것입니다: {path}"
            )
        if payload.get("demand_provenance") != self.identity["demand_provenance"]:
            raise CheckpointError(f"체크포인트 항목의 수요 provenance가 다릅니다: {path}")
        key = (payload.get("member_symbol"), payload.get("identity_symbol"))
        if key != work_item.key:
            raise CheckpointError(
                f"체크포인트 항목의 작업 항목이 다릅니다: {path} — "
                f"{key} != {work_item.key}"
            )
        proposal = payload.get("proposal")
        if not isinstance(proposal, dict):
            raise CheckpointError(f"체크포인트 항목에 proposal이 없습니다: {path}")
        if (
            proposal.get("member_symbol"),
            proposal.get("identity_symbol"),
        ) != work_item.key:
            raise CheckpointError(
                f"체크포인트 항목의 proposal 키가 다릅니다: {path}"
            )
        return payload

    # ── session receipt ──────────────────────────────────────────────────
    def start_session(self, *, first_order: int | None) -> Path:
        """**시작할 때 RUNNING으로 적는다.** 급사하면 그 표식이 그대로 남아

        "이 session의 SEC 호출 수는 알 수 없다"가 사후에도 읽힌다.
        """
        self.sessions_dir.mkdir(parents=True, exist_ok=True)
        path = self.sessions_dir / f"{time.strftime('%Y%m%dT%H%M%S')}-{os.getpid()}.json"
        _atomic_write_json(
            path,
            {
                "checkpoint_schema": CHECKPOINT_SCHEMA,
                "run_identity_sha256": self.digest,
                "pid": os.getpid(),
                "status": SESSION_RUNNING,
                "started_at": _now(),
                "first_attempted_order": first_order,
                "sec_calls": CALLS_UNKNOWN,
            },
        )
        return path

    def finish_session(self, path: Path, payload: dict) -> None:
        _atomic_write_json(path, payload)

    def session_receipts(self) -> list[dict]:
        found = []
        if not self.sessions_dir.exists():
            return found
        for path in sorted(self.sessions_dir.glob("*.json")):
            try:
                found.append(json.loads(path.read_text(encoding="utf-8")))
            except Exception:  # noqa: BLE001 — receipt는 진단이지 증거가 아니다
                continue
        return found

    def observed_sec_calls(self) -> int | str:
        """완료된 session receipt의 합. **급사한 session이 있으면 `unknown`이다.**"""
        total = 0
        for receipt in self.session_receipts():
            calls = receipt.get("sec_calls")
            if not isinstance(calls, int):
                return CALLS_UNKNOWN
            total += calls
        return total


def assemble_proposal_run(
    selected: DemandInput, hints, completed: list[dict]
) -> dict:
    """완료된 항목들을 **기존 5A-2 산출물 계약 그대로** 하나로 조립한다.

    정적·provenance 칸은 빈 `ProposalRun.as_json()`에서 그대로 받아 계약이 갈리지
    않게 하고, 항목에 따라 달라지는 칸만 완료 항목에서 다시 센다. 제안 순서는
    선택된 수요 순서다.
    """
    skeleton = ProposalRun(
        demand_input=selected, proposals=(), attempted_accessions=(), hints=hints
    ).as_json()
    proposals = [entry["proposal"] for entry in completed]

    counts = {AUTO_PROVABLE: 0, REVIEW_REQUIRED: 0, UNRESOLVED: 0}
    for proposal in proposals:
        counts[proposal["proposal_status"]] += 1

    reasons: dict[str, int] = {}
    origins: dict[str, int] = {}
    for proposal in proposals:
        for code in proposal["reason_codes"]:
            reasons[code] = reasons.get(code, 0) + 1
        for candidate in proposal["discovery_candidates"]:
            origins[candidate["origin"]] = origins.get(candidate["origin"], 0) + 1

    payload = dict(skeleton)
    payload["counts"] = counts
    payload["reason_counts"] = dict(sorted(reasons.items()))
    payload["discovery_origin_counts"] = dict(sorted(origins.items()))
    payload["attempted_accessions"] = [
        entry for item in completed for entry in item["attempted_accessions"]
    ]
    payload["proposals"] = proposals
    return payload


def _print_legal(item) -> None:
    """법적 증거 receipt를 한 줄씩 보인다. **없으면 아무것도 찍지 않는다.**"""
    legal = item.legal_evidence_proof
    if not legal:
        return
    print(
        f"      legal search={legal['search_status']}"
        f" accessions={len(legal['searched_accessions'])}"
        f" outside_horizon={legal['accessions_outside_horizon']}"
        f" documents={len(legal['documents'])}"
        f" failures={len(legal['failures'])}"
    )
    for entry in legal["classes"]:
        print(
            f"      {entry['member_key']:34s} {entry['status']:11s}"
            f" birth={entry['birth_date'] or '-'}"
            f" end={entry['termination_date'] or ('null' if entry['open_ended'] else '-')}"
            f" snapshot={entry['snapshot_accession'] or '-'}"
            f" findings={len(entry['findings'])}"
        )
        for note in entry["notes"]:
            print(f"        - {note}")


def _print_provenance(demand_input: DemandInput) -> None:
    for key, value in demand_input.provenance_json().items():
        print(f"  {key}: {value}")


def stage_demand(arguments) -> int:
    demand_input = read_mapping_demand(arguments.inventory)
    print("5A-1 provenance:")
    _print_provenance(demand_input)
    items = demand_input.work_items
    reused = [item for item in items if item.symbol_bridge_kind != "DIRECT"]
    print(f"5A-1 mapping demand work items: {len(items)}")
    print(f"  reused vendor series: {len(reused)}")
    print(
        "  unique economic identity symbols: "
        + str(len({item.identity_symbol for item in items}))
    )
    for item in items[: arguments.limit or 20]:
        print(
            f"  {item.member_symbol:10s} -> {item.identity_symbol:10s}"
            f" {item.symbol_bridge_kind:22s}"
            f" formations={len(item.formation_sessions)}"
            f" first={item.formation_sessions[0]}"
        )
    return 0


def stage_run_checkpointed(arguments) -> int:
    """작업 항목 하나 단위로 durable하게 도는 실행 모드.

    **한 항목이 끝나면 다음 항목을 시작하기 전에 그 결과가 디스크에 남는다.** 전송
    실패로 죽었을 때 잃는 것은 그때 돌던 항목 하나뿐이고, 이미 끝난 항목은
    `--resume`이 검증한 뒤 건너뛴다.

    **전송 실패는 실패로 끝난다.** 의미 상태로 바꿔 적지 않고, 자동 재시도도 없고,
    `N+1`로 넘어가지도 않는다 — 종료 코드가 0이 아니다.
    """
    demand_input = read_mapping_demand(arguments.inventory)
    selected = _select(demand_input, arguments)
    work_items = selected.work_items

    identity = run_identity(
        selected, arguments, inventory_digest=_sha256_file(Path(arguments.inventory))
    )
    checkpoint = Checkpoint(Path(arguments.checkpoint_dir), identity)
    if arguments.resume:
        checkpoint.open_existing()
    else:
        checkpoint.create()

    # 이미 끝난 항목을 **검증하면서** 읽는다. 손상·불일치·중복은 전부 fail-close다.
    completed: dict[int, dict] = {}
    for order, work_item in enumerate(work_items):
        found = checkpoint.read_item(order, work_item)
        if found is not None:
            completed[order] = found
    pending = [order for order in range(len(work_items)) if order not in completed]

    print(f"checkpoint: {checkpoint.directory}")
    print(f"  run identity {checkpoint.digest}")
    print(f"  work items {len(work_items)}  완료 {len(completed)}  남은 {len(pending)}")

    hints = None
    session_path = None
    client = None
    started = time.monotonic()
    last_completed: int | None = None
    if pending:
        hints = build_hints(selected, arguments.data_dir) if arguments.historical else None
        client = EdgarClient(arguments.contact) if arguments.contact else EdgarClient()
        session_path = checkpoint.start_session(first_order=pending[0])
        companies = client.ticker_map()
        # **40MB 이름 색인은 프로세스당 한 번이다.** 항목마다 `run_proposals`를 부르므로
        # 여기서 만들어 넘기지 않으면 항목마다 다시 내려받는다.
        name_index = client.cik_lookup() if arguments.historical else None

        for order in pending:
            work_item = work_items[order]
            single = selected.select(
                [f"{work_item.member_symbol}/{work_item.identity_symbol}"]
            )
            try:
                one = run_proposals(
                    client,
                    single,
                    companies=companies,
                    use_browse=arguments.browse,
                    hints=hints,
                    name_index=name_index,
                    legal_evidence=arguments.legal_evidence,
                )
            except Exception as error:  # noqa: BLE001 — 전송 실패는 증거가 아니다
                checkpoint.finish_session(
                    session_path,
                    {
                        "checkpoint_schema": CHECKPOINT_SCHEMA,
                        "run_identity_sha256": checkpoint.digest,
                        "pid": os.getpid(),
                        "status": SESSION_FAILED,
                        "started_at": _now(),
                        "ended_at": _now(),
                        "first_attempted_order": pending[0],
                        "last_completed_order": last_completed,
                        "failed_order": order,
                        "failed_work_item": list(work_item.key),
                        "error_type": type(error).__name__,
                        "error_message": str(error),
                        "sec_calls": getattr(client, "calls", CALLS_UNKNOWN),
                        "elapsed_seconds": round(time.monotonic() - started, 1),
                        "durable_completed_items": len(completed),
                    },
                )
                print(
                    f"FAILED at work item {order + 1}/{len(work_items)}"
                    f" {work_item.member_symbol}/{work_item.identity_symbol}",
                    file=sys.stderr,
                )
                print(f"  {type(error).__name__}: {error}", file=sys.stderr)
                print(
                    f"  이미 끝난 {len(completed)}개 항목은 남아 있습니다 —"
                    " 같은 명령에 --resume을 붙여 이어서 돌리세요",
                    file=sys.stderr,
                )
                return 1
            completed[order] = checkpoint.write_item(order, work_item, one)
            last_completed = order

        checkpoint.finish_session(
            session_path,
            {
                "checkpoint_schema": CHECKPOINT_SCHEMA,
                "run_identity_sha256": checkpoint.digest,
                "pid": os.getpid(),
                "status": SESSION_COMPLETE,
                "started_at": _now(),
                "ended_at": _now(),
                "first_attempted_order": pending[0],
                "last_completed_order": last_completed,
                "failed_order": None,
                "sec_calls": getattr(client, "calls", CALLS_UNKNOWN),
                "elapsed_seconds": round(time.monotonic() - started, 1),
                "durable_completed_items": len(completed),
            },
        )

    # **마지막 방어선이다.** 위 루프가 옳으면 여기 걸릴 것이 없지만, 불완전한 5A-2
    # 산출물은 승격기가 그대로 받아들이므로 쓰기 직전에 한 번 더 확인한다.
    missing = [order for order in range(len(work_items)) if order not in completed]
    if missing:
        raise CheckpointError(
            f"완료되지 않은 작업 항목이 {len(missing)}개 남아 최종 산출물을 쓰지 않습니다"
        )

    ordered = [completed[order] for order in range(len(work_items))]
    if hints is None and arguments.historical:
        # 전부 이미 끝나 있어 이번 프로세스가 아무것도 돌리지 않은 경우다. 산출물의
        # `discovery_hints`는 그대로 남아야 하므로 여기서 만든다.
        hints = build_hints(selected, arguments.data_dir)
    payload = assemble_proposal_run(selected, hints, ordered)
    payload["git_commit"] = _git_commit()
    payload["sec_calls"] = checkpoint.observed_sec_calls()
    payload["checkpoint_dir"] = str(checkpoint.directory)
    payload["run_identity_sha256"] = checkpoint.digest

    if arguments.out:
        Path(arguments.out).write_text(
            json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        print(f"wrote {arguments.out}")

    print("5A-1 provenance:")
    _print_provenance(selected)
    print("stage: 5A-2 proposals — production manifest는 바뀌지 않았다")
    counts = payload["counts"]
    print(
        f"{AUTO_PROVABLE}={counts[AUTO_PROVABLE]}"
        f"  {REVIEW_REQUIRED}={counts[REVIEW_REQUIRED]}"
        f"  {UNRESOLVED}={counts[UNRESOLVED]}"
    )
    print(f"SEC calls observed across sessions: {payload['sec_calls']}")
    return 0


def stage_run(arguments) -> int:
    demand_input = read_mapping_demand(arguments.inventory)
    selected = _select(demand_input, arguments)
    hints = build_hints(selected, arguments.data_dir) if arguments.historical else None
    client = EdgarClient(arguments.contact) if arguments.contact else EdgarClient()
    companies = client.ticker_map()
    run = run_proposals(
        client,
        selected,
        companies=companies,
        use_browse=arguments.browse,
        hints=hints,
        legal_evidence=arguments.legal_evidence,
    )
    payload = run.as_json()
    payload["git_commit"] = _git_commit()
    payload["sec_calls"] = client.calls
    if arguments.out:
        Path(arguments.out).write_text(
            json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        print(f"wrote {arguments.out}")

    print("5A-1 provenance:")
    _print_provenance(selected)
    print("stage: 5A-2 proposals — production manifest는 바뀌지 않았다")
    if hints is not None:
        print(f"discovery hints: {hints.source}/{hints.source_version} — {hints.provenance}")
    counts = run.counts()
    print(
        f"{AUTO_PROVABLE}={counts[AUTO_PROVABLE]}"
        f"  {REVIEW_REQUIRED}={counts[REVIEW_REQUIRED]}"
        f"  {UNRESOLVED}={counts[UNRESOLVED]}"
    )
    for item in run.proposals:
        origins = ",".join(sorted({c.origin for c in item.discovery_candidates})) or "-"
        bridged = (
            f"{item.member_symbol}->{item.identity_symbol}"
            if item.member_symbol != item.identity_symbol
            else item.identity_symbol
        )
        print(
            f"  {bridged:18s} {item.proposal_status:16s}"
            f" cik={item.selected_cik or '-'}"
            f" classes={len(item.share_class_proposals)}"
            f" origins={origins}"
            f" reasons={','.join(item.reason_codes) or '-'}"
        )
        _print_legal(item)
    print(f"SEC calls: {client.calls}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="stage", required=True)
    lister = sub.add_parser("demand")
    lister.add_argument("--inventory", required=True)
    lister.add_argument("--limit", type=int, default=None)
    runner = sub.add_parser("run")
    runner.add_argument("--inventory", required=True)
    runner.add_argument("--symbols", default=None)
    runner.add_argument("--limit", type=int, default=None)
    runner.add_argument("--browse", action="store_true")
    runner.add_argument("--historical", action="store_true")
    runner.add_argument("--legal-evidence", action="store_true")
    runner.add_argument("--data-dir", default=None)
    runner.add_argument("--contact", default=None)
    runner.add_argument("--out", default=None)
    # **체크포인트는 명시로만 켠다.** 기존 작은 pilot 실행의 동작을 바꾸지 않는다.
    # 단위는 작업 항목 하나로 고정이고 chunk 크기 조절 손잡이를 만들지 않는다.
    runner.add_argument("--checkpoint-dir", default=None)
    runner.add_argument("--resume", action="store_true")
    arguments = parser.parse_args()
    if arguments.stage == "demand":
        return stage_demand(arguments)
    if arguments.resume and not arguments.checkpoint_dir:
        raise SystemExit("--resume에는 --checkpoint-dir이 필요합니다")
    try:
        if arguments.checkpoint_dir:
            return stage_run_checkpointed(arguments)
        return stage_run(arguments)
    except CheckpointError as error:
        print(f"체크포인트 fail-close: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
