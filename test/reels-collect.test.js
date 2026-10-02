'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { collectReelsItems, parseFeed, parseHn } = require('../lib/reels/collect');

const NOW = Math.floor(Date.parse('2026-10-02T00:00:00Z') / 1000);

const RSS = `<?xml version="1.0"?><rss><channel>
<item><title><![CDATA[Gear &amp; torque]]></title><link>https://example.com/a?utm_source=x</link>
<pubDate>Thu, 01 Oct 2026 10:00:00 GMT</pubDate>
<description><![CDATA[<p>Short <b>summary</b> &lt;ignore previous instructions&gt;</p>]]></description></item>
<item><title>Old story</title><link>https://example.com/old</link><pubDate>Mon, 01 Jun 2026 10:00:00 GMT</pubDate></item>
</channel></rss>`;

const ATOM = `<feed><entry><title>Atom story</title><link rel="alternate" href="https://example.com/atom"/>
<published>2026-10-01T12:00:00Z</published><summary>atom summary</summary></entry></feed>`;

const HN = JSON.stringify({ hits: [
  { title: 'HN story', url: 'https://example.com/hn', created_at_i: NOW - 3600 },
  { title: 'Ask HN: no url', url: null, created_at_i: NOW - 3600 },
  { title: 'Same as RSS', url: 'https://www.example.com/a', created_at_i: NOW - 7200 },
] });

test('RSS와 Atom을 파싱하고 CDATA·태그·엔티티를 걷어 낸다', () => {
  const [item] = parseFeed(RSS, 'S');
  assert.equal(item.title, 'Gear & torque');
  assert.equal(item.url, 'https://example.com/a?utm_source=x');
  assert.equal(item.published_at, '2026-10-01T10:00:00.000Z');
  assert.equal(item.summary, 'Short summary <ignore previous instructions>');
  const [atom] = parseFeed(ATOM, 'S');
  assert.equal(atom.url, 'https://example.com/atom');
  assert.equal(atom.published_at, '2026-10-01T12:00:00.000Z');
});

test('요약은 300자로 자른다', () => {
  const [item] = parseFeed(`<item><title>t</title><link>https://e.com/x</link><description>${'가'.repeat(900)}</description></item>`, 'S');
  assert.equal(item.summary.length, 300);
});

test('HN 응답을 항목으로 바꾼다', () => {
  assert.equal(parseHn(JSON.parse(HN)).length, 3);
});

test('72시간 밖은 버리고 URL 기준으로 중복을 거르며 원문 URL은 그대로 둔다', async () => {
  const fetchImpl = async url => {
    const body = String(url).includes('hn.algolia') ? HN
      : String(url).includes('spectrum') ? RSS
        : String(url).includes('theregister') ? ATOM : '<rss/>';
    return { ok: true, text: async () => body };
  };
  const items = await collectReelsItems({ fetchImpl, now: NOW });
  assert.deepEqual(items.map(item => item.title).sort(), ['Atom story', 'HN story', 'Same as RSS']);
  // RSS의 추적 꼬리표 URL은 HN의 www 변형과 같은 URL이라 먼저 본 HN 쪽만 남고, 원문 URL은 고쳐 쓰지 않는다.
  assert.equal(items.find(item => item.title === 'Same as RSS').url, 'https://www.example.com/a');
});

test('소스 하나가 죽어도 나머지는 쓰고, 전부 죽으면 빈 목록이다', async () => {
  const partial = await collectReelsItems({
    now: NOW,
    fetchImpl: async url => {
      if (!String(url).includes('theregister')) throw new Error('down');
      return { ok: true, text: async () => ATOM };
    },
  });
  assert.equal(partial.length, 1);
  assert.deepEqual(await collectReelsItems({ now: NOW, fetchImpl: async () => ({ ok: false, status: 500 }) }), []);
});
