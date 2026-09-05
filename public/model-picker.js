'use strict';

(function setupChatModelPicker(global) {
  const state = {
    initialized: false,
    apiFetch: null,
    showToast: null,
    isAnswering: null,
    button: null,
    label: null,
    panel: null,
    options: null,
    status: null,
    catalog: null,
    saving: false,
    returnFocus: null,
  };

  function visibleOptions(catalog) {
    const versions = new Map();
    const rows = catalog.options.map(option => {
      const match = /^gpt-(\d+)(?:\.(\d+))?/.exec(option.modelId || option.value);
      const version = match ? [Number(match[1]), Number(match[2] || 0)] : null;
      const key = version?.join('.');
      if (version) versions.set(key, version);
      return { option, key };
    });
    const recent = new Set([...versions]
      .sort(([, a], [, b]) => b[0] - a[0] || b[1] - a[1])
      .slice(0, 2).map(([key]) => key));
    // 표시 범위만 줄인다. 현재 pin과 버전을 모르는 새 naming은 숨기지 않는다.
    return rows.filter(({ option, key }) => !key || recent.has(key) || option.value === catalog.selection)
      .map(({ option }) => option);
  }

  function displayModelName(modelId) {
    return String(modelId || '')
      .replace(/-([a-z][a-z0-9]*)/gi, (_, segment) => ` ${segment[0].toUpperCase()}${segment.slice(1)}`)
      .replace(/^gpt(?=[- ])/i, 'GPT');
  }

  function close({ restoreFocus = false } = {}) {
    if (!state.panel || state.panel.hidden) return;
    state.panel.hidden = true;
    state.button.setAttribute('aria-expanded', 'false');
    if (restoreFocus) (state.returnFocus || state.button).focus();
  }

  function open() {
    if (!state.catalog || state.saving) return;
    state.returnFocus = document.activeElement;
    state.panel.hidden = false;
    state.button.setAttribute('aria-expanded', 'true');
    const selected = state.options.querySelector('[aria-selected="true"]');
    (selected || state.options.querySelector('button'))?.focus();
  }

  function toggle() {
    if (state.panel.hidden) open();
    else close({ restoreFocus: true });
  }

  function statusText(catalog) {
    if (!catalog?.resolvedModelId) return catalog?.options?.length
      ? '선택한 모델을 사용할 수 없어. 다른 모델을 선택해줘.'
      : '사용 가능한 GPT 모델을 확인하지 못했어.';
    if (catalog.catalog?.status === 'stale') return '마지막 정상 목록을 사용 중이야.';
    if (catalog.catalog?.status === 'fallback') return '기본 검증 모델을 사용 중이야.';
    return '선택은 다음 답변부터 적용돼.';
  }

  function render() {
    const catalog = state.catalog;
    if (!catalog) {
      state.label.textContent = '모델';
      state.button.disabled = true;
      return;
    }
    const selected = catalog.options.find(option => option.value === catalog.selection);
    state.label.textContent = selected?.label || displayModelName(catalog.selection) || '모델';
    state.button.title = `${state.label.textContent} · ${displayModelName(catalog.resolvedModelId) || '사용 불가'}`;
    state.button.disabled = state.saving || catalog.options.length === 0;
    state.status.textContent = statusText(catalog);
    state.status.classList.toggle('warn', !catalog.resolvedModelId || ['stale', 'fallback'].includes(catalog.catalog?.status));
    state.options.replaceChildren();

    visibleOptions(catalog).forEach(option => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'chat-model-option';
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', String(option.value === catalog.selection));
      item.dataset.value = option.value;

      const copy = document.createElement('span');
      copy.className = 'chat-model-option-copy';
      const name = document.createElement('strong');
      name.textContent = option.label;
      const description = document.createElement('span');
      description.textContent = option.description || '';
      copy.append(name, description);

      const meta = document.createElement('span');
      meta.className = 'chat-model-option-meta';
      meta.textContent = option.value === 'auto:balanced'
        ? displayModelName(option.resolvedModelId)
        : displayModelName(option.modelId || option.value);
      item.append(copy, meta);
      item.addEventListener('click', () => select(option.value));
      state.options.appendChild(item);
    });
  }

  async function select(selection) {
    if (state.saving || selection === state.catalog?.selection) {
      close({ restoreFocus: true });
      return;
    }
    const changedDuringAnswer = state.isAnswering();
    state.saving = true;
    render();
    try {
      const response = await state.apiFetch('/api/settings/chat-model', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'If-Match': `"${state.catalog.selectionVersion}"`,
        },
        body: JSON.stringify({ selection }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || '모델을 변경하지 못했어.');
      state.catalog = data;
      state.showToast(changedDuringAnswer ? '다음 답변부터 새 모델을 쓸게' : '모델을 변경했어');
    } catch (error) {
      state.showToast(error.message);
      await refresh();
      return;
    } finally {
      state.saving = false;
      render();
    }
    close({ restoreFocus: true });
  }

  async function refresh() {
    try {
      const response = await state.apiFetch('/api/models/chat');
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || '모델 목록을 불러오지 못했어.');
      state.catalog = data;
    } catch (error) {
      state.catalog = null;
      state.status.textContent = error.message;
      state.status.classList.add('warn');
    }
    render();
  }

  function moveFocus(event) {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const items = [...state.options.querySelectorAll('button:not(:disabled)')];
    if (items.length === 0) return;
    event.preventDefault();
    const current = items.indexOf(document.activeElement);
    let next = 0;
    if (event.key === 'End') next = items.length - 1;
    else if (event.key === 'ArrowUp') next = current <= 0 ? items.length - 1 : current - 1;
    else if (event.key === 'ArrowDown') next = current < 0 || current === items.length - 1 ? 0 : current + 1;
    items[next].focus();
  }

  function init({ apiFetch, showToast, isAnswering }) {
    if (state.initialized) return;
    const button = document.getElementById('chat-model-button');
    const label = document.getElementById('chat-model-button-label');
    const panel = document.getElementById('chat-model-menu');
    const options = document.getElementById('chat-model-options');
    const status = document.getElementById('chat-model-status');
    if (
      typeof apiFetch !== 'function'
      || typeof showToast !== 'function'
      || typeof isAnswering !== 'function'
      || !button || !label || !panel || !options || !status
    ) {
      throw new TypeError('ChatModelPicker 초기화 인자가 올바르지 않습니다.');
    }
    Object.assign(state, {
      apiFetch,
      showToast,
      isAnswering,
      button,
      label,
      panel,
      options,
      status,
      initialized: true,
    });
    button.addEventListener('click', toggle);
    panel.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close({ restoreFocus: true });
      } else {
        moveFocus(event);
      }
    });
    document.addEventListener('click', event => {
      if (!event.composedPath().some(node => node.id === 'chat-model-control')) close();
    });
    void refresh();
  }

  global.ChatModelPicker = { close, init, refresh };
})(window);
