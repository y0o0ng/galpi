"""PolicyVersion. 설계 1.4·9.2.

9.2는 "에이전트·Governor·브로커 어댑터 어느 구성요소도 런타임에 상향할 수 없다"고
못박는다. 이 테스트는 그 문장을 세 방향에서 확인한다. 정책 객체가 불변인지, 저장된
값이 바뀌면 기동을 거부하는지, 활성 정책이 broker_mode마다 하나인지다.
"""

from __future__ import annotations

import dataclasses
import json
import sqlite3
import sys
import unittest
from pathlib import Path

TRADING_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TRADING_ROOT))

from backtest import store  # noqa: E402
from backtest.features import STRATEGY_VERSION  # noqa: E402
from backtest.policy import (  # noqa: E402
    PAPER_VALIDATION,
    HardLimits,
    PolicyError,
    PolicyVersion,
    RiskProfile,
    StrategyParameters,
    activate_policy,
    load_active_policy,
)
from core.core1 import PAPER_CORE_V1  # noqa: E402


class LimitValuesTest(unittest.TestCase):
    def test_default_limits_match_the_initial_autonomous_column(self):
        limits = HardLimits()
        self.assertAlmostEqual(limits.max_position_weight, 0.12)
        self.assertEqual(limits.max_positions, 5)
        self.assertAlmostEqual(limits.max_sector_weight, 0.25)
        self.assertAlmostEqual(limits.max_total_planned_risk, 0.0125)
        self.assertAlmostEqual(limits.correlation_threshold, 0.75)
        self.assertAlmostEqual(limits.max_correlated_pair_weight, 0.25)
        self.assertAlmostEqual(limits.daily_loss_limit, 0.010)
        self.assertAlmostEqual(limits.weekly_loss_limit, 0.025)
        self.assertAlmostEqual(limits.drawdown_block_entries, 0.07)
        self.assertAlmostEqual(limits.drawdown_halt, 0.10)

    def test_profile_matches_paper_validation(self):
        self.assertAlmostEqual(PAPER_VALIDATION.risk_per_trade, 0.0025)
        self.assertAlmostEqual(PAPER_VALIDATION.max_exposure, 0.60)
        self.assertAlmostEqual(PAPER_VALIDATION.min_qty_risk_cap, 0.005)

    def test_min_qty_cap_follows_the_profile(self):
        """9.1.1: 계좌의 0.5%, 단 계획 위험의 2배를 상한으로."""
        tight = RiskProfile(name="T", risk_per_trade=0.001, max_exposure=0.5)
        self.assertAlmostEqual(tight.min_qty_risk_cap, 0.002)
        loose = RiskProfile(name="L", risk_per_trade=0.005, max_exposure=1.0)
        self.assertAlmostEqual(loose.min_qty_risk_cap, 0.005)


class ImmutabilityTest(unittest.TestCase):
    def test_limits_cannot_be_raised_at_runtime(self):
        for target, field, value in (
            (PAPER_CORE_V1.limits, "max_position_weight", 0.99),
            (PAPER_CORE_V1.profile, "risk_per_trade", 0.05),
            (PAPER_CORE_V1, "policy_id", "sneaky"),
        ):
            with self.assertRaises(dataclasses.FrozenInstanceError):
                setattr(target, field, value)

    def test_live_broker_mode_is_refused(self):
        with self.assertRaises(PolicyError):
            PolicyVersion(
                policy_id="live-1", profile=PAPER_VALIDATION, broker_mode="LIVE"
            )


class FreezeTest(unittest.TestCase):
    """**`paper-core-v1`은 동결됐다(2026-08-11 사용자 결정).**

    2026-08-10 15년 판정의 기준선이고 그 실행이 `trading/runs/`에 남아 있다. 규칙이 열둘
    겹쳐 귀속이 안 되므로 다음 단계는 베이스라인에서 하나씩 얹는 ablation이고, 그러려면
    **비교의 기준이 움직이면 안 된다.**

    위 `SignatureTest`는 서명이 한 실행 안에서 안정적인지만 본다. 기본값을 하나 고치면
    서명이 바뀌어도 그 테스트는 통과한다. 여기서 값을 못 박아 **기준선이 조용히 움직이는
    것**을 막는다.

    ablation은 이 정책을 고치지 말고 `parameter_variant`나 새 `PolicyVersion`으로 만든다.
    정말 기준선을 옮겨야 하면 이 상수와 아래 근거를 함께 고치고, 옛 서명으로 낸 보고서는
    더 이상 비교 대상이 아니라는 것을 알고 하는 것이다.
    """

    # 2026-08-10 실행 `paper-core-v1-2007-01-04-2026-08-07`의 서명.
    # 판정 FAIL·blocker 없음, 기대값 -0.046R, 518거래.
    FROZEN = "sha256:9e06ee99a9086073d88b20a8a47457a8c6c27942eacb6e52b582508927450208"

    def test_the_baseline_policy_is_frozen(self):
        self.assertEqual(PAPER_CORE_V1.policy_id, "paper-core-v1")
        self.assertEqual(PAPER_CORE_V1.strategy_version, "core-v2.3")
        self.assertEqual(PAPER_CORE_V1.signature, self.FROZEN)

    def test_a_variant_does_not_disturb_the_baseline(self):
        """ablation은 사본으로 한다. 원본이 그대로여야 비교가 성립한다."""
        variant = dataclasses.replace(
            PAPER_CORE_V1,
            parameters=dataclasses.replace(
                PAPER_CORE_V1.parameters, atr_window=12
            ),
        )
        self.assertNotEqual(variant.signature, self.FROZEN)
        self.assertEqual(PAPER_CORE_V1.signature, self.FROZEN)


class SignatureTest(unittest.TestCase):
    def test_signature_is_stable_and_covers_the_numbers(self):
        first = PAPER_CORE_V1.signature
        again = dataclasses.replace(PAPER_CORE_V1).signature
        self.assertEqual(first, again)
        self.assertTrue(first.startswith("sha256:"))

        # 주석만 바뀌면 같은 정책이다.
        renoted = dataclasses.replace(PAPER_CORE_V1, note="다른 메모")
        self.assertEqual(renoted.signature, first)

        # 한도가 바뀌면 다른 정책이다.
        loosened = dataclasses.replace(
            PAPER_CORE_V1, limits=HardLimits(max_position_weight=0.20)
        )
        self.assertNotEqual(loosened.signature, first)

        # 승인자가 바뀌면 다른 정책이다.
        reapproved = dataclasses.replace(PAPER_CORE_V1, approved_by="someone")
        self.assertNotEqual(reapproved.signature, first)

    def test_canonical_text_is_sorted_json(self):
        payload = json.loads(PAPER_CORE_V1.canonical_text)
        self.assertEqual(payload["broker_mode"], "PAPER")
        self.assertEqual(payload["strategy_version"], STRATEGY_VERSION)
        self.assertEqual(payload["profile"]["name"], "PAPER_VALIDATION")
        self.assertNotIn("note", payload)


class PersistenceTest(unittest.TestCase):
    def setUp(self):
        self.connection = store.connect_memory()

    def test_activate_then_load_round_trip(self):
        activate_policy(self.connection, PAPER_CORE_V1)
        loaded = load_active_policy(self.connection)
        self.assertEqual(loaded, PAPER_CORE_V1)
        self.assertEqual(loaded.signature, PAPER_CORE_V1.signature)

    def test_missing_policy_is_an_error_not_a_default(self):
        with self.assertRaises(PolicyError):
            load_active_policy(self.connection)

    def test_tampered_limits_refuse_to_load(self):
        """DB에서 한도를 올려도 서명이 맞지 않아 기동하지 않는다."""
        activate_policy(self.connection, PAPER_CORE_V1)
        raised = dataclasses.asdict(HardLimits(max_total_planned_risk=0.50))
        with self.connection:
            self.connection.execute(
                "UPDATE policy_versions SET limits = ?",
                (json.dumps(raised, sort_keys=True),),
            )
        with self.assertRaises(PolicyError) as caught:
            load_active_policy(self.connection)
        self.assertIn("서명", str(caught.exception))

    def test_activating_a_new_policy_retires_the_old_one(self):
        activate_policy(self.connection, PAPER_CORE_V1)
        tighter = PolicyVersion(
            policy_id="paper-core-v2",
            profile=PAPER_VALIDATION,
            limits=HardLimits(max_positions=3),
        )
        activate_policy(self.connection, tighter)
        self.assertEqual(load_active_policy(self.connection).policy_id, "paper-core-v2")
        rows = self.connection.execute(
            "SELECT policy_id, active FROM policy_versions ORDER BY policy_id"
        ).fetchall()
        self.assertEqual(
            [(row["policy_id"], row["active"]) for row in rows],
            [("paper-core-v1", 0), ("paper-core-v2", 1)],
        )

    def test_two_active_policies_cannot_coexist(self):
        activate_policy(self.connection, PAPER_CORE_V1)
        with self.assertRaises(sqlite3.IntegrityError):
            self.connection.execute(
                "INSERT INTO policy_versions (policy_id, broker_mode, strategy_version,"
                " risk_profile, profile, limits, signature, approved_by, active)"
                " VALUES ('other','PAPER','x','y','{}','{}','sha256:z','user',1)"
            )

    def test_live_rows_are_refused_by_the_schema(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.connection.execute(
                "INSERT INTO policy_versions (policy_id, broker_mode, strategy_version,"
                " risk_profile, profile, limits, signature, approved_by)"
                " VALUES ('live','LIVE','x','y','{}','{}','sha256:z','user')"
            )


class MinHistoryInvariantTest(unittest.TestCase):
    """창을 줄인 정책이 "조용히 아무것도 안 하는" 실행이 되지 않게 막는다.

    `classify_regime`은 SMA200 아래 연속일을 세려고 `sma_slow + below_sma_red_streak - 1`
    개의 바가 필요한데 요청 개수는 `min_history_sessions`이다. 그래서 이력 하한이
    `sma_slow`와 같기만 하면 시장 상태 판정이 전 세션 `SHORT_HISTORY`로 떨어진다.
    2026-08-06 무료 1년 데이터 실행에서 145세션 전부가 그렇게 빠졌다.
    """

    def test_history_floor_must_cover_the_sma_streak(self):
        with self.assertRaises(PolicyError):
            StrategyParameters(sma_slow=100, min_history_sessions=100)

    def test_history_floor_that_covers_the_streak_is_accepted(self):
        parameters = StrategyParameters(sma_slow=100, min_history_sessions=102)
        self.assertEqual(parameters.min_history_sessions, 102)

    def test_default_parameters_still_satisfy_the_invariant(self):
        parameters = StrategyParameters()
        self.assertGreaterEqual(
            parameters.min_history_sessions,
            parameters.sma_slow + parameters.below_sma_red_streak - 1,
        )


if __name__ == "__main__":
    unittest.main()
