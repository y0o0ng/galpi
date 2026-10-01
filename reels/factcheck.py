"""대본 사실 확인 표의 원문 인용이 그 행에 적힌 출처 원문에 글자 그대로 있는지 대조한다.

usage: python reels/factcheck.py <script.md> [URL=로컬텍스트파일 ...]
내려받기가 막힌 출처(nrc.gov 403 등)는 URL=파일 로 미리 받아 둔 원문 텍스트를 넘긴다.
하나라도 못 찾으면 종료 코드 1.
"""
import html
import io
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


def check(md, local):
    facts = md[md.index("사실 확인 목록"):]
    # 약칭 목록: "**[GD]** ... https://..." 또는 "**[GD]** ... https://... · **[PZ]** ..."
    alias = {}
    for name, rest in re.findall(r"\*\*\[([^\]]+)\]\*\*([^*]*)", facts):
        found = urls_in(rest)
        if found:
            alias[name] = found[0]
    rows = [l for l in facts.splitlines() if re.match(r"\|\s*\w*\d+\s*\|", l)]
    corpus, bad = {}, 0
    for row in rows:
        cells = row.split("|")
        src_cell, quote_cell = cells[-3], cells[-2]
        sources = set(urls_in(src_cell)) | {alias[a] for a in re.findall(r"\[([^\]]+)\]", src_cell) if a in alias}
        for u in sources - corpus.keys():
            try:
                corpus[u] = text_of(open(local[u], errors="replace").read() if u in local else fetch(u))
            except Exception as e:
                corpus[u] = ""
                print("FETCH-FAIL", u, e)
        for q in re.findall(r'"([^"]{25,})"', quote_cell):
            ok = any(norm(q) in corpus[u] for u in sources)
            bad += not ok
            print(("OK   " if ok else "MISS ") + cells[1].strip(), q[:80], "" if sources else "(출처 없음)")
    print(f"{len(rows)} rows, {bad} missing")
    return bad


if __name__ == "__main__":
    local = dict(a.split("=", 1) for a in sys.argv[2:])
    sys.exit(1 if check(open(sys.argv[1]).read(), local) else 0)
