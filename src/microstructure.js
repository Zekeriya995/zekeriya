/* NEXUS PRO — order-flow microstructure (pure, testable).

   Iceberg detection, fixed for the audit's Group D scale bug. The old
   detector in app.js bucketed trades by an ABSOLUTE 4-decimal price
   (`Math.round(t.p*10000)/10000`): for a $74k asset that puts almost every
   trade in its own bucket, so the "8+ fills at one level" rule essentially
   never fires — the detector was dead for BTC/ETH.

   Here the bucket width is RELATIVE to price (`price * bandPct`, default
   0.05%), exactly like detectAbsorption's `curP*0.001` tolerance, so the
   same thresholds work from $0.0001 to $74,000. All the other filters
   (≥8 fills at a level, within a 120s window, near-uniform sizes) are
   preserved, so widening the bucket doesn't invite false positives.

   Pure: trades + options in, signal out. UMD-lite for browser + Node. */

'use strict';

const DEFAULTS = {
  minTrades: 10, // need at least this many trades overall
  minLevelTrades: 8, // and this many at one price band to call it an iceberg
  windowMs: 120000, // …within this span
  bandPct: 0.0005, // band width = price * 0.05% (relative → scale-free)
  uniformThresh: 0.5, // stdev/avg below this = uniform fills (true iceberg)
  maxScore: 20,
};

function num(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

/* Detect iceberg orders in a recent trade window.
   `trades`: [{ p, v, buy, t }] (price, usd value, isBuy, ms timestamp).
   `opts.curP`: reference price for the band (falls back to the last trade). */
function detectIceberg(trades, opts) {
  const o = opts || {};
  const cfg = {
    minTrades: o.minTrades || DEFAULTS.minTrades,
    minLevelTrades: o.minLevelTrades || DEFAULTS.minLevelTrades,
    windowMs: o.windowMs || DEFAULTS.windowMs,
    bandPct: o.bandPct || DEFAULTS.bandPct,
    uniformThresh: o.uniformThresh || DEFAULTS.uniformThresh,
  };
  const t = Array.isArray(trades) ? trades : [];
  const none = { score: 0, signal: 'NO_ICEBERG', count: 0, icebergs: [] };
  if (t.length < cfg.minTrades) return none;

  const ref = num(o.curP) > 0 ? num(o.curP) : num(t[t.length - 1] && t[t.length - 1].p);
  if (!(ref > 0)) return none;
  const band = ref * cfg.bandPct;
  if (!(band > 0)) return none;

  /* Bucket trades into relative price bands. */
  const levels = {};
  t.forEach((x) => {
    const p = num(x.p);
    if (!(p > 0)) return;
    const k = Math.round(p / band);
    (levels[k] = levels[k] || []).push(x);
  });

  let sc = 0;
  const icebergs = [];
  Object.keys(levels).forEach((k) => {
    const lt = levels[k];
    if (lt.length < cfg.minLevelTrades) return;
    const span = num(lt[lt.length - 1].t) - num(lt[0].t);
    if (span > cfg.windowMs) return;
    const vol = lt.reduce((s, x) => s + num(x.v), 0);
    const avg = vol / lt.length;
    const variance = lt.reduce((s, x) => s + Math.pow(num(x.v) - avg, 2), 0) / lt.length;
    const uniform = avg > 0 ? Math.sqrt(variance) / avg < cfg.uniformThresh : false;
    const buyPct = lt.filter((x) => x.buy).length / lt.length;
    sc += uniform ? 12 : 6;
    icebergs.push({
      price: Number(k) * band,
      count: lt.length,
      vol,
      side: buyPct > 0.7 ? 'BUY' : buyPct < 0.3 ? 'SELL' : 'MIXED',
      uniform,
    });
  });

  return {
    score: Math.min(DEFAULTS.maxScore, sc),
    icebergs,
    signal: icebergs.length
      ? icebergs[0].side === 'BUY'
        ? 'ICEBERG_BUY'
        : icebergs[0].side === 'SELL'
          ? 'ICEBERG_SELL'
          : 'ICEBERG_MIXED'
      : 'NO_ICEBERG',
    count: icebergs.length,
  };
}

const MICROSTRUCTURE_API = { DEFAULTS, detectIceberg };
if (typeof module !== 'undefined' && module.exports) {
  module.exports = MICROSTRUCTURE_API;
} else if (typeof window !== 'undefined') {
  window.Microstructure = MICROSTRUCTURE_API;
}
