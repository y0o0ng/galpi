'use strict';

const { locationKey } = require('./client-cache');
const { clientError } = require('./client-message');
const { UNIFIED_ROLES } = require('./client-search');

const DAY = 86400;
const WINDOW = 7 * DAY;
const WINDOWS_PER_PAGE = 3;
const RANGE_MAX = 200;
const COLLECTION_TTL = 300;
const SOURCE_PRIORITY = { fresh: 0, stale: 1, unavailable: 2 };
const GMAIL_LABEL = { inbox: 'INBOX', sent: 'SENT', drafts: 'DRAFT', junk: 'SPAM', trash: 'TRASH' };
const ALL_EXCLUDED = /^\\(?:drafts|trash|junk|spam)$/i;
const FOLDER_ROLE = { sent: /^\\sent$/i, drafts: /^\\drafts$/i, junk: /^\\(?:junk|spam)$/i, trash: /^\\trash$/i };
const NO_FALLBACK = new Set(['MAIL_CLIENT_ACCOUNT_DISABLED', 'MAIL_CLIENT_ACCOUNT_MISMATCH', 'MAIL_CLIENT_MAILBOX_UNAVAILABLE']);

// Gmail has every system label. An IMAP account needs exactly one selectable folder carrying the role.
// `all` is Gmail's All Mail, or every IMAP folder except Drafts/Junk/Trash (an unscoped search's definition).
function roleCollection(account, folders, role) {
  if (role === 'all') {
    if (account.provider === 'gmail') return { id: 'all', kind: 'all', inbox: false, selectable: true };
    const boxes = folders.filter(box => box.selectable && !ALL_EXCLUDED.test(box.specialUse || ''));
    return boxes.length ? boxes : null;
  }
  if (account.provider === 'gmail') return { providerId: GMAIL_LABEL[role], inbox: role === 'inbox', selectable: true };
  const matches = folders.filter(box => box.selectable
    && (role === 'inbox' ? box.inbox : FOLDER_ROLE[role].test(box.specialUse || '')));
  return matches.length === 1 ? matches[0] : null;
}

const compareHeads = (a, b) => b.head.receivedAt - a.head.receivedAt || a.state.account.id - b.state.account.id
  || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);

const failureOf = error => ({ code: error.code, statusCode: error.statusCode });

// A stream over rows cached from an earlier fresh read, used when the provider fails.
function staleStream(rows) {
  const queue = [...rows].sort((a, b) => b.metadata.receivedAt - a.metadata.receivedAt
    || (locationKey(a.locator) < locationKey(b.locator) ? -1 : 1));
  let taken = [];
  return {
    stale: true,
    async peek() {
      const row = queue[0];
      return row ? { receivedAt: row.metadata.receivedAt, locator: row.locator } : null;
    },
    advance(keep = true) {
      const row = queue.shift();
      if (keep) taken.push(row);
    },
    async finish() {
      const rows = taken;
      taken = [];
      return rows;
    },
    carry: () => (queue.length ? { rows: [...queue] } : null),
    async close() {},
  };
}

// A multi-folder collection carries each row's own folder flag.
function placed(atCollection, rows, collection) {
  if (!Array.isArray(collection)) return atCollection(rows, collection);
  return rows.map(row => row && atCollection([row], collection.find(box => box.path === row.locator.path) || {})[0]);
}

function createUnifiedReader({ cache, now, adapter, collections, requireObservation, atCollection, observation, assertGeneration, materialize, issue }) {
  async function target(account, role) {
    if (account.provider === 'gmail') return roleCollection(account, [], role);
    const collection = roleCollection(account, requireObservation(await collections(account, COLLECTION_TTL)), role);
    if (!collection) throw clientError('MAIL_CLIENT_MAILBOX_UNAVAILABLE', 503);
    return collection;
  }

  // Per-account candidate streams are merged by receive time; metadata is fetched only for emitted rows.
  async function readUnified(role, scope, accounts, limit, start, version) {
    let { upper } = start;
    const anchors = { ...start.anchors };
    const sources = { ...start.sources };
    const excluded = new Set(start.excluded);
    const seen = new Set(start.seen);
    let incomplete = start.incomplete;
    let inWindow = Object.keys(start.carry).length > 0;
    const pageSources = new Map();
    const states = new Map(accounts.filter(account => !excluded.has(account.id))
      .map(account => [account.id, { account, live: null, feed: null, source: null, collection: null, save: null }]));
    const active = () => [...states.values()].filter(state => !excluded.has(state.account.id));
    const taken = [];
    const saves = [];
    const heads = new Map();

    function observeSource(source) {
      const previous = pageSources.get(source.accountId);
      const priority = SOURCE_PRIORITY[source.status];
      const previousPriority = previous ? SOURCE_PRIORITY[previous.status] : -1;
      if (priority > previousPriority || (priority === previousPriority && source.fetchedAt > previous.fetchedAt)) {
        pageSources.set(source.accountId, source);
      }
    }

    function drop(state, failure) {
      const { account } = state;
      sources[account.id] = observation(account, 'unavailable', null, failure);
      observeSource(sources[account.id]);
      excluded.add(account.id);
      state.feed = null;
      heads.delete(account.id);
      // An account without this role is not a failure of the page.
      if (failure.code !== 'MAIL_CLIENT_MAILBOX_UNAVAILABLE') incomplete = true;
    }

    async function ensureLive(state, carry) {
      if (state.live) return state.live;
      const { account } = state;
      state.collection = await target(account, role);
      state.live = adapter(account).openStream(account, state.collection, { anchor: anchors[account.id] ?? null, carry });
      return state.live;
    }

    async function resume(state) {
      const saved = start.carry[state.account.id];
      if (!saved) return;
      state.source = saved.source;
      if (saved.stale) {
        state.feed = staleStream(saved.rows);
        return;
      }
      try {
        state.feed = await ensureLive(state, saved.data);
      } catch (error) {
        if (error?.statusCode == null) throw error;
        drop(state, failureOf(error));
      }
    }

    async function begin(state, from, to) {
      const { account } = state;
      const maximum = to - from <= 1 ? Infinity : RANGE_MAX;
      const key = 'unified:' + role + ':' + from + ':' + to;
      const previous = cache.readObservation(account.id, key);
      try {
        const live = await ensureLive(state);
        const found = await live.open({ from, to, maximum });
        assertGeneration(version);
        if (found.dense) return { dense: true };
        state.feed = live;
        state.source = observation(account, 'fresh', now());
        const save = { key, account, source: state.source, earlier: found.earlier, anchor: found.anchor, count: found.count, rows: [] };
        state.save = save;
        return { earlier: found.earlier, anchor: found.anchor, save };
      } catch (error) {
        assertGeneration(version);
        if (error?.statusCode == null) throw error;
        const failure = failureOf(error);
        if (previous && !NO_FALLBACK.has(error.code)) {
          state.feed = staleStream(previous.value.rows);
          state.source = observation(account, 'stale', previous.fetchedAt, failure);
          state.save = null;
          return { earlier: previous.value.earlier, anchor: previous.value.anchor };
        }
        return { failed: failure };
      }
    }

    async function openWindow() {
      const to = upper;
      let from = Math.max(0, to - WINDOW);
      let current;
      let outcomes;
      // A busy range is split before any rows from it are emitted. All accounts use the same boundary.
      for (;;) {
        current = active();
        outcomes = await Promise.all(current.map(state => begin(state, from, to)));
        assertGeneration(version);
        if (!outcomes.some(outcome => outcome.dense) || to - from <= 1) break;
        from += Math.floor((to - from) / 2);
      }
      let earlier = false;
      for (const [index, state] of current.entries()) {
        const outcome = outcomes[index];
        if (outcome.failed || outcome.dense) {
          drop(state, outcome.dense ? { code: 'MAIL_CLIENT_INBOX_RANGE_TOO_DENSE' } : outcome.failed);
          continue;
        }
        const { id } = state.account;
        sources[id] = state.source;
        observeSource(state.source);
        if (state.source.status !== 'fresh') incomplete = true;
        anchors[id] = outcome.anchor;
        earlier ||= outcome.earlier;
        if (outcome.save) saves.push(outcome.save);
      }
      upper = from > 0 && earlier ? from : null;
      inWindow = true;
      heads.clear();
    }

    // Takes the newest head across streams until the page is full (false) or the window is used up (true).
    async function merge() {
      for (;;) {
        if (taken.length >= limit) return false;
        await Promise.all(active().filter(state => state.feed && !heads.has(state.account.id)).map(async state => {
          try {
            heads.set(state.account.id, await state.feed.peek());
          } catch (error) {
            if (error?.statusCode == null) throw error;
            drop(state, failureOf(error));
          }
        }));
        assertGeneration(version);
        const ready = active().filter(state => heads.get(state.account.id)).map(state => {
          const head = heads.get(state.account.id);
          return { state, head, key: state.account.id + ':' + locationKey(head.locator) };
        });
        if (!ready.length) return true;
        const best = ready.reduce((first, entry) => compareHeads(entry, first) < 0 ? entry : first);
        const { state, head, key } = best;
        heads.delete(state.account.id);
        const duplicate = seen.has(key);
        state.feed.advance(!duplicate);
        if (duplicate) continue;
        seen.add(key);
        taken.push({ state, feed: state.feed, head, key, source: state.source, save: state.save });
      }
    }

    try {
      await Promise.all([...states.values()].map(resume));
      for (let hops = 0; taken.length < limit;) {
        if (!inWindow) {
          if (upper === null || hops >= WINDOWS_PER_PAGE) break;
          hops += 1;
          await openWindow();
        }
        if (await merge()) inWindow = false;
      }

      // The page is decided: fetch exactly the emitted rows, one batch per stream.
      const rows = new Array(taken.length).fill(null);
      const byFeed = new Map();
      taken.forEach((item, index) => {
        if (!byFeed.has(item.feed)) byFeed.set(item.feed, []);
        byFeed.get(item.feed).push(index);
      });
      await Promise.all([...byFeed].map(async ([feed, indexes]) => {
        const { state } = taken[indexes[0]];
        try {
          const done = await feed.finish();
          const current = feed.stale ? done : placed(atCollection, done, state.collection);
          indexes.forEach((index, i) => { rows[index] = current[i] ?? null; });
        } catch (error) {
          if (error?.statusCode == null) throw error;
          sources[state.account.id] = observation(state.account, 'unavailable', null, failureOf(error));
          observeSource(sources[state.account.id]);
          incomplete = true;
        }
      }));
      assertGeneration(version);
      const groups = new Map();
      taken.forEach((item, index) => {
        if (!rows[index]) return;
        observeSource(item.source);
        if (!groups.has(item.source)) groups.set(item.source, []);
        groups.get(item.source).push(index);
      });
      const messages = new Array(taken.length);
      await Promise.all([...groups].map(async ([source, indexes]) => {
        const { state, feed } = taken[indexes[0]];
        const items = await materialize(state.account, indexes.map(index => rows[index]), source, version, !feed.stale);
        indexes.forEach((index, i) => { messages[index] = items[i]; });
      }));
      assertGeneration(version);

      taken.forEach((item, index) => {
        if (item.save && rows[index] && !rows[index].detailError) item.save.rows.push(rows[index]);
      });
      for (const save of saves) {
        if (save.rows.length || save.count === 0) {
          cache.saveObservation(save.account.id, save.key, { rows: save.rows, earlier: save.earlier, anchor: save.anchor }, save.source.fetchedAt);
        }
      }

      const carry = {};
      for (const state of active()) {
        const data = state.feed?.carry();
        if (data) carry[state.account.id] = state.feed.stale ? { stale: true, rows: data.rows, source: state.source } : { data, source: state.source };
      }
      const more = Object.keys(carry).length > 0 || upper !== null;
      const page = messages.filter(Boolean);
      return {
        messages: page,
        sources: accounts.map(({ id }) => excluded.has(id) ? sources[id] : pageSources.get(id) || sources[id]),
        incomplete: incomplete || page.some(message => message.detailError),
        nextCursor: more ? issue(scope, { upper, carry, anchors, sources, excluded, seen, incomplete }) : null,
      };
    } finally {
      await Promise.all([...states.values()].map(state => state.live?.close()));
    }
  }

  return readUnified;
}

module.exports = { createUnifiedReader, roleCollection, UNIFIED_ROLES };
