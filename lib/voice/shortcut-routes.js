'use strict';

const rateLimit = require('express-rate-limit');

const { VoiceShortcutError } = require('./shortcut');

function bearerToken(req) {
  const header = String(req.get('Authorization') || '');
  const match = header.match(/^Bearer\s+([^\s]+)$/i);
  return match ? match[1] : '';
}

function createCredentialLock() {
  const tails = new Map();
  return async function withCredentialLock(credentialId, task) {
    const key = String(credentialId);
    const previous = tails.get(key) || Promise.resolve();
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const tail = previous.then(() => gate);
    tails.set(key, tail);
    await previous;
    try {
      return await task();
    } finally {
      release();
      if (tails.get(key) === tail) tails.delete(key);
    }
  };
}

function createVoiceShortcutRoutes({ app, service, runTurn }) {
  if (!app?.post || !app?.delete) throw new TypeError('Express app이 필요합니다.');
  if (!service?.authenticate || !service?.claimRequest) {
    throw new TypeError('단축어 service가 필요합니다.');
  }
  if (typeof runTurn !== 'function') throw new TypeError('단축어 턴 실행기가 필요합니다.');

  const withCredentialLock = createCredentialLock();
  const turnLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 10,
    keyGenerator(req) {
      const address = rateLimit.ipKeyGenerator(req.socket?.remoteAddress || '127.0.0.1');
      return `${req.voiceShortcutCredential.id}:${address}`;
    },
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      error: '음성 요청이 너무 많습니다. 잠시 뒤 다시 시도해주세요.',
      code: 'SHORTCUT_RATE_LIMITED',
    },
  });

  function sendError(res, error) {
    if (error instanceof VoiceShortcutError) {
      return res.status(error.statusCode).json({ error: error.message, code: error.code });
    }
    console.error(`단축어 API 오류: ${error?.code || error?.name || 'UNKNOWN'}`);
    return res.status(500).json({
      error: '음성 요청을 처리하지 못했습니다.',
      code: 'SHORTCUT_SERVER_ERROR',
    });
  }

  function requireJson(req, res, next) {
    if (!req.is('application/json')) {
      return res.status(415).json({
        error: 'Content-Type은 application/json이어야 합니다.',
        code: 'SHORTCUT_JSON_REQUIRED',
      });
    }
    return next();
  }

  function handleTurn(req, res) {
    if (!req.is('application/json')) {
      return res.status(415).json({
        error: 'Content-Type은 application/json이어야 합니다.',
        code: 'SHORTCUT_JSON_REQUIRED',
      });
    }
    let credential;
    try {
      credential = service.authenticate(bearerToken(req));
      req.voiceShortcutCredential = credential;
    } catch (error) {
      return sendError(res, error);
    }

    return turnLimiter(req, res, () => {
      void withCredentialLock(credential.id, async () => {
        const turn = service.normalizeTurnInput(req.body);
        const claim = service.claimRequest(credential.id, turn);
        if (claim.kind === 'replay') {
          return res.json({
            answer: claim.answer,
            conversationId: claim.conversationId,
            canContinue: claim.canContinue,
            messageId: claim.assistantMessageId,
          });
        }

        const payload = await runTurn({ credential, turn, claim });
        return res.json({
          answer: payload.reply,
          conversationId: claim.conversationId,
          canContinue: payload.canContinue,
          messageId: payload.messageId,
        });
      }).catch(error => {
        if (!res.headersSent) sendError(res, error);
      });
    });
  }

  app.post('/api/voice/shortcut/credentials', requireJson, (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const credential = service.issueCredential(req.body);
      return res.status(credential.replaced ? 200 : 201).json(credential);
    } catch (error) {
      return sendError(res, error);
    }
  });

  app.delete('/api/voice/shortcut/credentials/:id', (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      return res.json(service.revokeCredential(req.params.id));
    } catch (error) {
      return sendError(res, error);
    }
  });

  return { handleTurn };
}

module.exports = { createVoiceShortcutRoutes };
