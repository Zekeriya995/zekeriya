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

/* Volume-weighted average price across the OPEN whale position.
   Buys add to the position; sells reduce the remaining size in
   FIFO order at the average entry, leaving the avg unchanged
   (sells realise PnL but don't alter the avg of the surviving
   position).

   AUDIT-F4: the previous version treated every wave as a buy
   regardless of `side`, so any sell wave appended to whaleWaves
   would inflate the position size and drag the average toward
   the sell price — the resulting avgEntry was a fiction, and
   calcWhalePnL reported PnL against a phantom long stack. The
   fix consults `w.side` (default: 'buy', preserving today's
   schema for callers that haven't started populating side).

   Waves missing `side` are treated as buys for backward compat
   with the existing whaleWaves payload — no migration needed. */
function calcWhaleAvgEntry(sym) {
  var ww = whaleWaves[sym];
  if (!ww || !ww.waves || !ww.waves.length) return 0;
  var heldAmount = 0;
  var weightedCost = 0;
  ww.waves.forEach(function (w) {
    if (w.source === 'ESTIMATE' || !(w.price > 0)) return;
    var side = w.side || 'buy';
    if (side === 'sell') {
      /* Sells reduce the remaining amount at the prevailing avg
         (cost basis stays the same per remaining unit). Cap at 0
         so an over-sold-then-rebought sequence doesn't go
         negative — that would imply prior data we don't have. */
      var sold = Math.min(heldAmount, w.amount);
      if (heldAmount > 0) {
        weightedCost -= sold * (weightedCost / heldAmount);
      }
      heldAmount -= sold;
    } else {
      heldAmount += w.amount;
      weightedCost += w.amount * w.price;
    }
  });
  return heldAmount > 0 ? weightedCost / heldAmount : 0;
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
   there isn't enough data to span more than a single sample.

   AUDIT-F7: when two waves arrive seconds apart, the divisor (timeSpan
   in minutes) collapses toward 0 and the returned rate balloons by
   60x or more — the alert threshold (flowRate>50000) tripped on
   noise. The fix floors timeSpan at 1 minute, which is the smallest
   window the metric can meaningfully describe given a 15-minute
   sliding bucket and waves-per-minute units. */
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
  var rawSpan = (Date.now() - recent[0].time) / 60000;
  var timeSpan = Math.max(rawSpan, 1);
  return totalAmount / timeSpan;
}
