'use strict';

// 펜 길게 누르기 원형 메뉴(설계 §6.8). 아이콘은 Figma `Radial Menu`(182:162) 컴포넌트의 경로다.
// 2026-10-01 `텍스트`를 넣어 7칸이 됐다(사용자 결정). 위 펜부터 시계 방향으로 선택·포스트잇·텍스트·지우개·
// `? 나중에`·`★ 중요`이고, 칸 모양은 Figma 6칸과 같은 반지름·틈으로 코드가 그린다. 아이콘은 Figma 위치에서
// 새 칸 가운데로 옮긴다. 항목 위치는 바뀌지 않고, 쓸 수 없는 항목은 자리를 지킨 채 흐리게 보인다.
(function (global) {
  const SIZE = 208;
  // 가운데에서 떼면 취소다. 설계상 실기기에서 정하는 값이다.
  const CANCEL_RADIUS = 40;
  // Figma 6칸: 바깥 반지름 96, 안쪽 60, 칸 사이 틈 4px. 아래 angle은 Figma에서 그 아이콘이 있던 각도다.
  const CENTER = 104;
  const OUTER = 96;
  const INNER = 60;
  const GAP = 2;
  const ITEMS = [
    {
      key: 'pen', angle: -90, label: '펜',
      icon: '<path d="M96.6667 33.3333L97.5834 29.6666L107.667 19.5833L110.417 22.3333L100.333 32.4166L96.6667 33.3333Z" stroke-linejoin="round"/><path d="M105.833 21.4167L108.583 24.1667"/>',
    },
    {
      key: 'select', angle: -30, label: '선택',
      icon: '<path d="M165.592 67.2917C163.85 66.1917 163.3 64.8167 163.3 63.6251C163.3 60.3251 166.967 57.6667 171.55 57.6667C176.133 57.6667 179.8 60.3251 179.8 63.6251C179.8 66.9251 176.133 69.5834 171.55 69.5834C170.358 69.5834 169.258 69.4001 168.25 69.1251" stroke-linecap="round" stroke-dasharray="2.29 2.29"/><path d="M166.05 66.375C167.15 66.375 168.067 67.2917 168.067 68.3917C168.067 69.4917 167.15 70.5 166.05 70.5C164.95 70.5 164.675 71.2333 164.675 72.15" stroke-linecap="round"/>',
    },
    {
      key: 'sticky', angle: 30, label: '질문 포스트잇',
      icon: '<path d="M165.133 136.125H177.967C178.575 136.125 179.157 136.366 179.587 136.796C180.017 137.226 180.258 137.809 180.258 138.417V145.75C180.258 146.358 180.017 146.941 179.587 147.37C179.157 147.8 178.575 148.042 177.967 148.042H170.633L166.508 151.25V148.042H165.133C164.526 148.042 163.943 147.8 163.513 147.37C163.083 146.941 162.842 146.358 162.842 145.75V138.417C162.842 137.809 163.083 137.226 163.513 136.796C163.943 136.366 164.526 136.125 165.133 136.125Z" stroke-linejoin="round"/>',
    },
    {
      // 텍스트 아이콘은 Figma에 없어 같은 선 굵기로 그린 `T`다. angle은 아이콘을 둔 기준 각도다.
      key: 'text', angle: 90, label: '텍스트',
      icon: '<path d="M98.5 176H109.5M104 176V189" stroke-linecap="round"/>',
    },
    {
      key: 'eraser', angle: 90, label: '지우개',
      icon: '<path d="M101.25 189.333H111.333M97.125 185.208L105.375 176.958C105.718 176.622 106.178 176.434 106.658 176.434C107.138 176.434 107.599 176.622 107.942 176.958L109.958 178.975C110.294 179.318 110.482 179.779 110.482 180.258C110.482 180.738 110.294 181.199 109.958 181.542L103.083 188.417H100.333L97.125 185.208Z" stroke-linejoin="round"/><path d="M100.792 181.542L105.375 186.125"/>',
    },
    {
      key: 'later', angle: 150, label: '나중에 볼 것',
      icon: '<path d="M36.45 151.25C41.0063 151.25 44.7 147.556 44.7 143C44.7 138.444 41.0063 134.75 36.45 134.75C31.8936 134.75 28.2 138.444 28.2 143C28.2 147.556 31.8936 151.25 36.45 151.25Z"/><path d="M34.1582 140.708C34.1596 140.295 34.2726 139.891 34.4851 139.537C34.6975 139.183 35.0017 138.893 35.3653 138.697C35.729 138.502 36.1387 138.409 36.5511 138.427C36.9636 138.445 37.3634 138.574 37.7084 138.801C38.0534 139.028 38.3307 139.343 38.5111 139.715C38.6915 140.086 38.7683 140.499 38.7333 140.911C38.6982 141.322 38.5528 141.716 38.3122 142.052C38.0716 142.387 37.7449 142.651 37.3665 142.817C36.8165 143.092 36.4499 143.55 36.4499 144.192V144.833" stroke-linecap="round"/><path class="is-fill" d="M36.45 148.592C37.0069 148.592 37.4583 148.14 37.4583 147.583C37.4583 147.026 37.0069 146.575 36.45 146.575C35.8931 146.575 35.4417 147.026 35.4417 147.583C35.4417 148.14 35.8931 148.592 36.45 148.592Z"/>',
    },
    {
      key: 'important', angle: 210, label: '중요',
      icon: '<path d="M36.4499 57.2083L38.8332 62.0666L44.2415 62.8916L40.2999 66.6499L41.2165 71.9666L36.4499 69.4916L31.6832 71.9666L32.5999 66.6499L28.6582 62.8916L34.0665 62.0666L36.4499 57.2083Z" stroke-linejoin="round"/>',
    },
  ];
  const BACKDROP = 'M200 104C200 157.019 157.019 200 104 200C50.9807 200 8 157.019 8 104C8 50.9807 50.9807 8 104 8C157.019 8 200 50.9807 200 104ZM44 104C44 137.137 70.8629 164 104 164C137.137 164 164 137.137 164 104C164 70.8629 137.137 44 104 44C70.8629 44 44 70.8629 44 104Z';
  const SPAN = 360 / ITEMS.length;
  // 위(-90°)에서 시계 방향으로 칸을 나눈다.
  ITEMS.forEach((item, index) => { item.at = -90 + index * SPAN; });
  const rad = degrees => degrees * Math.PI / 180;
  const polar = (radius, degrees) => [CENTER + radius * Math.cos(rad(degrees)), CENTER + radius * Math.sin(rad(degrees))].map(value => value.toFixed(3)).join(' ');
  // 칸 경계에서 양쪽으로 GAP만큼 평행하게 띄운 부채꼴. 원 위에서는 반지름마다 각도로 바꿔 띄운다.
  function sector(at) {
    const from = at - SPAN / 2;
    const to = at + SPAN / 2;
    const pad = radius => Math.asin(GAP / radius) * 180 / Math.PI;
    return `M${polar(OUTER, from + pad(OUTER))}A${OUTER} ${OUTER} 0 0 1 ${polar(OUTER, to - pad(OUTER))}L${polar(INNER, to - pad(INNER))}A${INNER} ${INNER} 0 0 0 ${polar(INNER, from + pad(INNER))}Z`;
  }
  // Figma 아이콘은 원래 칸 가운데(반지름 78)에 있다. 새 칸 가운데로 평행 이동한다.
  function iconShift(item) {
    const middle = (OUTER + INNER) / 2;
    const dx = middle * (Math.cos(rad(item.at)) - Math.cos(rad(item.angle)));
    const dy = middle * (Math.sin(rad(item.at)) - Math.sin(rad(item.angle)));
    return `translate(${dx.toFixed(3)} ${dy.toFixed(3)})`;
  }

  // enabled: { [key]: boolean }. 반환값의 release()가 고른 항목 key를 준다(취소면 null).
  function open({ x, y, enabled }) {
    const wrap = document.createElement('div');
    wrap.className = 'lecture-radial';
    // 화면 가장자리에서는 메뉴를 안쪽으로 옮긴다. 방향 판정은 보이는 메뉴의 중심 기준이다.
    const left = Math.max(8, Math.min(x - SIZE / 2, innerWidth - SIZE - 8));
    const top = Math.max(8, Math.min(y - SIZE / 2, innerHeight - SIZE - 8));
    wrap.style.left = `${left}px`;
    wrap.style.top = `${top}px`;
    wrap.innerHTML = `<svg viewBox="0 0 ${SIZE} ${SIZE}" width="${SIZE}" height="${SIZE}" aria-hidden="true">
      <path class="lecture-radial-backdrop" d="${BACKDROP}"/>
      ${ITEMS.map(item => `<g class="lecture-radial-item${enabled[item.key] ? '' : ' is-disabled'}" data-key="${item.key}"><path class="lecture-radial-segment" d="${sector(item.at)}"/><g class="lecture-radial-icon" transform="${iconShift(item)}">${item.icon}</g></g>`).join('')}
    </svg>`;
    document.body.append(wrap);
    const center = { x: left + SIZE / 2, y: top + SIZE / 2 };
    let current = null;

    function pick(px, py) {
      const dx = px - center.x;
      const dy = py - center.y;
      if (Math.hypot(dx, dy) < CANCEL_RADIUS) return null;
      const angle = Math.atan2(dy, dx) * 180 / Math.PI;
      const item = ITEMS.find(candidate => Math.abs(((angle - candidate.at + 540) % 360) - 180) <= SPAN / 2);
      return item && enabled[item.key] ? item.key : null;
    }

    return {
      move(px, py) {
        const next = pick(px, py);
        if (next === current) return;
        current = next;
        wrap.querySelectorAll('.lecture-radial-item').forEach(node => node.classList.toggle('is-active', node.dataset.key === current));
      },
      release() {
        wrap.remove();
        return current;
      },
      cancel() {
        wrap.remove();
      },
    };
  }

  global.LectureRadial = { open };
})(window);
