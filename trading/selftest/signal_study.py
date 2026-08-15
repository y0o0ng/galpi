"""RS63,5가 미래 초과수익을 예측하는가, 그 효과는 며칠짜리인가.

**백테스트가 아니다.** `BacktestConfig`를 만들지 않고 포트폴리오 슬롯·수량·손절·비용을
전부 뺀 자리에서 신호 하나만 본다. 그것들이 붙어 있으면 "신호가 없다"와 "신호는 있는데
규칙이 망친다"를 구별할 수 없다. 코어도 아니다 — 규칙을 정하는 것이 아니라 재는 것이다.

## 미리 정한 판정 기준

나중에 골대를 옮기지 않으려고 적어둔다.

1. D1 > D10이고 십분위가 대략 단조로운가
2. D1의 **유니버스 평균 대비** 초과수익이 무작위 표본 분포 밖인가
3. 그 초과수익이 지평 K에 따라 어떻게 감쇠하는가 — 이것이 "며칠짜리인가"의 답이다

## 전략이 사는 것은 D1이 아니라 TOP5다

십분위는 유니버스 크기에 종속된다. NDX100은 D1이 10종목이고 합집합은 52종목이라 같은
"상위 10%"가 전혀 다른 것을 뜻한다. 그래서 무작위 표본을 **두 벌** 뽑는다 — D1 크기와
`top_n` 크기다. 같은 시드 집합, 같은 eligible PIT 유니버스에서 뽑되 크기만 비교 대상과
정확히 맞춘다. 5종목 표본은 52종목 표본보다 원래 훨씬 흩어지므로, 크기를 안 맞추면 좁은
쪽 라벨이 공짜로 유의해 보인다.

## 지평마다 표본 창이 다르다

구간 끝에서는 +84를 잴 수 없어 +5보다 신호일이 적다. "+84가 가장 크다"가 신호가 아니라
그 지평만 다른 날짜 집합을 봤기 때문일 수 있다. 그래서 **모든 지평을 관측할 수 있는
날짜만**으로 감쇠 곡선을 한 번 더 낸다. 종목 단위로 거르지는 않는다 — 폐지 종목이 빠지면
그것이 생존편향이다.

## 무엇을 남기고 무엇을 뺐나

- 남김: 7.2 유니버스 필터(가격·유동성·이력). 유니버스 정의이지 신호가 아니고, 없으면
  저가·저유동성 종목이 십분위를 지배한다.
- 뺌: 진입 게이트·수량·손절·비용·슬롯·레짐 게이팅. 레짐은 라벨로만 쓴다.
- forward 수익률은 **신호일 종가 → t+K 종가**이고 배당 포함(`adj_close`)이다. 전략의
  실제 진입은 다음 날이지만 여기서는 신호 자체를 재므로 신호일 기준으로 둔다. RS63,5가
  이미 최근 5세션을 건너뛰므로 룩어헤드는 없다.

## 홀드아웃을 보지 않는다

달력 자체를 `HOLDOUT_START` 전에서 자른다(`backtest/holdout.py`). 신호일만 거르면
`t+84`가 홀드아웃 안의 종가를 읽으므로 같은 누수다. `--consume-holdout`은 그 사실을
보고서에 `HOLDOUT_CONSUMED = true`로 남긴다.

    python3 selftest/signal_study.py NDX100
    python3 selftest/signal_study.py all
"""

from __future__ import annotations

import argparse
import statistics
import sys
from pathlib import Path

TRADING_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TRADING_ROOT))

from backtest import store  # noqa: E402
from backtest.candidates import random_score  # noqa: E402
from backtest.data import BarCache, PointInTimeSnapshot  # noqa: E402
from backtest.features import FeatureUnavailable, compute_features  # noqa: E402
from backtest.holdout import (  # noqa: E402
    assert_no_holdout,
    holdout_metadata,
    research_sessions,
)
from backtest.regime import classify_market_regime  # noqa: E402
from backtest.study import (  # noqa: E402
    ALL_LABEL,
    TOP_LABEL,
    Forward,
    Study,
    bucket_sizes,
    random_spread,
    random_stats,
)
from core.jt import MOMENTUM_PARAMETERS  # noqa: E402
from selftest.real_run import (  # noqa: E402
    BARS_START,
    REFERENCE_SYMBOL,
    RUNS_DIR,
    SOURCE_VERSION,
)

EXPERIMENT = "signal-rs63"
HORIZONS = (5, 10, 21, 42, 63, 84)
RANDOM_SEEDS = tuple(range(20))
UNIVERSES = {"NDX100": ("NDX100",), "ALL": ("SP500", "NDX100")}

# `MOMENTUM_PARAMETERS`를 쓰는 이유는 `green_max_vol`이 0.20이라 레짐 라벨의 변동성 축이
# J/K 실험과 같게 갈리기 때문이다. RS·유니버스 필터 값은 기준선과 동일하다.
PARAMETERS = MOMENTUM_PARAMETERS


def _eligible(snapshot, symbol: str):
    """7.2를 통과한 종목의 피처. 통과 못 하면 None이다."""
    try:
        features = compute_features(snapshot, symbol, PARAMETERS)
    except FeatureUnavailable:
        return None
    bars = snapshot.bars(symbol, 1)
    if not bars:
        return None
    if bars[-1].raw_close < PARAMETERS.min_close:
        return None
    if features.dollar_volume_median20 < PARAMETERS.min_dollar_volume:
        return None
    return features


def _forward(cache: BarCache, symbol: str, as_of: str, calendar, index: int):
    """지평별 forward 수익률과, 그 가격이 마지막 거래 종가로 고정됐는지."""
    start = cache.bars(symbol, as_of, 1)
    if not start or start[-1].adj_close <= 0:
        return {}, frozenset()
    base = start[-1].adj_close
    returns: dict[int, float] = {}
    stale: set[int] = set()
    for horizon in HORIZONS:
        target = index + horizon
        if target >= len(calendar):
            continue
        target_date = calendar[target]
        bars = cache.bars(symbol, target_date, 1)
        if not bars or bars[-1].adj_close <= 0:
            continue
        returns[horizon] = bars[-1].adj_close / base - 1
        if bars[-1].trade_date != target_date:
            stale.add(horizon)
    return returns, frozenset(stale)


def research_calendar(connection, *, consume_holdout: bool = False) -> list[str]:
    """이 실행이 볼 수 있는 세션. **달력을 자르는 것이 홀드아웃 차단이다.**

    신호일도 forward 목표일도 전부 이 목록에서 나오므로, 여기서 잘리면 홀드아웃 안의
    종가는 조회 자체가 일어나지 않는다. 신호일만 걸렀다면 `t+84`가 그대로 넘어간다.
    """
    calendar = research_sessions(
        [
            row["trade_date"]
            for row in connection.execute(
                "SELECT trade_date FROM bars_daily"
                " WHERE symbol = ? AND source_version = ? AND trade_date >= ?"
                " ORDER BY trade_date",
                (REFERENCE_SYMBOL, SOURCE_VERSION, BARS_START),
            )
        ],
        consume_holdout=consume_holdout,
    )
    assert_no_holdout(calendar, consumed=consume_holdout)
    return calendar


def run_universe(connection, name: str, *, consume_holdout: bool = False) -> dict:
    index_names = UNIVERSES[name]
    cache = BarCache(connection, SOURCE_VERSION)
    calendar = research_calendar(connection, consume_holdout=consume_holdout)
    warmup = PARAMETERS.min_history_sessions
    overall = Study(HORIZONS)
    # **모든 지평을 관측할 수 있는 날짜만 담는다.** 감쇠 곡선이 지평마다 다른 날짜 집합을
    # 본 결과인지 아닌지를 가른다.
    longest = max(HORIZONS)
    common = Study(HORIZONS)
    # **비중첩 표본을 위상마다 따로 든다.** 위상 하나만 뽑으면 그것도 표본 하나일 뿐이라
    # 매일 표본과 다른 값이 나와도 중첩 탓인지 그 위상이 운이 나빴는지 모른다. K개 위상의
    # 평균이 흩어진 정도가 곧 이 추정이 얼마나 흔들리는가다.
    phases = {
        horizon: [Study((horizon,)) for _ in range(horizon)] for horizon in HORIZONS
    }
    by_year: dict[str, Study] = {}
    by_regime: dict[str, Study] = {}

    for index in range(warmup, len(calendar)):
        as_of = calendar[index]
        snapshot = PointInTimeSnapshot(connection, as_of, SOURCE_VERSION, cache=cache)
        members: set[str] = set()
        for index_name in index_names:
            members |= snapshot.members(index_name)

        rows: list[Forward] = []
        for symbol in sorted(members):
            features = _eligible(snapshot, symbol)
            if features is None:
                continue
            returns, stale = _forward(cache, symbol, as_of, calendar, index)
            if not returns:
                continue
            rows.append(Forward(symbol, features.rs63_5, returns, stale))
        if len(rows) < PARAMETERS.min_score_population:
            continue

        market, _ = _forward(cache, REFERENCE_SYMBOL, as_of, calendar, index)
        try:
            regime = classify_market_regime(snapshot, PARAMETERS).state
        except FeatureUnavailable:
            regime = "UNKNOWN"

        # **무작위 표본은 비교 대상과 정확히 같은 크기여야 한다.** 크기가 다르면 좁은 쪽이
        # 원래 더 흩어지므로 분포 비교가 기운다. D1 크기는 `bucket_sizes`가 실제로 배정한
        # 수를 그대로 쓴다 — `len(rows) // buckets`는 나머지가 있을 때 한 종목 모자란다.
        sizes = {
            "d1": bucket_sizes(len(rows), overall.buckets)[0],
            "top": min(overall.top_n, len(rows)),
        }
        # 시드마다 순열을 한 번만 만들고 두 크기가 그 앞부분을 나눠 쓴다. 같은 시드의 두
        # 표본이 겹치는 것은 의도다 — 묻는 것은 "이 크기의 무작위가 얼마나 흩어지나"이지
        # 두 표본의 독립성이 아니다.
        ordered_by_seed = {
            seed: sorted(rows, key=lambda r: random_score(seed, as_of, r.symbol))
            for seed in RANDOM_SEEDS
        }
        picks = {seed: order[: sizes["d1"]] for seed, order in ordered_by_seed.items()}
        top_picks = {
            seed: order[: sizes["top"]] for seed, order in ordered_by_seed.items()
        }
        overall.add_date(
            rows, market, random_picks=picks, random_top_picks=top_picks
        )
        if index + longest < len(calendar):
            common.add_date(rows, market)
        by_year.setdefault(as_of[:4], Study(HORIZONS)).add_date(rows, market)
        by_regime.setdefault(regime, Study(HORIZONS)).add_date(rows, market)
        for horizon, studies in phases.items():
            studies[(index - warmup) % horizon].add_date(rows, market)

        if (index - warmup) % 500 == 0:
            print(f"  {as_of} · 자격 {len(rows)}종목 · 누적 관측 {overall.observations:,}")

    return {
        "name": name,
        "overall": overall,
        "common": common,
        "phases": phases,
        "by_year": by_year,
        "by_regime": by_regime,
        "window": (calendar[warmup], calendar[-1]),
        "consume_holdout": consume_holdout,
    }


def _pct(value: float | None) -> str:
    return "—" if value is None else f"{value * 100:+.2f}%"


def _mean(table: dict, label: str, horizon: int) -> float | None:
    cell = table.get((label, horizon))
    return cell.mean if cell else None


def render(result: dict) -> list[str]:
    overall: Study = result["overall"]
    name = result["name"]
    start, end = result["window"]
    lines = [
        f"## {name}",
        "",
        f"구간 {start} ~ {end} · 날짜 {overall.dates:,}개 · 관측 {overall.observations:,}개",
        "",
        "### 유니버스 평균 대비 초과수익 (핵심)",
        "",
        "|버킷|" + "|".join(f"+{h}" for h in HORIZONS) + "|",
        "|---|" + "---|" * len(HORIZONS),
    ]
    for label in overall.labels():
        if label == ALL_LABEL:
            continue
        cells = [_pct(_mean(overall.vs_universe, label, h)) for h in HORIZONS]
        mark = f"**{label}**" if label in ("D1", TOP_LABEL) else label
        lines.append(f"|{mark}|" + "|".join(cells) + "|")

    lines += ["", "### D1 대 무작위 20표본 (같은 크기로 뽑았다)", "",
              "무작위 선택의 기댓값이 곧 유니버스 평균이라 이 표는 **퍼짐**을 보는 것이다."
              " D1이 분포 밖이어야 골라낸 것이 우연이 아니다.", "",
              "|지평|무작위 최소|중앙|최대|**D1**|", "|---|---|---|---|---|"]
    for horizon in HORIZONS:
        spread = random_spread(overall, horizon)
        low, mid, high = spread if spread else (None, None, None)
        lines.append(
            f"|+{horizon}|{_pct(low)}|{_pct(mid)}|{_pct(high)}"
            f"|**{_pct(_mean(overall.vs_universe, 'D1', horizon))}**|"
        )

    lines += ["", f"### {TOP_LABEL} 대 같은 크기 무작위 {len(RANDOM_SEEDS)}표본", "",
              f"**전략이 실제로 사는 것은 D1이 아니라 상위 {overall.top_n}종목이다.** 그래서"
              f" 무작위도 {overall.top_n}종목으로 뽑는다 — 좁은 표본은 원래 더 흩어지므로"
              " D1 크기 분포와 견주면 TOP5가 공짜로 유의해 보인다. `이김`이 20/20이어야"
              " 분포 밖이다.", "",
              "|지평|최소|중앙|최대|평균|표준편차|**TOP5**|이김|",
              "|---|---|---|---|---|---|---|---|"]
    for horizon in HORIZONS:
        stats = random_stats(overall, horizon, top=True)
        actual = _mean(overall.vs_universe, TOP_LABEL, horizon)
        if stats is None:
            continue
        deviation = "—" if stats.stdev is None else f"{stats.stdev * 100:.2f}%"
        lines.append(
            f"|+{horizon}|{_pct(stats.minimum)}|{_pct(stats.median)}"
            f"|{_pct(stats.maximum)}|{_pct(stats.mean)}|{deviation}"
            f"|**{_pct(actual)}**|{stats.beaten_by(actual)}/{stats.count}|"
        )

    lines += ["", "### raw · SPY 대비 (D1 / TOP5 / 유니버스 전체)", "",
              "|지평|D1 raw|D1 vs SPY|TOP5 raw|TOP5 vs SPY|전체 raw|",
              "|---|---|---|---|---|---|"]
    for horizon in HORIZONS:
        lines.append(
            f"|+{horizon}|{_pct(_mean(overall.raw, 'D1', horizon))}"
            f"|{_pct(_mean(overall.vs_market, 'D1', horizon))}"
            f"|{_pct(_mean(overall.raw, TOP_LABEL, horizon))}"
            f"|{_pct(_mean(overall.vs_market, TOP_LABEL, horizon))}"
            f"|{_pct(_mean(overall.raw, ALL_LABEL, horizon))}|"
        )

    lines += ["", "### 추정이 얼마나 흔들리는가 (비중첩 위상 전부)", "",
              "매일 뽑으면 +84세션 수익률이 83/84 겹쳐서, 관측이 많아 보여도 독립인 것은"
              " 지평당 날짜 수를 K로 나눈 만큼이다. **K개 위상을 각각 따로 평균 내면**"
              " 그 흩어짐이 곧 추정의 불확실성이다. 매일 표본의 값은 그 위상들의 평균이다."
              " **+63·+84의 매일 관측 수를 독립 표본 수로 읽지 않는다.**",
              ""]
    for label in ("D1", TOP_LABEL):
        lines += [f"**{label}**", "",
                  "|지평|매일|위상 최소|위상 중앙|위상 최대|위상당 날짜|위상당 관측|",
                  "|---|---|---|---|---|---|---|"]
        for horizon in HORIZONS:
            studies: list[Study] = result["phases"][horizon]
            values = sorted(
                value
                for value in (_mean(s.vs_universe, label, horizon) for s in studies)
                if value is not None
            )
            if not values:
                continue
            counts = [
                s.vs_universe[(label, horizon)].count
                for s in studies
                if (label, horizon) in s.vs_universe
            ]
            observations = round(statistics.fmean(counts)) if counts else 0
            lines.append(
                f"|+{horizon}|{_pct(_mean(overall.vs_universe, label, horizon))}"
                f"|{_pct(values[0])}|{_pct(statistics.median(values))}"
                f"|{_pct(values[-1])}|{studies[0].dates:,}|{observations:,}|"
            )
        lines.append("")

    common: Study = result["common"]
    lines += ["### 모든 지평이 같은 날짜를 본다면 (common anchors)", "",
              "위 표들은 지평마다 신호일 집합이 다르다 — 구간 끝에서는 +84를 잴 수 없어"
              " +5보다 날짜가 적다. 여기서는 **+84까지 전부 관측되는 날짜만** 쓴다."
              " 감쇠 곡선의 모양이 여기서도 같으면 그것은 표본 창 차이가 아니다.", "",
              f"날짜 {common.dates:,}개 (전체 {overall.dates:,}개 중)", "",
              "|지평|D1|**TOP5**|",
              "|---|---|---|"]
    for horizon in HORIZONS:
        lines.append(
            f"|+{horizon}|{_pct(_mean(common.vs_universe, 'D1', horizon))}"
            f"|**{_pct(_mean(common.vs_universe, TOP_LABEL, horizon))}**|"
        )

    for title, table in (("연도별", result["by_year"]), ("시장 상태별", result["by_regime"])):
        lines += ["", f"### {title} D1 초과수익", "",
                  "|구간|" + "|".join(f"+{h}" for h in HORIZONS) + "|날짜|",
                  "|---|" + "---|" * (len(HORIZONS) + 1)]
        for key in sorted(table):
            study = table[key]
            cells = [_pct(_mean(study.vs_universe, "D1", h)) for h in HORIZONS]
            lines.append(f"|{key}|" + "|".join(cells) + f"|{study.dates:,}|")

    stale = ", ".join(
        f"+{h} {overall.stale_counts.get(h, 0):,}" for h in HORIZONS
    )
    lines += ["", f"폐지·정지로 마지막 종가를 쓴 관측: {stale}", ""]
    return lines


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("universe", choices=[*UNIVERSES, "both"])
    parser.add_argument(
        "--consume-holdout",
        action="store_true",
        help="홀드아웃까지 본다. 보고서에 HOLDOUT_CONSUMED = true가 남는다.",
    )
    arguments = parser.parse_args()
    names = list(UNIVERSES) if arguments.universe == "both" else [arguments.universe]
    connection = store.connect()
    metadata = holdout_metadata(consumed=arguments.consume_holdout)
    lines = [
        "# RS63,5 신호 연구",
        "",
        "**포트폴리오 없이 신호만 본다.** 슬롯·수량·손절·비용을 뺐고 7.2 유니버스 필터와"
        " 레짐 라벨만 남겼다. 판정 기준은 러너 docstring에 미리 적어뒀다.",
        "",
        f"`HOLDOUT_START = {metadata['HOLDOUT_START']}` ·"
        f" `HOLDOUT_CONSUMED = {str(metadata['HOLDOUT_CONSUMED']).lower()}`"
        + ("" if metadata["HOLDOUT_CONSUMED"]
           else " — 달력을 그 전에서 잘라 신호일도 forward 목표일도 홀드아웃에 닿지 않는다."),
        "",
    ]
    try:
        for name in names:
            print(f"# {name}")
            lines += render(
                run_universe(
                    connection, name, consume_holdout=arguments.consume_holdout
                )
            )
    finally:
        connection.close()
    out = RUNS_DIR / EXPERIMENT
    out.mkdir(parents=True, exist_ok=True)
    path = out / "forward-returns.md"
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"\n보고서: {RUNS_DIR.name}/{EXPERIMENT}/{path.name}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
