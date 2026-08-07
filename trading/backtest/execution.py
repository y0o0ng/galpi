"""설계 10.1 진입과 9.3 갭 손절의 일봉 체결 모델.

t일 종가 신호는 t+1 이후에만 체결된다(21.2). 함수는 신호 바와 집행 바를 모두 받아
날짜 순서를 확인하고, 어긴 호출은 예외로 만든다.

## 일봉이 흉내낼 수 없는 것

|10.1의 규칙|여기서 하는 일|편향 방향|
|---|---|---|
|개장 15~60분 후 실행|시가 또는 지정가로 체결|시가 체결은 실제보다 이른 가격이다|
|미체결 20분 후 1회 재산정|재산정 없이 `NO_FILL`로 취소하고 건수를 남김|거래를 잃는 쪽이라 보수적|
|부분체결은 체결분만 보유|모델링하지 않는다. 전량 또는 미체결|수량이 실제보다 클 수 있다. 유니버스가 20일 중앙값 5천만 달러 이상이고 주문은 계좌의 12% 이하라 실제로 부분체결이 날 규모가 아니다|

**저가가 지정가에 닿으면 체결로 본다.** 실제로는 호가 대기열 때문에 닿아도 못 살 수 있으니
낙관적인 가정이다. 그래서 시가 체결(`OPEN_FILL`)과 지정가 체결(`LIMIT_FILL`)의 사유를
나눠 남긴다. 성과가 지정가 체결에 얼마나 의존하는지 세어봐야 한다.

**지정가는 기준가의 상한이고 비용은 그 위에 얹는다.** 실제 지정가 주문은 지정가를 넘겨
체결되지 않으므로, 이 모델은 몇 bp 비싸게 사는 쪽이다. 낙관 편향이 아니라 보수적 방향이라
그대로 둔다.

**기업행동이 끼면 취소한다.** 신호일과 집행일의 조정 배율이 다르면 지정가·수량·손절을
모두 다시 계산해야 한다. 미결 주문에 기업행동을 반영하는 것은 실행 어댑터의 일이고,
백테스터는 그 드문 경우를 가짜 체결로 만드는 대신 `CORPORATE_ACTION`으로 취소한다.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from .candidates import Skip
from .costs import CostModel
from .data import CORPORATE_ACTION_REL_TOL, Bar
from .policy import StrategyParameters
from .sizing import SizedIntent


class ExecutionError(Exception):
    """체결 모델의 전제를 어긴 호출일 때 올린다."""


@dataclass(frozen=True)
class Fill:
    symbol: str
    trade_date: str
    side: str
    shares: int
    reference_price: float  # 바에서 나온 비용 전 가격
    fill_price: float  # 슬리피지·스프레드 반영
    fees: float  # 수수료와 매도 제세금
    reason: str

    @property
    def notional(self) -> float:
        return self.shares * self.fill_price

    @property
    def cash_delta(self) -> float:
        """계좌 현금 변화. 매수는 음수, 매도는 양수다."""
        if self.side == "BUY":
            return -(self.notional + self.fees)
        return self.notional - self.fees


@dataclass(frozen=True)
class ExecutionResult:
    symbol: str
    fill: Fill | None
    cancellation: Skip | None

    def __bool__(self) -> bool:
        return self.fill is not None


def _cancel(symbol: str, reason: str, detail: str) -> ExecutionResult:
    return ExecutionResult(symbol=symbol, fill=None, cancellation=Skip(symbol, reason, detail))


def _make_fill(
    symbol: str,
    bar: Bar,
    side: str,
    shares: int,
    reference_price: float,
    reason: str,
    costs: CostModel,
) -> Fill:
    fill_price = costs.fill_price(reference_price, side)
    return Fill(
        symbol=symbol,
        trade_date=bar.trade_date,
        side=side,
        shares=shares,
        reference_price=reference_price,
        fill_price=fill_price,
        fees=costs.fees_for(shares, fill_price, side),
        reason=reason,
    )


def corporate_action_between(signal_bar: Bar, execution_bar: Bar) -> bool:
    """두 바의 조정 배율이 다르면 그 사이에 분할·배당 조정이 있었다.

    벤더 반올림 잡음과 실제 조정을 가르는 문턱은 `CORPORATE_ACTION_REL_TOL`이다.
    """
    return not math.isclose(
        signal_bar.price_scale,
        execution_bar.price_scale,
        rel_tol=CORPORATE_ACTION_REL_TOL,
    )


def _assert_forward(signal_bar: Bar, execution_bar: Bar) -> None:
    if execution_bar.trade_date <= signal_bar.trade_date:
        raise ExecutionError(
            f"신호일({signal_bar.trade_date}) 이후에만 체결할 수 있습니다:"
            f" {execution_bar.trade_date}"
        )


def execute_entry(
    intent: SizedIntent,
    signal_bar: Bar,
    execution_bar: Bar,
    *,
    costs: CostModel,
    parameters: StrategyParameters,
) -> ExecutionResult:
    """다음 정규장에서 시장성 지정가 진입을 시도한다."""
    _assert_forward(signal_bar, execution_bar)
    if corporate_action_between(signal_bar, execution_bar):
        return _cancel(
            intent.symbol,
            "CORPORATE_ACTION",
            f"조정 배율이 {signal_bar.price_scale:.6f} → {execution_bar.price_scale:.6f}로"
            " 바뀌어 지정가와 수량을 다시 계산해야 합니다",
        )

    gap_threshold = (
        intent.reference_close + parameters.gap_cancel_atr * intent.atr14
    )
    if execution_bar.raw_open >= gap_threshold:
        return _cancel(
            intent.symbol,
            "GAP_LIMIT",
            f"시초가 {execution_bar.raw_open:.2f} >= 신호 종가 + 1 ATR"
            f" {gap_threshold:.2f}",
        )

    limit = intent.planned_entry
    if execution_bar.raw_open <= limit:
        reference_price, reason = execution_bar.raw_open, "OPEN_FILL"
    elif execution_bar.raw_low <= limit:
        reference_price, reason = limit, "LIMIT_FILL"
    else:
        return _cancel(
            intent.symbol,
            "NO_FILL",
            f"저가 {execution_bar.raw_low:.2f}가 지정가 {limit:.2f}에 닿지 않았습니다",
        )

    return ExecutionResult(
        symbol=intent.symbol,
        fill=_make_fill(
            intent.symbol,
            execution_bar,
            "BUY",
            intent.shares,
            reference_price,
            reason,
            costs,
        ),
        cancellation=None,
    )


def try_stop_exit(
    symbol: str, shares: int, stop_price: float, bar: Bar, *, costs: CostModel
) -> Fill | None:
    """손절이 걸렸으면 체결을 만든다. 걸리지 않았으면 None이다.

    9.3: 백테스트에서 stop price가 아니라 **다음 거래 가능 가격**으로 체결한다. 시초가가
    이미 손절가 아래면 손절가에 팔 수 없었으므로 시초가로 체결한다.

    포지션이 기업행동을 지난 경우 손절가는 호출자가 미리 조정해 넘겨야 한다. 이 함수는
    손절가와 바가 같은 가격 기준이라고 가정한다.
    """
    if stop_price <= 0:
        raise ExecutionError(f"손절가가 0 이하입니다: {stop_price}")
    if bar.raw_open <= stop_price:
        return _make_fill(symbol, bar, "SELL", shares, bar.raw_open, "GAP_FILL", costs)
    if bar.raw_low <= stop_price:
        return _make_fill(symbol, bar, "SELL", shares, stop_price, "STOP_FILL", costs)
    return None


def execute_market_exit(
    symbol: str,
    shares: int,
    bar: Bar,
    *,
    costs: CostModel,
    price_kind: str = "OPEN",
) -> Fill:
    """시간손절·최대보유·실적 전 청산의 체결.

    `OPEN`은 전날 종가에 결정해 다음 장 시초에 내보내는 청산이고, `CLOSE`는 7.5의
    "실적 발표 전 거래일 정규장 종료까지 청산"처럼 그날 종가에 맞추는 청산이다.
    """
    if price_kind == "OPEN":
        reference_price = bar.raw_open
    elif price_kind == "CLOSE":
        reference_price = bar.raw_close
    else:
        raise ExecutionError(f"price_kind는 OPEN 또는 CLOSE여야 합니다: {price_kind!r}")
    return _make_fill(
        symbol, bar, "SELL", shares, reference_price, f"{price_kind}_EXIT", costs
    )
