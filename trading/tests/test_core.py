"""코어 등록부. 실험의 전제를 값으로 고정한다.

코어는 "한 벌의 규칙"이고 여기서 지키려는 것은 셋이다.

- 코어끼리 서명이 갈린다 — 같은 서명이면 실행 보고서를 견줄 수 없다.
- 비교하려는 코어는 **딱 하나만 다르다** — 여럿이 다르면 차이를 귀속할 수 없다.
- 연구 코어의 완화가 낙폭 게이트에서 멈춘다 — 손실 한도까지 풀리면 다른 실험이 된다.
"""

from __future__ import annotations

import sys
import unittest
from dataclasses import asdict, fields
from pathlib import Path

TRADING_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TRADING_ROOT))

from backtest.loop import BacktestConfig  # noqa: E402
from backtest.policy import HardLimits, PolicyError  # noqa: E402
from backtest.risk import account_gate  # noqa: E402
from backtest.sizing import AccountState  # noqa: E402
from core import (  # noqa: E402
    CORE1,
    CORES,
    JT_CORE_EXIT,
    JT_K21,
    JT_K42,
    JT_K63,
    JT_K84,
    JT_RANDOM_K42,
    JT_RANDOM_K63,
    JT_RANDOM_K84,
)
from core.definition import RULE_FIELDS, CoreDefinition  # noqa: E402
from core.jt_j126_k42 import JT_J126_K42  # noqa: E402
from core.jt_j126_k42_sma200 import JT_J126_K42_SMA200  # noqa: E402
from core.jt_slots import SLOT_CORES  # noqa: E402

# **J를 바꾸는 코어는 여기 적힌 것뿐이다.** PR #12 신호 연구가 challenger를 하나로
# 줄였고, 목록을 명시로 두어야 새 J가 조용히 끼지 못한다.
# J를 바꾸는 코어의 명시 목록. **새 J가 조용히 끼어들지 못하게 한다.**
# `-sma200`은 J를 더 바꾼 것이 아니라 `jt-j126-k42`에 시장 게이트만 켠 것이다(PR #16).
J_VARIANTS = {JT_J126_K42.name: 126, JT_J126_K42_SMA200.name: 126}

RESEARCH_CORES = (
    JT_K21,
    JT_K42,
    JT_K63,
    JT_K84,
    JT_CORE_EXIT,
    JT_RANDOM_K42,
    JT_RANDOM_K63,
    JT_RANDOM_K84,
)

# K 신호 수명 실험의 짝. 각 K와 그 K의 대조군이다.
K_PAIRS = ((42, JT_K42, JT_RANDOM_K42), (63, JT_K63, JT_RANDOM_K63),
           (84, JT_K84, JT_RANDOM_K84))


def account(drawdown: float) -> AccountState:
    return AccountState(
        equity=100_000.0,
        cash=100_000.0,
        positions=(),
        drawdown=drawdown,
        daily_pnl_fraction=0.0,
        prior_week_pnl_fraction=0.0,
    )


class RegistryTest(unittest.TestCase):
    def test_every_core_is_registered_under_its_own_name(self):
        for name, core in CORES.items():
            self.assertEqual(name, core.name)
        # 기준선 하나 + 연구 코어들 + 슬롯 격자. 이 테스트가 아는 것보다 많이 등록되면
        # 걸린다. 슬롯 코어의 한도 불변식은 `test_slots.py`가 따로 잠근다 — 여기 목록에
        # 넣으면 "낙폭 한도만 완화됐다"는 엄격한 검사가 `max_positions` 때문에 깨진다.
        self.assertEqual(
            len(CORES), len(RESEARCH_CORES) + len(SLOT_CORES) + len(J_VARIANTS) + 1
        )

    def test_cores_have_distinct_signatures(self):
        signatures = {core.signature for core in CORES.values()}
        self.assertEqual(len(signatures), len(CORES))

    def test_an_unknown_mode_is_refused(self):
        with self.assertRaises(PolicyError):
            CoreDefinition(
                name="bad", policy=CORE1.policy, entry_mode="RS",
                exit_mode="CORE", summary="",
            )


class ResearchCoreTest(unittest.TestCase):
    def test_the_drawdown_gate_never_fires(self):
        """2026-08-10 기준선은 고점 대비 7%를 찍은 뒤 10년 동안 진입이 없었다.

        포지션이 없으면 자산이 안 움직이고 낙폭도 안 내려가서 영구 잠금이 된다. 연구
        코어에서 이걸 풀지 않으면 실험이 "어느 규칙이 먼저 7%를 찍었나"가 된다.
        """
        for core in RESEARCH_CORES + SLOT_CORES:
            with self.subTest(core=core.name):
                gate = account_gate(account(0.50), core.policy)
                self.assertFalse(gate.blocked)
                self.assertFalse(gate.halt)
                self.assertEqual(gate.quantity_factor, 1.0)

    def test_the_baseline_still_locks_up(self):
        """기준선은 그대로다. 완화는 연구 코어에만 걸린다."""
        gate = account_gate(account(0.08), CORE1.policy)
        self.assertTrue(gate.blocked)

    def test_only_the_drawdown_limits_were_relaxed(self):
        """일일·주간 손실 한도와 나머지 한도는 기준선과 같아야 한다."""
        drawdown_fields = {
            "drawdown_quantity_cut",
            "drawdown_block_entries",
            "drawdown_halt",
            "drawdown_killswitch",
        }
        baseline = asdict(HardLimits())
        for core in RESEARCH_CORES:
            with self.subTest(core=core.name):
                limits = asdict(core.policy.limits)
                changed = {
                    field for field, value in limits.items() if value != baseline[field]
                }
                self.assertEqual(changed, drawdown_fields)

    def test_the_regime_cannot_lock_the_run_up(self):
        """레짐 낙폭이 두 번째 문이었다. `MARKET`은 계좌를 아예 안 본다."""
        for core in RESEARCH_CORES + SLOT_CORES:
            with self.subTest(core=core.name):
                self.assertEqual(core.regime_mode, "MARKET")
        self.assertEqual(CORE1.regime_mode, "CORE")

    def test_only_three_parameters_moved_from_the_baseline(self):
        """실험이 바꾼 것을 값으로 못 박는다. 모르는 사이 네 번째가 끼면 귀속이 깨진다."""
        baseline = asdict(CORE1.policy.parameters)
        for core in RESEARCH_CORES:
            with self.subTest(core=core.name):
                changed = {
                    field
                    for field, value in asdict(core.policy.parameters).items()
                    if value != baseline[field]
                } - {"max_hold_sessions"}
                self.assertEqual(
                    changed, {"score_weight_rs", "score_weight_trend", "green_max_vol"}
                )
                # 0.30이면 SPY 20일 변동성이 그 위인 세션이 7.3%뿐이라 축이 안 갈린다.
                self.assertEqual(core.policy.parameters.green_max_vol, 0.20)

    def test_the_ranking_is_momentum_alone(self):
        for core in (JT_K21, JT_K42, JT_CORE_EXIT):
            with self.subTest(core=core.name):
                self.assertEqual(core.policy.parameters.score_weight_rs, 1.0)
                self.assertEqual(core.policy.parameters.score_weight_trend, 0.0)
                self.assertEqual(core.entry_mode, "RS_ONLY")

    def test_skip_is_the_frozen_baseline_value_everywhere(self):
        """**skip=5는 어떤 실험에서도 바꾸지 않는다.** J와 달리 예외가 없다."""
        for core in CORES.values():
            with self.subTest(core=core.name):
                self.assertEqual(core.policy.parameters.rs_skip, 5)

    def test_only_declared_variants_move_the_formation_horizon(self):
        """J=63은 core-1의 값이고, 바꾸는 코어는 `J_VARIANTS`에 적힌 것뿐이다.

        PR #12 신호 연구가 challenger를 J126 하나로 줄였다. 목록을 명시로 두지 않으면
        새 J가 조용히 끼어들어 "J를 바꾸는 실험은 하나뿐"이라는 전제가 깨진다.
        """
        for core in CORES.values():
            with self.subTest(core=core.name):
                expected = J_VARIANTS.get(core.name, 63)
                self.assertEqual(core.policy.parameters.rs_lookback, expected)


class RunKwargsTest(unittest.TestCase):
    """**규칙은 코어 파일 안에서만 정의한다.**

    러너가 규칙을 조립하면 새 실험이 조용히 다른 엔진 설정으로 돌고, 그러면 결과를
    견줄 수 없다. `run_kwargs`가 유일한 통로다.
    """

    def test_every_core_builds_a_config(self):
        for core in CORES.values():
            with self.subTest(core=core.name):
                config = BacktestConfig(
                    source_version="v", start="a", end="b", **core.run_kwargs()
                )
                self.assertEqual(config.entry_mode, core.entry_mode)
                self.assertEqual(config.exit_mode, core.exit_mode)
                self.assertEqual(config.regime_mode, core.regime_mode)
                self.assertIs(config.policy, core.policy)

    def test_a_gateless_core_does_not_claim_an_earnings_gate(self):
        """게이트를 끈 채 참을 넘기면 보고서가 거짓말한다."""
        for core in RESEARCH_CORES:
            with self.subTest(core=core.name):
                self.assertFalse(core.require_earnings_calendar)
        self.assertTrue(CORE1.require_earnings_calendar)

    def test_the_rule_fields_are_declared_in_one_place(self):
        """`BacktestConfig`에 규칙을 새로 넣으면 여기서 한 번 답하게 만든다.

        구간·적재분·비용·시나리오는 실행 조건이지 규칙이 아니다. 이 목록이 늘지 않은 채
        새 규칙 노브가 생기면 그것은 코어 밖에 사는 규칙이 된다.
        """
        self.assertEqual(
            set(RULE_FIELDS),
            {
                "policy",
                "entry_mode",
                "exit_mode",
                "regime_mode",
                "require_earnings_calendar",
                "require_sector",
            },
        )
        for field in RULE_FIELDS:
            self.assertIn(field, {f.name for f in fields(BacktestConfig)})


class RandomControlTest(unittest.TestCase):
    """대조군은 **랭킹만** 달라야 한다. 다른 것이 같이 바뀌면 귀속이 깨진다."""

    def test_only_the_ranking_differs_from_k42(self):
        self.assertEqual(
            asdict(JT_RANDOM_K42.policy.parameters),
            asdict(JT_K42.policy.parameters),
        )
        self.assertEqual(JT_RANDOM_K42.exit_mode, JT_K42.exit_mode)
        self.assertEqual(JT_RANDOM_K42.regime_mode, JT_K42.regime_mode)
        self.assertEqual(JT_RANDOM_K42.entry_mode, "RANDOM")
        self.assertEqual(JT_K42.entry_mode, "RS_ONLY")

    def test_the_control_still_has_its_own_signature(self):
        """파라미터가 같아도 서명이 갈려야 보고서를 구별한다."""
        self.assertNotEqual(JT_RANDOM_K42.signature, JT_K42.signature)

    def test_every_k_has_a_control_that_differs_only_in_the_ranking(self):
        """**K마다 대조군이 따로 있어야 한다.**

        K를 늘리면 무작위 선택도 같이 좋아질 수 있다(장기 보유·시장 표류·회전 감소).
        같은 K의 무작위와 견주지 않으면 "보유기간이 좋아진 것"과 "랭킹이 좋아진 것"을
        가를 수 없다.
        """
        for hold, rs, control in K_PAIRS:
            with self.subTest(hold=hold):
                self.assertEqual(
                    asdict(control.policy.parameters), asdict(rs.policy.parameters)
                )
                self.assertEqual(control.policy.parameters.max_hold_sessions, hold)
                self.assertEqual(control.exit_mode, rs.exit_mode)
                self.assertEqual(control.regime_mode, rs.regime_mode)
                self.assertEqual(
                    control.require_earnings_calendar, rs.require_earnings_calendar
                )
                self.assertEqual(control.entry_mode, "RANDOM")
                self.assertEqual(rs.entry_mode, "RS_ONLY")
                self.assertNotEqual(control.signature, rs.signature)


class SingleDifferenceTest(unittest.TestCase):
    """비교하려는 두 코어는 딱 하나만 달라야 한다."""

    def differences(self, left, right) -> set[str]:
        a, b = asdict(left.policy.parameters), asdict(right.policy.parameters)
        return {field for field, value in a.items() if value != b[field]}

    def test_k21_and_k42_differ_only_in_the_holding_period(self):
        self.assertEqual(self.differences(JT_K21, JT_K42), {"max_hold_sessions"})
        self.assertEqual(JT_K21.policy.parameters.max_hold_sessions, 21)
        self.assertEqual(JT_K42.policy.parameters.max_hold_sessions, 42)
        self.assertEqual(JT_K21.exit_mode, JT_K42.exit_mode)

    def test_the_k_ladder_differs_only_in_the_holding_period(self):
        """K=42·63·84는 `max_hold_sessions` 하나만 다르다.

        이것이 깨지면 "K를 늘렸더니 좋아졌다"를 K에 귀속할 수 없다.
        """
        for hold, rs, _ in K_PAIRS:
            with self.subTest(hold=hold):
                self.assertEqual(rs.policy.parameters.max_hold_sessions, hold)
                self.assertEqual(self.differences(JT_K42, rs) - {"max_hold_sessions"}, set())
                self.assertEqual(rs.entry_mode, JT_K42.entry_mode)
                self.assertEqual(rs.exit_mode, JT_K42.exit_mode)

    def test_the_ladder_stops_where_the_signal_study_stopped(self):
        """신호 연구가 잰 가장 긴 지평이 +84다. 그 밖은 근거가 없다."""
        self.assertEqual(max(hold for hold, _, _ in K_PAIRS), 84)

    def test_the_core_exit_run_differs_from_k42_only_in_the_exit(self):
        """K 코어와 core-1 청산의 대비가 성립하려면 진입이 같아야 한다."""
        self.assertEqual(JT_CORE_EXIT.entry_mode, JT_K42.entry_mode)
        self.assertEqual(JT_CORE_EXIT.exit_mode, "CORE")
        self.assertEqual(JT_K42.exit_mode, "FIXED_HOLD")

    def test_the_baseline_keeps_the_blended_score_and_full_gate(self):
        self.assertEqual(CORE1.entry_mode, "CORE")
        self.assertEqual(CORE1.exit_mode, "CORE")
        self.assertEqual(CORE1.policy.parameters.score_weight_trend, 0.40)


if __name__ == "__main__":
    unittest.main()
