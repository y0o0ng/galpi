'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { decodeSpan } = require('../memory-inference-p1b6-surfaces');
const { canonicalJson } = require('./general-fact');
const { readPrivateEpisode, writePrivateArtifact, attachAnchorWindows } = require('./bundle-builder');
const { runFormationEpisode } = require('./formation-runner');
const { openDevelopmentDb } = require('./review-ui');
const { createMemoryEvidenceRegistry } = require('./evidence-registry');
const { createMemoryStorageRouter } = require('./router');
const { createGeneralFactReviewHandler } = require('./general-fact-proposer');
const { configuredProposer } = require('./prepare-general-fact-review');
const { createFormationLunaStages } = require('./formation-openai');
const ROOT = fs.realpathSync(path.resolve(__dirname, '../..'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const inside = (file, dir) => file === dir || file.startsWith(`${dir}${path.sep}`);

function readPrivate(filename) {
  const resolved = fs.realpathSync(filename), stat = fs.statSync(resolved), parent = fs.statSync(path.dirname(resolved));
  if (inside(resolved, ROOT) || inside(resolved, '/home/pi/galpi') || !stat.isFile() || stat.nlink !== 1
      || (stat.mode & 0o777) !== 0o600 || (parent.mode & 0o777) !== 0o700
      || (process.getuid && (stat.uid !== process.getuid() || parent.uid !== process.getuid()))) throw Error('PRIVATE_FILE_REQUIRED');
  return JSON.parse(fs.readFileSync(resolved, 'utf8'));
}
function guardDb(filename, manifest) {
  const resolved = fs.realpathSync(filename);
  if (inside(resolved, ROOT) || inside(resolved, '/home/pi/galpi')) throw Error('INVALID_DEVELOPMENT_DB');
  if (manifest.episodes.some(entry => entry.sourceDbSha256 === hash(fs.readFileSync(resolved)))) throw Error('SOURCE_DB_FORBIDDEN');
}
function anchorsFor(episode, discovery) {
  if (!Array.isArray(discovery.bundles) || discovery.sourceEpisodeSha256 !== hash(canonicalJson(episode))) throw Error('INVALID_DISCOVERY');
  const anchors = discovery.bundles.map(bundle => {
    const span = bundle.anchorSpanRef, turn = episode.turns.find(item => item.turnId === span.turnId);
    if (!turn) throw Error('INVALID_ANCHOR');
    return { turnId: span.turnId, text: decodeSpan(turn.text, span) };
  });
  const rebuilt = attachAnchorWindows(episode, { anchors });
  if (rebuilt.bundles.length !== discovery.bundles.length || rebuilt.bundles.some((b, i) => b.bundleId !== discovery.bundles[i].bundleId)) throw Error('BUNDLE_ID_MISMATCH');
  return anchors;
}
function gate(reports, sets) {
  if (!Array.isArray(sets.keepSet) || !sets.keepSet.length || !Array.isArray(sets.operationalSet) || sets.operationalSet.length !== 7) throw Error('INVALID_DURABILITY_SETS');
  const results = reports.flatMap(report => report.results);
  const byId = new Map(results.map(row => [row.bundle.bundleId, row]));
  if (byId.size !== results.length) throw Error('DUPLICATE_BUNDLE');
  const selected = [...sets.keepSet, ...sets.operationalSet];
  if (new Set(selected.map(row => row.bundleId)).size !== selected.length || new Set(selected.map(row => row.id)).size !== selected.length
      || selected.some(row => typeof row.id !== 'string' || !byId.has(row.bundleId))) throw Error('INVALID_DURABILITY_SETS');
  const outcomes = {};
  for (const row of results) outcomes[row.status] = (outcomes[row.status] || 0) + 1;
  const kept = sets.keepSet.filter(row => byId.get(row.bundleId).durability?.disposition === 'WRITE').length;
  const operationalNoWrite = sets.operationalSet.filter(row => byId.get(row.bundleId).durability?.disposition === 'NO_WRITE').length;
  const processingErrors = outcomes.PROCESSING_ERROR || 0;
  return { outcomes, escalateCount: results.filter(r => r.ambiguity?.disposition === 'ESCALATE').length,
    keepWrite: kept, keepTotal: sets.keepSet.length, keepWriteRate: kept / sets.keepSet.length,
    operationalNoWrite, operationalTotal: sets.operationalSet.length, processingErrors,
    extracted: results.filter(r => r.extraction?.disposition === 'EXTRACTED').length,
    deferred: results.filter(r => r.extraction?.disposition === 'DEFERRED').length,
    deferrals: results.filter(r => r.extraction?.disposition === 'DEFERRED').map(r => ({ bundleId: r.bundle.bundleId, reason: r.extraction.reason })),
    reviewIds: results.filter(r => r.status === 'REVIEW_PREPARED').map(r => r.reviewId),
    gate: !processingErrors && kept / sets.keepSet.length >= 0.8 && operationalNoWrite >= 5 ? 'PASS' : 'FAIL' };
}
async function main(argv) {
  const [command, ...args] = argv;
  if (command === 'run' && args.length === 4) {
    const [episodeDir, resultsDir, dbPath, outDir] = args;
    const manifest = readPrivate(path.join(episodeDir, 'manifest.json'));
    if (!Array.isArray(manifest.episodes) || manifest.episodes.length !== 15 || manifest.episodes.some(e => !/^[a-f0-9]{64}$/.test(e.sourceDbSha256))) throw Error('INVALID_MANIFEST');
    guardDb(dbPath, manifest);
    const db = openDevelopmentDb(dbPath);
    try {
      const envFile = path.join(ROOT, '.env');
      const env = { ...(fs.existsSync(envFile) ? require('dotenv').parse(fs.readFileSync(envFile)) : {}), ...process.env };
      if (env.OPENAI_BASE_URL?.trim()) throw Error('CUSTOM_OPENAI_ENDPOINT_UNSUPPORTED');
      const stages = createFormationLunaStages({ apiKey: env.OPENAI_API_KEY });
      const registry = createMemoryEvidenceRegistry(db);
      const handler = createGeneralFactReviewHandler({ db, evidenceRegistry: registry, proposeTransition: configuredProposer() });
      const prepareReview = createMemoryStorageRouter({ evidenceRegistry: registry, transitionHandlers: new Map([['general_fact', handler]]) });
      for (const [i, entry] of manifest.episodes.entries()) {
        const id = `episode-${String(i + 1).padStart(2, '0')}`;
        const output = path.join(outDir, `${id}.report.json`);
        if (fs.existsSync(output)) { console.log(JSON.stringify({ episode: id, status: 'EXISTS' })); continue; }
        const episode = readPrivateEpisode(path.join(episodeDir, `${id}.json`), entry.episodeSha256);
        const discovery = readPrivate(path.join(resultsDir, `${id}.bundles.json`));
        const anchors = anchorsFor(episode, discovery);
        writePrivateArtifact(`${output}.attempt.json`, { schemaVersion: 1, episode: id, episodeSha256: entry.episodeSha256,
          bundleIds: discovery.bundles.map(b => b.bundleId), model: 'gpt-6-luna', maxRetries: 0, status: 'DISPATCH_MAY_OCCUR' });
        const report = await runFormationEpisode(episode, { ...stages, prepareReview, anchorWindows: true, selectBundles: () => ({ anchors }) });
        if (report.results.length !== discovery.bundles.length || report.results.some((r, j) => r.bundle.bundleId !== discovery.bundles[j].bundleId)) throw Error('BUNDLE_ID_MISMATCH');
        writePrivateArtifact(output, report);
        console.log(JSON.stringify({ episode: id, bundleCount: report.results.length }));
      }
    } finally { db.close(); }
    return;
  }
  if (command === 'gate' && args.length === 3) {
    const [episodeDir, outDir, setsFile] = args;
    const manifest = readPrivate(path.join(episodeDir, 'manifest.json'));
    if (!Array.isArray(manifest.episodes) || manifest.episodes.length !== 15) throw Error('INVALID_MANIFEST');
    const reports = manifest.episodes.map((entry, i) => {
      const id = `episode-${String(i + 1).padStart(2, '0')}`;
      const episode = readPrivateEpisode(path.join(episodeDir, `${id}.json`), entry.episodeSha256);
      const report = readPrivate(path.join(outDir, `${id}.report.json`));
      if (report.sourceEpisodeSha256 !== hash(canonicalJson(episode)) || !Array.isArray(report.results)) throw Error('INVALID_REPORT');
      return report;
    });
    return gate(reports, readPrivate(setsFile));
  }
  throw Error('INVALID_ARGUMENTS');
}
if (require.main === module) main(process.argv.slice(2)).then(result => { if (result) console.log(JSON.stringify(result)); })
  .catch(error => { console.error(/^[A-Z][A-Z0-9_]{0,79}$/.test(error.code || error.message) ? (error.code || error.message) : 'FORMATION_STEP2_FAILED'); process.exitCode = 1; });
module.exports = { anchorsFor, guardDb, gate, main };
