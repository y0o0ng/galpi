"""슬롯 용량 처치의 불변식.

가장 중요한 것은 `test_the_risk_budget_is_the_invariant`다. 슬롯만 늘리고 거래당 위험을
그대로 두면 총 위험이 커져 **용량 실험이 아니라 레버리지 실험**이 된다. 그러면 "슬롯을
늘렸더니 좋아졌다"를 용량에 귀속할 수 없다.

**"오직 `max_positions` 하나만 다르다"는 테스트를 만들지 않는다.** 이번 처치는 의도적으로
슬롯과 거래당 위험이 연동돼 움직인다. 대신 그 묶음 밖이 같은지를 잠근다.
"""

from __future__ import annotations

import sys
import unittest
from dataclasses import asdict
from pathlib import Path

TRADING_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TRADING_ROOT))

from core import CORES  # noqa: E402
from core.jt import RESEARCH_LIMITS  # noqa: E402
from core.jt_slots import RISK_BUDGET, SLOT_CORES, SLOT_HOLDS, SLOT_LADDER  # noqa: E402
from selftest.slot_capacity_run import (  # noqa: E402
    BASE_SLOTS,
    PORTFOLIO_STAGE_REASONS,
    core_name,
    planned,
    run_id_for,
)

# 격자 전체. S5는 PR #10 코어를 그대로 쓴다.
GRID = [
    (hold, slots, random)
    for hold in SLOT_HOLDS
    for slots in SLOT_LADDER
    for random in (False, True)
]


def core_of(hold: int, slots: int, random: bool):
    return CORES[core_name(hold, slots, random=random)]


class RiskBudgetTest(unittest.TestCase):
    def test_the_risk_budget_is_the_invariant(self):
        """**`max_positions × risk_per_trade == 0.0125`.**

        이것이 깨지면 슬롯 실험이 아니라 레버리지 실험이다.
        """
        for hold, slots, random in GRID:
            with self.subTest(hold=hold, slots=slots, random=random):
                policy = core_of(hold, slots, random).policy
                self.assertEqual(policy.limits.max_positions, slots)
                self.assertAlmostEqual(
                    policy.limits.max_positions * policy.profile.risk_per_trade,
                    RISK_BUDGET,
                )

    def test_the_total_planned_risk_cap_never_moves(self):
        for hold, slots, random in GRID:
            with self.subTest(hold=hold, slots=slots, random=random):
                limits = core_of(hold, slots, random).policy.limits
                self.assertAlmostEqual(limits.max_total_planned_risk, RISK_BUDGET)

    def test_the_per_trade_risk_is_the_budget_divided(self):
        for slots, expected in ((5, 0.0025), (10, 0.00125), (20, 0.000625)):
            with self.subTest(slots=slots):
                profile = core_of(42, slots, False).policy.profile
                self.assertAlmostEqual(profile.risk_per_trade, expected)

    def test_max_exposure_and_the_other_hard_limits_are_untouched(self):
        """슬롯과 위험 말고 다른 한도가 같이 움직이면 처치가 하나가 아니게 된다."""
        baseline = asdict(RESEARCH_LIMITS)
        for hold, slots, random in GRID:
            with self.subTest(hold=hold, slots=slots, random=random):
                core = core_of(hold, slots, random)
                limits = asdict(core.policy.limits)
                differing = {
                    field for field, value in limits.items() if value != baseline[field]
                }
                self.assertLessEqual(differing, {"max_positions"})
                self.assertAlmostEqual(core.policy.profile.max_exposure, 0.60)


class SingleTreatmentTest(unittest.TestCase):
    """묶음 밖은 전부 같아야 한다."""

    def test_slot_variants_share_every_strategy_parameter(self):
        for hold in SLOT_HOLDS:
            base = asdict(core_of(hold, BASE_SLOTS, False).policy.parameters)
            for slots in SLOT_LADDER:
                with self.subTest(hold=hold, slots=slots):
                    self.assertEqual(
                        asdict(core_of(hold, slots, False).policy.parameters), base
                    )

    def test_max_daily_entries_is_not_scaled_with_slots(self):
        """**슬롯에 맞춰 같이 늘리지 않는다.** 새 병목이 되면 그것이 관측 결과다."""
        for hold, slots, random in GRID:
            with self.subTest(hold=hold, slots=slots, random=random):
                parameters = core_of(hold, slots, random).policy.parameters
                self.assertEqual(parameters.max_daily_entries_green, 2)
                self.assertEqual(parameters.max_daily_entries_yellow, 1)

    def test_the_candidate_pool_stays_top_five(self):
        """후보는 TOP5 그대로다. 슬롯을 늘려도 하루에 보는 이름 수는 같다."""
        for hold, slots, random in GRID:
            with self.subTest(hold=hold, slots=slots, random=random):
                self.assertEqual(
                    core_of(hold, slots, random).policy.parameters.max_candidates, 5
                )

    def test_only_the_ranking_differs_between_rs_and_random(self):
        for hold in SLOT_HOLDS:
            for slots in SLOT_LADDER:
                with self.subTest(hold=hold, slots=slots):
                    rs, control = core_of(hold, slots, False), core_of(hold, slots, True)
                    self.assertEqual(
                        asdict(rs.policy.parameters), asdict(control.policy.parameters)
                    )
                    self.assertEqual(
                        asdict(rs.policy.limits), asdict(control.policy.limits)
                    )
                    self.assertEqual(
                        rs.policy.profile.risk_per_trade,
                        control.policy.profile.risk_per_trade,
                    )
                    self.assertEqual(rs.exit_mode, control.exit_mode)
                    self.assertEqual(rs.regime_mode, control.regime_mode)
                    self.assertEqual(rs.entry_mode, "RS_ONLY")
                    self.assertEqual(control.entry_mode, "RANDOM")

    def test_the_two_holds_differ_only_in_max_hold_within_a_slot_level(self):
        for slots in SLOT_LADDER:
            with self.subTest(slots=slots):
                a = asdict(core_of(42, slots, False).policy.parameters)
                b = asdict(core_of(84, slots, False).policy.parameters)
                differing = {field for field in a if a[field] != b[field]}
                self.assertEqual(differing, {"max_hold_sessions"})

    def test_j_and_skip_never_move(self):
        """J와 skip은 이번 실험에서 절대 바뀌지 않는다."""
        for hold, slots, random in GRID:
            with self.subTest(hold=hold, slots=slots, random=random):
                parameters = core_of(hold, slots, random).policy.parameters
                self.assertEqual(parameters.rs_lookback, 63)
                self.assertEqual(parameters.rs_skip, 5)


class LadderTest(unittest.TestCase):
    def test_the_ladder_ends_at_twenty(self):
        """결과를 보고 S15·S30을 덧붙이지 않는다."""
        self.assertEqual(SLOT_LADDER, (5, 10, 20))
        self.assertEqual(SLOT_HOLDS, (42, 84))

    def test_s5_reuses_the_pr10_cores(self):
        """5 × 0.0025 = 0.0125이라 S5는 새 코어가 아니다. 재현이 공짜로 따라온다."""
        self.assertEqual(core_name(42, 5, random=False), "jt-k42")
        self.assertEqual(core_name(84, 5, random=False), "jt-k84")
        self.assertEqual(core_name(84, 5, random=True), "jt-random-k84")
        self.assertNotIn("jt-k42-s5", CORES)

    def test_only_the_non_base_cells_are_new_cores(self):
        self.assertEqual(len(SLOT_CORES), 8)
        for core in SLOT_CORES:
            self.assertNotIn("-s5", core.name)

    def test_every_grid_cell_has_a_distinct_signature(self):
        signatures = {core_of(*cell).signature for cell in GRID}
        self.assertEqual(len(signatures), len(GRID))


class PlanTest(unittest.TestCase):
    def test_the_matrix_is_twelve_rs_and_sixty_control_runs(self):
        jobs = planned()
        rs = [job for job in jobs if CORES[job[0]].entry_mode == "RS_ONLY"]
        control = [job for job in jobs if CORES[job[0]].entry_mode == "RANDOM"]
        self.assertEqual(len(rs), 12)
        self.assertEqual(len(control), 60)

    def test_only_the_rs_runs_carry_both_delisting_scenarios(self):
        jobs = planned()
        self.assertEqual(
            {job[1] for job in jobs if CORES[job[0]].entry_mode == "RS_ONLY"},
            {"LAST_CLOSE", "ZERO"},
        )
        self.assertEqual(
            {job[1] for job in jobs if CORES[job[0]].entry_mode == "RANDOM"},
            {"LAST_CLOSE"},
        )

    def test_run_ids_are_unique(self):
        ids = [run_id_for(*job) for job in planned()]
        self.assertEqual(len(ids), len(set(ids)))

    def test_the_control_grid_is_complete_for_paired_deltas(self):
        """rescue interaction을 시드별로 내려면 네 칸이 같은 시드로 다 있어야 한다."""
        jobs = {(job[0], job[2]) for job in planned()}
        for hold in SLOT_HOLDS:
            for slots in SLOT_LADDER:
                name = core_name(hold, slots, random=True)
                for seed in range(10):
                    self.assertIn((name, seed), jobs)


class SkipReasonTest(unittest.TestCase):
    def test_every_portfolio_stage_reason_is_a_real_engine_string(self):
        """**사유 이름을 임의로 만들지 않는다.** 엔진이 쓰는 문자열만 쓴다.

        하나라도 엔진에 없으면 그 칸은 영원히 0이고, 표를 보는 사람은 그 한도가 한 번도
        안 걸렸다고 읽는다. 오타가 "병목이 아니다"로 읽히는 자리다.
        """
        sources = "".join(
            path.read_text(encoding="utf-8")
            for path in sorted((TRADING_ROOT / "backtest").glob("*.py"))
        )
        unknown = [
            reason for reason in PORTFOLIO_STAGE_REASONS if f'"{reason}"' not in sources
        ]
        self.assertEqual(unknown, [], f"엔진에 없는 사유 이름: {unknown}")

    def test_the_reasons_are_unique(self):
        self.assertEqual(
            len(PORTFOLIO_STAGE_REASONS), len(set(PORTFOLIO_STAGE_REASONS))
        )

    def test_the_slot_bottleneck_reason_is_tracked(self):
        self.assertIn("MAX_POSITIONS_REACHED", PORTFOLIO_STAGE_REASONS)


if __name__ == "__main__":
    unittest.main()
