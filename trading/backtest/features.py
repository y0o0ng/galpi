"""설계 7.4·7.5의 피처 계산.

전부 결정론적이고 `as_of`까지의 바만 본다(설계 3.1). 계산은 조정가로 하고, 실제 주문
가격 단위가 필요한 값(ATR·달러거래대금)만 raw 기준으로 되돌린다. 분할이 낀 구간에서
조정가로 만든 ATR을 그대로 손절폭에 쓰면 폭이 어긋나기 때문이다.
"""

from __future__ import annotations

import hashlib
import math
import sqlite3
import statistics
from dataclasses import dataclass

from .data import Bar, PointInTimeSnapshot

STRATEGY_VERSION = "core-v2.3"

RS_LOOKBACK = 63
RS_SKIP = 5
TREND_WINDOW = 60
ATR_WINDOW = 14
SMA_FAST = 50
SMA_SLOW = 200
VOL_WINDOW = 20
DOLLAR_VOLUME_WINDOW = 20
CORRELATION_WINDOW = 60  # 9.2 하드 한도: 최근 60일 상관
TRADING_DAYS_PER_YEAR = 252

# 설계 7.2의 "상장 이력 최소 252거래일". 모든 창(200일 SMA, 64일 RS)보다 길어서
# 이 조건을 넘긴 종목은 나머지 피처를 모두 계산할 수 있다.
MIN_HISTORY = 252


class FeatureUnavailable(Exception):
    """피처를 계산할 수 없을 때 올린다. `reason`은 감사에 기록할 코드다."""

    def __init__(self, reason: str, detail: str) -> None:
        super().__init__(f"{reason}: {detail}")
        self.reason = reason
        self.detail = detail


@dataclass(frozen=True)
class Features:
    symbol: str
    trade_date: str
    rs63_5: float
    trend_quality60: float
    atr14: float
    sma50: float
    sma200: float
    realized_vol20: float
    dollar_volume_median20: float
    bars_used: int

    @property
    def feature_hash(self) -> str:
        """같은 입력·같은 규칙에서 나온 값인지 확인하는 지문(설계 19.3)."""
        parts = [
            STRATEGY_VERSION,
            self.symbol,
            self.trade_date,
            str(self.bars_used),
            f"{self.rs63_5:.10g}",
            f"{self.trend_quality60:.10g}",
            f"{self.atr14:.10g}",
            f"{self.sma50:.10g}",
            f"{self.sma200:.10g}",
            f"{self.realized_vol20:.10g}",
            f"{self.dollar_volume_median20:.10g}",
        ]
        return hashlib.sha256("|".join(parts).encode("utf-8")).hexdigest()


def sma(values: list[float], window: int) -> float:
    """최근 `window`개의 단순 평균."""
    if len(values) < window:
        raise FeatureUnavailable("SHORT_HISTORY", f"SMA{window}에 {len(values)}개뿐입니다")
    return statistics.fmean(values[-window:])


def log_returns(values: list[float]) -> list[float]:
    return [math.log(values[i] / values[i - 1]) for i in range(1, len(values))]


def realized_vol(values: list[float], window: int = VOL_WINDOW) -> float:
    """최근 `window`개 일간 로그수익률의 연환산 표준편차."""
    if len(values) < window + 1:
        raise FeatureUnavailable(
            "SHORT_HISTORY", f"{window}일 변동성에 {len(values)}개뿐입니다"
        )
    returns = log_returns(values[-(window + 1) :])
    return statistics.stdev(returns) * math.sqrt(TRADING_DAYS_PER_YEAR)


def correlation(
    values: list[float], other: list[float], window: int = CORRELATION_WINDOW
) -> float:
    """두 종목 일간 로그수익률의 피어슨 상관(9.2의 "최근 60일 상관").

    한쪽이 완전히 정지한 계열이면 함께 움직인 적이 없으므로 0으로 본다.
    """
    needed = window + 1
    if len(values) < needed or len(other) < needed:
        raise FeatureUnavailable(
            "SHORT_HISTORY",
            f"{window}일 상관에 {min(len(values), len(other))}개뿐입니다",
        )
    left = log_returns(values[-needed:])
    right = log_returns(other[-needed:])
    mean_left = statistics.fmean(left)
    mean_right = statistics.fmean(right)
    cov = sum((a - mean_left) * (b - mean_right) for a, b in zip(left, right))
    var_left = sum((a - mean_left) ** 2 for a in left)
    var_right = sum((b - mean_right) ** 2 for b in right)
    if var_left == 0 or var_right == 0:
        return 0.0
    return cov / math.sqrt(var_left * var_right)


def trend_quality(values: list[float], window: int = TREND_WINDOW) -> float:
    """연환산 기울기 × R². 한 번의 급등보다 꾸준하고 매끄러운 상승을 선호한다."""
    if len(values) < window:
        raise FeatureUnavailable(
            "SHORT_HISTORY", f"{window}일 추세 품질에 {len(values)}개뿐입니다"
        )
    logs = [math.log(value) for value in values[-window:]]
    xs = list(range(window))
    mean_x = statistics.fmean(xs)
    mean_y = statistics.fmean(logs)
    sxx = sum((x - mean_x) ** 2 for x in xs)
    sxy = sum((x - mean_x) * (y - mean_y) for x, y in zip(xs, logs))
    syy = sum((y - mean_y) ** 2 for y in logs)
    slope = sxy / sxx
    # 가격이 완전히 평평하면 설명할 분산 자체가 없다. 추세 품질을 0으로 본다.
    r_squared = 0.0 if syy == 0 else (sxy * sxy) / (sxx * syy)
    return slope * TRADING_DAYS_PER_YEAR * r_squared


def average_true_range(bars: list[Bar], window: int = ATR_WINDOW) -> float:
    """조정가로 TR을 만들고 마지막 바의 배율로 실제 주문 가격 단위로 되돌린다."""
    if len(bars) < window + 1:
        raise FeatureUnavailable("SHORT_HISTORY", f"ATR{window}에 {len(bars)}개뿐입니다")
    true_ranges = []
    for previous, current in zip(bars[-(window + 1) : -1], bars[-window:]):
        true_ranges.append(
            max(
                current.adj_high - current.adj_low,
                abs(current.adj_high - previous.adj_close),
                abs(current.adj_low - previous.adj_close),
            )
        )
    return statistics.fmean(true_ranges) * bars[-1].price_scale


def relative_strength(
    values: list[float],
    reference: list[float],
    lookback: int = RS_LOOKBACK,
    skip: int = RS_SKIP,
) -> float:
    """최근 `skip`일을 제외한 `lookback`일 상대모멘텀. 단기 추격과 반전을 줄인다."""
    needed = lookback + 1
    if len(values) < needed or len(reference) < needed:
        raise FeatureUnavailable(
            "SHORT_HISTORY", f"RS{lookback}_{skip}에 {min(len(values), len(reference))}개뿐입니다"
        )
    own = math.log(values[-(skip + 1)] / values[-(lookback + 1)])
    market = math.log(reference[-(skip + 1)] / reference[-(lookback + 1)])
    return own - market


def compute_features(snapshot: PointInTimeSnapshot, symbol: str) -> Features:
    """`as_of` 종가 기준 피처. 계산할 수 없으면 `FeatureUnavailable`을 올린다."""
    bars = snapshot.bars(symbol, MIN_HISTORY)
    if not bars:
        raise FeatureUnavailable("NO_BARS", f"{symbol}의 바가 없습니다")
    if len(bars) < MIN_HISTORY:
        raise FeatureUnavailable(
            "SHORT_HISTORY", f"{symbol}의 상장 이력이 {len(bars)}일입니다 (최소 {MIN_HISTORY}일)"
        )
    if bars[-1].trade_date != snapshot.as_of:
        raise FeatureUnavailable(
            "STALE", f"{symbol}의 마지막 바가 {bars[-1].trade_date}입니다 (as_of {snapshot.as_of})"
        )

    reference_bars = snapshot.bars(snapshot.reference_symbol, MIN_HISTORY)
    if len(reference_bars) < MIN_HISTORY:
        raise FeatureUnavailable(
            "SHORT_HISTORY",
            f"기준 심볼 {snapshot.reference_symbol}의 이력이 {len(reference_bars)}일입니다",
        )
    own_dates = [bar.trade_date for bar in bars]
    reference_dates = [bar.trade_date for bar in reference_bars]
    if own_dates != reference_dates:
        # 거래일 달력이 어긋나면 t-5·t-63 같은 offset이 서로 다른 날을 가리킨다.
        # 휴장·조기 종료·소스 공백을 여기서 잡는다(설계 21.1).
        gap = next(
            (own, ref)
            for own, ref in zip(own_dates, reference_dates)
            if own != ref
        )
        raise FeatureUnavailable(
            "CALENDAR_MISMATCH",
            f"{symbol}의 거래일이 {snapshot.reference_symbol}과 어긋납니다: {gap[0]} != {gap[1]}",
        )

    adjusted = [bar.adj_close for bar in bars]
    reference_adjusted = [bar.adj_close for bar in reference_bars]
    dollar_volumes = [bar.dollar_volume for bar in bars[-DOLLAR_VOLUME_WINDOW:]]

    return Features(
        symbol=symbol,
        trade_date=snapshot.as_of,
        rs63_5=relative_strength(adjusted, reference_adjusted),
        trend_quality60=trend_quality(adjusted),
        atr14=average_true_range(bars),
        sma50=sma(adjusted, SMA_FAST),
        sma200=sma(adjusted, SMA_SLOW),
        realized_vol20=realized_vol(adjusted),
        dollar_volume_median20=statistics.median(dollar_volumes),
        bars_used=len(bars),
    )


def save_features(
    connection: sqlite3.Connection, source_version: str, features: Features
) -> None:
    """피처를 감사용으로 저장한다. 같은 키를 다시 쓰면 마지막 계산으로 덮는다."""
    with connection:
        connection.execute(
            "INSERT OR REPLACE INTO features_daily"
            " (symbol, trade_date, strategy_version, source_version, rs63_5,"
            "  trend_quality60, atr14, sma50, sma200, realized_vol20,"
            "  dollar_volume_median20, bars_used, feature_hash)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                features.symbol,
                features.trade_date,
                STRATEGY_VERSION,
                source_version,
                features.rs63_5,
                features.trend_quality60,
                features.atr14,
                features.sma50,
                features.sma200,
                features.realized_vol20,
                features.dollar_volume_median20,
                features.bars_used,
                features.feature_hash,
            ),
        )
