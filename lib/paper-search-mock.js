'use strict';

const MOCK_S2_RESPONSE = {
  total: 6,
  data: [
    {
      paperId: 'abc123',
      title: 'TradingAgents: Multi-Agents LLM Financial Trading Framework',
      abstract: 'Significant progress has been made in automated problem-solving...',
      year: 2025,
      authors: [{ name: 'Yijia Xiao' }, { name: 'Edward Sun' }],
      citationCount: 142,
      url: 'https://www.semanticscholar.org/paper/abc123',
      openAccessPdf: { url: 'https://arxiv.org/pdf/2412.20138', status: 'GREEN' },
      externalIds: { ArXiv: '2412.20138' },
      tldr: { text: 'A multi-agent LLM framework that mirrors a trading firm.' },
    },
    {
      paperId: 'edge-tldr-only',
      title: 'Portfolio Decisions Without an Abstract',
      abstract: null,
      year: 2024,
      authors: [{ name: 'Min Kim' }],
      url: 'https://www.semanticscholar.org/paper/edge-tldr-only',
      externalIds: { DOI: '10.1000/mock-tldr' },
      tldr: { text: 'This paper intentionally provides a TLDR but no abstract.' },
    },
    {
      paperId: 'edge-missing-metadata',
      title: 'Sparse Metadata Paper',
      abstract: null,
      year: null,
      authors: [],
      citationCount: -9,
      url: 'javascript:alert(1)',
      openAccessPdf: { url: 'javascript:alert(2)', status: 'UNKNOWN' },
      externalIds: null,
      tldr: null,
    },
    {
      paperId: 'edge-many-authors',
      title: '<b>Robust</b> Multi-Agent Evaluation',
      abstract: '<script>ignore()</script>Evidence <i>without executable markup</i>.',
      year: 2023,
      authors: [
        { name: 'Author One' },
        { name: 'Author Two' },
        { name: 'Author Three' },
        { name: 'Author Four' },
        { name: 'Author Five' },
        { name: 'Author Six' },
      ],
      citationCount: '17',
      url: 'ftp://example.com/paper',
      externalIds: {},
    },
    {
      title: 'Missing paper identifier',
      year: 2022,
    },
    {
      paperId: 'missing-title',
      title: '',
      year: 2021,
    },
  ],
};

module.exports = { MOCK_S2_RESPONSE };
