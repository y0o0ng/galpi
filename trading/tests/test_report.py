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

from backtest.loop import BacktestConfig, BacktestResult  # noqa: E402
from backtest.metrics import Metrics  # noqa: E402
from backtest.policy import DEFAULT_PAPER_POLICY  # noqa: E402
from backtest.report import (  # noqa: E402
    judgment_json,
    judgment_markdown,
    judgment_payload,
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
        policy=DEFAULT_PAPER_POLICY,
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

    def test_the_provenance_block_carries_the_policy_signature(self):
        """어떤 정책·적재분으로 낸 숫자인지 없으면 나중에 견줄 수가 없다."""
        text = judgment_markdown(result(), metrics(), gate(), run_id="run-1")
        self.assertIn("eodhd-15y-2026-08", text)
        self.assertIn(DEFAULT_PAPER_POLICY.signature, text)
        self.assertIn(DEFAULT_PAPER_POLICY.policy_id, text)


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
            parameters=replace(DEFAULT_PAPER_POLICY.parameters, atr_window=12),
        )
        other = judgment_payload(
            replace(result(), config=replace(result().config, policy=changed)),
            metrics(), gate(),
        )
        self.assertNotEqual(base["policy_signature"], other["policy_signature"])


if __name__ == "__main__":
    unittest.main()
