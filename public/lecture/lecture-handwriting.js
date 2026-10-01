'use strict';

// 필체 등록(2026-10-01 사용자 결정). 화면에 뜬 문장을 Pencil로 평소처럼 따라 쓰면 획과 정답 글을 함께 모은다.
// 포스트잇 손글씨를 읽을 OCR을 이 표본으로 평가·파인튜닝한다. 문장은 포스트잇 질문에서 틀리기 쉬운 것 —
// `?`/`ㄴ` 첫 글자, 수식·기호, 헷갈리는 글자 쌍, 접두어 없는 메모, 영문 — 을 섞었다.
(function (global) {
  const { el, svg, api, jsonOptions, toast, ICON_BACK } = global.LectureCommon;

  // 쓰는 칸의 높이/폭. 두 줄까지 들어간다.
  const ASPECT = 0.3;
  // 획 굵기(CSS px). 포스트잇 메모의 굵기 1.0과 비슷하다.
  const LINE_PX = 2;

  const GROUPS = {
    // `?` 새 질문
    q: [
      '? 운동량 보존은 언제 성립해?', '? 충격량이랑 운동량 변화량이 왜 같아?', '? 원심력은 실제로 있는 힘이야?', '? 강체랑 질점 차이가 뭐야',
      '? 관성 모멘트는 왜 축마다 달라?', '? 마찰력 방향은 어떻게 정해?', '? 이 식에서 부호가 왜 음수야?', '? 여기서 가속도가 일정한 이유는?',
      '? 자유물체도는 어디까지 그려야 해?', '? 일과 에너지 방법은 언제 써?', '? 반발계수가 1이면 뭐가 보존돼?', '? 상대속도는 어느 기준으로 봐?',
      '? 각운동량이 보존되는 조건은?', '? 이거 답 뭐야?', '? 여기서 왜 적분해?', '? 이 그림에서 법선 방향이 어디야?',
      '? 코리올리 가속도는 언제 생겨?', '? 순간 회전 중심은 어떻게 찾아?', '? 이 단위가 왜 N·m이야?', '? 위치에너지 기준점은 아무 데나 돼?',
      '? 진동수랑 각진동수 차이', '? 감쇠비가 1보다 크면 어떻게 돼?', '? 이 문제 조건 하나 빠진 거 아니야?', '? 시험에 이런 유형 나와?',
      '? 이 항은 왜 무시해도 돼?', '? 경로에 따라 일이 달라져?', '? 보존력인지 어떻게 알아?', '? 구름 조건이 뭐야',
      '? 미끄러지면서 구르면 어떻게 풀어?', '? 이 두 식을 연립하면 되는 거야?', '? 극좌표에서 가속도 성분은?', '? 접선 가속도랑 법선 가속도 차이',
      '? 이거 벡터로 풀어야 해?', '? 스칼라곱이랑 벡터곱 언제 써?', '? 알려줘', '? 여기서 V가 뭐야?',
      '? 여기서 a는 벡터야?', '? 이 결과가 물리적으로 말이 돼?', '? 교재 3장 예제랑 같은 거야?', '? 질량 중심은 어떻게 구해?',
    ],
    // `ㄴ` 이어 묻기·정정
    f: [
      'ㄴ 그럼 외력이 있으면?', 'ㄴ 예시 하나만 더', 'ㄴ 아까 부호 반대 아니야?', 'ㄴ 더 쉽게 설명해줘',
      'ㄴ 그림으로 보면 어떻게 돼?', 'ㄴ 그럼 마찰이 있으면?', 'ㄴ 저건 2가 아니라 z야', 'ㄴ 단위가 안 맞는 것 같은데',
      'ㄴ 왜 그렇게 되는지 한 줄로', 'ㄴ 반대 방향이면?', 'ㄴ 이건 시험 범위야?', 'ㄴ 그럼 에너지는 보존돼?',
      'ㄴ 식 하나만 다시 써줘', 'ㄴ 내가 잘못 쓴 거 같아', 'ㄴ 속도가 아니라 가속도야', 'ㄴ 두 번째 줄이 이해 안 돼',
      'ㄴ 그러면 답이 몇이야?', 'ㄴ 계산 과정 보여줘', 'ㄴ 아 이해했어', 'ㄴ 그럼 질량이 두 배면?',
      'ㄴ 예시 하나만 더 줘라', 'ㄴ 1/2가 아니라 √3/2 아니야?', 'ㄴ L이랑 ㄴ 헷갈리면?', 'ㄴ 각도가 60°면?',
    ],
    // 수식·기호
    m: [
      '? ∫F dt = mv₂ - mv₁ 여기서 v₂가 뭐야', '? F = ma에서 a가 벡터야?', '? ω = v/r 은 언제 써', '? I = ∫r² dm 적분 범위는?',
      '? θ가 30°일 때 sin θ = 1/2 맞지?', '? T = ½Iω² 이거 맞아?', '? Σ M = Iα 에서 기준점은?', '? v = r × ω 순서 바뀌면?',
      '? a = dv/dt = v dv/ds 왜 같아?', '? x(t) = A cos(ωt + φ)', '? e = (v₂′ - v₁′)/(v₁ - v₂)', '? mgh = ½mv² 에서 v는?',
      '? F = -kx 부호 의미', '? ζ = c / 2√(km)', '? p = mv 벡터 맞지', '? H₀ = r × mv',
      '? a_n = v²/ρ', '? 2πr / T', '? √(x² + y²) 이게 크기야?', '? Δx = v₀t + ½at²',
      '? tan θ = μ 이면 미끄러져?', '? ∂L/∂q 이건 뭐야', '? 10 m/s² 로 근사해도 돼?', '? 3 × 10⁸ m/s',
      '? d²x/dt² + ω²x = 0', '? cos²θ + sin²θ = 1', '? r = 0.5 m, m = 2 kg', '? 1/2 × 4 × 3² = 18',
      '? e^(-ζωt) 는 왜 줄어?', '? k = 200 N/m 일 때 주기?',
    ],
    // 헷갈리는 글자 쌍
    c: [
      '? 2z랑 z² 차이', '? l이랑 1 구분돼?', '? 0이랑 O랑 θ', '? x랑 × 곱하기',
      '? 5랑 s랑 S', '? u랑 v랑 ν', '? 9랑 q랑 g', '? t랑 + 헷갈려',
      '? 7이랑 ?랑 ㄱ', '? r이랑 γ', '? a랑 α', '? w랑 ω',
      '? 1/2랑 ½', '? - 랑 ㄴ 랑 L', '? 6이랑 b', '? n이랑 η',
      '? p랑 ρ', '? 4랑 A', '? I랑 1이랑 l', '? Z랑 2',
    ],
    // 접두어 없는 메모
    n: [
      '시험에 나올 듯. 부호 조심', '교수님이 강조함', '다음 시간에 이어서', '예제 3번 다시 풀기',
      '이 부분 과제에 나옴', '공식 외우기', '단위 조심', '그림 다시 그려보기',
      '중간고사 범위 끝', '질문하러 가기', '이해 안 됨. 복습', '교재 p.124 참고',
      '부호 규약: 반시계 +', '정리: 에너지 보존', '헷갈리면 자유물체도부터', '다음 주 퀴즈',
    ],
    // 영문
    e: [
      '? what is angular momentum', '? is this a conservative force', '? why is the normal force zero here', '? free body diagram first',
      '? rigid body vs particle', '? what does the subscript mean', 'ㄴ can you show the steps', 'ㄴ why negative',
      '? impulse = change in momentum', '? unit of torque is N·m',
    ],
  };
  // 위 고정 문장은 1회차이고 평가용으로 남긴다. 2회차부터는 틀에 낱말·기호를 바꿔 끼운 새 문장을 쓴다 —
  // 같은 문장으로 학습하고 평가하면 OCR이 글씨 대신 문장을 외워 점수가 부푼다.
  const PROMPTS = Object.entries(GROUPS).flatMap(([group, lines]) => lines.map((label, index) => ({ id: `${group}-${String(index + 1).padStart(3, '0')}`, label })));
  const TERMS = ['운동량', '충격량', '각운동량', '관성 모멘트', '토크', '마찰력', '수직항력', '장력', '탄성력', '구심력', '일률', '운동에너지', '위치에너지', '반발계수', '감쇠비', '고유진동수', '질량 중심', '상대속도', '접선 가속도', '법선 가속도', '자유물체도', '순간 회전 중심', '각가속도', '변위', '주기'];
  const SYMBOLS = ['v₂', 'v₁', 'ω', 'θ', 'α', 'μ', 'ρ', 'ζ', 'φ', 'Δx', 'a', 'z', 'l', '1', '2', 'x', 'k', 'r', 'I', 'H₀', 'e', 'g', 'q', 's', 'n', 'η', 'u', 'ν', 'T', 'F'];
  const EQUATIONS = ['F = ma', 'p = mv', 'T = ½mv²', 'V = mgh', 'τ = r × F', 'ω = v/r', 'a = rα', 'F = μN', 'F = -kx', 'P = Fv', 'I = ∫r² dm', 'x = A sin ωt', 'v² = v₀² + 2aΔx', 'ΣF = 0', 'ΣM = Iα', 'e = 0.8', 'k = 200 N/m', 'g = 9.81 m/s²', 'θ = 45°', 'tan θ = μ', '√(x² + y²)', 'cos 60° = ½', 'd²x/dt²', 'ωₙ = √(k/m)'];
  const MEMOS = ['시험에 나올 듯', '부호 조심', '다시 풀기', '과제 범위', '교수님 강조', '공식 외우기', '단위 확인', '그림 다시', '복습 필요', '퀴즈 범위', '예제 참고', '질문하기'];
  // 조사는 앞 낱말 받침에 따라 바뀌므로 틀에 넣지 않는다.
  const TEMPLATES = [
    () => `? ${pick(TERMS)} 언제 써?`, () => `? ${pick(TERMS)}, ${pick(TERMS)} 차이`, () => `? 여기서 ${pick(SYMBOLS)} 뭐야?`,
    () => `? ${pick(EQUATIONS)} 맞아?`, () => `? ${pick(EQUATIONS)} 에서 ${pick(SYMBOLS)} 의미`, () => `? ${pick(TERMS)} 방향 어떻게 정해?`,
    () => `? ${pick(SYMBOLS)}, ${pick(SYMBOLS)} 구분돼?`, () => `? p.${10 + Math.floor(Math.random() * 290)} 예제 ${1 + Math.floor(Math.random() * 12)}번`,
    () => `ㄴ ${pick(SYMBOLS)} 아니고 ${pick(SYMBOLS)}`, () => `ㄴ 그럼 ${pick(TERMS)} 두 배면?`, () => `ㄴ ${pick(EQUATIONS)} 다시 써줘`,
    () => `ㄴ ${pick(TERMS)}도 보존돼?`, () => `${pick(MEMOS)}. ${pick(TERMS)}`, () => `${pick(EQUATIONS)} ${pick(MEMOS)}`,
  ];
  // 1회차 시험지 문장에 통째로 들어 있는 수식·메모 구절은 쓰지 않는다 — 학습에 들어가면 OCR이 그 구절을 외워
  // 시험지 점수가 부푼다(2026-10-02 2회차에서 발견). 용어 낱말은 실제 쓰임 그대로 둔다.
  const unseen = list => list.filter(item => !PROMPTS.some(prompt => prompt.label.includes(item)));
  EQUATIONS.splice(0, EQUATIONS.length, ...unseen(EQUATIONS));
  MEMOS.splice(0, MEMOS.length, ...unseen(MEMOS));
  function pick(list) { return list[Math.floor(Math.random() * list.length)]; }
  function generated() {
    const label = pick(TEMPLATES)();
    let hash = 2166136261;
    for (const char of label) hash = Math.imul(hash ^ char.codePointAt(0), 16777619) >>> 0;
    return { id: `g-${hash.toString(36)}`, label };
  }

  function deviceId() {
    try { return localStorage.getItem('galpi-lecture-device') || null; } catch { return null; }
  }

  async function open() {
    let status;
    try { status = await api('/api/lecture/handwriting'); } catch (error) { return toast(error.message); }
    const done = new Set(status.promptIds);
    let count = status.count;
    let prompt = null;
    let strokes = [];
    let lastSavedId = null;

    const shell = el('div', 'lecture-hw');
    const bar = el('header', 'lecture-hw-bar');
    const back = el('button', 'lecture-back');
    back.type = 'button';
    back.append(svg(ICON_BACK), el('span', '', 'Notes'));
    back.addEventListener('click', () => shell.remove());
    const counter = el('span', 'lecture-meta');
    const undo = el('button', 'lecture-pill is-plain', '방금 것 되돌리기');
    undo.type = 'button';
    bar.append(back, el('strong', '', '필체 등록'), counter, undo);

    const body = el('div', 'lecture-hw-body');
    const hint = el('p', 'lecture-sub', '문장을 평소 속도와 필체로 따라 써줘. 다르게 썼으면 아래 정답을 쓴 대로 고쳐줘.');
    const target = el('p', 'lecture-hw-prompt');
    const canvas = el('canvas', 'lecture-hw-canvas');
    const label = el('input', 'lecture-hw-label');
    label.setAttribute('aria-label', '정답 글');
    label.maxLength = 200;
    const actions = el('div', 'lecture-actions');
    const clear = el('button', 'lecture-pill is-plain', '지우기');
    const skip = el('button', 'lecture-pill is-plain', '건너뛰기');
    const save = el('button', 'lecture-pill', '저장하고 다음');
    [clear, skip, save].forEach(button => { button.type = 'button'; });
    actions.append(clear, skip, save);
    body.append(hint, target, canvas, label, actions);
    shell.append(bar, body);
    document.body.append(shell);

    function render() {
      counter.textContent = `${count}줄 저장됨`;
      undo.hidden = !lastSavedId;
      save.disabled = !strokes.length;
    }

    function next() {
      // 1회차 고정 문장부터. 다 썼으면 아직 안 쓴 새 문장을 만든다.
      const pool = PROMPTS.filter(item => !done.has(item.id));
      prompt = pool.length ? pick(pool) : generated();
      while (done.has(prompt.id)) prompt = generated();
      target.textContent = prompt.label;
      label.value = prompt.label;
      strokes = [];
      resize();
      render();
    }

    function resize() {
      const width = canvas.clientWidth;
      const dpr = Math.min(global.devicePixelRatio || 1, 2);
      canvas.style.height = `${Math.round(width * ASPECT)}px`;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(width * ASPECT * dpr);
      const ctx = canvas.getContext('2d');
      strokes.forEach(stroke => global.LectureInk.drawStroke(ctx, stroke, canvas.width));
    }

    // Pencil·마우스만 쓴다. 손가락은 아무것도 하지 않는다.
    const point = event => {
      const rect = canvas.getBoundingClientRect();
      const round = value => Math.round(value * 10000) / 10000;
      return [round((event.clientX - rect.left) / rect.width), round((event.clientY - rect.top) / rect.width), Math.round((event.pressure || 0.5) * 100) / 100];
    };
    let active = null;
    canvas.addEventListener('touchstart', event => { if ([...event.touches].some(touch => touch.touchType === 'stylus')) event.preventDefault(); }, { passive: false });
    canvas.addEventListener('pointerdown', event => {
      if (!(event.pointerType === 'pen' || (event.pointerType === 'mouse' && event.button === 0))) return;
      event.preventDefault();
      canvas.setPointerCapture(event.pointerId);
      active = { pointerId: event.pointerId, stroke: { tool: 'pen', color: '#000000', width: Math.round(LINE_PX / canvas.clientWidth * 100000) / 100000, points: [point(event)] } };
      global.LectureInk.drawStroke(canvas.getContext('2d'), active.stroke, canvas.width);
    });
    canvas.addEventListener('pointermove', event => {
      if (active?.pointerId !== event.pointerId) return;
      const from = active.stroke.points.length - 1;
      (event.getCoalescedEvents?.() || [event]).forEach(item => active.stroke.points.push(point(item)));
      global.LectureInk.drawStroke(canvas.getContext('2d'), { ...active.stroke, points: active.stroke.points.slice(from) }, canvas.width);
    });
    const end = event => {
      if (active?.pointerId !== event.pointerId) return;
      strokes.push(active.stroke);
      active = null;
      render();
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);

    clear.addEventListener('click', () => { strokes = []; resize(); render(); });
    skip.addEventListener('click', next);
    save.addEventListener('click', async () => {
      if (!strokes.length || !label.value.trim()) return;
      save.disabled = true;
      try {
        const result = await api('/api/lecture/handwriting', jsonOptions('POST', { promptId: prompt.id, label: label.value.trim(), strokes, aspect: ASPECT, deviceId: deviceId() }));
        count = result.count;
        lastSavedId = result.id;
        done.add(prompt.id);
        next();
      } catch (error) {
        toast(error.message);
        render();
      }
    });
    undo.addEventListener('click', async () => {
      try {
        count = (await api(`/api/lecture/handwriting/${lastSavedId}`, { method: 'DELETE' })).count;
        lastSavedId = null;
        render();
      } catch (error) { toast(error.message); }
    });
    new ResizeObserver(() => resize()).observe(canvas);
    next();
  }

  global.LectureHandwriting = { open, PROMPTS, generated };
})(window);
