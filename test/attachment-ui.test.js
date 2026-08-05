'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(ROOT, 'public/attachment-ui.js'), 'utf8');

function fakeElement(id = '') {
  const listeners = new Map();
  const classes = new Set();
  const element = {
    id,
    hidden: false,
    value: '',
    files: [],
    children: [],
    dataset: {},
    attributes: new Map(),
    parentNode: null,
    className: '',
    textContent: '',
    title: '',
    type: '',
    classList: {
      add(...names) { names.forEach(name => classes.add(name)); },
      contains(name) { return classes.has(name) || element.className.split(/\s+/).includes(name); },
    },
    addEventListener(type, listener) { listeners.set(type, listener); },
    dispatch(type) { return listeners.get(type)?.(); },
    click() { this.clicked = true; },
    setAttribute(name, value) { this.attributes.set(name, String(value)); },
    getAttribute(name) { return this.attributes.get(name); },
    append(...nodes) { nodes.forEach(node => this.appendChild(node)); },
    appendChild(node) {
      node.parentNode = this;
      this.children.push(node);
      return node;
    },
    replaceChildren(...nodes) {
      this.children.forEach(node => { node.parentNode = null; });
      this.children = [];
      this.append(...nodes);
    },
    querySelector(selector) {
      if (!selector.startsWith('.')) return null;
      const className = selector.slice(1);
      return this.children.find(child => child.classList?.contains(className)) || null;
    },
    remove() {
      if (!this.parentNode) return;
      this.parentNode.children = this.parentNode.children.filter(child => child !== this);
      this.parentNode = null;
    },
  };
  return element;
}

class FakeFile {
  constructor(parts, name, options = {}) {
    this.name = name;
    this.type = options.type || '';
    this.lastModified = options.lastModified || 0;
    this.size = parts.reduce((total, part) => total + Number(part.size || part.length || 0), 0);
  }
}

class FakeFormData {
  constructor() { this.values = new Map(); }
  append(name, value) { this.values.set(name, value); }
  get(name) { return this.values.get(name); }
}

function loadUi({
  enabled = true,
  apiFetch,
  sessionId = 'shared-main',
  maxFilesPerMessage = 1,
  maxDocumentsPerMessage = 1,
  maxImageBytesPerMessage = 12 * 1024 * 1024,
} = {}) {
  const elements = {
    'attachment-button': fakeElement('attachment-button'),
    'attachment-input': fakeElement('attachment-input'),
    'attachment-draft': fakeElement('attachment-draft'),
  };
  const toasts = [];
  const fakeWindow = {
    document: {
      getElementById: id => elements[id] || null,
      createElement: tag => fakeElement(tag),
    },
    File: FakeFile,
    FormData: FakeFormData,
    AbortController,
  };
  vm.runInNewContext(source, { window: fakeWindow, console }, { filename: 'attachment-ui.js' });
  fakeWindow.AttachmentUi.init({
    config: {
      enabled,
      maxFilesPerMessage,
      maxDocumentsPerMessage,
      maxPdfBytes: 20 * 1024 * 1024,
      maxImageBytes: 10 * 1024 * 1024,
      maxImageBytesPerMessage,
      maxTextBytes: 2 * 1024 * 1024,
    },
    apiFetch: apiFetch || (async () => ({ ok: true, json: async () => ({}) })),
    showToast: message => toasts.push(message),
    getSessionId: () => sessionId,
  });
  return { elements, toasts, ui: fakeWindow.AttachmentUi };
}

const settle = () => new Promise(resolve => setImmediate(resolve));

test('the clip button stays absent while the server flag is off', () => {
  const { elements } = loadUi({ enabled: false });
  assert.equal(elements['attachment-button'].hidden, true);
});

test('one selected file uploads with the authenticated fetch and becomes the send draft', async () => {
  let uploadedFile = null;
  const { elements, ui } = loadUi({
    apiFetch: async (url, options) => {
      assert.equal(url, '/api/attachments');
      assert.equal(options.method, 'POST');
      uploadedFile = options.body.get('file');
      return {
        ok: true,
        json: async () => ({
          attachmentId: 'att_ui_1',
          filename: '강의.md',
          kind: 'markdown',
          mimeType: 'text/markdown',
          sizeBytes: 12,
          status: 'uploaded_unattached',
        }),
      };
    },
  });
  elements['attachment-input'].files = [new FakeFile(['열두 글자 자료'], '강의.md')];
  elements['attachment-input'].dispatch('change');
  await settle();
  await settle();

  assert.equal(elements['attachment-button'].hidden, false);
  assert.equal(uploadedFile.type, 'text/markdown', '빈 브라우저 MIME은 확장자의 허용 MIME으로 보정한다');
  assert.deepEqual(
    Array.from(ui.getReadyAttachments(), item => item.attachmentId), ['att_ui_1']);
  assert.equal(elements['attachment-draft'].hidden, false);
  assert.equal(elements['attachment-draft'].children[0].children[0].textContent, 'MD');
  assert.equal(elements['attachment-draft'].children[0].children[1].children[0].textContent, '강의.md');
});

test('send waits while an upload is still in flight and cancellation clears the draft', async () => {
  const { elements, toasts, ui } = loadUi({
    apiFetch: () => new Promise(() => {}),
  });
  elements['attachment-input'].files = [new FakeFile(['내용'], '자료.txt', { type: 'text/plain' })];
  elements['attachment-input'].dispatch('change');
  await settle();

  assert.equal(ui.isUploading(), true);
  assert.equal(elements['attachment-button'].disabled, true);
  assert.equal(ui.requireReadyForSend(), false);
  assert.match(toasts[0], /업로드가 끝날 때까지/);
  elements['attachment-draft'].children[0].children.at(-1).dispatch('click');
  assert.equal(ui.isUploading(), false);
  assert.equal(elements['attachment-button'].disabled, false);
  assert.equal(elements['attachment-draft'].hidden, true);
});

test('new messages and restored history use the same card and expired tombstone renderer', () => {
  const { ui } = loadUi();
  const target = fakeElement('message');
  const attachment = {
    attachmentId: 'att_ui_2',
    filename: '사진.png',
    kind: 'image',
    sizeBytes: 2048,
    status: 'attached_temporary',
    expired: false,
  };

  ui.renderMessageAttachments(target, [attachment], { transientStatus: 'sending' });
  assert.equal(target.children.length, 1);
  assert.match(target.children[0].children[0].children[1].children[1].textContent, /보내는 중/);

  ui.renderMessageAttachments(target, [{ ...attachment, status: 'expired', expired: true }]);
  const card = target.children[0].children[0];
  assert.equal(card.classList.contains('is-expired'), true);
  assert.match(card.children[1].children[1].textContent, /첨부 만료됨/);
});

test('a linked document promotes through one explicit library action and settles in place', async () => {
  const calls = [];
  const { ui, toasts } = loadUi({
    sessionId: 'session-library',
    apiFetch: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        json: async () => ({
          status: 'library',
          duplicate: false,
          title: '강의 자료',
        }),
      };
    },
  });
  const target = fakeElement('message');
  const attachment = {
    attachmentId: 'att_ui_library',
    filename: '강의 자료.md',
    kind: 'markdown',
    sizeBytes: 4096,
    status: 'attached_temporary',
  };

  ui.renderMessageAttachments(target, [attachment]);
  const card = target.children[0].children[0];
  const action = card.children[2];
  assert.equal(action.textContent, '서재 저장');
  action.dispatch('click');
  await settle();
  await settle();

  assert.equal(calls[0].url, '/api/attachments/att_ui_library/library');
  assert.equal(calls[0].options.method, 'POST');
  assert.deepEqual(JSON.parse(calls[0].options.body), { sessionId: 'session-library' });
  assert.equal(attachment.status, 'library');
  assert.equal(action.disabled, true);
  assert.equal(action.textContent, '저장됨');
  assert.match(card.children[1].children[1].textContent, /서재 저장됨/);
  assert.match(toasts[0], /서재에 저장됨/);
});

test('poll signatures change when attachment lifecycle changes without a new message', () => {
  const { ui } = loadUi();
  const messages = [{
    id: 7,
    attachments: [{ attachmentId: 'att_ui_3', status: 'attached_temporary', expired: false }],
  }];
  const before = ui.getMessageSignature(messages);
  const after = ui.getMessageSignature([{
    ...messages[0],
    attachments: [{ attachmentId: 'att_ui_3', status: 'expired', expired: true }],
  }]);
  assert.notEqual(before, after);
});

test('여러 이미지를 한 초안에 쌓고 개별로 취소한다', async () => {
  const uploaded = [];
  const { elements, ui } = loadUi({
    maxFilesPerMessage: 6,
    apiFetch: async (url, options) => {
      const name = options.body.get('file').name;
      uploaded.push(name);
      return {
        ok: true,
        json: async () => ({
          attachmentId: `att_ui_${uploaded.length}`,
          filename: name,
          kind: 'image',
          mimeType: 'image/png',
          sizeBytes: 10,
          status: 'uploaded_unattached',
        }),
      };
    },
  });

  assert.equal(elements['attachment-input'].multiple, true);
  elements['attachment-input'].files = [
    new FakeFile(['1'], '하나.png', { type: 'image/png' }),
    new FakeFile(['2'], '둘.png', { type: 'image/png' }),
    new FakeFile(['3'], '셋.png', { type: 'image/png' }),
  ];
  elements['attachment-input'].dispatch('change');
  await settle();
  await settle();

  assert.deepEqual(uploaded, ['하나.png', '둘.png', '셋.png']);
  assert.deepEqual(
    Array.from(ui.getReadyAttachments(), item => item.filename),
    ['하나.png', '둘.png', '셋.png'],
  );
  assert.equal(elements['attachment-draft'].children.length, 3);
  // 한도에 안 찼으면 클립 버튼은 계속 열려 있다.
  assert.equal(elements['attachment-button'].disabled, false);

  // 두 번째 카드의 취소 버튼만 누른다.
  elements['attachment-draft'].children[1].children.at(-1).dispatch('click');
  assert.deepEqual(
    Array.from(ui.getReadyAttachments(), item => item.filename),
    ['하나.png', '셋.png'],
  );

  ui.clearAfterSend(['att_ui_1', 'att_ui_3']);
  assert.equal(ui.getReadyAttachments().length, 0);
  assert.equal(elements['attachment-draft'].hidden, true);
});

test('메시지당 문서 수와 이미지 합계를 붙이는 순간 막는다', async () => {
  const { elements, ui } = loadUi({
    maxFilesPerMessage: 6,
    maxImageBytesPerMessage: 25,
    apiFetch: async (url, options) => {
      const file = options.body.get('file');
      return {
        ok: true,
        json: async () => ({
          attachmentId: `att_ui_${file.name}`,
          filename: file.name,
          kind: file.name.endsWith('.png') ? 'image' : 'markdown',
          mimeType: file.name.endsWith('.png') ? 'image/png' : 'text/markdown',
          sizeBytes: file.size,
          status: 'uploaded_unattached',
        }),
      };
    },
  });

  elements['attachment-input'].files = [new FakeFile(['문서'], '첫.md')];
  elements['attachment-input'].dispatch('change');
  await settle();
  await settle();
  elements['attachment-input'].files = [new FakeFile(['문서'], '둘.md')];
  elements['attachment-input'].dispatch('change');
  await settle();
  assert.match(elements['attachment-draft'].children.at(-1).textContent, /문서는 한 번에 1개까지/);
  assert.equal(ui.getReadyAttachments().length, 1);

  elements['attachment-input'].files = [new FakeFile(['0123456789'], '큰1.png', { type: 'image/png' })];
  elements['attachment-input'].dispatch('change');
  await settle();
  await settle();
  elements['attachment-input'].files = [new FakeFile(['0123456789'], '큰2.png', { type: 'image/png' })];
  elements['attachment-input'].dispatch('change');
  await settle();
  await settle();
  assert.equal(ui.getReadyAttachments().length, 3);

  // 합계 25바이트를 넘기는 세 번째 이미지는 업로드 자체를 시작하지 않는다.
  elements['attachment-input'].files = [new FakeFile(['0123456789'], '큰3.png', { type: 'image/png' })];
  elements['attachment-input'].dispatch('change');
  await settle();
  assert.match(elements['attachment-draft'].children.at(-1).textContent, /이미지는 한 번에 합쳐서/);
  assert.equal(ui.getReadyAttachments().length, 3);
});
