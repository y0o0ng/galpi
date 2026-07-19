'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const Database = require('better-sqlite3');

const { commitFileDatabaseMutation } = require('./topic-mutation');
const { noteContentSha256 } = require('./note-index-state');
const { parseTopicNote, removeQaLogEntry } = require('./topic-store');

const SHA256_PATTERN = /^[a-f0-9]{64}$/;

function rawSha256(value) {
  return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
}

function normalizeTargets(targets) {
  if (!Array.isArray(targets) || targets.length === 0) {
    throw new TypeError('삭제할 Q&A 대상이 필요합니다.');
  }

  const normalized = targets.map(target => {
    const filename = String(target?.filename || '').trim();
    const qaId = String(target?.qaId || '').trim();
    const entryContentSha256 = String(target?.entryContentSha256 || '').trim();
    const decisionId = Number(target?.decisionId);
    const userMessageId = Number(target?.userMessageId);
    const assistantMessageId = Number(target?.assistantMessageId);

    if (path.basename(filename) !== filename || !filename.endsWith('.md')) {
      throw new Error(`루트 Markdown 파일명만 허용합니다: ${filename}`);
    }
    if (!/^qa-[a-z0-9-]+$/i.test(qaId)) throw new Error(`유효하지 않은 qaId입니다: ${qaId}`);
    if (!SHA256_PATTERN.test(entryContentSha256)) {
      throw new Error(`유효하지 않은 Q&A 본문 hash입니다: ${qaId}`);
    }
    for (const [label, value] of [
      ['decisionId', decisionId],
      ['userMessageId', userMessageId],
      ['assistantMessageId', assistantMessageId],
    ]) {
      if (!Number.isSafeInteger(value) || value <= 0) {
        throw new Error(`${qaId}의 ${label}가 올바르지 않습니다.`);
      }
    }
    return { filename, qaId, entryContentSha256, decisionId, userMessageId, assistantMessageId };
  });

  for (const [label, values] of [
    ['qaId', normalized.map(target => target.qaId)],
    ['decisionId', normalized.map(target => target.decisionId)],
  ]) {
    if (new Set(values).size !== values.length) throw new Error(`중복 ${label} 대상이 있습니다.`);
  }
  return normalized.sort((a, b) => a.decisionId - b.decisionId);
}

function assertRow(condition, message) {
  if (!condition) throw new Error(message);
}

async function prepareTopicQaRemoval({ db, vaultPath, targets }) {
  if (!db?.prepare) throw new TypeError('SQLite DB 연결이 필요합니다.');
  const root = path.resolve(String(vaultPath || ''));
  const normalizedTargets = normalizeTargets(targets);
  const noteStatement = db.prepare(`
    SELECT filename, title, note_type AS noteType, archived,
           codex_status AS codexStatus, content_sha256 AS contentSha256,
           indexed_sha256 AS indexedSha256, index_status AS indexStatus
    FROM notes WHERE filename = ? LIMIT 1
  `);
  const chunkStatement = db.prepare(`
    SELECT chunk_id AS qaId, note_filename AS filename, chunk_type AS chunkType,
           source_user_message AS userMessageId,
           source_assistant_message AS assistantMessageId,
           index_status AS indexStatus
    FROM note_chunks WHERE chunk_id = ? LIMIT 1
  `);
  const decisionStatement = db.prepare(`
    SELECT id, qa_id AS qaId, note_filename AS filename, decision, action,
           source_user_message AS userMessageId,
           source_assistant_message AS assistantMessageId
    FROM auto_save_decisions WHERE id = ? LIMIT 1
  `);
  const decisionCountStatement = db.prepare(
    'SELECT COUNT(*) AS count FROM auto_save_decisions WHERE qa_id = ?',
  );
  const messageStatement = db.prepare(
    'SELECT id, role, content FROM messages WHERE id IN (?, ?) ORDER BY id',
  );

  const grouped = new Map();
  for (const target of normalizedTargets) {
    const list = grouped.get(target.filename) || [];
    list.push(target);
    grouped.set(target.filename, list);
  }

  const changes = [];
  const notePlans = [];
  const targetEvidence = [];
  for (const [filename, fileTargets] of grouped) {
    const note = noteStatement.get(filename);
    assertRow(note, `DB에서 대상 노트를 찾지 못했습니다: ${filename}`);
    assertRow(note.noteType === 'topic', `topic 노트만 Q&A를 삭제할 수 있습니다: ${filename}`);
    assertRow(!note.archived, `보관 노트는 이 명령으로 수정할 수 없습니다: ${filename}`);
    assertRow(note.codexStatus !== 'recovery_required', `복구 승인 전에는 수정할 수 없습니다: ${filename}`);
    assertRow(note.indexStatus === 'ready' && note.indexedSha256 === note.contentSha256,
      `재색인 대기 중인 노트는 수정할 수 없습니다: ${filename}`);

    const filepath = path.join(root, filename);
    const raw = await fs.readFile(filepath, 'utf8');
    const parsed = parseTopicNote(raw, { filename });
    assertRow(parsed.parseable && parsed.noteType === 'topic', `QA-LOG를 안전하게 읽을 수 없습니다: ${filename}`);
    assertRow(parsed.contentSha256 === note.contentSha256, `파일과 DB의 노트 hash가 다릅니다: ${filename}`);

    let nextRaw = raw;
    for (const target of fileTargets) {
      const current = parseTopicNote(nextRaw, { filename });
      const entries = current.entries.filter(entry => entry.qaId === target.qaId);
      assertRow(entries.length === 1, `파일의 qaId가 정확히 1개가 아닙니다: ${target.qaId}`);
      assertRow(entries[0].contentSha256 === target.entryContentSha256,
        `승인한 Q&A 본문 hash와 현재 파일이 다릅니다: ${target.qaId}`);

      const chunk = chunkStatement.get(target.qaId);
      assertRow(chunk
        && chunk.filename === filename
        && chunk.chunkType === 'topic_qa'
        && chunk.indexStatus === 'ready'
        && chunk.userMessageId === target.userMessageId
        && chunk.assistantMessageId === target.assistantMessageId,
      `Q&A 청크 출처가 승인 대상과 다릅니다: ${target.qaId}`);

      const decision = decisionStatement.get(target.decisionId);
      assertRow(decision
        && decision.qaId === target.qaId
        && decision.filename === filename
        && decision.decision === 'save'
        && ['created', 'appended'].includes(decision.action)
        && decision.userMessageId === target.userMessageId
        && decision.assistantMessageId === target.assistantMessageId,
      `자동 저장 기록이 승인 대상과 다릅니다: ${target.qaId}`);
      assertRow(decisionCountStatement.get(target.qaId).count === 1,
        `같은 qaId의 자동 저장 기록이 여러 개입니다: ${target.qaId}`);

      const messages = messageStatement.all(target.userMessageId, target.assistantMessageId);
      const userMessage = messages.find(message => message.id === target.userMessageId);
      const assistantMessage = messages.find(message => message.id === target.assistantMessageId);
      assertRow(messages.length === 2
        && userMessage?.role === 'user'
        && assistantMessage?.role === 'assistant',
      `원본 user/assistant 메시지 쌍이 일치하지 않습니다: ${target.qaId}`);

      targetEvidence.push({
        ...target,
        userMessageSha256: rawSha256(userMessage.content),
        assistantMessageSha256: rawSha256(assistantMessage.content),
      });
      nextRaw = removeQaLogEntry(nextRaw, {
        qaId: target.qaId,
        expectedContentSha256: target.entryContentSha256,
      });
    }

    const nextParsed = parseTopicNote(nextRaw, { filename });
    assertRow(nextParsed.parseable && nextParsed.entries.length > 0,
      `마지막 Q&A는 이 명령으로 삭제할 수 없습니다: ${filename}`);
    const nextContentSha256 = noteContentSha256({
      filename,
      title: note.title,
      noteType: 'topic',
      raw: nextRaw,
    });
    changes.push({ filepath, expectedContent: raw, nextContent: nextRaw });
    notePlans.push({
      filename,
      title: note.title,
      currentRawSha256: rawSha256(raw),
      currentContentSha256: note.contentSha256,
      nextContentSha256,
      remainingQaCount: nextParsed.entries.length,
    });
  }

  targetEvidence.sort((a, b) => a.decisionId - b.decisionId);
  notePlans.sort((a, b) => a.filename.localeCompare(b.filename, 'en'));
  const input = { version: 1, targets: targetEvidence, notes: notePlans };
  return {
    plan: {
      status: 'ready',
      inputSha256: rawSha256(JSON.stringify(input)),
      targets: targetEvidence,
      notes: notePlans,
    },
    changes,
  };
}

async function readTopicQaRemovalPlan({ dbPath, vaultPath, targets }) {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    db.pragma('query_only = ON');
    return (await prepareTopicQaRemoval({ db, vaultPath, targets })).plan;
  } finally {
    db.close();
  }
}

async function verifyBackup(backup) {
  if (!backup?.dbDest || !backup?.vaultDest) {
    throw new Error('DB와 vault 백업이 모두 필요합니다.');
  }
  const [dbStat, vaultStat] = await Promise.all([
    fs.stat(backup.dbDest),
    fs.stat(backup.vaultDest),
  ]);
  if (!dbStat.isFile() || dbStat.size === 0 || !vaultStat.isFile() || vaultStat.size === 0) {
    throw new Error('백업 파일이 비어 있거나 올바르지 않습니다.');
  }
}

async function verifyAppliedRemoval({ db, vaultPath, prepared }) {
  const messageStatement = db.prepare('SELECT role, content FROM messages WHERE id = ? LIMIT 1');
  const chunkCount = db.prepare('SELECT COUNT(*) AS count FROM note_chunks WHERE chunk_id = ?');
  const decisionCount = db.prepare('SELECT COUNT(*) AS count FROM auto_save_decisions WHERE id = ? OR qa_id = ?');
  const noteStatement = db.prepare(`
    SELECT content_sha256 AS contentSha256, indexed_sha256 AS indexedSha256,
           index_status AS indexStatus, embedding
    FROM notes WHERE filename = ? LIMIT 1
  `);

  for (const target of prepared.plan.targets) {
    assertRow(chunkCount.get(target.qaId).count === 0, `Q&A 청크 삭제 검증 실패: ${target.qaId}`);
    assertRow(decisionCount.get(target.decisionId, target.qaId).count === 0,
      `자동 저장 기록 삭제 검증 실패: ${target.qaId}`);
    const user = messageStatement.get(target.userMessageId);
    const assistant = messageStatement.get(target.assistantMessageId);
    assertRow(user?.role === 'user' && rawSha256(user.content) === target.userMessageSha256,
      `원본 user 메시지 보존 검증 실패: ${target.userMessageId}`);
    assertRow(assistant?.role === 'assistant' && rawSha256(assistant.content) === target.assistantMessageSha256,
      `원본 assistant 메시지 보존 검증 실패: ${target.assistantMessageId}`);
  }

  for (const notePlan of prepared.plan.notes) {
    const raw = await fs.readFile(path.join(vaultPath, notePlan.filename), 'utf8');
    const parsed = parseTopicNote(raw, { filename: notePlan.filename });
    const note = noteStatement.get(notePlan.filename);
    assertRow(parsed.parseable && parsed.contentSha256 === notePlan.nextContentSha256,
      `삭제 후 파일 검증 실패: ${notePlan.filename}`);
    assertRow(note
      && note.contentSha256 === notePlan.nextContentSha256
      && note.indexedSha256 === null
      && note.indexStatus === 'pending'
      && note.embedding === null,
    `삭제 후 노트 인덱스 상태 검증 실패: ${notePlan.filename}`);
  }
}

async function applyTopicQaRemoval({
  dbPath,
  vaultPath,
  targets,
  expectedInputSha256,
  confirmServiceStopped = false,
  createBackup,
}) {
  if (!confirmServiceStopped) throw new Error('적용 전 서버 중지 확인이 필요합니다.');
  if (!SHA256_PATTERN.test(String(expectedInputSha256 || ''))) {
    throw new Error('유효한 계획 입력 SHA-256이 필요합니다.');
  }
  if (typeof createBackup !== 'function') throw new TypeError('백업 함수가 필요합니다.');

  const preview = await readTopicQaRemovalPlan({ dbPath, vaultPath, targets });
  if (preview.inputSha256 !== expectedInputSha256) {
    throw new Error(`계획 입력 hash가 현재 상태와 다릅니다: expected=${expectedInputSha256} current=${preview.inputSha256}`);
  }
  const backup = await createBackup({ dbPath, vaultPath });
  await verifyBackup(backup);

  const db = new Database(dbPath, { fileMustExist: true });
  try {
    const prepared = await prepareTopicQaRemoval({ db, vaultPath, targets });
    if (prepared.plan.inputSha256 !== expectedInputSha256) {
      throw new Error(`백업 후 계획 입력 hash가 달라졌습니다: expected=${expectedInputSha256} current=${prepared.plan.inputSha256}`);
    }

    const deleteChunk = db.prepare(`
      DELETE FROM note_chunks
      WHERE chunk_id = ? AND note_filename = ?
        AND source_user_message = ? AND source_assistant_message = ?
    `);
    const deleteDecision = db.prepare(`
      DELETE FROM auto_save_decisions
      WHERE id = ? AND qa_id = ? AND note_filename = ?
        AND source_user_message = ? AND source_assistant_message = ?
    `);
    const updateNote = db.prepare(`
      UPDATE notes
      SET content_sha256 = @nextContentSha256,
          indexed_sha256 = NULL,
          embedding = NULL,
          index_status = 'pending',
          codex_status = 'pending',
          source_session = (
            SELECT source_session FROM note_chunks
            WHERE note_filename = @filename AND index_status = 'ready'
            ORDER BY updated_at DESC, id DESC LIMIT 1
          ),
          source_message = (
            SELECT source_assistant_message FROM note_chunks
            WHERE note_filename = @filename AND index_status = 'ready'
            ORDER BY updated_at DESC, id DESC LIMIT 1
          ),
          updated_at = strftime('%s','now')
      WHERE filename = @filename
        AND note_type = 'topic'
        AND content_sha256 = @currentContentSha256
        AND codex_status != 'recovery_required'
    `);

    await commitFileDatabaseMutation({
      db,
      changes: prepared.changes,
      verifyFiles: async () => {
        for (const notePlan of prepared.plan.notes) {
          const raw = await fs.readFile(path.join(vaultPath, notePlan.filename), 'utf8');
          const parsed = parseTopicNote(raw, { filename: notePlan.filename });
          assertRow(parsed.parseable && parsed.contentSha256 === notePlan.nextContentSha256,
            `파일 적용 검증 실패: ${notePlan.filename}`);
        }
      },
      applyDatabase() {
        for (const target of prepared.plan.targets) {
          assertRow(deleteChunk.run(
            target.qaId,
            target.filename,
            target.userMessageId,
            target.assistantMessageId,
          ).changes === 1, `Q&A 청크 삭제 건수가 1이 아닙니다: ${target.qaId}`);
          assertRow(deleteDecision.run(
            target.decisionId,
            target.qaId,
            target.filename,
            target.userMessageId,
            target.assistantMessageId,
          ).changes === 1, `자동 저장 기록 삭제 건수가 1이 아닙니다: ${target.qaId}`);
        }
        for (const notePlan of prepared.plan.notes) {
          assertRow(updateNote.run(notePlan).changes === 1,
            `노트 인덱스 상태 갱신 건수가 1이 아닙니다: ${notePlan.filename}`);
        }
      },
    });

    await verifyAppliedRemoval({ db, vaultPath, prepared });
    return {
      removedQaCount: prepared.plan.targets.length,
      preservedMessageCount: new Set(prepared.plan.targets.flatMap(target => [
        target.userMessageId,
        target.assistantMessageId,
      ])).size,
      pendingNoteCount: prepared.plan.notes.length,
      approvedInputSha256: expectedInputSha256,
      backup,
    };
  } finally {
    db.close();
  }
}

module.exports = {
  applyTopicQaRemoval,
  normalizeTargets,
  prepareTopicQaRemoval,
  readTopicQaRemovalPlan,
};
