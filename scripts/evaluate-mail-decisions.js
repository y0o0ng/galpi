#!/usr/bin/env node
'use strict';

require('dotenv').config();
const { normalizeMail } = require('../lib/mail/normalize');
const { buildHints, buildPrompt, SYSTEM_PROMPT } = require('../lib/mail/analyze');
const { FIXTURES } = require('../test/fixtures/mail-decisions/fixtures');

const NOW = Date.parse('2026-08-17T09:10:00+09:00') / 1000;
const categories = ['urgent', 'action_required', 'important', 'info', 'ignore'];
const modes = ['immediate', 'batch', 'silent'];
const predicates = {
  action_required: '사용자가 답장, 제출, 확인, 결제 문제 해결 등 후속 조치를 해야 하는가?',
  reply_required: '사용자가 이메일로 답장해야 하는가?',
  calendar_event: '실제 회의, 면담, 수업 또는 행사 일정이 있는가?',
  deadline_present: '행사 일시와 구별되는 마감일이나 특정 시한이 있는가?',
  attachment_review_required: '요구사항을 이해하거나 처리하려면 첨부파일을 확인해야 하는가?',
};
const questions = [
  { type: 'choice', name: 'category', instructions: '메일의 성격을 분류하라.', choices: [
    { value: 'urgent', description: '긴급하게 대응해야 하는 메일' },
    { value: 'action_required', description: '사용자 행동이 필요한 메일' },
    { value: 'important', description: '중요하지만 즉각적인 행동을 요구하지 않는 메일' },
    { value: 'info', description: '일반 정보성 메일' },
    { value: 'ignore', description: '사용자에게 의미 없는 광고나 스팸' },
  ] },
  { type: 'choice', name: 'notification_mode', instructions: '카테고리와 독립적으로 알림 방식을 선택하라.', choices: [
    { value: 'immediate', description: '바로 알려야 하는 보안 경고, 결제 실패, 긴급 변경 또는 가까운 마감' },
    { value: 'batch', description: '중요하지만 나중에 묶어 알려도 되는 메일' },
    { value: 'silent', description: 'Push 없이 목록과 검색에 남길 메일' },
  ] },
  ...Object.entries(predicates).map(([name, instructions]) => ({ type: 'predicate', name, instructions })),
];

function parseResponse(data) {
  if (!data || !Array.isArray(data.answers) || data.answers.length !== questions.length || typeof data.model !== 'string') throw new Error('invalid_response');
  const answers = {};
  for (const answer of data.answers) {
    const question = questions.find(item => item.name === answer.name);
    if (!question || answers[answer.name]) throw new Error('invalid_response');
    if (answer.type === 'refusal') throw new Error('refusal');
    if (answer.type !== question.type) throw new Error('invalid_response');
    if (question.type === 'choice') {
      if (!question.choices.some(item => item.value === answer.choice) || !Array.isArray(answer.probabilities) || answer.probabilities.length !== question.choices.length ||
        !question.choices.every(item => answer.probabilities.filter(p => p.value === item.value && validProbability(p.probability)).length === 1) ||
        !validProbability(answer.confidence)) throw new Error('invalid_response');
    } else if (!validProbability(answer.probability)) throw new Error('invalid_response');
    answers[answer.name] = answer;
  }
  return answers;
}
function validProbability(value) { return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1; }

async function requestDecision(body, key, fetcher = fetch, timeout = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetcher('https://api.openai.com/v1/decisions', {
      method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: controller.signal,
    });
    if (!response.ok) throw new Error(`http_${response.status}`);
    return await response.json();
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('timeout');
    if (/^http_\d+$/.test(error.message)) throw error;
    throw new Error('network_or_invalid_json');
  } finally { clearTimeout(timer); }
}

function metrics(fixtures, records, runs) {
  const result = { category: { hit: 0, total: 0 }, mode: { hit: 0, total: 0 }, stable: 0, stableTotal: 0,
    ignoreRisk: [], unnecessaryImmediate: [], missedNotification: [], actionMissed: [], injectionPromotion: [] };
  for (const fixture of fixtures) {
    const rows = records.filter(row => row.id === fixture.id && row.answers);
    const hard = field => !(fixture.boundary || []).includes(field);
    if (rows.length === runs) {
      const fields = ['category', 'mode'].filter(hard);
      const counts = new Map();
      for (const row of rows) {
        const key = JSON.stringify(fields.map(field => field === 'category' ? row.answers.category.choice : row.answers.notification_mode.choice));
        counts.set(key, (counts.get(key) || 0) + 1);
      }
      const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
      const chosen = JSON.parse(sorted[0][0]);
      for (const [index, field] of fields.entries()) {
        result[field].total++;
        if (chosen[index] === fixture.expected[field]) result[field].hit++;
      }
      result.stableTotal++;
      if (sorted[0][1] === runs) result.stable++;
    }
    for (const row of rows) {
      const a = row.answers;
      const label = { id: fixture.id, run: row.run };
      if (a.category.choice === 'ignore' &&
        ((hard('category') && ['urgent', 'action_required', 'important'].includes(fixture.expected.category)) ||
        (hard('attention') && fixture.expected.attention === 'action_required'))) result.ignoreRisk.push(label);
      if (hard('mode') && fixture.expected.mode !== 'immediate' && a.notification_mode.choice === 'immediate') result.unnecessaryImmediate.push(label);
      if (hard('mode') && fixture.expected.mode !== 'silent' && a.notification_mode.choice === 'silent') result.missedNotification.push(label);
      if (hard('attention') && fixture.expected.attention === 'action_required' && a.action_required.probability < 0.5) result.actionMissed.push(label);
      if (fixture.id === 'prompt-injection-spam' && (['urgent', 'action_required'].includes(a.category.choice) || a.notification_mode.choice === 'immediate')) result.injectionPromotion.push(label);
    }
  }
  return result;
}

function parseArgs(argv) {
  const args = { runs: 5, only: null, live: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--live') args.live = true;
    else if (argv[i] === '--runs') args.runs = Number(argv[++i]);
    else if (argv[i] === '--only') args.only = argv[++i];
    else throw new Error('unknown_argument');
  }
  if (!Number.isSafeInteger(args.runs) || args.runs < 1) throw new Error('invalid_runs');
  return args;
}
function senderOf(raw) {
  const value = (/^From:[ \t]*(.+)$/m.exec(raw.toString('latin1'))?.[1] || '').trim();
  return (/<([^>]+)>/.exec(value)?.[1] || value).trim().toLowerCase();
}
async function main(argv = process.argv.slice(2), options = {}) {
  const args = parseArgs(argv);
  const fixtures = args.only ? FIXTURES.filter(f => f.id === args.only) : FIXTURES;
  if (!fixtures.length) throw new Error('unknown_fixture');
  const count = fixtures.length * args.runs;
  console.log(`예상 요청 ${count}건 (상한 180건), live=${args.live}`);
  if (count > 180) throw new Error('request_limit');
  if (!args.live) return;
  const key = options.key ?? process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY missing');
  const records = [];
  for (let run = 1; run <= args.runs; run++) {
    for (const fixture of fixtures) {
      let started;
      let data;
      try {
        const normalized = await normalizeMail(fixture.raw);
        const senderAddress = senderOf(fixture.raw);
        const domain = senderAddress.includes('@') ? senderAddress.slice(senderAddress.lastIndexOf('@') + 1) : null;
        const others = fixtures.filter(item => item !== fixture).map(item => senderOf(item.raw));
        const history = { senderCount: others.filter(value => value === senderAddress).length,
          domainCount: domain ? others.filter(value => value.endsWith(`@${domain}`)).length : 0, threadCount: 0 };
        const hints = buildHints({ senderAddress, labels: ['INBOX'], history, preferences: [], normalized });
        const input = buildPrompt({ normalized, hints, receivedAt: NOW - 600, nowSeconds: NOW });
        started = Date.now();
        data = await requestDecision({ model: 'gpt-6-luna', input: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: input }], questions }, key, options.fetcher);
        const answers = parseResponse(data);
        records.push({ id: fixture.id, run, answers, model: data.model, usage: data.usage, latency: Date.now() - started });
      } catch (error) {
        records.push({ id: fixture.id, run, error: started ? error.message : 'input_error', usage: data?.usage, model: data?.model, latency: started ? Date.now() - started : null });
      }
    }
  }
  const latencies = records.map(r => r.latency).filter(Number.isFinite).sort((a, b) => a - b);
  const usage = records.reduce((sum, r) => {
    const u = r.usage;
    if (!u || !Number.isFinite(u.input_tokens) || !Number.isFinite(u.input_tokens_details?.cached_tokens) || !Number.isFinite(u.input_tokens_details?.cache_write_tokens)) { sum.missing++; return sum; }
    sum.input += u.input_tokens;
    sum.cached += u.input_tokens_details.cached_tokens;
    sum.write += u.input_tokens_details.cache_write_tokens;
    return sum;
  }, { input: 0, cached: 0, write: 0, missing: 0 });
  const estimate = ((usage.input - usage.cached - usage.write) * 0.10 + usage.cached * 0.01 + usage.write * 0.125) / 1e6;
  const percentile = p => latencies.length ? latencies[Math.ceil(latencies.length * p) - 1] : null;
  const thresholds = Object.fromEntries([0.3, 0.5, 0.7].map(threshold => [threshold,
    records.filter(r => r.answers).map(r => ({ id: r.id, run: r.run, ...Object.fromEntries(
      Object.keys(predicates).map(name => [name, r.answers[name].probability >= threshold])) }))]));
  console.log(JSON.stringify({ metrics: metrics(fixtures, records, args.runs), calls: count, failures: records.filter(r => r.error).length,
    latencyMs: { p50: percentile(.5), p95: percentile(.95), mean: latencies.length ? latencies.reduce((a, b) => a + b, 0) / latencies.length : null }, thresholds,
    usage, estimatedUsd: usage.missing ? null : estimate, pricing: 'standard short-context, 30m cache write; unavailable if usage missing',
    limitations: '날짜·시각 추출, 요약, 자유형식 action 및 기존 deadline gate 비교 불가. 모델과 API가 모두 다름. predicate 임계값은 진단용.' , records }, null, 2));
  if (records.some(r => r.error)) process.exitCode = 1;
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { questions, parseResponse, requestDecision, metrics, parseArgs, main };
