'use strict';

const S2_SEARCH_URL = 'https://api.semanticscholar.org/graph/v1/paper/search';
const S2_FIELDS = 'title,abstract,year,authors,citationCount,externalIds,url,tldr';
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 20;
const MAX_QUERY_LENGTH = 200;
const CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_CACHE_ENTRIES = 50;
const REQUEST_TIMEOUT_MS = 8000;

const paperSearchCache = new Map();

class PaperSearchError extends Error {
  constructor(message, statusCode = 502, code = 'paper_search_failed') {
    super(message);
    this.name = 'PaperSearchError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

function sanitizePaperText(value, limit = 4000) {
  return String(value || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,!?;:])/g, '$1')
    .trim()
    .slice(0, limit);
}

function normalizeHttpUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    return url.toString();
  } catch {
    return '';
  }
}

function normalizePaper(item) {
  if (!item || typeof item !== 'object') return null;
  const paperId = sanitizePaperText(item.paperId, 200);
  const title = sanitizePaperText(item.title, 500);
  if (!paperId || !title) return null;

  const authors = (Array.isArray(item.authors) ? item.authors : [])
    .map(author => sanitizePaperText(author?.name, 160))
    .filter(Boolean)
    .slice(0, 30);
  const year = Number.isInteger(item.year) ? item.year : null;
  const citationCount = Number.isFinite(Number(item.citationCount))
    ? Math.max(0, Math.trunc(Number(item.citationCount)))
    : 0;
  const doi = sanitizePaperText(item.externalIds?.DOI, 240) || null;
  const arxivId = sanitizePaperText(item.externalIds?.ArXiv, 120) || null;
  const fallbackUrl = `https://www.semanticscholar.org/paper/${encodeURIComponent(paperId)}`;

  return {
    paperId,
    title,
    abstract: sanitizePaperText(item.abstract, 12000) || null,
    year,
    authors,
    citationCount,
    tldr: sanitizePaperText(item.tldr?.text, 1200) || null,
    url: normalizeHttpUrl(item.url) || fallbackUrl,
    arxivId,
    doi,
  };
}

function normalizePaperResults(items) {
  return (Array.isArray(items) ? items : [])
    .map(normalizePaper)
    .filter(Boolean);
}

function normalizeQuery(query) {
  const cleanQuery = String(query || '').replace(/\s+/g, ' ').trim();
  if (!cleanQuery) throw new PaperSearchError('논문 검색어를 입력해주세요.', 400, 'invalid_query');
  if (cleanQuery.length > MAX_QUERY_LENGTH) {
    throw new PaperSearchError('논문 검색어는 200자 이하여야 합니다.', 400, 'invalid_query');
  }
  return cleanQuery;
}

function normalizeLimit(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, parsed));
}

function getCachedSearch(cacheKey) {
  const cached = paperSearchCache.get(cacheKey);
  if (!cached) return null;
  if (Date.now() - cached.createdAt > CACHE_TTL_MS) {
    paperSearchCache.delete(cacheKey);
    return null;
  }
  return { ...cached.value, cached: true };
}

function cacheSearch(cacheKey, value) {
  if (paperSearchCache.size >= MAX_CACHE_ENTRIES) {
    paperSearchCache.delete(paperSearchCache.keys().next().value);
  }
  paperSearchCache.set(cacheKey, { createdAt: Date.now(), value });
}

function clearPaperSearchCache() {
  paperSearchCache.clear();
}

async function searchSemanticScholar(query, options = {}) {
  const cleanQuery = normalizeQuery(query);
  const limit = normalizeLimit(options.limit);
  const mockEnabled = options.mockResponse !== undefined;
  const cacheKey = JSON.stringify({ query: cleanQuery.toLowerCase(), limit, mock: mockEnabled });
  const cached = getCachedSearch(cacheKey);
  if (cached) return cached;

  let data = options.mockResponse;
  if (!mockEnabled) {
    const url = new URL(S2_SEARCH_URL);
    url.searchParams.set('query', cleanQuery);
    url.searchParams.set('fields', S2_FIELDS);
    url.searchParams.set('limit', String(limit));

    const headers = { Accept: 'application/json' };
    const apiKey = String(options.apiKey || '').trim();
    if (apiKey) headers['x-api-key'] = apiKey;

    const fetchImpl = options.fetchImpl || fetch;
    let response;
    try {
      response = await fetchImpl(url, {
        headers,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError';
      throw new PaperSearchError(
        timedOut ? '논문 검색 응답이 늦습니다. 잠시 후 다시 시도해주세요.' : 'Semantic Scholar에 연결하지 못했습니다.',
        timedOut ? 504 : 502,
        timedOut ? 'timeout' : 'network_error',
      );
    }

    data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 429) {
        throw new PaperSearchError('논문 검색 요청이 몰렸습니다. 잠시 후 다시 시도해주세요.', 429, 'rate_limited');
      }
      if (response.status === 400) {
        throw new PaperSearchError('Semantic Scholar가 검색어를 처리하지 못했습니다.', 400, 'invalid_query');
      }
      if (response.status === 401 || response.status === 403) {
        throw new PaperSearchError('Semantic Scholar API 키를 확인해주세요.', 502, 'authentication_failed');
      }
      const providerMessage = sanitizePaperText(data.message || data.error, 240);
      throw new PaperSearchError(
        providerMessage || `Semantic Scholar 검색에 실패했습니다. (HTTP ${response.status})`,
        502,
      );
    }
  }

  const responseData = data && typeof data === 'object' ? data : {};
  const result = {
    query: cleanQuery,
    total: Number.isFinite(Number(responseData.total)) ? Number(responseData.total) : 0,
    cached: false,
    mock: mockEnabled,
    retrievedAt: new Date().toISOString(),
    results: normalizePaperResults(responseData.data).slice(0, limit),
  };
  cacheSearch(cacheKey, result);
  return result;
}

module.exports = {
  PaperSearchError,
  clearPaperSearchCache,
  normalizePaper,
  normalizePaperResults,
  searchSemanticScholar,
};
