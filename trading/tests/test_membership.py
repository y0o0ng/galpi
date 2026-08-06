"""구성원 재구성. 손으로 답을 낼 수 있는 작은 이력으로 확인한다.

가장 중요한 테스트는 `InvariantTest`다. **잘못 만든 구성원 목록은 없는 것보다 나쁘다** —
생존편향을 되돌리면서 유효한 것처럼 보인다. 구성원 수 불변식과 구간 겹침 검사가 그것을
잡아내야 하고, 위반이 있으면 적재가 거부돼야 한다.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

TRADING_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TRADING_ROOT))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import synthetic  # noqa: E402
from backtest import store  # noqa: E402
from backtest.data import PointInTimeSnapshot, load_bars_csv, register_source  # noqa: E402
from backtest.membership import (  # noqa: E402
    ADD,
    EXPECTED_MEMBERS,
    REMOVE,
    Change,
    Interval,
    MembershipError,
    count_violations,
    load_universe,
    parse_changes_csv,
    parse_members_csv,
    reconstruct,
    to_csv,
)

VERSION = "v1"
FLOOR = "2010-01-04"
AS_OF = "2020-01-02"


def change(date: str, action: str, symbol: str, index_name: str = "SP500") -> Change:
    return Change(date=date, index_name=index_name, action=action, symbol=symbol)


class ParseTest(unittest.TestCase):
    def test_changes_csv_is_one_change_per_row(self):
        changes = parse_changes_csv(
            "date,index_name,action,symbol\n"
            "2013-09-23,SP500,add,blk\n"
            "2013-09-23,SP500,remove,DELL\n"
        )
        self.assertEqual(len(changes), 2)
        self.assertEqual(changes[0].symbol, "BLK")  # 대문자로 정규화
        self.assertEqual(changes[1].action, REMOVE)

    def test_a_bad_action_is_refused(self):
        with self.assertRaises(MembershipError):
            parse_changes_csv("date,index_name,action,symbol\n2013-01-01,SP500,swap,AAA\n")

    def test_missing_columns_are_refused(self):
        with self.assertRaises(MembershipError) as caught:
            parse_changes_csv("date,index_name,symbol\n2013-01-01,SP500,AAA\n")
        self.assertIn("action", str(caught.exception))

    def test_members_csv_groups_by_index(self):
        members = parse_members_csv(
            "index_name,symbol\nSP500,AAPL\nSP500,MSFT\nNDX100,AAPL\n"
        )
        self.assertEqual(members["SP500"], frozenset({"AAPL", "MSFT"}))
        self.assertEqual(members["NDX100"], frozenset({"AAPL"}))


class ReconstructTest(unittest.TestCase):
    def test_a_symbol_added_midway_starts_at_that_date(self):
        result = reconstruct(
            "SP500",
            {"OLD", "NEW"},
            [change("2015-06-01", ADD, "NEW"), change("2015-06-01", REMOVE, "GONE")],
            floor_date=FLOOR,
            as_of=AS_OF,
        )
        self.assertEqual(result.violations, ())
        by_symbol = {i.symbol: i for i in result.intervals}
        # NEW는 2015-06-01부터 아직 구성원이다.
        self.assertEqual(by_symbol["NEW"].valid_from, "2015-06-01")
        self.assertIsNone(by_symbol["NEW"].valid_to)
        # GONE은 이력 시작부터 2015-06-01 전까지였다.
        self.assertEqual(by_symbol["GONE"].valid_from, FLOOR)
        self.assertEqual(by_symbol["GONE"].valid_to, "2015-06-01")
        # OLD는 변경이 없어 이력 시작부터 계속이다.
        self.assertEqual(by_symbol["OLD"].valid_from, FLOOR)
        self.assertIsNone(by_symbol["OLD"].valid_to)

    def test_membership_is_half_open_at_the_effective_date(self):
        """효력일에 신규는 구성원이고 편출은 아니다."""
        result = reconstruct(
            "SP500",
            {"NEW"},
            [change("2015-06-01", ADD, "NEW"), change("2015-06-01", REMOVE, "GONE")],
            floor_date=FLOOR,
            as_of=AS_OF,
        )
        self.assertEqual(result.members_on("2015-05-29"), {"GONE"})
        self.assertEqual(result.members_on("2015-06-01"), {"NEW"})

    def test_a_symbol_can_re_enter(self):
        result = reconstruct(
            "SP500",
            {"BACK"},
            [
                change("2012-03-01", REMOVE, "BACK"),
                change("2016-09-01", ADD, "BACK"),
            ],
            floor_date=FLOOR,
            as_of=AS_OF,
        )
        self.assertEqual(result.violations, ())
        intervals = sorted(
            (i for i in result.intervals if i.symbol == "BACK"),
            key=lambda i: i.valid_from,
        )
        self.assertEqual(len(intervals), 2)
        self.assertEqual((intervals[0].valid_from, intervals[0].valid_to), (FLOOR, "2012-03-01"))
        self.assertEqual((intervals[1].valid_from, intervals[1].valid_to), ("2016-09-01", None))
        # 나간 사이에는 구성원이 아니다.
        self.assertNotIn("BACK", result.members_on("2014-01-02"))
        self.assertIn("BACK", result.members_on("2017-01-03"))

    def test_counts_change_over_time(self):
        result = reconstruct(
            "SP500",
            {"A", "B", "C"},
            [change("2015-06-01", ADD, "C"), change("2015-06-01", REMOVE, "D")],
            floor_date=FLOOR,
            as_of=AS_OF,
        )
        self.assertEqual(result.counts(["2012-01-03", "2016-01-04"]),
                         {"2012-01-03": 3, "2016-01-04": 3})

    def test_changes_after_the_as_of_are_refused(self):
        result = reconstruct(
            "SP500", {"A"}, [change("2021-01-04", ADD, "A")], floor_date=FLOOR, as_of=AS_OF
        )
        self.assertTrue(any("기준일" in item for item in result.violations))


class ViolationTest(unittest.TestCase):
    def test_an_add_without_a_later_membership_is_flagged(self):
        """추가 기록이 있는데 그 이후 구성원이 아니면 제거 기록이 빠진 것이다."""
        result = reconstruct(
            "SP500", {"OTHER"}, [change("2015-06-01", ADD, "MISSING")],
            floor_date=FLOOR, as_of=AS_OF,
        )
        self.assertTrue(any("MISSING" in item for item in result.violations))

    def test_a_remove_of_a_current_member_is_flagged(self):
        """제거됐다는데 지금도 구성원이면 재추가 기록이 빠진 것이다."""
        result = reconstruct(
            "SP500", {"STILL"}, [change("2015-06-01", REMOVE, "STILL")],
            floor_date=FLOOR, as_of=AS_OF,
        )
        self.assertTrue(any("STILL" in item for item in result.violations))

    def test_overlapping_intervals_are_detected(self):
        from backtest.membership import _overlap_violations

        overlapping = [
            Interval("AAA", "SP500", "2012-01-03", "2016-01-04"),
            Interval("AAA", "SP500", "2015-01-02", None),
        ]
        self.assertTrue(any("겹칩니다" in item for item in _overlap_violations(overlapping)))

    def test_a_reversed_interval_is_detected(self):
        from backtest.membership import _overlap_violations

        self.assertTrue(
            any(
                "뒤집혔" in item
                for item in _overlap_violations(
                    [Interval("AAA", "SP500", "2016-01-04", "2012-01-03")]
                )
            )
        )


class InvariantTest(unittest.TestCase):
    """구성원 수 불변식이 재구성 오류를 잡는 마지막 그물이다."""

    def full_index(self, count: int) -> set[str]:
        return {f"S{index:03d}" for index in range(count)}

    def test_a_correct_reconstruction_passes(self):
        result = reconstruct(
            "SP500", self.full_index(500), [], floor_date=FLOOR, as_of=AS_OF
        )
        self.assertEqual(count_violations(result, ["2012-01-03", "2018-01-02"]), [])

    def test_a_missing_removal_record_shows_up_as_a_short_count(self):
        """제거 기록이 빠지면 과거 구성원 수가 모자란다. 이게 생존편향의 모양이다."""
        members = self.full_index(500)
        # 2015년에 20종목이 편출됐는데 그 기록이 없다고 가정.
        result = reconstruct(
            "SP500",
            members,
            [change("2015-06-01", ADD, f"S{index:03d}") for index in range(20)],
            floor_date=FLOOR,
            as_of=AS_OF,
        )
        found = count_violations(result, ["2012-01-03"])
        self.assertTrue(found)
        self.assertIn("480", found[0])

    def test_the_expected_counts_match_the_indices_we_use(self):
        self.assertEqual(EXPECTED_MEMBERS["SP500"][0], 500)
        self.assertEqual(EXPECTED_MEMBERS["NDX100"], (100, 1))

    def test_an_unknown_index_cannot_be_validated(self):
        result = reconstruct("RUSSELL", {"A"}, [], floor_date=FLOOR, as_of=AS_OF)
        self.assertTrue(any("기대 구성원 수를 모릅니다" in i for i in count_violations(result, ["2012-01-03"])))


class LoadTest(unittest.TestCase):
    def setUp(self):
        self.connection = store.connect_memory()
        self.dates = synthetic.sessions(300, start="2012-01-02")

    def clean_reconstruction(self, index_name="NDX100", count=100):
        members = {f"S{index:03d}" for index in range(count)}
        return reconstruct(index_name, members, [], floor_date=FLOOR, as_of=AS_OF)

    def test_a_clean_reconstruction_loads_and_is_declared_unbiased(self):
        result = load_universe(
            self.connection,
            [self.clean_reconstruction()],
            "index-announcements",
            VERSION,
            check_dates=[self.dates[0], self.dates[-1]],
            note="공고 아카이브에서 재구성, 구성원 수 불변식 통과",
        )
        self.assertTrue(result["clean"])
        self.assertEqual(result["violations"], [])
        row = self.connection.execute(
            "SELECT point_in_time, survivorship_biased, note FROM data_sources"
            " WHERE kind = 'universe'"
        ).fetchone()
        self.assertEqual(row["point_in_time"], 1)
        self.assertEqual(row["survivorship_biased"], 0)
        self.assertIn("불변식", row["note"])

    def test_violations_refuse_to_load(self):
        broken = reconstruct("NDX100", {"A", "B"}, [], floor_date=FLOOR, as_of=AS_OF)
        with self.assertRaises(MembershipError) as caught:
            load_universe(
                self.connection,
                [broken],
                "index-announcements",
                VERSION,
                check_dates=[self.dates[0]],
                note="깨진 재구성",
            )
        self.assertIn("적재를 거부", str(caught.exception))
        self.assertEqual(
            self.connection.execute("SELECT COUNT(*) AS n FROM universe_membership")
            .fetchone()["n"],
            0,
        )

    def test_accepting_violations_marks_the_source_biased(self):
        """위반을 안고 넣으면 그 사실이 출처에 남고 판정에 쓸 수 없게 된다."""
        broken = reconstruct("NDX100", {"A", "B"}, [], floor_date=FLOOR, as_of=AS_OF)
        result = load_universe(
            self.connection,
            [broken],
            "index-announcements",
            VERSION,
            check_dates=[self.dates[0]],
            note="부분 재구성",
            accept_violations_because="초기 검증용, 전략 판정에 쓰지 않는다",
        )
        self.assertFalse(result["clean"])
        row = self.connection.execute(
            "SELECT survivorship_biased, note FROM data_sources WHERE kind='universe'"
        ).fetchone()
        self.assertEqual(row["survivorship_biased"], 1)
        self.assertIn("초기 검증용", row["note"])

    def test_loaded_intervals_answer_point_in_time_queries(self):
        """적재된 구간이 스냅샷의 members()와 맞물리는지 끝까지 확인한다."""
        register_source(self.connection, "synthetic", VERSION, "bars")
        load_bars_csv(
            self.connection,
            synthetic.to_csv(
                synthetic.rows("SPY", self.dates, synthetic.constant_closes(len(self.dates), 400.0))
            ),
            "synthetic",
            VERSION,
        )
        result = reconstruct(
            "NDX100",
            {f"S{index:03d}" for index in range(100)},
            [change("2012-06-01", ADD, "S000", "NDX100"),
             change("2012-06-01", REMOVE, "OUT", "NDX100")],
            floor_date=FLOOR,
            as_of=AS_OF,
        )
        load_universe(
            self.connection,
            [result],
            "index-announcements",
            VERSION,
            check_dates=[self.dates[-1]],
            note="테스트",
            accept_violations_because="합성 지수라 구성원 수가 다르다",
        )
        early = PointInTimeSnapshot(self.connection, "2012-05-31", VERSION)
        late = PointInTimeSnapshot(self.connection, "2012-06-01", VERSION)
        self.assertIn("OUT", early.members("NDX100"))
        self.assertNotIn("S000", early.members("NDX100"))
        self.assertNotIn("OUT", late.members("NDX100"))
        self.assertIn("S000", late.members("NDX100"))


class CsvTest(unittest.TestCase):
    def test_csv_matches_the_loader_column_contract(self):
        from backtest.data import UNIVERSE_CSV_COLUMNS

        text = to_csv((Interval("AAA", "SP500", "2012-01-03", None),))
        self.assertEqual(text.splitlines()[0].split(","), list(UNIVERSE_CSV_COLUMNS))
        # 아직 구성원이면 valid_to는 빈 칸이다.
        self.assertEqual(text.splitlines()[1], "AAA,SP500,2012-01-03,")


if __name__ == "__main__":
    unittest.main()
