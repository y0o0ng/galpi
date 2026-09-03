'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const { registerVoiceHalfDuplexRoutes } = require('../lib/voice/halfduplex-routes');
const { createVoiceTranscriptionService } = require('../lib/voice/transcription');

function pcmWav(seconds = 1) {
  const samples = Math.round(seconds * 16000);
  const buffer = Buffer.alloc(44 + (samples * 2));
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + (samples * 2), 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(16000, 24);
  buffer.writeUInt32LE(32000, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(samples * 2, 40);
  return buffer;
}

async function startApp({ voiceTts, voiceTranscriptions }) {
  const app = express();
  app.use(express.json());
  registerVoiceHalfDuplexRoutes({ app, voiceTts, voiceTranscriptions });
  const server = await new Promise(resolve => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise(resolve => server.close(resolve)),
  };
}

function tts(overrides = {}) {
  return {
    available: true,
    planSpokenSegments: text => ({ segments: [text], remaining: '' }),
    planContinuedSegments: text => ({ segments: [`계속:${text}`], remaining: '' }),
    speak: async text => ({ spoken: text, audio: Buffer.from('RIFF-wave') }),
    ...overrides,
  };
}

function transcription(transcribeAudio, options = {}) {
  return createVoiceTranscriptionService({
    enabled: true,
    transcribeAudio,
    ...options,
  });
}

function upload(sessionId, inputItemId, audio = pcmWav()) {
  const form = new FormData();
  form.set('session_id', sessionId);
  form.set('input_item_id', inputItemId);
  form.set('duration_ms', '1000');
  form.set('audio', new Blob([audio], { type: 'audio/wav' }), 'turn.wav');
  return form;
}

test('session route fails closed when disabled and creates no-store sessions when enabled', async t => {
  const disabled = await startApp({
    voiceTts: tts({ available: false }),
    voiceTranscriptions: { createSession: () => { throw new Error('must not run'); } },
  });
  t.after(disabled.close);
  let response = await fetch(`${disabled.baseUrl}/api/voice/session`, { method: 'POST' });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, 'VOICE_HALFDUPLEX_DISABLED');

  const service = transcription(async () => ({ correctedTranscript: '안녕' }));
  const enabled = await startApp({ voiceTts: tts(), voiceTranscriptions: service });
  t.after(enabled.close);
  response = await fetch(`${enabled.baseUrl}/api/voice/session`, { method: 'POST' });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.match((await response.json()).sessionId, /^[A-Za-z0-9_-]+$/);
});

test('transcription route reports persistability without returning or writing audio', async t => {
  const transcripts = ['오늘 일정 알려줘', '음'];
  const service = transcription(async ({ audio }) => {
    assert.ok(Buffer.isBuffer(audio));
    return { correctedTranscript: transcripts.shift() };
  });
  const app = await startApp({ voiceTts: tts(), voiceTranscriptions: service });
  t.after(app.close);
  const sessionId = service.createSession();

  for (const [index, persistable] of [true, false].entries()) {
    const response = await fetch(`${app.baseUrl}/api/voice/turns/${index + 1}/transcribe`, {
      method: 'POST',
      body: upload(sessionId, `item-${index + 1}`),
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const body = await response.json();
    assert.equal(body.persistable, persistable);
    assert.equal('audio' in body, false);
    assert.equal('audioSha256' in body, false);
  }
});

test('transcription route preserves expiry, empty-result, and upload error codes', async t => {
  let now = 0;
  const expiredService = transcription(async () => ({ correctedTranscript: '안녕' }), {
    now: () => now,
    sessionTtlMs: 10,
  });
  const expiredApp = await startApp({ voiceTts: tts(), voiceTranscriptions: expiredService });
  t.after(expiredApp.close);
  const expiredId = expiredService.createSession();
  now = 11;
  let response = await fetch(`${expiredApp.baseUrl}/api/voice/turns/1/transcribe`, {
    method: 'POST', body: upload(expiredId, 'item-expired'),
  });
  assert.equal(response.status, 410);
  assert.equal((await response.json()).code, 'REALTIME_TRANSCRIPTION_SESSION_EXPIRED');

  const emptyService = transcription(async () => ({ correctedTranscript: '' }));
  const emptyApp = await startApp({ voiceTts: tts(), voiceTranscriptions: emptyService });
  t.after(emptyApp.close);
  response = await fetch(`${emptyApp.baseUrl}/api/voice/turns/1/transcribe`, {
    method: 'POST', body: upload(emptyService.createSession(), 'item-empty'),
  });
  assert.equal(response.status, 422);
  assert.equal((await response.json()).code, 'REALTIME_TRANSCRIPTION_EMPTY');

  response = await fetch(`${emptyApp.baseUrl}/api/voice/turns/1/transcribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  assert.equal(response.status, 415);
  assert.equal((await response.json()).code, 'REALTIME_MULTIPART_REQUIRED');

  response = await fetch(`${emptyApp.baseUrl}/api/voice/turns/1/transcribe`, {
    method: 'POST',
    body: upload(emptyService.createSession(), 'item-large', Buffer.alloc((8 * 1024 * 1024) + 1)),
  });
  assert.equal(response.status, 413);
  assert.equal((await response.json()).code, 'REALTIME_AUDIO_TOO_LARGE');
});

test('segment routes preserve ordinary, continued, empty, and disabled behavior', async t => {
  const app = await startApp({ voiceTts: tts(), voiceTranscriptions: {} });
  t.after(app.close);
  let response = await fetch(`${app.baseUrl}/api/voice/speak/segments`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: '하나' }),
  });
  assert.deepEqual(await response.json(), { segments: ['하나'], remaining: '' });
  assert.equal(response.headers.get('cache-control'), 'no-store');

  response = await fetch(`${app.baseUrl}/api/voice/speak/segments`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: '둘', continued: true }),
  });
  assert.deepEqual(await response.json(), { segments: ['계속:둘'], remaining: '' });

  response = await fetch(`${app.baseUrl}/api/voice/speak/segments`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: ' ' }),
  });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).code, 'VOICE_TTS_EMPTY_TEXT');

  const disabled = await startApp({ voiceTts: tts({ available: false }), voiceTranscriptions: {} });
  t.after(disabled.close);
  response = await fetch(`${disabled.baseUrl}/api/voice/speak/segments`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: '셋' }),
  });
  assert.equal(response.status, 503);
});

test('speak route returns WAV metadata and sanitizes failures', async t => {
  const app = await startApp({ voiceTts: tts(), voiceTranscriptions: {} });
  t.after(app.close);
  let response = await fetch(`${app.baseUrl}/api/voice/speak`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: '안녕' }),
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /^audio\/wav/);
  assert.equal(response.headers.get('x-galpi-spoken-chars'), '2');
  assert.equal(response.headers.get('cache-control'), 'no-store');

  response = await fetch(`${app.baseUrl}/api/voice/speak`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: '' }),
  });
  assert.equal(response.status, 400);

  const failed = await startApp({
    voiceTts: tts({ speak: async () => { throw Object.assign(new Error('secret upstream body'), { status: 502 }); } }),
    voiceTranscriptions: {},
  });
  t.after(failed.close);
  response = await fetch(`${failed.baseUrl}/api/voice/speak`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: '실패' }),
  });
  assert.equal(response.status, 502);
  const body = await response.json();
  assert.equal(body.code, 'VOICE_TTS_FAILED');
  assert.equal(JSON.stringify(body).includes('secret upstream body'), false);
});
