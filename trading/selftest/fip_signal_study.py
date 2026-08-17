"""`ID(126,5) < 0` 후보 조건이 RS126 TOP5의 +42 초과수익을 높이는가. **Phase 6 · PR #20 Stage A.**

사전등록 전문은 `runs/fip-quality/README.md`이고 **결과 전에** 커밋했다.
**이 러너는 포트폴리오를 건드리지 않는다.**

## 묻는 것

    SPY > SMA200인 개발표본에서, ID(126,5) < 0인 후보 안에서 다시 뽑은 RS126 TOP5가
    같은 날짜의 기존 RS126 TOP5보다 +42 forward excess를 높이는가?

Frog-in-the-Pan은 **같은 누적 momentum이라도 어떤 경로로 쌓였는지**를 본다. 작고 잦은
움직임으로 쌓인 종목(continuous, `ID < 0`)이 몇 번의 큰 jump로 오른 종목(discrete)보다
continuation이 강하다는 가설이다.

**논문 복제가 아니다.** 논문은 12−1개월 winner−loser 스프레드이고 우리는 frozen RS와
같은 `lookback=126, skip=5`에 long-only TOP5다.

## 필터 위치

    자격 유니버스 → RS / ID 계산 → ID < 0 후보 조건 → 살아남은 후보를 SAME RS로 정렬 → TOP5

**기존 TOP5에서 미달만 지우는 것이 아니다.** ID >= 0인 RS 2등이 빠지면 ID < 0인 RS 6등이
들어온다. **통과 후보가 5개 미만이면 그날 TOP5는 5개 미만이고 backfill하지 않는다.**

## primary는 날짜 단위 paired 비교다

    Control_t = 기존 RS126 TOP5의 +42 excess (날짜 평균)
    FIP_t     = ID < 0 후보에서 다시 뽑은 TOP5의 +42 excess (날짜 평균)
    D_t       = FIP_t − Control_t
    primary   = mean(D_t)

**두 평균을 따로 내서 빼지 않는다.** PR #17과 같은 구조이고 새 평가 철학을 만들지 않는다.

## 정의를 복제하지 않는다

`absolute_momentum`(PRET) · `information_discreteness` · `_eligible` · `forward_return` ·
`classify_market_regime(...).above_sma200` · `research_calendar` · `random_score`를 정본
그대로 쓴다. HARD A~E와 binding label은 **PR #17 러너에서 import**한다.

    python3 selftest/fip_signal_study.py ALL
    python3 selftest/fip_signal_study.py NDX100
    python3 selftest/fip_signal_study.py report
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
from backtest.features import (  # noqa: E402
    FeatureUnavailable,
    absolute_momentum,
    information_discreteness,
)
from backtest.holdout import (  # noqa: E402
    HOLDOUT_START,
    assert_no_holdout,
    holdout_metadata,
)
from backtest.regime import classify_market_regime  # noqa: E402
# **PR #17의 paired 구조·binding label·HARD A~E를 그대로 쓴다.** 복제하면 두 연구의
# 판정 철학이 갈린다.
from selftest.absolute_momentum_signal import (  # noqa: E402
    BINDING_LOW,
    LABEL_NON_BINDING,
    PHASE_POSITIVE_SHARE_MINIMUM,
    Paired,
    basket_excess,
    binding_label,
    concentration_label,
    top_n,
)
from selftest.funnel_run import forward_return  # noqa: E402
from selftest.j_signal_study import PARAMETERS, _eligible  # noqa: E402
from selftest.market_condition_signal import market_group  # noqa: E402
from selftest.real_run import RUNS_DIR, SOURCE_VERSION  # noqa: E402
from selftest.signal_study import research_calendar  # noqa: E402

EXPERIMENT = "fip-quality"
# PR #17이 같은 날짜·같은 유니버스·같은 지평으로 낸 control. checksum의 source of truth다.
PRIOR_EXPERIMENT = "absolute-momentum-signal"

# 사전등록한 고정 변수. **결과를 보고 바꾸지 않는다**(테스트가 잠근다).
J = 126
SKIP = 5
ID_LOOKBACK = 126
ID_SKIP = 5
# **문턱이 아니라 부호 경계다.** 최적화한 숫자가 아니다.
ID_THRESHOLD = 0.0
HORIZON = 42
TOP_N = 5
RANDOM_SEEDS = tuple(range(20))
PHASE_COUNT = HORIZON

PRIMARY_UNIVERSE = "ALL"
UNIVERSES = {"ALL": ("SP500", "NDX100"), "NDX100": ("NDX100",)}
MARKET_GROUP = "UP"

PROMOTE = "PROMOTE_FIP_TO_PORTFOLIO"
DO_NOT_PROMOTE = "DO_NOT_TRANSLATE_FIP"

# ID 분포를 적을 백분위. 사전등록 §13이 정한 목록이다.
ID_PERCENTILES = (10, 25, 75, 90)


def percentile(values: list[float], fraction: float) -> float | None:
    """정렬된 표본의 nearest-rank 백분위. **보간하지 않는다.**"""
    if not values:
        return None
    ordered = sorted(values)
    rank = max(1, min(len(ordered), int(-(-len(ordered) * fraction // 1))))
    return ordered[rank - 1]


def describe_id(values: list[float]) -> dict:
    if not values:
        return {"count": 0, "mean": None, "median": None} | {
            f"p{p}": None for p in ID_PERCENTILES
        }
    return {
        "count": len(values),
        "mean": statistics.fmean(values),
        "median": statistics.median(values),
        **{f"p{p}": percentile(values, p / 100) for p in ID_PERCENTILES},
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

    observation_total, observation_count = 0.0, 0

    dates = 0
    skipped_non_up = 0
    empty_fip_dates = 0
    changed_dates = 0
    identical_dates = 0
    overlaps: list[int] = []
    replaced_candidates = 0
    control_candidate_days = 0
    fip_pool_sizes: list[int] = []
    short_fip_dates = 0
    basket_sizes: list[int] = []
    # ID 분포는 셋으로 나눠 본다 — 자격 유니버스 전체 · control TOP5 · treatment TOP5.
    id_universe: list[float] = []
    id_control_top: list[float] = []
    control_top_continuous = 0
    control_top_names = 0
    treatment_top_names = 0
    treatment_top_nonpositive_pret = 0
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
        fip_ranked: list[tuple[float, str]] = []
        forwards: dict[str, float] = {}
        ids: dict[str, float] = {}
        prets: dict[str, float] = {}
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
                own = absolute_momentum(adjusted, J, SKIP)
                market = absolute_momentum(reference, J, SKIP)
                discreteness = information_discreteness(adjusted, ID_LOOKBACK, ID_SKIP)
            except FeatureUnavailable:
                continue
            # **RS는 자기 항 − 시장 항이다.** 같은 helper라 정의가 갈릴 자리가 없다.
            rs = own - market
            forwards[symbol] = value
            ids[symbol] = discreteness
            prets[symbol] = own
            ranked.append((rs, symbol))
            # **`ID < 0`만 본다.** `PRET > 0`을 함께 걸면 ABS가 몰래 되살아난다(§6).
            if discreteness < ID_THRESHOLD:
                fip_ranked.append((rs, symbol))

        if len(ranked) < PARAMETERS.min_score_population:
            continue

        universe_mean = statistics.fmean(forwards.values())
        control_top = top_n(ranked)
        fip_top = top_n(fip_ranked)
        fip_pool_sizes.append(len(fip_ranked))
        if len(fip_ranked) < TOP_N:
            short_fip_dates += 1
        if not fip_top:
            empty_fip_dates += 1
            continue

        control_excess = basket_excess(control_top, forwards, universe_mean)
        fip_excess = basket_excess(fip_top, forwards, universe_mean)
        if control_excess is None or fip_excess is None:
            continue

        dates += 1
        max_signal_date = as_of
        max_target_date = target_date

        overall.add(control_excess, fip_excess)
        phases[(index - warmup) % PHASE_COUNT].add(control_excess, fip_excess)
        by_year.setdefault(as_of[:4], Paired()).add(control_excess, fip_excess)

        # 구속력.
        control_candidate_days += len(control_top)
        replaced_candidates += sum(
            1 for symbol in control_top if symbol not in set(fip_top)
        )
        overlaps.append(len(set(control_top) & set(fip_top)))
        basket_sizes.append(len(fip_top))
        if set(control_top) != set(fip_top):
            changed_dates += 1
            changed_only.add(control_excess, fip_excess)
        else:
            identical_dates += 1

        # ID 분포와 §6의 ABS 진단.
        id_universe.extend(ids.values())
        for symbol in control_top:
            id_control_top.append(ids[symbol])
            control_top_names += 1
            if ids[symbol] < ID_THRESHOLD:
                control_top_continuous += 1
        for symbol in fip_top:
            treatment_top_names += 1
            if prets[symbol] <= 0:
                treatment_top_nonpositive_pret += 1

        # checksum — 관측 가중 control.
        for symbol in control_top:
            if symbol in forwards:
                observation_total += forwards[symbol] - universe_mean
                observation_count += 1

        # paired random. **같은 random ranking을 두 풀에 적용한다.**
        for seed in RANDOM_SEEDS:
            scored = [(random_score(seed, as_of, symbol), symbol) for _, symbol in ranked]
            fip_symbols = {symbol for _, symbol in fip_ranked}
            fip_scored = [item for item in scored if item[1] in fip_symbols]
            left = basket_excess(top_n(scored), forwards, universe_mean)
            right = basket_excess(top_n(fip_scored), forwards, universe_mean)
            if left is not None and right is not None:
                control_random[seed].add(left, right)

        if (index - warmup) % 500 == 0:
            print(f"  {as_of} · 자격 {len(ranked)} · ID<0 통과 {len(fip_ranked)}"
                  f" · 날짜 {dates:,}")

    return {
        "name": name,
        "window": [calendar[warmup], calendar[-1]],
        "max_signal_date": max_signal_date,
        "max_forward_target_date": max_target_date,
        "dates": dates,
        "skipped_non_up_dates": skipped_non_up,
        "empty_fip_dates": empty_fip_dates,
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
            "fip_pool_sizes": fip_pool_sizes,
            "short_fip_dates": short_fip_dates,
            "basket_sizes": basket_sizes,
        },
        "distribution": {
            "id_universe": id_universe,
            "id_control_top": id_control_top,
            "control_top_continuous": control_top_continuous,
            "control_top_names": control_top_names,
            "treatment_top_names": treatment_top_names,
            "treatment_top_nonpositive_pret": treatment_top_nonpositive_pret,
        },
    }


def serialize(result: dict) -> dict:
    binding = result["binding"]
    dist = result["distribution"]
    dates = result["dates"]
    changed_share = binding["changed_dates_n"] / dates if dates else None
    total, count = result["observation_control"]
    sizes = binding["fip_pool_sizes"]
    baskets = binding["basket_sizes"]

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
        "stage": "A",
        "market_group": MARKET_GROUP,
        "holdout": holdout_metadata(consumed=False),
        "window": result["window"],
        "max_signal_date": result["max_signal_date"],
        "max_forward_target_date": result["max_forward_target_date"],
        "horizon": HORIZON,
        "top_n": TOP_N,
        "j": J,
        "id": {"lookback": ID_LOOKBACK, "skip": ID_SKIP, "threshold": ID_THRESHOLD},
        "dates": dates,
        "skipped_non_up_dates": result["skipped_non_up_dates"],
        "empty_fip_dates": result["empty_fip_dates"],
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
            "fip_pool_mean": statistics.fmean(sizes) if sizes else None,
            "fip_pool_min": min(sizes) if sizes else None,
            "fip_pool_max": max(sizes) if sizes else None,
            "short_fip_dates": binding["short_fip_dates"],
            "basket_size_mean": statistics.fmean(baskets) if baskets else None,
            "basket_size_min": min(baskets) if baskets else None,
        },
        "distribution": {
            "id_universe": describe_id(dist["id_universe"]),
            "id_control_top": describe_id(dist["id_control_top"]),
            "control_top_continuous_share": (
                dist["control_top_continuous"] / dist["control_top_names"]
                if dist["control_top_names"]
                else None
            ),
            "control_top_continuous": dist["control_top_continuous"],
            "control_top_names": dist["control_top_names"],
            # §6 — ABS를 되살리지 않았다는 것을 값으로 남긴다.
            "treatment_top_nonpositive_pret": dist["treatment_top_nonpositive_pret"],
            "treatment_top_names": dist["treatment_top_names"],
            "treatment_top_nonpositive_pret_share": (
                dist["treatment_top_nonpositive_pret"] / dist["treatment_top_names"]
                if dist["treatment_top_names"]
                else None
            ),
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
    print(f"# {name} · ID({ID_LOOKBACK},{ID_SKIP}) < 0 · {MARKET_GROUP} 날짜만")
    payload = serialize(run_universe(connection, name))
    path = out_dir() / f"signal-{name.lower()}.json"
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
          f" · FIP {_pct(primary['treatment_mean'])}")
    print(f"**mean(D) {_pct(primary['mean'])}** · median {_pct(primary['median'])}"
          f" · 양수 날짜 {_share(primary['positive_share'])}")
    print(f"binding {binding['label']}"
          f" · 구성 변경 {_share(binding['composition_changed_dates'])}"
          f" ({binding['changed_dates_n']:,}일)"
          f" · 후보 교체율 {_share(binding['candidate_replacement_rate'])}")
    print(f"→ {path.name}")
    return 0


def load(name: str) -> dict | None:
    path = out_dir() / f"signal-{name.lower()}.json"
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else None


def prior_control(name: str) -> dict | None:
    """PR #17이 같은 날짜·유니버스·지평으로 낸 산출물. checksum의 source of truth다."""
    path = RUNS_DIR / PRIOR_EXPERIMENT / f"{name.lower()}.json"
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else None


def hard_verdicts(primary: dict, ndx: dict | None) -> dict:
    """§15의 HARD A~E. **PR #17과 같은 다섯 개이고 결과를 본 뒤 바꾸지 않는다.**"""
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


def stage_a_verdict() -> str | None:
    """저장된 Stage A 판정. 없으면 None이다.

    **Stage B 러너가 이것을 읽고 promotion이 아니면 실행을 거부한다**(사전등록 §8).
    """
    primary = load(PRIMARY_UNIVERSE)
    if primary is None:
        return None
    return hard_verdicts(primary, load("NDX100"))["verdict"]


def stage_report(_connection) -> int:
    primary = load(PRIMARY_UNIVERSE)
    ndx = load("NDX100")
    lines = [
        "# PR #20 Stage A — FIP / Information Discreteness Signal Study",
        "",
        f"**물은 것:** `SPY > SMA200`인 개발표본에서, `ID({ID_LOOKBACK},{ID_SKIP}) < 0`"
        " 후보 안에서 다시 뽑은 RS126 TOP5가 **동일 날짜의** 기존 RS126 TOP5보다"
        f" +{HORIZON} forward excess를 높이는가.",
        "",
        "**이 Stage는 포트폴리오를 건드리지 않는다.** 사전등록은 결과 전에 커밋했고"
        " (`README.md`) HARD A~E·binding label·Stage B 규칙을 **그때 전부** 박았다.",
        "",
        "**FIP는 alpha 예산의 마지막 카드다.** 실패하면 long-only cross-sectional momentum"
        " 단독 전략의 alpha construction을 종료한다.",
        "",
    ]
    if not primary:
        return _write(lines + ["**아직 `ALL` 실행이 없다.**", ""])

    lines += _idea()
    lines += _boundary(primary)
    lines += _checksum(primary, ndx)
    lines += _primary(primary)
    lines += _binding(primary)
    lines += _distribution(primary)
    lines += _phases(primary)
    lines += _years(primary)
    lines += _random(primary)
    lines += _ndx(ndx)
    lines += _verdict(primary, ndx)
    lines += _outcome(primary, ndx)
    return _write(lines)


def _write(lines: list[str]) -> int:
    path = out_dir() / "results.md"
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("\n".join(lines))
    print(f"\n보고서: {RUNS_DIR.name}/{EXPERIMENT}/{path.name}")
    return 0


def _idea() -> list[str]:
    return [
        "## 1. 논문 아이디어와 이번 adaptation", "",
        "Da·Gurun·Warachka(2014)의 Frog-in-the-Pan은 **같은 누적 momentum이라도 작고 잦은"
        " 움직임으로 쌓인 종목**(continuous)이 **몇 번의 큰 jump로 오른 종목**(discrete)보다"
        " 이후 continuation이 강하다고 본다.", "",
        "**논문 복제라고 쓰지 않는다.**", "",
        "|항목|논문|이번|", "|---|---|---|",
        "|formation|12−1 개월|**frozen RS와 같은 `126 / skip 5`**|",
        "|포지션|winner−loser 스프레드|**long-only TOP5**|",
        "|선택|ID 십분위 등|**`ID < 0` 이진 조건 하나**|",
        "|시장 조건|없음|**`SPY > SMA200` 게이트 위에서**|",
        "",
        "```",
        "PRET = absolute_momentum(adj_close, 126, 5)",
        "ID   = sign(PRET) × (n_neg − n_pos) / (n_pos + n_neg)",
        "       n_pos + n_neg == 0 이면 ID = 0",
        "```",
        "",
        "**크기로 가중하지 않는다** — 부호의 빈도만 본다. 크기를 넣으면 RS의 magnitude"
        " 정보와 역할이 겹친다. `PRET`은 `absolute_momentum` 정본을 그대로 부르므로 RS와"
        " **같은 두 endpoint**를 쓴다.",
        "",
    ]


def _boundary(primary: dict) -> list[str]:
    holdout = primary["holdout"]
    return [
        "## 2. 데이터 경계", "",
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
        f" ID<0 통과 후보가 0개인 날짜 {primary['empty_fip_dates']:,}개",
        "",
    ]


def _checksum(primary: dict, ndx: dict | None) -> list[str]:
    lines = [
        "## 3. 재현 checksum", "",
        "**PR #17이 같은 날짜·유니버스·지평으로 낸 control을 source of truth로 읽어"
        " 대조한다.** drift가 있으면 FIP 결과를 해석하지 않는다.", "",
        "|유니버스|PR #17 (관측 가중)|이번 (관측 가중)|일치|",
        "|---|---|---|---|",
    ]
    for name, run in (("ALL", primary), ("NDX100", ndx)):
        if run is None:
            continue
        earlier = prior_control(name)
        before = earlier["observation_weighted_control"] if earlier else None
        after = run["observation_weighted_control"]
        same = (
            before is not None
            and after is not None
            and abs(before - after) < 1e-12
        )
        lines.append(
            f"|{name}|{_pct(before)}|**{_pct(after)}**"
            f"|{'**예**' if same else '아니오'}|"
        )
    lines += [
        "",
        f"관측 수 {primary['observation_count']:,}개"
        f" = 날짜 {primary['dates']:,} × {TOP_N}.",
        "",
        "**checksum은 관측 가중이고 paired 분석은 날짜 가중이다.** 두 estimand는 개념적으로"
        " 다르지만 이 러너의 control 표본 구조에서는 정의상 같게 닫힌다 — forward가 없는"
        " 종목을 랭킹 전에 빼므로 control TOP5가 항상 정확히 5관측이다.",
        "",
    ]
    return lines


def _primary(primary: dict) -> list[str]:
    core = primary["primary"]
    return [
        f"## 4. Primary — 날짜 단위 paired `D_t` (`{PRIMARY_UNIVERSE}` · +{HORIZON})", "",
        "**두 평균을 따로 내서 빼지 않았다.** 같은 날짜·같은 시장 상태·같은 유니버스에서"
        " 후보 조건 하나만 바뀐 비교다.", "",
        "|값|결과|", "|---|---|",
        f"|control (날짜 가중)|{_pct(core['control_mean'])}|",
        f"|FIP (날짜 가중)|{_pct(core['treatment_mean'])}|",
        f"|**`mean(D)`**|**{_pct(core['mean'])}**|",
        f"|`median(D)`|{_pct(core['median'])}|",
        f"|양수 `D` 날짜 비율|{_share(core['positive_share'])}|",
        f"|`D` 최소 / 최대|{_pct(core['min'])} / {_pct(core['max'])}|",
        f"|유효 paired 날짜|{core['dates']:,}|",
        "",
        "**유니버스 평균은 두 팔에서 같다** — FIP는 후보 조건이지 유니버스 변경이 아니다."
        " 그래서 `D_t`에서 유니버스 평균이 상쇄되고 두 바구니의 raw forward 평균 차이가 된다.",
        "",
    ]


def _binding(primary: dict) -> list[str]:
    binding = primary["binding"]
    changed = primary["changed_only"]
    lines = [
        "## 5. 필터 구속력", "",
        "**PR #17의 ABS는 3,385일 중 구성 변경이 0일이라 `NON_BINDING`으로 끝났다.**"
        " 그러면 \"개선 없음\"과 \"애초에 안 걸림\"이 구별되지 않는다. 먼저 그것부터 본다.",
        "",
        "|지표|값|", "|---|---|",
        f"|`composition_changed_dates`|**{_share(binding['composition_changed_dates'])}**"
        f" ({binding['changed_dates_n']:,}일)|",
        f"|`candidate_replacement_rate`|{_share(binding['candidate_replacement_rate'])}"
        f" ({binding['replaced_candidates']:,} / {binding['control_candidate_days']:,})|",
        f"|TOP5가 완전히 같은 날짜|{_share(binding['identical_share'])}|",
        f"|평균 overlap|{_num(binding['mean_overlap'])} / {TOP_N}|",
        f"|ID<0 통과 후보 수 (평균 / 최소 / 최대)|{_num(binding['fip_pool_mean'], 1)}"
        f" / {binding['fip_pool_min']} / {binding['fip_pool_max']}|",
        f"|통과 후보가 {TOP_N}개 미만인 날짜|{binding['short_fip_dates']:,}|",
        f"|treatment basket 크기 (평균 / 최소)|{_num(binding['basket_size_mean'], 2)}"
        f" / {binding['basket_size_min']}|",
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
    if binding["label"] == "LOW_BINDING":
        lines += ["> ⚠️ **`LOW_BINDING`에서 `median(D) >= 0`을 강한 robustness 증거로 읽지"
                  " 않는다.** 구성이 안 바뀐 날짜는 `D_t = 0`이라 0이 다수가 되어 중앙값이"
                  " 자동으로 0 이상이 된다.", ""]
    return lines


def _distribution(primary: dict) -> list[str]:
    dist = primary["distribution"]
    lines = ["## 6. ID 분포", "",
             "|집단|건수|평균|중앙|p10|p25|p75|p90|",
             "|---|---|---|---|---|---|---|---|"]
    for label, key in (("자격 유니버스 전체", "id_universe"),
                       ("control TOP5", "id_control_top")):
        row = dist[key]
        lines.append(
            f"|{label}|{row['count']:,}|{_num(row['mean'], 3)}|{_num(row['median'], 3)}"
            f"|{_num(row['p10'], 3)}|{_num(row['p25'], 3)}"
            f"|{_num(row['p75'], 3)}|{_num(row['p90'], 3)}|"
        )
    lines += [
        "",
        f"**control TOP5 중 `ID < 0`인 비율"
        f" {_share(dist['control_top_continuous_share'])}**"
        f" ({dist['control_top_continuous']:,} / {dist['control_top_names']:,}) —"
        " 이 값이 100%에 가까우면 필터가 걸릴 일이 거의 없다.",
        "",
        "### §6 진단 — ABS를 되살리지 않았다", "",
        "**FIP는 `ID < 0`만 본다.** `PRET > 0`을 함께 걸지 않았다. 그 결과 treatment TOP5에"
        " `PRET <= 0`인 이름이 남을 수 있고, **남더라도 post-hoc ABS filter를 추가하지"
        " 않는다** — limitation으로만 적는다.",
        "",
        "|값|결과|", "|---|---|",
        f"|treatment TOP5 이름 수|{dist['treatment_top_names']:,}|",
        f"|그중 `PRET <= 0`|**{dist['treatment_top_nonpositive_pret']:,}**"
        f" ({_share(dist['treatment_top_nonpositive_pret_share'])})|",
        "",
    ]
    return lines


def _phases(primary: dict) -> list[str]:
    phases = primary["phases"]
    return [
        f"## 7. +{HORIZON} 위상 안정성", "",
        f"매일 뽑으면 +{HORIZON} 수익률이 {HORIZON - 1}/{HORIZON} 겹친다."
        " **관측 수를 독립 표본 수로 읽지 않는다. p-value를 만들지 않았다.**", "",
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
    lines = ["## 8. 연도 분포", "",
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
        "## 9. paired random control (secondary diagnostic)", "",
        f"deterministic 시드 **{primary['random']['seeds']}개**(`0..19`)를 같은 random"
        " ranking으로 full pool과 ID<0 pool에 적용해 **날짜 paired**로 뺐다.", "",
        "**HARD A~E에 넣지 않았다. promotion criterion이 아니고 formal p-value도 아니다.**",
        "",
        "|값|결과|", "|---|---|",
        f"|실제 `mean(D)`|**{_pct(actual)}**|",
        f"|무작위 `mean(D)` 중앙|{_pct(statistics.median(values)) if values else '—'}|",
        f"|무작위 최소 / 최대|{_pct(min(values)) if values else '—'}"
        f" / {_pct(max(values)) if values else '—'}|",
        f"|**이김**|**{beaten}/{len(values)}**|",
        "",
        "**해석 목적은 하나다** — 개선이 **RS-specific interaction**인지 **generic"
        " continuous-pool effect**인지 가르는 것이다. 랭킹과 무관하게 `ID < 0` 풀이 원래"
        " 더 좋다면 무작위 팔에서도 같은 개선이 나온다. **어느 쪽도 자동 탈락 사유가"
        " 아니다.**",
        "",
    ]


def _ndx(ndx: dict | None) -> list[str]:
    lines = ["## 10. NDX100 robustness", "",
             "**`ALL`과 중첩되는 sub-universe다. 독립 OOS가 아니다.**", ""]
    if not ndx:
        return lines + ["*(아직 NDX100 실행이 없다)*", ""]
    core = ndx["primary"]
    return lines + [
        "|값|결과|", "|---|---|",
        f"|control (날짜 가중)|{_pct(core['control_mean'])}|",
        f"|FIP (날짜 가중)|{_pct(core['treatment_mean'])}|",
        f"|**`mean(D)`**|**{_pct(core['mean'])}**|",
        f"|`median(D)`|{_pct(core['median'])}|",
        f"|paired 날짜|{core['dates']:,}|",
        f"|binding|{ndx['binding']['label']}"
        f" ({_share(ndx['binding']['composition_changed_dates'])})|",
        "",
    ]


def _verdict(primary: dict, ndx: dict | None) -> list[str]:
    verdicts = hard_verdicts(primary, ndx)
    lines = ["## 11. 사전등록 판정 (HARD A~E)", "",
             "**PR #17 ABS signal study의 다섯 기준을 그대로 재사용했다.** 새 평가 철학을"
             " 만들지 않았다.", "",
             "|기준|조건|결과|판정|", "|---|---|---|---|"]
    for key in "ABCDE":
        row = verdicts[key]
        lines.append(
            f"|**{key}**|{row['name']}|{row['detail']}"
            f"|{'**PASS**' if row['pass'] else '**FAIL**'}|"
        )
    lines += ["", f"### Stage A 판정 — **{verdicts['verdict']}**", ""]
    if verdicts["verdict"] == PROMOTE:
        lines += ["**Stage B(portfolio translation)를 실행한다.** 규칙은 사전등록 §17~§26에"
                  " 이미 박혀 있고 Stage A 결과를 보고 바꾸지 않는다. 이 판정은 \"FIP가 신호"
                  " 층에서 살아남았다\"까지이고 **포트폴리오 economics는 아직 재지"
                  " 않았다.**", ""]
    else:
        lines += ["**Stage B를 실행하지 않는다.** portfolio core를 만들지 않고, 다른 FIP"
                  " threshold를 시험하지 않으며, TrendQuality를 부활시키지 않고, 다른"
                  " quality filter를 열지 않는다.", "",
                  "```",
                  "momentum alpha intervention 4/4 consumed",
                  "standalone momentum alpha construction terminated",
                  "```", ""]

    return lines


# §26의 최종 outcome. **결과 전에 고정했고 넷뿐이다.**
OUTCOME_SIGNAL_REJECTED = "FIP_SIGNAL_REJECTED"
OUTCOME_PORTFOLIO_REJECTED = "FIP_PORTFOLIO_REJECTED"
OUTCOME_IMPROVES_BUT_FAILS = "FIP_IMPROVES_BUT_STRATEGY_FAILS"
OUTCOME_PROMOTED = "FIP_PROMOTED_STRATEGY_QUALIFIES"
OUTCOMES = (
    OUTCOME_SIGNAL_REJECTED,
    OUTCOME_PORTFOLIO_REJECTED,
    OUTCOME_IMPROVES_BUT_FAILS,
    OUTCOME_PROMOTED,
)


def _outcome(primary: dict, ndx: dict | None) -> list[str]:
    """§8~§18의 Stage B 절과 §26의 최종 판정. **Stage A가 FAIL이면 여기서 닫는다.**"""
    verdict = hard_verdicts(primary, ndx)["verdict"]
    if verdict == PROMOTE:
        # Stage B가 돌았다면 그 러너가 이 절을 채운다. 여기서는 자리만 남긴다.
        return [
            "## 12. Stage B 실행 여부 — **실행함**", "",
            "Stage A가 `PROMOTE_FIP_TO_PORTFOLIO`이므로 사전등록 §17~§26의 규칙 그대로"
            " portfolio translation을 실행했다. 결과는 Stage B 절에 있다.", "",
        ] + _limitations()

    return [
        "## 12. Stage B 실행 여부 — **실행하지 않음**", "",
        "Stage A가 **`DO_NOT_TRANSLATE_FIP`**이므로 사전등록 §16에 따라 portfolio"
        " translation을 실행하지 않았다.", "",
        "**만들지 않은 것** — FIP portfolio core · `RS_ONLY_FIP` / `RANDOM_FIP` 진입 모드 ·"
        " Stage B 러너 · random-FIP 10시드 실행. `test_fip_signal.py`의 `StageGateTest`가"
        " **Stage A가 승격이 아닐 때 그것들이 저장소에 없다는 것**을 값으로 잠근다 —"
        " 신호가 죽은 뒤 포트폴리오를 도는 사고를 코드 수준에서 막는다.", "",
        "따라서 아래 절들(control reproduction · portfolio S/B/G · secondary economics ·"
        " FIP mechanism · random-FIP · ZERO · MARGINAL · final strategy gate)은"
        " **해당 없음**이다. 재지 않은 것을 잰 것처럼 적지 않는다.", "",
        "## 13~17. Stage B 절 — 해당 없음", "",
        "|절|상태|", "|---|---|",
        "|control reproduction|해당 없음|",
        "|portfolio `S`/`B`/`G`|해당 없음|",
        "|secondary economics|해당 없음|",
        "|FIP mechanism|해당 없음|",
        "|random-FIP distribution|해당 없음|",
        "|ZERO|해당 없음|",
        "|`MARGINAL_PASS` / `FAIL`|해당 없음|",
        "|final strategy gate|해당 없음|",
        "",
        f"## 18. 최종 outcome — **{OUTCOME_SIGNAL_REJECTED}**", "",
        "사전등록 §26의 네 결과 중 **A**다.", "",
        "- portfolio translation 없음",
        "- FIP 폐기",
        "- **alpha interventions 4/4 소진**",
        "- **standalone long-only momentum construction 종료**",
        "- **Phase 7로 가지 않음**",
        "",
        "```",
        "momentum alpha intervention 4/4 consumed",
        "standalone momentum alpha construction terminated",
        "```",
        "",
        "**다른 threshold·window·quality filter를 시험하지 않는다.** 사전등록 §5·§28의"
        " 금지 목록이고 결과가 아쉽다고 확장하지 않는다.",
        "",
    ] + _limitations()


def _limitations() -> list[str]:
    return ["## 19. Limitations · holdout statement", "",
              "- **개발 표본이다.** 이 구간은 PR #9~#19에서 반복 사용됐고 OOS 검증이 아니다",
              "- **NDX100은 독립 OOS가 아니다** — `ALL`과 중첩되는 sub-universe다",
              "- **portfolio economics를 재지 않았다** — 이 Stage는 신호 층이다",
              "- **중첩 표본이다** — 관측 수를 독립 표본 수로 읽지 않았고 p-value를"
              " 만들지 않았다",
              "- 무작위 20시드는 coarse control이고 formal test가 아니다",
              "- **`PRET <= 0`인 treatment 이름을 제거하지 않았다** — ABS 조건을 묶으면"
              " intervention이 둘이 된다(§6). 건수는 위에 값으로 남겼다",
              "- **인과를 증명하지 않는다**",
              "",
              f"**holdout** — `HOLDOUT_START = {HOLDOUT_START}` 이후를 읽지 않았다."
              " 신호일도 forward 목표일도 그 이전이고 모든 산출물이"
              " `HOLDOUT_CONSUMED = false`다. **formal OOS라고 부르지 않는다.**",
              ""]


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
