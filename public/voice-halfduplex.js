'use strict';

// H1 반이중 음성 루프.
// LISTENING → CAPTURING → TRANSCRIBING → THINKING → SPEAKING → COOLDOWN → LISTENING
// 되묻기·슬롯 검증은 H3, shared-main 저장은 H2에서 연다.
(function setupVoiceHalfDuplex(global) {
  const DEFAULTS = {
    silenceMs: 1200,
    cooldownMs: 500,
    idleMs: 120000,
    maxTurnMs: 120000,
    minSpeechMs: 300,
    transcribeTimeoutMs: 30000,
    answerTimeoutMs: 60000,
    speakTimeoutMs: 30000,
    // 주변 소음을 재서 문턱을 잡는다. 고정값은 조용한 방과 이동 중을 함께 못 다룬다.
    noiseFrames: 12,
    speechFactor: 3.5,
    minRms: 0.006,
  };

  // H1은 shared-main을 건드리지 않는다. H2에서 세션 ID만 바꾼다.
  const SCRATCH_SESSION_ID = 'voice-halfduplex-scratch';

  const STATES = [
    'idle', 'listening', 'capturing', 'transcribing',
    'thinking', 'speaking', 'cooldown', 'recovering',
  ];

  function setupVoiceHalfDuplexModule() {
    const state = {
      phase: 'idle',
      active: false,
      config: null,
      apiFetch: null,
      showToast: () => {},
      onTranscript: () => {},
      onAnswer: () => {},
      onPhase: () => {},
      stream: null,
      recorder: null,
      turnSequence: 0,
      currentTurnId: '',
      noiseSamples: [],
      threshold: 0,
      speechStartedAt: 0,
      lastVoiceAt: 0,
      timers: {},
      audio: null,
      runId: 0,
      pendingTurn: null,
    };

    function now() { return Date.now(); }

    function clearTimer(name) {
      if (state.timers[name]) {
        global.clearTimeout(state.timers[name]);
        state.timers[name] = null;
      }
    }

    function clearAllTimers() {
      for (const name of Object.keys(state.timers)) clearTimer(name);
    }

    function setPhase(phase) {
      if (!STATES.includes(phase) || state.phase === phase) return;
      state.phase = phase;
      state.onPhase(phase);
    }

    // 시온이 생각하거나 말하는 동안에는 마이크 입력을 완전히 막는다.
    function setMicEnabled(enabled) {
      for (const track of state.stream?.getAudioTracks?.() || []) {
        track.enabled = enabled;
      }
    }

    function armIdleTimeout() {
      clearTimer('idle');
      state.timers.idle = global.setTimeout(() => {
        if (state.active) stop('idle');
      }, state.config.idleMs);
    }

    function enterListening() {
      if (!state.active) return;
      state.noiseSamples = [];
      state.threshold = 0;
      state.speechStartedAt = 0;
      state.lastVoiceAt = 0;
      state.currentTurnId = '';
      setMicEnabled(true);
      setPhase('listening');
      armIdleTimeout();
    }

    function enterCooldown() {
      if (!state.active) return;
      setPhase('cooldown');
      clearTimer('cooldown');
      state.timers.cooldown = global.setTimeout(enterListening, state.config.cooldownMs);
    }

    // 어떤 실패도 마이크가 꺼진 채로 멈추게 두지 않는다.
    function recover(reason) {
      if (!state.active) return;
      setPhase('recovering');
      clearAllTimers();
      state.pendingTurn = null;
      state.showToast(reason || '다시 들을게.');
      enterCooldown();
    }

    function handleLevel(rms) {
      if (!state.active) return;
      if (state.phase !== 'listening' && state.phase !== 'capturing') return;

      if (state.threshold === 0) {
        state.noiseSamples.push(rms);
        if (state.noiseSamples.length < state.config.noiseFrames) return;
        const sorted = [...state.noiseSamples].sort((a, b) => a - b);
        const floor = sorted[Math.floor(sorted.length / 2)];
        state.threshold = Math.max(floor * state.config.speechFactor, state.config.minRms);
        return;
      }

      const voiced = rms >= state.threshold;
      if (state.phase === 'listening') {
        if (!voiced) return;
        beginCapture();
        return;
      }

      if (voiced) {
        state.lastVoiceAt = now();
        return;
      }
      if (now() - state.lastVoiceAt >= state.config.silenceMs) endCapture();
    }

    function beginCapture() {
      state.turnSequence += 1;
      state.currentTurnId = `hd-${state.turnSequence}`;
      state.speechStartedAt = now();
      state.lastVoiceAt = now();
      if (!state.recorder.beginTurn(state.currentTurnId)) {
        recover('마이크를 다시 준비할게.');
        return;
      }
      setPhase('capturing');
      clearTimer('idle');
      clearTimer('maxTurn');
      state.timers.maxTurn = global.setTimeout(endCapture, state.config.maxTurnMs);
    }

    function endCapture() {
      if (state.phase !== 'capturing') return;
      clearTimer('maxTurn');
      const spokenMs = now() - state.speechStartedAt;
      const turnId = state.currentTurnId;
      setPhase('transcribing');
      setMicEnabled(false);
      // 발화가 지나치게 짧으면 전사 요청 자체를 아낀다.
      if (spokenMs < state.config.minSpeechMs) {
        state.recorder.endTurn(turnId);
        state.pendingTurn = null;
        enterListening();
        return;
      }
      state.pendingTurn = { turnId, startedAt: now() };
      state.recorder.endTurn(turnId);
      clearTimer('transcribe');
      state.timers.transcribe = global.setTimeout(
        () => recover('잘 못 들었어. 다시 말해줄래?'),
        state.config.transcribeTimeoutMs,
      );
    }

    async function handleTurnReady(turn) {
      if (!state.active || !state.pendingTurn || turn.turnId !== state.pendingTurn.turnId) return;
      clearTimer('transcribe');
      if (turn.errorCode || !turn.blob) {
        recover('잘 못 들었어. 다시 말해줄래?');
        return;
      }
      const runId = state.runId;
      try {
        const form = new global.FormData();
        form.set('session_id', SCRATCH_SESSION_ID);
        form.set('input_item_id', turn.turnId);
        form.set('duration_ms', String(turn.durationMs));
        form.set('audio', turn.blob, `${turn.turnId}.wav`);
        const response = await state.apiFetch(
          `/api/voice/realtime/turns/${encodeURIComponent(turn.turnId)}/transcribe`,
          { method: 'POST', body: form },
        );
        const data = await response.json().catch(() => ({}));
        if (runId !== state.runId) return;
        if (!response.ok) {
          recover(data.code === 'REALTIME_TRANSCRIPTION_EMPTY'
            ? '잘 못 들었어. 다시 말해줄래?'
            : '전사를 못 했어. 다시 말해줄래?');
          return;
        }
        // 폐기 판정은 서버가 한다. 헛기침이면 반응 없이 계속 듣는다.
        if (data.persistable === false) {
          state.pendingTurn = null;
          enterListening();
          return;
        }
        const transcript = String(data.correctedTranscript || '').trim();
        if (!transcript) {
          recover('잘 못 들었어. 다시 말해줄래?');
          return;
        }
        state.onTranscript(transcript);
        await think(transcript, runId);
      } catch (_) {
        if (runId === state.runId) recover('전사를 못 했어. 다시 말해줄래?');
      }
    }

    async function think(transcript, runId) {
      setPhase('thinking');
      clearTimer('answer');
      state.timers.answer = global.setTimeout(
        () => recover('답변이 늦어져서 넘어갈게.'),
        state.config.answerTimeoutMs,
      );
      try {
        const response = await state.apiFetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: transcript,
            model: 'gpt',
            sessionId: SCRATCH_SESSION_ID,
            source: 'voice',
          }),
        });
        const data = await response.json().catch(() => ({}));
        clearTimer('answer');
        if (runId !== state.runId) return;
        if (!response.ok || !data.reply) {
          recover('답변을 못 만들었어.');
          return;
        }
        state.onAnswer(data.reply);
        await speak(data.reply, runId);
      } catch (_) {
        clearTimer('answer');
        if (runId === state.runId) recover('답변을 못 만들었어.');
      }
    }

    async function speak(text, runId) {
      setPhase('speaking');
      setMicEnabled(false);
      clearTimer('speak');
      state.timers.speak = global.setTimeout(
        () => recover('음성 재생이 늦어져서 넘어갈게.'),
        state.config.speakTimeoutMs,
      );
      try {
        const response = await state.apiFetch('/api/voice/speak', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text }),
        });
        if (runId !== state.runId) return;
        if (!response.ok) {
          clearTimer('speak');
          recover('음성을 못 만들었어.');
          return;
        }
        const blob = await response.blob();
        clearTimer('speak');
        if (runId !== state.runId) return;
        await playAudio(blob);
        if (runId !== state.runId) return;
        state.pendingTurn = null;
        enterCooldown();
      } catch (_) {
        clearTimer('speak');
        if (runId === state.runId) recover('음성을 못 만들었어.');
      }
    }

    function playAudio(blob) {
      return new Promise(resolve => {
        let url = '';
        try {
          url = global.URL.createObjectURL(blob);
        } catch (_) {
          resolve();
          return;
        }
        const audio = new global.Audio(url);
        state.audio = audio;
        const finish = () => {
          audio.onended = null;
          audio.onerror = null;
          state.audio = null;
          try { global.URL.revokeObjectURL(url); } catch (_) { /* 이미 해제됨 */ }
          resolve();
        };
        audio.onended = finish;
        audio.onerror = finish;
        const played = audio.play?.();
        if (played?.catch) played.catch(finish);
      });
    }

    async function start() {
      if (state.active) return;
      if (!state.config?.halfDuplexEnabled) {
        state.showToast('반이중 음성이 꺼져 있어.');
        return;
      }
      state.runId += 1;
      state.active = true;
      try {
        state.stream = await global.navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
        state.recorder = global.VoiceTurnRecorder.create({
          stream: state.stream,
          maxDurationMs: state.config.maxTurnMs,
          onLevel: handleLevel,
          onTurnReady: turn => { void handleTurnReady(turn); },
          onError: () => recover('마이크에 문제가 있어.'),
        });
        await state.recorder.start();
      } catch (_) {
        state.active = false;
        releaseMedia();
        state.showToast('마이크를 열지 못했어.');
        setPhase('idle');
        return;
      }
      enterListening();
    }

    function releaseMedia() {
      state.recorder?.stop?.();
      state.recorder = null;
      for (const track of state.stream?.getTracks?.() || []) track.stop?.();
      state.stream = null;
      if (state.audio) {
        state.audio.pause?.();
        state.audio = null;
      }
    }

    function stop(reason) {
      if (!state.active) return;
      state.active = false;
      state.runId += 1;
      clearAllTimers();
      state.pendingTurn = null;
      releaseMedia();
      setPhase('idle');
      if (reason === 'idle') state.showToast('한동안 조용해서 음성을 껐어.');
    }

    function init({
      config,
      apiFetch,
      showToast = () => {},
      onTranscript = () => {},
      onAnswer = () => {},
      onPhase = () => {},
    } = {}) {
      state.config = { ...DEFAULTS, ...(config || {}) };
      state.apiFetch = apiFetch;
      state.showToast = showToast;
      state.onTranscript = onTranscript;
      state.onAnswer = onAnswer;
      state.onPhase = onPhase;
    }

    return {
      DEFAULTS,
      SCRATCH_SESSION_ID,
      init,
      start,
      stop,
      getState: () => ({ phase: state.phase, active: state.active }),
      // 테스트가 실제 오디오 하드웨어 없이 상태 전이를 구동하기 위한 진입점이다.
      __feedLevel: handleLevel,
      __feedTurn: turn => handleTurnReady(turn),
    };
  }

  global.VoiceHalfDuplex = setupVoiceHalfDuplexModule();
})(window);
