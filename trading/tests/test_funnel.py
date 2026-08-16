"""변환 퍼널 진단의 계측과 사전등록 판정.

**가장 중요한 것은 `EntryObserverTest`다.** 관찰자가 엔진 분기에 끼어들면 이 진단이
PR #13의 재현을 깨뜨리고, 그러면 진단과 실험이 서로 다른 실행을 설명하게 된다. 관찰자를
켜고 끈 두 실행의 거래·체결·자산곡선·스킵이 전부 같아야 한다.

두 번째로 중요한 것은 `PatternTest`다. PATTERN A/E/S/N 규칙은 결과를 보기 전에 정한
것이고, 결과가 나온 뒤 슬쩍 바뀌면 사전등록의 의미가 없다. 표의 각 줄을 값으로 잠근다.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

TRADING_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TRADING_ROOT))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import test_loop  # noqa: E402
from backtest.loop import ACCEPTED, EntryEvent, run_backtest  # noqa: E402
from core import CORES  # noqa: E402
from selftest.funnel_run import (  # noqa: E402
    BASELINE,
    CHALLENGER,
    DATA_EXIT_REASONS,
    DISTRIBUTION_TOLERANCE,
    HORIZON,
    PATTERNS,
    SIGNALS,
    classify_pattern,
    describe,
    distributions_differ,
    forward_return,
    gross_notional_returns,
    net_notional_returns,
    next_intervention,
    percentile_of,
    planned,
    raw_returns,
    sizing_series,
    spearman,
    stages_of,
    trace_path,
)


def _deltas(**changes) -> dict:
    """PATTERN 판정이 보는 다섯 층. 기본은 "모든 층에서 J126이 우세"다."""
    base = {
        "top5_excess": 0.01,
        "filled_excess": 0.008,
        "raw_return": 0.006,
        "realized_r": 0.05,
        "dollar_per_trade": 12.0,
    }
    base.update(changes)
    return base


class PatternTest(unittest.TestCase):
    """§21의 표를 값으로 잠근다. **결과를 본 뒤 규칙을 바꾸지 않는다.**"""

    def test_admission_when_the_edge_is_gone_before_sizing(self):
        """TOP5는 우세한데 FILLED에서 사라지면 sizing 이전 문제다."""
        self.assertEqual(
            classify_pattern(_deltas(filled_excess=-0.002), True), "ADMISSION"
        )

    def test_admission_does_not_depend_on_the_sizing_distribution(self):
        """sizing 분포가 달라도 admission에서 이미 사라졌으면 admission이다."""
        for differ in (True, False):
            self.assertEqual(
                classify_pattern(_deltas(filled_excess=-0.002), differ), "ADMISSION"
            )

    def test_execution_exit_when_the_signal_survives_but_the_trade_does_not(self):
        self.assertEqual(
            classify_pattern(_deltas(raw_return=-0.001), True), "EXECUTION_EXIT"
        )

    def test_sizing_needs_both_a_surviving_raw_edge_and_a_distribution_difference(self):
        """**`correlation != causation`이다.**

        raw 수익률 우위가 살아 있고, R 또는 달러에서 뒤집히고, 분포 차이가 실재할 때만
        sizing이다. 셋 중 하나라도 빠지면 올리지 않는다.
        """
        self.assertEqual(classify_pattern(_deltas(realized_r=-0.01), True), "SIZING")
        self.assertEqual(
            classify_pattern(_deltas(dollar_per_trade=-5.0), True), "SIZING"
        )
        # 분포 차이가 없으면 메커니즘이 없다.
        self.assertEqual(
            classify_pattern(_deltas(realized_r=-0.01), False), "NO_CLEAR_STAGE"
        )

    def test_no_clear_stage_when_the_signal_edge_never_existed(self):
        """**우위가 애초에 없으면 소실 지점을 물을 수 없다.**"""
        self.assertEqual(classify_pattern(_deltas(top5_excess=-0.001), True), "NO_CLEAR_STAGE")
        self.assertEqual(classify_pattern(_deltas(top5_excess=0.0), True), "NO_CLEAR_STAGE")

    def test_no_clear_stage_when_every_layer_keeps_the_advantage(self):
        """모든 층에서 유지되면 collapse point가 없다."""
        self.assertEqual(classify_pattern(_deltas(), True), "NO_CLEAR_STAGE")

    def test_a_missing_layer_never_names_a_culprit(self):
        for key in _deltas():
            self.assertEqual(
                classify_pattern(_deltas(**{key: None}), True), "NO_CLEAR_STAGE"
            )

    def test_every_verdict_is_one_of_the_four_registered_patterns(self):
        for differ in (True, False):
            for key in _deltas():
                for value in (-1.0, 0.0, 1.0):
                    self.assertIn(
                        classify_pattern(_deltas(**{key: value}), differ), PATTERNS
                    )

    def test_only_sizing_opens_the_next_ablation(self):
        """§30 Q2. 이 매핑이 바뀌면 다음 PR의 근거가 바뀐다."""
        self.assertEqual(next_intervention("SIZING"), "YES")
        self.assertEqual(next_intervention("ADMISSION"), "NO")
        self.assertEqual(next_intervention("EXECUTION_EXIT"), "NO")
        self.assertEqual(next_intervention("NO_CLEAR_STAGE"), "INCONCLUSIVE")


class DistributionDifferenceTest(unittest.TestCase):
    def summary(self, atr: float, weight: float) -> dict:
        return {
            "atr_fraction": {"median": atr},
            "entry_notional_weight": {"median": weight},
        }

    def test_the_threshold_is_relative_and_pre_registered(self):
        base = self.summary(0.02, 0.04)
        just_under = self.summary(0.02 * (1 + DISTRIBUTION_TOLERANCE / 2), 0.04)
        just_over = self.summary(0.02 * (1 + DISTRIBUTION_TOLERANCE * 2), 0.04)
        self.assertFalse(distributions_differ(base, just_under))
        self.assertTrue(distributions_differ(base, just_over))

    def test_either_axis_is_enough(self):
        base = self.summary(0.02, 0.04)
        self.assertTrue(distributions_differ(base, self.summary(0.02, 0.05)))

    def test_a_missing_axis_does_not_claim_a_difference(self):
        self.assertFalse(distributions_differ({}, {}))


class StageTest(unittest.TestCase):
    """단계는 서로 포함관계여야 한다. 뒤집히면 표가 조용히 틀린다."""

    def rows(self) -> list[dict]:
        return [
            {"outcome": "MAX_POSITIONS_REACHED", "rank": 1, "symbol": "A"},
            {"outcome": ACCEPTED, "rank": 2, "symbol": "B", "fill_cancel_reason": "NO_FILL"},
            {"outcome": ACCEPTED, "rank": 3, "symbol": "C", "entry_date": "2020-01-02"},
            {
                "outcome": ACCEPTED,
                "rank": 4,
                "symbol": "D",
                "entry_date": "2020-01-02",
                "exit_date": "2020-03-02",
            },
        ]

    def test_each_stage_is_contained_in_the_one_before(self):
        stages = stages_of(self.rows())
        self.assertEqual(len(stages["TOP5"]), 4)
        self.assertEqual(len(stages["ACCEPTED"]), 3)
        self.assertEqual(len(stages["FILLED"]), 2)
        self.assertEqual(len(stages["CLOSED"]), 1)
        for outer, inner in (("TOP5", "ACCEPTED"), ("ACCEPTED", "FILLED"), ("FILLED", "CLOSED")):
            self.assertGreaterEqual(len(stages[outer]), len(stages[inner]))
            for row in stages[inner]:
                self.assertIn(row, stages[outer])

    def test_accepted_is_not_filled(self):
        """**`ACCEPTED`는 주문 수락이지 체결이 아니다.** 통과했는데 안 팔릴 수 있다."""
        stages = stages_of(self.rows())
        self.assertNotIn(
            "B", [row["symbol"] for row in stages["FILLED"]]
        )


class TradeReturnTest(unittest.TestCase):
    def row(self, **changes) -> dict:
        base = {
            "entry_price": 100.0,
            "exit_price": 110.0,
            "entry_notional": 1000.0,
            "pnl": 90.0,
            "fees": 10.0,
        }
        base.update(changes)
        return base

    def test_raw_return_is_the_price_ratio(self):
        self.assertAlmostEqual(raw_returns([self.row()])[0], 0.10)

    def test_net_notional_return_already_carries_the_fees(self):
        """`pnl`은 두 체결의 현금 변화 합이라 수수료가 이미 빠져 있다."""
        self.assertAlmostEqual(net_notional_returns([self.row()])[0], 0.09)

    def test_gross_puts_the_fees_back(self):
        self.assertAlmostEqual(gross_notional_returns([self.row()])[0], 0.10)

    def test_a_row_without_a_fill_contributes_nothing(self):
        self.assertEqual(raw_returns([{"outcome": ACCEPTED}]), [])
        self.assertEqual(net_notional_returns([{"outcome": ACCEPTED}]), [])


class SizingSeriesTest(unittest.TestCase):
    """§10의 정규화는 전부 계획 진입가 기준이다."""

    def row(self) -> dict:
        return {
            "atr14": 2.0,
            "planned_entry": 100.0,
            "stop_distance": 4.0,
            "entry_notional": 5000.0,
            "equity_at_signal": 100_000.0,
            "planned_risk_fraction": 0.0025,
            "effective_risk_ratio": 1.0,
        }

    def test_the_five_distributions(self):
        series = sizing_series([self.row()])
        self.assertAlmostEqual(series["atr_fraction"][0], 0.02)
        self.assertAlmostEqual(series["stop_fraction"][0], 0.04)
        self.assertAlmostEqual(series["entry_notional_weight"][0], 0.05)
        self.assertAlmostEqual(series["planned_risk_fraction"][0], 0.0025)
        self.assertAlmostEqual(series["effective_risk_ratio"][0], 1.0)

    def test_stop_fraction_is_the_atr_fraction_times_the_stop_multiple(self):
        """`stop_distance = 2 × ATR`이므로 정규화 값도 정확히 두 배다."""
        series = sizing_series([self.row()])
        self.assertAlmostEqual(
            series["stop_fraction"][0], series["atr_fraction"][0] * 2
        )

    def test_a_rejected_candidate_has_no_sizing(self):
        series = sizing_series([{"outcome": "ALREADY_HELD", "rank": 1}])
        self.assertEqual(sum(len(values) for values in series.values()), 0)


class StatisticsTest(unittest.TestCase):
    def test_describe_reports_real_observations(self):
        summary = describe([float(v) for v in range(1, 101)])
        self.assertEqual(summary["count"], 100)
        self.assertEqual(summary["max"], 100.0)
        self.assertEqual(summary["p10"], 10.0)
        self.assertEqual(summary["p90"], 90.0)

    def test_describe_of_nothing_is_all_none(self):
        summary = describe([])
        self.assertEqual(summary["count"], 0)
        for key in ("mean", "median", "p10", "max"):
            self.assertIsNone(summary[key])

    def test_percentile_of_places_a_point_in_its_own_distribution(self):
        values = [float(v) for v in range(1, 101)]
        self.assertAlmostEqual(percentile_of(values, 50.0), 50.0)
        self.assertAlmostEqual(percentile_of(values, 100.0), 100.0)

    def test_percentile_of_nothing_is_none(self):
        self.assertIsNone(percentile_of([], 1.0))
        self.assertIsNone(percentile_of([1.0], None))

    def test_spearman_is_a_rank_correlation(self):
        """단조 관계면 ±1이다. 선형이 아니어도 그렇다는 것이 순위를 쓰는 이유다."""
        xs = [1.0, 2.0, 3.0, 4.0, 5.0]
        self.assertAlmostEqual(spearman(xs, [1.0, 4.0, 9.0, 16.0, 25.0]), 1.0)
        self.assertAlmostEqual(spearman(xs, [25.0, 16.0, 9.0, 4.0, 1.0]), -1.0)

    def test_spearman_needs_a_sample(self):
        self.assertIsNone(spearman([1.0], [1.0]))
        self.assertIsNone(spearman([1.0, 2.0, 3.0], [1.0, 1.0, 1.0]))


class ScopeTest(unittest.TestCase):
    """**이번 PR은 두 코어만 읽는다.** 목록이 늘면 실험이 다른 것이 된다."""

    def test_exactly_two_cores(self):
        self.assertEqual(SIGNALS, (BASELINE, CHALLENGER))
        self.assertEqual(BASELINE, "jt-k42")
        self.assertEqual(CHALLENGER, "jt-j126-k42")

    def test_the_only_strategy_difference_is_the_formation_horizon(self):
        """새 코어를 만들지 않았다. 기존 둘의 차이는 `rs_lookback` 하나여야 한다."""
        left, right = CORES[BASELINE], CORES[CHALLENGER]
        self.assertEqual(left.policy.parameters.rs_lookback, 63)
        self.assertEqual(right.policy.parameters.rs_lookback, 126)
        self.assertEqual(
            left.policy.parameters.max_hold_sessions,
            right.policy.parameters.max_hold_sessions,
        )
        self.assertEqual(left.policy.limits, right.policy.limits)
        self.assertEqual(left.policy.profile, right.policy.profile)

    def test_the_horizon_matches_the_pre_registered_primary(self):
        """PR #12의 사전 고정 primary는 +42다. 다른 지평으로 갈아타지 않는다."""
        self.assertEqual(HORIZON, 42)

    def test_four_runs_and_no_more(self):
        jobs = planned()
        self.assertEqual(len(jobs), 4)
        self.assertEqual({core for core, _ in jobs}, set(SIGNALS))
        self.assertEqual({scenario for _, scenario in jobs}, {"LAST_CLOSE", "ZERO"})

    def test_last_close_and_zero_never_share_a_file(self):
        """**ZERO를 main 퍼널과 섞지 않는다.** 파일부터 갈라 둔다."""
        for core in SIGNALS:
            self.assertNotEqual(
                trace_path(core, "LAST_CLOSE"), trace_path(core, "ZERO")
            )
            self.assertIn("zero", trace_path(core, "ZERO").name)

    def test_data_exits_are_the_engine_reasons(self):
        self.assertEqual(DATA_EXIT_REASONS, ("DELISTED_EXIT", "UNRESOLVED_EXIT"))


class EntryObserverTest(unittest.TestCase):
    """**가장 중요한 테스트.** 계측이 결과를 바꾸면 진단이 실험을 설명하지 못한다."""

    @classmethod
    def setUpClass(cls):
        cls.connection, cls.dates = test_loop.build()

    @classmethod
    def tearDownClass(cls):
        cls.connection.close()

    def config(self):
        core = CORES[BASELINE]
        return test_loop.config(
            self.dates,
            policy=core.policy,
            entry_mode=core.entry_mode,
            exit_mode=core.exit_mode,
            regime_mode=core.regime_mode,
            require_earnings_calendar=False,
        )

    def traced(self):
        events: list[EntryEvent] = []
        seen: list[tuple[str, int, str, str]] = []
        result = run_backtest(
            self.connection,
            self.config(),
            observer=lambda *args: seen.append(args),
            entry_observer=events.append,
        )
        return result, seen, events

    def test_the_observers_do_not_change_the_result(self):
        plain = run_backtest(self.connection, self.config())
        traced, _, _ = self.traced()
        self.assertEqual(plain.trades, traced.trades)
        self.assertEqual(plain.fills, traced.fills)
        self.assertEqual(plain.equity_curve, traced.equity_curve)
        self.assertEqual(plain.open_positions, traced.open_positions)
        self.assertEqual(plain.skip_counts, traced.skip_counts)
        self.assertEqual(plain.fill_counts, traced.fill_counts)
        self.assertEqual(plain.exit_counts, traced.exit_counts)

    def test_the_entry_observer_alone_changes_nothing(self):
        plain = run_backtest(self.connection, self.config())
        traced = run_backtest(
            self.connection, self.config(), entry_observer=lambda _: None
        )
        self.assertEqual(plain.trades, traced.trades)
        self.assertEqual(plain.final_equity, traced.final_equity)

    def test_a_raising_entry_observer_surfaces(self):
        """관찰자 오류를 삼키면 표가 조용히 비어버린다. 터지는 편이 낫다."""

        def boom(_event):
            raise RuntimeError("관찰자 실패")

        with self.assertRaises(RuntimeError):
            run_backtest(self.connection, self.config(), entry_observer=boom)

    def test_one_event_per_accepted_order_that_had_an_execution_session(self):
        """**구간 마지막 세션의 주문은 집행할 다음 날이 없다.** 그 차이만큼만 적다."""
        _, seen, events = self.traced()
        accepted = [row for row in seen if row[3] == ACCEPTED]
        self.assertGreater(len(accepted), 0)
        self.assertLessEqual(len(events), len(accepted))
        keys = [(event.signal_date, event.intent.symbol) for event in events]
        self.assertEqual(len(keys), len(set(keys)))
        for event in events:
            self.assertIn(
                (event.signal_date, event.rank, event.intent.symbol, ACCEPTED), seen
            )

    def test_an_event_is_either_a_fill_or_a_cancellation(self):
        _, _, events = self.traced()
        for event in events:
            self.assertNotEqual(event.fill is None, event.cancel_reason is None)
            self.assertGreater(event.execution_date, event.signal_date)

    def test_the_fills_the_observer_saw_are_the_fills_the_run_recorded(self):
        """관찰한 체결이 결과의 체결과 다르면 계측 지점이 틀린 것이다."""
        result, _, events = self.traced()
        observed = {
            (event.fill.symbol, event.fill.trade_date)
            for event in events
            if event.fill is not None
        }
        recorded = {
            (fill.symbol, fill.trade_date) for fill in result.fills if fill.side == "BUY"
        }
        self.assertEqual(observed, recorded)

    def test_the_intent_carries_the_sizing_the_engine_used(self):
        """**진단용 sizing 계산기를 따로 만들지 않는다.** 엔진 값이 그대로 나와야 한다."""
        _, _, events = self.traced()
        parameters = CORES[BASELINE].policy.parameters
        risk_per_trade = CORES[BASELINE].policy.profile.risk_per_trade
        for event in events:
            intent = event.intent
            self.assertAlmostEqual(
                intent.stop_distance, parameters.stop_atr_multiple * intent.atr14
            )
            self.assertAlmostEqual(
                intent.planned_risk, intent.shares * intent.stop_distance
            )
            self.assertAlmostEqual(
                intent.effective_risk_ratio,
                intent.planned_risk_fraction / risk_per_trade,
            )
            # 계좌 자산을 두 번 조회하지 않고 여기서 되찾는다.
            equity = intent.planned_risk / intent.planned_risk_fraction
            self.assertGreater(equity, 0)

    def test_the_caps_explain_the_binding_constraint(self):
        """구속 제약은 상한들의 최솟값이어야 한다. 아니면 어느 상한이 정했는지 못 읽는다."""
        _, _, events = self.traced()
        checked = 0
        for event in events:
            caps, intent = event.caps, event.intent
            if caps is None or intent.min_qty_exception:
                continue
            values = {
                "RISK": caps.by_risk,
                "CAPITAL": caps.by_capital,
                "LIQUIDITY": caps.by_liquidity,
                "EXPOSURE": caps.by_exposure,
                **dict(caps.extra),
            }
            self.assertEqual(min(values.values()), values[intent.binding_constraint])
            checked += 1
        self.assertGreater(checked, 0)

    def test_a_fill_matches_a_trade_by_symbol_and_entry_date(self):
        """퍼널이 거래를 잇는 열쇠다. 유일하지 않으면 조인이 조용히 어긋난다."""
        result, _, _ = self.traced()
        keys = [(trade.symbol, trade.entry_date) for trade in result.trades]
        self.assertEqual(len(keys), len(set(keys)))


class ForwardReturnTest(unittest.TestCase):
    """신호 층 척도는 PR #12 정의 그대로다."""

    @classmethod
    def setUpClass(cls):
        cls.connection, cls.dates = test_loop.build()

    @classmethod
    def tearDownClass(cls):
        cls.connection.close()

    def cache(self):
        from backtest.data import BarCache

        return BarCache(self.connection, test_loop.VERSION)

    def test_a_flat_symbol_has_no_forward_return(self):
        value, stale = forward_return(
            self.cache(), "FLAT00", self.dates[300], self.dates[342]
        )
        self.assertAlmostEqual(value, 0.0)
        self.assertFalse(stale)

    def test_a_rising_symbol_has_a_positive_forward_return(self):
        value, _ = forward_return(
            self.cache(), test_loop.TREND_NAMES[0], self.dates[300], self.dates[342]
        )
        self.assertGreater(value, 0)

    def test_a_target_past_the_last_bar_freezes_at_the_last_close(self):
        """**폐지 종목을 빼지 않는다.** 마지막 종가로 고정하고 그 사실을 표시한다."""
        value, stale = forward_return(
            self.cache(), "FLAT00", self.dates[300], "2099-01-01"
        )
        self.assertAlmostEqual(value, 0.0)
        self.assertTrue(stale)

    def test_an_unknown_symbol_has_nothing(self):
        value, stale = forward_return(
            self.cache(), "NOPE", self.dates[300], self.dates[342]
        )
        self.assertIsNone(value)
        self.assertFalse(stale)


if __name__ == "__main__":
    unittest.main(verbosity=1)
