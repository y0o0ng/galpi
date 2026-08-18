'use strict';

// quiet hours는 별도의 보류 큐가 아니라 delivery의 next_attempt_at 하나로 표현한다
// (설계 13.3). 그래서 이 파일이 하는 일은 "지금이 조용한 시간이면 언제 풀리는가"를
// 계산하는 것뿐이고, 그 값을 next_attempt_at에 넣으면 기존 claim 조건이 알아서 처리한다.

// 시각 해석은 KST 고정이다. 서버 TZ에 기대면 Pi와 맥이 다른 답을 낸다.
const KST_OFFSET_SECONDS = 9 * 60 * 60;
const DAY_SECONDS = 24 * 60 * 60;

const DEFAULT_QUIET_HOURS = { enabled: true, start: '23:00', end: '07:00' };

// 'HH:MM' → 자정으로부터의 초. 형식이 아니면 null이라 호출부가 보류하지 않는 쪽을 고른다.
function parseClock(value) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(value ?? ''));
  if (!match) return null;
  return Number(match[1]) * 3600 + Number(match[2]) * 60;
}

/**
 * 조용한 시간이면 풀리는 시각을, 아니면 `now`를 그대로 돌려준다.
 *
 * 경계는 시작을 포함하고 끝을 포함하지 않는다. 끝을 포함하면 07:00에 풀린 알림이
 * 다시 07:00까지 밀려 영영 못 나간다.
 *
 * 설정이 깨졌으면 보류하지 않는다. 잘못된 설정 하나가 Push를 영구히 침묵시키는 것이
 * 늦게 울리는 것보다 나쁘다.
 */
function quietHoursReleaseAt(now, quietHours = DEFAULT_QUIET_HOURS) {
  const at = Math.floor(now);
  if (!quietHours || quietHours.enabled !== true) return at;
  const start = parseClock(quietHours.start);
  const end = parseClock(quietHours.end);
  if (start === null || end === null || start === end) return at;

  // KST 자정 기준으로 하루 안 몇 초인지.
  const shifted = at + KST_OFFSET_SECONDS;
  const midnight = Math.floor(shifted / DAY_SECONDS) * DAY_SECONDS - KST_OFFSET_SECONDS;
  const secondsIntoDay = shifted - Math.floor(shifted / DAY_SECONDS) * DAY_SECONDS;

  const crossesMidnight = start > end;
  const quiet = crossesMidnight
    ? (secondsIntoDay >= start || secondsIntoDay < end)
    : (secondsIntoDay >= start && secondsIntoDay < end);
  if (!quiet) return at;

  // 밤 쪽(>= start)이면 다음 날 아침, 새벽 쪽(< end)이면 오늘 아침에 풀린다.
  const releaseDay = crossesMidnight && secondsIntoDay >= start ? midnight + DAY_SECONDS : midnight;
  return releaseDay + end;
}

module.exports = { DEFAULT_QUIET_HOURS, quietHoursReleaseAt };
