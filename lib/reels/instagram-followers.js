'use strict';
const fs = require('node:fs');
const path = require('node:path');

function createFollowerStore({ file, userId }) {
  const invalid = () => Object.assign(new Error('INSTAGRAM_FOLLOWERS_STORAGE'), { code: 'INSTAGRAM_FOLLOWERS_STORAGE' });
  function read() {
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (data.accountId !== userId || !Array.isArray(data.samples) || data.samples.some(sample => !Number.isSafeInteger(sample.observedAt) || sample.observedAt < 0 || !Number.isSafeInteger(sample.total) || sample.total < 0)) throw invalid();
      return data.samples.map(sample => ({ observedAt: sample.observedAt, total: sample.total }));
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw invalid();
    }
  }
  return {
    read,
    record(sample) {
      if (!Number.isSafeInteger(sample.observedAt) || sample.observedAt < 0 || !Number.isSafeInteger(sample.total) || sample.total < 0) throw invalid();
      const samples = [...read(), { observedAt: sample.observedAt, total: sample.total }];
      try {
        fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
        const temp = `${file}.${process.pid}.tmp`;
        fs.writeFileSync(temp, JSON.stringify({ accountId: userId, samples }), { mode: 0o600 });
        fs.chmodSync(temp, 0o600);
        fs.renameSync(temp, file);
      } catch { throw invalid(); }
      return samples;
    },
  };
}

function followersForPeriod(samples, startAt, endAt) {
  return samples.filter(sample => sample.observedAt >= startAt && sample.observedAt < endAt)
    .reduce((latest, sample) => !latest || sample.observedAt >= latest.observedAt ? sample : latest, null);
}
module.exports = { createFollowerStore, followersForPeriod };
