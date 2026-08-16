"""변환 퍼널 진단의 계측과 사전등록 판정.

**가장 중요한 것은 `EntryObserverTest`다.** 관찰자가 엔진 분기에 끼어들면 이 진단이
PR #13의 재현을 깨뜨리고, 그러면 진단과 실험이 서로 다른 실행을 설명하게 된다. 관찰자를
켜고 끈 두 실행의 거래·체결·자산곡선·스킵이 전부 같아야 한다.

두 번째로 중요한 것은 `PatternTest`다. PATTERN A/E/S/N 규칙은 결과를 보기 전에 정한
것이고, 결과가 나온 뒤 슬쩍 바뀌면 사전등록의 의미가 없다. 표의 각 줄을 값으로 잠근다.
"""

from __future__ import annotations

import statistics
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
    ALIGNMENT_PATTERNS,
    ALIGNMENT_TRIM,
    BASELINE,
    CHALLENGER,
    DATA_EXIT_REASONS,
    DISTRIBUTION_TOLERANCE,
    HORIZON,
    PATTERNS,
    SIGNALS,
    TAIL_SIZE,
    _tail,
    alignment_rows,
    alignment_stats,
    allocation_weighted_mean,
    classify_alignment,
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
    trimmed_by_return,
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


class TailTest(unittest.TestCase):
    """§21.3 탐색적 진단의 꼬리. **사전등록 판정을 바꾸지 않는 관찰이다.**"""

    def rows(self) -> list[dict]:
        return [
            {"entry_price": 100.0, "exit_price": 100.0 + step, "stop_distance": 1.0,
             "planned_entry": 100.0, "return_r": float(step)}
            for step in range(30)
        ]

    def test_the_tail_is_the_best_raw_returns(self):
        tail = _tail(self.rows())
        self.assertEqual(len(tail), TAIL_SIZE)
        self.assertEqual(tail[0]["exit_price"], 129.0)
        self.assertEqual(tail[-1]["exit_price"], 120.0)

    def test_a_row_without_a_fill_is_not_in_the_tail(self):
        rows = self.rows() + [{"outcome": ACCEPTED, "rank": 1}]
        for row in _tail(rows):
            self.assertIn("exit_price", row)

    def test_a_short_sample_gives_what_it_has(self):
        self.assertEqual(len(_tail(self.rows()[:3])), 3)
        self.assertEqual(_tail([]), [])


class AllocationWeightedMeanTest(unittest.TestCase):
    """§20.4 정렬 진단의 산술. **포트폴리오 수익률이 아니라 정렬 진단이다.**"""

    def test_the_worked_example(self):
        """수익 10%·0%에 가중치 1·3이면 (0.1×1 + 0×3) / 4 = 0.025."""
        self.assertAlmostEqual(
            allocation_weighted_mean([0.10, 0.00], [1.0, 3.0]), 0.025
        )

    def test_equal_weights_give_the_arithmetic_mean(self):
        """**가중치가 모두 같으면 산술평균이어야 한다.** 아니면 가중이 뭔가를 더 하고 있다."""
        returns = [0.10, -0.04, 0.02, 0.31, -0.15]
        for weight in (1.0, 7.5, 0.001):
            self.assertAlmostEqual(
                allocation_weighted_mean(returns, [weight] * len(returns)),
                statistics.fmean(returns),
            )

    def test_no_weight_means_no_answer(self):
        """합이 0이거나 표본이 없으면 나눌 것이 없다. 0을 지어내지 않는다."""
        self.assertIsNone(allocation_weighted_mean([], []))
        self.assertIsNone(allocation_weighted_mean([0.1, 0.2], [0.0, 0.0]))

    def test_mismatched_lengths_are_refused(self):
        """짝이 어긋나면 조용히 zip으로 잘리는 대신 터진다."""
        with self.assertRaises(ValueError):
            allocation_weighted_mean([0.1, 0.2], [1.0])

    def test_a_heavy_loser_pulls_the_weighted_mean_below_the_equal_mean(self):
        """정렬 격차의 부호가 무엇을 뜻하는지 값으로 잠근다."""
        returns, weights = [0.10, -0.10], [1.0, 9.0]
        self.assertAlmostEqual(statistics.fmean(returns), 0.0)
        self.assertLess(allocation_weighted_mean(returns, weights), 0.0)


class AlignmentRowTest(unittest.TestCase):
    def row(self, **changes) -> dict:
        base = {
            "entry_notional": 4000.0,
            "equity_at_signal": 100_000.0,
            "planned_entry": 100.0,
            "atr14": 2.0,
            "pnl": 40.0,
        }
        base.update(changes)
        return base

    def test_a_row_missing_any_piece_is_not_an_observation(self):
        self.assertEqual(len(alignment_rows([self.row()])), 1)
        for key in ("entry_notional", "equity_at_signal", "planned_entry", "pnl"):
            partial = self.row()
            del partial[key]
            self.assertEqual(alignment_rows([partial]), [])

    def test_the_stats_come_out_of_the_existing_trace_fields(self):
        stats = alignment_stats([self.row(), self.row(pnl=-40.0)])
        self.assertEqual(stats["count"], 2)
        self.assertAlmostEqual(stats["equal_trade_mean"], 0.0)
        self.assertAlmostEqual(stats["median_weight"], 0.04)
        self.assertAlmostEqual(stats["median_atr_fraction"], 0.02)

    def test_the_gap_is_weighted_minus_equal(self):
        stats = alignment_stats(
            [self.row(pnl=400.0), self.row(entry_notional=8000.0, pnl=-800.0)]
        )
        self.assertAlmostEqual(
            stats["alignment_gap"],
            stats["allocation_weighted_mean"] - stats["equal_trade_mean"],
        )


class TrimTest(unittest.TestCase):
    """**사전에 1% 하나만 고른다.** 결과를 보고 늘리지 않는다."""

    def rows(self, count: int) -> list[dict]:
        return [
            {
                "entry_notional": 1000.0,
                "equity_at_signal": 100_000.0,
                "planned_entry": 100.0,
                "atr14": 2.0,
                "pnl": float(index),
            }
            for index in range(count)
        ]

    def test_the_fraction_is_one_percent(self):
        self.assertAlmostEqual(ALIGNMENT_TRIM, 0.01)

    def test_it_drops_exactly_the_pre_registered_share(self):
        """500건이면 5건, 514건이면 5건(내림)이다."""
        self.assertEqual(len(trimmed_by_return(self.rows(500))), 495)
        self.assertEqual(len(trimmed_by_return(self.rows(514))), 509)

    def test_a_small_sample_loses_nothing(self):
        """뺄 것이 1건도 안 되면 아무것도 빼지 않는다."""
        self.assertEqual(len(trimmed_by_return(self.rows(99))), 99)
        self.assertEqual(trimmed_by_return([]), [])

    def test_it_trims_by_absolute_return_so_both_tails_go(self):
        """**절대값 상위**다. 큰 승자만 빼면 평균이 한쪽으로 기운다."""
        rows = self.rows(100)
        rows[0]["pnl"] = -5000.0  # 가장 큰 손실
        rows[99]["pnl"] = 4000.0  # 가장 큰 이익
        kept = trimmed_by_return(rows)
        self.assertEqual(len(kept), 99)
        self.assertNotIn(-5000.0, [row["pnl"] for row in kept])
        self.assertIn(4000.0, [row["pnl"] for row in kept])


class AlignmentPatternTest(unittest.TestCase):
    """X1/X2/X3는 **탐색적 해석 범위**이고 사전등록 판정과 분리돼 있다."""

    def stats(self, **changes) -> dict:
        base = {
            "rho_weight_return": -0.4,
            "rho_atr_return": 0.4,
            "alignment_gap": -0.005,
        }
        base.update(changes)
        return {BASELINE: dict(base), CHALLENGER: dict(base)}

    def test_x1_needs_every_dilution_sign_together(self):
        verdict = classify_alignment(
            self.stats(), {"equal": 0.008, "weighted": 0.001}, self.stats()
        )
        self.assertEqual(verdict, "X1")

    def test_a_single_wrong_sign_drops_x1(self):
        for key, value in (
            ("rho_weight_return", 0.4),
            ("rho_atr_return", -0.4),
            ("alignment_gap", 0.005),
        ):
            stats = self.stats(**{key: value})
            self.assertNotEqual(
                classify_alignment(
                    stats, {"equal": 0.008, "weighted": 0.001}, stats
                ),
                "X1",
                key,
            )

    def test_x2_is_a_weak_relation_that_survives_weighting(self):
        stats = self.stats(rho_weight_return=0.01, rho_atr_return=-0.01,
                           alignment_gap=0.0001)
        self.assertEqual(
            classify_alignment(stats, {"equal": 0.008, "weighted": 0.009}, stats),
            "X2",
        )

    def test_a_sign_flip_under_trimming_is_always_x3(self):
        """**몇 건이 만든 관계면 X1로 올리지 않는다.**"""
        full = self.stats()
        flipped = self.stats(alignment_gap=+0.005)
        self.assertEqual(
            classify_alignment(full, {"equal": 0.008, "weighted": 0.001}, flipped),
            "X3",
        )

    def test_a_missing_number_never_claims_dilution(self):
        for key in ("rho_weight_return", "rho_atr_return", "alignment_gap"):
            stats = self.stats(**{key: None})
            self.assertEqual(
                classify_alignment(stats, {"equal": 0.008, "weighted": 0.001}, stats),
                "X3",
            )
        self.assertEqual(
            classify_alignment(
                self.stats(), {"equal": None, "weighted": None}, self.stats()
            ),
            "X3",
        )

    def test_every_verdict_is_one_of_the_three(self):
        for rho_weight in (-0.4, 0.0, 0.4):
            for rho_atr in (-0.4, 0.0, 0.4):
                for gap in (-0.005, 0.0, 0.005):
                    stats = self.stats(
                        rho_weight_return=rho_weight,
                        rho_atr_return=rho_atr,
                        alignment_gap=gap,
                    )
                    for weighted in (0.001, 0.009):
                        self.assertIn(
                            classify_alignment(
                                stats, {"equal": 0.008, "weighted": weighted}, stats
                            ),
                            ALIGNMENT_PATTERNS,
                        )


class VerdictIsolationTest(unittest.TestCase):
    """**탐색적 진단이 사전등록 판정을 건드리면 안 된다.**"""

    def test_the_alignment_verdict_never_feeds_the_registered_pattern(self):
        """`classify_pattern`은 정렬 진단의 값을 인자로 받지도 않는다."""
        import inspect

        signature = inspect.signature(classify_pattern)
        self.assertEqual(list(signature.parameters), ["deltas", "differ"])

    def test_the_registered_verdict_still_reads_this_run_the_same_way(self):
        """이 PR의 실제 층 값에서 판정이 `NO_CLEAR_STAGE`·`INCONCLUSIVE`로 남는다.

        **탐색적 절을 더한 뒤에도 공식 결론이 그대로여야 한다.** 값은 결과 문서의 것이다.
        """
        measured = {
            "top5_excess": 0.005487,
            "accepted_excess": 0.003539,
            "filled_excess": 0.007343,
            "raw_return": 0.009104,
            "realized_r": 0.0035,
            "dollar_per_trade": 5.88,
        }
        for differ in (True, False):
            self.assertEqual(classify_pattern(measured, differ), "NO_CLEAR_STAGE")
            self.assertEqual(next_intervention("NO_CLEAR_STAGE"), "INCONCLUSIVE")

    def test_the_threshold_was_not_relaxed(self):
        """5% 문턱을 결과 보고 낮추지 않았다."""
        self.assertAlmostEqual(DISTRIBUTION_TOLERANCE, 0.05)

    def test_no_criterion_was_added_to_the_registered_set(self):
        """A~L 열두 개다. M·N을 소급 추가하지 않는다."""
        self.assertEqual(len(PATTERNS), 4)
        self.assertEqual(
            set(PATTERNS),
            {"ADMISSION", "EXECUTION_EXIT", "SIZING", "NO_CLEAR_STAGE"},
        )


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

    def test_the_alignment_diagnostic_adds_no_run_core_or_policy(self):
        """**§20.4는 기존 trace를 다시 집계할 뿐이다.**

        실행 목록·코어 목록·정책이 그대로여야 새 백테스트를 돌리지 않았다고 말할 수 있다.
        """
        self.assertEqual(len(planned()), 4)
        self.assertEqual(SIGNALS, ("jt-k42", "jt-j126-k42"))
        for core in SIGNALS:
            self.assertIn(core, CORES)

    def test_the_alignment_diagnostic_reads_only_existing_trace_fields(self):
        """새 observer event 없이 계산된다 — trace에 이미 있는 필드만 쓴다."""
        row = {
            "entry_notional": 4000.0,
            "equity_at_signal": 100_000.0,
            "planned_entry": 100.0,
            "atr14": 2.0,
            "pnl": 40.0,
        }
        self.assertEqual(alignment_stats([row])["count"], 1)


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
