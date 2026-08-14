"""노출을 맞춘 벤치마크.

## 왜 SPY 100% 보유와 견주면 안 되는가

이 전략은 평균 익스포저가 18% 안팎이다. 100% 투자된 SPY와 총수익을 견주면 "주식을 덜
샀다"를 "종목 선택이 나쁘다"로 읽게 된다. 반대로 아무 벤치마크도 안 두면 **양수 기대값이
곧 실력**인 것처럼 읽힌다.

그래서 **매 세션 전략과 같은 비율만큼 SPY를 들고 있었다면** 얼마였는지를 낸다. 노출이
같으므로 남는 차이는 "무엇을 샀는가"뿐이고, 그것이 종목 선택의 기여다.

## 이 벤치마크는 전략에 유리하지 않다

거래 비용을 매기지 않는다. 매일 비중을 다시 맞추려면 실제로는 비용이 들고, 애초에 그날의
전략 노출을 미리 알 수도 없다. 즉 **실행 불가능하고 비용도 공짜인, 일부러 후하게 잡은
상대**다. 여기에 지면 변명의 여지가 적다.

**수익률만 견준다.** 5종목 집중과 지수 분산은 위험의 성질이 다르므로 낙폭·Sharpe를 함께
본다. 노출이 같아도 같은 위험이 아니다.
"""

from __future__ import annotations

import math
import statistics
from dataclasses import dataclass

from .features import TRADING_DAYS_PER_YEAR


@dataclass(frozen=True)
class BenchmarkResult:
    label: str
    sessions: int
    total_return: float
    cagr: float | None
    max_drawdown: float
    sharpe: float | None

    @property
    def final_equity_multiple(self) -> float:
        return 1.0 + self.total_return


def summarize(returns: list[float], label: str) -> BenchmarkResult:
    """일간 수익률 계열을 지표로 옮긴다. `metrics`와 같은 정의를 쓴다."""
    equity, peak, worst = 1.0, 1.0, 0.0
    for value in returns:
        equity *= 1 + value
        peak = max(peak, equity)
        worst = max(worst, 1 - equity / peak)
    sessions = len(returns)
    total = equity - 1
    years = sessions / TRADING_DAYS_PER_YEAR
    deviation = statistics.stdev(returns) if sessions > 1 else 0.0
    return BenchmarkResult(
        label=label,
        sessions=sessions,
        total_return=total,
        cagr=(equity ** (1 / years) - 1) if years > 0 and equity > 0 else None,
        max_drawdown=worst,
        sharpe=(
            statistics.fmean(returns) / deviation * math.sqrt(TRADING_DAYS_PER_YEAR)
            if deviation > 0
            else None
        ),
    )


def exposure_weights(curve) -> list[float]:
    """세션별 익스포저 비율. 자산이 0 이하인 세션은 0으로 둔다."""
    return [
        point.exposure / point.equity if point.equity > 0 else 0.0 for point in curve
    ]


def exposure_matched(curve, reference_closes: dict[str, float]) -> list[float]:
    """전략과 같은 비율로 기준 지수를 들고 있었을 때의 일간 수익률.

    **어제 종가의 비중이 오늘 수익률을 번다.** 오늘 비중으로 오늘 수익을 곱하면 그날의
    움직임을 미리 알고 노출을 정한 것이 되어 룩어헤드다.
    """
    weights = exposure_weights(curve)
    dates = [point.trade_date for point in curve]
    returns = []
    for index in range(1, len(dates)):
        before, after = reference_closes[dates[index - 1]], reference_closes[dates[index]]
        returns.append(weights[index - 1] * (after / before - 1))
    return returns


def benchmark_table(curve, reference_closes: dict[str, float]) -> list[BenchmarkResult]:
    """세 줄. 일별 노출 일치 · 평균 노출 고정 · 100% 보유.

    가운데 줄이 있는 이유는 첫 줄과의 차이가 **노출 타이밍**의 기여이기 때문이다. 둘이
    비슷하면 전략이 노출을 언제 늘리고 줄였는지는 결과에 거의 기여하지 않은 것이다.
    """
    weights = exposure_weights(curve)
    dates = [point.trade_date for point in curve]
    market = [
        reference_closes[dates[index]] / reference_closes[dates[index - 1]] - 1
        for index in range(1, len(dates))
    ]
    average = statistics.fmean(weights) if weights else 0.0
    return [
        summarize(exposure_matched(curve, reference_closes), "일별 노출 일치"),
        summarize([average * value for value in market], f"평균 노출 {average:.1%} 고정"),
        summarize(market, "100% 보유"),
    ]
