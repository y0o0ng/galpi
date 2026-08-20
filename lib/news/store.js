'use strict';

// News Agent의 DB 정본. 기사 저장·큐 전이·수집 커서·검색 예산이 전부 여기서
// 트랜잭션으로 일어난다. 소스 어댑터는 이 파일을 모르고 collect만 호출한다.
//
// **관심 자체는 여기 없다.** 관심 본문의 정본은 Markdown 노트이고(설계 22.1),
// 이 표들이 드는 것은 worker 상태와 외부에서 가져온 것뿐이다. 그래서 `interest_id`에
// FK가 없다 — 참조 대상이 DB에 없다는 사실이 곧 그 경계다.
//
// 큐 전이는 메일 분석 큐와 같은 모양이다(설계 16). 새 어휘를 만들지 않는다.

const DEFAULT_LEASE_SECONDS = 120;
const MAX_ANALYSIS_ATTEMPTS = 5;

// 뉴스 전용 크레딧 하위 한도. 검색 예산은 채팅 웹 검색과 한 통이라, 이것이 없으면
// 뉴스 폴링이 사용자의 채팅 검색을 굶긴다.
const DEFAULT_MONTHLY_CREDIT_LIMIT = 200;

// 재시도 간격. 메일과 같은 지수 backoff이고 상한을 둔다 — 상한이 없으면 몇 번
// 실패한 기사가 사실상 영영 다시 오지 않는다.
function analysisBackoffSeconds(attemptCount) {
  return Math.min(60 * 2 ** Math.max(0, attemptCount - 1), 6 * 60 * 60);
}

function newsError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function requireText(value, field, max) {
  const text = String(value ?? '').trim();
  if (!text || text.length > max) {
    throw newsError(`${field}이(가) 올바르지 않습니다.`, 'NEWS_FIELD_INVALID');
  }
  return text;
}

function usageMonth(now) {
  return new Date(Math.floor(now) * 1000).toISOString().slice(0, 7);
}

function createNewsStore(db, options = {}) {
  if (!db?.prepare) throw new TypeError('SQLite DB 연결이 필요합니다.');
  const clock = typeof options.now === 'function' ? options.now : () => Math.floor(Date.now() / 1000);
  const monthlyCreditLimit = Number.isInteger(options.monthlyCreditLimit) && options.monthlyCreditLimit >= 0
    ? options.monthlyCreditLimit
    : DEFAULT_MONTHLY_CREDIT_LIMIT;

  function now() {
    const value = clock();
    if (!Number.isFinite(value)) throw new TypeError('뉴스 저장소 시계가 올바르지 않습니다.');
    return Math.floor(value);
  }

  const insertArticle = db.prepare(`
    INSERT INTO news_articles (
      identity_key, canonical_url, url, title, source,
      published_at, published_raw, snippet, first_seen_at, last_seen_at
    ) VALUES (
      @identityKey, @canonicalUrl, @url, @title, @source,
      @publishedAt, @publishedRaw, @snippet, @now, @now
    )
    ON CONFLICT(identity_key) DO UPDATE SET last_seen_at = @now
  `);
  const selectArticleByIdentity = db.prepare(
    'SELECT id, first_seen_at AS firstSeenAt FROM news_articles WHERE identity_key = ?',
  );
  const linkInterest = db.prepare(`
    INSERT INTO news_article_interests (article_id, interest_id, query, first_seen_at)
    VALUES (@articleId, @interestId, @query, @now)
    ON CONFLICT(article_id, interest_id) DO NOTHING
  `);

  /**
   * 수집한 기사들을 한 관심 아래에 저장한다.
   *
   * 이미 있는 기사는 다시 만들지 않고 `last_seen_at`만 옮긴다 — 같은 기사가 계속
   * 검색에 걸린다고 분석을 다시 돌리면 비용만 늘고 결과는 같다. **분석 상태는
   * 건드리지 않는다.**
   */
  const saveArticles = db.transaction(({ interestId, articles, at }) => {
    const stamp = Number.isFinite(at) ? Math.floor(at) : now();
    const id = requireText(interestId, 'interest_id', 80);
    let created = 0;
    let linked = 0;
    articles.forEach(article => {
      const before = selectArticleByIdentity.get(article.identityKey);
      insertArticle.run({
        identityKey: article.identityKey,
        canonicalUrl: article.canonicalUrl,
        url: article.url,
        title: article.title,
        source: article.source ?? null,
        publishedAt: article.publishedAt ?? null,
        publishedRaw: article.publishedRaw ?? null,
        snippet: article.snippet ?? null,
        now: stamp,
      });
      if (!before) created += 1;
      const row = before || selectArticleByIdentity.get(article.identityKey);
      const result = linkInterest.run({
        articleId: row.id,
        interestId: id,
        query: article.query ?? null,
        now: stamp,
      });
      if (result.changes > 0) linked += 1;
    });
    return { created, linked, seen: articles.length };
  });

  const upsertPoll = db.prepare(`
    INSERT INTO news_interest_polls (interest_id, last_polled_at, next_poll_at, poll_count, updated_at)
    VALUES (@interestId, @now, @nextPollAt, 1, @now)
    ON CONFLICT(interest_id) DO UPDATE SET
      last_polled_at = @now,
      next_poll_at = @nextPollAt,
      poll_count = poll_count + 1,
      last_error_code = NULL,
      last_error_at = NULL,
      updated_at = @now
  `);
  const failPoll = db.prepare(`
    INSERT INTO news_interest_polls (interest_id, next_poll_at, last_error_code, last_error_at, updated_at)
    VALUES (@interestId, @nextPollAt, @code, @now, @now)
    ON CONFLICT(interest_id) DO UPDATE SET
      next_poll_at = @nextPollAt,
      last_error_code = @code,
      last_error_at = @now,
      updated_at = @now
  `);
  const selectDuePolls = db.prepare(`
    SELECT interest_id AS interestId, last_polled_at AS lastPolledAt, next_poll_at AS nextPollAt
    FROM news_interest_polls
    WHERE next_poll_at <= ?
  `);

  // 분석 큐. 이름과 전이가 메일과 같아서 읽는 사람이 두 어휘를 배우지 않아도 된다.
  const recoverLeases = db.prepare(`
    UPDATE news_articles
    SET analysis_state = 'pending', analysis_lease_until = NULL, analysis_next_attempt_at = @now
    WHERE analysis_state = 'analyzing' AND analysis_lease_until <= @now
  `);
  const selectClaimable = db.prepare(`
    SELECT id FROM news_articles
    WHERE analysis_state = 'pending' AND analysis_next_attempt_at <= @now
    ORDER BY analysis_next_attempt_at ASC, id ASC
    LIMIT @limit
  `);
  const claimArticle = db.prepare(`
    UPDATE news_articles
    SET analysis_state = 'analyzing', analysis_lease_until = @leaseUntil,
        analysis_attempt_count = analysis_attempt_count + 1
    WHERE id = @id AND analysis_state = 'pending' AND analysis_next_attempt_at <= @now
  `);
  const selectArticle = db.prepare(`
    SELECT id, identity_key AS identityKey, canonical_url AS canonicalUrl, url, title, source,
           published_at AS publishedAt, published_raw AS publishedRaw, snippet,
           analysis_attempt_count AS attemptCount, analysis_lease_until AS leaseUntil
    FROM news_articles WHERE id = ?
  `);
  const finishAnalysis = db.prepare(`
    UPDATE news_articles
    SET analysis_state = 'done', analysis_lease_until = NULL, analysis_error_code = NULL,
        relevance = @relevance, novelty = @novelty, importance = @importance,
        summary = @summary, judgment_reason = @reason,
        prompt_version = @promptVersion, analyzer_model = @analyzerModel, analyzed_at = @now
    WHERE id = @id AND analysis_state = 'analyzing' AND analysis_lease_until = @leaseUntil
  `);
  const retryAnalysis = db.prepare(`
    UPDATE news_articles
    SET analysis_state = 'pending', analysis_lease_until = NULL,
        analysis_next_attempt_at = @nextAttemptAt, analysis_error_code = @code
    WHERE id = @id AND analysis_state = 'analyzing' AND analysis_lease_until = @leaseUntil
  `);
  const failAnalysisRow = db.prepare(`
    UPDATE news_articles
    SET analysis_state = 'failed', analysis_lease_until = NULL, analysis_error_code = @code
    WHERE id = @id AND analysis_state = 'analyzing' AND analysis_lease_until = @leaseUntil
  `);
  const skipAnalysisRow = db.prepare(`
    UPDATE news_articles
    SET analysis_state = 'skipped', analysis_lease_until = NULL, analysis_error_code = @code
    WHERE id = @id AND analysis_state = 'analyzing' AND analysis_lease_until = @leaseUntil
  `);
  // 사람이 누르는 재처리. attempt_count를 0으로 되돌리지 않으면 되살린 기사가
  // 즉시 다시 상한에 걸린다(메일에서 같은 것을 고쳤다).
  const requeueFailed = db.prepare(`
    UPDATE news_articles
    SET analysis_state = 'pending', analysis_attempt_count = 0,
        analysis_next_attempt_at = @now, analysis_lease_until = NULL, analysis_error_code = NULL
    WHERE analysis_state = 'failed'
  `);
  const countByState = db.prepare(
    'SELECT analysis_state AS state, COUNT(*) AS total FROM news_articles GROUP BY analysis_state',
  );

  const readUsage = db.prepare(
    'SELECT credits, request_count AS requestCount FROM news_search_usage WHERE month = ?',
  );
  const addUsage = db.prepare(`
    INSERT INTO news_search_usage (month, credits, request_count, updated_at)
    VALUES (@month, @credits, 1, @now)
    ON CONFLICT(month) DO UPDATE SET
      credits = credits + @credits,
      request_count = request_count + 1,
      updated_at = @now
  `);

  return {
    monthlyCreditLimit,

    saveArticles(payload) {
      return saveArticles(payload);
    },

    markPolled({ interestId, nextPollAt }) {
      const at = now();
      upsertPoll.run({
        interestId: requireText(interestId, 'interest_id', 80),
        now: at,
        nextPollAt: Number.isFinite(nextPollAt) ? Math.floor(nextPollAt) : at,
      });
    },

    markPollFailed({ interestId, code, nextPollAt }) {
      const at = now();
      failPoll.run({
        interestId: requireText(interestId, 'interest_id', 80),
        now: at,
        code: String(code || 'UNKNOWN').slice(0, 80),
        nextPollAt: Number.isFinite(nextPollAt) ? Math.floor(nextPollAt) : at,
      });
    },

    duePollInterestIds(at = now()) {
      return new Set(selectDuePolls.all(Math.floor(at)).map(row => row.interestId));
    },

    /**
     * 아직 한 번도 돌지 않은 관심은 표에 행이 없다. 그것도 대상이다 — 행이 있는
     * 것만 고르면 새로 생긴 관심이 영영 수집되지 않는다.
     */
    pollTargets(interests, at = now()) {
      const due = this.duePollInterestIds(at);
      const known = new Set(
        db.prepare('SELECT interest_id AS interestId FROM news_interest_polls').all().map(row => row.interestId),
      );
      return interests.filter(interest => !known.has(interest.interestId) || due.has(interest.interestId));
    },

    creditsUsed(at = now()) {
      return readUsage.get(usageMonth(at))?.credits || 0;
    },

    assertCreditsAvailable(credits, at = now()) {
      const used = this.creditsUsed(at);
      if (used + credits > monthlyCreditLimit) {
        throw newsError(
          `뉴스 검색 월 한도에 도달했습니다 (${used}/${monthlyCreditLimit} credits).`,
          'NEWS_SEARCH_BUDGET_EXHAUSTED',
        );
      }
    },

    recordCredits(credits, at = now()) {
      const stamp = Math.floor(at);
      addUsage.run({ month: usageMonth(stamp), credits: Math.max(0, Math.floor(credits)), now: stamp });
    },

    recoverExpiredLeases(at = now()) {
      return recoverLeases.run({ now: Math.floor(at) }).changes;
    },

    claimForAnalysis({ limit = 5, leaseSeconds = DEFAULT_LEASE_SECONDS } = {}) {
      const at = now();
      this.recoverExpiredLeases(at);
      const leaseUntil = at + leaseSeconds;
      const claimed = [];
      selectClaimable.all({ now: at, limit }).forEach(row => {
        if (claimArticle.run({ id: row.id, now: at, leaseUntil }).changes !== 1) return;
        claimed.push({ ...selectArticle.get(row.id), leaseUntil });
      });
      return claimed;
    },

    completeAnalysis({ id, leaseUntil, relevance, novelty, importance, summary, reason, promptVersion, analyzerModel }) {
      return finishAnalysis.run({
        id,
        leaseUntil,
        relevance: relevance ?? null,
        novelty: novelty ?? null,
        importance: importance ?? null,
        summary: summary ?? null,
        reason: reason ?? null,
        promptVersion: promptVersion ?? null,
        analyzerModel: analyzerModel ?? null,
        now: now(),
      }).changes === 1;
    },

    /**
     * 재시도 가능한 실패. 상한을 넘으면 `failed`로 끝내 목록에 남긴다 — 조용히
     * 지우면 사람이 고칠 기회가 없다.
     */
    failAnalysis({ id, leaseUntil, code, attemptCount }) {
      const at = now();
      const errorCode = String(code || 'UNKNOWN').slice(0, 80);
      if (attemptCount >= MAX_ANALYSIS_ATTEMPTS) {
        return failAnalysisRow.run({ id, leaseUntil, code: errorCode }).changes === 1 ? 'failed' : null;
      }
      const changed = retryAnalysis.run({
        id,
        leaseUntil,
        code: errorCode,
        nextAttemptAt: at + analysisBackoffSeconds(attemptCount),
      }).changes === 1;
      return changed ? 'pending' : null;
    },

    /** 다시 시도해도 결과가 바뀌지 않는 것. 실패가 아니라 대상이 아닌 것이다. */
    skipAnalysis({ id, leaseUntil, code }) {
      return skipAnalysisRow.run({
        id, leaseUntil, code: String(code || 'SKIPPED').slice(0, 80),
      }).changes === 1;
    },

    requeueFailedAnalysis() {
      return requeueFailed.run({ now: now() }).changes;
    },

    analysisCounts() {
      const counts = { pending: 0, analyzing: 0, done: 0, failed: 0, skipped: 0 };
      countByState.all().forEach(row => { counts[row.state] = row.total; });
      return counts;
    },

    articlesForInterest(interestId, limit = 20) {
      return db.prepare(`
        SELECT a.id, a.title, a.url, a.source, a.published_at AS publishedAt,
               a.snippet, a.analysis_state AS analysisState,
               a.relevance, a.importance, a.summary
        FROM news_articles a
        JOIN news_article_interests ai ON ai.article_id = a.id
        WHERE ai.interest_id = ?
        ORDER BY COALESCE(a.published_at, a.first_seen_at) DESC
        LIMIT ?
      `).all(requireText(interestId, 'interest_id', 80), limit);
    },
  };
}

module.exports = {
  DEFAULT_MONTHLY_CREDIT_LIMIT,
  MAX_ANALYSIS_ATTEMPTS,
  analysisBackoffSeconds,
  createNewsStore,
};
