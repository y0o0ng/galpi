'use strict';

const DEFAULT_CHAT_SESSION_ID = 'shared-main';
const MAX_FILLER_LENGTH = 2;
const PUNCTUATION_RE = /[\p{P}\p{S}\p{Z}\s]/gu;

// 2026-07-31 실기기 표본에서 헛기침이 만든 corrected transcript 실측값과 같은 부류의
// 단일 음절만 넣는다. 영어 표본은 아직 관찰하지 못해 최소한만 둔다.
const FILLER_TOKENS = new Set([
  '하', '그', '음', '흥', '흠', '으',
  'uh', 'um', 'hm', 'er', 'ah',
]);

const ASSISTANT_STATUSES = new Set(['completed', 'cancelled', 'failed', 'incomplete']);

function substantiveText(value) {
  if (typeof value !== 'string') return '';
  return value.replace(PUNCTUATION_RE, '');
}

/**
 * 헛기침이 만든 빈·무의미 사용자 턴을 `shared-main`에서 제외한다.
 * 문장부호를 벗기면 남는 것이 없거나, 짧은 필러이면서 정상 완료된 답변이 따르지 않은 턴만 막는다.
 * false interruption은 정의상 진행 중인 응답을 끊으므로 `completed` assistant가 없고,
 * 사용자의 실제 짧은 대답에는 `completed` 응답이 따른다.
 */
function isPersistableUserTurn(correctedTranscript, { assistantStatus = null } = {}) {
  const substantive = substantiveText(correctedTranscript);
  if (!substantive) return false;
  if (assistantStatus === 'completed') return true;
  if (substantive.length > MAX_FILLER_LENGTH) return true;
  const normalized = substantive.toLowerCase();
  if (FILLER_TOKENS.has(normalized)) return false;
  return !Array.from(normalized).every(char => FILLER_TOKENS.has(char));
}

function normalizeAssistantStatus(value) {
  return ASSISTANT_STATUSES.has(value) ? value : null;
}

function createRealtimeTurnStore({
  db,
  enabled = false,
  insertMessage,
  chatSessionId = DEFAULT_CHAT_SESSION_ID,
  isPersistable = isPersistableUserTurn,
} = {}) {
  const available = enabled === true
    && Boolean(db?.prepare)
    && typeof insertMessage === 'function';

  if (!available) {
    return {
      available: false,
      publicConfig: () => ({ finalizeEnabled: false }),
      getReceipt: () => null,
      recordCorrection: () => { throw new Error('Realtime 턴 저장이 비활성화되어 있습니다.'); },
      recordAssistant: () => { throw new Error('Realtime 턴 저장이 비활성화되어 있습니다.'); },
    };
  }

  const selectReceipt = db.prepare(`
    SELECT * FROM realtime_turn_receipts
    WHERE session_id = ? AND input_item_id = ?
  `);
  const insertReceipt = db.prepare(`
    INSERT INTO realtime_turn_receipts (session_id, input_item_id, status)
    VALUES (?, ?, 'correction_pending')
  `);
  const updateCorrection = db.prepare(`
    UPDATE realtime_turn_receipts SET
      corrected_transcript = @correctedTranscript,
      transcript_origin = @transcriptOrigin,
      transcription_model = @transcriptionModel,
      usage_json = @usageJson,
      audio_sha256 = COALESCE(audio_sha256, @audioSha256),
      status = 'corrected',
      updated_at = strftime('%s','now')
    WHERE id = @id
  `);
  const updateAssistant = db.prepare(`
    UPDATE realtime_turn_receipts SET
      final_response_id = COALESCE(@finalResponseId, final_response_id),
      assistant_transcript = @assistantTranscript,
      assistant_status = @assistantStatus,
      updated_at = strftime('%s','now')
    WHERE id = @id
  `);
  const markFinalized = db.prepare(`
    UPDATE realtime_turn_receipts SET
      status = 'finalized',
      user_message_id = @userMessageId,
      assistant_message_id = @assistantMessageId,
      finalized_at = strftime('%s','now'),
      updated_at = strftime('%s','now')
    WHERE id = @id
  `);
  const markDiscarded = db.prepare(`
    UPDATE realtime_turn_receipts SET
      status = 'discarded',
      error_code = @errorCode,
      updated_at = strftime('%s','now')
    WHERE id = @id
  `);

  function ensureReceipt(sessionId, inputItemId) {
    const existing = selectReceipt.get(sessionId, inputItemId);
    if (existing) return existing;
    insertReceipt.run(sessionId, inputItemId);
    return selectReceipt.get(sessionId, inputItemId);
  }

  function describe(receipt) {
    return {
      status: receipt.status,
      userMessageId: receipt.user_message_id,
      assistantMessageId: receipt.assistant_message_id,
      finalized: receipt.status === 'finalized',
      discarded: receipt.status === 'discarded',
    };
  }

  // corrected transcript와 assistant 결말이 모두 모인 뒤에만, 한 transaction 안에서 확정한다.
  function tryFinalize(receipt) {
    if (receipt.status === 'finalized' || receipt.status === 'discarded') {
      return describe(receipt);
    }
    if (receipt.corrected_transcript === null || receipt.assistant_status === null) {
      return describe(receipt);
    }
    if (!isPersistable(receipt.corrected_transcript, {
      assistantStatus: receipt.assistant_status,
    })) {
      markDiscarded.run({ id: receipt.id, errorCode: 'empty_turn' });
      return describe(selectReceipt.get(receipt.session_id, receipt.input_item_id));
    }
    // user 행이 assistant 행보다 작은 messages.id를 가져야 과거 대화 검색이 답변을 옳게 짝짓는다.
    const userMessageId = insertMessage({
      sessionId: chatSessionId,
      role: 'user',
      content: receipt.corrected_transcript,
    });
    const assistantMessageId = receipt.assistant_status === 'completed'
      && typeof receipt.assistant_transcript === 'string'
      && receipt.assistant_transcript.length > 0
      ? insertMessage({
        sessionId: chatSessionId,
        role: 'assistant',
        content: receipt.assistant_transcript,
      })
      : null;
    markFinalized.run({ id: receipt.id, userMessageId, assistantMessageId });
    return describe(selectReceipt.get(receipt.session_id, receipt.input_item_id));
  }

  const recordCorrection = db.transaction(({
    sessionId,
    inputItemId,
    correctedTranscript,
    transcriptOrigin = 'stt_corrected',
    transcriptionModel = null,
    usage = null,
    audioSha256 = null,
  }) => {
    const receipt = ensureReceipt(sessionId, inputItemId);
    if (receipt.status === 'finalized' || receipt.status === 'discarded') {
      return describe(receipt);
    }
    updateCorrection.run({
      id: receipt.id,
      correctedTranscript: String(correctedTranscript ?? ''),
      transcriptOrigin,
      transcriptionModel,
      usageJson: usage ? JSON.stringify(usage) : null,
      audioSha256,
    });
    return tryFinalize(selectReceipt.get(sessionId, inputItemId));
  });

  const recordAssistant = db.transaction(({
    sessionId,
    inputItemId,
    finalResponseId = null,
    assistantTranscript = null,
    assistantStatus,
  }) => {
    const receipt = ensureReceipt(sessionId, inputItemId);
    if (receipt.status === 'finalized' || receipt.status === 'discarded') {
      return describe(receipt);
    }
    updateAssistant.run({
      id: receipt.id,
      finalResponseId,
      // partial text는 durable 본문으로 남기지 않는다.
      assistantTranscript: assistantStatus === 'completed' ? assistantTranscript : null,
      assistantStatus: normalizeAssistantStatus(assistantStatus),
    });
    return tryFinalize(selectReceipt.get(sessionId, inputItemId));
  });

  return {
    available: true,
    publicConfig: () => ({ finalizeEnabled: true }),
    getReceipt: ({ sessionId, inputItemId }) => {
      const receipt = selectReceipt.get(sessionId, inputItemId);
      return receipt ? describe(receipt) : null;
    },
    recordCorrection,
    recordAssistant,
  };
}

module.exports = {
  DEFAULT_CHAT_SESSION_ID,
  FILLER_TOKENS,
  createRealtimeTurnStore,
  isPersistableUserTurn,
};
