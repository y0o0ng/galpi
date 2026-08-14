"""`jt-core-exit` — RS 상위를 사서 **core-1의 청산 규칙**으로 판다.

진입은 `jt-k21`·`jt-k42`와 같고 청산만 7.5 전부다(초기 손절 2 ATR · 추적손절 3 ATR ·
시간손절 20세션 · 실적 전 청산 · 최대 보유 40세션). 그래서 이 코어와 K 코어들의 차이가
**규칙으로서의 청산이 만기 하나보다 나은가**에 대한 답이다.

**`core1`과 헷갈리면 안 된다.** 청산은 같지만 진입이 RS-only라 다른 코어다. 2026-08-10
기준선과 견주려면 진입 차이와 구간 차이(홀드아웃 제외)를 둘 다 감안해야 한다.
"""

from __future__ import annotations

from backtest.modes import MARKET_REGIME, CORE_EXITS, RS_ONLY_ENTRY

from .definition import CoreDefinition
from .jt import jt_policy

JT_CORE_EXIT = CoreDefinition(
    name="jt-core-exit",
    policy=jt_policy(
        "research-jt-core-exit",
        "JT J=63/skip=5, core-1 청산 전부. RS-only 진입, 낙폭 게이트 해제",
    ),
    entry_mode=RS_ONLY_ENTRY,
    regime_mode=MARKET_REGIME,
    # 진입 게이트를 껐으므로 실적 캘린더를 진입 조건으로 요구하지 않는다.
    require_earnings_calendar=False,
    exit_mode=CORE_EXITS,
    summary="RS 상위 진입 · core-1 청산 전부 (최대보유 40세션)",
)
