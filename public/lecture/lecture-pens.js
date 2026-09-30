'use strict';

// 강의 노트 필기 도구 레일. 화면 정본은 Figma `펜 선택 동작`·Viewer v0.5 A/B, 계약은 설계 §0 v4.3 합의다.
// - 펜은 한 번 눌러 고르고, 고른 펜을 다시 누르면 설정이 열린다. `+`로 최대 15개까지 만든다.
// - 레일은 세로·가로를 바꿀 수 있고 전환 버튼은 레일 끝이다. 펜은 끝선 안에 숨고 고른 펜만 나온다.
// - 초록 계열은 복습 펜 전용이라 일반 펜·형광펜에서 고를 수 없다(§8.2).
// - `강의`·`복습` 모드마다 펜 목록이 따로다. 복습에서는 review_pen(초록만)과 지우개만 보인다.
(function (global) {
  const ORIENTATION_KEY = 'galpi-lecture-rail-orientation';
  const MAX_PENS = 15;
  // 굵기 1.0이 페이지 폭의 0.24%다(A4 폭 약 0.5mm).
  const WIDTH_UNIT = 0.0024;
  // Figma `Annotation rendering` 형광펜 견본의 불투명도.
  const HIGHLIGHT_ALPHA = 0.42;
  // Figma `Pen settings popover`의 빠른 팔레트. 형광펜은 레일 기본값의 두 색을 앞에 둔다.
  const PALETTE = ['#1D2622', '#6E7772', '#C65C58', '#4A6FA5', '#7966A8', '#D2A72A'];
  const HIGHLIGHT_PALETTE = ['#F2F456', '#DD56F4', '#F5A55B', '#8EC5F2', '#C9A3F0', '#B8BEC0'];
  // 복습 전용 초록 대역. 2026-09-30 iPad 실측에서 105°–165°로는 연두·라임이 통과해 80°–170°로 넓혔다(§8.2).
  // 채도 하한은 설계상 실기기 튜닝 값이다 — 회녹색까지 막으면 올린다.
  const REVIEW_GREEN_HUE = [80, 170];
  const REVIEW_GREEN_MIN_SATURATION = 0.25;
  // Figma `Floating Toolbar` 기본 구성.
  const DEFAULT_PENS = [
    { tool: 'pen', color: '#000000', width: 1 },
    { tool: 'pen', color: '#5F6E66', width: 1 },
    { tool: 'pen', color: '#D33538', width: 1 },
    { tool: 'pen', color: '#0088FF', width: 1 },
    { tool: 'highlighter', color: '#DD56F4', width: 3 },
    { tool: 'highlighter', color: '#F2F456', width: 3 },
    { tool: 'eraser', color: null, width: 1 },
  ];
  // 복습 펜은 초록 계열만(Figma `review_pen` 견본 #2F6B57). 모두 예약 대역 안이다.
  const REVIEW_PALETTE = ['#2F6B57', '#2E8B57', '#4FA37F', '#1E4D3E', '#7BBF9E', '#5C9E3A'];
  const REVIEW_PENS = [
    { tool: 'review_pen', color: '#2F6B57', width: 1 },
    { tool: 'review_pen', color: '#4FA37F', width: 1 },
    { tool: 'review_pen', color: '#7BBF9E', width: 5 },
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

  const MODES = {
    // v2: 기본 펜을 Figma 레일 구성으로 바꾸면서 옛 저장값을 한 번 버렸다.
    lecture: {
      key: 'galpi-lecture-pens-v2',
      defaults: DEFAULT_PENS,
      tools: { pen: '펜', highlighter: '형광펜', eraser: '지우개' },
      palette: tool => (tool === 'highlighter' ? HIGHLIGHT_PALETTE : PALETTE),
      allows: color => !isReviewGreen(color),
      refusal: '이 색상은 복습 필기 전용이에요',
      drawTool: 'pen',
    },
    review: {
      key: 'galpi-lecture-review-pens-v1',
      defaults: REVIEW_PENS,
      tools: { review_pen: '복습 펜', eraser: '지우개' },
      palette: () => REVIEW_PALETTE,
      allows: isReviewGreen,
      refusal: '복습 필기는 초록 계열만 쓸 수 있어요',
      drawTool: 'review_pen',
    },
  };

  // 저장값이 모드 밖의 도구나 허용되지 않는 색을 들고 있으면 기본값으로 돌린다.
  function load(modeName) {
    const mode = MODES[modeName];
    try {
      const saved = JSON.parse(localStorage.getItem(mode.key));
      const pens = Array.isArray(saved?.pens) ? saved.pens.filter(pen => pen.tool in mode.tools).slice(0, MAX_PENS) : [];
      pens.forEach(pen => { if (pen.tool !== 'eraser' && !mode.allows(pen.color)) pen.color = mode.palette(pen.tool)[0]; });
      if (pens.length) return { pens, selected: Math.min(saved.selected || 0, pens.length - 1) };
    } catch { /* 기본값으로 */ }
    return { pens: mode.defaults.map(pen => ({ ...pen })), selected: 0 };
  }
  const store = (key, value) => { try { localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value)); } catch { /* 이번 실행에서만 유지 */ } };
  function loadOrientation() {
    try {
      const saved = localStorage.getItem(ORIENTATION_KEY) || JSON.parse(localStorage.getItem(MODES.lecture.key))?.orientation;
      return saved === 'horizontal' ? 'horizontal' : 'vertical';
    } catch { return 'vertical'; }
  }

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
  // Figma `pen 1`·`highlighter`·`eraser` 컴포넌트(78:1128·78:1214·78:1229)의 경로다. 몸통 색만 펜 색으로 바꾼다.
  // 원뿔은 원본에 채우기가 없어 어두운 레일에서 속이 비어 보이므로 흰색으로 채워 깐다(2026-09-30).
  const penSvg = color => `<svg viewBox="0 0 21 41" width="21" height="41"><path d="M0.661765 20.2757H13.8382V21.7776L9 33.793H5.60294L0.661765 21.7776Z" fill="#FFFFFF"/><path d="M0.25 0.25V20.2757H0.661765H5.5H9H13.8382H14.25V0.25H0.25Z" fill="${color}"/><path d="M6.01471 33.793L7.25 38.2988L8.48529 33.793H6.01471Z" fill="${color}"/><path d="M0.661765 20.2757H5.5H9H13.8382M0.661765 20.2757H0.25V0.25H14.25V20.2757H13.8382M0.661765 20.2757V21.7776L5.60294 33.793H6.01471M13.8382 20.2757V21.7776L9 33.793H8.48529M6.01471 33.793L7.25 38.2988L8.48529 33.793M6.01471 33.793H8.48529" fill="none" stroke="#000000" stroke-width="0.5"/></svg>`;
  const highlighterSvg = color => `<svg viewBox="0 0 21 41" width="21" height="41"><path d="M0.691176 20.2757H14.8608L14.8088 21.7776C14.1081 26.75 10.9643 31.25 10.9643 31.25L10.4286 33.75H5.07143L4.53571 31.25C4.53571 31.25 1.32143 26.75 0.691176 21.7776Z" fill="#FFFFFF"/><path d="M0.25 0.25V20.2757H0.691176H5.875H9.625H14.8608H15.25V0.25H0.25Z" fill="${color}"/><path d="M5.60714 33.75L5.75 38.25L9.25 37.75L9.89286 33.75H5.60714Z" fill="${color}"/><path d="M0.691176 20.2757H5.875H9.625H14.8608M0.691176 20.2757H0.25V0.25H15.25V20.2757H14.8608M0.691176 20.2757V21.7776C1.32143 26.75 4.53571 31.25 4.53571 31.25L5.07143 33.75H5.60714M14.8608 20.2757L14.8088 21.7776C14.1081 26.75 10.9643 31.25 10.9643 31.25L10.4286 33.75H9.89286M5.60714 33.75L5.75 38.25L9.25 37.75L9.89286 33.75M5.60714 33.75H9.89286" fill="none" stroke="#000000" stroke-width="0.5"/></svg>`;
  const ERASER_PEN_SVG = '<svg viewBox="0 0 21 41" width="21" height="41"><path d="M0.46902 23.25C0.170912 24.0287 0.233563 23.9723 0.525454 24.75H14.0146C14.3312 23.948 14.3164 24.0113 14.0145 23.25H0.46902Z" fill="#2C2C29"/><path d="M0.46902 21.75C0.184727 22.531 0.17669 22.469 0.46902 23.25H14.0145C14.3158 22.4594 14.3152 22.5198 14.0145 21.75H0.46902Z" fill="#2C2C29"/><path d="M0.46902 20.2757C0.165906 21.0655 0.188295 21.0035 0.46902 21.75H14.0145C14.3265 20.9489 14.3233 21.0351 14.0145 20.2757H0.46902Z" fill="#2C2C29"/><path d="M0.46902 0.25V20.2757H14.0145V0.25H0.46902Z" fill="#E8CA37"/><path d="M14.0146 24.75H0.525454V28.25C0.637207 31.4027 1.56073 34.25 7.27004 34.25C12.7299 34.25 13.8093 31.2748 13.9928 28.25L14.0146 24.75Z" fill="#F56062"/><path d="M0.46902 20.2757V0.25H14.0145V20.2757M0.46902 20.2757C0.165906 21.0655 0.188295 21.0035 0.46902 21.75M0.46902 20.2757H14.0145M14.0145 20.2757C14.3233 21.0351 14.3265 20.9489 14.0145 21.75M0.525454 24.75C0.233563 23.9723 0.170912 24.0287 0.46902 23.25M0.525454 24.75H14.0146M0.525454 24.75V28.25C0.637207 31.4027 1.56073 34.25 7.27004 34.25C12.7299 34.25 13.8093 31.2748 13.9928 28.25L14.0146 24.75M0.46902 23.25C0.17669 22.469 0.184727 22.531 0.46902 21.75M0.46902 23.25H14.0145M0.46902 21.75H14.0145M14.0145 21.75C14.3152 22.5198 14.3158 22.4594 14.0145 23.25M14.0145 23.25C14.3164 24.0113 14.3312 23.948 14.0146 24.75" fill="none" stroke="#000000" stroke-width="0.5"/></svg>';
  const toolSvg = pen => (pen.tool === 'eraser' ? ERASER_PEN_SVG : pen.tool === 'highlighter' ? highlighterSvg(pen.color) : penSvg(pen.color));
  const toolName = tool => ({ ...MODES.lecture.tools, ...MODES.review.tools })[tool];
  const PLUS_SVG = '<svg viewBox="0 0 20 20" width="20" height="20"><path d="M10 3.75V16.25M3.75 10H16.25" stroke="currentColor" stroke-width="1.875" stroke-linecap="round"/></svg>';
  // Figma `Floating Toolbar`의 `Lasso`(150:93)·`Sticky`(150:97) 아이콘.
  const LASSO_SVG = '<svg viewBox="0 0 24 24" width="24" height="24" fill="none"><path d="M5.5 14.5C3.6 13.3 3 11.8 3 10.5C3 6.9 7 4 12 4C17 4 21 6.9 21 10.5C21 14.1 17 17 12 17C10.7 17 9.5 16.8 8.4 16.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-dasharray="2.5 2.5"/><path d="M6 13.5C7.2 13.5 8.2 14.5 8.2 15.7C8.2 16.9 7.2 18 6 18C4.8 18 4.5 18.8 4.5 19.8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
  const STICKY_SVG = '<svg viewBox="0 0 24 24" width="24" height="24" fill="none"><path d="M13 19.9991C12.9051 20 12.7986 20 12.677 20H7.19691C6.07899 20 5.5192 20 5.0918 19.7822C4.71547 19.5905 4.40973 19.2842 4.21799 18.9079C4 18.4801 4 17.9203 4 16.8002V7.2002C4 6.08009 4 5.51962 4.21799 5.0918C4.40973 4.71547 4.71547 4.40973 5.0918 4.21799C5.51962 4 6.08009 4 7.2002 4H16.8002C17.9203 4 18.4796 4 18.9074 4.21799C19.2837 4.40973 19.5905 4.71547 19.7822 5.0918C20 5.5192 20 6.07899 20 7.19691V12.6747C20 12.7973 20 12.9045 19.9991 13C19.9964 13.2855 19.9857 13.4659 19.9443 13.6384C19.8953 13.8424 19.8142 14.0379 19.7046 14.2168C19.5809 14.4186 19.4089 14.5916 19.063 14.9375L14.9375 19.063C14.5916 19.4089 14.4186 19.5814 14.2168 19.705C14.0379 19.8147 13.8429 19.8958 13.6388 19.9448C13.4663 19.9862 13.2857 19.9966 13 19.9991ZM19.9991 13H14.5996C14.0396 13 13.7598 13 13.5459 13.109C13.3577 13.2049 13.2049 13.3577 13.109 13.5459C13 13.7598 13 14.04 13 14.6001V19.9991" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const ROTATE_SVG = '<svg viewBox="0 0 20 20" width="20" height="20"><path d="M14 3H6C4.34315 3 3 4.34315 3 6V14C3 15.6569 4.34315 17 6 17H14C15.6569 17 17 15.6569 17 14V6C17 4.34315 15.6569 3 14 3Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="2 2"/><path d="M8 8H13V13" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M13 8L7 14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';

  // onSticky: 레일 포스트잇 버튼. onSelect(on): 올가미 선택 모드가 켜지고 꺼질 때.
  function buildRail({ toast, mode: initialMode = 'lecture', onSticky = () => {}, onSelect = () => {} }) {
    let modeName = initialMode;
    let mode = MODES[modeName];
    let settings = load(modeName);
    let orientation = loadOrientation();
    let lastDraw = settings.selected;
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
    const lasso = el('button', 'lecture-rail-tool lecture-rail-lasso');
    lasso.type = 'button';
    lasso.setAttribute('aria-label', '올가미 선택');
    lasso.append(icon(LASSO_SVG));
    const sticky = el('button', 'lecture-rail-tool lecture-rail-sticky');
    sticky.type = 'button';
    sticky.setAttribute('aria-label', '포스트잇');
    sticky.append(icon(STICKY_SVG));
    rail.append(pensEl, add, el('span', 'lecture-rail-divider'), lasso, sticky, el('span', 'lecture-rail-divider'), turn);
    let menu = null;
    // 선택 모드는 펜 대신 켜지는 도구다. 펜을 고르면 꺼진다.
    let selecting = false;
    function setSelecting(on) {
      if (selecting === on) return;
      selecting = on;
      onSelect(on);
      render();
    }

    const persist = () => store(mode.key, settings);
    function closeMenu() {
      menu?.remove();
      menu = null;
      document.removeEventListener('pointerdown', onOutside, true);
    }
    function onOutside(event) {
      if (menu && !menu.contains(event.target) && !event.target.closest?.('.lecture-rail-pen.active')) closeMenu();
    }

    function render() {
      if (settings.pens[settings.selected]?.tool !== 'eraser') lastDraw = settings.selected;
      rail.classList.toggle('is-horizontal', orientation === 'horizontal');
      rail.dataset.mode = modeName;
      lasso.classList.toggle('active', selecting);
      lasso.setAttribute('aria-pressed', String(selecting));
      turn.setAttribute('aria-label', orientation === 'horizontal' ? '세로 레일로' : '가로 레일로');
      add.disabled = settings.pens.length >= MAX_PENS;
      pensEl.replaceChildren(...settings.pens.map((pen, index) => {
        const button = el('button', `lecture-rail-pen is-${pen.tool}${index === settings.selected && !selecting ? ' active' : ''}`);
        button.type = 'button';
        button.setAttribute('aria-label', `${toolName(pen.tool)} ${index + 1}${index === settings.selected ? ' · 다시 누르면 설정' : ''}`);
        button.append(icon(toolSvg(pen)), el('span', 'lecture-rail-width', pen.width.toFixed(1)));
        button.addEventListener('click', () => {
          if (selecting) {
            settings.selected = index;
            persist();
            return setSelecting(false);
          }
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
      const tools = el('div', 'lecture-menu-tools');
      Object.entries(mode.tools).forEach(([tool, label]) => {
        const option = el('button', `lecture-menu-tool${tool === pen.tool ? ' active' : ''}`);
        option.type = 'button';
        option.setAttribute('aria-label', label);
        option.append(icon(toolSvg({ tool, color: pen.color || mode.palette(tool)[0] })));
        option.addEventListener('click', () => {
          pen.tool = tool;
          if (tool === 'eraser') pen.color = null;
          else if (!pen.color) pen.color = mode.palette(tool)[0];
          if (tool === 'highlighter' && pen.width < 2) pen.width = 3;
          persist(); render(); openMenu(pensEl.children[settings.selected]);
        });
        tools.append(option);
      });
      menu.append(tools, el('hr', 'lecture-menu-divider'));

      if (pen.tool !== 'eraser') {
        const swatches = el('div', 'lecture-swatches');
        mode.palette(pen.tool).forEach(color => {
          const swatch = el('button', `lecture-swatch${color.toLowerCase() === pen.color?.toLowerCase() ? ' active' : ''}`);
          swatch.type = 'button';
          swatch.style.setProperty('--swatch', color);
          swatch.setAttribute('aria-label', color);
          swatch.addEventListener('click', () => { pen.color = color; persist(); render(); openMenu(pensEl.children[settings.selected]); });
          swatches.append(swatch);
        });
        // 무지개 버튼은 기기의 기본 색 선택기다. 스펙트럼은 바꾸지 않고 고른 결과만 검증한다(§8.2).
        // 강의에서는 초록을, 복습에서는 초록이 아닌 색을 거부한다.
        const custom = el('label', 'lecture-swatch is-custom');
        custom.setAttribute('aria-label', '다른 색');
        const input = el('input');
        input.type = 'color';
        input.value = pen.color || '#1D2622';
        // 드래그 중에는 막지 않는다. 막으면 슬라이더가 대역 경계에서 멈춰 그 경계색(눈으로는 초록)이 확정된다.
        // 손을 뗀 최종색만 검사하고, 초록이면 원래 쓰던 색으로 되돌린 뒤 선택기를 닫는다.
        input.addEventListener('change', () => {
          if (!mode.allows(input.value)) {
            toast(mode.refusal);
            input.value = pen.color;
            input.blur();
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
      const fill = () => slider.style.setProperty('--fill', `${((pen.width - 0.3) / (20 - 0.3)) * 100}%`);
      fill();
      slider.addEventListener('input', () => { pen.width = Number(slider.value); value.textContent = pen.width.toFixed(1); fill(); });
      slider.addEventListener('change', () => { persist(); render(); });
      const range = el('div', 'lecture-menu-range');
      range.append(el('span', '', '0.3'), el('span', '', '20.0'));
      menu.append(widthRow, slider, range);

      if (settings.pens.length > 1) {
        menu.append(el('hr', 'lecture-menu-divider'));
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
      const horizontal = orientation === 'horizontal';
      const left = horizontal ? box.left : box.right + 12;
      const top = horizontal ? box.bottom + 12 : box.top - 20;
      menu.style.left = `${Math.max(16, Math.min(left, innerWidth - menu.offsetWidth - 16))}px`;
      menu.style.top = `${Math.max(16, Math.min(top, innerHeight - menu.offsetHeight - 16))}px`;
      document.addEventListener('pointerdown', onOutside, true);
    }

    add.addEventListener('click', () => {
      if (settings.pens.length >= MAX_PENS) return;
      const base = settings.pens[settings.selected];
      settings.pens.push({ ...base, tool: base.tool === 'eraser' ? mode.drawTool : base.tool, color: base.color || mode.palette(mode.drawTool)[0] });
      settings.selected = settings.pens.length - 1;
      persist(); closeMenu(); render();
      pensEl.lastElementChild?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
    lasso.addEventListener('click', () => { closeMenu(); setSelecting(!selecting); });
    sticky.addEventListener('click', () => { closeMenu(); onSticky(); });
    turn.addEventListener('click', () => {
      orientation = orientation === 'horizontal' ? 'vertical' : 'horizontal';
      store(ORIENTATION_KEY, orientation);
      closeMenu(); render();
    });
    render();

    return {
      el: rail,
      current: () => settings.pens[settings.selected],
      close: closeMenu,
      mode: () => modeName,
      selecting: () => selecting,
      setSelecting,
      // 원형 메뉴의 `펜`·`지우개`. 펜은 이 모드에서 마지막으로 쓴 필기 도구로, 지우개는 목록의 첫 지우개로 간다.
      choose(kind) {
        if (kind === 'select') return setSelecting(true);
        if (selecting) { selecting = false; onSelect(false); }
        const index = kind === 'eraser'
          ? settings.pens.findIndex(pen => pen.tool === 'eraser')
          : (settings.pens[lastDraw]?.tool !== 'eraser' && settings.pens[lastDraw] ? lastDraw : settings.pens.findIndex(pen => pen.tool !== 'eraser'));
        if (index < 0) return;
        settings.selected = index;
        persist(); closeMenu(); render();
      },
      allows: color => mode.allows(color),
      refusal: () => mode.refusal,
      setMode(next) {
        if (next === modeName || !MODES[next]) return;
        modeName = next;
        mode = MODES[next];
        settings = load(next);
        lastDraw = settings.selected;
        closeMenu();
        render();
      },
    };
  }

  global.LecturePens = { buildRail, isReviewGreen, WIDTH_UNIT, HIGHLIGHT_ALPHA, REVIEW_PALETTE, PALETTE, HIGHLIGHT_PALETTE };
})(window);
