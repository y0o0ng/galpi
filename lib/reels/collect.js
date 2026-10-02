'use strict';

// 릴스 후보용 수집(설계 v0.2 1장). 무료 소스만 쓰고 LLM은 부르지 않는다.
// 기사 본문·RSS 설명은 비신뢰 텍스트라 여기서는 정규화하고 자르기만 한다.

const { canonicalizeUrl } = require('../news/normalize');

const WINDOW_SECONDS = 72 * 60 * 60;
const FETCH_TIMEOUT_MS = 15000;
const MAX_SUMMARY_CHARS = 300;
const MAX_TITLE_CHARS = 200;
// 프롬프트가 무한정 커지지 않게 소스별로 자른다.
const MAX_ITEMS_PER_SOURCE = 40;
// 최신순 100건은 대부분 잡음이라 반응이 있었던 글만 본다.
const HN_MIN_POINTS = 30;

const RSS_FEEDS = [
  { source: 'IEEE Spectrum', url: 'https://spectrum.ieee.org/feeds/feed.rss' },
  { source: 'Ars Technica', url: 'https://feeds.arstechnica.com/arstechnica/index' },
  { source: 'The Register', url: 'https://www.theregister.com/headlines.atom' },
];

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function clean(value, max) {
  const text = String(value ?? '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, name) => {
      if (name[0] === '#') {
        const code = name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
        return Number.isInteger(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : ' ';
      }
      return ENTITIES[name.toLowerCase()] ?? match;
    })
    .replace(/\s+/g, ' ')
    .trim();
  return text.slice(0, max);
}

function tagText(block, names) {
  for (const name of names) {
    const match = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i').exec(block);
    if (match) return match[1];
  }
  return '';
}

// RSS 2.0(<item>)과 Atom(<entry>)을 둘 다 읽는다.
function parseFeed(xml, source) {
  const items = [];
  for (const match of String(xml).matchAll(/<(item|entry)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi)) {
    const block = match[2];
    const atomLink = /<link\b[^>]*\bhref="([^"]+)"/i.exec(block);
    const url = clean(atomLink ? atomLink[1] : tagText(block, ['link']), 2000);
    const published = Date.parse(clean(tagText(block, ['pubDate', 'published', 'updated', 'dc:date']), 80));
    items.push({
      source,
      title: clean(tagText(block, ['title']), MAX_TITLE_CHARS),
      url,
      published_at: Number.isFinite(published) ? new Date(published).toISOString() : '',
      summary: clean(tagText(block, ['description', 'summary', 'content:encoded']), MAX_SUMMARY_CHARS),
    });
  }
  return items;
}

function parseHn(json) {
  return (json?.hits || []).map(hit => ({
    source: 'Hacker News',
    title: clean(hit.title, MAX_TITLE_CHARS),
    url: String(hit.url || '').trim(),
    published_at: Number.isFinite(hit.created_at_i) ? new Date(hit.created_at_i * 1000).toISOString() : '',
    summary: '',
  }));
}

async function fetchText(fetchImpl, url) {
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

/**
 * 수집 목록을 돌려준다. 소스 하나가 죽어도 나머지는 쓴다(전부 죽으면 빈 배열).
 * URL은 canonical 기준으로 중복을 걸러내되 모델에 주는 값은 원문 URL 그대로다 —
 * 카드 검증이 "목록에 있던 URL과 정확히 같은가"를 보기 때문이다.
 */
async function collectReelsItems({ fetchImpl = fetch, now = Math.floor(Date.now() / 1000) } = {}) {
  const since = now - WINDOW_SECONDS;
  const hnUrl = 'https://hn.algolia.com/api/v1/search_by_date?tags=story&hitsPerPage=100'
    + `&numericFilters=${encodeURIComponent(`created_at_i>${since},points>=${HN_MIN_POINTS}`)}`;
  const jobs = [
    fetchText(fetchImpl, hnUrl).then(text => parseHn(JSON.parse(text))),
    ...RSS_FEEDS.map(feed => fetchText(fetchImpl, feed.url).then(xml => parseFeed(xml, feed.source))),
  ];
  const settled = await Promise.allSettled(jobs);

  const seen = new Set();
  const items = [];
  for (const result of settled) {
    if (result.status !== 'fulfilled') continue;
    const recent = result.value
      .filter(item => item.title && canonicalizeUrl(item.url))
      .filter(item => !item.published_at || Date.parse(item.published_at) / 1000 >= since)
      .sort((a, b) => b.published_at.localeCompare(a.published_at))
      .slice(0, MAX_ITEMS_PER_SOURCE);
    for (const item of recent) {
      const key = canonicalizeUrl(item.url);
      if (seen.has(key)) continue;
      seen.add(key);
      items.push(item);
    }
  }
  return items;
}

module.exports = { RSS_FEEDS, WINDOW_SECONDS, collectReelsItems, parseFeed, parseHn };
