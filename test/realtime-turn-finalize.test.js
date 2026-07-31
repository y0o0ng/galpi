'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');

const ELEMENT_IDS = [
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

function fakeElement() {
  const listeners = new Map();
  return {
    hidden: false,
    disabled: false,
    textContent: '',
    srcObject: null,
    dataset: {},
    className: '',
    classList: {
      add() {}, remove() {}, contains() { return false; },
    },
    children: [],
    scrollTop: 0,
    scrollHeight: 0,
    attributes: new Map(),
    addEventListener(type, listener) { listeners.set(type, listener); },
    setAttribute(name, value) { this.attributes.set(name, String(value)); },
    append(...children) { this.children.push(...children); },
    appendChild(child) { this.append(child); return child; },
    replaceChildren(...children) { this.children = children; },
    pause() {},
    async play() {},
  };
}

async function launchClient({ finalizeEnabled = true } = {}) {
  const elements = Object.fromEntries(ELEMENT_IDS.map(id => [id, fakeElement()]));
  const track = { enabled: true, stop() {} };
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  let channel;
  const finalizeRequests = [];

  class FakePeerConnection {
    constructor() { this.connectionState = 'new'; this.senders = []; }
    addTrack(item) { this.senders.push({ track: item }); }
    createDataChannel() {
      const listeners = new Map();
      channel = {
        addEventListener(type, listener) { listeners.set(type, listener); },
        emit(type, event = {}) { listeners.get(type)?.(event); },
        send() {},
        close() {},
      };
      return channel;
    }
    async createOffer() { return { type: 'offer', sdp: 'v=0\r\no=browser\r\n' }; }
    async setLocalDescription() {}
    async setRemoteDescription() { channel.emit('open'); }
    getSenders() { return this.senders; }
    getReceivers() { return []; }
    close() { this.connectionState = 'closed'; }
  }

  const fakeWindow = {
    isSecureContext: true,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    addEventListener() {},
    VoiceTurnRecorder: {
      create() {
        return {
          async start() {}, beginTurn() {}, endTurn() {}, stop() {},
        };
      },
    },
  };
  const context = {
    window: fakeWindow,
    document: { getElementById: id => elements[id] || null, createElement: fakeElement },
    navigator: { mediaDevices: { async getUserMedia() { return stream; } } },
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

  fakeWindow.VoiceRealtime.init({
    config: {
      enabled: true,
      model: 'gpt-realtime-2.1-mini',
      voice: 'cedar',
      maxSessionSeconds: 300,
      correctionEnabled: true,
      finalizeEnabled,
      canonicalTranscriptionModel: 'gpt-transcribe',
      maxTurnSeconds: 120,
      maxTurnBytes: 8 * 1024 * 1024,
    },
    showToast() {},
    async apiFetch(url, options) {
      if (url.endsWith('/assistant')) {
        finalizeRequests.push({ url, body: JSON.parse(options.body) });
        return { ok: true, async json() { return { receipt: { finalized: true } }; } };
      }
      if (url.startsWith('/api/voice/realtime/turns/')) {
        return {
          ok: true,
          async json() {
            return { correctedTranscript: '보정된 질문', model: 'gpt-transcribe' };
          },
        };
      }
      return {
        ok: true,
        headers: {
          get(name) {
            const key = String(name).toLowerCase();
            if (key === 'x-galpi-realtime-correction-session') return 'correction-session-1';
            if (key === 'x-galpi-realtime-tool-session') return 'tool-session-1';
            return 'application/sdp';
          },
        },
        async text() { return 'v=0\r\no=provider\r\n'; },
      };
    },
  });

  await fakeWindow.VoiceRealtime.start();

  const emit = payload => channel.emit('message', { data: JSON.stringify(payload) });
  // 사용자 턴을 만들고 response를 그 턴에 묶는다.
  const openTurn = (itemId, responseId) => {
    emit({ type: 'input_audio_buffer.speech_started', event_id: `e-${itemId}`, item_id: itemId });
    emit({
      type: 'conversation.item.input_audio_transcription.completed',
      event_id: `t-${itemId}`,
      item_id: itemId,
      transcript: '임시 자막',
    });
    emit({ type: 'input_audio_buffer.speech_stopped', event_id: `s-${itemId}`, item_id: itemId });
    emit({ type: 'response.created', event_id: `c-${responseId}`, response: { id: responseId } });
  };

  return { emit, openTurn, finalizeRequests, stop: fakeWindow.VoiceRealtime.stop };
}

function assistantMessage(text) {
  return {
    type: 'message',
    role: 'assistant',
    content: [{ type: 'audio', transcript: text }],
  };
}

test('a completed response reports the assistant outcome with the transcript from response.output', async () => {
  const client = await launchClient();
  client.openTurn('input-1', 'resp-1');
  client.emit({
    type: 'response.done',
    event_id: 'done-1',
    response: {
      id: 'resp-1',
      status: 'completed',
      output: [assistantMessage('오후 3시야.')],
    },
  });

  assert.equal(client.finalizeRequests.length, 1);
  const request = client.finalizeRequests[0];
  assert.match(request.url, /\/api\/voice\/realtime\/turns\/.+\/assistant$/);
  assert.deepEqual(request.body, {
    session_id: 'correction-session-1',
    input_item_id: 'input-1',
    final_response_id: 'resp-1',
    assistant_transcript: '오후 3시야.',
    assistant_status: 'completed',
  });
  client.stop();
});

test('an interrupted response reports the status without any assistant text', async () => {
  const client = await launchClient();
  client.openTurn('input-1', 'resp-1');
  client.emit({
    type: 'response.done',
    event_id: 'done-1',
    response: {
      id: 'resp-1',
      status: 'cancelled',
      output: [assistantMessage('말하다 끊긴 부분')],
    },
  });

  assert.equal(client.finalizeRequests.length, 1);
  assert.equal(client.finalizeRequests[0].body.assistant_status, 'cancelled');
  // partial text는 서버로 보내지 않는다.
  assert.equal(client.finalizeRequests[0].body.assistant_transcript, '');
  client.stop();
});

test('a repeated response.done reports the turn only once', async () => {
  const client = await launchClient();
  client.openTurn('input-1', 'resp-1');
  const done = {
    type: 'response.done',
    event_id: 'done-1',
    response: { id: 'resp-1', status: 'completed', output: [assistantMessage('오후 3시야.')] },
  };
  client.emit(done);
  client.emit({ ...done, event_id: 'done-1-again' });

  assert.equal(client.finalizeRequests.length, 1);
  client.stop();
});

test('a tool-only response does not finalize a turn', async () => {
  const client = await launchClient();
  client.openTurn('input-1', 'resp-1');
  client.emit({
    type: 'response.done',
    event_id: 'done-1',
    response: {
      id: 'resp-1',
      status: 'completed',
      output: [{
        type: 'function_call',
        status: 'completed',
        call_id: 'call-1',
        name: 'galpi_current_time',
        arguments: '{}',
      }],
    },
  });

  assert.equal(client.finalizeRequests.length, 0);
  client.stop();
});

test('nothing is reported while the finalize flag is off', async () => {
  const client = await launchClient({ finalizeEnabled: false });
  client.openTurn('input-1', 'resp-1');
  client.emit({
    type: 'response.done',
    event_id: 'done-1',
    response: { id: 'resp-1', status: 'completed', output: [assistantMessage('오후 3시야.')] },
  });

  assert.equal(client.finalizeRequests.length, 0);
  client.stop();
});
