"""신호 연구의 계산. 기대값은 손으로 낸다.

가장 중요한 테스트는 `test_the_universe_mean_is_the_same_day` 와
`test_a_random_draw_has_zero_expected_excess`다. 전자는 "같은 날 같은 집합에서 골라낸
값"이라는 질문을 지키고, 후자는 무작위 벤치마크가 유니버스 평균과 같은 것을 재고 있음을
값으로 확인한다 — 둘이 다르면 벤치마크 하나가 틀린 것이다.
"""

from __future__ import annotations

import statistics
import sys
import unittest
from pathlib import Path

TRADING_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TRADING_ROOT))

from backtest.study import (  # noqa: E402
    ALL_LABEL,
    TOP_LABEL,
    Forward,
    Study,
    deciles,
    random_spread,
)


def row(symbol: str, rs: float, value: float, stale: bool = False) -> Forward:
    return Forward(symbol, rs, {21: value}, frozenset({21} if stale else ()))


class DecileTest(unittest.TestCase):
    def test_the_first_bucket_is_the_top(self):
        assigned = deciles([f"S{i:02d}" for i in range(100)], 10)
        self.assertEqual(assigned["S00"], 1)
        self.assertEqual(assigned["S99"], 10)
        self.assertEqual(sum(1 for v in assigned.values() if v == 1), 10)

    def test_the_remainder_goes_to_the_front(self):
        """103종목 10칸이면 앞 세 칸이 11개다. 뒤로 몰면 최상위 칸이 커진다."""
        assigned = deciles([f"S{i:02d}" for i in range(103)], 10)
        sizes = [sum(1 for v in assigned.values() if v == b) for b in range(1, 11)]
        self.assertEqual(sizes, [11, 11, 11, 10, 10, 10, 10, 10, 10, 10])

    def test_fewer_symbols_than_buckets_still_works(self):
        assigned = deciles(["A", "B"], 10)
        self.assertEqual(assigned, {"A": 1, "B": 2})

    def test_zero_buckets_is_a_caller_error(self):
        with self.assertRaises(ValueError):
            deciles(["A"], 0)


class StudyTest(unittest.TestCase):
    def test_buckets_follow_the_signal_not_the_return(self):
        """RS가 높은 쪽이 D1이다. 수익률로 정렬하면 그날의 답을 보고 고르는 것이 된다."""
        study = Study((21,), buckets=2, top_n=1)
        study.add_date(
            [row("HI", 2.0, -0.10), row("LO", 1.0, +0.30)], {21: 0.0}
        )
        self.assertAlmostEqual(study.raw[("D1", 21)].mean, -0.10)
        self.assertAlmostEqual(study.raw[("D2", 21)].mean, +0.30)
        self.assertAlmostEqual(study.raw[(TOP_LABEL, 21)].mean, -0.10)

    def test_the_universe_mean_is_the_same_day(self):
        """다른 날 평균과 섞으면 "같은 날 같은 집합에서 골라낸 값"이 아니게 된다."""
        study = Study((21,), buckets=2, top_n=1)
        # 첫날 평균 0.10, 둘째 날 평균 1.00. D1은 각각 +0.10, +1.00 초과다.
        study.add_date([row("A", 2.0, 0.20), row("B", 1.0, 0.00)], {21: 0.0})
        study.add_date([row("A", 2.0, 2.00), row("B", 1.0, 0.00)], {21: 0.0})
        self.assertAlmostEqual(study.vs_universe[("D1", 21)].mean, (0.10 + 1.00) / 2)

    def test_the_three_benchmarks_measure_different_things(self):
        study = Study((21,), buckets=2, top_n=1)
        study.add_date([row("A", 2.0, 0.20), row("B", 1.0, 0.10)], {21: 0.05})
        self.assertAlmostEqual(study.raw[("D1", 21)].mean, 0.20)
        self.assertAlmostEqual(study.vs_market[("D1", 21)].mean, 0.15)
        self.assertAlmostEqual(study.vs_universe[("D1", 21)].mean, 0.05)

    def test_a_random_draw_has_zero_expected_excess(self):
        """**무작위 선택의 기댓값이 곧 유니버스 평균이다.**

        전체를 뽑으면 초과수익이 정확히 0이어야 한다. 아니면 두 벤치마크 중 하나가
        다른 것을 재고 있다.
        """
        study = Study((21,), buckets=2, top_n=1)
        rows = [row("A", 2.0, 0.30), row("B", 1.0, -0.10)]
        study.add_date(rows, {21: 0.0}, random_picks={0: rows})
        self.assertAlmostEqual(study.random_draws[(0, 21)].mean, 0.0)

    def test_the_random_spread_reports_the_extremes(self):
        study = Study((21,), buckets=2, top_n=1)
        rows = [row("A", 2.0, 0.30), row("B", 1.0, -0.10)]
        study.add_date(
            rows, {21: 0.0}, random_picks={0: [rows[0]], 1: [rows[1]], 2: rows}
        )
        low, mid, high = random_spread(study, 21)
        self.assertAlmostEqual(low, -0.20)
        self.assertAlmostEqual(mid, 0.0)
        self.assertAlmostEqual(high, 0.20)
        self.assertIsNone(random_spread(study, 84))

    def test_stale_forward_prices_are_counted_not_dropped(self):
        """폐지 종목을 빼면 그것이 생존편향이다. 세되 버리지 않는다."""
        study = Study((21,), buckets=2, top_n=1)
        study.add_date(
            [row("A", 2.0, -0.90, stale=True), row("B", 1.0, 0.10)], {21: 0.0}
        )
        self.assertEqual(study.stale_counts[21], 1)
        self.assertAlmostEqual(study.raw[(ALL_LABEL, 21)].mean, statistics.fmean([-0.90, 0.10]))

    def test_a_missing_horizon_does_not_shrink_the_others(self):
        """구간 끝에서는 긴 지평만 잴 수 없다. 짧은 지평의 표본이 같이 줄면 안 된다."""
        study = Study((21, 84), buckets=1, top_n=1)
        study.add_date([Forward("A", 1.0, {21: 0.05}, frozenset())], {21: 0.0})
        self.assertEqual(study.raw[("D1", 21)].count, 1)
        self.assertNotIn(("D1", 84), study.raw)

    def test_an_empty_date_is_ignored(self):
        study = Study((21,))
        study.add_date([], {21: 0.0})
        self.assertEqual(study.dates, 0)


if __name__ == "__main__":
    unittest.main()
