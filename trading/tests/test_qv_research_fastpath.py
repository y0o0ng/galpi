"""QV Phase 0 research fast path — network-free 계약 회귀.

production identity를 만들지 않는다 · 복잡하면 MISSING · tier 규칙 · PIT · split 무정규화 ·
가격 누락 · 수익률을 읽지 않는다.
"""

from __future__ import annotations

import hashlib
import sqlite3
import sys
import unittest
from pathlib import Path

TRADING_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TRADING_ROOT))

from backtest import qv_research_fastpath as fp  # noqa: E402
from backtest.qv_xbrl import parse_instance  # noqa: E402
from selftest import qv_phase0_research_fastpath as runner  # noqa: E402
from tests.qv_step4_fixtures import DEI, USG, instance_xml  # noqa: E402

CIK = "0000000042"
FORMATION = "2021-06-30"
D = "2020-12-31"


def facts_from(items: list[dict], *, accession: str = "0000000042-21-000001", acceptance="2021-02-01T12:00:00.000000Z", usable="2021-02-02") -> list[dict]:
    instance = parse_instance(instance_xml(items, cik=CIK), "x.xml")
    return [
        {**fact, "accession": accession, "form": "10-K", "acceptance_datetime": acceptance,
         "acceptance_eastern_date": acceptance[:10], "historical_usable_session": usable}
        for fact in fp.share_facts(instance, cik=CIK)
    ]


def a_fact(value="1000", instant="2020-12-31", **extra) -> dict:
    return {"concept": ("us-gaap", "CommonStockSharesOutstanding"), "instant": instant, "value": value, **extra}


def b_fact(value="900", instant="2020-10-15", **extra) -> dict:
    return {"concept": ("dei", "EntityCommonStockSharesOutstanding"), "instant": instant, "value": value, **extra}


class PopulationTest(unittest.TestCase):
    def inventory(self):
        return {"securities": [
            {"formation_session": FORMATION, "member_symbol": "AAA", "identity_symbol": "AAA", "symbol_bridge_kind": "DIRECT", "status": "UNMAPPED", "issuer_id": None},
            {"formation_session": FORMATION, "member_symbol": "AAB", "identity_symbol": "AAB", "symbol_bridge_kind": "DIRECT", "status": "UNMAPPED", "issuer_id": None},
            {"formation_session": FORMATION, "member_symbol": "ZZZ", "identity_symbol": "ZZZ", "symbol_bridge_kind": "DIRECT", "status": "UNMAPPED", "issuer_id": None},
        ]}

    def proposals(self):
        return {"proposals": [
            {"member_symbol": "AAA", "identity_symbol": "AAA", "demanded_formation_sessions": [FORMATION], "selected_cik": CIK},
            {"member_symbol": "AAB", "identity_symbol": "AAB", "demanded_formation_sessions": [FORMATION], "selected_cik": CIK},
            {"member_symbol": "ZZZ", "identity_symbol": "ZZZ", "demanded_formation_sessions": [FORMATION], "selected_cik": None},
        ]}

    def test_same_cik_two_members_is_one_research_issuer_row(self):
        rows = fp.membership_rows(self.inventory(), self.proposals())
        formations = fp.issuer_formations(rows)
        self.assertEqual(len(formations), 1)
        self.assertEqual(formations[0]["security_count"], 2)

    def test_identity_missing_member_row_stays_visible(self):
        rows = fp.membership_rows(self.inventory(), self.proposals())
        missing = [row for row in rows if row["member_symbol"] == "ZZZ"]
        self.assertEqual(len(missing), 1)
        self.assertIsNone(missing[0]["selected_cik"])
        self.assertEqual(missing[0]["selected_cik_provenance"], fp.IDENTITY_MISSING)

    def test_two_membership_securities_are_complex_without_choosing_one(self):
        formations = fp.issuer_formations(fp.membership_rows(self.inventory(), self.proposals()))
        result = runner.research_me(None, formations[0], {"filings": []}, {}, [D])
        self.assertEqual(result["me_status"], fp.ME_MISSING_COMPLEX)
        self.assertIsNone(result["me_path"])

    def test_research_cik_never_enters_production_identity_tables(self):
        manifest = TRADING_ROOT / "qv" / "identity"
        before = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in manifest.glob("*.jsonl")}
        connection = sqlite3.connect(":memory:")
        connection.row_factory = sqlite3.Row
        connection.executescript((TRADING_ROOT / "backtest" / "schema.sql").read_text())
        connection.executemany(
            "INSERT INTO bars_daily (symbol, trade_date, raw_open, raw_high, raw_low, raw_close, raw_volume,"
            " adj_open, adj_high, adj_low, adj_close, source, source_version) VALUES (?, ?, 1, 1, 1, 1, 1, 1, 1, 1, 1, ?, ?)",
            [("SPY", day, runner.CALENDAR_SOURCE, runner.CALENDAR_VERSION) for day in ("2021-02-01", "2021-02-02")],
        )
        filing = {"accession": "0000000042-21-000001", "form": "10-K", "filed_date": "2021-02-01", "report_date": "2020-12-31",
                  "acceptance_datetime": "2021-02-01T12:00:00.000000Z", "acceptance_eastern_date": "2021-02-01",
                  "primary_document": "x.htm", "submissions_file": "CIK.json", "planned_usable_session": "2021-02-02"}
        runner.insert_filing(connection, CIK, filing, runner.KQ_METADATA_VERSION, None)
        for table in ("qv_issuers", "qv_share_classes", "qv_share_class_prose_aliases", "qv_xbrl_class_bindings", "qv_issuer_market_equity"):
            self.assertEqual(connection.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0], 0, table)
        after = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in manifest.glob("*.jsonl")}
        self.assertEqual(before, after)


class ShareChoiceTest(unittest.TestCase):
    def choose(self, facts):
        return fp.choose_research_shares(facts, formation_session=FORMATION, december=D)

    def test_single_dimensionless_tier_a_is_candidate(self):
        choice = self.choose(facts_from([a_fact()]))
        self.assertIsNone(choice.status)
        self.assertEqual(choice.fact["value_text"], "1000")
        self.assertEqual(choice.tier_path, "A")

    def test_explicit_class_axis_share_fact_is_complex(self):
        items = [a_fact(), a_fact(value="10", context_id="cls", member=(USG, "CommonClassAMember"))]
        self.assertEqual(self.choose(facts_from(items)).status, fp.ME_MISSING_COMPLEX)

    def test_ambiguous_tier_a_does_not_fall_through_to_b(self):
        items = [a_fact(value="1000", context_id="dup", decimals="INF"), a_fact(value="2000", context_id="dup", decimals="INF"), b_fact()]
        choice = self.choose(facts_from(items))
        self.assertEqual(choice.status, fp.ME_MISSING_SHARE_FACT)
        self.assertEqual(choice.reason, "TIER_A_PRESENT_NOT_USABLE")

    def test_tier_b_only_when_a_structurally_absent(self):
        choice = self.choose(facts_from([b_fact()]))
        self.assertIsNone(choice.status)
        self.assertEqual(choice.tier_path, "B")
        with_a = self.choose(facts_from([b_fact(instant="2020-12-20"), a_fact(instant="2020-09-30")]))
        self.assertEqual(with_a.tier_path, "A")
        self.assertEqual(with_a.fact["instant"], "2020-09-30")

    def test_share_fact_after_december_session_is_rejected(self):
        choice = self.choose(facts_from([a_fact(instant="2021-01-15")]))
        self.assertEqual(choice.status, fp.ME_MISSING_SHARE_FACT)

    def test_filing_not_usable_by_formation_is_rejected(self):
        choice = self.choose(facts_from([a_fact()], usable="2021-07-01"))
        self.assertEqual(choice.status, fp.ME_MISSING_SHARE_FACT)

    def test_multiple_common_cover_symbols_are_complex(self):
        self.assertEqual(fp.cover_check({"common_symbols": ["AAA", "AAB"]}, "AAA"), "COVER_MULTIPLE_COMMON_SYMBOLS")
        self.assertIsNone(fp.cover_check({"common_symbols": ["BRK.B"]}, "BRK-B"))
        self.assertIsNone(fp.cover_check({"common_symbols": []}, "AAA"))


class SplitAndPriceTest(unittest.TestCase):
    def test_split_between_fact_and_d_is_boundary_not_normalized(self):
        self.assertEqual(fp.split_boundary(["2020-11-02"], fact_instant="2020-09-30", acceptance_eastern_date="2020-10-30", december=D), "2020-11-02")
        # D 뒤 제출 filing의 비교기 주식수는 그 사이 split으로 소급 재작성됐을 수 있다
        self.assertEqual(fp.split_boundary(["2021-01-20"], fact_instant=D, acceptance_eastern_date="2021-02-01", december=D), "2021-01-20")
        self.assertIsNone(fp.split_boundary(["2019-05-01"], fact_instant="2020-09-30", acceptance_eastern_date="2020-10-30", december=D))

    def record(self):
        filing = {"accession": "0000000042-21-000001", "form": "10-K", "acceptance_datetime": "2021-02-01T12:00:00.000000Z",
                  "acceptance_eastern_date": "2021-02-01", "planned_usable_session": "2021-02-02"}
        instance = parse_instance(instance_xml([a_fact()], cik=CIK), "x.xml")
        entry = {"status": "FETCHED", "share_facts": fp.share_facts(instance, cik=CIK), "cover": {"common_symbols": []}}
        return {"filings": [filing], "accounting": {filing["accession"]: entry}, "quarterly": {}}

    def formation(self):
        return {"formation_session": FORMATION, "selected_cik": CIK, "security_count": 1,
                "members": [{"member_symbol": "AAA", "identity_symbol": "AAA"}]}

    def price_db(self, close):
        connection = sqlite3.connect(":memory:")
        connection.row_factory = sqlite3.Row
        connection.execute("CREATE TABLE bars_daily (symbol, trade_date, raw_close, adj_close, source, source_version)")
        if close is not None:
            connection.execute("INSERT INTO bars_daily VALUES ('AAA', ?, ?, 999, ?, ?)", (D, close, runner.PRICE_SOURCE, runner.PRICE_VERSION))
        return connection

    def test_split_boundary_row_is_missing(self):
        splits = {"AAA": {"status": "FETCHED", "events": [["2021-01-20", "2/1"]]}}
        result = runner.research_me(self.price_db(10.0), self.formation(), self.record(), splits, [D])
        self.assertEqual(result["me_status"], fp.ME_MISSING_SPLIT_BOUNDARY)
        self.assertNotIn("me_value", result)

    def test_missing_december_raw_close_is_missing(self):
        splits = {"AAA": {"status": "FETCHED", "events": []}}
        result = runner.research_me(self.price_db(None), self.formation(), self.record(), splits, [D])
        self.assertEqual(result["me_status"], fp.ME_MISSING_PRICE)

    def test_me_reads_only_december_raw_close_and_no_returns(self):
        splits = {"AAA": {"status": "FETCHED", "events": []}}
        connection = self.price_db(12.5)
        statements = []
        connection.set_trace_callback(statements.append)
        result = runner.research_me(connection, self.formation(), self.record(), splits, [D])
        self.assertEqual(result["me_status"], fp.RESEARCH_SINGLE_CLASS_ME)
        self.assertEqual(result["me_value"], "12500.0")
        self.assertTrue(statements)
        for sql in statements:
            self.assertIn("SELECT raw_close FROM bars_daily", sql)
            self.assertIn(f"'{D}'", sql)
        source = (TRADING_ROOT / "selftest" / "qv_phase0_research_fastpath.py").read_text()
        for forbidden in ("adj_close", "forward_return", "holdout", "backtest_trades"):
            self.assertNotIn(forbidden, source)


class ScorecardTest(unittest.TestCase):
    def test_coverage_start_needs_three_consecutive_years(self):
        self.assertEqual(fp.coverage_start({2010: 0.9, 2011: 0.84, 2012: 0.9, 2013: 0.86, 2014: 0.88}), 2012)
        self.assertIsNone(fp.coverage_start({2010: 0.9, 2011: 0.9, 2013: 0.9}))
        self.assertEqual(fp.preflight_verdict(start=None, aggregate_joint=None, min_annual=None, me_coverage=None)["result"], "DATA_NOT_READY_FAST_PATH")


if __name__ == "__main__":
    unittest.main()
