/**
 * Small in-memory cache for Sonos queue counts.
 *
 * Sonos queue reads can block for several seconds when the speaker is under
 * network pressure. This cache lets simple count requests respond quickly with
 * the last known count while a fresh queue read continues in the background.
 */

const DEFAULT_MAX_AGE_MS = 5 * 60 * 1000;

let snapshot = null;

function normalizeTotal(queue) {
  if (!queue) return null;

  const total = Number(queue.total);
  if (Number.isFinite(total) && total >= 0) {
    return total;
  }

  if (Array.isArray(queue.items)) {
    return queue.items.length;
  }

  return null;
}

function setTotal(total, source = 'manual') {
  const normalized = Number(total);
  if (!Number.isFinite(normalized) || normalized < 0) {
    return null;
  }

  snapshot = {
    total: Math.floor(normalized),
    updatedAt: Date.now(),
    source
  };

  return getSnapshot();
}

function updateFromQueue(queue, source = 'getQueue') {
  const total = normalizeTotal(queue);
  return total === null ? null : setTotal(total, source);
}

function adjustTotal(delta, source = 'adjust') {
  if (!snapshot) {
    return null;
  }

  const normalizedDelta = Number(delta);
  if (!Number.isFinite(normalizedDelta)) {
    return null;
  }

  return setTotal(Math.max(0, snapshot.total + normalizedDelta), source);
}

function getSnapshot(maxAgeMs = DEFAULT_MAX_AGE_MS) {
  if (!snapshot) {
    return null;
  }

  const ageMs = Date.now() - snapshot.updatedAt;
  if (Number.isFinite(maxAgeMs) && maxAgeMs >= 0 && ageMs > maxAgeMs) {
    return null;
  }

  return {
    ...snapshot,
    ageMs
  };
}

function clear() {
  snapshot = null;
}

module.exports = {
  DEFAULT_MAX_AGE_MS,
  adjustTotal,
  clear,
  getSnapshot,
  normalizeTotal,
  setTotal,
  updateFromQueue
};
