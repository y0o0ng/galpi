"""백테스트 전용 저장소.

연구 데이터는 PAPER 운영 DB와 같은 파일에 두지 않는다. 백테스트는 15년치 바를
넣고 지우는 일이 잦고, PAPER DB는 온라인 백업과 재부팅 복구의 정본이다.
`paper/db.py`와 같은 이름 검사를 하되 서로를 import하지 않는다. 두 목록이 벌어지는
것은 테스트가 잡는다.
"""

from __future__ import annotations

import sqlite3
from pathlib import Path

BACKTEST_DB_NAME = "backtest.db"
DEFAULT_DATA_DIR = Path(__file__).resolve().parents[1] / "data"
SCHEMA_PATH = Path(__file__).resolve().parent / "schema.sql"

# 갈피 본체·실전 저장소·PAPER 운영 DB. 이 중 하나로 해석되면 사고다.
FORBIDDEN_DB_NAMES = frozenset(
    {"galpi.db", "council.db", "trading-live.db", "trading-paper.db"}
)


class BacktestStorageError(Exception):
    """저장소 경로가 격리 계약을 벗어날 때 올린다."""


def resolve_backtest_db_path(data_dir: Path | str = DEFAULT_DATA_DIR) -> Path:
    """백테스트 DB 경로를 만들고 격리 계약을 확인한다."""
    resolved_dir = Path(data_dir).expanduser().resolve()
    path = resolved_dir / BACKTEST_DB_NAME

    if path.name in FORBIDDEN_DB_NAMES:
        raise BacktestStorageError(f"백테스트가 열 수 없는 저장소입니다: {path.name}")
    if path.name != BACKTEST_DB_NAME:
        raise BacktestStorageError(f"백테스트 저장소 이름이 아닙니다: {path.name}")
    parts = {part.lower() for part in resolved_dir.parts}
    if "live" in parts or "trading-live" in parts:
        raise BacktestStorageError(
            f"실전 경로 안에는 백테스트 저장소를 둘 수 없습니다: {resolved_dir}"
        )
    return path


# 나중에 추가된 열. `CREATE TABLE IF NOT EXISTS`는 이미 있는 표를 건드리지 않으므로
# 기존 DB에는 손으로 붙여야 한다. **DB를 지우고 다시 만들 수는 없다** — `bars_daily`는
# 908회 호출로 받은 3.8M행이고 삭제 의무가 걸려 있다.
#
# 마이그레이션 틀을 만들지 않고 목록 하나로 두는 이유는 지금 필요한 것이 이것뿐이기
# 때문이다. 전부 nullable이라 옛 행은 NULL로 남고, 그것이 "그 실행은 이 값을 기록하지
# 않았다"는 사실 그대로다.
LATE_COLUMNS = (("backtest_equity", "market_regime", "TEXT"),)

_QV_FILINGS_TABLE_START = "CREATE TABLE IF NOT EXISTS qv_sec_filings ("
_QV_FILINGS_TABLE_END = ") WITHOUT ROWID;"
_QV_FILINGS_EASTERN_COLUMN = """  acceptance_eastern_date TEXT
    CHECK (acceptance_eastern_date IS NULL OR acceptance_eastern_date GLOB
      '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
"""
_QV_FILINGS_EASTERN_NULL_CHECK = (
    "  CHECK ((acceptance_datetime IS NULL) = (acceptance_eastern_date IS NULL)),\n"
)
_QV_FILINGS_CURRENT_BOUNDARY_CHECK = """  CHECK (historical_usable_session IS NULL OR
    historical_usable_session > acceptance_eastern_date),
"""
_QV_FILINGS_CA801B0_BOUNDARY_CHECK = """  CHECK (historical_usable_session IS NULL OR
    historical_usable_session > substr(acceptance_datetime, 1, 10)),
"""
_QV_FILINGS_CA801B0_COLUMNS = (
    "cik",
    "accession",
    "form",
    "filed_date",
    "report_date",
    "acceptance_datetime",
    "historical_usable_session",
    "filing_sic",
    "sic_status",
    "primary_document",
    "submissions_file",
    "calendar_source",
    "calendar_source_version",
    "source",
    "source_version",
    "provenance",
    "ingested_at",
)


def add_missing_columns(connection: sqlite3.Connection) -> list[str]:
    """`LATE_COLUMNS` 중 없는 것만 붙인다. 몇 번 불러도 같다."""
    added = []
    for table, column, kind in LATE_COLUMNS:
        existing = {
            row["name"]
            for row in connection.execute(f"PRAGMA table_info({table})")
        }
        if existing and column not in existing:
            connection.execute(f"ALTER TABLE {table} ADD COLUMN {column} {kind}")
            added.append(f"{table}.{column}")
    if added:
        connection.commit()
    return added


def _normalized_table_sql(sql: str) -> str:
    normalized = " ".join(sql.split()).casefold().rstrip(";")
    return normalized.replace("create table if not exists", "create table", 1)


def _qv_filings_ddls(schema_sql: str) -> tuple[str, str]:
    """현재 DDL과 바로 전 ca801b0 DDL만 결정론적으로 구성한다."""
    start = schema_sql.find(_QV_FILINGS_TABLE_START)
    if start < 0:
        raise BacktestStorageError("schema.sql에 qv_sec_filings DDL이 없습니다")
    end = schema_sql.find(_QV_FILINGS_TABLE_END, start)
    if end < 0:
        raise BacktestStorageError("schema.sql의 qv_sec_filings DDL이 끝나지 않았습니다")
    end += len(_QV_FILINGS_TABLE_END)
    current = schema_sql[start:end]

    expected_once = (
        _QV_FILINGS_EASTERN_COLUMN,
        _QV_FILINGS_EASTERN_NULL_CHECK,
        _QV_FILINGS_CURRENT_BOUNDARY_CHECK,
    )
    if any(current.count(fragment) != 1 for fragment in expected_once):
        raise BacktestStorageError(
            "현재 qv_sec_filings DDL에서 Eastern migration 경계를 확인할 수 없습니다"
        )
    ca801b0 = current.replace(_QV_FILINGS_EASTERN_COLUMN, "", 1)
    ca801b0 = ca801b0.replace(_QV_FILINGS_EASTERN_NULL_CHECK, "", 1)
    ca801b0 = ca801b0.replace(
        _QV_FILINGS_CURRENT_BOUNDARY_CHECK,
        _QV_FILINGS_CA801B0_BOUNDARY_CHECK,
        1,
    )
    return current, ca801b0


def _upgrade_ca801b0_qv_sec_filings(
    connection: sqlite3.Connection, schema_sql: str
) -> bool:
    """ca801b0의 QV filing 표만 현재 Eastern-date 표현으로 원자적 수리한다."""
    table = connection.execute(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?",
        ("qv_sec_filings",),
    ).fetchone()
    if table is None:
        return False

    current_ddl, ca801b0_ddl = _qv_filings_ddls(schema_sql)
    actual = _normalized_table_sql(table["sql"])
    if actual == _normalized_table_sql(current_ddl):
        return False
    if actual != _normalized_table_sql(ca801b0_ddl):
        raise BacktestStorageError(
            "알 수 없는 qv_sec_filings schema라 자동 migration하지 않습니다"
        )
    if connection.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
        ("qv_sec_filings_ca801b0",),
    ).fetchone():
        raise BacktestStorageError(
            "qv_sec_filings_ca801b0 임시 표가 이미 있어 migration하지 않습니다"
        )

    # ingestion과 서로 다른 시간대 규칙을 만들지 않기 위해 같은 구현을 재사용한다.
    from .qv_submissions import (  # noqa: PLC0415
        _acceptance_eastern_date,
        _historical_usable_session,
    )

    insert_columns = (
        "cik",
        "accession",
        "form",
        "filed_date",
        "report_date",
        "acceptance_datetime",
        "acceptance_eastern_date",
        "historical_usable_session",
        "filing_sic",
        "sic_status",
        "primary_document",
        "submissions_file",
        "calendar_source",
        "calendar_source_version",
        "source",
        "source_version",
        "provenance",
        "ingested_at",
    )
    try:
        connection.execute("BEGIN IMMEDIATE")
        old_rows = connection.execute(
            f"SELECT {', '.join(_QV_FILINGS_CA801B0_COLUMNS)}"
            " FROM qv_sec_filings"
        ).fetchall()
        repaired_rows = []
        for row in old_rows:
            eastern_date = _acceptance_eastern_date(row["acceptance_datetime"])
            usable_session = _historical_usable_session(
                connection,
                eastern_date,
                row["calendar_source"],
                row["calendar_source_version"],
            )
            repaired_rows.append(
                tuple(
                    eastern_date
                    if column == "acceptance_eastern_date"
                    else usable_session
                    if column == "historical_usable_session"
                    else row[column]
                    for column in insert_columns
                )
            )

        connection.execute(
            "ALTER TABLE qv_sec_filings RENAME TO qv_sec_filings_ca801b0"
        )
        connection.execute("DROP INDEX IF EXISTS idx_qv_sec_filings_usable")
        connection.execute(
            current_ddl.replace(
                "CREATE TABLE IF NOT EXISTS", "CREATE TABLE", 1
            )
        )
        connection.executemany(
            f"INSERT INTO qv_sec_filings ({', '.join(insert_columns)})"
            f" VALUES ({', '.join('?' for _ in insert_columns)})",
            repaired_rows,
        )
        connection.execute("DROP TABLE qv_sec_filings_ca801b0")
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    return True


# ── QV Step 4 identity/valuation migration ────────────────────────────────────
# 알려진 legacy 스키마 하나만 인식한다. 범용 migration 틀을 만들지 않는다.
# 정책은 "비어 있을 때만 재구축"이다. 행이 하나라도 있으면 추론·변환하지 않고 멈춘다.
_STEP4_LEGACY_TABLES = ("qv_share_classes", "qv_class_valuation")
_STEP4_RETIRED_TABLES = ("qv_class_valuation",)
_STEP4_NEW_TABLES = (
    "qv_share_classes",
    "qv_share_class_xbrl_aliases",
    "qv_share_class_prose_aliases",
    "qv_identity_evidence",
    "qv_class_conversion_relations",
    "qv_class_valuation_resolutions",
)
_STEP4_LEGACY_SHARE_CLASSES_DDL = """CREATE TABLE IF NOT EXISTS qv_share_classes (
  class_id TEXT NOT NULL,
  issuer_id TEXT NOT NULL,
  symbol TEXT,
  xbrl_axis TEXT,
  xbrl_member TEXT,
  is_ordinary_common INTEGER NOT NULL CHECK (is_ordinary_common IN (0, 1)),
  is_listed INTEGER NOT NULL CHECK (is_listed IN (0, 1)),
  effective_from TEXT NOT NULL
    CHECK (effective_from GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  effective_to TEXT
    CHECK (effective_to IS NULL OR effective_to GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  source TEXT NOT NULL,
  source_version TEXT NOT NULL,
  provenance TEXT NOT NULL CHECK (length(trim(provenance)) > 0),
  PRIMARY KEY (class_id, effective_from, source_version),
  FOREIGN KEY (issuer_id, source_version)
    REFERENCES qv_issuers(issuer_id, source_version),
  CHECK (effective_to IS NULL OR effective_to > effective_from),
  CHECK ((xbrl_axis IS NULL) = (xbrl_member IS NULL)),
  CHECK (is_listed = 0 OR symbol IS NOT NULL)
) WITHOUT ROWID;"""


def _table_sql(connection: sqlite3.Connection, name: str) -> str | None:
    row = connection.execute(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?", (name,)
    ).fetchone()
    return row["sql"] if row is not None else None


def _schema_table_ddl(
    schema_sql: str, name: str, end_marker: str = ") WITHOUT ROWID;"
) -> str:
    start = schema_sql.find(f"CREATE TABLE IF NOT EXISTS {name} (")
    if start < 0:
        raise BacktestStorageError(f"schema.sql에 {name} DDL이 없습니다")
    end = schema_sql.find(end_marker, start)
    if end < 0:
        raise BacktestStorageError(f"schema.sql의 {name} DDL이 끝나지 않았습니다")
    return schema_sql[start : end + len(end_marker)]


def _row_count(connection: sqlite3.Connection, name: str) -> int:
    return int(connection.execute(f"SELECT count(*) AS n FROM {name}").fetchone()["n"])


def _migrate_step4_identity(
    connection: sqlite3.Connection, schema_sql: str
) -> bool:
    """legacy identity/valuation 표를 Step-4 스키마로 원자적 재구축한다.

    행이 하나라도 있으면 `BacktestStorageError`로 멈추고 아무것도 바꾸지 않는다.
    알 수 없는 스키마도 fail-close다. bars_daily 등 무관한 표는 건드리지 않는다.
    """
    legacy_sc = _table_sql(connection, "qv_share_classes")
    if legacy_sc is None:
        return False  # 새 DB. executescript가 그대로 만든다.

    target_sc = _schema_table_ddl(schema_sql, "qv_share_classes")
    if _normalized_table_sql(legacy_sc) == _normalized_table_sql(target_sc):
        return False  # 이미 새 스키마다.

    if _normalized_table_sql(legacy_sc) != _normalized_table_sql(
        _STEP4_LEGACY_SHARE_CLASSES_DDL
    ):
        raise BacktestStorageError(
            "알 수 없는 qv_share_classes schema라 Step-4 migration을 하지 않습니다"
        )

    present = [
        name for name in _STEP4_LEGACY_TABLES if _table_sql(connection, name) is not None
    ]
    nonempty = {name: _row_count(connection, name) for name in present}
    nonempty = {name: n for name, n in nonempty.items() if n}
    if nonempty:
        detail = ", ".join(f"{name}={n}" for name, n in sorted(nonempty.items()))
        raise BacktestStorageError(
            "legacy QV identity/valuation 표에 행이 있어 Step-4 migration을 하지 않습니다: "
            f"{detail}"
        )

    try:
        connection.execute("BEGIN IMMEDIATE")
        connection.execute("DROP INDEX IF EXISTS idx_qv_share_classes_member")
        connection.execute("DROP INDEX IF EXISTS idx_qv_share_classes_symbol")
        connection.execute("DROP INDEX IF EXISTS idx_qv_class_valuation_active")
        for name in _STEP4_RETIRED_TABLES:
            connection.execute(f"DROP TABLE IF EXISTS {name}")
        connection.execute("DROP TABLE qv_share_classes")
        connection.execute(
            target_sc.replace("CREATE TABLE IF NOT EXISTS", "CREATE TABLE", 1)
        )
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    return True


# Step-4 표는 새로 도입된 것이라 아직 production 행이 없다. DDL이 바뀌면 **비어 있을
# 때만** 같은 fail-close 정책으로 다시 만든다. 무관한 표를 위한 범용 틀은 만들지 않는다.
_STEP4_REBUILDABLE_TABLES = (
    "qv_issuers",
    "qv_class_valuation_resolutions",
    "qv_class_share_resolutions",
    "qv_class_market_equity",
    "qv_issuer_market_equity",
    "qv_share_observations",
    "qv_share_basis_searches",
    "qv_share_basis_candidates",
    "qv_share_basis_class_effects",
    "qv_class_conversion_relations",
    "qv_xbrl_class_bindings",
)


# ── typed document locator migration (증거 두 표) ─────────────────────────────
#
# 이 변경은 **행을 보존할 수 있는 알려진 migration**이다. 기존 evidence 행의
# `document_name`은 새 계약에서도 그대로 file locator이고 `document_sequence`만
# NULL로 붙는다. 그래서 두 표는 위의 "비어 있을 때만 재구축"에 맡기지 않는다.
#
# ```text
# 알려진 정확한 옛 스키마  -> 원자적 migration · 모든 행 보존 · sequence = NULL
# 이미 새 스키마          -> no-op
# 알 수 없는 스키마       -> BacktestStorageError · 아무것도 바꾸지 않는다
# ```
#
# **의미 추론이 없다.** 범용 migration 틀도 만들지 않는다.
_EVIDENCE_LOCATOR_PRE_SUFFIX = "_pre_locator"
_EVIDENCE_LOCATOR_TABLE_END = {
    "qv_identity_evidence": ") WITHOUT ROWID;",
    # 새 증거 문서 표는 locator 종류마다 부분 유일 인덱스를 쓰므로 rowid 표다.
    "qv_sec_evidence_documents": "\n);",
}
_EVIDENCE_LOCATOR_INDEXES = {
    "qv_identity_evidence": (),
    "qv_sec_evidence_documents": ("idx_qv_evidence_documents_usable",),
}
# 옛 행이 그대로 옮겨지는 컬럼들. `document_sequence`는 여기 없으므로 NULL로 남는다.
_EVIDENCE_LOCATOR_COLUMNS = {
    "qv_identity_evidence": (
        "relation_kind", "relation_key", "evidence_ordinal", "source_kind", "cik",
        "accession", "document_name", "evidence_role", "locator", "dependency",
        "resolved_usable_session", "source", "source_version", "provenance",
    ),
    "qv_sec_evidence_documents": (
        "cik", "accession", "document_name", "form", "document_role",
        "acceptance_datetime", "acceptance_eastern_date", "historical_usable_session",
        "source_url", "document_sha256", "calendar_source", "calendar_source_version",
        "source", "source_version", "provenance",
    ),
}

# 알려진 옛 DDL. `qv_identity_evidence`는 `ISSUER` 어휘가 붙기 전 4c79a74 모양도 같은
# 표라 둘 다 인식한다 — 그 차이는 relation_kind 어휘 한 줄이고 locator와 무관하다.
_OLD_IDENTITY_EVIDENCE_DDL = """CREATE TABLE IF NOT EXISTS qv_identity_evidence (
  relation_kind TEXT NOT NULL CHECK (relation_kind IN (
    'ISSUER', 'SHARE_CLASS', 'XBRL_ALIAS', 'PROSE_ALIAS', 'CONVERSION_RELATION')),
  relation_key TEXT NOT NULL CHECK (length(trim(relation_key)) > 0),
  evidence_ordinal INTEGER NOT NULL CHECK (evidence_ordinal >= 0),
  source_kind TEXT NOT NULL CHECK (source_kind IN ('KQ_FILING', 'SEC_EVIDENCE_DOCUMENT')),
  cik TEXT NOT NULL CHECK (length(cik) = 10 AND cik NOT GLOB '*[^0-9]*'),
  accession TEXT NOT NULL CHECK (length(trim(accession)) > 0),
  document_name TEXT NOT NULL CHECK (length(trim(document_name)) > 0),
  evidence_role TEXT NOT NULL CHECK (length(trim(evidence_role)) > 0),
  locator TEXT,
  dependency TEXT NOT NULL CHECK (dependency IN ('REQUIRED', 'CORROBORATING')),
  resolved_usable_session TEXT
    CHECK (resolved_usable_session IS NULL OR resolved_usable_session GLOB
      '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  source TEXT NOT NULL,
  source_version TEXT NOT NULL,
  provenance TEXT NOT NULL CHECK (length(trim(provenance)) > 0),
  PRIMARY KEY (relation_kind, relation_key, evidence_ordinal, source_version)
) WITHOUT ROWID;"""
_OLD_EVIDENCE_DOCUMENTS_DDL = """CREATE TABLE IF NOT EXISTS qv_sec_evidence_documents (
  cik TEXT NOT NULL CHECK (length(cik) = 10 AND cik NOT GLOB '*[^0-9]*'),
  accession TEXT NOT NULL CHECK (length(trim(accession)) > 0),
  document_name TEXT NOT NULL CHECK (length(trim(document_name)) > 0),
  form TEXT NOT NULL CHECK (length(trim(form)) > 0),
  document_role TEXT NOT NULL CHECK (document_role IN ('PRIMARY', 'EXHIBIT')),
  acceptance_datetime TEXT NOT NULL
    CHECK (acceptance_datetime GLOB
      '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9][0-9][0-9][0-9]Z'),
  acceptance_eastern_date TEXT NOT NULL
    CHECK (acceptance_eastern_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  historical_usable_session TEXT NOT NULL
    CHECK (historical_usable_session GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  source_url TEXT NOT NULL CHECK (length(trim(source_url)) > 0),
  document_sha256 TEXT NOT NULL CHECK (length(document_sha256) = 64),
  calendar_source TEXT NOT NULL,
  calendar_source_version TEXT NOT NULL,
  source TEXT NOT NULL,
  source_version TEXT NOT NULL,
  provenance TEXT NOT NULL CHECK (length(trim(provenance)) > 0),
  PRIMARY KEY (cik, accession, document_name, source_version),
  CHECK (historical_usable_session > acceptance_eastern_date)
) WITHOUT ROWID;"""
_EVIDENCE_LOCATOR_OLD_DDLS = {
    "qv_identity_evidence": (
        _OLD_IDENTITY_EVIDENCE_DDL,
        _OLD_IDENTITY_EVIDENCE_DDL.replace(
            "'ISSUER', 'SHARE_CLASS'", "'SHARE_CLASS'", 1
        ),
    ),
    "qv_sec_evidence_documents": (_OLD_EVIDENCE_DOCUMENTS_DDL,),
}


def _migrate_evidence_locators(
    connection: sqlite3.Connection, schema_sql: str
) -> list[str]:
    """증거 두 표를 typed locator 스키마로 옮긴다. **기존 행을 전부 보존한다.**"""
    pending: list[tuple[str, str]] = []
    for name in ("qv_identity_evidence", "qv_sec_evidence_documents"):
        existing = _table_sql(connection, name)
        if existing is None:
            continue  # 새 DB. executescript가 그대로 만든다.
        target = _schema_table_ddl(schema_sql, name, _EVIDENCE_LOCATOR_TABLE_END[name])
        if _normalized_table_sql(existing) == _normalized_table_sql(target):
            continue
        known = {
            _normalized_table_sql(ddl) for ddl in _EVIDENCE_LOCATOR_OLD_DDLS[name]
        }
        if _normalized_table_sql(existing) not in known:
            raise BacktestStorageError(
                f"알 수 없는 {name} schema라 locator migration을 하지 않습니다"
            )
        if _table_sql(connection, name + _EVIDENCE_LOCATOR_PRE_SUFFIX) is not None:
            raise BacktestStorageError(
                f"{name}{_EVIDENCE_LOCATOR_PRE_SUFFIX} 임시 표가 이미 있어 "
                "migration하지 않습니다"
            )
        pending.append((name, target))
    if not pending:
        return []

    # 두 표의 계약 상승은 한 transaction에서 끝난다. 중간 상태를 남기지 않는다.
    try:
        connection.execute("BEGIN IMMEDIATE")
        for name, target in pending:
            columns = ", ".join(_EVIDENCE_LOCATOR_COLUMNS[name])
            temporary = name + _EVIDENCE_LOCATOR_PRE_SUFFIX
            for index in _EVIDENCE_LOCATOR_INDEXES[name]:
                connection.execute(f"DROP INDEX IF EXISTS {index}")
            connection.execute(f"ALTER TABLE {name} RENAME TO {temporary}")
            connection.execute(
                target.replace("CREATE TABLE IF NOT EXISTS", "CREATE TABLE", 1)
            )
            connection.execute(
                f"INSERT INTO {name} ({columns}) SELECT {columns} FROM {temporary}"
            )
            connection.execute(f"DROP TABLE {temporary}")
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    return [name for name, _ in pending]


def _rebuild_changed_empty_step4_tables(
    connection: sqlite3.Connection, schema_sql: str
) -> list[str]:
    """DDL이 바뀐 Step-4 표를 비어 있을 때만 원자적으로 다시 만든다."""
    pending: list[tuple[str, str]] = []
    for name in _STEP4_REBUILDABLE_TABLES:
        existing = _table_sql(connection, name)
        if existing is None:
            continue
        target = _schema_table_ddl(schema_sql, name)
        if _normalized_table_sql(existing) == _normalized_table_sql(target):
            continue
        if _row_count(connection, name):
            raise BacktestStorageError(
                f"{name}에 행이 있어 스키마를 다시 만들지 않습니다"
            )
        pending.append((name, target))
    if not pending:
        return []
    try:
        connection.execute("BEGIN IMMEDIATE")
        for name, target in pending:
            connection.execute(f"DROP TABLE {name}")
            connection.execute(
                target.replace("CREATE TABLE IF NOT EXISTS", "CREATE TABLE", 1)
            )
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    return [name for name, _ in pending]


def connect(
    data_dir: Path | str = DEFAULT_DATA_DIR, schema_path: Path = SCHEMA_PATH
) -> sqlite3.Connection:
    """백테스트 DB를 열고 스키마를 보장한다."""
    path = resolve_backtest_db_path(data_dir)
    path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(path)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA journal_mode=WAL")
    connection.execute("PRAGMA foreign_keys=ON")
    schema_sql = Path(schema_path).read_text(encoding="utf-8")
    _upgrade_ca801b0_qv_sec_filings(connection, schema_sql)
    _migrate_step4_identity(connection, schema_sql)
    _migrate_evidence_locators(connection, schema_sql)
    _rebuild_changed_empty_step4_tables(connection, schema_sql)
    connection.executescript(schema_sql)
    add_missing_columns(connection)
    return connection


def connect_memory(schema_path: Path = SCHEMA_PATH) -> sqlite3.Connection:
    """테스트용 메모리 DB. 파일 저장소 규칙과 무관하게 스키마만 필요할 때 쓴다."""
    connection = sqlite3.connect(":memory:")
    connection.row_factory = sqlite3.Row
    connection.executescript(Path(schema_path).read_text(encoding="utf-8"))
    return connection
