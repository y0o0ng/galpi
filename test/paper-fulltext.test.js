'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const {
  PaperFullTextError,
  buildPaperChunks,
  createPaperFullTextService,
  detectSectionHeadings,
  extractPdfPages,
  initializePaperFullTextSchema,
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
    { number: 4, text: '4000 Trades - Net Profit/Loss\n25M\n2. Data, Methods and Evaluation\n3.2. Risk Management Team\nEXPERIMENTS' },
    { number: 8, text: 'References' },
    { number: 9, text: '11. The sentiment was predominantly positive\nAAPL GOOGL AMZN' },
  ]);

  assert.deepEqual(headings, [
    { page: 1, text: 'Abstract' },
    { page: 1, text: '1. Introduction' },
    { page: 4, text: '2. Data, Methods and Evaluation' },
    { page: 4, text: '3.2. Risk Management Team' },
    { page: 4, text: 'EXPERIMENTS' },
    { page: 8, text: 'References' },
  ]);
});

test('buildPaperChunks preserves sections and pages without carrying overlap across headings', () => {
  const chunks = buildPaperChunks([
    {
      number: 1,
      text: `1. Introduction\n${'Introductory context about the trading framework. '.repeat(8)}`,
    },
    {
      number: 2,
      text: `2. Methodology\n${'Fundamental analysts and risk controls coordinate decisions. '.repeat(8)}`,
    },
    {
      number: 3,
      text: `References\n${'Reference entry for a related trading system. '.repeat(6)}`,
    },
  ], {
    title: 'Trading Agents',
    targetChars: 200,
    maxChars: 280,
    overlapChars: 50,
  });

  assert.ok(chunks.length >= 5);
  assert.ok(chunks.every(chunk => chunk.content.length <= 280));
  assert.ok(chunks.some(chunk => chunk.section === '1. Introduction' && chunk.pageStart === 1));
  assert.ok(chunks.some(chunk => chunk.section === '2. Methodology' && chunk.pageStart === 2));
  assert.ok(chunks.filter(chunk => chunk.section === 'References').every(chunk => chunk.isReferences));
  assert.ok(chunks.filter(chunk => chunk.section === '2. Methodology')
    .every(chunk => !chunk.content.includes('Introductory context')));

  const references = buildPaperChunks([
    { number: 8, text: 'References\nPrior work entry.' },
    { number: 9, text: '11. The sentiment was predominantly positive, with occasional dips\nAppendix observation.' },
  ], { title: 'Trading Agents' });
  assert.ok(references.every(chunk => chunk.section === 'References' && chunk.isReferences));
});

function createTestDatabase() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE notes (
      filename TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL,
      note_type TEXT NOT NULL,
      paper_id TEXT,
      archived INTEGER NOT NULL DEFAULT 0,
      ai_readable INTEGER NOT NULL DEFAULT 1,
      codex_status TEXT NOT NULL DEFAULT 'pending'
    );
    CREATE TABLE note_chunks (
      chunk_id TEXT PRIMARY KEY,
      note_filename TEXT NOT NULL,
      content TEXT NOT NULL
    );
  `);
  return db;
}

function extractedFixture() {
  const pages = [
    { number: 1, text: 'Abstract\nA multi-agent framework for financial trading.' },
    { number: 2, text: '1. Introduction\nThe system mirrors the structure of a trading firm.' },
    { number: 3, text: '2. Methodology\nFundamental analyst signals feed a risk management team.' },
    { number: 4, text: '3. Experiments\nCumulative returns, Sharpe ratio, and maximum drawdown are evaluated.' },
    { number: 5, text: 'References\nPrior work on language-model trading agents.' },
  ];
  return {
    pageCount: pages.length,
    pages: pages.map(page => ({ ...page, charCount: page.text.length })),
    text: pages.map(page => page.text).join('\n\n'),
    charCount: pages.reduce((sum, page) => sum + page.text.length, 0) + ((pages.length - 1) * 2),
  };
}

test('paper full-text service serializes indexing, caches the source, and stays outside note_chunks', async t => {
  const db = createTestDatabase();
  const vaultPath = await fs.mkdtemp(path.join(os.tmpdir(), 'paper-fulltext-'));
  t.after(async () => {
    db.close();
    await fs.rm(vaultPath, { recursive: true, force: true });
  });
  const noteContent = '# TradingAgents\n\n## 초록\n\nStored abstract only.\n';
  await fs.writeFile(path.join(vaultPath, 'paper.md'), noteContent);
  db.prepare(`
    INSERT INTO notes (filename, title, note_type, paper_id)
    VALUES (?, ?, 'paper', ?)
  `).run('paper.md', 'TradingAgents', 'paper-1');
  let parseCalls = 0;
  let embeddingCalls = 0;
  const service = createPaperFullTextService({
    db,
    vaultPath,
    extractPages: async () => {
      parseCalls += 1;
      await new Promise(resolve => setTimeout(resolve, 10));
      return extractedFixture();
    },
    embedTexts: async texts => {
      embeddingCalls += 1;
      return texts.map(text => text.includes('Methodology') ? [1, 0] : [0, 1]);
    },
  });
  const input = { paperId: 'paper-1', sourceUrl: 'https://example.com/paper.pdf', pdf: fakePdf() };

  const [first, concurrent] = await Promise.all([service.indexPaper(input), service.indexPaper(input)]);
  const reused = await service.indexPaper(input);

  assert.equal(parseCalls, 1);
  assert.equal(embeddingCalls, 1);
  assert.equal(first.status, 'ready');
  assert.equal(concurrent.sourceSha256, first.sourceSha256);
  assert.equal(reused.indexedNow, false);
  assert.equal(reused.reused, true);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM paper_chunks').get().count, 5);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM note_chunks').get().count, 0);
  assert.equal(await fs.readFile(path.join(vaultPath, 'paper.md'), 'utf8'), noteContent);
  const cachedPdf = path.join(vaultPath, ...first.sourcePath.split('/'));
  assert.deepEqual(await fs.readFile(cachedPdf), fakePdf());

  const semanticResults = service.searchPaper({
    paperId: 'paper-1',
    query: 'How are risk controls coordinated?',
    queryEmbedding: [1, 0],
  });
  assert.equal(semanticResults[0].section, '2. Methodology');
  const exactChunks = service.getPaperChunks({
    paperId: 'paper-1',
    chunkIds: [semanticResults[0].chunkId, 'missing-chunk'],
  });
  assert.equal(exactChunks.length, 1);
  assert.equal(exactChunks[0].chunkId, semanticResults[0].chunkId);
  const adjacentChunks = service.readPaper({
    paperId: 'paper-1',
    chunkId: semanticResults[0].chunkId,
  });
  assert.ok(adjacentChunks.length > 0 && adjacentChunks.length <= 2);
  assert.equal(adjacentChunks.some(chunk => chunk.chunkId === semanticResults[0].chunkId), false);

  const keywordResults = service.searchPaper({
    paperId: 'paper-1',
    query: 'maximum drawdown Sharpe ratio',
  });
  assert.equal(keywordResults[0].section, '3. Experiments');

  for (const codexStatus of ['running', 'recovery_required']) {
    db.prepare('UPDATE notes SET codex_status = ? WHERE paper_id = ?').run(codexStatus, 'paper-1');
    assert.deepEqual(service.searchPaper({ paperId: 'paper-1', query: 'risk management' }), []);
    assert.deepEqual(service.getPaperChunks({
      paperId: 'paper-1', chunkIds: [semanticResults[0].chunkId],
    }), []);
    assert.throws(
      () => service.readPaper({ paperId: 'paper-1', chunkId: semanticResults[0].chunkId }),
      error => error.code === 'chunk_not_found',
    );
    await assert.rejects(
      service.indexPaper(input),
      error => error.code === 'paper_not_saved',
    );
  }
  db.prepare("UPDATE notes SET codex_status = 'pending' WHERE paper_id = ?").run('paper-1');

  db.prepare('UPDATE notes SET ai_readable = 0 WHERE paper_id = ?').run('paper-1');
  assert.deepEqual(service.searchPaper({ paperId: 'paper-1', query: 'risk management' }), []);
  assert.deepEqual(service.getPaperChunks({
    paperId: 'paper-1', chunkIds: [semanticResults[0].chunkId],
  }), []);
  assert.throws(
    () => service.readPaper({ paperId: 'paper-1', chunkId: semanticResults[0].chunkId }),
    error => error.code === 'chunk_not_found',
  );
  await assert.rejects(
    service.indexPaper(input),
    error => error.code === 'paper_not_saved',
  );
  db.prepare('UPDATE notes SET ai_readable = 1 WHERE paper_id = ?').run('paper-1');

  db.prepare('UPDATE notes SET archived = 1 WHERE paper_id = ?').run('paper-1');
  assert.deepEqual(service.searchPaper({ paperId: 'paper-1', query: 'risk management' }), []);
  assert.deepEqual(service.getPaperChunks({ paperId: 'paper-1', chunkIds: [semanticResults[0].chunkId] }), []);
  assert.throws(
    () => service.readPaper({ paperId: 'paper-1', chunkId: semanticResults[0].chunkId }),
    error => error.code === 'chunk_not_found',
  );

  await fs.writeFile(path.join(vaultPath, 'paper-restored.md'), noteContent);
  db.prepare(`
    INSERT INTO notes (filename, title, note_type, paper_id)
    VALUES (?, ?, 'paper', ?)
  `).run('paper-restored.md', 'TradingAgents restored', 'paper-1');
  const restored = await service.indexPaper(input);
  assert.equal(restored.reused, true);
  assert.equal(restored.noteFilename, 'paper-restored.md');
  assert.ok(service.searchPaper({ paperId: 'paper-1', query: 'risk management' }).length > 0);

  db.prepare('UPDATE paper_documents SET embedding_count = 0 WHERE paper_id = ?').run('paper-1');
  const reembedded = await service.indexPaper(input);
  assert.equal(reembedded.indexedNow, true);
  assert.equal(parseCalls, 2);
  assert.equal(embeddingCalls, 2);
});

test('paper full-text schema recovers interrupted work and empty text becomes needs_ocr', async t => {
  const db = createTestDatabase();
  const vaultPath = await fs.mkdtemp(path.join(os.tmpdir(), 'paper-fulltext-failure-'));
  t.after(async () => {
    db.close();
    await fs.rm(vaultPath, { recursive: true, force: true });
  });
  db.prepare(`
    INSERT INTO notes (filename, title, note_type, paper_id)
    VALUES (?, ?, 'paper', ?)
  `).run('scan.md', 'Scanned paper', 'scan-paper');
  const service = createPaperFullTextService({
    db,
    vaultPath,
    extractPages: async () => {
      throw new PaperFullTextError('No text layer', 'pdf_text_empty');
    },
  });

  await assert.rejects(
    service.indexPaper({ paperId: 'scan-paper', pdf: fakePdf() }),
    error => error.code === 'pdf_text_empty',
  );
  assert.equal(service.getDocument('scan-paper').status, 'needs_ocr');

  db.prepare("UPDATE paper_documents SET status = 'indexing' WHERE paper_id = ?").run('scan-paper');
  assert.equal(initializePaperFullTextSchema(db), 1);
  const recovered = service.getDocument('scan-paper');
  assert.equal(recovered.status, 'failed');
  assert.equal(recovered.errorCode, 'index_interrupted');
});
