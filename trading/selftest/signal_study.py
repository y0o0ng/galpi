"""RS63,5가 미래 초과수익을 예측하는가, 그 효과는 며칠짜리인가.

**백테스트가 아니다.** `BacktestConfig`를 만들지 않고 포트폴리오 슬롯·수량·손절·비용을
전부 뺀 자리에서 신호 하나만 본다. 그것들이 붙어 있으면 "신호가 없다"와 "신호는 있는데
규칙이 망친다"를 구별할 수 없다. 코어도 아니다 — 규칙을 정하는 것이 아니라 재는 것이다.

## 미리 정한 판정 기준

나중에 골대를 옮기지 않으려고 적어둔다.

1. D1 > D10이고 십분위가 대략 단조로운가
2. D1의 **유니버스 평균 대비** 초과수익이 무작위 표본 분포 밖인가
3. 그 초과수익이 지평 K에 따라 어떻게 감쇠하는가 — 이것이 "며칠짜리인가"의 답이다

## 무엇을 남기고 무엇을 뺐나

- 남김: 7.2 유니버스 필터(가격·유동성·이력). 유니버스 정의이지 신호가 아니고, 없으면
  저가·저유동성 종목이 십분위를 지배한다.
- 뺌: 진입 게이트·수량·손절·비용·슬롯·레짐 게이팅. 레짐은 라벨로만 쓴다.
- forward 수익률은 **신호일 종가 → t+K 종가**이고 배당 포함(`adj_close`)이다. 전략의
  실제 진입은 다음 날이지만 여기서는 신호 자체를 재므로 신호일 기준으로 둔다. RS63,5가
  이미 최근 5세션을 건너뛰므로 룩어헤드는 없다.

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
from backtest.regime import classify_market_regime  # noqa: E402
from backtest.study import (  # noqa: E402
    ALL_LABEL,
    TOP_LABEL,
    Forward,
    Study,
    random_spread,
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


def run_universe(connection, name: str) -> dict:
    index_names = UNIVERSES[name]
    cache = BarCache(connection, SOURCE_VERSION)
    calendar = [
        row["trade_date"]
        for row in connection.execute(
            "SELECT trade_date FROM bars_daily"
            " WHERE symbol = ? AND source_version = ? AND trade_date >= ?"
            " ORDER BY trade_date",
            (REFERENCE_SYMBOL, SOURCE_VERSION, BARS_START),
        )
    ]
    warmup = PARAMETERS.min_history_sessions
    overall = Study(HORIZONS)
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

        # **무작위 표본은 D1과 같은 크기여야 한다.** 5종목 표본은 10종목보다 원래 더
        # 흩어지므로, 크기가 다르면 분포 비교가 D1에 유리하게 기운다.
        size = max(1, len(rows) // overall.buckets)
        picks = {
            seed: sorted(rows, key=lambda r: random_score(seed, as_of, r.symbol))[:size]
            for seed in RANDOM_SEEDS
        }
        overall.add_date(rows, market, random_picks=picks)
        by_year.setdefault(as_of[:4], Study(HORIZONS)).add_date(rows, market)
        by_regime.setdefault(regime, Study(HORIZONS)).add_date(rows, market)
        for horizon, studies in phases.items():
            studies[(index - warmup) % horizon].add_date(rows, market)

        if (index - warmup) % 500 == 0:
            print(f"  {as_of} · 자격 {len(rows)}종목 · 누적 관측 {overall.observations:,}")

    return {
        "name": name,
        "overall": overall,
        "phases": phases,
        "by_year": by_year,
        "by_regime": by_regime,
        "window": (calendar[warmup], calendar[-1]),
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
              " 그 흩어짐이 곧 추정의 불확실성이다. 매일 표본의 값은 그 위상들의 평균이다.",
              "",
              "|지평|매일|위상 최소|위상 중앙|위상 최대|위상당 날짜|",
              "|---|---|---|---|---|---|"]
    for horizon in HORIZONS:
        studies: list[Study] = result["phases"][horizon]
        values = sorted(
            value
            for value in (_mean(s.vs_universe, "D1", horizon) for s in studies)
            if value is not None
        )
        if not values:
            continue
        lines.append(
            f"|+{horizon}|{_pct(_mean(overall.vs_universe, 'D1', horizon))}"
            f"|{_pct(values[0])}|{_pct(statistics.median(values))}|{_pct(values[-1])}"
            f"|{studies[0].dates:,}|"
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
    arguments = parser.parse_args()
    names = list(UNIVERSES) if arguments.universe == "both" else [arguments.universe]
    connection = store.connect()
    lines = [
        "# RS63,5 신호 연구",
        "",
        "**포트폴리오 없이 신호만 본다.** 슬롯·수량·손절·비용을 뺐고 7.2 유니버스 필터와"
        " 레짐 라벨만 남겼다. 판정 기준은 러너 docstring에 미리 적어뒀다.",
        "",
    ]
    try:
        for name in names:
            print(f"# {name}")
            lines += render(run_universe(connection, name))
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
