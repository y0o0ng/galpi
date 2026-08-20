'use strict';

// News Agent 관심 노트의 계약. 형식·파싱·검증·다음 본문 생성만 맡고, 파일 쓰기와
// DB 등록은 호출부(server.js의 기존 topicMutations 경로)가 한다.
//
// 설계 단일 기준은 docs/xion-news-agent-design.md 8·9·10절이다.
//
// **일정 노트와 다른 점이 하나 있다.** `assistant-schedule-notes.js`는 DB에서 매번
// 다시 만드는 projection이라 이전 본문을 읽을 필요가 없지만(마커 보존만 한다),
// 관심 노트는 **살아있는 상태 노트**라 이전 본문이 정본이다(설계 22.1). 그래서
// 여기에는 파서가 있고, 모든 변경이 `parse → validate → build`를 거친다.
//
// 파싱에 실패하면 부분 복구를 시도하지 않고 던진다. 호출부는 mutation 전체를
// 폐기한다(설계 16). 관심 몇 개를 살리려다 사용자가 직접 말한 상태를 잘못 고쳐
// 쓰는 것이 더 나쁘다.

const crypto = require('crypto');

const NOTE_ID = 'xion-news-context';
const NOTE_FILENAME = `${NOTE_ID}.md`;
const NOTE_TITLE = 'XION News Context';
const NOTE_TYPE = 'news_context';
const OWNER_AGENT = 'news';

const BODY_START = '<!-- XION-NEWS-START -->';
const BODY_END = '<!-- XION-NEWS-END -->';

const STATES = ['inferred', 'expressed', 'subscribed'];
const OPS = ['add', 'update', 'remove', 'noop'];

// 설계 10절 9번. 실사용 관찰 후 조정한다.
const MAX_INTERESTS = 20;

// topic과 reason의 길이 상한. 노트 전체가 작아야 batch 입력이 작다(설계 17.4).
const MAX_TOPIC_CHARS = 80;
const MAX_REASON_CHARS = 300;

const KST_OFFSET_SECONDS = 9 * 60 * 60;

function noteError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function kstDate(epochSeconds) {
  if (!Number.isFinite(epochSeconds)) throw new TypeError('시각이 필요합니다.');
  return new Date((Math.floor(epochSeconds) + KST_OFFSET_SECONDS) * 1000)
    .toISOString()
    .slice(0, 10);
}

function oneLine(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * topic 중복 판정의 유일한 기준(설계 10절 4번).
 *
 * 결정적인 변환만 쓴다 — 현재 시각이나 로케일에 기대는 것을 넣으면 같은 노트를
 * 두 번 읽을 때 다른 답이 나온다. 판정을 프롬프트가 아니라 여기 한 곳에 두는
 * 이유는 `lib/mail/agent.js`의 identity와 같다: 두 곳에 두면 한쪽만 고쳐지는
 * 순간 같은 관심이 두 항목이 된다.
 */
function normalizeTopic(value) {
  return oneLine(value)
    .toLowerCase()
    // 한글 조사와 영어 관사는 같은 주제를 다른 문자열로 만든다.
    .replace(/\b(the|a|an)\b/g, ' ')
    .replace(/(은|는|이|가|을|를|의|에|와|과|랑|이랑)\s/g, ' ')
    // 구분 기호는 전부 같은 값으로 접는다. "local-LLM"과 "local LLM"은 같은 주제다.
    .replace(/[\s._/\\-]+/g, ' ')
    .trim();
}

function makeInterestId(topic, existingIds) {
  const base = crypto.createHash('sha256').update(normalizeTopic(topic)).digest('hex');
  // 짧은 id를 쓰되 충돌하면 늘린다. 4바이트로 20개 안에서 부딪힐 일은 거의 없지만
  // 부딪혔을 때 조용히 덮어쓰는 것이 최악이라 길이로 피한다.
  for (let length = 4; length <= 32; length += 4) {
    const id = `news-${base.slice(0, length)}`;
    if (!existingIds.has(id)) return id;
  }
  throw noteError('interest_id를 만들 수 없습니다.', 'NEWS_INTEREST_ID_EXHAUSTED');
}

function markerBlock(raw, name) {
  const pattern = new RegExp(`<!-- CODEX-${name}-START -->[\\s\\S]*?<!-- CODEX-${name}-END -->`);
  return String(raw || '').match(pattern)?.[0] || `<!-- CODEX-${name}-START -->\n<!-- CODEX-${name}-END -->`;
}

function frontmatterValue(raw, key) {
  const match = String(raw || '').match(new RegExp(`^${key}:\\s*(.*)$`, 'm'));
  return match?.[1]?.trim().replace(/^"(.*)"$/, '$1') || null;
}

/**
 * `XION-NEWS` 마커 사이만 읽는다. 마커 밖은 이 모듈이 만들지도 읽지도 않으므로
 * Codex 영역과 사람이 쓴 문장이 파싱에 섞이지 않는다(설계 9).
 */
function extractBody(raw) {
  const text = String(raw ?? '');
  if (!text.trim()) return '';
  const start = text.indexOf(BODY_START);
  const end = text.indexOf(BODY_END, start + BODY_START.length);
  if (start < 0 || end < 0) {
    throw noteError('관심 노트의 XION-NEWS 마커를 찾을 수 없습니다.', 'NEWS_NOTE_MARKER_MISSING');
  }
  return text.slice(start + BODY_START.length, end);
}

const FIELD_PATTERN = /^(state|last_seen|review_after|reason|aliases):\s*(.*)$/;

/**
 * 노트 본문 → interest 배열.
 *
 * 형식은 한 항목이 `### topic` + `<!-- interest_id: ... -->` + `key: value` 줄들이다.
 * 값 하나가 한 줄을 넘지 않으므로 파서가 상태를 거의 들지 않는다.
 */
function parseNewsContextNote(raw) {
  const body = extractBody(raw);
  const interests = [];
  let current = null;

  for (const line of body.split('\n')) {
    const heading = /^###\s+(.*)$/.exec(line);
    if (heading) {
      current = { topic: oneLine(heading[1]), interestId: null, aliases: [] };
      interests.push(current);
      continue;
    }
    if (!current) continue;

    const idComment = /^<!--\s*interest_id:\s*(\S+)\s*-->$/.exec(line.trim());
    if (idComment) {
      current.interestId = idComment[1];
      continue;
    }

    const field = FIELD_PATTERN.exec(line);
    if (!field) continue;
    const [, key, value] = field;
    if (key === 'aliases') {
      current.aliases = oneLine(value).split(',').map(oneLine).filter(Boolean);
    } else {
      current[key === 'last_seen' ? 'lastSeen' : key === 'review_after' ? 'reviewAfter' : key] = oneLine(value);
    }
  }

  interests.forEach(interest => {
    if (!interest.interestId) {
      throw noteError(`interest_id가 없는 항목이 있습니다: ${interest.topic}`, 'NEWS_INTEREST_ID_MISSING');
    }
    if (!STATES.includes(interest.state)) {
      throw noteError(`state가 올바르지 않습니다: ${interest.interestId}`, 'NEWS_INTEREST_STATE_INVALID');
    }
  });

  const seen = new Set();
  interests.forEach(interest => {
    if (seen.has(interest.interestId)) {
      throw noteError(`interest_id가 중복됩니다: ${interest.interestId}`, 'NEWS_INTEREST_ID_DUPLICATE');
    }
    seen.add(interest.interestId);
  });

  return interests;
}

function interestSection(interest) {
  const lines = [
    `### ${interest.topic}`,
    `<!-- interest_id: ${interest.interestId} -->`,
    `state: ${interest.state}`,
    `last_seen: ${interest.lastSeen}`,
  ];
  if (interest.reviewAfter) lines.push(`review_after: ${interest.reviewAfter}`);
  if (interest.aliases?.length) lines.push(`aliases: ${interest.aliases.join(', ')}`);
  if (interest.reason) lines.push(`reason: ${interest.reason}`);
  return lines.join('\n');
}

/**
 * interest 배열 → 노트 전체 본문.
 *
 * `previousRaw`의 CODEX 마커와 `created`는 그대로 옮긴다. 이 모듈이 Codex 영역을
 * 새로 만들면 Codex가 붙여둔 태그·연결이 매번 지워진다.
 */
function buildNewsContextNote({ interests, previousRaw = '', updatedAt }) {
  if (!Array.isArray(interests)) throw new TypeError('관심 배열이 필요합니다.');
  if (!Number.isFinite(updatedAt)) throw new TypeError('관심 노트 갱신 시각이 필요합니다.');

  const updated = kstDate(updatedAt);
  const created = frontmatterValue(previousRaw, 'created') || updated;
  const sections = interests.length
    ? interests.map(interestSection).join('\n\n')
    : '아직 추적 중인 관심사가 없다.';

  return `---
id: ${NOTE_ID}
title: "${NOTE_TITLE}"
created: ${created}
updated: ${updated}
note_type: ${NOTE_TYPE}
archived: false
codex_status: pending
ai_readable: true
owner_agent: ${OWNER_AGENT}
---

# ${NOTE_TITLE}

> 시온이 외부 변화를 지켜볼 주제의 현재 상태다. 근거는 사용자 발화이며 뉴스 기사는 이 노트를 바꾸지 않는다.
> 이 본문은 News Agent만 수정한다. 관심을 더하거나 빼려면 시온에게 말한다.

${BODY_START}

## Interests

${sections}

${BODY_END}

## 🏷️ 주제 태그
${markerBlock(previousRaw, 'TAGS')}

## 🔗 연결
${markerBlock(previousRaw, 'LINKS')}
`;
}

function requireOp(action) {
  if (!OPS.includes(action?.op)) {
    throw noteError(`허용되지 않은 op입니다: ${action?.op}`, 'NEWS_ACTION_OP_INVALID');
  }
  return action.op;
}

function findExactlyOne(interests, interestId, op) {
  const matches = interests.filter(interest => interest.interestId === interestId);
  if (matches.length !== 1) {
    throw noteError(
      `${op} 대상 interest_id가 정확히 하나가 아닙니다: ${interestId} (${matches.length}건)`,
      'NEWS_ACTION_TARGET_INVALID',
    );
  }
  return matches[0];
}

function assertTopic(topic) {
  const text = oneLine(topic);
  const normalized = normalizeTopic(text);
  if (!normalized) {
    throw noteError('topic이 비어 있습니다.', 'NEWS_TOPIC_EMPTY');
  }
  if (text.length > MAX_TOPIC_CHARS) {
    throw noteError(`topic이 너무 깁니다: ${text.length}자`, 'NEWS_TOPIC_TOO_LONG');
  }
  return text;
}

/**
 * 구조화 action을 현재 노트에 적용한다.
 *
 * **부분 적용이 없다**(설계 16). 하나라도 검증에 걸리면 던지고, 호출부는 이전
 * 본문을 그대로 둔다. 그래서 이 함수는 입력 배열을 복사해서만 다루고 중간
 * 상태를 밖으로 흘리지 않는다.
 *
 * `source`는 `'user'`(hot path)와 `'background'`(v2 batch)뿐이다. 둘을 가르는
 * 이유는 하나다 — background는 `subscribed`를 지울 수 없다(설계 4.2).
 */
function applyInterestActions({ raw = '', actions, now, source = 'user' }) {
  if (!Array.isArray(actions)) throw new TypeError('action 배열이 필요합니다.');
  if (!Number.isFinite(now)) throw new TypeError('현재 시각이 필요합니다.');
  if (source !== 'user' && source !== 'background') {
    throw noteError(`source가 올바르지 않습니다: ${source}`, 'NEWS_ACTION_SOURCE_INVALID');
  }

  const interests = parseNewsContextNote(raw).map(interest => ({ ...interest }));
  const today = kstDate(now);

  actions.forEach(action => {
    const op = requireOp(action);
    if (op === 'noop') return;

    if (op === 'add') {
      const topic = assertTopic(action.topic);
      if (!STATES.includes(action.state)) {
        throw noteError(`state가 올바르지 않습니다: ${action.state}`, 'NEWS_ACTION_STATE_INVALID');
      }
      // background가 `inferred` 아닌 상태를 만들면 사용자가 말하지 않은 관심이
      // 지속 구독으로 올라선다(설계 4.2·6.2).
      if (source === 'background' && action.state !== 'inferred') {
        throw noteError(
          `background는 ${action.state} 관심을 만들 수 없습니다.`,
          'NEWS_ACTION_STATE_FORBIDDEN',
        );
      }
      const normalized = normalizeTopic(topic);
      const existing = interests.find(interest => normalizeTopic(interest.topic) === normalized);
      if (existing) {
        throw noteError(
          `이미 같은 topic이 있습니다: ${existing.interestId}`,
          'NEWS_TOPIC_DUPLICATE',
        );
      }
      if (interests.length >= MAX_INTERESTS) {
        throw noteError(`관심사 상한 ${MAX_INTERESTS}개를 넘습니다.`, 'NEWS_INTEREST_LIMIT');
      }
      interests.push({
        interestId: makeInterestId(topic, new Set(interests.map(item => item.interestId))),
        topic,
        state: action.state,
        lastSeen: today,
        reviewAfter: oneLine(action.reviewAfter) || null,
        aliases: Array.isArray(action.aliases) ? action.aliases.map(oneLine).filter(Boolean) : [],
        reason: oneLine(action.reason).slice(0, MAX_REASON_CHARS) || null,
      });
      return;
    }

    if (op === 'remove') {
      const target = findExactlyOne(interests, action.interestId, 'remove');
      if (source === 'background' && target.state === 'subscribed') {
        throw noteError(
          `background는 subscribed 관심을 제거할 수 없습니다: ${target.interestId}`,
          'NEWS_ACTION_REMOVE_FORBIDDEN',
        );
      }
      interests.splice(interests.indexOf(target), 1);
      return;
    }

    // update
    const target = findExactlyOne(interests, action.interestId, 'update');
    if (action.state !== undefined) {
      if (!STATES.includes(action.state)) {
        throw noteError(`state가 올바르지 않습니다: ${action.state}`, 'NEWS_ACTION_STATE_INVALID');
      }
      if (source === 'background' && action.state === 'subscribed') {
        throw noteError(
          'background는 관심을 subscribed로 올릴 수 없습니다.',
          'NEWS_ACTION_STATE_FORBIDDEN',
        );
      }
      target.state = action.state;
    }
    if (action.topic !== undefined) {
      const topic = assertTopic(action.topic);
      const normalized = normalizeTopic(topic);
      const clash = interests.find(
        interest => interest !== target && normalizeTopic(interest.topic) === normalized,
      );
      if (clash) {
        throw noteError(`이미 같은 topic이 있습니다: ${clash.interestId}`, 'NEWS_TOPIC_DUPLICATE');
      }
      // topic이 바뀌어도 interest_id는 그대로 둔다(설계 8.1). id가 따라 움직이면
      // 열려 있는 review candidate가 대상을 잃는다.
      target.topic = topic;
    }
    if (action.reviewAfter !== undefined) target.reviewAfter = oneLine(action.reviewAfter) || null;
    if (action.aliases !== undefined) {
      target.aliases = Array.isArray(action.aliases) ? action.aliases.map(oneLine).filter(Boolean) : [];
    }
    if (action.reason !== undefined) {
      target.reason = oneLine(action.reason).slice(0, MAX_REASON_CHARS) || null;
    }
    // update는 언급이 있었다는 뜻이므로 last_seen은 항상 오늘이다(설계 5).
    target.lastSeen = today;
  });

  return {
    interests,
    content: buildNewsContextNote({ interests, previousRaw: raw, updatedAt: now }),
  };
}

module.exports = {
  MAX_INTERESTS,
  NOTE_FILENAME,
  NOTE_ID,
  NOTE_TITLE,
  NOTE_TYPE,
  OWNER_AGENT,
  STATES,
  applyInterestActions,
  buildNewsContextNote,
  normalizeTopic,
  parseNewsContextNote,
};
