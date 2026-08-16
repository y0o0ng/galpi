"""탐색적 랭크 진단의 계산.

이 진단은 사전등록 실험이 아니지만 **틀린 숫자는 사전등록 결과만큼 위험하다** — 잘못된
진단이 다음 연구 방향을 정하기 때문이다.

가장 중요한 것은 `test_the_observer_does_not_change_the_result`다. 관찰자가 엔진 분기에
끼어들면 진단이 PR #11의 재현을 깨뜨리고, 그러면 진단과 실험이 다른 실행을 설명하게 된다.
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
from backtest.candidates import rank_candidates  # noqa: E402
from backtest.data import PointInTimeSnapshot  # noqa: E402
from backtest.holdout import HOLDOUT_START  # noqa: E402
from backtest.loop import ACCEPTED, run_backtest  # noqa: E402
from backtest.regime import classify_market_regime  # noqa: E402
from core import CORES  # noqa: E402
from selftest.rank_diagnostic_run import (  # noqa: E402
    HORIZONS,
    TOP_N,
    _quantile,
    rs_cells,
)

def overlap_of(today: list[str], yesterday: list[str]) -> tuple[int, int, float]:
    """`(겹침, 새 이름, churn)`. 러너와 같은 정의를 손으로 확인하기 위한 재현이다."""
    overlap = len(set(today) & set(yesterday))
    new_names = TOP_N - overlap
    return overlap, new_names, new_names / TOP_N


class ChurnArithmeticTest(unittest.TestCase):
    def test_the_worked_example(self):
        """A B C D E → A B C F G 이면 겹침 3 · 새 이름 2 · churn 0.4."""
        overlap, new_names, churn = overlap_of(
            ["A", "B", "C", "F", "G"], ["A", "B", "C", "D", "E"]
        )
        self.assertEqual(overlap, 3)
        self.assertEqual(new_names, 2)
        self.assertAlmostEqual(churn, 0.4)

    def test_a_fully_stale_day_has_no_churn(self):
        self.assertEqual(overlap_of(list("ABCDE"), list("ABCDE")), (5, 0, 0.0))

    def test_a_fully_fresh_day_is_complete_churn(self):
        self.assertEqual(overlap_of(list("FGHIJ"), list("ABCDE")), (0, 5, 1.0))

    def test_order_does_not_change_the_overlap(self):
        """겹침은 집합 연산이다. 랭크가 뒤바뀐 것은 새 이름이 아니다."""
        self.assertEqual(overlap_of(list("EDCBA"), list("ABCDE"))[0], 5)


class QuantileTest(unittest.TestCase):
    def test_quantiles_pick_real_observations(self):
        values = list(range(1, 101))
        self.assertEqual(_quantile(values, 0.75), 75)
        self.assertEqual(_quantile(values, 0.90), 90)

    def test_an_empty_series_has_no_quantile(self):
        self.assertIsNone(_quantile([], 0.75))


class RankSourceTest(unittest.TestCase):
    """랭크는 **포트폴리오 게이트 이전** RS 순위여야 한다.

    픽스처는 `test_loop.build()`를 그대로 쓴다 — 진단이 실험과 같은 유니버스·필터·랭킹을
    본다는 것이 이 진단의 전제라, 여기서 별도 세계를 만들면 그 전제가 깨진다.
    """

    @classmethod
    def setUpClass(cls):
        cls.connection, cls.dates = test_loop.build()

    @classmethod
    def tearDownClass(cls):
        cls.connection.close()

    def ranking(self):
        core = CORES["jt-k42"]
        snapshot = PointInTimeSnapshot(
            self.connection, self.dates[-1], test_loop.VERSION
        )
        regime = classify_market_regime(snapshot, core.policy.parameters)
        return rank_candidates(
            snapshot,
            regime,
            policy=core.policy,
            index_names=("SP500",),
            require_earnings_calendar=False,
            entry_mode=core.entry_mode,
        )

    def test_ranks_run_one_to_five_and_follow_the_score(self):
        ranking = self.ranking()
        self.assertEqual([c.rank for c in ranking.candidates], [1, 2, 3, 4, 5])
        scores = [c.score for c in ranking.candidates]
        self.assertEqual(scores, sorted(scores, reverse=True))

    def test_rank_one_is_the_strongest_momentum(self):
        """`test_loop`의 계단 종목은 기울기 내림차순이라 1위가 정해져 있다."""
        self.assertEqual(self.ranking().candidates[0].symbol, test_loop.TREND_NAMES[0])

    def test_no_rank_outside_one_to_five_can_exist(self):
        """**랭크 6이 생기면 진단 표가 조용히 틀린다.** 후보는 TOP5로 잘린다."""
        ranking = self.ranking()
        self.assertLessEqual(len(ranking.candidates), TOP_N)
        for candidate in ranking.candidates:
            self.assertIn(candidate.rank, range(1, TOP_N + 1))

    def test_the_rest_of_the_eligible_universe_is_recoverable(self):
        """랭크별 초과수익의 분모가 여기서 나온다 — 후보 + `BELOW_TOP_N`."""
        ranking = self.ranking()
        below = [s.symbol for s in ranking.skipped if s.reason == "BELOW_TOP_N"]
        universe = [c.symbol for c in ranking.candidates] + below
        self.assertGreater(len(universe), TOP_N)
        self.assertEqual(len(set(universe)), len(universe))


class ObserverTest(unittest.TestCase):
    """관찰자는 읽기만 한다."""

    @classmethod
    def setUpClass(cls):
        cls.connection, cls.dates = test_loop.build()

    @classmethod
    def tearDownClass(cls):
        cls.connection.close()

    def config(self):
        core = CORES["jt-k42"]
        return test_loop.config(
            self.dates,
            policy=core.policy,
            entry_mode=core.entry_mode,
            exit_mode=core.exit_mode,
            regime_mode=core.regime_mode,
            require_earnings_calendar=False,
        )

    def test_the_observer_does_not_change_the_result(self):
        """**가장 중요한 테스트.** 진단이 PR #11의 재현을 깨뜨리면 안 된다."""
        config = self.config()
        plain = run_backtest(self.connection, config)
        traced = run_backtest(self.connection, config, observer=lambda *_: None)
        self.assertEqual(len(plain.trades), len(traced.trades))
        self.assertEqual(plain.skip_counts, traced.skip_counts)
        self.assertEqual(plain.final_equity, traced.final_equity)
        self.assertEqual(
            [t.symbol for t in plain.trades], [t.symbol for t in traced.trades]
        )

    def test_a_raising_observer_would_surface_not_be_swallowed(self):
        """관찰자 오류를 삼키면 표가 조용히 비어버린다. 터지는 편이 낫다."""

        def boom(*_):
            raise RuntimeError("관찰자 실패")

        with self.assertRaises(RuntimeError):
            run_backtest(self.connection, self.config(), observer=boom)

    def test_accepted_is_never_fewer_than_the_trades_it_produced(self):
        """**`ACCEPTED`는 체결이 아니라 주문 수락이다.**

        게이트를 통과한 주문도 다음 날 `NO_FILL`·`GAP_LIMIT`·`NO_EXECUTION_BAR`으로
        빠진다. 그래서 통과 수가 거래 수보다 많을 수 있고, 적을 수는 없다. 이 방향이
        뒤집히면 관찰 지점이 틀린 것이다.
        """
        seen: list[tuple[str, int, str, str]] = []
        result = run_backtest(
            self.connection,
            self.config(),
            observer=lambda *row: seen.append(row),
        )
        accepted = [row for row in seen if row[3] == ACCEPTED]
        produced = len(result.trades) + len(result.open_positions)
        self.assertGreaterEqual(len(accepted), produced)
        # 차이는 체결 단계 실패로만 설명돼야 한다.
        execution_failures = sum(
            result.skip_counts.get(reason, 0)
            for reason in ("NO_FILL", "GAP_LIMIT", "NO_EXECUTION_BAR", "CORPORATE_ACTION")
        )
        self.assertLessEqual(len(accepted) - produced, execution_failures)
        for _, rank, _, _ in seen:
            self.assertIn(rank, range(1, TOP_N + 1))

    def test_every_observed_outcome_is_an_entry_or_a_rejection_reason(self):
        seen: list[tuple[str, int, str, str]] = []
        result = run_backtest(
            self.connection,
            self.config(),
            observer=lambda *row: seen.append(row),
        )
        allowed = set(result.skip_counts) | {ACCEPTED}
        for _, _, _, outcome in seen:
            self.assertIn(outcome, allowed)

    def test_the_accepted_marker_is_not_an_engine_reason(self):
        """`ACCEPTED`가 엔진 사유와 겹치면 진단 표에서 통과가 거부로 세어진다."""
        sources = "".join(
            path.read_text(encoding="utf-8")
            for path in sorted((TRADING_ROOT / "backtest").glob("*.py"))
            if path.name != "loop.py"
        )
        self.assertNotIn(f'"{ACCEPTED}"', sources)

    def test_observed_dates_never_reach_the_holdout(self):
        """진단도 홀드아웃을 보지 않는다."""
        seen: list[str] = []
        run_backtest(
            self.connection,
            self.config(),
            observer=lambda date, *_: seen.append(date),
        )
        self.assertTrue(seen)
        for date in seen:
            self.assertLess(date, HOLDOUT_START)


class ScopeTest(unittest.TestCase):
    def test_the_diagnostic_covers_every_rs_cell(self):
        self.assertEqual(
            rs_cells(),
            ["jt-k42", "jt-k42-s10", "jt-k42-s20",
             "jt-k84", "jt-k84-s10", "jt-k84-s20"],
        )

    def test_the_horizons_match_the_predeclared_set(self):
        self.assertEqual(HORIZONS, (21, 42, 84))

    def test_the_diagnostic_does_not_touch_candidate_count(self):
        """**`max_candidates`를 바꾸지 않는다.** 이번 작업은 진단이지 실험이 아니다."""
        for cell in rs_cells():
            with self.subTest(cell=cell):
                self.assertEqual(CORES[cell].policy.parameters.max_candidates, TOP_N)


if __name__ == "__main__":
    unittest.main()
