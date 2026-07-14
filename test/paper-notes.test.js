'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildPaperNoteContent, createPaperNoteSaver } = require('../lib/paper-notes');

const identity = {
  fileId: '20260714-120000-abcd',
  createdStr: '2026-07-14 12:00',
};

test('buildPaperNoteContent creates a searchable paper note', () => {
  const content = buildPaperNoteContent({
    ...identity,
    paper: {
      paperId: 'abc123',
      title: 'TradingAgents: Multi-Agents LLM Financial Trading Framework',
      authors: ['Yijia Xiao', 'Edward Sun'],
      year: 2025,
      citationCount: 142,
      url: 'https://www.semanticscholar.org/paper/abc123',
      arxivId: '2412.20138',
      doi: '10.1000/example',
      tldr: 'A multi-agent LLM framework.',
      abstract: 'Significant progress has been made.',
    },
  });

  assert.match(content, /^---\nid: 20260714-120000-abcd/m);
  assert.match(content, /^note_type: paper$/m);
  assert.match(content, /^authors: \["Yijia Xiao", "Edward Sun"\]$/m);
  assert.match(content, /^paper_id: "abc123"$/m);
  assert.match(content, /^knowledge_type: academic_paper$/m);
  assert.match(content, /## TL;DR\n\nA multi-agent LLM framework\./);
  assert.match(content, /## 초록\n\nSignificant progress has been made\./);
  assert.match(content, /<!-- CODEX-TAGS-START -->/);
  assert.match(content, /<!-- CODEX-LINKS-START -->/);
  assert.doesNotMatch(content, /CODEX-SUMMARY|CODEX-PROPOSALS|QA-LOG/);
});

test('buildPaperNoteContent handles sparse metadata without invalid placeholders', () => {
  const content = buildPaperNoteContent({
    ...identity,
    paper: {
      paperId: 'sparse-paper',
      title: 'Sparse Metadata Paper',
      authors: [],
      year: null,
      citationCount: 0,
      url: 'https://www.semanticscholar.org/paper/sparse-paper',
      arxivId: null,
      doi: null,
      tldr: null,
      abstract: null,
    },
  });

  assert.match(content, /^authors: \[\]$/m);
  assert.match(content, /^citation_count: 0$/m);
  assert.match(content, /## 초록\n\n초록 정보 없음\./);
  assert.doesNotMatch(content, /^year:|^arxiv_id:|^doi:|## TL;DR/m);
});

test('buildPaperNoteContent safely quotes YAML string fields', () => {
  const content = buildPaperNoteContent({
    ...identity,
    paper: {
      paperId: 'quoted:paper',
      title: 'A "quoted" title: test',
      authors: ['A: Author', 'B "Author"'],
      citationCount: 1,
      url: 'https://example.com/paper?a=1&b=2',
    },
  });

  assert.match(content, /^title: "A \\"quoted\\" title: test"$/m);
  assert.match(content, /^authors: \["A: Author", "B \\"Author\\""\]$/m);
  assert.match(content, /^paper_id: "quoted:paper"$/m);
});

test('buildPaperNoteContent rejects missing identity fields', () => {
  assert.throws(
    () => buildPaperNoteContent({ ...identity, paper: { paperId: '', title: 'No ID' } }),
    /paperId와 title/,
  );
  assert.throws(
    () => buildPaperNoteContent({ paper: { paperId: 'id', title: 'Title' } }),
    /노트 ID와 생성 시각/,
  );
});

test('createPaperNoteSaver serializes concurrent saves and returns the existing note', async () => {
  const papers = new Map();
  const created = [];
  let identityCount = 0;
  const savePaper = createPaperNoteSaver({
    findActivePaper: paperId => papers.get(paperId) || null,
    createNoteIdentity: () => {
      identityCount += 1;
      return { fileId: `paper-${identityCount}`, createdStr: identity.createdStr };
    },
    saveNote: async note => {
      const saved = { filename: `${note.fileId}.md`, title: note.title };
      papers.set(note.paperId, saved);
    },
    cleanupNote: async () => {},
    onCreated: async event => created.push(event),
  });
  const paper = {
    paperId: 'same-paper',
    title: 'Same paper',
    authors: ['Kim'],
    url: 'https://example.com/same-paper',
  };

  const [first, second] = await Promise.all([savePaper(paper), savePaper(paper)]);

  assert.equal(first.duplicate, false);
  assert.equal(second.duplicate, true);
  assert.equal(first.filename, second.filename);
  assert.equal(identityCount, 1);
  assert.equal(created.length, 1);
});

test('createPaperNoteSaver rejects malformed browser payloads before writing', async () => {
  let writes = 0;
  const savePaper = createPaperNoteSaver({
    findActivePaper: () => null,
    createNoteIdentity: () => identity,
    saveNote: async () => { writes += 1; },
    cleanupNote: async () => {},
    onCreated: async () => {},
  });

  await assert.rejects(savePaper({ paperId: 'missing-title' }), error => error.statusCode === 400);
  assert.equal(writes, 0);
});
