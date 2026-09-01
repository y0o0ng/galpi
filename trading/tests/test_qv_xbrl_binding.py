"""accession 단위 XBRL class binding 계약.

전부 network-free다. **QName은 economic identity가 아니다** — accession A에서 본
QName이 accession B에 대해 아무것도 말하지 않는 것이 이 파일의 핵심 계약이다.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

TRADING_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TRADING_ROOT))

from backtest import store  # noqa: E402
from backtest.qv_xbrl import parse_instance  # noqa: E402
from backtest.qv_xbrl_binding import (  # noqa: E402
    AMBIGUOUS,
    COVER_SECURITY_TITLE_FACT,
    RESOLVED,
    UNRESOLVED,
    QVBindingError,
    derive_bindings,
    filing_usable_session,
    member_facts,
    resolve_accession_member,
    store_bindings,
)

sys.path.insert(0, str(TRADING_ROOT / "tests"))
from test_qv_identity_proposals import USG, cover_instance  # noqa: E402

CIK = "0000000042"
ISSUER = "us-cik-0000000042"
IDV = "qv-identity-sha256:test"
FSV = "sec-filings-v1"
SHA = "a" * 64
INSTANT = "2024-01-31"
FILING_USABLE = "2024-02-20"


def title_facts(member, title, symbol=None, *, context="c"):
    out = [
        {"concept": "Security12bTitle", "value": title,
         "member": member, "context_id": context},
    ]
    if symbol:
        out.append({"concept": "TradingSymbol", "value": symbol,
                    "member": member, "context_id": context})
    return out


def _day_before(session: str) -> str:
    from datetime import date, timedelta

    return (date.fromisoformat(session) - timedelta(days=1)).isoformat()


def document(facts, *, cik=CIK, name="cover.xml"):
    return parse_instance(cover_instance(facts, default_cik=cik), name)


class BindingFixture:
    def setUp(self):
        self.connection = store.connect_memory()
        self.connection.execute(
            "INSERT INTO data_sources"
            " (source, source_version, kind, point_in_time, survivorship_biased, note)"
            " VALUES ('manifest', ?, 'securities', 1, 0, 'fixture')",
            (IDV,),
        )
        self.issuer()
        self.connection.commit()

    def issuer(self, usable="2010-01-04", issuer_id=ISSUER, cik=CIK):
        self.connection.execute(
            "INSERT OR REPLACE INTO qv_issuers"
            " (issuer_id, cik, resolution_method, usable_from_session,"
            "  source, source_version, provenance)"
            " VALUES (?, ?, 'SEC_REGISTRANT_CIK', ?, 'manifest', ?, 'fixture')",
            (issuer_id, cik, usable, IDV),
        )

    def klass(self, class_id, symbol, *, start="2010-01-04", end=None,
              issuer_id=ISSUER, listed=True, ordinary=True, usable="2010-01-04"):
        self.connection.execute(
            "INSERT OR REPLACE INTO qv_share_classes"
            " (class_id, issuer_id, symbol, is_ordinary_common, is_listed,"
            "  effective_from, effective_to, usable_from_session,"
            "  source, source_version, provenance)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'manifest', ?, 'fixture')",
            (class_id, issuer_id, symbol, int(ordinary), int(listed),
             start, end, usable, IDV),
        )
        self.connection.commit()

    def prose(self, class_id, key, *, bridge="SECURITY_TITLE_FACT",
              start="2010-01-04", end=None, issuer_id=ISSUER, usable="2010-01-04"):
        self.connection.execute(
            "INSERT OR REPLACE INTO qv_share_class_prose_aliases"
            " (class_id, issuer_id, raw_prose_name, comparison_key, bridge_type,"
            "  effective_from, effective_to, usable_from_session,"
            "  source, source_version, provenance)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'manifest', ?, 'fixture')",
            (class_id, issuer_id, key.title(), key, bridge, start, end, usable, IDV),
        )
        self.connection.commit()

    def filing(self, accession, *, usable=FILING_USABLE, cik=CIK):
        """canonical K/Q filing 원장. binding은 이것 없이 존재할 수 없다."""
        self.connection.execute(
            "INSERT OR REPLACE INTO qv_sec_filings"
            " (cik, accession, form, filed_date, acceptance_datetime,"
            "  acceptance_eastern_date, historical_usable_session, sic_status,"
            "  submissions_file, calendar_source, calendar_source_version,"
            "  source, source_version, provenance)"
            " VALUES (?, ?, '10-K', ?, ?, ?, ?, 'MISSING', 'CIK.json',"
            "         'eodhd', 'cal-v1', 'sec', ?, 'fixture')",
            (cik, accession, _day_before(usable), f"{_day_before(usable)}T21:00:00.000000Z",
             _day_before(usable), usable, FSV),
        )
        self.connection.commit()

    def derive(self, facts, *, accession="0000000042-24-000001", cik=CIK,
               instant=INSTANT, filing_usable=FILING_USABLE, name="cover.xml"):
        self.filing(accession, usable=filing_usable, cik=cik)
        return derive_bindings(
            self.connection, document(facts, cik=cik, name=name),
            cik=cik, accession=accession,
            filing_source_version=FSV, identity_source_version=IDV,
            default_instant=instant,
        )

    def store(self, bindings):
        return store_bindings(self.connection, bindings)

    def resolve(self, accession, member_local="CommonClassAMember", *,
                name="cover.xml", fact_instant=INSTANT, **kwargs):
        return resolve_accession_member(
            self.connection, cik=CIK, accession=accession,
            instance_document_name=name,
            axis_key="us-gaap:StatementClassOfStockAxis",
            member_key=f"us-gaap:{member_local}",
            filing_source_version=FSV, identity_source_version=IDV,
            fact_instant=fact_instant, **kwargs,
        )

    def lookup(self, *args, **kwargs):
        """`(class_id, 상태)` 짝. 매핑 가용성은 `resolve()`로 본다."""
        found = self.resolve(*args, **kwargs)
        return found.class_id, found.status


class ExplicitTitleBridgeTest(BindingFixture, unittest.TestCase):
    def test_an_explicit_cover_title_binds_the_member(self):
        self.klass("cls-a", "AAA")
        self.prose("cls-a", "class a common stock")
        bound, unresolved = self.derive(
            title_facts("CommonClassAMember", "Class A Common Stock", "AAA")
        )
        self.assertEqual(unresolved, ())
        self.assertEqual(len(bound), 1)
        item = bound[0]
        self.assertEqual(item.class_id, "cls-a")
        self.assertEqual(item.member_key, "us-gaap:CommonClassAMember")
        self.assertEqual(item.binding_method, COVER_SECURITY_TITLE_FACT)
        self.assertEqual(item.canonical_prose_comparison_key, "class a common stock")

    def test_a_12g_title_also_binds(self):
        self.klass("cls-a", None, listed=False)
        self.prose("cls-a", "class a common stock")
        facts = [{"concept": "Security12gTitle", "value": "Class A Common Stock",
                  "member": "CommonClassAMember", "context_id": "c"}]
        bound, _unresolved = self.derive(facts)
        self.assertEqual([item.class_id for item in bound], ["cls-a"])


class NoImplicitBridgeTest(BindingFixture, unittest.TestCase):
    """명시 filing-local 다리가 없으면 `UNRESOLVED`이고 그것으로 괜찮다."""

    def test_a_title_less_member_is_not_bound_by_a_charter_class(self):
        """governing instrument는 class를 증명하지 QName 관계를 증명하지 않는다."""
        self.klass("cls-b", None, listed=False)
        self.prose("cls-b", "class b common stock", bridge="GOVERNING_INSTRUMENT")
        facts = [
            {"concept": "EntityCommonStockSharesOutstanding", "value": "500",
             "member": "CommonClassBMember", "context_id": "b", "numeric": True},
        ]
        bound, unresolved = self.derive(facts)
        self.assertEqual(bound, ())
        # 주식수 fact만 있는 member는 표지 제목·심볼 수집 대상이 아니라 아예 안 잡힌다.
        self.assertEqual(unresolved, ())
        self.assertEqual(self.lookup("0000000042-24-000001", "CommonClassBMember"),
                         (None, UNRESOLVED))

    def test_a_cover_group_label_never_binds(self):
        """`COVER_GROUP_LABEL`은 corroborating 전용이라 canonical 해석에 안 걸린다."""
        self.klass("cls-b", None, listed=False)
        self.prose("cls-b", "class b common stock", bridge="COVER_GROUP_LABEL")
        bound, unresolved = self.derive(
            title_facts("CommonClassBMember", "Class B Common Stock")
        )
        self.assertEqual(bound, ())
        self.assertEqual(len(unresolved), 1)
        self.assertIn("canonical prose bridge가 없습니다", unresolved[0][1])

    def test_a_ticker_alone_never_binds(self):
        self.klass("cls-a", "AAA")
        self.prose("cls-a", "class a common stock")
        facts = [{"concept": "TradingSymbol", "value": "AAA",
                  "member": "CommonClassAMember", "context_id": "c"}]
        bound, unresolved = self.derive(facts)
        self.assertEqual(bound, ())
        self.assertIn("표지 제목 fact가 정확히 하나가 아닙니다", unresolved[0][1])

    def test_a_member_spelling_similar_to_a_class_never_binds(self):
        self.klass("cls-b", None, listed=False)
        self.prose("cls-b", "class b common stock", bridge="GOVERNING_INSTRUMENT")
        bound, unresolved = self.derive(
            title_facts("CommonClassBMember", "Some Other Security")
        )
        self.assertEqual(bound, ())
        self.assertTrue(unresolved)


class FilingLocalityTest(BindingFixture, unittest.TestCase):
    """같은 exact QName이 두 accession에서 다르게 묶일 수 있다."""

    def test_the_same_qname_binds_differently_in_two_accessions(self):
        self.klass("cls-a", "AAA")
        self.klass("cls-x", "XXX")
        self.prose("cls-a", "class a common stock")
        self.prose("cls-x", "reorganized common stock")

        first, _ = self.derive(
            title_facts("CommonClassAMember", "Class A Common Stock", "AAA"),
            accession="0000000042-20-000001",
        )
        second, _ = self.derive(
            title_facts("CommonClassAMember", "Reorganized Common Stock", "XXX"),
            accession="0000000042-24-000001",
        )
        self.store(first + second)

        self.assertEqual(self.lookup("0000000042-20-000001"), ("cls-a", RESOLVED))
        self.assertEqual(self.lookup("0000000042-24-000001"), ("cls-x", RESOLVED))

    def test_no_binding_leaks_into_an_accession_that_has_none(self):
        self.klass("cls-a", "AAA")
        self.prose("cls-a", "class a common stock")
        bound, _ = self.derive(
            title_facts("CommonClassAMember", "Class A Common Stock", "AAA"),
            accession="0000000042-20-000001",
        )
        self.store(bound)
        self.assertEqual(self.lookup("0000000042-24-000009"), (None, UNRESOLVED))

    def test_two_documents_in_one_accession_bind_the_same_qname_separately(self):
        """**문서 이름은 자연키의 일부다.** 하나가 다른 하나를 모호하게 만들지 않는다."""
        self.klass("cls-a", "AAA")
        self.klass("cls-x", "XXX")
        self.prose("cls-a", "class a common stock")
        self.prose("cls-x", "reorganized common stock")

        first, _ = self.derive(
            title_facts("CommonClassAMember", "Class A Common Stock", "AAA"),
            accession="0000000042-20-000001", name="first.xml",
        )
        second, _ = self.derive(
            title_facts("CommonClassAMember", "Reorganized Common Stock", "XXX"),
            accession="0000000042-20-000001", name="second.xml",
        )
        self.store(first + second)

        acc = "0000000042-20-000001"
        self.assertEqual(self.lookup(acc, name="first.xml"), ("cls-a", RESOLVED))
        self.assertEqual(self.lookup(acc, name="second.xml"), ("cls-x", RESOLVED))
        # 다른 문서가 있다는 이유로 AMBIGUOUS가 되지 않는다.
        self.assertNotEqual(self.lookup(acc, name="first.xml")[1], AMBIGUOUS)
        # 없는 문서 이름은 그냥 없는 것이다 — 순서로 고르는 폴백이 없다.
        self.assertEqual(self.lookup(acc, name="third.xml"), (None, UNRESOLVED))

    def test_one_accession_binding_two_titles_to_one_qname_fails_closed(self):
        self.klass("cls-a", "AAA")
        self.prose("cls-a", "class a common stock")
        facts = (
            title_facts("CommonClassAMember", "Class A Common Stock", context="c1")
            + title_facts("CommonClassAMember", "Another Title", context="c2")
        )
        bound, unresolved = self.derive(facts)
        self.assertEqual(bound, ())
        self.assertIn("정확히 하나가 아닙니다", unresolved[0][1])


class ExactnessTest(BindingFixture, unittest.TestCase):
    def test_a_prose_key_resolving_to_two_classes_fails_closed(self):
        self.klass("cls-a", "AAA")
        self.klass("cls-b", None, listed=False)
        self.prose("cls-a", "common stock")
        self.prose("cls-b", "common stock")
        bound, unresolved = self.derive(
            title_facts("CommonStockMember", "Common Stock", "AAA")
        )
        self.assertEqual(bound, ())
        self.assertIn("2개 class로 갑니다", unresolved[0][1])

    def test_a_conflicting_trading_symbol_fails_closed(self):
        self.klass("cls-a", "AAA")
        self.prose("cls-a", "class a common stock")
        bound, unresolved = self.derive(
            title_facts("CommonClassAMember", "Class A Common Stock", "ZZZ")
        )
        self.assertEqual(bound, ())
        self.assertIn("맞지 않습니다", unresolved[0][1])

    def test_an_issuer_extension_member_keeps_the_exact_target_cik(self):
        self.klass("cls-n", None, listed=False)
        self.prose("cls-n", "1.375% notes due 2029")
        facts = [{"concept": "Security12bTitle", "value": "1.375% Notes due 2029",
                  "member": "A1375NotesMember", "member_ext": True, "context_id": "n"}]
        found, _anomalies = member_facts(document(facts), cik=CIK)
        keys = [member for _axis, member in found]
        self.assertEqual(keys, [f"ext:{CIK}:A1375NotesMember"])

    def test_the_same_local_under_another_namespace_is_a_different_key(self):
        standard = [{"concept": "Security12bTitle", "value": "Class A Common Stock",
                     "member": "CommonClassAMember", "context_id": "c"}]
        extension = [{"concept": "Security12bTitle", "value": "Class A Common Stock",
                      "member": "CommonClassAMember", "member_ext": True,
                      "context_id": "c"}]
        left, _ = member_facts(document(standard), cik=CIK)
        right, _ = member_facts(document(extension), cik=CIK)
        self.assertNotEqual(sorted(left), sorted(right))

    def test_a_class_inactive_at_the_fact_instant_fails_closed(self):
        self.klass("cls-a", "AAA", start="2010-01-04", end="2015-01-02")
        self.prose("cls-a", "class a common stock")
        bound, unresolved = self.derive(
            title_facts("CommonClassAMember", "Class A Common Stock", "AAA")
        )
        self.assertEqual(bound, ())
        self.assertIn("정확히 하나로 활성이 아닙니다", unresolved[0][1])


class UsabilityTest(BindingFixture, unittest.TestCase):
    def test_usable_from_session_is_the_max_of_filing_and_identity(self):
        self.klass("cls-a", "AAA", usable="2021-01-04")
        self.prose("cls-a", "class a common stock", usable="2022-06-30")
        bound, _ = self.derive(
            title_facts("CommonClassAMember", "Class A Common Stock", "AAA"),
            filing_usable="2020-02-20",
        )
        item = bound[0]
        self.assertEqual(item.identity_usable_from_session, "2022-06-30")
        self.assertEqual(item.usable_from_session, "2022-06-30")

        later_filing, _ = self.derive(
            title_facts("CommonClassAMember", "Class A Common Stock", "AAA"),
            accession="0000000042-25-000001", filing_usable="2025-02-20",
        )
        self.assertEqual(later_filing[0].usable_from_session, "2025-02-20")

    def test_a_formation_before_that_session_cannot_use_the_binding(self):
        """identity 쪽이 더 늦으면 그것이 문턱이다."""
        self.klass("cls-a", "AAA", usable="2021-01-04")
        self.prose("cls-a", "class a common stock", usable="2022-06-30")
        bound, _ = self.derive(
            title_facts("CommonClassAMember", "Class A Common Stock", "AAA"),
            filing_usable="2020-02-20",
        )
        self.assertEqual(bound[0].usable_from_session, "2022-06-30")
        self.store(bound)
        acc = "0000000042-24-000001"
        self.assertEqual(self.lookup(acc, usable_by="2021-06-30"), (None, UNRESOLVED))
        self.assertEqual(self.lookup(acc, usable_by="2022-06-30"), ("cls-a", RESOLVED))


class FactInstantRevalidationTest(BindingFixture, unittest.TestCase):
    """binding 행을 찾은 뒤에도 **그 fact instant에** 다시 확인한다."""

    def reused_prose(self):
        """같은 철자가 시기별로 다른 class를 가리킨다."""
        self.klass("cls-a", "AAA", start="2010-01-01", end="2015-01-01")
        self.klass("cls-b", "BBB", start="2015-01-01")
        self.prose("cls-a", "common stock", start="2010-01-01", end="2015-01-01")
        self.prose("cls-b", "common stock", start="2015-01-01")

    def test_a_stored_binding_does_not_resolve_in_another_classes_prose_interval(self):
        """표지 instant(2024-01-31)에서는 Class B가 그 철자의 주인이다.

        binding은 Class B로 서지만, **Class A 구간의 fact instant에서는 풀리지
        않는다** — 그때 그 철자는 다른 class의 것이다. 바꿔치지 않는다.
        """
        self.reused_prose()
        bound, _ = self.derive(title_facts("CommonStockMember", "Common Stock", "BBB"))
        self.assertEqual([item.class_id for item in bound], ["cls-b"])
        self.store(bound)
        acc = "0000000042-24-000001"

        self.assertEqual(
            self.lookup(acc, "CommonStockMember", fact_instant="2016-06-30"),
            ("cls-b", RESOLVED),
        )
        self.assertEqual(
            self.lookup(acc, "CommonStockMember", fact_instant="2014-06-30"),
            (None, UNRESOLVED),
        )

    def test_a_class_inactive_at_the_share_fact_instant_is_unresolved(self):
        """prose는 아직 살아 있는데 economic class가 끝난 자리."""
        self.klass("cls-a", "AAA", start="2010-01-01", end="2025-01-01")
        self.prose("cls-a", "class a common stock", start="2010-01-01")
        bound, _ = self.derive(
            title_facts("CommonClassAMember", "Class A Common Stock", "AAA")
        )
        self.store(bound)
        acc = "0000000042-24-000001"
        self.assertEqual(
            self.lookup(acc, fact_instant="2024-01-31"), ("cls-a", RESOLVED)
        )
        self.assertEqual(
            self.lookup(acc, fact_instant="2026-06-30"), (None, UNRESOLVED)
        )

    def test_an_ambiguous_prose_key_at_the_fact_instant_fails_closed(self):
        self.klass("cls-a", "AAA", start="2010-01-01")
        self.prose("cls-a", "common stock", start="2010-01-01")
        bound, _ = self.derive(
            title_facts("CommonStockMember", "Common Stock", "AAA"),
            instant="2014-06-30",
        )
        self.store(bound)
        # 나중에 같은 철자가 두 번째 class로도 가게 된다.
        self.klass("cls-b", None, listed=False, start="2016-01-01")
        self.prose("cls-b", "common stock", start="2016-01-01")
        acc = "0000000042-24-000001"
        self.assertEqual(
            self.lookup(acc, "CommonStockMember", fact_instant="2014-06-30"),
            ("cls-a", RESOLVED),
        )
        self.assertEqual(
            self.lookup(acc, "CommonStockMember", fact_instant="2017-06-30"),
            (None, AMBIGUOUS),
        )


class KnowledgeAvailabilityTest(BindingFixture, unittest.TestCase):
    """**경제적 유효성과 지식 가용성은 둘 다 필요하다.**

    나중 문서가 더 오래된 상태를 증명할 수 있지만, 그 증거가 usable해지기 전
    formation은 그것을 쓸 수 없다.
    """

    def test_a_later_proved_prose_segment_is_invisible_to_an_earlier_formation(self):
        """같은 class의 옛 구간이 2020에야 증명됐다면 2018 formation은 못 쓴다."""
        self.klass("cls-a", "AAA", start="2010-01-01", usable="2011-01-03")
        # 표지 instant(2024-01-31)를 덮는 구간 — binding은 여기서 선다.
        self.prose("cls-a", "common stock",
                   start="2015-01-01", end=None, usable="2017-01-03")
        # 옛 fact instant를 덮는 구간인데 **2020에야 알 수 있게 됐다.**
        self.prose("cls-a", "common stock",
                   start="2010-01-01", end="2015-01-01", usable="2020-01-02")

        # **binding 자체는 2017부터 쓸 수 있다.** 막는 것은 2013 구간 prose 하나다.
        bound, _ = self.derive(
            title_facts("CommonStockMember", "Common Stock", "AAA"),
            filing_usable="2017-01-03",
        )
        self.assertEqual([item.class_id for item in bound], ["cls-a"])
        self.assertEqual(bound[0].usable_from_session, "2017-01-03")
        self.store(bound)

        acc = "0000000042-24-000001"

        def at(usable_by):
            return self.lookup(
                acc, "CommonStockMember", fact_instant="2013-06-28",
                usable_by=usable_by,
            )

        # binding 자체는 2024-02-20부터 쓸 수 있지만, 2013 구간 prose는 2020부터다.
        self.assertEqual(at("2018-06-29"), (None, UNRESOLVED))
        self.assertEqual(at("2024-06-28"), ("cls-a", RESOLVED))

    def test_a_later_proved_class_segment_is_invisible_to_an_earlier_formation(self):
        self.klass("cls-a", "AAA", start="2015-01-01", usable="2016-01-04")
        self.klass("cls-a", "AAA", start="2010-01-01", end="2015-01-01",
                   usable="2020-01-02")
        self.prose("cls-a", "common stock", start="2010-01-01", usable="2011-01-03")

        bound, _ = self.derive(
            title_facts("CommonStockMember", "Common Stock", "AAA"),
            filing_usable="2017-01-03",
        )
        self.assertEqual(bound[0].usable_from_session, "2017-01-03")
        self.store(bound)
        acc = "0000000042-24-000001"

        def at(usable_by):
            return self.lookup(
                acc, "CommonStockMember", fact_instant="2013-06-28",
                usable_by=usable_by,
            )

        self.assertEqual(at("2018-06-29"), (None, UNRESOLVED))
        self.assertEqual(at("2024-06-28"), ("cls-a", RESOLVED))

    def test_the_mapping_usable_session_covers_every_required_relation(self):
        self.issuer(usable="2012-01-03")
        self.klass("cls-a", "AAA", start="2010-01-01", usable="2013-01-02")
        self.prose("cls-a", "class a common stock",
                   start="2010-01-01", usable="2014-01-02")
        self.connection.commit()
        bound, _ = self.derive(
            title_facts("CommonClassAMember", "Class A Common Stock", "AAA")
        )
        self.store(bound)
        found = self.resolve("0000000042-24-000001")
        self.assertEqual(found.status, RESOLVED)
        # filing 2024-02-20이 가장 늦다.
        self.assertEqual(found.mapping_usable_from_session, "2024-02-20")

    def test_a_later_usable_issuer_delays_the_binding(self):
        """issuer 매핑도 PIT identity 관계다."""
        self.issuer(usable="2022-06-30")
        self.klass("cls-a", "AAA", usable="2011-01-03")
        self.prose("cls-a", "class a common stock", usable="2011-01-03")
        self.connection.commit()
        bound, _ = self.derive(
            title_facts("CommonClassAMember", "Class A Common Stock", "AAA"),
            filing_usable="2012-02-20",
        )
        self.assertEqual(bound[0].identity_usable_from_session, "2022-06-30")
        self.assertEqual(bound[0].usable_from_session, "2022-06-30")


class IssuerDerivationTest(BindingFixture, unittest.TestCase):
    """`issuer_id`는 **CIK에서 파생한다.** 두 정체성을 따로 받지 않는다."""

    def test_a_filing_cik_cannot_be_paired_with_another_issuers_identity(self):
        other = "us-cik-0000000099"
        self.connection.execute(
            "INSERT INTO qv_issuers (issuer_id, cik, resolution_method,"
            " usable_from_session, source, source_version, provenance)"
            " VALUES (?, '0000000099', 'SEC_REGISTRANT_CIK', '2010-01-04',"
            "         'manifest', ?, 'fixture')",
            (other, IDV),
        )
        self.klass("cls-b", "BBB", issuer_id=other)
        self.prose("cls-b", "class b common stock", issuer_id=other)
        self.connection.commit()

        # CIK A의 filing인데 제목이 issuer B의 class를 가리킨다 — 묶이지 않는다.
        bound, unresolved = self.derive(
            title_facts("CommonClassBMember", "Class B Common Stock", "BBB")
        )
        self.assertEqual(bound, ())
        self.assertIn("canonical prose bridge가 없습니다", unresolved[0][1])

    def test_derivation_fails_closed_without_exactly_one_issuer_for_the_cik(self):
        from backtest.qv_xbrl_binding import resolve_issuer

        self.assertEqual(
            resolve_issuer(self.connection, cik=CIK, identity_source_version=IDV),
            (ISSUER, "2010-01-04"),
        )
        with self.assertRaises(QVBindingError):
            resolve_issuer(
                self.connection, cik="0000000077", identity_source_version=IDV
            )

    def test_the_derived_issuer_is_the_one_on_the_binding(self):
        self.klass("cls-a", "AAA")
        self.prose("cls-a", "class a common stock")
        bound, _ = self.derive(
            title_facts("CommonClassAMember", "Class A Common Stock", "AAA")
        )
        self.assertEqual([item.issuer_id for item in bound], [ISSUER])


class FilingLedgerAuthorityTest(BindingFixture, unittest.TestCase):
    """PIT filing 가용성의 권한은 canonical K/Q 원장이다."""

    def test_a_missing_filing_record_fails_closed(self):
        self.klass("cls-a", "AAA")
        self.prose("cls-a", "class a common stock")
        with self.assertRaises(QVBindingError) as caught:
            derive_bindings(
                self.connection,
                document(title_facts("CommonClassAMember",
                                     "Class A Common Stock", "AAA")),
                cik=CIK, accession="0000000042-99-000001",
                filing_source_version=FSV, identity_source_version=IDV,
                default_instant=INSTANT,
            )
        self.assertIn("canonical K/Q filing 기록", str(caught.exception))

    def test_the_ledger_session_is_used_not_a_caller_value(self):
        self.klass("cls-a", "AAA")
        self.prose("cls-a", "class a common stock")
        self.filing("0000000042-24-000001", usable="2024-03-05")
        bound, _ = derive_bindings(
            self.connection,
            document(title_facts("CommonClassAMember", "Class A Common Stock", "AAA")),
            cik=CIK, accession="0000000042-24-000001",
            filing_source_version=FSV, identity_source_version=IDV,
            default_instant=INSTANT,
        )
        self.assertEqual(bound[0].filing_historical_usable_session, "2024-03-05")
        self.assertEqual(bound[0].usable_from_session, "2024-03-05")
        self.assertEqual(
            filing_usable_session(
                self.connection, cik=CIK, accession="0000000042-24-000001",
                filing_source_version=FSV,
            ),
            "2024-03-05",
        )

    def test_a_different_filing_source_version_is_a_different_record(self):
        self.klass("cls-a", "AAA")
        self.prose("cls-a", "class a common stock")
        self.filing("0000000042-24-000001")
        with self.assertRaises(QVBindingError):
            filing_usable_session(
                self.connection, cik=CIK, accession="0000000042-24-000001",
                filing_source_version="another-version",
            )


class StorageTest(BindingFixture, unittest.TestCase):
    def test_the_binding_row_keeps_reproducible_provenance(self):
        self.klass("cls-a", "AAA")
        self.prose("cls-a", "class a common stock")
        bound, _ = self.derive(
            title_facts("CommonClassAMember", "Class A Common Stock", "AAA")
        )
        self.assertEqual(self.store(bound), 1)
        row = self.connection.execute(
            "SELECT * FROM qv_xbrl_class_bindings"
        ).fetchone()
        self.assertEqual(row["binding_method"], COVER_SECURITY_TITLE_FACT)
        # **문서 자신이 권한이다.** 호출자가 넣은 문자열이 아니다.
        real = document(
            title_facts("CommonClassAMember", "Class A Common Stock", "AAA")
        )
        self.assertEqual(row["instance_sha256"], real.sha256)
        self.assertEqual(row["instance_document_name"], real.source_file)
        self.assertEqual(row["raw_member_local"], "CommonClassAMember")
        self.assertEqual(row["raw_axis_local"], "StatementClassOfStockAxis")
        self.assertEqual(row["canonical_prose_comparison_key"], "class a common stock")
        self.assertEqual(row["filing_source_version"], FSV)
        self.assertEqual(row["identity_source_version"], IDV)

    def test_storing_a_different_row_under_the_same_natural_key_fails_closed(self):
        """**정확히 같은 자연키를 조용히 덮어쓰지 않는다.**"""
        self.klass("cls-a", "AAA")
        self.klass("cls-x", "XXX")
        self.prose("cls-a", "class a common stock")
        self.prose("cls-x", "reorganized common stock")

        first, _ = self.derive(
            title_facts("CommonClassAMember", "Class A Common Stock", "AAA")
        )
        self.assertEqual(self.store(first), 1)

        # 같은 accession/문서/QName인데 다른 class를 가리키는 binding.
        clash, _ = self.derive(
            title_facts("CommonClassAMember", "Reorganized Common Stock", "XXX")
        )
        with self.assertRaises(QVBindingError) as caught:
            self.store(clash)
        self.assertIn("덮어쓰지", str(caught.exception))

        # 원래 행이 그대로다.
        rows = self.connection.execute(
            "SELECT class_id FROM qv_xbrl_class_bindings"
        ).fetchall()
        self.assertEqual([row["class_id"] for row in rows], ["cls-a"])
        self.assertEqual(self.lookup("0000000042-24-000001"), ("cls-a", RESOLVED))

    def test_storing_the_exact_same_row_again_is_idempotent(self):
        self.klass("cls-a", "AAA")
        self.prose("cls-a", "class a common stock")
        bound, _ = self.derive(
            title_facts("CommonClassAMember", "Class A Common Stock", "AAA")
        )
        self.assertEqual(self.store(bound), 1)
        self.assertEqual(self.store(bound), 0)      # 이미 있고 내용이 같다
        self.assertEqual(
            self.connection.execute(
                "SELECT count(*) AS n FROM qv_xbrl_class_bindings"
            ).fetchone()["n"],
            1,
        )

    def test_a_cover_anomaly_stops_the_whole_accession(self):
        self.klass("cls-a", "AAA")
        self.prose("cls-a", "class a common stock")
        facts = title_facts("CommonClassAMember", "Class A Common Stock", "AAA") + [
            {"concept": "TradingSymbol", "value": "QQQ",
             "member": "EquivalentClassAMember", "context_id": "d"},
        ]
        with self.assertRaises(QVBindingError):
            self.derive(facts)


if __name__ == "__main__":
    unittest.main()
