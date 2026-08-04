'use strict';

const MAX_CANDIDATE_ATTACHMENTS = 3;
const MAX_TOOL_CALLS = 2;
const MAX_CHUNKS_PER_SEARCH = 4;
const MAX_RESULT_CHARS_PER_CALL = 5000;
const MAX_CONTEXT_CHARS_PER_ANSWER = 10000;

function cleanEvidenceItem(item, candidate) {
  return {
    attachmentId: candidate.attachmentId,
    filename: candidate.filename,
    kind: candidate.kind,
    chunkId: String(item?.chunkId || '').slice(0, 100),
    heading: item?.heading ? String(item.heading).slice(0, 240) : null,
    pageStart: Number.isInteger(item?.pageStart) ? item.pageStart : null,
    pageEnd: Number.isInteger(item?.pageEnd) ? item.pageEnd : null,
    lineStart: Number.isInteger(item?.lineStart) ? item.lineStart : null,
    lineEnd: Number.isInteger(item?.lineEnd) ? item.lineEnd : null,
    text: String(item?.text || ''),
  };
}

function fitToolPayload(base, evidence, maxChars = MAX_RESULT_CHARS_PER_CALL) {
  const boundedMax = Math.max(500, Math.min(MAX_RESULT_CHARS_PER_CALL, maxChars));
  const items = [];
  let truncated = false;

  for (const source of evidence) {
    const item = { ...source, text: String(source.text || '') };
    const makePayload = text => ({
      ...base,
      evidence: [...items, { ...item, text }],
      truncated: true,
    });
    const full = makePayload(item.text);
    full.truncated = false;
    if (JSON.stringify(full).length <= boundedMax) {
      items.push(item);
      continue;
    }
    let low = 0;
    let high = item.text.length;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (JSON.stringify(makePayload(item.text.slice(0, middle))).length <= boundedMax) low = middle;
      else high = middle - 1;
    }
    if (low > 0) items.push({ ...item, text: item.text.slice(0, low) });
    truncated = true;
    break;
  }
  if (items.length < evidence.length) truncated = true;
  return {
    payload: { ...base, evidence: items, truncated },
    content: JSON.stringify({ ...base, evidence: items, truncated }),
  };
}

function createAttachmentDocumentTools({ documentService } = {}) {
  if (
    !documentService?.listCandidates
    || !documentService?.searchDocument
    || !documentService?.readDocument
  ) {
    throw new TypeError('첨부 문서 서비스가 필요합니다.');
  }

  function createSession({ sessionId, attachmentIds = [], libraryNoteFilenames = [] } = {}) {
    const candidateRequest = {
      sessionId,
      attachmentIds,
      libraryNoteFilenames,
      limit: MAX_CANDIDATE_ATTACHMENTS,
    };
    const candidates = documentService.listCandidates(candidateRequest);
    const hasTemporaryCandidates = documentService.hasTemporaryCandidates
      ? documentService.hasTemporaryCandidates(candidateRequest)
      : candidates.some(candidate => candidate.scope === 'temporary');
    const candidateMap = new Map(candidates.map(candidate => [candidate.attachmentId, candidate]));
    const allowedChunks = new Map();
    const evidenceByChunk = new Map();
    let calls = 0;
    let usedChars = 0;
    let phase = 'search';

    function getToolDefinitions() {
      if (candidates.length === 0 || calls >= MAX_TOOL_CALLS || phase === 'done') return [];
      if (phase === 'search') {
        const available = candidates
          .map(candidate => `${candidate.attachmentId}: ${candidate.filename}`)
          .join('; ');
        return [{
          name: 'attachment_document_search',
          description: `Search only the current, replay-window, or resolved library attachments available to this chat turn. Use focused for a specific question and overview for a summary or broad review. Available attachments: ${available}`,
          input_schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              attachmentId: {
                type: 'string',
                enum: candidates.map(candidate => candidate.attachmentId),
              },
              query: { type: 'string', minLength: 1, maxLength: 300 },
              mode: { type: 'string', enum: ['focused', 'overview'] },
            },
            required: ['attachmentId', 'query', 'mode'],
          },
        }];
      }
      const attachmentIdsForRead = [...new Set(allowedChunks.values())];
      return allowedChunks.size > 0 ? [{
        name: 'attachment_document_read',
        description: 'Read at most two neighboring chunks only when the preceding attachment search evidence is insufficient. Use only an attachmentId and chunkId returned by that search.',
        input_schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            attachmentId: { type: 'string', enum: attachmentIdsForRead },
            chunkId: { type: 'string', enum: [...allowedChunks.keys()] },
          },
          required: ['attachmentId', 'chunkId'],
        },
      }] : [];
    }

    function finishResult(base, rows = []) {
      const remaining = Math.max(500, MAX_CONTEXT_CHARS_PER_ANSWER - usedChars);
      const result = fitToolPayload(base, rows, Math.min(MAX_RESULT_CHARS_PER_CALL, remaining));
      usedChars += result.content.length;
      for (const item of result.payload.evidence) evidenceByChunk.set(item.chunkId, item);
      return result;
    }

    async function execute(name, input = {}) {
      if (calls >= MAX_TOOL_CALLS) {
        return {
          payload: {
            success: false,
            code: 'tool_call_limit',
            error: '첨부 문서 도구 호출은 답변당 최대 2회입니다.',
          },
          content: '',
        };
      }
      calls += 1;
      try {
        if (name === 'attachment_document_search' && phase === 'search') {
          const attachmentId = String(input.attachmentId || '').trim();
          const query = String(input.query || '').trim();
          const mode = input.mode === 'focused' ? 'focused' : input.mode === 'overview' ? 'overview' : '';
          const candidate = candidateMap.get(attachmentId);
          if (!candidate) throw Object.assign(new Error('현재 턴에서 허용된 첨부가 아닙니다.'), { code: 'attachment_not_allowed' });
          if (!query || query.length > 300 || !mode) {
            throw Object.assign(new Error('첨부 검색 입력이 올바르지 않습니다.'), { code: 'invalid_tool_input' });
          }
          const rows = documentService.searchDocument({
            attachmentId,
            query,
            mode,
            limit: MAX_CHUNKS_PER_SEARCH,
          }).map(row => cleanEvidenceItem(row, candidate));
          const result = finishResult({
            success: true,
            tool: name,
            attachmentId,
            filename: candidate.filename,
            kind: candidate.kind,
            mode,
          }, rows);
          for (const row of result.payload.evidence) allowedChunks.set(row.chunkId, attachmentId);
          phase = allowedChunks.size > 0 && calls < MAX_TOOL_CALLS ? 'read' : 'done';
          return result;
        }

        if (name === 'attachment_document_read' && phase === 'read') {
          const attachmentId = String(input.attachmentId || '').trim();
          const chunkId = String(input.chunkId || '').trim();
          if (allowedChunks.get(chunkId) !== attachmentId) {
            throw Object.assign(new Error('직전 첨부 검색이 반환한 청크만 읽을 수 있습니다.'), { code: 'chunk_not_allowed' });
          }
          const candidate = candidateMap.get(attachmentId);
          const rows = documentService.readDocument({
            attachmentId,
            chunkId,
            adjacentLimit: 2,
          }).map(row => cleanEvidenceItem(row, candidate));
          phase = 'done';
          return finishResult({
            success: true,
            tool: name,
            attachmentId,
            filename: candidate.filename,
            kind: candidate.kind,
            anchorChunkId: chunkId,
          }, rows);
        }
        throw Object.assign(new Error('허용되지 않은 첨부 도구 호출 순서입니다.'), { code: 'invalid_tool_sequence' });
      } catch (error) {
        phase = 'done';
        return finishResult({
          success: false,
          code: String(error?.code || 'attachment_document_failed').slice(0, 80),
          error: String(error?.message || '첨부 문서 도구 실행에 실패했습니다.').slice(0, 500),
        });
      }
    }

    function getEvidenceRefs() {
      const grouped = new Map();
      for (const item of evidenceByChunk.values()) {
        if (!grouped.has(item.attachmentId)) grouped.set(item.attachmentId, []);
        grouped.get(item.attachmentId).push(item.chunkId);
      }
      return [...grouped.entries()].map(([attachmentId, chunkIds]) => ({ attachmentId, chunkIds }));
    }

    return {
      candidates,
      execute,
      getEvidence: () => [...evidenceByChunk.values()],
      getEvidenceRefs,
      getToolDefinitions,
      getUsage: () => ({ calls, contextChars: usedChars }),
      hasCandidates: candidates.length > 0,
      hasTemporaryCandidates,
    };
  }

  return { createSession };
}

module.exports = {
  MAX_CANDIDATE_ATTACHMENTS,
  MAX_CHUNKS_PER_SEARCH,
  MAX_CONTEXT_CHARS_PER_ANSWER,
  MAX_RESULT_CHARS_PER_CALL,
  MAX_TOOL_CALLS,
  createAttachmentDocumentTools,
  fitToolPayload,
};
