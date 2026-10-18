'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify, isDeepStrictEqual } = require('node:util');
const { fail } = require('./runner');
const { normalizePublicWebUrl } = require('../web/service');
const { checkCaption } = require('../reels/instagram');
const exec = promisify(execFile);
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
function section(text, name) {
  return new RegExp(`^## ${name}\\s*\\n([\\s\\S]*?)(?=^## |$(?![\\s\\S]))`, 'm').exec(text)?.[1]?.trim() || '';
}
function manuscript(file, mode, date) {
  const text = fs.readFileSync(file, 'utf8');
  const block = /```json\s*\n([\s\S]*?)\n```/.exec(section(text, '조립 원고'))?.[1];
  let deck;
  try { deck = JSON.parse(block); } catch { throw fail('CARDS_MANUSCRIPT_JSON'); }
  if (deck.mode !== mode || deck.date !== date || !deck.topic?.trim() || !deck.source?.trim()
    || !Array.isArray(deck.cards) || deck.cards.length < 4 || deck.cards.length > (mode === 'news' ? 7 : 8)
    || deck.cards[0]?.layout !== 'cover' || deck.cards.at(-1)?.layout !== 'closing') throw fail('CARDS_MANUSCRIPT_INVALID');
  const caption = section(text, '게시 캡션').split('\n').map(line => line.trimEnd()).join('\n');
  if (!caption) throw fail('CARDS_CAPTION_MISSING');
  checkCaption(caption);
  return { deck, caption, text };
}
function editorial(value, expected, assetFiles = new Set()) {
  if (Array.isArray(value)) return value.map((v, i) => editorial(v, expected?.[i], assetFiles));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([key,v]) => Object.hasOwn(expected || {}, key)
    || (!['art', 'art_box', 'photo', 'photo_box', 'content'].includes(key) && !(/_(art|photo)$/.test(key) && assetFiles.has(v))))
    .map(([key, v]) => [key, editorial(v, expected?.[key], assetFiles)]));
}
function within(file, root) {
  const resolved = fs.realpathSync(file), base = fs.realpathSync(root) + path.sep;
  if (!resolved.startsWith(base)) throw fail('CARDS_PATH_OUTSIDE_JOB');
  return resolved;
}
function validateDeck(deckPath, expected, workDir, caption, assetFiles = new Set()) {
  const actual = JSON.parse(fs.readFileSync(deckPath, 'utf8'));
  const normalizeCaption = value => value.split('\n').map(line=>line.trimEnd()).join('\n').trim();
  if (Object.hasOwn(actual,'caption') && (typeof actual.caption !== 'string' || normalizeCaption(actual.caption) !== normalizeCaption(caption))) throw fail('CARDS_CAPTION_MISMATCH');
  const copy={...actual};
  if (!Object.hasOwn(expected,'caption')) delete copy.caption;
  if (!isDeepStrictEqual(editorial(copy, expected, assetFiles), expected)) throw fail('CARDS_COPY_MISMATCH');
  function walk(value) {
    if (!value || typeof value !== 'object') return;
    for (const [key,file] of Object.entries(value)) if (['art','photo'].includes(key)||/_(art|photo)$/.test(key)) within(path.resolve(workDir, file), workDir);
    Object.values(value).forEach(walk);
  }
  walk(actual);
  if (normalizeCaption(fs.readFileSync(path.join(workDir, 'caption.txt'), 'utf8')) !== normalizeCaption(caption)) throw fail('CARDS_CAPTION_MISMATCH');
  return actual;
}
async function python(config, args, signal) {
  try { return (await exec(config.python, args, { timeout: 5 * 60 * 1000, maxBuffer: 4 * 1024 * 1024, signal,
    env: Object.fromEntries(['PATH','HOME','LANG'].filter(k => process.env[k]).map(k => [k, process.env[k]])) })).stdout; }
  catch (error) { throw fail(signal?.aborted ? 'CARDS_ABORTED' : 'CARDS_CHECK_FAILED', String(error.stderr || error.message).slice(0, 500)); }
}
async function checkFacts(config, file, sources, signal, assetMetadata = []) {
  const text = fs.readFileSync(file, 'utf8');
  const rows = section(text, '사실 확인 목록').split('\n').filter(line => /^\|\s*C\d+\s*\|/.test(line));
  if (!rows.length) throw fail('CARDS_NO_CLAIMS');
  for (const row of rows) for (const url of row.match(/https?:\/\/[^\s)|>`]+/g) || []) normalizePublicWebUrl(url.replace(/[.,;:]$/, ''));
  const mappingFile = path.join(sources, 'source-map.json');
  const mapping = fs.existsSync(mappingFile) ? JSON.parse(fs.readFileSync(mappingFile, 'utf8')) : {};
  const args = [path.join(config.root, 'reels/factcheck.py'), file, '--json'];
  for (const [url, local] of Object.entries(mapping)) { normalizePublicWebUrl(url); args.push(`${url}=${within(local, sources)}`); }
  const claims = JSON.parse(await python(config, args, signal));
  if (claims.length < rows.length || claims.some(c => c.found !== true || !c.url || !c.quote)) throw fail('CARDS_FACTCHECK_FAILED');
  const licenseUrls=new Set(assetMetadata.filter(asset=>asset.kind==='photo').flatMap(asset=>(asset.usage_terms?.match(/https?:\/\/[^\s)<]+/g)||[])
    .map(raw=>{const url=raw.replace(/[.,;:]$/, '');normalizePublicWebUrl(url);return url;})));
  for (const line of section(text, '게시 캡션').split('\n')) for (const raw of line.match(/https?:\/\/[^\s)<]+/g)||[]) {
    const url=raw.replace(/[.,;:]$/, '');normalizePublicWebUrl(url);
    const photoLicense=/^\s*(이용\s*조건|라이선스|license)\s*:/iu.test(line)&&licenseUrls.has(url);
    if (!photoLicense && !claims.some(c => c.url === url)) throw fail('CARDS_CAPTION_SOURCE');
  }
  return claims;
}
function parseVisual(text) {
  const counts = /^MUST (\d+) \/ NICE (\d+)\s*$/m.exec(text);
  const status = /^판정:\s*(PASS|NEEDS_FIX|BLOCKED)\s*$/m.exec(text)?.[1];
  if (!counts || !status) throw fail('CARDS_VISUAL_FORMAT');
  const must = Number(counts[1]), nice = Number(counts[2]);
  if ((status === 'PASS') !== (must === 0) && status !== 'BLOCKED') throw fail('CARDS_VISUAL_CONTRADICTION');
  const mustIds = [...text.matchAll(/\bM\d+\b/g)].map(m => m[0]);
  if (new Set(mustIds).size !== must) throw fail('CARDS_VISUAL_COUNT');
  return { status, must, nice };
}
function snapshot(files) {
  return Object.fromEntries(files.map(file => [path.resolve(file), hash(fs.readFileSync(file))]));
}
function verifySnapshot(snap) {
  if (!snap || !Object.keys(snap).length) throw fail('CARDS_NO_SNAPSHOT');
  for (const [file, digest] of Object.entries(snap)) {
    if (!fs.existsSync(file) || hash(fs.readFileSync(file)) !== digest) throw fail('CARDS_ARTIFACT_CHANGED');
  }
}
async function produceCard(options) {
  return require('./integrated').produceIntegrated(options);
}

module.exports = { python, within, checkFacts, editorial, hash, manuscript, parseVisual, produceCard, section, snapshot, validateDeck, verifySnapshot };
