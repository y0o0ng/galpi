"""1단계 게이트: PAPER/LIVE 교차 접근 0건.

설계 1.3은 PAPER와 LIVE가 API 키·계좌·DB 저장소·서비스·주문 큐를 공유하는 것을
금지하고, 환경변수 하나만 바꾸면 실전 주문이 나가는 구조도 금지한다. 이 테스트는
그 두 금지를 코드로 고정한다.
"""

from __future__ import annotations

import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

TRADING_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TRADING_ROOT))

from paper import db  # noqa: E402
from paper.config import (  # noqa: E402
    PAPER_BASE_URL,
    PAPER_ENV_NAMES,
    PaperConfig,
    TradingConfigError,
    assert_paper_base_url,
    load_paper_config,
    parse_env_file,
)

VALID_ENV = {
    "KIS_PAPER_APP_KEY": "PSpaperkey000000",
    "KIS_PAPER_APP_SECRET": "papersecret00000",
    "KIS_PAPER_ACCOUNT": "50123456-01",
}


class ConfigIsolationTest(unittest.TestCase):
    def test_live_credentials_are_never_read(self):
        """실전 이름이 환경에 있어도 PAPER 설정에 흘러들지 않는다."""
        env = {
            **VALID_ENV,
            "KIS_LIVE_APP_KEY": "LIVE-SHOULD-NOT-LEAK",
            "KIS_LIVE_APP_SECRET": "LIVE-SHOULD-NOT-LEAK",
            "KIS_LIVE_ACCOUNT": "99999999-01",
            "BROKER_MODE": "LIVE",
        }
        config = load_paper_config(env=env, env_file=None)
        self.assertEqual(config.credential_scope, "paper")
        self.assertEqual(config.app_key, VALID_ENV["KIS_PAPER_APP_KEY"])
        self.assertEqual(config.base_url, PAPER_BASE_URL)
        # BROKER_MODE=LIVE가 있어도 모의 호스트 그대로다.
        self.assertIn("openapivts", config.base_url)

    def test_only_paper_names_are_referenced_in_source(self):
        """설정 모듈이 실전 이름 문자열 자체를 담고 있지 않다."""
        source = (TRADING_ROOT / "paper" / "config.py").read_text(encoding="utf-8")
        self.assertNotIn("KIS_LIVE", source)
        self.assertNotIn("openapi.koreainvestment", source)
        for name in PAPER_ENV_NAMES:
            self.assertIn(name, source)

    def test_missing_credentials_refuse_to_start(self):
        for name in PAPER_ENV_NAMES:
            partial = {k: v for k, v in VALID_ENV.items() if k != name}
            with self.assertRaises(TradingConfigError) as caught:
                load_paper_config(env=partial, env_file=None)
            self.assertIn(name, str(caught.exception))

    def test_production_host_is_refused(self):
        for host in (
            "https://openapi.koreainvestment.com:9443",
            "https://evil.example.com",
            "http://openapivts.koreainvestment.com:29443",
        ):
            with self.assertRaises(TradingConfigError):
                assert_paper_base_url(host)
            with self.assertRaises(TradingConfigError):
                load_paper_config(env=VALID_ENV, env_file=None, base_url=host)

    def test_account_format_is_validated(self):
        for bad in ("5012345601", "50123456-1", "abcdefgh-01", ""):
            env = {**VALID_ENV, "KIS_PAPER_ACCOUNT": bad}
            with self.assertRaises(TradingConfigError):
                load_paper_config(env=env, env_file=None)

    def test_secrets_are_not_in_repr(self):
        config = load_paper_config(env=VALID_ENV, env_file=None)
        text = repr(config)
        self.assertNotIn(VALID_ENV["KIS_PAPER_APP_SECRET"], text)
        self.assertNotIn(VALID_ENV["KIS_PAPER_ACCOUNT"], text)
        self.assertNotIn("50123456", text)
        self.assertIn("scope=paper", text)

    def test_account_hash_is_stable_and_not_reversible(self):
        config = load_paper_config(env=VALID_ENV, env_file=None)
        self.assertEqual(len(config.account_hash), 64)
        self.assertNotIn("50123456", config.account_hash)
        again = load_paper_config(env=VALID_ENV, env_file=None)
        self.assertEqual(config.account_hash, again.account_hash)

    def test_env_file_parsing_ignores_comments_and_quotes(self):
        parsed = parse_env_file(
            '# 주석\nKIS_PAPER_APP_KEY="quoted"\n\nKIS_PAPER_ACCOUNT=50123456-01\n잘못된줄\n'
        )
        self.assertEqual(parsed["KIS_PAPER_APP_KEY"], "quoted")
        self.assertEqual(parsed["KIS_PAPER_ACCOUNT"], "50123456-01")
        self.assertNotIn("잘못된줄", parsed)

    def test_process_env_wins_over_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            env_file = Path(tmp) / ".env.paper"
            env_file.write_text(
                "KIS_PAPER_APP_KEY=fromfile\n"
                "KIS_PAPER_APP_SECRET=fromfile\n"
                "KIS_PAPER_ACCOUNT=11111111-01\n",
                encoding="utf-8",
            )
            config = load_paper_config(
                env={"KIS_PAPER_APP_KEY": "fromenv"}, env_file=env_file
            )
            self.assertEqual(config.app_key, "fromenv")
            self.assertEqual(config.account_prefix, "11111111")


class StorageIsolationTest(unittest.TestCase):
    def test_paper_db_is_its_own_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = db.resolve_paper_db_path(tmp)
            self.assertEqual(path.name, "trading-paper.db")
            self.assertEqual(path.parent, Path(tmp).resolve())

    def test_galpi_and_live_storage_are_unreachable(self):
        """PAPER 경로 해석이 갈피 본체나 실전 저장소가 되는 일은 없다."""
        with tempfile.TemporaryDirectory() as tmp:
            live_dir = Path(tmp) / "trading-live"
            live_dir.mkdir()
            with self.assertRaises(db.TradingStorageError):
                db.resolve_paper_db_path(live_dir)

            nested_live = Path(tmp) / "live" / "data"
            nested_live.mkdir(parents=True)
            with self.assertRaises(db.TradingStorageError):
                db.resolve_paper_db_path(nested_live)

        # 이름 자체가 금지 목록에 있는지 확인한다.
        self.assertIn("galpi.db", db.FORBIDDEN_DB_NAMES)
        self.assertIn("trading-live.db", db.FORBIDDEN_DB_NAMES)

    def test_schema_creates_only_paper_scoped_rows(self):
        with tempfile.TemporaryDirectory() as tmp:
            connection = db.connect(tmp)
            try:
                tables = {
                    row["name"]
                    for row in connection.execute(
                        "SELECT name FROM sqlite_master WHERE type='table'"
                    )
                }
                self.assertIn("broker_environments", tables)
                self.assertIn("kis_capability_matrix", tables)
                self.assertIn("audit_events", tables)

                # 스키마가 LIVE 행을 아예 받지 않는다.
                with self.assertRaises(Exception):
                    connection.execute(
                        "INSERT INTO broker_environments"
                        " (mode, account_hash, credential_scope, base_url)"
                        " VALUES ('LIVE', 'x', 'live', 'https://x')"
                    )
                connection.execute(
                    "INSERT INTO broker_environments"
                    " (mode, account_hash, credential_scope, base_url)"
                    " VALUES ('PAPER', 'x', 'paper', ?)",
                    (PAPER_BASE_URL,),
                )
                # capability matrix는 실전 지원 여부를 기록조차 할 수 없다.
                # 실전 경로를 구현하지 않으므로 채울 근거가 없기 때문이다.
                with self.assertRaises(sqlite3.IntegrityError):
                    connection.execute(
                        "INSERT INTO kis_capability_matrix (api_name, live_supported)"
                        " VALUES ('overseas_order', 'supported')"
                    )
                connection.execute(
                    "INSERT INTO kis_capability_matrix (api_name, paper_supported)"
                    " VALUES ('overseas_order', 'supported')"
                )
            finally:
                connection.close()

    def test_connection_opens_exactly_the_paper_file(self):
        """열린 DB가 정말 PAPER 파일 하나뿐인지 sqlite에게 직접 묻는다."""
        with tempfile.TemporaryDirectory() as tmp:
            connection = db.connect(tmp)
            try:
                attached = [
                    (row["name"], row["file"])
                    for row in connection.execute("PRAGMA database_list")
                ]
                self.assertEqual(len(attached), 1)
                name, file_path = attached[0]
                self.assertEqual(name, "main")
                self.assertEqual(Path(file_path), Path(tmp).resolve() / "trading-paper.db")
            finally:
                connection.close()


if __name__ == "__main__":
    unittest.main()
