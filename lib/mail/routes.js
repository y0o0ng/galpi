'use strict';

// 에이전트 탭 / 알림 탭 / 대화가 필요한 최소 API. MAIL-2에서는 운영 상태와 좌초 복구
// 둘뿐이고 Attention 조회·preference feedback은 뒤 단계에서 이 파일에 붙는다.

function registerMailRoutes({ app, store, config, onRequeued }) {
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
