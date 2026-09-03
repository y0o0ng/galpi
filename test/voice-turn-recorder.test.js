'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');

function loadRecorder({ maxBytes = 8 * 1024 * 1024 } = {}) {
  let processor;
  let contextClosed = false;
  let scheduled;
  const connections = [];
  const fakeWindow = {
    Blob,
    Float32Array,
    ArrayBuffer,
    DataView,
    Math,
    setTimeout(fn) {
      scheduled = fn;
      return 1;
    },
    clearTimeout() {
      scheduled = null;
    },
  };
  class FakeNode {
    constructor(kind = 'node') { this.kind = kind; }
    connect(target) { connections.push([this.kind, target?.kind]); }
    disconnect() {}
  }
  class FakeAudioContext {
    constructor() {
      this.sampleRate = 48000;
      this.destination = new FakeNode('physical-destination');
    }
    async resume() {}
    createMediaStreamSource() { return new FakeNode('microphone-source'); }
    createScriptProcessor() {
      processor = new FakeNode('script-processor');
      return processor;
    }
    createMediaStreamDestination() { return new FakeNode('isolated-media-sink'); }
    async close() { contextClosed = true; }
  }
  fakeWindow.AudioContext = FakeAudioContext;
  const context = {
    window: fakeWindow,
    Blob,
    Float32Array,
    ArrayBuffer,
    DataView,
    Math,
  };
  vm.runInNewContext(
    fs.readFileSync(path.join(ROOT, 'public/voice/turn-recorder.js'), 'utf8'),
    context,
    { filename: 'voice/turn-recorder.js' },
  );
  const results = [];
  const recorder = fakeWindow.VoiceTurnRecorder.create({
    stream: { getAudioTracks: () => [{}] },
    maxBytes,
    onTurnReady: result => results.push(result),
  });
  return {
    async start() { await recorder.start(); },
    beginTurn: recorder.beginTurn,
    endTurn: recorder.endTurn,
    stop: recorder.stop,
    push(samples) {
      processor.onaudioprocess({
        inputBuffer: { getChannelData: () => Float32Array.from(samples) },
      });
    },
    flush() {
      const callback = scheduled;
      scheduled = null;
      callback?.();
    },
    results,
    isClosed: () => contextClosed,
    connections,
  };
}

test('turn recorder includes pre/post roll and emits an independent 16 kHz mono PCM WAV', async () => {
  const recorder = loadRecorder();
  await recorder.start();
  assert.deepEqual(recorder.connections, [
    ['microphone-source', 'script-processor'],
    ['script-processor', 'isolated-media-sink'],
  ]);
  recorder.push(new Array(4800).fill(0.1));
  assert.equal(recorder.beginTurn('turn-1'), true);
  recorder.push(new Array(4800).fill(0.2));
  assert.equal(recorder.endTurn('turn-1'), true);
  recorder.push(new Array(4800).fill(0.3));
  recorder.flush();

  assert.equal(recorder.results.length, 1);
  const result = recorder.results[0];
  assert.equal(result.turnId, 'turn-1');
  assert.equal(result.mimeType, 'audio/wav');
  assert.equal(result.durationMs, 300);
  const wav = Buffer.from(await result.blob.arrayBuffer());
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
  assert.equal(wav.toString('ascii', 8, 12), 'WAVE');
  assert.equal(wav.readUInt16LE(22), 1);
  assert.equal(wav.readUInt32LE(24), 16000);
  assert.equal(wav.readUInt16LE(34), 16);

  recorder.stop();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(recorder.isClosed(), true);
});

test('turn recorder fails closed when the bounded WAV would exceed the configured byte cap', async () => {
  const recorder = loadRecorder({ maxBytes: 100 });
  await recorder.start();
  recorder.beginTurn('turn-limit');
  recorder.push(new Array(4800).fill(0.2));
  recorder.endTurn('turn-limit');
  recorder.flush();
  assert.deepEqual(JSON.parse(JSON.stringify(recorder.results)), [{
    turnId: 'turn-limit',
    errorCode: 'TURN_AUDIO_LIMIT',
  }]);
  recorder.stop();
});
