'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildSessionStream } = require('../lib/lecture/stream-routes');

const MIN = 60 * 1000;

// 설계 §12.2의 예: 동역학 0~20분 → 예제 20~35분 → 동역학 35~60분, 녹음은 41:10~44:30에 끊겼다.
test('a document stream keeps only its active recorded spans and marks other-document and silent gaps', () => {
  const dynamics = 1;
  const example = 2;
  const session = {
    id: 7,
    localDate: '2026-09-17',
    startedAtMs: 1000,
    parts: [
      { partKey: 'p_aaaaaaaa', mimeType: 'audio/mp4', start: 200, end: 41 * MIN + 10000 },
      { partKey: 'p_bbbbbbbb', mimeType: 'audio/mp4', start: 44 * MIN + 30000, end: 60 * MIN },
    ],
    // 자료 열기 이벤트는 녹음 시작보다 늦게 찍힌다(첫 구간은 첫 자료에 붙는다).
    events: [
      { t: 900, documentId: dynamics, page: 1 },
      { t: 5 * MIN, documentId: dynamics, page: 2 },
      { t: 20 * MIN, documentId: example, page: 1 },
      { t: 35 * MIN, documentId: dynamics, page: 2 },
    ],
    markers: [{ kind: 'important', t: 12 * MIN, page: 2 }, { kind: 'later', t: 25 * MIN, page: 1 }],
  };
  const stream = buildSessionStream(dynamics, session, new Map([[example, '예제']]));
  assert.deepEqual(stream.items.map(item => [item.type, item.start, item.end]), [
    ['span', 200, 20 * MIN],
    ['other', 20 * MIN, 35 * MIN],
    ['span', 35 * MIN, 41 * MIN + 10000],
    ['silence', 41 * MIN + 10000, 44 * MIN + 30000],
    ['span', 44 * MIN + 30000, 60 * MIN],
  ]);
  assert.equal(stream.items[1].title, '예제');
  // 파일 안 오디오 위치는 파트 시작 기준이다.
  assert.deepEqual(stream.items.filter(item => item.type === 'span').map(item => [item.partKey, item.audioStart]),
    [['p_aaaaaaaa', 0], ['p_aaaaaaaa', 35 * MIN - 200], ['p_bbbbbbbb', 0]]);
  // 이 자료 재생 구간 밖(예제를 보던 25분)의 마커는 빠진다.
  assert.deepEqual(stream.markers.map(marker => marker.kind), ['important']);
  assert.deepEqual(stream.pages.map(item => item.page), [1, 2, 2]);

  // 예제 쪽에서 보면 20~35분만 남고 앞뒤는 잘린다.
  const other = buildSessionStream(example, session, new Map([[dynamics, '동역학']]));
  assert.deepEqual(other.items.map(item => [item.type, item.start, item.end]), [['span', 20 * MIN, 35 * MIN]]);
  // 한 번도 열지 않은 자료는 스트림이 없다.
  assert.equal(buildSessionStream(99, session, new Map()), null);
});
