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
    SNAPSHOT_IGNORED,
    Snapshot,
    canonical_spelling,
    constituent_symbols,
    snapshot_changes,
    EXCLUDED_CHANGES,
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
|-
|January 19, 2016 || EXR || [[Extra Space Storage]] || ACE  || [[Chubb Limited|Chubb]] || \
EXR replaces ACE as ACE Ltd acquires Chubb and retains the CB ticker, giving up ACE.
|-
|October 1, 2012 || || || DV || [[DeVry]] || Market capitalization change.
|-
|July 5, 2011 || || || MI || [[Marshall & Ilsley]] || Acquired by [[Bank of Montreal]].
|}
"""
# 위 표의 ACE·DV·MI 행은 `EXCLUDED_CHANGES`가 가리키는 행이다. **일부러 둔다** —
# `_drop_excluded`가 대상 행이 사라지면 예외를 올리므로, 픽스처에서 빼면 그 그물이
# 테스트를 통과시키지 못한다. 제외를 하나 늘릴 때마다 여기도 한 줄 는다.

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
|-
|December 21, 2015
|
|
|LILA
|[[Liberty Latin America|LiLAC Group]]
|Tracking stock removed.
|-
|December 21, 2015
|
|
|LILAK
|[[Liberty Latin America|LiLAC Group]] Class C
|Tracking stock removed.
|-
|July 2, 2015
|LILA
|[[Liberty Latin America|LiLAC Group]]
|
|
|Tracking stock added.
|-
|July 2, 2015
|LILAK
|[[Liberty Latin America|LiLAC Group]] Class C
|
|
|Tracking stock added.
|}
"""
# 위 LiLAC 네 행도 `EXCLUDED_CHANGES`가 가리키는 행이라 일부러 둔다. SP_STYLE의
# ACE·DV·MI와 같은 이유다.


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
        self.assertEqual(len(inline), 6)
        self.assertEqual(len(per_line), 6)
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


def has_change(lines, prefix):
    """`security` 열이 뒤에 붙으므로 앞 네 칸으로 견준다."""
    return any(line.startswith(prefix + ",") for line in lines)


class ChangesTest(unittest.TestCase):
    def test_a_row_becomes_one_line_per_change(self):
        lines = parse_changes(SP_STYLE, "SP500").splitlines()
        self.assertTrue(has_change(lines, "2010-11-17,SP500,add,TT"))
        self.assertTrue(has_change(lines, "2010-11-17,SP500,remove,PTV"))

    def test_an_empty_side_is_skipped(self):
        """분사·상장폐지 행은 편입과 편출 중 한쪽만 있다."""
        lines = parse_changes(NDX_STYLE, "NDX100").splitlines()
        self.assertTrue(has_change(lines, "2026-08-04,NDX100,remove,EA"))
        self.assertFalse([line for line in lines if line.startswith("2026-08-04,NDX100,add")])

    def test_since_cuts_the_window(self):
        lines = parse_changes(SP_STYLE, "SP500", since="2013-01-01").splitlines()
        self.assertFalse([line for line in lines if line.startswith("2010-")])

    def test_corrections_are_merged_in(self):
        lines = parse_changes(SP_STYLE, "SP500").splitlines()
        for date_, index, action, symbol, _ in CORRECTIONS:
            if index == "SP500":
                self.assertTrue(has_change(lines, f"{date_},{index},{action},{symbol}"))


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
        self.assertTrue(has_change(lines, "2013-12-23,SP500,add,META"))
        self.assertFalse([line for line in lines if ",add,FB," in line])

    def test_every_rename_and_correction_states_its_evidence(self):
        """근거 없는 항목을 넣지 않는다. 이 목록은 공고가 아니라 우리의 해석이다."""
        for rename in SYMBOL_RENAMES:
            self.assertTrue(rename.evidence.strip(), rename)
            parse_date_ok = rename.before
            self.assertRegex(parse_date_ok, r"^\d{4}-\d{2}-\d{2}$")
        for _, _, _, _, evidence in CORRECTIONS + EXCLUDED_CHANGES:
            self.assertTrue(evidence.strip())

    def test_the_two_monster_companies_do_not_swap(self):
        """`MNST`를 두 회사가 나눠 쓰고 두 개명이 **세 날** 차이로 맞물린다.

        몬스터 월드와이드(2008-11-10 편출)는 MWW로, 한센(2009-12-21 편출, 2011-12-19
        재편입)은 MNST로 가야 한다. `MNST → MWW`의 `before`가 2011-12-19를 넘으면 재편입
        행까지 MWW가 되어 두 회사가 통째로 뒤바뀐다.
        """
        self.assertEqual(apply_renames("NDX100", "2008-11-10", "MNST"), "MWW")
        self.assertEqual(apply_renames("NDX100", "2009-12-21", "HANS"), "MNST")
        self.assertEqual(apply_renames("NDX100", "2011-12-19", "MNST"), "MNST")

    def test_applying_the_renames_twice_swaps_a_company(self):
        """**개명은 원래 티커에만 맞는다. 한 번 건 결과에 다시 걸면 안 된다.**

        `HANS`→`MNST`가 만든 2009-12-21 행을 `MNST`→`MWW`가 다시 집어 한센이 몬스터
        월드와이드가 된다. 그래서 개명은 `csvs` 단계에서 한 번만 걸고, 적재하면서 다시
        걸지 않는다. 여기서 고정해두지 않으면 "순수 함수니까 두 번 걸어도 되겠지"라는
        생각이 다시 나온다.
        """
        once = apply_renames("NDX100", "2009-12-21", "HANS")
        self.assertEqual(once, "MNST")
        self.assertEqual(apply_renames("NDX100", "2009-12-21", once), "MWW")

    def test_a_rename_chain_lands_on_the_current_ticker(self):
        """개명이 두 단계면 두 규칙을 다 걸어 **현재 티커 하나**로 모은다.

        HCP → PEAK → DOC이 그렇다. 중간에서 멈추면 그 구간이 벤더의 PEAK 코드(2012~2019의
        다른 회사) 가격을 받는다.
        """
        self.assertEqual(apply_renames("SP500", "2008-08-30", "HCP"), "DOC")
        self.assertEqual(apply_renames("SP500", "2019-11-29", "PEAK"), "DOC")
        self.assertEqual(apply_renames("SP500", "2014-12-29", "WLP"), "ELV")
        self.assertEqual(apply_renames("SP500", "2022-06-29", "ANTM"), "ELV")
        # ACT는 옛 Allergan Inc(AGN_OLD)가 아니라 액타비스가 개명한 AGN으로 간다.
        self.assertEqual(apply_renames("SP500", "2013-01-30", "ACT"), "AGN")

    def test_a_rename_target_is_a_ticker_the_vendor_still_serves(self):
        """`RIMM`은 BBRY를 거쳐 BB가 됐다. 중간 티커가 아니라 **전 이력을 든 쪽**으로 보낸다."""
        self.assertEqual(apply_renames("NDX100", "2012-12-24", "RIMM"), "BB")


# 구성원 표 픽스처. `constituent_symbols`가 400~600개인 표를 고르므로 그만큼 만든다.
# 실제 표의 함정만 남겼다 — 셀마다 줄을 바꾸는 서식, 티커 템플릿, 티커처럼 생긴 섹터 칸.
EXPECTED_TICKERS = [f"T{index:03d}" for index in range(450)]


def _per_line_rows():
    rows = []
    for ticker in EXPECTED_TICKERS:
        rows.append("|-")
        rows.append(f"|{{{{NyseSymbol|{ticker}}}}}")
        rows.append(f"|[[Company {ticker}]]")
        rows.append("|IT")          # 티커처럼 생긴 섹터 칸
        rows.append("|Texas")
    return "\n".join(rows)


def _inline_rows():
    return "\n".join(
        f"|-\n|{{{{NyseSymbol|{ticker}}}}}\n|[[Company {ticker}]]|| IT || Texas"
        for ticker in EXPECTED_TICKERS
    )


PER_LINE_TABLE = '{| class="wikitable"\n! Ticker\n' + _per_line_rows() + "\n|}"
INLINE_TABLE = '{| class="wikitable"\n! Symbol\n' + _inline_rows() + "\n|}"


class SnapshotTest(unittest.TestCase):
    """과거 판의 구성원 표. "Selected changes"가 빠뜨린 사건을 여기서 되찾는다."""

    def test_only_the_first_cell_of_a_row_is_a_ticker(self):
        """**이것이 이 파서의 함정이다.**

        셀마다 줄을 바꾸는 서식에서 모든 `|` 줄을 행으로 보면 GICS 섹터·본사 같은 다른
        칸까지 티커로 줍는다. 2022년 판이 503개 대신 572개로 나왔다.
        """
        found = constituent_symbols(PER_LINE_TABLE)
        self.assertEqual(found, frozenset(EXPECTED_TICKERS))
        # 섹터 칸의 대문자 낱말이 티커로 들어오면 안 된다.
        self.assertNotIn("IT", found)

    def test_the_inline_style_parses_too(self):
        self.assertEqual(constituent_symbols(INLINE_TABLE), frozenset(EXPECTED_TICKERS))

    def test_a_table_that_is_not_the_constituents_list_is_ignored(self):
        """표를 id로 못 찾는다(2019년쯤에야 붙었다). 400~600개가 나오는 표를 고른다."""
        self.assertEqual(constituent_symbols("{|\n|- \n| AAPL || Apple\n|}"), frozenset())

    def test_a_diff_becomes_add_and_remove_events(self):
        earlier = Snapshot("SP500", 1, "2008-06-20", frozenset({"AAA", "BBB"}))
        later = Snapshot("SP500", 2, "2008-08-30", frozenset({"BBB", "CCC"}))
        self.assertEqual(
            snapshot_changes([earlier, later]),
            [
                ("2008-08-30", "SP500", "add", "CCC", "snapshot", 2),
                ("2008-08-30", "SP500", "remove", "AAA", "snapshot", 2),
            ],
        )

    def test_the_event_date_is_the_later_revision(self):
        """"늦어도 이 날에는 반영돼 있었다". 편출을 늦게 잡는 쪽이 보수적이지 않지만,
        앞쪽 판으로 당기면 실제 구성원이던 기간이 잘려 또 다른 왜곡이 된다."""
        events = snapshot_changes([
            Snapshot("SP500", 1, "2009-01-01", frozenset({"AAA"})),
            Snapshot("SP500", 2, "2009-02-01", frozenset()),
        ])
        self.assertEqual(events[0][0], "2009-02-01")

    def test_an_excluded_symbol_does_not_leak_back_in(self):
        """**제외는 한 소스가 아니라 그 심볼에 걸려야 한다.**

        `ACE`는 옛 The Chubb Corporation이라 가격을 구할 수 없어 공고 행에서 뺐는데,
        구성원 표에는 그대로 있으므로 diff가 같은 심볼을 되살린다.
        """
        events = snapshot_changes([
            Snapshot("SP500", 1, "2016-01-01", frozenset({"ACE", "AAA"})),
            Snapshot("SP500", 2, "2016-02-01", frozenset({"AAA"})),
        ])
        self.assertEqual(events, [])

    def test_when_issued_and_preferred_lines_are_not_index_events(self):
        """분사 때의 when-issued 라인과 우선주는 구성원 표에 잠깐 나타날 뿐이다."""
        events = snapshot_changes([
            Snapshot("SP500", 1, "2012-09-01", frozenset({"AAA"})),
            Snapshot("SP500", 2, "2012-10-01", frozenset({"AAA", "KRFTV", "SGPPRB"})),
        ])
        self.assertEqual(events, [])

    def test_a_spelling_flip_is_not_a_pair_of_events(self):
        """18년치 손편집이라 클래스주 표기가 흔들린다. 표기 변경은 지수 사건이 아니다."""
        spelling = canonical_spelling({"BF-B", "BRK-B"})
        events = snapshot_changes([
            Snapshot("SP500", 1, "2011-08-01", frozenset({"BFB", "BRKB"})),
            Snapshot("SP500", 2, "2011-09-01", frozenset({"BF-B", "BRK-B"})),
        ], spelling)
        self.assertEqual(events, [])
        # 현재 구성원이 아닌 옛 클래스주는 정규화가 못 잡으므로 같은 단계 쌍으로 상쇄한다.
        self.assertEqual(snapshot_changes([
            Snapshot("SP500", 1, "2010-10-01", frozenset({"VIAB"})),
            Snapshot("SP500", 2, "2010-11-01", frozenset({"VIA-B"})),
        ]), [])

    def test_every_ignored_symbol_states_its_evidence(self):
        for symbol, evidence in SNAPSHOT_IGNORED:
            self.assertTrue(symbol.strip() and evidence.strip(), symbol)

    def test_a_rename_is_not_a_pair_of_events(self):
        """개명을 그대로 두면 편출+편입 한 쌍으로 잡혀 없는 사건이 두 개 생긴다."""
        events = snapshot_changes([
            Snapshot("SP500", 1, "2013-01-01", frozenset({"FB"})),
            Snapshot("SP500", 2, "2023-01-01", frozenset({"META"})),
        ])
        self.assertEqual(events, [])


class ExclusionTest(unittest.TestCase):
    def test_an_excluded_row_does_not_reach_the_csv(self):
        lines = parse_changes(SP_STYLE, "SP500").splitlines()
        self.assertFalse([line for line in lines if ",remove,ACE," in line])
        # 같은 날 편입된 EXR은 그대로 남는다. 제외는 그 한 행에만 듣는다.
        self.assertTrue(has_change(lines, "2016-01-19,SP500,add,EXR"))

    def test_a_vanished_target_is_refused_not_ignored(self):
        """표가 고쳐져 대상 행이 사라지면 그때가 근거를 다시 볼 순간이다."""
        without_ace = SP_STYLE.replace("|January 19, 2016 || EXR", "|January 19, 2016 || EXR2")
        without_ace = without_ace.replace("|| ACE  ||", "|| ACEX ||")
        with self.assertRaises(WikipediaError):
            parse_changes(without_ace, "SP500")

    def test_since_does_not_trip_the_refusal(self):
        """구간 밖으로 잘린 제외 대상은 없어진 것이 아니라 범위 밖이다."""
        lines = parse_changes(SP_STYLE, "SP500", since="2020-01-01").splitlines()
        self.assertFalse([line for line in lines if line.startswith("2016-")])


if __name__ == "__main__":
    unittest.main()
