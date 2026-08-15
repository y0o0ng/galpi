"""대조군 분포. 기대값은 손으로 낸다.

가장 중요한 것은 `test_a_single_seed_has_no_spread`와 `test_beating_every_sample_is_the
_bar`다. 전자는 시드 하나를 "흩어짐 0"으로 적어 좁다는 뜻으로 읽히는 것을 막고, 후자는
"분포 밖"의 기준이 N/N이라는 것을 값으로 고정한다.
"""

from __future__ import annotations

import statistics
import sys
import unittest
from pathlib import Path

TRADING_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TRADING_ROOT))

from backtest.control import RandomStats  # noqa: E402


class RandomStatsTest(unittest.TestCase):
    def test_the_full_distribution_is_reported(self):
        stats = RandomStats.of([0.30, -0.10, 0.20])
        self.assertEqual(stats.count, 3)
        self.assertAlmostEqual(stats.minimum, -0.10)
        self.assertAlmostEqual(stats.median, 0.20)
        self.assertAlmostEqual(stats.maximum, 0.30)
        self.assertAlmostEqual(stats.mean, statistics.fmean([0.30, -0.10, 0.20]))
        self.assertAlmostEqual(stats.stdev, statistics.stdev([-0.10, 0.20, 0.30]))

    def test_the_values_come_back_sorted(self):
        """분포표가 최소·중앙·최대를 그대로 읽어 쓴다."""
        self.assertEqual(RandomStats.of([3.0, 1.0, 2.0]).values, (1.0, 2.0, 3.0))

    def test_no_seeds_is_not_a_distribution(self):
        self.assertIsNone(RandomStats.of([]))

    def test_a_single_seed_has_no_spread(self):
        """**시드 하나는 표본 하나다.** 0으로 적으면 좁다는 뜻이 되어버린다."""
        stats = RandomStats.of([0.42])
        self.assertEqual(stats.count, 1)
        self.assertIsNone(stats.stdev)
        self.assertAlmostEqual(stats.minimum, stats.maximum)

    def test_beating_every_sample_is_the_bar(self):
        stats = RandomStats.of([-0.20, 0.0, 0.20])
        self.assertEqual(stats.beaten_by(0.50), 3)
        self.assertEqual(stats.beaten_by(0.10), 2)
        self.assertEqual(stats.beaten_by(-0.90), 0)

    def test_a_tie_does_not_count_as_a_win(self):
        """같은 값이면 이긴 것이 아니다. 경계에서 유리하게 세지 않는다."""
        self.assertEqual(RandomStats.of([0.20, 0.20]).beaten_by(0.20), 0)

    def test_a_missing_actual_beats_nothing(self):
        """지표를 낼 수 없는 실행(거래 0건 등)이 조용히 0/N이 아니라 이긴 것으로 세이면 안 된다."""
        self.assertEqual(RandomStats.of([-0.20, 0.0]).beaten_by(None), 0)


if __name__ == "__main__":
    unittest.main()
