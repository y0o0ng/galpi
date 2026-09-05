'use strict';

const net = require('node:net');

const TAVILY_SEARCH_ENDPOINT = 'https://api.tavily.com/search';
const TAVILY_EXTRACT_ENDPOINT = 'https://api.tavily.com/extract';
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_WEB_URL_CHARS = 2048;
const BASIC_EXTRACT_REQUEST_CREDITS = 1;

const ALLOWED_TOPICS = new Set(['general', 'news']);
const ALLOWED_TIME_RANGES = new Set(['day', 'week', 'month', 'year']);
const ALLOWED_SOURCE_STRATEGIES = new Set([
  'balanced',
  'official_first',
  'news_first',
  'reviews_first',
  'technical_first',
]);

class WebServiceError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'WebServiceError';
    this.code = code;
  }
}

function clampInteger(value, fallback, min, max) {
  const parsed = Number(value);
  const base = Number.isFinite(parsed) ? parsed : fallback;
  return Math.round(Math.min(max, Math.max(min, base)));
}

function sanitizeWebText(value, limit = 800) {
  return String(value || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit);
}

function normalizeExtractContent(value) {
  return String(value || '')
    .replace(/\u0000/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\t ]+\n/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
}

function normalizeWebUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    return url.toString();
  } catch {
    return '';
  }
}

function parseIpv4(hostname) {
  if (net.isIP(hostname) !== 4) return null;
  return hostname.split('.').map(part => Number(part));
}

function isNonPublicIpv4(hostname) {
  const octets = parseIpv4(hostname);
  if (!octets) return false;
  const [a, b, c] = octets;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  );
}

function normalizedIpv6Hostname(hostname) {
  const value = String(hostname || '').toLowerCase();
  return value.startsWith('[') && value.endsWith(']') ? value.slice(1, -1) : value;
}

function isNonPublicIpv6(hostname) {
  const value = normalizedIpv6Hostname(hostname);
  if (net.isIP(value) !== 6) return false;
  if (value === '::' || value === '::1') return true;
  if (value.startsWith('::ffff:')) {
    const mapped = value.slice('::ffff:'.length);
    return net.isIP(mapped) !== 4 || isNonPublicIpv4(mapped);
  }
  const first = Number.parseInt(value.split(':')[0] || '0', 16);
  return (
    (first >= 0xfc00 && first <= 0xfdff) ||
    (first >= 0xfe80 && first <= 0xfebf) ||
    (first >= 0xff00 && first <= 0xffff) ||
    value.startsWith('2001:db8:') ||
    value === '2001:db8'
  );
}

function normalizePublicWebUrl(value) {
  const raw = String(value || '').trim();
  if (!raw || raw.length > MAX_WEB_URL_CHARS) {
    throw new WebServiceError('WEB_FETCH_URL_INVALID', '공개 HTTP(S) URL이 필요합니다.');
  }
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new WebServiceError('WEB_FETCH_URL_INVALID', '공개 HTTP(S) URL이 필요합니다.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new WebServiceError('WEB_FETCH_URL_INVALID', '공개 HTTP(S) URL이 필요합니다.');
  }
  if (url.username || url.password) {
    throw new WebServiceError('WEB_FETCH_URL_INVALID', '사용자 정보가 포함된 URL은 읽을 수 없습니다.');
  }
  const hostname = normalizedIpv6Hostname(url.hostname).replace(/\.$/, '').toLowerCase();
  if (
    !hostname ||
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    (!hostname.includes('.') && net.isIP(hostname) === 0) ||
    isNonPublicIpv4(hostname) ||
    isNonPublicIpv6(hostname)
  ) {
    throw new WebServiceError('WEB_FETCH_URL_NOT_PUBLIC', '공개 웹 주소인지 확인할 수 없습니다.');
  }
  const normalized = url.toString();
  if (normalized.length > MAX_WEB_URL_CHARS) {
    throw new WebServiceError('WEB_FETCH_URL_INVALID', 'URL이 너무 깁니다.');
  }
  return normalized;
}

function matchesDomain(host, domain) {
  return host === domain || host.endsWith(`.${domain}`);
}

function matchesAnyDomain(host, domains) {
  return domains.some(domain => matchesDomain(host, domain));
}

function classifyWebSourceType(hostname, url) {
  const host = String(hostname || '').replace(/^www\./, '').toLowerCase();
  const fullUrl = String(url || '').toLowerCase();
  if (!host) return 'unknown';
  if (host.endsWith('.gov') || host.endsWith('.go.kr') || host.endsWith('.gov.uk')) return 'official';
  if (host.endsWith('.edu') || matchesAnyDomain(host, ['arxiv.org', 'doi.org'])) return 'academic';
  if (host === 'github.com' || host.endsWith('.github.io') || host === 'gitlab.com') return 'code';
  if (matchesAnyDomain(host, ['reddit.com', 'stackoverflow.com', 'stackexchange.com'])) return 'community';
  if (
    host.startsWith('docs.') ||
    host.startsWith('developer.') ||
    host.startsWith('developers.') ||
    host.startsWith('platform.') ||
    fullUrl.includes('/docs') ||
    fullUrl.includes('/documentation') ||
    fullUrl.includes('/api-reference')
  ) return 'docs';
  if (matchesAnyDomain(host, [
    'reuters.com',
    'apnews.com',
    'bloomberg.com',
    'nytimes.com',
    'wsj.com',
    'bbc.com',
    'bbc.co.uk',
    'cnn.com',
    'theverge.com',
    'techcrunch.com',
    'yna.co.kr',
    'hani.co.kr',
    'khan.co.kr',
    'chosun.com',
    'joongang.co.kr',
  ])) return 'news';
  return 'unknown';
}

function normalizeWebResults(results, provider, topic = 'general', maxSnippetChars = 800) {
  return (Array.isArray(results) ? results : [])
    .map((item, index) => {
      const url = normalizeWebUrl(item?.url);
      if (!url) return null;
      const hostname = new URL(url).hostname.replace(/^www\./, '');
      const score = Number(item.score);
      const publishedDate = sanitizeWebText(item.published_date || item.publishedDate, 40) || null;
      const sourceType = topic === 'news' && publishedDate
        ? 'news'
        : classifyWebSourceType(hostname, url);
      return {
        title: sanitizeWebText(item.title, 160) || url,
        url,
        snippet: sanitizeWebText(item.content || item.snippet || item.raw_content, maxSnippetChars),
        publishedDate,
        source: sanitizeWebText(hostname, 120),
        sourceType,
        rank: index + 1,
        score: Number.isFinite(score) ? score : null,
        provider,
      };
    })
    .filter(Boolean);
}

function webSourceStrategyBonus(sourceType, strategy) {
  if (strategy === 'official_first') {
    if (sourceType === 'official' || sourceType === 'docs') return 0.15;
    if (sourceType === 'academic' || sourceType === 'code') return 0.06;
  }
  if (strategy === 'news_first') {
    if (sourceType === 'news') return 0.15;
    if (sourceType === 'official') return 0.05;
  }
  if (strategy === 'reviews_first') {
    if (sourceType === 'community') return 0.12;
    if (sourceType === 'news') return 0.05;
  }
  if (strategy === 'technical_first') {
    if (sourceType === 'docs' || sourceType === 'code') return 0.15;
    if (sourceType === 'academic') return 0.12;
    if (sourceType === 'official') return 0.05;
  }
  return 0;
}

function rankWebResults(results, sourceStrategy = 'balanced') {
  if (!ALLOWED_SOURCE_STRATEGIES.has(sourceStrategy)) return results;
  return [...results]
    .map((item, index) => {
      const baseScore = Number.isFinite(item.score) ? item.score : Math.max(0, 1 - index * 0.08);
      return {
        item,
        sortScore: baseScore + webSourceStrategyBonus(item.sourceType, sourceStrategy),
        originalIndex: index,
      };
    })
    .sort((a, b) => {
      if (Math.abs(b.sortScore - a.sortScore) < 0.08) return a.originalIndex - b.originalIndex;
      return b.sortScore - a.sortScore;
    })
    .map(entry => entry.item);
}

function creditsForSearchDepth(depth) {
  return depth === 'advanced' ? 2 : 1;
}

function createWebService({
  enabled = false,
  provider = 'tavily',
  apiKey = '',
  maxResults = 5,
  searchDepth = 'basic',
  cacheTtlMs = 15 * 60 * 1000,
  maxSnippetChars = 800,
  monthlyCreditSoftLimit = 800,
  getUsage = () => ({ credits: 0, requestCount: 0 }),
  addUsage = () => {},
  fetchImpl = globalThis.fetch,
  now = () => Date.now(),
} = {}) {
  const webSearchCache = new Map();
  const normalizedProvider = String(provider || '').trim();
  const defaultDepth = searchDepth === 'advanced' ? 'advanced' : 'basic';
  const defaultMaxResults = clampInteger(maxResults, 5, 1, 10);
  const normalizedCacheTtlMs = clampInteger(cacheTtlMs, 15 * 60 * 1000, 0, 86400 * 1000);
  const normalizedSnippetChars = clampInteger(maxSnippetChars, 800, 120, 2000);
  const creditLimit = clampInteger(monthlyCreditSoftLimit, 800, 1, 100000);

  function assertConfigured() {
    if (!enabled) {
      throw new WebServiceError(
        'WEB_DISABLED',
        '외부 검색이 비활성화되어 있습니다. config/codex-policy.json의 webSearch.enabled를 켜야 합니다.',
      );
    }
    if (normalizedProvider !== 'tavily') {
      throw new WebServiceError(
        'WEB_PROVIDER_UNSUPPORTED',
        `지원하지 않는 WEB_SEARCH_PROVIDER: ${normalizedProvider}`,
      );
    }
  }

  function assertProviderAvailable() {
    if (!String(apiKey || '').trim()) {
      throw new WebServiceError('WEB_API_KEY_MISSING', 'TAVILY_API_KEY가 설정되어 있지 않습니다.');
    }
    if (typeof fetchImpl !== 'function') {
      throw new WebServiceError('WEB_PROVIDER_UNAVAILABLE', '웹 제공자 연결을 사용할 수 없습니다.');
    }
  }

  function currentUsage() {
    const usage = getUsage() || {};
    const credits = Number(usage.credits);
    return {
      ...usage,
      provider: usage.provider || normalizedProvider,
      credits: Number.isFinite(credits) && credits >= 0 ? credits : 0,
      requestCount: Number.isFinite(Number(usage.requestCount)) ? Number(usage.requestCount) : 0,
    };
  }

  function assertBudgetAvailable(nextCredits) {
    const usage = currentUsage();
    if (usage.credits + nextCredits > creditLimit) {
      throw new WebServiceError(
        'WEB_MONTHLY_BUDGET_EXHAUSTED',
        `외부 검색 월 한도에 도달했습니다 (${usage.credits}/${creditLimit} credits).`,
      );
    }
  }

  function cachedSearch(cacheKey) {
    if (normalizedCacheTtlMs <= 0) return null;
    const cached = webSearchCache.get(cacheKey);
    if (!cached) return null;
    if (now() - cached.createdAt > normalizedCacheTtlMs) {
      webSearchCache.delete(cacheKey);
      return null;
    }
    return cached.value;
  }

  function cacheSearch(cacheKey, value) {
    if (normalizedCacheTtlMs <= 0) return;
    webSearchCache.set(cacheKey, { createdAt: now(), value });
  }

  async function requestTavily(endpoint, body, failureCode, failureMessage) {
    let response;
    let data;
    try {
      response = await fetchImpl(endpoint, {
        method: 'POST',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${String(apiKey || '').trim()}`,
        },
        body: JSON.stringify(body),
      });
      data = await response.json();
    } catch {
      throw new WebServiceError(failureCode, failureMessage);
    }
    if (!response.ok) throw new WebServiceError(failureCode, failureMessage);
    return data && typeof data === 'object' ? data : {};
  }

  async function search(query, options = {}) {
    const cleanQuery = String(query || '').replace(/\s+/g, ' ').trim();
    if (!cleanQuery) throw new WebServiceError('WEB_SEARCH_QUERY_INVALID', '검색어를 입력해주세요.');
    assertConfigured();

    const requestMaxResults = clampInteger(options.maxResults, defaultMaxResults, 1, 10);
    const requestDepth = options.searchDepth === 'advanced' ? 'advanced' : defaultDepth;
    const topic = ALLOWED_TOPICS.has(options.topic) ? options.topic : 'general';
    const sourceStrategy = ALLOWED_SOURCE_STRATEGIES.has(options.sourceStrategy)
      ? options.sourceStrategy
      : 'balanced';
    const timeRange = ALLOWED_TIME_RANGES.has(options.timeRange) ? options.timeRange : null;
    const reason = String(options.reason || '').replace(/\s+/g, ' ').trim().slice(0, 240);
    const cacheKey = JSON.stringify({
      provider: normalizedProvider,
      query: cleanQuery,
      maxResults: requestMaxResults,
      searchDepth: requestDepth,
      topic,
      sourceStrategy,
      timeRange: timeRange || '',
    });
    const cached = cachedSearch(cacheKey);
    if (cached) return { ...cached, cached: true };

    assertProviderAvailable();
    const credits = creditsForSearchDepth(requestDepth);
    assertBudgetAvailable(credits);
    const body = {
      query: cleanQuery,
      search_depth: requestDepth,
      max_results: requestMaxResults,
      topic,
      include_answer: false,
      include_raw_content: false,
    };
    if (timeRange) body.time_range = timeRange;
    const data = await requestTavily(
      TAVILY_SEARCH_ENDPOINT,
      body,
      'WEB_SEARCH_PROVIDER_FAILED',
      '웹 검색 제공자 요청에 실패했습니다.',
    );
    addUsage('tavily', credits);
    const retrievedAt = new Date(now()).toISOString();
    const results = normalizeWebResults(data.results, 'tavily', topic, normalizedSnippetChars);
    const normalized = {
      query: cleanQuery,
      provider: 'tavily',
      searchDepth: requestDepth,
      topic,
      sourceStrategy,
      reason,
      credits,
      cached: false,
      retrievedAt,
      results: rankWebResults(results, sourceStrategy).map(item => ({ ...item, retrievedAt })),
    };
    cacheSearch(cacheKey, normalized);
    return normalized;
  }

  async function fetchPage(url, options = {}) {
    const normalizedUrl = normalizePublicWebUrl(url);
    const query = String(options.query || '').replace(/\s+/g, ' ').trim();
    assertConfigured();
    assertProviderAvailable();
    assertBudgetAvailable(BASIC_EXTRACT_REQUEST_CREDITS);

    const body = {
      urls: normalizedUrl,
      extract_depth: 'basic',
      format: 'markdown',
      include_images: false,
      include_usage: true,
    };
    if (query) {
      body.query = query;
      body.chunks_per_source = 3;
    }
    const data = await requestTavily(
      TAVILY_EXTRACT_ENDPOINT,
      body,
      'WEB_FETCH_PROVIDER_FAILED',
      '웹 페이지 추출 요청에 실패했습니다.',
    );
    const reportedCredits = Number(data.usage?.credits);
    const credits = Number.isInteger(reportedCredits) && reportedCredits >= 0
      ? reportedCredits
      : null;
    if (credits !== null) addUsage('tavily', credits);
    const result = Array.isArray(data.results)
      ? data.results.find(item => normalizeExtractContent(item?.raw_content))
      : null;
    if (!result) {
      throw new WebServiceError('WEB_FETCH_NO_CONTENT', '웹 페이지에서 읽을 수 있는 내용을 찾지 못했습니다.');
    }
    const resultUrl = normalizePublicWebUrl(result.url);
    const content = normalizeExtractContent(result.raw_content);
    if (!content) {
      throw new WebServiceError('WEB_FETCH_NO_CONTENT', '웹 페이지에서 읽을 수 있는 내용을 찾지 못했습니다.');
    }
    return {
      provider: 'tavily',
      url: resultUrl,
      query: query || null,
      content,
      credits,
      retrievedAt: new Date(now()).toISOString(),
    };
  }

  return {
    search,
    fetch: fetchPage,
    getUsage: currentUsage,
    softLimit: creditLimit,
  };
}

module.exports = {
  ALLOWED_SOURCE_STRATEGIES,
  ALLOWED_TIME_RANGES,
  ALLOWED_TOPICS,
  BASIC_EXTRACT_REQUEST_CREDITS,
  MAX_WEB_URL_CHARS,
  TAVILY_EXTRACT_ENDPOINT,
  TAVILY_SEARCH_ENDPOINT,
  WebServiceError,
  classifyWebSourceType,
  createWebService,
  normalizeExtractContent,
  normalizePublicWebUrl,
  normalizeWebResults,
  normalizeWebUrl,
  rankWebResults,
  sanitizeWebText,
};
