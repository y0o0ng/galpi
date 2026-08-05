"""2단계: KIS Capability Matrix self-test.

설계 10.0이 요구하는 대로, 실제로 쓸 해외주식 API가 모의 환경에서 각각 되는지
찔러보고 `kis_capability_matrix`에 남긴다. 결과는 백테스터 체결 모델의 입력이다.

주문 계열은 `--with-orders`를 줄 때만 돈다. 조회만으로 확인 가능한 것을 먼저
끝내고, 계좌에 흔적을 남기는 호출은 명시적으로 켜게 한다.

TR ID는 한국투자증권 공식 저장소 examples_llm/overseas_stock 에서 확인한 값이다.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from dataclasses import dataclass
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from paper import db  # noqa: E402
from paper.config import load_paper_config  # noqa: E402
from paper.kis_client import KisApiError, KisPaperClient, KisResponse  # noqa: E402

# 미국 거래소 코드. 조회는 NAS/NYS, 주문은 NASD/NYSE를 쓴다.
QUOTE_EXCHANGE = "NAS"
ORDER_EXCHANGE = "NASD"
PROBE_SYMBOL = "AAPL"


@dataclass
class Probe:
    api_name: str
    tr_id: str
    supported: str
    detail: str


def _verdict(response: KisResponse) -> tuple[str, str]:
    """rt_cd와 HTTP 상태로 지원 여부를 가른다."""
    detail = f"http={response.status} rt_cd={response.rt_cd or '-'} msg_cd={response.msg_cd or '-'} msg={response.msg[:120]}"
    if response.ok:
        return "supported", detail
    # 실측: 모의가 지원하지 않는 TR은 EGW02006 "모의투자 TR 이 아닙니다"로 온다.
    if response.msg_cd == "EGW02006":
        return "unsupported", detail
    text = f"{response.msg} {response.msg_cd}"
    if "모의" in text and ("미지원" in text or "지원하지" in text):
        return "unsupported", detail
    return "error", detail


def probe_quote(client: KisPaperClient) -> Probe:
    response = client.get(
        "/uapi/overseas-price/v1/quotations/price",
        "HHDFS00000300",
        {"AUTH": "", "EXCD": QUOTE_EXCHANGE, "SYMB": PROBE_SYMBOL},
    )
    supported, detail = _verdict(response)
    last = str(response.body.get("output", {}).get("last", "")) if isinstance(response.body.get("output"), dict) else ""
    if last:
        detail += f" last={last}"
    return Probe("overseas_price_quote", "HHDFS00000300", supported, detail)


def probe_balance(client: KisPaperClient) -> Probe:
    response = client.get(
        "/uapi/overseas-stock/v1/trading/inquire-balance",
        "VTTS3012R",
        {
            **client.account_params,
            "OVRS_EXCG_CD": ORDER_EXCHANGE,
            "TR_CRCY_CD": "USD",
            "CTX_AREA_FK200": "",
            "CTX_AREA_NK200": "",
        },
    )
    supported, detail = _verdict(response)
    return Probe("overseas_inquire_balance", "VTTS3012R", supported, detail)


def probe_psamount(client: KisPaperClient) -> Probe:
    response = client.get(
        "/uapi/overseas-stock/v1/trading/inquire-psamount",
        "VTTS3007R",
        {
            **client.account_params,
            "OVRS_EXCG_CD": ORDER_EXCHANGE,
            "OVRS_ORD_UNPR": "1",
            "ITEM_CD": PROBE_SYMBOL,
        },
    )
    supported, detail = _verdict(response)
    return Probe("overseas_inquire_psamount", "VTTS3007R", supported, detail)


def probe_ccnl(client: KisPaperClient) -> Probe:
    today = time.strftime("%Y%m%d")
    response = client.get(
        "/uapi/overseas-stock/v1/trading/inquire-ccnl",
        "VTTS3035R",
        {
            **client.account_params,
            "PDNO": "%",
            "ORD_STRT_DT": today,
            "ORD_END_DT": today,
            "SLL_BUY_DVSN": "00",
            "CCLD_NCCS_DVSN": "00",
            "OVRS_EXCG_CD": "%",
            "SORT_SQN": "DS",
            "ORD_DT": "",
            "ORD_GNO_BRNO": "",
            "ODNO": "",
            "CTX_AREA_FK200": "",
            "CTX_AREA_NK200": "",
        },
    )
    supported, detail = _verdict(response)
    return Probe("overseas_inquire_ccnl", "VTTS3035R", supported, detail)


def probe_nccs(client: KisPaperClient) -> Probe:
    """공식 예제에 모의 전용 TR이 없다. 실전 TR이 모의에서 도는지 확인한다."""
    response = client.get(
        "/uapi/overseas-stock/v1/trading/inquire-nccs",
        "TTTS3018R",
        {
            **client.account_params,
            "OVRS_EXCG_CD": ORDER_EXCHANGE,
            "SORT_SQN": "DS",
            "CTX_AREA_FK200": "",
            "CTX_AREA_NK200": "",
        },
    )
    supported, detail = _verdict(response)
    return Probe("overseas_inquire_nccs", "TTTS3018R", supported, detail)


def probe_order_cycle(client: KisPaperClient, limit_price: str) -> list[Probe]:
    """체결되지 않을 낮은 지정가로 매수 → 정정 → 취소를 돈다.

    체결을 노리지 않는다. 주문 수명주기 API가 모의에서 도는지만 본다.
    """
    probes: list[Probe] = []
    revise_price = f"{float(limit_price) + 0.10:.2f}"
    buy = client.post(
        "/uapi/overseas-stock/v1/trading/order",
        "VTTT1002U",
        {
            **client.account_params,
            "OVRS_EXCG_CD": ORDER_EXCHANGE,
            "PDNO": PROBE_SYMBOL,
            "ORD_QTY": "1",
            "OVRS_ORD_UNPR": limit_price,
            "ORD_SVR_DVSN_CD": "0",
            "ORD_DVSN": "00",
        },
    )
    supported, detail = _verdict(buy)
    probes.append(Probe("overseas_order_buy", "VTTT1002U", supported, detail))
    output = buy.body.get("output") if isinstance(buy.body.get("output"), dict) else {}
    odno = str(output.get("ODNO", "")).strip()
    org_no = str(output.get("KRX_FWDG_ORD_ORGNO", "")).strip()
    if not odno:
        probes.append(Probe("overseas_order_rvsecncl", "VTTT1004U", "untested",
                            "매수 주문번호가 없어 정정·취소를 시도하지 않았다"))
        return probes

    revise = client.post(
        "/uapi/overseas-stock/v1/trading/order-rvsecncl",
        "VTTT1004U",
        {
            **client.account_params,
            "OVRS_EXCG_CD": ORDER_EXCHANGE,
            "PDNO": PROBE_SYMBOL,
            "ORGN_ODNO": odno,
            "RVSE_CNCL_DVSN_CD": "01",  # 01 정정
            "ORD_QTY": "1",
            # 원주문과 같은 가격이면 40410000으로 거부된다. 실제로 값을 바꿔야
            # 정정 경로가 검증된다.
            "OVRS_ORD_UNPR": revise_price,
            "KRX_FWDG_ORD_ORGNO": org_no,
            "ORD_SVR_DVSN_CD": "0",
        },
    )
    supported, detail = _verdict(revise)
    probes.append(Probe("overseas_order_revise", "VTTT1004U", supported, detail))
    revised = revise.body.get("output") if isinstance(revise.body.get("output"), dict) else {}
    cancel_target = str(revised.get("ODNO", "")).strip() or odno

    cancel = client.post(
        "/uapi/overseas-stock/v1/trading/order-rvsecncl",
        "VTTT1004U",
        {
            **client.account_params,
            "OVRS_EXCG_CD": ORDER_EXCHANGE,
            "PDNO": PROBE_SYMBOL,
            "ORGN_ODNO": cancel_target,
            "RVSE_CNCL_DVSN_CD": "02",  # 02 취소
            "ORD_QTY": "1",
            "OVRS_ORD_UNPR": "0",
            "KRX_FWDG_ORD_ORGNO": org_no,
            "ORD_SVR_DVSN_CD": "0",
        },
    )
    supported, detail = _verdict(cancel)
    probes.append(Probe("overseas_order_cancel", "VTTT1004U", supported, detail))
    return probes


def record(connection, probes: list[Probe]) -> None:
    now = int(time.time())
    for probe in probes:
        connection.execute(
            "INSERT INTO kis_capability_matrix"
            " (api_name, tr_id, paper_supported, detail, last_self_test)"
            " VALUES (?, ?, ?, ?, ?)"
            " ON CONFLICT(api_name) DO UPDATE SET"
            "   tr_id=excluded.tr_id, paper_supported=excluded.paper_supported,"
            "   detail=excluded.detail, last_self_test=excluded.last_self_test",
            (probe.api_name, probe.tr_id, probe.supported, probe.detail, now),
        )
    connection.commit()


def main() -> int:
    parser = argparse.ArgumentParser(description="KIS 모의 Capability Matrix self-test")
    parser.add_argument("--with-orders", action="store_true",
                        help="모의계좌에 실제 주문을 넣어 매수·정정·취소를 확인한다")
    parser.add_argument("--limit-price", default="1.00",
                        help="체결되지 않도록 낮게 잡는 지정가 (기본 1.00 USD)")
    args = parser.parse_args()

    config = load_paper_config()
    client = KisPaperClient(config)
    print(f"환경: {config.base_url}  계좌해시 {config.account_hash[:12]}...")

    try:
        client.access_token()
        print("접근토큰 발급: 성공")
    except KisApiError as error:
        print(f"접근토큰 발급 실패: {error}")
        return 1

    probes = [
        probe_quote(client),
        probe_balance(client),
        probe_psamount(client),
        probe_ccnl(client),
        probe_nccs(client),
    ]
    if args.with_orders:
        probes.extend(probe_order_cycle(client, args.limit_price))
    else:
        print("(주문 계열은 건너뛴다. --with-orders로 켠다)")

    connection = db.connect()
    try:
        record(connection, probes)
        environment_row = (
            "INSERT INTO broker_environments"
            " (mode, account_hash, credential_scope, base_url, health, checked_at)"
            " VALUES ('PAPER', ?, 'paper', ?, ?, ?)"
            " ON CONFLICT(mode) DO UPDATE SET"
            "   account_hash=excluded.account_hash, base_url=excluded.base_url,"
            "   health=excluded.health, checked_at=excluded.checked_at"
        )
        health = "ok" if all(p.supported == "supported" for p in probes) else "degraded"
        connection.execute(environment_row, (config.account_hash, config.base_url, health, int(time.time())))
        connection.commit()
    finally:
        connection.close()

    width = max(len(p.api_name) for p in probes)
    print()
    for probe in probes:
        print(f"{probe.api_name.ljust(width)}  {probe.supported.upper():<11} {probe.tr_id:<12} {probe.detail}")
    print()
    print(json.dumps({p.api_name: p.supported for p in probes}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
