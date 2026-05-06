/* NEXUS PRO — connection layer.
   Owns the JSON fetch helper used by every API caller, the rate-limit
   cooldown that backs it, the running connection metrics, and the
   small UI helpers that turn those metrics into a status indicator.

   The actual data-loading routines (loadTk and friends) stay in app.js
   because they coordinate too many domain-specific stores. This module
   is the substrate they call into.

   Cross-file dependencies (resolved at call time):
     - app.js: T (price ticker map), lastDataTime (validator state),
               CBP (Coinbase prices, optional), lang (UI language) */

/* ─── rate-limit cooldown ──────────────────────────────────────── */

/* Set when an upstream API tells us to back off (HTTP 429 / 418 / 403).
   While Date.now() < apiCooldown.until, fj() returns null without even
   trying the network — so a single rate-limit response also gates the
   ~30 sibling requests that would otherwise pile in.

   The .attempts counter drives an exponential backoff: repeated 403s do
   not re-arm the same 10-minute ban every time; instead the cooldown
   grows (1×, 2×, 4×, capped at 8×) until we get a successful response,
   at which point it resets to 0 — so a transient outage doesn't evict
   the user for an hour. */
var apiCooldown = { until: 0, reason: '', attempts: 0 };
function applyBackoff(baseMs, reason) {
  var multiplier = Math.min(8, Math.pow(2, apiCooldown.attempts));
  apiCooldown.until = Date.now() + baseMs * multiplier;
  apiCooldown.reason = reason;
  apiCooldown.attempts++;
}

/* ─── connection metrics (reset never; tab-lifetime counters) ──── */
var connMetrics = {
  apiOk: 0,
  apiFail: 0,
  wsUp: false,
  lastLatency: 0,
  lastCheck: Date.now(),
};

/* ─── safe JSON fetch with timeout, cooldown, and metric updates ─ */

/* Wraps fetch() with an 8-second AbortController timeout, applies the
   shared cooldown on rate-limit responses, and updates connMetrics on
   every call. Returns parsed JSON or null on failure — never throws. */
async function fj(u) {
  if (Date.now() < apiCooldown.until) return null;
  try {
    var c = new AbortController();
    var tm = setTimeout(function () {
      c.abort();
    }, 8000);
    var t0 = Date.now();
    var r = await fetch(u, { signal: c.signal });
    clearTimeout(tm);
    connMetrics.lastLatency = Date.now() - t0;
    if (r.status === 429) {
      applyBackoff(60000, '429 Rate Limited');
      connMetrics.apiFail++;
      return null;
    }
    if (r.status === 418) {
      applyBackoff(300000, '418 IP Banned');
      connMetrics.apiFail++;
      return null;
    }
    if (r.status === 403) {
      applyBackoff(60000, '403 Forbidden');
      connMetrics.apiFail++;
      return null;
    }
    if (!r.ok) {
      connMetrics.apiFail++;
      return null;
    }
    connMetrics.apiOk++;
    /* Any successful response clears the backoff history, so a one-off
       429 doesn't keep the app in a long-tail penalty window. */
    apiCooldown.attempts = 0;
    return r.json();
  } catch (e) {
    connMetrics.apiFail++;
    return null;
  }
}

/* ─── derived health score + UI badge ──────────────────────────── */

/* Returns a 0-100 connection-health score that combines data freshness,
   API success rate, and how many coins we currently have prices for.
   A fresh tab with no requests yet scores 100 and decays from there.

   The freshness check is split between WS and REST so a healthy 5-second
   REST poll can't mask a dead WebSocket — we want the indicator to drop
   to "Fair / REST" the moment the WS goes silent, not stay green. */
function getConnQuality() {
  var score = 100;
  var now = Date.now();
  var wsAge =
    typeof lastWsDataTime !== 'undefined' && lastWsDataTime > 0 ? now - lastWsDataTime : Infinity;
  var restAge =
    typeof lastRestDataTime !== 'undefined' && lastRestDataTime > 0
      ? now - lastRestDataTime
      : Infinity;
  /* Best-of-both for the legacy comparison so a working REST keeps the
     score within the same band as before this split. */
  var bestAge = Math.min(wsAge, restAge);
  if (typeof lastDataTime !== 'undefined' && lastDataTime > 0) {
    bestAge = Math.min(bestAge, now - lastDataTime);
  }
  if (bestAge > 30000) score -= 40;
  else if (bestAge > 15000) score -= 15;
  /* WS-down penalty: even if REST is fresh, a dead live stream means
     the user is on multi-second-old REST data. Apply only after the
     WS has been connected at least once (lastWsDataTime > 0) AND has
     since gone silent, OR when connMetrics.wsUp explicitly went
     false. Skipping the penalty during the very first seconds of a
     fresh tab matches the existing test contract for getConnQuality. */
  var hasWsHistory = typeof lastWsDataTime !== 'undefined' && lastWsDataTime > 0;
  var wsKnownDown =
    typeof connMetrics !== 'undefined' && connMetrics && connMetrics.wsUp === false && hasWsHistory;
  var wsZombie = hasWsHistory && wsAge > 15000;
  if (wsKnownDown || wsZombie) score -= 15;
  /* API success rate */
  var total = connMetrics.apiOk + connMetrics.apiFail;
  if (total > 0) {
    var rate = connMetrics.apiOk / total;
    if (rate < 0.5) score -= 30;
    else if (rate < 0.8) score -= 10;
  }
  /* Coins loaded */
  var coins = Object.keys(T).length;
  if (coins < 100) score -= 20;
  else if (coins < 300) score -= 5;
  return Math.max(0, Math.min(100, score));
}

/* Returns 'live' | 'rest' | 'down' so the UI can label the connection
   indicator honestly when only the REST fallback is feeding data. */
function getConnMode() {
  var now = Date.now();
  var wsFresh =
    typeof lastWsDataTime !== 'undefined' && lastWsDataTime > 0 && now - lastWsDataTime <= 15000;
  var restFresh =
    typeof lastRestDataTime !== 'undefined' &&
    lastRestDataTime > 0 &&
    now - lastRestDataTime <= 30000;
  if (wsFresh) return 'live';
  if (restFresh) return 'rest';
  return 'down';
}

/* Paint the score onto the header status text + the validator dot. */
function updateConnStatus() {
  var q = getConnQuality();
  var mode = getConnMode();
  var el = document.getElementById('connStatus');
  var dot = document.getElementById('validatorDot');
  var txt;
  var col;
  if (q >= 80) {
    txt = lang === 'ar' ? 'ممتازة' : 'Excellent';
    col = 'var(--up)';
  } else if (q >= 50) {
    txt = lang === 'ar' ? 'جيدة' : 'Good';
    col = 'var(--neon)';
  } else if (q >= 30) {
    txt = lang === 'ar' ? 'عادية' : 'Fair';
    col = 'var(--warn)';
  } else {
    txt = lang === 'ar' ? 'ضعيفة' : 'Poor';
    col = 'var(--dn)';
  }
  /* When only REST is feeding data, suffix the label so the user knows
     the live stream is down and prices are tens of seconds old at best. */
  if (mode === 'rest') txt += ' · REST';
  else if (mode === 'down') txt += ' · OFFLINE';
  if (el) {
    el.textContent = txt;
    el.style.color = col;
  }
  if (dot) {
    dot.style.background = col;
    dot.style.boxShadow = '0 0 6px ' + col;
  }
}
