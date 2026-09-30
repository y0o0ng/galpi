'use strict';

// 강의 노트 필기 도구 레일. 화면 정본은 Figma `펜 선택 동작`·Viewer v0.5 A/B, 계약은 설계 §0 v4.3 합의다.
// - 펜은 한 번 눌러 고르고, 고른 펜을 다시 누르면 설정이 열린다. `+`로 최대 15개까지 만든다.
// - 레일은 세로·가로를 바꿀 수 있고 전환 버튼은 레일 끝이다. 펜은 끝선 안에 숨고 고른 펜만 나온다.
// - 초록 계열은 복습 펜 전용이라 일반 펜·형광펜에서 고를 수 없다(§8.2).
(function (global) {
  const STORAGE_KEY = 'galpi-lecture-pens';
  const MAX_PENS = 15;
  // 굵기 1.0이 페이지 폭의 0.24%다(A4 폭 약 0.5mm).
  const WIDTH_UNIT = 0.0024;
  const HIGHLIGHT_ALPHA = 0.35;
  const PALETTE = ['#1D2622', '#6B7670', '#C95B55', '#4A6FA5', '#7A67A8', '#D4A72C'];
  const HIGHLIGHT_PALETTE = ['#F2D14B', '#F5A55B', '#E88BD6', '#8EC5F2', '#C9A3F0', '#B8BEC0'];
  // 복습 전용 초록 대역. 채도 하한은 설계상 실기기 튜닝 값이다(§8.2) — 회녹색까지 막으면 올린다.
  const REVIEW_GREEN_HUE = [105, 165];
  const REVIEW_GREEN_MIN_SATURATION = 0.25;
  const DEFAULT_PENS = [
    { tool: 'pen', color: '#1D2622', width: 1 },
    { tool: 'pen', color: '#C95B55', width: 1 },
    { tool: 'pen', color: '#4A6FA5', width: 1 },
    { tool: 'highlighter', color: '#F2D14B', width: 3 },
    { tool: 'eraser', color: null, width: 1 },
  ];

  function isReviewGreen(hex) {
    const value = /^#([0-9a-f]{6})$/i.exec(hex || '');
    if (!value) return false;
    const [r, g, b] = [0, 2, 4].map(index => parseInt(value[1].slice(index, index + 2), 16) / 255);
    const max = Math.max(r, g, b);
    const delta = max - Math.min(r, g, b);
    if (!delta || !max) return false;
    const hue = max === r ? 60 * (((g - b) / delta) % 6) : max === g ? 60 * ((b - r) / delta + 2) : 60 * ((r - g) / delta + 4);
    const normalized = (hue + 360) % 360;
    return normalized >= REVIEW_GREEN_HUE[0] && normalized <= REVIEW_GREEN_HUE[1] && delta / max >= REVIEW_GREEN_MIN_SATURATION;
  }

  function load() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (Array.isArray(saved?.pens) && saved.pens.length) {
        return { pens: saved.pens.slice(0, MAX_PENS), selected: Math.min(saved.selected || 0, saved.pens.length - 1), orientation: saved.orientation === 'horizontal' ? 'horizontal' : 'vertical' };
      }
    } catch { /* 기본값으로 */ }
    return { pens: DEFAULT_PENS.map(pen => ({ ...pen })), selected: 0, orientation: 'vertical' };
  }
  const save = settings => { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); } catch { /* 이번 실행에서만 유지 */ } };

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }
  function icon(markup) {
    const wrap = el('span', 'lecture-icon');
    wrap.innerHTML = markup;
    wrap.setAttribute('aria-hidden', 'true');
    return wrap;
  }
  const penSvg = color => `<svg viewBox="0 0 40 16" width="40" height="16"><path d="M0 3h24v10H0z" fill="#FAFBF9" stroke="#1D2622" stroke-width="1"/><path d="M0 3h9v10H0z" fill="${color}"/><path d="M24 3l12 5-12 5z" fill="${color}" stroke="#1D2622" stroke-width="1" stroke-linejoin="round"/></svg>`;
  const highlighterSvg = color => `<svg viewBox="0 0 40 16" width="40" height="16"><path d="M0 2h22v12H0z" fill="#FAFBF9" stroke="#1D2622" stroke-width="1"/><path d="M0 2h9v12H0z" fill="${color}"/><path d="M22 3.5h8l4 2v5l-4 2h-8z" fill="${color}" stroke="#1D2622" stroke-width="1" stroke-linejoin="round"/></svg>`;
  const ERASER_SVG = '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M4 15.5 13.5 6l5 5L9 20.5H5.5L4 19z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M9 10.5 14 15.5M9 20.5h11" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
  const PLUS_SVG = '<svg viewBox="0 0 16 16" width="16" height="16"><path d="M8 3v10M3 8h10" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
  // 세로↔가로 전환. 회전해도 잉크가 가운데 있게 중심 대칭으로 그린다.
  const ROTATE_SVG = '<svg viewBox="0 0 20 20" width="20" height="20"><rect x="4" y="4" width="12" height="12" rx="3" fill="none" stroke="currentColor" stroke-width="1.4" stroke-dasharray="3 2"/><path d="M8 12l4-4M9 8h3v3" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const toolLabel = { pen: '펜', highlighter: '형광펜', eraser: '지우개' };

  function buildRail({ toast }) {
    const settings = load();
    const rail = el('div', 'lecture-rail');
    rail.setAttribute('role', 'toolbar');
    rail.setAttribute('aria-label', '필기 도구');
    const pensEl = el('div', 'lecture-rail-pens');
    const add = el('button', 'lecture-rail-tool lecture-rail-add');
    add.type = 'button';
    add.setAttribute('aria-label', '펜 추가');
    add.append(icon(PLUS_SVG));
    const turn = el('button', 'lecture-rail-tool lecture-rail-turn');
    turn.type = 'button';
    turn.append(icon(ROTATE_SVG));
    rail.append(pensEl, add, el('span', 'lecture-rail-divider'), turn);
    let menu = null;

    const persist = () => save(settings);
    function closeMenu() {
      menu?.remove();
      menu = null;
      document.removeEventListener('pointerdown', onOutside, true);
    }
    function onOutside(event) {
      if (menu && !menu.contains(event.target) && !event.target.closest?.('.lecture-rail-pen.active')) closeMenu();
    }

    function render() {
      rail.classList.toggle('is-horizontal', settings.orientation === 'horizontal');
      turn.setAttribute('aria-label', settings.orientation === 'horizontal' ? '세로 레일로' : '가로 레일로');
      add.disabled = settings.pens.length >= MAX_PENS;
      pensEl.replaceChildren(...settings.pens.map((pen, index) => {
        const button = el('button', `lecture-rail-pen is-${pen.tool}${index === settings.selected ? ' active' : ''}`);
        button.type = 'button';
        button.setAttribute('aria-label', `${toolLabel[pen.tool]} ${index + 1}${index === settings.selected ? ' · 다시 누르면 설정' : ''}`);
        button.append(icon(pen.tool === 'eraser' ? ERASER_SVG : pen.tool === 'highlighter' ? highlighterSvg(pen.color) : penSvg(pen.color)));
        if (pen.tool !== 'eraser') button.append(el('span', 'lecture-rail-width', pen.width.toFixed(1)));
        button.addEventListener('click', () => {
          if (index === settings.selected) return menu ? closeMenu() : openMenu(button);
          settings.selected = index;
          persist();
          closeMenu();
          render();
        });
        return button;
      }));
    }

    function openMenu(anchor) {
      closeMenu();
      const pen = settings.pens[settings.selected];
      menu = el('div', 'lecture-pen-menu');
      const tools = el('div', 'lecture-segment is-three');
      Object.entries(toolLabel).forEach(([tool, label]) => {
        const option = el('button', tool === pen.tool ? 'active' : '', label);
        option.type = 'button';
        option.addEventListener('click', () => {
          pen.tool = tool;
          if (tool === 'eraser') pen.color = null;
          else if (!pen.color) pen.color = tool === 'highlighter' ? HIGHLIGHT_PALETTE[0] : PALETTE[0];
          if (tool === 'highlighter' && pen.width < 2) pen.width = 3;
          persist(); render(); openMenu(pensEl.children[settings.selected]);
        });
        tools.append(option);
      });
      menu.append(tools);

      if (pen.tool !== 'eraser') {
        const swatches = el('div', 'lecture-swatches');
        (pen.tool === 'highlighter' ? HIGHLIGHT_PALETTE : PALETTE).forEach(color => {
          const swatch = el('button', `lecture-swatch${color.toLowerCase() === pen.color?.toLowerCase() ? ' active' : ''}`);
          swatch.type = 'button';
          swatch.style.setProperty('--swatch', color);
          swatch.setAttribute('aria-label', color);
          swatch.addEventListener('click', () => { pen.color = color; persist(); render(); openMenu(pensEl.children[settings.selected]); });
          swatches.append(swatch);
        });
        // 무지개 버튼은 기기의 기본 색 선택기다. 스펙트럼은 바꾸지 않고 고른 결과만 검증한다(§8.2).
        const custom = el('label', 'lecture-swatch is-custom');
        custom.setAttribute('aria-label', '다른 색');
        const input = el('input');
        input.type = 'color';
        input.value = pen.color || '#1D2622';
        input.addEventListener('change', () => {
          if (isReviewGreen(input.value)) {
            toast('이 색상은 복습 필기 전용이에요');
            input.value = pen.color;
            return;
          }
          pen.color = input.value;
          persist(); render(); openMenu(pensEl.children[settings.selected]);
        });
        custom.append(input);
        swatches.append(custom);
        menu.append(el('span', 'lecture-menu-label', '색상'), swatches);
      }

      const widthRow = el('div', 'lecture-menu-row');
      const value = el('span', 'lecture-menu-value', pen.width.toFixed(1));
      widthRow.append(el('span', 'lecture-menu-label', pen.tool === 'eraser' ? '크기' : '굵기'), value);
      const slider = el('input', 'lecture-slider');
      slider.type = 'range';
      slider.min = '0.3';
      slider.max = '20';
      slider.step = '0.1';
      slider.value = String(pen.width);
      slider.addEventListener('input', () => { pen.width = Number(slider.value); value.textContent = pen.width.toFixed(1); });
      slider.addEventListener('change', () => { persist(); render(); });
      const range = el('div', 'lecture-menu-range');
      range.append(el('span', '', '0.3'), el('span', '', '20.0'));
      menu.append(widthRow, slider, range);

      if (settings.pens.length > 1) {
        const remove = el('button', 'lecture-menu-danger', '삭제');
        remove.type = 'button';
        remove.addEventListener('click', () => {
          settings.pens.splice(settings.selected, 1);
          settings.selected = Math.max(0, settings.selected - 1);
          persist(); closeMenu(); render();
        });
        menu.append(remove);
      }

      document.body.append(menu);
      const box = anchor.getBoundingClientRect();
      const horizontal = settings.orientation === 'horizontal';
      const left = horizontal ? box.left : box.right + 12;
      const top = horizontal ? box.bottom + 12 : box.top - 20;
      menu.style.left = `${Math.max(16, Math.min(left, innerWidth - menu.offsetWidth - 16))}px`;
      menu.style.top = `${Math.max(16, Math.min(top, innerHeight - menu.offsetHeight - 16))}px`;
      document.addEventListener('pointerdown', onOutside, true);
    }

    add.addEventListener('click', () => {
      if (settings.pens.length >= MAX_PENS) return;
      const base = settings.pens[settings.selected];
      settings.pens.push({ ...base, tool: base.tool === 'eraser' ? 'pen' : base.tool, color: base.color || PALETTE[0] });
      settings.selected = settings.pens.length - 1;
      persist(); closeMenu(); render();
      pensEl.lastElementChild?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
    turn.addEventListener('click', () => {
      settings.orientation = settings.orientation === 'horizontal' ? 'vertical' : 'horizontal';
      persist(); closeMenu(); render();
    });
    render();

    return {
      el: rail,
      current: () => settings.pens[settings.selected],
      close: closeMenu,
    };
  }

  global.LecturePens = { buildRail, isReviewGreen, WIDTH_UNIT, HIGHLIGHT_ALPHA };
})(window);
