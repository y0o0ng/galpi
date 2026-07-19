'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  publicAssistantPushConfig,
  readAssistantPushConfig,
} = require('../lib/assistant-push-config');

function enabledEnv(overrides = {}) {
  return {
    WEB_PUSH_ENABLED: 'true',
    WEB_PUSH_CANONICAL_ORIGIN: 'https://galpi.example.ts.net',
    WEB_PUSH_VAPID_PUBLIC_KEY: 'A'.repeat(87),
    WEB_PUSH_VAPID_PRIVATE_KEY: 'B'.repeat(43),
    WEB_PUSH_VAPID_SUBJECT: 'mailto:operator@example.com',
    ...overrides,
  };
}

test('push config is inert by default and never exposes private VAPID values', () => {
  const disabled = readAssistantPushConfig({}, { tasksEnabled: false });
  assert.deepEqual(publicAssistantPushConfig(disabled), {
    enabled: false,
    publicKey: null,
    canonicalOrigin: null,
    install: { display: 'standalone', iosHomeScreenRequired: true },
  });

  const enabled = readAssistantPushConfig(enabledEnv(), { tasksEnabled: true });
  assert.equal(enabled.canonicalOrigin, 'https://galpi.example.ts.net');
  assert.equal(enabled.subject, 'mailto:operator@example.com');
  assert.deepEqual(publicAssistantPushConfig(enabled), {
    enabled: true,
    publicKey: 'A'.repeat(87),
    canonicalOrigin: 'https://galpi.example.ts.net',
    install: { display: 'standalone', iosHomeScreenRequired: true },
  });
  assert.equal('privateKey' in publicAssistantPushConfig(enabled), false);
  assert.equal('subject' in publicAssistantPushConfig(enabled), false);
});

test('enabled push config fails closed on task, origin, subject, and key mistakes', () => {
  assert.throws(
    () => readAssistantPushConfig(enabledEnv(), { tasksEnabled: false }),
    error => error.code === 'PUSH_REQUIRES_TASKS',
  );
  assert.throws(
    () => readAssistantPushConfig(enabledEnv({ WEB_PUSH_CANONICAL_ORIGIN: 'http://galpi.test' }), { tasksEnabled: true }),
    error => error.code === 'INVALID_PUSH_ORIGIN',
  );
  assert.throws(
    () => readAssistantPushConfig(enabledEnv({ WEB_PUSH_CANONICAL_ORIGIN: 'https://galpi.test/app' }), { tasksEnabled: true }),
    error => error.code === 'INVALID_PUSH_ORIGIN',
  );
  assert.throws(
    () => readAssistantPushConfig(enabledEnv({ WEB_PUSH_VAPID_SUBJECT: 'operator@example.com' }), { tasksEnabled: true }),
    error => error.code === 'INVALID_VAPID_SUBJECT',
  );
  assert.throws(
    () => readAssistantPushConfig(enabledEnv({ WEB_PUSH_VAPID_PRIVATE_KEY: 'secret' }), { tasksEnabled: true }),
    error => error.code === 'INVALID_VAPID_KEY',
  );
});
