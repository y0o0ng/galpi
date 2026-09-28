const test = require('node:test');
const assert = require('node:assert/strict');
const { energyEnvelope, findOnset, linearFit, summarize } = require('../spikes/capture-timing/analysis.js');

function synth(sampleRate, seconds, clickTimes) {
  const samples = new Float32Array(sampleRate * seconds);
  let seed = 7;
  for (let i = 0; i < samples.length; i++) {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    samples[i] = ((seed / 2147483648) - 0.5) * 0.004; // 배경 잡음
  }
  for (const t of clickTimes) {
    const start = Math.round(t * sampleRate);
    for (let i = 0; i < sampleRate * 0.01; i++) samples[start + i] += Math.sin(i / 3) * 0.6;
  }
  return samples;
}

test('finds a tap click within one hop of its true start', () => {
  const sr = 16000;
  const env = energyEnvelope(synth(sr, 10, [2.0, 6.37]), sr);
  assert.ok(Math.abs(findOnset(env, 2.2) - 2.0) <= 0.01);
  assert.ok(Math.abs(findOnset(env, 6.1) - 6.37) <= 0.01);
});

test('returns null instead of guessing when the window has no distinct sound', () => {
  const sr = 16000;
  const env = energyEnvelope(synth(sr, 10, [2.0]), sr);
  assert.equal(findOnset(env, 7.0), null);
});

test('linear fit recovers slope and intercept', () => {
  const fit = linearFit([0, 1, 2, 3], [10, 12, 14, 16]);
  assert.equal(fit.slope, 2);
  assert.equal(fit.intercept, 10);
});

test('summary passes only when every tap is found within the gate', () => {
  const ok = summarize([{ sessionMs: 0, offsetMs: 120 }, { sessionMs: 60000, offsetMs: 140 }]);
  assert.equal(ok.pass, true);
  assert.equal(ok.driftMsPerMin, 20);
  assert.equal(summarize([{ sessionMs: 0, offsetMs: 120 }, { sessionMs: 60000, offsetMs: 620 }]).pass, false);
  assert.equal(summarize([{ sessionMs: 0, offsetMs: 120 }, { sessionMs: 60000, offsetMs: null }]).pass, false);
});
