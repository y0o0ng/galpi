'use strict';

// 강의 노트 필기 입력: 획 그리기·형광펜·획 지우개·펜 길게 누르기 원형 메뉴(§6.8·§8.1·§8.2).
// 뷰어가 넘긴 v를 다루고, 바뀐 필기는 v.changed()로 뷰어의 저장에 알린다.
(function (global) {
  const { el, Recorder, toast, isRecordingHere } = global.LectureCommon;

  // 지우개 크기 1.0의 반경(페이지 폭 비율). 확대해도 화면에서 같은 크기로 닿게 배율로 나눈다.
  const ERASER_RADIUS = 0.012;
  // 원형 메뉴 호출: 누른 채 이 시간 동안 이 거리 안에 머물면 연다. 설계상 실기기에서 정하는 값이다(§6.8).
  const HOLD_MS = 450;
  const HOLD_TOLERANCE_PX = 6;

  // ─── 필기 ─────────────────────────────────────────────────────────────────

  const pageStrokes = (v, number) => (v.body.pages[number] ||= []);

  function drawStroke(ctx, stroke, scale) {
    const points = stroke.points;
    if (!points.length) return;
    ctx.globalAlpha = stroke.tool === 'highlighter' ? global.LecturePens.HIGHLIGHT_ALPHA : 1;
    ctx.strokeStyle = stroke.color;
    ctx.fillStyle = stroke.color;
    ctx.lineWidth = Math.max(stroke.width * scale, 1);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (points.length === 1) {
      ctx.beginPath();
      ctx.arc(points[0][0] * scale, points[0][1] * scale, ctx.lineWidth / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      return;
    }
    ctx.beginPath();
    ctx.moveTo(points[0][0] * scale, points[0][1] * scale);
    for (let index = 1; index < points.length; index += 1) ctx.lineTo(points[index][0] * scale, points[index][1] * scale);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  function drawInk(v, page) {
    if (!page.ink.width) return;
    const ctx = page.ink.getContext('2d');
    ctx.clearRect(0, 0, page.ink.width, page.ink.height);
    (v.body.pages[page.number] || []).forEach(stroke => drawStroke(ctx, stroke, page.ink.width));
  }

  // 좌표는 페이지 폭을 1로 둔 값이다. 회전·크기 변화에도 같은 자리에 다시 그려진다.
  function pagePoint(page, event) {
    const rect = page.ink.getBoundingClientRect();
    const round = value => Math.round(value * 10000) / 10000;
    return [round((event.clientX - rect.left) / rect.width), round((event.clientY - rect.top) / rect.width), Math.round((event.pressure || 0.5) * 100) / 100];
  }

  function bindInk(v, page) {
    const canDraw = event => event.pointerType === 'pen' || (event.pointerType === 'mouse' && event.button === 0);
    page.ink.addEventListener('pointerdown', event => {
      if (!canDraw(event) || v.conflict) return;
      event.preventDefault();
      page.ink.setPointerCapture(event.pointerId);
      v.pens.close();
      const pen = v.pens.current();
      // 마지막 방어선: 강의 펜은 초록을, 복습 펜은 초록이 아닌 색을 쓰지 않는다(§8.2).
      if (pen.tool !== 'eraser' && !v.pens.allows(pen.color)) return toast(v.pens.refusal());
      startHold(v, page, event);
      if (pen.tool === 'eraser') {
        v.erasing = { page, pointerId: event.pointerId, last: pagePoint(page, event), radius: ERASER_RADIUS * pen.width / v.zoom };
        eraseAt(v, page, v.erasing.last, v.erasing.radius);
        return;
      }
      // 형광펜은 따로 겹친 캔버스에 불투명하게 그리고 그 캔버스를 반투명으로 보인다. 조각마다 반투명으로
      // 그리면 이음새가 진해진다. 획이 끝나면 페이지 잉크에 한 경로로 다시 그린다.
      const target = pen.tool === 'highlighter' ? liveCanvas(page) : page.ink;
      v.stroke = {
        page,
        pointerId: event.pointerId,
        data: {
          id: `s_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
          tool: pen.tool,
          color: pen.color,
          width: Math.round(pen.width * global.LecturePens.WIDTH_UNIT * 100000) / 100000,
          points: [pagePoint(page, event)],
          // `강의`면 오늘 Session의 시각을 갖는다. 녹음이 멈춘 동안의 획도 Session 시각은 갖되 오디오 위치는
          // recording_span 밖이라 없다. `복습`은 review_pen이고 Session을 갖지 않는다(§8.2). 재생 위치 앵커는 L2다.
          source_session_id: v.mode === 'lecture' ? v.session?.id ?? null : null,
          t_ms: v.mode === 'lecture' && v.session ? Recorder().sessionT(v.session, event.timeStamp) : null,
          created_at: Date.now(),
        },
      };
      v.stroke.target = target;
      drawStroke(target.getContext('2d'), { ...v.stroke.data, tool: 'pen' }, target.width);
    });
    page.ink.addEventListener('pointermove', event => {
      if (v.hold?.pointerId === event.pointerId) {
        if (v.radial) return v.radial.move(event.clientX, event.clientY);
        // 획을 긋기 시작하면 도중에 멈춰도 메뉴를 열지 않는다.
        if (Math.hypot(event.clientX - v.hold.x, event.clientY - v.hold.y) > HOLD_TOLERANCE_PX) cancelHold(v);
      }
      if (v.erasing?.pointerId === event.pointerId) {
        // 이벤트 사이도 훑는다. 빠르게 문지르면 두 이벤트 사이에 있는 획을 건너뛴다.
        (event.getCoalescedEvents?.() || [event]).forEach(item => {
          const to = pagePoint(page, item);
          const from = v.erasing.last;
          const steps = Math.max(1, Math.ceil(Math.hypot(to[0] - from[0], to[1] - from[1]) / (v.erasing.radius / 2)));
          for (let step = 1; step <= steps; step += 1) {
            eraseAt(v, page, [from[0] + (to[0] - from[0]) * step / steps, from[1] + (to[1] - from[1]) * step / steps], v.erasing.radius);
          }
          v.erasing.last = to;
        });
        return;
      }
      const active = v.stroke;
      if (!active || active.pointerId !== event.pointerId) return;
      const ctx = active.target.getContext('2d');
      const scale = active.target.width;
      ctx.strokeStyle = active.data.color;
      ctx.lineWidth = Math.max(active.data.width * scale, 1);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      let last = active.data.points[active.data.points.length - 1];
      ctx.moveTo(last[0] * scale, last[1] * scale);
      (event.getCoalescedEvents?.() || [event]).forEach(item => {
        last = pagePoint(page, item);
        active.data.points.push(last);
        ctx.lineTo(last[0] * scale, last[1] * scale);
      });
      ctx.stroke();
    });
    // pointercancel도 끝으로 본다. 실측에서 필기 도중 cancel이 났고, 그린 만큼은 남기는 편이 낫다.
    const end = event => {
      if (v.hold?.pointerId === event.pointerId) {
        const radial = v.radial;
        cancelHold(v);
        // 떼는 순간 고른 항목을 실행한다. 입력이 중단되면(pointercancel) 아무것도 실행하지 않는다.
        if (radial) {
          const choice = event.type === 'pointerup' ? radial.release() : (radial.cancel(), null);
          if (choice) runRadial(v, choice);
          return;
        }
      }
      if (v.erasing?.pointerId === event.pointerId) {
        v.erasing = null;
        return;
      }
      const active = v.stroke;
      if (!active || active.pointerId !== event.pointerId) return;
      v.stroke = null;
      pageStrokes(v, page.number).push(active.data);
      if (active.target !== page.ink) {
        active.target.remove();
        drawInk(v, page);
      }
      v.changed();
    };
    page.ink.addEventListener('pointerup', end);
    page.ink.addEventListener('pointercancel', end);
  }

  function liveCanvas(page) {
    const canvas = el('canvas', 'lecture-page-live');
    canvas.width = page.ink.width;
    canvas.height = page.ink.height;
    canvas.style.opacity = String(global.LecturePens.HIGHLIGHT_ALPHA);
    page.el.append(canvas);
    return canvas;
  }

  // ─── 원형 메뉴(§6.8) ─────────────────────────────────────────────────────

  function startHold(v, page, event) {
    cancelHold(v);
    v.hold = { page, pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    v.hold.timer = setTimeout(() => openRadial(v), HOLD_MS);
  }

  function cancelHold(v) {
    if (!v.hold) return;
    clearTimeout(v.hold.timer);
    v.hold = null;
    v.radial = null;
  }

  function openRadial(v) {
    const hold = v.hold;
    if (!hold) return;
    // 메뉴를 부른 점은 필기로 남기지 않는다. 그 전에 끝난 획은 그대로다.
    if (v.stroke?.pointerId === hold.pointerId) {
      if (v.stroke.target !== hold.page.ink) v.stroke.target.remove();
      v.stroke = null;
      drawInk(v, hold.page);
    }
    if (v.erasing?.pointerId === hold.pointerId) v.erasing = null;
    const recording = isRecordingHere(v);
    v.radial = global.LectureRadial.open({
      x: hold.x,
      y: hold.y,
      // 선택(올가미)·포스트잇은 아직 없다. 마커는 녹음 중에만 쓸 수 있다(§6.4).
      enabled: { pen: true, eraser: true, select: false, sticky: false, important: recording && Boolean(v.markers), later: recording && Boolean(v.markers) },
    });
  }

  function runRadial(v, choice) {
    if (choice === 'pen' || choice === 'eraser') v.pens.choose(choice === 'eraser' ? 'eraser' : 'draw');
    else if (choice === 'important' || choice === 'later') v.markers?.add(choice);
  }

  function segmentDistance(point, a, b) {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const length = dx * dx + dy * dy;
    const t = length ? Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / length)) : 0;
    return Math.hypot(point[0] - (a[0] + t * dx), point[1] - (a[1] + t * dy));
  }

  // 획 지우개다. 닿은 획을 통째로 지운다.
  // 획의 두께도 닿는 범위다. 굵은 형광펜은 가장자리를 문질러도 지워진다.
  function eraseAt(v, page, point, radius) {
    const strokes = v.body.pages[page.number];
    if (!strokes?.length) return;
    const kept = strokes.filter(stroke => !stroke.points.some((current, index) => {
      const previous = stroke.points[index - 1] || current;
      return segmentDistance(point, previous, current) <= radius + stroke.width / 2;
    }));
    if (kept.length === strokes.length) return;
    v.body.pages[page.number] = kept;
    drawInk(v, page);
    v.changed();
  }

  global.LectureInk = { bindInk, drawInk };
})(window);
