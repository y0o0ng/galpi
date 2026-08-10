"""QQQ 보유 명세 파싱. 네트워크 없이 픽스처로 확인한다.

가장 중요한 테스트 둘이다.

- `test_a_list_outside_the_band_is_refused`: 94개짜리 명단을 그대로 쓰면 다음 판과의
  diff에서 있지도 않은 편출이 여섯 건 생긴다. **틀린 명단은 없는 것보다 나쁘다.**
- `test_two_share_classes_are_not_collapsed`: 클래스를 뗀 되짚기가 `GOOGL`과 `GOOG`를
  한 티커로 합치면 한 회사가 두 종목 자리를 차지한다.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

TRADING_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TRADING_ROOT))

from backtest.qqq import (  # noqa: E402
    IGNORED_NAMES,
    MEMBER_BAND,
    NAME_OVERRIDES,
    Filing,
    Holdings,
    QqqError,
    holdings_from,
    NameObservation,
    normalize,
    parse_filings,
    parse_nport_names,
    parse_report_names,
    resolve_names,
    snapshot_changes,
    snapshot_changes_csv,
)

LOW, HIGH = MEMBER_BAND


def report(names: list[str], *, shares_first: bool = False) -> str:
    """주주 보고서 서식. 판마다 이름과 주식 수의 순서가 뒤집힌다."""
    rows = []
    for index, name in enumerate(names):
        shares = f"{(index + 1) * 1000:,}"
        rows.append(
            f"<tr><td>{shares}</td><td>{name}</td><td>$</td><td>9,999</td></tr>"
            if shares_first
            else f"<tr><td>{name}</td><td>{shares}</td><td>$</td><td>9,999</td></tr>"
        )
    return (
        "<p>Schedule of Investments</p><table>"
        + "".join(rows)
        + "</table><p>Statement of Assets and Liabilities</p>"
        + "<table><tr><td>Net investment income</td><td>12,345</td></tr>"
        + "<tr><td>Beginning of year</td><td>67,890</td></tr></table>"
    )


def members(count: int, prefix: str = "Company") -> list[str]:
    return [f"{prefix} {index:03d}, Inc." for index in range(count)]


class FilingsTest(unittest.TestCase):
    def payload(self, **changes) -> dict:
        recent = {
            "form": ["N-30B-2", "NPORT-P", "NSAR-U"],
            "filingDate": ["2012-01-20", "2019-11-29", "2018-01-24"],
            "reportDate": ["2011-09-30", "2019-09-30", "2017-09-30"],
            "accessionNumber": ["a-1", "a-2", "a-3"],
            "primaryDocument": ["r.htm", "xslFormNPORT-P_X01/primary_doc.xml", "n.txt"],
        }
        recent.update(changes)
        return {"filings": {"recent": recent}}

    def test_only_holding_forms_are_kept(self):
        found = parse_filings(self.payload())
        self.assertEqual([item.form for item in found], ["N-30B-2", "NPORT-P"])

    def test_filings_are_ordered_by_report_date(self):
        """**제출일이 아니라 기준일 순이다.** 2012-01-20에 낸 것이 2011-09-30 명세다."""
        found = parse_filings(self.payload())
        self.assertEqual([item.report_date for item in found],
                         ["2011-09-30", "2019-09-30"])

    def test_the_nport_viewer_path_is_stripped(self):
        """`primaryDocument`가 XSL 뷰어 경로다. 그대로 받으면 XML이 아니라 HTML이 온다."""
        found = parse_filings(self.payload())
        self.assertTrue(found[1].url.endswith("/primary_doc.xml"))
        self.assertNotIn("xslFormNPORT-P", found[1].url)

    def test_a_missing_column_is_refused(self):
        payload = self.payload()
        del payload["filings"]["recent"]["reportDate"]
        with self.assertRaises(QqqError):
            parse_filings(payload)


class ReportParsingTest(unittest.TestCase):
    def test_the_two_layouts_both_parse(self):
        """2011년 판은 `이름 / 주식수`, 2016년 판은 `주식수 / 이름`이다."""
        names = members(LOW + 3)
        for shares_first in (False, True):
            found = parse_report_names(report(names, shares_first=shares_first))
            self.assertEqual(len(found), len(names), shares_first)
            self.assertEqual(found[0], names[0])

    def test_the_statements_after_the_schedule_are_not_holdings(self):
        """`Net investment income`도 `이름 + 숫자` 모양이다. 명세가 끝나면 자른다."""
        found = parse_report_names(report(members(LOW + 3)))
        self.assertNotIn("Net investment income", found)
        self.assertNotIn("Beginning of year", found)

    def test_a_list_outside_the_band_is_refused(self):
        """**밴드가 파서를 고르는 심판이다.** 어느 읽기도 안 맞으면 그 판을 버린다.

        94개짜리 명단을 그대로 쓰면 다음 판과의 diff에서 없던 편출이 여섯 건 생긴다.
        """
        self.assertEqual(parse_report_names(report(members(LOW - 1))), [])
        self.assertEqual(parse_report_names(report(members(HIGH + 1))), [])

    def test_the_as_of_comes_from_the_filing_not_the_body(self):
        """본문의 제목 줄은 판마다 다르다. 기준일은 구조화된 `reportDate`를 쓴다."""
        filing = Filing(form="N-30B-2", filed="2012-01-20", report_date="2011-09-30",
                        accession="a-1", document="r.htm")
        holdings = holdings_from(filing, report(members(LOW + 1)))
        self.assertEqual(holdings.as_of, "2011-09-30")

    def test_an_unreadable_report_is_refused(self):
        filing = Filing(form="N-30B-2", filed="2012-01-20", report_date="2011-09-30",
                        accession="a-1", document="r.htm")
        with self.assertRaises(QqqError):
            holdings_from(filing, "<p>nothing here</p>")


class NportParsingTest(unittest.TestCase):
    def document(self) -> str:
        return """
        <invstOrSec><name>Alphabet Inc.</name>
          <title>Alphabet Inc., Class A</title><assetCat>EC</assetCat></invstOrSec>
        <invstOrSec><name>Alphabet Inc.</name>
          <title>Alphabet Inc., Class C</title><assetCat>EC</assetCat></invstOrSec>
        <invstOrSec><name>Cash Collateral</name>
          <title>Cash Collateral</title><assetCat>STIV</assetCat></invstOrSec>
        """

    def test_the_title_carries_the_share_class(self):
        """`name`은 두 클래스가 같다. `title`만 `GOOGL`과 `GOOG`를 가른다."""
        self.assertEqual(
            parse_nport_names(self.document()),
            ["Alphabet Inc., Class A", "Alphabet Inc., Class C"],
        )

    def test_non_equity_rows_are_dropped(self):
        self.assertNotIn("Cash Collateral", parse_nport_names(self.document()))


class NormalizeTest(unittest.TestCase):
    def test_a_footnote_marker_is_stripped_before_punctuation(self):
        """**순서가 중요하다.** `(a)`를 남기면 구두점 단계에서 클래스 A와 섞인다."""
        self.assertEqual(normalize("Akamai Technologies, Inc. (a)"), "AKAMAI TECHNOLOGIES")
        self.assertEqual(normalize("Akamai Technologies, Inc."), "AKAMAI TECHNOLOGIES")

    def test_the_share_class_survives(self):
        self.assertNotEqual(
            normalize("Alphabet Inc., Class A"), normalize("Alphabet Inc., Class C")
        )

    def test_a_dotted_suffix_is_joined_before_removal(self):
        """`N.V.`를 공백으로 끊으면 두 낱말이 되어 꼬리표 목록에 안 걸린다."""
        self.assertEqual(normalize("ASML Holding N.V."), "ASML")

    def test_spelling_variants_land_on_one_key(self):
        for variant in ("Apple, Inc.", "Apple Inc", "APPLE INC."):
            self.assertEqual(normalize(variant), "APPLE")


def seen(symbol: str, date: str = "2010-01-01", action: str = "add") -> tuple:
    return (NameObservation(date=date, action=action, symbol=symbol),)


class ResolveTest(unittest.TestCase):
    def test_the_class_is_tried_first_then_dropped(self):
        """명세는 `Facebook, Inc., Class A`인데 사전은 그냥 `Facebook`이다."""
        resolved, unresolved = resolve_names(
            ["Facebook, Inc., Class A"], {normalize("Facebook"): seen("META")}, "2015-01-01"
        )
        self.assertEqual(resolved, {"Facebook, Inc., Class A": "META"})
        self.assertEqual(unresolved, [])

    def test_two_share_classes_are_not_collapsed(self):
        """**한 회사가 두 티커를 오가면 안 된다.** 어느 쪽이 `GOOGL`인지 명세는 모른다."""
        resolved, unresolved = resolve_names(
            ["Alphabet Inc., Class A", "Alphabet Inc., Class C"],
            {normalize("Alphabet"): seen("GOOGL")},
            "2015-01-01",
        )
        self.assertEqual(resolved, {})
        self.assertEqual(len(unresolved), 2)

    def test_an_old_and_a_new_name_may_share_a_ticker(self):
        """같은 회사의 옛 이름과 새 이름이 한 티커로 가는 것은 **맞는 결과**다."""
        resolved, _ = resolve_names(
            ["Facebook, Inc., Class A", "Meta Platforms, Inc., Class A"],
            {normalize("Facebook"): seen("META"),
             normalize("Meta Platforms Inc"): seen("META")},
            "2015-01-01",
        )
        self.assertEqual(set(resolved.values()), {"META"})

    def test_an_unknown_name_is_reported_not_guessed(self):
        """못 푼 이름이 곧 우리가 찾던 사라진 회사다. 추측으로 메우면 목적이 사라진다."""
        resolved, unresolved = resolve_names(["Nobody Ltd."], {}, "2015-01-01")
        self.assertEqual(resolved, {})
        self.assertEqual(unresolved, ["Nobody Ltd."])

    def test_the_fund_itself_is_not_a_holding(self):
        for name in (IGNORED_NAMES[0], f"{IGNORED_NAMES[0]}, Series 1"):
            resolved, unresolved = resolve_names([name], {}, "2015-01-01")
            self.assertEqual((resolved, unresolved), ({}, []))

    def test_every_override_states_its_evidence(self):
        for name, symbol, evidence in NAME_OVERRIDES:
            self.assertTrue(name.strip() and symbol.strip() and evidence.strip())


class TickerOnTest(unittest.TestCase):
    """**사전이 날짜를 알아야 한다.** `Baker Hughes`가 같은 날 `BHI`로 빠지고 `BKR`로 든다."""

    def observations(self) -> tuple:
        return (
            NameObservation(date="2017-07-07", action="remove", symbol="BHI"),
            NameObservation(date="2017-07-07", action="add", symbol="BKR"),
        )

    def test_after_the_change_the_add_wins(self):
        from backtest.qqq import ticker_on

        self.assertEqual(ticker_on(self.observations(), "2022-12-31"), "BKR")

    def test_before_the_change_the_remove_wins(self):
        from backtest.qqq import ticker_on

        self.assertEqual(ticker_on(self.observations(), "2012-09-30"), "BHI")

    def test_no_observation_gives_nothing(self):
        from backtest.qqq import ticker_on

        self.assertIsNone(ticker_on((), "2012-09-30"))


class ChangesTest(unittest.TestCase):
    def snapshot(self, as_of: str, names: list[str]) -> Holdings:
        return Holdings(as_of=as_of, form="N-30B-2", accession=f"acc-{as_of}",
                        names=tuple(names))

    def test_a_diff_becomes_add_and_remove_events(self):
        dictionary = {normalize(name): seen(symbol) for name, symbol in
                      (("A Corp.", "AAA"), ("B Corp.", "BBB"), ("C Corp.", "CCC"))}
        events, _ = snapshot_changes(
            [self.snapshot("2012-09-30", ["A Corp.", "B Corp."]),
             self.snapshot("2013-09-30", ["B Corp.", "C Corp."])],
            dictionary,
        )
        self.assertEqual(
            [(item[0], item[2], item[3]) for item in events],
            [("2013-09-30", "add", "CCC"), ("2013-09-30", "remove", "AAA")],
        )

    def test_unresolved_names_make_no_events(self):
        """못 푼 이름은 양쪽에서 다 빠지므로 유령 편출을 만들지 않는다."""
        events, unresolved = snapshot_changes(
            [self.snapshot("2012-09-30", ["A Corp.", "Mystery Ltd."]),
             self.snapshot("2013-09-30", ["A Corp."])],
            {normalize("A Corp."): seen("AAA")},
        )
        self.assertEqual(events, [])
        self.assertEqual(unresolved, ["Mystery Ltd."])

    def test_a_class_only_fragment_is_not_a_holding(self):
        """줄바꿈으로 쪼개진 이름의 꼬리(`Class A`)가 사전의 아무 회사에 붙으면 안 된다."""
        resolved, unresolved = resolve_names(
            ["Class A"], {normalize("Some LLC"): seen("LLC")}, "2013-09-30"
        )
        self.assertEqual((resolved, unresolved), ({}, []))

    def test_the_csv_matches_the_wikipedia_snapshot_contract(self):
        """같은 열 계약이라야 `merge_changes`의 같은 병합 경로를 탄다."""
        text = snapshot_changes_csv(
            [("2013-09-30", "NDX100", "add", "CCC", "qqq", "acc-1")]
        )
        self.assertEqual(text.splitlines()[0], "date,index_name,action,symbol,source,revid")
        self.assertEqual(text.splitlines()[1], "2013-09-30,NDX100,add,CCC,qqq,acc-1")


if __name__ == "__main__":
    unittest.main()
