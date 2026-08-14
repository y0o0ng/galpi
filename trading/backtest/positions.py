"""설계 7.5 청산 규칙과 보유 포지션의 하루.

|규칙|내용|
|---|---|
|초기 손절|`Entry - 2.0 × ATR14`|
|추적 손절|+1 ATR 이상 수익 후 `최고 종가 - 3.0 × ATR14`|
|시간 손절|20거래일 동안 +1 ATR 미만|
|최대 보유|40거래일|
|실적|발표 전 거래일 정규장 종료까지 청산|

## 하루의 순서가 결과를 바꾼다

`run_session`이 한 세션을 처리하는 순서다. 이 순서를 흩어놓으면 룩어헤드가 숨는다.

1. 기업행동 조정 (분할이 있었으면 가격과 수량을 오늘 단위로 맞춘다)
2. 전날 종가에 예약된 청산을 **시초가**로 집행
3. **어제 종가에 정해진 손절가**로 오늘 바를 검사
4. 오늘 종가를 반영해 최고 종가·보유 세션·손절가를 갱신
5. 실적이 임박하면 오늘 **종가**로 청산
6. 시간 손절·최대 보유면 다음 시초 청산을 예약

3번이 4번보다 먼저인 것이 핵심이다. 오늘 종가로 올린 추적손절을 오늘 저가에 대고
검사하면 미래를 보고 손절하는 것이 된다.

## ATR를 진입 시점에 고정한다

7.5는 "최고 종가 - 3.0 × ATR14"의 ATR가 언제 것인지 말하지 않는다. 진입 시점 값으로
고정했다.

- 초기 손절이 진입 시점 ATR를 쓰므로 같은 기준이어야 한다.
- 매일 ATR를 다시 계산하면 변동성이 커질 때 손절가가 **내려간다**. 추적손절의 뜻과
  반대다. ATR를 고정하면 손절가가 최고 종가의 단조 증가 함수라서 내려갈 수 없다.
- 같은 입력에 같은 결과가 나와야 한다(3.1).

일반적인 Chandelier exit은 당일 ATR를 쓴다. 그 방식을 쓰려면 손절가가 내려가지 않도록
별도 래칫을 걸어야 한다.

## 진입 당일에도 손절이 살아 있다

11.2가 체결 직후 보호 주문을 설정하므로 진입 당일 바에도 손절을 검사한다. 그 저가가
우리 체결보다 앞선 시각일 수 있어 실제보다 자주 손절된다. 보수적인 방향이라 그대로 둔다.

## 바가 없는 세션 — 상태 기계

`sessions_held`는 **시장 달력 기준으로 매일 증가한다.** 바가 있는 날만 세면 거래정지된
포지션이 영영 늙지 않아 만기가 오지 않는다(2026-08-14 실측: `jt-k42`가 다섯 칸을 그렇게
물려 13.6년을 얼어 있었다).

    ACTIVE ──청산 조건 + 거래가능──────────→ 정상 청산
           ──청산 조건 + 거래불가──────────→ EXIT_PENDING_UNTRADEABLE
           ──명시적 폐지·era 종료──────────→ DELISTED_EXIT (재개를 기다리지 않는다)
    EXIT_PENDING_UNTRADEABLE
           ──같은 security 거래재개────────→ 첫 실제 가격(시초가)으로 청산
           ──명시적 폐지──────────────────→ DELISTED_EXIT
           ──런 끝까지 미해결──────────────→ UNRESOLVED_EXIT (민감도 시나리오)

**바가 없다는 것 자체는 청산 신호가 아니다.** K=21인데 8~15일째만 정지면 16일째 그냥
ACTIVE로 돌아오고 21일째 정상 청산한다. 18~25일째 정지면 21일째에 만기가 왔지만 팔 수
없으므로 `EXIT_PENDING_UNTRADEABLE`로 가고 26일째 첫 가격에 나간다.

**같은 security인지는 전략 파라미터로 판정하지 않는다.** `IDENTITY_MAX_GAP_SESSIONS`가
그 일을 하고, `max_hold`로 그것을 대신하면 K=21과 K=42가 같은 티커를 다른 회사로 읽어
보유기간 비교에 데이터 정합성 처리가 섞인다.

## FIXED_HOLD — 연구용 청산 모드

Jegadeesh–Titman(1993)식 J/K 실험을 위한 모드다. **K세션 뒤 청산 하나만 남기고** 손절·
추적손절·시간손절·실적 청산을 전부 끈다. K는 `max_hold_sessions`이고 청산 사유는 그대로
`MAX_HOLD`다 — 새 어휘를 만들지 않는다. 규칙 자체가 최대 보유이기 때문이다.

**왜 규칙을 끄는 모드가 필요한가.** 보유기간 K의 기여를 재려면 K만 달라야 한다. 손절이
살아 있으면 "K일 보유"가 아니라 "손절 아니면 K일"이라 두 규칙의 합을 재게 되고, core-1
청산과 견줄 때 무엇이 차이를 만들었는지 귀속할 수 없다.

**손절가는 없어지지 않는다.** `stop_price`는 9.2의 열린 위험 회계(현재가 − 손절가)에
계속 쓰인다. 진입 조건과 수량 계산을 세 런에서 같게 두려는 것이다. 다만 규칙이 같아도
**실현되는 진입은 갈린다** — 손절로 비었을 자리가 차 있으면 다음 후보가 못 들어온다.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, replace
from datetime import date

from .candidates import next_weekday, weekdays_between
from .costs import CostModel
from .data import CORPORATE_ACTION_REL_TOL, Bar
from .execution import Fill, execute_market_exit, try_stop_exit
from .modes import CORE_EXITS, EXIT_MODES, FIXED_HOLD_EXITS  # noqa: F401  (재수출)
from .policy import StrategyParameters
from .sizing import OpenPosition


class PositionError(Exception):
    """포지션 상태의 전제를 어긴 호출일 때 올린다."""


@dataclass(frozen=True)
class Position:
    """보유 포지션. 원장의 정본은 loop가 갖고 이 객체는 한 세션의 입력이다.

    가격은 모두 그날 실제 주문 가격(raw) 기준이다. `sessions_held`는 진입 세션을
    포함한 보유 세션 수이고, 진입 직후 0에서 시작해 세션 종가마다 하나 늘어난다.
    """

    symbol: str
    shares: int
    entry_date: str
    entry_price: float
    atr14: float
    highest_close: float
    # 진입 시점에 유효했던 정책의 지표 파라미터. 정책이 바뀌어도 이 포지션의 청산 규칙은
    # 진입 당시 승인된 규칙을 따른다(1.4).
    parameters: StrategyParameters
    sessions_held: int = 0
    pending_exit: str | None = None
    # 청산할 때가 됐는데 거래가 불가능한 상태. **가짜 체결을 만들지 않는다** — 상태만
    # 바뀌고 현금은 안 움직이며, 거래가 재개되면 그때 첫 실제 가격으로 나간다.
    untradeable_since: str | None = None

    @property
    def exit_pending_untradeable(self) -> bool:
        return self.untradeable_since is not None

    def __post_init__(self) -> None:
        if self.shares < 1:
            raise PositionError(f"보유 수량이 1주 미만입니다: {self.shares}")
        if self.atr14 <= 0:
            raise PositionError(f"ATR가 0 이하입니다: {self.atr14}")

    @classmethod
    def from_fill(
        cls, fill: Fill, atr14: float, parameters: StrategyParameters
    ) -> "Position":
        if fill.side != "BUY":
            raise PositionError(f"진입 체결이 아닙니다: {fill.side}")
        return cls(
            symbol=fill.symbol,
            shares=fill.shares,
            entry_date=fill.trade_date,
            entry_price=fill.fill_price,
            atr14=atr14,
            highest_close=fill.fill_price,
            parameters=parameters,
        )

    @property
    def initial_stop(self) -> float:
        return self.entry_price - self.parameters.stop_atr_multiple * self.atr14

    @property
    def trailing_active(self) -> bool:
        """최고 종가가 진입가 대비 +1 ATR 이상이면 추적손절로 넘어간다."""
        return (
            self.highest_close - self.entry_price
            >= self.parameters.trailing_activation_atr * self.atr14
        )

    @property
    def stop_price(self) -> float:
        """현재 손절가.

        활성화 조건이 최고 종가 >= 진입가 + 1 ATR이므로 추적손절가는 활성화 순간에
        정확히 초기 손절가와 같고 이후로만 올라간다. 손절가는 내려가지 않는다.
        """
        if not self.trailing_active:
            return self.initial_stop
        return self.highest_close - self.parameters.trailing_atr_multiple * self.atr14

    @property
    def stop_reason(self) -> str:
        return "TRAILING_STOP" if self.trailing_active else "INITIAL_STOP"

    def unrealized_r(self, price: float) -> float:
        """진입 기준 위험(2 ATR) 대비 손익 배수."""
        return (price - self.entry_price) / (
            self.parameters.stop_atr_multiple * self.atr14
        )

    def as_open_position(
        self, market_price: float, sector: str | None = None
    ) -> OpenPosition:
        """리스크 엔진이 보는 읽기 모델로 옮긴다."""
        return OpenPosition(
            symbol=self.symbol,
            shares=self.shares,
            market_price=market_price,
            entry_price=self.entry_price,
            stop_price=self.stop_price,
            sector=sector,
        )


@dataclass(frozen=True)
class SessionResult:
    symbol: str
    position: Position | None  # 청산되면 None
    fill: Fill | None
    reason: str | None  # 청산 사유 또는 이번 세션에 예약된 사유

    @property
    def closed(self) -> bool:
        return self.fill is not None


def adjust_for_corporate_action(
    position: Position, previous_bar: Bar, bar: Bar
) -> Position:
    """분할·조정이 있었으면 포지션의 가격과 수량을 오늘 단위로 옮긴다.

    조정 배율(`raw_close / adj_close`)의 비가 그대로 가격 배율이다. 2:1 분할이면 배율이
    0.5이므로 가격은 반이 되고 수량은 두 배가 된다.

    단주가 생기면 버린다. 실제로는 브로커가 현금으로 정산하지만(cash in lieu) 그 금액은
    한 주 미만이고, 수량을 올리는 쪽은 위험을 늘리므로 내리는 쪽을 택했다.

    **벤더 반올림 잡음을 기업행동으로 읽으면 안 된다.** 배율이 1.00000008로 흔들린 것만으로
    수량이 내림으로 한 주씩 깎이고 1주 포지션은 `PositionError`로 죽는다. 문턱은
    진입 취소와 같은 `CORPORATE_ACTION_REL_TOL`이다.
    """
    ratio = bar.price_scale / previous_bar.price_scale
    if math.isclose(ratio, 1.0, rel_tol=CORPORATE_ACTION_REL_TOL):
        return position
    shares = int(math.floor(position.shares / ratio + 1e-9))
    if shares < 1:
        raise PositionError(
            f"{position.symbol}의 기업행동 조정 후 수량이 1주 미만입니다 (배율 {ratio})"
        )
    return replace(
        position,
        shares=shares,
        entry_price=position.entry_price * ratio,
        atr14=position.atr14 * ratio,
        highest_close=position.highest_close * ratio,
    )


def _sessions_until(as_of: str, event_at: str) -> int:
    """오늘 종가 시점에서 실적일까지 남은 세션 수. 미래 휴장일은 평일로 센다."""
    return weekdays_between(next_weekday(as_of), date.fromisoformat(event_at[:10]))


def _due_exit(position: Position, exit_mode: str) -> str | None:
    """오늘 종가 기준으로 청산할 때가 됐는가. 사유 또는 None."""
    if position.sessions_held >= position.parameters.max_hold_sessions:
        return "MAX_HOLD"
    if (
        exit_mode != FIXED_HOLD_EXITS
        and position.sessions_held >= position.parameters.time_stop_sessions
        and not position.trailing_active
    ):
        return "TIME_STOP"
    return None


def hold_untraded(
    position: Position, trade_date: str, *, exit_mode: str = CORE_EXITS
) -> SessionResult:
    """바가 없는 세션. **나이만 먹이고 체결은 만들지 않는다.**

    바가 없다는 것 자체는 청산 신호가 아니다. 청산할 때가 됐는데 팔 수가 없을 때만
    `EXIT_PENDING_UNTRADEABLE`로 넘어간다.
    """
    if exit_mode not in EXIT_MODES:
        raise PositionError(f"모르는 청산 모드입니다: {exit_mode}")
    current = replace(position, sessions_held=position.sessions_held + 1)
    if current.exit_pending_untradeable:
        return SessionResult(current.symbol, current, None, current.pending_exit)

    reason = current.pending_exit or _due_exit(current, exit_mode)
    if reason is None:
        return SessionResult(current.symbol, current, None, None)
    # 팔 때가 됐는데 시장이 없다. 상태만 바꾸고 현금은 그대로 둔다.
    return SessionResult(
        current.symbol,
        replace(current, pending_exit=reason, untradeable_since=trade_date),
        None,
        reason,
    )


def run_session(
    position: Position,
    bar: Bar,
    previous_bar: Bar,
    *,
    costs: CostModel,
    next_earnings: str | None = None,
    exit_mode: str = CORE_EXITS,
) -> SessionResult:
    """포지션의 한 세션을 처리한다. 순서는 모듈 설명의 1~6번이다.

    `exit_mode`가 `FIXED_HOLD`면 3·5번(손절·실적)과 시간손절을 건너뛰고 최대 보유만
    남는다. 순서는 그대로다.
    """
    if exit_mode not in EXIT_MODES:
        # 오타가 조용히 CORE로 읽히면 어떤 규칙으로 낸 결과인지 알 수 없게 된다.
        raise PositionError(f"모르는 청산 모드입니다: {exit_mode}")
    if bar.trade_date <= previous_bar.trade_date:
        raise PositionError(
            f"직전 바({previous_bar.trade_date})보다 뒤인 바여야 합니다: {bar.trade_date}"
        )

    fixed_hold = exit_mode == FIXED_HOLD_EXITS
    current = adjust_for_corporate_action(position, previous_bar, bar)

    # 거래가 재개됐다. 밀려 있던 청산을 **첫 실제 거래 가능 가격**으로 내보낸다.
    # 같은 security인지는 호출자가 이미 판정했다(`delistings`).
    if current.exit_pending_untradeable:
        fill = execute_market_exit(
            current.symbol, current.shares, bar, costs=costs, price_kind="OPEN"
        )
        return SessionResult(current.symbol, None, fill, current.pending_exit)

    # 2. 전날 종가에 정해진 청산은 오늘 시초가로 나간다.
    if current.pending_exit is not None:
        fill = execute_market_exit(
            current.symbol, current.shares, bar, costs=costs, price_kind="OPEN"
        )
        return SessionResult(current.symbol, None, fill, current.pending_exit)

    # 3. 어제 종가에 정해진 손절가로 오늘 바를 본다. 오늘 종가를 반영하기 전이다.
    if not fixed_hold:
        stop_fill = try_stop_exit(
            current.symbol, current.shares, current.stop_price, bar, costs=costs
        )
        if stop_fill is not None:
            return SessionResult(current.symbol, None, stop_fill, current.stop_reason)

    # 4. 오늘 종가 반영. 최고 종가가 오르면 추적손절가도 함께 오른다.
    current = replace(
        current,
        highest_close=max(current.highest_close, bar.raw_close),
        sessions_held=current.sessions_held + 1,
    )

    # 발표일이 이미 지났는데 아직 들고 있으면 늦었다. 실적 일정이 진입 뒤에 잡혔거나
    # 진입 때 일정을 몰랐던 경우다. 이 경로가 도는 것 자체가 신호이므로 사유를 구분한다.
    # 종가로 나가는 것은 오늘 종가가 "늦은 것을 알아챈 뒤 처음 오는 행동 지점"이기
    # 때문이다. 어제 종가에 알았다면 아래 5번이 먼저 걸렸을 것이다.
    if (
        not fixed_hold
        and next_earnings is not None
        and next_earnings[:10] <= bar.trade_date
    ):
        fill = execute_market_exit(
            current.symbol, current.shares, bar, costs=costs, price_kind="CLOSE"
        )
        return SessionResult(current.symbol, None, fill, "EARNINGS_OVERDUE")

    # 5. 실적 전 청산은 그날 종가에 맞춘다(7.5).
    if (
        not fixed_hold
        and next_earnings is not None
        and _sessions_until(bar.trade_date, next_earnings)
        <= current.parameters.earnings_exit_sessions
    ):
        fill = execute_market_exit(
            current.symbol, current.shares, bar, costs=costs, price_kind="CLOSE"
        )
        return SessionResult(current.symbol, None, fill, "EARNINGS")

    # 6. 시간 손절과 최대 보유는 다음 시초 청산으로 예약한다.
    reason = _due_exit(current, exit_mode)
    if reason is not None:
        return SessionResult(
            current.symbol, replace(current, pending_exit=reason), None, reason
        )

    return SessionResult(current.symbol, current, None, None)
