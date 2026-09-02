'use strict';

// 수집 orchestration. 관심 목록을 받아 질의를 만들고, 주입받은 검색 함수를 불러
// 결과를 정규화·중복 제거해 store에 넣는다.
//
// **LLM을 부르지 않는다.** 판단은 N4b이고, 그 전에 실제 기사 표본으로 threshold를
// 정하는 것이 설계 13절의 순서다. 메일이 MAIL-1을 통과하기 전에 LLM을 붙이지 않은
// 것과 같다 — 가져오는 것이 틀리면 판단을 아무리 잘해도 소용이 없다.
//
// 검색 함수를 인자로 받는 이유는 provider를 바꾸기 위해서가 아니라, 이 파일이
// 네트워크와 예산의 실제 구현을 모르게 하기 위해서다. server.js가
// `webService.search`를 넘긴다.

const { buildQuery, dedupeArticles, normalizeArticle } = require('./normalize');

// 한 관심을 얼마나 자주 볼 것인가. 6시간이면 하루 네 번이고, 관심 20개 상한에서
// 월 최대 2,400회다 — 그래서 store의 크레딧 한도가 실제로 문 역할을 한다.
const DEFAULT_POLL_INTERVAL_SECONDS = 6 * 60 * 60;
// 실패한 관심은 더 천천히 다시 본다. 같은 주기로 두면 죽은 질의가 예산을 갉는다.
const FAILURE_BACKOFF_SECONDS = 60 * 60;

const DEFAULT_MAX_RESULTS = 5;
const DEFAULT_TIME_RANGE = 'week';

/**
 * 관심 하나를 수집한다. 실패는 던지지 않고 결과에 담는다 — 관심 하나의 실패가
 * 나머지 수집을 멈추면 안 된다(설계 16).
 */
async function collectInterest({ interest, search, store, maxResults, timeRange, pollIntervalSeconds, now }) {
  const query = buildQuery(interest);
  if (!query) {
    return { interestId: interest.interestId, ok: false, code: 'NEWS_QUERY_EMPTY', saved: null };
  }

  try {
    store.assertCreditsAvailable(1, now);
  } catch (error) {
    // 예산이 없으면 다음 주기로 미루기만 하고 실패로 적지 않는다. 한도는 고장이
    // 아니라 정책이고, 실패로 적으면 다음 달에도 backoff가 남는다.
    return { interestId: interest.interestId, ok: false, code: error.code, saved: null, budget: true };
  }

  let result;
  try {
    result = await search(query, { topic: 'news', timeRange, maxResults });
  } catch (error) {
    store.markPollFailed({
      interestId: interest.interestId,
      code: error.code || 'NEWS_SEARCH_FAILED',
      nextPollAt: now + FAILURE_BACKOFF_SECONDS,
    });
    return { interestId: interest.interestId, ok: false, code: error.code || 'NEWS_SEARCH_FAILED', saved: null };
  }

  // 캐시가 돌려준 결과는 크레딧을 쓰지 않았다. 그것까지 세면 한도가 실제보다
  // 빨리 닫힌다.
  if (!result?.cached) store.recordCredits(result?.credits ?? 1, now);

  const articles = dedupeArticles(
    (result?.results || [])
      .map(item => normalizeArticle(item, { query }))
      .filter(Boolean),
  );
  const saved = store.saveArticles({ interestId: interest.interestId, articles, at: now });
  store.markPolled({ interestId: interest.interestId, nextPollAt: now + pollIntervalSeconds });
  return { interestId: interest.interestId, ok: true, code: null, saved, query };
}

/**
 * 지금 볼 때가 된 관심을 전부 수집한다.
 *
 * 관심 목록은 노트에서 온다 — DB가 아니다. 노트에서 사라진 관심은 여기 오지
 * 않으므로 `news_interest_polls`에 남은 행은 아무 일도 하지 않는다.
 */
async function collectNews({
  interests = [],
  search,
  store,
  now = Math.floor(Date.now() / 1000),
  maxResults = DEFAULT_MAX_RESULTS,
  timeRange = DEFAULT_TIME_RANGE,
  pollIntervalSeconds = DEFAULT_POLL_INTERVAL_SECONDS,
  maxInterestsPerRun = 10,
} = {}) {
  if (typeof search !== 'function') throw new TypeError('검색 함수가 필요합니다.');
  if (!store?.saveArticles) throw new TypeError('뉴스 저장소가 필요합니다.');

  const targets = store.pollTargets(interests, now).slice(0, maxInterestsPerRun);
  const results = [];
  for (const interest of targets) {
    // 순서대로 돈다. 병렬로 던지면 예산 검사가 서로를 못 보고 한도를 넘긴다.
    // eslint-disable-next-line no-await-in-loop
    results.push(await collectInterest({
      interest, search, store, maxResults, timeRange, pollIntervalSeconds, now,
    }));
  }
  return {
    attempted: targets.length,
    succeeded: results.filter(item => item.ok).length,
    created: results.reduce((total, item) => total + (item.saved?.created || 0), 0),
    linked: results.reduce((total, item) => total + (item.saved?.linked || 0), 0),
    results,
  };
}

/**
 * 수집 worker. `createScheduleNoteProjector`와 같은 모양이다 — tick 하나가 도는
 * 동안 다음 tick이 겹치지 않고, 도중에 요청이 들어오면 끝나고 한 번 더 돈다.
 *
 * 관심 목록을 인자가 아니라 `loadInterests`로 받는 이유는 정본이 노트이기
 * 때문이다. 기동 시점의 목록을 붙들고 있으면 사용자가 방금 등록한 관심이
 * 재시작 전까지 수집되지 않는다.
 */
function createNewsCollector({ loadInterests, search, store, intervalMs = 15 * 60 * 1000, onError, now, ...rest } = {}) {
  if (typeof loadInterests !== 'function') throw new TypeError('관심 목록 로더가 필요합니다.');
  const clock = typeof now === 'function' ? now : () => Math.floor(Date.now() / 1000);
  const report = typeof onError === 'function' ? onError : () => {};
  let running = null;
  let timer = null;
  let rerunRequested = false;

  async function run() {
    const interests = await loadInterests();
    if (!interests.length) return null;
    return collectNews({ ...rest, interests, search, store, now: Math.floor(clock()) });
  }

  return {
    tick() {
      if (running) {
        rerunRequested = true;
        return running;
      }
      running = (async () => {
        do {
          rerunRequested = false;
          try {
            await run();
          } catch (error) {
            report(error);
          }
        } while (rerunRequested);
      })().finally(() => { running = null; });
      return running;
    },
    start() {
      if (timer) return;
      void this.tick();
      timer = setInterval(() => { void this.tick(); }, intervalMs);
      timer.unref?.();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
    async drain(timeoutMs = 2000) {
      if (!running) return;
      let timeout;
      await Promise.race([
        running,
        new Promise(resolve => { timeout = setTimeout(resolve, timeoutMs); }),
      ]).finally(() => clearTimeout(timeout));
    },
  };
}

module.exports = {
  DEFAULT_MAX_RESULTS,
  DEFAULT_POLL_INTERVAL_SECONDS,
  DEFAULT_TIME_RANGE,
  FAILURE_BACKOFF_SECONDS,
  collectNews,
  createNewsCollector,
};
