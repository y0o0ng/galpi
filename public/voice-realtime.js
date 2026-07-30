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
    const { panel, launcher, status, mute, stop, timer } = state.elements;
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

  function stop({ message = '', toast = false } = {}) {
    if (state.phase === 'idle') return;
    setPhase('ending');
    resetToIdle();
    if (message && toast) state.showToast?.(message);
  }

  function toggleMute() {
    if (!state.localStream || state.phase === 'idle' || state.phase === 'error') return;
    state.muted = !state.muted;
    state.localStream.getAudioTracks().forEach(track => {
      track.enabled = !state.muted;
    });
    render();
  }

  function clearTranscript() {
    state.rows.clear();
    state.elements.transcript.replaceChildren();
    state.elements.error.textContent = '';
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
    rowState = {
      row,
      text,
      value: '',
      final: false,
      responseId: event.response_id || '',
    };
    state.rows.set(key, rowState);
    state.elements.transcript.scrollTop = state.elements.transcript.scrollHeight;
    return rowState;
  }

  function updateTranscript(event) {
    const inputEvent = event.type.startsWith('conversation.item.input_audio_transcription.');
    const role = inputEvent ? 'user' : 'assistant';
    const row = ensureTranscriptRow(event, role);
    const isFinal = event.type.endsWith('.completed') || event.type.endsWith('.done');
    if (isFinal) {
      row.value = String(event.transcript || row.value).trim();
      row.final = true;
      row.row.classList.remove('partial');
      row.row.classList.add('final');
    } else {
      row.value += String(event.delta || '');
    }
    row.text.textContent = row.value || '…';
    state.elements.transcript.scrollTop = state.elements.transcript.scrollHeight;
  }

  function markInterrupted(responseId) {
    if (!responseId) return;
    for (const row of state.rows.values()) {
      if (row.responseId !== responseId || row.final) continue;
      row.row.classList.remove('partial');
      row.row.classList.add('interrupted');
      row.text.textContent = row.value ? `${row.value} · 중단됨` : '응답 중단됨';
    }
  }

  function handleServerEvent(event) {
    if (!event || typeof event.type !== 'string') return;
    if (TRANSCRIPT_EVENT_TYPES.has(event.type)) {
      updateTranscript(event);
      if (event.type.startsWith('response.') && event.type.endsWith('.delta')) {
        setPhase('speaking');
      }
      return;
    }

    if (event.type === 'input_audio_buffer.speech_started') {
      setPhase('listening');
      return;
    }
    if (event.type === 'input_audio_buffer.speech_stopped') {
      setPhase('thinking');
      return;
    }
    if (event.type === 'response.created' || event.type === 'response.output_item.added') {
      setPhase('thinking');
      return;
    }
    if (event.type === 'response.done') {
      const response = event.response || {};
      if (response.status && response.status !== 'completed') {
        markInterrupted(response.id);
      }
      setPhase('listening');
      return;
    }
    if (event.type === 'error') {
      fail(new Error(event.error?.message || 'Realtime 연결에서 오류가 발생했어.'));
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
