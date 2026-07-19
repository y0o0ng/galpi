'use strict';

function configError(message, code) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function validateCanonicalOrigin(value) {
  const raw = String(value || '').trim();
  let url;
  try {
    url = new URL(raw);
  } catch {
    configError('WEB_PUSH_CANONICAL_ORIGIN이 올바른 URL이 아닙니다.', 'INVALID_PUSH_ORIGIN');
  }
  if (
    url.protocol !== 'https:'
    || url.username || url.password
    || url.pathname !== '/'
    || url.search || url.hash
  ) {
    configError('WEB_PUSH_CANONICAL_ORIGIN은 경로 없는 HTTPS origin이어야 합니다.', 'INVALID_PUSH_ORIGIN');
  }
  return url.origin;
}

function validateVapidSubject(value) {
  const subject = String(value || '').trim();
  if (/^mailto:[^@\s]+@[^@\s]+$/i.test(subject)) return subject;
  try {
    const url = new URL(subject);
    if (url.protocol === 'https:') return url.toString();
  } catch { /* 아래 공통 오류 */ }
  configError('WEB_PUSH_VAPID_SUBJECT는 mailto: 또는 HTTPS URL이어야 합니다.', 'INVALID_VAPID_SUBJECT');
}

function validateVapidKey(value, name, minLength, maxLength) {
  const key = String(value || '').trim();
  if (
    key.length < minLength
    || key.length > maxLength
    || !/^[A-Za-z0-9_-]+$/.test(key)
  ) {
    configError(`${name} 형식이 올바르지 않습니다.`, 'INVALID_VAPID_KEY');
  }
  return key;
}

function readAssistantPushConfig(env = process.env, options = {}) {
  const requested = env.WEB_PUSH_ENABLED === 'true';
  if (!requested) {
    return {
      enabled: false,
      canonicalOrigin: null,
      publicKey: null,
      privateKey: null,
      subject: null,
    };
  }
  if (options.tasksEnabled !== true) {
    configError('Web Push를 켜려면 일정 기능도 활성화해야 합니다.', 'PUSH_REQUIRES_TASKS');
  }
  return {
    enabled: true,
    canonicalOrigin: validateCanonicalOrigin(env.WEB_PUSH_CANONICAL_ORIGIN),
    publicKey: validateVapidKey(env.WEB_PUSH_VAPID_PUBLIC_KEY, 'WEB_PUSH_VAPID_PUBLIC_KEY', 80, 120),
    privateKey: validateVapidKey(env.WEB_PUSH_VAPID_PRIVATE_KEY, 'WEB_PUSH_VAPID_PRIVATE_KEY', 40, 64),
    subject: validateVapidSubject(env.WEB_PUSH_VAPID_SUBJECT),
  };
}

function publicAssistantPushConfig(config) {
  return {
    enabled: config.enabled === true,
    publicKey: config.enabled ? config.publicKey : null,
    canonicalOrigin: config.enabled ? config.canonicalOrigin : null,
    install: {
      display: 'standalone',
      iosHomeScreenRequired: true,
    },
  };
}

module.exports = {
  publicAssistantPushConfig,
  readAssistantPushConfig,
  validateCanonicalOrigin,
  validateVapidSubject,
};
