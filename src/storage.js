/* NEXUS PRO — small wrappers around localStorage and a generic debounced
   saver. Centralizes the try/catch boilerplate that was sprinkled across
   ~100 sites in app.js so future stores can opt in without re-deriving
   the same pattern (and so the eventual quota / migration handling lives
   in one place).

   Failure semantics
   - Reads always return the fallback if storage is unavailable, the key
     is missing, or the JSON is corrupt. They never throw.
   - Writes return `true` on success and `false` on failure (quota
     exceeded, private mode, missing API). They never throw.
   - All errors are logged at console.warn so problems are visible
     without breaking the app. */

/* ─── reads ────────────────────────────────────────────────────── */

/* JSON-parsed read with structural fallback. */
function safeGetJSON(key, fallback) {
  try {
    var raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    return JSON.parse(raw);
  } catch (e) {
    console.warn('[storage] safeGetJSON failed for', key, '—', e && e.message);
    return fallback;
  }
}

/* Plain-string read. Useful for single-value prefs (theme, language). */
function safeGet(key, fallback) {
  try {
    var v = localStorage.getItem(key);
    return v == null ? fallback : v;
  } catch (e) {
    return fallback;
  }
}

/* ─── writes ───────────────────────────────────────────────────── */

function safeSetJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
    console.warn('[storage] safeSetJSON failed for', key, '—', e && e.message);
    return false;
  }
}

function safeSet(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (e) {
    console.warn('[storage] safeSet failed for', key, '—', e && e.message);
    return false;
  }
}

function safeRemove(key) {
  try {
    localStorage.removeItem(key);
    return true;
  } catch (e) {
    return false;
  }
}

/* ─── debounced saver ──────────────────────────────────────────── */

/* Returns an object with .schedule() and .flush(). Each .schedule() call
   resets a timer; when the timer fires (or on .flush()) the underlying
   saveFn runs once. Also auto-flushes on pagehide/beforeunload so
   pending writes aren't lost when the tab is closed. Use this for state
   that gets touched many times in a burst (per-trade updates,
   per-tick stats) so the persist cost is amortised. */
function makeDebouncedSaver(saveFn, delayMs) {
  var delay = typeof delayMs === 'number' ? delayMs : 2000;
  var timer = null;
  var pending = false;

  function runNow() {
    pending = false;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    try {
      saveFn();
    } catch (e) {
      console.warn('[storage] debounced save threw —', e && e.message);
    }
  }

  function schedule() {
    pending = true;
    if (timer) clearTimeout(timer);
    timer = setTimeout(runNow, delay);
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', function () {
      if (pending) runNow();
    });
    window.addEventListener('pagehide', function () {
      if (pending) runNow();
    });
  }

  return { schedule: schedule, flush: runNow };
}
