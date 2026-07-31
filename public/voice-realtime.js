'use strict';

(function setupVoiceRealtime(global) {
  const TRANSCRIPT_EVENT_TYPES = new Set([
    'conversation.item.input_audio_transcription.delta',
    'conversation.item.input_audio_transcription.completed',
    'response.output_audio_transcript.delta',
    'response.output_audio_transcript.done',
    'response.audio_transcript.delta',
    'response.audio_transcript.done',
  ]);

  const state = {
    initialized: false,
    phase: 'idle',
    muted: false,
    config: null,
    apiFetch: null,
    showToast: null,
    peer: null,
    channel: null,
    localStream: null,
    remoteStream: null,
    hardCapTimer: null,
    countdownTimer: null,
    disconnectedTimer: null,
    startedAt: 0,
    runId: 0,
    toolSessionId: '',
    correctionSessionId: '',
    turnRecorder: null,
    correctionQueue: [],
    correctionActive: false,
    correctionAbortControllers: new Set(),
    correctionBackpressure: false,
    turnSequence: 0,
    currentTurnId: '0',
    pendingResponseTurnIds: [],
    turnReceipts: new Map(),
    inputItemTurns: new Map(),
    responseTurns: new Map(),
    responseStatuses: new Map(),
    responseReasons: new Map(),
    assistantItemResponses: new Map(),
    handledServerEvents: new Set(),
    handledToolCalls: new Set(),
    rows: new Map(),
    elements: {},
  };

  function getState() {
    return {
      phase: state.phase,
      muted: state.muted,
      active: state.phase !== 'idle' && state.phase !== 'error',
    };
  }

  function formatModel(model) {
    return String(model || '')
      .replace(/^gpt-/i, 'GPT-')
      .replace(/-(\d+)\.(\d+)-mini$/i, ' $1.$2 mini');
  }

  function phaseCopy(phase) {
    if (state.correctionBackpressure && phase === 'listening') return '기록 정리 중';
    const copies = {
      idle: '대화 준비',
      requesting_permission: '마이크 권한 확인 중',
      connecting: '시온과 연결 중',
      listening: state.muted ? '마이크 음소거됨' : '듣는 중',
      thinking: '생각 중',
      speaking: '시온이 말하는 중',
      ending: '연결 정리 중',
      error: '연결 오류',
    };
    return copies[phase] || '음성 대화';
  }

  function render() {
    if (!state.initialized) return;
    const { panel, launcher, status, mute, stop, timer, disclosure } = state.elements;
    const active = state.phase !== 'idle' && state.phase !== 'error';
    panel.hidden = state.phase === 'idle';
    panel.dataset.phase = state.phase;
    launcher.disabled = state.phase === 'requesting_permission' || state.phase === 'connecting';
    launcher.setAttribute('aria-pressed', String(active));
    launcher.title = active ? '음성 대화 종료' : 'XION 음성 대화';
    status.textContent = phaseCopy(state.phase);
    mute.disabled = !active || state.phase === 'ending';
    mute.setAttribute('aria-pressed', String(state.muted));
    mute.textContent = state.muted ? '마이크 켜기' : '음소거';
    stop.disabled = state.phase === 'ending';
    stop.textContent = state.phase === 'error' ? '닫기' : '종료';
    disclosure.textContent = state.config?.correctionEnabled
      ? '보정 자막 · 아직 저장 안 함'
      : 'AI 생성 음성 · 저장 안 함';
    if (!active) timer.textContent = '';
  }

  function setPhase(phase) {
    state.phase = phase;
    render();
  }

  function clearTimer(name) {
    if (!state[name]) return;
    global.clearTimeout(state[name]);
    global.clearInterval(state[name]);
    state[name] = null;
  }

  function stopStream(stream) {
    if (!stream?.getTracks) return;
    stream.getTracks().forEach(track => {
      try {
        track.stop();
      } catch (_) {
        // 이미 끝난 track은 정리된 것으로 취급한다.
      }
    });
  }

  function releaseResources() {
    clearTimer('hardCapTimer');
    clearTimer('countdownTimer');
    clearTimer('disconnectedTimer');
    stopStream(state.localStream);
    stopStream(state.remoteStream);
    state.localStream = null;
    state.remoteStream = null;

    if (state.channel) {
      try {
        state.channel.close();
      } catch (_) {
        // close는 멱등 정리로 취급한다.
      }
    }
    state.channel = null;

    if (state.peer) {
      state.peer.ontrack = null;
      state.peer.onconnectionstatechange = null;
      try {
        state.peer.getSenders?.().forEach(sender => sender.track?.stop());
        state.peer.getReceivers?.().forEach(receiver => receiver.track?.stop());
        state.peer.close();
      } catch (_) {
        // 이미 닫힌 peer는 정리된 것으로 취급한다.
      }
    }
    state.peer = null;
    state.toolSessionId = '';
    state.correctionSessionId = '';
    state.turnRecorder?.stop?.();
    state.turnRecorder = null;
    state.correctionAbortControllers.forEach(controller => controller.abort());
    state.correctionAbortControllers.clear();
    state.correctionQueue = [];
    state.correctionActive = false;
    state.correctionBackpressure = false;
    state.turnSequence = 0;
    state.currentTurnId = '0';
    state.pendingResponseTurnIds = [];
    state.turnReceipts.clear();
    state.inputItemTurns.clear();
    state.responseTurns.clear();
    state.responseStatuses.clear();
    state.responseReasons.clear();
    state.assistantItemResponses.clear();
    state.handledServerEvents.clear();
    state.handledToolCalls.clear();

    const audio = state.elements.audio;
    if (audio) {
      audio.pause?.();
      audio.srcObject = null;
    }
    state.startedAt = 0;
    state.muted = false;
  }

  function resetToIdle() {
    state.runId += 1;
    releaseResources();
    setPhase('idle');
  }

  function fail(error) {
    state.runId += 1;
    releaseResources();
    state.elements.error.textContent = error?.message || '음성 연결을 시작하지 못했어.';
    setPhase('error');
  }

  function showRecoverableServerError(error = {}) {
    global.console?.warn?.('Recoverable Realtime request error', {
      type: String(error.type || ''),
      code: String(error.code || ''),
      param: String(error.param || ''),
    });
    state.elements.error.textContent =
      '음성 요청 하나를 처리하지 못했어. 다시 말하면 대화는 계속할 수 있어.';
    setPhase('listening');
  }

  function stop({ message = '', toast = false } = {}) {
    if (state.phase === 'idle') return;
    setPhase('ending');
    resetToIdle();
    if (message && toast) state.showToast?.(message);
  }

  function toggleMute() {
    if (!state.localStream || state.phase === 'idle' || state.phase === 'error') return;
    state.muted = !state.muted;
    applyInputTrackState();
    render();
  }

  function applyInputTrackState() {
    if (!state.localStream) return;
    const enabled = !state.muted && !state.correctionBackpressure;
    state.localStream.getAudioTracks().forEach(track => {
      track.enabled = enabled;
    });
  }

  function clearTranscript() {
    state.rows.clear();
    state.elements.transcript.replaceChildren();
    state.elements.error.textContent = '';
  }

  function eventId(event) {
    return String(event?.event_id || '').trim();
  }

  function rememberServerEvent(event) {
    const id = eventId(event);
    if (!id) return true;
    if (state.handledServerEvents.has(id)) return false;
    state.handledServerEvents.add(id);
    if (state.handledServerEvents.size > 4096) {
      const oldest = state.handledServerEvents.values().next().value;
      state.handledServerEvents.delete(oldest);
    }
    return true;
  }

  function createTurnReceipt(inputItemId = '') {
    state.turnSequence += 1;
    const turnId = String(state.turnSequence);
    const receipt = {
      turnId,
      inputItemId: '',
      inputStatus: 'capturing',
      responseIds: new Set(),
      audio: null,
      audioDurationMs: 0,
      correctionStatus: 'capturing',
      correctionQueued: false,
      correctedTranscript: '',
    };
    state.turnReceipts.set(turnId, receipt);
    state.currentTurnId = turnId;
    if (inputItemId) attachInputItem(receipt, inputItemId);
    return receipt;
  }

  function attachInputItem(receipt, inputItemId) {
    const itemId = String(inputItemId || '').trim();
    if (!receipt || !itemId) return receipt;
    if (receipt.inputItemId && receipt.inputItemId !== itemId) return receipt;
    receipt.inputItemId = itemId;
    state.inputItemTurns.set(itemId, receipt.turnId);
    return receipt;
  }

  function currentTurnReceipt() {
    return state.turnReceipts.get(state.currentTurnId) || null;
  }

  function ensureInputTurn(event) {
    const itemId = String(event?.item_id || event?.item?.id || '').trim();
    const mappedTurnId = itemId ? state.inputItemTurns.get(itemId) : '';
    if (mappedTurnId) return state.turnReceipts.get(mappedTurnId) || null;

    const current = currentTurnReceipt();
    if (current && (!itemId || !current.inputItemId || current.inputItemId === itemId)) {
      return attachInputItem(current, itemId);
    }
    return createTurnReceipt(itemId);
  }

  function bindResponseToTurn(responseId, turnId = state.currentTurnId) {
    const id = String(responseId || '').trim();
    if (!id) return '';
    const existing = state.responseTurns.get(id);
    if (existing) return existing;
    let resolvedTurnId = String(turnId || '').trim();
    if (!state.turnReceipts.has(resolvedTurnId)) {
      resolvedTurnId = createTurnReceipt().turnId;
    }
    state.responseTurns.set(id, resolvedTurnId);
    state.turnReceipts.get(resolvedTurnId)?.responseIds.add(id);
    return resolvedTurnId;
  }

  function queueResponseTurn(turnId) {
    const id = String(turnId || '').trim();
    if (!id || !state.turnReceipts.has(id)) return;
    state.pendingResponseTurnIds.push(id);
  }

  function bindResponseEventToTurn(responseId) {
    const id = String(responseId || '').trim();
    if (!id) return '';
    const existing = state.responseTurns.get(id);
    if (existing) return existing;
    let turnId = '';
    while (state.pendingResponseTurnIds.length > 0 && !turnId) {
      const candidate = state.pendingResponseTurnIds.shift();
      if (state.turnReceipts.has(candidate)) turnId = candidate;
    }
    return bindResponseToTurn(id, turnId || state.currentTurnId);
  }

  function resolveAssistantResponseId(event) {
    const direct = String(event?.response_id || event?.response?.id || '').trim();
    if (direct) return direct;
    const itemId = String(event?.item_id || event?.item?.id || '').trim();
    return itemId ? (state.assistantItemResponses.get(itemId) || '') : '';
  }

  function setTranscriptStatus(rowState, status) {
    rowState.status = status;
    rowState.final = [
      'final',
      'provisional',
      'corrected',
      'correction_failed',
      'interrupted',
      'incomplete',
      'failed',
    ].includes(status);
    rowState.row.classList.remove(
      'partial',
      'provisional',
      'correction_pending',
      'corrected',
      'correction_failed',
      'final',
      'interrupted',
      'incomplete',
      'failed',
    );
    rowState.row.classList.add(status);
    rowState.row.dataset.status = status;
  }

  function transcriptKey(event, role) {
    if (role === 'user') return `user:${event.item_id || event.event_id || 'current'}`;
    return `assistant:${event.item_id || event.response_id || event.event_id || 'current'}`;
  }

  function ensureTranscriptRow(event, role) {
    const key = transcriptKey(event, role);
    let rowState = state.rows.get(key);
    if (rowState) return rowState;

    const row = document.createElement('div');
    row.className = `voice-transcript-row ${role} partial`;
    const label = document.createElement('span');
    label.className = 'voice-transcript-speaker';
    label.textContent = role === 'user' ? '나' : 'XION';
    const text = document.createElement('p');
    text.className = 'voice-transcript-text';
    text.textContent = '…';
    row.append(label, text);
    state.elements.transcript.appendChild(row);
    const itemId = String(event.item_id || '').trim();
    const responseId = role === 'assistant' ? resolveAssistantResponseId(event) : '';
    const turnId = role === 'user'
      ? (ensureInputTurn(event)?.turnId || '')
      : (responseId ? (state.responseTurns.get(responseId) || '') : '');
    row.dataset.role = role;
    row.dataset.itemId = itemId;
    row.dataset.responseId = responseId;
    row.dataset.turnId = turnId;
    row.dataset.status = 'partial';
    rowState = {
      row,
      text,
      value: '',
      final: false,
      status: 'partial',
      itemId,
      responseId,
      turnId,
    };
    state.rows.set(key, rowState);
    sortTranscriptRows();
    state.elements.transcript.scrollTop = state.elements.transcript.scrollHeight;
    return rowState;
  }

  function sortTranscriptRows() {
    const ordered = [...state.rows.values()]
      .sort((left, right) => {
        const leftTurn = Number.parseInt(left.turnId, 10);
        const rightTurn = Number.parseInt(right.turnId, 10);
        const leftKey = Number.isFinite(leftTurn) && leftTurn > 0
          ? leftTurn
          : Number.MAX_SAFE_INTEGER;
        const rightKey = Number.isFinite(rightTurn) && rightTurn > 0
          ? rightTurn
          : Number.MAX_SAFE_INTEGER;
        if (leftKey !== rightKey) return leftKey - rightKey;
        const leftRole = left.row.dataset.role === 'user' ? 0 : 1;
        const rightRole = right.row.dataset.role === 'user' ? 0 : 1;
        return leftRole - rightRole;
      })
      .map(row => row.row);
    state.elements.transcript.replaceChildren(...ordered);
  }

  function userTranscriptRow(receipt) {
    if (!receipt?.inputItemId) return null;
    return state.rows.get(`user:${receipt.inputItemId}`) || null;
  }

  function renderUserReceipt(receipt) {
    const row = userTranscriptRow(receipt);
    if (!row) return;
    if (receipt.correctionStatus === 'corrected' && receipt.correctedTranscript) {
      row.value = receipt.correctedTranscript;
      setTranscriptStatus(row, 'corrected');
      row.text.textContent = row.value;
      return;
    }
    if (receipt.correctionStatus === 'correction_pending') {
      setTranscriptStatus(row, 'correction_pending');
      row.text.textContent = row.value ? `${row.value} · 보정 중` : '자막 보정 중';
      return;
    }
    if (receipt.correctionStatus === 'correction_failed') {
      setTranscriptStatus(row, 'correction_failed');
      row.text.textContent = row.value
        ? `${row.value} · 기록 확인 필요`
        : '기록 확인 필요';
    }
  }

  function pendingCorrectionCount() {
    return state.correctionQueue.length + (state.correctionActive ? 1 : 0);
  }

  function updateCorrectionBackpressure() {
    const shouldPause = pendingCorrectionCount() >= 3;
    if (state.correctionBackpressure === shouldPause) return;
    state.correctionBackpressure = shouldPause;
    applyInputTrackState();
    render();
  }

  function markCorrectionFailed(receipt, code) {
    if (!receipt) return;
    receipt.audio = null;
    receipt.correctionStatus = 'correction_failed';
    receipt.correctionErrorCode = String(code || 'REALTIME_TRANSCRIPTION_FAILED');
    renderUserReceipt(receipt);
  }

  async function processCorrectionQueue() {
    if (state.correctionActive || state.correctionQueue.length === 0) return;
    const receipt = state.correctionQueue.shift();
    state.correctionActive = true;
    updateCorrectionBackpressure();
    const runId = state.runId;
    const controller = new AbortController();
    state.correctionAbortControllers.add(controller);
    try {
      if (
        !state.correctionSessionId
        || !receipt?.audio
        || !receipt.inputItemId
        || receipt.correctionStatus !== 'correction_pending'
      ) {
        throw new Error('REALTIME_TRANSCRIPTION_NOT_READY');
      }
      const form = new FormData();
      form.set('session_id', state.correctionSessionId);
      form.set('input_item_id', receipt.inputItemId);
      form.set('duration_ms', String(receipt.audioDurationMs));
      form.set('audio', receipt.audio, `voice-turn-${receipt.turnId}.wav`);
      const response = await state.apiFetch(
        `/api/voice/realtime/turns/${encodeURIComponent(receipt.turnId)}/transcribe`,
        {
          method: 'POST',
          body: form,
          signal: controller.signal,
        },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error(data.code || 'REALTIME_TRANSCRIPTION_FAILED');
        error.code = data.code || 'REALTIME_TRANSCRIPTION_FAILED';
        throw error;
      }
      const corrected = String(data.correctedTranscript || '').trim();
      if (!corrected) {
        const error = new Error('REALTIME_TRANSCRIPTION_EMPTY');
        error.code = 'REALTIME_TRANSCRIPTION_EMPTY';
        throw error;
      }
      if (runId !== state.runId) return;
      receipt.correctedTranscript = corrected;
      receipt.correctionModel = String(data.model || '');
      receipt.correctionStatus = 'corrected';
      receipt.audio = null;
      renderUserReceipt(receipt);
    } catch (error) {
      if (runId === state.runId && error?.name !== 'AbortError') {
        markCorrectionFailed(receipt, error?.code || error?.message);
      }
    } finally {
      state.correctionAbortControllers.delete(controller);
      if (runId === state.runId) {
        receipt.audio = null;
        state.correctionActive = false;
        updateCorrectionBackpressure();
        void processCorrectionQueue();
      }
    }
  }

  function maybeQueueCorrection(receipt) {
    if (
      !state.config?.correctionEnabled
      || !state.correctionSessionId
      || !receipt?.audio
      || !receipt.inputItemId
      || receipt.correctionQueued
      || receipt.correctionStatus === 'correction_failed'
    ) {
      return;
    }
    receipt.correctionQueued = true;
    receipt.correctionStatus = 'correction_pending';
    state.correctionQueue.push(receipt);
    renderUserReceipt(receipt);
    updateCorrectionBackpressure();
    void processCorrectionQueue();
  }

  function handleTurnAudioReady(result) {
    const receipt = state.turnReceipts.get(String(result?.turnId || ''));
    if (!receipt) return;
    if (result.errorCode || !result.blob) {
      markCorrectionFailed(receipt, result.errorCode || 'TURN_AUDIO_EMPTY');
      return;
    }
    receipt.audio = result.blob;
    receipt.audioDurationMs = Number(result.durationMs || 0);
    receipt.correctionStatus = 'audio_ready';
    maybeQueueCorrection(receipt);
  }

  async function startTurnRecorder(stream) {
    if (!state.config?.correctionEnabled) return;
    if (!global.VoiceTurnRecorder?.create) {
      throw new Error('이 브라우저는 보정 녹음을 지원하지 않아.');
    }
    const recorder = global.VoiceTurnRecorder.create({
      stream,
      maxDurationMs: Number(state.config.maxTurnSeconds || 120) * 1000,
      maxBytes: Number(state.config.maxTurnBytes || 8 * 1024 * 1024),
      onTurnReady: handleTurnAudioReady,
      onError() {
        state.elements.error.textContent = '보정 녹음 일부를 처리하지 못했어.';
      },
    });
    await recorder.start();
    state.turnRecorder = recorder;
  }

  function updateTranscript(event) {
    const inputEvent = event.type.startsWith('conversation.item.input_audio_transcription.');
    const role = inputEvent ? 'user' : 'assistant';
    const receipt = inputEvent ? ensureInputTurn(event) : null;
    const responseId = inputEvent ? '' : resolveAssistantResponseId(event);
    const turnId = inputEvent
      ? (receipt?.turnId || '')
      : (responseId ? bindResponseEventToTurn(responseId) : '');
    const row = ensureTranscriptRow(event, role);
    if (turnId) {
      row.turnId = turnId;
      row.row.dataset.turnId = turnId;
    }
    if (responseId) {
      row.responseId = responseId;
      row.row.dataset.responseId = responseId;
    }
    sortTranscriptRows();
    if (row.status === 'interrupted' || (role === 'user' && row.status === 'corrected')) return;

    const isFinal = event.type.endsWith('.completed') || event.type.endsWith('.done');
    if (isFinal) {
      row.value = String(event.transcript || row.value).trim();
      if (role === 'user') {
        if (receipt) receipt.inputStatus = 'provisional';
        if (receipt?.correctionStatus === 'corrected') {
          renderUserReceipt(receipt);
        } else {
          setTranscriptStatus(row, 'provisional');
          maybeQueueCorrection(receipt);
          renderUserReceipt(receipt);
        }
      } else {
        const responseStatus = state.responseStatuses.get(responseId);
        if (responseStatus === 'cancelled') {
          setTranscriptStatus(row, 'interrupted');
        } else if (responseStatus === 'incomplete') {
          setTranscriptStatus(row, 'incomplete');
        } else if (responseStatus === 'failed') {
          setTranscriptStatus(row, 'failed');
        } else {
          setTranscriptStatus(row, 'final');
        }
      }
    } else {
      if (row.final) return;
      row.value += String(event.delta || '');
    }
    if (role === 'assistant') {
      renderAssistantStatus(row);
    } else if (!['correction_pending', 'correction_failed', 'corrected'].includes(row.status)) {
      row.text.textContent = row.value || '…';
    }
    state.elements.transcript.scrollTop = state.elements.transcript.scrollHeight;
  }

  function renderAssistantStatus(row) {
    if (row.status === 'interrupted') {
      row.text.textContent = row.value ? `${row.value} · 중단됨` : '응답 중단됨';
    } else if (row.status === 'incomplete') {
      const reason = state.responseReasons.get(row.responseId);
      row.text.textContent = row.value
        ? `${row.value} · ${reason === 'max_output_tokens'
          ? '답변이 길어 여기서 멈춤'
          : '답변이 완료되지 않음'}`
        : (reason === 'max_output_tokens'
          ? '답변이 길어 여기서 멈춤'
          : '답변이 완료되지 않음');
    } else if (row.status === 'failed') {
      row.text.textContent = row.value ? `${row.value} · 응답 오류` : '응답 오류';
    } else {
      row.text.textContent = row.value || '…';
    }
  }

  function markResponseOutcome(responseId, status, reason = '') {
    if (!responseId) return;
    state.responseStatuses.set(responseId, status);
    if (reason) state.responseReasons.set(responseId, reason);
    for (const row of state.rows.values()) {
      if (row.responseId !== responseId) continue;
      setTranscriptStatus(row, status === 'cancelled' ? 'interrupted' : status);
      renderAssistantStatus(row);
    }
  }

  function bindAssistantItem(event) {
    const responseId = String(event?.response_id || event?.response?.id || '').trim();
    const itemId = String(event?.item?.id || event?.item_id || '').trim();
    if (!responseId || !itemId) return;
    state.assistantItemResponses.set(itemId, responseId);
    const turnId = bindResponseEventToTurn(responseId);
    const row = state.rows.get(`assistant:${itemId}`);
    if (!row) return;
    row.responseId = responseId;
    row.turnId = turnId;
    row.row.dataset.responseId = responseId;
    row.row.dataset.turnId = turnId;
    const responseStatus = state.responseStatuses.get(responseId);
    if (responseStatus && responseStatus !== 'completed') {
      setTranscriptStatus(row, responseStatus === 'cancelled' ? 'interrupted' : responseStatus);
      renderAssistantStatus(row);
    }
    sortTranscriptRows();
  }

  function sendChannelEvent(event) {
    if (!state.channel || typeof state.channel.send !== 'function') {
      throw new Error('Realtime 이벤트 연결이 준비되지 않았어.');
    }
    if (state.channel.readyState && state.channel.readyState !== 'open') {
      throw new Error('Realtime 이벤트 연결이 닫혀 있어.');
    }
    state.channel.send(JSON.stringify(event));
  }

  function normalizeFunctionCall(source, responseId = '') {
    const item = source?.item || source || {};
    const callId = String(item.call_id || source?.call_id || '').trim();
    const name = String(item.name || source?.name || '').trim();
    const args = item.arguments ?? source?.arguments ?? '{}';
    if (!callId || !name) return null;
    return {
      callId,
      name,
      arguments: typeof args === 'string' ? args : JSON.stringify(args),
      responseId: String(source?.response_id || responseId || ''),
    };
  }

  async function handleFunctionCall(call) {
    if (!call || state.handledToolCalls.has(call.callId)) return;
    state.handledToolCalls.add(call.callId);
    const runId = state.runId;
    const turnId = state.responseTurns.get(call.responseId) || state.currentTurnId || '0';
    setPhase('thinking');

    let output;
    try {
      if (!state.toolSessionId) throw new Error('읽기 도구 세션이 없어.');
      const response = await state.apiFetch('/api/voice/realtime/tool', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: state.toolSessionId,
          turnId,
          callId: call.callId,
          name: call.name,
          arguments: call.arguments,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        output = {
          ok: false,
          status: 'error',
          code: data.code || 'REALTIME_TOOL_UNAVAILABLE',
          message: '지금은 해당 읽기 자료를 가져오지 못했습니다.',
        };
      } else {
        output = data.output || data;
      }
    } catch (_) {
      output = {
        ok: false,
        status: 'error',
        code: 'REALTIME_TOOL_UNAVAILABLE',
        message: '지금은 해당 읽기 자료를 가져오지 못했습니다.',
      };
    }

    if (runId !== state.runId || state.phase === 'idle' || state.phase === 'error') return;
    try {
      sendChannelEvent({
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id: call.callId,
          output: JSON.stringify(output),
        },
      });
      if (state.currentTurnId !== turnId) return;
      queueResponseTurn(turnId);
      sendChannelEvent({ type: 'response.create' });
    } catch (error) {
      fail(error);
    }
  }

  function handleServerEvent(event) {
    if (!event || typeof event.type !== 'string') return;
    if (!rememberServerEvent(event)) return;
    if (TRANSCRIPT_EVENT_TYPES.has(event.type)) {
      updateTranscript(event);
      if (event.type.startsWith('response.') && event.type.endsWith('.delta')) {
        setPhase('speaking');
      }
      return;
    }

    if (event.type === 'input_audio_buffer.speech_started') {
      state.elements.error.textContent = '';
      const itemId = String(event.item_id || '').trim();
      const mappedTurnId = itemId ? state.inputItemTurns.get(itemId) : '';
      let receipt;
      if (mappedTurnId) {
        state.currentTurnId = mappedTurnId;
        receipt = state.turnReceipts.get(mappedTurnId);
      } else {
        receipt = createTurnReceipt(itemId);
      }
      if (receipt) state.turnRecorder?.beginTurn?.(receipt.turnId);
      setPhase('listening');
      return;
    }
    if (event.type === 'input_audio_buffer.speech_stopped') {
      const receipt = ensureInputTurn(event);
      if (receipt) {
        receipt.inputStatus = 'stopped';
        state.turnRecorder?.endTurn?.(receipt.turnId);
        queueResponseTurn(receipt.turnId);
      }
      setPhase('thinking');
      return;
    }
    if (event.type === 'response.created') {
      state.elements.error.textContent = '';
      const responseId = String(event.response?.id || event.response_id || '');
      if (responseId) bindResponseEventToTurn(responseId);
      setPhase('thinking');
      return;
    }
    if (event.type === 'response.function_call_arguments.done') {
      // arguments.done은 response가 아직 활성일 수 있다. 완성된 호출은 response.done에서만 실행한다.
      return;
    }
    if (event.type === 'response.output_item.added') {
      bindAssistantItem(event);
      setPhase('thinking');
      return;
    }
    if (event.type === 'response.done') {
      const response = event.response || {};
      if (response.id) {
        bindResponseEventToTurn(response.id);
        state.responseStatuses.set(response.id, response.status || 'completed');
        const reason = String(response.status_details?.reason || '').trim();
        if (reason) state.responseReasons.set(response.id, reason);
      }
      const functionCalls = response.status === 'completed'
        ? (Array.isArray(response.output) ? response.output : [])
        .filter(item => item?.type === 'function_call' && item?.status === 'completed')
        .map(item => normalizeFunctionCall(item, response.id))
        .filter(Boolean)
        : [];
      if (functionCalls.length > 0) {
        if (response.id) state.responseStatuses.set(response.id, 'tool_only');
        functionCalls.forEach(call => { void handleFunctionCall(call); });
        return;
      }
      if (['cancelled', 'failed', 'incomplete'].includes(response.status)) {
        markResponseOutcome(
          response.id,
          response.status,
          String(response.status_details?.reason || '').trim(),
        );
      }
      setPhase('listening');
      return;
    }
    if (event.type === 'error') {
      showRecoverableServerError(event.error);
    }
  }

  function handleChannelMessage(message) {
    try {
      handleServerEvent(JSON.parse(message.data));
    } catch (_) {
      // 알 수 없는 data channel payload는 세션 전체를 중단하지 않는다.
    }
  }

  function updateCountdown() {
    if (!state.startedAt) return;
    const total = Number(state.config.maxSessionSeconds) || 300;
    const elapsed = Math.floor((Date.now() - state.startedAt) / 1000);
    const remaining = Math.max(0, total - elapsed);
    const minutes = Math.floor(remaining / 60);
    const seconds = String(remaining % 60).padStart(2, '0');
    state.elements.timer.textContent = `${minutes}:${seconds}`;
  }

  function startHardCap() {
    state.startedAt = Date.now();
    updateCountdown();
    state.countdownTimer = global.setInterval(updateCountdown, 1000);
    state.hardCapTimer = global.setTimeout(() => {
      stop({ message: '5분 음성 세션을 안전하게 종료했어.', toast: true });
    }, Number(state.config.maxSessionSeconds) * 1000);
  }

  async function responseError(response) {
    const contentType = response.headers?.get?.('content-type') || '';
    if (contentType.includes('application/json')) {
      const data = await response.json().catch(() => ({}));
      return new Error(data.error || '음성 세션을 시작하지 못했어.');
    }
    return new Error('음성 세션을 시작하지 못했어.');
  }

  async function start() {
    if (state.phase !== 'idle' && state.phase !== 'error') {
      stop();
      return;
    }
    if (!state.config?.enabled) return;
    if (!global.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      fail(new Error('마이크 음성 대화는 HTTPS 환경에서 사용할 수 있어.'));
      return;
    }

    const runId = ++state.runId;
    clearTranscript();
    setPhase('requesting_permission');
    let localStream;
    try {
      localStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      if (runId !== state.runId) {
        stopStream(localStream);
        return;
      }
      state.localStream = localStream;
      try {
        await startTurnRecorder(localStream);
      } catch (_) {
        state.elements.error.textContent = '보정 녹음을 시작하지 못했어. 대화는 계속할 수 있어.';
      }
      setPhase('connecting');

      const peer = new RTCPeerConnection();
      state.peer = peer;
      peer.ontrack = event => {
        state.remoteStream = event.streams?.[0] || new MediaStream([event.track]);
        state.elements.audio.srcObject = state.remoteStream;
        state.elements.audio.play?.().catch(() => {});
      };
      peer.onconnectionstatechange = () => {
        if (runId !== state.runId) return;
        if (peer.connectionState === 'connected') {
          clearTimer('disconnectedTimer');
          setPhase('listening');
          if (!state.startedAt) startHardCap();
        } else if (peer.connectionState === 'failed' || peer.connectionState === 'closed') {
          fail(new Error('음성 연결이 종료됐어.'));
        } else if (peer.connectionState === 'disconnected') {
          clearTimer('disconnectedTimer');
          state.disconnectedTimer = global.setTimeout(() => {
            if (peer.connectionState === 'disconnected') {
              fail(new Error('음성 연결이 끊어졌어.'));
            }
          }, 2000);
        }
      };

      localStream.getAudioTracks().forEach(track => peer.addTrack(track, localStream));
      const channel = peer.createDataChannel('oai-events');
      state.channel = channel;
      channel.addEventListener('message', handleChannelMessage);
      channel.addEventListener('open', () => {
        if (runId !== state.runId) return;
        setPhase('listening');
        if (!state.startedAt) startHardCap();
      });
      channel.addEventListener('error', () => {
        if (runId === state.runId) fail(new Error('음성 이벤트 연결에 오류가 발생했어.'));
      });

      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      const response = await state.apiFetch('/api/voice/realtime/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/sdp' },
        body: offer.sdp,
      });
      if (!response.ok) throw await responseError(response);
      const answerSdp = await response.text();
      if (runId !== state.runId) return;
      state.toolSessionId = response.headers?.get?.('x-galpi-realtime-tool-session') || '';
      state.correctionSessionId =
        response.headers?.get?.('x-galpi-realtime-correction-session') || '';
      if (state.config?.correctionEnabled && !state.correctionSessionId) {
        state.turnRecorder?.stop?.();
        state.turnRecorder = null;
        state.elements.error.textContent = '보정 자막 세션을 열지 못했어. 대화는 계속할 수 있어.';
      }
      await peer.setRemoteDescription({ type: 'answer', sdp: answerSdp });
    } catch (error) {
      if (runId !== state.runId) {
        stopStream(localStream);
        return;
      }
      if (error?.name === 'NotAllowedError') {
        fail(new Error('마이크 권한이 필요해. 브라우저 설정에서 허용해줘.'));
      } else if (error?.name === 'NotFoundError') {
        fail(new Error('사용할 수 있는 마이크를 찾지 못했어.'));
      } else {
        fail(error);
      }
    }
  }

  function init({ apiFetch, showToast, config }) {
    if (state.initialized) return;
    if (typeof apiFetch !== 'function' || typeof showToast !== 'function') {
      throw new TypeError('VoiceRealtime 초기화 인자가 올바르지 않습니다.');
    }
    const elements = {
      launcher: document.getElementById('voice-realtime-button'),
      panel: document.getElementById('voice-realtime-panel'),
      status: document.getElementById('voice-realtime-status'),
      model: document.getElementById('voice-realtime-model'),
      timer: document.getElementById('voice-realtime-timer'),
      transcript: document.getElementById('voice-realtime-transcript'),
      error: document.getElementById('voice-realtime-error'),
      disclosure: document.getElementById('voice-realtime-disclosure'),
      mute: document.getElementById('voice-realtime-mute'),
      stop: document.getElementById('voice-realtime-stop'),
      audio: document.getElementById('voice-realtime-audio'),
    };
    if (Object.values(elements).some(element => !element)) {
      throw new TypeError('VoiceRealtime UI 요소가 없습니다.');
    }

    Object.assign(state, {
      initialized: true,
      apiFetch,
      showToast,
      config: config || { enabled: false },
      elements,
    });
    elements.launcher.hidden = state.config.enabled !== true;
    elements.model.textContent = state.config.enabled
      ? `Realtime · ${formatModel(state.config.model)} · ${state.config.voice}`
      : '';
    elements.launcher.addEventListener('click', start);
    elements.mute.addEventListener('click', toggleMute);
    elements.stop.addEventListener('click', () => {
      if (state.phase === 'error') resetToIdle();
      else stop();
    });
    elements.audio.addEventListener('playing', () => {
      if (state.phase !== 'idle' && state.phase !== 'error') setPhase('speaking');
    });
    global.addEventListener('pagehide', resetToIdle);
    global.addEventListener('beforeunload', resetToIdle);
    render();
  }

  global.VoiceRealtime = {
    getState,
    init,
    start,
    stop,
  };
})(window);
