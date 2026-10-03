'use strict';

// 하루 1회 후보 배치(설계 v0.2 7장 1단계): 수집 → Opus 1회 → 저장 → Push.
//
// **그날 호출은 최대 3번이다.** `claimRun`이 호출 전에 날짜 행을 잡고, 실패한 날은 1시간 간격으로만 다시 잡는다(store.js).
// 그래서 실패·시간 초과·재시작에도 재시도가 폭주하지 않는다. 3번을 다 쓰면 그날은 후보 없음으로 끝난다.

const { COVERED_CONCEPTS, generateCandidates } = require('./candidates');
const { collectReelsItems } = require('./collect');

const KST_OFFSET_SECONDS = 9 * 60 * 60;
// 19:00 KST(사용자 결정 2026-10-03): 저녁에 주제를 고르면 새벽에 만들고 아침에 확인한다(설계 v0.2 1장).
// 실패 재시도 두 번(20·21시)까지 조용한 시간(23:00~07:00) 전에 끝난다.
const RUN_AT_KST_SECONDS = 19 * 60 * 60;
// 미결정 배치는 3일 뒤 닫는다. 수집 창이 72시간이라 그보다 오래된 후보는 "며칠 안의 뉴스"가 아니고, 그 사이 새 배치가 두세 번 왔다.
const EXPIRE_AFTER_SECONDS = 3 * 24 * 60 * 60;

function kstDay(now) {
  return new Date((now + KST_OFFSET_SECONDS) * 1000).toISOString().slice(0, 10);
}

function createReelsWorker({
  store, pushService = null, pushDispatcher = null, bin, spawn, fetchImpl, onError = () => {},
  intervalMs = 15 * 60 * 1000, now: clockOption,
}) {
  if (!store?.claimRun) throw new TypeError('Reels 저장소가 필요합니다.');
  if (!bin) throw new TypeError('claude 실행 경로가 필요합니다.');
  const clock = typeof clockOption === 'function' ? clockOption : () => Math.floor(Date.now() / 1000);
  let running = null;
  let timer = null;

  async function run() {
    const now = Math.floor(clock());
    store.expireStale(EXPIRE_AFTER_SECONDS);
    if ((now + KST_OFFSET_SECONDS) % 86400 < RUN_AT_KST_SECONDS) return;
    const day = kstDay(now);
    if (!store.claimRun(day)) return;
    try {
      const items = await collectReelsItems({ fetchImpl, now });
      if (!items.length) throw Object.assign(new Error('수집된 항목이 없습니다.'), { code: 'REELS_NO_ITEMS' });
      const cards = await generateCandidates({
        items, today: day, bin, spawn,
        covered: [...COVERED_CONCEPTS, ...store.coveredConcepts()],
      });
      store.saveBatch({ day, cards, collectedAt: now });
      pushService?.enqueueBatch(day, now);
      void pushDispatcher?.tick();
    } catch (error) {
      store.failRun(day, error?.code, error?.detail);
      onError(error);
    }
  }

  return {
    tick() {
      if (!running) running = run().catch(onError).finally(() => { running = null; });
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
  };
}

module.exports = { EXPIRE_AFTER_SECONDS, RUN_AT_KST_SECONDS, createReelsWorker, kstDay };
