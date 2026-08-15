"""홀드아웃은 문서 규칙이 아니라 코드 불변식이다.

"연구 런은 홀드아웃을 보지 않는다"를 러너마다 손으로 지키면, 지킨 러너와 안 지킨 러너를
사람이 읽어서 구별해야 한다. 실제로 그렇게 샜다 — `signal_study.py`는 2026-08-07까지
훑었고 그것이 홀드아웃 안이라는 사실은 결과가 나온 뒤에야 드러났다.

## 경계는 달력 위의 한 날짜다

`plan_walk_forward`가 내는 홀드아웃 시작은 **적재분의 마지막 세션에서 거꾸로 센 값**이라
바를 더 받으면 조용히 움직인다. 움직이는 경계로는 "이 구간은 표본 밖이다"를 지킬 수
없으므로 여기서는 상수로 못박는다. 홀드아웃은 정책도 적재분도 아니고 달력 위의 한
구간이다.

`derived`가 상수보다 **뒤로** 가는 것(바가 늘었다)은 안전하다 — 연구가 쓸 수 있는 구간을
남겨둘 뿐이다. **앞으로** 가는 것(바가 줄었다)은 상수가 진짜 홀드아웃 안을 가리키게 되므로
막는다.

## 자르는 것은 신호일이 아니라 달력이다

forward 수익률도 미래 가격 접근이다. 신호일만 걸러도 `t+84`가 홀드아웃 안의 종가를 읽으면
같은 누수다. 그래서 러너는 세션 목록 자체를 잘라 쓰고, 잘린 달력 밖은 애초에 조회하지
않는다. 구간 끝의 긴 지평이 비는 것은 부작용이 아니라 그 불변식의 모양이다.

## 소모는 막지 않고 표시한다

홀드아웃을 보는 것이 목적인 실행(14.7 판정)은 있다. 그 경우 `consume_holdout=True`를
명시해야 하고, 결과 메타데이터에 `HOLDOUT_CONSUMED = true`가 남는다. 기본값이 안전한
쪽이고 위험한 쪽은 타이핑을 요구한다.
"""

from __future__ import annotations

# 홀드아웃 시작일. 이 날짜부터 2026-08-07까지가 표본 밖이다.
HOLDOUT_START = "2025-08-07"


class HoldoutViolation(RuntimeError):
    """연구 결과가 홀드아웃 날짜를 건드렸다."""


def research_sessions(
    sessions: list[str], *, consume_holdout: bool = False
) -> list[str]:
    """연구가 볼 수 있는 세션만 남긴다. 기본은 `HOLDOUT_START` 이전까지다.

    `consume_holdout=True`면 그대로 돌려준다 — 판정 실행이 홀드아웃을 보는 경로다.
    """
    if consume_holdout:
        return list(sessions)
    return [date for date in sessions if date < HOLDOUT_START]


def assert_no_holdout(dates, *, consumed: bool = False) -> None:
    """결과에 홀드아웃 날짜가 들어갔으면 예외. `consumed`면 통과시킨다."""
    if consumed:
        return
    offenders = sorted({date for date in dates if date >= HOLDOUT_START})
    if offenders:
        raise HoldoutViolation(
            f"홀드아웃({HOLDOUT_START}부터) 날짜가 연구 결과에 {len(offenders)}개"
            f" 들어갔습니다: {offenders[0]} ~ {offenders[-1]}"
        )


def check_derived_holdout(derived_start: str) -> None:
    """`plan_walk_forward`가 낸 홀드아웃 시작이 상수와 맞는지 본다.

    상수보다 앞이면 상수가 진짜 홀드아웃 안을 가리키므로 막는다. 뒤인 것은 연구 구간을
    덜 쓰는 쪽이라 통과시킨다.
    """
    if derived_start < HOLDOUT_START:
        raise HoldoutViolation(
            f"적재분이 낸 홀드아웃 시작 {derived_start}이 HOLDOUT_START"
            f" {HOLDOUT_START}보다 앞입니다. 상수가 홀드아웃 안을 가리킵니다."
        )


def holdout_metadata(*, consumed: bool) -> dict:
    """산출물에 남길 메타데이터. 소모한 실행은 그 사실을 들고 다닌다."""
    return {"HOLDOUT_START": HOLDOUT_START, "HOLDOUT_CONSUMED": consumed}
