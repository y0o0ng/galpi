// 캡처 시간축 스파이크 (설계 §14.1 10분 smoke). 제품 코드가 아니다.
// 시간은 모두 이 runtime의 시작 기준 ms(session ms)다. 이벤트의 timeStamp와 performance.now()는
// 같은 timeOrigin을 쓰므로 한 축으로 잰다. 브라우저를 다시 열면 새 runtime이다.
(() => {
  const $ = id => document.getElementById(id);
  const A = window.CaptureAnalysis;
  const runtimeId = 'rt_' + Date.now().toString(36);
  const t0 = performance.now();
  const sessionMs = ts => Math.round((ts ?? performance.now()) - t0);
  const mimeType = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'].find(m => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || '';

  let db, stream, recorder, partNo = 0, partId = null, seq = 0, lastDataAt = 0, gotData = false;
  let status = 'idle', syncMode = false;

  // ---- 저장 (IndexedDB) ----
  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('capture-timing-spike', 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore('chunks', { autoIncrement: true }).createIndex('runtime', 'runtimeId');
        req.result.createObjectStore('events', { autoIncrement: true }).createIndex('runtime', 'runtimeId');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  const put = (store, value) => new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite'); tx.objectStore(store).add(value);
    tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
  });
  const all = (store, runtime) => new Promise((resolve, reject) => {
    const s = db.transaction(store).objectStore(store);
    const req = runtime ? s.index('runtime').getAll(runtime) : s.getAll();
    req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
  });

  // ---- 로그 ----
  function log(type, data = {}, ts) {
    const ev = { runtimeId, t: sessionMs(ts), type, data, wall: new Date().toISOString() };
    $('log').textContent = `${(ev.t / 1000).toFixed(3)}s  ${type} ${JSON.stringify(data)}\n` + $('log').textContent;
    if (db) put('events', ev).catch(e => console.error(e));
    return ev;
  }

  function setStatus(next, detail = '') {
    status = next;
    const text = { idle: '대기', ready: '마이크 준비됨', starting: '시작 확인 중…', recording: '● 녹음 중', paused: '일시정지', interrupted: '녹음 중단됨', finished: '측정 끝' }[next];
    $('status').textContent = detail ? `${text} · ${detail}` : text;
    $('status').className = next;
    $('btn-rec').disabled = !['ready', 'paused', 'interrupted'].includes(next) || !stream;
    $('btn-rec').textContent = ['paused', 'interrupted'].includes(next) ? '녹음 재개' : '녹음 시작';
    $('btn-pause').disabled = next !== 'recording';
    $('btn-finish').disabled = !['recording', 'paused', 'interrupted'].includes(next);
  }

  // 실제 녹음이 죽었는데 '녹음 중'으로 남는 것이 §14.1의 치명적 실패다. 의심되면 바로 중단으로 바꾼다.
  function interrupt(reason) {
    if (!['recording', 'starting'].includes(status)) return;
    log('interrupted', { reason, partId });
    setStatus('interrupted', reason);
    try { if (recorder && recorder.state !== 'inactive') recorder.stop(); } catch (e) { log('stop_error', { message: String(e) }); }
  }

  // ---- 마이크·녹음 ----
  $('btn-mic').onclick = async () => {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      const track = stream.getAudioTracks()[0];
      log('mic_ready', { mimeType, settings: track.getSettings ? track.getSettings() : {} });
      track.onended = () => { log('track_ended'); interrupt('마이크 트랙 종료'); };
      track.onmute = () => { log('track_mute'); interrupt('마이크 음소거'); };
      track.onunmute = () => log('track_unmute');
      $('btn-mic').disabled = true;
      setStatus('ready');
    } catch (e) { log('mic_error', { name: e.name, message: e.message }); $('status').textContent = `마이크 실패: ${e.name}`; }
  };

  // 재개마다 새 조각 파일(= 새 recording_span)을 만든다. 파일 배치는 설계상 미정이고 span 의미는 같다.
  $('btn-rec').onclick = () => {
    if (!stream || stream.getAudioTracks()[0].readyState !== 'live') { interrupt('마이크 트랙 없음'); return; }
    partId = `a${++partNo}`; seq = 0; gotData = false;
    const part = partId;
    recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    recorder.onstart = e => { log('span_start', { partId: part, mimeType: recorder.mimeType }, e.timeStamp); lastDataAt = performance.now(); };
    recorder.ondataavailable = e => {
      if (!e.data || !e.data.size) return;
      lastDataAt = performance.now();
      put('chunks', { runtimeId, partId: part, seq: seq++, t: sessionMs(e.timeStamp), blob: e.data, type: e.data.type });
      if (!gotData) { gotData = true; log('first_data', { partId: part, bytes: e.data.size }, e.timeStamp); if (status === 'starting') setStatus('recording'); }
    };
    recorder.onstop = e => { log('span_end', { partId: part }, e.timeStamp); if (status === 'recording') setStatus('paused'); };
    recorder.onerror = e => { log('recorder_error', { name: e.error && e.error.name }); interrupt('녹음기 오류'); };
    log('record_requested', { partId: part });
    setStatus('starting');
    recorder.start(1000);
  };

  $('btn-pause').onclick = () => { log('pause_requested', { partId }); if (recorder && recorder.state !== 'inactive') recorder.stop(); setStatus('paused'); };

  $('btn-finish').onclick = async () => {
    if (recorder && recorder.state !== 'inactive') { recorder.stop(); await new Promise(r => setTimeout(r, 600)); }
    log('finished');
    setStatus('finished');
    await analyze(runtimeId);
    await renderStored();
  };

  // 데이터가 3.5초 넘게 안 오면 녹음이 조용히 멈춘 것으로 본다.
  setInterval(() => {
    if (status !== 'recording') return;
    if (stream && stream.getAudioTracks()[0].readyState !== 'live') interrupt('마이크 트랙 끊김');
    else if (performance.now() - lastDataAt > 3500) interrupt('녹음 데이터 끊김');
  }, 1000);
  document.addEventListener('visibilitychange', () => log('visibility', { state: document.visibilityState, recorder: recorder && recorder.state }));
  window.addEventListener('pagehide', e => log('pagehide', { persisted: e.persisted }));
  window.addEventListener('pageshow', e => log('pageshow', { persisted: e.persisted }));

  // ---- 펜 기준점 ----
  const pad = $('pad');
  const ctx = pad.getContext('2d');
  // 획은 CSS 픽셀 좌표로 메모리에 들고 있다. 캔버스 크기를 바꾸면 브라우저가 그림을 지우므로
  // 회전 등으로 크기가 바뀌면(ResizeObserver) 버퍼를 맞춘 뒤 모든 획을 다시 그린다.
  const strokes = [];
  const scale = () => pad.width / pad.getBoundingClientRect().width;
  const point = e => { const r = pad.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  function dot(p) { const s = scale(); ctx.fillStyle = '#FF3B30'; ctx.beginPath(); ctx.arc(p.x * s, p.y * s, 6 * s, 0, 7); ctx.fill(); }
  function seg(a, b) { const s = scale(); ctx.strokeStyle = '#1D2622'; ctx.lineWidth = 2 * s; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(a.x * s, a.y * s); ctx.lineTo(b.x * s, b.y * s); ctx.stroke(); }
  new ResizeObserver(() => {
    const r = pad.getBoundingClientRect(); pad.width = Math.round(r.width * devicePixelRatio); pad.height = Math.round(r.height * devicePixelRatio);
    for (const st of strokes) { if (st.sync) dot(st.pts[0]); else for (let i = 1; i < st.pts.length; i++) seg(st.pts[i - 1], st.pts[i]); }
  }).observe(pad);
  let last = null, current = null;
  // 선택·길게 누르기 메뉴·스크롤이 펜 입력을 가로채지 않게 한다.
  for (const type of ['selectstart', 'contextmenu', 'touchstart', 'touchmove']) pad.addEventListener(type, e => e.preventDefault(), { passive: false });
  pad.addEventListener('pointerdown', e => {
    if (e.pointerType !== 'pen') return;
    e.preventDefault();
    pad.setPointerCapture(e.pointerId);
    const p = point(e);
    log('pen_down', { sync: syncMode, x: Math.round(p.x), y: Math.round(p.y) }, e.timeStamp);
    if (syncMode) { strokes.push({ sync: true, pts: [p] }); dot(p); last = null; return; }
    current = { sync: false, pts: [p] }; strokes.push(current); last = p;
  });
  // 이전 점에서 새 점까지만 그린다. 매번 획 전체를 다시 그리면 긴 획에서 끊긴다.
  pad.addEventListener('pointermove', e => {
    if (!last || e.pointerType !== 'pen') return;
    for (const ce of (e.getCoalescedEvents ? e.getCoalescedEvents() : [e])) {
      const p = point(ce); seg(last, p); current.pts.push(p); last = p;
    }
  });
  for (const type of ['pointerup', 'pointercancel']) pad.addEventListener(type, e => { if (type === 'pointercancel') log('pen_cancel', {}, e.timeStamp); last = null; });
  $('btn-sync').onclick = () => { syncMode = !syncMode; $('btn-sync').classList.toggle('on', syncMode); log('sync_mode', { on: syncMode }); };

  // ---- 분석 ----
  async function partBlob(runtime, part) {
    const chunks = (await all('chunks', runtime)).filter(c => c.partId === part).sort((a, b) => a.seq - b.seq);
    return chunks.length ? new Blob(chunks.map(c => c.blob), { type: chunks[0].type }) : null;
  }

  async function analyze(runtime) {
    const events = (await all('events', runtime)).sort((a, b) => a.t - b.t);
    const spans = {};
    for (const e of events) {
      if (e.type === 'span_start') spans[e.data.partId] = { partId: e.data.partId, start: e.t, end: null };
      if (e.type === 'span_end' && spans[e.data.partId]) spans[e.data.partId].end = e.t;
    }
    const taps = events.filter(e => e.type === 'pen_down' && e.data.sync);
    const ac = new (window.AudioContext || window.webkitAudioContext)();
    const decoded = {};
    const partRows = [];
    for (const s of Object.values(spans)) {
      const blob = await partBlob(runtime, s.partId);
      if (!blob) continue;
      try {
        const buf = await ac.decodeAudioData(await blob.arrayBuffer());
        decoded[s.partId] = A.energyEnvelope(buf.getChannelData(0), buf.sampleRate);
        const wallMs = s.end !== null ? s.end - s.start : null;
        partRows.push(`${s.partId}: 오디오 ${(buf.duration).toFixed(2)}s · 벽시계 ${wallMs !== null ? (wallMs / 1000).toFixed(2) + 's' : '끝 없음(중단)'} · 차이 ${wallMs !== null ? Math.round(buf.duration * 1000 - wallMs) + 'ms' : '-'}`);
      } catch (e) { partRows.push(`${s.partId}: 디코딩 실패 ${e.name}`); }
    }
    const rows = taps.map((tap, i) => {
      const span = Object.values(spans).find(s => tap.t >= s.start && (s.end === null || tap.t <= s.end));
      if (!span) return { i, sessionMs: tap.t, gap: true, offsetMs: null };
      const expected = (tap.t - span.start) / 1000;
      const env = decoded[span.partId];
      const onset = env ? A.findOnset(env, expected) : null;
      return { i, sessionMs: tap.t, partId: span.partId, expected, offsetMs: onset === null ? null : Math.round((onset - expected) * 1000) };
    });
    const measured = rows.filter(r => !r.gap);
    const sum = A.summarize(measured);
    const gapTaps = rows.filter(r => r.gap).length;
    $('summary').innerHTML = `
      <div class="${sum.pass ? 'pass' : 'fail'}">${sum.pass ? 'PASS' : 'FAIL'} · 최대 오차 ${sum.maxAbsOffsetMs ?? '-'}ms (기준 ±${sum.gateMs}ms)</div>
      <div>싱크 탭 ${sum.taps}개 중 ${sum.found}개 찾음 · 못 찾음 ${sum.missing} · 녹음 없음 구간의 탭 ${gapTaps}</div>
      <div>중앙 오차 ${sum.medianOffsetMs ?? '-'}ms · drift ${sum.driftMsPerMin === null ? '-' : sum.driftMsPerMin.toFixed(1) + 'ms/분'} (판정은 사람이)</div>
      <div class="muted">${partRows.join('<br>')}</div>`;
    $('taps').innerHTML = '<tr><th>#</th><th>세션 시각</th><th>조각</th><th>오차</th></tr>' + rows.map(r =>
      `<tr><td>${r.i + 1}</td><td>${(r.sessionMs / 1000).toFixed(2)}s</td><td>${r.gap ? '녹음 없음' : r.partId}</td><td>${r.gap ? '측정 대상 아님' : r.offsetMs === null ? '못 찾음' : r.offsetMs + 'ms'}</td></tr>`).join('');
    log('analysis', { runtime, ...sum, gapTaps, parts: partRows, rows: rows.map(r => ({ sessionMs: r.sessionMs, partId: r.partId ?? null, gap: !!r.gap, offsetMs: r.offsetMs })) });
  }

  // ---- 복구·내보내기 ----
  async function renderStored() {
    const chunks = await all('chunks');
    const byRt = {};
    for (const c of chunks) { (byRt[c.runtimeId] ??= {})[c.partId] ??= { n: 0, bytes: 0 }; byRt[c.runtimeId][c.partId].n++; byRt[c.runtimeId][c.partId].bytes += c.blob.size; }
    const el = $('stored'); el.innerHTML = '';
    if (!Object.keys(byRt).length) { el.textContent = '저장된 녹음 없음'; return; }
    for (const [rt, parts] of Object.entries(byRt)) {
      const box = document.createElement('div'); box.style.margin = '6px 0';
      box.innerHTML = `<b>${rt}</b>${rt === runtimeId ? ' (지금)' : ''} · ` + Object.entries(parts).map(([p, v]) => `${p} ${v.n}조각 ${(v.bytes / 1024).toFixed(0)}KB`).join(' · ') + ' ';
      for (const p of Object.keys(parts)) {
        const play = document.createElement('button'); play.textContent = `${p} 재생`;
        play.onclick = async () => { const a = new Audio(URL.createObjectURL(await partBlob(rt, p))); a.controls = true; box.appendChild(a); a.play(); };
        const dl = document.createElement('button'); dl.textContent = `${p} 받기`;
        dl.onclick = async () => { const b = await partBlob(rt, p); const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = `${rt}-${p}.${b.type.includes('mp4') ? 'm4a' : 'webm'}`; a.click(); };
        box.append(play, dl);
      }
      const an = document.createElement('button'); an.textContent = '이 기록 분석'; an.onclick = () => analyze(rt); box.appendChild(an);
      el.appendChild(box);
    }
  }
  $('btn-export').onclick = async () => {
    const events = await all('events');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), userAgent: navigator.userAgent, events }, null, 2)], { type: 'application/json' }));
    a.download = `capture-timing-${runtimeId}.json`; a.click();
  };

  openDb().then(async d => { db = d; log('runtime_start', { userAgent: navigator.userAgent, mimeType }); await renderStored(); })
    .catch(e => { $('stored').textContent = `IndexedDB 실패: ${e}`; });
  setStatus('idle');
})();
