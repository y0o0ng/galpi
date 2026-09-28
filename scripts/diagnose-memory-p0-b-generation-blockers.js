#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const Database = require('better-sqlite3');
const { historicalSchedule } = require('./freeze-memory-p0-b-generation-inputs');

const INPUT_SHA256 = 'af674739a1cdf5b74e2b4f52994955fec4c84c48bbcb5434f9ffe3194beaf338';
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const canonical = value => `${JSON.stringify(value, null, 2)}\n`;

function attachmentBlocker(targetCount, prefixCount) {
  if (targetCount && prefixCount) return 'TARGET_AND_PREFIX_ATTACHMENT_UNREPLAYABLE';
  if (targetCount) return 'TARGET_ATTACHMENT_UNREPLAYABLE';
  if (prefixCount) return 'PREFIX_ATTACHMENT_UNREPLAYABLE';
  return null;
}

function diagnose({ db, manifestBytes, baselineCommit, implementationCommit }) {
  if (!db.readonly || db.pragma('query_only', { simple: true }) !== 1) {
    throw new Error('readonly=true/query_only=true 연결이 필요합니다.');
  }
  if (sha256(manifestBytes) !== INPUT_SHA256) throw new Error('frozen generation-input manifest SHA 불일치');
  const manifest = JSON.parse(manifestBytes);
  if (manifest.cases?.length !== 79 || manifest.counts?.GENERATION_READY !== 18
    || manifest.counts?.INDETERMINATE_TOOL_REPLAY !== 61
    || manifest.scheduleCounts?.UNRECOVERABLE !== 59
    || new Set(manifest.cases.map(item => item.traceId)).size !== 79) {
    throw new Error('frozen 18/61 generation-input universe 불일치');
  }
  const beforeChanges = db.prepare('SELECT total_changes() AS count').get().count;
  const getTarget = db.prepare(`SELECT id, session_id AS sessionId, created_at AS createdAt
    FROM messages WHERE id=?`);
  const getAttachment = db.prepare(`SELECT a.scope, a.lifecycle_status AS lifecycleStatus,
    b.status AS blobStatus FROM message_attachments ma
    JOIN attachments a ON a.id=ma.attachment_id
    LEFT JOIN attachment_blobs b ON b.id=a.blob_id
    WHERE ma.message_id=? ORDER BY ma.position`);
  const cases = manifest.cases.map(item => {
    const record = { traceId: item.traceId, messageId: item.messageId,
      disposition: item.disposition, blocker: null, scheduleBlocker: null };
    if (item.disposition === 'GENERATION_READY') {
      if (item.scheduleReplay === 'UNRECOVERABLE') throw new Error('ready/schedule 상태 불일치');
      return record;
    }
    if (item.disposition !== 'INDETERMINATE_TOOL_REPLAY') {
      throw new Error('frozen disposition 불일치');
    }
    const target = getTarget.get(item.messageId);
    if (!target || target.createdAt !== item.targetCreatedAt) throw new Error('target identity/time 불일치');
    const schedule = historicalSchedule(db, target, { ASSISTANT_TASKS_ENABLED: 'true' });
    if (schedule.kind !== item.scheduleReplay) throw new Error('frozen schedule replay 상태 불일치');
    if (!schedule.reconstructable && !schedule.reason) throw new Error('schedule diagnostic reason 누락');
    record.scheduleBlocker = schedule.reason || null;
    const targetAttachments = getAttachment.all(item.messageId);
    const prefixAttachments = item.prefixMessageIds.flatMap(id => getAttachment.all(id));
    const attachment = attachmentBlocker(targetAttachments.length, prefixAttachments.length);
    if (attachment) {
      const rows = [...targetAttachments, ...prefixAttachments];
      record.blocker = attachment;
      record.attachment = { targetCount: targetAttachments.length,
        prefixCount: prefixAttachments.length,
        deletedOriginalCount: rows.filter(row => row.lifecycleStatus === 'deleted'
          && row.blobStatus === 'deleted').length };
    } else if (!schedule.reconstructable && schedule.reason) {
      record.blocker = schedule.reason;
    } else {
      throw new Error('TOOL_REPLAY blocker를 재현할 수 없습니다.');
    }
    return record;
  });
  const blockerCounts = Object.fromEntries([...new Set(cases.map(item => item.blocker).filter(Boolean))]
    .sort().map(reason => [reason, cases.filter(item => item.blocker === reason).length]));
  const scheduleBlockerCounts = Object.fromEntries([...new Set(cases.map(item => item.scheduleBlocker).filter(Boolean))]
    .sort().map(reason => [reason, cases.filter(item => item.scheduleBlocker === reason).length]));
  const attachmentOnlyCounts = Object.fromEntries([...new Set(cases.filter(item => !item.scheduleBlocker)
    .map(item => item.blocker).filter(Boolean))].sort()
    .map(reason => [reason, cases.filter(item => !item.scheduleBlocker && item.blocker === reason).length]));
  if (Object.values(scheduleBlockerCounts).reduce((sum, count) => sum + count, 0) !== 59
    || Object.values(attachmentOnlyCounts).reduce((sum, count) => sum + count, 0) !== 2
    || Object.values(blockerCounts).reduce((sum, count) => sum + count, 0) !== 61) {
    throw new Error('frozen 59 schedule / 2 attachment-only blocker 합계 불일치');
  }
  const afterChanges = db.prepare('SELECT total_changes() AS count').get().count;
  if (afterChanges !== beforeChanges) throw new Error('SQLite total_changes()가 증가했습니다.');
  const artifact = { schemaVersion: 1, baselineCommit, implementationCommit,
    inputManifestSha256: INPUT_SHA256,
    counts: { GENERATION_READY: 18, INDETERMINATE_TOOL_REPLAY: 61 },
    blockerCounts, scheduleBlockerCounts, attachmentOnlyCounts,
    safety: { sqliteReadonly: db.readonly, sqliteQueryOnly: true,
      totalChangesDelta: afterChanges - beforeChanges, externalApiCalls: 0, answerGenerations: 0 },
    cases };
  return { artifact, bytes: canonical(artifact) };
}

function main(argv = process.argv.slice(2)) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!['--db', '--manifest', '--baseline-commit', '--implementation-commit', '--output'].includes(argv[i])
      || !argv[i + 1]) throw new Error('필수 DB/manifest/commit/output 인자가 필요합니다.');
    args[argv[i]] = argv[i + 1];
  }
  if (!/^[0-9a-f]{40}$/.test(args['--baseline-commit'] || '')
    || !/^[0-9a-f]{40}$/.test(args['--implementation-commit'] || '')
    || !args['--db'] || !args['--manifest'] || !args['--output']) {
    throw new Error('DB/manifest/commit/output 인자가 올바르지 않습니다.');
  }
  const db = new Database(args['--db'], { readonly: true, fileMustExist: true });
  db.pragma('query_only=ON');
  try {
    const { artifact, bytes } = diagnose({ db,
      manifestBytes: fs.readFileSync(args['--manifest']),
      baselineCommit: args['--baseline-commit'],
      implementationCommit: args['--implementation-commit'] });
    fs.writeFileSync(args['--output'], bytes, { flag: 'wx' });
    process.stdout.write(`${JSON.stringify({ blockerCounts: artifact.blockerCounts,
      artifactSha256: sha256(bytes) })}\n`);
  } finally { db.close(); }
}

module.exports = { attachmentBlocker, diagnose, main };
if (require.main === module) {
  try { main(); } catch (error) {
    console.error(`P0-B blocker diagnostic failed: ${error.message}`);
    process.exitCode = 1;
  }
}
