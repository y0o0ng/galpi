'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const app = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
const historySource = app.slice(
  app.indexOf('let lastRenderedMsgId = 0;'),
  app.indexOf('function restoreLocalUiHistory()'),
);

function page(firstId, count = 50, overrides = {}) {
  return Array.from({ length: count }, (_, index) => {
    const id = firstId + index;
    return {
      id,
      role: id % 2 ? 'user' : 'assistant',
      content: `message-${id}`,
      model: id % 2 ? null : 'gpt-test',
      createdAt: 1_800_000_000 + id,
      noteSaved: false,
      attachments: [],
      ...overrides[id],
    };
  });
}

function jsonResponse(body, ok = true) {
  return { ok, async json() { return body; } };
}

function createHarness() {
  const calls = [];
  const responses = [];
  const toasts = [];
  const chat = { scrollHeight: 0, scrollTop: 0 };
  const messagesNode = {
    get innerHTML() { return ''; },
    set innerHTML(_value) {
      chat.scrollHeight = 0;
      chat.scrollTop = 0;
    },
  };
  const append = () => {
    chat.scrollHeight += 10;
    chat.scrollTop = chat.scrollHeight;
  };
  const context = {
    URLSearchParams,
    sessionId: 'shared-main',
    window: {
      AttachmentUi: {
        getMessageSignature(messages) {
          return messages.map(message =>
            `${message.id}:${message.attachments.map(item => item.attachmentId).join(',')}`
          ).join('|');
        },
      },
    },
    document: {
      hidden: false,
      getElementById(id) {
        assert.equal(id, 'chat');
        return chat;
      },
      querySelectorAll() { return []; },
    },
    getMessages: () => messagesNode,
    appendUserBubble: append,
    appendHistoryBubble: append,
    markSaveButtonSaved() {},
    restoreLocalUiHistory() {},
    showToast(message) { toasts.push(message); },
    requestAnimationFrame(callback) { callback(); },
    isRestoringHistory: false,
    isLoading: false,
    async apiFetch(url) {
      calls.push(url);
      return await responses.shift();
    },
  };
  vm.runInNewContext(`${historySource}
    globalThis.historyTest = {
      loadHistory,
      loadOlderHistory,
      onHistoryScroll,
      pollForUpdates,
      state: () => ({
        messages: loadedHistoryMessages,
        hasMore: historyHasMore,
        loadingOlder: historyLoadingOlder,
      }),
    };
  `, context, { filename: 'app-history.js' });
  return { ...context.historyTest, calls, responses, toasts, chat };
}

const flush = () => new Promise(resolve => setImmediate(resolve));

test('history loads 50, prepends once at the top, deduplicates, and preserves scroll', async () => {
  const harness = createHarness();
  harness.responses.push(jsonResponse({ messages: page(51), has_more: true }));
  await harness.loadHistory();

  assert.deepEqual(harness.calls, ['/api/sessions/shared-main?limit=50']);
  assert.equal(harness.state().messages.length, 50);
  assert.equal(harness.chat.scrollHeight, 500);

  let finishOlder;
  harness.responses.push(new Promise(resolve => { finishOlder = resolve; }));
  harness.chat.scrollTop = 20;
  harness.onHistoryScroll();
  harness.onHistoryScroll();
  await flush();
  assert.equal(harness.calls.length, 2);
  assert.equal(harness.state().loadingOlder, true);

  finishOlder(jsonResponse({
    messages: [...page(1), page(51, 1)[0]],
    has_more: false,
  }));
  await flush();
  await flush();

  const ids = harness.state().messages.map(message => message.id);
  assert.deepEqual([...ids], Array.from({ length: 100 }, (_, index) => index + 1));
  assert.equal(new Set(ids).size, 100);
  assert.equal(harness.chat.scrollTop, 520);
  assert.equal(harness.state().hasMore, false);

  harness.chat.scrollTop = 0;
  harness.onHistoryScroll();
  await flush();
  assert.equal(harness.calls.length, 2);
});

test('a failed older request keeps history and can retry', async () => {
  const harness = createHarness();
  harness.responses.push(jsonResponse({ messages: page(51), has_more: true }));
  await harness.loadHistory();
  const before = harness.state().messages.map(message => message.id);

  harness.responses.push(jsonResponse({ error: 'failed' }, false));
  harness.chat.scrollTop = 0;
  harness.onHistoryScroll();
  await flush();
  await flush();
  assert.deepEqual(harness.state().messages.map(message => message.id), before);
  assert.equal(harness.state().loadingOlder, false);
  assert.equal(harness.toasts.length, 1);

  harness.responses.push(jsonResponse({ messages: page(1), has_more: false }));
  harness.onHistoryScroll();
  await flush();
  await flush();
  assert.equal(harness.calls.length, 3);
  assert.equal(harness.state().messages.length, 100);
});

test('bounded polling merges the latest window without discarding older pages or save state', async () => {
  const harness = createHarness();
  harness.responses.push(jsonResponse({ messages: page(51), has_more: true }));
  await harness.loadHistory();
  harness.responses.push(jsonResponse({
    messages: page(1, 50, { 10: { noteSaved: true } }),
    has_more: false,
  }));
  harness.chat.scrollTop = 0;
  await harness.loadOlderHistory();

  harness.responses.push(jsonResponse({
    messages: page(76, 50, { 100: { noteSaved: true } }),
    has_more: true,
  }));
  await harness.pollForUpdates();

  assert.equal(harness.calls.at(-1), '/api/sessions/shared-main?limit=50');
  const messages = harness.state().messages;
  assert.deepEqual(
    [...messages.map(message => message.id)],
    page(1, 125).map(message => message.id),
  );
  assert.equal(messages.find(message => message.id === 10).noteSaved, true);
  assert.equal(messages.find(message => message.id === 100).noteSaved, true);
});
