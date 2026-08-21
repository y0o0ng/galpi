'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  toKmaGrid,
  selectKmaBaseTimes,
  normalizeForecast,
  buildWeatherBriefing,
  createWeatherService,
} = require('../lib/weather');

const KST = 9 * 60 * 60 * 1000;

// KST 벽시계로 시각을 적는다. 예보 판단이 전부 KST 기준이라 UTC로 적으면
// 테스트를 읽는 사람이 매번 아홉 시간을 암산해야 한다.
function kst(year, month, day, hour = 0, minute = 0) {
  return new Date(Date.UTC(year, month - 1, day, hour, minute) - KST);
}

function slot(time, values) {
  return { time: time.getTime(), tmp: null, pop: null, pty: null, sky: null, ...values };
}

test('the grid conversion matches the official KMA lat/lon sheet', () => {
  // 기대값은 기억이 아니라 `reference/기상청41_…_격자_위경도(2607).xlsx`의 행이다.
  // 여기서 틀리면 화면에 지역 이름이 없으므로 다른 동네 날씨가 조용히 나온다.
  assert.deepEqual(toKmaGrid(37.5635694444444, 126.980008333333), { nx: 60, ny: 127 }); // 서울특별시
  assert.deepEqual(toKmaGrid(35.1770194444444, 129.076952777777), { nx: 98, ny: 76 });  // 부산광역시
  assert.deepEqual(toKmaGrid(33.4963111111111, 126.533208333333), { nx: 53, ny: 38 });  // 제주시
  assert.deepEqual(toKmaGrid(35.8203333333333, 127.108833333333), { nx: 63, ny: 89 });  // 전주시
});

test('the grid conversion refuses coordinates that are not coordinates', () => {
  for (const [lat, lon] of [[NaN, 127], [37.5, NaN], ['', ''], [null, undefined], [91, 127], [37.5, 181]]) {
    assert.throws(() => toKmaGrid(lat, lon), error => error.code === 'WEATHER_INVALID_LOCATION');
  }
});

test('coordinates outside the grid stop before KMA is ever called', () => {
  // 해외는 잘못된 입력이 아니라 예보가 없는 것이다(설계 24절).
  for (const [lat, lon] of [[35.6812, 139.7671], [40.7128, -74.006], [-33.8688, 151.2093]]) {
    assert.throws(() => toKmaGrid(lat, lon), error => error.code === 'WEATHER_FORECAST_UNAVAILABLE');
  }
});

test('the base time is the newest release that KMA has actually published', () => {
  // 활용가이드는 각 발표의 API 제공을 `HH:10 이후`로 적는다. 15분은 그 위의 여유다.
  assert.deepEqual(selectKmaBaseTimes(kst(2026, 8, 22, 14, 7))[0], { baseDate: '20260822', baseTime: '1100' });
  assert.deepEqual(selectKmaBaseTimes(kst(2026, 8, 22, 14, 14))[0], { baseDate: '20260822', baseTime: '1100' });
  assert.deepEqual(selectKmaBaseTimes(kst(2026, 8, 22, 14, 15))[0], { baseDate: '20260822', baseTime: '1400' });
  assert.deepEqual(selectKmaBaseTimes(kst(2026, 8, 22, 2, 20))[0], { baseDate: '20260822', baseTime: '0200' });
});

test('before the first release of the day the base time rolls back to yesterday', () => {
  assert.deepEqual(selectKmaBaseTimes(kst(2026, 8, 22, 1, 0))[0], { baseDate: '20260821', baseTime: '2300' });
  assert.deepEqual(selectKmaBaseTimes(kst(2026, 8, 22, 2, 5))[0], { baseDate: '20260821', baseTime: '2300' });
  // 월 경계도 같은 규칙으로 넘어간다.
  assert.deepEqual(selectKmaBaseTimes(kst(2026, 9, 1, 0, 30))[0], { baseDate: '20260831', baseTime: '2300' });
});

test('the second candidate is the release right before the first one', () => {
  // 후보가 하나면 발표 경계마다 날씨가 조용히 사라지고 아무도 눈치채지 못한다.
  assert.deepEqual(selectKmaBaseTimes(kst(2026, 8, 22, 14, 20)), [
    { baseDate: '20260822', baseTime: '1400' },
    { baseDate: '20260822', baseTime: '1100' },
  ]);
  assert.deepEqual(selectKmaBaseTimes(kst(2026, 8, 22, 2, 30)), [
    { baseDate: '20260822', baseTime: '0200' },
    { baseDate: '20260821', baseTime: '2300' },
  ]);
  assert.deepEqual(selectKmaBaseTimes(kst(2026, 8, 22, 1, 0)), [
    { baseDate: '20260821', baseTime: '2300' },
    { baseDate: '20260821', baseTime: '2000' },
  ]);
});

test('normalizing groups the four categories by forecast hour, whatever their order', () => {
  const rows = [
    { category: 'SKY', fcstDate: '20260822', fcstTime: '0100', fcstValue: '4' },
    { category: 'TMP', fcstDate: '20260822', fcstTime: '0000', fcstValue: '27' },
    { category: 'POP', fcstDate: '20260822', fcstTime: '0100', fcstValue: '60' },
    { category: 'WSD', fcstDate: '20260822', fcstTime: '0000', fcstValue: '2.1' },
    { category: 'PTY', fcstDate: '20260822', fcstTime: '0100', fcstValue: '1' },
    { category: 'TMP', fcstDate: '20260822', fcstTime: '0100', fcstValue: '26' },
  ];
  assert.deepEqual(normalizeForecast(rows), [
    { time: kst(2026, 8, 22, 0).getTime(), tmp: 27, pop: null, pty: null, sky: null },
    { time: kst(2026, 8, 22, 1).getTime(), tmp: 26, pop: 60, pty: 1, sky: 4 },
  ]);
});

test('normalizing drops junk rows and refuses a payload that is not a list', () => {
  const rows = [
    { category: 'TMP', fcstDate: 'nope', fcstTime: '0000', fcstValue: '27' },
    { category: 'TMP', fcstDate: '20260822', fcstTime: '0000', fcstValue: '' },
    null,
    { category: 'TMP', fcstDate: '20260822', fcstTime: '0000', fcstValue: '27' },
  ];
  assert.deepEqual(normalizeForecast(rows), [
    { time: kst(2026, 8, 22, 0).getTime(), tmp: 27, pop: null, pty: null, sky: null },
  ]);
  for (const bad of [null, undefined, {}, 'items']) {
    assert.throws(() => normalizeForecast(bad), error => error.code === 'WEATHER_FORECAST_UNAVAILABLE');
  }
});

test('the shown temperature is the first forecast slot at or after now', () => {
  const now = kst(2026, 8, 21, 23, 27);
  const briefing = buildWeatherBriefing([
    slot(kst(2026, 8, 21, 23), { tmp: 29, pop: 0, sky: 1 }),
    slot(kst(2026, 8, 22, 0), { tmp: 27, pop: 0, sky: 1 }),
  ], now);
  assert.equal(briefing.temperature, 27);
});

test('the precipitation gate opens at 60 and hardens at 80', () => {
  const now = kst(2026, 8, 22, 12, 0);
  const build = pop => buildWeatherBriefing([
    slot(kst(2026, 8, 22, 12), { tmp: 20, pop: 0, sky: 1 }),
    slot(kst(2026, 8, 22, 15), { tmp: 20, pop, pty: 1 }),
  ], now);

  assert.equal(build(59).forecast, null);
  assert.equal(build(60).message, '3시간 뒤 비가 올 수도 있대 ☔');
  assert.equal(build(79).message, '3시간 뒤 비가 올 수도 있대 ☔');
  // 80%를 100%처럼 번역해 "무조건 온다"고 말하지 않는다.
  assert.equal(build(80).message, '3시간 뒤 비 예보가 있어. 우산 챙겨 ☔');
  assert.deepEqual(build(80).forecast, { type: 'rain', probability: 80, inHours: 3 });
});

test('the nearest precipitation wins, not the strongest one', () => {
  // 1시간 뒤 60%와 10시간 뒤 90%가 같이 있으면 먼저 행동을 바꿔야 하는 쪽이 이긴다.
  const briefing = buildWeatherBriefing([
    slot(kst(2026, 8, 22, 12), { tmp: 20, pop: 0, sky: 1 }),
    slot(kst(2026, 8, 22, 13), { tmp: 20, pop: 60, pty: 1 }),
    slot(kst(2026, 8, 22, 22), { tmp: 20, pop: 90, pty: 1 }),
  ], kst(2026, 8, 22, 12, 0));
  assert.deepEqual(briefing.forecast, { type: 'rain', probability: 60, inHours: 1 });
});

test('rain past the twelve-hour window does not change today', () => {
  const briefing = buildWeatherBriefing([
    slot(kst(2026, 8, 22, 12), { tmp: 32, pop: 0, sky: 1 }),
    slot(kst(2026, 8, 23, 1), { tmp: 24, pop: 90, pty: 1 }),
  ], kst(2026, 8, 22, 12, 0));
  assert.equal(briefing.forecast, null);
  assert.equal(briefing.message, '날씨가 많이 더워. 물 많이 마셔 💦');
});

test('the hour count rounds up and never says zero hours', () => {
  const now = kst(2026, 8, 22, 12, 0);
  const at = (hour, minute) => buildWeatherBriefing([
    slot(kst(2026, 8, 22, 12), { tmp: 20, pop: 0, sky: 1 }),
    slot(kst(2026, 8, 22, hour, minute), { tmp: 20, pop: 70, pty: 1 }),
  ], now).forecast.inHours;
  assert.equal(at(12, 30), 1);
  assert.equal(at(14, 10), 3);
  assert.equal(at(13, 0), 1);
  // 슬롯이 정확히 지금이어도 `0시간 뒤`라고 말하지 않는다.
  assert.equal(buildWeatherBriefing([
    slot(kst(2026, 8, 22, 12), { tmp: 20, pop: 70, pty: 1 }),
  ], now).forecast.inHours, 1);
});

test('rain, snow and sleet each get their own sentence', () => {
  const now = kst(2026, 1, 10, 12, 0);
  const build = (pty, pop) => buildWeatherBriefing([
    slot(kst(2026, 1, 10, 12), { tmp: 2, pop: 0, sky: 1 }),
    slot(kst(2026, 1, 10, 14), { tmp: 2, pop, pty }),
  ], now);

  assert.equal(build(1, 70).message, '2시간 뒤 비가 올 수도 있대 ☔');
  assert.equal(build(4, 70).message, '2시간 뒤 비가 올 수도 있대 ☔'); // 소나기도 비다
  assert.equal(build(2, 70).message, '2시간 뒤 비나 눈이 올 수도 있대 🌨️');
  assert.equal(build(3, 70).message, '2시간 뒤 눈이 올 수도 있대 ❄️');
  assert.equal(build(3, 90).message, '2시간 뒤 눈 예보가 있어. 조심해서 다녀 ❄️');
  assert.equal(build(2, 90).message, '2시간 뒤 비나 눈 예보가 있어. 우산 챙겨 🌨️');
});

test('a high POP with no usable PTY is not turned into rain', () => {
  const now = kst(2026, 8, 22, 12, 0);
  for (const pty of [0, null, 9]) {
    const briefing = buildWeatherBriefing([
      slot(kst(2026, 8, 22, 12), { tmp: 20, pop: 0, sky: 1 }),
      slot(kst(2026, 8, 22, 14), { tmp: 20, pop: 90, pty }),
    ], now);
    assert.equal(briefing.message, '2시간 뒤 강수 예보가 있어. 나갈 때 확인해봐 ☔');
    assert.equal(briefing.forecast.type, 'unknown');
  }
});

test('every temperature band has its own line', () => {
  const now = kst(2026, 8, 22, 12, 0);
  const at = tmp => buildWeatherBriefing([slot(kst(2026, 8, 22, 12), { tmp, pop: 0, sky: 1 })], now).message;
  assert.equal(at(35), '오늘 정말 더워. 오래 밖에 있진 마 🥵');
  assert.equal(at(34), '날씨가 많이 더워. 물 많이 마셔 💦');
  assert.equal(at(30), '날씨가 많이 더워. 물 많이 마셔 💦');
  assert.equal(at(29), '조금 더워. 가볍게 입어 ☀️');
  assert.equal(at(26), '조금 더워. 가볍게 입어 ☀️');
  assert.equal(at(25), '날씨 괜찮아. 돌아다니기 좋겠어 🌿');
  assert.equal(at(13), '날씨 괜찮아. 돌아다니기 좋겠어 🌿');
  assert.equal(at(12), '조금 쌀쌀해. 겉옷 챙겨 🧥');
  assert.equal(at(6), '조금 쌀쌀해. 겉옷 챙겨 🧥');
  assert.equal(at(5), '날씨가 꽤 추워. 따뜻하게 입어 🧣');
  assert.equal(at(1), '날씨가 꽤 추워. 따뜻하게 입어 🧣');
  assert.equal(at(0), '밖에 많이 추워. 따뜻하게 입어 🥶');
  assert.equal(at(-4), '밖에 많이 추워. 따뜻하게 입어 🥶');
});

test('the icon reads precipitation first and the sky only after that', () => {
  const icon = (values, now) => buildWeatherBriefing([slot(now, { tmp: 20, pop: 0, ...values })], now).icon;
  const noon = kst(2026, 8, 22, 12);
  const night = kst(2026, 8, 22, 23);
  assert.equal(icon({ pty: 1, sky: 1 }, noon), '🌧️');
  assert.equal(icon({ pty: 3, sky: 1 }, noon), '🌨️');
  assert.equal(icon({ pty: 2, sky: 1 }, noon), '🌨️');
  assert.equal(icon({ pty: 0, sky: 1 }, noon), '☀️');
  assert.equal(icon({ pty: 0, sky: 1 }, night), '🌙');
  assert.equal(icon({ pty: 0, sky: 3 }, noon), '☁️');
  assert.equal(icon({ pty: 0, sky: 4 }, noon), '☁️');
  // 하늘상태를 모르면 맑다고 말하지 않는다.
  assert.equal(icon({ pty: 0, sky: null }, noon), '☁️');
});

test('a masked sea grid has no temperature, so nothing is shown', () => {
  const now = kst(2026, 8, 22, 12, 0);
  assert.throws(
    () => buildWeatherBriefing([slot(kst(2026, 8, 22, 12), { tmp: null, sky: 1 })], now),
    error => error.code === 'WEATHER_FORECAST_UNAVAILABLE',
  );
  assert.throws(
    () => buildWeatherBriefing([], now),
    error => error.code === 'WEATHER_FORECAST_UNAVAILABLE',
  );
});

// --- createWeatherService -------------------------------------------------

function kmaResponse(items, resultCode = '00') {
  return {
    ok: true,
    json: async () => ({ response: { header: { resultCode }, body: { items: { item: items } } } }),
  };
}

function forecastItems(baseTime, fcstTime = '1500') {
  // 슬롯 하나면 판단이 끝난다. 발표본을 구분하려고 기온만 다르게 둔다.
  return [
    { category: 'TMP', fcstDate: '20260822', fcstTime, fcstValue: baseTime === '1400' ? '32' : '31' },
    { category: 'POP', fcstDate: '20260822', fcstTime, fcstValue: '0' },
    { category: 'SKY', fcstDate: '20260822', fcstTime, fcstValue: '1' },
  ];
}

test('the service encodes the decoding key exactly once', async () => {
  const seen = [];
  const service = createWeatherService({
    serviceKey: 'ab+cd/ef==',
    now: () => kst(2026, 8, 22, 14, 20),
    fetchImpl: async url => { seen.push(String(url)); return kmaResponse(forecastItems('1400')); },
  });
  await service.briefing({ lat: 37.5635694444444, lon: 126.980008333333 });

  assert.equal(seen.length, 1);
  assert.match(seen[0], /serviceKey=ab%2Bcd%2Fef%3D%3D/);
  // `%25`가 보이면 이미 인코딩된 키를 한 번 더 감쌌다는 뜻이다.
  assert.doesNotMatch(seen[0], /%25/);
  assert.match(seen[0], /base_date=20260822&base_time=1400/);
  assert.match(seen[0], /nx=60&ny=127/);
  assert.match(seen[0], /dataType=JSON/);
});

test('an empty newest release falls back to the previous one exactly once', async () => {
  const seen = [];
  const service = createWeatherService({
    serviceKey: 'key',
    now: () => kst(2026, 8, 22, 14, 20),
    fetchImpl: async url => {
      const baseTime = new URL(url).searchParams.get('base_time');
      seen.push(baseTime);
      return baseTime === '1400' ? kmaResponse([]) : kmaResponse(forecastItems('1100'));
    },
  });

  const briefing = await service.briefing({ lat: 37.5635694444444, lon: 126.980008333333 });
  assert.equal(briefing.temperature, 31);
  assert.deepEqual(seen, ['1400', '1100']);
});

test('when both releases fail the provider error is what comes out', async () => {
  const attempts = [];
  const service = createWeatherService({
    serviceKey: 'key',
    now: () => kst(2026, 8, 22, 14, 20),
    fetchImpl: async url => {
      attempts.push(new URL(url).searchParams.get('base_time'));
      return { ok: false, status: 500, json: async () => ({}) };
    },
  });

  await assert.rejects(
    () => service.briefing({ lat: 37.5635694444444, lon: 126.980008333333 }),
    error => error.code === 'WEATHER_PROVIDER_FAILED' && error.statusCode === 502,
  );
  // 발표본 폴백이 두 번째 시도다. 그 위에 재시도를 더하지 않는다.
  assert.deepEqual(attempts, ['1400', '1100']);
});

test('a KMA failure code is a failure even when the HTTP call succeeded', async () => {
  const service = createWeatherService({
    serviceKey: 'key',
    now: () => kst(2026, 8, 22, 14, 20),
    fetchImpl: async () => kmaResponse(forecastItems('1400'), '30'), // SERVICE_KEY_IS_NOT_REGISTERED
  });
  await assert.rejects(
    () => service.briefing({ lat: 37.5635694444444, lon: 126.980008333333 }),
    error => error.code === 'WEATHER_PROVIDER_FAILED',
  );
});

test('the guide writes resultCode as 00 and its own example as 0, so both pass', async () => {
  for (const resultCode of ['00', '0']) {
    const service = createWeatherService({
      serviceKey: 'key',
      now: () => kst(2026, 8, 22, 11, 30),
      fetchImpl: async () => kmaResponse(forecastItems('1100', '1200'), resultCode),
    });
    const briefing = await service.briefing({ lat: 37.5635694444444, lon: 126.980008333333 });
    assert.equal(briefing.temperature, 31);
  }
});

test('a coordinate outside the grid never reaches the network', async () => {
  let called = 0;
  const service = createWeatherService({
    serviceKey: 'key',
    now: () => kst(2026, 8, 22, 14, 20),
    fetchImpl: async () => { called += 1; return kmaResponse([]); },
  });
  await assert.rejects(
    () => service.briefing({ lat: 35.6812, lon: 139.7671 }),
    error => error.code === 'WEATHER_FORECAST_UNAVAILABLE',
  );
  assert.equal(called, 0);
});

test('the service refuses to exist without a key', () => {
  assert.throws(() => createWeatherService({ serviceKey: '' }), TypeError);
  assert.throws(() => createWeatherService(), TypeError);
});
