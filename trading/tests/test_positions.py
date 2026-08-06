"""청산 규칙. 설계 7.5.

가장 중요한 테스트 두 개다.

- `test_todays_close_does_not_move_todays_stop`: 오늘 종가로 올린 추적손절을 오늘 저가에
  대고 검사하면 룩어헤드다. 손절 검사가 종가 반영보다 먼저여야 한다.
- `test_the_stop_never_moves_down`: 추적손절 활성화 순간의 손절가가 초기 손절가와 같아야
  손절가가 내려가지 않는다. ATR를 진입 시점에 고정한 이유다.
"""

from __future__ import annotations

import sys
import unittest
from dataclasses import replace
from pathlib import Path

TRADING_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TRADING_ROOT))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from backtest.costs import CostModel  # noqa: E402
from backtest.positions import (  # noqa: E402
    EARNINGS_EXIT_SESSIONS,
    MAX_HOLD_SESSIONS,
    TIME_STOP_SESSIONS,
    Position,
    PositionError,
    adjust_for_corporate_action,
    run_session,
)
from test_execution import bar  # noqa: E402

FREE = CostModel(slippage_bps=0.0, spread_bps=0.0, commission_bps=0.0, sell_tax_bps=0.0)
ENTRY = 100.0
ATR = 5.0


def position(**changes) -> Position:
    """진입가 100, ATR 5 → 초기 손절 90, 추적 활성화 종가 105."""
    base = Position(
        symbol="AAA",
        shares=10,
        entry_date="2026-08-06",
        entry_price=ENTRY,
        atr14=ATR,
        highest_close=ENTRY,
    )
    return replace(base, **changes) if changes else base


def session(pos, current, previous=None, **kwargs):
    return run_session(
        pos,
        current,
        previous or bar("2026-08-06", open_=ENTRY),
        costs=FREE,
        **kwargs,
    )


class StopLevelTest(unittest.TestCase):
    def test_initial_stop_is_two_atr_below_entry(self):
        self.assertAlmostEqual(position().initial_stop, 90.0)
        self.assertAlmostEqual(position().stop_price, 90.0)
        self.assertFalse(position().trailing_active)
        self.assertEqual(position().stop_reason, "INITIAL_STOP")

    def test_trailing_activates_at_one_atr_of_profit(self):
        just_under = position(highest_close=104.99)
        self.assertFalse(just_under.trailing_active)
        self.assertAlmostEqual(just_under.stop_price, 90.0)

        activated = position(highest_close=105.0)
        self.assertTrue(activated.trailing_active)
        self.assertEqual(activated.stop_reason, "TRAILING_STOP")

    def test_the_stop_never_moves_down(self):
        """활성화 순간의 추적손절가는 초기 손절가와 정확히 같다."""
        at_activation = position(highest_close=ENTRY + ATR)
        self.assertAlmostEqual(at_activation.stop_price, at_activation.initial_stop)

        previous = position().stop_price
        for close in (101.0, 105.0, 106.0, 110.0, 110.0, 120.0):
            # 최고 종가는 단조 증가하므로 손절가도 내려갈 수 없다.
            held = position(highest_close=max(close, ENTRY))
            self.assertGreaterEqual(held.stop_price + 1e-12, previous)
            previous = held.stop_price
        self.assertAlmostEqual(position(highest_close=120.0).stop_price, 105.0)

    def test_unrealized_r_uses_the_entry_risk(self):
        self.assertAlmostEqual(position().unrealized_r(110.0), 1.0)
        self.assertAlmostEqual(position().unrealized_r(90.0), -1.0)

    def test_impossible_positions_are_refused(self):
        with self.assertRaises(PositionError):
            position(shares=0)
        with self.assertRaises(PositionError):
            position(atr14=0.0)


class SessionOrderTest(unittest.TestCase):
    def test_todays_close_does_not_move_todays_stop(self):
        """오늘 종가로 손절가를 올린 뒤 오늘 저가를 보면 미래를 보고 손절하는 것이다."""
        held = position(highest_close=110.0)  # 손절가 95
        # 종가 120이면 손절가가 105로 오르지만, 오늘 저가 100은 아직 95 기준이다.
        result = session(held, bar("2026-08-07", open_=118.0, low=100.0, close=120.0))
        self.assertFalse(result.closed)
        self.assertAlmostEqual(result.position.highest_close, 120.0)
        self.assertAlmostEqual(result.position.stop_price, 105.0)

        # 다음 세션의 같은 저가는 이제 손절이다.
        after = run_session(
            result.position,
            bar("2026-08-10", open_=118.0, low=100.0, close=101.0),
            bar("2026-08-07", open_=118.0, close=120.0),
            costs=FREE,
        )
        self.assertTrue(after.closed)
        self.assertEqual(after.reason, "TRAILING_STOP")
        self.assertAlmostEqual(after.fill.reference_price, 105.0)

    def test_stop_touched_intraday_uses_the_stop_price(self):
        result = session(position(), bar("2026-08-07", open_=95.0, low=89.0, close=92.0))
        self.assertTrue(result.closed)
        self.assertEqual(result.reason, "INITIAL_STOP")
        self.assertEqual(result.fill.reason, "STOP_FILL")
        self.assertAlmostEqual(result.fill.reference_price, 90.0)
        self.assertIsNone(result.position)

    def test_gap_below_the_stop_fills_at_the_open(self):
        result = session(position(), bar("2026-08-07", open_=85.0, low=84.0, close=86.0))
        self.assertEqual(result.reason, "INITIAL_STOP")
        self.assertEqual(result.fill.reason, "GAP_FILL")
        self.assertAlmostEqual(result.fill.reference_price, 85.0)

    def test_sessions_held_counts_from_the_entry_session(self):
        held = position()
        self.assertEqual(held.sessions_held, 0)
        result = session(held, bar("2026-08-07", open_=101.0, close=102.0))
        self.assertEqual(result.position.sessions_held, 1)

    def test_a_bar_must_come_after_the_previous_one(self):
        with self.assertRaises(PositionError):
            session(position(), bar("2026-08-05", open_=100.0))


class TimeExitTest(unittest.TestCase):
    def test_time_stop_schedules_the_next_open(self):
        stalled = position(sessions_held=TIME_STOP_SESSIONS - 1, highest_close=102.0)
        scheduled = session(stalled, bar("2026-08-07", open_=101.0, close=101.0))
        self.assertFalse(scheduled.closed)
        self.assertEqual(scheduled.reason, "TIME_STOP")
        self.assertEqual(scheduled.position.pending_exit, "TIME_STOP")

        executed = run_session(
            scheduled.position,
            bar("2026-08-10", open_=99.0, low=98.0, close=100.0),
            bar("2026-08-07", open_=101.0, close=101.0),
            costs=FREE,
        )
        self.assertTrue(executed.closed)
        self.assertEqual(executed.reason, "TIME_STOP")
        self.assertEqual(executed.fill.reason, "OPEN_EXIT")
        self.assertAlmostEqual(executed.fill.reference_price, 99.0)

    def test_a_position_that_reached_one_atr_is_not_time_stopped(self):
        """+1 ATR에 닿은 적이 있으면 시간손절 대상이 아니다."""
        ran = position(sessions_held=TIME_STOP_SESSIONS - 1, highest_close=106.0)
        result = session(ran, bar("2026-08-07", open_=103.0, low=102.0, close=103.0))
        self.assertFalse(result.closed)
        self.assertIsNone(result.reason)
        self.assertIsNone(result.position.pending_exit)

    def test_max_hold_wins_over_the_time_stop(self):
        old = position(sessions_held=MAX_HOLD_SESSIONS - 1, highest_close=101.0)
        result = session(old, bar("2026-08-07", open_=101.0, close=101.0))
        self.assertEqual(result.reason, "MAX_HOLD")
        self.assertEqual(result.position.pending_exit, "MAX_HOLD")

    def test_max_hold_applies_to_a_winning_position_too(self):
        winner = position(sessions_held=MAX_HOLD_SESSIONS - 1, highest_close=130.0)
        result = session(winner, bar("2026-08-07", open_=128.0, low=120.0, close=129.0))
        self.assertEqual(result.reason, "MAX_HOLD")

    def test_a_pending_exit_beats_a_stop_on_the_same_bar(self):
        """예약 청산은 시초가에 나가므로 그날 장중 손절보다 먼저다."""
        pending = position(pending_exit="TIME_STOP", highest_close=101.0)
        result = session(pending, bar("2026-08-07", open_=95.0, low=80.0, close=85.0))
        self.assertEqual(result.reason, "TIME_STOP")
        self.assertEqual(result.fill.reason, "OPEN_EXIT")
        self.assertAlmostEqual(result.fill.reference_price, 95.0)


class EarningsExitTest(unittest.TestCase):
    def test_exit_at_the_close_before_earnings(self):
        # 2026-08-07은 금요일이다. 실적이 다음 주 화요일이면 남은 세션은 1이다.
        result = session(
            position(),
            bar("2026-08-07", open_=101.0, close=102.0),
            next_earnings="2026-08-11",
        )
        self.assertTrue(result.closed)
        self.assertEqual(result.reason, "EARNINGS")
        self.assertEqual(result.fill.reason, "CLOSE_EXIT")
        self.assertAlmostEqual(result.fill.reference_price, 102.0)

    def test_distant_earnings_do_not_trigger(self):
        result = session(
            position(),
            bar("2026-08-07", open_=101.0, close=102.0),
            next_earnings="2026-08-20",
        )
        self.assertFalse(result.closed)
        self.assertIsNone(result.reason)

    def test_the_buffer_is_one_session_while_holidays_are_unknown(self):
        self.assertEqual(EARNINGS_EXIT_SESSIONS, 1)

    def test_earnings_already_past_is_flagged_and_closed(self):
        """이 경로가 도는 것 자체가 일정이 늦게 잡혔다는 신호다."""
        result = session(
            position(),
            bar("2026-08-07", open_=101.0, close=102.0),
            next_earnings="2026-08-06",
        )
        self.assertTrue(result.closed)
        self.assertEqual(result.reason, "EARNINGS_OVERDUE")

    def test_a_stop_still_wins_over_an_earnings_exit(self):
        result = session(
            position(),
            bar("2026-08-07", open_=95.0, low=88.0, close=92.0),
            next_earnings="2026-08-11",
        )
        self.assertEqual(result.reason, "INITIAL_STOP")


class CorporateActionTest(unittest.TestCase):
    def test_a_two_for_one_split_halves_prices_and_doubles_shares(self):
        held = position(highest_close=110.0)
        adjusted = adjust_for_corporate_action(
            held, bar("2026-08-06", scale=2.0), bar("2026-08-07", scale=1.0)
        )
        self.assertEqual(adjusted.shares, 20)
        self.assertAlmostEqual(adjusted.entry_price, 50.0)
        self.assertAlmostEqual(adjusted.atr14, 2.5)
        self.assertAlmostEqual(adjusted.highest_close, 55.0)
        # 손절가도 같은 비율이라 경제적으로 같은 자리다.
        self.assertAlmostEqual(adjusted.stop_price, held.stop_price / 2)
        self.assertAlmostEqual(
            adjusted.shares * adjusted.entry_price, held.shares * held.entry_price
        )

    def test_no_action_leaves_the_position_alone(self):
        held = position()
        self.assertIs(
            adjust_for_corporate_action(
                held, bar("2026-08-06"), bar("2026-08-07")
            ),
            held,
        )

    def test_the_split_is_applied_before_the_stop_check(self):
        """조정 없이 보면 분할일 저가가 손절가를 뚫은 것처럼 보인다."""
        held = position()  # 손절가 90 (분할 전 단위)
        result = session(
            held,
            bar("2026-08-07", open_=50.5, low=49.0, close=51.0, scale=1.0),
            bar("2026-08-06", open_=101.0, close=101.0, scale=2.0),
        )
        self.assertFalse(result.closed)
        self.assertEqual(result.position.shares, 20)
        self.assertAlmostEqual(result.position.stop_price, 45.0)

    def test_fractional_shares_are_floored(self):
        # 3:2 분할이면 배율이 2/3이고 5주는 7.5주가 된다. 7주로 내린다.
        held = position(shares=5)
        adjusted = adjust_for_corporate_action(
            held, bar("2026-08-06", scale=3.0), bar("2026-08-07", scale=2.0)
        )
        self.assertEqual(adjusted.shares, 7)


class BridgeTest(unittest.TestCase):
    def test_open_position_carries_the_current_stop(self):
        held = position(highest_close=120.0)
        view = held.as_open_position(118.0, sector="TECH")
        self.assertEqual(view.symbol, "AAA")
        self.assertEqual(view.shares, 10)
        self.assertAlmostEqual(view.market_price, 118.0)
        self.assertAlmostEqual(view.stop_price, 105.0)
        self.assertEqual(view.sector, "TECH")
        self.assertAlmostEqual(view.open_risk, 10 * 13.0)


if __name__ == "__main__":
    unittest.main()
