"""설계 10.4 비용 모델.

|항목|기본|스트레스|
|---|---|---|
|매수·매도 슬리피지|각 5bp|각 15bp|
|스프레드|종목별 추정|2배|
|수수료·제비용|실제 브로커 요율|2배|

수수료와 제세금은 사용자가 계좌 요율표에서 확인한 값이다(`RATE_SOURCE`). 수수료는 왕복
50bp로 이 모델에서 가장 큰 비용이고, 제세금은 매도 편도에만 붙는다.

스프레드는 10.4가 "종목별 추정"이라고 하지만 일봉에는 호가가 없다. 7.2가 종가 10달러
이상·20일 중앙값 달러거래대금 5천만 달러 이상만 남기므로 유동성 상위 종목의 평면
추정값을 쓴다. 호가 데이터가 들어오면 종목별 모델로 바꾼다.

**스프레드는 절반만 매긴다.** 바의 시가·저가는 이미 체결된 가격이라 스프레드가 부분적으로
반영되어 있다. 호가를 건너뛰는 비용은 중간가 기준 반스프레드이므로 전체를 다시 얹으면
이중 계산이다.
"""

from __future__ import annotations

from dataclasses import dataclass, replace

BASIS_POINT = 1e-4

# 요율의 출처. 바꿀 때는 언제 어디서 확인했는지 함께 갱신한다.
RATE_SOURCE = "사용자 계좌 요율표 확인 2026-08-06: 수수료 0.25%, 미국 제세금 매도 0.00206%"
COMMISSION_BPS = 25.0  # 0.25%, 매수·매도 양방향
SELL_TAX_BPS = 0.206  # 0.00206%, 매도에만 붙는 제세금


class CostError(Exception):
    """비용 모델을 쓸 수 없는 입력일 때 올린다."""


@dataclass(frozen=True)
class Stress:
    """10.4 스트레스 열. 항목마다 배수가 다르다."""

    slippage: float = 1.0
    spread: float = 1.0
    commission: float = 1.0

    @classmethod
    def uniform(cls, factor: float) -> "Stress":
        """21.2의 "비용 2배·3배 스트레스"처럼 전 항목에 같은 배수를 걸 때 쓴다."""
        return cls(slippage=factor, spread=factor, commission=factor)


BASE_STRESS = Stress()
# 10.4 표의 스트레스 열. 슬리피지 5bp → 15bp가 3배, 나머지는 2배다.
DESIGN_STRESS = Stress(slippage=3.0, spread=2.0, commission=2.0)


@dataclass(frozen=True)
class CostModel:
    slippage_bps: float = 5.0
    spread_bps: float = 2.0
    commission_bps: float = COMMISSION_BPS
    commission_min: float = 0.0
    sell_tax_bps: float = SELL_TAX_BPS
    stress: Stress = BASE_STRESS

    @property
    def one_way_bps(self) -> float:
        """편도 가격 비용. 스프레드는 반만 매긴다(모듈 설명 참고)."""
        return (
            self.slippage_bps * self.stress.slippage
            + (self.spread_bps / 2) * self.stress.spread
        )

    def fill_price(self, reference_price: float, side: str) -> float:
        """기준가에 편도 비용을 얹는다. 매수는 비싸게, 매도는 싸게 체결된다."""
        if reference_price <= 0:
            raise CostError(f"기준가가 0 이하입니다: {reference_price}")
        adjustment = self.one_way_bps * BASIS_POINT
        if side == "BUY":
            return reference_price * (1 + adjustment)
        if side == "SELL":
            return reference_price * (1 - adjustment)
        raise CostError(f"방향은 BUY 또는 SELL이어야 합니다: {side!r}")

    def fees_for(self, shares: int, fill_price: float, side: str) -> float:
        """수수료와 제비용. 매도에는 제세금이 더 붙는다.

        제세금은 법정 요율이라 우리가 협상할 수 없지만 10.4의 "수수료·제비용" 스트레스를
        함께 받는다. 미국 SEC 요율은 실제로 연도마다 몇 배씩 바뀌어 왔다.
        """
        rate = self.commission_bps * BASIS_POINT
        if side == "SELL":
            rate += self.sell_tax_bps * BASIS_POINT
        elif side != "BUY":
            raise CostError(f"방향은 BUY 또는 SELL이어야 합니다: {side!r}")
        return max(
            shares * fill_price * rate * self.stress.commission, self.commission_min
        )

    @property
    def round_trip_bps(self) -> float:
        """왕복 총 비용. 가격 비용 양방향 + 수수료 양방향 + 매도 제세금."""
        return (
            2 * self.one_way_bps
            + (2 * self.commission_bps + self.sell_tax_bps) * self.stress.commission
        )

    def stressed(self, stress: Stress = DESIGN_STRESS) -> "CostModel":
        return replace(self, stress=stress)
