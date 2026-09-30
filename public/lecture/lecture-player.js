'use strict';

// 강의 노트 L2 재생 엔진(설계 §12.2). 서버가 준 Document 스트림의 재생 구간(span)을 Session 순서대로 잇고,
// `다른 자료`·`녹음 없음` 경계는 건너뛴다. 커서는 Session 시각(session_t_ms)이다 — 필기 농도·역점프·복습 앵커가
// 모두 이 값을 쓴다. 오디오는 파트 파일을 인증 헤더로 받아 blob으로 재생한다(현재·다음 파트만 붙잡아 둔다).
(function (global) {
  const TICK_MS = 200;

  function create({ onChange }) {
    const audio = new Audio();
    audio.preload = 'auto';
    const blobs = new Map(); // partKey → Promise<objectURL>
    const state = { sessions: [], sessionIndex: -1, t: 0, playing: false, loading: false, error: '' };
    let span = null;
    let timer = null;
    let sourceKey = null;

    const emit = () => onChange({ ...state, session: state.sessions[state.sessionIndex] || null });
    const spansOf = session => session.items.filter(item => item.type === 'span');

    function blobFor(session, part) {
      if (!blobs.has(part.partKey)) {
        blobs.set(part.partKey, global.apiFetch(`/api/lecture/sessions/${session.id}/parts/${part.partKey}/audio`)
          .then(res => { if (!res.ok) throw new Error('녹음을 불러오지 못했어.'); return res.blob(); })
          .then(blob => URL.createObjectURL(blob))
          .catch(error => { blobs.delete(part.partKey); throw error; }));
      }
      return blobs.get(part.partKey);
    }

    // 지금 파트와 다음 파트만 남기고 나머지 blob은 놓는다(파트 하나가 수십 MB일 수 있다).
    function trimBlobs(keep) {
      [...blobs.keys()].forEach(key => {
        if (keep.includes(key)) return;
        blobs.get(key).then(url => URL.revokeObjectURL(url)).catch(() => {});
        blobs.delete(key);
      });
    }

    // t 이후의 첫 재생 구간. 경계 안이면 다음 구간 시작으로 간다.
    function locate(sessionIndex, t) {
      for (let index = sessionIndex; index < state.sessions.length; index += 1) {
        const found = spansOf(state.sessions[index]).find(item => index > sessionIndex || t < item.end);
        if (found) return { sessionIndex: index, span: found, t: index > sessionIndex ? found.start : Math.max(t, found.start) };
      }
      return null;
    }

    function nextSpanAfter(sessionIndex, current) {
      const spans = spansOf(state.sessions[sessionIndex]);
      const next = spans[spans.indexOf(current) + 1];
      return next ? { sessionIndex, span: next, t: next.start } : locate(sessionIndex + 1, 0);
    }

    async function prepare() {
      const session = state.sessions[state.sessionIndex];
      if (!session || !span) return null;
      const upcoming = nextSpanAfter(state.sessionIndex, span);
      trimBlobs([span.partKey, upcoming?.span.partKey].filter(Boolean));
      const url = await blobFor(session, span);
      if (upcoming && upcoming.span.partKey !== span.partKey) blobFor(state.sessions[upcoming.sessionIndex], upcoming.span).catch(() => {});
      return url;
    }

    async function startAudio() {
      state.loading = true;
      emit();
      try {
        const url = await prepare();
        if (!url || !state.playing) return;
        if (sourceKey !== span.partKey) {
          audio.src = url;
          sourceKey = span.partKey;
        }
        audio.currentTime = (span.audioStart + (state.t - span.start)) / 1000;
        await audio.play();
        state.error = '';
      } catch (error) {
        state.playing = false;
        state.error = error.name === 'NotAllowedError' ? '재생을 한 번 더 눌러줘.' : (error.message || '재생하지 못했어.');
      } finally {
        state.loading = false;
        emit();
      }
    }

    function tick() {
      if (!state.playing || !span || state.loading || audio.paused) return;
      const t = span.start + (audio.currentTime * 1000 - span.audioStart);
      if (t < span.end) {
        state.t = Math.round(t);
        emit();
        return;
      }
      // 구간 끝: 경계를 건너 다음 재생 구간으로 간다. Session이 끝나면 다음 Session으로 이어진다.
      const next = nextSpanAfter(state.sessionIndex, span);
      if (!next) {
        state.playing = false;
        state.t = span.end;
        audio.pause();
        emit();
        return;
      }
      state.sessionIndex = next.sessionIndex;
      span = next.span;
      state.t = next.t;
      if (sourceKey === span.partKey) audio.currentTime = (span.audioStart + (state.t - span.start)) / 1000;
      else startAudio();
      emit();
    }

    audio.addEventListener('ended', tick);
    audio.addEventListener('error', () => {
      if (!audio.src) return;
      state.playing = false;
      state.error = '녹음을 재생하지 못했어.';
      emit();
    });

    return {
      load(sessions) {
        state.sessions = sessions;
        const found = locate(0, 0);
        state.sessionIndex = found ? found.sessionIndex : -1;
        span = found?.span || null;
        state.t = found?.t || 0;
        emit();
      },
      state: () => ({ ...state, session: state.sessions[state.sessionIndex] || null }),
      // 역점프·목록·재생 바가 부른다. 경계 안의 시각이면 다음 재생 구간 시작으로 옮긴다.
      seek(sessionId, t) {
        const index = state.sessions.findIndex(session => session.id === sessionId);
        const found = index >= 0 ? locate(index, t) : null;
        if (!found || found.sessionIndex !== index) return false;
        state.sessionIndex = found.sessionIndex;
        span = found.span;
        state.t = found.t;
        if (state.playing) startAudio();
        else prepare().catch(() => {});
        emit();
        return true;
      },
      toggle() {
        if (!span) return;
        if (state.playing) {
          state.playing = false;
          audio.pause();
          emit();
          return;
        }
        state.playing = true;
        clearInterval(timer);
        timer = setInterval(tick, TICK_MS);
        startAudio();
      },
      preload() { prepare().catch(() => {}); },
      destroy() {
        clearInterval(timer);
        audio.pause();
        audio.removeAttribute('src');
        trimBlobs([]);
      },
    };
  }

  global.LecturePlayer = { create };
})(window);
