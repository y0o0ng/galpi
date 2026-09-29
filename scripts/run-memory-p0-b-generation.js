#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const OpenAI = require('openai');
const dotenv = require('dotenv');
const { extractResponseText } = require('../lib/openai-model-catalog');

const ROOT = path.resolve(__dirname, '..');
const INPUT_MANIFEST_SHA256 = 'c03332b19dc5158e9e866033b689f6538ec554719b168fea1aa0405090ee3455';
const PRIVATE_BUNDLE_SHA256 = '08441a3c683b69e09a4bea91e82bee2deee235c613e2b95d456061996661db54';
const ANSWER_STACK_SHA256 = 'c092d529cbcf41636cb45aa00e964056037db44cd9ca6f9f8764dc3b8b5af201';
const byteHash = value => crypto.createHash('sha256').update(value).digest('hex');
const canonical = value => `${JSON.stringify(value, null, 2)}\n`;

function validateInputs(manifestBytes, bundleBytes, expected = {
  manifestSha256: INPUT_MANIFEST_SHA256,
  bundleSha256: PRIVATE_BUNDLE_SHA256,
  stackSha256: ANSWER_STACK_SHA256,
}) {
  if (byteHash(manifestBytes) !== expected.manifestSha256
    || byteHash(bundleBytes) !== expected.bundleSha256) throw new Error('frozen input SHA 불일치');
  const manifest = JSON.parse(manifestBytes);
  const bundle = JSON.parse(bundleBytes);
  if (manifest.schemaVersion !== 1 || bundle.schemaVersion !== 1
    || manifest.answerStackSha256 !== expected.stackSha256
    || bundle.answerStackSha256 !== expected.stackSha256
    || manifest.privateBundleSha256 !== expected.bundleSha256
    || manifest.scheduleContextPolicy !== 'OMITTED_IDENTICALLY_FOR_ALL_P0B_CASES'
    || manifest.counts?.GENERATION_READY !== 66
    || manifest.counts?.INDETERMINATE_TOOL_REPLAY !== 13
    || manifest.cases?.length !== 79 || bundle.cases?.length !== 66) {
    throw new Error('frozen input schema/count/stack 불일치');
  }
  const ready = new Map(manifest.cases.filter(item => item.disposition === 'GENERATION_READY')
    .map(item => [item.traceId, item]));
  const seenTrace = new Set();
  const seenMessage = new Set();
  for (const item of bundle.cases) {
    const frozen = ready.get(item.traceId);
    if (!frozen || frozen.messageId !== item.messageId
      || seenTrace.has(item.traceId) || seenMessage.has(item.messageId)
      || byteHash(canonical(item)) !== frozen.privateCaseSha256
      || item.answerStackSha256 !== expected.stackSha256
      || item.shared?.schedule !== ''
      || item.hardRequest?.model !== 'gpt-6-luna'
      || item.globalRequest?.model !== 'gpt-6-luna') {
      throw new Error('frozen private case identity/hash 불일치');
    }
    seenTrace.add(item.traceId);
    seenMessage.add(item.messageId);
    for (const request of [item.hardRequest, item.globalRequest]) {
      if (request.store !== false || request.max_output_tokens !== 8192
        || request.reasoning?.effort !== 'medium'
        || request.reasoning?.context !== 'current_turn'
        || typeof request.instructions !== 'string'
        || !Array.isArray(request.input) || 'tools' in request || 'stream' in request) {
        throw new Error('frozen request config 불일치');
      }
    }
  }
  if (ready.size !== 66 || seenTrace.size !== 66 || seenMessage.size !== 66) {
    throw new Error('66-case frozen universe 불일치');
  }
  return { manifest, bundle };
}

function makePlan(bundle) {
  const seed = `${INPUT_MANIFEST_SHA256}:${PRIVATE_BUNDLE_SHA256}`;
  const slots = bundle.cases.flatMap(item => ['H', 'G'].flatMap(arm => [1, 2].map(replicate => ({
    slotId: `${item.traceId}:${arm}:${replicate}`,
    traceId: item.traceId, messageId: item.messageId, arm, replicate,
    requestSha256: byteHash(canonical(arm === 'H' ? item.hardRequest : item.globalRequest)),
  }))));
  slots.sort((a, b) => {
    const left = byteHash(`${seed}:${a.slotId}`);
    const right = byteHash(`${seed}:${b.slotId}`);
    return left < right ? -1 : left > right ? 1 : 0;
  });
  if (slots.length !== 264 || new Set(slots.map(item => item.slotId)).size !== 264) {
    throw new Error('264-slot plan 불변식 실패');
  }
  return { schemaVersion: 1, inputManifestSha256: INPUT_MANIFEST_SHA256,
    privateBundleSha256: PRIVATE_BUNDLE_SHA256, slots };
}

function durableCreate(filename, bytes) {
  const fd = fs.openSync(filename, 'wx', 0o600);
  try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  const dir = fs.openSync(path.dirname(filename), 'r');
  try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); }
}

function durableCreateOrVerify(filename, bytes) {
  if (fs.existsSync(filename)) {
    if (!fs.readFileSync(filename).equals(Buffer.from(bytes))) throw new Error('frozen output bytes 불일치');
  } else durableCreate(filename, bytes);
}

function appendJournal(filename, record) {
  const fd = fs.openSync(filename, 'a', 0o600);
  try { fs.writeFileSync(fd, `${JSON.stringify(record)}\n`); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}

function readJournal(filename, plan) {
  const slots = new Set(plan.slots.map(item => item.slotId));
  const states = new Map();
  const records = [];
  const content = fs.readFileSync(filename, 'utf8');
  if (content && !content.endsWith('\n')) throw new Error('journal partial trailing record');
  for (const line of content.split('\n').filter(Boolean)) {
    const record = JSON.parse(line);
    const prior = states.get(record.slotId);
    if (!slots.has(record.slotId)
      || (record.event === 'DISPATCHING' && prior)
      || (record.event !== 'DISPATCHING' && (prior !== 'DISPATCHING'
        || !['SUCCESS', 'FAILURE', 'AMBIGUOUS_AFTER_DISPATCH'].includes(record.event)))) {
      throw new Error('journal state transition 불일치');
    }
    states.set(record.slotId, record.event);
    records.push(record);
  }
  return { states, records };
}

function prepare(outputDir, bundle) {
  const relative = path.relative(ROOT, outputDir);
  if (!relative.startsWith(`..${path.sep}`) && relative !== '..') {
    throw new Error('raw output directory는 repository 밖이어야 합니다.');
  }
  fs.mkdirSync(outputDir, { recursive: true, mode: 0o700 });
  if ((fs.statSync(outputDir).mode & 0o077) !== 0) throw new Error('private directory mode는 0700이어야 합니다.');
  const files = Object.fromEntries(['plan', 'mapping', 'journal', 'results', 'packet', 'manifest']
    .map(name => [name, path.join(outputDir, `galpi-p0b-generation-${name}.${name === 'journal' ? 'jsonl' : 'json'}`)]));
  const plan = makePlan(bundle);
  const planBytes = canonical(plan);
  if (fs.existsSync(files.plan)) {
    if (!fs.readFileSync(files.plan).equals(Buffer.from(planBytes))) throw new Error('preplanned call order 불일치');
  } else durableCreate(files.plan, planBytes);
  if (!fs.existsSync(files.mapping)) {
    if (fs.existsSync(files.journal) && fs.statSync(files.journal).size > 0) {
      throw new Error('journal은 있는데 blind mapping이 없습니다.');
    }
    const random = crypto.randomBytes(bundle.cases.length);
    const mapping = { schemaVersion: 1, planSha256: byteHash(planBytes),
      cases: bundle.cases.map((item, i) => ({ traceId: item.traceId,
        xArm: random[i] & 1 ? 'H' : 'G' })) };
    durableCreate(files.mapping, canonical(mapping));
  }
  const mapping = JSON.parse(fs.readFileSync(files.mapping));
  if (mapping.planSha256 !== byteHash(planBytes) || mapping.cases?.length !== 66
    || new Set(mapping.cases.map(item => item.traceId)).size !== 66
    || mapping.cases.some((item, i) => item.traceId !== bundle.cases[i].traceId)
    || mapping.cases.some(item => !['H', 'G'].includes(item.xArm))) {
    throw new Error('blind mapping 불일치');
  }
  if (!fs.existsSync(files.journal)) durableCreate(files.journal, '');
  return { files, plan, planSha256: byteHash(planBytes), mapping,
    mappingSha256: byteHash(fs.readFileSync(files.mapping)) };
}

function failure(error, code = null) {
  return { errorClass: String(error?.constructor?.name || 'Error').slice(0, 80),
    errorCode: code || String(error?.code || 'UNKNOWN').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80),
    httpStatus: Number.isInteger(error?.status) ? error.status : null };
}

async function execute({ bundle, prepared, client, onProgress = () => {} }) {
  const { files, plan } = prepared;
  const byTrace = new Map(bundle.cases.map(item => [item.traceId, item]));
  let journal = readJournal(files.journal, plan);
  for (const [slotId, state] of journal.states) {
    if (state === 'DISPATCHING') appendJournal(files.journal, { slotId, event: 'AMBIGUOUS_AFTER_DISPATCH' });
  }
  journal = readJournal(files.journal, plan);
  for (const slot of plan.slots) {
    if (journal.states.has(slot.slotId)) continue;
    const item = byTrace.get(slot.traceId);
    const request = slot.arm === 'H' ? item.hardRequest : item.globalRequest;
    if (byteHash(canonical(request)) !== slot.requestSha256) throw new Error('planned request SHA 불일치');
    appendJournal(files.journal, { slotId: slot.slotId, event: 'DISPATCHING' });
    try {
      const response = await client.responses.create(request, { maxRetries: 0 });
      const responseText = extractResponseText(response);
      if (response?.status !== 'completed' || !responseText) {
        appendJournal(files.journal, { slotId: slot.slotId, event: 'FAILURE',
          ...failure(null, response?.status !== 'completed' ? 'NON_COMPLETED_RESPONSE' : 'EMPTY_FINAL_TEXT'),
          responseModel: response?.model || null, providerRequestId: response?._request_id || response?.id || null });
      } else {
        appendJournal(files.journal, { slotId: slot.slotId, event: 'SUCCESS',
          traceId: slot.traceId, messageId: slot.messageId, arm: slot.arm,
          replicate: slot.replicate, requestSha256: slot.requestSha256,
          responseText, responseTextSha256: byteHash(responseText),
          responseModel: response.model || null,
          providerRequestId: response._request_id || response.id || null,
          usage: response.usage || null });
      }
    } catch (error) {
      appendJournal(files.journal, { slotId: slot.slotId, event: 'FAILURE', ...failure(error) });
    }
    onProgress(readJournal(files.journal, plan).states.size);
  }
  return readJournal(files.journal, plan);
}

function finalize({ bundle, prepared, journal, codeCommit }) {
  const { files, plan, planSha256, mapping, mappingSha256 } = prepared;
  if (journal.states.size !== 264 || [...journal.states.values()].some(state => state === 'DISPATCHING')) {
    throw new Error('264-slot journal이 완료되지 않았습니다.');
  }
  const outcomes = new Map(journal.records.filter(item => item.event !== 'DISPATCHING')
    .map(item => [item.slotId, item]));
  const results = { schemaVersion: 1, planSha256,
    slots: plan.slots.map(slot => ({ ...slot, ...outcomes.get(slot.slotId) })) };
  const resultBytes = canonical(results);
  durableCreateOrVerify(files.results, resultBytes);
  const byTrace = new Map(bundle.cases.map(item => [item.traceId, item]));
  const rubric = {
    material: ['factual claim or remembered state', 'recommendation, selected option, ranking or priority',
      'assert versus hedge versus unresolved versus clarification-needed', 'planned action or intervention',
      'rationale that materially changes downstream judgment or action'],
    notMaterial: ['wording, style or tone', 'formatting or verbosity', 'semantically equivalent paraphrase',
      'harmless elaboration', 'same conclusion explained longer', 'memory-independent peripheral difference'],
    instruction: 'Judge answer materiality and within-group stability, not which answer is better or correct.',
  };
  const packetCases = [];
  const completeTraces = new Set();
  let generationFailureCases = 0;
  for (const [index, assignment] of mapping.cases.entries()) {
    const item = byTrace.get(assignment.traceId);
    const response = (arm, replicate) => outcomes.get(`${item.traceId}:${arm}:${replicate}`);
    if (['H', 'G'].some(arm => [1, 2].some(rep => response(arm, rep)?.event !== 'SUCCESS'))) {
      generationFailureCases += 1;
      continue;
    }
    const yArm = assignment.xArm === 'H' ? 'G' : 'H';
    completeTraces.add(item.traceId);
    packetCases.push({ blindCaseNumber: index + 1, originalRequest: item.target,
      historicalRequestTime: item.historicalRequestTime,
      boundedConversationHistory: item.shared.history,
      groupX: [response(assignment.xArm, 1).responseText, response(assignment.xArm, 2).responseText],
      groupY: [response(yArm, 1).responseText, response(yArm, 2).responseText],
      decision: { withinXStable: null, withinYStable: null,
        crossArmMateriality: null, finalLabel: null, reason: null } });
  }
  const packetBytes = canonical({ schemaVersion: 1, rubric, cases: packetCases });
  durableCreateOrVerify(files.packet, packetBytes);
  const statuses = Object.fromEntries(['SUCCESS', 'FAILURE', 'AMBIGUOUS_AFTER_DISPATCH']
    .map(name => [name, [...outcomes.values()].filter(item => item.event === name).length]));
  const manifest = { schemaVersion: 1, inputManifestSha256: INPUT_MANIFEST_SHA256,
    privateBundleSha256: PRIVATE_BUNDLE_SHA256, answerStackSha256: ANSWER_STACK_SHA256,
    generationCodeCommit: codeCommit, model: 'gpt-6-luna',
    reasoning: { effort: 'medium', context: 'current_turn' },
    maxOutputTokens: 8192, store: false, toolsAbsent: true, maxRetries: 0,
    plannedSlots: 264, attemptedSlots: statuses.SUCCESS + statuses.FAILURE + statuses.AMBIGUOUS_AFTER_DISPATCH,
    successfulSlots: statuses.SUCCESS, failedSlots: statuses.FAILURE,
    ambiguousSlots: statuses.AMBIGUOUS_AFTER_DISPATCH,
    generationCompleteCases: packetCases.length, generationFailureCases,
    preexistingToolIndeterminate: 13, planSha256,
    privateRawResultSha256: byteHash(resultBytes), blindMappingSha256: mappingSha256,
    blindPacketSha256: byteHash(packetBytes), externalApiCalls: journal.records
      .filter(item => item.event === 'DISPATCHING').length,
    productionMutations: 0, humanAdjudications: 0,
    cases: bundle.cases.map(item => ({ traceId: item.traceId, messageId: item.messageId,
      generationStatus: completeTraces.has(item.traceId)
        ? 'FOUR_RESPONSES_COMPLETE' : 'INDETERMINATE_GENERATION_FAILURE' })),
  };
  const manifestBytes = canonical(manifest);
  durableCreateOrVerify(files.manifest, manifestBytes);
  return { manifest, manifestBytes, resultBytes, packetBytes };
}

async function main(argv = process.argv.slice(2)) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!['--bundle', '--manifest', '--output-dir', '--code-commit'].includes(argv[i]) || !argv[i + 1]) {
      throw new Error('usage: --bundle PATH --manifest PATH --output-dir PATH --code-commit SHA');
    }
    args[argv[i]] = argv[i + 1];
  }
  if (!/^[0-9a-f]{40}$/.test(args['--code-commit'] || '')) throw new Error('generation code commit이 필요합니다.');
  const manifestBytes = fs.readFileSync(args['--manifest']);
  const bundleBytes = fs.readFileSync(args['--bundle']);
  const { bundle } = validateInputs(manifestBytes, bundleBytes);
  if ((fs.statSync(args['--bundle']).mode & 0o077) !== 0) throw new Error('private bundle mode는 0600이어야 합니다.');
  const env = { ...dotenv.parse(fs.readFileSync(path.join(ROOT, '.env'))), ...process.env };
  if (String(env.OPENAI_BASE_URL || '').trim()) throw new Error('custom OPENAI_BASE_URL은 승인 범위 밖입니다.');
  if (!env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY가 없습니다.');
  const prepared = prepare(path.resolve(args['--output-dir']), bundle);
  const lock = path.join(args['--output-dir'], 'galpi-p0b-generation.lock');
  const lockFd = fs.openSync(lock, 'wx', 0o600);
  try {
    const client = new OpenAI({ apiKey: env.OPENAI_API_KEY, maxRetries: 0 });
    const journal = await execute({ bundle, prepared, client,
      onProgress: count => { if (count % 20 === 0 || count === 264) process.stdout.write(`slots recorded: ${count}/264\n`); } });
    const result = finalize({ bundle, prepared, journal, codeCommit: args['--code-commit'] });
    process.stdout.write(`${JSON.stringify({ plannedSlots: result.manifest.plannedSlots,
      successfulSlots: result.manifest.successfulSlots, failedSlots: result.manifest.failedSlots,
      ambiguousSlots: result.manifest.ambiguousSlots,
      generationCompleteCases: result.manifest.generationCompleteCases,
      generationFailureCases: result.manifest.generationFailureCases,
      privateRawResultSha256: result.manifest.privateRawResultSha256,
      blindMappingSha256: result.manifest.blindMappingSha256,
      blindPacketSha256: result.manifest.blindPacketSha256 })}\n`);
  } finally {
    fs.closeSync(lockFd);
    fs.unlinkSync(lock);
  }
}

module.exports = { validateInputs, makePlan, durableCreate, readJournal, prepare,
  execute, finalize, main };
if (require.main === module) main().catch(error => {
  console.error(`P0-B generation stopped: ${error.message}`);
  process.exitCode = 1;
});
