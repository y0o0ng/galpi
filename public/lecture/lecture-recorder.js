'use strict';

// 강의 노트 L1b 녹음기. 뷰어와 분리돼 있어서 자료를 바꾸거나 뷰어를 나가도 녹음이 이어진다(설계 §6.3).
// 스파이크(spikes/capture-timing)에서 검증한 방식을 옮겼다:
// - `녹음 중`은 첫 오디오 데이터가 온 뒤에만 표시한다(§6.1).
// - 트랙 종료·음소거·녹음기 오류·3.5초 무데이터는 곧바로 `중단됨`이다. 거짓 `녹음 중`이 가장 나쁜 실패다.
// - MediaRecorder 조각은 저장 단위일 뿐 시간 정본이 아니다(§7.4). 시간은 recorder의 start/stop 이벤트 시각이다.
(function (global) {
  const DB_NAME = 'galpi-lecture';
  const DB_VERSION = 2;
  const NO_DATA_MS = 3500;
  const START_TIMEOUT_MS = 6000;
  const RETRY_MS = 30000;
  const MIME_TYPES = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'];

  // ─── IndexedDB: 필기 작업본(drafts)과 오디오 조각을 한 DB에 둔다 ─────────────
  let dbPromise = null;
  function openDb() {
    dbPromise ||= new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('drafts')) db.createObjectStore('drafts', { keyPath: 'documentId' });
        if (!db.objectStoreNames.contains('audio_chunks')) db.createObjectStore('audio_chunks', { autoIncrement: true }).createIndex('part', 'partKey');
        if (!db.objectStoreNames.contains('audio_parts')) db.createObjectStore('audio_parts', { keyPath: 'partKey' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => { dbPromise = null; reject(request.error); };
    });
    return dbPromise;
  }
  const done = request => new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const store = async (name, mode = 'readonly') => (await openDb()).transaction(name, mode).objectStore(name);
  const putPart = async meta => done((await store('audio_parts', 'readwrite')).put(meta));
  const addChunk = async chunk => done((await store('audio_chunks', 'readwrite')).add(chunk));
  const allParts = async () => done((await store('audio_parts')).getAll());
  const partChunks = async partKey => (await done((await store('audio_chunks')).index('part').getAll(partKey))).sort((a, b) => a.seq - b.seq);
  async function removePart(partKey) {
    const db = await openDb();
    const tx = db.transaction(['audio_chunks', 'audio_parts'], 'readwrite');
    const keys = await done(tx.objectStore('audio_chunks').index('part').getAllKeys(partKey));
    keys.forEach(key => tx.objectStore('audio_chunks').delete(key));
    tx.objectStore('audio_parts').delete(partKey);
    await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
  }

  // ─── 시간축(§7.1·§7.3) ──────────────────────────────────────────────────────
  // runtime마다 벽시계로 한 번 고정하고 그 안에서는 performance.now()로 잰다. 이벤트의 timeStamp도 같은 기준이다.
  const random = () => crypto.getRandomValues(new Uint32Array(2)).reduce((text, value) => text + value.toString(36), '');
  const runtimeId = `rt_${Date.now().toString(36)}${random()}`;
  const perfAnchor = performance.now();
  const wallAnchor = Date.now();
  const sessionT = (session, timeStamp = performance.now()) => Math.round(wallAnchor + (timeStamp - perfAnchor) - session.startedAtMs);
  function localDate(date = new Date()) {
    const pad = value => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  // ─── 상태 ─────────────────────────────────────────────────────────────────
  const state = {
    status: 'idle', // idle | starting | recording | paused | interrupted
    session: null,
    containerId: null,
    containerName: '',
    committedMs: 0,
    partStartPerf: null,
    upload: 'idle', // idle | pending | uploading | failed
    interruptedAtMs: null,
  };
  const listeners = new Set();
  const emit = () => listeners.forEach(listener => { try { listener(state); } catch { /* 화면 갱신 실패가 녹음을 막지 않는다 */ } });
  let stream = null;
  let recorder = null;
  let meta = null;
  let lastDataAt = 0;
  let retryTimer = null;
  const todayCache = new Map();

  async function api(url, options) {
    const res = await global.apiFetch(url, options);
    const body = await res.json().catch(() => null);
    if (!res.ok) throw Object.assign(new Error(body?.error || `요청 실패 (${res.status})`), { status: res.status });
    return body;
  }

  function elapsedMs() {
    return state.committedMs + (state.status === 'recording' && state.partStartPerf != null ? performance.now() - state.partStartPerf : 0);
  }

  // 녹음이 없던 Session을 만들지 않는다. 오늘 이 과목에 이미 녹음한 Session이 있을 때만 돌려준다.
  async function todaySession(containerId) {
    if (state.session?.containerId === containerId && state.session.localDate === localDate()) return state.session;
    const { sessions } = await api(`/api/lecture/containers/${containerId}/sessions`);
    const session = sessions.find(item => item.localDate === localDate()) || null;
    todayCache.set(containerId, session);
    return session;
  }

  async function pendingMsFor(sessionId) {
    const parts = await allParts().catch(() => []);
    return parts.filter(part => part.sessionId === sessionId && part.start != null)
      .reduce((sum, part) => sum + Math.max(0, (part.end ?? part.lastT ?? part.start) - part.start), 0);
  }

  function stopTracks() {
    stream?.getTracks().forEach(track => { track.onended = null; track.onmute = null; track.stop(); });
    stream = null;
  }

  function interrupt() {
    if (!['starting', 'recording'].includes(state.status)) return;
    state.status = 'interrupted';
    state.interruptedAtMs = elapsedMs();
    emit();
    try { if (recorder && recorder.state !== 'inactive') recorder.stop(); else stopTracks(); } catch { stopTracks(); }
  }

  // forceNew: `+ 새 강의`로 연 자료의 첫 녹음은 오늘 Session이 있어도 새 Session을 만든다(§6.5).
  async function start(container, { forceNew = false } = {}) {
    if (['starting', 'recording'].includes(state.status)) return;
    const previous = state.status;
    recorder = null;
    state.status = 'starting';
    state.containerId = container.id;
    state.containerName = container.name;
    emit();
    try {
      const { session } = await api(`/api/lecture/containers/${container.id}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ localDate: localDate(), startedAtMs: Date.now(), forceNew }),
      });
      state.session = session;
      todayCache.set(container.id, session);
      state.committedMs = session.recordedMs + await pendingMsFor(session.id);
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    } catch (error) {
      stopTracks();
      state.status = previous === 'interrupted' ? 'interrupted' : (state.session ? 'paused' : 'idle');
      emit();
      throw error.name === 'NotAllowedError' ? new Error('마이크 권한이 필요해.') : error;
    }
    const track = stream.getAudioTracks()[0];
    track.onended = interrupt;
    track.onmute = interrupt;
    const mimeType = MIME_TYPES.find(type => global.MediaRecorder?.isTypeSupported(type)) || '';
    const session = state.session;
    const part = { partKey: `p_${Date.now().toString(36)}${random()}`, sessionId: session.id, runtimeId, mimeType: mimeType.split(';')[0] || 'audio/mp4', start: null, end: null, lastT: null, status: null };
    meta = part;
    let seq = 0;
    let gotData = false;
    recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    recorder.onstart = event => {
      part.start = sessionT(session, event.timeStamp);
      state.partStartPerf = event.timeStamp;
      lastDataAt = performance.now();
      putPart(part).catch(() => {});
    };
    recorder.ondataavailable = event => {
      if (!event.data?.size) return;
      lastDataAt = performance.now();
      part.lastT = sessionT(session, event.timeStamp);
      addChunk({ partKey: part.partKey, seq: seq++, blob: event.data }).catch(interrupt);
      putPart(part).catch(() => {});
      if (!gotData) {
        gotData = true;
        if (state.status === 'starting') {
          state.status = 'recording';
          emit();
        }
      }
    };
    recorder.onstop = event => {
      part.end = sessionT(session, event.timeStamp);
      part.status = state.status === 'interrupted' ? 'interrupted' : 'paused';
      // 데이터가 한 번도 오지 않은 구간은 올라가지 않으므로 녹음 시간에도 넣지 않는다.
      if (part.start != null && gotData) state.committedMs += Math.max(0, part.end - part.start);
      state.partStartPerf = null;
      meta = null;
      stopTracks();
      // 멈출 때 마지막 조각이 한 번 더 오므로 `어디까지 저장됐는지`는 여기서 정한다.
      if (state.status === 'interrupted') state.interruptedAtMs = state.committedMs;
      else state.status = 'paused';
      emit();
      putPart(part).catch(() => {}).then(uploadPending);
    };
    recorder.onerror = interrupt;
    lastDataAt = performance.now();
    recorder.start(1000);
  }

  // 일시정지가 유일한 멈춤이다. 그때까지의 구간을 바로 올린다(§6.5).
  function pause() {
    if (!recorder || recorder.state === 'inactive') return;
    recorder.stop();
  }

  async function sha256Hex(blob) {
    const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
    return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  }

  // 기기에 남은 파트를 올린다. 서버의 sha256이 기기 것과 같을 때만 기기 사본을 지운다.
  // 끝 기록 없이 남은 파트(앱 강제 종료 등)는 마지막 조각 시각까지를 `interrupted`로 올린다.
  let uploading = false;
  async function uploadPending() {
    if (uploading) return;
    uploading = true;
    clearTimeout(retryTimer);
    let failed = false;
    try {
      const parts = (await allParts()).filter(part => part.partKey !== meta?.partKey);
      if (parts.length) { state.upload = 'uploading'; emit(); }
      for (const part of parts) {
        const chunks = await partChunks(part.partKey);
        if (part.start == null || !chunks.length) { await removePart(part.partKey); continue; }
        const end = part.end ?? part.lastT ?? part.start;
        const status = part.end == null ? 'interrupted' : part.status;
        const blob = new Blob(chunks.map(chunk => chunk.blob), { type: part.mimeType });
        const query = new URLSearchParams({ runtime: part.runtimeId, start: String(part.start), end: String(Math.max(end, part.start)), status });
        try {
          const res = await global.apiFetch(`/api/lecture/sessions/${part.sessionId}/parts/${part.partKey}?${query}`, { method: 'PUT', headers: { 'Content-Type': part.mimeType }, body: blob });
          const result = await res.json().catch(() => ({}));
          if (res.status === 404) { await removePart(part.partKey); continue; }
          if (!res.ok || result.sha256 !== await sha256Hex(blob)) { failed = true; continue; }
          await removePart(part.partKey);
        } catch { failed = true; }
      }
    } catch {
      failed = true;
    } finally {
      uploading = false;
    }
    state.upload = failed ? 'failed' : 'idle';
    emit();
    if (failed) retryTimer = setTimeout(uploadPending, RETRY_MS);
  }

  // Session 이벤트(자료 열기·페이지 이동). 모아서 보내고 실패하면 다음에 다시 보낸다.
  const eventQueue = [];
  let eventTimer = null;
  function logEvent(session, type, documentId, page) {
    eventQueue.push({ sessionId: session.id, key: `ev_${Date.now().toString(36)}${random()}`, type, runtimeId, t: sessionT(session), documentId, page: page ?? null });
    clearTimeout(eventTimer);
    eventTimer = setTimeout(flushEvents, 1500);
  }
  async function flushEvents() {
    const batch = eventQueue.splice(0, eventQueue.length);
    const bySession = new Map();
    batch.forEach(({ sessionId, ...event }) => bySession.set(sessionId, [...(bySession.get(sessionId) || []), event]));
    for (const [sessionId, events] of bySession) {
      try {
        await api(`/api/lecture/sessions/${sessionId}/events`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ events }) });
      } catch (error) {
        if (error.status !== 400 && error.status !== 404) events.forEach(event => eventQueue.push({ sessionId, ...event }));
      }
    }
    if (eventQueue.length) eventTimer = setTimeout(flushEvents, RETRY_MS);
  }

  // 마커(§6.4). 추가·취소를 순서대로 보내고 끊기면 다시 보낸다. 아직 안 보낸 마커를 취소하면 보내지 않는다.
  const markerQueue = [];
  let markerTimer = null;
  let markerSending = false;
  function addMarker(session, kind, documentId, page) {
    const key = `mk_${Date.now().toString(36)}${random()}`;
    markerQueue.push({ sessionId: session.id, op: 'add', body: { key, kind, runtimeId, t: sessionT(session), documentId, page: page ?? null } });
    flushMarkers();
    return key;
  }
  function cancelMarker(session, key) {
    const pending = markerQueue.findIndex(item => item.op === 'add' && item.body.key === key);
    if (pending > 0 || (pending === 0 && !markerSending)) markerQueue.splice(pending, 1);
    else markerQueue.push({ sessionId: session.id, op: 'delete', key });
    flushMarkers();
  }
  async function flushMarkers() {
    if (markerSending) return;
    clearTimeout(markerTimer);
    markerSending = true;
    while (markerQueue.length) {
      const item = markerQueue[0];
      try {
        await api(item.op === 'add' ? `/api/lecture/sessions/${item.sessionId}/markers` : `/api/lecture/sessions/${item.sessionId}/markers/${item.key}`,
          item.op === 'add'
            ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(item.body) }
            : { method: 'DELETE' });
      } catch (error) {
        if (error.status !== 400 && error.status !== 404) {
          markerTimer = setTimeout(flushMarkers, RETRY_MS);
          break;
        }
      }
      markerQueue.shift();
    }
    markerSending = false;
  }

  // 녹음 중 데이터가 끊기면 중단으로 바꾼다. 시작 뒤 첫 데이터가 오지 않아도 마찬가지다(실측 첫 데이터 약 2초).
  setInterval(() => {
    const silentFor = performance.now() - lastDataAt;
    if (state.status === 'starting' && recorder && silentFor > START_TIMEOUT_MS) interrupt();
    if (state.status !== 'recording') return;
    if (stream?.getAudioTracks()[0]?.readyState !== 'live' || silentFor > NO_DATA_MS) interrupt();
  }, 1000);

  let resumed = false;
  global.LectureRecorder = {
    openDb,
    state,
    runtimeId,
    sessionT,
    localDate,
    elapsedMs,
    todaySession,
    start,
    pause,
    logEvent,
    addMarker,
    cancelMarker,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    // 앱을 다시 열었을 때 남아 있던 파트를 올린다. 마이크는 자동으로 켜지 않는다(§8.3).
    resume() {
      if (resumed) return;
      resumed = true;
      allParts().then(parts => { if (parts.length) { state.upload = 'pending'; emit(); uploadPending(); } }).catch(() => {});
    },
  };
})(window);
