'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const {
  RealtimeSessionError,
  buildRealtimeSessionConfig,
  createRealtimeSessionService,
  validateSdpOffer,
} = require('../lib/realtime-session');

const ROOT = path.resolve(__dirname, '..');

test('Realtime session config is server-owned, tool-free, and enables streaming transcripts with interruption', () => {
  const config = buildRealtimeSessionConfig({
    model: 'gpt-realtime-2.1-mini',
    voice: 'marin',
    transcriptionModel: 'gpt-4o-mini-transcribe',
  });

  assert.equal(config.type, 'realtime');
  assert.equal(config.model, 'gpt-realtime-2.1-mini');
  assert.deepEqual(config.output_modalities, ['audio']);
  assert.deepEqual(config.tools, []);
  assert.equal(config.tool_choice, 'none');
  assert.equal(config.audio.output.voice, 'marin');
  assert.deepEqual(config.audio.input.transcription, {
    model: 'gpt-4o-mini-transcribe',
    language: 'ko',
  });
  assert.deepEqual(config.audio.input.turn_detection, {
    type: 'semantic_vad',
    eagerness: 'auto',
    create_response: true,
    interrupt_response: true,
  });
  assert.match(config.instructions, /어떤 데이터도 저장하지 않는다/);
});

test('Realtime unified call sends SDP and session config upstream without returning the API key', async () => {
  let request;
  const service = createRealtimeSessionService({
    enabled: true,
    apiKey: 'server-secret-key',
    baseUrl: 'https://provider.test/v1/',
    model: 'gpt-realtime-2.1-mini',
    fetchImpl: async (url, options) => {
      request = { url, options };
      return new Response('v=0\r\no=answer\r\n', {
        status: 201,
        headers: { 'Content-Type': 'application/sdp' },
      });
    },
  });

  const result = await service.createCall('v=0\r\no=offer\r\n', {
    safetyIdentifier: 'a'.repeat(64),
  });
  assert.equal(request.url, 'https://provider.test/v1/realtime/calls');
  assert.equal(request.options.method, 'POST');
  assert.equal(request.options.headers.Authorization, 'Bearer server-secret-key');
  assert.equal(request.options.headers['OpenAI-Safety-Identifier'], 'a'.repeat(64));
  assert.equal(request.options.body.get('sdp'), 'v=0\r\no=offer\r\n');
  const upstreamConfig = JSON.parse(request.options.body.get('session'));
  assert.equal(upstreamConfig.model, 'gpt-realtime-2.1-mini');
  assert.equal(upstreamConfig.tools.length, 0);
  assert.equal(result.sdp, 'v=0\r\no=answer\r\n');
  assert.doesNotMatch(JSON.stringify(result), /server-secret-key/);
  assert.deepEqual(service.publicConfig(), {
    enabled: true,
    model: 'gpt-realtime-2.1-mini',
    voice: 'marin',
    maxSessionSeconds: 300,
  });
});

test('Realtime service fails closed when disabled or given malformed SDP', async () => {
  const disabled = createRealtimeSessionService({
    enabled: false,
    apiKey: 'key',
  });
  await assert.rejects(
    disabled.createCall('v=0\r\n'),
    error => error instanceof RealtimeSessionError
      && error.code === 'REALTIME_DISABLED'
      && error.status === 503,
  );
  assert.throws(
    () => validateSdpOffer('not-sdp'),
    error => error.code === 'INVALID_SDP' && error.status === 400,
  );
});

test('Realtime service keeps upstream validation details internal', async () => {
  const service = createRealtimeSessionService({
    enabled: true,
    apiKey: 'server-secret-key',
    fetchImpl: async () => new Response(JSON.stringify({
      error: {
        type: 'invalid_request_error',
        code: 'invalid_value',
        param: 'session.audio.input.transcription.model',
      },
    }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    }),
  });

  await assert.rejects(
    service.createCall('v=0\r\n'),
    error => error.code === 'REALTIME_UPSTREAM_REJECTED'
      && error.status === 502
      && error.upstreamStatus === 400
      && error.upstreamCode === 'invalid_value'
      && error.upstreamParam === 'session.audio.input.transcription.model'
      && !error.message.includes('server-secret-key'),
  );
});

function fakeClassList() {
  const values = new Set();
  return {
    add(...items) { items.forEach(item => values.add(item)); },
    remove(...items) { items.forEach(item => values.delete(item)); },
    contains(item) { return values.has(item); },
  };
}

function fakeElement() {
  const listeners = new Map();
  return {
    hidden: false,
    disabled: false,
    textContent: '',
    srcObject: null,
    dataset: {},
    className: '',
    classList: fakeClassList(),
    children: [],
    scrollTop: 0,
    scrollHeight: 0,
    attributes: new Map(),
    addEventListener(type, listener) { listeners.set(type, listener); },
    dispatch(type, event = {}) { return listeners.get(type)?.(event); },
    setAttribute(name, value) { this.attributes.set(name, String(value)); },
    append(...children) {
      this.children.push(...children);
      this.scrollHeight = this.children.length;
    },
    appendChild(child) {
      this.append(child);
      return child;
    },
    replaceChildren(...children) {
      this.children = children;
      this.scrollHeight = children.length;
    },
    pause() {},
    async play() {},
  };
}

test('voice client performs one WebRTC handshake and stops every media resource', async () => {
  const ids = [
    'voice-realtime-button',
    'voice-realtime-panel',
    'voice-realtime-status',
    'voice-realtime-model',
    'voice-realtime-timer',
    'voice-realtime-transcript',
    'voice-realtime-error',
    'voice-realtime-mute',
    'voice-realtime-stop',
    'voice-realtime-audio',
  ];
  const elements = Object.fromEntries(ids.map(id => [id, fakeElement()]));
  const localTrack = { enabled: true, stopped: false, stop() { this.stopped = true; } };
  const localStream = {
    getTracks: () => [localTrack],
    getAudioTracks: () => [localTrack],
  };
  let peerClosed = false;
  let channel;
  class FakePeerConnection {
    constructor() {
      this.connectionState = 'new';
      this.senders = [];
    }
    addTrack(track) { this.senders.push({ track }); }
    createDataChannel(name) {
      assert.equal(name, 'oai-events');
      const listeners = new Map();
      channel = {
        addEventListener(type, listener) { listeners.set(type, listener); },
        emit(type, event = {}) { listeners.get(type)?.(event); },
        close() {},
      };
      return channel;
    }
    async createOffer() { return { type: 'offer', sdp: 'v=0\r\no=browser\r\n' }; }
    async setLocalDescription() {}
    async setRemoteDescription(answer) {
      assert.equal(answer.type, 'answer');
      channel.emit('open');
    }
    getSenders() { return this.senders; }
    getReceivers() { return []; }
    close() { peerClosed = true; this.connectionState = 'closed'; }
  }

  const windowListeners = new Map();
  const fakeWindow = {
    isSecureContext: true,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    addEventListener(type, listener) { windowListeners.set(type, listener); },
  };
  const context = {
    window: fakeWindow,
    document: {
      getElementById(id) { return elements[id] || null; },
      createElement: fakeElement,
    },
    navigator: {
      mediaDevices: {
        async getUserMedia() { return localStream; },
      },
    },
    RTCPeerConnection: FakePeerConnection,
    MediaStream: class MediaStream {},
    console,
    Date,
    Error,
    JSON,
    Number,
    Object,
    Set,
    Map,
    String,
  };
  vm.runInNewContext(
    fs.readFileSync(path.join(ROOT, 'public/voice-realtime.js'), 'utf8'),
    context,
    { filename: 'voice-realtime.js' },
  );

  let request;
  fakeWindow.VoiceRealtime.init({
    config: {
      enabled: true,
      model: 'gpt-realtime-2.1-mini',
      voice: 'marin',
      maxSessionSeconds: 300,
    },
    showToast() {},
    async apiFetch(url, options) {
      request = { url, options };
      return {
        ok: true,
        headers: { get: () => 'application/sdp' },
        async text() { return 'v=0\r\no=provider\r\n'; },
      };
    },
  });
  assert.equal(elements['voice-realtime-button'].hidden, false);

  await fakeWindow.VoiceRealtime.start();
  assert.equal(request.url, '/api/voice/realtime/session');
  assert.equal(request.options.headers['Content-Type'], 'application/sdp');
  assert.equal(request.options.body, 'v=0\r\no=browser\r\n');
  assert.deepEqual(
    JSON.parse(JSON.stringify(fakeWindow.VoiceRealtime.getState())),
    { phase: 'listening', muted: false, active: true },
  );

  fakeWindow.VoiceRealtime.stop();
  assert.equal(localTrack.stopped, true);
  assert.equal(peerClosed, true);
  assert.deepEqual(
    JSON.parse(JSON.stringify(fakeWindow.VoiceRealtime.getState())),
    { phase: 'idle', muted: false, active: false },
  );
  assert.ok(windowListeners.has('pagehide'));
  assert.ok(windowListeners.has('beforeunload'));
});

test('voice UI loads before app.js and the server config exposes only public Realtime fields', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
  const app = fs.readFileSync(path.join(ROOT, 'public/app.js'), 'utf8');
  const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

  assert.match(html, /id="voice-realtime-button"[^>]*aria-pressed="false"[^>]*hidden/);
  assert.match(html, /AI 생성 음성 · 저장 안 함/);
  assert.ok(
    html.indexOf('<script src="voice-realtime.js"></script>')
      < html.indexOf('<script src="app.js"></script>'),
  );
  assert.match(app, /VoiceRealtime\?\.init\(\{[\s\S]*config: config\.realtimeVoice/);
  assert.match(server, /realtimeVoice: realtimeSessions\.publicConfig\(\)/);
  assert.doesNotMatch(server, /realtimeVoice:\s*\{[^}]*apiKey/s);
});
