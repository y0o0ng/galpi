'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { canonicalJson } = require('./general-fact');
const { readConversationEpisode, readPrivateEpisode, writePrivateArtifact, writePrivateText } = require('./bundle-builder');
const hash = value => createHash('sha256').update(value).digest('hex');
const ROOT = fs.realpathSync(path.resolve(__dirname, '../..'));
const SESSION = 'shared-main';

function sampleEpisodes(rows) {
  const episodes = [];
  let current = [];
  for (const row of rows) {
    if (current.length && row.created_at - current.at(-1).created_at >= 1800) {
      episodes.push(current); current = [];
    }
    current.push(row);
  }
  if (current.length) episodes.push(current);
  return episodes.filter(group => group.length >= 6 && group.length <= 24
    && !group.some(row => row.id >= 1684 && row.id <= 1707))
    .map(group => ({ firstMessageId: group[0].id, lastMessageId: group.at(-1).id, messageCount: group.length }))
    .sort((a, b) => hash(`formation-loop-step1-v1\0${a.firstMessageId}\0${a.lastMessageId}`)
      .localeCompare(hash(`formation-loop-step1-v1\0${b.firstMessageId}\0${b.lastMessageId}`)))
    .slice(0, 15);
}

function privateBytes(filename) {
  const resolved = fs.realpathSync(filename);
  const stat = fs.statSync(resolved);
  const parent = fs.statSync(path.dirname(resolved));
  if (resolved.startsWith(`${ROOT}${path.sep}`) || resolved.startsWith('/home/pi/galpi/')
      || !stat.isFile() || stat.nlink !== 1 || (stat.mode & 0o777) !== 0o600
      || (parent.mode & 0o777) !== 0o700
      || (process.getuid && (stat.uid !== process.getuid() || parent.uid !== process.getuid()))) throw Error('PRIVATE_FILE_REQUIRED');
  return fs.readFileSync(resolved);
}
const readJson = filename => JSON.parse(privateBytes(filename).toString('utf8'));

function referenceItems(text) {
  const items = [];
  let episode = null, inList = false;
  for (const line of text.split('\n')) {
    const heading = /^## episode-(\d\d)$/.exec(line);
    if (heading) { episode = heading[1]; inList = false; }
    else if (line === '기억할 것:') inList = true;
    else if (inList && /^-\s+\S/.test(line)) items.push({ id: `episode-${episode}-ref-${items.filter(x => x.episode === episode).length + 1}`, episode });
  }
  return items;
}

function scoringTemplate(reference, discoveries) {
  const references = referenceItems(reference).map(item => ({ id: item.id, coveringAnchor: '' }));
  const anchors = discoveries.flatMap(({ episode, bundles }) => bundles.map((bundle, i) => ({
    id: `episode-${episode}-anchor-${i + 1}`, bundleId: bundle.bundleId, scope: '', duplicateOf: '',
  })));
  return { references, anchors };
}

function score(reference, discoveries, scoring) {
  const expected = scoringTemplate(reference, discoveries);
  if (!expected.references.length || !Array.isArray(scoring.references) || !Array.isArray(scoring.anchors)
      || scoring.references.length !== expected.references.length || scoring.anchors.length !== expected.anchors.length) throw Error('INCOMPLETE_SCORING');
  const ids = new Set(expected.anchors.map(a => a.id));
  for (const [i, row] of scoring.references.entries()) {
    if (row.id !== expected.references[i].id || !(row.coveringAnchor === 'MISSED'
      || (ids.has(row.coveringAnchor) && row.coveringAnchor.split('-')[1] === row.id.split('-')[1]))) throw Error('INVALID_REFERENCE_SCORE');
  }
  for (const [i, row] of scoring.anchors.entries()) {
    if (row.id !== expected.anchors[i].id || row.bundleId !== expected.anchors[i].bundleId
      || !['IN', 'OUT'].includes(row.scope) || (row.duplicateOf !== '' && (!ids.has(row.duplicateOf)
        || row.duplicateOf === row.id || row.duplicateOf.split('-')[1] !== row.id.split('-')[1]))) throw Error('INVALID_ANCHOR_SCORE');
  }
  const covered = scoring.references.filter(r => r.coveringAnchor !== 'MISSED').length;
  const out = scoring.anchors.filter(a => a.scope === 'OUT').length;
  const recall = covered / scoring.references.length, outOfScopeRate = (scoring.anchors.length ? out / scoring.anchors.length : 0);
  return { referenceCount: scoring.references.length, covered, anchorCount: scoring.anchors.length, out,
    duplicateAnchors: scoring.anchors.filter(a => a.duplicateOf).length, recall, outOfScopeRate,
    gate: recall >= 0.70 && outOfScopeRate <= 0.20 ? 'PASS' : 'FAIL' };
}

function discoveriesIn(episodeDir, resultsDir, manifest) {
  return manifest.episodes.map((entry, i) => {
    const episode = String(i + 1).padStart(2, '0');
    const result = readJson(path.join(resultsDir, `episode-${episode}.bundles.json`));
    const source = readPrivateEpisode(path.join(episodeDir, `episode-${episode}.json`), entry.episodeSha256);
    if (!Array.isArray(result.bundles) || result.sourceEpisodeSha256 !== hash(canonicalJson(source))) throw Error('INVALID_DISCOVERY');
    return { episode, bundles: result.bundles };
  });
}

function main(args) {
  const [command, ...a] = args;
  if (command === 'sample' && a.length === 2) {
    const Database = require('better-sqlite3');
    const db = new Database(a[0], { readonly: true, fileMustExist: true });
    try {
      db.pragma('query_only = ON');
      const dbHash = hash(fs.readFileSync(a[0]));
      const rows = db.prepare('SELECT id, created_at FROM messages WHERE session_id = ? AND created_at >= ? AND created_at < ? ORDER BY created_at, id')
        .all(SESSION, Date.parse('2026-08-01T00:00:00+09:00') / 1000, Date.parse('2026-10-30T00:00:00+09:00') / 1000);
      const selected = sampleEpisodes(rows);
      if (selected.length !== 15) throw Error('INSUFFICIENT_EPISODES');
      const episodes = selected.map((entry, i) => {
        const episode = readConversationEpisode(db, { sessionId: SESSION, ...entry });
        const episodeSha256 = writePrivateArtifact(path.join(a[1], `episode-${String(i + 1).padStart(2, '0')}.json`), episode);
        return { session: SESSION, ...entry, episodeSha256, sourceDbSha256: dbHash };
      });
      const manifest = { episodes };
      writePrivateArtifact(path.join(a[1], 'manifest.json'), manifest);
      return manifest;
    } finally { db.close(); }
  }
  if (command === 'template' && a.length === 2) {
    const manifest = readJson(path.join(a[0], 'manifest.json'));
    const sections = manifest.episodes.map((entry, i) => {
      const n = String(i + 1).padStart(2, '0');
      const episode = readPrivateEpisode(path.join(a[0], `episode-${n}.json`), entry.episodeSha256);
      return `## episode-${n}\n\n${episode.turns.map(t => `### ${t.turnId} ${t.role}\n\n${t.text.split('\n').map(line => `> ${line}`).join('\n')}`).join('\n\n')}\n\n기억할 것:\n- \n`;
    });
    return { sha256: writePrivateText(a[1], `# Owner reference list\n\n${sections.join('\n')}`) };
  }
  if (command === 'freeze' && a.length === 2) {
    const sha256 = hash(privateBytes(a[0]));
    writePrivateArtifact(a[1], { sha256 });
    return { sha256 };
  }
  if ((command === 'scoring-template' || command === 'score') && a.length === 5) {
    const bytes = privateBytes(a[0]);
    if (hash(bytes) !== readJson(a[1]).sha256) throw Error('REFERENCE_HASH_MISMATCH');
    const manifest = readJson(path.join(a[2], 'manifest.json'));
    const discoveries = discoveriesIn(a[2], a[3], manifest);
    const reference = bytes.toString('utf8');
    if (command === 'scoring-template') return { sha256: writePrivateArtifact(a[4], scoringTemplate(reference, discoveries)) };
    return score(reference, discoveries, readJson(a[4]));
  }
  throw Error('INVALID_ARGUMENTS');
}
if (require.main === module) {
  try { console.log(JSON.stringify(main(process.argv.slice(2)))); }
  catch (error) { console.error(error.code || error.message); process.exitCode = 1; }
}
module.exports = { sampleEpisodes, referenceItems, scoringTemplate, score, main };
