'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const Database = require('better-sqlite3');
const { migrations } = require('../lib/database-migrations');
const { createMailStore } = require('../lib/mail/store');
const { createMailClientCache } = require('../lib/mail/client-cache');
const { createMailSmart } = require('../lib/mail/client-smart');
const { createSmartStore } = require('../lib/mail/client-smart-store');
const { validDeadline } = require('../lib/mail/client-smart-analyze');
const { extractCalendar, resolveDate } = require('../lib/mail/client-smart-calendar');
const { clientError } = require('../lib/mail/client-message');

const epoch = iso => Date.parse(iso) / 1000;
const NOW = epoch('2026-11-21T12:00:00+09:00');
const FROM = 'sender@example.com';
const EXAMPLE = '12월 3일까지 참가 신청을 완료하고, 12월 8일 오후 2시에 설명회에 참석해 주세요.';
const CALENDAR = { overflow: false, needsAttachment: false, events: [
  { kind: 'deadline', title: '참가 신청', dateText: '12월 3일', endText: null,
    evidence: '12월 3일까지 참가 신청을 완료하고', direction: 'future', directionEvidence: '까지',
    confidence: 0.92, needsAttachment: false },
  { kind: 'official', title: '설명회', dateText: '12월 8일 오후 2시', endText: null,
    evidence: '12월 8일 오후 2시에 설명회에 참석해 주세요.', direction: 'unspecified', directionEvidence: null,
    confidence: 0.9, needsAttachment: false },
] };
const CLASSIFICATION = {
  category: 'urgent', importance: 0.9, summary: '안내', action: '참가 신청', actionType: 'confirm',
  deadline: { kind: 'date', date: '2026-12-03', at: null }, notificationMode: 'immediate',
  attentionRequired: true, confidence: 0.9, needsAttachmentAnalysis: false, reason: '마감 있음',
};

function fixture(t) {
  const db = new Database(':memory:');
  t.after(() => db.close());
  db.exec('CREATE TABLE messages (id INTEGER PRIMARY KEY, created_at INTEGER)');
  for (const version of [6, 7, 9, 19, 20, 21, 45, 48]) migrations.find(item => item.version === version).up(db);
  const agentStore = createMailStore(db);
  const cache = createMailClientCache(db);
  const accountId = agentStore.registerAccount({ provider: 'gmail', address: 'owner@example.com', now: NOW }).id;
  const raws = new Map();
  const calls = [];
  let time = NOW;
  let sourceOverride;
  let reply = request => request.schemaName === 'mail_workspace_calendar' ? CALENDAR : CLASSIFICATION;
  const count = table => db.prepare('SELECT count(*) AS count FROM ' + table).get().count;
  const mailClient = {
    async openAnalysisSource(id) {
      const cached = cache.getMessage(id);
      if (!cached) throw clientError('MAIL_CLIENT_MESSAGE_NOT_FOUND', 404);
      const account = agentStore.getAccount(cached.accountId);
      if (account.status === 'disabled') throw clientError('MAIL_CLIENT_ACCOUNT_DISABLED', 503);
      const source = { account, cached, row: cached, raw: raws.get(id), agentMessageId: cached.agentMessageId };
      return sourceOverride ? sourceOverride(source) : source;
    },
  };
  const makeService = () => createMailSmart({ db, agentStore, mailClient, model: 'fake-model', now: () => time,
    async callModel(request) { calls.push(request); return reply(request); } });
  const smart = makeService();
  function add({ providerId, labels = ['INBOX'], body = EXAMPLE, receivedAt = NOW, link = false, baseline = false } = {}) {
    const row = {
      locator: { messageId: providerId }, proof: providerId,
      metadata: { subject: '일정 공지', receivedAt, from: [{ address: FROM }], labelIds: labels,
        threadId: providerId, starred: false, important: labels.includes('IMPORTANT') },
    };
    const [id] = cache.saveMessages(accountId, [row], time);
    raws.set(id, Buffer.from([
      'From: ' + FROM, 'To: owner@example.com', 'Subject: Schedule', 'Content-Type: text/plain; charset=utf-8', '', body,
    ].join('\r\n')));
    let agentId;
    if (link) {
      db.prepare(`INSERT INTO mail_messages (account_id, identity_kind, identity_key, gmail_message_id, received_at,
          category, action_text, analysis_state, is_baseline, analyzer_model, analyzer_prompt_version,
          analyzed_at, deadline_kind, deadline_date, decision_confidence, notification_mode)
        VALUES (?, 'gmail_message', ?, ?, ?, ?, '원래 판단', ?, ?, 'agent-model', 'agent-v3', ?, 'date', '2026-12-03', 0.8, 'batch')`)
        .run(accountId, providerId, providerId, receivedAt, baseline ? null : 'info', baseline ? 'skipped' : 'done', Number(baseline), time);
      agentId = agentStore.findMessageByIdentity(accountId, providerId).id;
      assert.ok(cache.bindAgent(agentId, id, accountId, row));
    }
    return { id, agentId };
  }
  return { db, smart, makeService, add, accountId, calls, count, agentStore,
    advance: seconds => { time += seconds; }, setReply: next => { reply = next; },
    overrideSource: next => { sourceOverride = next; }, raws };
}

test('a GET has no analysis side effect and an Agent done result wins without changing its row', async t => {
  const f = fixture(t);
  const { id, agentId } = f.add({ providerId: 'g-info', labels: ['IMPORTANT'], link: true });
  const read = (await f.smart.results([id])).results[0];
  assert.equal(read.classification.source, 'agent');
  assert.equal(read.classification.category, 'info');
  assert.equal(read.classification.model, 'agent-model');
  assert.equal(read.classification.promptVersion, 'agent-v3');
  assert.equal(read.classification.analyzedAt, NOW);
  assert.equal(read.agentMessageId, agentId);
  for (const filter of ['unclassified', 'important', 'action_required']) assert.deepEqual(f.smart.messages(filter, {}).messages, []);
  assert.equal(f.smart.messages('deadline', {}).messages[0].id, id);
  assert.equal(f.count('mail_workspace_analysis_jobs'), 0);
  assert.equal(f.count('mail_workspace_sources'), 0);
  assert.equal(f.calls.length, 0);
  const scheduled = (await f.smart.analyze([id], 'both')).results[0];
  assert.deepEqual(scheduled.jobs.map(job => [job.kind, job.state]), [['classification', 'done'], ['calendar', 'pending']]);
  await f.smart.tick();
  assert.deepEqual(f.calls.map(call => call.schemaName), ['mail_workspace_calendar']);
  assert.equal((await f.smart.results([id])).results[0].classification.category, 'info');
  assert.equal(f.db.prepare('SELECT category FROM mail_messages WHERE id = ?').get(agentId).category, 'info');
});

test('Workspace action variants use only new typed classification results and keep legacy and Agent mail in All', async t => {
  const f = fixture(t);
  const types = ['reply', 'confirm', 'submit', null];
  const messages = types.map((type, index) => f.add({ providerId: 'action-' + index, body: String(type) }));
  const { id: legacy, agentId } = f.add({ providerId: 'legacy-agent-action', link: true });
  f.db.prepare("UPDATE mail_messages SET category = 'action_required' WHERE id = ?").run(agentId);
  const originalAgent = f.db.prepare('SELECT * FROM mail_messages WHERE id = ?').get(agentId);
  await f.smart.analyze(messages.map(row => row.id), 'classification');
  for (const actionType of types) {
    f.setReply(({ schema }) => {
      assert.deepEqual(schema.properties.actionType.enum, types);
      return { ...CLASSIFICATION, category: 'action_required', actionType };
    });
    await f.smart.tick();
  }
  const untyped = f.db.prepare("UPDATE mail_workspace_analysis_jobs SET result_json = json_remove(result_json, '$.actionType') WHERE client_message_id = ?");
  untyped.run(messages[3].id);
  assert.deepEqual(new Set(f.smart.messages('action_required', {}).messages.map(row => row.id)), new Set([legacy, ...messages.map(row => row.id)]));
  for (const [index, variant] of types.slice(0, 3).entries()) {
    const { messages: rows } = f.smart.messages('action_required', { variant });
    assert.deepEqual(rows.map(row => [row.id, row.classification.actionType]), [[messages[index].id, variant]]);
  }
  assert.deepEqual(f.db.prepare('SELECT * FROM mail_messages WHERE id = ?').get(agentId), originalAgent);
  assert.equal(f.count('mail_attention'), 0);
  assert.equal(f.count('mail_push_deliveries'), 0);
  assert.equal(f.calls.length, 4);
});

test('explicit exploration populates both results once, keeps mail and task side effects out, and pages projections', async t => {
  const f = fixture(t);
  const { id, agentId } = f.add({ providerId: 'archived', link: true, labels: [], baseline: true });
  const newer = f.add({ providerId: 'newer', receivedAt: NOW + 1 });
  const page1 = f.smart.messages('unclassified', { limit: 1 });
  assert.equal(page1.coverage.complete, false);
  assert.equal(page1.messages[0].id, newer.id);
  assert.equal(f.smart.messages('unclassified', { limit: 1, cursor: page1.nextCursor }).messages[0].id, id);
  assert.throws(() => f.smart.messages('ignore', { limit: 1, cursor: page1.nextCursor }), { code: 'MAIL_CLIENT_CURSOR_INVALID' });
  assert.equal(await f.smart.tick(), null);
  const [first, retry] = await Promise.all([f.smart.analyze([id], 'both'), f.smart.analyze([id], 'both')]);
  assert.deepEqual(first, retry);
  assert.equal(f.count('mail_workspace_analysis_jobs'), 2);
  assert.equal(f.calls.length, 0);
  const restart = f.makeService();
  await restart.tick();
  assert.deepEqual(restart.messages('deadline', {}).messages, []);
  await restart.tick();
  assert.equal(await restart.tick(), null);
  const summary = (await restart.results([id])).results[0];
  assert.equal(summary.classification.source, 'workspace');
  assert.equal(summary.calendarStatus.state, 'done');
  assert.equal(summary.classification.notificationMode, 'immediate');
  assert.equal(restart.messages('unclassified', {}).messages[0].id, newer.id);
  for (const filter of ['important', 'action_required', 'schedule', 'deadline']) {
    assert.deepEqual(restart.messages(filter, {}).messages.map(item => item.id), [id]);
  }

  const page = restart.calendar({ month: '2026-12', limit: 1 });
  const next = restart.calendar({ month: '2026-12', limit: 1, cursor: page.nextCursor });
  const [deadline, event] = [page.events[0], next.events[0]];
  assert.equal(deadline.kind, 'deadline');
  assert.equal(deadline.startDate, '2026-12-03');
  assert.equal(deadline.startKind, 'date');
  assert.equal(deadline.startAt, null);
  assert.equal(event.kind, 'official');
  assert.equal(event.dateProvenance, 'inferred');
  assert.equal(event.startAt, epoch('2026-12-08T14:00:00+09:00'));
  const details = await restart.calendarEvent(event.id);
  assert.deepEqual(details.taskProposal.value.due, { kind: 'datetime', at: '2026-12-08T14:00:00+09:00' });
  assert.equal(details.event.agentMessageId, agentId);
  assert.equal(details.event.referenceKstDate, '2026-11-21');
  assert.equal(details.event.sourceSha256, summary.sourceSha256);
  assert.equal(details.event.sourceVerification.state, 'verified');
  assert.ok(details.event.evidenceHash);
  await restart.analyze([id], 'both');
  assert.equal(await restart.tick(), null);
  assert.equal(f.count('mail_workspace_calendar_events'), 2);
  for (const table of ['assistant_tasks', 'assistant_reminders', 'mail_attention', 'mail_push_deliveries']) {
    assert.equal(f.count(table), 0, table);
  }
  assert.deepEqual(f.db.prepare('SELECT analysis_state AS state, is_baseline AS baseline FROM mail_messages').get(),
    { state: 'skipped', baseline: 1 });
  assert.ok(!JSON.stringify(f.db.prepare('SELECT * FROM mail_workspace_analysis_jobs').all()).includes(EXAMPLE));
});

test('ineligible labels, missing IDs, disabled accounts and skip rules never submit to a model', async t => {
  const f = fixture(t);
  const banned = ['SENT', 'DRAFT', 'SPAM', 'TRASH'].map(label => f.add({ providerId: label, labels: ['INBOX', label] }).id);
  assert.throws(() => f.smart.analyze(Array(11).fill(1), 'both'), { code: 'MAIL_CLIENT_SMART_INVALID_REQUEST' });
  const result = await f.smart.analyze([...banned, 999], 'both');
  assert.deepEqual(result.results.map(item => item.error.code), [
    ...banned.map(() => 'MAIL_CLIENT_SMART_INELIGIBLE'), 'MAIL_CLIENT_MESSAGE_NOT_FOUND',
  ]);
  const { id } = f.add({ providerId: 'skip' });
  f.agentStore.addPreference({ preferenceType: 'sender', target: FROM, action: 'skip_analysis', now: NOW });
  const skipped = (await f.smart.analyze([id], 'both')).results[0];
  assert.ok(skipped.jobs.every(job => job.state === 'skipped' && job.code === 'MAIL_CLIENT_SMART_PREFERENCE_SKIP'));
  assert.equal((await f.smart.results([id])).results[0].classificationStatus.state, 'skipped');
  assert.equal(f.smart.messages('unclassified', {}).messages[0].calendarStatus.state, 'skipped');
  assert.equal(await f.smart.tick(), null);
  f.db.prepare("UPDATE mail_accounts SET status = 'disabled'").run();
  assert.equal((await f.smart.analyze([id], 'both')).results[0].error.code, 'MAIL_CLIENT_ACCOUNT_DISABLED');
  assert.throws(() => f.smart.messages('unclassified', { accountId: f.accountId }), { code: 'MAIL_CLIENT_ACCOUNT_DISABLED' });
  assert.equal(f.calls.length, 0);
});

test('changed bytes are stale on reads and on further requests, and two cached locations stay separate', async t => {
  const f = fixture(t);
  const one = f.add({ providerId: 'one' }).id;
  const two = f.add({ providerId: 'two' }).id;
  await f.smart.analyze([one, two], 'calendar');
  await f.smart.tick();
  await f.smart.tick();
  const events = f.smart.calendar({ month: '2026-12' }).events;
  assert.equal(events.length, 4);
  const event = events.find(item => item.messageId === one);
  f.raws.set(one, Buffer.from('changed'));
  assert.equal((await f.smart.results([one])).results[0].error.code, 'MAIL_CLIENT_LOCATION_STALE');
  await assert.rejects(f.smart.calendarEvent(event.id), { code: 'MAIL_CLIENT_LOCATION_STALE' });
  assert.equal((await f.smart.analyze([one], 'calendar')).results[0].error.code, 'MAIL_CLIENT_LOCATION_STALE');
  assert.ok(f.smart.calendar({ month: '2026-12' }).events.every(item => item.messageId === two));
  assert.equal(f.count('mail_workspace_analysis_jobs'), 2);
});

test('lease reclaim fences late settlement and bounds retries across restarted workers', async t => {
  const f = fixture(t);
  const { id } = f.add({ providerId: 'lease' });
  await f.smart.analyze([id], 'calendar');
  const first = createSmartStore(f.db, validDeadline);
  const second = createSmartStore(f.db, validDeadline);
  const claim = first.claim(NOW);
  assert.equal(second.claim(NOW), undefined);
  const reclaimed = second.claim(claim.leaseUntil);
  assert.equal(reclaimed.id, claim.id);
  assert.equal(reclaimed.attempts, 2);
  assert.equal(first.finish(claim, { state: 'done', events: [{ broken: true }] }, reclaimed.leaseUntil - 1), false);
  assert.equal(second.finish(reclaimed, { state: 'failed', code: 'TEMPORARY', retry: true }, claim.leaseUntil), true);
  assert.equal(second.claim(claim.leaseUntil + 59), undefined);
  const last = first.claim(claim.leaseUntil + 60);
  assert.equal(last.attempts, 3);
  assert.equal(first.claim(last.leaseUntil), undefined);
  const [failed] = second.jobs(id, claim.hash);
  assert.equal(failed.state, 'failed');
  assert.equal(failed.code, 'MAIL_CLIENT_SMART_LEASE_EXPIRED');
  assert.equal(f.count('mail_workspace_calendar_events'), 0);
});

test('model failure backoff and invalid output are exposed without tasks or partial writes', async t => {
  const f = fixture(t);
  const { id } = f.add({ providerId: 'fail' });
  await f.smart.analyze([id], 'calendar');
  f.setReply(() => { throw new Error('mock timeout with sensitive message'); });
  await f.smart.tick();
  const inRetry = (await f.smart.results([id])).results[0].jobs[0];
  assert.equal(inRetry.state, 'pending');
  assert.equal(inRetry.nextAttemptAt, NOW + 30);
  assert.equal(await f.smart.tick(), null);
  f.advance(30);
  f.setReply(() => ({ events: [{ title: 'invalid' }], overflow: false, needsAttachment: false }));
  await f.smart.tick();
  const failed = (await f.smart.results([id])).results[0].calendarStatus;
  assert.equal(failed.state, 'failed');
  assert.equal(failed.code, 'MAIL_CLIENT_SMART_MODEL_OUTPUT_INVALID');
  for (const table of ['mail_workspace_calendar_events', 'assistant_tasks', 'assistant_reminders']) assert.equal(f.count(table), 0);
});

test('grounded excerpts, truncated and attachment-dependent content, end times and unresolved candidates', async () => {
  const announcement = '12월 8일 14:00-16:00 설명회. 첨부에서 다음 달 중 면담을 확인하세요. 날짜는 추후 공지.';
  const official = { ...CALENDAR.events[1], dateText: '12월 8일 14:00', endText: '16:00',
    evidence: '12월 8일 14:00-16:00 설명회.' };
  const relative = { ...official, title: '면담', dateText: '다음 달 중', endText: null,
    evidence: '첨부에서 다음 달 중 면담을 확인하세요.', needsAttachment: true };
  const { events, incomplete } = await extractCalendar({
    model: 'mock', receivedAt: NOW, normalized: { body: announcement, truncated: true, hasAttachments: true },
    callModel: () => ({ events: [official, official, relative, { ...official, dateText: '12월 9일', title: '가짜' }],
      overflow: true, needsAttachment: false }),
  });
  assert.deepEqual(incomplete, ['source_truncated', 'event_limit', 'attachment_required', 'ungrounded_event']);
  assert.equal(events.length, 2);
  assert.equal(events[0].endAt, epoch('2026-12-08T16:00:00+09:00'));
  assert.equal(events[1].resolutionState, 'unresolved');
  assert.equal(events[1].startDate, null);
});

test('calendar policy uses received KST day for nearest, directed, invalid, ambiguous and leap dates', () => {
  const jan = epoch('2026-01-02T00:01:00+09:00');
  const dec = epoch('2026-12-31T23:59:00+09:00');
  const cases = [
    ['2027년 1월 15일', NOW, 'past', '2027-01-15', 'explicit'],
    ['11월 25일', NOW, 'future', '2026-11-25', 'inferred'],
    ['11월 18일', NOW, 'past', '2026-11-18', 'inferred'],
    ['1월 1일', dec, 'future', '2027-01-01', 'inferred'],
    ['12월 31일', jan, 'past', '2025-12-31', 'inferred'],
    ['2월 29일', epoch('2024-01-01T00:00:00+09:00'), 'unspecified', '2024-02-29', 'inferred'],
    ['2026년 2월 29일', NOW, 'unspecified', undefined, 'unresolved'],
    ['4월 31일', NOW, 'unspecified', undefined, 'unresolved'],
    ['11월 25일', NOW, 'conflict', undefined, 'unresolved'],
    ['1월 1일', epoch('2024-07-02T00:00:00+09:00'), 'unspecified', undefined, 'unresolved'],
    ['다음 달 중', NOW, 'unspecified', undefined, 'unresolved'],
    ['12월 2일 26:59', NOW, 'future', undefined, 'unresolved'],
    ['12월 2일 오후 4시 PST', NOW, 'future', undefined, 'unresolved'],
  ];
  for (const [expression, receivedAt, direction, date, provenance] of cases) {
    const resolved = resolveDate(expression, receivedAt, direction);
    assert.equal(resolved.date, date, expression);
    assert.equal(resolved.provenance, provenance, expression);
    assert.deepEqual(resolveDate(expression, receivedAt, direction), resolved);
  }
  assert.equal(resolveDate('11월 30일', NOW).kind, 'date');
  assert.equal(resolveDate('2026-12-03T23:00UTC', NOW).date, '2026-12-04');
  const js = "const { resolveDate } = require('./lib/mail/client-smart-calendar');"
    + "console.log(JSON.stringify(resolveDate('1월 1일', Number(process.argv[1]), 'future')));";
  const outputs = ['UTC', 'America/Los_Angeles', 'Asia/Seoul'].map(TZ => {
    const result = spawnSync(process.execPath, ['-e', js, String(dec)], { env: { ...process.env, TZ }, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  });
  assert.ok(outputs.every(output => output === outputs[0]));
});

test('a source changed during model work is skipped before model output can become an event', async t => {
  const f = fixture(t);
  const { id } = f.add({ providerId: 'changed-during-model' });
  await f.smart.analyze([id], 'calendar');
  f.setReply(() => {
    f.raws.set(id, Buffer.from('replacement source'));
    return CALENDAR;
  });
  await f.smart.tick();
  const [job] = f.db.prepare('SELECT state, error_code AS code FROM mail_workspace_analysis_jobs').all();
  assert.deepEqual(job, { state: 'skipped', code: 'MAIL_CLIENT_LOCATION_STALE' });
  assert.equal(f.count('mail_workspace_calendar_events'), 0);
  assert.equal(f.count('assistant_tasks'), 0);
});

test('unresolved candidates are shown separately and cannot produce an existing task API proposal', async t => {
  const f = fixture(t);
  const { id } = f.add({ providerId: 'relative', body: '다음 달 중 면담 예정' });
  const candidate = { ...CALENDAR.events[1], title: '면담', dateText: '다음 달 중', evidence: '다음 달 중 면담 예정',
    direction: 'future', directionEvidence: '예정' };
  f.setReply(() => ({ ...CALENDAR, events: [candidate] }));
  await f.smart.analyze([id], 'calendar');
  await f.smart.tick();
  const month = f.smart.calendar({ month: '2026-11' });
  assert.equal(month.events.length, 0);
  assert.equal(month.unresolved.events.length, 1);
  assert.equal(month.unresolved.events[0].startDate, null);
  const detail = await f.smart.calendarEvent(month.unresolved.events[0].id);
  assert.deepEqual(detail.taskProposal, { value: null, code: 'MAIL_CLIENT_SMART_DATE_UNRESOLVED' });
  assert.equal(f.smart.messages('schedule', {}).messages[0].id, id);
  assert.equal(f.smart.messages('deadline', {}).messages.length, 0);
});

test('short model date quotes cannot discard explicit source years or adjacent timezone evidence', async () => {
  const evidence = '2027년 1월 15일 16:00 UTC 설명회 예정';
  const output = { ...CALENDAR, events: [{ ...CALENDAR.events[1], dateText: '1월 15일', evidence }] };
  const result = await extractCalendar({
    callModel: () => output, model: 'fake-model', receivedAt: NOW, normalized: { body: evidence },
  });
  const [event] = result.events;
  assert.equal(event.dateProvenance, 'explicit');
  assert.equal(event.originalDateText, '2027년 1월 15일 16:00 UTC');
  assert.equal(event.startAt, epoch('2027-01-16T01:00:00+09:00'));
  assert.equal(resolveDate('1월 15일 2시', NOW, 'future').reason, 'ambiguous_meridiem');
});

test('calendar year direction comes from the source tense, independently of a deadline', async t => {
  const cases = [
    {
      name: 'completed submission uses the past despite the model citing the cutoff as future',
      evidence: '11월 18일까지 제출했습니다', dateText: '11월 18일', title: '제출',
      direction: 'future', directionEvidence: '까지',
      expected: ['2026-11-18', 'inferred', 'nearest_past'],
    },
    {
      name: 'Korean deadline wording without tense keeps the nearest date',
      evidence: '마감일은 11월 18일까지', dateText: '11월 18일', title: '마감',
      direction: 'future', directionEvidence: '마감일은',
      expected: ['2026-11-18', 'inferred', 'nearest_date'],
    },
    {
      name: 'English due wording without tense keeps the nearest date',
      evidence: 'Application due 11/18', dateText: '11/18', title: 'Application',
      direction: 'future', directionEvidence: 'due',
      expected: ['2026-11-18', 'inferred', 'nearest_date'],
    },
    {
      name: 'last day does not make a cutoff past',
      evidence: 'Last day for application: 11/25', dateText: '11/25', title: 'application',
      direction: 'past', directionEvidence: 'Last day',
      expected: ['2026-11-25', 'inferred', 'nearest_date'],
    },
    {
      name: 'a past weekday is still directional evidence',
      evidence: 'Orientation last Friday, 11/20', dateText: '11/20', title: 'Orientation',
      direction: 'past', directionEvidence: 'last Friday',
      expected: ['2026-11-20', 'inferred', 'nearest_past'],
    },
    {
      name: 'a request to submit establishes a future direction',
      evidence: '11월 25일까지 제출해 주세요', dateText: '11월 25일', title: '제출',
      direction: 'future', directionEvidence: '제출해 주세요',
      expected: ['2026-11-25', 'inferred', 'nearest_future'],
    },
    {
      name: 'the submission request keeps its direction across the year boundary',
      receivedDate: '2026-12-31', evidence: '1월 1일까지 제출해 주세요', dateText: '1월 1일', title: '제출',
      direction: 'unspecified', directionEvidence: null,
      expected: ['2027-01-01', 'inferred', 'nearest_future'],
    },
    {
      name: 'a past event is placed in the prior year when the same month and day are still ahead',
      receivedDate: '2026-01-02', evidence: '지난 1월 6일에 설명회가 열렸습니다', dateText: '1월 6일', title: '설명회',
      direction: 'past', directionEvidence: '지난',
      expected: ['2025-01-06', 'inferred', 'nearest_past'],
    },
    {
      name: 'a past December event stays on the prior side of the January boundary',
      receivedDate: '2026-01-02', evidence: '지난 12월 31일에 설명회가 열렸습니다', dateText: '12월 31일', title: '설명회',
      direction: 'past', directionEvidence: '지난',
      expected: ['2025-12-31', 'inferred', 'nearest_past'],
    },
    {
      name: 'supported future and past cues remain unresolved together',
      evidence: '지난 11월 25일 설명회가 열렸고 앞으로 진행 예정입니다', dateText: '11월 25일', title: '설명회',
      direction: 'future', directionEvidence: '앞으로',
      expected: [null, 'unresolved', 'conflicting_direction'],
    },
    {
      name: 'an explicit source year stays unchanged',
      evidence: '2025년 11월 18일에 설명회가 열렸습니다', dateText: '2025년 11월 18일', title: '설명회',
      direction: 'past', directionEvidence: '열렸습니다',
      expected: ['2025-11-18', 'explicit', 'year_in_source'],
    },
  ];
  for (const { name, receivedDate = '2026-11-21', evidence, dateText, title, direction, directionEvidence, expected } of cases) {
    await t.test(name, async () => {
      const output = { ...CALENDAR, events: [{
        ...CALENDAR.events[1], evidence, dateText, title, direction, directionEvidence,
      }] };
      const { events } = await extractCalendar({
        callModel: () => output, model: 'mock', receivedAt: epoch(receivedDate + 'T12:00:00+09:00'),
        normalized: { body: evidence },
      });
      assert.equal(events.length, 1);
      const [event] = events;
      assert.deepEqual([event.startDate, event.dateProvenance, event.inferenceReason], expected);
      assert.equal(event.referenceKstDate, receivedDate);
      assert.equal(event.originalDateText, dateText);
      assert.equal(event.startKind, expected[0] === null ? null : 'date');
      assert.equal(event.startAt, null);
    });
  }
});
