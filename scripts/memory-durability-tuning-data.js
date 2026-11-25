'use strict';

// Builds the private data for the preregistered Laya Durability fine-tune. Every item either Luna kept
// (extractor queue) or dropped (durability queue) gets the owner's WRITE / NO_WRITE label. It never calls
// a model and never writes into the repository.
//   node scripts/memory-durability-tuning-data.js <formation-tuning-dir> <out-dir>

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { items } = require('../lib/memory-storage/extractor-labels');

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const QUEUES = [['extractor', ''], ['durability', '-durability']];

function lastLabels(file) {
  const bytes = fs.readFileSync(file);
  const last = new Map();
  for (const line of bytes.toString('utf8').split('\n').filter(Boolean)) {
    const row = JSON.parse(line);
    last.set(row.itemId, row); // later rows win
  }
  return { last, sha256: sha(bytes) };
}

function build(dir, outDir) {
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  fs.mkdirSync(outDir, { recursive: true, mode: 0o700 });
  const out = { schemaVersion: 1, splits: {} };
  for (const split of ['train', 'eval']) {
    const rows = [];
    const labelSha = {};
    const seen = new Set();
    for (const [queue, suffix] of QUEUES) {
      const labels = lastLabels(path.join(dir, `labels-${split}${suffix}.jsonl`));
      labelSha[queue] = labels.sha256;
      for (const entry of manifest.episodes.filter(e => e.split === split)) {
        for (const item of items(dir, entry, queue)) {
          const label = labels.last.get(item.itemId);
          if (!label) throw Error(`UNLABELLED ${split} ${queue} ${item.itemId.slice(0, 8)}`);
          if (seen.has(item.itemId)) throw Error(`DUPLICATE_ITEM ${item.itemId.slice(0, 8)}`);
          seen.add(item.itemId);
          const anchorTurn = item.evidence.find(t => t.turnId === item.anchor.turnId);
          if (!anchorTurn || !anchorTurn.text.includes(item.anchor.text)) throw Error(`ANCHOR_NOT_IN_TURN ${item.itemId.slice(0, 8)}`);
          rows.push({ itemId: item.itemId, episodeId: item.episodeId, queue, write: label.decision !== 'NO_STORE',
            anchor: { turnId: item.anchor.turnId, text: item.anchor.text },
            turns: item.evidence.map(t => ({ turnId: t.turnId, role: t.role, text: t.text })) });
        }
      }
    }
    const file = path.join(outDir, `data-${split}.jsonl`);
    fs.writeFileSync(file, rows.map(r => JSON.stringify(r)).join('\n') + '\n', { mode: 0o600 });
    const write = rows.filter(r => r.write).length;
    out.splits[split] = { items: rows.length, episodes: new Set(rows.map(r => r.episodeId)).size, write, noWrite: rows.length - write,
      lunaFalseWrite: rows.filter(r => r.queue === 'extractor' && !r.write).length,
      lunaMisses: rows.filter(r => r.queue === 'durability' && r.write).length,
      labelsSha256: labelSha, dataSha256: sha(fs.readFileSync(file)) };
  }
  fs.writeFileSync(path.join(outDir, 'data-manifest.json'), JSON.stringify(out, null, 1), { mode: 0o600 });
  return out;
}

if (require.main === module) {
  const [dir, outDir] = process.argv.slice(2);
  if (!dir || !outDir) { console.error('usage: memory-durability-tuning-data.js <formation-tuning-dir> <out-dir>'); process.exit(1); }
  console.log(JSON.stringify(build(dir, outDir), null, 1));
}

module.exports = { build };
