'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  MAX_CONTEXT_CHARS_PER_ANSWER,
  MAX_RESULT_CHARS_PER_CALL,
  collectPaperCandidates,
  createPaperFullTextTools,
  formatPaperEvidenceBlock,
} = require('../lib/paper-fulltext-tools');
const { PAPER_PARSER_VERSION } = require('../lib/paper-fulltext');

function paperNote(paperId = 'paper-1') {
  return {
    filename: `${paperId}.md`,
    title: `Paper ${paperId}`,
    metadata: {
      note_type: 'paper',
      paper_id: paperId,
      open_access_pdf_url: `https://papers.example/${paperId}.pdf`,
    },
  };
}

function createFixture() {
  let document = null;
  let downloads = 0;
  let indexes = 0;
  const searchModes = [];
  const chunks = Array.from({ length: 7 }, (_, index) => ({
    chunkId: `chunk-${index}`,
    section: index < 3 ? 'Methodology' : 'Experiments',
    pageStart: index + 1,
    pageEnd: index + 1,
    ordinal: index,
    text: `${index}:` + 'evidence '.repeat(350),
  }));
  const service = {
    getDocument: () => document,
    indexPaper: async ({ paperId }) => {
      indexes += 1;
      document = {
        paperId,
        status: 'ready',
        parserVersion: PAPER_PARSER_VERSION,
        chunkCount: chunks.length,
        embeddingCount: chunks.length,
        indexedNow: true,
      };
      return document;
    },
    searchPaper: input => {
      searchModes.push(input.mode);
      return chunks.slice(0, 4);
    },
    readPaper: () => chunks.slice(4, 6),
    getPaperChunks: ({ chunkIds }) => chunks.filter(chunk => chunkIds.includes(chunk.chunkId)),
  };
  const tools = createPaperFullTextTools({
    fullTextService: service,
    downloadPdf: async sourceUrl => {
      downloads += 1;
      return { sourceUrl, pdf: Buffer.from('%PDF-1.7 mock') };
    },
  });
  return { tools, counts: () => ({ downloads, indexes }), searchModes };
}

test('paper candidates include only unique active paper notes and are capped at three', () => {
  const candidates = collectPaperCandidates([
    paperNote('one'),
    { title: 'Topic', metadata: { note_type: 'topic' } },
    { ...paperNote('archived'), metadata: { ...paperNote('archived').metadata, archived: 'true' } },
    paperNote('one'),
    paperNote('two'),
    paperNote('three'),
    paperNote('four'),
  ]);
  assert.deepEqual(candidates.map(item => item.paperId), ['one', 'two', 'three']);
});

test('tool session enforces search-then-read order and hard character budgets', async () => {
  const { tools, searchModes } = createFixture();
  const session = tools.createSession({ notes: [paperNote()], queryEmbedding: [1, 0] });
  assert.deepEqual(session.getToolDefinitions().map(tool => tool.name), ['paper_fulltext_search']);

  const searched = await session.execute('paper_fulltext_search', {
    paperId: 'paper-1',
    query: 'maximum drawdown experiment setup',
    mode: 'focused',
  });
  assert.equal(searched.payload.success, true);
  assert.deepEqual(searchModes, ['focused']);
  assert.ok(searched.content.length <= MAX_RESULT_CHARS_PER_CALL);
  assert.ok(searched.payload.evidence.length > 0 && searched.payload.evidence.length <= 4);
  const readTools = session.getToolDefinitions();
  assert.deepEqual(readTools.map(tool => tool.name), ['paper_fulltext_read']);
  assert.deepEqual(
    readTools[0].input_schema.properties.chunkId.enum,
    searched.payload.evidence.map(item => item.chunkId),
  );

  const chunkId = searched.payload.evidence[0].chunkId;
  const read = await session.execute('paper_fulltext_read', { paperId: 'paper-1', chunkId });
  assert.equal(read.payload.success, true);
  assert.ok(read.content.length <= MAX_RESULT_CHARS_PER_CALL);
  assert.equal(session.getUsage().calls, 2);
  assert.ok(session.getUsage().contextChars <= MAX_CONTEXT_CHARS_PER_ANSWER);
  assert.deepEqual(session.getToolDefinitions(), []);
  assert.ok(session.getEvidenceRefs()[0].chunkIds.includes(chunkId));

  const overLimit = await session.execute('paper_fulltext_read', { paperId: 'paper-1', chunkId });
  assert.equal(overLimit.payload.code, 'tool_call_limit');
  assert.equal(session.getUsage().calls, 2);
  assert.ok(session.getUsage().contextChars <= MAX_CONTEXT_CHARS_PER_ANSWER);
});

test('tool session rejects arbitrary paper and chunk identifiers', async () => {
  const { tools, counts } = createFixture();
  const invalidPaper = tools.createSession({ notes: [paperNote()] });
  const denied = await invalidPaper.execute('paper_fulltext_search', {
    paperId: 'paper-2',
    query: 'secret',
    mode: 'focused',
  });
  assert.equal(denied.payload.code, 'paper_not_allowed');
  assert.deepEqual(counts(), { downloads: 0, indexes: 0 });

  const invalidChunk = tools.createSession({ notes: [paperNote()] });
  await invalidChunk.execute('paper_fulltext_search', {
    paperId: 'paper-1',
    query: 'details',
    mode: 'focused',
  });
  const read = await invalidChunk.execute('paper_fulltext_read', {
    paperId: 'paper-1',
    chunkId: 'forged-chunk',
  });
  assert.equal(read.payload.code, 'chunk_not_allowed');
});

test('ready index is reused across sessions without another download', async () => {
  const { tools, counts } = createFixture();
  for (let index = 0; index < 2; index += 1) {
    const session = tools.createSession({ notes: [paperNote()] });
    await session.execute('paper_fulltext_search', {
      paperId: 'paper-1',
      query: 'methodology',
      mode: 'overview',
    });
  }
  assert.deepEqual(counts(), { downloads: 1, indexes: 1 });
});

test('evidence references are resolved only for paper notes in the current context', () => {
  const { tools } = createFixture();
  const resolved = tools.resolveEvidenceRefs({
    notes: [paperNote()],
    refs: [
      { paperId: 'paper-1', chunkIds: ['chunk-0', 'chunk-1'] },
      { paperId: 'paper-2', chunkIds: ['chunk-2'] },
    ],
  });
  assert.deepEqual(resolved.map(item => item.chunkId), ['chunk-0', 'chunk-1']);
  const block = formatPaperEvidenceBlock(resolved);
  assert.ok(block.includes('<paper_fulltext_evidence>'));
  assert.ok(block.length <= MAX_CONTEXT_CHARS_PER_ANSWER);
});
