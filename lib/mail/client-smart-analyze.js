'use strict';

const { internals: { parseKstDate } } = require('../assistant-tasks');
const { SYSTEM_PROMPT, DECISION_SCHEMA, PROMPT_VERSION, buildPrompt, buildHints, validateDecision } = require('./analyze');
const { clientError } = require('./client-message');

function validDeadline(kind, date, at) {
  if (kind === 'datetime') return Number.isSafeInteger(at) && at >= 0;
  if (kind !== 'date') return false;
  try { return Boolean(parseKstDate(date)); } catch { return false; }
}

async function classify({ callModel, model, normalized, receivedAt, labels, preferences, history }) {
  const hints = buildHints({ senderAddress: normalized.from?.address, labels, history, preferences, normalized });
  const output = await callModel({
    model, system: SYSTEM_PROMPT, input: buildPrompt({ normalized, hints, receivedAt, nowSeconds: receivedAt }),
    schema: DECISION_SCHEMA, schemaName: 'mail_workspace_classification',
  });
  const confidence = value => Number.isFinite(value) && value >= 0 && value <= 1;
  const invalid = () => clientError('MAIL_CLIENT_SMART_MODEL_OUTPUT_INVALID', 502);
  if (!output || typeof output !== 'object' || Object.keys(output).length !== DECISION_SCHEMA.required.length
    || typeof output.summary !== 'string' || (output.action !== null && typeof output.action !== 'string')
    || typeof output.reason !== 'string' || typeof output.attentionRequired !== 'boolean'
    || typeof output.needsAttachmentAnalysis !== 'boolean'
    || !confidence(output.importance) || !confidence(output.confidence)) throw invalid();
  const { deadline } = output;
  if (!deadline || Object.keys(deadline).length !== 3 || !['none', 'date', 'datetime'].includes(deadline.kind)
    || (deadline.kind === 'date' ? typeof deadline.date !== 'string' : deadline.date !== null)
    || (deadline.kind === 'datetime' ? typeof deadline.at !== 'string' : deadline.at !== null)) throw invalid();
  let decision;
  try { decision = validateDecision(output); } catch { throw invalid(); }
  if (deadline.kind !== 'none' && (deadline.kind !== decision.deadlineKind
    || !validDeadline(decision.deadlineKind, decision.deadlineDate, decision.deadlineAt))) throw invalid();
  const { category, importance, summary, actionText, notificationMode, decisionConfidence,
    needsAttachmentAnalysis } = decision;
  return {
    result: { category, importance, summary: summary?.slice(0, 500) ?? null, actionText: actionText?.slice(0, 500) ?? null,
      // Only the calendar result has a source quote and a server-resolved date.
      deadlineKind: 'none', deadlineDate: null, deadlineAt: null, notificationMode, decisionConfidence },
    promptVersion: PROMPT_VERSION,
    incomplete: [normalized.truncated && 'source_truncated', needsAttachmentAnalysis && 'attachment_required'].filter(Boolean),
  };
}

module.exports = { classify, validDeadline };
