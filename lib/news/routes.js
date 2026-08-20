'use strict';

// XION 홈이 읽는 최소 API 하나 (설계 14.2).
//
// **관심을 관리하는 API는 만들지 않는다.** 홈은 "관심사 확인 필요"·"구독 유지 여부"
// 같은 관리 화면이 되지 않고(설계 14.1), 관심을 더하고 빼는 통로는 대화뿐이다.
// 그래서 여기 있는 것은 읽기 둘과 치우기 하나다.
//
// **topic은 노트에서 온다.** 이 표들은 `interest_id`만 알고 이름의 정본은 Markdown
// 노트다. 그래서 라우트가 노트를 읽어 이름을 붙인다 — 이름을 DB에 복제하면 노트를
// 고칠 때마다 두 곳이 갈린다.

const { SURFACE_THRESHOLD } = require('./analyze');

function registerNewsRoutes({ app, store, config, loadInterests }) {
  if (!app?.get) throw new TypeError('Express app이 필요합니다.');
  if (!store?.briefingArticles) throw new TypeError('뉴스 저장소가 필요합니다.');
  if (typeof loadInterests !== 'function') throw new TypeError('관심 목록 로더가 필요합니다.');
  if (!config || typeof config !== 'object') throw new TypeError('뉴스 설정이 필요합니다.');

  function guard(res) {
    if (config.enabled) return false;
    // 홈은 이 503을 오류로 그리지 않는다. 플래그가 꺼진 것뿐이라 사람이 고칠 것이 없다.
    res.status(503).json({
      error: 'News Agent가 아직 활성화되지 않았습니다.',
      code: 'NEWS_AGENT_DISABLED',
    });
    return true;
  }

  /**
   * 기사에 그것을 데려온 관심의 이름을 붙인다. 노트에서 사라진 관심은 이름이
   * 없으므로 그 기사도 내보내지 않는다 — 왜 가져왔는지 설명할 수 없는 것을
   * 보여주면 그게 추천 알고리즘이다(설계 15).
   */
  function withProvenance(rows, interestsById) {
    return rows
      .map(row => {
        const topics = (row.interestIds || [])
          .map(id => interestsById.get(id)?.topic)
          .filter(Boolean);
        if (!topics.length) return null;
        return {
          id: row.id,
          title: row.title,
          url: row.url,
          source: row.source,
          publishedAt: row.publishedAt,
          summary: row.summary,
          // 사용자가 "왜 가져왔어?"라고 물으면 그대로 보여줄 두 값이다.
          why: row.reason,
          topics,
          relevance: row.relevance,
          importance: row.importance,
        };
      })
      .filter(Boolean);
  }

  app.get('/api/news/briefing', async (_req, res) => {
    if (guard(res)) return;
    try {
      const interests = await loadInterests();
      const interestsById = new Map(interests.map(item => [item.interestId, item]));
      const rows = store.briefingArticles({
        minRelevance: SURFACE_THRESHOLD.relevance,
        minImportance: SURFACE_THRESHOLD.importance,
        limit: 5,
      });
      const articles = withProvenance(rows, interestsById);
      res.json({
        // 없으면 홈은 영역 자체를 만들지 않는다(설계 14.2).
        articles,
        tracking: interests.length,
        counts: store.analysisCounts(),
        creditsUsed: store.creditsUsed(),
        creditLimit: store.monthlyCreditLimit,
      });
    } catch (error) {
      res.status(500).json({ error: '뉴스를 불러오지 못했습니다.', code: error?.code || 'NEWS_BRIEFING_FAILED' });
    }
  });

  app.post('/api/news/articles/:id/dismiss', (req, res) => {
    if (guard(res)) return;
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isSafeInteger(id) || id <= 0) {
      return res.status(400).json({ error: '기사 id가 올바르지 않습니다.', code: 'NEWS_ARTICLE_INVALID' });
    }
    return res.json({ dismissed: store.dismissArticle(id) });
  });
}

module.exports = { registerNewsRoutes };
