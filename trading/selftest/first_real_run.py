"""무료 실데이터 1년으로 loop를 처음 끝까지 돌린다.

지금까지 백테스터는 손으로 답을 낼 수 있는 합성 픽스처로만 돌았다. 합성 픽스처는 규칙이
의도대로 계산되는지는 보여주지만 **실데이터가 만드는 모양은 보여주지 못한다.** 여기서
보려는 것은 성과가 아니라 배선이다.

- 세션 loop가 실제 바에서 끝까지 도는가
- `NO_FILL`·`EARNINGS_UNKNOWN`·`SHORT_HISTORY` 같은 카운터의 비율이 말이 되는가
- `초기 자본 + 모든 체결 cash_delta = 마지막 현금` 항등식이 실데이터에서도 맞는가

**이 실행은 처음부터 판정용이 아니다.** 세 가지가 동시에 막는다. 무료 티어가 데이터를
최근 1년으로 자르고, 유니버스가 20종목짜리 스모크 목록이라 당시 구성원이 아니며,
150세션으로는 fold·홀드아웃이 최대 보유기간(40세션)의 두 배를 못 넘어 워크포워드를
돌릴 수 없다. 그래서 `evaluate_gate`는 `SURVIVORSHIP_BIASED`·`NO_WALK_FORWARD`를
blocker로 달고 `UNDETERMINED`를 준다. 그것이 맞는 결과다.

## 무료 티어의 호출 예산이 단계를 가른다

하루 20회다. 심볼당 1회라 유니버스 20종목과 기준 심볼을 같은 날 받을 수 없다. 그래서
단계를 나눠 SPY를 먼저 받고 유니버스는 다음 날 받는다. 날짜 창이 하루 어긋나지만
앞 103세션이 워밍업이라 흡수된다.

## 축소 파라미터

251바로는 `min_history_sessions=252`를 채울 수 없다. `sma_slow`와 `min_history_sessions`를
100으로 낮춘다. `StrategyParameters.__post_init__`의 `needed`가 100(=sma_slow)이라 그
아래로는 더 못 낮춘다. 이관해둔 `StrategyParameters` 덕분에 상수를 고치지 않고 정책만
바꿔서 돌릴 수 있다.

## 실행 순서

    python3 selftest/first_real_run.py spy        # EODHD 1회
    python3 selftest/first_real_run.py edgar      # SEC EDGAR, 호출 제한 무관
    python3 selftest/first_real_run.py universe   # 호출 없음
    python3 selftest/first_real_run.py bars       # EODHD 20회
    python3 selftest/first_real_run.py run        # 호출 없음
"""

from __future__ import annotations

import argparse
import sys
from dataclasses import asdict, replace
from pathlib import Path

TRADING_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TRADING_ROOT))

from backtest import store  # noqa: E402
from backtest.edgar import collect  # noqa: E402
from backtest.eodhd import load_prices, missing_universe_symbols  # noqa: E402
from backtest.loop import BacktestConfig, run_backtest, save_run  # noqa: E402
from backtest.membership import load_universe, reconstruct  # noqa: E402
from backtest.metrics import compute_metrics  # noqa: E402
from backtest.policy import DEFAULT_PAPER_POLICY  # noqa: E402
from backtest.validation import evaluate_gate  # noqa: E402

# 이 적재분의 이름. 같은 이름으로 다시 넣을 수 없다(적재는 불변이다).
SOURCE_VERSION = "smoke-free-1y-2026-08"
# 지수 이름을 SP500·NDX100으로 쓰지 않는다. 20종목짜리 목록에 지수 이름을 붙이면
# 나중에 진짜 구성원 데이터와 구별되지 않는다.
INDEX_NAME = "SMOKE20"
AS_OF = "2026-08-06"
# 무료 티어가 주는 창의 시작. SPY를 하루 먼저 받으므로 유니버스 쪽 시작일에 맞춘다.
WINDOW_START = "2025-08-07"
REFERENCE_SYMBOL = "SPY"

# 20종목. 섹터가 실제로 갈리도록 골랐다. SIC 2자리 대분류라 반도체(36)와 소프트웨어(73)가
# 나뉘므로 기술주만 넣으면 9.2의 섹터 25% 한도가 한 번도 구속하지 않는다.
UNIVERSE = (
    "AAPL", "MSFT", "NVDA", "AVGO", "GOOGL", "META", "AMZN", "TSLA",
    "JPM", "BAC", "XOM", "CVX", "JNJ", "LLY", "UNH", "PG", "KO",
    "WMT", "HD", "CAT",
)

# 축소 파라미터. 실데이터 창이 1년뿐이라 창 길이만 줄인다.
#
# `min_history_sessions`는 `sma_slow`가 아니라 `sma_slow + below_sma_red_streak - 1`
# 이상이어야 한다. 100으로 두고 돌렸다가 시장 상태 판정이 전 세션 `SHORT_HISTORY`로
# 떨어져 한 건도 거래하지 않는 것을 실측으로 봤다. 지금은
# `StrategyParameters.__post_init__`이 그 정책을 아예 거부한다.
REDUCED_PARAMETERS = {"sma_slow": 100, "min_history_sessions": 102}
# 정책의 `min_score_population`은 30이다. 20종목 스모크 유니버스로는 채울 수 없으므로
# 이 실행에서만 낮춘다. 실데이터 판정에서는 절대 낮추지 않는다.
SMOKE_MIN_POPULATION = 10
# 첫 세션부터 시장 상태를 판정할 수 있도록 SPY 바를 미리 쌓아둔다.
# `classify_regime`이 sma_slow + below_sma_red_streak - 1 = 102개를 요구한다.
WARMUP_SESSIONS = 105


def smoke_policy():
    """축소 파라미터를 단 정책. 정책 id에 무엇을 낮췄는지 남긴다."""
    parameters = replace(DEFAULT_PAPER_POLICY.parameters, **REDUCED_PARAMETERS)
    suffix = ",".join(f"{key}={value}" for key, value in sorted(REDUCED_PARAMETERS.items()))
    return replace(
        DEFAULT_PAPER_POLICY,
        parameters=parameters,
        policy_id=f"{DEFAULT_PAPER_POLICY.policy_id}[{suffix}]",
        note="무료 1년 데이터 스모크 실행. 창 길이만 줄였고 한도는 그대로다",
    )


def sessions(connection) -> list[str]:
    rows = connection.execute(
        "SELECT trade_date FROM bars_daily"
        " WHERE symbol = ? AND source_version = ? ORDER BY trade_date",
        (REFERENCE_SYMBOL, SOURCE_VERSION),
    ).fetchall()
    return [row["trade_date"] for row in rows]


def stage_spy(connection) -> int:
    """기준 심볼만 먼저 받는다. EODHD 1회."""
    summary = load_prices(
        connection, [REFERENCE_SYMBOL], SOURCE_VERSION, start=WINDOW_START
    )
    _print_price_summary(summary)
    return 0


def stage_bars(connection) -> int:
    """유니버스 20종목. EODHD 20회로 무료 티어 하루 한도를 다 쓴다."""
    summary = load_prices(connection, list(UNIVERSE), SOURCE_VERSION, start=WINDOW_START)
    _print_price_summary(summary)
    missing = missing_universe_symbols(
        connection, SOURCE_VERSION, start=WINDOW_START, end=AS_OF
    )
    print(f"바가 없는 구성원: {missing or '없음'}")
    return 0


def _print_price_summary(summary: dict) -> None:
    print(
        f"{summary['loaded']}/{summary['symbols']}종목 {summary['rows']}행 적재,"
        f" 버린 행 {summary['dropped']}, 호출 {summary['calls']}회"
    )
    for item in summary["coverage"]:
        print(f"  {item.symbol:<6} {item.rows:>4}행 {item.first} ~ {item.last}")
    if summary["empty"]:
        print(f"빈 응답: {summary['empty']}")
    if summary["gaps"]:
        print(f"구간 미달(gaps): {summary['gaps']}")
    for symbol, warning in summary["warnings"].items():
        print(f"경고 {symbol}: {warning}")


def stage_edgar(connection) -> int:
    """실적일과 섹터. 공공 자료라 호출 한도·삭제 의무와 무관하다."""
    summary = collect(
        connection, list(UNIVERSE), SOURCE_VERSION, window_start=WINDOW_START
    )
    print(
        f"실적 {summary['earnings_rows']}행, 섹터 {summary['sectors']}종목,"
        f" 호출 {summary['calls']}회"
    )
    for item in summary["coverage"]:
        pin = " (CIK 고정)" if item.pinned else ""
        print(f"  {item.symbol:<6} {item.count:>4}건 {item.first} ~ {item.last}{pin}")
    if summary["missing"]:
        print(f"CIK를 못 찾은 종목: {summary['missing']}")
    if summary["gaps"]:
        print(f"구간 미달(gaps): {[item.symbol for item in summary['gaps']]}")
    return 1 if summary["missing"] or summary["gaps"] else 0


def stage_universe(connection) -> int:
    """스모크 구성원 구간. 변경 이력이 없으므로 전 구간 고정 목록이다.

    `count_violations`가 `SMOKE20`의 기대 구성원 수를 모른다고 위반을 올린다. 그것이
    맞다 — 이 목록은 지수가 아니다. 사유를 적어 넘기면 `survivorship_biased`가 참으로
    남아 14.7 판정에서 자동으로 막힌다.
    """
    reconstruction = reconstruct(
        INDEX_NAME,
        frozenset(UNIVERSE),
        [],
        floor_date=WINDOW_START,
        as_of=AS_OF,
    )
    summary = load_universe(
        connection,
        [reconstruction],
        "smoke-list",
        SOURCE_VERSION,
        check_dates=[WINDOW_START, AS_OF],
        note=f"{len(UNIVERSE)}종목 고정 스모크 목록. 지수 구성원이 아니다",
        accept_violations_because=(
            "지수가 아니라 배선 확인용 고정 목록이라 구성원 수 불변식을 적용할 수 없다."
            " 이 적재분으로 낸 결과는 전략 판정에 쓰지 않는다"
        ),
    )
    print(f"구간 {summary['intervals']}개, 위반 {len(summary['violations'])}건 수용")
    for violation in summary["violations"]:
        print(f"  {violation}")
    return 0


def stage_run(connection) -> int:
    """loop를 돌리고 지표·게이트까지 낸다."""
    all_sessions = sessions(connection)
    if len(all_sessions) <= WARMUP_SESSIONS:
        print(
            f"{REFERENCE_SYMBOL} 바가 {len(all_sessions)}개뿐입니다."
            f" 워밍업 {WARMUP_SESSIONS}세션 뒤에 남는 구간이 없습니다."
        )
        return 1

    config = BacktestConfig(
        source_version=SOURCE_VERSION,
        start=all_sessions[WARMUP_SESSIONS],
        end=all_sessions[-1],
        policy=smoke_policy(),
        index_names=(INDEX_NAME,),
        min_population=SMOKE_MIN_POPULATION,
        require_earnings_calendar=True,
        require_sector=True,
    )
    print(f"구간 {config.start} ~ {config.end}, {len(all_sessions) - WARMUP_SESSIONS}세션")
    print(f"정책 {config.policy.policy_id}")

    result = run_backtest(connection, config)
    save_run(connection, result, f"smoke-{config.start}", survivorship_biased=True)

    print(f"\n거래 {len(result.trades)}건, 체결 {len(result.fills)}건")
    _print_counter("건너뛴 이유", result.skip_counts)
    _print_counter("체결 방식", result.fill_counts)
    _print_counter("청산 사유", result.exit_counts)

    # 현금 항등식. 이것이 어긋나면 나머지 숫자는 전부 못 믿는다.
    expected_cash = config.initial_capital + sum(fill.cash_delta for fill in result.fills)
    actual_cash = result.equity_curve[-1].cash if result.equity_curve else config.initial_capital
    print(
        f"\n현금 항등식: 기대 {expected_cash:,.2f} / 실제 {actual_cash:,.2f}"
        f" — {'일치' if abs(expected_cash - actual_cash) < 1e-6 else '불일치'}"
    )
    print(f"마지막 자산 {result.final_equity:,.2f}")

    metrics = compute_metrics(result)
    print("\n지표")
    for key, value in asdict(metrics).items():
        print(f"  {key}: {value}")

    report = evaluate_gate(result, metrics, survivorship_biased=True)
    print(f"\n14.7 판정: {report.verdict}")
    print(f"blocker: {', '.join(report.blockers) or '없음'}")
    for row in report.rows:
        print(f"  {row.name:<24} {row.value} → {row.verdict}")
    return 0


def _print_counter(title: str, counter: dict[str, int]) -> None:
    if not counter:
        print(f"{title}: 없음")
        return
    print(f"{title}:")
    for key, count in sorted(counter.items(), key=lambda item: -item[1]):
        print(f"  {key:<28} {count}")


def stage_status(connection) -> int:
    for table in (
        "data_sources",
        "bars_daily",
        "universe_membership",
        "earnings_calendar",
        "securities",
    ):
        count = connection.execute(
            f"SELECT COUNT(*) AS n FROM {table} WHERE source_version = ?",
            (SOURCE_VERSION,),
        ).fetchone()["n"]
        print(f"{table:<22} {count}")
    rows = connection.execute(
        "SELECT source, kind, survivorship_biased, note FROM data_sources"
        " WHERE source_version = ? ORDER BY kind",
        (SOURCE_VERSION,),
    ).fetchall()
    for row in rows:
        bias = "편향 있음" if row["survivorship_biased"] else "편향 없음"
        print(f"  {row['kind']:<10} {row['source']:<12} {bias}  {row['note']}")
    return 0


STAGES = {
    "spy": stage_spy,
    "bars": stage_bars,
    "edgar": stage_edgar,
    "universe": stage_universe,
    "run": stage_run,
    "status": stage_status,
}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("stage", choices=sorted(STAGES))
    arguments = parser.parse_args()
    connection = store.connect()
    try:
        return STAGES[arguments.stage](connection)
    finally:
        connection.close()


if __name__ == "__main__":
    sys.exit(main())
