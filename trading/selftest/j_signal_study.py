"""형성기간 J를 바꾸면 극단 상위 TOP5의 미래 초과수익 정보가 어떤 구조를 보이는가.

PR #9(`runs/signal-rs63/`)는 J=63·skip=5 하나를 전제로 신호를 쟀다. 이 연구는 **skip=5를
고정한 채 J만 사다리로 바꿔** 그 구조를 본다. 포트폴리오 백테스트가 아니고 **"최적 J
찾기"도 아니다.**

## 왜 지금 이 질문인가

- **PR #9**: RS63,5 극단 상위 TOP5에 미래 초과수익과 연관된 정보가 관찰됐다. ALL에서는
  +42 이후에 분명했고 +84까지 평균이 유지됐지만 비중첩 위상에서는 부호 뒤집힘도 있었다.
- **PR #10**: J=63·skip=5를 고정하고 K=42/63/84를 견줬다. 긴 신호 수명이 포트폴리오
  개선으로 번역되지 않았고 K42가 기준선으로 남았다.
- **PR #11**: 5슬롯 용량이 원인인지 봤다. 점유는 실재했지만 풀어도 회복되지 않았고
  churn·랭크 집중도 진단도 설명하지 못했다. 그 축을 닫고 신호 층으로 내려온다.

## 묻는 것

> 같은 skip=5 아래에서 형성기간 J를 바꾸면 극단 상위 TOP5의 미래 초과수익 정보가
> 어떤 구조를 보이는가.

**"가장 높은 J 하나"를 고르는 것이 목적이 아니다.** 넓은 plateau가 있는지, 짧은·중간·긴
형성기간 사이에 구조적 차이가 있는지를 본다.

## 사다리는 여기서 끝난다

    JS = (21, 42, 63, 126, 189)   ·   SKIP = 5

결과를 보고 J84·J105·J147·J168·J252를 덧붙이지 않는다. **J252는 이번 PR에서 제외한다** —
`min_history_sessions`(252) 경계를 같이 건드릴 수 있어 "J만 바꾼 실험"이 흐려진다. J189가
경계에서 계속 우세해도 더 긴 J는 별도 질문으로 남긴다.

## 사전 고정한 primary endpoint

    ALL 유니버스 · TOP5 · +42세션 · 유니버스 평균 대비 초과수익

하나로 못박는 이유는, 이것을 안 정하면 J × 지평 표에서 예쁜 칸을 사후에 고르기 쉽기
때문이다. +42가 가장 높아야 좋은 J라는 뜻이 아니다. 나머지 지평은 보조 진단이다.
**결과를 본 뒤 primary를 바꾸지 않는다.**

## 기준선 보존 규칙 (결과 전에 못박는다)

> **J63이 plateau 안에 포함되어 있고 다른 J가 반복적·구조적으로 우월하다는 증거가
> 없다면 J63을 유지한다.** 제일 높은 숫자만으로 기준선을 교체하지 않는다.

## 사전 판정 기준 A~J

- **A.** ALL TOP5 +42에서 J에 따른 구조적 차이가 있는가
- **B.** 현재 J63보다 다른 J가 명확하고 반복적으로 우세한가
- **C.** 그 우위가 같은 크기 무작위 분포 대비에서도 유지되는가
- **D.** NDX100에서도 방향이 대체로 재현되는가
- **E.** 보조 지평에서 완전히 반대가 되는 isolated spike가 아닌가
- **F.** common-anchor 결과에서도 구조가 유지되는가
- **G.** 비중첩 위상 결과가 특정 몇 위상에만 의존하지 않는가
- **H.** 연도별 결과가 한두 특수 연도에 과도하게 의존하지 않는가
- **I.** J63이 broad plateau 안에 포함되는가
- **J.** J189가 경계에서 계속 개선돼 더 긴 J를 별도로 연구할 이유가 생기는가

## 사전 해석 규칙

|경우|관측|읽는 법|
|---|---|---|
|1|J42/63/126이 서로 비슷하고 robustness도 비슷|형성기간에 넓은 plateau. **J63 유지**|
|2|J21/42가 반복적으로 우세|shorter-J family가 challenger. 대표 하나만 고른다|
|3|J126/189가 구조적으로 우세|longer-J family가 challenger. J252는 추가하지 않고 별도 질문으로|
|4|순위가 지평·연도·위상·유니버스마다 뒤집힘|J 효과를 못 믿는다. **J63 유지**, 추가 튜닝 금지|
|5|어떤 J도 무작위 대비 안정적 우세가 없음|신호 근거 자체가 약하다는 경고. **J63 유지**|

## 이 결과는 out-of-sample이 아니다

이 개발 구간은 여러 연구에서 반복 관찰됐다. 결과를 "새로운 out-of-sample 증거"라고
부르지 않고 **model-selection / development-sample research**라고 적는다. 진짜 경제적
검증은 앞으로의 paper·live shadow 데이터의 몫이다. 홀드아웃은 `backtest/holdout.py`가
달력 자체를 잘라 신호일도 forward 목표일도 넘지 못하게 한다.

    python3 selftest/j_signal_study.py ALL
    python3 selftest/j_signal_study.py report
"""

from __future__ import annotations

import argparse
import json
import statistics
import sys
from pathlib import Path

TRADING_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TRADING_ROOT))

from backtest import store  # noqa: E402
from backtest.candidates import random_score  # noqa: E402
from backtest.control import RandomStats  # noqa: E402
from backtest.data import BarCache, PointInTimeSnapshot  # noqa: E402
from backtest.features import (  # noqa: E402
    FeatureUnavailable,
    compute_features,
    relative_strength,
)
from backtest.regime import classify_market_regime  # noqa: E402
from backtest.study import TOP_LABEL, Forward, Study, bucket_sizes  # noqa: E402
from core.jt import MOMENTUM_PARAMETERS  # noqa: E402
from selftest.real_run import (  # noqa: E402
    REFERENCE_SYMBOL,
    RUNS_DIR,
    SOURCE_VERSION,
)
from selftest.signal_study import research_calendar  # noqa: E402

EXPERIMENT = "signal-j-study"

# **사다리는 여기서 끝난다.** 결과를 보고 값을 더하지 않는다(테스트가 잠근다).
JS = (21, 42, 63, 126, 189)
SKIP = 5
BASELINE_J = 63

HORIZONS = (5, 10, 21, 42, 63, 84)
# 사전 고정한 primary endpoint. ALL · TOP5 · +42 · 유니버스 평균 대비.
PRIMARY_UNIVERSE = "ALL"
PRIMARY_HORIZON = 42
# 위상 분석은 이 셋만 낸다. 여섯 지평 전부 내면 J 다섯 벌이라 누적이 다섯 배가 된다.
PHASE_HORIZONS = (21, 42, 84)
RANDOM_SEEDS = tuple(range(20))
UNIVERSES = {"NDX100": ("NDX100",), "ALL": ("SP500", "NDX100")}

PARAMETERS = MOMENTUM_PARAMETERS


def formation_strengths(
    snapshot, symbol: str, lookbacks=JS, skip: int = SKIP
) -> dict[int, float]:
    """J별 `RS(J, skip)`. **production `relative_strength`를 그대로 부른다.**

    `compute_features`를 J마다 다섯 번 부르면 ATR·SMA·변동성까지 다섯 번 다시 계산한다.
    여기서는 같은 바 배열에 같은 함수를 J만 바꿔 적용한다 — 수식이 갈릴 자리가 없고,
    J=63 결과가 `features.rs63_5`와 같다는 것을 테스트가 값으로 확인한다.
    """
    history = PARAMETERS.min_history_sessions
    bars = snapshot.bars(symbol, history)
    reference = snapshot.bars(snapshot.reference_symbol, history)
    adjusted = [bar.adj_close for bar in bars]
    reference_adjusted = [bar.adj_close for bar in reference]
    return {
        lookback: relative_strength(adjusted, reference_adjusted, lookback, skip)
        for lookback in lookbacks
    }


def _eligible(snapshot, symbol: str):
    """7.2를 통과한 종목의 피처. PR #9와 같은 판정이다.

    **자격은 J와 무관하다.** `compute_features`가 보는 것은 이력·정지·달력·가격·유동성
    뿐이고 J는 그 안에 없다. 그래서 J별로 표본 집합이 갈리지 않는다.
    """
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
    """PR #9와 같은 정의. 지평별 수익률과, 그 가격이 마지막 거래 종가로 고정됐는지."""
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
    calendar = research_calendar(connection)
    warmup = PARAMETERS.min_history_sessions
    longest = max(HORIZONS)

    overall = {j: Study(HORIZONS) for j in JS}
    common = {j: Study(HORIZONS) for j in JS}
    phases = {
        j: {h: [Study((h,)) for _ in range(h)] for h in PHASE_HORIZONS} for j in JS
    }
    # 연도·레짐은 primary 지평 하나만 본다. 여섯 지평을 다 담으면 누적이 여섯 배가 된다.
    by_year = {j: {} for j in JS}
    by_regime = {j: {} for j in JS}
    # **무작위 대조군은 J와 무관하다.** 자격 유니버스와 날짜가 같으면 같은 시드가 같은
    # 종목을 뽑는다. 그래서 J마다 따로 만들지 않고 공통 baseline 하나로 둔다.
    control = Study(HORIZONS)

    churn = {j: {"overlaps": [], "runs": {}, "lengths": []} for j in JS}
    previous_top = {j: [] for j in JS}
    cross_overlap = {j: [] for j in JS if j != BASELINE_J}
    dates = 0
    dropped = {j: 0 for j in JS}

    for index in range(warmup, len(calendar)):
        as_of = calendar[index]
        snapshot = PointInTimeSnapshot(connection, as_of, SOURCE_VERSION, cache=cache)
        members: set[str] = set()
        for index_name in index_names:
            members |= snapshot.members(index_name)

        # 자격 판정과 forward 수익률은 **한 번만** 계산한다. J는 순위만 바꾼다.
        eligible: list[tuple[str, dict[int, float], dict[int, float], frozenset]] = []
        for symbol in sorted(members):
            features = _eligible(snapshot, symbol)
            if features is None:
                continue
            returns, stale = _forward(cache, symbol, as_of, calendar, index)
            if not returns:
                continue
            try:
                strengths = formation_strengths(snapshot, symbol)
            except FeatureUnavailable:
                # J가 길어 이력이 모자란 경우. 세어 두고 그 종목을 통째로 뺀다 —
                # J마다 다른 표본을 보게 두면 "J 효과"와 "표본 구성 효과"가 섞인다.
                for j in JS:
                    dropped[j] += 1
                continue
            eligible.append((symbol, strengths, returns, stale))

        if len(eligible) < PARAMETERS.min_score_population:
            continue
        dates += 1

        market, _ = _forward(cache, REFERENCE_SYMBOL, as_of, calendar, index)
        try:
            regime = classify_market_regime(snapshot, PARAMETERS).state
        except FeatureUnavailable:
            regime = "UNKNOWN"

        rows_by_j = {
            j: [
                Forward(symbol, strengths[j], returns, stale)
                for symbol, strengths, returns, stale in eligible
            ]
            for j in JS
        }

        # 공통 무작위 대조군. 크기는 TOP5와 같은 5, 그리고 D1 크기도 함께 든다.
        base_rows = rows_by_j[BASELINE_J]
        sizes = bucket_sizes(len(base_rows), control.buckets)[0]
        ordered_by_seed = {
            seed: sorted(base_rows, key=lambda r: random_score(seed, as_of, r.symbol))
            for seed in RANDOM_SEEDS
        }
        control.add_date(
            base_rows,
            market,
            random_picks={s: o[:sizes] for s, o in ordered_by_seed.items()},
            random_top_picks={
                s: o[: min(control.top_n, len(o))] for s, o in ordered_by_seed.items()
            },
        )

        for j in JS:
            rows = rows_by_j[j]
            overall[j].add_date(rows, market)
            if index + longest < len(calendar):
                common[j].add_date(rows, market)
            for horizon in PHASE_HORIZONS:
                phases[j][horizon][(index - warmup) % horizon].add_date(rows, market)
            by_year[j].setdefault(as_of[:4], Study((PRIMARY_HORIZON,))).add_date(
                rows, market
            )
            by_regime[j].setdefault(regime, Study((PRIMARY_HORIZON,))).add_date(
                rows, market
            )

            top = [
                row.symbol
                for row in sorted(rows, key=lambda r: (-r.rs, r.symbol))[: overall[j].top_n]
            ]
            if previous_top[j]:
                churn[j]["overlaps"].append(len(set(top) & set(previous_top[j])))
            for symbol in top:
                churn[j]["runs"][symbol] = churn[j]["runs"].get(symbol, 0) + 1
            for symbol in list(churn[j]["runs"]):
                if symbol not in top:
                    churn[j]["lengths"].append(churn[j]["runs"].pop(symbol))
            previous_top[j] = top

        baseline_top = set(previous_top[BASELINE_J])
        for j in cross_overlap:
            cross_overlap[j].append(len(set(previous_top[j]) & baseline_top))

        if (index - warmup) % 500 == 0:
            print(f"  {as_of} · 자격 {len(eligible)}종목 · 날짜 {dates:,}")

    for j in JS:
        churn[j]["lengths"].extend(churn[j]["runs"].values())

    return {
        "name": name,
        "dates": dates,
        "window": [calendar[warmup], calendar[-1]],
        "dropped_for_short_history": dropped,
        "overall": overall,
        "common": common,
        "phases": phases,
        "by_year": by_year,
        "by_regime": by_regime,
        "control": control,
        "churn": churn,
        "cross_overlap": cross_overlap,
    }


def _quantile(values: list[float], fraction: float):
    if not values:
        return None
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, int(fraction * (len(ordered) - 1)))]


def _mean(table: dict, label: str, horizon: int):
    cell = table.get((label, horizon))
    return cell.mean if cell else None


def serialize(result: dict) -> dict:
    """보고서가 읽을 형태로 접는다. `Study`를 그대로 저장하지 않는다."""
    from backtest.study import random_stats

    payload = {
        "name": result["name"],
        "dates": result["dates"],
        "window": result["window"],
        "dropped_for_short_history": result["dropped_for_short_history"],
        "random": {},
        "by_j": {},
    }
    for horizon in HORIZONS:
        stats = random_stats(result["control"], horizon, top=True)
        if stats:
            payload["random"][str(horizon)] = {
                "count": stats.count,
                "min": stats.minimum,
                "median": stats.median,
                "max": stats.maximum,
                "mean": stats.mean,
                "stdev": stats.stdev,
                "values": list(stats.values),
            }
    for j in JS:
        overall, common = result["overall"][j], result["common"][j]
        lengths = result["churn"][j]["lengths"]
        overlaps = result["churn"][j]["overlaps"]
        payload["by_j"][str(j)] = {
            "surface": {
                label: {
                    str(h): _mean(overall.vs_universe, label, h) for h in HORIZONS
                }
                for label in (TOP_LABEL, "D1", "D10")
            },
            "common": {
                str(h): _mean(common.vs_universe, TOP_LABEL, h) for h in HORIZONS
            },
            "common_dates": common.dates,
            "phases": {
                str(h): sorted(
                    value
                    for value in (
                        _mean(s.vs_universe, TOP_LABEL, h)
                        for s in result["phases"][j][h]
                    )
                    if value is not None
                )
                for h in PHASE_HORIZONS
            },
            "by_year": {
                year: _mean(study.vs_universe, TOP_LABEL, PRIMARY_HORIZON)
                for year, study in sorted(result["by_year"][j].items())
            },
            "by_regime": {
                state: _mean(study.vs_universe, TOP_LABEL, PRIMARY_HORIZON)
                for state, study in sorted(result["by_regime"][j].items())
            },
            "churn": {
                "mean_overlap": statistics.fmean(overlaps) if overlaps else None,
                "mean_new_names": (
                    overall.top_n - statistics.fmean(overlaps) if overlaps else None
                ),
                "churn_rate": (
                    (overall.top_n - statistics.fmean(overlaps)) / overall.top_n
                    if overlaps
                    else None
                ),
                "run_median": statistics.median(lengths) if lengths else None,
                "run_p90": _quantile(lengths, 0.90),
            },
            "overlap_with_baseline": (
                statistics.fmean(result["cross_overlap"][j])
                if j != BASELINE_J and result["cross_overlap"][j]
                else None
            ),
        }
    return payload


def out_dir() -> Path:
    path = RUNS_DIR / EXPERIMENT
    path.mkdir(parents=True, exist_ok=True)
    return path


def stage_run(connection, name: str) -> int:
    print(f"# {name}")
    payload = serialize(run_universe(connection, name))
    path = out_dir() / f"{name.lower()}.json"
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n날짜 {payload['dates']:,} · 구간 {payload['window'][0]} ~ {payload['window'][1]}")
    print(f"primary(+{PRIMARY_HORIZON}) TOP5 초과수익:")
    for j in JS:
        value = payload["by_j"][str(j)]["surface"][TOP_LABEL][str(PRIMARY_HORIZON)]
        print(f"  J{j:>3}: {value * 100:+.2f}%")
    print(f"→ {path.name}")
    return 0


def _pct(value, digits: int = 2) -> str:
    return "—" if value is None else f"{value * 100:+.{digits}f}%"


def _num(value, digits: int = 2) -> str:
    return "—" if value is None else f"{value:.{digits}f}"


def stage_report(_connection) -> int:
    loaded = {}
    for name in UNIVERSES:
        path = out_dir() / f"{name.lower()}.json"
        if path.exists():
            loaded[name] = json.loads(path.read_text(encoding="utf-8"))

    lines = [
        "# J 신호 연구 — 형성기간이 TOP5 초과수익을 어떻게 바꾸는가",
        "",
        "**skip=5를 고정하고 J만 바꾼다.** 포트폴리오 백테스트가 아니고 \"최적 J 찾기\"도"
        " 아니다. 사다리는 `J = 21, 42, 63, 126, 189`에서 끝나고 J252는 이번 PR에서"
        " 제외했다. 판정 기준 A~J와 해석 규칙 1~5는 러너 docstring에 미리 적어뒀다.",
        "",
        f"**사전 고정 primary endpoint: {PRIMARY_UNIVERSE} · TOP5 · +{PRIMARY_HORIZON}세션 ·"
        " 유니버스 평균 대비 초과수익.** 나머지 지평은 보조 진단이다.",
        "",
        "**이 결과는 out-of-sample이 아니다.** 이 개발 구간은 여러 연구에서 반복 관찰됐다."
        " model-selection / development-sample research로 읽는다.",
        "",
    ]

    for name in ("ALL", "NDX100"):
        if name not in loaded:
            continue
        data = loaded[name]
        mark = " (primary)" if name == PRIMARY_UNIVERSE else " (replication)"
        lines += [f"## {name}{mark} — primary 표: TOP5 +{PRIMARY_HORIZON}", "",
                  f"날짜 {data['dates']:,}개 · 구간 {data['window'][0]} ~ {data['window'][1]}",
                  "",
                  "|J|TOP5 +42|무작위 중앙|무작위 최대|이김|기준선 대비|",
                  "|---|---|---|---|---|---|"]
        random_row = data["random"].get(str(PRIMARY_HORIZON))
        baseline = data["by_j"][str(BASELINE_J)]["surface"][TOP_LABEL][
            str(PRIMARY_HORIZON)
        ]
        for j in JS:
            value = data["by_j"][str(j)]["surface"][TOP_LABEL][str(PRIMARY_HORIZON)]
            beaten = "—"
            if random_row and value is not None:
                beaten = f"{sum(1 for v in random_row['values'] if value > v)}/{random_row['count']}"
            delta = "기준선" if j == BASELINE_J else _pct(
                (value - baseline) if (value is not None and baseline is not None) else None
            )
            lines.append(
                f"|**{j}**|**{_pct(value)}**"
                f"|{_pct(random_row['median']) if random_row else '—'}"
                f"|{_pct(random_row['max']) if random_row else '—'}|{beaten}|{delta}|"
            )
        lines.append("")

    for name in ("ALL", "NDX100"):
        if name not in loaded:
            continue
        data = loaded[name]
        lines += [f"## {name} — J × 지평 decay surface (TOP5)", "",
                  "**최고 칸을 고르는 표가 아니다.** 짧은 J가 빠르게 감쇠하는지, 긴 J가"
                  " 장기에서만 살아나는지, 넓은 plateau가 있는지를 본다.", "",
                  "|J|" + "|".join(f"+{h}" for h in HORIZONS) + "|",
                  "|---|" + "---|" * len(HORIZONS)]
        for j in JS:
            cells = [
                _pct(data["by_j"][str(j)]["surface"][TOP_LABEL][str(h)])
                for h in HORIZONS
            ]
            lines.append(f"|**{j}**|" + "|".join(cells) + "|")
        lines += ["", f"### {name} — D1 (유니버스 폭 민감도 보조 지표)", "",
                  "|J|" + "|".join(f"+{h}" for h in HORIZONS) + "|",
                  "|---|" + "---|" * len(HORIZONS)]
        for j in JS:
            cells = [
                _pct(data["by_j"][str(j)]["surface"]["D1"][str(h)]) for h in HORIZONS
            ]
            lines.append(f"|{j}|" + "|".join(cells) + "|")
        lines += ["", f"### {name} — D10 (하위 버킷)", "",
                  "|J|" + "|".join(f"+{h}" for h in HORIZONS) + "|",
                  "|---|" + "---|" * len(HORIZONS)]
        for j in JS:
            cells = [
                _pct(data["by_j"][str(j)]["surface"]["D10"][str(h)]) for h in HORIZONS
            ]
            lines.append(f"|{j}|" + "|".join(cells) + "|")
        lines.append("")

    if PRIMARY_UNIVERSE in loaded:
        data = loaded[PRIMARY_UNIVERSE]
        lines += [f"## {PRIMARY_UNIVERSE} — 같은 크기 무작위 20표본", "",
                  "**무작위 대조군은 J와 무관하다.** 자격 유니버스와 날짜가 같으면 같은"
                  " 시드가 같은 종목을 뽑으므로 공통 baseline 하나로 계산해 모든 J를 같은"
                  " 분포와 견준다. **시드 20개는 formal p-value가 아니다** — 20/20을"
                  " \"통계적으로 유의하다\"로 쓰지 않는다.", "",
                  "|지평|최소|중앙|최대|평균|표준편차|" + "|".join(f"J{j}" for j in JS)
                  + "|",
                  "|---|---|---|---|---|---|" + "---|" * len(JS)]
        for horizon in HORIZONS:
            row = data["random"].get(str(horizon))
            if not row:
                continue
            cells = []
            for j in JS:
                value = data["by_j"][str(j)]["surface"][TOP_LABEL][str(horizon)]
                beaten = sum(1 for v in row["values"] if value is not None and value > v)
                cells.append(f"{_pct(value)} ({beaten}/{row['count']})")
            lines.append(
                f"|+{horizon}|{_pct(row['min'])}|{_pct(row['median'])}|{_pct(row['max'])}"
                f"|{_pct(row['mean'])}|{row['stdev'] * 100:.2f}%|" + "|".join(cells) + "|"
            )
        lines.append("")

    for name in ("ALL", "NDX100"):
        if name not in loaded:
            continue
        data = loaded[name]
        lines += [f"## {name} — common anchors (모든 지평이 같은 날짜)", "",
                  "지평마다 신호일 집합이 달라 생기는 착시를 지운다. **J끼리도 같은 anchor"
                  " 날짜를 쓴다** — 자격 판정이 J와 무관해서 날짜 집합이 같다.", "",
                  f"날짜 {data['by_j'][str(BASELINE_J)]['common_dates']:,}개"
                  f" (전체 {data['dates']:,}개 중)", "",
                  "|J|" + "|".join(f"+{h}" for h in HORIZONS) + "|",
                  "|---|" + "---|" * len(HORIZONS)]
        for j in JS:
            cells = [_pct(data["by_j"][str(j)]["common"][str(h)]) for h in HORIZONS]
            lines.append(f"|**{j}**|" + "|".join(cells) + "|")
        lines.append("")

    if PRIMARY_UNIVERSE in loaded:
        data = loaded[PRIMARY_UNIVERSE]
        lines += [f"## {PRIMARY_UNIVERSE} — 비중첩 위상 (TOP5)", "",
                  "매일 뽑으면 +42는 41/42가 겹친다. **관측 수를 독립 표본 수로 읽지"
                  " 않는다.** K개 위상을 각각 평균 내 흩어짐을 본다. 평균이 높아도 위상"
                  " 부호가 자주 뒤집히면 robustness 근거로 쓰지 않는다.", ""]
        for horizon in PHASE_HORIZONS:
            lines += [f"**+{horizon}**", "",
                      "|J|매일|위상 최소|위상 중앙|위상 최대|음수 위상|",
                      "|---|---|---|---|---|---|"]
            for j in JS:
                values = data["by_j"][str(j)]["phases"][str(horizon)]
                if not values:
                    continue
                negative = sum(1 for v in values if v < 0)
                lines.append(
                    f"|**{j}**"
                    f"|{_pct(data['by_j'][str(j)]['surface'][TOP_LABEL][str(horizon)])}"
                    f"|{_pct(values[0])}|{_pct(statistics.median(values))}"
                    f"|{_pct(values[-1])}|{negative}/{len(values)}|"
                )
            lines.append("")

    if PRIMARY_UNIVERSE in loaded:
        data = loaded[PRIMARY_UNIVERSE]
        years = sorted(data["by_j"][str(BASELINE_J)]["by_year"])
        lines += [f"## {PRIMARY_UNIVERSE} — 연도별 TOP5 +{PRIMARY_HORIZON}", "",
                  "|연도|" + "|".join(f"J{j}" for j in JS) + "|",
                  "|---|" + "---|" * len(JS)]
        for year in years:
            cells = [_pct(data["by_j"][str(j)]["by_year"].get(year)) for j in JS]
            lines.append(f"|{year}|" + "|".join(cells) + "|")
        lines += ["", "|J|양수 연도|음수 연도|연 중앙|", "|---|---|---|---|"]
        for j in JS:
            values = [
                v for v in data["by_j"][str(j)]["by_year"].values() if v is not None
            ]
            positive = sum(1 for v in values if v > 0)
            lines.append(
                f"|**{j}**|{positive}|{len(values) - positive}"
                f"|{_pct(statistics.median(values)) if values else '—'}|"
            )
        lines += ["", f"## {PRIMARY_UNIVERSE} — 레짐별 TOP5 +{PRIMARY_HORIZON}", "",
                  "**게이트는 넣지 않았고 라벨로만 쓴다.** 레짐별 값을 전체 성과의 가산적"
                  " 귀속으로 쓰지 않는다.", ""]
        states = sorted(data["by_j"][str(BASELINE_J)]["by_regime"])
        lines += ["|상태|" + "|".join(f"J{j}" for j in JS) + "|",
                  "|---|" + "---|" * len(JS)]
        for state in states:
            cells = [_pct(data["by_j"][str(j)]["by_regime"].get(state)) for j in JS]
            lines.append(f"|{state}|" + "|".join(cells) + "|")
        lines.append("")

    for name in ("ALL", "NDX100"):
        if name not in loaded:
            continue
        data = loaded[name]
        lines += [f"## {name} — TOP5 churn과 J63 대비 겹침", "",
                  "**churn을 J 선택 기준으로 쓰지 않는다.** 나중 포트폴리오 번역 단계에서"
                  " 회전·용량 차이를 설명할 진단 변수다.", "",
                  "|J|어제와 평균 겹침|하루 새 이름|churn rate|체류 중앙|체류 p90|J63 TOP5와 겹침|",
                  "|---|---|---|---|---|---|---|"]
        for j in JS:
            churn = data["by_j"][str(j)]["churn"]
            overlap = data["by_j"][str(j)]["overlap_with_baseline"]
            lines.append(
                f"|**{j}**|{_num(churn['mean_overlap'])} / 5"
                f"|{_num(churn['mean_new_names'])}|{_num(churn['churn_rate'], 3)}"
                f"|{_num(churn['run_median'], 1)}|{_num(churn['run_p90'], 1)}"
                f"|{'기준선' if j == BASELINE_J else _num(overlap) + ' / 5'}|"
            )
        lines.append("")

    path = out_dir() / "results.md"
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("\n".join(lines))
    print(f"\n보고서: {RUNS_DIR.name}/{EXPERIMENT}/{path.name}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("stage", choices=[*UNIVERSES, "report"])
    arguments = parser.parse_args()
    connection = store.connect()
    try:
        if arguments.stage == "report":
            return stage_report(connection)
        return stage_run(connection, arguments.stage)
    finally:
        connection.close()


if __name__ == "__main__":
    sys.exit(main())
