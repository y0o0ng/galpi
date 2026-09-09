#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { sha256RawBytes } = require('../lib/memory-inference-p1b6-skeletons');
const {
  RENDERER_IDENTITY,
  renderVisibleItem,
  validateSurfaceBatch,
} = require('../lib/memory-inference-p1b6-surfaces');

const ROOT = path.resolve(__dirname, '..');
const PACKET_IDENTITY = 'xion-local-memory-inference-p1b6-source-audit-packet-v1';
const PROTOCOL_PATH = 'fixtures/local-memory-inference-p1b6-source-audit-protocol.json';
const PROTOCOL_IDENTITY = 'p1b6-source-bundle-completeness-audit-v1';

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!['--input', '--output'].includes(flag) || !value || Object.hasOwn(values, flag)) {
      throw new Error('Usage: --input <surface-batch.json> --output <audit-packet.json>');
    }
    values[flag] = value;
  }
  if (!values['--input'] || !values['--output']) {
    throw new Error('Usage: --input <surface-batch.json> --output <audit-packet.json>');
  }
  return { inputPath: values['--input'], outputPath: values['--output'] };
}

function loadProtocol() {
  const bytes = fs.readFileSync(path.join(ROOT, PROTOCOL_PATH));
  const protocol = JSON.parse(bytes.toString('utf8'));
  if (protocol.name !== 'xion-local-memory-inference-p1b6-source-audit-protocol-v1'
    || protocol.protocolIdentity !== PROTOCOL_IDENTITY
    || JSON.stringify(protocol.reviewGate) !== JSON.stringify({
      eligibleForHumanSemanticReview: ['PASS'], failClosed: ['FAIL', 'UNCERTAIN'],
    })) throw new TypeError('P1-B6 source-audit protocol is invalid');
  return { protocol, sha256: sha256RawBytes(bytes) };
}

function opaqueAuditRowId(batchSha256, itemId) {
  return `p1b6-audit-${crypto.createHash('sha256')
    .update(`${PROTOCOL_IDENTITY}\0${batchSha256}\0${itemId}`).digest('hex').slice(0, 16)}`;
}

function buildAuditPacket(rawBatchBytes) {
  const batch = validateSurfaceBatch(JSON.parse(Buffer.from(rawBatchBytes).toString('utf8')));
  const batchSha256 = sha256RawBytes(rawBatchBytes);
  const protocol = loadProtocol();
  const episodes = new Map(batch.sourceEpisodes.map(row => [row.sourceEpisodeId, row]));
  return {
    name: PACKET_IDENTITY,
    sourceBatch: { identity: batch.name, batchId: batch.batchId, sha256: batchSha256 },
    rendererIdentity: RENDERER_IDENTITY,
    sourceAuditProtocol: { identity: protocol.protocol.protocolIdentity, sha256: protocol.sha256 },
    rows: batch.items.map(item => ({
      auditRowId: opaqueAuditRowId(batchSha256, item.itemId),
      sourceEpisode: {
        turns: episodes.get(item.sourceEpisodeId).turns.map(turn => ({ ...turn })),
      },
      selectedBundle: renderVisibleItem(batch, item),
    })),
  };
}

function writeAuditPacket(inputPath, outputPath) {
  if (fs.existsSync(outputPath)) throw new Error(`Existing output will not be overwritten: ${outputPath}`);
  const packet = buildAuditPacket(fs.readFileSync(inputPath));
  fs.writeFileSync(outputPath, `${JSON.stringify(packet, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  return packet;
}

function main(argv = process.argv.slice(2)) {
  const { inputPath, outputPath } = parseArgs(argv);
  writeAuditPacket(inputPath, outputPath);
  process.stdout.write(`Built P1-B6 source-audit packet: ${outputPath}\n`);
  return 0;
}

module.exports = {
  PACKET_IDENTITY,
  PROTOCOL_IDENTITY,
  PROTOCOL_PATH,
  buildAuditPacket,
  loadProtocol,
  main,
  opaqueAuditRowId,
  parseArgs,
  writeAuditPacket,
};

if (require.main === module) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(`P1-B6 source-audit packet build failed: ${error.message}`);
    process.exitCode = 1;
  }
}
