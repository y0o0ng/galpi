"""Step 5A-2c — 안전 자동 승격기 계약.

전부 network-free이고 **임시 네 파일 manifest만** 쓴다.
`trading/qv/identity/*.jsonl`(production)은 읽지도 쓰지도 않는다.

```text
AUTO_PROVABLE     결정론적 재검증을 통과하면 사람 승인 없이 승격된다
REVIEW_REQUIRED   우회 경로가 없다
UNRESOLVED        승격 경로가 없다
```
"""

from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

TRADING_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TRADING_ROOT))

from types import SimpleNamespace  # noqa: E402

from backtest.qv_identity_promotion import (  # noqa: E402
    CLASS_ID_SCHEME,
    STALE_IDENTITY_BASE,
    QVPromotionError,
    apply_promotion,
    class_id_v1,
    load_proposal_run,
    plan_promotion,
    resolve_class_id,
    revalidate_packet,
    select_birth_bridge,
)
from backtest.qv_identity_proposals import (  # noqa: E402
    AUTO_PROVABLE,
    COVER_GROUP_LABEL,
    GOVERNING_INSTRUMENT,
    SECURITY_TITLE_FACT,
    ClassEvidence,
    DiscoveryCandidate,
    EvidenceRef,
    ProseBridgeInput,
    RelationInterval,
    WorkItem,
    build_symbol_proposal,
    extract_cover_proof,
)
from backtest.qv_manifest import load_manifest, validate  # noqa: E402
from backtest.qv_xbrl import parse_instance  # noqa: E402

sys.path.insert(0, str(TRADING_ROOT / "tests"))
from test_qv_identity_proposals import (  # noqa: E402
    CURRENT_TICKER_FILE,
    HISTORICAL_NAME_LOOKUP,
    USG,
    cover_instance,
    dual_class_facts,
    single_class_facts,
)

CIK = "0000000042"
BIRTH = "2016-04-08"

COVER_EVIDENCE = (
    EvidenceRef(
        source_kind="KQ_FILING", cik=CIK, accession="0000000042-24-000001",
        document_name="cover.xml", evidence_role="CLASS_INTERVAL_EVIDENCE",
    ),
)
CHARTER_EVIDENCE = (
    EvidenceRef(
        source_kind="SEC_EVIDENCE_DOCUMENT", cik=CIK,
        accession="0000000042-16-000009", document_name="charter.htm",
        evidence_role="CHARTER_CLASS_DEFINITION",
    ),
)


def span(evidence=COVER_EVIDENCE, start=BIRTH, end=None):
    return RelationInterval(start, end, evidence)


def proof_for(facts, *, cik=CIK, accession="0000000042-24-000001"):
    document = parse_instance(cover_instance(facts, default_cik=cik), "cover.xml")
    return extract_cover_proof(
        document, cik=cik, accession=accession, document_name="cover.xml"
    )


def complete_evidence(proof, *, start=BIRTH, end=None):
    """세 관계의 구간 + 제목 없는 보통주 class의 명시 governing bridge."""
    out = {}
    for item in proof.classes:
        extra = ()
        if not item.security_title:
            extra = (
                ProseBridgeInput(
                    raw_prose_name=f"{item.member_local} charter definition",
                    bridge_type=GOVERNING_INSTRUMENT,
                    interval=span(CHARTER_EVIDENCE, start=start, end=end),
                ),
            )
        out[item.member_key] = ClassEvidence(
            class_interval=span(start=start, end=end),
            cover_title_interval=span(start=start, end=end) if item.security_title else None,
            extra_prose_bridges=extra,
        )
    return out


def packet_for(facts, *, symbol="AAA", cik=CIK, evidence=complete_evidence,
               accession="0000000042-24-000001", member=None):
    proof = proof_for(facts, cik=cik, accession=accession)
    item = WorkItem(member or symbol, symbol,
                    "DIRECT" if (member or symbol) == symbol else "REUSED_VENDOR_SERIES",
                    ("2024-06-28",))
    return build_symbol_proposal(
        work_item=item,
        candidates=(DiscoveryCandidate(cik=cik, origin=CURRENT_TICKER_FILE, detail="Acme"),),
        proof=proof,
        class_evidence=evidence(proof) if callable(evidence) else evidence,
    )


def run_payload(packets, *, identity_version):
    return {
        "stage": "5A-2",
        "produces": "SEC_IDENTITY_PROPOSALS",
        "mutates_production_manifest": False,
        "demand_provenance": {
            "stage_source": "5A-1",
            "measures": "STATIC_MAPPING_COVERAGE_DEMAND",
            "index_name": "SP500",
            "universe_source": "announcements",
            "universe_source_version": "eodhd-15y-2026-08",
            "calendar_source": "eodhd",
            "calendar_source_version": "eodhd-15y-2026-08",
            "reused_series_source": "trading/universe/reused-tickers.csv",
            "reused_series_source_version": "reused-tickers-sha256:abc",
            "identity_source_version": identity_version,
            "inventory_path": "runs/x/inventory.json",
        },
        "identity_source_version": identity_version,
        "proposals": [item.as_json() for item in packets],
    }


class ManifestFixture:
    """빈 네 파일 bundle을 임시 디렉터리에 만든다. production을 건드리지 않는다."""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.directory = Path(self._tmp.name)
        self.write({name: [] for name in (
            "issuers.jsonl", "share_classes.jsonl", "prose_aliases.jsonl",
        )})

    def write(self, payload: dict):
        for name, rows in payload.items():
            (self.directory / name).write_text(
                "".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows),
                encoding="utf-8",
            )
        return load_manifest(self.directory)

    def manifest(self):
        return load_manifest(self.directory)

    def run_file(self, packets, *, identity_version=None):
        manifest = self.manifest()
        payload = run_payload(
            packets,
            identity_version=identity_version or manifest.identity_source_version,
        )
        path = self.directory.parent / f"run-{id(payload)}.json"
        path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
        self.addCleanup(lambda: path.unlink(missing_ok=True))
        return load_proposal_run(path)

    def plan(self, packets, **kwargs):
        return plan_promotion(self.run_file(packets), manifest=self.manifest(), **kwargs)

    def snapshot(self):
        return {
            name: (self.directory / name).read_bytes()
            for name in ("issuers.jsonl", "share_classes.jsonl",
                         "prose_aliases.jsonl")
        }


class ClassIdSchemeTest(unittest.TestCase):
    """production `class_id`는 불투명 결정적 안정 키다(Option A)."""

    SEED = dict(
        cik=CIK, effective_from=BIRTH,
        canonical_bridge_type=SECURITY_TITLE_FACT,
        canonical_bridge_key="class a common stock",
    )

    def test_the_same_economic_seed_gives_the_same_full_id(self):
        first = class_id_v1(**self.SEED)
        second = class_id_v1(**self.SEED)
        self.assertEqual(first, second)
        self.assertTrue(first.startswith(f"us-cik-{CIK}-class-v1-"))
        self.assertEqual(len(first.rsplit("-", 1)[1]), 64)   # 자르지 않는다

    def test_a_different_canonical_bridge_key_gives_a_different_id(self):
        other = class_id_v1(**{**self.SEED, "canonical_bridge_key": "class b common stock"})
        self.assertNotEqual(class_id_v1(**self.SEED), other)

    def test_a_different_effective_from_gives_a_different_id(self):
        other = class_id_v1(**{**self.SEED, "effective_from": "2019-01-02"})
        self.assertNotEqual(class_id_v1(**self.SEED), other)

    def test_only_canonical_bridges_can_seed_an_id(self):
        with self.assertRaises(QVPromotionError):
            class_id_v1(**{**self.SEED, "canonical_bridge_type": COVER_GROUP_LABEL})

    def test_the_birth_bridge_must_be_valid_at_class_birth(self):
        """몇 년 뒤 증거가 생긴 제목이 탄생 정체성을 정하지 못한다."""
        late = {
            "bridge_type": SECURITY_TITLE_FACT, "comparison_key": "late title",
            "effective_from": "2020-01-02", "effective_to": None,
        }
        self.assertIsNone(select_birth_bridge([late], BIRTH))
        self.assertIsNotNone(select_birth_bridge([late], "2021-01-04"))

    def test_the_birth_bridge_tie_break_is_deterministic(self):
        title = {"bridge_type": SECURITY_TITLE_FACT, "comparison_key": "aaa",
                 "effective_from": BIRTH, "effective_to": None}
        charter = {"bridge_type": GOVERNING_INSTRUMENT, "comparison_key": "zzz",
                   "effective_from": BIRTH, "effective_to": None}
        self.assertEqual(
            select_birth_bridge([title, charter], BIRTH)["bridge_type"],
            GOVERNING_INSTRUMENT,
        )
        second = {"bridge_type": SECURITY_TITLE_FACT, "comparison_key": "bbb",
                  "effective_from": BIRTH, "effective_to": None}
        self.assertEqual(
            select_birth_bridge([second, title], BIRTH)["comparison_key"], "aaa"
        )

    def test_a_cover_group_label_is_never_eligible_to_seed(self):
        label = {"bridge_type": COVER_GROUP_LABEL, "comparison_key": "class b common stock",
                 "effective_from": BIRTH, "effective_to": None}
        self.assertIsNone(select_birth_bridge([label], BIRTH))


class GeneratedIdIsOpaqueTest(ManifestFixture, unittest.TestCase):
    def promoted_class_ids(self, facts, **kwargs):
        plan = self.plan([packet_for(facts, **kwargs)])
        return plan.packets[0].class_id_map

    def test_changing_the_xbrl_member_local_name_does_not_change_the_id(self):
        base = self.promoted_class_ids(single_class_facts("AAA"))
        renamed = [
            dict(item, member="CommonStockClassUndesignatedMember")
            for item in single_class_facts("AAA")
        ]
        other = self.promoted_class_ids(renamed)
        self.assertEqual(sorted(base.values()), sorted(other.values()))
        # 제안 id는 member 이름에서 오므로 **달라진다** — 그것이 임시 참조인 이유다.
        self.assertNotEqual(sorted(base), sorted(other))

    def test_changing_the_ticker_does_not_change_the_id(self):
        base = self.promoted_class_ids(single_class_facts("AAA"))
        facts = [
            dict(item, value="ZZZ") if item["concept"] == "TradingSymbol" else item
            for item in single_class_facts("AAA")
        ]
        other = self.promoted_class_ids(facts, symbol="ZZZ")
        self.assertEqual(sorted(base.values()), sorted(other.values()))

    def test_two_siblings_with_different_bridge_keys_get_different_ids(self):
        plan = self.plan([packet_for(dual_class_facts())])
        ids = set(plan.packets[0].class_id_map.values())
        self.assertEqual(len(ids), 2)
        for value in ids:
            self.assertIn("-class-v1-", value)

    def test_no_canonical_bridge_at_birth_means_no_new_automatic_class(self):
        def late_bridge(proof):
            return {
                item.member_key: ClassEvidence(
                    class_interval=span(start=BIRTH),
                    cover_title_interval=span(start="2020-01-02"),
                )
                for item in proof.classes
            }

        packet = packet_for(single_class_facts("AAA"), evidence=late_bridge)
        # 제안 단계는 통과하지만 탄생 시점 bridge가 없어 승격기가 막는다.
        self.assertEqual(packet.proposal_status, AUTO_PROVABLE)
        with self.assertRaises(QVPromotionError) as caught:
            self.plan([packet])
        self.assertIn("canonical bridge", str(caught.exception))

    def test_a_proposal_id_never_leaks_into_production_foreign_keys(self):
        plan = self.plan([packet_for(dual_class_facts())])
        apply_promotion(plan, directory=self.directory)
        text = "".join(
            (self.directory / name).read_text(encoding="utf-8")
            for name in ("issuers.jsonl", "share_classes.jsonl",
                         "prose_aliases.jsonl")
        )
        self.assertNotIn("prop-", text)
        self.assertIn(f"us-cik-{CIK}-class-v1-", text)


class BundleRedesignTest(ManifestFixture, unittest.TestCase):
    """세 파일 economic identity bundle과 v2 판별자."""

    def test_an_old_four_file_pinned_version_is_stale_against_the_new_bundle(self):
        """옛 네 파일 bundle에 고정된 제안은 **설계상** stale이다."""
        run = self.run_file(
            [packet_for(single_class_facts("AAA"))],
            identity_version=(
                "qv-identity-sha256:"
                "55ed78d0b33bb5f85ccf14e81a5a7d8e6bcbe82d17812e46470b3b133372e6ec"
            ),
        )
        with self.assertRaises(QVPromotionError) as caught:
            plan_promotion(run, manifest=self.manifest())
        self.assertIn(STALE_IDENTITY_BASE, str(caught.exception))

    def test_the_promoter_never_recreates_an_xbrl_alias_file(self):
        plan = self.plan([packet_for(dual_class_facts())])
        self.assertNotIn("xbrl_aliases.jsonl", plan.rows.added)
        apply_promotion(plan, directory=self.directory)
        self.assertFalse((self.directory / "xbrl_aliases.jsonl").exists())

    def test_the_repository_bundle_is_three_files_with_unchanged_anchor_ids(self):
        """기존 economic anchor id는 그대로다. 개명하지 않는다."""
        from backtest.qv_manifest import DEFAULT_MANIFEST_DIR

        manifest = load_manifest(DEFAULT_MANIFEST_DIR)
        validate(manifest)
        self.assertEqual(sorted(manifest.rows), [
            "issuers.jsonl", "prose_aliases.jsonl", "share_classes.jsonl",
        ])
        self.assertFalse((DEFAULT_MANIFEST_DIR / "xbrl_aliases.jsonl").exists())
        class_ids = {row["class_id"] for row in manifest.rows["share_classes.jsonl"]}
        self.assertEqual(class_ids, {
            "ua-a", "ua-c", "ua-conv", "cmcsa-a", "cmcsa-b", "cmcsa-aspecial",
            "nke-a", "nke-b", "googl-a", "googl-b", "googl-c",
        })
        self.assertFalse(any("-class-v1-" in item for item in class_ids))

    def test_the_class_id_seed_is_unchanged_for_equivalent_economic_inputs(self):
        """`qv-class-id-v1`은 이 재설계로 바뀌지 않는다."""
        self.assertEqual(
            class_id_v1(
                cik=CIK, effective_from=BIRTH,
                canonical_bridge_type=SECURITY_TITLE_FACT,
                canonical_bridge_key="class a common stock",
            ),
            "us-cik-0000000042-class-v1-"
            "cad86f404b705165f5123b6c2a217fc7b610862675dba53e91de03540ef4d188",
        )

    def test_no_xbrl_qname_enters_the_production_class_id_seed(self):
        base = self.plan([packet_for(single_class_facts("AAA"))])
        renamed = [
            dict(item, member="CompletelyDifferentMemberName")
            for item in single_class_facts("AAA")
        ]
        other = self.plan([packet_for(renamed)])
        self.assertEqual(
            sorted(base.packets[0].class_id_map.values()),
            sorted(other.packets[0].class_id_map.values()),
        )


class PromoterTest(ManifestFixture, unittest.TestCase):
    """정확한 pinned base + 재검증 통과 packet만 승격된다."""

    def test_a_dry_run_builds_a_valid_candidate_and_touches_nothing(self):
        before = self.snapshot()
        plan = self.plan([packet_for(dual_class_facts())])
        self.assertEqual(self.snapshot(), before)          # 파일 변화 없음
        self.assertNotEqual(
            plan.candidate_identity_source_version, plan.base_identity_source_version
        )
        self.assertTrue(
            plan.candidate_identity_source_version.startswith("qv-identity-sha256:")
        )
        receipt = plan.as_receipt(applied=False)
        self.assertEqual(receipt["stage"], "5A-2c")
        self.assertIs(receipt["applied"], False)

    def test_apply_adds_the_full_packet_and_the_bundle_still_validates(self):
        plan = self.plan([packet_for(dual_class_facts())])
        receipt = apply_promotion(plan, directory=self.directory)
        self.assertIs(receipt["applied"], True)

        manifest = load_manifest(self.directory)
        validate(manifest)
        self.assertEqual(
            manifest.identity_source_version, plan.candidate_identity_source_version
        )
        self.assertEqual(len(manifest.rows["issuers.jsonl"]), 1)
        self.assertEqual(len(manifest.rows["share_classes.jsonl"]), 2)
        # 제목 하나 + governing instrument 하나. **XBRL alias 파일이 없다.**
        self.assertEqual(len(manifest.rows["prose_aliases.jsonl"]), 2)
        self.assertNotIn("xbrl_aliases.jsonl", manifest.rows)

    def test_the_bundle_is_exactly_three_files(self):
        """**`xbrl_aliases.jsonl`을 다시 만들지 않는다.**"""
        plan = self.plan([packet_for(dual_class_facts())])
        apply_promotion(plan, directory=self.directory)
        self.assertEqual(
            sorted(item.name for item in self.directory.iterdir()),
            ["issuers.jsonl", "prose_aliases.jsonl", "share_classes.jsonl"],
        )

    def test_no_usable_from_session_reaches_the_manifest(self):
        plan = self.plan([packet_for(dual_class_facts())])
        apply_promotion(plan, directory=self.directory)
        for name in ("issuers.jsonl", "share_classes.jsonl", "prose_aliases.jsonl"):
            self.assertNotIn(
                "usable_from_session",
                (self.directory / name).read_text(encoding="utf-8"),
            )

    def test_a_stale_base_before_planning_fails(self):
        run = self.run_file(
            [packet_for(dual_class_facts())],
            identity_version="qv-identity-sha256:somethingelse",
        )
        with self.assertRaises(QVPromotionError) as caught:
            plan_promotion(run, manifest=self.manifest())
        self.assertIn(STALE_IDENTITY_BASE, str(caught.exception))

    def test_a_base_change_between_planning_and_apply_fails(self):
        plan = self.plan([packet_for(single_class_facts("AAA"))])
        # 계획 뒤에 누군가 manifest를 바꿨다.
        self.write({
            "issuers.jsonl": [{
                "issuer_id": "us-cik-0000000099", "cik": "0000000099",
                "resolution_method": "SEC_REGISTRANT_CIK", "provenance": "other",
                "evidence": [{
                    "source_kind": "KQ_FILING", "cik": "0000000099",
                    "accession": "0000000099-24-000001", "document_name": "d.htm",
                    "evidence_role": "SEC_REGISTRANT_CIK_ON_FILING",
                    "dependency": "REQUIRED",
                }],
            }],
            "share_classes.jsonl": [], "prose_aliases.jsonl": [],
        })
        before = self.snapshot()
        with self.assertRaises(QVPromotionError) as caught:
            apply_promotion(plan, directory=self.directory)
        self.assertIn(STALE_IDENTITY_BASE, str(caught.exception))
        self.assertEqual(self.snapshot(), before)          # 병합하지 않는다

    def test_a_tampered_packet_claiming_auto_provable_fails_revalidation(self):
        packet = packet_for(single_class_facts("AAA"))
        raw = packet.as_json()
        raw["share_class_proposals"][0]["interval"] = None
        with self.assertRaises(QVPromotionError):
            revalidate_packet(raw)

        # `interval_proved`만 true로 남겨도 구간 객체가 없으면 통하지 않는다.
        raw = packet.as_json()
        raw["share_class_proposals"][0].pop("interval")
        raw["share_class_proposals"][0]["interval_proved"] = True
        with self.assertRaises(QVPromotionError):
            revalidate_packet(raw)

        lying = packet_for(single_class_facts("AAA"), evidence=lambda proof: {})
        forged = lying.as_json()
        self.assertNotEqual(forged["proposal_status"], AUTO_PROVABLE)
        forged["proposal_status"] = AUTO_PROVABLE
        forged["reason_codes"] = ["MECHANICALLY_COMPLETE_SEC_PROOF"]
        with self.assertRaises(QVPromotionError):
            revalidate_packet(forged)

    def test_a_symbol_that_disagrees_with_the_embedded_cover_fails(self):
        raw = packet_for(single_class_facts("AAA")).as_json()
        raw["share_class_proposals"][0]["symbol"] = "ZZZ"
        with self.assertRaises(QVPromotionError):
            revalidate_packet(raw)

    def test_review_required_cannot_be_promoted(self):
        packet = packet_for(single_class_facts("AAA"), evidence=lambda proof: {})
        self.assertEqual(packet.proposal_status, "REVIEW_REQUIRED")
        with self.assertRaises(QVPromotionError):
            self.plan([packet])

    def test_unresolved_cannot_be_promoted(self):
        packet = build_symbol_proposal(
            work_item=WorkItem("GONE", "GONE", "DIRECT", ("2010-06-30",)),
            candidates=(),
        )
        self.assertEqual(packet.proposal_status, "UNRESOLVED")
        with self.assertRaises(QVPromotionError):
            self.plan([packet])

    def test_one_bad_selected_packet_aborts_the_whole_batch(self):
        good = packet_for(single_class_facts("AAA"))
        bad = packet_for(single_class_facts("BBB"), symbol="BBB",
                         accession="0000000042-24-000002")
        forged = bad.as_json()
        forged["conflicts"] = ["잔여 conflict"]
        run = self.run_file([good])
        payload = json.loads(Path(run.path).read_text(encoding="utf-8"))
        payload["proposals"].append(forged)
        Path(run.path).write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")

        before = self.snapshot()
        with self.assertRaises(QVPromotionError):
            plan_promotion(load_proposal_run(run.path), manifest=self.manifest())
        self.assertEqual(self.snapshot(), before)          # 조용히 건너뛰지 않는다

    def test_the_receipt_reports_the_untouched_statuses(self):
        good = packet_for(single_class_facts("AAA"))
        review = packet_for(single_class_facts("BBB"), symbol="BBB",
                            accession="0000000042-24-000002",
                            evidence=lambda proof: {})
        run = self.run_file([good])
        payload = json.loads(Path(run.path).read_text(encoding="utf-8"))
        payload["proposals"].append(review.as_json())
        Path(run.path).write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")

        plan = plan_promotion(load_proposal_run(run.path), manifest=self.manifest())
        receipt = plan.as_receipt(applied=False)
        self.assertEqual(receipt["left_untouched"]["REVIEW_REQUIRED"], 1)
        self.assertEqual(len(receipt["selected_work_items"]), 1)
        self.assertEqual(
            receipt["selected_work_items"][0]["identity_symbol"], "AAA"
        )

    def test_the_receipt_maps_proposal_ids_to_production_ids(self):
        plan = self.plan([packet_for(dual_class_facts())])
        entry = plan.as_receipt(applied=False)["selected_work_items"][0]
        mapping = entry["proposal_class_id_to_production_class_id"]
        self.assertTrue(all(key.startswith("prop-") for key in mapping))
        self.assertTrue(all("-class-v1-" in value for value in mapping.values()))
        self.assertEqual(len(entry["class_ids_generated"]), 2)
        self.assertEqual(entry["class_ids_reused"], [])


class ForgedPacketTest(ManifestFixture, unittest.TestCase):
    """`proposal_status`/`reason_codes`만 바꿔서는 승격 자격을 만들 수 없다.

    승격기는 원본 packet fact에서 5A-2b의 상태 결정 규칙을 **전부 다시 계산한다.**
    """

    def forge(self, packet, **overrides):
        raw = packet.as_json()
        raw["proposal_status"] = AUTO_PROVABLE
        raw["reason_codes"] = ["MECHANICALLY_COMPLETE_SEC_PROOF"]
        raw["conflicts"] = []
        raw.update(overrides)
        return raw

    def test_a_demanded_symbol_absent_from_the_cover_fails(self):
        """표지는 AAA를 증명하는데 요구 심볼이 BBB다."""
        proof = proof_for(single_class_facts("AAA"))
        packet = build_symbol_proposal(
            work_item=WorkItem("BBB", "BBB", "DIRECT", ("2024-06-28",)),
            candidates=(DiscoveryCandidate(cik=CIK, origin=CURRENT_TICKER_FILE,
                                           detail="Acme"),),
            proof=proof, class_evidence=complete_evidence(proof),
        )
        self.assertNotEqual(packet.proposal_status, AUTO_PROVABLE)
        with self.assertRaises(QVPromotionError) as caught:
            revalidate_packet(self.forge(packet))
        self.assertIn("정확히 하나로 잡히지 않습니다", str(caught.exception))

    def test_a_direct_item_with_mismatched_symbols_fails(self):
        packet = packet_for(single_class_facts("AAA"))
        with self.assertRaises(QVPromotionError) as caught:
            revalidate_packet(self.forge(packet, member_symbol="OTHER"))
        self.assertIn("DIRECT", str(caught.exception))

    def test_an_unknown_symbol_bridge_kind_fails(self):
        packet = packet_for(single_class_facts("AAA"))
        with self.assertRaises(QVPromotionError):
            revalidate_packet(self.forge(packet, symbol_bridge_kind="GUESS"))

    def test_a_forged_reused_series_with_current_ticker_only_fails(self):
        """`TFCFA -> FOXA` · CURRENT_TICKER_FILE 뿐 · AUTO_PROVABLE 위조."""
        proof = proof_for(single_class_facts("FOXA"))
        packet = build_symbol_proposal(
            work_item=WorkItem("TFCFA", "FOXA", "REUSED_VENDOR_SERIES", ("2010-06-30",)),
            candidates=(DiscoveryCandidate(cik=CIK, origin=CURRENT_TICKER_FILE,
                                           detail="Fox"),),
            proof=proof, class_evidence=complete_evidence(proof),
        )
        self.assertNotEqual(packet.proposal_status, AUTO_PROVABLE)
        with self.assertRaises(QVPromotionError) as caught:
            revalidate_packet(self.forge(packet))
        self.assertIn("현재 티커 계열 출처뿐", str(caught.exception))

    def test_a_reused_series_with_a_historical_origin_can_promote(self):
        proof = proof_for(single_class_facts("FOXA"))
        packet = build_symbol_proposal(
            work_item=WorkItem("TFCFA", "FOXA", "REUSED_VENDOR_SERIES", ("2010-06-30",)),
            candidates=(DiscoveryCandidate(cik=CIK, origin=HISTORICAL_NAME_LOOKUP,
                                           detail="21st Century Fox"),),
            proof=proof, class_evidence=complete_evidence(proof),
        )
        self.assertEqual(packet.proposal_status, AUTO_PROVABLE)
        self.assertEqual(revalidate_packet(packet.as_json()).identity_symbol, "FOXA")

    def test_a_successor_judgement_packet_cannot_be_promoted(self):
        proof = proof_for(single_class_facts("AAA"))
        packet = build_symbol_proposal(
            work_item=WorkItem("AAA", "AAA", "DIRECT", ("2024-06-28",)),
            candidates=(DiscoveryCandidate(cik=CIK, origin=CURRENT_TICKER_FILE,
                                           detail="Acme"),),
            proof=proof, class_evidence=complete_evidence(proof),
            successor_judgement_required=True,
        )
        with self.assertRaises(QVPromotionError) as caught:
            revalidate_packet(self.forge(packet))
        self.assertIn("승계", str(caught.exception))

    def test_a_missing_successor_field_fails_closed(self):
        packet = packet_for(single_class_facts("AAA"))
        raw = packet.as_json()
        raw.pop("successor_judgement_required")
        with self.assertRaises(QVPromotionError):
            revalidate_packet(raw)

    def test_a_forged_complete_census_over_a_rejected_cover_fails(self):
        """`class_census_status` 문자열을 권한으로 삼지 않는다."""
        proof = proof_for(single_class_facts("AAA"))
        packet = packet_for(single_class_facts("AAA"))
        raw = self.forge(packet)
        # 표지에 anomaly를 심는다 — `census_status()`가 거부하는 모양이다.
        raw["proof"]["anomalies"] = ["EXTRA_DIMENSION_ON_COVER_FACT"]
        raw["class_census_status"] = "CLASS_CENSUS_COMPLETE"
        with self.assertRaises(QVPromotionError):
            revalidate_packet(raw)
        del proof

        # 역할을 정할 수 없는 class 축 member를 섞어도 마찬가지다.
        raw = self.forge(packet_for(single_class_facts("AAA")))
        raw["proof"]["classes"].append({
            "member_key": "us-gaap:CommonClassZMember",
            "axis_namespace": USG, "axis_local": "StatementClassOfStockAxis",
            "member_namespace": USG, "member_local": "CommonClassZMember",
            "security_title": None, "title_concept": None,
            "trading_symbol": None, "has_shares_fact": False,
        })
        raw["class_census_status"] = "CLASS_CENSUS_COMPLETE"
        with self.assertRaises(QVPromotionError):
            revalidate_packet(raw)

    def test_an_alias_interval_outside_the_class_lifetime_fails(self):
        packet = packet_for(single_class_facts("AAA"))
        raw = self.forge(packet)
        raw["prose_alias_proposals"][0]["interval"]["effective_from"] = "2010-01-04"
        with self.assertRaises(QVPromotionError) as caught:
            revalidate_packet(raw)
        self.assertIn("class 수명 밖", str(caught.exception))

        raw = self.forge(packet_for(single_class_facts("AAA")))
        raw["share_class_proposals"][0]["interval"]["effective_to"] = "2019-01-02"
        raw["prose_alias_proposals"][0]["interval"]["effective_to"] = "2021-01-04"
        with self.assertRaises(QVPromotionError):
            revalidate_packet(raw)

    def test_an_interval_without_required_evidence_fails(self):
        packet = packet_for(single_class_facts("AAA"))
        raw = self.forge(packet)
        for item in raw["share_class_proposals"][0]["interval"]["evidence"]:
            item["dependency"] = "CORROBORATING"
        with self.assertRaises(QVPromotionError):
            revalidate_packet(raw)

    def test_a_cover_fact_cannot_substitute_for_interval_evidence(self):
        """관계 증거가 REQUIRED라는 이유로 구간 증거를 대신하지 못한다."""
        packet = packet_for(single_class_facts("AAA"))
        raw = self.forge(packet)
        relation_evidence = raw["share_class_proposals"][0]["evidence"]
        self.assertTrue(
            any(item["dependency"] == "REQUIRED" for item in relation_evidence)
        )
        raw["share_class_proposals"][0]["interval"]["evidence"] = []
        with self.assertRaises(QVPromotionError):
            revalidate_packet(raw)


class BatchProspectiveStateTest(ManifestFixture, unittest.TestCase):
    """한 batch의 packet들은 **하나의 전망 상태** 위에서 계획된다."""

    def sibling_facts(self, symbol):
        """같은 발행사의 같은 A/B sibling package를 A 또는 B 상장 심볼로 요구한다."""
        return [
            {"concept": "Security12bTitle", "value": "Class A Common Stock",
             "member": "CommonClassAMember", "context_id": "a"},
            {"concept": "TradingSymbol", "value": "AAA",
             "member": "CommonClassAMember", "context_id": "a"},
            {"concept": "EntityCommonStockSharesOutstanding", "value": "1000",
             "member": "CommonClassAMember", "context_id": "a", "numeric": True},
            {"concept": "Security12bTitle", "value": "Class B Common Stock",
             "member": "CommonClassBMember", "context_id": "b"},
            {"concept": "TradingSymbol", "value": "AAB",
             "member": "CommonClassBMember", "context_id": "b"},
            {"concept": "EntityCommonStockSharesOutstanding", "value": "500",
             "member": "CommonClassBMember", "context_id": "b", "numeric": True},
        ]

    def test_two_work_items_on_one_issuer_package_plan_it_exactly_once(self):
        facts = self.sibling_facts("AAA")
        first = packet_for(facts, symbol="AAA")
        second = packet_for(facts, symbol="AAB")
        self.assertEqual(first.proposal_status, AUTO_PROVABLE)
        self.assertEqual(second.proposal_status, AUTO_PROVABLE)

        plan = self.plan([first, second])
        # issuer 하나 · class 둘 · alias 각각 둘. **두 번 더하지 않는다.**
        self.assertEqual(len(plan.rows.added["issuers.jsonl"]), 1)
        self.assertEqual(len(plan.rows.added["share_classes.jsonl"]), 2)
        self.assertEqual(len(plan.rows.added["prose_aliases.jsonl"]), 2)
        # 두 번째 packet은 첫 번째가 계획한 것을 재사용한다.
        self.assertEqual(len(plan.packets[1].generated_class_ids), 0)
        self.assertEqual(len(plan.packets[1].reused_class_ids), 2)
        # receipt은 두 작업 항목 모두의 매핑을 같은 production id로 보인다.
        left = plan.packets[0].class_id_map
        right = plan.packets[1].class_id_map
        self.assertEqual(sorted(left.values()), sorted(right.values()))

        apply_promotion(plan, directory=self.directory)
        manifest = load_manifest(self.directory)
        validate(manifest)
        self.assertEqual(len(manifest.rows["issuers.jsonl"]), 1)
        self.assertEqual(len(manifest.rows["share_classes.jsonl"]), 2)
        self.assertEqual(len(manifest.rows["prose_aliases.jsonl"]), 2)

    def test_a_same_batch_semantic_disagreement_fails_the_whole_batch(self):
        facts = self.sibling_facts("AAA")
        first = packet_for(facts, symbol="AAA")
        second = packet_for(
            facts, symbol="AAB",
            evidence=lambda proof: complete_evidence(proof, start="2019-01-02"),
        )
        before = self.snapshot()
        with self.assertRaises(QVPromotionError):
            self.plan([first, second])
        self.assertEqual(self.snapshot(), before)

    def test_the_batch_sees_a_symbol_split_planned_earlier_in_the_same_batch(self):
        first = packet_for(single_class_facts("AAA"))
        clash = packet_for(
            single_class_facts("AAA", title="Common Shares of Beneficial Interest"),
            accession="0000000042-24-000031",
        )
        with self.assertRaises(QVPromotionError) as caught:
            self.plan([first, clash])
        self.assertIn("겹치는 구간에 두 class", str(caught.exception))


class RollbackTest(ManifestFixture, unittest.TestCase):
    def test_a_failure_while_writing_restores_all_four_files(self):
        """쓰다가 터진 파일 자신도 되돌린다 — 성공한 파일만으로는 모자란다."""
        plan = self.plan([packet_for(dual_class_facts())])
        before = self.snapshot()

        real_write = Path.write_text
        calls = {"n": 0}

        def flaky(self, data, *args, **kwargs):
            if self.name in ("issuers.jsonl", "share_classes.jsonl",
                             "xbrl_aliases.jsonl", "prose_aliases.jsonl"):
                calls["n"] += 1
                if calls["n"] == 3:
                    # 세 번째 파일을 **잘라 놓고** 실패한다.
                    real_write(self, "{ truncated", *args, **kwargs)
                    raise OSError("디스크가 터졌다고 치자")
            return real_write(self, data, *args, **kwargs)

        Path.write_text = flaky
        try:
            with self.assertRaises(OSError):
                apply_promotion(plan, directory=self.directory)
        finally:
            Path.write_text = real_write

        self.assertEqual(self.snapshot(), before)
        # 되돌린 bundle이 여전히 읽히고 검증된다.
        validate(load_manifest(self.directory))


class ExistingRowsTest(ManifestFixture, unittest.TestCase):
    """기존 행은 append/reuse 전용이다."""

    def seed(self, packet=None):
        """한 번 승격해 기존 행을 만든다."""
        plan = self.plan([packet or packet_for(single_class_facts("AAA"))])
        apply_promotion(plan, directory=self.directory)
        return plan

    def test_exact_existing_rows_are_reused_not_duplicated(self):
        first = self.seed()
        class_id = first.packets[0].generated_class_ids[0]

        second = self.plan([packet_for(single_class_facts("AAA"))])
        self.assertEqual(second.packets[0].reused_class_ids, (class_id,))
        self.assertEqual(second.packets[0].generated_class_ids, ())
        self.assertEqual(second.rows.added["issuers.jsonl"], [])
        self.assertEqual(second.rows.added["share_classes.jsonl"], [])
        self.assertEqual(second.rows.added["prose_aliases.jsonl"], [])
        # 아무것도 더할 것이 없으면 bundle 해시가 그대로다.
        self.assertEqual(
            second.candidate_identity_source_version,
            second.base_identity_source_version,
        )

    def test_an_existing_class_interval_is_never_extended(self):
        self.seed()
        later = packet_for(
            single_class_facts("AAA"),
            evidence=lambda proof: complete_evidence(proof, start="2019-01-02"),
        )
        with self.assertRaises(QVPromotionError) as caught:
            self.plan([later])
        self.assertIn("자동으로 고치지 않습니다", str(caught.exception))

    def test_existing_required_evidence_is_never_modified(self):
        before = self.seed()
        original = (self.directory / "share_classes.jsonl").read_bytes()
        plan = self.plan([packet_for(single_class_facts("AAA"))])
        apply_promotion(plan, directory=self.directory)
        self.assertEqual((self.directory / "share_classes.jsonl").read_bytes(), original)
        del before

    def test_an_existing_issuer_with_a_different_cik_fails_closed(self):
        self.write({
            "issuers.jsonl": [{
                "issuer_id": f"us-cik-{CIK}", "cik": "0000000077",
                "resolution_method": "SEC_REGISTRANT_CIK", "provenance": "other",
                "evidence": [{
                    "source_kind": "KQ_FILING", "cik": "0000000077",
                    "accession": "0000000077-24-000001", "document_name": "d.htm",
                    "evidence_role": "SEC_REGISTRANT_CIK_ON_FILING",
                    "dependency": "REQUIRED",
                }],
            }],
            "share_classes.jsonl": [], "prose_aliases.jsonl": [],
        })
        with self.assertRaises(QVPromotionError):
            self.plan([packet_for(single_class_facts("AAA"))])

    def test_an_ambiguous_existing_bridge_match_fails_closed(self):
        """같은 canonical 철자가 두 기존 class에 맞으면 **고르지 않는다.**

        `validate()`가 그런 bundle을 애초에 거부하므로 이것은 방어 불변식이다.
        `resolve_class_id`를 직접 세워 그 자리가 fail-close임을 잠근다.
        """
        row = {
            "proposal_class_id": "prop-x", "issuer_id": f"us-cik-{CIK}",
            "symbol": "AAA", "is_ordinary_common": True, "is_listed": True,
            "effective_from": BIRTH, "effective_to": None,
        }
        bridges = [{
            "bridge_type": SECURITY_TITLE_FACT, "comparison_key": "aaa common stock",
            "effective_from": BIRTH, "effective_to": None,
        }]

        def prose(class_id):
            return {
                "class_id": class_id, "issuer_id": f"us-cik-{CIK}",
                "comparison_key": "aaa common stock",
                "bridge_type": SECURITY_TITLE_FACT,
                "effective_from": BIRTH, "effective_to": None,
            }

        def klass(class_id):
            return {
                "class_id": class_id, "issuer_id": f"us-cik-{CIK}", "symbol": "AAA",
                "is_ordinary_common": True, "is_listed": True,
                "effective_from": BIRTH, "effective_to": None,
            }

        stub = SimpleNamespace(rows={
            "issuers.jsonl": (),
            "share_classes.jsonl": (klass("one"), klass("two")),
            "xbrl_aliases.jsonl": (),
            "prose_aliases.jsonl": (prose("one"), prose("two")),
        })
        with self.assertRaises(QVPromotionError) as caught:
            resolve_class_id(
                stub, issuer_id=f"us-cik-{CIK}", cik=CIK,
                class_row=row, bridges=bridges,
            )
        self.assertIn("둘 이상", str(caught.exception))

    def test_an_existing_human_readable_class_id_is_reused_not_renamed(self):
        """`nke-b` 같은 기존 id는 안정적 foreign key다. v1로 바꾸지 않는다."""
        first = self.seed()
        class_id = first.packets[0].generated_class_ids[0]
        manifest = self.manifest()
        rename = {}
        for name, rows in manifest.rows.items():
            out = []
            for row in rows:
                row = dict(row)
                if row.get("class_id") == class_id:
                    row["class_id"] = "acme-common"
                out.append(row)
            rename[name] = out
        self.write(rename)

        plan = self.plan([packet_for(single_class_facts("AAA"))])
        self.assertEqual(plan.packets[0].reused_class_ids, ("acme-common",))
        self.assertEqual(plan.packets[0].generated_class_ids, ())
        apply_promotion(plan, directory=self.directory)
        text = (self.directory / "share_classes.jsonl").read_text(encoding="utf-8")
        self.assertIn("acme-common", text)
        self.assertNotIn("-class-v1-", text)


class ConflictTest(ManifestFixture, unittest.TestCase):
    def test_the_same_listed_symbol_over_two_classes_fails_before_write(self):
        plan = self.plan([packet_for(single_class_facts("AAA"))])
        apply_promotion(plan, directory=self.directory)
        before = self.snapshot()
        # 같은 심볼 · 겹치는 구간 · 다른 canonical 철자 → 다른 class가 된다.
        other = packet_for(
            single_class_facts("AAA", title="Common Shares of Beneficial Interest"),
            accession="0000000042-24-000009",
        )
        with self.assertRaises(QVPromotionError) as caught:
            self.plan([other])
        self.assertIn("겹치는 구간에 두 class", str(caught.exception))
        self.assertEqual(self.snapshot(), before)

    def test_a_prose_alias_pointing_at_two_classes_fails_before_write(self):
        """같은 issuer·시점의 같은 canonical 철자가 두 class로 가면 validate가 막는다."""
        plan = self.plan([packet_for(single_class_facts("AAA"))])
        apply_promotion(plan, directory=self.directory)
        before = self.snapshot()
        manifest = self.manifest()
        # 같은 철자를 다른 class에 붙인 행을 심는다 — 후보 bundle 검증이 막아야 한다.
        prose = [dict(row) for row in manifest.rows["prose_aliases.jsonl"]]
        classes = [dict(row) for row in manifest.rows["share_classes.jsonl"]]
        self.write({
            "issuers.jsonl": [dict(row) for row in manifest.rows["issuers.jsonl"]],
            "share_classes.jsonl": classes + [
                dict(classes[0], class_id="twin", symbol=None, is_listed=False)
            ],
            "prose_aliases.jsonl": prose + [dict(prose[0], class_id="twin")],
        })
        with self.assertRaises(Exception):
            self.plan([packet_for(single_class_facts("AAA"))])
        del before


class InputContractTest(ManifestFixture, unittest.TestCase):
    def payload_file(self, mutate):
        manifest = self.manifest()
        payload = run_payload(
            [packet_for(single_class_facts("AAA"))],
            identity_version=manifest.identity_source_version,
        )
        mutate(payload)
        path = self.directory.parent / "bad-run.json"
        path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
        self.addCleanup(lambda: path.unlink(missing_ok=True))
        return path

    def test_a_non_5a2_payload_fails_closed(self):
        for mutate in (
            lambda p: p.update(stage="5A-1"),
            lambda p: p.update(produces="SOMETHING_ELSE"),
            lambda p: p.update(mutates_production_manifest=True),
        ):
            with self.subTest(mutate=mutate):
                with self.assertRaises(QVPromotionError):
                    load_proposal_run(self.payload_file(mutate))

    def test_every_required_demand_provenance_field_fails_closed(self):
        for name in ("index_name", "universe_source", "universe_source_version",
                     "calendar_source", "calendar_source_version",
                     "reused_series_source", "reused_series_source_version",
                     "identity_source_version"):
            with self.subTest(field=name):
                with self.assertRaises(QVPromotionError):
                    load_proposal_run(
                        self.payload_file(
                            lambda p, n=name: p["demand_provenance"].pop(n)
                        )
                    )

    def test_disagreeing_identity_versions_fail_closed(self):
        with self.assertRaises(QVPromotionError):
            load_proposal_run(
                self.payload_file(
                    lambda p: p.update(identity_source_version="qv-identity-sha256:other")
                )
            )

    def test_the_receipt_is_deterministic(self):
        first = self.plan([packet_for(dual_class_facts())]).as_receipt(applied=False)
        second = self.plan([packet_for(dual_class_facts())]).as_receipt(applied=False)
        first.pop("proposal_run_path"), second.pop("proposal_run_path")
        self.assertEqual(
            json.dumps(first, sort_keys=True), json.dumps(second, sort_keys=True)
        )


class NoDatabaseTest(unittest.TestCase):
    def test_the_promoter_imports_no_database_or_production_manifest_path(self):
        """DB도 production manifest 경로도 이 모듈에 들어오지 않는다."""
        import backtest.qv_identity_promotion as module

        self.assertFalse(hasattr(module, "sqlite3"))
        self.assertFalse(hasattr(module, "store"))
        self.assertFalse(hasattr(module, "materialize"))
        self.assertFalse(hasattr(module, "DEFAULT_MANIFEST_DIR"))

    def test_no_database_statement_is_written_in_the_module(self):
        source = (
            TRADING_ROOT / "backtest" / "qv_identity_promotion.py"
        ).read_text(encoding="utf-8")
        for forbidden in ("import sqlite3", "connection.execute", "store.connect",
                          "INSERT INTO", "DELETE FROM", "CREATE TABLE"):
            self.assertNotIn(forbidden, source, forbidden)

    def test_the_scheme_name_is_frozen(self):
        self.assertEqual(CLASS_ID_SCHEME, "qv-class-id-v1")


if __name__ == "__main__":
    unittest.main()
