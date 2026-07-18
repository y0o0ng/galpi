'use strict';

const TOPICS = [
  'diet',
  'deploy',
  'paper',
  'audio',
  'workflow',
  'creative',
  'budget',
  'health',
  'travel',
  'backup',
  'interface',
  'reading',
];

function embedding(...topics) {
  const vector = TOPICS.map(topic => topics.includes(topic) ? 1 : 0);
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  return norm === 0 ? vector : vector.map(value => value / norm);
}

function qa(chunkId, date, question, answer) {
  return {
    chunkId,
    content: `### ${date}\n<!-- qa_id: ${chunkId} -->\n**Q.** ${question}\n\n**A.** ${answer}`,
  };
}

function makeNote({ filename, title, topics, tags, entries }) {
  const chunks = entries.filter(entry => typeof entry !== 'string');
  const body = [
    `# ${title}`,
    '',
    '<!-- QA-LOG-START -->',
    ...entries.map(entry => typeof entry === 'string' ? entry : entry.content),
    '<!-- QA-LOG-END -->',
  ].join('\n\n');
  return {
    filename,
    title,
    tags,
    embedding: embedding(...topics),
    body,
    chunks,
  };
}

const LONG_GAP = `\n${'과거 세부 맥락을 보존한다. '.repeat(520)}\n`;

const notes = [
  makeNote({
    filename: 'preferences.md',
    title: '식사와 운동 습관',
    topics: ['diet', 'health'],
    tags: '아침식사 운동 루틴 식단',
    entries: [
      qa('pref-breakfast-old', '2026-06-02', '아침은 뭘 먹을까?', '오트밀과 바나나를 기본 식단으로 정했다.'),
      qa('pref-workout-old', '2026-06-10', '운동은 언제 하지?', '주 3회 저녁 운동을 하기로 했다.'),
      LONG_GAP,
      qa('pref-breakfast-current', '2026-07-14', '요즘 아침 식단은?', '아침은 그릭 요거트와 견과류로 변경했다.'),
      qa('pref-workout-current', '2026-07-15', '최근 운동 시간은?', '운동은 월·수·금 오전으로 변경했다.'),
    ],
  }),
  makeNote({
    filename: 'pi-operations.md',
    title: '라즈베리파이 배포와 백업',
    topics: ['deploy', 'backup'],
    tags: '파이 배포 systemd 백업 경로',
    entries: [
      qa('pi-path-old', '2026-07-01', '예전 배포 경로는?', '예전 후보는 /home/pi/apps/ai-council이었다.'),
      qa('pi-backup', '2026-07-05', '백업은 어디에 남지?', '/home/pi/backups/galpi에 DB와 vault를 하루 1회 저장하고 7일 보관한다.'),
      LONG_GAP,
      qa('pi-path-current', '2026-07-13', '현재 배포 경로는?', '실제 배포 경로는 /home/pi/galpi다.'),
    ],
  }),
  makeNote({
    filename: 'paper-search.md',
    title: '논문 전문 검색 설계',
    topics: ['paper'],
    tags: '논문 PDF 파서 청크 토큰',
    entries: [
      qa('paper-parser-limit', '2026-07-15', 'PDF 파서 제한은?', 'pdf-parse 2.4.5를 쓰고 20MB·100페이지 상한을 둔다.'),
      qa('paper-token-budget', '2026-07-15', '전문 검색 토큰은?', '전문 도구는 답변당 2회, 누적 10,000자 상한을 적용한다.'),
      LONG_GAP,
      qa('paper-parser-policy-current', '2026-07-16', '파서 운영 방향은?', '일단 PDF 파서만 유지하고 표·이미지 문제가 반복될 때만 HTML이나 비전을 추가한다.'),
    ],
  }),
  makeNote({
    filename: 'm60-audio.md',
    title: 'M60 AUX 입력 연결',
    topics: ['audio'],
    tags: 'M60 AUX 스피커 입력',
    entries: [
      qa('m60-aux-input', '2026-06-29', 'M60에 AUX를 어떻게 연결하지?', '3.5mm AUX 입력을 선택하고 출력 기기의 볼륨을 먼저 낮게 둔다.'),
    ],
  }),
  makeNote({
    filename: 'coding-workflow.md',
    title: '코드 수정 작업 규칙',
    topics: ['workflow'],
    tags: '코드 수정 컨펌 AGENTS CLAUDE',
    entries: [
      qa('workflow-approval-old', '2026-07-01', '작은 수정은 바로 할까?', '과거에는 작은 수정을 바로 진행했다.'),
      qa('workflow-agent-sync', '2026-07-14', '에이전트 문서는?', 'AGENTS.md를 변경하면 CLAUDE.md도 같은 내용으로 유지한다.'),
      LONG_GAP,
      qa('workflow-approval-current', '2026-07-15', '현재 코드 수정 규칙은?', '코드를 수정하기 전에 이유·방법·영향과 트레이드오프를 설명하고 컨펌을 받는다.'),
    ],
  }),
  makeNote({
    filename: 'creative-writing.md',
    title: '자아 분열과 숙면대행서비스',
    topics: ['creative'],
    tags: '소설 시 자아분열 숙면대행서비스',
    entries: [
      qa('creative-poetry', '2026-06-04', '시의 반복 이미지는?', '도플갱어와 투명한 자아가 서로를 잠식하는 이미지다.'),
      qa('creative-sleep-ending', '2026-06-21', '숙면대행서비스 결말은?', '다른 세계의 나를 처리한 대가가 현실의 자아에게 돌아오는 결말을 비교했다.'),
    ],
  }),
  makeNote({
    filename: 'api-costs.md',
    title: 'AI API 비용과 Claude 크레딧',
    topics: ['budget'],
    tags: 'Claude Billing API 비용 크레딧',
    entries: [
      qa('cost-monthly', '2026-07-12', '월 API 비용 기준은?', '현재 사용 페이스는 월 13달러 수준을 기준으로 본다.'),
      qa('cost-billing-link', '2026-07-14', '남은 크레딧은 어디서 보지?', '상단 Claude 크레딧 링크에서 공식 Billing 화면을 열고 자동 잔액 조회는 하지 않는다.'),
    ],
  }),
  makeNote({
    filename: 'travel-plans.md',
    title: '여행 계획',
    topics: ['travel'],
    tags: '여행 부산 서울 일정',
    entries: [
      qa('travel-busan', '2026-05-20', '부산 일정은?', '토요일 아침 열차를 타고 해운대를 먼저 방문한다.'),
      qa('travel-seoul', '2026-06-01', '서울 일정은?', '일요일 오후에 미술관을 방문한다.'),
    ],
  }),
  makeNote({
    filename: 'interface.md',
    title: '시온과 논문 패널 UI',
    topics: ['interface'],
    tags: '시온 패널 UI 모바일',
    entries: [
      qa('ui-clawd-bounds', '2026-07-15', '시온은 어디까지 움직이지?', '시온은 패널과 창 위까지 이동하며 전체 앱 영역을 사용한다.'),
      qa('ui-paper-panel', '2026-07-15', '논문 패널은?', '데스크톱에서 사이드 패널, 모바일에서 바텀시트로 연다.'),
    ],
  }),
  makeNote({
    filename: 'reading-list.md',
    title: '독서 목록',
    topics: ['reading'],
    tags: '책 독서 문학',
    entries: [
      qa('reading-hamlet', '2026-06-03', '햄릿을 어떻게 읽었지?', '신체적 결여와 자존감의 관계로 읽었다.'),
    ],
  }),
];

function retrievalCase({
  id,
  category,
  query,
  topics,
  notes: requiredNoteFilenames,
  chunks: requiredChunkIds,
  relevantNotes = requiredNoteFilenames,
  relevantChunks = requiredChunkIds,
  expectNoEvidence = false,
}) {
  return {
    id,
    category,
    query,
    queryEmbedding: embedding(...topics),
    requiredNoteFilenames,
    requiredChunkIds,
    relevantNoteFilenames: relevantNotes,
    relevantChunkIds: relevantChunks,
    expectNoEvidence,
  };
}

const cases = [
  retrievalCase({ id: 'single-01', category: 'single', query: 'M60 AUX 입력 연결 방법', topics: ['audio'], notes: ['m60-audio.md'], chunks: ['m60-aux-input'] }),
  retrievalCase({ id: 'single-02', category: 'single', query: 'Claude 남은 크레딧 Billing 링크', topics: ['budget'], notes: ['api-costs.md'], chunks: ['cost-billing-link'] }),
  retrievalCase({ id: 'single-03', category: 'single', query: '시온 이동 범위', topics: ['interface'], notes: ['interface.md'], chunks: ['ui-clawd-bounds'] }),
  retrievalCase({ id: 'single-04', category: 'single', query: '숙면대행서비스 소설 결말', topics: ['creative'], notes: ['creative-writing.md'], chunks: ['creative-sleep-ending'] }),
  retrievalCase({ id: 'single-05', category: 'single', query: '논문 PDF 파서 페이지 제한', topics: ['paper'], notes: ['paper-search.md'], chunks: ['paper-parser-limit'] }),

  retrievalCase({ id: 'multi-01', category: 'multi_session', query: '현재 파이 배포 경로와 코드 수정 컨펌 규칙', topics: ['deploy', 'workflow'], notes: ['pi-operations.md', 'coding-workflow.md'], chunks: ['pi-path-current', 'workflow-approval-current'] }),
  retrievalCase({ id: 'multi-02', category: 'multi_session', query: '논문 전문 파서와 토큰 상한', topics: ['paper'], notes: ['paper-search.md'], chunks: ['paper-parser-limit', 'paper-token-budget'] }),
  retrievalCase({ id: 'multi-03', category: 'multi_session', query: '자아 분열 시와 숙면대행서비스의 연결', topics: ['creative'], notes: ['creative-writing.md'], chunks: ['creative-poetry', 'creative-sleep-ending'] }),
  retrievalCase({ id: 'multi-04', category: 'multi_session', query: '현재 아침 식단과 논문 파서 운영 방향', topics: ['diet', 'paper'], notes: ['preferences.md', 'paper-search.md'], chunks: ['pref-breakfast-current', 'paper-parser-policy-current'] }),

  retrievalCase({ id: 'update-01', category: 'update', query: '지금 아침에 먹는 식단', topics: ['diet'], notes: ['preferences.md'], chunks: ['pref-breakfast-current'] }),
  retrievalCase({ id: 'update-02', category: 'update', query: '현재 코드 수정 전 컨펌 규칙', topics: ['workflow'], notes: ['coding-workflow.md'], chunks: ['workflow-approval-current'] }),
  retrievalCase({ id: 'update-03', category: 'update', query: '현재 라즈베리파이 배포 경로', topics: ['deploy'], notes: ['pi-operations.md'], chunks: ['pi-path-current'] }),
  retrievalCase({ id: 'update-04', category: 'update', query: '현재 논문 전문 파서 운영 전략', topics: ['paper'], notes: ['paper-search.md'], chunks: ['paper-parser-policy-current'] }),

  retrievalCase({ id: 'time-01', category: 'time', query: '7월 16일에 정한 논문 파서 방향', topics: ['paper'], notes: ['paper-search.md'], chunks: ['paper-parser-policy-current'] }),
  retrievalCase({ id: 'time-02', category: 'time', query: '가장 최근에 바꾼 운동 시간', topics: ['health'], notes: ['preferences.md'], chunks: ['pref-workout-current'] }),
  retrievalCase({ id: 'time-03', category: 'time', query: '7월 10일 이후 바꾼 파이 배포 경로', topics: ['deploy'], notes: ['pi-operations.md'], chunks: ['pi-path-current'] }),

  retrievalCase({ id: 'abstain-01', category: 'abstention', query: '고양이 종합백신 예약일', topics: [], notes: [], chunks: [], expectNoEvidence: true }),
  retrievalCase({ id: 'abstain-02', category: 'abstention', query: '프랑스 부가가치세 신고 번호', topics: [], notes: [], chunks: [], expectNoEvidence: true }),
  retrievalCase({ id: 'abstain-03', category: 'abstention', query: '식기세척기 필터 모델명', topics: [], notes: [], chunks: [], expectNoEvidence: true }),
  retrievalCase({ id: 'abstain-04', category: 'abstention', query: '화성의 내일 날씨', topics: [], notes: [], chunks: [], expectNoEvidence: true }),
];

module.exports = {
  name: 'synthetic-legacy-note-baseline-v1',
  notes,
  cases,
};
