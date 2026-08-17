'use strict';

// 에이전트 탭 / 알림 탭 / 대화가 필요한 최소 API. MAIL-1에서는 운영 상태 하나뿐이고
// Attention 조회·preference feedback은 뒤 단계에서 이 파일에 붙는다.

function registerMailRoutes({ app, store, config }) {
  if (!app?.get) throw new TypeError('Express app이 필요합니다.');
  if (!store?.listAccounts) throw new TypeError('Mail store가 필요합니다.');
  if (!config || typeof config !== 'object') throw new TypeError('Mail 설정이 필요합니다.');

  app.get('/api/mail/status', (_req, res) => {
    if (!config.enabled) {
      return res.status(503).json({
        error: 'Mail Agent가 아직 활성화되지 않았습니다.',
        code: 'MAIL_AGENT_DISABLED',
      });
    }
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
      return res.json({ success: true, enabled: true, accounts });
    } catch (error) {
      // 제목·발신자는 로그에 남기지 않는다(설계 19절).
      console.error(`Mail 상태 조회 오류: ${error?.code || error?.name || 'UNKNOWN'}`);
      return res.status(500).json({
        error: 'Mail 상태를 불러오지 못했습니다.',
        code: 'MAIL_STATUS_FAILED',
      });
    }
  });
}

module.exports = { registerMailRoutes };
