"""J126의 신호 우위는 신호 → 포트폴리오의 **어느 단계에서** 사라지는가.

**이번은 개입이 아니라 측정이다.** J·K·skip·슬롯·거래당 위험·손절 배수·종목당 비중·노출
한도·TOP5·후보 수·수량 공식·체결·청산·비용·레짐·폐지 처리를 하나도 바꾸지 않는다. 새
코어도 만들지 않는다. 읽는 것은 `jt-k42`(J63)와 `jt-j126-k42`(J126) 둘뿐이다.

## 왜 이 질문인가

- **PR #12**(신호 층): ALL·TOP5·+42 유니버스 대비 초과수익이 J63 +0.48% · J126 +1.03%.
  NDX100은 +1.01% · +1.75%. 두 유니버스·여섯 지평·common anchor·위상에서 J126이 강했다.
- **PR #13**(포트폴리오 층): 같은 K42/S5 구조에서 총수익 +35.39% → +35.63%, 기대값
  0.229 → 0.233R. **신호 층의 큰 차이가 포트폴리오에서 사실상 사라졌다.**

원인 후보가 여럿이다 — admission·슬롯, 익일 체결, 실제 체결된 부분집합, 고정 K42 청산,
ATR 정규화 위험 표현, 수량·notional 가중, 폐지 상호작용. **어느 단계가 주원인인지 아직
모르므로 수량 규칙을 바꾸지 않는다.** 이 PR은 범인을 찾는 PR이지 고치는 PR이 아니다.

## 퍼널 단계 정의

|단계|뜻|
|---|---|
|**STAGE 0** ELIGIBLE TOP5|신호일 유니버스·필터 통과 후 RS 랭킹 TOP5 전체|
|**STAGE 1** PORTFOLIO ACCEPTED|포트폴리오 게이트를 통과한 후보. **체결이 아니다**|
|**STAGE 2** FILLED|다음 세션에 실제로 체결되어 포지션이 열린 후보|
|**STAGE 3** CLOSED TRADE|실제로 청산까지 끝난 거래|
|**STAGE 4** RAW RETURN|실제 진입가 → 실제 청산가의 단순 가격 수익률|
|**STAGE 5** R MULTIPLE|기존 엔진의 `pnl / 진입 시점 계획 위험`|
|**STAGE 6** DOLLAR|실제 주식 수가 적용된 달러 손익|

## 신호 척도는 단계마다 같은 정의를 쓴다

STAGE 0·1·2의 후보 전부에 PR #12과 **같은** +42 척도를 붙인다 — 신호일 `adj_close` →
신호일 +42세션 `adj_close`, 그리고 그날 자격 유니버스 평균 대비 초과. 단계마다 정의를
바꾸면 "TOP5에서는 우위, accepted에서 감소, filled에서 소멸" 같은 변화를 읽을 수 없다.

**자격 유니버스는 J와 무관하다.** `compute_features`가 요구하는 것은 이력 252세션이고
RS(126,5)는 127바면 되므로 J63과 J126의 자격 집합이 같다. 그래서 유니버스 기준선은 한 번만
계산해 두 J가 공유한다.

## LAST_CLOSE가 main이고 ZERO는 보조다

**퍼널의 main attribution은 LAST_CLOSE다.** ZERO 재실행은 data-exit·sizing 민감도를 같은
계측으로 재기 위한 보조 진단이고, **ZERO 결과를 main 퍼널과 섞지 않는다.** 신호 층 forward는
PR #12의 stale/마지막 종가 고정 정의이고 실제 거래 결과는 포트폴리오의 시나리오 가격이다 —
서로 다른 층의 정의라 "신호 forward에서 ZERO였다" 같은 문장은 만들지 않는다.

## 관찰자는 읽기만 한다

PR #11의 `observer`를 그대로 쓰고, 수량·상한·체결을 보려고 `entry_observer`를 더했다.
**진단용 sizing 계산기를 따로 만들지 않는다** — 엔진이 계산한 `SizedIntent`·`Caps`를 그
자리에서 읽는다. `observer=None`과 켠 실행의 거래·체결·자산곡선·지표가 같은지는
`test_funnel.py`가 잠근다.

## 사전 판정 기준 A~L — 결과를 본 뒤 바꾸지 않는다

- **A.** PR #12의 TOP5 J126 우위가 이 러너에서도 재현되는가
- **B.** ACCEPTED 단계에서도 유지되는가
- **C.** FILLED 단계에서도 유지되는가
- **D.** 실제 raw 퍼센트 거래 수익률에서도 유지되는가
- **E.** R 배수에서 유지되는가
- **F.** 달러 손익 기여에서도 유지되는가
- **G.** J63/J126의 정규화 ATR 분포가 실제로 다른가
- **H.** 진입 notional 비중 분포가 다른가
- **I.** 실제 sizing 구속 제약이 무엇인가
- **J.** data-exit 거래가 큰 notional·낮은 변동성 꼬리에 있는가
- **K.** 신호 우위의 가장 큰 소실이 어느 단계 사이에서 나타나는가
- **L.** 현재 증거로 sizing을 다음 개입 대상으로 올릴 수 있는가

## 사전 해석 규칙 — PATTERN A/E/S/N

`classify_pattern`이 이 표를 그대로 코드로 들고 있고 `test_funnel.py`가 잠근다.

|패턴|관측|읽는 법|
|---|---|---|
|**A** ADMISSION|TOP5는 J126 > J63인데 FILLED +42에서 사라짐|sizing 이전에 이미 소실. **sizing은 주원인이 아니다**|
|**E** EXECUTION_EXIT|FILLED +42는 유지되는데 raw 거래 수익률에서 사라짐|익일 체결·고정 K42 청산·경로 문제|
|**S** SIZING|raw는 유지되는데 R 또는 달러에서 축소·역전 **+ sizing 분포 차이 실재**|sizing 가설 강화|
|**N** NO_CLEAR_STAGE|그 외 전부 — 우위가 애초에 없거나, 모든 층에서 유지되거나, 분포 차이가 없음|특정 구성요소를 범인으로 지목하지 않는다|

**`correlation != causation`이다.** sizing 분포 차이가 있어도 raw-return 우위가 이미
sizing 이전에 사라졌다면 sizing을 주원인으로 올리지 않는다. 그래서 PATTERN S는 raw 우위
생존을 **먼저** 요구한다.

## 단위가 다른 행을 하나의 척도로 읽지 않는다

decay 표의 행들은 단위가 다르다(유니버스 대비 초과 % · raw % · R · 달러). 크기를 그대로
빼서 하나의 연속 척도처럼 해석하지 않고 **각 층에서 방향과 차이만** 본다. 예외는
STAGE 0·1·2인데, 셋 다 같은 "유니버스 대비 +42 초과수익"이라 그 안에서는 뺄 수 있다.

## 중첩과 표본 크기

일별 TOP5는 강하게 겹치고 +42 수익률은 41/42가 겹친다. **관측 수를 독립 표본 수로 읽지
않고 이 진단에서 p-value를 만들지 않는다.** data-exit는 J당 6~9건이므로 일반적인 분포
결론으로 확장하지 않는다.

## 홀드아웃

forward +42를 다시 계산하므로 PR #9/#12 규칙을 그대로 쓴다 — `research_calendar`가 달력
자체를 `HOLDOUT_START` 전에서 자르고, forward 목표일도 그 달력에서만 나온다. 실제 포트폴리오
실행은 기존 `research_window`를 그대로 쓴다.

    python3 selftest/funnel_run.py plan
    python3 selftest/funnel_run.py universe
    python3 selftest/funnel_run.py trace jt-k42 LAST_CLOSE
    python3 selftest/funnel_run.py report
"""

from __future__ import annotations

import argparse
import json
import math
import statistics
import sys
from pathlib import Path

TRADING_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TRADING_ROOT))

from backtest import store  # noqa: E402
from backtest.benchmark import benchmark_table  # noqa: E402
from backtest.candidates import rank_candidates  # noqa: E402
from backtest.data import BarCache, PointInTimeSnapshot  # noqa: E402
from backtest.features import FeatureUnavailable  # noqa: E402
from backtest.holdout import assert_no_holdout, holdout_metadata  # noqa: E402
from backtest.loop import ACCEPTED, BacktestConfig, run_backtest  # noqa: E402
from backtest.metrics import compute_metrics  # noqa: E402
from backtest.modes import LAST_CLOSE_EXIT, UNRESOLVED_EXIT_PRICES  # noqa: E402
from backtest.regime import classify_market_regime  # noqa: E402
from core import CORES  # noqa: E402
from selftest.k_lifetime_run import reference_closes  # noqa: E402
from selftest.momentum_run import research_window  # noqa: E402
from selftest.real_run import INDEX_NAMES, RUNS_DIR, SOURCE_VERSION  # noqa: E402
from selftest.signal_study import research_calendar  # noqa: E402
from selftest.slot_capacity_run import capacity_diagnostics  # noqa: E402

EXPERIMENT = "signal-to-portfolio-funnel"

# 읽는 코어는 정확히 둘이다. 새 코어를 만들지 않는다.
BASELINE = "jt-k42"
CHALLENGER = "jt-j126-k42"
SIGNALS = (BASELINE, CHALLENGER)
LABELS = {BASELINE: "J63", CHALLENGER: "J126"}
SLUGS = {BASELINE: "j63", CHALLENGER: "j126"}

# PR #12의 사전 고정 primary와 같은 지평 하나만 본다.
HORIZON = 42
TOP_N = 5
# §15 변동성 귀속. J별로 나누면 칸의 뜻이 갈리므로 **둘을 합친 분포**에서 경계를 만든다.
VOL_BUCKETS = 5

# §12의 outlier robustness. **하나만 고르고 결과를 보고 늘리지 않는다.**
ALIGNMENT_TRIM = 0.01
# §11의 선택적 요약. 전략 규칙이 아니라 표를 읽기 위한 구간이다.
RETURN_BANDS = ((0.0, 0.2, "하위 20%"), (0.2, 0.8, "중간 60%"), (0.8, 1.0, "상위 20%"))
# 탐색적 정렬 진단의 해석 범위. §14의 X1/X2/X3다.
ALIGNMENT_PATTERNS = ("X1", "X2", "X3")

# 거래가 끝난 것이 가격 경로가 아니라 데이터 종료인 청산. `positions`의 상태 기계가 낸다.
DATA_EXIT_REASONS = ("DELISTED_EXIT", "UNRESOLVED_EXIT")

# §13의 "분포가 실제로 다른가"를 결과 전에 못박는다. 중앙값이 상대적으로 이만큼은
# 달라야 "다르다"고 적는다. 이 값은 결과를 본 뒤 바꾸지 않는다.
DISTRIBUTION_TOLERANCE = 0.05

PATTERNS = ("ADMISSION", "EXECUTION_EXIT", "SIZING", "NO_CLEAR_STAGE")


# ---------------------------------------------------------------- 사전등록 판정


def distributions_differ(summary_a: dict, summary_b: dict) -> bool:
    """정규화 ATR 또는 진입 notional 비중의 중앙값이 상대적으로 유의미하게 다른가.

    **분포 차이는 sizing 가설의 필요조건이지 충분조건이 아니다.** 이것만으로 sizing을
    범인으로 올리지 않는다 — `classify_pattern`이 raw 수익률 우위 생존을 먼저 요구한다.
    """
    for key in ("atr_fraction", "entry_notional_weight"):
        left = (summary_a.get(key) or {}).get("median")
        right = (summary_b.get(key) or {}).get("median")
        if left in (None, 0) or right is None:
            continue
        if abs(right / left - 1) >= DISTRIBUTION_TOLERANCE:
            return True
    return False


def classify_pattern(deltas: dict, differ: bool) -> str:
    """§21의 표를 그대로 코드로 옮긴 것. **결과를 본 뒤 바꾸지 않는다.**

    `deltas`는 층마다 `J126 - J63`이다. 단위가 서로 다르므로 **부호만** 본다.
    """
    needed = ("top5_excess", "filled_excess", "raw_return", "realized_r", "dollar_per_trade")
    values = [deltas.get(key) for key in needed]
    if any(value is None for value in values):
        return "NO_CLEAR_STAGE"
    top5, filled, raw, realized_r, dollar = values
    if top5 <= 0:
        # 이 러너에서 신호 층 우위 자체가 재현되지 않았다. 소실 지점을 물을 수 없다.
        return "NO_CLEAR_STAGE"
    if filled <= 0:
        return "ADMISSION"
    if raw <= 0:
        return "EXECUTION_EXIT"
    if (realized_r <= 0 or dollar <= 0) and differ:
        return "SIZING"
    return "NO_CLEAR_STAGE"


def next_intervention(pattern: str) -> str:
    """§30 Q2. sizing ablation을 다음 개입으로 올릴 근거가 있는가."""
    if pattern == "SIZING":
        return "YES"
    if pattern in ("ADMISSION", "EXECUTION_EXIT"):
        return "NO"
    return "INCONCLUSIVE"


# ---------------------------------------------------------------- 공통 계산


def out_dir() -> Path:
    path = RUNS_DIR / EXPERIMENT
    path.mkdir(parents=True, exist_ok=True)
    return path


def trace_path(core_key: str, scenario: str) -> Path:
    suffix = "" if scenario == LAST_CLOSE_EXIT else f"-{scenario.lower()}"
    return out_dir() / f"{SLUGS[core_key]}-funnel{suffix}.json"


def universe_path() -> Path:
    return out_dir() / "universe-forward.json"


def forward_return(
    cache: BarCache, symbol: str, as_of: str, target_date: str
) -> tuple[float | None, bool]:
    """PR #12와 같은 정의. `(수익률, 마지막 종가로 고정됐는가)`.

    거래가 멈춘 종목을 빼지 않는다. 빼면 그것이 정확히 생존편향이다 — 사라진 종목은 대개
    나쁘게 끝났다. 대신 forward 가격이 마지막 거래 종가로 고정됐다는 사실을 함께 남긴다.
    """
    start = cache.bars(symbol, as_of, 1)
    if not start or start[-1].adj_close <= 0:
        return None, False
    bars = cache.bars(symbol, target_date, 1)
    if not bars or bars[-1].adj_close <= 0:
        return None, False
    return bars[-1].adj_close / start[-1].adj_close - 1, bars[-1].trade_date != target_date


def _fmean(values):
    return statistics.fmean(values) if values else None


def _median(values):
    return statistics.median(values) if values else None


def _quantile(values, fraction: float):
    if not values:
        return None
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, int(fraction * (len(ordered) - 1)))]


def describe(values: list[float]) -> dict:
    """§13이 요구하는 요약 한 벌."""
    return {
        "count": len(values),
        "mean": _fmean(values),
        "median": _median(values),
        "p10": _quantile(values, 0.10),
        "p25": _quantile(values, 0.25),
        "p75": _quantile(values, 0.75),
        "p90": _quantile(values, 0.90),
        "max": max(values) if values else None,
    }


def percentile_of(values: list[float], point: float | None) -> float | None:
    """`point`가 `values` 분포의 몇 번째 백분위인가. §16이 쓰는 위치 표현이다."""
    if point is None or not values:
        return None
    return 100.0 * sum(1 for value in values if value <= point) / len(values)


def allocation_weighted_mean(returns: list[float], weights: list[float]) -> float | None:
    """`Σ(w·r) / Σw`.

    **이것은 포트폴리오 수익률이 아니다.** 서로 다른 날짜의 거래를 정적으로 모아 "비중이
    큰 거래가 평균적으로 어떤 퍼센트 수익률을 냈는가"만 재는 **정렬 진단**이다. 자본이
    시간에 따라 굴러가지 않고 동시 보유도 재현하지 않으므로 counterfactual·백테스트
    수익률로 부르지 않는다.
    """
    if len(returns) != len(weights):
        raise ValueError(
            f"수익률과 가중치 개수가 다릅니다: {len(returns)} != {len(weights)}"
        )
    total = sum(weights)
    if not returns or total <= 0:
        return None
    return sum(weight * value for weight, value in zip(weights, returns)) / total


def alignment_rows(rows: list[dict]) -> list[dict]:
    """정렬 진단이 쓸 수 있는 거래. 네 값이 모두 있어야 한 관측이 된다."""
    return [
        row
        for row in rows
        if row.get("entry_notional")
        and row.get("equity_at_signal")
        and row.get("planned_entry")
        and "pnl" in row
    ]


def trimmed_by_return(
    rows: list[dict], fraction: float = ALIGNMENT_TRIM
) -> list[dict]:
    """net-notional 수익률 **절대값 상위 `fraction`**을 뺀 표본.

    **위·아래 각각 `fraction`이 아니라 절대값이 큰 전체 `fraction`이다.** 양·음 어느
    쪽이든 극단값이 후보가 되고, 100건이면 한 건만 빠진다.

    **사전에 1% 하나만 고른다.** 결과를 보고 2%·5%·10%를 덧붙이지 않는다. 개수는
    내림이라 표본이 100건 미만이면 아무것도 빼지 않는다 — 뺄 것이 1건도 안 되는데
    억지로 하나를 빼면 그 하나가 진단을 좌우한다.
    """
    usable = alignment_rows(rows)
    count = math.floor(len(usable) * fraction)
    if count <= 0:
        return list(usable)
    ordered = sorted(
        usable, key=lambda row: abs(row["pnl"] / row["entry_notional"]), reverse=True
    )
    return ordered[count:]


def alignment_stats(rows: list[dict]) -> dict:
    """§6~9의 값 한 벌. 전부 기존 trace에 이미 있는 값에서 나온다."""
    usable = alignment_rows(rows)
    returns = [row["pnl"] / row["entry_notional"] for row in usable]
    weights = [row["entry_notional"] / row["equity_at_signal"] for row in usable]
    normalized_atr = [row["atr14"] / row["planned_entry"] for row in usable]
    equal = _fmean(returns)
    weighted = allocation_weighted_mean(returns, weights)
    return {
        "count": len(usable),
        "equal_trade_mean": equal,
        "allocation_weighted_mean": weighted,
        "alignment_gap": _delta(equal, weighted),
        "rho_weight_return": spearman(weights, returns),
        "rho_atr_return": spearman(normalized_atr, returns),
        "median_weight": _median(weights),
        "median_atr_fraction": _median(normalized_atr),
    }


def spearman(xs: list[float], ys: list[float]) -> float | None:
    """순위 상관. 무엇을 썼는지 보고서가 명시한다(§14).

    Pearson이 아니라 순위를 쓰는 이유는 notional 비중과 정규화 ATR 둘 다 오른쪽으로 크게
    치우쳐 있어서 몇 건의 꼬리가 선형 상관을 지배하기 때문이다. **formal significance
    test는 하지 않는다.**
    """
    if len(xs) < 3 or len(xs) != len(ys):
        return None
    try:
        return statistics.correlation(xs, ys, method="ranked")
    except statistics.StatisticsError:
        return None


# ---------------------------------------------------------------- 유니버스 기준선


def stage_universe(connection) -> int:
    """날짜별 자격 유니버스의 +42 평균. **J와 무관하므로 한 번만 만든다.**

    유니버스는 백테스트가 쓰는 `rank_candidates`가 그대로 낸다 — 후보 TOP5와
    `BELOW_TOP_N` 스킵을 합치면 그날 자격을 갖춘 전체다(RS-only 진입이라 7.4 게이트가
    후보를 더 걸러내지 않는다). 간이 구현을 만들면 진단과 실험의 유니버스가 갈린다.
    """
    core = CORES[BASELINE]
    policy = core.policy
    calendar = research_calendar(connection)
    assert_no_holdout(calendar)
    cache = BarCache(connection, SOURCE_VERSION)
    warmup = policy.parameters.min_history_sessions

    by_date: dict[str, dict] = {}
    for index in range(warmup, len(calendar)):
        target = index + HORIZON
        if target >= len(calendar):
            # 남은 날은 +42 목표일이 달력 밖이다. 홀드아웃을 넘겨보지 않는다.
            break
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
        universe = [candidate.symbol for candidate in ranking.candidates] + [
            skip.symbol for skip in ranking.skipped if skip.reason == "BELOW_TOP_N"
        ]
        values: list[float] = []
        stale = 0
        for symbol in universe:
            value, is_stale = forward_return(cache, symbol, as_of, calendar[target])
            if value is None:
                continue
            values.append(value)
            stale += int(is_stale)
        if not values:
            continue
        by_date[as_of] = {
            "mean": statistics.fmean(values),
            "count": len(values),
            "stale": stale,
        }
        if (index - warmup) % 500 == 0:
            print(f"  {as_of} · 자격 {len(values)}종목 · 날짜 {len(by_date):,}")

    payload = {
        "horizon": HORIZON,
        "window": [calendar[warmup], calendar[-1]],
        "dates": len(by_date),
        "holdout": holdout_metadata(consumed=False),
        "by_date": by_date,
    }
    path = universe_path()
    path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    print(f"\n→ {path.name} (날짜 {len(by_date):,})")
    return 0


# ---------------------------------------------------------------- 퍼널 추적


def stage_trace(connection, core_key: str, scenario: str) -> int:
    """한 코어를 다시 돌리며 후보마다 신호 → 체결 → 거래를 이어 붙인다.

    **결과 숫자는 바뀌지 않는다.** 두 관찰자 모두 읽기만 하고 엔진 분기에 참여하지 않는다.
    """
    core = CORES[core_key]
    start, end, holdout_start = research_window(connection)
    config = BacktestConfig(
        source_version=SOURCE_VERSION,
        start=start,
        end=end,
        index_names=INDEX_NAMES,
        **core.run_kwargs(),
        unresolved_exit_price=scenario,
    )
    print(f"# {LABELS[core_key]} · {core_key} · {scenario}")
    print(f"  {core.summary}")
    print(f"  구간 {start} ~ {end} (홀드아웃 {holdout_start}부터는 보지 않는다)")

    rows: dict[tuple[str, str], dict] = {}
    events = []

    def observe(trade_date: str, rank: int, symbol: str, outcome: str) -> None:
        rows[(trade_date, symbol)] = {
            "signal_date": trade_date,
            "rank": rank,
            "symbol": symbol,
            "outcome": outcome,
        }

    result = run_backtest(
        connection, config, observer=observe, entry_observer=events.append
    )

    for event in events:
        intent = event.intent
        row = rows[(event.signal_date, intent.symbol)]
        # 계좌 자산은 엔진이 본 그 값이다. `planned_risk / planned_risk_fraction`이
        # 정확히 sizing이 나눈 자산이라 별도 조회로 어림하지 않는다.
        equity = (
            intent.planned_risk / intent.planned_risk_fraction
            if intent.planned_risk_fraction
            else None
        )
        row.update(
            {
                "shares": intent.shares,
                "original_shares": intent.original_shares,
                "reference_close": intent.reference_close,
                "atr14": intent.atr14,
                "planned_entry": intent.planned_entry,
                "initial_stop": intent.initial_stop,
                "stop_distance": intent.stop_distance,
                "planned_risk": intent.planned_risk,
                "planned_risk_fraction": intent.planned_risk_fraction,
                "effective_risk_ratio": intent.effective_risk_ratio,
                "binding_constraint": intent.binding_constraint,
                "min_qty_exception": intent.min_qty_exception,
                "reduction_factor": intent.reduction_factor,
                "equity_at_signal": equity,
                "execution_date": event.execution_date,
            }
        )
        if event.caps is not None:
            row["caps"] = {
                "by_risk": event.caps.by_risk,
                "by_capital": event.caps.by_capital,
                "by_liquidity": event.caps.by_liquidity,
                "by_exposure": event.caps.by_exposure,
                "extra": {name: value for name, value in event.caps.extra},
            }
        if event.fill is None:
            row["fill_cancel_reason"] = event.cancel_reason
        else:
            row.update(
                {
                    "entry_date": event.fill.trade_date,
                    "entry_price": event.fill.fill_price,
                    "entry_reference_price": event.fill.reference_price,
                    "entry_shares": event.fill.shares,
                    "entry_fill_reason": event.fill.reason,
                    "entry_fees": event.fill.fees,
                    "entry_notional": event.fill.notional,
                }
            )

    # 거래를 (종목, 진입일)로 잇는다. 같은 종목이 같은 날 두 번 열릴 수 없어 열쇠가 된다 —
    # `ALREADY_HELD`가 보유 중 재진입을, 같은 날의 가상 예약이 하루 두 번을 막는다.
    trades = {(trade.symbol, trade.entry_date): trade for trade in result.trades}
    if len(trades) != len(result.trades):
        raise RuntimeError("(종목, 진입일)이 거래를 유일하게 가르지 못했습니다.")
    for row in rows.values():
        trade = trades.get((row["symbol"], row.get("entry_date")))
        if trade is None:
            continue
        row.update(
            {
                "exit_date": trade.exit_date,
                "exit_price": trade.exit_price,
                "exit_reason": trade.exit_reason,
                "exit_fill_reason": trade.exit_fill_reason,
                "pnl": trade.pnl,
                "fees": trade.fees,
                "return_r": trade.return_r,
                "sessions_held": trade.sessions_held,
            }
        )

    # 신호 층 척도. 달력은 연구용이라 홀드아웃 밖 종가를 조회하지 않는다.
    calendar = research_calendar(connection)
    assert_no_holdout(calendar)
    position = {date: index for index, date in enumerate(calendar)}
    cache = BarCache(connection, SOURCE_VERSION)
    for row in rows.values():
        index = position.get(row["signal_date"])
        if index is None or index + HORIZON >= len(calendar):
            continue
        value, stale = forward_return(
            cache, row["symbol"], row["signal_date"], calendar[index + HORIZON]
        )
        if value is not None:
            row["forward"] = value
            row["forward_stale"] = stale

    metrics = compute_metrics(result)
    payload = {
        "core": core_key,
        "label": LABELS[core_key],
        "scenario": scenario,
        "rs_lookback": core.policy.parameters.rs_lookback,
        "rs_skip": core.policy.parameters.rs_skip,
        "max_hold_sessions": core.policy.parameters.max_hold_sessions,
        "policy_signature": core.signature,
        "window": [start, end],
        "holdout": holdout_metadata(consumed=False),
        "sizing_math": {
            "risk_per_trade": core.policy.profile.risk_per_trade,
            "stop_atr_multiple": core.policy.parameters.stop_atr_multiple,
            "entry_chase_atr": core.policy.parameters.entry_chase_atr,
            "max_position_weight": core.policy.limits.max_position_weight,
            "max_positions": core.policy.limits.max_positions,
            "max_total_planned_risk": core.policy.limits.max_total_planned_risk,
        },
        "metrics": {
            "trade_count": metrics.trade_count,
            "expectancy_r": metrics.expectancy_r,
            "profit_factor": metrics.profit_factor,
            "win_rate": metrics.win_rate,
            "total_return": metrics.total_return,
            "cagr": metrics.cagr,
            "max_drawdown": metrics.max_drawdown,
            "sharpe": metrics.sharpe,
            "avg_exposure": metrics.avg_exposure,
            "turnover": metrics.turnover,
            "fees_paid": metrics.fees_paid,
            "avg_hold_sessions": metrics.avg_hold_sessions,
        },
        "benchmark": [
            {"label": row.label, "total_return": row.total_return}
            for row in benchmark_table(result.equity_curve, reference_closes(connection))
        ],
        "capacity": capacity_diagnostics(result, core.policy),
        "skip_counts": result.skip_counts,
        "fill_counts": result.fill_counts,
        "exit_counts": result.exit_counts,
        "sessions": len(result.equity_curve),
        "open_at_end": len(result.open_positions),
        "rows": [rows[key] for key in sorted(rows)],
    }
    path = trace_path(core_key, scenario)
    path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")

    accepted = sum(1 for row in rows.values() if row["outcome"] == ACCEPTED)
    filled = sum(1 for row in rows.values() if "entry_date" in row)
    closed = sum(1 for row in rows.values() if "exit_date" in row)
    print(f"  거래 {metrics.trade_count:,} · 총수익 {metrics.total_return:.2%}"
          f" · 기대값 {metrics.expectancy_r:.3f} · MDD {metrics.max_drawdown:.1%}")
    print(f"  TOP5 {len(rows):,} → ACCEPTED {accepted:,} → FILLED {filled:,}"
          f" → CLOSED {closed:,}")
    print(f"  → {path.name}")
    return 0


# ---------------------------------------------------------------- 보고서


def planned() -> list[tuple[str, str]]:
    return [(core, scenario) for core in SIGNALS for scenario in UNRESOLVED_EXIT_PRICES]


def _pct(value, digits: int = 2) -> str:
    return "—" if value is None else f"{value * 100:+.{digits}f}%"


def _share(value, digits: int = 1) -> str:
    return "—" if value is None else f"{value * 100:.{digits}f}%"


def _num(value, digits: int = 3) -> str:
    return "—" if value is None else f"{value:.{digits}f}"


def _money(value) -> str:
    return "—" if value is None else f"${value:,.0f}"


def _delta(left, right):
    return (right - left) if (left is not None and right is not None) else None


def stages_of(rows: list[dict]) -> dict[str, list[dict]]:
    accepted = [row for row in rows if row["outcome"] == ACCEPTED]
    filled = [row for row in accepted if "entry_date" in row]
    closed = [row for row in filled if "exit_date" in row]
    return {"TOP5": rows, "ACCEPTED": accepted, "FILLED": filled, "CLOSED": closed}


def excesses(rows: list[dict], universe: dict) -> list[float]:
    """단계마다 **같은** +42 유니버스 대비 초과수익. 정의를 바꾸지 않는다."""
    values = []
    for row in rows:
        if "forward" not in row:
            continue
        day = universe.get(row["signal_date"])
        if day is None:
            continue
        values.append(row["forward"] - day["mean"])
    return values


def raw_returns(rows: list[dict]) -> list[float]:
    """A. 실제 진입가 → 실제 청산가의 단순 가격 수익률.

    **분할 구간에서는 두 가격의 단위가 다르다**(`Trade` docstring). 손익 판정은 `pnl`과
    `return_r`로 하고 이 값은 §17 표의 한 층으로만 읽는다.
    """
    return [
        row["exit_price"] / row["entry_price"] - 1
        for row in rows
        if row.get("entry_price") and "exit_price" in row
    ]


def net_notional_returns(rows: list[dict]) -> list[float]:
    """B. 진입 notional 대비 순손익. 수수료가 이미 `pnl`에 들어가 있다."""
    return [
        row["pnl"] / row["entry_notional"]
        for row in rows
        if row.get("entry_notional") and "pnl" in row
    ]


def gross_notional_returns(rows: list[dict]) -> list[float]:
    """수수료를 되돌린 총손익 기준. §9의 "가능하면 gross와 fees를 분리"다."""
    return [
        (row["pnl"] + row["fees"]) / row["entry_notional"]
        for row in rows
        if row.get("entry_notional") and "pnl" in row
    ]


def sizing_series(rows: list[dict]) -> dict[str, list[float]]:
    """§13의 다섯 분포. 전부 엔진이 계산한 값에서 나온다."""
    series: dict[str, list[float]] = {
        "atr_fraction": [],
        "stop_fraction": [],
        "entry_notional_weight": [],
        "planned_risk_fraction": [],
        "effective_risk_ratio": [],
    }
    for row in rows:
        entry = row.get("planned_entry")
        if entry:
            series["atr_fraction"].append(row["atr14"] / entry)
            series["stop_fraction"].append(row["stop_distance"] / entry)
        equity = row.get("equity_at_signal")
        if equity and row.get("entry_notional"):
            series["entry_notional_weight"].append(row["entry_notional"] / equity)
        if row.get("planned_risk_fraction") is not None:
            series["planned_risk_fraction"].append(row["planned_risk_fraction"])
        if row.get("effective_risk_ratio") is not None:
            series["effective_risk_ratio"].append(row["effective_risk_ratio"])
    return series


def sizing_summary(rows: list[dict]) -> dict[str, dict]:
    return {key: describe(values) for key, values in sizing_series(rows).items()}


def counted(values) -> dict[str, int]:
    counts: dict[str, int] = {}
    for value in values:
        counts[value] = counts.get(value, 0) + 1
    return counts


def load_traces(scenario: str) -> dict[str, dict]:
    loaded = {}
    for core in SIGNALS:
        path = trace_path(core, scenario)
        if path.exists():
            loaded[core] = json.loads(path.read_text(encoding="utf-8"))
    return loaded


def stage_report(_connection) -> int:
    universe_file = universe_path()
    universe = (
        json.loads(universe_file.read_text(encoding="utf-8"))["by_date"]
        if universe_file.exists()
        else {}
    )
    traces = load_traces(LAST_CLOSE_EXIT)
    zero = load_traces("ZERO")
    missing = [
        f"{SLUGS[core]}/{scenario}"
        for core, scenario in planned()
        if not trace_path(core, scenario).exists()
    ]

    lines = [
        "# 변환 퍼널 진단 — RS 신호는 포트폴리오의 어느 단계에서 사라지는가",
        "",
        "**물은 것 하나:** PR #12의 J126 신호 우위는"
        " `signal → admission → fill → realized trade → R → dollar PnL` 중"
        " **어느 단계에서** 사라지는가.",
        "",
        "**이번 PR은 개입이 아니라 측정이다.** J·K·skip·슬롯·거래당 위험·손절 배수·"
        "종목당 비중·노출 한도·TOP5·후보 수·수량 공식·체결·청산·비용·레짐·폐지 처리를"
        " 하나도 바꾸지 않았다. 새 코어도 만들지 않았고 읽은 것은 `jt-k42`(J63)와"
        " `jt-j126-k42`(J126) 둘뿐이다. 판정 기준 A~L과 PATTERN A/E/S/N 규칙은 러너"
        " docstring에 결과 전에 적어뒀고 `classify_pattern`이 그 규칙을 코드로 들고 있다.",
        "",
        "**main attribution은 LAST_CLOSE다.** ZERO 재실행은 data-exit·sizing 민감도를 같은"
        " 계측으로 재기 위한 보조 진단이고 main 퍼널과 섞지 않는다.",
        "",
        "**개발 표본이다.** 이 구간은 PR #9~#13에서 반복 사용됐고 결과를 OOS 검증이라고"
        " 부르지 않는다.",
        "",
    ]
    if missing:
        lines += [f"**아직 없는 실행 {len(missing)}개:** {', '.join(missing)}", ""]
    if not traces or not universe:
        lines += ["**LAST_CLOSE 추적 또는 유니버스 기준선이 없어 표를 낼 수 없다.**", ""]
        return _write(lines)

    rows = {core: trace["rows"] for core, trace in traces.items()}
    stages = {core: stages_of(rows[core]) for core in traces}
    filled = {core: stages[core]["FILLED"] for core in traces}
    closed = {core: stages[core]["CLOSED"] for core in traces}
    sizing = {core: sizing_summary(filled[core]) for core in traces}

    lines += _reproduction(traces)
    lines += _definitions(universe, traces)
    lines += _survival(traces, stages)
    lines += _rank_composition(stages)
    lines += _stage_excess(stages, universe)
    lines += _trade_returns(closed)
    lines += _sizing_math(traces)
    lines += _binding(filled)
    lines += _distributions(sizing)
    lines += _correlation(filled)
    lines += _volatility_buckets(filled, closed)
    lines += _data_exit(closed, filled, zero, traces)
    verdict_lines, verdict = _verdict(stages, closed, universe, sizing)
    lines += verdict_lines
    lines += _zero_side(zero, traces)
    lines += _exploratory(closed)
    lines += _next_steps(verdict)
    return _write(lines)


def _write(lines: list[str]) -> int:
    path = out_dir() / "results.md"
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("\n".join(lines))
    print(f"\n보고서: {RUNS_DIR.name}/{EXPERIMENT}/{path.name}")
    return 0


def _reproduction(traces: dict) -> list[str]:
    """§4. 재현이 깨지면 퍼널 결과를 해석하지 말고 drift부터 설명한다."""
    expected = {
        BASELINE: [
            ("거래", "514", "trade_count", lambda v: f"{v:,}"),
            ("기대값R", "0.229", "expectancy_r", _num),
            ("총수익", "+35.39%", "total_return", _pct),
            ("MDD", "9.4%", "max_drawdown", _share),
            ("평균 노출", "17.9%", "avg_exposure", _share),
        ],
        CHALLENGER: [
            ("거래", "512", "trade_count", lambda v: f"{v:,}"),
            ("기대값R", "0.233", "expectancy_r", _num),
            ("총수익", "+35.63%", "total_return", _pct),
            ("MDD", "10.8%", "max_drawdown", _share),
            ("평균 노출", "17.8%", "avg_exposure", _share),
        ],
    }
    lines = ["## 1. 재현 — PR #13 LAST_CLOSE", "",
             "**새 결과를 해석하기 전에 기준선이 재현돼야 한다.**", "",
             "|항목|PR #13 J63|이번 J63|PR #13 J126|이번 J126|",
             "|---|---|---|---|---|"]
    if not all(core in traces for core in SIGNALS):
        return lines + ["", "*(두 실행이 모두 있어야 낸다)*", ""]
    for index in range(len(expected[BASELINE])):
        label, want_a, key, fmt = expected[BASELINE][index]
        _, want_c, _, _ = expected[CHALLENGER][index]
        got_a = traces[BASELINE]["metrics"][key]
        got_c = traces[CHALLENGER]["metrics"][key]
        lines.append(f"|{label}|{want_a}|**{fmt(got_a)}**|{want_c}|**{fmt(got_c)}**|")
    lines.append("")
    return lines


def _definitions(universe: dict, traces: dict) -> list[str]:
    trace = next(iter(traces.values()))
    return [
        "## 2. 퍼널 단계와 척도 정의", "",
        "|단계|뜻|",
        "|---|---|",
        "|**STAGE 0** ELIGIBLE TOP5|신호일 유니버스·필터 통과 후 RS 랭킹 TOP5 전체|",
        "|**STAGE 1** PORTFOLIO ACCEPTED|포트폴리오 게이트 통과. **체결이 아니다**|",
        "|**STAGE 2** FILLED|다음 세션에 실제로 체결되어 포지션이 열린 후보|",
        "|**STAGE 3** CLOSED TRADE|실제로 청산까지 끝난 거래|",
        "|**STAGE 4** RAW RETURN|`청산가 / 진입가 - 1`|",
        "|**STAGE 5** R MULTIPLE|엔진의 `pnl / (수량 × 2 ATR)`. 새 R 정의를 만들지 않았다|",
        "|**STAGE 6** DOLLAR|실제 주식 수가 적용된 달러 손익|",
        "",
        f"신호 척도는 **모든 단계에서 같다** — 신호일 `adj_close` → 신호일 +{HORIZON}세션"
        " `adj_close`, 그날 자격 유니버스 평균 대비 초과. PR #12의 정의 그대로이고 거래가"
        " 멈춘 종목은 빼지 않고 마지막 종가로 고정한다.",
        "",
        f"유니버스 기준선 날짜 **{len(universe):,}개** · 실행 구간"
        f" {trace['window'][0]} ~ {trace['window'][1]} ·"
        f" 홀드아웃 `{trace['holdout']['HOLDOUT_START']}`부터 보지 않음"
        f" (`HOLDOUT_CONSUMED = {str(trace['holdout']['HOLDOUT_CONSUMED']).lower()}`).",
        "",
        "**일별 TOP5는 강하게 겹치고 +42 수익률은 41/42가 겹친다.** 관측 수를 독립 표본"
        " 수로 읽지 않고 이 진단에서 p-value를 만들지 않았다.",
        "",
    ]


def _survival(traces: dict, stages: dict) -> list[str]:
    lines = ["## 3. 단계 생존율 (§7)", "",
             "|단계|J63|J126|J63 비율|J126 비율|",
             "|---|---|---|---|---|"]
    counts = {
        core: {name: len(group) for name, group in stages[core].items()}
        for core in stages
    }
    order = [
        ("STAGE 0 TOP5", "TOP5", None),
        ("STAGE 1 ACCEPTED", "ACCEPTED", "TOP5"),
        ("STAGE 2 FILLED", "FILLED", "ACCEPTED"),
        ("STAGE 3 CLOSED", "CLOSED", "FILLED"),
    ]
    for label, key, base in order:
        cells = []
        for core in SIGNALS:
            if core not in counts:
                cells.append("—")
                continue
            value = counts[core][key]
            cells.append(f"{value:,}")
        ratios = []
        for core in SIGNALS:
            if core not in counts or base is None:
                ratios.append("—")
                continue
            divisor = counts[core][base]
            ratios.append(_share(counts[core][key] / divisor) if divisor else "—")
        lines.append(f"|{label}|" + "|".join(cells) + "|" + "|".join(ratios) + "|")

    lines += ["", "### 후보가 어떻게 끝났는가 — 포트폴리오 게이트 (§7)", "",
              "**기존 enum을 그대로 쓴다.** `ACCEPTED`는 게이트 통과이지 체결이 아니다.", "",
              "|사유|J63|J126|J126 − J63|", "|---|---|---|---|"]
    outcomes = counted(
        row["outcome"] for core in stages for row in stages[core]["TOP5"]
    )
    per_core = {
        core: counted(row["outcome"] for row in stages[core]["TOP5"]) for core in stages
    }
    for reason in sorted(outcomes, key=lambda name: -outcomes[name]):
        left = per_core.get(BASELINE, {}).get(reason, 0)
        right = per_core.get(CHALLENGER, {}).get(reason, 0)
        lines.append(f"|`{reason}`|{left:,}|{right:,}|{right - left:+,}|")

    lines += ["", "### ACCEPTED가 체결로 가지 못한 사유 (§7)", "",
              "게이트를 통과한 주문이 다음 세션에서 어떻게 빠졌는가. 관찰자가 주문마다"
              " 붙인 값이라 합계가 아니라 **후보 단위**다.", "",
              "|사유|J63|J126|J126 − J63|", "|---|---|---|---|"]
    cancels = {
        core: counted(
            row["fill_cancel_reason"]
            for row in stages[core]["ACCEPTED"]
            if "fill_cancel_reason" in row
        )
        for core in stages
    }
    every = sorted({name for core in cancels for name in cancels[core]})
    for reason in every:
        left = cancels.get(BASELINE, {}).get(reason, 0)
        right = cancels.get(CHALLENGER, {}).get(reason, 0)
        lines.append(f"|`{reason}`|{left:,}|{right:,}|{right - left:+,}|")
    orphans = {
        core: sum(
            1
            for row in stages[core]["ACCEPTED"]
            if "entry_date" not in row and "fill_cancel_reason" not in row
        )
        for core in stages
    }
    left, right = orphans.get(BASELINE, 0), orphans.get(CHALLENGER, 0)
    lines.append(f"|`NO_EXECUTION_SESSION`|{left:,}|{right:,}|{right - left:+,}|")
    lines += ["", "`NO_EXECUTION_SESSION`은 엔진 사유가 아니라 구간 경계다 — 구간 마지막"
              " 세션에 만든 주문은 집행할 다음 세션이 없다.", ""]

    lines += ["### 남아 있는 포지션", "",
              "|항목|J63|J126|", "|---|---|---|"]
    lines.append(
        "|구간 끝에 열린 포지션|"
        + "|".join(str(traces[core]["open_at_end"]) if core in traces else "—"
                   for core in SIGNALS)
        + "|"
    )
    lines.append("")
    return lines


def _rank_composition(stages: dict) -> list[str]:
    lines = ["## 4. 랭크 구성 (§8)", "",
             "랭크는 유니버스·필터 통과 후 RS 정렬, **포트폴리오 제약 적용 전** 순위다."
             " 새 rank cutoff를 만들지 않았다.", ""]
    for name in ("TOP5", "ACCEPTED", "FILLED"):
        lines += [f"**{name}**", "",
                  "|랭크|" + "|".join(f"{LABELS[c]} 수|{LABELS[c]} 비중" for c in SIGNALS)
                  + "|",
                  "|---|" + "---|" * (2 * len(SIGNALS))]
        totals = {
            core: len(stages[core][name]) if core in stages else 0 for core in SIGNALS
        }
        for rank in range(1, TOP_N + 1):
            cells = []
            for core in SIGNALS:
                if core not in stages:
                    cells += ["—", "—"]
                    continue
                count = sum(1 for row in stages[core][name] if row["rank"] == rank)
                cells.append(f"{count:,}")
                cells.append(_share(count / totals[core]) if totals[core] else "—")
            lines.append(f"|{rank}|" + "|".join(cells) + "|")
        lines.append("")
    return lines


def _stage_excess(stages: dict, universe: dict) -> list[str]:
    lines = ["## 5. 단계별 +42 유니버스 대비 초과수익 (§6)", "",
             "**같은 척도를 세 단계에 그대로 적용한다.** 이 세 행은 단위가 같으므로"
             " 서로 뺄 수 있다 — 아래 §17 표의 나머지 행과 달리 여기서는 감소폭을 직접"
             " 읽어도 된다.", "",
             "|단계|J63 평균|J63 중앙|관측|J126 평균|J126 중앙|관측|**J126 − J63**|",
             "|---|---|---|---|---|---|---|---|"]
    for name in ("TOP5", "ACCEPTED", "FILLED"):
        cells = []
        means = {}
        for core in SIGNALS:
            if core not in stages:
                cells += ["—", "—", "—"]
                continue
            values = excesses(stages[core][name], universe)
            means[core] = _fmean(values)
            cells += [_pct(means[core]), _pct(_median(values)), f"{len(values):,}"]
        delta = _delta(means.get(BASELINE), means.get(CHALLENGER))
        lines.append(f"|{name}|" + "|".join(cells) + f"|**{_pct(delta)}**|")
    lines.append("")
    return lines


def _trade_returns(closed: dict) -> list[str]:
    lines = ["## 6. 실제 체결된 거래의 두 수익률 (§9)", "",
             "**A는 가격 수익률, B는 진입 notional 대비 순수익률이다.** 분할이 낀 구간에서"
             " A는 두 가격의 단위가 달라질 수 있어(`Trade` docstring) 손익 판정에는 쓰지"
             " 않고 층 비교로만 읽는다.", "",
             "|값|J63 평균|J63 중앙|J126 평균|J126 중앙|**delta(평균)**|",
             "|---|---|---|---|---|---|"]
    series = [
        ("A. raw 가격 수익률", raw_returns, _pct),
        ("B. 진입 notional 대비 순수익", net_notional_returns, _pct),
        ("B'. 같은 기준 총수익 (수수료 제외 전)", gross_notional_returns, _pct),
        ("C. 실현 R", lambda rows: [r["return_r"] for r in rows if "return_r" in r], _num),
    ]
    for label, extract, fmt in series:
        cells, means = [], {}
        for core in SIGNALS:
            values = extract(closed.get(core, []))
            means[core] = _fmean(values)
            cells += [fmt(means[core]), fmt(_median(values))]
        lines.append(
            f"|{label}|" + "|".join(cells)
            + f"|**{fmt(_delta(means.get(BASELINE), means.get(CHALLENGER)))}**|"
        )

    lines += ["", "|달러|J63|J126|delta|", "|---|---|---|---|"]
    for label, extract, fmt in (
        ("총 순손익", lambda rows: sum(r["pnl"] for r in rows if "pnl" in r), _money),
        ("총 수수료", lambda rows: sum(r["fees"] for r in rows if "fees" in r), _money),
        (
            "거래당 순손익",
            lambda rows: (
                sum(r["pnl"] for r in rows if "pnl" in r) / len(rows) if rows else None
            ),
            _money,
        ),
        (
            "평균 진입 notional",
            lambda rows: _fmean(
                [r["entry_notional"] for r in rows if "entry_notional" in r]
            ),
            _money,
        ),
    ):
        values = {core: extract(closed.get(core, [])) for core in SIGNALS}
        lines.append(
            f"|{label}|{fmt(values.get(BASELINE))}|{fmt(values.get(CHALLENGER))}"
            f"|{fmt(_delta(values.get(BASELINE), values.get(CHALLENGER)))}|"
        )
    lines.append("")
    return lines


def _sizing_math(traces: dict) -> list[str]:
    trace = next(iter(traces.values()))
    math_config = trace["sizing_math"]
    return [
        "## 7. 현재 sizing 수학 (§11)", "",
        "위험 상한이 구속할 때:", "",
        "```",
        "shares ≈ equity × risk_per_trade / (stop_atr_multiple × ATR14)",
        "",
        "position_notional ≈ equity × risk_per_trade × price / (stop_atr_multiple × ATR14)",
        "                 ∝ price / ATR = 1 / normalized_ATR",
        "```",
        "",
        f"현재 값은 `risk_per_trade = {math_config['risk_per_trade']:.2%}` ·"
        f" `stop_atr_multiple = {math_config['stop_atr_multiple']:g}` ·"
        f" `entry_chase_atr = {math_config['entry_chase_atr']:g}` ·"
        f" `max_position_weight = {math_config['max_position_weight']:.0%}` ·"
        f" 슬롯 {math_config['max_positions']} ·"
        f" 총 계획 위험 {math_config['max_total_planned_risk']:.2%}이다.",
        "",
        "**즉 notional은 단순히 `1/ATR`가 아니라 `1/정규화 ATR`에 비례한다.** 다만 실제"
        " 최종 수량은 위험·자본·유동성·노출·섹터·상관 상한의 최솟값이므로, 그 비례가"
        " 실제로 작동하려면 위험 상한이 구속해야 한다. 아래 §8이 그것을 잰다.",
        "",
        "**이 PR에서 이 공식을 바꾸지 않았다.**",
        "",
    ]


def _binding(filled: dict) -> list[str]:
    lines = ["## 8. 실제 구속 제약 (§12)", "",
             "**`R/2ATR`가 포지션 크기를 정한다고 말하려면 RISK가 실제로 구속해야 한다.**"
             " 엔진이 `SizedIntent.binding_constraint`에 적은 값을 그대로 센다.", "",
             "|제약|J63|J63 비중|J126|J126 비중|", "|---|---|---|---|---|"]
    per_core = {
        core: counted(row["binding_constraint"] for row in filled.get(core, []))
        for core in SIGNALS
    }
    totals = {core: len(filled.get(core, [])) for core in SIGNALS}
    every = sorted({name for core in per_core for name in per_core[core]})
    for name in every:
        cells = []
        for core in SIGNALS:
            count = per_core[core].get(name, 0)
            cells += [f"{count:,}", _share(count / totals[core]) if totals[core] else "—"]
        lines.append(f"|`{name}`|" + "|".join(cells) + "|")
    lines.append("")
    return lines


def _distributions(sizing: dict) -> list[str]:
    labels = {
        "atr_fraction": "ATR14 / 계획 진입가",
        "stop_fraction": "손절폭 / 계획 진입가",
        "entry_notional_weight": "진입 notional 비중",
        "planned_risk_fraction": "계획 위험 비율",
        "effective_risk_ratio": "실효 위험 비율",
    }
    lines = ["## 9. J63 vs J126 sizing 분포 (§13)", "",
             "체결된 진입만 본다. **이 표를 재기 전에는 \"J126이 저변동 종목을 골라 더 큰"
             " 포지션이 된다\"를 적지 않는다.**", ""]
    for key, label in labels.items():
        lines += [f"**{label}**", "",
                  "|J|평균|중앙|p10|p25|p75|p90|최대|관측|",
                  "|---|---|---|---|---|---|---|---|---|"]
        fmt = _num if key == "effective_risk_ratio" else (
            lambda v: "—" if v is None else f"{v * 100:.3f}%"
        )
        for core in SIGNALS:
            cell = sizing.get(core, {}).get(key)
            if not cell:
                continue
            lines.append(
                f"|**{LABELS[core]}**|{fmt(cell['mean'])}|{fmt(cell['median'])}"
                f"|{fmt(cell['p10'])}|{fmt(cell['p25'])}|{fmt(cell['p75'])}"
                f"|{fmt(cell['p90'])}|{fmt(cell['max'])}|{cell['count']:,}|"
            )
        left = sizing.get(BASELINE, {}).get(key, {}).get("median")
        right = sizing.get(CHALLENGER, {}).get(key, {}).get("median")
        relative = (
            f" ({right / left - 1:+.1%} 상대)" if left not in (None, 0) and right else ""
        )
        lines += ["",
                  f"`median(J126) - median(J63)` = **{fmt(_delta(left, right))}**{relative}",
                  ""]

    differ = distributions_differ(
        sizing.get(BASELINE, {}), sizing.get(CHALLENGER, {})
    )
    verdict = (
        "중앙값 차이가 문턱을 넘었다"
        if differ
        else "중앙값 차이가 문턱에서 지지되지 않았다"
    )
    lines += [
        f"사전등록한 문턱은 두 축(정규화 ATR · 진입 notional 비중) 중 하나의 중앙값이"
        f" 상대적으로 **{DISTRIBUTION_TOLERANCE:.0%} 이상** 다른 것이다."
        f" 판정: **{verdict}**.",
        "",
        "**문턱 미달을 \"차이가 없다\"의 증명으로 읽지 않는다.** 이 판정이 말하는 것은"
        f" \"J63/J126의 전체 sizing 분포 차이가 사전등록한 {DISTRIBUTION_TOLERANCE:.0%}"
        " median 기준에서 지지되지 않았다\"까지이고, 그것은 차이가 존재하지 않는다는 뜻이"
        " 아니다. 중앙값 하나로 재는 문턱이라 꼬리에 있는 차이는 애초에 잡지 못한다"
        " (§20.3이 그 꼬리를 따로 본다).",
        "",
    ]
    return lines


def _correlation(filled: dict) -> list[str]:
    lines = ["## 10. 정규화 ATR ↔ notional 비중 (§14)", "",
             "**Spearman 순위 상관**을 썼다. 두 값 모두 오른쪽으로 크게 치우쳐 있어 몇 건의"
             " 꼬리가 Pearson을 지배하기 때문이다. **formal significance test는 하지"
             " 않았다.**", "",
             "|표본|Spearman ρ|관측|", "|---|---|---|"]
    pooled_x: list[float] = []
    pooled_y: list[float] = []
    for core in SIGNALS:
        series = sizing_series(filled.get(core, []))
        xs, ys = series["atr_fraction"], series["entry_notional_weight"]
        size = min(len(xs), len(ys))
        xs, ys = xs[:size], ys[:size]
        pooled_x += xs
        pooled_y += ys
        lines.append(f"|{LABELS[core]}|{_num(spearman(xs, ys))}|{size:,}|")
    lines.append(f"|합침|{_num(spearman(pooled_x, pooled_y))}|{len(pooled_x):,}|")
    lines += ["",
              "완전한 inverse-vol 가중이면 ρ = -1이다. 실제 값이 그보다 얼마나 약한지가"
              " 다른 상한이 얼마나 끼어드는지를 말해준다.", ""]
    return lines


def _volatility_buckets(filled: dict, closed: dict) -> list[str]:
    """§15. **경계는 두 J를 합친 분포에서 만든다.** 따로 나누면 칸의 뜻이 갈린다."""
    pooled = sorted(
        value
        for core in SIGNALS
        for value in sizing_series(filled.get(core, []))["atr_fraction"]
    )
    lines = ["## 11. 변동성 5분위 귀속 (§15)", ""]
    if len(pooled) < VOL_BUCKETS:
        return lines + ["*(체결된 진입이 모자라 낼 수 없다)*", ""]
    edges = [
        pooled[min(len(pooled) - 1, int(index * len(pooled) / VOL_BUCKETS))]
        for index in range(1, VOL_BUCKETS)
    ]

    def bucket_of(value: float) -> int:
        for index, edge in enumerate(edges):
            if value < edge:
                return index + 1
        return VOL_BUCKETS

    lines += ["**경계는 J63과 J126을 합친 분포에서 만들었다.** J별로 5분위를 내면 Q1이"
              " 서로 다른 변동성을 뜻하게 되어 비교가 성립하지 않는다.", "",
              "경계(ATR14 / 계획 진입가): "
              + " · ".join(f"{edge * 100:.3f}%" for edge in edges),
              "",
              "**`net 평균` 열은 결과를 본 뒤 더한 측정이다.** 칸 경계와 칸 수는 그대로이고"
              " 판정에 쓰이지 않는다 — §20.4의 정렬 진단과 함께 읽으라고 붙였다.", "",
              "|칸|J|거래|raw 평균|raw 중앙|net 평균|R 평균|총 달러|평균 notional 비중|data-exit|",
              "|---|---|---|---|---|---|---|---|---|---|"]
    grouped: dict[tuple[int, str], list[dict]] = {}
    for bucket in range(1, VOL_BUCKETS + 1):
        for core in SIGNALS:
            group = []
            for row in closed.get(core, []):
                entry = row.get("planned_entry")
                if not entry or "exit_price" not in row:
                    continue
                if bucket_of(row["atr14"] / entry) == bucket:
                    group.append(row)
            grouped[(bucket, core)] = group
            if not group:
                lines.append(f"|Q{bucket}|{LABELS[core]}|0|—|—|—|—|—|—|—|")
                continue
            raws = raw_returns(group)
            weights = [
                row["entry_notional"] / row["equity_at_signal"]
                for row in group
                if row.get("equity_at_signal") and row.get("entry_notional")
            ]
            data_exit = sum(
                1 for row in group if row.get("exit_reason") in DATA_EXIT_REASONS
            )
            lines.append(
                f"|Q{bucket}|{LABELS[core]}|{len(group):,}|{_pct(_fmean(raws))}"
                f"|{_pct(_median(raws))}"
                f"|{_pct(_fmean(net_notional_returns(group)))}"
                f"|{_num(_fmean([r['return_r'] for r in group if 'return_r' in r]))}"
                f"|{_money(sum(r['pnl'] for r in group if 'pnl' in r))}"
                f"|{_share(_fmean(weights))}|{data_exit}|"
            )
    lines += ["", "Q1이 가장 낮은 정규화 변동성이다. **칸마다 표본이 작으므로 한 칸의"
              " 값을 일반 결론으로 확장하지 않는다.**", "",
              "**칸별 J126 − J63 (결과를 본 뒤 더한 측정)**", "",
              "|칸|raw delta|net delta|", "|---|---|---|"]
    for bucket in range(1, VOL_BUCKETS + 1):
        left, right = grouped.get((bucket, BASELINE), []), grouped.get(
            (bucket, CHALLENGER), []
        )
        lines.append(
            f"|Q{bucket}"
            f"|{_pct(_delta(_fmean(raw_returns(left)), _fmean(raw_returns(right))))}"
            f"|{_pct(_delta(_fmean(net_notional_returns(left)), _fmean(net_notional_returns(right))))}|"
        )
    lines += ["",
              "**Q1·Q5 한 칸만 보고 결론을 내지 않는다.** 이 표는 §20.4의 정렬 진단과"
              " 함께 읽는 보조 자료다.", ""]
    return lines


def _data_exit(closed: dict, filled: dict, zero: dict, traces: dict) -> list[str]:
    lines = ["## 12. data-exit 거래의 sizing 위치 (§16)", "",
             "폐지·정체불명으로 끝난 거래가 그 J 전체 체결 분포의 어디에 있는가."
             " **J당 한 자릿수 표본이므로 일반적인 분포 결론으로 확장하지 않는다.**", "",
             "**이 표가 답하는 것은 위치뿐이다.** 아래 §19의 ZERO 손실 **규모** 차이는"
             " 이 표로 설명되지 않는다 — 위치가 같아도 건당 손실 크기는 다를 수 있다.", "",
             "|값|J63|J63 백분위|J126|J126 백분위|", "|---|---|---|---|---|"]
    axes = {
        "정규화 ATR": ("atr_fraction", lambda v: f"{v * 100:.3f}%"),
        "진입 notional 비중": ("entry_notional_weight", _share),
        "계획 위험 비율": ("planned_risk_fraction", lambda v: f"{v * 100:.3f}%"),
    }
    exits = {
        core: [
            row for row in closed.get(core, [])
            if row.get("exit_reason") in DATA_EXIT_REASONS
        ]
        for core in SIGNALS
    }
    lines.append(
        "|건수|" + "|".join(f"{len(exits[core])}|—" for core in SIGNALS) + "|"
    )
    for label, (key, fmt) in axes.items():
        cells = []
        for core in SIGNALS:
            everything = sizing_series(filled.get(core, []))[key]
            subset = sizing_series(exits[core])[key]
            point = _median(subset)
            cells += [
                fmt(point) if point is not None else "—",
                (
                    f"{percentile_of(everything, point):.0f}백분위"
                    if point is not None and everything
                    else "—"
                ),
            ]
        lines.append(f"|{label} 중앙|" + "|".join(cells) + "|")

    lines += ["", "|값|J63|J126|", "|---|---|---|"]
    lines.append(
        "|data-exit 순손익|"
        + "|".join(
            _money(sum(row["pnl"] for row in exits[core] if "pnl" in row))
            for core in SIGNALS
        )
        + "|"
    )
    lines.append(
        "|구속 제약|"
        + "|".join(
            ", ".join(
                f"`{name}` {count}"
                for name, count in sorted(
                    counted(
                        row["binding_constraint"]
                        for row in exits[core]
                        if "binding_constraint" in row
                    ).items()
                )
            )
            or "—"
            for core in SIGNALS
        )
        + "|"
    )
    lines.append("")
    return lines


def _verdict(stages: dict, closed: dict, universe: dict, sizing: dict):
    """§17 decay 표와 §22 A~L, §21 PATTERN 판정."""
    layers = []
    for name in ("TOP5", "ACCEPTED", "FILLED"):
        values = {
            core: _fmean(excesses(stages[core][name], universe)) for core in stages
        }
        layers.append((f"{name} +{HORIZON} 초과수익", values, _pct, "유니버스 대비 %"))
    for label, extract, fmt, unit in (
        ("체결 raw 거래 수익률", raw_returns, _pct, "raw %"),
        ("체결 net-notional 수익률", net_notional_returns, _pct, "notional 대비 %"),
        ("실현 R", lambda rows: [r["return_r"] for r in rows if "return_r" in r], _num, "R"),
        (
            "거래당 달러 기여",
            lambda rows: [r["pnl"] for r in rows if "pnl" in r],
            _money,
            "달러",
        ),
    ):
        values = {core: _fmean(extract(closed.get(core, []))) for core in closed}
        layers.append((label, values, fmt, unit))

    lines = ["## 13. 신호 우위 decay 표 (§17)", "",
             "**단위가 다른 행을 그대로 빼서 하나의 연속 척도로 읽지 않는다.** 각 층에서"
             " 방향과 차이만 본다. 예외는 위 세 행인데 셋 다 같은 \"유니버스 대비 +42"
             " 초과수익\"이라 그 안에서는 뺄 수 있다.", "",
             "|층|단위|J63|J126|J126 − J63|방향|",
             "|---|---|---|---|---|---|"]
    for label, values, fmt, unit in layers:
        left, right = values.get(BASELINE), values.get(CHALLENGER)
        delta = _delta(left, right)
        direction = (
            "—" if delta is None else
            "J126 > J63" if delta > 0 else "J126 < J63" if delta < 0 else "동일"
        )
        lines.append(
            f"|{label}|{unit}|{fmt(left)}|{fmt(right)}|**{fmt(delta)}**|{direction}|"
        )

    deltas = {
        key: _delta(values.get(BASELINE), values.get(CHALLENGER))
        for key, (_, values, _, _) in zip(
            ("top5_excess", "accepted_excess", "filled_excess", "raw_return",
             "net_notional_return", "realized_r", "dollar_per_trade"),
            layers,
        )
    }

    top5 = {core: _fmean(excesses(stages[core]["TOP5"], universe)) for core in stages}
    fill = {core: _fmean(excesses(stages[core]["FILLED"], universe)) for core in stages}
    admission_loss = {
        core: _delta(top5.get(core), fill.get(core)) for core in SIGNALS
    }
    interaction = _delta(admission_loss.get(BASELINE), admission_loss.get(CHALLENGER))

    lines += ["", "## 14. admission loss (§18)", "",
              "`admission_loss = FILLED 초과수익 − TOP5 초과수익`. 두 값이 같은 단위라"
              " 뺄 수 있다.", "",
              "|값|J63|J126|", "|---|---|---|",
              f"|TOP5 +{HORIZON}|{_pct(top5.get(BASELINE))}|{_pct(top5.get(CHALLENGER))}|",
              f"|FILLED +{HORIZON}|{_pct(fill.get(BASELINE))}|{_pct(fill.get(CHALLENGER))}|",
              f"|**admission_loss**|**{_pct(admission_loss.get(BASELINE))}**"
              f"|**{_pct(admission_loss.get(CHALLENGER))}**|",
              "",
              f"`admission_interaction` = **{_pct(interaction)}**."
              " 음수가 클수록 좋은 신호 정보가 admission·체결 과정에서 더 많이 소실됐다는"
              " 뜻이고, **그 경우 sizing을 범인으로 지목하지 않는다.**",
              ""]

    lines += ["## 15. execution / horizon loss (§19)", "",
              "A는 신호일 종가 → +42세션 종가, B는 실제 체결 → 실제 청산이다."
              " **A의 유니버스 대비 값과 B의 절대값은 단위가 다르므로** raw끼리도 함께"
              " 싣는다. 이 차이에는 익일 진입 · 갭 취소 · 42세션 계산 기준 차이 ·"
              " 실제 청산 처리가 함께 들어 있어 **하나의 원인으로 단정하지 않는다.**", "",
              "|값|J63|J126|", "|---|---|---|"]
    raw_forward = {
        core: _fmean([row["forward"] for row in closed.get(core, []) if "forward" in row])
        for core in SIGNALS
    }
    actual = {core: _fmean(raw_returns(closed.get(core, []))) for core in SIGNALS}
    lines += [
        f"|A. 신호 forward +{HORIZON} (raw)|{_pct(raw_forward.get(BASELINE))}"
        f"|{_pct(raw_forward.get(CHALLENGER))}|",
        f"|A'. 같은 후보의 유니버스 대비|{_pct(fill.get(BASELINE))}"
        f"|{_pct(fill.get(CHALLENGER))}|",
        f"|B. 실제 진입 → 청산 raw|{_pct(actual.get(BASELINE))}"
        f"|{_pct(actual.get(CHALLENGER))}|",
        f"|**execution_horizon_delta** (B − A)"
        f"|**{_pct(_delta(raw_forward.get(BASELINE), actual.get(BASELINE)))}**"
        f"|**{_pct(_delta(raw_forward.get(CHALLENGER), actual.get(CHALLENGER)))}**|",
        "",
    ]

    differ = distributions_differ(
        sizing.get(BASELINE, {}), sizing.get(CHALLENGER, {})
    )
    pattern = classify_pattern(deltas, differ)
    answer = next_intervention(pattern)

    binding = {
        core: counted(
            row["binding_constraint"] for row in stages.get(core, {}).get("FILLED", [])
        )
        for core in SIGNALS
    }
    dominant = {}
    for core in SIGNALS:
        if binding.get(core):
            name, count = max(binding[core].items(), key=lambda item: item[1])
            total = sum(binding[core].values())
            dominant[core] = f"`{name}` {count / total:.0%}"

    lines += ["## 16. 사전 판정 기준 A~L (§22)", "",
              "|기준|물음|답|", "|---|---|---|"]
    judgments = [
        ("A", "PR #12의 TOP5 J126 우위가 이 러너에서도 재현되는가",
         _yes_no(deltas.get("top5_excess"), f"delta {_pct(deltas.get('top5_excess'))}")),
        ("B", "ACCEPTED 단계에서도 유지되는가",
         _yes_no(deltas.get("accepted_excess"),
                 f"delta {_pct(deltas.get('accepted_excess'))}")),
        ("C", "FILLED 단계에서도 유지되는가",
         _yes_no(deltas.get("filled_excess"),
                 f"delta {_pct(deltas.get('filled_excess'))}")),
        ("D", "실제 raw 퍼센트 거래 수익률에서도 유지되는가",
         _yes_no(deltas.get("raw_return"), f"delta {_pct(deltas.get('raw_return'))}")),
        ("E", "R 배수에서 유지되는가",
         _yes_no(deltas.get("realized_r"), f"delta {_num(deltas.get('realized_r'))}")),
        ("F", "달러 손익 기여에서도 유지되는가",
         _yes_no(deltas.get("dollar_per_trade"),
                 f"delta {_money(deltas.get('dollar_per_trade'))}")),
        ("G", "정규화 ATR 분포가 실제로 다른가",
         _median_verdict(sizing, "atr_fraction")),
        ("H", "진입 notional 비중 분포가 다른가",
         _median_verdict(sizing, "entry_notional_weight")),
        ("I", "실제 sizing 구속 제약이 무엇인가",
         " · ".join(f"{LABELS[core]} {dominant[core]}" for core in dominant) or "—"),
        ("J", "data-exit 거래가 큰 notional·낮은 변동성 꼬리에 있는가",
         _data_exit_verdict(stages)),
        ("K", "신호 우위의 가장 큰 소실이 어느 단계 사이인가",
         _largest_drop(deltas)),
        ("L", "현재 증거로 sizing을 다음 개입 대상으로 올릴 수 있는가",
         f"**{answer}**"),
    ]
    for key, question, answer_text in judgments:
        lines.append(f"|**{key}**|{question}|{answer_text}|")

    lines += ["", "## 17. PATTERN 판정 (§21)", "",
              "`classify_pattern`이 러너 docstring의 표를 그대로 코드로 들고 있고"
              " `test_funnel.py`가 그 분류를 잠근다. **결과를 본 뒤 규칙을 바꾸지 않았다.**",
              "",
              f"- TOP5 delta `{_pct(deltas.get('top5_excess'))}`"
              f" · FILLED delta `{_pct(deltas.get('filled_excess'))}`"
              f" · raw delta `{_pct(deltas.get('raw_return'))}`"
              f" · R delta `{_num(deltas.get('realized_r'))}`"
              f" · 달러 delta `{_money(deltas.get('dollar_per_trade'))}`",
              f"- sizing 분포 차이: **{'있음' if differ else '문턱 미만'}**"
              f" (사전등록 문턱 {DISTRIBUTION_TOLERANCE:.0%})",
              "",
              f"### PATTERN **{pattern}**", "",
              *_registration_gap(deltas, pattern),
              "## 18. 최종 답 (§30)", "",
              f"**Q1. J126의 신호 우위가 가장 크게 사라지는 단계는 어디인가 →"
              f" `{pattern}`**", "",
              f"**Q2. 다음 research intervention으로 sizing ablation을 올릴 근거가 있는가 →"
              f" `{answer}`**", ""]
    return lines, {"pattern": pattern, "answer": answer, "deltas": deltas}


def _registration_gap(deltas: dict, pattern: str) -> list[str]:
    """사전등록한 규칙이 이 데이터를 어떻게 다뤘는지 있는 그대로 적는다.

    **규칙을 결과 보고 고치지 않는다.** 대신 규칙이 무엇을 못 잡는지를 남긴다 — 그것을
    적지 않으면 다음 사람이 `NO_CLEAR_STAGE`를 "층 사이에 아무 일도 없었다"로 읽는다.
    """
    top5, raw = deltas.get("top5_excess"), deltas.get("raw_return")
    realized_r, dollar = deltas.get("realized_r"), deltas.get("dollar_per_trade")
    if pattern != "NO_CLEAR_STAGE" or None in (top5, raw, realized_r, dollar):
        return []
    if top5 <= 0 or raw <= 0:
        return []
    return [
        "**사전등록 규칙의 한계를 그대로 적는다.** 이 판정은 `classify_pattern`이"
        " **부호만** 보기 때문에 나왔다 — PATTERN S가 요구하는 \"R 또는 달러에서 축소·역전\"을"
        " 코드는 역전(`≤ 0`)으로만 구현했다. 이번 데이터는 정확히 그 틈에 떨어졌다:"
        f" raw 층 delta `{_pct(raw)}`가 R 층에서 `{_num(realized_r)}`,"
        f" 달러 층에서 `{_money(dollar)}`로 **부호는 유지한 채 크기만 무너진다.**",
        "",
        "**그래도 규칙을 고치지 않았다.** 결과를 본 뒤 문턱을 고치면 사전등록이 아무것도"
        " 보증하지 못한다. 크기 변화는 아래 §20에 **탐색적 후속 진단**으로 따로 뒀고 A~L"
        " 판정과 섞지 않았다.",
        "",
        "**그러므로 `NO_CLEAR_STAGE`를 \"층 사이에 아무 일도 없었다\"로 읽지 않는다.**"
        " 읽을 수 있는 것은 \"사전등록한 부호 기준으로는 collapse point를 지목할 수"
        " 없다\"까지다.",
        "",
    ]


def _yes_no(value, detail: str) -> str:
    if value is None:
        return "—"
    return f"{'**예**' if value > 0 else '**아니오**'} ({detail})"


def _median_verdict(sizing: dict, key: str) -> str:
    """**문턱 미달은 "차이 없음"이 아니라 "이 기준에서 지지되지 않음"이다.**"""
    left = sizing.get(BASELINE, {}).get(key, {}).get("median")
    right = sizing.get(CHALLENGER, {}).get(key, {}).get("median")
    if left in (None, 0) or right is None:
        return "—"
    relative = right / left - 1
    if abs(relative) >= DISTRIBUTION_TOLERANCE:
        return f"**문턱을 넘었다** (중앙 {relative:+.1%} 상대)"
    return (
        f"**문턱에서 지지되지 않았다** (중앙 {relative:+.1%} 상대,"
        f" 문턱 {DISTRIBUTION_TOLERANCE:.0%}) — 차이가 없다는 뜻이 아니다"
    )


def _data_exit_verdict(stages: dict) -> str:
    """§22 J. data-exit가 큰 notional·낮은 변동성 쪽에 있는가를 백분위로 답한다.

    **표본이 J당 한 자릿수다.** 위치를 적을 뿐 분포 결론으로 확장하지 않는다.
    """
    parts = []
    for core in SIGNALS:
        filled = stages.get(core, {}).get("FILLED", [])
        exits = [
            row for row in stages.get(core, {}).get("CLOSED", [])
            if row.get("exit_reason") in DATA_EXIT_REASONS
        ]
        if not exits or not filled:
            continue
        cells = []
        for key, name in (("entry_notional_weight", "notional"), ("atr_fraction", "ATR")):
            everything = sizing_series(filled)[key]
            point = _median(sizing_series(exits)[key])
            place = percentile_of(everything, point)
            if place is not None:
                cells.append(f"{name} {place:.0f}백분위")
        parts.append(f"{LABELS[core]} {len(exits)}건 · " + " · " .join(cells))
    return " / ".join(parts) or "—"


def _largest_drop(deltas: dict) -> str:
    """**단위가 같은 세 층 안에서만** 감소폭을 견준다.

    `delta`가 층마다 얼마나 줄었는지를 본다. 음수면 그 구간에서 오히려 벌어진 것이다.
    """
    steps = [
        ("TOP5 → ACCEPTED", _delta(deltas.get("accepted_excess"), deltas.get("top5_excess"))),
        ("ACCEPTED → FILLED",
         _delta(deltas.get("filled_excess"), deltas.get("accepted_excess"))),
    ]
    usable = [(name, value) for name, value in steps if value is not None]
    if not usable:
        return "—"
    name, value = max(usable, key=lambda item: item[1])
    detail = " · ".join(f"{step} {_pct(amount)}" for step, amount in usable)
    return (
        f"**{name}** ({detail}) — FILLED 이후 층은 단위가 달라 같은 척도로 견주지 않는다"
    )


def _zero_side(zero: dict, traces: dict) -> list[str]:
    lines = ["## 19. ZERO 보조 진단 (§16·§27)", "",
             "**main attribution은 LAST_CLOSE다.** ZERO는 data-exit·sizing 민감도를 같은"
             " 계측으로 재기 위한 보조 진단이고 위 퍼널 판정에 섞지 않았다.", ""]
    if not zero:
        return lines + ["*(ZERO 실행이 아직 없다)*", ""]
    lines += ["|지표|J63 LAST_CLOSE|J63 ZERO|J126 LAST_CLOSE|J126 ZERO|",
              "|---|---|---|---|---|"]
    for label, key, fmt in (
        ("총수익", "total_return", _pct),
        ("기대값R", "expectancy_r", _num),
        ("거래", "trade_count", lambda v: f"{v:,}"),
        ("MDD", "max_drawdown", _share),
    ):
        cells = []
        for core in SIGNALS:
            for table in (traces, zero):
                run = table.get(core)
                cells.append(fmt(run["metrics"][key]) if run else "—")
        lines.append(f"|{label}|" + "|".join(cells) + "|")

    lines += ["", "|data-exit|J63|J126|", "|---|---|---|"]
    for label, table in (("LAST_CLOSE 순손익", traces), ("ZERO 순손익", zero)):
        cells = []
        for core in SIGNALS:
            run = table.get(core)
            if not run:
                cells.append("—")
                continue
            rows = [
                row for row in run["rows"]
                if row.get("exit_reason") in DATA_EXIT_REASONS
            ]
            cells.append(f"{_money(sum(row['pnl'] for row in rows))} ({len(rows)}건)")
        lines.append(f"|{label}|" + "|".join(cells) + "|")

    lines += ["",
              "**여기서 말할 수 있는 것과 없는 것을 가른다.** data-exit 거래가"
              " low-vol · high-notional 꼬리에 위치하는 **구조**는 J63과 J126 **모두에서**"
              " 관찰됐다(§12). 따라서 그 구조 자체는 J126 고유 현상이 아니다."
              " **다만 J126의 더 큰 ZERO 손실 규모는 이 진단만으로 설명되지 않는다** —"
              " 위치가 같아도 건당 손실 크기가 왜 다른지는 재지 않았고, 표본이 9건·6건이라"
              " 이 진단으로 답할 수 있는 질문도 아니다.",
              ""]
    return lines


TAIL_SIZE = 10


def _exploratory(closed: dict) -> list[str]:
    """**사전등록이 아니다.** 결과를 본 뒤 추가한 후속 진단이라 A~L·PATTERN과 섞지 않는다.

    사전 기준을 소급해 바꾸지 않고 새 기준을 만들지 않는다. 여기서 재는 것은 셋이다 —
    R이 퍼센트 수익률에서 어떤 산술로 만들어지는가, 층 사이에서 **크기**가 어떻게 변하는가,
    그리고 raw 수익률의 상위 꼬리가 어떤 변동성 대역에 있는가.
    """
    lines = ["## 20. 탐색적 후속 진단 (사전등록 아님)", "",
             "**이 절은 결과를 본 뒤 추가했다.** 위 A~L 판정과 PATTERN 결과를 바꾸지 않고"
             " 새 기준을 소급 추가하지도 않았다. 여기 있는 것은 부호가 아니라 **크기**가"
             " 어디서 변하는지에 대한 관찰이다.", "",
             "### 20.1 R은 퍼센트 수익률을 정규화 손절폭으로 나눈 값이다", "",
             "`planned_risk = shares × stop_distance`이고 `entry_notional ≈ shares ×"
             " 진입가`이므로 산술적으로 다음이 성립한다.", "",
             "```",
             "R = pnl / planned_risk ≈ (pnl / entry_notional) / (stop_distance / 진입가)",
             "  = net_notional_return / stop_fraction",
             "```",
             "",
             "**가정이 아니라 측정이다.** 아래가 그 항등식이 실제로 얼마나 맞는지다"
             " (차이는 `planned_risk`가 계획 진입가를, notional이 실제 체결가를 쓰기"
             " 때문이다).", "",
             "|값|J63|J126|", "|---|---|---|"]
    for label, extract, fmt in (
        ("실제 R 평균", lambda rows: _fmean([r["return_r"] for r in rows]), _num),
        (
            "`net / stop_fraction` 평균",
            lambda rows: _fmean(
                [
                    (r["pnl"] / r["entry_notional"]) / (r["stop_distance"] / r["planned_entry"])
                    for r in rows
                    if r.get("entry_notional") and r.get("planned_entry")
                ]
            ),
            _num,
        ),
        (
            "`stop_fraction` 중앙",
            lambda rows: _median(
                [
                    r["stop_distance"] / r["planned_entry"]
                    for r in rows
                    if r.get("planned_entry")
                ]
            ),
            lambda v: "—" if v is None else f"{v * 100:.3f}%",
        ),
    ):
        values = {core: extract(closed.get(core, [])) for core in SIGNALS}
        lines.append(
            f"|{label}|{fmt(values.get(BASELINE))}|{fmt(values.get(CHALLENGER))}|"
        )

    lines += ["", "### 20.2 층 사이에서 크기가 어떻게 변하는가", "",
              "**단위가 다른 층을 뺄 수는 없지만 각 층의 J126/J63 배율은 무차원이다.**"
              " 아래는 그 배율이고, 사전등록 판정을 바꾸지 않는 **표현 보조**다. 분모가"
              " 0 근처면 배율이 불안정해지므로 J63 값과 함께 읽는다.", "",
              "|층|J63|J126|J126 / J63|", "|---|---|---|---|"]
    for label, extract, fmt in (
        ("raw 거래 수익률", lambda rows: _fmean(raw_returns(rows)), _pct),
        ("net-notional 수익률", lambda rows: _fmean(net_notional_returns(rows)), _pct),
        ("실현 R", lambda rows: _fmean([r["return_r"] for r in rows]), _num),
        (
            "거래당 달러",
            lambda rows: (
                sum(r["pnl"] for r in rows) / len(rows) if rows else None
            ),
            _money,
        ),
    ):
        left = extract(closed.get(BASELINE, []))
        right = extract(closed.get(CHALLENGER, []))
        ratio = (right / left) if left not in (None, 0) and right is not None else None
        lines.append(
            f"|{label}|{fmt(left)}|{fmt(right)}"
            f"|{'—' if ratio is None else f'{ratio:.2f}×'}|"
        )

    lines += ["", f"### 20.3 raw 수익률 상위 {TAIL_SIZE}거래는 어느 변동성 대역에 있는가",
              "",
              "평균 raw 수익률이 꼬리에 얼마나 의존하는지, 그리고 그 꼬리의 정규화 손절폭이"
              " 전체와 다른지를 본다. **표본이 J당"
              f" {TAIL_SIZE}건이므로 일반적인 결론으로 확장하지 않는다.**", "",
              "|값|J63|J126|", "|---|---|---|"]
    for label, extract, fmt in (
        (
            "전체 raw 평균",
            lambda rows: _fmean(raw_returns(rows)),
            _pct,
        ),
        (
            f"상위 {TAIL_SIZE}건이 그 평균에 넣는 몫",
            lambda rows: (
                sum(
                    row["exit_price"] / row["entry_price"] - 1
                    for row in _tail(rows)
                )
                / len(rows)
                if rows
                else None
            ),
            _pct,
        ),
        (
            f"상위 {TAIL_SIZE}건 `stop_fraction` 중앙",
            lambda rows: _median(
                [row["stop_distance"] / row["planned_entry"] for row in _tail(rows)]
            ),
            lambda v: "—" if v is None else f"{v * 100:.3f}%",
        ),
        (
            "전체 `stop_fraction` 중앙",
            lambda rows: _median(
                [
                    row["stop_distance"] / row["planned_entry"]
                    for row in rows
                    if row.get("planned_entry")
                ]
            ),
            lambda v: "—" if v is None else f"{v * 100:.3f}%",
        ),
        (
            f"상위 {TAIL_SIZE}건이 R 평균에 넣는 몫",
            lambda rows: (
                sum(row["return_r"] for row in _tail(rows)) / len(rows)
                if rows
                else None
            ),
            _num,
        ),
    ):
        lines.append(
            f"|{label}|{fmt(extract(closed.get(BASELINE, [])))}"
            f"|{fmt(extract(closed.get(CHALLENGER, [])))}|"
        )
    lines.append("")
    lines += _alignment(closed)
    return lines


def classify_alignment(stats: dict, advantages: dict, trimmed: dict) -> str:
    """§14의 X1/X2/X3. **탐색적 해석 범위이지 사전등록 판정이 아니다.**

    `classify_pattern`과 완전히 분리돼 있다 — 이 함수의 결과는 A~L에도 PATTERN A/E/S/N
    에도 들어가지 않고 Q1·Q2를 바꾸지 않는다.
    """
    challenger = stats.get(CHALLENGER) or {}
    rho_weight = challenger.get("rho_weight_return")
    rho_atr = challenger.get("rho_atr_return")
    gap = challenger.get("alignment_gap")
    equal = advantages.get("equal")
    weighted = advantages.get("weighted")
    if None in (rho_weight, rho_atr, gap, equal, weighted):
        return "X3"

    # trim에서 방향이 뒤집히면 몇 건이 만든 관계다. 지표를 더 보기 전에 X3다.
    for key in ("rho_weight_return", "alignment_gap"):
        full = challenger.get(key)
        cut = (trimmed.get(CHALLENGER) or {}).get(key)
        if full is None or cut is None:
            return "X3"
        if (full > 0) != (cut > 0):
            return "X3"

    dilution = (
        rho_weight < 0
        and rho_atr > 0
        and gap < 0
        and equal > 0
        and weighted < equal
    )
    if dilution:
        return "X1"
    # 관계가 약하고 가중 후에도 우위가 유지되면 희석 근거가 없다.
    if abs(rho_weight) < 0.1 and equal > 0 and weighted >= equal:
        return "X2"
    return "X3"


def _alignment(closed: dict) -> list[str]:
    """§20.4. **결과를 본 뒤 추가한 탐색적 진단이다.**

    기존 LAST_CLOSE trace의 체결 거래를 다시 집계할 뿐 새 실행·새 코어·수량 변경이 없다.
    """
    stats = {core: alignment_stats(closed.get(core, [])) for core in SIGNALS}
    cut = {
        core: alignment_stats(trimmed_by_return(closed.get(core, [])))
        for core in SIGNALS
    }
    advantages = {
        "equal": _delta(
            stats[BASELINE]["equal_trade_mean"], stats[CHALLENGER]["equal_trade_mean"]
        ),
        "weighted": _delta(
            stats[BASELINE]["allocation_weighted_mean"],
            stats[CHALLENGER]["allocation_weighted_mean"],
        ),
    }
    trimmed_advantages = {
        "equal": _delta(
            cut[BASELINE]["equal_trade_mean"], cut[CHALLENGER]["equal_trade_mean"]
        ),
        "weighted": _delta(
            cut[BASELINE]["allocation_weighted_mean"],
            cut[CHALLENGER]["allocation_weighted_mean"],
        ),
    }
    verdict = classify_alignment(stats, advantages, cut)

    lines = [
        "### 20.4 allocation × return 정렬 진단", "",
        "**이 분석은 PR #14의 사전등록된 A~L / PATTERN 판정 이후 결과를 보고 추가한"
        " 탐색적 진단이며, 공식 `NO_CLEAR_STAGE / INCONCLUSIVE` 결론을 변경하지 않는다.**",
        "",
        "**새 실행을 돌리지 않았다.** 기존 LAST_CLOSE trace의 체결 거래를 다시 집계할"
        " 뿐이고 수량·위험·손절·슬롯·체결·청산을 하나도 바꾸지 않았다.", "",
        "묻는 것: **실제 체결된 거래에서 높은 퍼센트 수익률을 낸 거래일수록 실제 포지션"
        " 비중이 작았는가**, 그리고 **그 관계가 J126에서 더 강한가**. 아직 causal claim이"
        " 아니다.", "",
        "#### Evidence 1 — 순위 상관 (Spearman)", "",
        "|J|ρ(비중, net 수익률)|ρ(정규화 ATR, net 수익률)|관측|",
        "|---|---|---|---|",
    ]
    for core in SIGNALS:
        cell = stats[core]
        lines.append(
            f"|**{LABELS[core]}**|{_num(cell['rho_weight_return'])}"
            f"|{_num(cell['rho_atr_return'])}|{cell['count']:,}|"
        )
    pooled = alignment_stats(
        [row for core in SIGNALS for row in closed.get(core, [])]
    )
    lines.append(
        f"|합침|{_num(pooled['rho_weight_return'])}"
        f"|{_num(pooled['rho_atr_return'])}|{pooled['count']:,}|"
    )
    lines += ["",
              "ρ < 0이면 **큰 포지션일수록 낮은 퍼센트 수익률을 냈다는 연관**이고, ρ > 0이면"
              " 그 반대다. 0 근처면 단조 관계가 뚜렷하지 않다. **formal p-value를 만들지"
              " 않았고 상관을 인과로 쓰지 않는다.**", ""]

    lines += ["#### Evidence 2 — 동일가중 vs 배분가중 평균", "",
              "`allocation_weighted_mean = Σ(wᵢ·rᵢ) / Σwᵢ` (`wᵢ` = 진입 notional / 신호"
              " 시점 자산, `rᵢ` = pnl / 진입 notional).", "",
              "**이것을 포트폴리오 수익률·counterfactual·백테스트 수익률이라고 부르지"
              " 않는다.** 서로 다른 날짜의 거래를 정적으로 모은 정렬 진단일 뿐이다.", "",
              "|J|동일가중 net 수익|배분가중 net 수익|정렬 격차|관측|",
              "|---|---|---|---|---|"]
    for core in SIGNALS:
        cell = stats[core]
        lines.append(
            f"|**{LABELS[core]}**|{_pct(cell['equal_trade_mean'])}"
            f"|{_pct(cell['allocation_weighted_mean'])}"
            f"|**{_pct(cell['alignment_gap'])}**|{cell['count']:,}|"
        )
    lines += ["",
              "격차 < 0이면 비중이 큰 거래가 평균적으로 더 낮은 수익률을 가져 **배분이"
              " 거래 단위 퍼센트 수익률과 반대 방향으로 정렬된 관측**이다. > 0이면 반대이고"
              " 0 근처면 뚜렷한 정렬 효과가 없다.", ""]

    lines += ["#### Evidence 3 — 가중 후 J126 우위가 어떻게 변하는가", "",
              "|비교|값|", "|---|---|",
              f"|J126 − J63 동일가중 우위|**{_pct(advantages['equal'])}**|",
              f"|J126 − J63 배분가중 우위|**{_pct(advantages['weighted'])}**|",
              f"|가중이 지운 몫|{_pct(_delta(advantages['equal'], advantages['weighted']))}|",
              ""]

    lines += [f"#### Evidence 4 — outlier robustness (절대값 상위"
              f" {ALIGNMENT_TRIM:.0%} 제거)", "",
              "**trim은 사전에 1% 하나만 골랐다.** 결과를 보고 2%·5%·10%를 추가로 탐색하지"
              " 않았다. net-notional 수익률 **절대값** 상위 1%(내림)를 뺀 표본이고,"
              " **위·아래 각각 1%가 아니라 절대값이 큰 전체 1%다** — 양·음 어느 쪽이든"
              " 극단값이 후보가 된다.", "",
              "|J|관측|ρ(비중, net)|동일가중|배분가중|정렬 격차|",
              "|---|---|---|---|---|---|"]
    for core in SIGNALS:
        cell = cut[core]
        lines.append(
            f"|**{LABELS[core]}**|{cell['count']:,}|{_num(cell['rho_weight_return'])}"
            f"|{_pct(cell['equal_trade_mean'])}"
            f"|{_pct(cell['allocation_weighted_mean'])}"
            f"|**{_pct(cell['alignment_gap'])}**|"
        )
    lines += ["",
              f"|비교 (trimmed)|값|", "|---|---|",
              f"|J126 − J63 동일가중 우위|{_pct(trimmed_advantages['equal'])}|",
              f"|J126 − J63 배분가중 우위|{_pct(trimmed_advantages['weighted'])}|",
              ""]

    lines += _return_bands(closed)

    lines += ["#### 탐색적 해석 — X1 / X2 / X3", "",
              "|패턴|뜻|", "|---|---|",
              "|**X1**|희석 가설과 일관: ρ(비중,수익) < 0 · ρ(ATR,수익) > 0 · 정렬 격차 < 0"
              " · 가중 후 J126 우위 축소|",
              "|**X2**|희석 근거 없음: 상관이 약하고 가중 후에도 우위 유지|",
              "|**X3**|혼재하거나 trim에서 방향이 뒤집힘 — INCONCLUSIVE|",
              "",
              f"### 판정 **{verdict}**", ""]
    lines += _alignment_reading(verdict)
    return lines


def _return_bands(closed: dict) -> list[str]:
    """§11의 선택적 요약. **새 cutoff를 전략 규칙처럼 해석하지 않는다.**"""
    lines = ["#### Evidence 5 — net 수익률 구간별 비중 (보조)", "",
             "**이 구간은 표를 읽기 위한 것이지 전략 규칙이 아니다.** 각 J 안에서 net"
             " 수익률로 정렬해 나눴다.", "",
             "|J|구간|거래|비중 중앙|정규화 ATR 중앙|",
             "|---|---|---|---|---|"]
    for core in SIGNALS:
        usable = alignment_rows(closed.get(core, []))
        if not usable:
            continue
        ordered = sorted(usable, key=lambda row: row["pnl"] / row["entry_notional"])
        for low, high, label in RETURN_BANDS:
            start = int(len(ordered) * low)
            end = int(len(ordered) * high)
            band = ordered[start:end]
            if not band:
                continue
            weights = [
                row["entry_notional"] / row["equity_at_signal"] for row in band
            ]
            atr = [row["atr14"] / row["planned_entry"] for row in band]
            lines.append(
                f"|{LABELS[core]}|{label}|{len(band):,}|{_share(_median(weights))}"
                f"|{_median(atr) * 100:.3f}%|"
            )
    lines += ["",
              "**Interpretation — 왜 Evidence 1과 Evidence 2가 서로 다른 얘기를 하는가.**"
              " 이 표에서 양쪽 꼬리(하위 20%·상위 20%)가 중간 60%보다 **비중이 낮고 정규화"
              " ATR이 높다.** 즉 배분과 수익률의 관계가 단조가 아니라 U자다. Spearman은"
              " 단조 관계만 보므로 ρ ≈ 0이 나오고, 가중 평균은 크기를 보므로 격차가 생긴다."
              " **두 지표가 어긋나는 것이 아니라 서로 다른 것을 재고 있다** — 그래서 아래"
              " 판정이 X1도 X2도 아니다.",
              ""]
    return lines


def _alignment_reading(verdict: str) -> list[str]:
    """판정별로 **어디까지 말할 수 있는지**를 못박는다."""
    if verdict == "X1":
        return [
            "**Hypothesis (증명 아님).** J126의 퍼센트 수익률 우위 일부가 high-vol ·"
            " low-notional 거래에 위치하고, 현재 inverse-normalized-vol 배분이 그 우위를"
            " 달러 층에서 약화시킬 **수 있다**는 가설과 일관된 탐색적 관측이다.",
            "",
            "**\"증명\"·\"범인 확인\"이라고 쓰지 않는다.** 실제 개입을 아직 돌리지 않았다.",
            "",
            "**다음 단계는 최대 여기까지다:** allocation dilution 가설이 탐색적으로"
            " 강화됐다. 실제 수량 규칙 변경은 이 메커니즘을 인과적으로 검증하는 방법이 될"
            " 수 있지만, **별도의 독립적인 근거가 더 생겼을 때** 새 연구 질문으로"
            " 사전등록한다. **이 PR에서 sizing을 바꾸지 않는다.**",
            "",
        ]
    if verdict == "X2":
        return [
            "**Interpretation.** 비중–수익률 상관이 약하고 가중 후에도 J126 우위가"
            " 유지된다. inverse-vol 배분이 J126의 번역 실패를 설명한다는 가설은 **약화**된다.",
            "",
            "**sizing intervention 근거가 부족하다.**",
            "",
        ]
    return [
        "**Interpretation.** 지표마다 방향이 다르거나 trim에서 크게 뒤집힌다. allocation"
        " 설명은 **INCONCLUSIVE**이고 **sizing ablation 근거로 승격하지 않는다.**",
        "",
        "**두 방향의 증거가 같이 있다는 것을 그대로 남긴다.** 순위 상관은 어느 쪽으로도"
        " 거의 0이고 부호가 희석 가설과 반대다. 반면 배분가중은 J126 우위를 실제로"
        " 압축하고, trim 뒤에는 부호까지 바뀐다. 한쪽만 인용해 결론을 만들지 않는다 —"
        " 그리고 trim이 방향을 바꾼다는 것 자체가 **소수 거래에 기댄 관계**라는 신호다.",
        "",
        "**sizing intervention 근거가 부족하다.**",
        "",
    ]


def _tail(rows: list[dict]) -> list[dict]:
    """raw 수익률 상위 `TAIL_SIZE`건."""
    usable = [row for row in rows if row.get("entry_price") and "exit_price" in row]
    return sorted(
        usable, key=lambda row: row["exit_price"] / row["entry_price"], reverse=True
    )[:TAIL_SIZE]


def _next_steps(verdict: dict) -> list[str]:
    lines = ["## 21. 다음 개입 결정 (§23)", "",
             "**이 PR 안에서 sizing을 바꾸지 않았다.** equal weight · fixed notional ·"
             " 비중 cap · ATR cap · 변동성 floor·ceiling · risk parity 변경을 실행하지"
             " 않았다. 이 PR은 범인을 찾는 PR이지 고치는 PR이 아니다.", ""]
    if verdict["answer"] == "YES":
        lines += [
            "판정이 `YES`이므로 **다음 PR에서 단 하나의 sizing ablation을 사전등록한다.**"
            " 질문은 \"현재 `R/2ATR` 수량 규칙을 한 가지 대안으로 바꾸면 신호 → 달러 변환"
            " 손실이 줄어드는가\"이고, 팔은 하나만 연다.",
            "",
        ]
    elif verdict["answer"] == "NO":
        lines += [
            f"판정이 `NO`이므로 **sizing을 다음 개입 대상으로 올리지 않는다.**"
            f" `{verdict['pattern']}` 단계가 먼저 설명돼야 한다 — sizing 이전에 이미"
            " 정보가 사라졌기 때문이다.",
            "",
        ]
    else:
        lines += [
            "판정이 `INCONCLUSIVE`이므로 **특정 구성요소를 범인으로 지목하지 않는다.**"
            " sizing ablation을 지금 열지 않는다.",
            "",
            "다만 §20의 탐색적 관찰은 **기록만 해 둔다** — 사전등록된 결론이 아니고,"
            " 이것만으로 다음 연구 질문이 정해지지도 않는다.",
            "",
            "> 현재 수량 규칙은 실측상 거의 순수한 inverse-normalized-vol 가중이고"
            " (`RISK`가 구속, Spearman ρ ≈ -1), R은 산술적으로 퍼센트 수익률을 정규화"
            " 손절폭으로 나눈 값이다. 그리고 raw 수익률 평균은 소수의 고변동 꼬리 거래가"
            " 만든다. **이 셋이 함께 성립하면 퍼센트 우위가 R·달러로 옮겨가지 못하는"
            " 구조적 이유가 된다.**",
            "",
            "**아직 측정하지 않은 것을 분명히 한다.** 이 구조가 실제로 변환 손실을 만드는지는"
            " 재지 않았고, 꼬리 관찰은 J당 10건이라 그 자체로는 근거가 약하다."
            " §20.4의 정렬 진단도 X3(mixed)이라 배분 희석 가설을 지지하지 않았다.",
            "",
            "**현재 증거만으로 sizing ablation을 다음 PR로 승격하지 않는다.** 실제 수량"
            " 규칙 변경은 이 메커니즘을 인과적으로 검증하는 방법이 될 수 있지만, **별도의"
            " 독립적인 근거가 더 생겼을 때** 새 연구 질문으로 사전등록한다.",
            "",
        ]
    return lines


# ---------------------------------------------------------------- CLI


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="stage", required=True)
    sub.add_parser("plan")
    sub.add_parser("universe")
    tracer = sub.add_parser("trace")
    tracer.add_argument("core", choices=list(SIGNALS))
    tracer.add_argument("scenario", choices=sorted(UNRESOLVED_EXIT_PRICES))
    sub.add_parser("report")
    arguments = parser.parse_args()

    if arguments.stage == "plan":
        print("universe")
        for core, scenario in planned():
            print(f"trace {core} {scenario}")
        return 0

    connection = store.connect()
    try:
        if arguments.stage == "universe":
            return stage_universe(connection)
        if arguments.stage == "trace":
            return stage_trace(connection, arguments.core, arguments.scenario)
        return stage_report(connection)
    finally:
        connection.close()


if __name__ == "__main__":
    sys.exit(main())
