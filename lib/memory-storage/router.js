'use strict';

function isPlainObject(value) {
  return value !== null && typeof value === 'object'
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function isJsonValue(value, seen = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (!Array.isArray(value) && !isPlainObject(value)) return false;
  if (Object.getOwnPropertySymbols(value).length > 0) return false;
  if (seen.has(value)) return false;
  seen.add(value);
  const valid = Array.isArray(value)
    ? value.every(item => isJsonValue(item, seen))
    : Object.keys(value).every(key => isJsonValue(value[key], seen));
  seen.delete(value);
  return valid;
}

function validateCandidate(candidate) {
  if (!isPlainObject(candidate) || candidate.schemaVersion !== 1
      || Object.getOwnPropertySymbols(candidate).length > 0
      || Object.keys(candidate).sort().join(',') !== 'payload,schemaVersion,semanticFamily,sources') {
    throw new TypeError('Expected accepted storage candidate schemaVersion 1');
  }
  if (typeof candidate.semanticFamily !== 'string'
      || !/^[a-z][a-z0-9_-]{0,99}$/.test(candidate.semanticFamily)) {
    throw new TypeError('Invalid semanticFamily');
  }
  if (!isPlainObject(candidate.payload) || !isJsonValue(candidate.payload)) {
    throw new TypeError('Candidate payload must be a plain JSON-compatible object');
  }
  if (!Array.isArray(candidate.sources) || candidate.sources.length === 0) {
    throw new TypeError('Candidate sources must be non-empty');
  }
  for (const source of candidate.sources) {
    if (!isPlainObject(source)
        || Object.getOwnPropertySymbols(source).length > 0
        || Object.keys(source).some(key => !['sourceDomain', 'sourceKey', 'locator', 'sourceVersion'].includes(key))) {
      throw new TypeError('Invalid candidate source address');
    }
  }
  return candidate;
}

function createMemoryStorageRouter({ evidenceRegistry, transitionHandlers }) {
  if (typeof evidenceRegistry?.registerSources !== 'function' || !(transitionHandlers instanceof Map)) {
    throw new TypeError('Evidence registry and developer-registered transition handlers required');
  }
  return function routeAcceptedCandidate(value) {
    const candidate = validateCandidate(value);
    const handler = transitionHandlers.get(candidate.semanticFamily);
    if (typeof handler !== 'function') throw new Error(`Unregistered semantic family: ${candidate.semanticFamily}`);
    const evidenceRefs = evidenceRegistry.registerSources(candidate.sources);
    return handler({ candidate, evidenceRefs });
  };
}

module.exports = { validateCandidate, createMemoryStorageRouter };
