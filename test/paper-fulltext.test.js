'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  PaperFullTextError,
  detectSectionHeadings,
  extractPdfPages,
  normalizePageText,
} = require('../lib/paper-fulltext');

function fakePdf() {
  return Buffer.from('%PDF-1.7\nmock');
}

function parserFactory(result, hooks = {}) {
  return () => ({
    async getText(options) {
      hooks.options = options;
      if (result instanceof Error) throw result;
      return result;
    },
    async destroy() {
      hooks.destroyed = true;
    },
  });
}

test('normalizePageText removes nulls and preserves paragraph breaks', () => {
  assert.equal(
    normalizePageText('  First\t line\r\n\r\n\r\nSecond\0 line  '),
    'First line\n\nSecond line',
  );
});

test('extractPdfPages returns normalized page text and destroys the parser', async () => {
  const hooks = {};
  const result = await extractPdfPages(fakePdf(), {
    parserFactory: parserFactory({
      total: 2,
      pages: [
        { num: 1, text: '1 Introduction\nFirst\tpage' },
        { num: 2, text: '2 Experiments\r\nSecond page' },
      ],
    }, hooks),
  });

  assert.equal(result.pageCount, 2);
  assert.equal(result.pages[0].text, '1 Introduction\nFirst page');
  assert.equal(result.pages[1].charCount, 25);
  assert.match(result.text, /First page\n\n2 Experiments/);
  assert.deepEqual(hooks.options, { pageJoiner: '' });
  assert.equal(hooks.destroyed, true);
});

test('extractPdfPages rejects non-PDF input before creating a parser', async () => {
  let called = false;
  await assert.rejects(
    extractPdfPages(Buffer.from('not a pdf'), {
      parserFactory() {
        called = true;
      },
    }),
    error => error instanceof PaperFullTextError && error.code === 'invalid_pdf',
  );
  assert.equal(called, false);
});

test('extractPdfPages classifies empty extracted text as OCR-needed input', async () => {
  const hooks = {};
  await assert.rejects(
    extractPdfPages(fakePdf(), {
      parserFactory: parserFactory({ total: 2, pages: [{ num: 1, text: ' ' }, { num: 2, text: '' }] }, hooks),
    }),
    error => error instanceof PaperFullTextError && error.code === 'pdf_text_empty',
  );
  assert.equal(hooks.destroyed, true);
});

test('extractPdfPages rejects documents over the page limit', async () => {
  const hooks = {};
  await assert.rejects(
    extractPdfPages(fakePdf(), {
      maxPages: 2,
      parserFactory: parserFactory({
        total: 3,
        pages: [{ num: 1, text: 'Enough searchable text for this document.' }],
      }, hooks),
    }),
    error => error instanceof PaperFullTextError && error.code === 'pdf_too_many_pages',
  );
  assert.equal(hooks.destroyed, true);
});

test('extractPdfPages wraps parser errors and still destroys the parser', async () => {
  const hooks = {};
  await assert.rejects(
    extractPdfPages(fakePdf(), {
      parserFactory: parserFactory(new Error('broken xref'), hooks),
    }),
    error => error instanceof PaperFullTextError
      && error.code === 'pdf_parse_failed'
      && error.cause?.message === 'broken xref',
  );
  assert.equal(hooks.destroyed, true);
});

test('detectSectionHeadings finds numbered and named academic sections', () => {
  const headings = detectSectionHeadings([
    { number: 1, text: 'TAURIC RESEARCH\nAbstract\n1. Introduction\nOrdinary sentence.' },
    { number: 4, text: '4000 Trades - Net Profit/Loss\n25M\n3.2. Risk Management Team\nEXPERIMENTS' },
    { number: 8, text: 'References' },
    { number: 9, text: '11. The sentiment was predominantly positive\nAAPL GOOGL AMZN' },
  ]);

  assert.deepEqual(headings, [
    { page: 1, text: 'Abstract' },
    { page: 1, text: '1. Introduction' },
    { page: 4, text: '3.2. Risk Management Team' },
    { page: 4, text: 'EXPERIMENTS' },
    { page: 8, text: 'References' },
  ]);
});
