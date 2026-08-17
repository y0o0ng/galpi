"""PR #19 위험 의미론의 처치와 사전등록 판정.

**가장 중요한 것은 다섯이다.**

1. `HardStopLevelTest` — 이 모드는 **`initial_stop`만** 읽는다. `stop_price`를 쓰면
   +1 ATR 뒤 추적손절이 조용히 살아나 처치가 둘이 된다.
2. `ExitModeTest` — 살아 있는 청산은 `INITIAL_STOP`과 `MAX_HOLD` 둘뿐이다. 시간손절·
   실적 청산은 여전히 꺼져 있다.
3. `RegressionTest`·`LoopRegressionTest` — 기존 `CORE`·`FIXED_HOLD`·`SIGNAL_INVALIDATION`
   결과가 그대로다. 새 모드를 더하면서 기존 실행이 바뀌면 PR #10~#18의 결과가 전부 비교
   불가가 된다.
4. `MechanismTest` — planned stop risk를 **다시 계산하지 않는다.** 엔진 값과 갈리면
   조용히 넘어가는 대신 멈춘다.
5. `VerdictTest` — A는 여덟 조건 전부를 요구하고 하나라도 실패하면 B다. 중간 label이 없다.
"""

from __future__ import annotations

import itertools
import sys
import unittest
from dataclasses import fields, replace
from pathlib import Path

TRADING_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TRADING_ROOT))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import synthetic  # noqa: E402
import test_loop  # noqa: E402
from backtest.loop import EntryEvent, Trade, run_backtest  # noqa: E402
from backtest.modes import (  # noqa: E402
    CORE_EXITS,
    EXIT_MODES,
    FIXED_HOLD_EXITS,
    HARD_STOP_EXITS,
    SIGNAL_INVALIDATION_EXITS,
    TREND_GATE_REGIME,
)
from backtest.policy import DEFAULT_PARAMETERS as PARAMS  # noqa: E402
from backtest.positions import (  # noqa: E402
    PositionError,
    adjust_for_corporate_action,
    hold_untraded,
)
from backtest.sizing import SizedIntent  # noqa: E402
from core import CORES  # noqa: E402
from core.definition import RULE_FIELDS  # noqa: E402
from selftest.risk_semantics_run import (  # noqa: E402
    ARMS,
    CHALLENGER,
    CONDITION_LABELS,
    CONTROL,
    GAP_FILL,
    INITIAL_STOP,
    LABEL_STOP_DEFINED,
    LABEL_VOLATILITY_SCALED,
    PROMOTES,
    STOP_FILL,
    VERDICTS,
    _consequence,
    classify,
    conditions,
    planned,
    planned_stop_risk,
    run_id_for,
    UNCHANGED_KEYS,
    prior_control,
    stop_mechanism,
    treatment,
)
from test_execution import bar  # noqa: E402
from test_positions import ATR, ENTRY, position, session  # noqa: E402

MAX_HOLD = PARAMS.max_hold_sessions
TIME_STOP = PARAMS.time_stop_sessions
# 진입 100 · ATR 5 → 초기 손절 90, 추적 활성화 종가 105.
INITIAL_STOP_PRICE = ENTRY - PARAMS.stop_atr_multiple * ATR


def hard(pos, current, **kwargs):
    return session(pos, current, exit_mode=HARD_STOP_EXITS, **kwargs)


class ModeRegistryTest(unittest.TestCase):
    def test_the_mode_set_is_exactly_four(self):
        self.assertEqual(
            set(EXIT_MODES),
            {
                CORE_EXITS,
                FIXED_HOLD_EXITS,
                SIGNAL_INVALIDATION_EXITS,
                HARD_STOP_EXITS,
            },
        )

    def test_the_name_says_the_holding_period_survives(self):
        """`HARD_STOP`이 아니라 `FIXED_HOLD_HARD_STOP`이다. K42가 그대로 살아 있다."""
        self.assertEqual(HARD_STOP_EXITS, "FIXED_HOLD_HARD_STOP")

    def test_an_unknown_mode_is_still_refused(self):
        with self.assertRaises(PositionError):
            session(position(), bar("2026-08-07"), exit_mode="HARD_STOP")


class HardStopLevelTest(unittest.TestCase):
    """**`initial_stop`만 읽는다.** 이 클래스가 이 PR의 핵심 불변식이다."""

    def test_the_stop_is_entry_fill_minus_two_atr(self):
        self.assertAlmostEqual(position().initial_stop, INITIAL_STOP_PRICE)
        self.assertAlmostEqual(INITIAL_STOP_PRICE, 90.0)

    def test_it_exits_when_the_low_touches_the_initial_stop(self):
        result = hard(position(), bar("2026-08-07", open_=95.0, low=89.0, close=91.0))
        self.assertTrue(result.closed)
        self.assertEqual(result.reason, INITIAL_STOP)
        self.assertEqual(result.fill.reason, STOP_FILL)
        self.assertAlmostEqual(result.fill.reference_price, INITIAL_STOP_PRICE)

    def test_it_holds_when_the_low_stays_above_the_stop(self):
        result = hard(position(), bar("2026-08-07", open_=95.0, low=90.5, close=94.0))
        self.assertFalse(result.closed)
        self.assertIsNone(result.position.pending_exit)

    def test_a_gap_below_the_stop_fills_at_the_actual_open(self):
        result = hard(position(), bar("2026-08-07", open_=80.0, low=78.0, close=79.0))
        self.assertTrue(result.closed)
        self.assertEqual(result.fill.reason, GAP_FILL)
        self.assertAlmostEqual(result.fill.reference_price, 80.0)

    def test_the_trailing_stop_never_activates(self):
        """**최고 종가가 진입가 +1 ATR을 넘어도 손절가가 올라가지 않는다.**

        `stop_price`를 읽었다면 여기서 손절이 걸린다(추적손절가 130 − 3×5 = 115).
        `initial_stop`은 여전히 90이므로 걸리지 않아야 한다.
        """
        winner = position(sessions_held=5, highest_close=130.0)
        self.assertTrue(winner.trailing_active)
        self.assertAlmostEqual(winner.stop_price, 115.0)
        self.assertAlmostEqual(winner.initial_stop, INITIAL_STOP_PRICE)

        result = hard(winner, bar("2026-08-07", open_=120.0, low=100.0, close=110.0))
        self.assertFalse(result.closed)

    def test_the_same_bar_does_stop_out_in_core_mode(self):
        """앞 테스트가 픽스처 때문에 통과하는 것이 아님을 보인다."""
        winner = position(sessions_held=5, highest_close=130.0)
        result = session(winner, bar("2026-08-07", open_=120.0, low=100.0, close=110.0),
                         exit_mode=CORE_EXITS)
        self.assertTrue(result.closed)
        self.assertEqual(result.reason, "TRAILING_STOP")

    def test_a_winner_still_stops_only_at_the_original_level(self):
        winner = position(sessions_held=5, highest_close=130.0)
        result = hard(winner, bar("2026-08-07", open_=120.0, low=89.0, close=95.0))
        self.assertTrue(result.closed)
        self.assertEqual(result.reason, INITIAL_STOP)
        self.assertAlmostEqual(result.fill.reference_price, INITIAL_STOP_PRICE)

    def test_todays_close_does_not_move_todays_stop_check(self):
        """손절 검사(3번)가 종가 반영(4번)보다 먼저다. 순서를 바꾸지 않았다."""
        result = hard(position(), bar("2026-08-07", open_=95.0, low=89.0, close=200.0))
        self.assertTrue(result.closed)
        self.assertEqual(result.reason, INITIAL_STOP)

    def test_the_stop_survives_a_split_in_the_right_price_unit(self):
        """기업행동 뒤에도 손절폭이 `2 × ATR`이고 가격 단위가 오늘 것이다."""
        before = bar("2026-08-06", open_=ENTRY, close=ENTRY)
        after = replace(bar("2026-08-07", open_=50.0, low=44.0, close=50.0),
                        raw_close=50.0, adj_close=100.0)
        moved = adjust_for_corporate_action(position(), before, after)
        self.assertAlmostEqual(moved.entry_price, 50.0)
        self.assertAlmostEqual(moved.atr14, 2.5)
        self.assertAlmostEqual(moved.initial_stop, 45.0)
        self.assertAlmostEqual(
            moved.entry_price - moved.initial_stop,
            PARAMS.stop_atr_multiple * moved.atr14,
        )

        result = hard(position(), after, previous=before)
        self.assertTrue(result.closed)
        self.assertEqual(result.reason, INITIAL_STOP)
        self.assertAlmostEqual(result.fill.reference_price, 45.0)


class ExitModeTest(unittest.TestCase):
    """살아 있는 청산은 `INITIAL_STOP`과 `MAX_HOLD` 둘뿐이다."""

    def test_the_holding_period_still_ends_the_trade(self):
        old = position(sessions_held=MAX_HOLD - 1, highest_close=101.0)
        result = hard(old, bar("2026-08-07", open_=101.0, close=101.0))
        self.assertEqual(result.reason, "MAX_HOLD")

    def test_the_time_stop_never_fires(self):
        stalled = position(sessions_held=TIME_STOP - 1, highest_close=102.0)
        result = hard(stalled, bar("2026-08-07", open_=101.0, close=101.0))
        self.assertIsNone(result.position.pending_exit)

    def test_earnings_never_closes_the_position(self):
        for earnings in ("2026-08-11", "2026-08-01"):
            with self.subTest(earnings=earnings):
                result = hard(position(), bar("2026-08-07", open_=101.0, close=102.0),
                              next_earnings=earnings)
                self.assertFalse(result.closed)

    def test_an_untradeable_session_only_ages(self):
        result = hold_untraded(position(sessions_held=3), "2026-08-07",
                               exit_mode=HARD_STOP_EXITS)
        self.assertFalse(result.closed)
        self.assertEqual(result.position.sessions_held, 4)

    def test_it_is_fixed_hold_plus_a_stop_and_nothing_else(self):
        """**손절이 안 걸리는 바에서는 `FIXED_HOLD`와 같은 함수여야 한다.**"""
        cases = (
            (position(), bar("2026-08-07", open_=101.0, close=102.0), {}),
            (position(sessions_held=TIME_STOP - 1, highest_close=102.0),
             bar("2026-08-07", open_=101.0, close=101.0), {}),
            (position(sessions_held=MAX_HOLD - 1),
             bar("2026-08-07", open_=101.0, close=101.0), {}),
            (position(), bar("2026-08-07", open_=101.0, close=102.0),
             {"next_earnings": "2026-08-11"}),
            (position(sessions_held=5, highest_close=130.0),
             bar("2026-08-07", open_=120.0, low=100.0, close=110.0), {}),
        )
        for index, (pos, current, extra) in enumerate(cases):
            with self.subTest(case=index):
                self.assertEqual(
                    session(pos, current, exit_mode=FIXED_HOLD_EXITS, **extra),
                    session(pos, current, exit_mode=HARD_STOP_EXITS, **extra),
                )

    def test_the_stop_is_the_only_place_the_two_modes_differ(self):
        """손절이 걸리는 바에서만 갈린다."""
        hit = bar("2026-08-07", open_=95.0, low=89.0, close=91.0)
        self.assertFalse(session(position(), hit, exit_mode=FIXED_HOLD_EXITS).closed)
        self.assertTrue(session(position(), hit, exit_mode=HARD_STOP_EXITS).closed)


class RegressionTest(unittest.TestCase):
    """**기존 세 모드의 동작이 그대로다.** 깨지면 PR #10~#18이 비교 불가가 된다."""

    CASES = (
        (position(), bar("2026-08-07", open_=95.0, low=80.0, close=85.0), {}),
        (position(sessions_held=TIME_STOP - 1, highest_close=102.0),
         bar("2026-08-07", open_=101.0, close=101.0), {}),
        (position(sessions_held=MAX_HOLD - 1),
         bar("2026-08-07", open_=101.0, close=101.0), {}),
        (position(), bar("2026-08-07", open_=101.0, close=102.0),
         {"next_earnings": "2026-08-11"}),
        (position(), bar("2026-08-07", open_=101.0, close=102.0),
         {"next_earnings": "2026-08-01"}),
        (position(sessions_held=5, highest_close=130.0),
         bar("2026-08-07", open_=120.0, low=100.0, close=110.0), {}),
        (position(pending_exit="MAX_HOLD"), bar("2026-08-07", open_=99.0, close=100.0),
         {}),
    )

    def test_core_still_stops_trails_time_stops_and_exits_on_earnings(self):
        expected = (
            ("INITIAL_STOP", True),
            ("TIME_STOP", False),
            ("MAX_HOLD", False),
            ("EARNINGS", True),
            ("EARNINGS_OVERDUE", True),
            ("TRAILING_STOP", True),
            ("MAX_HOLD", True),
        )
        for (pos, current, extra), (reason, closed) in zip(self.CASES, expected):
            with self.subTest(reason=reason):
                result = session(pos, current, exit_mode=CORE_EXITS, **extra)
                self.assertEqual(result.reason, reason)
                self.assertEqual(result.closed, closed)

    def test_fixed_hold_keeps_only_the_holding_period(self):
        expected = (None, None, "MAX_HOLD", None, None, None, "MAX_HOLD")
        for (pos, current, extra), reason in zip(self.CASES, expected):
            with self.subTest(reason=reason):
                result = session(pos, current, exit_mode=FIXED_HOLD_EXITS, **extra)
                self.assertEqual(result.reason, reason)

    def test_signal_invalidation_is_unchanged_from_fixed_hold(self):
        for index, (pos, current, extra) in enumerate(self.CASES):
            with self.subTest(case=index):
                self.assertEqual(
                    session(pos, current, exit_mode=FIXED_HOLD_EXITS, **extra),
                    session(pos, current, exit_mode=SIGNAL_INVALIDATION_EXITS, **extra),
                )

    def test_a_scheduled_exit_still_fills_at_the_open_in_every_mode(self):
        scheduled = position(pending_exit="MAX_HOLD", sessions_held=MAX_HOLD)
        for mode in EXIT_MODES:
            with self.subTest(mode=mode):
                result = session(scheduled, bar("2026-08-07", open_=80.0, low=70.0),
                                 exit_mode=mode)
                self.assertTrue(result.closed)
                self.assertEqual(result.reason, "MAX_HOLD")
                self.assertEqual(result.fill.reason, "OPEN_EXIT")


class TreatmentTest(unittest.TestCase):
    """**처치는 정확히 하나다.**"""

    def test_the_only_rule_difference_is_the_exit_mode(self):
        control, stop = CORES[CONTROL], CORES[CHALLENGER]
        different = [
            field
            for field in RULE_FIELDS
            if control.run_kwargs()[field] != stop.run_kwargs()[field]
        ]
        self.assertEqual(sorted(different), ["exit_mode", "policy"])
        self.assertEqual(control.exit_mode, FIXED_HOLD_EXITS)
        self.assertEqual(stop.exit_mode, HARD_STOP_EXITS)

    def test_the_entry_gate_is_unchanged(self):
        for key in ARMS:
            self.assertEqual(CORES[key].regime_mode, TREND_GATE_REGIME)

    def test_parameters_limits_and_profile_are_identical(self):
        control, stop = CORES[CONTROL].policy, CORES[CHALLENGER].policy
        self.assertEqual(control.parameters, stop.parameters)
        self.assertEqual(control.limits, stop.limits)
        self.assertEqual(control.profile, stop.profile)
        self.assertEqual(control.strategy_version, stop.strategy_version)

    def test_sizing_inputs_are_untouched(self):
        """**`risk_per_trade`도 `stop_atr_multiple`도 바꾸지 않았다.**"""
        control, stop = CORES[CONTROL].policy, CORES[CHALLENGER].policy
        self.assertEqual(stop.profile.risk_per_trade, 0.0025)
        self.assertEqual(
            stop.parameters.stop_atr_multiple, control.parameters.stop_atr_multiple
        )
        self.assertEqual(stop.parameters.stop_atr_multiple, 2.0)

    def test_the_formation_horizon_hold_and_slots_are_unchanged(self):
        control, stop = CORES[CONTROL].policy, CORES[CHALLENGER].policy
        for name in ("rs_lookback", "rs_skip", "max_hold_sessions", "max_candidates"):
            with self.subTest(name=name):
                self.assertEqual(
                    getattr(stop.parameters, name), getattr(control.parameters, name)
                )
        self.assertEqual(stop.limits.max_positions, control.limits.max_positions)

    def test_the_signature_differs_so_the_holdout_counter_can_tell_them_apart(self):
        self.assertNotEqual(CORES[CONTROL].signature, CORES[CHALLENGER].signature)
        self.assertNotEqual(
            CORES[CONTROL].policy.policy_id, CORES[CHALLENGER].policy.policy_id
        )

    def test_exactly_four_runs(self):
        self.assertEqual(len(planned()), 4)
        self.assertEqual({core for core, _ in planned()}, set(ARMS))

    def test_the_two_arms_never_share_an_output_file(self):
        ids = [run_id_for(core, scenario) for core, scenario in planned()]
        self.assertEqual(len(set(ids)), len(ids))


def _crashing_trend(days: int, start_price: float, step: float) -> list[float]:
    """계단식으로 오르다 마지막 12세션에 무너지는 경로.

    기본 픽스처는 영원히 오르기만 해서 **손절이 한 번도 안 걸린다.** 빈 픽스처에서
    통과하는 테스트는 아무것도 잠그지 않는다.
    """
    rising = synthetic.staircase_closes(days - 12, start_price, step)
    peak = rising[-1]
    return rising + [peak * (0.93 ** (index + 1)) for index in range(12)]


class LoopRegressionTest(unittest.TestCase):
    """실제 실행으로 확인한다. **표시가 아니라 체결이 바뀌는 처치다.**"""

    @classmethod
    def setUpClass(cls):
        cls.connection, cls.dates = test_loop.build(
            spy_closes=lambda days: synthetic.growth_closes(days, 300.0, 0.0008),
            trend_closes=_crashing_trend,
        )
        cls.control = cls.run_with(FIXED_HOLD_EXITS)
        cls.treated = cls.run_with(HARD_STOP_EXITS)

    @classmethod
    def tearDownClass(cls):
        cls.connection.close()

    @classmethod
    def run_with(cls, exit_mode: str, watch: bool = False):
        core = CORES[CONTROL]
        config = test_loop.config(
            cls.dates,
            policy=core.policy,
            entry_mode=core.entry_mode,
            exit_mode=exit_mode,
            regime_mode=core.regime_mode,
            require_earnings_calendar=False,
        )
        if not watch:
            return run_backtest(cls.connection, config)
        events: list[EntryEvent] = []
        return run_backtest(cls.connection, config, entry_observer=events.append), events

    def test_the_fixture_actually_produces_a_hard_stop(self):
        """**빈 픽스처에서 통과하는 테스트는 아무것도 잠그지 않는다.**"""
        self.assertGreater(self.treated.exit_counts.get(INITIAL_STOP, 0), 0)
        self.assertGreater(len(self.control.trades), 0)

    def test_the_control_never_sees_a_stop(self):
        self.assertNotIn(INITIAL_STOP, self.control.exit_counts)
        self.assertNotIn("TRAILING_STOP", self.control.exit_counts)

    def test_no_trailing_time_or_earnings_exit_appears(self):
        for reason in ("TRAILING_STOP", "TIME_STOP", "EARNINGS", "EARNINGS_OVERDUE",
                       "MARKET_TREND_BREAK"):
            self.assertNotIn(reason, self.treated.exit_counts, reason)

    def test_the_holding_period_still_ends_trades(self):
        self.assertGreater(self.treated.exit_counts.get("MAX_HOLD", 0), 0)

    def test_every_stop_fill_is_one_of_the_two_known_reasons(self):
        for trade in self.treated.trades:
            if trade.exit_reason != INITIAL_STOP:
                continue
            self.assertIn(trade.exit_fill_reason, (STOP_FILL, GAP_FILL))

    def test_the_market_label_is_identical_in_both_arms(self):
        self.assertEqual(
            [point.market_regime for point in self.control.equity_curve],
            [point.market_regime for point in self.treated.equity_curve],
        )

    def test_the_other_modes_are_byte_identical_to_a_run_without_the_new_mode(self):
        """**기존 모드의 결과가 새 모드 추가로 바뀌면 안 된다.**"""
        for mode in (CORE_EXITS, FIXED_HOLD_EXITS, SIGNAL_INVALIDATION_EXITS):
            with self.subTest(mode=mode):
                first = self.run_with(mode)
                again = self.run_with(mode)
                self.assertEqual(first.trades, again.trades)
                self.assertEqual(first.equity_curve, again.equity_curve)
                self.assertEqual(first.exit_counts, again.exit_counts)

    def test_attaching_the_observer_changes_nothing(self):
        """**관찰자는 읽기 전용이다.**"""
        watched, events = self.run_with(HARD_STOP_EXITS, watch=True)
        self.assertEqual(watched.trades, self.treated.trades)
        self.assertEqual(watched.equity_curve, self.treated.equity_curve)
        self.assertEqual(watched.fills, self.treated.fills)
        self.assertGreater(len(events), 0)

    def test_the_mechanism_agrees_with_the_engine_on_a_real_run(self):
        watched, events = self.run_with(HARD_STOP_EXITS, watch=True)
        got = stop_mechanism(planned_stop_risk(events), watched.trades)
        self.assertEqual(
            got["initial_stop_exits"], watched.exit_counts.get(INITIAL_STOP, 0)
        )
        self.assertEqual(
            got["fill_reasons"][STOP_FILL] + got["fill_reasons"][GAP_FILL],
            got["initial_stop_exits"],
        )
        self.assertEqual(got["closed_trades"], len(watched.trades))


def _intent(shares: int, stop_distance: float) -> SizedIntent:
    return SizedIntent(
        symbol="AAA", shares=shares, original_shares=shares, reference_close=100.0,
        atr14=stop_distance / 2.0, planned_entry=100.0,
        initial_stop=100.0 - stop_distance, stop_distance=stop_distance,
        planned_risk=shares * stop_distance, planned_risk_fraction=0.0025,
        min_qty_exception=False, effective_risk_ratio=1.0,
        binding_constraint="RISK", reduction_factor=1.0,
    )


def _trade(reason: str, pnl: float, risk: float, fill_reason: str = STOP_FILL,
           held: int = 7) -> Trade:
    return Trade(
        symbol="AAA", entry_date="2026-01-02", exit_date="2026-01-12", shares=10,
        entry_price=100.0, exit_price=90.0, entry_reason="OPEN_FILL",
        exit_reason=reason, exit_fill_reason=fill_reason, fees=1.0, pnl=pnl,
        return_r=pnl / risk, mfe_r=0.1, mae_r=-1.0, sessions_held=held,
        min_qty_exception=False,
    )


RISK = 100.0
PLANNED = {("AAA", "2026-01-02"): RISK}


class MechanismTest(unittest.TestCase):
    """**planned stop risk를 다시 계산하지 않는다**(사전등록 §8)."""

    def test_it_only_counts_initial_stop_exits(self):
        trades = (
            _trade(INITIAL_STOP, -80.0, RISK),
            _trade("MAX_HOLD", 50.0, RISK),
            _trade("DELISTED_EXIT", -900.0, RISK),
        )
        got = stop_mechanism(PLANNED, trades)
        self.assertEqual(got["initial_stop_exits"], 1)
        self.assertEqual(got["closed_trades"], 3)
        self.assertAlmostEqual(got["share_of_closed_trades"], 1 / 3)

    def test_the_ratio_is_realized_loss_over_planned_risk(self):
        got = stop_mechanism(PLANNED, (_trade(INITIAL_STOP, -80.0, RISK),))
        self.assertAlmostEqual(got["realized_net_loss_dollars"]["max"], 80.0)
        self.assertAlmostEqual(got["planned_stop_risk_dollars"]["max"], RISK)
        self.assertAlmostEqual(got["realized_over_planned"]["max"], 0.8)

    def test_an_exceedance_is_a_loss_larger_than_the_planned_risk(self):
        got = stop_mechanism(PLANNED, (
            _trade(INITIAL_STOP, -80.0, RISK),
            _trade(INITIAL_STOP, -130.0, RISK, fill_reason=GAP_FILL),
        ))
        self.assertEqual(got["exceedance"]["count"], 1)
        self.assertEqual(got["exceedance"]["by_fill_reason"][GAP_FILL], 1)
        self.assertEqual(got["exceedance"]["by_fill_reason"][STOP_FILL], 0)
        self.assertAlmostEqual(got["exceedance"]["share_of_stop_exits"], 0.5)
        self.assertAlmostEqual(got["exceedance"]["worst_ratio"], 1.3)

    def test_the_ratio_distribution_is_split_by_fill_reason(self):
        """**사전등록 §8이 두 체결 경로를 갈라 보라고 했다.** 건수만 가르면 얼마나
        다른지 안 보인다 — 손절가 체결은 비용만큼만 넘고 갭 체결은 그렇지 않다.
        """
        got = stop_mechanism(PLANNED, (
            _trade(INITIAL_STOP, -104.0, RISK),
            _trade(INITIAL_STOP, -106.0, RISK),
            _trade(INITIAL_STOP, -300.0, RISK, fill_reason=GAP_FILL),
        ))
        split = got["realized_over_planned_by_fill"]
        self.assertEqual(split[STOP_FILL]["count"], 2)
        self.assertAlmostEqual(split[STOP_FILL]["median"], 1.05)
        self.assertEqual(split[GAP_FILL]["count"], 1)
        self.assertAlmostEqual(split[GAP_FILL]["max"], 3.0)

    def test_entry_session_stops_are_counted(self):
        """진입 당일 손절은 일봉 모델의 보수적 편향이라 따로 센다."""
        got = stop_mechanism(PLANNED, (
            _trade(INITIAL_STOP, -80.0, RISK, held=1),
            _trade(INITIAL_STOP, -80.0, RISK, held=2),
        ))
        self.assertEqual(got["entry_session_stops"], 1)

    def test_exactly_one_r_is_not_an_exceedance(self):
        """**1R은 계획한 위험 그 자체다.** 부등호를 느슨하게 하면 정상이 초과가 된다."""
        got = stop_mechanism(PLANNED, (_trade(INITIAL_STOP, -RISK, RISK),))
        self.assertEqual(got["exceedance"]["count"], 0)

    def test_a_planned_risk_that_disagrees_with_the_engine_stops_the_run(self):
        """**조용히 다른 분모를 쓰지 않는다.** 갈리면 진단이 거짓말한다."""
        with self.assertRaises(AssertionError):
            stop_mechanism(
                {("AAA", "2026-01-02"): RISK * 2}, (_trade(INITIAL_STOP, -80.0, RISK),)
            )

    def test_a_stop_without_an_entry_observation_stops_the_run(self):
        with self.assertRaises(AssertionError):
            stop_mechanism({}, (_trade(INITIAL_STOP, -80.0, RISK),))

    def test_an_unknown_stop_fill_reason_stops_the_run(self):
        """손절 체결은 `try_stop_exit`의 둘뿐이다. 셋째는 새 체결 경로다."""
        with self.assertRaises(AssertionError):
            stop_mechanism(
                PLANNED, (_trade(INITIAL_STOP, -80.0, RISK, fill_reason="OPEN_EXIT"),)
            )

    def test_no_stop_is_an_empty_table_not_a_crash(self):
        got = stop_mechanism(PLANNED, (_trade("MAX_HOLD", 10.0, RISK),))
        self.assertEqual(got["initial_stop_exits"], 0)
        self.assertIsNone(got["realized_over_planned"]["p95"])
        self.assertEqual(got["exceedance"]["count"], 0)
        self.assertIsNone(got["exceedance"]["worst_ratio"])

    def test_the_percentiles_are_actual_observations(self):
        """**보간하지 않는다.** 손절 건수가 적을 때 없는 정밀도를 주장하지 않는다."""
        trades = tuple(
            _trade(INITIAL_STOP, -float(value), RISK) for value in range(1, 11)
        )
        row = stop_mechanism(PLANNED, trades)["realized_net_loss_dollars"]
        self.assertEqual(row["count"], 10)
        self.assertAlmostEqual(row["p90"], 9.0)
        self.assertAlmostEqual(row["p95"], 10.0)
        self.assertAlmostEqual(row["max"], 10.0)

    def test_planned_stop_risk_reads_the_engine_intent(self):
        event = EntryEvent(
            signal_date="2026-01-01", rank=1, intent=_intent(10, 4.0), caps=None,
            execution_date="2026-01-02",
            fill=_fill("AAA", "2026-01-02", 10), cancel_reason=None,
        )
        self.assertEqual(
            planned_stop_risk([event]), {("AAA", "2026-01-02"): 40.0}
        )

    def test_a_cancelled_order_contributes_nothing(self):
        event = EntryEvent(
            signal_date="2026-01-01", rank=1, intent=_intent(10, 4.0), caps=None,
            execution_date="2026-01-02", fill=None, cancel_reason="NO_FILL",
        )
        self.assertEqual(planned_stop_risk([event]), {})


def _fill(symbol: str, trade_date: str, shares: int):
    from backtest.execution import Fill

    return Fill(
        symbol=symbol, trade_date=trade_date, side="BUY", shares=shares,
        reference_price=100.0, fill_price=100.0, fees=1.0, reason="OPEN_FILL",
    )


def _arm(total: float, gap: float, sharpe: float, mdd: float, pf: float = 1.5,
         expectancy: float = 0.3, stops: int = 5) -> dict:
    return {
        "metrics": {
            "total_return": total, "expectancy_r": expectancy, "profit_factor": pf,
            "sharpe": sharpe, "max_drawdown": mdd, "sortino": 1.0, "calmar": 0.3,
        },
        "benchmark": [{"label": "MATCHED", "total_return": total - gap}],
        "stop_mechanism": {"initial_stop_exits": stops},
    }


CONTROL_ARM = _arm(0.4784, 0.0499, 0.46, 0.120, pf=1.47, expectancy=0.343, stops=0)


class VerdictTest(unittest.TestCase):
    """§13. **A는 여덟 조건 전부. 하나라도 실패하면 B다.**"""

    def test_a_needs_every_condition(self):
        good = _arm(0.55, 0.08, 0.50, 0.110)
        checks = conditions(CONTROL_ARM, good)
        self.assertTrue(all(checks.values()), checks)
        self.assertEqual(classify(checks), LABEL_STOP_DEFINED)

    def test_any_single_failure_is_b(self):
        for name, _ in CONDITION_LABELS:
            with self.subTest(condition=name):
                checks = {other: True for other, _ in CONDITION_LABELS}
                checks[name] = False
                self.assertEqual(classify(checks), LABEL_VOLATILITY_SCALED)

    def test_a_falling_sharpe_is_b(self):
        worse = _arm(0.55, 0.08, 0.45, 0.110)
        self.assertFalse(conditions(CONTROL_ARM, worse)["sharpe_not_worse"])
        self.assertEqual(classify(conditions(CONTROL_ARM, worse)),
                         LABEL_VOLATILITY_SCALED)

    def test_a_deeper_drawdown_is_b(self):
        worse = _arm(0.55, 0.08, 0.50, 0.130)
        self.assertFalse(conditions(CONTROL_ARM, worse)["max_drawdown_not_worse"])
        self.assertEqual(classify(conditions(CONTROL_ARM, worse)),
                         LABEL_VOLATILITY_SCALED)

    def test_a_negative_gap_is_b(self):
        worse = _arm(0.55, -0.01, 0.50, 0.110)
        self.assertFalse(conditions(CONTROL_ARM, worse)["gap_positive"])
        self.assertEqual(classify(conditions(CONTROL_ARM, worse)),
                         LABEL_VOLATILITY_SCALED)

    def test_a_broken_profit_factor_is_b(self):
        worse = _arm(0.55, 0.08, 0.50, 0.110, pf=1.10)
        checks = conditions(CONTROL_ARM, worse)
        self.assertFalse(checks["profit_factor_ok"])
        self.assertFalse(checks["control_minimums_kept"])
        self.assertEqual(classify(checks), LABEL_VOLATILITY_SCALED)

    def test_a_stop_that_never_fires_is_b(self):
        """**binding하지 않으면 A/B를 가를 증거가 없다.**"""
        idle = _arm(0.55, 0.08, 0.50, 0.110, stops=0)
        self.assertFalse(conditions(CONTROL_ARM, idle)["hard_stop_binding"])
        self.assertEqual(classify(conditions(CONTROL_ARM, idle)),
                         LABEL_VOLATILITY_SCALED)

    def test_equal_sharpe_and_drawdown_still_qualify(self):
        """조건 6·7은 `≥`·`≤`다. 같으면 후퇴가 아니다."""
        same = _arm(0.55, 0.08, 0.46, 0.120)
        checks = conditions(CONTROL_ARM, same)
        self.assertTrue(checks["sharpe_not_worse"])
        self.assertTrue(checks["max_drawdown_not_worse"])
        self.assertEqual(classify(checks), LABEL_STOP_DEFINED)

    def test_there_are_exactly_two_verdicts(self):
        self.assertEqual(set(VERDICTS), {LABEL_STOP_DEFINED, LABEL_VOLATILITY_SCALED})
        self.assertEqual(PROMOTES, {LABEL_STOP_DEFINED})

    def test_every_combination_lands_on_a_registered_verdict(self):
        names = [name for name, _ in CONDITION_LABELS]
        for values in itertools.product((True, False), repeat=len(names)):
            checks = dict(zip(names, values))
            self.assertIn(classify(checks), VERDICTS)

    def test_a_missing_condition_stops_instead_of_guessing(self):
        checks = {name: True for name, _ in CONDITION_LABELS}
        checks.pop("hard_stop_binding")
        with self.assertRaises(AssertionError):
            classify(checks)

    def test_the_condition_list_has_no_duplicates(self):
        names = [name for name, _ in CONDITION_LABELS]
        self.assertEqual(len(set(names)), len(names))
        self.assertEqual(len(names), 8)


class ScopeTest(unittest.TestCase):
    """**사전등록 §16의 금지 목록.**"""

    SOURCE = (TRADING_ROOT / "selftest" / "risk_semantics_run.py").read_text(
        encoding="utf-8"
    )
    CORE_SOURCE = (
        TRADING_ROOT / "core" / "jt_j126_k42_sma200_stop.py"
    ).read_text(encoding="utf-8")

    def test_only_two_arms(self):
        self.assertEqual(len(ARMS), 2)

    def test_there_is_exactly_one_hard_stop_core(self):
        """**배수 사다리를 만들지 않는다.** 잰 것은 2ATR 하나다."""
        cores = [
            core for core in CORES.values() if core.exit_mode == HARD_STOP_EXITS
        ]
        self.assertEqual([core.name for core in cores], [CHALLENGER])

    def test_every_core_keeps_the_frozen_stop_multiple(self):
        """1.5 / 2.5 / 3ATR 실험이 코어로 들어오지 않았다."""
        for core in CORES.values():
            with self.subTest(core=core.name):
                self.assertEqual(core.policy.parameters.stop_atr_multiple, 2.0)

    def test_no_trailing_or_time_stop_knob(self):
        for source in (self.SOURCE, self.CORE_SOURCE):
            for word in ("trailing_atr_multiple", "trailing_activation_atr",
                         "time_stop_sessions", "earnings_exit_sessions",
                         "confirmation_days"):
                self.assertNotIn(word, source, word)

    def test_no_sizing_slot_or_hold_change(self):
        for source in (self.SOURCE, self.CORE_SOURCE):
            for word in ("risk_per_trade", "max_position_weight", "max_positions=",
                         "max_candidates=", "RiskProfile", "HardLimits"):
                self.assertNotIn(word, source, word)

    def test_the_runner_defines_no_core(self):
        """**러너가 규칙을 만들지 않는다.** 코어 하나가 파일 하나다."""
        for word in ("CoreDefinition", "jt_policy", "StrategyParameters"):
            self.assertNotIn(word, self.SOURCE, word)

    def test_the_holdout_is_not_consumed(self):
        self.assertNotIn("consume_holdout", self.SOURCE)
        self.assertIn("consumed=False", self.SOURCE)

    def test_no_fip_abs_or_market_break_revival(self):
        for word in ("absolute_momentum", "information_discreteness", "fip",
                     "SIGNAL_INVALIDATION", "trend_quality"):
            self.assertNotIn(word, self.SOURCE, word)


class DisclaimerTest(unittest.TestCase):
    """**A가 이겨도 0.25%를 loss cap이라고 부르지 않는다**(사전등록 §4).

    금지 표현을 소스에서 문자열로 찾는 방식은 쓰지 않는다 — 금지 목록 자체가 그 문자열을
    담고 있어서 그런 테스트는 자기 자신에 걸린다. 대신 **보고서가 실제로 무엇을 찍는지**
    본다.
    """

    def test_the_promotion_text_carries_the_disclaimer(self):
        text = treatment(LABEL_STOP_DEFINED)
        self.assertIn("planned stop-risk budget", text)
        self.assertIn("maximum loss", text)
        self.assertIn("라고는 하지 않는다", text)

    def test_the_stop_defined_consequence_prints_the_forbidden_phrases_as_forbidden(
        self,
    ):
        text = "\n".join(_consequence(LABEL_STOP_DEFINED))
        self.assertIn("planned stop-risk budget", text)
        self.assertIn("그래도 다음 표현은 쓰지 않는다", text)
        for phrase in ("guaranteed max loss = 0.25%",
                       "maximum loss is capped at 0.25%"):
            self.assertIn(phrase, text, phrase)

    def test_the_volatility_scaled_consequence_names_the_cleanup_target(self):
        text = "\n".join(_consequence(LABEL_VOLATILITY_SCALED))
        self.assertIn("0.25%가 실제 거래당 최대손실 위험이다", text)
        self.assertIn("compatibility plan", text)

    def test_the_volatility_scaled_treatment_closes_the_alternatives(self):
        text = treatment(LABEL_VOLATILITY_SCALED)
        self.assertIn("fixed K42를 유지한다", text)
        self.assertIn("재탐색", text)


class SemanticCleanupTest(unittest.TestCase):
    """B verdict의 후속 정리(사전등록 §14). **행동은 안 바꾸고 이름만 바로잡는다.**"""

    # 이 PR의 두 파일은 그 표현을 **틀렸다고 인용하려고** 담고 있다. 나머지에서는 되살아나면
    # 안 된다 — JT 연구 코어는 전부 `FIXED_HOLD` 계열이라 손절을 집행하지 않는다.
    QUOTING = frozenset({"jt_j126_k42_sma200_stop.py", "risk_semantics_run.py"})

    def test_the_false_phrase_is_gone_from_research_sources(self):
        for root in (TRADING_ROOT / "core", TRADING_ROOT / "selftest"):
            for path in sorted(root.glob("*.py")):
                if path.name in self.QUOTING:
                    continue
                with self.subTest(path=path.name):
                    self.assertNotIn(
                        "거래당 위험 0.25%", path.read_text(encoding="utf-8")
                    )

    def test_the_canonical_note_lives_in_one_place(self):
        """**코어마다 다시 설명하지 않는다.** `jt.py`가 모든 JT 연구 코어의 뿌리다."""
        text = (TRADING_ROOT / "core" / "jt.py").read_text(encoding="utf-8")
        self.assertIn("volatility normalization unit", text)
        self.assertIn("runs/risk-semantics/results.md", text)

    def test_the_shared_field_names_were_not_renamed(self):
        """**공유 dataclass field는 이번 PR에서 건드리지 않았다**(§14 compatibility plan).

        `paper-core-v1`과 배포된 산출물·스키마가 같은 이름을 쓴다. 이름 정리는 별도 PR이다.
        """
        from backtest.sizing import OpenPosition

        intent = {field.name for field in fields(SizedIntent)}
        self.assertLessEqual(
            {"planned_risk", "planned_risk_fraction", "initial_stop", "stop_distance"},
            intent,
        )
        self.assertIn("open_risk", dir(OpenPosition))
        self.assertIn("return_r", {field.name for field in fields(Trade)})

    def test_the_prior_pr_control_artifact_is_available_for_the_check(self):
        """**대조할 것이 없으면 불변 주장을 값으로 뒷받침할 수 없다.**"""
        earlier = prior_control("ZERO")
        self.assertIsNotNone(earlier)
        self.assertEqual(earlier["core"], CONTROL)
        for key in UNCHANGED_KEYS:
            self.assertIn(key, earlier["metrics"], key)

    def test_the_frozen_baseline_still_executes_its_stop(self):
        """**`paper-core-v1`에서는 0.25%가 여전히 집행되는 손절 위험이다.**

        정리 대상은 연구 코어의 표현이지 동결 기준선의 규칙이 아니다.
        """
        self.assertEqual(CORES["core1"].exit_mode, CORE_EXITS)


if __name__ == "__main__":
    unittest.main()
