'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { aiReadableFromRaw, parseAiReadable } = require('../lib/note-access');

test('AI read access keeps legacy notes readable and only accepts explicit true values', () => {
  assert.equal(parseAiReadable(undefined), true);
  assert.equal(parseAiReadable(true), true);
  assert.equal(parseAiReadable('TRUE'), true);
  assert.equal(parseAiReadable(false), false);
  assert.equal(parseAiReadable(''), false);
  assert.equal(parseAiReadable('yes'), false);

  assert.equal(aiReadableFromRaw('# 레거시 노트'), true);
  assert.equal(aiReadableFromRaw('---\ntitle: 공개\nai_readable: true\n---\n본문'), true);
  assert.equal(aiReadableFromRaw('---\ntitle: 비공개\nai_readable: false\n---\n본문'), false);
  assert.equal(aiReadableFromRaw('---\ntitle: 오류\nai_readable: maybe\n---\n본문'), false);
});
