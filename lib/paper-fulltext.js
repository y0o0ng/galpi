'use strict';

const { PDFParse } = require('pdf-parse');

const DEFAULT_MAX_PDF_BYTES = 20 * 1024 * 1024;
const DEFAULT_MAX_PDF_PAGES = 100;
const DEFAULT_MIN_TEXT_CHARS = 20;

class PaperFullTextError extends Error {
  constructor(message, code = 'paper_fulltext_failed', cause = null) {
    super(message, cause ? { cause } : undefined);
    this.name = 'PaperFullTextError';
    this.code = code;
  }
}

function normalizePageText(value) {
  return String(value || '')
    .replace(/\0/g, '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(line => line.replace(/[\t ]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function toPdfBuffer(input, maxBytes) {
  const buffer = Buffer.isBuffer(input)
    ? input
    : input instanceof Uint8Array
      ? Buffer.from(input.buffer, input.byteOffset, input.byteLength)
      : null;

  if (!buffer || buffer.length === 0) {
    throw new PaperFullTextError('PDF 데이터가 비어 있습니다.', 'invalid_pdf');
  }
  if (buffer.length > maxBytes) {
    throw new PaperFullTextError('PDF가 20MB 제한을 초과했습니다.', 'pdf_too_large');
  }
  if (buffer.subarray(0, Math.min(buffer.length, 1024)).indexOf('%PDF-') < 0) {
    throw new PaperFullTextError('올바른 PDF 파일이 아닙니다.', 'invalid_pdf');
  }
  return buffer;
}

async function extractPdfPages(input, options = {}) {
  const maxBytes = Number.isFinite(options.maxBytes)
    ? Math.max(1, Math.trunc(options.maxBytes))
    : DEFAULT_MAX_PDF_BYTES;
  const minTextChars = Number.isFinite(options.minTextChars)
    ? Math.max(0, Math.trunc(options.minTextChars))
    : DEFAULT_MIN_TEXT_CHARS;
  const maxPages = Number.isFinite(options.maxPages)
    ? Math.max(1, Math.trunc(options.maxPages))
    : DEFAULT_MAX_PDF_PAGES;
  const buffer = toPdfBuffer(input, maxBytes);
  const parserFactory = options.parserFactory || (data => new PDFParse({ data }));
  let parser;

  try {
    parser = parserFactory(buffer);
    const result = await parser.getText({ pageJoiner: '' });
    const pageCount = Number.isInteger(result?.total) && result.total > 0
      ? result.total
      : Array.isArray(result?.pages) ? result.pages.length : 0;
    if (pageCount > maxPages) {
      throw new PaperFullTextError('PDF가 100페이지 제한을 초과했습니다.', 'pdf_too_many_pages');
    }
    const pages = (Array.isArray(result?.pages) ? result.pages : [])
      .map((page, index) => {
        const number = Number.isInteger(page?.num) && page.num > 0 ? page.num : index + 1;
        const text = normalizePageText(page?.text);
        return { number, text, charCount: text.length };
      });
    const text = pages.map(page => page.text).filter(Boolean).join('\n\n');

    if (text.length < minTextChars) {
      throw new PaperFullTextError(
        'PDF에서 검색 가능한 텍스트를 충분히 추출하지 못했습니다.',
        'pdf_text_empty',
      );
    }

    return {
      pageCount,
      pages,
      text,
      charCount: text.length,
    };
  } catch (error) {
    if (error instanceof PaperFullTextError) throw error;
    throw new PaperFullTextError(
      'PDF 텍스트 추출에 실패했습니다.',
      'pdf_parse_failed',
      error,
    );
  } finally {
    if (parser?.destroy) await parser.destroy().catch(() => {});
  }
}

const SECTION_NAMES = new Set([
  'abstract',
  'introduction',
  'background',
  'related work',
  'method',
  'methods',
  'methodology',
  'experiment',
  'experiments',
  'results',
  'discussion',
  'limitations',
  'conclusion',
  'conclusions',
  'references',
]);

function detectSectionHeadings(pages, limit = 60) {
  const headings = [];
  const seen = new Set();

  pageLoop: for (const page of Array.isArray(pages) ? pages : []) {
    for (const rawLine of String(page?.text || '').split('\n')) {
      const text = rawLine.replace(/\s+/g, ' ').trim();
      if (text.length < 3 || text.length > 120) continue;
      const unnumbered = text.replace(/^\d+(?:\.\d+)*[.)]?\s+/, '').trim();
      const normalized = unnumbered.toLowerCase().replace(/[.:]$/, '');
      const numberedHeading = /^(?:\d{1,2}[.)]|\d{1,2}(?:\.\d+)+[.)]?)\s+[A-Z][^.!?]{2,100}$/.test(text);
      const namedHeading = SECTION_NAMES.has(normalized);
      if (!numberedHeading && !namedHeading) continue;

      const key = text.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      headings.push({ page: Number(page?.number) || null, text });
      if (headings.length >= limit) return headings;
      if (normalized === 'references') break pageLoop;
    }
  }

  return headings;
}

module.exports = {
  DEFAULT_MAX_PDF_BYTES,
  DEFAULT_MAX_PDF_PAGES,
  PaperFullTextError,
  detectSectionHeadings,
  extractPdfPages,
  normalizePageText,
};
