# 캡처 시간축 스파이크 (설계 §14.1)

`docs/Lecture-note-system_Design_v4.3.md` §14.1의 **10분 smoke**를 iPad에서 돌리는 일회용 측정 페이지다. 제품 코드가 아니고 `server.js`·DB·Pi와 연결하지 않는다. 녹음·시간 연결·복구만 본다.

## 띄우기 (맥 + Tailscale serve)

iPad Safari는 HTTPS에서만 마이크를 연다. 맥에서 정적 파일만 띄우고 tailnet 안에서만 HTTPS로 노출한다.

```sh
python3 -m http.server 8787 --bind 127.0.0.1 --directory spikes/capture-timing
tailscale serve --bg 8787          # https://<mac>.<tailnet>.ts.net 으로 열림
tailscale serve status
# 끝나면
tailscale serve --https=443 off
```

## 10분 smoke 절차

1. iPad에서 페이지를 연다 → `마이크 준비` → `녹음 시작`. 상태가 `시작 확인 중…` 다음 `● 녹음 중`으로 바뀌는지 본다.
2. `싱크 탭 모드`를 켜고 약 1분마다 펜 끝으로 화면을 **톡 소리가 나게** 친다. 사이사이 일반 필기도 한다(모드를 끄면 필기).
3. 5분쯤 `일시정지` → 30초 기다리며 싱크 탭 1~2번(녹음 없음 구간) → `녹음 재개`.
4. 한 번은 새로고침(또는 앱 전환 후 복귀)해서 `저장된 기록`에 이전 조각이 남는지, 상태가 거짓 `녹음 중`이 아닌지 본다. 새로고침 뒤에는 새 runtime이라 `이 기록 분석`으로 이전 기록을 분석한다.
5. 10분쯤 `측정 끝내기 · 분석`.

## 통과 기준 (§14.1 10분 smoke)

- 파일 재생·저장 정상 — `저장된 기록`에서 각 조각 재생
- 비녹음 gap 구분 — 일시정지 중 탭이 `녹음 없음`으로 분리
- 저장된 조각 복구 — 새로고침 뒤 목록·재생·분석 가능
- 참고: 기준점 오차 ±500ms·drift는 90분 gate의 기준이지만 10분에서도 수치를 기록한다

결과는 `로그 내보내기` JSON과 분석 화면을 남기고 `docs/lecture-capture-spike-receipts.md`에 적는다.
