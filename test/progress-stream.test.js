'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createProgressStream,
  progressStageForTool,
} = require('../lib/progress-stream');

function createResponse() {
  return {
    statusCode: null,
    headers: {},
    chunks: [],
    writableEnded: false,
    destroyed: false,
    flushed: false,
    status(code) {
      this.statusCode = code;
      return this;
    },
    set(headers) {
      Object.assign(this.headers, headers);
      return this;
    },
    flushHeaders() {
      this.flushed = true;
    },
    write(chunk) {
      this.chunks.push(chunk);
      return true;
    },
    end() {
      this.writableEnded = true;
    },
  };
}

function parseEvents(response) {
  return response.chunks.map(chunk => JSON.parse(chunk.trim()));
}

test('disabled progress stream leaves the regular JSON response untouched', () => {
  const response = createResponse();
  const progress = createProgressStream(response);

  assert.equal(progress.stage('context'), false);
  assert.equal(progress.result({ ok: true }), false);
  assert.equal(progress.error('failed'), false);
  assert.equal(response.statusCode, null);
  assert.deepEqual(response.chunks, []);
  assert.equal(response.writableEnded, false);
});

test('progress stream writes valid NDJSON stages and a terminal result', () => {
  const response = createResponse();
  const progress = createProgressStream(response, { enabled: true });

  assert.equal(progress.stage('context'), true);
  assert.equal(progress.stage('context'), false);
  assert.equal(progress.stage('answer'), true);
  assert.equal(progress.result({ reply: 'done' }), true);

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['Content-Type'], 'application/x-ndjson; charset=utf-8');
  assert.equal(response.headers['X-Accel-Buffering'], 'no');
  assert.equal(response.flushed, true);
  assert.equal(response.writableEnded, true);
  assert.deepEqual(parseEvents(response), [
    { type: 'stage', stage: 'context' },
    { type: 'stage', stage: 'answer' },
    { type: 'result', data: { reply: 'done' } },
  ]);
});

test('unknown stages are ignored and tool names map to public stage identifiers', () => {
  const response = createResponse();
  const progress = createProgressStream(response, { enabled: true });

  assert.equal(progress.stage('private_reasoning'), false);
  assert.deepEqual(response.chunks, []);
  assert.equal(progressStageForTool('web_search'), 'web_search');
  assert.equal(progressStageForTool('paper_fulltext_search'), 'paper_search');
  assert.equal(progressStageForTool('paper_fulltext_read'), 'paper_read');
  assert.equal(progressStageForTool('attachment_document_search'), 'attachment_search');
  assert.equal(progressStageForTool('attachment_document_read'), 'attachment_read');
  assert.equal(progressStageForTool('schedule_prepare'), 'schedule_prepare');
  assert.equal(progressStageForTool('unknown'), null);
});

test('progress stream sends errors as a terminal event', () => {
  const response = createResponse();
  const progress = createProgressStream(response, { enabled: true });

  progress.stage('evidence');
  assert.equal(progress.error('검색 실패', 503), true);
  assert.equal(progress.result({ ignored: true }), true);

  assert.deepEqual(parseEvents(response), [
    { type: 'stage', stage: 'evidence' },
    { type: 'error', error: '검색 실패', status: 503 },
  ]);
});
