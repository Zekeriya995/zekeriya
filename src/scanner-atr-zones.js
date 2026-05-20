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

   Default multipliers (non-tier-1):
     stop = 1.5 × ATR   → minimum 2.0 R:R against TP1
     tp1  = 3.0 × ATR
     tp2  = 5.0 × ATR

   Phase 2.A.4.b — Tier-1 multipliers (BTC/ETH/SOL/BNB/XRP/etc.):
     stop = 1.2 × ATR
     tp1  = 1.8 × ATR   → 1.5 R:R, tighter than non-tier-1
     tp2  = 3.0 × ATR

   The motivation for tier-aware: the SAGA finding plus a 2026-05-20
   user-spotted BTC signal showed entry $77,160 / TP1 +6.5% over a
   stated "1-4 hour" window — unrealistic for BTC's typical hourly
   range. ATR(14) on 15m klines for BTC is ~$1,680; with default
   multipliers TP1 lands ~3 ATR away which is roughly a half-day
   move for BTC, not 4 hours. Tier-1 multipliers tighten this to
   ~1.8 ATR (~+3.9% in this example) — a target a typical 4-hour
   trend leg can actually reach. Non-tier-1 alts often run +5% in
   an hour, so they keep the original multipliers.

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

/* Tier-1 multipliers — tighter bounds for established large-caps
   where 15m-ATR-derived ranges are reached more slowly. The tp1
   multiplier of 1.8 keeps R:R = 1.5 (vs 2.0 for non-tier-1), which
   is an explicit trade-off: less reward per trade, but the target
   is actually reachable in the displayed 1-4h window. The
   correctness reviewer should flag if R:R drops below 1.3 in a
   future tuning — that's the floor below which the strategy
   becomes statistically unprofitable even at high win-rates. */
const TIER1_MULTS = Object.freeze({
  stop: 1.2,
  tp1: 1.8,
  tp2: 3.0,
});

/* atrZones(price, atr, opts) — pure function.

   input:
     price  — number, must be > 0
     atr    — number, must be > 0 (function returns null otherwise)
     opts   — optional {
                stop, tp1, tp2  — numeric multiplier overrides
                isTier1         — boolean: when === true, use TIER1_MULTS
                                  as the defaults instead of DEFAULT_MULTS
              }

   returns:
     { stop, tp1, tp2, rr, atr } on success
     null when bounds are unusable (missing data, degenerate setup)

   The override → default cascade is: numeric override in opts wins
   over the tier-resolved baseline, which wins over DEFAULT_MULTS. So
   a caller can still force a specific stop multiplier on a tier-1
   coin, but if they don't, tier-1 gets the tighter baseline. */
function atrZones(price, atr, opts) {
  if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) return null;
  if (typeof atr !== 'number' || !Number.isFinite(atr) || atr <= 0) return null;

  /* Strict `=== true`: same discipline as the registry condition
     functions. Anything other than literal boolean true (undefined,
     truthy strings, 1) falls through to DEFAULT_MULTS. Conservative
     by design — if the caller forgets to wire isTier1 through, the
     non-tier-1 (wider) defaults apply, which is the safer failure
     mode (signals stay visible, just with the old behaviour). */
  const isTier1 = !!(opts && opts.isTier1 === true);
  const baseline = isTier1 ? TIER1_MULTS : DEFAULT_MULTS;

  /* Resolve each multiplier: use override when it's a positive
     finite number, fall back to the tier-resolved baseline otherwise.
     Rejecting non-positive or non-finite overrides is intentional —
     a negative `stop` mult would flip the stop ABOVE price, a zero
     would put stop AT price (zero risk = degenerate), and a
     positive Infinity would multiply ATR to Infinity, producing
     stop = -Infinity (caught later by the guard but inconsistent
     with how NaN / -Infinity are already filtered here). The
     Number.isFinite check rejects all three pathological cases
     up-front. Surfaced by pre-merge correctness review (NIT A1). */
  const _isPos = (v) => Number.isFinite(v) && v > 0;
  const sM = opts && _isPos(opts.stop) ? opts.stop : baseline.stop;
  const t1M = opts && _isPos(opts.tp1) ? opts.tp1 : baseline.tp1;
  const t2M = opts && _isPos(opts.tp2) ? opts.tp2 : baseline.tp2;

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

module.exports = { DEFAULT_MULTS, TIER1_MULTS, atrZones };
