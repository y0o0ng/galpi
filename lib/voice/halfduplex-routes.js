'use strict';

const {
  isPersistableUserTurn,
  readVoiceTranscriptionUpload,
} = require('./transcription');

function registerVoiceHalfDuplexRoutes({ app, voiceTts, voiceTranscriptions }) {
  app.post('/api/voice/session', (_req, res) => {
    if (!voiceTts.available) {
      return res.status(503).json({
        error: '반이중 음성 기능이 비활성화되어 있습니다.',
        code: 'VOICE_HALFDUPLEX_DISABLED',
      });
    }
    const sessionId = voiceTranscriptions.createSession();
    if (!sessionId) {
      return res.status(503).json({
        error: '음성 세션을 만들지 못했습니다.',
        code: 'VOICE_SESSION_UNAVAILABLE',
      });
    }
    return res.set('Cache-Control', 'no-store').json({ sessionId });
  });

  app.post('/api/voice/turns/:turnId/transcribe', async (req, res) => {
    try {
      if (!voiceTts.available) {
        return res.status(503).json({
          error: '반이중 음성 기능이 비활성화되어 있습니다.',
          code: 'VOICE_HALFDUPLEX_DISABLED',
        });
      }
      const upload = await readVoiceTranscriptionUpload(req);
      const result = await voiceTranscriptions.transcribe({
        ...upload,
        turnId: req.params.turnId,
      });
      const confidence = result?.confidence;
      if (confidence) {
        console.log(
          `🎙️ voice-confidence tokens=${confidence.tokens}`
          + ` min=${confidence.min.toFixed(3)}`
          + ` mean=${confidence.mean.toFixed(3)}`
          + ` low=${confidence.low}`
          + ` duration=${result.durationMs ?? 'unknown'}ms`,
        );
      }
      return res
        .set('Cache-Control', 'no-store')
        .json({
          correctedTranscript: result.correctedTranscript,
          durationMs: result.durationMs,
          persistable: isPersistableUserTurn(result.correctedTranscript),
        });
    } catch (error) {
      const status = Number.isInteger(error?.status) ? error.status : 500;
      const code = error?.code || 'REALTIME_TRANSCRIPTION_FAILED';
      const empty = code === 'REALTIME_TRANSCRIPTION_EMPTY'
        ? ` duration=${error?.emptyDurationMs ?? 'unknown'}ms`
          + ` bytes=${error?.emptyAudioBytes ?? 'unknown'}`
          + ` audio=${String(error?.emptyAudioSha256 || 'unknown').slice(0, 16)}`
        : '';
      console.warn(`⚠️ 반이중 전사 실패: ${code}${empty}`);
      return res.status(status).json({ error: '전사를 완료하지 못했습니다.', code });
    }
  });

  app.post('/api/voice/speak/segments', (req, res) => {
    if (!voiceTts.available) {
      return res.status(503).json({
        error: '반이중 음성 기능이 비활성화되어 있습니다.',
        code: 'VOICE_HALFDUPLEX_DISABLED',
      });
    }
    const text = String(req.body?.text || '');
    if (!text.trim()) {
      return res.status(400).json({ error: '읽을 내용이 필요합니다.', code: 'VOICE_TTS_EMPTY_TEXT' });
    }
    return res
      .set('Cache-Control', 'no-store')
      .json(req.body?.continued === true
        ? voiceTts.planContinuedSegments(text)
        : voiceTts.planSpokenSegments(text));
  });

  app.post('/api/voice/speak', async (req, res) => {
    if (!voiceTts.available) {
      return res.status(503).json({
        error: '반이중 음성 기능이 비활성화되어 있습니다.',
        code: 'VOICE_HALFDUPLEX_DISABLED',
      });
    }
    const text = String(req.body?.text || '');
    if (!text.trim()) {
      return res.status(400).json({ error: '읽을 내용이 필요합니다.', code: 'VOICE_TTS_EMPTY_TEXT' });
    }
    try {
      const { spoken, audio } = await voiceTts.speak(text);
      res.set('Cache-Control', 'no-store');
      res.set('Content-Type', 'audio/wav');
      res.set('X-Galpi-Spoken-Chars', String(spoken.length));
      return res.send(audio);
    } catch (error) {
      const status = Number.isInteger(error?.status) ? error.status : 500;
      console.warn(`⚠️ 음성 출력 실패: ${error?.code || 'VOICE_TTS_FAILED'}`);
      if (!res.headersSent) {
        return res.status(status).json({
          error: '음성을 만들지 못했습니다.',
          code: error?.code || 'VOICE_TTS_FAILED',
        });
      }
      return res.end();
    }
  });
}

module.exports = { registerVoiceHalfDuplexRoutes };
