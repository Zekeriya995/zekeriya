/* NEXUS PRO — market-regime classifier (P0 item 1, the "governing
   principle": adapt scoring to the regime instead of one static weight
   profile that wins in one regime and loses in the other).

   Two regimes:
     'ranging'  — mean-reverting / choppy. Contrarian entries win (oversold
                  bounce, short-squeeze, negative-funding, bottom-of-range).
                  This is exactly what WEIGHTS_V2 was tuned and validated for.
     'trending' — a sustained multi-timeframe directional move. Momentum /
                  trend-following wins; fading the trend loses.

   Step 1 is OBSERVABILITY ONLY — this classifies and is surfaced on
   /api/all + logged, but does NOT yet switch weights. That lets us verify
   the classifier calls the live (mean-revert) market 'ranging' before it is
   allowed to drive scoring (step 2). Calibration of the trend-side weights
   waits until a trending regime is actually observed — so we never overfit
   the trend profile to a window we haven't seen.

   Pure function: inject the small slice of cache it needs (no I/O, no
   globals, no Date). Returns the regime plus the raw signals behind it so
   the call site / UI can explain the classification. Server-only module
   (runScannerPass is server-side), so plain CommonJS exports. */

'use strict';

const DEFAULTS = Object.freeze({
  /* trendScore >= this → 'trending', else 'ranging'. */
  TREND_SCORE_MIN: 2,
  /* Breadth (% of coins up on the day) that signals a decisive one-way
     tape — the signature of a trend rather than a chop. */
  BREADTH_HI: 65,
  BREADTH_LO: 35,
  /* BTC 15m ATR as a % of price at/above which the tape is 'volatile'
     (the design's transition regime). ATR(14,15m) for BTC sits ~0.3-0.8%
     when calm; ≥1.2% is a genuinely fast tape that warrants fewer, higher-
     conviction signals (risk-off) regardless of direction — design §4. */
  VOLATILITY_HI_PCT: 1.2,
});

/* detectRegime(input, opts)
     input: {
       btcMtf:     { agreement: 'bullish'|'bearish'|'mixed', strength: 'full'|'partial'|'none' }
                   — BTC multi-timeframe agreement (cache.indicatorsMtf.BTC.agreement).
                   BTC is the market leader, so its cross-timeframe alignment
                   is the primary trend signal.
       bullishPct: number 0..100 — share of scanned coins up on the day
                   (market breadth).
     }
   Returns { regime, direction, trendScore, inputs }:
     - regime:    'trending' | 'ranging' (the original output; kept verbatim so
                  every existing consumer keeps working).
     - direction: 'bull' | 'bear' | 'none' — NEW. The binary regime was
                  direction-BLIND: a strong DOWN-trend scored 'trending' exactly
                  like an up-trend, so the momentum profile got handed to a
                  FALLING tape. direction recovers the up/down split from BTC's
                  MTF agreement ('none' in a range). Consumers pick the profile
                  from (regime, direction): up → momentum, down/range → contrarian.
     - volatility: 'high' | 'normal' — NEW. An axis ORTHOGONAL to direction,
                  from BTC 15m ATR% (input btcAtrPct). A fast tape
                  (≥ VOLATILITY_HI_PCT) warrants fewer, higher-conviction
                  signals regardless of up/down/range (design §4). Unknown → normal.
   Missing/!shaped fields degrade to the neutral assumption (no trend) so a cold
   cache reads regime 'ranging', direction 'none', volatility 'normal'. */
function detectRegime(input, opts) {
  const o = opts || {};
  const cfg = {
    trendScoreMin: Number.isFinite(o.trendScoreMin) ? o.trendScoreMin : DEFAULTS.TREND_SCORE_MIN,
    breadthHi: Number.isFinite(o.breadthHi) ? o.breadthHi : DEFAULTS.BREADTH_HI,
    breadthLo: Number.isFinite(o.breadthLo) ? o.breadthLo : DEFAULTS.BREADTH_LO,
    volatilityHi: Number.isFinite(o.volatilityHi) ? o.volatilityHi : DEFAULTS.VOLATILITY_HI_PCT,
  };
  const i = input || {};
  const mtf = i.btcMtf && typeof i.btcMtf === 'object' ? i.btcMtf : {};
  const strength = typeof mtf.strength === 'string' ? mtf.strength : 'none';
  const agreement = typeof mtf.agreement === 'string' ? mtf.agreement : 'mixed';
  const bullishPct = typeof i.bullishPct === 'number' ? i.bullishPct : 50;
  /* BTC 15m ATR as a % of price — the volatility axis. null when unavailable
     (cold cache / missing indicator) so we degrade to 'normal'. */
  const btcAtrPct = typeof i.btcAtrPct === 'number' && isFinite(i.btcAtrPct) ? i.btcAtrPct : null;

  let trendScore = 0;
  /* Primary signal: a full/partial directional alignment of BTC across
     15m/1h/4h IS the definition of a trend. */
  if (strength === 'full') trendScore += 2;
  else if (strength === 'partial') trendScore += 1;
  /* Confirmation: a decisive breadth (strongly up OR strongly down) is a
     one-way tape; a balanced breadth is the signature of a range. */
  if (bullishPct >= cfg.breadthHi || bullishPct <= cfg.breadthLo) trendScore += 1;

  const regime = trendScore >= cfg.trendScoreMin ? 'trending' : 'ranging';
  /* Direction (audit fix): split a trend into UP vs DOWN from BTC's MTF
     agreement, so a downtrend can stop receiving the momentum profile. A
     ranging tape has no dominant direction. */
  let direction = 'none';
  if (regime === 'trending') {
    if (agreement === 'bearish') direction = 'bear';
    else if (agreement === 'bullish') direction = 'bull';
  }
  /* Volatility (design §4 'volatile / transition'): an axis ORTHOGONAL to
     direction — a fast tape warrants fewer, higher-conviction signals whether
     it's up, down, or ranging. Unknown ATR → 'normal' (no tightening). */
  const volatility = btcAtrPct != null && btcAtrPct >= cfg.volatilityHi ? 'high' : 'normal';
  return {
    regime,
    direction,
    volatility,
    trendScore,
    inputs: {
      btcStrength: strength,
      btcAgreement: agreement,
      bullishPct: Math.round(bullishPct * 10) / 10,
      btcAtrPct: btcAtrPct != null ? Math.round(btcAtrPct * 100) / 100 : null,
    },
  };
}

module.exports = { detectRegime, DEFAULTS };
