'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const window = {};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/lecture/lecture-pens.js'), 'utf8'), { window });
const { isReviewGreen, REVIEW_PALETTE, PALETTE, HIGHLIGHT_PALETTE } = window.LecturePens;

test('the review-only green band rejects saturated greens and keeps everything else', () => {
  // 연두·라임(80°–104°)도 눈으로는 초록이라 막는다.
  for (const green of ['#2f9a5a', '#00ff00', '#34c759', '#2F6B57', '#8fcc33', '#7cc242', '#66cc00']) assert.equal(isReviewGreen(green), true, green);
  // 회녹색·노랑·청록 경계 밖·무채색은 일반 펜에서 쓸 수 있다.
  // 기본 형광펜 노랑(#F2F456)과 청록(#00ccff)은 일반 펜에 남는다.
  for (const other of ['#6B7670', '#1D2622', '#D4A72C', '#4A6FA5', '#ffffff', '#000000', '#e06030', '#00ccff', '#F2F456', '#E7E040']) assert.equal(isReviewGreen(other), false, other);
  assert.equal(isReviewGreen('not-a-color'), false);
});

test('the review palette is all green and the lecture palettes have none', () => {
  REVIEW_PALETTE.forEach(color => assert.equal(isReviewGreen(color), true, color));
  [...PALETTE, ...HIGHLIGHT_PALETTE].forEach(color => assert.equal(isReviewGreen(color), false, color));
});
