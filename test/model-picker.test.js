'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { buildOpenAIChatCatalogView, resolveChatModelSelection } = require('../lib/openai-model-catalog');

for (const replacement of ['auto:balanced', 'gpt-5.6-terra']) {
  test(`unavailable exact pin stays unchanged until the user selects ${replacement}`, async () => {
    const document = {
      activeElement: null, listeners: {},
      addEventListener(type, listener) { this.listeners[type] = listener; },
    };
    class Element {
      constructor() {
        this.children = [];
        this.dataset = {};
        this.attributes = {};
        this.listeners = {};
        this.disabled = false;
        this.classList = {
          values: new Set(),
          add(value) { this.values.add(value); },
          toggle(value, on) { if (on) this.values.add(value); else this.values.delete(value); },
          contains(value) { return this.values.has(value); },
        };
      }
      setAttribute(key, value) { this.attributes[key] = value; }
      addEventListener(type, listener) { this.listeners[type] = listener; }
      append(...children) { this.children.push(...children); }
      appendChild(child) { this.append(child); }
      replaceChildren(...children) { this.children = children; }
      querySelector(selector) {
        return selector === '[aria-selected="true"]'
          ? this.children.find(child => child.attributes['aria-selected'] === 'true')
          : this.children[0];
      }
      focus() { if (!this.disabled) document.activeElement = this; }
      click() { if (!this.disabled) return this.listeners.click?.(); }
    }
    const elements = Object.fromEntries(['button', 'button-label', 'menu', 'options', 'status']
      .map(name => [`chat-model-${name}`, new Element()]));
    document.getElementById = id => elements[id];
    document.createElement = () => new Element();
    const button = elements['chat-model-button'];
    const menu = elements['chat-model-menu'];
    const status = elements['chat-model-status'];
    menu.hidden = true;
    const catalogRow = { generation: 1, lastSuccessAt: 1, payload: {
      active: { balanced: 'gpt-5.6-terra' },
      models: [{ id: 'gpt-5.6-terra', probeStatus: 'compatible' }],
    } };
    let setting = { value: 'gpt-6-astra', version: 1 };
    const writes = [];
    let finishSave;
    const saveGate = new Promise(resolve => { finishSave = resolve; });
    const window = {};
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/model-picker.js'), 'utf8'),
      { window, document });
    window.ChatModelPicker.init({
      async apiFetch(url, options) {
        if (options?.method === 'PUT') {
          assert.equal(url, '/api/settings/chat-model');
          assert.equal(options.headers['If-Match'], '"1"');
          writes.push(JSON.parse(options.body));
          await saveGate;
          setting = { value: writes[0].selection, version: 2 };
        }
        return { ok: true, json: async () => buildOpenAIChatCatalogView({ catalogRow, setting }) };
      },
      showToast() {},
      isAnswering: () => false,
    });
    await window.ChatModelPicker.refresh();
    assert.equal(button.disabled, false);
    assert.equal(elements['chat-model-button-label'].textContent, 'GPT-6 Astra');
    assert.equal(status.classList.contains('warn'), true);
    assert.match(status.textContent, /다른 모델/);
    assert.deepEqual(writes, []);
    assert.throws(() => resolveChatModelSelection({ selection: setting.value, catalogRow }),
      { code: 'MODEL_UNAVAILABLE' });

    button.focus();
    button.click();
    assert.equal(menu.hidden, false);
    assert.equal(button.attributes['aria-expanded'], 'true');
    const option = elements['chat-model-options'].children.find(child => child.dataset.value === replacement);
    const saving = option.click();
    assert.equal(button.disabled, true);
    // render() detaches the clicked item before its event reaches document.
    document.listeners.click({
      target: { closest: () => null },
      composedPath: () => [option, { id: 'chat-model-control' }, document],
    });
    assert.equal(menu.hidden, false);
    assert.equal(setting.value, 'gpt-6-astra');
    assert.deepEqual(writes, [{ selection: replacement }]);
    finishSave();
    await saving;
    assert.equal(setting.value, replacement);
    assert.equal(resolveChatModelSelection({ selection: setting.value, catalogRow }).modelId, 'gpt-5.6-terra');
    assert.equal(button.disabled, false);
    assert.equal(menu.hidden, true);
    assert.equal(button.attributes['aria-expanded'], 'false');
    assert.equal(status.classList.contains('warn'), false);
    assert.equal(document.activeElement, button);
  });
}
