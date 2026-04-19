/* NEXUS PRO — whale state + small read-only helpers.
   Owns the persisted `whaleWaves` map (per-coin accumulation history +
   current engine output) and a handful of pure calculations that
   summarise it. The actual scoring engine — the multi-layer logic that
   builds whaleWaves[s].engine — lives in app.js for now; this module
   is the boundary between that engine and the rest of the app.

   Cross-file dependencies (resolved at call time):
     - storage:  safeGetJSON  (src/storage.js)
     - app.js:   T            (price ticker map)

   Persistence: writes back to localStorage('nxww10') happen from app.js
   wherever waves get appended/cleared; this module only owns the
   initial hydration + read-only summaries. */

/* ─── persisted whale-wave store ───────────────────────────────── */
var whaleWaves = safeGetJSON('nxww10', {});

/* ─── read-only helpers ────────────────────────────────────────── */

/* Sum of confirmed (non-estimated) buy volume from waves that are
   still within a 2-hour activity window. Returns 0 if there are no
   recent confirmed waves. */
function calcRealTotalBuy(sym) {
  var ww = whaleWaves[sym];
  if (!ww || !ww.waves || !ww.waves.length) return 0;
  var now = Date.now();
  var activeWaves = ww.waves.filter(function (w) {
    return now - w.time < 7200000;
  });
  return activeWaves.reduce(function (s, w) {
    return s + (w.source === 'ESTIMATE' ? 0 : w.amount);
  }, 0);
}

/* Volume-weighted average price across confirmed waves for a coin.
   Returns 0 if no priced waves exist. */
function calcWhaleAvgEntry(sym) {
  var ww = whaleWaves[sym];
  if (!ww || !ww.waves || !ww.waves.length) return 0;
  var totalAmount = 0;
  var weightedPrice = 0;
  ww.waves.forEach(function (w) {
    if (w.source !== 'ESTIMATE' && w.price > 0) {
      totalAmount += w.amount;
      weightedPrice += w.amount * w.price;
    }
  });
  return totalAmount > 0 ? weightedPrice / totalAmount : 0;
}

/* Mark-to-market view of the whale book for a coin:
     - pct       % move from average entry to current price
     - status    coarse bucket used by the UI to colour the row */
function calcWhalePnL(sym) {
  var avgEntry = calcWhaleAvgEntry(sym);
  if (!avgEntry || !T[sym]) return { pnl: 0, pct: 0, status: 'UNKNOWN' };
  var current = T[sym].p;
  var pct = ((current - avgEntry) / avgEntry) * 100;
  var status =
    pct > 3
      ? 'PROFIT_TAKING_RISK'
      : pct > 0
        ? 'IN_PROFIT'
        : pct > -3
          ? 'UNDERWATER'
          : 'DEEP_LOSS_DUMP_RISK';
  return { pnl: current - avgEntry, pct: pct, avgEntry: avgEntry, status: status };
}

/* Inflow rate over the last 15 minutes (units / minute). Returns 0 if
   there isn't enough data to span more than a single sample. */
function calcFlowRate(sym) {
  var ww = whaleWaves[sym];
  if (!ww || !ww.waves || ww.waves.length < 2) return 0;
  var recent = ww.waves.filter(function (w) {
    return Date.now() - w.time < 900000;
  });
  if (!recent.length) return 0;
  var totalAmount = recent.reduce(function (s, w) {
    return s + w.amount;
  }, 0);
  var timeSpan = (Date.now() - recent[0].time) / 60000;
  return timeSpan > 0 ? totalAmount / timeSpan : 0;
}
