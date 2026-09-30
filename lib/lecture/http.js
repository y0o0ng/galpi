'use strict';

// 강의 노트 라우트가 함께 쓰는 응답·입력 도우미.
const KEY_PATTERN = /^[A-Za-z0-9_-]{8,80}$/;

const fail = (res, status, error, code) => res.status(status).json({ error, ...(code ? { code } : {}) });

function idParam(req, res, name = 'id') {
  const value = Number(req.params[name]);
  if (Number.isSafeInteger(value) && value >= 1) return value;
  fail(res, 400, '올바른 ID가 아닙니다.');
  return null;
}

const text = (value, max) => (typeof value === 'string' ? value.trim() : '').slice(0, max + 1);

module.exports = { KEY_PATTERN, fail, idParam, text };
