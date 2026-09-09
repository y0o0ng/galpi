'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { TextDecoder } = require('node:util');
const { BOUNDARY_CLASSES, SPLIT_ASSIGNMENTS, sha256RawBytes } = require('./memory-inference-p1b6-skeletons');

const ROOT = path.resolve(__dirname, '..');
const SURFACE_BATCH_NAME = 'xion-local-memory-inference-p1b6-surface-batch-001-v1';
const RENDERER_IDENTITY = 'xion-local-memory-inference-p1b6-surface-renderer-v1';
const EXACT56_PATH = 'fixtures/local-memory-inference-p1b6-skeleton-exact56.json';
const EXACT56_SHA256 = '772f07bd679a9c98ea65feaa164ec7a9c1f3e3fb33632052ef076f8301999602';
const PILOT_PATH = 'fixtures/local-memory-inference-p1b6-anchor-marker-pilot.json';
const LANGUAGES = Object.freeze(['KO', 'MIXED', 'EN']);
const DISCOURSE_PATTERNS = Object.freeze([
  'CANONICAL',
  'CONTEXT_FIRST',
  'CONCLUSION_FIRST',
  'INTERLEAVED',
  'PROGRESSIVE_REFINEMENT',
  'SELF_REVISION',
  'RETURN_TO_TOPIC',
  'ELLIPTICAL_REPLY',
]);
const decoder = new TextDecoder('utf-8', { fatal: true });

function fail(message) {
  throw new TypeError(`P1-B6 surface fixture ${message}`);
}

function exactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length
    && keys.every(key => Object.hasOwn(value, key));
}

function loadFrozenJson(relativePath, expectedSha256) {
  const bytes = fs.readFileSync(path.join(ROOT, relativePath));
  if (expectedSha256 && sha256RawBytes(bytes) !== expectedSha256) fail(`${relativePath} hash drifted`);
  return JSON.parse(bytes.toString('utf8'));
}

function utf8Length(text) {
  return Buffer.byteLength(text, 'utf8');
}

function decodeSpan(text, span) {
  const bytes = Buffer.from(text, 'utf8');
  if (!Number.isInteger(span.startByte) || !Number.isInteger(span.endByte)
    || span.startByte < 0 || span.endByte <= span.startByte || span.endByte > bytes.length) {
    fail('span byte range is empty, reversed, or outside its turn');
  }
  try {
    return decoder.decode(bytes.subarray(span.startByte, span.endByte));
  } catch {
    fail('span boundary is not a UTF-8 code-point boundary');
  }
}

function normalizedConversation(turns) {
  return turns.map(turn => `${turn.role}:${turn.text.normalize('NFKC').toLowerCase()
    .replace(/\p{N}+/gu, '#').replace(/[^\p{L}#]+/gu, '')}`).join('|');
}

function compareSpans(left, right, turnOrder) {
  return turnOrder.get(left.turnId) - turnOrder.get(right.turnId)
    || left.startByte - right.startByte
    || left.endByte - right.endByte;
}

function computeFragments(item, episode) {
  const turnOrder = new Map(episode.turns.map((turn, index) => [turn.turnId, index]));
  const turns = new Map(episode.turns.map(turn => [turn.turnId, turn]));
  const fragments = [];
  for (const span of item.evidenceSpanRefs) {
    const previous = fragments.at(-1)?.at(-1);
    const sameFragment = previous
      && turnOrder.get(span.turnId) === turnOrder.get(previous.turnId) + 1
      && previous.endByte === utf8Length(turns.get(previous.turnId).text)
      && span.startByte === 0;
    if (!sameFragment) fragments.push([]);
    fragments.at(-1).push(span);
  }
  return fragments;
}

function validateSurfaceBatch(batch, options = {}) {
  if (!exactKeys(batch, ['name', 'batchId', 'sourceEpisodes', 'items'])) fail('top-level keys mismatch');
  if (batch.name !== SURFACE_BATCH_NAME || typeof batch.batchId !== 'string' || batch.batchId.trim() === '') {
    fail('identity is invalid');
  }
  if (!Array.isArray(batch.sourceEpisodes) || !Array.isArray(batch.items)) fail('episodes and items must be arrays');

  const exact56 = options.exact56 || loadFrozenJson(EXACT56_PATH, EXACT56_SHA256);
  const pilot = options.pilot || loadFrozenJson(PILOT_PATH);
  const skeletons = new Map(exact56.candidates.map(row => [row.semanticSkeletonId, row]));
  const pilotConversations = new Set(pilot.cases.map(row => normalizedConversation(row.turns)));
  const episodes = new Map();
  const sourceFamilySplits = new Map();

  for (const episode of batch.sourceEpisodes) {
    if (!exactKeys(episode, ['sourceEpisodeId', 'sourceFamilyId', 'splitAssignment', 'language', 'turns'])) {
      fail('source episode keys mismatch');
    }
    if (typeof episode.sourceEpisodeId !== 'string' || episodes.has(episode.sourceEpisodeId)) {
      fail(`duplicate or invalid sourceEpisodeId: ${episode.sourceEpisodeId}`);
    }
    if (typeof episode.sourceFamilyId !== 'string' || episode.sourceFamilyId.trim() === '') fail('invalid sourceFamilyId');
    if (!SPLIT_ASSIGNMENTS.includes(episode.splitAssignment) || !LANGUAGES.includes(episode.language)) {
      fail(`invalid episode split or language: ${episode.sourceEpisodeId}`);
    }
    const priorSourceSplit = sourceFamilySplits.get(episode.sourceFamilyId);
    if (priorSourceSplit && priorSourceSplit !== episode.splitAssignment) fail('sourceFamilyId crosses splits');
    sourceFamilySplits.set(episode.sourceFamilyId, episode.splitAssignment);
    if (!Array.isArray(episode.turns) || episode.turns.length === 0) fail('source episode has no turns');
    for (const [index, turn] of episode.turns.entries()) {
      if (!exactKeys(turn, ['turnId', 'role', 'text']) || turn.turnId !== `t${index + 1}`
        || !['USER', 'ASSISTANT'].includes(turn.role) || typeof turn.text !== 'string'
        || turn.text.trim() === '' || /[\r\n]/u.test(turn.text)
        || Buffer.from(turn.text, 'utf8').toString('utf8') !== turn.text) fail(`invalid turn in ${episode.sourceEpisodeId}`);
      if (turn.text.includes('[TARGET]') || turn.text.includes('[/TARGET]')) fail('source text contains TARGET syntax');
    }
    if (pilotConversations.has(normalizedConversation(episode.turns))) fail('pilot conversation was reused or mechanically repackaged');
    episodes.set(episode.sourceEpisodeId, episode);
  }

  const itemIds = new Set();
  const surfaceFamilySplits = new Map();
  for (const item of batch.items) {
    if (!exactKeys(item, [
      'itemId', 'sourceEpisodeId', 'semanticSkeletonId', 'anchorSpanRef',
      'evidenceSpanRefs', 'discoursePattern', 'surfaceFamilyId',
    ])) fail('item keys mismatch');
    if (typeof item.itemId !== 'string' || itemIds.has(item.itemId)) fail(`duplicate or invalid itemId: ${item.itemId}`);
    itemIds.add(item.itemId);
    const episode = episodes.get(item.sourceEpisodeId);
    const skeleton = skeletons.get(item.semanticSkeletonId);
    if (!episode) fail(`unknown source episode: ${item.itemId}`);
    if (!skeleton) fail(`unknown exact56 skeleton: ${item.itemId}`);
    if (episode.splitAssignment !== skeleton.splitAssignment) fail(`episode/skeleton split mismatch: ${item.itemId}`);
    if (!DISCOURSE_PATTERNS.includes(item.discoursePattern)) fail(`invalid discoursePattern: ${item.itemId}`);
    if (typeof item.surfaceFamilyId !== 'string' || item.surfaceFamilyId.trim() === '') fail('invalid surfaceFamilyId');
    const priorSurfaceSplit = surfaceFamilySplits.get(item.surfaceFamilyId);
    if (priorSurfaceSplit && priorSurfaceSplit !== episode.splitAssignment) fail('surfaceFamilyId crosses splits');
    surfaceFamilySplits.set(item.surfaceFamilyId, episode.splitAssignment);

    const turns = new Map(episode.turns.map(turn => [turn.turnId, turn]));
    const turnOrder = new Map(episode.turns.map((turn, index) => [turn.turnId, index]));
    const validateRef = span => {
      if (!exactKeys(span, ['turnId', 'startByte', 'endByte']) || !turns.has(span.turnId)) fail(`invalid span reference: ${item.itemId}`);
      decodeSpan(turns.get(span.turnId).text, span);
    };
    validateRef(item.anchorSpanRef);
    if (!Array.isArray(item.evidenceSpanRefs) || item.evidenceSpanRefs.length === 0) fail(`item has no evidence: ${item.itemId}`);
    item.evidenceSpanRefs.forEach(validateRef);
    for (let index = 1; index < item.evidenceSpanRefs.length; index += 1) {
      const previous = item.evidenceSpanRefs[index - 1];
      const current = item.evidenceSpanRefs[index];
      if (compareSpans(previous, current, turnOrder) >= 0) fail(`evidence spans are not in canonical source order: ${item.itemId}`);
      if (previous.turnId === current.turnId && current.startByte <= previous.endByte) {
        fail(current.startByte === previous.endByte
          ? `adjacent same-turn spans must be merged: ${item.itemId}`
          : `overlapping evidence spans: ${item.itemId}`);
      }
    }
    const anchorCovered = item.evidenceSpanRefs.some(span => span.turnId === item.anchorSpanRef.turnId
      && span.startByte <= item.anchorSpanRef.startByte && span.endByte >= item.anchorSpanRef.endByte);
    if (!anchorCovered) fail(`anchor is outside selected evidence: ${item.itemId}`);
    const fragmentCount = computeFragments(item, episode).length;
    if (fragmentCount < 1 || fragmentCount > 5) fail(`fragment count must be 1..5: ${item.itemId}`);
  }
  return batch;
}

function renderVisibleItem(batch, itemOrId) {
  validateSurfaceBatch(batch);
  const item = typeof itemOrId === 'string' ? batch.items.find(row => row.itemId === itemOrId) : itemOrId;
  if (!item || !batch.items.includes(item)) fail('renderer item is not in the validated batch');
  const episode = batch.sourceEpisodes.find(row => row.sourceEpisodeId === item.sourceEpisodeId);
  const turns = new Map(episode.turns.map(turn => [turn.turnId, turn]));
  const fragments = computeFragments(item, episode);
  return fragments.map(fragment => fragment.map(span => {
    const turn = turns.get(span.turnId);
    const selected = Buffer.from(turn.text, 'utf8').subarray(span.startByte, span.endByte);
    let text = decoder.decode(selected);
    if (span.turnId === item.anchorSpanRef.turnId
      && span.startByte <= item.anchorSpanRef.startByte && span.endByte >= item.anchorSpanRef.endByte) {
      const start = item.anchorSpanRef.startByte - span.startByte;
      const end = item.anchorSpanRef.endByte - span.startByte;
      text = `${decoder.decode(selected.subarray(0, start))}[TARGET]${decoder.decode(selected.subarray(start, end))}[/TARGET]${decoder.decode(selected.subarray(end))}`;
    }
    return `${turn.role}: ${text}`;
  }).join('\n')).join('\n---\n');
}

function renderHumanReviewText(batch, itemOrId) {
  return renderVisibleItem(batch, itemOrId);
}

function summarizeSurfaceBatch(batch) {
  validateSurfaceBatch(batch);
  const exact56 = loadFrozenJson(EXACT56_PATH, EXACT56_SHA256);
  const skeletons = new Map(exact56.candidates.map(row => [row.semanticSkeletonId, row]));
  const episodes = new Map(batch.sourceEpisodes.map(row => [row.sourceEpisodeId, row]));
  const count = (values, keys) => Object.fromEntries(keys.map(key => [key, values.filter(value => value === key).length]));
  const itemCounts = new Map();
  for (const item of batch.items) itemCounts.set(item.sourceEpisodeId, (itemCounts.get(item.sourceEpisodeId) || 0) + 1);
  const overlapping = batch.sourceEpisodes.filter(episode => {
    const items = batch.items.filter(item => item.sourceEpisodeId === episode.sourceEpisodeId);
    return items.length > 1 && items.some((left, index) => items.slice(index + 1).some(right => {
      const leftTurns = new Set(left.evidenceSpanRefs.map(span => span.turnId));
      return right.evidenceSpanRefs.some(span => leftTurns.has(span.turnId));
    }));
  }).length;
  const fragments = batch.items.map(item => computeFragments(item, episodes.get(item.sourceEpisodeId)).length);
  return {
    items: batch.items.length,
    sourceEpisodes: batch.sourceEpisodes.length,
    multiItemEpisodes: [...itemCounts.values()].filter(value => value > 1).length,
    overlappingMultiItemEpisodes: overlapping,
    splits: count(batch.items.map(item => skeletons.get(item.semanticSkeletonId).splitAssignment), SPLIT_ASSIGNMENTS),
    boundaryClasses: count(batch.items.map(item => skeletons.get(item.semanticSkeletonId).boundaryClass), BOUNDARY_CLASSES),
    languages: count(batch.items.map(item => episodes.get(item.sourceEpisodeId).language), LANGUAGES),
    discoursePatterns: count(batch.items.map(item => item.discoursePattern), DISCOURSE_PATTERNS),
    fragments: count(fragments, [1, 2, 3, 4, 5]),
    properSubTurnItems: batch.items.filter(item => {
      const episode = episodes.get(item.sourceEpisodeId);
      const turns = new Map(episode.turns.map(turn => [turn.turnId, turn]));
      return item.evidenceSpanRefs.some(span => span.startByte > 0 || span.endByte < utf8Length(turns.get(span.turnId).text));
    }).length,
  };
}

module.exports = {
  BOUNDARY_CLASSES,
  DISCOURSE_PATTERNS,
  EXACT56_PATH,
  EXACT56_SHA256,
  LANGUAGES,
  PILOT_PATH,
  RENDERER_IDENTITY,
  SURFACE_BATCH_NAME,
  computeFragments,
  decodeSpan,
  renderHumanReviewText,
  renderVisibleItem,
  summarizeSurfaceBatch,
  utf8Length,
  validateSurfaceBatch,
};
