"""PAPER 전용 저장소.

설계 10.0의 격리 표에 따라 PAPER는 자기 DB 파일만 쓴다. 갈피 본체(`galpi.db`)나
실전 저장소로 경로가 해석되면 열지 않는다.
"""

from __future__ import annotations

import sqlite3
from pathlib import Path

PAPER_DB_NAME = "trading-paper.db"
DEFAULT_DATA_DIR = Path(__file__).resolve().parents[1] / "data"
SCHEMA_PATH = Path(__file__).resolve().parents[1] / "schema.sql"

# 갈피 본체와 실전 저장소의 이름. 이 중 하나로 해석되면 사고다.
FORBIDDEN_DB_NAMES = frozenset({"galpi.db", "council.db", "trading-live.db"})


class TradingStorageError(Exception):
    """저장소 경로가 격리 계약을 벗어날 때 올린다."""


def resolve_paper_db_path(data_dir: Path | str = DEFAULT_DATA_DIR) -> Path:
    """PAPER DB 경로를 만들고 격리 계약을 확인한다."""
    resolved_dir = Path(data_dir).expanduser().resolve()
    path = resolved_dir / PAPER_DB_NAME

    if path.name in FORBIDDEN_DB_NAMES:
        raise TradingStorageError(f"PAPER가 열 수 없는 저장소입니다: {path.name}")
    if path.name != PAPER_DB_NAME:
        raise TradingStorageError(f"PAPER 저장소 이름이 아닙니다: {path.name}")
    # 실전 경로 아래에 PAPER DB를 두는 실수를 막는다.
    parts = {part.lower() for part in resolved_dir.parts}
    if "live" in parts or "trading-live" in parts:
        raise TradingStorageError(f"실전 경로 안에는 PAPER 저장소를 둘 수 없습니다: {resolved_dir}")
    return path


def connect(data_dir: Path | str = DEFAULT_DATA_DIR, schema_path: Path = SCHEMA_PATH) -> sqlite3.Connection:
    """PAPER DB를 열고 스키마를 보장한다."""
    path = resolve_paper_db_path(data_dir)
    path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(path)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA journal_mode=WAL")
    connection.execute("PRAGMA foreign_keys=ON")
    connection.executescript(Path(schema_path).read_text(encoding="utf-8"))
    return connection
