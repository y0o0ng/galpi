'use strict';

const { internals: { parseKstDate } } = require('../assistant-tasks');
const { SYSTEM_PROMPT, DECISION_SCHEMA, PROMPT_VERSION, buildPrompt, buildHints, validateDecision } = require('./analyze');
const { clientError } = require('./client-message');

const ACTION_TYPES = ['reply', 'confirm', 'submit', null];
const WORKSPACE_SCHEMA = {
  ...DECISION_SCHEMA,
  required: [...DECISION_SCHEMA.required, 'actionType'],
  properties: { ...DECISION_SCHEMA.properties, actionType: { type: ['string', 'null'], enum: ACTION_TYPES } },
};
const WORKSPACE_PROMPT = SYSTEM_PROMPT + '\n' + [
  'actionType은 위 category와 별도로 사용자가 해야 할 주된 조치 하나를 분류한다.',
  'reply는 이 메일에 답장을 보내야 할 때, confirm은 내용·참석·수신 등의 확인이나 확인 응답이 필요할 때,',
  'submit은 과제·서류·자료를 제출해야 할 때 사용한다. 확인이나 제출을 위한 응답은 단순 답장보다 구체적인 유형을 우선한다.',
  'action_required 또는 실행할 action이 있는 urgent에만 유형을 지정한다. 근거가 모호하면 null을 사용한다.',
].join('\n');

function validDeadline(kind, date, at) {
  if (kind === 'datetime') return Number.isSafeInteger(at) && at >= 0;
  if (kind !== 'date') return false;
  try { return Boolean(parseKstDate(date)); } catch { return false; }
}

async function classify({ callModel, model, normalized, receivedAt, labels, preferences, history }) {
  const hints = buildHints({ senderAddress: normalized.from?.address, labels, history, preferences, normalized });
  const output = await callModel({
    model, system: WORKSPACE_PROMPT, input: buildPrompt({ normalized, hints, receivedAt, nowSeconds: receivedAt }),
    schema: WORKSPACE_SCHEMA, schemaName: 'mail_workspace_classification',
  });
  const confidence = value => Number.isFinite(value) && value >= 0 && value <= 1;
  const invalid = () => clientError('MAIL_CLIENT_SMART_MODEL_OUTPUT_INVALID', 502);
  if (!output || typeof output !== 'object' || Object.keys(output).length !== WORKSPACE_SCHEMA.required.length
    || !ACTION_TYPES.includes(output.actionType)
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
  const actionType = category === 'action_required' || (category === 'urgent' && actionText?.trim()) ? output.actionType : null;
  return {
    result: { category, importance, actionType, summary: summary?.slice(0, 500) ?? null, actionText: actionText?.slice(0, 500) ?? null,
      // Only the calendar result has a source quote and a server-resolved date.
      deadlineKind: 'none', deadlineDate: null, deadlineAt: null, notificationMode, decisionConfidence },
    promptVersion: PROMPT_VERSION + '+workspace-action-type-v1',
    incomplete: [normalized.truncated && 'source_truncated', needsAttachmentAnalysis && 'attachment_required'].filter(Boolean),
  };
}

module.exports = { classify, validDeadline };
