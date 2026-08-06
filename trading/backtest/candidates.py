"""설계 7.2 유니버스와 7.4 종목 점수·진입 게이트.

11.1의 "유니버스·지표·후보 점수 계산 → 상위 후보 최대 5개 생성"까지가 이 모듈이다.
수량·체결은 여기서 다루지 않는다.

설계에 없어서 여기서 정한 것들이다.

- **z-score의 모집단은 7.2 필터를 통과한 유니버스 전체다.** 진입 게이트를 통과한
  종목끼리 z를 내면 전부 상승 추세인 부분집합 안의 상대 순위가 되어 "시장보다 강한"을
  재려던 7.1의 뜻과 달라진다.
- **YELLOW의 "상위 후보만"은 하루 진입 상한 1종목으로 읽었다.** 새 문턱을 만들지 않고
  10.1의 "하루 진입 최대 2종목"에 맞췄다. 후보 목록은 그대로 5개까지 만들고 상한만
  `Ranking`에 실어 집행 단계가 쓴다.
- **20일 돌파는 직전 20세션의 최고 고가로 잰다.** 7.1이 "실제 수요가 직전 거래 범위를
  돌파한"이라고 하므로 종가 기준보다 엄격한 쪽을 골랐다.
- **다가오는 실적일을 모르면 후보에서 뺀다.** 언제 갭이 날지 모르는 종목을 40거래일
  들고 갈 수는 없다(9.3). 실적 일정이 없는 무료 데이터로 엔진만 돌릴 때는
  `require_earnings_calendar=False`로 끄지만, PAPER·LIVE는 반드시 켜고 돌린다.
"""

from __future__ import annotations

import hashlib
import sqlite3
import statistics
from dataclasses import dataclass
from datetime import date, timedelta

from .data import Bar, PointInTimeSnapshot
from .features import FeatureUnavailable, Features, compute_features
from .policy import (
    DEFAULT_PAPER_POLICY,
    STRATEGY_VERSION,
    PolicyVersion,
    StrategyParameters,
)
from .regime import Regime

# 데이터 적재가 써야 하는 index_name 값이다. 7.2의 "S&P 500 + Nasdaq-100 당시 구성 종목".
# 종목 코드 체계는 지표 파라미터가 아니라 데이터 계약이라 정책으로 옮기지 않는다.
DEFAULT_INDEXES = ("SP500", "NDX100")

# 7.2 실적 완충을 세는 방식: 진입일을 포함하고 실적일은 제외한다. 실적 당일 전에 포지션을
# 며칠 들고 있는지가 이 완충이 재려는 값이기 때문이다. 월요일 진입이면 실적은 금요일
# 이후여야 한다. 세션 수 자체는 정책의 `earnings_min_sessions`다.


@dataclass(frozen=True)
class Skip:
    """후보에서 빠진 이유. 유니버스 편향 모니터링(21.2)이 이 값을 센다."""

    symbol: str
    reason: str
    detail: str


@dataclass(frozen=True)
class Candidate:
    symbol: str
    rank: int
    score: float
    z_rs63_5: float
    z_trend_quality60: float
    reference_close: float
    atr14: float
    features: Features
    reasons: tuple[str, ...]

    def signal_id(self, source_version: str) -> str:
        """같은 전략·데이터·날짜·종목이면 항상 같은 id다."""
        raw = "|".join(
            (STRATEGY_VERSION, source_version, self.features.trade_date, self.symbol)
        )
        return hashlib.sha256(raw.encode("utf-8")).hexdigest()


@dataclass(frozen=True)
class Ranking:
    as_of: str
    regime_state: str
    max_new_entries: int
    score_population: int
    candidates: tuple[Candidate, ...]
    skipped: tuple[Skip, ...]
    halt_reason: str | None

    def skip_counts(self) -> dict[str, int]:
        counts: dict[str, int] = {}
        for skip in self.skipped:
            counts[skip.reason] = counts.get(skip.reason, 0) + 1
        return counts


def zscores(values: dict[str, float]) -> dict[str, float]:
    """횡단면 z-score. 값이 모두 같으면 0으로 둔다."""
    if len(values) < 2:
        raise ValueError("z-score는 두 종목 이상에서만 낼 수 있습니다.")
    ordered = [values[symbol] for symbol in sorted(values)]
    mean = statistics.fmean(ordered)
    deviation = statistics.stdev(ordered)
    if deviation == 0:
        return {symbol: 0.0 for symbol in values}
    return {symbol: (value - mean) / deviation for symbol, value in values.items()}


def next_weekday(after: str) -> date:
    """다음 정규장 예정일. 공휴일은 아직 모른다(아래 주석 참고)."""
    current = date.fromisoformat(after) + timedelta(days=1)
    while current.weekday() >= 5:
        current += timedelta(days=1)
    return current


def weekdays_between(start: date, end: date) -> int:
    """`[start, end)` 구간의 평일 수.

    미래 휴장일은 스냅샷이 알 수 없으므로 평일로 센다. 휴장일이 끼면 실제 거래일은
    이 값보다 적어지므로 실적 완충이 최대 1~2세션 짧아질 수 있다. 실데이터에 거래소
    휴장일 표를 넣으면 이 함수를 세션 계산으로 바꾼다.
    """
    if end <= start:
        return 0
    count = 0
    current = start
    while current < end:
        if current.weekday() < 5:
            count += 1
        current += timedelta(days=1)
    return count


def _universe_skip(
    symbol: str,
    features: Features,
    tail: list[Bar],
    parameters: StrategyParameters,
) -> Skip | None:
    """7.2의 가격·유동성 필터. 상장 이력·데이터 보유는 피처 계산이 이미 걸렀다."""
    reference_close = tail[-1].raw_close
    if reference_close < parameters.min_close:
        return Skip(
            symbol,
            "PRICE_BELOW_MIN",
            f"종가 {reference_close:.2f} < {parameters.min_close:.0f}",
        )
    if features.dollar_volume_median20 < parameters.min_dollar_volume:
        return Skip(
            symbol,
            "LIQUIDITY_BELOW_MIN",
            f"20일 중앙값 달러거래대금 {features.dollar_volume_median20:,.0f}"
            f" < {parameters.min_dollar_volume:,.0f}",
        )
    return None


def _entry_gate(
    snapshot: PointInTimeSnapshot,
    symbol: str,
    features: Features,
    tail: list[Bar],
    parameters: StrategyParameters,
    require_earnings_calendar: bool,
) -> Skip | None:
    """7.4 진입 게이트. 처음 걸린 사유 하나만 남긴다."""
    close = tail[-1].adj_close
    if not (close > features.sma50 > features.sma200):
        return Skip(
            symbol,
            "SMA_NOT_ALIGNED",
            f"종가 {close:.2f} / SMA50 {features.sma50:.2f} / SMA200 {features.sma200:.2f}",
        )

    prior_high = max(bar.adj_high for bar in tail[:-1])
    if close <= prior_high:
        return Skip(
            symbol,
            "NO_BREAKOUT",
            f"종가 {close:.2f} <= 직전 {parameters.breakout_window}일 최고가"
            f" {prior_high:.2f}",
        )

    event_at = snapshot.next_earnings(symbol)
    if event_at is None:
        if require_earnings_calendar:
            return Skip(symbol, "EARNINGS_UNKNOWN", "다가오는 실적일을 모릅니다")
        return None
    sessions = weekdays_between(
        next_weekday(snapshot.as_of), date.fromisoformat(event_at[:10])
    )
    if sessions < parameters.earnings_min_sessions:
        return Skip(
            symbol,
            "EARNINGS_TOO_CLOSE",
            f"{event_at}까지 {sessions}거래일 < {parameters.earnings_min_sessions}거래일",
        )
    return None


def rank_candidates(
    snapshot: PointInTimeSnapshot,
    regime: Regime,
    *,
    policy: PolicyVersion = DEFAULT_PAPER_POLICY,
    index_names: tuple[str, ...] = DEFAULT_INDEXES,
    min_population: int | None = None,
    require_earnings_calendar: bool = True,
) -> Ranking:
    """`as_of` 종가 기준 상위 후보. RED에서는 후보를 만들지 않는다(18장)."""
    parameters = policy.parameters
    max_candidates = parameters.max_candidates
    if min_population is None:
        min_population = parameters.min_score_population
    max_new_entries = parameters.max_daily_entries(regime.state)
    members: set[str] = set()
    for index_name in index_names:
        members |= snapshot.members(index_name)

    skipped: list[Skip] = []
    if regime.state == "RED":
        return Ranking(
            as_of=snapshot.as_of,
            regime_state=regime.state,
            max_new_entries=0,
            score_population=0,
            candidates=(),
            skipped=(),
            halt_reason="REGIME_RED",
        )

    eligible: dict[str, Features] = {}
    # 돌파 판정과 신호 종가가 같은 꼬리를 쓰므로 종목당 한 번만 읽는다.
    tails: dict[str, list[Bar]] = {}
    for symbol in sorted(members):
        try:
            features = compute_features(snapshot, symbol, parameters)
        except FeatureUnavailable as error:
            skipped.append(Skip(symbol, error.reason, error.detail))
            continue
        tail = snapshot.bars(symbol, parameters.breakout_window + 1)
        skip = _universe_skip(symbol, features, tail, parameters)
        if skip is not None:
            skipped.append(skip)
            continue
        eligible[symbol] = features
        tails[symbol] = tail

    if len(eligible) < min_population:
        return Ranking(
            as_of=snapshot.as_of,
            regime_state=regime.state,
            max_new_entries=0,
            score_population=len(eligible),
            candidates=(),
            skipped=tuple(skipped),
            halt_reason="SCORE_POPULATION_TOO_SMALL",
        )

    z_rs = zscores({symbol: f.rs63_5 for symbol, f in eligible.items()})
    z_trend = zscores({symbol: f.trend_quality60 for symbol, f in eligible.items()})

    passed: list[tuple[float, str]] = []
    for symbol in sorted(eligible):
        skip = _entry_gate(
            snapshot,
            symbol,
            eligible[symbol],
            tails[symbol],
            parameters,
            require_earnings_calendar,
        )
        if skip is not None:
            skipped.append(skip)
            continue
        score = (
            parameters.score_weight_rs * z_rs[symbol]
            + parameters.score_weight_trend * z_trend[symbol]
        )
        passed.append((score, symbol))

    # 점수 내림차순, 같으면 종목 코드 순. 같은 입력에 같은 순서가 나와야 한다(3.1).
    passed.sort(key=lambda item: (-item[0], item[1]))

    candidates: list[Candidate] = []
    for index, (score, symbol) in enumerate(passed[:max_candidates], start=1):
        features = eligible[symbol]
        candidates.append(
            Candidate(
                symbol=symbol,
                rank=index,
                score=score,
                z_rs63_5=z_rs[symbol],
                z_trend_quality60=z_trend[symbol],
                reference_close=tails[symbol][-1].raw_close,
                atr14=features.atr14,
                features=features,
                reasons=(
                    "SMA_ALIGNED",
                    f"BREAKOUT_{parameters.breakout_window}D",
                    f"REGIME_{regime.state}",
                ),
            )
        )
    for score, symbol in passed[max_candidates:]:
        skipped.append(
            Skip(symbol, "BELOW_TOP_N", f"점수 {score:.4f}, 상위 {max_candidates}개 밖")
        )

    return Ranking(
        as_of=snapshot.as_of,
        regime_state=regime.state,
        max_new_entries=max_new_entries,
        score_population=len(eligible),
        candidates=tuple(candidates),
        skipped=tuple(skipped),
        halt_reason=None,
    )


def save_signals(
    connection: sqlite3.Connection,
    ranking: Ranking,
    source_version: str,
    snapshot_id: str | None = None,
) -> int:
    """후보를 `signals`에 남긴다. 같은 스냅샷을 다시 돌리면 같은 행으로 덮는다."""
    payload = [
        (
            candidate.signal_id(source_version),
            ranking.as_of,
            candidate.symbol,
            STRATEGY_VERSION,
            source_version,
            snapshot_id,
            candidate.features.feature_hash,
            ranking.regime_state,
            candidate.score,
            candidate.z_rs63_5,
            candidate.z_trend_quality60,
            candidate.rank,
            ranking.score_population,
            candidate.reference_close,
            candidate.atr14,
            ",".join(candidate.reasons),
        )
        for candidate in ranking.candidates
    ]
    with connection:
        connection.executemany(
            "INSERT OR REPLACE INTO signals"
            " (signal_id, trade_date, symbol, strategy_version, source_version,"
            "  snapshot_id, feature_hash, regime, score, z_rs63_5, z_trend_quality60,"
            "  rank, score_population, reference_close, atr14, reasons)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            payload,
        )
    return len(payload)
