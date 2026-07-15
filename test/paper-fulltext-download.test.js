'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  downloadPublicPdf,
  isPublicIp,
  resolvePublicAddresses,
} = require('../lib/paper-fulltext-download');

const PDF = Buffer.from('%PDF-1.7\nmock');

test('public IP validation rejects local and special-use address ranges', () => {
  assert.equal(isPublicIp('8.8.8.8'), true);
  assert.equal(isPublicIp('2606:4700:4700::1111'), true);
  assert.equal(isPublicIp('127.0.0.1'), false);
  assert.equal(isPublicIp('10.0.0.2'), false);
  assert.equal(isPublicIp('100.64.0.1'), false);
  assert.equal(isPublicIp('169.254.169.254'), false);
  assert.equal(isPublicIp('192.168.0.1'), false);
  assert.equal(isPublicIp('::1'), false);
  assert.equal(isPublicIp('::ffff:127.0.0.1'), false);
  assert.equal(isPublicIp('fc00::1'), false);
  assert.equal(isPublicIp('fe80::1'), false);
  assert.equal(isPublicIp('2001:db8::1'), false);
});

test('DNS validation rejects a hostname if any answer is private', async () => {
  await assert.rejects(
    resolvePublicAddresses('papers.example', async () => [
      { address: '93.184.216.34', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ]),
    error => error.code === 'private_pdf_host',
  );
});

test('download validates every redirect before the next request', async () => {
  const requests = [];
  await assert.rejects(
    downloadPublicPdf('https://papers.example/source.pdf', {
      lookup: async hostname => hostname === 'papers.example'
        ? [{ address: '93.184.216.34', family: 4 }]
        : [{ address: '127.0.0.1', family: 4 }],
      requestImpl: async request => {
        requests.push(request.url.toString());
        return {
          statusCode: 302,
          headers: { location: 'http://internal.example/secret.pdf' },
          body: Buffer.alloc(0),
        };
      },
    }),
    error => error.code === 'private_pdf_host',
  );
  assert.deepEqual(requests, ['https://papers.example/source.pdf']);
});

test('download pins validated addresses and returns a bounded PDF response', async () => {
  let receivedAddresses = null;
  const result = await downloadPublicPdf('https://papers.example/source.pdf', {
    lookup: async () => [
      { address: '2606:4700:4700::1111', family: 6 },
      { address: '93.184.216.34', family: 4 },
    ],
    requestImpl: async request => {
      receivedAddresses = request.addresses;
      return {
        statusCode: 200,
        headers: { 'content-type': 'application/pdf; charset=binary' },
        body: PDF,
      };
    },
  });

  assert.deepEqual(receivedAddresses, [
    { address: '93.184.216.34', family: 4 },
    { address: '2606:4700:4700::1111', family: 6 },
  ]);
  assert.deepEqual(result.pdf, PDF);
  assert.equal(result.sourceUrl, 'https://papers.example/source.pdf');
});

test('download rejects non-PDF, oversized, non-standard port, and excessive redirects', async () => {
  const lookup = async () => [{ address: '93.184.216.34', family: 4 }];

  await assert.rejects(
    downloadPublicPdf('https://papers.example/file', {
      lookup,
      requestImpl: async () => ({ statusCode: 200, headers: { 'content-type': 'text/html' }, body: PDF }),
    }),
    error => error.code === 'invalid_pdf_content_type',
  );
  await assert.rejects(
    downloadPublicPdf('https://papers.example/file', {
      lookup,
      maxBytes: PDF.length - 1,
      requestImpl: async () => ({ statusCode: 200, headers: { 'content-type': 'application/pdf' }, body: PDF }),
    }),
    error => error.code === 'pdf_too_large',
  );
  await assert.rejects(
    downloadPublicPdf('https://papers.example:8443/file', { lookup }),
    error => error.code === 'invalid_pdf_url',
  );
  await assert.rejects(
    downloadPublicPdf('https://papers.example/file', {
      lookup,
      maxRedirects: 1,
      requestImpl: async request => ({
        statusCode: 302,
        headers: { location: request.url.pathname === '/file' ? '/again' : '/last' },
        body: Buffer.alloc(0),
      }),
    }),
    error => error.code === 'pdf_too_many_redirects',
  );
});
