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
    connection.executescript(Path(schema_path).read_text(encoding="utf-8"))
    add_missing_columns(connection)
    return connection


def connect_memory(schema_path: Path = SCHEMA_PATH) -> sqlite3.Connection:
    """테스트용 메모리 DB. 파일 저장소 규칙과 무관하게 스키마만 필요할 때 쓴다."""
    connection = sqlite3.connect(":memory:")
    connection.row_factory = sqlite3.Row
    connection.executescript(Path(schema_path).read_text(encoding="utf-8"))
    return connection
