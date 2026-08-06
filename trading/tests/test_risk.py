"""9.2 하드 한도. 각 한도가 표의 **조치** 열대로 동작하는지 본다.

상관 한도는 판정 불가를 무상관으로 넘기지 않는지가 핵심이다. 그쪽으로 새면 한도가
조용히 비활성화된다.
"""

from __future__ import annotations

import dataclasses
import sqlite3
import sys
import unittest
from pathlib import Path

TRADING_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TRADING_ROOT))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import synthetic  # noqa: E402
from backtest import store  # noqa: E402
from backtest.data import (  # noqa: E402
    PointInTimeSnapshot,
    load_bars_csv,
    load_securities_csv,
    register_source,
)
from backtest.policy import DEFAULT_PAPER_POLICY  # noqa: E402
from backtest.risk import account_gate, correlated_peers, evaluate_candidate  # noqa: E402
from backtest.sizing import OpenPosition  # noqa: E402
from test_sizing import account, make_candidate, make_regime  # noqa: E402

VERSION = "v1"
DAYS = 80
LIMITS = DEFAULT_PAPER_POLICY.limits
EQUITY = 100_000.0

# 하루씩 번갈아 오르내리는 경로. BBB는 AAA와 같은 방향, CCC는 정확히 반대다.
SWING = 0.02


def _with(state, **changes):
    return dataclasses.replace(state, **changes)


def swinging(count: int, inverted: bool = False) -> list[float]:
    return [
        100.0 * (1 + SWING) if (index % 2 == 1) != inverted else 100.0
        for index in range(count)
    ]


def build() -> sqlite3.Connection:
    dates = synthetic.sessions(DAYS)
    connection = store.connect_memory()
    register_source(connection, "synthetic", VERSION, "bars")
    register_source(
        connection, "synthetic", VERSION, "securities", survivorship_biased=False
    )
    load_bars_csv(
        connection,
        synthetic.to_csv(
            synthetic.rows("SPY", dates, synthetic.constant_closes(DAYS, 400.0)),
            synthetic.rows("AAA", dates, swinging(DAYS)),
            synthetic.rows("BBB", dates, swinging(DAYS)),
            synthetic.rows("CCC", dates, swinging(DAYS, inverted=True)),
            # AAA와 같은 섹터지만 반대로 움직인다. 섹터 한도만 걸리는 대조군이다.
            synthetic.rows("DDD", dates, swinging(DAYS, inverted=True)),
            # 이력이 짧아 상관을 계산할 수 없는 종목.
            synthetic.rows("SHORT", dates[-30:], synthetic.constant_closes(30, 100.0)),
            # 분류가 없는 종목은 아래 securities에 넣지 않는다.
            synthetic.rows("NOSECTOR", dates, swinging(DAYS)),
        ),
        "synthetic",
        VERSION,
    )
    load_securities_csv(
        connection,
        "symbol,sector\nAAA,TECH\nBBB,TECH\nCCC,ENERGY\nDDD,TECH\nSHORT,ENERGY\n",
        "synthetic",
        VERSION,
    )
    return connection


class AccountGateTest(unittest.TestCase):
    def test_clean_account_passes(self):
        gate = account_gate(account(EQUITY))
        self.assertFalse(gate.blocked)
        self.assertFalse(gate.halt)
        self.assertEqual(gate.risk_budget_factor, 1.0)
        self.assertEqual(gate.quantity_factor, 1.0)
        self.assertEqual(gate.reasons, ("ALL_CLEAR",))

    def test_daily_loss_stops_new_orders(self):
        gate = account_gate(_with(account(EQUITY), daily_pnl_fraction=-0.010))
        self.assertTrue(gate.blocked)
        self.assertIn("DAILY_LOSS_LIMIT", gate.reasons)

    def test_prior_week_loss_halves_the_risk_budget(self):
        gate = account_gate(_with(account(EQUITY), prior_week_pnl_fraction=-0.025))
        self.assertFalse(gate.blocked)
        self.assertAlmostEqual(gate.risk_budget_factor, 0.50)
        self.assertIn("WEEKLY_LOSS_BUDGET_CUT", gate.reasons)

    def test_drawdown_tiers(self):
        cases = (
            (0.04, False, False, 1.0, "ALL_CLEAR"),
            (0.05, False, False, 0.5, "DRAWDOWN_QUANTITY_CUT"),
            (0.07, True, False, 1.0, "DRAWDOWN_BLOCK_ENTRIES"),
            (0.10, True, True, 1.0, "DRAWDOWN_HALT"),
            (0.12, True, True, 1.0, "DRAWDOWN_KILLSWITCH"),
        )
        for drawdown, blocked, halt, quantity_factor, reason in cases:
            gate = account_gate(_with(account(EQUITY), drawdown=drawdown))
            self.assertEqual(gate.blocked, blocked, msg=str(drawdown))
            self.assertEqual(gate.halt, halt, msg=str(drawdown))
            self.assertAlmostEqual(gate.quantity_factor, quantity_factor, msg=str(drawdown))
            self.assertIn(reason, gate.reasons, msg=str(drawdown))


class PortfolioLimitTest(unittest.TestCase):
    def setUp(self):
        self.connection = build()
        self.snapshot = PointInTimeSnapshot(
            self.connection, synthetic.sessions(DAYS)[-1], VERSION
        )

    def evaluate(self, state, symbol="AAA", **kwargs):
        return evaluate_candidate(
            make_candidate(symbol=symbol), state, make_regime(), self.snapshot, **kwargs
        )

    def test_clean_account_gets_the_risk_based_quantity(self):
        result = self.evaluate(account(EQUITY))
        self.assertTrue(result)
        self.assertEqual(result.intent.shares, 25)
        self.assertEqual(result.intent.binding_constraint, "RISK")

    def test_blocked_gate_rejects_with_its_reason(self):
        result = self.evaluate(_with(account(EQUITY), drawdown=0.08))
        self.assertFalse(result)
        self.assertEqual(result.rejection.reason, "DRAWDOWN_BLOCK_ENTRIES")

    def test_gate_multipliers_reach_the_quantity(self):
        weekly = self.evaluate(_with(account(EQUITY), prior_week_pnl_fraction=-0.03))
        self.assertEqual(weekly.intent.shares, 12)  # 위험 예산 절반

        drawdown = self.evaluate(_with(account(EQUITY), drawdown=0.06))
        self.assertEqual(drawdown.intent.shares, 12)  # 수량 절반
        self.assertAlmostEqual(drawdown.intent.reduction_factor, 0.5)

    def test_already_held_symbols_are_not_re_entered(self):
        held = (OpenPosition("AAA", 10, 100.0, 90.0, "TECH"),)
        result = self.evaluate(account(EQUITY, positions=held))
        self.assertFalse(result)
        self.assertEqual(result.rejection.reason, "ALREADY_HELD")

    def test_max_positions_makes_candidates_wait(self):
        held = tuple(
            OpenPosition(f"H{index}", 1, 100.0, 90.0, "ENERGY")
            for index in range(LIMITS.max_positions)
        )
        result = self.evaluate(account(EQUITY, positions=held))
        self.assertFalse(result)
        self.assertEqual(result.rejection.reason, "MAX_POSITIONS_REACHED")

    def test_unknown_sector_blocks_entry_by_default(self):
        result = self.evaluate(account(EQUITY), symbol="NOSECTOR")
        self.assertFalse(result)
        self.assertEqual(result.rejection.reason, "SECTOR_UNKNOWN")

        allowed = self.evaluate(account(EQUITY), symbol="NOSECTOR", require_sector=False)
        self.assertTrue(allowed)

    def test_sector_weight_skips_the_candidate(self):
        # TECH에 24,000달러가 있고 25주(2,531달러)를 더하면 25% 상한을 넘는다.
        # DDD는 AAA와 반대로 움직여 상관 상한이 먼저 줄이지 않는다.
        held = (OpenPosition("DDD", 240, 100.0, 99.0, "TECH"),)
        result = self.evaluate(account(EQUITY, positions=held))
        self.assertFalse(result)
        self.assertEqual(result.rejection.reason, "SECTOR_WEIGHT_EXCEEDED")

    def test_a_correlated_peer_is_reduced_before_the_sector_limit_rejects(self):
        """상관 한도의 조치는 축소이므로, 줄여서 섹터 상한 안에 들면 진입한다."""
        held = (OpenPosition("BBB", 240, 100.0, 99.0, "TECH"),)
        result = self.evaluate(account(EQUITY, positions=held))
        self.assertTrue(result)
        self.assertEqual(result.intent.shares, 9)
        self.assertEqual(result.intent.binding_constraint, "CORRELATION")

    def test_total_planned_risk_blocks_new_entries(self):
        # 열린 위험 1,100달러 + 신규 250달러 = 1,350달러 > 상한 1,250달러.
        held = (OpenPosition("CCC", 100, 100.0, 89.0, "ENERGY"),)
        result = self.evaluate(account(EQUITY, positions=held))
        self.assertFalse(result)
        self.assertEqual(result.rejection.reason, "TOTAL_PLANNED_RISK_EXCEEDED")

    def test_open_risk_ignores_stops_above_the_current_price(self):
        """추적손절이 현재가 위로 올라간 포지션은 위험 예산을 쓰지 않는다."""
        state = account(
            EQUITY, positions=(OpenPosition("CCC", 100, 100.0, 105.0, "ENERGY"),)
        )
        self.assertAlmostEqual(state.open_risk, 0.0)
        self.assertTrue(self.evaluate(state))


class CorrelationLimitTest(unittest.TestCase):
    def setUp(self):
        self.connection = build()
        self.snapshot = PointInTimeSnapshot(
            self.connection, synthetic.sessions(DAYS)[-1], VERSION
        )

    def peers(self, positions, threshold=None):
        return correlated_peers(
            self.snapshot,
            "AAA",
            positions,
            LIMITS.correlation_threshold if threshold is None else threshold,
        )

    def test_same_direction_names_are_correlated(self):
        found = self.peers((OpenPosition("BBB", 1, 100.0, 90.0, "TECH"),))
        self.assertEqual(len(found), 1)
        self.assertAlmostEqual(found[0].coefficient, 1.0, places=9)

    def test_opposite_direction_names_are_not(self):
        self.assertEqual(self.peers((OpenPosition("CCC", 1, 100.0, 90.0, "ENERGY"),)), ())

    def test_uncomputable_correlation_counts_as_correlated(self):
        found = self.peers((OpenPosition("SHORT", 1, 100.0, 90.0, "ENERGY"),))
        self.assertEqual(len(found), 1)
        self.assertIsNone(found[0].coefficient)

    def test_correlated_pair_weight_reduces_the_quantity(self):
        # BBB에 24,000달러가 있으므로 쌍 합산 25% 상한까지 1,000달러(9주)만 남는다.
        held = (OpenPosition("BBB", 240, 100.0, 99.0, "TECH"),)
        result = evaluate_candidate(
            make_candidate(symbol="AAA"),
            account(EQUITY, positions=held),
            make_regime(),
            self.snapshot,
            require_sector=False,
        )
        self.assertTrue(result)
        self.assertEqual(result.intent.shares, 9)
        self.assertEqual(result.intent.binding_constraint, "CORRELATION")

    def test_uncorrelated_peer_does_not_cap_anything(self):
        held = (OpenPosition("CCC", 240, 100.0, 99.5, "ENERGY"),)
        result = evaluate_candidate(
            make_candidate(symbol="AAA"),
            account(EQUITY, positions=held),
            make_regime(),
            self.snapshot,
        )
        self.assertTrue(result)
        self.assertEqual(result.intent.shares, 25)
        self.assertEqual(result.intent.binding_constraint, "RISK")

    def test_a_full_correlated_pair_rejects(self):
        held = (OpenPosition("BBB", 249, 100.0, 99.5, "TECH"),)
        result = evaluate_candidate(
            make_candidate(symbol="AAA"),
            account(EQUITY, positions=held),
            make_regime(),
            self.snapshot,
            require_sector=False,
        )
        self.assertFalse(result)
        self.assertEqual(result.rejection.reason, "CORRELATION_ALLOWS_NO_SHARES")


if __name__ == "__main__":
    unittest.main()
