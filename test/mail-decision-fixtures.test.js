'use strict';

// 판단 fixture 세트가 모델 없이도 성립하는지만 본다. 판단 품질은
// npm run eval:mail-fixtures가 실제 모델로 잰다 — 본문이 비거나 기대값이 계약 밖이면
// 그 게이트가 무엇을 쟀는지 알 수 없게 된다.

const test = require('node:test');
const assert = require('node:assert');

const { normalizeMail } = require('../lib/mail/normalize');
const { FIXTURES } = require('./fixtures/mail-decisions/fixtures');

test('every decision fixture normalizes into a non-empty body', async () => {
  assert.ok(FIXTURES.length >= 15, '세트가 너무 작으면 오탐 변화가 안 보인다');
  const ids = new Set();
  for (const fixture of FIXTURES) {
    assert.equal(ids.has(fixture.id), false, `id 중복: ${fixture.id}`);
    ids.add(fixture.id);
    const mail = await normalizeMail(fixture.raw);
    assert.ok(mail.body.length > 0, `${fixture.id}: 본문이 비었다`);
    assert.ok(mail.from?.address, `${fixture.id}: 발신자를 못 읽었다`);
    assert.doesNotMatch(mail.body, /�/, `${fixture.id}: 인코딩이 깨졌다`);
  }
});

test('every expected value stays inside the schema contract', () => {
  const categories = new Set(['urgent', 'action_required', 'important', 'info', 'ignore']);
  const modes = new Set(['immediate', 'batch', 'silent']);
  const deadlines = new Set(['none', 'date', 'datetime']);
  const attentions = new Set([null, 'action_required', 'attachment_check', 'low_confidence']);

  for (const { id, expected } of FIXTURES) {
    assert.ok(categories.has(expected.category), `${id}: category`);
    assert.ok(modes.has(expected.mode), `${id}: mode`);
    assert.ok(deadlines.has(expected.deadline), `${id}: deadline`);
    assert.ok(attentions.has(expected.attention), `${id}: attention`);
  }

  // boundary는 hard gate에서 빠지는 자리다. 오타 하나면 조용히 채점에서 사라지므로
  // 필드 이름과 상한을 잠근다 — 전부 boundary인 세트는 아무것도 재지 않는다.
  const fields = new Set(['category', 'mode', 'deadline', 'attention']);
  let boundaryFixtures = 0;
  for (const { id, boundary } of FIXTURES) {
    if (boundary === undefined) continue;
    assert.ok(Array.isArray(boundary) && boundary.length, `${id}: boundary는 비어 있지 않은 배열`);
    for (const field of boundary) assert.ok(fields.has(field), `${id}: 모르는 boundary 필드 ${field}`);
    assert.ok(boundary.length < fields.size, `${id}: 전 필드를 boundary로 뺄 수 없다`);
    boundaryFixtures += 1;
  }
  assert.ok(boundaryFixtures <= 3, 'boundary가 늘면 게이트가 재는 것이 줄어든다');

  // 세트가 한쪽으로 쏠리면 "전부 silent"라고 답해도 점수가 잘 나온다.
  const modeCounts = new Map();
  for (const { expected } of FIXTURES) {
    modeCounts.set(expected.mode, (modeCounts.get(expected.mode) || 0) + 1);
  }
  for (const mode of modes) {
    assert.ok((modeCounts.get(mode) || 0) >= 3, `${mode} 기대값이 3개 미만이다`);
  }
});
