'use strict';

// Reels 편(설계 v0.2 7장 "2단계 실행")의 DB 정본. 후보 하나에 편 하나이고, 실패하면 같은 행을 attempts만 올려 다시 쓴다.
// 상태: producing → ready | failed, failed → producing(재시도), ready → approved | discarded.
// 한 번에 하나만 돈다 — producing 행이 있으면 새로 잡지 않는다.

const MAX_ATTEMPTS = 3;
const RETRY_GAP_SECONDS = 60 * 60;
// 단계 순서(production.js의 order와 같다). 재시도는 처음으로 ok/kept가 아닌 단계부터다.
const STAGES = ['script', 'review', 'build', 'visual', 'fix'];

function reelsError(message, code) {
  return Object.assign(new Error(message), { code });
}

function resumeStage(recordJson) {
  try {
    const stage = JSON.parse(recordJson)?.stages?.find(s => s.result !== 'ok' && s.result !== 'kept')?.stage;
    return STAGES.includes(stage) ? stage : 'script';
  } catch {
    return 'script';
  }
}

function createReelsEpisodes(db, options = {}) {
  if (!db?.prepare || typeof db.transaction !== 'function') throw new TypeError('SQLite DB 연결이 필요합니다.');
  const clock = typeof options.now === 'function' ? options.now : () => Math.floor(Date.now() / 1000);

  const hasProducing = db.prepare("SELECT 1 FROM reels_episodes WHERE status = 'producing'");
  const newestSelected = db.prepare(`
    SELECT * FROM reels_candidates c
    WHERE c.status = 'selected' AND NOT EXISTS (SELECT 1 FROM reels_episodes e WHERE e.candidate_id = c.id)
    ORDER BY c.id DESC LIMIT 1
  `);
  const insertEpisode = db.prepare(`
    INSERT INTO reels_episodes (candidate_id, episode_dir, work_dir, created_at) VALUES (?, ?, ?, ?)
  `);
  const oldestRetry = db.prepare(`
    SELECT e.* FROM reels_episodes e
    WHERE e.status = 'failed' AND e.attempts < ${MAX_ATTEMPTS} AND e.finished_at <= @cutoff
    ORDER BY e.finished_at, e.id LIMIT 1
  `);
  const startRetry = db.prepare(`
    UPDATE reels_episodes SET status = 'producing', attempts = attempts + 1, finished_at = NULL
    WHERE id = ? AND status = 'failed'
  `);
  const getCandidate = db.prepare('SELECT * FROM reels_candidates WHERE id = ?');
  const getEpisode = db.prepare('SELECT * FROM reels_episodes WHERE id = ?');
  const usedDirs = db.prepare('SELECT episode_dir FROM reels_episodes');
  const finishOkRow = db.prepare(`
    UPDATE reels_episodes
    SET status = 'ready', error_code = NULL, error_detail = NULL, record_json = @record, claims_json = @claims,
        caption = @caption, video_path = @video, cover_path = @cover, finished_at = @now
    WHERE id = @id AND status = 'producing'
  `);
  const finishFailedRow = db.prepare(`
    UPDATE reels_episodes
    SET status = 'failed', error_code = @code, error_detail = @detail, record_json = COALESCE(@record, record_json), finished_at = @now
    WHERE id = @id AND status = 'producing'
  `);
  const producingRows = db.prepare("SELECT id, work_dir FROM reels_episodes WHERE status = 'producing'");
  const decideRow = db.prepare(`
    UPDATE reels_episodes SET status = @status, decided_at = @now WHERE id = @id AND status = 'ready'
  `);
  const latest = db.prepare(`
    SELECT e.*, c.title, c.concept FROM reels_episodes e JOIN reels_candidates c ON c.id = e.candidate_id
    ORDER BY e.id DESC LIMIT 1
  `);
  const byId = db.prepare(`
    SELECT e.*, c.title, c.concept FROM reels_episodes e JOIN reels_candidates c ON c.id = e.candidate_id WHERE e.id = ?
  `);

  const claimTx = db.transaction((now, planDirs) => {
    if (hasProducing.get()) return null;
    const card = newestSelected.get();
    if (card) {
      const { episodeDir, workDir } = planDirs(card, usedDirs.all().map(row => row.episode_dir));
      const { lastInsertRowid } = insertEpisode.run(card.id, episodeDir, workDir, now);
      return { episode: getEpisode.get(lastInsertRowid), card, from: 'script' };
    }
    const retry = oldestRetry.get({ cutoff: now - RETRY_GAP_SECONDS });
    if (!retry || startRetry.run(retry.id).changes !== 1) return null;
    return { episode: getEpisode.get(retry.id), card: getCandidate.get(retry.candidate_id), from: resumeStage(retry.record_json) };
  });

  const decideTx = db.transaction((id, status) => {
    if (!getEpisode.get(id)) throw reelsError('편을 찾을 수 없습니다.', 'REELS_NOT_FOUND');
    if (decideRow.run({ id, status, now: clock() }).changes !== 1) {
      throw reelsError('검토할 수 있는 편이 아닙니다.', 'REELS_NOT_PENDING');
    }
    return { id, status };
  });

  return {
    /** producing이 없을 때 하나만 잡는다. planDirs(card, 이미 쓴 폴더들) → { episodeDir, workDir }는 새 편에만 불린다. */
    claimProduction: (planDirs, nowValue) => claimTx(Math.floor(nowValue ?? clock()), planDirs),
    finishOk: (id, { record, claims, caption, videoPath, coverPath }) => finishOkRow.run({
      id, record: JSON.stringify(record), claims: claims == null ? null : JSON.stringify(claims),
      caption, video: videoPath, cover: coverPath, now: clock(),
    }).changes === 1,
    finishFailed: (id, code, detail, record) => finishFailedRow.run({
      id, code: String(code || 'REELS_FAILED').slice(0, 80), detail: detail ? String(detail).slice(0, 200) : null,
      record: record ? JSON.stringify(record) : null, now: clock(),
    }).changes === 1,
    /**
     * 기동 때 producing으로 남은 편(서버가 꺼지며 끊긴 것)을 failed로 바꾼다. 쓴 시도는 돌려주지 않는다 —
     * 재시작이 반복돼도 3번을 넘기지 않는다. readRecord(workDir)가 있으면 작업 폴더의 production.json으로
     * 끊긴 단계를 남겨 재시도가 그 단계부터 돈다.
     */
    markInterrupted(readRecord = () => null) {
      const rows = producingRows.all();
      for (const row of rows) this.finishFailed(row.id, 'REELS_INTERRUPTED', '서버가 꺼져 제작이 중단됐습니다.', readRecord(row.work_dir));
      return rows.length;
    },
    getEpisode: id => byId.get(id) || null,
    latestEpisode: () => latest.get() || null,
    decide: (id, status) => decideTx(id, status),
  };
}

module.exports = { MAX_ATTEMPTS, RETRY_GAP_SECONDS, createReelsEpisodes, resumeStage };
