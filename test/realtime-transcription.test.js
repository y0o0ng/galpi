'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createOpenAITranscriptionProvider,
  createRealtimeTranscriptionService,
  inspectPcmWav,
} = require('../lib/realtime-transcription');

function pcmWav({
  seconds = 1,
  sampleRate = 16000,
  amplitude = 0.2,
} = {}) {
  const samples = Math.round(seconds * sampleRate);
  const buffer = Buffer.alloc(44 + (samples * 2));
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + (samples * 2), 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(samples * 2, 40);
  for (let index = 0; index < samples; index += 1) {
    buffer.writeInt16LE(Math.round(Math.sin(index / 20) * amplitude * 0x7fff), 44 + (index * 2));
  }
  return buffer;
}

test('PCM WAV inspection derives duration from bytes and rejects non-PCM input', () => {
  assert.deepEqual(inspectPcmWav(pcmWav({ seconds: 1.25 })), {
    durationMs: 1250,
    sampleRate: 16000,
    dataBytes: 40000,
  });
  assert.throws(
    () => inspectPcmWav(Buffer.from('not a wav')),
    error => error.code === 'REALTIME_AUDIO_INVALID' && error.status === 400,
  );
});

test('OpenAI transcription provider sends bounded WAV with server-owned model and language hints', async () => {
  let request;
  const provider = createOpenAITranscriptionProvider({
    apiKey: 'server-only-key',
    baseUrl: 'https://provider.test/v1',
    model: 'gpt-transcribe',
    fetchImpl: async (url, options) => {
      request = { url, options };
      return new Response(JSON.stringify({
        text: '보정된 한국어와 English 문장',
        usage: {
          input_tokens: 20,
          input_token_details: { audio_tokens: 20 },
          output_tokens: 8,
          unsafe_text: '버려야 함',
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  });

  const result = await provider({
    audio: pcmWav(),
    mimeType: 'audio/wav',
  });
  assert.equal(request.url, 'https://provider.test/v1/audio/transcriptions');
  assert.equal(request.options.headers.Authorization, 'Bearer server-only-key');
  assert.equal(request.options.body.get('model'), 'gpt-transcribe');
  assert.deepEqual(request.options.body.getAll('languages[]'), ['ko', 'en']);
  assert.equal(request.options.body.get('file').type, 'audio/wav');
  assert.equal(result.correctedTranscript, '보정된 한국어와 English 문장');
  assert.deepEqual(result.usage, {
    input_tokens: 20,
    input_token_details: { audio_tokens: 20 },
    output_tokens: 8,
  });
});

test('OpenAI transcription provider aborts a slow request at the bounded timeout', async () => {
  const provider = createOpenAITranscriptionProvider({
    apiKey: 'server-only-key',
    timeoutMs: 5,
    fetchImpl: async (url, options) => new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      });
    }),
  });
  await assert.rejects(
    provider({ audio: pcmWav(), mimeType: 'audio/wav' }),
    error => error.code === 'REALTIME_TRANSCRIPTION_TIMEOUT' && error.status === 504,
  );
});

test('Realtime correction is session-bound, serialized, idempotent, and bounded to three pending turns', async () => {
  const releases = [];
  const calls = [];
  const service = createRealtimeTranscriptionService({
    enabled: true,
    transcribeAudio: ({ inputItemId }) => new Promise(resolve => {
      calls.push(inputItemId);
      releases.push(() => resolve({
        correctedTranscript: `보정 ${inputItemId}`,
        model: 'gpt-transcribe',
        usage: { total_tokens: 3 },
      }));
    }),
  });
  const sessionId = service.createSession();
  assert.match(sessionId, /^[A-Za-z0-9_-]+$/);
  const audioOne = pcmWav({ amplitude: 0.1 });
  const audioTwo = pcmWav({ amplitude: 0.2 });
  const audioThree = pcmWav({ amplitude: 0.3 });

  const first = service.transcribe({
    sessionId,
    turnId: '1',
    inputItemId: 'input-1',
    audio: audioOne,
    mimeType: 'audio/wav',
    claimedDurationMs: 1000,
  });
  const duplicate = service.transcribe({
    sessionId,
    turnId: '1',
    inputItemId: 'input-1',
    audio: audioOne,
    mimeType: 'audio/wav',
    claimedDurationMs: 1000,
  });
  const second = service.transcribe({
    sessionId,
    turnId: '2',
    inputItemId: 'input-2',
    audio: audioTwo,
    mimeType: 'audio/wav',
    claimedDurationMs: 1000,
  });
  const third = service.transcribe({
    sessionId,
    turnId: '3',
    inputItemId: 'input-3',
    audio: audioThree,
    mimeType: 'audio/wav',
    claimedDurationMs: 1000,
  });

  await assert.rejects(
    service.transcribe({
      sessionId,
      turnId: '4',
      inputItemId: 'input-4',
      audio: pcmWav({ amplitude: 0.4 }),
      mimeType: 'audio/wav',
    }),
    error => error.code === 'REALTIME_TRANSCRIPTION_BACKLOG' && error.status === 429,
  );
  await assert.rejects(
    service.transcribe({
      sessionId,
      turnId: '1',
      inputItemId: 'input-1',
      audio: pcmWav({ amplitude: 0.9 }),
      mimeType: 'audio/wav',
    }),
    error => error.code === 'REALTIME_TRANSCRIPTION_CONFLICT' && error.status === 409,
  );

  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, ['input-1']);
  releases.shift()();
  const firstResult = await first;
  assert.deepEqual({
    ...firstResult,
    audioSha256: '<hash>',
  }, {
    correctedTranscript: '보정 input-1',
    model: 'gpt-transcribe',
    usage: { total_tokens: 3 },
    durationMs: 1000,
    audioSha256: '<hash>',
    duplicate: false,
  });
  assert.match(firstResult.audioSha256, /^[a-f0-9]{64}$/);
  assert.equal((await duplicate).duplicate, true);

  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, ['input-1', 'input-2']);
  releases.shift()();
  await second;
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, ['input-1', 'input-2', 'input-3']);
  releases.shift()();
  await third;
});

test('Realtime correction rejects expired sessions, unsafe IDs, formats, durations, and size mismatches', async () => {
  let clock = 100;
  const service = createRealtimeTranscriptionService({
    enabled: true,
    transcribeAudio: async () => ({ correctedTranscript: 'ok' }),
    sessionTtlMs: 1000,
    maxAudioBytes: 100000,
    maxDurationMs: 2000,
    now: () => clock,
  });
  const sessionId = service.createSession();
  const audio = pcmWav();

  await assert.rejects(
    service.transcribe({
      sessionId,
      turnId: '../1',
      inputItemId: 'input-1',
      audio,
      mimeType: 'audio/wav',
    }),
    error => error.code === 'REALTIME_TRANSCRIPTION_ID_INVALID',
  );
  await assert.rejects(
    service.transcribe({
      sessionId,
      turnId: '1',
      inputItemId: 'input-1',
      audio,
      mimeType: 'audio/webm',
    }),
    error => error.code === 'REALTIME_AUDIO_FORMAT_UNSUPPORTED',
  );
  await assert.rejects(
    service.transcribe({
      sessionId,
      turnId: '1',
      inputItemId: 'input-1',
      audio,
      mimeType: 'audio/wav',
      claimedDurationMs: 9000,
    }),
    error => error.code === 'REALTIME_AUDIO_DURATION_MISMATCH',
  );
  clock = 1200;
  await assert.rejects(
    service.transcribe({
      sessionId,
      turnId: '1',
      inputItemId: 'input-1',
      audio,
      mimeType: 'audio/wav',
    }),
    error => error.code === 'REALTIME_TRANSCRIPTION_SESSION_EXPIRED' && error.status === 410,
  );
});

test('disabled Realtime correction exposes no model session and fails closed', async () => {
  const service = createRealtimeTranscriptionService({
    enabled: false,
    apiKey: 'unused-key',
  });
  assert.deepEqual(service.publicConfig(), {
    correctionEnabled: false,
    canonicalTranscriptionModel: '',
    maxTurnSeconds: 120,
    maxTurnBytes: 8388608,
  });
  assert.equal(service.createSession(), '');
  await assert.rejects(
    service.transcribe({}),
    error => error.code === 'REALTIME_TRANSCRIPTION_DISABLED' && error.status === 503,
  );
});
