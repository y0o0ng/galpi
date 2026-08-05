'use strict';

// 임시 첨부의 브라우저 상태와 표시만 맡는다. 원본 수명주기와 검증의 정본은 서버다.
(function setupAttachmentUi(global) {
  const MIME_BY_EXTENSION = Object.freeze({
    pdf: 'application/pdf',
    md: 'text/markdown',
    txt: 'text/plain',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
  });

  const KIND_LABELS = Object.freeze({
    pdf: 'PDF',
    markdown: 'MD',
    text: 'TXT',
    image: 'IMG',
  });

  function extensionOf(filename) {
    const match = String(filename || '').toLowerCase().match(/\.([^.]+)$/);
    return match?.[1] || '';
  }

  function kindFromFile(file) {
    const extension = extensionOf(file?.name || file?.filename);
    if (extension === 'pdf') return 'pdf';
    if (extension === 'md') return 'markdown';
    if (extension === 'txt') return 'text';
    if (['jpg', 'jpeg', 'png', 'webp'].includes(extension)) return 'image';
    return null;
  }

  function humanBytes(value) {
    const bytes = Number(value) || 0;
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  }

  function setupModule() {
    let apiFetch = global.fetch?.bind(global);
    let showToast = () => {};
    let getSessionId = () => 'shared-main';
    let config = null;
    const promotingIds = new Set();
    // 초안은 여러 개다. 각 항목이 자기 업로드 상태와 취소 컨트롤러를 들고 있다.
    let drafts = [];
    let draftError = '';
    let nextDraftKey = 0;

    const el = id => global.document.getElementById(id);

    function limitFor(kind) {
      if (kind === 'pdf') return Number(config?.maxPdfBytes || 0);
      if (kind === 'image') return Number(config?.maxImageBytes || 0);
      return Number(config?.maxTextBytes || 0);
    }

    function maxFiles() {
      return Math.max(1, Number(config?.maxFilesPerMessage || 1));
    }

    function maxDocuments() {
      return Math.max(1, Number(config?.maxDocumentsPerMessage || 1));
    }

    function maxImageBytesPerMessage() {
      return Number(config?.maxImageBytesPerMessage || 0);
    }

    function draftKind(draft) {
      return draft.attachment?.kind || kindFromFile(draft.file) || 'text';
    }

    function draftBytes(draft) {
      return Number(draft.attachment?.sizeBytes ?? draft.file?.size ?? 0);
    }

    // 붙이는 순간 막는다. 보내고 나서 조용히 잘리는 것보다 낫다.
    function validateFile(file) {
      const kind = kindFromFile(file);
      if (!kind) return 'PDF, MD, TXT, JPG, PNG, WebP 파일만 첨부할 수 있어.';
      if (!Number(file?.size)) return '빈 파일은 첨부할 수 없어.';
      const limit = limitFor(kind);
      if (limit > 0 && file.size > limit) return `${KIND_LABELS[kind]} 파일은 ${humanBytes(limit)}까지 첨부할 수 있어.`;
      if (drafts.length >= maxFiles()) return `한 번에 ${maxFiles()}개까지 첨부할 수 있어.`;
      if (kind !== 'image') {
        const documents = drafts.filter(draft => draftKind(draft) !== 'image').length;
        if (documents >= maxDocuments()) {
          return `문서는 한 번에 ${maxDocuments()}개까지 첨부할 수 있어.`;
        }
      } else {
        const budget = maxImageBytesPerMessage();
        const used = drafts
          .filter(draft => draftKind(draft) === 'image')
          .reduce((sum, draft) => sum + draftBytes(draft), 0);
        if (budget > 0 && used + file.size > budget) {
          return `이미지는 한 번에 합쳐서 ${humanBytes(budget)}까지 첨부할 수 있어.`;
        }
      }
      return '';
    }

    function normalizedFile(file) {
      const extension = extensionOf(file?.name);
      const expectedMime = MIME_BY_EXTENSION[extension];
      if (!expectedMime || (file.type && file.type !== 'application/octet-stream')) return file;
      return new global.File([file], file.name, { type: expectedMime, lastModified: file.lastModified });
    }

    function setDraftError(message) {
      draftError = message || '';
      renderDraft();
    }

    function updateDraft(key, changes) {
      const draft = drafts.find(item => item.key === key);
      if (!draft) return;
      Object.assign(draft, changes);
      renderDraft();
    }

    function statusText(attachment, transientStatus) {
      if (transientStatus === 'uploading') return '업로드 중';
      if (transientStatus === 'sending') return '보내는 중';
      if (transientStatus === 'error') return '전송 실패';
      if (attachment?.expired || attachment?.status === 'expired') return '첨부 만료됨';
      if (attachment?.status === 'library') return '서재 저장됨';
      if (attachment?.status === 'promoting') return '서재 저장 중';
      if (attachment?.status === 'uploaded_unattached') return '전송 전';
      return '임시 첨부';
    }

    async function promoteAttachment(attachment, meta, button) {
      const attachmentId = String(attachment?.attachmentId || '');
      if (!attachmentId || promotingIds.has(attachmentId)) return;
      promotingIds.add(attachmentId);
      button.disabled = true;
      button.textContent = '저장 중';
      meta.textContent = `${humanBytes(attachment?.sizeBytes ?? attachment?.size)} · 서재 저장 중`;
      try {
        const response = await apiFetch(`/api/attachments/${encodeURIComponent(attachmentId)}/library`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: getSessionId() }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || data.status !== 'library') {
          throw new Error(data.error || '서재에 저장하지 못했어.');
        }
        attachment.status = 'library';
        button.textContent = '저장됨';
        button.classList.add('is-saved');
        meta.textContent = `${humanBytes(attachment?.sizeBytes ?? attachment?.size)} · 서재 저장됨`;
        showToast(data.duplicate ? `이미 서재에 있어: ${data.title}` : `서재에 저장됨: ${data.title}`);
      } catch (error) {
        button.disabled = false;
        button.textContent = '다시 저장';
        meta.textContent = `${humanBytes(attachment?.sizeBytes ?? attachment?.size)} · 임시 첨부`;
        showToast(error?.message || '서재에 저장하지 못했어.');
      } finally {
        promotingIds.delete(attachmentId);
      }
    }

    function makeCard(attachment, { transientStatus = '', removable = false } = {}) {
      const card = global.document.createElement('div');
      card.className = 'attachment-card';
      const isExpired = attachment?.expired || attachment?.status === 'expired';
      if (isExpired) card.classList.add('is-expired');
      if (transientStatus === 'error') card.classList.add('is-error');
      card.dataset.attachmentId = String(attachment?.attachmentId || '');

      const kind = attachment?.kind || kindFromFile(attachment) || 'text';
      const badge = global.document.createElement('span');
      badge.className = 'attachment-card-kind';
      badge.textContent = KIND_LABELS[kind] || 'FILE';
      badge.setAttribute('aria-hidden', 'true');

      const body = global.document.createElement('span');
      body.className = 'attachment-card-body';
      const name = global.document.createElement('strong');
      name.className = 'attachment-card-name';
      name.textContent = String(attachment?.filename || attachment?.name || '첨부파일');
      const meta = global.document.createElement('span');
      meta.className = 'attachment-card-meta';
      meta.textContent = `${humanBytes(attachment?.sizeBytes ?? attachment?.size)} · ${statusText(attachment, transientStatus)}`;
      body.append(name, meta);
      card.append(badge, body);

      if (removable) {
        const remove = global.document.createElement('button');
        remove.type = 'button';
        remove.className = 'attachment-card-remove';
        remove.setAttribute('aria-label', '첨부 취소');
        remove.title = '첨부 취소';
        remove.textContent = '×';
        remove.addEventListener('click', () => {
          if (typeof removable === 'function') removable();
          else cancel();
        });
        card.appendChild(remove);
      } else if (!transientStatus && attachment?.status === 'attached_temporary') {
        const save = global.document.createElement('button');
        save.type = 'button';
        save.className = 'attachment-card-library';
        save.textContent = '서재 저장';
        save.setAttribute('aria-label', `${name.textContent} 서재에 저장`);
        save.addEventListener('click', () => { void promoteAttachment(attachment, meta, save); });
        card.appendChild(save);
      }
      return card;
    }

    function renderDraft() {
      const container = el('attachment-draft');
      const button = el('attachment-button');
      if (button) button.disabled = drafts.length >= maxFiles();
      if (!container) return;
      container.replaceChildren();
      if (drafts.length === 0 && !draftError) {
        container.hidden = true;
        return;
      }

      container.hidden = false;
      for (const draft of drafts) {
        container.appendChild(makeCard(draft.attachment || draft.file, {
          transientStatus: draft.phase === 'uploading' ? 'uploading' : draft.phase === 'error' ? 'error' : '',
          removable: () => removeDraft(draft.key),
        }));
      }
      if (draftError) {
        const error = global.document.createElement('p');
        error.className = 'attachment-draft-error';
        error.setAttribute('role', 'alert');
        error.textContent = draftError;
        container.appendChild(error);
      }
    }

    async function upload(file) {
      const validationError = validateFile(file);
      if (validationError) {
        setDraftError(validationError);
        return;
      }

      const key = (nextDraftKey += 1);
      const draft = {
        key,
        phase: 'uploading',
        file,
        attachment: null,
        controller: new global.AbortController(),
      };
      drafts = [...drafts, draft];
      setDraftError('');
      const form = new global.FormData();
      form.append('file', normalizedFile(file));

      try {
        const response = await apiFetch('/api/attachments', {
          method: 'POST',
          body: form,
          signal: draft.controller.signal,
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.attachmentId) throw new Error(data.error || '파일을 업로드하지 못했어.');
        updateDraft(key, { phase: 'ready', attachment: data, controller: null });
      } catch (error) {
        if (error?.name === 'AbortError') return;
        updateDraft(key, { phase: 'error', controller: null });
        setDraftError(error?.message || '파일을 업로드하지 못했어.');
      }
    }

    function removeDraft(key) {
      const draft = drafts.find(item => item.key === key);
      draft?.controller?.abort();
      drafts = drafts.filter(item => item.key !== key);
      const input = el('attachment-input');
      if (input) input.value = '';
      setDraftError('');
    }

    function cancel() {
      for (const draft of drafts) draft.controller?.abort();
      drafts = [];
      const input = el('attachment-input');
      if (input) input.value = '';
      setDraftError('');
    }

    function init({
      config: nextConfig,
      apiFetch: nextFetch,
      showToast: nextToast = () => {},
      getSessionId: nextGetSessionId = () => 'shared-main',
    } = {}) {
      config = nextConfig || null;
      apiFetch = nextFetch || apiFetch;
      showToast = nextToast;
      getSessionId = nextGetSessionId;
      const button = el('attachment-button');
      const input = el('attachment-input');
      if (!button || !input || !config?.enabled) {
        if (button) button.hidden = true;
        return;
      }
      button.hidden = false;
      if (maxFiles() > 1) input.multiple = true;
      button.addEventListener('click', () => input.click());
      input.addEventListener('change', () => {
        const files = [...(input.files || [])];
        input.value = '';
        for (const file of files) void upload(file);
      });
      renderDraft();
    }

    function getReadyAttachments() {
      return drafts
        .filter(draft => draft.phase === 'ready' && draft.attachment)
        .map(draft => draft.attachment);
    }

    function isUploading() {
      return drafts.some(draft => draft.phase === 'uploading');
    }

    function requireReadyForSend() {
      if (!isUploading()) return true;
      showToast('첨부 업로드가 끝날 때까지 잠깐만 기다려줘.');
      return false;
    }

    function clearAfterSend(attachmentIds) {
      const sent = new Set(
        (Array.isArray(attachmentIds) ? attachmentIds : [attachmentIds]).filter(Boolean),
      );
      if (sent.size === 0) return;
      for (const draft of drafts) {
        if (sent.has(draft.attachment?.attachmentId)) draft.controller?.abort();
      }
      drafts = drafts.filter(draft => !sent.has(draft.attachment?.attachmentId));
      const input = el('attachment-input');
      if (input) input.value = '';
      setDraftError('');
    }

    function renderMessageAttachments(target, attachments, options = {}) {
      target.querySelector?.('.message-attachments')?.remove();
      if (!Array.isArray(attachments) || attachments.length === 0) return null;
      const list = global.document.createElement('div');
      list.className = 'message-attachments';
      attachments.forEach(attachment => list.appendChild(makeCard(attachment, options)));
      target.appendChild(list);
      return list;
    }

    function getMessageSignature(messages) {
      return (Array.isArray(messages) ? messages : []).flatMap(message =>
        (Array.isArray(message.attachments) ? message.attachments : []).map(attachment =>
          `${message.id}:${attachment.attachmentId}:${attachment.status}:${attachment.expired ? 1 : 0}`
        )
      ).join(',');
    }

    return {
      clearAfterSend,
      getMessageSignature,
      getReadyAttachments,
      init,
      isUploading,
      renderMessageAttachments,
      requireReadyForSend,
    };
  }

  global.AttachmentUi = setupModule();
})(window);
