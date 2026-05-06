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

/* Total size in bytes of every value held by localStorage, summed
   across all keys. Browsers don't expose a quota or a usage figure,
   but stringifying every entry once is cheap (the values are already
   in memory) and lets the app warn before it hits the wall. */
function measureStorageSize() {
  try {
    var total = 0;
    var n = localStorage.length || 0;
    for (var i = 0; i < n; i++) {
      var k = localStorage.key(i);
      if (!k) continue;
      var v = localStorage.getItem(k);
      total += (k.length + (v ? v.length : 0)) * 2; /* utf-16 */
    }
    return total;
  } catch (e) {
    return 0;
  }
}

/* Detect "quota exceeded" across browser variants. Chrome/Edge throw
   DOMException with name 'QuotaExceededError', Firefox uses
   'NS_ERROR_DOM_QUOTA_REACHED', Safari historically used code 22. */
function _isQuotaError(e) {
  if (!e) return false;
  if (e.name === 'QuotaExceededError') return true;
  if (e.name === 'NS_ERROR_DOM_QUOTA_REACHED') return true;
  if (e.code === 22 || e.code === 1014) return true;
  if (typeof e.message === 'string' && /quota/i.test(e.message)) return true;
  return false;
}

/* When a write hits quota, callers can register a prune callback that
   tries to reclaim space (drop oldest entries from rolling buffers,
   collapse history caches, etc.). Each callback returns a non-zero
   number to indicate it freed something; if any does, we retry the
   write once. */
var _quotaPruners = [];
function registerQuotaPruner(fn) {
  if (typeof fn === 'function') _quotaPruners.push(fn);
}
function _attemptPrune() {
  var freed = 0;
  for (var i = 0; i < _quotaPruners.length; i++) {
    try {
      var n = _quotaPruners[i]();
      if (typeof n === 'number' && n > 0) freed += n;
    } catch (e) {
      /* never let a misbehaving pruner break the write path */
    }
  }
  return freed;
}

function safeSetJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
    if (_isQuotaError(e) && _quotaPruners.length) {
      console.warn('[storage] quota hit on', key, '— attempting prune');
      var freed = _attemptPrune();
      if (freed > 0) {
        try {
          localStorage.setItem(key, JSON.stringify(value));
          console.warn('[storage] write succeeded after prune freed', freed, 'entries');
          return true;
        } catch (e2) {
          console.warn('[storage] write still failed after prune for', key, '—', e2 && e2.message);
          return false;
        }
      }
    }
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
