'use strict';

const crypto = require('node:crypto');

const CANDIDATE_FIXTURE_NAME = 'xion-local-memory-inference-p1b6-skeleton-candidates-v1';
const REVIEW_PROTOCOL_VERSION = 'xion-p1b6-skeleton-human-pass1-v1';
const REVIEW_RECEIPT_NAME = 'xion-local-memory-inference-p1b6-skeleton-human-pass1-receipt-v1';
const SPLIT_ASSIGNMENTS = Object.freeze(['TRAIN', 'DEV', 'FINAL_HELD_OUT']);
const AMBIGUITY_LABELS = Object.freeze(['CLEAR', 'ESCALATE']);
const DISPOSITIONS = Object.freeze(['KEEP', 'FIX', 'REJECT']);
const BOUNDARY_CLASSES = Object.freeze([
  'FINALITY / COMMITMENT',
  'REVISION / CONFLICT',
  'PERSISTENCE / EXCEPTION',
  'REFERENT',
  'SCOPE / APPLICABILITY',
  'ACTUALITY',
  'COMPLEMENTARY EVIDENCE',
  'APPROXIMATION / RANGE',
]);
const SKELETON_ID_PATTERN = /^p1b6-sk-[0-9a-f]{16}$/u;
const CONTRAST_GROUP_ID_PATTERN = /^p1b6-cg-[0-9a-f]{16}$/u;
const MAX_FOCUS_LENGTH = 300;
const MAX_RELATION_LENGTH = 300;
const MAX_DECISION_BASIS_LENGTH = 600;

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value, required, optional = []) {
  if (!isPlainObject(value)) return false;
  const keys = Object.keys(value);
  const allowed = new Set([...required, ...optional]);
  return required.every(key => Object.hasOwn(value, key))
    && keys.every(key => allowed.has(key));
}

function isBoundedNonEmptyString(value, maximumLength) {
  return typeof value === 'string' && value.trim() !== '' && value.length <= maximumLength;
}

function validateSkeletonCandidateFixture(fixture) {
  if (!hasExactKeys(fixture, ['name', 'candidates'])) {
    throw new TypeError('P1-B6 skeleton candidate fixture에는 name과 candidates만 있어야 합니다.');
  }
  if (
    fixture.name !== CANDIDATE_FIXTURE_NAME
    || !Array.isArray(fixture.candidates)
    || fixture.candidates.length === 0
  ) {
    throw new TypeError('P1-B6 skeleton candidate fixture identity가 올바르지 않습니다.');
  }

  const ids = new Set();
  const contrastSplits = new Map();
  for (const candidate of fixture.candidates) {
    if (!hasExactKeys(candidate, [
      'semanticSkeletonId',
      'splitAssignment',
      'boundaryClass',
      'intendedLabel',
      'candidateFocus',
      'semanticRelations',
      'decisionBasis',
    ], ['contrastGroupId'])) {
      throw new TypeError('P1-B6 skeleton candidate keys가 올바르지 않습니다.');
    }
    if (!SKELETON_ID_PATTERN.test(candidate.semanticSkeletonId)) {
      throw new TypeError('semanticSkeletonId는 의미를 인코딩하지 않는 opaque P1-B6 ID여야 합니다.');
    }
    if (ids.has(candidate.semanticSkeletonId)) {
      throw new TypeError(`중복 semanticSkeletonId입니다: ${candidate.semanticSkeletonId}`);
    }
    ids.add(candidate.semanticSkeletonId);
    if (!SPLIT_ASSIGNMENTS.includes(candidate.splitAssignment)) {
      throw new TypeError(`splitAssignment가 올바르지 않습니다: ${candidate.semanticSkeletonId}`);
    }
    if (!BOUNDARY_CLASSES.includes(candidate.boundaryClass)) {
      throw new TypeError(`boundaryClass가 올바르지 않습니다: ${candidate.semanticSkeletonId}`);
    }
    if (!AMBIGUITY_LABELS.includes(candidate.intendedLabel)) {
      throw new TypeError(`intendedLabel이 올바르지 않습니다: ${candidate.semanticSkeletonId}`);
    }
    if (!isBoundedNonEmptyString(candidate.candidateFocus, MAX_FOCUS_LENGTH)) {
      throw new TypeError(`candidateFocus가 올바르지 않습니다: ${candidate.semanticSkeletonId}`);
    }
    if (
      !Array.isArray(candidate.semanticRelations)
      || candidate.semanticRelations.length < 2
      || candidate.semanticRelations.length > 5
      || candidate.semanticRelations.some(value => !isBoundedNonEmptyString(value, MAX_RELATION_LENGTH))
    ) {
      throw new TypeError(`semanticRelations는 2–5개의 bounded non-empty 문자열이어야 합니다: ${candidate.semanticSkeletonId}`);
    }
    if (!isBoundedNonEmptyString(candidate.decisionBasis, MAX_DECISION_BASIS_LENGTH)) {
      throw new TypeError(`decisionBasis가 올바르지 않습니다: ${candidate.semanticSkeletonId}`);
    }
    const contrastGroupId = Object.hasOwn(candidate, 'contrastGroupId')
      ? candidate.contrastGroupId
      : null;
    if (contrastGroupId !== null && !CONTRAST_GROUP_ID_PATTERN.test(contrastGroupId)) {
      throw new TypeError(`contrastGroupId는 null 또는 opaque P1-B6 ID여야 합니다: ${candidate.semanticSkeletonId}`);
    }
    if (contrastGroupId !== null) {
      const priorSplit = contrastSplits.get(contrastGroupId);
      if (priorSplit && priorSplit !== candidate.splitAssignment) {
        throw new TypeError(`contrast group은 하나의 split에만 속해야 합니다: ${contrastGroupId}`);
      }
      contrastSplits.set(contrastGroupId, candidate.splitAssignment);
    }
  }
  return fixture;
}

function parseSkeletonCandidateFixture(rawBytes) {
  return validateSkeletonCandidateFixture(JSON.parse(Buffer.from(rawBytes).toString('utf8')));
}

function sha256RawBytes(rawBytes) {
  return crypto.createHash('sha256').update(rawBytes).digest('hex');
}

function deterministicReviewOrder(fixture) {
  validateSkeletonCandidateFixture(fixture);
  const order = fixture.candidates
    .map((candidate, canonicalIndex) => ({
      canonicalIndex,
      id: candidate.semanticSkeletonId,
      key: crypto.createHash('sha256')
        .update(`${REVIEW_PROTOCOL_VERSION}\0${candidate.semanticSkeletonId}`)
        .digest('hex'),
    }))
    .sort((left, right) => left.key.localeCompare(right.key) || left.id.localeCompare(right.id))
    .map(entry => entry.canonicalIndex);
  if (order.length > 1 && order.every((value, index) => value === index)) {
    order.push(order.shift());
  }
  return order;
}

function renderBlindReviewPrompt(candidate) {
  return [
    'Candidate focus:',
    candidate.candidateFocus,
    '',
    'Semantic relations:',
    ...candidate.semanticRelations.map(relation => `- ${relation}`),
  ].join('\n');
}

function validateDisposition(value) {
  if (!DISPOSITIONS.includes(value)) throw new TypeError('Disposition은 KEEP, FIX, REJECT 중 하나여야 합니다.');
  return value;
}

function validateAmbiguityLabel(value) {
  if (!AMBIGUITY_LABELS.includes(value)) throw new TypeError('Ambiguity label은 CLEAR 또는 ESCALATE여야 합니다.');
  return value;
}

function buildCompletedReviewReceipt({ fixture, fixtureSha256, reviewsById, completedAt }) {
  validateSkeletonCandidateFixture(fixture);
  if (!/^[0-9a-f]{64}$/u.test(fixtureSha256)) {
    throw new TypeError('candidate fixture SHA-256이 올바르지 않습니다.');
  }
  if (!(reviewsById instanceof Map) || reviewsById.size !== fixture.candidates.length) {
    throw new TypeError('모든 skeleton candidate의 Pass-1 결과가 있어야 합니다.');
  }
  if (new Date(completedAt).toISOString() !== completedAt) {
    throw new TypeError('completedAt은 canonical ISO timestamp여야 합니다.');
  }
  const results = fixture.candidates.map(candidate => {
    const result = reviewsById.get(candidate.semanticSkeletonId);
    if (!hasExactKeys(result, ['disposition', 'ambiguityLabel'])) {
      throw new TypeError(`Pass-1 결과가 올바르지 않습니다: ${candidate.semanticSkeletonId}`);
    }
    return {
      semanticSkeletonId: candidate.semanticSkeletonId,
      disposition: validateDisposition(result.disposition),
      ambiguityLabel: validateAmbiguityLabel(result.ambiguityLabel),
    };
  });
  return {
    name: REVIEW_RECEIPT_NAME,
    protocolVersion: REVIEW_PROTOCOL_VERSION,
    candidateFixture: fixture.name,
    candidateFixtureSha256: fixtureSha256,
    completedAt,
    results,
  };
}

function validateCompletedReviewReceipt(receipt, rawFixtureBytes) {
  const fixture = parseSkeletonCandidateFixture(rawFixtureBytes);
  if (!hasExactKeys(receipt, [
    'name',
    'protocolVersion',
    'candidateFixture',
    'candidateFixtureSha256',
    'completedAt',
    'results',
  ])) {
    throw new TypeError('P1-B6 Pass-1 receipt keys가 올바르지 않습니다.');
  }
  if (
    receipt.name !== REVIEW_RECEIPT_NAME
    || receipt.protocolVersion !== REVIEW_PROTOCOL_VERSION
    || receipt.candidateFixture !== fixture.name
    || receipt.candidateFixtureSha256 !== sha256RawBytes(rawFixtureBytes)
  ) {
    throw new TypeError('P1-B6 Pass-1 receipt provenance가 candidate fixture와 일치하지 않습니다.');
  }
  const reviewMap = new Map((receipt.results || []).map(result => [result.semanticSkeletonId, result]));
  if (reviewMap.size !== (receipt.results || []).length) {
    throw new TypeError('P1-B6 Pass-1 receipt에 중복 skeleton 결과가 있습니다.');
  }
  const minimalReviews = new Map([...reviewMap].map(([id, result]) => [id, {
    disposition: result.disposition,
    ambiguityLabel: result.ambiguityLabel,
  }]));
  const rebuilt = buildCompletedReviewReceipt({
    fixture,
    fixtureSha256: receipt.candidateFixtureSha256,
    reviewsById: minimalReviews,
    completedAt: receipt.completedAt,
  });
  if (JSON.stringify(rebuilt) !== JSON.stringify(receipt)) {
    throw new TypeError('P1-B6 Pass-1 receipt 내용 또는 canonical order가 올바르지 않습니다.');
  }
  return receipt;
}

module.exports = {
  AMBIGUITY_LABELS,
  BOUNDARY_CLASSES,
  CANDIDATE_FIXTURE_NAME,
  CONTRAST_GROUP_ID_PATTERN,
  DISPOSITIONS,
  MAX_DECISION_BASIS_LENGTH,
  MAX_FOCUS_LENGTH,
  MAX_RELATION_LENGTH,
  REVIEW_PROTOCOL_VERSION,
  REVIEW_RECEIPT_NAME,
  SKELETON_ID_PATTERN,
  SPLIT_ASSIGNMENTS,
  buildCompletedReviewReceipt,
  deterministicReviewOrder,
  parseSkeletonCandidateFixture,
  renderBlindReviewPrompt,
  sha256RawBytes,
  validateAmbiguityLabel,
  validateCompletedReviewReceipt,
  validateDisposition,
  validateSkeletonCandidateFixture,
};
