'use strict';

// 강의 노트 포스트잇 공간(설계 §6.6, L3a). 포스트잇은 자료 필기(annotation body.stickies)가 가진다 — 필기와 같이
// 저장·충돌 처리된다. 안에는 Pencil로 쓰는 자유 메모만 있고 입력칸은 없다. 시온 Q&A 전송은 L3b다.
// 화면 정본은 Figma `04 — Sticky Q&A`(S1–S3)와 `Sticky Anchor`(175:75)다.
(function (global) {
  const { el, svg, Recorder } = global.LectureCommon;

  // Figma 카드 248px ≈ iPad에서 한 변 4.7cm. 3.5cm ~ 8cm 사이에서 정방형으로 키운다(실기기 튜닝 값).
  const CARD_SIZE = 248;
  const CARD_MIN = 184;
  const CARD_MAX = 416;
  // Figma S1: 카드 왼쪽 위는 말풍선 상자 왼쪽 위에서 30px 떨어져 있다.
  const CARD_OFFSET = 30;
  const ANCHOR = 44;
  const EDGE = 8;
  // 화면에서 이보다 가까운 말풍선은 한 묶음으로 보인다. 데이터는 합치지 않는다(실기기 튜닝 값).
  const CLUSTER_PX = 36;
  // 메모 좌표는 메모 폭 = 1이다. 굵기 1.0이 카드 안에서 약 1.8px이 되게 한다.
  const MEMO_WIDTH_UNIT = 0.008;
  // 지우개 크기 1.0의 반경(메모 폭 비율). 페이지 지우개처럼 카드 안에서 약 10px이다.
  const MEMO_ERASER = 0.045;
  // 메모 아래로 이만큼(메모 폭 비율) 빈 자리를 늘 남겨 이어 쓸 수 있게 한다.
  const MEMO_ROOM = 0.35;

  const BUBBLE = (dx = 0, dy = 0) => `<path d="M${14 + dx} ${13 + dy}H${30 + dx}C${30.7956 + dx} ${13 + dy} ${31.5587 + dx} ${13.3161 + dy} ${32.1213 + dx} ${13.8787 + dy}C${32.6839 + dx} ${14.4413 + dy} ${33 + dx} ${15.2044 + dy} ${33 + dx} ${16 + dy}V${25 + dy}C${33 + dx} ${25.7956 + dy} ${32.6839 + dx} ${26.5587 + dy} ${32.1213 + dx} ${27.1213 + dy}C${31.5587 + dx} ${27.6839 + dy} ${30.7956 + dx} ${28 + dy} ${30 + dx} ${28 + dy}H${21 + dx}L${16 + dx} ${32 + dy}V${28 + dy}H${14 + dx}C${13.2044 + dx} ${28 + dy} ${12.4413 + dx} ${27.6839 + dy} ${11.8787 + dx} ${27.1213 + dy}C${11.3161 + dx} ${26.5587 + dy} ${11 + dx} ${25.7956 + dy} ${11 + dx} ${25 + dy}V${16 + dy}C${11 + dx} ${15.2044 + dy} ${11.3161 + dx} ${14.4413 + dy} ${11.8787 + dx} ${13.8787 + dy}C${12.4413 + dx} ${13.3161 + dy} ${13.2044 + dx} ${13 + dy} ${14 + dx} ${13 + dy}Z" fill="#FBEAF0" stroke="#D9A3B5" stroke-width="1.4" stroke-linejoin="round"/><path d="M${17 + dx} ${19 + dy}H${27 + dx}M${17 + dx} ${22.5 + dy}H${23 + dx}" stroke="#C0708A" stroke-width="1.4" stroke-linecap="round"/>`;
  // Figma `Sticky Anchor` State=Default·Cluster. 묶음 숫자는 개수가 바뀌므로 글리프 경로 대신 글자로 쓴다.
  const anchorSvg = count => (count > 1
    ? `<svg viewBox="0 0 46 44" width="46" height="44" fill="none"><g opacity="0.7">${BUBBLE(4, -3)}</g>${BUBBLE()}<rect x="29.25" y="4.25" width="15.5" height="15.5" rx="7.75" fill="#2F6B57" stroke="#fff" stroke-width="1.5"/><text x="37" y="15.2" text-anchor="middle" fill="#fff" font-size="9" font-weight="600">${count > 9 ? '9+' : count}</text></svg>`
    : `<svg viewBox="0 0 44 44" width="44" height="44" fill="none">${BUBBLE()}</svg>`);
  const COLLAPSE_SVG = '<svg viewBox="0 0 14 14" width="14" height="14" fill="none"><path d="M3 7H11" stroke="#C0708A" stroke-width="1.6" stroke-linecap="round"/></svg>';
  const RESIZE_SVG = '<svg viewBox="0 0 12 12" width="12" height="12" fill="none"><path d="M11 5L5 11M11 9L9 11" stroke="#D9A3B5" stroke-width="1.4" stroke-linecap="round"/></svg>';

  function attach(v) {
    const cards = []; // { el, ids, activeId, page, fx, fy } — 열린 카드. 위치는 저장하지 않는다.
    let front = 10;

    const stickies = () => v.body.stickies || [];
    const byId = id => stickies().find(sticky => sticky.id === id);
    const pageOf = number => v.pages[number - 1];
    const isEmpty = sticky => !sticky.memo.length && !sticky.selection;

    function create(page, point, selection = null) {
      const sticky = {
        id: `k_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
        page: page.number,
        x: point[0],
        y: point[1],
        size: CARD_SIZE,
        memo: [],
        created_at: Date.now(),
        // 소속은 필기와 같이 `강의·복습` 토글이 정한다(§8.2).
        mode: v.mode || null,
        source_session_id: v.mode === 'lecture' ? v.session?.id ?? null : null,
        t_ms: v.mode === 'lecture' && v.session ? Recorder().sessionT(v.session, performance.now()) : null,
        ...(selection ? { selection } : {}),
      };
      (v.body.stickies ||= []).push(sticky);
      v.changed();
      renderAnchors(page);
      openCard(page, [sticky.id], sticky.id);
    }

    // 레일 포스트잇 버튼: 지금 보이는 페이지 영역의 가운데에 만든다.
    function createAtView(number) {
      const page = pageOf(number);
      if (!page) return;
      const box = page.el.getBoundingClientRect();
      const view = v.scroller.getBoundingClientRect();
      // 카드가 화면 가운데에 오도록 말풍선을 카드 왼쪽 위에 둔다.
      const shift = CARD_SIZE / 2 + CARD_OFFSET - ANCHOR / 2;
      const x = (Math.max(box.left, view.left) + Math.min(box.right, view.right)) / 2 - shift;
      const y = (Math.max(box.top, view.top) + Math.min(box.bottom, view.bottom)) / 2 - shift;
      create(page, global.LectureInk.pagePoint(page, { clientX: Math.max(x, box.left + ANCHOR / 2), clientY: Math.max(y, box.top + ANCHOR / 2) }).slice(0, 2));
    }

    function remove(ids) {
      if (!ids.length) return;
      v.body.stickies = stickies().filter(sticky => !ids.includes(sticky.id));
      v.changed();
    }

    // ─── 말풍선·묶음 ───────────────────────────────────────────────────────

    // 생성 순으로 훑어 화면상 가까운 말풍선을 묶는다. 확대가 바뀌면 다시 묶인다.
    function clusters(page) {
      const width = page.el.offsetWidth;
      const groups = [];
      stickies().filter(sticky => sticky.page === page.number).sort((a, b) => a.created_at - b.created_at).forEach(sticky => {
        const group = groups.find(item => Math.hypot((item.x - sticky.x) * width, (item.y - sticky.y) * width) < CLUSTER_PX);
        if (group) group.ids.push(sticky.id);
        else groups.push({ x: sticky.x, y: sticky.y, ids: [sticky.id] });
      });
      return groups;
    }

    function renderAnchors(page) {
      page.el.querySelectorAll('.lecture-sticky-anchor').forEach(node => node.remove());
      clusters(page).forEach(group => {
        const anchor = el('button', 'lecture-sticky-anchor');
        anchor.type = 'button';
        anchor.setAttribute('aria-label', group.ids.length > 1 ? `포스트잇 ${group.ids.length}개` : '포스트잇');
        anchor.style.left = `${group.x * 100}%`;
        anchor.style.top = `${(group.y / page.aspect) * 100}%`;
        anchor.append(svg(anchorSvg(group.ids.length)));
        anchor.addEventListener('pointerdown', event => event.stopPropagation());
        anchor.addEventListener('click', () => {
          const open = cards.find(card => card.ids.some(id => group.ids.includes(id)));
          if (open) return raise(open);
          openCard(page, group.ids, group.ids[0]);
        });
        page.el.append(anchor);
      });
    }

    // ─── 열린 카드 ──────────────────────────────────────────────────────────

    const raise = card => { card.el.style.zIndex = String(++front); };

    function openCard(page, ids, activeId) {
      const sticky = byId(activeId);
      const width = page.el.offsetWidth;
      // 처음 위치는 말풍선 기준이고, 화면 가장자리에 닿으면 안쪽으로 옮겨 보인다. 말풍선은 움직이지 않는다.
      const box = page.el.getBoundingClientRect();
      const view = v.scroller.getBoundingClientRect();
      let left = box.left + sticky.x * width - ANCHOR / 2 + CARD_OFFSET;
      let top = box.top + sticky.y * width - ANCHOR / 2 + CARD_OFFSET;
      left = Math.max(view.left + EDGE, Math.min(left, view.right - sticky.size - EDGE));
      top = Math.max(view.top + EDGE, Math.min(top, view.bottom - sticky.size - EDGE));
      const card = { el: el('div', 'lecture-sticky-card'), ids, activeId, page, fx: (left - box.left) / width, fy: (top - box.top) / width };
      cards.push(card);
      page.el.append(card.el);
      card.el.addEventListener('pointerdown', () => raise(card));
      raise(card);
      renderCard(card);
    }

    function closeCard(card) {
      cards.splice(cards.indexOf(card), 1);
      card.el.remove();
      // 아무것도 쓰지 않고 접은 포스트잇은 남기지 않는다.
      const empty = card.ids.filter(id => byId(id) && isEmpty(byId(id)));
      if (empty.length) {
        remove(empty);
        renderAnchors(card.page);
      }
    }

    function place(card) {
      const width = card.page.el.offsetWidth;
      const size = byId(card.activeId).size;
      card.el.style.left = `${card.fx * width}px`;
      card.el.style.top = `${card.fy * width}px`;
      card.el.style.width = `${size}px`;
      card.el.style.height = `${size}px`;
    }

    function renderCard(card) {
      const sticky = byId(card.activeId);
      place(card);
      const header = el('div', 'lecture-sticky-head');
      if (card.ids.length > 1) {
        // 숫자는 묶음 안의 생성 순서일 뿐 저장되는 번호가 아니다.
        const tabs = el('div', 'lecture-sticky-tabs');
        card.ids.forEach((id, index) => {
          const tab = el('button', id === card.activeId ? 'active' : '', String(index + 1));
          tab.type = 'button';
          tab.addEventListener('click', () => { card.activeId = id; renderCard(card); });
          tabs.append(tab);
        });
        header.append(tabs);
      }
      const collapse = el('button', 'lecture-sticky-collapse');
      collapse.type = 'button';
      collapse.setAttribute('aria-label', '접기');
      collapse.append(svg(COLLAPSE_SVG));
      collapse.addEventListener('click', () => closeCard(card));
      header.append(collapse);
      bindDrag(card, header);

      const body = el('div', 'lecture-sticky-body');
      if (sticky.selection) body.append(selectionPreview(card.page, sticky.selection));
      const memo = el('canvas', 'lecture-sticky-memo');
      body.append(memo);

      const footer = el('div', 'lecture-sticky-foot');
      const trash = el('button', 'lecture-sticky-delete', '삭제');
      trash.type = 'button';
      trash.addEventListener('click', () => {
        if (!confirm('이 포스트잇을 지울까?')) return;
        const id = card.activeId;
        card.ids = card.ids.filter(item => item !== id);
        remove([id]);
        renderAnchors(card.page);
        if (!card.ids.length) closeCard(card);
        else { card.activeId = card.ids[0]; renderCard(card); }
      });
      const resize = el('button', 'lecture-sticky-resize');
      resize.type = 'button';
      resize.setAttribute('aria-label', '크기 조절');
      resize.append(svg(RESIZE_SVG));
      bindResize(card, resize, memo);
      footer.append(trash, resize);

      card.el.replaceChildren(header, body, footer);
      bindMemo(card, memo);
      requestAnimationFrame(() => drawMemo(sticky, memo));
    }

    // 열린 동안만 옮긴다. 접었다 열면 말풍선 기준 자리로 돌아간다(§6.6).
    function bindDrag(card, handle) {
      handle.addEventListener('pointerdown', event => {
        if (event.target.closest('button')) return;
        event.stopPropagation();
        handle.setPointerCapture(event.pointerId);
        const width = card.page.el.offsetWidth;
        const start = { x: event.clientX, y: event.clientY, fx: card.fx, fy: card.fy };
        const move = next => {
          card.fx = start.fx + (next.clientX - start.x) / width;
          card.fy = start.fy + (next.clientY - start.y) / width;
          place(card);
        };
        const end = () => { handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', end); handle.removeEventListener('pointercancel', end); };
        handle.addEventListener('pointermove', move);
        handle.addEventListener('pointerup', end);
        handle.addEventListener('pointercancel', end);
      });
    }

    // 정방형을 유지한 채 키우고 줄인다. 크기는 포스트잇에 저장한다.
    function bindResize(card, handle, memo) {
      handle.addEventListener('pointerdown', event => {
        event.stopPropagation();
        handle.setPointerCapture(event.pointerId);
        const sticky = byId(card.activeId);
        const start = { x: event.clientX, y: event.clientY, size: sticky.size };
        const move = next => {
          sticky.size = Math.round(Math.max(CARD_MIN, Math.min(CARD_MAX, start.size + Math.max(next.clientX - start.x, next.clientY - start.y))));
          place(card);
          drawMemo(sticky, memo);
        };
        const end = () => {
          handle.removeEventListener('pointermove', move);
          handle.removeEventListener('pointerup', end);
          handle.removeEventListener('pointercancel', end);
          if (sticky.size !== start.size) v.changed();
        };
        handle.addEventListener('pointermove', move);
        handle.addEventListener('pointerup', end);
        handle.addEventListener('pointercancel', end);
      });
    }

    // 선택 영역을 지금 그려진 페이지 캔버스에서 잘라 보여준다. 표시용이다 — 시온에게 보낼 이미지는 L3b에서
    // 원본 PDF·필기로 다시 만든다(§6.6). 페이지가 아직 안 그려졌으면 비워 둔다.
    function selectionPreview(page, selection) {
      const canvas = el('canvas', 'lecture-sticky-selection');
      if (!page.base.width && !page.ink.width) return canvas;
      const scale = (page.ink.width || page.base.width);
      const [x0, y0, x1, y1] = selection.bbox.map(value => value * scale);
      canvas.width = Math.max(1, Math.round(x1 - x0));
      canvas.height = Math.max(1, Math.round(y1 - y0));
      const ctx = canvas.getContext('2d');
      ctx.beginPath();
      selection.path.forEach(([x, y], index) => ctx[index ? 'lineTo' : 'moveTo'](x * scale - x0, y * scale - y0));
      ctx.closePath();
      ctx.clip();
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      [page.base, page.ink].forEach(source => {
        if (source.width) ctx.drawImage(source, x0 * source.width / scale, y0 * source.width / scale, canvas.width * source.width / scale, canvas.height * source.width / scale, 0, 0, canvas.width, canvas.height);
      });
      return canvas;
    }

    // ─── 메모(손글씨) ───────────────────────────────────────────────────────

    function drawMemo(sticky, canvas) {
      const body = canvas.parentElement;
      const width = body?.clientWidth;
      if (!width) return;
      // 카드 안을 채우고, 쓴 글씨 아래로 빈 자리를 남긴다. 넘치면 카드 안에서 스크롤한다.
      const bottom = Math.max(0, ...sticky.memo.flatMap(stroke => stroke.points.map(point => point[1])));
      const height = Math.max(body.clientHeight - canvas.offsetTop, (bottom + MEMO_ROOM) * width);
      const dpr = Math.min(global.devicePixelRatio || 1, 2);
      canvas.style.height = `${Math.round(height)}px`;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      const ctx = canvas.getContext('2d');
      sticky.memo.forEach(stroke => global.LectureInk.drawStroke(ctx, stroke, canvas.width));
    }

    function bindMemo(card, canvas) {
      const { drawStroke } = global.LectureInk;
      const point = event => {
        const rect = canvas.getBoundingClientRect();
        const round = value => Math.round(value * 10000) / 10000;
        return [round((event.clientX - rect.left) / rect.width), round((event.clientY - rect.top) / rect.width), Math.round((event.pressure || 0.5) * 100) / 100];
      };
      let active = null;
      canvas.addEventListener('pointerdown', event => {
        if (!(event.pointerType === 'pen' || (event.pointerType === 'mouse' && event.button === 0)) || v.conflict) return;
        event.preventDefault();
        event.stopPropagation();
        canvas.setPointerCapture(event.pointerId);
        const sticky = byId(card.activeId);
        const pen = v.pens.current();
        if (pen.tool === 'eraser') {
          active = { pointerId: event.pointerId, sticky, erasing: true, last: point(event), radius: MEMO_ERASER * pen.width };
          eraseMemo(sticky, canvas, active.last, active.radius);
          return;
        }
        if (!v.pens.allows(pen.color)) return global.LectureCommon.toast(v.pens.refusal());
        active = {
          pointerId: event.pointerId,
          sticky,
          stroke: { id: `s_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, tool: pen.tool, color: pen.color, width: Math.round(pen.width * MEMO_WIDTH_UNIT * 100000) / 100000, points: [point(event)], created_at: Date.now() },
        };
        drawStroke(canvas.getContext('2d'), active.stroke, canvas.width);
      });
      canvas.addEventListener('pointermove', event => {
        if (active?.pointerId !== event.pointerId) return;
        const from = active.erasing ? 0 : active.stroke.points.length - 1;
        (event.getCoalescedEvents?.() || [event]).forEach(item => {
          if (!active.erasing) return active.stroke.points.push(point(item));
          // 이벤트 사이도 훑는다. 빠르게 문지르면 두 이벤트 사이의 획을 건너뛴다.
          const to = point(item);
          const from = active.last;
          const steps = Math.max(1, Math.ceil(Math.hypot(to[0] - from[0], to[1] - from[1]) / (active.radius / 2)));
          for (let step = 1; step <= steps; step += 1) {
            eraseMemo(active.sticky, canvas, [from[0] + (to[0] - from[0]) * step / steps, from[1] + (to[1] - from[1]) * step / steps], active.radius);
          }
          active.last = to;
        });
        if (!active.erasing) drawStroke(canvas.getContext('2d'), { ...active.stroke, points: active.stroke.points.slice(from) }, canvas.width);
      });
      const end = event => {
        if (active?.pointerId !== event.pointerId) return;
        const done = active;
        active = null;
        if (done.erasing) return;
        done.sticky.memo.push(done.stroke);
        drawMemo(done.sticky, canvas);
        v.changed();
      };
      canvas.addEventListener('pointerup', end);
      canvas.addEventListener('pointercancel', end);
    }

    function eraseMemo(sticky, canvas, at, radius) {
      const { segmentDistance } = global.LectureInk;
      const kept = sticky.memo.filter(stroke => !stroke.points.some((current, index) => segmentDistance(at, stroke.points[index - 1] || current, current) <= radius + stroke.width / 2));
      if (kept.length === sticky.memo.length) return;
      sticky.memo = kept;
      drawMemo(sticky, canvas);
      v.changed();
    }

    // 필기 본문이 통째로 바뀌었거나(충돌 해결) 페이지를 다시 만들었을 때. 사라진 포스트잇의 카드는 닫는다.
    function render() {
      v.pages.forEach(renderAnchors);
      [...cards].forEach(card => {
        card.ids = card.ids.filter(byId);
        const page = pageOf(card.page.number);
        if (!card.ids.length || !page) { cards.splice(cards.indexOf(card), 1); card.el.remove(); return; }
        if (!card.ids.includes(card.activeId)) card.activeId = card.ids[0];
        card.page = page;
        page.el.append(card.el);
        renderCard(card);
      });
    }

    // 확대가 바뀌면 묶음과 카드 자리를 다시 잡는다. 카드 크기는 확대와 상관없다.
    function layout() {
      v.pages.forEach(renderAnchors);
      cards.forEach(place);
    }

    return { create, createAtView, render, layout };
  }

  global.LectureSticky = { attach };
})(window);
