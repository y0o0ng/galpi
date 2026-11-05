'use strict';

// Writes one split's Durability gold for the Laya check. Output holds private text: private dir only.
const fs = require('node:fs');
const path = require('node:path');
const { items } = require('../lib/memory-storage/extractor-labels');

const lastRows = file => new Map(fs.readFileSync(file, 'utf8').trim().split('\n').map(JSON.parse).map(row => [row.itemId, row]));

function exportSplit(dir, split, out) {
  const entries = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')).episodes.filter(e => e.split === split);
  const labels = new Map([...lastRows(path.join(dir, `labels-${split}.jsonl`)), ...lastRows(path.join(dir, `labels-${split}-durability.jsonl`))]);
  const rows = entries.flatMap(entry => ['extractor', 'durability'].flatMap(queue => items(dir, entry, queue)))
    .filter(item => labels.has(item.itemId))
    .map(item => ({ itemId: item.itemId, episodeId: item.episodeId, write: labels.get(item.itemId).decision !== 'NO_STORE',
      anchor: item.anchor, turns: item.evidence.map(({ turnId, role, text }) => ({ turnId, role, text })) }));
  if (rows.length !== labels.size) throw Error('LABEL_WITHOUT_ITEM');
  fs.writeFileSync(out, rows.map(row => JSON.stringify(row)).join('\n') + '\n', { mode: 0o600 });
  return { rows: rows.length, write: rows.filter(row => row.write).length };
}

if (require.main === module) console.log(exportSplit(process.argv[2], process.argv[3], process.argv[4]));
