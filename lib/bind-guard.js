'use strict';

/**
 * loopback 밖으로 바인드하면서 API 토큰이 없으면 기동을 거부한다.
 *
 * 예전에는 같은 상황을 `listen` 콜백에서 경고만 했다. 그때는 이미 소켓이 열린 뒤라
 * 경고를 읽기 전에 LAN의 누구나 API를 호출해 키 크레딧을 쓰고 볼트를 읽을 수 있었다.
 * 프론트가 `shared-main`이라는 공용 세션 ID를 쓰므로 대화까지 그대로 노출된다.
 *
 * **실수 한 번으로 인증 전체가 사라지는 구조라 경고가 아니라 실패여야 한다.**
 * `requireApiToken`이 토큰 없는 요청을 통과시키는 것은 이 검사가 "토큰이 없으면
 * loopback뿐"을 보장한다는 전제 위에 서 있다.
 */

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);

/** 이 호스트로 바인드하면 loopback 밖에서 닿을 수 있는가. */
function isLoopbackHost(host) {
  return LOOPBACK_HOSTS.has(String(host ?? '').trim());
}

// Socket loopback 여부와 별개로 검사한다. 프록시의 forwarded 헤더는 신뢰하지 않는다.
function hasLocalApiOrigin(req) {
  const host = req.get('Host') || '';
  const hostname = host.match(/^(\[[^\]]+\]|[^:]+)(?::\d+)?$/)?.[1];
  if (!hostname || !isLoopbackHost(hostname.replace(/^\[|\]$/g, '').toLowerCase())) return false;
  try {
    const targetOrigin = new URL(`${req.protocol}://${host}`).origin;
    const origin = req.get('Origin');
    const site = req.get('Sec-Fetch-Site');
    return (origin === undefined || origin === targetOrigin)
      && (site === undefined || site === 'same-origin' || site === 'none');
  } catch {
    return false;
  }
}

/**
 * 위반이면 사유를 담아 던진다. 통과면 아무 값도 돌려주지 않는다.
 *
 * @param {string} host  `app.listen`에 넘길 호스트
 * @param {string} token `API_TOKEN` (빈 문자열이면 없음)
 */
function assertBindIsAuthenticated(host, token) {
  if (isLoopbackHost(host) || String(token ?? '')) return;
  throw new Error(
    `HOST=${host}로 loopback 밖에 바인드하려면 API_TOKEN이 필요합니다.\n` +
    '   토큰이 없으면 같은 네트워크의 누구나 API를 호출해 키 크레딧을 쓰고 볼트를 읽습니다.\n' +
    '   .env에 API_TOKEN을 설정하거나 HOST=127.0.0.1로 두세요.'
  );
}

module.exports = { assertBindIsAuthenticated, isLoopbackHost, hasLocalApiOrigin, LOOPBACK_HOSTS };
