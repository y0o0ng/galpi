'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');

test('browser DOMPurify matches the installed dependency byte for byte', () => {
  const browserCopy = fs.readFileSync(path.join(__dirname, '../public/lib/purify.min.js'));
  const installed = fs.readFileSync(path.join(path.dirname(require.resolve('dompurify')), 'purify.min.js'));
  assert.ok(browserCopy.equals(installed), 'update public/lib/purify.min.js from the installed DOMPurify dist');
});

test('Express qs keeps normal parsing and closes the patched input edge cases', () => {
  const qs = createRequire(require.resolve('express'))('qs');
  assert.deepEqual(qs.parse('q=hello&tags[]=a&tags[]=b&filter[year]=2026'), {
    q: 'hello', tags: ['a', 'b'], filter: { year: '2026' },
  });
  const parsed = qs.parse('x[constructor][isBuffer]=y', { allowPrototypes: true });
  assert.doesNotThrow(() => qs.stringify(parsed));
  assert.throws(() => qs.parse('a[]=1,2,3', {
    comma: true, arrayLimit: 2, throwOnLimitExceeded: true,
  }), RangeError);
});
