"""실행 결과를 사람이 읽는 보고서와 기계가 견주는 JSON으로 만든다.

## 왜 파일로 남기는가

`save_run`은 `backtest_runs`에 설정과 카운트만 넣고 지표·워크포워드·판정은 남기지 않는다.
게다가 `trading/data/`는 gitignore라 **DB를 지우면 판정이 사라진다.** 2026-08-10의
`FAIL`(blocker 없음)처럼 값비싸게 얻은 결론이 그렇게 없어지면 안 된다. 가격이 아니라
파생 지표라 삭제 의무 대상도 아니다.

## 지표보다 provenance가 먼저다

보고서 맨 위는 숫자가 아니라 **그 숫자를 읽어도 되는지**다 — `source_version`, 정책 id와
서명, 구간, 그리고 blocker. 숫자만 있는 보고서는 반드시 오독된다. `UNDETERMINED`인 실행의
Sharpe를 나중에 누가 성과로 인용하는 것이 이 프로젝트가 가장 경계해온 실패다.

그래서 blocker가 있으면 제목 바로 아래에 **"이 숫자는 판정이 아니다"**를 적는다.

## 순수 함수다

이미 계산된 객체만 받는다. 연결도 실행도 하지 않으므로 픽스처로 테스트할 수 있고,
`run` 단계의 화면 출력과 파일이 **같은 렌더러**를 쓴다. 둘을 따로 쓰면 어긋난다.
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass

from .loop import BacktestResult, Trade
from .metrics import Metrics
from .validation import GateReport, NeighbourhoodReport, WalkForwardReport

# 보고서에서 비율로 보여줄 지표. 나머지는 그대로 찍는다.
_SHARES = ("win_rate", "total_return", "max_drawdown", "avg_exposure", "cagr",
           "min_qty_exception_share")


def _number(value: object, digits: int = 4) -> str:
    if value is None:
        return "—"
    if isinstance(value, float):
        return f"{value:,.{digits}f}"
    return str(value)


def _share(value: float | None) -> str:
    return "—" if value is None else f"{value * 100:.2f}%"


def _counter_rows(counts: dict[str, int] | None) -> str:
    if not counts:
        return "없음"
    ordered = sorted(counts.items(), key=lambda item: -item[1])
    return ", ".join(f"`{name}` {value:,}" for name, value in ordered)


def entry_funnel(skip_counts: dict[str, int] | None) -> list[tuple[str, int, float]]:
    """건너뛴 이유를 많은 순으로. `(이유, 횟수, 비중)`.

    **왜 거래가 없었는지가 왜 졌는지만큼 중요하다.** 평균 익스포저가 6%면 전략이 나쁜 것이
    아니라 후보가 게이트에서 다 죽는 것일 수 있고, 둘은 다음에 할 일이 다르다.
    """
    if not skip_counts:
        return []
    total = sum(skip_counts.values())
    return [
        (name, count, count / total)
        for name, count in sorted(skip_counts.items(), key=lambda item: -item[1])
    ]


@dataclass(frozen=True)
class ExitAnatomy:
    """청산 사유 하나의 해부. **`mfe_r`이 핵심이다.**

    `return_r`만 보면 그 규칙이 손해인지 알 수 없다. 실적 임박 청산이 평균 +0.1R로
    끝났어도 그때까지 최대 +0.9R을 보고 있었다면 그 규칙은 **이긴 거래를 자르고 있다.**
    반대로 `mfe_r`도 낮으면 애초에 갈 종목이 아니었던 것이다. 규칙을 손볼지 말지가
    그 차이에서 갈린다.
    """

    reason: str
    count: int
    share: float
    avg_return_r: float
    total_pnl: float
    avg_mfe_r: float
    avg_mae_r: float
    avg_sessions: float


def exit_anatomy(trades: tuple[Trade, ...] | list[Trade]) -> list[ExitAnatomy]:
    """청산 사유별 성적. 많은 순으로."""
    grouped: dict[str, list[Trade]] = {}
    for trade in trades:
        grouped.setdefault(trade.exit_reason, []).append(trade)
    total = len(trades)
    rows = [
        ExitAnatomy(
            reason=reason,
            count=len(items),
            share=len(items) / total if total else 0.0,
            avg_return_r=sum(item.return_r for item in items) / len(items),
            total_pnl=sum(item.pnl for item in items),
            avg_mfe_r=sum(item.mfe_r for item in items) / len(items),
            avg_mae_r=sum(item.mae_r for item in items) / len(items),
            avg_sessions=sum(item.sessions_held for item in items) / len(items),
        )
        for reason, items in grouped.items()
    ]
    return sorted(rows, key=lambda row: -row.count)


def judgment_payload(
    result: BacktestResult,
    metrics: Metrics,
    gate: GateReport,
    *,
    walk_forward: WalkForwardReport | None = None,
    stressed: Metrics | None = None,
    neighbourhood: NeighbourhoodReport | None = None,
) -> dict:
    """실행 간 diff용 JSON. 마크다운과 같은 재료를 구조로만 남긴다."""
    config = result.config
    payload: dict = {
        "source_version": config.source_version,
        "policy_id": config.policy.policy_id,
        "policy_signature": config.policy.signature,
        "strategy_version": config.policy.strategy_version,
        "start": config.start,
        "end": config.end,
        "index_names": list(config.index_names),
        "require_earnings_calendar": config.require_earnings_calendar,
        "require_sector": config.require_sector,
        "verdict": gate.verdict,
        "blockers": list(gate.blockers),
        "metrics": asdict(metrics),
        "skip_counts": dict(result.skip_counts),
        "fill_counts": dict(result.fill_counts),
        "exit_counts": dict(result.exit_counts),
        "entry_funnel": [
            {"reason": reason, "count": count, "share": share}
            for reason, count, share in entry_funnel(result.skip_counts)
        ],
        "exit_anatomy": [asdict(row) for row in exit_anatomy(result.trades)],
    }
    if stressed is not None:
        payload["stressed_metrics"] = asdict(stressed)
    if walk_forward is not None:
        payload["walk_forward"] = {
            "positive_fold_share": walk_forward.positive_fold_share,
            "worst_fold_expectancy_r": walk_forward.worst_fold_expectancy_r,
            "oos_trade_count": walk_forward.oos_trade_count,
            "holdout_run_count": walk_forward.holdout_run_count,
            "folds": [
                {
                    "name": fold.name,
                    "start": fold.start,
                    "end": fold.end,
                    "is_holdout": fold.is_holdout,
                    "trade_count": fold_metrics.trade_count,
                    "expectancy_r": fold_metrics.expectancy_r,
                }
                for fold, fold_metrics in walk_forward.fold_metrics
            ],
        }
    if neighbourhood is not None:
        payload["neighbourhood"] = {
            "field": neighbourhood.field,
            "metric_name": neighbourhood.metric_name,
            "center_value": neighbourhood.center_value,
            "center_metric": neighbourhood.center_metric,
            "collapse_ratio": neighbourhood.collapse_ratio,
            "neighbours": [list(item) for item in neighbourhood.neighbours],
        }
    payload["gate_rows"] = [asdict(row) for row in gate.rows]
    return payload


def judgment_json(payload: dict) -> str:
    return json.dumps(payload, indent=2, ensure_ascii=False, sort_keys=True) + "\n"


def judgment_markdown(
    result: BacktestResult,
    metrics: Metrics,
    gate: GateReport,
    *,
    run_id: str,
    walk_forward: WalkForwardReport | None = None,
    stressed: Metrics | None = None,
    neighbourhood: NeighbourhoodReport | None = None,
) -> str:
    """사람이 읽는 보고서."""
    config = result.config
    lines = [f"# {run_id}", ""]

    # **판정이 먼저다.** 지표를 위에 두면 blocker를 못 보고 숫자부터 읽는다.
    lines.append(f"**판정 `{gate.verdict}`**")
    lines.append("")
    if gate.blockers:
        lines.append(
            "> **이 숫자들은 판정이 아니다.** 아래 blocker 때문에 개별 지표가 목표를"
            " 넘더라도 성과 근거로 쓸 수 없다."
        )
        lines.append("")
        for blocker in gate.blockers:
            lines.append(f"> - `{blocker}`")
        lines.append("")
    else:
        lines.append(
            "> blocker가 없다. 조건이 모두 갖춰졌으므로 아래 숫자를 그대로 읽어도 된다."
        )
        lines.append("")

    lines += [
        "## 무엇으로 낸 숫자인가",
        "",
        "|항목|값|",
        "|---|---|",
        f"|적재분|`{config.source_version}`|",
        f"|정책|`{config.policy.policy_id}` (전략 `{config.policy.strategy_version}`)|",
        f"|정책 서명|`{config.policy.signature}`|",
        f"|구간|{config.start} ~ {config.end} ({metrics.sessions:,}세션)|",
        f"|유니버스|{', '.join(config.index_names)}|",
        f"|실적 캘린더 요구|{'예' if config.require_earnings_calendar else '아니오'}|",
        f"|섹터 요구|{'예' if config.require_sector else '아니오'}|",
        "",
        "## 14.7 판정표",
        "",
        "|지표|값|최소|목표|판정|",
        "|---|---|---|---|---|",
    ]
    for row in gate.rows:
        lines.append(
            f"|{row.name}|{_number(row.value)}|{_number(row.minimum)}"
            f"|{_number(row.target)}|`{row.verdict}`|"
        )

    lines += [
        "",
        "## 지표",
        "",
        "|항목|값|",
        "|---|---|",
        f"|거래|{metrics.trade_count:,}건|",
        f"|기대값|{_number(metrics.expectancy_r)} R|",
        f"|승률|{_share(metrics.win_rate)}|",
        f"|평균 이익 / 손실|{_number(metrics.avg_win_r)} R / {_number(metrics.avg_loss_r)} R|",
        f"|Profit Factor|{_number(metrics.profit_factor)}|",
        f"|Sharpe / Sortino|{_number(metrics.sharpe)} / {_number(metrics.sortino)}|",
        f"|최대낙폭|{_share(metrics.max_drawdown)}|",
        f"|CAGR|{_share(metrics.cagr)}|",
        f"|총수익률|{_share(metrics.total_return)}|",
        f"|평균 익스포저|{_share(metrics.avg_exposure)}|",
        f"|자산|{metrics.initial_equity:,.0f} → {metrics.final_equity:,.0f}|",
        f"|비용|{metrics.fees_paid:,.0f}|",
        "",
    ]

    # **비용을 되돌린 값을 함께 적는다.** 순손익만 보면 "비용이 잡아먹었다"와 "애초에
    # 엣지가 없다"를 구별할 수 없는데, 그 둘은 다음에 할 일이 완전히 다르다.
    net = metrics.final_equity - metrics.initial_equity
    if metrics.trade_count:
        lines += [
            "### 비용을 되돌리면",
            "",
            f"순손익 {net:+,.0f} + 비용 {metrics.fees_paid:,.0f}"
            f" = **비용 전 {net + metrics.fees_paid:+,.0f}**"
            f" (거래당 {(net + metrics.fees_paid) / metrics.trade_count:+,.1f})",
            "",
        ]

    funnel = entry_funnel(result.skip_counts)
    if funnel:
        lines += [
            "## 진입 깔때기",
            "",
            "후보가 어디서 죽는가. **거래가 없는 이유가 진 이유만큼 중요하다** —"
            " 익스포저가 낮으면 전략이 나쁜 게 아니라 게이트가 좁은 것일 수 있고,"
            " 둘은 다음에 할 일이 다르다.",
            "",
            "|건너뛴 이유|횟수|비중|",
            "|---|---|---|",
        ]
        for reason, count, share in funnel:
            lines.append(f"|`{reason}`|{count:,}|{_share(share)}|")
        lines.append("")

    anatomy = exit_anatomy(result.trades)
    if anatomy:
        lines += [
            "## 청산 해부",
            "",
            "**`평균 MFE`를 `평균 R`과 나란히 본다.** 어떤 규칙이 평균 +0.1R로 끝냈는데"
            " 그때까지 +0.9R을 보고 있었다면 그 규칙은 이긴 거래를 자르는 것이고,"
            " MFE도 낮으면 애초에 갈 종목이 아니었던 것이다. 규칙을 손볼지가 여기서 갈린다.",
            "",
            "|청산 사유|건수|비중|평균 R|손익|평균 MFE|평균 MAE|평균 보유|",
            "|---|---|---|---|---|---|---|---|",
        ]
        for row in anatomy:
            lines.append(
                f"|`{row.reason}`|{row.count:,}|{_share(row.share)}"
                f"|{_number(row.avg_return_r)}|{row.total_pnl:+,.0f}"
                f"|{_number(row.avg_mfe_r)}|{_number(row.avg_mae_r)}"
                f"|{row.avg_sessions:.1f}세션|"
            )
        lines.append("")

    lines += [
        "## 체결 방식",
        "",
        f"{_counter_rows(result.fill_counts)}",
        "",
    ]

    if walk_forward is not None:
        lines += ["## 워크포워드", ""]
        share = walk_forward.positive_fold_share
        lines.append(
            f"양수 fold 비율 {_number(share)}, 최악 fold"
            f" {_number(walk_forward.worst_fold_expectancy_r)} R,"
            f" 표본 밖 거래 {walk_forward.oos_trade_count:,}건"
        )
        if walk_forward.holdout_run_count is not None:
            lines.append(f"홀드아웃 실행 횟수 {walk_forward.holdout_run_count}회")
        lines += ["", "|구간|기간|거래|기대값|", "|---|---|---|---|"]
        for fold, fold_metrics in walk_forward.fold_metrics:
            name = f"**{fold.name}**" if fold.is_holdout else fold.name
            lines.append(
                f"|{name}|{fold.start} ~ {fold.end}|{fold_metrics.trade_count:,}"
                f"|{_number(fold_metrics.expectancy_r)}|"
            )
        lines.append("")

    if stressed is not None:
        lines += [
            "## 비용 스트레스",
            "",
            f"거래 {stressed.trade_count:,}건, 기대값 {_number(stressed.expectancy_r)} R,"
            f" 최종/초기 {stressed.final_equity / stressed.initial_equity:.4f}",
            "",
        ]

    if neighbourhood is not None:
        cells = ", ".join(
            f"{value}={_number(metric)}" for value, metric in neighbourhood.neighbours
        )
        lines += [
            "## 인접 파라미터",
            "",
            f"`{neighbourhood.field}` 중심 {neighbourhood.center_value}"
            f"={_number(neighbourhood.center_metric)} · {cells}",
            "",
            f"붕괴비율 {_number(neighbourhood.collapse_ratio)}"
            + ("" if neighbourhood.collapse_ratio is not None
               else " (중심 기대값이 0 이하라 비율에 뜻이 없다)"),
            "",
        ]

    return "\n".join(lines).rstrip() + "\n"
