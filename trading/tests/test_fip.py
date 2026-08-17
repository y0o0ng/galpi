"""PR #20의 `information_discreteness` helper.

**가장 중요한 것은 셋이다.**

1. `FormationWindowTest` — ID가 보는 두 끝점이 `absolute_momentum(126,5)`와 **정확히
   같아야** 한다. 다르면 "RS와 같은 formation interval"이라는 주장이 거짓이 된다.
2. `SignFrequencyTest` — 크기가 아니라 **부호의 빈도**를 센다. 큰 jump 몇 번으로 오른
   종목과 작은 상승을 자주 쌓은 종목이 갈려야 한다.
3. `ZeroReturnTest` — 변화 없는 날을 분모에서 뺀다. 거래가 뜸한 종목이 매끄러워 보이면
   안 된다.
"""

from __future__ import annotations

import math
import sys
import unittest
from pathlib import Path

TRADING_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TRADING_ROOT))

from backtest.features import (  # noqa: E402
    FeatureUnavailable,
    absolute_momentum,
    information_discreteness,
    relative_strength,
)

LOOKBACK = 126
SKIP = 5


def series(daily: list[float], *, skip_tail: int = SKIP, start: float = 100.0) -> list[float]:
    """`daily` 비율 변화를 이어붙인 경로 뒤에 `skip_tail`개의 바를 더 붙인다.

    `absolute_momentum(values, lookback, skip)`이 보는 구간이 정확히 `daily`가 되도록
    길이를 맞춘다. 뒤에 붙는 바는 formation 밖이라 결과를 바꾸면 안 된다.
    """
    path = [start]
    for step in daily:
        path.append(path[-1] * (1 + step))
    # skip 구간은 formation 밖이다. 값이 무엇이든 상관없어야 한다.
    tail = [path[-1] * (1 + 0.01 * (index + 1)) for index in range(skip_tail)]
    return path + tail


def identity(values: list[float]) -> float:
    """`series()`가 만든 경로에서 formation 구간이 정확히 `daily`가 되는 호출.

    끝점이 index 0과 `len - SKIP - 1`이 되려면 `lookback = len - 1`이어야 한다.
    """
    return information_discreteness(values, len(values) - 1, SKIP)


class FormationWindowTest(unittest.TestCase):
    """**끝점이 `absolute_momentum`과 같아야 한다.**"""

    def test_the_skipped_tail_never_changes_the_result(self):
        """미래 `skip` 바를 바꿔도 ID가 변하면 안 된다."""
        daily = [0.01, -0.005, 0.02, -0.01, 0.015, 0.004, -0.002, 0.03]
        base = series(daily)
        moved = base[: len(base) - SKIP] + [
            base[len(base) - SKIP - 1] * factor for factor in (0.5, 3.0, 0.2, 5.0, 1.1)
        ]
        self.assertEqual(len(base), len(moved))
        self.assertAlmostEqual(identity(base), identity(moved))

    def test_it_uses_the_same_two_endpoints_as_absolute_momentum(self):
        """부호 개수가 `lookback − skip`개여야 두 끝점이 같은 것이다."""
        daily = [0.01] * 20
        values = series(daily)
        lookback = len(values) - 1
        # 창 안의 일별 수익률 개수는 `lookback − skip`이고 그것이 daily 개수여야 한다.
        self.assertEqual(lookback - SKIP, len(daily))
        self.assertAlmostEqual(identity(values), -1.0)
        self.assertGreater(absolute_momentum(values, lookback, SKIP), 0)

    def test_a_short_series_raises_the_shared_error(self):
        with self.assertRaises(FeatureUnavailable):
            information_discreteness([100.0, 101.0], LOOKBACK, SKIP)

    def test_it_shares_the_formation_interval_with_relative_strength(self):
        """RS와 같은 두 끝점을 쓴다 — 같은 momentum의 경로를 본다는 전제다."""
        daily = [0.004, -0.001, 0.006, 0.002, -0.003, 0.01, 0.001, -0.002]
        own = series(daily)
        market = series([0.001] * len(daily))
        lookback = len(own) - 1
        expected = absolute_momentum(own, lookback, SKIP) - absolute_momentum(
            market, lookback, SKIP
        )
        self.assertAlmostEqual(
            relative_strength(own, market, lookback, SKIP), expected
        )
        # ID는 그 자기 항의 경로만 본다.
        self.assertLess(identity(own), 0)


class SignFrequencyTest(unittest.TestCase):
    """**크기가 아니라 부호의 빈도.**"""

    def test_a_smooth_winner_is_minus_one(self):
        """`PRET > 0`이고 nonzero 움직임이 전부 양수면 완전한 continuous다."""
        values = series([0.003] * 30)
        lookback = len(values) - 1
        self.assertGreater(absolute_momentum(values, lookback, SKIP), 0)
        self.assertAlmostEqual(identity(values), -1.0)

    def test_a_smooth_loser_is_also_minus_one(self):
        """`sign(PRET)` 인자가 방향을 지운다. 꾸준한 하락도 continuous다."""
        values = series([-0.003] * 30)
        lookback = len(values) - 1
        self.assertLess(absolute_momentum(values, lookback, SKIP), 0)
        self.assertAlmostEqual(identity(values), -1.0)

    def test_a_discrete_winner_is_positive(self):
        """음의 날이 더 많은데 큰 점프 몇 번으로 누적이 양수인 경우."""
        daily = [-0.004] * 18 + [0.30, 0.25]
        values = series(daily)
        lookback = len(values) - 1
        self.assertGreater(absolute_momentum(values, lookback, SKIP), 0)
        got = identity(values)
        self.assertGreater(got, 0)
        # n_neg 18 · n_pos 2 → (18-2)/20 = 0.8
        self.assertAlmostEqual(got, 0.8)

    def test_a_discrete_loser_is_positive(self):
        """양의 날이 더 많은데 큰 급락 몇 번으로 누적이 음수인 경우."""
        daily = [0.004] * 18 + [-0.30, -0.25]
        values = series(daily)
        lookback = len(values) - 1
        self.assertLess(absolute_momentum(values, lookback, SKIP), 0)
        got = identity(values)
        self.assertGreater(got, 0)
        # sign(PRET) = -1 · (n_neg 2 − n_pos 18)/20 = -(-0.8) = +0.8
        self.assertAlmostEqual(got, 0.8)

    def test_the_magnitude_of_a_day_does_not_matter(self):
        """같은 부호 배열이면 크기를 바꿔도 ID가 같다."""
        small = series([0.001, -0.001, 0.002, 0.001, -0.002, 0.001])
        large = series([0.05, -0.02, 0.09, 0.01, -0.03, 0.04])
        self.assertAlmostEqual(identity(small), identity(large))

    def test_it_stays_inside_the_unit_interval(self):
        for daily in (
            [0.01] * 12,
            [-0.01] * 12,
            [0.01, -0.01] * 6,
            [-0.004] * 10 + [0.3, 0.25],
        ):
            with self.subTest(daily=daily[:3]):
                got = identity(series(daily))
                self.assertGreaterEqual(got, -1.0)
                self.assertLessEqual(got, 1.0)


class ZeroPretTest(unittest.TestCase):
    """`PRET == 0`이면 방향이 없다."""

    def test_a_flat_endpoint_pair_is_zero(self):
        """끝점이 같으면 경로가 어떻든 ID는 0이다."""
        values = series([0.02, -0.02 / 1.02])
        lookback = len(values) - 1
        self.assertAlmostEqual(absolute_momentum(values, lookback, SKIP), 0.0)
        self.assertAlmostEqual(identity(values), 0.0)

    def test_an_all_zero_path_is_zero(self):
        """움직인 날이 하나도 없으면 잴 것이 없다."""
        values = [100.0] * 30
        self.assertAlmostEqual(identity(values), 0.0)


class ZeroReturnTest(unittest.TestCase):
    """**변화 없는 날은 분모에서 뺀다.**"""

    def test_adding_flat_days_does_not_change_the_value(self):
        """같은 pos/neg 개수면 0인 날을 아무리 더해도 ID가 같아야 한다."""
        moves = [0.01, 0.01, -0.01, 0.01]
        base = identity(series(moves))
        for flat in (1, 3, 10):
            with self.subTest(flat=flat):
                padded = identity(series(moves + [0.0] * flat))
                self.assertAlmostEqual(padded, base)

    def test_the_denominator_excludes_flat_days(self):
        """pos 3 · neg 1 · zero 6 → (1−3)/4 = −0.5. 10으로 나누지 않는다."""
        values = series([0.01, 0.01, -0.01, 0.01] + [0.0] * 6)
        self.assertAlmostEqual(identity(values), -0.5)


class AdjustedPriceTest(unittest.TestCase):
    """**조정 종가로 계산한다.** 같은 경제적 경로면 분할이 껴도 값이 같아야 한다."""

    def test_a_uniform_rescale_leaves_the_value_unchanged(self):
        daily = [0.006, -0.002, 0.004, 0.009, -0.001, 0.003]
        values = series(daily)
        halved = [value / 2 for value in values]
        self.assertAlmostEqual(identity(values), identity(halved))

    def test_a_raw_split_jump_would_have_changed_it(self):
        """조정하지 않은 계열은 분할일이 큰 음의 날로 잡혀 값이 달라진다.

        이 테스트는 helper의 계약이 아니라 **왜 조정가를 요구하는지**를 값으로 남긴다.
        """
        daily = [0.006] * 8
        adjusted = series(daily)
        raw = list(adjusted)
        # 4번째 날에 2:1 분할이 일어난 raw 계열을 흉내낸다.
        for index in range(4, len(raw)):
            raw[index] /= 2
        self.assertAlmostEqual(identity(adjusted), -1.0)
        self.assertNotAlmostEqual(identity(raw), -1.0)


class DeterminismTest(unittest.TestCase):
    def test_the_same_input_gives_the_same_value(self):
        values = series([0.01, -0.02, 0.03, 0.001, -0.004, 0.02])
        self.assertEqual(identity(values), identity(list(values)))

    def test_it_reads_no_future_bar(self):
        """formation 뒤에 바를 더 붙여도 같은 lookback/skip이면 값이 같다."""
        daily = [0.01, -0.005, 0.02, 0.004]
        values = series(daily)
        before = information_discreteness(values, len(values) - 1, SKIP)
        # 뒤에 바를 더 붙이고 **두 끝점이 그대로이도록** lookback·skip을 같이 민다.
        extra = 2
        extended = values + [values[-1] * 1.5, values[-1] * 0.4]
        after = information_discreteness(
            extended, len(values) - 1 + extra, SKIP + extra
        )
        self.assertAlmostEqual(before, after)

    def test_the_value_is_finite_everywhere_it_is_defined(self):
        for daily in ([0.0] * 8, [0.01] * 8, [-0.01] * 8, [0.01, -0.01] * 4):
            with self.subTest(daily=daily[:2]):
                self.assertTrue(math.isfinite(identity(series(daily))))


if __name__ == "__main__":
    unittest.main()
