'use strict';

// 재확인 (설계 11). `expressed`가 오래 조용하면 시온이 먼저 묻는다.
//
// **이 파일의 판단에는 LLM이 없다.** 묻지 않을 이유를 찾는 일이라 결정적 검사로
// 충분하고, 놓쳐서 묻는 것보다 과하게 걸려서 안 묻는 쪽이 낫다(설계 11.2).
//
// **두 개의 문이 있고 둘 다 닫혀야 묻는다.**
// 1. `review_after`가 지났고, 그 뒤로 사용자가 그 주제를 말한 적이 없다.
// 2. 사용자가 지금 앱을 쓰고 있다.
//
// 두 번째가 이 설계의 핵심이다. 몇 주 동안 앱을 안 쓰는 사람에게 "아직 관심
// 있어?"를 푸시하는 것이 이 기능의 최악의 실패라, 판정을 독립 스케줄러의 시계가
// 아니라 **사용자 메시지 처리 뒤**에 건다. 조용한 사용자에게는 아무 일도 일어나지
// 않는다. 이것은 제약이 아니라 의도이므로 나중에 스케줄러로 바꾸지 않는다.

const KST_OFFSET_SECONDS = 9 * 60 * 60;
const DAY_SECONDS = 24 * 60 * 60;

// **잠정값이다.** 설계 22절이 "근거 있는 확정값이 아니다"라고 남겨둔 자리이고,
// 18절의 review 지표가 쌓인 뒤에 정한다.
const DEFAULT_REVIEW_DAYS = 30;
// 최근 언급이 걸리면 이만큼 미룬다. 처음 기간보다 짧게 두어, 관심이 식는 중인
// 주제를 영원히 못 묻는 상태로 만들지 않는다.
const EXTEND_DAYS = 14;
// 답이 없으면 이때 만료한다. 같은 질문을 즉시 다시 보내지 않는다(설계 11.7).
const CANDIDATE_TTL_SECONDS = 3 * DAY_SECONDS;

function kstDate(epochSeconds) {
  return new Date((Math.floor(epochSeconds) + KST_OFFSET_SECONDS) * 1000)
    .toISOString()
    .slice(0, 10);
}

function kstDateToEpoch(value) {
  const parsed = Date.parse(`${String(value || '')}T00:00:00Z`);
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) - KST_OFFSET_SECONDS : null;
}

function addDays(epochSeconds, days) {
  return kstDate(epochSeconds + days * DAY_SECONDS);
}

/** `expressed` 관심이 생길 때 붙는 재확인 예정일. */
function initialReviewAfter(nowSeconds, days = DEFAULT_REVIEW_DAYS) {
  return addDays(nowSeconds, days);
}

function extendedReviewAfter(nowSeconds, days = EXTEND_DAYS) {
  return addDays(nowSeconds, days);
}

/**
 * 최근 언급 검사에 쓰는 낱말들. topic과 사용자가 등록한 별칭에서만 나온다.
 *
 * 너무 짧은 조각은 뺀다 — 두 글자짜리가 아무 문장에나 걸리면 검사가 늘 통과해
 * 재확인이 영영 나가지 않는다.
 */
function mentionTerms(interest) {
  const source = [interest?.topic, ...(Array.isArray(interest?.aliases) ? interest.aliases : [])];
  return source
    .map(value => String(value ?? '').toLowerCase().trim())
    .filter(value => value.length >= 3);
}

/**
 * `since` 이후 사용자 발화에 이 관심이 나왔는가.
 *
 * `messages`는 사용자 발화만 본다. 시온이 먼저 꺼낸 주제는 관심의 근거가 아니고
 * (설계 6.2), proactive 질문 자체가 "최근에 언급됐다"로 읽히면 시온이 자기
 * 질문 때문에 다시 묻지 않게 되는 것이 아니라 **영영 묻지 않게** 된다.
 */
function mentionedSince({ interest, messages }) {
  const terms = mentionTerms(interest);
  if (!terms.length) return false;
  return messages.some(message => {
    const text = String(message?.content ?? '').toLowerCase();
    return terms.some(term => text.includes(term));
  });
}

/**
 * 지금 물어볼 관심 하나를 고른다. 없으면 null이다.
 *
 * 한 번에 하나만 고른다 — 두 개를 한꺼번에 물으면 사용자의 한 마디가 어느 쪽
 * 답인지 알 수 없고, 그것을 풀려면 대화가 아니라 양식이 된다.
 */
function pickReviewTarget({ interests, now, loadUserMessagesSince, openInterestIds = new Set() }) {
  const today = kstDate(now);
  const due = interests.filter(interest => (
    interest.state === 'expressed'
    && interest.reviewAfter
    && interest.reviewAfter <= today
    && !openInterestIds.has(interest.interestId)
  ));
  if (!due.length) return null;

  for (const interest of due) {
    // **last_seen 당일은 이미 센 것이다.** 그날 자정부터 훑으면 last_seen을 만든
    // 바로 그 발화가 다시 잡혀 "최근에 말했다"로 오판하고, 관심이 영영 재확인되지
    // 않는다. 하루 뒤부터 본다.
    const lastSeenAt = kstDateToEpoch(interest.lastSeen);
    const since = lastSeenAt === null ? now - 90 * DAY_SECONDS : lastSeenAt + DAY_SECONDS;
    const messages = loadUserMessagesSince(since);
    if (mentionedSince({ interest, messages })) {
      // 계속 이야기하는 주제에는 묻지 않는다. 대신 미룬다.
      return { interest, action: 'extend', reviewAfter: extendedReviewAfter(now) };
    }
    return { interest, action: 'ask' };
  }
  return null;
}

/** 재확인 질문 문면. 사용자가 쓴 주제 이름을 그대로 쓴다. */
function reviewQuestion(interest) {
  return `전에 ${interest.topic} 쪽에 관심 있다고 했었는데, 요즘은 이야기가 없네. 앞으로도 관련 소식 계속 챙겨볼까?`;
}

module.exports = {
  CANDIDATE_TTL_SECONDS,
  DEFAULT_REVIEW_DAYS,
  EXTEND_DAYS,
  extendedReviewAfter,
  initialReviewAfter,
  kstDate,
  kstDateToEpoch,
  mentionTerms,
  mentionedSince,
  pickReviewTarget,
  reviewQuestion,
};
