'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DEFAULT_MAX_CHARS,
  createVoiceTtsService,
  selectSpokenText,
} = require('../lib/voice-tts');

test('a short answer is spoken whole and an empty one produces nothing', () => {
  assert.equal(selectSpokenText('오후 3시야.'), '오후 3시야.');
  assert.equal(selectSpokenText('   '), '');
  assert.equal(selectSpokenText(null), '');
});

test('a long answer is cut at a sentence boundary and points at the screen', () => {
  const long = '첫 문장이야. 두 번째 문장이야. 세 번째 문장이야. 네 번째는 읽히면 안 돼.';
  const spoken = selectSpokenText(long, { maxChars: 40 });

  assert.ok(spoken.startsWith('첫 문장이야.'));
  assert.doesNotMatch(spoken, /네 번째/);
  assert.match(spoken, /화면에 정리해뒀어\.$/);
});

test('the spoken cap is enforced in code rather than left to the prompt', () => {
  // 상한을 넘겨도 원문 길이가 그대로 흘러가지 않는다.
  const runaway = '가'.repeat(5000);
  const spoken = selectSpokenText(runaway);
  assert.ok(spoken.length < runaway.length);
  assert.ok(spoken.length <= DEFAULT_MAX_CHARS + 40);
});

test('the service fails closed while the flag is off and exposes no model', () => {
  const service = createVoiceTtsService({ enabled: false, apiKey: 'k' });

  assert.equal(service.available, false);
  assert.deepEqual(service.publicConfig(), {
    halfDuplexEnabled: false,
    ttsModel: null,
    ttsVoice: null,
    maxSpokenChars: DEFAULT_MAX_CHARS,
  });
  return assert.rejects(() => service.speak('안녕'), error => {
    assert.equal(error.code, 'VOICE_TTS_UNAVAILABLE');
    return true;
  });
});

test('the enabled service sends the trimmed text and never leaks the key downstream', async () => {
  const requests = [];
  const service = createVoiceTtsService({
    enabled: true,
    apiKey: 'server-only-key',
    baseUrl: 'http://provider.invalid/v1/',
    model: 'gpt-4o-mini-tts',
    voice: 'alloy',
    maxChars: 30,
    async fetchImpl(url, options) {
      requests.push({ url, body: JSON.parse(options.body), auth: options.headers.Authorization });
      return { ok: true, body: (async function* () { yield Buffer.from('RIFF'); })() };
    },
  });

  const long = '첫 문장이야. 두 번째 문장이야. 세 번째 문장은 잘려야 해.';
  const { spoken, body } = await service.speak(long);

  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'http://provider.invalid/v1/audio/speech');
  assert.equal(requests[0].body.model, 'gpt-4o-mini-tts');
  assert.equal(requests[0].body.response_format, 'wav');
  // 잘라낸 문장만 provider로 간다. 전체 답변을 보내지 않는다.
  assert.equal(requests[0].body.input, spoken);
  assert.doesNotMatch(spoken, /세 번째/);
  assert.ok(spoken.length <= 30 + 40);
  assert.doesNotMatch(JSON.stringify(requests[0].body), /server-only-key/);

  const chunks = [];
  for await (const chunk of body) chunks.push(chunk);
  assert.equal(Buffer.concat(chunks).toString(), 'RIFF');
});

test('an upstream rejection surfaces a bounded code without the answer text', async () => {
  const service = createVoiceTtsService({
    enabled: true,
    apiKey: 'k',
    async fetchImpl() { return { ok: false, status: 429, async text() { return '비밀 본문'; } }; },
  });

  await assert.rejects(() => service.speak('사용자 발화가 섞이면 안 된다'), error => {
    assert.equal(error.code, 'VOICE_TTS_UPSTREAM_REJECTED');
    assert.doesNotMatch(error.message, /사용자 발화|비밀 본문/);
    return true;
  });
});
