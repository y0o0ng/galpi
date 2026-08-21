'use strict';

// XION 홈이 읽는 read-only endpoint 하나. 메일·뉴스와 같은 `register...Routes()`
// 계약이다(설계 17절).
//
// **문구 규칙은 서버에만 있다.** 응답은 이미 다 만들어진 온도·emoji·문장이라
// 프론트가 POP 문턱이나 기온 표를 다시 구현하지 않는다(설계 16절).

const { toCoordinate } = require('./weather');

// **응답 문구는 여기 있는 것뿐이다.** 도메인 오류의 `message`를 그대로 내보내면
// 언젠가 KMA 원문이나 좌표를 담은 오류가 그대로 사용자에게 나간다(설계 16절).
const MESSAGES = Object.freeze({
  WEATHER_DISABLED: '날씨가 아직 활성화되지 않았습니다.',
  WEATHER_INVALID_LOCATION: '위치가 올바르지 않습니다.',
  WEATHER_FORECAST_UNAVAILABLE: '예보를 찾지 못했습니다.',
  WEATHER_PROVIDER_FAILED: '날씨를 불러오지 못했습니다.',
});

function fail(res, statusCode, code) {
  return res.status(statusCode).json({
    error: MESSAGES[code] || MESSAGES.WEATHER_PROVIDER_FAILED,
    code,
  });
}

// 위도·경도의 물리적 범위. 격자 밖 판정은 여기가 아니라 `toKmaGrid`가 한다 —
// 대한민국 밖은 잘못된 입력이 아니라 예보가 없는 것이다(설계 24절).
function parseCoordinate(value, limit) {
  const parsed = toCoordinate(value);
  if (parsed === null || parsed < -limit || parsed > limit) return null;
  return parsed;
}

function registerWeatherRoutes({ app, config, service }) {
  if (!app?.get) throw new TypeError('Express app이 필요합니다.');
  if (!config || typeof config !== 'object') throw new TypeError('Weather 설정이 필요합니다.');

  function guard(res) {
    if (config.enabled === true && service?.briefing) return false;
    // 홈은 이 503을 오류로 그리지 않는다. 플래그가 꺼진 것뿐이라 사람이 고칠 것이 없다.
    fail(res, 503, 'WEATHER_DISABLED');
    return true;
  }

  app.get('/api/weather', async (req, res) => {
    if (guard(res)) return;
    const lat = parseCoordinate(req.query?.lat, 90);
    const lon = parseCoordinate(req.query?.lon, 180);
    if (lat === null || lon === null) return fail(res, 400, 'WEATHER_INVALID_LOCATION');
    try {
      // 성공은 HTTP 200이고 `success` 필드를 두지 않는다. 메일·뉴스 어디에도 없다.
      return res.json(await service.briefing({ lat, lon }));
    } catch (error) {
      // 좌표도 raw KMA 응답도 로그에 남기지 않는다(설계 6·16절).
      const code = MESSAGES[error?.code] ? error.code : 'WEATHER_PROVIDER_FAILED';
      console.error(`날씨 조회 오류: ${code}`);
      return fail(res, code === 'WEATHER_INVALID_LOCATION' ? 400 : 502, code);
    }
  });
}

module.exports = { registerWeatherRoutes };
