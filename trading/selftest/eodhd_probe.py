"""EODHD 데이터 벤더 capability probe.

2단계에서 한투 모의 API를 `selftest/capability.py`로 찔러봤던 것과 같은 목적이다.
**돈을 쓰기 전에** 우리가 필요한 필드가 실제로 오는지 확인한다.

확인하려는 것은 세 가지다.

1. **Nasdaq-100 당시 구성원.** 이게 없으면 유니버스를 S&P 500만으로 줄이는 전략 변경이
   필요하다. 유료 플랜 선택이 여기서 갈린다.
2. **상장폐지 종목의 가격.** 생존편향을 없애는 데 필수다.
3. **응답이 우리 `load_bars_csv` 열 계약에 맞는가.** `close`와 `adj_close`의 단일 배율
   가정이 성립하는지 본다.

**무료 티어는 데이터를 최근 1년으로 자른다.** 날짜 범위를 무시하고 최근 1년만 주면서
응답에 `warning` 필드를 넣는다. 그래서 1년보다 오래전에 폐지된 종목은 빈 배열이 오고,
이것은 상장폐지 데이터가 없다는 뜻이 **아니다**. 과거 구성원은 402/403으로 막힌다.

무료 티어는 하루 20 호출이므로 호출 수를 세고 아낀다. 응답 원문은 스크래치패드에
저장해 같은 질문을 다시 호출하지 않는다.

키는 `trading/backtest-credentials.env`(gitignore)에서 읽고 화면에는 절대 찍지 않는다.
"""

from __future__ import annotations

import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

TRADING_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TRADING_ROOT))

from paper.config import decode_env_bytes, parse_env_file  # noqa: E402

BASE_URL = "https://eodhd.com/api"
KEY_NAMES = ("EODHD_API_KEY", "EODHD_TOKEN")
CREDENTIAL_FILENAMES = ("backtest-credentials.env", "backtest-credentials.txt")
FREE_TIER_DAILY_CALLS = 20

# 폐지된 옛 S&P 500 구성원 후보. 하나만 걸려도 상장폐지 가격 보유가 확인된다.
DELISTED_CANDIDATES = ("LEHMQ.US", "ENRNQ.US", "ABKFQ.US", "WAMUQ.US")


class ProbeError(Exception):
    pass


def load_key() -> str:
    for path in (TRADING_ROOT / name for name in CREDENTIAL_FILENAMES):
        try:
            values = parse_env_file(decode_env_bytes(path.read_bytes()))
        except FileNotFoundError:
            continue
        for name in KEY_NAMES:
            if values.get(name):
                return values[name].strip()
    import os

    for name in KEY_NAMES:
        if os.environ.get(name):
            return os.environ[name].strip()
    raise ProbeError(
        f"API 키가 없습니다. {TRADING_ROOT / CREDENTIAL_FILENAMES[0]}에"
        f" {KEY_NAMES[0]}=... 형태로 넣어주세요."
    )


class Probe:
    def __init__(self, key: str, scratch: Path) -> None:
        self.key = key
        self.scratch = scratch
        self.scratch.mkdir(parents=True, exist_ok=True)
        self.calls = 0

    def get(self, path: str, label: str, **params) -> tuple[int, object]:
        """API를 한 번 호출한다. 상태코드와 파싱된 본문을 돌려준다."""
        params.setdefault("fmt", "json")
        params["api_token"] = self.key
        query = "&".join(f"{key}={value}" for key, value in params.items())
        url = f"{BASE_URL}/{path}?{query}"
        self.calls += 1
        try:
            with urllib.request.urlopen(url, timeout=60) as response:
                status, raw = response.status, response.read()
        except urllib.error.HTTPError as error:
            status, raw = error.code, error.read()
        except urllib.error.URLError as error:
            return 0, f"연결 실패: {error.reason}"

        # 원문을 남겨 같은 질문을 다시 호출하지 않는다. 키는 파일명에 넣지 않는다.
        (self.scratch / f"{label}.json").write_bytes(raw)
        try:
            return status, json.loads(raw)
        except json.JSONDecodeError:
            return status, raw.decode("utf-8", errors="replace")[:400]


def summarise(value: object, limit: int = 300) -> str:
    text = json.dumps(value, ensure_ascii=False)[:limit] if not isinstance(value, str) else value
    return text.replace("\n", " ")


def main() -> int:
    key = load_key()
    scratch = Path(
        "/private/tmp/claude-501/-Users-chanyongs21-Desktop-galpi"
    ) / "eodhd-probe"
    probe = Probe(key, scratch)
    print(f"키 확인: {key[:4]}...({len(key)}자), 원문 저장 위치 {scratch}")
    print(f"무료 티어 상한 하루 {FREE_TIER_DAILY_CALLS}회\n")

    print("[1] 우리 로더 열 계약과 맞는가 (AAPL.US 일봉)")
    status, body = probe.get(
        "eod/AAPL.US", "eod_aapl", **{"from": "2015-01-02", "to": "2015-01-09", "period": "d"}
    )
    print(f"    HTTP {status}")
    if isinstance(body, list) and body:
        row = body[0]
        print(f"    필드: {sorted(row)}")
        needed = {"date", "open", "high", "low", "close", "adjusted_close", "volume"}
        missing = needed - set(row)
        print(f"    누락: {missing or '없음'}")
        if not missing:
            factor = row["adjusted_close"] / row["close"]
            print(f"    단일 배율 adj/close = {factor:.6f} (분할·배당 조정 계수)")
    else:
        print(f"    본문: {summarise(body)}")

    print("\n[2] 상장폐지 종목 가격이 오는가")
    for symbol in DELISTED_CANDIDATES:
        status, body = probe.get(
            f"eod/{symbol}", f"eod_{symbol.replace('.', '_')}", period="d"
        )
        count = len(body) if isinstance(body, list) else 0
        print(f"    {symbol:10s} HTTP {status}  바 {count}개", end="")
        if count:
            print(f"  {body[0]['date']} ~ {body[-1]['date']}")
            break
        print(f"  {summarise(body, 120)}")

    print("\n[3] INDX 거래소에서 Nasdaq-100 티커 찾기")
    status, body = probe.get("exchange-symbol-list/INDX", "indx_symbols")
    print(f"    HTTP {status}")
    if isinstance(body, list):
        print(f"    지수 {len(body)}개")
        hits = [
            row
            for row in body
            if isinstance(row, dict)
            and any(
                token in str(row.get("Name", "")).upper() or token in str(row.get("Code", "")).upper()
                for token in ("NASDAQ 100", "NASDAQ-100", "NDX", "GSPC", "S&P 500")
            )
        ]
        for row in hits[:12]:
            print(f"      {row.get('Code'):<12} {row.get('Name')}")
        if not hits:
            print("      후보 없음")
    else:
        print(f"    본문: {summarise(body)}")

    print("\n[4] 무료 티어의 실제 데이터 창 (날짜 범위 없이)")
    status, body = probe.get("eod/AAPL.US", "eod_aapl_full", period="d")
    if isinstance(body, list) and body:
        print(f"    HTTP {status}  바 {len(body)}개  {body[0]['date']} ~ {body[-1]['date']}")
        warning = body[0].get("warning")
        if warning:
            print(f"    경고: {warning}")
    else:
        print(f"    HTTP {status}  {summarise(body, 160)}")

    print("\n[5] 상장폐지 종목 목록과 7.2 증권 종류 필터용 필드")
    for label, params in (("delisted_us", {"delisted": "1"}), ("live_us", {})):
        status, body = probe.get("exchange-symbol-list/US", label, **params)
        if not isinstance(body, list):
            print(f"    {label:12s} HTTP {status}  {summarise(body, 160)}")
            continue
        kinds: dict[str, int] = {}
        for row in body:
            kind = str(row.get("Type"))
            kinds[kind] = kinds.get(kind, 0) + 1
        major = sum(
            1
            for row in body
            if row.get("Type") == "Common Stock"
            and row.get("Exchange") in ("NASDAQ", "NYSE", "NYSE MKT", "BATS")
        )
        top = sorted(kinds.items(), key=lambda item: -item[1])[:5]
        print(f"    {label:12s} HTTP {status}  {len(body)}개  필드 {sorted(body[0])}")
        print(f"      종류 {top}")
        print(f"      주요 거래소 보통주 {major}개")

    print("\n[6] 지수 구성원과 과거 구성원 (Fundamentals 플랜 필요)")
    for ticker in ("GSPC.INDX", "NDX.INDX"):
        status, body = probe.get(
            f"fundamentals/{ticker}", f"fundamentals_{ticker.replace('.', '_')}"
        )
        print(f"    {ticker:12s} HTTP {status}", end="")
        if isinstance(body, dict):
            sections = sorted(body)
            print(f"  섹션: {sections}")
            historical = body.get("HistoricalTickerComponents") or {}
            components = body.get("Components") or {}
            print(f"      현재 구성원 {len(components)}개, 과거 구성원 {len(historical)}개")
            if historical:
                sample = next(iter(historical.values()))
                print(f"      과거 구성원 필드: {sorted(sample)}")
        else:
            print(f"  본문: {summarise(body, 160)}")

    print(f"\n총 {probe.calls}회 호출했습니다.")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except ProbeError as error:
        print(f"probe 중단: {error}")
        sys.exit(1)
