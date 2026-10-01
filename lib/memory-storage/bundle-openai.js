'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const OpenAI = require('openai');
const { extractResponseText } = require('../openai-model-catalog');
const { canonicalJson } = require('./general-fact');
const { BUNDLE_SELECTION_SCHEMA, readPrivateEpisode, buildBundleSelectionRequest,
  discoverEvidenceBundles, writePrivateArtifact } = require('./bundle-builder');

function fail(code) { const error = new Error(code); error.code = code; throw error; }

function createOpenAIBundleSelector({ apiKey, fetch } = {}) {
  if (typeof apiKey !== 'string' || !apiKey.trim()) fail('OPENAI_API_KEY_REQUIRED');
  const client = new OpenAI({ apiKey, baseURL: 'https://api.openai.com/v1', maxRetries: 0, timeout: 60_000,
    ...(fetch ? { fetch } : {}) });
  return async request => {
    if (request?.promptVersion !== 'memory-evidence-bundle-selection-user-state-v1'
        || typeof request.instructions !== 'string' || !request.instructions.trim()
        || typeof request.input !== 'string' || !request.input.trim()) fail('INVALID_BUNDLE_REQUEST');
    let response;
    try {
      response = await client.responses.create({ model: 'gpt-6-luna',
        reasoning: { effort: 'medium', context: 'current_turn' }, max_output_tokens: 4096, store: false,
        instructions: request.instructions, input: request.input,
        text: { format: { type: 'json_schema', name: 'memory_evidence_bundles', strict: true, schema: BUNDLE_SELECTION_SCHEMA } },
      }, { maxRetries: 0 });
    } catch { fail('OPENAI_BUNDLE_CALL_FAILED'); }
    if (response?.status !== 'completed') fail('INCOMPLETE_BUNDLE_RESPONSE');
    if (response.output?.some(item => item.type === 'message' && item.content?.some(part => part.type === 'refusal'))) {
      fail('BUNDLE_SELECTION_REFUSAL');
    }
    const text = extractResponseText(response);
    if (!text) fail('EMPTY_BUNDLE_RESPONSE');
    try { return JSON.parse(text); } catch { fail('INVALID_BUNDLE_SELECTION'); }
  };
}

function configuredSelector() {
  const filename = path.resolve(__dirname, '../../.env');
  const env = { ...(fs.existsSync(filename) ? require('dotenv').parse(fs.readFileSync(filename)) : {}), ...process.env };
  if (env.OPENAI_BASE_URL?.trim()) fail('CUSTOM_OPENAI_ENDPOINT_UNSUPPORTED');
  return createOpenAIBundleSelector({ apiKey: env.OPENAI_API_KEY });
}

async function main(argv = process.argv.slice(2), selectBundles) {
  if (argv.length === 1 && argv[0] === '--help') return 'npm run build:memory-bundles -- --episode <private-dir>/episode.json --episode-sha256 <raw-sha256> --output <private-dir>/bundles.json\n원문 episode를 Luna에 한 번 보내 bundle을 제안해. 의미 완전성 검증·ambiguity·durability·추출·저장은 하지 않아.';
  if (argv.length !== 6 || ['--episode', '--episode-sha256', '--output']
    .some((key, i) => argv[i * 2] !== key || !argv[i * 2 + 1])) fail('INVALID_ARGUMENTS');
  const episode = readPrivateEpisode(argv[1], argv[3]);
  if (fs.existsSync(argv[5])) fail('BUNDLE_OUTPUT_ALREADY_EXISTS');
  const selector = selectBundles || configuredSelector();
  const request = buildBundleSelectionRequest(episode);
  // Durable before dispatch; an interrupted/failed attempt is never automatically repeated.
  writePrivateArtifact(`${argv[5]}.attempt.json`, { schemaVersion: 1, sourceEpisodeRawSha256: argv[3],
    requestSha256: createHash('sha256').update(canonicalJson(request)).digest('hex'),
    model: 'gpt-6-luna', maxRetries: 0, maximumDispatches: 1, status: 'DISPATCH_MAY_OCCUR' });
  let result;
  try { result = await discoverEvidenceBundles(episode, selector); }
  catch (error) {
    writePrivateArtifact(`${argv[5]}.failure.json`, { reason: error.code || 'BUNDLE_SELECTION_FAILED', noAutomaticRetry: true });
    throw error;
  }
  const artifactSha256 = writePrivateArtifact(argv[5], result);
  return { bundleCount: result.bundles.length, fragmentCounts: result.bundles.map(b => b.fragmentCount),
    artifactSha256, semanticCompleteness: result.semanticCompleteness, selectorAttempts: 1,
    storageCommits: 0 };
}

if (require.main === module) {
  main().then(result => console.log(typeof result === 'string' ? result : JSON.stringify(result)))
    .catch(error => { console.error(error.code || 'BUNDLE_BUILD_FAILED'); process.exitCode = 1; });
}

module.exports = { createOpenAIBundleSelector, main };
