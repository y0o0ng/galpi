'use strict';

// Reels 편(설계 v0.2 7장 "2단계 실행")의 DB 정본. 후보 하나에 편 하나이고, 실패하면 같은 행을 attempts만 올려 다시 쓴다.
// 상태: producing → ready | failed, failed → producing(재시도), ready → approved | discarded.
// 수정(검토 2 사람 의견): ready → producing(+revision_note) → ready. API는 이를 'revising'으로 보여 준다.
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
  const producingRows = db.prepare("SELECT id, work_dir, revision_note FROM reels_episodes WHERE status = 'producing'");
  const finishRevisionRow = db.prepare(`
    UPDATE reels_episodes
    SET status = 'ready', revision_note = NULL, revisions_json = @revisions, finished_at = @now,
        record_json = COALESCE(@record, record_json), claims_json = COALESCE(@claims, claims_json),
        caption = COALESCE(@caption, caption), video_path = COALESCE(@video, video_path), cover_path = COALESCE(@cover, cover_path)
    WHERE id = @id AND status = 'producing' AND revision_note IS NOT NULL
  `);
  const requestRevisionRow = db.prepare(`
    UPDATE reels_episodes SET status = 'producing', revision_note = ? WHERE id = ? AND status = 'ready'
  `);
  const revisingRow = db.prepare("SELECT * FROM reels_episodes WHERE status = 'producing' AND revision_note IS NOT NULL ORDER BY id LIMIT 1");
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

  const parseList = text => { try { return JSON.parse(text) || []; } catch { return []; } };

  const reviseTx = db.transaction((id, note) => {
    const text = typeof note === 'string' ? note.trim() : '';
    if (!text || text.length > 1000) throw reelsError('의견은 1~1000자여야 합니다.', 'REELS_NOTE_INVALID');
    const row = getEpisode.get(id);
    if (!row) throw reelsError('편을 찾을 수 없습니다.', 'REELS_NOT_FOUND');
    if (row.status !== 'ready') throw reelsError('검토할 수 있는 편이 아닙니다.', 'REELS_NOT_PENDING');
    if (hasProducing.get()) throw reelsError('다른 편을 만드는 중입니다.', 'REELS_BUSY');
    requestRevisionRow.run(text, id);
    return { id, status: 'revising' };
  });

  const finishRevisionTx = db.transaction((id, { outcome, code, detail, record, claims, caption, videoPath, coverPath }) => {
    const row = getEpisode.get(id);
    if (!row || row.status !== 'producing' || row.revision_note == null) return false;
    const ok = outcome === 'ok';
    const entry = { at: clock(), note: row.revision_note, outcome: ok ? 'ok' : 'failed' };
    if (!ok) {
      entry.errorCode = String(code || 'REELS_FAILED').slice(0, 80);
      if (detail) entry.errorDetail = String(detail).slice(0, 200);
    }
    return finishRevisionRow.run({
      id, now: clock(), revisions: JSON.stringify([...parseList(row.revisions_json), entry]),
      record: ok && record ? JSON.stringify(record) : null, claims: ok && claims != null ? JSON.stringify(claims) : null,
      caption: ok ? caption ?? null : null, video: ok ? videoPath ?? null : null, cover: ok ? coverPath ?? null : null,
    }).changes === 1;
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
      for (const row of rows) {
        // 수정 중이던 편은 영상이 이미 있다 — failed로 보내 재시도 루프에 섞지 않고 ready로 돌리며 실패 기록만 남긴다.
        if (row.revision_note != null) this.finishRevision(row.id, { outcome: 'failed', code: 'REELS_INTERRUPTED', detail: '서버가 꺼져 수정이 중단됐습니다.' });
        else this.finishFailed(row.id, 'REELS_INTERRUPTED', '서버가 꺼져 제작이 중단됐습니다.', readRecord(row.work_dir));
      }
      return rows.length;
    },
    getEpisode: id => byId.get(id) || null,
    latestEpisode: () => latest.get() || null,
    decide: (id, status) => decideTx(id, status),
    /** ready → producing + 의견. 같은 트랜잭션에서 다른 편이 producing이면 REELS_BUSY. */
    requestRevision: (id, note) => reviseTx(id, note),
    /** 수정 중인 편 하나(워커가 집는다). n은 이번 수정의 번호(1부터). */
    claimRevision() {
      const episode = revisingRow.get();
      if (!episode) return null;
      return { episode, card: getCandidate.get(episode.candidate_id), n: parseList(episode.revisions_json).length + 1 };
    },
    /** outcome 'ok'|'failed'. 어느 쪽이든 ready로 돌아오고 기록이 한 건 남는다. 실패면 영상·캡션은 그대로다. */
    finishRevision: (id, result) => finishRevisionTx(id, result),
  };
}

module.exports = { MAX_ATTEMPTS, RETRY_GAP_SECONDS, createReelsEpisodes, resumeStage };
