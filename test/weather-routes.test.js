'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { registerWeatherRoutes } = require('../lib/weather-routes');
const { weatherError } = require('../lib/weather');

// Express 없이 등록된 핸들러만 꺼내 쓰는 최소 대역(`test/mail-routes.test.js`와 같다).
function createFakeApp() {
  const routes = new Map();
  return {
    get(path, handler) { routes.set(`GET ${path}`, handler); },
    post(path, handler) { routes.set(`POST ${path}`, handler); },
    async call(key, req = {}) {
      req.query = req.query || {};
      const handler = routes.get(key);
      if (!handler) throw new Error(`등록되지 않은 route: ${key}`);
      let status = 200;
      let body = null;
      const res = {
        status(code) { status = code; return res; },
        json(payload) { body = payload; return res; },
      };
      await handler(req, res);
      return { status, body };
    },
    has(key) { return routes.has(key); },
  };
}

const BRIEFING = Object.freeze({
  temperature: 27,
  icon: '🌧️',
  message: '3시간 뒤 비가 올 수도 있대 ☔',
  forecast: { type: 'rain', probability: 70, inHours: 3 },
});

function fakeService(impl) {
  return { briefing: impl || (async () => BRIEFING) };
}

// 로그에 좌표나 provider 원문이 새는지 보려면 실제로 받아 봐야 한다.
async function captureErrorLog(run) {
  const lines = [];
  const original = console.error;
  console.error = (...args) => { lines.push(args.join(' ')); };
  try {
    return { result: await run(), lines };
  } finally {
    console.error = original;
  }
}

test('the route is registered even while the flag is off', () => {
  const app = createFakeApp();
  registerWeatherRoutes({ app, config: { enabled: false }, service: fakeService() });
  assert.equal(app.has('GET /api/weather'), true);
});

test('a disabled flag is 503, not an error the user can fix', async () => {
  const app = createFakeApp();
  registerWeatherRoutes({ app, config: { enabled: false }, service: fakeService() });

  const response = await app.call('GET /api/weather', { query: { lat: '37.5', lon: '127.0' } });
  assert.equal(response.status, 503);
  assert.equal(response.body.code, 'WEATHER_DISABLED');
});

test('an enabled flag without a service is still off', async () => {
  // 키가 없으면 부를 수 없다. 켜진 척하고 502를 내면 사람이 고칠 것을 찾게 된다.
  const app = createFakeApp();
  registerWeatherRoutes({ app, config: { enabled: true }, service: null });

  const response = await app.call('GET /api/weather', { query: { lat: '37.5', lon: '127.0' } });
  assert.equal(response.status, 503);
  assert.equal(response.body.code, 'WEATHER_DISABLED');
});

test('coordinates that are missing, blank or impossible are rejected before KMA', async () => {
  let called = 0;
  const app = createFakeApp();
  registerWeatherRoutes({
    app,
    config: { enabled: true },
    service: fakeService(async () => { called += 1; return BRIEFING; }),
  });

  const bad = [
    {},                              // 좌표 없음
    { lat: '', lon: '' },            // 빈 문자열은 0이 아니다
    { lat: 'seoul', lon: '127.0' },  // NaN
    { lat: '37.5' },                 // 한쪽만
    { lat: '91', lon: '127.0' },     // 범위 밖
    { lat: '37.5', lon: '-181' },
  ];
  for (const query of bad) {
    const response = await app.call('GET /api/weather', { query });
    assert.equal(response.status, 400, JSON.stringify(query));
    assert.equal(response.body.code, 'WEATHER_INVALID_LOCATION');
  }
  assert.equal(called, 0);
});

test('a normal request answers with the finished briefing and no success field', async () => {
  const seen = [];
  const app = createFakeApp();
  registerWeatherRoutes({
    app,
    config: { enabled: true },
    service: fakeService(async location => { seen.push(location); return BRIEFING; }),
  });

  const response = await app.call('GET /api/weather', { query: { lat: '37.5665', lon: '126.978' } });
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, BRIEFING);
  // 성공은 HTTP 200이다. 메일·뉴스 어디에도 `success`가 없다.
  assert.equal('success' in response.body, false);
  // 문구는 서버가 다 만들어 보낸다. 프론트가 POP 문턱을 다시 구현하지 않는다.
  assert.equal(typeof response.body.message, 'string');
  assert.deepEqual(seen, [{ lat: 37.5665, lon: 126.978 }]);
});

test('a briefing with no precipitation keeps the same shape', async () => {
  const app = createFakeApp();
  const clear = { temperature: 32, icon: '☀️', message: '날씨가 많이 더워. 물 많이 마셔 💦', forecast: null };
  registerWeatherRoutes({ app, config: { enabled: true }, service: fakeService(async () => clear) });

  const response = await app.call('GET /api/weather', { query: { lat: '37.5', lon: '127.0' } });
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, clear);
});

test('each domain failure keeps its own status and code', async () => {
  const cases = [
    [weatherError('실패', 502, 'WEATHER_PROVIDER_FAILED'), 502, 'WEATHER_PROVIDER_FAILED'],
    [weatherError('없음', 502, 'WEATHER_FORECAST_UNAVAILABLE'), 502, 'WEATHER_FORECAST_UNAVAILABLE'],
    [weatherError('위치', 400, 'WEATHER_INVALID_LOCATION'), 400, 'WEATHER_INVALID_LOCATION'],
  ];
  for (const [thrown, status, code] of cases) {
    const app = createFakeApp();
    registerWeatherRoutes({
      app,
      config: { enabled: true },
      service: fakeService(async () => { throw thrown; }),
    });
    const { result } = await captureErrorLog(
      () => app.call('GET /api/weather', { query: { lat: '37.5', lon: '127.0' } }),
    );
    assert.equal(result.status, status);
    assert.equal(result.body.code, code);
  }
});

test('an unexpected failure falls back to the provider error rather than leaking it', async () => {
  const app = createFakeApp();
  registerWeatherRoutes({
    app,
    config: { enabled: true },
    service: fakeService(async () => { throw new Error('ECONNREFUSED 127.0.0.1:80'); }),
  });

  const { result } = await captureErrorLog(
    () => app.call('GET /api/weather', { query: { lat: '37.5', lon: '127.0' } }),
  );
  assert.equal(result.status, 502);
  assert.equal(result.body.code, 'WEATHER_PROVIDER_FAILED');
  assert.equal(result.body.error, '날씨를 불러오지 못했습니다.');
  assert.doesNotMatch(result.body.error, /ECONNREFUSED/);
});

test('neither the response nor the log carries the key, the coordinates or the raw payload', async () => {
  const app = createFakeApp();
  const leaky = weatherError('KMA said <resultMsg>SERVICE_KEY_IS_NOT_REGISTERED</resultMsg>', 502, 'WEATHER_PROVIDER_FAILED');
  registerWeatherRoutes({
    app,
    config: { enabled: true },
    service: fakeService(async () => { throw leaky; }),
  });

  const { result, lines } = await captureErrorLog(
    () => app.call('GET /api/weather', { query: { lat: '37.5665', lon: '126.978' } }),
  );
  const written = [JSON.stringify(result.body), ...lines].join('\n');
  for (const secret of ['37.5665', '126.978', 'resultMsg', 'SERVICE_KEY']) {
    assert.equal(written.includes(secret), false, secret);
  }
  // 로그에 남는 것은 코드 한 줄뿐이다.
  assert.deepEqual(lines, ['날씨 조회 오류: WEATHER_PROVIDER_FAILED']);
});

test('registration refuses arguments it cannot work with', () => {
  assert.throws(() => registerWeatherRoutes({ config: {}, service: fakeService() }), TypeError);
  assert.throws(() => registerWeatherRoutes({ app: createFakeApp(), service: fakeService() }), TypeError);
});
