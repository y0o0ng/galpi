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
"""

from __future__ import annotations

import math
from dataclasses import dataclass, replace
from datetime import date

from .candidates import next_weekday, weekdays_between
from .costs import CostModel
from .data import Bar
from .execution import Fill, execute_market_exit, try_stop_exit
from .sizing import ATR_STOP_MULTIPLE, OpenPosition

TRAILING_STOP_ATR = 3.0  # 7.5 추적손절: 최고 종가 - 3.0 × ATR14
TRAILING_ACTIVATION_ATR = 1.0  # 7.5: +1 ATR 이상 수익 후
TIME_STOP_SESSIONS = 20  # 7.5: 20거래일 동안 +1 ATR 미만
MAX_HOLD_SESSIONS = 40  # 7.5: 최대 보유기간

# 실적 발표 전 몇 세션 남았을 때 청산할지. 0이면 7.5의 문자 그대로 "발표 전 거래일"이다.
# 미래 휴장일을 모르는 동안은 1로 둔다. 휴장일이 끼면 "발표 전 거래일"이라고 계산한 날이
# 실제로는 발표 당일이 되어 실적을 그대로 맞는다. 7.5는 "종료까지 청산"이므로 한 세션
# 일찍 나오는 것은 규칙 위반이 아니고, 실적 갭을 먹는 쪽이 훨씬 나쁘다.
# 거래소 휴장일 표가 들어오면 0으로 내린다.
EARNINGS_EXIT_SESSIONS = 1


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
    sessions_held: int = 0
    pending_exit: str | None = None

    def __post_init__(self) -> None:
        if self.shares < 1:
            raise PositionError(f"보유 수량이 1주 미만입니다: {self.shares}")
        if self.atr14 <= 0:
            raise PositionError(f"ATR가 0 이하입니다: {self.atr14}")

    @classmethod
    def from_fill(cls, fill: Fill, atr14: float) -> "Position":
        if fill.side != "BUY":
            raise PositionError(f"진입 체결이 아닙니다: {fill.side}")
        return cls(
            symbol=fill.symbol,
            shares=fill.shares,
            entry_date=fill.trade_date,
            entry_price=fill.fill_price,
            atr14=atr14,
            highest_close=fill.fill_price,
        )

    @property
    def initial_stop(self) -> float:
        return self.entry_price - ATR_STOP_MULTIPLE * self.atr14

    @property
    def trailing_active(self) -> bool:
        """최고 종가가 진입가 대비 +1 ATR 이상이면 추적손절로 넘어간다."""
        return (
            self.highest_close - self.entry_price
            >= TRAILING_ACTIVATION_ATR * self.atr14
        )

    @property
    def stop_price(self) -> float:
        """현재 손절가.

        활성화 조건이 최고 종가 >= 진입가 + 1 ATR이므로 추적손절가는 활성화 순간에
        정확히 초기 손절가와 같고 이후로만 올라간다. 손절가는 내려가지 않는다.
        """
        if not self.trailing_active:
            return self.initial_stop
        return self.highest_close - TRAILING_STOP_ATR * self.atr14

    @property
    def stop_reason(self) -> str:
        return "TRAILING_STOP" if self.trailing_active else "INITIAL_STOP"

    def unrealized_r(self, price: float) -> float:
        """진입 기준 위험(2 ATR) 대비 손익 배수."""
        return (price - self.entry_price) / (ATR_STOP_MULTIPLE * self.atr14)

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
    """
    ratio = bar.price_scale / previous_bar.price_scale
    if math.isclose(ratio, 1.0, rel_tol=1e-9):
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


def run_session(
    position: Position,
    bar: Bar,
    previous_bar: Bar,
    *,
    costs: CostModel,
    next_earnings: str | None = None,
) -> SessionResult:
    """포지션의 한 세션을 처리한다. 순서는 모듈 설명의 1~6번이다."""
    if bar.trade_date <= previous_bar.trade_date:
        raise PositionError(
            f"직전 바({previous_bar.trade_date})보다 뒤인 바여야 합니다: {bar.trade_date}"
        )

    current = adjust_for_corporate_action(position, previous_bar, bar)

    # 2. 전날 종가에 정해진 청산은 오늘 시초가로 나간다.
    if current.pending_exit is not None:
        fill = execute_market_exit(
            current.symbol, current.shares, bar, costs=costs, price_kind="OPEN"
        )
        return SessionResult(current.symbol, None, fill, current.pending_exit)

    # 3. 어제 종가에 정해진 손절가로 오늘 바를 본다. 오늘 종가를 반영하기 전이다.
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
    if next_earnings is not None and next_earnings[:10] <= bar.trade_date:
        fill = execute_market_exit(
            current.symbol, current.shares, bar, costs=costs, price_kind="CLOSE"
        )
        return SessionResult(current.symbol, None, fill, "EARNINGS_OVERDUE")

    # 5. 실적 전 청산은 그날 종가에 맞춘다(7.5).
    if (
        next_earnings is not None
        and _sessions_until(bar.trade_date, next_earnings) <= EARNINGS_EXIT_SESSIONS
    ):
        fill = execute_market_exit(
            current.symbol, current.shares, bar, costs=costs, price_kind="CLOSE"
        )
        return SessionResult(current.symbol, None, fill, "EARNINGS")

    # 6. 시간 손절과 최대 보유는 다음 시초 청산으로 예약한다.
    if current.sessions_held >= MAX_HOLD_SESSIONS:
        return SessionResult(
            current.symbol, replace(current, pending_exit="MAX_HOLD"), None, "MAX_HOLD"
        )
    if current.sessions_held >= TIME_STOP_SESSIONS and not current.trailing_active:
        return SessionResult(
            current.symbol, replace(current, pending_exit="TIME_STOP"), None, "TIME_STOP"
        )

    return SessionResult(current.symbol, current, None, None)
