"""EDGAR 수집기. 네트워크 없이 픽스처로만 확인한다.

가장 중요한 테스트는 `EstimateSafetyTest`다. 추정 캘린더가 실제 발표보다 **이른** 쪽으로
기울어야 하고, 추정일과 실제 발표 사이 공백에서 `next_earnings`가 None을 주어
`EARNINGS_UNKNOWN` 차단이 걸려야 한다. 그 두 개가 맞물려야 점 추정이 안전하다.
"""

from __future__ import annotations

import sys
import unittest
from datetime import date, timedelta
from pathlib import Path

TRADING_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TRADING_ROOT))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import synthetic  # noqa: E402
from backtest import store  # noqa: E402
from backtest.data import (  # noqa: E402
    PointInTimeSnapshot,
    load_bars_csv,
    register_source,
)
from backtest.edgar import (  # noqa: E402
    CIK_OVERRIDES,
    FALLBACK_GAP_DAYS,
    Company,
    Coverage,
    EdgarClient,
    EdgarError,
    build_earnings_rows,
    collect,
    earnings_csv,
    earnings_dates_from_block,
    estimate_gap_days,
    CikNameIndex,
    normalize_company_name,
    parse_cik_lookup,
    parse_ticker_map,
    resolve_by_name,
    resolve_cik,
    sector_from_submissions,
    securities_csv,
)

VERSION = "v1"


def block(rows: list[tuple[str, str, str]]) -> dict:
    """(form, filingDate, items) 목록을 submissions 블록 모양으로."""
    return {
        "form": [row[0] for row in rows],
        "filingDate": [row[1] for row in rows],
        "items": [row[2] for row in rows],
    }


def quarterly(count: int, start: str = "2015-01-28", gap: int = 91) -> list[str]:
    first = date.fromisoformat(start)
    return [(first + timedelta(days=gap * index)).isoformat() for index in range(count)]


class TickerMapTest(unittest.TestCase):
    def test_cik_is_zero_padded_and_ticker_upper(self):
        payload = {
            "0": {"cik_str": 320193, "ticker": "aapl", "title": "Apple Inc."},
            "1": {"cik_str": 789019, "ticker": "MSFT", "title": "Microsoft"},
        }
        companies = parse_ticker_map(payload)
        self.assertEqual(companies["AAPL"], Company("AAPL", "0000320193", "Apple Inc."))
        self.assertEqual(companies["MSFT"].cik, "0000789019")

    def test_rows_without_a_ticker_are_dropped(self):
        payload = {"0": {"cik_str": 1, "ticker": "", "title": "No ticker"},
                   "1": {"cik_str": 2, "ticker": "OK", "title": "Fine"}}
        self.assertEqual(set(parse_ticker_map(payload)), {"OK"})

    def test_an_empty_map_is_an_error(self):
        with self.assertRaises(EdgarError):
            parse_ticker_map({})


class ItemFilterTest(unittest.TestCase):
    def test_only_8k_item_2_02_counts_as_earnings(self):
        found = earnings_dates_from_block(
            block(
                [
                    ("8-K", "2026-01-29", "2.02,9.01"),
                    ("8-K", "2026-02-10", "5.02"),  # 임원 변경
                    ("10-Q", "2026-02-01", ""),  # 분기보고서는 발표일이 아니다
                    ("8-K", "2026-04-30", "2.02"),
                    ("8-K/A", "2026-05-01", "2.02"),  # 정정은 새 발표가 아니다
                ]
            )
        )
        self.assertEqual(found, ["2026-01-29", "2026-04-30"])

    def test_a_block_without_items_yields_nothing(self):
        self.assertEqual(
            earnings_dates_from_block({"form": ["8-K"], "filingDate": ["2026-01-01"]}), []
        )


class SectorTest(unittest.TestCase):
    def test_sic_is_reduced_to_the_two_digit_major_group(self):
        self.assertEqual(sector_from_submissions({"sic": "3571"}), "SIC35")
        self.assertEqual(sector_from_submissions({"sic": "7372"}), "SIC73")
        self.assertEqual(sector_from_submissions({"sic": "0100"}), "SIC01")

    def test_a_missing_or_bad_sic_is_none(self):
        self.assertIsNone(sector_from_submissions({}))
        self.assertIsNone(sector_from_submissions({"sic": ""}))
        self.assertIsNone(sector_from_submissions({"sic": "n/a"}))

    def test_semiconductors_and_software_land_in_different_buckets(self):
        """GICS라면 둘 다 정보기술이다. SIC 대분류는 다르게 나눈다는 사실을 고정한다."""
        self.assertNotEqual(
            sector_from_submissions({"sic": "3674"}),  # 반도체
            sector_from_submissions({"sic": "7372"}),  # 소프트웨어
        )


class GapEstimateTest(unittest.TestCase):
    def test_a_clean_quarterly_series_gives_that_gap(self):
        self.assertEqual(estimate_gap_days(quarterly(10, gap=91)), 91)

    def test_non_quarterly_outliers_are_excluded(self):
        # 27일 간격의 비분기 2.02 제출이 섞여도 추정이 무너지지 않는다.
        dates = quarterly(8, gap=91)
        polluted = sorted(dates + [(date.fromisoformat(dates[3]) + timedelta(days=27)).isoformat()])
        self.assertGreaterEqual(estimate_gap_days(polluted), 60)

    def test_the_estimate_leans_early(self):
        """간격이 흔들리면 짧은 쪽을 택한다. 늦은 추정은 실적을 맞는다."""
        first = date.fromisoformat("2015-01-28")
        dates, cursor = [first.isoformat()], first
        for gap in (85, 98, 91, 88, 95, 92, 87, 96):
            cursor += timedelta(days=gap)
            dates.append(cursor.isoformat())
        estimate = estimate_gap_days(dates)
        self.assertLessEqual(estimate, 88)
        self.assertGreaterEqual(estimate, 60)

    def test_too_few_observations_fall_back(self):
        self.assertEqual(estimate_gap_days([]), FALLBACK_GAP_DAYS)
        self.assertEqual(estimate_gap_days(quarterly(2)), FALLBACK_GAP_DAYS)


class RowBuildTest(unittest.TestCase):
    def test_each_actual_yields_a_confirmed_and_an_estimated_row(self):
        rows = build_earnings_rows("AAA", quarterly(4, gap=91))
        self.assertEqual(len(rows), 8)
        confirmed = [row for row in rows if row["confidence"] == "confirmed"]
        estimated = [row for row in rows if row["confidence"] == "estimated"]
        self.assertEqual(len(confirmed), 4)
        self.assertEqual(len(estimated), 4)

    def test_confirmed_rows_are_inert_for_forward_lookups(self):
        """실제 발표일 행은 published_at == event_at이라 결정에 걸리지 않는다."""
        for row in build_earnings_rows("AAA", quarterly(3)):
            if row["confidence"] == "confirmed":
                self.assertEqual(row["published_at"], row["event_at"])

    def test_an_estimate_is_published_on_the_prior_actual(self):
        rows = build_earnings_rows("AAA", quarterly(3, start="2015-01-28", gap=91))
        estimated = [row for row in rows if row["confidence"] == "estimated"]
        self.assertEqual(estimated[0]["published_at"], "2015-01-28")
        self.assertGreater(estimated[0]["event_at"], estimated[0]["published_at"])

    def test_no_dates_yields_no_rows(self):
        self.assertEqual(build_earnings_rows("AAA", []), [])


class EstimateSafetyTest(unittest.TestCase):
    """추정이 이르고, 그 공백에서 진입이 막히는지 실제 스냅샷으로 확인한다."""

    def setUp(self):
        self.dates = synthetic.sessions(400)
        self.connection = store.connect_memory()
        register_source(self.connection, "synthetic", VERSION, "bars")
        load_bars_csv(
            self.connection,
            synthetic.to_csv(
                synthetic.rows("SPY", self.dates, synthetic.constant_closes(400, 400.0))
            ),
            "synthetic",
            VERSION,
        )
        register_source(self.connection, "sec-edgar", VERSION, "earnings")

    def load(self, actual_dates: list[str]) -> None:
        from backtest.data import load_earnings_csv

        load_earnings_csv(
            self.connection,
            earnings_csv(build_earnings_rows("AAA", actual_dates)),
            "sec-edgar",
            VERSION,
        )

    def snapshot(self, as_of: str) -> PointInTimeSnapshot:
        return PointInTimeSnapshot(self.connection, as_of, VERSION)

    def test_the_estimate_is_visible_from_the_prior_actual(self):
        actual = [self.dates[10], self.dates[110]]
        self.load(actual)
        # 직전 실제 발표 전에는 아무것도 모른다.
        self.assertIsNone(self.snapshot(self.dates[5]).next_earnings("AAA"))
        # 발표 당일 종가부터 다음 추정이 보인다.
        forward = self.snapshot(self.dates[10]).next_earnings("AAA")
        self.assertIsNotNone(forward)
        self.assertGreater(forward, self.dates[10])

    def test_the_gap_after_an_early_estimate_blocks_entry(self):
        """추정일이 지나고 실제 발표가 아직이면 None이다.

        None이면 `require_earnings_calendar`가 `EARNINGS_UNKNOWN`으로 진입을 막으므로,
        이 공백에서 재진입해 실적을 맞는 일이 없다. 점 추정이 안전한 이유다.
        """
        actual = [self.dates[10], self.dates[200]]
        self.load(actual)
        estimate = self.snapshot(self.dates[10]).next_earnings("AAA")
        after_estimate = (
            date.fromisoformat(estimate[:10]) + timedelta(days=1)
        ).isoformat()
        later = next(value for value in self.dates if value >= after_estimate)
        self.assertIsNone(self.snapshot(later).next_earnings("AAA"))

    def test_a_second_actual_publishes_a_fresh_estimate(self):
        actual = quarterly(6, start=self.dates[10], gap=91)
        self.load(actual)
        first = self.snapshot(self.dates[10]).next_earnings("AAA")
        later_session = next(value for value in self.dates if value >= actual[1])
        second = self.snapshot(later_session).next_earnings("AAA")
        self.assertIsNotNone(second)
        self.assertGreater(second, first)


class CollectTest(unittest.TestCase):
    class FakeClient(EdgarClient):
        def __init__(self, payloads: dict[str, dict]) -> None:
            super().__init__(contact="test@example.com", interval=0.0)
            self.payloads = payloads

        def ticker_map(self):
            return {
                "AAA": Company("AAA", "0000000001", "Alpha"),
                "BBB": Company("BBB", "0000000002", "Beta"),
            }

        def all_earnings_dates(self, cik: str, window_start=None):
            payload = self.payloads[cik]
            return payload["dates"], payload["submissions"]

        def text(self, url: str) -> str:
            # 2층은 네트워크로 나간다. 테스트에서는 못 찾은 것으로 둔다.
            return ""

    def test_collect_writes_earnings_and_sectors(self):
        connection = store.connect_memory()
        client = self.FakeClient(
            {
                "0000000001": {
                    "dates": quarterly(4),
                    "submissions": {"sic": "3674"},
                },
                "0000000002": {
                    "dates": quarterly(4, start="2015-02-10"),
                    "submissions": {"sic": "7372"},
                },
            }
        )
        summary = collect(connection, ["AAA", "BBB", "ZZZ"], VERSION, client=client)
        self.assertEqual(summary["missing"], ["ZZZ"])  # ZZZ는 매핑에 없다
        self.assertEqual(summary["earnings_rows"], 16)
        self.assertEqual(summary["sectors"], 2)

        rows = connection.execute(
            "SELECT confidence, COUNT(*) AS n FROM earnings_calendar GROUP BY confidence"
        ).fetchall()
        self.assertEqual({row["confidence"]: row["n"] for row in rows},
                         {"confirmed": 8, "estimated": 8})
        sectors = dict(
            connection.execute("SELECT symbol, sector FROM securities").fetchall()
        )
        self.assertEqual(sectors, {"AAA": "SIC36", "BBB": "SIC73"})

    def test_sources_are_registered_as_point_in_time_and_unbiased(self):
        connection = store.connect_memory()
        client = self.FakeClient(
            {"0000000001": {"dates": quarterly(4), "submissions": {"sic": "3674"}},
             "0000000002": {"dates": [], "submissions": {}}}
        )
        collect(connection, ["AAA", "BBB"], VERSION, client=client)
        rows = connection.execute(
            "SELECT kind, point_in_time, survivorship_biased, note FROM data_sources"
            " WHERE source = 'sec-edgar' ORDER BY kind"
        ).fetchall()
        by_kind = {row["kind"]: row for row in rows}
        self.assertEqual(by_kind["earnings"]["point_in_time"], 1)
        self.assertEqual(by_kind["earnings"]["survivorship_biased"], 0)
        # 섹터는 현재 SIC라 point-in-time이 아니다. 그 사실을 기록으로 남긴다.
        self.assertEqual(by_kind["securities"]["point_in_time"], 0)
        self.assertIn("GICS", by_kind["securities"]["note"])


class CikResolutionTest(unittest.TestCase):
    """티커→CIK가 과거를 잃는 경우. 실측: XOM이 이력 없는 지주회사로 간다."""

    def setUp(self):
        self.companies = {
            "XOM": Company("XOM", "0002115436", "ExxonMobil Holdings Corp"),
            "AAA": Company("AAA", "0000000001", "Alpha"),
        }

    def test_a_pinned_ticker_uses_the_predecessor_cik(self):
        cik, pinned = resolve_cik("XOM", self.companies)
        self.assertEqual(cik, "0000034088")
        self.assertTrue(pinned)
        self.assertNotEqual(cik, self.companies["XOM"].cik)

    def test_an_unpinned_ticker_uses_the_current_mapping(self):
        cik, pinned = resolve_cik("AAA", self.companies)
        self.assertEqual(cik, "0000000001")
        self.assertFalse(pinned)

    def test_an_unknown_ticker_resolves_to_nothing(self):
        self.assertEqual(resolve_cik("ZZZ", self.companies), (None, False))

    def test_overrides_can_be_supplied_per_run(self):
        cik, pinned = resolve_cik("AAA", self.companies, {"AAA": "42"})
        self.assertEqual(cik, "0000000042")
        self.assertTrue(pinned)

    def test_the_discovered_case_is_recorded_in_code(self):
        self.assertIn("XOM", CIK_OVERRIDES)


class NameLookupTest(unittest.TestCase):
    """3층. `company_tickers.json`이 907종목에서 223개를 못 찾아 만든 경로다."""

    DUMP = (
        "LEHMAN BROTHERS HOLDINGS:0001382976:\n"
        "LEHMAN BROTHERS HOLDINGS INC:0000806085:\n"
        "NOVELLUS SYSTEMS INC:0000836106:\n"
        "NOVELLUS LLC:0001687472:\n"
        "쓰레기 줄\n"
        "GENZYME CORP:0000732485:\n"
    )

    def test_the_legal_form_does_not_change_the_key(self):
        """위키는 `Genzyme`, SEC는 `GENZYME CORP`로 적는다. 안 지우면 아무것도 안 맞는다."""
        self.assertEqual(normalize_company_name("Genzyme"), "GENZYME")
        self.assertEqual(normalize_company_name("GENZYME CORP"), "GENZYME")
        self.assertEqual(normalize_company_name("EMC Corporation"), "EMC")

    def test_descriptive_words_survive_the_strict_form(self):
        """`RAYTHEON TECHNOLOGIES`(현 RTX)와 `RAYTHEON CO`는 **다른 회사다.**

        서술어까지 지우면 둘이 같은 키가 되어 후보에 섞인다. 그래서 그 정규형은 기본이
        아니라 엄격한 쪽이 빈손일 때만 쓰는 폴백이다.
        """
        self.assertNotEqual(
            normalize_company_name("Raytheon Technologies Corp"),
            normalize_company_name("Raytheon Co"),
        )
        self.assertEqual(
            normalize_company_name("Raytheon Technologies Corp", drop_descriptive=True),
            normalize_company_name("Raytheon Co", drop_descriptive=True),
        )

    def test_rows_without_a_cik_are_skipped(self):
        index = parse_cik_lookup(self.DUMP)
        self.assertNotIn("쓰레기 줄", index.strict)
        self.assertEqual(index.candidates("Genzyme"), ["0000732485"])

    def test_the_strict_index_is_tried_first(self):
        """`Novellus Systems`는 엄격한 쪽에서 정확히 하나로 맞는다.

        느슨한 쪽을 먼저 보면 `NOVELLUS LLC`까지 끌어와 쓸데없이 후보가 는다.
        """
        index = parse_cik_lookup(self.DUMP)
        self.assertEqual(index.candidates("Novellus Systems"), ["0000836106"])
        # 엄격한 쪽에 맞는 것이 있으면 거기서 끝난다. `Novellus`는 `NOVELLUS LLC`에
        # 정확히 맞으므로 느슨한 쪽(`Novellus Systems`까지 끌어오는)으로 내려가지 않는다.
        self.assertEqual(index.candidates("Novellus"), ["0001687472"])

    def test_two_entities_collapse_to_one_key(self):
        """**이것이 이 경로의 위험이다.**

        `LEHMAN BROTHERS HOLDINGS`(신탁)와 `LEHMAN BROTHERS HOLDINGS INC`(지주회사)는
        엄격한 정규형에서도 같은 키다. 조용히 첫 번째를 고르면 자신 있게 틀린다.
        """
        index = parse_cik_lookup(self.DUMP)
        self.assertEqual(
            index.strict["LEHMAN BROTHERS HOLDINGS"], {"0001382976", "0000806085"}
        )

    class FakeClient(EdgarClient):
        def __init__(self, payloads):
            super().__init__(contact="test@example.com", interval=0.0)
            self.payloads = payloads

        def submissions(self, cik):
            return self.payloads[cik]

        def all_earnings_dates(self, cik, window_start=None):
            return self.payloads[cik].get("earnings", []), self.payloads[cik]

    @staticmethod
    def _submissions(sic, first, last, form="8-K"):
        return {
            "name": "X",
            "sic": sic,
            "filings": {"recent": {"filingDate": [first, last], "form": [form, form]}},
        }

    def test_the_candidate_outside_the_membership_window_is_dropped(self):
        """실측: Novellus 후보 4개 중 구간에 겹치는 것은 Novellus Systems 하나다."""
        payloads = {
            "0000836106": self._submissions("3559", "1994-02-14", "2013-02-14"),
            "0001687472": self._submissions("3559", "2016-10-19", "2018-03-07"),
        }
        payloads["0000836106"]["earnings"] = ["2009-01-26", "2011-04-19"]
        client = self.FakeClient(payloads)
        index = CikNameIndex(strict={"NOVELLUS SYSTEMS": {"0000836106", "0001687472"}}, loose={})
        cik, survivors = resolve_by_name(
            client, "Novellus Systems", index, span=("2008-01-02", "2012-06-05")
        )
        self.assertEqual(cik, "0000836106")
        self.assertEqual(len(survivors), 1)

    def test_a_non_filer_is_dropped(self):
        """8-K를 낸 적이 없으면 상장 발행사가 아니다(신탁·자회사·특수목적법인)."""
        payloads = {
            "0000836106": self._submissions("3559", "1994-02-14", "2013-02-14"),
            "0001687472": self._submissions("3559", "2007-01-02", "2013-01-02", "S-1"),
        }
        payloads["0000836106"]["earnings"] = ["2009-01-26"]
        payloads["0001687472"]["earnings"] = ["2009-02-02"]
        client = self.FakeClient(payloads)
        index = CikNameIndex(strict={"NOVELLUS SYSTEMS": {"0000836106", "0001687472"}}, loose={})
        cik, _ = resolve_by_name(
            client, "Novellus Systems", index, span=("2008-01-02", "2012-06-05")
        )
        self.assertEqual(cik, "0000836106")

    def test_two_survivors_are_refused_not_guessed(self):
        """리먼이 이 모양이다. 후보를 돌려주고 사람이 CIK_OVERRIDES에 넣는다."""
        client = self.FakeClient(
            {
                "0000806085": self._submissions("6211", "1994-01-07", "2025-08-28"),
                "0001382976": self._submissions("6211", "2002-01-29", "2019-05-22"),
            }
        )
        index = CikNameIndex(strict={"LEHMAN BROTHERS": {"0000806085", "0001382976"}}, loose={})
        cik, survivors = resolve_by_name(
            client, "Lehman Brothers", index, span=("2008-01-02", "2008-09-16")
        )
        self.assertIsNone(cik)
        self.assertEqual({item.cik for item in survivors}, {"0000806085", "0001382976"})

    def test_a_lone_candidate_still_has_to_file_earnings(self):
        """**후보가 하나뿐이어도 실적을 확인한다.**

        이 검사를 건너뛰었을 때 `LEH`가 `LEHMAN BROTHERS INC//`(브로커딜러 자회사,
        구간 내 실적 0건)로 갔다. 지수 구성원은 실적을 발표하는 상장 발행사다.
        """
        payloads = {"0000728586": self._submissions("6211", "1994-01-07", "2008-05-01")}
        payloads["0000728586"]["earnings"] = []
        client = self.FakeClient(payloads)
        index = CikNameIndex(strict={"LEHMAN BROTHERS": {"0000728586"}}, loose={})
        cik, survivors = resolve_by_name(
            client, "Lehman Brothers", index, span=("2008-01-02", "2008-09-16")
        )
        self.assertIsNone(cik)
        self.assertEqual(len(survivors), 1)

    def test_the_subsidiary_that_files_no_earnings_loses(self):
        """`LEHMAN BROTHERS INC//`(브로커딜러 자회사)와 지주회사는 이름으로도 SIC로도
        안 갈린다. **분기 실적 8-K를 내는 쪽이 지수 구성원이다.**"""
        payloads = {
            "0000806085": self._submissions("6211", "1994-01-04", "2025-08-28"),
            "0000728586": self._submissions("6211", "1994-01-07", "2008-05-01"),
        }
        payloads["0000806085"]["earnings"] = ["2008-03-18", "2008-06-16"]
        payloads["0000728586"]["earnings"] = []
        client = self.FakeClient(payloads)
        index = CikNameIndex(
            strict={"LEHMAN BROTHERS": {"0000806085", "0000728586"}}, loose={}
        )
        cik, survivors = resolve_by_name(
            client, "Lehman Brothers", index, span=("2008-01-02", "2008-09-16")
        )
        self.assertEqual(cik, "0000806085")
        self.assertEqual(len(survivors), 2)

    def test_two_real_filers_are_still_refused(self):
        """둘 다 실적을 내면 어느 쪽이 구성원이었는지는 제출 기록으로 알 수 없다.

        `RTN`이 그렇다(`RAYTHEON CO`와 `RAYTHEON CO/`). 사람이 판단할 일이다.
        """
        payloads = {
            "0000082267": self._submissions("3812", "1994-02-10", "2013-03-25"),
            "0001047122": self._submissions("3812", "1997-10-06", "2020-04-13"),
        }
        payloads["0000082267"]["earnings"] = ["2009-01-28"]
        payloads["0001047122"]["earnings"] = ["2009-01-28", "2015-01-29"]
        client = self.FakeClient(payloads)
        index = CikNameIndex(
            strict={"RAYTHEON": {"0000082267", "0001047122"}}, loose={}
        )
        cik, survivors = resolve_by_name(
            client, "Raytheon", index, span=("2008-01-02", "2019-07-01")
        )
        self.assertIsNone(cik)
        self.assertEqual(len(survivors), 2)

    def test_an_unknown_name_asks_for_nothing(self):
        client = self.FakeClient({})
        self.assertEqual(
            resolve_by_name(client, "Nowhere", CikNameIndex({}, {}), span=("2008-01-02", "2009-01-02")),
            (None, []),
        )
        self.assertEqual(client.calls, 0)


class CoverageTest(unittest.TestCase):
    """커버리지가 부족한 종목을 조용히 넘기면 재편된 회사가 유니버스에서 빠진다."""

    def test_covers_requires_history_before_the_window(self):
        full = Coverage("AAA", "1", 60, "2010-01-01", "2026-01-01", False)
        late = Coverage("BBB", "2", 2, "2026-07-01", "2026-07-31", False)
        empty = Coverage("CCC", "3", 0, None, None, False)
        self.assertTrue(full.covers("2011-01-03"))
        self.assertFalse(late.covers("2011-01-03"))
        self.assertFalse(empty.covers("2011-01-03"))

    def test_collect_reports_gaps_against_the_window(self):
        connection = store.connect_memory()
        client = CollectTest.FakeClient(
            {
                "0000000001": {
                    "dates": quarterly(40, start="2011-01-28"),
                    "submissions": {"sic": "3674"},
                },
                # 재편된 법인처럼 최근 것만 있는 종목.
                "0000000002": {
                    "dates": ["2026-07-31"],
                    "submissions": {"sic": "2911"},
                },
            }
        )
        summary = collect(
            connection, ["AAA", "BBB"], VERSION, client=client, window_start="2012-01-03"
        )
        gaps = {item.symbol for item in summary["gaps"]}
        self.assertEqual(gaps, {"BBB"})
        covered = {item.symbol: item.count for item in summary["coverage"]}
        self.assertEqual(covered["BBB"], 1)
        self.assertGreater(covered["AAA"], 30)

    def test_a_late_joiner_is_measured_from_when_it_joined(self):
        """2008년 이후 상장한 회사를 전역 시작일과 견주면 907종목에서 245개가 미달로 잡힌다.

        지수에 들어가기 전의 실적일은 애초에 필요하지 않다.
        """
        connection = store.connect_memory()
        client = CollectTest.FakeClient(
            {
                "0000000001": {
                    "dates": quarterly(40, start="2011-01-28"),
                    "submissions": {"sic": "3674"},
                },
                # 2020년에 상장해 그때부터 구성원이 된 회사.
                "0000000002": {
                    "dates": quarterly(20, start="2020-02-10"),
                    "submissions": {"sic": "2911"},
                },
            }
        )
        summary = collect(
            connection,
            ["AAA", "BBB"],
            VERSION,
            client=client,
            window_start="2012-01-03",
            spans={"AAA": ("2012-01-03", "2026-08-08"), "BBB": ("2020-06-01", "2026-08-08")},
        )
        self.assertEqual(summary["gaps"], [])

    def test_no_window_means_no_gap_report(self):
        connection = store.connect_memory()
        client = CollectTest.FakeClient(
            {"0000000001": {"dates": ["2026-07-31"], "submissions": {}},
             "0000000002": {"dates": [], "submissions": {}}}
        )
        summary = collect(connection, ["AAA", "BBB"], VERSION, client=client)
        self.assertEqual(summary["gaps"], [])


class CsvTest(unittest.TestCase):
    def test_csv_matches_the_loader_column_contract(self):
        from backtest.data import EARNINGS_CSV_COLUMNS, SECURITIES_CSV_COLUMNS

        earnings = earnings_csv(build_earnings_rows("AAA", quarterly(2)))
        self.assertEqual(earnings.splitlines()[0].split(","), list(EARNINGS_CSV_COLUMNS))
        securities = securities_csv({"AAA": "SIC36"})
        self.assertEqual(
            securities.splitlines()[0].split(","), list(SECURITIES_CSV_COLUMNS)
        )


if __name__ == "__main__":
    unittest.main()
