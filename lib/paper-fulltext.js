'use strict';

const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const { PDFParse } = require('pdf-parse');

const DEFAULT_MAX_PDF_BYTES = 20 * 1024 * 1024;
const DEFAULT_MAX_PDF_PAGES = 100;
const DEFAULT_MIN_TEXT_CHARS = 20;
const DEFAULT_CHUNK_TARGET_CHARS = 1400;
const DEFAULT_CHUNK_MAX_CHARS = 1800;
const DEFAULT_CHUNK_OVERLAP_CHARS = 320;
const PAPER_SOURCE_DIR = '.paper-sources';
const PAPER_PARSER_VERSION = 'pdf-parse@2.4.5';

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

function toPdfBuffer(input, maxBytes = DEFAULT_MAX_PDF_BYTES) {
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

function parseSectionHeading(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (text.length < 3 || text.length > 120) return null;
  const unnumbered = text.replace(/^\d+(?:\.\d+)*[.)]?\s+/, '').trim();
  const normalized = unnumbered.toLowerCase().replace(/[.:]$/, '');
  const sentenceLike = /[,;]/.test(unnumbered)
    && /\b(?:is|are|was|were|has|have|had|shows?|demonstrates?|indicates?)\b/i.test(unnumbered);
  const numbered = !sentenceLike
    && /^(?:\d{1,2}[.)]|\d{1,2}(?:\.\d+)+[.)]?)\s+[A-Z][^.!?]{2,100}$/.test(text);
  if (!numbered && !SECTION_NAMES.has(normalized)) return null;
  return { text, normalized, isReferences: normalized === 'references' };
}

function detectSectionHeadings(pages, limit = 60) {
  const headings = [];
  const seen = new Set();

  pageLoop: for (const page of Array.isArray(pages) ? pages : []) {
    for (const rawLine of String(page?.text || '').split('\n')) {
      const heading = parseSectionHeading(rawLine);
      if (!heading) continue;

      const key = heading.text.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      headings.push({ page: Number(page?.number) || null, text: heading.text });
      if (headings.length >= limit) return headings;
      if (heading.isReferences) break pageLoop;
    }
  }

  return headings;
}

function splitLongLine(text, maxChars) {
  if (text.length <= maxChars) return [text];
  const parts = [];
  let remaining = text;
  while (remaining.length > maxChars) {
    let end = remaining.lastIndexOf(' ', maxChars);
    if (end < Math.floor(maxChars * 0.6)) end = maxChars;
    parts.push(remaining.slice(0, end).trim());
    remaining = remaining.slice(end).trim();
  }
  if (remaining) parts.push(remaining);
  return parts;
}

function buildPaperChunks(pages, options = {}) {
  const title = String(options.title || '').trim() || 'Untitled paper';
  const targetChars = Number.isFinite(options.targetChars)
    ? Math.max(200, Math.trunc(options.targetChars))
    : DEFAULT_CHUNK_TARGET_CHARS;
  const maxChars = Number.isFinite(options.maxChars)
    ? Math.max(targetChars, Math.trunc(options.maxChars))
    : DEFAULT_CHUNK_MAX_CHARS;
  const overlapChars = Number.isFinite(options.overlapChars)
    ? Math.max(0, Math.min(targetChars - 1, Math.trunc(options.overlapChars)))
    : DEFAULT_CHUNK_OVERLAP_CHARS;
  const chunks = [];
  let section = 'Document';
  let isReferences = false;
  let units = [];
  let unitChars = 0;
  let hasNewContent = false;

  function flush(keepOverlap) {
    if (!hasNewContent || units.length === 0) {
      if (!keepOverlap) {
        units = [];
        unitChars = 0;
        hasNewContent = false;
      }
      return;
    }
    const content = units.map(unit => unit.text).join('\n').trim();
    if (content) {
      chunks.push({
        ordinal: chunks.length,
        section,
        pageStart: units[0].page,
        pageEnd: units[units.length - 1].page,
        content,
        searchText: `${title}\n${section}\n${content}`,
        isReferences,
      });
    }

    if (!keepOverlap || overlapChars === 0) {
      units = [];
      unitChars = 0;
      hasNewContent = false;
      return;
    }

    const carried = [];
    let carriedChars = 0;
    for (let index = units.length - 1; index >= 0; index -= 1) {
      const unit = units[index];
      const separator = carried.length > 0 ? 1 : 0;
      const remaining = overlapChars - carriedChars - separator;
      if (remaining <= 0) break;
      if (unit.text.length > remaining) {
        let tail = unit.text.slice(-remaining).trim();
        const firstSpace = tail.indexOf(' ');
        if (firstSpace > 0 && firstSpace < Math.floor(tail.length * 0.25)) {
          tail = tail.slice(firstSpace + 1);
        }
        if (tail) carried.unshift({ ...unit, text: tail });
        carriedChars += tail.length + separator;
        break;
      }
      carried.unshift(unit);
      carriedChars += unit.text.length + separator;
    }
    units = carried;
    unitChars = carriedChars;
    hasNewContent = false;
  }

  for (const page of Array.isArray(pages) ? pages : []) {
    const pageNumber = Number.isInteger(page?.number) && page.number > 0 ? page.number : 1;
    for (const rawLine of String(page?.text || '').split('\n')) {
      const line = rawLine.replace(/\s+/g, ' ').trim();
      if (!line) continue;
      const heading = parseSectionHeading(line);
      if (heading) {
        flush(false);
        section = heading.text;
        isReferences = heading.isReferences;
        continue;
      }

      for (const part of splitLongLine(line, maxChars)) {
        let nextLength = unitChars + part.length + (units.length > 0 ? 1 : 0);
        if (!hasNewContent && units.length > 0 && nextLength > maxChars) {
          units = [];
          unitChars = 0;
          nextLength = part.length;
        }
        if (hasNewContent && (nextLength > maxChars || (unitChars >= targetChars && nextLength > targetChars))) {
          flush(true);
          const lengthWithOverlap = unitChars + part.length + (units.length > 0 ? 1 : 0);
          if (lengthWithOverlap > maxChars) {
            units = [];
            unitChars = 0;
          }
        }
        units.push({ page: pageNumber, text: part });
        unitChars += part.length + (units.length > 1 ? 1 : 0);
        hasNewContent = true;
        if (unitChars >= maxChars) flush(true);
      }
    }
  }
  flush(false);
  return chunks;
}

function initializePaperFullTextSchema(db) {
  if (!db?.exec || !db?.prepare) throw new TypeError('SQLite DB 연결이 필요합니다.');
  db.exec(`
    CREATE TABLE IF NOT EXISTS paper_documents (
      paper_id TEXT PRIMARY KEY,
      note_filename TEXT NOT NULL,
      title TEXT NOT NULL,
      source_url TEXT,
      source_sha256 TEXT,
      source_path TEXT,
      status TEXT NOT NULL DEFAULT 'not_indexed'
        CHECK(status IN ('not_indexed', 'indexing', 'ready', 'failed', 'needs_ocr')),
      parser_version TEXT NOT NULL DEFAULT '${PAPER_PARSER_VERSION}',
      page_count INTEGER,
      char_count INTEGER,
      chunk_count INTEGER NOT NULL DEFAULT 0,
      embedding_count INTEGER NOT NULL DEFAULT 0,
      error_code TEXT,
      error_message TEXT,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      indexed_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS paper_chunks (
      chunk_id TEXT PRIMARY KEY,
      paper_id TEXT NOT NULL,
      section TEXT NOT NULL,
      page_start INTEGER NOT NULL,
      page_end INTEGER NOT NULL,
      ordinal INTEGER NOT NULL,
      content TEXT NOT NULL,
      embedding TEXT,
      is_references INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      UNIQUE(paper_id, ordinal),
      FOREIGN KEY (paper_id) REFERENCES paper_documents(paper_id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_paper_documents_note ON paper_documents(note_filename);
    CREATE INDEX IF NOT EXISTS idx_paper_documents_status ON paper_documents(status, updated_at);
    CREATE INDEX IF NOT EXISTS idx_paper_chunks_paper ON paper_chunks(paper_id, ordinal);
  `);
  return db.prepare(`
    UPDATE paper_documents
    SET status = 'failed',
        error_code = 'index_interrupted',
        error_message = '서버 재시작으로 진행 중이던 색인이 중단되었습니다.',
        updated_at = strftime('%s','now')
    WHERE status = 'indexing'
  `).run().changes;
}

function safePaperSourcePath(vaultPath, paperId) {
  const safeId = crypto.createHash('sha256').update(paperId).digest('hex').slice(0, 24);
  const relativePath = `${PAPER_SOURCE_DIR}/${safeId}/source.pdf`;
  return { relativePath, absolutePath: path.join(path.resolve(vaultPath), ...relativePath.split('/')) };
}

async function writeFileAtomic(filepath, data) {
  await fs.mkdir(path.dirname(filepath), { recursive: true });
  const temporary = `${filepath}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  try {
    await fs.writeFile(temporary, data, { mode: 0o600 });
    await fs.rename(temporary, filepath);
  } catch (error) {
    await fs.unlink(temporary).catch(() => {});
    throw error;
  }
}

function normalizeEmbedding(value) {
  if (!Array.isArray(value) || value.length === 0) return null;
  const vector = value.map(Number);
  return vector.every(Number.isFinite) ? vector : null;
}

function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let index = 0; index < a.length; index += 1) {
    dot += a[index] * b[index];
    normA += a[index] * a[index];
    normB += b[index] * b[index];
  }
  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? 0 : dot / denominator;
}

const PAPER_SEARCH_STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'how', 'in', 'is',
  'it', 'of', 'on', 'or', 'that', 'the', 'their', 'this', 'to', 'was', 'what', 'when',
  'where', 'which', 'who', 'why', 'with',
]);

function tokenizePaperText(value) {
  return (String(value || '').normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]+/gu) || [])
    .filter(token => token.length > 1 && !PAPER_SEARCH_STOP_WORDS.has(token));
}

function calculateBm25(rows, terms) {
  const tokenized = rows.map(row => tokenizePaperText(
    `${row.title} ${row.title} ${row.section} ${row.section} ${row.section} ${row.content}`,
  ));
  const averageLength = tokenized.reduce((sum, tokens) => sum + tokens.length, 0) / (tokenized.length || 1);
  const documentFrequency = new Map(terms.map(term => [
    term,
    tokenized.filter(tokens => tokens.includes(term)).length,
  ]));
  const k1 = 1.2;
  const b = 0.75;

  return tokenized.map(tokens => {
    const frequencies = new Map();
    for (const token of tokens) frequencies.set(token, (frequencies.get(token) || 0) + 1);
    let score = 0;
    for (const term of terms) {
      const frequency = frequencies.get(term) || 0;
      if (frequency === 0) continue;
      const df = documentFrequency.get(term) || 0;
      const idf = Math.log(1 + ((rows.length - df + 0.5) / (df + 0.5)));
      const denominator = frequency + k1 * (1 - b + b * (tokens.length / (averageLength || 1)));
      score += idf * ((frequency * (k1 + 1)) / denominator);
    }
    return score;
  });
}

function parseStoredEmbedding(value) {
  if (!value) return null;
  try {
    return normalizeEmbedding(JSON.parse(value));
  } catch {
    return null;
  }
}

function createPaperFullTextService({
  db,
  vaultPath,
  extractPages = extractPdfPages,
  embedTexts = null,
} = {}) {
  if (!db?.prepare) throw new TypeError('SQLite DB 연결이 필요합니다.');
  if (!vaultPath) throw new TypeError('볼트 경로가 필요합니다.');
  initializePaperFullTextSchema(db);

  const indexing = new Map();
  const getActivePaper = db.prepare(`
    SELECT filename, title
    FROM notes
    WHERE paper_id = ?
      AND note_type = 'paper'
      AND archived = 0
      AND codex_status NOT IN ('running', 'recovery_required')
    LIMIT 1
  `);
  const getDocument = db.prepare(`
    SELECT paper_id AS paperId, note_filename AS noteFilename, title,
           source_url AS sourceUrl, source_sha256 AS sourceSha256,
           source_path AS sourcePath, status, parser_version AS parserVersion,
           page_count AS pageCount, char_count AS charCount,
           chunk_count AS chunkCount, embedding_count AS embeddingCount,
           error_code AS errorCode, error_message AS errorMessage,
           indexed_at AS indexedAt
    FROM paper_documents
    WHERE paper_id = ?
  `);
  const markIndexing = db.prepare(`
    INSERT INTO paper_documents (
      paper_id, note_filename, title, source_url, source_sha256, source_path,
      status, parser_version, error_code, error_message
    ) VALUES (
      @paperId, @noteFilename, @title, @sourceUrl, @sourceSha256, @sourcePath,
      'indexing', @parserVersion, NULL, NULL
    )
    ON CONFLICT(paper_id) DO UPDATE SET
      note_filename = excluded.note_filename,
      title = excluded.title,
      source_url = excluded.source_url,
      source_sha256 = excluded.source_sha256,
      source_path = excluded.source_path,
      status = 'indexing',
      parser_version = excluded.parser_version,
      error_code = NULL,
      error_message = NULL,
      updated_at = strftime('%s','now')
  `);
  const markFailed = db.prepare(`
    UPDATE paper_documents
    SET status = @status,
        error_code = @errorCode,
        error_message = @errorMessage,
        updated_at = strftime('%s','now')
    WHERE paper_id = @paperId
  `);
  const refreshDocumentNote = db.prepare(`
    UPDATE paper_documents
    SET note_filename = @noteFilename,
        title = @title,
        source_url = COALESCE(@sourceUrl, source_url),
        source_path = @sourcePath,
        updated_at = strftime('%s','now')
    WHERE paper_id = @paperId
  `);
  const deleteChunks = db.prepare('DELETE FROM paper_chunks WHERE paper_id = ?');
  const insertChunk = db.prepare(`
    INSERT INTO paper_chunks (
      chunk_id, paper_id, section, page_start, page_end, ordinal,
      content, embedding, is_references
    ) VALUES (
      @chunkId, @paperId, @section, @pageStart, @pageEnd, @ordinal,
      @content, @embedding, @isReferences
    )
  `);
  const markReady = db.prepare(`
    UPDATE paper_documents
    SET status = 'ready',
        page_count = @pageCount,
        char_count = @charCount,
        chunk_count = @chunkCount,
        embedding_count = @embeddingCount,
        error_code = NULL,
        error_message = NULL,
        indexed_at = strftime('%s','now'),
        updated_at = strftime('%s','now')
    WHERE paper_id = @paperId
  `);
  const finishIndex = db.transaction(({ paperId, extracted, chunks, embeddings }) => {
    deleteChunks.run(paperId);
    chunks.forEach((chunk, index) => {
      const chunkId = `paper-${crypto.createHash('sha256')
        .update(`${paperId}\0${chunk.ordinal}\0${chunk.content}`)
        .digest('hex').slice(0, 24)}`;
      insertChunk.run({
        chunkId,
        paperId,
        section: chunk.section,
        pageStart: chunk.pageStart,
        pageEnd: chunk.pageEnd,
        ordinal: chunk.ordinal,
        content: chunk.content,
        embedding: embeddings[index] ? JSON.stringify(embeddings[index]) : null,
        isReferences: chunk.isReferences ? 1 : 0,
      });
    });
    markReady.run({
      paperId,
      pageCount: extracted.pageCount,
      charCount: extracted.charCount,
      chunkCount: chunks.length,
      embeddingCount: embeddings.filter(Boolean).length,
    });
  });
  const getSearchRows = db.prepare(`
    SELECT c.chunk_id AS chunkId, c.section,
           c.page_start AS pageStart, c.page_end AS pageEnd,
           c.ordinal, c.content, c.embedding,
           c.is_references AS isReferences, d.title
    FROM paper_chunks c
    JOIN paper_documents d ON d.paper_id = c.paper_id
    JOIN notes n ON n.filename = d.note_filename
    WHERE c.paper_id = ?
      AND d.status = 'ready'
      AND n.paper_id = d.paper_id
      AND n.note_type = 'paper'
      AND n.archived = 0
      AND n.codex_status NOT IN ('running', 'recovery_required')
    ORDER BY c.ordinal ASC
  `);
  const getActiveChunk = db.prepare(`
    SELECT c.chunk_id AS chunkId, c.section,
           c.page_start AS pageStart, c.page_end AS pageEnd,
           c.ordinal, c.content AS text, d.title
    FROM paper_chunks c
    JOIN paper_documents d ON d.paper_id = c.paper_id
    JOIN notes n ON n.filename = d.note_filename
    WHERE c.paper_id = @paperId
      AND c.chunk_id = @chunkId
      AND d.status = 'ready'
      AND n.paper_id = d.paper_id
      AND n.note_type = 'paper'
      AND n.archived = 0
      AND n.codex_status NOT IN ('running', 'recovery_required')
    LIMIT 1
  `);
  const getAdjacentChunks = db.prepare(`
    SELECT c.chunk_id AS chunkId, c.section,
           c.page_start AS pageStart, c.page_end AS pageEnd,
           c.ordinal, c.content AS text, d.title
    FROM paper_chunks c
    JOIN paper_documents d ON d.paper_id = c.paper_id
    JOIN notes n ON n.filename = d.note_filename
    WHERE c.paper_id = @paperId
      AND c.chunk_id != @chunkId
      AND d.status = 'ready'
      AND n.paper_id = d.paper_id
      AND n.note_type = 'paper'
      AND n.archived = 0
      AND n.codex_status NOT IN ('running', 'recovery_required')
    ORDER BY ABS(c.ordinal - @ordinal) ASC, c.ordinal ASC
    LIMIT @limit
  `);

  async function runIndex({ paperId, sourceUrl = null, pdf }) {
    const normalizedPaperId = String(paperId || '').trim();
    if (!normalizedPaperId || normalizedPaperId.length > 200) {
      throw new PaperFullTextError('저장된 논문 ID가 필요합니다.', 'invalid_paper_id');
    }
    const note = getActivePaper.get(normalizedPaperId);
    if (!note) throw new PaperFullTextError('먼저 활성 paper 노트로 저장해야 합니다.', 'paper_not_saved');
    const buffer = toPdfBuffer(pdf);
    const sourceSha256 = crypto.createHash('sha256').update(buffer).digest('hex');
    const source = safePaperSourcePath(vaultPath, normalizedPaperId);
    const existing = getDocument.get(normalizedPaperId);
    const needsEmbeddings = Boolean(embedTexts)
      && Number(existing?.embeddingCount || 0) < Number(existing?.chunkCount || 0);
    if (
      existing?.status === 'ready'
      && existing.sourceSha256 === sourceSha256
      && existing.parserVersion === PAPER_PARSER_VERSION
      && !needsEmbeddings
    ) {
      refreshDocumentNote.run({
        paperId: normalizedPaperId,
        noteFilename: note.filename,
        title: note.title,
        sourceUrl: sourceUrl ? String(sourceUrl).slice(0, 2000) : null,
        sourcePath: source.relativePath,
      });
      try {
        await fs.access(source.absolutePath);
      } catch {
        await writeFileAtomic(source.absolutePath, buffer);
      }
      return { ...getDocument.get(normalizedPaperId), indexedNow: false, reused: true };
    }

    markIndexing.run({
      paperId: normalizedPaperId,
      noteFilename: note.filename,
      title: note.title,
      sourceUrl: sourceUrl ? String(sourceUrl).slice(0, 2000) : null,
      sourceSha256,
      sourcePath: source.relativePath,
      parserVersion: PAPER_PARSER_VERSION,
    });

    try {
      await writeFileAtomic(source.absolutePath, buffer);
      const extracted = await extractPages(buffer);
      const chunks = buildPaperChunks(extracted.pages, { title: note.title });
      if (chunks.length === 0) {
        throw new PaperFullTextError('검색 가능한 전문 청크를 만들지 못했습니다.', 'pdf_text_empty');
      }

      let embeddings = chunks.map(() => null);
      if (embedTexts) {
        const values = await embedTexts(chunks.map(chunk => chunk.searchText));
        if (!Array.isArray(values) || values.length !== chunks.length) {
          throw new PaperFullTextError('청크 임베딩 결과가 올바르지 않습니다.', 'embedding_failed');
        }
        embeddings = values.map(normalizeEmbedding);
        if (embeddings.some(value => !value)) {
          throw new PaperFullTextError('일부 청크 임베딩을 만들지 못했습니다.', 'embedding_failed');
        }
      }

      finishIndex({ paperId: normalizedPaperId, extracted, chunks, embeddings });
      return { ...getDocument.get(normalizedPaperId), indexedNow: true, reused: false };
    } catch (error) {
      const code = error instanceof PaperFullTextError ? error.code : 'paper_index_failed';
      markFailed.run({
        paperId: normalizedPaperId,
        status: code === 'pdf_text_empty' ? 'needs_ocr' : 'failed',
        errorCode: code,
        errorMessage: String(error.message || error).slice(0, 1000),
      });
      throw error;
    }
  }

  function indexPaper(input) {
    const paperId = String(input?.paperId || '').trim();
    if (indexing.has(paperId)) return indexing.get(paperId);
    const run = runIndex(input || {}).finally(() => indexing.delete(paperId));
    indexing.set(paperId, run);
    return run;
  }

  function searchPaper({ paperId, query, queryEmbedding = null, mode = 'focused', limit = 4 } = {}) {
    const normalizedPaperId = String(paperId || '').trim();
    const normalizedQuery = String(query || '').trim();
    if (!normalizedPaperId) throw new PaperFullTextError('논문 ID가 필요합니다.', 'invalid_paper_id');
    if (!normalizedQuery || normalizedQuery.length > 300) {
      throw new PaperFullTextError('검색어는 1~300자여야 합니다.', 'invalid_query');
    }
    const rows = getSearchRows.all(normalizedPaperId);
    if (rows.length === 0) return [];
    const terms = [...new Set(tokenizePaperText(normalizedQuery))];
    const vector = normalizeEmbedding(queryEmbedding);
    if (terms.length === 0 && !vector) return [];
    const keywordScores = calculateBm25(rows, terms);
    const maxKeywordScore = Math.max(...keywordScores, 0);
    const wantsReferences = terms.some(term => ['citation', 'citations', 'reference', 'references'].includes(term));

    const scored = rows.map((row, index) => {
      const keywordScore = maxKeywordScore > 0 ? keywordScores[index] / maxKeywordScore : 0;
      const storedVector = parseStoredEmbedding(row.embedding);
      const embeddingScore = vector && storedVector
        ? Math.max(0, cosineSimilarity(vector, storedVector))
        : null;
      let score = embeddingScore === null
        ? keywordScore
        : (0.4 * keywordScore) + (0.6 * embeddingScore);
      if (row.isReferences && !wantsReferences) score *= 0.35;
      return { ...row, score };
    }).filter(row => row.score > 0);

    scored.sort((a, b) => b.score - a.score || a.ordinal - b.ordinal);
    const boundedLimit = Math.max(1, Math.min(4, Math.trunc(Number(limit) || 4)));
    const sectionLimit = mode === 'overview' ? 1 : 2;
    const selected = [];
    const sectionCounts = new Map();
    for (const row of scored) {
      const count = sectionCounts.get(row.section) || 0;
      if (count >= sectionLimit) continue;
      selected.push(row);
      sectionCounts.set(row.section, count + 1);
      if (selected.length >= boundedLimit) break;
    }

    return selected.map(row => ({
      chunkId: row.chunkId,
      section: row.section,
      pageStart: row.pageStart,
      pageEnd: row.pageEnd,
      text: row.content,
      score: Number(row.score.toFixed(6)),
    }));
  }

  function getPaperChunks({ paperId, chunkIds } = {}) {
    const normalizedPaperId = String(paperId || '').trim();
    if (!normalizedPaperId) throw new PaperFullTextError('논문 ID가 필요합니다.', 'invalid_paper_id');
    if (!Array.isArray(chunkIds) || chunkIds.length === 0 || chunkIds.length > 8) {
      throw new PaperFullTextError('조회할 전문 청크 ID가 필요합니다.', 'invalid_chunk_id');
    }
    const uniqueIds = [...new Set(chunkIds.map(value => String(value || '').trim()).filter(Boolean))];
    if (uniqueIds.length === 0 || uniqueIds.some(value => value.length > 100)) {
      throw new PaperFullTextError('전문 청크 ID가 올바르지 않습니다.', 'invalid_chunk_id');
    }
    return uniqueIds.map(chunkId => getActiveChunk.get({ paperId: normalizedPaperId, chunkId })).filter(Boolean);
  }

  function readPaper({ paperId, chunkId, adjacentLimit = 2 } = {}) {
    const normalizedPaperId = String(paperId || '').trim();
    const normalizedChunkId = String(chunkId || '').trim();
    if (!normalizedPaperId) throw new PaperFullTextError('논문 ID가 필요합니다.', 'invalid_paper_id');
    if (!normalizedChunkId || normalizedChunkId.length > 100) {
      throw new PaperFullTextError('전문 청크 ID가 올바르지 않습니다.', 'invalid_chunk_id');
    }
    const selected = getActiveChunk.get({ paperId: normalizedPaperId, chunkId: normalizedChunkId });
    if (!selected) throw new PaperFullTextError('활성 논문의 전문 청크를 찾지 못했습니다.', 'chunk_not_found');
    const limit = Math.max(1, Math.min(2, Math.trunc(Number(adjacentLimit) || 2)));
    return getAdjacentChunks.all({
      paperId: normalizedPaperId,
      chunkId: normalizedChunkId,
      ordinal: selected.ordinal,
      limit,
    }).sort((a, b) => a.ordinal - b.ordinal);
  }

  return {
    getDocument: paperId => getDocument.get(paperId) || null,
    getPaperChunks,
    indexPaper,
    readPaper,
    searchPaper,
  };
}

module.exports = {
  DEFAULT_CHUNK_MAX_CHARS,
  DEFAULT_CHUNK_OVERLAP_CHARS,
  DEFAULT_CHUNK_TARGET_CHARS,
  DEFAULT_MAX_PDF_BYTES,
  DEFAULT_MAX_PDF_PAGES,
  PAPER_PARSER_VERSION,
  PAPER_SOURCE_DIR,
  PaperFullTextError,
  buildPaperChunks,
  createPaperFullTextService,
  detectSectionHeadings,
  extractPdfPages,
  initializePaperFullTextSchema,
  normalizePageText,
  tokenizePaperText,
};
