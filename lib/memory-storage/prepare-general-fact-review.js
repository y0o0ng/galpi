'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { openDevelopmentDb } = require('./review-ui');
const { validateCandidate, createMemoryStorageRouter } = require('./router');
const { createMemoryEvidenceRegistry } = require('./evidence-registry');
const { createGeneralFactReviewHandler } = require('./general-fact-proposer');
const { createOpenAIGeneralFactProposer } = require('./general-fact-openai');

const ROOT = path.resolve(__dirname, '../..');
const HELP = 'npm run prepare:memory-general-fact -- --development-db /private/path/general-fact-development.db --candidate /private/path/accepted-candidate.json\n'
  + '이미 수용된 candidate와 원문 replay를 Luna에 한 번 보내 개발용 HUMAN 검토를 준비해. 사실 변경은 검토 화면에서 승인한 뒤에만 저장돼.';

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function readCandidate(filename) {
  const resolved = fs.realpathSync(filename);
  const stat = fs.statSync(resolved);
  const parent = fs.statSync(path.dirname(resolved));
  if (resolved.startsWith(`${fs.realpathSync(ROOT)}${path.sep}`) || resolved.startsWith('/home/pi/galpi/')
      || !stat.isFile() || stat.nlink !== 1 || (stat.mode & 0o777) !== 0o600
      || !parent.isDirectory() || (parent.mode & 0o777) !== 0o700
      || (process.getuid && (stat.uid !== process.getuid() || parent.uid !== process.getuid()))) {
    fail('PRIVATE_CANDIDATE_FILE_REQUIRED');
  }
  let candidate;
  try { candidate = JSON.parse(fs.readFileSync(resolved, 'utf8')); } catch { fail('INVALID_CANDIDATE_JSON'); }
  validateCandidate(candidate);
  return candidate;
}

function configuredProposer() {
  const envFile = path.join(ROOT, '.env');
  const env = { ...(fs.existsSync(envFile) ? require('dotenv').parse(fs.readFileSync(envFile)) : {}), ...process.env };
  if (env.OPENAI_BASE_URL?.trim()) fail('CUSTOM_OPENAI_ENDPOINT_UNSUPPORTED');
  if (!env.OPENAI_API_KEY?.trim()) fail('OPENAI_API_KEY_REQUIRED');
  return createOpenAIGeneralFactProposer({ apiKey: env.OPENAI_API_KEY });
}

async function main(argv = process.argv.slice(2), proposeTransition) {
  if (argv.length === 1 && argv[0] === '--help') return HELP;
  if (argv.length !== 4 || argv[0] !== '--development-db' || !argv[1]
      || argv[2] !== '--candidate' || !argv[3]) fail('INVALID_ARGUMENTS');
  const candidate = readCandidate(argv[3]);
  const db = openDevelopmentDb(argv[1]);
  try {
    const evidenceRegistry = createMemoryEvidenceRegistry(db);
    const handler = createGeneralFactReviewHandler({ db, evidenceRegistry,
      proposeTransition: proposeTransition || configuredProposer() });
    const route = createMemoryStorageRouter({ evidenceRegistry, transitionHandlers: new Map([['general_fact', handler]]) });
    const result = await route(candidate);
    // CLI output contains only identifiers/status; source, payload and rationale remain private.
    return { status: result.status, candidateId: result.candidateId,
      ...(result.reason ? { reason: result.reason } : {}),
      ...(result.review ? { reviewId: result.review.reviewId, packageSha256: result.review.packageSha256 } : {}),
      ...(result.transitionId ? { transitionId: result.transitionId } : {}) };
  } finally { db.close(); }
}

if (require.main === module) {
  main().then(result => console.log(typeof result === 'string' ? result : JSON.stringify(result)))
    .catch(error => {
      console.error(/^[A-Z][A-Z0-9_]{0,79}$/.test(error.code || '') ? error.code : 'PREPARE_REVIEW_FAILED');
      process.exitCode = 1;
    });
}

module.exports = { main, configuredProposer };
