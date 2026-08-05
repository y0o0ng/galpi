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

class FakeImage {
  constructor() { this.width = 800; this.height = 600; }
  set src(value) {
    this._src = value;
    setImmediate(() => (value === 'blob:broken' ? this.onerror?.() : this.onload?.()));
  }
  get src() { return this._src; }
}

function fakeCanvas() {
  const canvas = fakeElement('canvas');
  canvas.drawn = [];
  canvas.getContext = () => ({
    drawImage: (...args) => canvas.drawn.push(args.slice(1)),
  });
  canvas.toDataURL = (type) => `data:${type};base64,THUMB_${canvas.width}x${canvas.height}`;
  return canvas;
}

function makeBlob(size, type) {
  return {
    size,
    type,
    slice(start, end, nextType) { return makeBlob(end - start, nextType); },
  };
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
  const opened = [];
  const revoked = [];
  const objectUrls = [];
  const popupStub = { closed: false, location: null, close() { this.closed = true; } };
  const fakeWindow = {
    document: {
      getElementById: id => elements[id] || null,
      createElement: tag => (tag === 'canvas' ? fakeCanvas() : fakeElement(tag)),
    },
    Image: FakeImage,
    File: FakeFile,
    FormData: FakeFormData,
    AbortController,
    URL: {
      createObjectURL: (blob) => { objectUrls.push(blob); return 'blob:fake'; },
      revokeObjectURL: (url) => { revoked.push(url); },
    },
    setTimeout: (fn) => fn,
    open: (...args) => { opened.push(args); return popupStub; },
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
  return { elements, toasts, ui: fakeWindow.AttachmentUi, opened, popupStub, objectUrls, revoked };
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
  const action = card.children.find(child => child.className === 'attachment-card-library');
  assert.ok(action, '서재 저장 버튼이 있어야 한다');
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

test('원본 열기는 클릭 시점에 창을 먼저 잡고 인증 fetch로 blob을 보낸다', async () => {
  const calls = [];
  const { ui, opened, popupStub } = loadUi({
    sessionId: 'session-original',
    apiFetch: async (url) => {
      calls.push(url);
      // 창은 fetch가 끝나기 전에 이미 잡혀 있어야 iOS에서 안 막힌다.
      assert.equal(opened.length, 1, 'fetch 시작 시점에 창이 이미 열려 있어야 한다');
      return { ok: true, blob: async () => makeBlob(3, 'image/png') };
    },
  });
  const target = fakeElement('message');
  ui.renderMessageAttachments(target, [{
    attachmentId: 'att_original_1',
    filename: '사분면 이미지.png',
    kind: 'image',
    sizeBytes: 971,
    status: 'attached_temporary',
  }]);
  const card = target.children[0].children[0];
  const openButton = card.children.find(c => c.className === 'attachment-card-original');
  assert.ok(openButton, '원본 버튼이 있어야 한다');

  await openButton.dispatch('click');
  await settle();
  await settle();

  assert.deepEqual(opened, [['', '_blank']]);
  // 이미지 카드는 썸네일도 같은 라우트를 쓴다. 썸네일은 축소본만 남기고 원본을
  // 버리므로 열기는 새로 받아야 한다.
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.match(call, /^\/api\/attachments\/att_original_1\/original\?sessionId=session-original$/);
  }
  assert.equal(popupStub.location, 'blob:fake');
  assert.equal(openButton.textContent, '원본');
  assert.equal(openButton.disabled, false);
});

test('서재 첨부는 원본만, 만료 첨부는 아무 버튼도 없다', () => {
  const { ui } = loadUi();
  const target = fakeElement('message');

  ui.renderMessageAttachments(target, [{
    attachmentId: 'att_lib', filename: '서재.png', kind: 'image', status: 'library',
  }]);
  let classes = target.children[0].children[0].children.map(c => c.className);
  assert.ok(classes.includes('attachment-card-original'), '서재 첨부에 원본 버튼');
  assert.ok(!classes.includes('attachment-card-library'), '이미 서재면 저장 버튼은 없다');

  ui.renderMessageAttachments(target, [{
    attachmentId: 'att_exp', filename: '만료.md', kind: 'markdown', status: 'expired', expired: true,
  }]);
  classes = target.children[0].children[0].children.map(c => c.className);
  assert.ok(!classes.includes('attachment-card-original'), '만료 첨부는 열 수 없다');
  assert.ok(!classes.includes('attachment-card-library'));
});

test('원본 열기가 실패하면 열어둔 창을 닫고 알린다', async () => {
  const { ui, toasts, popupStub } = loadUi({
    apiFetch: async () => ({ ok: false, json: async () => ({ error: '이 첨부파일은 더 이상 열 수 없습니다.' }) }),
  });
  const target = fakeElement('message');
  ui.renderMessageAttachments(target, [{
    attachmentId: 'att_fail', filename: '자료.md', kind: 'markdown', status: 'attached_temporary',
  }]);
  const openButton = target.children[0].children[0].children.find(
    c => c.className === 'attachment-card-original',
  );
  await openButton.dispatch('click');
  await settle();
  await settle();

  assert.equal(popupStub.closed, true, '빈 창을 남겨두지 않는다');
  assert.match(toasts.at(-1), /더 이상 열 수 없습니다/);
  assert.equal(openButton.disabled, false);
});

test('텍스트 원본은 blob 타입을 UTF-8 text/plain으로 다시 씌워 연다', async () => {
  const { ui, objectUrls } = loadUi({
    apiFetch: async () => ({ ok: true, blob: async () => makeBlob(40, 'text/markdown; charset=utf-8') }),
  });
  const target = fakeElement('message');
  ui.renderMessageAttachments(target, [{
    attachmentId: 'att_text_1', filename: '노트.md', kind: 'markdown', status: 'attached_temporary',
  }]);
  const button = target.children[0].children[0].children.find(
    c => c.className === 'attachment-card-original',
  );
  await button.dispatch('click');
  await settle();
  await settle();

  // blob: URL로 열면 서버 Content-Disposition이 안 걸리므로 타입을 여기서 정해야
  // 한글이 안 깨진다.
  assert.equal(objectUrls.length, 1);
  assert.equal(objectUrls[0].type, 'text/plain; charset=utf-8');
});

test('이미지와 PDF 원본은 원래 타입을 유지한다', async () => {
  for (const [kind, type] of [['image', 'image/png'], ['pdf', 'application/pdf']]) {
    const { ui, objectUrls } = loadUi({
      apiFetch: async () => ({ ok: true, blob: async () => makeBlob(9, type) }),
    });
    const target = fakeElement('message');
    ui.renderMessageAttachments(target, [{
      attachmentId: `att_${kind}`, filename: `a.${kind}`, kind, status: 'library',
    }]);
    const button = target.children[0].children[0].children.find(
      c => c.className === 'attachment-card-original',
    );
    await button.dispatch('click');
    await settle();
    await settle();
    assert.equal(objectUrls[0].type, type, `${kind}는 원래 타입을 유지해야 한다`);
  }
});

const imageAttachment = (overrides = {}) => ({
  attachmentId: 'att_thumb_1',
  filename: '사진.png',
  kind: 'image',
  sizeBytes: 4096,
  status: 'attached_temporary',
  ...overrides,
});

test('이미지 카드는 배지 자리를 축소 썸네일로 바꾸고 원본 blob은 놓아준다', async () => {
  let fetches = 0;
  const { ui, revoked } = loadUi({
    apiFetch: async () => { fetches += 1; return { ok: true, blob: async () => makeBlob(4096, 'image/png') }; },
  });
  const target = fakeElement('message');
  ui.renderMessageAttachments(target, [imageAttachment()]);
  await settle(); await settle(); await settle();

  const badge = target.children[0].children[0].children[0];
  assert.equal(badge.classList.contains('has-thumb'), true);
  const img = badge.children[0];
  assert.equal(img.className, 'attachment-card-thumb');
  // 800x600을 긴 변 72px 기준으로 줄인다.
  assert.equal(img.src, 'data:image/jpeg;base64,THUMB_72x54');
  assert.equal(badge.textContent, '');
  // 축소본만 남기고 큰 원본은 즉시 해제한다.
  assert.deepEqual(revoked, ['blob:fake']);
  assert.equal(fetches, 1);
});

test('다시 그려도 캐시를 써서 원본을 다시 받지 않는다', async () => {
  let fetches = 0;
  const { ui } = loadUi({
    apiFetch: async () => { fetches += 1; return { ok: true, blob: async () => makeBlob(4096, 'image/png') }; },
  });
  const target = fakeElement('message');
  ui.renderMessageAttachments(target, [imageAttachment()]);
  await settle(); await settle(); await settle();
  assert.equal(fetches, 1);

  ui.renderMessageAttachments(target, [imageAttachment()]);
  await settle();
  assert.equal(fetches, 1, '폴링이 카드를 다시 그려도 재다운로드하지 않는다');
  assert.equal(target.children[0].children[0].children[0].children[0].src,
    'data:image/jpeg;base64,THUMB_72x54');
});

test('만료 이미지와 문서 첨부는 글자 배지를 유지한다', async () => {
  let fetches = 0;
  const { ui } = loadUi({
    apiFetch: async () => { fetches += 1; return { ok: true, blob: async () => makeBlob(1, 'image/png') }; },
  });
  const target = fakeElement('message');

  ui.renderMessageAttachments(target, [imageAttachment({
    attachmentId: 'att_thumb_expired', status: 'expired', expired: true,
  })]);
  await settle(); await settle();
  assert.equal(target.children[0].children[0].children[0].textContent, 'IMG');

  ui.renderMessageAttachments(target, [{
    attachmentId: 'att_thumb_doc', filename: '자료.md', kind: 'markdown', status: 'attached_temporary',
  }]);
  await settle(); await settle();
  assert.equal(target.children[0].children[0].children[0].textContent, 'MD');
  assert.equal(fetches, 0, '만료·문서는 원본을 받지 않는다');
});

test('썸네일 생성이 실패하면 글자 배지로 남는다', async () => {
  const { ui } = loadUi({
    apiFetch: async () => ({ ok: false, json: async () => ({ error: '없음' }) }),
  });
  const target = fakeElement('message');
  ui.renderMessageAttachments(target, [imageAttachment({ attachmentId: 'att_thumb_fail' })]);
  await settle(); await settle(); await settle();

  const badge = target.children[0].children[0].children[0];
  assert.equal(badge.textContent, 'IMG');
  assert.equal(badge.classList.contains('has-thumb'), false);
});

test('초안 이미지는 네트워크 없이 로컬 파일로 그린다', async () => {
  let fetches = 0;
  const { elements } = loadUi({
    apiFetch: async () => {
      fetches += 1;
      return { ok: true, json: async () => ({
        attachmentId: 'att_draft_1', filename: '초안.png', kind: 'image',
        mimeType: 'image/png', sizeBytes: 10, status: 'uploaded_unattached',
      }) };
    },
  });
  elements['attachment-input'].files = [new FakeFile(['0123456789'], '초안.png', { type: 'image/png' })];
  elements['attachment-input'].dispatch('change');
  await settle(); await settle(); await settle();

  const badge = elements['attachment-draft'].children[0].children[0];
  assert.equal(badge.classList.contains('has-thumb'), true);
  assert.equal(badge.children[0].src, 'data:image/jpeg;base64,THUMB_72x54');
  // 업로드 한 번뿐이고 썸네일 때문에 원본을 다시 받지 않는다.
  assert.equal(fetches, 1);
});
