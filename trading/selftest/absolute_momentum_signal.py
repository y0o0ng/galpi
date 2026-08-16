"""`ABS(126,5) > 0` 후보 조건이 RS126 TOP5의 +42 초과수익을 높이는가. **Phase 2 · PR #17.**

사전등록 전문은 `runs/absolute-momentum-signal/README.md`이고 **결과 전에** 커밋했다.
**이 러너는 포트폴리오를 건드리지 않는다.**

## 묻는 것

    SPY > SMA200인 개발표본에서, ABS-positive 후보 안에서 다시 뽑은 RS126 TOP5가
    동일 날짜의 기존 RS126 TOP5보다 +42 forward excess를 높이는가?

`J126 + SMA200`은 이미 노출 일치 격차가 +4.99%인 구조다(PR #16). 그래서 ABS의 역할은
마이너스를 플러스로 만드는 것이 아니라 **이미 있는 상대 edge를 키우는가, 반대로 좋은
거래까지 잘라먹는가**다.

## 필터 위치

    자격 유니버스 → RS 계산 → ABS > 0 후보 조건 → 살아남은 후보를 RS 정렬 → TOP5

**기존 TOP5에서 미달만 지우는 것이 아니다.** ABS 음수인 RS 2등이 빠지면 ABS 양수인 RS
6등이 들어온다. **ABS 양수 후보가 5개 미만이면 그날 TOP5는 5개 미만이고 backfill하지
않는다.**

필터는 후보를 빼기만 하고 살아남은 후보의 RS 순서를 바꾸지 않으므로 **control TOP5 중 ABS
양수인 종목은 반드시 ABS TOP5에도 남는다.** 그래서 "ABS 때문에 빠진 종목"과 "ABS 미달
종목"이 같은 집합이다.

## primary는 날짜 단위 paired 비교다

    Control_t = 기존 RS126 TOP5의 +42 excess (날짜 평균)
    ABS_t     = ABS-positive 후보에서 다시 뽑은 TOP5의 +42 excess (날짜 평균)
    D_t       = ABS_t − Control_t
    primary   = mean(D_t)

**두 평균을 따로 내서 빼지 않는다.** 같은 날짜·같은 시장 상태·같은 유니버스에서 후보 조건
하나만 바뀐 비교가 primary다.

**유니버스 평균은 두 팔에서 같다** — ABS는 후보 조건이지 유니버스 변경이 아니다. 그래서
`D_t`에서 유니버스 평균이 상쇄되고 결국 **두 바구니의 raw forward 평균 차이**가 된다.

## 집계가 둘이다

PR #15의 `+1.188%`는 **관측 가중**이고 checksum 전용이다. paired 분석은 **날짜 가중**을
쓴다. 두 estimand는 개념적으로 다르다.

**다만 이 러너의 control 표본 구조에서는 둘이 정의상 같게 닫힌다.** forward가 없는 종목을
**랭킹 전에** 빼고 `min_score_population`을 통과한 날짜만 세므로 **control TOP5가 항상
정확히 5관측**이다. 같은 크기 집단의 평균의 평균은 전체 평균과 같다.

## 정의를 복제하지 않는다

`absolute_momentum`(RS의 자기 항) · `_eligible` · `formation_strengths` · `forward_return` ·
`classify_market_regime(...).above_sma200` · `research_calendar` · `random_score`를 정본
그대로 쓴다.

    python3 selftest/absolute_momentum_signal.py ALL
    python3 selftest/absolute_momentum_signal.py NDX100
    python3 selftest/absolute_momentum_signal.py report
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
from backtest.data import BarCache, PointInTimeSnapshot  # noqa: E402
from backtest.features import FeatureUnavailable, absolute_momentum  # noqa: E402
from backtest.holdout import (  # noqa: E402
    HOLDOUT_START,
    assert_no_holdout,
    holdout_metadata,
)
from backtest.regime import classify_market_regime  # noqa: E402
from selftest.funnel_run import forward_return  # noqa: E402
from selftest.j_signal_study import PARAMETERS, _eligible  # noqa: E402
from selftest.market_condition_signal import market_group  # noqa: E402
from selftest.real_run import RUNS_DIR, SOURCE_VERSION  # noqa: E402
from selftest.signal_study import research_calendar  # noqa: E402

EXPERIMENT = "absolute-momentum-signal"

# 사전등록한 고정 변수. **결과를 보고 바꾸지 않는다**(테스트가 잠근다).
J = 126
SKIP = 5
ABS_LOOKBACK = 126
ABS_SKIP = 5
ABS_THRESHOLD = 0.0
HORIZON = 42
TOP_N = 5
RANDOM_SEEDS = tuple(range(20))
PHASE_COUNT = HORIZON

PRIMARY_UNIVERSE = "ALL"
UNIVERSES = {"ALL": ("SP500", "NDX100"), "NDX100": ("NDX100",)}
# 시장 조건은 PR #16에서 살아남았다. 신호 층도 `SPY > SMA200` 날짜만 본다.
MARKET_GROUP = "UP"

# §9 binding label. 5%는 해석 label이지 promotion threshold가 아니다.
BINDING_LOW = 0.05
LABEL_NON_BINDING = "NON_BINDING"
LABEL_LOW_BINDING = "LOW_BINDING"
LABEL_BINDING = "BINDING"
BINDING_LABELS = (LABEL_NON_BINDING, LABEL_LOW_BINDING, LABEL_BINDING)

# §11 승격 문턱.
PHASE_POSITIVE_SHARE_MINIMUM = 0.60

PROMOTE = "PROMOTE_ABS_TO_PORTFOLIO"
DO_NOT_PROMOTE = "DO_NOT_PROMOTE_ABS_TO_PORTFOLIO"


def top_n(ranked: list[tuple[float, str]]) -> list[str]:
    """RS 내림차순, 같으면 종목 코드 순. **5개 미만이면 그대로 둔다.**"""
    return [symbol for _, symbol in sorted(ranked, key=lambda item: (-item[0], item[1]))][
        :TOP_N
    ]


def basket_excess(
    symbols: list[str], forwards: dict[str, float], universe_mean: float
) -> float | None:
    """바구니의 날짜 평균 초과수익. 유효 forward가 없으면 None이다."""
    values = [forwards[symbol] for symbol in symbols if symbol in forwards]
    if not values:
        return None
    return statistics.fmean(values) - universe_mean


# ---------------------------------------------------------------- 누적


class Paired:
    """날짜 단위 paired 누적. `Study`는 관측 단위라 여기 쓰지 않는다."""

    def __init__(self) -> None:
        self.differences: list[float] = []
        self.control: list[float] = []
        self.treatment: list[float] = []

    def add(self, control: float, treatment: float) -> None:
        self.control.append(control)
        self.treatment.append(treatment)
        self.differences.append(treatment - control)

    def summary(self) -> dict:
        values = self.differences
        if not values:
            return {"dates": 0, "mean": None, "median": None, "positive_share": None,
                    "control_mean": None, "treatment_mean": None,
                    "min": None, "max": None}
        return {
            "dates": len(values),
            "mean": statistics.fmean(values),
            "median": statistics.median(values),
            "positive_share": sum(1 for value in values if value > 0) / len(values),
            "control_mean": statistics.fmean(self.control),
            "treatment_mean": statistics.fmean(self.treatment),
            "min": min(values),
            "max": max(values),
        }


def run_universe(connection, name: str) -> dict:
    index_names = UNIVERSES[name]
    cache = BarCache(connection, SOURCE_VERSION)
    calendar = research_calendar(connection)
    assert_no_holdout(calendar)
    warmup = PARAMETERS.min_history_sessions

    overall = Paired()
    phases = [Paired() for _ in range(PHASE_COUNT)]
    by_year: dict[str, Paired] = {}
    changed_only = Paired()
    control_random = {seed: Paired() for seed in RANDOM_SEEDS}

    # checksum용 관측 가중 누적.
    observation_total, observation_count = 0.0, 0

    dates = 0
    skipped_non_up = 0
    empty_abs_dates = 0
    changed_dates = 0
    identical_dates = 0
    overlaps: list[int] = []
    replaced_candidates = 0
    control_candidate_days = 0
    abs_pool_sizes: list[int] = []
    short_abs_dates = 0
    max_signal_date = None
    max_target_date = None

    for index in range(warmup, len(calendar)):
        target = index + HORIZON
        if target >= len(calendar):
            break
        as_of = calendar[index]
        target_date = calendar[target]
        snapshot = PointInTimeSnapshot(connection, as_of, SOURCE_VERSION, cache=cache)

        try:
            regime = classify_market_regime(snapshot, PARAMETERS)
        except FeatureUnavailable:
            continue
        if market_group(regime.above_sma200) != MARKET_GROUP:
            skipped_non_up += 1
            continue

        members: set[str] = set()
        for index_name in index_names:
            members |= snapshot.members(index_name)

        ranked: list[tuple[float, str]] = []
        abs_ranked: list[tuple[float, str]] = []
        forwards: dict[str, float] = {}
        for symbol in sorted(members):
            features = _eligible(snapshot, symbol)
            if features is None:
                continue
            value, _stale = forward_return(cache, symbol, as_of, target_date)
            if value is None:
                continue
            bars = snapshot.bars(symbol, PARAMETERS.min_history_sessions)
            adjusted = [bar.adj_close for bar in bars]
            reference = [
                bar.adj_close
                for bar in snapshot.bars(
                    snapshot.reference_symbol, PARAMETERS.min_history_sessions
                )
            ]
            try:
                own = absolute_momentum(adjusted, ABS_LOOKBACK, ABS_SKIP)
                market = absolute_momentum(reference, J, SKIP)
            except FeatureUnavailable:
                continue
            # **RS는 자기 항 − 시장 항이다.** 같은 helper를 써서 정의가 갈릴 자리가 없다.
            rs = own - market
            forwards[symbol] = value
            ranked.append((rs, symbol))
            if own > ABS_THRESHOLD:
                abs_ranked.append((rs, symbol))

        if len(ranked) < PARAMETERS.min_score_population:
            continue

        universe_mean = statistics.fmean(forwards.values())
        control_top = top_n(ranked)
        abs_top = top_n(abs_ranked)
        abs_pool_sizes.append(len(abs_ranked))
        if len(abs_ranked) < TOP_N:
            short_abs_dates += 1
        if not abs_top:
            empty_abs_dates += 1
            continue

        control_excess = basket_excess(control_top, forwards, universe_mean)
        abs_excess = basket_excess(abs_top, forwards, universe_mean)
        if control_excess is None or abs_excess is None:
            continue

        dates += 1
        max_signal_date = as_of
        max_target_date = target_date

        overall.add(control_excess, abs_excess)
        phases[(index - warmup) % PHASE_COUNT].add(control_excess, abs_excess)
        by_year.setdefault(as_of[:4], Paired()).add(control_excess, abs_excess)

        # 구속력.
        control_candidate_days += len(control_top)
        replaced_candidates += sum(
            1 for symbol in control_top if symbol not in set(abs_top)
        )
        overlap = len(set(control_top) & set(abs_top))
        overlaps.append(overlap)
        if set(control_top) != set(abs_top):
            changed_dates += 1
            changed_only.add(control_excess, abs_excess)
        else:
            identical_dates += 1

        # checksum — 관측 가중 control.
        for symbol in control_top:
            if symbol in forwards:
                observation_total += forwards[symbol] - universe_mean
                observation_count += 1

        # paired random. **같은 random ranking을 두 풀에 적용한다.**
        for seed in RANDOM_SEEDS:
            scored = [(random_score(seed, as_of, symbol), symbol) for _, symbol in ranked]
            abs_symbols = {symbol for _, symbol in abs_ranked}
            abs_scored = [item for item in scored if item[1] in abs_symbols]
            left = basket_excess(top_n(scored), forwards, universe_mean)
            right = basket_excess(top_n(abs_scored), forwards, universe_mean)
            if left is not None and right is not None:
                control_random[seed].add(left, right)

        if (index - warmup) % 500 == 0:
            print(f"  {as_of} · 자격 {len(ranked)} · ABS 통과 {len(abs_ranked)}"
                  f" · 날짜 {dates:,}")

    return {
        "name": name,
        "window": [calendar[warmup], calendar[-1]],
        "max_signal_date": max_signal_date,
        "max_forward_target_date": max_target_date,
        "dates": dates,
        "skipped_non_up_dates": skipped_non_up,
        "empty_abs_dates": empty_abs_dates,
        "overall": overall,
        "phases": phases,
        "by_year": by_year,
        "changed_only": changed_only,
        "random": control_random,
        "observation_control": (observation_total, observation_count),
        "binding": {
            "changed_dates_n": changed_dates,
            "identical_dates": identical_dates,
            "overlaps": overlaps,
            "replaced_candidates": replaced_candidates,
            "control_candidate_days": control_candidate_days,
            "abs_pool_sizes": abs_pool_sizes,
            "short_abs_dates": short_abs_dates,
        },
    }


def binding_label(changed_share: float | None) -> str:
    """§9. **5%는 해석 label이지 promotion threshold가 아니다.**"""
    if not changed_share:
        return LABEL_NON_BINDING
    return LABEL_LOW_BINDING if changed_share < BINDING_LOW else LABEL_BINDING


def serialize(result: dict) -> dict:
    binding = result["binding"]
    dates = result["dates"]
    changed_share = binding["changed_dates_n"] / dates if dates else None
    total, count = result["observation_control"]
    sizes = binding["abs_pool_sizes"]

    phases = [phase.summary() for phase in result["phases"]]
    phase_means = [row["mean"] for row in phases if row["mean"] is not None]
    positive_phases = sum(1 for value in phase_means if value > 0)

    years = {year: paired.summary() for year, paired in sorted(result["by_year"].items())}
    loyo = {}
    for year, paired in result["by_year"].items():
        remaining = [
            value
            for other, group in result["by_year"].items()
            if other != year
            for value in group.differences
        ]
        loyo[year] = statistics.fmean(remaining) if remaining else None

    return {
        "universe": result["name"],
        "experiment": EXPERIMENT,
        "market_group": MARKET_GROUP,
        "holdout": holdout_metadata(consumed=False),
        "window": result["window"],
        "max_signal_date": result["max_signal_date"],
        "max_forward_target_date": result["max_forward_target_date"],
        "horizon": HORIZON,
        "top_n": TOP_N,
        "j": J,
        "abs": {"lookback": ABS_LOOKBACK, "skip": ABS_SKIP, "threshold": ABS_THRESHOLD},
        "dates": dates,
        "skipped_non_up_dates": result["skipped_non_up_dates"],
        "empty_abs_dates": result["empty_abs_dates"],
        "primary": result["overall"].summary(),
        "observation_weighted_control": total / count if count else None,
        "observation_count": count,
        "changed_only": result["changed_only"].summary(),
        "binding": {
            "label": binding_label(changed_share),
            "composition_changed_dates": changed_share,
            "changed_dates_n": binding["changed_dates_n"],
            "identical_share": binding["identical_dates"] / dates if dates else None,
            "mean_overlap": statistics.fmean(binding["overlaps"])
            if binding["overlaps"]
            else None,
            "candidate_replacement_rate": (
                binding["replaced_candidates"] / binding["control_candidate_days"]
                if binding["control_candidate_days"]
                else None
            ),
            "replaced_candidates": binding["replaced_candidates"],
            "control_candidate_days": binding["control_candidate_days"],
            "abs_pool_mean": statistics.fmean(sizes) if sizes else None,
            "abs_pool_min": min(sizes) if sizes else None,
            "abs_pool_max": max(sizes) if sizes else None,
            "short_abs_dates": binding["short_abs_dates"],
        },
        "phases": {
            "valid": len(phase_means),
            "positive": positive_phases,
            "positive_share": positive_phases / len(phase_means) if phase_means else None,
            "median": statistics.median(phase_means) if phase_means else None,
            "min": min(phase_means) if phase_means else None,
            "max": max(phase_means) if phase_means else None,
            "values": phase_means,
        },
        "by_year": years,
        "leave_one_year_out": loyo,
        "random": {
            "seeds": len(RANDOM_SEEDS),
            "mean": {
                str(seed): paired.summary()["mean"]
                for seed, paired in result["random"].items()
            },
        },
    }


def out_dir() -> Path:
    path = RUNS_DIR / EXPERIMENT
    path.mkdir(parents=True, exist_ok=True)
    return path


def _pct(value, digits: int = 3) -> str:
    return "—" if value is None else f"{value * 100:+.{digits}f}%"


def _share(value, digits: int = 1) -> str:
    return "—" if value is None else f"{value * 100:.{digits}f}%"


def _num(value, digits: int = 2) -> str:
    return "—" if value is None else f"{value:.{digits}f}"


def stage_run(connection, name: str) -> int:
    print(f"# {name} · ABS({ABS_LOOKBACK},{ABS_SKIP}) > 0 · {MARKET_GROUP} 날짜만")
    payload = serialize(run_universe(connection, name))
    path = out_dir() / f"{name.lower()}.json"
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    primary = payload["primary"]
    binding = payload["binding"]
    print(f"\n유효 paired 날짜 {payload['dates']:,}"
          f" · UP 아닌 날짜 제외 {payload['skipped_non_up_dates']:,}")
    print(f"마지막 신호일 {payload['max_signal_date']}"
          f" · 마지막 forward 목표일 {payload['max_forward_target_date']}"
          f" (홀드아웃 {HOLDOUT_START})")
    print(f"control(관측 가중) {_pct(payload['observation_weighted_control'])}"
          f" · control(날짜 가중) {_pct(primary['control_mean'])}"
          f" · ABS {_pct(primary['treatment_mean'])}")
    print(f"**mean(D) {_pct(primary['mean'])}** · median {_pct(primary['median'])}"
          f" · 양수 날짜 {_share(primary['positive_share'])}")
    print(f"binding {binding['label']}"
          f" · 구성 변경 {_share(binding['composition_changed_dates'])}"
          f" ({binding['changed_dates_n']:,}일)"
          f" · 후보 교체율 {_share(binding['candidate_replacement_rate'])}")
    print(f"→ {path.name}")
    return 0


def load(name: str) -> dict | None:
    path = out_dir() / f"{name.lower()}.json"
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else None


def hard_verdicts(primary: dict, ndx: dict | None) -> dict:
    """§11의 HARD A~E. **결과를 본 뒤 바꾸지 않는다**(테스트가 잠근다)."""
    binding = primary["binding"]
    core = primary["primary"]
    phases = primary["phases"]
    ndx_mean = ndx["primary"]["mean"] if ndx else None
    rows = {
        "A": {
            "name": "`NON_BINDING`이 아닐 것",
            "detail": f"{binding['label']} ({_share(binding['composition_changed_dates'])})",
            "pass": binding["label"] != LABEL_NON_BINDING,
        },
        "B": {
            "name": "primary `mean(D) > 0`",
            "detail": _pct(core["mean"]),
            "pass": core["mean"] is not None and core["mean"] > 0,
        },
        "C": {
            "name": "`median(D) >= 0`",
            "detail": _pct(core["median"]),
            "pass": core["median"] is not None and core["median"] >= 0,
        },
        "D": {
            "name": f"위상 양수 비율 ≥ {PHASE_POSITIVE_SHARE_MINIMUM:.0%}",
            "detail": f"{_share(phases['positive_share'])}"
            f" ({phases['positive']}/{phases['valid']})",
            "pass": phases["positive_share"] is not None
            and phases["positive_share"] >= PHASE_POSITIVE_SHARE_MINIMUM,
        },
        "E": {
            "name": "NDX100 paired `mean(D) >= 0`",
            "detail": _pct(ndx_mean),
            "pass": ndx_mean is not None and ndx_mean >= 0,
        },
    }
    rows["verdict"] = (
        PROMOTE if all(rows[key]["pass"] for key in "ABCDE") else DO_NOT_PROMOTE
    )
    return rows


def concentration_label(primary: dict) -> tuple[str, str]:
    """§11의 연도 집중도. **단독 hard veto가 아니다.**"""
    mean = primary["primary"]["mean"]
    loyo = [value for value in primary["leave_one_year_out"].values() if value is not None]
    yearly = [row["mean"] for row in primary["by_year"].values() if row["mean"] is not None]
    if mean is None or not loyo or not yearly:
        return "MIXED", "표본이 모자라 판정할 수 없다"
    flips = [
        year
        for year, value in primary["leave_one_year_out"].items()
        if value is not None and (value > 0) != (mean > 0)
    ]
    positive = sum(1 for value in yearly if value > 0)
    if flips:
        return "CONCENTRATED", f"{', '.join(flips)}년을 빼면 전체 부호가 뒤집힌다"
    if positive / len(yearly) >= 0.6:
        return "BROAD", f"leave-one-year-out이 전부 같은 방향이고 양의 연도가 {positive}/{len(yearly)}"
    return "MIXED", f"leave-one-year-out은 안정적이지만 양의 연도가 {positive}/{len(yearly)}"


def stage_report(_connection) -> int:
    primary = load(PRIMARY_UNIVERSE)
    ndx = load("NDX100")
    lines = [
        "# PR #17 — Candidate Absolute Momentum Signal Study",
        "",
        f"**물은 것:** `SPY > SMA200`인 개발표본에서, `ABS({ABS_LOOKBACK},{ABS_SKIP}) > 0`"
        " 후보 안에서 다시 뽑은 RS126 TOP5가 **동일 날짜의** 기존 RS126 TOP5보다"
        f" +{HORIZON} forward excess를 높이는가.",
        "",
        "**이 PR은 포트폴리오를 건드리지 않는다.** 사전등록은 결과 전에 커밋했고"
        " (`README.md`) HARD A~E와 binding label을 그때 박았다.",
        "",
        "**Phase 2의 역할은 마이너스를 플러스로 만드는 것이 아니다.** `J126 + SMA200`은 이미"
        " 노출 일치 격차가 +4.99%다(PR #16). 그래서 묻는 것은 **이미 있는 상대 edge를"
        " 키우는가, 반대로 좋은 거래까지 잘라먹는가**다.",
        "",
    ]
    if not primary:
        return _write(lines + ["**아직 `ALL` 실행이 없다.**", ""])

    lines += _boundary(primary)
    lines += _checksum(primary)
    lines += _primary(primary)
    lines += _binding(primary)
    lines += _phases(primary)
    lines += _years(primary)
    lines += _random(primary)
    lines += _ndx(ndx)
    lines += _verdict(primary, ndx)
    return _write(lines)


def _write(lines: list[str]) -> int:
    path = out_dir() / "results.md"
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("\n".join(lines))
    print(f"\n보고서: {RUNS_DIR.name}/{EXPERIMENT}/{path.name}")
    return 0


def _boundary(primary: dict) -> list[str]:
    holdout = primary["holdout"]
    return [
        "## 1. 데이터 경계", "",
        "|항목|값|", "|---|---|",
        f"|`HOLDOUT_START`|`{holdout['HOLDOUT_START']}`|",
        f"|`HOLDOUT_CONSUMED`|`{str(holdout['HOLDOUT_CONSUMED']).lower()}`|",
        f"|마지막 신호일|`{primary['max_signal_date']}`|",
        f"|마지막 forward 목표일|`{primary['max_forward_target_date']}`|",
        "",
        "**둘 다 cutoff 이전이다.** 달력 자체가 잘려 있어 forward 목표일도 넘어갈 수 없다.",
        "",
        f"유효 paired 날짜 **{primary['dates']:,}개** ·"
        f" `SPY <= SMA200`이라 제외한 날짜 {primary['skipped_non_up_dates']:,}개 ·"
        f" ABS 통과 후보가 0개인 날짜 {primary['empty_abs_dates']:,}개",
        "",
    ]


def _checksum(primary: dict) -> list[str]:
    return [
        "## 2. 재현 checksum과 집계 방식", "",
        "**checksum은 관측 가중이고 재정의하지 않았다.** paired 분석은 날짜 가중을 쓴다.",
        "",
        "|값|집계|이번|기대|",
        "|---|---|---|---|",
        f"|control excess|관측 가중|**{_pct(primary['observation_weighted_control'])}**"
        f"|PR #15 `+1.188%`|",
        f"|control excess|날짜 가중|{_pct(primary['primary']['control_mean'])}|—|",
        "",
        f"관측 수 {primary['observation_count']:,}개"
        f" = 날짜 {primary['dates']:,} × {TOP_N}.",
        "",
        "**두 estimand는 개념적으로 다르지만 이 러너의 control 표본 구조에서는 정의상 같게"
        " 닫힌다.** forward가 없는 종목을 **랭킹 전에** 빼고 `min_score_population`을"
        " 통과한 날짜만 세므로 **control TOP5가 항상 정확히 5관측**이고, 같은 크기 집단의"
        " 평균의 평균은 전체 평균과 같다. 위 관측 수가 정확히 `날짜 × 5`인 것이 그"
        " 확인이다. 남는 차이는 부동소수점 누적 순서뿐이다.",
        "",
    ]


def _primary(primary: dict) -> list[str]:
    core = primary["primary"]
    return [
        f"## 3. Primary — 날짜 단위 paired `D_t` (`{PRIMARY_UNIVERSE}` · +{HORIZON})", "",
        "**두 평균을 따로 내서 빼지 않았다.** 같은 날짜·같은 시장 상태·같은 유니버스에서"
        " 후보 조건 하나만 바뀐 비교다.", "",
        "|값|결과|", "|---|---|",
        f"|control (날짜 가중)|{_pct(core['control_mean'])}|",
        f"|ABS (날짜 가중)|{_pct(core['treatment_mean'])}|",
        f"|**`mean(D)`**|**{_pct(core['mean'])}**|",
        f"|`median(D)`|{_pct(core['median'])}|",
        f"|양수 `D` 날짜 비율|{_share(core['positive_share'])}|",
        f"|`D` 최소 / 최대|{_pct(core['min'])} / {_pct(core['max'])}|",
        f"|유효 paired 날짜|{core['dates']:,}|",
        "",
        "**유니버스 평균은 두 팔에서 같다** — ABS는 후보 조건이지 유니버스 변경이 아니다."
        " 그래서 `D_t`에서 유니버스 평균이 상쇄되고 결국 두 바구니의 raw forward 평균"
        " 차이가 된다.",
        "",
    ]


def _binding(primary: dict) -> list[str]:
    binding = primary["binding"]
    changed = primary["changed_only"]
    lines = [
        "## 4. 필터 구속력", "",
        "**SMA200 게이트가 이미 켜져 있으므로 ABS가 거의 아무 일도 안 할 수 있다.**"
        " 그러면 \"개선 없음\"과 \"애초에 안 걸림\"이 구별되지 않는다.", "",
        "|지표|값|", "|---|---|",
        f"|`composition_changed_dates`|**{_share(binding['composition_changed_dates'])}**"
        f" ({binding['changed_dates_n']:,}일)|",
        f"|`candidate_replacement_rate`|{_share(binding['candidate_replacement_rate'])}"
        f" ({binding['replaced_candidates']:,} / {binding['control_candidate_days']:,})|",
        f"|TOP5가 완전히 같은 날짜|{_share(binding['identical_share'])}|",
        f"|평균 overlap|{_num(binding['mean_overlap'])} / {TOP_N}|",
        f"|ABS 통과 후보 수 (평균 / 최소 / 최대)|{_num(binding['abs_pool_mean'], 1)}"
        f" / {binding['abs_pool_min']} / {binding['abs_pool_max']}|",
        f"|ABS 통과가 {TOP_N}개 미만인 날짜|{binding['short_abs_dates']:,}|",
        "",
        f"### binding label — **{binding['label']}**", "",
        f"`NON_BINDING` = 0% · `LOW_BINDING` = 0~{BINDING_LOW:.0%} ·"
        f" `BINDING` ≥ {BINDING_LOW:.0%}. **5%는 해석 label이지 promotion threshold가"
        " 아니다.**",
        "",
        "### 구성이 바뀐 날짜만의 `D` 분포", "",
        "**희소한 몇 날짜에 의존하는지 드러내는 표다.**", "",
        "|값|결과|", "|---|---|",
        f"|날짜|{changed['dates']:,}|",
        f"|`mean(D)`|{_pct(changed['mean'])}|",
        f"|`median(D)`|{_pct(changed['median'])}|",
        f"|최소 / 최대|{_pct(changed['min'])} / {_pct(changed['max'])}|",
        "",
    ]
    if binding["label"] == LABEL_NON_BINDING:
        lines += [
            "### 왜 한 번도 안 걸렸는가 — **exploratory 후속 진단**", "",
            "> **이 절은 사전등록이 아니다.** 결과를 본 뒤 `NON_BINDING`의 원인을 설명하려고"
            " 추가한 post-result explanatory diagnostic이다. **판정에 쓰지 않았고 문턱"
            " 변경 근거로도 쓰지 않는다.** `NON_BINDING`의 직접 근거는 위 §4의"
            " **3,385일 전체에서 composition change가 0**이라는 실측이다.",
            "",
            "`RS = ABS(자기) − ABS(시장)`이라는 **항등식 때문에 두 신호가 강하게 중복될"
            " 구조적 이유가 있다.** 다만 이 항등식만으로 RS 상위의 `ABS > 0`이 일반적으로"
            " 보장되지는 않는다 — 정확한 조건은 `RS > −ABS(시장)`이고, `ABS(시장)`이 음수인"
            " 날에는 성립하지 않을 수 있다.",
            "",
            "**그래서 필연성 증명이 아니라 이 개발표본에서 실제로 그랬다는 관찰로 적는다.**"
            " 구간을 97일 간격으로 훑은 **34개 UP 날짜 exploratory 표본**이다.",
            "",
            "|값 (34일 표본)|결과|",
            "|---|---|",
            "|시장 `ABS(126,5)`가 양수인 UP 날짜|91.9% (중앙 +0.0909)|",
            "|TOP5 종목 `ABS`의 최솟값|**+0.1876**|",
            "|TOP5 종목 `ABS`의 5백분위 / 중앙|+0.3540 / +0.5268|",
            "|TOP5 중 `ABS <= 0`인 관측|0 / 170|",
            "",
            "**34일 exploratory 표본에서는 TOP5 `ABS` 최솟값이 +0.1876이었다.** 전체 표본"
            " 주장이 아니다 — 3,385일 전부의 TOP5 `ABS` 분포는 재지 않았다. 다만 위 §4가"
            " 그 3,385일 전부에서 구성 변경이 0이었다는 것을 이미 보였다.",
            "",
            "**문턱을 올리면 어떻게 되는지는 재지 않았다.** 사전등록이 사다리를 금지했고,"
            " 이 표를 문턱 변경의 근거로 쓰지 않는다.",
            "",
            "**이것은 ABS 자체가 쓸모없다는 뜻이 아니다.** `SPY <= SMA200` 구간이나 RS 상위가"
            " 아닌 후보군에서는 걸릴 수 있다. 잰 것은 **이 구조(`J126 + SMA200` + TOP5)**"
            " 에서 걸리지 않는다는 것뿐이다.",
            "",
        ]

    if binding["label"] == LABEL_LOW_BINDING:
        lines += ["> ⚠️ **`LOW_BINDING`에서 `median(D) >= 0`을 강한 robustness 증거로 읽지"
                  " 않는다.** 구성이 안 바뀐 날짜는 `D_t = 0`이라 0이 다수가 되어 중앙값이"
                  " 자동으로 0 이상이 된다. 시간 안정성은 기준 D가 담당한다.", ""]
    return lines


def _phases(primary: dict) -> list[str]:
    phases = primary["phases"]
    return [
        f"## 5. +{HORIZON} 위상 안정성", "",
        f"매일 뽑으면 +{HORIZON} 수익률이 {HORIZON - 1}/{HORIZON} 겹친다."
        " **관측 수를 독립 표본 수로 읽지 않는다.**", "",
        "|값|결과|", "|---|---|",
        f"|유효 위상|{phases['valid']}/{PHASE_COUNT}|",
        f"|양수 위상|{phases['positive']}|",
        f"|**양수 비율**|**{_share(phases['positive_share'])}**"
        f" (최소 {PHASE_POSITIVE_SHARE_MINIMUM:.0%})|",
        f"|위상 `mean-D` 중앙|{_pct(phases['median'])}|",
        f"|최소 / 최대|{_pct(phases['min'])} / {_pct(phases['max'])}|",
        "",
    ]


def _years(primary: dict) -> list[str]:
    lines = ["## 6. 연도 분포", "",
             "|연도|paired 날짜|`mean(D)`|`median(D)`|leave-one-year-out|",
             "|---|---|---|---|---|"]
    loyo = primary["leave_one_year_out"]
    for year, row in primary["by_year"].items():
        lines.append(
            f"|{year}|{row['dates']:,}|{_pct(row['mean'])}|{_pct(row['median'])}"
            f"|{_pct(loyo.get(year))}|"
        )
    label, reason = concentration_label(primary)
    lines += ["", f"### 연도 집중도 — **{label}**", "", reason, "",
              "**단독 hard veto로 쓰지 않는다.**", ""]
    return lines


def _random(primary: dict) -> list[str]:
    values = [value for value in primary["random"]["mean"].values() if value is not None]
    actual = primary["primary"]["mean"]
    beaten = sum(1 for value in values if actual is not None and actual > value)
    return [
        "## 7. paired random control (secondary diagnostic)", "",
        f"기존 시드 **{primary['random']['seeds']}개**를 그대로 썼고 같은 random ranking을"
        " full pool과 ABS-positive pool에 적용해 **날짜 paired**로 뺐다.", "",
        "**HARD A~E에 넣지 않았다. promotion criterion이 아니다.**", "",
        "|값|결과|", "|---|---|",
        f"|실제 `mean(D)`|**{_pct(actual)}**|",
        f"|무작위 `mean(D)` 중앙|{_pct(statistics.median(values)) if values else '—'}|",
        f"|무작위 최소 / 최대|{_pct(min(values)) if values else '—'}"
        f" / {_pct(max(values)) if values else '—'}|",
        f"|**이김**|**{beaten}/{len(values)}**|",
        "",
        "**해석 목적은 하나다** — 개선이 **RS-specific interaction**인지 **generic"
        " ABS-positive pool effect**인지 가르는 것이다. 랭킹과 무관하게 ABS 양수 풀이 원래"
        " 더 좋다면 무작위 팔에서도 같은 개선이 나온다. **어느 쪽도 자동 탈락 사유가"
        " 아니다.**",
        "",
    ]


def _ndx(ndx: dict | None) -> list[str]:
    lines = ["## 8. NDX100 robustness", "",
             "**`ALL`과 중첩되는 sub-universe다. 독립 OOS가 아니다.**", ""]
    if not ndx:
        return lines + ["*(아직 NDX100 실행이 없다)*", ""]
    core = ndx["primary"]
    return lines + [
        "|값|결과|", "|---|---|",
        f"|control (날짜 가중)|{_pct(core['control_mean'])}|",
        f"|ABS (날짜 가중)|{_pct(core['treatment_mean'])}|",
        f"|**`mean(D)`**|**{_pct(core['mean'])}**|",
        f"|`median(D)`|{_pct(core['median'])}|",
        f"|paired 날짜|{core['dates']:,}|",
        f"|binding|{ndx['binding']['label']}"
        f" ({_share(ndx['binding']['composition_changed_dates'])})|",
        "",
    ]


def _verdict(primary: dict, ndx: dict | None) -> list[str]:
    verdicts = hard_verdicts(primary, ndx)
    lines = ["## 9. 사전등록 판정 (HARD A~E)", "",
             "|기준|조건|결과|판정|", "|---|---|---|---|"]
    for key in "ABCDE":
        row = verdicts[key]
        lines.append(
            f"|**{key}**|{row['name']}|{row['detail']}"
            f"|{'**PASS**' if row['pass'] else '**FAIL**'}|"
        )
    lines += ["", f"### 최종 판정 — **{verdicts['verdict']}**", ""]
    if verdicts["verdict"] == PROMOTE:
        lines += ["PR #18(ABS Portfolio Translation)을 **사용자 승인 후에만** 연다."
                  " 이 판정은 \"ABS가 신호 층에서 살아남았다\"까지이고 **포트폴리오"
                  " economics는 아직 재지 않았다.**", ""]
    else:
        lines += ["**ABS candidate intervention은 종료한다.** ABS 문턱 변경 · horizon 변경 ·"
                  " ABS를 ranking weight로 변경 · SMA/price breakout 대안 · \"조금만 바꿔서"
                  " 다시\"를 하지 않는다. **사용자 검토 없이 다음 대안을 열지 않는다.**", ""]

    lines += ["## 10. Limitations", "",
              "- **개발 표본이다.** 이 구간은 PR #9~#16에서 반복 사용됐고 OOS 검증이 아니다",
              "- **NDX100은 독립 OOS가 아니다** — `ALL`과 중첩되는 sub-universe다",
              "- **portfolio economics를 재지 않았다** — 이 PR은 신호 층이다",
              "- **중첩 표본이다** — 관측 수를 독립 표본 수로 읽지 않았고 p-value를"
              " 만들지 않았다",
              "- 무작위 20시드는 coarse control이고 formal test가 아니다",
              "- **인과를 증명하지 않는다**",
              ""]
    return lines


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
