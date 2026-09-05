"""Step 5A-2 실행 진입점 — **작업 항목 단위 체크포인트/재개 계약.**

전부 network-free다. `EdgarClient`는 stub으로 갈아끼우고 실제 SEC를 부르지 않는다.
**production manifest 파일(`trading/qv/identity/*.jsonl`)을 읽지도 쓰지도 않는다.**

여기서 잠그는 것은 실행 인프라뿐이다 — 발견·증명·법적 증거·승격 semantics는
이 파일의 관심사가 아니고 `test_qv_identity_proposals.py`가 그대로 잠근다.
"""

from __future__ import annotations

import contextlib
import io
import json
import sys
import types
import unittest
import unittest.mock
from pathlib import Path

TRADING_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TRADING_ROOT))

from backtest.qv_identity_promotion import load_proposal_run  # noqa: E402
from backtest.qv_identity_proposals import run_proposals  # noqa: E402
from selftest import qv_identity_proposal_run as runner  # noqa: E402

from backtest.qv_identity_proposals import DiscoveryHints  # noqa: E402

from tests.test_qv_identity_proposals import (  # noqa: E402
    FakeNameIndex,
    StubClient,
    StubCompany,
    StubRow,
    cover_instance,
)


# ── 고정 입력 ─────────────────────────────────────────────────────────────────

PROVENANCE = {
    "index_name": "SP500",
    "universe_source": "announcements",
    "universe_source_version": "eodhd-15y-2026-08",
    "calendar_source": "eodhd",
    "calendar_source_version": "eodhd-15y-2026-08",
    "identity_source_version": "qv-identity-sha256:abc",
    "reused_series_source": "trading/universe/reused-tickers.csv",
    "reused_series_source_version": "reused-tickers-sha256:abc",
}


def inventory_payload(rows) -> dict:
    payload = {
        "stage": "5A-1",
        "measures": "STATIC_MAPPING_COVERAGE_DEMAND",
        "securities": rows,
    }
    payload.update(PROVENANCE)
    return payload


def security(member, identity, kind="DIRECT", session="2016-06-30") -> dict:
    return {
        "formation_session": session,
        "member_symbol": member,
        "identity_symbol": identity,
        "symbol_bridge_kind": kind,
        "status": "UNMAPPED",
        "class_id": None,
        "issuer_id": None,
        "reason": "NO_CLASS_MAPPING_FOR_SYMBOL",
    }


# 세 종목 · 하나는 재사용 벤더 계열 episode다.
DEFAULT_ROWS = [
    security("AAA", "AAA"),
    security("BBB", "BBB"),
    security("TFCFA", "FOXA", kind="REUSED_VENDOR_SERIES"),
]


def cover_facts(symbol):
    """단일 보통주 표지. `Security12bTitle` + `TradingSymbol` + 주식수."""
    return [
        {"concept": "Security12bTitle", "value": "Common Stock",
         "member": "CommonClassAMember", "context_id": "a"},
        {"concept": "TradingSymbol", "value": symbol,
         "member": "CommonClassAMember", "context_id": "a"},
        {"concept": "EntityCommonStockSharesOutstanding", "value": "1000",
         "member": "CommonClassAMember", "context_id": "a", "numeric": True},
    ]


def stub_client_factory():
    """세 종목 모두 표지 증명이 서는 결정적 stub. 호출 수를 센다."""
    rows_by_cik, files, companies = {}, {}, {}
    for symbol, cik in (("AAA", "0000000001"), ("BBB", "0000000002"), ("FOXA", "0000000003")):
        accession = f"{cik}-16-000001"
        rows_by_cik[cik] = [StubRow(accession, "10-K", "2016-02-20")]
        files[accession] = {"cover.xml": cover_instance(cover_facts(symbol), default_cik=cik)}
        companies[symbol] = StubCompany(cik, f"{symbol} Inc.")

    class CountingClient(StubClient):
        def __init__(self):
            super().__init__(
                rows_by_cik=rows_by_cik,
                files_by_accession=files,
                name_index=FakeNameIndex({}),
            )
            self.calls = 0
            self.ticker_map_calls = 0

        def ticker_map(self):
            self.ticker_map_calls += 1
            return dict(companies)

        def accession_index(self, cik, accession):
            self.calls += 1
            return super().accession_index(cik, accession)

        def accession_file_bytes(self, cik, accession, name):
            self.calls += 1
            return super().accession_file_bytes(cik, accession, name)

        def submissions(self, cik):
            self.calls += 1
            return super().submissions(cik)

    return CountingClient, companies


class CheckpointRunnerTest(unittest.TestCase):
    def setUp(self):
        import tempfile

        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.inventory = self.root / "inventory.json"
        self.inventory.write_text(
            json.dumps(inventory_payload(DEFAULT_ROWS), ensure_ascii=False), encoding="utf-8"
        )
        self.ClientClass, self.companies = stub_client_factory()
        self.clients = []

        def make_client(*args, **kwargs):
            client = self.ClientClass()
            self.clients.append(client)
            return client

        patched = unittest.mock.patch.object(runner, "EdgarClient", make_client)
        patched.start()
        self.addCleanup(patched.stop)

        # 러너는 사람이 보는 receipt를 찍는다 — 스위트 출력까지 더럽히지 않게 삼킨다.
        quiet = contextlib.ExitStack()
        quiet.enter_context(contextlib.redirect_stdout(io.StringIO()))
        quiet.enter_context(contextlib.redirect_stderr(io.StringIO()))
        self.addCleanup(quiet.close)

    # ── 도구 ─────────────────────────────────────────────────────────────
    def args(self, **overrides):
        base = dict(
            inventory=str(self.inventory),
            symbols=None,
            limit=10,
            browse=False,
            historical=False,
            legal_evidence=False,
            data_dir=None,
            contact=None,
            out=str(self.root / "out.json"),
            checkpoint_dir=str(self.root / "ckpt"),
            resume=False,
        )
        base.update(overrides)
        return types.SimpleNamespace(**base)

    def one_shot(self):
        """체크포인트 없이 기존 경로로 한 번에 돌린 결과 JSON."""
        demand = runner.read_mapping_demand(str(self.inventory))
        selected = runner._select(demand, self.args())
        client = self.ClientClass()
        run = run_proposals(
            client, selected, companies=client.ticker_map(),
            use_browse=False, hints=None, legal_evidence=False,
        )
        return run.as_json()

    def semantic(self, payload):
        """진단용 실행 칸을 뺀 의미 내용을 **직렬화까지** 고정한다.

        dict 비교만 하면 `counts`·`reason_counts`의 키 순서가 갈려도 통과한다 —
        기존 산출물의 정렬 계약이 조용히 사라지지 않게 문자열로 견준다.
        """
        drop = {"sec_calls", "git_commit", "checkpoint_dir", "run_identity_sha256"}
        kept = {k: v for k, v in payload.items() if k not in drop}
        return json.dumps(kept, ensure_ascii=False, indent=2, sort_keys=False)

    def out_payload(self):
        return json.loads((self.root / "out.json").read_text(encoding="utf-8"))

    def ckpt(self):
        return self.root / "ckpt"

    # ── 1. 정상 다항목 체크포인트 실행 ────────────────────────────────────
    def test_multi_item_checkpoint_run_writes_every_item_and_final_output(self):
        self.assertEqual(runner.stage_run_checkpointed(self.args()), 0)
        items = sorted((self.ckpt() / "items").glob("*.json"))
        self.assertEqual(len(items), 3)
        payload = self.out_payload()
        self.assertEqual(len(payload["proposals"]), 3)
        self.assertEqual(payload["stage"], "5A-2")
        self.assertEqual(payload["produces"], "SEC_IDENTITY_PROPOSALS")
        self.assertIs(payload["mutates_production_manifest"], False)

    def test_final_output_is_accepted_by_the_promotion_loader_unchanged(self):
        runner.stage_run_checkpointed(self.args())
        loaded = load_proposal_run(self.root / "out.json")
        self.assertEqual(len(loaded.proposals), 3)

    def test_proposals_keep_the_selected_demand_order(self):
        runner.stage_run_checkpointed(self.args())
        payload = self.out_payload()
        keys = [(p["member_symbol"], p["identity_symbol"]) for p in payload["proposals"]]
        demand = runner.read_mapping_demand(str(self.inventory))
        expected = [item.key for item in runner._select(demand, self.args()).work_items]
        self.assertEqual(keys, expected)

    def test_reused_series_episode_stays_a_distinct_work_item(self):
        runner.stage_run_checkpointed(self.args())
        payload = self.out_payload()
        keys = {(p["member_symbol"], p["identity_symbol"]) for p in payload["proposals"]}
        self.assertIn(("TFCFA", "FOXA"), keys)
        self.assertNotIn(("FOXA", "FOXA"), keys)

    # ── 2. 등가성 — 이것이 핵심 회귀다 ────────────────────────────────────
    def test_uninterrupted_checkpoint_run_equals_one_shot_run(self):
        expected = self.one_shot()
        runner.stage_run_checkpointed(self.args())
        self.assertEqual(self.semantic(self.out_payload()), self.semantic(expected))

    def test_interrupted_then_resumed_equals_uninterrupted(self):
        expected = self.one_shot()
        self.fail_at(1)
        self.assertEqual(runner.stage_run_checkpointed(self.args()), 1)
        self.assertFalse((self.root / "out.json").exists())
        self.unfail()
        self.assertEqual(runner.stage_run_checkpointed(self.args(resume=True)), 0)
        self.assertEqual(self.semantic(self.out_payload()), self.semantic(expected))

    # ── 3. 중단·재개 ────────────────────────────────────────────────────
    def fail_at(self, order: int):
        """`order`번째 작업 항목에서 전송 실패를 일으킨다."""
        from backtest.edgar import EdgarError

        original = runner.run_proposals
        state = {"n": 0}

        def flaky(client, demand, **kwargs):
            if state["n"] == order:
                state["n"] += 1
                raise EdgarError("HTTP 503: https://www.sec.gov/cgi-bin/browse-edgar")
            state["n"] += 1
            return original(client, demand, **kwargs)

        self._patch = unittest.mock.patch.object(runner, "run_proposals", flaky)
        self._patch.start()

    def unfail(self):
        self._patch.stop()

    def test_failure_preserves_earlier_items_and_exits_non_zero(self):
        self.fail_at(1)
        self.assertEqual(runner.stage_run_checkpointed(self.args()), 1)
        self.unfail()
        items = sorted((self.ckpt() / "items").glob("*.json"))
        self.assertEqual([p.name for p in items], ["00000.json"])
        self.assertFalse((self.root / "out.json").exists())

    def test_failure_receipt_records_the_failed_work_item(self):
        self.fail_at(1)
        runner.stage_run_checkpointed(self.args())
        self.unfail()
        receipts = [
            json.loads(p.read_text(encoding="utf-8"))
            for p in (self.ckpt() / "sessions").glob("*.json")
        ]
        failed = [r for r in receipts if r["status"] == runner.SESSION_FAILED]
        self.assertEqual(len(failed), 1)
        self.assertEqual(failed[0]["failed_order"], 1)
        self.assertEqual(failed[0]["error_type"], "EdgarError")
        self.assertIn("503", failed[0]["error_message"])
        self.assertEqual(failed[0]["durable_completed_items"], 1)

    def test_resume_reruns_only_the_failed_item_and_the_rest(self):
        self.fail_at(1)
        runner.stage_run_checkpointed(self.args())
        self.unfail()
        first = (self.ckpt() / "items" / "00000.json").read_text(encoding="utf-8")

        executed = []
        original = runner.run_proposals

        def watching(client, demand, **kwargs):
            executed.extend(item.key for item in demand.work_items)
            return original(client, demand, **kwargs)

        with unittest.mock.patch.object(runner, "run_proposals", watching):
            self.assertEqual(runner.stage_run_checkpointed(self.args(resume=True)), 0)

        # 이미 끝난 첫 항목은 다시 돌지 않았고 파일도 그대로다.
        self.assertNotIn(("AAA", "AAA"), executed)
        self.assertEqual(executed, [("BBB", "BBB"), ("TFCFA", "FOXA")])
        self.assertEqual((self.ckpt() / "items" / "00000.json").read_text(encoding="utf-8"), first)

    def test_transport_failure_is_never_written_as_a_semantic_status(self):
        """503은 `UNRESOLVED`가 아니다 — 그 항목의 artifact 자체가 생기지 않는다."""
        self.fail_at(1)
        runner.stage_run_checkpointed(self.args())
        self.unfail()
        self.assertFalse((self.ckpt() / "items" / "00001.json").exists())

    # ── 4. fail-close ───────────────────────────────────────────────────
    def test_second_run_without_resume_refuses_an_existing_checkpoint(self):
        runner.stage_run_checkpointed(self.args())
        with self.assertRaises(runner.CheckpointError):
            runner.stage_run_checkpointed(self.args())

    def test_resume_without_an_existing_checkpoint_fails_closed(self):
        with self.assertRaises(runner.CheckpointError):
            runner.stage_run_checkpointed(self.args(resume=True))

    def test_corrupt_item_artifact_fails_closed(self):
        runner.stage_run_checkpointed(self.args())
        (self.ckpt() / "items" / "00001.json").write_text("{not json", encoding="utf-8")
        with self.assertRaises(runner.CheckpointError):
            runner.stage_run_checkpointed(self.args(resume=True))

    def test_item_artifact_for_a_different_work_item_fails_closed(self):
        runner.stage_run_checkpointed(self.args())
        path = self.ckpt() / "items" / "00001.json"
        payload = json.loads(path.read_text(encoding="utf-8"))
        payload["identity_symbol"] = "ZZZ"
        path.write_text(json.dumps(payload), encoding="utf-8")
        with self.assertRaises(runner.CheckpointError):
            runner.stage_run_checkpointed(self.args(resume=True))

    def test_an_artifact_carrying_another_items_result_fails_closed(self):
        """중복은 키 불일치로 걸린다 — 순번 파일은 그 순번의 작업 항목만 받는다."""
        runner.stage_run_checkpointed(self.args())
        first = json.loads((self.ckpt() / "items" / "00000.json").read_text(encoding="utf-8"))
        first["order"] = 1
        (self.ckpt() / "items" / "00001.json").write_text(json.dumps(first), encoding="utf-8")
        with self.assertRaises(runner.CheckpointError) as caught:
            runner.stage_run_checkpointed(self.args(resume=True))
        self.assertIn("작업 항목이 다릅니다", str(caught.exception))

    def tamper_item(self, order, **changes):
        path = self.ckpt() / "items" / f"{order:05d}.json"
        payload = json.loads(path.read_text(encoding="utf-8"))
        payload.update(changes)
        path.write_text(json.dumps(payload), encoding="utf-8")

    def test_item_with_a_foreign_schema_fails_closed(self):
        runner.stage_run_checkpointed(self.args())
        self.tamper_item(1, checkpoint_schema="qv-5a2-checkpoint-v0")
        with self.assertRaises(runner.CheckpointError):
            runner.stage_run_checkpointed(self.args(resume=True))

    def test_item_with_altered_demand_provenance_fails_closed(self):
        runner.stage_run_checkpointed(self.args())
        payload = json.loads(
            (self.ckpt() / "items" / "00001.json").read_text(encoding="utf-8")
        )
        provenance = dict(payload["demand_provenance"])
        provenance["identity_source_version"] = "qv-identity-sha256:other"
        self.tamper_item(1, demand_provenance=provenance)
        with self.assertRaises(runner.CheckpointError):
            runner.stage_run_checkpointed(self.args(resume=True))

    def test_item_from_a_different_run_identity_fails_closed(self):
        runner.stage_run_checkpointed(self.args())
        self.tamper_item(1, run_identity_sha256="sha256:someoneelse")
        with self.assertRaises(runner.CheckpointError):
            runner.stage_run_checkpointed(self.args(resume=True))

    def test_inventory_sha_mismatch_fails_closed(self):
        runner.stage_run_checkpointed(self.args())
        rows = DEFAULT_ROWS + [security("CCC", "CCC")]
        self.inventory.write_text(
            json.dumps(inventory_payload(rows), ensure_ascii=False), encoding="utf-8"
        )
        with self.assertRaises(runner.CheckpointError):
            runner.stage_run_checkpointed(self.args(resume=True))

    def test_creation_refuses_when_the_git_revision_is_unknown(self):
        """체크포인트는 정확한 commit 하나에 묶인다 — `None`은 정체성이 아니다."""
        with unittest.mock.patch.object(runner, "_git_commit", lambda: None):
            with self.assertRaises(runner.CheckpointError) as caught:
                runner.stage_run_checkpointed(self.args())
        self.assertIn("git revision", str(caught.exception))

    def test_nothing_is_created_or_spent_when_the_git_revision_is_unknown(self):
        """`run.json`을 만들지 않고 SEC client도 세우지 않는다."""
        with unittest.mock.patch.object(runner, "_git_commit", lambda: None):
            with self.assertRaises(runner.CheckpointError):
                runner.stage_run_checkpointed(self.args())
        self.assertFalse((self.ckpt() / "run.json").exists())
        self.assertFalse((self.ckpt() / "items").exists())
        self.assertFalse((self.ckpt() / "sessions").exists())
        self.assertEqual(self.clients, [])
        self.assertFalse((self.root / "out.json").exists())

    def test_resume_refuses_when_the_git_revision_is_unknown(self):
        runner.stage_run_checkpointed(self.args())
        before = sorted(p.name for p in (self.ckpt() / "items").glob("*.json"))
        with unittest.mock.patch.object(runner, "_git_commit", lambda: None):
            with self.assertRaises(runner.CheckpointError) as caught:
                runner.stage_run_checkpointed(self.args(resume=True))
        self.assertIn("git revision", str(caught.exception))
        # 이미 끝난 항목을 건드리지 않는다.
        self.assertEqual(
            sorted(p.name for p in (self.ckpt() / "items").glob("*.json")), before
        )

    def test_an_empty_git_revision_is_treated_as_unknown(self):
        """빈 문자열도 revision이 아니다."""
        with unittest.mock.patch.object(runner, "_git_commit", lambda: ""):
            with self.assertRaises(runner.CheckpointError):
                runner.stage_run_checkpointed(self.args())

    def test_the_checkpoint_identity_never_serializes_a_null_commit(self):
        runner.stage_run_checkpointed(self.args())
        metadata = json.loads((self.ckpt() / "run.json").read_text(encoding="utf-8"))
        self.assertTrue(metadata["run_identity"]["git_commit"])
        self.assertTrue(self.out_payload()["git_commit"])

    def test_the_legacy_non_checkpoint_run_still_tolerates_an_unknown_revision(self):
        """기존 경로의 관용은 그대로다 — git 없는 환경에서도 돈다."""
        arguments = self.args(checkpoint_dir=None)
        with unittest.mock.patch.object(runner, "_git_commit", lambda: None):
            self.assertEqual(runner.stage_run(arguments), 0)
        payload = self.out_payload()
        self.assertIsNone(payload["git_commit"])
        self.assertEqual(len(payload["proposals"]), 3)

    def test_git_commit_mismatch_fails_closed(self):
        runner.stage_run_checkpointed(self.args())
        with unittest.mock.patch.object(runner, "_git_commit", lambda: "deadbeef"):
            with self.assertRaises(runner.CheckpointError) as caught:
                runner.stage_run_checkpointed(self.args(resume=True))
        # 어느 칸이 갈렸는지 말해야 한다 — "다르다"만으로는 고칠 수가 없다.
        self.assertIn("git_commit", str(caught.exception))
        self.assertIn("deadbeef", str(caught.exception))

    def test_browse_flag_mismatch_fails_closed(self):
        runner.stage_run_checkpointed(self.args())
        with self.assertRaises(runner.CheckpointError):
            runner.stage_run_checkpointed(self.args(resume=True, browse=True))

    def test_legal_evidence_flag_mismatch_fails_closed(self):
        runner.stage_run_checkpointed(self.args())
        with self.assertRaises(runner.CheckpointError):
            runner.stage_run_checkpointed(self.args(resume=True, legal_evidence=True))

    def test_historical_flag_mismatch_fails_closed(self):
        runner.stage_run_checkpointed(self.args())
        with unittest.mock.patch.object(runner, "_historical_source_digest", lambda name: "sha256:x"):
            with self.assertRaises(runner.CheckpointError):
                runner.stage_run_checkpointed(self.args(resume=True, historical=True))

    def test_work_item_set_mismatch_fails_closed(self):
        runner.stage_run_checkpointed(self.args())
        with self.assertRaises(runner.CheckpointError):
            runner.stage_run_checkpointed(self.args(resume=True, limit=2))

    def test_a_gap_in_the_middle_is_rerun_and_blocks_the_final_output(self):
        """가운데가 비면 건너뛰지 않는다 — 다시 돌리고, 또 실패하면 산출물이 없다."""
        runner.stage_run_checkpointed(self.args())
        self.assertTrue((self.root / "out.json").exists())
        (self.root / "out.json").unlink()
        (self.ckpt() / "items" / "00001.json").unlink()

        self.fail_at(0)  # 비어 있는 그 항목이 다시 돌다가 실패한다
        self.assertEqual(runner.stage_run_checkpointed(self.args(resume=True)), 1)
        self.unfail()
        self.assertFalse((self.root / "out.json").exists())

        # 다시 이어서 돌리면 그 항목만 채워지고 산출물이 나온다.
        self.assertEqual(runner.stage_run_checkpointed(self.args(resume=True)), 0)
        self.assertTrue((self.root / "out.json").exists())
        self.assertEqual(len(self.out_payload()["proposals"]), 3)

    # ── 5. 실행 회계 ────────────────────────────────────────────────────
    def test_sec_calls_are_summed_across_sessions(self):
        self.fail_at(1)
        runner.stage_run_checkpointed(self.args())
        self.unfail()
        runner.stage_run_checkpointed(self.args(resume=True))
        payload = self.out_payload()
        self.assertIsInstance(payload["sec_calls"], int)
        self.assertGreater(payload["sec_calls"], 0)

    def capture_session_start(self):
        """`start_session()`이 실제로 적은 시작 시각을 잡아둔다."""
        captured = {}
        original = runner.Checkpoint.start_session

        def wrapper(inner_self, *args, **kwargs):
            path, started_at = original(inner_self, *args, **kwargs)
            captured["started_at"] = started_at
            return path, started_at

        patch = unittest.mock.patch.object(runner.Checkpoint, "start_session", wrapper)
        patch.start()
        self.addCleanup(patch.stop)
        return captured

    def receipts(self):
        return [
            json.loads(p.read_text(encoding="utf-8"))
            for p in (self.ckpt() / "sessions").glob("*.json")
        ]

    def test_the_terminal_receipt_keeps_the_real_session_start_time(self):
        """`started_at`은 session이 실제로 시작한 시각이지 끝난 시각이 아니다."""
        captured = self.capture_session_start()
        runner.stage_run_checkpointed(self.args())

        found = self.receipts()
        self.assertEqual(len(found), 1)
        self.assertEqual(found[0]["status"], runner.SESSION_COMPLETE)
        self.assertEqual(found[0]["started_at"], captured["started_at"])

    def test_the_failure_receipt_keeps_the_real_session_start_time(self):
        captured = self.capture_session_start()
        self.fail_at(1)
        self.assertEqual(runner.stage_run_checkpointed(self.args()), 1)
        self.unfail()

        found = self.receipts()
        self.assertEqual(len(found), 1)
        self.assertEqual(found[0]["status"], runner.SESSION_FAILED)
        self.assertEqual(found[0]["started_at"], captured["started_at"])

    def test_started_at_is_not_simply_rewritten_on_failure(self):
        """실패 경로도 시작 시각을 보존한다 — 시계가 움직여도 그대로다."""
        captured = self.capture_session_start()
        calls = {"n": 0}

        def ticking_now():
            calls["n"] += 1
            return f"2026-04-04T00:00:{calls['n']:02d}+00:00"

        self.fail_at(1)
        with unittest.mock.patch.object(runner, "_now", ticking_now):
            self.assertEqual(runner.stage_run_checkpointed(self.args()), 1)
        self.unfail()

        found = self.receipts()[0]
        self.assertEqual(found["status"], runner.SESSION_FAILED)
        self.assertEqual(found["started_at"], captured["started_at"])
        self.assertLess(found["started_at"], found["ended_at"])

    def test_started_at_is_not_simply_rewritten_at_completion(self):
        """시작과 끝 사이에 시계가 움직였을 때 두 칸이 갈려야 한다."""
        captured = self.capture_session_start()
        real_now = runner._now
        calls = {"n": 0}

        def ticking_now():
            calls["n"] += 1
            return f"2026-03-03T00:00:{calls['n']:02d}+00:00"

        with unittest.mock.patch.object(runner, "_now", ticking_now):
            runner.stage_run_checkpointed(self.args())

        found = self.receipts()[0]
        self.assertEqual(found["started_at"], captured["started_at"])
        self.assertNotEqual(found["ended_at"], found["started_at"])
        self.assertLess(found["started_at"], found["ended_at"])

    def test_an_abruptly_dead_session_makes_the_total_unknown(self):
        """급사한 session은 `RUNNING`으로 남고 총합은 추정치를 지어내지 않는다."""
        runner.stage_run_checkpointed(self.args())
        sessions = self.ckpt() / "sessions"
        stale = json.loads(next(sessions.glob("*.json")).read_text(encoding="utf-8"))
        stale["status"] = runner.SESSION_RUNNING
        stale["sec_calls"] = runner.CALLS_UNKNOWN
        (sessions / "99999999T999999-1.json").write_text(json.dumps(stale), encoding="utf-8")
        identity = runner.run_identity(
            runner._select(runner.read_mapping_demand(str(self.inventory)), self.args()),
            self.args(),
            inventory_digest=runner._sha256_file(self.inventory),
        )
        checkpoint = runner.Checkpoint(self.ckpt(), identity)
        self.assertEqual(checkpoint.observed_sec_calls(), runner.CALLS_UNKNOWN)

    # ── 6. 40MB 이름 색인은 프로세스당 한 번 ─────────────────────────────
    def test_the_name_index_is_built_once_per_process_not_per_work_item(self):
        """`cik_lookup()`는 40MB다 — 항목마다 `run_proposals`를 부르므로 미리 만들어

        넘기지 않으면 항목 수만큼 다시 내려받는다.
        """
        hints = DiscoveryHints(
            source="announcements",
            source_version="eodhd-15y-2026-08",
            provenance="test",
            names={},
            spans={},
        )
        handed = []
        original = runner.run_proposals

        def watching(client, demand, **kwargs):
            handed.append(kwargs.get("name_index"))
            return original(client, demand, **kwargs)

        with unittest.mock.patch.object(runner, "build_hints", lambda *a, **k: hints), \
                unittest.mock.patch.object(runner, "run_proposals", watching):
            self.assertEqual(runner.stage_run_checkpointed(self.args(historical=True)), 0)

        client = self.clients[0]
        self.assertEqual(client.cik_lookup_calls, 1)
        self.assertEqual(len(handed), 3)
        self.assertTrue(all(item is not None for item in handed))
        self.assertEqual(len({id(item) for item in handed}), 1)

    def test_the_ticker_map_is_fetched_once_per_process(self):
        runner.stage_run_checkpointed(self.args())
        self.assertEqual(self.clients[0].ticker_map_calls, 1)


class AssemblyTest(unittest.TestCase):
    """`assemble_proposal_run`이 기존 산출물 계약을 그대로 만든다."""

    def demand(self):
        payload = inventory_payload(DEFAULT_ROWS)
        import tempfile

        tmp = tempfile.NamedTemporaryFile("w", suffix=".json", delete=False)
        json.dump(payload, tmp)
        tmp.close()
        self.addCleanup(lambda: Path(tmp.name).unlink(missing_ok=True))
        return runner.read_mapping_demand(tmp.name)

    def entry(self, member, identity, status, reasons, origins):
        return {
            "proposal": {
                "member_symbol": member,
                "identity_symbol": identity,
                "proposal_status": status,
                "reason_codes": list(reasons),
                "discovery_candidates": [
                    {"cik": "1", "origin": origin, "detail": ""} for origin in origins
                ],
            },
            "attempted_accessions": [
                {"member_symbol": member, "identity_symbol": identity, "accessions": []}
            ],
        }

    def test_tally_keys_are_sorted_even_when_seen_out_of_order(self):
        """정렬 계약이 없으면 등장 순서가 그대로 남는다 — 기존 `as_json()`과 갈린다."""
        completed = [
            self.entry("AAA", "AAA", "REVIEW_REQUIRED", ["ZZZ_LAST", "MID"], ["ZZZ_ORIGIN"]),
            self.entry("BBB", "BBB", "UNRESOLVED", ["AAA_FIRST"], ["AAA_ORIGIN"]),
        ]
        payload = runner.assemble_proposal_run(self.demand(), None, completed)
        self.assertEqual(
            list(payload["reason_counts"]), ["AAA_FIRST", "MID", "ZZZ_LAST"]
        )
        self.assertEqual(
            list(payload["discovery_origin_counts"]), ["AAA_ORIGIN", "ZZZ_ORIGIN"]
        )

    def test_counts_always_carry_all_three_statuses(self):
        completed = [self.entry("AAA", "AAA", "REVIEW_REQUIRED", [], [])]
        payload = runner.assemble_proposal_run(self.demand(), None, completed)
        self.assertEqual(
            payload["counts"],
            {"AUTO_PROVABLE": 0, "REVIEW_REQUIRED": 1, "UNRESOLVED": 0},
        )


if __name__ == "__main__":
    unittest.main()
