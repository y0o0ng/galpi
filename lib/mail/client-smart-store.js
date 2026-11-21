'use strict';

const MAX_ATTEMPTS = 3;
const LEASE_SECONDS = 240;

const FILTERS = {
  important: "category IN ('urgent', 'important')",
  action_required: "category = 'action_required' OR (category = 'urgent' AND trim(actionText) <> '')",
  schedule: 'hasEvents',
  deadline: 'validDeadline OR hasDeadlineEvent',
  ignore: "category = 'ignore'",
  unclassified: 'category IS NULL',
};

const STARRED = `coalesce(json_extract(metadata, '$.starred'), CASE WHEN provider = 'gmail'
  THEN EXISTS(SELECT 1 FROM json_each(metadata, '$.labelIds') WHERE value = 'STARRED')
  ELSE json_extract(metadata, '$.important') END) = 1`;
const VARIANTS = {
  important_all: `(${FILTERS.important}) OR ${STARRED}`,
  important_starred: STARRED,
  ignore_all: `(${FILTERS.ignore}) OR classificationCode = 'MAIL_CLIENT_SMART_PREFERENCE_SKIP'`,
  ignore_rules: "classificationCode = 'MAIL_CLIENT_SMART_PREFERENCE_SKIP'",
  unclassified_pending: `(${FILTERS.unclassified}) AND classificationState IN ('pending', 'analyzing')`,
  unclassified_failed: `(${FILTERS.unclassified}) AND classificationState = 'failed'`,
};
for (const [variant, comparison] of [['deadline_upcoming', '>='], ['deadline_past', '<']]) {
  VARIANTS[variant] = `(
    validDeadline AND coalesce(json_extract(coalesce(agentResult, workspaceResult), '$.deadlineDate'),
      date(json_extract(coalesce(agentResult, workspaceResult), '$.deadlineAt'), 'unixepoch', '+9 hours'))
      ${comparison} date('now', '+9 hours')
  ) OR EXISTS (
    SELECT 1 FROM mail_workspace_calendar_events AS event
      JOIN mail_workspace_analysis_jobs AS job ON job.id = event.analysis_job_id
    WHERE job.client_message_id = classified.id AND job.source_sha256 = classified.sourceSha256
      AND event.resolution_state = 'resolved' AND event.event_kind = 'deadline'
      AND event.start_date ${comparison} date('now', '+9 hours')
  )`;
}

const JOB = `SELECT id, account_id AS accountId, client_message_id AS messageId, source_sha256 AS hash, kind,
  state, attempt_count AS attempts, next_attempt_at AS nextAttemptAt, lease_until AS leaseUntil,
  error_code AS code, result_json AS result, incomplete_reason AS incomplete,
  analyzer_model AS model, analyzer_prompt_version AS promptVersion, analyzed_at AS analyzedAt
  FROM mail_workspace_analysis_jobs`;

const PROJECT = `
  WITH projected AS (
    SELECT m.id, m.account_id AS accountId, m.location_key AS locationKey, a.provider, a.status,
      m.locator_json AS locator, m.metadata_json AS metadata, m.fetched_at AS fetchedAt,
      CAST(json_extract(m.metadata_json, '$.receivedAt') AS INTEGER) AS receivedAt,
      s.verified_at AS verifiedAt, s.source_sha256 AS sourceSha256, s.error_code AS sourceError,
      CASE WHEN d.analysis_state = 'done' AND d.category IS NOT NULL THEN json_object(
        'category', d.category, 'importance', d.importance, 'summary', d.summary, 'actionText', d.action_text,
        'deadlineKind', d.deadline_kind, 'deadlineDate', d.deadline_date, 'deadlineAt', d.deadline_at,
        'notificationMode', d.notification_mode, 'decisionConfidence', d.decision_confidence
      ) END AS agentResult,
      d.id AS agentMessageId, d.analyzer_model AS agentModel, d.analyzer_prompt_version AS agentVersion,
      d.analyzed_at AS agentAnalyzedAt,
      c.result_json AS workspaceResult, c.analyzer_model AS workspaceModel,
      c.analyzer_prompt_version AS workspaceVersion, c.analyzed_at AS workspaceAnalyzedAt,
      c.state AS classificationState, c.error_code AS classificationCode, c.incomplete_reason AS classificationIncomplete,
      e.state AS calendarState, e.error_code AS calendarCode, e.incomplete_reason AS calendarIncomplete,
      e.analyzer_model AS calendarModel, e.analyzer_prompt_version AS calendarVersion, e.analyzed_at AS calendarAnalyzedAt,
      EXISTS (SELECT 1 FROM mail_workspace_calendar_events WHERE analysis_job_id = e.id) AS hasEvents,
      EXISTS (SELECT 1 FROM mail_workspace_calendar_events
              WHERE analysis_job_id = e.id AND event_kind = 'deadline' AND resolution_state = 'resolved') AS hasDeadlineEvent
    FROM mail_client_messages m
    JOIN mail_accounts a ON a.id = m.account_id
    LEFT JOIN mail_workspace_sources s ON s.client_message_id = m.id
    LEFT JOIN mail_messages d ON d.id = m.agent_message_id AND d.account_id = m.account_id
    LEFT JOIN mail_workspace_analysis_jobs c ON c.client_message_id = m.id AND c.source_sha256 = s.source_sha256 AND c.kind = 'classification'
    LEFT JOIN mail_workspace_analysis_jobs e ON e.client_message_id = m.id AND e.source_sha256 = s.source_sha256 AND e.kind = 'calendar'
    WHERE NOT EXISTS (SELECT 1 FROM mail_client_messages newer
      WHERE newer.account_id = m.account_id AND newer.location_key = m.location_key AND newer.id > m.id)
      AND a.status != 'disabled'
      AND (
        a.provider = 'gmail' AND NOT EXISTS (
          SELECT 1 FROM json_each(m.metadata_json, '$.labelIds') WHERE value IN ('SENT', 'DRAFT', 'SPAM', 'TRASH')
        )
        OR a.provider != 'gmail' AND coalesce(json_extract(m.locator_json, '$.analysisMailboxEligible'),
          s.source_sha256 IS NOT NULL OR upper(json_extract(m.locator_json, '$.path')) = 'INBOX') = 1
      )
  ), classified AS (
    SELECT *, json_extract(coalesce(agentResult, workspaceResult), '$.category') AS category,
      json_extract(coalesce(agentResult, workspaceResult), '$.actionText') AS actionText,
      mail_workspace_valid_deadline(
        json_extract(coalesce(agentResult, workspaceResult), '$.deadlineKind'),
        json_extract(coalesce(agentResult, workspaceResult), '$.deadlineDate'),
        json_extract(coalesce(agentResult, workspaceResult), '$.deadlineAt')
      ) AS validDeadline
    FROM projected
  )
`;

const EVENT = `
  SELECT e.id, j.client_message_id AS messageId, j.account_id AS accountId, j.agent_message_id AS agentMessageId,
    j.source_sha256 AS sourceSha256, s.verified_at AS verifiedAt, s.error_code AS sourceError,
    CAST(json_extract(m.metadata_json, '$.receivedAt') AS INTEGER) AS receivedAt,
    a.status AS accountStatus, j.analyzed_at AS analyzedAt, j.analyzer_model AS model,
    j.analyzer_prompt_version AS promptVersion, j.incomplete_reason AS incomplete,
    e.event_kind AS kind, e.title, e.original_date_text AS originalDateText, e.original_end_text AS originalEndText,
    e.evidence_excerpt AS evidenceExcerpt, e.evidence_hash AS evidenceHash,
    e.start_kind AS startKind, e.start_date AS startDate, e.start_at AS startAt,
    e.end_kind AS endKind, e.end_date AS endDate, e.end_at AS endAt, e.end_provenance AS endProvenance,
    e.date_provenance AS dateProvenance, e.reference_kst_date AS referenceKstDate, e.inferred_year AS inferredYear,
    e.inference_reason AS inferenceReason, e.confidence, e.resolution_state AS resolutionState
  FROM mail_workspace_calendar_events e
  JOIN mail_workspace_analysis_jobs j ON j.id = e.analysis_job_id
  JOIN mail_client_messages m ON m.id = j.client_message_id
  JOIN mail_accounts a ON a.id = j.account_id
  JOIN mail_workspace_sources s ON s.client_message_id = j.client_message_id AND s.source_sha256 = j.source_sha256
`;

function createSmartStore(db, validDeadline) {
  db.function('mail_workspace_valid_deadline', { deterministic: true }, (kind, date, at) => Number(validDeadline(kind, date, at)));
  const getSource = db.prepare(`SELECT source_sha256 AS hash, verified_at AS verifiedAt, error_code AS code
    FROM mail_workspace_sources WHERE client_message_id = ?`);
  const getAgent = db.prepare(`
    SELECT category, importance, summary, action_text AS actionText, deadline_kind AS deadlineKind,
      deadline_date AS deadlineDate, deadline_at AS deadlineAt, notification_mode AS notificationMode,
      decision_confidence AS decisionConfidence, analyzer_model AS model, analyzer_prompt_version AS promptVersion,
      analyzed_at AS analyzedAt
    FROM mail_messages WHERE id = ? AND account_id = ? AND analysis_state = 'done' AND category IS NOT NULL
  `);
  const getMessage = db.prepare(PROJECT + 'SELECT * FROM classified WHERE id = ?');
  const currentMessage = db.prepare(`
    SELECT m.*, a.status FROM mail_client_messages m JOIN mail_accounts a ON a.id = m.account_id
    WHERE m.id = ? AND NOT EXISTS (SELECT 1 FROM mail_client_messages newer
      WHERE newer.account_id = m.account_id AND newer.location_key = m.location_key AND newer.id > m.id)
  `);
  const touchSource = db.prepare(`
    INSERT INTO mail_workspace_sources (client_message_id, source_sha256, verified_at) VALUES (@messageId, @hash, @now)
    ON CONFLICT(client_message_id) DO UPDATE SET verified_at = max(verified_at, @now), error_code = NULL
      WHERE source_sha256 = @hash
  `);
  const invalidateSource = db.prepare('UPDATE mail_workspace_sources SET error_code = ? WHERE client_message_id = ?');
  const refreshSource = db.prepare(`
    UPDATE mail_workspace_sources SET verified_at = max(verified_at, @now)
    WHERE client_message_id = @messageId AND source_sha256 = @hash AND error_code IS NULL
  `);
  const insert = db.prepare(`
    INSERT INTO mail_workspace_analysis_jobs
      (account_id, client_message_id, source_sha256, kind, state, error_code, next_attempt_at, created_at, updated_at)
    VALUES (@accountId, @messageId, @hash, @kind, @state, @code, @now, @now, @now)
    ON CONFLICT(client_message_id, source_sha256, kind) DO UPDATE
      SET state = excluded.state, error_code = NULL, next_attempt_at = excluded.next_attempt_at, updated_at = excluded.updated_at
      WHERE state = 'skipped' AND error_code = 'MAIL_CLIENT_SMART_PREFERENCE_SKIP'
        AND excluded.state = 'pending' AND attempt_count < ${MAX_ATTEMPTS}
  `);
  const forMessage = db.prepare(JOB + ' WHERE client_message_id = ? AND source_sha256 = ? ORDER BY id');
  const advance = db.prepare(`
    UPDATE mail_workspace_analysis_jobs
    SET state = CASE WHEN attempt_count >= ${MAX_ATTEMPTS} THEN 'failed' ELSE 'pending' END,
      lease_until = NULL, error_code = 'MAIL_CLIENT_SMART_LEASE_EXPIRED', next_attempt_at = ?, updated_at = ?
    WHERE state = 'analyzing' AND lease_until <= ?
  `);
  const take = db.prepare(`
    UPDATE mail_workspace_analysis_jobs SET state = 'analyzing', attempt_count = attempt_count + 1,
      lease_until = @now + ${LEASE_SECONDS}, updated_at = @now
    WHERE id = (SELECT id FROM mail_workspace_analysis_jobs WHERE state = 'pending' AND next_attempt_at <= @now
      ORDER BY next_attempt_at, id LIMIT 1)
    RETURNING id, account_id AS accountId, client_message_id AS messageId, source_sha256 AS hash, kind,
      attempt_count AS attempts, lease_until AS leaseUntil
  `);
  const settle = db.prepare(`
    UPDATE mail_workspace_analysis_jobs SET state = @state, error_code = @code, lease_until = NULL,
      result_json = @result, incomplete_reason = @incomplete, analyzer_model = @model,
      analyzer_prompt_version = @promptVersion, analyzed_at = @analyzedAt, updated_at = @now, next_attempt_at = @next,
      agent_message_id = @agentMessageId
    WHERE id = @id AND state = 'analyzing' AND lease_until = @leaseUntil AND lease_until > @now
      AND attempt_count = @attempts
  `);
  const addEvent = db.prepare(`
    INSERT INTO mail_workspace_calendar_events
      (analysis_job_id, event_index, event_kind, title, original_date_text, original_end_text, evidence_excerpt,
       evidence_hash, start_kind, start_date, start_at, end_kind, end_date, end_at, end_provenance, date_provenance,
       reference_kst_date, inferred_year, inference_reason, confidence, resolution_state)
    VALUES (@jobId, @index, @kind, @title, @originalDateText, @originalEndText, @evidenceExcerpt, @evidenceHash,
      @startKind, @startDate, @startAt, @endKind, @endDate, @endAt, @endProvenance, @dateProvenance,
      @referenceKstDate, @inferredYear, @inferenceReason, @confidence, @resolutionState)
  `);
  const filterPages = new Map(Object.entries({ ...FILTERS, ...VARIANTS }).map(([filter, condition]) => [filter, db.prepare(PROJECT + `
    SELECT * FROM classified
    WHERE sourceError IS NULL AND (@accountId IS NULL OR accountId = @accountId) AND (${condition})
      AND (@date IS NULL OR receivedAt < @date OR (receivedAt = @date
        AND (accountId, locationKey, id) > (@afterAccount, @afterLocation, @afterId)))
    ORDER BY receivedAt DESC, accountId, locationKey, id LIMIT @limit
  `)]));
  const currentEvents = `
    WHERE s.error_code IS NULL AND a.status != 'disabled' AND j.state = 'done'
      AND NOT EXISTS (SELECT 1 FROM mail_client_messages newer
        WHERE newer.account_id = m.account_id AND newer.location_key = m.location_key AND newer.id > m.id)
      AND NOT EXISTS (SELECT 1 FROM json_each(m.metadata_json, '$.labelIds') WHERE value IN ('SENT','DRAFT','SPAM','TRASH'))
      AND coalesce(json_extract(m.locator_json, '$.analysisMailboxEligible'), 1) = 1
      AND (@accountId IS NULL OR j.account_id = @accountId)
  `;
  const calendar = db.prepare(EVENT + currentEvents + `
    AND e.resolution_state = 'resolved' AND e.start_date < @until AND coalesce(e.end_date, e.start_date) >= @from
    AND (@date IS NULL OR (e.start_date, e.id) > (@date, @afterId))
    ORDER BY e.start_date, e.id LIMIT @limit
  `);
  const unresolved = db.prepare(EVENT + currentEvents + `
    AND e.resolution_state = 'unresolved' AND e.reference_kst_date >= @from AND e.reference_kst_date < @until
    AND (@date IS NULL OR (e.reference_kst_date, e.id) > (@date, @afterId))
    ORDER BY e.reference_kst_date, e.id LIMIT @limit
  `);
  const eventById = db.prepare(EVENT + ' WHERE e.id = ?');

  return {
    source: id => getSource.get(id),
    agent: (id, accountId) => id == null ? null : getAgent.get(id, accountId),
    message: id => getMessage.get(id),
    isCurrent: id => currentMessage.get(id),
    jobs: (id, hash) => forMessage.all(id, hash),
    invalidate: (id, code) => invalidateSource.run(code, id),
    event: id => eventById.get(id),
    page: (filter, params) => filterPages.get(filter).all(params),
    calendar: (isUnresolved, params) => (isUnresolved ? unresolved : calendar).all(params),
    reserve: db.transaction((params, kinds) => {
      if (!touchSource.run(params).changes) return null;
      for (const kind of kinds) insert.run({ ...params, ...kind });
      return forMessage.all(params.messageId, params.hash);
    }),
    claim: db.transaction(now => {
      advance.run(now, now, now);
      return take.get({ now });
    }),
    finish: db.transaction((job, outcome, now) => {
      if (outcome.state === 'done') {
        const message = currentMessage.get(job.messageId);
        const source = getSource.get(job.messageId);
        if (!message || message.status === 'disabled' || source?.hash !== job.hash || source.code) {
          outcome = { state: 'skipped', code: message?.status === 'disabled'
            ? 'MAIL_CLIENT_ACCOUNT_DISABLED' : source?.code || 'MAIL_CLIENT_LOCATION_STALE' };
        }
      }
      const state = outcome.retry && job.attempts < MAX_ATTEMPTS ? 'pending' : outcome.state;
      const ok = settle.run({
        ...job, state, now, code: outcome.code ?? null, model: outcome.model ?? null,
        promptVersion: outcome.promptVersion ?? null, analyzedAt: state === 'done' ? now : null,
        agentMessageId: outcome.agentMessageId ?? null,
        result: outcome.result ? JSON.stringify(outcome.result) : null,
        incomplete: outcome.incomplete?.length ? JSON.stringify(outcome.incomplete) : null,
        next: state === 'pending' ? now + 30 * 2 ** (job.attempts - 1) : now,
      }).changes === 1;
      if (!ok) return false;
      if (outcome.invalidate) invalidateSource.run(outcome.code, job.messageId);
      if (state === 'done') refreshSource.run({ ...job, now });
      if (state === 'done' && outcome.events) {
        for (const [index, event] of outcome.events.entries()) addEvent.run({ ...event, index, jobId: job.id });
      }
      return true;
    }),
  };
}

module.exports = { createSmartStore, FILTERS, VARIANTS };
