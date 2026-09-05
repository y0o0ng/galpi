'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { assertBindIsAuthenticated, isLoopbackHost, hasLocalApiOrigin } = require('../lib/bind-guard');

const ROOT = path.resolve(__dirname, '..');
const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

test('loopback 바인드는 토큰이 없어도 통과한다', () => {
  for (const host of ['127.0.0.1', '::1', 'localhost']) {
    assert.doesNotThrow(() => assertBindIsAuthenticated(host, ''));
    assert.ok(isLoopbackHost(host));
  }
});

test('토큰이 있으면 어디에 바인드해도 통과한다', () => {
  assert.doesNotThrow(() => assertBindIsAuthenticated('0.0.0.0', 'secret'));
  assert.doesNotThrow(() => assertBindIsAuthenticated('192.168.0.10', 'secret'));
});

test('loopback 밖 + 토큰 없음은 거부한다', () => {
  // 예전에는 이 조합이 경고만 내고 서버가 그대로 떴다. 소켓이 열린 뒤의 경고라
  // 읽기 전에 LAN의 누구나 API를 호출할 수 있었다.
  for (const host of ['0.0.0.0', '::', '192.168.0.10']) {
    assert.throws(() => assertBindIsAuthenticated(host, ''), /API_TOKEN/);
  }
});

test('빈 문자열·공백·undefined는 토큰이 없는 것이다', () => {
  assert.throws(() => assertBindIsAuthenticated('0.0.0.0', undefined), /API_TOKEN/);
  assert.throws(() => assertBindIsAuthenticated('0.0.0.0', null), /API_TOKEN/);
  assert.throws(() => assertBindIsAuthenticated('0.0.0.0', ''), /API_TOKEN/);
});

test('검사는 listen 앞에서 돈다', () => {
  // 뒤에서 돌면 소켓이 이미 열린 뒤라 막는 의미가 없다.
  const guard = server.indexOf('assertBindIsAuthenticated(HOST, API_TOKEN)');
  const listen = server.indexOf('app.listen(PORT, HOST');
  assert.ok(guard > 0 && listen > 0, '가드와 listen을 모두 찾아야 한다');
  assert.ok(guard < listen, 'assertBindIsAuthenticated가 app.listen보다 앞에 있어야 한다');
});

test('토큰이 없을 때 loopback 아닌 요청은 API에서도 막는다', () => {
  // 리버스 프록시가 외부 요청을 loopback으로 넘기면 기동 검사를 통과하고도 열린다.
  const at = server.indexOf('function requireApiToken');
  const body = server.slice(at, at + 700);
  assert.match(body, /if \(!API_TOKEN\)/);
  assert.match(body, /isLoopbackRequest\(req\)/);
  assert.match(body, /hasLocalApiOrigin\(req\)/);
});

test('무토큰 개발 API는 local Host와 같은 Origin만 허용한다', () => {
  const check = (headers, protocol = 'http') => hasLocalApiOrigin({ protocol, get: name => headers[name] });
  for (const Host of ['localhost:3000', '127.0.0.1:3000', '[::1]:3000', 'LOCALHOST:3000', 'localhost:80']) {
    assert.equal(check({ Host }), true, Host);
    assert.equal(check({ Host, Origin: new URL(`http://${Host}`).origin, 'Sec-Fetch-Site': 'same-origin' }), true);
    assert.equal(check({ Host, 'Sec-Fetch-Site': 'none' }), true);
  }
  assert.equal(check({ Host: 'localhost:443', Origin: 'https://localhost' }, 'https'), true);
  for (const Host of [undefined, '', 'evil.example', 'localhost.evil.example', 'evil.localhost',
    '127.0.0.1.evil.example', '127.0.0.2', '0.0.0.0', '2130706433', '127.1',
    'evil@localhost', 'localhost/path', 'localhost#evil', 'localhost:99999',
    'localhost:', 'localhost:abc', 'localhost:3000,evil.example', '[::1', '::1']) {
    assert.equal(check({ Host }), false, String(Host));
  }
  for (const Origin of ['', 'null', 'http://evil.example', 'http://localhost:3001',
    'https://localhost:3000', 'http://127.0.0.1:3000', 'http://localhost:3000.evil.example',
    'http://localhost:3000/path', 'http://localhost:3000 http://evil.example']) {
    assert.equal(check({ Host: 'localhost:3000', Origin }), false, Origin);
  }
  for (const site of ['cross-site', 'same-site', '', 'unknown']) {
    assert.equal(check({ Host: 'localhost:3000', 'Sec-Fetch-Site': site }), false, site);
  }
  assert.equal(check({ Host: 'evil.example', 'X-Forwarded-Host': 'localhost:3000',
    'X-Forwarded-For': '127.0.0.1', 'X-Forwarded-Proto': 'http' }), false);
});

test('보안 헤더가 정적 서빙보다 먼저 붙는다', () => {
  const headers = server.indexOf("res.setHeader('Content-Security-Policy'");
  const statics = server.indexOf('express.static(path.join(__dirname');
  assert.ok(headers > 0 && statics > 0);
  assert.ok(headers < statics, '헤더 미들웨어가 express.static보다 앞이어야 한다');
  for (const name of ['X-Content-Type-Options', 'Referrer-Policy', 'X-Frame-Options']) {
    assert.ok(server.includes(`res.setHeader('${name}'`), `${name}이 있어야 한다`);
  }
});

test('CSP가 스크립트를 self로 묶고 프레이밍을 막는다', () => {
  const at = server.indexOf('const CSP = [');
  const block = server.slice(at, server.indexOf("].join('; ')", at));
  assert.match(block, /"script-src 'self'"/);
  assert.match(block, /"object-src 'none'"/);
  assert.match(block, /"frame-ancestors 'none'"/);
  assert.match(block, /"base-uri 'none'"/);
  // `'unsafe-eval'`이 들어오면 CSP의 의미가 대부분 사라진다.
  assert.ok(!block.includes("'unsafe-eval'"), "script-src에 'unsafe-eval'을 넣지 않는다");
});
