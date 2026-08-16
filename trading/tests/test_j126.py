"""J126 포트폴리오 번역 실험의 불변식.

가장 중요한 것은 `test_only_the_formation_horizon_differs`다. J 외에 하나라도 더 다르면
결과 차이를 J126에 귀속할 수 없고, 그러면 이 실험이 답하려는 질문 자체가 성립하지 않는다.

두 번째는 `test_the_challenger_really_computes_rs126`다. `Features.rs63_5`는 J=63을
전제로 붙은 유산 이름이라, 필드 이름만 보고 "J63이 들어 있다"고 읽으면 challenger가
사실은 J63을 돌리고 있어도 아무도 모른다.
"""

from __future__ import annotations

import sys
import unittest
from dataclasses import asdict
from pathlib import Path

TRADING_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TRADING_ROOT))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import test_loop  # noqa: E402
from backtest.data import PointInTimeSnapshot  # noqa: E402
from backtest.features import compute_features, relative_strength  # noqa: E402
from core import CORES  # noqa: E402
from core.jt_j126_k42 import FORMATION_SESSIONS  # noqa: E402
from selftest.j126_translation_run import (  # noqa: E402
    BASELINE,
    CHALLENGER,
    CONTROL,
    RANDOM_SEEDS,
    SIGNALS,
    planned,
    run_id_for,
)


class SingleDifferenceTest(unittest.TestCase):
    """J 외에는 전부 같아야 한다."""

    def policies(self):
        return CORES[BASELINE].policy, CORES[CHALLENGER].policy

    def test_only_the_formation_horizon_differs(self):
        """**정확히 `rs_lookback` 하나다.** "거의 같다"가 아니라 값으로 비교한다."""
        base, challenger = self.policies()
        left, right = asdict(base.parameters), asdict(challenger.parameters)
        differing = {field for field in left if left[field] != right[field]}
        self.assertEqual(differing, {"rs_lookback"})

    def test_the_challenger_is_the_pr12_survivor(self):
        base, challenger = self.policies()
        self.assertEqual(base.parameters.rs_lookback, 63)
        self.assertEqual(challenger.parameters.rs_lookback, 126)
        self.assertEqual(FORMATION_SESSIONS, 126)

    def test_skip_stays_five(self):
        for policy in self.policies():
            with self.subTest(policy=policy.policy_id):
                self.assertEqual(policy.parameters.rs_skip, 5)

    def test_hold_stays_forty_two(self):
        for policy in self.policies():
            with self.subTest(policy=policy.policy_id):
                self.assertEqual(policy.parameters.max_hold_sessions, 42)

    def test_slots_stay_five(self):
        for policy in self.policies():
            with self.subTest(policy=policy.policy_id):
                self.assertEqual(policy.limits.max_positions, 5)

    def test_the_risk_structure_is_untouched(self):
        for policy in self.policies():
            with self.subTest(policy=policy.policy_id):
                self.assertAlmostEqual(policy.profile.risk_per_trade, 0.0025)
                self.assertAlmostEqual(policy.limits.max_total_planned_risk, 0.0125)
                self.assertAlmostEqual(policy.profile.max_exposure, 0.60)

    def test_the_candidate_pool_stays_top_five(self):
        for policy in self.policies():
            with self.subTest(policy=policy.policy_id):
                self.assertEqual(policy.parameters.max_candidates, 5)

    def test_limits_and_profile_are_identical(self):
        base, challenger = self.policies()
        self.assertEqual(asdict(base.limits), asdict(challenger.limits))
        self.assertEqual(
            asdict(base.profile) | {"name": None},
            asdict(challenger.profile) | {"name": None},
        )

    def test_the_execution_modes_are_identical(self):
        base, challenger = CORES[BASELINE], CORES[CHALLENGER]
        for field in ("entry_mode", "exit_mode", "regime_mode",
                      "require_earnings_calendar", "require_sector"):
            with self.subTest(field=field):
                self.assertEqual(getattr(base, field), getattr(challenger, field))

    def test_the_two_cores_have_distinct_signatures(self):
        base, challenger = self.policies()
        self.assertNotEqual(base.signature, challenger.signature)

    def test_the_baseline_core_is_reused_not_copied(self):
        """J63 기준선은 PR #10이 쓰던 코어 그대로여야 재현이 뜻이 있다."""
        self.assertEqual(BASELINE, "jt-k42")


class FeatureTest(unittest.TestCase):
    """유산 필드 이름 뒤에 실제로 무엇이 들어 있는가."""

    @classmethod
    def setUpClass(cls):
        cls.connection, cls.dates = test_loop.build()

    @classmethod
    def tearDownClass(cls):
        cls.connection.close()

    def snapshot(self):
        return PointInTimeSnapshot(self.connection, self.dates[-1], test_loop.VERSION)

    def arrays(self, snapshot, symbol: str):
        history = CORES[BASELINE].policy.parameters.min_history_sessions
        return (
            [bar.adj_close for bar in snapshot.bars(symbol, history)],
            [bar.adj_close for bar in snapshot.bars(snapshot.reference_symbol, history)],
        )

    def test_the_challenger_really_computes_rs126(self):
        """**`rs63_5`는 유산 이름이다.** challenger에서는 그 자리에 RS(126,5)가 들어간다."""
        snapshot = self.snapshot()
        checked = 0
        for symbol in test_loop.TREND_NAMES:
            adjusted, reference = self.arrays(snapshot, symbol)
            features = compute_features(
                snapshot, symbol, CORES[CHALLENGER].policy.parameters
            )
            self.assertAlmostEqual(
                features.rs63_5,
                relative_strength(adjusted, reference, FORMATION_SESSIONS, 5),
                places=12,
            )
            checked += 1
        self.assertGreater(checked, 0)

    def test_the_baseline_still_computes_rs63(self):
        snapshot = self.snapshot()
        for symbol in test_loop.TREND_NAMES:
            adjusted, reference = self.arrays(snapshot, symbol)
            features = compute_features(
                snapshot, symbol, CORES[BASELINE].policy.parameters
            )
            self.assertAlmostEqual(
                features.rs63_5, relative_strength(adjusted, reference, 63, 5), places=12
            )

    def test_the_two_horizons_actually_differ(self):
        """값이 같으면 J를 바꿔도 랭킹이 안 바뀐다 — 실험이 성립하지 않는다."""
        snapshot = self.snapshot()
        symbol = test_loop.TREND_NAMES[0]
        base = compute_features(snapshot, symbol, CORES[BASELINE].policy.parameters)
        challenger = compute_features(
            snapshot, symbol, CORES[CHALLENGER].policy.parameters
        )
        self.assertNotAlmostEqual(base.rs63_5, challenger.rs63_5, places=6)

    def test_the_eligible_history_requirement_is_unchanged(self):
        """**최소 이력이 같아야 두 코어가 같은 유니버스를 본다.**

        J=126이 `min_history_sessions`를 밀어 올렸다면 J126만 종목이 빠져서 "J 효과"와
        "표본 구성 효과"가 섞였을 것이다.
        """
        base = CORES[BASELINE].policy.parameters
        challenger = CORES[CHALLENGER].policy.parameters
        self.assertEqual(
            base.min_history_sessions, challenger.min_history_sessions
        )
        self.assertGreater(challenger.min_history_sessions, FORMATION_SESSIONS + 1)


class MatrixTest(unittest.TestCase):
    def test_the_matrix_is_four_signal_runs_and_ten_controls(self):
        jobs = planned()
        signal = [job for job in jobs if job[0] in SIGNALS]
        control = [job for job in jobs if job[0] == CONTROL]
        self.assertEqual(len(signal), 4)
        self.assertEqual(len(control), 10)
        self.assertEqual(len(jobs), 14)

    def test_both_signals_run_both_delisting_scenarios(self):
        jobs = planned()
        for core in SIGNALS:
            with self.subTest(core=core):
                self.assertEqual(
                    {job[1] for job in jobs if job[0] == core},
                    {"LAST_CLOSE", "ZERO"},
                )

    def test_the_control_is_shared_not_duplicated_per_j(self):
        """**`random-j63`·`random-j126`을 만들지 않는다.** RANDOM은 J를 쓰지 않는다."""
        self.assertEqual(CONTROL, "jt-random-k42")
        self.assertEqual({job[0] for job in planned() if "random" in job[0]}, {CONTROL})
        for name in CORES:
            with self.subTest(name=name):
                self.assertNotIn("random-j", name)

    def test_the_control_keeps_the_shared_mechanics(self):
        control, base = CORES[CONTROL].policy, CORES[BASELINE].policy
        self.assertEqual(control.parameters.max_hold_sessions, 42)
        self.assertEqual(control.limits.max_positions, 5)
        self.assertEqual(asdict(control.limits), asdict(base.limits))
        self.assertEqual(CORES[CONTROL].entry_mode, "RANDOM")

    def test_ten_seeds(self):
        self.assertEqual(RANDOM_SEEDS, tuple(range(10)))

    def test_run_ids_are_unique(self):
        ids = [run_id_for(*job) for job in planned()]
        self.assertEqual(len(ids), len(set(ids)))

    def test_no_other_j_is_in_the_matrix(self):
        """J189·J252·다른 J를 포트폴리오 층에서 열지 않는다."""
        lookbacks = {
            CORES[job[0]].policy.parameters.rs_lookback for job in planned()
        }
        self.assertEqual(lookbacks, {63, 126})


class HoldoutTest(unittest.TestCase):
    def test_the_runner_uses_the_shared_research_window(self):
        """PR #10·#11과 같은 경계 함수를 쓴다. 따로 구현하면 구간이 갈린다."""
        import selftest.j126_translation_run as module
        from selftest.momentum_run import research_window

        self.assertIs(module.research_window, research_window)


if __name__ == "__main__":
    unittest.main()
