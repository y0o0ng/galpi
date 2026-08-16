"""PR #18 신호 반증 청산의 처치와 사전등록 판정.

**가장 중요한 것은 넷이다.**

1. `TreatmentTest` — 처치가 정확히 하나다. `exit_mode` 말고는 control과 같아야 한다.
2. `SchedulingTest` — market break는 **예약만** 한다. 이미 예약이 있으면 덮지 않고,
   새 체결 경로를 만들지 않으며, 다른 필드를 건드리지 않는다.
3. `RegressionTest` — 기존 `CORE`·`FIXED_HOLD` 모드의 동작이 그대로다. 새 모드를 더하면서
   기존 실행이 바뀌면 PR #10~#17의 결과가 전부 비교 불가가 된다.
4. `MechanismTest` — **표시와 체결을 갈라 세는 규칙**을 잠근다. 폐지·미해결 선점을 fill로
   세거나 거래정지로 밀린 체결을 단축으로 세면 진단이 거짓말한다.
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
from backtest.loop import MarketBreakEvent, Trade, run_backtest  # noqa: E402
from backtest.modes import (  # noqa: E402
    CORE_EXITS,
    EXIT_MODES,
    FIXED_HOLD_EXITS,
    SIGNAL_INVALIDATION_EXITS,
    TREND_GATE_REGIME,
)
from backtest.policy import DEFAULT_PARAMETERS as PARAMS  # noqa: E402
from backtest.positions import (  # noqa: E402
    MARKET_TREND_BREAK,
    Position,
    PositionError,
    hold_untraded,
    run_session,
    schedule_market_break,
)
from core import CORES  # noqa: E402
from core.definition import RULE_FIELDS  # noqa: E402
from selftest.signal_invalidation_run import (  # noqa: E402
    ARMS,
    CHALLENGER,
    COMPONENT_LABELS,
    CONTROL,
    CONTROL_KEPT,
    DELISTED_EXIT,
    LABEL_FAIL,
    LABEL_PROMOTE,
    LABEL_PROMOTE_AND_GATE,
    LABEL_RISK_ONLY,
    PROMOTES,
    UNRESOLVED_EXIT,
    classify_component,
    control_kept,
    mechanism,
    planned,
    risk_directions,
    run_id_for,
)
from test_execution import bar  # noqa: E402
from test_positions import FREE, position, session  # noqa: E402

MAX_HOLD = PARAMS.max_hold_sessions
TIME_STOP = PARAMS.time_stop_sessions


class SchedulingTest(unittest.TestCase):
    """**표식만 찍는다.** 판정은 loop가 하고 체결은 기존 pending-exit 경로가 한다."""

    def test_it_reserves_the_existing_pending_exit_slot(self):
        marked = schedule_market_break(position())
        self.assertEqual(marked.pending_exit, MARKET_TREND_BREAK)

    def test_it_never_overwrites_an_existing_reservation(self):
        """같은 종가에 `MAX_HOLD`가 먼저 예약됐으면 청산일이 t+1로 같다.

        사유를 덮으면 진단 표가 "이 exit이 보유를 줄였다"고 거짓말한다(사전등록 §4).
        """
        for reason in ("MAX_HOLD", MARKET_TREND_BREAK, "TIME_STOP"):
            with self.subTest(reason=reason):
                held = position(pending_exit=reason)
                self.assertIs(schedule_market_break(held), held)

    def test_nothing_but_the_pending_exit_changes(self):
        base = position()
        marked = schedule_market_break(base)
        for field in fields(Position):
            if field.name == "pending_exit":
                continue
            self.assertEqual(
                getattr(base, field.name), getattr(marked, field.name), field.name
            )

    def test_the_reservation_fills_at_the_next_open(self):
        """새 체결 경로가 없다. `MAX_HOLD`와 **같은** 2번 단계로 나간다."""
        marked = schedule_market_break(position(sessions_held=3))
        executed = session(marked, bar("2026-08-07", open_=99.0, close=100.0),
                           exit_mode=SIGNAL_INVALIDATION_EXITS)
        self.assertTrue(executed.closed)
        self.assertEqual(executed.reason, MARKET_TREND_BREAK)
        self.assertEqual(executed.fill.reason, "OPEN_EXIT")

    def test_an_untradeable_session_holds_the_reason_and_only_ages(self):
        """**가짜 체결을 만들지 않는다.** 바가 없으면 사유를 들고 나이만 먹는다."""
        marked = schedule_market_break(position(sessions_held=3))
        result = hold_untraded(marked, "2026-08-07",
                               exit_mode=SIGNAL_INVALIDATION_EXITS)
        self.assertFalse(result.closed)
        self.assertEqual(result.position.pending_exit, MARKET_TREND_BREAK)
        self.assertTrue(result.position.exit_pending_untradeable)
        self.assertEqual(result.position.sessions_held, 4)

    def test_the_reason_is_a_new_word_only_for_this_exit(self):
        self.assertEqual(MARKET_TREND_BREAK, "MARKET_TREND_BREAK")


class ExitModeTest(unittest.TestCase):
    """새 모드는 `FIXED_HOLD` + market break다. **손절·시간손절·실적은 여전히 꺼져 있다.**"""

    def fixed(self, pos, current, **kwargs):
        return session(pos, current, exit_mode=SIGNAL_INVALIDATION_EXITS, **kwargs)

    def test_the_new_mode_is_registered(self):
        self.assertIn(SIGNAL_INVALIDATION_EXITS, EXIT_MODES)
        self.assertEqual(
            set(EXIT_MODES),
            {CORE_EXITS, FIXED_HOLD_EXITS, SIGNAL_INVALIDATION_EXITS},
        )

    def test_a_stop_does_not_fire(self):
        result = self.fixed(position(), bar("2026-08-07", open_=95.0, low=80.0, close=85.0))
        self.assertFalse(result.closed)

    def test_the_time_stop_does_not_fire(self):
        stalled = position(sessions_held=TIME_STOP - 1, highest_close=102.0)
        result = self.fixed(stalled, bar("2026-08-07", open_=101.0, close=101.0))
        self.assertIsNone(result.position.pending_exit)

    def test_earnings_does_not_close_the_position(self):
        result = self.fixed(position(), bar("2026-08-07", open_=101.0, close=102.0),
                            next_earnings="2026-08-11")
        self.assertFalse(result.closed)

    def test_the_holding_period_still_ends_the_trade(self):
        old = position(sessions_held=MAX_HOLD - 1, highest_close=101.0)
        scheduled = self.fixed(old, bar("2026-08-07", open_=101.0, close=101.0))
        self.assertEqual(scheduled.reason, "MAX_HOLD")

    def test_it_behaves_exactly_like_fixed_hold_without_a_market_break(self):
        """**시장이 SMA200 위면 두 모드가 같은 함수다.** 차이는 loop의 표시뿐이다."""
        cases = (
            (position(), bar("2026-08-07", open_=95.0, low=80.0, close=85.0), {}),
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
                    session(pos, current, exit_mode=SIGNAL_INVALIDATION_EXITS, **extra),
                )

    def test_an_unknown_mode_is_still_refused(self):
        with self.assertRaises(PositionError):
            session(position(), bar("2026-08-07"), exit_mode="SIGNAL")


class CoreExitRegressionTest(unittest.TestCase):
    """**`CORE`의 시간손절이 살아 있어야 한다.** `_due_exit`의 가드를 바꿨다."""

    def test_the_time_stop_still_fires_in_core(self):
        stalled = position(sessions_held=TIME_STOP - 1, highest_close=102.0)
        result = session(stalled, bar("2026-08-07", open_=101.0, close=101.0),
                         exit_mode=CORE_EXITS)
        self.assertEqual(result.position.pending_exit, "TIME_STOP")

    def test_the_time_stop_is_off_in_both_research_modes(self):
        stalled = position(sessions_held=TIME_STOP - 1, highest_close=102.0)
        for mode in (FIXED_HOLD_EXITS, SIGNAL_INVALIDATION_EXITS):
            with self.subTest(mode=mode):
                result = session(stalled, bar("2026-08-07", open_=101.0, close=101.0),
                                 exit_mode=mode)
                self.assertIsNone(result.position.pending_exit)

    def test_max_hold_fires_in_every_mode(self):
        old = position(sessions_held=MAX_HOLD - 1, highest_close=101.0)
        for mode in EXIT_MODES:
            with self.subTest(mode=mode):
                result = session(old, bar("2026-08-07", open_=101.0, close=101.0),
                                 exit_mode=mode)
                self.assertEqual(result.reason, "MAX_HOLD")

    def test_a_core_stop_still_fires(self):
        result = session(position(), bar("2026-08-07", open_=95.0, low=80.0, close=85.0),
                         exit_mode=CORE_EXITS)
        self.assertTrue(result.closed)


class TreatmentTest(unittest.TestCase):
    """**처치는 정확히 하나다.**"""

    def test_the_only_rule_difference_is_the_exit_mode(self):
        control, exit_arm = CORES[CONTROL], CORES[CHALLENGER]
        different = [
            field
            for field in RULE_FIELDS
            if control.run_kwargs()[field] != exit_arm.run_kwargs()[field]
        ]
        # `policy`는 인스턴스가 달라 값 비교로는 다르게 나온다. 아래에서 내용을 본다.
        self.assertEqual(sorted(different), ["exit_mode", "policy"])
        self.assertEqual(control.exit_mode, FIXED_HOLD_EXITS)
        self.assertEqual(exit_arm.exit_mode, SIGNAL_INVALIDATION_EXITS)

    def test_the_entry_gate_is_unchanged(self):
        """**신규진입 게이트를 건드리지 않는다.** PR #16이 승격한 구조 위에서 잰다."""
        for key in ARMS:
            self.assertEqual(CORES[key].regime_mode, TREND_GATE_REGIME)

    def test_parameters_limits_and_profile_are_identical(self):
        control, exit_arm = CORES[CONTROL].policy, CORES[CHALLENGER].policy
        self.assertEqual(control.parameters, exit_arm.parameters)
        self.assertEqual(control.limits, exit_arm.limits)
        self.assertEqual(control.profile, exit_arm.profile)
        self.assertEqual(control.strategy_version, exit_arm.strategy_version)

    def test_every_behaviour_rule_is_identical_except_the_exit_mode(self):
        control, exit_arm = CORES[CONTROL].run_kwargs(), CORES[CHALLENGER].run_kwargs()
        self.assertEqual(set(control), set(exit_arm))
        for key in control:
            if key in ("exit_mode", "policy"):
                continue
            self.assertEqual(control[key], exit_arm[key], key)

    def test_the_signature_differs_so_the_holdout_counter_can_tell_them_apart(self):
        self.assertNotEqual(CORES[CONTROL].signature, CORES[CHALLENGER].signature)
        self.assertNotEqual(
            CORES[CONTROL].policy.policy_id, CORES[CHALLENGER].policy.policy_id
        )

    def test_the_formation_horizon_and_hold_are_unchanged(self):
        """**J·K·슬롯을 재탐색하지 않는다.**"""
        parameters = CORES[CHALLENGER].policy.parameters
        control = CORES[CONTROL].policy.parameters
        self.assertEqual(parameters.rs_lookback, control.rs_lookback)
        self.assertEqual(parameters.rs_skip, control.rs_skip)
        self.assertEqual(parameters.max_hold_sessions, control.max_hold_sessions)
        self.assertEqual(parameters.max_candidates, control.max_candidates)

    def test_exactly_four_runs(self):
        self.assertEqual(len(planned()), 4)
        self.assertEqual({core for core, _ in planned()}, set(ARMS))

    def test_the_two_arms_never_share_an_output_file(self):
        ids = [run_id_for(core, scenario) for core, scenario in planned()]
        self.assertEqual(len(set(ids)), len(ids))


def _spy_breaks_down(days: int) -> list[float]:
    """올라가다 마지막 20세션에 SMA200 아래로 떨어지는 SPY.

    표시가 실제로 일어나려면 시장이 SMA200 위였다가(=진입이 열려야 한다) 아래로 내려가야
    한다. 기본 픽스처는 SPY가 평평해서 `close > sma200`이 처음부터 거짓이라 진입 자체가
    없다.
    """
    rising = synthetic.growth_closes(days - 20, 300.0, 0.002)
    peak = rising[-1]
    return rising + [peak * (0.97 ** (step + 1)) for step in range(20)]


class LoopIntegrationTest(unittest.TestCase):
    """**표시는 종가, 체결은 다음 시초.** 실행으로 확인한다."""

    @classmethod
    def setUpClass(cls):
        cls.connection, cls.dates = test_loop.build(spy_closes=_spy_breaks_down)
        cls.control = cls.run_with(FIXED_HOLD_EXITS)
        cls.treated, cls.events = cls.run_with(SIGNAL_INVALIDATION_EXITS, watch=True)

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
        events: list[MarketBreakEvent] = []
        return run_backtest(cls.connection, config,
                            break_observer=events.append), events

    def test_the_fixture_actually_produces_a_market_break(self):
        """**빈 픽스처에서 통과하는 테스트는 아무것도 잠그지 않는다.**"""
        self.assertGreater(len(self.events), 0)
        self.assertGreater(self.treated.exit_counts.get(MARKET_TREND_BREAK, 0), 0)

    def test_the_control_never_sees_the_new_reason(self):
        self.assertNotIn(MARKET_TREND_BREAK, self.control.exit_counts)
        self.assertGreater(len(self.control.trades), 0)

    def test_every_break_fills_at_the_next_session_open(self):
        """거래정지가 없는 픽스처다. 표시 다음 세션 시초에 나가야 한다."""
        sessions = [point.trade_date for point in self.treated.equity_curve]
        marked = {(event.symbol, event.entry_date): event for event in self.events}
        breaks = [t for t in self.treated.trades
                  if t.exit_reason == MARKET_TREND_BREAK]
        self.assertEqual(len(breaks), len(marked))
        for trade in breaks:
            event = marked[(trade.symbol, trade.entry_date)]
            self.assertEqual(trade.exit_fill_reason, "OPEN_EXIT")
            self.assertEqual(
                sessions.index(trade.exit_date) - sessions.index(event.signal_date), 1
            )

    def test_the_mechanism_identity_closes_on_a_real_run(self):
        got = mechanism(
            self.events,
            self.treated.trades,
            [point.trade_date for point in self.treated.equity_curve],
            CORES[CONTROL].policy.parameters.max_hold_sessions,
        )
        self.assertEqual(got["identity_residual"], 0)
        self.assertEqual(got["market_break_signals_scheduled"], len(self.events))

    def test_a_marked_position_is_never_marked_twice(self):
        """예약이 살아 있는 동안 다시 표시하면 신호 수가 부풀려진다."""
        keys = [(event.symbol, event.entry_date) for event in self.events]
        self.assertEqual(len(set(keys)), len(keys))

    def test_the_market_label_is_identical_in_both_arms(self):
        """레짐표를 견주려면 계좌를 보지 않는 시장 라벨이 같아야 한다."""
        self.assertEqual(
            [point.market_regime for point in self.control.equity_curve],
            [point.market_regime for point in self.treated.equity_curve],
        )

    def test_no_stop_or_earnings_exit_appears(self):
        for reason in ("INITIAL_STOP", "TRAILING_STOP", "TIME_STOP", "EARNINGS"):
            self.assertNotIn(reason, self.treated.exit_counts)

    def test_attaching_the_observer_changes_nothing(self):
        """**관찰자는 읽기 전용이다.** 붙여서 결과가 달라지면 진단이 실험을 바꾼 것이다."""
        silent = self.run_with(SIGNAL_INVALIDATION_EXITS)
        self.assertEqual(silent.trades, self.treated.trades)
        self.assertEqual(silent.equity_curve, self.treated.equity_curve)
        self.assertEqual(silent.exit_counts, self.treated.exit_counts)

    def test_every_event_names_a_position_that_existed(self):
        keys = {(trade.symbol, trade.entry_date) for trade in self.treated.trades}
        keys |= {(pos.symbol, pos.entry_date) for pos in self.treated.open_positions}
        for event in self.events:
            self.assertIn((event.symbol, event.entry_date), keys)


def _trade(symbol: str, exit_date: str, reason: str, held: int) -> Trade:
    return Trade(
        symbol=symbol,
        entry_date="2026-01-02",
        exit_date=exit_date,
        shares=10,
        entry_price=100.0,
        exit_price=101.0,
        entry_reason="CORE",
        exit_reason=reason,
        exit_fill_reason="OPEN_EXIT",
        fees=0.0,
        pnl=10.0,
        return_r=0.1,
        mfe_r=0.2,
        mae_r=-0.1,
        sessions_held=held,
        min_qty_exception=False,
    )


SESSIONS = [f"2026-03-{day:02d}" for day in range(1, 21)]


def _event(symbol: str, signal_date: str, held: int) -> MarketBreakEvent:
    return MarketBreakEvent(
        signal_date=signal_date,
        symbol=symbol,
        entry_date="2026-01-02",
        sessions_held=held,
    )


class MechanismTest(unittest.TestCase):
    """**표시 수를 체결 수로, 체결 수를 단축 수로 읽지 않는다**(사전등록 §8)."""

    def test_a_next_session_fill_is_normal(self):
        got = mechanism(
            [_event("AAA", "2026-03-05", 10)],
            (_trade("AAA", "2026-03-06", MARKET_TREND_BREAK, 10),),
            SESSIONS,
            MAX_HOLD,
        )
        self.assertEqual(got["outcomes"]["normal_fills"], 1)
        self.assertEqual(got["outcomes"]["untradeable_delayed_fills"], 0)
        self.assertEqual(got["actual_k42_shortening"], 1)

    def test_a_later_fill_went_through_the_untradeable_state(self):
        """예약된 청산은 **다음 세션 시초**에 나간다. 늦었다면 그 세션에 바가 없었다."""
        got = mechanism(
            [_event("AAA", "2026-03-05", 10)],
            (_trade("AAA", "2026-03-12", MARKET_TREND_BREAK, 17),),
            SESSIONS,
            MAX_HOLD,
        )
        self.assertEqual(got["outcomes"]["untradeable_delayed_fills"], 1)
        self.assertEqual(got["outcomes"]["normal_fills"], 0)
        self.assertEqual(got["market_break_fills"], 1)

    def test_a_delayed_fill_past_the_deadline_is_not_a_shortening(self):
        """표시가 일렀어도 체결이 K42 뒤면 단축이 아니다."""
        got = mechanism(
            [_event("AAA", "2026-03-05", 30)],
            (_trade("AAA", "2026-03-12", MARKET_TREND_BREAK, MAX_HOLD + 8),),
            SESSIONS,
            MAX_HOLD,
        )
        self.assertEqual(got["market_break_fills"], 1)
        self.assertEqual(got["actual_k42_shortening"], 0)

    def test_a_delayed_fill_before_the_deadline_is_still_a_shortening(self):
        """지연과 단축은 **다른 축이다.** 거래정지를 겪고도 deadline 전이면 단축이다."""
        got = mechanism(
            [_event("AAA", "2026-03-05", 10)],
            (_trade("AAA", "2026-03-12", MARKET_TREND_BREAK, 17),),
            SESSIONS,
            MAX_HOLD,
        )
        self.assertEqual(got["outcomes"]["untradeable_delayed_fills"], 1)
        self.assertEqual(got["actual_k42_shortening"], 1)

    def test_a_terminal_exit_preempts_and_is_never_counted_as_a_fill(self):
        """청산가와 시점을 정한 것이 market break가 아니다."""
        for reason, key in (
            (DELISTED_EXIT, "delisted_preempted"),
            (UNRESOLVED_EXIT, "unresolved_preempted"),
        ):
            with self.subTest(reason=reason):
                got = mechanism(
                    [_event("AAA", "2026-03-05", 10)],
                    (_trade("AAA", "2026-03-06", reason, 10),),
                    SESSIONS,
                    MAX_HOLD,
                )
                self.assertEqual(got["outcomes"][key], 1)
                self.assertEqual(got["market_break_fills"], 0)
                self.assertEqual(got["actual_k42_shortening"], 0)
                self.assertEqual(
                    got["market_break_signals_terminally_preempted"], 1
                )

    def test_an_unclosed_position_has_its_own_bucket(self):
        got = mechanism([_event("AAA", "2026-03-05", 10)], (), SESSIONS, MAX_HOLD)
        self.assertEqual(got["outcomes"]["still_open_at_window_end"], 1)
        self.assertEqual(got["identity_residual"], 0)

    def test_the_identity_closes(self):
        """`scheduled = 정상 + 지연 + DELISTED + UNRESOLVED + 미청산`."""
        events = [
            _event("AAA", "2026-03-05", 10),
            _event("BBB", "2026-03-05", 20),
            _event("CCC", "2026-03-05", 30),
            _event("DDD", "2026-03-05", 40),
            _event("EEE", "2026-03-05", 12),
        ]
        trades = (
            _trade("AAA", "2026-03-06", MARKET_TREND_BREAK, 10),
            _trade("BBB", "2026-03-12", MARKET_TREND_BREAK, 27),
            _trade("CCC", "2026-03-06", DELISTED_EXIT, 30),
            _trade("DDD", "2026-03-06", UNRESOLVED_EXIT, 40),
        )
        got = mechanism(events, trades, SESSIONS, MAX_HOLD)
        outcomes = got["outcomes"]
        self.assertEqual(got["market_break_signals_scheduled"], 5)
        self.assertEqual(got["identity_residual"], 0)
        self.assertEqual(
            sum(outcomes.values()), got["market_break_signals_scheduled"]
        )

    def test_an_unexpected_reason_stops_instead_of_lying(self):
        """사전등록이 outcome을 넷만 열어 뒀다. 다섯째는 조용히 넘어가지 않는다."""
        with self.assertRaises(AssertionError):
            mechanism(
                [_event("AAA", "2026-03-05", 10)],
                (_trade("AAA", "2026-03-06", "MAX_HOLD", 42),),
                SESSIONS,
                MAX_HOLD,
            )

    def test_the_signal_side_distribution_counts_every_signal(self):
        """표시 시점 분포는 **선점된 것까지** 센다. 표시는 실제로 일어났다."""
        got = mechanism(
            [_event("AAA", "2026-03-05", 10), _event("BBB", "2026-03-05", 30)],
            (_trade("BBB", "2026-03-06", DELISTED_EXIT, 30),),
            SESSIONS,
            MAX_HOLD,
        )
        self.assertEqual(got["sessions_remaining_at_signal"]["count"], 2)
        self.assertEqual(got["sessions_remaining_at_signal"]["min"], MAX_HOLD - 30)

    def test_nothing_scheduled_is_an_empty_table_not_a_crash(self):
        got = mechanism([], (), SESSIONS, MAX_HOLD)
        self.assertEqual(got["market_break_signals_scheduled"], 0)
        self.assertEqual(got["identity_residual"], 0)
        self.assertIsNone(got["shortening_sessions"]["mean"])


def _delta(ds: float, dg: float) -> dict:
    return {"delta_S": ds, "delta_G": dg, "delta_B": ds - dg}


def _kept(**changes) -> dict:
    base = {name: True for name in CONTROL_KEPT}
    base.update(changes)
    return base


def _risk(**changes) -> dict:
    base = {
        "sharpe_up": False,
        "max_drawdown_down": False,
        "sortino_up": False,
        "calmar_up": False,
    }
    base.update(changes)
    return base


class LabelTest(unittest.TestCase):
    """§9.2의 label. **결과를 본 뒤 바꾸지 않는다.**"""

    def test_a_needs_the_gate_and_both_deltas(self):
        self.assertEqual(
            classify_component(_delta(0.05, 0.02), True, True, _kept(), _risk()),
            LABEL_PROMOTE_AND_GATE,
        )

    def test_b_is_the_same_marginal_case_without_the_gate(self):
        self.assertEqual(
            classify_component(_delta(0.05, 0.02), False, True, _kept(), _risk()),
            LABEL_PROMOTE,
        )

    def test_b_needs_the_sharpe_not_to_fall(self):
        """상대 edge를 올려도 Sharpe를 떨어뜨리면 최종 목표에서는 후퇴다."""
        self.assertNotIn(
            classify_component(_delta(0.05, 0.02), False, False, _kept(),
                               _risk(sharpe_up=True)),
            PROMOTES,
        )

    def test_b_needs_every_gate_row_the_control_already_passed(self):
        for name in CONTROL_KEPT:
            with self.subTest(name=name):
                self.assertNotIn(
                    classify_component(
                        _delta(0.05, 0.02), False, True, _kept(**{name: False}),
                        _risk(sharpe_up=True),
                    ),
                    PROMOTES,
                )

    def test_the_gate_alone_never_promotes(self):
        """**`CURRENT_ECONOMIC_GATE_PASS`는 단독 승격 사유가 아니다**(§9.1).

        게이트를 통과했는데 `ΔS ≤ 0`이면 그것은 control이 이미 하던 일이다.
        """
        for ds, dg in ((-0.05, 0.02), (0.05, -0.02), (-0.05, -0.02), (0.0, 0.0)):
            with self.subTest(deltas=(ds, dg)):
                self.assertNotIn(
                    classify_component(_delta(ds, dg), True, True, _kept(), _risk()),
                    PROMOTES,
                )

    def test_c_needs_one_risk_improvement(self):
        self.assertEqual(
            classify_component(_delta(-0.05, -0.02), False, False, _kept(),
                               _risk(sortino_up=True)),
            LABEL_RISK_ONLY,
        )

    def test_d_is_no_improvement_anywhere(self):
        self.assertEqual(
            classify_component(_delta(-0.05, -0.02), False, False, _kept(), _risk()),
            LABEL_FAIL,
        )

    def test_zero_is_not_an_improvement(self):
        """**같으면 개선이 아니다.** 부등호를 느슨하게 하면 무변화가 승격한다."""
        self.assertNotIn(
            classify_component(_delta(0.0, 0.0), True, True, _kept(),
                               _risk(sharpe_up=True)),
            PROMOTES,
        )

    def test_a_missing_number_never_promotes(self):
        self.assertEqual(
            classify_component({"delta_S": None, "delta_G": 0.02}, True, True,
                               _kept(), _risk()),
            LABEL_FAIL,
        )

    def test_every_verdict_is_a_registered_label(self):
        for ds, dg, gate, sharpe, kept, risk in itertools.product(
            (-0.05, 0.0, 0.05), (-0.02, 0.0, 0.02), (True, False), (True, False),
            (True, False), (True, False),
        ):
            label = classify_component(
                _delta(ds, dg), gate, sharpe,
                _kept(gap=kept), _risk(sharpe_up=risk),
            )
            self.assertIn(label, COMPONENT_LABELS)

    def test_the_label_set_has_no_duplicates(self):
        self.assertEqual(len(set(COMPONENT_LABELS)), len(COMPONENT_LABELS))

    def test_only_two_labels_promote(self):
        self.assertEqual(PROMOTES, {LABEL_PROMOTE_AND_GATE, LABEL_PROMOTE})


class KeptTest(unittest.TestCase):
    """**control이 통과하지 못한 항목은 깰 것이 없다.**"""

    def run_with(self, total: float, sharpe: float, mdd: float) -> dict:
        return {
            "metrics": {
                "total_return": total, "expectancy_r": 0.3, "profit_factor": 1.5,
                "sharpe": sharpe, "max_drawdown": mdd, "sortino": 1.0, "calmar": 0.3,
            },
            "benchmark": [{"label": "MATCHED", "total_return": 0.1}],
        }

    def test_a_row_the_control_failed_is_not_a_break(self):
        """control Sharpe 0.46은 `>= 0.60`을 못 넘는다. 그 줄은 `CONTROL_KEPT`에 없다."""
        self.assertNotIn("sharpe", CONTROL_KEPT)

    def test_a_row_the_control_passed_must_survive(self):
        control = self.run_with(0.48, 0.46, 0.12)
        broken = self.run_with(0.48, 0.46, 0.20)  # MDD 20% — 15% 문턱을 깬다
        self.assertFalse(control_kept(control, broken)["max_drawdown"])
        self.assertTrue(control_kept(control, control)["max_drawdown"])

    def test_a_row_the_control_already_failed_stays_true(self):
        control = self.run_with(0.48, 0.46, 0.20)
        worse = self.run_with(0.48, 0.46, 0.30)
        self.assertTrue(control_kept(control, worse)["max_drawdown"])


class RiskDirectionTest(unittest.TestCase):
    """§9.2 C가 보는 네 항목."""

    def arms(self, **changes):
        base = {"sharpe": 0.4, "max_drawdown": 0.12, "sortino": 0.6, "calmar": 0.2}
        return ({"metrics": dict(base)}, {"metrics": {**base, **changes}})

    def test_direction_is_per_metric(self):
        control, better = self.arms(sortino=0.9)
        got = risk_directions(control, better)
        self.assertTrue(got["sortino_up"])
        self.assertFalse(got["sharpe_up"])

    def test_lower_is_better_for_drawdown(self):
        control, better = self.arms(max_drawdown=0.09)
        self.assertTrue(risk_directions(control, better)["max_drawdown_down"])

    def test_equal_is_not_an_improvement(self):
        control, same = self.arms()
        self.assertFalse(any(risk_directions(control, same).values()))

    def test_exposure_is_not_one_of_the_four(self):
        """PR #16의 네 항목과 다르다. **여기는 Sortino가 들어가고 노출이 빠진다**(§9.2)."""
        control, other = self.arms()
        self.assertEqual(
            set(risk_directions(control, other)),
            {"sharpe_up", "max_drawdown_down", "sortino_up", "calmar_up"},
        )


class ScopeTest(unittest.TestCase):
    """**사전등록 §5의 금지 목록.**"""

    SOURCE = (TRADING_ROOT / "selftest" / "signal_invalidation_run.py").read_text(
        encoding="utf-8"
    )

    def test_only_two_arms(self):
        self.assertEqual(len(ARMS), 2)

    def test_no_new_knob(self):
        """confirmation days · buffer · alternate SMA · ATR threshold를 만들지 않는다."""
        for word in ("confirmation_days", "sma100", "sma50", "buffer_pct",
                     "atr_threshold"):
            self.assertNotIn(word, self.SOURCE, word)

    def test_the_runner_defines_no_core(self):
        """**러너가 규칙을 만들지 않는다.** 코어 하나가 파일 하나이고 러너는 부르기만 한다."""
        for word in ("CoreDefinition", "jt_policy", "StrategyParameters"):
            self.assertNotIn(word, self.SOURCE, word)

    def test_no_sizing_slot_or_hold_change(self):
        for word in ("risk_per_trade", "stop_atr_multiple", "max_position_weight",
                     "max_hold_sessions=", "max_positions=", "max_candidates="):
            self.assertNotIn(word, self.SOURCE, word)

    def test_the_holdout_is_not_consumed(self):
        self.assertNotIn("consume_holdout", self.SOURCE)

    def test_no_rank_or_abs_exit(self):
        for word in ("absolute_momentum", "rank_exit", "RS_RANK"):
            self.assertNotIn(word, self.SOURCE, word)


if __name__ == "__main__":
    unittest.main()
