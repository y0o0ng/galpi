"""대조군 분포. **시드 하나는 표본 하나다.**

무작위 선택을 한 번 돌린 값은 운이 좋았을 수도 나빴을 수도 있어서 그 자체로는 아무것도
가르지 못한다. 여러 시드로 돌려 분포를 만들고, 실제 전략이 그 분포의 어디에 있는지를
본다. **분포 안이면 랭킹은 아무 일도 하지 않은 것이다.**

신호 연구(`study.py`)와 포트폴리오 실험(러너)이 같은 것을 묻고 답을 같은 모양으로
내야 해서 여기 한 벌만 둔다. 둘이 따로 min/median/max를 세면 언젠가 정의가 갈린다.
"""

from __future__ import annotations

import statistics
from collections.abc import Iterable
from dataclasses import dataclass


@dataclass(frozen=True)
class RandomStats:
    """무작위 시드들이 낸 값의 퍼짐."""

    count: int
    minimum: float
    median: float
    maximum: float
    mean: float
    # 시드가 하나뿐이면 흩어짐을 낼 수 없다. 0으로 적으면 좁다는 뜻이 되어버린다.
    stdev: float | None
    values: tuple[float, ...]

    @classmethod
    def of(cls, values: Iterable[float]) -> "RandomStats | None":
        """값들의 분포. 하나도 없으면 None이다."""
        ordered = sorted(values)
        if not ordered:
            return None
        return cls(
            count=len(ordered),
            minimum=ordered[0],
            median=statistics.median(ordered),
            maximum=ordered[-1],
            mean=statistics.fmean(ordered),
            stdev=statistics.stdev(ordered) if len(ordered) > 1 else None,
            values=tuple(ordered),
        )

    def beaten_by(self, actual: float | None) -> int:
        """실제 값이 이긴 표본 수. **N/N이어야 분포 밖이다.**"""
        if actual is None:
            return 0
        return sum(1 for value in self.values if actual > value)
