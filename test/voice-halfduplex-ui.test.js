'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

function fakeElement(id) {
  const listeners = new Map();
  return {
    id,
    hidden: false,
    textContent: '',
    dataset: {},
    className: '',
    children: [],
    scrollTop: 0,
    scrollHeight: 0,
    attributes: new Map(),
    addEventListener(type, listener) { listeners.set(type, listener); },
    dispatch(type) { return listeners.get(type)?.(); },
    setAttribute(name, value) { this.attributes.set(name, String(value)); },
    getAttribute(name) { return this.attributes.get(name); },
    appendChild(child) {
      this.children.push(child);
      this.scrollHeight = this.children.length;
      return child;
    },
  };
}

function loadUi({ halfDuplexEnabled = true } = {}) {
  const ids = [
    'voice-hd-panel', 'voice-hd-dot', 'voice-hd-status',
    'voice-hd-stop', 'voice-hd-log', 'voice-hd-button',
  ];
  const elements = Object.fromEntries(ids.map(id => [id, fakeElement(id)]));
  const coreCalls = [];
  let coreState = { phase: 'idle', active: false };
  let hooks = {};

  const fakeWindow = {
    document: {
      getElementById: id => elements[id] || null,
      createElement: () => fakeElement('created'),
    },
    VoiceHalfDuplex: {
      init(options) { hooks = options; coreCalls.push(['init']); },
      start() { coreCalls.push(['start']); coreState = { phase: 'listening', active: true }; },
      stop() { coreCalls.push(['stop']); coreState = { phase: 'idle', active: false }; },
      getState: () => coreState,
    },
  };
  const context = { window: fakeWindow, console, Object, String, Boolean };
  vm.runInNewContext(
    read('public/voice-halfduplex-ui.js'),
    context,
    { filename: 'voice-halfduplex-ui.js' },
  );

  fakeWindow.VoiceHalfDuplexUi.init({
    config: { halfDuplexEnabled },
    apiFetch: async () => ({ ok: true }),
    showToast: () => {},
  });

  return { elements, coreCalls, ui: fakeWindow.VoiceHalfDuplexUi, hooks };
}

test('the panel stays hidden and the button never appears while the flag is off', () => {
  const { elements, coreCalls } = loadUi({ halfDuplexEnabled: false });

  assert.equal(elements['voice-hd-button'].hidden, true);
  assert.deepEqual(coreCalls, []);
});

test('the button toggles the loop and reflects the pressed state', () => {
  const { elements, coreCalls, hooks } = loadUi();

  assert.equal(elements['voice-hd-button'].hidden, false);
  assert.equal(elements['voice-hd-button'].getAttribute('aria-pressed'), 'false');
  assert.equal(elements['voice-hd-panel'].hidden, true);

  elements['voice-hd-button'].dispatch('click');
  assert.deepEqual(coreCalls.at(-1), ['start']);

  hooks.onPhase('listening');
  assert.equal(elements['voice-hd-status'].textContent, '듣고 있어');
  assert.equal(elements['voice-hd-dot'].dataset.phase, 'listening');
  assert.equal(elements['voice-hd-panel'].hidden, false);
  assert.equal(elements['voice-hd-button'].getAttribute('aria-pressed'), 'true');

  elements['voice-hd-button'].dispatch('click');
  assert.deepEqual(coreCalls.at(-1), ['stop']);
});

test('every phase renders a distinct label so a stuck loop is visible', () => {
  const { elements, hooks, ui } = loadUi();
  const seen = new Set();

  for (const phase of Object.keys(ui.PHASE_LABELS)) {
    hooks.onPhase(phase);
    assert.equal(elements['voice-hd-dot'].dataset.phase, phase);
    assert.ok(elements['voice-hd-status'].textContent.length > 0);
    seen.add(elements['voice-hd-status'].textContent);
  }
  // 라벨이 겹치면 어느 상태에서 멈췄는지 화면으로 구분할 수 없다.
  assert.equal(seen.size, Object.keys(ui.PHASE_LABELS).length);
});

test('transcripts and answers land in the log as separate rows', () => {
  const { elements, hooks } = loadUi();

  hooks.onTranscript('내일 일정 알려줘');
  hooks.onAnswer('오전 10시에 하나 있어.');

  const log = elements['voice-hd-log'];
  assert.equal(log.children.length, 2);
  assert.equal(log.children[0].className, 'voice-hd-row voice-hd-user');
  assert.equal(log.children[0].textContent, '내일 일정 알려줘');
  assert.equal(log.children[1].className, 'voice-hd-row voice-hd-assistant');
  assert.equal(log.scrollTop, log.scrollHeight);
});

test('the stop control ends the loop from inside the panel', () => {
  const { elements, coreCalls } = loadUi();

  elements['voice-hd-stop'].dispatch('click');
  assert.deepEqual(coreCalls.at(-1), ['stop']);
});

test('the page loads the loop before its UI and both before app.js', () => {
  const html = read('public/index.html');

  assert.ok(html.indexOf('voice-turn-recorder.js') < html.indexOf('voice-halfduplex.js'));
  assert.ok(html.indexOf('voice-halfduplex.js') < html.indexOf('voice-halfduplex-ui.js'));
  assert.ok(html.indexOf('voice-halfduplex-ui.js') < html.indexOf('app.js'));
  assert.match(html, /id="voice-hd-panel"[^>]*hidden/);
  assert.match(html, /id="voice-hd-button"[^>]*hidden/);
  assert.match(read('public/app.js'), /VoiceHalfDuplexUi\?\.init\(\{[\s\S]*?config: config\.halfDuplexVoice/);
});
