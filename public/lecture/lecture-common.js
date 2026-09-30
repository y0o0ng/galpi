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
  const ICON_SEARCH = '<svg viewBox="0 0 16 16" width="16" height="16"><circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="m10.5 10.5 3 3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>';
  const ICON_MIC = '<svg viewBox="0 0 24 24" width="22" height="22"><rect x="9" y="3" width="6" height="11" rx="3" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
  const ICON_RECORDING = '<svg viewBox="0 0 24 24" width="24" height="24"><circle cx="12" cy="12" r="9.5" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="12" cy="12" r="5.5" fill="currentColor"/></svg>';

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
    ICON_BACK, ICON_PLUS, ICON_CHEVRON, ICON_SEARCH, ICON_MIC, ICON_RECORDING,
  };
})(window);
