'use strict';

(function register(global) {
  function create(ui) {
    const { node, button, icon, providers, timeOf, get, request, show, close, accounts, openMove,
      mutate, openSent, requestId, notify } = ui;
    const sentUnknown = new Map();
    const labels = {
      new: '메일 쓰기', reply: '답장', reply_all: '전체 답장', forward: '전달',
    };
    const addressText = entries => (entries || []).map(item => item.name ? item.name + ' <' + item.address + '>' : item.address).join(', ');
    const dateTime = new Intl.DateTimeFormat('ko', {
      timeZone: 'Asia/Seoul', dateStyle: 'full', timeStyle: 'short',
    });
    const formatSize = value => value == null ? '' : value < 1024 ? value + 'B'
      : value < 1024 * 1024 ? (value / 1024).toFixed(1) + 'KB' : (value / (1024 * 1024)).toFixed(1) + 'MB';

    function control(label, handler, glyph, className = 'mw-view-action') {
      return button(className, label, handler, { glyph, size: 16 });
    }

    function operationNotice(label, handler, text, tone) {
      const notice = node('div', 'mw-operation-notice mw-detail-notice');
      notice.setAttribute('role', 'status');
      notice.append(icon(tone === 'ok' ? 'action' : 'alert', 18), node('span', '', text),
        control(label, handler));
      return notice;
    }

    function detail(original, list, index, folderScope, receipt) {
      const panel = node('section', 'mw-detail-view');
      show('detail', panel);
      let current = null;
      let error = null;
      let downloading = null;
      let fetchingFile = false;
      let threadOpen = false;
      let recipientsOpen = false;
      const go = step => {
        const next = index + step;
        if (list[next]?.id) detail(list[next], list, next, folderScope);
      };
      const update = (action, value) => async () => {
        if (!current) return;
        const results = await mutate([current], action, value, folderScope);
        if (!panel.isConnected || !results?.some(result => result.state === 'confirmed')) return;
        if (action === 'archive' || action === 'trash') close();
        else render();
      };
      const compose = kind => current && openCompose({ kind, original: current, folderScope,
        onReturn: result => detail(original, list, index, folderScope, result) });

      async function download(item, index) {
        if (fetchingFile || !current) return;
        fetchingFile = true;
        const link = await request('/messages/' + current.id + '/attachments/' + index, {}, { binary: true }).catch(() => null);
        fetchingFile = false;
        if (!panel.isConnected) return;
        if (!link) {
          downloading = { item, index };
          render();
          return;
        }
        const url = URL.createObjectURL(link);
        const anchor = node('a');
        anchor.href = url;
        anchor.download = item.filename || 'attachment';
        document.body.append(anchor);
        anchor.click();
        anchor.remove();
        global.setTimeout(() => URL.revokeObjectURL(url), 1000);
      }

      function detailToolbar() {
        const back = control('목록', close, 'arrow-left');
        const prev = button('mw-square', '이전 메일', index > 0 ? () => go(-1) : null,
          { glyph: 'chevron-left', iconOnly: true });
        const next = button('mw-square', '다음 메일', index + 1 < list.length ? () => go(1) : null,
          { glyph: 'chevron-right', iconOnly: true });
        const bar = node('div', 'mw-detail-toolbar');
        const star = current ? update('set_starred', !current.starred) : null;
        const archive = current ? update('archive') : null;
        const trash = current ? update('trash') : null;
        const move = control('이동', current ? () => openMove(move, [current], folderScope) : null, 'move');
        bar.append(back, node('span', 'mw-rule'), prev, node('span', 'mw-detail-position',
          list.length ? (index + 1) + ' / ' + list.length : ''), next, node('span', 'mw-rule'),
        control('안 읽음', current ? update('set_read', false) : null, 'unread'),
        control('중요', star, current?.starred ? 'star-on' : 'star'),
        control('답장', current ? () => compose('reply') : null, 'reply'),
        control('전달', current ? () => compose('forward') : null, 'forward'),
        control('보관', archive, 'archive'), move, control('휴지통', trash, 'trash'));
        const compact = node('div', 'mw-detail-compact');
        const more = button('mw-square', '메일 메뉴', null, { glyph: 'more', iconOnly: true });
        compact.append(control(folderScope.title || '받은편지함', close, 'chevron-left'),
          node('span', 'mw-spacer'), button('mw-square', '별표', star,
            { glyph: current?.starred ? 'star-on' : 'star', iconOnly: true }), more);
        return [bar, compact];
      }

      function render() {
        panel.replaceChildren(...detailToolbar());
        if (!current) {
          const empty = node('div', 'mw-view-card mw-detail-empty');
          if (error) {
            const missing = ['MAIL_CLIENT_MESSAGE_GONE', 'MAIL_CLIENT_MESSAGE_NOT_FOUND', 'MAIL_CLIENT_LOCATION_STALE'].includes(error.code);
            empty.append(icon('mail', 28), node('h2', '', missing ? '이 메일을 찾을 수 없어' : '메일을 불러오지 못했어'),
              node('p', '', missing ? '메일이 지워졌거나 다른 폴더로 옮겨졌을 수 있어.' : '계정 연결을 확인해 줘.'), control('목록으로', close));
          } else {
            empty.setAttribute('aria-busy', 'true');
            for (let i = 0; i < 6; i++) empty.append(node('span', 'mw-detail-placeholder'));
          }
          panel.append(empty);
          return;
        }
        const account = accounts().find(item => item.id === current.accountId);
        const card = node('article', 'mw-view-card mw-detail-card');
        const head = node('header', 'mw-detail-head');
        const title = node('h2', '', current.subject || '(제목 없음)');
        if (current.starred) title.append(icon('star-on', 20));
        const heading = node('div', 'mw-detail-title');
        const thread = current.thread?.messages || [];
        heading.append(title);
        if (thread.length) heading.append(node('p', 'mw-muted mw-desktop-only', '스레드 메시지 ' + (thread.length + 1) + '개'));
        const source = node('div', 'mw-detail-source');
        const provider = node('span', 'mw-pill', providers[current.provider] || '');
        if (account?.address) provider.append(node('span', 'mw-desktop-only', ' · ' + account.address));
        source.append(provider);
        if (thread.length) source.append(control('이전 메시지 ' + thread.length + '개 ' + (threadOpen ? '접기' : '보기'), () => {
          threadOpen = !threadOpen;
          render();
        }, undefined, 'mw-compact-only mw-view-action'));
        head.append(heading, source);
        card.append(head);
        if (thread.length) {
          const related = node('div', 'mw-thread-messages' + (threadOpen ? ' mw-thread-open' : ''));
          const choices = [...thread, current];
          for (const entry of thread) {
            const item = button('mw-thread-entry', '', () => detail(entry, choices,
              choices.indexOf(entry), folderScope));
            item.replaceChildren(node('strong', '', entry.from?.[0]?.name || entry.from?.[0]?.address || ''),
              node('span', 'mw-muted', entry.subject || ''), node('time', 'mw-muted', timeOf(entry.receivedAt)));
            related.append(item);
          }
          card.append(related);
        }
        const mail = node('div', 'mw-detail-content');
        const sender = (current.from || [])[0] || {};
        const person = node('div', 'mw-detail-sender');
        const from = node('div', 'mw-message-addresses');
        from.append(node('strong', '', sender.name || sender.address || ''));
        if (sender.name && sender.address) from.append(node('span', 'mw-muted mw-desktop-only', ' <' + sender.address + '>'));
        const to = (current.to || []).some(entry => entry.address === account?.address) ? '나'
          : (current.to || [])[0]?.name || (current.to || [])[0]?.address || '';
        const cc = current.cc?.length ? '참조 ' + current.cc.length + '명' : '';
        if (to || cc) {
          const reveal = control([to, cc].filter(Boolean).join(' · '), () => {
            recipientsOpen = !recipientsOpen;
            render();
          }, 'chevron-down', 'mw-address-reveal mw-compact-only mw-view-action');
          reveal.setAttribute('aria-expanded', String(recipientsOpen));
          from.append(reveal);
        }
        for (const [label, entries] of [['받는 사람', current.to], ['참조', current.cc], ['숨은참조', current.bcc]]) {
          if (entries?.length) from.append(node('div', 'mw-muted' + (recipientsOpen ? '' : ' mw-desktop-only'), label + '  ' + addressText(entries)));
        }
        const received = current.sentAt || current.receivedAt;
        person.append(node('span', 'mw-avatar', (sender.name || sender.address || '?').slice(0, 1)), from, node('span', 'mw-spacer'));
        if (received) person.append(node('time', 'mw-muted mw-desktop-only', dateTime.format(received * 1000)),
          node('time', 'mw-muted mw-compact-only', timeOf(received)));
        person.append(button('mw-square', '메일 더보기', null, { glyph: 'more', iconOnly: true }));
        mail.append(person);
        if (current.body?.blockedRemoteImages) {
          const images = node('div', 'mw-remote-images');
          images.append(icon('external-image', 18), node('span', '',
            '외부 이미지 ' + current.body.blockedRemoteImages + '개를 차단했어.'), node('span', 'mw-spacer'),
          control('이미지 표시', null));
          mail.append(images);
        }
        const bodyText = current.body?.text || '';
        const quoteStart = bodyText.search(/^(?:> |-----Original Message-----|----- 원본 메일 -----)/m);
        mail.append(node('div', 'mw-detail-body', quoteStart > 0 ? bodyText.slice(0, quoteStart) : bodyText));
        if (quoteStart > 0) {
          const quoted = node('details', 'mw-detail-quote');
          quoted.open = true;
          const summary = node('summary', '', '인용문 접기');
          quoted.addEventListener('toggle', () => { summary.textContent = quoted.open ? '인용문 접기' : '인용문 펼치기'; });
          quoted.append(summary, node('blockquote', 'mw-muted', bodyText.slice(quoteStart)));
          mail.append(quoted);
        }
        const attachments = current.attachments || [];
        if (attachments.some(item => !item.inline)) {
          const files = node('div', 'mw-detail-files');
          const count = attachments.filter(item => !item.inline).length;
          const heading = node('div', 'mw-file-heading');
          heading.append(icon('paperclip', 16), node('span', '', '첨부 ' + count + '개 · '
            + formatSize(attachments.filter(item => !item.inline).reduce((sum, item) => sum + (item.size || 0), 0))));
          const tiles = node('div', 'mw-file-tiles');
          attachments.forEach((item, index) => {
            if (item.inline) return;
            const tile = node('div', 'mw-file-tile');
            const meta = node('div', 'mw-file-meta');
            meta.append(node('strong', '', item.filename || '첨부파일'), node('span', 'mw-muted', formatSize(item.size)));
            tile.append(node('span', 'mw-avatar', item.filename?.split('.').at(-1)?.slice(0, 5).toUpperCase() || ''),
              meta, button('mw-square', (item.filename || '첨부파일') + ' 다운로드',
                item.downloadable ? () => void download(item, index) : null, { glyph: 'download', iconOnly: true }));
            tiles.append(tile);
          });
          files.append(heading, tiles);
          mail.append(files);
        }
        const actions = node('div', 'mw-detail-actions');
        for (const [kind, glyph] of [['reply', 'reply'], ['reply_all', 'reply-all'], ['forward', 'forward']]) {
          actions.append(control(labels[kind], () => compose(kind), glyph, 'mw-outlined'));
        }
        actions.append(control('보관', update('archive'), 'archive', 'mw-compact-only mw-outlined'),
          control('휴지통', update('trash'), 'trash', 'mw-compact-only mw-outlined'));
        mail.append(actions);
        card.append(mail);
        if (receipt?.state === 'sent') {
          const sent = node('div', 'mw-sent-row');
          sent.append(node('strong', '', '나'), node('span', '', receipt.text || ''), node('time', 'mw-muted', '방금'));
          card.append(sent);
        }
        panel.append(card);
        if (downloading) panel.append(operationNotice('다시 시도', () => {
          const { item, index: attachmentIndex } = downloading;
          downloading = null;
          void download(item, attachmentIndex);
        }, '첨부파일을 다운로드하지 못했어.', 'error'));
        if (receipt?.state === 'sent') panel.append(operationNotice('보낸편지함에서 보기', () => openSent(current.accountId),
          receipt.delivery === 'partial' ? '메일 일부가 수신자에게 전달되지 않았어.' : '메일을 보냈어', 'ok'));
        else if (receipt) panel.append(operationNotice('보낸편지함 확인', () => openSent(current.accountId),
          '발송 결과를 확인하지 못했어. 다시 보내기 전에 보낸편지함을 확인해 줘.', 'error'));
      }
      render();
      return get('/messages/' + original.id).then(result => {
        if (!panel.isConnected) return;
        current = result.message;
        render();
      }).catch(problem => { if (panel.isConnected) { error = problem; render(); } });
    }

    function openCompose({ kind, original, folderScope, draft, to, onReturn = close }) {
      const panel = node('section', 'mw-compose-view');
      show('compose', panel);
      const accountList = accounts().filter(account => account.status === 'active');
      const replies = kind === 'reply' || kind === 'reply_all';
      let selectedAccount = draft?.accountId || original?.accountId || accountList[0]?.id;
      let stored = draft || null;
      let fileList = [];
      let retained = draft?.attachments || [];
      const forwarding = kind === 'forward' && (original?.attachments || []).some(item => !item.inline);
      let busy = Boolean(forwarding);
      let saveBlocked = false;
      let dirty = false;
      const title = draft?.inReplyTo ? '답장' : labels[kind];
      const initialSubject = draft?.subject ?? (original
        ? (replies ? (/^re:/i.test(original.subject) ? '' : 'Re: ') : (/^fwd?:/i.test(original.subject) ? '' : 'Fwd: ')) + (original.subject || '') : '');
      const key = () => selectedAccount + ':' + (stored ? 'draft:' + stored.id : original ? kind + ':' + original.id : 'new');
      const head = node('header', 'mw-compose-head');
      const status = node('span', 'mw-muted');
      const warning = node('div', 'mw-compose-warning');
      const card = node('form', 'mw-view-card mw-compose-card');
      card.addEventListener('submit', event => event.preventDefault());
      const accountField = node('select');
      accountField.setAttribute('aria-label', '보내는 계정');
      for (const account of accountList) {
        const option = node('option', '', providers[account.provider] + ' · ' + account.address);
        option.value = account.id;
        option.selected = account.id === selectedAccount;
        accountField.append(option);
      }
      accountField.disabled = Boolean(original || draft);
      accountField.addEventListener('change', () => { selectedAccount = Number(accountField.value); markDirty(); });
      const toField = node('input');
      const ccField = node('input');
      const bccField = node('input');
      const subjectField = node('input');
      const editor = node('div', 'mw-compose-body', draft?.text || '');
      editor.contentEditable = 'true';
      editor.setAttribute('role', 'textbox');
      editor.setAttribute('aria-label', '메일 본문');
      editor.setAttribute('aria-multiline', 'true');
      editor.addEventListener('paste', event => {
        event.preventDefault();
        const text = event.clipboardData?.getData('text/plain');
        if (text && !busy) document.execCommand('insertText', false, text);
      });
      editor.addEventListener('drop', event => event.preventDefault());
      const replyTo = original?.replyTo?.length ? original.replyTo : original?.from;
      const ownAddresses = new Set(accountList.filter(account => account.id === selectedAccount && account.address).map(account => account.address.toLowerCase()));
      const primary = (replyTo || []).filter(entry => entry.address && !ownAddresses.has(entry.address.toLowerCase()));
      const copies = [...(original?.to || []), ...(original?.cc || [])]
        .filter((entry, index, list) => entry.address && !ownAddresses.has(entry.address.toLowerCase())
          && !primary.some(item => item.address.toLowerCase() === entry.address.toLowerCase())
          && list.findIndex(item => item.address.toLowerCase() === entry.address.toLowerCase()) === index);
      toField.value = draft?.to?.join(', ') || (replies ? addressText(primary) : to || '');
      ccField.value = draft?.cc?.join(', ') || (kind === 'reply_all' ? addressText(copies) : '');
      bccField.value = draft?.bcc?.join(', ') || '';
      subjectField.value = initialSubject;
      subjectField.readOnly = replies;
      toField.readOnly = replies;
      ccField.readOnly = replies;
      const file = node('input');
      file.type = 'file';
      file.multiple = true;
      file.hidden = true;
      const fileBar = node('div', 'mw-compose-files');
      const quote = node('details', 'mw-quote');
      if (original) quote.append(node('summary', '', '원문 포함 · 펼치기'), node('p', '', original.body?.text || ''));
      const fileAction = control('파일 첨부', () => file.click(), 'paperclip');
      file.addEventListener('change', () => {
        fileList.push(...file.files);
        file.value = '';
        markDirty();
        renderFiles();
      });
      const toRow = field('받는 사람', toField);
      const bccRow = field('숨은참조', bccField);
      bccRow.hidden = !bccField.value;
      toRow.append(control('숨은참조', () => { bccRow.hidden = !bccRow.hidden; if (!bccRow.hidden) bccField.focus(); }));
      const stop = () => { if (!busy) onReturn(); };
      const desktopCancel = control('작성 취소', stop, 'close', 'mw-view-action mw-desktop-only');
      const phoneCancel = control('취소', stop, undefined, 'mw-view-action mw-compact-only');
      const send = control('보내기', () => void commit(true), 'send-primary', 'mw-popover-primary');
      const mobileSend = control('보내기', () => void commit(true), 'send-compact', 'mw-popover-primary mw-compact-only');
      const save = control('임시 저장', () => void commit(false), 'draft', 'mw-outlined');
      const bottom = node('footer', 'mw-compose-bottom');
      bottom.append(send, save);
      head.append(phoneCancel, node('h1', '', title), node('span', 'mw-spacer'), status, desktopCancel, mobileSend);
      const format = node('div', 'mw-compose-format');
      for (const [name, label, command] of [['굵게', 'B', 'bold'], ['기울임', 'I', 'italic'], ['밑줄', 'U', 'underline']]) {
        const tool = control(label, global.DOMPurify ? () => {
          if (busy) return;
          if (!editor.contains(document.getSelection()?.anchorNode)) editor.focus();
          document.execCommand(command);
          markDirty();
        } : null);
        tool.addEventListener('pointerdown', event => event.preventDefault());
        tool.setAttribute('aria-label', name);
        format.append(tool);
      }
      format.append(node('span', 'mw-rule'), fileAction, file);
      card.append(warning, field('보내는 계정', accountField), toRow, field('참조', ccField), bccRow,
        field('제목', subjectField), format, editor);
      if (original) card.append(quote);
      card.append(fileBar, bottom);
      panel.append(head, card);
      for (const input of [toField, ccField, bccField, subjectField, editor]) input.addEventListener('input', markDirty);
      for (const input of [toField, ccField, bccField]) autocomplete(input);
      if (stored) status.textContent = (providers[accounts().find(item => item.id === selectedAccount)?.provider] || '') + ' 임시보관함에 저장됨';
      syncControls();
      renderFiles();
      if (forwarding) {
        void get('/accounts/' + selectedAccount + '/messages/' + original.id + '/attachment-references').then(data => {
          if (!panel.isConnected) return;
          retained = (data.attachments || []).map(item => ({ ...item, kind: 'original' }));
          renderFiles();
        }).catch(() => {
          if (panel.isConnected) notify('원본 첨부를 확인하지 못했어.');
        }).finally(() => { busy = false; syncControls(); });
      }

      function autocomplete(input) {
        const row = input.parentElement;
        const results = node('div', 'mw-recipient-suggestions mw-view-card');
        results.hidden = true;
        row.append(results);
        let sequence = 0;
        function hide() { results.hidden = true; results.replaceChildren(); }
        input.addEventListener('blur', event => {
          if (!results.contains(event.relatedTarget)) { sequence++; hide(); }
        });
        input.addEventListener('keydown', event => {
          if (event.key === 'Escape') { sequence++; hide(); }
          if (event.key === 'ArrowDown' && !results.hidden) {
            event.preventDefault();
            results.querySelector('button')?.focus();
          }
        });
        results.addEventListener('focusout', event => {
          if (event.relatedTarget !== input && !results.contains(event.relatedTarget)) hide();
        });
        input.addEventListener('input', async () => {
          const token = ++sequence;
          const entries = input.value.split(',');
          const query = entries.at(-1).trim();
          if (input.readOnly || query.length < 1 || query.length > 160) { hide(); return; }
          const data = await get('/contacts', { q: query, limit: 6 }).catch(() => null);
          if (token !== sequence || !row.isConnected || document.activeElement !== input) return;
          results.replaceChildren();
          for (const item of data?.contacts || []) {
            const choice = button('mw-recipient-choice', '', () => {
              input.value = [...entries.slice(0, -1).map(value => value.trim()).filter(Boolean), item.email].join(', ') + ', ';
              hide();
              markDirty();
              input.focus();
            });
            choice.addEventListener('pointerdown', event => event.preventDefault());
            const name = node('div');
            name.append(node('strong', '', (item.name || item.email) + (item.organization ? ' · ' + item.organization : '')),
              node('p', 'mw-muted', item.email));
            choice.replaceChildren(node('span', 'mw-avatar', (item.name || item.email).slice(0, 1)),
              name, node('span', 'mw-spacer'), node('span', 'mw-pill', item.source === 'csv' ? 'CSV' : providers[item.source] || item.source));
            results.append(choice);
          }
          results.hidden = !results.childElementCount;
        });
      }

      function field(label, input) {
        const row = node('label', 'mw-compose-field');
        row.append(node('span', 'mw-muted', label), input);
        if ((input === toField || input === ccField) && replies) {
          input.hidden = true;
          const pills = node('div', 'mw-address-pills');
          const addresses = input === toField ? primary : kind === 'reply_all' ? copies : [];
          for (const entry of addresses) {
            const pill = node('span', 'mw-pill');
            pill.append(node('span', 'mw-desktop-only', addressText([entry])),
              node('span', 'mw-compact-only', entry.name || entry.address));
            pills.append(pill);
          }
          row.append(pills);
        }
        if (!input.hasAttribute('aria-label')) input.setAttribute('aria-label', label);
        return row;
      }

      function markDirty() { dirty = true; syncControls(); }

      function syncControls() {
        const unsettled = sentUnknown.has(key());
        for (const action of [send, mobileSend, save, fileAction]) action.disabled = !selectedAccount || busy || unsettled || saveBlocked;
        desktopCancel.disabled = busy;
        phoneCancel.disabled = busy;
        editor.contentEditable = String(!busy);
        accountField.disabled = Boolean(original || stored || busy);
        toField.readOnly = replies || busy;
        ccField.readOnly = replies || busy;
        subjectField.readOnly = replies || busy;
        bccField.readOnly = busy;
      }

      function renderFiles() {
        fileBar.replaceChildren();
        for (const [list, getter] of [[retained, item => item.filename], [fileList, item => item.name]]) {
          list.forEach((item, index) => {
            const chip = node('div', 'mw-file-chip');
            chip.append(icon('paperclip', 16), node('span', '', getter(item)),
              node('span', 'mw-muted', formatSize(item.size)), button('mw-square', getter(item) + ' 제거', () => {
                if (busy) return;
                list.splice(index, 1);
                markDirty();
                renderFiles();
              }, { glyph: 'close', size: 14, iconOnly: true }));
            fileBar.append(chip);
          });
        }
      }

      function prefix() { return '/accounts/' + selectedAccount; }
      const split = value => value.split(/[,;\n]/).map(item => item.trim()).filter(Boolean);

      async function submission() {
        const attachments = retained.map(item => ({ kind: item.kind || 'draft', index: item.index, proof: item.proof }));
        for (const upload of fileList) {
          const query = new URLSearchParams({ filename: upload.name, contentType: upload.type || 'application/octet-stream' });
          const receipt = await request(prefix() + '/uploads?' + query, {
            method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: upload,
          });
          attachments.push({ kind: 'upload', id: receipt.attachment.id });
        }
        const compose = { kind: stored ? 'new' : kind, text: editor.innerText, attachments };
        if (global.DOMPurify && editor.querySelector('b, strong, i, em, u')) {
          compose.html = global.DOMPurify.sanitize(editor.innerHTML, {
            ALLOWED_TAGS: ['b', 'strong', 'i', 'em', 'u', 'p', 'div', 'br'], ALLOWED_ATTR: [],
          });
        }
        if (!stored && original) compose.originalId = original.id;
        if (!replies || stored) {
          compose.subject = subjectField.value;
          const addresses = field => split(field.value).map(value => value.match(/<([^<>]+)>$/)?.[1] || value);
          compose.to = addresses(toField);
          compose.cc = addresses(ccField);
        }
        const blind = split(bccField.value);
        if (blind.length) compose.bcc = blind;
        return compose;
      }

      async function saveDraft(asNew = false) {
        const compose = await submission();
        if (asNew) {
          // A copied draft cannot reuse proofs scoped to the existing draft.
          compose.attachments = compose.attachments.filter(ref => ref.kind === 'upload');
        }
        const path = prefix() + '/drafts';
        const result = await request(stored && !asNew ? path + '/' + encodeURIComponent(stored.id) : path, {
          method: stored && !asNew ? 'PUT' : 'POST',
          json: { requestId: requestId(), compose, ...(stored && !asNew ? { version: stored.version } : {}) },
        });
        if (result.state !== 'saved') return result;
        const refreshed = await get(path + '/' + encodeURIComponent(result.draftId)).catch(() => null);
        if (!refreshed?.draft) return { state: 'unknown' };
        stored = refreshed.draft;
        retained = stored.attachments || [];
        fileList = [];
        dirty = false;
        accountField.disabled = true;
        status.textContent = (providers[accounts().find(item => item.id === selectedAccount)?.provider] || '') + ' 임시보관함에 저장됨';
        renderFiles();
        return result;
      }

      function showSaveFailure(result) {
        warning.replaceChildren();
        const conflict = result?.state === 'conflict' || result?.code === 'MAIL_CLIENT_DRAFT_CONFLICT';
        const unknown = result?.state === 'unknown' || result?.state === 'pending';
        status.textContent = conflict ? '다른 기기에서 수정됨' : unknown ? '초안 저장 결과 확인 필요' : '초안을 저장하지 못했어';
        warning.append(icon('alert', 18), node('span', '', conflict
          ? '다른 기기에서 이 초안을 수정했어. 지금 화면 내용은 아직 저장되지 않았어.'
          : unknown ? '초안 저장 결과를 확인하지 못했어. 임시보관함에서 확인해 줘.'
            : '초안을 저장하지 못했어. 지금 화면 내용은 아직 저장되지 않았어.'));
        saveBlocked = Boolean(conflict || unknown);
        if (conflict) warning.append(
          control('최신 버전 불러오기', async () => {
            const { draft: latest } = await get(prefix() + '/drafts/' + encodeURIComponent(stored.id)).catch(() => ({}));
            if (latest) openCompose({ kind, original, folderScope, draft: { ...latest, accountId: selectedAccount }, onReturn });
          }, undefined, 'mw-outlined'),
          control('내 버전을 새 초안으로', retained.length ? null : () => void commit(false, true), undefined, 'mw-outlined'));
      }

      async function commit(sending, asNew = false) {
        if (busy || !selectedAccount || sentUnknown.has(key()) || (saveBlocked && !asNew)) return;
        if (sending && !replies && ![toField, ccField, bccField].some(input => input.value.trim())) {
          notify('받는 사람 주소를 입력해 줘.');
          toField.focus();
          return;
        }
        if (fileList.length + retained.length > 30 || fileList.reduce((sum, item) => sum + item.size, 0) > 18 * 1024 ** 2) {
          notify('첨부파일은 최대 30개, 총 18MB까지 보낼 수 있어.');
          return;
        }
        busy = true;
        syncControls();
        warning.replaceChildren();
        let sentId;
        try {
          if (!sending || (stored && dirty)) {
            const result = await saveDraft(asNew);
            if (result.state !== 'saved') { showSaveFailure(result); return; }
          }
          if (!sending) { saveBlocked = false; return; }
          const compose = stored ? null : await submission();
          sentId = requestId();
          const result = await request(stored ? prefix() + '/drafts/' + encodeURIComponent(stored.id) + '/send' : prefix() + '/send', {
            method: 'POST', json: { requestId: sentId, ...(stored ? { version: stored.version } : { compose }) },
          });
          if (result.state === 'sent') {
            if (panel.isConnected) onReturn({ ...result, text: editor.innerText });
            if (!original) notify(result.delivery === 'partial' ? '일부 수신자에게 메일이 전달되지 않았어.' : '메일을 보냈어.');
          }
          else if (result.state === 'pending' || result.state === 'unknown') uncertain(result);
          else if (result.state === 'conflict') showSaveFailure(result);
          else notify('메일을 보내지 못했어.');
        } catch (error) {
          if (sending && sentId && (!error.code || error.code === 'MAIL_CLIENT_INTERNAL_ERROR')) uncertain({ state: 'unknown', requestId: sentId });
          else if (!sending || (stored && dirty)) showSaveFailure(error);
          else notify('메일을 보내지 못했어.');
        } finally {
          busy = false;
          syncControls();
        }
      }

      function uncertain(receipt) {
        sentUnknown.set(key(), receipt);
        if (original && panel.isConnected) onReturn(receipt);
        else warning.append(operationNotice('보낸편지함 확인', () => openSent(selectedAccount),
          '발송 결과를 확인하지 못했어. 다시 보내기 전에 보낸편지함을 확인해 줘.', 'error'));
      }
    }

    return { detail, openCompose };
  }

  global.MailWorkspaceMessage = { create };
})(window);
