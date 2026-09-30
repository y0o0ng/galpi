'use strict';

const { createHash } = require('node:crypto');

const hash = value => createHash('sha256').update(value, 'utf8').digest('hex');

function canonicalAddress({ sourceDomain, sourceKey, locator = '', sourceVersion = '' } = {}) {
  if (typeof sourceDomain !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/.test(sourceDomain)
      || typeof sourceKey !== 'string' || !sourceKey || sourceKey.length > 256
      || typeof locator !== 'string' || locator.length > 256
      || typeof sourceVersion !== 'string' || sourceVersion.length > 256
      || [sourceKey, locator, sourceVersion].some(value => value.includes('\0'))) {
    throw new TypeError('Invalid evidence source address');
  }
  if (sourceDomain === 'conversation_message'
      && (!/^[1-9][0-9]*$/.test(sourceKey)
        || BigInt(sourceKey) > BigInt(Number.MAX_SAFE_INTEGER))) {
    throw new TypeError('conversation_message sourceKey must be a canonical positive decimal string');
  }
  if (sourceDomain === 'conversation_message' && (locator !== '' || sourceVersion !== '')) {
    throw new TypeError('conversation_message v1 locator and sourceVersion must be empty');
  }
  return { sourceDomain, sourceKey, locator, sourceVersion };
}

function evidenceIdFor(address) {
  const { sourceDomain, sourceKey, locator, sourceVersion } = canonicalAddress(address);
  return `ev1_${hash(['xion-evidence-ref-v1', sourceDomain, sourceKey, locator, sourceVersion].join('\0'))}`;
}

function createMemoryEvidenceRegistry(db) {
  if (!db?.prepare || typeof db.transaction !== 'function') throw new TypeError('SQLite DB required');
  const message = db.prepare(`
    SELECT id, session_id AS sessionId, role, content, created_at AS createdAt
    FROM messages WHERE id = ?
  `);
  const byId = db.prepare(`
    SELECT evidence_id AS evidenceId, source_domain AS sourceDomain,
           source_key AS sourceKey, locator, source_version AS sourceVersion,
           content_sha256 AS contentSha256, created_at AS createdAt
    FROM memory_evidence_refs WHERE evidence_id = ?
  `);
  const insert = db.prepare(`
    INSERT INTO memory_evidence_refs
      (evidence_id, source_domain, source_key, locator, source_version, content_sha256)
    VALUES (@evidenceId, @sourceDomain, @sourceKey, @locator, @sourceVersion, @contentSha256)
    ON CONFLICT(source_domain, source_key, locator, source_version) DO NOTHING
  `);

  // Source-domain registration is code-owned. No generic fallback can promote other stores.
  const resolvers = new Map([['conversation_message', address => {
    const row = message.get(Number(address.sourceKey));
    if (!row) throw new Error(`Evidence source not found: conversation_message/${address.sourceKey}`);
    return { ...row, contentSha256: hash(row.content) };
  }]]);

  function resolveAndVerify(address, expected = null) {
    const canonical = canonicalAddress(address);
    const resolver = resolvers.get(canonical.sourceDomain);
    if (!resolver) throw new TypeError(`Unsupported evidence source domain: ${canonical.sourceDomain}`);
    const source = resolver(canonical);
    const evidenceId = evidenceIdFor(canonical);
    if (expected && (expected.evidenceId !== evidenceId
        || expected.sourceDomain !== canonical.sourceDomain
        || expected.sourceKey !== canonical.sourceKey
        || expected.locator !== canonical.locator
        || expected.sourceVersion !== canonical.sourceVersion
        || expected.contentSha256 !== source.contentSha256)) {
      throw new Error(`EvidenceRef integrity mismatch: ${evidenceId}`);
    }
    return { canonical, source, evidenceId };
  }

  function bindOne(address) {
    const { canonical, source, evidenceId } = resolveAndVerify(address);
    insert.run({ ...canonical, evidenceId, contentSha256: source.contentSha256 });
    const evidenceRef = byId.get(evidenceId);
    if (!evidenceRef) throw new Error(`EvidenceRef address collision: ${evidenceId}`);
    resolveAndVerify(canonical, evidenceRef);
    return { evidenceRef, source };
  }

  const registerSource = db.transaction(bindOne);
  const registerSources = db.transaction(addresses => addresses.map(bindOne));

  function resolveEvidenceRef(evidenceId) {
    const evidenceRef = byId.get(evidenceId);
    if (!evidenceRef) throw new Error(`EvidenceRef not found: ${evidenceId}`);
    const { source } = resolveAndVerify(evidenceRef, evidenceRef);
    return { evidenceRef, source };
  }

  return { registerSource, registerSources, resolveEvidenceRef };
}

module.exports = { canonicalAddress, evidenceIdFor, createMemoryEvidenceRegistry };
