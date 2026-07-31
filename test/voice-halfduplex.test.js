'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');

function loadClient({ config = {}, responders = {} } = {}) {
  const calls = [];
  const phases = [];
  const toasts = [];
  const transcripts = [];
  const answers = [];
  const tracks = [{ enabled: true, stopped: false, stop() { this.stopped = true; } }];
  const timers = new Map();
  let nextTimer = 1;
  let recorder = null;
  const recorderEvents = [];
  const played = [];

  const fakeWindow = {
    setTimeout(fn, ms) {
      const id = nextTimer;
      nextTimer += 1;
      timers.set(id, { fn, ms });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    FormData,
    Blob,
    URL: { createObjectURL: () => 'blob:fake', revokeObjectURL: () => {} },
    Audio: class FakeAudio {
      constructor(url) {
        this.url = url;
        played.push(url);
        // 재생 완료를 즉시 통지해 SPEAKING 이후 전이를 검사한다.
        setImmediate(() => this.onended?.());
      }
      play() { return Promise.resolve(); }
      pause() {}
    },
    navigator: {
      mediaDevices: {
        async getUserMedia() {
          return { getAudioTracks: () => tracks, getTracks: () => tracks };
        },
      },
    },
    VoiceTurnRecorder: {
      create(options) {
        recorder = {
          options,
          async start() {},
          beginTurn(id) { recorderEvents.push(['begin', id]); return true; },
          endTurn(id) { recorderEvents.push(['end', id]); return true; },
          stop() { recorderEvents.push(['stop']); },
        };
        return recorder;
      },
    },
  };
  fakeWindow.navigator = fakeWindow.navigator;

  const context = {
    window: fakeWindow,
    setImmediate,
    console,
    JSON,
    Math,
    Date,
    Number,
    Object,
    String,
    Error,
    Promise,
    Array,
  };
  vm.runInNewContext(
    fs.readFileSync(path.join(ROOT, 'public/voice-halfduplex.js'), 'utf8'),
    context,
    { filename: 'voice-halfduplex.js' },
  );

  const client = fakeWindow.VoiceHalfDuplex;
  client.init({
    // 상태 전이 테스트는 시계를 돌리지 않으므로 최소 발화 길이를 끈다.
    // 그 규칙 자체는 아래 전용 테스트가 검사한다.
    config: { halfDuplexEnabled: true, noiseFrames: 2, minSpeechMs: 0, ...config },
    showToast: message => toasts.push(message),
    onPhase: phase => phases.push(phase),
    onTranscript: text => transcripts.push(text),
    onAnswer: text => answers.push(text),
    async apiFetch(url, options) {
      calls.push({ url, options });
      const responder = Object.entries(responders)
        .find(([pattern]) => url.includes(pattern))?.[1];
      if (responder) return responder(url, options);
      if (url.includes('/transcribe')) {
        return {
          ok: true,
          async json() {
            return { correctedTranscript: '내일 일정 알려줘', persistable: true };
          },
        };
      }
      if (url.includes('/api/chat')) {
        return { ok: true, async json() { return { reply: '오전 10시에 하나 있어.' }; } };
      }
      return { ok: true, async blob() { return new Blob(['RIFF']); } };
    },
  });

  // 잡음 바닥을 먼저 채워 문턱을 확정한다.
  const settleNoise = () => { client.__feedLevel(0.001); client.__feedLevel(0.001); };

  return {
    client, calls, phases, toasts, transcripts, answers, tracks,
    timers, recorderEvents, played, settleNoise,
    fireTimer(predicateMs) {
      for (const [id, entry] of timers) {
        if (entry.ms === predicateMs) {
          timers.delete(id);
          entry.fn();
          return true;
        }
      }
      return false;
    },
  };
}

const tick = () => new Promise(resolve => setImmediate(() => setImmediate(resolve)));

test('a full turn walks listening through speaking and returns to cooldown', async () => {
  const h = loadClient();
  await h.client.start();
  assert.equal(h.client.getState().phase, 'listening');

  h.settleNoise();
  h.client.__feedLevel(0.5);
  assert.equal(h.client.getState().phase, 'capturing');
  assert.deepEqual(h.recorderEvents.at(-1), ['begin', 'hd-1']);

  // 침묵이 임계값을 넘으면 캡처를 닫는다.
  h.client.__feedLevel(0.5);
  await new Promise(resolve => setTimeout(resolve, 5));
  h.fireTimer(120000);
  assert.equal(h.client.getState().phase, 'transcribing');
  // 마이크는 전사 시작과 함께 꺼진다.
  assert.equal(h.tracks[0].enabled, false);

  await h.client.__feedTurn({ turnId: 'hd-1', blob: new Blob(['x']), durationMs: 1500 });
  await tick();

  assert.deepEqual(h.transcripts, ['내일 일정 알려줘']);
  assert.deepEqual(h.answers, ['오전 10시에 하나 있어.']);
  assert.ok(h.phases.includes('thinking'));
  assert.ok(h.phases.includes('speaking'));
  assert.equal(h.played.length, 1);
  assert.equal(h.client.getState().phase, 'cooldown');
});

test('the chat call is tagged as voice and kept off shared-main', async () => {
  const h = loadClient();
  await h.client.start();
  h.settleNoise();
  h.client.__feedLevel(0.5);
  h.fireTimer(120000);
  await h.client.__feedTurn({ turnId: 'hd-1', blob: new Blob(['x']), durationMs: 1500 });
  await tick();

  const chat = h.calls.find(call => call.url === '/api/chat');
  const body = JSON.parse(chat.options.body);
  assert.equal(body.source, 'voice');
  assert.equal(body.sessionId, 'voice-halfduplex-scratch');
  assert.notEqual(body.sessionId, 'shared-main');
  assert.equal(body.message, '내일 일정 알려줘');
});

test('a turn the server marks unpersistable is dropped without a reply', async () => {
  const h = loadClient({
    responders: {
      '/transcribe': async () => ({
        ok: true,
        async json() { return { correctedTranscript: '음.', persistable: false }; },
      }),
    },
  });
  await h.client.start();
  h.settleNoise();
  h.client.__feedLevel(0.5);
  h.fireTimer(120000);
  await h.client.__feedTurn({ turnId: 'hd-1', blob: new Blob(['x']), durationMs: 1500 });
  await tick();

  // 헛기침이면 시온이 반응하지 않고 계속 듣는다.
  assert.equal(h.calls.filter(call => call.url === '/api/chat').length, 0);
  assert.deepEqual(h.transcripts, []);
  assert.equal(h.client.getState().phase, 'listening');
  assert.equal(h.tracks[0].enabled, true);
});

test('an empty transcription recovers to listening instead of locking the mic', async () => {
  const h = loadClient({
    responders: {
      '/transcribe': async () => ({
        ok: false,
        async json() { return { code: 'REALTIME_TRANSCRIPTION_EMPTY' }; },
      }),
    },
  });
  await h.client.start();
  h.settleNoise();
  h.client.__feedLevel(0.5);
  h.fireTimer(120000);
  await h.client.__feedTurn({ turnId: 'hd-1', blob: new Blob(['x']), durationMs: 1500 });
  await tick();

  assert.ok(h.toasts.some(message => message.includes('다시 말해줄래')));
  assert.equal(h.client.getState().phase, 'cooldown');
  h.fireTimer(500);
  assert.equal(h.client.getState().phase, 'listening');
  // 복구 뒤 마이크가 다시 열려야 대화가 이어진다.
  assert.equal(h.tracks[0].enabled, true);
});

test('an answer failure still returns the loop to listening', async () => {
  const h = loadClient({
    responders: {
      '/api/chat': async () => ({ ok: false, async json() { return { error: 'boom' }; } }),
    },
  });
  await h.client.start();
  h.settleNoise();
  h.client.__feedLevel(0.5);
  h.fireTimer(120000);
  await h.client.__feedTurn({ turnId: 'hd-1', blob: new Blob(['x']), durationMs: 1500 });
  await tick();

  assert.equal(h.client.getState().phase, 'cooldown');
  h.fireTimer(500);
  assert.equal(h.client.getState().phase, 'listening');
});

test('stopping releases the microphone and every timer', async () => {
  const h = loadClient();
  await h.client.start();
  h.settleNoise();
  h.client.__feedLevel(0.5);

  h.client.stop();

  assert.equal(h.client.getState().active, false);
  assert.equal(h.client.getState().phase, 'idle');
  assert.equal(h.tracks[0].stopped, true);
  assert.deepEqual(h.recorderEvents.at(-1), ['stop']);
  assert.equal(h.timers.size, 0);
});

test('a burst too short to be speech never reaches transcription', async () => {
  const h = loadClient({ config: { minSpeechMs: 300 } });
  await h.client.start();
  h.settleNoise();
  h.client.__feedLevel(0.5);
  // 발화 시작 직후 바로 닫히면 전사 요청을 아끼고 계속 듣는다.
  h.fireTimer(120000);

  assert.equal(h.calls.length, 0);
  assert.equal(h.client.getState().phase, 'listening');
  assert.equal(h.tracks[0].enabled, true);
});

test('the loop refuses to start while the flag is off', async () => {
  const h = loadClient({ config: { halfDuplexEnabled: false } });
  await h.client.start();

  assert.equal(h.client.getState().active, false);
  assert.equal(h.calls.length, 0);
  assert.ok(h.toasts.some(message => message.includes('꺼져')));
});
