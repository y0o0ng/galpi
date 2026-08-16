"""**탐색적 후속 진단.** 슬롯을 늘릴수록 왜 RS의 무작위 대비 우위가 약해졌는가.

PR #11의 사전등록 실험은 끝났고 그 판정(A~G · CASE 3)은 이 파일이 건드리지 않는다.
여기 나오는 것은 **결과를 본 뒤 추가한 post-hoc 진단**이라 사전 기준과 섞지 않는다.
새 기준 H·I를 소급해 만들지 않고, CASE 판정을 다시 쓰지 않는다.

## 무엇을 묻는가

- **Q1** RS TOP5는 날마다 얼마나 같은 종목을 반복해 내보내는가 (churn)
- **Q2** 실제로 산 종목은 신호일 랭크 1~5 중 어디에 몰리는가
- **Q3** 슬롯을 늘리면 진입 랭크가 아래쪽으로 넓어지는가
- **Q4** `MAX_POSITIONS_REACHED`로 놓친 후보는 주로 몇 위였는가
- **Q5** 랭크 1~5 사이에 이후 초과수익 차이가 있는가

**"TOP5를 늘리자"를 검증하는 것이 아니다.** `max_candidates`를 바꾸지 않는다.

## 정의가 갈리지 않게 한다

랭킹은 백테스트가 쓰는 `rank_candidates`를 그대로 부른다. 간이 구현을 만들면 진단과
실험의 후보 정의가 갈려서 진단이 실험을 설명하지 못한다.

**유니버스도 같은 호출에서 나온다.** `rank_candidates`가 상위 5개를 `candidates`로,
나머지 자격 통과 종목을 `BELOW_TOP_N` 스킵으로 준다. 둘을 합치면 그날 자격을 갖춘
전체이고, 그것이 랭크별 초과수익의 분모다.

forward 수익률은 PR #9와 같은 정의다 — 배당 포함(`adj_close`) · 신호일 종가 → t+K 종가 ·
그날 유니버스 평균 대비. 달력은 `backtest/holdout.py`가 자른다.

## 중첩을 유의성으로 읽지 않는다

일별 TOP5와 forward 수익률은 강하게 겹친다. 관측 수를 독립 표본 수로 읽지 않고 이
진단에서 p-value를 만들지 않는다. 랭크 간 차이가 작거나 불안정하면 **"근거 없음"**이라고
적는다. 억지로 cutoff를 만들지 않는다.

    python3 selftest/rank_diagnostic_run.py signal          # Q1·Q5 (한 번)
    python3 selftest/rank_diagnostic_run.py trace jt-k84-s20  # Q2·Q3·Q4 (칸마다)
    python3 selftest/rank_diagnostic_run.py report
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
from backtest.candidates import rank_candidates  # noqa: E402
from backtest.data import BarCache, PointInTimeSnapshot  # noqa: E402
from backtest.features import FeatureUnavailable  # noqa: E402
from backtest.holdout import assert_no_holdout  # noqa: E402
from backtest.loop import ACCEPTED, BacktestConfig, run_backtest  # noqa: E402
from backtest.regime import classify_market_regime  # noqa: E402
from core import CORES  # noqa: E402
from core.jt_slots import SLOT_HOLDS, SLOT_LADDER  # noqa: E402
from selftest.k_lifetime_run import research_window  # noqa: E402
from selftest.real_run import (  # noqa: E402
    BARS_START,
    INDEX_NAMES,
    REFERENCE_SYMBOL,
    RUNS_DIR,
    SOURCE_VERSION,
)
from selftest.signal_study import research_calendar  # noqa: E402
from selftest.slot_capacity_run import EXPERIMENT, core_name  # noqa: E402

# 진단 산출물은 슬롯 실험 폴더 안에 둔다. 이 실험을 설명하는 자료이기 때문이다.
DIAGNOSTIC_DIR = RUNS_DIR / EXPERIMENT / "diagnostic"
HORIZONS = (21, 42, 84)
TOP_N = 5


def out_dir() -> Path:
    DIAGNOSTIC_DIR.mkdir(parents=True, exist_ok=True)
    return DIAGNOSTIC_DIR


def rs_cells() -> list[str]:
    return [core_name(hold, slots, random=False)
            for hold in SLOT_HOLDS for slots in SLOT_LADDER]


# ---------------------------------------------------------------- Q1 · Q5


def _forward(cache: BarCache, symbol: str, as_of: str, calendar, index: int):
    """PR #9와 같은 정의. 지평별 `신호일 종가 → t+K 종가`."""
    start = cache.bars(symbol, as_of, 1)
    if not start or start[-1].adj_close <= 0:
        return {}
    base = start[-1].adj_close
    returns: dict[int, float] = {}
    for horizon in HORIZONS:
        target = index + horizon
        if target >= len(calendar):
            continue
        bars = cache.bars(symbol, calendar[target], 1)
        if bars and bars[-1].adj_close > 0:
            returns[horizon] = bars[-1].adj_close / base - 1
    return returns


def stage_signal(connection) -> int:
    """랭크별 forward 초과수익과 TOP5 churn. 랭킹은 백테스트 것을 그대로 쓴다."""
    core = CORES["jt-k42"]  # 랭킹은 슬롯·K와 무관하다. 아무 RS 코어나 같은 순위를 낸다.
    policy = core.policy
    calendar = research_calendar(connection)
    assert_no_holdout(calendar)
    cache = BarCache(connection, SOURCE_VERSION)
    warmup = policy.parameters.min_history_sessions

    # 랭크별 누적. `(랭크, 지평) → [초과수익]`은 관측이 백만 개라 합계만 든다.
    totals: dict[tuple[int, int], list[float]] = {}
    previous_top: list[str] = []
    overlaps: list[int] = []
    overlap_histogram: dict[int, int] = {}
    runs: dict[str, int] = {}
    run_lengths: list[int] = []
    dates = 0

    for index in range(warmup, len(calendar)):
        as_of = calendar[index]
        snapshot = PointInTimeSnapshot(connection, as_of, SOURCE_VERSION, cache=cache)
        try:
            regime = classify_market_regime(snapshot, policy.parameters)
        except FeatureUnavailable:
            continue
        ranking = rank_candidates(
            snapshot,
            regime,
            policy=policy,
            index_names=INDEX_NAMES,
            require_earnings_calendar=core.require_earnings_calendar,
            entry_mode=core.entry_mode,
        )
        if not ranking.candidates:
            continue
        dates += 1
        top = [candidate.symbol for candidate in ranking.candidates]

        # Q1. 어제 TOP5와 겹치는 수.
        if previous_top:
            overlap = len(set(top) & set(previous_top))
            overlaps.append(overlap)
            overlap_histogram[overlap] = overlap_histogram.get(overlap, 0) + 1
        for symbol in top:
            runs[symbol] = runs.get(symbol, 0) + 1
        for symbol in list(runs):
            if symbol not in top:
                run_lengths.append(runs.pop(symbol))
        previous_top = top

        # Q5. 그날 자격 통과 전체 = 후보 + `BELOW_TOP_N`. 같은 호출에서 나온다.
        universe = list(top) + [
            skip.symbol for skip in ranking.skipped if skip.reason == "BELOW_TOP_N"
        ]
        forwards = {
            symbol: _forward(cache, symbol, as_of, calendar, index)
            for symbol in universe
        }
        for horizon in HORIZONS:
            values = [
                forward[horizon]
                for forward in forwards.values()
                if horizon in forward
            ]
            if not values:
                continue
            universe_mean = statistics.fmean(values)
            for candidate in ranking.candidates:
                forward = forwards.get(candidate.symbol, {})
                if horizon in forward:
                    totals.setdefault((candidate.rank, horizon), []).append(
                        forward[horizon] - universe_mean
                    )

        if (index - warmup) % 500 == 0:
            print(f"  {as_of} · 자격 {len(universe)}종목 · 날짜 {dates:,}")

    run_lengths.extend(runs.values())
    payload = {
        "dates": dates,
        "window": [calendar[warmup], calendar[-1]],
        "churn": {
            "mean_overlap": statistics.fmean(overlaps) if overlaps else None,
            "median_overlap": statistics.median(overlaps) if overlaps else None,
            "overlap_histogram": {
                str(key): overlap_histogram.get(key, 0) for key in range(TOP_N + 1)
            },
            "mean_new_names": (TOP_N - statistics.fmean(overlaps)) if overlaps else None,
            "median_new_names": (
                TOP_N - statistics.median(overlaps) if overlaps else None
            ),
            "mean_churn_rate": (
                (TOP_N - statistics.fmean(overlaps)) / TOP_N if overlaps else None
            ),
            "membership_run_median": statistics.median(run_lengths)
            if run_lengths
            else None,
            "membership_run_p75": _quantile(run_lengths, 0.75),
            "membership_run_p90": _quantile(run_lengths, 0.90),
            "membership_run_max": max(run_lengths) if run_lengths else None,
        },
        "rank_forward": {
            f"{rank}|{horizon}": {
                "count": len(values),
                "mean": statistics.fmean(values),
                "median": statistics.median(values),
            }
            for (rank, horizon), values in sorted(totals.items())
        },
    }
    path = out_dir() / "signal-diagnostic.json"
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n→ {path.name} (날짜 {dates:,})")
    return 0


def _quantile(values: list[float], fraction: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, int(fraction * (len(ordered) - 1)))]


# ---------------------------------------------------------------- Q2 · Q3 · Q4


def stage_trace(connection, core_key: str) -> int:
    """한 칸을 다시 돌리며 후보마다 `(랭크, 결과)`를 받는다.

    **결과 숫자는 바뀌지 않는다.** 관찰자는 읽기만 하고 엔진 분기에 참여하지 않는다.
    """
    core = CORES[core_key]
    start, end, _ = research_window(connection)
    config = BacktestConfig(
        source_version=SOURCE_VERSION,
        start=start,
        end=end,
        index_names=INDEX_NAMES,
        **core.run_kwargs(),
        unresolved_exit_price="LAST_CLOSE",
    )
    counts: dict[tuple[int, str], int] = {}

    def observe(trade_date: str, rank: int, symbol: str, outcome: str) -> None:
        counts[(rank, outcome)] = counts.get((rank, outcome), 0) + 1

    print(f"# trace {core_key}")
    result = run_backtest(connection, config, observer=observe)
    payload = {
        "core": core_key,
        "slots": core.policy.limits.max_positions,
        "max_hold_sessions": core.policy.parameters.max_hold_sessions,
        "trade_count": len(result.trades),
        "by_rank": {
            f"{rank}|{outcome}": count for (rank, outcome), count in sorted(counts.items())
        },
    }
    path = out_dir() / f"trace-{core_key}.json"
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    accepted = sum(c for (_, outcome), c in counts.items() if outcome == ACCEPTED)
    blocked = sum(
        c for (_, outcome), c in counts.items() if outcome == "MAX_POSITIONS_REACHED"
    )
    print(f"  거래 {len(result.trades):,} · 게이트 통과 {accepted:,} · 슬롯차단 {blocked:,}")
    print(f"  → {path.name}")
    return 0


# ---------------------------------------------------------------- 보고서


def _pct(value: float | None, digits: int = 2) -> str:
    return "—" if value is None else f"{value * 100:+.{digits}f}%"


def _num(value: float | None, digits: int = 2) -> str:
    return "—" if value is None else f"{value:.{digits}f}"


def stage_report(_connection) -> int:
    signal_path = out_dir() / "signal-diagnostic.json"
    signal = json.loads(signal_path.read_text()) if signal_path.exists() else None
    traces = {}
    for cell in rs_cells():
        path = out_dir() / f"trace-{cell}.json"
        if path.exists():
            traces[cell] = json.loads(path.read_text())

    lines = [
        "# 탐색적 후속 진단 — TOP5 churn과 진입 랭크 집중도",
        "",
        "**이것은 사전등록 실험이 아니다.** PR #11의 슬롯 실험은 끝났고 그 판정"
        "(기준 A~G · CASE 3)은 이 문서가 바꾸지 않는다. 여기 있는 것은 결과를 본 뒤"
        " 추가한 post-hoc 진단이라 사전 기준과 섞지 않는다.",
        "",
        "**묻는 것 하나:** 슬롯을 늘릴수록 왜 RS의 무작위 대비 우위가 약해졌는지"
        " 설명 가능한 구조가 있는가. **`max_candidates`를 바꾸지 않는다.**",
        "",
    ]

    if signal:
        churn = signal["churn"]
        histogram = churn["overlap_histogram"]
        total = sum(histogram.values()) or 1
        lines += ["## Evidence — Q1. TOP5 churn", "",
                  f"구간 {signal['window'][0]} ~ {signal['window'][1]} ·"
                  f" 날짜 {signal['dates']:,}개. 랭킹은 백테스트의 `rank_candidates`를"
                  " 그대로 부른 값이다.", "",
                  "|값|결과|", "|---|---|",
                  f"|어제 TOP5와 평균 겹침|{_num(churn['mean_overlap'])} / 5|",
                  f"|중앙 겹침|{_num(churn['median_overlap'], 1)} / 5|",
                  f"|하루 평균 새 이름|{_num(churn['mean_new_names'])}|",
                  f"|평균 churn rate|{_num(churn['mean_churn_rate'], 3)}|",
                  f"|TOP5 연속 체류 중앙|{_num(churn['membership_run_median'], 1)}세션|",
                  f"|p75 / p90 / 최대|{_num(churn['membership_run_p75'], 1)} /"
                  f" {_num(churn['membership_run_p90'], 1)} /"
                  f" {_num(churn['membership_run_max'], 1)}세션|",
                  "",
                  "**겹침 분포**", "",
                  "|겹친 수|일수|비율|", "|---|---|---|"]
        for key in range(TOP_N + 1):
            count = histogram.get(str(key), 0)
            lines.append(f"|{key}|{count:,}|{count / total * 100:.1f}%|")

        lines += ["", "## Evidence — Q5. 랭크별 forward 초과수익", "",
                  "그날 자격을 갖춘 전체(후보 + `BELOW_TOP_N`) 평균 대비다. PR #9과 같은"
                  " 정의이고 배당 포함이다.", "",
                  "**일별 TOP5와 forward 수익률은 강하게 겹친다. 관측 수를 독립 표본 수로"
                  " 읽지 않는다.** 이 진단에서 p-value를 만들지 않았다.", "",
                  "|랭크|" + "|".join(f"+{h} 평균|+{h} 중앙" for h in HORIZONS) + "|관측|",
                  "|---|" + "---|" * (2 * len(HORIZONS) + 1)]
        for rank in range(1, TOP_N + 1):
            cells = []
            count = None
            for horizon in HORIZONS:
                item = signal["rank_forward"].get(f"{rank}|{horizon}")
                cells += [_pct(item["mean"]) if item else "—",
                          _pct(item["median"]) if item else "—"]
                if item:
                    count = item["count"]
            lines.append(f"|**{rank}**|" + "|".join(cells) + f"|{count:,}|")

    if traces:
        lines += ["", "## Evidence — Q2·Q3. 실제 진입의 랭크 분포", "",
                  "랭크는 유니버스·필터 통과 후 RS 점수 정렬 뒤, **포트폴리오 제약 적용"
                  " 전**의 순위다.", "",
                  "|칸|" + "|".join(f"랭크 {r}" for r in range(1, TOP_N + 1))
                  + "|통과 합계|",
                  "|---|" + "---|" * (TOP_N + 1)]
        for cell, trace in traces.items():
            accepted = [
                trace["by_rank"].get(f"{rank}|{ACCEPTED}", 0)
                for rank in range(1, TOP_N + 1)
            ]
            total = sum(accepted) or 1
            cells = [f"{value:,} ({value / total * 100:.0f}%)" for value in accepted]
            lines.append(f"|`{cell}`|" + "|".join(cells) + f"|{total:,}|")

        lines += ["", "## Evidence — Q4. `MAX_POSITIONS_REACHED`로 놓친 후보의 랭크", "",
                  "|칸|" + "|".join(f"랭크 {r}" for r in range(1, TOP_N + 1))
                  + "|차단 합계|",
                  "|---|" + "---|" * (TOP_N + 1)]
        for cell, trace in traces.items():
            blocked = [
                trace["by_rank"].get(f"{rank}|MAX_POSITIONS_REACHED", 0)
                for rank in range(1, TOP_N + 1)
            ]
            total = sum(blocked) or 1
            cells = [f"{value:,} ({value / total * 100:.0f}%)" for value in blocked]
            lines.append(f"|`{cell}`|" + "|".join(cells) + f"|{sum(blocked):,}|")

        lines += ["", "### 후보가 어떻게 끝났는가 (사유별)", "",
                  "|칸|" + "|".join(
                      sorted({
                          key.split("|", 1)[1]
                          for trace in traces.values()
                          for key in trace["by_rank"]
                      })
                  ) + "|",
                  "|---|" + "---|" * len({
                      key.split("|", 1)[1]
                      for trace in traces.values()
                      for key in trace["by_rank"]
                  })]
        outcomes = sorted({
            key.split("|", 1)[1] for trace in traces.values() for key in trace["by_rank"]
        })
        for cell, trace in traces.items():
            cells = []
            for outcome in outcomes:
                value = sum(
                    count
                    for key, count in trace["by_rank"].items()
                    if key.split("|", 1)[1] == outcome
                )
                cells.append(f"{value:,}")
            lines.append(f"|`{cell}`|" + "|".join(cells) + "|")

    lines.append("")
    path = out_dir() / "diagnostic.md"
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("\n".join(lines))
    print(f"\n보고서: {path.relative_to(RUNS_DIR.parent)}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="stage", required=True)
    sub.add_parser("signal")
    tracer = sub.add_parser("trace")
    tracer.add_argument("core", choices=rs_cells())
    sub.add_parser("cells")
    sub.add_parser("report")
    arguments = parser.parse_args()

    if arguments.stage == "cells":
        for cell in rs_cells():
            print(cell)
        return 0

    connection = store.connect()
    try:
        if arguments.stage == "signal":
            return stage_signal(connection)
        if arguments.stage == "trace":
            return stage_trace(connection, arguments.core)
        return stage_report(connection)
    finally:
        connection.close()


if __name__ == "__main__":
    sys.exit(main())
