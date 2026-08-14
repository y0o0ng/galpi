"""Jegadeesh–Titman(1993)식 J/K 실험 코어들이 공유하는 재료.

논문은 J개월 과거 수익률로 순위를 매겨 승자를 사고 패자를 팔아 K개월 들고 간다. 여기서는
**J=63세션·skip=5세션을 고정하고 K와 청산만 바꾼다.** 세 코어(`jt-k21`·`jt-k42`·
`jt-core-exit`)가 이 파일의 정책 뼈대를 공유한다.

## J·skip은 이미 core-1의 값이다

`rs_lookback=63`, `rs_skip=5`가 기본값이고 `features.relative_strength`가
`log(P[t-5]/P[t-63])`을 낸다. 우리 쪽은 SPY 같은 구간을 빼지만 **같은 날 모든 종목에서
같은 상수를 빼는 것이라 횡단면 순위도 z-score도 원시 63-5 수익률과 완전히 같다.**
논문의 J/skip과 다르지 않다.

## 진입은 RS-only다 (2026-08-14 사용자 결정)

7.4 진입 게이트를 통째로 끈다 — SMA 정렬도, 20일 돌파도, 실적 완충도 없다. 점수도
`z(rs63_5)` 단독이라 `trend_quality`가 빠진다. 남는 조건은 7.2 유니버스(가격 $10 ·
20일 달러거래대금 $50M · 이력 252세션)와 레짐, 그리고 9.2 리스크 한도다. 그것들은 진입
신호가 아니라 각각 거래 대상의 정의와 위험 예산이다.

## 계좌 낙폭을 규칙에서 뺀다 (2026-08-14 사용자 승인)

**문이 둘이었고 처음엔 하나만 닫았다.**

1. 9.2의 낙폭 조치(수량 축소 5% · 진입 차단 7% · HALT 10% · 킬스위치 12%) — `HardLimits`
2. 7.3의 레짐 낙폭(GREEN 5% · RED 8%) — `StrategyParameters`이고 `classify_regime`이 본다

첫 실행에서 2번이 살아 있어 **2011-08-04에 RED로 들어간 뒤 13.6년을 그대로 있었다.**
4,677세션 중 3,928(84%)이 RED였고 2012년 이후 자산값은 하나뿐이었다. 계좌 낙폭이 상태에
들어가면 손실 → 방어 → 진입 없음 → 자산 정지 → 낙폭 영구 고정의 고리가 닫힌다.

그래서 1번은 한도를 도달 불가능한 값으로 두고, 2번은 **계좌를 아예 인자로 받지 않는**
`MARKET` 분류기로 바꾼다. 계좌 낙폭을 빼고 같은 세션을 다시 판정하면 GREEN 3,638 ·
YELLOW 109 · RED 930이다 — RED 84%는 시장이 아니라 우리 손익이 만든 값이었다.

**일일·주간 손실 한도는 유지한다.** PAPER·LIVE 정책은 건드리지 않는다.

## 레짐은 라벨이고 아무것도 막지 않는다

`MARKET` 분류기는 추세 2×2(BULL·CORRECTION·RECOVERY·BEAR) × 변동성 2칸을 붙일 뿐
진입도 익스포저도 제한하지 않는다. 레짐의 기여는 막아서가 아니라 **레짐별 성과표로
사후에** 읽는다 — 막아버리면 그 구간에 표본이 없어서 막은 것이 잘한 일이었는지 모른다.

변동성 문턱은 `green_max_vol`을 **0.30 → 0.20으로 낮춰** 쓴다. 0.30이면 SPY 20일 실현
변동성이 그 위인 세션이 7.3%뿐이라(중앙값 0.136) 축이 갈리지 않는다. 0.20은 SPY 장기
실현변동성 평균에 가까운 외부 기준이고 이 표본에서 23/77로 나뉜다. 표본 중앙값으로
잡으면 이 데이터에 맞춘 값이 되므로 쓰지 않았다.

## 논문과 다른 것

- **롱 온리다.** "selling losers" 다리가 없어 모멘텀 스프레드가 아니라 롱 레그만 잰다.
- **데실이 아니라 상위 5개다.** `max_candidates`와 동시보유 5, 하루 진입 2(GREEN)·1
  (YELLOW)이 그대로라 동일가중 데실 포트폴리오가 아니라 집중된 롱 레그다.
- **규칙이 같아도 실현되는 진입은 갈린다.** 손절로 비었을 자리가 차 있으면 다음 후보가
  못 들어온다. 세 코어에서 같은 것은 진입 조건이지 진입 목록이 아니다.
"""

from __future__ import annotations

from dataclasses import replace

from backtest.policy import (
    DEFAULT_PARAMETERS,
    PAPER_VALIDATION,
    HardLimits,
    PolicyVersion,
)

# 낙폭은 정의상 1을 넘을 수 없다. 1.01은 "이 조치는 절대 발동하지 않는다"는 뜻이다.
UNREACHABLE = 1.01

RESEARCH_LIMITS = replace(
    HardLimits(),
    drawdown_quantity_cut=UNREACHABLE,
    drawdown_block_entries=UNREACHABLE,
    drawdown_halt=UNREACHABLE,
    drawdown_killswitch=UNREACHABLE,
)

# 논문의 winners 정의에 맞춘 랭킹. trend_quality를 빼고 모멘텀 하나로 순위를 매긴다.
# `green_max_vol`은 `MARKET` 분류기에서 high vol 문턱이다(위 설명 참고).
HIGH_VOL_THRESHOLD = 0.20

MOMENTUM_PARAMETERS = replace(
    DEFAULT_PARAMETERS,
    score_weight_rs=1.0,
    score_weight_trend=0.0,
    green_max_vol=HIGH_VOL_THRESHOLD,
)


def jt_policy(policy_id: str, note: str, **parameter_changes) -> PolicyVersion:
    """JT 코어의 정책. 프로필은 기준선과 같고 한도만 연구용이다."""
    return PolicyVersion(
        policy_id=policy_id,
        profile=PAPER_VALIDATION,
        limits=RESEARCH_LIMITS,
        parameters=replace(MOMENTUM_PARAMETERS, **parameter_changes),
        note=note,
    )
