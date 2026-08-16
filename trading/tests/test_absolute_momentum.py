"""PR #17 ABS 후보 조건의 계산과 사전등록 판정.

**가장 중요한 것은 셋이다.**

1. `DefinitionTest` — `ABS`와 `RS`가 같은 산술을 공유한다. 복제하면 "같은 형성기간"이라던
   두 신호가 조용히 다른 것을 재게 된다.
2. `FilterTest` — 필터가 **후보 조건**이지 TOP5 삭제가 아니다. ABS 음수인 상위가 빠지면
   아래 순위가 올라온다.
3. `PairedTest` — primary가 날짜 단위 paired이고, 유니버스 평균이 `D_t`에서 상쇄된다.
"""

from __future__ import annotations

import math
import statistics
import sys
import unittest
from pathlib import Path

TRADING_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TRADING_ROOT))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from backtest.features import (  # noqa: E402
    FeatureUnavailable,
    absolute_momentum,
    relative_strength,
)
from selftest.absolute_momentum_signal import (  # noqa: E402
    ABS_LOOKBACK,
    ABS_SKIP,
    ABS_THRESHOLD,
    BINDING_LABELS,
    BINDING_LOW,
    DO_NOT_PROMOTE,
    HORIZON,
    J,
    LABEL_BINDING,
    LABEL_LOW_BINDING,
    LABEL_NON_BINDING,
    MARKET_GROUP,
    PHASE_POSITIVE_SHARE_MINIMUM,
    PROMOTE,
    RANDOM_SEEDS,
    SKIP,
    TOP_N,
    UNIVERSES,
    Paired,
    basket_excess,
    binding_label,
    concentration_label,
    hard_verdicts,
    top_n,
)


def _series(count: int, drift: float, start: float = 100.0) -> list[float]:
    return [start * math.exp(drift * i) for i in range(count)]


class DefinitionTest(unittest.TestCase):
    """**ABS와 RS는 같은 산술을 공유한다.**"""

    def test_abs_is_the_own_term_of_rs(self):
        values = _series(300, 0.001)
        self.assertAlmostEqual(
            absolute_momentum(values, ABS_LOOKBACK, ABS_SKIP),
            math.log(values[-(ABS_SKIP + 1)] / values[-(ABS_LOOKBACK + 1)]),
            places=15,
        )

    def test_rs_is_abs_own_minus_abs_market(self):
        """리팩터가 RS 값을 바꾸지 않았다는 것을 값으로 잠근다."""
        values, reference = _series(300, 0.0012), _series(300, 0.0007, 400.0)
        self.assertEqual(
            relative_strength(values, reference, J, SKIP),
            absolute_momentum(values, J, SKIP)
            - absolute_momentum(reference, J, SKIP),
        )

    def test_a_flat_series_has_zero_absolute_momentum(self):
        self.assertAlmostEqual(absolute_momentum([100.0] * 300, ABS_LOOKBACK, ABS_SKIP), 0.0)

    def test_short_history_raises(self):
        with self.assertRaises(FeatureUnavailable):
            absolute_momentum(_series(100, 0.001), ABS_LOOKBACK, ABS_SKIP)

    def test_the_skip_window_is_excluded(self):
        """마지막 `skip`일의 움직임은 ABS에 들어가지 않는다."""
        values = _series(300, 0.001)
        moved = list(values)
        for offset in range(ABS_SKIP):
            moved[-(offset + 1)] *= 5.0
        self.assertAlmostEqual(
            absolute_momentum(values, ABS_LOOKBACK, ABS_SKIP),
            absolute_momentum(moved, ABS_LOOKBACK, ABS_SKIP),
            places=15,
        )


class ConstantsTest(unittest.TestCase):
    """**사전등록한 고정 변수.** 결과를 보고 바꾸지 않는다."""

    def test_abs_matches_the_formation_window(self):
        self.assertEqual(ABS_LOOKBACK, J)
        self.assertEqual(ABS_SKIP, SKIP)
        self.assertEqual((J, SKIP), (126, 5))

    def test_the_threshold_is_exactly_zero(self):
        """문턱 사다리를 만들지 않는다. 0.02·0.05를 탐색하지 않는다."""
        self.assertEqual(ABS_THRESHOLD, 0.0)

    def test_horizon_selection_and_seeds(self):
        self.assertEqual(HORIZON, 42)
        self.assertEqual(TOP_N, 5)
        self.assertEqual(RANDOM_SEEDS, tuple(range(20)))

    def test_only_up_dates(self):
        """시장 조건은 PR #16에서 살아남았다. 다시 비교하지 않는다."""
        self.assertEqual(MARKET_GROUP, "UP")

    def test_two_universes(self):
        self.assertEqual(UNIVERSES["ALL"], ("SP500", "NDX100"))
        self.assertEqual(UNIVERSES["NDX100"], ("NDX100",))

    def test_preregistered_thresholds(self):
        self.assertAlmostEqual(BINDING_LOW, 0.05)
        self.assertAlmostEqual(PHASE_POSITIVE_SHARE_MINIMUM, 0.60)


class FilterTest(unittest.TestCase):
    """**필터는 후보 조건이지 TOP5 삭제가 아니다.**"""

    def ranked(self) -> list[tuple[float, str]]:
        # RS 내림차순으로 A..H.
        return [(8.0 - index, chr(ord("A") + index)) for index in range(8)]

    def test_control_takes_the_first_five(self):
        self.assertEqual(top_n(self.ranked()), list("ABCDE"))

    def test_a_failing_candidate_lets_a_lower_rank_in(self):
        """**ABS 음수인 RS 2등이 빠지면 RS 6등이 들어온다.** 지우기만 하면 4개가 된다."""
        survivors = [item for item in self.ranked() if item[1] != "B"]
        self.assertEqual(top_n(survivors), list("ACDEF"))
        self.assertEqual(len(top_n(survivors)), TOP_N)

    def test_a_short_pool_is_not_backfilled(self):
        """ABS 통과가 5개 미만이면 그대로 둔다. 음수 종목으로 채우지 않는다."""
        self.assertEqual(top_n(self.ranked()[:3]), list("ABC"))
        self.assertEqual(top_n([]), [])

    def test_surviving_control_members_always_stay(self):
        """**필터는 순서를 바꾸지 않는다.** control TOP5 중 통과한 것은 반드시 남는다.

        그래서 "ABS 때문에 빠진 종목"과 "ABS 미달 종목"이 같은 집합이고 교체율 정의가
        유일해진다.
        """
        ranked = self.ranked()
        for failing in ("A", "C", "E"):
            survivors = [item for item in ranked if item[1] != failing]
            control, treated = set(top_n(ranked)), set(top_n(survivors))
            for symbol in control - {failing}:
                self.assertIn(symbol, treated, symbol)

    def test_ties_break_on_symbol(self):
        """같은 입력에 같은 순서가 나와야 한다(3.1)."""
        self.assertEqual(top_n([(1.0, "B"), (1.0, "A"), (1.0, "C")]), ["A", "B", "C"])


class PairedTest(unittest.TestCase):
    """primary는 날짜 단위 paired다."""

    def test_the_universe_mean_cancels_in_the_difference(self):
        """**ABS는 후보 조건이지 유니버스 변경이 아니다.**

        두 팔이 같은 유니버스 평균을 쓰므로 `D_t`는 두 바구니의 raw forward 평균 차이다.
        """
        forwards = {"A": 0.10, "B": -0.05, "C": 0.02, "D": 0.30}
        for universe_mean in (0.0, 0.05, -0.2):
            control = basket_excess(["A", "B"], forwards, universe_mean)
            treated = basket_excess(["A", "C"], forwards, universe_mean)
            self.assertAlmostEqual(
                treated - control,
                statistics.fmean([0.10, 0.02]) - statistics.fmean([0.10, -0.05]),
            )

    def test_a_basket_without_forward_is_undefined(self):
        self.assertIsNone(basket_excess(["Z"], {"A": 0.1}, 0.0))
        self.assertIsNone(basket_excess([], {"A": 0.1}, 0.0))

    def test_identical_baskets_give_zero_difference(self):
        """구성이 같으면 `D_t = 0`이다 — `LOW_BINDING`에서 중앙값이 0이 되는 이유."""
        forwards = {"A": 0.1, "B": 0.2}
        value = basket_excess(["A", "B"], forwards, 0.05)
        self.assertAlmostEqual(value - value, 0.0)

    def test_paired_accumulates_differences(self):
        paired = Paired()
        paired.add(0.01, 0.03)
        paired.add(0.02, 0.01)
        summary = paired.summary()
        self.assertEqual(summary["dates"], 2)
        self.assertAlmostEqual(summary["mean"], statistics.fmean([0.02, -0.01]))
        self.assertAlmostEqual(summary["control_mean"], 0.015)
        self.assertAlmostEqual(summary["treatment_mean"], 0.02)
        self.assertAlmostEqual(summary["positive_share"], 0.5)

    def test_an_empty_paired_is_all_none(self):
        summary = Paired().summary()
        self.assertEqual(summary["dates"], 0)
        for key in ("mean", "median", "positive_share", "min", "max"):
            self.assertIsNone(summary[key])


class BindingTest(unittest.TestCase):
    """§9. **5%는 해석 label이지 promotion threshold가 아니다.**"""

    def test_zero_change_is_non_binding(self):
        self.assertEqual(binding_label(0.0), LABEL_NON_BINDING)
        self.assertEqual(binding_label(None), LABEL_NON_BINDING)

    def test_the_five_percent_boundary(self):
        self.assertEqual(binding_label(0.0499), LABEL_LOW_BINDING)
        self.assertEqual(binding_label(0.05), LABEL_BINDING)
        self.assertEqual(binding_label(0.5), LABEL_BINDING)

    def test_every_label_is_registered(self):
        for share in (0.0, 0.001, 0.049, 0.05, 1.0):
            self.assertIn(binding_label(share), BINDING_LABELS)


def _payload(**changes) -> dict:
    base = {
        "changed": 0.20,
        "mean": 0.004,
        "median": 0.0,
        "positive_share": 0.75,
    }
    base.update(changes)
    return {
        "binding": {
            "label": binding_label(base["changed"]),
            "composition_changed_dates": base["changed"],
        },
        "primary": {"mean": base["mean"], "median": base["median"]},
        "phases": {
            "positive_share": base["positive_share"],
            "positive": 32,
            "valid": 42,
        },
        "by_year": {},
        "leave_one_year_out": {},
    }


def _ndx(mean) -> dict:
    return {"primary": {"mean": mean}}


class HardVerdictTest(unittest.TestCase):
    """§11의 HARD A~E. **결과를 본 뒤 바꾸지 않는다.**"""

    def test_all_five_pass_promotes(self):
        verdicts = hard_verdicts(_payload(), _ndx(0.001))
        for key in "ABCDE":
            self.assertTrue(verdicts[key]["pass"], key)
        self.assertEqual(verdicts["verdict"], PROMOTE)

    def test_non_binding_blocks_regardless_of_signal(self):
        """**처치가 아무것도 바꾸지 않았으면 승격하지 않는다.**"""
        verdicts = hard_verdicts(_payload(changed=0.0, mean=0.05), _ndx(0.05))
        self.assertFalse(verdicts["A"]["pass"])
        self.assertEqual(verdicts["verdict"], DO_NOT_PROMOTE)

    def test_low_binding_is_not_auto_rejected(self):
        """`LOW_BINDING`이라도 신호가 강하면 자동 탈락시키지 않는다."""
        verdicts = hard_verdicts(_payload(changed=0.01), _ndx(0.001))
        self.assertTrue(verdicts["A"]["pass"])
        self.assertEqual(verdicts["verdict"], PROMOTE)

    def test_mean_must_be_strictly_positive(self):
        self.assertFalse(hard_verdicts(_payload(mean=0.0), _ndx(0.001))["B"]["pass"])
        self.assertFalse(hard_verdicts(_payload(mean=-0.001), _ndx(0.001))["B"]["pass"])

    def test_median_may_be_zero(self):
        """기준 C는 부호가 뒤집히지 않았다는 최소 확인이다."""
        self.assertTrue(hard_verdicts(_payload(median=0.0), _ndx(0.001))["C"]["pass"])
        self.assertFalse(hard_verdicts(_payload(median=-0.001), _ndx(0.001))["C"]["pass"])

    def test_phase_threshold(self):
        self.assertFalse(
            hard_verdicts(_payload(positive_share=0.59), _ndx(0.001))["D"]["pass"]
        )
        self.assertTrue(
            hard_verdicts(_payload(positive_share=0.60), _ndx(0.001))["D"]["pass"]
        )

    def test_ndx_may_be_zero_but_not_negative(self):
        self.assertTrue(hard_verdicts(_payload(), _ndx(0.0))["E"]["pass"])
        self.assertFalse(hard_verdicts(_payload(), _ndx(-0.0001))["E"]["pass"])

    def test_a_missing_ndx_run_fails(self):
        self.assertFalse(hard_verdicts(_payload(), None)["E"]["pass"])
        self.assertEqual(hard_verdicts(_payload(), None)["verdict"], DO_NOT_PROMOTE)

    def test_any_single_failure_blocks(self):
        for payload, ndx in (
            (_payload(changed=0.0), _ndx(0.001)),
            (_payload(mean=-0.001), _ndx(0.001)),
            (_payload(median=-0.001), _ndx(0.001)),
            (_payload(positive_share=0.1), _ndx(0.001)),
            (_payload(), _ndx(-0.001)),
        ):
            self.assertEqual(hard_verdicts(payload, ndx)["verdict"], DO_NOT_PROMOTE)

    def test_the_verdict_is_one_of_exactly_two(self):
        for mean in (-0.01, 0.0, 0.01):
            for share in (0.0, 0.6, 1.0):
                verdict = hard_verdicts(
                    _payload(mean=mean, positive_share=share), _ndx(mean)
                )["verdict"]
                self.assertIn(verdict, (PROMOTE, DO_NOT_PROMOTE))


class ConcentrationTest(unittest.TestCase):
    def payload(self, mean, loyo, yearly) -> dict:
        return {
            "primary": {"mean": mean},
            "leave_one_year_out": loyo,
            "by_year": {year: {"mean": value} for year, value in yearly.items()},
        }

    def test_broad(self):
        label, _ = concentration_label(
            self.payload(0.004, {"2019": 0.003, "2020": 0.005},
                         {"2019": 0.002, "2020": 0.006})
        )
        self.assertEqual(label, "BROAD")

    def test_concentrated_when_one_year_flips_the_sign(self):
        label, reason = concentration_label(
            self.payload(0.004, {"2019": 0.003, "2020": -0.001},
                         {"2019": 0.002, "2020": 0.050})
        )
        self.assertEqual(label, "CONCENTRATED")
        self.assertIn("2020", reason)

    def test_empty_never_claims_broad(self):
        self.assertEqual(concentration_label(self.payload(None, {}, {}))[0], "MIXED")

    def test_the_label_does_not_feed_the_hard_verdict(self):
        import inspect

        self.assertEqual(
            list(inspect.signature(hard_verdicts).parameters), ["primary", "ndx"]
        )


class ScopeTest(unittest.TestCase):
    """**이 PR은 신호 층에 머무른다.**"""

    def source(self) -> str:
        return (
            TRADING_ROOT / "selftest" / "absolute_momentum_signal.py"
        ).read_text()

    def test_no_portfolio_backtest(self):
        source = self.source()
        for forbidden in ("run_backtest", "BacktestConfig", "CoreDefinition", "jt_policy"):
            self.assertNotIn(forbidden, source, forbidden)

    def test_no_new_core_registered(self):
        from core import CORES

        self.assertEqual([name for name in CORES if "abs" in name.lower()], [])

    def test_no_threshold_or_horizon_ladder(self):
        """사다리를 만들지 않았다."""
        source = self.source()
        for forbidden in ("ABS63", "ABS189", "THRESHOLDS", "LOOKBACKS"):
            self.assertNotIn(forbidden, source, forbidden)

    def test_no_holdout_consumption(self):
        source = self.source()
        self.assertNotIn("consume_holdout=True", source)
        self.assertNotIn("--consume-holdout", source)

    def test_it_reuses_the_canonical_helpers(self):
        source = self.source()
        for name in (
            "absolute_momentum",
            "_eligible",
            "forward_return",
            "classify_market_regime",
            "research_calendar",
            "random_score",
        ):
            self.assertIn(name, source, name)
        self.assertNotIn("def relative_strength", source)
        self.assertNotIn("def forward_return", source)


if __name__ == "__main__":
    unittest.main(verbosity=1)
