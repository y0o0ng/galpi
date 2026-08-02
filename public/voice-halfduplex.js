'use strict';

// 반이중 음성 루프.
// LISTENING → CAPTURING → TRANSCRIBING → THINKING → SPEAKING → COOLDOWN → LISTENING
// 되묻기·슬롯 검증은 H3에서 연다.
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
    audioWatchdogMs: 2500,
  };

  const STATES = [
    'idle', 'listening', 'capturing', 'transcribing',
    'thinking', 'speaking', 'cooldown', 'recovering',
  ];

  // 확인 카드가 떠 있을 때만 쓰는 좁은 어휘다. 판정을 모델에 맡기면 확인 카드를 둔
  // 이유인 "모델이 틀려도 사람이 막는다"가 사라진다.
  const CONFIRM_WORDS = new Set([
    '등록', '등록해', '등록해줘', '등록해주세요', '등록하자', '등록할게', '등록해도돼',
    '저장', '저장해', '저장해줘', '해줘', '해주세요', '하자',
    '응', '어', '네', '예', '그래', '그래요', '좋아', '좋아요', '맞아', '맞아요',
    '오케이', 'ok', 'okay', '콜',
  ]);
  const CANCEL_WORDS = new Set([
    '취소', '취소해', '취소해줘', '취소해주세요', '취소하자', '취소할게',
    '아니', '아냐', '아니야', '아니요', '아뇨', '됐어', '됐어요', '됐다',
    '하지마', '하지마요', '안해', '안할래', '지워', '지워줘', '삭제',
    '나중에', '나중에할게', '관둬', '등록하지마', '등록안해',
  ]);
  // 어미는 사람마다 달라서 다 적을 수 없다. `등록`·`저장` 뒤에 붙는 꼬리만 허용 목록으로 둔다.
  // 꼬리를 열어두지 않고 목록으로 가두는 이유는 `등록할까`, `등록됐어` 같은 물음이
  // 명령으로 읽히면 안 되기 때문이다.
  const COMMAND_STEMS = ['등록', '저장'];
  const CONFIRM_TAILS = new Set([
    '', '해', '해줘', '해줘요', '해줄래', '해줄래요', '해주라', '해주세요',
    '하자', '할게', '할래', '해도돼', '부탁해', '해줄수있어', '해줄수있을까',
  ]);
  const CANCEL_TAILS = new Set([
    '하지마', '하지마요', '하지말자', '안해', '안할래', '취소', '말자',
  ]);

  // 앞에 붙는 맞장구와 목적어를 떼고 다시 본다. "응 등록해줘"와 "일정 카드 등록해줄래"가
  // 둘 다 걸려야 한다. 긴 것부터 떼려고 길이 내림차순으로 둔다.
  const LEADING_PREFIXES = [
    '응', '어', '네', '예', '그래', '좋아', '아니', '아냐', '아니야',
    '일정카드', '일정', '카드', '그거', '이거', '그', '방금', '아까',
  ].sort((a, b) => b.length - a.length);
  // 명령 자체의 길이 상한. "등록은 나중에 생각해볼게"가 등록으로 읽히면 안 된다.
  const MAX_CONFIRM_LENGTH = 8;
  // 접두어를 떼기 전 조각의 바깥 상한. 이보다 길면 문장이라 아예 보지 않는다.
  const MAX_SEGMENT_LENGTH = 14;

  function normalizeCommand(text) {
    return String(text || '')
      .toLowerCase()
      .replace(/[\p{P}\p{S}\p{Z}\s]/gu, '');
  }

  function classifyWord(word) {
    if (CONFIRM_WORDS.has(word)) return 'confirm';
    if (CANCEL_WORDS.has(word)) return 'cancel';
    for (const stem of COMMAND_STEMS) {
      if (!word.startsWith(stem)) continue;
      const tail = word.slice(stem.length);
      // 부정 어미를 먼저 본다. `등록하지마`가 `등록`으로 읽히면 안 된다.
      if (CANCEL_TAILS.has(tail)) return 'cancel';
      if (CONFIRM_TAILS.has(tail)) return 'confirm';
    }
    return null;
  }

  // "그 카드 등록해줘"처럼 앞에 두 개가 붙기도 한다. 그 이상은 문장으로 본다.
  const MAX_PREFIX_STRIPS = 2;

  function classifySegment(normalized) {
    let text = normalized;
    for (let depth = 0; depth <= MAX_PREFIX_STRIPS; depth += 1) {
      if (text.length <= MAX_CONFIRM_LENGTH) {
        const intent = classifyWord(text);
        if (intent) return intent;
      }
      if (text.length > MAX_SEGMENT_LENGTH) return null;
      const prefix = LEADING_PREFIXES
        .find(candidate => text.length > candidate.length && text.startsWith(candidate));
      if (!prefix) return null;
      text = text.slice(prefix.length);
    }
    return null;
  }

  // 카드 확인 의도를 판정한다. 확신이 없으면 null을 돌려 평소대로 LLM에 보낸다.
  // 안 먹혔다 싶으면 사람은 같은 말을 반복한다. 조각으로 나눠 보고 전부 같은 뜻일 때만 받는다.
  function matchConfirmIntent(transcript) {
    const segments = String(transcript || '')
      .split(/[.!?。！？\n]+/)
      .map(normalizeCommand)
      .filter(Boolean);
    if (!segments.length) return null;

    let agreed = null;
    for (const segment of segments) {
      const intent = classifySegment(segment);
      if (!intent || (agreed && intent !== agreed)) return null;
      agreed = intent;
    }
    return agreed;
  }

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
      pendingConfirmation: () => null,
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
      correctionSessionId: '',
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
      // 재생이 오디오 그래프를 재웠을 수 있으므로 들을 때마다 깨운다.
      void state.recorder?.resume?.();
      armAudioWatchdog();
    }

    // 마이크가 조용히 죽는 것이 이 루프의 최악이다. 다시 들을 때마다 실제로 프레임이
    // 도착하는지 확인하고, 안 오면 침묵으로 두지 않고 복구한다.
    function armAudioWatchdog() {
      clearTimer('audio');
      state.timers.audio = global.setTimeout(() => {
        if (!state.active || state.phase !== 'listening') return;
        void state.recorder?.resume?.();
        state.timers.audio = global.setTimeout(() => {
          if (!state.active || state.phase !== 'listening') return;
          recover('마이크가 멈춰서 다시 열었어.');
        }, state.config.audioWatchdogMs);
      }, state.config.audioWatchdogMs);
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
      // 프레임이 한 번이라도 오면 오디오 그래프가 살아 있다는 뜻이다.
      if (state.timers.audio) clearTimer('audio');
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

    // 반이중은 Realtime 핸드셰이크를 하지 않으므로 전사용 세션을 직접 받는다.
    async function ensureCorrectionSession() {
      if (state.correctionSessionId) return state.correctionSessionId;
      const response = await state.apiFetch('/api/voice/session', { method: 'POST' });
      if (!response.ok) return '';
      const data = await response.json().catch(() => ({}));
      state.correctionSessionId = String(data.sessionId || '');
      return state.correctionSessionId;
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
        const sessionId = await ensureCorrectionSession();
        if (runId !== state.runId) return;
        if (!sessionId) {
          recover('음성 세션을 열지 못했어.');
          return;
        }
        const form = new global.FormData();
        form.set('session_id', sessionId);
        form.set('input_item_id', turn.turnId);
        form.set('duration_ms', String(turn.durationMs));
        form.set('audio', turn.blob, `${turn.turnId}.wav`);
        const response = await state.apiFetch(
          `/api/voice/turns/${encodeURIComponent(turn.turnId)}/transcribe`,
          { method: 'POST', body: form },
        );
        const data = await response.json().catch(() => ({}));
        if (runId !== state.runId) return;
        if (!response.ok) {
          // 세션이 만료됐으면 버리고 다음 턴에 새로 받는다.
          if (data.code === 'REALTIME_TRANSCRIPTION_SESSION_EXPIRED') {
            state.correctionSessionId = '';
            recover('다시 말해줄래?');
            return;
          }
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

    async function runCardIntent(pending, intent, runId) {
      setPhase('thinking');
      try {
        if (intent === 'confirm') await pending.confirm();
        else pending.cancel();
      } catch (_) {
        if (runId === state.runId) recover('일정을 등록하지 못했어. 화면에서 눌러줄래?');
        return;
      }
      if (runId !== state.runId) return;
      await speak(intent === 'confirm' ? '일정 등록했어.' : '등록하지 않을게.', runId);
    }

    async function think(transcript, runId) {
      // 확인 카드가 떠 있으면 좁은 어휘를 먼저 본다. 모델 호출도 저장도 하지 않는다.
      const pending = state.pendingConfirmation?.();
      if (pending) {
        const intent = matchConfirmIntent(transcript);
        if (intent) {
          await runCardIntent(pending, intent, runId);
          return;
        }
        // 다른 얘기로 넘어가면 카드는 그 자리에서 취소한다. 일정을 부탁해 놓고 한참
        // 뒤에 다시 볼 이유가 없고, 남겨두면 묵은 카드가 쌓이거나 늦은 "응"에 걸린다.
        pending.cancel();
      }

      setPhase('thinking');
      clearTimer('answer');
      state.timers.answer = global.setTimeout(
        () => recover('답변이 늦어져서 넘어갈게.'),
        state.config.answerTimeoutMs,
      );
      try {
        const result = await state.askAssistant(transcript);
        clearTimer('answer');
        if (runId !== state.runId) return;
        if (!result?.ok) {
          // 텍스트 답변이 진행 중이면 음성 턴은 거절된다. 실패와 구분해서 알려준다.
          recover(result?.reason === 'busy'
            ? '다른 답변을 만들고 있어. 끝나면 다시 말해줄래?'
            : '답변을 못 만들었어.');
          return;
        }
        const reply = String(result.reply || '').trim();
        if (!reply) {
          recover('답변을 못 만들었어.');
          return;
        }
        state.onAnswer(reply);
        await speak(reply, runId);
      } catch (_) {
        clearTimer('answer');
        if (runId === state.runId) recover('답변을 못 만들었어.');
      }
    }

    // 조각 하나의 오디오를 받는다. 미리 받아두는 호출이라 던지지 않고 null을 돌린다.
    // 던지면 아직 기다리지 않은 prefetch가 unhandled rejection이 된다.
    async function fetchSegmentAudio(segment) {
      try {
        const response = await state.apiFetch('/api/voice/speak', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: segment }),
        });
        if (!response.ok) return null;
        return await response.blob();
      } catch (_) {
        return null;
      }
    }

    // 기다리는 동안에만 시계를 건다. 재생 자체는 길 수 있으므로 묶지 않는다.
    async function awaitSegmentAudio(pending) {
      clearTimer('speak');
      state.timers.speak = global.setTimeout(
        () => recover('음성 재생이 늦어져서 넘어갈게.'),
        state.config.speakTimeoutMs,
      );
      try {
        return await pending;
      } finally {
        clearTimer('speak');
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
        const response = await state.apiFetch('/api/voice/speak/segments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text }),
        });
        clearTimer('speak');
        if (runId !== state.runId) return;
        const data = response.ok ? await response.json().catch(() => ({})) : {};
        const segments = Array.isArray(data.segments)
          ? data.segments.filter(segment => typeof segment === 'string' && segment.trim())
          : [];
        if (!segments.length) {
          recover('음성을 못 만들었어.');
          return;
        }

        // 지금 조각을 재생하는 동안 다음 조각을 미리 받는다. 합성 대기가 재생에 가려진다.
        let pending = fetchSegmentAudio(segments[0]);
        for (let index = 0; index < segments.length; index += 1) {
          const blob = await awaitSegmentAudio(pending);
          if (runId !== state.runId) return;
          if (!blob) {
            recover('음성을 못 만들었어.');
            return;
          }
          pending = index + 1 < segments.length
            ? fetchSegmentAudio(segments[index + 1])
            : null;
          await playAudio(blob);
          if (runId !== state.runId) return;
        }
        state.pendingTurn = null;
        enterCooldown();
      } catch (_) {
        clearTimer('speak');
        if (runId === state.runId) recover('음성을 못 만들었어.');
      }
    }

    // iOS는 사용자 제스처 밖에서 시작한 재생을 막는다. 답변 음성은 버튼을 누른 뒤 몇 초 지나
    // 도착하므로, 제스처가 살아 있는 동안 요소를 열어 무음으로 잠금을 풀고 계속 재사용한다.
    function primeAudioPlayback() {
      if (state.audio) return;
      try {
        const player = new global.Audio();
        player.playsInline = true;
        state.audio = player;
        const silent = global.VoiceTurnRecorder.encodePcmWav(new global.Float32Array(8), 8000);
        player.src = global.URL.createObjectURL(new global.Blob([silent], { type: 'audio/wav' }));
        const played = player.play?.();
        if (played?.catch) played.catch(() => {});
      } catch (_) {
        // 잠금 해제 실패는 치명적이지 않다. 실제 재생 시점에 다시 시도한다.
      }
    }

    function playAudio(blob) {
      return new Promise(resolve => {
        const player = state.audio;
        if (!player) {
          resolve();
          return;
        }
        let url = '';
        try {
          url = global.URL.createObjectURL(blob);
        } catch (_) {
          resolve();
          return;
        }
        const finish = () => {
          player.onended = null;
          player.onerror = null;
          try { global.URL.revokeObjectURL(url); } catch (_) { /* 이미 해제됨 */ }
          resolve();
        };
        player.onended = finish;
        player.onerror = finish;
        player.src = url;
        const played = player.play?.();
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
      state.correctionSessionId = '';
      // 어떤 await보다 먼저 해야 제스처 컨텍스트가 살아 있다.
      primeAudioPlayback();
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
        state.audio.onended = null;
        state.audio.onerror = null;
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
      askAssistant = async () => ({ ok: false, reason: 'error' }),
      pendingConfirmation = () => null,
    } = {}) {
      state.config = { ...DEFAULTS, ...(config || {}) };
      state.apiFetch = apiFetch;
      state.askAssistant = askAssistant;
      state.pendingConfirmation = pendingConfirmation;
      state.showToast = showToast;
      state.onTranscript = onTranscript;
      state.onAnswer = onAnswer;
      state.onPhase = onPhase;
    }

    return {
      DEFAULTS,
      matchConfirmIntent,
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
