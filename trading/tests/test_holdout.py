"""홀드아웃이 코드 불변식인지 확인한다.

가장 중요한 테스트는 `test_a_research_result_may_not_contain_holdout_dates`와
`test_forward_targets_cannot_reach_into_the_holdout`이다. 전자는 결과에 홀드아웃 날짜가
섞이면 실패한다는 것 자체를 잠그고, 후자는 **신호일만 걸러서는 부족하다**는 것을 값으로
확인한다 — `t+K`가 홀드아웃 안의 종가를 읽으면 신호일이 밖에 있어도 같은 누수다.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

TRADING_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TRADING_ROOT))

from backtest.holdout import (  # noqa: E402
    HOLDOUT_START,
    HoldoutViolation,
    assert_no_holdout,
    check_derived_holdout,
    holdout_metadata,
    research_sessions,
)

# `HOLDOUT_START` 양쪽으로 걸친 세션 목록.
SESSIONS = [
    "2025-08-04",
    "2025-08-05",
    "2025-08-06",
    "2025-08-07",  # 홀드아웃 첫날
    "2025-08-08",
    "2026-08-07",
]


class ResearchSessionsTest(unittest.TestCase):
    def test_the_default_stops_before_the_holdout(self):
        self.assertEqual(
            research_sessions(SESSIONS), ["2025-08-04", "2025-08-05", "2025-08-06"]
        )

    def test_the_first_holdout_day_is_inside_the_holdout(self):
        """경계는 `<`다. `HOLDOUT_START` 당일은 표본 밖이지 마지막 연구일이 아니다."""
        self.assertNotIn(HOLDOUT_START, research_sessions(SESSIONS))

    def test_opting_in_returns_everything(self):
        self.assertEqual(research_sessions(SESSIONS, consume_holdout=True), SESSIONS)

    def test_the_returned_list_is_a_copy(self):
        """호출자가 자른 목록을 고쳐도 원본이 따라 바뀌면 안 된다."""
        original = list(SESSIONS)
        research_sessions(SESSIONS, consume_holdout=True).append("2027-01-01")
        self.assertEqual(SESSIONS, original)


class AssertNoHoldoutTest(unittest.TestCase):
    def test_a_research_result_may_not_contain_holdout_dates(self):
        """**이 테스트가 규칙 자체다.** 결과에 홀드아웃 날짜가 있으면 실행이 실패한다."""
        with self.assertRaises(HoldoutViolation) as caught:
            assert_no_holdout(SESSIONS)
        self.assertIn("2025-08-07", str(caught.exception))
        self.assertIn("2026-08-07", str(caught.exception))

    def test_a_clean_result_passes(self):
        assert_no_holdout(research_sessions(SESSIONS))

    def test_consumed_results_are_allowed_through(self):
        assert_no_holdout(SESSIONS, consumed=True)

    def test_forward_targets_cannot_reach_into_the_holdout(self):
        """신호일만 거르면 새는 것을 값으로 보인다.

        달력을 자르면 `index + K`가 목록 밖으로 나가 그 지평이 아예 비고, 신호일만 거르면
        홀드아웃 안의 종가를 읽는다. 러너가 세션 목록 자체를 잘라 쓰는 이유다.
        """
        research = research_sessions(SESSIONS)
        signal_index = len(research) - 1
        horizon = 2
        # 잘린 달력에서는 목표일이 없다 — 조회 자체가 일어나지 않는다.
        self.assertGreaterEqual(signal_index + horizon, len(research))
        # 자르지 않았다면 그 목표일이 홀드아웃 안이다.
        full = research_sessions(SESSIONS, consume_holdout=True)
        with self.assertRaises(HoldoutViolation):
            assert_no_holdout([full[signal_index + horizon]])


class DerivedHoldoutTest(unittest.TestCase):
    def test_a_derived_start_before_the_constant_is_a_violation(self):
        """바가 줄면 상수가 진짜 홀드아웃 안을 가리킨다. 그건 막는다."""
        with self.assertRaises(HoldoutViolation):
            check_derived_holdout("2025-01-02")

    def test_a_later_derived_start_is_safe(self):
        """바가 늘면 연구가 쓸 수 있는 구간을 덜 쓸 뿐이라 통과한다."""
        check_derived_holdout("2026-02-02")
        check_derived_holdout(HOLDOUT_START)


class ResearchCalendarTest(unittest.TestCase):
    """러너가 실제로 무엇을 볼 수 있는지. 헬퍼가 아니라 경로를 잠근다."""

    def setUp(self):
        from backtest import store
        from selftest.real_run import REFERENCE_SYMBOL, SOURCE_VERSION

        self.connection = store.connect_memory()
        # 홀드아웃 양쪽에 걸친 SPY 바. 값은 이 테스트와 무관해서 전부 같게 둔다.
        for trade_date in ("2025-08-05", "2025-08-06", HOLDOUT_START, "2026-08-07"):
            self.connection.execute(
                "INSERT INTO bars_daily (symbol, trade_date, raw_open, raw_high,"
                " raw_low, raw_close, raw_volume, adj_open, adj_high, adj_low,"
                " adj_close, source, source_version)"
                " VALUES (?, ?, 1, 1, 1, 1, 1, 1, 1, 1, 1, 'test', ?)",
                (REFERENCE_SYMBOL, trade_date, SOURCE_VERSION),
            )

    def tearDown(self):
        self.connection.close()

    def test_the_runner_cannot_see_holdout_dates(self):
        """**이것이 이번 PR이 막으려는 실수다.** 기본 연구 실행은 경계를 넘지 못한다."""
        from selftest.signal_study import research_calendar

        calendar = research_calendar(self.connection)
        self.assertEqual(calendar, ["2025-08-05", "2025-08-06"])
        assert_no_holdout(calendar)

    def test_opting_in_is_the_only_way_through(self):
        from selftest.signal_study import research_calendar

        calendar = research_calendar(self.connection, consume_holdout=True)
        self.assertIn(HOLDOUT_START, calendar)
        self.assertIn("2026-08-07", calendar)


class MetadataTest(unittest.TestCase):
    def test_consumption_is_recorded(self):
        self.assertEqual(
            holdout_metadata(consumed=True),
            {"HOLDOUT_START": HOLDOUT_START, "HOLDOUT_CONSUMED": True},
        )
        self.assertFalse(holdout_metadata(consumed=False)["HOLDOUT_CONSUMED"])


if __name__ == "__main__":
    unittest.main()
