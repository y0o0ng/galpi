"""이벤트 기반 백테스트 loop. 설계 18장 `nightly_run`과 11.1·11.2의 하루다.

## 한 세션의 순서

1. **보유 포지션의 하루** — `positions.run_session` (예약 청산 → 손절 → 종가 갱신 → 실적·시간 청산)
2. **어제 만든 intent 집행** — `execution.execute_entry`. 체결되면 그 자리에서 진입 당일
   세션까지 돌린다
3. **종가 후 결정** — 계좌 상태 → 레짐 → 후보 랭킹 → 계좌 게이트 → 수량 → 내일 intent

**청산이 진입보다 먼저인 것은 실제 순서다.** 보호 주문은 시초에 대기하고 있고 10.1의
진입은 개장 15~60분 후다. 현금도 그 순서로 움직인다.

**같은 날 두 번째 intent는 첫 번째를 반영한다.** 후보 둘을 같은 계좌 상태로 평가하면
각자는 한도 안이어도 합치면 익스포저·현금 한도를 넘길 수 있다. intent를 만들 때마다
가상 포지션으로 예약해 다음 후보의 계좌 상태에 반영한다.

## 이 loop가 하지 않는 것

- 성과 지표(14.7)는 여기서 계산하지 않는다. 자산 곡선과 거래 목록만 만든다.
- 미체결 intent는 하루만 산다. 10.1의 20분 재산정을 일봉으로 흉내낼 수 없으므로
  다음 세션으로 넘기지 않고 `NO_FILL`로 세어 남긴다.
- 하루 진입 상한은 **intent 개수**로 센다. 체결 수로 세려면 미리 알 수 없는 체결을
  전제해야 하므로, 상한만큼 만들고 그중 몇 개가 체결되는지는 결과로 둔다.
- 보유 종목의 오늘 바가 없으면(거래정지·상장폐지) 그 세션은 그대로 들고 간다.
  `POSITION_STALE`로 세고, 상장폐지 데이터는 아직 없다는 사실을 여기서도 확인한다.
"""

from __future__ import annotations

import json
import sqlite3
from dataclasses import asdict, dataclass, field, replace
from datetime import date

from .candidates import MIN_SCORE_POPULATION, Ranking, rank_candidates
from .costs import CostModel
from .data import Bar, BarCache, PointInTimeSnapshot
from .execution import Fill, execute_entry
from .features import FeatureUnavailable
from .policy import DEFAULT_PAPER_POLICY, PolicyVersion
from .positions import Position, run_session
from .regime import Regime, classify_regime
from .risk import account_gate, evaluate_candidate
from .sizing import ATR_STOP_MULTIPLE, AccountState, OpenPosition, SizedIntent


@dataclass(frozen=True)
class BacktestConfig:
    source_version: str
    start: str
    end: str
    initial_capital: float = 100_000.0
    policy: PolicyVersion = DEFAULT_PAPER_POLICY
    costs: CostModel = field(default_factory=CostModel)
    index_names: tuple[str, ...] | None = None
    require_earnings_calendar: bool = True
    require_sector: bool = True
    min_population: int = MIN_SCORE_POPULATION
    gate_factor: float = 1.0  # Core-only은 1.0. LLM Gate는 아직 없다


@dataclass(frozen=True)
class Trade:
    """17장 `trade_outcomes`. R은 진입 시점 위험(수량 × 2 ATR) 기준이다.

    `pnl`은 두 체결의 현금 변화 합이라 분할이 껴도 맞다. 반면 `entry_price`·`exit_price`는
    각자 체결된 그날의 가격이라 분할 구간에서는 단위가 다르다. 손익 판정은 `pnl`과
    `return_r`로 하고 두 가격은 감사용 기록으로 본다.
    """

    symbol: str
    entry_date: str
    exit_date: str
    shares: int
    entry_price: float
    exit_price: float
    entry_reason: str
    exit_reason: str
    exit_fill_reason: str
    fees: float
    pnl: float
    return_r: float
    mfe_r: float
    mae_r: float
    sessions_held: int
    min_qty_exception: bool


@dataclass(frozen=True)
class EquityPoint:
    trade_date: str
    equity: float
    cash: float
    exposure: float
    drawdown: float
    regime: str
    open_positions: int


@dataclass(frozen=True)
class BacktestResult:
    config: BacktestConfig
    trades: tuple[Trade, ...]
    equity_curve: tuple[EquityPoint, ...]
    open_positions: tuple[Position, ...]
    # 모든 체결. 현금 항등식(초기 자본 + 모든 cash_delta = 마지막 현금)을 확인할 수 있어야
    # 성과 지표를 신뢰할 수 있다. 19.3의 주문 재생 기록도 이 목록이다.
    fills: tuple[Fill, ...]
    skip_counts: dict[str, int]
    fill_counts: dict[str, int]
    exit_counts: dict[str, int]

    @property
    def final_equity(self) -> float:
        return self.equity_curve[-1].equity if self.equity_curve else self.config.initial_capital


@dataclass
class _OpenTrade:
    """loop 내부 상태. 청산 규칙이 쓰지 않는 보고용 값을 여기에 둔다."""

    position: Position
    entry_fill: Fill
    sector: str | None
    risk_dollars: float
    min_qty_exception: bool
    mfe_r: float = 0.0
    mae_r: float = 0.0


def _count(counter: dict[str, int], key: str) -> None:
    counter[key] = counter.get(key, 0) + 1


def _sessions_in_range(
    connection: sqlite3.Connection, config: BacktestConfig
) -> list[str]:
    """기준 심볼의 세션 중 구간 안의 날짜. 거래일 달력의 정본이다."""
    rows = connection.execute(
        "SELECT trade_date FROM bars_daily"
        " WHERE symbol = ? AND source_version = ? AND trade_date >= ? AND trade_date <= ?"
        " ORDER BY trade_date",
        ("SPY", config.source_version, config.start, config.end),
    ).fetchall()
    return [row["trade_date"] for row in rows]


def _bars_for(snapshot: PointInTimeSnapshot, symbol: str) -> tuple[Bar, Bar] | None:
    """오늘 바와 직전 바. 오늘 바가 없으면 None이다."""
    tail = snapshot.bars(symbol, 2)
    if len(tail) < 2 or tail[-1].trade_date != snapshot.as_of:
        return None
    return tail[0], tail[1]


def _close_trade(
    open_trade: _OpenTrade, fill: Fill, exit_reason: str, sessions_held: int
) -> Trade:
    pnl = open_trade.entry_fill.cash_delta + fill.cash_delta
    return Trade(
        symbol=open_trade.position.symbol,
        entry_date=open_trade.entry_fill.trade_date,
        exit_date=fill.trade_date,
        shares=fill.shares,
        entry_price=open_trade.entry_fill.fill_price,
        exit_price=fill.fill_price,
        entry_reason=open_trade.entry_fill.reason,
        exit_reason=exit_reason,
        exit_fill_reason=fill.reason,
        fees=open_trade.entry_fill.fees + fill.fees,
        pnl=pnl,
        return_r=pnl / open_trade.risk_dollars,
        mfe_r=open_trade.mfe_r,
        mae_r=open_trade.mae_r,
        sessions_held=sessions_held,
        min_qty_exception=open_trade.min_qty_exception,
    )


def _track_excursion(open_trade: _OpenTrade, bar: Bar) -> None:
    """MFE·MAE를 R 단위로 갱신한다.

    R 단위로 세면 분할이 껴도 값이 이어진다. 가격과 ATR가 같은 배율로 조정되기 때문이다.
    손절이 장중 저가로 판정되므로 MAE도 장중 저가로 잰다.
    """
    position = open_trade.position
    risk_per_share = ATR_STOP_MULTIPLE * position.atr14
    high_r = (bar.raw_high - position.entry_price) / risk_per_share
    low_r = (bar.raw_low - position.entry_price) / risk_per_share
    open_trade.mfe_r = max(open_trade.mfe_r, high_r)
    open_trade.mae_r = min(open_trade.mae_r, low_r)


def run_backtest(
    connection: sqlite3.Connection, config: BacktestConfig
) -> BacktestResult:
    """구간을 하루씩 굴린다. 같은 입력에 같은 결과가 나와야 한다(3.1)."""
    sessions = _sessions_in_range(connection, config)
    # 세션마다 같은 252바를 다시 읽으면 실행이 수십 배 느려진다. 캐시가 as_of를 자르는
    # 책임을 지므로 캐시 경로와 직접 조회 경로가 같은지는 데이터 계약 테스트가 지킨다.
    cache = BarCache(connection, config.source_version)
    cash = config.initial_capital
    peak_equity = config.initial_capital
    previous_equity = config.initial_capital
    week_start_equity = config.initial_capital
    current_week: tuple[int, int] | None = None
    prior_week_pnl = 0.0

    open_trades: dict[str, _OpenTrade] = {}
    pending: list[tuple[SizedIntent, Bar]] = []
    trades: list[Trade] = []
    fills: list[Fill] = []
    curve: list[EquityPoint] = []
    skip_counts: dict[str, int] = {}
    fill_counts: dict[str, int] = {}
    exit_counts: dict[str, int] = {}

    for trade_date in sessions:
        snapshot = PointInTimeSnapshot(
            connection, trade_date, config.source_version, cache=cache
        )
        earnings_cache: dict[str, str | None] = {}

        def next_earnings(symbol: str) -> str | None:
            if symbol not in earnings_cache:
                earnings_cache[symbol] = snapshot.next_earnings(symbol)
            return earnings_cache[symbol]

        # 1. 보유 포지션의 하루.
        for symbol in sorted(open_trades):
            open_trade = open_trades[symbol]
            pair = _bars_for(snapshot, symbol)
            if pair is None:
                _count(skip_counts, "POSITION_STALE")
                continue
            previous_bar, bar = pair
            result = run_session(
                open_trade.position,
                bar,
                previous_bar,
                costs=config.costs,
                next_earnings=next_earnings(symbol),
            )
            if result.closed:
                _track_excursion(open_trade, bar)
                cash += result.fill.cash_delta
                fills.append(result.fill)
                trades.append(
                    _close_trade(
                        open_trade,
                        result.fill,
                        result.reason,
                        open_trade.position.sessions_held,
                    )
                )
                _count(exit_counts, result.reason)
                _count(fill_counts, result.fill.reason)
                del open_trades[symbol]
            else:
                open_trade.position = result.position
                _track_excursion(open_trade, bar)

        # 2. 어제 만든 intent를 오늘 집행한다. 미체결은 하루만 살고 사라진다.
        for intent, signal_bar in pending:
            pair = _bars_for(snapshot, intent.symbol)
            if pair is None:
                _count(skip_counts, "NO_EXECUTION_BAR")
                continue
            _, bar = pair
            outcome = execute_entry(intent, signal_bar, bar, costs=config.costs)
            if not outcome:
                _count(skip_counts, outcome.cancellation.reason)
                continue
            fill = outcome.fill
            if cash + fill.cash_delta < 0:
                _count(skip_counts, "INSUFFICIENT_CASH")
                continue
            cash += fill.cash_delta
            fills.append(fill)
            _count(fill_counts, fill.reason)
            open_trade = _OpenTrade(
                position=Position.from_fill(fill, intent.atr14),
                entry_fill=fill,
                sector=snapshot.sector(intent.symbol),
                risk_dollars=fill.shares * ATR_STOP_MULTIPLE * intent.atr14,
                min_qty_exception=intent.min_qty_exception,
            )
            # 진입 당일에도 보호 주문이 살아 있다(11.2). 그 세션까지 바로 돌린다.
            result = run_session(
                open_trade.position,
                bar,
                signal_bar,
                costs=config.costs,
                next_earnings=next_earnings(intent.symbol),
            )
            _track_excursion(open_trade, bar)
            if result.closed:
                cash += result.fill.cash_delta
                fills.append(result.fill)
                trades.append(_close_trade(open_trade, result.fill, result.reason, 1))
                _count(exit_counts, result.reason)
                _count(fill_counts, result.fill.reason)
            else:
                open_trade.position = result.position
                open_trades[intent.symbol] = open_trade
        pending = []

        # 3. 종가 후 결정.
        marks: dict[str, float] = {}
        for symbol, open_trade in open_trades.items():
            bars = snapshot.bars(symbol, 1)
            marks[symbol] = (
                bars[-1].raw_close if bars else open_trade.position.entry_price
            )
        exposure = sum(
            open_trade.position.shares * marks[symbol]
            for symbol, open_trade in open_trades.items()
        )
        equity = cash + exposure
        peak_equity = max(peak_equity, equity)
        drawdown = 0.0 if peak_equity <= 0 else max(0.0, 1 - equity / peak_equity)

        iso = date.fromisoformat(trade_date).isocalendar()[:2]
        if current_week is None:
            current_week = iso
        elif iso != current_week:
            prior_week_pnl = (
                0.0
                if week_start_equity <= 0
                else (previous_equity - week_start_equity) / week_start_equity
            )
            week_start_equity = previous_equity
            current_week = iso
        daily_pnl = (
            0.0 if previous_equity <= 0 else (equity - previous_equity) / previous_equity
        )

        positions_view = tuple(
            open_trade.position.as_open_position(marks[symbol], open_trade.sector)
            for symbol, open_trade in sorted(open_trades.items())
        )
        account = AccountState(
            equity=equity,
            cash=cash,
            positions=positions_view,
            drawdown=drawdown,
            daily_pnl_fraction=daily_pnl,
            prior_week_pnl_fraction=prior_week_pnl,
        )

        try:
            regime = classify_regime(snapshot, drawdown=drawdown)
        except FeatureUnavailable as error:
            _count(skip_counts, error.reason)
            curve.append(
                EquityPoint(
                    trade_date, equity, cash, exposure, drawdown, "UNKNOWN", len(open_trades)
                )
            )
            previous_equity = equity
            continue

        curve.append(
            EquityPoint(
                trade_date, equity, cash, exposure, drawdown, regime.state, len(open_trades)
            )
        )
        previous_equity = equity

        ranking = _rank(snapshot, regime, config)
        for reason, count in ranking.skip_counts().items():
            skip_counts[reason] = skip_counts.get(reason, 0) + count
        if ranking.halt_reason is not None:
            _count(skip_counts, ranking.halt_reason)
            continue

        gate = account_gate(account, config.policy)
        reserved = list(positions_view)
        reserved_cash = cash
        for candidate in ranking.candidates:
            if len(pending) >= ranking.max_new_entries:
                _count(skip_counts, "DAILY_ENTRY_CAP")
                break
            working = replace(
                account, cash=reserved_cash, positions=tuple(reserved)
            )
            outcome = evaluate_candidate(
                candidate,
                working,
                regime,
                snapshot,
                policy=config.policy,
                gate=gate,
                gate_factor=config.gate_factor,
                require_sector=config.require_sector,
            )
            if not outcome:
                _count(skip_counts, outcome.rejection.reason)
                continue
            intent = outcome.intent
            signal_bars = snapshot.bars(candidate.symbol, 1)
            pending.append((intent, signal_bars[-1]))
            # 같은 날 다음 후보는 이 예약을 반영한 계좌를 본다.
            reserved.append(
                OpenPosition(
                    symbol=intent.symbol,
                    shares=intent.shares,
                    market_price=intent.planned_entry,
                    entry_price=intent.planned_entry,
                    stop_price=intent.initial_stop,
                    sector=snapshot.sector(intent.symbol),
                )
            )
            reserved_cash -= intent.shares * intent.planned_entry

    return BacktestResult(
        config=config,
        trades=tuple(trades),
        equity_curve=tuple(curve),
        open_positions=tuple(
            open_trades[symbol].position for symbol in sorted(open_trades)
        ),
        fills=tuple(fills),
        skip_counts=skip_counts,
        fill_counts=fill_counts,
        exit_counts=exit_counts,
    )


def _rank(
    snapshot: PointInTimeSnapshot, regime: Regime, config: BacktestConfig
) -> Ranking:
    kwargs = {
        "min_population": config.min_population,
        "require_earnings_calendar": config.require_earnings_calendar,
    }
    if config.index_names is not None:
        kwargs["index_names"] = config.index_names
    return rank_candidates(snapshot, regime, **kwargs)


def save_run(
    connection: sqlite3.Connection,
    result: BacktestResult,
    run_id: str,
    *,
    survivorship_biased: bool,
) -> None:
    """실행 결과를 남긴다. 어떤 조건으로 낸 숫자인지 함께 남기는 것이 요점이다."""
    config = result.config
    with connection:
        connection.execute(
            "INSERT OR REPLACE INTO backtest_runs"
            " (run_id, source_version, strategy_version, policy_id, policy_signature,"
            "  start_date, end_date, initial_capital, final_equity, trade_count,"
            "  survivorship_biased, require_earnings_calendar, require_sector,"
            "  cost_stress, gate_factor, skip_counts, fill_counts, exit_counts)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                run_id,
                config.source_version,
                config.policy.strategy_version,
                config.policy.policy_id,
                config.policy.signature,
                config.start,
                config.end,
                config.initial_capital,
                result.final_equity,
                len(result.trades),
                int(survivorship_biased),
                int(config.require_earnings_calendar),
                int(config.require_sector),
                json.dumps(asdict(config.costs.stress), sort_keys=True),
                config.gate_factor,
                json.dumps(result.skip_counts, sort_keys=True),
                json.dumps(result.fill_counts, sort_keys=True),
                json.dumps(result.exit_counts, sort_keys=True),
            ),
        )
        connection.executemany(
            "INSERT OR REPLACE INTO backtest_trades"
            " (run_id, symbol, entry_date, exit_date, shares, entry_price, exit_price,"
            "  entry_reason, exit_reason, exit_fill_reason, fees, pnl, return_r,"
            "  mfe_r, mae_r, sessions_held, min_qty_exception)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [
                (
                    run_id,
                    trade.symbol,
                    trade.entry_date,
                    trade.exit_date,
                    trade.shares,
                    trade.entry_price,
                    trade.exit_price,
                    trade.entry_reason,
                    trade.exit_reason,
                    trade.exit_fill_reason,
                    trade.fees,
                    trade.pnl,
                    trade.return_r,
                    trade.mfe_r,
                    trade.mae_r,
                    trade.sessions_held,
                    int(trade.min_qty_exception),
                )
                for trade in result.trades
            ],
        )
        connection.executemany(
            "INSERT OR REPLACE INTO backtest_equity"
            " (run_id, trade_date, equity, cash, exposure, drawdown, regime, open_positions)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            [
                (
                    run_id,
                    point.trade_date,
                    point.equity,
                    point.cash,
                    point.exposure,
                    point.drawdown,
                    point.regime,
                    point.open_positions,
                )
                for point in result.equity_curve
            ],
        )
