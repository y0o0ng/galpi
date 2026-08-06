"""설계 14.7 성과 통과 기준과 그 판정.

이 모듈의 요점은 지표 계산이 아니라 **판정 불가를 코드가 강제하는 것**이다. 생존편향
데이터로 낸 숫자, 실적·섹터 게이트를 끄고 낸 숫자, 표본 안 구간에서 낸 숫자가 "14.7
통과"로 읽히면 백테스트를 하는 이유가 없어진다. 그래서 조건이 하나라도 빠지면 개별
지표가 아무리 좋아도 전체 판정은 `UNDETERMINED`다.

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

from .costs import Stress
from .features import TRADING_DAYS_PER_YEAR
from .loop import BacktestResult

# 9.1.1: 최소수량 예외가 전체 진입의 이 비율을 지속 초과하면 위험 프로필을 재검토한다.
MIN_QTY_EXCEPTION_REVIEW_SHARE = 0.40

PASS = "PASS"
TARGET = "TARGET"
FAIL = "FAIL"
UNDETERMINED = "UNDETERMINED"


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
    )


@dataclass(frozen=True)
class GateRow:
    name: str
    value: float | int | None
    minimum: float | None
    target: float | None
    higher_is_better: bool
    verdict: str
    note: str = ""


@dataclass(frozen=True)
class GateReport:
    """14.7 판정. `verdict`가 `UNDETERMINED`면 개별 지표를 성과 근거로 쓸 수 없다."""

    verdict: str
    rows: tuple[GateRow, ...]
    blockers: tuple[str, ...]

    def row(self, name: str) -> GateRow:
        for row in self.rows:
            if row.name == name:
                return row
        raise KeyError(name)


def _judge(
    name: str,
    value: float | int | None,
    minimum: float | None,
    target: float | None,
    *,
    higher_is_better: bool = True,
    note: str = "",
) -> GateRow:
    if value is None:
        verdict = UNDETERMINED
    elif higher_is_better:
        verdict = TARGET if target is not None and value >= target else (
            PASS if minimum is not None and value >= minimum else FAIL
        )
    else:
        verdict = TARGET if target is not None and value <= target else (
            PASS if minimum is not None and value <= minimum else FAIL
        )
    return GateRow(
        name=name,
        value=value,
        minimum=minimum,
        target=target,
        higher_is_better=higher_is_better,
        verdict=verdict,
        note=note,
    )


def evaluate_gate(
    result: BacktestResult,
    metrics: Metrics,
    *,
    survivorship_biased: bool,
    out_of_sample: bool = False,
    stressed: Metrics | None = None,
) -> GateReport:
    """14.7의 표를 채우고 판정한다.

    조건이 빠지면 개별 지표가 아무리 좋아도 전체 판정은 `UNDETERMINED`다. `blockers`에
    무엇이 빠졌는지 남긴다. 숫자를 지우지는 않는다. 엔진 검증에는 그 숫자가 필요하고,
    판정에 쓸 수 없다는 사실만 분명하면 된다.
    """
    config = result.config
    blockers: list[str] = []
    if survivorship_biased:
        blockers.append("SURVIVORSHIP_BIASED")
    if not out_of_sample:
        blockers.append("NOT_OUT_OF_SAMPLE")
    if not config.require_earnings_calendar:
        blockers.append("EARNINGS_GATE_DISABLED")
    if not config.require_sector:
        blockers.append("SECTOR_LIMIT_DISABLED")
    if stressed is None:
        blockers.append("COST_STRESS_MISSING")
    # 14.4·21.2의 인접 파라미터 안정성은 지표 파라미터를 PolicyVersion으로 옮긴 뒤에만
    # 돌릴 수 있다. 지금은 모듈 상수라 실행을 여러 번 만들 수 없다.
    blockers.append("PARAMETER_NEIGHBOURHOOD_NOT_RUN")

    rows = [
        _judge(
            "trade_count",
            metrics.trade_count,
            200,
            400,
            note="14.7의 200건은 표본 밖 거래 수다. 워크포워드 분할 전에는 판정 근거가 아니다",
        ),
        _judge("expectancy_r", metrics.expectancy_r, 0.0, 0.20),
        _judge("sharpe", metrics.sharpe, 0.6, 0.9, note="무위험수익률 0이라 상한으로 읽는다"),
        _judge("sortino", metrics.sortino, 0.9, 1.3, note="무위험수익률 0이라 상한으로 읽는다"),
        _judge(
            "max_drawdown",
            metrics.max_drawdown,
            0.15,
            0.10,
            higher_is_better=False,
        ),
        _judge("profit_factor", metrics.profit_factor, 1.15, 1.35),
        _judge("calmar", metrics.calmar, 0.6, 1.0),
        _judge(
            "cost_stress_breakeven",
            None
            if stressed is None
            else stressed.final_equity / stressed.initial_equity,
            1.0,
            None,
            note="비용 2배에서 손익분기 이상(14.7). 목표는 양의 CAGR",
        ),
        _judge(
            "cost_stress_cagr",
            None if stressed is None else stressed.cagr,
            None,
            0.0,
            note="비용 2배에서도 CAGR > 0이면 희망 기준",
        ),
        _judge(
            "parameter_neighbourhood",
            None,
            None,
            None,
            note="지표 파라미터를 PolicyVersion으로 옮긴 뒤 18/20/22일 등으로 돌린다",
        ),
        _judge(
            "min_qty_exception_share",
            metrics.min_qty_exception_share,
            MIN_QTY_EXCEPTION_REVIEW_SHARE,
            None,
            higher_is_better=False,
            note="9.1.1: 이 비율을 지속 초과하면 위험 프로필을 REVIEW로 올린다",
        ),
    ]

    if blockers:
        verdict = UNDETERMINED
    elif any(row.verdict == FAIL for row in rows):
        verdict = FAIL
    elif any(row.verdict == UNDETERMINED for row in rows):
        verdict = UNDETERMINED
    else:
        verdict = PASS
    return GateReport(verdict=verdict, rows=tuple(rows), blockers=tuple(blockers))


def stress_config(result: BacktestResult, factor: float = 2.0):
    """21.2의 "비용 2배·3배 스트레스" 실행 설정. 비용만 바꾸고 나머지는 그대로 둔다."""
    from dataclasses import replace

    return replace(
        result.config, costs=result.config.costs.stressed(Stress.uniform(factor))
    )
