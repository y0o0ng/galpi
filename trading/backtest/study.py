"""신호 연구. **전략이 아니라 신호 하나만 본다.**

`RS63,5`가 미래 초과수익을 예측하는가, 그리고 그 효과는 며칠짜리인가. 포트폴리오 슬롯·
수량·손절·비용을 전부 뺀 자리에서 묻는다. 그것들이 붙어 있으면 "신호가 없다"와 "신호는
있는데 규칙이 망친다"를 구별할 수 없다.

## 세 벤치마크가 서로 다른 것을 묻는다

|기준|묻는 것|
|---|---|
|raw|그냥 올랐나|
|SPY 대비|시장보다 나았나|
|그날 유니버스 평균 대비|**같은 날 같은 유니버스에서 골라낸 값이 있나**|

셋째가 신호의 값을 가장 좁게 잰다. raw가 양수인 것은 주식이 원래 오르기 때문일 수 있고,
SPY 대비 초과는 유니버스가 SPY보다 나은 종목 집합이라서일 수 있다.

**무작위 대비는 넷째가 아니라 셋째의 분포다.** 무작위 선택의 기댓값이 곧 유니버스
평균이므로 평균으로는 같은 것을 잰다. 값은 퍼짐에 있다 — 상위군의 초과수익이 무작위
표본 분포 밖인지가 "골라낸 것이 우연이 아닌가"의 답이다.

## 무작위 표본은 비교 대상과 같은 크기로 뽑는다

표본이 좁을수록 평균이 더 흩어진다. 5종목 라벨을 52종목 무작위 분포와 견주면 좁은 쪽이
공짜로 분포 밖처럼 보인다. 그래서 벌을 둘 든다 — `random_draws`는 D1 크기,
`random_top_draws`는 `top_n` 크기다. 크기는 `bucket_sizes`가 실제로 배정한 수를 그대로
쓴다. `count // buckets`로 어림하면 나머지가 있을 때 한 종목이 모자란다.

## 중첩을 숨기지 않는다

매일 표본을 뽑으면 +84세션 수익률이 83/84 겹친다. 관측이 4,600개처럼 보여도 독립인 것은
55개쯤이다. 그래서 K세션마다 뽑은 **비중첩 표본을 함께** 낸다. 두 값이 다르면 중첩이
만든 착시이고, 유의성 얘기는 비중첩 쪽으로만 한다.

## 지평마다 표본 창이 다르다

구간 끝에서는 +84를 잴 수 없어 짧은 지평보다 신호일이 적다. "긴 지평일수록 크다"가 신호가
아니라 그 지평만 다른 날짜 집합을 본 결과일 수 있으므로, 러너는 **모든 지평이 관측되는
날짜만** 담은 `Study`를 하나 더 든다. 종목 단위로 거르지는 않는다 — 그건 아래 이유로
생존편향이다.

## 폐지 종목을 빼지 않는다

거래가 멈춘 뒤의 forward 가격은 마지막 종가로 고정하고 그 건수를 센다. 빼면 그것이
정확히 생존편향이다 — 사라진 종목은 대개 나쁘게 끝났다.
"""

from __future__ import annotations

import statistics
from dataclasses import dataclass, field

# 상위군 라벨. `TOP5`는 전략이 실제로 사는 수라 십분위와 별도로 둔다.
TOP_LABEL = "TOP5"
ALL_LABEL = "ALL"


@dataclass(frozen=True)
class Forward:
    """한 날짜·한 종목의 관측."""

    symbol: str
    rs: float
    # 지평 → 수익률. 바가 모자라 잴 수 없으면 없는 키다.
    returns: dict[int, float]
    # 그 지평의 forward 가격이 마지막 거래 종가로 고정됐는가(폐지·정지).
    stale: frozenset[int]


def bucket_sizes(count: int, buckets: int) -> list[int]:
    """칸마다 몇 종목이 가는가. 나머지는 앞 칸부터 하나씩 더 간다.

    **무작위 표본이 이 함수를 같이 쓴다.** `count // buckets`로 어림하면 나머지가 있을 때
    D1보다 한 종목 작은 표본과 견주게 되고, 작은 표본은 원래 더 흩어지므로 비교가 D1에
    유리하게 기운다. 배정과 표본 크기가 같은 곳에서 나와야 어긋날 수 없다.
    """
    if buckets < 1:
        raise ValueError(f"칸 수는 1 이상이어야 합니다: {buckets}")
    base, extra = divmod(count, buckets)
    return [base + (1 if index < extra else 0) for index in range(buckets)]


def deciles(ordered: list[str], buckets: int) -> dict[str, int]:
    """RS 내림차순 목록을 칸으로 나눈다. **1이 최상위다.**

    나눠떨어지지 않는 나머지는 앞 칸부터 하나씩 더 간다. 100종목 10칸이면 정확히 10개씩,
    103종목이면 앞 세 칸이 11개다.
    """
    assigned: dict[str, int] = {}
    position = 0
    for index, size in enumerate(bucket_sizes(len(ordered), buckets)):
        for symbol in ordered[position : position + size]:
            assigned[symbol] = index + 1
        position += size
    return assigned


@dataclass
class Cell:
    """평균 하나를 위한 누적. 관측을 다 들고 있으면 2백만 개가 된다."""

    total: float = 0.0
    count: int = 0

    def add(self, value: float) -> None:
        self.total += value
        self.count += 1

    @property
    def mean(self) -> float | None:
        return self.total / self.count if self.count else None


@dataclass
class Study:
    """지평 × 버킷의 평균들. 날짜별 결과를 흘려 넣는다.

    `raw`·`vs_market`·`vs_universe`를 따로 든다 — 하나에서 다른 하나를 나중에 빼면 표본이
    다른 평균끼리 빼게 된다. 지평마다 잴 수 있는 관측 수가 다르기 때문이다.
    """

    horizons: tuple[int, ...]
    buckets: int = 10
    top_n: int = 5
    raw: dict[tuple[str, int], Cell] = field(default_factory=dict)
    vs_market: dict[tuple[str, int], Cell] = field(default_factory=dict)
    vs_universe: dict[tuple[str, int], Cell] = field(default_factory=dict)
    # 무작위 표본의 초과수익. `(시드, 지평)`마다 하나다.
    # **크기가 다른 두 벌을 따로 든다.** `random_draws`는 D1 크기, `random_top_draws`는
    # `top_n` 크기다. 5종목 표본은 52종목 표본보다 원래 훨씬 흩어지므로 한 벌로 두 라벨을
    # 견주면 좁은 쪽 라벨이 공짜로 유의해 보인다.
    random_draws: dict[tuple[int, int], Cell] = field(default_factory=dict)
    random_top_draws: dict[tuple[int, int], Cell] = field(default_factory=dict)
    stale_counts: dict[int, int] = field(default_factory=dict)
    dates: int = 0
    observations: int = 0

    def _cell(self, table: dict, key: tuple) -> Cell:
        if key not in table:
            table[key] = Cell()
        return table[key]

    def labels(self) -> list[str]:
        return [f"D{index + 1}" for index in range(self.buckets)] + [
            TOP_LABEL,
            ALL_LABEL,
        ]

    def add_date(
        self,
        rows: list[Forward],
        market: dict[int, float],
        *,
        random_picks: dict[int, list[Forward]] | None = None,
        random_top_picks: dict[int, list[Forward]] | None = None,
    ) -> None:
        """하루치를 넣는다. `rows`는 그날 자격을 갖춘 전체 유니버스다.

        **유니버스 평균은 그날 것만 쓴다.** 다른 날 평균과 섞으면 "같은 날 같은 집합에서
        골라낸 값"이라는 질문이 아니게 된다.
        """
        if not rows:
            return
        ordered = [row.symbol for row in sorted(rows, key=lambda r: (-r.rs, r.symbol))]
        bucket_of = deciles(ordered, self.buckets)
        top = set(ordered[: self.top_n])

        universe_mean: dict[int, float] = {}
        for horizon in self.horizons:
            values = [row.returns[horizon] for row in rows if horizon in row.returns]
            if values:
                universe_mean[horizon] = statistics.fmean(values)

        self.dates += 1
        for row in rows:
            self.observations += 1
            labels = [f"D{bucket_of[row.symbol]}", ALL_LABEL]
            if row.symbol in top:
                labels.append(TOP_LABEL)
            for horizon, value in row.returns.items():
                if horizon in row.stale:
                    self.stale_counts[horizon] = self.stale_counts.get(horizon, 0) + 1
                for label in labels:
                    self._cell(self.raw, (label, horizon)).add(value)
                    if horizon in market:
                        self._cell(self.vs_market, (label, horizon)).add(
                            value - market[horizon]
                        )
                    if horizon in universe_mean:
                        self._cell(self.vs_universe, (label, horizon)).add(
                            value - universe_mean[horizon]
                        )

        self._add_random(self.random_draws, random_picks, universe_mean)
        self._add_random(self.random_top_draws, random_top_picks, universe_mean)

    def _add_random(
        self,
        table: dict[tuple[int, int], Cell],
        picks_by_seed: dict[int, list[Forward]] | None,
        universe_mean: dict[int, float],
    ) -> None:
        for seed, picks in (picks_by_seed or {}).items():
            for horizon in self.horizons:
                values = [
                    picks_row.returns[horizon]
                    for picks_row in picks
                    if horizon in picks_row.returns
                ]
                if values and horizon in universe_mean:
                    self._cell(table, (seed, horizon)).add(
                        statistics.fmean(values) - universe_mean[horizon]
                    )


@dataclass(frozen=True)
class RandomStats:
    """한 지평에서 무작위 시드들이 낸 초과수익의 분포."""

    count: int
    minimum: float
    median: float
    maximum: float
    mean: float
    # 시드가 하나뿐이면 흩어짐을 낼 수 없다.
    stdev: float | None
    values: tuple[float, ...]

    def beaten_by(self, actual: float | None) -> int:
        """실제 값이 이긴 무작위 표본 수. **`N/N`이어야 분포 밖이다.**"""
        if actual is None:
            return 0
        return sum(1 for value in self.values if actual > value)


def random_stats(study: Study, horizon: int, *, top: bool = False) -> RandomStats | None:
    """무작위 시드들의 초과수익 분포. 시드가 없으면 None이다.

    `top=True`면 `top_n` 크기로 뽑은 벌을 본다 — TOP5는 TOP5 크기 분포와만 견준다.
    """
    table = study.random_top_draws if top else study.random_draws
    values = sorted(
        cell.mean
        for (_, other), cell in table.items()
        if other == horizon and cell.mean is not None
    )
    if not values:
        return None
    return RandomStats(
        count=len(values),
        minimum=values[0],
        median=statistics.median(values),
        maximum=values[-1],
        mean=statistics.fmean(values),
        stdev=statistics.stdev(values) if len(values) > 1 else None,
        values=tuple(values),
    )


def random_spread(study: Study, horizon: int) -> tuple[float, float, float] | None:
    """D1 크기 무작위 표본의 `(최소, 중앙, 최대)`. 시드가 없으면 None이다."""
    stats = random_stats(study, horizon)
    if stats is None:
        return None
    return stats.minimum, stats.median, stats.maximum
