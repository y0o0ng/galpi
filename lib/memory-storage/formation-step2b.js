'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const Database = require('better-sqlite3');
const { readConversationEpisode, readPrivateEpisode, writePrivateArtifact } = require('./bundle-builder');
const { canonicalJson, GENERAL_FACT_ATTRIBUTES } = require('./general-fact');
const { guardDb } = require('./formation-step2');
const { openDevelopmentDb } = require('./review-ui');
const { createMemoryEvidenceRegistry } = require('./evidence-registry');
const { createMemoryStorageRouter } = require('./router');
const { createGeneralFactReviewHandler } = require('./general-fact-proposer');
const { createGeneralFactReviewStore } = require('./general-fact-review');
const { createProjectReviewHandler } = require('./project-proposer');
const { createProjectReviewStore } = require('./project-review');
const { createProjectStore } = require('./project');
const { createOpenAIProjectProposer } = require('./project-openai');
const { configuredProposer } = require('./prepare-general-fact-review');
const { createOpenAIBundleSelector } = require('./bundle-openai');
const { createFormationLunaStages } = require('./formation-openai');
const { runFormationEpisode } = require('./formation-runner');

const ROOT = fs.realpathSync(path.resolve(__dirname, '../..'));
const SESSION = 'shared-main';
const hash = value => createHash('sha256').update(value).digest('hex');
const fileIdentity = filename => { const stat = fs.statSync(filename); return hash(`formation-step2b-source-file-v1\0${stat.dev}\0${stat.ino}`); };

function sampleEpisodes(rows, step1Manifest) {
  if (!Array.isArray(step1Manifest?.episodes) || !step1Manifest.episodes.length
      || step1Manifest.episodes.some(entry => entry.session !== SESSION
        || !Number.isSafeInteger(entry.firstMessageId) || !Number.isSafeInteger(entry.lastMessageId)
        || entry.firstMessageId <= 0 || entry.lastMessageId <= 0
        || !Number.isSafeInteger(entry.messageCount) || entry.messageCount < 1)) {
    throw Error('INVALID_STEP1_MANIFEST');
  }
  // Reconstruct actual IDs in source order; IDs need not be contiguous or
  // increase with message timestamps.
  const indexById = new Map(rows.map((row, index) => [row.id, index]));
  if (indexById.size !== rows.length) throw Error('INVALID_SOURCE_ROWS');
  const excludedIds = new Set();
  for (const entry of step1Manifest.episodes) {
    const first = indexById.get(entry.firstMessageId), last = indexById.get(entry.lastMessageId);
    if (first === undefined || last === undefined || last < first || last - first + 1 !== entry.messageCount) {
      throw Error('STEP1_EPISODE_NOT_FOUND');
    }
    for (const row of rows.slice(first, last + 1)) excludedIds.add(row.id);
  }
  const groups = [];
  let group = [];
  for (const row of rows) {
    if (group.length && row.created_at - group.at(-1).created_at >= 1800) {
      groups.push(group);
      group = [];
    }
    group.push(row);
  }
  if (group.length) groups.push(group);
  const excluded = id => (id >= 1684 && id <= 1707) || excludedIds.has(id);
  return groups.map((items, order) => ({ items, order }))
    .filter(({ items }) => items.length >= 6 && items.length <= 24 && !items.some(row => excluded(row.id)))
    .map(({ items, order }) => ({ firstMessageId: items[0].id, lastMessageId: items.at(-1).id,
      messageCount: items.length, order }))
    .sort((a, b) => hash(`formation-loop-step2b-v1\0${a.firstMessageId}\0${a.lastMessageId}`)
      .localeCompare(hash(`formation-loop-step2b-v1\0${b.firstMessageId}\0${b.lastMessageId}`)))
    .slice(0, 15)
    .sort((a, b) => a.order - b.order)
    .map(({ order, ...entry }) => entry);
}

function privateSource(filename) {
  const resolved = fs.realpathSync(filename);
  const stat = fs.statSync(resolved);
  const parent = fs.statSync(path.dirname(resolved));
  if (resolved === ROOT || resolved.startsWith(`${ROOT}${path.sep}`)
      || resolved === '/home/pi/galpi' || resolved.startsWith('/home/pi/galpi/')
      || !stat.isFile() || stat.nlink !== 1 || (stat.mode & 0o777) !== 0o600
      || !parent.isDirectory() || (parent.mode & 0o777) !== 0o700
      || (process.getuid && (stat.uid !== process.getuid() || parent.uid !== process.getuid()))) {
    throw Error('PRIVATE_SOURCE_DB_REQUIRED');
  }
  return resolved;
}

function sample(sourcePath, privateDir, step1Manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'fixtures/memory-formation-step1-manifest.json'), 'utf8'))) {
  const source = privateSource(sourcePath);
  // A nonempty WAL changes the source contents without changing the DB file hash.
  if (fs.existsSync(`${source}-wal`) && fs.statSync(`${source}-wal`).size > 0) throw Error('SOURCE_DB_HAS_WAL');
  const db = new Database(source, { readonly: true, fileMustExist: true });
  try {
    db.pragma('query_only = ON');
    const sourceDbSha256 = hash(fs.readFileSync(source));
    const rows = db.prepare('SELECT id, created_at FROM messages WHERE session_id = ? AND created_at >= ? AND created_at < ? ORDER BY created_at, id')
      .all(SESSION, Date.parse('2026-08-01T00:00:00+09:00') / 1000, Date.parse('2026-10-30T00:00:00+09:00') / 1000);
    const selected = sampleEpisodes(rows, step1Manifest);
    if (selected.length !== 15) throw Error('INSUFFICIENT_EPISODES');
    const episodes = selected.map((entry, i) => {
      const episode = readConversationEpisode(db, { sessionId: SESSION, ...entry });
      const episodeSha256 = writePrivateArtifact(path.join(privateDir, `episode-${String(i + 1).padStart(2, '0')}.json`), episode);
      return { session: SESSION, ...entry, episodeSha256, sourceDbSha256 };
    });
    const manifest = { sourceFileIdentitySha256: fileIdentity(source), episodes };
    writePrivateArtifact(path.join(privateDir, 'manifest.json'), manifest);
    return manifest;
  } finally { db.close(); }
}

function readPrivate(filename) {
  const resolved = fs.realpathSync(filename), stat = fs.statSync(resolved), parent = fs.statSync(path.dirname(resolved));
  if (resolved.startsWith(`${ROOT}${path.sep}`) || resolved.startsWith('/home/pi/galpi/') || !stat.isFile() || stat.nlink !== 1
      || (stat.mode & 0o777) !== 0o600 || (parent.mode & 0o777) !== 0o700
      || (process.getuid && (stat.uid !== process.getuid() || parent.uid !== process.getuid()))) throw Error('PRIVATE_FILE_REQUIRED');
  return JSON.parse(fs.readFileSync(resolved, 'utf8'));
}
function manifestIn(dir) {
  const manifest = readPrivate(path.join(dir, 'manifest.json'));
  if (!/^[a-f0-9]{64}$/.test(manifest.sourceFileIdentitySha256)
      || !Array.isArray(manifest.episodes) || manifest.episodes.length !== 15
      || manifest.episodes.some(e => e.session !== SESSION || !/^[a-f0-9]{64}$/.test(e.sourceDbSha256)
        || !/^[a-f0-9]{64}$/.test(e.episodeSha256))) throw Error('INVALID_MANIFEST');
  return manifest;
}
function validateContext(privateDir, dbPath, outDir) {
  const manifest = manifestIn(privateDir); guardDb(dbPath, manifest);
  if (fileIdentity(dbPath) === manifest.sourceFileIdentitySha256) throw Error('SOURCE_DB_FORBIDDEN');
  const resolved = fs.realpathSync(outDir), stat = fs.statSync(resolved);
  if (resolved === ROOT || resolved.startsWith(`${ROOT}${path.sep}`)
      || resolved === '/home/pi/galpi' || resolved.startsWith('/home/pi/galpi/')
      || !stat.isDirectory() || (stat.mode & 0o777) !== 0o700
      || (process.getuid && stat.uid !== process.getuid())) throw Error('PRIVATE_OUTPUT_DIRECTORY_REQUIRED');
  return manifest;
}
const episodeId = index => `episode-${String(index + 1).padStart(2, '0')}`;
function readReport(dir, index, episode, db) {
  const filename = path.join(dir, `${episodeId(index)}.report.json`);
  const report = readPrivate(filename);
  const saved = db.prepare('SELECT episode_sha256, report_sha256 FROM memory_formation_step2b_episodes WHERE episode_number=?').get(index + 1);
  if (!saved || saved.episode_sha256 !== hash(`${canonicalJson(episode)}\n`)
      || saved.report_sha256 !== hash(fs.readFileSync(filename))) throw Error('REPORT_INTEGRITY_MISMATCH');
  if (!Array.isArray(report.results) || report.sourceEpisodeSha256 !== hash(canonicalJson(episode))) throw Error('INVALID_REPORT');
  return report;
}
function importEpisode(db, episode) {
  db.transaction(() => {
    const get = db.prepare('SELECT session_id, role, content, created_at FROM messages WHERE id=?');
    const insert = db.prepare('INSERT INTO messages(id, session_id, role, content, created_at) VALUES(?,?,?,?,?)');
    for (const turn of episode.turns) {
      const existing = get.get(turn.messageId);
      const expected = { session_id: episode.sessionId, role: turn.role.toLowerCase(), content: turn.text, created_at: turn.createdAt };
      if (existing && canonicalJson(existing) !== canonicalJson(expected)) throw Error('SOURCE_MESSAGE_MISMATCH');
      if (!existing) insert.run(turn.messageId, expected.session_id, expected.role, expected.content, expected.created_at);
    }
  })();
}
function reviewStoreFor(reviewId, general, project) {
  return reviewId.startsWith('project_review_') ? project : general;
}
function effectiveReport(db, index, report) {
  const rows = db.prepare('SELECT * FROM memory_formation_step2b_candidates WHERE episode_number=? ORDER BY result_index').all(index + 1);
  const expected = new Map();
  report.results.forEach((result, i) => {
    if (result.status === 'CANDIDATE_READY') {
      const digest = hash(canonicalJson(result.candidate));
      if (!expected.has(digest)) expected.set(digest, i);
    }
  });
  if (rows.length !== expected.size || rows.some(row => expected.get(row.candidate_sha256) !== row.result_index)) throw Error('INVALID_CANDIDATE_QUEUE');
  const byHash = new Map(rows.map(row => [row.candidate_sha256, row]));
  return { ...report, results: report.results.map(result => {
    if (result.status !== 'CANDIDATE_READY') return result;
    const row = byHash.get(hash(canonicalJson(result.candidate)));
    return { ...result, status: row.status, ...(row.candidate_id ? { candidateId: row.candidate_id } : {}),
      ...(row.review_id ? { reviewId: row.review_id, packageSha256: row.package_sha256 } : {}),
      ...(row.reason ? { reason: row.reason } : {}) };
  }) };
}
function assertEarlierReviewed(manifest, privateDir, outDir, index, general, project, db) {
  for (let i = 0; i < index; i++) {
    const source = readPrivateEpisode(path.join(privateDir, `${episodeId(i)}.json`), manifest.episodes[i].episodeSha256);
    const report = effectiveReport(db, i, readReport(outDir, i, source, db));
    if (report.results.some(r => ['WAITING', 'ATTEMPTED'].includes(r.status))) throw Error('EARLIER_REVIEW_UNDECIDED');
    for (const result of report.results.filter(r => r.status === 'REVIEW_PREPARED')) {
      if (reviewStoreFor(result.reviewId, general, project).get(result.reviewId).decision === null) throw Error('EARLIER_REVIEW_UNDECIDED');
    }
  }
}
function gate(reports, general, project, projects) {
  const outcomes = {}, decisions = {}, rejectionTags = {}, transitions = {}, preparedByFamily = { project: 0, general_fact_multi: 0 }, duplicates = [];
  const seen = new Map(), allSeen = new Set(); let prepared = 0, approved = 0, undecided = 0, unfinished = 0;
  for (const report of reports) for (const row of report.results) {
    outcomes[row.status] = (outcomes[row.status] || 0) + 1;
    if (['WAITING', 'ATTEMPTED'].includes(row.status)) { unfinished++; continue; }
    if (row.status !== 'REVIEW_PREPARED') continue;
    if (!allSeen.has(row.reviewId)) {
      allSeen.add(row.reviewId);
      if (reviewStoreFor(row.reviewId, general, project).get(row.reviewId).decision === null) unfinished++;
    }
    const payload = row.candidate?.payload;
    if (row.candidate?.semanticFamily !== 'project' && !(row.candidate?.semanticFamily === 'general_fact'
      && GENERAL_FACT_ATTRIBUTES[payload?.attributeKey]?.cardinality === 'MULTI')) continue;
    if (seen.has(row.reviewId)) {
      if (seen.get(row.reviewId) !== row.candidateId) throw Error('DUPLICATE_REVIEW');
      continue;
    }
    seen.set(row.reviewId, row.candidateId); prepared++;
    preparedByFamily[row.candidate.semanticFamily === 'project' ? 'project' : 'general_fact_multi']++;
    const review = reviewStoreFor(row.reviewId, general, project).get(row.reviewId);
    if (review.candidateId !== row.candidateId || review.packageSha256 !== row.packageSha256) throw Error('REVIEW_BINDING_MISMATCH');
    const decision = review.decision || 'UNDECIDED'; decisions[decision] = (decisions[decision] || 0) + 1;
    if (review.proposal?.transition) transitions[review.proposal.transition] = (transitions[review.proposal.transition] || 0) + 1;
    if (decision === 'APPROVE') approved++;
    if (decision === 'UNDECIDED') undecided++;
    if (decision === 'REJECT_PROPOSAL') {
      if (!['WRONG_TARGET', 'WRONG_CONTENT', 'OTHER'].includes(review.rejectionTag)) throw Error('MISSING_REJECTION_TAG');
      rejectionTags[review.rejectionTag] = (rejectionTags[review.rejectionTag] || 0) + 1;
    }
  }
  for (let i = 0; i < projects.length; i++) for (let j = i + 1; j < projects.length; j++) {
    if (projects[i].aliases.some(alias => projects[j].aliases.includes(alias))) duplicates.push([projects[i].projectId, projects[j].projectId]);
  }
  const approvalRate = prepared ? approved / prepared : null;
  return { outcomes, prepared, preparedByFamily, approved, undecided, unfinished, decisions, rejectionTags, transitions, approvalRate, duplicateProjects: duplicates,
    gate: !unfinished && !undecided && prepared > 0 && !(rejectionTags.WRONG_TARGET || 0) && approvalRate >= 0.70 ? 'PASS' : 'FAIL' };
}
function moduleRequired(db) {
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='memory_storage_migrations'").get()
    || !db.prepare('SELECT 1 FROM memory_storage_migrations WHERE version=2').get()) throw Error('MODULE_MIGRATION_REQUIRED');
}
async function prepareNextInDb(db, manifest, privateDir, outDir, index, adapters = {}) {
  const registry = createMemoryEvidenceRegistry(db);
  const general = createGeneralFactReviewStore(db, registry), project = createProjectReviewStore(db, registry);
  assertEarlierReviewed(manifest, privateDir, outDir, index, general, project, db);
  const episode = readPrivateEpisode(path.join(privateDir, `${episodeId(index)}.json`), manifest.episodes[index].episodeSha256);
  const report = readReport(outDir, index, episode, db);
  const claim = db.transaction(() => {
    const effective = effectiveReport(db, index, report);
    for (const result of effective.results) {
      if (result.status === 'ATTEMPTED') return { status: 'ATTEMPT_INCOMPLETE' };
      if (result.status === 'REVIEW_PREPARED'
        && reviewStoreFor(result.reviewId, general, project).get(result.reviewId).decision === null) return { status: 'AWAITING_REVIEW', reviewId: result.reviewId };
    }
    const row = db.prepare("SELECT * FROM memory_formation_step2b_candidates WHERE episode_number=? AND status='WAITING' ORDER BY result_index LIMIT 1").get(index + 1);
    if (!row) return { status: 'COMPLETE' };
    const changed = db.prepare("UPDATE memory_formation_step2b_candidates SET status='ATTEMPTED' WHERE episode_number=? AND result_index=? AND status='WAITING'")
      .run(index + 1, row.result_index);
    if (changed.changes !== 1) throw Error('CANDIDATE_CLAIM_FAILED');
    return { status: 'CLAIMED', row, candidate: report.results[row.result_index].candidate };
  }).immediate();
  if (claim.status !== 'CLAIMED') return claim;
  let result;
  try {
    const family = claim.candidate.semanticFamily;
    let proposer = family === 'project' ? adapters.projectProposer : adapters.generalProposer;
    if (!proposer) {
      if (family === 'project') {
        const envFile = path.join(ROOT, '.env');
        const env = { ...(fs.existsSync(envFile) ? require('dotenv').parse(fs.readFileSync(envFile)) : {}), ...process.env };
        if (env.OPENAI_BASE_URL?.trim()) throw Error('CUSTOM_OPENAI_ENDPOINT_UNSUPPORTED');
        proposer = createOpenAIProjectProposer({ apiKey: env.OPENAI_API_KEY });
      } else if (family === 'general_fact') proposer = configuredProposer();
      else throw Error('UNREGISTERED_SEMANTIC_FAMILY');
    }
    const handler = family === 'project' ? createProjectReviewHandler({ db, evidenceRegistry: registry, proposeTransition: proposer })
      : family === 'general_fact' ? createGeneralFactReviewHandler({ db, evidenceRegistry: registry, proposeTransition: proposer }) : null;
    if (!handler) throw Error('UNREGISTERED_SEMANTIC_FAMILY');
    const route = createMemoryStorageRouter({ evidenceRegistry: registry, transitionHandlers: new Map([[family, handler]]) });
    const prepared = await route(claim.candidate);
    if (prepared.status === 'PENDING' && prepared.reason === 'HUMAN_REVIEW_REQUIRED' && prepared.review?.reviewId)
      result = { status: 'REVIEW_PREPARED', candidateId: prepared.candidateId, reviewId: prepared.review.reviewId, packageSha256: prepared.review.packageSha256 };
    else if (prepared.status === 'PENDING' && prepared.reason === 'KEEP_AMBIGUOUS') result = { status: 'KEEP_AMBIGUOUS', candidateId: prepared.candidateId };
    else if (prepared.status === 'COMMITTED' && prepared.transitionId) result = { status: 'ALREADY_COMMITTED', candidateId: prepared.candidateId };
    else throw Error('INVALID_REVIEW_RESULT');
  } catch (error) {
    const code = error.code || error.message || '';
    result = { status: 'PROCESSING_ERROR', reason: /^[A-Z][A-Z0-9_]{0,79}$/.test(code) ? code : 'REVIEW_FAILED' };
  }
  db.prepare("UPDATE memory_formation_step2b_candidates SET status=?,candidate_id=?,review_id=?,package_sha256=?,reason=? WHERE episode_number=? AND result_index=? AND status='ATTEMPTED'")
    .run(result.status, result.candidateId || null, result.reviewId || null, result.packageSha256 || null, result.reason || null, index + 1, claim.row.result_index);
  return result;
}
async function prepareNext(privateDir, dbPath, outDir, number, adapters = {}) {
  if (!/^(?:[1-9]|1[0-5]|0[1-9])$/.test(String(number))) throw Error('INVALID_EPISODE_NUMBER');
  const manifest = validateContext(privateDir, dbPath, outDir);
  const db = openDevelopmentDb(dbPath);
  try { moduleRequired(db); return await prepareNextInDb(db, manifest, privateDir, outDir, Number(number) - 1, adapters); }
  finally { db.close(); }
}
async function advanceAfterDecision(db, privateDir, dbPath, outDir, reviewId, adapters = {}) {
  const row = db.transaction(() => {
    const row = db.prepare('SELECT episode_number, advance_triggered FROM memory_formation_step2b_candidates WHERE review_id=?').get(reviewId);
    if (!row || row.advance_triggered) return null;
    const registry = createMemoryEvidenceRegistry(db);
    const review = reviewStoreFor(reviewId, createGeneralFactReviewStore(db, registry), createProjectReviewStore(db, registry)).get(reviewId);
    if (review.decision === null) throw Error('REVIEW_UNDECIDED');
    db.prepare('UPDATE memory_formation_step2b_candidates SET advance_triggered=1 WHERE review_id=? AND advance_triggered=0').run(reviewId);
    return row;
  }).immediate();
  if (!row) return null;
  return prepareNext(privateDir, dbPath, outDir, row.episode_number, adapters);
}
async function run(privateDir, dbPath, outDir, number, adapters = {}) {
  if (!/^(?:[1-9]|1[0-5]|0[1-9])$/.test(String(number))) throw Error('INVALID_EPISODE_NUMBER');
  const index = Number(number) - 1, manifest = validateContext(privateDir, dbPath, outDir);
  const db = openDevelopmentDb(dbPath);
  try {
    moduleRequired(db);
    const registry = createMemoryEvidenceRegistry(db), general = createGeneralFactReviewStore(db, registry), project = createProjectReviewStore(db, registry);
    const output = path.join(outDir, `${episodeId(index)}.report.json`);
    if (fs.existsSync(output) || fs.existsSync(`${output}.attempt.json`)
      || db.prepare('SELECT 1 FROM memory_formation_step2b_episodes WHERE episode_number=?').get(index + 1)) throw Error('EPISODE_ALREADY_ATTEMPTED');
    assertEarlierReviewed(manifest, privateDir, outDir, index, general, project, db);
    if (index === 0 && ['memory_general_fact_candidates', 'memory_project_candidates', 'memory_general_fact_reviews', 'memory_project_reviews']
      .some(table => db.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get())) throw Error('EMPTY_STORE_REQUIRED');
    if (index === 0) {
      const sampledIds = new Set(manifest.episodes.flatMap((entry, i) => readPrivateEpisode(
        path.join(privateDir, `${episodeId(i)}.json`), entry.episodeSha256).turns.map(turn => turn.messageId)));
      if (db.prepare('SELECT id FROM messages').all().some(row => !sampledIds.has(row.id))) throw Error('SOURCE_DB_FORBIDDEN');
    }
    const episode = readPrivateEpisode(path.join(privateDir, `${episodeId(index)}.json`), manifest.episodes[index].episodeSha256);
    importEpisode(db, episode);
    const envFile = path.join(ROOT, '.env');
    const needsProvider = !adapters.selectBundles || !adapters.stages;
    const env = needsProvider ? { ...(fs.existsSync(envFile) ? require('dotenv').parse(fs.readFileSync(envFile)) : {}), ...process.env } : {};
    if (env.OPENAI_BASE_URL?.trim()) throw Error('CUSTOM_OPENAI_ENDPOINT_UNSUPPORTED');
    const selector = adapters.selectBundles || createOpenAIBundleSelector({ apiKey: env.OPENAI_API_KEY });
    const stages = adapters.stages || createFormationLunaStages({ apiKey: env.OPENAI_API_KEY, enableProjects: true });
    db.prepare('INSERT INTO memory_formation_step2b_episodes(episode_number,episode_sha256) VALUES(?,?)')
      .run(index + 1, manifest.episodes[index].episodeSha256);
    writePrivateArtifact(`${output}.attempt.json`, { schemaVersion: 1, episode: episodeId(index), episodeSha256: manifest.episodes[index].episodeSha256,
      model: 'gpt-6-luna', maxRetries: 0, status: 'DISPATCH_MAY_OCCUR' });
    const report = await runFormationEpisode(episode, { ...stages, deferReview: true, anchorWindows: true, selectBundles: selector });
    const reportSha256 = writePrivateArtifact(output, report);
    db.transaction(() => {
      const insert = db.prepare('INSERT INTO memory_formation_step2b_candidates(episode_number,result_index,candidate_sha256) VALUES(?,?,?) ON CONFLICT(episode_number,candidate_sha256) DO NOTHING');
      report.results.forEach((row, i) => { if (row.status === 'CANDIDATE_READY') insert.run(index + 1, i, hash(canonicalJson(row.candidate))); });
      db.prepare('UPDATE memory_formation_step2b_episodes SET report_sha256=? WHERE episode_number=? AND report_sha256 IS NULL').run(reportSha256, index + 1);
    })();
    const next = await prepareNextInDb(db, manifest, privateDir, outDir, index, adapters);
    return { episode: episodeId(index), outcomes: report.results.reduce((counts, row) => { counts[row.status] = (counts[row.status] || 0) + 1; return counts; }, {}), next };
  } finally { db.close(); }
}
function gateCommand(privateDir, dbPath, outDir) {
  const manifest = validateContext(privateDir, dbPath, outDir);
  const db = openDevelopmentDb(dbPath);
  try {
    moduleRequired(db);
    const registry = createMemoryEvidenceRegistry(db);
    const reports = manifest.episodes.map((entry, index) => {
      const episode = readPrivateEpisode(path.join(privateDir, `${episodeId(index)}.json`), entry.episodeSha256);
      return effectiveReport(db, index, readReport(outDir, index, episode, db));
    });
    return gate(reports, createGeneralFactReviewStore(db, registry), createProjectReviewStore(db, registry), createProjectStore(db, registry).readProjects());
  } finally { db.close(); }
}
async function main(argv) {
  if (argv[0] === 'sample' && argv.length === 3) return sample(argv[1], argv[2]);
  if (argv[0] === 'run' && argv.length === 5) return run(argv[1], argv[2], argv[3], argv[4]);
  if (argv[0] === 'next' && argv.length === 5) return prepareNext(argv[1], argv[2], argv[3], argv[4]);
  if (argv[0] === 'gate' && argv.length === 4) return gateCommand(argv[1], argv[2], argv[3]);
  throw Error('INVALID_ARGUMENTS');
}

if (require.main === module) {
  main(process.argv.slice(2)).then(result => console.log(JSON.stringify(result)))
    .catch(error => { console.error(/^[A-Z][A-Z0-9_]{0,79}$/.test(error.message) ? error.message : 'FORMATION_STEP2B_FAILED'); process.exitCode = 1; });
}

module.exports = { sampleEpisodes, sample, run, prepareNext, advanceAfterDecision, validateContext, gate, gateCommand, main };
