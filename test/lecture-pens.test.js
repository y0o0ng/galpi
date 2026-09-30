'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const window = {};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/lecture/lecture-pens.js'), 'utf8'), { window });
const { isReviewGreen } = window.LecturePens;

test('the review-only green band rejects saturated greens and keeps everything else', () => {
  for (const green of ['#2f9a5a', '#00ff00', '#34c759', '#2F6B57']) assert.equal(isReviewGreen(green), true, green);
  // 회녹색·노랑·청록 경계 밖·무채색은 일반 펜에서 쓸 수 있다.
  for (const other of ['#6B7670', '#1D2622', '#D4A72C', '#4A6FA5', '#ffffff', '#000000', '#e06030', '#00ccff']) assert.equal(isReviewGreen(other), false, other);
  assert.equal(isReviewGreen('not-a-color'), false);
});
