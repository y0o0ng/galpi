'use strict';

// 기사 하나를 결정적인 값으로 바꾸는 곳. 네트워크도 DB도 모른다.
//
// **identity를 여기 한 곳에서만 계산한다**(`lib/mail/agent.js`와 같은 이유). 소스가
// 늘어날 때 각 어댑터가 자기 방식으로 같은 기사를 식별하기 시작하면, 한쪽만 고쳐지는
// 순간 같은 기사가 두 행이 되고 사용자는 같은 뉴스를 두 번 본다.
//
// 같은 기사를 다시 만나면 반드시 같은 값이 나와야 하므로 현재 시각·로케일·난수에
// 기대는 변환을 넣지 않는다.

const crypto = require('crypto');

// 주소가 가리키는 문서는 같은데 값만 다르게 만드는 것들. 뉴스 링크는 유입 경로마다
// 다른 꼬리표를 달고 오기 때문에 이것을 지우지 않으면 dedupe가 거의 듣지 않는다.
const TRACKING_PARAM_PREFIXES = ['utm_', 'pk_', 'mtm_', 'mc_'];
const TRACKING_PARAMS = new Set([
  'fbclid', 'gclid', 'dclid', 'msclkid', 'yclid', 'twclid',
  'igshid', 'ref', 'ref_src', 'refsrc', 'source', 'cmpid', 'campaign_id',
  'spm', 'scid', 'sc_channel', 'sc_campaign', '_hsenc', '_hsmi', 'vero_id',
]);

const MAX_TITLE_CHARS = 400;
const MAX_SNIPPET_CHARS = 600;

function oneLine(value, maxLength) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return Number.isInteger(maxLength) ? text.slice(0, maxLength) : text;
}

function isTrackingParam(key) {
  const name = key.toLowerCase();
  return TRACKING_PARAMS.has(name) || TRACKING_PARAM_PREFIXES.some(prefix => name.startsWith(prefix));
}

/**
 * dedupe의 유일한 기준. 사용자가 여는 주소(`url`)는 따로 보존하고, 비교에만 이 값을
 * 쓴다 — 추적 꼬리표를 지운 주소로 이동시키면 매체가 유입을 못 세는 것이 아니라
 * 링크 자체가 깨지는 곳이 있다.
 */
function canonicalizeUrl(value) {
  let url;
  try {
    url = new URL(String(value ?? '').trim());
  } catch {
    return '';
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';

  url.hash = '';
  url.hostname = url.hostname.toLowerCase().replace(/^www\./, '');
  // 기본 포트는 표기 여부가 갈리므로 지운다.
  if ((url.protocol === 'http:' && url.port === '80') || (url.protocol === 'https:' && url.port === '443')) {
    url.port = '';
  }
  // http와 https는 같은 문서를 가리키는 일이 대부분이다. 둘을 다른 기사로 세면
  // 매체가 리다이렉트를 켜는 날 과거 기사가 전부 새 기사로 돌아온다.
  url.protocol = 'https:';

  const kept = [...url.searchParams.entries()]
    .filter(([key]) => !isTrackingParam(key))
    .sort(([a, aValue], [b, bValue]) => (a === b ? aValue.localeCompare(bValue) : a.localeCompare(b)));
  url.search = '';
  kept.forEach(([key, entryValue]) => url.searchParams.append(key, entryValue));

  // 경로 대소문자는 건드리지 않는다 — 서버에 따라 다른 문서다.
  if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
    url.pathname = url.pathname.replace(/\/+$/, '');
  }
  return url.toString();
}

function articleIdentityKey(canonicalUrl) {
  return crypto.createHash('sha256').update(String(canonicalUrl ?? '')).digest('hex');
}

/**
 * 발행 시각. 파싱되면 epoch, 안 되면 null이고 원문 표기는 따로 남긴다.
 * 실패를 빈 값 하나로 접으면 날짜가 이상한 기사들이 서로 같은 재료를 갖게 된다.
 */
function parsePublishedAt(value) {
  const text = oneLine(value, 60);
  if (!text) return { publishedAt: null, publishedRaw: null };
  const parsed = Date.parse(text);
  return {
    publishedAt: Number.isFinite(parsed) ? Math.floor(parsed / 1000) : null,
    publishedRaw: text,
  };
}

/**
 * 검색 결과 하나 → 저장 가능한 기사. 주소를 못 읽거나 제목이 없으면 null이고,
 * 호출부는 그것을 조용히 버린다 — 소스 하나의 이상한 행 하나가 수집 전체를
 * 실패로 만들면 안 된다(설계 16).
 */
function normalizeArticle(result, options = {}) {
  const canonicalUrl = canonicalizeUrl(result?.url);
  if (!canonicalUrl) return null;
  const title = oneLine(result?.title, MAX_TITLE_CHARS);
  if (!title) return null;

  const { publishedAt, publishedRaw } = parsePublishedAt(result?.publishedDate ?? result?.published_date);
  let source = oneLine(result?.source, 120);
  if (!source) {
    try {
      source = new URL(canonicalUrl).hostname;
    } catch {
      source = null;
    }
  }

  return {
    identityKey: articleIdentityKey(canonicalUrl),
    canonicalUrl,
    url: oneLine(result?.url, 2000),
    title,
    source: source || null,
    publishedAt,
    publishedRaw,
    snippet: oneLine(result?.snippet ?? result?.content, MAX_SNIPPET_CHARS) || null,
    query: oneLine(options.query, 200) || null,
  };
}

/**
 * 한 번의 수집 안에서 같은 기사가 두 번 나오면 첫 번째만 남긴다. 소스가 하나여도
 * 검색이 같은 문서를 다른 주소로 돌려주는 일이 있다.
 */
function dedupeArticles(articles) {
  const seen = new Set();
  const unique = [];
  articles.forEach(article => {
    if (!article || seen.has(article.identityKey)) return;
    seen.add(article.identityKey);
    unique.push(article);
  });
  return unique;
}

/**
 * 관심 하나가 만드는 검색 질의. 등록할 때 만들어둔 `query`가 있으면 그것이고,
 * 없으면 topic이다.
 *
 * 둘을 가른 이유는 topic이 두 가지 일을 하고 있었기 때문이다 — 사람이 읽는 이름이면서
 * 동시에 검색어였다. 그래서 사용자가 말한 대로 적으면(`피지컬 AI 관련 정보`) 검색이
 * 넓어지고, 검색이 되게 고쳐 쓰면 노트에서 읽기 나빠졌다. 이제 이름은 topic이 들고
 * 검색은 query가 든다.
 *
 * 별칭을 OR로 엮지 않는다 — 질의가 길어질수록 검색 엔진이 주제를 흐리게 잡고,
 * 무엇이 무엇을 데려왔는지도 알 수 없게 된다. 별칭은 11.2절의 최근 언급 검사에
 * 쓰는 것이지 수집어가 아니다.
 */
function buildQuery(interest) {
  // 정규화한 뒤에 고른다. `query: "   "`는 truthy라 그대로 고르면 빈 질의가 되고
  // 그 관심은 수집이 조용히 멈춘다 — 노트는 볼트에 있어 사람이 직접 고칠 수 있다.
  return oneLine(interest?.query, 180) || oneLine(interest?.topic, 180);
}

module.exports = {
  MAX_SNIPPET_CHARS,
  MAX_TITLE_CHARS,
  articleIdentityKey,
  buildQuery,
  canonicalizeUrl,
  dedupeArticles,
  normalizeArticle,
  parsePublishedAt,
};
