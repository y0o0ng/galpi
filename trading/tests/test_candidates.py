"""후보 랭킹. 설계 7.2 유니버스와 7.4 점수·진입 게이트.

여기서 확인하려는 것은 순위 자체보다 세 가지다.

- z-score의 모집단이 게이트 통과분이 아니라 유니버스 전체다(`score_population`).
- 걸러진 종목이 조용히 사라지지 않고 사유와 함께 남는다(21.2 편향 모니터링).
- 같은 입력에 같은 순서가 나온다(3.1).
"""

from __future__ import annotations

import sqlite3
import sys
import unittest
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path

TRADING_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TRADING_ROOT))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import synthetic  # noqa: E402
from backtest import store  # noqa: E402
from backtest.candidates import (  # noqa: E402
    MAX_CANDIDATES,
    MIN_SCORE_POPULATION,
    SCORE_WEIGHT_RS,
    SCORE_WEIGHT_TREND,
    next_weekday,
    rank_candidates,
    save_signals,
    weekdays_between,
    zscores,
)
from backtest.data import (  # noqa: E402
    PointInTimeSnapshot,
    load_bars_csv,
    load_earnings_csv,
    load_universe_csv,
    register_source,
)
from backtest.features import STRATEGY_VERSION  # noqa: E402
from backtest.regime import classify_regime  # noqa: E402

VERSION = "v1"
DAYS = 300
TAIL = 20  # 실적일을 지정할 미래 날짜
SPY_PRICE = 400.0
FLAT_COUNT = 30
TREND_GROWTHS = (0.010, 0.009, 0.008, 0.007, 0.0065, 0.006)
TREND_NAMES = ("TRENDA", "TRENDB", "TRENDC", "TRENDD", "TRENDE", "TRENDF")
# 고저폭이 0.5%면 일간 0.5% 넘게 오르는 종목만 직전 고가를 넘는다.
TREND_RANGE = 0.005


@dataclass
class Spec:
    symbol: str
    closes: list[float]
    range_pct: float = synthetic.DEFAULT_RANGE_PCT
    volume: float = synthetic.DEFAULT_VOLUME


@dataclass
class Fixture:
    connection: sqlite3.Connection
    dates: list[str] = field(default_factory=list)

    @property
    def as_of(self) -> str:
        return self.dates[DAYS - 1]

    def snapshot(self) -> PointInTimeSnapshot:
        return PointInTimeSnapshot(self.connection, self.as_of, VERSION)

    def ranking(self, drawdown: float = 0.0, **kwargs):
        snapshot = self.snapshot()
        regime = classify_regime(snapshot, drawdown=drawdown)
        kwargs.setdefault("require_earnings_calendar", False)
        return rank_candidates(snapshot, regime, **kwargs)


def build(specs: list[Spec], earnings_csv: str | None = None) -> Fixture:
    dates = synthetic.sessions(DAYS + TAIL)
    bar_dates = dates[:DAYS]
    connection = store.connect_memory()
    register_source(connection, "synthetic", VERSION, "bars")
    register_source(connection, "synthetic", VERSION, "universe")

    groups = [
        synthetic.rows("SPY", bar_dates, synthetic.constant_closes(DAYS, SPY_PRICE))
    ]
    for spec in specs:
        groups.append(
            synthetic.rows(
                spec.symbol,
                bar_dates,
                spec.closes,
                range_pct=spec.range_pct,
                volume=spec.volume,
            )
        )
    load_bars_csv(connection, synthetic.to_csv(*groups), "synthetic", VERSION)

    membership = "symbol,index_name,valid_from,valid_to\n" + "".join(
        f"{spec.symbol},SP500,{bar_dates[0]},\n" for spec in specs
    )
    load_universe_csv(connection, membership, "synthetic", VERSION)

    if earnings_csv is not None:
        register_source(connection, "synthetic", VERSION, "earnings")
        load_earnings_csv(connection, earnings_csv, "synthetic", VERSION)

    return Fixture(connection=connection, dates=dates)


def flat_specs(count: int = FLAT_COUNT) -> list[Spec]:
    return [
        Spec(f"FLAT{index:02d}", synthetic.constant_closes(DAYS, 100.0))
        for index in range(count)
    ]


def trend_specs() -> list[Spec]:
    return [
        Spec(name, synthetic.growth_closes(DAYS, 50.0, growth), range_pct=TREND_RANGE)
        for name, growth in zip(TREND_NAMES, TREND_GROWTHS)
    ]


def full_universe() -> list[Spec]:
    """배경 30종목 + 추세 6종목 + 필터에 걸릴 4종목."""
    stalled = synthetic.growth_closes(DAYS - 5, 50.0, 0.008)
    stalled += [stalled[-1]] * 5
    return [
        *flat_specs(),
        *trend_specs(),
        Spec("CHEAP", synthetic.constant_closes(DAYS, 9.0), volume=10_000_000.0),
        Spec("THIN", synthetic.constant_closes(DAYS, 100.0), volume=100_000.0),
        Spec("DECLINE", synthetic.growth_closes(DAYS, 200.0, -0.001)),
        Spec("STALLED", stalled, range_pct=TREND_RANGE),
    ]


class ZScoreTest(unittest.TestCase):
    def test_mean_is_zero_and_stdev_is_one(self):
        values = {"A": 1.0, "B": 2.0, "C": 3.0, "D": 10.0}
        z = zscores(values)
        self.assertAlmostEqual(sum(z.values()), 0.0, places=9)
        self.assertAlmostEqual(
            (sum(value * value for value in z.values()) / (len(z) - 1)) ** 0.5,
            1.0,
            places=9,
        )
        self.assertLess(z["A"], z["B"])
        self.assertLess(z["C"], z["D"])

    def test_identical_values_are_all_zero(self):
        self.assertEqual(zscores({"A": 5.0, "B": 5.0}), {"A": 0.0, "B": 0.0})

    def test_one_symbol_is_a_caller_error(self):
        with self.assertRaises(ValueError):
            zscores({"A": 1.0})


class RankingTest(unittest.TestCase):
    def setUp(self):
        self.fixture = build(full_universe())
        self.ranking = self.fixture.ranking()

    def test_candidates_are_the_strongest_trends_in_order(self):
        self.assertEqual(
            [candidate.symbol for candidate in self.ranking.candidates],
            list(TREND_NAMES[:MAX_CANDIDATES]),
        )
        self.assertEqual(
            [candidate.rank for candidate in self.ranking.candidates],
            list(range(1, MAX_CANDIDATES + 1)),
        )

    def test_scores_descend(self):
        scores = [candidate.score for candidate in self.ranking.candidates]
        self.assertEqual(scores, sorted(scores, reverse=True))

    def test_score_is_the_weighted_sum_of_the_two_zscores(self):
        for candidate in self.ranking.candidates:
            self.assertAlmostEqual(
                candidate.score,
                SCORE_WEIGHT_RS * candidate.z_rs63_5
                + SCORE_WEIGHT_TREND * candidate.z_trend_quality60,
                places=12,
            )

    def test_population_is_the_eligible_universe_not_the_gate_survivors(self):
        """게이트를 통과한 5~6개가 아니라 7.2를 통과한 38개에서 z를 낸다."""
        self.assertEqual(self.ranking.score_population, FLAT_COUNT + len(TREND_NAMES) + 2)
        self.assertGreater(self.ranking.score_population, len(self.ranking.candidates))
        for candidate in self.ranking.candidates:
            self.assertGreater(candidate.z_rs63_5, 0.0)

    def test_sixth_trend_is_recorded_as_below_top_n(self):
        skips = {skip.symbol: skip.reason for skip in self.ranking.skipped}
        self.assertEqual(skips[TREND_NAMES[MAX_CANDIDATES]], "BELOW_TOP_N")

    def test_every_filtered_symbol_keeps_its_reason(self):
        skips = {skip.symbol: skip.reason for skip in self.ranking.skipped}
        self.assertEqual(skips["CHEAP"], "PRICE_BELOW_MIN")
        self.assertEqual(skips["THIN"], "LIQUIDITY_BELOW_MIN")
        self.assertEqual(skips["DECLINE"], "SMA_NOT_ALIGNED")
        self.assertEqual(skips["STALLED"], "NO_BREAKOUT")
        self.assertEqual(skips["FLAT00"], "SMA_NOT_ALIGNED")
        self.assertEqual(
            self.ranking.skip_counts()["SMA_NOT_ALIGNED"], FLAT_COUNT + 1
        )

    def test_reference_close_and_atr_are_order_prices(self):
        candidate = self.ranking.candidates[0]
        bar = self.fixture.snapshot().bars(candidate.symbol, 1)[0]
        self.assertAlmostEqual(candidate.reference_close, bar.raw_close)
        self.assertAlmostEqual(candidate.atr14, candidate.features.atr14)
        self.assertGreater(candidate.atr14, 0.0)

    def test_ranking_is_deterministic(self):
        again = self.fixture.ranking()
        self.assertEqual(
            [(c.symbol, c.score) for c in self.ranking.candidates],
            [(c.symbol, c.score) for c in again.candidates],
        )
        self.assertEqual(self.ranking.skipped, again.skipped)


class RegimeInteractionTest(unittest.TestCase):
    def setUp(self):
        self.fixture = build(full_universe())

    def test_green_allows_two_entries(self):
        ranking = self.fixture.ranking(drawdown=0.0)
        self.assertEqual(ranking.regime_state, "GREEN")
        self.assertEqual(ranking.max_new_entries, 2)

    def test_yellow_keeps_the_list_but_allows_one_entry(self):
        """YELLOW의 '상위 후보만'은 목록을 줄이는 게 아니라 진입 상한을 줄인다."""
        ranking = self.fixture.ranking(drawdown=0.06)
        self.assertEqual(ranking.regime_state, "YELLOW")
        self.assertEqual(ranking.max_new_entries, 1)
        self.assertEqual(len(ranking.candidates), MAX_CANDIDATES)

    def test_red_makes_no_candidates_at_all(self):
        ranking = self.fixture.ranking(drawdown=0.10)
        self.assertEqual(ranking.regime_state, "RED")
        self.assertEqual(ranking.halt_reason, "REGIME_RED")
        self.assertEqual(ranking.max_new_entries, 0)
        self.assertEqual(ranking.candidates, ())


class PopulationGuardTest(unittest.TestCase):
    def test_a_collapsed_universe_halts_instead_of_ranking(self):
        """모집단이 무너지면 횡단면이 아니라 데이터 사고다(18장 DATA_QA_FAILED)."""
        fixture = build(trend_specs())
        ranking = fixture.ranking()
        self.assertEqual(ranking.halt_reason, "SCORE_POPULATION_TOO_SMALL")
        self.assertEqual(ranking.candidates, ())
        self.assertEqual(ranking.max_new_entries, 0)
        self.assertLess(ranking.score_population, MIN_SCORE_POPULATION)

    def test_lower_threshold_lets_focused_tests_run(self):
        fixture = build(trend_specs())
        ranking = fixture.ranking(min_population=2)
        self.assertIsNone(ranking.halt_reason)
        self.assertEqual(len(ranking.candidates), MAX_CANDIDATES)


class EarningsGateTest(unittest.TestCase):
    def make(self, event_offset: int | None) -> tuple[Fixture, str]:
        """`event_offset`은 as_of 이후 몇 번째 세션에 실적을 두는지다.

        진입은 as_of 다음 세션이고 완충은 실적일을 제외해서 세므로 완충 세션 수는
        `event_offset - 1`이다.
        """
        specs = full_universe()
        earnings = None
        if event_offset is not None:
            dates = synthetic.sessions(DAYS + TAIL)
            earnings = "symbol,event_at,published_at,confidence\n" + "".join(
                f"{spec.symbol},{dates[DAYS - 1 + event_offset]},{dates[DAYS - 20]},confirmed\n"
                for spec in specs
            )
        fixture = build(specs, earnings_csv=earnings)
        return fixture, TREND_NAMES[0]

    def test_unknown_earnings_blocks_entry_by_default(self):
        """언제 갭이 날지 모르는 종목을 40거래일 들고 갈 수는 없다(9.3)."""
        fixture, _ = self.make(None)
        ranking = fixture.ranking(require_earnings_calendar=True)
        self.assertEqual(ranking.candidates, ())
        # STALLED는 돌파 게이트에서 먼저 걸리므로 실적 게이트까지 오지 않는다.
        self.assertEqual(ranking.skip_counts()["EARNINGS_UNKNOWN"], len(TREND_NAMES))

    def test_four_sessions_of_room_is_enough(self):
        fixture, top = self.make(5)
        ranking = fixture.ranking(require_earnings_calendar=True)
        self.assertEqual(ranking.candidates[0].symbol, top)

    def test_three_sessions_is_too_close(self):
        fixture, _ = self.make(4)
        ranking = fixture.ranking(require_earnings_calendar=True)
        self.assertEqual(ranking.candidates, ())
        skips = {skip.symbol: skip.reason for skip in ranking.skipped}
        self.assertEqual(skips[TREND_NAMES[0]], "EARNINGS_TOO_CLOSE")

    def test_weekday_helpers(self):
        # 금요일 신호의 다음 정규장은 월요일이다.
        self.assertEqual(next_weekday("2026-08-07"), date(2026, 8, 10))
        self.assertEqual(next_weekday("2026-08-06"), date(2026, 8, 7))
        self.assertEqual(
            weekdays_between(date(2026, 8, 10), date(2026, 8, 14)), 4
        )
        self.assertEqual(weekdays_between(date(2026, 8, 10), date(2026, 8, 10)), 0)
        # 주말은 세지 않는다.
        self.assertEqual(weekdays_between(date(2026, 8, 7), date(2026, 8, 11)), 2)


class SignalPersistenceTest(unittest.TestCase):
    def setUp(self):
        self.fixture = build(full_universe())
        self.ranking = self.fixture.ranking()

    def test_signal_id_is_derived_from_strategy_data_date_and_symbol(self):
        candidate = self.ranking.candidates[0]
        self.assertEqual(candidate.signal_id(VERSION), candidate.signal_id(VERSION))
        self.assertNotEqual(candidate.signal_id(VERSION), candidate.signal_id("v2"))
        self.assertNotEqual(
            candidate.signal_id(VERSION), self.ranking.candidates[1].signal_id(VERSION)
        )

    def test_saved_rows_carry_the_audit_fields(self):
        written = save_signals(
            self.fixture.connection, self.ranking, VERSION, snapshot_id="deadbeef"
        )
        self.assertEqual(written, MAX_CANDIDATES)
        rows = self.fixture.connection.execute(
            "SELECT * FROM signals ORDER BY rank"
        ).fetchall()
        top = self.ranking.candidates[0]
        self.assertEqual(rows[0]["symbol"], top.symbol)
        self.assertEqual(rows[0]["strategy_version"], STRATEGY_VERSION)
        self.assertEqual(rows[0]["feature_hash"], top.features.feature_hash)
        self.assertEqual(rows[0]["snapshot_id"], "deadbeef")
        self.assertEqual(rows[0]["regime"], "GREEN")
        self.assertEqual(rows[0]["score_population"], self.ranking.score_population)
        self.assertIn("BREAKOUT_20D", rows[0]["reasons"])

    def test_rerunning_the_same_snapshot_does_not_duplicate(self):
        save_signals(self.fixture.connection, self.ranking, VERSION)
        save_signals(self.fixture.connection, self.fixture.ranking(), VERSION)
        count = self.fixture.connection.execute(
            "SELECT COUNT(*) AS n FROM signals"
        ).fetchone()["n"]
        self.assertEqual(count, MAX_CANDIDATES)


if __name__ == "__main__":
    unittest.main()
