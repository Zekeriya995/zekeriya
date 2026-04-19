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
   ~30 sibling requests that would otherwise pile in. */
var apiCooldown = { until: 0, reason: '' };

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
      apiCooldown.until = Date.now() + 60000;
      apiCooldown.reason = '429 Rate Limited';
      connMetrics.apiFail++;
      return null;
    }
    if (r.status === 418) {
      apiCooldown.until = Date.now() + 300000;
      apiCooldown.reason = '418 IP Banned';
      connMetrics.apiFail++;
      return null;
    }
    if (r.status === 403) {
      apiCooldown.until = Date.now() + 600000;
      apiCooldown.reason = '403 Forbidden';
      connMetrics.apiFail++;
      return null;
    }
    if (!r.ok) {
      connMetrics.apiFail++;
      return null;
    }
    connMetrics.apiOk++;
    return r.json();
  } catch (e) {
    connMetrics.apiFail++;
    return null;
  }
}

/* ─── derived health score + UI badge ──────────────────────────── */

/* Returns a 0-100 connection-health score that combines data freshness,
   API success rate, and how many coins we currently have prices for.
   A fresh tab with no requests yet scores 100 and decays from there. */
function getConnQuality() {
  var score = 100;
  /* Data freshness */
  var age = Date.now() - lastDataTime;
  if (age > 30000) score -= 40;
  else if (age > 15000) score -= 15;
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

/* Paint the score onto the header status text + the validator dot. */
function updateConnStatus() {
  var q = getConnQuality();
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
  if (el) {
    el.textContent = txt;
    el.style.color = col;
  }
  if (dot) {
    dot.style.background = col;
    dot.style.boxShadow = '0 0 6px ' + col;
  }
}
