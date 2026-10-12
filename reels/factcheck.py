"""대본 사실 확인 표의 원문 인용이 그 행에 적힌 출처 원문에 글자 그대로 있는지 대조한다.

usage: python reels/factcheck.py <script.md> [--json] [URL=로컬텍스트파일 ...]
내려받기가 막힌 출처(nrc.gov 403 등)는 URL=파일 로 미리 받아 둔 원문 텍스트를 넘긴다.
하나라도 못 찾으면 종료 코드 1.
--json: 인용마다 {row, claim, source, url, quote, found} 배열을 stdout으로, 기존 텍스트 줄은 stderr로 보낸다.
인용이 없는 행(직접 확인 등)은 quote "", found null로 한 줄 나온다.
--report: 릴스 서버용 상세 결과(version, rows, claims, sources, fetch_errors)를 stdout으로 보낸다.
보고서에서 접속·원문 읽기 실패는 source_unavailable이며, 그 출처가 남은 인용은 mismatch로 확정하지 않는다.
"""
import html
import io
import json
import re
import sys
import urllib.request

import pypdf

LIGATURES = {"ﬁ": "fi", "ﬂ": "fl", "ﬀ": "ff", "ﬃ": "ffi", "ﬄ": "ffl"}
URL_RE = r"https?://[^\s)|>`]+"


def norm(s):
    for a, b in {"’": "'", "‘": "'", "“": '"', "”": '"', "…": "...", **LIGATURES}.items():
        s = s.replace(a, b)
    return re.sub(r"\s+", " ", s).strip().lower()


def text_of(raw):
    # 줄 끝 하이픈은 단어 분리(제거)일 수도 진짜 하이픈(steam-water)일 수도 있어 두 경우를 모두 둔다
    return norm(re.sub(r"-\s*\n\s*", "", raw)) + " || " + norm(re.sub(r"-\s*\n\s*", "-", raw))


def fetch(url):
    if "arxiv.org/abs/" in url:
        url = url.replace("/abs/", "/pdf/")
    data = urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"}), timeout=60).read()
    if data[:4] == b"%PDF":
        return " ".join(p.extract_text() or "" for p in pypdf.PdfReader(io.BytesIO(data)).pages)
    return html.unescape(re.sub(r"<[^>]+>", " ", data.decode("utf-8", "replace")))


def urls_in(s):
    return [u.rstrip(".,;:") for u in re.findall(URL_RE, s)]


def check(md, local, entries=None, out=sys.stdout, report=None):
    facts = md[md.index("사실 확인 목록"):]
    if report is not None:
        heading = re.search(r"(?m)^#{1,6}\s+[^\n]*사실 확인 목록[^\n]*(?:\n|$)", md)
        if not heading:
            raise ValueError("사실 확인 목록 제목이 없습니다.")
        facts = re.split(r"(?m)^#{1,6}\s+", md[heading.end():], maxsplit=1)[0]
    # 약칭 목록: "**[GD]** ... https://..." 또는 "**[GD]** ... https://... · **[PZ]** ..."
    alias = {}
    for name, rest in re.findall(r"\*\*\[([^\]]+)\]\*\*([^*]*)", facts):
        found = urls_in(rest)
        if found:
            alias[name] = found[0]
    rows = [l for l in facts.splitlines() if re.match(r"\|\s*\w*\d+\s*\|", l)]
    corpus, errors, bad = {}, {}, 0
    if report is not None:
        if not rows:
            raise ValueError("사실 확인 목록에 검사할 행이 없습니다.")
        report.update(version=1, rows=len(rows), claims=[], fetch_errors=[], sources=[])
    for row in rows:
        cells = row.split("|")
        src_cell, quote_cell = cells[-3], cells[-2]
        sources = set(urls_in(src_cell)) | {alias[a] for a in re.findall(r"\[([^\]]+)\]", src_cell) if a in alias}
        for u in sources - corpus.keys():
            try:
                corpus[u] = text_of(open(local[u], errors="replace").read() if u in local else fetch(u))
            except Exception as e:
                corpus[u] = ""
                errors[u] = str(e)
                print("FETCH-FAIL", u, e, file=out)
        quotes = re.findall(r'"([^"]{25,})"', quote_cell)
        if entries is not None and not quotes:
            entries.append({"row": cells[1].strip(), "claim": cells[2].strip(), "source": src_cell.strip(),
                            "url": next(iter(sorted(sources)), None), "quote": "", "found": None})
        if report is not None and not quotes:
            report["claims"].append({"row": cells[1].strip(), "claim": cells[2].strip(),
                "source": src_cell.strip(), "url": next(iter(sorted(sources)), None), "quote": "",
                "found": None, "status": "missing_quote", "sources": sorted(sources)})
        for q in quotes:
            hit = [u for u in sorted(sources) if norm(q) in corpus[u]]
            ok = bool(hit)
            bad += not ok
            print(("OK   " if ok else "MISS ") + cells[1].strip(), q[:80], "" if sources else "(출처 없음)", file=out)
            if entries is not None:
                entries.append({"row": cells[1].strip(), "claim": cells[2].strip(), "source": src_cell.strip(),
                                "url": (hit or sorted(sources) or [None])[0], "quote": q, "found": ok})
            if report is not None:
                unavailable = sorted(sources & errors.keys())
                report["claims"].append({"row": cells[1].strip(), "claim": cells[2].strip(),
                    "source": src_cell.strip(), "url": (hit or sorted(sources) or [None])[0], "quote": q,
                    "found": ok, "sources": sorted(sources),
                    "status": "matched" if ok else "source_unavailable" if unavailable else "mismatch"})
    if report is not None:
        report["sources"] = sorted(corpus)
        report["fetch_errors"] = [{"url": u, "reason": errors[u]} for u in sorted(errors)]
    print(f"{len(rows)} rows, {bad} missing", file=out)
    return bad


if __name__ == "__main__":
    as_json = "--json" in sys.argv
    as_report = "--report" in sys.argv
    local = dict(a.split("=", 1) for a in sys.argv[2:] if a not in ("--json", "--report"))
    entries = [] if as_json else None
    report = {} if as_report else None
    bad = check(open(sys.argv[1]).read(), local, entries, sys.stderr if as_json or as_report else sys.stdout, report)
    if as_report:
        print(json.dumps(report, ensure_ascii=False))
    elif as_json:
        print(json.dumps(entries, ensure_ascii=False))
    sys.exit(1 if bad else 0)
