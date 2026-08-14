"""실행 보고서. 픽스처로만 확인한다 — 렌더러는 순수 함수다.

가장 중요한 테스트는 `test_a_blocked_run_says_so_before_any_number`다. blocker가 있는
실행의 지표를 나중에 누가 성과로 인용하는 것이 이 프로젝트가 가장 경계해온 실패이고,
보고서는 숫자보다 **그 숫자를 읽어도 되는지**를 먼저 말해야 한다.
"""

from __future__ import annotations

import json
import sys
import unittest
from dataclasses import replace
from pathlib import Path

TRADING_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TRADING_ROOT))

from backtest.loop import BacktestConfig, BacktestResult, EquityPoint, Trade  # noqa: E402
from backtest.metrics import Metrics  # noqa: E402
from core.core1 import PAPER_CORE_V1  # noqa: E402
from backtest.report import (  # noqa: E402
    judgment_json,
    judgment_markdown,
    judgment_payload,
    period_performance,
    regime_performance,
)
from backtest.validation import (  # noqa: E402
    Fold,
    GateReport,
    GateRow,
    WalkForwardPlan,
    WalkForwardReport,
    neighbourhood_report,
)


def metrics(**changes) -> Metrics:
    values = dict(
        sessions=4929, trade_count=518, win_rate=0.3938, expectancy_r=-0.0462,
        avg_win_r=1.21, avg_loss_r=-0.862, gross_profit=44608.85, gross_loss=51578.54,
        fees_paid=11851.08, profit_factor=0.8649, initial_equity=100000.0,
        final_equity=93030.31, total_return=-0.0697, cagr=-0.0037, sharpe=-0.1775,
        sortino=-0.2368, max_drawdown=0.0749, calmar=-0.0492, avg_exposure=0.0633,
        min_qty_exception_share=0.0, exit_mix={"INITIAL_STOP": 169, "EARNINGS": 188},
    )
    values.update(changes)
    return Metrics(**values)


def result() -> BacktestResult:
    config = BacktestConfig(
        source_version="eodhd-15y-2026-08",
        start="2007-01-04",
        end="2026-08-07",
        policy=PAPER_CORE_V1,
        index_names=("SP500", "NDX100"),
    )
    return BacktestResult(
        config=config,
        trades=(),
        equity_curve=(),
        open_positions=(),
        fills=(),
        skip_counts={"SMA_NOT_ALIGNED": 935600, "NO_BREAKOUT": 724315},
        fill_counts={"OPEN_FILL": 431},
        exit_counts={"EARNINGS": 188, "INITIAL_STOP": 169},
    )


def point(trade_date: str, equity: float, regime: str) -> EquityPoint:
    return EquityPoint(
        trade_date=trade_date, equity=equity, cash=equity, exposure=0.0,
        drawdown=0.0, regime=regime, market_regime=regime, open_positions=0,
    )


def trade(entry_date: str, exit_date: str, pnl: float) -> Trade:
    return Trade(
        symbol="AAA", entry_date=entry_date, exit_date=exit_date, shares=10,
        entry_price=100.0, exit_price=100.0 + pnl / 10, entry_reason="OPEN_FILL",
        exit_reason="TRAILING_STOP", exit_fill_reason="OPEN_FILL", fees=0.0,
        pnl=pnl, return_r=pnl / 1000, mfe_r=0.0, mae_r=0.0, sessions_held=2,
        min_qty_exception=False,
    )


def curved_result() -> BacktestResult:
    """손으로 검산할 수 있는 자산 곡선. 초기 자본 100,000이다.

    2024는 110,000까지 갔다가 99,000으로 끝나고(해 안 낙폭 10%, 수익률 -1%),
    2025는 108,900으로 끝난다(+10%). 거래는 해를 넘겨 청산하는 것을 하나 둔다.
    """
    return replace(
        result(),
        trades=(
            trade("2024-12-30", "2024-12-31", 2000.0),
            trade("2024-12-31", "2025-01-03", -1000.0),
        ),
        equity_curve=(
            point("2024-12-30", 110_000.0, "GREEN"),
            point("2024-12-31", 99_000.0, "YELLOW"),
            point("2025-01-02", 108_900.0, "GREEN"),
            point("2025-01-03", 108_900.0, "RED"),
        ),
    )


def gate(verdict: str = "FAIL", blockers: tuple[str, ...] = ()) -> GateReport:
    return GateReport(
        verdict=verdict,
        rows=(
            GateRow(name="expectancy_r", value=-0.0462, minimum=0.05, target=0.31,
                    higher_is_better=True, verdict="FAIL"),
            GateRow(name="max_drawdown", value=0.0749, minimum=0.2, target=0.1,
                    higher_is_better=False, verdict="TARGET"),
        ),
        blockers=blockers,
    )


def walk() -> WalkForwardReport:
    plan = WalkForwardPlan(
        folds=(
            Fold("fold-01", "2008-01-04", "2009-01-02"),
            Fold("holdout", "2025-08-07", "2026-08-07", is_holdout=True),
        ),
        warmup_sessions=252,
        unused_sessions=0,
    )
    return WalkForwardReport(
        plan=plan,
        fold_metrics=(
            (plan.folds[0], metrics(trade_count=6, expectancy_r=-0.484)),
            (plan.folds[1], metrics(trade_count=86, expectancy_r=0.1038)),
        ),
        holdout_run_count=1,
    )


class VerdictFirstTest(unittest.TestCase):
    def test_a_blocked_run_says_so_before_any_number(self):
        """**blocker가 있으면 숫자보다 먼저 그것을 말한다.**

        `UNDETERMINED` 실행의 Sharpe를 나중에 성과로 인용하는 것이 이 프로젝트가 가장
        경계해온 실패다. 경고가 지표표 아래에 있으면 아무도 안 읽는다.
        """
        text = judgment_markdown(
            result(), metrics(), gate("UNDETERMINED", ("SURVIVORSHIP_BIASED",)),
            run_id="run-1",
        )
        warning = text.index("이 숫자들은 판정이 아니다")
        self.assertLess(warning, text.index("## 지표"))
        self.assertLess(warning, text.index("Sharpe"))
        self.assertIn("`SURVIVORSHIP_BIASED`", text)

    def test_a_clean_run_says_the_numbers_are_readable(self):
        text = judgment_markdown(result(), metrics(), gate("FAIL"), run_id="run-1")
        self.assertIn("blocker가 없다", text)
        self.assertNotIn("이 숫자들은 판정이 아니다", text)

    def test_the_provenance_block_carries_the_entry_and_exit_modes(self):
        """두 모드는 정책 서명 밖이라 보고서가 안 찍으면 어디에도 남지 않는다."""
        research = replace(
            result(),
            config=replace(
                result().config, entry_mode="RS_ONLY", exit_mode="FIXED_HOLD"
            ),
        )
        text = judgment_markdown(research, metrics(), gate(), run_id="run-1")
        self.assertIn("|진입 모드|`RS_ONLY`|", text)
        self.assertIn("|청산 모드|`FIXED_HOLD`|", text)
        payload = judgment_payload(research, metrics(), gate())
        self.assertEqual(payload["entry_mode"], "RS_ONLY")
        self.assertEqual(payload["exit_mode"], "FIXED_HOLD")

    def test_the_provenance_block_carries_the_policy_signature(self):
        """어떤 정책·적재분으로 낸 숫자인지 없으면 나중에 견줄 수가 없다."""
        text = judgment_markdown(result(), metrics(), gate(), run_id="run-1")
        self.assertIn("eodhd-15y-2026-08", text)
        self.assertIn(PAPER_CORE_V1.signature, text)
        self.assertIn(PAPER_CORE_V1.policy_id, text)


class ContentTest(unittest.TestCase):
    def test_the_cost_is_added_back(self):
        """순손익만 보면 "비용이 잡아먹었다"와 "엣지가 없다"를 구별할 수 없다.

        그 둘은 다음에 할 일이 완전히 다르다. 2026-08-10 실행에서 순손익 -6,970에
        비용 11,851을 되돌리면 +4,881이고, 거래당으로는 +9.4다.
        """
        text = judgment_markdown(result(), metrics(), gate(), run_id="run-1")
        self.assertIn("비용 전 +4,881", text)
        self.assertIn("+9.4", text)

    def test_a_run_without_trades_skips_the_cost_line(self):
        """거래가 0이면 거래당 비용에 나눌 것이 없다."""
        text = judgment_markdown(
            result(), metrics(trade_count=0), gate(), run_id="run-1"
        )
        self.assertNotIn("비용을 되돌리면", text)

    def test_the_holdout_fold_is_marked(self):
        """홀드아웃은 다른 fold와 같은 줄에 섞이면 안 된다. 한 번만 볼 수 있는 구간이다."""
        text = judgment_markdown(
            result(), metrics(), gate(), run_id="run-1", walk_forward=walk()
        )
        self.assertIn("**holdout**", text)
        self.assertIn("홀드아웃 실행 횟수 1회", text)

    def test_an_undefined_collapse_ratio_explains_itself(self):
        """중심 기대값이 음수면 붕괴비율이 None이다. 결함이 아니라 정의상 그렇다."""
        report = neighbourhood_report(
            "atr_window", metrics(), {12: metrics(expectancy_r=-0.038)},
            center_value=14,
        )
        text = judgment_markdown(
            result(), metrics(), gate(), run_id="run-1", neighbourhood=report
        )
        self.assertIn("0 이하라 비율에 뜻이 없다", text)

    def test_optional_sections_are_absent_when_not_given(self):
        text = judgment_markdown(result(), metrics(), gate(), run_id="run-1")
        for heading in ("## 워크포워드", "## 비용 스트레스", "## 인접 파라미터"):
            self.assertNotIn(heading, text)


class PeriodTest(unittest.TestCase):
    def test_the_drawdown_is_measured_inside_the_year(self):
        """**전 구간 고점에서 재면 그 해의 낙폭이 아니다.**

        2024는 100,000에서 시작해 110,000을 찍고 99,000으로 끝난다. 그 해 안 낙폭은
        110,000 대비 10%이고, 구간 시작 자산을 첫 고점으로 놓으므로 첫날 하락도 든다.
        """
        rows = {row.label: row for row in period_performance(curved_result())}
        self.assertAlmostEqual(rows["2024"].max_drawdown, 0.10)
        self.assertAlmostEqual(rows["2024"].total_return, -0.01)
        # 2025는 직전 해 종가 99,000에서 시작한다. 초기 자본이 아니다.
        self.assertAlmostEqual(rows["2025"].total_return, 0.10)
        self.assertAlmostEqual(rows["2025"].max_drawdown, 0.0)

    def test_a_trade_lands_in_the_year_it_closed(self):
        """손익이 확정되는 해에 붙어야 그 해의 수익률·PF와 같은 사건을 가리킨다."""
        rows = {row.label: row for row in period_performance(curved_result())}
        self.assertEqual(rows["2024"].trade_count, 1)
        self.assertEqual(rows["2025"].trade_count, 1)

    def test_a_year_without_a_loss_has_no_profit_factor(self):
        """나눌 것이 없으면 무한대를 만들지 않는다. 지표 계산과 같은 규칙이다."""
        rows = {row.label: row for row in period_performance(curved_result())}
        self.assertIsNone(rows["2024"].profit_factor)
        self.assertAlmostEqual(rows["2025"].profit_factor, 0.0)

    def test_a_regime_row_chains_only_its_own_sessions(self):
        """GREEN 두 세션이 각각 +10%면 붙여서 +21%다. 사이에 낀 YELLOW는 안 센다."""
        rows = {row.label: row for row in regime_performance(curved_result())}
        self.assertEqual(rows["GREEN"].sessions, 2)
        self.assertAlmostEqual(rows["GREEN"].total_return, 0.21)
        self.assertAlmostEqual(rows["YELLOW"].total_return, -0.10)
        self.assertAlmostEqual(rows["YELLOW"].max_drawdown, 0.10)

    def test_a_regime_counts_the_trades_it_entered(self):
        """**청산일로 세면 레짐이 한 일을 못 본다.** 진입을 허락한 것이 레짐이다.

        해를 넘긴 거래는 YELLOW에서 진입해 RED 세션에 청산됐다. 연도별 표는 청산한
        2025에 세지만 레짐 표는 진입한 YELLOW에 센다.
        """
        rows = {row.label: row for row in regime_performance(curved_result())}
        self.assertEqual(rows["YELLOW"].trade_count, 1)
        self.assertEqual(rows["RED"].trade_count, 0)
        self.assertEqual(rows["GREEN"].trade_count, 1)

    def test_the_year_table_comes_before_the_funnel(self):
        text = judgment_markdown(curved_result(), metrics(), gate(), run_id="run-1")
        self.assertLess(text.index("## 연도별 성과"), text.index("## 시장 상태별 성과"))
        self.assertLess(text.index("## 시장 상태별 성과"), text.index("## 진입 깔때기"))
        self.assertIn("|2024|2|-1.00%|1|10.00%|—|", text)

    def test_the_gating_table_only_appears_when_it_says_something_new(self):
        """MARKET 모드는 두 라벨이 같은 객체에서 나온다. 같은 표를 두 번 그리면 오독한다."""
        same = judgment_markdown(curved_result(), metrics(), gate(), run_id="run-1")
        self.assertNotIn("## 게이트 상태별 성과", same)

        # CORE 모드: 게이팅은 GREEN/YELLOW/RED, 시장 라벨은 따로 붙는다.
        curve = tuple(
            replace(item, market_regime="BULL/LOW_VOL")
            for item in curved_result().equity_curve
        )
        both = judgment_markdown(
            replace(curved_result(), equity_curve=curve), metrics(), gate(),
            run_id="run-1",
        )
        self.assertIn("## 게이트 상태별 성과", both)
        self.assertLess(
            both.index("## 시장 상태별 성과"), both.index("## 게이트 상태별 성과")
        )
        payload = judgment_payload(
            replace(curved_result(), equity_curve=curve), metrics(), gate()
        )
        self.assertEqual(
            [row["label"] for row in payload["regime_performance"]], ["BULL/LOW_VOL"]
        )
        self.assertEqual(
            [row["label"] for row in payload["gating_performance"]],
            ["GREEN", "YELLOW", "RED"],
        )
        self.assertNotIn("gating_performance", judgment_payload(
            curved_result(), metrics(), gate()
        ))

    def test_a_run_without_an_equity_curve_has_no_period_tables(self):
        text = judgment_markdown(result(), metrics(), gate(), run_id="run-1")
        for heading in ("## 연도별 성과", "## 시장 상태별 성과"):
            self.assertNotIn(heading, text)


class PayloadTest(unittest.TestCase):
    def test_the_payload_round_trips_as_json(self):
        payload = judgment_payload(
            result(), metrics(), gate("FAIL"), walk_forward=walk(),
            stressed=metrics(expectancy_r=-0.309),
        )
        parsed = json.loads(judgment_json(payload))
        self.assertEqual(parsed["verdict"], "FAIL")
        self.assertEqual(parsed["source_version"], "eodhd-15y-2026-08")
        self.assertEqual(parsed["walk_forward"]["holdout_run_count"], 1)
        self.assertEqual(parsed["stressed_metrics"]["expectancy_r"], -0.309)

    def test_the_period_slices_survive_into_the_payload(self):
        """실행 간 diff가 연도·레짐 단위로도 되려면 구조로 남아야 한다."""
        parsed = json.loads(judgment_json(judgment_payload(
            curved_result(), metrics(), gate("FAIL"),
        )))
        self.assertEqual(
            [row["label"] for row in parsed["period_performance"]], ["2024", "2025"]
        )
        self.assertEqual(
            [row["label"] for row in parsed["regime_performance"]],
            ["GREEN", "YELLOW", "RED"],
        )

    def test_the_blockers_survive_into_the_payload(self):
        """기계가 견줄 때도 판정 가능 여부가 먼저다."""
        payload = judgment_payload(
            result(), metrics(), gate("UNDETERMINED", ("NO_WALK_FORWARD",))
        )
        self.assertEqual(payload["blockers"], ["NO_WALK_FORWARD"])

    def test_a_policy_change_shows_up_as_a_different_signature(self):
        """서명이 같으면 같은 규칙으로 낸 숫자다. 실행 간 diff의 기준이 된다."""
        base = judgment_payload(result(), metrics(), gate())
        changed = replace(
            result().config.policy,
            parameters=replace(PAPER_CORE_V1.parameters, atr_window=12),
        )
        other = judgment_payload(
            replace(result(), config=replace(result().config, policy=changed)),
            metrics(), gate(),
        )
        self.assertNotEqual(base["policy_signature"], other["policy_signature"])


if __name__ == "__main__":
    unittest.main()
