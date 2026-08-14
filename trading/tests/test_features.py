"""피처와 시장 상태. 기대값은 합성 경로에서 손으로 낸 닫힌 형태다.

여기서 가장 중요한 테스트는 개별 수식이 아니라 두 개다.

- `test_future_bars_do_not_change_past_features`: 미래 바를 넣어도 과거 피처가 바뀌지
  않는다. 룩어헤드가 있으면 이것부터 깨진다.
- `SplitTest`: 분할이 낀 구간에서도 ATR가 그날 실제 주가의 같은 비율로 남는다.
  조정가와 주문가를 섞어 쓰면 손절폭이 조용히 어긋난다.
"""

from __future__ import annotations

import statistics
import sqlite3
import sys
import unittest
from dataclasses import replace
from pathlib import Path

TRADING_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TRADING_ROOT))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import synthetic  # noqa: E402
from backtest import store  # noqa: E402
from backtest.data import PointInTimeSnapshot, load_bars_csv, register_source  # noqa: E402
from backtest.features import (  # noqa: E402
    STRATEGY_VERSION,
    TRADING_DAYS_PER_YEAR,
    FeatureUnavailable,
    compute_features,
    save_features,
)
from backtest.policy import DEFAULT_PARAMETERS as PARAMS  # noqa: E402
from backtest.regime import (  # noqa: E402
    TRENDS,
    classify_market_regime,
    classify_regime,
)

VERSION = "v1"
DAYS = 300
RANGE_PCT = synthetic.DEFAULT_RANGE_PCT
SPY_PRICE = 400.0


def build(*symbol_rows: list[dict[str, str]]) -> sqlite3.Connection:
    connection = store.connect_memory()
    register_source(connection, "synthetic", VERSION, "bars")
    load_bars_csv(connection, synthetic.to_csv(*symbol_rows), "synthetic", VERSION)
    return connection


def flat_spy(dates: list[str]) -> list[dict[str, str]]:
    return synthetic.rows("SPY", dates, synthetic.constant_closes(len(dates), SPY_PRICE))


class ConstantPriceTest(unittest.TestCase):
    """가격이 일정하면 모든 피처가 닫힌 형태로 나온다."""

    def setUp(self):
        self.dates = synthetic.sessions(DAYS)
        self.price = 100.0
        connection = build(
            flat_spy(self.dates),
            synthetic.rows("AAA", self.dates, synthetic.constant_closes(DAYS, self.price)),
        )
        snapshot = PointInTimeSnapshot(connection, self.dates[-1], VERSION)
        self.features = compute_features(snapshot, "AAA", PARAMS)

    def test_atr_is_twice_the_daily_range(self):
        # 고가·저가가 종가의 ±2%면 TR은 항상 고저폭 4%다.
        self.assertAlmostEqual(self.features.atr14, 2 * RANGE_PCT * self.price)

    def test_moving_averages_equal_the_price(self):
        self.assertAlmostEqual(self.features.sma50, self.price)
        self.assertAlmostEqual(self.features.sma200, self.price)

    def test_flat_price_has_no_volatility_and_no_trend(self):
        self.assertEqual(self.features.realized_vol20, 0.0)
        self.assertEqual(self.features.trend_quality60, 0.0)

    def test_relative_strength_against_a_flat_market_is_zero(self):
        self.assertAlmostEqual(self.features.rs63_5, 0.0)

    def test_dollar_volume_median_uses_order_prices(self):
        self.assertAlmostEqual(
            self.features.dollar_volume_median20, self.price * synthetic.DEFAULT_VOLUME
        )

    def test_bars_used_is_the_declared_window(self):
        self.assertEqual(self.features.bars_used, 252)


class GrowthPathTest(unittest.TestCase):
    """로그가격이 정확히 선형이면 R² = 1이므로 추세 품질은 연환산 기울기와 같다."""

    def setUp(self):
        self.dates = synthetic.sessions(DAYS)
        self.growth = 0.001
        self.market_growth = 0.0004
        self.closes = synthetic.growth_closes(DAYS, 50.0, self.growth)
        connection = build(
            synthetic.rows(
                "SPY", self.dates, synthetic.growth_closes(DAYS, SPY_PRICE, self.market_growth)
            ),
            synthetic.rows("AAA", self.dates, self.closes),
        )
        snapshot = PointInTimeSnapshot(connection, self.dates[-1], VERSION)
        self.features = compute_features(snapshot, "AAA", PARAMS)

    def test_trend_quality_is_the_annualized_slope(self):
        self.assertAlmostEqual(
            self.features.trend_quality60, self.growth * TRADING_DAYS_PER_YEAR, places=9
        )

    def test_relative_strength_skips_the_last_five_days(self):
        # ln(P_{t-5}/P_{t-63})은 58일치 성장이다. 시장 몫을 빼면 성장률 차이만 남는다.
        expected = 58 * (self.growth - self.market_growth)
        self.assertAlmostEqual(self.features.rs63_5, expected, places=9)

    def test_atr_tracks_the_average_price_of_its_window(self):
        expected = 2 * RANGE_PCT * statistics.fmean(self.closes[-14:])
        self.assertAlmostEqual(self.features.atr14, expected, places=9)

    def test_smooth_growth_has_no_realized_volatility(self):
        # 수익률이 매일 같으면 표준편차는 0이다. 남는 1e-11은 부동소수점 잔차다.
        self.assertAlmostEqual(self.features.realized_vol20, 0.0, places=9)


class LookaheadTest(unittest.TestCase):
    def test_future_bars_do_not_change_past_features(self):
        """미래 바가 들어와도 과거 결정의 입력은 그대로여야 한다."""
        dates = synthetic.sessions(DAYS)
        closes = synthetic.growth_closes(DAYS, 50.0, 0.001)
        as_of = dates[260]

        full = build(flat_spy(dates), synthetic.rows("AAA", dates, closes))
        truncated = build(
            flat_spy(dates[:261]), synthetic.rows("AAA", dates[:261], closes[:261])
        )

        with_future = compute_features(
            PointInTimeSnapshot(full, as_of, VERSION), "AAA", PARAMS
        )
        without_future = compute_features(
            PointInTimeSnapshot(truncated, as_of, VERSION), "AAA", PARAMS
        )
        self.assertEqual(with_future.feature_hash, without_future.feature_hash)
        self.assertEqual(with_future, without_future)


class SplitTest(unittest.TestCase):
    """2:1 분할. raw는 절반이 되고 adj는 이어진다."""

    def setUp(self):
        self.dates = synthetic.sessions(DAYS)
        self.split_index = 270
        raw = [200.0] * self.split_index + [100.0] * (DAYS - self.split_index)
        factors = [0.5] * self.split_index + [1.0] * (DAYS - self.split_index)
        self.connection = build(
            flat_spy(self.dates),
            synthetic.rows("AAA", self.dates, raw, adj_factors=factors),
        )

    def features_at(self, index: int):
        snapshot = PointInTimeSnapshot(self.connection, self.dates[index], VERSION)
        return snapshot, compute_features(snapshot, "AAA", PARAMS)

    def test_atr_stays_the_same_fraction_of_the_order_price(self):
        for index in (self.split_index - 1, self.split_index, DAYS - 1):
            snapshot, features = self.features_at(index)
            raw_close = snapshot.bars("AAA", 1)[0].raw_close
            self.assertAlmostEqual(
                features.atr14 / raw_close,
                2 * RANGE_PCT,
                places=9,
                msg=f"{self.dates[index]}의 ATR가 주가 대비 어긋납니다",
            )

    def test_adjusted_features_do_not_see_the_split(self):
        for index in (self.split_index - 1, self.split_index, DAYS - 1):
            _, features = self.features_at(index)
            self.assertAlmostEqual(features.sma200, 100.0, places=9)
            self.assertAlmostEqual(features.rs63_5, 0.0, places=9)
            self.assertEqual(features.realized_vol20, 0.0)


class UnavailableTest(unittest.TestCase):
    def test_short_history_is_refused_with_a_reason(self):
        dates = synthetic.sessions(260)
        connection = build(
            flat_spy(dates),
            synthetic.rows("AAA", dates[-251:], synthetic.constant_closes(251, 100.0)),
        )
        snapshot = PointInTimeSnapshot(connection, dates[-1], VERSION)
        with self.assertRaises(FeatureUnavailable) as caught:
            compute_features(snapshot, "AAA", PARAMS)
        self.assertEqual(caught.exception.reason, "SHORT_HISTORY")

    def test_missing_symbol_is_refused(self):
        dates = synthetic.sessions(DAYS)
        connection = build(flat_spy(dates))
        snapshot = PointInTimeSnapshot(connection, dates[-1], VERSION)
        with self.assertRaises(FeatureUnavailable) as caught:
            compute_features(snapshot, "AAA", PARAMS)
        self.assertEqual(caught.exception.reason, "NO_BARS")

    def test_stale_symbol_is_refused(self):
        """오늘 바가 없는 종목으로는 오늘 결정을 만들지 않는다(설계 14.6)."""
        dates = synthetic.sessions(DAYS)
        connection = build(
            flat_spy(dates),
            synthetic.rows("AAA", dates[:-1], synthetic.constant_closes(DAYS - 1, 100.0)),
        )
        snapshot = PointInTimeSnapshot(connection, dates[-1], VERSION)
        with self.assertRaises(FeatureUnavailable) as caught:
            compute_features(snapshot, "AAA", PARAMS)
        self.assertEqual(caught.exception.reason, "STALE")

    def test_calendar_gap_is_refused(self):
        """거래일이 어긋나면 t-63 같은 offset이 서로 다른 날을 가리킨다."""
        dates = synthetic.sessions(DAYS)
        holed = dates[:200] + dates[201:]
        connection = build(
            flat_spy(dates),
            synthetic.rows("AAA", holed, synthetic.constant_closes(len(holed), 100.0)),
        )
        snapshot = PointInTimeSnapshot(connection, dates[-1], VERSION)
        with self.assertRaises(FeatureUnavailable) as caught:
            compute_features(snapshot, "AAA", PARAMS)
        self.assertEqual(caught.exception.reason, "CALENDAR_MISMATCH")


class FeatureHashTest(unittest.TestCase):
    def setUp(self):
        self.dates = synthetic.sessions(DAYS)
        self.connection = build(
            flat_spy(self.dates),
            synthetic.rows("AAA", self.dates, synthetic.constant_closes(DAYS, 100.0)),
        )
        self.snapshot = PointInTimeSnapshot(self.connection, self.dates[-1], VERSION)

    def test_hash_is_stable_across_recomputation(self):
        first = compute_features(self.snapshot, "AAA", PARAMS)
        second = compute_features(
            PointInTimeSnapshot(self.connection, self.dates[-1], VERSION), "AAA", PARAMS
        )
        self.assertEqual(first.feature_hash, second.feature_hash)
        self.assertEqual(len(first.feature_hash), 64)

    def test_hash_changes_when_a_feature_changes(self):
        base = compute_features(self.snapshot, "AAA", PARAMS)
        other = build(
            flat_spy(self.dates),
            synthetic.rows("AAA", self.dates, synthetic.constant_closes(DAYS, 101.0)),
        )
        moved = compute_features(
            PointInTimeSnapshot(other, self.dates[-1], VERSION), "AAA", PARAMS
        )
        self.assertNotEqual(base.feature_hash, moved.feature_hash)

    def test_saved_row_carries_the_hash(self):
        features = compute_features(self.snapshot, "AAA", PARAMS)
        save_features(self.connection, VERSION, features)
        row = self.connection.execute("SELECT * FROM features_daily").fetchone()
        self.assertEqual(row["feature_hash"], features.feature_hash)
        self.assertEqual(row["strategy_version"], STRATEGY_VERSION)
        self.assertAlmostEqual(row["atr14"], features.atr14)


class RegimeTest(unittest.TestCase):
    """설계 7.3의 표를 그대로 확인한다."""

    def snapshot_for(self, closes: list[float]) -> PointInTimeSnapshot:
        dates = synthetic.sessions(len(closes))
        connection = build(synthetic.rows("SPY", dates, closes))
        return PointInTimeSnapshot(connection, dates[-1], VERSION)

    def rising(self) -> PointInTimeSnapshot:
        return self.snapshot_for(synthetic.growth_closes(DAYS, SPY_PRICE, 0.0004))

    def below_sma_for(self, days: int) -> PointInTimeSnapshot:
        """마지막 `days`일만 1% 낮은 경로.

        200일 평균은 100 - 0.005×days가 되므로 그 며칠만 평균 아래에 있고,
        그 전날은 정확히 평균과 같아 아래가 아니다.
        """
        return self.snapshot_for([100.0] * (DAYS - days) + [99.0] * days)

    def oscillating(self, amplitude: float) -> PointInTimeSnapshot:
        closes = [100.0] * (DAYS - 21)
        for i in range(21):
            closes.append(100.0 * (1 + amplitude) if i % 2 else 100.0)
        return self.snapshot_for(closes)

    def test_green_needs_all_three_conditions(self):
        regime = classify_regime(self.rising(), 0.0, PARAMS)
        self.assertEqual(regime.state, "GREEN")
        self.assertEqual(regime.max_exposure, 1.00)
        self.assertEqual(regime.new_entries, "allow")
        self.assertEqual(regime.reasons, ("ALL_CLEAR",))

    def test_drawdown_moves_green_to_yellow_then_red(self):
        rising = self.rising()
        yellow = classify_regime(rising, 0.06, PARAMS)
        self.assertEqual(yellow.state, "YELLOW")
        self.assertEqual(yellow.max_exposure, 0.50)
        self.assertEqual(yellow.new_entries, "top_only")
        self.assertIn("DD_GE_5", yellow.reasons)

        red = classify_regime(rising, 0.08, PARAMS)
        self.assertEqual(red.state, "RED")
        self.assertEqual(red.max_exposure, 0.25)
        self.assertEqual(red.new_entries, "blocked")
        self.assertIn("DD_GE_8", red.reasons)

    def test_two_days_below_sma200_is_yellow_and_three_is_red(self):
        two = classify_regime(self.below_sma_for(2), 0.0, PARAMS)
        self.assertEqual(two.state, "YELLOW")
        self.assertEqual(two.below_sma200_streak, 2)
        self.assertFalse(two.above_sma200)
        self.assertIn("SPY_BELOW_SMA200", two.reasons)

        three = classify_regime(self.below_sma_for(3), 0.0, PARAMS)
        self.assertEqual(three.state, "RED")
        self.assertEqual(three.below_sma200_streak, 3)
        self.assertIn("SPY_BELOW_SMA200_3D", three.reasons)

    def test_volatility_bands_split_yellow_and_red(self):
        yellow = classify_regime(self.oscillating(0.0198), 0.0, PARAMS)
        self.assertEqual(yellow.state, "YELLOW")
        self.assertIn("VOL_GE_30", yellow.reasons)
        self.assertTrue(0.30 <= yellow.realized_vol20 < 0.35)

        red = classify_regime(self.oscillating(0.023), 0.0, PARAMS)
        self.assertEqual(red.state, "RED")
        self.assertIn("VOL_GE_35", red.reasons)
        self.assertGreaterEqual(red.realized_vol20, 0.35)

    def test_negative_drawdown_is_a_caller_error(self):
        with self.assertRaises(ValueError):
            classify_regime(self.rising(), -0.01, PARAMS)


class MarketRegimeTest(RegimeTest):
    """`MARKET` 분류기. 시장만 보고 라벨을 붙인다.

    가장 중요한 것은 `test_the_account_cannot_reach_this_classifier`다. 계좌 낙폭이
    상태에 들어가면 손실 → 방어 → 진입 없음 → 자산 정지 → 낙폭 영구 고정의 고리가
    닫히고, 2026-08-10 기준선과 2026-08-14 첫 J/K 실행이 둘 다 그것으로 죽었다.
    """

    # 세 구간 계단 경로. 정확히 252바를 주면 SMA50은 마지막 50개, SMA200은 마지막 200개라
    # 두 평균을 손으로 낼 수 있다. `(먼 과거 152, 중간 90, 최근 10)`이다.
    TREND_PATHS = {
        # SMA50 122.0 · SMA200 110.5 · 종가 130 → 둘 다 위
        "BULL": (100.0, 120.0, 130.0),
        # SMA50 146.0 · SMA200 124.0 · 종가 130 → 50 아래, 200 위
        "CORRECTION": (100.0, 150.0, 130.0),
        # SMA50 104.0 · SMA200 126.0 · 종가 120 → 50 위, 200 아래
        "RECOVERY": (150.0, 100.0, 120.0),
        # SMA50 118.0 · SMA200 134.5 · 종가 110 → 둘 다 아래
        "BEAR": (150.0, 120.0, 110.0),
    }

    def trend_path(self, name: str) -> PointInTimeSnapshot:
        far, middle, recent = self.TREND_PATHS[name]
        return self.snapshot_for([far] * 152 + [middle] * 90 + [recent] * 10)

    def test_the_four_trend_states_are_the_two_moving_averages(self):
        for expected in self.TREND_PATHS:
            with self.subTest(trend=expected):
                regime = classify_market_regime(self.trend_path(expected), PARAMS)
                self.assertEqual(regime.trend, expected)
                self.assertTrue(regime.state.startswith(expected + "/"))

    def test_every_trend_label_is_reachable(self):
        """네 칸이 다 나와야 2×2다. 하나가 영영 비면 축이 하나뿐인 것과 같다."""
        labels = {
            classify_market_regime(self.trend_path(name), PARAMS).trend
            for name in self.TREND_PATHS
        }
        self.assertEqual(labels, set(TRENDS))

    def test_the_account_cannot_reach_this_classifier(self):
        """**낙폭을 인자로 받지 않는다.** 받지 않는 것이 요점이다."""
        import inspect

        signature = inspect.signature(classify_market_regime)
        self.assertNotIn("drawdown", signature.parameters)
        self.assertEqual(
            classify_market_regime(self.rising(), PARAMS).drawdown, 0.0
        )

    def test_nothing_is_blocked_or_capped(self):
        """레짐은 라벨이다. 막는 것은 레짐의 일이 아니다."""
        for snapshot in (self.rising(), self.trend_path("BEAR")):
            regime = classify_market_regime(snapshot, PARAMS)
            self.assertEqual(regime.new_entries, "allow")
            self.assertEqual(regime.max_exposure, 1.0)
            self.assertEqual(PARAMS.max_daily_entries(regime.new_entries), 2)

    def test_the_volatility_axis_uses_green_max_vol(self):
        calm = classify_market_regime(self.rising(), PARAMS)
        self.assertEqual(calm.volatility, "LOW_VOL")
        wild = classify_market_regime(self.oscillating(0.023), PARAMS)
        self.assertEqual(wild.volatility, "HIGH_VOL")
        self.assertGreaterEqual(wild.realized_vol20, PARAMS.green_max_vol)
        # 문턱을 올리면 같은 경로가 저변동이 된다. 이름이 아니라 값이 축을 정한다.
        lenient = replace(PARAMS, green_max_vol=1.0)
        self.assertEqual(
            classify_market_regime(self.oscillating(0.023), lenient).volatility,
            "LOW_VOL",
        )

    def test_the_core_classifier_is_untouched(self):
        """동결된 core-1은 옛 분류기를 그대로 쓴다. 여기가 바뀌면 서명 없이 기준선이 바뀐다."""
        regime = classify_regime(self.rising(), 0.08, PARAMS)
        self.assertEqual(regime.state, "RED")
        self.assertEqual(regime.new_entries, "blocked")

    def test_short_market_history_is_refused(self):
        short = self.snapshot_for([100.0] * 201)
        with self.assertRaises(FeatureUnavailable) as caught:
            classify_regime(short, 0.0, PARAMS)
        self.assertEqual(caught.exception.reason, "SHORT_HISTORY")


if __name__ == "__main__":
    unittest.main()
