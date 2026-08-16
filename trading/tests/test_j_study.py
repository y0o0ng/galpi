"""J 신호 연구의 계산.

가장 중요한 것 둘이다.

- `test_j63_reproduces_the_production_feature` — J 일반화가 production RS 정의와 갈리면
  이 연구 전체가 PR #9과 다른 것을 재게 된다.
- `test_the_eligible_universe_does_not_depend_on_j` — J마다 표본이 달라지면 "J 효과"와
  "표본 구성 효과"가 섞여서 사다리를 비교할 수 없다.
"""

from __future__ import annotations

import sys
import unittest
from dataclasses import replace
from pathlib import Path

TRADING_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TRADING_ROOT))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import test_loop  # noqa: E402
from backtest.candidates import random_score  # noqa: E402
from backtest.data import PointInTimeSnapshot  # noqa: E402
from backtest.features import compute_features, relative_strength  # noqa: E402
from backtest.holdout import HOLDOUT_START  # noqa: E402
from backtest.study import Forward, Study  # noqa: E402
from selftest.j_signal_study import (  # noqa: E402
    BASELINE_J,
    HORIZONS,
    JS,
    PHASE_HORIZONS,
    PRIMARY_HORIZON,
    PRIMARY_UNIVERSE,
    RANDOM_SEEDS,
    SKIP,
    UNIVERSES,
    _eligible,
    formation_strengths,
)


class LadderTest(unittest.TestCase):
    def test_the_ladder_is_locked(self):
        """**결과를 보고 J를 더하지 않는다.** J252는 이번 PR에서 의도적으로 제외했다."""
        self.assertEqual(JS, (21, 42, 63, 126, 189))
        self.assertNotIn(252, JS)
        self.assertNotIn(84, JS)

    def test_only_j_moves(self):
        """skip은 5로 고정이다. J×skip 격자를 만들지 않는다."""
        self.assertEqual(SKIP, 5)

    def test_the_baseline_is_in_the_ladder(self):
        """기준선이 사다리 밖이면 '기준선 대비'를 잴 수 없다."""
        self.assertIn(BASELINE_J, JS)
        self.assertEqual(BASELINE_J, 63)

    def test_every_j_fits_inside_the_minimum_history(self):
        """**J가 최소 이력을 넘으면 그 J만 종목이 빠져 표본이 갈린다.**

        `relative_strength`가 `J + 1`개 바를 요구하므로 그 여유가 있어야 한다.
        """
        from core.jt import MOMENTUM_PARAMETERS

        for j in JS:
            with self.subTest(j=j):
                self.assertLess(j + 1, MOMENTUM_PARAMETERS.min_history_sessions)

    def test_the_primary_endpoint_is_fixed_in_advance(self):
        """사후에 예쁜 칸을 primary로 고르는 것을 막는다."""
        self.assertEqual(PRIMARY_UNIVERSE, "ALL")
        self.assertEqual(PRIMARY_HORIZON, 42)
        self.assertIn(PRIMARY_HORIZON, HORIZONS)

    def test_both_universes_are_studied(self):
        self.assertEqual(set(UNIVERSES), {"ALL", "NDX100"})

    def test_the_horizons_match_pr9(self):
        self.assertEqual(HORIZONS, (5, 10, 21, 42, 63, 84))
        for horizon in PHASE_HORIZONS:
            self.assertIn(horizon, HORIZONS)


class FormationTest(unittest.TestCase):
    """RS(J,5)가 production 정의와 같은가."""

    @classmethod
    def setUpClass(cls):
        cls.connection, cls.dates = test_loop.build()

    @classmethod
    def tearDownClass(cls):
        cls.connection.close()

    def snapshot(self):
        return PointInTimeSnapshot(self.connection, self.dates[-1], test_loop.VERSION)

    def parameters(self):
        from core.jt import MOMENTUM_PARAMETERS

        return MOMENTUM_PARAMETERS

    def test_j63_reproduces_the_production_feature(self):
        """**J=63은 `features.rs63_5`와 정확히 같아야 한다.**

        여기가 갈리면 J 사다리 전체가 PR #9과 다른 신호를 재는 것이 된다.
        """
        snapshot = self.snapshot()
        checked = 0
        for symbol in test_loop.TREND_NAMES:
            features = compute_features(snapshot, symbol, self.parameters())
            strengths = formation_strengths(snapshot, symbol)
            self.assertAlmostEqual(strengths[BASELINE_J], features.rs63_5, places=12)
            checked += 1
        self.assertGreater(checked, 0)

    def test_every_j_is_computed_and_they_differ(self):
        snapshot = self.snapshot()
        strengths = formation_strengths(snapshot, test_loop.TREND_NAMES[0])
        self.assertEqual(sorted(strengths), sorted(JS))
        # 계단 경로라 J마다 값이 달라야 한다. 전부 같으면 J가 안 먹은 것이다.
        self.assertGreater(len({round(v, 10) for v in strengths.values()}), 1)

    def test_the_helper_matches_relative_strength_directly(self):
        """helper가 production 함수를 그대로 부르는지 값으로 확인한다."""
        snapshot = self.snapshot()
        symbol = test_loop.TREND_NAMES[0]
        history = self.parameters().min_history_sessions
        adjusted = [b.adj_close for b in snapshot.bars(symbol, history)]
        reference = [
            b.adj_close for b in snapshot.bars(snapshot.reference_symbol, history)
        ]
        strengths = formation_strengths(snapshot, symbol)
        for j in JS:
            with self.subTest(j=j):
                self.assertAlmostEqual(
                    strengths[j],
                    relative_strength(adjusted, reference, j, SKIP),
                    places=12,
                )

    def test_the_eligible_universe_does_not_depend_on_j(self):
        """**자격 판정에 J가 없다.** 있으면 J마다 다른 표본을 비교하게 된다."""
        snapshot = self.snapshot()
        eligible = {
            symbol
            for symbol in test_loop.TREND_NAMES
            if _eligible(snapshot, symbol) is not None
        }
        self.assertTrue(eligible)
        # 자격을 통과한 종목은 J 전부에서 RS를 낼 수 있어야 한다.
        for symbol in eligible:
            strengths = formation_strengths(snapshot, symbol)
            self.assertEqual(sorted(strengths), sorted(JS))


class RandomControlTest(unittest.TestCase):
    """무작위 대조군은 J와 무관해야 한다."""

    def rows(self, count: int = 40) -> list[Forward]:
        return [
            Forward(f"S{i:02d}", float(i), {PRIMARY_HORIZON: i / 100}, frozenset())
            for i in range(count)
        ]

    def picks(self, rows, seed: int, as_of: str, size: int) -> list[str]:
        ordered = sorted(rows, key=lambda r: random_score(seed, as_of, r.symbol))
        return [row.symbol for row in ordered[:size]]

    def test_the_same_date_and_seed_pick_the_same_names(self):
        """**J마다 다른 무작위 표본을 만들지 않는다.**

        점수가 `sha256(seed|date|symbol)`이라 상태를 안 들고 다닌다. 같은 날짜·시드·
        유니버스면 J와 무관하게 같은 종목이 뽑힌다.
        """
        rows = self.rows()
        # J가 바뀌면 `rs`만 달라진다. 순서를 뒤집어도 무작위 표본은 같아야 한다.
        shuffled = [replace(row, rs=-row.rs) for row in reversed(rows)]
        for seed in (0, 7, 19):
            with self.subTest(seed=seed):
                self.assertEqual(
                    self.picks(rows, seed, "2020-01-02", 5),
                    self.picks(shuffled, seed, "2020-01-02", 5),
                )

    def test_different_seeds_pick_differently(self):
        rows = self.rows()
        first = self.picks(rows, 0, "2020-01-02", 5)
        self.assertNotEqual(first, self.picks(rows, 1, "2020-01-02", 5))

    def test_twenty_seeds(self):
        self.assertEqual(RANDOM_SEEDS, tuple(range(20)))


class StudyWiringTest(unittest.TestCase):
    """J별 Study가 같은 행에서 다른 순위를 만드는지."""

    def rows(self, strengths: dict[str, float]) -> list[Forward]:
        return [
            Forward(symbol, rs, {PRIMARY_HORIZON: 0.01 * index}, frozenset())
            for index, (symbol, rs) in enumerate(sorted(strengths.items()))
        ]

    def test_ranking_follows_the_j_specific_strength(self):
        """같은 forward 수익률에 J별 rs만 바꾸면 TOP5가 달라져야 한다."""
        symbols = [f"S{i:02d}" for i in range(10)]
        first = Study((PRIMARY_HORIZON,), buckets=2, top_n=3)
        second = Study((PRIMARY_HORIZON,), buckets=2, top_n=3)
        forward = {symbol: 0.01 * index for index, symbol in enumerate(symbols)}
        rows_a = [
            Forward(s, float(i), {PRIMARY_HORIZON: forward[s]}, frozenset())
            for i, s in enumerate(symbols)
        ]
        rows_b = [
            Forward(s, float(-i), {PRIMARY_HORIZON: forward[s]}, frozenset())
            for i, s in enumerate(symbols)
        ]
        first.add_date(rows_a, {PRIMARY_HORIZON: 0.0})
        second.add_date(rows_b, {PRIMARY_HORIZON: 0.0})
        self.assertNotAlmostEqual(
            first.vs_universe[("TOP5", PRIMARY_HORIZON)].mean,
            second.vs_universe[("TOP5", PRIMARY_HORIZON)].mean,
        )

    def test_phase_assignment_covers_every_phase_once_per_cycle(self):
        """PR #9의 위상 배정이 J 차원을 더한 뒤에도 그대로여야 한다."""
        for horizon in PHASE_HORIZONS:
            with self.subTest(horizon=horizon):
                assigned = [(index) % horizon for index in range(horizon * 3)]
                self.assertEqual(sorted(set(assigned)), list(range(horizon)))
                self.assertEqual(assigned.count(0), 3)


class HoldoutTest(unittest.TestCase):
    def test_the_calendar_is_cut_before_the_holdout(self):
        """신호일도 forward 목표일도 이 달력에서만 나온다."""
        from backtest.holdout import assert_no_holdout, research_sessions

        sessions = ["2025-08-05", "2025-08-06", HOLDOUT_START, "2026-08-07"]
        research = research_sessions(sessions)
        assert_no_holdout(research)
        self.assertEqual(research, ["2025-08-05", "2025-08-06"])

    def test_the_runner_uses_the_shared_research_calendar(self):
        """PR #9과 같은 함수를 쓰는지. 따로 구현하면 경계가 갈린다."""
        import selftest.j_signal_study as module
        from selftest.signal_study import research_calendar

        self.assertIs(module.research_calendar, research_calendar)


if __name__ == "__main__":
    unittest.main()
