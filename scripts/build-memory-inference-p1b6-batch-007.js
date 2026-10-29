#!/usr/bin/env node
'use strict';

// P1-B6 batch-007 top-up, the single top-up the contract freeze allows: shortage v6 is short
// TRAIN 11, DEV 7 and HELD 3 (per skeleton 11e63b75 2, a19bb9e9 1), with KO 12 / MIXED 3 / EN 2
// and fragments 1:3 2:6 3:1 4:6 5:1, which these slots also cover.
//
// Owner-approved parameters (2026-10-29): 27 slots (lower bound 21 + buffer 6). TRAIN and DEV
// skeletons by water-filling the lowest pooled coverage, ties by skeleton ID, at most 4 slots per
// skeleton; 43016ef6 (redefined as the user's own stance, zero coverage) is capped at 2 as a
// realizability probe; 5fc872af is left uncovered. HELD by need plus one buffer per skeleton.
// Authoring target labels are the v4 labels. Every TARGET is the user's own state. Offsets and
// IDs are computed from the authored text. Nothing is audited, reviewed, accepted or trained here.

const fs = require('node:fs');
const path = require('node:path');
const { sha256RawBytes } = require('../lib/memory-inference-p1b6-skeletons');

const ROOT = path.resolve(__dirname, '..');
const PROTOCOL_IDENTITY = 'xion-local-memory-inference-p1b6-surface-batch-007-authoring-protocol-v1';
const PROTOCOL_FILE = 'local-memory-inference-p1b6-surface-batch-007-authoring-protocol.json';

const SOURCES = Object.freeze({
  v4: ['xion-local-memory-inference-p1b6-skeleton-effective-current-v4', 'a53debe1b065e9bbd5a94f32036f8ac2586eae72b2f5a6bdf9fae0a93dfed194', 'local-memory-inference-p1b6-skeleton-effective-current-v4.json'],
  ledgerV6: ['xion-local-memory-inference-p1b6-reviewed-pool-ledger-v6', 'd5b9da39032eaf4ed09b78493690cf88b686e3075f2b5d548b19676f4debc592', 'local-memory-inference-p1b6-reviewed-pool-ledger-v6.json'],
  shortageV6: ['xion-local-memory-inference-p1b6-shortage-receipt-v6', '93aa6862dbce8c7050af10486d7f248c85e2fc5dce6ab19fbb5eaee281e2af8d', 'local-memory-inference-p1b6-shortage-receipt-v6.json'],
  scopeProtocol: ['xion-local-memory-inference-p1b6-user-centered-scope-review-protocol-v1', '38eef07a36b05b449e7482b9bea17aeff2a39130e0ddce47c5a44583ebe3dfe7', 'local-memory-inference-p1b6-user-centered-scope-review-protocol.json'],
  reviewProtocol: ['xion-local-memory-inference-p1b6-v4-strong-model-review-protocol-v1', '229d0026867aa5ed33a21cbc6984236ca98ad1a4ec90d2710cb9fdada5fba652', 'local-memory-inference-p1b6-v4-strong-model-review-protocol.json'],
});

const HELD = 'FINAL_HELD_OUT';
const SKELETON_CAP = 4;
const PROBE_CAP = Object.freeze({ 'p1b6-sk-43016ef6da889a87': 2 });
const LEFT_UNCOVERED = Object.freeze(['p1b6-sk-5fc872afb058b370']);
const HELD_BUFFER_PER_SKELETON = 1;
const CALIBRATION_HASH_DOMAIN = 'p1b6-batch-007-calibration-v1';

const slot = (n, id, split, label, language, fragments, discoursePattern, allocationRule) => Object.freeze({
  slot: n, semanticSkeletonId: `p1b6-sk-${id}`, splitAssignment: split, authoringTargetLabel: label, language, fragments, discoursePattern, allocationRule,
});
const FILL = 'lowest pooled coverage, ties by skeleton ID, cap 4';
const SLOTS = Object.freeze([
  slot('001', '43016ef6da889a87', 'TRAIN', 'ESCALATE', 'KO', 2, 'CANONICAL', 'zero coverage; realizability probe capped at 2'),
  slot('002', '43016ef6da889a87', 'TRAIN', 'ESCALATE', 'MIXED', 3, 'INTERLEAVED', 'zero coverage; realizability probe capped at 2'),
  slot('003', '53ab6351', 'TRAIN', 'ESCALATE', 'KO', 1, 'CONCLUSION_FIRST', FILL),
  slot('004', '53ab6351', 'TRAIN', 'ESCALATE', 'EN', 2, 'CANONICAL', FILL),
  slot('005', '53ab6351', 'TRAIN', 'ESCALATE', 'MIXED', 4, 'PROGRESSIVE_REFINEMENT', FILL),
  slot('006', '53ab6351', 'TRAIN', 'ESCALATE', 'KO', 4, 'SELF_REVISION', FILL),
  slot('007', '0768ea20', 'TRAIN', 'ESCALATE', 'KO', 1, 'ELLIPTICAL_REPLY', FILL),
  slot('008', '0768ea20', 'TRAIN', 'ESCALATE', 'EN', 2, 'CONTEXT_FIRST', FILL),
  slot('009', '0768ea20', 'TRAIN', 'ESCALATE', 'KO', 4, 'RETURN_TO_TOPIC', FILL),
  slot('010', '0768ea20', 'TRAIN', 'ESCALATE', 'KO', 2, 'INTERLEAVED', FILL),
  slot('011', '2da4e54e', 'TRAIN', 'ESCALATE', 'MIXED', 2, 'CANONICAL', FILL),
  slot('012', '2da4e54e', 'TRAIN', 'ESCALATE', 'KO', 4, 'CONTEXT_FIRST', FILL),
  slot('013', '2da4e54e', 'TRAIN', 'ESCALATE', 'KO', 3, 'CONCLUSION_FIRST', FILL),
  slot('014', '714725ee', 'DEV', 'CLEAR', 'KO', 2, 'CANONICAL', FILL),
  slot('015', '714725ee', 'DEV', 'CLEAR', 'KO', 4, 'INTERLEAVED', FILL),
  slot('016', '16697b52', 'DEV', 'CLEAR', 'KO', 1, 'ELLIPTICAL_REPLY', FILL),
  slot('017', '714725ee', 'DEV', 'CLEAR', 'KO', 2, 'SELF_REVISION', FILL),
  slot('018', 'aebbf047', 'DEV', 'CLEAR', 'MIXED', 4, 'CONTEXT_FIRST', FILL),
  slot('019', 'd8ca2878', 'DEV', 'CLEAR', 'EN', 2, 'CONCLUSION_FIRST', FILL),
  slot('020', 'db090829', 'DEV', 'CLEAR', 'KO', 4, 'RETURN_TO_TOPIC', FILL),
  slot('021', 'e7da7f4b', 'DEV', 'CLEAR', 'KO', 3, 'PROGRESSIVE_REFINEMENT', FILL),
  slot('022', 'f2fb3e89', 'DEV', 'CLEAR', 'KO', 5, 'CANONICAL', FILL),
  slot('023', '11e63b75bdf266dd', HELD, 'CLEAR', 'KO', 5, 'SELF_REVISION', 'HELD per-skeleton need'),
  slot('024', '11e63b75bdf266dd', HELD, 'CLEAR', 'KO', 4, 'PROGRESSIVE_REFINEMENT', 'HELD per-skeleton need'),
  slot('025', '11e63b75bdf266dd', HELD, 'CLEAR', 'KO', 5, 'CANONICAL', 'HELD buffer, one per needed skeleton'),
  slot('026', 'a19bb9e94e9a416b', HELD, 'CLEAR', 'KO', 3, 'CONTEXT_FIRST', 'HELD per-skeleton need'),
  slot('027', 'a19bb9e94e9a416b', HELD, 'CLEAR', 'KO', 1, 'CONCLUSION_FIRST', 'HELD buffer, one per needed skeleton'),
]);

function fail(message) {
  throw new TypeError(`P1-B6 batch-007 ${message}`);
}

function loadSources(root = ROOT) {
  return Object.fromEntries(Object.entries(SOURCES)
    .map(([key, [, , fixture]]) => [key, fs.readFileSync(path.join(root, 'fixtures', fixture))]));
}

function verifySources(rawSources) {
  return Object.fromEntries(Object.entries(SOURCES).map(([key, [identity, rawSha256]]) => {
    const bytes = rawSources?.[key];
    if (!bytes || sha256RawBytes(Buffer.from(bytes)) !== rawSha256) fail(`${identity} bytes are not the pinned artifact`);
    const parsed = JSON.parse(Buffer.from(bytes).toString('utf8'));
    if (parsed.name !== identity) fail(`${identity} identity is invalid`);
    return [key, parsed];
  }));
}

// Short IDs in SLOTS resolve to the one v4 skeleton whose ID starts with them.
function resolveSlots(v4) {
  return SLOTS.map(s => {
    const matches = v4.candidates.filter(row => row.semanticSkeletonId.startsWith(s.semanticSkeletonId));
    if (matches.length !== 1) fail(`slot ${s.slot} does not name exactly one v4 skeleton`);
    return { ...s, semanticSkeletonId: matches[0].semanticSkeletonId };
  });
}

// Water-fill `count` slots over the split's active skeletons: each slot goes to the lowest
// pooled-plus-allocated coverage, ties by skeleton ID, within the per-skeleton cap.
function waterFill(a, split, count) {
  const retired = new Set(a.v4.retiredSkeletons.map(row => row.retiredSkeletonId));
  const coverage = new Map(a.v4.candidates
    .filter(row => row.splitAssignment === split && !retired.has(row.semanticSkeletonId) && !LEFT_UNCOVERED.includes(row.semanticSkeletonId))
    .map(row => [row.semanticSkeletonId, 0]));
  for (const row of a.ledgerV6.rows) if (row.inPool && coverage.has(row.semanticSkeletonId)) coverage.set(row.semanticSkeletonId, coverage.get(row.semanticSkeletonId) + 1);
  const given = new Map();
  for (let i = 0; i < count; i += 1) {
    const open = [...coverage].filter(([id]) => (given.get(id) ?? 0) < (PROBE_CAP[id] ?? SKELETON_CAP))
      .sort(([x, cx], [y, cy]) => cx - cy || (x < y ? -1 : 1));
    if (!open.length) fail(`${split} has no open skeleton`);
    const [id] = open[0];
    given.set(id, (given.get(id) ?? 0) + 1);
    coverage.set(id, coverage.get(id) + 1);
  }
  return given;
}

const tally = (list, key) => list.reduce((acc, row) => {
  acc[row[key]] = (acc[row[key]] ?? 0) + 1;
  return acc;
}, {});

function buildProtocol(a) {
  const short = a.shortageV6;
  if (short.minimumTopUpLowerBound !== 21 || short.heldPerSkeletonNeed !== 3) fail('shortage v6 is not the 21-row shortage this top-up answers');
  const slots = resolveSlots(a.v4);
  const skeletons = new Map(a.v4.candidates.map(row => [row.semanticSkeletonId, row]));
  for (const s of slots) {
    const skeleton = skeletons.get(s.semanticSkeletonId);
    if (skeleton.splitAssignment !== s.splitAssignment || skeleton.humanLabel !== s.authoringTargetLabel) fail(`slot ${s.slot} does not match its v4 skeleton`);
  }
  for (const split of ['TRAIN', 'DEV']) {
    const inSplit = slots.filter(s => s.splitAssignment === split);
    const expected = waterFill(a, split, inSplit.length);
    const actual = new Map(Object.entries(tally(inSplit, 'semanticSkeletonId')));
    if (JSON.stringify([...expected].sort()) !== JSON.stringify([...actual].sort())) fail(`${split} slots are not the water-fill allocation`);
  }
  const held = slots.filter(s => s.splitAssignment === HELD);
  for (const row of short.heldSkeletons) {
    const want = row.needTo5 ? row.needTo5 + HELD_BUFFER_PER_SKELETON : 0;
    if (held.filter(s => s.semanticSkeletonId === row.semanticSkeletonId).length !== want) fail(`HELD slots on ${row.semanticSkeletonId} are not need + buffer`);
  }
  const split = tally(slots, 'splitAssignment');
  const language = tally(slots, 'language');
  const fragments = tally(slots, 'fragments');
  for (const [key, observed] of [['split', split], ['language', language], ['fragments', fragments]]) {
    for (const [cell, value] of Object.entries(short.pool[key])) {
      if ((observed[cell] ?? 0) < value.deficit) fail(`${key} ${cell} does not cover its deficit`);
    }
  }
  return {
    name: PROTOCOL_IDENTITY,
    status: 'PREREGISTERED',
    decisionsSource: 'REPOSITORY_OWNER_APPROVED_TOP_UP_PARAMETERS',
    decisionDate: '2026-10-29',
    inputs: Object.fromEntries(Object.entries(SOURCES).map(([key, [identity, rawSha256]]) => [key, { identity, rawSha256 }])),
    tranche: { total: slots.length, lowerBound: short.minimumTopUpLowerBound, buffer: slots.length - short.minimumTopUpLowerBound, split, language, fragments },
    allocation: {
      trainDev: 'water-fill: each slot to the lowest pooled-plus-allocated coverage in its split, ties by skeleton ID, at most 4 per skeleton',
      probeCaps: PROBE_CAP,
      leftUncovered: LEFT_UNCOVERED,
      held: `per-skeleton need plus ${HELD_BUFFER_PER_SKELETON} buffer on each needed skeleton`,
      singleTopUp: 'the contract freeze allows one top-up; the buffer absorbs review losses and no further top-up follows',
    },
    slots,
    authoringRules: [
      'Fresh content under the b007 namespace; no reuse of any prior text, ID or review result.',
      'The batch-003 leakage check runs fail-closed against every prior batch and candidate artifact, including batch-004, batch-005 and batch-006.',
      'Authoring target labels are the v4 labels; they are generator targets, not HUMAN gold, and never enter a blind packet.',
      'User-centered at authoring: the single TARGET denotes the user\'s own state, stance, plan, preference, commitment, habit, situation or relationship, or a rule / object state as it applies to the user. Never another person\'s state, the content of quoted speech itself, or a fact the visible evidence does not tie to the user.',
      '43016ef6: the TARGET is the user\'s own stance toward what another person said, not the quoted content; ESCALATE needs visible evidence that leaves that stance unresolved without adding premises.',
      '714725ee: the TARGET is the user\'s actual state, with role-play speech only as evidence.',
      'HELD slots are authored by the assistant and are never shown to the owner.',
    ],
    gates: {
      reviews: {
        scope: { identity: SOURCES.scopeProtocol[0], rawSha256: SOURCES.scopeProtocol[1] },
        semantic: { identity: SOURCES.reviewProtocol[0], rawSha256: SOURCES.reviewProtocol[1] },
        session: 'one fresh separate session per blind packet; every audited PASS row gets both reviews',
      },
      held: {
        order: ['fresh source/bundle audit (FAIL / UNCERTAIN excluded)', 'blind scope review', 'blind v4 strong-model semantic review'],
        routing: 'IN_SCOPE and clean v4 agreement → CATALOG_STRONG_MODEL_CONFIRMED / PROVISIONAL (the post-selection independent second strong-model review still applies); anything else → INELIGIBLE; no owner pre-audit and no HUMAN review because repeated HELD review stays unopened',
      },
      trainDev: {
        order: ['owner pre-audit authoring review', 'fresh source/bundle audit (FAIL / UNCERTAIN excluded)', 'blind scope review', 'blind v4 strong-model semantic review',
          'mandatory owner HUMAN for scope OUT / UNCERTAIN, disagreement, FIX, REJECT or missing', 'owner HUMAN calibration of a hashed share of clean agreements'],
        calibration: {
          size: 'ceil(0.2 × clean agreements)',
          rule: 'the clean agreements with the lowest sha256 of the hash domain, a NUL separator and the itemId',
          hashDomain: CALIBRATION_HASH_DOMAIN,
        },
        humanQuestions: 'the v4 HUMAN protocol\'s two questions (scope, then KEEP / FIX / REJECT with CLEAR / ESCALATE) for every HUMAN row',
        mandatoryMatchingKeepSemantics: 'IN_SCOPE and KEEP matching v4 → HUMAN_ADJUDICATED / ELIGIBLE; anything else → INELIGIBLE',
        calibrationMatchingKeepSemantics: 'IN_SCOPE and KEEP matching v4 → stays CATALOG_STRONG_MODEL_CONFIRMED / PROVISIONAL, not promoted; anything else → INELIGIBLE',
      },
    },
    authority: {
      surfacesAuthored: false, sourceAuditRun: false, semanticReviewRun: false, humanReviewRun: false,
      acceptancePerformed: false, finalSelectionPerformed: false, trainingOrEvaluationOccurred: false,
    },
  };
}

const artifactBytes = value => Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');

function main() {
  const protocol = buildProtocol(verifySources(loadSources()));
  fs.writeFileSync(path.join(ROOT, 'fixtures', PROTOCOL_FILE), artifactBytes(protocol));
  process.stdout.write(`Wrote fixtures/${PROTOCOL_FILE}\n`);
  return 0;
}

module.exports = { PROTOCOL_FILE, SLOTS, SOURCES, artifactBytes, buildProtocol, loadSources, main, verifySources, waterFill };

if (require.main === module) process.exit(main());
