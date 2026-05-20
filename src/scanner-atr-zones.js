/* NEXUS PRO — server-side ATR-aware SL/TP zones.

   Pure function port of the volatility-aware bounds calculation
   that lives in src/scanner-helpers.js for the browser. The server
   needs its own copy because scanner-helpers.js is loaded as a
   non-module browser script (no module.exports), and duplicating
   one ~40-line pure function is simpler than restructuring the
   shared file. Phase 2.A.1 (unified scoring rules registry) will
   eventually fold both into the same import.

   The motivation, in one sentence: a fixed -3% / +5% / +10% ladder
   prices BTC and DOGE the same despite their wildly different daily
   ranges. Using k × ATR(14) instead makes the stop tight on quiet
   coins and wide on noisy ones — and TP scales the same way, so
   the R:R ratio stays meaningful across the volatility spectrum.

   Multipliers chosen to match the client-side atrZones() defaults:
     stop = 1.5 × ATR   → minimum 2.0 R:R against TP1
     tp1  = 3.0 × ATR
     tp2  = 5.0 × ATR

   The function returns null when ATR is missing or non-positive, OR
   when the resulting bounds violate the invariant stop < price < tp1.
   Callers (scanner-engine.js) treat null as "fall back to the fixed
   percent ladder" — parity preserved when ATR is unavailable. */

'use strict';

const DEFAULT_MULTS = Object.freeze({
  stop: 1.5,
  tp1: 3.0,
  tp2: 5.0,
});

/* atrZones(price, atr, opts) — pure function.

   input:
     price  — number, must be > 0
     atr    — number, must be > 0 (function returns null otherwise)
     opts   — optional { stop, tp1, tp2 } multiplier overrides

   returns:
     { stop, tp1, tp2, rr, atr } on success
     null when bounds are unusable (missing data, degenerate setup) */
function atrZones(price, atr, opts) {
  if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) return null;
  if (typeof atr !== 'number' || !Number.isFinite(atr) || atr <= 0) return null;

  /* Resolve each multiplier: use override when it's a positive
     finite number, fall back to the default otherwise. Rejecting
     non-positive or non-finite overrides is intentional — a
     negative `stop` mult would flip the stop ABOVE price, a zero
     would put stop AT price (zero risk = degenerate), and a
     positive Infinity would multiply ATR to Infinity, producing
     stop = -Infinity (caught later by the guard but inconsistent
     with how NaN / -Infinity are already filtered here). The
     Number.isFinite check rejects all three pathological cases
     up-front. Surfaced by pre-merge correctness review (NIT A1). */
  const _isPos = (v) => Number.isFinite(v) && v > 0;
  const sM = opts && _isPos(opts.stop) ? opts.stop : DEFAULT_MULTS.stop;
  const t1M = opts && _isPos(opts.tp1) ? opts.tp1 : DEFAULT_MULTS.tp1;
  const t2M = opts && _isPos(opts.tp2) ? opts.tp2 : DEFAULT_MULTS.tp2;

  const stop = price - sM * atr;
  const tp1 = price + t1M * atr;
  const tp2 = price + t2M * atr;

  /* Degenerate-setup guard: if ATR is large enough to push stop ≤ 0
     or tp1 fails to clear price (shouldn't happen with positive
     multipliers, but locks it in), reject and let the caller fall
     back to the fixed ladder. */
  if (!(stop > 0 && stop < price && price < tp1)) return null;

  const risk = price - stop;
  const reward = tp1 - price;
  const rr = Math.round((reward / risk) * 100) / 100;

  return {
    stop: +stop.toFixed(8),
    tp1: +tp1.toFixed(8),
    tp2: +tp2.toFixed(8),
    rr: rr,
    atr: atr,
  };
}

module.exports = { DEFAULT_MULTS, atrZones };
