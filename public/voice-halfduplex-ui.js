'use strict';

// 반이중 음성 최소 패널. 상태 기계는 voice-halfduplex.js가 갖고 여기는 DOM만 붙인다.
(function setupVoiceHalfDuplexUi(global) {
  const PHASE_LABELS = {
    idle: '대화 준비',
    listening: '듣고 있어',
    capturing: '말하는 중',
    transcribing: '받아적는 중',
    thinking: '생각 중',
    speaking: '말하는 중이야',
    cooldown: '잠깐만',
    recovering: '다시 들을게',
  };

  function setupModule() {
    const elements = {};
    let core = null;
    let showToast = () => {};

    function el(id) {
      if (!(id in elements)) elements[id] = global.document.getElementById(id);
      return elements[id];
    }

    function appendRow(role, text) {
      const log = el('voice-hd-log');
      if (!log || !text) return;
      const row = global.document.createElement('div');
      row.className = `voice-hd-row voice-hd-${role}`;
      row.textContent = text;
      log.appendChild(row);
      log.scrollTop = log.scrollHeight;
    }

    function renderPhase(phase) {
      const status = el('voice-hd-status');
      if (status) status.textContent = PHASE_LABELS[phase] || phase;
      const dot = el('voice-hd-dot');
      if (dot) dot.dataset.phase = phase;
      const button = el('voice-hd-button');
      if (button) {
        const active = phase !== 'idle';
        button.setAttribute('aria-pressed', active ? 'true' : 'false');
        button.setAttribute(
          'aria-label',
          active ? 'XION 음성 대화 종료' : 'XION 음성 대화 시작',
        );
      }
      const panel = el('voice-hd-panel');
      if (panel) panel.hidden = phase === 'idle';
    }

    function init({ config, apiFetch, showToast: toast = () => {} } = {}) {
      showToast = toast;
      core = global.VoiceHalfDuplex;
      const button = el('voice-hd-button');
      if (!core || !config?.halfDuplexEnabled) {
        if (button) button.hidden = true;
        return;
      }

      core.init({
        config,
        apiFetch,
        showToast,
        onPhase: renderPhase,
        onTranscript: text => appendRow('user', text),
        onAnswer: text => appendRow('assistant', text),
      });

      if (button) {
        button.hidden = false;
        button.addEventListener('click', () => {
          if (core.getState().active) core.stop();
          else void core.start();
        });
      }
      const stop = el('voice-hd-stop');
      if (stop) stop.addEventListener('click', () => core.stop());
      renderPhase('idle');
    }

    return { PHASE_LABELS, init };
  }

  global.VoiceHalfDuplexUi = setupModule();
})(window);
