'use strict';

// News Agent의 DB 정본. 기사 저장·큐 전이·수집 커서·검색 예산이 전부 여기서
// 트랜잭션으로 일어난다. 소스 어댑터는 이 파일을 모르고 collect만 호출한다.
//
// **관심 자체는 여기 없다.** 관심 본문의 정본은 Markdown 노트이고(설계 22.1),
// 이 표들이 드는 것은 worker 상태와 외부에서 가져온 것뿐이다. 그래서 `interest_id`에
// FK가 없다 — 참조 대상이 DB에 없다는 사실이 곧 그 경계다.
//
// 큐 전이는 메일 분석 큐와 같은 모양이다(설계 16). 새 어휘를 만들지 않는다.
//
// **판단과 큐의 키는 기사가 아니라 (기사, 관심) 쌍이다.** relevance와 "왜 가져왔는지"는
// 어느 관심에서 보느냐에 따라 다르기 때문이다. 기사 행은 identity·dedupe·기사 사실만
// 들고, 같은 URL을 두 번 저장하지 않는 것은 그대로다.

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
  // 키만 기사가 아니라 (기사, 관심) 쌍이다.
  const recoverLeases = db.prepare(`
    UPDATE news_article_interests
    SET analysis_state = 'pending', analysis_lease_until = NULL, analysis_next_attempt_at = @now
    WHERE analysis_state = 'analyzing' AND analysis_lease_until <= @now
  `);
  const selectClaimable = db.prepare(`
    SELECT article_id AS articleId, interest_id AS interestId
    FROM news_article_interests
    WHERE analysis_state = 'pending' AND analysis_next_attempt_at <= @now
    ORDER BY analysis_next_attempt_at ASC, article_id ASC, interest_id ASC
    LIMIT @limit
  `);
  const claimPair = db.prepare(`
    UPDATE news_article_interests
    SET analysis_state = 'analyzing', analysis_lease_until = @leaseUntil,
        analysis_attempt_count = analysis_attempt_count + 1
    WHERE article_id = @articleId AND interest_id = @interestId
      AND analysis_state = 'pending' AND analysis_next_attempt_at <= @now
  `);
  const selectClaimedPair = db.prepare(`
    SELECT ai.article_id AS articleId, ai.interest_id AS interestId,
           ai.analysis_attempt_count AS attemptCount, ai.analysis_lease_until AS leaseUntil,
           a.identity_key AS identityKey, a.canonical_url AS canonicalUrl, a.url, a.title,
           a.source, a.published_at AS publishedAt, a.published_raw AS publishedRaw, a.snippet
    FROM news_article_interests ai
    JOIN news_articles a ON a.id = ai.article_id
    WHERE ai.article_id = @articleId AND ai.interest_id = @interestId
  `);
  const finishAnalysis = db.prepare(`
    UPDATE news_article_interests
    SET analysis_state = 'done', analysis_lease_until = NULL, analysis_error_code = NULL,
        relevance = @relevance, novelty = @novelty, importance = @importance,
        summary = @summary, judgment_reason = @reason,
        prompt_version = @promptVersion, analyzer_model = @analyzerModel, analyzed_at = @now
    WHERE article_id = @articleId AND interest_id = @interestId
      AND analysis_state = 'analyzing' AND analysis_lease_until = @leaseUntil
  `);
  const retryAnalysis = db.prepare(`
    UPDATE news_article_interests
    SET analysis_state = 'pending', analysis_lease_until = NULL,
        analysis_next_attempt_at = @nextAttemptAt, analysis_error_code = @code
    WHERE article_id = @articleId AND interest_id = @interestId
      AND analysis_state = 'analyzing' AND analysis_lease_until = @leaseUntil
  `);
  const failAnalysisRow = db.prepare(`
    UPDATE news_article_interests
    SET analysis_state = 'failed', analysis_lease_until = NULL, analysis_error_code = @code
    WHERE article_id = @articleId AND interest_id = @interestId
      AND analysis_state = 'analyzing' AND analysis_lease_until = @leaseUntil
  `);
  const skipAnalysisRow = db.prepare(`
    UPDATE news_article_interests
    SET analysis_state = 'skipped', analysis_lease_until = NULL, analysis_error_code = @code
    WHERE article_id = @articleId AND interest_id = @interestId
      AND analysis_state = 'analyzing' AND analysis_lease_until = @leaseUntil
  `);
  // 사람이 누르는 재처리. attempt_count를 0으로 되돌리지 않으면 되살린 항목이
  // 즉시 다시 상한에 걸린다(메일에서 같은 것을 고쳤다).
  const requeueFailed = db.prepare(`
    UPDATE news_article_interests
    SET analysis_state = 'pending', analysis_attempt_count = 0,
        analysis_next_attempt_at = @now, analysis_lease_until = NULL, analysis_error_code = NULL
    WHERE analysis_state = 'failed'
  `);
  const countByState = db.prepare(
    'SELECT analysis_state AS state, COUNT(*) AS total FROM news_article_interests GROUP BY analysis_state',
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

    /** 집는 단위는 (기사, 관심) 쌍이다. 같은 기사도 관심마다 따로 판단한다. */
    claimForAnalysis({ limit = 5, leaseSeconds = DEFAULT_LEASE_SECONDS } = {}) {
      const at = now();
      this.recoverExpiredLeases(at);
      const leaseUntil = at + leaseSeconds;
      const claimed = [];
      selectClaimable.all({ now: at, limit }).forEach(row => {
        if (claimPair.run({ ...row, now: at, leaseUntil }).changes !== 1) return;
        claimed.push({ ...selectClaimedPair.get(row), leaseUntil });
      });
      return claimed;
    },

    completeAnalysis({ articleId, interestId, leaseUntil, relevance, novelty, importance, summary, reason, promptVersion, analyzerModel }) {
      return finishAnalysis.run({
        articleId,
        interestId,
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
    failAnalysis({ articleId, interestId, leaseUntil, code, attemptCount }) {
      const at = now();
      const errorCode = String(code || 'UNKNOWN').slice(0, 80);
      if (attemptCount >= MAX_ANALYSIS_ATTEMPTS) {
        return failAnalysisRow.run({ articleId, interestId, leaseUntil, code: errorCode }).changes === 1
          ? 'failed'
          : null;
      }
      const changed = retryAnalysis.run({
        articleId,
        interestId,
        leaseUntil,
        code: errorCode,
        nextAttemptAt: at + analysisBackoffSeconds(attemptCount),
      }).changes === 1;
      return changed ? 'pending' : null;
    },

    /** 다시 시도해도 결과가 바뀌지 않는 것. 실패가 아니라 대상이 아닌 것이다. */
    skipAnalysis({ articleId, interestId, leaseUntil, code }) {
      return skipAnalysisRow.run({
        articleId, interestId, leaseUntil, code: String(code || 'SKIPPED').slice(0, 80),
      }).changes === 1;
    },

    requeueFailedAnalysis() {
      return requeueFailed.run({ now: now() }).changes;
    },

    // ── 재확인 candidate (v1.1, 설계 11.3) ────────────────────────────────

    /**
     * 질문 하나를 만든다. 같은 관심에 살아 있는 질문이 있으면 만들지 않는다 —
     * 두 개가 열려 있으면 사용자의 한 마디가 어느 쪽 답인지 알 수 없다.
     */
    createReviewCandidate({ interestId, question, at }) {
      const stamp = Number.isFinite(at) ? Math.floor(at) : now();
      const id = requireText(interestId, 'interest_id', 80);
      try {
        const result = db.prepare(`
          INSERT INTO news_review_candidates (interest_id, question, created_at)
          VALUES (@interestId, @question, @now)
        `).run({ interestId: id, question: requireText(question, 'question', 400), now: stamp });
        return { id: result.lastInsertRowid, interestId: id, question, state: 'pending' };
      } catch (error) {
        // 부분 unique index가 거부한 것은 고장이 아니라 "이미 물어둔 질문이 있다"는
        // 사실이다. 겹치는 두 턴이 SELECT를 둘 다 통과해도 여기서 하나만 남는다.
        if (String(error?.code || '').includes('CONSTRAINT')) return null;
        throw error;
      }
    },

    openReviewCandidates() {
      return db.prepare(`
        SELECT id, interest_id AS interestId, question, state,
               created_at AS createdAt, delivered_at AS deliveredAt
        FROM news_review_candidates
        WHERE state IN ('pending', 'delivered')
        ORDER BY created_at ASC, id ASC
      `).all();
    },

    /** 답을 받았거나 접었다. `resolved`·`dismissed`·`expired` 중 하나로 끝낸다. */
    settleReviewCandidate({ id, state, at }) {
      if (!['resolved', 'dismissed', 'expired'].includes(state)) {
        throw newsError(`candidate 종결 상태가 올바르지 않습니다: ${state}`, 'NEWS_CANDIDATE_STATE_INVALID');
      }
      return db.prepare(`
        UPDATE news_review_candidates
        SET state = @state, resolved_at = @now
        WHERE id = @id AND state IN ('pending', 'delivered')
      `).run({ id, state, now: Number.isFinite(at) ? Math.floor(at) : now() }).changes === 1;
    },

    /** 답이 없는 채로 수명을 넘긴 질문. 같은 질문을 즉시 다시 보내지 않는다. */
    expireStaleCandidates(ttlSeconds, at) {
      const stamp = Number.isFinite(at) ? Math.floor(at) : now();
      return db.prepare(`
        UPDATE news_review_candidates
        SET state = 'expired', resolved_at = @now
        WHERE state IN ('pending', 'delivered') AND created_at <= @cutoff
      `).run({ now: stamp, cutoff: stamp - Math.floor(ttlSeconds) }).changes;
    },

    /**
     * proactive 메시지를 candidate에 묶는다. `UNIQUE(candidate_id)`가 두 번째
     * 삽입을 거부하므로, 이 함수가 false를 돌려주면 이미 만들어진 것이다.
     */
    linkProactiveMessage({ messageId, candidateId, interestId, at }) {
      try {
        db.prepare(`
          INSERT INTO news_proactive_messages (message_id, candidate_id, interest_id, created_at)
          VALUES (@messageId, @candidateId, @interestId, @now)
        `).run({
          messageId,
          candidateId,
          interestId: requireText(interestId, 'interest_id', 80),
          now: Number.isFinite(at) ? Math.floor(at) : now(),
        });
        return true;
      } catch (error) {
        if (String(error?.code || '').includes('CONSTRAINT')) return false;
        throw error;
      }
    },

    proactiveMessageIds() {
      return new Set(
        db.prepare('SELECT message_id AS messageId FROM news_proactive_messages').all()
          .map(row => row.messageId),
      );
    },

    analysisCounts() {
      const counts = { pending: 0, analyzing: 0, done: 0, failed: 0, skipped: 0 };
      countByState.all().forEach(row => { counts[row.state] = row.total; });
      return counts;
    },

    /**
     * 홈에 올릴 후보.
     *
     * **기사 하나는 카드 하나다.** 한 기사가 두 관심의 문턱을 다 넘으면 더 중요하게
     * 판단된 쌍 하나만 고른다 — 두 줄로 보여주면 같은 기사가 두 번 뜨고, 관심을
     * 합쳐 보여주면 하나의 이유로 두 주제를 설명하는 거짓말이 된다.
     *
     * **topic은 여기서 못 채운다** — 관심 이름의 정본이 노트라 이 표에는
     * `interest_id`밖에 없다. 호출부가 노트를 읽어 이름을 붙인다(설계 22.1).
     */
    briefingArticles({
      minRelevance = 0, minNovelty = 0, minImportance = 0, limit = 5, interestIds = null,
    } = {}) {
      const params = { minRelevance, minNovelty, minImportance, limit };
      let scope = '';
      if (Array.isArray(interestIds)) {
        if (!interestIds.length) return [];
        scope = ` AND ai.interest_id IN (${interestIds.map((unused, index) => `@interest${index}`).join(', ')})`;
        interestIds.forEach((value, index) => { params[`interest${index}`] = String(value); });
      }
      // 기사마다 가장 중요하게 판단된 쌍 하나. 동점이면 relevance, 그다음 관심 id로
      // 갈라 같은 데이터에서 늘 같은 답이 나오게 한다.
      return db.prepare(`
        SELECT a.id, a.title, a.url, a.source, a.published_at AS publishedAt,
               a.surface_state AS surfaceState,
               ai.interest_id AS interestId, ai.summary, ai.judgment_reason AS reason,
               ai.relevance, ai.novelty, ai.importance
        FROM news_articles a
        JOIN news_article_interests ai ON ai.article_id = a.id
        WHERE a.surface_state != 'dismissed'
          AND ai.analysis_state = 'done'
          AND ai.relevance >= @minRelevance
          AND ai.novelty >= @minNovelty
          AND ai.importance >= @minImportance${scope}
          AND ai.rowid = (
            SELECT inner_ai.rowid FROM news_article_interests inner_ai
            WHERE inner_ai.article_id = a.id
              AND inner_ai.analysis_state = 'done'
              AND inner_ai.relevance >= @minRelevance
              AND inner_ai.novelty >= @minNovelty
              AND inner_ai.importance >= @minImportance${scope.replace('ai.', 'inner_ai.')}
            ORDER BY inner_ai.importance DESC, inner_ai.relevance DESC, inner_ai.interest_id ASC
            LIMIT 1
          )
        ORDER BY COALESCE(a.published_at, a.first_seen_at) DESC, a.id DESC
        LIMIT @limit
      `).all(params);
    },

    /**
     * 대화에서 부르는 조회. 찾는 것은 제목과 판단이 남긴 요약·근거다.
     * 원문은 저장하지 않으므로 "본문에서 찾아줘"는 이 경로로 답할 수 없다.
     *
     * 관심을 지정하면 **그 관심 기준 판단만** 돌려준다. 지정하지 않으면 기사마다
     * 가장 중요하게 판단된 쌍 하나다.
     */
    searchArticles({ query, interestId, since, until, limit = 5 } = {}) {
      const clauses = ["ai.analysis_state = 'done'"];
      const params = { limit: Math.min(Math.max(Number(limit) || 5, 1), 20) };
      // **질의는 낱말 단위로 쪼갠다.** 통짜로 LIKE하면 "OpenAI 안전"처럼 낱말이
      // 제목과 요약에 나뉘어 있는 흔한 경우가 0건이 되고, 모델은 그것을 "그런
      // 기사는 없다"로 옮겨 사용자 자기 데이터를 거짓으로 부인한다.
      // 낱말을 AND로 묶어 하나라도 없으면 안 걸리게 한다 — 아무거나 주워오지 않는다.
      const terms = String(query ?? '').split(/\s+/).filter(Boolean).slice(0, 6);
      terms.forEach((term, index) => {
        // LIKE 와일드카드는 이스케이프한다. `%` 한 글자가 전건 조회가 된다.
        params[`q${index}`] = `%${term.replace(/[\\%_]/g, '\\$&')}%`;
        clauses.push(`(a.title LIKE @q${index} ESCAPE '\\' OR ai.summary LIKE @q${index} ESCAPE '\\' OR ai.judgment_reason LIKE @q${index} ESCAPE '\\')`);
      });
      if (Number.isFinite(since)) {
        params.since = Math.floor(since);
        clauses.push('COALESCE(a.published_at, a.first_seen_at) >= @since');
      }
      if (Number.isFinite(until)) {
        params.until = Math.floor(until);
        clauses.push('COALESCE(a.published_at, a.first_seen_at) <= @until');
      }
      if (interestId) {
        params.interestId = String(interestId);
        clauses.push('ai.interest_id = @interestId');
      } else {
        clauses.push(`ai.rowid = (
          SELECT inner_ai.rowid FROM news_article_interests inner_ai
          WHERE inner_ai.article_id = a.id AND inner_ai.analysis_state = 'done'
          ORDER BY inner_ai.importance DESC, inner_ai.relevance DESC, inner_ai.interest_id ASC
          LIMIT 1
        )`);
      }
      return db.prepare(`
        SELECT a.id, a.title, a.url, a.source, a.published_at AS publishedAt,
               ai.interest_id AS interestId, ai.summary, ai.judgment_reason AS reason,
               ai.relevance, ai.importance
        FROM news_articles a
        JOIN news_article_interests ai ON ai.article_id = a.id
        WHERE ${clauses.join(' AND ')}
        ORDER BY COALESCE(a.published_at, a.first_seen_at) DESC, a.id DESC
        LIMIT @limit
      `).all(params);
    },

    /** 사용자가 홈에서 치운 것. 다시 올리지 않는다. */
    dismissArticle(id) {
      return db.prepare(`
        UPDATE news_articles SET surface_state = 'dismissed', surfaced_at = @now WHERE id = @id
      `).run({ id, now: now() }).changes === 1;
    },

    articlesForInterest(interestId, limit = 20) {
      return db.prepare(`
        SELECT a.id, a.title, a.url, a.source, a.published_at AS publishedAt,
               a.snippet, ai.analysis_state AS analysisState,
               ai.relevance, ai.importance, ai.summary, ai.judgment_reason AS reason
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
