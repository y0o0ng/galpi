"""슬롯 용량 실험의 코어들. **총 계획 위험을 고정하고 슬롯 수만 나눈다.**

PR #10에서 K=84가 K=42보다 나빴고 `MAX_POSITIONS_REACHED`가 12,243 → 16,030으로 늘었다.
가설은 **5개 슬롯이 오래 점유되어 새 RS 신호를 받아들이지 못한다**는 것이다. 이 파일은
그 가설을 검증할 처치(treatment)를 규칙으로 적는다.

## 두 파라미터가 아니라 하나의 처치다

슬롯만 늘리고 `risk_per_trade`를 그대로 두면 총 위험이 4배가 되어 **용량 실험이 아니라
레버리지 실험**이 된다. 그래서 묶어서 움직인다.

    max_positions = S
    risk_per_trade = 0.0125 / S
    max_total_planned_risk = 0.0125  (고정)

|코어|슬롯|거래당 위험|총 계획 위험|
|---|---|---|---|
|S5|5|0.2500%|1.25%|
|S10|10|0.1250%|1.25%|
|S20|20|0.0625%|1.25%|

묻는 것은 "같은 전체 위험을 몇 개의 독립 slice로 나눌 것인가"다. **"몇 슬롯이 최적인가"가
아니다.**

## S5는 새 코어가 아니다

5 × 0.0025 = 0.0125라서 **S5는 기존 `jt-k42`·`jt-k84`와 정확히 같은 규칙이다.** 그래서
S5 칸은 새로 만들지 않고 그 코어를 그대로 쓴다 — PR #10 재현이 공짜로 따라온다.

## S10을 고른 사전 이유

용량을 아주 거칠게 `슬롯 / 보유기간`으로 보면

    K42,S5  = 5/42  ≈ 0.119
    K84,S5  = 5/84  ≈ 0.060
    K84,S10 = 10/84 ≈ 0.119

라서 **K84,S10이 K42,S5와 대략 같은 명목 갱신 용량**을 갖는다. 이건 결과를 예측하는
모델이 아니라 S10을 고른 사전 근거다. S20은 용량을 더 늘렸을 때 효과가 이어지는지
포화되는지 다른 병목이 나오는지를 보는 넓은 점이다. **사다리는 S5/S10/S20에서 끝난다.**

## 딸려 움직이는 값 하나

`RiskProfile.min_qty_risk_cap`이 `min(0.005, 2 × risk_per_trade)`라서 S5 0.500% ·
S10 0.250% · S20 0.125%로 같이 내려간다. 독립 손잡이가 아니라 거래당 위험의 함수이고,
S20에서 최소 수량 예외가 새 병목이 되는지를 결과에서 본다(사전 기준 F).

## 파일 하나에 코어 여덟인 이유

저장소 규칙은 "코어 하나가 파일 하나"다. 여기서는 **처치가 단위**이고 여덟 코어가
`(K, S, 랭킹)` 격자의 칸일 뿐이라, 같은 묶음 규칙을 여덟 번 복사하면 그 중 하나만 손대도
격자가 조용히 깨진다. 규칙이 파일로 남아야 한다는 목적은 이 파일 하나가 똑같이 지킨다.
"""

from __future__ import annotations

from dataclasses import replace

from backtest.modes import FIXED_HOLD_EXITS, MARKET_REGIME, RANDOM_ENTRY, RS_ONLY_ENTRY
from backtest.policy import PAPER_VALIDATION

from .definition import CoreDefinition
from .jt import RESEARCH_LIMITS, jt_policy

# 총 계획 위험 예산. **모든 슬롯 변형에서 같다.** 이 값이 처치의 불변식이다.
RISK_BUDGET = RESEARCH_LIMITS.max_total_planned_risk  # 0.0125

# 사다리. 결과를 보고 S15·S30을 덧붙이지 않는다.
SLOT_LADDER = (5, 10, 20)
SLOT_HOLDS = (42, 84)


def slot_policy(policy_id: str, note: str, *, slots: int, hold: int):
    """슬롯 `S`짜리 정책. 거래당 위험은 예산을 슬롯으로 나눈 값이다."""
    return jt_policy(
        policy_id,
        note,
        profile=replace(
            PAPER_VALIDATION,
            name=f"PAPER_VALIDATION_S{slots}",
            risk_per_trade=RISK_BUDGET / slots,
        ),
        limits=replace(RESEARCH_LIMITS, max_positions=slots),
        max_hold_sessions=hold,
    )


def slot_core(*, slots: int, hold: int, random: bool) -> CoreDefinition:
    """격자 한 칸. 랭킹만 빼면 같은 K·S의 두 코어가 완전히 같다."""
    kind = "random" if random else "rs"
    name = f"jt-{'random-' if random else ''}k{hold}-s{slots}"
    return CoreDefinition(
        name=name,
        policy=slot_policy(
            f"research-{kind}-k{hold}-s{slots}",
            f"슬롯 용량 실험. K={hold}, 슬롯 {slots},"
            f" 거래당 위험 {RISK_BUDGET / slots:.4%}, 총 계획 위험 {RISK_BUDGET:.2%}",
            slots=slots,
            hold=hold,
        ),
        entry_mode=RANDOM_ENTRY if random else RS_ONLY_ENTRY,
        regime_mode=MARKET_REGIME,
        require_earnings_calendar=False,
        exit_mode=FIXED_HOLD_EXITS,
        summary=(
            f"{'무작위' if random else 'RS 상위'} 진입 · {hold}세션 만기 ·"
            f" 슬롯 {slots} · 거래당 위험 {RISK_BUDGET / slots:.4%}"
        ),
    )


# S5는 `jt-k42`·`jt-k84`·`jt-random-k42`·`jt-random-k84`가 이미 같은 규칙이라 여기 없다.
JT_K42_S10 = slot_core(slots=10, hold=42, random=False)
JT_K42_S20 = slot_core(slots=20, hold=42, random=False)
JT_K84_S10 = slot_core(slots=10, hold=84, random=False)
JT_K84_S20 = slot_core(slots=20, hold=84, random=False)
JT_RANDOM_K42_S10 = slot_core(slots=10, hold=42, random=True)
JT_RANDOM_K42_S20 = slot_core(slots=20, hold=42, random=True)
JT_RANDOM_K84_S10 = slot_core(slots=10, hold=84, random=True)
JT_RANDOM_K84_S20 = slot_core(slots=20, hold=84, random=True)

SLOT_CORES = (
    JT_K42_S10,
    JT_K42_S20,
    JT_K84_S10,
    JT_K84_S20,
    JT_RANDOM_K42_S10,
    JT_RANDOM_K42_S20,
    JT_RANDOM_K84_S10,
    JT_RANDOM_K84_S20,
)
