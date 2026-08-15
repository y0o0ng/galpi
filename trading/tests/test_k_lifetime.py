"""K 신호 수명 실험 러너의 계산.

가장 중요한 것은 `test_the_two_series_are_aligned_session_by_session`이다. 노출 일치
수익률은 전이마다 하나씩 나와 곡선의 점보다 하나 적은데, 그걸 모르고 짝지으면 레짐별
격차가 **하루씩 밀린 두 계열의 차이**가 된다. 값으로 고정해 둔다.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

TRADING_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TRADING_ROOT))

from backtest.loop import (  # noqa: E402
    BacktestConfig,
    BacktestResult,
    EquityPoint,
    Trade,
)
from selftest.k_lifetime_run import (  # noqa: E402
    HOLDS,
    RANDOM_SEEDS,
    gap_of,
    planned,
    regime_detail,
    run_id_for,
)

CAPITAL = 100_000.0
# 하루씩 오르는 SPY. 전이마다 정확히 +10%다.
CLOSES = {"2026-01-01": 100.0, "2026-01-02": 110.0, "2026-01-03": 121.0}


def point(date: str, equity: float, regime: str, exposure: float) -> EquityPoint:
    return EquityPoint(
        trade_date=date,
        equity=equity,
        cash=equity - exposure,
        exposure=exposure,
        drawdown=0.0,
        regime="GREEN",
        market_regime=regime,
        open_positions=0,
    )


def trade(entry_date: str, pnl: float, return_r: float) -> Trade:
    return Trade(
        symbol="AAA", entry_date=entry_date, exit_date="2026-01-03", shares=1,
        entry_price=100.0, exit_price=100.0, entry_reason="OPEN_FILL",
        exit_reason="MAX_HOLD", exit_fill_reason="OPEN_EXIT", fees=0.0,
        pnl=pnl, return_r=return_r, mfe_r=0.0, mae_r=0.0, sessions_held=1,
        min_qty_exception=False,
    )


def result(points, trades=()) -> BacktestResult:
    return BacktestResult(
        config=BacktestConfig(
            source_version="v1", start="2026-01-01", end="2026-01-03",
            initial_capital=CAPITAL,
        ),
        trades=tuple(trades),
        equity_curve=tuple(points),
        open_positions=(),
        fills=(),
        skip_counts={},
        fill_counts={},
        exit_counts={},
    )


class RegimeDetailTest(unittest.TestCase):
    def test_the_two_series_are_aligned_session_by_session(self):
        """**첫 세션은 양쪽 다 빠진다.** 세션 수가 곡선의 점보다 하나 적어야 맞다."""
        rows = regime_detail(
            result([
                point("2026-01-01", CAPITAL, "BULL/LOW_VOL", 0.0),
                point("2026-01-02", CAPITAL, "BULL/LOW_VOL", 0.0),
                point("2026-01-03", CAPITAL, "BULL/LOW_VOL", 0.0),
            ]),
            CLOSES,
        )
        self.assertEqual([row["sessions"] for row in rows], [2])

    def test_full_exposure_matches_the_index_exactly(self):
        """노출 100%면 노출 일치 벤치마크는 지수 그 자체다. 격차가 0이어야 한다."""
        points = [
            point("2026-01-01", CAPITAL, "BULL/LOW_VOL", CAPITAL),
            point("2026-01-02", CAPITAL * 1.10, "BULL/LOW_VOL", CAPITAL * 1.10),
            point("2026-01-03", CAPITAL * 1.21, "BULL/LOW_VOL", CAPITAL * 1.21),
        ]
        row = regime_detail(result(points), CLOSES)[0]
        self.assertAlmostEqual(row["strategy_return"], 0.21)
        self.assertAlmostEqual(row["benchmark_return"], 0.21)
        self.assertAlmostEqual(row["gap"], 0.0)

    def test_zero_exposure_earns_nothing_from_the_index(self):
        """현금만 들고 있었으면 벤치마크도 0이다. 안 산 것을 진 것으로 세지 않는다."""
        points = [
            point("2026-01-01", CAPITAL, "BEAR/HIGH_VOL", 0.0),
            point("2026-01-02", CAPITAL, "BEAR/HIGH_VOL", 0.0),
            point("2026-01-03", CAPITAL, "BEAR/HIGH_VOL", 0.0),
        ]
        row = regime_detail(result(points), CLOSES)[0]
        self.assertAlmostEqual(row["benchmark_return"], 0.0)
        self.assertAlmostEqual(row["gap"], 0.0)

    def test_sessions_split_by_regime_and_trades_by_entry(self):
        """**수익률과 기대값은 같은 거래를 보지 않는다.**

        수익률은 그 상태로 지낸 날의 것이고 기대값은 그 상태에서 진입한 거래의 것이다.
        포지션은 레짐 경계를 넘어 들고 간다.
        """
        points = [
            point("2026-01-01", CAPITAL, "BULL/LOW_VOL", 0.0),
            point("2026-01-02", CAPITAL, "BULL/LOW_VOL", 0.0),
            point("2026-01-03", CAPITAL, "BEAR/HIGH_VOL", 0.0),
        ]
        rows = {
            row["regime"]: row
            for row in regime_detail(
                result(points, [trade("2026-01-01", 10.0, 2.0)]), CLOSES
            )
        }
        # 진입일이 BULL이므로 거래는 BULL에만 붙는다.
        self.assertEqual(rows["BULL/LOW_VOL"]["trade_count"], 1)
        self.assertAlmostEqual(rows["BULL/LOW_VOL"]["expectancy_r"], 2.0)
        self.assertEqual(rows["BEAR/HIGH_VOL"]["trade_count"], 0)
        self.assertIsNone(rows["BEAR/HIGH_VOL"]["expectancy_r"])
        # 세션은 실현된 날 기준이라 BEAR가 하나(01-03) 가져간다.
        self.assertEqual(rows["BEAR/HIGH_VOL"]["sessions"], 1)

    def test_a_curve_too_short_to_have_a_transition_is_empty(self):
        self.assertEqual(regime_detail(result([]), CLOSES), [])
        self.assertEqual(
            regime_detail(result([point("2026-01-01", CAPITAL, "BULL/LOW_VOL", 0.0)]), CLOSES),
            [],
        )


class PlanTest(unittest.TestCase):
    def test_every_k_gets_its_own_control(self):
        """K마다 대조군이 없으면 "보유기간"과 "랭킹"을 가를 수 없다."""
        jobs = planned()
        for hold in HOLDS:
            controls = [job for job in jobs if job[0] == f"jt-random-k{hold}"]
            self.assertEqual(len(controls), len(RANDOM_SEEDS))
            self.assertEqual({job[2] for job in controls}, set(RANDOM_SEEDS))

    def test_only_the_rs_runs_carry_both_delisting_scenarios(self):
        """민감도는 전략 간 순위를 보려는 것이고 그 순위는 RS끼리의 것이다."""
        jobs = planned()
        rs = {job[1] for job in jobs if job[0].startswith("jt-k")}
        control = {job[1] for job in jobs if job[0].startswith("jt-random")}
        self.assertEqual(rs, {"LAST_CLOSE", "ZERO"})
        self.assertEqual(control, {"LAST_CLOSE"})

    def test_run_ids_are_unique(self):
        """이름이 겹치면 뒤 실행이 앞 실행의 JSON을 조용히 덮는다."""
        ids = [run_id_for(*job) for job in planned()]
        self.assertEqual(len(ids), len(set(ids)))

    def test_only_the_control_run_id_carries_a_seed(self):
        self.assertEqual(run_id_for("jt-k63", "LAST_CLOSE", 0), "jt-k63-last_close")
        self.assertEqual(
            run_id_for("jt-random-k63", "LAST_CLOSE", 7), "jt-random-k63-seed07-last_close"
        )


class GapTest(unittest.TestCase):
    def test_the_gap_is_strategy_minus_matched_benchmark(self):
        run = {"metrics": {"total_return": 0.35}, "benchmark": [{"total_return": 0.48}]}
        self.assertAlmostEqual(gap_of(run), -0.13)

    def test_a_run_without_a_benchmark_has_no_gap(self):
        """벤치마크가 없는데 0으로 적으면 "격차 없음"으로 읽힌다."""
        self.assertIsNone(gap_of({"metrics": {"total_return": 0.35}, "benchmark": []}))


if __name__ == "__main__":
    unittest.main()
