'use strict';

// 강의 노트 화면 공용 도우미: DOM·아이콘·API·시간 표시·알림. 설계 정본은 docs/Lecture-note-system_Design_v4.3.md다.
(function (global) {
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function svg(markup, className = '') {
    const wrap = document.createElement('span');
    wrap.className = `lecture-icon ${className}`.trim();
    wrap.innerHTML = markup;
    wrap.setAttribute('aria-hidden', 'true');
    return wrap;
  }
  const ICON_BACK = '<svg viewBox="0 0 16 16" width="16" height="16"><path d="M10 3 5 8l5 5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const ICON_PLUS = '<svg viewBox="0 0 16 16" width="12" height="12"><path d="M8 3v10M3 8h10" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
  const ICON_CHEVRON = '<svg viewBox="0 0 16 16" width="16" height="16"><path d="M6 3.5 10.5 8 6 12.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  // Figma `Folder Card`의 `icon/star`(18px). 켜짐은 채우기, 꺼짐은 외곽선 — CSS가 정한다.
  const ICON_STAR = '<svg viewBox="0 0 18 18" width="18" height="18"><path transform="translate(2.025 2.025)" d="M6.975 0 9.1125 4.3875 13.95 5.0625 10.4625 8.4375 11.25 13.275 6.975 11.025 2.7 13.275 3.4875 8.4375 0 5.0625 4.8375 4.3875 6.975 0Z" stroke-linejoin="round"/></svg>';
  // Figma `Icon / coolicons / more`(69:3).
  const ICON_MORE = '<svg viewBox="0 0 24 24" width="24" height="24" fill="none"><path d="M17 12C17 12.5523 17.4477 13 18 13C18.5523 13 19 12.5523 19 12C19 11.4477 18.5523 11 18 11C17.4477 11 17 11.4477 17 12Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M11 12C11 12.5523 11.4477 13 12 13C12.5523 13 13 12.5523 13 12C13 11.4477 12.5523 11 12 11C11.4477 11 11 11.4477 11 12Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 12C5 12.5523 5.44772 13 6 13C6.55228 13 7 12.5523 7 12C7 11.4477 6.55228 11 6 11C5.44772 11 5 11.4477 5 12Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const ICON_SEARCH = '<svg viewBox="0 0 16 16" width="16" height="16"><circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="m10.5 10.5 3 3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>';

  async function api(url, options) {
    const res = await global.apiFetch(url, options);
    const body = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
    if (!res.ok) {
      const error = new Error(body?.error || `요청 실패 (${res.status})`);
      error.status = res.status;
      error.body = body;
      throw error;
    }
    return body;
  }
  const jsonOptions = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  function formatDay(seconds) {
    if (!seconds) return '';
    const date = new Date(seconds * 1000);
    return `${date.getMonth() + 1}월 ${date.getDate()}일`;
  }
  const kindLabel = kind => (kind === 'pdf' ? 'PDF' : '백지 노트');

  const Recorder = () => global.LectureRecorder;
  function clock(ms) {
    const seconds = Math.floor(ms / 1000);
    const hours = Math.floor(seconds / 3600);
    const pad = value => String(value).padStart(2, '0');
    return hours ? `${hours}:${pad(Math.floor(seconds / 60) % 60)}:${pad(seconds % 60)}` : `${Math.floor(seconds / 60)}:${pad(seconds % 60)}`;
  }

  function toast(message) {
    const node = el('div', 'lecture-toast', message);
    document.body.append(node);
    setTimeout(() => node.remove(), 3200);
  }

  // 이 과목에서 지금 녹음이 켜져 있는지. 녹음 중에는 `강의`로 잠기고 마커를 쓸 수 있다.
  const isRecordingHere = v => ['starting', 'recording'].includes(Recorder().state.status) && Recorder().state.containerId === v.container.id;

  global.LectureCommon = {
    el, svg, api, jsonOptions, formatDay, kindLabel, Recorder, clock, toast, isRecordingHere,
    ICON_BACK, ICON_PLUS, ICON_CHEVRON, ICON_SEARCH, ICON_MORE, ICON_STAR,
  };
})(window);
