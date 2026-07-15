'use strict';

const dns = require('dns/promises');
const http = require('http');
const https = require('https');
const net = require('net');

const DEFAULT_MAX_BYTES = 20 * 1024 * 1024;
const DEFAULT_MAX_REDIRECTS = 5;
const DEFAULT_TIMEOUT_MS = 15000;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

class PaperDownloadError extends Error {
  constructor(message, code = 'paper_download_failed', cause = null) {
    super(message, cause ? { cause } : undefined);
    this.name = 'PaperDownloadError';
    this.code = code;
  }
}

function isPublicIpv4(address) {
  const parts = String(address).split('.').map(Number);
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }

  const [a, b, c] = parts;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return false;
  if (a === 192 && b === 88 && c === 99) return false;
  if (a === 192 && b === 168) return false;
  if (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  return true;
}

function expandIpv6(address) {
  let value = String(address || '').toLowerCase().replace(/^\[|\]$/g, '').split('%')[0];
  if (!value) return null;

  if (value.includes('.')) {
    const lastColon = value.lastIndexOf(':');
    const ipv4 = value.slice(lastColon + 1);
    if (net.isIP(ipv4) !== 4) return null;
    const octets = ipv4.split('.').map(Number);
    value = `${value.slice(0, lastColon)}:${((octets[0] << 8) | octets[1]).toString(16)}:${((octets[2] << 8) | octets[3]).toString(16)}`;
  }

  const halves = value.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || missing < 0) return null;
  const words = [...left, ...Array(missing).fill('0'), ...right].map(word => Number.parseInt(word || '0', 16));
  if (words.length !== 8 || words.some(word => !Number.isInteger(word) || word < 0 || word > 0xffff)) return null;
  return words;
}

function isPublicIpv6(address) {
  const words = expandIpv6(address);
  if (!words) return false;

  const isMappedIpv4 = words.slice(0, 5).every(word => word === 0) && words[5] === 0xffff;
  if (isMappedIpv4) {
    const ipv4 = [words[6] >> 8, words[6] & 0xff, words[7] >> 8, words[7] & 0xff].join('.');
    return isPublicIpv4(ipv4);
  }

  // 공개 PDF에는 전역 유니캐스트만 허용한다. ULA, link-local, multicast,
  // documentation 및 IPv4 전환 주소는 모두 이 범위 밖이거나 아래에서 제외된다.
  if (words[0] < 0x2000 || words[0] > 0x3fff) return false;
  if (words[0] === 0x2001 && [0x0000, 0x0002, 0x000d, 0x0010, 0x0020, 0x0db8].includes(words[1])) return false;
  if (words[0] === 0x2002 || words[0] === 0x3fff) return false;
  return true;
}

function isPublicIp(address) {
  const family = net.isIP(String(address || '').replace(/^\[|\]$/g, ''));
  if (family === 4) return isPublicIpv4(address);
  if (family === 6) return isPublicIpv6(address);
  return false;
}

function normalizeHttpUrl(value) {
  let url;
  try {
    url = new URL(String(value || '').trim());
  } catch {
    throw new PaperDownloadError('공개 PDF URL이 올바르지 않습니다.', 'invalid_pdf_url');
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new PaperDownloadError('공개 PDF는 HTTP(S) URL만 사용할 수 있습니다.', 'invalid_pdf_url');
  }
  if (url.username || url.password || !url.hostname || String(value).length > 2048) {
    throw new PaperDownloadError('공개 PDF URL이 올바르지 않습니다.', 'invalid_pdf_url');
  }
  const expectedPort = url.protocol === 'https:' ? '443' : '80';
  if (url.port && url.port !== expectedPort) {
    throw new PaperDownloadError('공개 PDF는 표준 HTTP(S) 포트만 사용할 수 있습니다.', 'invalid_pdf_url');
  }
  return url;
}

async function resolvePublicAddresses(hostname, lookup = dns.lookup) {
  const host = String(hostname || '').replace(/^\[|\]$/g, '').toLowerCase();
  if (!host || host === 'localhost' || host.endsWith('.localhost')) {
    throw new PaperDownloadError('공개 호스트가 아닌 PDF 주소는 사용할 수 없습니다.', 'private_pdf_host');
  }

  const literalFamily = net.isIP(host);
  const records = literalFamily
    ? [{ address: host, family: literalFamily }]
    : await lookup(host, { all: true, verbatim: true }).catch(error => {
        throw new PaperDownloadError('PDF 호스트의 DNS를 확인하지 못했습니다.', 'pdf_dns_failed', error);
      });
  if (!Array.isArray(records) || records.length === 0) {
    throw new PaperDownloadError('PDF 호스트의 DNS 결과가 없습니다.', 'pdf_dns_failed');
  }

  const normalized = records.map(record => ({
    address: String(record?.address || ''),
    family: Number(record?.family) || net.isIP(String(record?.address || '')),
  }));
  if (normalized.some(record => !record.family || !isPublicIp(record.address))) {
    throw new PaperDownloadError('공개 호스트가 아닌 PDF 주소는 사용할 수 없습니다.', 'private_pdf_host');
  }

  return [...new Map(normalized.map(record => [`${record.family}:${record.address}`, record])).values()]
    .sort((a, b) => a.family - b.family);
}

function createPinnedLookup(addresses) {
  return (_hostname, options, callback) => {
    const requestedFamily = typeof options === 'number' ? options : Number(options?.family) || 0;
    const eligible = addresses.filter(record => !requestedFamily || record.family === requestedFamily);
    if (eligible.length === 0) {
      callback(Object.assign(new Error('검증된 DNS 주소가 없습니다.'), { code: 'ENOTFOUND' }));
      return;
    }
    if (typeof options === 'object' && options?.all) {
      callback(null, eligible.map(record => ({ address: record.address, family: record.family })));
      return;
    }
    callback(null, eligible[0].address, eligible[0].family);
  };
}

function requestWithPinnedAddress({ url, addresses, timeoutMs, maxBytes }) {
  return new Promise((resolve, reject) => {
    const client = url.protocol === 'https:' ? https : http;
    let settled = false;
    const fail = error => {
      if (settled) return;
      settled = true;
      reject(error instanceof PaperDownloadError
        ? error
        : new PaperDownloadError('PDF 다운로드에 실패했습니다.', 'paper_download_failed', error));
    };
    const request = client.request(url, {
      method: 'GET',
      headers: {
        Accept: 'application/pdf',
        'User-Agent': 'ai-council-paper-reader/1.0',
      },
      lookup: createPinnedLookup(addresses),
    }, response => {
      const statusCode = Number(response.statusCode) || 0;
      const headers = response.headers || {};
      if (REDIRECT_STATUSES.has(statusCode) || statusCode !== 200) {
        response.resume();
        if (!settled) {
          settled = true;
          resolve({ statusCode, headers, body: Buffer.alloc(0) });
        }
        return;
      }

      const declaredLength = Number(headers['content-length']);
      if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
        response.destroy();
        fail(new PaperDownloadError('PDF가 20MB 제한을 초과했습니다.', 'pdf_too_large'));
        return;
      }

      const chunks = [];
      let size = 0;
      response.on('data', chunk => {
        size += chunk.length;
        if (size > maxBytes) {
          response.destroy();
          fail(new PaperDownloadError('PDF가 20MB 제한을 초과했습니다.', 'pdf_too_large'));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => {
        if (settled) return;
        settled = true;
        resolve({ statusCode, headers, body: Buffer.concat(chunks, size) });
      });
      response.on('error', fail);
    });
    request.setTimeout(timeoutMs, () => {
      request.destroy(new PaperDownloadError('PDF 다운로드 시간이 초과되었습니다.', 'pdf_download_timeout'));
    });
    request.on('error', fail);
    request.end();
  });
}

function headerValue(headers, name) {
  const value = headers?.[name];
  return Array.isArray(value) ? value[0] : String(value || '');
}

async function downloadPublicPdf(value, options = {}) {
  const maxBytes = Number.isFinite(options.maxBytes) ? Math.max(1, Math.trunc(options.maxBytes)) : DEFAULT_MAX_BYTES;
  const maxRedirects = Number.isFinite(options.maxRedirects)
    ? Math.max(0, Math.min(10, Math.trunc(options.maxRedirects)))
    : DEFAULT_MAX_REDIRECTS;
  const timeoutMs = Number.isFinite(options.timeoutMs) ? Math.max(100, Math.trunc(options.timeoutMs)) : DEFAULT_TIMEOUT_MS;
  const lookup = options.lookup || dns.lookup;
  const requestImpl = options.requestImpl || requestWithPinnedAddress;
  let url = normalizeHttpUrl(value);
  let redirectCount = 0;

  while (true) {
    const addresses = await resolvePublicAddresses(url.hostname, lookup);
    const response = await requestImpl({ url, addresses, timeoutMs, maxBytes });
    const statusCode = Number(response?.statusCode) || 0;

    if (REDIRECT_STATUSES.has(statusCode)) {
      if (redirectCount >= maxRedirects) {
        throw new PaperDownloadError('PDF 리다이렉트 횟수 제한을 초과했습니다.', 'pdf_too_many_redirects');
      }
      const location = headerValue(response.headers, 'location');
      if (!location) throw new PaperDownloadError('PDF 리다이렉트 주소가 없습니다.', 'invalid_pdf_redirect');
      url = normalizeHttpUrl(new URL(location, url).toString());
      redirectCount += 1;
      continue;
    }

    if (statusCode !== 200) {
      throw new PaperDownloadError(`PDF 서버가 HTTP ${statusCode || '오류'}를 반환했습니다.`, 'pdf_http_error');
    }
    const contentType = headerValue(response.headers, 'content-type').split(';')[0].trim().toLowerCase();
    if (contentType !== 'application/pdf') {
      throw new PaperDownloadError('응답 Content-Type이 PDF가 아닙니다.', 'invalid_pdf_content_type');
    }
    const body = Buffer.isBuffer(response.body) ? response.body : Buffer.from(response.body || '');
    if (body.length === 0 || body.length > maxBytes) {
      throw new PaperDownloadError(
        body.length > maxBytes ? 'PDF가 20MB 제한을 초과했습니다.' : 'PDF 데이터가 비어 있습니다.',
        body.length > maxBytes ? 'pdf_too_large' : 'invalid_pdf',
      );
    }
    if (body.subarray(0, Math.min(body.length, 1024)).indexOf('%PDF-') < 0) {
      throw new PaperDownloadError('응답이 올바른 PDF 파일이 아닙니다.', 'invalid_pdf');
    }

    return {
      pdf: body,
      sourceUrl: url.toString(),
      redirectCount,
      contentType,
    };
  }
}

module.exports = {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_REDIRECTS,
  DEFAULT_TIMEOUT_MS,
  PaperDownloadError,
  createPinnedLookup,
  downloadPublicPdf,
  isPublicIp,
  normalizeHttpUrl,
  requestWithPinnedAddress,
  resolvePublicAddresses,
};
