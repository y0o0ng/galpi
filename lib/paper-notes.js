'use strict';

const { normalizePaper } = require('./paper-search');

function yamlString(value) {
  return JSON.stringify(String(value || ''));
}

function yamlStringArray(values) {
  return `[${values.map(yamlString).join(', ')}]`;
}

function buildPaperNoteContent({ paper, fileId, createdStr }) {
  if (!paper?.paperId || !paper?.title) {
    throw new TypeError('paperId와 title이 있는 논문이 필요합니다.');
  }
  if (!fileId || !createdStr) {
    throw new TypeError('논문 노트 ID와 생성 시각이 필요합니다.');
  }

  const frontmatter = [
    '---',
    `id: ${fileId}`,
    `title: ${yamlString(paper.title)}`,
    'note_type: paper',
    `authors: ${yamlStringArray(paper.authors || [])}`,
  ];
  if (Number.isInteger(paper.year)) frontmatter.push(`year: ${paper.year}`);
  frontmatter.push(
    `citation_count: ${paper.citationCount || 0}`,
    `paper_id: ${yamlString(paper.paperId)}`,
  );
  if (paper.arxivId) frontmatter.push(`arxiv_id: ${yamlString(paper.arxivId)}`);
  if (paper.doi) frontmatter.push(`doi: ${yamlString(paper.doi)}`);
  frontmatter.push(
    `url: ${yamlString(paper.url)}`,
    `created: ${createdStr}`,
    `updated: ${createdStr}`,
    'archived: false',
    'codex_status: pending',
    'ai_readable: true',
    'knowledge_type: academic_paper',
    'confidence: medium',
    '---',
  );

  const body = [`# ${paper.title}`];
  if (paper.tldr) body.push('## TL;DR', paper.tldr);
  body.push(
    '## 초록',
    paper.abstract || '초록 정보 없음.',
    '## 내 메모',
    '',
    '## 주제 태그',
    '<!-- CODEX-TAGS-START -->',
    '<!-- CODEX-TAGS-END -->',
    '',
    '## 연결',
    '<!-- CODEX-LINKS-START -->',
    '<!-- CODEX-LINKS-END -->',
  );

  return `${frontmatter.join('\n')}\n\n${body.join('\n\n')}\n`;
}

function createPaperNoteSaver({
  findActivePaper,
  createNoteIdentity,
  saveNote,
  cleanupNote,
  onCreated,
}) {
  let saveChain = Promise.resolve();

  async function savePaper(paperInput) {
    const paper = normalizePaper(paperInput);
    if (!paper) {
      const error = new Error('저장할 논문 정보가 올바르지 않습니다.');
      error.statusCode = 400;
      throw error;
    }

    const existing = findActivePaper(paper.paperId);
    if (existing) return { ...existing, duplicate: true };

    const { fileId, createdStr } = createNoteIdentity();
    const filename = `${fileId}.md`;
    const noteContent = buildPaperNoteContent({ paper, fileId, createdStr });

    try {
      await saveNote({
        fileId,
        title: paper.title,
        noteType: 'paper',
        noteContent,
        codexStatus: 'pending',
        paperId: paper.paperId,
      });
    } catch (error) {
      const duplicate = String(error.code || '').startsWith('SQLITE_CONSTRAINT')
        ? findActivePaper(paper.paperId)
        : null;
      if (!duplicate) throw error;
      await cleanupNote(filename);
      return { ...duplicate, duplicate: true };
    }

    await onCreated({ paper, filename });
    return { filename, title: paper.title, duplicate: false };
  }

  return paperInput => {
    const run = saveChain.then(() => savePaper(paperInput));
    saveChain = run.then(() => {}, () => {});
    return run;
  };
}

module.exports = { buildPaperNoteContent, createPaperNoteSaver };
