'use strict';

// 반복 규칙에서 회차 날짜만 뽑는 순수 계산기다. DB도 시계도 보지 않는다.
//
// 회차 날짜는 언제나 `startDate` anchor에서 센다. 알림이 언제 터졌는지, 서버가
// 언제 회차를 만들었는지로 다음 회차를 세면 Pi가 하루 꺼져 있을 때마다 반복이
// 하루씩 밀린다.
//
// 실제 달력 날짜를 하루씩 걸으면서 규칙에 맞는 날만 고른다. 그래서 `매월 31일`이
// 2월에 회차를 만들지 않는 것이 별도 분기가 아니라 걷는 방식의 결과다. RFC 5545도
// 존재하지 않는 recurrence instance를 "MUST be ignored"라고 정한다.

const RECURRENCE_FREQS = ['daily', 'weekdays', 'weekly', 'monthly'];

// 기존 일정과 같은 10년 지평이다. 규칙에 맞는 날이 하나도 없어도 여기서 멈춘다.
const MAX_SCAN_DAYS = 3660;

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function toDayNumber(value, field) {
  const match = DATE_PATTERN.exec(typeof value === 'string' ? value : '');
  if (!match) throw new TypeError(`${field}는 YYYY-MM-DD 형식이어야 합니다: ${value}`);
  const [year, month, day] = match.slice(1).map(Number);
  if (year < 1970 || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    throw new TypeError(`${field}가 실제 달력 날짜가 아닙니다: ${value}`);
  }
  return Math.floor(Date.UTC(year, month - 1, day) / MS_PER_DAY);
}

function toParts(dayNumber) {
  const date = new Date(dayNumber * MS_PER_DAY);
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

function toDateString(dayNumber) {
  const { year, month, day } = toParts(dayNumber);
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// 1970-01-01은 목요일이라 ISO 요일 4다. 1=월 … 7=일.
function isoWeekday(dayNumber) {
  return ((dayNumber % 7) + 7 + 3) % 7 + 1;
}

function assertRule(rule) {
  if (!rule || typeof rule !== 'object') throw new TypeError('반복 규칙 객체가 필요합니다.');
  if (!RECURRENCE_FREQS.includes(rule.freq)) {
    throw new TypeError(`지원하지 않는 반복 주기입니다: ${rule.freq}`);
  }
  if (rule.freq === 'weekly') {
    if (!Array.isArray(rule.byWeekday) || rule.byWeekday.length === 0
      || !rule.byWeekday.every(day => Number.isInteger(day) && day >= 1 && day <= 7)) {
      throw new TypeError('매주 반복에는 1~7 사이의 요일 목록이 필요합니다.');
    }
  }
  if (rule.freq === 'monthly'
    && !(Number.isInteger(rule.byMonthday) && rule.byMonthday >= 1 && rule.byMonthday <= 31)) {
    throw new TypeError('매월 반복에는 1~31 사이의 날짜가 필요합니다.');
  }
}

function matchesRule(rule, dayNumber) {
  if (rule.freq === 'daily') return true;
  if (rule.freq === 'weekdays') return isoWeekday(dayNumber) <= 5;
  if (rule.freq === 'weekly') return rule.byWeekday.includes(isoWeekday(dayNumber));
  return toParts(dayNumber).day === rule.byMonthday;
}

// 규칙에 맞는 날을 이른 순으로 흘려보낸다. 두 공개 함수가 이것만 소비한다.
function* walk(rule, fromDayNumber) {
  const start = toDayNumber(rule.startDate, 'startDate');
  const end = rule.endDate === undefined || rule.endDate === null
    ? null
    : toDayNumber(rule.endDate, 'endDate');
  let cursor = Math.max(start, fromDayNumber);
  const limit = cursor + MAX_SCAN_DAYS;
  while (cursor <= limit) {
    if (end !== null && cursor > end) return;
    if (matchesRule(rule, cursor)) yield cursor;
    cursor += 1;
  }
}

/**
 * `from`(포함)부터 `to`(포함) 사이에서 규칙에 맞는 KST 날짜를 이른 순으로 반환한다.
 */
function occurrenceDatesBetween(rule, from, to, options = {}) {
  assertRule(rule);
  const limit = Number.isInteger(options.limit) && options.limit > 0 ? options.limit : 100;
  const fromDay = toDayNumber(from, 'from');
  const toDay = toDayNumber(to, 'to');
  const dates = [];
  for (const dayNumber of walk(rule, fromDay)) {
    if (dayNumber > toDay) break;
    dates.push(toDateString(dayNumber));
    if (dates.length >= limit) break;
  }
  return dates;
}

/**
 * `from`(포함) 이후 규칙에 맞는 날짜를 최대 `count`개 반환한다. 규칙이 그 전에
 * 끝나거나 10년 안에 맞는 날이 없으면 요청보다 적게 돌아온다.
 */
function nextOccurrenceDates(rule, from, count) {
  assertRule(rule);
  if (!Number.isInteger(count) || count < 1) throw new TypeError('회차 개수는 1 이상의 정수여야 합니다.');
  const dates = [];
  for (const dayNumber of walk(rule, toDayNumber(from, 'from'))) {
    dates.push(toDateString(dayNumber));
    if (dates.length >= count) break;
  }
  return dates;
}

function addDays(date, amount) {
  if (!Number.isInteger(amount)) throw new TypeError('더할 일수는 정수여야 합니다.');
  return toDateString(toDayNumber(date, 'date') + amount);
}

function maxDate(a, b) {
  return toDayNumber(a, 'date') >= toDayNumber(b, 'date') ? a : b;
}

module.exports = {
  RECURRENCE_FREQS,
  MAX_SCAN_DAYS,
  occurrenceDatesBetween,
  nextOccurrenceDates,
  addDays,
  maxDate,
  isoWeekdayForDate: date => isoWeekday(toDayNumber(date, 'date')),
};
