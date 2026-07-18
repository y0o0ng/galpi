'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const Database = require('better-sqlite3');

const { runDatabaseMigrations } = require('./database-migrations');
const { createTopicChunkStore } = require('./topic-chunk-store');
const {
  auditTopicStore,
  buildTopicRepairPlan,
  parseTopicNote,
  removeQaLogEntry,
  topicQaEntryToChunkContent,
} = require('./topic-store');

const INPUT_SHA256_PATTERN = /^[a-f0-9]{64}$/i;
const SUPPORTED_READY_ACTIONS = new Set([
  'mark_source_missing',
  'reindex_file_qa',
  'refresh_chunk_title_cache',
]);
const SUPPORTED_MANUAL_ACTIONS = new Set([
  'remove_duplicate_file_entry',
]);

async function readTopicRepairPlan({ dbPath, vaultPath }) {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    db.pragma('query_only = ON');
    const audit = await auditTopicStore({ db, vaultPath });
    return { audit, plan: buildTopicRepairPlan(audit) };
  } finally {
    db.close();
  }
}

function selectApprovedOperations(plan, approvedOperationIds = []) {
  const approved = new Set(approvedOperationIds);
  const operationIds = new Set(plan.operations.map(operation => operation.id));
  for (const id of approved) {
    if (!operationIds.has(id)) throw new Error(`현재 계획에 없는 승인 작업입니다: ${id}`);
  }

  const selected = [];
  for (const operation of plan.operations) {
    const action = operation.recommendation?.action;
    if (operation.status === 'ready') {
      if (!SUPPORTED_READY_ACTIONS.has(action)) {
        throw new Error(`아직 자동 적용할 수 없는 작업입니다: ${operation.id} (${action})`);
      }
      selected.push(operation);
      continue;
    }

    if (!approved.has(operation.id)) {
      throw new Error(`수동 승인이 필요합니다: ${operation.id}`);
    }
    if (!SUPPORTED_MANUAL_ACTIONS.has(action)) {
      throw new Error(`승인해도 적용할 수 없는 수동 작업입니다: ${operation.id} (${action})`);
    }
    if (
      action === 'remove_duplicate_file_entry'
      && (
        !operation.recommendation?.preserveQaIdIn
        || !Array.isArray(operation.recommendation?.removeDuplicateFrom)
        || operation.recommendation.removeDuplicateFrom.length === 0
      )
    ) {
      throw new Error(`중복 Q&A 제거 근거가 충분하지 않습니다: ${operation.id}`);
    }
    selected.push(operation);
  }

  return selected;
}

function vaultFilepath(vaultPath, filename) {
  const root = path.resolve(vaultPath);
  const filepath = path.resolve(root, String(filename || ''));
  if (path.dirname(filepath) !== root || !filepath.endsWith('.md')) {
    throw new Error(`잘못된 vault 파일 경로입니다: ${filename}`);
  }
  return filepath;
}

async function atomicWriteFile(filepath, content) {
  const stat = await fs.stat(filepath);
  const tempPath = `${filepath}.repair-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`;
  try {
    await fs.writeFile(tempPath, content, { encoding: 'utf8', mode: stat.mode & 0o777 });
    await fs.rename(tempPath, filepath);
  } catch (error) {
    await fs.rm(tempPath, { force: true }).catch(() => {});
    throw error;
  }
}

async function prepareFileChanges(vaultPath, operations) {
  const changes = new Map();

  for (const operation of operations) {
    if (operation.recommendation?.action !== 'remove_duplicate_file_entry') continue;
    const locations = operation.evidence?.locations || [];
    for (const filename of operation.recommendation.removeDuplicateFrom) {
      const location = locations.find(item => item.filename === filename);
      if (!location?.contentSha256) {
        throw new Error(`중복 Q&A 파일 근거가 없습니다: ${operation.id}/${filename}`);
      }
      const filepath = vaultFilepath(vaultPath, filename);
      let change = changes.get(filename);
      if (!change) {
        const original = await fs.readFile(filepath, 'utf8');
        change = { filename, filepath, original, next: original };
        changes.set(filename, change);
      }
      change.next = removeQaLogEntry(change.next, {
        qaId: operation.target.qaId,
        expectedContentSha256: location.contentSha256,
      });
      const parsed = parseTopicNote(change.next, { filename });
      if (!parsed.parseable) {
        throw new Error(`Q&A 제거 후 토픽 형식 검증에 실패했습니다: ${filename}`);
      }
    }
  }

  return [...changes.values()].sort((a, b) => a.filename.localeCompare(b.filename, 'en'));
}

function resolveReindexSource(operation) {
  const decisions = (operation.evidence?.autoSaveDecisions || [])
    .filter(item => item.decision === 'save');
  if (decisions.length === 0) {
    return {
      sourceSession: null,
      sourceUserMessage: null,
      sourceAssistantMessage: null,
    };
  }
  if (decisions.length !== 1 || decisions[0].noteFilename !== operation.target.filename) {
    throw new Error(`Q&A 출처가 모호해 자동 재색인할 수 없습니다: ${operation.id}`);
  }
  return {
    sourceSession: decisions[0].sourceSession ?? null,
    sourceUserMessage: decisions[0].sourceUserMessage ?? null,
    sourceAssistantMessage: decisions[0].sourceAssistantMessage ?? null,
  };
}

async function readReindexCandidate(vaultPath, operation) {
  const { qaId, filename } = operation.target || {};
  const expectedEntries = (operation.evidence?.fileEntries || []).filter(item => (
    item.qaId === qaId && item.filename === filename
  ));
  if (expectedEntries.length !== 1 || !expectedEntries[0].contentSha256) {
    throw new Error(`Q&A 파일 근거가 정확히 하나여야 합니다: ${operation.id}`);
  }

  const filepath = vaultFilepath(vaultPath, filename);
  const raw = await fs.readFile(filepath, 'utf8');
  const parsed = parseTopicNote(raw, { filename });
  if (!parsed.parseable || parsed.noteType !== 'topic' || parsed.archived) {
    throw new Error(`활성 topic 원문을 안전하게 재색인할 수 없습니다: ${operation.id}`);
  }
  const entries = parsed.entries.filter(entry => entry.qaId === qaId);
  if (entries.length !== 1 || entries[0].contentSha256 !== expectedEntries[0].contentSha256) {
    throw new Error(`Q&A 본문 hash가 계획과 다릅니다: ${operation.id}`);
  }

  return {
    chunkId: qaId,
    noteFilename: filename,
    noteTitle: parsed.title,
    content: topicQaEntryToChunkContent(entries[0]),
    entryContentSha256: entries[0].contentSha256,
    ...resolveReindexSource(operation),
  };
}

function serializeEmbedding(value, operationId) {
  if (
    !Array.isArray(value)
    || value.length === 0
    || value.some(item => !Number.isFinite(item))
  ) {
    throw new Error(`Q&A 임베딩 생성에 실패했습니다: ${operationId}`);
  }
  return JSON.stringify(value);
}

async function prepareReindexedChunks(vaultPath, operations, generateEmbedding) {
  const reindexOperations = operations.filter(operation => (
    operation.recommendation?.action === 'reindex_file_qa'
  ));
  if (reindexOperations.length === 0) return new Map();
  if (typeof generateEmbedding !== 'function') {
    throw new TypeError('Q&A 재색인에는 임베딩 함수가 필요합니다.');
  }

  const prepared = new Map();
  for (const operation of reindexOperations) {
    const candidate = await readReindexCandidate(vaultPath, operation);
    const embedding = await generateEmbedding(candidate.content);
    prepared.set(operation.id, {
      ...candidate,
      embedding: serializeEmbedding(embedding, operation.id),
    });
  }
  return prepared;
}

async function verifyReindexedChunks(vaultPath, operations, prepared) {
  for (const operation of operations) {
    if (operation.recommendation?.action !== 'reindex_file_qa') continue;
    const current = await readReindexCandidate(vaultPath, operation);
    const expected = prepared.get(operation.id);
    if (
      !expected
      || current.entryContentSha256 !== expected.entryContentSha256
      || current.content !== expected.content
      || current.noteTitle !== expected.noteTitle
    ) {
      throw new Error(`Q&A 재색인 입력이 준비 후 달라졌습니다: ${operation.id}`);
    }
  }
}

function applyDatabaseOperations(db, operations, preparedReindexes = new Map()) {
  const chunkStore = createTopicChunkStore(db);
  const markSourceMissing = db.prepare(`
    UPDATE note_chunks
    SET index_status = 'source_missing',
        updated_at = strftime('%s','now')
    WHERE chunk_id = @chunkId
      AND note_filename = @filename
      AND content_sha256 = @contentSha256
      AND index_status = 'ready'
  `);
  const refreshTitle = db.prepare(`
    UPDATE note_chunks
    SET note_title = @currentTitle,
        updated_at = strftime('%s','now')
    WHERE chunk_id = @chunkId
      AND note_filename = @filename
      AND note_title = @cachedTitle
      AND content_sha256 = @contentSha256
      AND index_status = 'ready'
  `);

  for (const operation of operations) {
    const action = operation.recommendation?.action;
    if (action === 'remove_duplicate_file_entry') continue;

    if (action === 'reindex_file_qa') {
      const candidate = preparedReindexes.get(operation.id);
      if (!candidate) throw new Error(`준비된 Q&A 재색인 데이터가 없습니다: ${operation.id}`);
      const upserted = chunkStore.upsert({
        chunkId: candidate.chunkId,
        noteFilename: candidate.noteFilename,
        noteTitle: candidate.noteTitle,
        chunkType: 'topic_qa',
        content: candidate.content,
        sourceSession: candidate.sourceSession,
        sourceUserMessage: candidate.sourceUserMessage,
        sourceAssistantMessage: candidate.sourceAssistantMessage,
      });
      const embedded = chunkStore.updateEmbedding(candidate.chunkId, candidate.embedding);
      if (upserted.changes !== 1 || embedded.changes !== 1) {
        throw new Error(`Q&A 청크를 계획대로 재색인하지 못했습니다: ${operation.id}`);
      }
      continue;
    }

    if (action === 'mark_source_missing') {
      const chunk = operation.evidence?.dbChunk;
      const result = markSourceMissing.run({
        chunkId: operation.target.chunkId,
        filename: operation.target.filename,
        contentSha256: chunk?.contentSha256 || '',
      });
      if (result.changes !== 1) {
        throw new Error(`DB-only 청크 상태가 계획과 달라졌습니다: ${operation.id}`);
      }
      continue;
    }

    if (action === 'refresh_chunk_title_cache') {
      const finding = operation.evidence?.finding;
      const chunk = (operation.evidence?.dbChunks || [])[0];
      const result = refreshTitle.run({
        chunkId: operation.target.chunkId,
        filename: operation.target.filename,
        cachedTitle: finding?.cachedTitle || '',
        currentTitle: finding?.currentTitle || '',
        contentSha256: chunk?.contentSha256 || '',
      });
      if (result.changes !== 1) {
        throw new Error(`청크 제목 상태가 계획과 달라졌습니다: ${operation.id}`);
      }
      continue;
    }

    throw new Error(`지원하지 않는 복구 작업입니다: ${operation.id} (${action})`);
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

async function restoreDatabase(dbPath, backupDbPath) {
  const tempPath = `${dbPath}.repair-restore-${process.pid}-${Date.now()}.tmp`;
  await Promise.all([
    fs.rm(`${dbPath}-wal`, { force: true }),
    fs.rm(`${dbPath}-shm`, { force: true }),
  ]);
  try {
    await fs.copyFile(backupDbPath, tempPath);
    await fs.rename(tempPath, dbPath);
    await Promise.all([
      fs.rm(`${dbPath}-wal`, { force: true }),
      fs.rm(`${dbPath}-shm`, { force: true }),
    ]);
  } finally {
    await fs.rm(tempPath, { force: true }).catch(() => {});
  }
}

async function restoreFiles(changes) {
  for (const change of changes) {
    await atomicWriteFile(change.filepath, change.original);
  }
}

async function applyTopicRepair({
  dbPath,
  vaultPath,
  backupDir,
  expectedInputSha256,
  approvedOperationIds = [],
  confirmServiceStopped = false,
  createBackup,
  generateEmbedding,
}) {
  if (!confirmServiceStopped) {
    throw new Error('적용 전 서버가 중지됐다는 확인이 필요합니다.');
  }
  if (!INPUT_SHA256_PATTERN.test(String(expectedInputSha256 || ''))) {
    throw new Error('유효한 계획 입력 SHA-256이 필요합니다.');
  }
  if (typeof createBackup !== 'function') throw new TypeError('백업 함수가 필요합니다.');

  const before = await readTopicRepairPlan({ dbPath, vaultPath });
  if (before.plan.inputSha256 !== expectedInputSha256) {
    throw new Error(
      `계획 입력 hash가 현재 상태와 다릅니다: expected=${expectedInputSha256} current=${before.plan.inputSha256}`,
    );
  }
  const initialOperations = selectApprovedOperations(before.plan, approvedOperationIds);
  if (initialOperations.length === 0) {
    return {
      appliedOperations: 0,
      appliedOperationIds: [],
      backup: null,
      migration: { currentVersion: null, applied: [] },
      finalAudit: before.audit,
      finalPlan: before.plan,
    };
  }

  const backup = await createBackup({ dbPath, vaultPath, backupDir });
  await verifyBackup(backup);

  let db = null;
  let fileChanges = [];
  try {
    db = new Database(dbPath, { fileMustExist: true });
    const migration = runDatabaseMigrations(db);
    const migratedAudit = await auditTopicStore({ db, vaultPath });
    const migratedPlan = buildTopicRepairPlan(migratedAudit);
    if (migratedPlan.inputSha256 !== expectedInputSha256) {
      throw new Error(
        `migration 후 계획 입력 hash가 달라졌습니다: expected=${expectedInputSha256} current=${migratedPlan.inputSha256}`,
      );
    }
    const operations = selectApprovedOperations(migratedPlan, approvedOperationIds);
    fileChanges = await prepareFileChanges(vaultPath, operations);
    const preparedReindexes = await prepareReindexedChunks(
      vaultPath,
      operations,
      generateEmbedding,
    );
    for (const change of fileChanges) {
      await atomicWriteFile(change.filepath, change.next);
    }
    await verifyReindexedChunks(vaultPath, operations, preparedReindexes);

    db.exec('BEGIN IMMEDIATE');
    let finalAudit;
    let finalPlan;
    try {
      applyDatabaseOperations(db, operations, preparedReindexes);
      finalAudit = await auditTopicStore({ db, vaultPath });
      finalPlan = buildTopicRepairPlan(finalAudit);
      if (!finalAudit.healthy || finalPlan.status !== 'clean') {
        throw new Error(
          `복구 후 감사가 통과하지 못했습니다: healthy=${finalAudit.healthy} status=${finalPlan.status}`,
        );
      }
      db.exec('COMMIT');
    } catch (error) {
      if (db.inTransaction) db.exec('ROLLBACK');
      throw error;
    }

    return {
      appliedOperations: operations.length,
      appliedOperationIds: operations.map(operation => operation.id),
      approvedInputSha256: expectedInputSha256,
      backup,
      migration,
      finalAudit,
      finalPlan,
    };
  } catch (error) {
    if (db) {
      if (db.inTransaction) db.exec('ROLLBACK');
      db.close();
      db = null;
    }
    const rollbackErrors = [];
    try {
      await restoreFiles(fileChanges);
    } catch (restoreError) {
      rollbackErrors.push(`vault 복원 실패: ${restoreError.message}`);
    }
    try {
      await restoreDatabase(dbPath, backup.dbDest);
    } catch (restoreError) {
      rollbackErrors.push(`DB 복원 실패: ${restoreError.message}`);
    }
    if (rollbackErrors.length > 0) {
      throw new Error(`${error.message}; ${rollbackErrors.join('; ')}`, { cause: error });
    }
    throw error;
  } finally {
    if (db) db.close();
  }
}

function formatTopicRepairResult(result) {
  if (result.appliedOperations === 0) {
    return 'Topic repair: no changes needed';
  }
  return [
    'Topic repair: applied',
    `Operations: ${result.appliedOperations}`,
    `Approved input SHA-256: ${result.approvedInputSha256}`,
    `DB backup: ${result.backup.dbDest}`,
    `Vault backup: ${result.backup.vaultDest}`,
    `Final audit: ${result.finalAudit.healthy ? 'passed' : 'failed'}`,
  ].join('\n');
}

module.exports = {
  applyTopicRepair,
  formatTopicRepairResult,
  readTopicRepairPlan,
  selectApprovedOperations,
};
