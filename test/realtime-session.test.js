'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const {
  RealtimeSessionError,
  buildRealtimeConversationContext,
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
  assert.deepEqual(config.audio.input.noise_reduction, {
    type: 'near_field',
  });
  assert.deepEqual(config.audio.input.turn_detection, {
    type: 'semantic_vad',
    eagerness: 'auto',
    create_response: true,
    interrupt_response: true,
  });
  assert.equal(config.max_output_tokens, 4096);
  assert.match(config.instructions, /어떤 데이터도 저장하지 않는다/);
  assert.match(config.instructions, /마지막 문장을 완결/);
});

test('Realtime conversation context keeps only voice preferences and three completed recent pairs', () => {
  const context = buildRealtimeConversationContext({
    currentTimeLine: '[현재 시각: 2026-07-30 22:10 KST]',
    memoryItems: [
      '대답은 친구처럼 편하게 반말로 해줘',
      '설명은 결론부터 간결하게 해줘',
      '좋아하는 음식은 냉면',
    ],
    recentMessages: [
      { role: 'user', content: '오래된 질문' },
      { role: 'assistant', content: '오래된 답변' },
      { role: 'user', content: '첫 번째 최근 질문' },
      { role: 'assistant', content: '첫 번째 최근 답변' },
      { role: 'user', content: '두 번째 최근 질문' },
      { role: 'assistant', content: '두 번째 최근 답변' },
      { role: 'user', content: '세 번째 최근 질문' },
      { role: 'assistant', content: '세 번째 최근 답변' },
      { role: 'user', content: '아직 답이 없는 질문' },
    ],
  });

  assert.match(context, /현재 시각: 2026-07-30 22:10 KST/);
  assert.match(context, /친구처럼 편하게 반말/);
  assert.match(context, /결론부터 간결하게/);
  assert.doesNotMatch(context, /좋아하는 음식은 냉면/);
  assert.doesNotMatch(context, /오래된 질문/);
  assert.match(context, /첫 번째 최근 질문/);
  assert.match(context, /세 번째 최근 답변/);
  assert.doesNotMatch(context, /아직 답이 없는 질문/);
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
    sessionContext: '<user_voice_profile>\n- 친구처럼 반말\n</user_voice_profile>',
  });
  assert.equal(request.url, 'https://provider.test/v1/realtime/calls');
  assert.equal(request.options.method, 'POST');
  assert.equal(request.options.headers.Authorization, 'Bearer server-secret-key');
  assert.equal(request.options.headers['OpenAI-Safety-Identifier'], 'a'.repeat(64));
  assert.equal(request.options.body.get('sdp'), 'v=0\r\no=offer\r\n');
  const upstreamConfig = JSON.parse(request.options.body.get('session'));
  assert.equal(upstreamConfig.model, 'gpt-realtime-2.1-mini');
  assert.equal(upstreamConfig.tools.length, 0);
  assert.match(upstreamConfig.instructions, /친구처럼 반말/);
  assert.match(upstreamConfig.instructions, /이전 대화와 사용자 선호를 잇기 위한 데이터/);
  assert.equal(result.sdp, 'v=0\r\no=answer\r\n');
  assert.doesNotMatch(JSON.stringify(result), /server-secret-key/);
  assert.deepEqual(service.publicConfig(), {
    enabled: true,
    model: 'gpt-realtime-2.1-mini',
    voice: 'cedar',
    maxSessionSeconds: 300,
    maxOutputTokens: 4096,
    readToolsEnabled: false,
  });
});

test('Realtime session config enables only injected read tools', () => {
  const tools = [{
    type: 'function',
    name: 'schedule_read',
    description: '활성 일정 읽기',
    parameters: { type: 'object', properties: {} },
  }];
  const config = buildRealtimeSessionConfig({ tools });
  assert.equal(config.tools, tools);
  assert.equal(config.tool_choice, 'auto');
  assert.match(config.instructions, /조회 전용/);
  assert.match(config.instructions, /galpi_current_time/);
  assert.match(config.instructions, /어떤 데이터도 저장하지 않는다/);
  assert.doesNotMatch(config.instructions, /도구를 사용할 수 없고/);
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

test('voice client reconciles turn events, performs one handshake, and stops every media resource', async () => {
  const ids = [
    'voice-realtime-button',
    'voice-realtime-panel',
    'voice-realtime-status',
    'voice-realtime-model',
    'voice-realtime-timer',
    'voice-realtime-transcript',
    'voice-realtime-error',
    'voice-realtime-disclosure',
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
  let recorderOptions;
  let recorderStopped = false;
  let transcriptionCallCount = 0;
  let pendingCorrectionSignal;
  const recorderTurns = [];
  const sentChannelEvents = [];
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
        send(payload) { sentChannelEvents.push(JSON.parse(payload)); },
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
    VoiceTurnRecorder: {
      create(options) {
        recorderOptions = options;
        return {
          async start() {},
          beginTurn(turnId) { recorderTurns.push(['begin', turnId]); },
          endTurn(turnId) { recorderTurns.push(['end', turnId]); },
          stop() { recorderStopped = true; },
        };
      },
    },
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
    FormData,
    Blob,
    AbortController,
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

  const requests = [];
  fakeWindow.VoiceRealtime.init({
    config: {
      enabled: true,
      model: 'gpt-realtime-2.1-mini',
      voice: 'marin',
      maxSessionSeconds: 300,
      correctionEnabled: true,
      canonicalTranscriptionModel: 'gpt-transcribe',
      maxTurnSeconds: 120,
      maxTurnBytes: 8 * 1024 * 1024,
    },
    showToast() {},
    async apiFetch(url, options) {
      requests.push({ url, options });
      if (url === '/api/voice/realtime/tool') {
        return {
          ok: true,
          async json() {
            return {
              output: {
                ok: true,
                tool: 'schedule_read',
                status: 'found',
                content: '<schedule>활성 일정 1개</schedule>',
              },
            };
          },
        };
      }
      if (url.startsWith('/api/voice/realtime/turns/')) {
        transcriptionCallCount += 1;
        if (transcriptionCallCount === 2) {
          return {
            ok: false,
            async json() {
              return { code: 'REALTIME_TRANSCRIPTION_TIMEOUT' };
            },
          };
        }
        if (transcriptionCallCount === 3) {
          pendingCorrectionSignal = options.signal;
          return new Promise((resolve, reject) => {
            options.signal.addEventListener('abort', () => {
              const error = new Error('aborted');
              error.name = 'AbortError';
              reject(error);
            });
          });
        }
        return {
          ok: true,
          async json() {
            return {
              correctedTranscript: '첫 번째 질문 보정본',
              model: 'gpt-transcribe',
              durationMs: 900,
            };
          },
        };
      }
      return {
        ok: true,
        headers: {
          get(name) {
            if (String(name).toLowerCase() === 'x-galpi-realtime-tool-session') {
              return 'tool-session-1';
            }
            if (String(name).toLowerCase() === 'x-galpi-realtime-correction-session') {
              return 'correction-session-1';
            }
            return 'application/sdp';
          },
        },
        async text() { return 'v=0\r\no=provider\r\n'; },
      };
    },
  });
  assert.equal(elements['voice-realtime-button'].hidden, false);

  await fakeWindow.VoiceRealtime.start();
  assert.equal(requests[0].url, '/api/voice/realtime/session');
  assert.equal(requests[0].options.headers['Content-Type'], 'application/sdp');
  assert.equal(requests[0].options.body, 'v=0\r\no=browser\r\n');
  assert.deepEqual(
    JSON.parse(JSON.stringify(fakeWindow.VoiceRealtime.getState())),
    { phase: 'listening', muted: false, active: true },
  );

  channel.emit('message', {
    data: JSON.stringify({
      type: 'input_audio_buffer.speech_started',
      event_id: 'event-speech-1',
      item_id: 'input-1',
    }),
  });
  channel.emit('message', {
    data: JSON.stringify({
      type: 'input_audio_buffer.speech_stopped',
      event_id: 'event-speech-1-stopped',
      item_id: 'input-1',
    }),
  });
  assert.deepEqual(recorderTurns, [['begin', '1'], ['end', '1']]);
  channel.emit('message', {
    data: JSON.stringify({
      type: 'response.created',
      response: { id: 'response-1' },
    }),
  });
  channel.emit('message', {
    data: JSON.stringify({
      type: 'response.function_call_arguments.done',
      event_id: 'event-call-1-arguments-done',
      response_id: 'response-1',
      name: 'schedule_read',
      call_id: 'call-1',
      arguments: '{}',
    }),
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(requests.length, 1);
  assert.deepEqual(sentChannelEvents, []);

  channel.emit('message', {
    data: JSON.stringify({
      type: 'response.done',
      event_id: 'event-response-1-done',
      response: {
        id: 'response-1',
        status: 'completed',
        output: [{
          type: 'function_call',
          status: 'completed',
          name: 'schedule_read',
          call_id: 'call-1',
          arguments: '{}',
        }],
      },
    }),
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(requests[1].url, '/api/voice/realtime/tool');
  assert.deepEqual(JSON.parse(requests[1].options.body), {
    sessionId: 'tool-session-1',
    turnId: '1',
    callId: 'call-1',
    name: 'schedule_read',
    arguments: '{}',
  });
  assert.deepEqual(sentChannelEvents, [
    {
      type: 'conversation.item.create',
      item: {
        type: 'function_call_output',
        call_id: 'call-1',
        output: JSON.stringify({
          ok: true,
          tool: 'schedule_read',
          status: 'found',
          content: '<schedule>활성 일정 1개</schedule>',
        }),
      },
    },
    { type: 'response.create' },
  ]);

  const emitServerEvent = event => channel.emit('message', {
    data: JSON.stringify(event),
  });
  const transcriptRows = () => elements['voice-realtime-transcript'].children;
  const rowBy = (role, itemId) => transcriptRows()
    .find(row => row.dataset.role === role && row.dataset.itemId === itemId);

  emitServerEvent({
    type: 'error',
    event_id: 'event-recoverable-error',
    error: {
      type: 'invalid_request_error',
      code: 'conversation_already_has_active_response',
      message: 'Conversation already has an active response in progress.',
    },
  });
  assert.equal(fakeWindow.VoiceRealtime.getState().active, true);
  assert.notEqual(fakeWindow.VoiceRealtime.getState().phase, 'error');
  assert.equal(peerClosed, false);
  assert.match(elements['voice-realtime-error'].textContent, /대화는 계속/);

  const firstUserCompleted = {
    type: 'conversation.item.input_audio_transcription.completed',
    event_id: 'event-user-1-completed',
    item_id: 'input-1',
    transcript: '첫 번째 질문',
  };
  emitServerEvent(firstUserCompleted);
  emitServerEvent(firstUserCompleted);
  emitServerEvent({
    type: 'conversation.item.input_audio_transcription.delta',
    event_id: 'event-user-1-late-delta',
    item_id: 'input-1',
    delta: ' 중복',
  });
  recorderOptions.onTurnReady({
    turnId: '1',
    blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/wav' }),
    mimeType: 'audio/wav',
    byteLength: 3,
    durationMs: 900,
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(requests[2].url, '/api/voice/realtime/turns/1/transcribe');
  assert.equal(requests[2].options.body.get('session_id'), 'correction-session-1');
  assert.equal(requests[2].options.body.get('input_item_id'), 'input-1');
  assert.equal(requests[2].options.body.get('duration_ms'), '900');
  assert.equal(requests[2].options.body.get('audio').type, 'audio/wav');

  emitServerEvent({
    type: 'response.created',
    event_id: 'event-response-2-created',
    response: { id: 'response-2' },
  });
  assert.equal(elements['voice-realtime-error'].textContent, '');
  const interruptedDelta = {
    type: 'response.output_audio_transcript.delta',
    event_id: 'event-assistant-1-delta',
    response_id: 'response-2',
    item_id: 'assistant-1',
    delta: '중단될 답변',
  };
  emitServerEvent(interruptedDelta);
  emitServerEvent(interruptedDelta);
  emitServerEvent({
    type: 'response.output_audio_transcript.done',
    event_id: 'event-assistant-1-done',
    response_id: 'response-2',
    item_id: 'assistant-1',
    transcript: '중단될 답변',
  });
  emitServerEvent({
    type: 'response.done',
    event_id: 'event-response-2-done',
    response: { id: 'response-2', status: 'cancelled', output: [] },
  });

  emitServerEvent({
    type: 'input_audio_buffer.speech_started',
    event_id: 'event-speech-2',
    item_id: 'input-2',
  });
  emitServerEvent({
    type: 'conversation.item.input_audio_transcription.completed',
    event_id: 'event-user-2-completed',
    item_id: 'input-2',
    transcript: '두 번째 질문',
  });
  emitServerEvent({
    type: 'input_audio_buffer.speech_stopped',
    event_id: 'event-speech-2-stopped',
    item_id: 'input-2',
  });
  recorderOptions.onTurnReady({
    turnId: '2',
    blob: new Blob([new Uint8Array([4, 5, 6])], { type: 'audio/wav' }),
    mimeType: 'audio/wav',
    byteLength: 3,
    durationMs: 700,
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(requests[3].url, '/api/voice/realtime/turns/2/transcribe');
  emitServerEvent({
    ...firstUserCompleted,
    event_id: 'event-user-1-reordered-completed',
  });
  emitServerEvent({
    type: 'response.created',
    event_id: 'event-response-3-created',
    response: { id: 'response-3' },
  });
  emitServerEvent({
    type: 'response.output_item.added',
    event_id: 'event-assistant-2-added',
    response_id: 'response-3',
    item: { id: 'assistant-2', type: 'message' },
  });
  emitServerEvent({
    type: 'response.done',
    event_id: 'event-response-3-done',
    response: { id: 'response-3', status: 'completed', output: [] },
  });
  emitServerEvent({
    type: 'response.output_audio_transcript.done',
    event_id: 'event-assistant-2-done',
    item_id: 'assistant-2',
    transcript: '두 번째 답변',
  });

  emitServerEvent({
    type: 'input_audio_buffer.speech_started',
    event_id: 'event-speech-3',
    item_id: 'input-3',
  });
  emitServerEvent({
    type: 'input_audio_buffer.speech_stopped',
    event_id: 'event-speech-3-stopped',
    item_id: 'input-3',
  });
  emitServerEvent({
    type: 'conversation.item.input_audio_transcription.completed',
    event_id: 'event-user-3-completed',
    item_id: 'input-3',
    transcript: '세 번째 질문',
  });
  recorderOptions.onTurnReady({
    turnId: '3',
    blob: new Blob([new Uint8Array([7, 8, 9])], { type: 'audio/wav' }),
    mimeType: 'audio/wav',
    byteLength: 3,
    durationMs: 600,
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(requests[4].url, '/api/voice/realtime/turns/3/transcribe');
  assert.equal(pendingCorrectionSignal.aborted, false);

  assert.equal(transcriptRows().length, 5);
  const userOne = rowBy('user', 'input-1');
  const assistantOne = rowBy('assistant', 'assistant-1');
  const userTwo = rowBy('user', 'input-2');
  const assistantTwo = rowBy('assistant', 'assistant-2');
  const userThree = rowBy('user', 'input-3');
  assert.equal(userOne.dataset.status, 'corrected');
  assert.equal(userOne.children[1].textContent, '첫 번째 질문 보정본');
  assert.equal(assistantOne.dataset.status, 'interrupted');
  assert.equal(assistantOne.children[1].textContent, '중단될 답변 · 중단됨');
  assert.equal(userTwo.dataset.status, 'correction_failed');
  assert.equal(userTwo.children[1].textContent, '두 번째 질문 · 기록 확인 필요');
  assert.equal(assistantTwo.dataset.status, 'final');
  assert.equal(assistantTwo.children[1].textContent, '두 번째 답변');
  assert.equal(userTwo.dataset.turnId, assistantTwo.dataset.turnId);
  assert.equal(userThree.dataset.status, 'correction_pending');
  assert.notEqual(userOne.dataset.turnId, userTwo.dataset.turnId);
  assert.equal(requests.length, 5);

  emitServerEvent({
    type: 'response.created',
    event_id: 'event-response-3b-created',
    response: { id: 'response-3b' },
  });
  emitServerEvent({
    type: 'response.output_item.added',
    event_id: 'event-assistant-3-added',
    response_id: 'response-3b',
    item: { id: 'assistant-3', type: 'message' },
  });
  emitServerEvent({
    type: 'response.done',
    event_id: 'event-response-3b-done',
    response: { id: 'response-3b', status: 'completed', output: [] },
  });
  emitServerEvent({
    type: 'response.output_audio_transcript.done',
    event_id: 'event-assistant-3-done',
    item_id: 'assistant-3',
    transcript: '세 번째 답변',
  });

  emitServerEvent({
    type: 'input_audio_buffer.speech_started',
    event_id: 'event-speech-4',
    item_id: 'input-4',
  });
  emitServerEvent({
    type: 'input_audio_buffer.speech_stopped',
    event_id: 'event-speech-4-stopped',
    item_id: 'input-4',
  });
  emitServerEvent({
    type: 'input_audio_buffer.speech_started',
    event_id: 'event-speech-5',
    item_id: 'input-5',
  });
  emitServerEvent({
    type: 'response.created',
    event_id: 'event-response-4-created',
    response: { id: 'response-4' },
  });
  emitServerEvent({
    type: 'response.output_item.added',
    event_id: 'event-assistant-4-added',
    response_id: 'response-4',
    item: { id: 'assistant-4', type: 'message' },
  });
  emitServerEvent({
    type: 'response.output_audio_transcript.done',
    event_id: 'event-assistant-4-done',
    response_id: 'response-4',
    item_id: 'assistant-4',
    transcript: '길고 어려운 답변의 일부',
  });
  emitServerEvent({
    type: 'response.done',
    event_id: 'event-response-4-done',
    response: {
      id: 'response-4',
      status: 'incomplete',
      status_details: { type: 'incomplete', reason: 'max_output_tokens' },
      output: [],
    },
  });
  emitServerEvent({
    type: 'conversation.item.input_audio_transcription.completed',
    event_id: 'event-user-4-late-completed',
    item_id: 'input-4',
    transcript: '네 번째 어려운 질문',
  });
  emitServerEvent({
    type: 'input_audio_buffer.speech_stopped',
    event_id: 'event-speech-5-stopped',
    item_id: 'input-5',
  });
  emitServerEvent({
    type: 'response.created',
    event_id: 'event-response-5-created',
    response: { id: 'response-5' },
  });
  emitServerEvent({
    type: 'response.output_item.added',
    event_id: 'event-assistant-5-added',
    response_id: 'response-5',
    item: { id: 'assistant-5', type: 'message' },
  });
  emitServerEvent({
    type: 'response.done',
    event_id: 'event-response-5-done',
    response: { id: 'response-5', status: 'completed', output: [] },
  });
  emitServerEvent({
    type: 'response.output_audio_transcript.done',
    event_id: 'event-assistant-5-done',
    item_id: 'assistant-5',
    transcript: '다섯 번째 답변',
  });
  emitServerEvent({
    type: 'conversation.item.input_audio_transcription.completed',
    event_id: 'event-user-5-late-completed',
    item_id: 'input-5',
    transcript: '다섯 번째 질문',
  });

  const userFour = rowBy('user', 'input-4');
  const assistantFour = rowBy('assistant', 'assistant-4');
  const userFive = rowBy('user', 'input-5');
  const assistantFive = rowBy('assistant', 'assistant-5');
  assert.equal(userFour.dataset.turnId, assistantFour.dataset.turnId);
  assert.equal(userFive.dataset.turnId, assistantFive.dataset.turnId);
  assert.notEqual(userFour.dataset.turnId, userFive.dataset.turnId);
  assert.equal(assistantFour.dataset.status, 'incomplete');
  assert.match(assistantFour.children[1].textContent, /답변이 길어 여기서 멈춤/);
  assert.doesNotMatch(assistantFour.children[1].textContent, /중단됨/);
  assert.ok(transcriptRows().indexOf(userFour) < transcriptRows().indexOf(assistantFour));
  assert.ok(transcriptRows().indexOf(assistantFour) < transcriptRows().indexOf(userFive));
  assert.ok(transcriptRows().indexOf(userFive) < transcriptRows().indexOf(assistantFive));

  windowListeners.get('pagehide')();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(pendingCorrectionSignal.aborted, true);
  assert.equal(localTrack.stopped, true);
  assert.equal(peerClosed, true);
  assert.equal(recorderStopped, true);
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
    html.indexOf('<script src="voice-turn-recorder.js"></script>')
      < html.indexOf('<script src="voice-realtime.js"></script>'),
  );
  assert.ok(
    html.indexOf('<script src="voice-realtime.js"></script>')
      < html.indexOf('<script src="app.js"></script>'),
  );
  assert.match(app, /VoiceRealtime\?\.init\(\{[\s\S]*config: config\.realtimeVoice/);
  assert.match(server, /realtimeVoice:\s*\{[\s\S]*realtimeSessions\.publicConfig\(\)[\s\S]*realtimeTranscriptions\.publicConfig\(\)/);
  assert.doesNotMatch(server, /realtimeVoice:\s*\{[^}]*apiKey/s);
});
