'use strict';

// 강의 노트 텍스트 상자(2026-10-01 사용자 결정 — 노트북처럼 Pencil이 없을 때 유용하다). 페이지 위에 타이핑한 글을
// 놓는다. 자료 필기(annotation body.texts)가 가지므로 필기와 같이 저장·충돌 처리된다. 위치·폭·글자 크기는 모두
// 페이지 폭 비율이라 확대하면 글도 같이 커진다. 원형 메뉴 `텍스트`는 누른 자리에, 레일 `T`는 보이는 곳 가운데에 둔다.
(function (global) {
  const { el, svg, Recorder } = global.LectureCommon;

  // 글자 크기: 페이지 폭의 1.8%(폭 900px에서 약 16px). 상자 폭 기본 32%, 최소 8%.
  const SIZE = 0.018;
  const WIDTH = 0.32;
  const MIN_WIDTH = 0.08;
  const INK = '#1D2622';

  function attach(v) {
    const texts = () => v.body.texts || [];
    const byId = id => texts().find(item => item.id === id);
    const pageOf = number => v.pages[number - 1];

    function create(page, point) {
      const item = {
        id: `t_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
        page: page.number,
        x: Math.min(point[0], 1 - WIDTH),
        y: point[1],
        w: WIDTH,
        size: SIZE,
        color: INK,
        text: '',
        created_at: Date.now(),
        // 소속은 필기와 같이 `강의·복습` 토글이 정한다(§8.2).
        mode: v.mode || null,
        source_session_id: v.mode === 'lecture' ? v.session?.id ?? null : null,
        t_ms: v.mode === 'lecture' && v.session ? Recorder().sessionT(v.session, performance.now()) : null,
      };
      (v.body.texts ||= []).push(item);
      renderPage(page);
      page.el.querySelector(`[data-text-id="${item.id}"] .lecture-textbox-input`)?.focus();
    }

    function createAtView(number) {
      const page = pageOf(number);
      if (!page) return;
      const box = page.el.getBoundingClientRect();
      const view = v.scroller.getBoundingClientRect();
      const x = (Math.max(box.left, view.left) + Math.min(box.right, view.right)) / 2 - (WIDTH / 2) * box.width;
      const y = (Math.max(box.top, view.top) + Math.min(box.bottom, view.bottom)) / 2;
      create(page, global.LectureInk.pagePoint(page, { clientX: Math.max(x, box.left), clientY: y }).slice(0, 2));
    }

    function remove(id) {
      v.body.texts = texts().filter(item => item.id !== id);
      v.changed();
    }

    // 끌기: 손잡이로 옮기고 오른쪽 끝으로 폭을 바꾼다. 놓을 때 한 번 저장한다.
    function drag(handle, page, onMove) {
      handle.addEventListener('pointerdown', event => {
        event.preventDefault();
        event.stopPropagation();
        handle.setPointerCapture(event.pointerId);
        const width = page.el.offsetWidth;
        const start = { x: event.clientX, y: event.clientY };
        const move = next => onMove((next.clientX - start.x) / width, (next.clientY - start.y) / width, false);
        const end = next => {
          handle.removeEventListener('pointermove', move);
          handle.removeEventListener('pointerup', end);
          handle.removeEventListener('pointercancel', end);
          onMove((next.clientX - start.x) / width, (next.clientY - start.y) / width, true);
        };
        handle.addEventListener('pointermove', move);
        handle.addEventListener('pointerup', end);
        handle.addEventListener('pointercancel', end);
      });
    }

    function place(node, item, page) {
      node.style.left = `${item.x * 100}%`;
      node.style.top = `${(item.y / page.aspect) * 100}%`;
      node.style.width = `${item.w * 100}%`;
      node.style.fontSize = `calc(var(--lc-page-w) * ${item.size})`;
    }

    function textNode(item, page) {
      const node = el('div', 'lecture-textbox');
      node.dataset.textId = item.id;
      place(node, item, page);
      const input = el('div', 'lecture-textbox-input');
      input.contentEditable = 'plaintext-only';
      input.spellcheck = false;
      input.textContent = item.text;
      input.style.color = item.color;
      input.setAttribute('aria-label', '텍스트 상자');
      input.addEventListener('input', () => {
        item.text = input.innerText.replace(/\n$/, '');
        v.changed();
      });
      // 비운 채 나가면 상자를 지운다.
      node.addEventListener('focusout', event => {
        if (node.contains(event.relatedTarget)) return;
        if (!item.text.trim()) {
          node.remove();
          if (byId(item.id)) remove(item.id);
        }
      });
      // 상자 위에서는 필기를 시작하지 않는다.
      node.addEventListener('pointerdown', event => event.stopPropagation());

      const grip = el('button', 'lecture-textbox-grip');
      grip.type = 'button';
      grip.setAttribute('aria-label', '옮기기');
      const origin = {};
      drag(grip, page, (dx, dy, done) => {
        if (origin.x == null) Object.assign(origin, { x: item.x, y: item.y });
        item.x = Math.max(0, Math.min(1 - item.w, origin.x + dx));
        item.y = Math.max(0, Math.min(page.aspect - 0.01, origin.y + dy));
        place(node, item, page);
        if (done) { delete origin.x; delete origin.y; v.changed(); }
      });
      const resize = el('button', 'lecture-textbox-resize');
      resize.type = 'button';
      resize.setAttribute('aria-label', '폭 조절');
      const startWidth = {};
      drag(resize, page, (dx, _dy, done) => {
        if (startWidth.w == null) startWidth.w = item.w;
        item.w = Math.max(MIN_WIDTH, Math.min(1 - item.x, startWidth.w + dx));
        place(node, item, page);
        if (done) { delete startWidth.w; v.changed(); }
      });
      const trash = el('button', 'lecture-textbox-delete');
      trash.type = 'button';
      trash.append(svg('<svg viewBox="0 0 20 20" width="20" height="20" fill="none"><path d="M7 7L13 13M13 7L7 13" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/></svg>'));
      trash.setAttribute('aria-label', '텍스트 상자 지우기');
      trash.addEventListener('click', () => { node.remove(); remove(item.id); });
      node.append(grip, input, resize, trash);
      return node;
    }

    function renderPage(page) {
      page.el.querySelectorAll('.lecture-textbox').forEach(node => node.remove());
      texts().filter(item => item.page === page.number).forEach(item => page.el.append(textNode(item, page)));
    }

    // 확대가 바뀌면 글자 크기 기준(페이지 폭)만 바꾼다. 위치·폭은 비율이라 그대로 맞는다.
    function layout() {
      v.pages.forEach(page => page.el.style.setProperty('--lc-page-w', `${page.el.offsetWidth}px`));
    }

    function render() {
      layout();
      v.pages.forEach(renderPage);
    }

    return { create, createAtView, render, layout };
  }

  // 올가미 이미지(lecture-qa.js)가 쓴다. 화면 줄바꿈과 같은 규칙(공백·글자 단위)으로 감싼다.
  function drawTexts(ctx, items, scale) {
    items.forEach(item => {
      const size = item.size * scale;
      ctx.font = `${size}px -apple-system, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif`;
      ctx.fillStyle = item.color || INK;
      ctx.textBaseline = 'top';
      const maxWidth = item.w * scale - size * 0.5;
      let y = item.y * scale + size * 0.25;
      item.text.split('\n').forEach(paragraph => {
        let line = '';
        [...paragraph].forEach(char => {
          if (line && ctx.measureText(line + char).width > maxWidth) {
            ctx.fillText(line, item.x * scale + size * 0.25, y);
            y += size * 1.35;
            line = char.trimStart();
          } else line += char;
        });
        ctx.fillText(line, item.x * scale + size * 0.25, y);
        y += size * 1.35;
      });
    });
  }

  global.LectureText = { attach, drawTexts };
})(window);
