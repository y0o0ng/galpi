"""PR #20 Stage A의 사전등록 구조와 판정.

**가장 중요한 것은 넷이다.**

1. `ReuseTest` — PR #17의 paired 구조·binding label·HARD A~E를 **재사용**한다. 새 평가
   철학을 만들면 두 연구를 견줄 수 없다.
2. `FrozenTest` — J·skip·ID window·threshold·horizon·TOP_N·시드가 사전등록 값 그대로다.
3. `VerdictTest` — 승격은 다섯 기준 **전부**를 요구한다. 하나라도 FAIL이면 승격이 아니다.
4. `StageGateTest` — **Stage A가 FAIL이면 Stage B가 존재하지 않아야 한다.** 신호가 죽은
   뒤 포트폴리오를 도는 사고를 코드 수준에서 막는다.
"""

from __future__ import annotations

import itertools
import sys
import unittest
from pathlib import Path

TRADING_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TRADING_ROOT))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from backtest.holdout import HOLDOUT_START  # noqa: E402
from backtest.modes import ENTRY_MODES  # noqa: E402
from core import CORES  # noqa: E402
from selftest import absolute_momentum_signal as abs_study  # noqa: E402
from selftest import fip_signal_study as fip  # noqa: E402


class FrozenTest(unittest.TestCase):
    """**사전등록 값을 결과 뒤에 바꾸지 않는다.**"""

    def test_the_formation_interval_matches_the_frozen_alpha(self):
        self.assertEqual(fip.J, 126)
        self.assertEqual(fip.SKIP, 5)
        self.assertEqual(fip.ID_LOOKBACK, fip.J)
        self.assertEqual(fip.ID_SKIP, fip.SKIP)

    def test_the_threshold_is_the_sign_boundary(self):
        """`0`은 최적화한 숫자가 아니라 ID의 자연스러운 부호 경계다."""
        self.assertEqual(fip.ID_THRESHOLD, 0.0)

    def test_the_primary_horizon_is_only_plus_42(self):
        self.assertEqual(fip.HORIZON, 42)
        self.assertEqual(fip.PHASE_COUNT, fip.HORIZON)

    def test_the_basket_size_and_universes_are_unchanged(self):
        self.assertEqual(fip.TOP_N, 5)
        self.assertEqual(fip.PRIMARY_UNIVERSE, "ALL")
        self.assertEqual(fip.UNIVERSES["ALL"], ("SP500", "NDX100"))
        self.assertEqual(fip.UNIVERSES["NDX100"], ("NDX100",))
        self.assertEqual(set(fip.UNIVERSES), {"ALL", "NDX100"})

    def test_the_random_seeds_are_exactly_zero_through_nineteen(self):
        self.assertEqual(fip.RANDOM_SEEDS, tuple(range(20)))

    def test_it_only_reads_up_dates(self):
        self.assertEqual(fip.MARKET_GROUP, "UP")


class ReuseTest(unittest.TestCase):
    """**PR #17의 구조를 그대로 쓴다.** 복제하면 판정 철학이 갈린다."""

    def test_the_paired_accumulator_is_the_same_class(self):
        self.assertIs(fip.Paired, abs_study.Paired)

    def test_the_basket_and_ordering_helpers_are_shared(self):
        self.assertIs(fip.top_n, abs_study.top_n)
        self.assertIs(fip.basket_excess, abs_study.basket_excess)

    def test_the_binding_label_and_phase_minimum_are_shared(self):
        self.assertIs(fip.binding_label, abs_study.binding_label)
        self.assertEqual(
            fip.PHASE_POSITIVE_SHARE_MINIMUM, abs_study.PHASE_POSITIVE_SHARE_MINIMUM
        )
        self.assertEqual(fip.PHASE_POSITIVE_SHARE_MINIMUM, 0.60)

    def test_the_hard_criteria_names_match_pr17(self):
        """다섯 기준의 **조건 문구**가 PR #17과 같아야 한다."""
        primary = _payload()
        ours = fip.hard_verdicts(primary, _payload())
        theirs = abs_study.hard_verdicts(_payload(), _payload())
        for key in "ABCDE":
            with self.subTest(key=key):
                self.assertEqual(ours[key]["name"], theirs[key]["name"])

    def test_the_verdict_labels_are_this_prs_own(self):
        """구조는 공유하되 label 이름은 이 PR의 것이다."""
        self.assertEqual(fip.PROMOTE, "PROMOTE_FIP_TO_PORTFOLIO")
        self.assertEqual(fip.DO_NOT_PROMOTE, "DO_NOT_TRANSLATE_FIP")
        self.assertNotEqual(fip.PROMOTE, abs_study.PROMOTE)


def _payload(**changes) -> dict:
    base = {
        "binding": {"label": "BINDING", "composition_changed_dates": 0.2},
        "primary": {"mean": 0.001, "median": 0.0},
        "phases": {"positive_share": 0.7, "positive": 30, "valid": 42},
        "by_year": {},
        "leave_one_year_out": {},
    }
    for key, value in changes.items():
        if isinstance(value, dict):
            base[key] = {**base[key], **value}
        else:
            base[key] = value
    return base


class VerdictTest(unittest.TestCase):
    """§15. **다섯 기준 전부여야 승격이다.**"""

    def test_all_five_passing_promotes(self):
        got = fip.hard_verdicts(_payload(), _payload())
        self.assertEqual(got["verdict"], fip.PROMOTE)

    def test_a_non_binding_filter_never_promotes(self):
        got = fip.hard_verdicts(
            _payload(binding={"label": "NON_BINDING", "composition_changed_dates": 0.0}),
            _payload(),
        )
        self.assertFalse(got["A"]["pass"])
        self.assertEqual(got["verdict"], fip.DO_NOT_PROMOTE)

    def test_a_negative_mean_never_promotes(self):
        got = fip.hard_verdicts(_payload(primary={"mean": -0.001}), _payload())
        self.assertFalse(got["B"]["pass"])
        self.assertEqual(got["verdict"], fip.DO_NOT_PROMOTE)

    def test_a_zero_mean_is_not_an_improvement(self):
        """`B`는 `> 0`이다. 0을 통과시키면 무변화가 승격한다."""
        got = fip.hard_verdicts(_payload(primary={"mean": 0.0}), _payload())
        self.assertFalse(got["B"]["pass"])

    def test_a_zero_median_is_allowed(self):
        """`C`는 `>= 0`이다. 구성이 안 바뀐 날짜가 많으면 중앙값이 0이 된다."""
        got = fip.hard_verdicts(_payload(primary={"median": 0.0}), _payload())
        self.assertTrue(got["C"]["pass"])

    def test_the_phase_share_boundary_is_inclusive(self):
        for share, expected in ((0.60, True), (0.5952380952380952, False), (0.61, True)):
            with self.subTest(share=share):
                got = fip.hard_verdicts(
                    _payload(phases={"positive_share": share}), _payload()
                )
                self.assertEqual(got["D"]["pass"], expected)

    def test_a_missing_ndx_run_never_promotes(self):
        got = fip.hard_verdicts(_payload(), None)
        self.assertFalse(got["E"]["pass"])
        self.assertEqual(got["verdict"], fip.DO_NOT_PROMOTE)

    def test_a_negative_ndx_mean_never_promotes(self):
        got = fip.hard_verdicts(_payload(), _payload(primary={"mean": -0.001}))
        self.assertFalse(got["E"]["pass"])
        self.assertEqual(got["verdict"], fip.DO_NOT_PROMOTE)

    def test_every_single_failure_blocks_promotion(self):
        failures = {
            "A": {"binding": {"label": "NON_BINDING", "composition_changed_dates": 0.0}},
            "B": {"primary": {"mean": -0.001}},
            "C": {"primary": {"median": -0.001}},
            "D": {"phases": {"positive_share": 0.4}},
        }
        for key, change in failures.items():
            with self.subTest(key=key):
                got = fip.hard_verdicts(_payload(**change), _payload())
                self.assertFalse(got[key]["pass"])
                self.assertEqual(got["verdict"], fip.DO_NOT_PROMOTE)

    def test_the_verdict_is_always_one_of_two(self):
        for mean, median, share, ndx in itertools.product(
            (-0.001, 0.0, 0.001), (-0.001, 0.0), (0.4, 0.6), (-0.001, 0.001)
        ):
            got = fip.hard_verdicts(
                _payload(primary={"mean": mean, "median": median},
                         phases={"positive_share": share}),
                _payload(primary={"mean": ndx}),
            )
            self.assertIn(got["verdict"], (fip.PROMOTE, fip.DO_NOT_PROMOTE))


class DistributionTest(unittest.TestCase):
    """ID 분포 요약. **보간하지 않는다.**"""

    def test_the_percentiles_are_actual_observations(self):
        got = fip.describe_id([float(value) for value in range(1, 11)])
        self.assertEqual(got["count"], 10)
        self.assertAlmostEqual(got["p10"], 1.0)
        self.assertAlmostEqual(got["p90"], 9.0)

    def test_an_empty_group_is_a_table_not_a_crash(self):
        got = fip.describe_id([])
        self.assertEqual(got["count"], 0)
        self.assertIsNone(got["median"])
        self.assertIsNone(got["p25"])

    def test_the_reported_percentiles_are_the_preregistered_four(self):
        self.assertEqual(fip.ID_PERCENTILES, (10, 25, 75, 90))


class ArtifactTest(unittest.TestCase):
    """실제 산출물이 사전등록한 경계를 지켰는가."""

    @classmethod
    def setUpClass(cls):
        cls.all = fip.load("ALL")
        cls.ndx = fip.load("NDX100")

    def test_both_universes_were_run(self):
        self.assertIsNotNone(self.all)
        self.assertIsNotNone(self.ndx)

    def test_the_forward_target_never_crosses_the_holdout(self):
        """**신호일만 자르면 `t+42`가 홀드아웃을 읽는다.** 목표일까지 확인한다."""
        for run in (self.all, self.ndx):
            with self.subTest(universe=run["universe"]):
                self.assertLess(run["max_signal_date"], HOLDOUT_START)
                self.assertLess(run["max_forward_target_date"], HOLDOUT_START)

    def test_the_holdout_is_not_consumed(self):
        for run in (self.all, self.ndx):
            with self.subTest(universe=run["universe"]):
                self.assertFalse(run["holdout"]["HOLDOUT_CONSUMED"])

    def test_the_observation_checksum_reproduces_pr17(self):
        """**control은 PR #17과 같은 값이어야 한다.** drift가 있으면 해석하지 않는다."""
        for name in ("ALL", "NDX100"):
            with self.subTest(universe=name):
                earlier = fip.prior_control(name)
                self.assertIsNotNone(earlier)
                self.assertAlmostEqual(
                    fip.load(name)["observation_weighted_control"],
                    earlier["observation_weighted_control"],
                    places=12,
                )

    def test_the_observation_count_is_dates_times_five(self):
        """control TOP5가 항상 정확히 5관측이라는 것의 확인이다."""
        for run in (self.all, self.ndx):
            with self.subTest(universe=run["universe"]):
                self.assertEqual(run["observation_count"], run["dates"] * fip.TOP_N)

    def test_the_paired_dates_match_pr17(self):
        """같은 날짜 집합을 봤는가 — 후보 조건만 다르고 표본은 같아야 한다."""
        for name in ("ALL", "NDX100"):
            with self.subTest(universe=name):
                self.assertEqual(
                    fip.load(name)["dates"], fip.prior_control(name)["dates"]
                )

    def test_the_recorded_parameters_are_the_preregistered_ones(self):
        for run in (self.all, self.ndx):
            with self.subTest(universe=run["universe"]):
                self.assertEqual(run["j"], 126)
                self.assertEqual(run["horizon"], 42)
                self.assertEqual(run["top_n"], 5)
                self.assertEqual(
                    run["id"], {"lookback": 126, "skip": 5, "threshold": 0.0}
                )

    def test_no_treatment_basket_was_backfilled(self):
        """통과 후보가 부족하면 5개 미만으로 둔다. 강제로 채우지 않는다."""
        for run in (self.all, self.ndx):
            with self.subTest(universe=run["universe"]):
                self.assertLessEqual(run["binding"]["basket_size_mean"], fip.TOP_N)


class StageGateTest(unittest.TestCase):
    """**Stage A가 FAIL이면 Stage B는 존재하지 않는다**(사전등록 §16)."""

    def test_the_recorded_verdict_is_readable(self):
        self.assertIn(fip.stage_a_verdict(), (fip.PROMOTE, fip.DO_NOT_PROMOTE))

    def test_stage_b_exists_only_when_stage_a_promotes(self):
        """신호가 죽었는데 포트폴리오 코어가 있으면 사전등록 위반이다."""
        promoted = fip.stage_a_verdict() == fip.PROMOTE
        fip_cores = [name for name in CORES if name.endswith("-fip")]
        fip_modes = [mode for mode in ENTRY_MODES if "FIP" in mode]
        runner = TRADING_ROOT / "selftest" / "fip_portfolio_run.py"
        if promoted:
            self.assertEqual(fip_cores, ["jt-j126-k42-sma200-fip"])
            self.assertTrue(runner.exists())
        else:
            self.assertEqual(fip_cores, [], "Stage A FAIL인데 FIP 코어가 있다")
            self.assertEqual(fip_modes, [], "Stage A FAIL인데 FIP 진입 모드가 있다")
            self.assertFalse(runner.exists(), "Stage A FAIL인데 Stage B 러너가 있다")

    def test_the_existing_entry_modes_are_untouched(self):
        """기존 `CORE`·`RS_ONLY`·`RANDOM`이 그대로다."""
        self.assertEqual(set(ENTRY_MODES), {"CORE", "RS_ONLY", "RANDOM"})

    def test_the_surviving_candidate_core_is_unchanged(self):
        """FIP 때문에 control 코어를 건드리지 않았다."""
        control = CORES["jt-j126-k42-sma200"]
        self.assertEqual(control.entry_mode, "RS_ONLY")
        self.assertEqual(control.exit_mode, "FIXED_HOLD")
        self.assertEqual(control.regime_mode, "TREND_GATE")
        self.assertEqual(control.policy.parameters.rs_lookback, 126)
        self.assertEqual(control.policy.parameters.max_hold_sessions, 42)


class OutcomeTest(unittest.TestCase):
    """§26의 최종 outcome. **넷뿐이고 결과를 본 뒤 만들지 않았다.**"""

    def test_there_are_exactly_four_outcomes(self):
        self.assertEqual(len(fip.OUTCOMES), 4)
        self.assertEqual(len(set(fip.OUTCOMES)), 4)
        self.assertEqual(
            set(fip.OUTCOMES),
            {
                "FIP_SIGNAL_REJECTED",
                "FIP_PORTFOLIO_REJECTED",
                "FIP_IMPROVES_BUT_STRATEGY_FAILS",
                "FIP_PROMOTED_STRATEGY_QUALIFIES",
            },
        )

    def test_a_stage_a_failure_is_outcome_a(self):
        """Stage A가 FAIL이면 나머지 셋은 도달 불가능하다."""
        text = "\n".join(_outcome_lines())
        if fip.stage_a_verdict() == fip.DO_NOT_PROMOTE:
            self.assertIn(fip.OUTCOME_SIGNAL_REJECTED, text)
            for other in fip.OUTCOMES:
                if other != fip.OUTCOME_SIGNAL_REJECTED:
                    self.assertNotIn(other, text, other)

    def test_the_report_never_claims_unmeasured_stage_b_numbers(self):
        """**재지 않은 것을 잰 것처럼 적지 않는다.**"""
        if fip.stage_a_verdict() != fip.DO_NOT_PROMOTE:
            self.skipTest("Stage A가 승격이라 Stage B 절이 실제 값을 담는다")
        text = "\n".join(_outcome_lines())
        self.assertIn("해당 없음", text)
        for word in ("MARGINAL_PASS**", "final strategy gate PASS"):
            self.assertNotIn(word, text, word)


def _outcome_lines() -> list[str]:
    return fip._outcome(fip.load("ALL"), fip.load("NDX100"))


class ScopeTest(unittest.TestCase):
    """**사전등록 §28의 금지 목록.**"""

    SOURCE = (TRADING_ROOT / "selftest" / "fip_signal_study.py").read_text(
        encoding="utf-8"
    )
    FEATURES = (TRADING_ROOT / "backtest" / "features.py").read_text(encoding="utf-8")

    def test_no_threshold_or_window_sweep(self):
        for word in ("THRESHOLDS", "ID_THRESHOLDS", "sweep", "percentile_threshold",
                     "tercile", "quintile", "decile"):
            self.assertNotIn(word, self.SOURCE, word)

    def test_no_composite_score(self):
        """`RS × ID` · `RS − λID` · `z(ID)`를 만들지 않는다."""
        for word in ("lambda_", "composite", "z_id", "rs_times_id", "rs_minus"):
            self.assertNotIn(word, self.SOURCE, word)

    def test_no_abs_condition_is_bundled(self):
        """§6 — `PRET > 0`을 조건으로 걸면 intervention이 둘이 된다.

        `prets`는 **진단으로만** 쓴다. 후보 조건은 `discreteness < ID_THRESHOLD` 하나다.
        """
        self.assertIn("if discreteness < ID_THRESHOLD:", self.SOURCE)
        for word in ("if own > ", "and own > 0", "prets[symbol] > 0"):
            self.assertNotIn(word, self.SOURCE, word)

    def test_no_other_quality_filter(self):
        for word in ("trend_quality", "breakout", "adx", "rsi", "macd",
                     "volume_filter", "fifty_two_week"):
            self.assertNotIn(word, self.SOURCE, word)

    def test_the_holdout_is_not_consumed(self):
        self.assertNotIn("consume_holdout", self.SOURCE)
        self.assertIn("assert_no_holdout", self.SOURCE)

    def test_the_features_schema_was_not_extended(self):
        """**`Features` dataclass와 `features_daily`에 FIP field를 넣지 않았다**(§7).

        넣으면 `feature_hash`가 바뀌어 기존 캐시와 과거 산출물이 흔들린다.
        """
        from backtest.features import Features

        names = {field for field in Features.__dataclass_fields__}
        for word in ("information_discreteness", "id126_5", "fip"):
            self.assertNotIn(word, names, word)
        self.assertNotIn("information_discreteness", self.FEATURES.split('"""')[0])
        # 스키마 INSERT 문에도 들어가면 안 된다.
        insert = self.FEATURES[self.FEATURES.index("INSERT OR REPLACE INTO features_daily"):]
        self.assertNotIn("discreteness", insert)


if __name__ == "__main__":
    unittest.main()
