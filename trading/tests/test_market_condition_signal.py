"""PR #15 confirmatory market re-cut의 계산과 사전등록 판정.

**가장 중요한 것은 두 가지다.**

1. `ConstantsTest`·`HardVerdictTest` — 사전등록한 고정 변수와 HARD A~D 문턱이 결과를 본 뒤
   바뀌지 않는다. 바뀌면 사전등록이 아무것도 보증하지 못한다.
2. `HoldoutTest` — 홀드아웃을 아예 읽지 않는다. **신호일만 자르면 forward 목표일이 넘어간다.**

`ScopeTest`는 이 PR이 신호 층에 머무르는지 잠근다 — 새 코어도, 새 전략 파라미터도, 진입
게이트도 만들지 않았다.
"""

from __future__ import annotations

import statistics
import sys
import unittest
from pathlib import Path

TRADING_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TRADING_ROOT))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from backtest.holdout import HOLDOUT_START, research_sessions  # noqa: E402
from backtest.regime import classify_market_regime, market_trend  # noqa: E402
from backtest.study import TOP_LABEL, Forward  # noqa: E402
from selftest.market_condition_signal import (  # noqa: E402
    DOWN,
    GROUPS,
    HORIZON,
    J_CONTROL,
    J_PRIMARY,
    JS,
    PHASE_COUNT,
    PHASE_POSITIVE_SHARE_MINIMUM,
    RANDOM_BEAT_MINIMUM,
    RANDOM_SEEDS,
    SKIP,
    TOP_N,
    UNIVERSES,
    UP,
    beats,
    concentration_label,
    hard_verdicts,
    market_group,
    new_study,
)


class ConstantsTest(unittest.TestCase):
    """**사전등록한 고정 변수.** 결과를 보고 바꾸지 않는다."""

    def test_the_frozen_signals(self):
        self.assertEqual(J_PRIMARY, 126)
        self.assertEqual(J_CONTROL, 63)
        self.assertEqual(JS, (63, 126))
        self.assertEqual(SKIP, 5)

    def test_the_primary_horizon_and_selection(self):
        self.assertEqual(HORIZON, 42)
        self.assertEqual(TOP_N, 5)

    def test_exactly_the_existing_twenty_seeds(self):
        """**결과를 보고 시드를 늘리지 않는다.**"""
        self.assertEqual(RANDOM_SEEDS, tuple(range(20)))
        self.assertEqual(len(RANDOM_SEEDS), 20)

    def test_exactly_forty_two_phase_offsets(self):
        """위상 수가 지평과 같아야 각 위상의 forward window가 겹치지 않는다."""
        self.assertEqual(PHASE_COUNT, HORIZON)

    def test_the_two_universes(self):
        self.assertEqual(UNIVERSES["ALL"], ("SP500", "NDX100"))
        self.assertEqual(UNIVERSES["NDX100"], ("NDX100",))

    def test_the_preregistered_thresholds(self):
        """HARD B·C의 문턱이다. 결과를 보고 낮추지 않는다."""
        self.assertEqual(RANDOM_BEAT_MINIMUM, 18)
        self.assertAlmostEqual(PHASE_POSITIVE_SHARE_MINIMUM, 0.60)


class MarketSplitTest(unittest.TestCase):
    """`UP` = `close > SMA200`. **경계는 DOWN이다.**"""

    def test_the_boundary(self):
        self.assertEqual(market_group(True), UP)
        self.assertEqual(market_group(False), DOWN)

    def test_the_split_reads_the_same_axis_the_engine_computes(self):
        """**레짐 문자열을 파싱하지 않는다.**

        `above_sma200`은 `close > sma_slow`이고 `market_trend`의 `BULL`·`CORRECTION`이
        정확히 그 조건이다. 둘이 어긋나면 이 연구의 split이 엔진과 다른 것을 뜻한다.
        """
        for close, fast, slow in (
            (110.0, 105.0, 100.0),  # BULL
            (110.0, 120.0, 100.0),  # CORRECTION
            (95.0, 90.0, 100.0),  # RECOVERY
            (95.0, 100.0, 100.0),  # BEAR
            (100.0, 100.0, 100.0),  # 경계
        ):
            above = close > slow
            trend = market_trend(close, fast, slow)
            expected = UP if trend in ("BULL", "CORRECTION") else DOWN
            self.assertEqual(market_group(above), expected, (close, fast, slow))

    def test_exactly_two_groups(self):
        self.assertEqual(GROUPS, (UP, DOWN))
        self.assertEqual(len(GROUPS), 2)


class PartitionTest(unittest.TestCase):
    """모든 유효 관측이 정확히 한 group에만 들어간다."""

    def rows(self, count: int) -> list[Forward]:
        return [
            Forward(f"S{i:02d}", float(count - i), {HORIZON: 0.01 * i}, frozenset())
            for i in range(count)
        ]

    def test_up_plus_down_equals_the_total(self):
        rows = self.rows(20)
        up, down, total = new_study(), new_study(), new_study()
        for index in range(10):
            target = up if index % 2 == 0 else down
            target.add_date(rows, {})
            total.add_date(rows, {})
        key = (TOP_LABEL, HORIZON)
        self.assertEqual(
            up.vs_universe[key].count + down.vs_universe[key].count,
            total.vs_universe[key].count,
        )
        self.assertEqual(up.dates + down.dates, total.dates)

    def test_a_date_lands_in_one_group_only(self):
        """같은 날짜를 두 group에 넣으면 표본이 부풀어 대비가 무의미해진다."""
        rows = self.rows(20)
        up, down = new_study(), new_study()
        up.add_date(rows, {})
        self.assertEqual(up.dates, 1)
        self.assertEqual(down.dates, 0)

    def test_top5_contributes_five_observations_per_date(self):
        rows = self.rows(20)
        study = new_study()
        study.add_date(rows, {})
        self.assertEqual(study.vs_universe[(TOP_LABEL, HORIZON)].count, TOP_N)


class HoldoutTest(unittest.TestCase):
    """**신호일만 자르면 forward 목표일이 넘어간다.** 달력 자체가 잘려야 한다."""

    def calendar(self) -> list[str]:
        from selftest.market_condition_signal import PARAMETERS  # noqa: F401

        return research_sessions(
            [f"2025-08-{day:02d}" for day in range(1, 15)]
        )

    def test_the_research_calendar_stops_before_the_holdout(self):
        calendar = self.calendar()
        self.assertTrue(calendar)
        self.assertLess(max(calendar), HOLDOUT_START)

    def test_the_forward_target_also_stays_inside_the_cut_calendar(self):
        """러너는 `index + 42 >= len(calendar)`에서 멈춘다. 그 산술을 값으로 확인한다."""
        calendar = [f"d{index:04d}" for index in range(100)]
        signals = [
            index for index in range(len(calendar)) if index + HORIZON < len(calendar)
        ]
        self.assertEqual(max(signals), len(calendar) - HORIZON - 1)
        for index in signals:
            self.assertLess(index + HORIZON, len(calendar))

    def test_the_runner_never_offers_a_consume_holdout_path(self):
        """**`--consume-holdout` 같은 경로를 만들지 않았다.**"""
        source = (TRADING_ROOT / "selftest" / "market_condition_signal.py").read_text()
        self.assertNotIn("consume_holdout=True", source)
        self.assertNotIn("--consume-holdout", source)

    def test_the_payload_declares_the_holdout_as_untouched(self):
        from backtest.holdout import holdout_metadata

        metadata = holdout_metadata(consumed=False)
        self.assertFalse(metadata["HOLDOUT_CONSUMED"])
        self.assertEqual(metadata["HOLDOUT_START"], HOLDOUT_START)


class RandomControlTest(unittest.TestCase):
    def test_beats_counts_strict_wins(self):
        distribution = {str(i): float(i) / 100 for i in range(20)}
        won, total = beats(0.10, distribution)
        self.assertEqual((won, total), (10, 20))

    def test_beating_everything_is_twenty_of_twenty(self):
        distribution = {str(i): 0.0 for i in range(20)}
        self.assertEqual(beats(1.0, distribution), (20, 20))

    def test_a_missing_actual_never_claims_a_win(self):
        distribution = {str(i): 0.0 for i in range(20)}
        self.assertEqual(beats(None, distribution), (0, 20))

    def test_random_picks_are_exactly_top_n(self):
        """무작위도 같은 크기여야 한다. 좁은 표본은 공짜로 유의해 보인다."""
        rows = [
            Forward(f"S{i:02d}", 0.0, {HORIZON: 0.0}, frozenset()) for i in range(30)
        ]
        study = new_study()
        picks = {seed: rows[: TOP_N] for seed in RANDOM_SEEDS}
        study.add_date(rows, {}, random_top_picks=picks)
        self.assertEqual(len(study.random_top_draws), len(RANDOM_SEEDS))
        for seed in RANDOM_SEEDS:
            self.assertIn((seed, HORIZON), study.random_top_draws)


def _payload(**changes) -> dict:
    """HARD 판정이 보는 최소 구조. 기본은 네 기준을 모두 통과하는 값이다."""
    base = {
        "up": 0.012,
        "contrast": 0.008,
        "random": {str(seed): 0.0 for seed in RANDOM_SEEDS},
        "positive_share": 0.75,
        "median": 0.006,
    }
    base.update(changes)
    return {
        "by_j": {
            str(J_PRIMARY): {
                "groups": {UP: {"mean": base["up"]}, DOWN: {"mean": 0.004}},
                "contrast": base["contrast"],
                "phases": {
                    "positive_share": base["positive_share"],
                    "median": base["median"],
                },
                "by_year": {},
                "leave_one_year_out": {},
            }
        },
        "random": {"contrast": base["random"]},
    }


def _ndx(contrast) -> dict:
    return {"by_j": {str(J_PRIMARY): {"contrast": contrast}}}


class HardVerdictTest(unittest.TestCase):
    """§13의 HARD A~D. **결과를 본 뒤 바꾸지 않는다.**"""

    def test_all_four_pass_gives_promotion(self):
        verdicts = hard_verdicts(_payload(), _ndx(0.005))
        for key in ("A", "B", "C", "D"):
            self.assertTrue(verdicts[key]["pass"], key)
        self.assertEqual(verdicts["verdict"], "PROMOTE_TO_PR16")

    def test_hard_a_needs_both_a_positive_up_edge_and_a_positive_contrast(self):
        """**UP의 edge 자체가 양수여야 한다.** DOWN보다 나은 것만으로는 부족하다."""
        self.assertFalse(hard_verdicts(_payload(up=-0.001), _ndx(0.005))["A"]["pass"])
        self.assertFalse(
            hard_verdicts(_payload(contrast=-0.001), _ndx(0.005))["A"]["pass"]
        )
        self.assertFalse(hard_verdicts(_payload(contrast=0.0), _ndx(0.005))["A"]["pass"])

    def test_hard_b_requires_eighteen_of_twenty(self):
        """17/20은 실패다. 문턱을 결과 보고 낮추지 않는다."""
        seventeen = {str(seed): (0.0 if seed < 17 else 1.0) for seed in RANDOM_SEEDS}
        eighteen = {str(seed): (0.0 if seed < 18 else 1.0) for seed in RANDOM_SEEDS}
        self.assertFalse(hard_verdicts(_payload(random=seventeen), _ndx(0.005))["B"]["pass"])
        self.assertTrue(hard_verdicts(_payload(random=eighteen), _ndx(0.005))["B"]["pass"])

    def test_hard_c_requires_both_share_and_median(self):
        self.assertFalse(
            hard_verdicts(_payload(positive_share=0.59), _ndx(0.005))["C"]["pass"]
        )
        self.assertTrue(
            hard_verdicts(_payload(positive_share=0.60), _ndx(0.005))["C"]["pass"]
        )
        self.assertFalse(hard_verdicts(_payload(median=-0.001), _ndx(0.005))["C"]["pass"])
        self.assertFalse(hard_verdicts(_payload(median=0.0), _ndx(0.005))["C"]["pass"])

    def test_hard_d_only_asks_for_direction(self):
        """NDX의 절대 크기가 ALL보다 클 필요는 없다."""
        self.assertTrue(hard_verdicts(_payload(), _ndx(0.0001))["D"]["pass"])
        self.assertFalse(hard_verdicts(_payload(), _ndx(-0.001))["D"]["pass"])
        self.assertFalse(hard_verdicts(_payload(), _ndx(0.0))["D"]["pass"])

    def test_a_missing_ndx_run_is_a_failure_not_a_pass(self):
        self.assertFalse(hard_verdicts(_payload(), None)["D"]["pass"])
        self.assertEqual(hard_verdicts(_payload(), None)["verdict"], "DO_NOT_PROMOTE")

    def test_any_single_failure_blocks_promotion(self):
        for payload, ndx in (
            (_payload(up=-0.001), _ndx(0.005)),
            (_payload(random={str(s): 1.0 for s in RANDOM_SEEDS}), _ndx(0.005)),
            (_payload(positive_share=0.1), _ndx(0.005)),
            (_payload(), _ndx(-0.005)),
        ):
            self.assertEqual(hard_verdicts(payload, ndx)["verdict"], "DO_NOT_PROMOTE")

    def test_the_verdict_is_one_of_exactly_two(self):
        for share in (0.0, 0.6, 1.0):
            for contrast in (-0.01, 0.0, 0.01):
                verdict = hard_verdicts(
                    _payload(positive_share=share, contrast=contrast), _ndx(contrast)
                )["verdict"]
                self.assertIn(verdict, ("PROMOTE_TO_PR16", "DO_NOT_PROMOTE"))


class ConcentrationLabelTest(unittest.TestCase):
    """§15. **이 label은 HARD A~D를 바꾸지 않는다.**"""

    def payload(self, contrast, loyo, yearly) -> dict:
        return {
            "by_j": {
                str(J_PRIMARY): {
                    "contrast": contrast,
                    "leave_one_year_out": loyo,
                    "by_year": {
                        year: {"contrast": value} for year, value in yearly.items()
                    },
                }
            }
        }

    def test_broad_when_every_year_removal_keeps_the_sign(self):
        label, _ = concentration_label(
            self.payload(
                0.008,
                {"2019": 0.007, "2020": 0.009, "2021": 0.008},
                {"2019": 0.006, "2020": 0.011, "2021": 0.007},
            )
        )
        self.assertEqual(label, "BROAD")

    def test_concentrated_when_one_year_flips_the_full_sample_sign(self):
        label, reason = concentration_label(
            self.payload(
                0.008,
                {"2019": 0.007, "2020": -0.002, "2021": 0.008},
                {"2019": 0.006, "2020": 0.050, "2021": 0.007},
            )
        )
        self.assertEqual(label, "CONCENTRATED")
        self.assertIn("2020", reason)

    def test_mixed_when_removals_are_stable_but_years_are_split(self):
        label, _ = concentration_label(
            self.payload(
                0.008,
                {"2019": 0.007, "2020": 0.009, "2021": 0.008, "2022": 0.008},
                {"2019": -0.006, "2020": 0.050, "2021": -0.007, "2022": 0.002},
            )
        )
        self.assertEqual(label, "MIXED")

    def test_an_empty_sample_never_claims_broad(self):
        label, _ = concentration_label(self.payload(None, {}, {}))
        self.assertEqual(label, "MIXED")

    def test_the_label_never_changes_the_hard_verdict(self):
        """label 함수와 판정 함수가 서로를 인자로 받지 않는다."""
        import inspect

        self.assertEqual(
            list(inspect.signature(hard_verdicts).parameters), ["primary", "ndx"]
        )
        self.assertEqual(
            list(inspect.signature(concentration_label).parameters), ["primary"]
        )


class ChecksumTest(unittest.TestCase):
    """§16. market group을 다시 합치면 기존 aggregate가 나와야 한다."""

    def test_pooling_two_groups_recovers_the_overall_mean(self):
        """합·수로 다시 평균 내는 산술이 맞는지 값으로 확인한다."""
        rows = [
            Forward(f"S{i:02d}", float(20 - i), {HORIZON: 0.01 * i}, frozenset())
            for i in range(20)
        ]
        up, down, total = new_study(), new_study(), new_study()
        for index in range(9):
            (up if index % 3 else down).add_date(rows, {})
            total.add_date(rows, {})
        key = (TOP_LABEL, HORIZON)
        pooled = (up.vs_universe[key].total + down.vs_universe[key].total) / (
            up.vs_universe[key].count + down.vs_universe[key].count
        )
        self.assertAlmostEqual(pooled, total.vs_universe[key].mean)

    def test_the_existing_pr12_numbers_are_the_reference(self):
        """기준값은 저장소의 PR #12 산출물에서 읽는다. 손으로 적지 않는다."""
        from selftest.market_condition_signal import existing_aggregate

        existing = existing_aggregate()
        if not existing:
            self.skipTest("signal-j-study/all.json이 없다")
        self.assertAlmostEqual(existing[J_CONTROL], 0.0048, places=3)
        self.assertAlmostEqual(existing[J_PRIMARY], 0.0103, places=3)


class LeaveOneYearOutTest(unittest.TestCase):
    def test_removing_a_year_uses_totals_not_means(self):
        """평균의 평균을 빼면 틀린다. 합과 수로 다시 나눠야 한다."""
        totals = {"2019": (0.30, 3), "2020": (0.80, 2), "2021": (0.10, 5)}
        grand_total = sum(t for t, _ in totals.values())
        grand_count = sum(c for _, c in totals.values())
        without_2020 = (grand_total - 0.80) / (grand_count - 2)
        self.assertAlmostEqual(without_2020, 0.05)
        self.assertNotAlmostEqual(without_2020, statistics.fmean([0.10, 0.02]))


class ScopeTest(unittest.TestCase):
    """**이 PR은 신호 층에 머무른다.**"""

    def source(self) -> str:
        return (TRADING_ROOT / "selftest" / "market_condition_signal.py").read_text()

    def test_no_new_core_is_registered(self):
        from core import CORES

        self.assertNotIn("market-condition", " ".join(CORES))
        self.assertEqual(
            sorted(name for name in CORES if "sma" in name.lower()), []
        )

    def test_the_runner_never_runs_a_portfolio_backtest(self):
        """**포트폴리오 실험이 아니다.** 백테스트를 부르면 scope violation이다."""
        source = self.source()
        self.assertNotIn("run_backtest", source)
        self.assertNotIn("BacktestConfig", source)
        self.assertNotIn("CoreDefinition", source)

    def test_the_runner_never_builds_an_entry_gate(self):
        """`SPY>SMA200이면 진입 차단`은 PR #16의 일이다."""
        source = self.source()
        self.assertNotIn("new_entries", source)
        self.assertNotIn("regime_mode", source)
        self.assertNotIn("REGIME_MODES", source)

    def test_the_runner_reuses_the_canonical_helpers(self):
        """새 RS 공식·새 SMA helper·새 forward 정의를 만들지 않았다."""
        source = self.source()
        for name in (
            "formation_strengths",
            "_eligible",
            "forward_return",
            "classify_market_regime",
            "research_calendar",
            "random_score",
        ):
            self.assertIn(name, source, name)
        # 정본을 다시 구현하지 않았다는 것은 정의가 없다는 것으로 확인한다.
        self.assertNotIn("def relative_strength", source)
        self.assertNotIn("def sma(", source)

    def test_the_split_does_not_parse_regime_label_strings(self):
        """**분류기를 바꾸면 문자열 파싱이 조용히 틀린다.** `above_sma200`을 읽는다."""
        source = self.source()
        self.assertIn("above_sma200", source)
        for label in ('"BULL"', '"CORRECTION"', '"RECOVERY"', '"BEAR"'):
            self.assertNotIn(label, source, label)


class RegimeAxisTest(unittest.TestCase):
    """엔진이 실제로 내는 `above_sma200`이 우리가 쓰는 축과 같은지 확인한다."""

    @classmethod
    def setUpClass(cls):
        import test_loop

        cls.connection, cls.dates = test_loop.build()
        cls.version = test_loop.VERSION

    @classmethod
    def tearDownClass(cls):
        cls.connection.close()

    def test_the_engine_exposes_the_axis_we_group_on(self):
        from backtest.data import PointInTimeSnapshot
        from selftest.market_condition_signal import PARAMETERS

        snapshot = PointInTimeSnapshot(self.connection, self.dates[-1], self.version)
        regime = classify_market_regime(snapshot, PARAMETERS)
        self.assertIsInstance(regime.above_sma200, bool)
        self.assertIn(market_group(regime.above_sma200), GROUPS)
        # 라벨과 축이 일관되는지 — 어긋나면 split이 엔진과 다른 것을 뜻한다.
        expected = UP if regime.trend in ("BULL", "CORRECTION") else DOWN
        self.assertEqual(market_group(regime.above_sma200), expected)


if __name__ == "__main__":
    unittest.main(verbosity=1)
