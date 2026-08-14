"""포지션 크기와 최소수량 예외. 설계 9.1·9.1.1.

가장 중요한 테스트는 `RiskCeilingTest`다. 9.1.1은 "개별 거래의 실효 위험은 계획
위험(0.25%)을 초과할 수 있으나 항상 명시적 상한(0.5%) 안에 있다"고 약속한다. 그
약속을 여러 계좌 규모와 ATR 조합에서 확인한다.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

TRADING_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TRADING_ROOT))

from backtest.candidates import Candidate  # noqa: E402
from backtest.features import Features  # noqa: E402
from backtest.regime import MAX_EXPOSURE, NEW_ENTRIES, Regime  # noqa: E402
from backtest.policy import PAPER_VALIDATION  # noqa: E402
from core.core1 import PAPER_CORE_V1  # noqa: E402
from backtest.sizing import (  # noqa: E402
    AccountState,
    OpenPosition,
    SizingError,
    size_candidate,
)

LIMITS = PAPER_CORE_V1.limits

TRADE_DATE = "2026-08-06"


def make_candidate(
    *,
    symbol: str = "AAA",
    close: float = 100.0,
    atr: float = 5.0,
    dollar_volume: float = 50_000_000.0,
) -> Candidate:
    features = Features(
        symbol=symbol,
        trade_date=TRADE_DATE,
        rs63_5=0.10,
        trend_quality60=0.20,
        atr14=atr,
        sma50=90.0,
        sma200=80.0,
        realized_vol20=0.18,
        dollar_volume_median20=dollar_volume,
        bars_used=252,
    )
    return Candidate(
        symbol=symbol,
        rank=1,
        score=1.5,
        z_rs63_5=1.5,
        z_trend_quality60=1.5,
        reference_close=close,
        atr14=atr,
        features=features,
        reasons=(),
    )


def make_regime(state: str = "GREEN") -> Regime:
    return Regime(
        state=state,
        max_exposure=MAX_EXPOSURE[state],
        new_entries=NEW_ENTRIES[state],
        above_sma200=state == "GREEN",
        below_sma200_streak=0,
        realized_vol20=0.15,
        drawdown=0.0,
        reasons=(),
    )


def account(equity: float, cash: float | None = None, positions=()) -> AccountState:
    return AccountState(
        equity=equity, cash=equity if cash is None else cash, positions=tuple(positions)
    )


class NormalPathTest(unittest.TestCase):
    """계좌 10만 달러, 위험 0.25%($250), ATR 5 → 손절폭 10 → 25주."""

    def setUp(self):
        self.result = size_candidate(
            make_candidate(), account(100_000.0), make_regime()
        )
        self.intent = self.result.intent

    def test_shares_come_from_the_risk_budget(self):
        self.assertTrue(self.result)
        self.assertEqual(self.intent.shares, 25)
        self.assertEqual(self.intent.binding_constraint, "RISK")

    def test_stop_is_two_atr_below_the_planned_entry(self):
        # 10.1의 최대 추격이 신호 종가 + 0.25 ATR이므로 그 가격으로 계획한다.
        self.assertAlmostEqual(self.intent.planned_entry, 101.25)
        self.assertAlmostEqual(self.intent.stop_distance, 10.0)
        self.assertAlmostEqual(self.intent.initial_stop, 91.25)

    def test_planned_risk_matches_the_profile(self):
        self.assertAlmostEqual(self.intent.planned_risk, 250.0)
        self.assertAlmostEqual(self.intent.planned_risk_fraction, 0.0025)
        self.assertAlmostEqual(self.intent.effective_risk_ratio, 1.0)
        self.assertFalse(self.intent.min_qty_exception)

    def test_shares_are_integers_and_never_rounded_up(self):
        self.assertIsInstance(self.intent.shares, int)
        # 위험 예산이 25.5주를 허용해도 25주다.
        generous = size_candidate(
            make_candidate(atr=4.9019607843137255), account(100_000.0), make_regime()
        )
        self.assertEqual(generous.intent.shares, 25)

    def test_caps_are_recorded_for_audit(self):
        self.assertEqual(self.result.caps.by_risk, 25)
        self.assertEqual(self.result.caps.by_capital, 118)
        self.assertGreater(self.result.caps.by_liquidity, 25)
        self.assertGreater(self.result.caps.by_exposure, 25)

    def test_result_is_falsy_only_when_rejected(self):
        self.assertTrue(bool(self.result))
        self.assertIsNone(self.result.rejection)


class MinQuantityExceptionTest(unittest.TestCase):
    """계좌 3,600달러에서 고가 종목이 암묵적으로 배제되지 않아야 한다."""

    def test_one_share_is_allowed_inside_the_cap(self):
        # 손절폭 12달러는 위험 예산 9달러보다 크지만 계좌의 0.333%로 상한 안이다.
        result = size_candidate(
            make_candidate(close=300.0, atr=6.0), account(3_600.0), make_regime()
        )
        self.assertTrue(result)
        self.assertEqual(result.intent.shares, 1)
        self.assertTrue(result.intent.min_qty_exception)
        self.assertEqual(result.intent.binding_constraint, "MIN_QTY_EXCEPTION")
        self.assertAlmostEqual(result.intent.planned_risk_fraction, 12.0 / 3_600.0)
        self.assertAlmostEqual(result.intent.effective_risk_ratio, 4.0 / 3.0)
        self.assertEqual(result.caps.by_risk, 0)

    def test_risk_above_the_cap_is_skipped(self):
        result = size_candidate(
            make_candidate(close=500.0, atr=10.0), account(3_600.0), make_regime()
        )
        self.assertFalse(result)
        self.assertEqual(result.rejection.reason, "MIN_QTY_RISK_EXCEEDED")
        self.assertIn("0.5", result.rejection.detail)

    def test_the_cap_boundary_is_inclusive(self):
        # 손절폭 20달러 / 계좌 4,000달러 = 정확히 0.5%.
        result = size_candidate(
            make_candidate(close=400.0, atr=10.0), account(4_000.0), make_regime()
        )
        self.assertTrue(result)
        self.assertEqual(result.intent.shares, 1)
        self.assertAlmostEqual(
            result.intent.planned_risk_fraction, PAPER_VALIDATION.min_qty_risk_cap
        )

    def test_the_exception_is_never_raised_above_one_share(self):
        """상향 금지. 자본이 남아돌아도 1주 고정이다(9.1.1)."""
        result = size_candidate(
            make_candidate(close=300.0, atr=6.0),
            account(3_600.0, cash=1_000_000.0),
            make_regime(),
        )
        self.assertEqual(result.intent.shares, 1)

    def test_reduce_on_an_exception_position_means_no_entry(self):
        """0.75주·0.5주가 없으므로 REDUCE는 미진입이다(9.1.1)."""
        result = size_candidate(
            make_candidate(close=300.0, atr=6.0),
            account(3_600.0),
            make_regime(),
            gate_factor=0.5,
        )
        self.assertFalse(result)
        self.assertEqual(result.rejection.reason, "MIN_QTY_REDUCE_IMPOSSIBLE")


class RiskCeilingTest(unittest.TestCase):
    def test_effective_risk_never_leaves_the_declared_cap(self):
        """계획 위험은 넘을 수 있어도 명시된 상한(0.5%)은 절대 넘지 않는다."""
        regime = make_regime()
        seen_exception = False
        seen_normal = False
        for equity in (3_600.0, 5_000.0, 20_000.0, 100_000.0, 1_000_000.0):
            for atr in (0.5, 2.0, 6.0, 10.0, 25.0):
                for close in (15.0, 120.0, 300.0, 900.0):
                    result = size_candidate(
                        make_candidate(close=close, atr=atr),
                        account(equity),
                        regime,
                    )
                    if not result:
                        continue
                    intent = result.intent
                    self.assertIsInstance(intent.shares, int)
                    self.assertGreaterEqual(intent.shares, 1)
                    self.assertLessEqual(
                        intent.planned_risk_fraction,
                        PAPER_VALIDATION.min_qty_risk_cap + 1e-12,
                        msg=f"equity={equity} atr={atr} close={close}",
                    )
                    self.assertAlmostEqual(
                        intent.planned_risk, intent.shares * intent.stop_distance
                    )
                    if intent.min_qty_exception:
                        seen_exception = True
                        self.assertEqual(intent.shares, 1)
                    else:
                        seen_normal = True
                        self.assertLessEqual(
                            intent.planned_risk_fraction,
                            PAPER_VALIDATION.risk_per_trade + 1e-12,
                        )
        self.assertTrue(seen_exception, "예외 경로가 한 번도 안 걸렸다")
        self.assertTrue(seen_normal, "일반 경로가 한 번도 안 걸렸다")


class BindingConstraintTest(unittest.TestCase):
    def test_capital_binds_when_cash_is_short(self):
        result = size_candidate(
            make_candidate(), account(100_000.0, cash=500.0), make_regime()
        )
        self.assertEqual(result.intent.shares, 4)
        self.assertEqual(result.intent.binding_constraint, "CAPITAL")

    def test_position_weight_binds_before_cash_on_a_full_account(self):
        # 현금 10만 달러가 다 있어도 종목당 비중 12%가 먼저 걸린다.
        result = size_candidate(
            make_candidate(close=1_000.0, atr=1.0), account(100_000.0), make_regime()
        )
        self.assertEqual(
            result.caps.by_capital,
            int(LIMITS.max_position_weight * 100_000.0 // (1_000.0 + 0.25 * 1.0)),
        )
        self.assertEqual(result.intent.shares, result.caps.by_capital)
        self.assertEqual(result.intent.binding_constraint, "CAPITAL")

    def test_liquidity_binds_on_a_thin_name(self):
        result = size_candidate(
            make_candidate(dollar_volume=100_000.0), account(100_000.0), make_regime()
        )
        self.assertEqual(result.intent.binding_constraint, "LIQUIDITY")
        self.assertEqual(
            result.intent.shares,
            int(LIMITS.liquidity_cap_fraction * 100_000.0 // 101.25),
        )

    def test_exposure_binds_when_the_book_is_nearly_full(self):
        held = (OpenPosition("XXX", 590, 100.0, 100.0, 90.0),)  # 59,000달러
        result = size_candidate(
            make_candidate(), account(100_000.0, positions=held), make_regime()
        )
        self.assertEqual(result.intent.binding_constraint, "EXPOSURE")
        self.assertEqual(result.intent.shares, 9)

    def test_yellow_regime_halves_the_exposure_room(self):
        held = (OpenPosition("XXX", 490, 100.0, 100.0, 90.0),)  # 49,000달러
        yellow = size_candidate(
            make_candidate(), account(100_000.0, positions=held), make_regime("YELLOW")
        )
        self.assertEqual(yellow.intent.shares, 9)
        self.assertEqual(yellow.intent.binding_constraint, "EXPOSURE")

        full = size_candidate(
            make_candidate(),
            account(100_000.0, positions=(OpenPosition("XXX", 500, 100.0, 100.0, 90.0),)),
            make_regime("YELLOW"),
        )
        self.assertFalse(full)
        self.assertEqual(full.rejection.reason, "EXPOSURE_ALLOWS_NO_SHARES")


class GateFactorTest(unittest.TestCase):
    def test_gate_reduces_but_records_the_original(self):
        result = size_candidate(
            make_candidate(), account(100_000.0), make_regime(), gate_factor=0.5
        )
        self.assertEqual(result.intent.original_shares, 25)
        self.assertEqual(result.intent.shares, 12)
        self.assertAlmostEqual(result.intent.planned_risk, 120.0)

    def test_gate_cannot_enlarge_the_position(self):
        with self.assertRaises(SizingError):
            size_candidate(
                make_candidate(), account(100_000.0), make_regime(), gate_factor=1.5
            )

    def test_gate_zero_is_no_entry(self):
        result = size_candidate(
            make_candidate(), account(100_000.0), make_regime(), gate_factor=0.0
        )
        self.assertFalse(result)
        self.assertEqual(result.rejection.reason, "REDUCED_TO_ZERO")


class GuardTest(unittest.TestCase):
    def test_zero_equity_is_a_caller_error(self):
        with self.assertRaises(SizingError):
            size_candidate(make_candidate(), account(0.0), make_regime())

    def test_zero_atr_is_rejected_not_divided_by(self):
        result = size_candidate(
            make_candidate(atr=0.0), account(100_000.0), make_regime()
        )
        self.assertFalse(result)
        self.assertEqual(result.rejection.reason, "INVALID_STOP_DISTANCE")

    def test_profile_cap_is_twice_the_planned_risk(self):
        self.assertAlmostEqual(PAPER_VALIDATION.min_qty_risk_cap, 0.005)
        self.assertAlmostEqual(
            PAPER_VALIDATION.min_qty_risk_cap, 2 * PAPER_VALIDATION.risk_per_trade
        )

    def test_sizing_is_deterministic(self):
        first = size_candidate(make_candidate(), account(100_000.0), make_regime())
        second = size_candidate(make_candidate(), account(100_000.0), make_regime())
        self.assertEqual(first.intent, second.intent)
        self.assertEqual(first.caps, second.caps)


if __name__ == "__main__":
    unittest.main()
