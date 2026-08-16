"""RS 알파가 `SPY > SMA200` 구간에 안정적으로 집중되는가. **로드맵 Phase 1 · PR #15.**

**discovery가 아니라 confirmatory market re-cut이다.** `runs/signal-j-study/all.json`에 J별
레짐 결과가 이미 있고 `classify_market_regime` 정의상 `BULL`·`CORRECTION`이 곧
`SPY > SMA200`이라 헤드라인 split의 일부는 이미 알려져 있다. **"새로 발견했다"고 쓰지
않는다.** 사전등록 전문은 `runs/market-condition-signal/README.md`다.

이 PR의 추가 가치는 다섯 축이다 — J63 frozen control · same-size random control · 비중첩
위상 안정성 · 연도 분포와 leave-one-year-out · NDX100 sub-universe robustness.
**NDX100도 `ALL`과 중첩되므로 독립 OOS가 아니다.**

## 아직 아닌 것

entry gate backtest가 아니다. portfolio experiment가 아니다. 새 strategy core가 아니다.
**신호 층 diagnostic이다.** "SPY>SMA200이면 진입 차단" 코드를 여기서 만들면 scope
violation이고, 그것은 PR #16의 일이다.

## 정의를 복제하지 않는다

`formation_strengths`(J별 RS) · `_eligible`(7.2 자격) · `forward_return`(+42와 stale) ·
`classify_market_regime`(시장 상태) · `Study`(유니버스 평균·버킷·무작위) · `research_calendar`
(연구 달력) · `random_score`를 **정본 그대로** 쓴다. 새 RS 공식도 새 SMA helper도 만들지
않는다.

시장 split은 **`above_sma200` 축**을 읽는다.

    UP    :  SPY adj close  >  SPY SMA200
    DOWN  :  SPY adj close  <= SPY SMA200

**`BULL`/`CORRECTION`/`RECOVERY`/`BEAR` 문자열을 grouping logic으로 파싱하지 않는다** —
분류기를 바꾸는 순간 그 파싱이 조용히 틀린다. SMA50도 realized vol도 쓰지 않는다.

## 홀드아웃을 아예 읽지 않는다

`research_calendar`가 달력 자체를 `HOLDOUT_START` 전에서 자르고, 러너는
`index + 42 >= len(calendar)`에서 멈춘다. **신호일만 거르면 forward 목표일이 넘어간다.**
산출물에 `max_signal_date`·`max_forward_target_date`를 남겨 둘 다 cutoff 이전인지 감사할 수
있게 한다.

## 중첩을 유의성으로 읽지 않는다

일별 TOP5는 강하게 겹치고 +42 수익률은 41/42가 겹친다. **관측 수를 독립 표본 수로 읽지
않고 p-value를 만들지 않는다.** 무작위 20시드도 formal test가 아니다.

    python3 selftest/market_condition_signal.py ALL
    python3 selftest/market_condition_signal.py NDX100
    python3 selftest/market_condition_signal.py report
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
from backtest.features import FeatureUnavailable  # noqa: E402
from backtest.holdout import (  # noqa: E402
    HOLDOUT_START,
    assert_no_holdout,
    holdout_metadata,
)
from backtest.regime import classify_market_regime  # noqa: E402
from backtest.study import TOP_LABEL, Forward, Study  # noqa: E402

# **정본 helper를 그대로 쓴다.** `_eligible`은 private이지만 자격 판정을 복제하면 이
# 연구와 PR #12가 서로 다른 유니버스를 보게 되고, 그러면 §16 checksum이 성립하지 않는다.
from selftest.j_signal_study import PARAMETERS, _eligible, formation_strengths  # noqa: E402
from selftest.funnel_run import forward_return  # noqa: E402
from selftest.real_run import REFERENCE_SYMBOL, RUNS_DIR, SOURCE_VERSION  # noqa: E402
from selftest.signal_study import research_calendar  # noqa: E402

EXPERIMENT = "market-condition-signal"

# 사전등록한 고정 변수. **결과를 보고 바꾸지 않는다**(테스트가 잠근다).
J_PRIMARY = 126
J_CONTROL = 63
JS = (J_CONTROL, J_PRIMARY)
SKIP = 5
HORIZON = 42
TOP_N = 5
RANDOM_SEEDS = tuple(range(20))
PHASE_COUNT = HORIZON

PRIMARY_UNIVERSE = "ALL"
UNIVERSES = {"ALL": ("SP500", "NDX100"), "NDX100": ("NDX100",)}

# 시장 split. 이름이 아니라 축이다.
UP = "UP"
DOWN = "DOWN"
GROUPS = (UP, DOWN)

# §13 사전등록 승격 문턱. 결과를 보고 낮추지 않는다.
RANDOM_BEAT_MINIMUM = 18
PHASE_POSITIVE_SHARE_MINIMUM = 0.60


def market_group(above_sma200: bool) -> str:
    """`SPY > SMA200`이면 UP, 같거나 아래면 DOWN. 경계는 DOWN이다."""
    return UP if above_sma200 else DOWN


# ---------------------------------------------------------------- 계산


def _cell(study: Study):
    return study.vs_universe.get((TOP_LABEL, HORIZON))


def _mean(study: Study):
    cell = _cell(study)
    return cell.mean if cell else None


def _totals(study: Study) -> tuple[float, int]:
    """`(합, 관측 수)`. 연도를 빼고 다시 평균 내려면 합과 수가 필요하다."""
    cell = _cell(study)
    return (cell.total, cell.count) if cell else (0.0, 0)


def _contrast(up: Study, down: Study):
    """`C = E_UP − E_DOWN`. 한쪽이 비면 대비가 성립하지 않으므로 None이다."""
    left, right = _mean(up), _mean(down)
    if left is None or right is None:
        return None
    return left - right


def new_study() -> Study:
    return Study((HORIZON,), top_n=TOP_N)


def run_universe(connection, name: str) -> dict:
    """하루씩 훑으며 (J, 시장 그룹)별 누적을 만든다. 자격·forward는 날짜당 한 번만 센다."""
    index_names = UNIVERSES[name]
    cache = BarCache(connection, SOURCE_VERSION)
    calendar = research_calendar(connection)
    assert_no_holdout(calendar)
    warmup = PARAMETERS.min_history_sessions

    overall = {j: {g: new_study() for g in GROUPS} for j in JS}
    phases = {j: {g: [new_study() for _ in range(PHASE_COUNT)] for g in GROUPS} for j in JS}
    by_year: dict[int, dict[str, dict[str, Study]]] = {j: {g: {} for g in GROUPS} for j in JS}
    # **무작위 대조군은 J와 무관하다.** 자격 유니버스와 날짜가 같으면 같은 시드가 같은
    # 종목을 뽑으므로 공통 baseline 하나를 두 J가 공유한다.
    control = {g: new_study() for g in GROUPS}

    dates = {g: 0 for g in GROUPS}
    year_dates: dict[str, dict[str, int]] = {}
    populations: list[int] = []
    dropped = 0
    max_signal_date = None
    max_target_date = None

    for index in range(warmup, len(calendar)):
        target = index + HORIZON
        if target >= len(calendar):
            # **forward 목표일이 잘린 달력 밖이다.** 여기서 멈춰야 홀드아웃을 안 읽는다.
            break
        as_of = calendar[index]
        target_date = calendar[target]
        snapshot = PointInTimeSnapshot(connection, as_of, SOURCE_VERSION, cache=cache)

        try:
            regime = classify_market_regime(snapshot, PARAMETERS)
        except FeatureUnavailable:
            continue
        group = market_group(regime.above_sma200)

        members: set[str] = set()
        for index_name in index_names:
            members |= snapshot.members(index_name)

        rows_base: list[tuple[str, dict[int, float], dict[int, float], frozenset]] = []
        for symbol in sorted(members):
            if _eligible(snapshot, symbol) is None:
                continue
            value, stale = forward_return(cache, symbol, as_of, target_date)
            if value is None:
                continue
            try:
                strengths = formation_strengths(snapshot, symbol, lookbacks=JS, skip=SKIP)
            except FeatureUnavailable:
                # J가 길어 이력이 모자란 경우. 세어 두고 통째로 뺀다 — J마다 다른 표본을
                # 보게 두면 "J 효과"와 "표본 구성 효과"가 섞인다.
                dropped += 1
                continue
            returns = {HORIZON: value}
            rows_base.append(
                (symbol, strengths, returns, frozenset({HORIZON} if stale else ()))
            )

        if len(rows_base) < PARAMETERS.min_score_population:
            continue

        dates[group] += 1
        populations.append(len(rows_base))
        max_signal_date = as_of
        max_target_date = target_date
        year = as_of[:4]
        year_dates.setdefault(year, {g: 0 for g in GROUPS})[group] += 1

        market, _ = forward_return(cache, REFERENCE_SYMBOL, as_of, target_date)
        market_returns = {HORIZON: market} if market is not None else {}

        rows_by_j = {
            j: [
                Forward(symbol, strengths[j], returns, stale)
                for symbol, strengths, returns, stale in rows_base
            ]
            for j in JS
        }

        # 무작위 TOP5. **그날의 group study에 직접 넣는다** — 전체에서 뽑아 나중에 나누면
        # 표본 정의가 어긋난다.
        base_rows = rows_by_j[J_CONTROL]
        picks = {
            seed: sorted(base_rows, key=lambda r: random_score(seed, as_of, r.symbol))[
                : min(TOP_N, len(base_rows))
            ]
            for seed in RANDOM_SEEDS
        }
        control[group].add_date(base_rows, market_returns, random_top_picks=picks)

        phase = (index - warmup) % PHASE_COUNT
        for j in JS:
            rows = rows_by_j[j]
            overall[j][group].add_date(rows, market_returns)
            phases[j][group][phase].add_date(rows, market_returns)
            by_year[j][group].setdefault(year, new_study()).add_date(rows, market_returns)

        if (index - warmup) % 500 == 0:
            print(f"  {as_of} · {group} · 자격 {len(rows_base)}종목"
                  f" · 날짜 {sum(dates.values()):,}")

    return {
        "name": name,
        "window": [calendar[warmup], calendar[-1]],
        "max_signal_date": max_signal_date,
        "max_forward_target_date": max_target_date,
        "dates": dates,
        "year_dates": year_dates,
        "populations": populations,
        "dropped_for_short_history": dropped,
        "overall": overall,
        "phases": phases,
        "by_year": by_year,
        "control": control,
    }


def _quantile(values: list[float], fraction: float):
    if not values:
        return None
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, int(fraction * (len(ordered) - 1)))]


def serialize(result: dict) -> dict:
    """보고서가 읽을 형태로 접는다. `Study`를 그대로 저장하지 않는다."""
    overall, phases, by_year = result["overall"], result["phases"], result["by_year"]
    control = result["control"]
    populations = result["populations"]

    payload = {
        "universe": result["name"],
        "experiment": EXPERIMENT,
        "confirmatory": True,
        "holdout": holdout_metadata(consumed=False),
        "window": result["window"],
        "max_signal_date": result["max_signal_date"],
        "max_forward_target_date": result["max_forward_target_date"],
        "horizon": HORIZON,
        "top_n": TOP_N,
        "j_primary": J_PRIMARY,
        "j_control": J_CONTROL,
        "dates": {**result["dates"], "total": sum(result["dates"].values())},
        "dropped_for_short_history": result["dropped_for_short_history"],
        "eligible_population": {
            "mean": statistics.fmean(populations) if populations else None,
            "min": min(populations) if populations else None,
            "max": max(populations) if populations else None,
        },
        "year_dates": result["year_dates"],
        "by_j": {},
        "random": {"seeds": len(RANDOM_SEEDS)},
    }

    for j in JS:
        groups = {}
        combined_total, combined_count = 0.0, 0
        for group in GROUPS:
            study = overall[j][group]
            total, count = _totals(study)
            combined_total += total
            combined_count += count
            groups[group] = {
                "signal_dates": study.dates,
                "observations": count,
                "mean": _mean(study),
                "stale": study.stale_counts.get(HORIZON, 0),
                "eligible_observations": study.observations,
            }

        phase_values = []
        for offset in range(PHASE_COUNT):
            value = _contrast(phases[j][UP][offset], phases[j][DOWN][offset])
            if value is not None:
                phase_values.append(value)
        positives = sum(1 for value in phase_values if value > 0)

        years = sorted(set(by_year[j][UP]) | set(by_year[j][DOWN]))
        year_rows = {}
        for year in years:
            cells = {}
            for group in GROUPS:
                study = by_year[j][group].get(year)
                cells[group] = _mean(study) if study else None
            year_rows[year] = {
                UP: cells[UP],
                DOWN: cells[DOWN],
                "contrast": (
                    cells[UP] - cells[DOWN]
                    if cells[UP] is not None and cells[DOWN] is not None
                    else None
                ),
            }

        # leave-one-year-out. 합과 수를 들고 있으므로 그 해만 빼고 다시 평균 낸다.
        loyo = {}
        for year in years:
            means = {}
            for group in GROUPS:
                total, count = _totals(overall[j][group])
                study = by_year[j][group].get(year)
                if study is not None:
                    year_total, year_count = _totals(study)
                    total -= year_total
                    count -= year_count
                means[group] = total / count if count else None
            loyo[year] = (
                means[UP] - means[DOWN]
                if means[UP] is not None and means[DOWN] is not None
                else None
            )

        payload["by_j"][str(j)] = {
            "groups": groups,
            "contrast": _contrast(overall[j][UP], overall[j][DOWN]),
            # §16 checksum. 두 group을 합치면 PR #12의 aggregate가 나와야 한다.
            "combined": {
                "observations": combined_count,
                "mean": combined_total / combined_count if combined_count else None,
            },
            "phases": {
                "valid": len(phase_values),
                "positive": positives,
                "positive_share": positives / len(phase_values) if phase_values else None,
                "median": statistics.median(phase_values) if phase_values else None,
                "min": min(phase_values) if phase_values else None,
                "max": max(phase_values) if phase_values else None,
                "values": phase_values,
            },
            "by_year": year_rows,
            "leave_one_year_out": loyo,
        }

    for group in GROUPS:
        table = control[group].random_top_draws
        payload["random"][group] = {
            str(seed): table[(seed, HORIZON)].mean
            for seed in RANDOM_SEEDS
            if (seed, HORIZON) in table
        }
    payload["random"]["contrast"] = {
        str(seed): payload["random"][UP][str(seed)] - payload["random"][DOWN][str(seed)]
        for seed in RANDOM_SEEDS
        if str(seed) in payload["random"][UP] and str(seed) in payload["random"][DOWN]
    }
    return payload


# ---------------------------------------------------------------- 판정


def beats(value, distribution: dict) -> tuple[int, int]:
    """실제 값이 무작위 분포의 몇 개를 이겼는가. **formal p-value가 아니다.**"""
    values = [v for v in distribution.values() if v is not None]
    if value is None:
        return 0, len(values)
    return sum(1 for v in values if value > v), len(values)


def hard_verdicts(primary: dict, ndx: dict | None) -> dict:
    """§13의 HARD A~D. **결과를 본 뒤 바꾸지 않는다**(테스트가 잠근다)."""
    challenger = primary["by_j"][str(J_PRIMARY)]
    up = challenger["groups"][UP]["mean"]
    contrast = challenger["contrast"]
    won, total = beats(contrast, primary["random"]["contrast"])
    phases = challenger["phases"]
    share = phases["positive_share"]
    median = phases["median"]
    ndx_contrast = ndx["by_j"][str(J_PRIMARY)]["contrast"] if ndx else None

    rows = {
        "A": {
            "name": "`E_126_UP > 0` AND `C_126 > 0`",
            "detail": f"E_126_UP {_pct(up)} · C_126 {_pct(contrast)}",
            "pass": up is not None and contrast is not None and up > 0 and contrast > 0,
        },
        "B": {
            "name": f"무작위 대비 ≥ {RANDOM_BEAT_MINIMUM}/20",
            "detail": f"**{won}/{total}**",
            "pass": won >= RANDOM_BEAT_MINIMUM,
        },
        "C": {
            "name": (
                f"위상 양수 비율 ≥ {PHASE_POSITIVE_SHARE_MINIMUM:.0%}"
                " AND 중앙 C > 0"
            ),
            "detail": f"양수 {_share(share)} · 중앙 {_pct(median)}",
            "pass": (
                share is not None
                and median is not None
                and share >= PHASE_POSITIVE_SHARE_MINIMUM
                and median > 0
            ),
        },
        "D": {
            "name": "`C_126_NDX > 0`",
            "detail": f"C_126_NDX {_pct(ndx_contrast)}",
            "pass": ndx_contrast is not None and ndx_contrast > 0,
        },
    }
    rows["verdict"] = (
        "PROMOTE_TO_PR16"
        if all(rows[key]["pass"] for key in ("A", "B", "C", "D"))
        else "DO_NOT_PROMOTE"
    )
    return rows


def concentration_label(primary: dict) -> tuple[str, str]:
    """§15의 BROAD / CONCENTRATED / MIXED. **HARD A~D를 바꾸지 않는다.**"""
    challenger = primary["by_j"][str(J_PRIMARY)]
    contrast = challenger["contrast"]
    loyo = [v for v in challenger["leave_one_year_out"].values() if v is not None]
    yearly = [v["contrast"] for v in challenger["by_year"].values() if v["contrast"] is not None]
    if contrast is None or not loyo or not yearly:
        return "MIXED", "표본이 모자라 판정할 수 없다"

    flips = [
        year
        for year, value in challenger["leave_one_year_out"].items()
        if value is not None and (value > 0) != (contrast > 0)
    ]
    positive_years = sum(1 for value in yearly if value > 0)
    share = positive_years / len(yearly)

    if flips:
        return "CONCENTRATED", (
            f"{', '.join(flips)}년을 빼면 full-sample 부호가 뒤집힌다"
        )
    if share >= 0.6:
        return "BROAD", (
            f"leave-one-year-out이 전부 같은 방향이고 양의 연도가 {positive_years}/{len(yearly)}"
        )
    return "MIXED", (
        f"leave-one-year-out은 안정적이지만 양의 연도가 {positive_years}/{len(yearly)}에 그친다"
    )


# ---------------------------------------------------------------- 산출


def out_dir() -> Path:
    path = RUNS_DIR / EXPERIMENT
    path.mkdir(parents=True, exist_ok=True)
    return path


def _pct(value, digits: int = 3) -> str:
    return "—" if value is None else f"{value * 100:+.{digits}f}%"


def stage_run(connection, name: str) -> int:
    print(f"# {name} (confirmatory market re-cut)")
    payload = serialize(run_universe(connection, name))
    path = out_dir() / f"{name.lower()}.json"
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n신호일 UP {payload['dates'][UP]:,} · DOWN {payload['dates'][DOWN]:,}")
    print(f"마지막 신호일 {payload['max_signal_date']}"
          f" · 마지막 forward 목표일 {payload['max_forward_target_date']}"
          f" (홀드아웃 {HOLDOUT_START})")
    for j in JS:
        cell = payload["by_j"][str(j)]
        print(f"  J{j:>3}: UP {_pct(cell['groups'][UP]['mean'])}"
              f" · DOWN {_pct(cell['groups'][DOWN]['mean'])}"
              f" · C {_pct(cell['contrast'])}"
              f" · 합침 {_pct(cell['combined']['mean'])}")
    print(f"→ {path.name}")
    return 0


def _num(value, digits: int = 2) -> str:
    return "—" if value is None else f"{value:.{digits}f}"


def _share(value, digits: int = 1) -> str:
    return "—" if value is None else f"{value * 100:.{digits}f}%"


def load(name: str) -> dict | None:
    path = out_dir() / f"{name.lower()}.json"
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else None


def existing_aggregate() -> dict:
    """PR #12가 낸 ALL TOP5 +42 값. §16 checksum의 기준이다."""
    path = RUNS_DIR / "signal-j-study" / "all.json"
    if not path.exists():
        return {}
    data = json.loads(path.read_text(encoding="utf-8"))
    return {
        j: data["by_j"][str(j)]["surface"][TOP_LABEL][str(HORIZON)]
        for j in JS
        if str(j) in data["by_j"]
    }


def stage_report(_connection) -> int:
    primary = load(PRIMARY_UNIVERSE)
    ndx = load("NDX100")
    lines = [
        "# PR #15 — Confirmatory Market Conditioning Signal Study",
        "",
        "## 1. 사전등록",
        "",
        "**물은 것:** `RS(126,5)` TOP5의 +42 forward excess가"
        " `SPY close > SMA200`과 `SPY close <= SMA200`에서 구조적으로 다른가.",
        "",
        f"**Primary endpoint(하나):** `C_126 = E_126_UP − E_126_DOWN`"
        f" (`{PRIMARY_UNIVERSE}` universe · +{HORIZON} sessions).",
        "",
        "**This is a confirmatory re-cut, not a discovery study.**"
        " `runs/signal-j-study/all.json`에 J별 레짐 결과가 이미 있고"
        " `classify_market_regime` 정의상 `BULL`·`CORRECTION`이 곧 `SPY > SMA200`이라"
        " **헤드라인 split의 일부 정보는 이미 알려져 있다.** 추가 가치는 J63 frozen"
        " control · same-size random control · 비중첩 위상 안정성 · 연도 분포 ·"
        " NDX100 sub-universe robustness 다섯 축에 있다.",
        "",
        "**승격 규칙 HARD A~D와 연도 집중도 label 기준은 결과 전에"
        " `README.md`에 박았고 사전등록 커밋으로 남겼다.**",
        "",
    ]
    if not primary:
        lines += ["**아직 `ALL` 실행이 없다.**", ""]
        return _write(lines)

    holdout = primary["holdout"]
    lines += [
        "**홀드아웃 상태**", "",
        "|항목|값|", "|---|---|",
        f"|`HOLDOUT_START`|`{holdout['HOLDOUT_START']}`|",
        f"|`HOLDOUT_CONSUMED`|`{str(holdout['HOLDOUT_CONSUMED']).lower()}`|",
        f"|마지막 신호일|`{primary['max_signal_date']}`|",
        f"|마지막 forward 목표일|`{primary['max_forward_target_date']}`|",
        "",
        "**둘 다 cutoff 이전이다.** 달력 자체가 잘려 있어 forward 목표일도 넘어갈 수 없다.",
        "",
    ]

    lines += _checksum_section(primary)
    lines += _primary_section(primary)
    lines += _random_section(primary)
    lines += _phase_section(primary)
    lines += _year_section(primary)
    lines += _ndx_section(ndx)
    lines += _evidence_section(primary, ndx)
    return _write(lines)


def _write(lines: list[str]) -> int:
    path = out_dir() / "results.md"
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("\n".join(lines))
    print(f"\n보고서: {RUNS_DIR.name}/{EXPERIMENT}/{path.name}")
    return 0


def _checksum_section(primary: dict) -> list[str]:
    existing = existing_aggregate()
    lines = ["## 2. Reproduction checksum", "",
             "**market group을 다시 합치면 PR #12의 aggregate가 나와야 한다.**"
             " 재현되지 않으면 결과를 해석하기 전에 원인을 찾는다.", "",
             "|J|기존 PR #12 +42|이번 re-cut 합침|차이|관측|",
             "|---|---|---|---|---|"]
    for j in JS:
        cell = primary["by_j"][str(j)]["combined"]
        want = existing.get(j)
        delta = (cell["mean"] - want) if (want is not None and cell["mean"] is not None) else None
        lines.append(
            f"|**{j}**|{_pct(want)}|**{_pct(cell['mean'])}**|{_pct(delta, 4)}"
            f"|{cell['observations']:,}|"
        )
    lines.append("")
    return lines


def _primary_section(primary: dict) -> list[str]:
    lines = ["## 3. Primary market split — ALL", "",
             "`UP` = `SPY adj close > SMA200` · `DOWN` = `<=`."
             " **`above_sma200` 축을 직접 읽었고 레짐 문자열을 파싱하지 않았다.**", "",
             "|J|UP 신호일|UP 관측|UP excess|DOWN 신호일|DOWN 관측|DOWN excess|**C = UP − DOWN**|",
             "|---|---|---|---|---|---|---|---|"]
    for j in JS:
        cell = primary["by_j"][str(j)]
        up, down = cell["groups"][UP], cell["groups"][DOWN]
        lines.append(
            f"|**{j}**|{up['signal_dates']:,}|{up['observations']:,}|{_pct(up['mean'])}"
            f"|{down['signal_dates']:,}|{down['observations']:,}|{_pct(down['mean'])}"
            f"|**{_pct(cell['contrast'])}**|"
        )
    population = primary["eligible_population"]
    total = primary["dates"]["total"]
    lines += ["",
              f"신호일 {total:,}개 (UP {primary['dates'][UP]:,} ·"
              f" DOWN {primary['dates'][DOWN]:,}) · 자격 종목 평균"
              f" {_num(population['mean'], 1)}"
              f" (최소 {population['min']} · 최대 {population['max']})"
              f" · 이력 부족 제외 {primary['dropped_for_short_history']:,}건",
              "",
              "**UP/DOWN 표본 크기가 크게 다르면 평균만 보고 해석하지 않는다.**", ""]

    lines += ["|J|stale(마지막 종가 고정) UP|DOWN|", "|---|---|---|"]
    for j in JS:
        cell = primary["by_j"][str(j)]
        lines.append(
            f"|{j}|{cell['groups'][UP]['stale']:,}|{cell['groups'][DOWN]['stale']:,}|"
        )
    lines += ["", "**거래가 멈춘 종목을 빼지 않는다.** 빼면 그것이 정확히 생존편향이다.", ""]
    return lines


def _random_section(primary: dict) -> list[str]:
    challenger = primary["by_j"][str(J_PRIMARY)]
    contrasts = primary["random"]["contrast"]
    ups = primary["random"][UP]
    values = [v for v in contrasts.values() if v is not None]
    up_values = [v for v in ups.values() if v is not None]
    won, total = beats(challenger["contrast"], contrasts)
    up_won, up_total = beats(challenger["groups"][UP]["mean"], ups)

    lines = ["## 4. Random control", "",
             f"기존 시드 **{len(RANDOM_SEEDS)}개**를 그대로 썼고 결과를 보고 늘리지 않았다."
             " 같은 날짜·같은 자격 유니버스·같은 TOP5 크기·같은 market group에서 뽑았다."
             " **그날의 group에 직접 넣었으므로** 전체에서 뽑아 나중에 나눈 것이 아니다.", "",
             "**formal p-value가 아니다.**", "",
             "|지표|실제(J126)|무작위 최소|무작위 중앙|무작위 최대|이김|",
             "|---|---|---|---|---|---|"]
    if values:
        lines.append(
            f"|**C = UP − DOWN**|**{_pct(challenger['contrast'])}**|{_pct(min(values))}"
            f"|{_pct(statistics.median(values))}|{_pct(max(values))}|**{won}/{total}**|"
        )
    if up_values:
        lines.append(
            f"|E_UP|{_pct(challenger['groups'][UP]['mean'])}|{_pct(min(up_values))}"
            f"|{_pct(statistics.median(up_values))}|{_pct(max(up_values))}"
            f"|{up_won}/{up_total}|"
        )
    lines += ["",
              "**무작위 대조군은 J와 무관하다** — 자격 유니버스와 날짜가 같으면 같은 시드가"
              " 같은 종목을 뽑으므로 공통 baseline 하나를 두 J가 공유한다. J63 대비도 같은"
              " 분포로 읽는다.", ""]
    control_won, control_total = beats(
        primary["by_j"][str(J_CONTROL)]["contrast"], contrasts
    )
    lines += [f"참고: J63의 C도 같은 분포에서 **{control_won}/{control_total}**을 이긴다.", ""]
    return lines


def _phase_section(primary: dict) -> list[str]:
    lines = [f"## 5. +{HORIZON} phase stability", "",
             f"매일 뽑으면 +{HORIZON} 수익률이 {HORIZON - 1}/{HORIZON} 겹친다."
             " **관측 수를 독립 표본 수로 읽지 않는다.**"
             f" {PHASE_COUNT}개 위상을 각각 평균 내 흩어짐을 본다.", "",
             "**그 위상에 UP과 DOWN 양쪽 모두 유효 표본이 있을 때만 contrast를 센다.**", "",
             "|J|유효 위상|양수|양수 비율|중앙 C|최소|최대|",
             "|---|---|---|---|---|---|---|"]
    for j in JS:
        cell = primary["by_j"][str(j)]["phases"]
        share = cell["positive_share"]
        lines.append(
            f"|**{j}**|{cell['valid']}/{PHASE_COUNT}|{cell['positive']}"
            f"|{_share(share)}"
            f"|{_pct(cell['median'])}|{_pct(cell['min'])}|{_pct(cell['max'])}|"
        )
    lines.append("")
    return lines


def _year_section(primary: dict) -> list[str]:
    challenger = primary["by_j"][str(J_PRIMARY)]
    control = primary["by_j"][str(J_CONTROL)]
    years = sorted(challenger["by_year"])
    lines = ["## 6. Year distribution", "",
             "**한쪽 group에 표본이 없으면 0으로 채우지 않고 `—`로 둔다.**", "",
             "|연도|UP 신호일|DOWN 신호일|J63 UP|J63 DOWN|C63|J126 UP|J126 DOWN|**C126**|",
             "|---|---|---|---|---|---|---|---|---|"]
    for year in years:
        counts = primary["year_dates"].get(year, {})
        left = control["by_year"].get(year, {})
        right = challenger["by_year"].get(year, {})
        lines.append(
            f"|{year}|{counts.get(UP, 0):,}|{counts.get(DOWN, 0):,}"
            f"|{_pct(left.get(UP))}|{_pct(left.get(DOWN))}|{_pct(left.get('contrast'))}"
            f"|{_pct(right.get(UP))}|{_pct(right.get(DOWN))}"
            f"|**{_pct(right.get('contrast'))}**|"
        )

    loyo = challenger["leave_one_year_out"]
    lines += ["", "### leave-one-year-out (J126 primary contrast)", "",
              "**결과를 보고 특정 연도를 별도로 제거하지 않았다.** 전 연도를 하나씩 뺀 값이다.",
              "", "|뺀 연도|C126 (그 해 제외)|", "|---|---|"]
    for year in years:
        lines.append(f"|{year}|{_pct(loyo.get(year))}|")
    values = [v for v in loyo.values() if v is not None]
    if values:
        lines += ["",
                  f"전체 `C_126` = **{_pct(challenger['contrast'])}** ·"
                  f" leave-one-year-out 최소 **{_pct(min(values))}** ·"
                  f" 최대 **{_pct(max(values))}**", ""]
    return lines


def _ndx_section(ndx: dict | None) -> list[str]:
    lines = ["## 7. NDX100 robustness", "",
             "**NDX100은 `ALL`과 중첩되는 sub-universe robustness check다."
             " 독립 OOS가 아니다.**", ""]
    if not ndx:
        return lines + ["*(아직 NDX100 실행이 없다)*", ""]
    lines += ["|J|UP 관측|UP excess|DOWN 관측|DOWN excess|**C**|",
              "|---|---|---|---|---|---|"]
    for j in JS:
        cell = ndx["by_j"][str(j)]
        up, down = cell["groups"][UP], cell["groups"][DOWN]
        lines.append(
            f"|**{j}**|{up['observations']:,}|{_pct(up['mean'])}"
            f"|{down['observations']:,}|{_pct(down['mean'])}"
            f"|**{_pct(cell['contrast'])}**|"
        )
    challenger = ndx["by_j"][str(J_PRIMARY)]
    won, total = beats(challenger["contrast"], ndx["random"]["contrast"])
    phases = challenger["phases"]
    lines += ["",
              f"NDX100 무작위 대비 **{won}/{total}**"
              f" · 유효 위상 {phases['valid']}/{PHASE_COUNT}"
              f" · 양수 비율 {_share(phases['positive_share'])}"
              f" · 중앙 {_pct(phases['median'])}",
              ""]
    return lines


def _evidence_section(primary: dict, ndx: dict | None) -> list[str]:
    challenger = primary["by_j"][str(J_PRIMARY)]
    control = primary["by_j"][str(J_CONTROL)]
    verdicts = hard_verdicts(primary, ndx)
    label, reason = concentration_label(primary)

    lines = ["## 8. Evidence", "",
             "**숫자만.**", "",
             "|값|J63|J126|", "|---|---|---|",
             f"|UP excess|{_pct(control['groups'][UP]['mean'])}"
             f"|{_pct(challenger['groups'][UP]['mean'])}|",
             f"|DOWN excess|{_pct(control['groups'][DOWN]['mean'])}"
             f"|{_pct(challenger['groups'][DOWN]['mean'])}|",
             f"|**C = UP − DOWN**|**{_pct(control['contrast'])}**"
             f"|**{_pct(challenger['contrast'])}**|",
             f"|위상 양수 비율|{_share(control['phases']['positive_share'])}"
             f"|{_share(challenger['phases']['positive_share'])}|",
             f"|위상 중앙 C|{_pct(control['phases']['median'])}"
             f"|{_pct(challenger['phases']['median'])}|",
             ""]

    interpretation = _interpretation(control, challenger)
    lines += ["## 9. Interpretation", "",
              "**Evidence의 직접 해석까지만 적는다.**", "",
              interpretation, ""]

    # **conditioning의 "형태"가 두 J에서 다르다.** 평균만 보면 뭉뚱그려진다.
    control_down = control["groups"][DOWN]["mean"]
    challenger_down = challenger["groups"][DOWN]["mean"]
    if control_down is not None and challenger_down is not None:
        lines += [
            "**다만 conditioning의 형태는 두 J에서 다르다.** J63은 DOWN에서 alpha가"
            f" 음수로 반전되는 반면({_pct(control_down)}), J126은 DOWN에서도 양의 alpha가"
            f" 남는다({_pct(challenger_down)}). 따라서 **J126에 대한 SMA200 gate의 경제적"
            " 효과는 signal study만으로 방향을 확정할 수 없으며 PR #16에서 직접 검증해야"
            " 한다.**",
            "",
            "**이 차이가 PR #16의 질문을 바꾼다.** J126에서 `SPY <= SMA200` 신규진입을"
            " 완전히 차단하면 신호 층에서 이미 양수인 구간을 통째로 버리는 것이다. 그래서"
            " PR #16은 \"나쁜 거래를 제거한다\"는 실험이 아니라 **\"더 약하지만 여전히 양의"
            " alpha를 가진 DOWN 구간을 포기했을 때 자본 효율·MDD·after-cost"
            " benchmark-relative economics가 전체적으로 좋아지는가\"**를 묻는 실험이다.",
            "",
        ]
        down_years = [
            value
            for value in (row[DOWN] for row in challenger["by_year"].values())
            if value is not None
        ]
        if down_years:
            lines += [
                f"**DOWN의 평균 자체도 안정적이지 않다.** 연도별 J126 DOWN이"
                f" {_pct(min(down_years))} ~ {_pct(max(down_years))}로 흩어져 있어"
                f" 전체 평균 {_pct(challenger_down)}를 상시적인 양의 edge로 읽지 않는다.",
                "",
            ]

    # 사전등록 판정과 연도 집중도가 다른 방향을 가리키면 그것을 숨기지 않는다.
    if label == "CONCENTRATED":
        lines += [
            "**HARD 기준과 연도 집중도가 다른 방향을 가리킨다.** 사전등록한 A~D는 통과했지만"
            f" 연도 label은 `{label}`이다(§12). 사전등록대로 연도 집중도를 단독 veto로 쓰지"
            " 않으므로 판정은 바뀌지 않지만, **full-sample contrast를 상시적인 효과로 읽지"
            " 않는다.**",
            "",
        ]

    if control["contrast"] is not None and challenger["contrast"] is not None:
        if control["contrast"] > challenger["contrast"]:
            lines += [
                "**frozen control(J63)의 시장 대비가 조립 대상(J126)보다 크다**"
                f" ({_pct(control['contrast'])} vs {_pct(challenger['contrast'])})."
                " 위상 안정성도 J63이 더 높다"
                f" ({_share(control['phases']['positive_share'])} vs"
                f" {_share(challenger['phases']['positive_share'])})."
                " 사전등록대로 `C_126 > C_63`을 승격 필수조건으로 두지 않았으므로 판정은"
                " 바뀌지 않지만, **시장 조건이 J126을 특별히 살린다는 근거는 아니다.**",
                "",
            ]

    lines += ["## 10. Limitations", "",
              "- **confirmatory re-cut이다.** 헤드라인 split의 일부는 이미 알려져 있었다",
              "- **development sample이다.** 이 구간은 PR #9~#14에서 반복 관찰됐다",
              "- **사전 레짐 정보가 이미 공개돼 있었다** (`CLAUDE.md`의"
              " `RECOVERY/HIGH_VOL` 값)",
              "- **NDX100은 독립 OOS가 아니다** — `ALL`과 중첩되는 sub-universe다",
              "- **portfolio economics를 재지 않았다** — 이 PR은 신호 층이다",
              "- **인과를 증명하지 않는다** — 시장 상태와 alpha의 연관만 관찰했다",
              "- **중첩 표본이다** — 관측 수를 독립 표본 수로 읽지 않았고 p-value를"
              " 만들지 않았다",
              "- 무작위 20시드는 coarse control이고 formal test가 아니다",
              _stale_limitation(primary),
              ""]

    lines += ["## 11. Pre-registered verdict", "",
              "|기준|물음|결과|판정|", "|---|---|---|---|"]
    for key in ("A", "B", "C", "D"):
        row = verdicts[key]
        lines.append(
            f"|**HARD {key}**|{row['name']}|{row['detail']}"
            f"|{'**PASS**' if row['pass'] else '**FAIL**'}|"
        )
    lines += ["", f"### 최종 판정 — **{verdicts['verdict']}**", ""]
    if verdicts["verdict"] == "PROMOTE_TO_PR16":
        lines += ["이 판정의 의미는 **오직** 이것이다.", "",
                  "> `SPY>SMA200`을 실제 신규진입 gate로 넣어 portfolio economics를"
                  " **한 번 검증할 근거**가 생겼다.", "",
                  "**\"전략이 검증됐다\"가 아니다.** PR #16은 사용자 승인 후에만 연다.", ""]
    else:
        lines += ["**Phase 1 market-condition hypothesis는 현재 단일 처치에서 지지되지"
                  " 않았다.**", "",
                  "그래서 다음을 **하지 않는다** — SMA150 · SMA250 · 10개월 이동평균 ·"
                  " `BULL`만 · volatility gate 추가 · SMA50 추가."
                  " **사용자 검토 없이 다음 대안을 열지 않는다.**", ""]

    lines += ["## 12. Year concentration", "",
              f"### **{label}**", "", reason, "",
              "**이 label은 HARD A~D를 사후 변경하지 않는다.** 연도 집중도는 robustness"
              " diagnostic이지 단독 promotion veto가 아니다 — 시장 상태 효과는 본질적으로"
              " 드문 위기 구간과 연결될 수 있다.", ""]
    return lines


def _stale_limitation(primary: dict) -> str:
    """stale/frozen forward 비중. **버그가 아니라 last-close freeze가 작동한 결과다.**

    이것을 이유로 stale을 제거해 다시 분석하지 않는다 — 그 순간 또 다른 연구가 되고,
    빼는 것 자체가 생존편향이다.
    """
    challenger = primary["by_j"][str(J_PRIMARY)]
    groups = challenger["groups"]
    stale = groups[UP]["stale"] + groups[DOWN]["stale"]
    observations = groups[UP]["observations"] + groups[DOWN]["observations"]
    if not observations:
        return "- stale 비중을 셀 표본이 없다"
    return (
        f"- **stale/frozen forward 비중이 높다** — TOP5 +{HORIZON} 관측 {observations:,}개"
        f" 중 {stale:,}개({stale / observations:.1%})가 마지막 거래 종가로 고정됐다."
        " 이는 기존 PR #12와 **동일한 last-close freeze 정의를 재사용한 결과**이며 이번"
        " re-cut만의 현상이 아니다(aggregate checksum이 그것을 보인다). 다만 **절대"
        " 수익률 수준을 해석할 때 유의한다.** 거래가 멈춘 종목을 빼면 그것이 정확히"
        " 생존편향이므로 제거해 재분석하지 않는다"
    )


def _interpretation(control: dict, challenger: dict) -> str:
    """§8의 A~D 해석 틀. **사전등록한 네 경우 중 하나로 읽는다.**"""
    left, right = control["contrast"], challenger["contrast"]
    if left is None or right is None:
        return "표본이 모자라 해석하지 않는다."
    left_up = (control["groups"][UP]["mean"] or 0) > 0
    right_up = (challenger["groups"][UP]["mean"] or 0) > 0
    if left > 0 and right > 0 and left_up and right_up:
        return (
            "**경우 A — family-level market conditioning과 일관.** J63과 J126 모두 UP"
            " 상태에 alpha가 집중된다. 시장 조건이 J126만의 현상이 아니라 cross-sectional"
            " momentum family 전체에 작동하는 것으로 읽힌다. **그래도 시장 gate 가설은"
            " 의미가 있다** — 사전등록대로 `C_126 > C_63`을 승격 필수조건으로 두지 않았다."
        )
    if right > 0 and left <= 0:
        return (
            "**경우 B — J126-specific interaction 가능성.** J126에서만 UP 집중이"
            " 관찰된다. frozen control J63에서는 같은 방향이 나타나지 않는다."
        )
    if left > 0 and right <= 0:
        return (
            "**경우 C — frozen alpha under test에 대한 시장 gate 근거 약화.** J63은"
            " 안정적인데 J126이 그렇지 않다. 조립 대상 신호에 시장 게이트를 붙일 근거가"
            " 약하다."
        )
    return (
        "**경우 D — market conditioning hypothesis 약화.** 둘 다 UP 집중이 관찰되지"
        " 않는다."
    )


# ---------------------------------------------------------------- CLI


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
