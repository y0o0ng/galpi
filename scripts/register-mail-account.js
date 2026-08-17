#!/usr/bin/env node
'use strict';

// 메일 계정을 등록·조회한다. 사람이 드물게 한 번 하는 일이라 CLI로 둔다.
// 등록 API와 에이전트 탭 UI는 화면이 생기는 MAIL-3에서 만든다.
//
//   node scripts/register-mail-account.js list
//   node scripts/register-mail-account.js add naver me@naver.com
//   node scripts/register-mail-account.js add gmail me@gmail.com
//   node scripts/register-mail-account.js disable 2
//   node scripts/register-mail-account.js enable 2
//
// 자격증명은 여기서 다루지 않는다. .env에 있고 DB에는 들어가지 않는다(설계 20.3).

const fs = require('node:fs');

const Database = require('better-sqlite3');

const { createMailStore } = require('../lib/mail/store');
const { resolveRuntimePaths } = require('../lib/runtime-paths');

// 스키마의 주인은 server.js 하나다. 이 스크립트는 마이그레이션을 돌리지 않는다 —
// 여기서도 돌리면 서버와 스크립트가 각자 표를 만들 수 있는 두 경로가 된다.
function openDatabase() {
  const paths = resolveRuntimePaths();
  if (!fs.existsSync(paths.dbPath)) {
    throw new Error(`갈피 DB가 없습니다: ${paths.dbPath}\n서버를 한 번 실행한 뒤 다시 시도하세요.`);
  }
  const db = new Database(paths.dbPath);
  db.pragma('foreign_keys = ON');
  if (db.pragma('foreign_keys', { simple: true }) !== 1) {
    throw new Error('SQLite foreign_keys를 활성화하지 못했습니다.');
  }
  const hasMailTables = db.prepare(`
    SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'mail_accounts'
  `).get().n === 1;
  if (!hasMailTables) {
    db.close();
    throw new Error(
      '이 DB에는 아직 메일 표가 없습니다.\n'
      + '서버를 한 번 실행해 schema migration을 적용한 뒤 다시 시도하세요.',
    );
  }
  return { db, paths };
}

function formatAccount(account, state) {
  const cursor = account.provider === 'gmail'
    ? `historyId=${state?.gmailHistoryId ?? '-'}`
    : `uid=${state?.imapLastUid ?? '-'} validity=${state?.imapUidValidity ?? '-'}`;
  const baseline = state?.baselineComplete === 1 ? 'baseline 완료' : 'baseline 대기';
  const error = account.lastErrorCode ? ` 오류=${account.lastErrorCode}` : '';
  return `  [${account.id}] ${account.provider.padEnd(5)} ${account.address}\n`
    + `        상태=${account.status} ${baseline} ${cursor}${error}`;
}

function list(store) {
  const accounts = store.listAccounts();
  if (accounts.length === 0) {
    console.log('등록된 메일 계정이 없습니다.');
    return;
  }
  console.log(`메일 계정 ${accounts.length}개`);
  for (const account of accounts) {
    console.log(formatAccount(account, store.getSyncState(account.id)));
    console.log(`        저장된 메일 ${store.countMessages(account.id)}통`);
  }
}

function main() {
  const [command, ...args] = process.argv.slice(2);
  if (!command || command === 'help' || command === '--help') {
    console.log([
      '사용법:',
      '  node scripts/register-mail-account.js list',
      '  node scripts/register-mail-account.js add <gmail|naver> <주소>',
      '  node scripts/register-mail-account.js disable <계정 ID>',
      '  node scripts/register-mail-account.js enable <계정 ID>',
    ].join('\n'));
    return 0;
  }

  let db;
  let paths;
  try {
    ({ db, paths } = openDatabase());
  } catch (error) {
    console.error(error.message);
    return 1;
  }
  try {
    console.log(`DB: ${paths.dbPath}\n`);
    const store = createMailStore(db);

    if (command === 'list') {
      list(store);
      return 0;
    }

    if (command === 'add') {
      const [provider, address] = args;
      if (!provider || !address) {
        console.error('provider와 주소가 필요합니다. 예: add naver me@naver.com');
        return 1;
      }
      const before = store.listAccounts().length;
      const account = store.registerAccount({ provider, address });
      const created = store.listAccounts().length > before;
      console.log(created
        ? `등록했습니다: [${account.id}] ${account.provider} ${account.address}`
        : `이미 등록되어 있습니다: [${account.id}] ${account.provider} ${account.address}`);
      console.log('\n다음 tick부터 baseline sync가 돕니다. 과거 메일은 알림이 되지 않습니다.');
      return 0;
    }

    if (command === 'disable' || command === 'enable') {
      const id = Number(args[0]);
      if (!Number.isSafeInteger(id) || id <= 0) {
        console.error('계정 ID가 필요합니다. list로 확인하세요.');
        return 1;
      }
      if (!store.getAccount(id)) {
        console.error(`계정을 찾을 수 없습니다: ${id}`);
        return 1;
      }
      // 켜짐/꺼짐의 정본은 status 하나다. 별도 enabled 열을 두지 않았다.
      store.setAccountStatus(id, command === 'disable' ? 'disabled' : 'active');
      console.log(`[${id}] 상태를 ${command === 'disable' ? 'disabled' : 'active'}로 바꿨습니다.`);
      return 0;
    }

    console.error(`모르는 명령입니다: ${command}`);
    return 1;
  } catch (error) {
    // 잘못된 입력에 스택 트레이스를 쏟지 않는다. 사람이 읽을 한 줄이면 된다.
    console.error(error?.message || '알 수 없는 오류가 발생했습니다.');
    return 1;
  } finally {
    db.close();
  }
}

process.exitCode = main();
