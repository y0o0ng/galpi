# 작업 지시: XION Reels {{episode}}편 도트판 수정 1회

저장소 `{{repo}}`. 네가(또는 다른 제작 에이전트가) 만든 `reels/episodes/{{episode_dir}}/`를 독립 시각 검토 결과대로 한 번 고친다.

- 검토 결과: `{{review_path}}`. **`[MUST]` 항목만 고친다.** `[NICE]`는 손대지 않는다.
- 제작 보고서: `{{report_path}}` (지금 상태). 규칙 정본은 `reels/px/reels-pixel-handoff.md`.
- 경계는 제작 때와 같다: 이 편 폴더·이 편 결과물·보고서 밖에는 쓰지 않는다(공용 `reels/px/`는 읽기 전용), 패키지 설치·git 금지, 렌더는 `nice -n 19` 하나씩.

## 완료 조건
1. `reels/media/{{out_name}}.mp4` 다시 렌더, lint 통과.
2. MUST마다 고친 프레임을 `{{frames_dir}}`에 다시 뽑아 직접 확인.
3. 보고서 `{{report_path}}` 끝에 "수정 1회" 절을 덧붙인다: MUST마다 무엇을 어떻게 고쳤는지, 확인한 프레임, 고치지 못한 것과 이유. 최종 답은 한국어로 짧게.
