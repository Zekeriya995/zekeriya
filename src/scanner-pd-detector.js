/* NEXUS PRO — server-side Pump & Dump risk detector.

   Pure function port of the client-side detector at app.js:2459-2476,
   gated by the SCANNER_SERVER_PD_ENABLED env var (read at boot in
   scanner-engine.js). See SCANNER_AUDIT_2026_05_15.md §6 P1.1 and
   docs/SCANNER_PD_THRESHOLDS.md for the rationale per flag.

   Five flags are defined for parity with the client and for the
   eventual Phase 2.A.1 unified scoring registry:

     1) VERTICAL          — change >= 15%
     2) FR_EXTREME        — funding rate > 0.1 (% per 8h)
     3) LS_RETAIL_LONG    — retail account long/short ratio > 3
     4) SMART_VS_RETAIL   — top traders short AND retail long (compound)
     5) THIN_PUMP         — change >= 8% AND volume < $30M

   Data sources for the LS family (subtle):

     ls          — top-trader POSITION ratio (capital-weighted, from
                   Binance topLongShortPositionRatio). Read by the
                   LS_RETAIL_LONG check ONLY when globalLs is absent
                   — this is the parity fallback for clients without
                   the retail stream.
     globalLs    — all-accounts ratio (Binance globalLongShortAccountRatio).
                   This is the TRUE retail signal. When present, the
                   LS_RETAIL_LONG check prefers it.
     topTraders  — top-trader POSITION fractions ({positions:[{long...}]}).
                   Smart-money positioning. Used by SMART_VS_RETAIL's
                   "top traders short" half.

   The original client implementation referenced LS[s] (top traders)
   for both halves of SMART_VS_RETAIL, which made the AND condition
   logically impossible to satisfy (position long-fraction < 0.4
   AND position long/short ratio > 2 cannot both hold on the same
   snapshot). This detector accepts globalLs to fix that contradiction
   while remaining backward-compatible.

   Runtime reachability of each flag in production:

     VERTICAL      DORMANT.  Upstream filter scoreSymbol rejects
                   d.change >= 8 at scanner-engine.js:238 before this
                   detector runs. The flag is defined for symmetry
                   with the client and for the day the upstream
                   filter is restructured.
     FR_EXTREME    LIVE.     ctx.fr is wired in runScannerPass.
     LS_RETAIL_LONG LIVE.    Reads globalLs when available; falls
                   back to ls for parity.
     SMART_VS_RETAIL LIVE (with globalLs).  Requires BOTH topTraders
                   (top-trader positions) AND globalLs (retail accounts)
                   to compute the divergence. If either is missing the
                   flag stays silent.
     THIN_PUMP     DORMANT.  Same upstream filter as VERTICAL.

   Design notes:
   - Pure function — no I/O, no time, no globals. The caller injects
     all data via the input bag.
   - Defensive against missing fields: any flag whose source data
     is null / undefined / wrong-shaped silently does not fire.
     This is safer than throwing because the scanner runs every 30
     seconds and a single bad symbol must not crash the whole pass.
   - Threshold constants live in FLAG_THRESHOLDS so a future Phase
     2.A.1 unified rules registry can import them directly. */

'use strict';

const FLAG_THRESHOLDS = Object.freeze({
  VERTICAL_CHANGE_PCT: 15,
  FR_EXTREME_RATE: 0.1,
  /* Phase 1.1.c — Ziko approved §5 verdict on 2026-05-17: widen
     LS_RETAIL_LONG from > 3 to > 2.5 to catch borderline retail-
     heavy coins earlier. The hard cliff at 3.0 was the original
     concern in docs/SCANNER_PD_THRESHOLDS.md §3.3. Reverts to 3
     if the tag-stats endpoint shows over-suppression. */
  LS_RETAIL_LONG_RATIO: 2.5,
  SMART_TRADER_LONG_BELOW: 0.4,
  SMART_LS_RATIO_ABOVE: 2,
  THIN_PUMP_CHANGE_PCT: 8,
  THIN_PUMP_VOLUME_BELOW: 30_000_000,
});

const SCORE = Object.freeze({
  KILL_FLOOR: -100,
  SOFT_PENALTY: -25,
  KILL_AT_FLAGS: 3,
  SOFT_PENALTY_AT_FLAGS: 2,
});

/* detectPumpAndDump(input) — pure function returning a detection
   object describing which P&D flags fire for this snapshot.

   input shape (all fields optional; missing fields skip their flag):
     {
       change:     number  // 24h % change (e.g. +12.5)
       volume:     number  // 24h quote volume in USD
       fr:         { rate: number }  // funding rate, % per 8h
       ls:         { ratio: number } // top-trader position ratio
                                     // (parity fallback for LS_RETAIL_LONG)
       globalLs:   { ratio: number } // retail account ratio
                                     // (preferred for LS_RETAIL_LONG and
                                     //  required for SMART_VS_RETAIL)
       topTraders: { positions: [{ long: number }] } // 0..1 fraction
     }

   Returns:
     {
       flags:           string[]   // human-readable flag list
       count:           number     // flags.length, convenience
       scoreAdjustment: number | 'KILL'   // see applyToScore()
     } */
function detectPumpAndDump(input) {
  const flags = [];
  if (!input || typeof input !== 'object') {
    return { flags, count: 0, scoreAdjustment: 0 };
  }

  const { change, volume, fr, ls, globalLs, topTraders } = input;

  if (typeof change === 'number' && change >= FLAG_THRESHOLDS.VERTICAL_CHANGE_PCT) {
    flags.push('VERTICAL:+' + Math.round(change) + '%');
  }

  if (fr && typeof fr.rate === 'number' && fr.rate > FLAG_THRESHOLDS.FR_EXTREME_RATE) {
    flags.push('FR_EXTREME:' + fr.rate.toFixed(3));
  }

  /* LS_RETAIL_LONG — prefer globalLs (true retail) when present so the
     flag reflects retail euphoria. Fall back to ls (top-trader positions)
     when globalLs is missing, to preserve parity with clients that have
     not yet adopted the retail stream. */
  const retailLsRatio =
    globalLs && typeof globalLs.ratio === 'number'
      ? globalLs.ratio
      : ls && typeof ls.ratio === 'number'
        ? ls.ratio
        : null;
  if (retailLsRatio !== null && retailLsRatio > FLAG_THRESHOLDS.LS_RETAIL_LONG_RATIO) {
    flags.push('LS_RETAIL_LONG:' + retailLsRatio.toFixed(1));
  }

  /* SMART_VS_RETAIL — divergence between smart-money positioning (top
     trader long fraction) and retail-heavy sentiment (global accounts).
     Requires BOTH inputs: if either is absent the flag stays silent. */
  if (
    topTraders &&
    Array.isArray(topTraders.positions) &&
    topTraders.positions.length > 0 &&
    globalLs &&
    typeof globalLs.ratio === 'number' &&
    globalLs.ratio > FLAG_THRESHOLDS.SMART_LS_RATIO_ABOVE
  ) {
    const last = topTraders.positions[topTraders.positions.length - 1];
    if (
      last &&
      typeof last.long === 'number' &&
      last.long < FLAG_THRESHOLDS.SMART_TRADER_LONG_BELOW
    ) {
      flags.push('SMART_VS_RETAIL');
    }
  }

  if (
    typeof change === 'number' &&
    change >= FLAG_THRESHOLDS.THIN_PUMP_CHANGE_PCT &&
    typeof volume === 'number' &&
    volume < FLAG_THRESHOLDS.THIN_PUMP_VOLUME_BELOW
  ) {
    flags.push('THIN_PUMP');
  }

  let scoreAdjustment;
  if (flags.length >= SCORE.KILL_AT_FLAGS) {
    scoreAdjustment = 'KILL';
  } else if (flags.length === SCORE.SOFT_PENALTY_AT_FLAGS) {
    scoreAdjustment = SCORE.SOFT_PENALTY;
  } else {
    scoreAdjustment = 0;
  }

  return { flags, count: flags.length, scoreAdjustment };
}

/* applyToScore(score, detection) — pure helper that returns the
   adjusted score. KILL floors the score at SCORE.KILL_FLOOR (-100)
   so the downstream qualityFilter rejects the symbol; numeric
   adjustments are added directly. */
function applyToScore(score, detection) {
  if (!detection) return score;
  if (detection.scoreAdjustment === 'KILL') {
    return Math.min(score, SCORE.KILL_FLOOR);
  }
  if (typeof detection.scoreAdjustment === 'number') {
    return score + detection.scoreAdjustment;
  }
  return score;
}

module.exports = {
  FLAG_THRESHOLDS,
  SCORE,
  detectPumpAndDump,
  applyToScore,
};
