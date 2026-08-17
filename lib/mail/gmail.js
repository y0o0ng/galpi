'use strict';

// Gmail provider. 메일을 정확하게 가져오고 historyId 커서를 해석하는 것까지만 한다.
// identity 판정·저장·알림은 agent와 store의 몫이다(설계 22절 책임 경계).

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const API_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';
// access token은 게시 상태와 무관하게 3600초로 만료된다(설계 20.1 실측).
// 만료된 뒤 401을 보고 고치지 않고 이만큼 미리 갈아끼운다.
const REFRESH_SKEW_SECONDS = 300;
const DEFAULT_RECENT_WINDOW = 200;
const METADATA_HEADERS = ['Message-ID', 'From', 'To', 'Subject', 'Date', 'References', 'In-Reply-To'];

// 받은편지함만 본다. history는 보낸메일·초안·스팸·휴지통 변경도 함께 주므로
// 내가 쓴 메일이 LLM·Push 파이프라인에 들어가지 않게 두 겹으로 막는다(설계 6.1).
const EXCLUDED_LABELS = new Set(['SENT', 'DRAFT', 'SPAM', 'TRASH', 'CHAT']);
const REQUIRED_LABEL = 'INBOX';

const SYNC_MODES = {
  BASELINE: 'baseline',
  INCREMENTAL: 'incremental',
  RESYNC: 'resync',
};

function gmailError(message, code, { retryable = false, status = null } = {}) {
  const error = new Error(message);
  error.code = code;
  error.retryable = retryable;
  if (status !== null) error.statusCode = status;
  return error;
}

// 인증 실패는 재시도로 풀리지 않는다. 네트워크 오류처럼 backoff로 다루면 구글을
// 계속 때리면서 인증 문제를 사용자에게 영영 알리지 않게 된다(설계 20.1).
const NON_RETRYABLE_OAUTH_ERRORS = new Set([
  'invalid_grant', 'invalid_client', 'unauthorized_client',
]);

function isRetryableStatus(status) {
  return status === 408 || status === 429 || (status >= 500 && status < 600);
}

/**
 * access token을 들고 있는 자리. 만료 전에 미리 갈고, 동시에 여러 번 갈지 않는다.
 * 30초 worker tick과 5분 sync가 겹쳐도 refresh 요청은 하나만 나간다.
 */
function createGoogleTokenSource(options = {}) {
  const credentials = options.credentials || {};
  const fetchImpl = typeof options.fetch === 'function' ? options.fetch : globalThis.fetch;
  const clock = typeof options.now === 'function' ? options.now : () => Math.floor(Date.now() / 1000);
  if (typeof fetchImpl !== 'function') throw new TypeError('fetch 구현이 필요합니다.');

  // access token은 메모리에만 둔다. DB·Vault·로그에 넣지 않는다(설계 20.3).
  let accessToken = null;
  let expiresAt = 0;
  let inFlight = null;

  async function requestToken() {
    const body = new URLSearchParams({
      client_id: credentials.clientId || '',
      client_secret: credentials.clientSecret || '',
      refresh_token: credentials.refreshToken || '',
      grant_type: 'refresh_token',
    });
    const response = await fetchImpl(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const reason = String(payload?.error || 'token_request_failed');
      if (NON_RETRYABLE_OAUTH_ERRORS.has(reason)) {
        throw gmailError(
          'Gmail 재인증이 필요합니다.', 'MAIL_AUTH_REQUIRED',
          { retryable: false, status: response.status },
        );
      }
      throw gmailError(
        `Gmail 토큰 갱신 실패: ${reason}`, 'MAIL_TOKEN_REFRESH_FAILED',
        { retryable: isRetryableStatus(response.status), status: response.status },
      );
    }
    const token = payload?.access_token;
    if (!token) {
      throw gmailError('Gmail 토큰 응답에 access_token이 없습니다.', 'MAIL_TOKEN_REFRESH_FAILED');
    }
    accessToken = String(token);
    const lifetime = Number(payload?.expires_in);
    expiresAt = clock() + (Number.isFinite(lifetime) && lifetime > 0 ? lifetime : 3600);
    // refresh grant는 보통 새 refresh token을 주지 않는다. 있을 때만 바꾼다.
    if (payload?.refresh_token) credentials.refreshToken = String(payload.refresh_token);
    return accessToken;
  }

  return {
    async getAccessToken({ force = false } = {}) {
      if (!force && accessToken && clock() < expiresAt - REFRESH_SKEW_SECONDS) return accessToken;
      if (inFlight) return inFlight;
      inFlight = requestToken().finally(() => { inFlight = null; });
      return inFlight;
    },
    // 테스트와 관측용. 토큰 값은 내보내지 않는다.
    describe() {
      return { hasToken: Boolean(accessToken), expiresAt };
    },
  };
}

function headerMap(payload) {
  const map = new Map();
  for (const header of payload?.headers || []) {
    if (header?.name) map.set(String(header.name).toLowerCase(), String(header.value ?? ''));
  }
  return map;
}

function parseAddress(value) {
  const text = String(value ?? '').trim();
  if (!text) return { name: null, address: null };
  const angled = /^(.*)<([^>]+)>\s*$/.exec(text);
  if (!angled) return { name: null, address: text.toLowerCase() };
  const name = angled[1].trim().replace(/^"|"$/g, '') || null;
  return { name, address: angled[2].trim().toLowerCase() };
}

function parseAddressList(value) {
  return String(value ?? '')
    .split(',')
    .map(part => parseAddress(part).address)
    .filter(Boolean);
}

// history 필터를 통과해도 실제 메시지 라벨을 다시 확인한다. 필터 하나에만 기대면
// 조용히 새는 경로가 생긴다.
function isCollectableMessage(labelIds) {
  const labels = Array.isArray(labelIds) ? labelIds.map(String) : [];
  if (!labels.includes(REQUIRED_LABEL)) return false;
  return !labels.some(label => EXCLUDED_LABELS.has(label));
}

function normalizeMessage(message) {
  const headers = headerMap(message?.payload);
  const internalDate = Number(message?.internalDate);
  return {
    gmailMessageId: String(message?.id ?? ''),
    threadId: message?.threadId ? String(message.threadId) : null,
    labelIds: Array.isArray(message?.labelIds) ? message.labelIds.map(String) : [],
    messageId: headers.get('message-id') || null,
    references: headers.get('references') || null,
    inReplyTo: headers.get('in-reply-to') || null,
    from: parseAddress(headers.get('from')),
    to: parseAddressList(headers.get('to')),
    subject: headers.get('subject') || null,
    receivedAt: Number.isFinite(internalDate) ? Math.floor(internalDate / 1000) : null,
  };
}

function createGmailProvider(options = {}) {
  const fetchImpl = typeof options.fetch === 'function' ? options.fetch : globalThis.fetch;
  const tokenSource = options.tokenSource;
  const recentWindow = Number.isSafeInteger(options.recentWindow) && options.recentWindow > 0
    ? options.recentWindow
    : DEFAULT_RECENT_WINDOW;
  if (typeof fetchImpl !== 'function') throw new TypeError('fetch 구현이 필요합니다.');
  if (typeof tokenSource?.getAccessToken !== 'function') throw new TypeError('token source가 필요합니다.');

  async function call(path, { retryOn401 = true } = {}) {
    const token = await tokenSource.getAccessToken();
    const response = await fetchImpl(`${API_BASE}${path}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (response.status === 401 && retryOn401) {
      // 토큰이 우리 시계보다 먼저 죽은 경우다. 한 번만 강제로 갈고 다시 시도한다.
      await tokenSource.getAccessToken({ force: true });
      return call(path, { retryOn401: false });
    }
    if (response.status === 404) {
      throw gmailError('Gmail history 커서가 만료됐습니다.', 'MAIL_HISTORY_GONE', { status: 404 });
    }
    if (!response.ok) {
      throw gmailError(
        `Gmail API 실패: HTTP ${response.status}`, 'MAIL_API_FAILED',
        { retryable: isRetryableStatus(response.status), status: response.status },
      );
    }
    return response.json();
  }

  async function fetchMessage(id) {
    const query = METADATA_HEADERS.map(name => `metadataHeaders=${encodeURIComponent(name)}`).join('&');
    return call(`/messages/${encodeURIComponent(id)}?format=metadata&${query}`);
  }

  // 페이지를 끝까지 소비하고, 마지막 응답의 historyId를 커서 후보로 돌려준다.
  // 커서를 옮기는 것은 저장이 끝난 뒤 agent가 한다.
  async function collectHistory(startHistoryId) {
    const ids = new Set();
    let pageToken = null;
    let historyId = String(startHistoryId);
    let pages = 0;
    do {
      const params = new URLSearchParams({
        startHistoryId: String(startHistoryId),
        historyTypes: 'messageAdded',
        labelId: REQUIRED_LABEL,
      });
      if (pageToken) params.set('pageToken', pageToken);
      const page = await call(`/history?${params.toString()}`);
      pages += 1;
      for (const record of page?.history || []) {
        for (const added of record?.messagesAdded || []) {
          const message = added?.message;
          if (!message?.id) continue;
          // history가 준 라벨로 1차로 거른다. 2차 확인은 메시지를 받은 뒤에 한다.
          if (message.labelIds && !isCollectableMessage(message.labelIds)) continue;
          ids.add(String(message.id));
        }
      }
      if (page?.historyId) historyId = String(page.historyId);
      pageToken = page?.nextPageToken || null;
    } while (pageToken);
    return { ids: [...ids], historyId, pages };
  }

  async function listRecentInbox() {
    const params = new URLSearchParams({
      labelIds: REQUIRED_LABEL,
      maxResults: String(recentWindow),
    });
    const page = await call(`/messages?${params.toString()}`);
    return (page?.messages || []).map(message => String(message.id)).filter(Boolean);
  }

  async function loadMessages(ids) {
    const messages = [];
    for (const id of ids) {
      const raw = await fetchMessage(id);
      // 2차 확인. history 필터와 실제 라벨이 어긋날 수 있다.
      if (!isCollectableMessage(raw?.labelIds)) continue;
      messages.push(normalizeMessage(raw));
    }
    messages.sort((a, b) => (a.receivedAt ?? 0) - (b.receivedAt ?? 0));
    return messages;
  }

  async function baselineSync(reason) {
    const profile = await call('/profile');
    const ids = await listRecentInbox();
    return {
      mode: reason === 'BASELINE' ? SYNC_MODES.BASELINE : SYNC_MODES.RESYNC,
      reason,
      historyId: profile?.historyId ? String(profile.historyId) : null,
      messages: await loadMessages(ids),
    };
  }

  return {
    provider: 'gmail',

    async sync({ state } = {}) {
      const startHistoryId = state?.gmailHistoryId;
      if (state?.baselineComplete !== 1 || !startHistoryId) {
        return baselineSync(state?.baselineComplete === 1 ? 'NO_CURSOR' : 'BASELINE');
      }
      try {
        const { ids, historyId, pages } = await collectHistory(startHistoryId);
        return {
          mode: SYNC_MODES.INCREMENTAL,
          reason: 'CURSOR',
          historyId,
          pages,
          messages: await loadMessages(ids),
        };
      } catch (error) {
        // 오래된 커서는 404다. 구글 안내대로 최근 구간을 다시 읽고 identity로 중복을 막는다.
        if (error?.code === 'MAIL_HISTORY_GONE') return baselineSync('HISTORY_GONE');
        throw error;
      }
    },
  };
}

module.exports = {
  SYNC_MODES,
  EXCLUDED_LABELS,
  REFRESH_SKEW_SECONDS,
  createGoogleTokenSource,
  createGmailProvider,
  isCollectableMessage,
  normalizeMessage,
};
