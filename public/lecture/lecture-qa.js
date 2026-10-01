'use strict';

// 강의 노트 포스트잇 시온 Q&A 클라이언트(설계 §6.6, L3b). 포스트잇에서 `전송`한 손글씨 덩어리를 근거 이미지와
// 함께 서버에 보내고, 서버가 채팅 모델로 답한 turn을 받아 둔다. 근거 이미지는 화면 캡처가 아니라 원본 PDF·필기
// 벡터에서 고정 해상도로 새로 그린다 — 확대율·메뉴·선택 테두리·재생 농도가 섞이지 않는다.
// 보내기 직전 요청 ID를 포스트잇(필기)에 적어 둔다. 응답을 잃거나 앱이 꺼져도 같은 ID로 결과부터 확인하고,
// 자동으로 다시 보내지 않는다.
(function (global) {
  const { api, jsonOptions, toast } = global.LectureCommon;

  // 질문 손글씨: 메모 좌표 1 = 600px. 선택 영역: 자료 쪽 폭 1600px. 자료 쪽 전체: 폭 1200px.
  const QUESTION_PX = 600;
  const SELECTION_PAGE_PX = 1600;
  const PAGE_PX = 1200;
  const POLL_MS = 4000;

  const requestId = () => `qa_${Date.now().toString(36)}${crypto.getRandomValues(new Uint32Array(2)).join('')}`;

  function canvasOf(width, height) {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width));
    canvas.height = Math.max(1, Math.round(height));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    return { canvas, ctx };
  }

  function questionImage(strokes) {
    const points = strokes.flatMap(stroke => stroke.points);
    const pad = 0.04;
    const x0 = Math.max(0, Math.min(...points.map(point => point[0])) - pad);
    const y0 = Math.max(0, Math.min(...points.map(point => point[1])) - pad);
    const x1 = Math.max(...points.map(point => point[0])) + pad;
    const y1 = Math.max(...points.map(point => point[1])) + pad;
    const { canvas, ctx } = canvasOf((x1 - x0) * QUESTION_PX, (y1 - y0) * QUESTION_PX);
    ctx.translate(-x0 * QUESTION_PX, -y0 * QUESTION_PX);
    strokes.forEach(stroke => global.LectureInk.drawStroke(ctx, stroke, QUESTION_PX));
    return canvas.toDataURL('image/png');
  }

  async function renderPdfPage(v, number, width) {
    const pdfPage = await v.pdf.getPage(number);
    const viewport = pdfPage.getViewport({ scale: width / pdfPage.getViewport({ scale: 1 }).width });
    const { canvas, ctx } = canvasOf(viewport.width, viewport.height);
    await pdfPage.render({ canvasContext: ctx, viewport }).promise;
    return canvas;
  }

  // 선택 영역: 원본 PDF 위에 선택과 겹치는 필기를 얹고 올가미 모양으로 잘라낸다. 백지면 필기만이다.
  // 자료 쪽 전체 이미지는 PDF만이다 — 선택 밖 손글씨는 붙이지 않는다(§6.6).
  async function selectionImages(v, sticky) {
    const { selection } = sticky;
    const page = v.pages[selection.page - 1];
    const base = v.pdf ? await renderPdfPage(v, selection.page, SELECTION_PAGE_PX) : null;
    const scale = SELECTION_PAGE_PX;
    const [x0, y0, x1, y1] = selection.bbox.map(value => value * scale);
    const { canvas, ctx } = canvasOf(x1 - x0, y1 - y0);
    ctx.beginPath();
    selection.path.forEach(([x, y], index) => ctx[index ? 'lineTo' : 'moveTo'](x * scale - x0, y * scale - y0));
    ctx.closePath();
    ctx.clip();
    if (base) ctx.drawImage(base, x0, y0, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);
    ctx.translate(-x0, -y0);
    (v.body.pages[selection.page] || [])
      .filter(stroke => !(stroke.source_session_id != null && v.hiddenSessionIds?.has(stroke.source_session_id)))
      .forEach(stroke => global.LectureInk.drawStroke(ctx, stroke, scale));
    // 텍스트 상자도 페이지 내용이다. 선택과 겹치면 함께 들어간다.
    global.LectureText.drawTexts(ctx, (v.body.texts || []).filter(item => item.page === selection.page && item.text.trim()), scale);
    const images = { selection: canvas.toDataURL('image/png') };
    if (v.pdf && page) images.page = (await renderPdfPage(v, selection.page, PAGE_PX)).toDataURL('image/jpeg', 0.85);
    return images;
  }

  // onChange(): turn이 바뀌면 포스트잇 화면을 다시 그린다.
  function create(v, { onChange }) {
    let turns = [];
    let timer = null;
    // 지금 이 화면에서 보내는 중인 요청 ID. 필기에 저장하지 않는다 — 앱을 다시 열면 `전송 안 됨`으로 보인다.
    const sending = new Set();

    const forSticky = id => turns.filter(turn => turn.stickyId === id);
    function upsert(turn) {
      if (!turn) return;
      const index = turns.findIndex(item => item.id === turn.id);
      if (index >= 0) turns[index] = turn;
      else turns.push(turn);
    }

    function poll() {
      clearTimeout(timer);
      if (turns.some(turn => turn.status === 'pending')) timer = setTimeout(load, POLL_MS);
    }

    async function load() {
      try {
        turns = (await api(`/api/lecture/qa?documentId=${v.documentId}`)).turns;
      } catch { /* 다음에 다시 */ }
      // 보낸 기록이 서버에 있으면 기기에 남긴 요청 ID를 지운다. 없으면 `전송 안 됨`으로 남는다.
      let changed = false;
      (v.body.stickies || []).forEach(sticky => {
        if (sticky.pendingSend && turns.some(turn => turn.clientRequestId === sticky.pendingSend.clientRequestId)) {
          delete sticky.pendingSend;
          changed = true;
        }
      });
      if (changed) v.changed();
      onChange();
      poll();
    }

    async function post(sticky) {
      const pending = sticky.pendingSend;
      const strokes = sticky.memo.filter(stroke => pending.strokeIds.includes(stroke.id));
      if (!strokes.length && !pending.typedText) {
        delete sticky.pendingSend;
        v.changed();
        return onChange();
      }
      sending.add(pending.clientRequestId);
      onChange();
      try {
        const images = { ...(strokes.length ? { question: questionImage(strokes) } : {}), ...(sticky.selection ? await selectionImages(v, sticky) : {}) };
        const { turn } = await api('/api/lecture/qa/turns', jsonOptions('POST', {
          clientRequestId: pending.clientRequestId, documentId: v.documentId, stickyId: sticky.id,
          strokeIds: pending.strokeIds, typedText: pending.typedText, inkBottom: pending.inkBottom, images,
        }));
        upsert(turn);
        delete sticky.pendingSend;
        v.changed();
      } catch (error) {
        // 서버가 거절한 요청(형식·지운 포스트잇·앞 질문 대기)은 남겨 두지 않는다. 연결 실패만 `전송 안 됨`이다.
        if (error.status) {
          toast(error.message);
          delete sticky.pendingSend;
          v.changed();
        }
      }
      sending.delete(pending.clientRequestId);
      onChange();
      poll();
    }

    return {
      load,
      forSticky,
      isSending: sticky => Boolean(sticky.pendingSend && sending.has(sticky.pendingSend.clientRequestId)),
      // 아직 보내지 않은 획: 어느 turn에도, 보내는 중인 요청에도 속하지 않은 메모 획.
      unsent(sticky) {
        const sent = new Set([...forSticky(sticky.id).flatMap(turn => turn.strokeIds), ...(sticky.pendingSend?.strokeIds || [])]);
        return sticky.memo.filter(stroke => !sent.has(stroke.id));
      },
      busy: sticky => Boolean(sticky.pendingSend) || forSticky(sticky.id).some(turn => turn.status === 'pending'),
      send(sticky) {
        const strokes = this.unsent(sticky);
        if (!strokes.length || this.busy(sticky)) return;
        sticky.pendingSend = {
          clientRequestId: requestId(),
          strokeIds: strokes.map(stroke => stroke.id),
          inkBottom: Math.max(...strokes.flatMap(stroke => stroke.points.map(point => point[1]))),
        };
        v.changed();
        post(sticky);
      },
      // 타이핑한 질문. 답 자리는 지금까지 쓴 글씨·답 아래다.
      sendTyped(sticky, text) {
        if (!text.trim() || this.busy(sticky)) return;
        const bottoms = [...sticky.memo.flatMap(stroke => stroke.points.map(point => point[1])), ...forSticky(sticky.id).map(turn => turn.inkBottom)];
        sticky.pendingSend = { clientRequestId: requestId(), strokeIds: [], typedText: text.trim(), inkBottom: Math.max(0, ...bottoms) + 0.001 };
        v.changed();
        post(sticky);
      },
      // `전송 안 됨`을 같은 요청 ID로 다시 보낸다. 서버에 이미 있으면 새로 부르지 않고 그 결과를 받는다.
      resend: sticky => post(sticky),
      async retry(turn, route = null) {
        upsert({ ...turn, status: 'pending', error: null });
        onChange();
        try { upsert((await api(`/api/lecture/qa/turns/${turn.id}/retry`, jsonOptions('POST', route ? { route } : {}))).turn); } catch (error) { toast(error.message); await load(); return; }
        onChange();
        poll();
      },
      async dismiss(turn) {
        try { upsert((await api(`/api/lecture/qa/turns/${turn.id}/dismiss`, { method: 'POST' })).turn); } catch (error) { toast(error.message); }
        onChange();
      },
      markRead(turn) {
        turn.read = true;
        api(`/api/lecture/qa/turns/${turn.id}/read`, { method: 'POST' }).catch(() => {});
      },
      // 포스트잇을 지우면 Q&A도 지운다. 실패해도 포스트잇은 이미 필기에서 빠졌으므로 알리기만 한다.
      deleteSticky(id) {
        turns = turns.filter(turn => turn.stickyId !== id);
        api(`/api/lecture/qa/stickies/${id}?documentId=${v.documentId}`, { method: 'DELETE' }).catch(() => toast('시온 대화를 지우지 못했어.'));
      },
      destroy: () => clearTimeout(timer),
    };
  }

  global.LectureQa = { create };
})(window);
