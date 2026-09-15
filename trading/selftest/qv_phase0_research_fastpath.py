"""QV Phase 0 research fast-path coverage preflight runner.

**RESEARCH ONLY.** production identity · manifest · selector · ME · schema를 바꾸지 않는다.
사용자의 trading DB는 읽기 전용으로만 붙인다. 수익률을 계산하지 않는다.
누락은 누락으로 남고 어떤 SEC/법적/관할 탐색도 새로 열지 않는다.

    python -m selftest.qv_phase0_research_fastpath pins
    python -m selftest.qv_phase0_research_fastpath fetch [--limit-ciks N] [--workers 6]
    python -m selftest.qv_phase0_research_fastpath splits
    python -m selftest.qv_phase0_research_fastpath finalize

실행 위치는 `trading/`다.
"""

from __future__ import annotations

import argparse
import bisect
import collections
import gzip
import hashlib
import html
import http.client
import io
import json
import os
import re
import sqlite3
import sys
import threading
import time
import traceback
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from backtest import edgar, qv_accounting, qv_research_fastpath as fp
from backtest.qv_submissions import (
    _historical_usable_session,
    _submissions_rows,
    historical_sic,
    parse_filing_sic,
)
from backtest.qv_xbrl import (
    XBRLI_NS,
    QVXbrlError,
    candidate_xml_names,
    looks_like_instance,
    parse_filing_summary,
    parse_instance,
)

TRADING = Path(__file__).resolve().parents[1]
DATA = TRADING / "data"
OUT = DATA / "qv-phase0-research-fastpath"
PROD_DB = DATA / "backtest.db"
SCHEMA = TRADING / "backtest" / "schema.sql"

INVENTORY = DATA / "qv-5a2-run" / "qv-5a1-v3-inventory.json"
PROPOSALS = DATA / "qv-5a2-run" / "qv-5a2-legal-proposals.json"
PINS = {
    INVENTORY: "dc13cae6c9f375c2f1dea72a01da9bc16682d7298fcc2b24900d03feb5a8ceba",
    PROPOSALS: "b68813def1f815c174ff454b89a6b198ddbac3eb6fe631ae1232f486b364cfc5",
}
READ_CACHES = [
    OUT / "cache",
    DATA / "qv-1048-xbrl-first-jurisdiction-census" / "cache",
    DATA / "qv-1047-jurisdiction-source-reconciliation" / "cache",
    DATA / "qv-1046-full-jurisdiction-census" / "cache",
]

CALENDAR_SOURCE = "eodhd"
CALENDAR_VERSION = "eodhd-15y-2026-08"
PRICE_SOURCE = "eodhd"
PRICE_VERSION = "eodhd-15y-2026-08"
KQ_METADATA_VERSION = "qv-research-fastpath-kq-metadata-v1"
SIC_VERSION = "qv-research-fastpath-sic-v1"
ACCOUNTING_SOURCE = "sec-edgar-archives"
ACCOUNTING_VERSION = "qv-research-fastpath-accounting-v1"
FILINGS_FLOOR = "2005-01-01"
LAST_FORMATION = "2026-06-30"
REQUESTS_PER_SECOND = 8.0
PREFIX_BYTES = 8192


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def verify_pins() -> None:
    for path, expected in PINS.items():
        actual = sha256_file(path)
        if actual != expected:
            raise SystemExit(f"STOP = QV_FASTPATH_PIN_MISMATCH: {path.name} {actual} != {expected}")
    print("pins verified: 5A-1 inventory · 5A-2 proposals")


def load_population() -> tuple[list[dict], list[dict]]:
    inventory = json.loads(INVENTORY.read_text())
    proposals = json.loads(PROPOSALS.read_text())
    rows = fp.membership_rows(inventory, proposals)
    return rows, fp.issuer_formations(rows)


# ── SEC transport: cache chain · global rate limit · retry · prefix read ─────


class Counters:
    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.values = collections.Counter()

    def add(self, key: str, amount: int = 1) -> None:
        with self.lock:
            self.values[key] += amount


class RateLimiter:
    def __init__(self, per_second: float) -> None:
        self.interval = 1.0 / per_second
        self.lock = threading.Lock()
        self.next_at = 0.0

    def wait(self) -> None:
        with self.lock:
            now = time.monotonic()
            slot = max(now, self.next_at)
            self.next_at = slot + self.interval
        delay = slot - time.monotonic()
        if delay > 0:
            time.sleep(delay)


def cache_key(url: str) -> str:
    return hashlib.sha256(url.encode()).hexdigest()[:26]


class CachedEdgarClient(edgar.EdgarClient):
    """frozen EdgarClient 메서드를 그대로 쓰고 `_read` 전송층만 바꾼다. 의미는 바꾸지 않는다."""

    def __init__(self, limiter: RateLimiter, counters: Counters) -> None:
        super().__init__()
        self.limiter = limiter
        self.counters = counters
        (OUT / "cache").mkdir(parents=True, exist_ok=True)

    def _cached(self, url: str) -> bytes | None:
        key = cache_key(url)
        for directory in READ_CACHES:
            path = directory / key
            if path.exists():
                return path.read_bytes()
            gz = directory / (key + ".gz")
            if gz.exists():
                return gzip.decompress(gz.read_bytes())
        return None

    def _network(self, url: str, headers: dict | None = None) -> bytes:
        delay = 2.0
        for attempt in range(5):
            self.limiter.wait()
            extra = dict(headers or {})
            if "Range" not in extra:
                extra["Accept-Encoding"] = "gzip"  # 전송 압축뿐이다. 풀린 바이트는 원문과 같다.
            request = urllib.request.Request(url, headers={"User-Agent": self.user_agent, **extra})
            try:
                with urllib.request.urlopen(request, timeout=180) as response:
                    wire = response.read()
                    encoding = response.headers.get("Content-Encoding")
                body = gzip.decompress(wire) if encoding == "gzip" else wire
                self.counters.add("requests")
                self.counters.add("wire_bytes", len(wire))
                self.counters.add("bytes", len(body))
                return body
            except urllib.error.HTTPError as error:
                self.counters.add("requests")
                if error.code == 404:
                    self.counters.add("http_404")
                    raise edgar.EdgarError(f"HTTP 404: {url}") from error
                if error.code == 416:
                    raise edgar.EdgarError(f"HTTP 416: {url}") from error
                if attempt == 4:
                    self.counters.add("transport_failure")
                    raise edgar.EdgarError(f"HTTP {error.code}: {url}") from error
            except (urllib.error.URLError, http.client.HTTPException, TimeoutError, OSError, EOFError) as error:
                self.counters.add("requests")
                if attempt == 4:
                    self.counters.add("transport_failure")
                    raise edgar.EdgarError(f"transport: {url} ({error})") from error
            self.counters.add("retry")
            time.sleep(delay)
            delay *= 2
        raise AssertionError("unreachable")

    def _read(self, url: str) -> bytes:
        hit = self._cached(url)
        if hit is not None:
            self.counters.add("cache_hit")
            return hit
        missing = OUT / "cache" / (cache_key(url) + ".404")
        if missing.exists():
            self.counters.add("cache_hit_404")
            raise edgar.EdgarError(f"HTTP 404 (cached): {url}")
        try:
            body = self._network(url)
        except edgar.EdgarError as error:
            if "HTTP 404" in str(error):
                missing.write_text("404")
            raise
        target = OUT / "cache" / (cache_key(url) + ".gz")
        target.write_bytes(gzip.compress(body, compresslevel=3))
        return body

    def root_tag(self, url: str) -> str | None:
        """파일 앞부분의 **XML root 요소**만 읽는다. 파일명으로 판정하지 않는다."""
        marker = OUT / "cache" / (cache_key(url) + ".root")
        if marker.exists():
            self.counters.add("cache_hit_root")
            return marker.read_text() or None
        hit = self._cached(url)
        if hit is None:
            hit = self._network(url, {"Range": f"bytes=0-{PREFIX_BYTES - 1}"})
            self.counters.add("prefix_reads")
        tag = first_start_tag(hit)
        marker.write_text(tag or "")
        return tag


def first_start_tag(prefix: bytes) -> str | None:
    parser = ET.XMLPullParser(events=("start",))
    try:
        parser.feed(prefix)
        for _event, element in parser.read_events():
            return element.tag
    except ET.ParseError:
        return None
    return None


def header_text(client: CachedEdgarClient, cik: str, accession: str) -> tuple[str, str]:
    """filing-time SEC header 원문. index-headers의 `<PRE>`는 같은 header의 HTML 표기다."""
    base = edgar.accession_dir_url(cik, accession)
    if int(accession[11:13]) >= 15:
        try:
            page = client._read(f"{base}/{accession}-index-headers.html").decode("latin-1")
            matched = re.search(r"<PRE>(.*?)</PRE>", page, re.S | re.I)
            if matched:
                text = html.unescape(matched.group(1))
                if "</SEC-HEADER>" in text:
                    return text, "INDEX_HEADER_PRE"
        except edgar.EdgarError:
            pass
    url = edgar.complete_submission_url(cik, accession)
    cached = client._cached(url)
    if cached is not None:
        client.counters.add("cache_hit")
        return cached.decode("latin-1"), "COMPLETE_SUBMISSION"
    prefix = client._network(url, {"Range": "bytes=0-262143"}).decode("latin-1")
    if "</SEC-HEADER>" in prefix:
        return prefix, "COMPLETE_SUBMISSION_PREFIX"
    return client._read(url).decode("latin-1"), "COMPLETE_SUBMISSION"


# ── per-CIK network stage ────────────────────────────────────────────────────


def usable_session(sessions: list[str], eastern_date: str | None) -> str | None:
    """`_historical_usable_session`과 같은 정의(acceptance Eastern date 다음 첫 SPY 세션). 계획용."""
    if eastern_date is None:
        return None
    index = bisect.bisect_right(sessions, eastern_date)
    return sessions[index] if index < len(sessions) else None


def instance_for_quarterly(client: CachedEdgarClient, cik: str, accession: str) -> list:
    """shares 전용 instance discovery. 동결된 candidate 선택 · root 요소 판정 · parse_instance."""
    base = edgar.accession_dir_url(cik, accession)
    index_payload = client.accession_index(cik, accession)
    summary = None
    try:
        raw = client.accession_file_bytes(cik, accession, "FilingSummary.xml")
        summary = parse_filing_summary(raw, "FilingSummary.xml")
    except edgar.EdgarError as error:
        if "404" not in str(error):
            raise
    instances = []
    for name in candidate_xml_names(index_payload, summary):
        tag = client.root_tag(f"{base}/{name}")
        if tag is not None and tag != f"{{{XBRLI_NS}}}xbrl":
            continue
        data = client.accession_file_bytes(cik, accession, name)
        if looks_like_instance(data, name):
            instances.append(parse_instance(data, name))
    return instances


def filing_record(instances: list, *, cik: str) -> dict:
    facts, covers = [], {}
    for instance in instances:
        facts.extend(fp.share_facts(instance, cik=cik))
        covers[instance.source_file] = fp.cover_listing(instance, cik=cik)
    symbols = sorted({s for cover in covers.values() for s in cover["common_symbols"]})
    return {"share_facts": facts, "cover": {"common_symbols": symbols}, "instances": [i.source_file for i in instances]}


def process_cik(cik: str, formations: list[dict], sessions: list[str], client: CachedEdgarClient) -> dict:
    rows = [row for row in _submissions_rows(client, cik) if row.acceptance_eastern_date and FILINGS_FLOOR <= row.acceptance_eastern_date <= LAST_FORMATION]
    filings = []
    for row in rows:
        filings.append({
            "accession": row.accession, "form": row.form, "filed_date": row.filed_date,
            "report_date": row.report_date, "acceptance_datetime": row.acceptance_datetime,
            "acceptance_eastern_date": row.acceptance_eastern_date, "primary_document": row.primary_document,
            "submissions_file": row.submissions_file,
            "planned_usable_session": usable_session(sessions, row.acceptance_eastern_date),
        })
    by_accession = {f["accession"]: f for f in filings}

    sic_results: dict[str, dict] = {}
    plans = []
    for formation in formations:
        f_session = formation["formation_session"]
        usable = [f for f in filings if f["planned_usable_session"] and f["planned_usable_session"] <= f_session]
        usable.sort(key=lambda f: (f["acceptance_datetime"], f["accession"]), reverse=True)
        sic_accession = usable[0]["accession"] if usable else None
        if sic_accession and sic_accession not in sic_results:
            try:
                text, transport = header_text(client, cik, sic_accession)
                parsed = parse_filing_sic(text, cik)
                sic_results[sic_accession] = {"filing_sic": parsed.filing_sic, "status": parsed.status, "transport": transport}
            except edgar.EdgarError as error:
                sic_results[sic_accession] = {"filing_sic": None, "status": "SOURCE_INCOMPLETE", "transport": None, "error": str(error)[:200]}
        sic = sic_results.get(sic_accession) if sic_accession else None
        group = "CLASSIFICATION_MISSING" if not sic or sic["status"] != "EXACT" else fp.sic_group(sic["filing_sic"])
        plans.append({"formation": formation, "sic_accession": sic_accession, "group": group})

    accounting: dict[str, dict] = {}
    quarterly: dict[str, dict] = {}
    for plan in plans:
        if plan["group"] == "FINANCIAL":
            continue
        f_session = plan["formation"]["formation_session"]
        year = int(f_session[:4])
        for filing in filings:
            if filing["form"] not in ("10-K", "10-K/A") or filing["accession"] in accounting:
                continue
            if not filing["planned_usable_session"] or filing["planned_usable_session"] > f_session:
                continue
            report_year = int(filing["report_date"][:4]) if filing["report_date"] else None
            if report_year is not None and report_year not in (year - 2, year - 1, year):
                continue
            try:
                bundle = qv_accounting.fetch_bundle(client, cik, filing["accession"])
                result = qv_accounting.resolve_accounting(bundle, report_date=filing["report_date"])
                accounting[filing["accession"]] = {
                    "status": "FETCHED",
                    "result": result_payload(result, bundle),
                    **filing_record(bundle.instances, cik=cik),
                }
            except (qv_accounting.QVAccountingError, QVXbrlError, edgar.EdgarError) as error:
                accounting[filing["accession"]] = {"status": "SOURCE_INCOMPLETE", "error": str(error)[:300]}

        if plan["formation"]["security_count"] != 1:
            continue
        window_floor = f"{year - 1:04d}-01-01"
        for filing in filings:
            accession = filing["accession"]
            if accession in quarterly or accession in accounting:
                continue
            if not filing["planned_usable_session"] or filing["planned_usable_session"] > f_session:
                continue
            if filing["acceptance_eastern_date"] < window_floor:
                continue
            try:
                instances = instance_for_quarterly(client, cik, accession)
                quarterly[accession] = {"status": "FETCHED", **filing_record(instances, cik=cik)}
            except (QVXbrlError, edgar.EdgarError) as error:
                quarterly[accession] = {"status": "SOURCE_INCOMPLETE", "error": str(error)[:300]}

    return {
        "cik": cik,
        "filings": filings,
        "sic": sic_results,
        "accounting": accounting,
        "quarterly": quarterly,
        "fastpath_version": fp.FASTPATH_VERSION,
    }


ACCOUNTING_FIELDS = (
    "fiscal_period_end", "period_crosscheck_status", "income_statement_role", "balance_sheet_role",
    "revenue_value", "revenue_status", "cogs_value", "cogs_status", "gross_profit_value",
    "gross_profit_status", "direct_gross_profit_value", "gross_profit_tieout_status", "assets_value",
    "assets_status", "assets_tieout_status", "parent_se_value", "parent_se_status", "parent_se_path",
    "nci_tieout_status", "preferred_value", "preferred_status", "preferred_tier",
    "book_equity_value", "book_equity_status",
)


def result_payload(result, bundle) -> dict:
    payload = {name: getattr(result, name) for name in ACCOUNTING_FIELDS}
    payload["provenance"] = result.provenance
    payload["diagnostics"] = result.diagnostics
    payload["bundle_provenance"] = qv_accounting._bundle_provenance(bundle, ACCOUNTING_SOURCE, ACCOUNTING_VERSION)
    return payload


def spy_sessions() -> list[str]:
    connection = sqlite3.connect(f"file:{PROD_DB}?mode=ro", uri=True)
    rows = connection.execute(
        "SELECT trade_date FROM bars_daily WHERE symbol='SPY' AND source=? AND source_version=? ORDER BY trade_date",
        (CALENDAR_SOURCE, CALENDAR_VERSION),
    ).fetchall()
    connection.close()
    return [row[0] for row in rows]


def run_fetch(limit_ciks: int | None, workers: int) -> None:
    verify_pins()
    _rows, formations = load_population()
    by_cik: dict[str, list[dict]] = collections.defaultdict(list)
    for formation in formations:
        by_cik[formation["selected_cik"]].append(formation)
    ciks = sorted(by_cik)
    done_dir = OUT / "cik"
    done_dir.mkdir(parents=True, exist_ok=True)
    todo = [cik for cik in ciks if not (done_dir / f"{cik}.json.gz").exists()]
    if limit_ciks:
        todo = sorted(todo, key=lambda c: hashlib.sha256(f"qv-fastpath-pilot-v1|{c}".encode()).hexdigest())[:limit_ciks]
    sessions = spy_sessions()
    counters = Counters()
    limiter = RateLimiter(REQUESTS_PER_SECOND)
    started = time.time()
    print(f"ciks total {len(ciks)} · done {len(ciks) - len([c for c in ciks if not (done_dir / f'{c}.json.gz').exists()])} · this pass {len(todo)}", flush=True)

    def work(cik: str) -> str:
        client = CachedEdgarClient(limiter, counters)
        record = process_cik(cik, by_cik[cik], sessions, client)
        tmp = done_dir / f"{cik}.json.gz.tmp"
        tmp.write_bytes(gzip.compress(json.dumps(record, sort_keys=True).encode()))
        tmp.replace(done_dir / f"{cik}.json.gz")
        return cik

    errors = 0
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(work, cik): cik for cik in todo}
        for index, future in enumerate(as_completed(futures), 1):
            cik = futures[future]
            try:
                future.result()
            except Exception:
                errors += 1
                (OUT / "cik_errors").mkdir(exist_ok=True)
                (OUT / "cik_errors" / f"{cik}.txt").write_text(traceback.format_exc())
            if index % 10 == 0 or index == len(todo):
                elapsed = time.time() - started
                c = counters.values
                print(f"  {index}/{len(todo)} ciks · {elapsed:.0f}s · req {c['requests']} · prefix {c['prefix_reads']} · hit {c['cache_hit']} · {c['bytes']/1e6:.0f}MB · retry {c['retry']} · 404 {c['http_404']} · fail {c['transport_failure']} · errors {errors}", flush=True)
    stats = {"ciks": len(todo), "wall_seconds": round(time.time() - started, 1), "errors": errors, "counters": dict(counters.values), "workers": workers}
    with open(OUT / "fetch_stats.jsonl", "a") as handle:
        handle.write(json.dumps(stats, sort_keys=True) + "\n")
    print(json.dumps(stats, indent=1))


# ── EODHD vendor splits (research guard input only) ──────────────────────────


def run_splits() -> None:
    from backtest.eodhd import EodhdClient, EodhdError

    _rows, formations = load_population()
    symbols = sorted({f["members"][0]["member_symbol"] for f in formations if f["security_count"] == 1})
    target = OUT / "splits"
    target.mkdir(parents=True, exist_ok=True)
    client = EodhdClient()
    fetched = failed = 0
    for symbol in symbols:
        path = target / f"{symbol}.json"
        if path.exists() and json.loads(path.read_text())["status"] == "FETCHED":
            continue
        try:
            events = client.splits(f"{symbol}.US")
            path.write_text(json.dumps({"symbol": symbol, "status": "FETCHED", "events": [[e.split_date, e.raw_split] for e in events]}))
            fetched += 1
        except (EodhdError, OSError) as error:
            path.write_text(json.dumps({"symbol": symbol, "status": "SOURCE_INCOMPLETE", "error": str(error)[:200]}))
            failed += 1
    print(json.dumps({"symbols": len(symbols), "fetched": fetched, "failed": failed, "eodhd_calls": client.calls}))



# ── offline finalize: run-local DB · frozen selection functions · coverage ────

SIC_DIVISIONS = (
    ("01", "09", "AGRICULTURE"), ("10", "14", "MINING"), ("15", "17", "CONSTRUCTION"),
    ("20", "39", "MANUFACTURING"), ("40", "49", "TRANSPORT_UTILITIES"), ("50", "51", "WHOLESALE"),
    ("52", "59", "RETAIL"), ("60", "67", "FINANCE"), ("70", "89", "SERVICES"), ("91", "99", "PUBLIC_ADMIN"),
)


def sic_division(filing_sic: str | None) -> str:
    if filing_sic is None:
        return "CLASSIFICATION_MISSING"
    head = filing_sic[:2]
    for low, high, name in SIC_DIVISIONS:
        if low <= head <= high:
            return name
    return "NONCLASSIFIABLE"


def research_db() -> sqlite3.Connection:
    path = OUT / "research.db"
    if path.exists():
        path.unlink()
    connection = sqlite3.connect(f"file:{path}", uri=True)
    connection.row_factory = sqlite3.Row
    connection.executescript(SCHEMA.read_text())
    # 가격·달력은 사용자 DB를 **읽기 전용**으로 붙여 읽는다. run-local 빈 bars_daily가 가리지 않게 지운다.
    connection.execute("DROP TABLE bars_daily")
    connection.execute("ATTACH DATABASE ? AS prod", (f"file:{PROD_DB}?mode=ro",))
    return connection


def insert_filing(connection, cik: str, filing: dict, version: str, sic: dict | None) -> str | None:
    usable = _historical_usable_session(connection, filing["acceptance_eastern_date"], CALENDAR_SOURCE, CALENDAR_VERSION)
    if usable != filing["planned_usable_session"]:
        raise SystemExit(f"STOP: planned usable session != frozen helper for {cik} {filing['accession']}")
    status = sic["status"] if sic else "MISSING"
    provenance = {
        "fastpath_version": fp.FASTPATH_VERSION,
        "target_cik": cik,
        "accession": filing["accession"],
        "submissions_file": filing["submissions_file"],
        "sic_fetched": sic is not None,
        "sic_transport": sic.get("transport") if sic else None,
    }
    connection.execute(
        "INSERT INTO qv_sec_filings (cik, accession, form, filed_date, report_date, acceptance_datetime,"
        " acceptance_eastern_date, historical_usable_session, filing_sic, sic_status, primary_document,"
        " submissions_file, calendar_source, calendar_source_version, source, source_version, provenance)"
        " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (cik, filing["accession"], filing["form"], filing["filed_date"], filing["report_date"],
         filing["acceptance_datetime"], filing["acceptance_eastern_date"], usable,
         sic["filing_sic"] if sic and status == "EXACT" else None, status, filing["primary_document"],
         filing["submissions_file"], CALENDAR_SOURCE, CALENDAR_VERSION, "sec-submissions", version,
         json.dumps(provenance, sort_keys=True)),
    )
    return usable


def insert_accounting(connection, cik: str, accession: str, payload: dict) -> None:
    prov = payload["provenance"]
    values = (
        cik, accession, KQ_METADATA_VERSION, ACCOUNTING_SOURCE, ACCOUNTING_VERSION,
        qv_accounting.ACCOUNTING_DEFINITION_VERSION,
        *[payload[name] for name in ACCOUNTING_FIELDS],
        *[qv_accounting._json(prov.get(key)) for key in (
            "revenue_provenance", "cogs_provenance", "direct_gp_provenance", "assets_provenance",
            "assets_tieout_provenance", "parent_se_provenance", "nci_tieout_provenance", "preferred_provenance")],
        qv_accounting._json(payload["bundle_provenance"]),
        qv_accounting._json(payload["diagnostics"]) or "{}",
    )
    connection.execute(qv_accounting._INSERT_SQL, values)


def raw_close(connection, symbol: str, day: str):
    row = connection.execute(
        "SELECT raw_close FROM bars_daily WHERE symbol = ? AND trade_date = ? AND source = ? AND source_version = ?",
        (symbol, day, PRICE_SOURCE, PRICE_VERSION),
    ).fetchone()
    return None if row is None else row["raw_close"]


def accounting_status(connection, formation: dict, record: dict) -> dict:
    cik = formation["selected_cik"]
    f_session = formation["formation_session"]
    year = int(f_session[:4])
    row = qv_accounting.accounting_for_formation(
        connection, cik=cik, fiscal_period_end_year=year - 1, formation_session=f_session,
        filing_source_version=KQ_METADATA_VERSION, accounting_source_version=ACCOUNTING_VERSION,
    )
    selected_acceptance = row["acceptance_datetime"] if row else ""
    for filing in record["filings"]:
        entry = record["accounting"].get(filing["accession"])
        if entry is None or entry["status"] != "SOURCE_INCOMPLETE":
            continue
        if filing["planned_usable_session"] and filing["planned_usable_session"] <= f_session and filing["acceptance_datetime"] > selected_acceptance:
            return {"accounting_status": "ACCOUNTING_SOURCE_INCOMPLETE", "accounting_accession": filing["accession"]}
    if row is None:
        return {"accounting_status": "ACCOUNTING_NO_ANNUAL_FILING", "accounting_accession": None}
    values = dict(row)
    return {
        "accounting_status": "ACCOUNTING_SELECTED",
        "accounting_accession": values["accession"],
        "accounting_form": values["form"],
        "fiscal_period_end": values["fiscal_period_end"],
        "period_crosscheck_status": values["period_crosscheck_status"],
        **{key: values[key] for key in (
            "gross_profit_status", "gross_profit_value", "assets_status", "assets_value",
            "parent_se_status", "preferred_status", "book_equity_status", "book_equity_value")},
        "diagnostics": json.loads(values["diagnostics"] or "{}"),
    }


def accounting_missing_reason(acct: dict) -> str | None:
    if acct["accounting_status"] != "ACCOUNTING_SELECTED":
        return acct["accounting_status"]
    if acct["fiscal_period_end"] is None or acct["period_crosscheck_status"] == "PERIOD_CROSSCHECK_MISMATCH":
        return "PERIOD_FAIL_CLOSE"
    if not fp.q_available(acct):
        if acct["gross_profit_status"] != "RESOLVED":
            return f"GROSS_PROFIT_{acct['gross_profit_status']}"
        if acct["assets_status"] != "RESOLVED":
            return f"ASSETS_{acct['assets_status']}"
        return "ASSETS_NONPOSITIVE"
    if not fp.be_available(acct):
        if acct["book_equity_status"] != "RESOLVED":
            return f"BOOK_EQUITY_{acct['book_equity_status']}:parent={acct['parent_se_status']}:pref={acct['preferred_status']}"
        return "BOOK_EQUITY_NONPOSITIVE"
    return None


def research_me(connection, formation: dict, record: dict, splits: dict, sessions: list[str]) -> dict:
    if formation["security_count"] != 1:
        return {"me_path": None, "me_status": fp.ME_MISSING_COMPLEX, "me_reason": "MULTIPLE_MEMBERSHIP_SECURITIES"}
    member = formation["members"][0]
    f_session = formation["formation_session"]
    year = int(f_session[:4])
    december = fp.december_session(sessions, year)
    window_floor = f"{year - 1:04d}-01-01"
    facts = []
    covers = {}
    for filing in record["filings"]:
        if not filing["planned_usable_session"] or filing["planned_usable_session"] > f_session:
            continue
        if filing["acceptance_eastern_date"] < window_floor:
            continue
        entry = record["accounting"].get(filing["accession"]) or record["quarterly"].get(filing["accession"])
        if entry is None:
            raise SystemExit(f"STOP: share-scope filing was not fetched {formation['selected_cik']} {filing['accession']}")
        if entry["status"] != "FETCHED":
            return {"me_path": None, "me_status": fp.ME_SOURCE_INCOMPLETE, "me_reason": f"SHARE_SCOPE_FILING_INCOMPLETE:{filing['accession']}", "valuation_date": december}
        covers[filing["accession"]] = entry["cover"]
        for fact in entry["share_facts"]:
            facts.append({**fact, "accession": filing["accession"], "form": filing["form"],
                          "acceptance_datetime": filing["acceptance_datetime"],
                          "acceptance_eastern_date": filing["acceptance_eastern_date"],
                          "historical_usable_session": filing["planned_usable_session"]})
    choice = fp.choose_research_shares(facts, formation_session=f_session, december=december)
    base = {"valuation_date": december, "me_tier_path": choice.tier_path}
    if choice.status:
        return {**base, "me_path": None, "me_status": choice.status, "me_reason": choice.reason}
    fact = choice.fact
    cover_problem = fp.cover_check(covers.get(fact["accession"]), member["identity_symbol"])
    share = {"share_accession": fact["accession"], "share_form": fact["form"], "share_instant": fact["instant"],
             "share_value_text": fact["value_text"], "share_tier": fact["tier"], "share_context_id": fact["context_id"],
             "share_instance_file": fact["instance_file"], "share_instance_sha256": fact["instance_sha256"],
             "cover_common_symbols": covers.get(fact["accession"], {}).get("common_symbols")}
    if cover_problem:
        return {**base, **share, "me_path": None, "me_status": fp.ME_MISSING_COMPLEX, "me_reason": cover_problem}
    split_record = splits.get(member["member_symbol"])
    if split_record is None or split_record["status"] != "FETCHED":
        return {**base, **share, "me_path": None, "me_status": fp.ME_SOURCE_INCOMPLETE, "me_reason": "VENDOR_SPLITS_UNAVAILABLE"}
    boundary = fp.split_boundary([event[0] for event in split_record["events"]], fact_instant=fact["instant"],
                                 acceptance_eastern_date=fact["acceptance_eastern_date"], december=december)
    if boundary:
        side = "BETWEEN_INSTANT_AND_D" if boundary <= december else "BETWEEN_D_AND_ACCEPTANCE"
        return {**base, **share, "me_path": None, "me_status": fp.ME_MISSING_SPLIT_BOUNDARY, "me_reason": f"{side}:{boundary}"}
    close = raw_close(connection, member["member_symbol"], december)
    if close is None:
        return {**base, **share, "me_path": None, "me_status": fp.ME_MISSING_PRICE, "me_reason": "NO_RAW_CLOSE_ON_D"}
    me = fp.market_equity(fact["value_text"], close)
    return {**base, **share, "me_path": fp.RESEARCH_SINGLE_CLASS_ME, "me_status": fp.RESEARCH_SINGLE_CLASS_ME,
            "me_reason": None, "price_symbol": member["member_symbol"], "raw_close_text": str(close),
            "price_source_version": PRICE_VERSION, "me_value": format(me, "f")}


def write_jsonl(path: Path, rows: list[dict]) -> None:
    with open(path, "w") as handle:
        for row in rows:
            handle.write(json.dumps(row, sort_keys=True, ensure_ascii=False) + "\n")


def ratio(numerator: int, denominator: int) -> float | None:
    return round(numerator / denominator, 6) if denominator else None


def run_finalize(partial: bool = False) -> None:
    verify_pins()
    rows, formations = load_population()
    by_cik = collections.defaultdict(list)
    for formation in formations:
        by_cik[formation["selected_cik"]].append(formation)
    records = {}
    for cik in sorted(by_cik):
        path = OUT / "cik" / f"{cik}.json.gz"
        if not path.exists():
            if partial:
                continue
            raise SystemExit(f"fetch incomplete: {cik}")
        records[cik] = json.loads(gzip.decompress(path.read_bytes()))
    if partial:
        formations = [f for f in formations if f["selected_cik"] in records]
        rows = [r for r in rows if r["selected_cik"] in records]
    splits = {}
    for path in (OUT / "splits").glob("*.json"):
        item = json.loads(path.read_text())
        splits[item["symbol"]] = item
    sessions = spy_sessions()

    connection = research_db()
    with connection:
        for cik, record in records.items():
            for filing in record["filings"]:
                insert_filing(connection, cik, filing, KQ_METADATA_VERSION, None)
                sic = record["sic"].get(filing["accession"])
                if sic and sic["status"] in ("EXACT", "MISSING", "AMBIGUOUS"):
                    insert_filing(connection, cik, filing, SIC_VERSION, sic)
            for accession, entry in record["accounting"].items():
                if entry["status"] == "FETCHED":
                    insert_accounting(connection, cik, accession, entry["result"])

    production_me_rows = connection.execute("SELECT COUNT(*) FROM prod.qv_issuer_market_equity").fetchone()[0]
    output = []
    for formation in formations:
        cik = formation["selected_cik"]
        record = records[cik]
        f_session = formation["formation_session"]
        planned = connection.execute(
            "SELECT accession FROM qv_sec_filings WHERE cik = ? AND source_version = ? AND historical_usable_session <= ?"
            " ORDER BY acceptance_datetime DESC, accession DESC LIMIT 1", (cik, KQ_METADATA_VERSION, f_session)).fetchone()
        planned_accession = planned["accession"] if planned else None
        sic_row = historical_sic(connection, cik, f_session, SIC_VERSION)
        if planned_accession is None:
            sic_status, filing_sic, sic_accession = "NO_USABLE_KQ_FILING", None, None
        elif sic_row is None or sic_row.accession != planned_accession:
            sic_status, filing_sic, sic_accession = "SIC_SOURCE_INCOMPLETE", None, planned_accession
        else:
            sic_status, filing_sic, sic_accession = sic_row.status, sic_row.filing_sic, sic_row.accession
        group = fp.sic_group(filing_sic) if sic_status == "EXACT" else "CLASSIFICATION_MISSING"
        identity_path = "REUSED_VENDOR_SERIES" if any(m["symbol_bridge_kind"] == "REUSED_VENDOR_SERIES" for m in formation["members"]) else "DIRECT"
        item = {
            "formation_session": f_session, "formation_year": int(f_session[:4]), "selected_cik": cik,
            "research_identity": "RESEARCH_SELECTED_CIK",
            "selected_cik_provenance": sorted({m["selected_cik_provenance"] for m in formation["members"]}),
            "members": formation["members"], "security_count": formation["security_count"],
            "identity_path": identity_path,
            "sic_accession": sic_accession, "sic_status": sic_status, "filing_sic": filing_sic,
            "sic_group": group, "sic_division": sic_division(filing_sic) if group != "CLASSIFICATION_MISSING" else "CLASSIFICATION_MISSING",
            "strict_production_me": False,
        }
        if group == "FINANCIAL":
            item.update({"accounting_status": "NOT_EVALUATED_FINANCIAL", "me_status": "NOT_EVALUATED_FINANCIAL",
                         "q_available": False, "v_available": False, "joint_qv_available": False})
            output.append(item)
            continue
        acct = accounting_status(connection, formation, record)
        me = research_me(connection, formation, record, splits, sessions)
        q = fp.q_available(acct)
        be = fp.be_available(acct)
        me_ok = me["me_status"] in (fp.RESEARCH_SINGLE_CLASS_ME, fp.STRICT_PRODUCTION_ME)
        item.update(acct)
        item.update(me)
        item.update({
            "gpa": fp.gpa_text(acct), "gp_available": acct.get("gross_profit_status") == "RESOLVED",
            "assets_available": acct.get("assets_status") == "RESOLVED" and fp.q_available(acct) or (acct.get("assets_status") == "RESOLVED" and False),
            "be_available": be, "me_available": me_ok,
            "q_available": q, "v_available": be and me_ok, "joint_qv_available": q and be and me_ok,
            "accounting_missing_reason": accounting_missing_reason(acct) if not (q and be) else None,
        })
        item["assets_available"] = acct.get("assets_status") == "RESOLVED"
        output.append(item)

    write_outputs(rows, output, production_me_rows, OUT / "pilot" if partial else OUT)


def write_outputs(rows: list[dict], output: list[dict], production_me_rows: int, target: Path) -> None:
    target.mkdir(parents=True, exist_ok=True)
    write_jsonl(target / "membership_identity.jsonl", rows)
    write_jsonl(target / "issuer_formations.jsonl", output)
    acct_keys = ("formation_session", "selected_cik", "sic_group", "accounting_status", "accounting_accession",
                 "accounting_form", "fiscal_period_end", "period_crosscheck_status", "gross_profit_status",
                 "gross_profit_value", "assets_status", "assets_value", "gpa", "parent_se_status", "preferred_status",
                 "book_equity_status", "book_equity_value", "accounting_missing_reason", "diagnostics")
    me_keys = ("formation_session", "selected_cik", "sic_group", "security_count", "identity_path", "valuation_date",
               "me_path", "me_status", "me_reason", "me_tier_path", "share_accession", "share_form", "share_instant",
               "share_value_text", "share_tier", "share_context_id", "share_instance_file", "share_instance_sha256",
               "cover_common_symbols", "price_symbol", "raw_close_text", "price_source_version", "me_value")
    write_jsonl(target / "accounting_coverage.jsonl", [{k: o.get(k) for k in acct_keys} for o in output])
    write_jsonl(target / "me_coverage.jsonl", [{k: o.get(k) for k in me_keys} for o in output])

    nonfin = [o for o in output if o["sic_group"] == "NONFINANCIAL"]
    evaluable = [o for o in output if o["sic_group"] != "FINANCIAL"]

    def tally(items: list[dict]) -> dict:
        n = len(items)
        counts = {
            "issuer_formations": n,
            "gp_available": sum(1 for o in items if o.get("gp_available")),
            "assets_available": sum(1 for o in items if o.get("assets_available")),
            "gpa_available": sum(1 for o in items if o["q_available"]),
            "be_available": sum(1 for o in items if o.get("be_available")),
            "me_available": sum(1 for o in items if o.get("me_available")),
            "joint_qv_available": sum(1 for o in items if o["joint_qv_available"]),
        }
        counts["joint_qv_coverage"] = ratio(counts["joint_qv_available"], n)
        counts["me_coverage"] = ratio(counts["me_available"], n)
        return counts

    by_year = collections.defaultdict(list)
    for o in nonfin:
        by_year[o["formation_year"]].append(o)
    annual = {year: tally(items) for year, items in sorted(by_year.items())}
    joint_by_year = {year: t["joint_qv_coverage"] for year, t in annual.items()}
    start = fp.coverage_start(joint_by_year)
    after = [o for o in nonfin if start is not None and o["formation_year"] >= start]
    after_tally = tally(after) if start is not None else None
    min_annual = min(joint_by_year[y] for y in joint_by_year if y >= start) if start is not None else None
    verdict = fp.preflight_verdict(
        start=start,
        aggregate_joint=after_tally["joint_qv_coverage"] if after_tally else None,
        min_annual=min_annual,
        me_coverage=after_tally["me_coverage"] if after_tally else None,
    )

    member_count = len(rows)
    with_cik = sum(1 for r in rows if r["selected_cik"])
    classified = sum(1 for o in output if o["sic_status"] == "EXACT")
    cumulative = []
    stage = nonfin
    for label, predicate in (
        ("gp_available", lambda o: o.get("gp_available")),
        ("assets_available", lambda o: o.get("assets_available")),
        ("gpa_available", lambda o: o["q_available"]),
        ("be_available", lambda o: o.get("be_available")),
        ("me_available", lambda o: o.get("me_available")),
    ):
        stage = [o for o in stage if predicate(o)]
        cumulative.append({"stage": label, "count": len(stage), "pct_of_nonfinancial": ratio(len(stage), len(nonfin))})
    attrition = {
        "raw_formation_security_rows": member_count,
        "rows_with_selected_cik": with_cik,
        "rows_identity_missing": member_count - with_cik,
        "unique_research_issuer_formations": len(output),
        "historical_sic_classified": classified,
        "classification_missing": sum(1 for o in output if o["sic_group"] == "CLASSIFICATION_MISSING"),
        "financial": sum(1 for o in output if o["sic_group"] == "FINANCIAL"),
        "nonfinancial_denominator": len(nonfin),
        "independent_availability_nonfinancial": tally(nonfin),
        "cumulative_chain_nonfinancial": cumulative,
        "nonfinancial_plus_classification_missing": tally(evaluable),
        "strict_production_me": 0,
        "strict_production_me_note": f"production qv_issuer_market_equity rows in user DB = {production_me_rows}; no production ME is materialized",
        "research_single_class_me": sum(1 for o in nonfin if o.get("me_status") == fp.RESEARCH_SINGLE_CLASS_ME),
        "coverage_start": start,
        "after_start_nonfinancial": after_tally,
        "min_annual_joint_after_start": min_annual,
        "verdict": verdict,
    }

    def breakdown(key_fn, items):
        groups = collections.defaultdict(list)
        for o in items:
            groups[key_fn(o)].append(o)
        return {str(k): tally(v) for k, v in sorted(groups.items(), key=lambda kv: str(kv[0]))}

    by_missing = {
        "accounting_missing_reason_nonfinancial": dict(collections.Counter(o.get("accounting_missing_reason") or "AVAILABLE" for o in nonfin).most_common()),
        "me_status_nonfinancial": dict(collections.Counter(o.get("me_status") for o in nonfin).most_common()),
        "me_reason_nonfinancial": dict(collections.Counter(f"{o.get('me_status')}:{(o.get('me_reason') or '').split(':')[0]}" for o in nonfin).most_common()),
        "sic_status_all": dict(collections.Counter(o["sic_status"] for o in output).most_common()),
        "by_sic_division": breakdown(lambda o: o["sic_division"], nonfin),
        "by_identity_path": breakdown(lambda o: o["identity_path"], nonfin),
        "by_security_multiplicity": breakdown(lambda o: "SINGLE" if o["security_count"] == 1 else "MULTI", nonfin),
        "by_selected_cik_provenance": breakdown(lambda o: "+".join(o["selected_cik_provenance"]), nonfin),
        "by_me_path": dict(collections.Counter(o.get("me_path") or "NONE" for o in nonfin)),
    }
    coverage_by_year = {
        "nonfinancial": {str(y): t for y, t in annual.items()},
        "nonfinancial_plus_classification_missing": {str(y): t for y, t in breakdown(lambda o: o["formation_year"], evaluable).items()},
        "classification_by_year": {str(y): dict(collections.Counter(o["sic_group"] for o in output if o["formation_year"] == y)) for y in sorted({o["formation_year"] for o in output})},
        "identity_missing_rows_by_year": dict(sorted(collections.Counter(r["formation_session"][:4] for r in rows if not r["selected_cik"]).items())),
    }
    (target / "attrition.json").write_text(json.dumps(attrition, indent=1, sort_keys=True))
    (target / "coverage_by_year.json").write_text(json.dumps(coverage_by_year, indent=1, sort_keys=True))
    (target / "coverage_by_missing_reason.json").write_text(json.dumps(by_missing, indent=1, sort_keys=True))

    artifacts = {}
    for name in ("membership_identity.jsonl", "issuer_formations.jsonl", "accounting_coverage.jsonl",
                 "me_coverage.jsonl", "attrition.json", "coverage_by_year.json", "coverage_by_missing_reason.json"):
        path = target / name
        artifacts[name] = {"sha256": sha256_file(path), "rows": sum(1 for _ in open(path)) if name.endswith(".jsonl") else None}
    stats = [json.loads(line) for line in open(OUT / "fetch_stats.jsonl")] if (OUT / "fetch_stats.jsonl").exists() else []
    network = collections.Counter()
    for stat in stats:
        network.update(stat["counters"])
    run = {
        "probe": "qv-phase0-research-fastpath",
        "fastpath_version": fp.FASTPATH_VERSION,
        "pins": {path.name: digest for path, digest in PINS.items()},
        "sources": {"calendar": f"{CALENDAR_SOURCE}/{CALENDAR_VERSION}", "price": f"{PRICE_SOURCE}/{PRICE_VERSION}",
                    "accounting_definition": qv_accounting.ACCOUNTING_DEFINITION_VERSION,
                    "filings_version": KQ_METADATA_VERSION, "sic_version": SIC_VERSION, "accounting_version": ACCOUNTING_VERSION},
        "network": {"counters": dict(network), "wall_seconds": round(sum(s["wall_seconds"] for s in stats), 1), "passes": len(stats)},
        "artifacts": artifacts,
        "returns_calculated": False,
        "production_identity_changed": False,
    }
    (target / "run.json").write_text(json.dumps(run, indent=1, sort_keys=True))
    print(json.dumps({"attrition": attrition, "artifacts": artifacts}, indent=1))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["pins", "fetch", "splits", "finalize"])
    parser.add_argument("--limit-ciks", type=int, default=None)
    parser.add_argument("--workers", type=int, default=6)
    parser.add_argument("--partial", action="store_true")
    args = parser.parse_args()
    if args.command == "pins":
        verify_pins()
    elif args.command == "fetch":
        run_fetch(args.limit_ciks, args.workers)
    elif args.command == "splits":
        run_splits()
    else:
        run_finalize(partial=args.partial)


if __name__ == "__main__":
    main()
