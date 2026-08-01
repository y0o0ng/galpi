'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');

function loadClient({
  config = {}, responders = {}, askAssistant = null, pendingConfirmation = null,
} = {}) {
  const calls = [];
  const asks = [];
  // 턴마다 다른 발화를 흘려보낼 수 있게 큐로 둔다. 비면 기본 문장을 쓴다.
  const transcriptQueue = [];
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
  const audioElements = [];

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
    Float32Array,
    Audio: class FakeAudio {
      constructor() { this.playCount = 0; audioElements.push(this); }
      set src(value) {
        this._src = value;
        played.push(value);
        // 재생 완료를 즉시 통지해 SPEAKING 이후 전이를 검사한다.
        setImmediate(() => this.onended?.());
      }
      get src() { return this._src; }
      play() { this.playCount += 1; return Promise.resolve(); }
      pause() {}
    },
    VoiceTurnRecorder: null,
    navigator: {
      mediaDevices: {
        async getUserMedia() {
          return { getAudioTracks: () => tracks, getTracks: () => tracks };
        },
      },
    },
    VoiceTurnRecorderReal: {
      create(options) {
        recorder = {
          options,
          async start() {},
          beginTurn(id) { recorderEvents.push(['begin', id]); return true; },
          endTurn(id) { recorderEvents.push(['end', id]); return true; },
          async resume() { recorderEvents.push(['resume']); return true; },
          stop() { recorderEvents.push(['stop']); },
        };
        return recorder;
      },
    },
  };
  fakeWindow.VoiceTurnRecorder = {
    ...fakeWindow.VoiceTurnRecorderReal,
    encodePcmWav: () => new ArrayBuffer(44),
  };
  delete fakeWindow.VoiceTurnRecorderReal;

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
    Float32Array,
    ArrayBuffer,
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
    // 실제 앱에서는 sendSingleMessage가 들어와 메인 채팅에 그리고 shared-main에 저장한다.
    async askAssistant(transcript) {
      asks.push(transcript);
      if (askAssistant) return askAssistant(transcript);
      return { ok: true, reply: '오전 10시에 하나 있어.' };
    },
    ...(pendingConfirmation ? { pendingConfirmation } : {}),
    async apiFetch(url, options) {
      calls.push({ url, options });
      const responder = Object.entries(responders)
        .find(([pattern]) => url.includes(pattern))?.[1];
      if (responder) return responder(url, options);
      if (url.includes('/api/voice/session')) {
        return { ok: true, async json() { return { sessionId: 'vs-1' }; } };
      }
      if (url.includes('/transcribe')) {
        const next = transcriptQueue.length ? transcriptQueue.shift() : '내일 일정 알려줘';
        return {
          ok: true,
          async json() {
            return { correctedTranscript: next, persistable: true };
          },
        };
      }
      return { ok: true, async blob() { return new Blob(['RIFF']); } };
    },
  });

  // 잡음 바닥을 먼저 채워 문턱을 확정한다.
  const settleNoise = () => { client.__feedLevel(0.001); client.__feedLevel(0.001); };

  return {
    client, calls, asks, phases, toasts, transcripts, answers, tracks,
    timers, recorderEvents, played, audioElements, settleNoise, transcriptQueue,
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
  // iOS 잠금 해제용 무음 하나와 실제 답변 하나가 같은 요소에서 재생된다.
  assert.equal(h.audioElements.length, 1);
  assert.equal(h.played.length, 2);
  assert.equal(h.client.getState().phase, 'cooldown');
});

test('the turn goes through the shared chat sender instead of its own request', async () => {
  const h = loadClient();
  await h.client.start();
  h.settleNoise();
  h.client.__feedLevel(0.5);
  h.fireTimer(120000);
  await h.client.__feedTurn({ turnId: 'hd-1', blob: new Blob(['x']), durationMs: 1500 });
  await tick();

  // H2는 자체 /api/chat 호출을 버렸다. 그래야 메인 채팅 렌더링과 저장이 한 경로로 모인다.
  assert.deepEqual(h.asks, ['내일 일정 알려줘']);
  assert.equal(h.calls.filter(call => call.url === '/api/chat').length, 0);
  assert.deepEqual(h.answers, ['오전 10시에 하나 있어.']);
});

test('a busy sender recovers with its own message and keeps listening', async () => {
  const h = loadClient({ askAssistant: async () => ({ ok: false, reason: 'busy' }) });
  await h.client.start();
  h.settleNoise();
  h.client.__feedLevel(0.5);
  h.fireTimer(120000);
  await h.client.__feedTurn({ turnId: 'hd-1', blob: new Blob(['x']), durationMs: 1500 });
  await tick();

  // 텍스트 답변이 진행 중이라 거절된 것은 실패와 다르게 알린다.
  assert.match(h.toasts.at(-1), /다른 답변/);
  assert.equal(h.client.getState().phase, 'cooldown');
  h.fireTimer(500);
  assert.equal(h.client.getState().phase, 'listening');
  assert.equal(h.tracks[0].enabled, true);
});

test('an empty reply from the sender recovers instead of speaking silence', async () => {
  const h = loadClient({ askAssistant: async () => ({ ok: true, reply: '   ' }) });
  await h.client.start();
  h.settleNoise();
  h.client.__feedLevel(0.5);
  h.fireTimer(120000);
  await h.client.__feedTurn({ turnId: 'hd-1', blob: new Blob(['x']), durationMs: 1500 });
  await tick();

  assert.deepEqual(h.answers, []);
  assert.equal(h.calls.filter(call => call.url.includes('/speak')).length, 0);
  assert.equal(h.client.getState().phase, 'cooldown');
  h.fireTimer(500);
  assert.equal(h.client.getState().phase, 'listening');
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

  // 헛기침이면 시온이 반응하지 않고 계속 듣는다. 저장 경로에도 닿지 않는다.
  assert.deepEqual(h.asks, []);
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
  const h = loadClient({ askAssistant: async () => ({ ok: false, reason: 'error' }) });
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

test('a turn mints its own correction session instead of assuming a Realtime handshake', async () => {
  const h = loadClient();
  await h.client.start();
  h.settleNoise();
  h.client.__feedLevel(0.5);
  h.fireTimer(120000);
  await h.client.__feedTurn({ turnId: 'hd-1', blob: new Blob(['x']), durationMs: 1500 });
  await tick();

  const session = h.calls.find(call => call.url === '/api/voice/session');
  assert.ok(session, '반이중은 Realtime 핸드셰이크를 하지 않으므로 세션을 직접 받아야 한다');

  const transcribe = h.calls.find(call => call.url.includes('/transcribe'));
  // Realtime 세션 공간을 빌려 쓰지 않는다.
  assert.doesNotMatch(transcribe.url, /\/realtime\//);
  assert.equal(transcribe.options.body.get('session_id'), 'vs-1');
});

test('an expired session is dropped so the next turn asks for a new one', async () => {
  let expire = true;
  const h = loadClient({
    responders: {
      '/transcribe': async () => (expire
        ? { ok: false, async json() { return { code: 'REALTIME_TRANSCRIPTION_SESSION_EXPIRED' }; } }
        : { ok: true, async json() { return { correctedTranscript: '내일 일정', persistable: true }; } }),
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

  expire = false;
  h.settleNoise();
  h.client.__feedLevel(0.5);
  h.fireTimer(120000);
  await h.client.__feedTurn({ turnId: 'hd-2', blob: new Blob(['x']), durationMs: 1500 });
  await tick();

  // 만료된 세션을 계속 쓰지 않고 두 번째 발급을 받는다.
  assert.equal(h.calls.filter(call => call.url === '/api/voice/session').length, 2);
  assert.deepEqual(h.transcripts, ['내일 일정']);
});

test('audio playback is unlocked inside the start gesture, before any await', async () => {
  const h = loadClient();
  await h.client.start();

  // 버튼을 누른 시점에 요소가 열려야 iOS가 이후 재생을 막지 않는다.
  assert.equal(h.audioElements.length, 1);
  assert.equal(h.audioElements[0].playCount, 1);
  assert.equal(h.played.length, 1);
});

test('the audio graph is woken every time listening resumes', async () => {
  const h = loadClient();
  await h.client.start();
  // 첫 청취부터 깨운다. iOS는 재생 뒤 그래프를 재울 수 있다.
  assert.ok(h.recorderEvents.some(e => e[0] === 'resume'));

  h.settleNoise();
  h.client.__feedLevel(0.5);
  h.fireTimer(120000);
  await h.client.__feedTurn({ turnId: 'hd-1', blob: new Blob(['x']), durationMs: 1500 });
  await tick();
  h.fireTimer(500);

  // 두 번째 턴 직전에도 다시 깨워야 마이크가 계속 산다.
  assert.ok(h.recorderEvents.filter(e => e[0] === 'resume').length >= 2);
  assert.equal(h.client.getState().phase, 'listening');
});

test('a listening state that receives no audio frames recovers instead of hanging', async () => {
  const h = loadClient();
  await h.client.start();

  // 프레임이 한 장도 안 오면 두 번의 감시 주기 뒤 복구한다.
  assert.equal(h.fireTimer(2500), true);
  assert.equal(h.fireTimer(2500), true);

  assert.ok(h.toasts.some(message => message.includes('마이크가 멈춰서')));
  assert.equal(h.client.getState().phase, 'cooldown');
});

test('an arriving audio frame disarms the watchdog', async () => {
  const h = loadClient();
  await h.client.start();
  h.client.__feedLevel(0.001);

  // 프레임이 왔으므로 감시 타이머는 사라진다.
  assert.equal(h.fireTimer(2500), false);
});


// ─── 일정 카드 음성 확인 ──────────────────────────────────────────────────

test('the confirm vocabulary takes commands but refuses sentences', () => {
  const { matchConfirmIntent } = loadClient().client;

  for (const text of [
    '등록', '등록해줘', '응', '그래', '좋아', '오케이', '응 등록해줘', '네, 등록해!',
    // 실기기에서 실제로 쓴 청유형. 어미는 사람마다 달라 어간+꼬리로 받는다.
    '등록해줄래?', '등록해주세요', '등록할래', '저장해줄래', '응 등록해줄래',
    // 안 먹혔다 싶으면 사람은 같은 말을 반복한다. 실기기 2차에서 8자 상한에 걸렸다.
    '등록해 줘. 등록해 줄래?',
    // 목적어를 붙여 말한다. 이것도 8자 상한에 걸렸다.
    '일정 카드 등록해줄래?', '일정 등록해줘', '그 카드 등록해줘', '방금 일정 등록해줘',
  ]) {
    assert.equal(matchConfirmIntent(text), 'confirm', text);
  }
  for (const text of [
    '취소', '취소해줘', '아니', '아냐', '됐어', '나중에', '아니 취소해',
    '등록하지마', '등록하지말자', '등록안해',
    '취소. 취소해줘.', '일정 취소해줘', '그 카드 취소해줘',
  ]) {
    assert.equal(matchConfirmIntent(text), 'cancel', text);
  }
  // 문장은 명령이 아니다. 여기서 걸러야 확인 카드가 안전장치로 남는다.
  for (const text of [
    '등록은 나중에 생각해볼게',
    '그 일정 등록하면 알림도 오나?',
    '아까 등록한 거 언제였지',
    '취소하면 어떻게 되는데',
    '내일 일정 알려줘',
    // 물음은 명령이 아니다. 어간이 같아도 꼬리로 가른다.
    '등록할까?',
    '등록됐어?',
    // 미루는 말이 등록으로 읽히면 안 된다.
    '조금 이따가 등록할게',
    '이따가 내가 결정할게',
    // 부분 문자열로 찾았다면 "해줘"가 걸려 시간 정정 중에 일정이 등록됐을 것이다.
    '오전 9시로 해줘',
    // 목적어를 떼도 남는 말이 길면 문장이다.
    '일정 등록하면 알림도 오나?', '그 일정 등록하면 알림도 오나?', '아까 등록한 거 언제였지',
    // 조각이 서로 다른 뜻이면 받지 않는다. 반복만 허용한다.
    '안녕. 등록해줘.', '취소해줘 아니 등록해줘',
    // 카드를 다시 만들어달라는 말은 확인이 아니다. 그대로 LLM에 보낸다.
    '카드 만들어줘. 카드 만들어줘.', '방금 일정 카드 다시 띄워줄래?',
    '',
  ]) {
    assert.equal(matchConfirmIntent(text), null, text);
  }
});

function cardHarness({ confirmFails = false } = {}) {
  const acted = [];
  let pending = {
    id: 'req-1',
    title: '할머니집 가기',
    async confirm() {
      acted.push('confirm');
      if (confirmFails) throw new Error('nope');
      pending = null;
    },
    cancel() { acted.push('cancel'); pending = null; },
  };
  const h = loadClient({ pendingConfirmation: () => pending });
  return { ...h, acted, dropCard: () => { pending = null; } };
}

async function runTurn(h, transcript, turnId) {
  // 앞 턴이 cooldown으로 끝났으면 먼저 다시 듣는 상태로 돌려놓는다.
  if (h.client.getState().phase === 'cooldown') h.fireTimer(500);
  h.transcriptQueue.push(transcript);
  h.settleNoise();
  h.client.__feedLevel(0.5);
  h.fireTimer(120000);
  await h.client.__feedTurn({ turnId, blob: new Blob(['x']), durationMs: 1500 });
  await tick();
}

test('saying 등록 presses the card instead of building its own request', async () => {
  const h = cardHarness();
  await h.client.start();
  await runTurn(h, '응 등록해줘', 'hd-1');

  assert.deepEqual(h.acted, ['confirm']);
  // 확인 명령은 대화가 아니다. 모델도 저장도 거치지 않는다.
  assert.deepEqual(h.asks, []);
  assert.equal(h.calls.filter(call => call.url === '/api/chat').length, 0);
  assert.ok(h.calls.some(call => call.url.includes('/speak')));
  assert.equal(h.client.getState().phase, 'cooldown');
});

test('saying 취소 dismisses the card without touching the task API', async () => {
  const h = cardHarness();
  await h.client.start();
  await runTurn(h, '아니 취소해', 'hd-1');

  assert.deepEqual(h.acted, ['cancel']);
  assert.deepEqual(h.asks, []);
});

test('moving on to another topic drops the card and the turn continues as normal', async () => {
  const h = cardHarness();
  await h.client.start();
  await runTurn(h, '등록은 나중에 생각해볼게', 'hd-1');

  // 일정을 부탁해 놓고 한참 뒤에 다시 볼 이유가 없다. 그 자리에서 취소하고 대화로 넘어간다.
  assert.deepEqual(h.acted, ['cancel']);
  assert.deepEqual(h.asks, ['등록은 나중에 생각해볼게']);
});

test('a dropped card cannot be revived by a later 응', async () => {
  const h = cardHarness();
  await h.client.start();

  await runTurn(h, '오늘 날씨 어때', 'hd-1');
  await runTurn(h, '응', 'hd-2');

  // 첫 턴에서 이미 취소됐으므로 뒤의 맞장구는 평범한 발화다.
  assert.deepEqual(h.acted, ['cancel']);
  assert.deepEqual(h.asks, ['오늘 날씨 어때', '응']);
});

test('a failed registration says so instead of pretending it worked', async () => {
  const h = cardHarness({ confirmFails: true });
  await h.client.start();
  await runTurn(h, '등록', 'hd-1');

  assert.deepEqual(h.acted, ['confirm']);
  assert.match(h.toasts.at(-1), /등록하지 못했어/);
  assert.equal(h.client.getState().phase, 'cooldown');
  h.fireTimer(500);
  assert.equal(h.client.getState().phase, 'listening');
});

test('with no card showing the same words are ordinary speech', async () => {
  const h = loadClient();
  await h.client.start();
  await runTurn(h, '응', 'hd-1');

  assert.deepEqual(h.asks, ['응']);
});
