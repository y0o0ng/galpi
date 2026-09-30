'use strict';

// 강의 노트 올가미 선택(설계 §6.6). 선택 모드에서 펜으로 둘러싼 영역 하나를 고른다. PDF 내용·필기·섞인 영역을
// 가리지 않고 같은 제스처다. 선택 근처의 `시온에게 묻기`는 그 선택을 붙인 포스트잇을 연다(L3a는 여기까지).
// 좌표는 필기와 같은 페이지 비율 좌표다(폭 = 1).
(function (global) {
  const { el, svg } = global.LectureCommon;
  // 이보다 작게 둘러싸면 선택이 아니라 선택 해제 탭으로 본다.
  const MIN_SIZE = 0.02;
  // 점 사이가 이보다 가까우면 버린다. 저장되는 선택 경로를 가볍게 한다.
  const MIN_STEP = 0.003;
  // Figma `시온에게 묻기`(177:318)의 반짝임 아이콘.
  const ASK_ICON = '<svg viewBox="0 0 14 17" width="14" height="17"><path d="M6.99995 0C7.56662 5.1 8.69995 7.36667 13.8 8.5C8.69995 9.63333 7.56662 11.9 6.99995 17C6.43328 11.9 5.29995 9.63333 0.199951 8.5C5.29995 7.36667 6.43328 5.1 6.99995 0Z" fill="currentColor"/></svg>';

  function create(v, { onAsk }) {
    let drawing = null; // { pointerId, page, points, overlay }
    let selection = null; // { page, overlay, ask }

    const pathData = points => `M${points.map(point => `${point[0]} ${point[1]}`).join('L')}`;

    function overlayFor(page) {
      const node = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      node.setAttribute('class', 'lecture-lasso');
      node.setAttribute('viewBox', `0 0 1 ${page.aspect}`);
      node.setAttribute('preserveAspectRatio', 'none');
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('vector-effect', 'non-scaling-stroke');
      node.append(path);
      page.el.append(node);
      return node;
    }

    function clear() {
      drawing?.overlay.remove();
      drawing = null;
      selection?.overlay.remove();
      selection?.ask.remove();
      selection = null;
    }

    return {
      active: pointerId => drawing?.pointerId === pointerId,
      clear,
      start(page, event) {
        clear();
        drawing = { pointerId: event.pointerId, page, points: [global.LectureInk.pagePoint(page, event).slice(0, 2)], overlay: overlayFor(page) };
      },
      move(page, event) {
        (event.getCoalescedEvents?.() || [event]).forEach(item => {
          const point = global.LectureInk.pagePoint(page, item).slice(0, 2);
          const last = drawing.points[drawing.points.length - 1];
          if (Math.hypot(point[0] - last[0], point[1] - last[1]) >= MIN_STEP) drawing.points.push(point);
        });
        drawing.overlay.firstChild.setAttribute('d', pathData(drawing.points));
      },
      end(page, completed) {
        const { points, overlay } = drawing;
        drawing = null;
        const xs = points.map(point => point[0]);
        const ys = points.map(point => point[1]);
        const bbox = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
        if (!completed || bbox[2] - bbox[0] < MIN_SIZE || bbox[3] - bbox[1] < MIN_SIZE) {
          overlay.remove();
          return;
        }
        overlay.firstChild.setAttribute('d', `${pathData(points)}Z`);
        overlay.classList.add('is-closed');
        // Figma S3: 버튼은 선택의 오른쪽 위에 걸친다. 페이지 밖으로 나가지 않게 안쪽으로 당긴다.
        const ask = el('button', 'lecture-ask');
        ask.type = 'button';
        ask.append(svg(ASK_ICON), el('span', '', '시온에게 묻기'));
        ask.style.left = `${Math.min(bbox[2] * 100, 100)}%`;
        ask.style.top = `${(bbox[1] / page.aspect) * 100}%`;
        ask.addEventListener('pointerdown', event => event.stopPropagation());
        ask.addEventListener('click', () => {
          const chosen = { page: page.number, path: points, bbox };
          clear();
          onAsk(page, chosen);
        });
        page.el.append(ask);
        selection = { page, overlay, ask };
      },
    };
  }

  global.LectureLasso = { create };
})(window);
