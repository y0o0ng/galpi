#!/usr/bin/env node
'use strict';

// P1-B6 batch-006 top-up: ledger v4 is short DEV 1 and HELD 4 (per skeleton 2fa39ece 2, 869c7127 1,
// a19bb9e9 1), plus KO 2 and fragments 4 / 5, which these slots also cover.
//
// Owner-approved parameters (2026-10-01): seven slots (one buffer each on HELD 2fa39ece and DEV),
// HELD skeletons by need, DEV skeletons by the lowest-coverage rule with ties by ID. HELD slots are
// authored by the assistant and are not shown to the owner: no owner pre-audit and no HUMAN review
// for HELD (repeated HELD review stays unopened), only a fresh source audit and blind v3
// strong-model review. DEV slots follow the batch-004 gates. Offsets and IDs are computed from the
// authored text. Nothing is audited, reviewed, accepted or trained here.

const fs = require('node:fs');
const path = require('node:path');
const { sha256RawBytes } = require('../lib/memory-inference-p1b6-skeletons');
const { computeFragments, validateSurfaceBatch } = require('../lib/memory-inference-p1b6-surfaces');
const plan003 = require('./build-memory-inference-p1b6-batch-003-authoring-plan');

const ROOT = path.resolve(__dirname, '..');
const PROTOCOL_IDENTITY = 'xion-local-memory-inference-p1b6-surface-batch-006-authoring-protocol-v1';
const PROTOCOL_FILE = 'local-memory-inference-p1b6-surface-batch-006-authoring-protocol.json';
const BATCH_IDENTITY = 'xion-local-memory-inference-p1b6-surface-batch-006-v1';
const BATCH_FILE = 'local-memory-inference-p1b6-surface-batch-006.json';

const SOURCES = Object.freeze({
  v3: ['xion-local-memory-inference-p1b6-skeleton-effective-current-v3', '89a48264d6b09710f976a4ab85235ff161cf81ff44896e37553d5dc7753c65b9', 'local-memory-inference-p1b6-skeleton-effective-current-v3.json'],
  ledgerV4: ['xion-local-memory-inference-p1b6-reviewed-pool-ledger-v4', 'ef9fa69d34576995f597e044b4d3fe672c6353f8298f7921fe654d62e1f4e8fa', 'local-memory-inference-p1b6-reviewed-pool-ledger-v4.json'],
  shortageV4: ['xion-local-memory-inference-p1b6-shortage-receipt-v4', '3970c6f1b29b34c84853194828aa4b1a26674d0b8b1b9c5a73083297ad22a714', 'local-memory-inference-p1b6-shortage-receipt-v4.json'],
  batch003: ['xion-local-memory-inference-p1b6-surface-batch-003-v1', '90b453c3680bccaa537fd0d23db74bbc303882e1a35a2ddcea0b75b013fcaa68', 'local-memory-inference-p1b6-surface-batch-003.json'],
  repairCandidate: ['xion-local-memory-inference-p1b6-surface-repair-candidate-batch-003-v1', '8f6254946eef8d8d0920485bde431ca137a83577a5060889f3676b8857b4aa9b', 'local-memory-inference-p1b6-surface-repair-candidate-batch-003.json'],
  anchorCandidate: ['xion-local-memory-inference-p1b6-surface-anchor-repair-candidate-batch-003-v1', '19eea01def0a05c32c1ceb236fa97305e7b29822c9e56b70cc0331f3a873599f', 'local-memory-inference-p1b6-surface-anchor-repair-candidate-batch-003.json'],
  tb1Candidate: ['xion-local-memory-inference-p1b6-surface-target-boundary-candidate-v1', '5a4253506a9a9885118781c68cdcc407d91b6497b4b1af2105a675332ef8a7f5', 'local-memory-inference-p1b6-surface-target-boundary-candidate.json'],
  rp1Candidate: ['xion-local-memory-inference-p1b6-surface-v3-replacement-candidate-v1', '8c3ff152cfb42abfe4a327e4ba84b833904946c7400332ab5e560980a9af47cc', 'local-memory-inference-p1b6-surface-v3-replacement-candidate.json'],
  batch004: ['xion-local-memory-inference-p1b6-surface-batch-004-v1', 'f640198f9d472c00046b8cb22083407b12887534bf0544cd808620691c5bc0c1', 'local-memory-inference-p1b6-surface-batch-004.json'],
  batch005: ['xion-local-memory-inference-p1b6-surface-batch-005-v1', '98f28dfe844cf07e766c9d0cfb91c00f02c0a79ea6c67e845d70f14f088b2713', 'local-memory-inference-p1b6-surface-batch-005.json'],
});

const HELD = 'FINAL_HELD_OUT';
const slot = (n, id, split, fragments, discoursePattern, allocationRule) => Object.freeze({
  slot: n, semanticSkeletonId: id, splitAssignment: split, authoringTargetLabel: 'CLEAR', language: 'KO', fragments, discoursePattern, allocationRule,
});
const SLOTS = Object.freeze([
  slot('001', 'p1b6-sk-2fa39ece4157b2b8', HELD, 5, 'CANONICAL', 'HELD per-skeleton need'),
  slot('002', 'p1b6-sk-2fa39ece4157b2b8', HELD, 5, 'INTERLEAVED', 'HELD per-skeleton need'),
  slot('003', 'p1b6-sk-2fa39ece4157b2b8', HELD, 4, 'CONTEXT_FIRST', 'buffer on the largest HELD need'),
  slot('004', 'p1b6-sk-869c71279b6b8a33', HELD, 5, 'RETURN_TO_TOPIC', 'HELD per-skeleton need'),
  slot('005', 'p1b6-sk-a19bb9e94e9a416b', HELD, 4, 'PROGRESSIVE_REFINEMENT', 'HELD per-skeleton need'),
  slot('006', 'p1b6-sk-5d2a9c70e4b18f63', 'DEV', 3, 'CONCLUSION_FIRST', 'DEV need: lowest pooled coverage, ties by skeleton ID'),
  slot('007', 'p1b6-sk-61cb1285dd1df651', 'DEV', 2, 'ELLIPTICAL_REPLY', 'DEV buffer: next lowest pooled coverage, ties by skeleton ID'),
]);

// One entry per slot: `ev` selects whole evidence turns by index, `anchor` is [turnIndex, text].
// Every slot targets CLEAR: the visible evidence provides the TARGET's status, and nothing
// states or invites an unresolved alternative. No premise is invented.
const CONTENT = Object.freeze([
  {
    turns: [
      ['USER', '냉동실 맨 아래 칸 얘기 좀 할게.'],
      ['USER', '오늘 아침에 비가 좀 왔어.'],
      ['USER', '그 칸에 들어 있는 건 이번 주말에 전부 꺼내서 버리기로 했어.'],
      ['USER', '우산을 현관에 두고 나왔더라.'],
      ['USER', '자리가 없어서 어제 남은 떡을 그 칸에 넣어 뒀어.'],
      ['USER', '점심은 회사 근처에서 먹었고.'],
      ['USER', '주말 정리는 내가 맡기로 했어.'],
      ['USER', '저녁엔 운동 갈 거야.'],
      ['USER', '떡은 봉지째로 넣어 놨어.'],
    ],
    ev: [0, 2, 4, 6, 8], anchor: [4, '어제 남은 떡'],
  },
  {
    turns: [
      ['USER', '회사 1층 우산꽂이에 있는 우산은 금요일 저녁에 전부 분실물 센터로 보낸대.'],
      ['USER', '점심 메뉴 투표는 또 김치찌개가 이겼어.'],
      ['USER', '총무팀 공지에 그렇게 적혀 있었어.'],
      ['USER', '김치찌개는 이번 주만 세 번째야.'],
      ['USER', '나는 수요일 아침에 내 장우산을 그 우산꽂이에 꽂아 뒀고, 아직 거기 있어.'],
      ['USER', '내일은 국수가 이겼으면 좋겠다.'],
      ['USER', '오늘은 목요일이야.'],
      ['USER', '팀장님은 국수파야.'],
      ['USER', '장우산은 검은색이야.'],
    ],
    ev: [0, 2, 4, 6, 8], anchor: [4, '내 장우산'],
  },
  {
    turns: [
      ['USER', '배경부터 말하면, 우리 동네 도서관 반납함 얘기야.'],
      ['USER', '오늘 회사에서 회의가 길었어.'],
      ['USER', '반납함에 들어 있는 책은 매일 밤 9시에 사서가 꺼내서 반납 처리한대.'],
      ['USER', '회의 끝나고 커피를 두 잔이나 마셨어.'],
      ['USER', '퇴근길에 빌렸던 소설 두 권을 반납함에 넣었어.'],
      ['USER', '커피 때문에 잠이 안 올 것 같아.'],
      ['USER', '넣은 건 저녁 8시쯤이었어.'],
    ],
    ev: [0, 2, 4, 6], anchor: [4, '빌렸던 소설 두 권'],
  },
  {
    turns: [
      ['USER', '회사 노트북이 요즘 30분 동안 손을 안 대면 화면이 자동으로 잠겨.'],
      ['USER', '아 그리고 이번 달 관리비가 좀 올랐더라.'],
      ['USER', '잠기면 비밀번호를 다시 쳐야 해.'],
      ['USER', '관리비는 난방 때문인 것 같아.'],
      ['USER', '다시 노트북 얘기로 돌아가면, 오늘도 회의 다녀오니까 잠겨 있었어.'],
      ['USER', '난방은 좀 줄여야겠다.'],
      ['USER', '설정 화면에도 잠금 시간이 30분으로 나와.'],
      ['USER', '관리비 고지서는 냉장고에 붙여 놨어.'],
      ['USER', '잠금 풀고 바로 메일부터 확인했어.'],
    ],
    ev: [0, 2, 4, 6, 8], anchor: [0, '30분 동안 손을 안 대면 화면이 자동으로 잠겨'],
  },
  {
    turns: [
      ['USER', '우리 아파트 헬스장은 원래 입주민이면 누구나 쓸 수 있었어.'],
      ['USER', '오늘 택배가 두 개 왔어.'],
      ['USER', '그런데 이번 달부터는 관리비를 낸 세대만 쓸 수 있게 바뀌었어.'],
      ['USER', '하나는 신발이고 하나는 책이야.'],
      ['USER', '정확히는 관리비가 한 달이라도 밀린 세대는 못 쓰는 걸로 정리됐대.'],
      ['USER', '신발은 사이즈가 딱 맞아.'],
      ['USER', '우리 옆집은 지난달 관리비가 아직 밀려 있어.'],
    ],
    ev: [0, 2, 4, 6], anchor: [6, '우리 옆집'],
  },
  {
    turns: [
      ['USER', '결론부터 말하면 동창회는 이번 주 토요일이나 일요일 중 하루에 해.'],
      ['USER', '오늘 세탁기를 두 번 돌렸어.'],
      ['USER', '총무가 일요일은 식당 예약이 안 돼서 안 된다고 했어.'],
      ['USER', '빨래가 아직 덜 말랐어.'],
      ['USER', '그래서 그 주말엔 다른 약속을 안 잡고 있어.'],
    ],
    ev: [0, 2, 4], anchor: [0, '동창회'],
  },
  {
    turns: [
      ['USER', '이사할 집 후보로 월세 60만 원짜리 역 앞 원룸을 보고 왔어.'],
      ['USER', '가는 길에 붕어빵을 사 먹었어.'],
      ['ASSISTANT', '거기 말고 다른 곳은 안 봤어?'],
      ['USER', '응, 그래서 다음 주에 더 싼 데를 하나 더 보려고.'],
    ],
    ev: [0, 2, 3], anchor: [3, '더 싼 데'],
  },
]);

function fail(message) {
  throw new TypeError(`P1-B6 batch-006 ${message}`);
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

function buildProtocol(a) {
  const short = a.shortageV4;
  if (short.minimumTopUpLowerBound !== 5 || short.pool.split.DEV.deficit !== 1 || short.heldPerSkeletonNeed !== 4) {
    fail('shortage v4 is not the DEV 1 / HELD 4 shortage this top-up answers');
  }
  const need = new Map(short.heldSkeletons.map(row => [row.semanticSkeletonId, row.needTo5]));
  const skeletons = new Map(a.v3.candidates.map(row => [row.semanticSkeletonId, row]));
  for (const s of SLOTS) {
    const skeleton = skeletons.get(s.semanticSkeletonId);
    if (skeleton?.splitAssignment !== s.splitAssignment || skeleton.humanLabel !== s.authoringTargetLabel) {
      fail(`slot ${s.slot} does not match its v3 skeleton`);
    }
  }
  for (const [id, count] of need) {
    if (count && SLOTS.filter(s => s.semanticSkeletonId === id).length < count) fail(`HELD need on ${id} is not covered`);
  }
  return {
    name: PROTOCOL_IDENTITY,
    status: 'PREREGISTERED',
    decisionsSource: 'REPOSITORY_OWNER_APPROVED_TOP_UP_PARAMETERS',
    inputs: Object.fromEntries(['v3', 'ledgerV4', 'shortageV4'].map(key => [key, { identity: SOURCES[key][0], rawSha256: SOURCES[key][1] }])),
    tranche: { total: 7, lowerBound: 5, buffer: 2, split: { TRAIN: 0, DEV: 2, FINAL_HELD_OUT: 5 }, language: { KO: 7 }, fragments: { 2: 1, 3: 1, 4: 2, 5: 3 } },
    slots: SLOTS,
    authoringRules: [
      'Fresh content under the b006 namespace; no reuse of any prior text, ID or review result.',
      'The batch-003 leakage check runs fail-closed against every prior batch and candidate artifact, including batch-004 and batch-005.',
      'Authoring target labels are generator targets, not HUMAN gold, and never enter a blind packet.',
      'HELD slots are authored by the assistant and are never shown to the owner.',
    ],
    gates: {
      held: {
        order: ['fresh source/bundle audit (FAIL / UNCERTAIN excluded)', 'blind v3 strong-model semantic review'],
        routing: 'clean agreement → CATALOG_STRONG_MODEL_CONFIRMED / PROVISIONAL (the post-selection independent second strong-model review still applies); anything else → INELIGIBLE; no owner pre-audit and no HUMAN review because repeated HELD review stays unopened',
      },
      dev: {
        order: ['owner pre-audit authoring review', 'fresh source/bundle audit (FAIL / UNCERTAIN excluded)',
          'blind v3 strong-model semantic review', 'mandatory HUMAN for disagreement / FIX / REJECT / missing',
          'HUMAN calibration of every clean agreement'],
        mandatoryMatchingKeepSemantics: 'HUMAN_ADJUDICATED / ELIGIBLE',
        calibrationMatchingKeepSemantics: 'stays CATALOG_STRONG_MODEL_CONFIRMED / PROVISIONAL; not promoted',
      },
    },
    authority: {
      sourceAuditRun: false, semanticReviewRun: false, humanReviewRun: false,
      acceptancePerformed: false, finalSelectionPerformed: false, trainingOrEvaluationOccurred: false,
    },
  };
}

function spanFor(turn, selector) {
  const haystack = Buffer.from(turn.text, 'utf8');
  if (selector === undefined) return { turnId: turn.turnId, startByte: 0, endByte: haystack.length };
  const needle = Buffer.from(selector, 'utf8');
  const startByte = haystack.indexOf(needle);
  if (startByte < 0 || haystack.indexOf(needle, startByte + 1) >= 0) fail(`text is missing or not unique in ${turn.turnId}: ${selector}`);
  return { turnId: turn.turnId, startByte, endByte: startByte + needle.length };
}

function buildBatch(a, content = CONTENT) {
  if (content.length !== SLOTS.length) fail(`authored content must hold exactly ${SLOTS.length} episodes`);
  const rows = SLOTS.map((slot, index) => {
    const entry = content[index];
    const turns = entry.turns.map(([role, text], n) => ({ turnId: `t${n + 1}`, role, text }));
    const turnAt = n => turns[n] ?? fail(`turn ${n} is missing in slot ${slot.slot}`);
    const episode = {
      sourceEpisodeId: `p1b6-se-b006-${slot.slot}`,
      sourceFamilyId: `p1b6-sf-b006-${slot.slot}`,
      splitAssignment: slot.splitAssignment,
      language: slot.language,
      turns,
    };
    const item = {
      itemId: `p1b6-item-b006-${slot.slot}`,
      sourceEpisodeId: episode.sourceEpisodeId,
      semanticSkeletonId: slot.semanticSkeletonId,
      anchorSpanRef: spanFor(turnAt(entry.anchor[0]), entry.anchor[1]),
      evidenceSpanRefs: entry.ev.map(n => spanFor(turnAt(n))),
      discoursePattern: slot.discoursePattern,
      surfaceFamilyId: `p1b6-surface-family-b006-${slot.slot}`,
    };
    const fragments = computeFragments(item, episode).length;
    if (fragments !== slot.fragments) fail(`slot ${slot.slot} yields ${fragments} fragments, spec wants ${slot.fragments}`);
    return { episode, item };
  });
  const batch = { name: BATCH_IDENTITY, batchId: 'p1b6-surface-batch-006', sourceEpisodes: rows.map(row => row.episode), items: rows.map(row => row.item) };
  validateSurfaceBatch(batch, { exact56: a.v3 });
  plan003.validateBatch003Leakage(batch, [
    ...plan003.loadPriorSources(),
    ...['batch003', 'repairCandidate', 'anchorCandidate', 'tb1Candidate', 'rp1Candidate', 'batch004', 'batch005']
      .flatMap(key => a[key].sourceEpisodes.map(episode => ({ origin: a[key].name, id: episode.sourceEpisodeId, turns: episode.turns }))),
  ]);
  return batch;
}

const artifactBytes = value => Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');

function buildAll(rawSources = loadSources(), content = CONTENT) {
  const a = verifySources(rawSources);
  return { protocol: buildProtocol(a), batch: buildBatch(a, content) };
}

function main() {
  const { protocol, batch } = buildAll();
  for (const [file, value] of [[PROTOCOL_FILE, protocol], [BATCH_FILE, batch]]) {
    fs.writeFileSync(path.join(ROOT, 'fixtures', file), artifactBytes(value));
    process.stdout.write(`Wrote fixtures/${file}\n`);
  }
  return 0;
}

module.exports = { BATCH_FILE, CONTENT, PROTOCOL_FILE, SLOTS, SOURCES, artifactBytes, buildAll, loadSources, main, verifySources };

if (require.main === module) process.exit(main());
