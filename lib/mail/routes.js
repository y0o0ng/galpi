'use strict';

// 에이전트 탭 / 알림 탭 / 대화가 필요한 최소 API. MAIL-2에서는 운영 상태와 좌초 복구
// 둘뿐이고 Attention 조회·preference feedback은 뒤 단계에서 이 파일에 붙는다.

function registerMailRoutes({ app, store, config, onRequeued, bodyReader = null }) {
  if (!app?.get) throw new TypeError('Express app이 필요합니다.');
  if (!store?.listAccounts) throw new TypeError('Mail store가 필요합니다.');
  if (!config || typeof config !== 'object') throw new TypeError('Mail 설정이 필요합니다.');

  function guard(res) {
    if (config.enabled) return false;
    res.status(503).json({
      error: 'Mail Agent가 아직 활성화되지 않았습니다.',
      code: 'MAIL_AGENT_DISABLED',
    });
    return true;
  }

  app.get('/api/mail/status', (_req, res) => {
    if (guard(res)) return;
    try {
      const accounts = store.listAccounts().map(account => {
        const state = store.getSyncState(account.id) || {};
        return {
          id: account.id,
          provider: account.provider,
          // 주소는 계정 식별에 필요하므로 그대로 준다. 인증된 자기 API다.
          address: account.address,
          status: account.status,
          lastSyncAt: account.lastSyncAt,
          nextSyncAt: account.nextSyncAt,
          lastErrorCode: account.lastErrorCode,
          baselineComplete: state.baselineComplete === 1,
          gmailHistoryId: state.gmailHistoryId || null,
          imapUidValidity: state.imapUidValidity ?? null,
          imapLastUid: state.imapLastUid ?? null,
          messages: store.countMessages(account.id),
        };
      });
      // 좌초한 분석은 개수와 함께 보인다. 열어봐야 고칠 것이 없으므로 사람이 할 수
      // 있는 일은 다시 돌리는 것뿐이고, 그래서 사유 코드까지만 준다(설계 9.2·19절).
      const analysis = store.analysisSummary();
      return res.json({
        success: true,
        enabled: true,
        accounts,
        analysis,
        stranded: store.listStrandedAnalysis().map(item => ({
          id: item.id,
          accountId: item.accountId,
          attemptCount: item.attemptCount,
          lastError: item.lastError,
          receivedAt: item.receivedAt,
        })),
      });
    } catch (error) {
      // 제목·발신자는 로그에 남기지 않는다(설계 19절).
      console.error(`Mail 상태 조회 오류: ${error?.code || error?.name || 'UNKNOWN'}`);
      return res.status(500).json({
        error: 'Mail 상태를 불러오지 못했습니다.',
        code: 'MAIL_STATUS_FAILED',
      });
    }
  });

  // `대기열 다시 처리`. failed를 pending으로 되돌리고 worker를 깨운다 — 다음 주기를
  // 기다리게 하면 눌러놓고 아무 일도 안 일어나서 고쳐진 건지 알 수 없다.
  app.post('/api/mail/analysis/requeue', (_req, res) => {
    if (guard(res)) return;
    try {
      const requeued = store.requeueFailedAnalysis();
      if (requeued > 0 && typeof onRequeued === 'function') onRequeued();
      return res.json({ success: true, requeued, analysis: store.analysisSummary() });
    } catch (error) {
      console.error(`Mail 대기열 복구 오류: ${error?.code || error?.name || 'UNKNOWN'}`);
      return res.status(500).json({
        error: '분석 대기열을 되돌리지 못했습니다.',
        code: 'MAIL_REQUEUE_FAILED',
      });
    }
  });
  // 사용자가 만지는 알림 설정은 둘뿐이다. 미리보기 설정은 없앴다(설계 13.1).
  app.get('/api/mail/settings', (_req, res) => {
    if (guard(res)) return;
    return res.json({ success: true, settings: store.getMailSettings() });
  });

  app.put('/api/mail/settings', (req, res) => {
    if (guard(res)) return;
    try {
      return res.json({ success: true, settings: store.saveMailSettings(req.body || {}) });
    } catch (error) {
      if (error?.code === 'MAIL_INVALID_SETTING') {
        return res.status(400).json({ error: error.message, code: error.code });
      }
      console.error(`Mail 설정 저장 오류: ${error?.code || error?.name || 'UNKNOWN'}`);
      return res.status(500).json({ error: '설정을 저장하지 못했습니다.', code: 'MAIL_SETTINGS_FAILED' });
    }
  });

  // 알림 선호(설계 8.5·11). 규칙 편집기를 사용자에게 관리시키지 않으므로 만들기는
  // 알림 카드의 좁은 한 동작이고, 여기서는 그것을 보고 지우는 것만 맡는다.
  app.get('/api/mail/preferences', (_req, res) => {
    if (guard(res)) return;
    return res.json({ success: true, preferences: store.listPreferences() });
  });

  app.post('/api/mail/preferences', (req, res) => {
    if (guard(res)) return;
    try {
      const result = store.addPreference(req.body || {});
      return res.status(result.created ? 201 : 200).json({
        success: true, created: result.created, preference: result.preference,
      });
    } catch (error) {
      if (error?.statusCode) {
        return res.status(error.statusCode).json({ error: error.message, code: error.code });
      }
      console.error(`Mail 선호 저장 오류: ${error?.code || error?.name || 'UNKNOWN'}`);
      return res.status(500).json({ error: '선호를 저장하지 못했습니다.', code: 'MAIL_PREFERENCE_FAILED' });
    }
  });

  app.delete('/api/mail/preferences/:id', (req, res) => {
    if (guard(res)) return;
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isSafeInteger(id) || id <= 0) {
      return res.status(400).json({ error: '올바르지 않은 선호 id입니다.', code: 'MAIL_INVALID_PREFERENCE' });
    }
    const result = store.removePreference(id);
    if (!result.removed) {
      return res.status(404).json({ error: '선호를 찾을 수 없습니다.', code: 'MAIL_PREFERENCE_NOT_FOUND' });
    }
    return res.json({ success: true, removed: true });
  });

  /**
   * 카드에서 본문을 여는 자리(설계 10.2·23). 저장된 본문을 꺼내오는 것이 아니라
   * 그때마다 Provider에서 읽는다. 그래서 이 응답은 어디에도 캐시하지 않는다.
   *
   * 본문은 화면까지만 간다. 모델에게 가는 메일은 `mail_search`가 주는 제목·요약뿐이고
   * 본문은 그 경로에 없다(설계 19).
   */
  app.get('/api/mail/messages/:id/body', async (req, res) => {
    if (guard(res)) return;
    if (!bodyReader) {
      return res.status(503).json({ error: '본문을 읽을 수 없습니다.', code: 'MAIL_BODY_UNAVAILABLE' });
    }
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isSafeInteger(id) || id <= 0) {
      return res.status(400).json({ error: '올바르지 않은 메일 id입니다.', code: 'MAIL_INVALID_MESSAGE' });
    }
    try {
      return res.json({ success: true, ...(await bodyReader.read(id)) });
    } catch (error) {
      if (error?.statusCode) {
        return res.status(error.statusCode).json({ error: error.message, code: error.code });
      }
      // 제목·발신자·본문 조각은 로그에 남기지 않는다(설계 19절).
      console.error(`Mail 본문 조회 오류: message=${id} ${error?.code || error?.name || 'UNKNOWN'}`);
      return res.status(502).json({ error: '본문을 읽지 못했습니다.', code: 'MAIL_BODY_FAILED' });
    }
  });

  // 사용자가 Attention에 하는 일은 둘뿐이다 — 처리했거나 미루거나. 아직 안 나간
  // Push는 claim 단계가 자격을 다시 보면서 건너뛰므로 여기서 따로 지우지 않는다.
  function attentionAction(pathname, handler) {
    app.post(pathname, (req, res) => {
      if (guard(res)) return;
      const id = Number.parseInt(req.params.id, 10);
      if (!Number.isSafeInteger(id) || id <= 0) {
        return res.status(400).json({ error: '올바르지 않은 Attention id입니다.', code: 'MAIL_INVALID_ATTENTION' });
      }
      if (!store.findAttentionById(id)) {
        return res.status(404).json({ error: 'Attention을 찾을 수 없습니다.', code: 'MAIL_ATTENTION_NOT_FOUND' });
      }
      try {
        return handler(req, res, id);
      } catch (error) {
        if (error?.statusCode) {
          return res.status(error.statusCode).json({ error: error.message, code: error.code });
        }
        console.error(`Mail Attention 처리 오류: ${error?.code || error?.name || 'UNKNOWN'}`);
        return res.status(500).json({ error: 'Attention을 갱신하지 못했습니다.', code: 'MAIL_ATTENTION_FAILED' });
      }
    });
  }

  // 두 번 눌러도 오류가 아니다. 이미 끝난 것은 끝난 것이고 해결 시각을 덮지 않는다.
  attentionAction('/api/mail/attention/:id/done', (_req, res, id) => {
    const result = store.resolveAttention(id);
    return res.json({ success: true, changed: result.changed, state: result.state });
  });

  attentionAction('/api/mail/attention/:id/snooze', (req, res, id) => {
    const until = Number(req.body?.until);
    const result = store.snoozeAttention(id, Number.isSafeInteger(until) ? until : null);
    // 이미 완료한 것을 미루려는 것은 화면과 서버가 어긋났다는 뜻이라 알려준다.
    if (!result.changed && result.state !== 'snoozed') {
      return res.status(409).json({
        error: `지금 상태에서는 미룰 수 없습니다: ${result.state}`,
        code: 'MAIL_ATTENTION_NOT_SNOOZABLE',
        state: result.state,
      });
    }
    return res.json({ success: true, changed: result.changed, state: result.state, snoozedUntil: result.snoozedUntil });
  });
}

module.exports = { registerMailRoutes };
