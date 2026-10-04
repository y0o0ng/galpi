'use strict';

// Reels 업로드(3단계)의 DB 정본. 편·플랫폼마다 한 행.
// 상태: pending → uploading → done | failed, failed → uploading(1시간 뒤 자동, 최대 3번) 또는 → pending(사용자 retry, 시도 횟수 초기화).
// 플랫폼마다 한 번에 하나만 올린다 — 같은 플랫폼에 uploading 행이 있으면 새로 잡지 않는다. instagram은 자동 재시도 없이 failed로 둔다.

const MAX_ATTEMPTS = 3;
const RETRY_GAP_SECONDS = 60 * 60;

function uploadError(message, code) {
  return Object.assign(new Error(message), { code });
}

function createReelsUploads(db, options = {}) {
  if (!db?.prepare || typeof db.transaction !== 'function') throw new TypeError('SQLite DB 연결이 필요합니다.');
  const clock = typeof options.now === 'function' ? options.now : () => Math.floor(Date.now() / 1000);

  const insert = db.prepare('INSERT OR IGNORE INTO reels_uploads (episode_id, platform, created_at) VALUES (?, ?, ?)');
  const listRows = db.prepare('SELECT * FROM reels_uploads WHERE episode_id = ? ORDER BY id');
  const getRow = db.prepare('SELECT * FROM reels_uploads WHERE episode_id = ? AND platform = ?');
  const busy = db.prepare("SELECT 1 FROM reels_uploads WHERE status = 'uploading' AND (@platform IS NULL OR platform = @platform)");
  const nextRow = db.prepare(`
    SELECT * FROM reels_uploads
    WHERE (status = 'pending' OR (status = 'failed' AND platform != 'instagram' AND attempts < ${MAX_ATTEMPTS} AND finished_at <= @cutoff))
      AND (@episode IS NULL OR episode_id = @episode)
      AND (@platform IS NULL OR platform = @platform)
    ORDER BY (status = 'pending') DESC, id LIMIT 1
  `);
  const start = db.prepare("UPDATE reels_uploads SET status = 'uploading', attempts = attempts + 1, finished_at = NULL WHERE id = ?");
  const finishOkRow = db.prepare(`
    UPDATE reels_uploads SET status = 'done', remote_id = @remote, error_code = NULL, error_detail = NULL, finished_at = @now
    WHERE id = @id AND status = 'uploading'
  `);
  const finishFailedRow = db.prepare(`
    UPDATE reels_uploads SET status = 'failed', error_code = @code, error_detail = @detail, finished_at = @now
    WHERE id = @id AND status = 'uploading'
  `);
  const retryRow = db.prepare("UPDATE reels_uploads SET status = 'pending', attempts = 0 WHERE id = ? AND status = 'failed'");
  const interruptedRows = db.prepare("SELECT id FROM reels_uploads WHERE status = 'uploading'");

  const claimTx = db.transaction((now, episodeId, platform) => {
    if (busy.get({ platform: platform ?? null })) return null;
    const row = nextRow.get({ cutoff: now - RETRY_GAP_SECONDS, episode: episodeId ?? null, platform: platform ?? null });
    if (!row || start.run(row.id).changes !== 1) return null;
    return getRow.get(row.episode_id, row.platform);
  });

  const retryTx = db.transaction((episodeId, platform) => {
    const row = getRow.get(episodeId, platform);
    if (!row) throw uploadError('업로드를 찾을 수 없습니다.', 'REELS_NOT_FOUND');
    if (retryRow.run(row.id).changes !== 1) throw uploadError('다시 시도할 수 있는 업로드가 아닙니다.', 'REELS_NOT_PENDING');
    return { id: episodeId, platform, status: 'pending' };
  });

  const finishFailed = (id, code, detail) => finishFailedRow.run({
    id, code: String(code || 'REELS_UPLOAD_FAILED').slice(0, 80), detail: detail ? String(detail).slice(0, 200) : null, now: clock(),
  }).changes === 1;

  return {
    enqueue: (episodeId, platform) => insert.run(episodeId, platform, clock()).changes === 1,
    list: episodeId => listRows.all(episodeId),
    get: (episodeId, platform) => getRow.get(episodeId, platform) || null,
    /** episodeId를 주면 그 편만(수동 실행용), platform을 주면 그 플랫폼만(uploading 중복도 플랫폼별). instagram은 1시간 자동 재시도가 없다(중복 게시 위험 — 사람이 retry). */
    claim: (episodeId, nowValue, platform) => claimTx(Math.floor(nowValue ?? clock()), episodeId, platform),
    finishOk: (id, remoteId) => finishOkRow.run({ id, remote: String(remoteId), now: clock() }).changes === 1,
    finishFailed,
    retry: (episodeId, platform) => retryTx(episodeId, platform),
    /** 기동 때 uploading으로 남은 것(서버가 꺼지며 끊긴 것)을 failed로. 쓴 시도는 돌려주지 않는다. */
    markInterrupted() {
      const rows = interruptedRows.all();
      for (const row of rows) finishFailed(row.id, 'REELS_INTERRUPTED', '서버가 꺼져 업로드가 중단됐습니다.');
      return rows.length;
    },
  };
}

module.exports = { MAX_ATTEMPTS, RETRY_GAP_SECONDS, createReelsUploads };
