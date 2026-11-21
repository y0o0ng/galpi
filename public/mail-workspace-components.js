'use strict';

(function registerMailComponents(global) {
  const assets = '/assets/figma/mail-workspace/';
  const providers = { gmail: 'Gmail', naver: 'Naver', works: 'Works' };
  const tagVariants = { gmail: '478:9453', naver: '478:9455', works: '478:9457' };
  const eventVariants = { personal: '463:3007', official: '463:3009', deadline: '463:3011' };
  const eventNames = { personal: '개인', official: '공식', deadline: '마감', unknown: '미정' };

  function element(tag, className, value) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (value != null) el.textContent = value;
    return el;
  }

  function component(el, name, id) {
    el.dataset.figmaComponent = name;
    if (id) el.dataset.figmaNode = id;
    return el;
  }

  function icon(name) {
    const img = element('img', 'm1-icon');
    img.src = assets + name + '.svg';
    img.alt = '';
    img.setAttribute('aria-hidden', 'true');
    return img;
  }

  function button(label, action, { glyph, variant = 'ghost', size = 's', iconOnly = false, disabled = false } = {}) {
    const ids = { ghost: ['452:953', '452:958'], secondary: ['452:943', '452:948'], primary: ['452:933', '452:938'] };
    const el = component(element('button', 'm1-button m1-button-' + variant), 'Mail / Button', ids[variant][size === 's' ? 1 : 0]);
    el.type = 'button';
    el.disabled = disabled;
    if (size !== 's') el.classList.add('m1-button-m');
    if (glyph) el.append(icon(glyph));
    if (iconOnly) {
      el.classList.add('m1-icon-button');
      el.setAttribute('aria-label', label);
      el.title = label;
    } else el.append(element('span', '', label));
    if (action) el.addEventListener('click', action);
    return el;
  }

  function navItem(label, glyph, selected, action) {
    const el = component(element('button', 'm1-nav-item'), 'Mail / Nav Item', selected ? '452:970' : '452:964');
    el.type = 'button';
    if (selected) el.setAttribute('aria-current', 'page');
    el.append(icon(glyph), element('span', '', label));
    el.addEventListener('click', action);
    return el;
  }

  function sourceTag(provider, label = providers[provider] || provider) {
    return component(element('span', 'm1-source-tag', label), 'Mail / Source Tag', tagVariants[provider]);
  }

  function row({ message, checked, writable, pending, open, select, star, time, preview, analysis }) {
    const unread = message.read === false;
    const variant = unread ? checked ? '452:993' : '452:977' : checked ? '452:1026' : '452:1010';
    const el = component(element('li', 'm1-mail-row'), 'Mail / Row', variant);
    el.dataset.figmaCompactNode = unread ? '475:9061' : '475:9078';
    el.classList.toggle('m1-unread', unread);
    el.classList.toggle('m1-checked', checked);
    el.classList.toggle('m1-starred', Boolean(message.starred));
    if (message.id) el.dataset.messageId = message.id;
    const subject = message.subject || '(제목 없음)';
    if (writable) {
      const check = button('메일 선택 ' + subject, select, { glyph: checked ? 'checkbox-on' : 'checkbox-off', iconOnly: true, disabled: !message.id || pending });
      check.classList.add('m1-row-select');
      check.setAttribute('aria-pressed', String(checked));
      el.append(check);
    }
    if (writable || message.starred) {
      const starButton = button((message.starred ? '별표 해제 ' : '별표 표시 ') + subject, star,
        { glyph: message.starred ? 'star-on' : 'star', iconOnly: true, disabled: !writable || !message.id || pending });
      starButton.classList.add('m1-row-star');
      starButton.setAttribute('aria-pressed', String(Boolean(message.starred)));
      el.append(starButton);
    }
    const link = element('button', 'm1-row-open');
    link.type = 'button';
    if (unread) {
      const dot = icon('unread-dot');
      dot.classList.add('m1-unread-dot');
      link.append(dot);
    }
    const sender = message.from?.[0];
    if (unread) link.setAttribute('aria-label', ['안 읽음', sender?.name || sender?.address, subject].filter(Boolean).join(' · '));
    link.append(element('span', 'm1-row-sender', sender?.name || sender?.address || '보낸 사람 없음'));
    const content = element('span', 'm1-row-content');
    content.append(element('span', 'm1-row-subject', subject));
    if (preview) content.append(element('span', 'm1-row-preview', preview));
    link.append(content);
    if (message.hasAttachments) {
      const paperclip = icon('paperclip');
      paperclip.classList.add('m1-paperclip');
      paperclip.title = '첨부파일 있음';
      link.append(paperclip);
    }
    link.append(sourceTag(message.provider), element('time', 'm1-row-time', time));
    const tags = [message.stale && '캐시', message.detailError && '원본 확인 필요', analysis].filter(Boolean);
    if (tags.length) link.append(element('span', 'm1-row-status', tags.join(' · ')));
    link.addEventListener('click', open);
    el.append(link);
    return el;
  }

  function calendarEvent(event, action) {
    const kind = eventNames[event.kind] ? event.kind : 'unknown';
    const el = component(element('button', 'm1-calendar-event m1-event-' + kind),
      'Mail / Calendar Event', eventVariants[kind]);
    el.type = 'button';
    el.title = event.title;
    if (kind === 'deadline') el.append(icon('deadline-dot'));
    el.append(element('span', '', event.title));
    if (event.dateProvenance === 'inferred') el.setAttribute('aria-label', event.title + ' · 날짜 추론');
    el.addEventListener('click', action);
    return el;
  }

  function notice(message, { operation, retry } = {}) {
    const ids = { read: '470:5442', move: '470:5453' };
    const el = component(element('div', 'm1-operation-error'), 'Mail / Operation Error', ids[operation]);
    el.setAttribute('role', 'status');
    el.append(icon('alert'), element('p', '', message));
    if (retry) el.append(button('다시 불러오기', retry, { variant: 'secondary' }));
    return el;
  }

  function empty(title, detail, { loading = false } = {}) {
    const el = element('div', 'm1-empty' + (loading ? ' m1-loading' : ''));
    el.dataset.figmaNode = loading ? '470:6425' : '470:5477';
    el.setAttribute('role', 'status');
    if (!loading) el.append(icon('inbox'));
    el.append(element('strong', '', title));
    if (detail) el.append(element('p', '', detail));
    if (loading) {
      el.setAttribute('aria-busy', 'true');
      for (let index = 0; index < 5; index++) el.append(element('span', 'm1-skeleton-line'));
    }
    return el;
  }

  global.MailWorkspaceComponents = { element, component, icon, button, navItem, sourceTag, row, calendarEvent, notice, empty, providers, eventNames };
})(window);
