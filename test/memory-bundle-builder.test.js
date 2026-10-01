'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const { createHash } = require('node:crypto');
const builder = require('../lib/memory-storage/bundle-builder');
const { computeFragments, decodeSpan } = require('../lib/memory-inference-p1b6-surfaces');
const { createOpenAIBundleSelector, main: buildMain } = require('../lib/memory-storage/bundle-openai');

const episode = () => ({ schemaVersion: 1, sourceDomain: 'conversation_message', sessionId: 's',
  firstMessageId: 1, lastMessageId: 4, turns: [
    { turnId: 'm1', messageId: 1, role: 'USER', text: '커피는 평일 한 잔이야.\n주말은 아직 못 정했어.', createdAt: 100 },
    { turnId: 'm2', messageId: 2, role: 'ASSISTANT', text: '주말도 한 잔으로 할까요?', createdAt: 100 },
    { turnId: 'm3', messageId: 3, role: 'USER', text: '독서 계획은 아직 고민 중이야.', createdAt: 101 },
    { turnId: 'm4', messageId: 4, role: 'USER', text: '아니, 주말 커피는 미정으로 둘래.', createdAt: 102 },
  ] });
const selection = () => ({ bundles: [{ anchor: { turnId: 'm1', text: '커피' }, evidenceTurnIds: ['m1', 'm2', 'm4'] }] });
const hash = filename => createHash('sha256').update(fs.readFileSync(filename)).digest('hex');

function sourceFixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'galpi-bundle-test-'));
  fs.chmodSync(dir, 0o700);
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const filename = path.join(dir, 'source.db');
  const db = new Database(filename);
  db.exec('CREATE TABLE messages (id INTEGER PRIMARY KEY, session_id TEXT, role TEXT, content TEXT, created_at INTEGER)');
  const insert = db.prepare('INSERT INTO messages VALUES (?, ?, ?, ?, ?)');
  for (const turn of episode().turns) insert.run(turn.messageId, 's', turn.role.toLowerCase(), turn.text, turn.createdAt);
  insert.run(5, 'other', 'user', 'OTHER SESSION SENTINEL', 101);
  insert.run(6, 's', 'assistant', 'FUTURE SENTINEL', 103);
  db.close();
  const readonly = new Database(filename, { readonly: true, fileMustExist: true });
  readonly.pragma('query_only=ON');
  t.after(() => readonly.close());
  return { dir, filename, db: readonly };
}

test('explicit source range preserves chronology, same-second IDs, roles and raw multiline text; no future/cross-session injection', t => {
  const { db, filename } = sourceFixture(t);
  const before = hash(filename);
  assert.deepEqual(builder.readConversationEpisode(db, { sessionId: 's', firstMessageId: 1, lastMessageId: 4 }), episode());
  const single = builder.readConversationEpisode(db, { sessionId: 's', firstMessageId: 2, lastMessageId: 2 });
  assert.deepEqual(single.turns, [episode().turns[1]]);
  assert.equal(db.prepare('SELECT total_changes() AS n').get().n, 0);
  assert.equal(hash(filename), before);
  assert.equal(db.readonly, true);
  assert.equal(db.pragma('query_only', { simple: true }), 1);
});

test('source read fails closed for a writable connection, missing endpoints, wrong session and reversed range', t => {
  const { db, filename } = sourceFixture(t);
  for (const range of [
    { sessionId: 's', firstMessageId: 1, lastMessageId: 999 },
    { sessionId: 's', firstMessageId: 5, lastMessageId: 6 },
    { sessionId: 's', firstMessageId: 4, lastMessageId: 1 },
    { sessionId: '', firstMessageId: 1, lastMessageId: 4 },
    { sessionId: 's', firstMessageId: 0, lastMessageId: 4 },
  ]) assert.throws(() => builder.readConversationEpisode(db, range), { code: 'INVALID_SOURCE_RANGE' });
  const writable = new Database(filename);
  try {
    assert.throws(() => builder.readConversationEpisode(writable, { sessionId: 's', firstMessageId: 1, lastMessageId: 4 }),
      { code: 'READONLY_SOURCE_REQUIRED' });
    db.pragma('query_only=OFF');
    assert.throws(() => builder.readConversationEpisode(db, { sessionId: 's', firstMessageId: 1, lastMessageId: 4 }),
      { code: 'READONLY_SOURCE_REQUIRED' });
  } finally { writable.close(); }
});

test('episode validation rejects invented metadata, unsupported roles, duplicate IDs and broken chronology/Unicode', () => {
  const mutations = [
    e => { e.semanticFamily = 'general_fact'; }, e => { e.schemaVersion = 2; },
    e => { e.turns[0].role = 'SYSTEM'; }, e => { e.turns[1].messageId = 1; e.turns[1].turnId = 'm1'; },
    e => { e.turns.reverse(); }, e => { e.turns[0].text = '\ud800'; },
    e => { e.turns[0].createdAt = 100.5; }, e => { e.turns[0].text = ' '; },
    e => { e.firstMessageId = 2; }, e => { e.turns[0].turnId = 'invented'; },
  ];
  for (const mutate of mutations) { const e = episode(); mutate(e); assert.throws(() => builder.validateEpisode(e), { code: 'INVALID_SOURCE_EPISODE' }); }
  const e = episode(); e.turns[0].text = '[TARGET]fake[/TARGET]';
  assert.throws(() => builder.validateEpisode(e), { code: 'SOURCE_CONTAINS_TARGET_MARKER' });
});

test('one source-grounded representative marker; whole-message evidence preserves correction and disjoint fragments', () => {
  const e = episode();
  const result = builder.buildEvidenceBundles(e, selection());
  const bundle = result.bundles[0];
  assert.equal(decodeSpan(e.turns[0].text, bundle.anchorSpanRef), '커피');
  assert.equal(bundle.fragmentCount, 2);
  assert.equal(bundle.fragmentCount, computeFragments(bundle, e).length);
  assert.equal(bundle.selectedBundle, 'USER: [TARGET]커피[/TARGET]는 평일 한 잔이야.\n주말은 아직 못 정했어.\nASSISTANT: 주말도 한 잔으로 할까요?\n---\nUSER: 아니, 주말 커피는 미정으로 둘래.');
  assert.equal(result.semanticCompleteness, 'NOT_VALIDATED');
  assert.equal(bundle.selectedBundle.split('[TARGET]').length - 1, 1);
  assert.ok(!bundle.selectedBundle.includes('독서'));
});

test('Korean/emoji anchor byte offsets and out-of-order selected turns canonicalize without summarizing', () => {
  const e = episode(); e.turns[0].text = '🙂 오늘 커피 이야기';
  const a = selection(); a.bundles[0].evidenceTurnIds = ['m4', 'm2', 'm1'];
  const result = builder.buildEvidenceBundles(e, a);
  assert.equal(result.bundles[0].anchorSpanRef.startByte, Buffer.byteLength('🙂 오늘 '));
  assert.deepEqual(result, builder.buildEvidenceBundles(e, selection()));
});

test('0..N discovery permits overlapping evidence for independent topics; no NO_WRITE/extraction/classification output', () => {
  assert.deepEqual(builder.buildEvidenceBundles(episode(), { bundles: [] }).bundles, []);
  const s = selection(); s.bundles.push({ anchor: { turnId: 'm3', text: '독서 계획' }, evidenceTurnIds: ['m2', 'm3'] });
  const result = builder.buildEvidenceBundles(episode(), s);
  assert.equal(result.bundles.length, 2);
  assert.notEqual(result.bundles[0].bundleId, result.bundles[1].bundleId);
  assert.equal(result.bundles[1].fragmentCount, 1);
  for (const mutate of [
    s => { s.bundles[0].value = 'one'; }, s => { s.bundles[0].write = true; },
    s => { s.bundles[0].semanticFamily = 'general_fact'; }, s => { s.clear = true; },
  ]) { const s = selection(); mutate(s); assert.throws(() => builder.buildEvidenceBundles(episode(), s), { code: 'INVALID_BUNDLE_SELECTION' }); }
});

test('invented/omitted anchors, nonexistent or duplicate evidence and exact duplicate bundles fail closed', () => {
  for (const mutate of [
    s => { s.bundles[0].anchor.text = 'not in source'; },
    s => { s.bundles[0].anchor.turnId = 'missing'; },
    s => { s.bundles[0].evidenceTurnIds = ['m2']; },
    s => { s.bundles[0].evidenceTurnIds.push('future'); },
    s => { s.bundles[0].evidenceTurnIds.push('m1'); },
    s => { s.bundles[0].evidenceTurnIds = []; },
  ]) { const s = selection(); mutate(s); assert.throws(() => builder.buildEvidenceBundles(episode(), s)); }
  const repeated = episode(); repeated.turns[0].text = '커피 그리고 커피';
  assert.throws(() => builder.buildEvidenceBundles(repeated, selection()), { code: 'ANCHOR_NOT_UNIQUE_IN_SOURCE' });
  const duplicate = selection(); duplicate.bundles.push(structuredClone(duplicate.bundles[0]));
  assert.throws(() => builder.buildEvidenceBundles(episode(), duplicate), { code: 'DUPLICATE_BUNDLE_SELECTION' });
});

test('request preserves full episode/role attribution and separates bundle discovery from semantic downstream judgments', () => {
  const request = builder.buildBundleSelectionRequest(episode());
  assert.deepEqual(JSON.parse(request.input), episode());
  assert.match(request.instructions, /같은 주제·같은 문장이어도 독립적으로 판정하고 저장할 대상이면 별도 앵커와 별도 bundle로 나눈다/);
  assert.match(request.instructions, /근거 누락을 의미적 모호성으로 정당화하지 않는다/);
  assert.match(request.instructions, /ASSISTANT 발언은 귀속된 발언/);
  assert.ok(Object.isFrozen(request));
});

test('user-centered discovery excludes acquaintance claims as targets, preserves relation/evidence scope and one-candidate focus', () => {
  const e = episode();
  e.turns[0].text = '민지는 이른 회의에서 집중이 잘된대. 나는 조용한 건 좋아.';
  e.turns[2].text = '민지는 내 동료야.';
  const request = builder.buildBundleSelectionRequest(e);
  assert.equal(request.promptVersion, 'memory-evidence-bundle-selection-user-state-v1');
  assert.deepEqual(JSON.parse(request.input), e);
  assert.match(request.instructions, /지인의 발언·상태 자체를 저장 대상으로 삼는 bundle은 만들지 않는다/);
  assert.match(request.instructions, /근거\/맥락으로 보존한다/);
  assert.match(request.instructions, /사용자와 지인의 관계 자체는 제외하지 않는다/);
  assert.match(request.instructions, /사용자의 동의·채택·선호가 결정됐다고 보지 않는다/);
  assert.match(request.instructions, /각 bundle은 후속 단계에서 한 저장 후보의 판정 단위/);
  assert.match(request.instructions, /앵커 = 판정대상 = 저장대상/);
  assert.match(request.instructions, /후속 Extractor는 대상의 표현 형식을 바꿀 뿐 다른 대상을 추출하지 않는다/);
  assert.ok(!request.instructions.includes('경계가 불확실하면 합친다'));
  // Prompt-contract regression only; no synthetic model result proves semantic compliance.
});

test('superseded discovery request fails before provider dispatch', async () => {
  let calls = 0;
  const selector = createOpenAIBundleSelector({ apiKey: 'synthetic-test-key', fetch: async () => { calls++; } });
  for (const promptVersion of ['memory-evidence-bundle-selection-v1', 'memory-evidence-bundle-selection-user-centered-v1']) {
    await assert.rejects(selector({ ...builder.buildBundleSelectionRequest(episode()), promptVersion }), { code: 'INVALID_BUNDLE_REQUEST' });
  }
  assert.equal(calls, 0);
});

test('independent targets in the same source message share evidence but remain separate single-anchor bundles', () => {
  const e = episode();
  e.turns[0].text = '집 알아보려고. 월세는 고민 중이야.';
  e.turns[1].text = '아직 계약 방식은 정하지 않았구나.';
  const result = builder.buildEvidenceBundles(e, { bundles: [
    { anchor: { turnId: 'm1', text: '집 알아보려고' }, evidenceTurnIds: ['m1', 'm2'] },
    { anchor: { turnId: 'm1', text: '월세는 고민 중이야' }, evidenceTurnIds: ['m1', 'm2'] },
  ] });
  const [search, lease] = result.bundles;
  assert.notEqual(search.bundleId, lease.bundleId);
  assert.deepEqual(search.evidenceSpanRefs, lease.evidenceSpanRefs);
  assert.equal(search.selectedBundle, 'USER: [TARGET]집 알아보려고[/TARGET]. 월세는 고민 중이야.\nASSISTANT: 아직 계약 방식은 정하지 않았구나.');
  assert.equal(lease.selectedBundle, 'USER: 집 알아보려고. [TARGET]월세는 고민 중이야[/TARGET].\nASSISTANT: 아직 계약 방식은 정하지 않았구나.');
  for (const item of result.bundles) assert.equal(item.selectedBundle.split('[TARGET]').length - 1, 1);
  assert.equal(result.semanticCompleteness, 'NOT_VALIDATED');
});

test('selector invoked once with frozen input; no source mutation or silent retry after failure/malformed output', async () => {
  const e = episode(); const before = structuredClone(e); let calls = 0;
  const result = await builder.discoverEvidenceBundles(e, async request => {
    calls++; assert.deepEqual(JSON.parse(request.input), e); return JSON.stringify(selection());
  });
  assert.equal(calls, 1); assert.deepEqual(e, before);
  assert.deepEqual(result, builder.buildEvidenceBundles(e, selection()));
  for (const callback of [() => { throw new Error('PRIVATE PROVIDER SENTINEL'); }, () => '```json\n{}\n```']) {
    let calls = 0;
    await assert.rejects(builder.discoverEvidenceBundles(e, () => { calls++; return callback(); }));
    assert.equal(calls, 1);
  }
  await assert.rejects(builder.discoverEvidenceBundles(e), { code: 'BUNDLE_SELECTOR_REQUIRED' });
});

test('repeated results and private freeze bytes are deterministic; exclusive 0600 creation outside repo', t => {
  const { dir } = sourceFixture(t);
  const result = builder.buildEvidenceBundles(episode(), selection());
  const one = path.join(dir, 'one.json'); const two = path.join(dir, 'two.json');
  assert.equal(builder.writePrivateArtifact(one, result), builder.writePrivateArtifact(two, result));
  assert.deepEqual(fs.readFileSync(one), fs.readFileSync(two));
  assert.equal(fs.statSync(one).mode & 0o777, 0o600);
  assert.throws(() => builder.writePrivateArtifact(one, {}), { code: 'EEXIST' });
  assert.throws(() => builder.writePrivateArtifact(path.resolve(__dirname, '../must-not-exist.json'), result),
    { code: 'PRIVATE_OUTPUT_DIRECTORY_REQUIRED' });
  const link = path.join(dir, 'link.json'); fs.symlinkSync(one, link);
  assert.throws(() => builder.writePrivateArtifact(link, {}), { code: 'EEXIST' });
});

test('freeze CLI only reads specified source and returns hashes/counts, never raw content or model calls', t => {
  const { dir, filename } = sourceFixture(t); const before = hash(filename);
  const output = path.join(dir, 'episode.json');
  const result = builder.main(['--db', filename, '--session', 's', '--first-message', '1', '--last-message', '4', '--output', output]);
  assert.deepEqual(JSON.parse(fs.readFileSync(output)), episode());
  assert.equal(result.messageCount, 4); assert.equal(result.artifactSha256, hash(output));
  assert.equal(result.totalChanges, 0); assert.equal(result.externalApiCalls, 0); assert.equal(result.storageCommits, 0);
  assert.equal(hash(filename), before);
  assert.ok(!JSON.stringify(result).includes('커피'));
  assert.throws(() => builder.main(['--db', filename]), { code: 'INVALID_ARGUMENTS' });
});

test('Luna adapter uses original episode/instructions, fixed model, strict schema, no tools/store/retry', async () => {
  const request = builder.buildBundleSelectionRequest(episode()); let calls = 0;
  const selector = createOpenAIBundleSelector({ apiKey: 'synthetic-test-key', fetch: async (url, options) => {
    calls++; assert.equal(String(url), 'https://api.openai.com/v1/responses');
    const body = JSON.parse(options.body);
    assert.equal(body.instructions, request.instructions); assert.equal(body.input, request.input);
    assert.equal(body.model, 'gpt-6-luna'); assert.equal(body.store, false);
    assert.deepEqual(body.reasoning, { effort: 'medium', context: 'current_turn' });
    assert.equal(body.max_output_tokens, 4096); assert.equal(body.tools, undefined); assert.equal(body.stream, undefined);
    assert.deepEqual(body.text.format.schema, builder.BUNDLE_SELECTION_SCHEMA);
    return new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', role: 'assistant',
      content: [{ type: 'output_text', text: JSON.stringify(selection()) }] }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  } });
  assert.equal(calls, 0); assert.deepEqual(await selector(request), selection()); assert.equal(calls, 1);
});

for (const status of [429, 500]) {
  test(`SDK HTTP ${status} does not retry or leak private error body`, async () => {
    let calls = 0;
    const selector = createOpenAIBundleSelector({ apiKey: 'synthetic-test-key', fetch: async () => {
      calls++; return new Response(JSON.stringify({ error: { message: 'PRIVATE ERROR SENTINEL' } }), { status, headers: { 'content-type': 'application/json' } });
    } });
    await assert.rejects(selector(builder.buildBundleSelectionRequest(episode())), { code: 'OPENAI_BUNDLE_CALL_FAILED', message: 'OPENAI_BUNDLE_CALL_FAILED' });
    assert.equal(calls, 1);
  });
}

test('timeout, non-completed, empty, refused and malformed responses fail closed without retries', async () => {
  for (const [response, code] of [
    [new Error('PRIVATE TIMEOUT'), 'OPENAI_BUNDLE_CALL_FAILED'],
    [{ status: 'incomplete', output: [] }, 'INCOMPLETE_BUNDLE_RESPONSE'],
    [{ status: 'completed', output: [] }, 'EMPTY_BUNDLE_RESPONSE'],
    [{ status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'private' }] }] }, 'BUNDLE_SELECTION_REFUSAL'],
    [{ status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '```{}' }] }] }, 'INVALID_BUNDLE_SELECTION'],
  ]) {
    let calls = 0;
    const selector = createOpenAIBundleSelector({ apiKey: 'synthetic-test-key', fetch: async () => {
      calls++; if (response instanceof Error) throw response;
      return new Response(JSON.stringify(response), { status: 200, headers: { 'content-type': 'application/json' } });
    } });
    await assert.rejects(selector(builder.buildBundleSelectionRequest(episode())), { code });
    assert.equal(calls, 1);
  }
});

test('wrong private episode hash/permissions fail before selector; attempt freezes before dispatch and cannot rerun', async t => {
  const { dir } = sourceFixture(t);
  const input = path.join(dir, 'episode.json'); builder.writePrivateArtifact(input, episode());
  const output = path.join(dir, 'bundles.json');
  const args = ['--episode', input, '--episode-sha256', hash(input), '--output', output]; let calls = 0;
  const selector = () => { calls++; assert.ok(fs.existsSync(`${output}.attempt.json`)); return selection(); };
  const bad = [...args]; bad[3] = '0'.repeat(64);
  await assert.rejects(buildMain(bad, selector), { code: 'SOURCE_EPISODE_HASH_MISMATCH' });
  fs.chmodSync(input, 0o644);
  await assert.rejects(buildMain(args, selector), { code: 'PRIVATE_EPISODE_FILE_REQUIRED' });
  fs.chmodSync(input, 0o600); assert.equal(calls, 0);
  const result = await buildMain(args, selector);
  assert.equal(calls, 1); assert.equal(result.bundleCount, 1); assert.equal(result.artifactSha256, hash(output));
  assert.ok(!JSON.stringify(result).includes('커피'));
  await assert.rejects(buildMain(args, selector), { code: 'BUNDLE_OUTPUT_ALREADY_EXISTS' }); assert.equal(calls, 1);
});

test('failed or orphaned attempt remains private and prevents a second selector invocation', async t => {
  const { dir } = sourceFixture(t);
  const input = path.join(dir, 'episode.json'); builder.writePrivateArtifact(input, episode());
  const output = path.join(dir, 'bundles.json');
  const args = ['--episode', input, '--episode-sha256', hash(input), '--output', output]; let calls = 0;
  const selector = () => { calls++; throw new Error('PRIVATE PROVIDER ERROR'); };
  await assert.rejects(buildMain(args, selector), { code: 'BUNDLE_SELECTOR_CALL_FAILED' });
  const failure = fs.readFileSync(`${output}.failure.json`, 'utf8');
  assert.ok(!failure.includes('PRIVATE PROVIDER')); assert.equal(calls, 1);
  await assert.rejects(buildMain(args, selector), { code: 'EEXIST' }); assert.equal(calls, 1);
  const attempt = path.join(dir, 'orphan.json.attempt.json'); builder.writePrivateArtifact(attempt, { status: 'DISPATCH_MAY_OCCUR' });
  const orphan = [...args]; orphan[5] = path.join(dir, 'orphan.json');
  await assert.rejects(buildMain(orphan, selector), { code: 'EEXIST' }); assert.equal(calls, 1);
});
