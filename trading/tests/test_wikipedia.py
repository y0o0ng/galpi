"""지수 변경 공고 색인 파싱. 픽스처는 실제 표에서 함정만 남기고 줄인 것이다.

가장 중요한 테스트 둘이다.

- `test_a_reference_with_pipes_does_not_shift_columns`: `<ref>{{cite web |url=...}}`의
  파이프를 먼저 걷어내지 않으면 열이 통째로 밀린다. 밀린 채로도 실행은 정상 종료하고
  구성원 목록만 틀린다.
- `test_a_rename_does_not_touch_a_reused_ticker`: `IR`은 2020-03-02 이전에는 잉거솔랜드
  (현 `TT`)지만 그날부터는 가드너덴버가 이어받은 다른 회사다. 날짜 없이 개명을 걸면
  뒤엣것까지 덮어쓴다.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

TRADING_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TRADING_ROOT))

from backtest.wikipedia import (  # noqa: E402
    CORRECTIONS,
    SYMBOL_RENAMES,
    WikipediaError,
    apply_renames,
    clean_cell,
    parse_changes,
    parse_date,
    parse_members,
    parse_table,
)

# S&P 표의 서식: 한 줄에 `||`로 이어 쓰고, 티커가 템플릿이며, 사유에 파이프가 든 참조가 붙는다.
SP_STYLE = """
{| class="wikitable sortable" id="constituents"
! Symbol || Security || GICS Sector
|-
|{{NyseSymbol|ZTS}}
|[[Zoetis]]|| Health Care
|-
|{{NasdaqSymbol|AAPL}}
|[[Apple Inc.]]|| Information Technology
|}

{|  class="wikitable sortable" id="changes"
|-
! data-sort-type="date" rowspan="2" | Effective Date
! colspan="2" | Added
! colspan="2" | Removed
! rowspan="2" | Reason
|-
! Ticker || Security || Ticker || Security
|-
|March 2, 2020 || IR || [[Ingersoll Rand]] || XEC || [[Cimarex]] || Gardner Denver \
changed its name.<ref>{{cite web |url=https://example.invalid/a.pdf |title=X |date=2020}}</ref>
|-
|November 17, 2010 || IR || [[Ingersoll-Rand]] || PTV || [[Pactiv]] || Acquired.
|-
|December 23, 2013 || FB || [[Facebook]] || TER || [[Teradyne]] || Market cap.
|}
"""

# Nasdaq 표의 서식: 셀마다 줄을 바꾸고, 편입·편출 중 한쪽이 비기도 한다.
NDX_STYLE = """
{| class="wikitable sortable" id="constituents"
! Ticker !! Company
|-
| ADBE || [[Adobe Inc.]]
|-
| GOOGL || [[Alphabet Inc.]] (Class A)
|}

{| class="wikitable sortable" id="changes"
! rowspan="2" data-sort-type="date" |Date
! colspan="2" |Added
! colspan="2" |Removed
! rowspan="2" |Reason
|-
!Ticker
!Security
!Ticker
!Security
|-
|August 4, 2026
|
|
|EA
|[[Electronic Arts]]
|EA was taken private.
|-
|July 23, 2012
|KFT
|[[Kraft Foods]]
|TCOM
|[[Ctrip]]
|Weight requirements.<ref>{{Cite press release |title=A |publisher=[[Nasdaq]]}}</ref>
|}
"""


class CellTest(unittest.TestCase):
    def test_symbol_templates_become_the_ticker(self):
        self.assertEqual(clean_cell("{{NyseSymbol|ZTS}}"), "ZTS")
        self.assertEqual(clean_cell("{{NasdaqSymbol|AAPL}}"), "AAPL")

    def test_wiki_links_become_their_display_text(self):
        self.assertEqual(clean_cell("[[Alphabet Inc.|Alphabet]]"), "Alphabet")
        self.assertEqual(clean_cell("[[Zoetis]]"), "Zoetis")

    def test_cell_attributes_are_dropped(self):
        self.assertEqual(clean_cell('style="text-align:center;" | 42'), "42")


class DateTest(unittest.TestCase):
    def test_long_form_dates(self):
        self.assertEqual(parse_date("August 5, 2026"), "2026-08-05")
        self.assertEqual(parse_date("March 2, 2020"), "2020-03-02")

    def test_an_unreadable_date_is_refused(self):
        with self.assertRaises(WikipediaError):
            parse_date("sometime in 2020")


class TableTest(unittest.TestCase):
    def test_a_reference_with_pipes_does_not_shift_columns(self):
        """`{{cite web |url=... |title=...}}`의 파이프가 셀 구분자로 읽히면 열이 밀린다."""
        _, rows = parse_table(SP_STYLE, "changes")
        first = rows[0]
        self.assertEqual(first[0], "March 2, 2020")
        self.assertEqual(first[1], "IR")
        self.assertEqual(first[3], "XEC")

    def test_both_table_styles_parse(self):
        _, inline = parse_table(SP_STYLE, "changes")
        _, per_line = parse_table(NDX_STYLE, "changes")
        self.assertEqual(len(inline), 3)
        self.assertEqual(len(per_line), 2)
        self.assertEqual(per_line[1][1], "KFT")

    def test_a_missing_table_is_refused(self):
        with self.assertRaises(WikipediaError):
            parse_table(SP_STYLE, "nope")


class MembersTest(unittest.TestCase):
    def test_the_symbol_column_is_found_by_header_name(self):
        """두 페이지가 `Symbol`과 `Ticker`로 다르게 부른다. 위치를 가정하지 않는다."""
        self.assertEqual(
            parse_members(SP_STYLE, "SP500"),
            "index_name,symbol\nSP500,AAPL\nSP500,ZTS\n",
        )
        self.assertEqual(
            parse_members(NDX_STYLE, "NDX100"),
            "index_name,symbol\nNDX100,ADBE\nNDX100,GOOGL\n",
        )


class ChangesTest(unittest.TestCase):
    def test_a_row_becomes_one_line_per_change(self):
        lines = parse_changes(SP_STYLE, "SP500").splitlines()
        self.assertIn("2010-11-17,SP500,add,TT", lines)
        self.assertIn("2010-11-17,SP500,remove,PTV", lines)

    def test_an_empty_side_is_skipped(self):
        """분사·상장폐지 행은 편입과 편출 중 한쪽만 있다."""
        lines = parse_changes(NDX_STYLE, "NDX100").splitlines()
        self.assertIn("2026-08-04,NDX100,remove,EA", lines)
        self.assertFalse([line for line in lines if line.startswith("2026-08-04,NDX100,add")])

    def test_since_cuts_the_window(self):
        lines = parse_changes(SP_STYLE, "SP500", since="2013-01-01").splitlines()
        self.assertFalse([line for line in lines if line.startswith("2010-")])

    def test_corrections_are_merged_in(self):
        lines = parse_changes(SP_STYLE, "SP500").splitlines()
        for date_, index, action, symbol, _ in CORRECTIONS:
            if index == "SP500":
                self.assertIn(f"{date_},{index},{action},{symbol}", lines)


class RenameTest(unittest.TestCase):
    def test_a_rename_does_not_touch_a_reused_ticker(self):
        # 2020-03-02부터의 IR은 가드너덴버라 그대로 둔다.
        self.assertEqual(apply_renames("SP500", "2010-11-17", "IR"), "TT")
        self.assertEqual(apply_renames("SP500", "2020-03-02", "IR"), "IR")

    def test_renames_are_scoped_to_one_index(self):
        """`NWSA`는 Nasdaq-100에서는 옛 뉴스코프(→FOXA)지만 S&P 500에서는 현재 구성원이다."""
        self.assertEqual(apply_renames("NDX100", "2009-01-20", "NWSA"), "FOXA")
        self.assertEqual(apply_renames("SP500", "2009-01-20", "NWSA"), "NWSA")

    def test_the_parsed_rows_carry_the_rename(self):
        lines = parse_changes(SP_STYLE, "SP500").splitlines()
        self.assertIn("2013-12-23,SP500,add,META", lines)
        self.assertFalse([line for line in lines if line.endswith(",add,FB")])

    def test_every_rename_and_correction_states_its_evidence(self):
        """근거 없는 항목을 넣지 않는다. 이 목록은 공고가 아니라 우리의 해석이다."""
        for rename in SYMBOL_RENAMES:
            self.assertTrue(rename.evidence.strip(), rename)
            parse_date_ok = rename.before
            self.assertRegex(parse_date_ok, r"^\d{4}-\d{2}-\d{2}$")
        for _, _, _, _, evidence in CORRECTIONS:
            self.assertTrue(evidence.strip())


if __name__ == "__main__":
    unittest.main()
