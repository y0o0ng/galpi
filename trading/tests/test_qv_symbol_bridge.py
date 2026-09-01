"""universe/market-data 심볼 ↔ SEC 경제적 심볼 명시 다리의 계약.

전부 network-free다. **`trading/universe/reused-tickers.csv`만이 권한이고**
접미사 규칙·현재 ticker 조회·이름 매칭으로 원 심볼을 유도하지 않는다.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

TRADING_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TRADING_ROOT))

from backtest.qv_symbol_bridge import (  # noqa: E402
    BRIDGE_KINDS,
    DEFAULT_REUSED_PATH,
    DIRECT,
    REUSED_VENDOR_SERIES,
    QVSymbolBridgeError,
    content_version,
    load_symbol_bridge,
    parse_symbol_bridge,
)

HEADER = "symbol,valid_from,vendor_symbol,vendor_name"


def csv_text(rows) -> str:
    lines = [HEADER]
    lines.extend(f"{symbol},{valid_from},{vendor}," for symbol, valid_from, vendor in rows)
    return "\n".join(lines) + "\n"


def bridge(rows, *, source="fixture-reused.csv"):
    return parse_symbol_bridge(csv_text(rows), source=source)


class ResolutionTest(unittest.TestCase):
    def test_an_unmapped_symbol_is_its_own_identity_symbol(self):
        found = bridge((("FOXA", "2008-01-02", "TFCFA"),))
        self.assertEqual(found.resolve("AAPL", "2008-01-02"), ("AAPL", DIRECT))

    def test_an_explicit_row_resolves_to_the_original_symbol(self):
        found = bridge((("FOXA", "2008-01-02", "TFCFA"),))
        self.assertEqual(
            found.resolve("TFCFA", "2008-01-02"), ("FOXA", REUSED_VENDOR_SERIES)
        )

    def test_resolution_is_keyed_by_the_membership_interval(self):
        """grain은 `(벤더 계열, valid_from)`이다. 다른 구간을 조용히 재사용하지 않는다."""
        found = bridge((("Q", "2008-01-02", "Q_OLD"), ("Q", "2017-08-29", "Q_OLD1")))
        self.assertEqual(found.resolve("Q_OLD", "2008-01-02")[0], "Q")
        self.assertEqual(found.resolve("Q_OLD1", "2017-08-29")[0], "Q")
        with self.assertRaises(QVSymbolBridgeError):
            found.resolve("Q_OLD", "2017-08-29")

    def test_a_known_vendor_series_at_an_unmapped_interval_fails_closed(self):
        found = bridge((("FOXA", "2008-01-02", "TFCFA"),))
        with self.assertRaises(QVSymbolBridgeError) as caught:
            found.resolve("TFCFA", "2012-01-03")
        self.assertIn("TFCFA", str(caught.exception))

    def test_there_is_no_suffix_heuristic(self):
        """`SUN1` · `CCTYQ` · `MIICF`는 `_OLD` 규칙 밖이다. 매핑 줄만이 권한이다."""
        found = bridge((
            ("SUN", "2008-01-02", "SUN1"),
            ("CC", "2008-01-02", "CCTYQ"),
            ("MICC", "2008-01-02", "MIICF"),
        ))
        self.assertEqual(found.resolve("SUN1", "2008-01-02")[0], "SUN")
        self.assertEqual(found.resolve("CCTYQ", "2008-01-02")[0], "CC")
        self.assertEqual(found.resolve("MIICF", "2008-01-02")[0], "MICC")
        # 규칙처럼 보이는 코드도 매핑에 없으면 그대로 자기 자신이다.
        self.assertEqual(found.resolve("MON_OLD", "2008-01-02"), ("MON_OLD", DIRECT))

    def test_bridge_kinds_are_a_small_fixed_vocabulary(self):
        self.assertEqual(BRIDGE_KINDS, frozenset({DIRECT, REUSED_VENDOR_SERIES}))


class FailCloseTest(unittest.TestCase):
    def test_an_ambiguous_reverse_relation_fails_closed(self):
        """같은 `(벤더 계열, 구간)`이 두 원 심볼을 가리키면 승자를 고르지 않는다."""
        with self.assertRaises(QVSymbolBridgeError) as caught:
            bridge((("AAA", "2008-01-02", "SHARED"), ("BBB", "2008-01-02", "SHARED")))
        self.assertIn("SHARED", str(caught.exception))

    def test_a_symbol_that_is_both_original_and_vendor_fails_closed(self):
        with self.assertRaises(QVSymbolBridgeError):
            bridge((("AAA", "2008-01-02", "BBB"), ("BBB", "2009-01-02", "BBB_OLD")))

    def test_a_self_remap_fails_closed(self):
        with self.assertRaises(QVSymbolBridgeError):
            bridge((("AAA", "2008-01-02", "AAA"),))

    def test_an_incomplete_row_fails_closed(self):
        with self.assertRaises(QVSymbolBridgeError):
            parse_symbol_bridge(HEADER + "\nFOXA,,TFCFA,\n", source="x.csv")

    def test_a_missing_column_fails_closed(self):
        with self.assertRaises(QVSymbolBridgeError):
            parse_symbol_bridge("symbol,vendor_symbol\nFOXA,TFCFA\n", source="x.csv")

    def test_a_missing_mapping_file_fails_closed(self):
        """빈 매핑으로 넘어가면 벤더 코드가 SEC 심볼로 새어 나간다."""
        with self.assertRaises(QVSymbolBridgeError):
            load_symbol_bridge(TRADING_ROOT / "universe" / "no-such-reused.csv")

    def test_an_empty_member_symbol_or_interval_fails_closed(self):
        found = bridge((("FOXA", "2008-01-02", "TFCFA"),))
        with self.assertRaises(QVSymbolBridgeError):
            found.resolve("", "2008-01-02")
        with self.assertRaises(QVSymbolBridgeError):
            found.resolve("TFCFA", "")


class ProvenanceTest(unittest.TestCase):
    def test_the_version_is_a_deterministic_hash_of_the_exact_contents(self):
        rows = (("FOXA", "2008-01-02", "TFCFA"),)
        self.assertEqual(bridge(rows).source_version, bridge(rows).source_version)
        self.assertEqual(bridge(rows).source_version, content_version(csv_text(rows)))
        self.assertTrue(bridge(rows).source_version.startswith("reused-tickers-sha256:"))

    def test_modifying_the_mapping_changes_the_version(self):
        first = bridge((("FOXA", "2008-01-02", "TFCFA"),))
        second = bridge(
            (("FOXA", "2008-01-02", "TFCFA"), ("MON", "2008-01-02", "MON_OLD"))
        )
        self.assertNotEqual(first.source_version, second.source_version)

    def test_the_payload_says_it_is_not_sec_identity_evidence(self):
        payload = bridge((("FOXA", "2008-01-02", "TFCFA"),)).as_json(
            translated_membership_rows=3
        )
        self.assertEqual(payload["kind"], "UNIVERSE_MARKET_DATA_SYMBOL_PROVENANCE")
        self.assertIn("NOT SEC identity evidence", payload["note"])
        self.assertEqual(payload["translated_membership_rows"], 3)


class RepositoryMappingTest(unittest.TestCase):
    """커밋된 매핑 파일 자체가 역방향으로 모호하지 않아야 한다."""

    def test_the_committed_mapping_reverses_without_contradiction(self):
        found = load_symbol_bridge(DEFAULT_REUSED_PATH)
        self.assertTrue(found.reverse)
        self.assertEqual(found.source, "trading/universe/reused-tickers.csv")

    def test_the_committed_mapping_carries_the_known_examples(self):
        found = load_symbol_bridge(DEFAULT_REUSED_PATH)
        for vendor, valid_from, original in (
            ("TFCFA", "2008-01-02", "FOXA"),
            ("TFCF", "2014-12-22", "FOX"),
            ("MON_OLD", "2008-01-02", "MON"),
            ("ABI_OLD1", "2008-01-02", "ABI"),
            ("SNDK_OLD", "2008-01-02", "SNDK"),
            ("SUN1", "2008-01-02", "SUN"),
            ("CCTYQ", "2008-01-02", "CC"),
        ):
            with self.subTest(vendor=vendor):
                self.assertEqual(
                    found.resolve(vendor, valid_from), (original, REUSED_VENDOR_SERIES)
                )


if __name__ == "__main__":
    unittest.main()
