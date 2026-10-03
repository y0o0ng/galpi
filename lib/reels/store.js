'use strict';

// Reels 후보의 DB 정본(설계 v0.2 3장). 배치는 KST 날짜 하루 하나이고 `batch_id`가 그 날짜다.
// 상태는 카드 단위로 저장하고 배치 상태는 카드에서 읽는다 — 두 곳에 두면 갈린다.

const MAX_ATTEMPTS = 3;            // 하루 최대 호출 수
const RETRY_GAP_SECONDS = 60 * 60; // 실패 뒤 다시 하기까지

function reelsError(message, code) {
  return Object.assign(new Error(message), { code });
}

// 아직 사람이 결정하지 않은 카드 상태.
const OPEN = "('candidate', 'held')";

function createReelsStore(db, options = {}) {
  if (!db?.prepare || typeof db.transaction !== 'function') throw new TypeError('SQLite DB 연결이 필요합니다.');
  const clock = typeof options.now === 'function' ? options.now : () => Math.floor(Date.now() / 1000);

  const insertRun = db.prepare("INSERT OR IGNORE INTO reels_runs (day, outcome, attempts, created_at) VALUES (?, 'started', 1, ?)");
  // 실패한 날은 1시간이 지났고 3번을 다 쓰지 않았을 때만 다시 잡는다(재시도 폭주 없이 일시 실패를 넘긴다).
  const retryRun = db.prepare(`
    UPDATE reels_runs SET outcome = 'started', attempts = attempts + 1
    WHERE day = @day AND outcome = 'failed' AND attempts < ${MAX_ATTEMPTS} AND finished_at <= @now - ${RETRY_GAP_SECONDS}
  `);
  const finishRun = db.prepare('UPDATE reels_runs SET outcome = ?, error_code = ?, error_detail = ?, finished_at = ? WHERE day = ?');
  const insertCard = db.prepare(`
    INSERT INTO reels_candidates (
      batch_id, position, title, source_url, published_at, collected_at, why, concept, bridge,
      template, hook_paradox, hook_term, hook_subtitle, risk, created_at
    ) VALUES (
      @batchId, @position, @title, @url, @published_at, @collectedAt, @why, @concept, @bridge,
      @template, @hook_paradox, @hook_term, @hook_subtitle, @risk, @now
    )
  `);
  const latestBatchId = db.prepare('SELECT MAX(batch_id) AS id FROM reels_candidates');
  const batchCards = db.prepare(`
    SELECT id, batch_id AS batchId, position, title, source_url AS url, published_at AS publishedAt,
           why, concept, bridge, template, hook_paradox AS hookParadox, hook_term AS hookTerm,
           hook_subtitle AS hookSubtitle, risk, status
    FROM reels_candidates WHERE batch_id = ? ORDER BY position
  `);
  const getCard = db.prepare('SELECT id, batch_id AS batchId, status FROM reels_candidates WHERE id = ?');
  const selectedConcepts = db.prepare(
    "SELECT concept FROM reels_candidates WHERE status = 'selected' ORDER BY id",
  );
  const dropOthers = db.prepare(`
    UPDATE reels_candidates SET status = 'dropped', decided_at = @now
    WHERE batch_id = @batchId AND id != @id AND status IN ${OPEN}
  `);
  const selectCardRow = db.prepare(`
    UPDATE reels_candidates SET status = 'selected', decided_at = @now
    WHERE id = @id AND status IN ${OPEN}
  `);
  const dropBatch = db.prepare(`
    UPDATE reels_candidates SET status = 'dropped', decided_at = @now
    WHERE batch_id = @batchId AND status IN ${OPEN}
  `);
  const holdBatchRows = db.prepare(`
    UPDATE reels_candidates SET status = 'held', decided_at = @now
    WHERE batch_id = @batchId AND status = 'candidate'
  `);
  const expire = db.prepare(`
    UPDATE reels_candidates SET status = 'dropped', decided_at = @now
    WHERE status IN ${OPEN} AND created_at <= @cutoff
  `);

  const saveBatchTx = db.transaction(({ day, cards, collectedAt }) => {
    const now = clock();
    cards.forEach((card, index) => insertCard.run({
      ...card, batchId: day, position: index + 1, collectedAt, now,
    }));
    finishRun.run('ok', null, null, now, day);
    return day;
  });

  const selectTx = db.transaction(id => {
    const card = getCard.get(id);
    if (!card) throw reelsError('후보를 찾을 수 없습니다.', 'REELS_NOT_FOUND');
    const now = clock();
    // 같은 배치에서 이미 선택·결정된 카드는 다시 고를 수 없다(OPEN 조건이 막는다).
    if (selectCardRow.run({ id, now }).changes !== 1) {
      throw reelsError('이미 결정된 후보입니다.', 'REELS_NOT_PENDING');
    }
    dropOthers.run({ id, batchId: card.batchId, now });
    return { id, batchId: card.batchId };
  });

  function decideBatch(statement, batchId) {
    const changed = statement.run({ batchId, now: clock() }).changes;
    if (!changed) throw reelsError('결정할 수 있는 후보가 없습니다.', 'REELS_NOT_PENDING');
    return { batchId, changed };
  }

  return {
    /** 그날 호출 권한을 한 번만 준다. 호출 전에 잡으므로 실패·재시작에도 같은 날 두 번 부르지 않는다. */
    claimRun(day) {
      const now = clock();
      return insertRun.run(day, now).changes === 1 || retryRun.run({ day, now }).changes === 1;
    },
    failRun(day, code, detail) {
      finishRun.run('failed', String(code || 'REELS_FAILED').slice(0, 80), detail ? String(detail).slice(0, 200) : null, clock(), day);
    },
    saveBatch: ({ day, cards, collectedAt }) => saveBatchTx({ day, cards, collectedAt }),
    selectCard: id => selectTx(id),
    rejectBatch: batchId => decideBatch(dropBatch, batchId),
    holdBatch: batchId => decideBatch(holdBatchRows, batchId),
    /** 며칠 지난 미결정(candidate·held) 카드를 dropped로 닫는다. */
    expireStale(ttlSeconds) {
      const now = clock();
      return expire.run({ now, cutoff: now - ttlSeconds }).changes;
    },
    coveredConcepts: () => selectedConcepts.all().map(row => row.concept),
    latestBatch() {
      const batchId = latestBatchId.get().id;
      if (!batchId) return null;
      const cards = batchCards.all(batchId);
      const has = status => cards.some(card => card.status === status);
      const status = has('selected') ? 'selected' : has('held') ? 'held' : has('candidate') ? 'candidate' : 'dropped';
      return { batchId, status, cards };
    },
  };
}

module.exports = { createReelsStore };
