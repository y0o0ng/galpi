'use strict';

// 사서 Codex CLI 자동 업데이트 결과를 Web Push로 한 번 보낸다. update-codex-cli.sh가 부른다.
// Push는 전달 채널이고 정본은 journal(`galpi-codex-update`)이라 큐·재시도를 두지 않는다.
// ponytail: 410으로 만료된 구독을 revoke하지 않는다 — 서버 dispatcher가 다음 발송 때 정리한다.

const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
require('dotenv').config({ path: path.join(ROOT, '.env') });

const Database = require('better-sqlite3');
const webPush = require('web-push');
const { readAssistantPushConfig } = require('../lib/assistant-push-config');
const { normalizePushTopic } = require('../lib/assistant-push');
const { resolveRuntimePaths } = require('../lib/runtime-paths');
const { createWebPushTransport } = require('../lib/web-push-transport');

const RESULTS = new Set(['updated', 'rolled_back', 'broken']);

async function main() {
  const [result, codexVersion] = process.argv.slice(2);
  if (!RESULTS.has(result)) throw new Error(`알 수 없는 결과: ${result}`);
  // 일정이 꺼진 Pi라도 업데이트 알림은 보낸다. 서버 쪽 결합 조건은 여기 해당하지 않는다.
  const config = readAssistantPushConfig(process.env, { tasksEnabled: true });
  if (!config.enabled) return;

  const db = new Database(resolveRuntimePaths({ appRoot: ROOT }).dbPath, { readonly: true, fileMustExist: true });
  const subscriptions = db.prepare(`
    SELECT endpoint, p256dh, auth FROM assistant_push_subscriptions WHERE status = 'active'
  `).all();
  db.close();

  const transport = createWebPushTransport(webPush, config);
  const payload = JSON.stringify({ version: 1, type: 'codex_update', result, codexVersion, url: '/' });
  const delivery = { ttl: 24 * 60 * 60, urgency: 'normal', topic: normalizePushTopic('codex-update') };
  const sent = await Promise.allSettled(subscriptions.map(row => transport.send(
    { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
    payload,
    delivery,
  )));
  const failed = sent.filter(item => item.status === 'rejected').length;
  process.stdout.write(`Codex 업데이트 알림: ${sent.length - failed}/${sent.length} 전송\n`);
}

main().catch(error => {
  process.stderr.write(`Codex 업데이트 알림 실패: ${error.code || error.message}\n`);
  process.exitCode = 1;
});
