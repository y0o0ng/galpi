"""설계 14.7의 성과 지표 측정.

**측정만 한다.** 14.4의 검증 절차와 14.7의 판정은 `validation.py`에 있다. 판정이 측정에
섞이면 "이 숫자를 판정에 쓸 수 있는가"라는 질문이 숫자 옆에서 사라진다.

## 지표 정의에서 정한 것

설계는 지표 이름과 문턱만 준다. 계산 방식은 여기서 정했다.

|지표|정의|비고|
|---|---|---|
|Sharpe|일간 자산 수익률의 `평균 / 표준편차 × sqrt(252)`|무위험수익률 0. 아래 주의 참고|
|Sortino|`평균 / 하방편차 × sqrt(252)`, 하방편차는 전체 표본 n으로 나눈다|목표수익률(MAR) 0|
|최대낙폭|자산 곡선의 고점 대비 최대 하락률|loop가 세션마다 기록한 값의 최대|
|Profit Factor|총이익 / 총손실, 둘 다 **수수료 차감 후**|14.7의 "비용 후"를 따른다|
|CAGR|`(최종/초기)^(252/세션수) - 1`|세션 수를 252로 나눠 연 단위로 본다|
|Calmar|`CAGR / 최대낙폭`||
|거래당 기대값|거래별 `return_r`의 평균|R은 진입 시점 위험(수량 × 2 ATR)|

**무위험수익률을 0으로 둔 것은 두 방향으로 틀린다.** 이 전략은 익스포저가 60% 이하라
현금이 항상 남는데 그 현금에 이자를 주지 않으므로 수익률을 과소평가하고, 동시에 전략
수익률에서 무위험수익률을 빼지 않으므로 Sharpe를 과대평가한다. 실제 무위험수익률 계열은
데이터 계약에 추가할 항목이고, 그때까지 Sharpe·Sortino는 상한으로 읽는다.
"""

from __future__ import annotations

import math
import statistics
from dataclasses import dataclass

from .features import TRADING_DAYS_PER_YEAR
from .loop import BacktestResult


@dataclass(frozen=True)
class Metrics:
    sessions: int
    trade_count: int
    win_rate: float | None
    expectancy_r: float | None
    avg_win_r: float | None
    avg_loss_r: float | None
    gross_profit: float
    gross_loss: float
    fees_paid: float
    profit_factor: float | None
    initial_equity: float
    final_equity: float
    total_return: float
    cagr: float | None
    sharpe: float | None
    sortino: float | None
    max_drawdown: float
    calmar: float | None
    avg_exposure: float
    min_qty_exception_share: float | None
    exit_mix: dict[str, int]
    # 연 회전율. 매수 체결 금액 합을 평균 자산과 연수로 나눈다. **K를 바꾸면 자리가 늦게
    # 비어 회전이 줄고 비용도 줄므로, K 비교에서는 이것이 없으면 "덜 사서 덜 냈다"와
    # "잘 골랐다"를 구별할 수 없다.**
    turnover: float | None = None
    # 실제 평균 보유 세션. 만기 청산만 있어도 폐지·정지로 일찍 끝나는 거래가 있어서
    # `max_hold_sessions`와 같지 않다.
    avg_hold_sessions: float | None = None

    @property
    def has_sample(self) -> bool:
        return self.trade_count > 0 and self.sessions > 1


def daily_returns(result: BacktestResult) -> list[float]:
    """세션별 자산 수익률. 첫 세션은 초기 자본 대비로 잰다."""
    previous = result.config.initial_capital
    returns: list[float] = []
    for point in result.equity_curve:
        if previous > 0:
            returns.append(point.equity / previous - 1)
        previous = point.equity
    return returns


def _annualized_sharpe(returns: list[float]) -> float | None:
    if len(returns) < 2:
        return None
    deviation = statistics.stdev(returns)
    if deviation == 0:
        return None
    return statistics.fmean(returns) / deviation * math.sqrt(TRADING_DAYS_PER_YEAR)


def _annualized_sortino(returns: list[float]) -> float | None:
    """하방편차는 손실 일수가 아니라 전체 표본 수로 나눈다(표준 Sortino)."""
    if len(returns) < 2:
        return None
    downside = math.sqrt(
        sum(min(value, 0.0) ** 2 for value in returns) / len(returns)
    )
    if downside == 0:
        return None
    return statistics.fmean(returns) / downside * math.sqrt(TRADING_DAYS_PER_YEAR)


def _turnover(result: BacktestResult, sessions: int) -> float | None:
    """연 회전율. 산 금액 합 / 평균 자산 / 연수.

    **매수만 센다.** 롱 온리라 결국 같은 것을 팔지만, 구간 끝에 열려 있는 자리는 팔지
    않았으므로 매도로 세면 그만큼 빠진다. 산 것을 세면 그 자리도 회전에 든다.
    """
    if sessions <= 0 or not result.equity_curve:
        return None
    average_equity = statistics.fmean(
        point.equity for point in result.equity_curve if point.equity > 0
    )
    if average_equity <= 0:
        return None
    bought = sum(fill.notional for fill in result.fills if fill.side == "BUY")
    years = sessions / TRADING_DAYS_PER_YEAR
    return bought / average_equity / years if years > 0 else None


def compute_metrics(result: BacktestResult) -> Metrics:
    """실행 결과에서 14.7의 지표를 낸다. 낼 수 없는 값은 None이다."""
    initial = result.config.initial_capital
    final = result.final_equity
    sessions = len(result.equity_curve)
    trades = result.trades

    wins = [trade for trade in trades if trade.pnl > 0]
    losses = [trade for trade in trades if trade.pnl < 0]
    gross_profit = sum(trade.pnl for trade in wins)
    gross_loss = -sum(trade.pnl for trade in losses)

    returns = daily_returns(result)
    max_drawdown = max((point.drawdown for point in result.equity_curve), default=0.0)
    cagr = None
    if sessions > 0 and initial > 0 and final > 0:
        years = sessions / TRADING_DAYS_PER_YEAR
        cagr = (final / initial) ** (1 / years) - 1 if years > 0 else None

    exits: dict[str, int] = {}
    for trade in trades:
        exits[trade.exit_reason] = exits.get(trade.exit_reason, 0) + 1

    entries = len(trades) + len(result.open_positions)
    exception_entries = sum(1 for trade in trades if trade.min_qty_exception)

    return Metrics(
        sessions=sessions,
        trade_count=len(trades),
        win_rate=len(wins) / len(trades) if trades else None,
        expectancy_r=statistics.fmean(trade.return_r for trade in trades)
        if trades
        else None,
        avg_win_r=statistics.fmean(trade.return_r for trade in wins) if wins else None,
        avg_loss_r=statistics.fmean(trade.return_r for trade in losses)
        if losses
        else None,
        gross_profit=gross_profit,
        gross_loss=gross_loss,
        fees_paid=sum(trade.fees for trade in trades),
        # 손실이 없으면 나눌 수 없다. 무한대를 만들지 않고 판정 불가로 남긴다.
        profit_factor=gross_profit / gross_loss if gross_loss > 0 else None,
        initial_equity=initial,
        final_equity=final,
        total_return=final / initial - 1 if initial > 0 else 0.0,
        cagr=cagr,
        sharpe=_annualized_sharpe(returns),
        sortino=_annualized_sortino(returns),
        max_drawdown=max_drawdown,
        calmar=cagr / max_drawdown if cagr is not None and max_drawdown > 0 else None,
        avg_exposure=statistics.fmean(
            point.exposure / point.equity
            for point in result.equity_curve
            if point.equity > 0
        )
        if result.equity_curve
        else 0.0,
        min_qty_exception_share=exception_entries / entries if entries else None,
        exit_mix=exits,
        turnover=_turnover(result, sessions),
        avg_hold_sessions=statistics.fmean(trade.sessions_held for trade in trades)
        if trades
        else None,
    )
