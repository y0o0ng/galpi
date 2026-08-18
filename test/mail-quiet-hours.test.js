'use strict';

// quiet hours 계산만 따로 잠근다. 23:00~07:00은 자정을 넘는 구간이라 경계에서 틀리기
// 쉽고, 틀리면 Push가 한밤중에 나가거나 아침에 영영 안 나간다.

const test = require('node:test');
const assert = require('node:assert/strict');

const { DEFAULT_QUIET_HOURS, quietHoursReleaseAt } = require('../lib/mail/quiet-hours');

const KST = 9 * 3600;
// 테스트를 읽을 수 있게 KST 벽시계로 epoch을 만든다.
function kst(dateText, timeText) {
  return Math.floor(Date.parse(`${dateText}T${timeText}:00+09:00`) / 1000);
}

test('quiet hours off means the push goes out now', () => {
  const now = kst('2026-08-18', '02:00');
  assert.equal(quietHoursReleaseAt(now, { ...DEFAULT_QUIET_HOURS, enabled: false }), now);
});

test('daytime is not quiet, so nothing is held', () => {
  for (const time of ['07:00', '09:30', '12:00', '22:59']) {
    const now = kst('2026-08-18', time);
    assert.equal(quietHoursReleaseAt(now, DEFAULT_QUIET_HOURS), now, time);
  }
});

test('a window that crosses midnight holds both sides until morning', () => {
  // 밤 쪽: 같은 날 23:00~23:59는 다음 날 07:00에 풀린다.
  assert.equal(
    quietHoursReleaseAt(kst('2026-08-18', '23:00'), DEFAULT_QUIET_HOURS),
    kst('2026-08-19', '07:00'),
  );
  assert.equal(
    quietHoursReleaseAt(kst('2026-08-18', '23:59'), DEFAULT_QUIET_HOURS),
    kst('2026-08-19', '07:00'),
  );
  // 새벽 쪽: 00:00~06:59는 **같은 날** 07:00에 풀린다. 여기서 하루를 더하면
  // 새벽 알림이 24시간 늦게 나간다.
  assert.equal(
    quietHoursReleaseAt(kst('2026-08-19', '00:00'), DEFAULT_QUIET_HOURS),
    kst('2026-08-19', '07:00'),
  );
  assert.equal(
    quietHoursReleaseAt(kst('2026-08-19', '03:00'), DEFAULT_QUIET_HOURS),
    kst('2026-08-19', '07:00'),
  );
  assert.equal(
    quietHoursReleaseAt(kst('2026-08-19', '06:59'), DEFAULT_QUIET_HOURS),
    kst('2026-08-19', '07:00'),
  );
});

test('the boundaries belong to the side the design names', () => {
  // 시작 시각은 조용한 쪽이고 끝 시각은 이미 아침이다. 둘 다 포함하면 07:00에
  // 풀린 알림이 다시 07:00까지 밀려 영영 못 나간다.
  assert.notEqual(quietHoursReleaseAt(kst('2026-08-18', '23:00'), DEFAULT_QUIET_HOURS), kst('2026-08-18', '23:00'));
  assert.equal(quietHoursReleaseAt(kst('2026-08-19', '07:00'), DEFAULT_QUIET_HOURS), kst('2026-08-19', '07:00'));
});

test('a window inside one day holds only that stretch', () => {
  // 자정을 넘지 않는 설정도 같은 함수가 다뤄야 한다.
  const daytime = { enabled: true, start: '13:00', end: '14:00' };
  assert.equal(quietHoursReleaseAt(kst('2026-08-18', '13:30'), daytime), kst('2026-08-18', '14:00'));
  assert.equal(quietHoursReleaseAt(kst('2026-08-18', '12:59'), daytime), kst('2026-08-18', '12:59'));
  assert.equal(quietHoursReleaseAt(kst('2026-08-18', '14:00'), daytime), kst('2026-08-18', '14:00'));
});

test('a window whose ends are equal holds nothing', () => {
  // 24시간 내내 조용한 것으로 읽으면 Push가 영영 안 나간다. 빈 구간으로 읽는다.
  const empty = { enabled: true, start: '07:00', end: '07:00' };
  const now = kst('2026-08-18', '07:00');
  assert.equal(quietHoursReleaseAt(now, empty), now);
});

test('a broken setting never silences push forever', () => {
  // 설정이 깨졌으면 조용히 막는 것보다 지금 보내는 쪽이 안전하다.
  const now = kst('2026-08-18', '03:00');
  for (const broken of [null, {}, { enabled: true }, { enabled: true, start: '25:00', end: '07:00' }]) {
    assert.equal(quietHoursReleaseAt(now, broken), now, JSON.stringify(broken));
  }
});

test('omitting the setting falls back to the default window, not to no window', () => {
  // undefined는 "설정이 깨졌다"가 아니라 "기본값을 쓴다"이다. 둘을 같이 다루면
  // 호출부가 인자를 빠뜨렸을 때 조용히 quiet hours가 꺼진다.
  const night = kst('2026-08-19', '03:00');
  assert.equal(quietHoursReleaseAt(night), kst('2026-08-19', '07:00'));
  assert.equal(quietHoursReleaseAt(night, undefined), kst('2026-08-19', '07:00'));
});

test('the default window is the one the design fixed', () => {
  assert.deepEqual(DEFAULT_QUIET_HOURS, { enabled: true, start: '23:00', end: '07:00' });
  // KST 고정이다. 서버 TZ가 무엇이든 같은 답이 나와야 한다.
  assert.equal(kst('2026-08-19', '07:00') % 86400, (7 * 3600 - KST + 86400) % 86400);
});
