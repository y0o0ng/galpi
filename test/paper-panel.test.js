'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'paper-panel.js'), 'utf8');

function loadPaperFullTextUrl() {
  const marker = '\n  function makeExternalLink';
  assert.ok(source.includes(marker), 'paperFullTextUrl test hook 위치를 찾지 못했다');
  const instrumented = source.replace(
    marker,
    '\n  global.__paperPanelTest = { paperFullTextUrl };\n\n  function makeExternalLink',
  );
  const fakeWindow = {};
  vm.runInNewContext(instrumented, { window: fakeWindow, URL }, { filename: 'paper-panel.js' });
  return fakeWindow.__paperPanelTest.paperFullTextUrl;
}

test('paper PDF button prefers a verified alternate and keeps existing fallbacks', () => {
  const paperFullTextUrl = loadPaperFullTextUrl();

  assert.equal(
    paperFullTextUrl({
      alternate_pdf_url: 'https://alternate.example/paper.pdf',
      open_access_pdf_url: 'https://dead.example/paper.pdf',
      arxiv_id: '2401.01234',
    }),
    'https://alternate.example/paper.pdf',
  );
  assert.equal(
    paperFullTextUrl({
      alternate_pdf_url: 'javascript:alert(1)',
      open_access_pdf_url: 'https://papers.example/paper.pdf',
      arxiv_id: '2401.01234',
    }),
    'https://papers.example/paper.pdf',
  );
  assert.equal(
    paperFullTextUrl({ arxiv_id: '2401.01234' }),
    'https://arxiv.org/pdf/2401.01234',
  );
});
