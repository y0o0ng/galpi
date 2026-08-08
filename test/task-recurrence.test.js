'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  RECURRENCE_FREQS,
  MAX_SCAN_DAYS,
  occurrenceDatesBetween,
  nextOccurrenceDates,
  addDays,
  maxDate,
  isoWeekdayForDate,
} = require('../lib/task-recurrence');

// 2026-08-10은 월요일, 2026-08-15는 토요일이다.
const DAILY = { freq: 'daily', startDate: '2026-08-10', endDate: null };
const WEEKDAYS = { freq: 'weekdays', startDate: '2026-08-10', endDate: null };
const MON_WED_FRI = { freq: 'weekly', byWeekday: [1, 3, 5], startDate: '2026-08-10', endDate: null };
const MONTHLY_31 = { freq: 'monthly', byMonthday: 31, startDate: '2026-01-01', endDate: null };

test('지원하는 반복 주기는 넷이다', () => {
  assert.deepEqual(RECURRENCE_FREQS, ['daily', 'weekdays', 'weekly', 'monthly']);
});

test('ISO 요일은 월요일이 1이고 일요일이 7이다', () => {
  assert.equal(isoWeekdayForDate('2026-08-10'), 1);
  assert.equal(isoWeekdayForDate('2026-08-15'), 6);
  assert.equal(isoWeekdayForDate('2026-08-16'), 7);
});

test('매일 반복은 구간의 모든 날짜를 준다', () => {
  assert.deepEqual(
    occurrenceDatesBetween(DAILY, '2026-08-10', '2026-08-14'),
    ['2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13', '2026-08-14']
  );
});

test('평일 반복은 토·일을 건너뛴다', () => {
  assert.deepEqual(
    occurrenceDatesBetween(WEEKDAYS, '2026-08-10', '2026-08-18'),
    [
      '2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13', '2026-08-14',
      '2026-08-17', '2026-08-18',
    ]
  );
});

test('매주 반복은 고른 요일만 준다', () => {
  assert.deepEqual(
    occurrenceDatesBetween(MON_WED_FRI, '2026-08-10', '2026-08-21'),
    ['2026-08-10', '2026-08-12', '2026-08-14', '2026-08-17', '2026-08-19', '2026-08-21']
  );
});

// 매월 31일은 2·4·6·9·11월에 회차가 없다. 말일로 당기지 않는다.
test('매월 반복은 그 날짜가 없는 달을 건너뛴다', () => {
  assert.deepEqual(
    occurrenceDatesBetween(MONTHLY_31, '2026-01-01', '2026-12-31'),
    [
      '2026-01-31', '2026-03-31', '2026-05-31', '2026-07-31',
      '2026-08-31', '2026-10-31', '2026-12-31',
    ]
  );
});

test('매월 반복은 있는 달의 그 날짜를 정확히 준다', () => {
  assert.deepEqual(
    occurrenceDatesBetween(
      { freq: 'monthly', byMonthday: 15, startDate: '2026-08-01', endDate: null },
      '2026-08-01',
      '2026-11-30'
    ),
    ['2026-08-15', '2026-09-15', '2026-10-15', '2026-11-15']
  );
});

test('start_date보다 이른 구간에서는 회차가 나오지 않는다', () => {
  assert.deepEqual(occurrenceDatesBetween(DAILY, '2026-08-01', '2026-08-09'), []);
  assert.deepEqual(
    occurrenceDatesBetween(DAILY, '2026-08-08', '2026-08-11'),
    ['2026-08-10', '2026-08-11']
  );
});

test('end_date는 포함이고 그 뒤로는 끊는다', () => {
  assert.deepEqual(
    occurrenceDatesBetween({ ...DAILY, endDate: '2026-08-12' }, '2026-08-10', '2026-08-20'),
    ['2026-08-10', '2026-08-11', '2026-08-12']
  );
});

test('limit은 이른 회차부터 자른다', () => {
  assert.deepEqual(
    occurrenceDatesBetween(DAILY, '2026-08-10', '2026-12-31', { limit: 3 }),
    ['2026-08-10', '2026-08-11', '2026-08-12']
  );
});

// 회차 날짜는 anchor에서만 센다. 며칠 늦게 물어봐도 남은 날짜가 밀리지 않는다.
test('늦게 물어봐도 회차 날짜가 밀리지 않는다', () => {
  const onTime = occurrenceDatesBetween(MON_WED_FRI, '2026-08-10', '2026-08-31');
  const late = occurrenceDatesBetween(MON_WED_FRI, '2026-08-20', '2026-08-31');
  assert.deepEqual(late, onTime.filter(date => date >= '2026-08-20'));
});

test('다음 N회는 구간을 몰라도 세어준다', () => {
  assert.deepEqual(
    nextOccurrenceDates(MON_WED_FRI, '2026-08-10', 4),
    ['2026-08-10', '2026-08-12', '2026-08-14', '2026-08-17']
  );
  // 없는 달을 건너뛰느라 4회를 채우는 데 반년이 넘게 걸린다.
  assert.deepEqual(
    nextOccurrenceDates(MONTHLY_31, '2026-02-01', 4),
    ['2026-03-31', '2026-05-31', '2026-07-31', '2026-08-31']
  );
});

test('규칙이 먼저 끝나면 요청보다 적게 준다', () => {
  assert.deepEqual(
    nextOccurrenceDates({ ...DAILY, endDate: '2026-08-11' }, '2026-08-10', 5),
    ['2026-08-10', '2026-08-11']
  );
});

// 상한은 조회 시작점 기준이다. 규칙이 맞는 날을 영영 못 찾아도 여기서 멈춘다.
// 지금 규칙 넷은 늦어도 한 해 안에 반드시 맞으므로 실제로는 걸리지 않는 방어선이다.
test('훑는 범위에 상한이 있어 무한히 걷지 않는다', () => {
  const dates = occurrenceDatesBetween(DAILY, '2026-08-10', '2100-01-01', { limit: 100_000 });
  assert.equal(dates.length, MAX_SCAN_DAYS + 1);
  assert.equal(dates.at(-1), addDays('2026-08-10', MAX_SCAN_DAYS));
});

test('잘못된 규칙과 날짜는 거부한다', () => {
  assert.throws(() => occurrenceDatesBetween({ freq: 'yearly', startDate: '2026-08-10' }, '2026-08-10', '2026-08-11'), TypeError);
  assert.throws(() => occurrenceDatesBetween({ freq: 'weekly', byWeekday: [], startDate: '2026-08-10' }, '2026-08-10', '2026-08-11'), TypeError);
  assert.throws(() => occurrenceDatesBetween({ freq: 'weekly', byWeekday: [0], startDate: '2026-08-10' }, '2026-08-10', '2026-08-11'), TypeError);
  assert.throws(() => occurrenceDatesBetween({ freq: 'monthly', byMonthday: 32, startDate: '2026-08-10' }, '2026-08-10', '2026-08-11'), TypeError);
  assert.throws(() => occurrenceDatesBetween(DAILY, '2026-02-30', '2026-03-01'), TypeError);
  assert.throws(() => occurrenceDatesBetween(DAILY, '2026-8-10', '2026-08-11'), TypeError);
});

test('날짜 도우미는 실제 달력을 따른다', () => {
  assert.equal(addDays('2026-02-28', 1), '2026-03-01');
  assert.equal(addDays('2026-01-01', -1), '2025-12-31');
  assert.equal(addDays('2026-08-10', 60), '2026-10-09');
  assert.equal(maxDate('2026-08-10', '2026-08-09'), '2026-08-10');
  assert.equal(maxDate('2026-08-09', '2026-08-10'), '2026-08-10');
});
