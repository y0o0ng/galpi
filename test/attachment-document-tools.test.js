'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  MAX_CONTEXT_CHARS_PER_ANSWER,
  MAX_RESULT_CHARS_PER_CALL,
  createAttachmentDocumentTools,
} = require('../lib/attachment-document-tools');

const ATTACHMENT_ID = 'att_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

function createService() {
  return {
    listCandidates({ sessionId }) {
      if (sessionId !== 'shared-main') return [];
      return [{
        attachmentId: ATTACHMENT_ID,
        filename: '로드맵.md',
        kind: 'markdown',
        scope: 'temporary',
        pageCount: null,
        lineCount: 180,
        charCount: 12000,
        chunkCount: 8,
      }];
    },
    searchDocument({ attachmentId, query, mode, limit }) {
      assert.equal(attachmentId, ATTACHMENT_ID);
      assert.equal(query, '검색 향상 검증');
      assert.equal(mode, 'focused');
      assert.equal(limit, 4);
      return [{
        chunkId: 'atch_search',
        heading: '검색 향상 검증',
        pageStart: null,
        pageEnd: null,
        lineStart: 120,
        lineEnd: 148,
        text: `핵심 근거 ${'긴 본문 '.repeat(1200)}`,
      }];
    },
    readDocument({ attachmentId, chunkId, adjacentLimit }) {
      assert.equal(attachmentId, ATTACHMENT_ID);
      assert.equal(chunkId, 'atch_search');
      assert.equal(adjacentLimit, 2);
      return [{
        chunkId: 'atch_neighbor',
        heading: '다음 단계',
        pageStart: null,
        pageEnd: null,
        lineStart: 149,
        lineEnd: 165,
        text: `주변 근거 ${'추가 본문 '.repeat(1200)}`,
      }];
    },
  };
}

test('attachment tools expose only turn candidates and enforce search then bounded read', async () => {
  const tools = createAttachmentDocumentTools({ documentService: createService() });
  const session = tools.createSession({ sessionId: 'shared-main' });
  assert.equal(session.hasCandidates, true);
  assert.equal(session.hasTemporaryCandidates, true);
  assert.deepEqual(session.getToolDefinitions().map(tool => tool.name), [
    'attachment_document_search',
  ]);

  const search = await session.execute('attachment_document_search', {
    attachmentId: ATTACHMENT_ID,
    query: '검색 향상 검증',
    mode: 'focused',
  });
  assert.equal(search.payload.success, true);
  assert.ok(search.content.length <= MAX_RESULT_CHARS_PER_CALL);
  assert.equal(search.payload.evidence[0].filename, '로드맵.md');
  assert.equal(search.payload.evidence[0].heading, '검색 향상 검증');
  assert.equal(search.payload.evidence[0].lineStart, 120);
  assert.equal(search.payload.evidence[0].lineEnd, 148);
  assert.equal(search.payload.truncated, true);
  assert.deepEqual(session.getToolDefinitions().map(tool => tool.name), [
    'attachment_document_read',
  ]);

  const read = await session.execute('attachment_document_read', {
    attachmentId: ATTACHMENT_ID,
    chunkId: 'atch_search',
  });
  assert.equal(read.payload.success, true);
  assert.ok(read.content.length <= MAX_RESULT_CHARS_PER_CALL);
  assert.ok(session.getUsage().contextChars <= MAX_CONTEXT_CHARS_PER_ANSWER);
  assert.deepEqual(session.getEvidenceRefs(), [{
    attachmentId: ATTACHMENT_ID,
    chunkIds: ['atch_search', 'atch_neighbor'],
  }]);
  assert.deepEqual(session.getToolDefinitions(), []);
});

test('attachment tools fail closed for sessions without an active candidate', () => {
  const tools = createAttachmentDocumentTools({ documentService: createService() });
  const session = tools.createSession({ sessionId: 'other-session' });
  assert.equal(session.hasCandidates, false);
  assert.equal(session.hasTemporaryCandidates, false);
  assert.deepEqual(session.candidates, []);
  assert.deepEqual(session.getToolDefinitions(), []);
});

test('library-only candidates keep document tools without blocking ordinary topic saving', () => {
  const service = createService();
  service.listCandidates = ({ libraryNoteFilenames }) => libraryNoteFilenames?.includes('attachment-roadmap.md')
    ? [{
      attachmentId: ATTACHMENT_ID,
      filename: '로드맵.md',
      kind: 'markdown',
      scope: 'library',
      pageCount: null,
      lineCount: 180,
      charCount: 12000,
      chunkCount: 8,
    }]
    : [];
  const tools = createAttachmentDocumentTools({ documentService: service });
  const session = tools.createSession({
    sessionId: 'shared-main',
    libraryNoteFilenames: ['attachment-roadmap.md'],
  });
  assert.equal(session.hasCandidates, true);
  assert.equal(session.hasTemporaryCandidates, false);
  assert.deepEqual(session.getToolDefinitions().map(tool => tool.name), [
    'attachment_document_search',
  ]);
});

test('a temporary replay still blocks saving when library candidates fill the tool limit', () => {
  const service = createService();
  service.listCandidates = () => Array.from({ length: 3 }, (_, index) => ({
    attachmentId: `att_${String(index + 1).repeat(32)}`,
    filename: `서재 문서 ${index + 1}.md`,
    kind: 'markdown',
    scope: 'library',
  }));
  service.hasTemporaryCandidates = () => true;
  const tools = createAttachmentDocumentTools({ documentService: service });
  const session = tools.createSession({
    sessionId: 'shared-main',
    libraryNoteFilenames: ['one.md', 'two.md', 'three.md'],
  });
  assert.equal(session.candidates.length, 3);
  assert.equal(session.hasTemporaryCandidates, true);
});
