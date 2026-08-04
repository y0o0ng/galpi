'use strict';

const VALID_PROGRESS_STAGES = new Set([
  'context',
  'evidence',
  'web_search',
  'paper_search',
  'paper_read',
  'attachment_parse',
  'attachment_search',
  'attachment_read',
  'schedule_prepare',
  'answer',
  'council_draft',
  'council_critique',
  'council_review',
  'council_synthesis',
]);

const TOOL_PROGRESS_STAGES = {
  web_search: 'web_search',
  paper_fulltext_search: 'paper_search',
  paper_fulltext_read: 'paper_read',
  attachment_document_search: 'attachment_search',
  attachment_document_read: 'attachment_read',
  schedule_prepare: 'schedule_prepare',
};

function progressStageForTool(toolName) {
  return TOOL_PROGRESS_STAGES[toolName] || null;
}

function createProgressStream(res, { enabled = false } = {}) {
  let started = false;
  let ended = false;
  let lastStage = null;

  function start() {
    if (started || ended) return;
    started = true;
    res.status(200);
    res.set({
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders?.();
  }

  function write(event) {
    if (!enabled || ended || res.writableEnded || res.destroyed) return enabled;
    start();
    try {
      res.write(`${JSON.stringify(event)}\n`);
    } catch {
      ended = true;
    }
    return true;
  }

  function finish(event) {
    if (!enabled) return false;
    if (ended || res.writableEnded || res.destroyed) return true;
    write(event);
    if (!ended && !res.writableEnded && !res.destroyed) res.end();
    ended = true;
    return true;
  }

  return {
    stage(stage) {
      if (!VALID_PROGRESS_STAGES.has(stage) || stage === lastStage) return false;
      if (!write({ type: 'stage', stage })) return false;
      lastStage = stage;
      return true;
    },
    // 음성이 문장 하나가 완성되는 즉시 읽기 시작하도록 조각을 먼저 보낸다.
    // 화면 답변은 기존대로 result 한 번으로만 온다.
    speech(text) {
      const value = String(text || '').trim();
      if (!value) return false;
      return write({ type: 'speech', text: value });
    },
    result(data) {
      return finish({ type: 'result', data });
    },
    error(error, status = 500) {
      return finish({
        type: 'error',
        error: String(error || '요청 처리 중 오류가 발생했습니다.'),
        status,
      });
    },
  };
}

module.exports = {
  VALID_PROGRESS_STAGES,
  createProgressStream,
  progressStageForTool,
};
