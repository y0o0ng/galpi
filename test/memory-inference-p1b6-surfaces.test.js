'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { sha256RawBytes } = require('../lib/memory-inference-p1b6-skeletons');
const surfaces = require('../lib/memory-inference-p1b6-surfaces');
const audit = require('../scripts/build-memory-inference-p1b6-source-audit-packet');
const humanReview = require('../scripts/build-memory-inference-p1b6-human-review-packet');
const humanRereview = require('../scripts/build-memory-inference-p1b6-human-rereview-packet');

const ROOT = path.resolve(__dirname, '..');
const BATCH_PATH = 'fixtures/local-memory-inference-p1b6-surface-batch-001.json';
const AUTHORING_PATH = 'fixtures/local-memory-inference-p1b6-surface-batch-001-authoring-protocol.json';
const ATTEMPT_001_PATH = 'fixtures/local-memory-inference-p1b6-source-audit-batch-001-attempt-001.json';
const ATTEMPT_002_PATH = 'fixtures/local-memory-inference-p1b6-source-audit-batch-001-attempt-002.json';
const ATTEMPT_003_PATH = 'fixtures/local-memory-inference-p1b6-source-audit-batch-001-attempt-003.json';
const ATTEMPT_004_PATH = 'fixtures/local-memory-inference-p1b6-source-audit-batch-001-attempt-004.json';
const HUMAN_ATTEMPT_001_PATH = 'fixtures/local-memory-inference-p1b6-primary-human-review-batch-001-attempt-001.json';
const HUMAN_REREVIEW_ATTEMPT_002_PATH = 'fixtures/local-memory-inference-p1b6-primary-human-rereview-batch-001-attempt-002.json';
const EFFECTIVE_HUMAN_PATH = 'fixtures/local-memory-inference-p1b6-primary-human-effective-current-batch-001.json';
const SMOKE_ACCEPTANCE_PATH = 'fixtures/local-memory-inference-p1b6-smoke-batch-001-acceptance.json';
const REVIEWED_BATCH_SHA256 = '8663f2e2a376ae96f7ab5263168ea36d8a35a5861014473acf51c48b10dd19aa';
const ATTEMPT_003_BATCH_SHA256 = 'ebb3af5a8c2507142c20f81e44351e99b5e2a746274537d78f491f782aa366e9';
const CURRENT_BATCH_SHA256 = '2a4605f5550118754c315e26700aef1be96a3129a3ef0065fd2accdad5352a36';
const REVIEW_PACKET_SHA256 = '5a57a22f595697dccbf70bf42b91f609a78676f0a21af78363ce05e611e00cb5';
const ATTEMPT_003_PACKET_SHA256 = '92954acfda2632110d267c9578f05f426f2f60fae3f204dbed3c2e66db5c5187';
const ATTEMPT_003_RESULT_SHA256 = 'c4007634f8e379092dc9f4e3593b4e47712028ae8c79669db7452044f5d56e74';
const ATTEMPT_004_PACKET_SHA256 = 'a5a1212ecd0a27695bf6122afde5d0aaf4804ac19e3e316530990c152e27e4f2';
const ATTEMPT_004_RESULT_SHA256 = '21ecee72861a7c58d2b09d2777901475c6f60d1bae90c836ef5356d5203ea103';
const REREVIEW_PACKET_SHA256 = '1924fea91c0667aa4ec0e7c47629836df988476bb0dfcaaa9dc3ed775e3a4fbc';
const REPAIR_REVIEW_ROW_ID = 'p1b6-review-584f964b097c2e7a';
const rawBatch = fs.readFileSync(path.join(ROOT, BATCH_PATH));
const batch = JSON.parse(rawBatch);
const exact56 = JSON.parse(fs.readFileSync(path.join(ROOT, surfaces.EXACT56_PATH)));
const skeletons = new Map(exact56.candidates.map(row => [row.semanticSkeletonId, row]));
const episodes = new Map(batch.sourceEpisodes.map(row => [row.sourceEpisodeId, row]));

function reconstructAttempt003Batch() {
  const value = structuredClone(batch);
  const receipt = JSON.parse(fs.readFileSync(path.join(ROOT, ATTEMPT_003_PATH)));
  const failedRow = receipt.rows.find(row => row.disposition === 'FAIL');
  const item = value.items.find(row =>
    audit.opaqueAuditRowId(ATTEMPT_003_BATCH_SHA256, row.itemId) === failedRow.auditRowId);
  assert.ok(item);
  item.evidenceSpanRefs.splice(2, 1);
  return value;
}

const attempt003Batch = reconstructAttempt003Batch();
const rawAttempt003Batch = Buffer.from(`${JSON.stringify(attempt003Batch, null, 2)}\n`);

function reconstructReviewedBatch() {
  const value = structuredClone(attempt003Batch);
  const item = value.items.find(row =>
    humanReview.opaqueReviewRowId(REVIEWED_BATCH_SHA256, row.itemId) === REPAIR_REVIEW_ROW_ID);
  assert.ok(item);
  const episode = value.sourceEpisodes.find(row => row.sourceEpisodeId === item.sourceEpisodeId);
  episode.turns.find(turn => turn.turnId === item.evidenceSpanRefs[2].turnId).role = 'ASSISTANT';
  return value;
}

const reviewedBatch = reconstructReviewedBatch();
const rawReviewedBatch = Buffer.from(`${JSON.stringify(reviewedBatch, null, 2)}\n`);
const attempt002Receipt = JSON.parse(fs.readFileSync(path.join(ROOT, ATTEMPT_002_PATH)));
const originalPacket = humanReview.buildHumanReviewPacket(rawReviewedBatch, attempt002Receipt);
const rawOriginalPacket = humanReview.packetBytes(originalPacket);
const attempt004Receipt = JSON.parse(fs.readFileSync(path.join(ROOT, ATTEMPT_004_PATH)));
const originalHumanReceipt = JSON.parse(fs.readFileSync(path.join(ROOT, HUMAN_ATTEMPT_001_PATH)));
const rereviewPacket = humanRereview.buildRereviewPacket(
  rawBatch, attempt004Receipt, rawOriginalPacket, originalHumanReceipt,
);
const rawRereviewPacket = humanRereview.packetBytes(rereviewPacket);
const rereviewReceipt = JSON.parse(fs.readFileSync(path.join(ROOT, HUMAN_REREVIEW_ATTEMPT_002_PATH)));
const rawEffectiveHuman = fs.readFileSync(path.join(ROOT, EFFECTIVE_HUMAN_PATH));
const effectiveHuman = JSON.parse(rawEffectiveHuman);
const smokeAcceptance = JSON.parse(fs.readFileSync(path.join(ROOT, SMOKE_ACCEPTANCE_PATH)));

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
    fragments: { 1: 6, 2: 9, 3: 9, 4: 6, 5: 2 },
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

test('batch-001 source-audit repairs preserve source text and complete the selected bundle', () => {
  assert.deepEqual(episodes.get('p1b6-se-b001-011').turns.map(turn => turn.text), [
    '스터디룸 예약할까?',
    '참, 아까 온 메시지는 광고였어.',
    'online course도 결제할까?',
    '둘 다 지금 진행할 수 있어.',
    '스터디룸을 예약해 둘까, online course를 결제해 둘까?',
    '잠깐만, 메모 좀 하고.',
    '응, 그건 오늘 해줘.',
  ]);
  assert.deepEqual(episodes.get('p1b6-se-b001-028').turns.map(turn => turn.text), [
    '회의 간식은 2~3개 정도 준비해.',
    '회의 자료는 공유 폴더에 올려뒀어.',
    '응, 파일 이름도 확인했어.',
    '회의는 이번 주에 세 번 있어.',
    '일정 확인했어.',
    '그 정도면 돼.',
  ]);
  assert.equal(surfaces.renderVisibleItem(batch, 'p1b6-item-b001-032'), [
    'USER: [TARGET]회의 간식[/TARGET]은 2~3개 정도 준비해.',
    '---',
    'USER: 회의는 이번 주에 세 번 있어.',
    'ASSISTANT: 일정 확인했어.',
    'USER: 그 정도면 돼.',
  ].join('\n'));
  assert.equal(surfaces.computeFragments(
    batch.items.find(item => item.itemId === 'p1b6-item-b001-014'),
    episodes.get('p1b6-se-b001-011'),
  ).length, 4);
  assert.equal(surfaces.computeFragments(
    batch.items.find(item => item.itemId === 'p1b6-item-b001-032'),
    episodes.get('p1b6-se-b001-028'),
  ).length, 2);
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
  assert.equal(protocol.authority.sourceAuditCompleted, true);
  assert.equal(protocol.authority.humanReviewCompleted, true);
  assert.equal(protocol.authority.generatorMetadataIsNeverHumanGold, true);
  assert.match(protocol.scope.join(' '), /30 candidates are accepted/u);
  assert.match(protocol.scope.join(' '), /final corpus HUMAN gold is not frozen/u);
});

test('source-audit attempt 001 remains bound to the pre-fix batch', () => {
  const receipt = JSON.parse(fs.readFileSync(path.join(ROOT, ATTEMPT_001_PATH)));
  assert.equal(sha256RawBytes(fs.readFileSync(path.join(ROOT, ATTEMPT_001_PATH))),
    '95026b2f6b274e5d909faba96c6cb7345e1286b9f6824450b971936fd685677b');
  assert.equal(receipt.status, 'COMPLETE_NEEDS_FIX');
  assert.equal(receipt.auditedSourceBatch.rawSha256,
    '4827ebcacc8a95d7fb3031f8f7eece3c95ac348fd7e2e2fbd493c170e6dbbbdb');
  assert.equal(receipt.rawResultArtifact.sha256,
    'ead8b62067db16d17b74fc3ecac60d370360175d51cc81a59bd89717fed12e09');
  assert.deepEqual(receipt.summary, { total: 32, PASS: 30, FAIL: 2, UNCERTAIN: 0 });
  assert.equal(receipt.rows.length, 32);
  assert.equal(new Set(receipt.rows.map(row => row.auditRowId)).size, 32);
  assert.deepEqual(receipt.rows.filter(row => row.disposition === 'FAIL').map(row => row.auditRowId), [
    'p1b6-audit-62292b67240d87be',
    'p1b6-audit-b3d567e8195f3ab8',
  ]);
  assert.equal(receipt.authority.humanSemanticReviewOccurred, false);
});

test('source-audit attempt 002 is an all-PASS receipt bound to the fixed batch', () => {
  const receipt = JSON.parse(fs.readFileSync(path.join(ROOT, ATTEMPT_002_PATH)));
  assert.equal(receipt.status, 'COMPLETE_PASS');
  assert.equal(receipt.auditedSourceBatch.rawSha256,
    '8663f2e2a376ae96f7ab5263168ea36d8a35a5861014473acf51c48b10dd19aa');
  assert.equal(receipt.auditPacketSha256,
    '01dee02a3ba9601a86133bab80f928bb7a2e1fe262d26e6ad2668d15ee582f99');
  assert.equal(receipt.rawResultArtifact.sha256,
    'a6f28b21b50c3e47da6dc79ad4b7523190f6468f30f697f4fe80958bc74f2bfe');
  assert.deepEqual(receipt.summary, { total: 32, PASS: 32, FAIL: 0, UNCERTAIN: 0 });
  assert.equal(receipt.rows.length, 32);
  assert.equal(new Set(receipt.rows.map(row => row.auditRowId)).size, 32);
  assert.ok(receipt.rows.every(row => row.disposition === 'PASS'));
  assert.equal(receipt.authority.humanSemanticReviewOccurred, false);
  assert.equal(receipt.authority.surfaceHumanGoldAssigned, false);
  assert.equal(receipt.authority.trainingOccurred, false);
  assert.doesNotThrow(() => humanReview.validateAuditReceipt(receipt, rawReviewedBatch));
  assert.throws(() => humanReview.validateAuditReceipt(receipt, rawBatch), /binding is invalid/u);
});

test('source-audit attempt 003 receipt binds the raw result and pre-repair batch', () => {
  const receipt = JSON.parse(fs.readFileSync(path.join(ROOT, ATTEMPT_003_PATH)));
  assert.equal(receipt.status, 'COMPLETE_NEEDS_FIX');
  assert.equal(receipt.auditPacketSha256, ATTEMPT_003_PACKET_SHA256);
  assert.equal(receipt.auditedSourceBatch.rawSha256, ATTEMPT_003_BATCH_SHA256);
  assert.equal(sha256RawBytes(rawAttempt003Batch), ATTEMPT_003_BATCH_SHA256);
  assert.equal(receipt.rawResultArtifact.sha256, ATTEMPT_003_RESULT_SHA256);
  assert.deepEqual(receipt.summary, { total: 32, PASS: 31, FAIL: 1, UNCERTAIN: 0 });
  assert.equal(receipt.rows.length, 32);
  assert.equal(new Set(receipt.rows.map(row => row.auditRowId)).size, 32);
  assert.deepEqual(new Set(receipt.rows.map(row => row.auditRowId)),
    new Set(audit.buildAuditPacket(rawAttempt003Batch).rows.map(row => row.auditRowId)));
  assert.deepEqual(receipt.rows.reduce((counts, row) => {
    counts[row.disposition] += 1;
    return counts;
  }, { PASS: 0, FAIL: 0, UNCERTAIN: 0 }), { PASS: 31, FAIL: 1, UNCERTAIN: 0 });
  assert.ok(receipt.rows.every(row => typeof row.reason === 'string' && row.reason.trim()));
  assert.equal(receipt.authority.sourceBundleGatePassed, false);
  assert.equal(receipt.authority.humanSemanticReviewOccurred, false);
  assert.equal(receipt.authority.surfaceHumanGoldAssigned, false);
  assert.equal(receipt.authority.trainingOccurred, false);
});

test('source-audit attempt 004 is an all-PASS receipt bound to the unchanged current batch', () => {
  const receipt = JSON.parse(fs.readFileSync(path.join(ROOT, ATTEMPT_004_PATH)));
  const packet = audit.buildAuditPacket(rawBatch);
  assert.equal(sha256RawBytes(rawBatch), CURRENT_BATCH_SHA256);
  assert.equal(receipt.status, 'COMPLETE_PASS');
  assert.equal(receipt.auditPacketSha256, ATTEMPT_004_PACKET_SHA256);
  assert.equal(receipt.auditedSourceBatch.rawSha256, CURRENT_BATCH_SHA256);
  assert.equal(receipt.rawResultArtifact.sha256, ATTEMPT_004_RESULT_SHA256);
  assert.deepEqual(receipt.summary, { total: 32, PASS: 32, FAIL: 0, UNCERTAIN: 0 });
  assert.equal(receipt.rows.length, 32);
  assert.equal(new Set(receipt.rows.map(row => row.auditRowId)).size, 32);
  assert.deepEqual(new Set(receipt.rows.map(row => row.auditRowId)),
    new Set(packet.rows.map(row => row.auditRowId)));
  assert.ok(receipt.rows.every(row => row.disposition === 'PASS'
    && typeof row.reason === 'string' && row.reason.trim()));
  assert.equal(receipt.authority.sourceBundleGatePassed, true);
  assert.equal(receipt.authority.humanSemanticReviewOccurred, false);
  assert.equal(receipt.authority.surfaceHumanGoldAssigned, false);
  assert.equal(receipt.authority.trainingOccurred, false);
  assert.equal(sha256RawBytes(fs.readFileSync(path.join(ROOT, ATTEMPT_001_PATH))),
    '95026b2f6b274e5d909faba96c6cb7345e1286b9f6824450b971936fd685677b');
  assert.equal(sha256RawBytes(fs.readFileSync(path.join(ROOT, ATTEMPT_002_PATH))),
    '30d87b5949dbbf68624cfa28bd04977dc5248ae561c8e3410ab18604d90cded4');
  assert.equal(sha256RawBytes(fs.readFileSync(path.join(ROOT, ATTEMPT_003_PATH))),
    '8e91b91866f6f958dd5877ceeddd8717a5946b308fa7c591e097fd6ed52ca9e2');
  assert.equal(sha256RawBytes(fs.readFileSync(path.join(ROOT, HUMAN_ATTEMPT_001_PATH))),
    '816a24aec8ca429fad3582dfd972bffb6437c9d41d7ddebd393674fb48d4d8e2');
});

test('primary HUMAN review attempt 001 records only the authoritative blind decisions', () => {
  const receipt = JSON.parse(fs.readFileSync(path.join(ROOT, HUMAN_ATTEMPT_001_PATH)));
  const auditReceipt = JSON.parse(fs.readFileSync(path.join(ROOT, ATTEMPT_002_PATH)));
  const packet = humanReview.buildHumanReviewPacket(rawReviewedBatch, auditReceipt);
  assert.equal(receipt.status, 'COMPLETE_NEEDS_FIX');
  assert.equal(receipt.primaryHumanReviewPacket.identity, humanReview.PACKET_IDENTITY);
  assert.equal(receipt.primaryHumanReviewPacket.rawSha256, REVIEW_PACKET_SHA256);
  assert.equal(sha256RawBytes(humanReview.packetBytes(packet)), REVIEW_PACKET_SHA256);
  assert.equal(receipt.reviewedSourceBatch.rawSha256, REVIEWED_BATCH_SHA256);
  assert.equal(receipt.rendererIdentity, surfaces.RENDERER_IDENTITY);
  assert.deepEqual(receipt.summary, {
    total: 32, KEEP: 31, FIX: 1, REJECT: 0, CLEAR: 21, ESCALATE: 11,
  });
  assert.equal(receipt.rows.length, 32);
  assert.equal(new Set(receipt.rows.map(row => row.reviewRowId)).size, 32);
  assert.deepEqual(new Set(receipt.rows.map(row => row.reviewRowId)),
    new Set(packet.rows.map(row => row.reviewRowId)));
  assert.deepEqual(receipt.rows.reduce((counts, row) => {
    counts[row.disposition] += 1;
    counts[row.decision] += 1;
    return counts;
  }, { KEEP: 0, FIX: 0, REJECT: 0, CLEAR: 0, ESCALATE: 0 }),
  { KEEP: 31, FIX: 1, REJECT: 0, CLEAR: 21, ESCALATE: 11 });
  assert.deepEqual(receipt.rows.find(row => row.reviewRowId === 'p1b6-review-32cf5944a665da2b'),
    { reviewRowId: 'p1b6-review-32cf5944a665da2b', disposition: 'KEEP', decision: 'CLEAR' });
  const fixRows = receipt.rows.filter(row => row.disposition === 'FIX');
  assert.equal(fixRows.length, 1);
  assert.deepEqual(Object.keys(fixRows[0]), ['reviewRowId', 'disposition', 'decision', 'reason']);
  assert.ok(receipt.rows.filter(row => row.disposition !== 'FIX')
    .every(row => Object.keys(row).join(',') === 'reviewRowId,disposition,decision'));
  assert.equal(receipt.authority.reviewCompletedForAllPresentedRows, true);
  assert.equal(receipt.authority.humanReviewGateClosed, false);
  assert.equal(receipt.authority.surfaceHumanGoldFrozen, false);
  assert.equal(receipt.authority.modelInferenceUsedForHumanDecisions, false);
  assert.equal(receipt.authority.trainingOccurred, false);
  const serialized = JSON.stringify(receipt);
  for (const field of [
    'itemId', 'sourceEpisodeId', 'semanticSkeletonId', 'splitAssignment',
    'boundaryClass', 'humanLabel', 'skeletonLabel', 'auditReason',
    'discoursePattern', 'sourceFamilyId', 'surfaceFamilyId',
  ]) assert.equal(serialized.includes(`"${field}"`), false, field);
  for (const row of auditReceipt.rows) assert.equal(serialized.includes(row.reason), false);
});

test('the HUMAN repair changes one role field, one episode, and two visible bundles only', () => {
  assert.equal(sha256RawBytes(rawReviewedBatch), REVIEWED_BATCH_SHA256);
  assert.equal(sha256RawBytes(rawAttempt003Batch), ATTEMPT_003_BATCH_SHA256);
  assert.notEqual(ATTEMPT_003_BATCH_SHA256, REVIEWED_BATCH_SHA256);
  const item = attempt003Batch.items.find(row =>
    humanReview.opaqueReviewRowId(REVIEWED_BATCH_SHA256, row.itemId) === REPAIR_REVIEW_ROW_ID);
  const currentEpisode = attempt003Batch.sourceEpisodes.find(row => row.sourceEpisodeId === item.sourceEpisodeId);
  assert.equal(currentEpisode.turns.find(turn => turn.turnId === item.evidenceSpanRefs[2].turnId).role, 'USER');
  assert.deepEqual(attempt003Batch.sourceEpisodes.map(row => row.turns.map(turn => turn.text)),
    reviewedBatch.sourceEpisodes.map(row => row.turns.map(turn => turn.text)));
  assert.equal(attempt003Batch.sourceEpisodes.filter((episode, index) =>
    JSON.stringify(episode) !== JSON.stringify(reviewedBatch.sourceEpisodes[index])).length, 1);
  assert.equal(attempt003Batch.items.filter((row, index) =>
    surfaces.renderHumanReviewText(attempt003Batch, row)
      !== surfaces.renderHumanReviewText(reviewedBatch, reviewedBatch.items[index])).length, 2);
  assert.deepEqual(attempt003Batch.items, reviewedBatch.items);
  const sameRole = structuredClone(attempt003Batch);
  sameRole.sourceEpisodes[0].turns[1].role = sameRole.sourceEpisodes[0].turns[0].role;
  assert.doesNotThrow(() => surfaces.validateSurfaceBatch(sameRole));
  assert.equal(sha256RawBytes(fs.readFileSync(path.join(ROOT, ATTEMPT_001_PATH))),
    '95026b2f6b274e5d909faba96c6cb7345e1286b9f6824450b971936fd685677b');
  assert.equal(sha256RawBytes(fs.readFileSync(path.join(ROOT, ATTEMPT_002_PATH))),
    '30d87b5949dbbf68624cfa28bd04977dc5248ae561c8e3410ab18604d90cded4');
  assert.equal(sha256RawBytes(fs.readFileSync(path.join(ROOT, HUMAN_ATTEMPT_001_PATH))),
    '816a24aec8ca429fad3582dfd972bffb6437c9d41d7ddebd393674fb48d4d8e2');
});

test('the source-audit repair changes one evidence span and one visible bundle only', () => {
  assert.equal(sha256RawBytes(rawBatch), CURRENT_BATCH_SHA256);
  assert.deepEqual(batch.sourceEpisodes, attempt003Batch.sourceEpisodes);
  assert.deepEqual(batch.sourceEpisodes.map(row => row.turns.map(turn => turn.text)),
    attempt003Batch.sourceEpisodes.map(row => row.turns.map(turn => turn.text)));
  assert.deepEqual(batch.sourceEpisodes.map(row => row.turns.map(turn => turn.role)),
    attempt003Batch.sourceEpisodes.map(row => row.turns.map(turn => turn.role)));

  const changedItems = batch.items.filter((row, index) =>
    JSON.stringify(row) !== JSON.stringify(attempt003Batch.items[index]));
  assert.equal(changedItems.length, 1);
  const changedItem = changedItems[0];
  const priorItem = attempt003Batch.items.find(row => row.itemId === changedItem.itemId);
  assert.deepEqual({ ...changedItem, evidenceSpanRefs: priorItem.evidenceSpanRefs }, priorItem);
  const added = changedItem.evidenceSpanRefs.filter(span =>
    !priorItem.evidenceSpanRefs.some(prior => JSON.stringify(prior) === JSON.stringify(span)));
  assert.equal(added.length, 1);
  assert.deepEqual(changedItem.evidenceSpanRefs.filter(span => span !== added[0]), priorItem.evidenceSpanRefs);
  const episode = batch.sourceEpisodes.find(row => row.sourceEpisodeId === changedItem.sourceEpisodeId);
  const turn = episode.turns.find(row => row.turnId === added[0].turnId);
  assert.deepEqual(added[0], { turnId: turn.turnId, startByte: 0, endByte: Buffer.byteLength(turn.text, 'utf8') });
  assert.equal(batch.items.filter((row, index) => surfaces.renderHumanReviewText(batch, row)
    !== surfaces.renderHumanReviewText(attempt003Batch, attempt003Batch.items[index])).length, 1);
  assert.equal(batch.items.filter((row, index) => surfaces.renderHumanReviewText(batch, row)
    !== surfaces.renderHumanReviewText(reviewedBatch, reviewedBatch.items[index])).length, 3);
});

test('attempt 003 packet remains bound to the pre-repair batch', () => {
  const packet = audit.buildAuditPacket(rawAttempt003Batch);
  const bytes = Buffer.from(`${JSON.stringify(packet, null, 2)}\n`);
  assert.equal(packet.sourceBatch.sha256, ATTEMPT_003_BATCH_SHA256);
  assert.equal(packet.rendererIdentity, surfaces.RENDERER_IDENTITY);
  assert.equal(packet.rows.length, 32);
  assert.equal(new Set(packet.rows.map(row => row.auditRowId)).size, 32);
  assert.deepEqual(packet.rows.map(row => row.auditRowId),
    attempt003Batch.items.map(item => audit.opaqueAuditRowId(ATTEMPT_003_BATCH_SHA256, item.itemId)));
  assert.equal(sha256RawBytes(bytes), ATTEMPT_003_PACKET_SHA256);
});

test('attempt 004 packet is fresh, complete, and unreviewed for the repaired batch', () => {
  const prior = audit.buildAuditPacket(rawAttempt003Batch);
  const packet = audit.buildAuditPacket(rawBatch);
  const bytes = Buffer.from(`${JSON.stringify(packet, null, 2)}\n`);
  assert.equal(packet.sourceBatch.sha256, CURRENT_BATCH_SHA256);
  assert.equal(packet.rows.length, 32);
  assert.equal(new Set(packet.rows.map(row => row.auditRowId)).size, 32);
  assert.ok(packet.rows.every((row, index) => row.auditRowId !== prior.rows[index].auditRowId));
  assert.ok(packet.rows.every(row => Object.hasOwn(row, 'disposition') === false));
  assert.equal(sha256RawBytes(bytes), ATTEMPT_004_PACKET_SHA256);
});

test('primary HUMAN review builder fails closed on incomplete or stale audit state', () => {
  const receipt = JSON.parse(fs.readFileSync(path.join(ROOT, ATTEMPT_002_PATH)));
  const changedReceipt = mutator => {
    const value = structuredClone(receipt);
    mutator(value);
    return value;
  };
  assert.throws(() => humanReview.buildHumanReviewPacket(rawReviewedBatch, changedReceipt(value => {
    value.rows.pop();
    value.summary.total -= 1;
    value.summary.PASS -= 1;
  })), /all-PASS|missing/u);
  assert.throws(() => humanReview.buildHumanReviewPacket(rawReviewedBatch, changedReceipt(value => {
    value.rows[1] = structuredClone(value.rows[0]);
  })), /incomplete, stale, or not all PASS/u);
  for (const disposition of ['FAIL', 'UNCERTAIN']) {
    assert.throws(() => humanReview.buildHumanReviewPacket(rawReviewedBatch, changedReceipt(value => {
      value.rows[0].disposition = disposition;
    })), /not all PASS/u);
  }
  assert.throws(() => humanReview.buildHumanReviewPacket(rawReviewedBatch, changedReceipt(value => {
    value.auditedSourceBatch.rawSha256 = '0'.repeat(64);
  })), /binding is invalid/u);
  assert.throws(() => humanReview.buildHumanReviewPacket(rawReviewedBatch, changedReceipt(value => {
    value.rows[0].auditRowId = 'p1b6-audit-0000000000000000';
  })), /incomplete, stale, or not all PASS/u);
});

test('primary HUMAN review packet is deterministic and contains only blind fields', () => {
  const receipt = JSON.parse(fs.readFileSync(path.join(ROOT, ATTEMPT_002_PATH)));
  const packet = humanReview.buildHumanReviewPacket(rawReviewedBatch, receipt);
  const batchSha256 = sha256RawBytes(rawReviewedBatch);
  const expected = new Map(reviewedBatch.items.map(item => [
    humanReview.opaqueReviewRowId(batchSha256, item.itemId),
    surfaces.renderHumanReviewText(reviewedBatch, item),
  ]));
  assert.deepEqual(Object.keys(packet), [
    'name', 'sourceBatch', 'rendererIdentity', 'sourceAuditAttempt', 'rows',
  ]);
  assert.deepEqual(Object.keys(packet.sourceBatch), ['identity', 'sha256']);
  assert.equal(packet.rows.length, 32);
  assert.equal(new Set(packet.rows.map(row => row.reviewRowId)).size, 32);
  assert.deepEqual(packet.rows.map(row => row.reviewRowId),
    packet.rows.map(row => row.reviewRowId).toSorted());
  for (const row of packet.rows) {
    assert.deepEqual(Object.keys(row), ['reviewRowId', 'selectedBundle']);
    assert.equal(row.selectedBundle, expected.get(row.reviewRowId));
    assert.equal((row.selectedBundle.match(/\[TARGET\]/gu) || []).length, 1);
    assert.equal((row.selectedBundle.match(/\[\/TARGET\]/gu) || []).length, 1);
  }
  assert.deepEqual(humanReview.buildHumanReviewPacket(rawReviewedBatch, receipt), packet);
  assert.equal(sha256RawBytes(humanReview.packetBytes(packet)), REVIEW_PACKET_SHA256);
  const serialized = JSON.stringify(packet);
  for (const field of [
    'itemId', 'auditRowId', 'sourceEpisodeId', 'semanticSkeletonId', 'humanLabel',
    'boundaryClass', 'splitAssignment', 'language', 'discoursePattern',
    'sourceFamilyId', 'surfaceFamilyId', 'intendedLabel', 'rationale', 'reason',
    'disposition', 'sourceEpisode', 'turns',
  ]) assert.equal(serialized.includes(`"${field}"`), false, field);
  assert.doesNotMatch(serialized, /p1b6-(?:audit|item|sk|se|sf|surface-family)-/u);
  for (const row of receipt.rows) assert.equal(serialized.includes(row.reason), false);
});

test('focused HUMAN re-review packet discovers exactly three changed visible bundles', () => {
  const auditReceipt = JSON.parse(fs.readFileSync(path.join(ROOT, ATTEMPT_004_PATH)));
  const originalReceipt = JSON.parse(fs.readFileSync(path.join(ROOT, HUMAN_ATTEMPT_001_PATH)));
  const packet = humanRereview.buildRereviewPacket(
    rawBatch, auditReceipt, rawOriginalPacket, originalReceipt,
  );
  const originalRows = new Map(originalPacket.rows.map(row => [row.reviewRowId, row.selectedBundle]));
  const changedItems = batch.items.filter(item => originalRows.get(humanReview.opaqueReviewRowId(
    REVIEWED_BATCH_SHA256, item.itemId,
  )) !== surfaces.renderHumanReviewText(batch, item));
  const expected = new Map(changedItems.map(item => [
    humanRereview.opaqueRereviewRowId(CURRENT_BATCH_SHA256, item.itemId),
    surfaces.renderHumanReviewText(batch, item),
  ]));

  assert.equal(sha256RawBytes(rawOriginalPacket), REVIEW_PACKET_SHA256);
  assert.equal(changedItems.length, 3);
  assert.deepEqual(Object.keys(packet), [
    'name', 'sourceBatch', 'rendererIdentity', 'sourceAuditAttempt',
    'originalPrimaryHumanAttempt', 'originalPrimaryHumanPacketSha256', 'rows',
  ]);
  assert.deepEqual(Object.keys(packet.sourceBatch), ['identity', 'sha256']);
  assert.equal(packet.name, humanRereview.PACKET_IDENTITY);
  assert.equal(packet.sourceBatch.sha256, CURRENT_BATCH_SHA256);
  assert.equal(packet.sourceAuditAttempt, humanRereview.AUDIT_ATTEMPT_ID);
  assert.equal(packet.originalPrimaryHumanAttempt, humanRereview.ORIGINAL_ATTEMPT_ID);
  assert.equal(packet.originalPrimaryHumanPacketSha256, REVIEW_PACKET_SHA256);
  assert.equal(packet.rows.length, 3);
  assert.equal(new Set(packet.rows.map(row => row.reviewRowId)).size, 3);
  assert.deepEqual(packet.rows.map(row => row.reviewRowId),
    packet.rows.map(row => row.reviewRowId).toSorted());
  for (const row of packet.rows) {
    assert.deepEqual(Object.keys(row), ['reviewRowId', 'selectedBundle']);
    assert.match(row.reviewRowId, /^p1b6-rereview-[0-9a-f]{16}$/u);
    assert.equal(row.selectedBundle, expected.get(row.reviewRowId));
  }
  assert.deepEqual(humanRereview.buildRereviewPacket(
    rawBatch, auditReceipt, rawOriginalPacket, originalReceipt,
  ), packet);
  assert.equal(sha256RawBytes(humanRereview.packetBytes(packet)), REREVIEW_PACKET_SHA256);
  const serialized = JSON.stringify(packet);
  for (const field of [
    'itemId', 'auditRowId', 'sourceEpisodeId', 'semanticSkeletonId', 'humanLabel',
    'boundaryClass', 'splitAssignment', 'language', 'discoursePattern',
    'sourceFamilyId', 'surfaceFamilyId', 'disposition', 'decision', 'reason',
    'sourceEpisode', 'turns',
  ]) assert.equal(serialized.includes(`"${field}"`), false, field);
  assert.doesNotMatch(serialized, /p1b6-(?:audit|review|item|sk|se|sf|surface-family)-/u);
  for (const row of originalPacket.rows) assert.equal(serialized.includes(row.reviewRowId), false);
  const script = fs.readFileSync(
    path.join(ROOT, 'scripts/build-memory-inference-p1b6-human-rereview-packet.js'), 'utf8',
  );
  assert.doesNotMatch(script, /p1b6-item-/u);
  assert.doesNotMatch(script, /\bfetch\s*\(|https?:\/\//u);
});

test('focused HUMAN re-review attempt 002 binds the exact packet and authoritative decisions', () => {
  assert.equal(sha256RawBytes(rawRereviewPacket), REREVIEW_PACKET_SHA256);
  assert.equal(rereviewPacket.rows.length, 3);
  assert.equal(new Set(rereviewPacket.rows.map(row => row.reviewRowId)).size, 3);
  assert.deepEqual(rereviewReceipt.rows, [
    { reviewRowId: 'p1b6-rereview-2a59d0efa5fa4a5c', disposition: 'KEEP', decision: 'CLEAR' },
    { reviewRowId: 'p1b6-rereview-3103bdf5fda47336', disposition: 'KEEP', decision: 'ESCALATE' },
    { reviewRowId: 'p1b6-rereview-5b1aab95130e93ee', disposition: 'KEEP', decision: 'CLEAR' },
  ]);
  assert.deepEqual(rereviewReceipt.summary, {
    total: 3, KEEP: 3, FIX: 0, REJECT: 0, CLEAR: 2, ESCALATE: 1,
  });
  assert.doesNotThrow(() => humanRereview.validateRereviewReceipt(
    rawBatch, attempt004Receipt, rawOriginalPacket, originalHumanReceipt,
    rawRereviewPacket, rereviewReceipt,
  ));
  const serialized = JSON.stringify(rereviewReceipt);
  for (const field of [
    'itemId', 'sourceEpisodeId', 'semanticSkeletonId', 'splitAssignment',
    'boundaryClass', 'humanLabel', 'auditRowId', 'reason', 'discoursePattern',
    'sourceFamilyId', 'surfaceFamilyId',
  ]) assert.equal(serialized.includes(`"${field}"`), false, field);
});

test('effective current HUMAN decisions mechanically replace all changed historical rows', () => {
  const built = humanRereview.buildEffectiveHumanDecisionSet(
    rawBatch, attempt004Receipt, rawOriginalPacket, originalHumanReceipt,
    rawRereviewPacket, rereviewReceipt,
    fs.readFileSync(path.join(ROOT, surfaces.EXACT56_PATH)),
  );
  assert.deepEqual(built, effectiveHuman);
  assert.deepEqual(built.summary, {
    total: 32, KEEP: 32, FIX: 0, REJECT: 0, CLEAR: 20, ESCALATE: 12,
  });
  assert.equal(built.rows.length, 32);
  assert.equal(new Set(built.rows.map(row => row.itemId)).size, 32);

  const originalBundles = new Map(originalPacket.rows.map(row => [row.reviewRowId, row.selectedBundle]));
  const changedItems = batch.items.filter(item => originalBundles.get(humanReview.opaqueReviewRowId(
    REVIEWED_BATCH_SHA256, item.itemId,
  )) !== surfaces.renderHumanReviewText(batch, item));
  assert.equal(changedItems.length, 3);
  const rereviewRows = new Map(rereviewReceipt.rows.map(row => [row.reviewRowId, row]));
  const effectiveRows = new Map(built.rows.map(row => [row.itemId, row]));
  for (const item of changedItems) {
    const expected = rereviewRows.get(humanRereview.opaqueRereviewRowId(CURRENT_BATCH_SHA256, item.itemId));
    assert.deepEqual(effectiveRows.get(item.itemId), {
      itemId: item.itemId, disposition: expected.disposition, decision: expected.decision,
    });
  }

  const conflictingHistory = structuredClone(originalHumanReceipt);
  const changedOriginalIds = new Set(changedItems.map(item => humanReview.opaqueReviewRowId(
    REVIEWED_BATCH_SHA256, item.itemId,
  )));
  for (const row of conflictingHistory.rows) {
    if (changedOriginalIds.has(row.reviewRowId)) {
      row.disposition = 'REJECT';
      row.decision = row.decision === 'CLEAR' ? 'ESCALATE' : 'CLEAR';
    }
  }
  const rebuilt = humanRereview.buildEffectiveHumanDecisionSet(
    rawBatch, attempt004Receipt, rawOriginalPacket, conflictingHistory,
    rawRereviewPacket, rereviewReceipt,
    fs.readFileSync(path.join(ROOT, surfaces.EXACT56_PATH)),
  );
  for (const item of changedItems) assert.deepEqual(
    rebuilt.rows.find(row => row.itemId === item.itemId),
    effectiveRows.get(item.itemId),
  );
});

test('frozen skeleton reconciliation is deterministic and closes only with zero mismatches', () => {
  assert.deepEqual(effectiveHuman.reconciliation, {
    exact56Sha256: surfaces.EXACT56_SHA256, matchCount: 30, mismatchCount: 2,
  });
  assert.equal(effectiveHuman.status, 'RECONCILIATION_NEEDS_FIX');
  assert.equal(effectiveHuman.authority.humanReviewCompleted, false);
  assert.equal(effectiveHuman.authority.surfaceHumanGoldFrozen, false);

  const labels = new Map(exact56.candidates.map(row => [row.semanticSkeletonId, row.humanLabel]));
  const aligned = batch.items.map(item => ({
    itemId: item.itemId, disposition: 'KEEP', decision: labels.get(item.semanticSkeletonId),
  }));
  assert.deepEqual(humanRereview.reconcileEffectiveHumanDecisions(batch, aligned, exact56), {
    matchCount: 32, mismatchCount: 0, humanReviewCompleted: true,
  });
  const syntheticMismatch = structuredClone(aligned);
  syntheticMismatch[0].decision = syntheticMismatch[0].decision === 'CLEAR' ? 'ESCALATE' : 'CLEAR';
  assert.deepEqual(humanRereview.reconcileEffectiveHumanDecisions(
    batch, syntheticMismatch, exact56,
  ), { matchCount: 31, mismatchCount: 1, humanReviewCompleted: false });
  assert.deepEqual(effectiveHuman.rows, humanRereview.buildEffectiveHumanDecisionSet(
    rawBatch, attempt004Receipt, rawOriginalPacket, originalHumanReceipt,
    rawRereviewPacket, rereviewReceipt,
    fs.readFileSync(path.join(ROOT, surfaces.EXACT56_PATH)),
  ).rows);
});

test('smoke acceptance mechanically excludes only the two reconciliation mismatches', () => {
  const rawExact56 = fs.readFileSync(path.join(ROOT, surfaces.EXACT56_PATH));
  assert.deepEqual(humanRereview.buildSmokeBatchAcceptance(
    rawBatch, attempt004Receipt, rawEffectiveHuman, rawExact56,
  ), smokeAcceptance);
  assert.deepEqual(smokeAcceptance.summary, {
    reviewed: 32, accepted: 30, rejected: 2, unresolved: 0,
  });
  assert.deepEqual(smokeAcceptance.authority, {
    sourceBundleGatePassed: true,
    primaryHumanReviewResolved: true,
    finalCorpusHumanGoldFrozen: false,
    heldRepeatedReviewCompleted: false,
    trainingOccurred: false,
  });

  const effectiveRows = new Map(effectiveHuman.rows.map(row => [row.itemId, row]));
  const expectedAccepted = batch.items.filter(item =>
    effectiveRows.get(item.itemId).decision === skeletons.get(item.semanticSkeletonId).humanLabel)
    .map(item => item.itemId).toSorted();
  const expectedRejected = batch.items.filter(item =>
    effectiveRows.get(item.itemId).decision !== skeletons.get(item.semanticSkeletonId).humanLabel)
    .map(item => item.itemId).toSorted();
  assert.deepEqual(smokeAcceptance.accepted.map(row => row.itemId), expectedAccepted);
  assert.deepEqual(smokeAcceptance.rejected.map(row => row.itemId), expectedRejected);
  for (const row of smokeAcceptance.accepted) {
    const item = batch.items.find(candidate => candidate.itemId === row.itemId);
    assert.equal(row.decision, effectiveRows.get(row.itemId).decision);
    assert.equal(row.decision, skeletons.get(item.semanticSkeletonId).humanLabel);
  }
  for (const row of smokeAcceptance.rejected) {
    assert.deepEqual(Object.keys(row), ['itemId', 'reasonCode']);
    assert.equal(row.reasonCode, humanRereview.SKELETON_MISMATCH_REASON);
    assert.equal(effectiveRows.get(row.itemId).disposition, 'KEEP');
  }

  const changedRows = structuredClone(effectiveHuman.rows);
  const acceptedRow = changedRows.find(row => row.itemId === smokeAcceptance.accepted[0].itemId);
  acceptedRow.decision = acceptedRow.decision === 'CLEAR' ? 'ESCALATE' : 'CLEAR';
  assert.throws(() => humanRereview.classifySmokeAcceptance(batch, changedRows, exact56),
    /exactly 30 matches and two mismatches/u);
});

test('P1-B6 source, audit history, primary review, and exact56 bytes remain frozen', () => {
  const hashes = {
    [BATCH_PATH]: CURRENT_BATCH_SHA256,
    [ATTEMPT_001_PATH]: '95026b2f6b274e5d909faba96c6cb7345e1286b9f6824450b971936fd685677b',
    [ATTEMPT_002_PATH]: '30d87b5949dbbf68624cfa28bd04977dc5248ae561c8e3410ab18604d90cded4',
    [ATTEMPT_003_PATH]: '8e91b91866f6f958dd5877ceeddd8717a5946b308fa7c591e097fd6ed52ca9e2',
    [ATTEMPT_004_PATH]: 'a49e9a08fd2eb4da78c4a394734aa3cead2cb69505b91e87344ffafba609b162',
    [HUMAN_ATTEMPT_001_PATH]: '816a24aec8ca429fad3582dfd972bffb6437c9d41d7ddebd393674fb48d4d8e2',
    [HUMAN_REREVIEW_ATTEMPT_002_PATH]: '2c41dcd1c36231039958839a35e53cab187c5bbd1caf992d5c6f96aca30fd21e',
    [EFFECTIVE_HUMAN_PATH]: humanRereview.EFFECTIVE_DECISIONS_SHA256,
    [surfaces.EXACT56_PATH]: surfaces.EXACT56_SHA256,
  };
  for (const [file, expected] of Object.entries(hashes)) {
    assert.equal(sha256RawBytes(fs.readFileSync(path.join(ROOT, file))), expected, file);
  }
});

test('focused HUMAN re-review CLI accepts only the five bound artifact paths', () => {
  const args = [
    '--input', 'batch.json', '--audit-receipt', 'audit.json',
    '--original-packet', 'packet.json', '--original-receipt', 'receipt.json',
    '--output', 'output.json',
  ];
  assert.deepEqual(humanRereview.parseArgs(args), {
    inputPath: 'batch.json',
    auditReceiptPath: 'audit.json',
    originalPacketPath: 'packet.json',
    originalReceiptPath: 'receipt.json',
    outputPath: 'output.json',
  });
  assert.throws(() => humanRereview.parseArgs(args.slice(0, -2)));
  assert.throws(() => humanRereview.parseArgs([...args, '--model', 'x']));

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'p1b6-human-rereview-'));
  const originalPacketPath = path.join(directory, 'original.json');
  const outputPath = path.join(directory, 'output.json');
  fs.writeFileSync(originalPacketPath, rawOriginalPacket);
  const packet = humanRereview.writeRereviewPacket(
    path.join(ROOT, BATCH_PATH), path.join(ROOT, ATTEMPT_004_PATH), originalPacketPath,
    path.join(ROOT, HUMAN_ATTEMPT_001_PATH), outputPath,
  );
  assert.deepEqual(JSON.parse(fs.readFileSync(outputPath)), packet);
  assert.throws(() => humanRereview.writeRereviewPacket(
    path.join(ROOT, BATCH_PATH), path.join(ROOT, ATTEMPT_004_PATH), originalPacketPath,
    path.join(ROOT, HUMAN_ATTEMPT_001_PATH), outputPath,
  ), /not be overwritten/u);
  fs.rmSync(directory, { recursive: true, force: true });
});

test('focused HUMAN re-review fails closed on stale or non-PASS audit state', () => {
  const receipt = JSON.parse(fs.readFileSync(path.join(ROOT, ATTEMPT_004_PATH)));
  const originalReceipt = JSON.parse(fs.readFileSync(path.join(ROOT, HUMAN_ATTEMPT_001_PATH)));
  const changedReceipt = mutator => {
    const value = structuredClone(receipt);
    mutator(value);
    return value;
  };
  assert.throws(() => humanRereview.buildRereviewPacket(rawBatch, changedReceipt(value => {
    value.status = 'COMPLETE_NEEDS_FIX';
  }), rawOriginalPacket, originalReceipt), /binding is invalid/u);
  assert.throws(() => humanRereview.buildRereviewPacket(rawBatch, changedReceipt(value => {
    value.rows[0].disposition = 'FAIL';
  }), rawOriginalPacket, originalReceipt), /non-PASS/u);
  assert.throws(() => humanRereview.buildRereviewPacket(rawBatch, changedReceipt(value => {
    value.rows[1] = structuredClone(value.rows[0]);
  }), rawOriginalPacket, originalReceipt), /duplicate/u);
  assert.throws(() => humanRereview.buildRereviewPacket(rawBatch, changedReceipt(value => {
    value.auditedSourceBatch.rawSha256 = '0'.repeat(64);
  }), rawOriginalPacket, originalReceipt), /binding is invalid/u);
});

test('focused HUMAN re-review fails closed on stale original HUMAN artifacts', () => {
  const auditReceipt = JSON.parse(fs.readFileSync(path.join(ROOT, ATTEMPT_004_PATH)));
  const receipt = JSON.parse(fs.readFileSync(path.join(ROOT, HUMAN_ATTEMPT_001_PATH)));
  assert.throws(() => humanRereview.buildRereviewPacket(
    rawBatch, auditReceipt, Buffer.concat([rawOriginalPacket, Buffer.from(' ')]), receipt,
  ), /packet hash is invalid/u);
  for (const mutate of [
    value => value.rows.pop(),
    value => { value.rows[1] = structuredClone(value.rows[0]); },
  ]) {
    const packet = structuredClone(originalPacket);
    mutate(packet);
    assert.throws(() => humanRereview.buildRereviewPacket(
      rawBatch, auditReceipt, humanReview.packetBytes(packet), receipt,
    ), /packet hash is invalid/u);
  }
  for (const mutate of [
    value => value.rows.pop(),
    value => { value.rows[1] = structuredClone(value.rows[0]); },
    value => { value.primaryHumanReviewPacket.rawSha256 = '0'.repeat(64); },
  ]) {
    const changed = structuredClone(receipt);
    mutate(changed);
    assert.throws(() => humanRereview.buildRereviewPacket(
      rawBatch, auditReceipt, rawOriginalPacket, changed,
    ), /binding is invalid|receipt rows/u);
  }
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
