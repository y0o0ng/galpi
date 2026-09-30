'use strict';

// 강의 노트 L2 복습 사이드바(Figma 03 `Linked Lecture Sidebar`, 설계 §12.2). 전사가 아직 없어 전사 목록 자리에
// 재생 구간·`다른 자료`·`녹음 없음` 경계·마커를 보인다. 페이지는 재생을 따라가지 않고 `재생 위치로`로만 옮긴다.
(function (global) {
  const { el, svg, api, clock, toast } = global.LectureCommon;
  // Figma `coolicons` skipBack·skipForward·play·pause와 `재생 위치로` 아이콘.
  const ICONS = {
    back: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none"><path d="M7 5V19M18 10.5713V13.4287C18 15.2557 17.9998 16.1693 17.6162 16.6958C17.2817 17.1549 16.7679 17.4496 16.2028 17.5073C15.5548 17.5733 14.7656 17.113 13.1875 16.1924L10.7305 14.7592C9.17859 13.8539 8.40224 13.401 8.14062 12.8105C7.91202 12.2946 7.91202 11.7062 8.14062 11.1902C8.40267 10.5988 9.18117 10.1446 10.7383 9.2363L13.1875 7.80762L13.1895 7.80644C14.7663 6.88663 15.5551 6.42653 16.2028 6.49256C16.7679 6.55017 17.2817 6.84556 17.6162 7.30469C17.9998 7.83111 18 8.74424 18 10.5713Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    forward: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none"><path d="M17 5V19M6 10.5713V13.4287C6 15.2557 6 16.1693 6.38355 16.6958C6.71806 17.1549 7.23174 17.4496 7.79688 17.5073C8.44484 17.5733 9.23434 17.113 10.8125 16.1924L13.2617 14.7637L13.2701 14.7588C14.8216 13.8537 15.5979 13.4009 15.8595 12.8105C16.0881 12.2946 16.0881 11.7062 15.8595 11.1902C15.5974 10.5988 14.8188 10.1446 13.2617 9.2363L10.8125 7.80762C9.23434 6.88702 8.44484 6.42651 7.79688 6.49256C7.23174 6.55017 6.71806 6.84556 6.38355 7.30469C6 7.83111 6 8.74424 6 10.5713Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    play: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none"><path d="M5 17.3336V6.66698C5 5.78742 5 5.34715 5.18509 5.08691C5.34664 4.85977 5.59564 4.71064 5.87207 4.67499C6.18868 4.63415 6.57701 4.84126 7.35254 5.25487L17.3525 10.5882L17.3562 10.5898C18.2132 11.0469 18.642 11.2756 18.7826 11.5803C18.9053 11.8462 18.9053 12.1531 18.7826 12.4189C18.6418 12.7241 18.212 12.9537 17.3525 13.4121L7.35254 18.7454C6.57645 19.1593 6.1888 19.3657 5.87207 19.3248C5.59564 19.2891 5.34664 19.1401 5.18509 18.9129C5 18.6527 5 18.2132 5 17.3336Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    pause: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none"><path d="M15 5.5V18.5C15 18.9647 15 19.197 15.0384 19.3902C15.1962 20.1836 15.816 20.8041 16.6094 20.9619C16.8026 21.0003 17.0349 21.0003 17.4996 21.0003C17.9642 21.0003 18.1974 21.0003 18.3906 20.9619C19.184 20.8041 19.8041 20.1836 19.9619 19.3902C20 19.1987 20 18.9687 20 18.5122V5.48777C20 5.03125 20 4.80087 19.9619 4.60938C19.8041 3.81599 19.1836 3.19624 18.3902 3.03843C18.197 3 17.9647 3 17.5 3C17.0353 3 16.8026 3 16.6094 3.03843C15.816 3.19624 15.1962 3.81599 15.0384 4.60938C15 4.80257 15 5.03534 15 5.5Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 5.5V18.5C4 18.9647 4 19.197 4.03843 19.3902C4.19624 20.1836 4.81599 20.8041 5.60938 20.9619C5.80257 21.0003 6.0349 21.0003 6.49956 21.0003C6.96421 21.0003 7.19743 21.0003 7.39062 20.9619C8.18401 20.8041 8.8041 20.1836 8.96191 19.3902C9 19.1987 9 18.9687 9 18.5122V5.48777C9 5.03125 9 4.80087 8.96191 4.60938C8.8041 3.81599 8.18356 3.19624 7.39018 3.03843C7.19698 3 6.96465 3 6.5 3C6.03535 3 5.80257 3 5.60938 3.03843C4.81599 3.19624 4.19624 3.81599 4.03843 4.60938C4 4.80257 4 5.03534 4 5.5Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    locate: '<svg viewBox="0 0 14 14" width="14" height="14" fill="none"><path d="M7 10.9375C9.17462 10.9375 10.9375 9.17462 10.9375 7C10.9375 4.82538 9.17462 3.0625 7 3.0625C4.82538 3.0625 3.0625 4.82538 3.0625 7C3.0625 9.17462 4.82538 10.9375 7 10.9375Z" stroke="currentColor" stroke-width="1.3125"/><path d="M7 8.3125C7.72487 8.3125 8.3125 7.72487 8.3125 7C8.3125 6.27513 7.72487 5.6875 7 5.6875C6.27513 5.6875 5.6875 6.27513 5.6875 7C5.6875 7.72487 6.27513 8.3125 7 8.3125Z" fill="currentColor"/><path d="M7 0.875V3.0625M7 10.9375V13.125M0.875 7H3.0625M10.9375 7H13.125" stroke="currentColor" stroke-width="1.3125" stroke-linecap="round"/></svg>',
  };
  // 재생 중 필기 농도: 아직 오지 않은 획은 이 불투명도로 연하게. 설계상 실기기 조정 값이다.
  const FUTURE_ALPHA = 0.22;
  const dateLabel = localDate => { const [, m, d] = localDate.split('-').map(Number); return `${m}월 ${d}일`; };
  const range = (a, b) => `${clock(a)}–${clock(b)}`;

  // v: 뷰어 상태. hooks: { goToPage(page), openDocumentAt(documentId, sessionId, t), redrawInk(), onToggle(open) }
  function attach(v, hooks) {
    const aside = el('aside', 'lecture-side');
    aside.hidden = true;
    let stream = [];
    let current = null;
    let lastInkT = null;

    const player = global.LecturePlayer.create({ onChange: render });

    // 재생 중에만 농도를 바꾼다. 현재 Session의 강의 획은 t_ms로, 그 밖의 획은 작성 시각으로 앞뒤를 가른다
    // (복습 activity 스키마는 아직 없다). 재생하지 않을 때는 누적 최종 필기를 모두 원래대로 보인다.
    v.inkAlpha = stroke => {
      if (!current?.playing || !current.session) return 1;
      if (stroke.source_session_id === current.session.id && stroke.t_ms != null) return stroke.t_ms <= current.t ? 1 : FUTURE_ALPHA;
      const cursorWall = current.session.startedAtMs + current.t;
      return (stroke.created_at || 0) <= cursorWall ? 1 : FUTURE_ALPHA;
    };
    // 복습 펜으로 쓰는 동안 무엇을 들으며 썼는지(원본 Session·위치)를 남긴다. 농도에는 쓰지 않는다.
    v.reviewAnchor = () => (current?.session ? { sessionId: current.session.id, t: Math.round(current.t) } : null);

    function sessionBounds(session) {
      const spans = session.items.filter(item => item.type === 'span');
      return { start: spans[0].start, end: spans[spans.length - 1].end };
    }

    function render(next) {
      const wasPlaying = current?.playing;
      current = next;
      if (aside.hidden) return;
      const session = next.session;
      aside.replaceChildren();
      const tabs = el('div', 'lecture-side-tabs');
      const lectureTab = el('button', 'active');
      lectureTab.type = 'button';
      lectureTab.append(document.createTextNode('강의'), el('span', '', String(stream.length)));
      const searchTab = el('button', '', '검색');
      searchTab.type = 'button';
      searchTab.disabled = true;
      searchTab.title = '참고 검색은 다음 단계에서 열려';
      tabs.append(lectureTab, searchTab);
      aside.append(tabs);
      if (!session) {
        aside.append(el('p', 'lecture-empty', '이 자료를 보면서 녹음한 강의가 아직 없어.'));
        return;
      }

      const index = stream.indexOf(session);
      const { start, end } = sessionBounds(session);
      const position = t => `${Math.max(0, Math.min(100, ((t - start) / Math.max(1, end - start)) * 100))}%`;
      const playerBox = el('div', 'lecture-side-player');
      playerBox.append(el('p', 'lecture-side-source', `${dateLabel(session.localDate)} · 강의 ${index + 1}`));
      const ticks = el('div', 'lecture-side-ticks');
      session.markers.forEach(marker => {
        const tick = el('button', `is-${marker.kind}`, marker.kind === 'important' ? '★' : '?');
        tick.type = 'button';
        tick.style.left = position(marker.t);
        tick.setAttribute('aria-label', `${marker.kind === 'important' ? '중요' : '나중에 볼 것'} ${clock(marker.t)}`);
        tick.addEventListener('click', () => player.seek(session.id, marker.t));
        ticks.append(tick);
      });
      const bar = el('div', 'lecture-side-bar');
      const fill = el('span', 'lecture-side-fill');
      fill.style.width = position(next.t);
      const knob = el('span', 'lecture-side-knob');
      knob.style.left = position(next.t);
      bar.append(fill, knob);
      bar.addEventListener('pointerdown', event => {
        const box = bar.getBoundingClientRect();
        const seekAt = x => player.seek(session.id, start + ((x - box.left) / box.width) * (end - start));
        seekAt(event.clientX);
        const move = e => seekAt(e.clientX);
        const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); };
        addEventListener('pointermove', move);
        addEventListener('pointerup', up);
      });
      const times = el('div', 'lecture-side-times');
      times.append(el('span', '', clock(next.t)), el('span', '', clock(end)));
      const controls = el('div', 'lecture-side-controls');
      const control = (name, label, action, disabled) => {
        const button = el('button', `lecture-side-${name}`);
        button.type = 'button';
        button.disabled = Boolean(disabled);
        button.setAttribute('aria-label', label);
        button.append(svg(ICONS[name === 'toggle' ? (next.playing ? 'pause' : 'play') : name]));
        button.addEventListener('click', action);
        return button;
      };
      controls.append(
        control('back', '이전 강의', () => player.seek(stream[index - 1].id, 0), index === 0),
        control('toggle', next.playing ? '일시정지' : '재생', () => player.toggle()),
        control('forward', '다음 강의', () => player.seek(stream[index + 1].id, 0), index === stream.length - 1),
      );
      const page = pageAt(session, next.t);
      const locate = el('button', 'lecture-side-locate');
      locate.type = 'button';
      locate.disabled = !page;
      locate.append(svg(ICONS.locate), document.createTextNode(page ? `재생 위치로 (p.${page})` : '재생 위치로'));
      locate.addEventListener('click', () => hooks.goToPage(page));
      playerBox.append(ticks, bar, times, controls, locate);
      if (next.error) playerBox.append(el('p', 'lecture-side-error', next.error));
      if (next.loading) playerBox.append(el('p', 'lecture-side-note', '녹음을 불러오는 중…'));
      aside.append(playerBox, el('hr', 'lecture-side-divider'));

      const list = el('div', 'lecture-side-list');
      session.items.forEach(item => {
        if (item.type === 'span') {
          const row = el('button', `lecture-side-row${next.t >= item.start && next.t < item.end ? ' is-current' : ''}`);
          row.type = 'button';
          row.append(el('span', 'lecture-side-time', clock(item.start)), el('span', '', `녹음 구간 ${range(item.start, item.end)}`));
          row.addEventListener('click', () => player.seek(session.id, item.start));
          list.append(row);
          session.markers.filter(marker => marker.t >= item.start && marker.t < item.end).forEach(marker => {
            const mark = el('button', 'lecture-side-row is-marker');
            mark.type = 'button';
            mark.append(el('span', 'lecture-side-time', clock(marker.t)), el('span', '', marker.kind === 'important' ? '★ 중요' : '? 나중에 볼 것'));
            mark.addEventListener('click', () => player.seek(session.id, marker.t));
            list.append(mark);
          });
          return;
        }
        // 경계. `다른 자료`는 누르면 그 자료 뷰어에서 같은 강의·시각으로 이어 듣는다(§12.2).
        const boundary = el(item.type === 'other' ? 'button' : 'div', 'lecture-side-boundary');
        if (item.type === 'other') {
          boundary.type = 'button';
          boundary.addEventListener('click', () => hooks.openDocumentAt(item.documentId, session.id, item.start));
        }
        boundary.append(el('span', `lecture-side-rule`), el('span', '', `${item.type === 'other' ? `다른 자료 · ${item.title}` : '녹음 없음'} · ${range(item.start, item.end)}`), el('span', 'lecture-side-rule'));
        list.append(boundary);
      });
      list.append(el('p', 'lecture-side-note', '전사는 전사용 PC가 준비되면 여기에 강의 문장으로 나와.'));
      aside.append(list);

      // 필기 농도는 재생 중 커서가 움직일 때와 재생을 멈출 때 다시 그린다.
      if (next.playing || wasPlaying) {
        if (lastInkT == null || Math.abs(next.t - lastInkT) > 400 || !next.playing) {
          lastInkT = next.t;
          hooks.redrawInk();
        }
      }
    }

    function pageAt(session, t) {
      const seen = session.pages.filter(item => item.t <= t);
      return seen.length ? seen[seen.length - 1].page : session.pages[0]?.page || null;
    }

    async function load() {
      try {
        ({ sessions: stream } = await api(`/api/lecture/documents/${v.documentId}/stream`));
      } catch (error) {
        toast(error.message);
        stream = [];
      }
      player.load(stream);
    }

    return {
      el: aside,
      load,
      isOpen: () => !aside.hidden,
      open() {
        aside.hidden = false;
        hooks.onToggle?.(true);
        render(player.state());
        player.preload();
      },
      close() {
        aside.hidden = true;
        hooks.onToggle?.(false);
      },
      // 강의 카드·`다른 자료`·필기 역점프가 부른다. 녹음이 있는 시각이면 사이드바를 열고 그 위치로 간다.
      jump(sessionId, t) {
        if (!player.seek(sessionId, t)) return false;
        if (aside.hidden) this.open();
        return true;
      },
      hasSession: sessionId => stream.some(session => session.id === sessionId),
      destroy() { player.destroy(); },
    };
  }

  global.LectureReview = { attach };
})(window);
