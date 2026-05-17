/* NEXUS PRO — server-side Pump & Dump risk detector.

   Pure function port of the client-side detector at app.js:2459-2476,
   gated by the SCANNER_SERVER_PD_ENABLED env var (read at boot in
   scanner-engine.js). See SCANNER_AUDIT_2026_05_15.md §6 P1.1 and
   docs/SCANNER_PD_THRESHOLDS.md for the rationale per flag.

   Five flags are defined for parity with the client and for the
   eventual Phase 2.A.1 unified scoring registry:

     1) VERTICAL          — change >= 15%
     2) FR_EXTREME        — funding rate > 0.1 (% per 8h)
     3) LS_RETAIL_LONG    — long/short account ratio > 3
     4) SMART_VS_RETAIL   — top traders short AND retail long (compound)
     5) THIN_PUMP         — change >= 8% AND volume < $30M

   IMPORTANT — runtime reachability of each flag in this PR:

     VERTICAL      DORMANT.  Upstream filter scoreSymbol rejects
                   d.change >= 8 at scanner-engine.js:238 before this
                   detector runs. The flag is defined for symmetry
                   with the client and for the day the upstream
                   filter is restructured.
     FR_EXTREME    LIVE.     ctx.fr is wired in runScannerPass.
     LS_RETAIL_LONG LIVE.    ctx.ls is wired in runScannerPass.
     SMART_VS_RETAIL DORMANT. Server does not currently fetch the
                   top-trader long/short stream; the detector accepts
                   the data shape and will start firing the flag the
                   moment the wiring lands (out of scope for Phase
                   1.1).
     THIN_PUMP     DORMANT.  Same upstream filter as VERTICAL.

   So in production this PR adds suppression for the FR_EXTREME and
   LS_RETAIL_LONG signals, which were previously absent on the
   server. The 2-flag soft penalty (-25) becomes reachable when both
   fire on the same coin; the 3-flag kill (-100 floor) requires
   either the topTraders wiring (later PR) or restructuring the
   upstream change-pct filter.

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
  LS_RETAIL_LONG_RATIO: 3,
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
       ls:         { ratio: number } // global long/short ratio
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

  const { change, volume, fr, ls, topTraders } = input;

  if (typeof change === 'number' && change >= FLAG_THRESHOLDS.VERTICAL_CHANGE_PCT) {
    flags.push('VERTICAL:+' + Math.round(change) + '%');
  }

  if (fr && typeof fr.rate === 'number' && fr.rate > FLAG_THRESHOLDS.FR_EXTREME_RATE) {
    flags.push('FR_EXTREME:' + fr.rate.toFixed(3));
  }

  if (ls && typeof ls.ratio === 'number' && ls.ratio > FLAG_THRESHOLDS.LS_RETAIL_LONG_RATIO) {
    flags.push('LS_RETAIL_LONG:' + ls.ratio.toFixed(1));
  }

  if (
    topTraders &&
    Array.isArray(topTraders.positions) &&
    topTraders.positions.length > 0 &&
    ls &&
    typeof ls.ratio === 'number' &&
    ls.ratio > FLAG_THRESHOLDS.SMART_LS_RATIO_ABOVE
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
