'use strict';

// XION 홈 머리줄의 날씨 브리핑(설계 `docs/xion-weather-design.md`).
//
// 여기에 있는 것은 KMA adapter 하나뿐이다. provider interface·location service·
// forecast repository를 만들지 않는다(설계 17절). 향후 해외 provider가 붙더라도
// `toKmaGrid`는 이 파일 안에 남는다.
//
// **판단은 전부 결정론적 규칙이다.** 문구를 LLM에게 시키지 않는다 — 같은 예보에
// 매번 다른 말이 나오면 사용자가 문구의 차이를 예보의 차이로 읽는다.

// 단기예보 조회. 활용가이드의 Call Back URL 그대로다.
const KMA_FORECAST_URL = 'http://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getVilageFcst';
const REQUEST_TIMEOUT_MS = 8000;
// 12시간치만 쓰지만 응답 정렬을 계약할 수 없다. 넉넉히 받아 서버에서 자른다.
const FORECAST_ROWS = 1000;

// KST는 1988년 이후 DST가 없다. Intl 없이 고정 오프셋으로 계산해도 정확하고,
// 테스트가 ICU 데이터에 기대지 않는다.
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

// 단기예보 발표시각 8회. 활용가이드는 각 발표의 API 제공을 `HH:10 이후`로 적는다.
// 15분은 그 10분에 얹은 여유다(설계 9절).
const KMA_BASE_HOURS = [2, 5, 8, 11, 14, 17, 20, 23];
const BASE_AVAILABLE_AFTER_MIN = 15;

// DFS 격자(Lambert Conformal Conic). 기상청 격자 변환 규칙 그대로다.
const RE = 6371.00877;
const GRID = 5.0;
const SLAT1 = 30.0;
const SLAT2 = 60.0;
const OLON = 126.0;
const OLAT = 38.0;
const XO = 43;
const YO = 136;

// 격자 범위. 밖이면 KMA를 부르지 않는다(설계 8·24절).
const NX_MAX = 149;
const NY_MAX = 253;

// 앞으로 이만큼만 본다. 그 밖의 비는 지금 행동을 바꾸지 않는다.
const FORECAST_WINDOW_MS = 12 * 60 * 60 * 1000;
// 60 미만은 브리핑하지 않고, 80부터 표현이 세진다(설계 11절).
const POP_MENTION = 60;
const POP_STRONG = 80;

// 강수형태(PTY) 단기 코드: 없음(0) 비(1) 비/눈(2) 눈(3) 소나기(4).
const PTY_KINDS = { 1: 'rain', 2: 'mixed', 3: 'snow', 4: 'rain' };
// 하늘상태(SKY) 코드: 맑음(1) 구름많음(3) 흐림(4).
const SKY_CLEAR = 1;

// 우리가 읽는 요소는 넷뿐이다. 습도·풍속·강수량은 v1에서 읽지 않는다(설계 2절).
const USED_CATEGORIES = new Set(['TMP', 'POP', 'PTY', 'SKY']);

function weatherError(message, statusCode, code) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function invalidLocation() {
  return weatherError('위치가 올바르지 않습니다.', 400, 'WEATHER_INVALID_LOCATION');
}

function forecastUnavailable() {
  return weatherError('예보를 찾지 못했습니다.', 502, 'WEATHER_FORECAST_UNAVAILABLE');
}

function providerFailed() {
  return weatherError('날씨를 불러오지 못했습니다.', 502, 'WEATHER_PROVIDER_FAILED');
}

// **빈 값을 0으로 읽지 않는다.** `Number('')`는 0이라 좌표가 통째로 빠진 요청이
// 조용히 위도 0·경도 0이 된다.
function toCoordinate(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const text = String(value ?? '').trim();
  if (!text) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * WGS84 위·경도를 기상청 DFS 격자로 옮긴다.
 *
 * **격자 밖은 여기서 끝낸다.** 화면에 지역 이름이 없으므로 다른 동네 예보가
 * 조용히 나오면 사용자가 눈치챌 방법이 없다(설계 8절).
 */
function toKmaGrid(lat, lon) {
  const latitude = toCoordinate(lat);
  const longitude = toCoordinate(lon);
  if (latitude === null || longitude === null) throw invalidLocation();
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) throw invalidLocation();

  const DEGRAD = Math.PI / 180;
  const re = RE / GRID;
  const slat1 = SLAT1 * DEGRAD;
  const slat2 = SLAT2 * DEGRAD;
  const olon = OLON * DEGRAD;
  const olat = OLAT * DEGRAD;

  let sn = Math.tan(Math.PI * 0.25 + slat2 * 0.5) / Math.tan(Math.PI * 0.25 + slat1 * 0.5);
  sn = Math.log(Math.cos(slat1) / Math.cos(slat2)) / Math.log(sn);
  let sf = Math.tan(Math.PI * 0.25 + slat1 * 0.5);
  sf = (sf ** sn) * Math.cos(slat1) / sn;
  let ro = Math.tan(Math.PI * 0.25 + olat * 0.5);
  ro = re * sf / (ro ** sn);

  let ra = Math.tan(Math.PI * 0.25 + latitude * DEGRAD * 0.5);
  ra = re * sf / (ra ** sn);
  let theta = longitude * DEGRAD - olon;
  if (theta > Math.PI) theta -= 2 * Math.PI;
  if (theta < -Math.PI) theta += 2 * Math.PI;
  theta *= sn;

  const nx = Math.floor(ra * Math.sin(theta) + XO + 0.5);
  const ny = Math.floor(ro - ra * Math.cos(theta) + YO + 0.5);
  if (nx < 1 || nx > NX_MAX || ny < 1 || ny > NY_MAX) throw forecastUnavailable();
  return { nx, ny };
}

function kstParts(date) {
  const shifted = new Date(date.getTime() + KST_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
  };
}

function formatBaseDate(parts, dayOffset) {
  const shifted = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + dayOffset));
  return [
    shifted.getUTCFullYear(),
    String(shifted.getUTCMonth() + 1).padStart(2, '0'),
    String(shifted.getUTCDate()).padStart(2, '0'),
  ].join('');
}

/**
 * 지금 KST에서 이미 제공되고 있는 발표본을 최신 순으로 최대 둘 돌려준다.
 *
 * **후보가 둘인 이유는 재시도가 아니라 침묵이다.** 15분 margin이 기상청 지연을
 * 항상 덮는다는 확증이 없는데 실패는 `숨김`이라, 후보가 하나면 발표 경계마다
 * 날씨가 조용히 사라지고 아무도 눈치채지 못한다(설계 9절).
 */
function selectKmaBaseTimes(now) {
  const parts = kstParts(now instanceof Date ? now : new Date(now));
  const minutes = parts.hour * 60 + parts.minute;
  const candidates = [];
  for (let index = KMA_BASE_HOURS.length - 1; index >= 0; index -= 1) {
    const hour = KMA_BASE_HOURS[index];
    if (minutes >= hour * 60 + BASE_AVAILABLE_AFTER_MIN) candidates.push({ dayOffset: 0, hour });
  }
  // 어제 발표본은 전부 제공이 끝난 것들이다.
  for (let index = KMA_BASE_HOURS.length - 1; index >= 0; index -= 1) {
    candidates.push({ dayOffset: -1, hour: KMA_BASE_HOURS[index] });
  }
  return candidates.slice(0, 2).map(candidate => ({
    baseDate: formatBaseDate(parts, candidate.dayOffset),
    baseTime: `${String(candidate.hour).padStart(2, '0')}00`,
  }));
}

function parseFcstValue(value) {
  const parsed = Number.parseInt(String(value ?? '').trim(), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function fcstTimeToMs(fcstDate, fcstTime) {
  const date = /^(\d{4})(\d{2})(\d{2})$/.exec(String(fcstDate || ''));
  const time = /^(\d{2})(\d{2})$/.exec(String(fcstTime || ''));
  if (!date || !time) return null;
  return Date.UTC(
    Number(date[1]), Number(date[2]) - 1, Number(date[3]),
    Number(time[1]), Number(time[2]),
  ) - KST_OFFSET_MS;
}

/**
 * category별 flat row를 시간 단위로 묶는다. 프론트에 KMA 원본 배열을 넘기지
 * 않는다(설계 10절) — 넘기면 문구 규칙이 두 곳에 생긴다.
 */
function normalizeForecast(items) {
  if (!Array.isArray(items)) throw forecastUnavailable();
  const slots = new Map();
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const category = String(item.category || '').trim();
    if (!USED_CATEGORIES.has(category)) continue;
    const time = fcstTimeToMs(item.fcstDate, item.fcstTime);
    if (time === null) continue;
    if (!slots.has(time)) slots.set(time, { time, tmp: null, pop: null, pty: null, sky: null });
    const slot = slots.get(time);
    const value = parseFcstValue(item.fcstValue);
    if (category === 'TMP') slot.tmp = value;
    else if (category === 'POP') slot.pop = value;
    else if (category === 'PTY') slot.pty = value;
    else slot.sky = value;
  }
  return [...slots.values()].sort((left, right) => left.time - right.time);
}

function precipitationKind(pty) {
  return PTY_KINDS[pty] || null;
}

// 낮과 밤은 emoji 하나를 가르는 UI 경계일 뿐 기상 기준이 아니다.
function isDaytime(timeMs) {
  const hour = kstParts(new Date(timeMs)).hour;
  return hour >= 6 && hour < 19;
}

function currentIcon(slot) {
  const kind = precipitationKind(slot.pty);
  if (kind === 'rain') return '🌧️';
  if (kind === 'mixed' || kind === 'snow') return '🌨️';
  if (slot.sky === SKY_CLEAR) return isDaytime(slot.time) ? '☀️' : '🌙';
  // 하늘상태를 모르면 맑다고 말하지 않는다. emoji는 장식이라 여기서 멈춰도 된다.
  return '☁️';
}

function temperatureMessage(tmp) {
  if (tmp >= 35) return '오늘 정말 더워. 오래 밖에 있진 마 🥵';
  if (tmp >= 30) return '날씨가 많이 더워. 물 많이 마셔 💦';
  if (tmp >= 26) return '조금 더워. 가볍게 입어 ☀️';
  if (tmp >= 13) return '날씨 괜찮아. 돌아다니기 좋겠어 🌿';
  if (tmp >= 6) return '조금 쌀쌀해. 겉옷 챙겨 🧥';
  if (tmp >= 1) return '날씨가 꽤 추워. 따뜻하게 입어 🧣';
  return '밖에 많이 추워. 따뜻하게 입어 🥶';
}

function precipitationMessage(kind, pop, inHours) {
  const prefix = `${inHours}시간 뒤 `;
  // POP >= 60인데 PTY가 강수형태를 주지 않으면 비라고 단정하지 않는다(설계 12절).
  if (!kind) return `${prefix}강수 예보가 있어. 나갈 때 확인해봐 ☔`;
  if (pop < POP_STRONG) {
    // 80%를 100%처럼 번역하지 않는다. 여기는 아직 가능성이다.
    if (kind === 'snow') return `${prefix}눈이 올 수도 있대 ❄️`;
    if (kind === 'mixed') return `${prefix}비나 눈이 올 수도 있대 🌨️`;
    return `${prefix}비가 올 수도 있대 ☔`;
  }
  if (kind === 'snow') return `${prefix}눈 예보가 있어. 조심해서 다녀 ❄️`;
  if (kind === 'mixed') return `${prefix}비나 눈 예보가 있어. 우산 챙겨 🌨️`;
  return `${prefix}비 예보가 있어. 우산 챙겨 ☔`;
}

/**
 * 한 번에 메시지 하나만 만든다.
 *
 * **우선순위의 기준은 확률 등급이 아니라 시각이다**(설계 15절). 1시간 뒤 60%와
 * 10시간 뒤 90%가 같이 있으면 가까운 60%가 이긴다 — 먼저 행동을 바꿔야 하는 것이
 * 그쪽이다.
 */
function buildWeatherBriefing(slots, now) {
  const nowMs = (now instanceof Date ? now : new Date(now)).getTime();
  const ahead = (Array.isArray(slots) ? slots : []).filter(slot => slot.time >= nowMs);
  const current = ahead[0];
  // TMP가 없으면 보여줄 것이 없다. 해상 격자는 기온·강수확률이 마스킹된다.
  if (!current || current.tmp === null) throw forecastUnavailable();

  const candidate = ahead.find(slot => (
    slot.time <= nowMs + FORECAST_WINDOW_MS && slot.pop !== null && slot.pop >= POP_MENTION
  )) || null;

  if (!candidate) {
    return {
      temperature: current.tmp,
      icon: currentIcon(current),
      message: temperatureMessage(current.tmp),
      forecast: null,
    };
  }

  // 분 단위는 홈 브리핑에 필요하지 않다. 올림하고 최소 1시간으로 둔다(설계 11.4).
  const inHours = Math.max(1, Math.ceil((candidate.time - nowMs) / (60 * 60 * 1000)));
  const kind = precipitationKind(candidate.pty);
  return {
    temperature: current.tmp,
    icon: currentIcon(current),
    message: precipitationMessage(kind, candidate.pop, inHours),
    forecast: { type: kind || 'unknown', probability: candidate.pop, inHours },
  };
}

function buildForecastUrl(serviceKey, { baseDate, baseTime, nx, ny }) {
  const url = new URL(KMA_FORECAST_URL);
  // 명세의 serviceKey는 `인증키(URL Encode)`다. 환경변수에는 Decoding key를 넣고
  // 여기서 딱 한 번 encode한다 — Encoding key를 넣으면 이중 인코딩이 되어
  // `SERVICE_KEY_IS_NOT_REGISTERED`가 난다(설계 18절).
  url.searchParams.set('serviceKey', serviceKey);
  url.searchParams.set('numOfRows', String(FORECAST_ROWS));
  url.searchParams.set('pageNo', '1');
  url.searchParams.set('dataType', 'JSON');
  url.searchParams.set('base_date', baseDate);
  url.searchParams.set('base_time', baseTime);
  url.searchParams.set('nx', String(nx));
  url.searchParams.set('ny', String(ny));
  return url;
}

// 명세는 `00`, 예제는 `0`으로 적는다. 둘 다 정상으로 받는다.
function isNormalResult(code) {
  const value = String(code ?? '').trim();
  return value === '00' || value === '0';
}

/**
 * `fetchImpl`·`now`를 주입받는다(`lib/paper-search.js`와 같은 방식).
 *
 * **별도 재시도는 없다.** 발표본 폴백이 이미 두 번째 시도이고, 그 위에 재시도를
 * 더하면 홈 한 번에 KMA를 네 번 부른다.
 */
function createWeatherService({ serviceKey, fetchImpl = fetch, now = () => new Date() } = {}) {
  const key = String(serviceKey || '').trim();
  if (!key) throw new TypeError('KMA_SERVICE_KEY가 필요합니다.');

  async function fetchForecast(base, grid) {
    const url = buildForecastUrl(key, { ...base, ...grid });
    let response;
    try {
      response = await fetchImpl(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    } catch {
      throw providerFailed();
    }
    if (!response.ok) throw providerFailed();
    let data;
    try {
      data = await response.json();
    } catch {
      throw providerFailed();
    }
    const header = data?.response?.header;
    if (!isNormalResult(header?.resultCode)) throw providerFailed();
    return normalizeForecast(data?.response?.body?.items?.item);
  }

  async function briefing({ lat, lon }) {
    const grid = toKmaGrid(lat, lon);
    const bases = selectKmaBaseTimes(now());
    let lastError = providerFailed();
    for (const base of bases) {
      try {
        return buildWeatherBriefing(await fetchForecast(base, grid), now());
      } catch (error) {
        // 이 발표본이 비어 있으면 직전 발표본으로 한 번 내려간다. 최대 3시간 전
        // 자료지만 12시간 창의 강수 판단에는 충분하고, 없는 것보다 낫다.
        lastError = error;
      }
    }
    throw lastError;
  }

  return { briefing };
}

module.exports = {
  toCoordinate,
  toKmaGrid,
  selectKmaBaseTimes,
  normalizeForecast,
  buildWeatherBriefing,
  createWeatherService,
  weatherError,
};
