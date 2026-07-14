#!/usr/bin/env node
'use strict';

const fs = require('fs/promises');
const { extractPdfPages, detectSectionHeadings, DEFAULT_MAX_PDF_BYTES } = require('../lib/paper-fulltext');

const DEFAULT_SOURCE = 'https://arxiv.org/pdf/2412.20138';
const REQUEST_TIMEOUT_MS = 30000;

async function loadPdf(source) {
  if (/^https?:\/\//i.test(source)) {
    const response = await fetch(source, {
      headers: { Accept: 'application/pdf' },
      redirect: 'follow',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`PDF 다운로드 실패: HTTP ${response.status}`);
    const contentLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(contentLength) && contentLength > DEFAULT_MAX_PDF_BYTES) {
      throw new Error('PDF가 20MB 제한을 초과했습니다.');
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > DEFAULT_MAX_PDF_BYTES) throw new Error('PDF가 20MB 제한을 초과했습니다.');
    return buffer;
  }
  return fs.readFile(source);
}

function findEvidence(pages, terms) {
  const evidence = [];
  for (const term of terms) {
    const lowerTerm = term.toLowerCase();
    const matches = pages.filter(item => item.text.toLowerCase().includes(lowerTerm));
    const page = matches.find(item => item.number > 1) || matches[0];
    if (!page) {
      evidence.push({ term, found: false });
      continue;
    }
    const index = page.text.toLowerCase().indexOf(lowerTerm);
    const start = Math.max(0, index - 120);
    evidence.push({
      term,
      found: true,
      page: page.number,
      excerpt: page.text.slice(start, start + 360).replace(/\n+/g, ' '),
    });
  }
  return evidence;
}

async function main() {
  const source = process.argv[2] || DEFAULT_SOURCE;
  const startedAt = process.hrtime.bigint();
  const pdf = await loadPdf(source);
  const extracted = await extractPdfPages(pdf, { minTextChars: 100 });
  const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;

  const report = {
    source,
    bytes: pdf.length,
    pageCount: extracted.pageCount,
    nonEmptyPages: extracted.pages.filter(page => page.charCount > 0).length,
    charCount: extracted.charCount,
    elapsedMs: Math.round(elapsedMs),
    maxRssMb: Math.round(process.resourceUsage().maxRSS / 1024),
    headings: detectSectionHeadings(extracted.pages),
    evidence: findEvidence(extracted.pages, [
      'fundamental analyst',
      'bull researcher',
      'risk management',
      'cumulative returns',
      'sharpe ratio',
      'maximum drawdown',
    ]),
  };

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

main().catch(error => {
  process.stderr.write(`Paper full-text spike failed: ${error.message}\n`);
  process.exitCode = 1;
});
