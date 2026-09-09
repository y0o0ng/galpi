'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { sha256RawBytes } = require('../lib/memory-inference-p1b6-skeletons');
const surfaces = require('../lib/memory-inference-p1b6-surfaces');
const audit = require('../scripts/build-memory-inference-p1b6-source-audit-packet');

const ROOT = path.resolve(__dirname, '..');
const BATCH_PATH = 'fixtures/local-memory-inference-p1b6-surface-batch-001.json';
const AUTHORING_PATH = 'fixtures/local-memory-inference-p1b6-surface-batch-001-authoring-protocol.json';
const rawBatch = fs.readFileSync(path.join(ROOT, BATCH_PATH));
const batch = JSON.parse(rawBatch);
const exact56 = JSON.parse(fs.readFileSync(path.join(ROOT, surfaces.EXACT56_PATH)));
const skeletons = new Map(exact56.candidates.map(row => [row.semanticSkeletonId, row]));
const episodes = new Map(batch.sourceEpisodes.map(row => [row.sourceEpisodeId, row]));

function changed(mutator) {
  const value = structuredClone(batch);
  mutator(value);
  return value;
}

test('batch-001 has the exact smoke identity and quotas', () => {
  assert.equal(batch.name, surfaces.SURFACE_BATCH_NAME);
  assert.equal(batch.batchId, 'p1b6-surface-batch-001');
  assert.equal(surfaces.validateSurfaceBatch(batch), batch);
  assert.deepEqual(surfaces.summarizeSurfaceBatch(batch), {
    items: 32,
    sourceEpisodes: 28,
    multiItemEpisodes: 4,
    overlappingMultiItemEpisodes: 3,
    splits: { TRAIN: 16, DEV: 8, FINAL_HELD_OUT: 8 },
    boundaryClasses: Object.fromEntries(surfaces.BOUNDARY_CLASSES.map(value => [value, 4])),
    languages: { KO: 22, MIXED: 6, EN: 4 },
    discoursePatterns: Object.fromEntries(surfaces.DISCOURSE_PATTERNS.map(value => [value, 4])),
    fragments: { 1: 6, 2: 8, 3: 10, 4: 6, 5: 2 },
    properSubTurnItems: 10,
  });

  for (const boundaryClass of surfaces.BOUNDARY_CLASSES) {
    const rows = batch.items.filter(item => skeletons.get(item.semanticSkeletonId).boundaryClass === boundaryClass);
    assert.deepEqual(Object.fromEntries(['TRAIN', 'DEV', 'FINAL_HELD_OUT'].map(split =>
      [split, rows.filter(item => skeletons.get(item.semanticSkeletonId).splitAssignment === split).length])),
    { TRAIN: 2, DEV: 1, FINAL_HELD_OUT: 1 });
    assert.deepEqual(new Set(rows.map(item => skeletons.get(item.semanticSkeletonId).humanLabel)), new Set(['CLEAR', 'ESCALATE']));
  }
});

test('surface validator accepts a matching later versioned batch identity', () => {
  const later = changed(value => {
    value.name = 'xion-local-memory-inference-p1b6-surface-batch-002-v1';
    value.batchId = 'p1b6-surface-batch-002';
  });
  assert.equal(surfaces.validateSurfaceBatch(later), later);
  assert.throws(() => surfaces.validateSurfaceBatch(changed(value => {
    value.name = 'xion-local-memory-inference-p1b6-surface-batch-002-v1';
  })), /identity is invalid/u);
});

test('all item, episode, skeleton, and family references are split-pure and unique', () => {
  assert.equal(new Set(batch.sourceEpisodes.map(row => row.sourceEpisodeId)).size, 28);
  assert.equal(new Set(batch.items.map(row => row.itemId)).size, 32);
  for (const item of batch.items) {
    assert.ok(skeletons.has(item.semanticSkeletonId));
    assert.equal(episodes.get(item.sourceEpisodeId).splitAssignment,
      skeletons.get(item.semanticSkeletonId).splitAssignment);
    assert.equal(Object.hasOwn(item, 'humanGoldDecision'), false);
    assert.equal(Object.hasOwn(item, 'intendedLabel'), false);
  }
  assert.throws(() => surfaces.validateSurfaceBatch(changed(value => {
    value.sourceEpisodes[1].sourceFamilyId = value.sourceEpisodes[0].sourceFamilyId;
  })), /sourceFamilyId crosses splits/u);
  assert.throws(() => surfaces.validateSurfaceBatch(changed(value => {
    value.items[2].surfaceFamilyId = value.items[0].surfaceFamilyId;
  })), /surfaceFamilyId crosses splits/u);
});

test('UTF-8 byte spans and canonical evidence ordering fail closed', () => {
  assert.throws(() => surfaces.validateSurfaceBatch(changed(value => {
    value.items[0].evidenceSpanRefs[0].endByte = 1;
  })), /UTF-8/u);
  for (const [startByte, endByte] of [[2, 2], [3, 2]]) {
    assert.throws(() => surfaces.validateSurfaceBatch(changed(value => {
      Object.assign(value.items[0].evidenceSpanRefs[0], { startByte, endByte });
    })), /empty, reversed/u);
  }
  assert.throws(() => surfaces.validateSurfaceBatch(changed(value => {
    const refs = value.items[4].evidenceSpanRefs;
    refs[1].startByte = refs[0].endByte - 1;
  })), /overlapping/u);
  assert.throws(() => surfaces.validateSurfaceBatch(changed(value => {
    const refs = value.items[4].evidenceSpanRefs;
    refs[1].startByte = refs[0].endByte;
  })), /adjacent same-turn/u);
  assert.throws(() => surfaces.validateSurfaceBatch(changed(value => {
    value.items[0].evidenceSpanRefs.reverse();
  })), /canonical source order/u);
  assert.throws(() => surfaces.validateSurfaceBatch(changed(value => {
    value.items[0].anchorSpanRef = { turnId: 't4', startByte: 0, endByte: 3 };
  })), /anchor is outside/u);
  assert.throws(() => surfaces.validateSurfaceBatch(changed(value => {
    value.items[0].anchorSpanRef = [value.items[0].anchorSpanRef, value.items[0].anchorSpanRef];
  })), /invalid span/u);
});

test('fixture rejects unknown IDs, split drift, TARGET source text, and pilot reuse', () => {
  assert.throws(() => surfaces.validateSurfaceBatch(changed(value => {
    value.items[0].semanticSkeletonId = 'p1b6-sk-ffffffffffffffff';
  })), /unknown exact56/u);
  assert.throws(() => surfaces.validateSurfaceBatch(changed(value => {
    value.sourceEpisodes[0].splitAssignment = 'DEV';
  })), /split mismatch/u);
  assert.throws(() => surfaces.validateSurfaceBatch(changed(value => {
    value.sourceEpisodes[0].turns[0].text += '[TARGET]';
  })), /TARGET syntax/u);
  assert.throws(() => surfaces.validateSurfaceBatch(changed(value => {
    const pilot = JSON.parse(fs.readFileSync(path.join(ROOT, surfaces.PILOT_PATH)));
    value.sourceEpisodes.push({
      sourceEpisodeId: 'p1b6-se-pilot-copy', sourceFamilyId: 'p1b6-sf-pilot-copy',
      splitAssignment: 'TRAIN', language: 'KO', turns: pilot.cases[0].turns,
    });
  })), /pilot conversation/u);
});

test('fragment computation extends maximal contiguous source ranges to spans', () => {
  const episode = { turns: [
    { turnId: 't1', role: 'USER', text: 'abc' },
    { turnId: 't2', role: 'ASSISTANT', text: 'def' },
    { turnId: 't3', role: 'USER', text: 'ghi' },
  ] };
  const count = evidenceSpanRefs => surfaces.computeFragments({ evidenceSpanRefs }, episode).length;
  assert.equal(count([{ turnId: 't1', startByte: 0, endByte: 2 }]), 1);
  assert.equal(count([
    { turnId: 't1', startByte: 0, endByte: 1 },
    { turnId: 't1', startByte: 2, endByte: 3 },
  ]), 2);
  assert.equal(count([
    { turnId: 't1', startByte: 0, endByte: 3 },
    { turnId: 't2', startByte: 0, endByte: 3 },
    { turnId: 't3', startByte: 0, endByte: 3 },
  ]), 1);
  assert.equal(count([
    { turnId: 't1', startByte: 0, endByte: 2 },
    { turnId: 't2', startByte: 0, endByte: 3 },
  ]), 2);
  assert.equal(count([
    { turnId: 't1', startByte: 0, endByte: 3 },
    { turnId: 't2', startByte: 1, endByte: 3 },
  ]), 2);
  assert.equal(count([
    { turnId: 't1', startByte: 0, endByte: 3 },
    { turnId: 't3', startByte: 0, endByte: 3 },
  ]), 2);
});

test('renderer is deterministic, blind, chronological, and shared with HUMAN review', () => {
  const item = batch.items[1];
  const expected = [
    'ASSISTANT: [TARGET]독서 모임[/TARGET]은 토요일 오후에 가볼까? 아니면 그 시간에 새로 생긴 서점에 들를까?',
    '---',
    'USER: 토요일 오후면 좋아.',
  ].join('\n');
  const rendered = surfaces.renderVisibleItem(batch, item);
  assert.equal(rendered, expected);
  assert.equal(surfaces.renderVisibleItem(batch, item.itemId), expected);
  assert.equal(surfaces.renderHumanReviewText(batch, item), expected);
  assert.equal((rendered.match(/\[TARGET\]/gu) || []).length, 1);
  assert.equal((rendered.match(/\[\/TARGET\]/gu) || []).length, 1);
  assert.equal(rendered.replace('[TARGET]', '').replace('[/TARGET]', ''),
    'ASSISTANT: 독서 모임은 토요일 오후에 가볼까? 아니면 그 시간에 새로 생긴 서점에 들를까?\n---\nUSER: 토요일 오후면 좋아.');
  assert.equal(rendered.includes('...'), false);
  for (const hidden of [item.itemId, item.semanticSkeletonId, item.discoursePattern,
    item.surfaceFamilyId, episodes.get(item.sourceEpisodeId).sourceFamilyId,
    episodes.get(item.sourceEpisodeId).splitAssignment]) assert.equal(rendered.includes(hidden), false);

  assert.equal(surfaces.renderVisibleItem(batch, 'p1b6-item-b001-014'), [
    'USER: 스터디룸 예약할까?',
    '---',
    'USER: online course도 결제할까?',
    '---',
    'ASSISTANT: 스터디룸을 예약해 둘까, online course를 결제해 둘까?',
    '---',
    'USER: [TARGET]응[/TARGET], 그건 오늘 해줘.',
  ].join('\n'));
  assert.equal(episodes.get('p1b6-se-b001-011').turns[5].text, '잠깐만, 메모 좀 하고.');
});

test('source-audit packet contains full source and selected bundle but no hidden metadata', () => {
  const packet = audit.buildAuditPacket(rawBatch);
  const protocol = audit.loadProtocol();
  assert.equal(packet.name, audit.PACKET_IDENTITY);
  assert.deepEqual(packet.sourceBatch, {
    identity: batch.name, batchId: batch.batchId, sha256: sha256RawBytes(rawBatch),
  });
  assert.equal(packet.rendererIdentity, surfaces.RENDERER_IDENTITY);
  assert.deepEqual(packet.sourceAuditProtocol,
    { identity: audit.PROTOCOL_IDENTITY, sha256: protocol.sha256 });
  assert.equal(protocol.protocol.auditor.humanGoldAuthority, false);
  assert.deepEqual(Object.keys(protocol.protocol.dispositions), ['PASS', 'FAIL', 'UNCERTAIN']);
  assert.deepEqual(protocol.protocol.reviewGate,
    { eligibleForHumanSemanticReview: ['PASS'], failClosed: ['FAIL', 'UNCERTAIN'] });
  assert.equal(packet.rows.length, 32);
  assert.equal(new Set(packet.rows.map(row => row.auditRowId)).size, 32);
  assert.deepEqual(packet.rows.map(row => row.auditRowId),
    batch.items.map(item => audit.opaqueAuditRowId(sha256RawBytes(rawBatch), item.itemId)));
  assert.deepEqual(packet.rows[0].sourceEpisode.turns, batch.sourceEpisodes[0].turns);
  assert.equal(packet.rows[0].selectedBundle, surfaces.renderVisibleItem(batch, batch.items[0]));
  for (const row of packet.rows) {
    assert.deepEqual(Object.keys(row), ['auditRowId', 'sourceEpisode', 'selectedBundle']);
    assert.deepEqual(Object.keys(row.sourceEpisode), ['turns']);
    assert.equal((row.selectedBundle.match(/\[TARGET\]/gu) || []).length, 1);
    assert.equal((row.selectedBundle.match(/\[\/TARGET\]/gu) || []).length, 1);
  }
  const serialized = JSON.stringify(packet);
  for (const hidden of ['semanticSkeletonId', 'humanGoldDecision', 'humanLabel', 'boundaryClass',
    'splitAssignment', 'language', 'discoursePattern', 'sourceFamilyId', 'surfaceFamilyId',
    'intendedLabel', 'decisionBasis']) assert.equal(serialized.includes(hidden), false);
});

test('audit CLI has only input/output, refuses overwrite, and performs no network/model call', () => {
  assert.deepEqual(audit.parseArgs(['--input', 'in.json', '--output', 'out.json']),
    { inputPath: 'in.json', outputPath: 'out.json' });
  for (const args of [[], ['--input', 'in.json'], ['--input', 'in.json', '--model', 'x'],
    ['--input', 'in.json', '--output', 'a', '--output', 'b']]) assert.throws(() => audit.parseArgs(args));
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'p1b6-audit-packet-'));
  const output = path.join(directory, 'packet.json');
  const input = path.join(ROOT, BATCH_PATH);
  const packet = audit.writeAuditPacket(input, output);
  assert.deepEqual(JSON.parse(fs.readFileSync(output)), packet);
  assert.throws(() => audit.writeAuditPacket(input, output), /not be overwritten/u);
  fs.rmSync(directory, { recursive: true, force: true });
  const script = fs.readFileSync(path.join(ROOT, 'scripts/build-memory-inference-p1b6-source-audit-packet.js'), 'utf8');
  assert.doesNotMatch(script, /\bfetch\s*\(|https?:\/\//u);
  assert.equal(require('../package.json').scripts['build:memory-inference-p1b6-source-audit-packet'],
    'node scripts/build-memory-inference-p1b6-source-audit-packet.js');
});

test('authoring provenance binds the frozen exact56 and raw batch bytes', () => {
  const protocol = JSON.parse(fs.readFileSync(path.join(ROOT, AUTHORING_PATH)));
  assert.equal(protocol.startingMainSha, 'c7ed8a4b62c7a3d74d0458bb5dbe08a44305372d');
  assert.equal(protocol.exact56.sha256, surfaces.EXACT56_SHA256);
  assert.equal(protocol.outputBatch.sha256, sha256RawBytes(rawBatch));
  assert.equal(protocol.authority.sourceAuditCompleted, false);
  assert.equal(protocol.authority.humanReviewCompleted, false);
  assert.equal(protocol.authority.generatorMetadataIsNeverHumanGold, true);
});

test('exact56 and anchor-marker pilot artifacts remain byte-identical', () => {
  const hashes = {
    'fixtures/local-memory-inference-p1b6-skeleton-exact56.json': surfaces.EXACT56_SHA256,
    'fixtures/local-memory-inference-p1b6-anchor-marker-pilot.json':
      'e530ea9d2b1b2ea5ce42557a9cbb9828f97d14f6ab431e7dbb71ebbc825196e0',
    'fixtures/local-memory-inference-p1b6-anchor-marker-pilot-report.json':
      'ce43e493cb037779a52e682498769ec87e2ae614846a769e3eebe4b561da49e1',
  };
  for (const [file, expected] of Object.entries(hashes)) {
    assert.equal(sha256RawBytes(fs.readFileSync(path.join(ROOT, file))), expected, file);
  }
});
